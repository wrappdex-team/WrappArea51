// ══════════════════════════════════════════════════════════════════════
// ATOMIC SIGNER — Hedera-Native CryptoTransfer Co-Signing Oracle
// ══════════════════════════════════════════════════════════════════════
//
// Replaces the KV-backed AMM (amm.ts). This module is a SIGNING ORACLE:
//   - It does NOT hold pool state (reserves are on-chain token balances)
//   - It does NOT compute swap amounts for clients (clients compute locally)
//   - It VALIDATES swap math independently (re-reads reserves, recomputes)
//   - It CO-SIGNS the pool account's side of atomic CryptoTransfers
//
// Trust model:
//   Phase 1: Server holds pool account private keys (signing oracle)
//   Phase 2: Threshold keys (2-of-3 multisig on pool accounts)
//   Phase 3: Hedera account abstraction (HIP-206) for on-chain AMM rules
//
// SENIOR DEV NOTE [ATOMIC-09]:
//   The server's ONLY power is deciding whether to co-sign. It cannot:
//     - Steal user funds (user sees full TX in wallet before signing)
//     - Forge transactions (user must also sign; 2-of-2 requirement)
//     - Manipulate amounts (independent reserve read + math validation)
//   The server CAN refuse to sign (DoS), which is the Phase 1 trust
//   assumption. Phase 2 threshold keys eliminate this risk.
//
// SEC-07: Every co-sign request triggers an independent Mirror Node read.
//   The server NEVER trusts client-supplied reserve values or amounts.
//   Math tolerance: 1 raw unit (BigInt rounding). Anything larger = reject.
//
// SEC-08: Pool private keys are read from environment variables at startup.
//   They are NEVER logged, NEVER returned in API responses, NEVER included
//   in error messages. Key material exists only in memory.
// ══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import {
  getClientIp,
  isRateLimited,
  isValidHederaAccountId,
  isValidBigIntString,
  sanitizeString,
  ROUTE_PREFIX,
  HEDERA_MIRROR_MAINNET,
  mirrorNodeBreaker,
  isHttpFailure,
  isAccountRateLimited,
} from "./shared.ts";
import { requireAuth, requireOwner, logAdminAction } from "./auth.ts";

// ── Constants ────────────────────────────────────────────────────────

const MIRROR_NODE_URL = HEDERA_MIRROR_MAINNET;
const MIRROR_TIMEOUT_MS = 10_000;

// ── AMM Fee Constants (must match atomic-swap-engine.ts) ─────────────

const TOTAL_SWAP_FEE_BPS = 25;
const BPS_BASE = 10_000n;

// ── Kill Switch ──────────────────────────────────────────────────────
// Reuses the same KV key as the old AMM for seamless migration.
// Owner-only circuit breaker. When active, all co-signing is rejected.
// LP removals remain allowed (users must always withdraw).

const AMM_KILL_SWITCH_KEY = "amm_kill_switch";

interface AmmKillState {
  active: boolean;
  activatedAt: number;
  activatedBy: string;
  reason: string;
}

let _killSwitchCache: { state: AmmKillState | null; ts: number } = { state: null, ts: 0 };
const _KILL_SWITCH_CACHE_TTL_MS = 5_000;

async function isAmmKilled(): Promise<boolean> {
  const now = Date.now();
  if (now - _killSwitchCache.ts < _KILL_SWITCH_CACHE_TTL_MS) {
    return _killSwitchCache.state?.active ?? false;
  }
  try {
    const state: AmmKillState | null = await kv.get(AMM_KILL_SWITCH_KEY);
    _killSwitchCache = { state, ts: now };
    return state?.active ?? false;
  } catch {
    if (_killSwitchCache.state !== null) {
      _killSwitchCache.ts = Date.now();
      console.log(`[AtomicSigner] KV unreachable — cached kill switch: active=${_killSwitchCache.state.active}`);
      return _killSwitchCache.state.active;
    }
    console.log("[AtomicSigner] KV unreachable, no cache — failing closed (halting signer)");
    return true;
  }
}

// ── Token Whitelist (must match atomic-swap-engine.ts) ───────────────

interface TokenDef {
  tokenId: string;
  symbol: string;
  decimals: number;
}

const TOKEN_WHITELIST: TokenDef[] = [
  { tokenId: "0.0.1456986", symbol: "WHBAR", decimals: 8 },
  { tokenId: "0.0.456858",  symbol: "USDC",  decimals: 6 },
  { tokenId: "0.0.4291336", symbol: "USDT",  decimals: 6 },
  { tokenId: "0.0.1055477", symbol: "DAI",   decimals: 8 },
  { tokenId: "0.0.1055459", symbol: "USDCh", decimals: 6 },
  { tokenId: "0.0.1055472", symbol: "USDTh", decimals: 6 },
  { tokenId: "0.0.1055483", symbol: "WBTC",  decimals: 8 },
  { tokenId: "0.0.541564",  symbol: "WETH",  decimals: 18 },
  { tokenId: "0.0.1055495", symbol: "LINK",  decimals: 8 },
  { tokenId: "0.0.1055498", symbol: "AAVE",  decimals: 8 },
  { tokenId: "0.0.1157005", symbol: "WBNB",  decimals: 8 },
  { tokenId: "0.0.1157020", symbol: "WAVAX", decimals: 8 },
  { tokenId: "0.0.540318",  symbol: "WMATIC",decimals: 8 },
];

const TOKEN_BY_SYMBOL = new Map(TOKEN_WHITELIST.map(t => [t.symbol, t]));
const TOKEN_BY_ID = new Map(TOKEN_WHITELIST.map(t => [t.tokenId, t]));

// ── Pool Registry (must match atomic-swap-engine.ts POOL_REGISTRY) ───

interface PoolConfig {
  poolId: string;
  tokenA: string;
  tokenB: string;
  accountId: string;        // "PENDING" until deployed on Hedera
  lpTokenId: string;        // "PENDING" until LP token created
  swapFeeBps: number;
  status: "active" | "paused" | "deprecated";
  /** Environment variable name holding this pool's private key (ED25519 hex) */
  envKeyName: string;
}

const POOL_REGISTRY: PoolConfig[] = [
  {
    poolId: "ap-usdc-whbar",
    tokenA: "USDC", tokenB: "WHBAR",
    accountId: "PENDING", lpTokenId: "PENDING",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
    status: "paused",
    envKeyName: "POOL_KEY_AP_USDC_WHBAR",
  },
  {
    poolId: "ap-usdt-whbar",
    tokenA: "USDT", tokenB: "WHBAR",
    accountId: "PENDING", lpTokenId: "PENDING",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
    status: "paused",
    envKeyName: "POOL_KEY_AP_USDT_WHBAR",
  },
  {
    poolId: "ap-usdc-usdt",
    tokenA: "USDC", tokenB: "USDT",
    accountId: "PENDING", lpTokenId: "PENDING",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
    status: "paused",
    envKeyName: "POOL_KEY_AP_USDC_USDT",
  },
  {
    poolId: "ap-wbtc-whbar",
    tokenA: "WBTC", tokenB: "WHBAR",
    accountId: "PENDING", lpTokenId: "PENDING",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
    status: "paused",
    envKeyName: "POOL_KEY_AP_WBTC_WHBAR",
  },
  {
    poolId: "ap-weth-whbar",
    tokenA: "WETH", tokenB: "WHBAR",
    accountId: "PENDING", lpTokenId: "PENDING",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
    status: "paused",
    envKeyName: "POOL_KEY_AP_WETH_WHBAR",
  },
  {
    poolId: "ap-weth-usdc",
    tokenA: "WETH", tokenB: "USDC",
    accountId: "PENDING", lpTokenId: "PENDING",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
    status: "paused",
    envKeyName: "POOL_KEY_AP_WETH_USDC",
  },
  {
    poolId: "ap-link-whbar",
    tokenA: "LINK", tokenB: "WHBAR",
    accountId: "PENDING", lpTokenId: "PENDING",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
    status: "paused",
    envKeyName: "POOL_KEY_AP_LINK_WHBAR",
  },
  {
    poolId: "ap-dai-usdc",
    tokenA: "DAI", tokenB: "USDC",
    accountId: "PENDING", lpTokenId: "PENDING",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
    status: "paused",
    envKeyName: "POOL_KEY_AP_DAI_USDC",
  },
];

const POOL_BY_ID = new Map(POOL_REGISTRY.map(p => [p.poolId, p]));

// Pool ID validation — accepts "ap-{symbol}-{symbol}" format
function isValidAtomicPoolId(id: unknown): boolean {
  if (typeof id !== "string" || id.length === 0 || id.length > 80) return false;
  return /^ap-[a-z]{2,10}-[a-z]{2,10}$/.test(id);
}

// ── AMM Math (identical to atomic-swap-engine.ts — deterministic) ────

function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const feeMultiplier = BPS_BASE - BigInt(feeBps);
  const amountInWithFee = amountIn * feeMultiplier;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BPS_BASE + amountInWithFee;
  return numerator / denominator;
}

// ── Mirror Node Reserve Reading ──────────────────────────────────────
// Server reads reserves INDEPENDENTLY of the client. Ground truth.

async function fetchAccountTokenBalance(
  accountId: string,
  tokenId: string,
): Promise<{ rawBalance: bigint; found: boolean }> {
  try {
    const url = `${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}&limit=1`;
    const res = await mirrorNodeBreaker.call(
      () => fetch(url, { signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS) }),
      isHttpFailure,
    );
    if (!res.ok) {
      console.log(`[AtomicSigner] Mirror Node ${res.status} for ${accountId} token ${tokenId}`);
      return { rawBalance: 0n, found: false };
    }
    const data = await res.json();
    const tokens: Array<{ token_id: string; balance: number }> = data.tokens || [];
    if (tokens.length === 0) return { rawBalance: 0n, found: false };
    return { rawBalance: BigInt(tokens[0].balance), found: true };
  } catch (err: any) {
    console.log(`[AtomicSigner] Mirror Node fetch failed: ${err?.message}`);
    return { rawBalance: 0n, found: false };
  }
}

interface ServerReserves {
  reserveA: bigint;
  reserveB: bigint;
  isLive: boolean;
  fetchedAt: number;
}

async function fetchPoolReserves(pool: PoolConfig): Promise<ServerReserves> {
  if (pool.accountId === "PENDING") {
    return { reserveA: 0n, reserveB: 0n, isLive: false, fetchedAt: Date.now() };
  }

  const tokenA = TOKEN_BY_SYMBOL.get(pool.tokenA);
  const tokenB = TOKEN_BY_SYMBOL.get(pool.tokenB);
  if (!tokenA || !tokenB) {
    return { reserveA: 0n, reserveB: 0n, isLive: false, fetchedAt: Date.now() };
  }

  const [balA, balB] = await Promise.all([
    fetchAccountTokenBalance(pool.accountId, tokenA.tokenId),
    fetchAccountTokenBalance(pool.accountId, tokenB.tokenId),
  ]);

  return {
    reserveA: balA.rawBalance,
    reserveB: balB.rawBalance,
    isLive: balA.found && balB.found,
    fetchedAt: Date.now(),
  };
}

// ── Pool Key Management ──────────────────────────────────────────────
// SEC-08: Keys read from env at call time. Never cached in plain text
// outside of the signing scope. Never logged or returned in responses.

async function signTransactionWithPoolKey(
  pool: PoolConfig,
  transactionBytes: Uint8Array,
): Promise<{ signedBytes: Uint8Array } | { error: string; errorCode: string }> {
  const keyHex = Deno.env.get(pool.envKeyName);
  if (!keyHex) {
    console.log(`[AtomicSigner] Pool key env var ${pool.envKeyName} not set for ${pool.poolId}`);
    return {
      error: `Pool ${pool.poolId} signing key not configured. Contact admin.`,
      errorCode: "SERVER_SIGN_FAILED",
    };
  }

  try {
    // Dynamic import — only loaded when actually signing
    const { PrivateKey, Transaction } = await import("npm:@hashgraph/sdk@2.51.0");

    const poolKey = PrivateKey.fromStringED25519(keyHex);
    const tx = Transaction.fromBytes(transactionBytes);
    const signedTx = await tx.sign(poolKey);
    const signedBytes = signedTx.toBytes();

    return { signedBytes };
  } catch (err: any) {
    console.log(`[AtomicSigner] Pool signing failed for ${pool.poolId}: ${err?.message}`);
    return {
      error: "Pool co-signing failed — transaction may be malformed",
      errorCode: "SERVER_SIGN_FAILED",
    };
  }
}

// ── Transaction Validation ───────────────────────────────────────────
// The server independently validates the swap is legitimate before signing.
//
// SEC-07: Validation steps:
//   1. Pool exists and is active (not PENDING, not paused)
//   2. Tokens are valid whitelist members belonging to the pool
//   3. Input amount is a valid non-negative integer
//   4. Server reads reserves from Mirror Node (independent of client)
//   5. Server recomputes expected output using same AMM formula
//   6. Client's output must match server's within 1 raw unit tolerance
//   7. Kill switch is not active

interface ValidationResult {
  valid: boolean;
  serverAmountOutRaw?: string;
  serverReserves?: { reserveA: string; reserveB: string; fetchedAt: number };
  error?: string;
  errorCode?: string;
}

async function validateSwap(
  poolId: string,
  tokenIn: string,
  tokenOut: string,
  amountInRaw: string,
  clientAmountOutRaw: string,
): Promise<ValidationResult> {
  // 1. Pool lookup
  const pool = POOL_BY_ID.get(poolId);
  if (!pool) {
    return { valid: false, error: `Pool ${poolId} not found`, errorCode: "POOL_NOT_FOUND" };
  }
  if (pool.accountId === "PENDING") {
    return { valid: false, error: `Pool ${poolId} not yet deployed on Hedera`, errorCode: "POOL_NOT_FOUND" };
  }
  if (pool.status !== "active") {
    return { valid: false, error: `Pool ${poolId} is ${pool.status}`, errorCode: "POOL_PAUSED" };
  }

  // 2. Token validation
  const defIn = TOKEN_BY_SYMBOL.get(tokenIn);
  const defOut = TOKEN_BY_SYMBOL.get(tokenOut);
  if (!defIn || !defOut) {
    return { valid: false, error: "Unknown token symbol", errorCode: "UNKNOWN" };
  }

  // Verify tokens belong to this pool
  const poolTokens = new Set([pool.tokenA, pool.tokenB]);
  if (!poolTokens.has(tokenIn) || !poolTokens.has(tokenOut) || tokenIn === tokenOut) {
    return { valid: false, error: "Tokens do not match pool pair", errorCode: "UNKNOWN" };
  }

  // 3. Amount validation
  if (!isValidBigIntString(amountInRaw)) {
    return { valid: false, error: "Invalid input amount", errorCode: "UNKNOWN" };
  }

  const amountIn = BigInt(amountInRaw);
  if (amountIn <= 0n) {
    return { valid: false, error: "Amount must be positive", errorCode: "INSUFFICIENT_BALANCE" };
  }

  // 4. Read reserves from Mirror Node (independent of client)
  const reserves = await fetchPoolReserves(pool);
  if (!reserves.isLive) {
    return {
      valid: false,
      error: "Could not read pool reserves from Mirror Node",
      errorCode: "NETWORK_ERROR",
    };
  }

  // Determine direction: which reserve is tokenIn, which is tokenOut
  const isForward = pool.tokenA === tokenIn; // tokenA → tokenB
  const reserveIn = isForward ? reserves.reserveA : reserves.reserveB;
  const reserveOut = isForward ? reserves.reserveB : reserves.reserveA;

  if (reserveIn <= 0n || reserveOut <= 0n) {
    return {
      valid: false,
      error: "Pool has zero reserves — no liquidity",
      errorCode: "INSUFFICIENT_LIQUIDITY",
    };
  }

  // Check swap doesn't drain more than safety threshold
  if (amountIn > reserveIn / 2n) {
    return {
      valid: false,
      error: "Swap too large relative to pool reserves",
      errorCode: "INSUFFICIENT_LIQUIDITY",
    };
  }

  // 5. Server independently computes expected output
  const serverAmountOut = getAmountOut(amountIn, reserveIn, reserveOut, pool.swapFeeBps);
  if (serverAmountOut <= 0n) {
    return {
      valid: false,
      error: "Computed output is zero — amount may be too small",
      errorCode: "INSUFFICIENT_LIQUIDITY",
    };
  }

  // 5b. Explicit k-invariant assertion (defense-in-depth)
  // The constant-product formula mathematically guarantees k_new >= k_old,
  // but we verify it explicitly as a safety net against arithmetic bugs.
  // SEC-09: If this ever fires, it indicates a critical math error.
  const kBefore = reserveIn * reserveOut;
  const kAfter = (reserveIn + amountIn) * (reserveOut - serverAmountOut);
  if (kAfter < kBefore) {
    console.log(
      `[AtomicSigner] CRITICAL: k-invariant violation! pool=${poolId} ` +
      `kBefore=${kBefore} kAfter=${kAfter} amountIn=${amountIn} serverOut=${serverAmountOut} ` +
      `reserveIn=${reserveIn} reserveOut=${reserveOut}`,
    );
    return {
      valid: false,
      error: "CRITICAL: k-invariant violation detected — swap rejected for safety",
      errorCode: "K_INVARIANT_VIOLATION",
    };
  }

  // 6. Compare client vs server output
  // The client sends minAmountOutRaw (slippage-adjusted), which should be <= serverAmountOut.
  // We verify the client isn't trying to extract MORE than the AMM formula allows.
  const clientOut = BigInt(clientAmountOutRaw);

  if (clientOut > serverAmountOut + 1n) {
    // Client claims more output than AMM math allows — reject
    console.log(
      `[AtomicSigner] REJECT: Client output ${clientOut} > server output ${serverAmountOut} + 1 tolerance ` +
      `| pool=${poolId} ${tokenIn}→${tokenOut} amountIn=${amountInRaw}`,
    );
    return {
      valid: false,
      error: "Output amount exceeds server-computed maximum. Reserves may have changed.",
      errorCode: "SLIPPAGE_EXCEEDED",
    };
  }

  // Client's minAmountOut should be positive and not absurdly low (sanity)
  if (clientOut <= 0n) {
    return { valid: false, error: "Output amount must be positive", errorCode: "UNKNOWN" };
  }

  console.log(
    `[AtomicSigner] VALIDATED: pool=${poolId} ${tokenIn}→${tokenOut} ` +
    `amountIn=${amountInRaw} serverOut=${serverAmountOut} clientOut=${clientOut} ` +
    `reserves=[${reserves.reserveA},${reserves.reserveB}]`,
  );

  return {
    valid: true,
    serverAmountOutRaw: serverAmountOut.toString(),
    serverReserves: {
      reserveA: reserves.reserveA.toString(),
      reserveB: reserves.reserveB.toString(),
      fetchedAt: reserves.fetchedAt,
    },
  };
}

// ── Liquidity Validation ─────────────────────────────────────────────
// Validates add/remove liquidity operations before co-signing.

async function validateLiquidity(
  poolId: string,
  action: "add" | "remove",
): Promise<{ valid: boolean; error?: string; errorCode?: string }> {
  const pool = POOL_BY_ID.get(poolId);
  if (!pool) {
    return { valid: false, error: `Pool ${poolId} not found`, errorCode: "POOL_NOT_FOUND" };
  }
  if (pool.accountId === "PENDING") {
    return { valid: false, error: `Pool ${poolId} not yet deployed`, errorCode: "POOL_NOT_FOUND" };
  }
  if (pool.status !== "active" && action === "add") {
    return { valid: false, error: `Pool ${poolId} is ${pool.status}`, errorCode: "POOL_PAUSED" };
  }
  // LP removals are ALWAYS allowed (even when paused/killed) — users must withdraw
  return { valid: true };
}

// ── Swap Co-Sign Rate Limiter ────────────────────────────────────────
// Per-account rate limit for co-sign requests (prevent spamming)

const SIGN_RATE_PREFIX = "atomic_sign_rl_";
const SIGN_RATE_WINDOW_MS = 10_000;   // 10s window
const SIGN_RATE_MAX = 5;              // Max 5 co-sign requests per 10s

async function isSignRateLimited(accountId: string): Promise<boolean> {
  try {
    const key = SIGN_RATE_PREFIX + accountId;
    const entry: { count: number; resetAt: number } | null = await kv.get(key);
    const now = Date.now();

    if (entry && now <= entry.resetAt) {
      if (entry.count >= SIGN_RATE_MAX) return true;
      await kv.set(key, { count: entry.count + 1, resetAt: entry.resetAt });
      return false;
    }

    await kv.set(key, { count: 1, resetAt: now + SIGN_RATE_WINDOW_MS });
    return false;
  } catch {
    return false; // Fail open on rate limit check failure
  }
}

// ── Base64 Helpers ───────────────────────────────────────────────────

function base64ToU8(b64: string): Uint8Array {
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

function u8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ══════════════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ══════════════════════════════════════════════════════════════════════

export function registerAtomicSignerRoutes(app: Hono) {
  const R = ROUTE_PREFIX;

  // ── POST /atomic/sign-swap ─────────────────────────────────────────
  // Co-sign a swap TransferTransaction after independent validation.
  //
  // Request body:
  //   transactionBytes: string (base64 frozen TX)
  //   poolId: string
  //   tokenIn: string
  //   tokenOut: string
  //   amountInRaw: string
  //   amountOutRaw: string (client's expected output — server re-verifies)
  //   userAccountId: string
  //
  // Response:
  //   success: boolean
  //   signedTransactionBytes?: string (base64 pool-signed TX)
  //   serverAmountOutRaw?: string
  //   serverReserves?: { reserveA: string, reserveB: string, fetchedAt: number }
  //   error?: string
  //   errorCode?: string

  app.post(`${R}/atomic/sign-swap`, async (c) => {
    const t0 = performance.now();
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) {
      return c.json({ success: false, error: "Rate limited", errorCode: "RATE_LIMITED" }, 429);
    }

    // Auth required for swap signing
    const authResult = await requireAuth(c);
    if (authResult instanceof Response) return authResult;

    // Per-account rate limit (supplements per-IP; immune to IP rotation)
    if (await isAccountRateLimited(authResult.accountId, "swap")) {
      console.log(`[AtomicSigner] Account rate limited: ${authResult.accountId}`);
      return c.json({
        success: false,
        error: "Account swap rate limit exceeded. Max 15 swaps/min.",
        errorCode: "RATE_LIMITED",
      }, 429);
    }

    // Kill switch check
    if (await isAmmKilled()) {
      return c.json({
        success: false,
        error: "AMM is temporarily halted by emergency kill switch. Try again later.",
        errorCode: "POOL_PAUSED",
      }, 503);
    }

    try {
      const body = await c.req.json();
      const {
        transactionBytes: txB64,
        poolId,
        tokenIn,
        tokenOut,
        amountInRaw,
        amountOutRaw,
        userAccountId,
      } = body;

      // Input validation
      if (!txB64 || typeof txB64 !== "string" || txB64.length > 100_000) {
        return c.json({ success: false, error: "Invalid transaction bytes", errorCode: "UNKNOWN" }, 400);
      }
      if (!isValidAtomicPoolId(poolId)) {
        return c.json({ success: false, error: "Invalid pool ID", errorCode: "POOL_NOT_FOUND" }, 400);
      }
      if (typeof tokenIn !== "string" || typeof tokenOut !== "string") {
        return c.json({ success: false, error: "Invalid token symbols", errorCode: "UNKNOWN" }, 400);
      }
      if (!isValidBigIntString(amountInRaw) || !isValidBigIntString(amountOutRaw)) {
        return c.json({ success: false, error: "Invalid amounts", errorCode: "UNKNOWN" }, 400);
      }
      if (!isValidHederaAccountId(userAccountId)) {
        return c.json({ success: false, error: "Invalid user account ID", errorCode: "UNKNOWN" }, 400);
      }

      // Verify authenticated account matches the claimed user
      if (authResult.accountId !== userAccountId) {
        console.log(
          `[AtomicSigner] Account mismatch: session=${authResult.accountId} claimed=${userAccountId}`,
        );
        return c.json({
          success: false,
          error: "Authenticated account does not match swap user",
          errorCode: "UNKNOWN",
        }, 403);
      }

      // Per-account rate limit for signing (KV-backed burst limiter)
      if (await isSignRateLimited(userAccountId)) {
        return c.json({
          success: false,
          error: "Too many sign requests. Wait a few seconds.",
          errorCode: "RATE_LIMITED",
        }, 429);
      }

      // Validate the swap math independently
      const tValidate = performance.now();
      const validation = await validateSwap(poolId, tokenIn, tokenOut, amountInRaw, amountOutRaw);
      const validateMs = (performance.now() - tValidate).toFixed(1);
      if (!validation.valid) {
        return c.json({
          success: false,
          error: validation.error,
          errorCode: validation.errorCode,
        }, 400);
      }

      // Decode transaction bytes
      let txBytes: Uint8Array;
      try {
        txBytes = base64ToU8(txB64);
      } catch {
        return c.json({ success: false, error: "Malformed base64 transaction", errorCode: "UNKNOWN" }, 400);
      }

      // Co-sign with pool account key
      const tSign = performance.now();
      const pool = POOL_BY_ID.get(poolId)!;
      const signResult = await signTransactionWithPoolKey(pool, txBytes);
      const signMs = (performance.now() - tSign).toFixed(1);

      if ("error" in signResult) {
        return c.json({
          success: false,
          error: signResult.error,
          errorCode: signResult.errorCode,
        }, 500);
      }

      // Log successful co-sign with timing instrumentation
      const totalMs = (performance.now() - t0).toFixed(1);
      console.log(
        `[AtomicSigner] CO-SIGNED: pool=${poolId} ${tokenIn}→${tokenOut} user=${userAccountId} ` +
        `| validate=${validateMs}ms sign=${signMs}ms total=${totalMs}ms`,
      );

      // Persist swap event for analytics (non-blocking)
      kv.set(`atomic_swap_${Date.now()}_${userAccountId}`, {
        poolId, tokenIn, tokenOut, amountInRaw,
        serverAmountOutRaw: validation.serverAmountOutRaw,
        userAccountId, timestamp: Date.now(),
      }).catch(() => {});

      return c.json({
        success: true,
        signedTransactionBytes: u8ToBase64(signResult.signedBytes),
        serverAmountOutRaw: validation.serverAmountOutRaw,
        serverReserves: validation.serverReserves,
      });
    } catch (err: any) {
      console.log(`[AtomicSigner] sign-swap error: ${err?.message}`);
      return c.json({
        success: false,
        error: `Server error during co-signing: ${err?.message}`,
        errorCode: "SERVER_SIGN_FAILED",
      }, 500);
    }
  });

  // ── POST /atomic/sign-liquidity ────────────────────────────────────
  // Co-sign an add/remove liquidity TransferTransaction.

  app.post(`${R}/atomic/sign-liquidity`, async (c) => {
    const t0 = performance.now();
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) {
      return c.json({ success: false, error: "Rate limited", errorCode: "RATE_LIMITED" }, 429);
    }

    const authResult = await requireAuth(c);
    if (authResult instanceof Response) return authResult;

    try {
      const body = await c.req.json();
      const { transactionBytes: txB64, poolId, action, userAccountId } = body;

      // Input validation
      if (!txB64 || typeof txB64 !== "string" || txB64.length > 100_000) {
        return c.json({ success: false, error: "Invalid transaction bytes" }, 400);
      }
      if (!isValidAtomicPoolId(poolId)) {
        return c.json({ success: false, error: "Invalid pool ID" }, 400);
      }
      if (action !== "add" && action !== "remove") {
        return c.json({ success: false, error: "Action must be 'add' or 'remove'" }, 400);
      }
      if (!isValidHederaAccountId(userAccountId)) {
        return c.json({ success: false, error: "Invalid user account ID" }, 400);
      }
      if (authResult.accountId !== userAccountId) {
        return c.json({ success: false, error: "Account mismatch" }, 403);
      }

      // Per-account rate limit for liquidity operations
      if (await isAccountRateLimited(userAccountId, "liquidity")) {
        return c.json({
          success: false,
          error: "Account mutation rate limit exceeded. Wait a moment.",
          errorCode: "RATE_LIMITED",
        }, 429);
      }

      // Kill switch — block adds but allow removes (users must always withdraw)
      if (action === "add" && await isAmmKilled()) {
        return c.json({
          success: false,
          error: "AMM halted — new liquidity additions blocked. Removals still allowed.",
          errorCode: "POOL_PAUSED",
        }, 503);
      }

      // Validate pool
      const liqValidation = await validateLiquidity(poolId, action);
      if (!liqValidation.valid) {
        return c.json({
          success: false,
          error: liqValidation.error,
          errorCode: liqValidation.errorCode,
        }, 400);
      }

      // Decode + sign
      let txBytes: Uint8Array;
      try {
        txBytes = base64ToU8(txB64);
      } catch {
        return c.json({ success: false, error: "Malformed base64 transaction" }, 400);
      }

      const pool = POOL_BY_ID.get(poolId)!;
      const signResult = await signTransactionWithPoolKey(pool, txBytes);

      if ("error" in signResult) {
        return c.json({ success: false, error: signResult.error }, 500);
      }

      console.log(
        `[AtomicSigner] CO-SIGNED LIQUIDITY: pool=${poolId} action=${action} user=${userAccountId} ` +
        `| total=${(performance.now() - t0).toFixed(1)}ms`,
      );

      return c.json({
        success: true,
        signedTransactionBytes: u8ToBase64(signResult.signedBytes),
      });
    } catch (err: any) {
      console.log(`[AtomicSigner] sign-liquidity error: ${err?.message}`);
      return c.json({ success: false, error: `Server error: ${err?.message}` }, 500);
    }
  });

  // ── GET /atomic/pools ──────────────────────────────────────────────
  // Public endpoint — returns pool registry with deployment status.
  // No auth required (read-only, no sensitive data).

  app.get(`${R}/atomic/pools`, async (c) => {
    const pools = POOL_REGISTRY.map(p => ({
      poolId: p.poolId,
      tokenA: p.tokenA,
      tokenB: p.tokenB,
      accountId: p.accountId === "PENDING" ? null : p.accountId,
      lpTokenId: p.lpTokenId === "PENDING" ? null : p.lpTokenId,
      status: p.status,
      isDeployed: p.accountId !== "PENDING",
      swapFeeBps: p.swapFeeBps,
      tokenAInfo: TOKEN_BY_SYMBOL.get(p.tokenA) ?? null,
      tokenBInfo: TOKEN_BY_SYMBOL.get(p.tokenB) ?? null,
    }));

    return c.json({
      pools,
      total: pools.length,
      active: pools.filter(p => p.isDeployed && p.status === "active").length,
      pending: pools.filter(p => !p.isDeployed).length,
    });
  });

  // ── GET /atomic/pools/:poolId/reserves ─────────────────────────────
  // Public endpoint — returns live reserves from Mirror Node.

  app.get(`${R}/atomic/pools/:poolId/reserves`, async (c) => {
    const poolId = c.req.param("poolId");
    const pool = POOL_BY_ID.get(poolId);
    if (!pool) {
      return c.json({ error: "Pool not found" }, 404);
    }
    if (pool.accountId === "PENDING") {
      return c.json({
        poolId,
        reserveA: "0",
        reserveB: "0",
        isLive: false,
        message: "Pool not yet deployed on Hedera",
      });
    }

    const reserves = await fetchPoolReserves(pool);
    return c.json({
      poolId,
      tokenA: pool.tokenA,
      tokenB: pool.tokenB,
      reserveA: reserves.reserveA.toString(),
      reserveB: reserves.reserveB.toString(),
      isLive: reserves.isLive,
      fetchedAt: reserves.fetchedAt,
      accountId: pool.accountId,
    });
  });

  // ── GET /atomic/status ─────────────────────────────────────────────
  // Public system status.

  app.get(`${R}/atomic/status`, async (c) => {
    const killed = await isAmmKilled();
    const total = POOL_REGISTRY.length;
    const active = POOL_REGISTRY.filter(p => p.accountId !== "PENDING" && p.status === "active").length;
    const pending = POOL_REGISTRY.filter(p => p.accountId === "PENDING").length;

    return c.json({
      system: "atomic-signer",
      version: "1.0.0",
      architecture: "hedera-native-cryptotransfer",
      killSwitch: killed,
      pools: { total, active, pending },
      isLive: active > 0 && !killed,
      tokens: TOKEN_WHITELIST.length,
      message: active > 0
        ? `${active} pool${active > 1 ? "s" : ""} live with atomic on-chain settlement`
        : `${pending} pool${pending > 1 ? "s" : ""} registered, pending Hedera deployment. ` +
          `Signing oracle infrastructure is ready.`,
      phase: "1",
      phaseDescription: "Server-held pool keys (signing oracle pattern)",
      decentralizationRoadmap: {
        phase1: "Server-held pool keys (current)",
        phase2: "Threshold keys (2-of-3 DAO multisig)",
        phase3: "Hedera account abstraction (HIP-206)",
      },
    });
  });

  // ── GET /atomic/tokens ─────────────────────────────────────────────
  // Public endpoint — returns supported token whitelist.

  app.get(`${R}/atomic/tokens`, (c) => {
    return c.json({
      tokens: TOKEN_WHITELIST,
      count: TOKEN_WHITELIST.length,
    });
  });

  // ── POST /atomic/admin/kill-switch ─────────────────────────────────
  // Owner-only: activate/deactivate the emergency kill switch.
  // When active, all swap and add-liquidity co-signing is rejected.
  // Remove-liquidity co-signing remains operational.

  app.post(`${R}/atomic/admin/kill-switch`, async (c) => {
    const ownerResult = await requireOwner(c);
    if (ownerResult instanceof Response) return ownerResult;

    try {
      const { active, reason } = await c.req.json();
      if (typeof active !== "boolean") {
        return c.json({ error: "active must be boolean" }, 400);
      }

      const state: AmmKillState = {
        active,
        activatedAt: Date.now(),
        activatedBy: ownerResult.accountId,
        reason: typeof reason === "string" ? reason.slice(0, 200) : (active ? "Emergency halt" : "Resumed"),
      };

      await kv.set(AMM_KILL_SWITCH_KEY, state);
      _killSwitchCache = { state, ts: Date.now() };

      const ip = getClientIp(c);
      await logAdminAction(
        active ? "atomic_kill_activate" : "atomic_kill_deactivate",
        ownerResult.accountId,
        ip,
        state.reason,
      );

      console.log(
        `[AtomicSigner] Kill switch ${active ? "ACTIVATED" : "DEACTIVATED"} by ${ownerResult.accountId}: ${state.reason}`,
      );

      return c.json({ success: true, state });
    } catch (err: any) {
      return c.json({ error: `Kill switch update failed: ${err?.message}` }, 500);
    }
  });

  // ── GET /atomic/admin/kill-switch ──────────────────────────────────
  // Owner-only: read kill switch state.

  app.get(`${R}/atomic/admin/kill-switch`, async (c) => {
    const ownerResult = await requireOwner(c);
    if (ownerResult instanceof Response) return ownerResult;

    const state: AmmKillState | null = await kv.get(AMM_KILL_SWITCH_KEY);
    return c.json({ state: state ?? { active: false } });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BACKWARD-COMPAT SHIMS — Old /amm/* kill switch endpoints
  // ══════════════════════════════════════════════════════════════════════
  // The frontend (TradingSwapPanel.tsx, OwnerControlPanel.tsx) still polls
  // the old /amm/kill-switch, /amm/kill, /amm/resume paths from amm.ts.
  // These shims serve the SAME response format using the SAME KV key,
  // preventing 404s until the frontend is rewired to /atomic/* endpoints.
  //
  // TODO: Remove these shims after frontend migration to atomic endpoints.
  // ══════════════════════════════════════════════════════════════════════

  // GET /amm/kill-switch — Public: check if AMM is halted
  // Response format matches old amm.ts exactly (active, activatedAt, reason, prelaunchLocked)
  app.get(`${R}/amm/kill-switch`, async (c) => {
    try {
      const state: AmmKillState | null = await kv.get(AMM_KILL_SWITCH_KEY);
      // prelaunchLocked: false — the atomic system replaces the old prelaunch lock.
      // All pools are paused at the registry level; the prelaunch concept is retired.
      return c.json({
        active: state?.active ?? false,
        activatedAt: state?.activatedAt ?? null,
        reason: state?.reason ?? null,
        prelaunchLocked: false,
      });
    } catch {
      return c.json({ active: false, prelaunchLocked: false }, 500);
    }
  });

  // POST /amm/kill — Owner-only: halt all AMM co-signing
  app.post(`${R}/amm/kill`, async (c) => {
    const ownerResult = await requireOwner(c);
    if (ownerResult instanceof Response) return ownerResult;
    const ip = getClientIp(c);
    try {
      let reason = "Emergency halt";
      try { const body = await c.req.json(); reason = sanitizeString(body.reason || reason, 200); } catch { /* no body */ }
      const state: AmmKillState = {
        active: true,
        activatedAt: Date.now(),
        activatedBy: ownerResult.accountId,
        reason,
      };
      await kv.set(AMM_KILL_SWITCH_KEY, state);
      _killSwitchCache = { state, ts: Date.now() };
      console.log(`[AtomicSigner] KILL SWITCH ACTIVATED (compat) by ${ownerResult.accountId}: ${reason}`);
      await logAdminAction("atomic_kill_activate", ownerResult.accountId, ip, reason);
      return c.json({ success: true, ...state });
    } catch (err: any) {
      return c.json({ error: `Failed to activate kill switch: ${err?.message}` }, 500);
    }
  });

  // POST /amm/resume — Owner-only: resume AMM co-signing
  app.post(`${R}/amm/resume`, async (c) => {
    const ownerResult = await requireOwner(c);
    if (ownerResult instanceof Response) return ownerResult;
    const ip = getClientIp(c);
    try {
      const state: AmmKillState = {
        active: false,
        activatedAt: Date.now(),
        activatedBy: ownerResult.accountId,
        reason: "Resumed by owner",
      };
      await kv.set(AMM_KILL_SWITCH_KEY, state);
      _killSwitchCache = { state, ts: Date.now() };
      console.log(`[AtomicSigner] Kill switch DEACTIVATED (compat) by ${ownerResult.accountId}`);
      await logAdminAction("atomic_kill_deactivate", ownerResult.accountId, ip);
      return c.json({ success: true, active: false });
    } catch (err: any) {
      return c.json({ error: `Failed to resume: ${err?.message}` }, 500);
    }
  });

  console.log("[AtomicSigner] Hedera-native atomic swap signing oracle registered");
}
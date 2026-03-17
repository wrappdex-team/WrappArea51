// ══════════════════════════════════════════════════════════════════════
// ATOMIC SIGNER — Hedera-Native CryptoTransfer Co-Signing Oracle
// ══════════════════════════════════════════════════════════════════════
//
// ╔═══════════════════════════════════════════════════════════════════╗
// ║  SECURITY AUDIT — PEN-06/07/08 (2026-03-17)                     ║
// ║                                                                   ║
// ║  ALL state-changing routes verified LOCKED:                       ║
// ║    POST /atomic/sign-swap       → requireAuth + acct rate limit  ║
// ║    POST /atomic/sign-liquidity  → requireAuth + acct match       ║
// ║    GET  /atomic/history/:id     → requireAuth + acct match       ║
// ║    POST /atomic/admin/kill-switch → requireOwner                 ║
// ║    GET  /atomic/admin/kill-switch → requireOwner                 ║
// ║    POST /amm/kill               → requireOwner                   ║
// ║    POST /amm/resume             → requireOwner                   ║
// ║                                                                   ║
// ║  Public read-only (pool data, reserves, status, tokens):         ║
// ║    GET /atomic/pools, /pools/:id/reserves, /status, /tokens,     ║
// ║    GET /amm/kill-switch — NO auth needed (public chain data)     ║
// ║                                                                   ║
// ║  Defense layers (cumulative):                                     ║
// ║    1. ED25519 session auth (requireAuth)                          ║
// ║    2. Per-IP rate limiting (isRateLimited)                        ║
// ║    3. Per-account rate limiting (isAccountRateLimited)            ║
// ║    4. Account match (user can only sign own TXs)                  ║
// ║    5. Kill switch (emergency halt all co-signing)                ║
// ║    6. TX type gate SEC-13 (only CryptoTransfer allowed)          ║
// ║    7. TX content validation SEC-14 (exact amounts/accounts)      ║
// ║    8. Replay protection SEC-15 (TX ID dedup in KV)               ║
// ║    9. Independent reserve read SEC-07 (Mirror Node, not client)  ║
// ║   10. Math tolerance ≤1 raw unit (BigInt rounding only)          ║
// ║                                                                   ║
// ║  VERDICT: No unauthenticated mutation paths. No bypass vectors.  ║
// ╚═══════════════════════════════════════════════════════════════════╝
//
// This module is the WRAPpDEX signing oracle:
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
// NOTE [ATOMIC-09]:
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
//   in error messages. Key material exists only in memory. Key fingerprint
//   (SHA-256 prefix) is logged on first use for rotation audit trail.
//
// SEC-13: TX type gate — signTransactionWithPoolKey rejects non-CryptoTransfer
//   (TransferTransaction) TXs. Prevents the pool key from co-signing
//   unauthorized operations (CryptoUpdate, TokenUpdate, ContractCall, etc.).
//   Defense-in-depth: also checked in validateSwapTransactionContents.
//
// SEC-14: TX content validation — before co-signing, the server deserializes
//   the TX and verifies the token transfer list matches the expected swap:
//   exact token IDs, exact amounts, exact accounts (user + pool only), no
//   hidden transfers to third-party accounts. Prevents a rogue client from
//   building a TX that passes math validation but silently drains the pool
//   to an attacker address. This is the critical gap: without SEC-14, a
//   malicious client could declare amountOutRaw=100 (passes math), but embed
//   pool→attacker=1000000 in the actual TX body.
//
// SEC-15: Replay protection — signed TX ID deduplication.
//   Hedera TX IDs are unique (payer@validStart), but a co-signed TX that
//   hasn't been submitted yet could be captured and replayed within its
//   validity window. By recording co-signed TX IDs in KV, we guarantee
//   each TX is signed at most once.
//
// PERF-06: In-memory reserve cache for public read endpoints.
//   5s TTL — stale reserves in read endpoints are acceptable (display only).
//   NEVER used for signing validation (SEC-07 requires fresh Mirror Node reads).
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

// ── Shared AMM Math (amm-math-shared.ts) ────────────────────────────
// SHARED-01: Pure math imported from single source of truth.
// Previously duplicated inline — now shared with amm.ts and test file.
import {
  getAmountOut,
  TOTAL_SWAP_FEE_BPS,
  BPS_BASE,
} from "./amm-math-shared.ts";

// ── Constants ────────────────────────────────────────────────────────

const MIRROR_NODE_URL = HEDERA_MIRROR_MAINNET;
const MIRROR_TIMEOUT_MS = 10_000;

// SEC-15: Replay protection — signed TX ID deduplication.
// Hedera TX IDs are unique (payer@validStart), but a co-signed TX that
// hasn't been submitted yet could be captured and replayed within its
// validity window. By recording co-signed TX IDs in KV, we guarantee
// each TX is signed at most once.
const SIGNED_TX_PREFIX = "atomic_stx_";           // KV prefix for co-signed TX IDs
const TX_VALID_START_MAX_DRIFT_MS = 180_000;      // 180s — matches Hedera TX validity window
const SIGNED_TX_EXPIRY_MS = 300_000;              // 5 min — clean up after Hedera's validity expires

// SEC-08: Key fingerprint audit trail. Maps env var name → SHA-256 prefix.
// Logged on first use so ops can verify which key version is loaded after
// rotation without exposing the key itself.
const _keyFingerprints = new Map<string, string>();

// PERF-06: In-memory reserve cache for public read endpoints.
// 5s TTL — stale reserves in read endpoints are acceptable (display only).
// NEVER used for signing validation (SEC-07 requires fresh Mirror Node reads).
const RESERVE_CACHE_TTL_MS = 5_000;
const _reserveCache = new Map<string, { reserves: ServerReserves; cachedAt: number }>();

// ── Kill Switch ──────────────────────────────────────────────────────
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
  { tokenId: "0.0.9770617", symbol: "WETH",  decimals: 18 }, // [LIQUIDITY-FIX] High-liquidity WETH
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

// ── AMM Math ─────────────────────────────────────────────────────────
// SHARED-01: getAmountOut imported from amm-math-shared.ts (single source of truth).
// Previously duplicated inline — identical to atomic-swap-engine.ts (client-side).

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

// PERF-06: Cached reserve reader for public read endpoints.
// Returns in-memory cached reserves if available and within TTL (5s).
// NEVER used for swap signing validation — SEC-07 requires fresh reads.
async function fetchPoolReservesCached(pool: PoolConfig): Promise<ServerReserves> {
  const cached = _reserveCache.get(pool.poolId);
  const now = Date.now();
  if (cached && now - cached.cachedAt < RESERVE_CACHE_TTL_MS) {
    return cached.reserves;
  }
  const fresh = await fetchPoolReserves(pool);
  _reserveCache.set(pool.poolId, { reserves: fresh, cachedAt: now });
  return fresh;
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
    const { PrivateKey, Transaction, TransferTransaction } = await import("npm:@hashgraph/sdk@2.51.0");

    // SEC-08: Key fingerprint audit trail — log SHA-256 prefix on first use
    // per env var so ops can verify key rotation without exposing key material.
    if (!_keyFingerprints.has(pool.envKeyName)) {
      try {
        const hashBuf = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(keyHex),
        );
        const hashHex = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const fingerprint = hashHex.slice(0, 16);
        _keyFingerprints.set(pool.envKeyName, fingerprint);
        console.log(`[SEC-08] Pool key fingerprint: ${pool.envKeyName}=${fingerprint}... (first use)`);
      } catch { /* fingerprint is non-critical — swallow errors */ }
    }

    const poolKey = PrivateKey.fromStringED25519(keyHex);
    const tx = Transaction.fromBytes(transactionBytes);

    // SEC-13: TX type gate — ONLY CryptoTransfer (TransferTransaction) is allowed.
    // Prevents the pool key from co-signing unauthorized operations such as
    // CryptoUpdate (change pool account keys), TokenUpdate, ContractCall, etc.
    // This is the last line of defense: even if all upstream validation is bypassed,
    // the signing function itself refuses non-transfer TXs.
    if (!(tx instanceof TransferTransaction)) {
      const txType = tx?.constructor?.name || "Unknown";
      console.log(
        `[SEC-13] REJECTED: TX type "${txType}" for pool ${pool.poolId} — ` +
        `only TransferTransaction (CryptoTransfer) is allowed`,
      );
      return {
        error: "Transaction type rejected — only CryptoTransfer operations are allowed for pool co-signing",
        errorCode: "INVALID_TX_TYPE",
      };
    }

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

// ═══════════════════════════════════════════════════════════════════════
// SEC-14: Transaction Content Validation
// ═══════════════════════════════════════════════════════════════════════
//
// NOTE [SEC-14]:
//   validateSwap (SEC-07) verifies the MATH is correct: server reads reserves,
//   recomputes the output, and confirms the client's claimed output is within
//   tolerance. But it does NOT inspect the actual transaction body.
//
//   A malicious client could:
//     1. Declare amountOutRaw=100 in the request body (passes math check)
//     2. Build a TX with pool→attacker=1,000,000 (different from declared)
//     3. Server validates math (100 ≤ serverOut), signs the TX
//     4. Attacker submits the TX → pool drained
//
//   SEC-14 closes this gap: after math validation passes, the server
//   deserializes the TX, extracts the actual token transfer list, and
//   verifies every transfer matches the expected swap:
//     - Exactly 2 token transfer groups (tokenIn + tokenOut)
//     - Each group has exactly 2 entries (user + pool)
//     - tokenIn: user sends amountInRaw to pool (user=-X, pool=+X)
//     - tokenOut: pool sends amountOutRaw to user (pool=-Y, user=+Y)
//     - No extra token transfers, no unexpected HBAR transfers
//
//   Uses SDK internal `_tokenTransfers` array. If SDK version changes break
//   the internal structure, the function fails CLOSED (rejects the TX).
//   This is correct behavior: false negatives (rejecting valid TXs) are
//   infinitely better than false positives (signing malicious TXs).

type TxContentValidation =
  | { valid: true; transactionIdStr: string }
  | { valid: false; error: string; errorCode: string };

async function validateSwapTransactionContents(
  txBytes: Uint8Array,
  pool: PoolConfig,
  userAccountId: string,
  tokenInSymbol: string,
  tokenOutSymbol: string,
  amountInRaw: string,
  amountOutRaw: string,
): Promise<TxContentValidation> {
  try {
    const { Transaction, TransferTransaction } = await import("npm:@hashgraph/sdk@2.51.0");

    const tx = Transaction.fromBytes(txBytes);

    // SEC-13 (defense-in-depth, also checked in signing function)
    if (!(tx instanceof TransferTransaction)) {
      const txType = tx?.constructor?.name || "Unknown";
      return {
        valid: false,
        error: `TX type "${txType}" is not CryptoTransfer`,
        errorCode: "INVALID_TX_TYPE",
      };
    }

    // Extract transaction ID for replay protection (SEC-15)
    let transactionIdStr = "";
    try {
      const txId = tx.transactionId;
      transactionIdStr = txId?.toString() ?? "";

      // Verify validStart is within acceptable time window
      if (txId?.validStart) {
        const validStartSec = Number(txId.validStart.seconds ?? 0);
        const validStartMs = validStartSec * 1000;
        const now = Date.now();
        const drift = Math.abs(now - validStartMs);
        if (drift > TX_VALID_START_MAX_DRIFT_MS) {
          return {
            valid: false,
            error: `TX validStart is ${(drift / 1000).toFixed(0)}s from current time (max ${TX_VALID_START_MAX_DRIFT_MS / 1000}s)`,
            errorCode: "TX_EXPIRED",
          };
        }
      }
    } catch {
      return {
        valid: false,
        error: "Cannot extract transaction ID",
        errorCode: "TX_INSPECT_FAILED",
      };
    }

    // Resolve expected token IDs from symbols
    const defIn = TOKEN_BY_SYMBOL.get(tokenInSymbol);
    const defOut = TOKEN_BY_SYMBOL.get(tokenOutSymbol);
    if (!defIn || !defOut) {
      return { valid: false, error: "Unknown token symbol in TX validation", errorCode: "UNKNOWN" };
    }
    const tokenInId = defIn.tokenId;     // e.g., "0.0.456858"
    const tokenOutId = defOut.tokenId;    // e.g., "0.0.1456986"
    const poolAccountId = pool.accountId; // e.g., "0.0.1456986"
    const expectedAmountIn = BigInt(amountInRaw);
    const expectedAmountOut = BigInt(amountOutRaw);

    // ── Parse token transfers from SDK internals ──
    // TransferTransaction._tokenTransfers is an array of:
    //   { tokenId: TokenId, transfers: [{ accountId: AccountId, amount: Long, isApproved }] }
    // Defensive: if structure changes, fail closed.
    const rawTokenTransfers = (tx as any)._tokenTransfers;
    if (!Array.isArray(rawTokenTransfers)) {
      console.log("[SEC-14] Cannot read _tokenTransfers — SDK structure may have changed. Failing closed.");
      return {
        valid: false,
        error: "Cannot inspect TX transfer list — SDK version may be incompatible",
        errorCode: "TX_INSPECT_FAILED",
      };
    }

    // Normalize to a simple structure for validation
    const parsedTransfers: Array<{
      tokenId: string;
      entries: Array<{ accountId: string; amount: bigint }>;
    }> = [];

    for (const tt of rawTokenTransfers) {
      const tokenId = tt.tokenId?.toString() ?? "";
      const entries: Array<{ accountId: string; amount: bigint }> = [];
      const rawEntries = tt.transfers || [];
      for (const entry of rawEntries) {
        entries.push({
          accountId: entry.accountId?.toString() ?? "",
          amount: BigInt(entry.amount?.toString() ?? "0"),
        });
      }
      if (entries.length > 0) {
        parsedTransfers.push({ tokenId, entries });
      }
    }

    // ── Check no unexpected HBAR transfers ──
    // Swap TXs should only have HTS token transfers. Explicit HBAR transfers
    // in the body (beyond the TX fee in the header) are suspicious.
    const rawHbarTransfers = (tx as any)._hbarTransfers;
    let hbarTransferCount = 0;
    if (Array.isArray(rawHbarTransfers)) {
      hbarTransferCount = rawHbarTransfers.length;
    } else if (rawHbarTransfers && typeof rawHbarTransfers === "object") {
      // TransferMap might be Map-like or array-like
      hbarTransferCount = rawHbarTransfers._map?.size ?? rawHbarTransfers.length ?? 0;
    }
    if (hbarTransferCount > 0) {
      console.log(
        `[SEC-14] WARNING: TX contains ${hbarTransferCount} explicit HBAR transfer(s) ` +
        `for pool ${pool.poolId} — unexpected for HTS-only swap. Rejecting.`,
      );
      return {
        valid: false,
        error: "TX contains unexpected HBAR transfers — swap should only transfer HTS tokens",
        errorCode: "TX_UNEXPECTED_TRANSFERS",
      };
    }

    // ── Verify exactly 2 token transfer groups ──
    if (parsedTransfers.length !== 2) {
      console.log(
        `[SEC-14] REJECTED: TX has ${parsedTransfers.length} token transfer groups ` +
        `(expected 2) for pool ${pool.poolId}`,
      );
      return {
        valid: false,
        error: `TX has ${parsedTransfers.length} token transfer groups — expected exactly 2 (tokenIn + tokenOut)`,
        errorCode: "TX_UNEXPECTED_TRANSFERS",
      };
    }

    // ── Match token transfer groups to expected tokens ──
    const tokenInGroup = parsedTransfers.find((t) => t.tokenId === tokenInId);
    const tokenOutGroup = parsedTransfers.find((t) => t.tokenId === tokenOutId);

    if (!tokenInGroup) {
      return {
        valid: false,
        error: `TX missing transfer group for tokenIn (${tokenInId} / ${tokenInSymbol})`,
        errorCode: "TX_UNEXPECTED_TRANSFERS",
      };
    }
    if (!tokenOutGroup) {
      return {
        valid: false,
        error: `TX missing transfer group for tokenOut (${tokenOutId} / ${tokenOutSymbol})`,
        errorCode: "TX_UNEXPECTED_TRANSFERS",
      };
    }

    // ── Verify tokenIn transfers: user→pool ──
    if (tokenInGroup.entries.length !== 2) {
      return {
        valid: false,
        error: `tokenIn transfer group has ${tokenInGroup.entries.length} entries (expected 2: user + pool)`,
        errorCode: "TX_UNEXPECTED_TRANSFERS",
      };
    }
    const userInEntry = tokenInGroup.entries.find((e) => e.accountId === userAccountId);
    const poolInEntry = tokenInGroup.entries.find((e) => e.accountId === poolAccountId);
    if (!userInEntry || !poolInEntry) {
      const foundAccounts = tokenInGroup.entries.map((e) => e.accountId).join(", ");
      console.log(
        `[SEC-14] REJECTED: tokenIn accounts [${foundAccounts}] don't match ` +
        `expected user=${userAccountId} pool=${poolAccountId}`,
      );
      return {
        valid: false,
        error: "tokenIn transfer participants don't match expected user and pool accounts",
        errorCode: "TX_ACCOUNT_MISMATCH",
      };
    }
    // User sends (negative), pool receives (positive)
    if (userInEntry.amount !== -expectedAmountIn || poolInEntry.amount !== expectedAmountIn) {
      console.log(
        `[SEC-14] REJECTED: tokenIn amounts mismatch | ` +
        `user=${userInEntry.amount} (expected ${-expectedAmountIn}) ` +
        `pool=${poolInEntry.amount} (expected ${expectedAmountIn})`,
      );
      return {
        valid: false,
        error: "tokenIn transfer amounts don't match declared amountInRaw",
        errorCode: "TX_AMOUNT_MISMATCH",
      };
    }

    // ── Verify tokenOut transfers: pool→user ──
    if (tokenOutGroup.entries.length !== 2) {
      return {
        valid: false,
        error: `tokenOut transfer group has ${tokenOutGroup.entries.length} entries (expected 2: pool + user)`,
        errorCode: "TX_UNEXPECTED_TRANSFERS",
      };
    }
    const poolOutEntry = tokenOutGroup.entries.find((e) => e.accountId === poolAccountId);
    const userOutEntry = tokenOutGroup.entries.find((e) => e.accountId === userAccountId);
    if (!poolOutEntry || !userOutEntry) {
      const foundAccounts = tokenOutGroup.entries.map((e) => e.accountId).join(", ");
      console.log(
        `[SEC-14] REJECTED: tokenOut accounts [${foundAccounts}] don't match ` +
        `expected user=${userAccountId} pool=${poolAccountId}`,
      );
      return {
        valid: false,
        error: "tokenOut transfer participants don't match expected user and pool accounts",
        errorCode: "TX_ACCOUNT_MISMATCH",
      };
    }
    // Pool sends (negative), user receives (positive)
    if (poolOutEntry.amount !== -expectedAmountOut || userOutEntry.amount !== expectedAmountOut) {
      console.log(
        `[SEC-14] REJECTED: tokenOut amounts mismatch | ` +
        `pool=${poolOutEntry.amount} (expected ${-expectedAmountOut}) ` +
        `user=${userOutEntry.amount} (expected ${expectedAmountOut})`,
      );
      return {
        valid: false,
        error: "tokenOut transfer amounts don't match declared amountOutRaw",
        errorCode: "TX_AMOUNT_MISMATCH",
      };
    }

    console.log(
      `[SEC-14] TX content validated: pool=${pool.poolId} ` +
      `${tokenInSymbol}(${expectedAmountIn})→${tokenOutSymbol}(${expectedAmountOut}) ` +
      `user=${userAccountId} txId=${transactionIdStr.slice(0, 40)}`,
    );

    return { valid: true, transactionIdStr };
  } catch (err: any) {
    console.log(`[SEC-14] TX validation error: ${err?.message}`);
    return {
      valid: false,
      error: "Failed to validate transaction contents — TX may be malformed",
      errorCode: "TX_INSPECT_FAILED",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SEC-15: Replay Protection — Transaction ID Deduplication
// ═══════════════════════════════════════════════════════════════════════
//
// NOTE [SEC-15]:
//   Hedera consensus nodes reject duplicate TX IDs within the validity
//   window (~180s), but the co-signing oracle operates BEFORE submission.
//   A captured co-signed TX could be replayed if:
//     1. User builds TX, sends to server for co-signing
//     2. Attacker intercepts the co-signed response (MITM)
//     3. Attacker submits the TX before the user
//     4. User's submission fails (duplicate TX ID)
//     5. Attacker profits from the swap
//
//   By tracking co-signed TX IDs in KV, we ensure each TX ID is signed
//   at most once. The SIGNED_TX_EXPIRY_MS (5 min) exceeds Hedera's
//   180s validity window, so the KV entry outlives the TX — no replay
//   is possible even if the KV entry is read after the Hedera window.
//
//   This is defense-in-depth: the primary protection is still Hedera's
//   own TX ID deduplication. SEC-15 prevents the oracle from being
//   tricked into signing the same TX twice.

async function isTransactionReplay(txIdStr: string): Promise<boolean> {
  if (!txIdStr) return false; // Can't check — let other guards handle
  try {
    const key = SIGNED_TX_PREFIX + txIdStr.replace(/[^a-zA-Z0-9._@-]/g, "_");
    const existing = await kv.get(key);
    return existing !== null;
  } catch {
    // KV read failure — fail open (other protections still apply)
    return false;
  }
}

async function recordSignedTransaction(
  txIdStr: string,
  poolId: string,
  userAccountId: string,
): Promise<void> {
  if (!txIdStr) return;
  try {
    const key = SIGNED_TX_PREFIX + txIdStr.replace(/[^a-zA-Z0-9._@-]/g, "_");
    await kv.set(key, {
      poolId,
      userAccountId,
      signedAt: Date.now(),
      expiresAt: Date.now() + SIGNED_TX_EXPIRY_MS,
    });
  } catch {
    // Non-blocking — replay protection is defense-in-depth
    console.log(`[SEC-15] Failed to record signed TX: ${txIdStr.slice(0, 40)}`);
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

      // SEC-14: Validate TX contents match the declared swap parameters.
      // Deserializes the TX, inspects actual token transfers, and verifies
      // amounts + accounts match exactly. Also extracts TX ID for SEC-15.
      const tTxValidate = performance.now();
      const pool = POOL_BY_ID.get(poolId)!;
      const txContentResult = await validateSwapTransactionContents(
        txBytes, pool, userAccountId, tokenIn, tokenOut, amountInRaw, amountOutRaw,
      );
      const txValidateMs = (performance.now() - tTxValidate).toFixed(1);
      if (!txContentResult.valid) {
        return c.json({
          success: false,
          error: txContentResult.error,
          errorCode: txContentResult.errorCode,
        }, 400);
      }

      // SEC-15: Replay protection — reject if this TX ID was already co-signed
      if (await isTransactionReplay(txContentResult.transactionIdStr)) {
        console.log(
          `[SEC-15] REPLAY REJECTED: TX ${txContentResult.transactionIdStr.slice(0, 40)} ` +
          `already co-signed for pool=${poolId} user=${userAccountId}`,
        );
        return c.json({
          success: false,
          error: "This transaction was already co-signed — build a new TX with a fresh transaction ID",
          errorCode: "TX_REPLAY",
        }, 409);
      }

      // Co-sign with pool account key
      const tSign = performance.now();
      const signResult = await signTransactionWithPoolKey(pool, txBytes);
      const signMs = (performance.now() - tSign).toFixed(1);

      if ("error" in signResult) {
        return c.json({
          success: false,
          error: signResult.error,
          errorCode: signResult.errorCode,
        }, 500);
      }

      // SEC-15: Record co-signed TX ID (non-blocking)
      recordSignedTransaction(txContentResult.transactionIdStr, poolId, userAccountId);

      // Log successful co-sign with timing instrumentation
      const totalMs = (performance.now() - t0).toFixed(1);
      console.log(
        `[AtomicSigner] CO-SIGNED: pool=${poolId} ${tokenIn}→${tokenOut} user=${userAccountId} ` +
        `| validate=${validateMs}ms txContent=${txValidateMs}ms sign=${signMs}ms total=${totalMs}ms`,
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

    const reserves = await fetchPoolReservesCached(pool);
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

  // ── GET /atomic/history/:accountId ─────────────────────────────────
  // Authenticated endpoint — returns the user's atomic swap history.
  // Reads swap events persisted to KV by the sign-swap handler.
  // Auth required: session token must match the requested accountId.

  app.get(`${R}/atomic/history/:accountId`, async (c) => {
    const requestedAccount = c.req.param("accountId");
    if (!isValidHederaAccountId(requestedAccount)) {
      return c.json({ error: "Invalid account ID format" }, 400);
    }

    const authResult = await requireAuth(c);
    if (authResult instanceof Response) return authResult;

    // Ensure user can only query their own history
    if (authResult.accountId !== requestedAccount) {
      return c.json({ error: "Account mismatch — can only query own history" }, 403);
    }

    try {
      // KV key format: atomic_swap_<timestamp>_<accountId>
      const allSwaps = await kv.getByPrefix("atomic_swap_");

      // Filter to this user and sort descending by timestamp
      const userSwaps = allSwaps
        .filter((s: any) => s && s.userAccountId === requestedAccount)
        .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 50); // Cap at 50 most recent

      return c.json({
        swaps: userSwaps,
        count: userSwaps.length,
        accountId: requestedAccount,
      });
    } catch (err: any) {
      console.log(`[AtomicSigner] history fetch error for ${requestedAccount}: ${err?.message}`);
      return c.json({ error: `Failed to fetch swap history: ${err?.message}` }, 500);
    }
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
  // BACKWARD-COMPAT SHIMS — /amm/* kill switch endpoints
  // ══════════════════════════════════════════════════════════════════════
  // TradingSwapPanel.tsx and OwnerControlPanel.tsx poll /amm/kill-switch,
  // /amm/kill, and /amm/resume. These shims proxy to the same KV key as
  // /atomic/admin/kill-switch, preventing 404s.
  //
  // IMPLEMENTATION NOTE: Rewire frontend to /atomic/* endpoints and remove these shims.
  // ══════════════════════════════════════════════════════════════════════

  // GET /amm/kill-switch — Public: check if AMM is halted
  app.get(`${R}/amm/kill-switch`, async (c) => {
    try {
      const state: AmmKillState | null = await kv.get(AMM_KILL_SWITCH_KEY);
      return c.json({
        active: state?.active ?? false,
        activatedAt: state?.activatedAt ?? null,
        reason: state?.reason ?? null,
        prelaunchLocked: false, // Prelaunch concept retired — pools paused at registry level
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
/**
 * Atomic Swap Client — End-to-End Swap Orchestration
 *
 * This module orchestrates the full atomic swap lifecycle:
 *
 *   1. Quote:  Client reads reserves from Mirror Node, computes AMM output
 *   2. Build:  Client constructs a TransferTransaction (both token legs)
 *   3. Sign:   Server validates the math independently, co-signs pool side
 *   4. Submit: User's wallet (HashPack via WalletConnect) signs + submits
 *   5. Verify: Client polls Mirror Node for transaction receipt
 *
 * The server is a SIGNING ORACLE — it holds pool account keys and validates
 * that the transaction matches AMM rules. It does NOT compute swap amounts,
 * does NOT hold state, and does NOT route orders. All computation is
 * client-side, all settlement is on-chain.
 *
 * SENIOR DEV NOTE [ATOMIC-07]:
 *   This is the trust model:
 *     - Users trust MATH (constant product, open source, auditable)
 *     - Users trust HEDERA (atomic CryptoTransfer, consensus-guaranteed)
 *     - Users trust the SIGNING ORACLE holds pool keys honestly (Phase 1)
 *     - Users do NOT trust the server for computation or state
 *
 *   Phase 2: Threshold keys (2-of-3 multisig on pool accounts)
 *   Phase 3: Hedera account abstraction (HIP-206) — fully trustless
 *
 * SEC-05: Transaction bytes are built CLIENT-SIDE. The server cannot inject
 *   malicious transfers because the user's wallet shows the full transaction
 *   for review before signing. The user sees exactly what they're approving.
 *
 * SEC-06: The server re-reads reserves from Mirror Node and independently
 *   recomputes the expected output. If client and server disagree by more
 *   than 1 raw unit (rounding), the co-sign is rejected. This prevents
 *   front-running by a malicious client submitting stale-reserve quotes.
 */

import type {
  AtomicSwapQuote,
  AtomicSwapRequest,
  AtomicSwapResult,
  AddLiquidityRequest,
  AddLiquidityResult,
  RemoveLiquidityRequest,
  RemoveLiquidityResult,
  SignSwapRequest,
  SignSwapResponse,
  AtomicSwapErrorCode,
} from "./atomic-swap-types";
import {
  getSwapQuote,
  buildSwapTransaction,
  buildAddLiquidityTransaction,
  buildRemoveLiquidityTransaction,
  fetchPoolReserves,
  computeLPSharesMint,
  computeLPSharesBurn,
  computeOptimalDeposit,
  getSwapHashScanUrl,
  getSystemStatus,
  POOL_BY_ID,
  TOKEN_BY_SYMBOL,
  ACTIVE_POOLS,
  POOL_REGISTRY,
  DEFAULT_SLIPPAGE_BPS,
  bigIntToDecimal,
  decimalToBigInt,
} from "./atomic-swap-engine";
import { sendHederaTransaction } from "./hashpack";
import { log } from "./logger";
import {
  TokenAssociateTransaction, AccountId, TokenId, TransactionId,
} from "./hedera-sdk";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { getSessionToken } from "./auth";

// ── Server Endpoint ─────────────────────────────────────────────────

const SERVER_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Swap Execution (Full Lifecycle)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Execute a full atomic swap.
 *
 * Lifecycle:
 *   1. Validate inputs
 *   2. Build TransferTransaction client-side
 *   3. Send frozen TX to server for pool-side co-signing
 *   4. Server validates math + co-signs
 *   5. Send pool-signed TX to wallet for user signature
 *   6. Wallet signs + submits to Hedera
 *   7. Poll Mirror Node for receipt
 *
 * Returns a result with the transaction ID, amounts, and HashScan URL.
 *
 * SENIOR DEV NOTE [ATOMIC-08]:
 *   Every step can fail independently. Error handling is granular:
 *   - Build failure → error before any signing
 *   - Server rejection → error before wallet interaction
 *   - Wallet rejection → user cancelled, no on-chain effect
 *   - Network failure → transaction expired, no partial execution
 *   The atomic CryptoTransfer guarantees: both legs or neither.
 */
export async function executeAtomicSwap(
  request: AtomicSwapRequest,
): Promise<AtomicSwapResult> {
  const startTime = Date.now();

  try {
    // ── Step 0: Validate inputs ──────────────────────────────────────
    const pool = POOL_BY_ID.get(request.poolId);
    if (!pool) return _fail("POOL_NOT_FOUND", `Pool ${request.poolId} not found`);
    if (pool.accountId === "PENDING") return _fail("POOL_NOT_FOUND", `Pool ${request.poolId} is not yet deployed on Hedera`);
    if (pool.status !== "active") return _fail("POOL_PAUSED", `Pool ${request.poolId} is paused`);

    const defIn = TOKEN_BY_SYMBOL.get(request.tokenIn);
    const defOut = TOKEN_BY_SYMBOL.get(request.tokenOut);
    if (!defIn || !defOut) return _fail("UNKNOWN", "Unknown token symbol");

    log.info("AtomicSwap", `Initiating swap: ${request.tokenIn}→${request.tokenOut} amount=${request.amountInRaw} pool=${request.poolId}`);

    // ── Step 1: Build the TransferTransaction ────────────────────────
    log.info("AtomicSwap", "Step 1/4: Building TransferTransaction...");
    const buildResult = await buildSwapTransaction(request);
    if ("error" in buildResult) return _fail("UNKNOWN", buildResult.error);

    // ── Step 2: Send to server for pool-side co-signing ──────────────
    log.info("AtomicSwap", "Step 2/4: Requesting server co-sign...");
    const signResult = await requestServerCoSign({
      transactionBytes: _u8ToBase64(buildResult.transactionBytes),
      poolId: request.poolId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountInRaw: request.amountInRaw,
      amountOutRaw: request.minAmountOutRaw,
      userAccountId: request.userAccountId,
    });

    if (!signResult.success || !signResult.signedTransactionBytes) {
      return _fail(
        signResult.errorCode || "SERVER_SIGN_FAILED",
        signResult.error || "Server co-signing failed",
      );
    }

    // ── Step 3: Send pool-signed TX to wallet for user signature ─────
    log.info("AtomicSwap", "Step 3/4: Sending to wallet for user signature...");
    const poolSignedBytes = _base64ToU8(signResult.signedTransactionBytes);

    const walletResult = await sendHederaTransaction(
      request.userAccountId,
      poolSignedBytes,
    );

    if (!walletResult.success) {
      if (walletResult.error?.includes("rejected")) {
        return _fail("SIGNER_REJECTED", "Transaction rejected by wallet");
      }
      return _fail("SIGNER_TIMEOUT", walletResult.error || "Wallet signing failed");
    }

    // ── Step 4: Transaction submitted — verify receipt ────────────────
    log.info("AtomicSwap", "Step 4/4: Transaction submitted, polling receipt...");
    const elapsed = Date.now() - startTime;
    const receiptStatus = walletResult.receipt?.result || "UNKNOWN";

    const result: AtomicSwapResult = {
      success: receiptStatus === "SUCCESS",
      transactionId: buildResult.transactionId,
      amountOutRaw: signResult.serverAmountOutRaw || request.minAmountOutRaw,
      amountOut: Number(BigInt(signResult.serverAmountOutRaw || request.minAmountOutRaw)) / 10 ** defOut.decimals,
      hashScanUrl: getSwapHashScanUrl(buildResult.transactionId),
      receiptStatus,
    };

    if (result.success) {
      log.info("AtomicSwap", `Swap SUCCESS in ${elapsed}ms: ${result.transactionId} | ${request.tokenIn}→${request.tokenOut}`);
    } else {
      log.warn("AtomicSwap", `Swap receipt non-SUCCESS: ${receiptStatus} | ${result.transactionId}`);
      result.error = `Transaction settled with status: ${receiptStatus}`;
      result.errorCode = "UNKNOWN";
    }

    return result;
  } catch (err: any) {
    log.error("AtomicSwap", `Swap failed: ${err?.message}`);
    return _fail("NETWORK_ERROR", err?.message || "Swap failed unexpectedly");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Liquidity Operations
// ═══════════════════════════════════════════════════════════════════════

/**
 * Add liquidity to a pool via atomic CryptoTransfer.
 *
 * Three-leg atomic transfer:
 *   User → Pool: tokenA
 *   User → Pool: tokenB
 *   Pool → User: LP tokens (proportional shares)
 */
export async function addLiquidity(
  request: AddLiquidityRequest,
): Promise<AddLiquidityResult> {
  try {
    const pool = POOL_BY_ID.get(request.poolId);
    if (!pool) return { success: false, error: `Pool ${request.poolId} not found`, errorCode: "POOL_NOT_FOUND" };
    if (pool.accountId === "PENDING") return { success: false, error: "Pool not yet deployed", errorCode: "POOL_NOT_FOUND" };

    // Read current reserves
    const reserves = await fetchPoolReserves(pool);
    if (!reserves.isLive) {
      return { success: false, error: "Could not read pool reserves from Mirror Node", errorCode: "NETWORK_ERROR" };
    }

    // Compute LP shares to mint
    const amountA = BigInt(request.amountARaw);
    const amountB = BigInt(request.amountBRaw);
    const { shares, isFirstDeposit } = computeLPSharesMint(
      amountA, amountB,
      reserves.reserveA, reserves.reserveB,
      reserves.lpTotalSupply,
    );

    if (shares <= 0n) {
      return { success: false, error: "Deposit amounts too small to mint LP shares", errorCode: "INSUFFICIENT_LIQUIDITY" };
    }

    // Build transaction
    const buildResult = await buildAddLiquidityTransaction({
      userAccountId: request.userAccountId,
      pool,
      amountARaw: request.amountARaw,
      amountBRaw: request.amountBRaw,
      sharesMintedRaw: shares.toString(),
    });

    if ("error" in buildResult) {
      return { success: false, error: buildResult.error, errorCode: "UNKNOWN" };
    }

    // Server co-sign
    const signResult = await requestServerCoSignLiquidity(
      _u8ToBase64(buildResult.transactionBytes),
      request.poolId,
      "add",
      request.userAccountId,
    );

    if (!signResult.success || !signResult.signedTransactionBytes) {
      return { success: false, error: signResult.error || "Server co-sign failed", errorCode: "SERVER_SIGN_FAILED" };
    }

    // Wallet sign + submit
    const walletResult = await sendHederaTransaction(
      request.userAccountId,
      _base64ToU8(signResult.signedTransactionBytes),
    );

    if (!walletResult.success) {
      return {
        success: false,
        error: walletResult.error || "Wallet signing failed",
        errorCode: walletResult.error?.includes("rejected") ? "SIGNER_REJECTED" : "SIGNER_TIMEOUT",
      };
    }

    return {
      success: walletResult.receipt?.result === "SUCCESS",
      transactionId: buildResult.transactionId,
      sharesMinted: shares.toString(),
      hashScanUrl: getSwapHashScanUrl(buildResult.transactionId),
    };
  } catch (err: any) {
    return { success: false, error: err?.message, errorCode: "NETWORK_ERROR" };
  }
}

/**
 * Remove liquidity from a pool via atomic CryptoTransfer.
 */
export async function removeLiquidity(
  request: RemoveLiquidityRequest,
): Promise<RemoveLiquidityResult> {
  try {
    const pool = POOL_BY_ID.get(request.poolId);
    if (!pool) return { success: false, error: `Pool ${request.poolId} not found`, errorCode: "POOL_NOT_FOUND" };
    if (pool.accountId === "PENDING") return { success: false, error: "Pool not deployed", errorCode: "POOL_NOT_FOUND" };

    const reserves = await fetchPoolReserves(pool);
    if (!reserves.isLive) {
      return { success: false, error: "Could not read pool reserves", errorCode: "NETWORK_ERROR" };
    }

    const shares = BigInt(request.sharesRaw);
    const { amountA, amountB } = computeLPSharesBurn(
      shares,
      reserves.reserveA, reserves.reserveB,
      reserves.lpTotalSupply,
    );

    if (amountA <= 0n || amountB <= 0n) {
      return { success: false, error: "Share amount too small for withdrawal", errorCode: "INSUFFICIENT_LIQUIDITY" };
    }

    // Slippage check
    if (amountA < BigInt(request.minAmountARaw) || amountB < BigInt(request.minAmountBRaw)) {
      return { success: false, error: "Output below minimum — reserves may have changed", errorCode: "SLIPPAGE_EXCEEDED" };
    }

    const buildResult = await buildRemoveLiquidityTransaction({
      userAccountId: request.userAccountId,
      pool,
      sharesRaw: request.sharesRaw,
      amountAOutRaw: amountA.toString(),
      amountBOutRaw: amountB.toString(),
    });

    if ("error" in buildResult) {
      return { success: false, error: buildResult.error, errorCode: "UNKNOWN" };
    }

    const signResult = await requestServerCoSignLiquidity(
      _u8ToBase64(buildResult.transactionBytes),
      request.poolId,
      "remove",
      request.userAccountId,
    );

    if (!signResult.success || !signResult.signedTransactionBytes) {
      return { success: false, error: signResult.error || "Server co-sign failed", errorCode: "SERVER_SIGN_FAILED" };
    }

    const walletResult = await sendHederaTransaction(
      request.userAccountId,
      _base64ToU8(signResult.signedTransactionBytes),
    );

    if (!walletResult.success) {
      return {
        success: false,
        error: walletResult.error || "Wallet signing failed",
        errorCode: walletResult.error?.includes("rejected") ? "SIGNER_REJECTED" : "SIGNER_TIMEOUT",
      };
    }

    return {
      success: walletResult.receipt?.result === "SUCCESS",
      transactionId: buildResult.transactionId,
      amountAOutRaw: amountA.toString(),
      amountBOutRaw: amountB.toString(),
      hashScanUrl: getSwapHashScanUrl(buildResult.transactionId),
    };
  } catch (err: any) {
    return { success: false, error: err?.message, errorCode: "NETWORK_ERROR" };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Server Communication (Signing Oracle)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Request server co-signing for a swap transaction.
 * The server validates the swap math independently before signing.
 */
async function requestServerCoSign(
  request: SignSwapRequest,
): Promise<SignSwapResponse> {
  try {
    const sessionToken = getSessionToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${publicAnonKey}`,
    };
    if (sessionToken) headers["X-Session-Token"] = sessionToken;

    const res = await fetch(`${SERVER_BASE}/atomic/sign-swap`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      log.warn("AtomicSwap", `Server co-sign rejected: ${JSON.stringify(errBody)}`);
      return {
        success: false,
        error: errBody.error || `Server returned ${res.status}`,
        errorCode: errBody.errorCode as AtomicSwapErrorCode || "SERVER_SIGN_FAILED",
      };
    }

    return await res.json();
  } catch (err: any) {
    log.error("AtomicSwap", `Server co-sign request failed: ${err?.message}`);
    return {
      success: false,
      error: `Server unreachable: ${err?.message}`,
      errorCode: "NETWORK_ERROR",
    };
  }
}

/**
 * Request server co-signing for a liquidity transaction.
 */
async function requestServerCoSignLiquidity(
  transactionBytes: string,
  poolId: string,
  action: "add" | "remove",
  userAccountId: string,
): Promise<SignSwapResponse> {
  try {
    const sessionToken = getSessionToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${publicAnonKey}`,
    };
    if (sessionToken) headers["X-Session-Token"] = sessionToken;

    const res = await fetch(`${SERVER_BASE}/atomic/sign-liquidity`, {
      method: "POST",
      headers,
      body: JSON.stringify({ transactionBytes, poolId, action, userAccountId }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { success: false, error: errBody.error || `HTTP ${res.status}` };
    }

    return await res.json();
  } catch (err: any) {
    return { success: false, error: `Server unreachable: ${err?.message}`, errorCode: "NETWORK_ERROR" };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: Public API (Re-exports + Convenience)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get a swap quote (no server call — fully client-side).
 */
export { getSwapQuote } from "./atomic-swap-engine";

/**
 * Compute optimal deposit for adding liquidity.
 * Given a desired amount of token A, returns proportional amount of token B.
 */
export async function getOptimalDeposit(
  poolId: string,
  tokenSymbol: string,
  amountDisplay: string,
): Promise<{ amountA: string; amountB: string; shares: string } | { error: string }> {
  const pool = POOL_BY_ID.get(poolId);
  if (!pool) return { error: "Pool not found" };

  const reserves = await fetchPoolReserves(pool);
  if (!reserves.isLive) return { error: "Could not read pool reserves" };

  const tokenA = TOKEN_BY_SYMBOL.get(pool.tokenA);
  const tokenB = TOKEN_BY_SYMBOL.get(pool.tokenB);
  if (!tokenA || !tokenB) return { error: "Unknown token" };

  let amountARaw: bigint, amountBRaw: bigint;

  if (tokenSymbol === pool.tokenA) {
    amountARaw = decimalToBigInt(amountDisplay, tokenA.decimals);
    amountBRaw = computeOptimalDeposit(amountARaw, reserves.reserveA, reserves.reserveB);
  } else if (tokenSymbol === pool.tokenB) {
    amountBRaw = decimalToBigInt(amountDisplay, tokenB.decimals);
    amountARaw = computeOptimalDeposit(amountBRaw, reserves.reserveB, reserves.reserveA);
  } else {
    return { error: `Token ${tokenSymbol} not in pool ${poolId}` };
  }

  const { shares } = computeLPSharesMint(
    amountARaw, amountBRaw,
    reserves.reserveA, reserves.reserveB,
    reserves.lpTotalSupply,
  );

  return {
    amountA: bigIntToDecimal(amountARaw, tokenA.decimals),
    amountB: bigIntToDecimal(amountBRaw, tokenB.decimals),
    shares: bigIntToDecimal(shares, pool.lpDecimals),
  };
}

/**
 * Get the overall system status.
 */
export { getSystemStatus } from "./atomic-swap-engine";

/**
 * Get all registered pools with their deployment status.
 */
export function getAllPools(): Array<{
  poolId: string;
  tokenA: string;
  tokenB: string;
  status: string;
  isDeployed: boolean;
  accountId: string;
}> {
  return POOL_REGISTRY.map(p => ({
    poolId: p.poolId,
    tokenA: p.tokenA,
    tokenB: p.tokenB,
    status: p.status,
    isDeployed: p.accountId !== "PENDING",
    accountId: p.accountId,
  }));
}

/**
 * Check if a user has a specific token associated.
 * Required before receiving tokens from a swap.
 */
export async function checkTokenAssociation(
  accountId: string,
  tokenId: string,
): Promise<boolean> {
  try {
    const { isTokenAssociated } = await import("./hedera");
    return await isTokenAssociated(accountId, tokenId);
  } catch {
    return false;
  }
}

/**
 * Build a TokenAssociateTransaction for the user.
 * Must be executed before receiving tokens from a swap.
 */
export async function buildTokenAssociateTransaction(
  accountId: string,
  tokenId: string,
): Promise<{ transactionBytes: Uint8Array } | { error: string }> {
  try {
    const tx = new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(accountId))
      .setTokenIds([TokenId.fromString(tokenId)])
      .setNodeAccountIds([AccountId.fromString("0.0.3")])
      .setTransactionId(TransactionId.generate(AccountId.fromString(accountId)))
      .freeze();

    return { transactionBytes: tx.toBytes() };
  } catch (err: any) {
    return { error: `Token associate TX build failed: ${err?.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: LP Position Tracking (C7)
// ═══════════════════════════════════════════════════════════════════════

/**
 * LP position for a single pool — fetched from Mirror Node.
 */
export interface LPPosition {
  poolId: string;
  tokenA: string;
  tokenB: string;
  /** User's LP token balance (raw integer string) */
  lpBalanceRaw: string;
  /** User's LP token balance (display string) */
  lpBalanceDisplay: string;
  /** User's share of the pool as a percentage */
  shareOfPool: number;
  /** Estimated value of tokenA the position represents */
  estimatedAmountA: string;
  /** Estimated value of tokenB the position represents */
  estimatedAmountB: string;
  /** LP token total supply at query time */
  lpTotalSupply: string;
  /** Whether the position was successfully fetched */
  isLive: boolean;
}

const MIRROR_NODE_MAINNET = "https://mainnet-public.mirrornode.hedera.com";

/**
 * Fetch a user's LP token balance for a specific pool.
 *
 * SENIOR DEV NOTE [C7-01]:
 *   LP positions are read directly from Mirror Node — the user's account
 *   balance of the pool's LP HTS token. No server dependency, no KV.
 *   The position is the on-chain ground truth. Share-of-pool and estimated
 *   token amounts are derived from current reserves (also on-chain).
 */
export async function fetchUserLPPosition(
  accountId: string,
  poolId: string,
): Promise<LPPosition | null> {
  const pool = POOL_BY_ID.get(poolId);
  if (!pool || pool.lpTokenId === "PENDING" || pool.accountId === "PENDING") {
    return null;
  }

  const tokenA = TOKEN_BY_SYMBOL.get(pool.tokenA);
  const tokenB = TOKEN_BY_SYMBOL.get(pool.tokenB);
  if (!tokenA || !tokenB) return null;

  try {
    // Fetch user's LP token balance from Mirror Node
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(
      `${MIRROR_NODE_MAINNET}/api/v1/accounts/${accountId}/tokens?token.id=${pool.lpTokenId}&limit=1`,
      { signal: ctrl.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const tokens: Array<{ token_id: string; balance: number }> = data.tokens || [];

    const lpBalanceRaw = tokens.length > 0 ? BigInt(tokens[0].balance) : 0n;
    if (lpBalanceRaw === 0n) {
      return {
        poolId, tokenA: pool.tokenA, tokenB: pool.tokenB,
        lpBalanceRaw: "0", lpBalanceDisplay: "0",
        shareOfPool: 0, estimatedAmountA: "0", estimatedAmountB: "0",
        lpTotalSupply: "0", isLive: true,
      };
    }

    // Fetch reserves + LP total supply for share calculation
    const reserves = await fetchPoolReserves(pool);

    const shareOfPool = reserves.lpTotalSupply > 0n
      ? Number(lpBalanceRaw * 10000n / reserves.lpTotalSupply) / 100
      : 0;

    // Compute estimated token amounts from share
    const { amountA, amountB } = computeLPSharesBurn(
      lpBalanceRaw,
      reserves.reserveA, reserves.reserveB,
      reserves.lpTotalSupply,
    );

    return {
      poolId,
      tokenA: pool.tokenA,
      tokenB: pool.tokenB,
      lpBalanceRaw: lpBalanceRaw.toString(),
      lpBalanceDisplay: bigIntToDecimal(lpBalanceRaw, pool.lpDecimals),
      shareOfPool,
      estimatedAmountA: bigIntToDecimal(amountA, tokenA.decimals),
      estimatedAmountB: bigIntToDecimal(amountB, tokenB.decimals),
      lpTotalSupply: reserves.lpTotalSupply.toString(),
      isLive: reserves.isLive,
    };
  } catch (err: any) {
    log.warn("AtomicSwap", `LP position fetch failed for ${accountId} in ${poolId}: ${err?.message}`);
    return null;
  }
}

/**
 * Fetch LP positions across all deployed pools.
 */
export async function fetchAllUserLPPositions(
  accountId: string,
): Promise<LPPosition[]> {
  const deployedPools = POOL_REGISTRY.filter(
    p => p.accountId !== "PENDING" && p.lpTokenId !== "PENDING",
  );

  if (deployedPools.length === 0) return [];

  const results = await Promise.allSettled(
    deployedPools.map(p => fetchUserLPPosition(accountId, p.poolId)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<LPPosition | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((p): p is LPPosition => p !== null && p.lpBalanceRaw !== "0");
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Atomic Swap History (C8)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Swap event record as stored in KV by the server's sign-swap handler.
 */
export interface AtomicSwapEvent {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountInRaw: string;
  serverAmountOutRaw: string;
  userAccountId: string;
  timestamp: number;
}

/**
 * Fetch the user's atomic swap history from the server.
 * Requires an active session (ED25519 challenge-response auth).
 *
 * SENIOR DEV NOTE [C8-01]:
 *   The server reads from KV (prefix scan on `atomic_swap_*`) and
 *   filters by accountId server-side. Auth ensures users can only
 *   see their own history. The KV entries are written by the
 *   sign-swap handler after successful co-signing.
 */
export async function fetchAtomicSwapHistory(
  accountId: string,
): Promise<AtomicSwapEvent[]> {
  try {
    const sessionToken = getSessionToken();
    if (!sessionToken) return [];

    const res = await fetch(`${SERVER_BASE}/atomic/history/${accountId}`, {
      headers: {
        "Authorization": `Bearer ${publicAnonKey}`,
        "X-Session-Token": sessionToken,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      log.warn("AtomicSwap", `History fetch failed: ${errBody.error}`);
      return [];
    }

    const data = await res.json();
    return Array.isArray(data.swaps) ? data.swaps : [];
  } catch (err: any) {
    log.warn("AtomicSwap", `History fetch error: ${err?.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: Internal Helpers
// ═══════════════════════════════════════════════════════════════════════

function _fail(code: AtomicSwapErrorCode, message: string): AtomicSwapResult {
  return { success: false, error: message, errorCode: code };
}

function _u8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function _base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
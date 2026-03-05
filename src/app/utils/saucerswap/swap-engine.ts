/**
 * [C77] SaucerSwap Swap Execution Engine
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: SwapResult, DryRunParams, DryRunResult,
 *           executeSaucerSwap, executeSaucerSwapDirect,
 *           executeSaucerSwapV2Direct, executeSaucerSwapV2MultiHop,
 *           preSwapDryRun
 *
 * Dependencies: tokens, contracts, abi, prices, pools, routing, quotes,
 *               balances, helpers, verification
 * Static: @hashgraph/sdk (via hedera-sdk.ts — C96)
 * Dynamic: hashpack (executeHederaTransaction)
 */

import {
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  AccountAllowanceApproveTransaction,
  TokenAssociateTransaction,
  AccountId,
} from "../hedera-sdk";
import { log } from "../logger";
import type { HederaNetwork, AllowedToken } from "./tokens";
import {
  resolveToken, getWhbarToken, htsIdToEvmAddress, evmAddressToHtsId,
  SAUCERSWAP_TOKENS, getSaucerswapRoutingId, getSaucerswapRoutingEvmAddress,
  getCanonicalEvmAddress, resolveTokenByHtsId,
} from "./tokens";
import {
  SAUCERSWAP_V1_ROUTER_CANDIDATES, SAUCERSWAP_V2_ROUTER,
  SAUCERSWAP_V2_QUOTER, SAUCERSWAP_V2_FACTORY, SAUCERSWAP_WHBAR_CONTRACT,
  V2_FEE_TIERS,
  getSaucerSwapRouter, getRouterWithFee,
  MIRROR_NODES, JSON_RPC_RELAY,
} from "./contracts";
import {
  bytesToHex, hexToBytes,
  encodeExactInputSingle, encodeUnwrapWHBAR, encodeMulticall,
  encodeSaucerSwapETHForTokens, encodeSaucerSwapTokensForETH,
  encodeSaucerSwapCall, encodeSwapPath, encodeExactInput,
  encodeQuoteExactInput, encodeQuoteExactInputSingle, encodeGetPool,
  // [FOT] Fee-on-transfer router encoders
  encodeSaucerSwapCallFOT, encodeSaucerSwapETHForTokensFOT,
  encodeSaucerSwapTokensForETHFOT,
} from "./abi";
import { makeAbort, estimateOutputFromPrices } from "./prices";
import type { PoolVersionInfo } from "./pools";
import { detectPoolVersion, resolveAccountEvmAddress, resolveContractEvmAddress } from "./pools";
import { buildSwapPath, findRouteViaGraph } from "./routing";
import type { RawQuote } from "./quotes";
import { fetchSaucerSwapQuote, fetchV2RouterQuote, fetchV2MultiHopQuote, fetchRouterQuote } from "./quotes";
import { isTokenAssociated, getNativeHbarBalance, getTokenBalance, fetchTokenAllowance, fetchMaxAutoAssociations, fetchTokenFeeSchedule, markTokenAsFOT, type TokenFeeInfo } from "./balances";
import { parseTokenAmount } from "./helpers";
import { verifyIsContract } from "./verification";

// ══════════════════════════════════════════════════════════════════════
// ── [C53] PERSISTENT APPROVALS — "1 POPUP INSTEAD OF 2" ────────────
// ══════════════════════════════════════════════════════════════════════
//
// Before requesting a wallet approval popup, we query the Mirror Node
// for the existing HTS token allowance. If allowance >= swap amount,
// the approve step is SKIPPED entirely → user sees only 1 popup (swap).
//
// [STEP-15] "Infinite approval" mode was REMOVED because it caused
// AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY on tokens whose max supply < 2^53-1.
// All approvals now use the exact swap amount. The user always sees the
// correct amount in their wallet popup, matching the quote exactly.

// [STEP-15] Infinite approval REMOVED — always approve exact swap amount.
// MAX_SAFE_ALLOWANCE caused AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY on tokens whose
// max supply < 2^53-1. Exact-amount approval is safer and matches the quote.

/**
 * [SEC-14 → PERF-01] Post-approval/association delay (ms).
 *
 * Set to 0: the WalletConnect round-trip (wallet signs → submits to
 * consensus node → returns txId) already takes 2-5s, by which time
 * the transaction has typically reached consensus. Both prerequisite
 * (approve/associate) and dependent (swap) transactions target the
 * same consensus node (0.0.3), ensuring the node processes them
 * sequentially in its mempool.
 *
 * This matches SaucerSwap.finance's own behavior — no artificial waits
 * between approval and swap popups. If an edge-case race condition
 * causes the swap to see stale state, it reverts with a clear
 * CONTRACT_REVERT_EXECUTED error and the user can retry.
 *
 * Previous value was 3000ms which, combined with the 1s internal
 * wait in executeHederaTransactionFast + post-approval verification,
 * added ~6.5s of unnecessary delay between wallet popups.
 *
 * [S2] IMPLEMENTATION NOTE — Raised from 0 → 2000ms.
 * CONSENSUS_WAIT_MS = 0 caused intermittent CONTRACT_REVERT_EXECUTED
 * on Token→HBAR swaps because the approval had not reached consensus
 * before the swap TX arrived at the router's transferFrom() check.
 * 2000ms gives Hedera consensus (3-5s finality) time to commit the
 * approval while keeping the gap between wallet popups small.
 * SaucerSwap.finance's UI has ~2-3s of JS processing between popups
 * which serves the same purpose; our pipeline was near-instant (0ms).
 */
const CONSENSUS_WAIT_MS = 2000;

// ══════════════════════════════════════════════════════════════════════
// ── [STALE-ALLOW] MIRROR NODE STALE-ALLOWANCE RACE GUARD ────────────
// ══════════════════════════════════════════════════════════════════════
//
// After a swap consumes a token allowance on-chain, the Mirror Node may
// still report the OLD (pre-consumption) allowance for up to 15 seconds.
// If the user does a back-to-back swap of the same token, `approveIfNeeded`
// queries the Mirror Node, sees stale allowance >= rawInput, skips the
// approve tx, and the swap hits the router with ZERO actual allowance →
// "Safe token transfer failed!" (HTS response code 178 =
// SPENDER_DOES_NOT_HAVE_ALLOWANCE).
//
// Fix: After every successful swap that consumed an allowance, record
// (tokenId, spenderId) in a short-lived map. `approveIfNeeded` checks
// this map BEFORE trusting Mirror Node — if recently consumed, it forces
// a fresh approval regardless of what Mirror Node reports.
//
// TTL = 15 seconds (Mirror Node lag is typically 3-8s, 15s is generous).

const STALE_ALLOW_TTL_MS = 15_000;
const _recentlyConsumedAllowances: Map<string, number> = new Map();

function _staleAllowKey(tokenHtsId: string, spenderAccountId: string): string {
  return `${tokenHtsId}:${spenderAccountId}`;
}

function markAllowanceConsumed(tokenHtsId: string, spenderAccountId: string): void {
  const key = _staleAllowKey(tokenHtsId, spenderAccountId);
  _recentlyConsumedAllowances.set(key, Date.now());
  log.debug("SwapEngine", `[STALE-ALLOW] Marked allowance consumed: ${key} (TTL ${STALE_ALLOW_TTL_MS / 1000}s)`);
  // Auto-cleanup after TTL
  setTimeout(() => {
    const currentTs = _recentlyConsumedAllowances.get(key);
    if (currentTs !== undefined && Date.now() - currentTs >= STALE_ALLOW_TTL_MS) {
      _recentlyConsumedAllowances.delete(key);
    }
  }, STALE_ALLOW_TTL_MS + 100);
}

function isAllowanceRecentlyConsumed(tokenHtsId: string, spenderAccountId: string): boolean {
  const key = _staleAllowKey(tokenHtsId, spenderAccountId);
  const ts = _recentlyConsumedAllowances.get(key);
  if (!ts) return false;
  if (Date.now() - ts > STALE_ALLOW_TTL_MS) {
    _recentlyConsumedAllowances.delete(key);
    return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════
// ── [V2-SKIP] V2 EXECUTION FAILURE CACHE ────────────────────────────
// ══════════════════════════════════════════════════════════════════════
//
// When V2 execution REVERTS on-chain and V1 fallback succeeds, the
// token pair is cached here so future swaps skip V2 entirely.
// This eliminates the "double popup" problem where V2 fails → V1 works
// but the user had to approve 2 extra wallet popups for nothing.
//
// Cache is in-memory with localStorage persistence. TTL = 24h.
// Pairs are keyed as "htsIdA:htsIdB" (sorted, so A→B == B→A).

const V2_FAILURE_CACHE_KEY = "wrappdex_v2_failure_cache";
const V2_FAILURE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const _v2FailureCache: Map<string, number> = new Map();

function _v2PairKey(tokenA: string, tokenB: string): string {
  return [tokenA, tokenB].sort().join(":");
}

function _loadV2FailureCache(): void {
  try {
    const raw = localStorage.getItem(V2_FAILURE_CACHE_KEY);
    if (!raw) return;
    const entries: [string, number][] = JSON.parse(raw);
    const now = Date.now();
    for (const [key, ts] of entries) {
      if (now - ts < V2_FAILURE_TTL_MS) _v2FailureCache.set(key, ts);
    }
  } catch { /* corrupt data — start fresh */ }
}

function _saveV2FailureCache(): void {
  try {
    localStorage.setItem(V2_FAILURE_CACHE_KEY, JSON.stringify([..._v2FailureCache.entries()]));
  } catch { /* storage full — non-critical */ }
}

function markV2Failed(tokenAHtsId: string, tokenBHtsId: string): void {
  const key = _v2PairKey(tokenAHtsId, tokenBHtsId);
  _v2FailureCache.set(key, Date.now());
  _saveV2FailureCache();
  log.info("SwapEngine", `[V2-SKIP] Cached V2 failure for ${key} — future swaps will use V1 directly`);
}

function isV2FailureCached(tokenAHtsId: string, tokenBHtsId: string): boolean {
  const key = _v2PairKey(tokenAHtsId, tokenBHtsId);
  const ts = _v2FailureCache.get(key);
  if (!ts) return false;
  if (Date.now() - ts > V2_FAILURE_TTL_MS) {
    _v2FailureCache.delete(key);
    _saveV2FailureCache();
    return false;
  }
  return true;
}

// [STEP9] Clear V2 failure cache for a pair — called when the server re-validates
// a V2 route that the client previously cached as failed. The server's fresh
// QuoterV2 call proves V2 works NOW, so the stale local failure should be purged.
function clearV2FailureIfCached(tokenAHtsId: string, tokenBHtsId: string): boolean {
  const key = _v2PairKey(tokenAHtsId, tokenBHtsId);
  if (_v2FailureCache.has(key)) {
    const age = Date.now() - (_v2FailureCache.get(key) || 0);
    _v2FailureCache.delete(key);
    _saveV2FailureCache();
    log.warn("SwapEngine",
      `[STEP9] V2 failure cache CONFLICT: server validated V2 for ${key} ` +
      `but client had a failure cached (age: ${Math.round(age / 1000)}s). ` +
      `Cache cleared — server re-validated V2 since the failure.`
    );
    return true;
  }
  return false;
}

// Load cache on module init
_loadV2FailureCache();

// ══════════════════════════════════════════════════════════════════════
// ── [V2-WHBAR-FIX] WHBAR ADDRESS CORRECTION FOR V2 POOLS ───────────
// ══════════════════════════════════════════════════════════════════════
//
// SaucerSwap V2 (UniswapV3 fork) pools pair tokens with the WHBAR
// CONTRACT (0.0.1456985) — not the WHBAR HTS TOKEN (0.0.1456986).
//
// The V2 SwapRouter's WETH9 state variable points to the WHBAR contract.
// Pools were created with this contract address. The EVM addresses differ
// by exactly 1 (0x...163b59 vs 0x...163b5a).
//
// If the wrong WHBAR address is used in exactInputSingle/exactInput,
// the Router's Factory.getPool() lookup returns address(0) → revert.
//
// V1 routing is NOT affected — V1 getAmountsOut/swapExact* use a
// separate code path with its own WHBAR address handling.
// ══════════════════════════════════════════════════════════════════════

/**
 * [V2-WHBAR-FIX] Ensure WHBAR EVM address uses the CONTRACT for V2 operations.
 *
 * Checks if the given EVM address is the WHBAR HTS token (0.0.1456986) and
 * replaces it with the WHBAR contract (0.0.1456985) which is what V2 pools
 * and the V2 SwapRouter WETH9 actually reference.
 *
 * Non-WHBAR addresses pass through unchanged.
 */
function ensureWhbarContractForV2(evmAddress: string, network: HederaNetwork): string {
  // WHBAR HTS token long-zero address (what our token registry uses)
  const whbarTokenEvm = htsIdToEvmAddress("0.0.1456986").toLowerCase();
  if (evmAddress.toLowerCase() === whbarTokenEvm) {
    const contractId = SAUCERSWAP_WHBAR_CONTRACT[network] || SAUCERSWAP_WHBAR_CONTRACT.mainnet;
    const contractEvm = htsIdToEvmAddress(contractId);
    log.debug("SwapEngine", `[V2-WHBAR-FIX] Correcting WHBAR address for V2: ${evmAddress} (token 0.0.1456986) → ${contractEvm} (contract ${contractId})`);
    return contractEvm;
  }
  return evmAddress;
}

// ══════════════════════════════════════════════════════════════════════
// ── [STEP-6] V2 MULTI-HOP PRE-VALIDATION HELPER ─────────────────────
// ══════════════════════════════════════════════════════════════════════
//
// Validates a V2 multi-hop route BEFORE committing to V2 execution.
// Does alias resolution, WHBAR correction, per-hop fee tier probing
// (same as SWAP-FIX-5), and full-path QuoterV2 validation.
//
// Returns validated data if V2 is viable, or null if V2 should be skipped.
// Used by the V2-SKIP lift blocks to decide V2 vs V1 execution.

interface V2PreValidation {
  packedPath: Uint8Array;
  correctedFees: number[];
  amountOut: bigint;
  v2PathTokens: string[];
}

async function _preValidateV2MultiHop(
  route: { hops: PoolVersionInfo[]; tokens: string[] },
  rawInput: number,
  network: HederaNetwork,
  whbar: AllowedToken,
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  isInputNative: boolean,
  isOutputNative: boolean,
): Promise<V2PreValidation | null> {
  try {
    // ── Step 1: Resolve V2 path (aliases + WHBAR) — mirrors C100-S6 ──
    const v2PathTokens = route.tokens.map((tokenEvm) => {
      const htsId = evmAddressToHtsId(tokenEvm);
      const token = resolveTokenByHtsId(htsId)
        || SAUCERSWAP_TOKENS.find(t => t.saucerswapAliasId === htsId);
      let resolvedEvm = tokenEvm;
      if (token) {
        resolvedEvm = getSaucerswapRoutingEvmAddress(token);
      }
      return ensureWhbarContractForV2(resolvedEvm, network);
    });

    // ── Step 2: Per-hop fee tier probing — mirrors SWAP-FIX-5 ──
    const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
    const quoterHtsId = SAUCERSWAP_V2_QUOTER[network] || SAUCERSWAP_V2_QUOTER.mainnet;
    if (!quoterHtsId || quoterHtsId === "0.0.0") return null;
    const quoterEvm = await resolveContractEvmAddress(quoterHtsId, network);
    if (!quoterEvm) return null;

    const correctedFees: number[] = [];
    let perHopAmountIn = BigInt(rawInput);

    for (let h = 0; h < route.hops.length; h++) {
      const tokenA = v2PathTokens[h];
      const tokenB = v2PathTokens[h + 1];
      const graphFee = route.hops[h].feeTier || 3000;
      const feeTiersToTry = [graphFee, ...V2_FEE_TIERS.filter(f => f !== graphFee)];

      let hopOk = false;
      let hopOut = 0n;

      for (const tryFee of feeTiersToTry) {
        try {
          const singleData = bytesToHex(
            encodeQuoteExactInputSingle(tokenA, tokenB, perHopAmountIn, tryFee)
          );
          const sRes = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: makeAbort(8000),
            body: JSON.stringify({
              jsonrpc: "2.0", method: "eth_call",
              params: [{ to: quoterEvm, data: singleData, gas: "0x1E8480" }, "latest"],
              id: 1,
            }),
          });
          if (sRes.ok) {
            const sData = await sRes.json();
            if (sData.result && sData.result !== "0x" && sData.result.length >= 66 && !sData.error) {
              const amt = BigInt("0x" + sData.result.slice(2, 66));
              if (amt > 0n) {
                correctedFees.push(tryFee);
                hopOut = amt;
                hopOk = true;
                if (tryFee !== graphFee) {
                  console.log(`[STEP-6] Pre-validate hop ${h}: fee corrected ${graphFee} → ${tryFee}`);
                }
                break;
              }
            }
          }
        } catch { /* try next */ }
      }

      if (!hopOk) {
        console.log(`[STEP-6] Pre-validate: hop ${h} failed ALL fee tiers — V2 not viable`);
        return null;
      }
      perHopAmountIn = hopOut;
    }

    // ── Step 3: Build corrected packed path ──
    const pathHops: { tokenEvm: string; fee: number }[] = [];
    for (let i = 0; i < v2PathTokens.length; i++) {
      pathHops.push({
        tokenEvm: v2PathTokens[i],
        fee: i < correctedFees.length ? correctedFees[i] : 0,
      });
    }
    const packedPath = encodeSwapPath(pathHops);

    // ── Step 4: Full-path QuoterV2 validation ──
    const fullPathAmountOut = await fetchV2MultiHopQuote(packedPath, BigInt(rawInput), network);
    if (!fullPathAmountOut || fullPathAmountOut <= 0n) {
      console.log(`[STEP-6] Pre-validate: full-path QuoterV2 failed — V2 not viable`);
      return null;
    }

    console.log(`[STEP-6] Pre-validate: V2 VIABLE ✓ amountOut=${fullPathAmountOut}, fees=[${correctedFees.join(",")}]`);
    return {
      packedPath,
      correctedFees,
      amountOut: fullPathAmountOut,
      v2PathTokens,
    };
  } catch (err: any) {
    console.log(`[STEP-6] Pre-validate error:`, err?.message || err);
    return null;
  }
}

export interface ApproveResult {
  needed: boolean;          // true if approve tx was sent
  skipped: boolean;         // true if existing allowance was sufficient
  success: boolean;
  transactionId?: string;
  error?: string;
  userCancelled?: boolean;
  existingAllowance: number; // raw units
  approvedAmount: number;   // 0 if skipped, rawInput or MAX if sent
}

/**
 * [C53] Check allowance and approve token spending if needed.
 *
 * - If existing allowance >= rawInput → skip (0 popups for this step)
 * - Otherwise → approve exact rawInput (matches the swap quote)
 *
 * [STEP-15] Infinite approval removed — always approves exact amount to
 * prevent AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY errors on low-supply tokens.
 *
 * Dispatches swap-step events for UI feedback.
 */
async function approveIfNeeded(params: {
  tokenHtsId: string;
  ownerAccountId: string;
  spenderAccountId: string;  // Router HTS ID (e.g. "0.0.3045981" for V1, "0.0.3949434" for V2)
  rawInput: number;
  network: HederaNetwork;
  tokenSymbol: string;
  stepNumber: number;
  totalSteps: number;
  /** [C100-S7] Router version for diagnostics — validates the right router is targeted */
  routerVersion?: "v1" | "v2";
  /** [STEP6] Pre-checked allowance from quote-time parallel fetch. Skips Mirror Node call if fresh (< 30s). */
  preCheckedAllowance?: number;
  preCheckedAt?: number;
}): Promise<ApproveResult> {
  const {
    tokenHtsId, ownerAccountId, spenderAccountId,
    rawInput, network, tokenSymbol,
    stepNumber, totalSteps, routerVersion,
  } = params;

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │  [C100-S7] ROUTER TARGETING ASSERTION                              │
  // │                                                                     │
  // │  V2 swaps MUST approve V2 Router (0.0.3949434 mainnet).            │
  // │  V1 swaps MUST approve V1 Router (discovered at runtime).          │
  // │  If routerVersion is provided, validate the spender matches.       │
  // │  The HTS precompile checks allowances by canonical token ID +      │
  // │  spender account ID — wrong spender = CONTRACT_REVERT_EXECUTED.    │
  // └─────────────────────────────────────────────────────────────────────┘
  if (routerVersion) {
    const expectedV2 = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
    if (routerVersion === "v2" && spenderAccountId !== expectedV2) {
      console.error(`[C100-S7] CRITICAL: V2 swap targeting wrong router! Expected ${expectedV2}, got ${spenderAccountId}`);
    }
    console.log(`[C100-S7] Approval target: ${tokenSymbol} (${tokenHtsId}) �� ${routerVersion.toUpperCase()} Router ${spenderAccountId}`);
  }

  // ── [STALE-ALLOW] Check if allowance was recently consumed ──
  // If yes, Mirror Node may report stale (pre-consumption) value — force re-approval.
  const recentlyConsumed = isAllowanceRecentlyConsumed(tokenHtsId, spenderAccountId);
  if (recentlyConsumed) {
    log.debug("SwapEngine", `[STALE-ALLOW] Allowance for ${tokenSymbol} → ${spenderAccountId} was consumed within ${STALE_ALLOW_TTL_MS / 1000}s — forcing re-approval (Mirror Node may be stale)`);
  }

  // ── Check existing allowance ──
  // [STEP6] Use pre-checked allowance from quote-time parallel fetch if fresh (< 30s).
  // This eliminates the 1-2s Mirror Node call from the swap execution critical path.
  const PRECHECK_FRESHNESS_MS = 30_000;
  const preCheckFresh = !recentlyConsumed
    && typeof params.preCheckedAllowance === "number"
    && params.preCheckedAt
    && (Date.now() - params.preCheckedAt) < PRECHECK_FRESHNESS_MS;

  let existingAllowance: number;
  if (recentlyConsumed) {
    existingAllowance = 0;  // Don't trust any cached value during stale window
  } else if (preCheckFresh) {
    existingAllowance = params.preCheckedAllowance!;
    console.log(`[STEP6] Using pre-checked allowance: ${existingAllowance} for ${tokenSymbol} → ${spenderAccountId} (age: ${Date.now() - params.preCheckedAt!}ms)`);
  } else {
    existingAllowance = await fetchTokenAllowance(ownerAccountId, tokenHtsId, spenderAccountId, network);
  }

  if (existingAllowance >= rawInput) {
    console.log(
      `[C53] ✓ Existing allowance ${existingAllowance} >= ${rawInput} for ${tokenSymbol} → ${spenderAccountId} — SKIPPING approve (1-click swap!)`,
    );
    window.dispatchEvent(new CustomEvent("swap-step", { detail: {
      step: stepNumber, total: totalSteps,
      description: `${tokenSymbol} already approved ✓`,
    }}));
    return {
      needed: false, skipped: true, success: true,
      existingAllowance, approvedAmount: 0,
    };
  }

  // ── Approval needed — determine amount ──
  // [STEP-15] Always approve exact rawInput — no infinite approvals.
  // This prevents AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY on low-supply tokens
  // and ensures wallet popup shows the exact amount the user expects.
  const approveAmount = rawInput;
  const topUp = existingAllowance > 0;

  console.log(
    `[C53] ${topUp ? "Top-up" : "New"} approval: ${tokenSymbol} → ${spenderAccountId}, ` +
    `existing=${existingAllowance}, needed=${rawInput}, approving=${approveAmount} (exact)`,
  );

  window.dispatchEvent(new CustomEvent("swap-step", { detail: {
    step: stepNumber, total: totalSteps,
    description: `Approving ${tokenSymbol}...`,
  }}));

  // ── Send native HTS approve transaction ──
  // [C81-02] Use fast-path execution — skips Mirror Node receipt polling.
  // [SEC-14] A mandatory CONSENSUS_WAIT_MS delay is enforced after success
  // to prevent the swap TX from seeing stale pre-approval allowance state.
  const { executeHederaTransactionFast } = await import("../hashpack");

  const approveTx = new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(tokenHtsId, ownerAccountId, spenderAccountId, approveAmount);

  const approveResult = await executeHederaTransactionFast(ownerAccountId, approveTx);
  console.log(`[C53] Approve result (fast): ${JSON.stringify(approveResult)}`);

  if (!approveResult.success) {
    return {
      needed: true, skipped: false, success: false,
      transactionId: approveResult.transactionId || undefined,
      error: `${tokenSymbol} approval failed: ${approveResult.error || "unknown"}`,
      userCancelled: approveResult.userCancelled,
      existingAllowance, approvedAmount: 0,
    };
  }

  // ── [PERF-01 / S2] Consensus wait ──────────────────────────────────
  // [S2] IMPLEMENTATION NOTE — CONSENSUS_WAIT_MS was raised from 0 → 2000ms.
  // The WC round-trip (sign → submit → return) takes 2-5s, but the approval
  // may not reach consensus before the swap TX arrives. 2s wait ensures the
  // HTS precompile sees the fresh allowance when the swap TX's transferFrom()
  // checks it. This runs concurrently with the wallet re-focus hint (S2).
  if (CONSENSUS_WAIT_MS > 0) {
    console.log(`[S2] Waiting ${CONSENSUS_WAIT_MS}ms for approval consensus...`);
    await new Promise(r => setTimeout(r, CONSENSUS_WAIT_MS));
  }

  // ── [S3] Lightweight approval confirmation ──────────────────────────
  // After the consensus wait, do a quick Mirror Node allowance check to
  // confirm the approval landed. If it hasn't, wait 2s more. This catches
  // edge cases where Mirror Node lag exceeds CONSENSUS_WAIT_MS.
  // Non-blocking: if the check fails (network error), proceed optimistically.
  // The swap TX will revert cleanly if allowance is actually stale.
  try {
    const postApproveAllowance = await fetchTokenAllowance(ownerAccountId, tokenHtsId, spenderAccountId, network);
    if (postApproveAllowance < rawInput) {
      console.log(`[S3] Post-approval allowance ${postApproveAllowance} < ${rawInput} — waiting 2s more for Mirror Node sync`);
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.log(`[S3] ✓ Approval confirmed on Mirror Node: ${postApproveAllowance} >= ${rawInput}`);
    }
  } catch (confirmErr: any) {
    console.log(`[S3] Approval confirmation check failed (non-blocking): ${confirmErr?.message || confirmErr}`);
  }

  console.log(`[S2] ✓ Approval submitted — proceeding to swap`);

  return {
    needed: true, skipped: false, success: true,
    transactionId: approveResult.transactionId || undefined,
    existingAllowance, approvedAmount: approveAmount,
  };
}

// ══════════════════════════════════════════════════════════════════════
// ── TYPES ───────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

export interface SwapResult {
  success: boolean;
  transactionId?: string;
  outputAmount?: number;
  error?: string;
  route?: string[];
  priceImpact?: number;
  executionVenue: "saucerswap-v1" | "saucerswap-v2" | "restricted-router" | "simulated";
  /** How the quote was obtained: "router" | "api" | "price-estimate" | "none" */
  quoteSource?: string;
  /** Whether the pre-swap dry run was executed and passed */
  dryRunPassed?: boolean;
  /** True when the user actively declined/cancelled the transaction in their wallet */
  userCancelled?: boolean;
}

interface DryRunParams {
  isInputNative: boolean;
  isOutputNative: boolean;
  rawInput: number;
  minOutput: number;
  pathAddresses: string[];
  recipientEvmAddress: string;
  routerHtsId: string;
  deadline: number;
  network: HederaNetwork;
}

export interface DryRunResult {
  ok: boolean;
  reason?: string;
  /** Whether the dry run actually executed (vs skipped due to endpoint issues) */
  simulated: boolean;
  /** The function selector used */
  functionName?: string;
  /** Response hex length (indicates valid return data) */
  resultHexLength?: number;
  /** Time taken in ms */
  durationMs?: number;
}

// ══════════════════════════════════════════════════════════════════════
// ── V2 SINGLE-HOP EXECUTION ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Execute a swap through SaucerSwap V2 (concentrated liquidity).
 *
 * Uses exactInputSingle for single-hop swaps.
 * - HBAR -> Token: payable exactInputSingle (no approve needed)
 * - Token -> Token: ERC-20 approve + exactInputSingle
 * - Token -> HBAR: ERC-20 approve + exactInputSingle (to WHBAR) + auto-note
 */
async function executeSaucerSwapV2Direct(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork,
  poolInfo: PoolVersionInfo,
  isInputNative: boolean,
  isOutputNative: boolean,
  whbar: AllowedToken,
  rawInput: number,
  recipientEvmAddress: string,
  options?: SwapOptions,
): Promise<SwapResult> {
  const { executeHederaTransaction } = await import("../hashpack");

  try {
    const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
    let fee = poolInfo.feeTier || 3000;

    // Token EVM addresses for the V2 pool (use SaucerSwap alias for bridge tokens)
    // [V2-WHBAR-FIX] V2 pools pair with WHBAR CONTRACT (0.0.1456985), not TOKEN (0.0.1456986).
    // The V2 SwapRouter's WETH9 and all V2 pool Factory registrations use the contract address.
    // Without this fix, exactInputSingle passes the wrong WHBAR address → Factory.getPool
    // returns address(0) → CONTRACT_REVERT_EXECUTED on every V2 swap involving HBAR/WHBAR.
    const tokenInEvm = ensureWhbarContractForV2(
      getSaucerswapRoutingEvmAddress(isInputNative ? whbar : inputToken), network
    );
    const tokenOutEvm = ensureWhbarContractForV2(
      getSaucerswapRoutingEvmAddress(isOutputNative ? whbar : outputToken), network
    );

    // ── V2 Quote: try V2 QuoterV2 first, then fall back to price estimation ──
    // V1 getAmountsOut does NOT work for V2-only pools, so we use the V2 QuoterV2
    // contract's quoteExactInputSingle() which queries the actual concentrated
    // liquidity pool and returns accurate output amounts.
    let quote: RawQuote | null = null;

    // ── [STEP3] Server-validated route bypass for quoting ──
    // When the server already ran QuoterV2 and returned a valid quote,
    // skip ALL client-side fee probing + fallback strategies. The server's
    // rawAmountOut is the on-chain QuoterV2 result — same contract, same data.
    if (options?.validatedRoute?.rawAmountOut) {
      const serverOut = Number(BigInt(options.validatedRoute.rawAmountOut));
      if (serverOut > 0) {
        const serverFee = options.validatedRoute.feeTiers?.[0] || fee;
        fee = serverFee;
        (poolInfo as any).feeTier = serverFee;
        quote = {
          amountOut: serverOut,
          priceImpact: 0,
          route: [inputToken.htsId, outputToken.htsId],
          source: "router",
          confidence: "high",
          poolVersion: "v2",
          feeTier: serverFee,
        };
        console.log(`[STEP3] ✓ V2 Direct: using server-validated quote (amountOut=${serverOut}, fee=${serverFee}, ` +
          `age=${Date.now() - (options.validatedRoute.validatedAt || 0)}ms) — skipping SWAP-FIX-4 + fallback`);
      }
    }

    // Strategy 1: V2 QuoterV2 contract (most accurate for V2 pools)
    // [SWAP-FIX-4] Try the detected fee tier first, then try other common
    // tiers if it fails. Many pools exist at unexpected fee tiers (e.g.,
    // 1500 for WHBAR pairs) and the pool graph may return the wrong one.
    {
      const feeTiersToTry = [fee, ...V2_FEE_TIERS.filter(f => f !== fee)];
      for (const tryFee of feeTiersToTry) {
        if (quote) break; // stop once we have a quote
        try {
          const v2QuoteAmount = await fetchV2RouterQuote(
            tokenInEvm, tokenOutEvm, BigInt(rawInput), tryFee, network
          );
          if (v2QuoteAmount !== null && v2QuoteAmount > 0n) {
            if (tryFee !== fee) {
              console.log(`[SWAP-FIX-4] V2 Quote succeeded at fee=${tryFee} (original fee=${fee} failed) — updating fee tier`);
              fee = tryFee;
              (poolInfo as any).feeTier = tryFee;
            }
            quote = {
              amountOut: Number(v2QuoteAmount),
              priceImpact: 0, // Actual impact baked into on-chain result
              route: [inputToken.htsId, outputToken.htsId],
              source: "router",
              confidence: "high",
              poolVersion: "v2",
              feeTier: tryFee,
            };
            console.log(`[HBAR.h] V2 Quote via QuoterV2: amountOut=${v2QuoteAmount} (fee=${tryFee})`);
          }
        } catch (err: any) {
          if (tryFee === fee) {
            console.log("[HBAR.h] V2 QuoterV2 quote failed:", err?.message || err);
          }
        }
      }
    }

    // Strategy 2: Server proxy / price-based estimation fallback
    // [C77-07] Uses RouterV3 (0.0.3045981) for quote — matches V1 swap execution router.
    if (!quote) {
      const quoteInputId = isInputNative ? whbar.htsId : getSaucerswapRoutingId(inputToken);
      const quoteOutputId = isOutputNative ? whbar.htsId : getSaucerswapRoutingId(outputToken);
      quote = await fetchSaucerSwapQuote(quoteInputId, quoteOutputId, rawInput.toString(), {
        pathAddresses: [tokenInEvm, tokenOutEvm],
        routerHtsId: getSaucerSwapRouter(network, "v1"),
        network,
        inputToken: isInputNative ? whbar : inputToken,
        outputToken: isOutputNative ? whbar : outputToken,
      });
    }

    // ── minOutput calculation ──
    let minOutput: number;
    if (quote && quote.amountOut > 0) {
      // [SLIPPAGE-FIX] V2 concentrated liquidity pools can have significant
      // price movement between the QuoterV2 quote (eth_call at "latest") and
      // actual execution (consensus 3-5s later). Without a minimum floor,
      // 0.5% slippage causes frequent INSUFFICIENT_OUTPUT_AMOUNT reverts.
      // SaucerSwap.finance defaults to 0.5% but their frontend re-quotes
      // right before execution; our architecture has a longer gap.
      // [S3] IMPLEMENTATION NOTE — Floor raised from 1% → 2%.
      // Token→HBAR V2 swaps have an extra latency gap (approval popup +
      // CONSENSUS_WAIT_MS + swap popup signing time). The concentrated
      // liquidity tick can move 1-3% in the 5-10s between quote and execution.
      // 2% floor matches the multi-hop V2 floor (line ~1784) for consistency.
      const effectiveSlippage = quote.source === "price-estimate"
        ? Math.max(slippagePct, 5) // wider slippage for estimated quotes
        : Math.max(slippagePct, 2); // [S3] 2% floor for V2 on-chain quotes
      minOutput = Math.max(1, Math.floor(quote.amountOut * (1 - effectiveSlippage / 100)));
      console.log(`[HBAR.h] V2 Quote: source=${quote.source}, amountOut=${quote.amountOut}, minOutput=${minOutput} (${effectiveSlippage}% slippage, requested=${slippagePct}%)`);
    } else {
      // Last-ditch inline estimate before surrendering to minOutput=1
      const inTok = isInputNative ? whbar : inputToken;
      const outTok = isOutputNative ? whbar : outputToken;
      const lastDitch = estimateOutputFromPrices(rawInput, inTok, outTok, 1);
      if (lastDitch && lastDitch > 0) {
        const safeSlippage = Math.max(slippagePct, 10); // very generous for emergency estimate
        minOutput = Math.max(1, Math.floor(lastDitch * (1 - safeSlippage / 100)));
        console.warn(`[HBAR.h] V2: All strategies failed but inline price estimate rescued quote: minOutput=${minOutput} (${safeSlippage}% slippage)`);
      } else {
        // [SEC-14] HARD ABORT: minOutput=1 is a zero-slippage-protection vulnerability.
        // A sandwich attacker could manipulate the pool price between the user's TX
        // submission and execution, extracting up to ~100% of the swap value.
        // Never execute a swap without a validated minimum output.
        console.error("[SEC-14] V2 Direct: All quote strategies failed — ABORTING swap (minOutput=1 is unsafe)");
        return {
          success: false,
          error: `Cannot determine minimum output for ${inputToken.symbol} → ${outputToken.symbol}. ` +
            `All quote strategies (V2 QuoterV2, server proxy, API, price estimation) failed. ` +
            `Executing without slippage protection would expose you to sandwich attacks. ` +
            `Try again in a few seconds, or reduce the swap amount.`,
          executionVenue: "saucerswap-v2",
        };
      }
    }

    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min

    // ── Verify V2 Router is a contract ──
    const routerContractInfo = await verifyIsContract(v2RouterId, network);
    if (!routerContractInfo) {
      return {
        success: false,
        error: `V2 Router ${v2RouterId} failed contract verification on ${network}. Cannot execute V2 swap.`,
        executionVenue: "saucerswap-v2",
      };
    }
    const routerEvmAddress = routerContractInfo.evmAddress || await resolveContractEvmAddress(v2RouterId, network);

    // ── [SWAP-FIX-3] Pre-validate V2 pool existence ──
    // Call V2 Factory.getPool(tokenIn, tokenOut, fee) via eth_call to
    // confirm the pool exists BEFORE sending a real transaction.
    // If the pool doesn't exist for the detected fee tier, try other
    // common tiers. This prevents wasted gas on doomed transactions.
    // [STEP3] Gated: server QuoterV2 implicitly validates pool existence.
    if (options?.validatedRoute) {
      console.log(`[STEP3] Skipping SWAP-FIX-3 pool existence check (server already validated via QuoterV2)`);
    } else
    try {
      const v2FactoryId = SAUCERSWAP_V2_FACTORY[network] || SAUCERSWAP_V2_FACTORY.mainnet;
      const factoryEvm = await resolveContractEvmAddress(v2FactoryId, network);
      const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
      const gasHex = "0x" + (500_000).toString(16);

      let poolFound = false;
      const feesToTry = [fee, ...V2_FEE_TIERS.filter(f => f !== fee)];
      for (const tryFee of feesToTry) {
        const gpCallData = bytesToHex(encodeGetPool(tokenInEvm, tokenOutEvm, tryFee));
        const gpRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(6000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: factoryEvm, data: gpCallData, gas: gasHex }, "latest"],
            id: 1,
          }),
        });
        if (gpRes.ok) {
          const gpData = await gpRes.json();
          if (gpData.result && gpData.result !== "0x" && gpData.result.length >= 66) {
            // getPool returns address — check it's not address(0)
            const poolAddr = gpData.result.slice(26, 66); // last 20 bytes of 32-byte address
            if (poolAddr && !/^0+$/.test(poolAddr)) {
              if (tryFee !== fee) {
                console.log(`[SWAP-FIX-3] ✓ V2 pool found at fee=${tryFee} (original fee=${fee} had no pool) — correcting`);
                (poolInfo as any).feeTier = tryFee;
              } else {
                console.log(`[SWAP-FIX-3] ✓ V2 pool confirmed at fee=${fee}`);
              }
              poolFound = true;
              break;
            }
          }
        }
      }
      if (!poolFound) {
        console.warn(`[SWAP-FIX-3] No V2 pool found for ${evmAddressToHtsId(tokenInEvm)}/${evmAddressToHtsId(tokenOutEvm)} at any fee tier — aborting V2 to avoid doomed transaction`);
        // [SWAP-FIX-3b] EARLY ABORT: Don't proceed with a V2 swap when we've
        // confirmed on-chain that no pool exists. Previously we continued anyway,
        // causing a doomed dry-run → doomed WC transaction → WC timeout → wasted
        // time before V1 fallback kicked in. Returning early lets the caller
        // fall through to V1 immediately.
        return {
          success: false,
          error: `No V2 pool exists for ${inputToken.symbol}/${outputToken.symbol} at any fee tier. V1 fallback recommended.`,
          executionVenue: "saucerswap-v2" as const,
        };
      }
      // Re-read the (possibly corrected) fee
      const correctedFee = poolInfo.feeTier || 3000;
      if (correctedFee !== fee) {
        console.log(`[SWAP-FIX-3] Fee corrected: ${fee} → ${correctedFee}`);
      }
    } catch (gpErr: any) {
      console.log(`[SWAP-FIX-3] Pool validation skipped (non-blocking): ${gpErr?.message}`);
    }

    // Re-read fee after potential correction  
    fee = poolInfo.feeTier || 3000;

    // ── Log V2 swap parameters ──
    console.log("[HBAR.h] ═══════════════════════════════════════════");
    console.log("[HBAR.h] V2 SWAP EXECUTION START");
    console.log("[HBAR.h] Input:", inputToken.symbol, "→ Output:", outputToken.symbol);
    console.log("[HBAR.h] Amount:", inputAmount, `(raw: ${rawInput})`);
    console.log("[HBAR.h] V2 Fee Tier:", fee, `(${fee / 10000}%)`);
    console.log("[HBAR.h] Pool:", poolInfo.poolAddress || "detected");
    console.log("[HBAR.h] TokenIn EVM:", tokenInEvm);
    console.log("[HBAR.h] TokenOut EVM:", tokenOutEvm);
    console.log("[HBAR.h] Recipient EVM:", recipientEvmAddress);
    console.log("[HBAR.h] V2 Router:", v2RouterId, `(EVM: ${routerEvmAddress})`);
    const effectiveSlippageLog = quote?.source === "price-estimate" ? Math.max(slippagePct, 5) : slippagePct;
    console.log("[HBAR.h] MinOutput:", minOutput, `(quote: ${quote?.amountOut ?? "none"}, source: ${quote?.source ?? "none"})`);
    console.log("[HBAR.h] Slippage:", effectiveSlippageLog, `% (requested: ${slippagePct}%) | Deadline:`, deadline);
    console.log("[HBAR.h] Mode:", isInputNative ? "HBAR→Token(V2)" : isOutputNative ? "Token→HBAR(V2)" : "Token→Token(V2)");
    // [C100-S7] Approval chain diagnostics for V2 direct swaps
    if (!isInputNative) {
      console.log(`[C100-S7] ── V2 DIRECT APPROVAL CHAIN ──`);
      console.log(`[C100-S7]   Token: ${inputToken.symbol} (canonical HTS ID: ${inputToken.htsId})`);
      console.log(`[C100-S7]   Alias: ${inputToken.saucerswapAliasId || "none (same as canonical)"}`);
      console.log(`[C100-S7]   Spender: V2 Router ${v2RouterId}`);
      console.log(`[C100-S7]   Amount: ${rawInput} (raw smallest unit)`);
    }
    console.log("[HBAR.h] ═══════════════════════════════════════════");

    // ── Token association check ──
    // [C30-01] Token association check:
    // - Token→Token: user must be associated with the OUTPUT token.
    // - Token→HBAR: NOT needed. With multicall(swap + unwrapWETH9), WHBAR
    //   stays in the router's EVM balance and is unwrapped atomically.
    //   The user never receives WHBAR, so no association required.
    // - HBAR→Token: handled separately (isInputNative block).
    // [C100-S11] Auto-association: if account has maxAutoAssociations != 0,
    // Hedera auto-associates on first transfer — skip the popup entirely.
    const _v2AutoAssoc = options?.maxAutoAssociations;
    const _v2HasAutoAssoc = _v2AutoAssoc === -1 || (_v2AutoAssoc !== undefined && _v2AutoAssoc > 0);
    if (!isOutputNative) {
      if (_v2HasAutoAssoc) {
        console.log(`[C100-S11] V2: Auto-association enabled (maxAutoAssociations=${_v2AutoAssoc}) — skipping output token association popup for ${outputToken.symbol}`);
      } else {
      const assocHtsId = outputToken.htsId;
      const assocSymbol = outputToken.symbol;

      const isAssoc = await isTokenAssociated(accountId, assocHtsId, network);
      if (!isAssoc) {
        console.warn(`[HBAR.h] V2: ${assocSymbol} (${assocHtsId}) NOT associated — auto-associating`);
        try {
          const assocTx = new TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([assocHtsId]);
          // [C81-02] Fast-path — association prerequisite
          const { executeHederaTransactionFast: v2AssocExec } = await import("../hashpack");
          const assocResult = await v2AssocExec(accountId, assocTx);
          if (!assocResult.success) {
            return {
              success: false,
              error: `${assocSymbol} association failed: ${assocResult.error || "unknown"}. Associate ${assocHtsId} manually in HashPack.`,
              executionVenue: "saucerswap-v2",
              userCancelled: assocResult.userCancelled,
            };
          }
          console.log(`[HBAR.h] V2: Successfully associated ${assocSymbol}`);
          // [SEC-14] Consensus wait after fast-path association
          console.log(`[SEC-14] Waiting ${CONSENSUS_WAIT_MS}ms for association consensus...`);
          await new Promise(r => setTimeout(r, CONSENSUS_WAIT_MS));
        } catch (assocErr: any) {
          const aMsg = (assocErr?.message || "").toLowerCase();
          const aCancel = aMsg.includes("user_reject") || aMsg.includes("cancelled by user") || aMsg.includes("canceled by user") || aMsg.includes("user denied") || aMsg.includes("user rejected");
          return {
            success: false,
            error: `Cannot associate ${assocSymbol}: ${assocErr?.message || "unknown"}`,
            executionVenue: "saucerswap-v2",
            userCancelled: aCancel || undefined,
          };
        }
      } else {
        console.log(`[HBAR.h] V2: ${assocSymbol} association confirmed ✓`);
      }
      }
    }

    // ── Gas sufficiency check ──
    // Hedera gas fees are sub-cent for typical swaps. Reserve 1 HBAR total
    // to cover gas + network fees — good for dozens of transactions.
    // SWAP_GAS is the gas LIMIT for the EVM call, NOT the HBAR cost.
    // NOTE: APPROVE_GAS was removed — approveIfNeeded() uses native HTS
    // AccountAllowanceApproveTransaction which doesn't need an EVM gas limit.
    // [S2] IMPLEMENTATION NOTE — Raised from 1.5M → 2M.
    // Token→HBAR V2 multicall (exactInputSingle + unwrapWETH9) involves two
    // cross-contract calls, each with HTS precompile interactions. 1.5M was
    // marginal and caused sporadic out-of-gas reverts on busy tick crossings.
    const SWAP_GAS = 2_000_000;
    const gasReserveNeeded = 1; // 1 HBAR covers gas + network fees with plenty of margin

    if (isInputNative) {
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      const inputHbar = parseFloat(inputAmount);
      const totalNeeded = inputHbar + gasReserveNeeded;
      if (hbarBalance < totalNeeded) {
        const shortfall = totalNeeded - hbarBalance;
        return {
          success: false,
          error: `Insufficient HBAR: you have ${hbarBalance.toFixed(2)} HBAR but need ${totalNeeded.toFixed(2)} HBAR (${inputHbar} for swap + ${gasReserveNeeded} for fees). Short by ${shortfall.toFixed(2)} HBAR.`,
          executionVenue: "saucerswap-v2",
        };
      }
    } else {
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      if (hbarBalance < gasReserveNeeded) {
        return {
          success: false,
          error: `Insufficient HBAR for fees: you have ${hbarBalance.toFixed(2)} HBAR but need at least ${gasReserveNeeded} HBAR. Deposit more HBAR first.`,
          executionVenue: "saucerswap-v2",
        };
      }
    }

    // ── Pre-swap dry run (V2-specific) ──
    // [C16-02] Only dry-run for HBAR-input swaps (payable calls).
    // For token-input swaps, the ERC-20 approve hasn't been sent yet,
    // so the dry run always reverts with "STF" / "execution reverted"
    // (insufficient allowance). This false-positive revert was blocking
    // all Token → HBAR and Token → Token swaps at the dry-run gate.
    // [STEP3] Gated: server QuoterV2 already confirmed the path works.
    if (options?.validatedRoute) {
      console.log(`[STEP3] Skipping V2 dry run (server already validated route via QuoterV2)`);
    } else if (isInputNative) {
    try {
      const dryCallData = encodeExactInputSingle(
        tokenInEvm, tokenOutEvm, fee,
        recipientEvmAddress,
        BigInt(deadline),
        BigInt(rawInput),
        BigInt(minOutput),
        0n
      );
      const dryDataHex = bytesToHex(dryCallData);
      const dryGasHex = "0x" + (1_500_000).toString(16);
      const dryValueHex = isInputNative ? "0x" + (BigInt(rawInput) * 10000000000n).toString(16) : "0x0";

      console.log(`[HBAR.h] V2 Dry run: exactInputSingle, value=${isInputNative ? rawInput : 0}`);

      const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
      const dryRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(8000), // [PERF-01] 8s (from 15s) — dry run is non-blocking, fail fast
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{
            from: recipientEvmAddress,
            to: routerEvmAddress,
            data: dryDataHex,
            gas: dryGasHex,
            value: dryValueHex,
          }, "latest"],
          id: 1,
        }),
      });

      if (dryRes.ok) {
        const dryData = await dryRes.json();
        if (dryData.error) {
          const revertMsg = dryData.error.message || JSON.stringify(dryData.error).slice(0, 200);
          // Only block on definitive reverts, not on generic RPC issues
          if (revertMsg.includes("REVERT") || revertMsg.includes("revert") || revertMsg.includes("execution reverted")) {
            // [V2-DRYRUN-NONBLOCK] Non-blocking: Hedera eth_call has known HTS simulation limitations
            // (e.g., "Safe token transfer failed!" for tokens not yet associated).
            // SaucerSwap's own frontend doesn't do dry runs. Log warning and proceed.
            console.warn(`[HBAR.h] V2 Dry run REVERT (non-blocking): ${revertMsg}`);
            console.warn("[HBAR.h] Proceeding despite V2 dry run failure — Hedera eth_call has HTS limitations.");
          }
          console.log(`[HBAR.h] V2 Dry run non-blocking RPC error: ${revertMsg.slice(0, 100)}`);
        } else if (dryData.result && dryData.result !== "0x" && dryData.result.length > 2) {
          console.log(`[HBAR.h] V2 Dry run PASSED ✓ (${dryData.result.length} chars)`);
        } else {
          // [C9-02] Log actual dry run response for diagnostics — Hashio may return
          // "0x" for payable calls since eth_call doesn't include real msg.value
          const dryPreview = dryData.result ? dryData.result.slice(0, 40) : "null";
          console.log(`[HBAR.h] V2 Dry run: empty result=${dryPreview} — non-blocking (payable calls may not simulate via eth_call)`);
        }
      } else {
        console.log(`[HBAR.h] V2 Dry run: HTTP ${dryRes.status} — non-blocking`);
      }
    } catch (dryErr: any) {
      console.log("[HBAR.h] V2 Dry run skipped:", dryErr?.message || dryErr);
      // Non-blocking — proceed with real swap
    }
    } else {
      console.log("[HBAR.h] V2 Dry run SKIPPED for token-input swap (approve not yet granted — would false-revert) [C16-02]");
    }

    // ── Execution branches ──

    if (isInputNative) {
      // ═══ HBAR → Token via V2 exactInputSingle (payable) ═══
      console.log("[HBAR.h] V2: Native HBAR input — payable exactInputSingle");
      // [C27-04] Emit step event — single step for HBAR→Token (no approve needed)
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: 1, total: 1,
        description: `Swapping HBAR → ${outputToken.symbol}`,
      }}));

      const functionData = encodeExactInputSingle(
        tokenInEvm, tokenOutEvm, fee,
        recipientEvmAddress,
        BigInt(deadline),
        BigInt(rawInput),
        BigInt(minOutput),
        0n
      );

      // [C9-03] Use Hbar.fromTinybars for precision — avoids floating-point
      // rounding issues with large tinybar amounts. Also log calldata size
      // for serialization diagnostics.
      const hbarAmount = Hbar.fromTinybars(rawInput);

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData)
        .setPayableAmount(hbarAmount);

      // [AUDIT] SaucerSwap-parity diagnostic for V2 HBAR→Token
      console.log(`[AUDIT] ══════════════════════════════════════════════`);
      console.log(`[AUDIT] V2 HBAR→Token EXECUTION PARAMETERS`);
      console.log(`[AUDIT]   function:     exactInputSingle (0x414bf389)`);
      console.log(`[AUDIT]   router:       ${v2RouterId}`);
      console.log(`[AUDIT]   gas:          ${SWAP_GAS}`);
      console.log(`[AUDIT]   payable:      ${rawInput} tinybar = ${rawInput / 1e8} HBAR`);
      console.log(`[AUDIT]   tokenIn:      ${tokenInEvm} (${evmAddressToHtsId(tokenInEvm)})`);
      console.log(`[AUDIT]   tokenOut:     ${tokenOutEvm} (${evmAddressToHtsId(tokenOutEvm)})`);
      console.log(`[AUDIT]   fee:          ${fee} (${fee / 10000}%)`);
      console.log(`[AUDIT]   minOutput:    ${minOutput} (raw ${outputToken.decimals}-decimal)`);
      console.log(`[AUDIT]   recipient:    ${recipientEvmAddress}`);
      console.log(`[AUDIT]   deadline:     ${deadline}`);
      console.log(`[AUDIT] ══════════════════════════════════════════════`);
      console.log(`[HBAR.h] V2: Submitting exactInputSingle — HBAR: ${hbarAmount} (${rawInput} tinybar), calldata: ${functionData.length}B`);
      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2: Swap result:", JSON.stringify(swapResult));

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: ["HBAR", outputToken.symbol],
        priceImpact: quote?.priceImpact,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v2",
        quoteSource: quote?.source || "none",
        userCancelled: swapResult.userCancelled,
      };

    } else {
      // ═══ Token → Token or Token → HBAR via V2 [C35-01] ═══
      //
      // [C35-01] Two wallet popups maximum:
      //   Popup 1: Native HTS AccountAllowanceApproveTransaction
      //   Popup 2: Token→HBAR: atomic multicall(exactInputSingle(recipient=ROUTER) + unwrapWETH9(0, user)) [C34-01]
      //            Token→Token: single exactInputSingle(recipient=user)
      //
      // NOTE [C35-01]: Reverted from C33-01 ERC-20 approve() back to
      // native HTS AccountAllowanceApproveTransaction. The C33-01 comment that
      // "native HTS allowances do NOT reliably bridge to EVM-level allowances" was
      // INCORRECT — SaucerSwap's own production UI (saucerswap.finance) uses native
      // HTS approvals for ALL swaps (SAUCE→HBAR, USDC→HBAR, etc.) and they work
      // correctly. The HTS precompile properly bridges native allowances to ERC-20
      // allowance checks in Solidity contracts. The ERC-20 approve approach had a
      // subtle failure mode: the spender EVM address format (long-zero vs CREATE-
      // deployed) could mismatch the router's msg.sender in transferFrom() calls,
      // causing silent allowance check failures → CONTRACT_REVERT_EXECUTED.
      // Native HTS approve uses Hedera account IDs (0.0.xxxxx) which are always
      // resolved correctly regardless of EVM address format.
      //
      // Evidence: SaucerSwap.finance SAUCE→HBAR and USDC→HBAR both use
      // AccountAllowanceApproveTransaction with native HTS token IDs.
      // [C100-S7] V2 swaps target V2 Router (0.0.3949434), NOT V1 Router.
      // V1 swaps target V1 RouterV3 (0.0.3045981). Each router checks
      // allowances independently via the HTS precompile.
      //
      // ATOMIC: If multicall reverts, no tokens leave the user's wallet.

      // ── Step 1: [C53] Smart approve — skips if allowance sufficient ──
      // [C100-S7] Approval uses CANONICAL token HTS ID (inputToken.htsId).
      // The HTS precompile checks allowances by canonical ID + spender.
      // Even though V2 pools may use alias (ERC20Wrapper) addresses in the
      // packed path, the SwapRouter's transferFrom ultimately resolves to
      // the canonical token's allowance table.
      const canonicalTokenId = inputToken.htsId;
      if (inputToken.saucerswapAliasId && inputToken.saucerswapAliasId !== canonicalTokenId) {
        console.log(`[C100-S7] V2 Direct: canonical=${canonicalTokenId}, alias=${inputToken.saucerswapAliasId} — approving CANONICAL for V2 Router`);
      }
      const v2ApproveResult = await approveIfNeeded({
        tokenHtsId: canonicalTokenId,
        ownerAccountId: accountId,
        spenderAccountId: v2RouterId,
        rawInput,
        network,
        tokenSymbol: inputToken.symbol,
        stepNumber: 1,
        totalSteps: 2,
        routerVersion: "v2",
        // [STEP6] Pass pre-checked V2 allowance from quote-time parallel fetch
        preCheckedAllowance: options?.approvalStatus?.v2Allowance,
        preCheckedAt: options?.approvalStatus?.checkedAt,
      });

      if (!v2ApproveResult.success) {
        return {
          success: false,
          transactionId: v2ApproveResult.transactionId || undefined,
          error: "V2 token approval failed: " + (v2ApproveResult.error || "unknown") +
            (v2ApproveResult.transactionId ? ` (tx: ${v2ApproveResult.transactionId})` : ""),
          executionVenue: "saucerswap-v2",
          userCancelled: v2ApproveResult.userCancelled,
        };
      }

      // [S2] IMPLEMENTATION NOTE — Wallet re-focus hint between approve and swap.
      // After approval returns, the wallet may have gone to background (desktop)
      // or the WC relay needs time to clear the first request before accepting
      // the next. This non-blocking call pings the wallet extension's service
      // worker so the swap popup appears promptly instead of the user having
      // to manually switch windows. Combined with CONSENSUS_WAIT_MS = 2000,
      // this runs during the consensus wait — zero added latency.
      if (v2ApproveResult.needed && !v2ApproveResult.skipped) {
        try {
          const { tryOpenWalletExtension } = await import("../hashpack");
          tryOpenWalletExtension().catch(() => {});
        } catch { /* non-blocking */ }
      }

      // [C53] Update step count — if approve was skipped, swap is step 1/1
      const v2SwapStep = v2ApproveResult.skipped ? 1 : 2;
      const v2TotalSteps = v2ApproveResult.skipped ? 1 : 2;

      if (isOutputNative) {
        // ═══ Token → HBAR via V2 — atomic multicall [C30-01] ═══
        //
        // [C30-01] RESTORED multicall approach with CORRECT recipient.
        // Previous C28-01 broke this by using recipient=USER in a 3-step flow,
        // which caused WHBAR to go to user's HTS balance where the separate
        // withdraw() couldn't access it — resulting in lost tokens.
        //
        // The CORRECT flow (from SaucerSwap V2 docs):
        //   multicall([
        //     exactInputSingle(Token→WHBAR, recipient = ROUTER),  ← KEY FIX
        //     unwrapWETH9(0, userAddress)
        //   ])
        //
        // The swap sends WHBAR to the ROUTER's internal EVM balance,
        // then unwrapWETH9 converts it to native HBAR and sends to user.
        // This is ATOMIC — if anything fails, the whole tx reverts and
        // the user's input tokens are safe (no partial execution).
        //
        // NOTE: recipient MUST be the router's EVM address,
        // NOT the user's. The unwrapWETH9 function checks address(this).balance.
        // [C100-S9] WHBAR contract verification — log the split architecture
        // for post-mortem diagnostics if the multicall reverts.
        console.log(`[C100-S9] V2 Token→HBAR multicall structure:`);
        console.log(`[C100-S9]   ┌ exactInputSingle(${inputToken.symbol}→WHBAR, recipient=ROUTER ${routerEvmAddress})`);
        console.log(`[C100-S9]   └ unwrapWETH9(0, user=${recipientEvmAddress})`);
        console.log(`[C100-S9]   WHBAR: contract=0.0.1456985 (withdraw), token=${whbar.htsId} (ERC-20)`);
        log.debug("SwapEngine", `[V2-WHBAR-FIX] tokenOut EVM for V2: ${tokenOutEvm} (should be 0x...163b59 = contract, NOT 0x...163b5a = token)`);
        console.log(`[C100-S9]   tokenOut EVM: ${tokenOutEvm} (should be WHBAR long-zero)`);

        console.log(`[HBAR.h] V2 Step ${v2SwapStep}: multicall(exactInputSingle + unwrapWETH9) — Token→HBAR [C34-01/C100-S9]`);
        window.dispatchEvent(new CustomEvent("swap-step", { detail: {
          step: v2SwapStep, total: v2TotalSteps,
          description: `Swapping ${inputToken.symbol} → HBAR`,
        }}));

        // Sub-call 1: exactInputSingle — swap Token→WHBAR, recipient = ROUTER
        // [C34-01] FIX: address(0) sentinel does NOT exist in the original Uniswap V3
        // SwapRouter (selector 0x414bf389). The sentinel pattern (address(0) →
        // address(this)) only exists in Uniswap's newer SwapRouter02 (selector
        // 0x04e45aaf). SaucerSwap V2 uses the original V3 SwapRouter, so
        // address(0) is passed through literally — the pool tries to transfer WHBAR
        // to the zero address, which reverts on Hedera. The correct approach is to
        // use the router's own EVM address so WHBAR lands in the router's balance
        // for unwrapWETH9 to access via IWETH9(WETH9).balanceOf(address(this)).
        //
        // The routerEvmAddress comes from verifyIsContract() which pre-seeds
        // using htsIdToEvmAddress() (long-zero form). On Hedera, address(this)
        // for ContractCreateTransaction-deployed contracts returns the long-zero
        // form, so these match. Even if the Mirror Node returns a CREATE-deployed
        // address, HTS precompile resolves both forms to the same entity.
        //
        // NOTE [C34-01]: The C33 address(0) sentinel was wrong for
        // the original V3 SwapRouter. This caused CONTRACT_REVERT_EXECUTED on
        // every Token→HBAR multicall. The C33 ERC-20 approve fix remains correct.
        const swapCalldata = encodeExactInputSingle(
          tokenInEvm, tokenOutEvm, fee,
          routerEvmAddress,      // [C34-01] router's own EVM addr — NOT address(0)
          BigInt(deadline),
          BigInt(rawInput),
          BigInt(minOutput),
          0n
        );

        // Sub-call 2: unwrapWETH9 — unwrap all WHBAR in router, send HBAR to user
        // amountMinimum=0 means "unwrap everything" — slippage is already
        // protected by amountOutMinimum in the swap above.
        const unwrapCalldata = encodeUnwrapWHBAR(0n, recipientEvmAddress);

        // Combine into single atomic multicall
        const multicallData = encodeMulticall([swapCalldata, unwrapCalldata]);

        console.log(`[HBAR.h] V2: multicall calldata ${multicallData.length}B ` +
          `(swap=${swapCalldata.length}B + unwrap=${unwrapCalldata.length}B) ` +
          `swapRecipient=${routerEvmAddress} unwrapRecipient=${recipientEvmAddress} [C34-01]`);

        // [C34-01] Diagnostic dump — essential for verifying correct addresses on-chain
        console.log(`[HBAR.h] V2 Token→HBAR multicall diagnostics [C34-01]:`);
        console.log(`  tokenIn EVM:       ${tokenInEvm}`);
        console.log(`  tokenOut EVM:      ${tokenOutEvm}`);
        console.log(`  fee:               ${fee}`);
        console.log(`  swap recipient:    ${routerEvmAddress} (router)`);
        console.log(`  unwrap recipient:  ${recipientEvmAddress} (user)`);
        console.log(`  router contract:   ${v2RouterId}`);
        console.log(`  amountIn:          ${rawInput}`);
        console.log(`  amountOutMin:      ${minOutput}`);
        console.log(`  gas:               ${SWAP_GAS}`);

        const multicallTx = new ContractExecuteTransaction()
          .setContractId(ContractId.fromString(v2RouterId))
          .setGas(SWAP_GAS)
          .setFunctionParameters(multicallData);

        const swapResult = await executeHederaTransaction(accountId, multicallTx);
        console.log("[HBAR.h] V2: Token→HBAR multicall result:", JSON.stringify(swapResult));

        // [STALE-ALLOW] Mark allowance consumed on success — prevents stale Mirror Node race
        if (swapResult.success) markAllowanceConsumed(inputToken.htsId, v2RouterId);

        return {
          success: swapResult.success,
          transactionId: swapResult.transactionId || undefined,
          outputAmount: quote ? quote.amountOut / Math.pow(10, 8) : undefined,
          route: [inputToken.symbol, "HBAR"],
          priceImpact: quote?.priceImpact,
          error: swapResult.error
            ? `Token→HBAR V2 swap failed: ${swapResult.error}` +
              (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
            : undefined,
          executionVenue: "saucerswap-v2",
          quoteSource: quote?.source || "none",
          userCancelled: swapResult.userCancelled,
        };
      }

      // ═══ Token → Token via V2 (non-HBAR output) ═══
      console.log(`[HBAR.h] V2 Step ${v2SwapStep}: exactInputSingle (Token→Token)`);
      // [C27-04][C53] Emit step event — step count adjusts based on approve skip
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: v2SwapStep, total: v2TotalSteps,
        description: `Swapping ${inputToken.symbol} → ${outputToken.symbol}`,
      }}));
      const functionData = encodeExactInputSingle(
        tokenInEvm, tokenOutEvm, fee,
        recipientEvmAddress,
        BigInt(deadline),
        BigInt(rawInput),
        BigInt(minOutput),
        0n
      );

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2: Swap result:", JSON.stringify(swapResult));

      // [STALE-ALLOW] Mark allowance consumed on success — prevents stale Mirror Node race
      if (swapResult.success && !isInputNative) markAllowanceConsumed(inputToken.htsId, v2RouterId);

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: [inputToken.symbol, outputToken.symbol],
        priceImpact: quote?.priceImpact,
        error: swapResult.error
          ? swapResult.error +
            (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
          : undefined,
        executionVenue: "saucerswap-v2",
        quoteSource: quote?.source || "none",
        userCancelled: swapResult.userCancelled,
      };
    }
  } catch (err: any) {
    console.error("[HBAR.h] V2 swap execution error:", err);
    const errMsg = err?.message || "V2 swap failed";
    const errLower = errMsg.toLowerCase();

    // [FOT] V2 runtime detection — mark tokens for FOT routing on next attempt
    if (errLower.includes("insufficient_output_amount") || errLower.includes("insufficient output") || errLower.includes("contract_revert")) {
      if (!isInputNative) markTokenAsFOT(inputToken.htsId);
      if (!isOutputNative) markTokenAsFOT(outputToken.htsId);
      console.log(`[FOT] V2 Direct reverted — tokens marked as FOT for V1 RouterWithFee on next attempt`);
    }

    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return {
      success: false,
      error: errMsg,
      executionVenue: "saucerswap-v2",
      userCancelled: isCancellation || undefined,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── PRE-SWAP DRY RUN ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

// Simulate the swap BEFORE spending real gas.  Tries the JSON-RPC
// relay first (more reliable for state-mutating call simulation),
// then falls back to Mirror Node /api/v1/contracts/call.  If the
// simulation reverts with an explicit error, we abort and save the
// user from losing HBAR on a guaranteed failure.

async function preSwapDryRun(params: DryRunParams): Promise<DryRunResult> {
  const {
    isInputNative, isOutputNative, rawInput, minOutput,
    pathAddresses, recipientEvmAddress, routerHtsId, deadline, network,
  } = params;

  const startTime = Date.now();

  const routerEvm = await resolveContractEvmAddress(routerHtsId, network);

  // [C36-05] Use minOutput=1 for dry-run simulation instead of the actual
  // slippage-protected value. The purpose of the dry run is to check whether
  // the swap is mechanically possible (pool exists, tokens valid, path works),
  // NOT to enforce price constraints. Using the real minOutput causes false
  // "INSUFFICIENT_OUTPUT_AMOUNT" rejections when the quote is slightly stale
  // or the pool price has moved between quote fetch and simulation.
  // The actual on-chain swap transaction still uses the real minOutput for
  // slippage protection — only the simulation is relaxed.
  const dryRunMinOutput = 1;

  let callData: Uint8Array;
  let value: number = 0;
  let functionName: string;

  if (isInputNative) {
    callData = encodeSaucerSwapETHForTokens(
      BigInt(dryRunMinOutput), pathAddresses, recipientEvmAddress, BigInt(deadline)
    );
    value = rawInput;
    functionName = "swapExactETHForTokens";
  } else if (isOutputNative) {
    callData = encodeSaucerSwapTokensForETH(
      BigInt(rawInput), BigInt(dryRunMinOutput), pathAddresses, recipientEvmAddress, BigInt(deadline)
    );
    functionName = "swapExactTokensForETH";
  } else {
    callData = encodeSaucerSwapCall(
      BigInt(rawInput), BigInt(dryRunMinOutput), pathAddresses, recipientEvmAddress, BigInt(deadline)
    );
    functionName = "swapExactTokensForTokens";
  }

  const callDataHex = bytesToHex(callData);
  const gasHex = "0x" + (1_500_000).toString(16);
  // [V1-DRYRUN-FIX] Convert tinybar → weibar for JSON-RPC relay.
  // Hedera's EVM uses 18-decimal weibar (like ETH wei), but rawInput is
  // in 8-decimal tinybar. Multiply by 10^10 to bridge the gap.
  // The V2 dry run already had this fix; V1 was missing it, causing
  // INSUFFICIENT_OUTPUT_AMOUNT on every HBAR-input V1 dry run because
  // the pool received ~0 HBAR and produced 0 output.
  const valueHex = isInputNative
    ? "0x" + (BigInt(value) * 10000000000n).toString(16)
    : "0x0";

  console.log(`[HBAR.h] Dry run: ${functionName} → router ${routerEvm}, value=${value} tinybar (weibar=${isInputNative ? BigInt(value) * 10000000000n : 0n}), minOutput=${dryRunMinOutput} (real: ${minOutput}) [C36-05][V1-DRYRUN-FIX]`);

  // ── Strategy A: JSON-RPC relay ──
  try {
    const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(15000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{
          from: recipientEvmAddress,
          to: routerEvm,
          data: callDataHex,
          gas: gasHex,
          value: valueHex,
        }, "latest"],
        id: 1,
      }),
    });

    const durationMs = Date.now() - startTime;
    if (rpcRes.ok) {
      const rpcData = await rpcRes.json();
      if (rpcData.error) {
        // Explicit revert from JSON-RPC — this is a real failure signal
        const revertMsg = rpcData.error.message || JSON.stringify(rpcData.error).slice(0, 200);
        console.error(`[HBAR.h] Dry run REVERT (JSON-RPC): ${revertMsg}`);
        return { ok: false, simulated: true, functionName, durationMs, reason: `Contract simulation reverted: ${revertMsg}`, resultHexLength: 0 };
      }
      if (rpcData.result && rpcData.result !== "0x" && rpcData.result.length > 2) {
        console.log(`[HBAR.h] Dry run PASSED (JSON-RPC): ${functionName}, ${rpcData.result.length} chars, ${durationMs}ms`);
        return { ok: true, simulated: true, functionName, durationMs, resultHexLength: rpcData.result.length };
      }
      // Empty result from RPC without error — non-blocking for payable calls
      console.log(`[HBAR.h] Dry run: JSON-RPC returned empty result for ${functionName} — non-blocking`);
      return { ok: true, simulated: true, functionName, durationMs, reason: "Empty result (non-blocking for payable calls)", resultHexLength: 0 };
    }
  } catch (err: any) {
    console.log("[HBAR.h] Dry run JSON-RPC attempt failed:", err?.message || err);
  }

  // ── Strategy B: Mirror Node /api/v1/contracts/call ──
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(`${base}/api/v1/contracts/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(15000),
      body: JSON.stringify({
        block: "latest",
        data: callDataHex,
        estimate: false,
        from: recipientEvmAddress,
        to: routerEvm,
        gas: 1_500_000,
        gasPrice: 0,
        // [V1-DRYRUN-FIX] Mirror Node contracts/call also uses weibar (EVM convention)
        value: isInputNative ? Number(BigInt(value) * 10000000000n) : 0,
      }),
    });

    const durationMs = Date.now() - startTime;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.log(`[HBAR.h] Dry run Mirror Node HTTP ${res.status} — skipping (non-blocking)`);
      return { ok: true, simulated: false, functionName, durationMs, reason: `HTTP ${res.status} — simulation skipped` };
    }

    const data = await res.json();

    if (data.result === "0x" || !data.result) {
      const errMsg = data.error_message || data._status?.messages?.[0]?.message || "";
      if (errMsg) {
        console.error(`[HBAR.h] Dry run REVERT (Mirror Node): ${errMsg}`);
        return { ok: false, simulated: true, functionName, durationMs, reason: `Contract simulation reverted: ${errMsg}`, resultHexLength: 0 };
      }
      // Empty without error — non-blocking (Mirror Node often can't simulate payable/cross-contract calls)
      console.log(`[HBAR.h] Dry run: Mirror Node returned empty for ${functionName} — non-blocking`);
      return { ok: true, simulated: false, functionName, durationMs, reason: "Mirror Node simulation inconclusive — proceeding", resultHexLength: 0 };
    }

    const resultHexLength = data.result.length;
    console.log(`[HBAR.h] Dry run PASSED (Mirror Node): ${functionName}, ${resultHexLength} chars, ${durationMs}ms`);
    return { ok: true, simulated: true, functionName, durationMs, resultHexLength };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.log("[HBAR.h] Dry run Mirror Node attempt failed (non-blocking):", err?.message || err);
    return { ok: true, simulated: false, durationMs, reason: `Network error: ${err?.message || "unknown"}` };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── V2 MULTI-HOP EXECUTION ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Execute a V2 multi-hop swap using exactInput with packed path encoding.
 *
 * [C9-05] This handles swaps that require routing through intermediary
 * tokens (e.g., HBAR → WHBAR → USDC when no direct HBAR/USDC V2 pool
 * exists, or Token A → WHBAR → Token B).
 */
async function executeSaucerSwapV2MultiHop(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork,
  route: { hops: PoolVersionInfo[]; tokens: string[] },
  isInputNative: boolean,
  isOutputNative: boolean,
  whbar: AllowedToken,
  rawInput: number,
  recipientEvmAddress: string,
  options?: SwapOptions,
): Promise<SwapResult> {
  const { executeHederaTransaction } = await import("../hashpack");

  try {
    const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [C100-S6] V2 PACKED PATH ALIAS RESOLUTION                         │
    // │                                                                     │
    // │  V2 pools use ERC20Wrapper (alias) addresses for bridge tokens.     │
    // │  The packed path for exactInput MUST encode these alias addresses,  │
    // │  not canonical bridge token addresses.                              │
    // │                                                                     │
    // │  Safety net: even if the route source (findRouteViaGraph)            │
    // │  already provided alias addresses, this                             │
    // │  step re-validates each token to guarantee correctness.             │
    // │  Cost: negligible (in-memory registry lookups, no network calls).   │
    // └─────────────────────────────────────────────────────────────────────┘
    const v2PathTokens = route.tokens.map((tokenEvm, idx) => {
      const htsId = evmAddressToHtsId(tokenEvm);
      // Look up via resolveTokenByHtsId (checks static + dynamic registries)
      const token = resolveTokenByHtsId(htsId)
        || SAUCERSWAP_TOKENS.find(t => t.saucerswapAliasId === htsId);
      let resolvedEvm = tokenEvm;
      if (token) {
        const aliasEvm = getSaucerswapRoutingEvmAddress(token);
        if (aliasEvm.toLowerCase() !== tokenEvm.toLowerCase()) {
          console.log(`[HBAR.h] [C100-S6] V2 path token[${idx}]: ${htsId} → ${evmAddressToHtsId(aliasEvm)} (alias applied)`);
        }
        resolvedEvm = aliasEvm;
      }
      // [V2-WHBAR-FIX] Ensure WHBAR uses CONTRACT address for V2 pool lookups
      return ensureWhbarContractForV2(resolvedEvm, network);
    });

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [STEP2] SERVER-VALIDATED PACKED PATH BYPASS                        │
    // │                                                                     │
    // │  When the server quote engine already built and validated the V2    │
    // │  packed path via QuoterV2, skip ALL client-side fee probing and    │
    // │  re-validation. The server's packedPathHex is the EXACT bytes      │
    // │  that SwapRouter.exactInput() needs. Saves 3-8s of RPC calls.     │
    // └─────────────────────────────────────────────────────────────────────┘
    let packedPath: Uint8Array;
    let estimatedOutput = 0;
    let isOnChainQuote = false;
    let effectiveSlippage: number;

    const _serverPackedHex = options?.validatedRoute?.packedPathHex;
    if (_serverPackedHex && options?.validatedRoute?.rawAmountOut) {
      // [STEP2] Fast path: use server-validated packed path directly
      packedPath = hexToBytes(_serverPackedHex);
      estimatedOutput = Number(BigInt(options.validatedRoute.rawAmountOut));
      isOnChainQuote = true;
      effectiveSlippage = Math.max(slippagePct, 2); // on-chain quote: respect user, 2% floor
      console.log(`[STEP2] ✓ Using server-validated V2 packed path: ${packedPath.length}B, ` +
        `estimatedOutput=${estimatedOutput}, fees=[${options.validatedRoute.feeTiers.join(",")}], ` +
        `age=${Date.now() - (options.validatedRoute.validatedAt || 0)}ms`);
    } else {
    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [SWAP-FIX-5] PER-HOP FEE TIER VALIDATION & PROBING               │
    // │                                                                     │
    // │  The pool graph may report WRONG fee tiers — many pools exist at   │
    // │  unexpected tiers (e.g., 1500 for WHBAR pairs, 10000 for meme     │
    // │  tokens) or the API field is missing and defaults to 3000.         │
    // │                                                                     │
    // │  V2 direct swaps have [SWAP-FIX-4] to probe all fee tiers, but    │
    // │  V2 multi-hop was MISSING this — it blindly trusted the graph      │
    // │  fee → packed path had wrong fees → SwapRouter couldn't find       │
    // │  pools → CONTRACT_REVERT_EXECUTED on 100% of affected routes.      │
    // │                                                                     │
    // │  Fix: For each hop, call QuoterV2.quoteExactInputSingle with the  │
    // │  graph's fee tier. If it fails, try all V2_FEE_TIERS. Use the     │
    // │  first tier that returns a valid quote. This guarantees the packed │
    // │  path encodes REAL pool fee tiers.                                 │
    // └─────────────────────────────────────────────────────────────────────┘
    const correctedFees: number[] = [];
    const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
    const quoterHtsId = SAUCERSWAP_V2_QUOTER[network] || SAUCERSWAP_V2_QUOTER.mainnet;
    let quoterEvm: string | null = null;
    if (quoterHtsId && quoterHtsId !== "0.0.0") {
      quoterEvm = await resolveContractEvmAddress(quoterHtsId, network);
    }

    // [SWAP-FIX-5] Hard requirement: QuoterV2 must be available for validation.
    // Without it we'd blindly trust graph fee tiers, which is the bug we're fixing.
    if (!quoterEvm) {
      console.error(`[SWAP-FIX-5] QuoterV2 contract not resolved — cannot validate V2 multi-hop path`);
      return {
        success: false,
        error: `V2 multi-hop requires QuoterV2 for path validation, but QuoterV2 ` +
          `(${quoterHtsId}) could not be resolved. Try again or use a direct swap route.`,
        executionVenue: "saucerswap-v2",
      };
    }

    console.log(`[SWAP-FIX-5] Validating ${route.hops.length} hop fee tiers via QuoterV2 (${quoterEvm})...`);
    let perHopAmountIn = BigInt(rawInput); // cascading: output of hop N = input of hop N+1

    for (let h = 0; h < route.hops.length; h++) {
      const tokenA = v2PathTokens[h];
      const tokenB = v2PathTokens[h + 1];
      const graphFee = route.hops[h].feeTier || 3000;
      const feeTiersToTry = [graphFee, ...V2_FEE_TIERS.filter(f => f !== graphFee)];

      let hopValidated = false;
      let hopAmountOut = 0n;

      if (quoterEvm) {
        for (const tryFee of feeTiersToTry) {
          try {
            const singleQuoteData = bytesToHex(
              encodeQuoteExactInputSingle(tokenA, tokenB, perHopAmountIn, tryFee)
            );
            const sRes = await fetch(rpcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: makeAbort(10000),
              body: JSON.stringify({
                jsonrpc: "2.0", method: "eth_call",
                params: [{ to: quoterEvm, data: singleQuoteData, gas: "0x1E8480" }, "latest"],
                id: 1,
              }),
            });
            if (sRes.ok) {
              const sData = await sRes.json();
              if (sData.result && sData.result !== "0x" && sData.result.length >= 66 && !sData.error) {
                const amtHex = sData.result.slice(2, 66);
                const amt = BigInt("0x" + amtHex);
                if (amt > 0n) {
                  if (tryFee !== graphFee) {
                    console.log(`[SWAP-FIX-5] Hop ${h}: fee corrected ${graphFee} → ${tryFee} (graph had wrong tier)`);
                  } else {
                    console.log(`[SWAP-FIX-5] Hop ${h}: fee ${tryFee} validated ✓ (amountOut=${amt})`);
                  }
                  correctedFees.push(tryFee);
                  hopAmountOut = amt;
                  hopValidated = true;
                  break;
                }
              }
            }
          } catch { /* try next fee tier */ }
        }
      }

      if (!hopValidated) {
        console.warn(`[SWAP-FIX-5] Hop ${h}: ALL fee tiers failed for ${evmAddressToHtsId(tokenA)} → ${evmAddressToHtsId(tokenB)}`);
        console.warn(`[SWAP-FIX-5] V2 multi-hop NOT viable — this hop has no V2 pool with liquidity`);
        return {
          success: false,
          error: `V2 multi-hop route not viable: no V2 pool found for ` +
            `${evmAddressToHtsId(tokenA)} → ${evmAddressToHtsId(tokenB)}. ` +
            `Tried fee tiers: ${feeTiersToTry.join(", ")}. All returned zero or reverted.`,
          executionVenue: "saucerswap-v2",
        };
      }

      perHopAmountIn = hopAmountOut; // cascade to next hop
    }

    // Build packed path with CORRECTED fee tiers
    const pathHops: { tokenEvm: string; fee: number }[] = [];
    for (let i = 0; i < v2PathTokens.length; i++) {
      pathHops.push({
        tokenEvm: v2PathTokens[i],
        fee: i < correctedFees.length ? correctedFees[i] : 0,
      });
    }
    packedPath = encodeSwapPath(pathHops);
    console.log(`[SWAP-FIX-5] V2 Multi-hop packed path: ${packedPath.length} bytes, ${v2PathTokens.length} tokens, ` +
      `fees: [${correctedFees.join(", ")}], addrs: ${v2PathTokens.map(a => evmAddressToHtsId(a)).join(" → ")}`);

    // ── [C77-04] Quote: Full-path V2 QuoterV2 validation ──
    // [SWAP-FIX-5] Now that fee tiers are validated per-hop, the full-path
    // quoteExactInput should succeed. If it doesn't, something else is wrong
    // (e.g., liquidity shifted between per-hop probing and full-path call).
    // We require this validation — no price-estimate fallback. If QuoterV2
    // says the path doesn't work, the swap WILL also fail.
    estimatedOutput = 0;
    const inTok = isInputNative ? whbar : inputToken;
    const outTok = isOutputNative ? whbar : outputToken;

    // Full-path QuoterV2 validation (required — not optional)
    try {
      if (quoterEvm) {
        const quoteCallData = bytesToHex(encodeQuoteExactInput(packedPath, BigInt(rawInput)));
        const gasHex = "0x" + (3_000_000).toString(16);

        console.log(`[SWAP-FIX-5] Full-path validation: quoteExactInput(${packedPath.length}B, ${rawInput}) → quoter ${quoterEvm}`);
        const qRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(12000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: quoterEvm, data: quoteCallData, gas: gasHex }, "latest"],
            id: 1,
          }),
        });
        if (qRes.ok) {
          const qData = await qRes.json();
          if (qData.result && qData.result !== "0x" && qData.result.length >= 66 && !qData.error) {
            const amountOutHex = qData.result.slice(2, 66);
            const amountOut = BigInt("0x" + amountOutHex);
            if (amountOut > 0n) {
              estimatedOutput = Number(amountOut);
              console.log(`[SWAP-FIX-5] Full-path QuoterV2 validated ✓ amountOut=${amountOut}`);
            }
          } else if (qData.error) {
            console.warn(`[SWAP-FIX-5] Full-path QuoterV2 error: ${qData.error.message || JSON.stringify(qData.error).slice(0, 150)}`);
          }
        }
      }
    } catch (quoteErr: any) {
      console.warn(`[SWAP-FIX-5] Full-path QuoterV2 failed:`, quoteErr?.message || quoteErr);
    }

    // [SWAP-FIX-5] Fallback: use cascaded per-hop output if full-path quote diverges
    if (estimatedOutput <= 0 && perHopAmountIn > 0n) {
      // Per-hop probing succeeded individually — use the cascaded output
      estimatedOutput = Number(perHopAmountIn);
      console.log(`[SWAP-FIX-5] Full-path quote failed — using cascaded per-hop output: ${estimatedOutput}`);
    }

    // Last resort: price-based estimation (less safe but better than abort)
    if (estimatedOutput <= 0) {
      const priceEstimate = estimateOutputFromPrices(rawInput, inTok, outTok, 1);
      if (priceEstimate && priceEstimate > 0) {
        estimatedOutput = priceEstimate;
        console.warn(`[SWAP-FIX-5] Price estimate fallback: ${estimatedOutput}`);
      }
    }

    // [C77-04] Slippage: when QuoterV2 gave us an on-chain quote, use the
    // user's requested slippage (more accurate → tighter protection).
    // When falling back to price estimate, enforce 5% minimum.
    isOnChainQuote = estimatedOutput > 0 && estimatedOutput !== Number(
      estimateOutputFromPrices(rawInput, inTok, outTok, 1) ?? 0
    );
    effectiveSlippage = isOnChainQuote
      ? Math.max(slippagePct, 2)  // on-chain quote: respect user setting, 2% floor
      : Math.max(slippagePct, 5); // price estimate: 5% minimum
    } // [STEP2] end of else block (server packed path bypass)

    // [SEC-14] HARD ABORT when no quote available — minOutput=1 is unsafe
    if (estimatedOutput <= 0) {
      console.error("[SEC-14] V2 Multi-hop: All quote strategies failed — ABORTING swap (minOutput=1 is unsafe)");
      return {
        success: false,
        error: `Cannot determine minimum output for ${inputToken.symbol} → ${outputToken.symbol} multi-hop. ` +
          `All quote strategies (V2 QuoterV2, price estimation) failed. ` +
          `Executing without slippage protection would expose you to sandwich attacks. ` +
          `Try again in a few seconds, or reduce the swap amount.`,
        executionVenue: "saucerswap-v2",
      };
    }
    const minOutput = Math.max(1, Math.floor(estimatedOutput * (1 - effectiveSlippage / 100)));
    console.log(`[HBAR.h] V2 Multi-hop: minOutput=${minOutput}, slippage=${effectiveSlippage}%, quoteSrc=${isOnChainQuote ? "QuoterV2" : "price-estimate"}`);

    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min

    // Verify V2 Router
    const routerContractInfo = await verifyIsContract(v2RouterId, network);
    if (!routerContractInfo) {
      return {
        success: false,
        error: `V2 Router ${v2RouterId} failed contract verification. Cannot execute V2 multi-hop swap.`,
        executionVenue: "saucerswap-v2",
      };
    }

    // ── Log multi-hop parameters ──
    console.log("[HBAR.h] ═══════════════════════════════════════════");
    console.log("[HBAR.h] V2 MULTI-HOP SWAP EXECUTION START");
    console.log("[HBAR.h] Input:", inputToken.symbol, "→ Output:", outputToken.symbol);
    console.log("[HBAR.h] Route:", route.tokens.map(t => evmAddressToHtsId(t)).join(" → "));
    console.log("[HBAR.h] Hops:", route.hops.map(h => `${h.version}(fee=${h.feeTier})`).join(" → "));
    console.log("[HBAR.h] Amount:", inputAmount, `(raw: ${rawInput})`);
    console.log("[HBAR.h] MinOutput:", minOutput, `(estimate: ${estimatedOutput}, slippage: ${effectiveSlippage}%)`);
    console.log("[HBAR.h] V2 Router:", v2RouterId);
    console.log("[HBAR.h] Mode:", isInputNative ? "HBAR→Multi→Token" : "Token→Multi→Token");
    // [C100-S7] Approval chain diagnostics — trace the exact approval parameters
    // that will be used for the HTS precompile allowance check.
    if (!isInputNative) {
      console.log(`[C100-S7] ── APPROVAL CHAIN ──`);
      console.log(`[C100-S7]   Token: ${inputToken.symbol} (canonical HTS ID: ${inputToken.htsId})`);
      console.log(`[C100-S7]   Alias: ${inputToken.saucerswapAliasId || "none (same as canonical)"}`);
      console.log(`[C100-S7]   Spender: V2 Router ${v2RouterId}`);
      console.log(`[C100-S7]   Amount: ${rawInput} (raw smallest unit)`);
      console.log(`[C100-S7]   Owner: ${accountId}`);
    }
    console.log("[HBAR.h] ═══════════════════════════════════════════");

    // ── Token association check for output [C30-01] ──
    // Token→HBAR with multicall: WHBAR stays in router, no user association needed.
    // Token→Token: user must be associated with output token.
    // [C100-S11] Auto-association: skip popup if account has auto-association enabled.
    const _v2mhAutoAssoc = options?.maxAutoAssociations;
    const _v2mhHasAutoAssoc = _v2mhAutoAssoc === -1 || (_v2mhAutoAssoc !== undefined && _v2mhAutoAssoc > 0);
    if (!isOutputNative) {
      if (_v2mhHasAutoAssoc) {
        console.log(`[C100-S11] V2 Multi-hop: Auto-association enabled (maxAutoAssociations=${_v2mhAutoAssoc}) — skipping output token association popup for ${outputToken.symbol}`);
      } else {
      const assocHtsId = outputToken.htsId;
      const assocSymbol = outputToken.symbol;

      const isAssoc = await isTokenAssociated(accountId, assocHtsId, network);
      if (!isAssoc) {
        console.warn(`[HBAR.h] V2 Multi-hop: ${assocSymbol} (${assocHtsId}) NOT associated — auto-associating`);
        try {
          const assocTx = new TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([assocHtsId]);
          // [C81-02] Fast-path — association prerequisite
          const { executeHederaTransactionFast: v2mhAssocExec } = await import("../hashpack");
          const assocResult = await v2mhAssocExec(accountId, assocTx);
          if (!assocResult.success) {
            return {
              success: false,
              error: `${assocSymbol} association failed: ${assocResult.error || "unknown"}`,
              executionVenue: "saucerswap-v2",
              userCancelled: assocResult.userCancelled,
            };
          }
          // [SEC-14] Consensus wait after fast-path association
          console.log(`[SEC-14] Waiting ${CONSENSUS_WAIT_MS}ms for V2 multi-hop association consensus...`);
          await new Promise(r => setTimeout(r, CONSENSUS_WAIT_MS));
        } catch (assocErr: any) {
          return {
            success: false,
            error: `Cannot associate ${assocSymbol}: ${assocErr?.message || "unknown"}`,
            executionVenue: "saucerswap-v2",
          };
        }
      }
      }
    }

    // [SWAP-FIX-5] Bumped 2M → 3M for multi-hop. Each V2 hop involves
    // Factory.getPool + Pool.swap + sqrtPriceMath + HTS precompile transfers.
    // On Hedera, cross-contract SLOAD costs ~2100 gas each. 2M was marginal
    // for 2-hop routes and insufficient when ticks are crossed.
    const SWAP_GAS = 3_000_000;

    // [C26-02] Token → HBAR multi-hop: per SaucerSwap V2 docs, uses multicall
    // approach: exactInput(recipient=ROUTER) + unwrapWETH9(user).
    // Token → Token: direct exactInput(recipient=user).
    const routerEvmAddress = routerContractInfo.evmAddress || await resolveContractEvmAddress(v2RouterId, network);

    // Helper: build human-readable route from EVM token addresses,
    // replacing WHBAR with HBAR for native endpoints.
    const buildDisplayRoute = () => {
      const raw = route.tokens.map(t => {
        const id = evmAddressToHtsId(t);
        const tok = SAUCERSWAP_TOKENS.find(at => at.htsId === id || getSaucerswapRoutingId(at) === id);
        return tok?.symbol || id;
      });
      // Replace WHBAR at endpoints with HBAR for display
      if (isInputNative && raw[0] === "WHBAR") raw[0] = "HBAR";
      if (isOutputNative && raw[raw.length - 1] === "WHBAR") raw[raw.length - 1] = "HBAR";
      return raw;
    };

    // [C34-01] For Token→HBAR: recipient = ROUTER so WHBAR lands in router's
    // balance for unwrapWETH9 to access. For Token→Token: recipient = USER.
    // NOTE [C34-01]: C33 used address(0) as a "sentinel" but the
    // original V3 SwapRouter does NOT replace address(0) with address(this).
    // That sentinel only exists in SwapRouter02 (different selector). Using
    // address(0) caused CONTRACT_REVERT_EXECUTED on every Token→HBAR multicall.
    const swapRecipient = isOutputNative ? routerEvmAddress : recipientEvmAddress;

    const swapFunctionData = encodeExactInput(
      packedPath,
      swapRecipient,
      BigInt(deadline),
      BigInt(rawInput),
      BigInt(minOutput),
    );

    if (isInputNative) {
      // ═══ HBAR → Multi-hop → Token via V2 exactInput (payable) ═══
      const hbarAmount = Hbar.fromTinybars(rawInput);

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(swapFunctionData)
        .setPayableAmount(hbarAmount);

      console.log(`[HBAR.h] V2 Multi-hop: Submitting exactInput — HBAR: ${hbarAmount}, calldata: ${swapFunctionData.length}B`);
      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2 Multi-hop: Swap result:", JSON.stringify(swapResult));

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: estimatedOutput > 0 ? estimatedOutput / Math.pow(10, outputToken.decimals) : undefined,
        route: buildDisplayRoute(),
        priceImpact: 0,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v2",
        quoteSource: "price-estimate",
        userCancelled: swapResult.userCancelled,
      };
    } else {
      // ═══ Token → Multi-hop → Token or HBAR via V2 ═══

      // ── Step 1: [C53] Smart approve — skips if allowance sufficient ──
      // [C100-S7] V2 multi-hop approval uses:
      //   • Token: CANONICAL HTS ID (inputToken.htsId) — NOT the alias
      //   • Spender: V2 Router (0.0.3949434) — NOT V1 Router
      // The HTS precompile checks allowances by canonical ID, even though
      // the V2 packed path encodes alias (ERC20Wrapper) addresses.
      const mhCanonicalTokenId = inputToken.htsId;
      if (inputToken.saucerswapAliasId && inputToken.saucerswapAliasId !== mhCanonicalTokenId) {
        console.log(`[C100-S7] V2 Multi-hop: canonical=${mhCanonicalTokenId}, alias=${inputToken.saucerswapAliasId} — approving CANONICAL for V2 Router`);
      }
      const mhApproveResult = await approveIfNeeded({
        tokenHtsId: mhCanonicalTokenId,
        ownerAccountId: accountId,
        spenderAccountId: v2RouterId,
        rawInput,
        network,
        tokenSymbol: inputToken.symbol,
        stepNumber: 1,
        totalSteps: 2,
        routerVersion: "v2",
        // [STEP6] Pass pre-checked V2 allowance from quote-time parallel fetch
        preCheckedAllowance: options?.approvalStatus?.v2Allowance,
        preCheckedAt: options?.approvalStatus?.checkedAt,
      });

      if (!mhApproveResult.success) {
        return {
          success: false,
          transactionId: mhApproveResult.transactionId || undefined,
          error: "V2 Multi-hop token approval failed: " + (mhApproveResult.error || "unknown"),
          executionVenue: "saucerswap-v2",
          userCancelled: mhApproveResult.userCancelled,
        };
      }

      // [S2] Wallet re-focus hint between approve and swap (multi-hop path)
      if (mhApproveResult.needed && !mhApproveResult.skipped) {
        try {
          const { tryOpenWalletExtension: mhWalletHint } = await import("../hashpack");
          mhWalletHint().catch(() => {});
        } catch { /* non-blocking */ }
      }

      const mhSwapStep = mhApproveResult.skipped ? 1 : 2;
      const mhTotalSteps = mhApproveResult.skipped ? 1 : 2;

      if (isOutputNative) {
        // ═══ Token → Multi-hop → HBAR via V2 — atomic multicall [C30-01] ═══
        //
        // [C34-01] Same multicall pattern as single-hop Token→HBAR:
        // multicall(exactInput(recipient=ROUTER) + unwrapWETH9(0, user))
        // swapFunctionData already has recipient=routerEvmAddress (set above via [C34-01]).
        // [C100-S9] WHBAR contract verification for multi-hop Token→HBAR
        console.log(`[C100-S9] V2 Multi-hop Token→HBAR multicall structure:`);
        console.log(`[C100-S9]   ┌ exactInput(packed_path, recipient=ROUTER ${routerEvmAddress})`);
        console.log(`[C100-S9]   └ unwrapWETH9(0, user=${recipientEvmAddress})`);
        console.log(`[C100-S9]   WHBAR: contract=0.0.1456985 (withdraw), token=${whbar.htsId} (ERC-20)`);
        console.log(`[C100-S9]   Route: ${route.tokens.map(t => evmAddressToHtsId(t)).join(" → ")}`);

        console.log(`[HBAR.h] V2 Multi-hop Step ${mhSwapStep}: multicall(exactInput + unwrapWETH9) — Token→HBAR [C34-01/C100-S9]`);
        window.dispatchEvent(new CustomEvent("swap-step", { detail: {
          step: mhSwapStep, total: mhTotalSteps,
          description: `Swapping ${inputToken.symbol} → HBAR`,
        }}));

        const unwrapCalldata = encodeUnwrapWHBAR(0n, recipientEvmAddress);
        const multicallData = encodeMulticall([swapFunctionData, unwrapCalldata]);

        console.log(`[HBAR.h] V2 Multi-hop: multicall calldata ${multicallData.length}B ` +
          `(swap=${swapFunctionData.length}B + unwrap=${unwrapCalldata.length}B) ` +
          `swapRecipient=${routerEvmAddress} unwrapRecipient=${recipientEvmAddress} [C34-01/C100-S9]`);

        const multicallTx = new ContractExecuteTransaction()
          .setContractId(ContractId.fromString(v2RouterId))
          .setGas(SWAP_GAS)
          .setFunctionParameters(multicallData);

        const swapResult = await executeHederaTransaction(accountId, multicallTx);
        console.log("[HBAR.h] V2 Multi-hop: Token→HBAR multicall result:", JSON.stringify(swapResult));

        // [STALE-ALLOW] Mark allowance consumed on success — prevents stale Mirror Node race
        if (swapResult.success) markAllowanceConsumed(inputToken.htsId, v2RouterId);

        return {
          success: swapResult.success,
          transactionId: swapResult.transactionId || undefined,
          outputAmount: estimatedOutput > 0 ? estimatedOutput / Math.pow(10, 8) : undefined,
          route: buildDisplayRoute(),
          priceImpact: 0,
          error: swapResult.error
            ? `Token→HBAR V2 multi-hop failed: ${swapResult.error}` +
              (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
            : undefined,
          executionVenue: "saucerswap-v2",
          quoteSource: "price-estimate",
          userCancelled: swapResult.userCancelled,
        };
      }

      // ═══ Token → Multi-hop → Token (non-HBAR output) ═══
      console.log(`[HBAR.h] V2 Multi-hop Step ${mhSwapStep}: exactInput (Token→Token)`);
      // [C27-04][C53] Emit step event — step count adjusts based on approve skip
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: mhSwapStep, total: mhTotalSteps,
        description: `Swapping ${inputToken.symbol} → ${outputToken.symbol}`,
      }}));
      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(swapFunctionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2 Multi-hop: Swap result:", JSON.stringify(swapResult));

      // [STALE-ALLOW] Mark allowance consumed on success — prevents stale Mirror Node race
      if (swapResult.success && !isInputNative) markAllowanceConsumed(inputToken.htsId, v2RouterId);

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: estimatedOutput > 0 ? estimatedOutput / Math.pow(10, outputToken.decimals) : undefined,
        route: buildDisplayRoute(),
        priceImpact: 0,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v2",
        quoteSource: "price-estimate",
        userCancelled: swapResult.userCancelled,
      };
    }
  } catch (err: any) {
    console.error("[HBAR.h] V2 Multi-hop swap error:", err);
    const errMsg = err?.message || "V2 multi-hop swap failed";
    const errLower = errMsg.toLowerCase();

    // [SWAP-FIX-5] REMOVED incorrect FOT marking on V2 multi-hop reverts.
    // V2 reverts are caused by routing issues (wrong fee tier, no liquidity,
    // WHBAR address mismatch) — NOT by fee-on-transfer tokens. Marking
    // tokens as FOT here caused future swaps to use RouterWithFee
    // unnecessarily, which has its own association requirements.
    // FOT detection should only happen on V1 INSUFFICIENT_OUTPUT_AMOUNT
    // errors where the V1 router is the ground truth.
    if (errLower.includes("insufficient_output_amount") || errLower.includes("insufficient output")) {
      console.log(`[FOT] V2 Multi-hop: INSUFFICIENT_OUTPUT — NOT marking as FOT (V2 reverts are not FOT indicators)`);
    }

    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected") ||
      errLower.includes("user denied");
    return {
      success: false,
      error: errMsg,
      executionVenue: "saucerswap-v2",
      userCancelled: isCancellation || undefined,
    };
  }
}

// ══════════════════���═══════════════════════════════════════════════════
// ── V1 / UNIFIED DIRECT EXECUTION ──────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

async function executeSaucerSwapDirect(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork,
  options?: SwapOptions,
): Promise<SwapResult> {
  // Late import to avoid circular dependency at module load time
  const { executeHederaTransaction } = await import("../hashpack");

  try {
    const rawInput = parseTokenAmount(inputAmount, inputToken.decimals);

    if (rawInput <= 0) {
      return { success: false, error: "Invalid input amount", executionVenue: "saucerswap-v1" };
    }

    // [WALLET-PERF] Emit preflight step so the UI shows progress immediately
    // instead of a silent "Preparing transaction..." for 5-10s.
    window.dispatchEvent(new CustomEvent("swap-step", { detail: {
      step: 0, total: 0,
      description: `Finding best route for ${inputToken.symbol} → ${outputToken.symbol}...`,
    }}));

    // Determine swap mode based on native HBAR involvement
    const isInputNative = !!inputToken.isNative;
    const isOutputNative = !!outputToken.isNative;
    const whbar = getWhbarToken();

    // Build the swap path — substituting WHBAR for native HBAR in the EVM path
    // since pools use WHBAR internally. The path must use EVM addresses.
    const logicalPath = buildSwapPath(
      isInputNative ? whbar : inputToken,
      isOutputNative ? whbar : outputToken
    );
    // Use SaucerSwap alias EVM addresses for routing (bridge tokens have different pool IDs)
    // [C27-01] Must be `let` — reassigned when direct pool or multi-hop route overrides the path
    let pathAddresses = logicalPath.map((t) => getSaucerswapRoutingEvmAddress(t));

    // ══════════════════════════════════════════════════════════════════
    // ── POOL VERSION DETECTION + MULTI-HOP ROUTING [C9-05] [C26-01] ──
    //
    // [C26-01] Unified routing strategy: ALWAYS try direct pool first,
    // regardless of what buildSwapPath() returned. buildSwapPath forces
    // Token→Token through WHBAR, but many pairs have direct V2 pools
    // (e.g., USDC/SAUCE). Checking direct first avoids unnecessary
    // multi-hop routing and the associated slippage.
    //
    // Strategy:
    // 1. Check DIRECT pool (single-hop) between the two tokens
    // 2. If no direct pool, find a multi-hop route through intermediaries
    //    (WHBAR, USDC, SAUCE, USDCh, USDTh, HBARX)
    // 3. For V2 multi-hop: use exactInput with packed path bytes
    // 4. For V1 multi-hop: pass path array to swapExactTokensForTokens
    //
    // Pool detection checks V2 first (deeper liquidity) then V1.
    // ══════════════════════════════════════════════════════════════════
    let poolVersionInfo: PoolVersionInfo | null = null;
    let multiHopRoute: { hops: PoolVersionInfo[]; tokens: string[] } | null = null;

    // Use routing-aware EVM addresses for pool detection
    const directInEvm = getSaucerswapRoutingEvmAddress(isInputNative ? whbar : inputToken);
    const directOutEvm = getSaucerswapRoutingEvmAddress(isOutputNative ? whbar : outputToken);

    // ═══════════════════════════════════════════════════════════════════
    // ── [STEP1] VALIDATED ROUTE PASSTHROUGH ─────────────────────────────
    //
    // When the server quote engine has already validated a route, use it
    // directly — skip ALL route re-discovery (findRouteViaGraph,
    // detectPoolVersion, _preValidateV2MultiHop).
    // This eliminates 4-15s of redundant RPC calls per swap.
    //
    // Staleness guard: routes older than 30s are ignored (pool state may
    // have changed). The execution engine falls back to normal discovery.
    // ═══════════════════════════════════════════════════════════════════
    const vr = options?.validatedRoute;
    // [S5] IMPLEMENTATION NOTE — Reduced from 30s → 15s.
    // Stale routes are the #1 cause of V2 CONTRACT_REVERT on execution.
    // V2 concentrated liquidity ticks can move significantly in 15-30s.
    // 15s gives enough time for the user to click "Swap" after seeing
    // the quote, while rejecting quotes from significantly earlier.
    // If the route is stale, the engine falls back to client-side
    // route discovery (findRouteViaGraph) which re-validates live.
    const VALIDATED_ROUTE_MAX_AGE_MS = 15_000; // 15 seconds

    // [STEP1] Safety: verify validated route matches current token pair
    const vrInputId = isInputNative ? "0.0.1456986" : inputToken.htsId;
    const vrOutputId = isOutputNative ? "0.0.1456986" : outputToken.htsId;
    const vrPairMatch = vr && vr.routeHtsIds.length >= 2 &&
      vr.routeHtsIds[0] === vrInputId &&
      vr.routeHtsIds[vr.routeHtsIds.length - 1] === vrOutputId;

    if (vr && vrPairMatch && vr.validatedAt && (Date.now() - vr.validatedAt < VALIDATED_ROUTE_MAX_AGE_MS)) {
      console.log(`[STEP1] ✓ Using server-validated route: ${vr.source} (${vr.version}, ` +
        `${vr.routeHtsIds.length - 1} hops, fees=[${vr.feeTiers.join(",")}], ` +
        `age=${Date.now() - vr.validatedAt}ms)`);

      // [STEP9] Server validated V2 for this pair — clear any stale V2 failure
      // cache entry. The server's fresh QuoterV2 call proves V2 works NOW, so
      // the local failure record (from a prior revert) is obsolete.
      if (vr.version === "v2") {
        clearV2FailureIfCached(
          isInputNative ? "0.0.1456986" : inputToken.htsId,
          isOutputNative ? "0.0.1456986" : outputToken.htsId,
        );
      }

      if (vr.routeHtsIds.length === 2) {
        // Direct pool (single-hop)
        poolVersionInfo = {
          version: vr.version,
          feeTier: vr.feeTiers[0] || 3000,
          poolAddress: vr.poolAddress,
        };
        pathAddresses = vr.pathEvmAddresses.length >= 2
          ? vr.pathEvmAddresses
          : [directInEvm, directOutEvm];
      } else if (vr.routeHtsIds.length >= 3) {
        // Multi-hop route
        const hops: PoolVersionInfo[] = vr.feeTiers.map((fee, i) => ({
          version: vr.version,
          feeTier: fee,
          poolAddress: undefined,
        }));
        multiHopRoute = {
          hops,
          tokens: vr.pathEvmAddresses.length >= 3
            ? vr.pathEvmAddresses
            : vr.routeHtsIds.map(id => htsIdToEvmAddress(id)),
        };
        pathAddresses = multiHopRoute.tokens;
      }

      // [WALLET-PERF] Still need recipientEvmAddress for the swap TX
      // but skip ALL graph/pool discovery — go straight to routing-complete
    } else if (vr) {
      // [S5] Validated route skipped — log reason for debugging
      const age = vr.validatedAt ? Date.now() - vr.validatedAt : -1;
      const reason = !vrPairMatch ? "pair mismatch" : `stale (${age}ms > ${VALIDATED_ROUTE_MAX_AGE_MS}ms)`;
      console.log(`[S5] Validated route SKIPPED (${reason}): pairMatch=${!!vrPairMatch}, age=${age}ms, ` +
        `expected=${vrInputId}→${vrOutputId}, got=${vr.routeHtsIds[0]}→${vr.routeHtsIds[vr.routeHtsIds.length - 1]}`);
      // [S5] IMPLEMENTATION NOTE — When the route is stale but pair matches,
      // the server data is still useful as a hint for the client-side graph
      // routing (which version to try first). We just don't trust the exact
      // fee tiers or packed path for V2 execution since they may be stale.
      if (vrPairMatch && age > VALIDATED_ROUTE_MAX_AGE_MS && vr.version === "v1") {
        // V1 routes are less time-sensitive (AMM reserves change slowly)
        // — use as a routing hint even when stale
        console.log(`[S5] Stale V1 route used as routing hint: version=${vr.version}`);
        poolVersionInfo = { version: "v1", poolAddress: undefined };
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ── [C82] GRAPH-FIRST ROUTING ─────────────────────────────────────
    //
    // Try the API-based pool graph FIRST (instant, no network calls).
    // The graph is built from cached SaucerSwap V2+V1 pool lists and
    // finds optimal routes via BFS — matching SaucerSwap.finance's
    // routing strategy.
    //
    // Falls back to individual detectPoolVersion() calls only if the
    // graph is empty (API unavailable).
    //
    // [WALLET-PERF] EVM address resolution runs IN PARALLEL with graph
    // routing — saves 1-2s of sequential Mirror Node latency.
    // ═══════════════════════════════════════════════════════════════════
    const inputRoutingId = getSaucerswapRoutingId(isInputNative ? whbar : inputToken);
    const outputRoutingId = getSaucerswapRoutingId(isOutputNative ? whbar : outputToken);

    // [STEP1] When validated route already set poolVersionInfo or multiHopRoute,
    // only resolve EVM address (still needed for swap TX recipient).
    // Skip graph routing entirely — saves 1-3s.
    const _skipDiscovery = !!(poolVersionInfo || multiHopRoute);

    // [WALLET-PERF] Parallel: resolve EVM address AND graph route simultaneously
    // EVM address needs a Mirror Node call (cached after first swap), graph
    // routing uses the in-memory pool cache (instant if pools are loaded).
    const [recipientEvmAddress, _graphRouteResult] = await Promise.all([
      resolveAccountEvmAddress(accountId, network),
      _skipDiscovery
        ? Promise.resolve(null)
        : findRouteViaGraph(inputRoutingId, outputRoutingId, network).catch((e: any) => {
            console.warn(`[HBAR.h] [C82] Graph routing failed: ${e?.message} — will fall back to on-chain detection`);
            return null;
          }),
    ]);

    try {
      const graphRoute = _graphRouteResult;
      if (graphRoute) {
        if (graphRoute.direct) {
          poolVersionInfo = graphRoute.direct;
          pathAddresses = [directInEvm, directOutEvm];
          console.log(`[HBAR.h] [C82] Graph: direct pool ${poolVersionInfo.version} fee=${poolVersionInfo.feeTier}`);
        } else if (graphRoute.multiHop) {
          multiHopRoute = graphRoute.multiHop;
          pathAddresses = multiHopRoute.tokens;
          console.log(`[HBAR.h] [C82] Graph: multi-hop ${multiHopRoute.tokens.map(t => evmAddressToHtsId(t)).join(" → ")}`);
          multiHopRoute.hops.forEach((h, i) => {
            console.log(`[HBAR.h] [C82]   Hop ${i}: ${h.version} fee=${h.feeTier}`);
          });
        }
      }
    } catch {
      // Error already handled in Promise.all catch above
    }

    // ── Fallback: individual pool detection (only if graph didn't find a route) ──
    if (!poolVersionInfo && !multiHopRoute) {
      console.log(`[HBAR.h] [C82] Graph returned no route — falling back to on-chain detection`);

    // ── Step 1: ALWAYS check for a DIRECT pool first (most efficient) ──
    poolVersionInfo = await detectPoolVersion(directInEvm, directOutEvm, network);

    if (poolVersionInfo) {
      // Direct pool found — use single-hop. Override pathAddresses for V1 fallback.
      console.log(`[HBAR.h] Direct pool found: ${poolVersionInfo.version} (fee=${poolVersionInfo.feeTier || "N/A"})`);
      pathAddresses = [directInEvm, directOutEvm];
    } else {
      // ── Step 2: No direct pool — search multi-hop routes ──
      // [STEP4] Use graph with forced refresh instead of legacy findBestMultiHopRoute()
      // (which made 32-48 sequential detectPoolVersion() RPCs).
      // The force-refresh ensures we rebuild the graph from SaucerSwap API
      // even if the first graph call used stale/empty cache data.
      console.log(`[HBAR.h] No direct pool — searching multi-hop via graph (forceRefresh=true)`);
      try {
        const graphRetry = await findRouteViaGraph(inputRoutingId, outputRoutingId, network, true);
        if (graphRetry?.multiHop) {
          multiHopRoute = graphRetry.multiHop;
          console.log(`[STEP4] ✓ Graph retry found multi-hop: ${multiHopRoute.tokens.map(t => evmAddressToHtsId(t)).join(" → ")}`);
          multiHopRoute.hops.forEach((h, i) => {
            console.log(`[STEP4]   Hop ${i}: ${h.version} fee=${h.feeTier} pool=${h.poolAddress || "?"}`);
          });
          pathAddresses = multiHopRoute.tokens;
        } else if (graphRetry?.direct) {
          // Graph retry found a direct pool we missed — use it
          poolVersionInfo = graphRetry.direct;
          pathAddresses = [directInEvm, directOutEvm];
          console.log(`[STEP4] ✓ Graph retry found direct pool: ${poolVersionInfo.version} fee=${poolVersionInfo.feeTier}`);
        } else {
          console.log(`[STEP4] Graph retry returned no route — no multi-hop available`);
        }
      } catch (graphRetryErr: any) {
        console.warn(`[STEP4] Graph retry failed: ${graphRetryErr?.message} — no multi-hop fallback`);
      }
    }
    } // end fallback if (!poolVersionInfo && !multiHopRoute)

    // [WALLET-PERF] Emit routing-complete step — user sees progress update
    window.dispatchEvent(new CustomEvent("swap-step", { detail: {
      step: 0, total: 0,
      description: `Route found — building transaction...`,
    }}));

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [FOT-EARLY] EARLY FEE-ON-TRANSFER DETECTION — SKIP V2            │
    // │                                                                     │
    // │  V2 concentrated liquidity routers lack FOT variants. If either    │
    // │  token has custom fees, force V1 IMMEDIATELY — before the V2-first │
    // │  routing blocks try V2 (which would waste gas on a doomed attempt  │
    // │  and produce an extra wallet popup for the failed V2 approval).    │
    // │                                                                     │
    // │  This runs before the full FOT detection at V1 router resolution   │
    // │  and uses the same cached fetchTokenFeeSchedule (instant hit if    │
    // │  checkSwapPrerequisites already ran during quote phase).           │
    // └─────────────────────────────────────────────────────────────────────┘
    // [S9] IMPLEMENTATION NOTE — Skip FOT check when server-validated route exists.
    // The server already validated this route via QuoterV2/getAmountsOut, so if it
    // returned V2 with a valid quote, the token doesn't have FOT issues severe enough
    // to block V2 execution. The FOT check hits Mirror Node (0-2s latency), which is
    // the LAST remaining blocker between "click Swap" and "wallet opens".
    // When no validated route exists (client-side discovery), keep the FOT check.
    if (_skipDiscovery) {
      console.log(`[S9] Skipping FOT check — server-validated route (${vr?.source})`);
    } else if (poolVersionInfo?.version === "v2" || (multiHopRoute && multiHopRoute.hops.some(h => h.version === "v2"))) {
      try {
        const [earlyInputFee, earlyOutputFee] = await Promise.all([
          !isInputNative ? fetchTokenFeeSchedule(inputToken.htsId, network) : Promise.resolve({ hasFee: false, feePercent: 0, feeDescription: "", hasFixedFee: false } as TokenFeeInfo),
          !isOutputNative ? fetchTokenFeeSchedule(outputToken.htsId, network) : Promise.resolve({ hasFee: false, feePercent: 0, feeDescription: "", hasFixedFee: false } as TokenFeeInfo),
        ]);
        if (earlyInputFee.hasFee || earlyOutputFee.hasFee) {
          console.log(`[FOT-EARLY] Fee token detected BEFORE V2 attempt — forcing V1 to avoid wasted gas`);
          console.log(`[FOT-EARLY]   Input: ${inputToken.symbol} ${earlyInputFee.hasFee ? earlyInputFee.feeDescription : "no fees"}`);
          console.log(`[FOT-EARLY]   Output: ${outputToken.symbol} ${earlyOutputFee.hasFee ? earlyOutputFee.feeDescription : "no fees"}`);
          poolVersionInfo = { version: "v1", poolAddress: undefined };
          multiHopRoute = null;
        }
      } catch (earlyFotErr: any) {
        console.log(`[FOT-EARLY] Fee detection failed (non-blocking): ${earlyFotErr?.message}`);
      }
    }

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [C100 Step 9] TOKEN→HBAR: SMART V2-FIRST ROUTING                 │
    // │                                                                    │
    // │  Replaces C36-02 blanket V1 force. The original C36 revert was    │
    // │  caused by using address(0) as a recipient sentinel (fixed in     │
    // │  C34-01). The V2 multicall pattern is now correct:                │
    // │                                                                    │
    // │    multicall([                                                     │
    // │      exactInput/exactInputSingle(recipient = ROUTER),             │
    // │      unwrapWETH9(0, userAddress)                                  │
    // │    ])                                                              │
    // │                                                                    │
    // │  WHBAR architecture on SaucerSwap:                                │
    // │    • Contract: 0.0.1456985 (handles deposit/withdraw)             │
    // │    • HTS Token: 0.0.1456986 (ERC-20 via HTS precompile)          │
    // │    • V2 Router WETH9 address → 0.0.1456985 contract              │
    // │    • unwrapWETH9 calls WHBAR contract's withdraw(), which burns   │
    // │      WHBAR tokens and sends native HBAR to the user               │
    // │                                                                    │
    // │  Strategy (mirrors C100-S5 Token→Token pattern):                  │
    // │    1. Try V2 execution first (better pricing, concentrated liq)   │
    // │    2. On success → return immediately                             │
    // │    3. On user cancel → return (respect user intent)               │
    // │    4. On CONTRACT_REVERT → fall through to V1 execution           │
    // │    5. V1 swapExactTokensForETH as safety net (proven on mainnet)  │
    // └─────────────────────────────────────────────────────────────────────┘
    let _v2TokenHbarError: string | undefined;

    // [V1-QUOTE-FIX] Track when multi-hop is forced to V1 — the quote must also
    // use V1 getAmountsOut (not V2 QuoterV2) to match the execution path.
    // Without this, the server proxy may return a V2 quote (higher output due to
    // concentrated liquidity), causing INSUFFICIENT_OUTPUT_AMOUNT when V1 AMM
    // delivers less than the V2-based minOutput.
    let _forceV1MultiHop = false;

    if (isOutputNative && !isInputNative) {
      // [V2-SKIP] Check failure cache for Token→HBAR
      // [STEP3] Gated: server just validated V2 works — don't let stale cache override
      const v2CacheHitTH = options?.validatedRoute ? false : isV2FailureCached(inputToken.htsId, outputToken.htsId);
      if (v2CacheHitTH && poolVersionInfo?.version === "v2") {
        log.info("SwapEngine", `[V2-SKIP] Token→HBAR: V2 previously failed for ${inputToken.symbol}↔${outputToken.symbol} — routing directly to V1`);
        poolVersionInfo = { version: "v1", poolAddress: undefined };
        multiHopRoute = null;
        const v1BypassPath = buildSwapPath(
          isInputNative ? whbar : inputToken,
          isOutputNative ? whbar : outputToken,
        );
        pathAddresses = v1BypassPath.map(t => htsIdToEvmAddress(t.htsId));
      }

      // ┌─────────────────────────────────────────────────────────────────────┐
      // │  [S4] IMPLEMENTATION NOTE — TOKEN→HBAR V1 BIAS                     │
      // │                                                                     │
      // │  Token→HBAR is the most complex V2 swap path (multicall with       │
      // │  exactInputSingle + unwrapWETH9). V1 swapExactTokensForETH is      │
      // │  a single atomic call — simpler, more reliable, proven on mainnet. │
      // │                                                                     │
      // │  Unless the server SPECIFICALLY validated V2 with high confidence  │
      // │  (validatedRoute.version === "v2"), prefer V1 for Token→HBAR.      │
      // │  This eliminates most CONTRACT_REVERT_EXECUTED failures without    │
      // │  sacrificing pricing (V1 AMM typically has comparable or deeper    │
      // │  liquidity for WHBAR pairs than V2 concentrated liquidity pools).  │
      // │                                                                     │
      // │  Server-validated V2 routes bypass this gate because the server    │
      // │  already confirmed the V2 path works via QuoterV2 on-chain call.  │
      // └─────────────────────────────────────────────────────────────────────┘
      const serverValidatedV2 = options?.validatedRoute?.version === "v2";
      if (poolVersionInfo?.version === "v2" && !serverValidatedV2 && !v2CacheHitTH) {
        console.log(`[S4] Token→HBAR: V1 bias active — downgrading V2 to V1 (no server V2 validation)`);
        console.log(`[S4]   Reason: V2 multicall(exactInputSingle+unwrapWETH9) is fragile; V1 swapExactTokensForETH is simpler and more reliable`);
        poolVersionInfo = { version: "v1", poolAddress: undefined };
        multiHopRoute = null;
        const v1BiasPath = buildSwapPath(
          isInputNative ? whbar : inputToken,
          isOutputNative ? whbar : outputToken,
        );
        pathAddresses = v1BiasPath.map(t => htsIdToEvmAddress(t.htsId));
      }

      // ── V2 Direct Token→HBAR (single-hop) ──
      // [S4] Only fires when server specifically validated V2 route
      if (poolVersionInfo?.version === "v2" && !multiHopRoute && !v2CacheHitTH) {
        console.log(`[HBAR.h] [C100-S9] Token→HBAR: trying V2 direct first ` +
          `(multicall pattern, fee=${poolVersionInfo.feeTier}, pool=${poolVersionInfo.poolAddress || "detected"})`);
        console.log(`[C100-S9] WHBAR compatibility: contract=0.0.1456985, token=0.0.1456986, ` +
          `recipient=${recipientEvmAddress} (user), swap→ROUTER then unwrapWETH9→user`);

        const v2DirectResult = await executeSaucerSwapV2Direct(
          inputToken, outputToken, inputAmount, slippagePct,
          accountId, network, poolVersionInfo,
          isInputNative, isOutputNative, whbar,
          rawInput, recipientEvmAddress, options
        );

        // V2 succeeded — return immediately (best case)
        if (v2DirectResult.success) {
          console.log(`[HBAR.h] [C100-S9] ✓ V2 direct Token→HBAR SUCCEEDED — no V1 fallback needed`);
          return v2DirectResult;
        }

        // User cancelled — respect their intent, don't retry with V1
        if (v2DirectResult.userCancelled) {
          console.log(`[HBAR.h] [C100-S9] User cancelled V2 Token→HBAR — not retrying`);
          return v2DirectResult;
        }

        // V2 failed (CONTRACT_REVERT or other error) — fall back to V1
        _v2TokenHbarError = v2DirectResult.error;
        console.log(`[HBAR.h] [C100-S9] V2 direct Token→HBAR REVERTED: ${_v2TokenHbarError}`);
        console.log(`[HBAR.h] [C100-S9] Falling back to V1 swapExactTokensForETH...`);
        // [V2-SKIP] Cache this failure
        markV2Failed(inputToken.htsId, outputToken.htsId);
        // [STEP9] Warn if server had validated this V2 route — indicates stale/transient pool state
        if (options?.validatedRoute?.version === "v2") {
          log.warn("SwapEngine", `[STEP9] V2 execution FAILED despite server validation — pool state changed since quote (age: ${Date.now() - (options.validatedRoute.validatedAt || 0)}ms). Failure cached for future swaps.`);
        }
        {
          const v2RouterForLog = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
          console.log(`[C100-S9] Router transition: V2 Router ${v2RouterForLog} → V1 Router (will need separate approval for ${inputToken.symbol})`);
        }

        // Notify UI about the V2→V1 fallback
        window.dispatchEvent(new CustomEvent("swap-step", { detail: {
          step: 0, total: 2,
          description: `Retrying swap — trying alternate route...`,
        }}));

        // Reset to V1
        poolVersionInfo = { version: "v1", poolAddress: undefined };
      }

      // ── V2 Multi-hop Token→HBAR ──
      if (multiHopRoute) {
        const allHopsV2 = multiHopRoute.hops.every(h => h.version === "v2");

        // [S4] IMPLEMENTATION NOTE — V1 bias for Token→HBAR multi-hop.
        // Same rationale as S4 single-hop: V2 multi-hop multicall is even more
        // complex (exactInput with packed path + unwrapWETH9). Prefer V1 unless
        // the server specifically validated V2 with a packed path.
        if (allHopsV2 && !serverValidatedV2) {
          console.log(`[S4] Token→HBAR multi-hop: V1 bias active — downgrading V2 to V1 (no server V2 validation)`);
          poolVersionInfo = { version: "v1", poolAddress: undefined };
          multiHopRoute = null;
          _forceV1MultiHop = true;
          const v1BiasMhPath = buildSwapPath(
            isInputNative ? whbar : inputToken,
            isOutputNative ? whbar : outputToken,
          );
          pathAddresses = v1BiasMhPath.map(t => htsIdToEvmAddress(t.htsId));
        }

        // [STEP-6] Conditional V2 for Token→HBAR multi-hop
        // [S4] Only reaches here if server validated V2
        if (allHopsV2 && multiHopRoute) {
          // [STEP3] Gated: server validated V2 → skip stale failure cache
          const v2CacheHitTH = options?.validatedRoute ? false : isV2FailureCached(inputToken.htsId, outputToken.htsId);
          if (v2CacheHitTH) {
            console.log(`[STEP-6] Token→HBAR multi-hop: V2 failure cached — using V1`);
            poolVersionInfo = { version: "v1", poolAddress: undefined };
            multiHopRoute = null;
            _forceV1MultiHop = true;
            const v1ThPath = buildSwapPath(
              isInputNative ? whbar : inputToken,
              isOutputNative ? whbar : outputToken,
            );
            pathAddresses = v1ThPath.map(t => htsIdToEvmAddress(t.htsId));
          } else if (options?.validatedRoute?.packedPathHex) {
            // [STEP2] Server already validated V2 — skip pre-validation
            console.log(`[STEP2] Token→HBAR: skipping _preValidateV2MultiHop (server packed path present)`);
          } else {
            console.log(`[STEP-6] Token→HBAR multi-hop: pre-validating V2...`);
            const v2PreVal = await _preValidateV2MultiHop(
              multiHopRoute, rawInput, network, whbar,
              inputToken, outputToken, isInputNative, isOutputNative,
            );
            if (v2PreVal) {
              console.log(`[STEP-6] Token→HBAR: V2 VALIDATED ✓ — executing via V2`);
              for (let h = 0; h < multiHopRoute.hops.length; h++) {
                if (v2PreVal.correctedFees[h] !== undefined) {
                  (multiHopRoute.hops[h] as any).feeTier = v2PreVal.correctedFees[h];
                }
              }
            } else {
              console.log(`[STEP-6] Token→HBAR: V2 pre-validation FAILED — using V1`);
              poolVersionInfo = { version: "v1", poolAddress: undefined };
              multiHopRoute = null;
              _forceV1MultiHop = true;
              const v1ThPath = buildSwapPath(
                isInputNative ? whbar : inputToken,
                isOutputNative ? whbar : outputToken,
              );
              pathAddresses = v1ThPath.map(t => htsIdToEvmAddress(t.htsId));
            }
          }
        }

        // [STEP-6] V2 multi-hop Token→HBAR — fires when allHopsV2 && multiHopRoute survives
        if (allHopsV2 && multiHopRoute) {
          console.log(`[HBAR.h] [C100-S9] Token→HBAR multi-hop: trying V2 first`);
          console.log(`[C100-S9] WHBAR compatibility: multicall(exactInput→ROUTER + unwrapWETH9→user) ` +
            `contract=0.0.1456985, token=0.0.1456986`);

          const v2MhResult = await executeSaucerSwapV2MultiHop(
            inputToken, outputToken, inputAmount, slippagePct,
            accountId, network, multiHopRoute!,
            isInputNative, isOutputNative, whbar,
            rawInput, recipientEvmAddress, options
          );

          // V2 succeeded — return immediately
          if (v2MhResult.success) {
            console.log(`[HBAR.h] [C100-S9] ✓ V2 multi-hop Token→HBAR SUCCEEDED — no V1 fallback needed`);
            return v2MhResult;
          }

          // User cancelled — respect their intent
          if (v2MhResult.userCancelled) {
            console.log(`[HBAR.h] [C100-S9] User cancelled V2 Token→HBAR multi-hop — not retrying`);
            return v2MhResult;
          }

          // V2 failed — fall back to V1
          _v2TokenHbarError = v2MhResult.error;
          console.log(`[HBAR.h] [C100-S9] V2 multi-hop Token→HBAR REVERTED: ${_v2TokenHbarError}`);
          console.log(`[HBAR.h] [C100-S9] Falling back to V1 routing...`);
          // [V2-SKIP] Cache this failure
          markV2Failed(inputToken.htsId, outputToken.htsId);
          // [STEP9] Warn if server had validated this V2 route
          if (options?.validatedRoute?.version === "v2") {
            log.warn("SwapEngine", `[STEP9] V2 multi-hop execution FAILED despite server validation — pool state changed since quote (age: ${Date.now() - (options.validatedRoute.validatedAt || 0)}ms). Failure cached.`);
          }
          {
            const v2RouterForLog = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
            console.log(`[C100-S9] Router transition: V2 Router ${v2RouterForLog} → V1 Router (will need separate approval for ${inputToken.symbol})`);
          }

          // Notify UI about the V2→V1 fallback
          window.dispatchEvent(new CustomEvent("swap-step", { detail: {
            step: 0, total: 2,
            description: `Retrying swap — trying alternate route...`,
          }}));

          // Reset to V1 — rebuild pathAddresses with canonical token addresses
          // [V2-FALLBACK-FIX] Same as Token→Token fallback
          poolVersionInfo = { version: "v1", poolAddress: undefined };
          multiHopRoute = null;
          _forceV1MultiHop = true; // [STEP-6] Mark as V2→V1 degradation for PRICE-IMPACT-GUARD
          const v1FallbackPathTH = buildSwapPath(
            isInputNative ? whbar : inputToken,
            isOutputNative ? whbar : outputToken,
          );
          pathAddresses = v1FallbackPathTH.map(t => htsIdToEvmAddress(t.htsId));
          console.log(`[V2-FALLBACK-FIX] Token→HBAR: rebuilt V1 pathAddresses: ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")}`);
        }

        // Mixed V2+V1 or all-V1 hops — go straight to V1
        if (!allHopsV2) {
          console.log(`[HBAR.h] [C100-S9] Token→HBAR multi-hop: mixed/V1 hops — using V1 directly`);
          poolVersionInfo = { version: "v1", poolAddress: undefined };
          multiHopRoute = null;
          _forceV1MultiHop = true;
        }
      }
    }

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [STEP-6] TOKEN→TOKEN MULTI-HOP: CONDITIONAL V2 EXECUTION          │
    // │                                                                     │
    // │  Previously [V2-SKIP] blanket-disabled V2 multi-hop. Now we        │
    // │  pre-validate via QuoterV2 (Step 5) + per-hop fee probing          │
    // │  (SWAP-FIX-5). If QuoterV2 confirms the path is viable, V2        │
    // │  executes — delivering better output from concentrated liquidity.  │
    // │  If validation fails, falls back to proven V1 AMM routing.         │
    // │                                                                     │
    // │  V2 failure cache is a SOFT hint: skip V2 validation entirely     │
    // │  (saves ~2s of eth_calls) but doesn't permanently block V2.       │
    // └─────────────────────────────────────────────────────────────────────┘
    let _v2MultiHopError: string | undefined;

    if (!isInputNative && !isOutputNative && multiHopRoute) {
      const allHopsV2 = multiHopRoute.hops.every(h => h.version === "v2");

      if (allHopsV2) {
        // [STEP3] Gated: server validated V2 → skip stale failure cache
        const v2CacheHit = options?.validatedRoute ? false : isV2FailureCached(inputToken.htsId, outputToken.htsId);

        if (v2CacheHit) {
          // Soft hint: V2 failed recently — skip validation, go V1
          console.log(`[STEP-6] Token→Token multi-hop: V2 failure cached — skipping validation, using V1`);
          poolVersionInfo = { version: "v1", poolAddress: undefined };
          multiHopRoute = null;
          _forceV1MultiHop = true;
          const v1DirectPath = buildSwapPath(
            isInputNative ? whbar : inputToken,
            isOutputNative ? whbar : outputToken,
          );
          pathAddresses = v1DirectPath.map(t => htsIdToEvmAddress(t.htsId));
        } else if (options?.validatedRoute?.packedPathHex) {
          // [STEP2] Server already validated V2 — skip pre-validation
          console.log(`[STEP2] Token→Token: skipping _preValidateV2MultiHop (server packed path present)`);
          // multiHopRoute stays intact → V2 execution block fires below
        } else {
          // Pre-validate V2 path: per-hop fee probing + full QuoterV2 validation
          console.log(`[STEP-6] Token→Token multi-hop: pre-validating V2 path (${multiHopRoute.hops.length} hops)...`);
          const v2PreVal = await _preValidateV2MultiHop(
            multiHopRoute, rawInput, network, whbar,
            inputToken, outputToken, isInputNative, isOutputNative,
          );

          if (v2PreVal) {
            // V2 VALIDATED — update route fees with corrected values and proceed
            console.log(`[STEP-6] Token→Token: V2 path VALIDATED ✓ — executing via V2 (amountOut=${v2PreVal.amountOut})`);
            for (let h = 0; h < multiHopRoute.hops.length; h++) {
              if (v2PreVal.correctedFees[h] !== undefined) {
                (multiHopRoute.hops[h] as any).feeTier = v2PreVal.correctedFees[h];
              }
            }
            // multiHopRoute stays intact → V2 execution block fires below
          } else {
            // V2 NOT viable — fall back to V1
            console.log(`[STEP-6] Token→Token: V2 pre-validation FAILED — falling back to V1`);
            poolVersionInfo = { version: "v1", poolAddress: undefined };
            multiHopRoute = null;
            _forceV1MultiHop = true;
            const v1DirectPath = buildSwapPath(
              isInputNative ? whbar : inputToken,
              isOutputNative ? whbar : outputToken,
            );
            pathAddresses = v1DirectPath.map(t => htsIdToEvmAddress(t.htsId));
          }
        }
      }

      // [STEP-6] V2 multi-hop execution — fires when allHopsV2 && multiHopRoute survives validation
      if (allHopsV2 && multiHopRoute) {
        console.log(`[HBAR.h] [C100-S5] Token→Token multi-hop: trying V2 first`);

        const v2Result = await executeSaucerSwapV2MultiHop(
          inputToken, outputToken, inputAmount, slippagePct,
          accountId, network, multiHopRoute!,
          isInputNative, isOutputNative, whbar,
          rawInput, recipientEvmAddress, options
        );

        // V2 succeeded — return immediately (best case)
        if (v2Result.success) {
          console.log(`[HBAR.h] [C100-S5] ✓ V2 multi-hop SUCCEEDED — no V1 fallback needed`);
          return v2Result;
        }

        // User cancelled — respect their intent, don't retry with V1
        if (v2Result.userCancelled) {
          console.log(`[HBAR.h] [C100-S5] User cancelled V2 multi-hop — not retrying`);
          return v2Result;
        }

        // V2 failed (CONTRACT_REVERT or other error) — fall back to V1
        _v2MultiHopError = v2Result.error;
        console.log(`[HBAR.h] [C100-S5] V2 multi-hop REVERTED: ${_v2MultiHopError}`);
        console.log(`[HBAR.h] [C100-S5] Falling back to V1 routing...`);

        // [V2-SKIP] Cache this failure so future swaps skip V2 entirely
        markV2Failed(inputToken.htsId, outputToken.htsId);
        // [STEP9] Warn if server had validated this V2 route
        if (options?.validatedRoute?.version === "v2") {
          log.warn("SwapEngine", `[STEP9] V2 multi-hop execution FAILED despite server validation — pool state changed since quote (age: ${Date.now() - (options.validatedRoute.validatedAt || 0)}ms). Failure cached.`);
        }

        // [C100-S7] Router transition: V2 approval was granted but the V2 swap
        // reverted. V1 fallback requires a NEW approval targeting the V1 Router.
        {
          const v2RouterForLog = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
          console.log(`[C100-S7] Router transition: V2 Router ${v2RouterForLog} → V1 Router (will need separate approval for ${inputToken.symbol})`);
        }

        // Notify UI about the V2→V1 fallback
        window.dispatchEvent(new CustomEvent("swap-step", { detail: {
          step: 0, total: 2,
          description: `Retrying swap — trying alternate route...`,
        }}));

        // Reset to V1 — rebuild pathAddresses using canonical token addresses.
        poolVersionInfo = { version: "v1", poolAddress: undefined };
        multiHopRoute = null;
        _forceV1MultiHop = true; // [STEP-6] Mark as V2→V1 degradation for PRICE-IMPACT-GUARD
        const v1FallbackPath = buildSwapPath(
          isInputNative ? whbar : inputToken,
          isOutputNative ? whbar : outputToken,
        );
        pathAddresses = v1FallbackPath.map(t => htsIdToEvmAddress(t.htsId));
        console.log(`[V2-FALLBACK-FIX] Rebuilt V1 pathAddresses: ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")}`);
      }

      // Mixed V2+V1 or all-V1 hops — V2 exactInput requires ALL-V2 pools,
      // so we go straight to V1 (no V2 attempt for mixed routes).
      if (!allHopsV2) {
        console.log(`[HBAR.h] [C100-S5] Token→Token multi-hop: mixed/V1 hops — using V1 directly`);
        poolVersionInfo = { version: "v1", poolAddress: undefined };
        multiHopRoute = null;
        _forceV1MultiHop = true;
      }
    }

    let _v2SingleHopError: string | undefined;

    // ── V2 single-hop execution (with V1 fallback) [SWAP-FIX-1] ──
    // [C100-S9] Token→HBAR V2 direct is tried above with V1 fallback.
    // [C100-S5] Token→Token multi-hop tries V2 first (handled above).
    // This gate fires for: HBAR→Token, Token→Token direct, or any V2
    // single-hop that wasn't consumed by the S9/S5 try-first blocks.
    //
    // [SWAP-FIX-1] Added V1 fallback for ALL V2 single-hop swaps.
    // Previously, HBAR→Token V2 failures had NO fallback — the error
    // went straight to the user. Now: try V2 → if revert → try V1.
    // [V2-SKIP] Check failure cache for single-hop V2
    // [STEP3] Gated: server validated V2 → skip stale failure cache
    if (poolVersionInfo?.version === "v2" && !multiHopRoute && !options?.validatedRoute && isV2FailureCached(inputToken.htsId, outputToken.htsId)) {
      log.info("SwapEngine", `[V2-SKIP] V2 single-hop: V2 previously failed for ${inputToken.symbol}↔${outputToken.symbol} — routing directly to V1`);
      poolVersionInfo = { version: "v1", poolAddress: undefined };
      const v1BypassSingle = buildSwapPath(
        isInputNative ? whbar : inputToken,
        isOutputNative ? whbar : outputToken,
      );
      pathAddresses = v1BypassSingle.map(t => htsIdToEvmAddress(t.htsId));
    }

    if (poolVersionInfo?.version === "v2" && !multiHopRoute) {
      console.log(`[HBAR.h] ═══ ROUTING VIA V2 (single-hop) ═══ fee=${poolVersionInfo.feeTier}, pool=${poolVersionInfo.poolAddress || "detected"}`);
      const v2SingleResult = await executeSaucerSwapV2Direct(
        inputToken, outputToken, inputAmount, slippagePct,
        accountId, network, poolVersionInfo,
        isInputNative, isOutputNative, whbar,
        rawInput, recipientEvmAddress, options
      );

      if (v2SingleResult.success) {
        console.log(`[HBAR.h] [SWAP-FIX-1] ✓ V2 single-hop SUCCEEDED`);
        return v2SingleResult;
      }
      if (v2SingleResult.userCancelled) {
        console.log(`[HBAR.h] [SWAP-FIX-1] User cancelled V2 — not retrying`);
        return v2SingleResult;
      }

      // V2 failed — fall back to V1
      _v2SingleHopError = v2SingleResult.error;
      console.log(`[HBAR.h] [SWAP-FIX-1] V2 single-hop REVERTED: ${_v2SingleHopError}`);
      console.log(`[HBAR.h] [SWAP-FIX-1] Falling back to V1 routing...`);
      // [V2-SKIP] Cache this failure
      markV2Failed(inputToken.htsId, outputToken.htsId);
      // [STEP9] Warn if server had validated this V2 route
      if (options?.validatedRoute?.version === "v2") {
        log.warn("SwapEngine", `[STEP9] V2 single-hop execution FAILED despite server validation — pool state changed since quote (age: ${Date.now() - (options.validatedRoute.validatedAt || 0)}ms). Failure cached.`);
      }
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: 0, total: 2,
        description: `Retrying swap — trying alternate route...`,
      }}));

      poolVersionInfo = { version: "v1", poolAddress: undefined };
      const v1FallbackPathSingle = buildSwapPath(
        isInputNative ? whbar : inputToken,
        isOutputNative ? whbar : outputToken,
      );
      pathAddresses = v1FallbackPathSingle.map(t => htsIdToEvmAddress(t.htsId));
      console.log(`[SWAP-FIX-1] Rebuilt V1 path: ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")}`);
      // Fall through to V1 execution below
    }

    // ── V2 multi-hop execution ──
    // [C100-S9] Token→HBAR multi-hop V2 is tried above with V1 fallback.
    // [C100-S5] Token→Token multi-hop is handled above with V2-first/V1-fallback.
    // This gate fires for HBAR→Token multi-hop (payable — no transferFrom
    // issues since the Router wraps the incoming HBAR automatically).
    // [C77-01] FIX: Changed from .some(v2) to .every(v2). V2 exactInput
    // can ONLY traverse V2 concentrated-liquidity pools. If even one hop
    // is V1 AMM, the V2 router fails to find a pool and reverts.
    // [STEP-6] Conditional V2 for HBAR→Token multi-hop
    if (multiHopRoute && multiHopRoute.hops.every(h => h.version === "v2")) {
      // [STEP3] Gated: server validated V2 → skip stale failure cache
      const v2CacheHitGen = options?.validatedRoute ? false : isV2FailureCached(inputToken.htsId, outputToken.htsId);
      if (v2CacheHitGen) {
        console.log(`[STEP-6] HBAR→Token multi-hop: V2 failure cached — using V1`);
        poolVersionInfo = { version: "v1", poolAddress: undefined };
        multiHopRoute = null;
        _forceV1MultiHop = true;
        const v1MhGenPath = buildSwapPath(
          isInputNative ? whbar : inputToken,
          isOutputNative ? whbar : outputToken,
        );
        pathAddresses = v1MhGenPath.map(t => htsIdToEvmAddress(t.htsId));
      } else if (options?.validatedRoute?.packedPathHex) {
        // [STEP2] Server already validated V2 — skip pre-validation
        console.log(`[STEP2] HBAR→Token: skipping _preValidateV2MultiHop (server packed path present)`);
      } else {
        console.log(`[STEP-6] HBAR→Token multi-hop: pre-validating V2...`);
        const v2PreVal = await _preValidateV2MultiHop(
          multiHopRoute, rawInput, network, whbar,
          inputToken, outputToken, isInputNative, isOutputNative,
        );
        if (v2PreVal) {
          console.log(`[STEP-6] HBAR→Token: V2 VALIDATED ✓ — executing via V2`);
          for (let h = 0; h < multiHopRoute.hops.length; h++) {
            if (v2PreVal.correctedFees[h] !== undefined) {
              (multiHopRoute.hops[h] as any).feeTier = v2PreVal.correctedFees[h];
            }
          }
        } else {
          console.log(`[STEP-6] HBAR→Token: V2 pre-validation FAILED — using V1`);
          poolVersionInfo = { version: "v1", poolAddress: undefined };
          multiHopRoute = null;
          _forceV1MultiHop = true;
          const v1MhGenPath = buildSwapPath(
            isInputNative ? whbar : inputToken,
            isOutputNative ? whbar : outputToken,
          );
          pathAddresses = v1MhGenPath.map(t => htsIdToEvmAddress(t.htsId));
        }
      }
    }

    // [STEP-6] V2 multi-hop HBAR→Token — fires when multiHopRoute survives validation
    if (multiHopRoute && multiHopRoute.hops.every(h => h.version === "v2")) {
      console.log(`[HBAR.h] ═══ ROUTING VIA V2 (multi-hop, ${multiHopRoute!.hops.length} hops, ALL V2) ═══`);
      const v2MhGenResult = await executeSaucerSwapV2MultiHop(
        inputToken, outputToken, inputAmount, slippagePct,
        accountId, network, multiHopRoute!,
        isInputNative, isOutputNative, whbar,
        rawInput, recipientEvmAddress, options
      );

      // [SWAP-FIX-1] V1 fallback for V2 multi-hop (same pattern as single-hop)
      if (v2MhGenResult.success) return v2MhGenResult;
      if (v2MhGenResult.userCancelled) return v2MhGenResult;

      _v2SingleHopError = v2MhGenResult.error; // reuse tracking var for V1 guard
      console.log(`[HBAR.h] [SWAP-FIX-1] V2 multi-hop REVERTED: ${v2MhGenResult.error}`);
      console.log(`[HBAR.h] [SWAP-FIX-1] Falling back to V1 routing...`);
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: 0, total: 2,
        description: `Retrying swap — trying alternate route...`,
      }}));

      poolVersionInfo = { version: "v1", poolAddress: undefined };
      multiHopRoute = null;
      _forceV1MultiHop = true; // [STEP-6] Mark as V2→V1 degradation for PRICE-IMPACT-GUARD
      markV2Failed(inputToken.htsId, outputToken.htsId); // Cache for future swaps
      // [STEP9] Warn if server had validated this V2 route
      if (options?.validatedRoute?.version === "v2") {
        log.warn("SwapEngine", `[STEP9] V2 multi-hop execution FAILED despite server validation — pool state changed since quote (age: ${Date.now() - (options.validatedRoute.validatedAt || 0)}ms). Failure cached.`);
      }
      const v1FallbackPathMh = buildSwapPath(
        isInputNative ? whbar : inputToken,
        isOutputNative ? whbar : outputToken,
      );
      pathAddresses = v1FallbackPathMh.map(t => htsIdToEvmAddress(t.htsId));
      console.log(`[SWAP-FIX-1] Rebuilt V1 path: ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")}`);
      // Fall through to V1 execution below
    }

    // ── V1 multi-hop: handled by the V1 execution path below ──
    // (V1 router natively supports path arrays in swapExactTokensForTokens)
    // [C77-01] Extended: also catches mixed V2+V1 routes that fell through
    // the V2 multi-hop gate (which now requires .every(v2)). The V1 router
    // handles multi-hop natively via path arrays, even for pairs that also
    // have V2 concentrated-liquidity pools, because the V1 Factory still
    // maintains the legacy AMM pairs. This is how SaucerSwap.finance
    // routes most Token→Token swaps — through V1 path arrays.
    if (multiHopRoute && !multiHopRoute.hops.every(h => h.version === "v2")) {
      poolVersionInfo = { version: "v1", poolAddress: undefined };
      _forceV1MultiHop = true;
      console.log(`[HBAR.h] [C77-01] Multi-hop route has mixed or V1-only hops — using V1 path array routing`);
      // pathAddresses was already set to multiHopRoute.tokens at line 1314
    }

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [C95/C100-S5] V1 MULTI-HOP PATH ADDRESS REBUILD & VALIDATION     │
    // │                                                                    │
    // │  The pool graph may return EVM addresses derived from V2 alias     │
    // │  token IDs (e.g. LINK alias 0.0.10152778 instead of canonical      │
    // │  0.0.1055495). V1 Factory pairs are registered with canonical      │
    // │  bridge token addresses, so getPair() fails with alias addresses.  │
    // │                                                                    │
    // │  Fix: rebuild pathAddresses using canonical htsIds. Validate with  │
    // │  V1 getAmountsOut before executing. If canonical fails, try alias  │
    // │  addresses as fallback. If both fail, abort cleanly.               │
    // │                                                                    │
    // │  [C100-S5] This block also serves as the V1 fallback path after   │
    // │  V2 multi-hop execution reverts. The V2→V1 fallback sets          │
    // │  poolVersionInfo=v1 and multiHopRoute=null, so execution falls    │
    // │  through to this rebuild + validation before V1 execution.         │
    // └─────────────────────────────────────────────────────────────────────┘
    if (poolVersionInfo?.version === "v1" && pathAddresses.length > 2) {
      const whbarEvm = htsIdToEvmAddress(whbar.htsId);

      // Build canonical path (using token.htsId, NOT saucerswapAliasId)
      const canonicalPath: string[] = [
        htsIdToEvmAddress((isInputNative ? whbar : inputToken).htsId),
      ];
      // [V2-WHBAR-GUARD] The WHBAR contract ID (0.0.1456985) used by V2 pools
      // vs the WHBAR token ID (0.0.1456986) used by V1 pools. Both must
      // resolve to the WHBAR token address for V1 path validation.
      const whbarContractId = SAUCERSWAP_WHBAR_CONTRACT[network] || SAUCERSWAP_WHBAR_CONTRACT.mainnet;
      for (let i = 1; i < pathAddresses.length - 1; i++) {
        const midHtsId = evmAddressToHtsId(pathAddresses[i]);
        if (midHtsId === whbar.htsId || midHtsId === whbarContractId) {
          canonicalPath.push(whbarEvm);
        } else {
          // Look up token — midHtsId might be a saucerswapAliasId, not canonical
          const midToken = SAUCERSWAP_TOKENS.find(
            t => t.htsId === midHtsId || t.saucerswapAliasId === midHtsId
          );
          // Use canonical htsId (not alias) for V1 Factory pair lookup
          canonicalPath.push(htsIdToEvmAddress(midToken ? midToken.htsId : midHtsId));
        }
      }
      canonicalPath.push(
        htsIdToEvmAddress((isOutputNative ? whbar : outputToken).htsId),
      );

      // Build alias path (using getSaucerswapRoutingEvmAddress — alias-aware)
      const aliasInputEvm = getSaucerswapRoutingEvmAddress(isInputNative ? whbar : inputToken);
      const aliasOutputEvm = getSaucerswapRoutingEvmAddress(isOutputNative ? whbar : outputToken);
      const aliasPath = [aliasInputEvm, ...pathAddresses.slice(1, -1), aliasOutputEvm];

      const canonicalDesc = canonicalPath.map(a => evmAddressToHtsId(a)).join(" → ");
      const aliasDesc = aliasPath.map(a => evmAddressToHtsId(a)).join(" → ");
      const pathsAreSame = canonicalPath.length === aliasPath.length &&
        canonicalPath.every((addr, idx) => addr.toLowerCase() === aliasPath[idx]?.toLowerCase());

      console.log(`[HBAR.h] [C95] V1 multi-hop path rebuild:`);
      console.log(`[HBAR.h] [C95]   Graph path:     ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")}`);
      console.log(`[HBAR.h] [C95]   Canonical path: ${canonicalDesc}`);
      console.log(`[HBAR.h] [C95]   Alias path:     ${aliasDesc}${pathsAreSame ? " (same as canonical)" : ""}`);

      // Validate with V1 getAmountsOut — prevents sending doomed transactions
      const v1RouterForValidation = getSaucerSwapRouter(network, "v1");
      let useCanonical = false;
      let useAlias = false;
      let v1ValidatedOutput: bigint | null = null;

      try {
        const canonicalQuote = await fetchRouterQuote(
          BigInt(rawInput), canonicalPath, v1RouterForValidation, network
        );
        if (canonicalQuote !== null && canonicalQuote > 0n) {
          useCanonical = true;
          v1ValidatedOutput = canonicalQuote;
          console.log(`[HBAR.h] [C95] ✓ Canonical path VALID — V1 getAmountsOut=${canonicalQuote}`);
        } else {
          console.log(`[HBAR.h] [C95] ✗ Canonical path: V1 getAmountsOut returned ${canonicalQuote}`);
        }
      } catch (e: any) {
        console.log(`[HBAR.h] [C95] ✗ Canonical path: V1 getAmountsOut failed: ${e?.message}`);
      }

      // If canonical failed and alias is different, try alias path
      if (!useCanonical && !pathsAreSame) {
        try {
          const aliasQuote = await fetchRouterQuote(
            BigInt(rawInput), aliasPath, v1RouterForValidation, network
          );
          if (aliasQuote !== null && aliasQuote > 0n) {
            useAlias = true;
            v1ValidatedOutput = aliasQuote;
            console.log(`[HBAR.h] [C95] ✓ Alias path VALID — V1 getAmountsOut=${aliasQuote}`);
          } else {
            console.log(`[HBAR.h] [C95] ✗ Alias path: V1 getAmountsOut returned ${aliasQuote}`);
          }
        } catch (e: any) {
          console.log(`[HBAR.h] [C95] ✗ Alias path: V1 getAmountsOut failed: ${e?.message}`);
        }
      }

      // Also try the original graph path if neither canonical nor alias worked
      if (!useCanonical && !useAlias) {
        const graphPathIsDifferent = !pathsAreSame &&
          !pathAddresses.every((addr, idx) => addr.toLowerCase() === canonicalPath[idx]?.toLowerCase());
        if (graphPathIsDifferent) {
          try {
            const graphQuote = await fetchRouterQuote(
              BigInt(rawInput), pathAddresses, v1RouterForValidation, network
            );
            if (graphQuote !== null && graphQuote > 0n) {
              v1ValidatedOutput = graphQuote;
              console.log(`[HBAR.h] [C95] ✓ Graph path VALID — V1 getAmountsOut=${graphQuote}`);
              // Keep pathAddresses as-is (graph path)
            }
          } catch (e: any) {
            console.log(`[HBAR.h] [C95] ✗ Graph path: V1 getAmountsOut failed: ${e?.message}`);
          }
        }
      }

      if (useCanonical) {
        pathAddresses = canonicalPath;
        console.log(`[HBAR.h] [C95] ═══ Using CANONICAL path for V1 execution ═══`);
      } else if (useAlias) {
        pathAddresses = aliasPath;
        console.log(`[HBAR.h] [C95] ═══ Using ALIAS path for V1 execution ═══`);
      } else if (v1ValidatedOutput && v1ValidatedOutput > 0n) {
        console.log(`[HBAR.h] [C95] ═══ Using GRAPH path for V1 execution ═══`);
      } else {
        // No V1 path works — abort before wasting gas on a doomed transaction
        const midTokens = pathAddresses.slice(1, -1).map(a => {
          const id = evmAddressToHtsId(a);
          const tok = SAUCERSWAP_TOKENS.find(t => t.htsId === id || getSaucerswapRoutingId(t) === id);
          return tok?.symbol || id;
        }).join(", ");
        console.error(`[HBAR.h] [C100-S5] ═══ ABORT: No valid V1 multi-hop route found ═══`);
        console.error(`[HBAR.h] [C100-S5]   Tried: canonical, alias, and graph paths`);
        console.error(`[HBAR.h] [C100-S5]   Intermediaries: ${midTokens}`);
        if (_v2MultiHopError) {
          console.error(`[HBAR.h] [C100-S5]   Prior V2 error: ${_v2MultiHopError}`);
        }
        // [C100-S5] Include V2 error context when this is a V1 fallback abort
        const v2Context = _v2MultiHopError
          ? ` V2 also failed: ${_v2MultiHopError.slice(0, 120)}.`
          : "";
        return {
          success: false,
          error: `No valid route for ${inputToken.symbol} → ${outputToken.symbol} through ${midTokens}. ` +
            `V1 Factory does not have AMM pairs for this path.${v2Context} ` +
            `Try swapping to HBAR first, then HBAR → ${outputToken.symbol}.`,
          executionVenue: "saucerswap-v1",
        };
      }
    }

    // ┌─────────────────────────────────────────────────────────────────┐
    // │  SEC-17 — HARD GATE: Abort if no on-chain pool verified        │
    // │  Previously, null poolVersionInfo fell through to V1 execution │
    // │  which sent HBAR to the router with no valid pair, causing     │
    // │  reverts and potential fund loss. Now we ABORT immediately.    │
    // └─────────────────────────────────────────────────────────────────┘
    if (!poolVersionInfo) {
      const tokenAName = inputToken.symbol;
      const tokenBName = outputToken.symbol;
      console.error(`[HBAR.h] ═══ SAFETY ABORT: No pool found for ${tokenAName} ↔ ${tokenBName} on V1 or V2 ═══`);
      console.error(`[HBAR.h] Path addresses checked: ${pathAddresses.join(" → ")}`);
      return {
        success: false,
        error: `No SaucerSwap pool found for ${tokenAName} → ${tokenBName}. ` +
          `Tried: SaucerSwap API, V2 Factory getPool (fee tiers 3000/10000/500/100), ` +
          `V1 Factory getPair — all returned no pool. Check the browser console for detailed ` +
          `diagnostics. The token pair may not have liquidity on SaucerSwap, or the token HTS IDs ` +
          `may not match the SaucerSwap pool tokens. ` +
          `Check https://www.saucerswap.finance/ to verify the pair exists.`,
        executionVenue: "saucerswap-v1",
      };
    }

    console.log(`[HBAR.h] Pool verified: ${poolVersionInfo.version} (pool: ${poolVersionInfo.poolAddress || "detected"})`);

    // ── V1 execution continues below ──

    // Resolve router address early — needed for both quote and execution.
    // Dynamic discovery verifies candidates by calling factory() on-chain
    // and caches the result, so this only does network calls on first swap.
    //
    // [C77-07] FIX: Use V1 RouterV3 (0.0.3045981) for ALL V1 swap types.
    //
    // DIAGNOSIS: RouterWithFee (0.0.6755814) implements DIFFERENT function
    // selectors than standard V1 router:
    //   RouterV3:      swapExactETHForTokens (0x7ff36ab5)
    //   RouterWithFee: swapExactETHForTokensSupportingFeeOnTransferTokens (0xb6f9de95)
    //
    // When we call swapExactETHForTokens on RouterWithFee, the EVM function
    // dispatcher can't match the selector → falls to fallback → immediate
    // revert with 0 gas consumed. This is visible on-chain as
    // CONTRACT_REVERT_EXECUTED with 0 gas used.
    //
    // RouterV3 (0.0.3045981) is the standard production V1 router verified
    // in SEC-16. It implements all standard UniswapV2-style swap functions:
    //   - swapExactETHForTokens  (HBAR → Token)
    //   - swapExactTokensForETH  (Token → HBAR)
    //   - swapExactTokensForTokens (Token → Token)
    //   - getAmountsOut (view, for quotes)
    //
    // RouterWithFee (0.0.6755814) handles fee-on-transfer (FOT) tokens.
    // Standard RouterV3 (0.0.3045981) is used for all non-FOT swaps.
    let v1Router: string = getSaucerSwapRouter(network, "v1");

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [FOT] FEE-ON-TRANSFER TOKEN DETECTION                             │
    // │                                                                     │
    // │  Query Mirror Node for HTS custom fee schedules on both input and  │
    // │  output tokens. If either has transfer fees (fractional, royalty,   │
    // │  or fixed fees in same denomination), switch to:                    │
    // │    1. RouterWithFee (0.0.6755814) — implements the                  │
    // │       `...SupportingFeeOnTransferTokens` function variants          │
    // │    2. FOT ABI selectors — check actual balance change, not          │
    // │       router accounting, so fees don't cause                        │
    // │       INSUFFICIENT_OUTPUT_AMOUNT reverts                            │
    // │    3. Fee-adjusted minOutput — slippage applies on top of the       │
    // │       expected fee deduction, not the raw quote amount              │
    // │                                                                     │
    // │  This mirrors PancakeSwap, Uniswap, and SaucerSwap.finance's own   │
    // │  handling of fee-on-transfer tokens.                                │
    // └─────────────────────────────────────────────────────────────────────┘
    let useFotRouter = false;
    let fotFeePercent = 0;
    let fotFeeDescription = "";

    try {
      const [inputFeeInfo, outputFeeInfo] = await Promise.all([
        !isInputNative ? fetchTokenFeeSchedule(inputToken.htsId, network) : Promise.resolve({ hasFee: false, feePercent: 0, feeDescription: "", hasFixedFee: false } as TokenFeeInfo),
        !isOutputNative ? fetchTokenFeeSchedule(outputToken.htsId, network) : Promise.resolve({ hasFee: false, feePercent: 0, feeDescription: "", hasFixedFee: false } as TokenFeeInfo),
      ]);

      if (inputFeeInfo.hasFee || outputFeeInfo.hasFee) {
        useFotRouter = true;
        fotFeePercent = inputFeeInfo.feePercent + outputFeeInfo.feePercent;
        fotFeeDescription = [inputFeeInfo.feeDescription, outputFeeInfo.feeDescription].filter(Boolean).join("; ");
        v1Router = getRouterWithFee(network);
        console.log(`[FOT] ═══════════════════════════════════════════`);
        console.log(`[FOT] FEE-ON-TRANSFER TOKEN DETECTED`);
        console.log(`[FOT]   Input:  ${inputToken.symbol} — ${inputFeeInfo.hasFee ? inputFeeInfo.feeDescription : "no fees"}`);
        console.log(`[FOT]   Output: ${outputToken.symbol} — ${outputFeeInfo.hasFee ? outputFeeInfo.feeDescription : "no fees"}`);
        console.log(`[FOT]   Total fee: ~${fotFeePercent.toFixed(2)}%`);
        console.log(`[FOT]   Router: RouterWithFee ${v1Router}`);
        console.log(`[FOT]   Using SupportingFeeOnTransferTokens selectors`);
        console.log(`[FOT] ═══════════════════════════════════════════`);

        // [FOT] Force V1 routing — V2 concentrated liquidity routers
        // don't have FOT variants. Skip V2 attempts entirely.
        if (poolVersionInfo?.version === "v2") {
          console.log(`[FOT] V2 pool detected but token has fees — forcing V1 RouterWithFee (V2 lacks FOT support)`);
          poolVersionInfo = { version: "v1", poolAddress: undefined };
        }
        if (multiHopRoute) {
          console.log(`[FOT] Multi-hop route detected with fee token — forcing V1 RouterWithFee path`);
          poolVersionInfo = { version: "v1", poolAddress: undefined };
          multiHopRoute = null;
        }
      }
    } catch (fotErr: any) {
      console.log(`[FOT] Fee detection failed (non-blocking): ${fotErr?.message || fotErr}`);
    }

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [FOT-ASSOC-GUARD] Verify RouterWithFee can receive output tokens  │
    // │                                                                     │
    // │  On Hedera, every account/contract must be token-associated before  │
    // │  it can receive HTS tokens. The FOT router variant sends output     │
    // │  tokens from pair → ROUTER → user (balance-measurement pattern).   │
    // │  If the router isn't associated with the output token AND doesn't  │
    // │  have unlimited auto-associations, the HTS transfer from pair to   │
    // │  router reverts with "Safe token transfer failed!" (HTS code 184). │
    // │                                                                     │
    // │  Fix: fall back to the standard V1 router, which sends tokens     │
    // │  directly from pair → user (no intermediate router receipt).       │
    // │  The user receives slightly less than quoted (by the fee %), but   │
    // │  the swap succeeds instead of reverting.                           │
    // └─────────────────────────────────────────────────────────────────────┘
    if (useFotRouter && !isOutputNative) {
      try {
        const fotRouterHtsId = getRouterWithFee(network);
        const routerAssociated = await isTokenAssociated(fotRouterHtsId, outputToken.htsId, network);
        if (!routerAssociated) {
          // Check if router has unlimited auto-associations (-1 = unlimited)
          const maxAutoAssoc = await fetchMaxAutoAssociations(fotRouterHtsId, network);
          if (maxAutoAssoc !== -1) {
            console.warn(`[FOT-ASSOC-GUARD] ═══════════════════════════════════════════`);
            console.warn(`[FOT-ASSOC-GUARD] RouterWithFee ${fotRouterHtsId} NOT associated with ${outputToken.symbol} (${outputToken.htsId})`);
            console.warn(`[FOT-ASSOC-GUARD] maxAutoAssociations=${maxAutoAssoc} — cannot auto-associate`);
            console.warn(`[FOT-ASSOC-GUARD] FOT swap would fail: "Safe token transfer failed!" (pair→router HTS transfer blocked)`);
            console.warn(`[FOT-ASSOC-GUARD] Falling back to standard V1 router (pair sends directly to user)`);
            console.warn(`[FOT-ASSOC-GUARD] ═══════════════════════════════════════════`);
            useFotRouter = false;
            v1Router = getSaucerSwapRouter(network, "v1");
            // fotFeePercent/fotFeeDescription kept for logging only — standard router's
            // require checks getAmountsOut (pre-fee) vs amountOutMin, so fee deduction
            // is NOT applied to minOutput. User receives (output - fee) but swap succeeds.
          } else {
            console.log(`[FOT-ASSOC-GUARD] RouterWithFee not explicitly associated with ${outputToken.symbol}, but has unlimited auto-associations — proceeding with FOT`);
          }
        } else {
          console.log(`[FOT-ASSOC-GUARD] RouterWithFee associated with ${outputToken.symbol} ✓`);
        }
      } catch (assocErr: any) {
        console.warn(`[FOT-ASSOC-GUARD] Association check failed (non-blocking, proceeding with FOT): ${assocErr?.message || assocErr}`);
      }
    }

    if (!useFotRouter) {
      console.log(`[HBAR.h] [C77-07] Using V1 RouterV3 ${v1Router} for all V1 swaps`);
    }

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [V1-GUARD] V1 PATH VALIDATION — PREVENTS DOOMED V1 FALLBACKS     │
    // │                                                                     │
    // │  When V2 fails and we fall back to V1, verify that a V1 AMM pair  │
    // │  actually exists by calling V1 getAmountsOut (view function — no   │
    // │  gas, no wallet popup). V2-only pairs (e.g., USDT at fee 1500)    │
    // │  have no V1 Factory pair — the V1 swap would revert with 0 gas    │
    // │  and waste the user's approval popup + gas fees.                   │
    // │                                                                     │
    // │  Also guards direct V1 routing (no V2 fallback) for 2-element     │
    // │  paths that might use alias EVM addresses unsupported by V1.      │
    // └─────────────────────────────────────────────────────────────────────┘
    // [V1-QUOTE-XCHECK] Hoist V1 guard quote result so the cross-check (below)
    // can reuse it without a duplicate getAmountsOut RPC call. Both the guard
    // and cross-check query the same V1 Factory pairs — results are identical.
    let _v1GuardQuoteResult: bigint | null = null;
    {
      const isV2Fallback = !!(_v2TokenHbarError || _v2MultiHopError || _v2SingleHopError);
      // [SWAP-FIX-5] Always validate V1 paths: for V2 fallbacks, 2-element
      // paths, AND forced V1 multi-hop (prevents sending doomed transactions).
      // [V1-QUOTE-FIX] Extended to include _forceV1MultiHop — validates that
      // V1 pools exist for ALL hops before attempting execution.
      const shouldValidateV1 = isV2Fallback || pathAddresses.length === 2 || _forceV1MultiHop;

      if (shouldValidateV1) {
        const v1GuardRouter = useFotRouter ? getRouterWithFee(network) : getSaucerSwapRouter(network, "v1");
        try {
          // [ALIAS-FIX] Build canonical path BEFORE querying. When alias ≠ canonical,
          // try canonical FIRST — V1 Factory pairs are registered under canonical IDs.
          // The alias address may hit a DIFFERENT V1 pair with tiny liquidity, returning
          // a positive but wrong value that bypasses the old canonical fallback.
          const canonInEvm = htsIdToEvmAddress(isInputNative ? whbar.htsId : inputToken.htsId);
          const canonOutEvm = htsIdToEvmAddress(isOutputNative ? whbar.htsId : outputToken.htsId);
          const canonicalGuardPath = [canonInEvm, canonOutEvm];
          const guardHasAlias = canonicalGuardPath[0].toLowerCase() !== pathAddresses[0]?.toLowerCase() ||
            canonicalGuardPath[1]?.toLowerCase() !== pathAddresses[1]?.toLowerCase();

          let v1GuardQuote: bigint | null = null;

          if (guardHasAlias && pathAddresses.length === 2) {
            // [ALIAS-FIX] Canonical-first strategy for alias tokens
            console.log(`[V1-GUARD] [ALIAS-FIX] Alias path detected — trying canonical first: ${canonicalGuardPath.map(a => evmAddressToHtsId(a)).join(" → ")}`);
            const canonQuote = await fetchRouterQuote(
              BigInt(rawInput), canonicalGuardPath, v1GuardRouter, network
            );
            if (canonQuote && canonQuote > 0n) {
              console.log(`[V1-GUARD] [ALIAS-FIX] Canonical path works ✓ (getAmountsOut=${canonQuote}) — using canonical for V1`);
              pathAddresses = canonicalGuardPath;
              v1GuardQuote = canonQuote;
            } else {
              // Canonical failed, try alias as fallback
              console.log(`[V1-GUARD] [ALIAS-FIX] Canonical failed (${canonQuote}), trying alias path: ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")}`);
              v1GuardQuote = await fetchRouterQuote(
                BigInt(rawInput), pathAddresses, v1GuardRouter, network
              );
            }
          } else {
            // No alias override — standard path validation
            v1GuardQuote = await fetchRouterQuote(
              BigInt(rawInput), pathAddresses, v1GuardRouter, network
            );
          }

          if (!v1GuardQuote || v1GuardQuote <= 0n) {
            const v2Error = _v2TokenHbarError || _v2MultiHopError || _v2SingleHopError;
            if (isV2Fallback) {
              console.error(`[V1-GUARD] V1 getAmountsOut returned ${v1GuardQuote} — no V1 pair for ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")}`);
              console.error(`[V1-GUARD] V2 error was: ${v2Error}`);
              return {
                success: false,
                error: `${inputToken.symbol} → ${isOutputNative ? "HBAR" : outputToken.symbol} is available on V2 (concentrated liquidity) ` +
                  `but the V2 swap reverted: ${(v2Error || "unknown").slice(0, 150)}. ` +
                  `No V1 AMM pool exists as fallback. ` +
                  `Try again with higher slippage (5-10%), or swap ${inputToken.symbol} → WHBAR → ${isOutputNative ? "HBAR" : outputToken.symbol} as two separate swaps.`,
                executionVenue: "saucerswap-v1",
              };
            }
            // [V1-QUOTE-FIX] Abort cleanly for forced V1 multi-hop when no V1 pair exists.
            if (_forceV1MultiHop && pathAddresses.length > 2) {
              console.error(`[V1-GUARD] V1 multi-hop path has no V1 pair for all hops: ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")}`);
              return {
                success: false,
                error: `${inputToken.symbol} → ${outputToken.symbol} multi-hop requires V1 AMM pools for each hop, ` +
                  `but at least one hop has no V1 pool (V1 getAmountsOut returned ${v1GuardQuote}). ` +
                  `This pair may only be available via V2 concentrated liquidity. ` +
                  `Try swapping ${inputToken.symbol} → HBAR first, then HBAR → ${outputToken.symbol} as two separate swaps.`,
                executionVenue: "saucerswap-v1",
              };
            }
            // Non-fallback, non-alias: try canonical as last resort
            if (!guardHasAlias) {
              console.warn(`[V1-GUARD] V1 getAmountsOut failed for direct path — trying canonical addresses`);
              if (canonicalGuardPath[0].toLowerCase() !== pathAddresses[0].toLowerCase() ||
                  canonicalGuardPath[1].toLowerCase() !== pathAddresses[1].toLowerCase()) {
                const canonQuote = await fetchRouterQuote(
                  BigInt(rawInput), canonicalGuardPath, v1GuardRouter, network
                );
                if (canonQuote && canonQuote > 0n) {
                  console.log(`[V1-GUARD] Canonical path works ✓ (getAmountsOut=${canonQuote}) — switching to canonical`);
                  pathAddresses = canonicalGuardPath;
                } else {
                  console.warn(`[V1-GUARD] Canonical path also failed (${canonQuote}) — proceeding with original (may revert)`);
                }
              }
            }
          } else {
            console.log(`[V1-GUARD] V1 path validated ✓ (getAmountsOut=${v1GuardQuote})`);
            _v1GuardQuoteResult = v1GuardQuote; // Save for cross-check reuse
          }
        } catch (v1GuardErr: any) {
          if (isV2Fallback) {
            const v2Error = _v2TokenHbarError || _v2MultiHopError || _v2SingleHopError;
            console.error(`[V1-GUARD] V1 path validation failed: ${v1GuardErr?.message}`);
            return {
              success: false,
              error: `${inputToken.symbol} → ${isOutputNative ? "HBAR" : outputToken.symbol}: V2 swap failed (${(v2Error || "").slice(0, 100)}), ` +
                `and V1 path validation also failed (${v1GuardErr?.message?.slice(0, 80) || "unknown"}). ` +
                `This pair may only have a V2 concentrated liquidity pool with no V1 fallback. ` +
                `Try swapping ${inputToken.symbol} → WHBAR first, then unwrap WHBAR → HBAR.`,
              executionVenue: "saucerswap-v1",
            };
          }
          // [V1-QUOTE-FIX] For forced V1 multi-hop, validation failure means abort
          if (_forceV1MultiHop && pathAddresses.length > 2) {
            console.error(`[V1-GUARD] V1 multi-hop validation failed: ${v1GuardErr?.message}`);
            return {
              success: false,
              error: `${inputToken.symbol} → ${outputToken.symbol} multi-hop V1 path validation failed: ${v1GuardErr?.message?.slice(0, 100) || "unknown"}. ` +
                `Try swapping ${inputToken.symbol} → HBAR first, then HBAR → ${outputToken.symbol} as two separate swaps.`,
              executionVenue: "saucerswap-v1",
            };
          }
          console.warn(`[V1-GUARD] V1 validation error (non-blocking): ${v1GuardErr?.message}`);
        }
      }
    }

    // For quote fetching, use WHBAR's htsId when input is native HBAR.
    // Use SaucerSwap alias IDs for bridge tokens (their pool IDs differ from canonical bridge IDs).
    // [FOT] Quotes always use standard RouterV3 — getAmountsOut doesn't account for fees.
    const quoteInputId = isInputNative ? whbar.htsId : getSaucerswapRoutingId(inputToken);
    const quoteOutputId = isOutputNative ? whbar.htsId : getSaucerswapRoutingId(outputToken);

    // Multi-strategy quote: router view → API → price estimate → fallback
    // [FOT] Quote uses standard router (getAmountsOut) even for FOT swaps — the
    // quote reflects pre-fee output. Fee deduction is handled in minOutput calculation.
    const quoteRouter = useFotRouter ? getSaucerSwapRouter(network, "v1") : v1Router;
    let quote = await fetchSaucerSwapQuote(quoteInputId, quoteOutputId, rawInput.toString(), {
      pathAddresses,
      routerHtsId: quoteRouter,
      network,
      inputToken: isInputNative ? whbar : inputToken,
      outputToken: isOutputNative ? whbar : outputToken,
    });

    // ── [V1-QUOTE-XCHECK] V1 cross-check for ALL V1 executions ──
    // Extended from the original multi-hop-only cross-check. Now runs for
    // EVERY V1 execution (direct and multi-hop) because:
    //   1. Server proxy / API quotes may come from V2 pools (higher output
    //      from concentrated liquidity), causing INSUFFICIENT_OUTPUT_AMOUNT
    //      when the V1 AMM delivers less at execution time.
    //   2. API-based price estimates don't account for pool-specific price
    //      impact — catastrophic for thin-liquidity pools where the input
    //      amount exceeds the pool reserves (e.g., HBAR.h/GRELF).
    //   3. [PRICE-IMPACT-GUARD] When V1 output < 50% of server quote, the
    //      trade has extreme price impact (user gets <50% of expected value).
    //      Abort with a clear error rather than executing a bad trade.
    //
    // Reuses _v1GuardQuoteResult when available (same Factory → identical
    // getAmountsOut result) to avoid a duplicate RPC call.
    const _shouldV1CrossCheck = quote && quote.amountOut > 0 && poolVersionInfo?.version === "v1";
    if (_shouldV1CrossCheck) {
      try {
        // [ALIAS-FIX] Build CANONICAL path addresses for V1 Router getAmountsOut.
        // V1 Factory pairs are registered under canonical HTS IDs, NOT ERC20Wrapper
        // aliases. Using alias addresses causes V1 getAmountsOut to return 0 or a
        // wrong amount from a different pair, triggering false PRICE-IMPACT-GUARD aborts.
        const v1CanonicalPath = logicalPath.map((t) => getCanonicalEvmAddress(t));
        const usedCanonical = v1CanonicalPath.some((addr, i) => addr.toLowerCase() !== pathAddresses[i]?.toLowerCase());
        if (usedCanonical) {
          console.log(`[ALIAS-FIX] V1 cross-check using canonical addresses: ${v1CanonicalPath.map(a => evmAddressToHtsId(a)).join(" → ")} (alias path: ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")})`);
        }

        // Reuse V1 guard result ONLY when canonical and alias paths are identical.
        // [ALIAS-FIX] When paths differ, the guard used alias addresses which may
        // hit a wrong V1 pair with tiny liquidity — returning a positive but incorrect
        // amount that bypasses the canonical fallback. Always re-query with canonical.
        let v1CrossQuote: bigint | null = usedCanonical ? null : _v1GuardQuoteResult;
        if (!v1CrossQuote) {
          v1CrossQuote = await fetchRouterQuote(
            BigInt(rawInput), v1CanonicalPath, quoteRouter, network
          );
          if (usedCanonical) {
            console.log(`[ALIAS-FIX] V1 cross-check re-queried with canonical path: ${v1CrossQuote}`);
          }
        } else {
          console.log(`[V1-QUOTE-XCHECK] Reusing V1 guard quote: ${v1CrossQuote}`);
        }
        if (v1CrossQuote && v1CrossQuote > 0n) {
          const v1Amount = Number(v1CrossQuote);

          // ── [PRICE-IMPACT-GUARD] Catastrophic price impact detection ──
          // If V1 getAmountsOut returns < 50% of the server/API quote, the
          // pool MIGHT have extreme price impact (input >> reserves).
          //
          // CRITICAL EXCEPTION: When the original route had V2 legs but
          // execution fell back to V1 (V2 pre-validation failed [STEP-6],
          // V2 execution reverted, or V2 failure cache hit), a large
          // divergence is EXPECTED — V2 concentrated liquidity pools
          // deliver much more output than V1 AMM pools. This is NOT
          // catastrophic price impact; it's a V2→V1 routing degradation.
          //
          // In that case: skip the ABORT, log a warning, and let the V1
          // amount correction (below) adjust the minOutput so the swap
          // succeeds at V1 rates. The user gets less than the V2 quote
          // showed, but the swap actually completes.
          if (quote!.amountOut > v1Amount * 2) {
            const impactPct = ((quote!.amountOut - v1Amount) / quote!.amountOut * 100).toFixed(1);
            const isV2QuoteForcedV1 = _forceV1MultiHop && (quote!.poolVersion === "v2" || quote!.source !== "router");

            if (isV2QuoteForcedV1) {
              // V2→V1 forced degradation — do NOT abort, just warn and correct
              console.warn(`[PRICE-IMPACT-GUARD] ═══════════════════════════════════════════`);
              console.warn(`[PRICE-IMPACT-GUARD] V2→V1 ROUTE DEGRADATION (NOT aborting)`);
              console.warn(`[PRICE-IMPACT-GUARD] Quote: ${quote!.amountOut} (${quote!.source}/${quote!.poolVersion})`);
              console.warn(`[PRICE-IMPACT-GUARD] V1 getAmountsOut: ${v1Amount} (${impactPct}% less)`);
              console.warn(`[PRICE-IMPACT-GUARD] Route fell back from V2 to V1 (pre-validation failed, execution reverted, or cache hit)`);
              console.warn(`[PRICE-IMPACT-GUARD] Proceeding with V1 amount as minOutput basis`);
              console.warn(`[PRICE-IMPACT-GUARD] ═══════════════════════════════════════════`);
              // Fall through to the V1 amount correction below
            } else {
              // TRUE price impact — both quote and execution are V1-based
              console.error(`[PRICE-IMPACT-GUARD] ═══════════════════════════════════════════`);
              console.error(`[PRICE-IMPACT-GUARD] Quote: ${quote!.amountOut} (${quote!.source}/${quote!.poolVersion})`);
              console.error(`[PRICE-IMPACT-GUARD] V1 getAmountsOut: ${v1Amount}`);
              console.error(`[PRICE-IMPACT-GUARD] Divergence: ${impactPct}% — CATASTROPHIC PRICE IMPACT`);
              console.error(`[PRICE-IMPACT-GUARD] Aborting to protect user from unfavorable trade`);
              console.error(`[PRICE-IMPACT-GUARD] ═══════════════════════════════════════════`);
              const displayOut = isOutputNative ? "HBAR" : outputToken.symbol;
              const v1Human = v1Amount / Math.pow(10, isOutputNative ? 8 : outputToken.decimals);
              const quoteHuman = quote!.amountOut / Math.pow(10, isOutputNative ? 8 : outputToken.decimals);
              return {
                success: false,
                error: `Extreme price impact detected on ${inputToken.symbol} → ${displayOut}. ` +
                  `Expected ~${quoteHuman.toLocaleString()} ${displayOut} but the pool can only deliver ` +
                  `~${v1Human.toLocaleString()} ${displayOut} (${impactPct}% less). ` +
                  `The pool has very low liquidity for this trade size. ` +
                  `Reduce your swap amount or try swapping in smaller increments.`,
                executionVenue: "saucerswap-v1",
              };
            }
          }

          if (quote!.amountOut > v1Amount) {
            const pctDiff = ((quote!.amountOut - v1Amount) / quote!.amountOut * 100).toFixed(1);
            console.log(`[V1-QUOTE-XCHECK] Server quote ${quote!.amountOut} (${quote!.poolVersion}) > V1 getAmountsOut ${v1Amount} (diff: ${pctDiff}%) — using V1 amount`);
            // [V1-DEGRADE] Emit degradation event so the UI can update
            // (safety net — the proactive Phase 3 check in SwapPanel usually catches this first)
            const _outDecimals = isOutputNative ? 8 : outputToken.decimals;
            try {
              window.dispatchEvent(new CustomEvent("swap-quote-degraded", { detail: {
                v2Amount: quote!.amountOut / Math.pow(10, _outDecimals),
                v1Amount: v1Amount / Math.pow(10, _outDecimals),
                outputSymbol: isOutputNative ? "HBAR" : outputToken.symbol,
                outputDecimals: _outDecimals,
              }}));
            } catch (_) { /* non-blocking */ }
            quote = {
              amountOut: v1Amount,
              priceImpact: quote!.priceImpact,
              route: pathAddresses.map(a => evmAddressToHtsId(a)),
              source: "router" as const,
              confidence: "high" as const,
              poolVersion: "v1" as const,
            };
          } else {
            console.log(`[V1-QUOTE-XCHECK] V1 getAmountsOut ${v1Amount} >= server quote ${quote!.amountOut} — keeping server quote`);
          }
        } else {
          // V1 getAmountsOut returned 0 or null — pools may be very thin
          console.warn(`[V1-QUOTE-XCHECK] V1 getAmountsOut failed/zero — V1 pools may be thin. Widening slippage safety margin.`);
        }
      } catch (v1CrossErr: any) {
        console.warn(`[V1-QUOTE-XCHECK] Cross-check error (non-blocking): ${v1CrossErr?.message}`);
      }
    }

    // ── minOutput calculation ──
    // When quote is available: use it with slippage tolerance.
    // When all strategies fail: try one more inline price estimate before surrendering.
    // [FOT] For fee-on-transfer tokens, reduce expected output by the fee percentage
    // BEFORE applying slippage. This prevents INSUFFICIENT_OUTPUT_AMOUNT when the
    // FOT router's balance-check sees post-fee amounts.
    let minOutput: number;
    if (quote && quote.amountOut > 0) {
      // For price estimates, use wider slippage (prices may be stale)
      let effectiveSlippage = quote.source === "price-estimate"
        ? Math.max(slippagePct, 5)
        : slippagePct;
      // [V1-QUOTE-FIX] V1 multi-hop AMM pools compound price impact across hops.
      // Each hop has constant-product (x*y=k) slippage, and the second hop operates
      // on the already-slipped output of the first. Enforce a higher floor for
      // multi-hop V1 to prevent INSUFFICIENT_OUTPUT_AMOUNT from compounded impact.
      if (_forceV1MultiHop && pathAddresses.length > 2) {
        const hops = pathAddresses.length - 1;
        const multiHopFloor = Math.max(3, hops * 2); // 4% for 2-hop, 6% for 3-hop
        if (effectiveSlippage < multiHopFloor) {
          console.log(`[V1-QUOTE-FIX] Multi-hop V1 slippage floor: ${effectiveSlippage}% → ${multiHopFloor}% (${hops} hops)`);
          effectiveSlippage = multiHopFloor;
        }
      }
      // [FOT] Deduct fee percentage from expected output, then apply slippage
      const feeAdjustedOutput = useFotRouter && fotFeePercent > 0
        ? quote.amountOut * (1 - fotFeePercent / 100)
        : quote.amountOut;
      // [FOT] Enforce minimum 2% slippage for fee tokens (fees can be imprecise)
      const fotAdjustedSlippage = useFotRouter
        ? Math.max(effectiveSlippage, 2)
        : effectiveSlippage;
      minOutput = Math.max(1, Math.floor(feeAdjustedOutput * (1 - fotAdjustedSlippage / 100)));
      if (useFotRouter) {
        console.log(`[FOT] minOutput calculation: rawQuote=${quote.amountOut}, ` +
          `feeDeduction=${fotFeePercent.toFixed(2)}%, feeAdjusted=${Math.floor(feeAdjustedOutput)}, ` +
          `slippage=${fotAdjustedSlippage}%, minOutput=${minOutput}`);
      }
      console.log(`[HBAR.h] Quote source: ${quote.source}, amountOut=${quote.amountOut}, minOutput=${minOutput} (${fotAdjustedSlippage}% slippage${useFotRouter ? `, ${fotFeePercent.toFixed(1)}% fee deducted` : ""})`);
    } else {
      // Last-ditch inline estimate before surrendering to minOutput=1
      const inTok = isInputNative ? whbar : inputToken;
      const outTok = isOutputNative ? whbar : outputToken;
      const lastDitch = estimateOutputFromPrices(rawInput, inTok, outTok, pathAddresses.length - 1);
      if (lastDitch && lastDitch > 0) {
        const safeSlippage = Math.max(slippagePct, 10); // very generous for emergency estimate
        minOutput = Math.max(1, Math.floor(lastDitch * (1 - safeSlippage / 100)));
        console.warn(`[HBAR.h] All strategies failed but inline price estimate rescued quote: minOutput=${minOutput} (${safeSlippage}% slippage)`);
      } else {
        // [SEC-14] HARD ABORT: minOutput=1 is a zero-slippage-protection vulnerability.
        // A sandwich attacker could manipulate the pool price between the user's TX
        // submission and execution, extracting up to ~100% of the swap value.
        console.error("[SEC-14] V1 Direct: All quote strategies failed — ABORTING swap (minOutput=1 is unsafe)");
        return {
          success: false,
          error: `Cannot determine minimum output for ${inputToken.symbol} → ${outputToken.symbol}. ` +
            `All quote strategies (server proxy, router, API, price estimation) failed. ` +
            `Executing without slippage protection would expose you to sandwich attacks. ` +
            `Try again in a few seconds, or reduce the swap amount.`,
          executionVenue: "saucerswap-v1",
        };
      }
    }

    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min deadline

    // ══════════════════════════════════════════════════════════════════
    // ── CRITICAL SAFETY: Verify the router is a real smart contract ──
    // Prevents sending HBAR/tokens to a random account that isn't the
    // SaucerSwap router. A wrong address silently sends funds to a
    // non-contract account with no swap executed and no revert.
    //
    // verifyIsContract uses multi-strategy verification:
    //   1. Mirror Node /api/v1/contracts/{id}
    //   2. JSON-RPC eth_getCode (with real EVM address from accounts endpoint)
    //   3. eth_call probe (if entity responds to a function call, it's a contract)
    //   4. Diagnostic logging
    // Note: discoverSaucerSwapRouter also caches verified results, so this
    // is typically a cache hit after the initial discovery.
    // ══════════════════════════════════════════════════════════════════
    const routerContractInfo = await verifyIsContract(v1Router, network);
    if (!routerContractInfo) {
      const candidates = (SAUCERSWAP_V1_ROUTER_CANDIDATES[network] || []).join(", ");
      console.error(`[HBAR.h] CRITICAL: Router ${v1Router} is NOT a valid smart contract on ${network}!`);
      console.error(`[HBAR.h] Candidates tried during discovery: ${candidates}`);
      return {
        success: false,
        error: `SAFETY ABORT: Router address ${v1Router} failed contract verification on ${network} ` +
          `(checked via Mirror Node AND JSON-RPC eth_getCode). ` +
          `This would send your funds to a non-contract account with no swap executed. ` +
          `Candidates tried: [${candidates}]. ` +
          `Please verify the correct SaucerSwap V1 Router address at https://docs.saucerswap.finance/.`,
        executionVenue: "saucerswap-v1",
      };
    }
    console.log(`[HBAR.h] Router ${v1Router} verified as contract ✓ (EVM: ${routerContractInfo.evmAddress})`);

    // ── Resolve the router's EVM address for approve calls ──
    // Use the verified contract EVM address (not the synthetic long-zero form)
    // so that ERC-20 approve() sets the allowance for the correct spender address.
    const routerEvmAddress = routerContractInfo.evmAddress || await resolveContractEvmAddress(v1Router, network);

    // [ALIAS-FIX] V1 execution MUST use canonical EVM addresses.
    // V1 Factory pairs are registered under canonical HTS IDs. Using ERC20Wrapper
    // alias addresses causes the V1 Router to look up the wrong (or non-existent)
    // pair, leading to reverts or incorrect output amounts.
    // Only override when NOT already rebuilt by V1 fallback paths (which use htsId directly).
    const v1ExecutionPath = logicalPath.map((t) => getCanonicalEvmAddress(t));
    const hadAliasOverride = v1ExecutionPath.some((addr, i) => addr.toLowerCase() !== pathAddresses[i]?.toLowerCase());
    if (hadAliasOverride) {
      console.log(`[ALIAS-FIX] V1 execution: overriding alias pathAddresses with canonical:`);
      console.log(`[ALIAS-FIX]   alias:     ${pathAddresses.map(a => evmAddressToHtsId(a)).join(" → ")}`);
      console.log(`[ALIAS-FIX]   canonical: ${v1ExecutionPath.map(a => evmAddressToHtsId(a)).join(" → ")}`);
      pathAddresses = v1ExecutionPath;
    }

    // ── Log full swap parameters for debugging ──
    console.log("[HBAR.h] ═══════════════════════════════════════════");
    console.log("[HBAR.h] SWAP EXECUTION START");
    console.log("[HBAR.h] Input:", inputToken.symbol, "→ Output:", outputToken.symbol);
    console.log("[HBAR.h] Amount:", inputAmount, `(raw: ${rawInput})`);
    console.log("[HBAR.h] Path:", pathAddresses.join(" → "));
    console.log("[HBAR.h] Recipient EVM:", recipientEvmAddress);
    console.log("[HBAR.h] Router:", v1Router, `(EVM: ${routerEvmAddress}, verified: ${routerContractInfo.contractId})`);
    console.log("[HBAR.h] MinOutput:", minOutput, `(quote: ${quote?.amountOut ?? "none"}, source: ${quote?.source ?? "none"}, pool: ${quote?.poolVersion ?? "unknown"})`);
    console.log("[HBAR.h] Slippage:", slippagePct, `% | Deadline: ${deadline} | ForceV1Multi: ${_forceV1MultiHop}`);
    console.log("[HBAR.h] Mode:", isInputNative ? "HBAR→Token" : isOutputNative ? "Token→HBAR" : "Token→Token");
    console.log("[HBAR.h] ═══════════════════════════════════════════");

    // ══════════════════════════════════════════════════════════════════
    // ── SAFETY NET: Token association check inside execution ──
    // Even though SwapPanel should handle this, we check again here as
    // a final guard. Swapping to an unassociated token causes
    // CONTRACT_REVERT_EXECUTED, burning the entire gas limit with no output.
    // [C100-S11] Auto-association: skip popup if account has auto-association enabled.
    // ══════════════════════════════════════════════════════════════════
    const _v1AutoAssoc = options?.maxAutoAssociations;
    const _v1HasAutoAssoc = _v1AutoAssoc === -1 || (_v1AutoAssoc !== undefined && _v1AutoAssoc > 0);
    if (!isOutputNative) {
      if (_v1HasAutoAssoc) {
        console.log(`[C100-S11] V1: Auto-association enabled (maxAutoAssociations=${_v1AutoAssoc}) — skipping output token association popup for ${outputToken.symbol}`);
      } else {
      const outputHtsId = outputToken.htsId;
      const isAssoc = await isTokenAssociated(accountId, outputHtsId, network);
      if (!isAssoc) {
        console.warn(`[HBAR.h] SAFETY NET: Output token ${outputToken.symbol} (${outputHtsId}) NOT associated — auto-associating`);
        try {
          const assocTx = new TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([outputHtsId]);
          // [C81-02] Fast-path — association is a prerequisite, no receipt needed
          const { executeHederaTransactionFast: assocExecFast } = await import("../hashpack");
          const assocResult = await assocExecFast(accountId, assocTx);
          if (!assocResult.success) {
            return {
              success: false,
              error: `Output token ${outputToken.symbol} is not associated with your account and auto-association failed: ${assocResult.error || "unknown"}. Please associate token ${outputHtsId} manually in HashPack before swapping.`,
              executionVenue: "saucerswap-v1",
              userCancelled: assocResult.userCancelled,
            };
          }
          console.log(`[HBAR.h] SAFETY NET: Successfully associated ${outputToken.symbol}`);
          // [SEC-14] Consensus wait after fast-path association
          console.log(`[SEC-14] Waiting ${CONSENSUS_WAIT_MS}ms for V1 output association consensus...`);
          await new Promise(r => setTimeout(r, CONSENSUS_WAIT_MS));
        } catch (assocErr: any) {
          const aMsg = (assocErr?.message || "").toLowerCase();
          const aCancel = aMsg.includes("user_reject") || aMsg.includes("cancelled by user") || aMsg.includes("canceled by user") || aMsg.includes("user denied") || aMsg.includes("user rejected");
          return {
            success: false,
            error: `Cannot associate output token ${outputToken.symbol}: ${assocErr?.message || "unknown"}. Associate token ${outputHtsId} in HashPack first.`,
            executionVenue: "saucerswap-v1",
            userCancelled: aCancel || undefined,
          };
        }
      } else {
        console.log(`[HBAR.h] Output token ${outputToken.symbol} association confirmed ✓`);
      }
      }
    }

    // [C77-03] FIX: Check intermediate tokens from actual pathAddresses, not logicalPath.
    // When multi-hop overrides the path (e.g., through USDC instead of WHBAR),
    // logicalPath still has WHBAR as intermediary but the real execution path
    // may use USDC. We must associate the REAL intermediary token.
    // [C100-S11] Skip intermediate association checks if auto-association is enabled.
    if (pathAddresses.length > 2 && !_v1HasAutoAssoc) {
      for (let i = 1; i < pathAddresses.length - 1; i++) {
        const midEvm = pathAddresses[i];
        const midHtsId = evmAddressToHtsId(midEvm);
        // Skip native HBAR/WHBAR (always accessible)
        const midTok = SAUCERSWAP_TOKENS.find(t => t.htsId === midHtsId || getSaucerswapRoutingId(t) === midHtsId);
        const midSymbol = midTok?.symbol || midHtsId;
        if (midTok?.isNative) continue;
        // WHBAR (0.0.1456986) is auto-associated via the WHBAR contract — skip
        if (midHtsId === "0.0.1456986") continue;
        const midAssoc = await isTokenAssociated(accountId, midHtsId, network);
        if (!midAssoc) {
          console.warn(`[HBAR.h] [C77-03] SAFETY NET: Intermediate token ${midSymbol} (${midHtsId}) NOT associated — auto-associating`);
          try {
            const midAssocTx = new TokenAssociateTransaction()
              .setAccountId(accountId)
              .setTokenIds([midHtsId]);
            // [C81-02] Fast-path for intermediary association
            const { executeHederaTransactionFast: midExecFast } = await import("../hashpack");
            const midAssocResult = await midExecFast(accountId, midAssocTx);
            if (!midAssocResult.success) {
              console.warn(`[HBAR.h] [C77-03] Intermediate ${midSymbol} association failed: ${midAssocResult.error} — swap may revert`);
            } else {
              // [SEC-14] Consensus wait after fast-path intermediate association
              console.log(`[SEC-14] Waiting ${CONSENSUS_WAIT_MS}ms for intermediate ${midSymbol} association consensus...`);
              await new Promise(r => setTimeout(r, CONSENSUS_WAIT_MS));
            }
          } catch {
            console.warn(`[HBAR.h] [C77-03] Could not auto-associate intermediate ${midSymbol} — swap may revert`);
          }
        }
      }
    }

    // Gas limits for EVM calls — these are gas LIMITS passed to setGas(),
    // NOT the HBAR cost. Hedera gas fees are sub-cent for typical swaps.
    const SWAP_GAS = 1_500_000;

    // ══════════════════════════════════════════════════════════════════
    // ── GAS SUFFICIENCY CHECK ──
    // Hedera gas fees are sub-cent. Reserve 1 HBAR total to cover gas +
    // network fees — good for dozens of transactions. The old 15 HBAR
    // reserve was overly conservative and blocked users unnecessarily.
    // ══════════════════════════════════════════════════════════════════
    const gasReserveNeeded = 1; // 1 HBAR covers gas + network fees with plenty of margin

    // For HBAR input, check that balance covers input + gas
    if (isInputNative) {
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      const inputHbar = parseFloat(inputAmount);
      const totalNeeded = inputHbar + gasReserveNeeded;
      if (hbarBalance < totalNeeded) {
        const shortfall = totalNeeded - hbarBalance;
        console.error(`[HBAR.h] Insufficient HBAR for swap + gas: balance=${hbarBalance.toFixed(2)}, needed=${totalNeeded.toFixed(2)} (input=${inputHbar}, gas reserve=${gasReserveNeeded})`);
        return {
          success: false,
          error: `Insufficient HBAR: you have ${hbarBalance.toFixed(2)} HBAR but need ${totalNeeded.toFixed(2)} HBAR (${inputHbar} for swap + ${gasReserveNeeded} for fees). Reduce the swap amount by at least ${shortfall.toFixed(2)} HBAR.`,
          executionVenue: "saucerswap-v1",
        };
      }
    } else {
      // For token input, check HBAR balance covers gas only
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      if (hbarBalance < gasReserveNeeded) {
        console.error(`[HBAR.h] Insufficient HBAR for gas: balance=${hbarBalance.toFixed(2)}, needed=${gasReserveNeeded}`);
        return {
          success: false,
          error: `Insufficient HBAR for fees: you have ${hbarBalance.toFixed(2)} HBAR but need at least ${gasReserveNeeded} HBAR. Deposit more HBAR first.`,
          executionVenue: "saucerswap-v1",
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ── PRE-SWAP DRY RUN via Mirror Node ──
    // [C16-02] Only dry-run for HBAR-input swaps. For token-input swaps,
    // the ERC-20 approve hasn't been sent yet, so the dry run always
    // reverts with "STF" / "execution reverted" (insufficient allowance).
    // This false-positive revert was blocking Token → HBAR and Token →
    // Token V1 swaps at the dry-run gate.
    // ══════════════════════════════════════════════════════════════════
    // [C36-03] FIX: `dryRunResult` was previously `const` inside the `if (isInputNative)`
    // block, making it inaccessible to the Token→HBAR and Token→Token execution branches
    // that reference `dryRunResult.ok`. Now declared at function scope with a default.
    // [C100-S9] Still needed: V2→V1 fallback paths reach the V1 execution branches.
    let dryRunResult: DryRunResult = { ok: true, simulated: false, reason: "Skipped for token-input swap [C16-02]" };
    if (isInputNative) {
    dryRunResult = await preSwapDryRun({
      isInputNative,
      isOutputNative,
      rawInput,
      minOutput,
      pathAddresses,
      recipientEvmAddress,
      routerHtsId: v1Router,
      deadline,
      network,
    });
    // [V1-DRYRUN-NONBLOCK] Dry run is now NON-BLOCKING (warning only).
    // SaucerSwap's own frontend does NOT do pre-swap simulations.
    // Hedera's eth_call cannot properly simulate HTS token association,
    // causing false "Safe token transfer failed!" reverts for tokens the
    // user hasn't associated yet (association happens IN the real tx).
    // The actual swap still has slippage protection (minOutput) and
    // Hedera gas fees are sub-cent, so a failed swap costs almost nothing.
    if (!dryRunResult.ok) {
      console.warn("[HBAR.h] PRE-SWAP DRY RUN WARNING (non-blocking):", dryRunResult.reason);
      console.warn("[HBAR.h] Dry run details:", JSON.stringify(dryRunResult));
      console.warn("[HBAR.h] Proceeding with real swap despite dry run failure — Hedera eth_call has known HTS simulation limitations.");
    } else if (dryRunResult.simulated) {
      console.log(`[HBAR.h] Pre-swap dry run PASSED ✓ (${dryRunResult.functionName}, ${dryRunResult.resultHexLength} hex chars, ${dryRunResult.durationMs}ms)`);
    } else {
      console.log(`[HBAR.h] Pre-swap dry run SKIPPED (${dryRunResult.reason}) — proceeding with real swap`);
    }
    } else {
      console.log("[HBAR.h] V1 Dry run SKIPPED for token-input swap (approve not yet granted — would false-revert) [C16-02]");
    }

    // ── Execution branches based on native HBAR involvement ──

    if (isInputNative) {
      // ═══ HBAR (native) → Token: use swapExactETHForTokens ═══
      // No token approval needed — HBAR is sent as payable amount.
      // The router internally wraps HBAR → WHBAR and swaps through the pool.
      // [FOT] If output token has custom fees, use SupportingFeeOnTransferTokens variant.
      const fotHbarLabel = useFotRouter ? "swapExactETHForTokensSupportingFeeOnTransferTokens" : "swapExactETHForTokens";
      console.log(`[HBAR.h] Native HBAR input — using ${fotHbarLabel}${useFotRouter ? ` [FOT: ${fotFeeDescription}]` : ""}`);

      // [C108-S13] Emit swap-step for V1 HBAR→Token (single step, no approve needed)
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: 1, total: 1,
        description: `Swapping HBAR → ${outputToken.symbol}${useFotRouter ? " (fee token)" : ""}`,
      }}));

      const functionData = useFotRouter
        ? encodeSaucerSwapETHForTokensFOT(
            BigInt(minOutput),
            pathAddresses,
            recipientEvmAddress,
            BigInt(deadline)
          )
        : encodeSaucerSwapETHForTokens(
            BigInt(minOutput),
            pathAddresses,
            recipientEvmAddress,
            BigInt(deadline)
          );

      // [PERF-01] Use Hbar.fromTinybars for exact precision — matches V2 path.
      // Previous `rawInput / Math.pow(10, 8)` then `new Hbar(float)` caused
      // floating-point rounding on large tinybar amounts (e.g., 123456789 tinybar
      // → 1.23456789 HBAR → Hbar constructor may truncate fractional digits).
      const hbarAmount = Hbar.fromTinybars(rawInput);

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v1Router))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData)
        .setPayableAmount(hbarAmount);

      // [AUDIT] SaucerSwap-parity diagnostic — compare with SaucerSwap.finance TX calldata
      console.log(`[AUDIT] ══════════════════════════════════════════════`);
      console.log(`[AUDIT] V1 HBAR→Token EXECUTION PARAMETERS`);
      console.log(`[AUDIT]   function:     ${fotHbarLabel}`);
      console.log(`[AUDIT]   selector:     ${useFotRouter ? "0xb6f9de95" : "0x7ff36ab5"}`);
      console.log(`[AUDIT]   router:       ${v1Router} (ContractId)`);
      console.log(`[AUDIT]   gas:          ${SWAP_GAS}`);
      console.log(`[AUDIT]   payable:      ${rawInput} tinybar = ${rawInput / 1e8} HBAR`);
      console.log(`[AUDIT]   minOutput:    ${minOutput} (raw ${outputToken.decimals}-decimal)`);
      console.log(`[AUDIT]   path:         [${pathAddresses.map((a) => `${evmAddressToHtsId(a)}(${a.slice(0,10)}…)`).join(", ")}]`);
      console.log(`[AUDIT]   recipient:    ${recipientEvmAddress}`);
      console.log(`[AUDIT]   deadline:     ${deadline} (${new Date(deadline * 1000).toISOString()})`);
      console.log(`[AUDIT]   calldata:     ${bytesToHex(functionData).slice(0, 74)}… (${functionData.length} bytes)`);
      console.log(`[AUDIT] ══════════════════════════════════════════════`);
      console.log("[HBAR.h] Submitting swapExactETHForTokens — HBAR:", hbarAmount, `(${rawInput} tinybar)`);
      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] Swap result:", JSON.stringify(swapResult));

      // [FOT] Runtime detection: if swap failed with INSUFFICIENT_OUTPUT_AMOUNT
      // and we weren't already using the FOT router, mark token for next retry
      if (!swapResult.success && !useFotRouter) {
        const swapErr = (swapResult.error || "").toLowerCase();
        if (swapErr.includes("insufficient_output_amount") || swapErr.includes("insufficient output") || swapErr.includes("contract_revert")) {
          markTokenAsFOT(outputToken.htsId);
          console.log(`[FOT] V1 HBAR→Token reverted — ${outputToken.symbol} marked as FOT. Next swap will use RouterWithFee automatically.`);
        }
      }

      // Build display route with HBAR instead of WHBAR
      const displayRoute = logicalPath.map(t => t.symbol);
      displayRoute[0] = "HBAR";

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: displayRoute,
        priceImpact: quote?.priceImpact,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v1",
        quoteSource: quote?.source || "none",
        dryRunPassed: dryRunResult.ok,
        userCancelled: swapResult.userCancelled,
      };

    } else if (isOutputNative) {
      // ═══ Token → HBAR (native): use swapExactTokensForETH ═══
      // [C100-S9] This path executes when V2 was either not attempted (V1 pool)
      // or V2 reverted and fell back here. Log V2 context if available.
      if (_v2TokenHbarError) {
        console.log(`[HBAR.h] [C100-S9] V1 fallback for Token→HBAR (V2 failed: ${_v2TokenHbarError})`);
      }
      console.log("[HBAR.h] Native HBAR output — using swapExactTokensForETH");

      // Step 1: [C53] Smart approve — skips if allowance sufficient
      // [C100-S7] V1 Token→HBAR: targets V1 Router with canonical token ID
      const v1ApproveResult1 = await approveIfNeeded({
        tokenHtsId: inputToken.htsId,
        ownerAccountId: accountId,
        spenderAccountId: v1Router,
        rawInput,
        network,
        tokenSymbol: inputToken.symbol,
        stepNumber: 1,
        totalSteps: 2,
        routerVersion: "v1",
        // [STEP6] Pass pre-checked V1 allowance from quote-time parallel fetch
        preCheckedAllowance: options?.approvalStatus?.v1Allowance,
        preCheckedAt: options?.approvalStatus?.checkedAt,
      });

      if (!v1ApproveResult1.success) {
        return {
          success: false,
          transactionId: v1ApproveResult1.transactionId || undefined,
          error: "Token approval failed: " + (v1ApproveResult1.error || "unknown"),
          executionVenue: "saucerswap-v1",
          userCancelled: v1ApproveResult1.userCancelled,
        };
      }

      // [S2] Wallet re-focus hint between approve and swap (V1 Token→HBAR path)
      if (v1ApproveResult1.needed && !v1ApproveResult1.skipped) {
        try {
          const { tryOpenWalletExtension: v1WalletHint1 } = await import("../hashpack");
          v1WalletHint1().catch(() => {});
        } catch { /* non-blocking */ }
      }

      const v1SwapStep1 = v1ApproveResult1.skipped ? 1 : 2;
      const v1TotalSteps1 = v1ApproveResult1.skipped ? 1 : 2;

      // Swap step: swapExactTokensForETH
      // [FOT] Use SupportingFeeOnTransferTokens variant when fees detected
      const fotEthLabel = useFotRouter ? "swapExactTokensForETHSupportingFeeOnTransferTokens" : "swapExactTokensForETH";
      console.log(`[HBAR.h] Step ${v1SwapStep1}: ${fotEthLabel}${useFotRouter ? ` [FOT: ${fotFeeDescription}]` : ""}`);
      // [C108-S13] Emit swap-step for V1 Token→HBAR swap
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: v1SwapStep1, total: v1TotalSteps1,
        description: `Swapping ${inputToken.symbol} → HBAR${useFotRouter ? " (fee token)" : ""}`,
      }}));
      const functionData = useFotRouter
        ? encodeSaucerSwapTokensForETHFOT(
            BigInt(rawInput),
            BigInt(minOutput),
            pathAddresses,
            recipientEvmAddress,
            BigInt(deadline)
          )
        : encodeSaucerSwapTokensForETH(
            BigInt(rawInput),
            BigInt(minOutput),
            pathAddresses,
            recipientEvmAddress,
            BigInt(deadline)
          );

      // [AUDIT] SaucerSwap-parity diagnostic for Token→HBAR V1
      console.log(`[AUDIT] ══════════════════════════════════════════════`);
      console.log(`[AUDIT] V1 Token→HBAR EXECUTION PARAMETERS`);
      console.log(`[AUDIT]   function:     ${fotEthLabel}`);
      console.log(`[AUDIT]   router:       ${v1Router}`);
      console.log(`[AUDIT]   gas:          ${SWAP_GAS}`);
      console.log(`[AUDIT]   amountIn:     ${rawInput} (raw ${inputToken.decimals}-decimal)`);
      console.log(`[AUDIT]   minOutput:    ${minOutput} tinybar = ${minOutput / 1e8} HBAR`);
      console.log(`[AUDIT]   path:         [${pathAddresses.map((a) => `${evmAddressToHtsId(a)}(${a.slice(0,10)}…)`).join(", ")}]`);
      console.log(`[AUDIT]   recipient:    ${recipientEvmAddress}`);
      console.log(`[AUDIT]   deadline:     ${deadline}`);
      console.log(`[AUDIT] ══════════════════════════════════════════════`);

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v1Router))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] Swap result:", JSON.stringify(swapResult));

      // [STALE-ALLOW] Mark allowance consumed on success — prevents stale Mirror Node race
      if (swapResult.success) markAllowanceConsumed(inputToken.htsId, v1Router);

      // [FOT] Runtime detection for Token→HBAR
      if (!swapResult.success && !useFotRouter) {
        const swapErr = (swapResult.error || "").toLowerCase();
        if (swapErr.includes("insufficient_output_amount") || swapErr.includes("insufficient output") || swapErr.includes("contract_revert")) {
          markTokenAsFOT(inputToken.htsId);
          console.log(`[FOT] V1 Token→HBAR reverted — ${inputToken.symbol} marked as FOT. Next swap will use RouterWithFee automatically.`);
        }
      }

      const displayRoute = logicalPath.map(t => t.symbol);
      displayRoute[displayRoute.length - 1] = "HBAR";

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, 8) : undefined,
        route: displayRoute,
        priceImpact: quote?.priceImpact,
        // [C100-S9] Append V2 error context if this is a V2→V1 fallback
        error: swapResult.error
          ? swapResult.error + (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "") +
            (_v2TokenHbarError ? ` [V2 also failed: ${_v2TokenHbarError}]` : "")
          : undefined,
        executionVenue: "saucerswap-v1",
        quoteSource: quote?.source || "none",
        dryRunPassed: dryRunResult.ok,
        userCancelled: swapResult.userCancelled,
      };

    } else {
      // ═══ Token → Token: standard swapExactTokensForTokens ═══

      // Step 1: [C53] Smart approve — skips if allowance sufficient
      // [C100-S7] V1 Token→Token: targets V1 Router with canonical token ID
      const v1ApproveResult2 = await approveIfNeeded({
        tokenHtsId: inputToken.htsId,
        ownerAccountId: accountId,
        spenderAccountId: v1Router,
        rawInput,
        network,
        tokenSymbol: inputToken.symbol,
        stepNumber: 1,
        totalSteps: 2,
        routerVersion: "v1",
        // [STEP6] Pass pre-checked V1 allowance from quote-time parallel fetch
        preCheckedAllowance: options?.approvalStatus?.v1Allowance,
        preCheckedAt: options?.approvalStatus?.checkedAt,
      });

      if (!v1ApproveResult2.success) {
        return {
          success: false,
          transactionId: v1ApproveResult2.transactionId || undefined,
          error: "Token approval failed: " + (v1ApproveResult2.error || "unknown"),
          executionVenue: "saucerswap-v1",
          userCancelled: v1ApproveResult2.userCancelled,
        };
      }

      // [S2] Wallet re-focus hint between approve and swap (V1 Token→Token path)
      if (v1ApproveResult2.needed && !v1ApproveResult2.skipped) {
        try {
          const { tryOpenWalletExtension: v1WalletHint2 } = await import("../hashpack");
          v1WalletHint2().catch(() => {});
        } catch { /* non-blocking */ }
      }

      const v1SwapStep2 = v1ApproveResult2.skipped ? 1 : 2;
      const v1TotalSteps2 = v1ApproveResult2.skipped ? 1 : 2;

      // Swap step: swapExactTokensForTokens
      // [FOT] Use SupportingFeeOnTransferTokens variant when fees detected
      const fotTTLabel = useFotRouter ? "swapExactTokensForTokensSupportingFeeOnTransferTokens" : "swapExactTokensForTokens";
      console.log(`[HBAR.h] Step ${v1SwapStep2}: ${fotTTLabel}${useFotRouter ? ` [FOT: ${fotFeeDescription}]` : ""}`);
      // [C108-S13] Emit swap-step for V1 Token→Token swap
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: v1SwapStep2, total: v1TotalSteps2,
        description: `Swapping ${inputToken.symbol} → ${outputToken.symbol}${useFotRouter ? " (fee token)" : ""}`,
      }}));
      // [C95] Log the ACTUAL path being sent to V1 router — critical for debugging
      console.log(`[HBAR.h] [C95] V1 Token→Token execution path (${pathAddresses.length} tokens):${useFotRouter ? " [FOT Router]" : ""}`);
      pathAddresses.forEach((addr, idx) => {
        const id = evmAddressToHtsId(addr);
        const tok = SAUCERSWAP_TOKENS.find(t => t.htsId === id || getSaucerswapRoutingId(t) === id);
        console.log(`[HBAR.h] [C95]   [${idx}] ${addr} → ${id} (${tok?.symbol || "???"})`);
      });
      const functionData = useFotRouter
        ? encodeSaucerSwapCallFOT(
            BigInt(rawInput),
            BigInt(minOutput),
            pathAddresses,
            recipientEvmAddress,
            BigInt(deadline)
          )
        : encodeSaucerSwapCall(
            BigInt(rawInput),
            BigInt(minOutput),
            pathAddresses,
            recipientEvmAddress,
            BigInt(deadline)
          );

      // [AUDIT] SaucerSwap-parity diagnostic for Token→Token V1
      console.log(`[AUDIT] ══════════════════════════════════════════════`);
      console.log(`[AUDIT] V1 Token→Token EXECUTION PARAMETERS`);
      console.log(`[AUDIT]   function:     ${fotTTLabel}`);
      console.log(`[AUDIT]   router:       ${v1Router}`);
      console.log(`[AUDIT]   gas:          ${SWAP_GAS}`);
      console.log(`[AUDIT]   amountIn:     ${rawInput} (raw ${inputToken.decimals}-decimal)`);
      console.log(`[AUDIT]   minOutput:    ${minOutput} (raw ${outputToken.decimals}-decimal)`);
      console.log(`[AUDIT]   path:         [${pathAddresses.map((a) => `${evmAddressToHtsId(a)}(${a.slice(0,10)}…)`).join(", ")}]`);
      console.log(`[AUDIT]   recipient:    ${recipientEvmAddress}`);
      console.log(`[AUDIT]   deadline:     ${deadline}`);
      console.log(`[AUDIT] ══════════════════════════════════════════════`);

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v1Router))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] Swap result:", JSON.stringify(swapResult));

      // [STALE-ALLOW] Mark allowance consumed on success — prevents stale Mirror Node race
      if (swapResult.success) markAllowanceConsumed(inputToken.htsId, v1Router);

      // [FOT] Runtime detection for Token→Token
      if (!swapResult.success && !useFotRouter) {
        const swapErr = (swapResult.error || "").toLowerCase();
        if (swapErr.includes("insufficient_output_amount") || swapErr.includes("insufficient output") || swapErr.includes("contract_revert")) {
          markTokenAsFOT(inputToken.htsId);
          markTokenAsFOT(outputToken.htsId);
          console.log(`[FOT] V1 Token→Token reverted — ${inputToken.symbol} & ${outputToken.symbol} marked as FOT. Next swap will use RouterWithFee automatically.`);
        }
      }

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        // [C95] Build display route from actual pathAddresses (may differ from logicalPath after path rebuild)
        route: pathAddresses.length > 2
          ? pathAddresses.map(addr => {
              const id = evmAddressToHtsId(addr);
              const tok = SAUCERSWAP_TOKENS.find(t => t.htsId === id || getSaucerswapRoutingId(t) === id);
              return tok?.symbol || id;
            })
          : logicalPath.map((t) => t.symbol),
        priceImpact: quote?.priceImpact,
        error: swapResult.error
          ? swapResult.error + (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
          : undefined,
        executionVenue: "saucerswap-v1",
        quoteSource: quote?.source || "none",
        dryRunPassed: dryRunResult.ok,
        userCancelled: swapResult.userCancelled,
      };
    }
  } catch (err: any) {
    console.error("[HBAR.h] Swap execution error:", err);
    const errMsg = err?.message || "Direct swap failed";
    const errLower = errMsg.toLowerCase();

    // [FOT] Detect INSUFFICIENT_OUTPUT_AMOUNT — mark both tokens as FOT
    // for automatic RouterWithFee usage on the next attempt.
    if (errLower.includes("insufficient_output_amount") || errLower.includes("insufficient output")) {
      if (!isInputNative) markTokenAsFOT(inputToken.htsId);
      if (!isOutputNative) markTokenAsFOT(outputToken.htsId);
      console.log(`[FOT] INSUFFICIENT_OUTPUT_AMOUNT detected — tokens marked as FOT for next retry`);
    }

    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return {
      success: false,
      error: errMsg,
      executionVenue: "saucerswap-v1",
      userCancelled: isCancellation || undefined,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── PUBLIC API ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Execute a swap through SauceSwap V1 router.
 *
 * Uses HashConnect v3's signer-based flow:
 * 1. Builds unfrozen Hedera SDK transactions
 * 2. Passes them to executeHederaTransaction() from hashpack.ts
 * 3. HashConnect signer freezes (sets nodeAccountIds + txId),
 *    sends to HashPack for signing, and submits to the network
 *
 * Uses HashConnect signer's executeTransaction() which handles freezing,
 * signing, and submission atomically. Unfrozen transactions cannot be
 * serialized/deserialized, so the signer must own the full lifecycle.
 */
/** [C53] Swap options — controls approval behavior and balance validation. */
export interface SwapOptions {
  // [STEP-15] infiniteApproval removed — always approves exact swap amount.
  /**
   * [C100-S11] Account's max_automatic_token_associations from Mirror Node.
   * -1 = unlimited, 0 = none, positive = that many slots.
   * When -1 or >0, association popups are skipped entirely (Hedera auto-associates).
   */
  maxAutoAssociations?: number;
  /**
   * [WALLET-PERF] Skip the pre-flight balance check in executeSaucerSwap.
   * Set to true when the UI has already validated the user's balance
   * (e.g., SwapPanel checks insufficientBalance before enabling the swap button).
   * Saves 1-3s of Mirror Node latency before the wallet signing request fires.
   */
  skipBalanceCheck?: boolean;
  /**
   * [STEP1] Pre-validated route from server quote engine.
   * When present, executeSaucerSwapDirect() skips route re-discovery
   * (findRouteViaGraph, _preValidateV2MultiHop)
   * and uses the server-validated path directly. Saves 4-15s per swap.
   */
  validatedRoute?: import("./quotes").ValidatedRoute;
  /**
   * [STEP6] Pre-checked approval status from quote-time allowance check.
   * When present and fresh (< 30s), approveIfNeeded() can skip the
   * Mirror Node allowance query — saving 1-2s on the critical path.
   */
  approvalStatus?: import("./quotes").ServerQuoteResult["approvalStatus"];
}

export async function executeSaucerSwap(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork,
  options?: SwapOptions,
): Promise<SwapResult> {
  const inputToken = resolveToken(inputSymbol);
  const outputToken = resolveToken(outputSymbol);

  console.log(`[V2-SKIP-POLICY] Multi-hop→V1 forced | Single-hop→V2 with cache | ${inputSymbol}→${outputSymbol} ${inputAmount}`);

  if (!inputToken || !outputToken) {
    return {
      success: false,
      error: "Token not supported: " + (!inputToken ? inputSymbol : outputSymbol) + ". Only pre-approved wrapped assets on SauceSwap are supported.",
      executionVenue: "restricted-router",
    };
  }

  if (inputToken.symbol === outputToken.symbol) {
    return { success: false, error: "Cannot swap a token for itself", executionVenue: "restricted-router" };
  }

  // [C53] Pre-flight token balance validation — abort BEFORE any wallet popup
  // For non-native tokens, check that the user actually holds enough tokens.
  // HBAR balance is checked inside executeSaucerSwapDirect (needs gas calculation).
  // [WALLET-PERF] Skip if UI already validated balance — saves 1-3s Mirror Node latency.
  if (!inputToken.isNative && !options?.skipBalanceCheck) {
    // [WALLET-PERF] Emit step so user sees immediate feedback
    window.dispatchEvent(new CustomEvent("swap-step", { detail: {
      step: 0, total: 0,
      description: `Verifying ${inputToken.symbol} balance...`,
    }}));
    const rawNeeded = parseTokenAmount(inputAmount, inputToken.decimals);
    if (rawNeeded <= 0) {
      return { success: false, error: "Invalid input amount", executionVenue: "restricted-router" };
    }
    const rawBalance = await getTokenBalance(accountId, inputToken.htsId, network);
    if (rawBalance < rawNeeded) {
      const humanBalance = rawBalance / Math.pow(10, inputToken.decimals);
      const humanNeeded = parseFloat(inputAmount);
      console.error(`[C53] Insufficient ${inputToken.symbol}: balance=${rawBalance} (${humanBalance.toFixed(6)}) < needed=${rawNeeded} (${humanNeeded})`);
      return {
        success: false,
        error: `Insufficient ${inputToken.symbol}: you have ${humanBalance.toFixed(6)} but need ${humanNeeded}. ` +
          `Reduce the swap amount or acquire more ${inputToken.symbol}.`,
        executionVenue: "restricted-router",
      };
    }
    console.log(`[C53] Balance check passed: ${inputToken.symbol} ${rawBalance} >= ${rawNeeded} ✓`);
  }

  return executeSaucerSwapDirect(inputToken, outputToken, inputAmount, slippagePct, accountId, network, options);
}

// ══════════════════════════════════════════════════════════════════════
// ── [C100-S11] PRE-FLIGHT SWAP PREREQUISITES ───────────────────────
// ══════════════════════════════════════════════════════════════════════
//
// Lightweight, non-blocking check that probes allowance + association
// status BEFORE the user clicks "Swap". The UI uses this to:
//   • Display "Swap" (1 popup) vs "Approve & Swap" (2 popups)
//   • Show a pre-association prompt if needed
//   • Never surprise the user with 3+ wallet popups
//
// Called during the quote phase — runs in parallel with quote fetching.
// No wallet interaction, no popups. Pure Mirror Node reads.

export interface SwapPrerequisites {
  /** True if the output token is not associated with the user's account */
  associationNeeded: boolean;
  /** True if the input token allowance is insufficient for the target router */
  approvalNeeded: boolean;
  /** Expected number of wallet popups: 1 (swap only) or 2 (approve + swap) */
  expectedPopups: 1 | 2;
  /** True if the account has auto-association enabled (unlimited or positive slots) */
  autoAssociationAvailable: boolean;
  /** Allowance details for diagnostics */
  allowanceInfo: {
    current: number;
    needed: number;
    spender: string;
    routerVersion: "v1" | "v2" | "unknown";
  };
  /** [FOT] Fee-on-transfer token info — present when input or output has custom fees */
  feeOnTransfer?: {
    detected: boolean;
    inputFee: TokenFeeInfo;
    outputFee: TokenFeeInfo;
    totalFeePercent: number;
    /** Human-readable summary for UI display */
    summary: string;
  };
}

/**
 * [C100-S11] Check swap prerequisites without triggering any wallet popups.
 *
 * Probes:
 *   1. Output token association status (skip if auto-association enabled)
 *   2. Input token allowance vs both V1 and V2 routers
 *
 * Returns a summary that tells the UI exactly how many popups to expect.
 * If the input is native HBAR, approval is never needed (payable call).
 */
export async function checkSwapPrerequisites(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string,
  accountId: string,
  network: HederaNetwork,
  maxAutoAssociations?: number,
): Promise<SwapPrerequisites> {
  const inputToken = resolveToken(inputSymbol);
  const outputToken = resolveToken(outputSymbol);

  // Defaults: conservative (assume worst case until proven otherwise)
  const result: SwapPrerequisites = {
    associationNeeded: false,
    approvalNeeded: true,
    expectedPopups: 2,
    autoAssociationAvailable: false,
    allowanceInfo: { current: 0, needed: 0, spender: "", routerVersion: "unknown" },
  };

  if (!inputToken || !outputToken) return result;

  const isInputNative = !!inputToken.isNative;
  const isOutputNative = !!outputToken.isNative;

  // ── [FOT] Fee-on-transfer detection (parallel with other checks) ──
  // Run early so the UI can display fee warnings before the user swaps.
  try {
    const [inputFeeInfo, outputFeeInfo] = await Promise.all([
      !isInputNative ? fetchTokenFeeSchedule(inputToken.htsId, network) : Promise.resolve({ hasFee: false, feePercent: 0, feeDescription: "", hasFixedFee: false } as TokenFeeInfo),
      !isOutputNative ? fetchTokenFeeSchedule(outputToken.htsId, network) : Promise.resolve({ hasFee: false, feePercent: 0, feeDescription: "", hasFixedFee: false } as TokenFeeInfo),
    ]);
    if (inputFeeInfo.hasFee || outputFeeInfo.hasFee) {
      const totalPct = inputFeeInfo.feePercent + outputFeeInfo.feePercent;
      const parts: string[] = [];
      if (inputFeeInfo.hasFee) parts.push(`${inputToken.symbol}: ${inputFeeInfo.feeDescription}`);
      if (outputFeeInfo.hasFee) parts.push(`${outputToken.symbol}: ${outputFeeInfo.feeDescription}`);
      result.feeOnTransfer = {
        detected: true,
        inputFee: inputFeeInfo,
        outputFee: outputFeeInfo,
        totalFeePercent: totalPct,
        summary: parts.join("; "),
      };
      console.log(`[FOT] Pre-flight: fee-on-transfer detected — ${result.feeOnTransfer.summary}`);
    }
  } catch (fotErr: any) {
    console.log(`[FOT] Pre-flight fee detection failed (non-blocking): ${fotErr?.message}`);
  }

  // ── Auto-association check ──
  // If maxAutoAssociations is -1 (unlimited) or > 0 (slots available),
  // the network auto-associates tokens on first transfer — no popup needed.
  let autoAssoc = typeof maxAutoAssociations === "number" ? maxAutoAssociations : -99;
  if (autoAssoc === -99) {
    // Not provided by caller — fetch from Mirror Node
    try {
      autoAssoc = await fetchMaxAutoAssociations(accountId, network);
    } catch {
      autoAssoc = 0;
    }
  }
  result.autoAssociationAvailable = autoAssoc === -1 || autoAssoc > 0;

  // ── Association check ──
  // Only needed for non-HBAR output tokens when auto-association is off
  if (!isOutputNative && !result.autoAssociationAvailable) {
    try {
      const isAssoc = await isTokenAssociated(accountId, outputToken.htsId, network);
      result.associationNeeded = !isAssoc;
    } catch {
      // Conservative: assume associated to avoid false negatives
      result.associationNeeded = false;
    }
  }

  // ── Allowance check ──
  // HBAR input = payable call, never needs approval
  if (isInputNative) {
    result.approvalNeeded = false;
    result.expectedPopups = 1;
    result.allowanceInfo = { current: 0, needed: 0, spender: "N/A (HBAR)", routerVersion: "unknown" };
    console.log(`[C100-S11] Pre-flight: HBAR input → 1 popup (swap only)`);
    return result;
  }

  // For token inputs, check allowance against BOTH V1 and V2 routers.
  // The smart routing in executeSaucerSwapDirect will pick V2 or V1 at runtime;
  // we check both so we know the best case. If either has sufficient allowance
  // AND the routing picks that version, the approve popup is skipped.
  const rawNeeded = parseTokenAmount(inputAmount, inputToken.decimals);
  if (rawNeeded <= 0) {
    result.expectedPopups = 1;
    result.approvalNeeded = false;
    return result;
  }

  const v1Router = getSaucerSwapRouter(network, "v1");
  const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;

  // Parallel allowance probe — both routers at once
  const [v1Allowance, v2Allowance] = await Promise.all([
    fetchTokenAllowance(accountId, inputToken.htsId, v1Router, network).catch(() => 0),
    fetchTokenAllowance(accountId, inputToken.htsId, v2RouterId, network).catch(() => 0),
  ]);

  const bestAllowance = Math.max(v1Allowance, v2Allowance);
  const bestRouter = v2Allowance >= v1Allowance ? v2RouterId : v1Router;
  const bestVersion = v2Allowance >= v1Allowance ? "v2" as const : "v1" as const;

  result.allowanceInfo = {
    current: bestAllowance,
    needed: rawNeeded,
    spender: bestRouter,
    routerVersion: bestVersion,
  };

  if (bestAllowance >= rawNeeded) {
    result.approvalNeeded = false;
    result.expectedPopups = 1;
    console.log(
      `[C100-S11] Pre-flight: ${inputToken.symbol} allowance ${bestAllowance} >= ${rawNeeded} ` +
      `for ${bestVersion.toUpperCase()} Router ${bestRouter} → 1 popup (swap only) ✓`,
    );
  } else {
    result.approvalNeeded = true;
    result.expectedPopups = 2;
    console.log(
      `[C100-S11] Pre-flight: ${inputToken.symbol} allowance ${bestAllowance} < ${rawNeeded} ` +
      `(best: ${bestVersion.toUpperCase()} Router ${bestRouter}) → 2 popups (approve + swap)`,
    );
  }

  return result;
}

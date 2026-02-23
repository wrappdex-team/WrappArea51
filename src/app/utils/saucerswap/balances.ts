/**
 * [C67] SaucerSwap Balance & Association Helpers
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: isTokenAssociated, getTokenBalance, getNativeHbarBalance.
 *
 * Each function uses the server proxy (ssProxy) as the primary strategy
 * with a direct Mirror Node fallback for browser environments where
 * CORS/rate-limiting may block proxy calls.
 */

import type { HederaNetwork } from "./tokens";
import { MIRROR_NODES } from "./contracts";
import { makeAbort } from "./prices";
import { ssProxy } from "./pools";

// ── Token Association Check ─────────────────────────────────────────

export async function isTokenAssociated(
  accountId: string,
  tokenId: string,
  network: HederaNetwork = "mainnet"
): Promise<boolean> {
  // [C47] Server proxy -- circuit-breaker protected, cached server-side
  const data = await ssProxy<{ isAssociated: boolean }>("/association", {
    account: accountId, token: tokenId, network,
  });
  if (data != null) return !!data.isAssociated;

  // Fallback: direct Mirror Node (browser may hit CORS/rate limits)
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      base + "/api/v1/accounts/" + accountId + "/tokens?token.id=" + tokenId + "&limit=1",
      { signal: makeAbort(8000) }
    );
    if (!res.ok) return false;
    const resp = await res.json();
    return Array.isArray(resp.tokens) && resp.tokens.length > 0;
  } catch {
    return false;
  }
}

export async function getTokenBalance(
  accountId: string,
  tokenId: string,
  network: HederaNetwork = "mainnet"
): Promise<number> {
  // [C47] Server proxy -- returns { tokenBalance, hbarBalance, decimals, isAssociated }
  const data = await ssProxy<{ tokenBalance: number }>("/balance", {
    account: accountId, token: tokenId, network,
  });
  if (data != null && typeof data.tokenBalance === "number") return data.tokenBalance;

  // Fallback: direct Mirror Node
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      base + "/api/v1/accounts/" + accountId + "/tokens?token.id=" + tokenId + "&limit=1",
      { signal: makeAbort(8000) }
    );
    if (!res.ok) return 0;
    const resp = await res.json();
    if (Array.isArray(resp.tokens) && resp.tokens.length > 0) {
      return parseInt(resp.tokens[0].balance || "0", 10);
    }
    return 0;
  } catch {
    return 0;
  }
}

// ── Token Allowance Check [C53] ─────────────────────────────────────

/**
 * [C53] Fetch existing HTS token allowance for a specific spender.
 *
 * Queries Mirror Node:
 *   GET /api/v1/accounts/{accountId}/allowances/tokens?token.id={tokenId}&spender.id={spenderId}
 *
 * Returns the raw allowance amount (smallest unit). Returns 0 if no
 * allowance exists or on any error — this is safe because it simply
 * means the approve step will proceed as normal.
 */
export async function fetchTokenAllowance(
  accountId: string,
  tokenId: string,
  spenderId: string,
  network: HederaNetwork = "mainnet",
): Promise<number> {
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const url = `${base}/api/v1/accounts/${accountId}/allowances/tokens` +
      `?token.id=${tokenId}&spender.id=${spenderId}&limit=1`;
    const res = await fetch(url, { signal: makeAbort(8000) });
    if (!res.ok) {
      console.log(`[C53] Allowance check HTTP ${res.status} for ${tokenId} spender=${spenderId}`);
      return 0;
    }
    const data = await res.json();
    if (Array.isArray(data.allowances) && data.allowances.length > 0) {
      const allowance = parseInt(data.allowances[0].amount || "0", 10);
      console.log(`[C53] Existing allowance for ${tokenId} spender=${spenderId}: ${allowance}`);
      return allowance;
    }
    console.log(`[C53] No existing allowance for ${tokenId} spender=${spenderId}`);
    return 0;
  } catch (err: any) {
    console.log(`[C53] Allowance check failed: ${err?.message || err}`);
    return 0;
  }
}

/**
 * Get native HBAR balance for an account.
 * Returns balance in tinybars (1 HBAR = 100,000,000 tinybar).
 */
export async function getNativeHbarBalance(
  accountId: string,
  network: HederaNetwork = "mainnet"
): Promise<number> {
  // [C47] Server proxy -- "native" token returns hbarBalance in tinybars
  const data = await ssProxy<{ hbarBalance: number }>("/balance", {
    account: accountId, token: "native", network,
  });
  if (data != null && typeof data.hbarBalance === "number") return data.hbarBalance;

  // Fallback: direct Mirror Node
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      base + "/api/v1/accounts/" + accountId,
      { signal: makeAbort(8000) }
    );
    if (!res.ok) return 0;
    const resp = await res.json();
    return parseInt(resp.balance?.balance || "0", 10);
  } catch {
    return 0;
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── [C100-S11] PRE-FLIGHT ASSOCIATION CHECK ────────────────────────
// ══════════════════════════════════════════════════════════════════════
//
// Batch-check which tokens from a given list are already associated
// with the account. Used at connection time and during swap pre-flight
// to determine if association popups are needed.

/**
 * [C100-S11] Check association status for multiple tokens in parallel.
 * Returns a Map of tokenId → isAssociated.
 */
export async function batchCheckAssociations(
  accountId: string,
  tokenIds: string[],
  network: HederaNetwork = "mainnet",
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (tokenIds.length === 0) return result;

  // Fetch all in parallel (Mirror Node is fast for these queries)
  const checks = await Promise.all(
    tokenIds.map(async (tokenId) => {
      const assoc = await isTokenAssociated(accountId, tokenId, network);
      return { tokenId, assoc };
    }),
  );

  for (const { tokenId, assoc } of checks) {
    result.set(tokenId, assoc);
  }
  return result;
}

/**
 * [C100-S11] Check if account has auto-association enabled.
 * Queries the Mirror Node for max_automatic_token_associations.
 * Returns: -1 (unlimited), 0 (none), or positive int (limited slots).
 */
export async function fetchMaxAutoAssociations(
  accountId: string,
  network: HederaNetwork = "mainnet",
): Promise<number> {
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/accounts/${accountId}`,
      { signal: makeAbort(8000) },
    );
    if (!res.ok) return 0;
    const data = await res.json();
    // Mirror Node returns max_automatic_token_associations:
    //   -1 = unlimited, 0 = none, positive = that many slots
    const val = data.max_automatic_token_associations;
    const result = typeof val === "number" ? val : 0;
    console.log(`[C100-S11] maxAutoAssociations for ${accountId}: ${result} (${result === -1 ? "unlimited" : result === 0 ? "none" : result + " slots"})`);
    return result;
  } catch (err: any) {
    console.log(`[C100-S11] Failed to fetch maxAutoAssociations: ${err?.message || err}`);
    return 0;
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── [FOT] TOKEN CUSTOM FEE SCHEDULE DETECTION ──────────────────────
// ══════════════════════════════════════════════════════════════════════
//
// Hedera HTS tokens can have custom fee schedules (fractional fees,
// fixed fees, royalty fees) that deduct tokens on every transfer.
// These tokens cause INSUFFICIENT_OUTPUT_AMOUNT on standard UniswapV2
// swap functions because the router's internal accounting doesn't
// match the actual amount received (some tokens were deducted as fees).
//
// Detection queries the Mirror Node `/api/v1/tokens/{id}` endpoint
// and inspects the `custom_fees` field. Results are cached (5 min TTL)
// to avoid redundant API calls during rapid quote refreshes.
//
// Production DEXes (Uniswap, PancakeSwap, SaucerSwap) solve this with
// dedicated `...SupportingFeeOnTransferTokens` router functions that
// check actual balance changes instead of expected amounts.

export interface TokenFeeInfo {
  /** True if token has any custom fee that affects transfer amounts */
  hasFee: boolean;
  /** Combined fee percentage (fractional + royalty). 0 if no fees or fixed-only. */
  feePercent: number;
  /** Human-readable fee description for UI display */
  feeDescription: string;
  /** Whether there are fixed fees (not expressible as %) */
  hasFixedFee: boolean;
}

const feeScheduleCache = new Map<string, TokenFeeInfo & { timestamp: number }>();
const FEE_CACHE_TTL = 300_000; // 5 min

/** Runtime fallback cache: tokens that caused INSUFFICIENT_OUTPUT_AMOUNT */
const fotFallbackCache = new Set<string>();

/**
 * Mark a token as fee-on-transfer based on runtime behavior (swap revert).
 * This is the fallback for tokens where Mirror Node doesn't report custom fees
 * but the swap still fails with INSUFFICIENT_OUTPUT_AMOUNT.
 */
export function markTokenAsFOT(tokenId: string): void {
  fotFallbackCache.add(tokenId);
  console.log(`[FOT] Runtime fallback: ${tokenId} marked as fee-on-transfer`);
}

/**
 * Check if a token was previously marked as FOT via runtime fallback.
 */
export function isRuntimeFOT(tokenId: string): boolean {
  return fotFallbackCache.has(tokenId);
}

/**
 * [FOT] Fetch token custom fee schedule from Mirror Node.
 *
 * Returns fee info including whether the token has transfer fees,
 * the approximate fee percentage, and a human-readable description.
 * Results are cached for 5 minutes.
 *
 * Also checks the runtime fallback cache for tokens that triggered
 * INSUFFICIENT_OUTPUT_AMOUNT in previous swap attempts.
 */
export async function fetchTokenFeeSchedule(
  tokenId: string,
  network: HederaNetwork = "mainnet",
): Promise<TokenFeeInfo> {
  // Native HBAR has no custom fees
  if (tokenId === "0.0.0" || !tokenId) {
    return { hasFee: false, feePercent: 0, feeDescription: "", hasFixedFee: false };
  }

  // Runtime fallback cache (from previous INSUFFICIENT_OUTPUT_AMOUNT errors)
  if (fotFallbackCache.has(tokenId)) {
    return {
      hasFee: true,
      feePercent: 2, // Conservative estimate
      feeDescription: "Transfer fee detected (runtime)",
      hasFixedFee: false,
    };
  }

  // Check TTL cache
  const cached = feeScheduleCache.get(tokenId);
  if (cached && Date.now() - cached.timestamp < FEE_CACHE_TTL) {
    return { hasFee: cached.hasFee, feePercent: cached.feePercent, feeDescription: cached.feeDescription, hasFixedFee: cached.hasFixedFee };
  }

  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/tokens/${tokenId}`,
      { signal: makeAbort(5000) },
    );

    if (!res.ok) {
      return { hasFee: false, feePercent: 0, feeDescription: "", hasFixedFee: false };
    }

    const data = await res.json();
    let totalFeePercent = 0;
    let hasFee = false;
    let hasFixedFee = false;
    const feeDescParts: string[] = [];

    if (data.custom_fees) {
      // ── Fractional fees: percentage of transfer amount ──
      if (data.custom_fees.fractional_fees?.length > 0) {
        for (const ff of data.custom_fees.fractional_fees) {
          if (ff.amount?.numerator && ff.amount?.denominator && ff.amount.denominator > 0) {
            const pct = (ff.amount.numerator / ff.amount.denominator) * 100;
            totalFeePercent += pct;
            hasFee = true;
            feeDescParts.push(`${pct.toFixed(2)}% fractional fee`);
          }
        }
      }

      // ── Fixed fees denominated in the same token ──
      if (data.custom_fees.fixed_fees?.length > 0) {
        for (const fixedFee of data.custom_fees.fixed_fees) {
          if (fixedFee.denominating_token_id === tokenId || !fixedFee.denominating_token_id) {
            hasFee = true;
            hasFixedFee = true;
            feeDescParts.push(`Fixed fee: ${fixedFee.amount || "?"} units`);
          }
        }
      }

      // ── Royalty fees ──
      if (data.custom_fees.royalty_fees?.length > 0) {
        for (const rf of data.custom_fees.royalty_fees) {
          if (rf.amount?.numerator && rf.amount?.denominator && rf.amount.denominator > 0) {
            const pct = (rf.amount.numerator / rf.amount.denominator) * 100;
            totalFeePercent += pct;
            hasFee = true;
            feeDescParts.push(`${pct.toFixed(2)}% royalty fee`);
          }
        }
      }
    }

    const result: TokenFeeInfo = {
      hasFee,
      feePercent: totalFeePercent,
      feeDescription: feeDescParts.join("; ") || "",
      hasFixedFee,
    };

    // Cache the result
    feeScheduleCache.set(tokenId, { ...result, timestamp: Date.now() });

    if (hasFee) {
      console.log(`[FOT] Token ${tokenId} has custom fees: ${result.feeDescription} (total ~${totalFeePercent.toFixed(2)}%)`);
    }

    return result;
  } catch (err: any) {
    console.log(`[FOT] Fee schedule check failed for ${tokenId}: ${err?.message || err}`);
    return { hasFee: false, feePercent: 0, feeDescription: "", hasFixedFee: false };
  }
}
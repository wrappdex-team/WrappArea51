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
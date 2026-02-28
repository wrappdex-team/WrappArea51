/**
 * [SECURITY] Scam Token Blocklist & Validation
 * 
 * Prevents users from receiving worthless scam tokens with similar names
 * to legitimate blue-chip assets. These tokens typically have:
 *   - Astronomical fake balances (e.g., 51,503 fake WBTC)
 *   - Near-zero prices (e.g., $0.000004 instead of $65,000)
 *   - Very low liquidity (< $10k)
 *   - No official website or social links
 * 
 * All blocked tokens are documented with evidence (screenshots, HashScan links).
 */

export interface BlockedToken {
  htsId: string;
  fakeSymbol: string;
  realTokenId: string;
  realSymbol: string;
  reason: string;
  discoveredDate: string;
}

/**
 * Known scam/fake tokens - HARD BLOCK at all swap/liquidity layers.
 * These tokens are NEVER allowed for trading or liquidity operations.
 */
export const SCAM_TOKEN_BLOCKLIST: BlockedToken[] = [
  {
    htsId: "0.0.10152778",
    fakeSymbol: "LINK",
    realTokenId: "0.0.1055495",
    realSymbol: "LINK (HashPort)",
    reason: "Fake Chainlink token with very low liquidity. Real LINK is 0.0.1055495 at ~$16-18.",
    discoveredDate: "2025-02-25",
  },
  {
    htsId: "0.0.10104132",
    fakeSymbol: "WBTC",
    realTokenId: "0.0.1055483",
    realSymbol: "WBTC (HashPort)",
    reason: "Fake Wrapped Bitcoin with astronomical balances (51k+) and $0.000004 price. Real WBTC is 0.0.1055483 at ~$65k-$104k.",
    discoveredDate: "2025-02-25",
  },
  {
    htsId: "0.0.10096415",
    fakeSymbol: "SMACKM",
    realTokenId: "0.0.8041571",
    realSymbol: "SMACKM",
    reason: "Fake SMACKM imposter token. Auto-reconciliation wrongly picked this as canonical. Real SMACKM is 0.0.8041571. Guardrails blocked the swap — token now hard-blocked.",
    discoveredDate: "2026-02-28",
  },
];

/** Fast lookup set for O(1) blocking */
const BLOCKED_IDS = new Set(SCAM_TOKEN_BLOCKLIST.map(t => t.htsId));

/**
 * Check if a token ID is on the scam blocklist.
 * Returns true if token should be blocked.
 */
export function isTokenBlocked(htsId: string): boolean {
  return BLOCKED_IDS.has(htsId);
}

/**
 * Get blocklist entry details for a blocked token.
 * Returns undefined if token is not blocked.
 */
export function getBlockedTokenInfo(htsId: string): BlockedToken | undefined {
  return SCAM_TOKEN_BLOCKLIST.find(t => t.htsId === htsId);
}

/**
 * Validate a token is safe for swapping/liquidity operations.
 * Throws error if token is blocked.
 */
export function validateTokenSafety(htsId: string, operation: "swap" | "liquidity" = "swap"): void {
  if (isTokenBlocked(htsId)) {
    const info = getBlockedTokenInfo(htsId)!;
    throw new Error(
      `[SECURITY] Token ${htsId} (${info.fakeSymbol}) is blocked: ${info.reason} ` +
      `Use ${info.realTokenId} (${info.realSymbol}) instead.`
    );
  }
}

/**
 * Filter out blocked tokens from a list.
 * Logs warnings for any blocked tokens found.
 */
export function filterBlockedTokens<T extends { htsId: string }>(
  tokens: T[],
  context: string = "token list"
): T[] {
  return tokens.filter(t => {
    if (isTokenBlocked(t.htsId)) {
      const info = getBlockedTokenInfo(t.htsId)!;
      console.warn(
        `[SECURITY] Filtered blocked token ${t.htsId} (${info.fakeSymbol}) from ${context}. ` +
        `Reason: ${info.reason}`
      );
      return false;
    }
    return true;
  });
}

/**
 * Minimum liquidity (USD) required for a token to be considered legitimate.
 * Tokens below this threshold trigger warnings (but are not hard-blocked).
 */
export const MIN_SAFE_LIQUIDITY_USD = 10_000;

/**
 * Check if a token has sufficient liquidity to be considered safe.
 * This is a SOFT check (warning only) — not a hard block like the scam list.
 */
export interface LiquidityCheck {
  safe: boolean;
  liquidityUsd: number;
  warning?: string;
}

export async function checkTokenLiquidity(htsId: string): Promise<LiquidityCheck> {
  // Skip check for blocked tokens (they'll fail validation anyway)
  if (isTokenBlocked(htsId)) {
    return {
      safe: false,
      liquidityUsd: 0,
      warning: "Token is on scam blocklist",
    };
  }

  try {
    const res = await fetch(`https://api.saucerswap.finance/tokens/${htsId}`);
    if (!res.ok) {
      return {
        safe: false,
        liquidityUsd: 0,
        warning: "Token not listed on SaucerSwap",
      };
    }

    const data = await res.json();
    const liquidityUsd = data.liquidityUsd || 0;

    if (liquidityUsd < MIN_SAFE_LIQUIDITY_USD) {
      return {
        safe: false,
        liquidityUsd,
        warning: `Low liquidity: $${liquidityUsd.toFixed(0)} (min: $${MIN_SAFE_LIQUIDITY_USD.toLocaleString()})`,
      };
    }

    return {
      safe: true,
      liquidityUsd,
    };
  } catch (err) {
    return {
      safe: false,
      liquidityUsd: 0,
      warning: "Failed to fetch liquidity data",
    };
  }
}
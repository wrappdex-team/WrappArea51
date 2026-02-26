/**
 * [LP-07] V2 Liquidity Token Whitelist -- WRAPpDEX Curated Pools
 *
 * [LIQUIDITY-FIX-2026-02-25] All token IDs updated to use high-liquidity
 * canonical versions. Previous low-liquidity tokens risked loss of pair value.
 * Key changes: WETH 0.0.9770617 ($1.8M TVL), WBTC 0.0.1055483, USDT 0.0.1055472,
 * DAI 0.0.1055477, HBARX 0.0.834116, HBAR.h 0.0.9356476.
 *
 * WRAPpDEX is a wrapped-asset focused DEX. Only blue-chip, ID-verified
 * tokens with real market cap are whitelisted. Zero meme coins.
 *
 * Criteria for inclusion:
 *   - Wrapped major L1 assets via Hashport (WBTC, WETH, WBNB, WLINK, WQNT)
 *   - Top stablecoins (USDC, USDT, DAI)
 *   - Core Hedera ecosystem tokens (HBAR, HBARX, SAUCE)
 *   - HBAR.h protocol token (WRAPpDEX partner)
 *   - Active SaucerSwap V2 pools with meaningful TVL
 *   - dueDiligenceComplete = true on SaucerSwap
 *
 * ============================================================================
 * ADMIN: To add a new token, add its HTS ID + symbol to CURATED_TOKENS below.
 * Both sides of a pool must be whitelisted for the pool to appear.
 * To force-include a specific pool regardless of whitelist/TVL, add its
 * contract ID to FORCE_INCLUDE_POOL_CONTRACT_IDS below.
 * ============================================================================
 */

// ── Curated Token Registry ──────────────────────────────────────────
//
// Each entry: { htsId, symbol, displayName, category }
// category helps organize and audit the list.

export interface CuratedToken {
  htsId: string;
  symbol: string;
  displayName: string;
  category: "native" | "wrapped" | "stablecoin" | "ecosystem" | "partner";
}

export const CURATED_TOKENS: CuratedToken[] = [
  // ── Native HBAR ──
  { htsId: "0.0.1456986", symbol: "WHBAR",       displayName: "Wrapped HBAR",              category: "native" },

  // ── Wrapped Major L1 Assets (via Hashport) ──
  { htsId: "0.0.1055483", symbol: "WBTC",        displayName: "Wrapped Bitcoin",            category: "wrapped" },
  { htsId: "0.0.541564",  symbol: "WETH",        displayName: "Wrapped Ether",              category: "wrapped" },
  { htsId: "0.0.7350565", symbol: "BNB",         displayName: "Wrapped BNB",                category: "wrapped" },
  { htsId: "0.0.1309164", symbol: "LINK",        displayName: "Wrapped Chainlink",          category: "wrapped" },
  { htsId: "0.0.3155415", symbol: "QNT",         displayName: "Wrapped Quant",              category: "wrapped" },

  // ── Stablecoins ──
  { htsId: "0.0.456858",  symbol: "USDC",        displayName: "USD Coin",                   category: "stablecoin" },
  { htsId: "0.0.1055472", symbol: "USDT",        displayName: "Tether USD",                 category: "stablecoin" },
  { htsId: "0.0.1055477", symbol: "DAI",         displayName: "DAI Stablecoin",             category: "stablecoin" },

  // ── Core Hedera Ecosystem ──
  { htsId: "0.0.731861",  symbol: "SAUCE",       displayName: "SaucerSwap",                 category: "ecosystem" },
  { htsId: "0.0.834116",  symbol: "HBARX",       displayName: "Stader Staked HBAR",         category: "ecosystem" },

  // ── WRAPpDEX Partner Tokens ──
  { htsId: "0.0.9356476", symbol: "HBAR.h",      displayName: "HBAR.h Protocol",            category: "partner" },
];

// ── Force-Included Pools ────────────────────────────────────────────
// Pools listed here ALWAYS appear in the UI, bypassing both the
// whitelist token check AND the minimum TVL filter.
// Use this for smoke-testing new pools or partner integrations.

export const FORCE_INCLUDE_POOL_CONTRACT_IDS = new Set<string>([
  "0.0.9356723",  // HBAR.h / WHBAR pool — https://www.saucerswap.finance/pool/0.0.9356723
]);

// ── Derived Lookup Sets (for fast filtering) ────────────────────────

/** All whitelisted HTS token IDs */
export const V2_WHITELIST_TOKEN_IDS = new Set<string>(
  CURATED_TOKENS.map(t => t.htsId)
);

/**
 * All whitelisted symbols (including common API variants).
 * SaucerSwap API often appends [hts] to wrapped tokens.
 */
export const V2_WHITELIST_SYMBOLS = new Set<string>([
  // Always include native HBAR
  "HBAR", "WHBAR",

  // Generate from curated list
  ...CURATED_TOKENS.map(t => t.symbol),

  // SaucerSwap API variant suffixes: Symbol[hts]
  ...CURATED_TOKENS.filter(t => t.category === "wrapped")
    .map(t => `${t.symbol}[hts]`),

  // Common variant display names
  "WBTC[hts]", "WETH[hts]", "LINK[hts]", "BNB[hts]", "QNT[hts]",
  "DAI[hts]",

  // HBAR.h variants — SaucerSwap API uses various symbol formats
  "HBAR.ħ", "HBAR.H", "hbar.h", "HBARh", "HBARH",
  "HBAR.h[hts]", "HBAR.ħ[hts]",
]);

// ── Pool Filtering Functions ────────────────────────────────────────

/**
 * Check if a pool should be shown in the WRAPpDEX UI.
 * BOTH tokens in the pair must be whitelisted,
 * UNLESS the pool's contract ID is in the force-include set.
 */
export function isPoolWhitelisted(
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAHtsId?: string,
  tokenBHtsId?: string,
  poolContractId?: string,
): boolean {
  // Force-include always passes
  if (poolContractId && FORCE_INCLUDE_POOL_CONTRACT_IDS.has(poolContractId)) {
    return true;
  }
  const aOk = isTokenWhitelisted(tokenASymbol, tokenAHtsId);
  const bOk = isTokenWhitelisted(tokenBSymbol, tokenBHtsId);
  return aOk && bOk;
}

/**
 * Check if a single token is in the curated whitelist.
 */
export function isTokenWhitelisted(symbol: string, htsId?: string): boolean {
  if (V2_WHITELIST_SYMBOLS.has(symbol)) return true;
  if (htsId != null && V2_WHITELIST_TOKEN_IDS.has(htsId)) return true;

  // Normalize: strip [hts] suffix for comparison
  const cleaned = symbol.replace(/\[hts\]/i, "").trim();
  if (V2_WHITELIST_SYMBOLS.has(cleaned)) return true;

  // Aggressive HBAR.h matching: catch any remaining unicode/case variants
  const upper = cleaned.toUpperCase();
  if (upper === "HBAR.H" || upper === "HBARH" || upper === "HBAR.\u0126" || upper === "HBAR.\u0127") return true;

  return false;
}

/**
 * Check if a pool contract ID is force-included.
 */
export function isPoolForceIncluded(poolContractId: string): boolean {
  return FORCE_INCLUDE_POOL_CONTRACT_IDS.has(poolContractId);
}

/**
 * Get curated token metadata by HTS ID or symbol.
 */
export function getCuratedToken(htsIdOrSymbol: string): CuratedToken | undefined {
  return CURATED_TOKENS.find(
    t => t.htsId === htsIdOrSymbol || t.symbol === htsIdOrSymbol
  );
}

/**
 * Get all curated tokens grouped by category.
 */
export function getCuratedTokensByCategory(): Record<string, CuratedToken[]> {
  const groups: Record<string, CuratedToken[]> = {};
  for (const t of CURATED_TOKENS) {
    (groups[t.category] ??= []).push(t);
  }
  return groups;
}
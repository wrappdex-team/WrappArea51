/**
 * [C48] SaucerSwap Token Registry & Pure Helpers
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: AllowedToken type, token list, lookup helpers, conversion utilities.
 * Zero side effects — safe to import anywhere.
 */

import { log } from "../logger";

// ── Shared Types ────────────────────────────────────────────────────

export type HederaNetwork = "mainnet" | "testnet";

export const HBARH_TOKEN_ID = "0.0.9356476";

// ── Allowed Token Registry ──────────────────────────────────────────

export interface AllowedToken {
  symbol: string;
  name: string;
  htsId: string;
  evmAddress: string;
  decimals: number;
  logo: string;
  rank: number;
  isWrapped: boolean;
  bridge?: string;
  isNative?: boolean;
  /** SaucerSwap-listed HTS ID when different from htsId (for oracle price lookup) */
  saucerswapAliasId?: string;
}

// ── Address Converters ──────────────────────────────────────────────

export function htsIdToEvmAddress(htsId: string): string {
  const parts = htsId.split(".");
  const tokenNum = parseInt(parts[2], 10);
  return "0x" + tokenNum.toString(16).padStart(40, "0");
}

export function evmAddressToHtsId(evmAddr: string): string {
  const hex = evmAddr.replace("0x", "");
  const tokenNum = parseInt(hex, 16);
  return "0.0." + tokenNum;
}

// ── Token List ──────────────────────────────────────────────────────

export const SAUCERSWAP_TOKENS: AllowedToken[] = [
  {
    symbol: "HBAR", name: "HBAR", htsId: "native",
    evmAddress: "0x0000000000000000000000000000000000000000", decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/4642.png",
    rank: 0, isWrapped: false, isNative: true,
  },
  {
    symbol: "WHBAR", name: "Wrapped HBAR", htsId: "0.0.1456986",
    evmAddress: htsIdToEvmAddress("0.0.1456986"), decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/4642.png",
    rank: 1, isWrapped: false,
  },
  {
    symbol: "USDC", name: "USD Coin", htsId: "0.0.456858",
    evmAddress: htsIdToEvmAddress("0.0.456858"), decimals: 6,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png",
    rank: 2, isWrapped: false,
  },
  {
    // [C36-04] Changed from native USDT 0.0.4291336 (no SaucerSwap pools) to
    // HashPort USDT 0.0.1055472 (the USDT that SaucerSwap actually trades).
    // SaucerSwap.finance lists this as their primary USDT.
    symbol: "USDT", name: "Tether USD", htsId: "0.0.1055472",
    evmAddress: htsIdToEvmAddress("0.0.1055472"), decimals: 6,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/825.png",
    rank: 3, isWrapped: true, bridge: "HashPort",
  },
  {
    // [C82] RESTORED saucerswapAliasId — SaucerSwap V2 pools trade this ID,
    // not the canonical bridge ID. Without it, pool detection fails →
    // routes fall to V1 → V1 has no pair → CONTRACT_REVERT_EXECUTED.
    // [C85] Updated alias from 0.0.1969769 → 0.0.10104132 (SaucerSwap API
    // now lists this as the primary WBTC token; old alias was V2-era).
    symbol: "WBTC", name: "Wrapped Bitcoin", htsId: "0.0.1055483",
    evmAddress: htsIdToEvmAddress("0.0.1055483"), decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/3717.png",
    rank: 4, isWrapped: true, bridge: "HashPort",
    saucerswapAliasId: "0.0.10104132",
  },
  {
    // [C82] RESTORED saucerswapAliasId — same issue as WBTC above.
    // [C85] Updated alias from 0.0.1970030 → 0.0.10152778 (SaucerSwap API
    // now lists this as the primary LINK token; old alias was V2-era).
    symbol: "LINK", name: "Chainlink", htsId: "0.0.1055495",
    evmAddress: htsIdToEvmAddress("0.0.1055495"), decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/1975.png",
    rank: 5, isWrapped: true, bridge: "HashPort",
    saucerswapAliasId: "0.0.10152778",
  },
  {
    symbol: "SAUCE", name: "SaucerSwap", htsId: "0.0.731861",
    evmAddress: htsIdToEvmAddress("0.0.731861"), decimals: 6,
    logo: "https://www.saucerswap.finance/images/tokens/sauce.svg",
    rank: 6, isWrapped: false,
  },
  {
    symbol: "HBARX", name: "Stader HBAR", htsId: "0.0.834116",
    evmAddress: htsIdToEvmAddress("0.0.834116"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/hbarx.svg",
    rank: 7, isWrapped: false,
  },
  {
    symbol: "KARATE", name: "Karate Combat", htsId: "0.0.2283230",
    evmAddress: htsIdToEvmAddress("0.0.2283230"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/karate.svg",
    rank: 8, isWrapped: false,
  },
  {
    // [C85] Updated from 0.0.4589822 (old/deprecated) → 0.0.4794920 (current active
    // PACK token on SaucerSwap & Hedera mainnet). The old ID was never in any active
    // SaucerSwap pool — caused wallet token ID mismatch (Mirror Node returned the
    // real ID, our registry had the wrong one).
    symbol: "PACK", name: "HashPack", htsId: "0.0.4794920",
    evmAddress: htsIdToEvmAddress("0.0.4794920"), decimals: 6,
    logo: "https://www.saucerswap.finance/images/tokens/pack.svg",
    rank: 9, isWrapped: false,
  },
  {
    symbol: "DOVU", name: "DOVU", htsId: "0.0.3716059",
    evmAddress: htsIdToEvmAddress("0.0.3716059"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/dovu.svg",
    rank: 10, isWrapped: false,
  },
  {
    // [C85] Updated from 0.0.786931 → 0.0.968069 (reconciliation detected mismatch
    // with SaucerSwap API — the old ID was a deprecated HST token).
    symbol: "HST", name: "HSuite Token", htsId: "0.0.968069",
    evmAddress: htsIdToEvmAddress("0.0.968069"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/hst.svg",
    rank: 11, isWrapped: false,
  },
  {
    // [C36-04] WETH decimals: 18 is correct (verified via HashScan).
    // [C85] RESTORED saucerswapAliasId — same issue as WBTC/LINK above.
    // SaucerSwap V2 pools use 0.0.1969708, not the canonical bridge ID.
    symbol: "WETH", name: "Wrapped Ether", htsId: "0.0.541564",
    evmAddress: htsIdToEvmAddress("0.0.541564"), decimals: 18,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
    rank: 12, isWrapped: true, bridge: "HashPort",
    saucerswapAliasId: "0.0.1969708",
  },
  {
    symbol: "AAVE", name: "Aave", htsId: "0.0.1055498",
    evmAddress: htsIdToEvmAddress("0.0.1055498"), decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/7278.png",
    rank: 13, isWrapped: true, bridge: "HashPort",
  },
  {
    symbol: "DAI", name: "Dai Stablecoin", htsId: "0.0.1055477",
    evmAddress: htsIdToEvmAddress("0.0.1055477"), decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/4943.png",
    rank: 14, isWrapped: true, bridge: "HashPort",
  },
  {
    symbol: "HBAR.\u0127", name: "HBAR.\u0127 Protocol", htsId: HBARH_TOKEN_ID,
    evmAddress: htsIdToEvmAddress(HBARH_TOKEN_ID), decimals: 8,
    // [C36-04] SaucerSwap icon via HTS ID-based CDN path
    logo: `https://www.saucerswap.finance/images/tokens/${HBARH_TOKEN_ID}.svg`,
    rank: 15, isWrapped: false,
  },
  {
    symbol: "WPOL", name: "Wrapped POL (Polygon)", htsId: "0.0.3306241",
    evmAddress: htsIdToEvmAddress("0.0.3306241"), decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/3890.png",
    rank: 16, isWrapped: true, bridge: "HashPort",
  },
  // ── HashPort / LayerZero Bridge Stablecoins ──
  {
    symbol: "USDCh", name: "USDC (HashPort)", htsId: "0.0.1055459",
    evmAddress: htsIdToEvmAddress("0.0.1055459"), decimals: 6,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png",
    rank: 20, isWrapped: true, bridge: "HashPort",
  },
  // [C36-04] USDTh (0.0.1055472) removed — merged into USDT above.
  {
    symbol: "WBNB", name: "Wrapped BNB", htsId: "0.0.1157005",
    evmAddress: htsIdToEvmAddress("0.0.1157005"), decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/1839.png",
    rank: 22, isWrapped: true, bridge: "LayerZero",
  },
  {
    symbol: "WAVAX", name: "Wrapped AVAX", htsId: "0.0.1157020",
    evmAddress: htsIdToEvmAddress("0.0.1157020"), decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/5805.png",
    rank: 23, isWrapped: true, bridge: "LayerZero",
  },
  {
    symbol: "WMATIC", name: "Wrapped MATIC", htsId: "0.0.540318",
    evmAddress: htsIdToEvmAddress("0.0.540318"), decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/3890.png",
    rank: 24, isWrapped: true, bridge: "HashPort",
  },
];

export const TOKEN_BY_SYMBOL = new Map(SAUCERSWAP_TOKENS.map((t) => [t.symbol, t]));
export const TOKEN_BY_HTS_ID = new Map(SAUCERSWAP_TOKENS.map((t) => [t.htsId, t]));

// ── [C56] Dynamic Token Registry ─────────────────────────────────────
// Mutable map populated by fetchDynamicTokens(). Allows resolveToken()
// and the execution engine to work with 300+ SaucerSwap tokens beyond
// the hardcoded SAUCERSWAP_TOKENS list. Static entries always win.
const _dynamicTokenBySymbol = new Map<string, AllowedToken>();
const _dynamicTokenByHtsId = new Map<string, AllowedToken>();

/**
 * Register dynamically fetched tokens so resolveToken(), TOKEN_BY_HTS_ID
 * lookups, and the swap engine can find them. Static tokens take priority.
 */
export function registerDynamicTokens(tokens: AllowedToken[]): void {
  for (const t of tokens) {
    // Never overwrite static tokens
    if (!TOKEN_BY_SYMBOL.has(t.symbol)) {
      _dynamicTokenBySymbol.set(t.symbol, t);
    }
    if (!TOKEN_BY_HTS_ID.has(t.htsId)) {
      _dynamicTokenByHtsId.set(t.htsId, t);
    }
  }
  console.log(`[C56] Registered ${tokens.length} dynamic tokens (total dynamic: ${_dynamicTokenBySymbol.size})`);
}

/**
 * Look up any token (static or dynamic) by HTS ID.
 */
export function resolveTokenByHtsId(htsId: string): AllowedToken | undefined {
  return TOKEN_BY_HTS_ID.get(htsId) || _dynamicTokenByHtsId.get(htsId);
}

// ── Routing Helpers ─────────────────────────────────────────────────

/**
 * Get the HTS ID to use when calling SaucerSwap APIs / on-chain router.
 * For bridge tokens whose canonical HTS ID differs from the SaucerSwap-listed
 * pool token, returns the saucerswapAliasId. For all others, returns htsId.
 *
 * Use this for quote fetching and router path building -- NOT for token
 * association, balance checks, or approval transactions (those need the
 * real bridge token htsId the user actually holds).
 */
export function getSaucerswapRoutingId(token: AllowedToken): string {
  return token.saucerswapAliasId || token.htsId;
}

/**
 * Get the EVM address for SaucerSwap routing (uses alias if available).
 */
export function getSaucerswapRoutingEvmAddress(token: AllowedToken): string {
  const routingId = getSaucerswapRoutingId(token);
  return routingId === "native"
    ? "0x0000000000000000000000000000000000000000"
    : htsIdToEvmAddress(routingId);
}

export function resolveToken(symbol: string): AllowedToken | undefined {
  // Check exact match first -- critical for symbols with non-ASCII characters
  // like "HBAR.\u0127" where toUpperCase() produces "HBAR.\u0126" (wrong Map key).
  const exact = TOKEN_BY_SYMBOL.get(symbol);
  if (exact) return exact;

  // [C56] Check dynamic tokens (fetched from SaucerSwap API)
  const dynamic = _dynamicTokenBySymbol.get(symbol);
  if (dynamic) return dynamic;

  // HBAR (native) is its own token now -- not aliased to WHBAR
  const aliases: Record<string, string> = {
    ETH: "WETH", BTC: "WBTC", MATIC: "WMATIC", POL: "WPOL", POLY: "WPOL",
    BNB: "WBNB", AVAX: "WAVAX",
    // Legacy "h" suffixed symbols (removed from registry, kept for backward compat)
    WBTCH: "WBTC", WETHH: "WETH", LINKH: "LINK",
  };
  const upper = symbol.toUpperCase();
  const resolved = aliases[upper] || upper;
  return TOKEN_BY_SYMBOL.get(resolved)
    || _dynamicTokenBySymbol.get(resolved)
    || resolveTokenByHtsId(resolved);
}

/**
 * Check if a symbol represents native HBAR.
 */
export function isNativeHbar(symbol: string): boolean {
  return symbol.toUpperCase() === "HBAR";
}

/**
 * Check if a token pair is an HBAR <-> WHBAR wrap/unwrap operation.
 * These bypass pool routing and use wrapHbar()/unwrapHbar() directly.
 */
export function isHbarWhbarPair(symbolA: string, symbolB: string): boolean {
  const a = symbolA.toUpperCase();
  const b = symbolB.toUpperCase();
  return (a === "HBAR" && b === "WHBAR") || (a === "WHBAR" && b === "HBAR");
}

/**
 * Get the WHBAR AllowedToken. Used internally for routing native HBAR
 * through WHBAR pools and for building contract call paths.
 */
export function getWhbarToken(): AllowedToken {
  return TOKEN_BY_SYMBOL.get("WHBAR")!;
}

// ── [C66 / C79-01] Dynamic Icon Resolution from SaucerSwap API ──────
// Fetches official token icons from our server proxy (which proxies
// SaucerSwap /tokens endpoint with 5-min cache, no CORS issues).
// 
// Two-pronged approach:
//   1. Patches SAUCERSWAP_TOKENS[].logo in-place (for existing references)
//   2. Populates the global icon registry (for TokenIcon fallback chain)
//
// The icon registry allows TokenIcon to resolve icons even when the
// React state hasn't re-rendered (e.g., stale token references).
let _iconFetchDone = false;
export async function fetchAndApplyTokenIcons(): Promise<void> {
  if (_iconFetchDone) return;
  _iconFetchDone = true; // Only try once per session

  // Import lazily to avoid circular deps
  const { registerTokenIcons } = await import("../../components/TokenIcon");

  try {
    // [C79-01] Use our server proxy instead of direct SaucerSwap API.
    // Direct browser → api.saucerswap.finance often fails in iframes
    // due to CORS, CSP, or ad-blocker restrictions. Our Supabase edge
    // function proxies the same data with guaranteed CORS headers.
    const { ssProxy } = await import("./pools");
    const data = await ssProxy<{ tokens: Array<{ id: string; symbol: string; icon: string }> }>("/tokens", {});
    
    if (!data?.tokens || !Array.isArray(data.tokens)) {
      log.warn("TokenIcons", "Server proxy returned no token data — trying direct API fallback");
      await _fetchIconsDirect();
      return;
    }

    const iconByHtsId = new Map<string, string>();
    const registryEntries: Array<{ htsId: string; iconUrl: string }> = [];

    for (const t of data.tokens) {
      const id = t.id || "";
      const icon = t.icon || "";
      if (id && icon) {
        const fullUrl = icon.startsWith("http") ? icon : `https://www.saucerswap.finance${icon}`;
        iconByHtsId.set(id, fullUrl);
        registryEntries.push({ htsId: id, iconUrl: fullUrl });
      }
    }

    // 1. Patch static token logos in-place
    let updated = 0;
    for (const token of SAUCERSWAP_TOKENS) {
      if (token.htsId === "native") continue;
      const apiIcon = iconByHtsId.get(token.htsId);
      if (apiIcon) {
        token.logo = apiIcon;
        updated++;
      }
    }

    // 2. Populate icon registry for TokenIcon fallback chain
    const registered = registerTokenIcons(registryEntries);

    // 3. Also register HBAR native with a known-good icon
    const hbarIcon = "https://s2.coinmarketcap.com/static/img/coins/64x64/4642.png";
    registerTokenIcons([{ htsId: "native", iconUrl: hbarIcon }]);

    log.info("TokenIcons", `Patched ${updated} static logos, registered ${registered} in icon registry (${registryEntries.length} total from API)`);
  } catch (e: any) {
    log.warn("TokenIcons", `Server proxy icon fetch failed: ${e?.message || e} — trying direct API`);
    await _fetchIconsDirect();
  }
}

/** Direct API fallback — only used if our server proxy is down. */
async function _fetchIconsDirect(): Promise<void> {
  try {
    const { registerTokenIcons } = await import("../../components/TokenIcon");
    const res = await fetch("https://api.saucerswap.finance/tokens", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const data = await res.json();
    const tokens: any[] = Array.isArray(data) ? data : Object.values(data);
    const registryEntries: Array<{ htsId: string; iconUrl: string }> = [];

    for (const t of tokens) {
      const id = t.id || t.tokenId || "";
      const icon = t.icon || t.image || "";
      if (id && icon) {
        const fullUrl = icon.startsWith("http") ? icon : `https://www.saucerswap.finance${icon}`;
        registryEntries.push({ htsId: id, iconUrl: fullUrl });
        // Also patch in-place
        const token = SAUCERSWAP_TOKENS.find(tok => tok.htsId === id);
        if (token) token.logo = fullUrl;
      }
    }
    registerTokenIcons(registryEntries);
    log.info("TokenIcons", `Direct API fallback: registered ${registryEntries.length} icons`);
  } catch (e: any) {
    log.warn("TokenIcons", `Direct API also failed: ${e?.message || e}`);
  }
}

// ── [C56] Dynamic Token Discovery ───────────────────────────────────
// Fetches the full SaucerSwap token list (300+ tokens) from our server
// proxy (5-min cache). Merges with SAUCERSWAP_TOKENS — static entries
// always take priority. Returns AllowedToken[] compatible with the
// token selector.

/** Shape returned by server proxy /saucerswap/tokens */
export interface DynamicTokenInfo {
  id: string;        // HTS ID e.g. "0.0.731861"
  symbol: string;
  name: string;
  decimals: number;
  icon: string;      // Full URL
  priceUsd: number | null;
  dueDiligenceComplete: boolean;
  isFeeOnTransfer: boolean;
}

let _dynamicTokenCache: { tokens: AllowedToken[]; raw: DynamicTokenInfo[]; ts: number } | null = null;
const DYNAMIC_TOKEN_CACHE_TTL_MS = 300_000; // 5 minutes (matches server cache)

/**
 * [C56] Fetch full SaucerSwap token list, merge with static registry.
 *
 * Returns an array of AllowedToken compatible with all existing swap logic.
 * Static SAUCERSWAP_TOKENS entries always take priority (correct decimals,
 * bridge info, routing aliases). Dynamic tokens fill the "All" tab.
 *
 * Also returns raw DynamicTokenInfo[] for price display.
 */
export async function fetchDynamicTokens(): Promise<{
  allTokens: AllowedToken[];
  dynamicRaw: DynamicTokenInfo[];
}> {
  // Return cache if fresh
  if (_dynamicTokenCache && (Date.now() - _dynamicTokenCache.ts) < DYNAMIC_TOKEN_CACHE_TTL_MS) {
    return { allTokens: _dynamicTokenCache.tokens, dynamicRaw: _dynamicTokenCache.raw };
  }

  // Import ssProxy lazily to avoid circular deps
  const { ssProxy } = await import("./pools");

  try {
    const data = await ssProxy<{ tokens: DynamicTokenInfo[]; count: number }>("/tokens", {});
    if (!data || !Array.isArray(data.tokens) || data.tokens.length === 0) {
      log.warn("DynamicTokens", "Server returned empty token list — using static only");
      return { allTokens: [...SAUCERSWAP_TOKENS], dynamicRaw: [] };
    }

    const dynamicRaw = data.tokens;
    const staticHtsIds = new Set(SAUCERSWAP_TOKENS.map(t => t.htsId));
    const staticSymbols = new Set(SAUCERSWAP_TOKENS.map(t => t.symbol.toUpperCase()));

    // ── [C85] TOKEN ID RECONCILIATION ────────────────────────────────
    // Detect when the SaucerSwap API returns a token with the same symbol
    // as our static registry but a DIFFERENT HTS ID. This catches cases
    // where tokens migrate to new IDs (like PACK 0.0.4589822 → 0.0.4794920)
    // and prevents the UI from showing two different IDs in different places.
    //
    // When a mismatch is detected:
    //   1. Log a loud [RECONCILE] warning with both IDs
    //   2. Register the API's ID in dynamic lookup maps so wallet matching works
    //   3. Also register the API's ID in TOKEN_BY_HTS_ID for reverse lookups
    // ─────────────────────────────────────────────────────────────────
    const staticBySymbol = new Map(SAUCERSWAP_TOKENS.map(t => [t.symbol.toUpperCase(), t]));
    for (const dt of dynamicRaw) {
      const upperSym = dt.symbol.toUpperCase();
      const staticEntry = staticBySymbol.get(upperSym);
      if (staticEntry && staticEntry.htsId !== "native" && staticEntry.htsId !== dt.id) {
        // Check if this is already a known alias
        if (staticEntry.saucerswapAliasId === dt.id) continue;

        console.warn(
          `[RECONCILE] Token ID mismatch for ${dt.symbol}: ` +
          `static registry has ${staticEntry.htsId}, ` +
          `SaucerSwap API returns ${dt.id}. ` +
          `The static registry should be updated to match the API. ` +
          `Registering API ID ${dt.id} as additional lookup key.`
        );

        // Register the API's ID so wallet token matching works
        // (wallet has the real on-chain ID from Mirror Node)
        if (!TOKEN_BY_HTS_ID.has(dt.id)) {
          TOKEN_BY_HTS_ID.set(dt.id, staticEntry);
        }
        if (!_dynamicTokenByHtsId.has(dt.id)) {
          _dynamicTokenByHtsId.set(dt.id, staticEntry);
        }
      }
    }

    // Convert dynamic tokens to AllowedToken, excluding those already in static list
    const dynamicConverted: AllowedToken[] = dynamicRaw
      .filter(dt => !staticHtsIds.has(dt.id) && !staticSymbols.has(dt.symbol.toUpperCase()))
      .map((dt, idx) => ({
        symbol: dt.symbol,
        name: dt.name,
        htsId: dt.id,
        evmAddress: htsIdToEvmAddress(dt.id),
        decimals: dt.decimals,
        logo: dt.icon || `https://www.saucerswap.finance/images/tokens/${dt.id}.svg`,
        rank: 1000 + idx, // After all static tokens
        isWrapped: false,
        isNative: false,
      }));

    // Merge: static first, then dynamic (sorted by rank)
    const merged = [...SAUCERSWAP_TOKENS, ...dynamicConverted];

    // [C56] Register in dynamic lookup maps so resolveToken() and swap engine find them
    registerDynamicTokens(dynamicConverted);

    // [C79-01] Register ALL dynamic token icons in the icon registry.
    // This ensures TokenIcon's fallback chain can resolve icons for
    // any of the 300+ SaucerSwap tokens, not just the static list.
    try {
      const { registerTokenIcons } = await import("../../components/TokenIcon");
      const iconEntries = dynamicRaw
        .filter(dt => dt.id && dt.icon)
        .map(dt => ({
          htsId: dt.id,
          iconUrl: dt.icon.startsWith("http") ? dt.icon : `https://www.saucerswap.finance${dt.icon}`,
        }));
      registerTokenIcons(iconEntries);
    } catch { /* non-critical */ }

    _dynamicTokenCache = { tokens: merged, raw: dynamicRaw, ts: Date.now() };
    log.info("DynamicTokens", `Merged ${SAUCERSWAP_TOKENS.length} static + ${dynamicConverted.length} dynamic = ${merged.length} total`);
    return { allTokens: merged, dynamicRaw };
  } catch (err: any) {
    log.warn("DynamicTokens", `Fetch failed: ${err?.message || err}`);
    return { allTokens: [...SAUCERSWAP_TOKENS], dynamicRaw: [] };
  }
}
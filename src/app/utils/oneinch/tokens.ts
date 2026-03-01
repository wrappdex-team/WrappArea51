/**
 * 1inch DEX Aggregator — Token Management
 *
 * Handles the full lifecycle of token data for the swap UI:
 *   1. Curated popular tokens per chain (instant display, no API call)
 *   2. Dynamic full token list from the 1inch Swap API (thousands of tokens)
 *   3. Token search (symbol, name, or contract address)
 *   4. Custom token import by pasting a contract address
 *   5. User favorites (persisted to localStorage)
 *   6. Recently used tokens (persisted to localStorage)
 *   7. Token balance enrichment via the Balance API
 *   8. USD price enrichment via the Price API
 *
 * IMPLEMENTATION NOTE: Token data flows through a three-layer pipeline:
 *
 *   Layer 1: Popular tokens (hardcoded) — available instantly on mount.
 *   Layer 2: Full API token list — fetched once per chain, cached 1 hour.
 *   Layer 3: Enrichment (balances + prices) — fetched per-wallet, cached 30s.
 *
 * The UI should render Layer 1 immediately, then merge Layer 2 when it
 * arrives, then overlay Layer 3 enrichment asynchronously.
 *
 * @module oneinch/tokens
 */

import { log } from "../logger";
import { oneInchApi } from "./api-client";
import type {
  TokenInfo,
  EnrichedToken,
  RecentToken,
  FavoriteToken,
  RawTokenFromAPI,
  TokenListResponse,
  BalanceResponse,
  PriceResponse,
  PriceImpactSeverity,
} from "./types";
import { NATIVE_TOKEN_ADDRESS } from "./types";
import { cacheGet, cacheSet, CacheTTL, cacheInvalidatePrefix } from "./token-cache";

/* ======================================================================
 * Constants
 * ====================================================================== */

const TAG = "1inch:tokens";
const LS_FAVORITES_KEY = "wrappdex:1inch:favorites";
const LS_RECENTS_KEY = "wrappdex:1inch:recents";
const LS_CUSTOM_KEY = "wrappdex:1inch:custom-tokens";
const MAX_RECENTS = 20;
const MAX_CUSTOM_TOKENS = 50;

/* ======================================================================
 * Popular Tokens — Curated per Chain
 *
 * IMPLEMENTATION NOTE: These are the Layer 1 tokens, displayed instantly
 * without any API call. They include the native gas token + top stablecoins
 * and DeFi blue chips for each chain. All logoURIs point to the official
 * 1inch token icon CDN.
 * ====================================================================== */

export const POPULAR_TOKENS: Readonly<Record<number, readonly TokenInfo[]>> = Object.freeze({
  1: Object.freeze([
    { address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png", isNative: true },
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png", isNative: false },
    { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png", isNative: false },
    { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", name: "Dai", decimals: 18, logoURI: "https://tokens.1inch.io/0x6b175474e89094c44da98b954eedeac495271d0f.png", isNative: false },
    { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, logoURI: "https://tokens.1inch.io/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.png", isNative: false },
    { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png", isNative: false },
    { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", symbol: "LINK", name: "Chainlink", decimals: 18, logoURI: "https://tokens.1inch.io/0x514910771af9ca656af840dff83e8264ecf986ca.png", isNative: false },
    { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", symbol: "UNI", name: "Uniswap", decimals: 18, logoURI: "https://tokens.1inch.io/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984.png", isNative: false },
    { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", symbol: "AAVE", name: "Aave", decimals: 18, logoURI: "https://tokens.1inch.io/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9.png", isNative: false },
  ] as TokenInfo[]),
  137: Object.freeze([
    { address: NATIVE_TOKEN_ADDRESS, symbol: "POL", name: "POL", decimals: 18, logoURI: "https://tokens.1inch.io/0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0.png", isNative: true },
    { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png", isNative: false },
    { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png", isNative: false },
    { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", symbol: "WETH", name: "Wrapped Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png", isNative: false },
    { address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, logoURI: "https://tokens.1inch.io/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.png", isNative: false },
  ] as TokenInfo[]),
  56: Object.freeze([
    { address: NATIVE_TOKEN_ADDRESS, symbol: "BNB", name: "BNB", decimals: 18, logoURI: "https://tokens.1inch.io/0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c.png", isNative: true },
    { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", name: "USD Coin", decimals: 18, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png", isNative: false },
    { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "Tether USD", decimals: 18, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png", isNative: false },
    { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", symbol: "ETH", name: "Ethereum", decimals: 18, logoURI: "https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png", isNative: false },
  ] as TokenInfo[]),
  42161: Object.freeze([
    { address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png", isNative: true },
    { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png", isNative: false },
    { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png", isNative: false },
    { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, logoURI: "https://tokens.1inch.io/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.png", isNative: false },
    { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", symbol: "ARB", name: "Arbitrum", decimals: 18, logoURI: "https://tokens.1inch.io/0x912ce59144191c1204e64559fe8253a0e49e6548.png", isNative: false },
  ] as TokenInfo[]),
  10: Object.freeze([
    { address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png", isNative: true },
    { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png", isNative: false },
    { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png", isNative: false },
    { address: "0x4200000000000000000000000000000000000042", symbol: "OP", name: "Optimism", decimals: 18, logoURI: "https://tokens.1inch.io/0x4200000000000000000000000000000000000042_1.png", isNative: false },
  ] as TokenInfo[]),
  8453: Object.freeze([
    { address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png", isNative: true },
    { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png", isNative: false },
    { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI", name: "Dai", decimals: 18, logoURI: "https://tokens.1inch.io/0x6b175474e89094c44da98b954eedeac495271d0f.png", isNative: false },
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png", isNative: false },
  ] as TokenInfo[]),
  43114: Object.freeze([
    { address: NATIVE_TOKEN_ADDRESS, symbol: "AVAX", name: "Avalanche", decimals: 18, logoURI: "https://tokens.1inch.io/0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7.png", isNative: true },
    { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png", isNative: false },
    { address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png", isNative: false },
  ] as TokenInfo[]),
  100: Object.freeze([
    { address: NATIVE_TOKEN_ADDRESS, symbol: "xDAI", name: "xDAI", decimals: 18, logoURI: "https://tokens.1inch.io/0x6b175474e89094c44da98b954eedeac495271d0f.png", isNative: true },
    { address: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png", isNative: false },
  ] as TokenInfo[]),
});

/* ======================================================================
 * Token Normalisation
 * ====================================================================== */

/**
 * Convert a raw API token to the canonical TokenInfo shape.
 * Handles missing/null logoURI gracefully.
 */
export function normaliseToken(raw: RawTokenFromAPI): TokenInfo {
  return {
    address: raw.address,
    symbol: raw.symbol,
    name: raw.name,
    decimals: raw.decimals,
    logoURI: raw.logoURI || null,
    isNative: raw.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase(),
    tags: raw.tags,
    isVerified: raw.isVerified,
  };
}

/* ======================================================================
 * Token List Fetching
 * ====================================================================== */

/**
 * Fetch the full token list for a chain from the 1inch Swap API.
 * Results are cached for 1 hour in the dual-layer cache.
 *
 * @param chainId   EVM chain ID
 * @param signal    Optional AbortSignal for cleanup
 * @returns         Array of TokenInfo, sorted alphabetically by symbol
 */
export async function fetchTokenList(
  chainId: number,
  signal?: AbortSignal,
): Promise<TokenInfo[]> {
  const cacheKey = `tokenlist:${chainId}`;

  // Check dual-layer cache
  const cached = cacheGet<TokenInfo[]>(cacheKey);
  if (cached) {
    log.debug(TAG, `Token list cache hit: chain=${chainId}, count=${cached.length}`);
    return cached;
  }

  log.debug(TAG, `Fetching token list: chain=${chainId}`);

  const data = await oneInchApi.get<TokenListResponse>(
    `/tokens/${chainId}`,
    { signal, cacheKey: `api:tokens:${chainId}`, cacheTtlMs: CacheTTL.TOKEN_LIST },
  );

  if (!data?.tokens) {
    log.warn(TAG, `Empty token list response for chain ${chainId}`);
    return [];
  }

  const tokens: TokenInfo[] = Object.values(data.tokens)
    .map(normaliseToken)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  // Persist to dual-layer cache
  cacheSet(cacheKey, tokens, CacheTTL.TOKEN_LIST);

  log.debug(TAG, `Token list fetched: chain=${chainId}, count=${tokens.length}`);
  return tokens;
}

/**
 * Merge popular tokens with the full API list, deduplicating by address.
 * Popular tokens appear first (in their curated order), then API tokens
 * sorted alphabetically. Custom tokens are injected after popular tokens.
 */
export function mergeTokenLists(
  chainId: number,
  apiTokens: TokenInfo[],
  customTokens?: TokenInfo[],
): TokenInfo[] {
  const popular = POPULAR_TOKENS[chainId] || [];
  const seenAddrs = new Set<string>();

  const result: TokenInfo[] = [];

  // Popular tokens first (curated order)
  for (const t of popular) {
    const key = t.address.toLowerCase();
    if (!seenAddrs.has(key)) {
      seenAddrs.add(key);
      result.push(t);
    }
  }

  // Custom tokens next
  if (customTokens) {
    for (const t of customTokens) {
      const key = t.address.toLowerCase();
      if (!seenAddrs.has(key)) {
        seenAddrs.add(key);
        result.push(t);
      }
    }
  }

  // API tokens (alphabetical, already sorted)
  for (const t of apiTokens) {
    const key = t.address.toLowerCase();
    if (!seenAddrs.has(key)) {
      seenAddrs.add(key);
      // Preserve popular token data if available (better logos)
      result.push(t);
    }
  }

  return result;
}

/* ======================================================================
 * Token Search
 * ====================================================================== */

/**
 * Search tokens — local-first with API fallback.
 *
 * For short queries (< 3 chars), searches only the local merged list.
 * For longer queries, hits the Token Search API for broader results.
 * Address searches (0x...) use the custom token endpoint.
 *
 * @param query       Search string (symbol, name, or address)
 * @param chainId     EVM chain ID
 * @param allTokens   Pre-fetched merged token list (for local search)
 * @param signal      Optional AbortSignal
 * @returns           Matching tokens (max 50)
 */
export async function searchTokens(
  query: string,
  chainId: number,
  allTokens: TokenInfo[],
  signal?: AbortSignal,
): Promise<TokenInfo[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const isAddressSearch = q.startsWith("0x") && q.length > 6;

  // Always do local search first
  const localResults = allTokens.filter((t) => {
    if (isAddressSearch) return t.address.toLowerCase().includes(q);
    return (
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q)
    );
  });

  // For short queries or if local results are plentiful, return local only
  if (q.length < 3 || (localResults.length >= 20 && !isAddressSearch)) {
    return localResults.slice(0, 50);
  }

  // For address searches, try the custom token endpoint
  if (isAddressSearch && q.length === 42) {
    const cacheKey = `custom:${chainId}:${q}`;
    const cached = cacheGet<TokenInfo | null>(cacheKey);
    if (cached !== null) return cached ? [cached, ...localResults].slice(0, 50) : localResults.slice(0, 50);

    try {
      const data = await oneInchApi.get<Record<string, unknown>>(
        `/token/custom/${chainId}?address=${q}`,
        { signal, retries: 1, timeout: 8_000 },
      );

      // The API returns { "0xaddr": { symbol, name, ... } }
      const values = Object.values(data || {});
      if (values.length > 0 && typeof values[0] === "object" && values[0] !== null) {
        const raw = values[0] as RawTokenFromAPI;
        const token = normaliseToken(raw);
        cacheSet(cacheKey, token, CacheTTL.SEARCH);
        // Prepend the custom token to results
        const combined = [token, ...localResults.filter(
          (t) => t.address.toLowerCase() !== token.address.toLowerCase(),
        )];
        return combined.slice(0, 50);
      } else {
        cacheSet(cacheKey, null, CacheTTL.SEARCH);
      }
    } catch {
      // Custom token lookup failed — fall through to local results
    }

    return localResults.slice(0, 50);
  }

  // For text searches, try the Token Search API
  const searchCacheKey = `search:${chainId}:${q}`;
  const cachedSearch = cacheGet<TokenInfo[]>(searchCacheKey);
  if (cachedSearch) {
    // Merge API search results with local results, deduped
    const seenAddrs = new Set(cachedSearch.map((t) => t.address.toLowerCase()));
    const extra = localResults.filter((t) => !seenAddrs.has(t.address.toLowerCase()));
    return [...cachedSearch, ...extra].slice(0, 50);
  }

  try {
    const data = await oneInchApi.get<TokenInfo[]>(
      `/token/search/${chainId}?query=${encodeURIComponent(q)}`,
      { signal, retries: 1, timeout: 8_000 },
    );

    if (Array.isArray(data) && data.length > 0) {
      const apiResults = data.map((t: any) => normaliseToken(t));
      cacheSet(searchCacheKey, apiResults, CacheTTL.SEARCH);

      // Merge with local results
      const seenAddrs = new Set(apiResults.map((t) => t.address.toLowerCase()));
      const extra = localResults.filter((t) => !seenAddrs.has(t.address.toLowerCase()));
      return [...apiResults, ...extra].slice(0, 50);
    }
  } catch {
    // API search failed — return local results
    log.debug(TAG, `API search failed for "${q}" on chain ${chainId}, using local results`);
  }

  return localResults.slice(0, 50);
}

/* ======================================================================
 * Default Token Pair
 * ====================================================================== */

/**
 * Get the default from/to token pair for a chain.
 * Typically native gas token → USDC.
 */
export function getDefaultPair(chainId: number): [TokenInfo, TokenInfo] {
  const popular = POPULAR_TOKENS[chainId] || POPULAR_TOKENS[1];
  return [popular[0], popular[1] || popular[0]];
}

/* ======================================================================
 * Favorites — Persisted to localStorage
 * ====================================================================== */

let _favorites: FavoriteToken[] | null = null;

/**
 * Load favorites from localStorage.
 * Returns a mutable copy — mutations won't affect the stored data.
 */
export function loadFavorites(): FavoriteToken[] {
  if (_favorites !== null) return [..._favorites];
  try {
    const raw = localStorage.getItem(LS_FAVORITES_KEY);
    _favorites = raw ? JSON.parse(raw) : [];
  } catch {
    _favorites = [];
  }
  return [..._favorites!];
}

function _saveFavorites(favs: FavoriteToken[]): void {
  _favorites = favs;
  try {
    localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify(favs));
  } catch {
    log.warn(TAG, "Failed to save favorites to localStorage");
  }
}

/** Check if a token is in favorites for a specific chain */
export function isFavorite(chainId: number, address: string): boolean {
  const favs = loadFavorites();
  const lowerAddr = address.toLowerCase();
  return favs.some((f) => f.chainId === chainId && f.address.toLowerCase() === lowerAddr);
}

/**
 * Toggle a token in/out of favorites.
 * Returns the new favorite state (true = added, false = removed).
 */
export function toggleFavorite(chainId: number, address: string): boolean {
  const favs = loadFavorites();
  const lowerAddr = address.toLowerCase();
  const idx = favs.findIndex(
    (f) => f.chainId === chainId && f.address.toLowerCase() === lowerAddr,
  );

  if (idx >= 0) {
    favs.splice(idx, 1);
    _saveFavorites(favs);
    return false;
  } else {
    favs.push({ chainId, address });
    _saveFavorites(favs);
    return true;
  }
}

/**
 * Get favorite tokens for a chain, resolved against a token list.
 * Returns TokenInfo[] in the order they were favorited.
 */
export function getFavoriteTokens(
  chainId: number,
  allTokens: TokenInfo[],
): TokenInfo[] {
  const favs = loadFavorites().filter((f) => f.chainId === chainId);
  if (favs.length === 0) return [];

  const tokenMap = new Map<string, TokenInfo>(
    allTokens.map((t) => [t.address.toLowerCase(), t]),
  );

  return favs
    .map((f) => tokenMap.get(f.address.toLowerCase()))
    .filter((t): t is TokenInfo => t !== undefined);
}

/* ======================================================================
 * Recent Tokens — Persisted to localStorage
 * ====================================================================== */

let _recents: RecentToken[] | null = null;

export function loadRecents(): RecentToken[] {
  if (_recents !== null) return [..._recents];
  try {
    const raw = localStorage.getItem(LS_RECENTS_KEY);
    _recents = raw ? JSON.parse(raw) : [];
  } catch {
    _recents = [];
  }
  return [..._recents!];
}

function _saveRecents(recents: RecentToken[]): void {
  _recents = recents;
  try {
    localStorage.setItem(LS_RECENTS_KEY, JSON.stringify(recents));
  } catch {
    log.warn(TAG, "Failed to save recents to localStorage");
  }
}

/**
 * Record a token as recently used. Moves it to the front if already present.
 */
export function recordRecentToken(chainId: number, address: string, symbol: string): void {
  const recents = loadRecents();
  const lowerAddr = address.toLowerCase();

  // Remove existing entry if present
  const filtered = recents.filter(
    (r) => !(r.chainId === chainId && r.address.toLowerCase() === lowerAddr),
  );

  // Add to front
  filtered.unshift({ chainId, address, symbol, lastUsed: Date.now() });

  // Cap at MAX_RECENTS
  _saveRecents(filtered.slice(0, MAX_RECENTS));
}

/**
 * Get recent tokens for a chain, resolved against a token list.
 * Returns TokenInfo[] in most-recently-used order.
 */
export function getRecentTokens(
  chainId: number,
  allTokens: TokenInfo[],
  limit = 8,
): TokenInfo[] {
  const recents = loadRecents()
    .filter((r) => r.chainId === chainId)
    .slice(0, limit);

  if (recents.length === 0) return [];

  const tokenMap = new Map<string, TokenInfo>(
    allTokens.map((t) => [t.address.toLowerCase(), t]),
  );

  return recents
    .map((r) => tokenMap.get(r.address.toLowerCase()))
    .filter((t): t is TokenInfo => t !== undefined);
}

/* ======================================================================
 * Custom Tokens — User-imported by Contract Address
 * ====================================================================== */

let _customTokens: Record<number, TokenInfo[]> | null = null;

export function loadCustomTokens(): Record<number, TokenInfo[]> {
  if (_customTokens !== null) return _customTokens;
  try {
    const raw = localStorage.getItem(LS_CUSTOM_KEY);
    _customTokens = raw ? JSON.parse(raw) : {};
  } catch {
    _customTokens = {};
  }
  return _customTokens!;
}

function _saveCustomTokens(data: Record<number, TokenInfo[]>): void {
  _customTokens = data;
  try {
    localStorage.setItem(LS_CUSTOM_KEY, JSON.stringify(data));
  } catch {
    log.warn(TAG, "Failed to save custom tokens to localStorage");
  }
}

/**
 * Save a custom-imported token for a chain.
 * Deduplicates by address.
 */
export function saveCustomToken(chainId: number, token: TokenInfo): void {
  const data = loadCustomTokens();
  const chain = data[chainId] || [];
  const lowerAddr = token.address.toLowerCase();

  if (chain.some((t) => t.address.toLowerCase() === lowerAddr)) return;

  chain.push(token);
  if (chain.length > MAX_CUSTOM_TOKENS) chain.shift();
  data[chainId] = chain;
  _saveCustomTokens(data);
}

/** Remove a custom token */
export function removeCustomToken(chainId: number, address: string): void {
  const data = loadCustomTokens();
  const chain = data[chainId] || [];
  const lowerAddr = address.toLowerCase();
  data[chainId] = chain.filter((t) => t.address.toLowerCase() !== lowerAddr);
  _saveCustomTokens(data);
}

/* ======================================================================
 * Balance & Price Enrichment
 * ====================================================================== */

/**
 * Fetch token balances for a wallet on a chain.
 * Returns a map of lowercase address → raw balance in smallest unit.
 *
 * IMPLEMENTATION NOTE: Balances are cached L1-only (30s TTL) to avoid
 * stale localStorage balance display after external transfers.
 */
export async function fetchBalances(
  chainId: number,
  wallet: string,
  signal?: AbortSignal,
): Promise<BalanceResponse> {
  const cacheKey = `bal:${chainId}:${wallet.toLowerCase()}`;
  const cached = cacheGet<BalanceResponse>(cacheKey);
  if (cached) return cached;

  try {
    const data = await oneInchApi.get<BalanceResponse>(
      `/balance/${chainId}/${wallet}`,
      { signal, retries: 1, timeout: 10_000 },
    );
    cacheSet(cacheKey, data, CacheTTL.BALANCES, true); // L1 only
    return data;
  } catch (err) {
    log.warn(TAG, `Balance fetch failed: chain=${chainId} wallet=${wallet}`, err);
    return {};
  }
}

/**
 * Fetch USD prices for tokens on a chain.
 * Returns a map of lowercase address → USD price string.
 */
export async function fetchPrices(
  chainId: number,
  tokenAddresses?: string[],
  signal?: AbortSignal,
): Promise<PriceResponse> {
  const addrStr = tokenAddresses?.join(",") || "__all__";
  const cacheKey = `price:${chainId}:${addrStr}`;
  const cached = cacheGet<PriceResponse>(cacheKey);
  if (cached) return cached;

  try {
    let path = `/price/${chainId}`;
    const qsParams: string[] = [];
    // IMPLEMENTATION NOTE: The 1inch Price API v1.1 returns prices in
    // native-token wei by default. We MUST request currency=USD to get
    // actual USD prices. Without this, prices are in wei denomination,
    // producing astronomically large "USD" values (e.g., 1e18 for ETH).
    qsParams.push("currency=USD");
    if (tokenAddresses && tokenAddresses.length > 0) {
      qsParams.push(`tokens=${tokenAddresses.join(",")}`);
    }
    if (qsParams.length > 0) {
      path += `?${qsParams.join("&")}`;
    }

    const data = await oneInchApi.get<PriceResponse>(
      path,
      { signal, retries: 1, timeout: 10_000 },
    );
    cacheSet(cacheKey, data, CacheTTL.PRICES);
    return data;
  } catch (err) {
    log.warn(TAG, `Price fetch failed: chain=${chainId}`, err);
    return {};
  }
}

/**
 * Enrich a list of tokens with balance and price data.
 * Non-blocking — returns whatever data is available.
 *
 * @param tokens   Base token list
 * @param chainId  EVM chain ID
 * @param wallet   Wallet address (null if not connected)
 * @param signal   Optional AbortSignal
 * @returns        EnrichedToken[] with balances and prices attached
 */
export async function enrichTokens(
  tokens: TokenInfo[],
  chainId: number,
  wallet: string | null,
  signal?: AbortSignal,
): Promise<EnrichedToken[]> {
  // Fetch balances + prices in parallel
  const [balances, prices] = await Promise.all([
    wallet ? fetchBalances(chainId, wallet, signal) : Promise.resolve({} as BalanceResponse),
    fetchPrices(
      chainId,
      tokens.slice(0, 100).map((t) => t.address), // Limit to first 100 for price query
      signal,
    ),
  ]);

  return tokens.map((t) => {
    const addrLower = t.address.toLowerCase();
    const rawBalance = balances[addrLower] || null;
    const priceStr = prices[addrLower] || null;
    const priceUsd = priceStr ? parseFloat(priceStr) : null;

    let formattedBalance: string | null = null;
    let balanceUsd: number | null = null;

    if (rawBalance && rawBalance !== "0") {
      formattedBalance = formatBalance(rawBalance, t.decimals);
      if (priceUsd !== null && priceUsd > 0) {
        const balNum = parseFloat(formattedBalance.replace(/,/g, ""));
        balanceUsd = balNum * priceUsd;
      }
    }

    return {
      ...t,
      balance: rawBalance,
      priceUsd,
      formattedBalance,
      balanceUsd,
    } as EnrichedToken;
  });
}

/* ======================================================================
 * Formatting Utilities
 * ====================================================================== */

/**
 * Format a raw balance (smallest unit) to human-readable string.
 * Handles arbitrary precision without floating-point errors.
 */
export function formatBalance(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const str = raw.padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals);
  const trimmed = frac.replace(/0+$/, "");
  const display = trimmed ? `${whole}.${trimmed.slice(0, 8)}` : whole;
  return parseFloat(display).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

/**
 * Convert a human-readable amount to smallest unit (wei, etc.).
 * Handles decimal amounts without floating-point errors.
 */
export function toSmallestUnit(amount: string, decimals: number): string {
  if (!amount || parseFloat(amount) === 0) return "0";
  const [whole = "0", frac = ""] = amount.split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  const raw = whole + paddedFrac;
  return raw.replace(/^0+/, "") || "0";
}

/**
 * Format a USD value for display.
 * Shows $ prefix and appropriate precision.
 */
export function formatUsd(value: number | null): string {
  if (value === null || isNaN(value)) return "";
  if (value === 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  if (value < 1) return `$${value.toFixed(4)}`;
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ======================================================================
 * Price Impact
 * ====================================================================== */

/**
 * Calculate price impact as a percentage.
 * Compares the quoted output to the expected output at market price.
 *
 * @param inputAmount    Amount in human-readable units
 * @param outputAmount   Quote output in human-readable units
 * @param inputPriceUsd  USD price per input token
 * @param outputPriceUsd USD price per output token
 * @returns              Price impact as a positive percentage (e.g., 1.5 = 1.5%)
 */
export function calcPriceImpact(
  inputAmount: number,
  outputAmount: number,
  inputPriceUsd: number,
  outputPriceUsd: number,
): number {
  if (!inputPriceUsd || !outputPriceUsd || !inputAmount || !outputAmount) return 0;
  const expectedOutput = (inputAmount * inputPriceUsd) / outputPriceUsd;
  if (expectedOutput === 0) return 0;
  const impact = ((expectedOutput - outputAmount) / expectedOutput) * 100;
  return Math.max(0, impact); // Never negative
}

/**
 * Classify price impact severity for UI warning display.
 */
export function priceImpactSeverity(impact: number): PriceImpactSeverity {
  if (impact < 0.5) return "none";
  if (impact < 2) return "low";
  if (impact < 5) return "medium";
  if (impact < 15) return "high";
  return "extreme";
}
/**
 * [C48] SaucerSwap Price Fetching & Estimation
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: Fallback/live price caches, TOKEN_PRICES_USD Proxy,
 * all price fetch strategies, LP token pricing, and the price-based
 * swap output estimator.
 *
 * Also hosts the shared `saucerFetch` and `makeAbort` helpers that
 * are used by both this module and the remaining monolith code.
 */

import { log } from "../logger";
import type { AllowedToken } from "./tokens";
import { TOKEN_BY_HTS_ID, HBARH_TOKEN_ID, resolveTokenByHtsId } from "./tokens";
import { isTokenBlocked } from "./scam-blocklist";
import { projectId, publicAnonKey } from "../../../../utils/supabase/info";

// ── Shared Constants ────────────────────────────────────────────────

export const SAUCERSWAP_API = "https://api.saucerswap.finance";

// ── Server Proxy Base URL ───────────────────────────────────────────
// [C108] All SaucerSwap API requests are now routed through the server
// proxy to keep the partner API key server-side. The proxy attaches
// SAUCERSWAP_API_KEY and provides caching + circuit breaking.
const SS_PROXY_URL = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/ss-proxy`;

// ┌─────────────────────────────────────────────────────────────────────┐
// │  [C108] SAUCERSWAP PARTNER API KEY — MOVED SERVER-SIDE             │
// │                                                                    │
// │  The partner API key is now stored exclusively as the              │
// │  SAUCERSWAP_API_KEY Supabase Edge Function secret and attached    │
// │  by the /ss-proxy endpoint. This prevents client-side abuse of    │
// │  rate limits.                                                      │
// │                                                                    │
// │  SAUCERSWAP_PARTNER_ID is kept as an empty string for backward    │
// │  compatibility — any code checking `if (SAUCERSWAP_PARTNER_ID)`   │
// │  will safely skip the (now-unnecessary) header attachment.         │
// │                                                                    │
// │  Status: SERVER-SIDE ONLY                                          │
// └─────────────────────────────────────────────────────────────────────┘
export const SAUCERSWAP_PARTNER_ID: string = "";

// ── Shared Helpers ──────────────────────────────────────────────────

export function makeAbort(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

// ── Resilient SaucerSwap API helper ────────────────────────────────
// Tries all known URL variants and returns the first successful response.

const _apiDiagLogged = new Set<string>(); // avoid console spam

export async function saucerFetch(
  path: string,
  timeoutMs: number = 10000,
): Promise<Response | null> {
  // Try prefix variants for the given path. If the path already starts
  // with a version prefix (/v1/ or /v2/), skip adding more prefixes --
  // avoids nonsensical double-prefixed URLs like /v1/v2/pools.
  const hasVersionPrefix = /^\/v[12]\//.test(path);
  const variants = hasVersionPrefix
    ? [path]          // Already versioned -- use as-is
    : [
        path,             // versionless (e.g. /tokens)
        "/v1" + path,     // V1 prefix   (e.g. /v1/tokens)
        "/v2" + path,     // V2 prefix   (e.g. /v2/tokens)
      ];

  // [C108] Route through server proxy — API key is attached server-side.
  // Try proxy first, fall back to direct SaucerSwap API if proxy is unreachable.
  for (const variant of variants) {
    // Strategy 1: Server proxy (preferred — has API key)
    try {
      const proxyUrl = `${SS_PROXY_URL}?path=${encodeURIComponent(variant)}`;
      const res = await fetch(proxyUrl, {
        headers: {
          Authorization: `Bearer ${publicAnonKey}`,
          Accept: "application/json",
        },
        signal: makeAbort(timeoutMs),
      });
      if (res.ok) {
        if (_apiDiagLogged.has(path)) {
          log.info("SaucerSwap", `${variant} recovered (via proxy)`);
        }
        return res;
      }
      // 400/403 from proxy = path not allowed, don't try direct
      if (res.status === 400 || res.status === 403) continue;
      if (!_apiDiagLogged.has(path)) {
        log.info("SaucerSwap", `${variant} proxy -> HTTP ${res.status}, trying next...`);
      }
    } catch {
      // Proxy unreachable — try direct as fallback (without API key)
      if (!_apiDiagLogged.has(path)) {
        log.info("SaucerSwap", `${variant} proxy -> network error, trying direct...`);
      }
    }

    // Strategy 2: Direct SaucerSwap API fallback (no API key — public rate limits)
    try {
      const res = await fetch(SAUCERSWAP_API + variant, {
        headers: { Accept: "application/json" },
        signal: makeAbort(timeoutMs),
      });
      if (res.ok) {
        if (_apiDiagLogged.has(path)) {
          log.info("SaucerSwap", `${variant} recovered (direct, no API key)`);
        }
        return res;
      }
      if (!_apiDiagLogged.has(path)) {
        log.info("SaucerSwap", `${variant} direct -> HTTP ${res.status}, trying next variant...`);
      }
    } catch {
      if (!_apiDiagLogged.has(path)) {
        log.info("SaucerSwap", `${variant} direct -> network error, trying next variant...`);
      }
    }
  }

  // All variants exhausted
  if (!_apiDiagLogged.has(path)) {
    log.info("SaucerSwap", `${path}: all URL variants failed -- using fallback data`);
    _apiDiagLogged.add(path);
  }
  return null;
}

// ── Fallback & Live Price Caches ────────────────────────────────────

// Hardcoded fallback prices -- used when live prices are unavailable.
// IMPORTANT: HBAR/WHBAR MUST have non-zero fallbacks.
// [C33-01] Fallback prices updated to current market values (Feb 2026).
export const FALLBACK_TOKEN_PRICES_USD: Record<string, number> = {
  HBAR: 0.10, WHBAR: 0.10, USDC: 1.0, USDT: 1.0, WBTC: 104000, WETH: 2650,
  LINK: 16.50, WPOL: 0.13, SAUCE: 0.045, HBARX: 0.11, KARATE: 0.0003,
  PACK: 0.015, DOVU: 0.002, HST: 0.018, "HBAR.\u0127": 0.000001,
  AAVE: 17.25, DAI: 1.0, WBNB: 660, WAVAX: 9.15, WMATIC: 0.13,
  USDCh: 1.0, USDTh: 1.0,
};

// Live price cache -- updated by fetchLiveTokenPrices()
let _liveTokenPricesUsd: Record<string, number> = {};
let _liveTokenPricesTimestamp = 0;
const LIVE_PRICE_TTL_MS = 300_000; // 5 minutes

/**
 * Get the best available price for a token symbol.
 * Prefers live prices from SaucerSwap, falls back to stale live or hardcoded.
 */
export function getTokenPriceUsd(symbol: string): number | undefined {
  // 1. Fresh live price
  if (Date.now() - _liveTokenPricesTimestamp < LIVE_PRICE_TTL_MS && _liveTokenPricesUsd[symbol]) {
    return _liveTokenPricesUsd[symbol];
  }
  // 2. Non-zero fallback
  const fallback = FALLBACK_TOKEN_PRICES_USD[symbol];
  if (fallback && fallback > 0) return fallback;
  // 3. Stale live price (better than zero/undefined)
  if (_liveTokenPricesUsd[symbol] && _liveTokenPricesUsd[symbol] > 0) {
    return _liveTokenPricesUsd[symbol];
  }
  return fallback;
}

// Merged accessor: returns live prices overlaid on fallbacks.
// Priority: fresh live price -> stale live price (if fallback is 0) -> fallback.
export const TOKEN_PRICES_USD: Record<string, number> = new Proxy(FALLBACK_TOKEN_PRICES_USD, {
  get(target, prop: string) {
    // 1. Fresh live price (within TTL)
    if (Date.now() - _liveTokenPricesTimestamp < LIVE_PRICE_TTL_MS && _liveTokenPricesUsd[prop] != null) {
      return _liveTokenPricesUsd[prop];
    }
    // 2. Fallback price -- but only if it's non-zero
    const fallback = target[prop];
    if (fallback && fallback > 0) return fallback;
    // 3. Stale live price (better than zero)
    if (_liveTokenPricesUsd[prop] != null && _liveTokenPricesUsd[prop] > 0) {
      return _liveTokenPricesUsd[prop];
    }
    // 4. Truly no price available
    return fallback ?? 0;
  },
  has(target, prop: string) {
    return prop in _liveTokenPricesUsd || prop in target;
  },
});

// ── Live Price Fetching ─────────────────────────────────────────────

/**
 * Fetch live token prices from the SaucerSwap API.
 * Updates the internal cache which TOKEN_PRICES_USD reads from.
 *
 * Falls back silently on failure -- the hardcoded prices remain available.
 */
export async function fetchLiveTokenPrices(): Promise<Record<string, number>> {
  try {
    const res = await saucerFetch("/tokens", 10000);
    if (!res) return _liveTokenPricesUsd;

    const data = await res.json();
    const prices: Record<string, number> = {};

    // data may be an array of token objects or an object keyed by token ID
    const tokens = Array.isArray(data) ? data : Object.values(data);

    // Build case-insensitive symbol lookup so "HBAR.\u0127" matches "HBAR.H" etc.
    const fallbackSymbolLower = new Map<string, string>();
    for (const key of Object.keys(FALLBACK_TOKEN_PRICES_USD)) {
      fallbackSymbolLower.set(key.toLowerCase(), key);
    }

    // [SECURITY-FIX-3] Track which symbols were already priced by the authoritative
    // static registry (TOKEN_BY_HTS_ID). Dynamic/symbol fallback matches must NEVER
    // overwrite these — scam tokens with identical symbols would corrupt prices.
    const pricedByStaticRegistry = new Set<string>();

    for (const t of tokens) {
      const priceUsd = parseFloat(t.priceUsd || t.price || "0");
      if (!priceUsd || priceUsd <= 0) continue;

      // Match by HTS ID (try multiple field names the API might use)
      const htsId = t.id || t.tokenId || t.token_id || "";

      // [SECURITY-FIX-3] Skip tokens on the scam blocklist — their inflated
      // prices must NEVER leak into the price cache under any symbol.
      if (htsId && isTokenBlocked(htsId)) continue;

      const registeredToken = TOKEN_BY_HTS_ID.get(htsId);
      if (registeredToken) {
        // [ROUTING-FIX] When both canonical and alias IDs map to the same token
        // in TOKEN_BY_HTS_ID, two API entries can match the static registry for
        // the same symbol. The CANONICAL entry must always win — alias entries
        // (ERC20Wrappers) may report different/inflated prices from the API.
        // Skip if already priced AND this is the alias (not the canonical ID).
        if (pricedByStaticRegistry.has(registeredToken.symbol) && htsId !== registeredToken.htsId) {
          continue;  // Skip alias — canonical already set the correct price
        }
        prices[registeredToken.symbol] = priceUsd;
        pricedByStaticRegistry.add(registeredToken.symbol);
        // WHBAR price = HBAR price
        if (registeredToken.symbol === "WHBAR") {
          prices["HBAR"] = priceUsd;
          pricedByStaticRegistry.add("HBAR");
        }
        continue;
      }

      // [C56] Check dynamic token registry for tokens fetched via SaucerSwap API
      const dynamicToken = resolveTokenByHtsId(htsId);
      if (dynamicToken) {
        // [SECURITY-FIX-3] Never overwrite a price already set by static registry
        if (!pricedByStaticRegistry.has(dynamicToken.symbol)) {
          prices[dynamicToken.symbol] = priceUsd;
        }
        continue;
      }

      // Match by symbol -- case-insensitive to handle "HBAR.\u0127" vs "HBAR.H"
      const rawSym = t.symbol || "";
      const symLower = rawSym.toLowerCase();
      const canonicalKey = fallbackSymbolLower.get(symLower);
      // [SECURITY-FIX-3] Never overwrite a price already set by static registry
      if (canonicalKey && !pricedByStaticRegistry.has(canonicalKey)) {
        prices[canonicalKey] = priceUsd;
      }
    }

    // ── Dedicated HBAR.h price fetch if not found in bulk response ──
    if (!prices["HBAR.\u0127"]) {
      try {
        const hbarhRes = await saucerFetch(`/tokens/${HBARH_TOKEN_ID}`, 8000);
        if (hbarhRes) {
          const hbarhData = await hbarhRes.json();
          const p = parseFloat(hbarhData?.priceUsd || hbarhData?.price || "0");
          if (p > 0) {
            prices["HBAR.\u0127"] = p;
          }
        }
      } catch { /* non-critical fallback */ }
    }

    // ── Fallback: fetch HBAR.\u0127 price from DexScreener if still missing ──
    if (!prices["HBAR.\u0127"]) {
      try {
        const hbarhResult = await fetchHbarhTokenPrice();
        if (hbarhResult.price > 0) {
          prices["HBAR.\u0127"] = hbarhResult.price;
          console.log(`[HBAR.h] Live price for HBAR.\u0127 via ${hbarhResult.source}: $${hbarhResult.price}`);
        }
      } catch { /* keep hardcoded fallback via TOKEN_PRICES_USD proxy */ }
    }

    if (Object.keys(prices).length > 0) {
      _liveTokenPricesUsd = prices;
      _liveTokenPricesTimestamp = Date.now();
      console.log(`[HBAR.h] Live token prices updated: ${Object.keys(prices).length} tokens`, prices);
    }

    return prices;
  } catch (err: any) {
    console.warn("[HBAR.h] fetchLiveTokenPrices failed:", err?.message || err);
    return _liveTokenPricesUsd;
  }
}

/**
 * Returns the current live price cache age in ms, or Infinity if no cache.
 */
export function getLivePriceCacheAge(): number {
  if (_liveTokenPricesTimestamp === 0) return Infinity;
  return Date.now() - _liveTokenPricesTimestamp;
}

/**
 * Returns the count of live prices currently cached.
 */
export function getLivePriceCount(): number {
  return Object.keys(_liveTokenPricesUsd).length;
}

// ── HBAR.h Dedicated Price Fetcher ──────────────────────────────────

/**
 * Dedicated HBAR.\u0127 price fetcher -- multi-strategy with robust fallbacks.
 * Tries, in order:
 *  1. Internal live cache (if fresh)
 *  2. DexScreener API (most accurate for DEX-traded tokens)
 *  3. SaucerSwap /tokens bulk (parses HBAR.\u0127 out)
 *  4. SaucerSwap /tokens/{id} direct endpoint
 *  5. Hardcoded fallback
 *
 * Returns { price, source } so callers can display provenance.
 */
export async function fetchHbarhTokenPrice(): Promise<{ price: number; source: string }> {
  // Strategy 1: cached live price
  if (
    Date.now() - _liveTokenPricesTimestamp < LIVE_PRICE_TTL_MS &&
    _liveTokenPricesUsd["HBAR.\u0127"] > 0
  ) {
    return { price: _liveTokenPricesUsd["HBAR.\u0127"], source: "saucerswap-cache" };
  }

  // Strategy 2a: DexScreener pairs endpoint
  try {
    const dexRes = await fetch(
      "https://api.dexscreener.com/latest/dex/pairs/hedera/0x31d6b803a960b818cce3a85f0bef7c4c566b7919",
      { signal: makeAbort(10000) }
    );
    if (dexRes.ok) {
      const dexData = await dexRes.json();
      const pair = dexData?.pair || dexData?.pairs?.[0];
      if (pair) {
        const p = parseFloat(pair.priceUsd || "0");
        if (p > 0) {
          _liveTokenPricesUsd["HBAR.\u0127"] = p;
          _liveTokenPricesTimestamp = Date.now();
          return { price: p, source: "dexscreener" };
        }
      }
    }
  } catch (err: any) {
    console.warn("[HBAR.h] fetchHbarhTokenPrice DexScreener pairs error:", err?.message || err);
  }

  // Strategy 2b: DexScreener token search (EVM address of 0.0.9356476)
  try {
    const dexTokenRes = await fetch(
      "https://api.dexscreener.com/latest/dex/tokens/0x00000000000000000000000000000000008ecf5c",
      { signal: makeAbort(10000) }
    );
    if (dexTokenRes.ok) {
      const dexTokenData = await dexTokenRes.json();
      const pairs = dexTokenData?.pairs;
      if (Array.isArray(pairs) && pairs.length > 0) {
        const best = pairs.reduce((a: any, b: any) =>
          (parseFloat(b.liquidity?.usd || "0") > parseFloat(a.liquidity?.usd || "0")) ? b : a
        , pairs[0]);
        const p = parseFloat(best.priceUsd || "0");
        if (p > 0) {
          _liveTokenPricesUsd["HBAR.\u0127"] = p;
          _liveTokenPricesTimestamp = Date.now();
          return { price: p, source: "dexscreener-tokens" };
        }
      }
    }
  } catch (err: any) {
    console.warn("[HBAR.h] fetchHbarhTokenPrice DexScreener tokens error:", err?.message || err);
  }

  // Strategy 3: check live price cache (populated by fetchLiveTokenPrices)
  // NOTE: Do NOT call fetchLiveTokenPrices() here -- it calls us back,
  // creating infinite recursion. Just check the cache.
  if (_liveTokenPricesUsd["HBAR.\u0127"] && _liveTokenPricesUsd["HBAR.\u0127"] > 0) {
    return { price: _liveTokenPricesUsd["HBAR.\u0127"], source: "saucerswap-cache" };
  }

  // Strategy 4: direct SaucerSwap token endpoint
  try {
    const res = await saucerFetch(`/tokens/${HBARH_TOKEN_ID}`, 8000);
    if (res) {
      const data = await res.json();
      const p = parseFloat(data?.priceUsd || data?.price || "0");
      if (p > 0) {
        _liveTokenPricesUsd["HBAR.\u0127"] = p;
        _liveTokenPricesTimestamp = Date.now();
        return { price: p, source: "saucerswap-direct" };
      }
    }
  } catch (err: any) {
    console.warn("[HBAR.h] fetchHbarhTokenPrice SaucerSwap direct error:", err?.message || err);
  }

  // Strategy 5: hardcoded fallback
  const fallback = FALLBACK_TOKEN_PRICES_USD["HBAR.\u0127"] || 0.000001;
  console.warn(`[HBAR.h] All live strategies exhausted -- using fallback: $${fallback}`);
  return { price: fallback, source: "fallback" };
}

// ── LP Token Pricing ────────────────────────────────────────────────

const SS_LP_WHBAR_HBARH_TOKEN_ID = "0.0.9356724";
const SS_LP_WHBAR_HBARH_DECIMALS = 8; // SaucerSwap V1 LP tokens use 8 decimals

// Cache for LP token price
let _lpTokenPriceCache: { price: number; source: string; ts: number } = { price: 0, source: "", ts: 0 };
const LP_PRICE_TTL_MS = 120_000; // 2 minutes

export async function fetchLPTokenPrice(
  lpTokenId: string = SS_LP_WHBAR_HBARH_TOKEN_ID
): Promise<{ price: number; source: string }> {
  // Return cached price if fresh
  if (_lpTokenPriceCache.price > 0 && Date.now() - _lpTokenPriceCache.ts < LP_PRICE_TTL_MS) {
    return { price: _lpTokenPriceCache.price, source: _lpTokenPriceCache.source };
  }

  // ── Strategy 1: SaucerSwap V1 pools API ──
  try {
    const res = await saucerFetch("/v1/pools", 10000);
    if (res) {
      const pools = await res.json();
      const poolArray = Array.isArray(pools) ? pools : Object.values(pools);

      for (const pool of poolArray) {
        const poolLpId = pool.lpToken?.id || pool.lpTokenId || pool.lp_token_id || "";
        const tokenAId = pool.tokenA?.id || pool.token0Id || pool.tokenA?.tokenId || "";
        const tokenBId = pool.tokenB?.id || pool.token1Id || pool.tokenB?.tokenId || "";

        // Match by LP token ID, or by component token pair (WHBAR + HBAR.\u0127)
        const isOurPool = poolLpId === lpTokenId ||
          (lpTokenId === SS_LP_WHBAR_HBARH_TOKEN_ID && (
            (tokenAId === "0.0.1456986" && tokenBId === HBARH_TOKEN_ID) ||
            (tokenBId === "0.0.1456986" && tokenAId === HBARH_TOKEN_ID)
          ));

        if (!isOurPool) continue;

        const tvl = parseFloat(pool.tvl || pool.tvlUsd || pool.liquidityUsd || "0");
        const totalSupply = parseFloat(pool.lpToken?.totalSupply || pool.totalSupply || "0");

        if (tvl > 0 && totalSupply > 0) {
          // totalSupply might be raw (needs decimal division) or human-readable
          const effectiveSupply = totalSupply > 1e12
            ? totalSupply / Math.pow(10, SS_LP_WHBAR_HBARH_DECIMALS)
            : totalSupply;
          const price = tvl / effectiveSupply;
          if (price > 0 && price < 1e6) {
            _lpTokenPriceCache = { price, source: "saucerswap-pool", ts: Date.now() };
            console.log(`[HBAR.h] LP token price: $${price.toFixed(8)} (via SaucerSwap pool TVL)`);
            return { price, source: "saucerswap-pool" };
          }
        }
      }
    }
  } catch { /* continue */ }

  // ── Strategy 2: DexScreener -- use the known WHBAR/HBAR.\u0127 PAIR address ──
  try {
    const WHBAR_HBARH_PAIR = "0x31d6b803a960b818cce3a85f0bef7c4c566b7919";
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/hedera/${WHBAR_HBARH_PAIR}`,
      { signal: makeAbort(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      const pair = data?.pair || data?.pairs?.[0];
      if (pair) {
        const liquidity = parseFloat(pair.liquidity?.usd || "0");
        if (liquidity > 0) {
          const totalSupplyRaw = await _fetchTokenTotalSupply(lpTokenId);
          if (totalSupplyRaw > 0) {
            const totalSupply = totalSupplyRaw / Math.pow(10, SS_LP_WHBAR_HBARH_DECIMALS);
            const price = liquidity / totalSupply;
            if (price > 0 && price < 1e6) {
              _lpTokenPriceCache = { price, source: "dexscreener-computed", ts: Date.now() };
              console.log(`[HBAR.h] LP token price: $${price.toFixed(8)} (via DexScreener pair liquidity / LP supply)`);
              return { price, source: "dexscreener-computed" };
            }
          }
        }
      }
    }
  } catch { /* continue */ }

  // ── Strategy 3: SaucerSwap V1 liqpools endpoint variants ──
  try {
    const totalSupplyRaw = await _fetchTokenTotalSupply(lpTokenId);
    if (totalSupplyRaw > 0) {
      const totalSupply = totalSupplyRaw / Math.pow(10, SS_LP_WHBAR_HBARH_DECIMALS);
      const endpoints = ["/v1/liqpools", "/liqpools", "/v1/liqpools/all"];
      for (const ep of endpoints) {
        try {
          const poolRes = await saucerFetch(ep, 8000);
          if (!poolRes) continue;
          const pools = await poolRes.json();
          const poolArr = Array.isArray(pools) ? pools : Object.values(pools);
          for (const pool of poolArr) {
            const poolLpId = pool.lpToken?.id || pool.lpTokenId || pool.lp_token_id || "";
            const tA = pool.tokenA?.id || pool.token0Id || "";
            const tB = pool.tokenB?.id || pool.token1Id || "";
            const isOurPool = poolLpId === lpTokenId ||
              ((tA === "0.0.1456986" && tB === HBARH_TOKEN_ID) ||
               (tB === "0.0.1456986" && tA === HBARH_TOKEN_ID));
            if (!isOurPool) continue;
            const tvl = parseFloat(pool.tvl || pool.tvlUsd || pool.liquidityUsd || "0");
            if (tvl > 0) {
              const price = tvl / totalSupply;
              if (price > 0 && price < 1e6) {
                _lpTokenPriceCache = { price, source: "saucerswap-liqpools", ts: Date.now() };
                console.log(`[HBAR.h] LP token price: $${price.toFixed(8)} (via SaucerSwap liqpools TVL)`);
                return { price, source: "saucerswap-liqpools" };
              }
            }
          }
        } catch { /* try next endpoint */ }
      }
    }
  } catch { /* continue */ }

  return { price: 0, source: "unavailable" };
}

/** Fetch total supply of a token from Mirror Node (raw, before decimal division). */
async function _fetchTokenTotalSupply(tokenId: string): Promise<number> {
  try {
    const res = await fetch(
      `https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/${tokenId}`,
      { signal: makeAbort(8000) }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return parseInt(data.total_supply || "0", 10);
  } catch {
    return 0;
  }
}

/** LP token constants for the WHBAR/HBAR.\u0127 pool, exported for Wallet.tsx */
// [C23-01] Display symbol/name show "HBAR" instead of "WHBAR" per C22 convention.
export const LP_TOKEN_WHBAR_HBARH = {
  tokenId: SS_LP_WHBAR_HBARH_TOKEN_ID,
  symbol: "ssLP-HBAR-HBAR.\u0127",
  name: "SaucerSwap LP: HBAR/HBAR.\u0127",
  decimals: SS_LP_WHBAR_HBARH_DECIMALS,
};

// ── All-Token Price Map (by HTS ID) ────────────────────────────────

export interface SaucerTokenPriceEntry {
  htsId: string;
  symbol: string;
  name: string;
  priceUsd: number;
  decimals: number;
  icon?: string;
}

let _allTokenPriceCache: { data: Map<string, SaucerTokenPriceEntry>; ts: number } | null = null;
const ALL_TOKEN_PRICE_TTL_MS = 60_000; // 1 minute

// [C90] Simple price-by-HTS-ID cache for estimateOutputFromPrices fallback.
// Populated from fetchAllTokenPricesById() results and fetchLiveTokenPrices().
const _allTokenPriceByIdCache = new Map<string, number>();

/**
 * Fetch ALL token prices from SaucerSwap, keyed by HTS token ID.
 * Returns a Map<htsId, SaucerTokenPriceEntry> covering every token
 * listed on SaucerSwap V1/V2 with a non-zero USD price.
 *
 * This is the primary price oracle for the Wallet portfolio view.
 */
export async function fetchAllTokenPricesById(): Promise<Map<string, SaucerTokenPriceEntry>> {
  // Return cache if fresh
  if (_allTokenPriceCache && Date.now() - _allTokenPriceCache.ts < ALL_TOKEN_PRICE_TTL_MS) {
    return _allTokenPriceCache.data;
  }

  const priceMap = new Map<string, SaucerTokenPriceEntry>();

  try {
    const res = await saucerFetch("/tokens", 12000);
    if (!res) {
      // Return stale cache if available
      return _allTokenPriceCache?.data ?? priceMap;
    }

    const data = await res.json();
    const tokens: any[] = Array.isArray(data) ? data : Object.values(data);

    for (const t of tokens) {
      const priceUsd = parseFloat(t.priceUsd || t.price || "0");
      const htsId = t.id || t.tokenId || t.token_id || "";
      if (!htsId || !htsId.startsWith("0.0.")) continue;

      // [SECURITY-FIX-3] Skip scam tokens — never cache their prices
      if (isTokenBlocked(htsId)) continue;

      const entry: SaucerTokenPriceEntry = {
        htsId,
        symbol: t.symbol || "",
        name: t.name || "",
        priceUsd: priceUsd > 0 ? priceUsd : 0,
        decimals: parseInt(t.decimals || "0", 10),
        icon: t.icon || t.logoURI || t.image || undefined,
      };

      priceMap.set(htsId, entry);
      // [C90] Populate HTS ID price cache for estimateOutputFromPrices fallback
      if (priceUsd > 0) {
        _allTokenPriceByIdCache.set(htsId, priceUsd);
      }
    }

    if (priceMap.size > 0) {
      _allTokenPriceCache = { data: priceMap, ts: Date.now() };
      log.info("SaucerSwap", `All-token price map: ${priceMap.size} tokens indexed by HTS ID`);
    }
  } catch (err: any) {
    log.info("SaucerSwap", `fetchAllTokenPricesById failed: ${err?.message || err}`);
    // Return stale cache on error
    if (_allTokenPriceCache) return _allTokenPriceCache.data;
  }

  return priceMap;
}

// ── Price-Based Swap Estimation ─────────────────────────────────────

/**
 * Estimate swap output from token prices.
 * Uses the Uniswap V2 constant product fee model (0.3% per hop).
 * Zero network calls -- uses cached prices only.
 */
export function estimateOutputFromPrices(
  rawAmountIn: number,
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  hops: number = 1,
  feePerHopPct: number = 0.3
): number | null {
  const inputSym = inputToken.isNative ? "HBAR" : inputToken.symbol;
  const outputSym = outputToken.isNative ? "HBAR" : outputToken.symbol;

  // Read prices through the proxy (tries: fresh live -> non-zero fallback -> stale live)
  let inputPrice = TOKEN_PRICES_USD[inputSym];
  let outputPrice = TOKEN_PRICES_USD[outputSym];

  // [C90] HTS ID fallback: when symbol lookup fails (exotic/bridge tokens
  // whose symbols don't match our registry), try fetching price by HTS ID
  // from the live price cache. This catches WBNB, WAVAX, and other tokens
  // that the SaucerSwap /tokens API returns with a price but our symbol
  // registry doesn't map.
  if ((inputPrice == null || inputPrice <= 0) && inputToken.htsId) {
    const byId = _allTokenPriceByIdCache.get(inputToken.htsId);
    if (byId && byId > 0) {
      inputPrice = byId;
      console.log(`[HBAR.h] estimateOutputFromPrices: ${inputSym} price rescued via HTS ID ${inputToken.htsId}: $${byId}`);
    }
  }
  if ((outputPrice == null || outputPrice <= 0) && outputToken.htsId) {
    const byId = _allTokenPriceByIdCache.get(outputToken.htsId);
    if (byId && byId > 0) {
      outputPrice = byId;
      console.log(`[HBAR.h] estimateOutputFromPrices: ${outputSym} price rescued via HTS ID ${outputToken.htsId}: $${byId}`);
    }
  }

  // Guard: reject only genuinely missing/undefined prices, not zero
  if (inputPrice == null || outputPrice == null || outputPrice <= 0) {
    console.warn(
      `[HBAR.h] estimateOutputFromPrices: cannot estimate -- ` +
      `inputPrice[${inputSym}]=${inputPrice}, outputPrice[${outputSym}]=${outputPrice}`
    );
    return null;
  }

  // Extra safety: if inputPrice is 0, try WHBAR<->HBAR cross-reference
  if (inputPrice <= 0 && (inputSym === "HBAR" || inputSym === "WHBAR")) {
    const alt = TOKEN_PRICES_USD[inputSym === "HBAR" ? "WHBAR" : "HBAR"];
    if (alt && alt > 0) inputPrice = alt;
  }
  if (outputPrice <= 0 && (outputSym === "HBAR" || outputSym === "WHBAR")) {
    const alt = TOKEN_PRICES_USD[outputSym === "HBAR" ? "WHBAR" : "HBAR"];
    if (alt && alt > 0) outputPrice = alt;
  }

  if (inputPrice <= 0 || outputPrice <= 0) {
    console.warn(
      `[HBAR.h] estimateOutputFromPrices: zero price after fallbacks -- ` +
      `inputPrice[${inputSym}]=${inputPrice}, outputPrice[${outputSym}]=${outputPrice}`
    );
    return null;
  }

  // Convert raw amount to human-readable
  const humanInput = rawAmountIn / Math.pow(10, inputToken.decimals);
  // Value in USD
  const valueUsd = humanInput * inputPrice;
  // Deduct fee per hop (compounding)
  const feeMultiplier = Math.pow(1 - feePerHopPct / 100, hops);
  const outputHuman = (valueUsd * feeMultiplier) / outputPrice;
  // Convert to raw output decimals
  const rawOutput = Math.floor(outputHuman * Math.pow(10, outputToken.decimals));
  return rawOutput > 0 ? rawOutput : null;
}
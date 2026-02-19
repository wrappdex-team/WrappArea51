/**
 * DeFi Stats — Live SaucerSwap Pool Data for the DeFi Dashboard
 *
 * Data pipeline (in priority order):
 *   A. WRAPpDEX backend proxy → /saucerswap/pools (server-cached, V1+V2 merged)
 *   B. Direct SaucerSwap API → /v1/lp/allData + /v2/pools (browser-side fallback)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * IMPORTANT: This module returns ONLY live data from SaucerSwap.
 * There are NO hardcoded fallback pools. If all sources are unreachable,
 * the module returns an empty array — the UI shows an honest error
 * state instead of fabricated numbers.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { log } from "./logger";
import { SAUCERSWAP_PARTNER_ID } from "./saucerswap";
import { projectId, publicAnonKey } from "/utils/supabase/info";

// ── Types ──────────────────────────────────────────────────────────

export interface LivePool {
  id: string;
  tokenA: { symbol: string; name: string; logo: string; htsId: string };
  tokenB: { symbol: string; name: string; logo: string; htsId: string };
  tvl: number;          // USD
  volume24h: number;    // USD
  volume7d: number;     // USD (7-day rolling)
  apr: number;          // Total annualized percentage (fee + farm)
  feeAPR: number;       // Fee-based APR
  farmAPR: number;      // Farm reward APR
  fee: number;          // Fee tier as percentage (e.g. 0.3)
  utilization: number;  // volume/tvl ratio as percentage
  source: "v1" | "v2";
  trending: "up" | "down" | "stable";
  contractId: string;   // SaucerSwap pool contract ID
}

export interface DeFiProtocolStats {
  totalTVL: number;
  totalVolume24h: number;
  avgAPR: number;
  poolCount: number;
  v1Count: number;
  v2Count: number;
  dataSource: "live" | "unavailable";
  lastUpdated: number;  // timestamp ms
  fetchDurationMs: number;
}

// ── Constants ──────────────────────────────────────────────────────

const BACKEND_URL = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/saucerswap/pools`;
const SAUCERSWAP_API = "https://api.saucerswap.finance";
const CACHE_TTL_MS = 60_000; // 1 minute
const FETCH_TIMEOUT_MS = 15_000;
const MIN_TVL_DISPLAY = 100; // Pools below $100 TVL are hidden (dust/spam)

// ── Token Logo Resolution ─────────────────────────────────────────

const TOKEN_LOGOS: Record<string, string> = {
  HBAR:        "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  WHBAR:       "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  USDC:        "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  USDT:        "https://assets.coingecko.com/coins/images/325/large/Tether.png",
  WBTC:        "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  "WBTC[hts]": "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  WETH:        "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  "WETH[hts]": "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  LINK:        "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  "LINK[hts]": "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  SAUCE:       "https://www.saucerswap.finance/images/tokens/sauce.svg",
  HBARX:       "https://www.saucerswap.finance/images/tokens/hbarx.svg",
  KARATE:      "https://www.saucerswap.finance/images/tokens/karate.svg",
  PACK:        "https://www.saucerswap.finance/images/tokens/pack.svg",
  HST:         "https://www.saucerswap.finance/images/tokens/hst.svg",
  DOVU:        "https://www.saucerswap.finance/images/tokens/dovu.svg",
  "HBAR.ħ":    "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  AAVE:        "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png",
  DAI:         "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
  DOT:         "https://assets.coingecko.com/coins/images/12171/large/polkadot.png",
};

function resolveTokenLogo(symbol: string, apiIcon?: string): string {
  const cleaned = symbol.replace("[hts]", "").replace("[HTS]", "");
  if (TOKEN_LOGOS[symbol]) return TOKEN_LOGOS[symbol];
  if (TOKEN_LOGOS[cleaned]) return TOKEN_LOGOS[cleaned];
  if (apiIcon) {
    if (apiIcon.startsWith("http")) return apiIcon;
    return `https://www.saucerswap.finance${apiIcon}`;
  }
  return `https://www.saucerswap.finance/images/tokens/${cleaned.toLowerCase()}.svg`;
}

// ── Helpers ───────────────────────────────────────────────────────

function safeFloat(v: any): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  return 0;
}

/** Normalize fee from various API formats to a percentage (e.g. 0.3) */
function normalizeFee(raw: number): number {
  if (raw >= 100000) return raw / 1_000_000;  // Millionths
  if (raw >= 10000) return raw / 10_000;
  if (raw >= 100) return raw / 10_000;    // Basis points (3000 → 0.3%)
  if (raw > 1) return raw / 100;         // Whole percent (30 → 0.3%)
  return raw;                            // Already decimal (0.3)
}

function extractPoolArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["pools", "data", "results", "items"]) {
      if (Array.isArray(data[key])) return data[key];
    }
    const values = Object.values(data);
    if (values.length > 0 && typeof values[0] === "object") return values;
  }
  return [];
}

// ── Direct SaucerSwap Fetch Helper (browser-side fallback) ────────

async function ssFetch(path: string): Promise<any | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (SAUCERSWAP_PARTNER_ID) {
    headers["x-api-key"] = SAUCERSWAP_PARTNER_ID;
  }

  try {
    const res = await fetch(SAUCERSWAP_API + path, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn("DeFiStats", `SaucerSwap ${path} → HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      log.warn("DeFiStats", `SaucerSwap ${path} → timeout (${FETCH_TIMEOUT_MS}ms)`);
    } else {
      log.warn("DeFiStats", `SaucerSwap ${path} → ${err?.message || err}`);
    }
    return null;
  }
}

// ── V1 Pool Parser (for direct fallback) ──────────────────────────

function parseV1Pool(raw: any): LivePool | null {
  try {
    const tA = raw.tokenA || raw.token0 || {};
    const tB = raw.tokenB || raw.token1 || {};
    const symA = tA.symbol || tA.name || "???";
    const symB = tB.symbol || tB.name || "???";

    const tvl = safeFloat(raw.tvl ?? raw.liquidity ?? raw.liquidityUsd ?? raw.totalLiquidity ?? 0);
    if (tvl < MIN_TVL_DISPLAY) return null;

    const vol24 = safeFloat(raw.volume24h ?? raw.volume24Hr ?? raw.dailyVolume ?? 0);
    const vol7d = safeFloat(raw.volume7d ?? raw.weeklyVolume ?? 0);

    const feeRaw = safeFloat(raw.fee ?? raw.lpFee ?? raw.feeRate ?? raw.lpFeeRate ?? 0);
    const fee = normalizeFee(feeRaw);

    let feeAPR = safeFloat(raw.apr ?? raw.apy ?? 0);
    if (feeAPR <= 0 && tvl > 0 && fee > 0) {
      feeAPR = (vol24 * (fee / 100) * 365) / tvl * 100;
    }

    const utilization = tvl > 0 ? Math.min((vol24 / tvl) * 100, 100) : 0;
    const contractId = raw.contractId || raw.id?.toString() || raw.pairAddress || "";

    return {
      id: contractId || `v1-${symA}-${symB}`,
      tokenA: {
        symbol: symA,
        name: tA.name || symA,
        logo: resolveTokenLogo(symA, tA.icon ?? tA.image),
        htsId: tA.id || tA.tokenId || "",
      },
      tokenB: {
        symbol: symB,
        name: tB.name || symB,
        logo: resolveTokenLogo(symB, tB.icon ?? tB.image),
        htsId: tB.id || tB.tokenId || "",
      },
      tvl,
      volume24h: vol24,
      volume7d: vol7d,
      apr: Math.round(feeAPR * 10) / 10,
      feeAPR: Math.round(feeAPR * 10) / 10,
      farmAPR: 0,
      fee: Math.round(fee * 10000) / 10000,
      utilization: Math.round(utilization * 10) / 10,
      source: "v1",
      trending: vol24 > tvl * 0.15 ? "up" : vol24 < tvl * 0.03 ? "down" : "stable",
      contractId,
    };
  } catch (err) {
    log.debug("DeFiStats", "V1 pool parse error", err);
    return null;
  }
}

// ── V2 Pool Parser (for direct fallback) ──────────────────────────

function parseV2Pool(raw: any): LivePool | null {
  try {
    const tA = raw.tokenA || raw.token0 || {};
    const tB = raw.tokenB || raw.token1 || {};
    const symA = tA.symbol || tA.name || "???";
    const symB = tB.symbol || tB.name || "???";

    const tvl = safeFloat(raw.tvl ?? raw.tvlUsd ?? raw.liquidity ?? raw.liquidityUsd ?? 0);
    if (tvl < MIN_TVL_DISPLAY) return null;

    const vol24 = safeFloat(raw.volume24h ?? raw.volume24hUsd ?? raw.dailyVolume ?? 0);
    const vol7d = safeFloat(raw.volume7d ?? raw.weeklyVolume ?? 0);

    const feeRaw = safeFloat(raw.fee ?? raw.feeTier ?? 0);
    const fee = normalizeFee(feeRaw);

    let feeAPR = safeFloat(raw.apr ?? raw.apy ?? raw.feeApr ?? 0);
    if (feeAPR <= 0 && tvl > 0 && fee > 0) {
      feeAPR = (vol24 * (fee / 100) * 365) / tvl * 100;
    }

    const utilization = tvl > 0 ? Math.min((vol24 / tvl) * 100, 100) : 0;
    const contractId = raw.contractId || raw.id?.toString() || raw.poolAddress || "";

    return {
      id: contractId || `v2-${symA}-${symB}-${feeRaw}`,
      tokenA: {
        symbol: symA,
        name: tA.name || symA,
        logo: resolveTokenLogo(symA, tA.icon ?? tA.image),
        htsId: tA.id || tA.tokenId || "",
      },
      tokenB: {
        symbol: symB,
        name: tB.name || symB,
        logo: resolveTokenLogo(symB, tB.icon ?? tB.image),
        htsId: tB.id || tB.tokenId || "",
      },
      tvl,
      volume24h: vol24,
      volume7d: vol7d,
      apr: Math.round(feeAPR * 10) / 10,
      feeAPR: Math.round(feeAPR * 10) / 10,
      farmAPR: 0,
      fee: Math.round(fee * 10000) / 10000,
      utilization: Math.round(utilization * 10) / 10,
      source: "v2",
      trending: vol24 > tvl * 0.15 ? "up" : vol24 < tvl * 0.03 ? "down" : "stable",
      contractId,
    };
  } catch (err) {
    log.debug("DeFiStats", "V2 pool parse error", err);
    return null;
  }
}

// ── Cache ──────────────────────────────────────────────────────────

let _cache: {
  pools: LivePool[];
  stats: DeFiProtocolStats;
  ts: number;
} | null = null;

// ── Strategy A: Fetch from WRAPpDEX backend proxy ─────────────────
// This is the preferred path — backend handles V1+V2+farm merging,
// caches server-side, and uses the API key securely.

async function fetchFromBackend(): Promise<{
  pools: LivePool[];
  stats: DeFiProtocolStats;
} | null> {
  try {
    const res = await fetch(BACKEND_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${publicAnonKey}`,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      log.warn("DeFiStats", `Backend proxy → HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data?.pools || !Array.isArray(data.pools)) {
      log.warn("DeFiStats", "Backend proxy returned invalid data structure");
      return null;
    }

    // Map backend pool shape → LivePool
    const pools: LivePool[] = data.pools.map((p: any) => ({
      id: p.id || p.contractId || "",
      tokenA: {
        symbol: p.tokenA?.symbol || "???",
        name: p.tokenA?.name || p.tokenA?.symbol || "Unknown",
        logo: resolveTokenLogo(p.tokenA?.symbol || "", p.tokenA?.icon),
        htsId: p.tokenA?.id || "",
      },
      tokenB: {
        symbol: p.tokenB?.symbol || "???",
        name: p.tokenB?.name || p.tokenB?.symbol || "Unknown",
        logo: resolveTokenLogo(p.tokenB?.symbol || "", p.tokenB?.icon),
        htsId: p.tokenB?.id || "",
      },
      tvl: safeFloat(p.tvl),
      volume24h: safeFloat(p.volume24h),
      volume7d: safeFloat(p.volume7d),
      apr: safeFloat(p.totalAPR ?? p.apr),
      feeAPR: safeFloat(p.feeAPR),
      farmAPR: safeFloat(p.farmAPR),
      fee: safeFloat(p.fee),
      utilization: safeFloat(p.utilization),
      source: p.source || "v1",
      trending: p.trending || "stable",
      contractId: p.contractId || p.id || "",
    })).filter((p: LivePool) => p.tvl >= MIN_TVL_DISPLAY);

    const stats = data.stats || {};
    const isLive = pools.length > 0;

    return {
      pools,
      stats: {
        totalTVL: safeFloat(stats.totalTVL),
        totalVolume24h: safeFloat(stats.totalVolume24h),
        avgAPR: safeFloat(stats.avgAPR),
        poolCount: pools.length,
        v1Count: safeFloat(stats.v1Count) || pools.filter((p: LivePool) => p.source === "v1").length,
        v2Count: safeFloat(stats.v2Count) || pools.filter((p: LivePool) => p.source === "v2").length,
        dataSource: isLive ? "live" : "unavailable",
        lastUpdated: stats.lastUpdated || Date.now(),
        fetchDurationMs: safeFloat(stats.fetchDurationMs),
      },
    };
  } catch (err: any) {
    log.warn("DeFiStats", `Backend proxy failed: ${err?.message || err}`);
    return null;
  }
}

// ── Strategy B: Direct SaucerSwap fetch (browser-side fallback) ────

async function fetchDirectFromSaucerSwap(): Promise<{
  pools: LivePool[];
  stats: DeFiProtocolStats;
} | null> {
  const t0 = Date.now();
  log.info("DeFiStats", "Falling back to direct SaucerSwap fetch (V1 + V2)...");

  // Parallel fetch: V1 allData + V2 pools
  const [v1AllData, v1Pools, v2Pools] = await Promise.all([
    ssFetch("/v1/lp/allData"),
    ssFetch("/v1/pools"),
    ssFetch("/v2/pools"),
  ]);

  let allPools: LivePool[] = [];

  // Parse V1 allData (preferred — most fields)
  if (v1AllData) {
    const raw = extractPoolArray(v1AllData);
    const parsed = raw.map(parseV1Pool).filter((p): p is LivePool => p !== null);
    allPools.push(...parsed);
    log.info("DeFiStats", `V1 allData: ${parsed.length} pools from ${raw.length} entries`);
  }

  // If allData was empty/failed, try the plain /v1/pools endpoint
  if (allPools.filter(p => p.source === "v1").length === 0 && v1Pools) {
    const raw = extractPoolArray(v1Pools);
    const parsed = raw.map(parseV1Pool).filter((p): p is LivePool => p !== null);
    allPools.push(...parsed);
    log.info("DeFiStats", `V1 pools fallback: ${parsed.length} pools`);
  }

  // Parse V2 pools
  if (v2Pools) {
    const raw = extractPoolArray(v2Pools);
    const parsed = raw.map(parseV2Pool).filter((p): p is LivePool => p !== null);
    allPools.push(...parsed);
    log.info("DeFiStats", `V2 pools: ${parsed.length} pools from ${raw.length} entries`);
  }

  // Deduplicate by id (prefer higher TVL)
  const seen = new Map<string, LivePool>();
  for (const pool of allPools) {
    const existing = seen.get(pool.id);
    if (!existing || pool.tvl > existing.tvl) {
      seen.set(pool.id, pool);
    }
  }
  allPools = Array.from(seen.values());

  // Sort by TVL descending
  allPools.sort((a, b) => b.tvl - a.tvl);

  if (allPools.length === 0) {
    return null;
  }

  // Compute aggregates
  const totalTVL = allPools.reduce((s, p) => s + p.tvl, 0);
  const totalVolume24h = allPools.reduce((s, p) => s + p.volume24h, 0);
  const poolsWithAPR = allPools.filter((p) => p.apr > 0);
  const avgAPR = poolsWithAPR.length > 0
    ? poolsWithAPR.reduce((s, p) => s + p.apr, 0) / poolsWithAPR.length
    : 0;
  const fetchMs = Date.now() - t0;

  log.info(
    "DeFiStats",
    `Direct fetch: ${allPools.length} pools, ` +
    `TVL $${(totalTVL / 1e6).toFixed(2)}M, ` +
    `24h Vol $${(totalVolume24h / 1e6).toFixed(2)}M, ` +
    `Avg APR ${avgAPR.toFixed(1)}% (${fetchMs}ms)`,
  );

  return {
    pools: allPools,
    stats: {
      totalTVL,
      totalVolume24h,
      avgAPR: Math.round(avgAPR * 10) / 10,
      poolCount: allPools.length,
      v1Count: allPools.filter(p => p.source === "v1").length,
      v2Count: allPools.filter(p => p.source === "v2").length,
      dataSource: "live",
      lastUpdated: Date.now(),
      fetchDurationMs: fetchMs,
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Fetch live SaucerSwap pool data and compute protocol stats.
 *
 * Strategy A: WRAPpDEX backend proxy (server-cached, V1+V2+farm merged)
 * Strategy B: Direct SaucerSwap API (browser-side, V1+V2, no farm APR)
 *
 * Returns ONLY live data — never fabricated numbers.
 * If all sources are unreachable, returns empty pools and
 * dataSource: "unavailable" so the UI can show an honest state.
 */
export async function fetchDeFiPoolData(): Promise<{
  pools: LivePool[];
  stats: DeFiProtocolStats;
}> {
  // Return cached if fresh
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return { pools: _cache.pools, stats: _cache.stats };
  }

  const t0 = Date.now();
  log.info("DeFiStats", "Fetching live SaucerSwap pool data...");

  // Strategy A: Backend proxy (preferred)
  const backendResult = await fetchFromBackend();
  if (backendResult && backendResult.pools.length > 0) {
    log.info("DeFiStats", `Backend proxy: ${backendResult.pools.length} pools`);
    _cache = { pools: backendResult.pools, stats: backendResult.stats, ts: Date.now() };
    return backendResult;
  }

  // Strategy B: Direct SaucerSwap (fallback)
  const directResult = await fetchDirectFromSaucerSwap();
  if (directResult && directResult.pools.length > 0) {
    _cache = { pools: directResult.pools, stats: directResult.stats, ts: Date.now() };
    return directResult;
  }

  // All strategies failed — return empty with honest status
  const fetchMs = Date.now() - t0;
  log.warn("DeFiStats", `All sources unreachable — returning empty pool list (${fetchMs}ms)`);

  const emptyStats: DeFiProtocolStats = {
    totalTVL: 0,
    totalVolume24h: 0,
    avgAPR: 0,
    poolCount: 0,
    v1Count: 0,
    v2Count: 0,
    dataSource: "unavailable",
    lastUpdated: Date.now(),
    fetchDurationMs: fetchMs,
  };

  return { pools: [], stats: emptyStats };
}

/**
 * Force refresh on next call.
 */
export function invalidateDeFiCache(): void {
  _cache = null;
}

/**
 * Returns how old the cached data is (ms), or Infinity if no cache.
 */
export function getDeFiCacheAge(): number {
  if (!_cache) return Infinity;
  return Date.now() - _cache.ts;
}

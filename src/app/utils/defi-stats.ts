/**
 * DeFi Stats — Live SaucerSwap pool data for the DeFi dashboard
 *
 * Fetches real liquidity pool data from SaucerSwap V1/V2 APIs and
 * computes aggregate protocol statistics (TVL, 24h Volume, Avg APR).
 *
 * Data pipeline:
 *   1. Fetch V2 pools from /v2/pools (concentrated liquidity)
 *   2. Fetch V1 pools from /v1/pools (constant-product AMM)
 *   3. Merge, deduplicate, and sort by TVL
 *   4. Compute aggregates for the stats cards
 *
 * Cache: 60s TTL, auto-invalidated on manual refresh.
 *
 * API docs: https://docs.saucerswap.finance (public, no auth)
 */

import { log } from "./logger";

// ── Types ──────────────────────────────────────────────────────────

export interface LivePool {
  id: string;
  tokenA: { symbol: string; name: string; logo: string; htsId: string };
  tokenB: { symbol: string; name: string; logo: string; htsId: string };
  tvl: number;          // USD
  volume24h: number;    // USD
  apr: number;          // annualized percentage
  fee: number;          // fee tier as percentage (e.g. 0.3)
  utilization: number;  // volume/tvl ratio as percentage
  source: "v1" | "v2";
  trending: "up" | "down" | "stable";
}

export interface DeFiProtocolStats {
  totalTVL: number;
  totalVolume24h: number;
  avgAPR: number;
  poolCount: number;
  dataSource: "live" | "fallback";
  lastUpdated: number;  // timestamp ms
}

// ── Constants ──────────────────────────────────────────────────────

const SAUCERSWAP_API = "https://api.saucerswap.finance";
const CACHE_TTL_MS = 60_000; // 1 minute

// Known token logos (keyed by common symbols)
const TOKEN_LOGOS: Record<string, string> = {
  HBAR:      "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  WHBAR:     "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  USDC:      "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  USDT:      "https://assets.coingecko.com/coins/images/325/large/Tether.png",
  WBTC:      "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  "WBTC[hts]": "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  WETH:      "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  "WETH[hts]": "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  LINK:      "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  "LINK[hts]": "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  SAUCE:     "https://www.saucerswap.finance/images/tokens/sauce.svg",
  HBARX:     "https://www.saucerswap.finance/images/tokens/hbarx.svg",
  KARATE:    "https://www.saucerswap.finance/images/tokens/karate.svg",
  PACK:      "https://www.saucerswap.finance/images/tokens/pack.svg",
  HST:       "https://www.saucerswap.finance/images/tokens/hst.svg",
  DOVU:      "https://www.saucerswap.finance/images/tokens/dovu.svg",
  "HBAR.ħ":  "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
};

function getTokenLogo(symbol: string): string {
  return TOKEN_LOGOS[symbol] || TOKEN_LOGOS[symbol.replace("[hts]", "")] || "";
}

// ── Fetch helper ───────────────────────────────────────────────────

async function apiFetch(path: string, timeoutMs = 10000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Try path as-given, then with alternate prefixes
  const variants = [path, `/v2${path}`, `/v1${path}`];

  for (const variant of variants) {
    try {
      const res = await fetch(SAUCERSWAP_API + variant, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (res.ok) {
        clearTimeout(timer);
        return await res.json();
      }
    } catch {
      // try next
    }
  }

  clearTimeout(timer);
  return null;
}

// ── Parse V1 pools ─────────────────────────────────────────────────

function parseV1Pool(raw: any): LivePool | null {
  try {
    const tokenA = raw.tokenA || raw.token0 || {};
    const tokenB = raw.tokenB || raw.token1 || {};
    const symA = tokenA.symbol || tokenA.name || "???";
    const symB = tokenB.symbol || tokenB.name || "???";

    const tvl = parseFloat(raw.tvl || raw.liquidity || raw.totalLiquidity || raw.liquidityUsd || "0");
    const volume24h = parseFloat(raw.volume24h || raw.volume24Hr || raw.dailyVolume || "0");
    const feeRaw = parseFloat(raw.fee || raw.lpFee || raw.feeRate || "0");
    // SaucerSwap V1 fees: if raw is in basis points (e.g. 3000 = 0.3%), convert
    const fee = feeRaw > 100 ? feeRaw / 10000 : feeRaw > 1 ? feeRaw / 100 : feeRaw;

    if (tvl <= 0) return null;

    // APR = (volume24h * feePercent/100 * 365) / tvl * 100
    const apr = tvl > 0 ? (volume24h * (fee / 100) * 365) / tvl * 100 : 0;

    const utilization = tvl > 0 ? Math.min((volume24h / tvl) * 100, 100) : 0;

    return {
      id: raw.id || raw.contractId || raw.pairAddress || `v1-${symA}-${symB}`,
      tokenA: {
        symbol: symA,
        name: tokenA.name || symA,
        logo: getTokenLogo(symA),
        htsId: tokenA.id || tokenA.tokenId || "",
      },
      tokenB: {
        symbol: symB,
        name: tokenB.name || symB,
        logo: getTokenLogo(symB),
        htsId: tokenB.id || tokenB.tokenId || "",
      },
      tvl,
      volume24h,
      apr: Math.round(apr * 10) / 10,
      fee: Math.round(fee * 1000) / 1000,
      utilization: Math.round(utilization * 10) / 10,
      source: "v1",
      trending: volume24h > tvl * 0.15 ? "up" : volume24h < tvl * 0.05 ? "down" : "stable",
    };
  } catch {
    return null;
  }
}

// ── Parse V2 pools ─────────────────────────────────────────────────

function parseV2Pool(raw: any): LivePool | null {
  try {
    const tokenA = raw.tokenA || raw.token0 || {};
    const tokenB = raw.tokenB || raw.token1 || {};
    const symA = tokenA.symbol || tokenA.name || "???";
    const symB = tokenB.symbol || tokenB.name || "???";

    const tvl = parseFloat(raw.tvl || raw.liquidity || raw.totalValueLockedUSD || "0");
    const volume24h = parseFloat(raw.volume24h || raw.volume24Hr || raw.dailyVolume || "0");
    const feeRaw = parseFloat(raw.fee || raw.feeTier || "0");
    // V2 feeTier is typically in hundredths of a basis point (e.g. 3000 = 0.3%)
    const fee = feeRaw >= 100 ? feeRaw / 10000 : feeRaw > 1 ? feeRaw / 100 : feeRaw;

    if (tvl <= 0) return null;

    const apr = tvl > 0 ? (volume24h * (fee / 100) * 365) / tvl * 100 : 0;
    const utilization = tvl > 0 ? Math.min((volume24h / tvl) * 100, 100) : 0;

    return {
      id: raw.id || raw.contractId || raw.poolAddress || `v2-${symA}-${symB}`,
      tokenA: {
        symbol: symA,
        name: tokenA.name || symA,
        logo: getTokenLogo(symA),
        htsId: tokenA.id || tokenA.tokenId || "",
      },
      tokenB: {
        symbol: symB,
        name: tokenB.name || symB,
        logo: getTokenLogo(symB),
        htsId: tokenB.id || tokenB.tokenId || "",
      },
      tvl,
      volume24h,
      apr: Math.round(apr * 10) / 10,
      fee: Math.round(fee * 1000) / 1000,
      utilization: Math.round(utilization * 10) / 10,
      source: "v2",
      trending: volume24h > tvl * 0.15 ? "up" : volume24h < tvl * 0.05 ? "down" : "stable",
    };
  } catch {
    return null;
  }
}

// ── Parse generic pool response ────────────────────────────────────
// Handles both array and object response shapes from the API

function parsePoolsResponse(data: any, version: "v1" | "v2"): LivePool[] {
  const parser = version === "v1" ? parseV1Pool : parseV2Pool;

  // Handle array of pools
  if (Array.isArray(data)) {
    return data.map(parser).filter((p): p is LivePool => p !== null);
  }

  // Handle object keyed by pool ID or with a nested array
  if (data && typeof data === "object") {
    // Check for a known wrapper key
    const arr = data.pools || data.data || data.results || Object.values(data);
    if (Array.isArray(arr)) {
      return arr.map(parser).filter((p): p is LivePool => p !== null);
    }
  }

  return [];
}

// ── Cache ──────────────────────────────────────────────────────────

let _cache: {
  pools: LivePool[];
  stats: DeFiProtocolStats;
  ts: number;
} | null = null;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Fetch live SaucerSwap pool data and compute protocol stats.
 *
 * Tries V2 pools first, then V1, merges results, and computes
 * aggregate TVL, volume, and APR.  Results are cached for 60s.
 */
export async function fetchDeFiPoolData(): Promise<{
  pools: LivePool[];
  stats: DeFiProtocolStats;
}> {
  // Return cached if fresh
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return { pools: _cache.pools, stats: _cache.stats };
  }

  log.info("DeFiStats", "Fetching live SaucerSwap pool data...");

  // Fetch V1 and V2 pools in parallel
  const [v1Data, v2Data] = await Promise.all([
    apiFetch("/pools").catch(() => null),
    apiFetch("/v2/pools").catch(() => null),
  ]);

  let allPools: LivePool[] = [];

  if (v1Data) {
    const v1Pools = parsePoolsResponse(v1Data, "v1");
    allPools.push(...v1Pools);
    log.info("DeFiStats", `Parsed ${v1Pools.length} V1 pools`);
  }

  if (v2Data) {
    const v2Pools = parsePoolsResponse(v2Data, "v2");
    allPools.push(...v2Pools);
    log.info("DeFiStats", `Parsed ${v2Pools.length} V2 pools`);
  }

  // Deduplicate by id (prefer V2 if same id exists)
  const seen = new Map<string, LivePool>();
  for (const pool of allPools) {
    const existing = seen.get(pool.id);
    if (!existing || pool.source === "v2") {
      seen.set(pool.id, pool);
    }
  }
  allPools = Array.from(seen.values());

  // Sort by TVL descending
  allPools.sort((a, b) => b.tvl - a.tvl);

  // Compute aggregates
  const totalTVL = allPools.reduce((s, p) => s + p.tvl, 0);
  const totalVolume24h = allPools.reduce((s, p) => s + p.volume24h, 0);
  const poolsWithAPR = allPools.filter((p) => p.apr > 0);
  const avgAPR = poolsWithAPR.length > 0
    ? poolsWithAPR.reduce((s, p) => s + p.apr, 0) / poolsWithAPR.length
    : 0;

  const isLive = allPools.length > 0;

  const stats: DeFiProtocolStats = {
    totalTVL,
    totalVolume24h,
    avgAPR: Math.round(avgAPR * 10) / 10,
    poolCount: allPools.length,
    dataSource: isLive ? "live" : "fallback",
    lastUpdated: Date.now(),
  };

  if (isLive) {
    log.info(
      "DeFiStats",
      `${allPools.length} pools, ` +
      `TVL $${(totalTVL / 1e6).toFixed(2)}M, ` +
      `24h Vol $${(totalVolume24h / 1e6).toFixed(2)}M, ` +
      `Avg APR ${stats.avgAPR}%`
    );
  } else {
    log.info("DeFiStats", "SaucerSwap pool APIs unreachable — using fallback data");
  }

  _cache = { pools: allPools, stats, ts: Date.now() };
  return { pools: allPools, stats };
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
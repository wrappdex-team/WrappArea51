// ═══════════════════════════════════════════════════════════════════════
// SAUCERSWAP POOL DATA — Server-Side Proxy & Cache
// ═══════════════════════════════════════════════════════════════════════
//
// Proxies SaucerSwap V1 + V2 pool data for the DeFi dashboard.
//
//   Endpoints:
//     GET /saucerswap/pools  — All pool data (V1 + V2 merged, farm APR enriched)
//
//   Data pipeline:
//     1. Fetch V1 pools    → /v1/lp/allData
//     2. Fetch V2 pools    → /v2/pools/full  (fallback: /v2/pools)
//     3. Fetch V1 farm APR → /v1/lp/allFarmData
//     4. Fetch V2 farm APR → /v2/farm/allData
//     5. Merge, deduplicate, sort by TVL
//     6. Cache 60s, return
//
//   Auth: Public (read-only pool data — no mutations).
//   API key: SAUCERSWAP_API_KEY env variable — CONFIGURED.
//            Provides higher rate limits and partner attribution.
//
//   SENIOR DEV NOTE: Same API key as the client-side SAUCERSWAP_PARTNER_ID
//   in saucerswap.ts. Both locations are now configured:
//     - Supabase secret: SAUCERSWAP_API_KEY  ✓
//     - Client constant: SAUCERSWAP_PARTNER_ID in src/app/utils/saucerswap.ts  ✓
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { getClientIp, isRateLimited, ROUTE_PREFIX, saucerswapBreaker, isHttpFailure } from "./shared.ts";

// ── Constants ───────────────────────────────────────────────────────

const SS_API = "https://api.saucerswap.finance";
const CACHE_TTL_MS = 60_000;       // 60s cache
const FETCH_TIMEOUT_MS = 15_000;   // 15s per endpoint
const MIN_TVL_DISPLAY = 100;       // Hide dust pools below $100

// ── Types ───────────────────────────────────────────────────────────

interface PoolToken {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  priceUsd: number;
}

interface ParsedPool {
  id: string;
  contractId: string;
  tokenA: PoolToken;
  tokenB: PoolToken;
  tvl: number;
  volume24h: number;
  volume7d: number;
  fee: number;          // Percentage (e.g. 0.3)
  feeAPR: number;       // APR from trading fees only
  farmAPR: number;      // APR from farm/reward emissions
  totalAPR: number;     // feeAPR + farmAPR
  utilization: number;  // volume/tvl as percentage
  source: "v1" | "v2";
  trending: "up" | "down" | "stable";
}

interface CachedData {
  pools: ParsedPool[];
  stats: {
    totalTVL: number;
    totalVolume24h: number;
    avgAPR: number;
    poolCount: number;
    v1Count: number;
    v2Count: number;
    lastUpdated: number;
    fetchDurationMs: number;
  };
  ts: number;
}

// ── Cache ───────────────────────────────────────────────────────────

let _cache: CachedData | null = null;

// ── Helpers ─────────────────────────────────────────────────────────

function getApiKey(): string {
  return Deno.env.get("SAUCERSWAP_API_KEY") ?? "";
}

function safeFloat(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  return 0;
}

async function ssFetch(path: string): Promise<any | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = getApiKey();
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const res = await saucerswapBreaker.call(
      () => fetch(SS_API + path, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
      isHttpFailure,
    );
    if (!res.ok) {
      console.log(`[SS-Pools] ${path} → HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    if (err?.code === "CIRCUIT_OPEN") {
      console.log(`[SS-Pools] ${path} → circuit breaker OPEN`);
    } else {
      console.log(`[SS-Pools] ${path} → ${err?.message || err}`);
    }
    return null;
  }
}

/**
 * Normalize fee value from various API formats to a human-readable percentage.
 *
 *   3000000  → 0.3%  (millionths — V2 "fee" field)
 *   10000    → 1.0%  (basis points × 100 — some V2 representations)
 *   3000     → 0.3%  (hundredths of a bip — V2 standard)
 *   30       → 0.3%  (V1 convention: fee/100 = percentage)
 *   0.3      → 0.3%  (already a percentage)
 */
function normalizeFee(raw: number): number {
  if (raw >= 100000) return raw / 1_000_000;  // Millionths
  if (raw >= 10000) return raw / 10_000;       // High basis points
  if (raw >= 100) return raw / 10_000;          // Standard basis points
  if (raw > 1) return raw / 100;                // V1 convention
  return raw;                                    // Already percentage
}

function extractArray(data: any): any[] {
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

// ── Token logo resolution ───────────────────────────────────────────

const KNOWN_LOGOS: Record<string, string> = {
  HBAR:    "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  WHBAR:   "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  USDC:    "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  USDT:    "https://assets.coingecko.com/coins/images/325/large/Tether.png",
  WBTC:    "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  WETH:    "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  LINK:    "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  SAUCE:   "https://www.saucerswap.finance/images/tokens/sauce.svg",
  HBARX:   "https://www.saucerswap.finance/images/tokens/hbarx.svg",
  KARATE:  "https://www.saucerswap.finance/images/tokens/karate.svg",
  PACK:    "https://www.saucerswap.finance/images/tokens/pack.svg",
  HST:     "https://www.saucerswap.finance/images/tokens/hst.svg",
  DOVU:    "https://www.saucerswap.finance/images/tokens/dovu.svg",
  AAVE:    "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png",
  DAI:     "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
  // [C36-04] HBAR.ħ protocol token — SaucerSwap API may use various symbol names
  "HBAR.ħ": "https://www.saucerswap.finance/images/tokens/hbar.h.svg",
  "HBAR.h": "https://www.saucerswap.finance/images/tokens/hbar.h.svg",
};

function resolveIcon(symbol: string, apiIcon?: string): string {
  const cleaned = symbol.replace("[hts]", "").replace("[HTS]", "");
  // [C22-01] WHBAR → HBAR display: resolve icon under both names
  if (KNOWN_LOGOS[symbol]) return KNOWN_LOGOS[symbol];
  if (KNOWN_LOGOS[cleaned]) return KNOWN_LOGOS[cleaned];
  if (apiIcon) {
    if (apiIcon.startsWith("http")) return apiIcon;
    return `https://www.saucerswap.finance${apiIcon}`;
  }
  return `https://www.saucerswap.finance/images/tokens/${cleaned.toLowerCase()}.svg`;
}

// ── Pool Token Parser ───────────────────────────────────────────────

// ┌─────────────────────────────────────────────────────────────────────┐
// │  [C22-01] WHBAR → HBAR Display Normalization                       │
// │  SaucerSwap pools use WHBAR (wrapped HBAR) on-chain because HTS    │
// │  DEXes require an ERC-20 compatible token, not native hbar.        │
// │  WRAPpDEX auto-wraps/unwraps HBAR transparently, so pool displays │
// │  show "HBAR" to users instead of the internal "WHBAR" wrapper.     │
// │  The underlying token IDs and contract addresses remain unchanged. │
// └─────────────────────────────────────────────────────────────────────┘
const WHBAR_TOKEN_ID = "0.0.1456986";
// [C36-04] HBAR.ħ protocol token HTS ID — normalize API variants to canonical symbol
const HBARH_TOKEN_ID = "0.0.9356476";

function normalizeTokenDisplay(token: PoolToken): PoolToken {
  if (token.symbol === "WHBAR" || token.id === WHBAR_TOKEN_ID) {
    return { ...token, symbol: "HBAR", name: "HBAR" };
  }
  // [C36-04] Normalize HBAR.ħ variants — SaucerSwap API may return "HBAR.h",
  // "HBARh", or other variations. Map all to canonical "HBAR.ħ" so the client
  // resolvePoolToken() can match it to our registered token.
  const upper = token.symbol.toUpperCase().replace("[HTS]", "").replace("[hts]", "");
  if (upper === "HBAR.H" || upper === "HBARH" || upper === "HBAR.Ħ" || token.id === HBARH_TOKEN_ID) {
    return { ...token, symbol: "HBAR.ħ", name: "HBAR.ħ Protocol" };
  }
  // Strip [hts] suffix from SaucerSwap API symbols (e.g. "WBTC[hts]" → "WBTC")
  const cleaned = token.symbol.replace("[hts]", "").replace("[HTS]", "");
  if (cleaned !== token.symbol) {
    return { ...token, symbol: cleaned };
  }
  return token;
}

function parseToken(raw: any): PoolToken {
  return {
    id: raw?.id || raw?.tokenId || raw?.token_id || "",
    symbol: raw?.symbol || raw?.name || "???",
    name: raw?.name || raw?.symbol || "Unknown",
    decimals: safeFloat(raw?.decimals) || 8,
    icon: resolveIcon(raw?.symbol || "", raw?.icon || raw?.image),
    priceUsd: safeFloat(raw?.priceUsd || raw?.price),
  };
}

// ── V1 Pool Parser ──────────────────────────────────────────────────

function parseV1Pool(raw: any, farmAPRMap: Map<string, number>): ParsedPool | null {
  try {
    const tA = parseToken(raw.tokenA || raw.token0 || {});
    const tB = parseToken(raw.tokenB || raw.token1 || {});

    const tvl = safeFloat(raw.tvl ?? raw.liquidity ?? raw.liquidityUsd ?? raw.totalLiquidity ?? 0);
    if (tvl < MIN_TVL_DISPLAY) return null;

    const vol24 = safeFloat(raw.volume24h ?? raw.volume24Hr ?? raw.dailyVolume ?? 0);
    const vol7d = safeFloat(raw.volume7d ?? raw.weeklyVolume ?? 0);

    const feeRaw = safeFloat(raw.fee ?? raw.lpFee ?? raw.feeRate ?? raw.lpFeeRate ?? 0);
    const fee = normalizeFee(feeRaw);

    // Fee-based APR (from trading fees alone)
    let feeAPR = safeFloat(raw.apr ?? raw.apy ?? 0);
    if (feeAPR <= 0 && tvl > 0 && fee > 0) {
      feeAPR = (vol24 * (fee / 100) * 365) / tvl * 100;
    }

    // Farm reward APR (from SAUCE/HBAR emissions)
    const contractId = raw.contractId || raw.id?.toString() || raw.pairAddress || "";
    const numId = raw.id?.toString() || contractId;
    const farmAPR = farmAPRMap.get(contractId) ?? farmAPRMap.get(numId) ?? 0;

    const utilization = tvl > 0 ? Math.min((vol24 / tvl) * 100, 100) : 0;

    return {
      id: contractId || `v1-${tA.symbol}-${tB.symbol}`,
      contractId,
      tokenA: normalizeTokenDisplay(tA),
      tokenB: normalizeTokenDisplay(tB),
      tvl,
      volume24h: vol24,
      volume7d: vol7d,
      fee: Math.round(fee * 10000) / 10000,
      feeAPR: Math.round(feeAPR * 10) / 10,
      farmAPR: Math.round(farmAPR * 10) / 10,
      totalAPR: Math.round((feeAPR + farmAPR) * 10) / 10,
      utilization: Math.round(utilization * 10) / 10,
      source: "v1",
      trending: vol24 > tvl * 0.15 ? "up" : vol24 < tvl * 0.03 ? "down" : "stable",
    };
  } catch (err) {
    console.log(`[SS-Pools] V1 parse error: ${(err as Error).message}`);
    return null;
  }
}

// ── V2 Pool Parser ──────────────────────────────────────────────────

function parseV2Pool(raw: any, farmAPRMap: Map<string, number>): ParsedPool | null {
  try {
    // V2 uses token0/token1 (UniswapV3 convention)
    const tA = parseToken(raw.tokenA || raw.token0 || {});
    const tB = parseToken(raw.tokenB || raw.token1 || {});

    const tvl = safeFloat(raw.tvl ?? raw.tvlUsd ?? raw.liquidity ?? raw.liquidityUsd ?? 0);
    if (tvl < MIN_TVL_DISPLAY) return null;

    const vol24 = safeFloat(raw.volume24h ?? raw.volume24hUsd ?? raw.dailyVolume ?? 0);
    const vol7d = safeFloat(raw.volume7d ?? raw.weeklyVolume ?? 0);

    // V2 fee is typically in hundredths of a bip (3000 = 0.3%)
    const feeRaw = safeFloat(raw.fee ?? raw.feeTier ?? 0);
    const fee = normalizeFee(feeRaw);

    let feeAPR = safeFloat(raw.apr ?? raw.apy ?? raw.feeApr ?? 0);
    if (feeAPR <= 0 && tvl > 0 && fee > 0) {
      feeAPR = (vol24 * (fee / 100) * 365) / tvl * 100;
    }

    const contractId = raw.contractId || raw.id?.toString() || raw.poolAddress || "";
    const numId = raw.id?.toString() || contractId;
    const farmAPR = farmAPRMap.get(contractId) ?? farmAPRMap.get(numId) ?? 0;

    const utilization = tvl > 0 ? Math.min((vol24 / tvl) * 100, 100) : 0;

    return {
      id: contractId || `v2-${tA.symbol}-${tB.symbol}-${feeRaw}`,
      contractId,
      tokenA: normalizeTokenDisplay(tA),
      tokenB: normalizeTokenDisplay(tB),
      tvl,
      volume24h: vol24,
      volume7d: vol7d,
      fee: Math.round(fee * 10000) / 10000,
      feeAPR: Math.round(feeAPR * 10) / 10,
      farmAPR: Math.round(farmAPR * 10) / 10,
      totalAPR: Math.round((feeAPR + farmAPR) * 10) / 10,
      utilization: Math.round(utilization * 10) / 10,
      source: "v2",
      trending: vol24 > tvl * 0.15 ? "up" : vol24 < tvl * 0.03 ? "down" : "stable",
    };
  } catch (err) {
    console.log(`[SS-Pools] V2 parse error: ${(err as Error).message}`);
    return null;
  }
}

// ── Farm APR Map Builder ────────────────────────────────────────────
// SaucerSwap farm endpoints return pool → APR mappings for reward emissions.

function buildFarmAPRMap(v1Farm: any, v2Farm: any): Map<string, number> {
  const map = new Map<string, number>();

  // V1 farm data
  if (v1Farm) {
    const entries = extractArray(v1Farm);
    for (const entry of entries) {
      const poolId = entry.poolId?.toString() || entry.contractId || entry.id?.toString() || "";
      const apr = safeFloat(entry.apr ?? entry.farmApr ?? entry.rewardApr ?? entry.totalApr ?? 0);
      if (poolId && apr > 0) {
        map.set(poolId, apr);
      }
    }
  }

  // V2 farm data
  if (v2Farm) {
    const entries = extractArray(v2Farm);
    for (const entry of entries) {
      const poolId = entry.poolId?.toString() || entry.contractId || entry.id?.toString() || "";
      const apr = safeFloat(entry.apr ?? entry.farmApr ?? entry.rewardApr ?? entry.totalApr ?? 0);
      if (poolId && apr > 0) {
        // Add to existing (V2 pool might already have a fee APR)
        const existing = map.get(poolId) ?? 0;
        map.set(poolId, existing + apr);
      }
    }
  }

  return map;
}

// ── Core Fetch Logic ────────────────────────────────────────────────

async function fetchAllPools(): Promise<CachedData> {
  const t0 = Date.now();

  // Parallel fetch: V1 pools, V2 pools, V1 farm, V2 farm
  const [v1Data, v2Data, v1Farm, v2Farm] = await Promise.all([
    ssFetch("/v1/lp/allData"),
    ssFetch("/v2/pools/full").then(d => d ?? ssFetch("/v2/pools")),
    ssFetch("/v1/lp/allFarmData"),
    ssFetch("/v2/farm/allData"),
  ]);

  // Build farm APR lookup
  const farmAPRMap = buildFarmAPRMap(v1Farm, v2Farm);
  console.log(`[SS-Pools] Farm APR entries: ${farmAPRMap.size}`);

  let allPools: ParsedPool[] = [];

  // Parse V1
  if (v1Data) {
    const raw = extractArray(v1Data);
    const parsed = raw.map(r => parseV1Pool(r, farmAPRMap)).filter((p): p is ParsedPool => p !== null);
    allPools.push(...parsed);
    console.log(`[SS-Pools] V1: ${parsed.length} pools from ${raw.length} entries`);
  }

  // Parse V2
  if (v2Data) {
    const raw = extractArray(v2Data);
    const parsed = raw.map(r => parseV2Pool(r, farmAPRMap)).filter((p): p is ParsedPool => p !== null);
    allPools.push(...parsed);
    console.log(`[SS-Pools] V2: ${parsed.length} pools from ${raw.length} entries`);
  }

  // Deduplicate (prefer higher TVL if same id)
  const seen = new Map<string, ParsedPool>();
  for (const pool of allPools) {
    const existing = seen.get(pool.id);
    if (!existing || pool.tvl > existing.tvl) {
      seen.set(pool.id, pool);
    }
  }
  allPools = Array.from(seen.values());

  // Sort by TVL descending
  allPools.sort((a, b) => b.tvl - a.tvl);

  // Compute aggregates
  const totalTVL = allPools.reduce((s, p) => s + p.tvl, 0);
  const totalVolume24h = allPools.reduce((s, p) => s + p.volume24h, 0);
  const withAPR = allPools.filter(p => p.totalAPR > 0);
  const avgAPR = withAPR.length > 0
    ? withAPR.reduce((s, p) => s + p.totalAPR, 0) / withAPR.length
    : 0;

  const fetchMs = Date.now() - t0;
  const v1Count = allPools.filter(p => p.source === "v1").length;
  const v2Count = allPools.filter(p => p.source === "v2").length;

  console.log(
    `[SS-Pools] Total: ${allPools.length} pools (V1: ${v1Count}, V2: ${v2Count}), ` +
    `TVL $${(totalTVL / 1e6).toFixed(2)}M, ` +
    `24h Vol $${(totalVolume24h / 1e6).toFixed(2)}M, ` +
    `Avg APR ${avgAPR.toFixed(1)}% (${fetchMs}ms)`
  );

  return {
    pools: allPools,
    stats: {
      totalTVL,
      totalVolume24h,
      avgAPR: Math.round(avgAPR * 10) / 10,
      poolCount: allPools.length,
      v1Count,
      v2Count,
      lastUpdated: Date.now(),
      fetchDurationMs: fetchMs,
    },
    ts: Date.now(),
  };
}

// ── Route Registration ──────────────────────────────────────────────

export function registerSaucerswapPoolRoutes(app: Hono): void {

  /**
   * GET /saucerswap/pools — All SaucerSwap pool data (V1 + V2)
   *
   * Response: { pools: ParsedPool[], stats: {...} }
   *
   * Public endpoint. Rate-limited (same as other read endpoints).
   * Cached 60s server-side — reduces upstream SaucerSwap API load.
   */
  app.get(`${ROUTE_PREFIX}/saucerswap/pools`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) {
      return c.json({ error: "Rate limited" }, 429);
    }

    try {
      // Serve from cache if fresh
      if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
        return c.json({
          pools: _cache.pools,
          stats: _cache.stats,
          fromCache: true,
        });
      }

      // Fetch fresh data
      const data = await fetchAllPools();
      _cache = data;

      return c.json({
        pools: data.pools,
        stats: data.stats,
        fromCache: false,
      });
    } catch (err: any) {
      console.log(`[SS-Pools] Route error: ${err?.message || err}`);

      // Return stale cache if available
      if (_cache) {
        return c.json({
          pools: _cache.pools,
          stats: { ..._cache.stats, stale: true },
          fromCache: true,
          stale: true,
        });
      }

      return c.json({
        pools: [],
        stats: {
          totalTVL: 0,
          totalVolume24h: 0,
          avgAPR: 0,
          poolCount: 0,
          v1Count: 0,
          v2Count: 0,
          lastUpdated: Date.now(),
          fetchDurationMs: 0,
        },
        error: "SaucerSwap API temporarily unavailable",
      }, 503);
    }
  });
}
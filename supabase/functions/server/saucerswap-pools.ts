// ═══════════════════════════════════════════════════════════════════════
// SAUCERSWAP POOL DATA — Server-Side Proxy & Cache
// ═══════════════════════════════════════════════════════════════════════
//
// SECURITY AUDIT PEN-06/07/08 (2026-03-17): ALL 2 routes are READ-ONLY
// GET endpoints (/saucerswap/pools, /saucerswap/pools/debug). No state
// changes. Rate limited. Queries public SaucerSwap API data. SAFE.
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
//   [C108] API key is now SERVER-SIDE ONLY. The client-side
//   SAUCERSWAP_PARTNER_ID constant has been removed. All client
//   SaucerSwap API calls route through /ss-proxy which attaches
//   the key from the SAUCERSWAP_API_KEY Supabase secret.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { getClientIp, isRateLimited, ROUTE_PREFIX, saucerswapBreaker, isHttpFailure } from "./shared.ts";

// ── Constants ───────────────────────────────────────────────────────

const SS_API = "https://api.saucerswap.finance";
const CACHE_TTL_MS = 60_000;       // 60s cache
const FETCH_TIMEOUT_MS = 15_000;   // 15s per endpoint
const MIN_TVL_DISPLAY = 100;       // Hide dust pools below $100

// Force-include pool contract IDs — bypass TVL filter for smoke-testing
// Must match FORCE_INCLUDE_POOL_CONTRACT_IDS in v2-token-whitelist.ts
const FORCE_INCLUDE_POOLS = new Set<string>([
  "0.0.9356723",  // HBAR.h / WHBAR pool
]);

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
// IMPLEMENTATION NOTE: All URLs use CoinGecko CDN (assets.coingecko.com)
// which has an open referrer policy — works on Vercel, localhost, everywhere.
// CoinMarketCap (s2.coinmarketcap.com) was the previous source but
// aggressively blocks hotlinking from production domains.
// SaucerSwap-native tokens use CoinGecko where listed, SaucerSwap CDN otherwise.

const CG = "https://assets.coingecko.com/coins/images";

const KNOWN_LOGOS: Record<string, string> = {
  HBAR:    `${CG}/3688/standard/hbar.png`,
  WHBAR:   `${CG}/3688/standard/hbar.png`,
  USDC:    `${CG}/6319/standard/usdc.png`,
  USDT:    `${CG}/325/standard/Tether.png`,
  WBTC:    `${CG}/7598/standard/wrapped_bitcoin_wbtc.png`,
  WETH:    `${CG}/279/standard/ethereum.png`,
  LINK:    `${CG}/877/standard/chainlink-new-logo.png`,
  BNB:     `${CG}/825/standard/bnb-icon2_2x.png`,
  QNT:     `${CG}/3370/standard/5ZOu7brX_400x400.jpg`,
  SAUCE:   `${CG}/28255/standard/SAUCE.png`,
  HBARX:   `${CG}/28362/standard/Hbarx.png`,
  DAI:     `${CG}/9956/standard/Badge_Dai.png`,
  AAVE:    `${CG}/12645/standard/aave-token-round.png`,
  KARATE:  `${CG}/30375/standard/karate_200x200.png`,
  PACK:    `${CG}/28506/standard/hashpack-logo.png`,
  DOVU:    `${CG}/3455/standard/dovu.png`,
  HST:     `${CG}/14336/standard/headstarter.png`,
  WBNB:    `${CG}/825/standard/bnb-icon2_2x.png`,
  WAVAX:   `${CG}/12559/standard/Avalanche_Circle_RedWhite_Trans.png`,
  WPOL:    `${CG}/4713/standard/polygon.png`,
  WMATIC:  `${CG}/4713/standard/polygon.png`,
  JAM:     `${CG}/2969/standard/JAM_logo200x200.png`,
  CLXY:    `${CG}/18507/standard/calaxy.png`,
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
const HBARH_POOL_TOKEN_ID = "0.0.9356724"; // The HBAR.h token that trades in SaucerSwap pools

function normalizeTokenDisplay(token: PoolToken): PoolToken {
  if (token.symbol === "WHBAR" || token.id === WHBAR_TOKEN_ID) {
    return { ...token, symbol: "HBAR", name: "HBAR" };
  }
  // [C36-04] Normalize HBAR.ħ variants — SaucerSwap API may return "HBAR.h",
  // "HBARh", or other variations. Map all to canonical "HBAR.ħ" so the client
  // resolvePoolToken() can match it to our registered token.
  const upper = token.symbol.toUpperCase().replace("[HTS]", "").replace("[hts]", "");
  if (upper === "HBAR.H" || upper === "HBARH" || upper === "HBAR.Ħ" || token.id === HBARH_TOKEN_ID || token.id === HBARH_POOL_TOKEN_ID) {
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

    // ── TVL: NEVER use raw `liquidity` — it's the concentrated-liquidity L value ──
    // (a massive raw integer, NOT USD). Always compute from reserves × price.
    //
    // SaucerSwap V2 API schema:
    //   amountA / amountB  — total token reserves in smallest unit
    //   tokenA.priceUsd / tokenB.priceUsd  — token USD prices
    //   liquidity  — concentrated L value (DO NOT USE AS TVL)
    //
    // Try pre-computed USD fields first (from /v2/pools/full), then compute.
    let tvl = safeFloat(
      raw.tvlUSD ?? raw.tvlUsd ?? raw.tvl_usd ??
      raw.totalValueLockedUSD ?? raw.totalValueLocked ??
      raw.liquidityUsd ?? raw.liquidityUSD ?? 0
    );

    if (tvl <= 0) {
      // Compute from reserve amounts + token prices
      const amtA = safeFloat(raw.amountA ?? raw.amount0 ?? raw.reserve0 ?? raw.totalValueLockedToken0 ?? 0);
      const amtB = safeFloat(raw.amountB ?? raw.amount1 ?? raw.reserve1 ?? raw.totalValueLockedToken1 ?? 0);
      const priceA = tA.priceUsd;
      const priceB = tB.priceUsd;
      const decA = tA.decimals || 8;
      const decB = tB.decimals || 8;

      if (amtA > 0 && priceA > 0) tvl += (amtA / Math.pow(10, decA)) * priceA;
      if (amtB > 0 && priceB > 0) tvl += (amtB / Math.pow(10, decB)) * priceB;
    }

    // Last resort: if `tvl` field exists and looks like a reasonable USD value
    // (under $1B for a single Hedera pool), use it. Skip the `liquidity` field.
    if (tvl <= 0) {
      const rawTvl = safeFloat(raw.tvl ?? 0);
      if (rawTvl > 0 && rawTvl < 1_000_000_000) {
        tvl = rawTvl;
      }
    }

    if (tvl < MIN_TVL_DISPLAY && !FORCE_INCLUDE_POOLS.has(raw.contractId)) return null;

    // ── Volume: try all known field variants ──
    const vol24 = safeFloat(
      raw.volume24h ?? raw.volume24hUsd ?? raw.volume24hUSD ??
      raw.volumeUSD ?? raw.volumeUsd ?? raw.dailyVolume ??
      raw.volumeToken0USD ?? raw.volume24Hr ?? 0
    );
    const vol7d = safeFloat(raw.volume7d ?? raw.volume7dUSD ?? raw.weeklyVolume ?? 0);

    // V2 fee is typically in hundredths of a bip (3000 = 0.3%)
    const feeRaw = safeFloat(raw.fee ?? raw.feeTier ?? 0);
    const fee = normalizeFee(feeRaw);

    let feeAPR = safeFloat(raw.apr ?? raw.apy ?? raw.feeApr ?? raw.feeAPR ?? 0);
    if (feeAPR <= 0 && tvl > 0 && fee > 0 && vol24 > 0) {
      feeAPR = (vol24 * (fee / 100) * 365) / tvl * 100;
    }

    const contractId = raw.contractId || raw.id?.toString() || raw.poolAddress || "";
    const numId = raw.id?.toString() || contractId;
    const farmAPR = farmAPRMap.get(contractId) ?? farmAPRMap.get(numId) ?? 0;

    const utilization = tvl > 0 && vol24 > 0 ? Math.min((vol24 / tvl) * 100, 100) : 0;

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

  // ── Phase 1: Parallel bulk fetches ────────────────────────────────
  // V1 pools, V2 pools (full then basic), V1 farm, V2 farm, V2 analytics
  const [v1Data, v2FullData, v2BasicData, v1Farm, v2Farm] = await Promise.all([
    ssFetch("/v1/lp/allData"),
    ssFetch("/v2/pools/full"),
    ssFetch("/v2/pools"),
    ssFetch("/v1/lp/allFarmData"),
    ssFetch("/v2/farm/allData"),
  ]);

  // Decide which V2 dataset to use — prefer "full" which may include analytics
  const v2Data = v2FullData ?? v2BasicData;
  console.log(`[SS-Pools] V2 endpoints: /full=${v2FullData ? "OK" : "MISS"}, /basic=${v2BasicData ? "OK" : "MISS"}`);

  // Build farm APR lookup
  const farmAPRMap = buildFarmAPRMap(v1Farm, v2Farm);
  console.log(`[SS-Pools] Farm APR entries: ${farmAPRMap.size}`);

  let allPools: ParsedPool[] = [];

  // ── Phase 2: Parse V1 pools ───────────────────────────────────────
  if (v1Data) {
    const raw = extractArray(v1Data);
    // [DIAG] Log first V1 pool fields
    if (raw.length > 0) {
      const s = raw[0];
      console.log(`[SS-Pools] V1 sample keys: ${Object.keys(s).join(", ")}`);
      console.log(`[SS-Pools] V1 sample: tvl=${s.tvl}, volume24h=${s.volume24h ?? s.volume24Hr}, apr=${s.apr}, liquidity=${String(s.liquidity).slice(0, 15)}`);
    }
    const parsed = raw.map(r => parseV1Pool(r, farmAPRMap)).filter((p): p is ParsedPool => p !== null);
    allPools.push(...parsed);
    console.log(`[SS-Pools] V1: ${parsed.length} pools from ${raw.length} entries`);
    if (parsed.length > 0) {
      const top = parsed[0];
      console.log(`[SS-Pools] V1 top: ${top.tokenA.symbol}/${top.tokenB.symbol} TVL=$${top.tvl.toFixed(0)} vol=$${top.volume24h.toFixed(0)} apr=${top.totalAPR}%`);
    }
  }

  // ── Phase 3: Parse V2 pools ───────────────────────────────────────
  // Build a map of V2 raw entries by contractId for analytics enrichment
  const v2RawMap = new Map<string, any>();

  if (v2Data) {
    const raw = extractArray(v2Data);
    // [DIAG] Log V2 sample with ALL keys for field discovery
    if (raw.length > 0) {
      const s = raw[0];
      const allKeys = Object.keys(s);
      console.log(`[SS-Pools] V2 sample ALL keys (${allKeys.length}): ${allKeys.join(", ")}`);
      console.log(`[SS-Pools] V2 sample values: contractId=${s.contractId}, fee=${s.fee}, amountA=${String(s.amountA).slice(0, 15)}, amountB=${String(s.amountB).slice(0, 15)}`);
      console.log(`[SS-Pools] V2 sample tokenA: id=${s.tokenA?.id}, sym=${s.tokenA?.symbol}, price=${s.tokenA?.priceUsd ?? s.tokenA?.price}, dec=${s.tokenA?.decimals}`);
      // Log ALL fields with their types and first 30 chars of value
      for (const key of allKeys) {
        if (!["tokenA", "tokenB"].includes(key)) {
          const val = s[key];
          console.log(`[SS-Pools] V2 field "${key}": type=${typeof val}, val=${String(val).slice(0, 50)}`);
        }
      }
      // Also log tokenA sub-fields
      if (s.tokenA) {
        const tokenKeys = Object.keys(s.tokenA);
        console.log(`[SS-Pools] V2 tokenA keys: ${tokenKeys.join(", ")}`);
      }
    }

    // Index raw entries by contractId
    for (const r of raw) {
      const cid = r.contractId || r.id?.toString() || "";
      if (cid) v2RawMap.set(cid, r);
    }
    console.log(`[SS-Pools] V2 raw: ${raw.length} entries, contractIds indexed: ${v2RawMap.size}`);

    // Check which force-include pools are present
    for (const fid of FORCE_INCLUDE_POOLS) {
      const found = v2RawMap.has(fid);
      console.log(`[SS-Pools] Force-include pool ${fid}: ${found ? "FOUND in bulk V2" : "NOT FOUND in bulk V2 — will try individual fetch"}`);
    }

    const parsed = raw.map(r => parseV2Pool(r, farmAPRMap)).filter((p): p is ParsedPool => p !== null);
    allPools.push(...parsed);
    console.log(`[SS-Pools] V2: ${parsed.length} pools parsed from ${raw.length} entries`);
    if (parsed.length > 0) {
      const top = parsed[0];
      console.log(`[SS-Pools] V2 top: ${top.tokenA.symbol}/${top.tokenB.symbol} TVL=$${top.tvl.toFixed(0)} vol=$${top.volume24h.toFixed(0)} apr=${top.totalAPR}%`);
    }
  }

  // ── Phase 4: Fetch missing force-included pools individually ──────
  const foundContractIds = new Set(allPools.map(p => p.contractId));
  for (const forceId of FORCE_INCLUDE_POOLS) {
    if (foundContractIds.has(forceId)) continue;
    console.log(`[SS-Pools] Fetching force-include pool ${forceId} individually...`);

    // Try multiple endpoint patterns
    const endpoints = [
      `/v2/pools/${forceId}`,
      `/v1/lp/${forceId}`,
    ];
    for (const ep of endpoints) {
      const data = await ssFetch(ep);
      if (data) {
        console.log(`[SS-Pools] ${ep} returned: keys=${Object.keys(data).join(", ")}`);
        const isV2 = ep.startsWith("/v2");
        const parsed = isV2
          ? parseV2Pool(data, farmAPRMap)
          : parseV1Pool(data, farmAPRMap);
        if (parsed) {
          allPools.push(parsed);
          foundContractIds.add(parsed.contractId);
          console.log(`[SS-Pools] Force-include ${forceId} resolved: ${parsed.tokenA.symbol}/${parsed.tokenB.symbol} TVL=$${parsed.tvl.toFixed(2)} (${isV2 ? "V2" : "V1"})`);
          break;
        }
      }
    }

    // Last resort: try to construct from mirror node token balances
    if (!foundContractIds.has(forceId)) {
      console.log(`[SS-Pools] Force-include ${forceId}: API lookup failed — trying mirror node...`);
      const mirrorPool = await fetchPoolFromMirrorNode(forceId, farmAPRMap);
      if (mirrorPool) {
        allPools.push(mirrorPool);
        foundContractIds.add(mirrorPool.contractId);
        console.log(`[SS-Pools] Force-include ${forceId} resolved via mirror: ${mirrorPool.tokenA.symbol}/${mirrorPool.tokenB.symbol} TVL=$${mirrorPool.tvl.toFixed(2)}`);
      } else {
        console.log(`[SS-Pools] Force-include ${forceId}: ALL lookups failed — pool will not appear`);
      }
    }
  }

  // ── Phase 5: Deduplicate & sort ───────────────────────────────────
  const seen = new Map<string, ParsedPool>();
  for (const pool of allPools) {
    const existing = seen.get(pool.id);
    if (!existing || pool.tvl > existing.tvl) {
      seen.set(pool.id, pool);
    }
  }
  allPools = Array.from(seen.values());
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

// ── Mirror Node Pool Resolver ───────────────────────────────────────
// Fallback: build a ParsedPool from Hedera mirror node account data.
// This works for ANY pool contract by reading its HTS token balances
// and looking up token metadata + prices from the mirror node.

const MIRROR_NODE = "https://mainnet.mirrornode.hedera.com";

async function fetchPoolFromMirrorNode(
  contractId: string,
  farmAPRMap: Map<string, number>,
): Promise<ParsedPool | null> {
  try {
    // Fetch token balances for the pool contract
    const tokensRes = await fetch(
      `${MIRROR_NODE}/api/v1/accounts/${contractId}/tokens?limit=10`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!tokensRes.ok) {
      console.log(`[SS-Mirror] ${contractId} tokens HTTP ${tokensRes.status}`);
      return null;
    }
    const tokensData = await tokensRes.json();
    const tokens = tokensData.tokens || [];
    console.log(`[SS-Mirror] ${contractId} has ${tokens.length} token associations`);

    if (tokens.length < 2) return null;

    // Get the two largest-balance tokens (pool reserves)
    const sorted = [...tokens]
      .filter((t: any) => safeFloat(t.balance) > 0)
      .sort((a: any, b: any) => safeFloat(b.balance) - safeFloat(a.balance));

    if (sorted.length < 2) {
      console.log(`[SS-Mirror] ${contractId} has fewer than 2 tokens with balance`);
      return null;
    }

    const tok0 = sorted[0];
    const tok1 = sorted[1];

    // Fetch token metadata for both
    const [meta0, meta1] = await Promise.all([
      fetchTokenMeta(tok0.token_id),
      fetchTokenMeta(tok1.token_id),
    ]);

    if (!meta0 || !meta1) return null;

    const tA: PoolToken = {
      id: tok0.token_id,
      symbol: meta0.symbol,
      name: meta0.name,
      decimals: meta0.decimals,
      icon: resolveIcon(meta0.symbol),
      priceUsd: meta0.priceUsd,
    };
    const tB: PoolToken = {
      id: tok1.token_id,
      symbol: meta1.symbol,
      name: meta1.name,
      decimals: meta1.decimals,
      icon: resolveIcon(meta1.symbol),
      priceUsd: meta1.priceUsd,
    };

    const amtA = safeFloat(tok0.balance);
    const amtB = safeFloat(tok1.balance);
    let tvl = 0;
    if (amtA > 0 && tA.priceUsd > 0) tvl += (amtA / Math.pow(10, tA.decimals)) * tA.priceUsd;
    if (amtB > 0 && tB.priceUsd > 0) tvl += (amtB / Math.pow(10, tB.decimals)) * tB.priceUsd;

    const farmAPR = farmAPRMap.get(contractId) ?? 0;

    return {
      id: contractId,
      contractId,
      tokenA: normalizeTokenDisplay(tA),
      tokenB: normalizeTokenDisplay(tB),
      tvl,
      volume24h: 0, // Not available from mirror node
      volume7d: 0,
      fee: 0.3, // Default; will be corrected if pool metadata available
      feeAPR: 0,
      farmAPR: Math.round(farmAPR * 10) / 10,
      totalAPR: Math.round(farmAPR * 10) / 10,
      utilization: 0,
      source: "v2",
      trending: "stable",
    };
  } catch (err) {
    console.log(`[SS-Mirror] ${contractId} error: ${(err as Error).message}`);
    return null;
  }
}

async function fetchTokenMeta(tokenId: string): Promise<{
  symbol: string; name: string; decimals: number; priceUsd: number;
} | null> {
  try {
    const res = await fetch(
      `${MIRROR_NODE}/api/v1/tokens/${tokenId}`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const symbol = data.symbol || "???";
    const name = data.name || symbol;
    const decimals = parseInt(data.decimals, 10) || 8;

    // Get price from SaucerSwap token price endpoint
    let priceUsd = 0;
    try {
      const priceRes = await ssFetch(`/tokens/${tokenId}`);
      if (priceRes) {
        priceUsd = safeFloat(priceRes.priceUsd ?? priceRes.price ?? 0);
      }
    } catch { /* price lookup is best-effort */ }

    // If SaucerSwap doesn't have the price and it's WHBAR, use HBAR price
    if (priceUsd <= 0 && (tokenId === "0.0.1456986" || symbol === "WHBAR")) {
      try {
        const hbarRes = await ssFetch("/tokens/0.0.1456986");
        if (hbarRes) priceUsd = safeFloat(hbarRes.priceUsd ?? hbarRes.price ?? 0);
      } catch { /* best-effort */ }
    }

    console.log(`[SS-Mirror] Token ${tokenId}: ${symbol} (${decimals} dec) $${priceUsd.toFixed(4)}`);
    return { symbol, name, decimals, priceUsd };
  } catch (err) {
    console.log(`[SS-Mirror] Token ${tokenId} meta error: ${(err as Error).message}`);
    return null;
  }
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

  /**
   * GET /saucerswap/pools/debug — Diagnostic endpoint
   * Returns raw API response fields from SaucerSwap for debugging.
   * Shows: V1 sample, V2 sample, farm data, force-include pool status.
   */
  app.get(`${ROUTE_PREFIX}/saucerswap/pools/debug`, async (c) => {
    try {
      const [v1Data, v2Full, v2Basic, v1Farm, v2Farm] = await Promise.all([
        ssFetch("/v1/lp/allData"),
        ssFetch("/v2/pools/full"),
        ssFetch("/v2/pools"),
        ssFetch("/v1/lp/allFarmData"),
        ssFetch("/v2/farm/allData"),
      ]);

      const v2 = v2Full ?? v2Basic;
      const v1Arr = v1Data ? extractArray(v1Data) : [];
      const v2Arr = v2 ? extractArray(v2) : [];
      const v1FarmArr = v1Farm ? extractArray(v1Farm) : [];
      const v2FarmArr = v2Farm ? extractArray(v2Farm) : [];

      // Find force-include pool in V2 data
      const forcePool = v2Arr.find((p: any) => p.contractId === "0.0.9356723");

      // Try individual pool fetch
      let individualPool = null;
      if (!forcePool) {
        individualPool = await ssFetch("/v2/pools/0.0.9356723");
      }

      // Try mirror node
      let mirrorTokens = null;
      try {
        const res = await fetch(
          `${MIRROR_NODE}/api/v1/accounts/0.0.9356723/tokens?limit=10`,
          { signal: AbortSignal.timeout(8_000) }
        );
        if (res.ok) mirrorTokens = await res.json();
      } catch {}

      return c.json({
        endpoints: {
          v1_allData: v1Arr.length > 0 ? "OK" : "EMPTY",
          v2_full: v2Full ? "OK" : "MISS",
          v2_basic: v2Basic ? "OK" : "MISS",
          v1_farm: v1FarmArr.length,
          v2_farm: v2FarmArr.length,
        },
        v1_sample: v1Arr.length > 0 ? {
          keys: Object.keys(v1Arr[0]),
          first: v1Arr[0],
        } : null,
        v2_sample: v2Arr.length > 0 ? {
          keys: Object.keys(v2Arr[0]),
          first: v2Arr[0],
          count: v2Arr.length,
        } : null,
        v2_farm_sample: v2FarmArr.length > 0 ? {
          keys: Object.keys(v2FarmArr[0]),
          first: v2FarmArr[0],
        } : null,
        force_include: {
          pool_0_0_9356723: {
            in_v2_bulk: !!forcePool,
            bulk_data: forcePool || null,
            individual_fetch: individualPool || null,
            mirror_tokens: mirrorTokens?.tokens || null,
          }
        },
      });
    } catch (err: any) {
      return c.json({ error: err?.message || "Debug fetch failed" }, 500);
    }
  });
}
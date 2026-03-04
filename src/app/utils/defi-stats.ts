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
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { FORCE_INCLUDE_POOL_CONTRACT_IDS } from "./v2-token-whitelist";
import { getReliableIconUrl, getReliableIconBySymbol } from "./token-icons";

// ── Types ────────────────────────────────────────���─────────────────

export interface LivePool {
  id: string;
  tokenA: { symbol: string; name: string; logo: string; htsId: string; decimals: number };
  tokenB: { symbol: string; name: string; logo: string; htsId: string; decimals: number };
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
// IMPLEMENTATION NOTE: All URLs use CoinGecko CDN (assets.coingecko.com)
// which does NOT block hotlinking from Vercel/production domains.
// CoinMarketCap (s2.coinmarketcap.com) was the previous source but
// aggressively blocks external referrers, breaking icons on deployment.

const CG = "https://assets.coingecko.com/coins/images";

const TOKEN_LOGOS: Record<string, string> = {
  HBAR:        `${CG}/3688/standard/hbar.png`,
  WHBAR:       `${CG}/3688/standard/hbar.png`,
  USDC:        `${CG}/6319/standard/usdc.png`,
  USDT:        `${CG}/325/standard/Tether.png`,
  WBTC:        `${CG}/7598/standard/wrapped_bitcoin_wbtc.png`,
  "WBTC[hts]": `${CG}/7598/standard/wrapped_bitcoin_wbtc.png`,
  WETH:        `${CG}/279/standard/ethereum.png`,
  "WETH[hts]": `${CG}/279/standard/ethereum.png`,
  LINK:        `${CG}/877/standard/chainlink-new-logo.png`,
  "LINK[hts]": `${CG}/877/standard/chainlink-new-logo.png`,
  BNB:         `${CG}/825/standard/bnb-icon2_2x.png`,
  "BNB[hts]":  `${CG}/825/standard/bnb-icon2_2x.png`,
  QNT:         `${CG}/3370/standard/5ZOu7brX_400x400.jpg`,
  "QNT[hts]":  `${CG}/3370/standard/5ZOu7brX_400x400.jpg`,
  SAUCE:       `${CG}/28255/standard/SAUCE.png`,
  HBARX:       `${CG}/28362/standard/Hbarx.png`,
  KARATE:      `${CG}/30375/standard/karate_200x200.png`,
  PACK:        `${CG}/28506/standard/hashpack-logo.png`,
  DOVU:        `${CG}/3455/standard/dovu.png`,
  HST:         `${CG}/14336/standard/headstarter.png`,
  DAI:         `${CG}/9956/standard/Badge_Dai.png`,
  AAVE:        `${CG}/12645/standard/aave-token-round.png`,
  DOT:         `${CG}/12171/standard/polkadot.png`,
  WBNB:        `${CG}/825/standard/bnb-icon2_2x.png`,
  WAVAX:       `${CG}/12559/standard/Avalanche_Circle_RedWhite_Trans.png`,
  WPOL:        `${CG}/4713/standard/polygon.png`,
  WMATIC:      `${CG}/4713/standard/polygon.png`,
  JAM:         `${CG}/2969/standard/JAM_logo200x200.png`,
  CLXY:        `${CG}/18507/standard/calaxy.png`,
  "HBAR.h":    `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#0a0e1a" stroke="#1D63ED" stroke-width="3"/><text x="50" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="58" font-weight="700" fill="#1D63ED">' + "\u0127" + '</text></svg>')}`,
  "HBAR.\u0127":  `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#0a0e1a" stroke="#1D63ED" stroke-width="3"/><text x="50" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="58" font-weight="700" fill="#1D63ED">' + "\u0127" + '</text></svg>')}`,
};

function resolveTokenLogo(symbol: string, apiIcon?: string): string {
  const cleaned = symbol.replace("[hts]", "").replace("[HTS]", "");
  // 1. Check hardcoded CoinGecko URLs (most reliable)
  if (TOKEN_LOGOS[symbol]) return TOKEN_LOGOS[symbol];
  if (TOKEN_LOGOS[cleaned]) return TOKEN_LOGOS[cleaned];
  // 2. Check centralized reliable icon map by symbol
  const reliable = getReliableIconBySymbol(symbol) || getReliableIconBySymbol(cleaned);
  if (reliable) return reliable;
  // 3. Use API-provided icon URL
  if (apiIcon) {
    if (apiIcon.startsWith("http")) return apiIcon;
    return `https://www.saucerswap.finance${apiIcon}`;
  }
  // 4. SaucerSwap CDN fallback by symbol
  return `https://www.saucerswap.finance/images/tokens/${cleaned.toLowerCase()}.svg`;
}

// ┌─────────────────────────────────────────────────────────────────────┐
// │  [C22-01] WHBAR → HBAR Display Normalization                       │
// │  SaucerSwap pools use WHBAR on-chain; WRAPpDEX auto-wraps, so      │
// │  display "HBAR" to users. Token IDs remain unchanged internally.   │
// └─────────────────────────────────────────────────────────────────────┘
const WHBAR_TOKEN_ID = "0.0.1456986";

function normalizeSymbolForDisplay(symbol: string, htsId?: string): string {
  if (symbol === "WHBAR" || htsId === WHBAR_TOKEN_ID) return "HBAR";
  // Normalize HBAR.ħ unicode variant → HBAR.h
  if (symbol === "HBAR.ħ" || symbol === "HBAR.H" || symbol === "hbar.h") return "HBAR.h";
  // Strip [hts] suffix from SaucerSwap API symbols
  return symbol.replace("[hts]", "").replace("[HTS]", "");
}

function normalizeNameForDisplay(name: string, symbol: string, htsId?: string): string {
  if (symbol === "WHBAR" || htsId === WHBAR_TOKEN_ID) return "HBAR";
  if (symbol === "HBAR.ħ" || symbol === "HBAR.h" || symbol === "HBAR.H") return "HBAR.h Protocol";
  return name;
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
// [C108] API key removed from client-side. This fallback path uses
// the server proxy (which attaches the key), with a direct
// unauthenticated fallback if the proxy is unreachable.

const SS_PROXY_URL = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/ss-proxy`;

async function ssFetch(path: string): Promise<any | null> {
  // Strategy 1: Server proxy (has API key)
  try {
    const proxyUrl = `${SS_PROXY_URL}?path=${encodeURIComponent(path)}`;
    const res = await fetch(proxyUrl, {
      headers: {
        Authorization: `Bearer ${publicAnonKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) return await res.json();
    log.warn("DeFiStats", `SaucerSwap ${path} proxy → HTTP ${res.status}`);
  } catch (err: any) {
    log.warn("DeFiStats", `SaucerSwap ${path} proxy → ${err?.message || err}`);
  }

  // Strategy 2: Direct SaucerSwap (no API key — public rate limits)
  try {
    const res = await fetch(SAUCERSWAP_API + path, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn("DeFiStats", `SaucerSwap ${path} direct → HTTP ${res.status}`);
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

    // Token decimals — used for TVL computation and passed through to LivePool
    const decA = safeFloat(tA.decimals ?? 8);
    const decB = safeFloat(tB.decimals ?? 8);

    // ── TVL: check pre-computed USD first, sanity-check raw `liquidity` ──
    // V1 API's `liquidity` may be the LP token total supply or raw reserve
    // value, not USD. Only use it if it looks like a plausible USD amount
    // (under $1B for a single pool on Hedera).
    let tvl = safeFloat(
      raw.tvlUsd ?? raw.tvlUSD ?? raw.liquidityUsd ?? raw.liquidityUSD ?? 0
    );
    if (tvl <= 0) {
      const rawTvl = safeFloat(raw.tvl ?? raw.totalLiquidity ?? 0);
      if (rawTvl > 0 && rawTvl < 1_000_000_000) {
        tvl = rawTvl;
      }
    }
    // Last resort: compute from reserves + prices
    if (tvl <= 0) {
      const priceA = safeFloat(tA.priceUsd ?? tA.price ?? 0);
      const priceB = safeFloat(tB.priceUsd ?? tB.price ?? 0);
      const resA = safeFloat(raw.reserveA ?? raw.reserve0 ?? raw.tokenAAmount ?? 0);
      const resB = safeFloat(raw.reserveB ?? raw.reserve1 ?? raw.tokenBAmount ?? 0);
      if (resA > 0 && priceA > 0) tvl += (resA / Math.pow(10, decA)) * priceA;
      if (resB > 0 && priceB > 0) tvl += (resB / Math.pow(10, decB)) * priceB;
    }
    if (tvl < MIN_TVL_DISPLAY) return null;

    const vol24 = safeFloat(
      raw.volume24h ?? raw.volume24Hr ?? raw.volume24hUsd ?? raw.volume24hUSD ??
      raw.volumeUSD ?? raw.dailyVolume ?? 0
    );
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
        symbol: normalizeSymbolForDisplay(symA, tA.id),
        name: normalizeNameForDisplay(tA.name || symA, symA, tA.id),
        logo: resolveTokenLogo(symA, tA.icon ?? tA.image),
        htsId: tA.id || tA.tokenId || "",
        decimals: decA,
      },
      tokenB: {
        symbol: normalizeSymbolForDisplay(symB, tB.id),
        name: normalizeNameForDisplay(tB.name || symB, symB, tB.id),
        logo: resolveTokenLogo(symB, tB.icon ?? tB.image),
        htsId: tB.id || tB.tokenId || "",
        decimals: decB,
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

    // Token decimals — used for TVL computation and passed through to LivePool
    const decA = safeFloat(tA.decimals ?? 8);
    const decB = safeFloat(tB.decimals ?? 8);

    // ── TVL: try pre-computed USD fields first, NEVER use raw `liquidity` ──
    // The V2 API's `liquidity` field is the concentrated-liquidity L value
    // (a massive raw integer), NOT a USD amount. Using it directly produces
    // TVL values in the trillions. Instead, compute TVL from token reserves
    // and prices when the API doesn't provide a pre-computed USD field.
    let tvl = safeFloat(
      raw.tvlUSD ?? raw.tvlUsd ?? raw.tvl_usd ??
      raw.totalValueLockedUSD ?? raw.totalValueLocked ??
      raw.liquidityUsd ?? raw.liquidityUSD ?? 0
    );

    // If no pre-computed TVL, compute from token amounts + prices
    if (tvl <= 0) {
      const priceA = safeFloat(tA.priceUsd ?? tA.price ?? 0);
      const priceB = safeFloat(tB.priceUsd ?? tB.price ?? 0);

      // Try totalValueLockedToken fields (raw smallest-unit amounts)
      const tvlToken0 = safeFloat(raw.totalValueLockedToken0 ?? raw.tvlToken0 ?? raw.amountA ?? raw.amount0 ?? raw.reserve0 ?? 0);
      const tvlToken1 = safeFloat(raw.totalValueLockedToken1 ?? raw.tvlToken1 ?? raw.amountB ?? raw.amount1 ?? raw.reserve1 ?? 0);

      if (tvlToken0 > 0 && priceA > 0) tvl += (tvlToken0 / Math.pow(10, decA)) * priceA;
      if (tvlToken1 > 0 && priceB > 0) tvl += (tvlToken1 / Math.pow(10, decB)) * priceB;

      // Last resort: try the `tvl` field but check if it's a reasonable USD value
      // (under $1B — SaucerSwap total TVL is ~$50-100M)
      if (tvl <= 0) {
        const rawTvl = safeFloat(raw.tvl ?? 0);
        if (rawTvl > 0 && rawTvl < 1_000_000_000) {
          tvl = rawTvl;
        }
      }
    }

    if (tvl < MIN_TVL_DISPLAY) return null;

    // ── Volume: try all known field variants ──
    const vol24 = safeFloat(
      raw.volume24h ?? raw.volume24hUsd ?? raw.volume24hUSD ??
      raw.volumeUSD ?? raw.volumeUsd ?? raw.dailyVolume ??
      raw.volumeToken0USD ?? raw.volume24Hr ?? 0
    );
    const vol7d = safeFloat(raw.volume7d ?? raw.volume7dUSD ?? raw.weeklyVolume ?? 0);

    const feeRaw = safeFloat(raw.fee ?? raw.feeTier ?? 0);
    const fee = normalizeFee(feeRaw);

    // ── APR: use API value or compute from volume + fee ──
    let feeAPR = safeFloat(raw.apr ?? raw.apy ?? raw.feeApr ?? raw.feeAPR ?? raw.fee_apr ?? 0);
    if (feeAPR <= 0 && tvl > 0 && fee > 0 && vol24 > 0) {
      // Standard DEX fee APR: (daily_volume × fee_rate × 365) / tvl
      feeAPR = (vol24 * (fee / 100) * 365) / tvl * 100;
    }

    const farmAPR = safeFloat(raw.farmAPR ?? raw.farmApr ?? raw.farm_apr ?? raw.rewardApr ?? 0);
    const totalAPR = feeAPR + farmAPR;

    const utilization = tvl > 0 ? Math.min((vol24 / tvl) * 100, 100) : 0;
    const contractId = raw.contractId || raw.id?.toString() || raw.poolAddress || "";

    return {
      id: contractId || `v2-${symA}-${symB}-${feeRaw}`,
      tokenA: {
        symbol: normalizeSymbolForDisplay(symA, tA.id),
        name: normalizeNameForDisplay(tA.name || symA, symA, tA.id),
        logo: resolveTokenLogo(symA, tA.icon ?? tA.image),
        htsId: tA.id || tA.tokenId || "",
        decimals: decA,
      },
      tokenB: {
        symbol: normalizeSymbolForDisplay(symB, tB.id),
        name: normalizeNameForDisplay(tB.name || symB, symB, tB.id),
        logo: resolveTokenLogo(symB, tB.icon ?? tB.image),
        htsId: tB.id || tB.tokenId || "",
        decimals: decB,
      },
      tvl,
      volume24h: vol24,
      volume7d: vol7d,
      apr: Math.round(totalAPR * 10) / 10,
      feeAPR: Math.round(feeAPR * 10) / 10,
      farmAPR: Math.round(farmAPR * 10) / 10,
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
        symbol: normalizeSymbolForDisplay(p.tokenA?.symbol || "???", p.tokenA?.id),
        name: normalizeNameForDisplay(p.tokenA?.name || p.tokenA?.symbol || "Unknown", p.tokenA?.symbol || "???", p.tokenA?.id),
        logo: resolveTokenLogo(p.tokenA?.symbol || "", p.tokenA?.icon),
        htsId: p.tokenA?.id || "",
        decimals: p.tokenA?.decimals || 8,
      },
      tokenB: {
        symbol: normalizeSymbolForDisplay(p.tokenB?.symbol || "???", p.tokenB?.id),
        name: normalizeNameForDisplay(p.tokenB?.name || p.tokenB?.symbol || "Unknown", p.tokenB?.symbol || "???", p.tokenB?.id),
        logo: resolveTokenLogo(p.tokenB?.symbol || "", p.tokenB?.icon),
        htsId: p.tokenB?.id || "",
        decimals: p.tokenB?.decimals || 8,
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
    })).filter((p: LivePool) => p.tvl >= MIN_TVL_DISPLAY || FORCE_INCLUDE_POOL_CONTRACT_IDS.has(p.contractId));

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
    // [C88] Diagnostic: log first V1 pool's keys
    if (raw.length > 0) {
      const sample = raw[0];
      log.info("DeFiStats", `V1 sample pool keys: ${Object.keys(sample).join(", ")}`);
      log.info("DeFiStats", `V1 sample tvl=${sample.tvl}, liquidity=${String(sample.liquidity).slice(0, 20)}, volume24h=${sample.volume24h}, apr=${sample.apr}, lpFee=${sample.lpFee}, fee=${sample.fee}`);
    }
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
    // [C88] Diagnostic: log first pool's keys so we can see what the API actually returns
    if (raw.length > 0) {
      const sample = raw[0];
      log.info("DeFiStats", `V2 sample pool keys: ${Object.keys(sample).join(", ")}`);
      log.info("DeFiStats", `V2 sample tokenA keys: ${sample.tokenA ? Object.keys(sample.tokenA).join(", ") : "N/A"}`);
      log.info("DeFiStats", `V2 sample tvl=${sample.tvl}, tvlUSD=${sample.tvlUSD}, tvlUsd=${sample.tvlUsd}, liquidity=${String(sample.liquidity).slice(0, 20)}, volume24h=${sample.volume24h}, apr=${sample.apr}`);
    }
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
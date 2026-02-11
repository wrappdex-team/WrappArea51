/**
 * Smart Liquidity Engine — Unified backend for HBAR.h index pools.
 *
 * Merges SRMM (Smart Rebalancing Market Maker) pricing engine with
 * the Smart Pool index fund concept. Each pool is a weighted basket
 * of Hedera tokens with USDC as the routing anchor for zero-slippage
 * swaps via oracle-anchored pricing.
 *
 * Architecture:
 *   - Oracle prices sourced from SaucerSwap /tokens API (live, cached 60s)
 *   - USDC routing: all swaps route through USDC for price stability
 *   - Weighted constant-product AMM as fallback when oracle is stale
 *   - Pools are pre-filled "ready to go live" — simulation mode until
 *     HIP-1195 Lambda Hooks deploy on mainnet
 *   - Index fund: HBAR.h + USDC + top 10 Hedera tokens at launch
 *
 * When HIP-1195 goes live, the same pricing logic runs on-chain via
 * the Lambda EVM hook (see srmm-hooks.sol.ts).
 */

// ── Types ───────────────────────────────────────────────────────────

export type PoolStatus = "ready" | "active" | "paused";

export interface IndexToken {
  tokenId: string;
  symbol: string;
  name: string;
  decimals: number;
  targetWeightBps: number;   // basis points (e.g. 2000 = 20%)
  currentWeightBps: number;
  reserveUsd: number;
  oraclePriceUsd: number;
  oracleTimestamp: number;
  oracleSource: "saucerswap" | "fallback";
  logo?: string;
}

export interface LiquidityPool {
  id: string;
  name: string;
  description: string;
  status: PoolStatus;
  tokens: IndexToken[];
  totalValueUsd: number;
  swapFeeBps: number;
  rebalanceThresholdBps: number;
  lastRebalance: number;
  cumulativeVolumeUsd: number;
  maxDeviationBps: number;
  needsRebalance: boolean;
}

export interface SwapQuote {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  route: string;          // e.g. "HBAR → USDC → SAUCE"
  priceImpactBps: number;
  feeBps: number;
  feeUsd: number;
  oracleAnchored: boolean;
  effectiveRate: number;
  minAmountOut: number;
}

export interface PoolStats {
  totalPools: number;
  totalTvlUsd: number;
  totalVolumeUsd: number;
  avgFeeBps: number;
  poolsReady: number;
}

// ── Oracle Price Cache ──────────────────────────────────────────────
// Fetches live prices from SaucerSwap's /tokens endpoint.

interface CachedPrices {
  prices: Record<string, number>;
  timestamp: number;
}

let _priceCache: CachedPrices | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds

const SAUCERSWAP_API = "https://api.saucerswap.finance";

/**
 * Fetch live token prices from SaucerSwap.
 * Returns tokenId → priceUsd map.
 */
export async function fetchOraclePrices(): Promise<Record<string, number>> {
  // Return cached if fresh
  if (_priceCache && Date.now() - _priceCache.timestamp < CACHE_TTL_MS) {
    return _priceCache.prices;
  }

  const variants = ["/tokens", "/v1/tokens", "/v2/tokens"];

  for (const path of variants) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${SAUCERSWAP_API}${path}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const data = await res.json();

      const prices: Record<string, number> = {};

      // SaucerSwap returns array of tokens with priceUsd field
      if (Array.isArray(data)) {
        for (const token of data) {
          const id = token.id || token.tokenId;
          const price = parseFloat(token.priceUsd || token.price || "0");
          if (id && price > 0) {
            prices[id] = price;
          }
        }
      }

      // USDC/USDT always 1.00
      prices["0.0.456858"] = 1.0;   // USDC
      prices["0.0.4291336"] = 1.0;  // USDT

      _priceCache = { prices, timestamp: Date.now() };
      console.debug(`[SmartLiquidity] Oracle updated: ${Object.keys(prices).length} tokens`);
      return prices;
    } catch {
      continue;
    }
  }

  // Fallback prices
  console.debug("[SmartLiquidity] Oracle fallback — using static prices");
  return FALLBACK_PRICES;
}

const FALLBACK_PRICES: Record<string, number> = {
  "0.0.1456986": 0,         // WHBAR — fetched live from oracle
  "0.0.456858":  1.00,     // USDC
  "0.0.4291336": 1.00,     // USDT
  "0.0.731861":  0.045,    // SAUCE
  "0.0.9356476": 0.0081,   // HBAR.h
  "0.0.2283328": 0.0012,   // KARATE
  "0.0.4589822": 0.032,    // PACK
  "0.0.1159928": 0.0023,   // HST
  "0.0.6327456": 0.0008,   // DOVU
  "0.0.3155415": 0.00001,  // GRELF
  "0.0.786931":  0.019,    // CREAM
  "0.0.1055483": 0.0005,   // JAM
};

// ── Token Registry (Top 10 Hedera tokens for index) ─────────────────

interface TokenSeed {
  tokenId: string;
  symbol: string;
  name: string;
  decimals: number;
  fallbackPrice: number;
}

const INDEX_TOKENS: TokenSeed[] = [
  { tokenId: "0.0.9356476", symbol: "HBAR.ħ", name: "HBAR.ħ Protocol", decimals: 8, fallbackPrice: 0.0081 },
  { tokenId: "0.0.456858",  symbol: "USDC",   name: "USD Coin",        decimals: 6, fallbackPrice: 1.00 },
  { tokenId: "0.0.1456986", symbol: "WHBAR",  name: "Wrapped HBAR",    decimals: 8, fallbackPrice: 0 },
  { tokenId: "0.0.731861",  symbol: "SAUCE",  name: "SaucerSwap",      decimals: 6, fallbackPrice: 0.045 },
  { tokenId: "0.0.2283328", symbol: "KARATE", name: "Karate Combat",   decimals: 8, fallbackPrice: 0.0012 },
  { tokenId: "0.0.4589822", symbol: "PACK",   name: "HashPack",        decimals: 6, fallbackPrice: 0.032 },
  { tokenId: "0.0.1159928", symbol: "HST",    name: "HSuite Token",    decimals: 8, fallbackPrice: 0.0023 },
  { tokenId: "0.0.4291336", symbol: "USDT",   name: "Tether",          decimals: 6, fallbackPrice: 1.00 },
  { tokenId: "0.0.6327456", symbol: "DOVU",   name: "DOVU",            decimals: 8, fallbackPrice: 0.0008 },
  { tokenId: "0.0.3155415", symbol: "GRELF",  name: "Grelf",           decimals: 8, fallbackPrice: 0.00001 },
];

// ── Pool Definitions ────────────────────────────────────────────────

let _pools: LiquidityPool[] = [];
let _initialized = false;

function buildToken(
  seed: TokenSeed,
  targetWeightBps: number,
  reserveUsd: number,
  prices: Record<string, number>,
): IndexToken {
  const price = prices[seed.tokenId] || seed.fallbackPrice;
  const isLive = !!prices[seed.tokenId] && prices[seed.tokenId] !== seed.fallbackPrice;
  return {
    tokenId: seed.tokenId,
    symbol: seed.symbol,
    name: seed.name,
    decimals: seed.decimals,
    targetWeightBps,
    currentWeightBps: targetWeightBps + Math.floor((Math.random() - 0.5) * 80),
    reserveUsd,
    oraclePriceUsd: price,
    oracleTimestamp: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 30),
    oracleSource: isLive ? "saucerswap" : "fallback",
  };
}

function recalcPool(pool: LiquidityPool): void {
  pool.totalValueUsd = pool.tokens.reduce((s, t) => s + t.reserveUsd, 0);
  if (pool.totalValueUsd > 0) {
    for (const t of pool.tokens) {
      t.currentWeightBps = Math.round((t.reserveUsd / pool.totalValueUsd) * 10000);
    }
  }
  let maxDev = 0;
  for (const t of pool.tokens) {
    const dev = Math.abs(t.currentWeightBps - t.targetWeightBps);
    if (dev > maxDev) maxDev = dev;
  }
  pool.maxDeviationBps = maxDev;
  pool.needsRebalance = maxDev > pool.rebalanceThresholdBps;
}

async function initPools(): Promise<void> {
  if (_initialized) return;

  const prices = await fetchOraclePrices();
  const now = Math.floor(Date.now() / 1000);

  _pools = [
    {
      id: "sl-hbarh-index",
      name: "HBAR.h Index Fund",
      description: "Core index: HBAR.h protocol token + USDC anchor + top Hedera ecosystem tokens. USDC routing for zero-slippage swaps.",
      status: "ready",
      tokens: [
        buildToken(INDEX_TOKENS[0], 2000, 200_000, prices),  // HBAR.h 20%
        buildToken(INDEX_TOKENS[1], 2500, 250_000, prices),  // USDC 25%
        buildToken(INDEX_TOKENS[2], 2000, 200_000, prices),  // WHBAR 20%
        buildToken(INDEX_TOKENS[3], 1000, 100_000, prices),  // SAUCE 10%
        buildToken(INDEX_TOKENS[4],  800,  80_000, prices),  // KARATE 8%
        buildToken(INDEX_TOKENS[5],  500,  50_000, prices),  // PACK 5%
        buildToken(INDEX_TOKENS[6],  400,  40_000, prices),  // HST 4%
        buildToken(INDEX_TOKENS[7],  300,  30_000, prices),  // USDT 3%
        buildToken(INDEX_TOKENS[8],  300,  30_000, prices),  // DOVU 3%
        buildToken(INDEX_TOKENS[9],  200,  20_000, prices),  // GRELF 2%
      ],
      totalValueUsd: 0,
      swapFeeBps: 15,
      rebalanceThresholdBps: 300,
      lastRebalance: now - 3600,
      cumulativeVolumeUsd: 0,
      maxDeviationBps: 0,
      needsRebalance: false,
    },
    {
      id: "sl-stable",
      name: "Stable Liquidity",
      description: "USDC/USDT stable pair — ultra-low fees, tight rebalance threshold. Backbone for USDC routing.",
      status: "ready",
      tokens: [
        buildToken(INDEX_TOKENS[1], 5000, 500_000, prices), // USDC 50%
        buildToken(INDEX_TOKENS[7], 5000, 500_000, prices), // USDT 50%
      ],
      totalValueUsd: 0,
      swapFeeBps: 4,
      rebalanceThresholdBps: 100,
      lastRebalance: now - 7200,
      cumulativeVolumeUsd: 0,
      maxDeviationBps: 0,
      needsRebalance: false,
    },
    {
      id: "sl-hbar-usdc",
      name: "HBAR / USDC Core",
      description: "Primary routing pair. All HBAR swaps flow through this pool via USDC for oracle-anchored pricing.",
      status: "ready",
      tokens: [
        buildToken(INDEX_TOKENS[2], 5000, 500_000, prices), // WHBAR 50%
        buildToken(INDEX_TOKENS[1], 5000, 500_000, prices), // USDC 50%
      ],
      totalValueUsd: 0,
      swapFeeBps: 10,
      rebalanceThresholdBps: 200,
      lastRebalance: now - 1800,
      cumulativeVolumeUsd: 0,
      maxDeviationBps: 0,
      needsRebalance: false,
    },
    {
      id: "sl-defi-basket",
      name: "Hedera DeFi Basket",
      description: "Exposure to Hedera DeFi ecosystem tokens with USDC anchor for easy entry/exit.",
      status: "ready",
      tokens: [
        buildToken(INDEX_TOKENS[1], 3000, 150_000, prices), // USDC 30%
        buildToken(INDEX_TOKENS[3], 2500, 125_000, prices), // SAUCE 25%
        buildToken(INDEX_TOKENS[5], 2000, 100_000, prices), // PACK 20%
        buildToken(INDEX_TOKENS[6], 1500,  75_000, prices), // HST 15%
        buildToken(INDEX_TOKENS[8], 1000,  50_000, prices), // DOVU 10%
      ],
      totalValueUsd: 0,
      swapFeeBps: 25,
      rebalanceThresholdBps: 400,
      lastRebalance: now - 14400,
      cumulativeVolumeUsd: 0,
      maxDeviationBps: 0,
      needsRebalance: false,
    },
  ];

  for (const pool of _pools) {
    recalcPool(pool);
  }
  _initialized = true;
}

// ── Public API ──────────────────────────────────────────────────────

export async function fetchPools(): Promise<LiquidityPool[]> {
  await initPools();
  return [..._pools];
}

export async function getPool(id: string): Promise<LiquidityPool | null> {
  await initPools();
  return _pools.find((p) => p.id === id) ?? null;
}

export async function getPoolStats(): Promise<PoolStats> {
  await initPools();
  return {
    totalPools: _pools.length,
    totalTvlUsd: _pools.reduce((s, p) => s + p.totalValueUsd, 0),
    totalVolumeUsd: _pools.reduce((s, p) => s + p.cumulativeVolumeUsd, 0),
    avgFeeBps: Math.round(_pools.reduce((s, p) => s + p.swapFeeBps, 0) / _pools.length),
    poolsReady: _pools.filter((p) => p.status === "ready").length,
  };
}

/**
 * Refresh oracle prices for all pools.
 * Call this periodically (e.g. every 60s) to keep prices current.
 */
export async function refreshOracles(): Promise<void> {
  const prices = await fetchOraclePrices();
  const now = Math.floor(Date.now() / 1000);

  for (const pool of _pools) {
    for (const token of pool.tokens) {
      const newPrice = prices[token.tokenId];
      if (newPrice && newPrice > 0) {
        token.oraclePriceUsd = newPrice;
        token.oracleTimestamp = now;
        token.oracleSource = "saucerswap";
        // Adjust reserveUsd based on new price (simulate quantity * price)
        const qty = token.reserveUsd / (token.oraclePriceUsd || 1);
        token.reserveUsd = qty * newPrice;
      }
    }
    recalcPool(pool);
  }
}

// ── USDC Routing & Swap Quotes ──────────────────────────────────────

/**
 * Build a USDC-routed swap route description.
 * All swaps route: tokenIn → USDC → tokenOut (unless one side IS USDC).
 */
function buildRoute(tokenIn: string, tokenOut: string): string {
  if (tokenIn === "USDC") return `USDC → ${tokenOut}`;
  if (tokenOut === "USDC") return `${tokenIn} → USDC`;
  return `${tokenIn} → USDC → ${tokenOut}`;
}

/**
 * Get a swap quote through a smart liquidity pool.
 * Uses oracle-anchored pricing with USDC routing for zero-slippage.
 */
export async function getSwapQuote(
  poolId: string,
  tokenInSymbol: string,
  tokenOutSymbol: string,
  amountIn: number,
  slippageBps: number = 50,
): Promise<SwapQuote | null> {
  await initPools();
  const pool = _pools.find((p) => p.id === poolId);
  if (!pool) return null;

  const tokenIn = pool.tokens.find((t) => t.symbol === tokenInSymbol);
  const tokenOut = pool.tokens.find((t) => t.symbol === tokenOutSymbol);
  if (!tokenIn || !tokenOut || tokenIn === tokenOut) return null;

  // Oracle-anchored pricing: convert via USD prices
  const now = Math.floor(Date.now() / 1000);
  const oracleFresh =
    (now - tokenIn.oracleTimestamp < 300) &&
    (now - tokenOut.oracleTimestamp < 300) &&
    tokenIn.oraclePriceUsd > 0 &&
    tokenOut.oraclePriceUsd > 0;

  // Fee
  const feeBps = pool.swapFeeBps;
  const feeUsd = amountIn * tokenIn.oraclePriceUsd * feeBps / 10000;
  const amountInAfterFee = amountIn * (1 - feeBps / 10000);

  let amountOut: number;
  let oracleAnchored = false;
  let priceImpactBps = 0;

  if (oracleFresh) {
    // Oracle-anchored: zero slippage
    amountOut = amountInAfterFee * tokenIn.oraclePriceUsd / tokenOut.oraclePriceUsd;
    oracleAnchored = true;
    priceImpactBps = 0;
  } else {
    // Weighted AMM fallback with simulated impact
    const rate = tokenIn.oraclePriceUsd / tokenOut.oraclePriceUsd;
    const impactMultiplier = 1 - (amountIn * tokenIn.oraclePriceUsd / pool.totalValueUsd) * 0.3;
    amountOut = amountInAfterFee * rate * Math.max(impactMultiplier, 0.95);
    priceImpactBps = Math.round((1 - impactMultiplier) * 10000);
  }

  const effectiveRate = amountOut / amountIn;
  const minAmountOut = amountOut * (1 - slippageBps / 10000);

  return {
    poolId,
    tokenIn: tokenInSymbol,
    tokenOut: tokenOutSymbol,
    amountIn,
    amountOut,
    route: buildRoute(tokenInSymbol, tokenOutSymbol),
    priceImpactBps,
    feeBps,
    feeUsd,
    oracleAnchored,
    effectiveRate,
    minAmountOut,
  };
}

/**
 * Execute a swap (simulation — updates pool state in memory).
 */
export async function executeSwap(
  quote: SwapQuote,
): Promise<{ success: boolean; transactionId: string | null; error: string | null }> {
  const pool = _pools.find((p) => p.id === quote.poolId);
  if (!pool) return { success: false, transactionId: null, error: "Pool not found" };

  const tokenIn = pool.tokens.find((t) => t.symbol === quote.tokenIn);
  const tokenOut = pool.tokens.find((t) => t.symbol === quote.tokenOut);
  if (!tokenIn || !tokenOut) {
    return { success: false, transactionId: null, error: "Token not found" };
  }

  // Check capacity
  if (quote.amountOut * tokenOut.oraclePriceUsd > tokenOut.reserveUsd * 0.5) {
    return { success: false, transactionId: null, error: "Insufficient pool liquidity" };
  }

  // Update reserves
  tokenIn.reserveUsd += quote.amountIn * tokenIn.oraclePriceUsd;
  tokenOut.reserveUsd -= quote.amountOut * tokenOut.oraclePriceUsd;

  pool.cumulativeVolumeUsd += quote.amountIn * tokenIn.oraclePriceUsd;
  recalcPool(pool);

  const txId = `0.0.${Math.floor(Math.random() * 9999999)}@${Math.floor(Date.now() / 1000)}.${Math.floor(Math.random() * 999999999)}`;

  return { success: true, transactionId: txId, error: null };
}

// ── Formatting Helpers ──────────────────────────────────────────────

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatFeeBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function timeSince(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

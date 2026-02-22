/**
 * [C67] SaucerSwap Pool Data, Stats & HBAR Price Fetching
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: HbarhTokenData, SaucerSwapPool, TokenInfo, ProtocolStats
 * interfaces, fallback data, and all pool/stats/price fetch functions.
 *
 * Dependencies: tokens (HBARH_TOKEN_ID), prices (saucerFetch, makeAbort,
 * fetchHbarhTokenPrice).
 */

import { HBARH_TOKEN_ID } from "./tokens";
import { saucerFetch, makeAbort, fetchHbarhTokenPrice } from "./prices";

// ── Types ──────────────────────────────────────────────────────────

export interface HbarhTokenData {
  price: number;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  liquidity: number;
  priceHistory: number[];
}

export interface SaucerSwapPool {
  id: string;
  tokenA: { id: string; symbol: string; name: string; decimals: number };
  tokenB: { id: string; symbol: string; name: string; decimals: number };
  tvlUsd: number;
  volume24hUsd: number;
  fee: number;
  apr: number;
  tickSpacing: number;
}

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  decimals: number;
  tvl: number;
  volume24h: number;
  priceChange24h: number;
}

export interface ProtocolStats {
  totalTvlUsd: number;
  totalVolume24hUsd: number;
  totalPools: number;
  totalTokens: number;
}

// ── Fallback Data ──────────────────────────────────────────────────

const FALLBACK_DATA: HbarhTokenData = {
  price: 0.000001,
  priceUsd: 0.000001,
  change24h: 0,
  volume24h: 0,
  liquidity: 0,
  priceHistory: [
    0.0000009, 0.0000010, 0.0000009, 0.0000010, 0.0000011, 0.0000010, 0.0000010, 0.0000009,
    0.0000010, 0.0000010, 0.0000011, 0.0000010, 0.0000009, 0.0000010, 0.0000010, 0.0000011,
    0.0000010, 0.0000010, 0.0000009, 0.0000010, 0.0000011, 0.0000010, 0.0000010, 0.0000010,
  ],
};

const FALLBACK_POOLS: SaucerSwapPool[] = [
  {
    id: "pool-hbar-usdc",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.456858", symbol: "USDC", name: "USD Coin", decimals: 6 },
    tvlUsd: 18420000, volume24hUsd: 3240000, fee: 0.3, apr: 24.5, tickSpacing: 60,
  },
  {
    id: "pool-hbar-hbarh",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: HBARH_TOKEN_ID, symbol: "HBAR.h", name: "HBAR.h Protocol", decimals: 8 },
    tvlUsd: 5630000, volume24hUsd: 890000, fee: 0.05, apr: 12.8, tickSpacing: 10,
  },
  {
    id: "pool-hbar-sauce",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.731861", symbol: "SAUCE", name: "SaucerSwap", decimals: 6 },
    tvlUsd: 4120000, volume24hUsd: 1560000, fee: 0.3, apr: 38.2, tickSpacing: 60,
  },
  {
    id: "pool-usdc-usdt",
    tokenA: { id: "0.0.456858", symbol: "USDC", name: "USD Coin", decimals: 6 },
    tokenB: { id: "0.0.1055472", symbol: "USDT", name: "Tether USD", decimals: 6 }, // [C36-04] Updated from 0.0.4291336
    tvlUsd: 8910000, volume24hUsd: 2180000, fee: 0.01, apr: 8.4, tickSpacing: 1,
  },
  {
    id: "pool-hbar-karate",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    // [C85] Fixed KARATE ID — was 0.0.2283328 (probably LP token), corrected to canonical 0.0.2283230
    tokenB: { id: "0.0.2283230", symbol: "KARATE", name: "Karate Combat", decimals: 8 },
    tvlUsd: 1840000, volume24hUsd: 620000, fee: 1.0, apr: 52.1, tickSpacing: 200,
  },
  {
    id: "pool-hbar-pack",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.4794920", symbol: "PACK", name: "HashPack", decimals: 6 },
    tvlUsd: 920000, volume24hUsd: 340000, fee: 0.3, apr: 31.6, tickSpacing: 60,
  },
  {
    id: "pool-hbar-link",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.1055495", symbol: "LINK", name: "Chainlink", decimals: 8 },
    tvlUsd: 2340000, volume24hUsd: 780000, fee: 0.3, apr: 18.7, tickSpacing: 60,
  },
  {
    id: "pool-hbar-wbtc",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.1055483", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8 },
    tvlUsd: 3560000, volume24hUsd: 1120000, fee: 0.3, apr: 15.3, tickSpacing: 60,
  },
  {
    id: "pool-hbar-hst",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    // [C85] Updated HST from 0.0.786931 → 0.0.968069 (reconciliation fix)
    tokenB: { id: "0.0.968069", symbol: "HST", name: "HSuite Token", decimals: 8 },
    tvlUsd: 680000, volume24hUsd: 210000, fee: 0.3, apr: 26.4, tickSpacing: 60,
  },
];

// ── Private Helpers ────────────────────────────────────────────────

function generateSparkline(currentPrice: number): number[] {
  const history: number[] = [];
  let p = currentPrice * (0.92 + Math.random() * 0.06);
  for (let i = 0; i < 23; i++) {
    const drift = (currentPrice - p) * 0.05;
    const noise = (Math.random() - 0.48) * currentPrice * 0.03;
    p = Math.max(p + drift + noise, currentPrice * 0.8);
    history.push(p);
  }
  history.push(currentPrice);
  return history;
}

// ── HBAR.h Price Fetching ──────────────────────────────────────────

export async function fetchHbarhPrice(): Promise<HbarhTokenData> {
  let priceUsd = 0;
  let volume = 0;
  let liquidity = 0;
  let change24h = FALLBACK_DATA.change24h;
  let priceSource = "fallback";

  console.log("[HBAR.h] fetchHbarhPrice() called -- starting price strategies");

  // Strategy 1a: DexScreener pairs endpoint
  try {
    const dexRes = await fetch(
      "https://api.dexscreener.com/latest/dex/pairs/hedera/0x31d6b803a960b818cce3a85f0bef7c4c566b7919",
      { signal: makeAbort(10000) }
    );
    console.log(`[HBAR.h] DexScreener pairs status: ${dexRes.status}`);
    if (dexRes.ok) {
      const dexData = await dexRes.json();
      console.log("[HBAR.h] DexScreener pairs keys:", Object.keys(dexData));
      const pair = dexData?.pair || dexData?.pairs?.[0];
      if (pair) {
        const p = parseFloat(pair.priceUsd || "0");
        console.log(`[HBAR.h] DexScreener pairs price: $${p}`);
        if (p > 0) {
          priceUsd = p;
          volume = parseFloat(pair.volume?.h24 || "0");
          liquidity = parseFloat(pair.liquidity?.usd || "0");
          change24h = parseFloat(pair.priceChange?.h24 || "0");
          priceSource = "dexscreener-pairs";
        }
      } else {
        console.warn("[HBAR.h] DexScreener pairs: no pair object found in response");
      }
    }
  } catch (err: any) {
    console.warn("[HBAR.h] DexScreener pairs error:", err?.message || err);
  }

  // Strategy 1b: DexScreener token search (uses EVM token address -- more resilient than pair address)
  // 0.0.9356476 -> EVM = 0x00000000000000000000000000000000008ecf5c
  if (priceUsd <= 0) {
    try {
      const dexTokenRes = await fetch(
        "https://api.dexscreener.com/latest/dex/tokens/0x00000000000000000000000000000000008ecf5c",
        { signal: makeAbort(10000) }
      );
      console.log(`[HBAR.h] DexScreener tokens status: ${dexTokenRes.status}`);
      if (dexTokenRes.ok) {
        const dexTokenData = await dexTokenRes.json();
        const pairs = dexTokenData?.pairs;
        if (Array.isArray(pairs) && pairs.length > 0) {
          // Pick the pair with highest liquidity for most accurate price
          const best = pairs.reduce((a: any, b: any) =>
            (parseFloat(b.liquidity?.usd || "0") > parseFloat(a.liquidity?.usd || "0")) ? b : a
          , pairs[0]);
          const p = parseFloat(best.priceUsd || "0");
          console.log(`[HBAR.h] DexScreener tokens price: $${p} (${pairs.length} pairs found)`);
          if (p > 0) {
            priceUsd = p;
            volume = parseFloat(best.volume?.h24 || "0");
            liquidity = parseFloat(best.liquidity?.usd || "0");
            change24h = parseFloat(best.priceChange?.h24 || "0");
            priceSource = "dexscreener-tokens";
          }
        } else {
          console.warn("[HBAR.h] DexScreener tokens: no pairs array in response");
        }
      }
    } catch (err: any) {
      console.warn("[HBAR.h] DexScreener tokens error:", err?.message || err);
    }
  }

  // Strategy 2: SaucerSwap direct token endpoint
  if (priceUsd <= 0) {
    try {
      const res = await saucerFetch("/tokens/" + HBARH_TOKEN_ID, 8000);
      if (res) {
        const data = await res.json();
        priceUsd = parseFloat(data.priceUsd || data.price || "0");
        volume = parseFloat(data.volume24h || data.dailyVolume || "0");
        liquidity = parseFloat(data.liquidity || data.tvl || "0");
        change24h = data.priceChangePercentage24h ?? data.change24h ?? change24h;
        if (priceUsd > 0) priceSource = "saucerswap";
        console.log(`[HBAR.h] SaucerSwap direct price: $${priceUsd}`);
      } else {
        console.warn("[HBAR.h] SaucerSwap direct: null response");
      }
    } catch (err: any) {
      console.warn("[HBAR.h] SaucerSwap direct error:", err?.message || err);
    }
  }

  // Strategy 3: Multi-strategy price fetcher (has its own DexScreener + SaucerSwap cascade)
  if (priceUsd <= 0) {
    try {
      const result = await fetchHbarhTokenPrice();
      if (result.price > 0) {
        priceUsd = result.price;
        priceSource = result.source;
      }
      console.log(`[HBAR.h] Multi-strategy result: $${result.price} (${result.source})`);
    } catch (err: any) {
      console.warn("[HBAR.h] Multi-strategy error:", err?.message || err);
    }
  }

  const finalPrice = priceUsd > 0 ? priceUsd : FALLBACK_DATA.price;

  console.log(`[HBAR.h] FINAL price: $${finalPrice} (source: ${priceSource})`);

  return {
    price: finalPrice,
    priceUsd: finalPrice,
    change24h,
    volume24h: volume || FALLBACK_DATA.volume24h,
    liquidity: liquidity || FALLBACK_DATA.liquidity,
    priceHistory: generateSparkline(finalPrice),
  };
}

// ── Pool Fetching ──────────────────────────────────────────────────

export async function fetchTopPools(limit: number = 10): Promise<SaucerSwapPool[]> {
  try {
    const res = await saucerFetch("/pools", 10000);
    if (!res) return FALLBACK_POOLS.slice(0, limit);

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return FALLBACK_POOLS.slice(0, limit);

    return data
      .map((pool: any) => ({
        id: pool.id || pool.contractId || "pool-" + (pool.tokenA?.symbol || "X") + "-" + (pool.tokenB?.symbol || "Y"),
        tokenA: {
          id: pool.tokenA?.id || "",
          symbol: pool.tokenA?.symbol || "???",
          name: pool.tokenA?.name || "Unknown",
          decimals: pool.tokenA?.decimals ?? 8,
        },
        tokenB: {
          id: pool.tokenB?.id || "",
          symbol: pool.tokenB?.symbol || "???",
          name: pool.tokenB?.name || "Unknown",
          decimals: pool.tokenB?.decimals ?? 8,
        },
        tvlUsd: parseFloat(pool.tvl || pool.tvlUsd || "0"),
        volume24hUsd: parseFloat(pool.volume24h || pool.volume24hUsd || "0"),
        fee: parseFloat(pool.fee || "0.3") / 10000,
        apr: parseFloat(pool.apr || "0"),
        tickSpacing: pool.tickSpacing ?? 60,
      }))
      .sort((a: SaucerSwapPool, b: SaucerSwapPool) => b.tvlUsd - a.tvlUsd)
      .slice(0, limit);
  } catch {
    return FALLBACK_POOLS.slice(0, limit);
  }
}

// ── Token Info Fetching ────────────────────────────────────────────

export async function fetchTokenInfo(tokenId: string): Promise<TokenInfo | null> {
  try {
    const res = await saucerFetch("/tokens/" + tokenId, 8000);
    if (!res) return null;

    const data = await res.json();
    return {
      id: tokenId,
      symbol: data.symbol || "???",
      name: data.name || "Unknown Token",
      priceUsd: parseFloat(data.priceUsd || "0"),
      decimals: data.decimals ?? 8,
      tvl: parseFloat(data.tvl || data.liquidity || "0"),
      volume24h: parseFloat(data.volume24h || data.dailyVolume || "0"),
      priceChange24h: data.priceChangePercentage24h ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Protocol Stats ─────────────────────────────────────────────────

export async function fetchProtocolStats(): Promise<ProtocolStats> {
  try {
    const pools = await fetchTopPools(50);
    const totalTvl = pools.reduce((s, p) => s + p.tvlUsd, 0);
    const totalVol = pools.reduce((s, p) => s + p.volume24hUsd, 0);
    const uniqueTokens = new Set<string>();
    for (const p of pools) {
      uniqueTokens.add(p.tokenA.symbol);
      uniqueTokens.add(p.tokenB.symbol);
    }

    return {
      totalTvlUsd: totalTvl || 42500000,
      totalVolume24hUsd: totalVol || 8900000,
      totalPools: pools.length || 85,
      totalTokens: uniqueTokens.size || 42,
    };
  } catch {
    return {
      totalTvlUsd: 42500000,
      totalVolume24hUsd: 8900000,
      totalPools: 85,
      totalTokens: 42,
    };
  }
}
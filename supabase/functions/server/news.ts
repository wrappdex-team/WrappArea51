// ══════════════════════════════════════════════════════════════════════
// NEWS TICKER — Cached proxy to CoinGecko trending + search endpoints
// ══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import { ROUTE_PREFIX, HEDERA_MIRROR_MAINNET } from "./shared.ts";

// ── Constants ───────────────────────────────────────────────────────

const NEWS_CACHE_KEY = "news_ticker_cache";
const NEWS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedNews {
  items: Array<{ token: string; headline: string; url: string; source: string }>;
  fetchedAt: number;
}

// ── News Fetcher ────────────────────────────────────────────────────

/**
 * Fetches real crypto news from CoinGecko's free /search/trending endpoint
 * and supplements with global market data + Hedera stats. Results are
 * KV-cached for 10 minutes.
 */
async function fetchCryptoNews(): Promise<CachedNews["items"]> {
  // Check cache first
  try {
    const cached: CachedNews | null = await kv.get(NEWS_CACHE_KEY);
    if (cached && (Date.now() - cached.fetchedAt) < NEWS_CACHE_TTL_MS && cached.items.length > 0) {
      return cached.items;
    }
  } catch { /* cache miss — fetch fresh */ }

  const items: CachedNews["items"] = [];

  // Source 1: CoinGecko trending coins (free, no API key)
  try {
    const trendResp = await fetch("https://api.coingecko.com/api/v3/search/trending", {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (trendResp.ok) {
      const data = await trendResp.json();
      const coins = data?.coins ?? [];
      for (const entry of coins.slice(0, 7)) {
        const coin = entry?.item;
        if (!coin) continue;
        const symbol = (coin.symbol || "").toUpperCase();
        const name = coin.name || symbol;
        const priceChange = coin.data?.price_change_percentage_24h?.usd;
        const priceBtc = coin.data?.price_btc;
        let headline = `${name} is trending`;
        if (typeof priceChange === "number") {
          const dir = priceChange >= 0 ? "up" : "down";
          headline = `${name} trending — ${dir} ${Math.abs(priceChange).toFixed(1)}% in 24h`;
        }
        if (priceBtc) {
          headline += ` (${Number(priceBtc).toExponential(2)} BTC)`;
        }
        const slug = coin.slug || coin.id || name.toLowerCase().replace(/\s+/g, "-");
        items.push({
          token: symbol,
          headline,
          url: `https://www.coingecko.com/en/coins/${slug}`,
          source: "CoinGecko",
        });
      }
    }
  } catch { /* non-critical */ }

  // Source 2: CoinGecko global market data
  try {
    const globalResp = await fetch("https://api.coingecko.com/api/v3/global", {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (globalResp.ok) {
      const gd = (await globalResp.json())?.data;
      if (gd) {
        const mcapChange = gd.market_cap_change_percentage_24h_usd;
        if (typeof mcapChange === "number") {
          const dir = mcapChange >= 0 ? "up" : "down";
          items.push({
            token: "GLOBAL",
            headline: `Total crypto market cap ${dir} ${Math.abs(mcapChange).toFixed(2)}% — $${(gd.total_market_cap?.usd / 1e12).toFixed(2)}T`,
            url: "https://www.coingecko.com/en/global-charts",
            source: "CoinGecko",
          });
        }
        const btcDom = gd.market_cap_percentage?.btc;
        if (typeof btcDom === "number") {
          items.push({
            token: "BTC",
            headline: `Bitcoin dominance at ${btcDom.toFixed(1)}% of total crypto market cap`,
            url: "https://www.coingecko.com/en/global-charts",
            source: "CoinGecko",
          });
        }
        const ethDom = gd.market_cap_percentage?.eth;
        if (typeof ethDom === "number") {
          items.push({
            token: "ETH",
            headline: `Ethereum market share at ${ethDom.toFixed(1)}% — ${gd.active_cryptocurrencies?.toLocaleString() || "many"} active coins tracked`,
            url: "https://www.coingecko.com/en/global-charts",
            source: "CoinGecko",
          });
        }
      }
    }
  } catch { /* non-critical */ }

  // Source 3: Hedera-specific data from Mirror Node
  try {
    const hbarResp = await fetch(`${HEDERA_MIRROR_MAINNET}/api/v1/network/supply`, {
      signal: AbortSignal.timeout(5000),
    });
    if (hbarResp.ok) {
      const supply = await hbarResp.json();
      const totalHbar = Number(supply?.total_supply) / 1e8;
      if (totalHbar > 0) {
        items.push({
          token: "HBAR",
          headline: `Hedera total supply: ${(totalHbar / 1e9).toFixed(2)}B HBAR — network processing enterprise-grade transactions`,
          url: "https://hashscan.io/mainnet/dashboard",
          source: "HashScan",
        });
      }
    }
  } catch { /* non-critical */ }

  // If all fetches failed, return minimal fallback
  if (items.length === 0) {
    items.push(
      { token: "BTC", headline: "Bitcoin continues as the leading digital asset by market capitalization", url: "https://www.coingecko.com/en/coins/bitcoin", source: "CoinGecko" },
      { token: "HBAR", headline: "Hedera Hashgraph — enterprise-grade distributed ledger technology", url: "https://hedera.com", source: "Hedera" },
      { token: "ETH", headline: "Ethereum ecosystem powering DeFi, NFTs, and L2 scaling solutions", url: "https://www.coingecko.com/en/coins/ethereum", source: "CoinGecko" },
    );
  }

  // Cache results
  try {
    await kv.set(NEWS_CACHE_KEY, { items, fetchedAt: Date.now() });
  } catch { /* non-critical */ }

  return items;
}

// ── Route Registration ──────────────────────────────────────────────

export function registerNewsRoutes(app: Hono): void {
  app.get(`${ROUTE_PREFIX}/news`, async (c) => {
    try {
      const items = await fetchCryptoNews();
      return c.json({ items });
    } catch (err) {
      console.error("[NEWS] Error fetching news:", err);
      return c.json({ items: [], error: "Failed to fetch news" }, 500);
    }
  });
}
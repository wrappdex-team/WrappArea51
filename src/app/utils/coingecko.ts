const COINCAP_API = "https://api.coincap.io/v2";
const COINGECKO_API = "https://api.coingecko.com/api/v3";

import { fetchChainlinkPrices, chainlinkToCoinPrices, updateOracleStats } from "./chainlink";
import type { ChainlinkPriceData } from "./chainlink";
import { fetchNetworkExchangeRate } from "./exchange-rate";
import { log } from "./logger";

// ── Binance Symbol Map ─────────────────────────────────────────────
// Maps canonical symbol to Binance USDT trading pair.
// Free, no API key, excellent CORS, real-time, covers all majors.
//
// IMPORTANT: Every pair here MUST exist on Binance. The batch
// ticker/24hr endpoint returns HTTP 400 if ANY symbol is invalid,
// killing the ENTIRE request. EURC is intentionally excluded
// (no EURCUSDT pair on Binance). XMR is excluded because Binance
// delisted Monero spot trading (Feb 2024) — the API returns a
// frozen last-traded price, producing stale quotes.
const BINANCE_PAIR_MAP: Record<string, string> = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", BNB: "BNBUSDT", SOL: "SOLUSDT",
  XRP: "XRPUSDT", HBAR: "HBARUSDT", DOGE: "DOGEUSDT", ADA: "ADAUSDT",
  AVAX: "AVAXUSDT", TRX: "TRXUSDT", TON: "TONUSDT", LINK: "LINKUSDT",
  SHIB: "SHIBUSDT", DOT: "DOTUSDT", LTC: "LTCUSDT", PAXG: "PAXGUSDT",
  AAVE: "AAVEUSDT",
  DAI: "DAIUSDT",
};

// Reverse map: Binance pair -> our symbol
const BINANCE_REVERSE: Record<string, string> = {};
for (const [sym, pair] of Object.entries(BINANCE_PAIR_MAP)) {
  if (pair) BINANCE_REVERSE[pair] = sym;
}

// CoinCap IDs (used for chart history ONLY, not price pipeline)
export const COINCAP_ID_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", USDT: "tether", BNB: "binance-coin",
  SOL: "solana", USDC: "usd-coin", XRP: "xrp", HBAR: "hedera-hashgraph",
  DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche", TRX: "tron",
  TON: "toncoin", LINK: "chainlink", SHIB: "shiba-inu", DOT: "polkadot",
  LTC: "litecoin", PAXG: "pax-gold", EURC: "euro-coin",
  USDCh: "usd-coin", AAVE: "aave",
  DAI: "multi-collateral-dai",
  XMR: "monero",
  // Wrapped bridge tokens (map to parent asset)
  WHBAR: "hedera-hashgraph", WBTC: "bitcoin", WETH: "ethereum",
  WBNB: "binance-coin", WAVAX: "avalanche", WMATIC: "matic-network",
};

// CoinGecko IDs (used for market cap enrichment + tokens Binance doesn't cover)
export const COIN_ID_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", USDT: "tether", BNB: "binancecoin",
  SOL: "solana", USDC: "usd-coin", XRP: "ripple", HBAR: "hedera-hashgraph",
  DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche-2", TRX: "tron",
  TON: "toncoin", LINK: "chainlink", SHIB: "shiba-inu", DOT: "polkadot",
  LTC: "litecoin", PAXG: "pax-gold", EURC: "euro-coin-2",
  USDCh: "usd-coin", AAVE: "aave",
  DAI: "dai",
  XMR: "monero",
  // Wrapped bridge tokens (map to parent asset CoinGecko ID)
  WHBAR: "hedera-hashgraph", WBTC: "wrapped-bitcoin", WETH: "weth",
  WBNB: "binancecoin", WAVAX: "avalanche-2", WMATIC: "matic-network",
};

const CG = "https://assets.coingecko.com/coins/images";

export const TOKEN_LOGOS: Record<string, string> = {
  BTC: `${CG}/1/standard/bitcoin.png`,
  ETH: `${CG}/279/standard/ethereum.png`,
  USDT: `${CG}/325/standard/Tether.png`,
  BNB: `${CG}/825/standard/bnb-icon2_2x.png`,
  SOL: `${CG}/4128/standard/solana.png`,
  USDC: `${CG}/6319/standard/usdc.png`,
  XRP: `${CG}/44/standard/xrp-symbol-white-128.png`,
  HBAR: `${CG}/3688/standard/hbar.png`,
  DOGE: `${CG}/5/standard/dogecoin.png`,
  ADA: `${CG}/975/standard/cardano.png`,
  AVAX: `${CG}/12559/standard/Avalanche_Circle_RedWhite_Trans.png`,
  TRX: `${CG}/1094/standard/tron-logo.png`,
  TON: `${CG}/17980/standard/ton_symbol.png`,
  LINK: `${CG}/877/standard/chainlink-new-logo.png`,
  SHIB: `${CG}/11939/standard/shiba.png`,
  DOT: `${CG}/12171/standard/polkadot.png`,
  LTC: `${CG}/2/standard/litecoin.png`,
  EURC: `${CG}/26045/standard/euro-coin.png`,
  PAXG: `${CG}/9519/standard/paxgold.png`,
  USDCh: `${CG}/6319/standard/usdc.png`,
  AAVE: `${CG}/12645/standard/aave-token-round.png`,
  DAI: `${CG}/9956/standard/Badge_Dai.png`,
  XMR: `${CG}/69/standard/monero_logo.png`,
  // Wrapped bridge tokens (AMM-specific — reuse parent asset logos)
  WHBAR: `${CG}/3688/standard/hbar.png`,
  WBTC: `${CG}/7598/standard/wrapped_bitcoin_wbtc.png`,
  WETH: `${CG}/279/standard/ethereum.png`,
  WBNB: `${CG}/825/standard/bnb-icon2_2x.png`,
  WAVAX: `${CG}/12559/standard/Avalanche_Circle_RedWhite_Trans.png`,
  WMATIC: `${CG}/4713/standard/polygon.png`,
};

// ── Oracle Source Types ────────────────────────────────────────────
export type OracleSource = "network" | "chainlink" | "binance" | "coincap" | "coingecko" | "fallback";

export interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  image: string;
  oracle_source?: OracleSource;
  oracle_updated_at?: number;
  chainlink_feed?: string;
  change_source?: OracleSource;
  /** Real 24h high from exchange/aggregator ticker (not chart-derived) */
  high_24h?: number;
  /** Real 24h low from exchange/aggregator ticker (not chart-derived) */
  low_24h?: number;
  /** 7-day hourly sparkline from CoinGecko (~168 points) */
  sparkline_in_7d?: { price: number[] };
}

// ── Hardcoded Fallback (last resort) ──────────────────────────────
const FALLBACK_DATA: Record<string, CoinPrice> = {
  BTC:  { id: "bitcoin",    symbol: "btc",  name: "Bitcoin",    current_price: 104000,   price_change_percentage_24h: 1.2,   market_cap: 2060000000000, total_volume: 35000000000, image: TOKEN_LOGOS.BTC },
  ETH:  { id: "ethereum",   symbol: "eth",  name: "Ethereum",   current_price: 2650,     price_change_percentage_24h: 0.8,   market_cap: 320000000000,  total_volume: 18000000000, image: TOKEN_LOGOS.ETH },
  USDT: { id: "tether",     symbol: "usdt", name: "Tether",     current_price: 1.0001,   price_change_percentage_24h: 0.01,  market_cap: 145000000000,  total_volume: 55000000000, image: TOKEN_LOGOS.USDT },
  BNB:  { id: "binancecoin",symbol: "bnb",  name: "BNB",        current_price: 660,      price_change_percentage_24h: 0.5,   market_cap: 96000000000,   total_volume: 2000000000,  image: TOKEN_LOGOS.BNB },
  SOL:  { id: "solana",     symbol: "sol",  name: "Solana",     current_price: 172,      price_change_percentage_24h: 2.1,   market_cap: 84000000000,   total_volume: 4000000000,  image: TOKEN_LOGOS.SOL },
  USDC: { id: "usd-coin",   symbol: "usdc", name: "USD Coin",   current_price: 1.0000,   price_change_percentage_24h: 0.0,   market_cap: 60000000000,   total_volume: 8000000000,  image: TOKEN_LOGOS.USDC },
  XRP:  { id: "ripple",     symbol: "xrp",  name: "XRP",        current_price: 2.45,     price_change_percentage_24h: -0.3,  market_cap: 142000000000,  total_volume: 5000000000,  image: TOKEN_LOGOS.XRP },
  HBAR: { id: "hedera",     symbol: "hbar", name: "Hedera",     current_price: 0.21,     price_change_percentage_24h: 1.0,   market_cap: 8500000000,    total_volume: 250000000,   image: TOKEN_LOGOS.HBAR },
  DOGE: { id: "dogecoin",   symbol: "doge", name: "Dogecoin",   current_price: 0.23,     price_change_percentage_24h: 1.5,   market_cap: 34000000000,   total_volume: 2500000000,  image: TOKEN_LOGOS.DOGE },
  ADA:  { id: "cardano",    symbol: "ada",  name: "Cardano",    current_price: 0.78,     price_change_percentage_24h: 0.9,   market_cap: 28000000000,   total_volume: 700000000,   image: TOKEN_LOGOS.ADA },
  AVAX: { id: "avalanche",  symbol: "avax", name: "Avalanche",  current_price: 25,       price_change_percentage_24h: 1.8,   market_cap: 10500000000,   total_volume: 500000000,   image: TOKEN_LOGOS.AVAX },
  TRX:  { id: "tron",       symbol: "trx",  name: "TRON",       current_price: 0.27,     price_change_percentage_24h: 0.4,   market_cap: 23000000000,   total_volume: 600000000,   image: TOKEN_LOGOS.TRX },
  TON:  { id: "toncoin",    symbol: "ton",  name: "Toncoin",    current_price: 3.20,     price_change_percentage_24h: 1.1,   market_cap: 11000000000,   total_volume: 300000000,   image: TOKEN_LOGOS.TON },
  LINK: { id: "chainlink",  symbol: "link", name: "Chainlink",  current_price: 16.50,    price_change_percentage_24h: 2.0,   market_cap: 10500000000,   total_volume: 700000000,   image: TOKEN_LOGOS.LINK },
  SHIB: { id: "shiba-inu",  symbol: "shib", name: "Shiba Inu",  current_price: 0.0000155, price_change_percentage_24h: 1.3,  market_cap: 9200000000,    total_volume: 600000000,   image: TOKEN_LOGOS.SHIB },
  DOT:  { id: "polkadot",   symbol: "dot",  name: "Polkadot",   current_price: 4.80,     price_change_percentage_24h: 1.5,   market_cap: 7500000000,    total_volume: 300000000,   image: TOKEN_LOGOS.DOT },
  LTC:  { id: "litecoin",   symbol: "ltc",  name: "Litecoin",   current_price: 100,      price_change_percentage_24h: 0.7,   market_cap: 7600000000,    total_volume: 500000000,   image: TOKEN_LOGOS.LTC },
  EURC: { id: "euro-coin",  symbol: "eurc", name: "EURC",       current_price: 1.12,     price_change_percentage_24h: 0.05,  market_cap: 200000000,     total_volume: 20000000,    image: TOKEN_LOGOS.EURC },
  PAXG: { id: "pax-gold",   symbol: "paxg", name: "PAX Gold",   current_price: 3300,     price_change_percentage_24h: 0.3,   market_cap: 600000000,     total_volume: 40000000,    image: TOKEN_LOGOS.PAXG },
  USDCh:{ id: "usd-coin",   symbol: "usdc", name: "USD Coin",   current_price: 1.0000,   price_change_percentage_24h: 0.0,   market_cap: 60000000000,   total_volume: 8000000000,  image: TOKEN_LOGOS.USDCh },
  AAVE: { id: "aave",       symbol: "aave", name: "AAVE",       current_price: 150,      price_change_percentage_24h: 0.5,   market_cap: 15000000000,   total_volume: 100000000,   image: TOKEN_LOGOS.AAVE },
  DAI:  { id: "dai",        symbol: "dai",  name: "Dai",        current_price: 1.0000,   price_change_percentage_24h: 0.01,  market_cap: 5300000000,    total_volume: 300000000,   image: TOKEN_LOGOS.DAI },
  XMR:  { id: "monero",     symbol: "xmr",  name: "Monero",     current_price: 334,      price_change_percentage_24h: 1.2,   market_cap: 6200000000,    total_volume: 120000000,   image: TOKEN_LOGOS.XMR },
};

// ─────────────────────────────────────────────────────────────────────
// 5-TIER ORACLE PRICE PIPELINE
// ─────────────────────────────────────────────────────────────────────
//
// T0 — Network Rate : Hedera 0x168 exchange rate (HBAR only, consensus-derived)
// T1 — Chainlink    : On-chain decentralized oracles (most reliable for majors)
// T2 — Binance      : Centralized exchange ticker (real-time, CORS-friendly)
// T3 — CoinGecko    : Market aggregator (enriches with mcap/volume)
// Fallback          : Hardcoded data above (offline resilience)
//
// Each tier merges with the previous, with higher tiers taking priority.
// T0 overrides HBAR price from all other tiers. CoinGecko always enriches
// mcap/volume even when a higher tier provides the price.
// ─────────────────────────────────────────────────────────────────────

// ── Price Cache ────────────────────────────────────────────────────
interface PriceCache {
  data: Record<string, CoinPrice>;
  timestamp: number;
}
const PRICE_CACHE_TTL = 30_000; // 30s
let _priceCache: PriceCache | null = null;

// ── Reverse CoinGecko ID map ─────────────────────────────────────
const GECKO_REVERSE = new Map<string, string>();
for (const [sym, id] of Object.entries(COIN_ID_MAP)) {
  GECKO_REVERSE.set(id, sym);
}

// ── Helper: fetch with timeout ────────────────────────────────────
async function fetchWithTimeout(url: string, timeoutMs: number = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ── Tier 2: Binance batch 24hr ticker ─────────────────────────────
async function fetchBinancePrices(symbols: string[]): Promise<Record<string, CoinPrice>> {
  const result: Record<string, CoinPrice> = {};
  const pairs = symbols
    .map((s) => BINANCE_PAIR_MAP[s])
    .filter(Boolean);
  if (pairs.length === 0) return result;

  try {
    const symbolsParam = encodeURIComponent(JSON.stringify(pairs));
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`;
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) {
      log.debug("Binance", `HTTP ${res.status}`);
      return result;
    }

    const data: any[] = await res.json();
    let count = 0;
    for (const item of data) {
      const sym = BINANCE_REVERSE[item.symbol];
      if (!sym) continue;
      const price = parseFloat(item.lastPrice);
      const change = parseFloat(item.priceChangePercent);
      const volume = parseFloat(item.quoteVolume);
      if (price > 0) {
        const fb = FALLBACK_DATA[sym];
        result[sym] = {
          id: fb?.id || sym.toLowerCase(),
          symbol: sym.toLowerCase(),
          name: fb?.name || sym,
          current_price: price,
          price_change_percentage_24h: isFinite(change) ? change : 0,
          market_cap: fb?.market_cap || 0,
          total_volume: isFinite(volume) ? volume : 0,
          image: TOKEN_LOGOS[sym] || "",
          oracle_source: "binance",
          oracle_updated_at: Math.floor(Date.now() / 1000),
          high_24h: parseFloat(item.highPrice) || undefined,
          low_24h: parseFloat(item.lowPrice) || undefined,
        };
        count++;
      }
    }
    updateOracleStats({ binanceCount: count });
    log.debug("Binance", `${count} prices from batch ticker`);
    return result;
  } catch (err) {
    if (err instanceof TypeError && (err as TypeError).message === "Failed to fetch") {
      log.debug("Binance", "Unreachable (network/CORS)");
    } else {
      log.debug("Binance", "Fetch failed", (err as Error).message);
    }
    return result;
  }
}

// ── HBAR fast-path: single Binance ticker (always included) ───────
async function fetchHbarFastPath(): Promise<CoinPrice | null> {
  try {
    const res = await fetchWithTimeout(
      "https://api.binance.com/api/v3/ticker/24hr?symbol=HBARUSDT",
      4000
    );
    if (!res.ok) return null;
    const d = await res.json();
    const price = parseFloat(d.lastPrice);
    const change = parseFloat(d.priceChangePercent);
    if (price > 0) {
      return {
        id: "hedera-hashgraph",
        symbol: "hbar",
        name: "Hedera",
        current_price: price,
        price_change_percentage_24h: isFinite(change) ? change : 0,
        market_cap: 0,
        total_volume: parseFloat(d.quoteVolume) || 0,
        image: TOKEN_LOGOS.HBAR,
        oracle_source: "binance",
        oracle_updated_at: Math.floor(Date.now() / 1000),
        high_24h: parseFloat(d.highPrice) || undefined,
        low_24h: parseFloat(d.lowPrice) || undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Tier 3: CoinGecko /coins/markets ─────────────────────────────
async function fetchCoinGeckoPrices(symbols: string[]): Promise<Record<string, CoinPrice>> {
  const result: Record<string, CoinPrice> = {};
  const ids = symbols.map((s) => COIN_ID_MAP[s]).filter(Boolean);
  if (ids.length === 0) return result;

  // Deduplicate
  const uniqueIds = [...new Set(ids)];

  try {
    const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${uniqueIds.join(",")}&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=24h`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) {
      log.debug("CoinGecko", `HTTP ${res.status}`);
      return result;
    }

    const data: any[] = await res.json();
    let count = 0;
    for (const coin of data) {
      const sym = GECKO_REVERSE.get(coin.id);
      if (!sym) continue;
      result[sym] = {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        current_price: coin.current_price ?? 0,
        price_change_percentage_24h: coin.price_change_percentage_24h ?? 0,
        market_cap: coin.market_cap ?? 0,
        total_volume: coin.total_volume ?? 0,
        image: coin.image || TOKEN_LOGOS[sym] || "",
        oracle_source: "coingecko",
        oracle_updated_at: Math.floor(Date.now() / 1000),
        high_24h: coin.high_24h ?? undefined,
        low_24h: coin.low_24h ?? undefined,
        sparkline_in_7d: coin.sparkline_in_7d ?? undefined,
      };
      // USDCh shares CoinGecko "usd-coin" with USDC — copy over
      if (sym === "USDC" && !result["USDCh"]) {
        result["USDCh"] = { ...result[sym], oracle_source: "coingecko" };
      }
      count++;
    }
    updateOracleStats({ coingeckoCount: count });
    log.debug("CoinGecko", `${count} prices`);
    return result;
  } catch (err) {
    if (err instanceof TypeError && (err as TypeError).message === "Failed to fetch") {
      log.debug("CoinGecko", "Unreachable (network/CORS)");
    } else {
      log.debug("CoinGecko", "Fetch failed", (err as Error).message);
    }
    return result;
  }
}

// ── Main Pipeline: fetchCoinPrices ────────────────────────────────
// Merges five oracle tiers + HBAR fast-path + fallback.
// Returns Record<symbol, CoinPrice>.
//
// T0: Network Exchange Rate (0x168) — HBAR only, consensus-derived
// T1: Chainlink (19 decentralized feeds via Ethereum RPC)
// T2: Binance (22 WebSocket pairs, real-time)
// T3: CoinGecko (market data enrichment, 24h change, mcap, volume)
// T4: SaucerSwap (server-side only, TVL/depth calculations)
// Fallback: Hardcoded data (offline resilience)
export async function fetchCoinPrices(
  symbols: string[]
): Promise<Record<string, CoinPrice>> {
  // Return cache if fresh
  if (_priceCache && Date.now() - _priceCache.timestamp < PRICE_CACHE_TTL) {
    return { ..._priceCache.data };
  }

  // Start all tiers in parallel (T0 through T2 + fast-path)
  const needsHbar = symbols.includes("HBAR");
  const [chainlinkData, binancePrices, geckoData, hbarFast, networkRate] = await Promise.all([
    fetchChainlinkPrices(symbols).catch(() => ({} as Record<string, ChainlinkPriceData>)),
    fetchBinancePrices(symbols).catch(() => ({} as Record<string, CoinPrice>)),
    fetchCoinGeckoPrices(symbols).catch(() => ({} as Record<string, CoinPrice>)),
    fetchHbarFastPath().catch(() => null),
    // T0: Network Exchange Rate — only fetched if HBAR is in requested symbols
    needsHbar ? fetchNetworkExchangeRate().catch(() => null) : Promise.resolve(null),
  ]);

  // Convert Chainlink data to CoinPrice format
  const chainlinkPrices = chainlinkToCoinPrices(chainlinkData, symbols);

  // Merge: start with fallback, layer CoinGecko, then Binance, then Chainlink
  const merged: Record<string, CoinPrice> = {};
  let fallbackCount = 0;

  for (const sym of symbols) {
    // Start with fallback
    const fb = FALLBACK_DATA[sym];
    if (fb) {
      merged[sym] = { ...fb, oracle_source: "fallback" as OracleSource };
    }

    // Layer 3: CoinGecko (enriches market_cap, volume, image, 24h change)
    const gecko = geckoData[sym];
    if (gecko && gecko.current_price > 0) {
      merged[sym] = {
        ...merged[sym],
        ...gecko,
        oracle_source: "coingecko",
        change_source: isFinite(gecko.price_change_percentage_24h) ? "coingecko" as OracleSource : merged[sym]?.change_source,
      };
    }

    // Layer 2: Binance (better price, real-time)
    const binance = binancePrices[sym];
    if (binance && binance.current_price > 0) {
      merged[sym] = {
        ...merged[sym],
        current_price: binance.current_price,
        price_change_percentage_24h: binance.price_change_percentage_24h,
        oracle_source: "binance",
        oracle_updated_at: binance.oracle_updated_at,
        // Keep CoinGecko's market_cap/volume/image/sparkline if available
        market_cap: merged[sym]?.market_cap || binance.market_cap,
        total_volume: binance.total_volume || merged[sym]?.total_volume || 0,
        change_source: "binance",
        // Binance 24h high/low is more accurate (real-time), fallback to CoinGecko
        high_24h: binance.high_24h || merged[sym]?.high_24h,
        low_24h: binance.low_24h || merged[sym]?.low_24h,
        // Preserve CoinGecko sparkline (Binance tier doesn't provide sparklines)
        sparkline_in_7d: merged[sym]?.sparkline_in_7d,
      };
    }

    // Layer 1: Chainlink (most reliable price — on-chain oracle)
    const cl = chainlinkPrices[sym];
    if (cl && cl.current_price > 0) {
      merged[sym] = {
        ...merged[sym],
        current_price: cl.current_price,
        oracle_source: "chainlink",
        oracle_updated_at: cl.oracle_updated_at,
        chainlink_feed: cl.chainlink_feed,
        // Keep Binance 24h change & CoinGecko market_cap
      };
    }

    // Ensure image is always populated
    if (merged[sym]) {
      if (!merged[sym].image) {
        merged[sym].image = TOKEN_LOGOS[sym] || "";
      }
      if (merged[sym].oracle_source === "fallback") {
        fallbackCount++;
      }
    }
  }

  // HBAR fast-path override (always attempt for fastest HBAR price)
  if (hbarFast && hbarFast.current_price > 0) {
    const existing = merged["HBAR"];
    if (existing) {
      // Only override if we don't have Chainlink
      if (existing.oracle_source !== "chainlink") {
        merged["HBAR"] = {
          ...existing,
          current_price: hbarFast.current_price,
          price_change_percentage_24h: hbarFast.price_change_percentage_24h,
          oracle_source: "binance",
          oracle_updated_at: hbarFast.oracle_updated_at,
          high_24h: hbarFast.high_24h,
          low_24h: hbarFast.low_24h,
        };
      }
    }
  }

  // ── T0: Network Exchange Rate (0x168) — HBAR ONLY ──────────────
  // Highest-priority tier: consensus-derived from Hedera file 0.0.112.
  // Overrides ALL other tiers for HBAR price. Only provides price —
  // keeps 24h change from Binance/CoinGecko and market_cap from CoinGecko.
  if (networkRate && networkRate.priceUsd > 0 && merged["HBAR"]) {
    merged["HBAR"] = {
      ...merged["HBAR"],
      current_price: networkRate.priceUsd,
      oracle_source: "network",
      oracle_updated_at: Math.floor(networkRate.fetchedAt / 1000),
      // Preserve 24h change from lower tiers (network rate doesn't provide it)
      // Preserve market_cap, volume, image from CoinGecko/Binance
    };
    log.debug("T0-ExRate", `HBAR price set to $${networkRate.priceUsd.toFixed(6)} from network exchange rate (${networkRate.rateUsed} rate: ${networkRate.centEquivalent}c/${networkRate.hbarEquivalent}hbar)`);
  }

  updateOracleStats({
    fallbackCount,
    totalFeeds: symbols.length,
  });

  // Cache
  _priceCache = { data: merged, timestamp: Date.now() };

  const sources: Record<string, number> = { network: 0, chainlink: 0, binance: 0, coingecko: 0, fallback: 0 };
  for (const cp of Object.values(merged)) {
    const s = cp.oracle_source || "fallback";
    if (s in sources) sources[s]++;
  }
  log.debug("Pipeline", `Prices: T0=${sources.network} CL=${sources.chainlink} BN=${sources.binance} CG=${sources.coingecko} FB=${sources.fallback}`);

  return merged;
}

// ── Global Market Data ────────────────────────────────────────────
export interface GlobalMarketData {
  totalMarketCap: number;
  totalVolume24h: number;
  marketCapChange24h: number;
  btcDominance: number;
  ethDominance: number;
  activeCryptos: number;
}

// Cache for global market data (60s TTL — refreshes every 120s from Dashboard)
let _globalCache: { data: GlobalMarketData; ts: number } | null = null;
const GLOBAL_CACHE_TTL = 60_000;

export async function fetchGlobalMarketData(): Promise<GlobalMarketData | null> {
  // Return cache if fresh
  if (_globalCache && Date.now() - _globalCache.ts < GLOBAL_CACHE_TTL) {
    return _globalCache.data;
  }

  try {
    const res = await fetchWithTimeout(`${COINGECKO_API}/global`, 8000);
    if (!res.ok) return _globalCache?.data ?? null;
    const json = await res.json();
    const d = json.data;
    if (!d) return _globalCache?.data ?? null;
    const result: GlobalMarketData = {
      totalMarketCap: d.total_market_cap?.usd ?? 0,
      totalVolume24h: d.total_volume?.usd ?? 0,
      marketCapChange24h: d.market_cap_change_percentage_24h_usd ?? 0,
      btcDominance: d.market_cap_percentage?.btc ?? 0,
      ethDominance: d.market_cap_percentage?.eth ?? 0,
      activeCryptos: d.active_cryptocurrencies ?? 0,
    };
    _globalCache = { data: result, ts: Date.now() };
    return result;
  } catch (err) {
    log.debug("CoinGecko", "Global market data fetch failed", (err as Error).message);
    return _globalCache?.data ?? null;
  }
}

// ── Format Helpers ────────────────────────────────────────────────
export function formatMarketCap(n: number): string {
  if (!n || !isFinite(n)) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function formatVolume(n: number): string {
  if (!n || !isFinite(n)) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(2)}`;
}

// ── CoinCap History ────────────────────────────────────────────────
export interface HistoryPoint {
  time: number;     // Unix ms
  priceUsd: number;
}

export async function fetchCoinCapHistory(
  symbol: string,
  interval: "m1" | "m5" | "m15" | "m30" | "h1" | "h2" | "h6" | "h12" | "d1" = "h1",
  days: number = 7
): Promise<HistoryPoint[]> {
  const coinCapId = COINCAP_ID_MAP[symbol];
  if (!coinCapId) return [];

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  try {
    const url = `${COINCAP_API}/assets/${coinCapId}/history?interval=${interval}&start=${startMs}&end=${endMs}`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) {
      log.debug("CoinCap", `HTTP ${res.status} for ${symbol}`);
      return [];
    }

    const json = await res.json();
    const data: any[] = json.data || [];
    return data
      .map((p: any) => ({
        time: p.time,
        priceUsd: parseFloat(p.priceUsd),
      }))
      .filter((p) => isFinite(p.priceUsd) && p.priceUsd > 0);
  } catch (err) {
    log.debug("CoinCap", `History fetch failed for ${symbol}`, (err as Error).message);
    return [];
  }
}

// ── RSI Computation ───────────────────────────────────────────────
function computeRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50; // Not enough data

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }

  avgGain /= period;
  avgLoss /= period;

  // Smooth over remaining closes
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── Market RSI (BTC-based) ────────────────────────────────────────
export async function fetchMarketRSI(): Promise<{ rsi: number; prices: number[] }> {
  try {
    const history = await fetchCoinCapHistory("BTC", "d1", 30);
    if (history.length < 16) return { rsi: 50, prices: [] };

    // Aggregate to daily closes
    const dailyMap = new Map<string, number>();
    for (const p of history) {
      const dateKey = new Date(p.time).toISOString().slice(0, 10);
      dailyMap.set(dateKey, p.priceUsd); // Last value per day = close
    }

    const dailyCloses: number[] = [];
    const sortedKeys = [...dailyMap.keys()].sort();
    for (const key of sortedKeys) {
      dailyCloses.push(dailyMap.get(key)!);
    }

    // Need at least 15 closes for 14-period RSI
    if (dailyCloses.length > 14) {
      const rsi = computeRSI(dailyCloses, 14);
      return { rsi: Math.round(rsi * 100) / 100, prices: dailyCloses.slice(-30) };
    }

    return { rsi: 50, prices: dailyCloses };
  } catch (err) {
    log.debug("RSI", "Calculation failed", (err as Error).message);
    return { rsi: 50, prices: [] };
  }
}

// ── Top 20 Index (CoinGecko) ──────────────────────────────────────
export interface Top20Coin {
  symbol: string;
  name: string;
  image: string;
  price: number;
  change24h: number;
  marketCap: number;
  dominancePercent: number;
}

export interface Top20IndexData {
  totalMarketCap: number;
  weightedChange24h: number;
  topCoins: Top20Coin[];
  topCoinCount: number;
}

export async function fetchTop20Index(): Promise<Top20IndexData | null> {
  try {
    const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) return null;

    const data: any[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    let totalMcap = 0;
    const coins: Top20Coin[] = [];

    for (const coin of data) {
      const mcap = coin.market_cap || 0;
      totalMcap += mcap;
      coins.push({
        symbol: (coin.symbol || "").toUpperCase(),
        name: coin.name || "",
        image: coin.image || "",
        price: coin.current_price || 0,
        change24h: coin.price_change_percentage_24h || 0,
        marketCap: mcap,
        dominancePercent: 0, // calculated below
      });
    }

    // Compute dominance percentages
    if (totalMcap > 0) {
      for (const c of coins) {
        c.dominancePercent = (c.marketCap / totalMcap) * 100;
      }
    }

    // Weighted 24h change
    let weightedChange = 0;
    if (totalMcap > 0) {
      for (const c of coins) {
        weightedChange += (c.marketCap / totalMcap) * c.change24h;
      }
    }

    return {
      totalMarketCap: totalMcap,
      weightedChange24h: Math.round(weightedChange * 100) / 100,
      topCoins: coins,
      topCoinCount: coins.length,
    };
  } catch (err) {
    log.debug("CoinGecko", "Top20 index fetch failed", (err as Error).message);
    return null;
  }
}
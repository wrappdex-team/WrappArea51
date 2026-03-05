// IMPLEMENTATION NOTE: COINCAP_API const removed — all CoinCap requests
// now route through the server proxy (coincap-proxy.ts) which holds the API key.
// IMPLEMENTATION NOTE: COINGECKO_API const removed — all CoinGecko requests
// now route through the server proxy (coingecko-proxy.ts) to avoid CORS blocks.

// ── CoinCap Proxy (server-side API key injection) ─────────────────
// CoinCap now requires an API key. The key is stored server-side.
// All CoinCap requests route through our Edge Function proxy.
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
const COINCAP_PROXY_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/coincap-proxy`;

async function fetchCoinCapViaProxy(path: string, timeoutMs: number = 8000): Promise<Response> {
  const url = `${COINCAP_PROXY_BASE}?path=${encodeURIComponent(path)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${publicAnonKey}`,
        "Accept": "application/json",
      },
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── CoinGecko Proxy (server-side CORS bypass) ────────────────────
// CoinGecko free tier CORS-blocks browser requests from custom domains.
// All CoinGecko requests route through our Edge Function proxy which
// has a 2-min cache for prices and 5-min cache for OHLC data.
const COINGECKO_PROXY_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/coingecko-proxy`;

export async function fetchCoinGeckoViaProxy(path: string, timeoutMs: number = 10000): Promise<Response> {
  const url = `${COINGECKO_PROXY_BASE}?path=${encodeURIComponent(path)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${publicAnonKey}`,
        "Accept": "application/json",
      },
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

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
  XLM: "XLMUSDT",
  UNI: "UNIUSDT",
  HYPE: "HYPEUSDT",
  // IMPLEMENTATION NOTE: Canton (CC) is NOT listed on Binance.
  // Do NOT add CC here — one invalid pair kills the entire batch request (HTTP 400).
};

// Reverse map: Binance pair -> our symbol
const BINANCE_REVERSE: Record<string, string> = {};
for (const [sym, pair] of Object.entries(BINANCE_PAIR_MAP)) {
  if (pair) BINANCE_REVERSE[pair] = sym;
}

// CoinCap IDs (used for chart history AND price fallback for non-Binance tokens)
export const COINCAP_ID_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", USDT: "tether", BNB: "binance-coin",
  SOL: "solana", USDC: "usd-coin", XRP: "xrp", HBAR: "hedera-hashgraph",
  DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche", TRX: "tron",
  TON: "toncoin", LINK: "chainlink", SHIB: "shiba-inu", DOT: "polkadot",
  LTC: "litecoin", PAXG: "pax-gold", EURC: "euro-coin",
  USDCh: "usd-coin", AAVE: "aave",
  DAI: "multi-collateral-dai",
  XMR: "monero",
  XLM: "stellar",
  UNI: "uniswap",
  HYPE: "hyperliquid",
  // IMPLEMENTATION NOTE: Canton (CC) is NOT listed on CoinCap — no valid asset ID.
  // Chart fallback cascade handles it via CoinGecko OHLC → synthetic.
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
  LTC: "litecoin", PAXG: "pax-gold", EURC: "eurc",
  USDCh: "usd-coin", AAVE: "aave",
  DAI: "dai",
  XMR: "monero",
  XLM: "stellar",
  UNI: "uniswap",
  HYPE: "hyperliquid",
  CC: "canton-network",
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
  XLM: `${CG}/100/standard/Stellar_symbol_black_RGB.png`,
  UNI: `${CG}/12504/standard/uni.jpg`,
  // IMPLEMENTATION NOTE: HYPE and CC use coin-images.coingecko.com (newer CDN).
  // The CoinGecko /coins/markets API returns the authoritative `image` URL at
  // runtime — these are fallback-only. If they 404, the Dashboard TokenLogo
  // retries via icon-proxy, then falls back to gradient letter-avatar.
  HYPE: "https://coin-images.coingecko.com/coins/images/40845/standard/hype.png",
  CC: "https://coin-images.coingecko.com/coins/images/37249/standard/canton_network.png",
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

// ── History Point (CoinCap chart data) ────────────────────────────
export interface HistoryPoint {
  priceUsd: number;
  time: number;
  date: string;
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

// ── Top 20 Index Types ────────────────────────────────────────────
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

// ── Sparkline Map ─────────────────────────────────────────────────
export type SparklineMap = Record<string, number[]>;

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
  XLM:  { id: "stellar",    symbol: "xlm",  name: "Stellar",    current_price: 0.15,     price_change_percentage_24h: 0.2,   market_cap: 10000000000,   total_volume: 1000000000,  image: TOKEN_LOGOS.XLM },
  UNI:  { id: "uniswap",    symbol: "uni",  name: "Uniswap",    current_price: 15,       price_change_percentage_24h: 0.5,   market_cap: 10000000000,   total_volume: 500000000,   image: TOKEN_LOGOS.UNI },
  HYPE: { id: "hyperliquid",symbol: "hype", name: "Hyperliquid", current_price: 15,      price_change_percentage_24h: 2.0,   market_cap: 5000000000,    total_volume: 300000000,   image: TOKEN_LOGOS.HYPE },
  CC:   { id: "canton-network", symbol: "cc", name: "Canton Network", current_price: 0.012, price_change_percentage_24h: 1.5, market_cap: 500000000,   total_volume: 50000000,    image: TOKEN_LOGOS.CC },
};

// ─────────────────────────────────────────────────────────────────────
// 5-TIER ORACLE PRICE PIPELINE
// ─────────────────────────────────────────────────────────────────────
//
// T0 — Network Rate : Hedera 0x168 exchange rate (HBAR only, consensus-derived)
// T1 — Chainlink    : On-chain decentralized oracles (most reliable for majors)
// T2 — Binance      : Centralized exchange ticker (real-time, CORS-friendly)
// T2.5 — CoinCap    : Market aggregator (enriches with mcap/volume)
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
// IMPLEMENTATION NOTE: Binance returns HTTP 400 if ANY symbol in the
// batch is invalid (e.g. delisted or futures-only). To prevent one bad
// pair from killing ALL prices, we split into "proven" (historically
// reliable) and "unproven" (newer additions). Proven pairs use a
// single batch request for speed; unproven pairs use individual
// requests so a failure is isolated.
const PROVEN_BINANCE_PAIRS = new Set([
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "HBARUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "TRXUSDT", "TONUSDT", "LINKUSDT",
  "SHIBUSDT", "DOTUSDT", "LTCUSDT", "PAXGUSDT", "AAVEUSDT", "DAIUSDT",
]);

/** Parse a single Binance ticker item into a CoinPrice */
function parseBinanceTicker(item: any, sym: string): CoinPrice | null {
  const price = parseFloat(item.lastPrice);
  const change = parseFloat(item.priceChangePercent);
  const volume = parseFloat(item.quoteVolume);
  if (price <= 0) return null;
  const fb = FALLBACK_DATA[sym];
  return {
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
}

async function fetchBinancePrices(symbols: string[]): Promise<Record<string, CoinPrice>> {
  const result: Record<string, CoinPrice> = {};

  // Split pairs into proven (batch-safe) and unproven (individual fetch)
  const provenPairs: string[] = [];
  const provenSyms: string[] = [];
  const unprovenPairs: { sym: string; pair: string }[] = [];

  for (const s of symbols) {
    const pair = BINANCE_PAIR_MAP[s];
    if (!pair) continue;
    if (PROVEN_BINANCE_PAIRS.has(pair)) {
      provenPairs.push(pair);
      provenSyms.push(s);
    } else {
      unprovenPairs.push({ sym: s, pair });
    }
  }

  // ── Batch request for proven pairs ──
  let batchSucceeded = false;
  if (provenPairs.length > 0) {
    try {
      const symbolsParam = encodeURIComponent(JSON.stringify(provenPairs));
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`;
      const res = await fetchWithTimeout(url, 6000);
      if (res.ok) {
        const data: any[] = await res.json();
        for (const item of data) {
          const sym = BINANCE_REVERSE[item.symbol];
          if (!sym) continue;
          const cp = parseBinanceTicker(item, sym);
          if (cp) result[sym] = cp;
        }
        batchSucceeded = true;
      } else {
        log.debug("Binance", `Batch HTTP ${res.status} — falling back to individual`);
      }
    } catch (err) {
      log.debug("Binance", "Batch failed", (err as Error).message);
    }
  }

  // If batch failed, fetch proven pairs individually too
  if (!batchSucceeded && provenPairs.length > 0) {
    const individualProven = provenSyms.map(s => ({ sym: s, pair: BINANCE_PAIR_MAP[s] }));
    unprovenPairs.push(...individualProven);
  }

  // ── Individual requests for unproven / failed pairs ──
  if (unprovenPairs.length > 0) {
    const individualResults = await Promise.all(
      unprovenPairs.map(async ({ sym, pair }) => {
        try {
          const res = await fetchWithTimeout(
            `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`,
            4000
          );
          if (!res.ok) {
            log.debug("Binance", `Individual ${pair}: HTTP ${res.status}`);
            return null;
          }
          const item = await res.json();
          const cp = parseBinanceTicker(item, sym);
          return cp ? { sym, cp } : null;
        } catch {
          log.debug("Binance", `Individual ${pair}: failed`);
          return null;
        }
      })
    );
    for (const r of individualResults) {
      if (r) result[r.sym] = r.cp;
    }
  }

  const count = Object.keys(result).length;
  updateOracleStats({ binanceCount: count });
  log.debug("Binance", `${count} prices (${batchSucceeded ? "batch" : "individual"})`);
  return result;
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

// ── Tier 2.5: CoinCap individual asset price (non-Binance tokens) ─
// CoinCap now requires an API key. All requests go through our server proxy.
// Used as a safety net for tokens not covered by Binance (XMR, EURC, CC).
// IMPLEMENTATION NOTE: v3 batch endpoint (/assets?ids=bitcoin,ethereum,...)
// fetches ALL eligible tokens in a SINGLE request — much more efficient
// than N individual /assets/{id} calls. The proxy (coincap-proxy.ts)
// tries v3 primary, v2 degraded fallback, with the API key from env.

async function fetchCoinCapPrices(symbols: string[]): Promise<Record<string, CoinPrice>> {
  const result: Record<string, CoinPrice> = {};
  // Only fetch tokens that have a CoinCap ID but NOT a Binance pair
  const eligible = symbols.filter(s => COINCAP_ID_MAP[s] && !BINANCE_PAIR_MAP[s]);
  if (eligible.length === 0) return result;

  log.debug("CoinCap", `Fetching ${eligible.length} non-Binance tokens via v3 batch proxy: ${eligible.join(", ")}`);

  // Build reverse map: CoinCap assetId → our symbol
  const idToSym: Record<string, string> = {};
  const assetIds: string[] = [];
  for (const sym of eligible) {
    const assetId = COINCAP_ID_MAP[sym];
    if (assetId) {
      idToSym[assetId] = sym;
      assetIds.push(assetId);
    }
  }

  // Single batch request: /assets?ids=bitcoin,ethereum,...&limit=2000
  try {
    const batchPath = `/assets?ids=${assetIds.join(",")}&limit=2000`;
    const res = await fetchCoinCapViaProxy(batchPath, 8000);
    if (!res.ok) {
      log.debug("CoinCap", `Batch proxy returned HTTP ${res.status} — skipping price tier`);
      return result;
    }
    const json = await res.json();
    const assets: any[] = json.data || [];

    for (const asset of assets) {
      // Match by id (e.g. "bitcoin") — CoinCap returns the id field
      const sym = idToSym[asset.id];
      if (!sym) continue;

      const price = parseFloat(asset.priceUsd);
      const change = parseFloat(asset.changePercent24Hr);
      const mcap = parseFloat(asset.marketCapUsd);
      const vol = parseFloat(asset.volumeUsd24Hr);
      const fb = FALLBACK_DATA[sym];

      if (price > 0) {
        result[sym] = {
          id: fb?.id || asset.id,
          symbol: (asset.symbol || sym).toLowerCase(),
          name: asset.name || fb?.name || sym,
          current_price: price,
          price_change_percentage_24h: isFinite(change) ? change : 0,
          market_cap: isFinite(mcap) ? mcap : (fb?.market_cap || 0),
          total_volume: isFinite(vol) ? vol : 0,
          image: TOKEN_LOGOS[sym] || "",
          oracle_source: "coincap",
          oracle_updated_at: Math.floor(Date.now() / 1000),
          change_source: isFinite(change) ? "coincap" : undefined,
        };
        log.debug("CoinCap", `${sym}: $${price.toFixed(4)}`);
      }
    }

    const count = Object.keys(result).length;
    log.debug("CoinCap", `${count}/${eligible.length} prices via v3 batch proxy`);
  } catch (err) {
    const msg = (err as Error)?.message || "unknown";
    log.debug("CoinCap", `Batch proxy failed: ${msg.slice(0, 80)} — skipping price tier`);
  }

  return result;
}

// ── Tier 3: CoinGecko /coins/markets ─────────────────────────────
// IMPLEMENTATION NOTE: Routes through server proxy (coingecko-proxy.ts)
// to avoid CORS blocks from direct browser → CoinGecko requests.
async function fetchCoinGeckoPrices(symbols: string[]): Promise<Record<string, CoinPrice>> {
  const result: Record<string, CoinPrice> = {};
  const ids = symbols.map((s) => COIN_ID_MAP[s]).filter(Boolean);
  if (ids.length === 0) return result;

  // Deduplicate
  const uniqueIds = [...new Set(ids)];

  try {
    const path = `/coins/markets?vs_currency=usd&ids=${uniqueIds.join(",")}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
    const res = await fetchCoinGeckoViaProxy(path, 10000);
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

// ── Persistent image cache ───────────────────────────────────────
// CoinGecko API returns authoritative logo URLs at runtime, but on
// rate-limited refreshes those are lost. This cache survives across
// the 30s price refresh cycle so logos never disappear.
const _imageCache: Record<string, string> = {};

// ── Last-good data cache ─────────────────────────────────────────
// When a token falls to "fallback" oracle source, substitute the last
// successful live data (up to 5 min old) to prevent stale fallback
// prices from flashing on screen during transient API failures.
const _lastGoodData: Record<string, { cp: CoinPrice; ts: number }> = {};
const LAST_GOOD_TTL = 300_000; // 5 minutes

// ── Main Pipeline: fetchCoinPrices ────────────────────────────────
// Merges six oracle tiers + HBAR fast-path + fallback.
// Returns Record<symbol, CoinPrice>.
//
// T0: Network Exchange Rate (0x168) — HBAR only, consensus-derived
// T1: Chainlink (19 decentralized feeds via Ethereum RPC)
// T2: Binance (proven batch + individual for unproven)
// T2.5: CoinCap (non-Binance tokens — XMR, EURC, etc.)
// T3: CoinGecko (market data enrichment, 24h change, mcap, volume)
// Fallback: Hardcoded data (offline resilience)
export async function fetchCoinPrices(
  symbols: string[]
): Promise<Record<string, CoinPrice>> {
  // Return cache if fresh
  if (_priceCache && Date.now() - _priceCache.timestamp < PRICE_CACHE_TTL) {
    return { ..._priceCache.data };
  }

  // Start all tiers in parallel (T0 through T3 + fast-path + CoinCap)
  const needsHbar = symbols.includes("HBAR");
  const [chainlinkData, binancePrices, coinCapPrices, geckoData, hbarFast, networkRate] = await Promise.all([
    fetchChainlinkPrices(symbols).catch(() => ({} as Record<string, ChainlinkPriceData>)),
    fetchBinancePrices(symbols).catch(() => ({} as Record<string, CoinPrice>)),
    fetchCoinCapPrices(symbols).catch(() => ({} as Record<string, CoinPrice>)),
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

    // Layer 2.5: CoinCap (non-Binance tokens — XMR, EURC, etc.)
    const capPrice = coinCapPrices[sym];
    if (capPrice && capPrice.current_price > 0) {
      merged[sym] = {
        ...merged[sym],
        current_price: capPrice.current_price,
        price_change_percentage_24h: capPrice.price_change_percentage_24h,
        oracle_source: "coincap",
        oracle_updated_at: capPrice.oracle_updated_at,
        change_source: isFinite(capPrice.price_change_percentage_24h) ? "coincap" as OracleSource : merged[sym]?.change_source,
        // Keep CoinGecko market_cap if available, else use CoinCap's
        market_cap: merged[sym]?.market_cap || capPrice.market_cap,
        total_volume: capPrice.total_volume || merged[sym]?.total_volume || 0,
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

    // Ensure image is always populated + cache authoritative logos
    if (merged[sym]) {
      // Cache any runtime logo URL from CoinGecko API
      const img = merged[sym].image;
      if (img && img.startsWith("http")) {
        _imageCache[sym] = img;
      }
      // Use cached logo > static TOKEN_LOGOS > empty
      if (!merged[sym].image || !merged[sym].image.startsWith("http")) {
        merged[sym].image = _imageCache[sym] || TOKEN_LOGOS[sym] || "";
      }

      // Last-good-data: persist live data, recover from transient failures
      if (merged[sym].oracle_source !== "fallback") {
        _lastGoodData[sym] = { cp: { ...merged[sym] }, ts: Date.now() };
      } else {
        // Check if we have recent live data to substitute
        const lastGood = _lastGoodData[sym];
        if (lastGood && Date.now() - lastGood.ts < LAST_GOOD_TTL) {
          merged[sym] = { ...lastGood.cp, oracle_source: lastGood.cp.oracle_source };
          log.debug("Pipeline", `${sym}: using last-good data (${lastGood.cp.oracle_source}, ${Math.round((Date.now() - lastGood.ts) / 1000)}s old)`);
        } else {
          fallbackCount++;
        }
      }
    }
  }

  // HBAR fast-path: if main Binance batch missed HBAR, use dedicated ticker
  if (needsHbar && hbarFast && hbarFast.current_price > 0 && (!merged["HBAR"] || merged["HBAR"].oracle_source === "fallback")) {
    merged["HBAR"] = {
      ...merged["HBAR"],
      current_price: hbarFast.current_price,
      price_change_percentage_24h: hbarFast.price_change_percentage_24h,
      oracle_source: "binance",
      oracle_updated_at: hbarFast.oracle_updated_at,
      total_volume: hbarFast.total_volume || merged["HBAR"]?.total_volume || 0,
      high_24h: hbarFast.high_24h || merged["HBAR"]?.high_24h,
      low_24h: hbarFast.low_24h || merged["HBAR"]?.low_24h,
    };
  }

  // T0: Network Exchange Rate — overrides HBAR price with consensus-derived rate
  if (needsHbar && networkRate && networkRate.priceUsd > 0) {
    if (merged["HBAR"]) {
      merged["HBAR"].current_price = networkRate.priceUsd;
      merged["HBAR"].oracle_source = "network";
      merged["HBAR"].oracle_updated_at = Math.floor(Date.now() / 1000);
    }
  }

  // Ensure USDCh is always populated (mirrors USDC data)
  if (symbols.includes("USDCh") && !merged["USDCh"] && merged["USDC"]) {
    merged["USDCh"] = { ...merged["USDC"], oracle_source: merged["USDC"].oracle_source };
  }

  // Update oracle stats
  updateOracleStats({ fallbackCount });

  // Log summary
  const sources = new Map<string, number>();
  for (const cp of Object.values(merged)) {
    const src = cp.oracle_source || "unknown";
    sources.set(src, (sources.get(src) || 0) + 1);
  }
  const summary = [...sources.entries()].map(([k, v]) => `${k}:${v}`).join(" ");
  log.debug("Pipeline", `${Object.keys(merged).length} prices (${summary})`);

  // Cache
  _priceCache = { data: merged, timestamp: Date.now() };
  return { ...merged };
}

// ── CoinCap History (chart data) ──────────────────────────────────
// IMPLEMENTATION NOTE: Routes through server proxy (coincap-proxy.ts)
// which adds the API key and tries v3 primary, v2 degraded fallback.
export async function fetchCoinCapHistory(
  symbol: string,
  interval: string,
  days: number
): Promise<HistoryPoint[]> {
  const assetId = COINCAP_ID_MAP[symbol];
  if (!assetId) return [];

  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;

  try {
    const path = `/assets/${assetId}/history?interval=${interval}&start=${start}&end=${end}`;
    const res = await fetchCoinCapViaProxy(path, 8000);
    if (!res.ok) {
      log.debug("CoinCap", `Proxy history: HTTP ${res.status} for ${symbol}`);
      return [];
    }
    const json = await res.json();
    const data: any[] = json.data || [];
    if (data.length > 0) {
      log.debug("CoinCap", `${symbol} history: ${data.length} points via proxy`);
      return data.map((d: any) => ({
        priceUsd: parseFloat(d.priceUsd) || 0,
        time: d.time,
        date: d.date || new Date(d.time).toISOString(),
      }));
    }
  } catch (err) {
    log.debug("CoinCap", `Proxy history failed for ${symbol}: ${(err as Error)?.message?.slice(0, 60) || "unknown"}`);
  }

  return [];
}

// ── Format Helpers ────────────────────────────────────────────────
export function formatMarketCap(value: number): string {
  if (!value || !isFinite(value)) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatVolume(value: number): string {
  if (!value || !isFinite(value)) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

// ── Global Market Data (CoinGecko /global) ────────────────────────
// IMPLEMENTATION NOTE: Routes through server proxy to avoid CORS blocks.
export async function fetchGlobalMarketData(): Promise<GlobalMarketData | null> {
  try {
    const res = await fetchCoinGeckoViaProxy("/global", 10000);
    if (!res.ok) {
      log.debug("CoinGecko", `Global: HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const data = json.data;
    if (!data) return null;

    return {
      totalMarketCap: data.total_market_cap?.usd ?? 0,
      totalVolume24h: data.total_volume?.usd ?? 0,
      marketCapChange24h: data.market_cap_change_percentage_24h_usd ?? 0,
      btcDominance: data.market_cap_percentage?.btc ?? 0,
      ethDominance: data.market_cap_percentage?.eth ?? 0,
      activeCryptos: data.active_cryptocurrencies ?? 0,
    };
  } catch (err) {
    log.debug("CoinGecko", "Global fetch failed", (err as Error).message);
    return null;
  }
}

// ── Compute Approximate Global Data from merged prices ────────────
// Used as a fast fallback when CoinGecko /global is slow or unavailable.
export function computeApproxGlobalData(prices: Record<string, CoinPrice>): GlobalMarketData {
  let totalMarketCap = 0;
  let totalVolume = 0;
  let btcMarketCap = 0;
  let ethMarketCap = 0;

  for (const [sym, cp] of Object.entries(prices)) {
    totalMarketCap += cp.market_cap || 0;
    totalVolume += cp.total_volume || 0;
    if (sym === "BTC") btcMarketCap = cp.market_cap || 0;
    if (sym === "ETH") ethMarketCap = cp.market_cap || 0;
  }

  return {
    totalMarketCap,
    totalVolume24h: totalVolume,
    marketCapChange24h: 0, // Cannot compute without historical data
    btcDominance: totalMarketCap > 0 ? (btcMarketCap / totalMarketCap) * 100 : 50,
    ethDominance: totalMarketCap > 0 ? (ethMarketCap / totalMarketCap) * 100 : 15,
    activeCryptos: 0, // Cannot determine from price data alone
  };
}

// ── Market RSI (14-period RSI based on BTC daily closes) ──────────
export async function fetchMarketRSI(): Promise<{ rsi: number }> {
  try {
    // Use Binance BTC 1d klines for RSI calculation (14 periods + buffer)
    const url = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=30";
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return { rsi: 50 };
    const klines: any[] = await res.json();

    const closes = klines.map((k: any) => parseFloat(k[4]));
    if (closes.length < 15) return { rsi: 50 };

    // Standard 14-period RSI
    const period = 14;
    let gainSum = 0;
    let lossSum = 0;

    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gainSum += diff;
      else lossSum += Math.abs(diff);
    }

    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;

    // Smooth with remaining data points
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return { rsi: 100 };
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return { rsi: Math.round(rsi * 100) / 100 };
  } catch {
    return { rsi: 50 };
  }
}

// ── Sparklines (Binance 7-day klines for mini charts) ─────────────
export async function fetchAllSparklines(symbols: string[]): Promise<SparklineMap> {
  const result: SparklineMap = {};

  // Fetch in parallel batches of 6 to avoid rate limits
  const BATCH_SIZE = 6;
  const eligible = symbols.filter((s) => BINANCE_PAIR_MAP[s]);

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (sym) => {
      const pair = BINANCE_PAIR_MAP[sym];
      if (!pair) return;
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1h&limit=168`;
        const res = await fetchWithTimeout(url, 5000);
        if (!res.ok) return;
        const klines: any[] = await res.json();
        result[sym] = klines.map((k: any) => parseFloat(k[4])); // close prices
      } catch {
        // Skip this symbol
      }
    });
    await Promise.all(promises);
    // Small delay between batches to avoid Binance rate limits
    if (i + BATCH_SIZE < eligible.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return result;
}

// ── Top 20 Composite Index ────────────────────────────────────────
// IMPLEMENTATION NOTE: Routes through server proxy to avoid CORS blocks.
export async function fetchTop20Index(): Promise<Top20IndexData | null> {
  try {
    const path = `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`;
    const res = await fetchCoinGeckoViaProxy(path, 10000);
    if (!res.ok) {
      log.debug("CoinGecko", `Top20: HTTP ${res.status}`);
      return null;
    }

    const data: any[] = await res.json();
    if (!data || data.length === 0) return null;

    let totalMcap = 0;
    let weightedChangeSum = 0;

    const coins: Top20Coin[] = data.map((coin: any) => {
      const mcap = coin.market_cap ?? 0;
      totalMcap += mcap;
      return {
        symbol: (coin.symbol || "").toUpperCase(),
        name: coin.name || "",
        image: coin.image || "",
        price: coin.current_price ?? 0,
        change24h: coin.price_change_percentage_24h ?? 0,
        marketCap: mcap,
        dominancePercent: 0, // Computed below
      };
    });

    // Compute dominance percentages and weighted change
    for (const coin of coins) {
      coin.dominancePercent = totalMcap > 0 ? (coin.marketCap / totalMcap) * 100 : 0;
      weightedChangeSum += coin.change24h * (coin.dominancePercent / 100);
    }

    return {
      totalMarketCap: totalMcap,
      weightedChange24h: weightedChangeSum,
      topCoins: coins,
      topCoinCount: coins.length,
    };
  } catch (err) {
    log.debug("CoinGecko", "Top20 fetch failed", (err as Error).message);
    return null;
  }
}
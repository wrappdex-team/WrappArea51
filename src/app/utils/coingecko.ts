const COINCAP_API = "https://api.coincap.io/v2";
const COINGECKO_API = "https://api.coingecko.com/api/v3";

import { fetchChainlinkPrices, chainlinkToCoinPrices, updateOracleStats } from "./chainlink";
import type { ChainlinkPriceData } from "./chainlink";
import { log } from "./logger";

// ── Binance Symbol Map ─────────────────────────────────────────────
// Maps canonical symbol to Binance USDT trading pair.
// Free, no API key, excellent CORS, real-time, covers all majors.
//
// IMPORTANT: Every pair here MUST exist on Binance. The batch
// ticker/24hr endpoint returns HTTP 400 if ANY symbol is invalid,
// killing the ENTIRE request. EURC is intentionally excluded
// (no EURCUSDT pair on Binance).
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
};

export const TOKEN_LOGOS: Record<string, string> = {
  BTC: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  ETH: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  USDT: "https://assets.coingecko.com/coins/images/325/large/Tether.png",
  BNB: "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
  SOL: "https://assets.coingecko.com/coins/images/4128/large/solana.png",
  USDC: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  XRP: "https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",
  HBAR: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  DOGE: "https://assets.coingecko.com/coins/images/5/large/dogecoin.png",
  ADA: "https://assets.coingecko.com/coins/images/975/large/cardano.png",
  AVAX: "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
  TRX: "https://assets.coingecko.com/coins/images/1094/large/tron-logo.png",
  TON: "https://assets.coingecko.com/coins/images/17980/large/ton_symbol.png",
  LINK: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  SHIB: "https://assets.coingecko.com/coins/images/11939/large/shiba.png",
  DOT: "https://assets.coingecko.com/coins/images/12171/large/polkadot.png",
  LTC: "https://assets.coingecko.com/coins/images/2/large/litecoin.png",
  EURC: "https://assets.coingecko.com/coins/images/26045/large/euro-coin.png",
  PAXG: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="gc" x1=".2" y1="0" x2=".8" y2="1"><stop offset="0%" stop-color="#FDE68A"/><stop offset="35%" stop-color="#F59E0B"/><stop offset="70%" stop-color="#D97706"/><stop offset="100%" stop-color="#92400E"/></linearGradient><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FBBF24"/><stop offset="100%" stop-color="#B45309"/></linearGradient><linearGradient id="gs" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#FEF3C7" stop-opacity=".6"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/></linearGradient></defs><circle cx="100" cy="100" r="98" fill="url(#gc)"/><circle cx="100" cy="100" r="88" fill="none" stroke="#92400E" stroke-width="2.5" opacity=".4"/><circle cx="100" cy="100" r="84" fill="none" stroke="#FDE68A" stroke-width="1" opacity=".3"/><circle cx="100" cy="100" r="40" fill="url(#gs)"/><path d="M72 68h56l-8 48H80z" fill="url(#gb)" stroke="#92400E" stroke-width="2.5" stroke-linejoin="round"/><line x1="80" y1="80" x2="120" y2="80" stroke="#FDE68A" stroke-width="1.5" opacity=".5"/><line x1="82" y1="92" x2="118" y2="92" stroke="#FDE68A" stroke-width="1.5" opacity=".5"/><line x1="83" y1="104" x2="117" y2="104" stroke="#FDE68A" stroke-width="1.5" opacity=".5"/><text x="100" y="152" text-anchor="middle" fill="#4A1E00" font-size="22" font-weight="bold" font-family="Arial,sans-serif" letter-spacing="2">PAXG</text></svg>')}`,
  USDCh: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  AAVE: "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png",
  DAI: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
};

// ── Oracle Source Types ────────────────────────────────────────────
export type OracleSource = "chainlink" | "binance" | "coincap" | "coingecko" | "fallback";

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
};

// ─────────────────────────────────────────────────────────────────────
// SIMPLIFIED PRICE PIPELINE
// ─────────────────────────────────────────────────────────────────────
//
// Tier 1 — Chainlink  : On-chain decentralized oracles (most reliable)
// Tier 2 — Binance    : Centralized exchange ticker (real-time, CORS-friendly)
// Tier 3 — CoinGecko  : Market aggregator (enriches with mcap/volume)
// Fallback            : Hardcoded data above (offline resilience)
//
// Each tier merges with the previous, with T1 prices taking priority
// over T2, and T2 over T3. CoinGecko always enriches mcap/volume
// even when Chainlink/Binance provides the price.
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
    const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${uniqueIds.join(",")}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
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
// Merges three oracle tiers + HBAR fast-path + fallback.
// Returns Record<symbol, CoinPrice>.
export async function fetchCoinPrices(
  symbols: string[]
): Promise<Record<string, CoinPrice>> {
  // Return cache if fresh
  if (_priceCache && Date.now() - _priceCache.timestamp < PRICE_CACHE_TTL) {
    return { ..._priceCache.data };
  }

  // Start all tiers in parallel
  const [chainlinkData, binancePrices, geckoData, hbarFast] = await Promise.all([
    fetchChainlinkPrices(symbols).catch(() => ({} as Record<string, ChainlinkPriceData>)),
    fetchBinancePrices(symbols).catch(() => ({} as Record<string, CoinPrice>)),
    fetchCoinGeckoPrices(symbols).catch(() => ({} as Record<string, CoinPrice>)),
    fetchHbarFastPath().catch(() => null),
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
        // Keep CoinGecko's market_cap/volume/image if available
        market_cap: merged[sym]?.market_cap || binance.market_cap,
        total_volume: binance.total_volume || merged[sym]?.total_volume || 0,
        change_source: "binance",
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
        };
      }
    }
  }

  updateOracleStats({
    fallbackCount,
    totalFeeds: symbols.length,
  });

  // Cache
  _priceCache = { data: merged, timestamp: Date.now() };

  const sources = { chainlink: 0, binance: 0, coingecko: 0, fallback: 0 };
  for (const cp of Object.values(merged)) {
    const s = cp.oracle_source || "fallback";
    if (s in sources) sources[s as keyof typeof sources]++;
  }
  log.debug("Pipeline", `Prices: CL=${sources.chainlink} BN=${sources.binance} CG=${sources.coingecko} FB=${sources.fallback}`);

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

export async function fetchGlobalMarketData(): Promise<GlobalMarketData | null> {
  try {
    const res = await fetchWithTimeout(`${COINGECKO_API}/global`, 8000);
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.data;
    if (!d) return null;
    return {
      totalMarketCap: d.total_market_cap?.usd ?? 0,
      totalVolume24h: d.total_volume?.usd ?? 0,
      marketCapChange24h: d.market_cap_change_percentage_24h_usd ?? 0,
      btcDominance: d.market_cap_percentage?.btc ?? 0,
      ethDominance: d.market_cap_percentage?.eth ?? 0,
      activeCryptos: d.active_cryptocurrencies ?? 0,
    };
  } catch (err) {
    log.debug("CoinGecko", "Global market data fetch failed", (err as Error).message);
    return null;
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

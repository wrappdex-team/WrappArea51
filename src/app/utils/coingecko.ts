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
  USDCh: "usd-coin",
};

// CoinGecko IDs (used for market cap enrichment + tokens Binance doesn't cover)
export const COIN_ID_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", USDT: "tether", BNB: "binancecoin",
  SOL: "solana", USDC: "usd-coin", XRP: "ripple", HBAR: "hedera-hashgraph",
  DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche-2", TRX: "tron",
  TON: "toncoin", LINK: "chainlink", SHIB: "shiba-inu", DOT: "polkadot",
  LTC: "litecoin", PAXG: "pax-gold", EURC: "euro-coin-2",
  USDCh: "usd-coin",
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
};

// ─────────────────────────────────────────────────────────────────────
// SIMPLIFIED PRICE PIPELINE
// ─────────────────────────────────────────────────────────────────────
//
// Architecture (Binance-primary):
//   1. Binance     (T1) — 16 tokens in ONE HTTP call, ~200ms, covers all majors
//   2. CoinGecko   (T2) — market cap enrichment + EURC (not on Binance)
//   3. Chainlink   (BG) — background on-chain oracle, non-blocking 4s race
//   4. HBAR        (LW) — dedicated lone-wolf fast-path
//   5. Fallback    (FB) — hardcoded safety net
//
// CoinCap v2 removed from price pipeline (deprecated API, stale data).
// CoinCap v2 is ONLY used for chart history (fetchCoinCapHistory).
// ─────────────────────────────────────────────────────────────────────

// ── Binance Bulk Fetch ────────────────────────────────────────────
let _binanceCache: { data: Record<string, CoinPrice>; ts: number } | null = null;
const BINANCE_CACHE_TTL = 8_000;

async function fetchFromBinance(symbols: string[]): Promise<Record<string, CoinPrice>> {
  // Build pairs list — ONLY valid Binance symbols
  const pairs = symbols
    .map(s => BINANCE_PAIR_MAP[s])
    .filter((p): p is string => !!p);
  const uniquePairs = [...new Set(pairs)];
  if (uniquePairs.length === 0) return {};

  // Short-lived cache
  if (_binanceCache && Date.now() - _binanceCache.ts < BINANCE_CACHE_TTL) {
    const cached: Record<string, CoinPrice> = {};
    for (const s of symbols) {
      if (_binanceCache.data[s]) cached[s] = _binanceCache.data[s];
    }
    if (Object.keys(cached).length > 0) {
      log.debug("Oracle", `Binance: ${Object.keys(cached).length} from cache`);
      return cached;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    // JSON array format: ["BTCUSDT","ETHUSDT",...]
    const symbolsParam = JSON.stringify(uniquePairs);
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbolsParam)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      log.debug("Oracle", `Binance HTTP ${res.status} — batch rejected`);
      return {};
    }

    const tickers: any[] = await res.json();
    if (!Array.isArray(tickers)) return {};

    const priceMap: Record<string, CoinPrice> = {};

    for (const t of tickers) {
      const sym = BINANCE_REVERSE[t.symbol];
      if (!sym) continue;

      const price = parseFloat(t.lastPrice);
      if (!price || price <= 0 || !isFinite(price)) continue;

      const change = parseFloat(t.priceChangePercent);
      const vol = parseFloat(t.quoteVolume);
      const fb = FALLBACK_DATA[sym];

      priceMap[sym] = {
        id: fb?.id || sym.toLowerCase(),
        symbol: sym.toLowerCase(),
        name: fb?.name || sym,
        current_price: price,
        price_change_percentage_24h: isFinite(change) ? change : 0,
        market_cap: 0,
        total_volume: isFinite(vol) ? vol : 0,
        image: TOKEN_LOGOS[sym] || "",
        oracle_source: "binance",
        change_source: "binance",
      };
    }

    log.debug("Oracle", `Binance: ${Object.keys(priceMap).length}/${uniquePairs.length} tickers OK`);

    if (Object.keys(priceMap).length > 0) {
      _binanceCache = { data: priceMap, ts: Date.now() };
    }
    return priceMap;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      log.debug("Oracle", "Binance unreachable (network/CORS)");
    } else {
      log.debug("Oracle", "Binance error:", (err as Error).message);
    }
    return {};
  }
}

// ── CoinGecko Fetch (market cap enrichment + EURC) ────────────────
async function fetchFromCoinGecko(symbols: string[]): Promise<Record<string, CoinPrice>> {
  const coinIds = [...new Set(symbols.map(s => COIN_ID_MAP[s]).filter(Boolean))].join(",");
  if (!coinIds) return {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(
      `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${coinIds}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (!res.ok) {
      log.debug("Oracle", `CoinGecko HTTP ${res.status}`);
      return {};
    }

    const data: any[] = await res.json();
    const priceMap: Record<string, CoinPrice> = {};

    symbols.forEach(symbol => {
      const geckoId = COIN_ID_MAP[symbol];
      const coin = data.find((c: any) => c.id === geckoId);
      if (coin) {
        priceMap[symbol] = {
          id: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          current_price: coin.current_price,
          price_change_percentage_24h: coin.price_change_percentage_24h || 0,
          market_cap: coin.market_cap || 0,
          total_volume: coin.total_volume || 0,
          image: TOKEN_LOGOS[symbol] || coin.image || "",
          oracle_source: "coingecko",
          change_source: "coingecko",
        };
      }
    });

    log.debug("Oracle", `CoinGecko: ${Object.keys(priceMap).length}/${symbols.length} tickers`);
    return priceMap;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      log.debug("Oracle", "CoinGecko unreachable (network/CORS)");
    } else {
      log.debug("Oracle", "CoinGecko error:", (err as Error).message);
    }
    return {};
  }
}

// ── HBAR Lone-Wolf Fast-Path ─────────────────────────────────────
// Dedicated multi-source fetch for HBAR. Tries Binance single-ticker
// first (fastest), then CoinGecko simple price as backup.
// Runs in parallel inside fetchCoinPrices so all consumers get it.
let _hbarFastCache: { price: CoinPrice; ts: number } | null = null;
const HBAR_FAST_CACHE_TTL = 12_000;

export async function fetchHbarFastPath(): Promise<CoinPrice | null> {
  if (_hbarFastCache && Date.now() - _hbarFastCache.ts < HBAR_FAST_CACHE_TTL) {
    return _hbarFastCache.price;
  }

  const buildResult = (
    price: number,
    change24h: number,
    source: OracleSource,
    extra?: { marketCap?: number; volume?: number }
  ): CoinPrice => ({
    id: "hedera",
    symbol: "hbar",
    name: "Hedera",
    current_price: price,
    price_change_percentage_24h: change24h,
    market_cap: extra?.marketCap ?? 0,
    total_volume: extra?.volume ?? 0,
    image: TOKEN_LOGOS.HBAR,
    oracle_source: source,
    change_source: source,
  });

  // Source 1: Binance single-ticker (fastest, most reliable)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=HBARUSDT", {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data?.lastPrice || "0");
      const change = parseFloat(data?.priceChangePercent || "0");
      const volume = parseFloat(data?.quoteVolume || "0");
      if (price > 0.001 && price < 50) {
        const result = buildResult(price, change, "binance", { volume });
        _hbarFastCache = { price: result, ts: Date.now() };
        log.debug("Oracle", `HBAR fast-path: $${price.toFixed(4)} via Binance`);
        return result;
      }
    }
  } catch { /* Binance failed */ }

  // Source 2: CoinGecko simple price
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(
      `${COINGECKO_API}/simple/price?ids=hedera-hashgraph&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,
      { signal: ctrl.signal }
    );
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      const hbar = data?.["hedera-hashgraph"];
      if (hbar?.usd > 0) {
        const result = buildResult(
          hbar.usd,
          hbar.usd_24h_change || 0,
          "coingecko",
          { marketCap: hbar.usd_market_cap || 0, volume: hbar.usd_24h_vol || 0 }
        );
        _hbarFastCache = { price: result, ts: Date.now() };
        log.debug("Oracle", `HBAR fast-path: $${hbar.usd.toFixed(4)} via CoinGecko`);
        return result;
      }
    }
  } catch { /* CoinGecko failed */ }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// MAIN PRICE AGGREGATOR
// ─────────────────────────────────────────────────────────────────────
export const fetchCoinPrices = async (symbols: string[]): Promise<Record<string, CoinPrice>> => {
  // Chainlink runs in background — race against 4s timer.
  // If Chainlink resolves in time, great. If not, Binance/CoinGecko
  // render instantly. Chainlink caches for 30s so next refresh gets it.
  const chainlinkPromise = fetchChainlinkPrices(symbols);
  const chainlinkRace: Promise<Record<string, ChainlinkPriceData>> = Promise.race([
    chainlinkPromise,
    new Promise<Record<string, ChainlinkPriceData>>(r => setTimeout(() => r({}), 4000)),
  ]);
  // Prevent unhandled rejection if Chainlink fails after timeout
  chainlinkPromise.catch(() => {});

  // Fire all sources in parallel
  const [chainlinkRaw, binance, coingecko, hbarFast] = await Promise.all([
    chainlinkRace,
    fetchFromBinance(symbols),
    fetchFromCoinGecko(symbols),
    symbols.includes("HBAR") ? fetchHbarFastPath().catch(() => null) : Promise.resolve(null),
  ]);

  const chainlink = chainlinkToCoinPrices(chainlinkRaw, symbols);

  // ── 3-Layer Merge ───────────────────────────────────────────────
  // Layer 1: Fallback (hardcoded baseline)
  // Layer 2: CoinGecko (market cap + EURC)
  // Layer 3: Binance (real-time price + 24h change + volume)
  // Layer 4: Chainlink (on-chain price override, no 24h change)
  const merged: Record<string, CoinPrice> = {};
  let clCount = 0, bnCount = 0, cgCount = 0, fbCount = 0;

  for (const symbol of symbols) {
    // Start with hardcoded fallback
    let result: CoinPrice | null = FALLBACK_DATA[symbol]
      ? { ...FALLBACK_DATA[symbol], oracle_source: "fallback" as OracleSource, change_source: "fallback" as OracleSource }
      : null;

    // Layer CoinGecko (market cap, EURC coverage)
    const cg = coingecko[symbol];
    if (cg && cg.current_price > 0) {
      result = { ...cg, change_source: "coingecko" as OracleSource };
    }

    // Layer Binance (real-time price — overrides CoinGecko price but keeps market_cap)
    const bn = binance[symbol];
    if (bn && bn.current_price > 0) {
      if (result) {
        result = {
          ...result,
          current_price: bn.current_price,
          price_change_percentage_24h: bn.price_change_percentage_24h,
          total_volume: bn.total_volume || result.total_volume,
          // Keep CoinGecko/fallback market_cap (Binance doesn't provide it)
          market_cap: result.market_cap || 0,
          oracle_source: "binance" as OracleSource,
          change_source: "binance" as OracleSource,
        };
      } else {
        result = { ...bn };
      }
    }

    // Layer Chainlink (on-chain price override — highest authority)
    // Keeps 24h change from layer beneath; Chainlink has no 24h change.
    const cl = chainlink[symbol];
    if (cl && cl.current_price > 0) {
      if (result) {
        result = {
          ...result,
          current_price: cl.current_price,
          oracle_source: "chainlink" as OracleSource,
          oracle_updated_at: cl.oracle_updated_at,
          chainlink_feed: cl.chainlink_feed,
          // change_source preserved from layer beneath
        };
      } else {
        const fb = FALLBACK_DATA[symbol];
        result = {
          id: fb?.id || symbol.toLowerCase(),
          symbol: symbol.toLowerCase(),
          name: fb?.name || symbol,
          current_price: cl.current_price,
          price_change_percentage_24h: 0,
          market_cap: 0,
          total_volume: 0,
          image: TOKEN_LOGOS[symbol] || "",
          oracle_source: "chainlink" as OracleSource,
          oracle_updated_at: cl.oracle_updated_at,
          chainlink_feed: cl.chainlink_feed,
          change_source: "fallback" as OracleSource,
        };
      }
    }

    // Stablecoins: ensure sensible price if no API returned data
    if (!result && (symbol === "USDT" || symbol === "USDC" || symbol === "USDCh")) {
      const fb = FALLBACK_DATA[symbol];
      result = fb
        ? { ...fb, oracle_source: "fallback" as OracleSource, change_source: "fallback" as OracleSource }
        : null;
    }

    if (result) {
      result.image = result.image || TOKEN_LOGOS[symbol] || "";
      merged[symbol] = result;

      switch (result.oracle_source) {
        case "chainlink": clCount++; break;
        case "binance": bnCount++; break;
        case "coingecko": cgCount++; break;
        default: fbCount++; break;
      }
    }
  }

  // HBAR lone-wolf patch — if HBAR is on fallback, override with fast-path
  if (hbarFast && hbarFast.current_price > 0) {
    const existing = merged["HBAR"];
    if (!existing || existing.oracle_source === "fallback" || existing.current_price <= 0) {
      merged["HBAR"] = hbarFast;
      log.debug("Oracle", `HBAR patched from fast-path: $${hbarFast.current_price.toFixed(4)}`);
    }
  }

  updateOracleStats({
    chainlinkCount: clCount,
    binanceCount: bnCount,
    coincapCount: 0,
    coingeckoCount: cgCount,
    fallbackCount: fbCount,
    totalFeeds: symbols.length,
  });

  log.debug("Oracle", `Merged ${symbols.length}: ${clCount} Chainlink, ${bnCount} Binance, ${cgCount} CoinGecko, ${fbCount} Fallback`);

  return merged;
};

// ─────────────────────────────────────────────────────────────────────
// CHART HISTORY (CoinCap v2 — still works for historical data)
// ─────────────────────────────────────────────────────────────────────

export interface HistoryPoint {
  priceUsd: number;
  time: number;
}

export async function fetchCoinCapHistory(
  symbol: string,
  interval: "h1" | "h6" | "h12" | "d1" = "h1",
  daysBack: number = 30
): Promise<HistoryPoint[]> {
  const capId = COINCAP_ID_MAP[symbol];
  if (!capId) return [];

  const end = Date.now();
  const start = end - daysBack * 24 * 60 * 60 * 1000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(
      `${COINCAP_API}/assets/${capId}/history?interval=${interval}&start=${start}&end=${end}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`CoinCap history ${res.status}`);
    const json = await res.json();
    return (json.data || []).map((d: any) => ({
      priceUsd: parseFloat(d.priceUsd),
      time: d.time,
    }));
  } catch {
    clearTimeout(timeoutId);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────

export const formatMarketCap = (value: number): string => {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
};

export const formatVolume = (value: number): string => formatMarketCap(value);

export interface GlobalMarketData {
  totalMarketCap: number;
  totalVolume24h: number;
  marketCapChange24h: number;
  btcDominance: number;
  ethDominance: number;
  activeCryptos: number;
}

const GLOBAL_FALLBACK: GlobalMarketData = {
  totalMarketCap: 3_420_000_000_000,
  totalVolume24h: 156_800_000_000,
  marketCapChange24h: 2.14,
  btcDominance: 57.2,
  ethDominance: 12.8,
  activeCryptos: 14932,
};

export async function fetchGlobalMarketData(): Promise<GlobalMarketData> {
  // Try CoinGecko first
  {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${COINGECKO_API}/global`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`CoinGecko global ${res.status}`);
      const json = await res.json();
      const d = json.data;
      return {
        totalMarketCap: d.total_market_cap?.usd ?? GLOBAL_FALLBACK.totalMarketCap,
        totalVolume24h: d.total_volume?.usd ?? GLOBAL_FALLBACK.totalVolume24h,
        marketCapChange24h: d.market_cap_change_percentage_24h_usd ?? GLOBAL_FALLBACK.marketCapChange24h,
        btcDominance: d.market_cap_percentage?.btc ?? GLOBAL_FALLBACK.btcDominance,
        ethDominance: d.market_cap_percentage?.eth ?? GLOBAL_FALLBACK.ethDominance,
        activeCryptos: d.active_cryptocurrencies ?? GLOBAL_FALLBACK.activeCryptos,
      };
    } catch {
      clearTimeout(timeoutId);
    }
  }

  // Try CoinCap as fallback for global data
  {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${COINCAP_API}/assets?limit=100`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`CoinCap global ${res.status}`);
      const json = await res.json();
      const assets: any[] = json.data || [];
      let totalMcap = 0, totalVol = 0;
      assets.forEach((a: any) => {
        totalMcap += parseFloat(a.marketCapUsd) || 0;
        totalVol += parseFloat(a.volumeUsd24Hr) || 0;
      });
      const btcAsset = assets.find((a: any) => a.id === "bitcoin");
      const ethAsset = assets.find((a: any) => a.id === "ethereum");
      return {
        totalMarketCap: totalMcap * 1.02,
        totalVolume24h: totalVol * 1.05,
        marketCapChange24h: btcAsset ? parseFloat(btcAsset.changePercent24Hr) || 0 : GLOBAL_FALLBACK.marketCapChange24h,
        btcDominance: btcAsset && totalMcap > 0 ? (parseFloat(btcAsset.marketCapUsd) / totalMcap) * 100 : GLOBAL_FALLBACK.btcDominance,
        ethDominance: ethAsset && totalMcap > 0 ? (parseFloat(ethAsset.marketCapUsd) / totalMcap) * 100 : GLOBAL_FALLBACK.ethDominance,
        activeCryptos: GLOBAL_FALLBACK.activeCryptos,
      };
    } catch {
      clearTimeout(timeoutId);
    }
  }

  return { ...GLOBAL_FALLBACK };
}

export function computeRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) changes.push(prices[i] - prices[i - 1]);

  const relevantChanges = changes.slice(-Math.max(period, changes.length));
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < Math.min(period, relevantChanges.length); i++) {
    if (relevantChanges[i] > 0) avgGain += relevantChanges[i];
    else avgLoss += Math.abs(relevantChanges[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < relevantChanges.length; i++) {
    const change = relevantChanges[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

export async function fetchMarketRSI(): Promise<{ rsi: number; prices: number[] }> {
  try {
    const history = await fetchCoinCapHistory("BTC", "h1", 30);
    if (history.length > 15) {
      const dailyCloses: number[] = [];
      const msPerDay = 24 * 60 * 60 * 1000;
      let currentDay = Math.floor(history[0].time / msPerDay);
      let lastPrice = history[0].priceUsd;

      for (const pt of history) {
        const day = Math.floor(pt.time / msPerDay);
        if (day !== currentDay) {
          dailyCloses.push(lastPrice);
          currentDay = day;
        }
        lastPrice = pt.priceUsd;
      }
      dailyCloses.push(lastPrice);

      if (dailyCloses.length > 14) {
        const rsi = computeRSI(dailyCloses, 14);
        return { rsi: Math.round(rsi * 100) / 100, prices: dailyCloses.slice(-30) };
      }
    }
  } catch { /* fall through */ }

  return { rsi: 52.4, prices: [] };
}

// ── Top 20 Composite Index ────────────────────────────────────────────

export interface Top20IndexData {
  totalMarketCap: number;
  weightedChange24h: number;
  topCoinCount: number;
  topCoins: Top20Coin[];
}

export interface Top20Coin {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
  image: string;
  dominancePercent: number;
}

const TOP20_FALLBACK: Top20IndexData = {
  totalMarketCap: 3_180_000_000_000,
  weightedChange24h: 1.42,
  topCoinCount: 20,
  topCoins: [],
};

let _top20Cache: { data: Top20IndexData; ts: number } | null = null;
const TOP20_CACHE_TTL_MS = 120_000;

export async function fetchTop20Index(): Promise<Top20IndexData> {
  if (_top20Cache && Date.now() - _top20Cache.ts < TOP20_CACHE_TTL_MS) {
    return _top20Cache.data;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`CoinGecko top20 ${res.status}`);
    const coins: any[] = await res.json();
    if (!coins || coins.length < 10) throw new Error("Insufficient data");

    let totalMcap = 0;
    let weightedChangeSum = 0;

    const topCoins: Top20Coin[] = coins.map((c: any) => {
      const mcap = c.market_cap ?? 0;
      const change = c.price_change_percentage_24h ?? 0;
      totalMcap += mcap;
      weightedChangeSum += mcap * change;
      return {
        symbol: (c.symbol ?? "").toUpperCase(),
        name: c.name ?? "",
        price: c.current_price ?? 0,
        change24h: change,
        marketCap: mcap,
        image: c.image ?? "",
        dominancePercent: 0,
      };
    });

    if (totalMcap > 0) {
      topCoins.forEach(c => { c.dominancePercent = (c.marketCap / totalMcap) * 100; });
    }

    const result: Top20IndexData = {
      totalMarketCap: totalMcap,
      weightedChange24h: totalMcap > 0 ? weightedChangeSum / totalMcap : 0,
      topCoinCount: topCoins.length,
      topCoins,
    };
    _top20Cache = { data: result, ts: Date.now() };
    return result;
  } catch {
    clearTimeout(timeoutId);
  }

  // Fallback: CoinCap
  const cc = new AbortController();
  const ccTimeout = setTimeout(() => cc.abort(), 8000);
  try {
    const res = await fetch(`${COINCAP_API}/assets?limit=20`, { signal: cc.signal });
    clearTimeout(ccTimeout);
    if (!res.ok) throw new Error(`CoinCap top20 ${res.status}`);
    const json = await res.json();
    const assets: any[] = json.data || [];

    let totalMcap = 0;
    let weightedChangeSum = 0;

    const topCoins: Top20Coin[] = assets.map((a: any) => {
      const mcap = parseFloat(a.marketCapUsd) || 0;
      const change = parseFloat(a.changePercent24Hr) || 0;
      totalMcap += mcap;
      weightedChangeSum += mcap * change;
      return {
        symbol: (a.symbol ?? "").toUpperCase(),
        name: a.name ?? "",
        price: parseFloat(a.priceUsd) || 0,
        change24h: change,
        marketCap: mcap,
        image: "",
        dominancePercent: 0,
      };
    });

    if (totalMcap > 0) {
      topCoins.forEach(c => { c.dominancePercent = (c.marketCap / totalMcap) * 100; });
    }

    const result: Top20IndexData = {
      totalMarketCap: totalMcap,
      weightedChange24h: totalMcap > 0 ? weightedChangeSum / totalMcap : 0,
      topCoinCount: topCoins.length,
      topCoins,
    };
    _top20Cache = { data: result, ts: Date.now() };
    return result;
  } catch {
    clearTimeout(ccTimeout);
  }

  return { ...TOP20_FALLBACK };
}

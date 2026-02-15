const COINCAP_API = "https://api.coincap.io/v2";
const COINGECKO_API = "https://api.coingecko.com/api/v3";

import { fetchChainlinkPrices, chainlinkToCoinPrices, updateOracleStats } from "./chainlink";
import { log } from "./logger";

export const COINCAP_ID_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", USDT: "tether", BNB: "binance-coin",
  SOL: "solana", USDC: "usd-coin", XRP: "xrp", HBAR: "hedera-hashgraph",
  DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche", TRX: "tron",
  TON: "toncoin", LINK: "chainlink", SHIB: "shiba-inu", DOT: "polkadot",
  LTC: "litecoin", PAXG: "pax-gold", EURC: "euro-coin",
  USDCh: "usd-coin",
};

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
export type OracleSource = "chainlink" | "coincap" | "coingecko" | "fallback";

export interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  image: string;
  // Oracle source tracking (added for Chainlink integration)
  oracle_source?: OracleSource;
  oracle_updated_at?: number;  // unix timestamp from on-chain feed
  chainlink_feed?: string;     // Chainlink feed contract address
  // Tracks where the 24h % change came from (may differ from price source)
  // When Chainlink provides price but APIs fail, change stays "fallback" (stale/cached data)
  change_source?: OracleSource;
}

const FALLBACK_DATA: Record<string, CoinPrice> = {
  BTC:  { id: "bitcoin",    symbol: "btc",  name: "Bitcoin",    current_price: 97845.32, price_change_percentage_24h: 3.24,  market_cap: 1930000000000, total_volume: 28500000000, image: TOKEN_LOGOS.BTC },
  ETH:  { id: "ethereum",   symbol: "eth",  name: "Ethereum",   current_price: 3678.45,  price_change_percentage_24h: 2.87,  market_cap: 442000000000,  total_volume: 14200000000, image: TOKEN_LOGOS.ETH },
  USDT: { id: "tether",     symbol: "usdt", name: "Tether",     current_price: 1.0001,   price_change_percentage_24h: 0.01,  market_cap: 138000000000,  total_volume: 52000000000, image: TOKEN_LOGOS.USDT },
  BNB:  { id: "binancecoin",symbol: "bnb",  name: "BNB",        current_price: 634.21,   price_change_percentage_24h: 1.45,  market_cap: 91300000000,   total_volume: 1800000000,  image: TOKEN_LOGOS.BNB },
  SOL:  { id: "solana",     symbol: "sol",  name: "Solana",     current_price: 186.73,   price_change_percentage_24h: 5.67,  market_cap: 89200000000,   total_volume: 3200000000,  image: TOKEN_LOGOS.SOL },
  USDC: { id: "usd-coin",   symbol: "usdc", name: "USD Coin",   current_price: 1.0002,   price_change_percentage_24h: 0.01,  market_cap: 58400000000,   total_volume: 6400000000,  image: TOKEN_LOGOS.USDC },
  XRP:  { id: "ripple",     symbol: "xrp",  name: "XRP",        current_price: 2.43,     price_change_percentage_24h: -1.23, market_cap: 138500000000,  total_volume: 4500000000,  image: TOKEN_LOGOS.XRP },
  HBAR: { id: "hedera",     symbol: "hbar", name: "Hedera",     current_price: 0.28,     price_change_percentage_24h: 2.5,   market_cap: 11200000000,   total_volume: 420000000,   image: TOKEN_LOGOS.HBAR },
  DOGE: { id: "dogecoin",   symbol: "doge", name: "Dogecoin",   current_price: 0.3421,   price_change_percentage_24h: 4.23,  market_cap: 50300000000,   total_volume: 2100000000,  image: TOKEN_LOGOS.DOGE },
  ADA:  { id: "cardano",    symbol: "ada",  name: "Cardano",    current_price: 0.9234,   price_change_percentage_24h: 2.34,  market_cap: 32400000000,   total_volume: 890000000,   image: TOKEN_LOGOS.ADA },
  AVAX: { id: "avalanche",  symbol: "avax", name: "Avalanche",  current_price: 38.67,    price_change_percentage_24h: 6.78,  market_cap: 16800000000,   total_volume: 620000000,   image: TOKEN_LOGOS.AVAX },
  TRX:  { id: "tron",       symbol: "trx",  name: "TRON",       current_price: 0.2456,   price_change_percentage_24h: 1.89,  market_cap: 21300000000,   total_volume: 780000000,   image: TOKEN_LOGOS.TRX },
  TON:  { id: "toncoin",    symbol: "ton",  name: "Toncoin",    current_price: 5.82,     price_change_percentage_24h: 3.15,  market_cap: 20100000000,   total_volume: 380000000,   image: TOKEN_LOGOS.TON },
  LINK: { id: "chainlink",  symbol: "link", name: "Chainlink",  current_price: 18.92,    price_change_percentage_24h: 5.34,  market_cap: 11800000000,   total_volume: 890000000,   image: TOKEN_LOGOS.LINK },
  SHIB: { id: "shiba-inu",  symbol: "shib", name: "Shiba Inu",  current_price: 0.00002234, price_change_percentage_24h: 6.12, market_cap: 13200000000, total_volume: 1100000000,  image: TOKEN_LOGOS.SHIB },
  DOT:  { id: "polkadot",   symbol: "dot",  name: "Polkadot",   current_price: 7.89,     price_change_percentage_24h: 4.12,  market_cap: 10800000000,   total_volume: 450000000,   image: TOKEN_LOGOS.DOT },
  LTC:  { id: "litecoin",   symbol: "ltc",  name: "Litecoin",   current_price: 95.43,    price_change_percentage_24h: 2.15,  market_cap: 7100000000,    total_volume: 580000000,   image: TOKEN_LOGOS.LTC },
  EURC: { id: "euro-coin",  symbol: "eurc", name: "EURC",       current_price: 1.0856,   price_change_percentage_24h: 0.12,  market_cap: 142000000,     total_volume: 18000000,    image: TOKEN_LOGOS.EURC },
  PAXG: { id: "pax-gold",   symbol: "paxg", name: "PAX Gold",   current_price: 2678.45,  price_change_percentage_24h: 0.89,  market_cap: 524000000,     total_volume: 32000000,    image: TOKEN_LOGOS.PAXG },
  USDCh:{ id: "usd-coin",   symbol: "usdc", name: "USD Coin",   current_price: 1.0002,   price_change_percentage_24h: 0.01,  market_cap: 58400000000,   total_volume: 6400000000,  image: TOKEN_LOGOS.USDCh },
};

async function fetchFromCoinCap(symbols: string[]): Promise<Record<string, CoinPrice>> {
  const ids = [...new Set(symbols.map(s => COINCAP_ID_MAP[s]).filter(Boolean))].join(",");
  if (!ids) return {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`${COINCAP_API}/assets?ids=${ids}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      log.debug("Oracle", `CoinCap HTTP ${res.status}`);
      return {};
    }

    const json = await res.json();
    const assets: any[] = json.data || [];
    const priceMap: Record<string, CoinPrice> = {};

    symbols.forEach(symbol => {
      const capId = COINCAP_ID_MAP[symbol];
      const asset = assets.find((a: any) => a.id === capId);
      if (asset) {
        priceMap[symbol] = {
          id: asset.id,
          symbol: asset.symbol?.toLowerCase() || symbol.toLowerCase(),
          name: asset.name,
          current_price: parseFloat(asset.priceUsd) || 0,
          price_change_percentage_24h: parseFloat(asset.changePercent24Hr) || 0,
          market_cap: parseFloat(asset.marketCapUsd) || 0,
          total_volume: parseFloat(asset.volumeUsd24Hr) || 0,
          image: TOKEN_LOGOS[symbol] || "",
          oracle_source: "coincap",
        };
      }
    });
    return priceMap;
  } catch (err) {
    clearTimeout(timeoutId);
    // Network errors (CORS, blocked, offline) are expected in sandboxed environments
    if (err instanceof TypeError && (err as TypeError).message === "Failed to fetch") {
      log.debug("Oracle", "CoinCap unreachable (network/CORS) — using fallback");
    } else {
      log.debug("Oracle", "CoinCap fetch error", (err as Error).message);
    }
    return {};
  }
}

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
        };
      }
    });
    return priceMap;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof TypeError && (err as TypeError).message === "Failed to fetch") {
      log.debug("Oracle", "CoinGecko unreachable (network/CORS) — using fallback");
    } else {
      log.debug("Oracle", "CoinGecko fetch error", (err as Error).message);
    }
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────
// TRIPLE-ORACLE PRICE PIPELINE
// ─────────────────────────────────────────────────────────────────────
// Priority: Chainlink (on-chain) → CoinCap → CoinGecko → Hardcoded
//
// All three sources are fetched in PARALLEL for maximum speed.
// Chainlink provides the most accurate current price (decentralized oracle).
// CoinCap/CoinGecko provide auxiliary data (24h change, volume, market cap).
// The merge logic uses Chainlink for `current_price` and CoinCap/CoinGecko
// for auxiliary market data.
// ─────────────────────────────────────────────────────────────────────

// ── Fast-Path HBAR Price Fetch ─────────────────────────────────────
// Dedicated multi-source fetch for HBAR price. Tries Binance first
// (best CORS support), then CoinCap, then CoinGecko simple price.
// Called automatically inside fetchCoinPrices() so ALL consumers
// (Dashboard, Trading, etc.) get a live HBAR price even when the
// bulk batch CoinCap/CoinGecko requests are rate-limited.
// ─────────────────────────────────────────────────────────────────────
let _hbarFastCache: { price: CoinPrice; ts: number } | null = null;
const HBAR_FAST_CACHE_TTL = 15_000; // 15s — short so it stays fresh

export async function fetchHbarFastPath(): Promise<CoinPrice | null> {
  // Return cache if still fresh
  if (_hbarFastCache && Date.now() - _hbarFastCache.ts < HBAR_FAST_CACHE_TTL) {
    return _hbarFastCache.price;
  }

  // Helper: build CoinPrice from a raw numeric price + optional 24h change
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

  // ── Source 1: Binance (most reliable CORS, fastest) ──
  try {
    const ctrl1 = new AbortController();
    const t1 = setTimeout(() => ctrl1.abort(), 3000);
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=HBARUSDT", {
      signal: ctrl1.signal,
    });
    clearTimeout(t1);
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data?.lastPrice || "0");
      const change = parseFloat(data?.priceChangePercent || "0");
      const volume = parseFloat(data?.quoteVolume || "0");
      if (price > 0.001 && price < 50) {
        const result = buildResult(price, change, "coincap", { volume }); // label as coincap (API source)
        _hbarFastCache = { price: result, ts: Date.now() };
        log.debug("Oracle", `HBAR fast-path: $${price.toFixed(4)} via Binance`);
        return result;
      }
    }
  } catch { /* Binance failed — try next */ }

  // ── Source 2: CoinCap single-asset endpoint ──
  try {
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), 3000);
    const res = await fetch(`${COINCAP_API}/assets/hedera-hashgraph`, {
      signal: ctrl2.signal,
    });
    clearTimeout(t2);
    if (res.ok) {
      const json = await res.json();
      const asset = json?.data;
      if (asset) {
        const price = parseFloat(asset.priceUsd);
        if (price > 0) {
          const result = buildResult(
            price,
            parseFloat(asset.changePercent24Hr) || 0,
            "coincap",
            { marketCap: parseFloat(asset.marketCapUsd) || 0, volume: parseFloat(asset.volumeUsd24Hr) || 0 }
          );
          _hbarFastCache = { price: result, ts: Date.now() };
          log.debug("Oracle", `HBAR fast-path: $${price.toFixed(4)} via CoinCap`);
          return result;
        }
      }
    }
  } catch { /* CoinCap failed — try next */ }

  // ── Source 3: CoinGecko simple price ──
  try {
    const ctrl3 = new AbortController();
    const t3 = setTimeout(() => ctrl3.abort(), 3000);
    const res = await fetch(
      `${COINGECKO_API}/simple/price?ids=hedera-hashgraph&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,
      { signal: ctrl3.signal }
    );
    clearTimeout(t3);
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

export const fetchCoinPrices = async (symbols: string[]): Promise<Record<string, CoinPrice>> => {
  // Fire all three oracle sources + HBAR fast-path in parallel
  // All functions handle errors internally and always return {} or null on failure
  const [chainlinkRaw, coincap, coingecko, hbarFast] = await Promise.all([
    fetchChainlinkPrices(symbols),
    fetchFromCoinCap(symbols),
    fetchFromCoinGecko(symbols),
    symbols.includes("HBAR") ? fetchHbarFastPath().catch(() => null) : Promise.resolve(null),
  ]);

  // Convert Chainlink data to CoinPrice format
  const chainlink = chainlinkToCoinPrices(chainlinkRaw, symbols);

  // Merge with priority: Chainlink price > CoinCap > CoinGecko > Fallback
  const merged: Record<string, CoinPrice> = {};
  let clCount = 0, ccCount = 0, cgCount = 0, fbCount = 0;

  for (const symbol of symbols) {
    // Start with fallback
    // change_source tracks where price_change_percentage_24h actually came from
    // (may differ from oracle_source when Chainlink overrides price but not %)
    let result: CoinPrice | null = FALLBACK_DATA[symbol]
      ? { ...FALLBACK_DATA[symbol], oracle_source: "fallback" as OracleSource, change_source: "fallback" as OracleSource }
      : null;

    // Layer CoinGecko (lowest priority API)
    if (coingecko[symbol]) {
      result = { ...coingecko[symbol], change_source: "coingecko" as OracleSource };
    }

    // Layer CoinCap (higher priority API)
    if (coincap[symbol]) {
      // If we have CoinGecko data, keep its market_cap/volume if CoinCap's are zero
      if (result && result.oracle_source === "coingecko") {
        result = {
          ...result,
          current_price: coincap[symbol].current_price,
          price_change_percentage_24h: coincap[symbol].price_change_percentage_24h,
          market_cap: coincap[symbol].market_cap || result.market_cap,
          total_volume: coincap[symbol].total_volume || result.total_volume,
          oracle_source: "coincap" as OracleSource,
          change_source: "coincap" as OracleSource,
        };
      } else {
        result = { ...coincap[symbol], change_source: "coincap" as OracleSource };
      }
    }

    // Override ONLY the price with Chainlink data (highest priority — decentralized oracle)
    // Keep 24h change, volume, and market cap from CoinCap/CoinGecko
    // IMPORTANT: change_source is preserved from the layer beneath — Chainlink
    // does NOT provide 24h change, so change_source stays whatever it was
    if (chainlink[symbol] && chainlink[symbol].current_price > 0) {
      if (result) {
        result = {
          ...result,
          current_price: chainlink[symbol].current_price,
          oracle_source: "chainlink" as OracleSource,
          oracle_updated_at: chainlink[symbol].oracle_updated_at,
          chainlink_feed: chainlink[symbol].chainlink_feed,
          // change_source intentionally NOT overridden — it stays from the
          // underlying source (coincap/coingecko/fallback)
        };
      } else {
        // No API data at all — use Chainlink alone with fallback metadata
        const fb = FALLBACK_DATA[symbol];
        result = {
          ...(fb || {
            id: symbol.toLowerCase(),
            symbol: symbol.toLowerCase(),
            name: symbol,
            price_change_percentage_24h: 0,
            market_cap: 0,
            total_volume: 0,
            image: TOKEN_LOGOS[symbol] || "",
          }),
          current_price: chainlink[symbol].current_price,
          oracle_source: "chainlink" as OracleSource,
          oracle_updated_at: chainlink[symbol].oracle_updated_at,
          chainlink_feed: chainlink[symbol].chainlink_feed,
          change_source: "fallback" as OracleSource,
        };
      }
    }

    if (result) {
      // Ensure image is set
      result.image = result.image || TOKEN_LOGOS[symbol] || "";
      merged[symbol] = result;

      // Count oracle sources for stats
      switch (result.oracle_source) {
        case "chainlink": clCount++; break;
        case "coincap": ccCount++; break;
        case "coingecko": cgCount++; break;
        default: fbCount++; break;
      }
    }
  }

  // Update global oracle stats
  updateOracleStats({
    chainlinkCount: clCount,
    coincapCount: ccCount,
    coingeckoCount: cgCount,
    fallbackCount: fbCount,
    totalFeeds: symbols.length,
  });

  log.debug("Oracle", `Merged ${symbols.length} tokens: ${clCount} Chainlink · ${ccCount} CoinCap · ${cgCount} CoinGecko · ${fbCount} Fallback`);

  // ── HBAR fast-path patch ─────────────────────────────────────────
  // If HBAR ended up on fallback or has no live price, override with
  // the dedicated multi-source fetch (Binance → CoinCap → CoinGecko).
  // This runs automatically for ALL consumers (Dashboard, Trading, etc.).
  if (hbarFast && hbarFast.current_price > 0) {
    const existing = merged["HBAR"];
    if (!existing || existing.oracle_source === "fallback" || existing.current_price <= 0) {
      merged["HBAR"] = hbarFast;
      log.debug("Oracle", `HBAR patched from fast-path: $${hbarFast.current_price.toFixed(4)}`);
    }
  }

  return merged;
};

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
      /* fall through to CoinCap */
    }
  }

  // Try CoinCap as fallback
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
      /* fall through to hardcoded fallback */
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
// Market-cap-weighted composite of the top 20 cryptocurrencies.
// Uses CoinGecko /coins/markets endpoint (free tier, no API key).

export interface Top20IndexData {
  totalMarketCap: number;          // Sum of top 20 market caps (USD)
  weightedChange24h: number;       // Market-cap-weighted average 24h change (%)
  topCoinCount: number;            // Number of coins in the composite
  topCoins: Top20Coin[];           // Individual coin data for breakdown
}

export interface Top20Coin {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
  image: string;
  dominancePercent: number;        // Share of top-20 total market cap
}

const TOP20_FALLBACK: Top20IndexData = {
  totalMarketCap: 3_180_000_000_000,
  weightedChange24h: 1.42,
  topCoinCount: 20,
  topCoins: [],
};

let _top20Cache: { data: Top20IndexData; ts: number } | null = null;
const TOP20_CACHE_TTL_MS = 120_000; // 2-minute client-side cache

export async function fetchTop20Index(): Promise<Top20IndexData> {
  // Check client-side cache
  if (_top20Cache && Date.now() - _top20Cache.ts < TOP20_CACHE_TTL_MS) {
    return _top20Cache.data;
  }

  // CoinGecko /coins/markets — top 20 by market cap
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
        dominancePercent: 0, // Calculated below
      };
    });

    // Calculate dominance percentages
    if (totalMcap > 0) {
      topCoins.forEach(c => { c.dominancePercent = (c.marketCap / totalMcap) * 100; });
    }

    const weightedChange = totalMcap > 0 ? weightedChangeSum / totalMcap : 0;

    const result: Top20IndexData = {
      totalMarketCap: totalMcap,
      weightedChange24h: weightedChange,
      topCoinCount: topCoins.length,
      topCoins,
    };
    _top20Cache = { data: result, ts: Date.now() };
    return result;
  } catch {
    clearTimeout(timeoutId);
  }

  // Fallback: try to compute from CoinCap
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
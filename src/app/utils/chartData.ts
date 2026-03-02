import type { CandlestickData } from "lightweight-charts";
import { fetchCoinCapHistory, type HistoryPoint, COINCAP_ID_MAP, COIN_ID_MAP } from "./coingecko";
import { TOKEN_REGISTRY } from "./tokens";
import { log } from "./logger";

// ── Candle colors (green up, blue down — matches screenshot) ─────────
export const CANDLE_COLORS = {
  upColor: "#22c55e",
  downColor: "#3b82f6",
  borderUpColor: "#22c55e",
  borderDownColor: "#3b82f6",
  wickUpColor: "#22c55e",
  wickDownColor: "#3b82f6",
} as const;

// ── Data source tracking ─────────────────────────────────────────────
export type ChartDataSource = "binance" | "coingecko" | "coincap" | "synthetic";

export interface ChartResult {
  candles: CandlestickData[];
  source: ChartDataSource;
}

// ── Binance symbol mapping ───────────────────────────────────────────
const BINANCE_SYMBOL_MAP: Record<string, string> = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", XRP: "XRPUSDT", HBAR: "HBARUSDT",
  BNB: "BNBUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT", ADA: "ADAUSDT",
  AVAX: "AVAXUSDT", TRX: "TRXUSDT", TON: "TONUSDT", LINK: "LINKUSDT",
  SHIB: "SHIBUSDT", DOT: "DOTUSDT", LTC: "LTCUSDT", PAXG: "PAXGUSDT",
  AAVE: "AAVEUSDT", DAI: "DAIUSDT",
  XLM: "XLMUSDT", UNI: "UNIUSDT",
  HYPE: "HYPEUSDT",
  // IMPLEMENTATION NOTE: Canton (CC) is NOT listed on Binance — no valid pair.
  // Charts fall through to CoinGecko OHLC → CoinCap → synthetic cascade.
};

// ── Binance interval mapping ─────────────────────────────────────────
const BINANCE_INTERVAL_MAP: Record<string, string> = {
  "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w", "1M": "1M", "ALL": "1M",
};

// ── Cache ────────────────────────────────────────────────────────────
const CACHE = new Map<string, { ts: number; data: ChartResult }>();
const CACHE_TTL = 60_000; // 1 minute

export function invalidateChartCache(symbol?: string) {
  if (symbol) {
    for (const key of CACHE.keys()) {
      if (key.startsWith(`${symbol}:`)) CACHE.delete(key);
    }
  } else {
    CACHE.clear();
  }
}

// ── Binance Klines fetcher ───────────────────────────────────────────
async function fetchBinanceKlines(
  symbol: string,
  timeframe: string,
  limit: number = 200
): Promise<CandlestickData[]> {
  const pair = BINANCE_SYMBOL_MAP[symbol];
  if (!pair) return [];

  const interval = BINANCE_INTERVAL_MAP[timeframe] || "1d";
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.debug("Binance", `HTTP ${res.status} for ${symbol}`);
      return [];
    }
    const data: any[][] = await res.json();
    return data.map((k) => ({
      time: (Math.floor(k[0] / 1000)) as any,
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));
  } catch (err) {
    log.debug("Binance", `Klines fetch failed for ${symbol}`, (err as Error).message);
    return [];
  }
}

// ── CoinCap history → OHLC candle converter ──────────────────────────
function historyToCandles(
  points: HistoryPoint[],
  bucketMs: number
): CandlestickData[] {
  if (points.length < 2) return [];

  const buckets = new Map<number, number[]>();
  for (const p of points) {
    const key = Math.floor(p.time / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p.priceUsd);
  }

  const candles: CandlestickData[] = [];
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
  for (const key of sortedKeys) {
    const prices = buckets.get(key)!;
    candles.push({
      time: (Math.floor(key / 1000)) as any,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
    });
  }
  return candles;
}

// ── CoinCap interval + days for each timeframe ──────────────────────
function getCoinCapParams(timeframe: string): {
  interval: "m1" | "m5" | "m15" | "m30" | "h1" | "h2" | "h6" | "h12" | "d1";
  days: number;
  bucketMs: number;
} {
  switch (timeframe) {
    case "1H":
      return { interval: "m1", days: 1, bucketMs: 60 * 60 * 1000 };
    case "4H":
      return { interval: "m5", days: 2, bucketMs: 4 * 60 * 60 * 1000 };
    case "1D":
      return { interval: "m30", days: 7, bucketMs: 24 * 60 * 60 * 1000 };
    case "1W":
      return { interval: "h2", days: 30, bucketMs: 7 * 24 * 60 * 60 * 1000 };
    case "1M":
      return { interval: "h12", days: 90, bucketMs: 30 * 24 * 60 * 60 * 1000 };
    case "ALL":
      return { interval: "d1", days: 365, bucketMs: 30 * 24 * 60 * 60 * 1000 };
    default:
      return { interval: "h1", days: 7, bucketMs: 24 * 60 * 60 * 1000 };
  }
}

// ── CoinGecko OHLC fetcher ───────────────────────────────────────────
async function fetchCoinGeckoOHLC(symbol: string, days: number): Promise<CandlestickData[]> {
  const coinId = COIN_ID_MAP[symbol];
  if (!coinId) return [];

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: number[][] = await res.json();
    return data.map((d) => ({
      time: (Math.floor(d[0] / 1000)) as any,
      open: d[1],
      high: d[2],
      low: d[3],
      close: d[4],
    }));
  } catch {
    return [];
  }
}

// ── Synthetic candle generator (deterministic from price) ────────────
export function generateCandlestickData(
  symbol: string,
  _timeframe: string = "1D",
  fallbackPrice?: number
): CandlestickData[] {
  const tokenDef = TOKEN_REGISTRY.find((t) => t.symbol === symbol);
  const basePrice = fallbackPrice ?? tokenDef?.fallbackPrice ?? 100;
  const volatility = tokenDef?.volatility ?? 0.06;

  const candles: CandlestickData[] = [];
  const now = Math.floor(Date.now() / 1000);
  const count = 90;
  let price = basePrice * (1 - volatility * 2);

  // Deterministic seed from symbol
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed += symbol.charCodeAt(i);

  for (let i = 0; i < count; i++) {
    seed = (seed * 16807 + 7) % 2147483647;
    const rand = seed / 2147483647;
    const change = (rand - 0.48) * volatility * basePrice * 0.15;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + rand * volatility * 0.05);
    const low = Math.min(open, close) * (1 - rand * volatility * 0.05);
    price = close;

    candles.push({
      time: (now - (count - i) * 86400) as any,
      open,
      high,
      low,
      close,
    });
  }

  return candles;
}

// ── Main fetch with source tracking ─────────────────────────────────
export async function fetchRealCandlesWithSource(
  symbol: string,
  timeframe: string = "1D",
  fallbackPrice?: number
): Promise<ChartResult> {
  const cacheKey = `${symbol}:${timeframe}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  // 1) Try Binance klines
  try {
    const limit = timeframe === "ALL" ? 500 : 200;
    const binanceCandles = await fetchBinanceKlines(symbol, timeframe, limit);
    if (binanceCandles.length >= 5) {
      const result: ChartResult = { candles: binanceCandles, source: "binance" };
      CACHE.set(cacheKey, { ts: Date.now(), data: result });
      log.debug("Chart", `${symbol} ${timeframe}: ${binanceCandles.length} candles from Binance`);
      return result;
    }
  } catch (err) {
    log.debug("Chart", `Binance failed for ${symbol}`, (err as Error).message);
  }

  // 2) Try CoinGecko OHLC
  try {
    const days = timeframe === "ALL" ? 365 : timeframe === "1M" ? 90 : timeframe === "1W" ? 30 : 7;
    const cgCandles = await fetchCoinGeckoOHLC(symbol, days);
    if (cgCandles.length >= 5) {
      const result: ChartResult = { candles: cgCandles, source: "coingecko" };
      CACHE.set(cacheKey, { ts: Date.now(), data: result });
      log.debug("Chart", `${symbol} ${timeframe}: ${cgCandles.length} candles from CoinGecko`);
      return result;
    }
  } catch (err) {
    log.debug("Chart", `CoinGecko failed for ${symbol}`, (err as Error).message);
  }

  // 3) Try CoinCap history → OHLC conversion
  try {
    const { interval, days, bucketMs } = getCoinCapParams(timeframe);
    const history = await fetchCoinCapHistory(symbol, interval, days);
    if (history.length >= 2) {
      const candles = historyToCandles(history, bucketMs);
      if (candles.length >= 3) {
        const result: ChartResult = { candles, source: "coincap" };
        CACHE.set(cacheKey, { ts: Date.now(), data: result });
        log.debug("Chart", `${symbol} ${timeframe}: ${candles.length} candles from CoinCap`);
        return result;
      }
    }
  } catch (err) {
    log.debug("Chart", `CoinCap failed for ${symbol}`, (err as Error).message);
  }

  // 4) Synthetic fallback
  const synthetic = generateCandlestickData(symbol, timeframe, fallbackPrice);
  const result: ChartResult = { candles: synthetic, source: "synthetic" };
  CACHE.set(cacheKey, { ts: Date.now(), data: result });
  log.debug("Chart", `${symbol} ${timeframe}: synthetic candles (fallback)`);
  return result;
}

// ── Convenience wrapper (returns just candles, no source) ────────────
export async function fetchRealCandles(
  symbol: string,
  timeframe: string = "1D",
  fallbackPrice?: number
): Promise<CandlestickData[]> {
  const result = await fetchRealCandlesWithSource(symbol, timeframe, fallbackPrice);
  return result.candles;
}

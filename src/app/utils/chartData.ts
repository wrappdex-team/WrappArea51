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
};

// ── Binance interval mapping ─────────────────────────────────────────
const BINANCE_INTERVALS: Record<string, { interval: string; limit: number }> = {
  "1m":  { interval: "1m",  limit: 60 },   // 60 1-minute candles (last ~1 hour at 1m granularity)
  "5m":  { interval: "5m",  limit: 60 },   // 60 5-minute candles (last ~5 hours)
  "30m": { interval: "30m", limit: 48 },   // 48 30-minute candles (last ~24 hours)
  "1H":  { interval: "1m",  limit: 60 },   // 60 1-minute candles = 1 hour view
  "4H":  { interval: "5m",  limit: 48 },   // 48 5-min candles = 4 hours
  "1D":  { interval: "1h",  limit: 24 },   // 24 1-hour candles = 1 day
  "1W":  { interval: "4h",  limit: 42 },   // 42 4-hour candles = 1 week
  "1M":  { interval: "1d",  limit: 30 },   // 30 daily candles = 1 month
  "1Y":  { interval: "1d",  limit: 365 },  // 365 daily candles = 1 year
  "ALL": { interval: "1w",  limit: 200 },  // 200 weekly candles ~4 years
};

// ── CoinGecko OHLC days mapping ──────────────────────────────────────
const COINGECKO_OHLC_DAYS: Record<string, number> = {
  "1m": 1, "5m": 1, "30m": 1, "1H": 1, "4H": 1, "1D": 7, "1W": 30, "1M": 90, "1Y": 365, "ALL": 365,
};

// ── CoinCap interval config ─────────────────────────────────────────
const COINCAP_CONFIG: Record<string, { interval: "h1" | "h6" | "h12" | "d1"; days: number; barMs: number }> = {
  "1m":  { interval: "h1", days: 1,   barMs: 60 * 1000 },            // 1-min bars
  "5m":  { interval: "h1", days: 1,   barMs: 5 * 60 * 1000 },       // 5-min bars
  "30m": { interval: "h1", days: 1,   barMs: 30 * 60 * 1000 },      // 30-min bars
  "1H":  { interval: "h1", days: 1,   barMs: 60 * 1000 },            // 1-min bars from hourly data
  "4H":  { interval: "h1", days: 1,   barMs: 5 * 60 * 1000 },       // 5-min bars
  "1D":  { interval: "h1", days: 3,   barMs: 60 * 60 * 1000 },      // 1h bars
  "1W":  { interval: "h6", days: 10,  barMs: 4 * 60 * 60 * 1000 },  // 4h bars (h6 gives more data density)
  "1M":  { interval: "h6", days: 35,  barMs: 24 * 60 * 60 * 1000 }, // daily bars
  "1Y":  { interval: "d1", days: 365, barMs: 24 * 60 * 60 * 1000 }, // daily bars (1 year)
  "ALL": { interval: "d1", days: 1825, barMs: 7 * 24 * 60 * 60 * 1000 }, // weekly bars (5 years)
};

// ── Cache for chart data (adaptive TTL) ─────────────────���────────────
const chartCache = new Map<string, { data: ChartResult; timestamp: number }>();
const CACHE_TTL_DEFAULT = 5 * 60 * 1000; // 5 minutes
// Intraday views get shorter cache so data stays fresh
const CACHE_TTL_MAP: Record<string, number> = {
  "1m":  30_000,     // 30s — near-realtime
  "5m":  60_000,     // 1 min
  "30m": 2 * 60_000, // 2 min
  "1H":  2 * 60_000, // 2 min
  "4H":  3 * 60_000, // 3 min
};

function getCacheTTL(period: string): number {
  return CACHE_TTL_MAP[period] || CACHE_TTL_DEFAULT;
}

function getCacheKey(symbol: string, period: string): string {
  return `${symbol}-${period}`;
}

// ══════════════════════════════════════════════════════════════════════
// SOURCE 1: Binance Klines API (best OHLC data, free, no auth)
// ══════════════════════════════════════════════════════════════════════
async function fetchBinanceKlines(
  symbol: string,
  period: string
): Promise<CandlestickData[]> {
  const binanceSymbol = BINANCE_SYMBOL_MAP[symbol];
  if (!binanceSymbol) return [];

  const config = BINANCE_INTERVALS[period] || BINANCE_INTERVALS["1D"];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${config.interval}&limit=${config.limit}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      log.debug("Chart", `Binance HTTP ${res.status} for ${binanceSymbol}`);
      return [];
    }

    const data: any[][] = await res.json();
    if (!Array.isArray(data) || data.length < 3) return [];

    const candles: CandlestickData[] = data.map((k) => ({
      time: (Math.floor(k[0] / 1000)) as any, // Open time ms → seconds
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    // Deduplicate by time
    const seen = new Set<number>();
    return candles.filter(c => {
      const t = c.time as number;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  } catch (err) {
    clearTimeout(timeoutId);
    log.debug("Chart", "Binance fetch failed", (err as Error).message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════
// SOURCE 2: CoinGecko OHLC API
// ══════════════════════════════════════════════════════════════════════
async function fetchCoinGeckoOHLC(
  symbol: string,
  period: string
): Promise<CandlestickData[]> {
  const geckoId = COIN_ID_MAP[symbol];
  if (!geckoId) return [];

  const days = COINGECKO_OHLC_DAYS[period] || 30;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${geckoId}/ohlc?vs_currency=usd&days=${days}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      log.debug("Chart", `CoinGecko OHLC HTTP ${res.status} for ${geckoId}`);
      return [];
    }

    const data: number[][] = await res.json();
    if (!Array.isArray(data) || data.length < 3) return [];

    // CoinGecko returns [[timestamp_ms, open, high, low, close], ...]
    const candles: CandlestickData[] = data.map((d) => ({
      time: (Math.floor(d[0] / 1000)) as any,
      open: d[1],
      high: d[2],
      low: d[3],
      close: d[4],
    }));

    // Deduplicate by time
    const seen = new Set<number>();
    return candles.filter(c => {
      const t = c.time as number;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  } catch (err) {
    clearTimeout(timeoutId);
    log.debug("Chart", "CoinGecko OHLC fetch failed", (err as Error).message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════
// SOURCE 3: CoinCap History (converted to OHLC)
// ══════════════════════════════════════════════════════════════════════
function historyToOHLCV(points: HistoryPoint[], barMs: number): CandlestickData[] {
  if (points.length < 2) return [];

  const buckets = new Map<number, number[]>();
  for (const p of points) {
    const barTime = Math.floor(p.time / barMs) * barMs;
    let arr = buckets.get(barTime);
    if (!arr) { arr = []; buckets.set(barTime, arr); }
    arr.push(p.priceUsd);
  }

  const bars: CandlestickData[] = [];
  for (const barTime of [...buckets.keys()].sort((a, b) => a - b)) {
    const prices = buckets.get(barTime)!;
    if (prices.length === 0) continue;
    bars.push({
      time: (barTime / 1000) as any,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
    });
  }
  return bars;
}

async function fetchCoinCapOHLC(
  symbol: string,
  period: string
): Promise<CandlestickData[]> {
  const config = COINCAP_CONFIG[period] || COINCAP_CONFIG["1D"];
  
  try {
    const history = await fetchCoinCapHistory(symbol, config.interval, config.days);
    if (history.length >= 5) {
      const bars = historyToOHLCV(history, config.barMs);
      if (bars.length >= 3) return bars;
    }
  } catch {
    log.debug("Chart", `CoinCap history failed for ${symbol}`);
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════
// SYNTHETIC CANDLE GENERATOR (last resort)
// ══════════════════════════════════════════════════════════════════════
export function generateCandlestickData(
  currentPrice: number,
  volatility: number = 0.06,
  count: number = 30,
  secPerBar: number = 86400
): CandlestickData[] {
  const data: CandlestickData[] = [];
  const now = Math.floor(Date.now() / 1000);
  // Start price slightly below current to create realistic drift
  let price = currentPrice * (1 - volatility * 1.5);

  // Use deterministic-ish seed based on current price to avoid random reshuffles
  let seed = Math.floor(currentPrice * 1000) % 10000;
  const pseudoRand = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return seed / 2147483647;
  };

  for (let i = count; i >= 0; i--) {
    const time = (now - i * secPerBar) as any;
    const change = (pseudoRand() - 0.46) * (currentPrice * volatility * 0.5);
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + pseudoRand() * (currentPrice * volatility * 0.15);
    const low = Math.min(open, close) - pseudoRand() * (currentPrice * volatility * 0.15);
    data.push({ time, open, high, low, close });
    price = close;
  }

  // Anchor last candle to current price
  const last = data.length - 1;
  if (last >= 0) {
    data[last].close = currentPrice;
    data[last].high = Math.max(data[last].high, currentPrice);
    data[last].low = Math.min(data[last].low, currentPrice);
  }
  return data;
}

// Synthetic config per timeframe
const SYNTHETIC_CONFIG: Record<string, { count: number; secPerBar: number }> = {
  "1m":  { count: 60,  secPerBar: 1 },       // 60 1-second bars (1 minute view)
  "5m":  { count: 60,  secPerBar: 5 },       // 60 5-second bars (5 minute view)
  "30m": { count: 60,  secPerBar: 30 },      // 60 30-second bars (30 minute view)
  "1H":  { count: 60,  secPerBar: 60 },
  "4H":  { count: 48,  secPerBar: 300 },
  "1D":  { count: 24,  secPerBar: 3600 },
  "1W":  { count: 42,  secPerBar: 14400 },
  "1M":  { count: 30,  secPerBar: 86400 },
  "1Y":  { count: 52,  secPerBar: 604800 },  // 52 weekly bars = 1 year
  "ALL": { count: 52,  secPerBar: 604800 },
};

// ══════════════════════════════════════════════════════════════════════
// MAIN FETCH: Multi-source with cache
// ══════════════════════════════════════════════════════════════════════
export async function fetchRealCandles(
  symbol: string,
  barPeriod: string = "1D",
  currentPrice?: number
): Promise<CandlestickData[]> {
  const result = await fetchRealCandlesWithSource(symbol, barPeriod, currentPrice);
  return result.candles;
}

export async function fetchRealCandlesWithSource(
  symbol: string,
  barPeriod: string = "1D",
  currentPrice?: number
): Promise<ChartResult> {
  const cacheKey = getCacheKey(symbol, barPeriod);

  // Check cache
  const cached = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < getCacheTTL(barPeriod)) {
    return cached.data;
  }

  // Source 1: Binance Klines (best quality OHLC)
  try {
    const binanceCandles = await fetchBinanceKlines(symbol, barPeriod);
    if (binanceCandles.length >= 5) {
      const result: ChartResult = { candles: binanceCandles, source: "binance" };
      chartCache.set(cacheKey, { data: result, timestamp: Date.now() });
      log.debug("Chart", `${symbol}/${barPeriod}: ${binanceCandles.length} candles from Binance`);
      return result;
    }
  } catch { /* continue to next source */ }

  // Source 2: CoinGecko OHLC
  try {
    const geckoCandles = await fetchCoinGeckoOHLC(symbol, barPeriod);
    if (geckoCandles.length >= 5) {
      const result: ChartResult = { candles: geckoCandles, source: "coingecko" };
      chartCache.set(cacheKey, { data: result, timestamp: Date.now() });
      log.debug("Chart", `${symbol}/${barPeriod}: ${geckoCandles.length} candles from CoinGecko OHLC`);
      return result;
    }
  } catch { /* continue to next source */ }

  // Source 3: CoinCap History
  try {
    const coincapCandles = await fetchCoinCapOHLC(symbol, barPeriod);
    if (coincapCandles.length >= 5) {
      const result: ChartResult = { candles: coincapCandles, source: "coincap" };
      chartCache.set(cacheKey, { data: result, timestamp: Date.now() });
      log.debug("Chart", `${symbol}/${barPeriod}: ${coincapCandles.length} candles from CoinCap`);
      return result;
    }
  } catch { /* continue to synthetic */ }

  // Source 4: Synthetic (last resort)
  const price = currentPrice || VOLATILITY_MAP_PRICE[symbol] || 100;
  const vol = VOLATILITY_MAP[symbol] || 0.06;
  const cfg = SYNTHETIC_CONFIG[barPeriod] || SYNTHETIC_CONFIG["1D"];
  const syntheticCandles = generateCandlestickData(price, vol, cfg.count, cfg.secPerBar);
  const result: ChartResult = { candles: syntheticCandles, source: "synthetic" };
  log.debug("Chart", `${symbol}/${barPeriod}: synthetic fallback (${syntheticCandles.length} candles)`);
  return result;
}

// Invalidate cache for a symbol (used by refresh button)
export function invalidateChartCache(symbol?: string): void {
  if (symbol) {
    for (const key of chartCache.keys()) {
      if (key.startsWith(`${symbol}-`)) chartCache.delete(key);
    }
  } else {
    chartCache.clear();
  }
}

// Derived from TOKEN_REGISTRY — single source of truth
const VOLATILITY_MAP: Record<string, number> = Object.fromEntries(
  TOKEN_REGISTRY.map((t) => [t.symbol, t.volatility])
);

const VOLATILITY_MAP_PRICE: Record<string, number> = Object.fromEntries(
  TOKEN_REGISTRY.map((t) => [t.symbol, t.fallbackPrice])
);
import type { CandlestickData } from "lightweight-charts";

type TimeValue = { time: any; value: number };

export function computeSMA(data: CandlestickData[], period: number): TimeValue[] {
  const out: TimeValue[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close as number;
    out.push({ time: data[i].time, value: sum / period });
  }
  return out;
}

export function computeEMA(data: CandlestickData[], period: number): TimeValue[] {
  if (data.length === 0) return [];
  const out: TimeValue[] = [];
  const k = 2 / (period + 1);
  let ema = data[0].close as number;
  out.push({ time: data[0].time, value: ema });
  for (let i = 1; i < data.length; i++) {
    ema = (data[i].close as number) * k + ema * (1 - k);
    if (i >= period - 1) out.push({ time: data[i].time, value: ema });
  }
  return out;
}

export function computeRSI(data: CandlestickData[], period = 14): TimeValue[] {
  const out: TimeValue[] = [];
  const closes = data.map((d) => d.close as number);
  if (closes.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  out.push({ time: data[period].time, value: 100 - 100 / (1 + rs0) });

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push({ time: data[i].time, value: 100 - 100 / (1 + rs) });
  }
  return out;
}

// ── MACD ──

export interface MACDResult {
  macdLine: TimeValue[];
  signalLine: TimeValue[];
  histogram: TimeValue[];
}

/**
 * Compute MACD (Moving Average Convergence Divergence).
 * Default parameters: fast=12, slow=26, signal=9.
 */
export function computeMACD(
  data: CandlestickData[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult {
  const closes = data.map((d) => d.close as number);
  if (closes.length < slowPeriod + signalPeriod) {
    return { macdLine: [], signalLine: [], histogram: [] };
  }

  // Compute EMA helper on raw number arrays
  const emaCalc = (values: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const result: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      result.push(values[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  };

  const fastEMA = emaCalc(closes, fastPeriod);
  const slowEMA = emaCalc(closes, slowPeriod);

  // MACD line = fast EMA - slow EMA (only valid after slowPeriod)
  const macdValues: number[] = [];
  const macdLine: TimeValue[] = [];
  for (let i = slowPeriod - 1; i < closes.length; i++) {
    const val = fastEMA[i] - slowEMA[i];
    macdValues.push(val);
    macdLine.push({ time: data[i].time, value: val });
  }

  // Signal line = 9-period EMA of MACD line
  const signalEMA = emaCalc(macdValues, signalPeriod);
  const signalLine: TimeValue[] = [];
  const histogram: TimeValue[] = [];
  for (let i = signalPeriod - 1; i < macdValues.length; i++) {
    const dataIdx = slowPeriod - 1 + i;
    signalLine.push({ time: data[dataIdx].time, value: signalEMA[i] });
    histogram.push({ time: data[dataIdx].time, value: macdValues[i] - signalEMA[i] });
  }

  return { macdLine, signalLine, histogram };
}

// ── Bollinger Bands ──

export interface BollingerBandsResult {
  upper: TimeValue[];
  middle: TimeValue[];
  lower: TimeValue[];
}

/**
 * Compute Bollinger Bands.
 * Default: 20-period SMA with 2 standard deviations.
 */
export function computeBollingerBands(
  data: CandlestickData[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBandsResult {
  const upper: TimeValue[] = [];
  const middle: TimeValue[] = [];
  const lower: TimeValue[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close as number;
    }
    const sma = sum / period;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = (data[j].close as number) - sma;
      variance += diff * diff;
    }
    const stdDev = Math.sqrt(variance / period);

    upper.push({ time: data[i].time, value: sma + stdDevMultiplier * stdDev });
    middle.push({ time: data[i].time, value: sma });
    lower.push({ time: data[i].time, value: sma - stdDevMultiplier * stdDev });
  }

  return { upper, middle, lower };
}

// ── Volume Profile (aggregated by price) ──

export interface VolumeProfileLevel {
  price: number;
  volume: number;
}

/**
 * Compute a simplified volume profile from candlestick data.
 * Groups volume into `buckets` equally-spaced price levels.
 */
export function computeVolumeProfile(
  data: CandlestickData[],
  buckets = 24
): VolumeProfileLevel[] {
  if (data.length === 0) return [];

  let minP = Infinity;
  let maxP = -Infinity;
  for (const d of data) {
    if ((d.low as number) < minP) minP = d.low as number;
    if ((d.high as number) > maxP) maxP = d.high as number;
  }
  if (maxP === minP) maxP = minP + 1;

  const step = (maxP - minP) / buckets;
  const levels: VolumeProfileLevel[] = Array.from({ length: buckets }, (_, i) => ({
    price: minP + step * (i + 0.5),
    volume: 0,
  }));

  for (const d of data) {
    // Estimate volume distributed across the candle's range
    const lo = d.low as number;
    const hi = d.high as number;
    const range = hi - lo || step;
    // Simplified: assign candle's "volume" proportionally (using price range as proxy)
    const volPerUnit = range;
    for (const level of levels) {
      const levelLow = level.price - step / 2;
      const levelHigh = level.price + step / 2;
      const overlap = Math.max(0, Math.min(hi, levelHigh) - Math.max(lo, levelLow));
      level.volume += (overlap / range) * volPerUnit;
    }
  }

  return levels;
}
import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, CandlestickData } from "lightweight-charts";
import { Activity, TrendingUp } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { CANDLE_COLORS, fetchRealCandles, generateCandlestickData } from "../utils/chartData";
import { computeSMA, computeEMA, computeRSI } from "../utils/indicators";
import { getTokenDef } from "../utils/tokens";

// Adaptive priceFormat: ~20 incremental ticks per price-scale unit
function getAdaptivePriceFormat(price: number): { type: "price"; precision: number; minMove: number } {
  if (price >= 10_000) return { type: "price", precision: 2, minMove: 0.05 };
  if (price >= 100)    return { type: "price", precision: 3, minMove: 0.005 };
  if (price >= 0.01)   return { type: "price", precision: 4, minMove: 0.0005 };
  if (price >= 0.0001) return { type: "price", precision: 6, minMove: 0.000005 };
                        return { type: "price", precision: 8, minMove: 0.00000005 };
}

interface MarketDetailChartProps {
  data: CandlestickData[];
  symbol: string;
}

type Timeframe = "1H" | "4H" | "1D" | "1W";
const TIMEFRAMES: Timeframe[] = ["1H", "4H", "1D", "1W"];

export function MarketDetailChart({ data: initialData, symbol }: MarketDetailChartProps) {
  const { isDark, isSky } = useTheme();
  const mainChartRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<HTMLDivElement>(null);
  const mainApiRef = useRef<IChartApi | null>(null);
  const rsiApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlaySeriesRefs = useRef<ISeriesApi<"Line">[]>([]);

  const [showSMA20, setShowSMA20] = useState(false);
  const [showSMA50, setShowSMA50] = useState(false);
  const [showEMA12, setShowEMA12] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [chartData, setChartData] = useState<CandlestickData[]>(initialData);
  const [loadingTF, setLoadingTF] = useState(false);

  // Fetch new candle data when timeframe changes
  useEffect(() => {
    if (timeframe === "1D") {
      setChartData(initialData);
      return;
    }
    let cancelled = false;
    setLoadingTF(true);
    const tokenDef = getTokenDef(symbol);
    const fallbackPrice = tokenDef?.fallbackPrice ?? 100;
    const volatility = tokenDef?.volatility ?? 0.06;

    fetchRealCandles(symbol, timeframe, fallbackPrice)
      .then((candles) => {
        if (!cancelled) {
          setChartData(candles.length >= 3 ? candles : generateCandlestickData(fallbackPrice, volatility));
        }
      })
      .catch(() => {
        if (!cancelled) setChartData(generateCandlestickData(fallbackPrice, volatility));
      })
      .finally(() => { if (!cancelled) setLoadingTF(false); });

    return () => { cancelled = true; };
  }, [timeframe, symbol, initialData]);

  const bgColor = "transparent";
  const textColor = isDark ? "#94a3b8" : "#6b7280";
  const gridColor = isDark ? "rgba(148,163,184,0.08)" : "rgba(0,0,0,0.04)";
  const borderColor = isDark ? "rgba(148,163,184,0.15)" : "rgba(0,0,0,0.08)";

  // Build main chart
  useEffect(() => {
    if (!mainChartRef.current) return;
    let cancelled = false;
    let localChart: IChartApi | null = null;
    let resizeHandler: (() => void) | null = null;

    overlaySeriesRefs.current = [];

    import("lightweight-charts").then((LWC) => {
      if (cancelled || !mainChartRef.current) return;

      const chart = LWC.createChart(mainChartRef.current, {
        width: mainChartRef.current.clientWidth,
        height: 320,
        layout: { background: { color: bgColor }, textColor },
        grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
        timeScale: { borderColor, timeVisible: true },
        rightPriceScale: { borderColor },
        crosshair: {
          vertLine: { color: isDark ? (isSky ? "rgba(14,165,233,0.3)" : "rgba(236,72,153,0.3)") : (isSky ? "rgba(14,165,233,0.2)" : "rgba(236,72,153,0.2)"), labelBackgroundColor: isSky ? "#0ea5e9" : "#ec4899" },
          horzLine: { color: isDark ? (isSky ? "rgba(14,165,233,0.3)" : "rgba(236,72,153,0.3)") : (isSky ? "rgba(14,165,233,0.2)" : "rgba(236,72,153,0.2)"), labelBackgroundColor: isSky ? "#0ea5e9" : "#ec4899" },
        },
      });
      localChart = chart;

      // Derive price from chart data for adaptive granularity
      const lastClose = chartData.length > 0 ? (chartData[chartData.length - 1].close as number) : 100;
      const priceFmt = getAdaptivePriceFormat(lastClose);

      const series = chart.addSeries(LWC.CandlestickSeries, { ...CANDLE_COLORS, priceFormat: priceFmt });
      series.setData(chartData);
      candleSeriesRef.current = series;
      mainApiRef.current = chart;

      // Overlays
      if (showSMA20) {
        const smaData = computeSMA(chartData, 20);
        const smaLine = chart.addSeries(LWC.LineSeries, {
          color: "#f59e0b",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        smaLine.setData(smaData);
        overlaySeriesRefs.current.push(smaLine);
      }

      if (showSMA50) {
        const smaData = computeSMA(chartData, Math.min(50, chartData.length - 1));
        const smaLine = chart.addSeries(LWC.LineSeries, {
          color: "#a855f7",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        smaLine.setData(smaData);
        overlaySeriesRefs.current.push(smaLine);
      }

      if (showEMA12) {
        const emaData = computeEMA(chartData, 12);
        const emaLine = chart.addSeries(LWC.LineSeries, {
          color: "#06b6d4",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        emaLine.setData(emaData);
        overlaySeriesRefs.current.push(emaLine);
      }

      chart.timeScale().fitContent();

      resizeHandler = () => {
        if (mainChartRef.current && mainApiRef.current) {
          mainApiRef.current.applyOptions({ width: mainChartRef.current.clientWidth });
        }
      };
      window.addEventListener("resize", resizeHandler);
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (localChart) {
        try { localChart.remove(); } catch {}
        localChart = null;
      }
      mainApiRef.current = null;
    };
  }, [chartData, isDark, isSky, showSMA20, showSMA50, showEMA12]);

  // Build RSI chart
  useEffect(() => {
    if (!showRSI || !rsiChartRef.current) {
      if (rsiApiRef.current) {
        try { rsiApiRef.current.remove(); } catch {}
        rsiApiRef.current = null;
      }
      return;
    }

    let cancelled = false;
    let localChart: IChartApi | null = null;
    let resizeHandler: (() => void) | null = null;

    import("lightweight-charts").then((LWC) => {
      if (cancelled || !rsiChartRef.current) return;

      const chart = LWC.createChart(rsiChartRef.current, {
        width: rsiChartRef.current.clientWidth,
        height: 120,
        layout: { background: { color: bgColor }, textColor },
        grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
        timeScale: { borderColor, timeVisible: true },
        rightPriceScale: { borderColor, scaleMargins: { top: 0.1, bottom: 0.1 } },
      });
      localChart = chart;

      const rsiData = computeRSI(chartData, 14);
      const rsiLine = chart.addSeries(LWC.LineSeries, {
        color: "#ec4899",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      rsiLine.setData(rsiData);

      // Overbought/oversold reference lines
      const ob = chart.addSeries(LWC.LineSeries, {
        color: isDark ? "rgba(239,68,68,0.3)" : "rgba(239,68,68,0.2)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ob.setData(rsiData.map((d) => ({ time: d.time, value: 70 })));

      const os = chart.addSeries(LWC.LineSeries, {
        color: isDark ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.2)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      os.setData(rsiData.map((d) => ({ time: d.time, value: 30 })));

      chart.timeScale().fitContent();
      rsiApiRef.current = chart;

      // Sync time scales
      if (mainApiRef.current) {
        mainApiRef.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (range && rsiApiRef.current) {
            rsiApiRef.current.timeScale().setVisibleLogicalRange(range);
          }
        });
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (range && mainApiRef.current) {
            mainApiRef.current.timeScale().setVisibleLogicalRange(range);
          }
        });
      }

      resizeHandler = () => {
        if (rsiChartRef.current && rsiApiRef.current) {
          rsiApiRef.current.applyOptions({ width: rsiChartRef.current.clientWidth });
        }
      };
      window.addEventListener("resize", resizeHandler);
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (localChart) {
        try { localChart.remove(); } catch {}
        localChart = null;
      }
      rsiApiRef.current = null;
    };
  }, [chartData, isDark, showRSI]);

  const toolBtnClass = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs transition-all duration-200 ${
      active
        ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
        : isDark
        ? "bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700"
        : "bg-gray-100 text-gray-500 hover:text-gray-800 hover:bg-gray-200"
    }`;

  const tfBtnClass = (active: boolean) =>
    `px-2 py-1 rounded text-xs transition-all duration-200 ${
      active
        ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
        : isDark
        ? "text-slate-500 hover:text-white"
        : "text-gray-400 hover:text-gray-800"
    }`;

  return (
    <div className={`rounded-xl overflow-hidden border mt-3 ${
      isDark
        ? "bg-slate-900/40 border-slate-700/40"
        : "bg-gray-50 border-gray-200"
    }`}>
      {/* Toolbar */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${
        isDark ? "border-slate-700/40" : "border-gray-200"
      }`}>
        {/* Timeframes */}
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} onClick={() => setTimeframe(tf)} className={tfBtnClass(timeframe === tf)}>
              {tf}
            </button>
          ))}
          {loadingTF && <span className={`text-[10px] ml-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Loading...</span>}
        </div>

        {/* Indicator toggles */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowSMA20((p) => !p)} className={toolBtnClass(showSMA20)}>
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              SMA 20
            </span>
          </button>
          <button onClick={() => setShowSMA50((p) => !p)} className={toolBtnClass(showSMA50)}>
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              SMA 50
            </span>
          </button>
          <button onClick={() => setShowEMA12((p) => !p)} className={toolBtnClass(showEMA12)}>
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              EMA 12
            </span>
          </button>

          <div className={`w-px h-5 mx-1 ${isDark ? "bg-slate-700" : "bg-gray-300"}`} />

          <button onClick={() => setShowRSI((p) => !p)} className={toolBtnClass(showRSI)}>
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3" />
              RSI
            </span>
          </button>
        </div>

        {/* Legend dots */}
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#22c55e]" /> Up
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#3b82f6]" /> Down
          </span>
          {showSMA20 && (
            <span className="flex items-center gap-1">
              <span className="w-4 h-0.5 bg-amber-400 rounded" /> SMA20
            </span>
          )}
          {showSMA50 && (
            <span className="flex items-center gap-1">
              <span className="w-4 h-0.5 bg-purple-400 rounded" /> SMA50
            </span>
          )}
          {showEMA12 && (
            <span className="flex items-center gap-1">
              <span className="w-4 h-0.5 bg-cyan-400 rounded" /> EMA12
            </span>
          )}
        </div>
      </div>

      {/* Main candlestick chart */}
      <div ref={mainChartRef} className="w-full" />

      {/* RSI chart */}
      {showRSI && (
        <div className={`border-t ${isDark ? "border-slate-700/40" : "border-gray-200"}`}>
          <div className={`px-4 py-1.5 text-xs flex items-center gap-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            <Activity className="w-3 h-3 text-pink-400" />
            RSI (14) &mdash;
            <span className="text-red-400">Overbought 70</span> /
            <span className="text-green-400">Oversold 30</span>
          </div>
          <div ref={rsiChartRef} className="w-full" />
        </div>
      )}
    </div>
  );
}
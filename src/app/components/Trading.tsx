import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  TrendingUp,
  TrendingDown,
  ChevronDown,
  Search,
  Star,
  Activity,
  BarChart2,
  LineChart,
  Zap,
  Lock,
  Crown,
  ShieldCheck,
  ArrowRightLeft,
  ExternalLink,
  Waves,
  Info,
  RefreshCw,
  Loader2,
} from "lucide-react";
import type { IChartApi, CandlestickData, ISeriesApi } from "lightweight-charts";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { useParams } from "react-router";
import { fetchCoinPrices, formatVolume, type CoinPrice, type OracleSource } from "../utils/coingecko";
import { fetchRealCandlesWithSource, CANDLE_COLORS, invalidateChartCache, type ChartDataSource } from "../utils/chartData";
import { formatOracleAge, getFeedInfo } from "../utils/chainlink";
import { ChartDrawingTools } from "./ChartDrawingTools";
import { TOKEN_REGISTRY, TRADING_TOKENS, type TokenDef } from "../utils/tokens";
import { computeSMA, computeEMA, computeRSI, computeMACD, computeBollingerBands } from "../utils/indicators";
import { isVipEligible } from "../utils/vip";
import { GATE_THRESHOLD, formatTokenCount } from "../utils/dao";
import { TradingSwapPanel } from "./TradingSwapPanel";
import { TradingPoolsSection } from "./TradingPoolsSection";
import { VipChatBox } from "./VipChatBox";
import { VIPAccessGate } from "./VIPAccessGate";
import { Tip } from "./Tip";
import { AtomicSwapHistory } from "./AtomicSwapHistory";
import { LPPositionTracker } from "./LPPositionTracker";

// ── Constants ───────────────────────────────────────────────────────

const TOKENS = TRADING_TOKENS;
const TIMEFRAMES = ["1m", "5m", "30m", "1H", "4H", "1D", "1W", "1M", "1Y", "All"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

// Maps AMM wrapped-token symbols to chart-registry equivalents.
// Direct matches (USDC, LINK, AAVE, DAI) fall through automatically.
const AMM_TO_CHART: Record<string, string> = {
  WHBAR: "HBAR", WBTC: "BTC", WETH: "ETH", WBNB: "BNB", WAVAX: "AVAX",
};

// Adaptive priceFormat: ~20 incremental ticks between each "unit" at the token's price scale
function getAdaptivePriceFormat(price: number): { type: "price"; precision: number; minMove: number } {
  // 20 sub-ticks between each order-of-magnitude unit
  if (price >= 10_000) return { type: "price", precision: 2, minMove: 0.05 };        // 20 ticks / $1
  if (price >= 100)    return { type: "price", precision: 3, minMove: 0.005 };       // 20 ticks / $0.10
  if (price >= 0.01)   return { type: "price", precision: 4, minMove: 0.0005 };      // 20 ticks / $0.01 (cent)
  if (price >= 0.0001) return { type: "price", precision: 6, minMove: 0.000005 };    // 20 ticks / $0.0001
                        return { type: "price", precision: 8, minMove: 0.00000005 };  // 20 ticks / $0.000001
}

// ── VIP-Gated CEX Trading Component ──────────────────────────────────

export function Trading() {
  const { isDark } = useTheme();
  const { symbol: urlSymbol } = useParams<{ symbol?: string }>();
  const {
    primaryWallet,
    hederaAccount,
    hederaNetwork,
  } = useWallet();

  // ── VIP eligibility check ──
  const isVip = useMemo(() => {
    if (!hederaAccount?.tokens) return false;
    return isVipEligible(hederaAccount.tokens, hederaNetwork);
  }, [hederaAccount?.tokens, hederaNetwork]);

  // ── Token selector + chart state ──
  const resolveInitialToken = (): TokenDef => {
    if (urlSymbol) {
      const match = TOKENS.find(
        (t) => t.symbol.toLowerCase() === urlSymbol.toLowerCase()
      );
      if (match) return match;
    }
    return TOKENS.find(t => t.symbol === "HBAR") || TOKENS[0];
  };

  const [selectedToken, setSelectedToken] = useState(resolveInitialToken);
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [prices, setPrices] = useState<Record<string, CoinPrice>>({});
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("hbarh-fav-tokens");
      return stored ? JSON.parse(stored) : ["BTC", "ETH", "HBAR", "SOL"];
    } catch { return ["BTC", "ETH", "HBAR", "SOL"]; }
  });
  const [chartMode, setChartMode] = useState<"candle" | "line">("candle");
  const [realChartData, setRealChartData] = useState<CandlestickData[] | null>(null);
  const [chartDataSource, setChartDataSource] = useState<ChartDataSource>("synthetic");
  const [chartLoading, setChartLoading] = useState(false);

  const [showSMA20, setShowSMA20] = useState(false);
  const [showSMA50, setShowSMA50] = useState(false);
  const [showEMA12, setShowEMA12] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [showBB, setShowBB] = useState(false);

  // Watchlist filter
  const [watchlistFilter, setWatchlistFilter] = useState<"all" | "favorites">("all");
  const [showTfDropdown, setShowTfDropdown] = useState(false);
  const tfDropdownRef = useRef<HTMLDivElement>(null);

  // Close timeframe dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (tfDropdownRef.current && !tfDropdownRef.current.contains(e.target as Node)) {
        setShowTfDropdown(false);
      }
    };
    if (showTfDropdown) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showTfDropdown]);

  const mainChartRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const rsiChartApiRef = useRef<IChartApi | null>(null);
  const macdChartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Persist favorites
  useEffect(() => {
    try { localStorage.setItem("hbarh-fav-tokens", JSON.stringify(favorites)); } catch {}
  }, [favorites]);

  // Fetch prices
  useEffect(() => {
    const load = async () => {
      const syms = TOKEN_REGISTRY.map((t) => t.symbol);
      const data = await fetchCoinPrices(syms);
      setPrices(data);
    };
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  // Pull-to-refresh support — re-fetch prices and chart data on mobile swipe-down
  useEffect(() => {
    const handlePullRefresh = () => {
      const syms = TOKEN_REGISTRY.map((t) => t.symbol);
      fetchCoinPrices(syms).then(setPrices);
      invalidateChartCache(selectedToken.symbol);
      setChartLoading(true);
      const apiPeriod = timeframe === "All" ? "ALL" : timeframe;
      fetchRealCandlesWithSource(selectedToken.symbol, apiPeriod, prices[selectedToken.symbol]?.current_price)
        .then(result => {
          if (result.candles.length >= 5) {
            setRealChartData(result.candles);
            setChartDataSource(result.source);
          }
          setChartLoading(false);
        })
        .catch(() => setChartLoading(false));
    };
    window.addEventListener("wrappdex:pull-refresh", handlePullRefresh);
    return () => window.removeEventListener("wrappdex:pull-refresh", handlePullRefresh);
  }, [selectedToken.symbol, timeframe, prices]);

  // Fetch real chart data when token/timeframe changes
  useEffect(() => {
    setRealChartData(null);
    setChartLoading(true);
    setChartDataSource("synthetic");
    const apiPeriod = timeframe === "All" ? "ALL" : timeframe;
    fetchRealCandlesWithSource(selectedToken.symbol, apiPeriod, prices[selectedToken.symbol]?.current_price)
      .then(result => {
        if (result.candles.length >= 5) {
          setRealChartData(result.candles);
          setChartDataSource(result.source);
        }
        setChartLoading(false);
      })
      .catch(() => { setChartLoading(false); });
  }, [selectedToken.symbol, timeframe]);

  const currentPrice = prices[selectedToken.symbol]?.current_price || selectedToken.fallbackPrice;
  const currentChange = prices[selectedToken.symbol]?.price_change_percentage_24h || selectedToken.fallbackChange;
  const currentChangeSource = prices[selectedToken.symbol]?.change_source || "fallback";
  const currentVolume = prices[selectedToken.symbol]?.total_volume;
  const currentLogo = prices[selectedToken.symbol]?.image || selectedToken.logo;
  const currentOracleSource: OracleSource = prices[selectedToken.symbol]?.oracle_source || "fallback";
  const currentOracleUpdatedAt = prices[selectedToken.symbol]?.oracle_updated_at;
  const currentChainlinkFeed = prices[selectedToken.symbol]?.chainlink_feed;
  const feedInfo = getFeedInfo(selectedToken.symbol);
  const currentMarketCap = prices[selectedToken.symbol]?.market_cap;
  // Real 24h high/low from Binance/CoinGecko ticker (not chart-derived)
  const oracleHigh24h = prices[selectedToken.symbol]?.high_24h;
  const oracleLow24h = prices[selectedToken.symbol]?.low_24h;

  // ── AMM → Chart bridge ──────────────────────────────────────────────
  // Maps wrapped HTS token symbols from the AMM panel to their chart-registry
  // equivalents (e.g., WBTC→BTC, WETH→ETH, WHBAR→HBAR, WBNB→BNB, WAVAX→AVAX).
  // Stablecoins (USDC, USDT, DAI) map directly when present in TRADING_TOKENS.
  const handleAmmTokenChange = useCallback((ammSymbol: string) => {
    const chartSymbol = AMM_TO_CHART[ammSymbol] || ammSymbol;
    const match = TOKENS.find(
      (t) => t.symbol.toLowerCase() === chartSymbol.toLowerCase()
    );
    if (match && match.symbol !== selectedToken.symbol) {
      setSelectedToken(match);
    }
  }, [selectedToken.symbol]);

  // Use real data if available, otherwise generate synthetic candles
  const syntheticData = useMemo(() => {
    const counts: Record<Timeframe, number> = { "1m": 60, "5m": 60, "30m": 60, "1H": 60, "4H": 48, "1D": 24, "1W": 42, "1M": 30, "1Y": 52, "All": 200 };
    const intervals: Record<Timeframe, number> = { "1m": 1/60, "5m": 5/60, "30m": 0.5, "1H": 1, "4H": 5, "1D": 60, "1W": 240, "1M": 1440, "1Y": 10080, "All": 10080 };
    const count = counts[timeframe];
    const secPerBar = intervals[timeframe] * 60;
    const data: CandlestickData[] = [];
    const now = Math.floor(Date.now() / 1000);
    let p = currentPrice * (1 - selectedToken.volatility * 2);
    // Deterministic seed avoids chart jitter on re-render
    let seed = Math.floor(currentPrice * 1000) % 10000;
    const pseudoRand = () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = count; i >= 0; i--) {
      const time = (now - i * secPerBar) as any;
      const change = (pseudoRand() - 0.46) * (currentPrice * selectedToken.volatility * 0.5);
      const open = p;
      const close = p + change;
      const high = Math.max(open, close) + pseudoRand() * (currentPrice * selectedToken.volatility * 0.15);
      const low = Math.min(open, close) - pseudoRand() * (currentPrice * selectedToken.volatility * 0.15);
      data.push({ time, open, high, low, close });
      p = close;
    }
    const last = data.length - 1;
    if (last >= 0) {
      data[last].close = currentPrice;
      data[last].high = Math.max(data[last].high, currentPrice);
      data[last].low = Math.min(data[last].low, currentPrice);
    }
    return data;
  }, [currentPrice, selectedToken.symbol, timeframe]);

  const chartData = realChartData || syntheticData;

  const historicOpen = chartData.length > 0 ? (chartData[0].open as number) : currentPrice;
  const priceChangeFromOpen = currentPrice - historicOpen;
  const pctChangeFromOpen = historicOpen !== 0 ? (priceChangeFromOpen / historicOpen) * 100 : 0;
  const high24 = Math.max(...chartData.map((d) => d.high));
  const low24 = Math.min(...chartData.map((d) => d.low));

  // ── Top 20 tokens sorted by market cap ──
  const sortedWatchlist = useMemo(() => {
    const all = TOKEN_REGISTRY.map(t => ({
      ...t,
      price: prices[t.symbol]?.current_price ?? t.fallbackPrice,
      change: prices[t.symbol]?.price_change_percentage_24h ?? t.fallbackChange,
      changeSource: prices[t.symbol]?.change_source || "fallback",
      marketCap: prices[t.symbol]?.market_cap ?? 0,
      volume: prices[t.symbol]?.total_volume ?? 0,
      logo: prices[t.symbol]?.image ?? t.logo,
    }));
    // Sort by market cap descending
    all.sort((a, b) => b.marketCap - a.marketCap);
    // Top 20
    const top20 = all.slice(0, 20);
    if (watchlistFilter === "favorites") {
      return top20.filter(t => favorites.includes(t.symbol));
    }
    return top20;
  }, [prices, favorites, watchlistFilter]);

  // Build main chart
  useEffect(() => {
    if (!mainChartRef.current) return;
    let cancelled = false;
    let localChart: IChartApi | null = null;
    let resizeHandler: (() => void) | null = null;

    import("lightweight-charts").then((LWC) => {
      if (cancelled || !mainChartRef.current) return;

      const chart = LWC.createChart(mainChartRef.current, {
        width: mainChartRef.current.clientWidth,
        height: (showRSI || showMACD) ? 300 : 380,
        layout: { background: { color: "transparent" }, textColor: isDark ? "#94a3b8" : "#64748b" },
        grid: {
          vertLines: { color: isDark ? "rgba(148,163,184,0.06)" : "rgba(0,0,0,0.04)" },
          horzLines: { color: isDark ? "rgba(148,163,184,0.06)" : "rgba(0,0,0,0.04)" },
        },
        timeScale: { borderColor: isDark ? "rgba(148,163,184,0.1)" : "rgba(0,0,0,0.08)", timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: isDark ? "rgba(148,163,184,0.1)" : "rgba(0,0,0,0.08)" },
        crosshair: {
          vertLine: { labelBackgroundColor: "#ec4899" },
          horzLine: { labelBackgroundColor: "#ec4899" },
        },
      });
      localChart = chart;

      // Adaptive price granularity — ~20 incremental ticks between each price unit
      const priceFmt = getAdaptivePriceFormat(currentPrice);

      if (chartMode === "candle") {
        const candles = chart.addSeries(LWC.CandlestickSeries, { ...CANDLE_COLORS, priceFormat: priceFmt });
        candles.setData(chartData);
        candleSeriesRef.current = candles;
      } else {
        const lineData = chartData.map((d) => ({ time: d.time, value: d.close as number }));
        const lineSeries = chart.addSeries(LWC.LineSeries, {
          color: "#22c55e", lineWidth: 2 as any, priceLineVisible: true,
          lastValueVisible: true, crosshairMarkerVisible: true, crosshairMarkerRadius: 4,
          priceFormat: priceFmt,
        });
        lineSeries.setData(lineData);
        const areaSeries = chart.addSeries(LWC.AreaSeries, {
          topColor: "rgba(34,197,94,0.2)", bottomColor: "rgba(34,197,94,0.02)",
          lineColor: "transparent", lineWidth: 0 as any, priceLineVisible: false,
          lastValueVisible: false, crosshairMarkerVisible: false,
          priceFormat: priceFmt,
        });
        areaSeries.setData(lineData);
        candleSeriesRef.current = null;
      }

      if (showSMA20) {
        const sma = chart.addSeries(LWC.LineSeries, { color: "#f59e0b", lineWidth: 1.5 as any, priceLineVisible: false });
        sma.setData(computeSMA(chartData, 20));
      }
      if (showSMA50) {
        const sma = chart.addSeries(LWC.LineSeries, { color: "#8b5cf6", lineWidth: 1.5 as any, priceLineVisible: false });
        sma.setData(computeSMA(chartData, 50));
      }
      if (showEMA12) {
        const ema = chart.addSeries(LWC.LineSeries, { color: "#06b6d4", lineWidth: 1.5 as any, priceLineVisible: false });
        ema.setData(computeEMA(chartData, 12));
      }
      if (showBB) {
        const bb = computeBollingerBands(chartData);
        chart.addSeries(LWC.LineSeries, { color: "rgba(168,85,247,0.6)", lineWidth: 1 as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(bb.upper);
        chart.addSeries(LWC.LineSeries, { color: "rgba(168,85,247,0.9)", lineWidth: 1.5 as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: 2 as any }).setData(bb.middle);
        chart.addSeries(LWC.LineSeries, { color: "rgba(168,85,247,0.6)", lineWidth: 1 as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(bb.lower);
      }

      chart.timeScale().fitContent();
      chartApiRef.current = chart;

      resizeHandler = () => {
        if (mainChartRef.current && chartApiRef.current) {
          chartApiRef.current.applyOptions({ width: mainChartRef.current.clientWidth });
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
      chartApiRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [chartData, isDark, showSMA20, showSMA50, showEMA12, showRSI, showMACD, showBB, chartMode]);

  // ── Live price tick update — updates last candle without chart rebuild ──
  useEffect(() => {
    if (!candleSeriesRef.current || !chartData.length) return;
    const lastCandle = chartData[chartData.length - 1];
    if (!lastCandle) return;
    // Update last candle's close/high/low to reflect latest price
    try {
      candleSeriesRef.current.update({
        time: lastCandle.time,
        open: lastCandle.open,
        high: Math.max(lastCandle.high as number, currentPrice),
        low: Math.min(lastCandle.low as number, currentPrice),
        close: currentPrice,
      });
    } catch { /* series may be disposed */ }
  }, [currentPrice, chartData]);

  // ── Auto-refresh real chart data every 60s for live history ──
  useEffect(() => {
    if (!realChartData) return;
    const apiPeriod = timeframe === "All" ? "ALL" : timeframe;
    const iv = setInterval(() => {
      fetchRealCandlesWithSource(selectedToken.symbol, apiPeriod, prices[selectedToken.symbol]?.current_price)
        .then(result => {
          if (result.candles.length >= 5) {
            setRealChartData(result.candles);
            setChartDataSource(result.source);
          }
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(iv);
  }, [realChartData, selectedToken.symbol, timeframe]);

  // Build RSI chart
  useEffect(() => {
    if (!showRSI || !rsiChartRef.current) {
      if (rsiChartApiRef.current) { try { rsiChartApiRef.current.remove(); } catch {} rsiChartApiRef.current = null; }
      return;
    }
    let cancelled = false;
    let localChart: IChartApi | null = null;
    let resizeHandler: (() => void) | null = null;

    import("lightweight-charts").then((LWC) => {
      if (cancelled || !rsiChartRef.current) return;
      const chart = LWC.createChart(rsiChartRef.current, {
        width: rsiChartRef.current.clientWidth, height: 80,
        layout: { background: { color: "transparent" }, textColor: isDark ? "#94a3b8" : "#64748b" },
        grid: {
          vertLines: { color: isDark ? "rgba(148,163,184,0.06)" : "rgba(0,0,0,0.04)" },
          horzLines: { color: isDark ? "rgba(148,163,184,0.06)" : "rgba(0,0,0,0.04)" },
        },
        timeScale: { visible: false },
        rightPriceScale: { borderColor: isDark ? "rgba(148,163,184,0.1)" : "rgba(0,0,0,0.08)" },
        crosshair: { vertLine: { visible: false }, horzLine: { labelBackgroundColor: "#a855f7" } },
      });
      localChart = chart;
      chart.addSeries(LWC.LineSeries, { color: "#a855f7", lineWidth: 1.5 as any, priceLineVisible: false }).setData(computeRSI(chartData));
      chart.addSeries(LWC.LineSeries, { color: "rgba(239,68,68,0.3)", lineWidth: 1 as any, priceLineVisible: false, lastValueVisible: false }).setData(chartData.map((d) => ({ time: d.time, value: 70 })));
      chart.addSeries(LWC.LineSeries, { color: "rgba(34,197,94,0.3)", lineWidth: 1 as any, priceLineVisible: false, lastValueVisible: false }).setData(chartData.map((d) => ({ time: d.time, value: 30 })));
      chart.timeScale().fitContent();
      rsiChartApiRef.current = chart;
      if (chartApiRef.current) {
        chartApiRef.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (range && rsiChartApiRef.current) rsiChartApiRef.current.timeScale().setVisibleLogicalRange(range);
        });
      }
      resizeHandler = () => { if (rsiChartRef.current && rsiChartApiRef.current) rsiChartApiRef.current.applyOptions({ width: rsiChartRef.current.clientWidth }); };
      window.addEventListener("resize", resizeHandler);
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (localChart) { try { localChart.remove(); } catch {} localChart = null; }
      rsiChartApiRef.current = null;
    };
  }, [showRSI, chartData, isDark]);

  // Build MACD chart
  useEffect(() => {
    if (!showMACD || !macdChartRef.current) {
      if (macdChartApiRef.current) { try { macdChartApiRef.current.remove(); } catch {} macdChartApiRef.current = null; }
      return;
    }
    let cancelled = false;
    let localChart: IChartApi | null = null;
    let resizeHandler: (() => void) | null = null;

    import("lightweight-charts").then((LWC) => {
      if (cancelled || !macdChartRef.current) return;
      const chart = LWC.createChart(macdChartRef.current, {
        width: macdChartRef.current.clientWidth, height: 100,
        layout: { background: { color: "transparent" }, textColor: isDark ? "#94a3b8" : "#64748b" },
        grid: {
          vertLines: { color: isDark ? "rgba(148,163,184,0.06)" : "rgba(0,0,0,0.04)" },
          horzLines: { color: isDark ? "rgba(148,163,184,0.06)" : "rgba(0,0,0,0.04)" },
        },
        timeScale: { visible: false },
        rightPriceScale: { borderColor: isDark ? "rgba(148,163,184,0.1)" : "rgba(0,0,0,0.08)" },
        crosshair: { vertLine: { visible: false }, horzLine: { labelBackgroundColor: "#3b82f6" } },
      });
      localChart = chart;
      const macdResult = computeMACD(chartData);
      const histData = macdResult.histogram.map((d) => ({ time: d.time, value: d.value, color: d.value >= 0 ? "rgba(59,130,246,0.7)" : "rgba(34,197,94,0.7)" }));
      chart.addSeries(LWC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price" as const, precision: 6, minMove: 0.000001 } }).setData(histData);
      chart.addSeries(LWC.LineSeries, { color: "#3b82f6", lineWidth: 1.5 as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 3 }).setData(macdResult.macdLine);
      chart.addSeries(LWC.LineSeries, { color: "#f97316", lineWidth: 1.5 as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 3 }).setData(macdResult.signalLine);
      if (macdResult.macdLine.length > 0) {
        chart.addSeries(LWC.LineSeries, { color: isDark ? "rgba(148,163,184,0.2)" : "rgba(0,0,0,0.1)", lineWidth: 1 as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(macdResult.macdLine.map((d) => ({ time: d.time, value: 0 })));
      }
      chart.timeScale().fitContent();
      macdChartApiRef.current = chart;
      if (chartApiRef.current) {
        chartApiRef.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (range && macdChartApiRef.current) macdChartApiRef.current.timeScale().setVisibleLogicalRange(range);
        });
      }
      resizeHandler = () => { if (macdChartRef.current && macdChartApiRef.current) macdChartApiRef.current.applyOptions({ width: macdChartRef.current.clientWidth }); };
      window.addEventListener("resize", resizeHandler);
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (localChart) { try { localChart.remove(); } catch {} localChart = null; }
      macdChartApiRef.current = null;
    };
  }, [showMACD, chartData, isDark]);

  const toggleFav = (sym: string) => {
    setFavorites((f) => (f.includes(sym) ? f.filter((x) => x !== sym) : [...f, sym]));
  };

  const filteredTokens = TOKENS.filter(
    (t) =>
      t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
      t.name.toLowerCase().includes(tokenSearch.toLowerCase())
  );

  const formatPrice = (p: number) => (p >= 1 ? `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${p < 0.001 ? p.toFixed(8) : p.toFixed(6)}`);
  const formatMcap = (v: number) => { if (v >= 1e12) return `$${(v/1e12).toFixed(1)}T`; if (v >= 1e9) return `$${(v/1e9).toFixed(1)}B`; if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`; return `$${v.toLocaleString()}`; };

  const tfLabel: Record<Timeframe, string> = { "1m": "1 Min", "5m": "5 Min", "30m": "30 Min", "All": "All Time", "1H": "1 Hour", "4H": "4 Hours", "1D": "1 Day", "1W": "1 Week", "1M": "1 Month", "1Y": "1 Year" };

  const cardClass = isDark
    ? "bg-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  const inputClass = isDark
    ? "bg-slate-800/50 border border-pink-500/10"
    : "bg-gray-50 border border-gray-200";

  // ── VIP Gate ──
  if (!isVip) {
    return <VIPAccessGate featureName="CEX Trading Terminal" />;
  }

  // ── Main CEX Trading Terminal ──
  return (
    <div className="min-h-[calc(100vh-140px)] space-y-0">
      {/* Top Bar — Pair Header */}
      <div className={`rounded-t-xl p-3 ${cardClass} border-b-0 relative z-30`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
          {/* Left: Token selector + price */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setShowTokenSelector(!showTokenSelector)}
                aria-haspopup="listbox"
                aria-expanded={showTokenSelector}
                aria-label={`Select trading pair, current: ${selectedToken.symbol}/USDC`}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50"}`}
              >
                <img src={currentLogo} alt={selectedToken.symbol} className="w-7 h-7 rounded-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <span className="text-lg font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                  {selectedToken.symbol}/USDC
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showTokenSelector ? "rotate-180" : ""} ${isDark ? "text-slate-400" : "text-gray-500"}`} />
              </button>

              {showTokenSelector && (
                <div className={`absolute top-full left-0 mt-1 w-72 max-h-96 rounded-xl shadow-2xl overflow-hidden z-50 ${isDark ? "bg-slate-900 border border-pink-500/30" : "bg-white border border-gray-200"}`}>
                  <div className={`p-2 border-b ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${inputClass}`}>
                      <Search className="w-3.5 h-3.5 opacity-50" />
                      <input type="text" placeholder="Search..." className="bg-transparent outline-none flex-1 text-xs" value={tokenSearch} onChange={(e) => setTokenSearch(e.target.value)} autoFocus />
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {filteredTokens.map((token) => {
                      const tp = prices[token.symbol]?.current_price || token.fallbackPrice;
                      const tc = prices[token.symbol]?.price_change_percentage_24h || token.fallbackChange;
                      const tcSource = prices[token.symbol]?.change_source || "fallback";
                      return (
                        <button key={token.symbol} onClick={() => { setSelectedToken(token); setShowTokenSelector(false); setTokenSearch(""); }}
                          className={`w-full flex items-center justify-between px-3 py-2 transition-colors text-xs ${selectedToken.symbol === token.symbol ? (isDark ? "bg-pink-900/20" : "bg-pink-50") : (isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50")}`}>
                          <div className="flex items-center gap-2">
                            <img src={prices[token.symbol]?.image || token.logo} alt={token.symbol} className="w-5 h-5 rounded-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            <div className="text-left">
                              <span className="font-bold">{token.symbol}</span>
                              <span className={`ml-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{token.name}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold">{formatPrice(tp)}</div>
                            {tcSource === "fallback" ? (
                              <div className={`${isDark ? "text-slate-600" : "text-gray-400"} animate-pulse`}>—</div>
                            ) : (
                              <div className={tc >= 0 ? "text-emerald-500" : "text-red-500"}>{tc >= 0 ? "+" : ""}{tc.toFixed(2)}%</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Price + change */}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{formatPrice(currentPrice)}</span>
                {currentOracleSource === "chainlink" ? (
                  <Tip content={feedInfo ? `Chainlink ${feedInfo.pair} Feed` : "Chainlink Oracle"}>
                  <a
                    href={currentChainlinkFeed ? `https://etherscan.io/address/${currentChainlinkFeed}` : "https://data.chain.link/feeds"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                      isDark ? "bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25" : "bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200"
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Zap className="w-2.5 h-2.5" />
                    CHAINLINK
                  </a>
                  </Tip>
                ) : currentOracleSource === "network" ? (
                  <Tip content="Hedera Network Exchange Rate (0x168 / file 0.0.112)">
                  <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    isDark ? "bg-purple-500/15 text-purple-400 border border-purple-500/30" : "bg-purple-100 text-purple-700 border border-purple-200"
                  }`}>
                    <Zap className="w-2.5 h-2.5" />
                    NETWORK
                  </span>
                  </Tip>
                ) : (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${isDark ? "bg-slate-700/50 text-slate-500" : "bg-gray-100 text-gray-400"}`}>
                    {currentOracleSource === "binance" ? "BINANCE" : currentOracleSource === "coincap" ? "COINCAP" : currentOracleSource === "coingecko" ? "COINGECKO" : "CACHED"}
                  </span>
                )}
                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${isDark ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                  <Crown className="w-2.5 h-2.5" /> VIP
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {currentChangeSource === "fallback" ? (
                  <Tip content="Waiting for live 24h data from Binance/CoinGecko...">
                  <div className={`flex items-center gap-1 text-xs ${isDark ? "text-slate-500" : "text-gray-400"} animate-pulse`}>
                    <span>~</span> — <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>24h</span>
                  </div>
                  </Tip>
                ) : (
                  <div className={`flex items-center gap-1 text-xs ${currentChange >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {currentChange >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {currentChange >= 0 ? "+" : ""}{currentChange.toFixed(2)}% <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>24h</span>
                  </div>
                )}
                {currentOracleSource === "chainlink" && currentOracleUpdatedAt && (
                  <span className={`text-[10px] ${isDark ? "text-blue-400/60" : "text-blue-600/60"}`}>
                    Oracle: {formatOracleAge(currentOracleUpdatedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Key stats */}
          <div className="flex gap-4 lg:gap-6 overflow-x-auto text-xs">
            <div>
              <div className={isDark ? "text-slate-500" : "text-gray-400"}>24h High</div>
              <div className="font-bold text-emerald-400">{oracleHigh24h ? formatPrice(oracleHigh24h) : formatPrice(high24)}</div>
            </div>
            <div>
              <div className={isDark ? "text-slate-500" : "text-gray-400"}>24h Low</div>
              <div className="font-bold text-red-400">{oracleLow24h ? formatPrice(oracleLow24h) : formatPrice(low24)}</div>
            </div>
            <div>
              <div className={isDark ? "text-slate-500" : "text-gray-400"}>24h Volume</div>
              <div className="font-bold">{currentVolume ? formatVolume(currentVolume) : "---"}</div>
            </div>
            {currentMarketCap ? (
              <div className="hidden sm:block">
                <div className={isDark ? "text-slate-500" : "text-gray-400"}>Market Cap</div>
                <div className="font-bold">{formatMcap(currentMarketCap)}</div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Main 3-Column Layout */}
      <div className="flex flex-col lg:flex-row gap-0">
        {/* Left Column — Watchlist */}
        <div className={`lg:w-56 xl:w-64 flex-shrink-0 rounded-bl-xl overflow-hidden ${cardClass} border-t-0 lg:border-r-0`}>
          {/* Watchlist header */}
          <div className={`px-3 py-2 border-b flex items-center justify-between ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
            <span className="text-xs font-bold">Markets</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWatchlistFilter("all")}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  watchlistFilter === "all"
                    ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                    : isDark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-700"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setWatchlistFilter("favorites")}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  watchlistFilter === "favorites"
                    ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                    : isDark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-700"
                }`}
              >
                <Star className="w-3 h-3 inline -mt-0.5" />
              </button>
            </div>
          </div>

          {/* Column headers */}
          <div className={`grid grid-cols-[1fr_auto_auto] gap-1 px-3 py-1.5 text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            <span>Pair</span>
            <span className="text-right w-16">Price</span>
            <span className="text-right w-12">24h</span>
          </div>

          {/* Token rows */}
          <div className="max-h-[500px] overflow-y-auto">
            {sortedWatchlist.map((token) => {
              const isSelected = selectedToken.symbol === token.symbol;
              const matchedDef = TOKENS.find(t => t.symbol === token.symbol);
              return (
                <button
                  key={token.symbol}
                  onClick={() => {
                    if (matchedDef) setSelectedToken(matchedDef);
                  }}
                  className={`w-full grid grid-cols-[1fr_auto_auto] gap-1 items-center px-3 py-2 text-xs transition-colors ${
                    isSelected
                      ? isDark ? "bg-pink-900/20 border-l-2 border-l-pink-500" : "bg-pink-50 border-l-2 border-l-pink-500"
                      : isDark ? "hover:bg-slate-800/30 border-l-2 border-l-transparent" : "hover:bg-gray-50 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); toggleFav(token.symbol); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleFav(token.symbol); } }}
                      className="p-0 flex-shrink-0 cursor-pointer"
                    >
                      <Star className={`w-3 h-3 ${favorites.includes(token.symbol) ? "text-yellow-400 fill-yellow-400" : isDark ? "text-slate-700" : "text-gray-300"}`} />
                    </span>
                    <img src={token.logo} alt="" className="w-4 h-4 rounded-full flex-shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    <span className="font-bold truncate">{token.symbol}</span>
                  </div>
                  <span className="text-right w-16 font-mono tabular-nums">
                    {token.price >= 1 ? `$${token.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `$${token.price < 0.001 ? token.price.toFixed(6) : token.price.toFixed(4)}`}
                  </span>
                  {token.changeSource === "fallback" ? (
                    <Tip content="Waiting for live 24h data...">
                    <span className={`text-right w-12 tabular-nums ${isDark ? "text-slate-600" : "text-gray-400"} animate-pulse`}>
                      —
                    </span>
                    </Tip>
                  ) : (
                    <span className={`text-right w-12 tabular-nums ${token.change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {token.change >= 0 ? "+" : ""}{token.change.toFixed(1)}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center Column — Chart */}
        <div className={`flex-1 min-w-0 ${cardClass} border-t-0 lg:rounded-none`}>
          {/* Chart toolbar */}
          <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 py-2 border-b gap-2 ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              {/* Timeframe dropdown */}
              <div className="relative" ref={tfDropdownRef}>
                <button
                  onClick={() => setShowTfDropdown(!showTfDropdown)}
                  aria-haspopup="listbox"
                  aria-expanded={showTfDropdown}
                  aria-label={`Chart timeframe: ${timeframe}`}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                    isDark
                      ? "bg-slate-800/60 border border-slate-700/50 text-white hover:border-pink-500/30"
                      : "bg-gray-50 border border-gray-200 text-gray-900 hover:border-pink-300"
                  }`}
                >
                  <span className="bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                    {timeframe}
                  </span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showTfDropdown ? "rotate-180" : ""} ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                </button>
                {showTfDropdown && (
                  <div role="listbox" aria-label="Select chart timeframe" className={`absolute top-full left-0 mt-1 w-[140px] rounded-lg shadow-xl z-[100] ${
                    isDark ? "bg-slate-900 border border-pink-500/20" : "bg-white border border-gray-200"
                  }`}>
                    {TIMEFRAMES.map((tf) => (
                      <button
                        key={tf}
                        role="option"
                        aria-selected={timeframe === tf}
                        onClick={() => { setTimeframe(tf); setShowTfDropdown(false); }}
                        className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${
                          timeframe === tf
                            ? "bg-gradient-to-r from-pink-600/20 to-purple-600/20 text-white"
                            : isDark
                              ? "text-slate-400 hover:bg-slate-800/50 hover:text-white"
                              : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                        }`}
                      >
                        <span>{tf}</span>
                        <span className={`text-[10px] ${timeframe === tf ? "text-pink-400" : isDark ? "text-slate-600" : "text-gray-300"}`}>
                          {tfLabel[tf]}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className={`ml-1 flex rounded overflow-hidden border ${isDark ? "border-slate-700/50" : "border-gray-200"}`} role="group" aria-label="Chart type">
                <button onClick={() => setChartMode("candle")} aria-label="Candlestick chart" aria-pressed={chartMode === "candle"} className={`px-2 py-1 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${chartMode === "candle" ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white" : isDark ? "text-slate-500" : "text-gray-400"}`}>
                  <BarChart2 className="w-3 h-3" />
                </button>
                <button onClick={() => setChartMode("line")} aria-label="Line chart" aria-pressed={chartMode === "line"} className={`px-2 py-1 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${chartMode === "line" ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white" : isDark ? "text-slate-500" : "text-gray-400"}`}>
                  <LineChart className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto">
              <Activity className={`w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
              {[
                { label: "SMA20", active: showSMA20, toggle: () => setShowSMA20((v) => !v), color: "text-amber-400" },
                { label: "SMA50", active: showSMA50, toggle: () => setShowSMA50((v) => !v), color: "text-violet-400" },
                { label: "EMA12", active: showEMA12, toggle: () => setShowEMA12((v) => !v), color: "text-cyan-400" },
                { label: "RSI", active: showRSI, toggle: () => setShowRSI((v) => !v), color: "text-purple-400" },
                { label: "MACD", active: showMACD, toggle: () => setShowMACD((v) => !v), color: "text-blue-400" },
                { label: "BB", active: showBB, toggle: () => setShowBB((v) => !v), color: "text-violet-400" },
              ].map((ind) => (
                <button key={ind.label} onClick={ind.toggle}
                  className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${ind.active ? `${ind.color} ${isDark ? "bg-slate-700/60" : "bg-gray-200"}` : isDark ? "text-slate-600 hover:text-slate-400" : "text-gray-400 hover:text-gray-600"}`}>
                  {ind.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chart area */}
          <div className="px-2 pt-1">
            <ChartDrawingTools chartApi={chartApiRef.current} seriesApi={candleSeriesRef.current} chartContainerRef={mainChartRef} isDark={isDark} chartHeight={(showRSI || showMACD) ? 300 : 380} symbol={selectedToken.symbol}>
              <div ref={mainChartRef} className="w-full" />
            </ChartDrawingTools>

            {showRSI && (
              <div className={`mt-0.5 pt-0.5 border-t ${isDark ? "border-slate-700/30" : "border-gray-100"}`}>
                <div className={`text-[10px] mb-0.5 ${isDark ? "text-purple-400" : "text-purple-600"}`}>RSI (14)</div>
                <div ref={rsiChartRef} className="w-full" />
              </div>
            )}

            {showMACD && (
              <div className={`mt-0.5 pt-0.5 border-t ${isDark ? "border-slate-700/30" : "border-gray-100"}`}>
                <div className="flex items-center gap-3 mb-0.5">
                  <span className={`text-[10px] ${isDark ? "text-blue-400" : "text-blue-600"}`}>MACD (12, 26, 9)</span>
                  <div className="flex items-center gap-2 text-[9px]">
                    <span className="flex items-center gap-1"><span className="w-2 h-0.5 rounded bg-blue-500 inline-block" /> MACD</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-0.5 rounded bg-orange-500 inline-block" /> Signal</span>
                  </div>
                </div>
                <div ref={macdChartRef} className="w-full" />
              </div>
            )}
          </div>

          {/* Chart status bar */}
          <div className={`px-3 py-2 border-t ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Chart data source badge */}
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] ${
                chartLoading
                  ? isDark ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-600 border border-amber-200"
                  : chartDataSource === "binance"
                  ? isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                  : chartDataSource === "coingecko" || chartDataSource === "coincap"
                  ? isDark ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-600 border border-blue-200"
                  : isDark ? "bg-slate-700/50 text-slate-500 border border-slate-600/30" : "bg-gray-100 text-gray-400 border border-gray-200"
              }`}>
                {chartLoading ? (
                  <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading...</>
                ) : (
                  <>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      chartDataSource === "binance" ? "bg-emerald-500"
                      : chartDataSource === "coingecko" || chartDataSource === "coincap" ? "bg-blue-500"
                      : "bg-slate-500"
                    }`} />
                    {chartDataSource === "binance" ? "LIVE" : chartDataSource === "synthetic" ? "SIMULATED" : chartDataSource.toUpperCase()}
                    {realChartData && <span className="opacity-60">({chartData.length})</span>}
                  </>
                )}
              </div>

              {/* Refresh chart button */}
              <Tip content="Refresh chart data">
              <button
                onClick={() => {
                  invalidateChartCache(selectedToken.symbol);
                  setRealChartData(null);
                  setChartLoading(true);
                  setChartDataSource("synthetic");
                  const apiPeriod = timeframe === "All" ? "ALL" : timeframe;
                  fetchRealCandlesWithSource(selectedToken.symbol, apiPeriod, prices[selectedToken.symbol]?.current_price)
                    .then(result => {
                      if (result.candles.length >= 5) {
                        setRealChartData(result.candles);
                        setChartDataSource(result.source);
                      }
                      setChartLoading(false);
                    })
                    .catch(() => { setChartLoading(false); });
                }}
                disabled={chartLoading}
                className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800/50 text-slate-500 hover:text-slate-300" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"} ${chartLoading ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <RefreshCw className={`w-3 h-3 ${chartLoading ? "animate-spin" : ""}`} />
              </button>
              </Tip>

              <div className={`flex items-center gap-1 text-[10px] ml-auto ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                <Info className="w-3 h-3" />
                USDC-routed oracle pricing
              </div>
            </div>
          </div>
        </div>

        {/* Right Column — AMM Swap Panel */}
        <div className="lg:w-72 xl:w-80 flex-shrink-0 lg:rounded-br-xl overflow-hidden">
          <TradingSwapPanel isDark={isDark} onTokenChange={handleAmmTokenChange} />
        </div>
      </div>

      {/* Liquidity Pools Section */}
      <TradingPoolsSection isDark={isDark} />

      {/* LP Position Tracker — visible to all connected users */}
      {hederaAccount && (
        <div className="mt-4">
          <LPPositionTracker isDark={isDark} />
        </div>
      )}

      {/* Atomic Swap History — visible to all connected users */}
      {hederaAccount && (
        <div className="mt-4">
          <AtomicSwapHistory isDark={isDark} accountId={hederaAccount.accountId} />
        </div>
      )}

      {/* VIP Chat — only for authenticated VIP holders */}
      {isVip && hederaAccount && (
        <div className="mt-4">
          <VipChatBox isDark={isDark} accountId={hederaAccount.accountId} />
        </div>
      )}

      {/* Click-outside overlay for token selector */}
      {showTokenSelector && <div className="fixed inset-0 z-20" onClick={() => setShowTokenSelector(false)} />}
    </div>
  );
}
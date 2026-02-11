import { useState, useEffect, useMemo } from "react";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowRightLeft, ExternalLink, ChevronDown } from "lucide-react";
import { Link } from "react-router";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import { FearGreedGauge } from "./FearGreedGauge";
import { RSIGauge } from "./RSIGauge";
import { fetchCoinPrices, fetchGlobalMarketData, formatMarketCap, formatVolume, fetchHbarFastPath, type CoinPrice } from "../utils/coingecko";
import type { GlobalMarketData, OracleSource } from "../utils/coingecko";
import { CandlestickChart } from "./CandlestickChart";
import { MarketDetailChart } from "./MarketDetailChart";
import { fetchRealCandles, generateCandlestickData } from "../utils/chartData";
import { fetchHbarhPrice, formatUsdCompact, type HbarhTokenData } from "../utils/saucerswap";
import { TOKEN_REGISTRY, ALL_SYMBOLS } from "../utils/tokens";
import { getOracleStats, formatOracleAge, type OracleStats } from "../utils/chainlink";
import type { CandlestickData } from "lightweight-charts";
import { isVipEligible, loadVipPrefs } from "../utils/vip";
import { playVipButtonChime } from "../utils/sounds";
import { SiteActivity } from "./SiteActivity";
import { HBARH_LOGO_DARK, HBARH_LOGO_LIGHT } from "../assets/brand";

// ── Types & Helpers ────────────────────────────────────────────────

interface MarketAsset {
  symbol: string;
  name: string;
  price: number;
  change: number;
  volume: string;
  marketCap: string;
  logo: string;
  category: "layer1" | "stablecoin" | "defi";
  chartData: CandlestickData[];
  oracleSource?: OracleSource;
  oracleUpdatedAt?: number;
  chainlinkFeed?: string;
  /** Where the 24h % change actually came from — "fallback" means it's mock/stale data */
  changeSource?: OracleSource;
}

/** Symbols that get real candlestick chart backgrounds */
const CHART_SYMBOLS = TOKEN_REGISTRY
  .filter(t => t.category !== "stablecoin")
  .map(t => t.symbol);

/** Map CoinGecko price data + TOKEN_REGISTRY into the dashboard grid rows */
function buildMarketAssets(prices: Record<string, CoinPrice>): MarketAsset[] {
  return TOKEN_REGISTRY.map(token => {
    const p = prices[token.symbol];
    return {
      symbol: token.symbol,
      name: token.name,
      price: p?.current_price ?? token.fallbackPrice,
      change: p?.price_change_percentage_24h ?? token.fallbackChange,
      volume: p ? formatVolume(p.total_volume) : "—",
      marketCap: p ? formatMarketCap(p.market_cap) : "—",
      logo: p?.image || token.logo,
      category: token.category,
      chartData: generateCandlestickData(
        token.symbol,
        p?.current_price ?? token.fallbackPrice,
        token.volatility
      ),
      oracleSource: p?.oracle_source,
      oracleUpdatedAt: p?.oracle_updated_at,
      chainlinkFeed: p?.chainlink_feed,
      changeSource: p?.change_source,
    };
  });
}

/** Oracle-source badge metadata */
const ORACLE_BADGE: Record<OracleSource, { label: string; dotColor: string }> = {
  chainlink:  { label: "Chainlink",  dotColor: "bg-blue-500" },
  coincap:    { label: "CoinCap",    dotColor: "bg-amber-500" },
  coingecko:  { label: "CoinGecko",  dotColor: "bg-green-500" },
  fallback:   { label: "Cached",     dotColor: "bg-slate-500" },
};

/** Tiny colored dot indicating oracle source next to symbol */
function OracleDot({ source, isDark }: { source?: OracleSource; isDark: boolean }) {
  if (!source) return null;
  const colors: Record<OracleSource, string> = {
    chainlink: "bg-blue-500",
    coincap:   "bg-amber-500",
    coingecko: "bg-green-500",
    fallback:  "bg-slate-500",
  };
  const labels: Record<OracleSource, string> = {
    chainlink: "Chainlink Oracle",
    coincap:   "CoinCap API",
    coingecko: "CoinGecko API",
    fallback:  "Cached price",
  };
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${colors[source]}`}
      title={labels[source]}
    />
  );
}

export function Dashboard() {
  const { isDark } = useTheme();
  const [marketFilter, setMarketFilter] = useState<"all" | "defi" | "layer1" | "stablecoin">("all");
  const [marketData, setMarketData] = useState<MarketAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [oracleStats, setOracleStats] = useState<OracleStats | null>(null);

  // VIP eligibility for iridescent buttons
  const { hederaAccount, hederaNetwork } = useWallet();
  const vipActive = useMemo(() => {
    if (!hederaAccount?.tokens) return false;
    const eligible = isVipEligible(hederaAccount.tokens, hederaNetwork);
    const prefs = loadVipPrefs();
    return eligible && prefs.active;
  }, [hederaAccount?.tokens, hederaNetwork]);

  // HBAR.ħ protocol token — live price from DexScreener/SaucerSwap API
  const [hbarhData, setHbarhData] = useState<HbarhTokenData | null>(null);

  useEffect(() => {
    const loadHbarh = async () => {
      const data = await fetchHbarhPrice();
      setHbarhData(data);
    };
    loadHbarh();
    const iv = setInterval(loadHbarh, 60000);
    return () => clearInterval(iv);
  }, []);

  // Global crypto market data — total market cap & volume
  const [globalData, setGlobalData] = useState<GlobalMarketData | null>(null);

  useEffect(() => {
    const loadGlobal = async () => {
      const data = await fetchGlobalMarketData();
      setGlobalData(data);
    };
    loadGlobal();
    const iv = setInterval(loadGlobal, 120000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const loadPrices = async () => {
      // Fire HBAR fast-path and full oracle pipeline in parallel.
      // The fast-path uses CoinCap's single-asset endpoint (3s timeout)
      // and resolves before the bulk batch requests, ensuring HBAR
      // always has a live price even if the main oracle is slow.
      const [prices, hbarFast] = await Promise.all([
        fetchCoinPrices(ALL_SYMBOLS),
        fetchHbarFastPath().catch(() => null),
      ]);

      // Patch HBAR price if main oracle returned fallback or zero
      if (hbarFast && hbarFast.current_price > 0) {
        const existing = prices["HBAR"];
        if (!existing || existing.oracle_source === "fallback" || existing.current_price <= 0) {
          prices["HBAR"] = hbarFast;
        }
      }

      const assets = buildMarketAssets(prices);

      // Update oracle stats after fetch
      setOracleStats(getOracleStats());

      // Fetch real chart data in background for non-stablecoin tokens
      Promise.all(
        CHART_SYMBOLS.map(sym =>
          fetchRealCandles(sym, "1D", prices[sym]?.current_price).then(candles => ({ sym, candles }))
        )
      ).then(results => {
        setMarketData(prev => prev.map(asset => {
          const real = results.find(r => r.sym === asset.symbol);
          return real && real.candles.length >= 5 ? { ...asset, chartData: real.candles } : asset;
        }));
      }).catch(() => {});

      setMarketData(assets);
      setLoading(false);
    };

    loadPrices();
    const interval = setInterval(loadPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  const filteredMarkets = useMemo(() => {
    // Build HBAR.ħ market asset from live DexScreener/SaucerSwap data
    const hbarhAsset: MarketAsset | null = hbarhData ? {
      symbol: "HBAR.ħ",
      name: "HBAR.ħ Protocol",
      price: hbarhData.priceUsd,
      change: hbarhData.change24h,
      volume: formatUsdCompact(hbarhData.volume24h),
      marketCap: "—",
      logo: isDark ? HBARH_LOGO_DARK : HBARH_LOGO_LIGHT,
      category: "defi",
      chartData: generateCandlestickData("HBAR.ħ", hbarhData.priceUsd, 0.18),
      oracleSource: undefined, // Handled with custom DexScreener badge
    } : null;

    // Insert HBAR.ħ right after HBAR in the list
    const withHbarh: MarketAsset[] = [];
    for (const item of marketData) {
      withHbarh.push(item);
      if (item.symbol === "HBAR" && hbarhAsset) {
        withHbarh.push(hbarhAsset);
      }
    }

    return withHbarh.filter((item) => {
      if (marketFilter === "all") return true;
      if (marketFilter === "stablecoin") return item.category === "stablecoin";
      if (marketFilter === "layer1") return item.category === "layer1" || item.category === "defi";
      return true;
    });
  }, [marketData, hbarhData, marketFilter]);

  const isExpanded = (sym: string) => expandedSymbol === sym;

  const toggleExpand = (sym: string) => {
    setExpandedSymbol((prev) => (prev === sym ? null : sym));
  };

  // Stablecoin mode: swap pink/purple → green theme
  const isStable = marketFilter === "stablecoin";

  return (
    <div className="space-y-6">
      {/* Stats Row — compact */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {/* ── Total Market Cap ── */}
        <div className={`rounded-xl p-3 pb-2 border ${
          isDark
            ? "bg-gradient-to-br from-slate-900/80 to-slate-800/40 border-slate-700/40 backdrop-blur-sm"
            : "bg-white border-gray-200 shadow-sm"
        }`}>
          <div className={`text-[10px] font-bold tracking-wide uppercase mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            Total Market Cap
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="text-2xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
              {globalData ? `$${formatMarketCap(globalData.totalMarketCap)}` : "---"}
            </div>
            {globalData && (
              <div className={`text-xs mt-1.5 flex items-center justify-center gap-1 ${globalData.marketCapChange24h >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {globalData.marketCapChange24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {globalData.marketCapChange24h >= 0 ? "+" : ""}{globalData.marketCapChange24h.toFixed(2)}%
              </div>
            )}
            {globalData && (
              <div className={`text-[10px] mt-2 w-full grid grid-cols-2 gap-x-2 gap-y-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                <div className="flex items-center justify-between">
                  <span>Vol 24h</span>
                  <span className={isDark ? "text-slate-300" : "text-gray-600"}>${formatMarketCap(globalData.totalVolume24h)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>BTC</span>
                  <span className={isDark ? "text-orange-400/80" : "text-orange-500"}>{globalData.btcDominance.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>ETH</span>
                  <span className={isDark ? "text-blue-400/80" : "text-blue-500"}>{globalData.ethDominance.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Coins</span>
                  <span className={isDark ? "text-slate-300" : "text-gray-600"}>{globalData.activeCryptos.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RSI Overbought/Oversold Gauge */}
        <RSIGauge />

        {/* Fear & Greed Gauge — compact */}
        <FearGreedGauge />

        {/* ── HBAR.ħ Price ── */}
        <Link
          to="/swap"
          className={`rounded-xl p-3 pb-2 border block transition-all duration-300 hover:scale-[1.02] ${
          isDark
            ? "bg-gradient-to-br from-slate-900/80 to-slate-800/40 border-slate-700/40 backdrop-blur-sm hover:border-cyan-400/40"
            : "bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-cyan-300"
        }`}>
          <div className="flex items-center justify-between mb-1">
            <div className={`text-[10px] font-bold tracking-wide uppercase ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              HBAR.ħ Price
            </div>
            <img
              src={isDark ? HBARH_LOGO_DARK : HBARH_LOGO_LIGHT}
              alt="HBAR.ħ"
              className="w-6 h-6 rounded-full flex-shrink-0 object-cover"
            />
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="text-2xl font-bold">
              {hbarhData ? `$${hbarhData.priceUsd < 0.01 ? hbarhData.priceUsd.toFixed(7) : hbarhData.priceUsd.toFixed(6)}` : "---"}
            </div>
            <div className="flex items-center justify-center gap-2 mt-1.5">
              {hbarhData && (
                <span className={`text-xs flex items-center gap-0.5 ${hbarhData.change24h >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  {hbarhData.change24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {hbarhData.change24h >= 0 ? "+" : ""}{hbarhData.change24h.toFixed(2)}%
                </span>
              )}
            </div>
            {/* Sparkline chart — centered & wider */}
            {hbarhData && hbarhData.priceHistory.length > 1 && (() => {
              const pts = hbarhData.priceHistory;
              const min = Math.min(...pts);
              const max = Math.max(...pts);
              const range = max - min || 1;
              const w = 140, h = 32;
              const polyline = pts.map((v, i) =>
                `${(i / (pts.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`
              ).join(" ");
              const isUp = pts[pts.length - 1] >= pts[0];
              const gradId = "hbarh-spark-grad";
              // Build area fill path
              const areaPath = `M 0,${h} ` + pts.map((v, i) =>
                `L ${(i / (pts.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`
              ).join(" ") + ` L ${w},${h} Z`;
              return (
                <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-1.5">
                  <defs>
                    <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={isUp ? "#22c55e" : "#ef4444"} stopOpacity="0.3" />
                      <stop offset="100%" stopColor={isUp ? "#22c55e" : "#ef4444"} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={areaPath} fill={`url(#${gradId})`} />
                  <polyline
                    points={polyline}
                    fill="none"
                    stroke={isUp ? "#22c55e" : "#ef4444"}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              );
            })()}
            <div className={`text-[10px] mt-1.5 w-full grid grid-cols-2 gap-x-2 gap-y-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              <div className="flex items-center justify-between">
                <span>Vol</span>
                <span className={isDark ? "text-slate-300" : "text-gray-600"}>{hbarhData ? formatUsdCompact(hbarhData.volume24h) : "---"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Liq</span>
                <span className={isDark ? "text-slate-300" : "text-gray-600"}>{hbarhData ? formatUsdCompact(hbarhData.liquidity) : "---"}</span>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* Site Activity — upgraded full-width activity feed */}
      <SiteActivity />

      {/* Market Overview */}
      <div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
          <h2 className={`text-xl md:text-2xl font-bold bg-gradient-to-r ${isStable ? "from-emerald-400 to-teal-400" : "from-pink-400 to-purple-400"} bg-clip-text text-transparent transition-all duration-300`}>
            Top Markets {loading && <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>(Loading...)</span>}
          </h2>
          <div className="flex gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {(["all", "layer1", "stablecoin"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setMarketFilter(f)}
                className={`px-3 py-1 rounded-lg text-sm transition-all duration-300 whitespace-nowrap ${
                  marketFilter === f
                    ? f === "stablecoin"
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
                      : "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                    : isDark
                    ? "bg-slate-800/50 text-slate-400 hover:text-white"
                    : "bg-gray-100 text-gray-500 hover:text-gray-900"
                }`}
              >
                {f === "all" ? "All" : f === "layer1" ? "Layer 1" : "Stablecoins"}
              </button>
            ))}
            <Link
              to="/defi"
              className={`px-3 py-1 rounded-lg text-sm flex items-center gap-1 transition-all duration-300 whitespace-nowrap ${
                isDark
                  ? "bg-slate-800/50 text-slate-400 hover:text-white"
                  : "bg-gray-100 text-gray-500 hover:text-gray-900"
              }`}
            >
              DeFi
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {filteredMarkets.map((item) => {
            const expanded = isExpanded(item.symbol);
            const badge = item.oracleSource ? ORACLE_BADGE[item.oracleSource] : null;

            return (
              <div
                key={item.symbol}
                className={`rounded-xl transition-all duration-300 overflow-hidden ${
                  isDark
                    ? `border ${expanded
                        ? isStable ? "border-emerald-500/40 bg-slate-900/50" : "border-pink-500/40 bg-slate-900/50"
                        : isStable ? "border-slate-800/50 bg-slate-900/30 hover:border-emerald-500/30" : "border-slate-800/50 bg-slate-900/30 hover:border-pink-500/30"
                      } backdrop-blur-sm`
                    : `border ${expanded
                        ? isStable ? "border-emerald-300 bg-white shadow-md" : "border-pink-300 bg-white shadow-md"
                        : isStable ? "border-gray-200 bg-white hover:border-emerald-200 shadow-sm hover:shadow-md" : "border-gray-200 bg-white hover:border-pink-200 shadow-sm hover:shadow-md"
                      }`
                }`}
              >
                {/* Row header */}
                <div
                  className="flex items-center justify-between p-3 md:p-4 cursor-pointer"
                  onClick={() => toggleExpand(item.symbol)}
                >
                  <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                    <img
                      src={item.logo}
                      alt={item.name}
                      className="w-8 h-8 md:w-10 md:h-10 rounded-full flex-shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                    <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-pink-500 via-purple-500 to-blue-500 rounded-full items-center justify-center font-bold hidden text-white flex-shrink-0">
                      {item.symbol[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm md:text-base">{item.symbol}</span>
                        <OracleDot source={item.oracleSource} isDark={isDark} />
                        {item.symbol === "HBAR.ħ" && (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-500"
                            title="DexScreener API"
                          />
                        )}
                      </div>
                      <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"} hidden sm:flex items-center gap-1`}>
                        {item.name}
                        {item.oracleSource === "chainlink" && (
                          <span className={`text-[9px] px-1 py-0 rounded border ${isDark ? "text-blue-400 border-blue-500/30" : "text-blue-600 border-blue-200"}`}>
                            CHAINLINK
                          </span>
                        )}
                        {item.symbol === "HBAR.ħ" && (
                          <span className={`text-[9px] px-1 py-0 rounded border ${isDark ? "text-cyan-400 border-cyan-500/30" : "text-cyan-600 border-cyan-200"}`}>
                            DEXSCREENER
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 md:gap-6">
                    <div className="text-right">
                      <div className="font-bold text-sm md:text-base">
                        ${item.price >= 1 ? item.price.toLocaleString() : item.price < 0.001 ? item.price.toFixed(8) : item.price.toFixed(4)}
                      </div>
                      {/* Mobile-only change below price */}
                      {item.changeSource === "fallback" ? (
                        <div
                          className={`flex items-center justify-end gap-0.5 text-xs md:hidden ${
                            isDark ? "text-slate-500" : "text-gray-400"
                          } animate-pulse`}
                          title="Waiting for live 24h data..."
                        >
                          —
                        </div>
                      ) : (
                        <div
                          className={`flex items-center justify-end gap-0.5 text-xs md:hidden ${
                            item.change >= 0 ? "text-emerald-500" : "text-red-500"
                          }`}
                        >
                          {item.change >= 0 ? "+" : ""}{Math.abs(item.change).toFixed(2)}%
                        </div>
                      )}
                    </div>

                    <div className="hidden md:block w-20 text-right">
                      {item.changeSource === "fallback" ? (
                        <div
                          className={`flex items-center justify-end gap-1 font-bold text-sm ${
                            isDark ? "text-slate-500" : "text-gray-400"
                          } animate-pulse`}
                          title="Waiting for live 24h data from CoinCap/CoinGecko..."
                        >
                          <span className="text-xs">~</span> —
                        </div>
                      ) : (
                        <div
                          className={`flex items-center justify-end gap-1 font-bold text-sm ${
                            item.change >= 0 ? "text-emerald-500" : "text-red-500"
                          }`}
                        >
                          {item.change >= 0 ? (
                            <TrendingUp className="w-3.5 h-3.5" />
                          ) : (
                            <TrendingDown className="w-3.5 h-3.5" />
                          )}
                          {Math.abs(item.change).toFixed(2)}%
                        </div>
                      )}
                    </div>

                    <div className={`hidden lg:block w-20 text-right text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {item.volume}
                    </div>

                    <div className={`hidden lg:block w-24 text-right text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      ${item.marketCap}
                    </div>

                    <div className="hidden md:block w-32 h-10">
                      <CandlestickChart data={item.chartData} symbol={item.symbol} />
                    </div>

                    {/* Trade / Bridge — VIP iridescent glow */}
                    <div className="hidden sm:flex gap-1.5">
                      {item.symbol === "HBAR.ħ" ? (
                        <>
                          <Link
                            to="/swap"
                            onClick={(e) => { e.stopPropagation(); if (vipActive) playVipButtonChime(); }}
                            onMouseEnter={() => { if (vipActive) playVipButtonChime(); }}
                            className="vip-btn-trade px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 shadow-sm shadow-cyan-500/20 rounded-lg flex items-center gap-1.5 transition-all duration-300 text-white text-sm"
                          >
                            Swap
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                          </Link>
                          <a
                            href="https://www.saucerswap.finance/trade/hbar/0.0.9356476"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => { e.stopPropagation(); if (vipActive) playVipButtonChime(); }}
                            className={`vip-btn-bridge px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-300 text-sm ${
                              isDark
                                ? "bg-slate-800/50 hover:bg-slate-700 border border-cyan-500/20"
                                : "bg-gray-100 hover:bg-gray-200 border border-gray-200"
                            }`}
                          >
                            SaucerSwap
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </>
                      ) : (
                        <>
                          <Link
                            to={`/trading/${item.symbol}`}
                            onClick={(e) => { e.stopPropagation(); if (vipActive) playVipButtonChime(); }}
                            onMouseEnter={() => { if (vipActive) playVipButtonChime(); }}
                            className={`vip-btn-trade px-3 py-1.5 bg-gradient-to-r ${isStable ? "from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-sm shadow-emerald-500/20" : "from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-sm shadow-pink-500/20"} rounded-lg flex items-center gap-1.5 transition-all duration-300 text-white text-sm`}
                          >
                            Trade
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </Link>
                          <Link
                            to="/bridges"
                            onClick={(e) => { e.stopPropagation(); if (vipActive) playVipButtonChime(); }}
                            onMouseEnter={() => { if (vipActive) playVipButtonChime(); }}
                            className={`vip-btn-bridge px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-300 text-sm ${
                              isDark
                                ? `bg-slate-800/50 hover:bg-slate-700 border ${isStable ? "border-emerald-500/20" : "border-pink-500/20"}`
                                : "bg-gray-100 hover:bg-gray-200 border border-gray-200"
                            }`}
                          >
                            Bridge
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                          </Link>
                        </>
                      )}
                    </div>

                    {/* Expand chevron */}
                    <div className={`transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}>
                      <ChevronDown className={`w-5 h-5 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                    </div>
                  </div>
                </div>

                {/* Expanded detail — oracle info + chart */}
                {expanded && (
                  <div className={`px-4 pb-4 border-t ${isDark ? "border-slate-700/30" : "border-gray-100"}`}>
                    {/* Oracle source detail strip */}
                    {item.oracleSource && (
                      <div className={`flex items-center gap-3 py-2 mb-2 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${badge?.dotColor}`} />
                          <span>Price via <span className="font-bold">{badge?.label}</span></span>
                        </div>
                        {item.oracleSource === "chainlink" && item.oracleUpdatedAt && (
                          <span className={`${isDark ? "text-blue-400/60" : "text-blue-600/60"}`}>
                            Updated {formatOracleAge(item.oracleUpdatedAt)}
                          </span>
                        )}
                        {item.oracleSource === "chainlink" && item.chainlinkFeed && (
                          <a
                            href={`https://etherscan.io/address/${item.chainlinkFeed}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-center gap-0.5 ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500"}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Feed Contract <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    )}
                    {/* HBAR.ħ DexScreener oracle strip */}
                    {item.symbol === "HBAR.ħ" && (
                      <div className={`flex items-center gap-3 py-2 mb-2 text-xs flex-wrap ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-cyan-500" />
                          <span>Price via <span className="font-bold">DexScreener</span></span>
                        </div>
                        <span className={isDark ? "text-cyan-400/60" : "text-cyan-600/60"}>
                          Token ID: 0.0.9356476
                        </span>
                        <a
                          href="https://dexscreener.com/hedera/0x31d6b803a960b818cce3a85f0bef7c4c566b7919"
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-0.5 ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-cyan-600 hover:text-cyan-500"}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          DexScreener <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <a
                          href="https://hashscan.io/mainnet/token/0.0.9356476"
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-0.5 ${isDark ? "text-purple-400 hover:text-purple-300" : "text-purple-600 hover:text-purple-500"}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          HashScan <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    )}
                    <MarketDetailChart data={item.chartData} symbol={item.symbol} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
import { useState, useEffect, useMemo, useCallback } from "react";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowRightLeft, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import { FearGreedGauge } from "./FearGreedGauge";
import { RSIGauge } from "./RSIGauge";
import { fetchCoinPrices, fetchGlobalMarketData, formatMarketCap, formatVolume, fetchCoinCapHistory, type CoinPrice } from "../utils/coingecko";
import type { GlobalMarketData, OracleSource } from "../utils/coingecko";
import { fetchMarketRSI } from "../utils/coingecko";
import { fetchAllSparklines, type SparklineMap } from "../utils/coingecko";
import { computeApproxGlobalData } from "../utils/coingecko";
import { CandlestickChart } from "./CandlestickChart";
import { MarketDetailChart } from "./MarketDetailChart";
import { fetchRealCandles, generateCandlestickData } from "../utils/chartData";
import { fetchHbarhPrice, formatUsdCompact, type HbarhTokenData } from "../utils/saucerswap";
import { TOKEN_REGISTRY, ALL_SYMBOLS } from "../utils/tokens";
import { getOracleStats, formatOracleAge, type OracleStats } from "../utils/chainlink";
import type { CandlestickData } from "lightweight-charts";
import { isVipEligible, loadVipPrefs, type VipPrefs } from "../utils/vip";
import { playVipButtonChime } from "../utils/sounds";
import { SiteActivity } from "./SiteActivity";
import { usePartneredLogos } from "../contexts/PartneredLogosContext";
import { TOKEN_LOGOS } from "../utils/coingecko";
import { CryptoHeatmapWidget } from "./CryptoHeatmapWidget";
import { DashboardStatsSkeleton, MarketListSkeleton } from "./Skeletons";
import { Tip } from "./Tip";
import { PriceFlash } from "./PriceFlash";
import { MiniSparkline } from "./MiniSparkline";

// ── Module-level caches ────────────────────────────────────────────
// Persist across component unmount/remount cycles (tab switches,
// Vite HMR reconnects, route changes). Avoids re-fetching everything
// from scratch every time the Dashboard mounts.

interface DashboardCache {
  marketData: MarketAsset[];
  globalData: GlobalMarketData | null;
  headerRsi: number | null;
  headerFng: number | null;
  hbarhData: HbarhTokenData | null;
  btcSparkHistory: number[];
  hbarSparkHistory: number[];
  oracleStats: OracleStats | null;
  timestamp: number;
}

const _dashCache: DashboardCache = {
  marketData: [],
  globalData: null,
  headerRsi: null,
  headerFng: null,
  hbarhData: null,
  btcSparkHistory: [],
  hbarSparkHistory: [],
  oracleStats: null,
  timestamp: 0,
};

// Module-level sparkline cache — persists across Dashboard remounts
// and 30s price refresh cycles so sparklines don't flash-disappear.
let _sparklineCache: SparklineMap = {};

/** Fear & Greed with timeout — the bare fetch() had none, could hang forever */
async function fetchFearGreed(timeoutMs = 6000): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: controller.signal,
    });
    clearTimeout(timer);
    const j = await r.json();
    return j.data?.[0] ? parseInt(j.data[0].value) : null;
  } catch {
    return null;
  }
}

/** Batch chart fetches in groups to avoid rate-limiting cascades */
async function fetchChartsThrottled(
  symbols: string[],
  prices: Record<string, CoinPrice>,
  batchSize = 4,
): Promise<{ sym: string; candles: CandlestickData[] }[]> {
  const results: { sym: string; candles: CandlestickData[] }[] = [];
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(sym =>
        fetchRealCandles(sym, "1D", prices[sym]?.current_price)
          .then(candles => ({ sym, candles }))
          .catch(() => ({ sym, candles: [] as CandlestickData[] }))
      )
    );
    results.push(...batchResults);
  }
  return results;
}

// ── Types & Helpers ────────────────────────────────────────────────

interface MarketAsset {
  symbol: string;
  name: string;
  price: number;
  change: number;
  volume: string;
  marketCap: string;
  marketCapRaw: number;
  logo: string;
  category: "layer1" | "stablecoin" | "defi";
  chartData: CandlestickData[];
  /** Real 7-day sparkline from CoinGecko (~168 hourly price points) */
  sparkline7d: number[];
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

// ── Module-level broken-URL tracker ───────────────────────────────
// Prevents the flicker loop where every 30s re-render tries a broken
// URL → onError → hide → next render resets display → tries again.
// Once a URL 404s, it stays blacklisted for the entire session.
const _brokenLogos = new Set<string>();

/** Flicker-free token logo with gradient letter-avatar fallback.
 *  IMPLEMENTATION NOTE: Gradient is NOT placed behind the img because
 *  most crypto logos have transparent PNG backgrounds — gradient would
 *  bleed through and ruin the appearance of working logos. */
function TokenLogo({ src, symbol, size = "md" }: { src: string; symbol: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "w-7 h-7" : "w-8 h-8 md:w-10 md:h-10";
  const isBroken = !src || _brokenLogos.has(src);

  // Known-broken URL: skip the img entirely, show gradient letter
  if (isBroken) {
    return (
      <div className={`${dim} bg-gradient-to-br from-pink-500 via-purple-500 to-blue-500 rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 text-xs`}>
        {symbol[0]}
      </div>
    );
  }

  // Image might work: render img, with hidden gradient sibling that
  // only appears if onError fires. No gradient behind = no bleed-through.
  return (
    <>
      <img
        src={src}
        alt={symbol}
        className={`${dim} rounded-full flex-shrink-0 object-cover`}
        onError={(e) => {
          _brokenLogos.add(src);
          e.currentTarget.style.display = "none";
          const next = e.currentTarget.nextElementSibling;
          if (next) (next as HTMLElement).style.display = "flex";
        }}
      />
      <div
        className={`${dim} bg-gradient-to-br from-pink-500 via-purple-500 to-blue-500 rounded-full items-center justify-center font-bold text-white flex-shrink-0 text-xs`}
        style={{ display: "none" }}
      >
        {symbol[0]}
      </div>
    </>
  );
}

/** Map price data + TOKEN_REGISTRY into dashboard rows, sorted by market cap */
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
      marketCapRaw: p?.market_cap ?? 0,
      logo: p?.image || token.logo,
      category: token.category,
      chartData: generateCandlestickData(
        p?.current_price ?? token.fallbackPrice,
        token.volatility
      ),
      // Sparkline priority: CoinGecko inline > module cache > empty
      // Module cache prevents flash-disappear on 30s price refresh
      sparkline7d: p?.sparkline_in_7d?.price || _sparklineCache[token.symbol] || [],
      oracleSource: p?.oracle_source,
      oracleUpdatedAt: p?.oracle_updated_at,
      chainlinkFeed: p?.chainlink_feed,
      changeSource: p?.change_source,
    };
  }).sort((a, b) => b.marketCapRaw - a.marketCapRaw);
}

/** Oracle-source badge metadata */
const ORACLE_BADGE: Record<OracleSource, { label: string; dotColor: string }> = {
  network:    { label: "Hedera Network (0x168)", dotColor: "bg-purple-500" },
  chainlink:  { label: "Chainlink",  dotColor: "bg-blue-500" },
  binance:    { label: "Binance",    dotColor: "bg-yellow-500" },
  coincap:    { label: "CoinCap",    dotColor: "bg-amber-500" },
  coingecko:  { label: "CoinGecko",  dotColor: "bg-green-500" },
  fallback:   { label: "Cached",     dotColor: "bg-slate-500" },
};

/** Tiny colored dot indicating oracle source next to symbol */
function OracleDot({ source, isDark }: { source?: OracleSource; isDark: boolean }) {
  if (!source) return null;
  const colors: Record<OracleSource, string> = {
    network:   "bg-purple-500",
    chainlink: "bg-blue-500",
    binance:   "bg-yellow-500",
    coincap:   "bg-amber-500",
    coingecko: "bg-green-500",
    fallback:  "bg-slate-500",
  };
  const labels: Record<OracleSource, string> = {
    network:   "Hedera Network Rate (0x168)",
    chainlink: "Chainlink Oracle",
    binance:   "Binance API",
    coincap:   "CoinCap API",
    coingecko: "CoinGecko API",
    fallback:  "Cached price",
  };
  return (
    <Tip content={labels[source]}>
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${colors[source]}`}
    />
    </Tip>
  );
}

export function Dashboard() {
  const { isDark, isSky } = useTheme();
  const partnerLogos = usePartneredLogos();
  const [marketFilter, setMarketFilter] = useState<"all" | "defi" | "layer1" | "stablecoin">("all");
  // Hydrate from module-level cache on remount — prevents blank loading flash
  const [marketData, setMarketData] = useState<MarketAsset[]>(_dashCache.marketData);
  const [loading, setLoading] = useState(_dashCache.marketData.length === 0);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [oracleStats, setOracleStats] = useState<OracleStats | null>(_dashCache.oracleStats);

  // VIP eligibility for iridescent buttons
  const { hederaAccount, hederaNetwork } = useWallet();
  const [vipPrefsState, setVipPrefsState] = useState(() => loadVipPrefs());

  // Listen for VIP prefs changes (toggled from VIPPanel via custom event)
  useEffect(() => {
    const handler = (e: Event) => {
      const prefs = (e as CustomEvent).detail;
      if (prefs) setVipPrefsState(prefs);
    };
    window.addEventListener("vip-prefs-changed", handler);
    return () => window.removeEventListener("vip-prefs-changed", handler);
  }, []);

  // Re-verify VIP prefs integrity once the wallet account is known
  useEffect(() => {
    if (hederaAccount?.accountId) setVipPrefsState(loadVipPrefs(hederaAccount.accountId));
  }, [hederaAccount?.accountId]);

  const vipActive = useMemo(() => {
    if (!hederaAccount?.tokens) return false;
    const eligible = isVipEligible(hederaAccount.tokens, hederaNetwork);
    return eligible && vipPrefsState.active;
  }, [hederaAccount?.tokens, hederaNetwork, vipPrefsState]);

  // HBAR.ħ protocol token — live price from DexScreener/SaucerSwap API
  const [hbarhData, setHbarhData] = useState<HbarhTokenData | null>(_dashCache.hbarhData);

  // Real sparkline history for BTC & HBAR ticker cards (24h hourly from CoinCap history API)
  const [btcSparkHistory, setBtcSparkHistory] = useState<number[]>(_dashCache.btcSparkHistory);
  const [hbarSparkHistory, setHbarSparkHistory] = useState<number[]>(_dashCache.hbarSparkHistory);

  useEffect(() => {
    const loadHbarh = async () => {
      const data = await fetchHbarhPrice();
      setHbarhData(data);
      _dashCache.hbarhData = data;
    };
    loadHbarh();
    const iv = setInterval(loadHbarh, 60000);
    return () => clearInterval(iv);
  }, []);

  // Global crypto market data — total market cap & volume
  const [globalData, setGlobalData] = useState<GlobalMarketData | null>(_dashCache.globalData);
  const [headerRsi, setHeaderRsi] = useState<number | null>(_dashCache.headerRsi);
  const [headerFng, setHeaderFng] = useState<number | null>(_dashCache.headerFng);

  useEffect(() => {
    const loadGlobal = async () => {
      // IMPLEMENTATION NOTE: Each stat updates INDEPENDENTLY as it arrives.
      // Previous version used Promise.all which blocked ALL stats until the
      // slowest one (CoinGecko /global at ~3-5s) completed.

      // CoinGecko /global — enriches with accurate total market cap, BTC dom
      fetchGlobalMarketData().then(data => {
        if (data) {
          setGlobalData(data);
          _dashCache.globalData = data;
        }
      }).catch(() => {});

      // RSI — CoinCap history API (typically ~500ms)
      fetchMarketRSI().then(rsiData => {
        setHeaderRsi(rsiData.rsi);
        _dashCache.headerRsi = rsiData.rsi;
      }).catch(() => {});

      // Fear & Greed — alternative.me API (has 6s timeout)
      fetchFearGreed().then(fngVal => {
        setHeaderFng(fngVal);
        _dashCache.headerFng = fngVal;
      }).catch(() => {});
    };
    loadGlobal();
    const iv = setInterval(loadGlobal, 120000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const loadPrices = async () => {
      // HBAR fast-path is now integrated into fetchCoinPrices() itself,
      // so ALL consumers (Dashboard, Trading, etc.) automatically get
      // a live HBAR price via Binance (lone-wolf fast-path).
      const prices = await fetchCoinPrices(ALL_SYMBOLS);

      const assets = buildMarketAssets(prices);

      // Update oracle stats after fetch
      const stats = getOracleStats();
      setOracleStats(stats);

      // Show data immediately — don't wait for chart candles
      setMarketData(assets);
      setLoading(false);

      // FAST APPROXIMATION: Compute global stats from price data we already have.
      // Shows Market Cap, Volume, BTC Dom instantly (before CoinGecko /global arrives).
      // CoinGecko /global enriches with accurate numbers when it resolves (~2-5s later).
      // IMPLEMENTATION NOTE: Check _dashCache (module-level) not React state to avoid
      // stale closure — loadPrices is defined in useEffect([]) so state vars are stale.
      if (!_dashCache.globalData || _dashCache.globalData.activeCryptos === 0) {
        const approx = computeApproxGlobalData(prices);
        if (approx.totalMarketCap > 0) {
          setGlobalData(approx);
          // Don't persist to _dashCache — let CoinGecko /global overwrite with accurate data
        }
      }

      // Persist to module cache
      _dashCache.marketData = assets;
      _dashCache.oracleStats = stats;
      _dashCache.timestamp = Date.now();

      // Fetch sparklines from Binance klines in BACKGROUND (non-blocking, ~200ms)
      // Separate from price pipeline to keep prices fast
      fetchAllSparklines(ALL_SYMBOLS).then(sparklines => {
        // Persist to module-level cache so 30s price refreshes don't flash-empty
        _sparklineCache = { ..._sparklineCache, ...sparklines };
        setMarketData(prev => {
          const updated = prev.map(asset => {
            const spark = sparklines[asset.symbol];
            return spark && spark.length >= 10
              ? { ...asset, sparkline7d: spark }
              : asset;
          });
          _dashCache.marketData = updated;
          return updated;
        });
      }).catch(() => {});

      // Fetch real chart data in BACKGROUND (non-blocking) for non-stablecoin tokens
      // Throttled in batches of 4 to avoid rate-limiting cascades
      fetchChartsThrottled(CHART_SYMBOLS, prices).then(results => {
        setMarketData(prev => {
          const updated = prev.map(asset => {
            const real = results.find(r => r.sym === asset.symbol);
            return real && real.candles.length >= 5 ? { ...asset, chartData: real.candles } : asset;
          });
          _dashCache.marketData = updated;
          return updated;
        });
      }).catch(() => {});
    };

    loadPrices();
    const interval = setInterval(loadPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  // Pull-to-refresh support — re-fetch all price data on mobile swipe-down
  useEffect(() => {
    const handlePullRefresh = () => {
      setLoading(true);
      fetchCoinPrices(ALL_SYMBOLS).then((prices) => {
        setMarketData(buildMarketAssets(prices));
        setOracleStats(getOracleStats());
        setLoading(false);
      }).catch(() => setLoading(false));
      fetchGlobalMarketData().then(setGlobalData);
      fetchHbarhPrice().then(setHbarhData);
    };
    window.addEventListener("wrappdex:pull-refresh", handlePullRefresh);
    return () => window.removeEventListener("wrappdex:pull-refresh", handlePullRefresh);
  }, []);

  useEffect(() => {
    const loadSparkHistory = async () => {
      // Fetch 7 days of hourly data for smooth sparklines
      const [btcHistory, hbarHistory] = await Promise.all([
        fetchCoinCapHistory("BTC", "h1", 7),
        fetchCoinCapHistory("HBAR", "h1", 7),
      ]);
      if (btcHistory.length > 0) {
        const pts = btcHistory.map(p => p.priceUsd);
        setBtcSparkHistory(pts);
        _dashCache.btcSparkHistory = pts;
      }
      if (hbarHistory.length > 0) {
        const pts = hbarHistory.map(p => p.priceUsd);
        setHbarSparkHistory(pts);
        _dashCache.hbarSparkHistory = pts;
      }
    };

    loadSparkHistory();
    const interval = setInterval(loadSparkHistory, 300_000); // refresh every 5 min
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
      marketCapRaw: 0,
      logo: isDark ? partnerLogos.hbarDark : partnerLogos.hbarLight,
      category: "defi",
      chartData: generateCandlestickData(hbarhData.priceUsd, 0.18),
      sparkline7d: hbarhData.priceHistory,
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

  // BTC Dominance bar segments (warm orange → cool blue)
  const BTC_DOM_SEGMENTS = [
    "#ea580c", "#f97316", "#fbbf24", "#fde047", "#d4d4d4",
    "#d4d4d4", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb",
  ];

  const cardClass = isDark
    ? `rounded-xl p-4 border border-white/[0.06] bg-[#0d0f1a]/80${vipActive ? " vip-dash-card" : ""}`
    : `rounded-xl p-4 border border-gray-200 bg-white${vipActive ? " vip-dash-card" : ""}`;

  return (
    <div className="space-y-4">
      {/* ═══ Row 1: Market Stats — CoinGecko typography ═══ */}
      <div className={cardClass}>
        {vipActive && <span className="vip-shimmer-inner" aria-hidden="true" />}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Market Cap */}
          <div>
            <div className={`text-xl sm:text-2xl lg:text-[28px] font-bold tracking-tight leading-none ${isDark ? "text-white" : "text-gray-900"}`}>
              {globalData
                ? <><span className="hidden sm:inline">${Math.round(globalData.totalMarketCap).toLocaleString()}</span><span className="sm:hidden">{formatMarketCap(globalData.totalMarketCap)}</span></>
                : "---"
              }
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Market Cap</span>
              {globalData && (
                <span className={`text-xs font-medium ${globalData.marketCapChange24h >= 0 ? "text-[#16c784]" : "text-[#ea3943]"}`}>
                  {globalData.marketCapChange24h >= 0 ? "▲" : "▼"} {Math.abs(globalData.marketCapChange24h).toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          {/* 24h Volume */}
          <div className={`sm:border-l ${isDark ? "sm:border-white/[0.06]" : "sm:border-gray-200"} sm:pl-6`}>
            <div className={`text-xl sm:text-2xl lg:text-[28px] font-bold tracking-tight leading-none ${isDark ? "text-white" : "text-gray-900"}`}>
              {globalData
                ? <><span className="hidden sm:inline">${Math.round(globalData.totalVolume24h).toLocaleString()}</span><span className="sm:hidden">{formatMarketCap(globalData.totalVolume24h)}</span></>
                : "---"
              }
            </div>
            <div className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              24h Trading Volume
            </div>
          </div>

          {/* BTC / ETH / Coins stats */}
          {globalData && (
            <div className={`flex items-center gap-4 flex-wrap sm:border-l ${isDark ? "sm:border-white/[0.06]" : "sm:border-gray-200"} sm:pl-6`}>
              <span className="text-xs">
                <span className={isDark ? "text-slate-500" : "text-gray-400"}>BTC </span>
                <span className="font-medium text-amber-400">{globalData.btcDominance.toFixed(1)}%</span>
              </span>
              <span className="text-xs">
                <span className={isDark ? "text-slate-500" : "text-gray-400"}>ETH </span>
                <span className="font-medium text-blue-400">{globalData.ethDominance.toFixed(1)}%</span>
              </span>
              <span className="text-xs">
                <span className={isDark ? "text-slate-500" : "text-gray-400"}>Coins </span>
                <span className={`font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>{globalData.activeCryptos.toLocaleString()}</span>
              </span>
              {headerRsi !== null && (
                <span className="text-xs">
                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>RSI </span>
                  <span className={`font-medium ${
                    headerRsi <= 30 ? "text-[#16c784]"
                      : headerRsi <= 45 ? "text-[#30e0a1]"
                      : headerRsi <= 55 ? "text-amber-400"
                      : headerRsi <= 70 ? "text-orange-400"
                      : "text-[#ea3943]"
                  }`}>{headerRsi.toFixed(1)}</span>
                </span>
              )}
              {headerFng !== null && (
                <span className="text-xs">
                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>F&G </span>
                  <span className={`font-medium ${
                    headerFng <= 25 ? "text-[#ea3943]"
                      : headerFng <= 45 ? "text-orange-400"
                      : headerFng <= 55 ? "text-amber-400"
                      : headerFng <= 75 ? "text-[#30e0a1]"
                      : "text-[#16c784]"
                  }`}>{headerFng}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Row 1b: Price Tickers — BTC | HBAR | HBAR.ħ ══ */}
      {(() => {
        const btcAsset = marketData.find(a => a.symbol === "BTC");
        const hbarAsset = marketData.find(a => a.symbol === "HBAR");

        const formatTickerPrice = (p: number) =>
          p >= 1 ? `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${p < 0.001 ? p.toFixed(8) : p.toFixed(6)}`;

        // Reusable sparkline SVG renderer
        const renderSparkline = (pts: number[], gradId: string) => {
          if (pts.length < 2) return null;
          const min = Math.min(...pts);
          const max = Math.max(...pts);
          const range = max - min || 1;
          const w = 200, h = 40;
          const polyline = pts.map((v, i) =>
            `${(i / (pts.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`
          ).join(" ");
          const isUp = pts[pts.length - 1] >= pts[0];
          const areaPath = `M 0,${h} ` + pts.map((v, i) =>
            `L ${(i / (pts.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`
          ).join(" ") + ` L ${w},${h} Z`;
          return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-3 w-full" style={{ maxWidth: w }}>
              <defs>
                <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={isUp ? "#16c784" : "#ea3943"} stopOpacity="0.2" />
                  <stop offset="100%" stopColor={isUp ? "#16c784" : "#ea3943"} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill={`url(#${gradId})`} />
              <polyline
                points={polyline}
                fill="none"
                stroke={isUp ? "#16c784" : "#ea3943"}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          );
        };

        const btcPrice = btcAsset?.price ?? 97845;
        const btcChange = btcAsset?.change ?? 0;
        const btcChangeSource = btcAsset?.changeSource || "fallback";
        const btcSparkline = btcSparkHistory;

        const hbarPrice = hbarAsset?.price ?? 0.28;
        const hbarChange = hbarAsset?.change ?? 0;
        const hbarChangeSource = hbarAsset?.changeSource || "fallback";
        const hbarSparkline = hbarSparkHistory;

        const tickerCard = `${cardClass} block transition-all duration-200 ${isDark ? "hover:border-white/[0.12]" : "hover:shadow-md"}`;

        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* BTC — Bitcoin */}
            <Link to="/trading/BTC" className={tickerCard}>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-gray-800"}`}>Bitcoin</span>
                <TokenLogo src={btcAsset?.logo || TOKEN_LOGOS.BTC} symbol="BTC" size="sm" />
              </div>
              <div className={`text-xl sm:text-2xl lg:text-[28px] font-bold tracking-tight leading-none ${isDark ? "text-white" : "text-gray-900"}`}>
                {formatTickerPrice(btcPrice)}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {btcChangeSource === "fallback" ? (
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"} animate-pulse`}>---</span>
                ) : (
                  <PriceFlash value={btcChange}>
                  <span className={`text-xs font-medium ${btcChange >= 0 ? "text-[#16c784]" : "text-[#ea3943]"}`}>
                    {btcChange >= 0 ? "▲" : "▼"} {Math.abs(btcChange).toFixed(2)}%
                  </span>
                  </PriceFlash>
                )}
              </div>
              {renderSparkline(btcSparkline, "btc-spark-grad")}
              <div className="flex items-center gap-4 mt-2">
                <span className="text-xs">
                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>Vol </span>
                  <span className={`font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>{btcAsset?.volume || "---"}</span>
                </span>
                <span className="text-xs">
                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>MCap </span>
                  <span className={`font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>{btcAsset?.marketCap ? btcAsset.marketCap : "---"}</span>
                </span>
              </div>
            </Link>

            {/* HBAR — Hedera */}
            <Link to="/trading/HBAR" className={tickerCard}>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-gray-800"}`}>Hedera</span>
                <TokenLogo src={hbarAsset?.logo || TOKEN_LOGOS.HBAR} symbol="HBAR" size="sm" />
              </div>
              <div className={`text-xl sm:text-2xl lg:text-[28px] font-bold tracking-tight leading-none ${isDark ? "text-white" : "text-gray-900"}`}>
                {formatTickerPrice(hbarPrice)}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {hbarChangeSource === "fallback" ? (
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"} animate-pulse`}>---</span>
                ) : (
                  <PriceFlash value={hbarChange}>
                  <span className={`text-xs font-medium ${hbarChange >= 0 ? "text-[#16c784]" : "text-[#ea3943]"}`}>
                    {hbarChange >= 0 ? "▲" : "▼"} {Math.abs(hbarChange).toFixed(2)}%
                  </span>
                  </PriceFlash>
                )}
              </div>
              {renderSparkline(hbarSparkline, "hbar-spark-grad")}
              <div className="flex items-center gap-4 mt-2">
                <span className="text-xs">
                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>Vol </span>
                  <span className={`font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>{hbarAsset?.volume || "---"}</span>
                </span>
                <span className="text-xs">
                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>MCap </span>
                  <span className={`font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>{hbarAsset?.marketCap ? hbarAsset.marketCap : "---"}</span>
                </span>
              </div>
            </Link>

            {/* HBAR.ħ — Protocol Token */}
            <Link to="/swap" className={tickerCard}>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-gray-800"}`}>HBAR.ħ</span>
                <img
                  src={isDark ? partnerLogos.hbarDark : partnerLogos.hbarLight}
                  alt="HBAR.ħ"
                  className="w-7 h-7 rounded-full flex-shrink-0 object-cover"
                />
              </div>
              <div className={`text-xl sm:text-2xl lg:text-[28px] font-bold tracking-tight leading-none ${isDark ? "text-white" : "text-gray-900"}`}>
                {hbarhData ? `$${hbarhData.priceUsd < 0.01 ? hbarhData.priceUsd.toFixed(7) : hbarhData.priceUsd.toFixed(6)}` : "---"}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {hbarhData ? (
                  <PriceFlash value={hbarhData.change24h}>
                  <span className={`text-xs font-medium ${hbarhData.change24h >= 0 ? "text-[#16c784]" : "text-[#ea3943]"}`}>
                    {hbarhData.change24h >= 0 ? "▲" : "▼"} {Math.abs(hbarhData.change24h).toFixed(2)}%
                  </span>
                  </PriceFlash>
                ) : (
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"} animate-pulse`}>---</span>
                )}
              </div>
              {hbarhData && hbarhData.priceHistory.length > 1 && renderSparkline(hbarhData.priceHistory, "hbarh-spark-grad")}
              <div className="flex items-center gap-4 mt-2">
                <span className="text-xs">
                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>Vol </span>
                  <span className={`font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>{hbarhData ? formatUsdCompact(hbarhData.volume24h) : "---"}</span>
                </span>
                <span className="text-xs">
                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>Liq </span>
                  <span className={`font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>{hbarhData ? formatUsdCompact(hbarhData.liquidity) : "---"}</span>
                </span>
              </div>
            </Link>
          </div>
        );
      })()}

      {/* ═══ Row 2: CoinMarketCap-style Indicators ═══ */}
      <div className={`grid grid-cols-1 md:grid-cols-3 gap-3${vipActive ? " vip-indicator-row" : ""}`}>
        {/* RSI — CMC horizontal bar */}
        <RSIGauge />

        {/* BTC Dominance — CMC horizontal bar */}
        <div className={cardClass}>
          {vipActive && <span className="vip-shimmer-inner" aria-hidden="true" />}
          <div className="flex items-center gap-0.5 mb-3">
            <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-gray-800"}`}>
              BTC Dominance
            </span>
            <ChevronRight className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
          </div>

          {globalData ? (
            <>
              <div className="flex items-baseline gap-1 mb-4">
                <span className={`text-[32px] font-bold leading-none tracking-tight ${isDark ? "text-white" : "text-gray-900"}`}>
                  {globalData.btcDominance.toFixed(1)}
                </span>
                <span className={`text-lg font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}>/100</span>
              </div>

              {/* Segmented bar */}
              <div className="relative mb-2">
                <div className="flex gap-[3px]">
                  {BTC_DOM_SEGMENTS.map((color, i) => (
                    <div
                      key={i}
                      className={`flex-1 h-[8px] ${i === 0 ? "rounded-l-full" : ""} ${i === BTC_DOM_SEGMENTS.length - 1 ? "rounded-r-full" : ""}`}
                      style={{ backgroundColor: color, opacity: isDark ? 0.85 : 0.75 }}
                    />
                  ))}
                </div>
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[14px] h-[14px] rounded-full z-10"
                  style={{
                    left: `${Math.min(Math.max(globalData.btcDominance, 3), 97)}%`,
                    backgroundColor: isDark ? "#0f172a" : "#1e293b",
                    border: `2.5px solid ${isDark ? "#e2e8f0" : "#ffffff"}`,
                    boxShadow: isDark ? "0 0 0 1px rgba(255,255,255,0.1)" : "0 0 0 1px rgba(0,0,0,0.08)",
                  }}
                />
              </div>

              <div className="flex justify-between mt-1">
                <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Bitcoin</span>
                <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Altcoin</span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-[72px]">
              <div className={`animate-spin w-5 h-5 border-2 rounded-full ${isDark ? "border-white/10 border-t-white/50" : "border-gray-200 border-t-gray-500"}`} />
            </div>
          )}
        </div>

        {/* Fear & Greed — CMC speedometer gauge + Top 20 Index */}
        <FearGreedGauge />
      </div>

      {/* Site Activity — upgraded full-width activity feed */}
      <SiteActivity />

      {/* Market Overview */}
      <div>
        {/* ── Unified Single-Row Header: Title + Column Labels + Filter pills ── */}
        <div
          className={`rounded-xl mb-3 transition-all duration-300 ${
            isDark
              ? "bg-slate-900/40 border border-slate-800/40"
              : "bg-gray-50/80 border border-gray-100"
          }${vipActive ? " vip-col-header" : ""}`}
        >
          {/* Single row: Title + Filter pills (left) | Column Labels (right) */}
          <div className="flex items-center px-3 md:px-4 py-2.5 gap-3">
            {/* Left: Title + filter pills */}
            <div className="flex items-center flex-1 min-w-0 gap-3">
              <h2 className={`text-lg md:text-xl font-bold ${isDark ? "text-white" : "text-gray-900"} transition-all duration-300 leading-none whitespace-nowrap`}>
                Top Markets
              </h2>
              <div className="hidden sm:flex gap-1.5 items-center">
                {(["all", "layer1", "stablecoin"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setMarketFilter(f)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-300 whitespace-nowrap ${
                      marketFilter === f
                        ? f === "stablecoin"
                          ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm shadow-emerald-500/20"
                          : "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm shadow-pink-500/20"
                        : isDark
                        ? "bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700/60"
                        : "bg-white text-gray-500 hover:text-gray-900 hover:bg-gray-100 border border-gray-200/60"
                    }`}
                  >
                    {f === "all" ? "All" : f === "layer1" ? "Layer 1" : "Stablecoins"}
                  </button>
                ))}
                <Link
                  to="/defi"
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-all duration-300 whitespace-nowrap ${
                    isDark
                      ? "bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700/60"
                      : "bg-white text-gray-500 hover:text-gray-900 hover:bg-gray-100 border border-gray-200/60"
                  }`}
                >
                  DeFi
                </Link>
              </div>
            </div>

            {/* Right: column labels ONLY — structure mirrors data row right side exactly */}
            <div className="flex items-center gap-3 md:gap-6">
              <div className="w-28 text-right">
                <span className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider ${
                  isDark ? "text-slate-500" : "text-gray-400"
                }`}>Price</span>
              </div>
              <div className="hidden md:block w-20 text-right">
                <span className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider ${
                  isDark ? "text-slate-500" : "text-gray-400"
                }`}>24h %</span>
              </div>
              <div className="hidden lg:block w-20 text-right">
                <span className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider ${
                  isDark ? "text-slate-500" : "text-gray-400"
                }`}>Volume</span>
              </div>
              <div className="hidden lg:block w-24 text-right">
                <span className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider ${
                  isDark ? "text-slate-500" : "text-gray-400"
                }`}>Mkt Cap</span>
              </div>
              <div className="hidden md:block w-32" />
              {/* Invisible spacer matching Trade+Bridge button area width */}
              <div className="hidden sm:block w-[165px]" />
              <div className="w-5" />
            </div>
          </div>

          {/* Mobile filter pills — visible below sm only */}
          <div className="flex sm:hidden gap-1.5 overflow-x-auto px-3 pb-2">
            {(["all", "layer1", "stablecoin"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setMarketFilter(f)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-300 whitespace-nowrap ${
                  marketFilter === f
                    ? f === "stablecoin"
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm shadow-emerald-500/20"
                      : "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm shadow-pink-500/20"
                    : isDark
                    ? "bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700/60"
                    : "bg-white text-gray-500 hover:text-gray-900 hover:bg-gray-100 border border-gray-200/60"
                }`}
              >
                {f === "all" ? "All" : f === "layer1" ? "Layer 1" : "Stablecoins"}
              </button>
            ))}
            <Link
              to="/defi"
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-all duration-300 whitespace-nowrap ${
                isDark
                  ? "bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700/60"
                  : "bg-white text-gray-500 hover:text-gray-900 hover:bg-gray-100 border border-gray-200/60"
              }`}
            >
              DeFi
            </Link>
          </div>
        </div>

        {loading ? (
          <MarketListSkeleton rows={8} />
        ) : (
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
                }${vipActive ? " vip-market-row" : ""}`}
              >
                {/* Row header */}
                <div
                  className="flex items-center p-3 md:p-4 cursor-pointer"
                  onClick={() => toggleExpand(item.symbol)}
                >
                  <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                    <TokenLogo src={item.logo} symbol={item.symbol} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm md:text-base">{item.symbol}</span>
                        <OracleDot source={item.oracleSource} isDark={isDark} />
                        {item.symbol === "HBAR.ħ" && (
                          <Tip content="DexScreener API">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-500"
                          />
                          </Tip>
                        )}
                      </div>
                      <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"} hidden sm:flex items-center gap-1`}>
                        {item.name}
                        {item.oracleSource === "chainlink" && (
                          <span className={`text-xs px-1 py-0 rounded border ${isDark ? "text-blue-400 border-blue-500/30" : "text-blue-600 border-blue-200"}`}>
                            CHAINLINK
                          </span>
                        )}
                        {item.symbol === "HBAR.ħ" && (
                          <span className={`text-xs px-1 py-0 rounded border ${isDark ? "text-cyan-400 border-cyan-500/30" : "text-cyan-600 border-cyan-200"}`}>
                            DEXSCREENER
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 md:gap-6">
                    <div className="w-28 text-right">
                      <div className="font-bold text-sm md:text-base">
                        ${item.price >= 1 ? item.price.toLocaleString() : item.price < 0.001 ? item.price.toFixed(8) : item.price.toFixed(4)}
                      </div>
                      {/* Mobile-only change below price */}
                      {item.changeSource === "fallback" ? (
                        <Tip content="Waiting for live 24h data...">
                        <div
                          className={`flex items-center justify-end gap-0.5 text-xs md:hidden ${
                            isDark ? "text-slate-500" : "text-gray-400"
                          } animate-pulse`}
                        >
                          —
                        </div>
                        </Tip>
                      ) : (
                        <PriceFlash value={item.change}>
                        <div
                          className={`flex items-center justify-end gap-0.5 text-xs md:hidden ${
                            item.change >= 0 ? "text-emerald-500" : "text-red-500"
                          }`}
                        >
                          {item.change >= 0 ? "+" : ""}{Math.abs(item.change).toFixed(2)}%
                        </div>
                        </PriceFlash>
                      )}
                    </div>

                    <div className="hidden md:block w-20 text-right">
                      {item.changeSource === "fallback" ? (
                        <Tip content="Waiting for live 24h data from Binance/CoinGecko...">
                        <div
                          className={`flex items-center justify-end gap-1 font-bold text-sm ${
                            isDark ? "text-slate-500" : "text-gray-400"
                          } animate-pulse`}
                        >
                          <span className="text-xs">~</span> —
                        </div>
                        </Tip>
                      ) : (
                        <PriceFlash value={item.change}>
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
                        </PriceFlash>
                      )}
                    </div>

                    <div className={`hidden lg:block w-20 text-right text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {item.volume}
                    </div>

                    <div className={`hidden lg:block w-24 text-right text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {item.marketCap}
                    </div>

                    <div className="hidden md:block w-32 h-10">
                      <MiniSparkline data={item.sparkline7d} change24h={item.change} id={`spark-${item.symbol}`} />
                    </div>

                    {/* Trade / Bridge — VIP iridescent glow */}
                    <div className="hidden sm:flex gap-1.5 w-[165px] justify-end">
                      <Link
                        to={item.symbol === "HBAR.ħ" ? "/swap" : `/trading/${item.symbol}`}
                        onClick={(e) => { e.stopPropagation(); if (vipActive) playVipButtonChime(); }}
                        onMouseEnter={() => { if (vipActive) playVipButtonChime(); }}
                        className={`vip-btn-trade px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-300 text-sm font-semibold ${
                          isStable
                            ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-sm shadow-emerald-500/20 text-white"
                            : isSky
                            ? "bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 shadow-sm shadow-sky-500/25 text-white"
                            : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-sm shadow-pink-500/20 text-white"
                        }`}
                      >
                        Trade
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                      <Link
                        to="/bridges"
                        onClick={(e) => { e.stopPropagation(); if (vipActive) playVipButtonChime(); }}
                        onMouseEnter={() => { if (vipActive) playVipButtonChime(); }}
                        className={`vip-btn-bridge px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-300 text-sm font-medium ${
                          isDark
                            ? `bg-slate-800/60 hover:bg-slate-700 border ${isStable ? "border-emerald-500/20 text-slate-200" : isSky ? "border-sky-500/25 text-sky-300 hover:text-sky-200" : "border-pink-500/20 text-slate-200"}`
                            : `bg-gray-100 hover:bg-gray-200 border border-gray-200 ${isSky ? "text-sky-700 hover:text-sky-800" : "text-gray-700"}`
                        }`}
                      >
                        Bridge
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                      </Link>
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
        )}
      </div>

      {/* ═══ Top 20 Coins Heat Map — QuantifyCrypto (sandboxed iframe) ═══ */}
      <CryptoHeatmapWidget />
    </div>
  );
}
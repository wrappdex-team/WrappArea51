import { useState, useEffect, useMemo, useRef } from "react";
import {
  Droplets,
  TrendingUp,
  TrendingDown,
  Zap,
  Lock,
  Clock,
  Search,
  ChevronDown,
  ChevronUp,
  Star,
  Shield,
  Percent,
  BarChart3,
  Info,
  ExternalLink,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { WalletConnectModal } from "./WalletConnectModal";
import {
  fetchBonzoMarkets,
  getBonzoLendUrl,
  isBonzoConfigured,
  type BonzoMarket,
  type BonzoProtocolStats,
} from "../utils/bonzo";
import {
  fetchStakingPools,
  type StakingPool,
  type StakingStats,
} from "../utils/staking-provider";
import {
  fetchDeFiPoolData,
  invalidateDeFiCache,
  type LivePool,
  type DeFiProtocolStats,
} from "../utils/defi-stats";

// ── Liquidity Pool types (unchanged) ──

interface LiquidityPool {
  id: string;
  tokenA: { symbol: string; logo: string };
  tokenB: { symbol: string; logo: string };
  tvl: number;
  volume24h: number;
  apr: number;
  fee: number;
  utilization: number;
  trending: "up" | "down" | "stable";
}

// ── SauceSwap Pool Data ──
const POOLS: LiquidityPool[] = [
  { id: "pool-whbar-usdc", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "USDC", logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" }, tvl: 18_420_000, volume24h: 3_240_000, apr: 24.5, fee: 0.3, utilization: 72, trending: "up" },
  { id: "pool-whbar-weth", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "WETH[hts]", logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png" }, tvl: 12_800_000, volume24h: 2_150_000, apr: 18.2, fee: 0.3, utilization: 65, trending: "up" },
  { id: "pool-whbar-wbtc", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "WBTC[hts]", logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png" }, tvl: 9_650_000, volume24h: 1_890_000, apr: 15.8, fee: 0.3, utilization: 58, trending: "stable" },
  { id: "pool-usdc-usdt", tokenA: { symbol: "USDC", logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" }, tokenB: { symbol: "USDT", logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" }, tvl: 8_910_000, volume24h: 2_180_000, apr: 8.4, fee: 0.01, utilization: 54, trending: "stable" },
  { id: "pool-whbar-sauce", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "SAUCE", logo: "https://www.saucerswap.finance/images/tokens/sauce.svg" }, tvl: 4_120_000, volume24h: 1_560_000, apr: 38.2, fee: 0.3, utilization: 68, trending: "up" },
  { id: "pool-whbar-hbarh", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "HBAR.ħ", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tvl: 5_630_000, volume24h: 890_000, apr: 12.8, fee: 0.05, utilization: 42, trending: "stable" },
  { id: "pool-whbar-link", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "LINK[hts]", logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png" }, tvl: 2_340_000, volume24h: 780_000, apr: 18.7, fee: 0.3, utilization: 49, trending: "up" },
  { id: "pool-whbar-karate", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "KARATE", logo: "https://www.saucerswap.finance/images/tokens/karate.svg" }, tvl: 1_840_000, volume24h: 620_000, apr: 52.1, fee: 1.0, utilization: 75, trending: "up" },
  { id: "pool-whbar-pack", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "PACK", logo: "https://www.saucerswap.finance/images/tokens/pack.svg" }, tvl: 920_000, volume24h: 340_000, apr: 31.6, fee: 0.3, utilization: 52, trending: "up" },
  { id: "pool-whbar-hst", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "HST", logo: "https://www.saucerswap.finance/images/tokens/hst.svg" }, tvl: 680_000, volume24h: 210_000, apr: 26.4, fee: 0.3, utilization: 46, trending: "stable" },
  { id: "pool-whbar-usdt", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "USDT", logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" }, tvl: 6_200_000, volume24h: 1_450_000, apr: 18.3, fee: 0.3, utilization: 62, trending: "up" },
  { id: "pool-whbar-hbarx", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "HBARX", logo: "https://www.saucerswap.finance/images/tokens/hbarx.svg" }, tvl: 5_630_000, volume24h: 890_000, apr: 12.8, fee: 0.05, utilization: 44, trending: "stable" },
  { id: "pool-whbar-dovu", tokenA: { symbol: "WHBAR", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png" }, tokenB: { symbol: "DOVU", logo: "https://www.saucerswap.finance/images/tokens/dovu.svg" }, tvl: 420_000, volume24h: 95_000, apr: 22.0, fee: 0.3, utilization: 38, trending: "stable" },
  { id: "pool-sauce-usdc", tokenA: { symbol: "SAUCE", logo: "https://www.saucerswap.finance/images/tokens/sauce.svg" }, tokenB: { symbol: "USDC", logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" }, tvl: 1_560_000, volume24h: 420_000, apr: 28.5, fee: 0.3, utilization: 55, trending: "up" },
  { id: "pool-wbtc-usdc", tokenA: { symbol: "WBTC[hts]", logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png" }, tokenB: { symbol: "USDC", logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" }, tvl: 2_100_000, volume24h: 560_000, apr: 12.0, fee: 0.3, utilization: 48, trending: "stable" },
  { id: "pool-weth-usdc", tokenA: { symbol: "WETH[hts]", logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png" }, tokenB: { symbol: "USDC", logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" }, tvl: 3_450_000, volume24h: 890_000, apr: 14.2, fee: 0.3, utilization: 51, trending: "up" },
];

type Tab = "pools" | "lend" | "staking";
type SortField = "tvl" | "apr" | "volume24h" | "utilization";
type SortDir = "asc" | "desc";

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function DeFi() {
  const { isDark } = useTheme();
  const { primaryWallet } = useWallet();
  const [activeTab, setActiveTab] = useState<Tab>("pools");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("tvl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedPool, setExpandedPool] = useState<string | null>(null);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(["pool-whbar-usdc", "pool-whbar-weth"]);

  // ── Bonzo lending markets state ──
  const [bonzoMarkets, setBonzoMarkets] = useState<BonzoMarket[]>([]);
  const [bonzoStats, setBonzoStats] = useState<BonzoProtocolStats | null>(null);
  const [bonzoLoading, setBonzoLoading] = useState(false);
  const [bonzoError, setBonzoError] = useState<string | null>(null);

  // ── Staking state ──
  const [stakingPools, setStakingPools] = useState<StakingPool[]>([]);
  const [stakingStats, setStakingStats] = useState<StakingStats | null>(null);

  // ── DeFi Pool Data State ──
  const [livePools, setLivePools] = useState<LivePool[]>([]);
  const [defiStats, setDefiStats] = useState<DeFiProtocolStats | null>(null);
  const [defiLoading, setDefiLoading] = useState(false);
  const [defiError, setDefiError] = useState<string | null>(null);
  const [defiRefresh, setDefiRefresh] = useState(false);
  const defiRefreshRef = useRef(defiRefresh);

  // Fetch Bonzo markets when tab activates
  useEffect(() => {
    if (activeTab !== "lend") return;
    let cancelled = false;
    setBonzoLoading(true);
    setBonzoError(null);

    fetchBonzoMarkets()
      .then(({ markets, stats }) => {
        if (cancelled) return;
        setBonzoMarkets(markets);
        setBonzoStats(stats);
      })
      .catch((err) => {
        if (cancelled) return;
        setBonzoError(err.message || "Failed to load markets");
      })
      .finally(() => {
        if (!cancelled) setBonzoLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeTab]);

  // Fetch staking pools when tab activates
  useEffect(() => {
    if (activeTab !== "staking") return;
    let cancelled = false;

    fetchStakingPools().then(({ pools, stats }) => {
      if (cancelled) return;
      setStakingPools(pools);
      setStakingStats(stats);
    });

    return () => { cancelled = true; };
  }, [activeTab]);

  // Fetch DeFi Pool Data on mount and on refresh (stats need it for all tabs)
  useEffect(() => {
    let cancelled = false;
    setDefiLoading(true);
    setDefiError(null);
    defiRefreshRef.current = defiRefresh;

    fetchDeFiPoolData()
      .then(({ pools, stats }) => {
        if (cancelled || defiRefreshRef.current !== defiRefresh) return;
        setLivePools(pools);
        setDefiStats(stats);
      })
      .catch((err) => {
        if (cancelled || defiRefreshRef.current !== defiRefresh) return;
        setDefiError(err.message || "Failed to load DeFi data");
      })
      .finally(() => {
        if (!cancelled && defiRefreshRef.current === defiRefresh) setDefiLoading(false);
      });

    return () => { cancelled = true; };
  }, [defiRefresh]);

  const toggleFav = (id: string) =>
    setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  // Protocol stats — prefer live SaucerSwap data, fall back to static POOLS
  const isLive = defiStats?.dataSource === "live";
  const totalTVL = isLive ? defiStats!.totalTVL : POOLS.reduce((s, p) => s + p.tvl, 0);
  const totalVolume = isLive ? defiStats!.totalVolume24h : POOLS.reduce((s, p) => s + p.volume24h, 0);
  const avgAPR = isLive ? defiStats!.avgAPR : POOLS.reduce((s, p) => s + p.apr, 0) / POOLS.length;
  const poolCount = isLive ? defiStats!.poolCount : POOLS.length;

  // Display pools — prefer live, fall back to static
  const displayPools: LiquidityPool[] = useMemo(() => {
    if (livePools.length > 0) {
      return livePools.map((lp) => ({
        id: lp.id,
        tokenA: { symbol: lp.tokenA.symbol, logo: lp.tokenA.logo },
        tokenB: { symbol: lp.tokenB.symbol, logo: lp.tokenB.logo },
        tvl: lp.tvl,
        volume24h: lp.volume24h,
        apr: lp.apr,
        fee: lp.fee,
        utilization: lp.utilization,
        trending: lp.trending,
      }));
    }
    return POOLS;
  }, [livePools]);

  // Filtered & sorted pools
  const filteredPools = useMemo(() => {
    let pools = [...displayPools];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      pools = pools.filter(
        (p) =>
          p.tokenA.symbol.toLowerCase().includes(q) ||
          p.tokenB.symbol.toLowerCase().includes(q)
      );
    }
    pools.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      return sortDir === "desc" ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    });
    return pools;
  }, [displayPools, searchQuery, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === "desc" ? (
      <ChevronDown className="w-3 h-3 text-pink-400" />
    ) : (
      <ChevronUp className="w-3 h-3 text-pink-400" />
    );
  };

  const cardClass = isDark
    ? "bg-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  const inputClass = isDark
    ? "bg-slate-800/50 border border-pink-500/10"
    : "bg-gray-50 border border-gray-200";

  const tabs: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: "pools", label: "Liquidity Pools", icon: Droplets, count: poolCount },
    { key: "lend", label: "Lend & Borrow", icon: Zap, count: bonzoMarkets.length || 5 },
    { key: "staking", label: "Staking", icon: Lock, count: stakingPools.length || 5 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent mb-1">
            DeFi
          </h2>
          <p className={isDark ? "text-slate-400" : "text-gray-500"}>
            Earn yield, provide liquidity, and stake on the Hedera network
          </p>
          {isLive ? (
            <div className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-[10px] ${isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
              <Wifi className="w-3 h-3" />
              Live data from SaucerSwap — {poolCount} pools tracked
              {defiStats?.lastUpdated && (
                <span className={isDark ? "text-emerald-500/60" : "text-emerald-600/60"}>
                  &middot; {Math.round((Date.now() - defiStats.lastUpdated) / 1000)}s ago
                </span>
              )}
            </div>
          ) : defiLoading ? (
            <div className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-[10px] ${isDark ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-700 border border-blue-200"}`}>
              <Loader2 className="w-3 h-3 animate-spin" />
              Fetching live pool data from SaucerSwap...
            </div>
          ) : (
            <div className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-[10px] ${isDark ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
              <WifiOff className="w-3 h-3" />
              Fallback data — SaucerSwap API unavailable, retries on refresh
            </div>
          )}
        </div>
        {!primaryWallet && (
          <button
            onClick={() => setShowWalletModal(true)}
            className="px-5 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-pink-500/30 text-white text-sm btn-iridescent"
          >
            Connect Wallet to Start
          </button>
        )}
      </div>

      {/* Protocol Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: "Total Value Locked", value: formatUsd(totalTVL), icon: Lock, color: "text-emerald-400", glow: "shadow-emerald-500/10" },
          { label: "24h Volume", value: formatUsd(totalVolume), icon: BarChart3, color: "text-blue-400", glow: "shadow-blue-500/10" },
          { label: "Average APR", value: `${avgAPR.toFixed(1)}%`, icon: Percent, color: "text-amber-400", glow: "shadow-amber-500/10" },
          { label: "Pools", value: poolCount.toString(), icon: Droplets, color: "text-purple-400", glow: "shadow-purple-500/10" },
        ].map((stat) => (
          <div
            key={stat.label}
            className={`rounded-xl p-4 ${cardClass} ${isDark ? stat.glow : ""}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
              <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{stat.label}</span>
            </div>
            <div className="text-xl md:text-2xl font-bold">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className={`rounded-xl p-1 flex gap-1 ${isDark ? "bg-slate-900/50" : "bg-gray-100"}`}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm transition-all duration-300 ${
                active
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
                  : isDark
                  ? "text-slate-400 hover:text-white hover:bg-slate-800/50"
                  : "text-gray-500 hover:text-gray-900 hover:bg-white"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
              {tab.count != null && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    active
                      ? "bg-white/20 text-white"
                      : isDark
                      ? "bg-slate-700 text-slate-400"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ═══ LIQUIDITY POOLS TAB ═══ */}
      {activeTab === "pools" && (
        <div className="space-y-4">
          {/* Search & Filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg flex-1 ${inputClass}`}>
              <Search className={`w-4 h-4 ${isDark ? "text-slate-400" : "text-gray-400"}`} />
              <input
                type="text"
                placeholder="Search pools by token..."
                className="bg-transparent outline-none flex-1 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              onClick={() => { invalidateDeFiCache(); setDefiRefresh((r) => !r); }}
              disabled={defiLoading}
              className={`px-3 py-2.5 rounded-lg text-sm font-bold transition-all ${isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-200 hover:bg-gray-300 text-gray-700"}`}
            >
              <RefreshCw className={`w-4 h-4 ${defiLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Pools Table */}
          <div className={`rounded-xl overflow-hidden ${cardClass}`}>
            {/* Desktop Header */}
            <div className={`hidden md:grid grid-cols-12 gap-3 px-4 py-3 text-xs uppercase tracking-wider ${isDark ? "text-slate-500 border-b border-pink-500/10" : "text-gray-400 border-b border-gray-100"}`}>
              <div className="col-span-1"></div>
              <div className="col-span-3">Pool</div>
              <button onClick={() => handleSort("tvl")} className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-pink-400 transition-colors">TVL <SortIcon field="tvl" /></button>
              <button onClick={() => handleSort("volume24h")} className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-pink-400 transition-colors">24h Volume <SortIcon field="volume24h" /></button>
              <button onClick={() => handleSort("apr")} className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-pink-400 transition-colors">APR <SortIcon field="apr" /></button>
              <button onClick={() => handleSort("utilization")} className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-pink-400 transition-colors">Utilization <SortIcon field="utilization" /></button>
            </div>

            {/* Pool Rows */}
            {filteredPools.map((pool) => {
              const expanded = expandedPool === pool.id;
              return (
                <div key={pool.id}>
                  <div
                    onClick={() => setExpandedPool(expanded ? null : pool.id)}
                    className={`grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 px-4 py-3.5 cursor-pointer transition-all duration-200 ${
                      expanded
                        ? isDark ? "bg-pink-500/5" : "bg-pink-50"
                        : isDark ? "hover:bg-slate-800/30" : "hover:bg-gray-50"
                    } ${isDark ? "border-b border-pink-500/5" : "border-b border-gray-50"}`}
                  >
                    {/* Favorite */}
                    <div className="hidden md:flex col-span-1 items-center">
                      <button onClick={(e) => { e.stopPropagation(); toggleFav(pool.id); }} className="p-0.5">
                        <Star className={`w-4 h-4 ${favorites.includes(pool.id) ? "text-yellow-400 fill-yellow-400" : isDark ? "text-slate-600" : "text-gray-300"}`} />
                      </button>
                    </div>

                    {/* Pool Pair */}
                    <div className="md:col-span-3 flex items-center gap-3">
                      <div className="flex -space-x-2">
                        <img src={pool.tokenA.logo} alt={pool.tokenA.symbol} className="w-7 h-7 rounded-full ring-2 ring-slate-900/50 z-10" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        <img src={pool.tokenB.logo} alt={pool.tokenB.symbol} className="w-7 h-7 rounded-full ring-2 ring-slate-900/50" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      </div>
                      <div>
                        <div className="font-bold text-sm">{pool.tokenA.symbol}/{pool.tokenB.symbol}</div>
                        <div className={`text-[10px] flex items-center gap-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          <span className={`px-1 py-0.5 rounded ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>{pool.fee}%</span>
                          {pool.trending === "up" && <TrendingUp className="w-3 h-3 text-emerald-400" />}
                          {pool.trending === "down" && <TrendingDown className="w-3 h-3 text-red-400" />}
                        </div>
                      </div>
                    </div>

                    {/* Mobile: Stats Grid */}
                    <div className="grid grid-cols-4 gap-2 md:hidden">
                      <div>
                        <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>TVL</div>
                        <div className="text-xs font-bold">{formatUsd(pool.tvl)}</div>
                      </div>
                      <div>
                        <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Vol</div>
                        <div className="text-xs font-bold">{formatUsd(pool.volume24h)}</div>
                      </div>
                      <div>
                        <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>APR</div>
                        <div className="text-xs font-bold text-emerald-400">{pool.apr}%</div>
                      </div>
                      <div>
                        <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Util</div>
                        <div className="text-xs font-bold">{pool.utilization}%</div>
                      </div>
                    </div>

                    {/* Desktop: TVL */}
                    <div className="hidden md:flex col-span-2 items-center">
                      <span className="font-bold text-sm">{formatUsd(pool.tvl)}</span>
                    </div>

                    {/* Desktop: Volume */}
                    <div className="hidden md:flex col-span-2 items-center">
                      <span className="text-sm">{formatUsd(pool.volume24h)}</span>
                    </div>

                    {/* Desktop: APR */}
                    <div className="hidden md:flex col-span-2 items-center">
                      <span className="font-bold text-sm text-emerald-400">{pool.apr}%</span>
                    </div>

                    {/* Desktop: Utilization */}
                    <div className="hidden md:flex col-span-2 items-center gap-2">
                      <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isDark ? "bg-slate-800" : "bg-gray-200"}`}>
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            pool.utilization > 70 ? "bg-emerald-500" : pool.utilization > 40 ? "bg-blue-500" : "bg-amber-500"
                          }`}
                          style={{ width: `${pool.utilization}%` }}
                        />
                      </div>
                      <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{pool.utilization}%</span>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expanded && (
                    <div className={`px-4 py-4 ${isDark ? "bg-pink-500/5 border-b border-pink-500/10" : "bg-pink-50/50 border-b border-gray-100"}`}>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className={`rounded-lg p-3 ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                          <div className={`text-xs mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Pool Information</div>
                          <div className="space-y-1.5 text-sm">
                            <div className="flex justify-between"><span className={isDark ? "text-slate-400" : "text-gray-500"}>Fee Tier</span><span>{pool.fee}%</span></div>
                            <div className="flex justify-between"><span className={isDark ? "text-slate-400" : "text-gray-500"}>Protocol</span><span>SaucerSwap</span></div>
                            <div className="flex justify-between"><span className={isDark ? "text-slate-400" : "text-gray-500"}>Network</span><span>Hedera</span></div>
                          </div>
                        </div>
                        <div className={`rounded-lg p-3 ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                          <div className={`text-xs mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Your Position</div>
                          {primaryWallet ? (
                            <div className="space-y-1.5 text-sm">
                              <div className="flex justify-between"><span className={isDark ? "text-slate-400" : "text-gray-500"}>Liquidity</span><span>$0.00</span></div>
                              <div className="flex justify-between"><span className={isDark ? "text-slate-400" : "text-gray-500"}>Unclaimed Fees</span><span>$0.00</span></div>
                              <div className="flex justify-between"><span className={isDark ? "text-slate-400" : "text-gray-500"}>Pool Share</span><span>0%</span></div>
                            </div>
                          ) : (
                            <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Connect wallet to view</div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2">
                          <button className="px-4 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-pink-500/20">
                            Add Liquidity
                          </button>
                          <button className={`px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-200 hover:bg-gray-300 text-gray-700"}`}>
                            Remove Liquidity
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredPools.length === 0 && (
              <div className={`py-12 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                No pools found matching "{searchQuery}"
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ LEND & BORROW TAB (Bonzo Finance) ═══ */}
      {activeTab === "lend" && (
        <div className="space-y-4">
          {/* Bonzo Finance Header */}
          <div className={`rounded-xl p-4 md:p-5 flex flex-col sm:flex-row items-start gap-4 ${isDark ? "bg-gradient-to-br from-teal-900/20 to-emerald-900/10 border border-teal-500/20" : "bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-200"}`}>
            <div className="flex items-center gap-3 shrink-0">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${isDark ? "bg-teal-500/20" : "bg-teal-100"}`}>
                <Zap className="w-6 h-6 text-teal-500" />
              </div>
              <div>
                <div className="font-bold text-sm flex items-center gap-2">
                  Powered by Bonzo Finance
                  <a
                    href={getBonzoLendUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${isDark ? "bg-teal-500/10 text-teal-400 hover:bg-teal-500/20" : "bg-teal-100 text-teal-700 hover:bg-teal-200"}`}
                  >
                    app.bonzo.finance/lend <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <div className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Aave V2 lending protocol on Hedera — supply assets to earn interest, borrow against collateral
                </div>
              </div>
            </div>
            <div className="flex gap-2 sm:ml-auto shrink-0">
              <a
                href={getBonzoLendUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20" : "bg-teal-100 text-teal-700 hover:bg-teal-200 border border-teal-200"}`}
              >
                Open Bonzo <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href="https://github.com/Bonzo-Labs/bonzo-finance-contracts"
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 border border-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200"}`}
              >
                Contracts <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Data Pipeline Status */}
          {bonzoStats && bonzoStats.dataSource === "pending" && !bonzoLoading && (
            <div className={`rounded-xl p-4 flex items-start gap-3 ${isDark ? "bg-amber-500/5 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
              <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-sm mb-0.5">Awaiting On-Chain Data</div>
                <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Live supply/borrow rates will populate once the Bonzo ProtocolDataProvider contract address is configured.
                  Supply and Borrow buttons link directly to{" "}
                  <a href={getBonzoLendUrl()} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">app.bonzo.finance/lend</a>{" "}
                  where you can interact with pools now.
                </div>
              </div>
            </div>
          )}

          {/* Loading State */}
          {bonzoLoading && (
            <div className={`rounded-xl p-12 flex flex-col items-center gap-3 ${cardClass}`}>
              <Loader2 className={`w-8 h-8 animate-spin ${isDark ? "text-teal-400" : "text-teal-600"}`} />
              <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading Bonzo markets...</div>
            </div>
          )}

          {/* Error State */}
          {bonzoError && !bonzoLoading && (
            <div className={`rounded-xl p-4 flex items-start gap-3 ${isDark ? "bg-red-500/5 border border-red-500/20" : "bg-red-50 border border-red-200"}`}>
              <Info className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <span className="font-bold">Connection issue: </span>
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>{bonzoError}</span>
              </div>
            </div>
          )}

          {/* Markets Table */}
          {!bonzoLoading && bonzoMarkets.length > 0 && (
            <>
              <div className={`rounded-xl overflow-hidden ${cardClass}`}>
                {/* Desktop Header */}
                <div className={`hidden md:grid grid-cols-12 gap-3 px-4 py-3 text-xs uppercase tracking-wider ${isDark ? "text-slate-500 border-b border-teal-500/10" : "text-gray-400 border-b border-gray-100"}`}>
                  <div className="col-span-3">Asset</div>
                  <div className="col-span-2 text-right">Supply APY</div>
                  <div className="col-span-2 text-right">Borrow APY</div>
                  <div className="col-span-2 text-right">Utilization</div>
                  <div className="col-span-3 text-center">Actions</div>
                </div>

                {/* Market Rows */}
                {bonzoMarkets.map((market) => (
                  <div
                    key={market.id}
                    className={`grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-3 px-4 py-4 transition-all duration-200 ${isDark ? "hover:bg-slate-800/30 border-b border-teal-500/5" : "hover:bg-gray-50 border-b border-gray-50"}`}
                  >
                    {/* Asset */}
                    <div className="md:col-span-3 flex items-center gap-3">
                      <img
                        src={market.logo}
                        alt={market.symbol}
                        className="w-9 h-9 rounded-full"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                      <div>
                        <div className="font-bold text-sm flex items-center gap-1.5">
                          {market.symbol}
                          {market.canBeCollateral && (
                            <Shield className={`w-3 h-3 ${isDark ? "text-teal-500" : "text-teal-600"}`} title={`Collateral — ${market.maxLTV}% LTV`} />
                          )}
                        </div>
                        <div className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          {market.name}
                          {market.hederaTokenId !== "native" && (
                            <span className={`ml-1 ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                              ({market.hederaTokenId})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Mobile Stats Row */}
                    <div className="grid grid-cols-3 gap-3 md:hidden">
                      <div>
                        <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Supply APY</div>
                        <div className="text-sm font-bold">
                          {market.supplyAPY != null ? (
                            <span className="text-emerald-400 flex items-center gap-0.5">
                              <ArrowUpRight className="w-3 h-3" />
                              {market.supplyAPY.toFixed(2)}%
                            </span>
                          ) : (
                            <span className={isDark ? "text-slate-600" : "text-gray-300"}>—</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Borrow APY</div>
                        <div className="text-sm font-bold">
                          {market.variableBorrowAPY != null ? (
                            <span className="text-amber-400 flex items-center gap-0.5">
                              <ArrowDownRight className="w-3 h-3" />
                              {market.variableBorrowAPY.toFixed(2)}%
                            </span>
                          ) : (
                            <span className={isDark ? "text-slate-600" : "text-gray-300"}>—</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Utilization</div>
                        <div className="text-sm font-bold">
                          {market.utilization != null ? (
                            <span>{market.utilization}%</span>
                          ) : (
                            <span className={isDark ? "text-slate-600" : "text-gray-300"}>—</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Desktop: Supply APY */}
                    <div className="hidden md:flex col-span-2 items-center justify-end">
                      {market.supplyAPY != null ? (
                        <span className="font-bold text-sm text-emerald-400 flex items-center gap-0.5">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          {market.supplyAPY.toFixed(2)}%
                        </span>
                      ) : (
                        <span className={`text-sm ${isDark ? "text-slate-600" : "text-gray-300"}`}>—</span>
                      )}
                    </div>

                    {/* Desktop: Borrow APY */}
                    <div className="hidden md:flex col-span-2 items-center justify-end">
                      {market.variableBorrowAPY != null ? (
                        <span className="font-bold text-sm text-amber-400 flex items-center gap-0.5">
                          <ArrowDownRight className="w-3.5 h-3.5" />
                          {market.variableBorrowAPY.toFixed(2)}%
                        </span>
                      ) : (
                        <span className={`text-sm ${isDark ? "text-slate-600" : "text-gray-300"}`}>—</span>
                      )}
                    </div>

                    {/* Desktop: Utilization */}
                    <div className="hidden md:flex col-span-2 items-center justify-end gap-2">
                      {market.utilization != null ? (
                        <>
                          <div className={`w-16 h-1.5 rounded-full overflow-hidden ${isDark ? "bg-slate-800" : "bg-gray-200"}`}>
                            <div
                              className={`h-full rounded-full ${
                                market.utilization > 80 ? "bg-red-500" : market.utilization > 50 ? "bg-amber-500" : "bg-teal-500"
                              }`}
                              style={{ width: `${market.utilization}%` }}
                            />
                          </div>
                          <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{market.utilization}%</span>
                        </>
                      ) : (
                        <span className={`text-sm ${isDark ? "text-slate-600" : "text-gray-300"}`}>—</span>
                      )}
                    </div>

                    {/* Actions — all link to https://app.bonzo.finance/lend */}
                    <div className="md:col-span-3 flex items-center justify-center gap-2">
                      <a
                        href={market.supplyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-teal-500/20"
                      >
                        Supply <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href={market.borrowUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700" : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"}`}
                      >
                        Borrow <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              {/* Bonzo Info Footer */}
              <div className={`rounded-xl p-4 ${isDark ? "bg-slate-900/20 border border-slate-800" : "bg-gray-50 border border-gray-200"}`}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className={`p-3 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                    <div className="font-bold mb-1 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-teal-400" />
                      How Supply Works
                    </div>
                    <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                      Deposit assets into Bonzo lending pools to earn interest. Supply APY adjusts with pool utilization. Withdraw anytime.
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                    <div className="font-bold mb-1 flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5 text-amber-400" />
                      How Borrow Works
                    </div>
                    <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                      Supply collateral on Bonzo, then borrow other assets. Variable interest accrues per block. Keep your health factor above 1.0.
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                    <div className="font-bold mb-1 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-blue-400" />
                      Data Pipeline
                    </div>
                    <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                      {isBonzoConfigured()
                        ? "Live rates fetched from Bonzo's ProtocolDataProvider via Hedera Mirror Node."
                        : "Rates will activate when the ProtocolDataProvider contract address is configured in bonzo.ts."
                      }{" "}
                      <a href="https://github.com/Bonzo-Labs/bonzo-finance-contracts" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">
                        View contracts
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ STAKING TAB ═══ */}
      {activeTab === "staking" && (
        <div className="space-y-4">
          {/* Staking Info */}
          <div className={`rounded-xl p-4 flex items-start gap-3 ${isDark ? "bg-purple-500/5 border border-purple-500/20" : "bg-purple-50 border border-purple-200"}`}>
            <Shield className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-sm mb-0.5">Stake & Earn</div>
              <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Stake HBAR or HBAR.ħ tokens to earn passive rewards. Longer lock periods will offer higher APY. Native Hedera staking is secured by the network consensus.
              </div>
            </div>
          </div>

          {/* Activation Status Banner */}
          {stakingStats && stakingStats.dataSource === "pending" && (
            <div className={`rounded-xl p-4 flex items-start gap-3 ${isDark ? "bg-amber-500/5 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
              <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-sm mb-0.5">Pools Pending Activation</div>
                <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Staking contracts are being finalized. Pool structures are confirmed — live APY, capacity, and staking will activate once the backend is connected. Check back soon.
                </div>
              </div>
            </div>
          )}

          {/* Staking Pool Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stakingPools.map((pool) => (
              <div key={pool.id} className={`rounded-xl p-4 md:p-5 ${cardClass} transition-all`}>
                <div className="flex items-center gap-3 mb-4">
                  <img
                    src={pool.logo}
                    alt={pool.token}
                    className="w-10 h-10 rounded-full"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                  <div className="flex-1">
                    <div className="font-bold">{pool.name}</div>
                    <div className={`text-xs flex items-center gap-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      <span className="flex items-center gap-1"><Lock className="w-3 h-3" />{pool.lockPeriod}</span>
                      {pool.minStake != null && (
                        <>
                          <span>|</span>
                          <span>Min: {formatCompact(pool.minStake)} {pool.token}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {pool.apy != null ? (
                      <>
                        <div className="text-2xl font-bold text-emerald-400">{pool.apy}%</div>
                        <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>APY</div>
                      </>
                    ) : (
                      <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${isDark ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-600 border border-amber-200"}`}>
                        PENDING
                      </span>
                    )}
                  </div>
                </div>

                {/* Pool Details */}
                <div className={`p-3 rounded-lg mb-4 ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Rewards</span>
                      <span>{pool.rewardTokens}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Lock</span>
                      <span>{pool.lockPeriod}</span>
                    </div>
                    {pool.totalStaked != null && (
                      <div className="flex justify-between col-span-2">
                        <span className={isDark ? "text-slate-400" : "text-gray-500"}>Total Staked</span>
                        <span className="font-bold">{formatCompact(pool.totalStaked)} {pool.token}</span>
                      </div>
                    )}
                    {pool.stakerCount != null && (
                      <div className="flex justify-between col-span-2">
                        <span className={isDark ? "text-slate-400" : "text-gray-500"}>Stakers</span>
                        <span>{pool.stakerCount.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Capacity Bar (only when live data available) */}
                {pool.totalStaked != null && pool.totalStakedUSD != null && (
                  <div className="mb-4">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Total Staked</span>
                      <span className="font-bold">{formatUsd(pool.totalStakedUSD)}</span>
                    </div>
                    <div className={`h-2 rounded-full overflow-hidden ${isDark ? "bg-slate-800" : "bg-gray-200"}`}>
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                        style={{ width: `${Math.min((pool.totalStaked / 500_000_000) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    disabled={pool.status === "pending"}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-bold transition-all ${
                      pool.status === "pending"
                        ? isDark
                          ? "bg-slate-800/50 text-slate-600 cursor-not-allowed border border-slate-700/50"
                          : "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                        : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/20"
                    }`}
                  >
                    {pool.status === "pending" ? "Coming Soon" : `Stake ${pool.token}`}
                  </button>
                  <button
                    disabled={pool.status === "pending"}
                    className={`px-3 py-2.5 rounded-lg text-sm font-bold transition-all ${
                      pool.status === "pending"
                        ? isDark
                          ? "bg-slate-800/50 text-slate-600 cursor-not-allowed border border-slate-700/50"
                          : "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                        : isDark
                          ? "bg-slate-800 hover:bg-slate-700 text-slate-300"
                          : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                    }`}
                  >
                    Unstake
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Staking FAQ */}
          <div className={`rounded-xl p-5 ${cardClass}`}>
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Info className="w-4 h-4 text-purple-400" />
              Staking FAQ
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {[
                { q: "When will staking go live?", a: "Staking pools are being finalized and will activate once smart contracts are deployed and audited on Hedera mainnet." },
                { q: "Can I unstake early?", a: "Flexible staking has no lock period. Locked staking will incur a penalty on rewards if unstaked before the lock period ends." },
                { q: "What is HBAR.ħ?", a: "HBAR.ħ is the HBAR.ħ governance and reward token. It's earned through staking, farming, and DAO participation." },
                { q: "Is staking safe?", a: "Staking will be secured by audited smart contracts on the Hedera network. Always do your own research before staking." },
              ].map((faq) => (
                <div key={faq.q} className={`p-3 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                  <div className="font-bold mb-1">{faq.q}</div>
                  <div className={isDark ? "text-slate-400" : "text-gray-500"}>{faq.a}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Wallet Connect Modal */}
      {showWalletModal && <WalletConnectModal onClose={() => setShowWalletModal(false)} />}
    </div>
  );
}
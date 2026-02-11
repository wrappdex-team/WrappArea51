import {
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import {
  ArrowDownUp,
  ArrowRightLeft,
  BarChart2,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Droplets,
  Info,
  Layers,
  Lock,
  RefreshCw,
  Search,
  Shield,
  TrendingUp,
  X,
  Zap,
  Crown,
  AlertCircle,
  Plus,
  Globe,
  ExternalLink,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { isVipEligible } from "../utils/vip";
import { GATE_THRESHOLD, formatTokenCount } from "../utils/dao";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import {
  fetchPools,
  getPoolStats,
  refreshOracles,
  getSwapQuote,
  executeSwap,
  formatUsd,
  formatFeeBps,
  timeSince,
  WRAPPED_TOKENS,
  type LiquidityPool,
  type PoolStats,
  type SwapQuote,
} from "../utils/smart-liquidity";
import {
  getOrderbook,
  getOrderbookStats,
  recordTrade,
  type OrderbookEntry,
  type OrderbookStats,
} from "../utils/orderbook";
import { PoolCreator } from "./PoolCreator";

// ── Weight Bar ──────────────────────────────────────────────────────

function WeightBar({ tokens, isDark }: { tokens: LiquidityPool["tokens"]; isDark: boolean }) {
  const colors = [
    "bg-pink-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500",
    "bg-purple-500", "bg-cyan-500", "bg-rose-500", "bg-teal-500",
    "bg-indigo-500", "bg-orange-500",
  ];

  return (
    <div className="w-full">
      <div className="flex rounded-full h-2 overflow-hidden">
        {tokens.map((token, i) => (
          <div
            key={token.tokenId}
            className={`${colors[i % colors.length]} transition-all duration-500`}
            style={{ width: `${token.currentWeightBps / 100}%` }}
            title={`${token.symbol}: ${(token.currentWeightBps / 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {tokens.map((token, i) => (
          <div key={token.tokenId} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`} />
            <span className={`text-[10px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              {token.symbol} {(token.currentWeightBps / 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Swap Modal ──────────────────────────────────────────────────────

function SwapModal({
  pool,
  isDark,
  wallet,
  onClose,
}: {
  pool: LiquidityPool;
  isDark: boolean;
  wallet: string | null;
  onClose: () => void;
}) {
  const [tokenInIdx, setTokenInIdx] = useState(0);
  const [tokenOutIdx, setTokenOutIdx] = useState(pool.tokens.length > 1 ? 1 : 0);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [status, setStatus] = useState<"idle" | "quoting" | "swapping" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const tokenIn = pool.tokens[tokenInIdx];
  const tokenOut = pool.tokens[tokenOutIdx];

  const inputClass = isDark
    ? "bg-slate-800/50 border border-pink-500/10"
    : "bg-gray-50 border border-gray-200";

  useEffect(() => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setQuote(null); return; }

    setStatus("quoting");
    getSwapQuote(pool.id, tokenIn.symbol, tokenOut.symbol, amt).then((q) => {
      setQuote(q);
      setStatus(q ? "idle" : "error");
      if (!q) setError("Unable to get quote");
    });
  }, [amount, tokenInIdx, tokenOutIdx, pool.id, tokenIn.symbol, tokenOut.symbol]);

  const handleSwap = async () => {
    if (!quote) return;
    setStatus("swapping");
    setError(null);

    const result = await executeSwap(quote);
    if (result.success) {
      // Record in site orderbook
      if (wallet) {
        recordTrade({
          wallet,
          side: "buy",
          tokenIn: quote.tokenIn,
          tokenOut: quote.tokenOut,
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          priceUsd: pool.tokens.find(t => t.symbol === quote.tokenOut)?.oraclePriceUsd || 0,
          route: quote.route,
          router: "smart-liquidity",
          transactionId: result.transactionId,
          status: "confirmed",
          slippageBps: quote.priceImpactBps,
        });
      }
      setStatus("success");
      setTimeout(onClose, 2000);
    } else {
      setError(result.error || "Swap failed");
      setStatus("error");
    }
  };

  const flipTokens = () => {
    setTokenInIdx(tokenOutIdx);
    setTokenOutIdx(tokenInIdx);
    setAmount("");
    setQuote(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-md mx-4 rounded-2xl p-6 ${
        isDark ? "bg-[#12121a] border border-pink-500/30" : "bg-white border border-gray-200 shadow-2xl"
      }`}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold">Smart Swap</h3>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {pool.name} &middot; USDC Routed
              </p>
            </div>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Token In */}
        <div className={`rounded-xl p-4 mb-2 ${inputClass}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>You Pay</span>
            <div className="flex items-center gap-1.5">
              <img src={tokenIn.logo} alt={tokenIn.symbol} className="w-4 h-4 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <select
                value={tokenInIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setTokenInIdx(idx);
                  if (idx === tokenOutIdx) setTokenOutIdx(tokenInIdx);
                }}
                className={`text-xs px-2 py-1 rounded-lg outline-none ${
                  isDark ? "bg-slate-700/50 text-white" : "bg-white text-gray-900 border border-gray-200"
                }`}
              >
                {pool.tokens.map((t, i) => (
                  <option key={t.tokenId} value={i}>{t.symbol}</option>
                ))}
              </select>
            </div>
          </div>
          <input
            type="number"
            placeholder="0.00"
            className="w-full bg-transparent outline-none text-2xl"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            Price: ${tokenIn.oraclePriceUsd.toFixed(tokenIn.oraclePriceUsd < 0.01 ? 6 : 2)}
            <span className={`ml-2 ${tokenIn.oracleSource === "saucerswap" ? "text-emerald-400" : "text-amber-400"}`}>
              {tokenIn.oracleSource === "saucerswap" ? "Live" : "Fallback"}
            </span>
          </div>
        </div>

        {/* Flip */}
        <div className="flex justify-center -my-1 relative z-10">
          <button
            onClick={flipTokens}
            className={`p-2 rounded-full border transition-colors ${
              isDark
                ? "bg-slate-800 border-pink-500/20 hover:border-pink-500/50 text-pink-400"
                : "bg-white border-gray-200 hover:border-pink-300 text-pink-500 shadow-sm"
            }`}
          >
            <ArrowDownUp className="w-4 h-4" />
          </button>
        </div>

        {/* Token Out */}
        <div className={`rounded-xl p-4 mt-2 mb-4 ${inputClass}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>You Receive</span>
            <div className="flex items-center gap-1.5">
              <img src={tokenOut.logo} alt={tokenOut.symbol} className="w-4 h-4 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <select
                value={tokenOutIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setTokenOutIdx(idx);
                  if (idx === tokenInIdx) setTokenInIdx(tokenOutIdx);
                }}
                className={`text-xs px-2 py-1 rounded-lg outline-none ${
                  isDark ? "bg-slate-700/50 text-white" : "bg-white text-gray-900 border border-gray-200"
                }`}
              >
                {pool.tokens.map((t, i) => (
                  <option key={t.tokenId} value={i}>{t.symbol}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="text-2xl">
            {quote ? quote.amountOut.toFixed(quote.amountOut >= 1 ? 4 : 8) : "0.00"}
          </div>
          {quote && (
            <div className={`text-xs mt-1 flex items-center gap-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {quote.oracleAnchored ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Zero Slippage (Oracle)
                </span>
              ) : (
                <span>Impact: {(quote.priceImpactBps / 100).toFixed(2)}%</span>
              )}
              <span>Fee: {formatFeeBps(quote.feeBps)}</span>
            </div>
          )}
        </div>

        {/* Quote Details */}
        {quote && (
          <div className={`rounded-xl p-3 mb-4 text-xs space-y-1.5 ${inputClass}`}>
            <div className="flex items-center justify-between">
              <span className={isDark ? "text-slate-400" : "text-gray-500"}>Route</span>
              <span className="text-pink-400">{quote.route}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={isDark ? "text-slate-400" : "text-gray-500"}>Rate</span>
              <span>1 {tokenIn.symbol} = {quote.effectiveRate.toFixed(quote.effectiveRate < 0.01 ? 6 : 4)} {tokenOut.symbol}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={isDark ? "text-slate-400" : "text-gray-500"}>Pricing</span>
              <span className={quote.oracleAnchored ? "text-emerald-400" : "text-blue-400"}>
                {quote.oracleAnchored ? "Oracle-Anchored" : "AMM Fallback"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={isDark ? "text-slate-400" : "text-gray-500"}>Fee</span>
              <span>${quote.feeUsd.toFixed(4)}</span>
            </div>
          </div>
        )}

        {error && (
          <div className={`mb-4 flex items-center gap-2 text-xs p-3 rounded-lg ${
            isDark ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"
          }`}>
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={handleSwap}
          disabled={!quote || !wallet || status === "swapping" || status === "success"}
          className={`w-full py-3.5 rounded-xl font-bold transition-all duration-300 text-white ${
            status === "swapping"
              ? "bg-gradient-to-r from-amber-600 to-yellow-500 opacity-80 cursor-wait"
              : status === "success"
              ? "bg-gradient-to-r from-emerald-600 to-green-500"
              : !quote || !wallet
              ? "bg-slate-600 opacity-50 cursor-not-allowed"
              : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-lg shadow-pink-500/30"
          }`}
        >
          {status === "swapping" ? (
            <div className="flex items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" />
              Executing...
            </div>
          ) : status === "success" ? (
            <div className="flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              Swap Successful!
            </div>
          ) : !wallet ? (
            "Connect Wallet"
          ) : (
            <div className="flex items-center justify-center gap-2">
              <ArrowRightLeft className="w-5 h-5" />
              Swap via Smart Liquidity
            </div>
          )}
        </button>

        <div className={`mt-3 flex items-center justify-center gap-2 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          <Shield className="w-3 h-3" />
          <span>USDC-routed &middot; Oracle-anchored pricing &middot; Ready to go live</span>
        </div>
      </div>
    </div>
  );
}

// ── Orderbook Panel ─────────────────────────────────────────────────

function OrderbookPanel({ isDark }: { isDark: boolean }) {
  const [trades, setTrades] = useState<OrderbookEntry[]>([]);
  const [stats, setStats] = useState<OrderbookStats | null>(null);

  useEffect(() => {
    const load = () => {
      setTrades(getOrderbook(25));
      setStats(getOrderbookStats());
    };
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  const cardClass = isDark
    ? "bg-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  return (
    <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
      <div className={`px-4 py-3 border-b ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
            <span className="font-bold text-sm">Site Orderbook</span>
          </div>
          {stats && (
            <div className={`flex items-center gap-3 text-[10px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              <span>{stats.totalTrades} trades</span>
              <span>{stats.uniqueWallets} wallets</span>
              <span>24h: {formatUsd(stats.volume24hUsd)}</span>
            </div>
          )}
        </div>
      </div>

      {trades.length === 0 ? (
        <div className={`px-4 py-8 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">No trades yet — connect your wallet and swap to populate the orderbook</p>
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className={`sticky top-0 ${isDark ? "bg-slate-900/90" : "bg-gray-50"}`}>
              <tr className={isDark ? "text-slate-500" : "text-gray-400"}>
                <th className="px-3 py-2 text-left font-normal">Time</th>
                <th className="px-3 py-2 text-left font-normal">Wallet</th>
                <th className="px-3 py-2 text-left font-normal">Pair</th>
                <th className="px-3 py-2 text-right font-normal">In</th>
                <th className="px-3 py-2 text-right font-normal">Out</th>
                <th className="px-3 py-2 text-right font-normal">Route</th>
                <th className="px-3 py-2 text-center font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr
                  key={trade.id}
                  className={`border-t ${isDark ? "border-slate-800/50 hover:bg-slate-800/30" : "border-gray-50 hover:bg-gray-50"}`}
                >
                  <td className={`px-3 py-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {trade.wallet.length > 12
                      ? `${trade.wallet.slice(0, 6)}...${trade.wallet.slice(-4)}`
                      : trade.wallet}
                  </td>
                  <td className="px-3 py-2 font-bold">
                    {trade.tokenIn}/{trade.tokenOut}
                  </td>
                  <td className={`px-3 py-2 text-right ${isDark ? "text-red-400" : "text-red-600"}`}>
                    -{trade.amountIn.toFixed(trade.amountIn >= 1 ? 2 : 6)} {trade.tokenIn}
                  </td>
                  <td className={`px-3 py-2 text-right ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                    +{trade.amountOut.toFixed(trade.amountOut >= 1 ? 2 : 6)} {trade.tokenOut}
                  </td>
                  <td className={`px-3 py-2 text-right ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {trade.route}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {trade.status === "confirmed" ? (
                      <span className="text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5 inline" />
                      </span>
                    ) : trade.status === "pending" ? (
                      <span className="text-amber-400">
                        <RefreshCw className="w-3.5 h-3.5 inline animate-spin" />
                      </span>
                    ) : (
                      <span className="text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 inline" />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function SmartLiquidity() {
  const { isDark } = useTheme();
  const { hederaAccount, hederaNetwork, hashPackSession } = useWallet();

  const [pools, setPools] = useState<LiquidityPool[]>([]);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [search, setSearch] = useState("");
  const [expandedPool, setExpandedPool] = useState<string | null>(null);
  const [swapPool, setSwapPool] = useState<LiquidityPool | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pools" | "orderbook" | "create">("pools");
  const [oracleRefreshing, setOracleRefreshing] = useState(false);
  const [serverPrices, setServerPrices] = useState<Record<string, number> | null>(null);

  const accountId = hashPackSession?.accountId || null;

  // Fetch live prices from server backend (supplements client oracle)
  useEffect(() => {
    const fetchServerPrices = async () => {
      try {
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-54299934/pools/prices`,
          { headers: { Authorization: `Bearer ${publicAnonKey}` } }
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.prices) setServerPrices(data.prices);
        }
      } catch { /* non-critical — client oracle is primary */ }
    };
    fetchServerPrices();
    const iv = setInterval(fetchServerPrices, 60000);
    return () => clearInterval(iv);
  }, []);

  // Enrich pools with server-backed prices when available
  const enrichedPools = useMemo(() => {
    if (!serverPrices || pools.length === 0) return pools;
    return pools.map((pool) => ({
      ...pool,
      tokens: pool.tokens.map((token) => {
        const serverPrice = serverPrices[token.tokenId];
        // Only apply server price if it's valid and the token currently has fallback pricing
        if (serverPrice && serverPrice > 0 && token.oracleSource === "fallback") {
          return {
            ...token,
            oraclePriceUsd: serverPrice,
            oracleSource: "saucerswap" as const,
            oracleTimestamp: Math.floor(Date.now() / 1000),
          };
        }
        return token;
      }),
    }));
  }, [pools, serverPrices]);

  const isVip = useMemo(() => {
    if (!hederaAccount?.tokens) return false;
    return isVipEligible(hederaAccount.tokens, hederaNetwork);
  }, [hederaAccount?.tokens, hederaNetwork]);

  const loadData = useCallback(async () => {
    const [poolData, statsData] = await Promise.all([
      fetchPools(),
      getPoolStats(),
    ]);
    setPools(poolData);
    setStats(statsData);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 30000);
    return () => clearInterval(iv);
  }, [loadData]);

  // Auto-refresh oracle prices
  useEffect(() => {
    const iv = setInterval(async () => {
      await refreshOracles();
      loadData();
    }, 60000);
    return () => clearInterval(iv);
  }, [loadData]);

  const handleOracleRefresh = useCallback(async () => {
    setOracleRefreshing(true);
    await refreshOracles();
    await loadData();
    setOracleRefreshing(false);
  }, [loadData]);

  const filteredPools = useMemo(() => {
    if (!search) return enrichedPools;
    const q = search.toLowerCase();
    return enrichedPools.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.tokens.some((t) => t.symbol.toLowerCase().includes(q))
    );
  }, [enrichedPools, search]);

  const cardClass = isDark
    ? "bg-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  const inputClass = isDark
    ? "bg-slate-800/50 border border-pink-500/10"
    : "bg-gray-50 border border-gray-200";

  // VIP Gate
  if (!isVip) {
    return (
      <div className="min-h-[calc(100vh-140px)] flex items-center justify-center p-4">
        <div className={`max-w-lg w-full rounded-2xl p-8 text-center ${cardClass}`}>
          <div className={`w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center ${
            isDark
              ? "bg-gradient-to-br from-pink-500/20 to-purple-500/20 border border-pink-500/30"
              : "bg-gradient-to-br from-pink-50 to-purple-50 border border-pink-200"
          }`}>
            <Lock className={`w-10 h-10 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
          </div>
          <h1 className="text-2xl font-bold mb-2 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
            VIP Access Required
          </h1>
          <p className={`mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Smart Liquidity pools require VIP status to access.
          </p>
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm ${
            isDark
              ? "bg-slate-800/50 border border-pink-500/10 text-slate-300"
              : "bg-gray-50 border border-gray-200 text-gray-600"
          }`}>
            <Crown className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
            Hold {formatTokenCount(GATE_THRESHOLD)} HBAR.ħ tokens
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Layers className="w-6 h-6 text-pink-400" />
            Smart Liquidity
          </h1>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Trade WBTC, WETH, LINK, WPOL, USDC, USDT — USDC-routed with oracle pricing
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border ${
            isDark
              ? "bg-emerald-900/15 border-emerald-500/20 text-emerald-400"
              : "bg-emerald-50 border-emerald-200 text-emerald-700"
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Ready to Fill
          </div>
          <button
            onClick={handleOracleRefresh}
            disabled={oracleRefreshing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              isDark
                ? "bg-slate-800/50 border-pink-500/10 text-slate-300 hover:text-white"
                : "bg-gray-100 border-gray-200 text-gray-600 hover:text-gray-900"
            }`}
          >
            <RefreshCw className={`w-3 h-3 ${oracleRefreshing ? "animate-spin" : ""}`} />
            Refresh Oracles
          </button>
        </div>
      </div>

      {/* Oracle Info Banner */}
      <div className={`rounded-xl p-4 border ${
        isDark
          ? "bg-gradient-to-r from-blue-900/10 to-purple-900/10 border-blue-500/20 backdrop-blur-sm"
          : "bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200"
      }`}>
        <div className="flex items-start gap-3">
          <Info className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
          <div>
            <div className="text-sm font-bold mb-1">Wrapped Pair Trading — USDC-Routed Oracle Pricing</div>
            <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Trade the top HashPort-bridged assets on Hedera: <strong>WBTC, WETH, LINK, WPOL, USDC, USDT</strong>.
              Every swap routes through USDC for price stability. Oracle prices
              from SaucerSwap&apos;s live API enable zero-slippage execution.
              When oracles are stale, the weighted constant-product AMM provides
              fallback pricing. All token IDs are verified on HashScan mainnet.
            </div>
          </div>
        </div>
      </div>

      {/* Wrapped Token Ticker */}
      <div className={`rounded-xl p-3 border overflow-hidden ${cardClass}`}>
        <div className={`flex items-center gap-2 mb-2 text-xs font-bold ${isDark ? "text-slate-300" : "text-gray-700"}`}>
          <Globe className="w-3.5 h-3.5" />
          Tradeable Wrapped Pairs on Hedera
          {serverPrices && (
            <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded ${isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"}`}>
              Server-backed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 overflow-x-auto pb-1">
          {enrichedPools.length > 0
            ? (() => {
                // Deduplicate tokens across all pools by tokenId
                const seen = new Set<string>();
                const unique: typeof enrichedPools[0]["tokens"] = [];
                for (const pool of enrichedPools) {
                  for (const t of pool.tokens) {
                    if (!seen.has(t.tokenId)) {
                      seen.add(t.tokenId);
                      unique.push(t);
                    }
                  }
                }
                return unique.map((token) => (
                  <div
                    key={token.tokenId}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg flex-shrink-0 border ${
                      isDark ? "bg-slate-800/50 border-pink-500/10" : "bg-white border-gray-200"
                    }`}
                  >
                    <img
                      src={token.logo}
                      alt={token.symbol}
                      className="w-5 h-5 rounded-full"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1">
                        {token.symbol}
                        {token.bridge && (
                          <span className={`text-[8px] px-1 rounded ${isDark ? "bg-blue-500/10 text-blue-400" : "bg-blue-50 text-blue-600"}`}>
                            {token.bridge}
                          </span>
                        )}
                      </div>
                      <div className={`text-[10px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        ${token.oraclePriceUsd >= 1
                          ? token.oraclePriceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : token.oraclePriceUsd.toFixed(4)
                        }
                        <span className={`ml-1 ${token.oracleSource === "saucerswap" ? "text-emerald-400" : "text-amber-400"}`}>
                          {token.oracleSource === "saucerswap" ? "Live" : "Fallback"}
                        </span>
                      </div>
                    </div>
                    <a
                      href={`https://hashscan.io/mainnet/token/${token.tokenId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`ml-1 ${isDark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ));
              })()
            : WRAPPED_TOKENS.map((t) => (
                <div
                  key={t.tokenId}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg flex-shrink-0 border ${
                    isDark ? "bg-slate-800/50 border-pink-500/10" : "bg-white border-gray-200"
                  }`}
                >
                  <img src={t.logo} alt={t.symbol} className="w-5 h-5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div>
                    <div className="text-xs font-bold">{t.symbol}</div>
                    <div className={`text-[10px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      ${t.fallbackPrice >= 1 ? t.fallbackPrice.toLocaleString() : t.fallbackPrice.toFixed(4)}
                    </div>
                  </div>
                </div>
              ))
          }
        </div>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total TVL", value: formatUsd(stats.totalTvlUsd), icon: <Droplets className="w-4 h-4" /> },
            { label: "Pools Ready", value: stats.poolsReady.toString(), icon: <Layers className="w-4 h-4" /> },
            { label: "Total Volume", value: formatUsd(stats.totalVolumeUsd), icon: <BarChart2 className="w-4 h-4" /> },
            { label: "Avg Fee", value: formatFeeBps(stats.avgFeeBps), icon: <Zap className="w-4 h-4" /> },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-xl p-3 border ${cardClass}`}>
              <div className={`flex items-center gap-1.5 text-xs mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {stat.icon}
                {stat.label}
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs: Pools / Orderbook / Create Pool */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab("pools")}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
            activeTab === "pools"
              ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
              : isDark
              ? "bg-slate-800/50 text-slate-400 hover:text-white border border-pink-500/10"
              : "bg-gray-100 text-gray-600 hover:text-gray-900 border border-gray-200"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Layers className="w-4 h-4" />
            Index Pools
          </div>
        </button>
        <button
          onClick={() => setActiveTab("create")}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
            activeTab === "create"
              ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
              : isDark
              ? "bg-slate-800/50 text-slate-400 hover:text-white border border-pink-500/10"
              : "bg-gray-100 text-gray-600 hover:text-gray-900 border border-gray-200"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            Create Pool
          </div>
        </button>
        <button
          onClick={() => setActiveTab("orderbook")}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
            activeTab === "orderbook"
              ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
              : isDark
              ? "bg-slate-800/50 text-slate-400 hover:text-white border border-pink-500/10"
              : "bg-gray-100 text-gray-600 hover:text-gray-900 border border-gray-200"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <BookOpen className="w-4 h-4" />
            Site Orderbook
          </div>
        </button>
      </div>

      {activeTab === "orderbook" ? (
        <OrderbookPanel isDark={isDark} />
      ) : activeTab === "create" ? (
        <PoolCreator />
      ) : (
        <>
          {/* Search */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${inputClass}`}>
            <Search className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
            <input
              type="text"
              placeholder="Search pools or tokens..."
              className="bg-transparent outline-none text-sm flex-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Pool Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className={`w-6 h-6 animate-spin ${isDark ? "text-slate-500" : "text-gray-400"}`} />
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPools.map((pool) => {
                const isExpanded = expandedPool === pool.id;

                return (
                  <div key={pool.id} className={`rounded-xl border overflow-hidden transition-all ${cardClass}`}>
                    {/* Pool Header */}
                    <button
                      onClick={() => setExpandedPool(isExpanded ? null : pool.id)}
                      className="w-full p-4 flex items-center gap-4 text-left"
                    >
                      {/* Stacked token logos */}
                      <div className="flex -space-x-2 flex-shrink-0">
                        {pool.tokens.slice(0, 4).map((t) => (
                          <img
                            key={t.tokenId}
                            src={t.logo}
                            alt={t.symbol}
                            className="w-8 h-8 rounded-full border-2 border-slate-900 bg-slate-800"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ))}
                        {pool.tokens.length > 4 && (
                          <div className={`w-8 h-8 rounded-full border-2 border-slate-900 flex items-center justify-center text-[10px] font-bold ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-200 text-gray-600"}`}>
                            +{pool.tokens.length - 4}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{pool.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            pool.status === "active"
                              ? isDark ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-emerald-700 bg-emerald-50 border-emerald-200"
                              : isDark ? "text-blue-400 bg-blue-500/10 border-blue-500/20" : "text-blue-700 bg-blue-50 border-blue-200"
                          }`}>
                            {pool.status === "active" ? "Live" : "Ready"}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            isDark ? "text-purple-400 bg-purple-500/10 border-purple-500/20" : "text-purple-700 bg-purple-50 border-purple-200"
                          }`}>
                            {pool.tokens.length} tokens
                          </span>
                        </div>
                        <div className={`flex items-center gap-3 mt-1 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          <span>{pool.tokens.map(t => t.symbol).join(" / ")}</span>
                          <span>Fee: {formatFeeBps(pool.swapFeeBps)}</span>
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-bold">{formatUsd(pool.totalValueUsd)}</div>
                        <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>TVL</div>
                      </div>

                      <ChevronDown className={`w-4 h-4 transition-transform flex-shrink-0 ${
                        isExpanded ? "rotate-180" : ""
                      } ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                    </button>

                    {/* Expanded */}
                    {isExpanded && (
                      <div className={`border-t px-4 pb-4 pt-3 ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
                        <p className={`text-xs mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {pool.description}
                        </p>

                        {/* Weight visualization */}
                        <div className="mb-4">
                          <div className={`text-xs font-bold mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                            Index Composition
                          </div>
                          <WeightBar tokens={pool.tokens} isDark={isDark} />
                        </div>

                        {/* Token table */}
                        <div className={`rounded-xl p-3 mb-4 ${inputClass}`}>
                          <div className="grid grid-cols-5 gap-2 text-[10px] font-bold mb-2">
                            <span className={isDark ? "text-slate-400" : "text-gray-500"}>Token</span>
                            <span className={`text-right ${isDark ? "text-slate-400" : "text-gray-500"}`}>Oracle Price</span>
                            <span className={`text-right ${isDark ? "text-slate-400" : "text-gray-500"}`}>Value</span>
                            <span className={`text-right ${isDark ? "text-slate-400" : "text-gray-500"}`}>Weight</span>
                            <span className={`text-right ${isDark ? "text-slate-400" : "text-gray-500"}`}>Source</span>
                          </div>
                          {pool.tokens.map((token) => {
                            const dev = token.currentWeightBps - token.targetWeightBps;
                            return (
                              <div
                                key={token.tokenId}
                                className={`grid grid-cols-5 gap-2 text-xs py-1.5 border-t ${
                                  isDark ? "border-slate-800/50" : "border-gray-100"
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <img src={token.logo} alt={token.symbol} className="w-4 h-4 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                  <span className="font-bold">{token.symbol}</span>
                                  {token.bridge && (
                                    <span className={`text-[8px] px-1 py-0.5 rounded ${isDark ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-600"}`}>
                                      {token.bridge}
                                    </span>
                                  )}
                                </div>
                                <div className="text-right">
                                  ${token.oraclePriceUsd.toFixed(token.oraclePriceUsd < 0.01 ? 6 : 2)}
                                </div>
                                <div className="text-right">
                                  {formatUsd(token.reserveUsd)}
                                </div>
                                <div className="text-right">
                                  {(token.currentWeightBps / 100).toFixed(1)}%
                                  <span className={`text-[10px] ml-0.5 ${
                                    dev > 0 ? "text-emerald-400" : dev < 0 ? "text-red-400" : ""
                                  }`}>
                                    {dev > 0 ? "+" : ""}{dev !== 0 ? `${(dev / 100).toFixed(1)}%` : ""}
                                  </span>
                                </div>
                                <div className={`text-right ${
                                  token.oracleSource === "saucerswap" ? "text-emerald-400" : "text-amber-400"
                                }`}>
                                  {token.oracleSource === "saucerswap" ? "Live" : "Fallback"}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Pool metadata */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                          {[
                            { label: "Volume", value: formatUsd(pool.cumulativeVolumeUsd) },
                            { label: "Swap Fee", value: formatFeeBps(pool.swapFeeBps) },
                            { label: "Max Deviation", value: `${(pool.maxDeviationBps / 100).toFixed(1)}%` },
                            { label: "Last Rebalance", value: timeSince(pool.lastRebalance) },
                          ].map((item) => (
                            <div key={item.label} className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              <span className="block text-[10px]">{item.label}</span>
                              <span className={`font-bold ${isDark ? "text-slate-200" : "text-gray-800"}`}>
                                {item.value}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => setSwapPool(pool)}
                            className="px-4 py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 rounded-lg text-sm font-bold transition-all duration-300 text-white shadow-lg shadow-pink-500/20"
                          >
                            <div className="flex items-center gap-1.5">
                              <ArrowRightLeft className="w-4 h-4" />
                              Swap
                            </div>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredPools.length === 0 && (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  <Droplets className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No pools match your search</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* USDC Routing Diagram */}
      <div className={`rounded-xl p-4 border ${cardClass}`}>
        <div className={`text-xs font-bold mb-3 flex items-center gap-1.5 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
          <TrendingUp className="w-3.5 h-3.5" />
          USDC Routing Architecture
        </div>
        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          <div className={`rounded-lg p-3 ${inputClass}`}>
            <div className={`font-bold mb-1 ${isDark ? "text-blue-400" : "text-blue-600"}`}>
              Oracle Pricing
            </div>
            <p>
              Live token prices from SaucerSwap&apos;s API, cached every 60s.
              Fresh oracles enable zero-slippage execution at the reference rate.
              Stale oracles (&gt;5 min) fall back to weighted AMM pricing.
            </p>
          </div>
          <div className={`rounded-lg p-3 ${inputClass}`}>
            <div className={`font-bold mb-1 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
              USDC Routing
            </div>
            <p>
              Every swap routes through USDC as the stable anchor:
              tokenA → USDC → tokenB. This ensures consistent pricing
              regardless of direct pair liquidity depth.
            </p>
          </div>
          <div className={`rounded-lg p-3 ${inputClass}`}>
            <div className={`font-bold mb-1 ${isDark ? "text-purple-400" : "text-purple-600"}`}>
              Index Rebalancing
            </div>
            <p>
              Pools auto-rebalance when any token drifts beyond its
              threshold. Currently trading: WBTC, WETH, LINK, WPOL,
              USDC, USDT. More bridged pairs added after testing.
            </p>
          </div>
        </div>
      </div>

      {/* Swap Modal */}
      {swapPool && (
        <SwapModal
          pool={swapPool}
          isDark={isDark}
          wallet={accountId}
          onClose={() => setSwapPool(null)}
        />
      )}
    </div>
  );
}
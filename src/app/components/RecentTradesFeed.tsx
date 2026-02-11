/**
 * Recent Trades Feed — compact display of the latest site-wide trades
 * from the orderbook. Shown on the Dashboard as a live activity feed.
 */

import { useState, useEffect } from "react";
import {
  Activity,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  ArrowRightLeft,
} from "lucide-react";
import { Link } from "react-router";
import { useTheme } from "../contexts/ThemeContext";
import {
  getOrderbook,
  getOrderbookStats,
  type OrderbookEntry,
  type OrderbookStats,
} from "../utils/orderbook";

function timeSince(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 10) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export function RecentTradesFeed() {
  const { isDark } = useTheme();
  const [trades, setTrades] = useState<OrderbookEntry[]>([]);
  const [stats, setStats] = useState<OrderbookStats | null>(null);

  useEffect(() => {
    const load = () => {
      setTrades(getOrderbook(10)); // Show last 10
      setStats(getOrderbookStats());
    };
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  const cardClass = isDark
    ? "bg-gradient-to-br from-slate-900/50 to-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  // Don't render if no trades at all
  if (trades.length === 0 && (!stats || stats.totalTrades === 0)) {
    return (
      <div className={`rounded-xl p-4 ${cardClass}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center">
            <Activity className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
          </div>
          <div>
            <div className="text-sm font-bold">Site Activity</div>
            <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Recent trades across all pairs
            </div>
          </div>
        </div>
        <div className={`text-center py-6 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          <ArrowRightLeft className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">No trades yet. Connect your wallet and swap to see activity here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl overflow-hidden ${cardClass}`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between border-b ${
        isDark ? "border-pink-500/10" : "border-gray-100"
      }`}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center">
            <Activity className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
          </div>
          <div>
            <div className="text-sm font-bold">Site Activity</div>
            {stats && (
              <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {stats.totalTrades} trades &middot; {stats.uniqueWallets} wallets
                {stats.volume24hUsd > 0 && (
                  <> &middot; 24h: ${stats.volume24hUsd >= 1000
                    ? `${(stats.volume24hUsd / 1000).toFixed(1)}K`
                    : stats.volume24hUsd.toFixed(2)}</>
                )}
              </div>
            )}
          </div>
        </div>
        <Link
          to="/smart-liquidity"
          className={`text-xs transition-colors ${
            isDark ? "text-pink-400 hover:text-pink-300" : "text-pink-600 hover:text-pink-500"
          }`}
        >
          View All
        </Link>
      </div>

      {/* Trade List */}
      <div className="divide-y divide-transparent">
        {trades.map((trade) => (
          <div
            key={trade.id}
            className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
              isDark ? "hover:bg-slate-800/30" : "hover:bg-gray-50"
            }`}
          >
            {/* Status icon */}
            <div className="flex-shrink-0">
              {trade.status === "confirmed" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : trade.status === "pending" ? (
                <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400" />
              )}
            </div>

            {/* Trade details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-bold">
                  {trade.tokenIn}
                </span>
                <ArrowRightLeft className={`w-3 h-3 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                <span className="font-bold">
                  {trade.tokenOut}
                </span>
                <span className={`text-[10px] px-1 py-0 rounded ${
                  isDark ? "bg-slate-800/50 text-slate-500" : "bg-gray-100 text-gray-400"
                }`}>
                  {trade.router === "saucerswap" ? "SauceSwap" :
                   trade.router === "hsuite" ? "HSuite" :
                   trade.router === "smart-liquidity" ? "Smart Liq" : trade.router}
                </span>
              </div>
              <div className={`text-[10px] flex items-center gap-2 mt-0.5 ${
                isDark ? "text-slate-500" : "text-gray-400"
              }`}>
                <span className="font-mono">{truncateWallet(trade.wallet)}</span>
                <span>&middot;</span>
                <span>{timeSince(trade.timestamp)}</span>
              </div>
            </div>

            {/* Amounts */}
            <div className="text-right flex-shrink-0">
              <div className={`text-xs ${isDark ? "text-red-400" : "text-red-600"}`}>
                -{trade.amountIn >= 1000
                  ? `${(trade.amountIn / 1000).toFixed(1)}K`
                  : trade.amountIn.toFixed(trade.amountIn >= 1 ? 2 : 4)} {trade.tokenIn}
              </div>
              <div className={`text-xs ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                +{trade.amountOut >= 1000
                  ? `${(trade.amountOut / 1000).toFixed(1)}K`
                  : trade.amountOut.toFixed(trade.amountOut >= 1 ? 2 : 4)} {trade.tokenOut}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer stats */}
      {stats && stats.topPair !== "—" && (
        <div className={`px-4 py-2 border-t text-[10px] flex items-center gap-3 ${
          isDark ? "border-pink-500/10 text-slate-500" : "border-gray-100 text-gray-400"
        }`}>
          <span>Top pair: <span className="font-bold">{stats.topPair}</span></span>
          {stats.avgSlippageBps > 0 && (
            <span>Avg slippage: {(stats.avgSlippageBps / 100).toFixed(2)}%</span>
          )}
        </div>
      )}
    </div>
  );
}

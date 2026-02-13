/**
 * Site Activity — Full-width live activity feed with admin controls.
 * Replaces the old PortfolioWidget + RecentTradesFeed dual panel.
 * Backend-ready: network-aware storage, admin reset for testnet/mainnet,
 * live data polling, and structured for future API integration.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Activity,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  ArrowRightLeft,
  Settings,
  Trash2,
  Download,
  ChevronDown,
  Database,
  Wifi,
  Clock,
  Shield,
  BarChart3,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import {
  getOrderbook,
  getOrderbookStats,
  clearOrderbook,
  clearAllOrderbooks,
  getActiveNetwork,
  setActiveNetwork,
  getStorageInfo,
  exportOrderbook,
  type OrderbookEntry,
  type OrderbookStats,
  type NetworkMode,
} from "../utils/orderbook";

// ── Helpers ──────────────────────────────────────────────────────────

function timeSince(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatVol(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

const ROUTER_LABELS: Record<string, { label: string; color: string; darkColor: string }> = {
  saucerswap: { label: "SauceSwap", color: "bg-purple-100 text-purple-700", darkColor: "bg-purple-500/15 text-purple-400" },
  hsuite: { label: "HSuite", color: "bg-blue-100 text-blue-700", darkColor: "bg-blue-500/15 text-blue-400" },
  "smart-liquidity": { label: "Smart Liq", color: "bg-teal-100 text-teal-700", darkColor: "bg-teal-500/15 text-teal-400" },
  changenow: { label: "ChangeNOW", color: "bg-green-100 text-green-700", darkColor: "bg-green-500/15 text-green-400" },
};

// ── Component ────────────────────────────────────────────────────────

export function SiteActivity() {
  const { isDark } = useTheme();
  const { hederaNetwork } = useWallet();

  const [trades, setTrades] = useState<OrderbookEntry[]>([]);
  const [stats, setStats] = useState<OrderbookStats | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminNetwork, setAdminNetwork] = useState<NetworkMode>(
    () => (getActiveNetwork() as NetworkMode)
  );
  const [storageInfo, setStorageInfo] = useState(getStorageInfo());
  const [confirmReset, setConfirmReset] = useState<"network" | "all" | null>(null);
  const [activityFilter, setActivityFilter] = useState<"all" | "confirmed" | "pending" | "failed">("all");

  // Sync orderbook network with Hedera network
  useEffect(() => {
    const net = hederaNetwork === "testnet" ? "testnet" : "mainnet";
    setActiveNetwork(net);
    setAdminNetwork(net);
  }, [hederaNetwork]);

  // Poll orderbook data
  const refreshData = useCallback(() => {
    // [AUDIT-AMM-04] Cap to 10 trades max for data minimization
    setTrades(getOrderbook(10));
    setStats(getOrderbookStats());
    setStorageInfo(getStorageInfo());
  }, []);

  useEffect(() => {
    refreshData();
    const iv = setInterval(refreshData, 3000);
    return () => clearInterval(iv);
  }, [refreshData]);

  // Admin actions
  const handleClearNetwork = () => {
    clearOrderbook(adminNetwork);
    setConfirmReset(null);
    refreshData();
  };

  const handleClearAll = () => {
    clearAllOrderbooks();
    setConfirmReset(null);
    refreshData();
  };

  const handleExport = () => {
    const data = exportOrderbook(adminNetwork);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hbarh-orderbook-${adminNetwork}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSwitchAdminNetwork = (net: NetworkMode) => {
    setAdminNetwork(net);
    setActiveNetwork(net);
    setConfirmReset(null);
    refreshData();
  };

  const filteredTrades = activityFilter === "all"
    ? trades
    : trades.filter(t => t.status === activityFilter);

  const cardClass = isDark
    ? "bg-[#0d0f1a]/80 border border-white/[0.06] backdrop-blur-xl"
    : "bg-white border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]";

  const isEmpty = trades.length === 0 && (!stats || stats.totalTrades === 0);

  return (
    <div className={`rounded-xl overflow-hidden ${cardClass}`}>
      {/* Header — always visible, acts as expand/collapse toggle */}
      <div
        className={`px-4 py-3 flex items-center justify-between cursor-pointer select-none transition-colors ${
          isExpanded
            ? isDark ? "border-b border-pink-500/10" : "border-b border-gray-100"
            : ""
        } ${!isExpanded ? (isDark ? "hover:bg-slate-800/20" : "hover:bg-gray-50") : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center">
            <Activity className={`w-4.5 h-4.5 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">Site Activity</span>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                       : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}>
                <Wifi className="w-2.5 h-2.5" />
                LIVE
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                isDark ? "bg-slate-700/50 text-slate-400" : "bg-gray-100 text-gray-500"
              }`}>
                {adminNetwork.toUpperCase()}
              </span>
            </div>
            {stats && (
              <div className={`text-[10px] flex items-center gap-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                <span>{stats.totalTrades} trades</span>
                <span>&middot;</span>
                <span>{stats.uniqueWallets} wallets</span>
                {stats.volume24hUsd > 0 && (
                  <>
                    <span>&middot;</span>
                    <span>24h: {formatVol(stats.volume24hUsd)}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isExpanded && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowAdmin(!showAdmin); }}
              className={`p-1.5 rounded-lg transition-colors ${
                showAdmin
                  ? isDark ? "bg-pink-500/20 text-pink-400" : "bg-pink-100 text-pink-600"
                  : isDark ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              }`}
              title="Admin Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
          <div className={`p-1 rounded transition-transform duration-300 ${
            isExpanded ? "rotate-180" : "rotate-0"
          } ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Collapsible Body */}
      {isExpanded && (<>

      {/* Admin Panel */}
      {showAdmin && (
        <div className={`px-4 py-3 border-b ${isDark ? "border-pink-500/10 bg-slate-900/30" : "border-gray-100 bg-gray-50"}`}>
          <div className="flex items-center gap-2 mb-3">
            <Shield className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
            <span className="text-xs font-bold">Admin Controls</span>
          </div>

          {/* Network Switcher */}
          <div className="flex items-center gap-3 mb-3">
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Network:</span>
            <div className="flex gap-1">
              {(["mainnet", "testnet"] as NetworkMode[]).map(net => (
                <button
                  key={net}
                  onClick={() => handleSwitchAdminNetwork(net)}
                  className={`px-2.5 py-1 rounded text-xs transition-all ${
                    adminNetwork === net
                      ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                      : isDark ? "text-slate-500 hover:text-white bg-slate-800/30" : "text-gray-400 hover:text-gray-700 bg-gray-100"
                  }`}
                >
                  {net.charAt(0).toUpperCase() + net.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Storage Info */}
          <div className={`flex items-center gap-4 mb-3 text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            <div className="flex items-center gap-1">
              <Database className="w-3 h-3" />
              <span>{storageInfo.entryCount} entries</span>
            </div>
            <span>{(storageInfo.sizeBytes / 1024).toFixed(1)} KB</span>
            <span className="font-mono">{storageInfo.key}</span>
          </div>

          {/* Router Breakdown */}
          {stats && Object.keys(stats.routerBreakdown).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {Object.entries(stats.routerBreakdown).map(([router, count]) => {
                const info = ROUTER_LABELS[router] || { label: router, color: "bg-gray-100 text-gray-600", darkColor: "bg-slate-700/50 text-slate-400" };
                return (
                  <span key={router} className={`px-1.5 py-0.5 rounded text-[10px] ${isDark ? info.darkColor : info.color}`}>
                    {info.label}: {count}
                  </span>
                );
              })}
            </div>
          )}

          {/* Status Breakdown */}
          {stats && (
            <div className="flex items-center gap-3 mb-3 text-[10px]">
              <span className="flex items-center gap-1 text-emerald-500">
                <CheckCircle2 className="w-3 h-3" /> {stats.confirmedCount} confirmed
              </span>
              <span className="flex items-center gap-1 text-amber-500">
                <Clock className="w-3 h-3" /> {stats.pendingCount} pending
              </span>
              <span className="flex items-center gap-1 text-red-500">
                <AlertCircle className="w-3 h-3" /> {stats.failedCount} failed
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExport}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                isDark ? "bg-slate-800/50 text-slate-300 hover:bg-slate-700 border border-slate-700/50" : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200"
              }`}
            >
              <Download className="w-3 h-3" /> Export JSON
            </button>

            {confirmReset === "network" ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-400">Clear {adminNetwork}?</span>
                <button onClick={handleClearNetwork} className="px-2 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-500">Confirm</button>
                <button onClick={() => setConfirmReset(null)} className={`px-2 py-1 rounded text-xs ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-200 text-gray-600"}`}>Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset("network")}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  isDark ? "bg-red-900/20 text-red-400 hover:bg-red-900/30 border border-red-500/20" : "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                }`}
              >
                <Trash2 className="w-3 h-3" /> Clear {adminNetwork}
              </button>
            )}

            {confirmReset === "all" ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-400">Clear ALL networks?</span>
                <button onClick={handleClearAll} className="px-2 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-500">Confirm</button>
                <button onClick={() => setConfirmReset(null)} className={`px-2 py-1 rounded text-xs ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-200 text-gray-600"}`}>Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset("all")}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  isDark ? "bg-red-900/30 text-red-400 hover:bg-red-900/40 border border-red-500/30" : "bg-red-100 text-red-700 hover:bg-red-200 border border-red-300"
                }`}
              >
                <Trash2 className="w-3 h-3" /> Clear All Networks
              </button>
            )}
          </div>
        </div>
      )}

      {/* Activity Stats Bar */}
      {stats && stats.totalTrades > 0 && (
        <div className={`px-4 py-2 flex items-center gap-3 flex-wrap border-b ${isDark ? "border-pink-500/5" : "border-gray-50"}`}>
          {/* Status filter pills */}
          {(["all", "confirmed", "pending", "failed"] as const).map(f => (
            <button
              key={f}
              onClick={() => setActivityFilter(f)}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                activityFilter === f
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                  : isDark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              {f === "confirmed" && stats ? ` (${stats.confirmedCount})` : ""}
              {f === "pending" && stats ? ` (${stats.pendingCount})` : ""}
              {f === "failed" && stats ? ` (${stats.failedCount})` : ""}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-3 text-[10px]">
            {stats.topPair !== "—" && (
              <span className={isDark ? "text-slate-500" : "text-gray-400"}>
                Top: <span className="font-bold">{stats.topPair}</span>
              </span>
            )}
            {stats.avgSlippageBps > 0 && (
              <span className={isDark ? "text-slate-500" : "text-gray-400"}>
                Slip: {(stats.avgSlippageBps / 100).toFixed(2)}%
              </span>
            )}
            {stats.trades24h > 0 && (
              <span className={isDark ? "text-slate-500" : "text-gray-400"}>
                24h: {stats.trades24h} trades
              </span>
            )}
          </div>
        </div>
      )}

      {/* Empty State */}
      {isEmpty && (
        <div className={`text-center py-10 px-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          <Activity className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm mb-1">No activity yet</p>
          <p className="text-xs">Trades from Swap, Trading, and Buy/Sell will appear here in real time.</p>
        </div>
      )}

      {/* Trade List */}
      {!isEmpty && (
        <div className="divide-y divide-transparent">
          {filteredTrades.map((trade) => {
            const routerInfo = ROUTER_LABELS[trade.router] || { label: trade.router, color: "bg-gray-100 text-gray-600", darkColor: "bg-slate-700/50 text-slate-400" };
            return (
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
                  <div className="flex items-center gap-1.5 text-xs flex-wrap">
                    <span className="font-bold">{trade.tokenIn}</span>
                    <ArrowRightLeft className={`w-3 h-3 flex-shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                    <span className="font-bold">{trade.tokenOut}</span>
                    <span className={`text-[10px] px-1 py-0 rounded ${isDark ? routerInfo.darkColor : routerInfo.color}`}>
                      {routerInfo.label}
                    </span>
                    {trade.side === "buy" && (
                      <span className={`text-[10px] px-1 py-0 rounded ${isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"}`}>BUY</span>
                    )}
                    {trade.side === "sell" && (
                      <span className={`text-[10px] px-1 py-0 rounded ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-600"}`}>SELL</span>
                    )}
                  </div>
                  <div className={`text-[10px] flex items-center gap-2 mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {/* [AUDIT-AMM-04] Wallet is anonymized — show truncated form */}
                    <span className="font-mono">{trade.wallet}</span>
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
            );
          })}
        </div>
      )}

      {/* Footer — Stats */}
      {!isEmpty && (
        <div className={`px-4 py-2.5 border-t flex items-center justify-end ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
          <div className={`flex items-center gap-3 text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            <span className="flex items-center gap-1">
              <BarChart3 className="w-3 h-3" />
              {adminNetwork}
            </span>
            <span>Last 10 trades · Auto-refresh 3s</span>
          </div>
        </div>
      )}

      </>)}
    </div>
  );
}
/**
 * V2PositionTracker — Concentrated Liquidity Position Dashboard
 *
 * Displays user's SaucerSwap V2 LP positions with real-time enrichment
 * from tick-math.ts computations. Each position card shows:
 *   - Token pair, fee tier, in-range indicator
 *   - Current value (USD) with token amount breakdown
 *   - Unclaimed fees with "Collect" quick action
 *   - Price range visualization
 *   - Expand for detailed view
 *
 * Auto-refreshes every 30s. Integrates with AddLiquidityV2Modal,
 * RemoveLiquidityV2Modal, and IncreaseLiquidityV2Modal.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Wallet,
  Droplets,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Minus,
  ExternalLink,
  TrendingUp,
  CircleDot,
  Gift,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import { TokenIcon } from "./TokenIcon";
import {
  fetchUserV2Positions,
  invalidatePositionCacheForAccount,
  type V2PositionEnriched,
} from "../utils/saucerswap/positions";
import {
  fetchLpHistory,
  actionLabel,
  timeAgo,
  hashScanTxUrl,
  type LpHistoryEntry,
} from "../utils/saucerswap/v2-lp-history";
import { SAUCERSWAP_V2_LP_NFT } from "../utils/saucerswap/contracts";

// ── Constants ────────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 30_000;

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  if (n > 0) return `<$0.01`;
  return "$0.00";
}

function formatAmount(n: number, decimals: number = 4): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(Math.min(decimals, 4));
  if (n >= 0.0001) return n.toFixed(6);
  if (n > 0) return n.toExponential(2);
  return "0";
}

function formatPrice(n: number): string {
  if (n >= 1_000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  if (n > 0) return n.toExponential(3);
  return "0";
}

interface V2PositionTrackerProps {
  /** Called when user clicks "Add Liquidity" on a position */
  onAddLiquidity?: (position: V2PositionEnriched) => void;
  /** Called when user clicks "Remove" on a position */
  onRemoveLiquidity?: (position: V2PositionEnriched) => void;
  /** Called when user clicks "Collect Fees" on a position */
  onCollectFees?: (position: V2PositionEnriched) => void;
}

export function V2PositionTracker({
  onAddLiquidity,
  onRemoveLiquidity,
  onCollectFees,
}: V2PositionTrackerProps) {
  const { isDark } = useTheme();
  const { primaryWallet, hederaAccount, hederaNetwork } = useWallet();

  const [positions, setPositions] = useState<V2PositionEnriched[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSN, setExpandedSN] = useState<number | null>(null);
  const [recentActivity, setRecentActivity] = useState<LpHistoryEntry[]>([]);
  const refreshRef = useRef<ReturnType<typeof setInterval>>();
  const accountId = hederaAccount?.accountId || primaryWallet?.accountId || "";

  const fetchPositions = useCallback(async (showLoader = true) => {
    if (!accountId) return;
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const data = await fetchUserV2Positions(accountId, hederaNetwork as any);
      setPositions(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }, [accountId, hederaNetwork]);

  // Initial fetch + auto-refresh
  useEffect(() => {
    if (!accountId) { setPositions([]); return; }
    fetchPositions(true);
    refreshRef.current = setInterval(() => fetchPositions(false), REFRESH_INTERVAL_MS);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [accountId, fetchPositions]);

  // Fetch recent LP activity
  useEffect(() => {
    if (!accountId) { setRecentActivity([]); return; }
    fetchLpHistory(accountId, 10).then(setRecentActivity).catch(() => {});
  }, [accountId]);

  const handleRefresh = () => {
    invalidatePositionCacheForAccount(accountId, hederaNetwork as any);
    fetchPositions(true);
  };

  // Summary stats
  const totalValue = positions.reduce((s, p) => s + p.totalValueUsd, 0);
  const totalFees = positions.reduce((s, p) => s + p.totalFeesUsd, 0);
  const inRangeCount = positions.filter(p => p.inRange).length;

  const cardClass = isDark
    ? "bg-slate-900/40 border border-pink-500/10 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  // ── No wallet ──
  if (!accountId) {
    return (
      <div className={`rounded-xl p-8 text-center ${cardClass}`}>
        <Wallet className={`w-10 h-10 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
        <div className="font-bold text-sm mb-1">Connect Wallet</div>
        <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Connect your HashPack wallet to view V2 liquidity positions
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (loading && positions.length === 0) {
    return (
      <div className={`rounded-xl p-8 text-center ${cardClass}`}>
        <RefreshCw className={`w-6 h-6 mx-auto mb-3 animate-spin ${isDark ? "text-pink-400/50" : "text-pink-300"}`} />
        <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Loading V2 positions...
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (!loading && positions.length === 0 && !error) {
    return (
      <div className={`rounded-xl p-8 text-center ${cardClass}`}>
        <Droplets className={`w-10 h-10 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
        <div className="font-bold text-sm mb-1">No V2 Positions</div>
        <div className={`text-xs max-w-sm mx-auto ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          You don't have any SaucerSwap V2 concentrated liquidity positions. 
          Expand a V2 pool above and click "Add Liquidity" to get started.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-sm">Your V2 Positions</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? "bg-purple-500/10 text-purple-400" : "bg-purple-50 text-purple-600"}`}>
            {positions.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-slate-500">Total Value</div>
            <div className="font-bold text-sm">{formatUsd(totalValue)}</div>
          </div>
          {totalFees > 0 && (
            <div className="text-right">
              <div className="text-xs text-slate-500">Fees</div>
              <div className="font-bold text-sm text-emerald-400">{formatUsd(totalFees)}</div>
            </div>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className={`p-1.5 rounded-lg transition-all ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""} ${isDark ? "text-slate-400" : "text-gray-400"}`} />
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className={`rounded-lg p-3 flex items-center gap-2 text-xs ${isDark ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"}`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Position Cards */}
      <div className="space-y-2">
        {positions.map((pos) => {
          const expanded = expandedSN === pos.tokenSN;
          // Range bar: position of current price within the tick range
          const rangeWidth = pos.priceUpper - pos.priceLower;
          const currentPosInRange = rangeWidth > 0
            ? Math.max(0, Math.min(100, ((pos.currentPrice - pos.priceLower) / rangeWidth) * 100))
            : 50;

          return (
            <div key={pos.tokenSN} className={`rounded-xl overflow-hidden transition-all ${cardClass}`}>
              {/* Collapsed Row */}
              <div
                onClick={() => setExpandedSN(expanded ? null : pos.tokenSN)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all ${
                  expanded
                    ? isDark ? "bg-pink-500/5" : "bg-pink-50/50"
                    : isDark ? "hover:bg-slate-800/30" : "hover:bg-gray-50"
                }`}
              >
                {/* Token Pair Icons */}
                <div className="flex -space-x-2 shrink-0">
                  <TokenIcon
                    src={pos.token0.logo}
                    symbol={pos.token0.symbol}
                    className="w-7 h-7 ring-2 ring-slate-900/50 z-10"
                  />
                  <TokenIcon
                    src={pos.token1.logo}
                    symbol={pos.token1.symbol}
                    className="w-7 h-7 ring-2 ring-slate-900/50"
                  />
                </div>

                {/* Pair Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm truncate">
                      {pos.token0.symbol}/{pos.token1.symbol}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
                      {pos.feePercent}%
                    </span>
                    {/* In-Range Indicator */}
                    <span className={`flex items-center gap-1 text-xs ${pos.inRange ? "text-emerald-400" : "text-amber-400"}`}>
                      <CircleDot className="w-3 h-3" />
                      <span className="hidden sm:inline">{pos.inRange ? "In Range" : "Out of Range"}</span>
                    </span>
                  </div>
                  <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    NFT #{pos.tokenSN}
                  </div>
                </div>

                {/* Value */}
                <div className="text-right shrink-0">
                  <div className="font-bold text-sm">{formatUsd(pos.totalValueUsd)}</div>
                  {pos.totalFeesUsd > 0.01 && (
                    <div className="text-xs text-emerald-400 flex items-center justify-end gap-1">
                      <Gift className="w-3 h-3" />
                      {formatUsd(pos.totalFeesUsd)}
                    </div>
                  )}
                </div>

                {/* Expand Icon */}
                <div className="shrink-0">
                  {expanded
                    ? <ChevronUp className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                    : <ChevronDown className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                  }
                </div>
              </div>

              {/* Expanded Details */}
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className={`px-4 pb-4 space-y-3 ${isDark ? "border-t border-pink-500/10" : "border-t border-gray-100"}`}>
                      {/* Price Range Visualization */}
                      <div className="pt-3">
                        <div className={`text-xs mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Price Range</div>
                        <div className={`rounded-lg p-3 ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                          {/* Range Bar */}
                          <div className="relative h-2 rounded-full bg-slate-700/30 mb-3">
                            <div
                              className={`absolute h-full rounded-full ${pos.inRange ? "bg-emerald-500/30" : "bg-amber-500/20"}`}
                              style={{ left: "0%", width: "100%" }}
                            />
                            <div
                              className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 ${
                                pos.inRange ? "bg-emerald-400 border-emerald-300" : "bg-amber-400 border-amber-300"
                              }`}
                              style={{ left: `${currentPosInRange}%`, transform: `translateX(-50%) translateY(-50%)` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs">
                            <div>
                              <span className={isDark ? "text-slate-500" : "text-gray-400"}>Min: </span>
                              <span className="font-mono">{formatPrice(pos.priceLower)}</span>
                            </div>
                            <div className="text-center">
                              <span className={isDark ? "text-slate-500" : "text-gray-400"}>Current: </span>
                              <span className={`font-mono font-bold ${pos.inRange ? "text-emerald-400" : "text-amber-400"}`}>
                                {formatPrice(pos.currentPrice)}
                              </span>
                            </div>
                            <div>
                              <span className={isDark ? "text-slate-500" : "text-gray-400"}>Max: </span>
                              <span className="font-mono">{formatPrice(pos.priceUpper)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Token Amounts */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className={`rounded-lg p-3 ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                          <div className={`text-xs mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Token Amounts</div>
                          <div className="space-y-1.5 text-sm">
                            <div className="flex justify-between">
                              <span className="flex items-center gap-1.5">
                                <TokenIcon src={pos.token0.logo} symbol={pos.token0.symbol} className="w-4 h-4" />
                                {pos.token0.symbol}
                              </span>
                              <span className="font-mono">{formatAmount(pos.amount0Human)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="flex items-center gap-1.5">
                                <TokenIcon src={pos.token1.logo} symbol={pos.token1.symbol} className="w-4 h-4" />
                                {pos.token1.symbol}
                              </span>
                              <span className="font-mono">{formatAmount(pos.amount1Human)}</span>
                            </div>
                          </div>
                        </div>

                        <div className={`rounded-lg p-3 ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                          <div className={`text-xs mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Unclaimed Fees</div>
                          <div className="space-y-1.5 text-sm">
                            <div className="flex justify-between">
                              <span>{pos.token0.symbol}</span>
                              <span className="font-mono text-emerald-400">{formatAmount(pos.feesOwed0Human)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>{pos.token1.symbol}</span>
                              <span className="font-mono text-emerald-400">{formatAmount(pos.feesOwed1Human)}</span>
                            </div>
                            {pos.totalFeesUsd > 0 && (
                              <div className="flex justify-between font-bold pt-1 border-t border-slate-700/30">
                                <span>Total</span>
                                <span className="text-emerald-400">{formatUsd(pos.totalFeesUsd)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); onAddLiquidity?.(pos); }}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-pink-500/20"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add More
                        </button>
                        {pos.totalFeesUsd > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onCollectFees?.(pos); }}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-bold transition-all ${
                              isDark
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                                : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100"
                            }`}
                          >
                            <Gift className="w-3.5 h-3.5" /> Collect
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemoveLiquidity?.(pos); }}
                          className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-bold transition-all ${
                            isDark
                              ? "bg-slate-800 hover:bg-slate-700 text-slate-300"
                              : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                          }`}
                        >
                          <Minus className="w-3.5 h-3.5" /> Remove
                        </button>
                      </div>

                      {/* HashScan Link */}
                      <a
                        href={`https://hashscan.io/${hederaNetwork || "mainnet"}/token/${SAUCERSWAP_V2_LP_NFT[hederaNetwork || "mainnet"] || "0.0.4054027"}/${pos.tokenSN}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center justify-center gap-1.5 text-xs py-1.5 transition-colors ${isDark ? "text-slate-500 hover:text-pink-400" : "text-gray-400 hover:text-pink-500"}`}
                      >
                        View on HashScan <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* ═══ [LP-15] Recent Activity ═══ */}
      {recentActivity.length > 0 && (
        <div className={`rounded-xl overflow-hidden ${cardClass}`}>
          <div className={`px-4 py-3 ${isDark ? "border-b border-pink-500/10" : "border-b border-gray-100"}`}>
            <h4 className="font-bold text-sm flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-pink-400" />
              Recent Activity
            </h4>
          </div>
          <div className="divide-y divide-pink-500/5">
            {recentActivity.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    entry.action === "mint" || entry.action === "increase"
                      ? isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                      : entry.action === "collect"
                      ? isDark ? "bg-blue-500/10 text-blue-400" : "bg-blue-50 text-blue-600"
                      : isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-600"
                  }`}>
                    {entry.action === "mint" ? "+" : entry.action === "increase" ? "+" : entry.action === "collect" ? "$" : "-"}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{actionLabel(entry.action)}</div>
                    <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {entry.pool} · NFT #{entry.tokenSN} · {timeAgo(entry.timestamp)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {entry.valueUsd != null && entry.valueUsd > 0 && (
                    <span className="text-xs font-mono font-bold">{formatUsd(entry.valueUsd)}</span>
                  )}
                  {entry.txHash && (
                    <a
                      href={hashScanTxUrl(entry.txHash, entry.network)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`p-1 rounded transition-colors ${isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-gray-100 text-gray-400"}`}
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    entry.status === "success"
                      ? isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                      : entry.status === "failed"
                      ? isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-600"
                      : isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-600"
                  }`}>
                    {entry.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
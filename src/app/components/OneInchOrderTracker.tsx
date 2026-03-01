/**
 * OneInchOrderTracker — Fusion Order Tracking Dashboard
 *
 * Displays active and recently-completed Fusion orders with real-time
 * status updates. Active orders auto-refresh every 5 seconds. Recent
 * order hashes are persisted in localStorage for history across sessions.
 *
 * Features:
 *   - Active order polling (5s interval)
 *   - localStorage-persisted order history
 *   - Status badges with colour coding
 *   - Time elapsed since order creation
 *   - Resolver address display
 *   - Explorer links for filled orders
 *   - Sound effect on order fill (playVipConfirm)
 *   - Collapsible panel to save vertical space
 *
 * IMPLEMENTATION NOTE: This component is designed to sit BELOW the
 * OneInchWidget swap panel. It only renders when the user has an EVM
 * wallet connected and there are orders to show.
 *
 * @module OneInchOrderTracker (Step 8 — 1inch Fusion Master Plan)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Clock,
  CheckCircle2,
  Activity,
  History,
  Copy,
  Check,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { log } from "../utils/logger";
import { playVipConfirm } from "../utils/sounds";
import { getChainById } from "../utils/oneinch/chains";
import {
  fetchActiveOrders,
  fetchOrderStatus,
  loadPersistedOrders,
  isFusionTerminalStatus,
  isFusionSuccessStatus,
  FUSION_STATUS_LABELS,
  FUSION_STATUS_ICONS,
  FUSION_STATUS_PROGRESS,
  TRACKER_POLL_INTERVAL_MS,
  formatFusionAmount,
  isFusionSupported,
} from "../utils/oneinch/fusion";
import type { TrackedOrder } from "../utils/oneinch/fusion";
import type { FusionOrderStatus } from "../utils/oneinch/types";

/* ══════════════════════════════════════════════════════════════════════
 * Props
 * ══════════════════════════════════════════════════════════════════════ */

interface OrderTrackerProps {
  /** Connected EVM wallet address */
  evmAccount: string | null;
  /** Currently selected chain ID */
  chainId: number;
  /** Whether dark mode is active (from parent) */
  isDark?: boolean;
}

/* ══════════════════════════════════════════════════════════════════════
 * Constants
 * ══════════════════════════════════════════════════════════════════════ */

const TAG = "1inch:tracker";

/** How many recent (historical) orders to show */
const MAX_RECENT_DISPLAY = 10;

/* ══════════════════════════════════════════════════════════════════════
 * Status badge styling
 * ══════════════════════════════════════════════════════════════════════ */

function statusBadgeClass(status: FusionOrderStatus, isDark: boolean): string {
  switch (status) {
    case "pending":
      return isDark
        ? "bg-yellow-900/30 text-yellow-400 border-yellow-500/30"
        : "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "assigned":
      return isDark
        ? "bg-blue-900/30 text-blue-400 border-blue-500/30"
        : "bg-blue-50 text-blue-700 border-blue-200";
    case "executing":
      return isDark
        ? "bg-cyan-900/30 text-cyan-400 border-cyan-500/30"
        : "bg-cyan-50 text-cyan-700 border-cyan-200";
    case "filled":
      return isDark
        ? "bg-emerald-900/30 text-emerald-400 border-emerald-500/30"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "expired":
      return isDark
        ? "bg-orange-900/30 text-orange-400 border-orange-500/30"
        : "bg-orange-50 text-orange-700 border-orange-200";
    case "cancelled":
    case "failed":
      return isDark
        ? "bg-red-900/30 text-red-400 border-red-500/30"
        : "bg-red-50 text-red-700 border-red-200";
    default:
      return isDark
        ? "bg-slate-800/50 text-slate-400 border-slate-600/30"
        : "bg-gray-100 text-gray-600 border-gray-200";
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * Time elapsed helper
 * ══════════════════════════════════════════════════════════════════════ */

function timeAgo(isoDate?: string): string {
  if (!isoDate) return "";
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ══════════════════════════════════════════════════════════════════════
 * Truncate helpers
 * ══════════════════════════════════════════════════════════════════════ */

function truncateHash(hash: string, front = 6, back = 4): string {
  if (hash.length <= front + back + 2) return hash;
  return `${hash.slice(0, front)}...${hash.slice(-back)}`;
}

function truncateAddress(addr?: string): string {
  if (!addr) return "—";
  return truncateHash(addr, 6, 4);
}

/* ══════════════════════════════════════════════════════════════════════
 * Component
 * ══════════════════════════════════════════════════════════════════════ */

export function OneInchOrderTracker({ evmAccount, chainId, isDark: isDarkProp }: OrderTrackerProps) {
  const themeCtx = useTheme();
  const isDark = isDarkProp ?? themeCtx.isDark;

  // ── State ──
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeOrders, setActiveOrders] = useState<TrackedOrder[]>([]);
  const [recentOrders, setRecentOrders] = useState<TrackedOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Track which order hashes have already triggered the fill sound
  const filledSoundPlayed = useRef<Set<string>>(new Set());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Style tokens ──
  const cardClass = isDark
    ? "bg-[#0c0f1a]/95 backdrop-blur-2xl border border-white/[0.04]"
    : "bg-white/95 backdrop-blur-2xl border border-gray-200 shadow-xl";
  const rowClass = isDark
    ? "bg-slate-800/40 border border-slate-700/30 hover:border-slate-600/50"
    : "bg-gray-50/80 border border-gray-200 hover:border-gray-300";

  // ── Copy hash to clipboard ──
  const copyHash = useCallback((hash: string) => {
    navigator.clipboard.writeText(hash).then(() => {
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    });
  }, []);

  // ── Fetch orders ──
  const fetchOrders = useCallback(async (signal?: AbortSignal) => {
    if (!evmAccount || !isFusionSupported(chainId)) return;

    try {
      // 1. Fetch active orders from API
      const active = await fetchActiveOrders(chainId, evmAccount, signal);

      // 2. Load persisted historical orders and fetch their current status
      const persisted = loadPersistedOrders()
        .filter(p => p.chainId === chainId)
        .slice(0, MAX_RECENT_DISPLAY);

      // Only fetch status for historical orders not already in active list
      const activeHashes = new Set(active.map(o => o.orderHash));
      const historicalToFetch = persisted.filter(p => !activeHashes.has(p.orderHash));

      const historicalResults = await Promise.allSettled(
        historicalToFetch.map(p => fetchOrderStatus(chainId, p.orderHash, signal)),
      );

      const recent: TrackedOrder[] = [];
      for (const result of historicalResults) {
        if (result.status === "fulfilled" && result.value) {
          recent.push(result.value);
        }
      }

      // 3. Check for newly filled orders (play sound)
      for (const order of [...active, ...recent]) {
        if (
          isFusionSuccessStatus(order.status) &&
          !filledSoundPlayed.current.has(order.orderHash)
        ) {
          filledSoundPlayed.current.add(order.orderHash);
          playVipConfirm();
          log.info(TAG, `Order filled! ${order.orderHash.slice(0, 12)}...`);
        }
      }

      setActiveOrders(active);
      setRecentOrders(recent.filter(r => isFusionTerminalStatus(r.status)));
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      log.warn(TAG, "Failed to fetch orders", err);
    }
  }, [evmAccount, chainId]);

  // ── Initial fetch + polling ──
  useEffect(() => {
    if (!evmAccount || !isFusionSupported(chainId)) {
      setActiveOrders([]);
      setRecentOrders([]);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    fetchOrders(controller.signal).finally(() => setLoading(false));

    // Auto-refresh every 5 seconds
    pollTimer.current = setInterval(() => {
      fetchOrders();
    }, TRACKER_POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [evmAccount, chainId, fetchOrders]);

  // ── Don't render if no wallet or no orders ──
  const totalOrders = activeOrders.length + recentOrders.length;
  const hasActiveOrders = activeOrders.length > 0;

  if (!evmAccount || !isFusionSupported(chainId)) return null;
  if (totalOrders === 0 && !loading) return null;

  const chain = getChainById(chainId);
  const explorerUrl = chain?.explorerUrl ?? "https://etherscan.io";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`rounded-2xl overflow-hidden mt-4 ${cardClass}`}
    >
      {/* ── Header (always visible) ── */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${
          isDark ? "hover:bg-slate-800/40" : "hover:bg-gray-50"
        }`}
      >
        <div className="flex items-center gap-2">
          <Activity className={`w-4 h-4 ${hasActiveOrders ? "text-emerald-400 animate-pulse" : isDark ? "text-slate-500" : "text-gray-400"}`} />
          <span className={`text-sm font-bold ${isDark ? "text-slate-200" : "text-gray-700"}`}>
            Fusion Orders
          </span>
          {hasActiveOrders && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {activeOrders.length} active
            </span>
          )}
          {recentOrders.length > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              isDark ? "bg-slate-700/50 text-slate-400" : "bg-gray-100 text-gray-500"
            }`}>
              {recentOrders.length} recent
            </span>
          )}
          {loading && <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
        </div>
        {isExpanded ? (
          <ChevronUp className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
        ) : (
          <ChevronDown className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
        )}
      </button>

      {/* ── Expanded order list ── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={`px-4 pb-4 space-y-2 ${isDark ? "border-t border-white/[0.04]" : "border-t border-gray-100"}`}>
              {/* ── Active Orders ── */}
              {activeOrders.length > 0 && (
                <div className="mt-3">
                  <div className={`flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wider ${
                    isDark ? "text-emerald-400/70" : "text-emerald-600/70"
                  }`}>
                    <Activity className="w-3 h-3" />
                    Active Orders
                  </div>
                  <div className="space-y-2">
                    {activeOrders.map(order => (
                      <OrderRow
                        key={order.orderHash}
                        order={order}
                        isDark={isDark}
                        rowClass={rowClass}
                        explorerUrl={explorerUrl}
                        copiedHash={copiedHash}
                        onCopy={copyHash}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Recent Orders ── */}
              {recentOrders.length > 0 && (
                <div className={activeOrders.length > 0 ? "mt-3" : "mt-3"}>
                  <div className={`flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wider ${
                    isDark ? "text-slate-500" : "text-gray-400"
                  }`}>
                    <History className="w-3 h-3" />
                    Recent Orders
                  </div>
                  <div className="space-y-2">
                    {recentOrders.map(order => (
                      <OrderRow
                        key={order.orderHash}
                        order={order}
                        isDark={isDark}
                        rowClass={rowClass}
                        explorerUrl={explorerUrl}
                        copiedHash={copiedHash}
                        onCopy={copyHash}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Empty state ── */}
              {totalOrders === 0 && !loading && (
                <div className={`text-center py-6 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  No Fusion orders found on {chain?.name ?? "this chain"}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * OrderRow — Individual order display
 * ══════════════════════════════════════════════════════════════════════ */

interface OrderRowProps {
  order: TrackedOrder;
  isDark: boolean;
  rowClass: string;
  explorerUrl: string;
  copiedHash: string | null;
  onCopy: (hash: string) => void;
}

function OrderRow({ order, isDark, rowClass, explorerUrl, copiedHash, onCopy }: OrderRowProps) {
  const isTerminal = isFusionTerminalStatus(order.status);
  const isSuccess = isFusionSuccessStatus(order.status);
  const progress = FUSION_STATUS_PROGRESS[order.status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-xl p-3 transition-all ${rowClass}`}
    >
      {/* Row 1: Hash + Status badge */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* Order hash with copy */}
          <button
            onClick={() => onCopy(order.orderHash)}
            className={`flex items-center gap-1 font-mono text-xs transition-colors ${
              isDark ? "text-slate-300 hover:text-pink-400" : "text-gray-600 hover:text-pink-600"
            }`}
            title="Copy order hash"
          >
            {truncateHash(order.orderHash)}
            {copiedHash === order.orderHash ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3 opacity-40" />
            )}
          </button>

          {/* Time elapsed */}
          {order.createdAt && (
            <span className={`text-[10px] flex items-center gap-0.5 ${
              isDark ? "text-slate-500" : "text-gray-400"
            }`}>
              <Clock className="w-2.5 h-2.5" />
              {timeAgo(order.createdAt)}
            </span>
          )}
        </div>

        {/* Status badge */}
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
          statusBadgeClass(order.status, isDark)
        }`}>
          <span>{FUSION_STATUS_ICONS[order.status]}</span>
          {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
        </span>
      </div>

      {/* Row 2: Token info (if available) */}
      {(order.srcTokenAddress || order.dstTokenAddress) && (
        <div className={`flex items-center gap-2 text-[11px] mb-2 ${
          isDark ? "text-slate-400" : "text-gray-500"
        }`}>
          <span className="font-mono">{truncateAddress(order.srcTokenAddress)}</span>
          <span className={isDark ? "text-pink-400" : "text-pink-500"}>→</span>
          <span className="font-mono">{truncateAddress(order.dstTokenAddress)}</span>
        </div>
      )}

      {/* Row 3: Amounts (if available) */}
      {(order.srcTokenAmount || order.dstTokenAmount) && (
        <div className={`flex items-center gap-3 text-[10px] ${
          isDark ? "text-slate-500" : "text-gray-400"
        }`}>
          {order.srcTokenAmount && (
            <span>In: <span className="font-mono">{formatFusionAmount(order.srcTokenAmount, 18)}</span></span>
          )}
          {order.dstTokenAmount && (
            <span>Out: <span className="font-mono">{formatFusionAmount(order.dstTokenAmount, 18)}</span></span>
          )}
        </div>
      )}

      {/* Progress bar (non-terminal only) */}
      {!isTerminal && (
        <div className={`mt-2 h-1 rounded-full overflow-hidden ${
          isDark ? "bg-slate-700/50" : "bg-gray-200"
        }`}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
          />
        </div>
      )}

      {/* Status label */}
      <div className={`mt-1.5 text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        {FUSION_STATUS_LABELS[order.status]}
      </div>

      {/* Row 4: Resolver + TX link (for filled orders) */}
      {isTerminal && (
        <div className={`flex items-center justify-between mt-2 pt-2 border-t ${
          isDark ? "border-slate-700/30" : "border-gray-200/50"
        }`}>
          {order.resolverAddress && (
            <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Resolver: <span className="font-mono">{truncateAddress(order.resolverAddress)}</span>
            </span>
          )}
          {order.txHash && (
            <a
              href={`${explorerUrl}/tx/${order.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-0.5 text-[10px] font-bold transition-colors ${
                isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-700"
              }`}
            >
              View TX <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          {isSuccess && !order.txHash && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-400">
              <CheckCircle2 className="w-3 h-3" /> Filled
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}
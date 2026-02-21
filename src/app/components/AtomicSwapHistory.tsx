/**
 * AtomicSwapHistory — On-Chain Swap Activity Log
 *
 * Displays the user's atomic swap history fetched from the server's
 * KV-backed history endpoint. Each entry was written at co-sign time
 * by the sign-swap handler in atomic-signer.ts.
 *
 * SENIOR DEV NOTE [C8-02]:
 *   The history endpoint is auth-gated — the ED25519 session token must
 *   match the requested accountId. Users can only see their own swaps.
 *   The KV entries are keyed as `atomic_swap_<timestamp>_<accountId>`,
 *   read via prefix scan, and filtered + sorted server-side. The server
 *   caps responses at 50 most recent entries.
 *
 * SENIOR DEV NOTE [C8-03]:
 *   These events represent server co-signs, not confirmed on-chain
 *   settlements. A co-signed swap that the user subsequently rejected
 *   in their wallet (or that expired) will still appear here. For
 *   confirmed settlement status, cross-reference with Mirror Node
 *   transaction receipts (not implemented yet — candidate for Phase 2).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Clock,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
  Zap,
  Shield,
  History,
  ArrowDownUp,
  Copy,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useWallet } from "../contexts/WalletContext";
import { authenticate, hasValidSession, getSessionToken } from "../utils/auth";
import { playVipButtonChime } from "../utils/sounds";
import { copyToClipboard } from "../utils/clipboard";
import {
  fetchAtomicSwapHistory,
  type AtomicSwapEvent,
} from "../utils/atomic-swap-client";
import {
  TOKEN_BY_SYMBOL,
  POOL_BY_ID,
  bigIntToDecimal,
} from "../utils/atomic-swap-engine";
import { displaySymbol } from "../utils/display-symbol";

// ── Token Logo Map ──────────────────────────────────────────────────

const TOKEN_LOGOS: Record<string, string> = {
  HBAR:  "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  WHBAR: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  USDC:  "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  USDT:  "https://assets.coingecko.com/coins/images/325/large/Tether.png",
  DAI:   "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
  WBTC:  "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  WETH:  "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  LINK:  "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  AAVE:  "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png",
  WBNB:  "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
  WAVAX: "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
};

// ── Time Formatting ─────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

// ── Display amount from raw ─────────────────────────────────────────

function displayAmount(raw: string, symbol: string): string {
  const token = TOKEN_BY_SYMBOL.get(symbol);
  if (!token) return raw;
  const display = bigIntToDecimal(BigInt(raw), token.decimals);
  const num = parseFloat(display);
  if (num >= 1000) return num.toFixed(2);
  if (num >= 1) return num.toFixed(4);
  if (num >= 0.0001) return num.toFixed(6);
  return num.toFixed(8);
}

// ── Swap Row ────────────────────────────────────────────────────────

function SwapRow({
  swap,
  isDark,
  index,
}: {
  swap: AtomicSwapEvent;
  isDark: boolean;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const pool = POOL_BY_ID.get(swap.poolId);
  const amountIn = displayAmount(swap.amountInRaw, swap.tokenIn);
  const amountOut = displayAmount(swap.serverAmountOutRaw, swap.tokenOut);

  const handleCopyId = useCallback(async () => {
    const poolLabel = pool ? `${displaySymbol(pool.tokenA)}/${displaySymbol(pool.tokenB)}` : swap.poolId;
    const text = `${displaySymbol(swap.tokenIn)} → ${displaySymbol(swap.tokenOut)} | ${amountIn} ${displaySymbol(swap.tokenIn)} → ${amountOut} ${displaySymbol(swap.tokenOut)} | Pool: ${poolLabel} | ${formatFullTime(swap.timestamp)}`;
    await copyToClipboard(text);
    setCopied(true);
    toast.success("Swap details copied");
    setTimeout(() => setCopied(false), 2000);
  }, [swap, amountIn, amountOut, pool]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={`rounded-lg overflow-hidden transition-colors ${
        isDark
          ? "bg-slate-900/30 hover:bg-slate-900/50 border border-transparent hover:border-pink-500/10"
          : "bg-gray-50 hover:bg-gray-100 border border-transparent hover:border-gray-200"
      }`}
    >
      {/* Main row */}
      <div
        className="px-3 py-2.5 cursor-pointer flex items-center gap-3"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Swap direction icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isDark ? "bg-pink-500/[0.08]" : "bg-pink-50"
        }`}>
          <ArrowDownUp className={`w-3.5 h-3.5 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
        </div>

        {/* Token pair */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <img src={TOKEN_LOGOS[swap.tokenIn] || ""} alt={swap.tokenIn} className="w-4 h-4 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <span className="text-xs font-bold truncate">{amountIn}</span>
            <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{displaySymbol(swap.tokenIn)}</span>
            <ArrowRight className={`w-3 h-3 shrink-0 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
            <img src={TOKEN_LOGOS[swap.tokenOut] || ""} alt={swap.tokenOut} className="w-4 h-4 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <span className="text-xs font-bold text-emerald-400 truncate">{amountOut}</span>
            <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{displaySymbol(swap.tokenOut)}</span>
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            {pool ? `${displaySymbol(pool.tokenA)}/${displaySymbol(pool.tokenB)}` : swap.poolId} · {formatRelativeTime(swap.timestamp)}
          </div>
        </div>

        {/* Expand indicator */}
        <div className="shrink-0">
          {expanded ? (
            <ChevronUp className={`w-3.5 h-3.5 ${isDark ? "text-slate-600" : "text-gray-400"}`} />
          ) : (
            <ChevronDown className={`w-3.5 h-3.5 ${isDark ? "text-slate-600" : "text-gray-400"}`} />
          )}
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className={`px-3 pb-2.5 pt-0.5 border-t text-[10px] space-y-1 ${isDark ? "border-slate-800/50 text-slate-500" : "border-gray-200 text-gray-400"}`}>
              <div className="flex items-center justify-between">
                <span>Timestamp</span>
                <span className="font-mono">{formatFullTime(swap.timestamp)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pool</span>
                <span className="font-mono">{swap.poolId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Input (raw)</span>
                <span className="font-mono">{swap.amountInRaw}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Output (raw)</span>
                <span className="font-mono">{swap.serverAmountOutRaw}</span>
              </div>
              {/* Effective rate */}
              {(() => {
                const tokenIn = TOKEN_BY_SYMBOL.get(swap.tokenIn);
                const tokenOut = TOKEN_BY_SYMBOL.get(swap.tokenOut);
                if (!tokenIn || !tokenOut) return null;
                const inDec = Number(BigInt(swap.amountInRaw)) / 10 ** tokenIn.decimals;
                const outDec = Number(BigInt(swap.serverAmountOutRaw)) / 10 ** tokenOut.decimals;
                const rate = inDec > 0 ? outDec / inDec : 0;
                return (
                  <div className="flex items-center justify-between">
                    <span>Rate</span>
                    <span className="font-mono">
                      1 {swap.tokenIn} = {rate >= 0.01 ? rate.toFixed(4) : rate.toFixed(8)} {swap.tokenOut}
                    </span>
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopyId(); }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors cursor-pointer ${
                    isDark ? "hover:bg-slate-800 text-slate-500 hover:text-slate-300" : "hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

interface AtomicSwapHistoryProps {
  isDark: boolean;
  accountId: string;
}

export function AtomicSwapHistory({ isDark, accountId }: AtomicSwapHistoryProps) {
  const [swaps, setSwaps] = useState<AtomicSwapEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch history ──────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    if (!accountId) return;

    // Check if session exists
    if (!hasValidSession(accountId)) {
      setNeedsAuth(true);
      return;
    }

    setNeedsAuth(false);
    setLoading(true);
    try {
      const history = await fetchAtomicSwapHistory(accountId);
      if (mountedRef.current) setSwaps(history);
    } catch {
      // Non-critical
    }
    if (mountedRef.current) setLoading(false);
  }, [accountId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ── Handle authentication ──────────────────────────────────────────
  const handleAuth = useCallback(async () => {
    setAuthenticating(true);
    try {
      await authenticate(accountId);
      setNeedsAuth(false);
      // Immediately fetch after auth
      const history = await fetchAtomicSwapHistory(accountId);
      if (mountedRef.current) setSwaps(history);
    } catch (err: any) {
      toast.error(err?.message || "Authentication failed");
    }
    if (mountedRef.current) setAuthenticating(false);
  }, [accountId]);

  return (
    <div className={`rounded-xl overflow-hidden ${
      isDark
        ? "bg-slate-900/20 border border-pink-500/10"
        : "bg-white border border-gray-200"
    }`}>
      {/* Section header */}
      <div
        className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${
          isDark ? "hover:bg-slate-800/20" : "hover:bg-gray-50"
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <motion.div
            className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center"
            animate={{ boxShadow: expanded ? "0 0 15px rgba(236,72,153,0.3)" : "0 0 0px rgba(236,72,153,0)" }}
          >
            <History className="w-4 h-4 text-white" />
          </motion.div>
          <div>
            <span className="font-bold text-sm">Swap History</span>
            <span className={`ml-2 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {swaps.length} swap{swaps.length !== 1 ? "s" : ""}
              {swaps.length > 0 ? ` · Atomic` : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!needsAuth && (
            <button
              onClick={(e) => { e.stopPropagation(); fetchHistory(); }}
              disabled={loading}
              className={`p-1.5 rounded-lg transition-colors ${
                isDark ? "hover:bg-slate-800/50 text-slate-500" : "hover:bg-gray-100 text-gray-400"
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">
              {/* Auth required */}
              {needsAuth && (
                <div className={`text-center py-8 rounded-xl ${isDark ? "bg-slate-900/30" : "bg-gray-50"}`}>
                  <Shield className={`w-8 h-8 mx-auto mb-2 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                  <p className="font-bold text-sm mb-1">Authentication Required</p>
                  <p className={`text-xs mb-4 max-w-[260px] mx-auto ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Sign a challenge to verify account ownership and view your swap history.
                  </p>
                  <motion.button
                    onClick={handleAuth}
                    disabled={authenticating}
                    whileTap={{ scale: 0.97 }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-pink-500 to-purple-500 hover:shadow-[0_0_15px_rgba(236,72,153,0.3)] cursor-pointer disabled:opacity-50"
                  >
                    {authenticating ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Signing...</>
                    ) : (
                      <><Shield className="w-3 h-3" /> Authenticate</>
                    )}
                  </motion.button>
                </div>
              )}

              {/* Loading */}
              {loading && swaps.length === 0 && !needsAuth && (
                <div className="text-center py-8">
                  <Loader2 className={`w-5 h-5 mx-auto animate-spin ${isDark ? "text-pink-400" : "text-pink-500"}`} />
                  <p className={`mt-2 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Loading swap history...
                  </p>
                </div>
              )}

              {/* Empty state */}
              {!loading && !needsAuth && swaps.length === 0 && (
                <div className={`text-center py-8 rounded-xl ${isDark ? "bg-slate-900/30" : "bg-gray-50"}`}>
                  <Zap className={`w-8 h-8 mx-auto mb-2 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                  <p className="font-bold text-sm mb-1">No Swaps Yet</p>
                  <p className={`text-xs max-w-[260px] mx-auto ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Your atomic swap history will appear here after your first trade.
                  </p>
                </div>
              )}

              {/* Swap list */}
              {!needsAuth && swaps.length > 0 && (
                <div className="space-y-1">
                  {swaps.map((swap, i) => (
                    <SwapRow
                      key={`${swap.timestamp}-${swap.tokenIn}-${swap.tokenOut}`}
                      swap={swap}
                      isDark={isDark}
                      index={i}
                    />
                  ))}
                </div>
              )}

              {/* Count footer */}
              {!needsAuth && swaps.length > 0 && (
                <div className={`text-center text-[10px] pt-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                  Showing {swaps.length} most recent swap{swaps.length !== 1 ? "s" : ""} (co-signed)
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
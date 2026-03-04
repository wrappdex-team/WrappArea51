/**
 * SwapButtonPro — Premium animated swap execution button.
 *
 * SESSION 3 redesign:
 * - Processing: purple gradient with flowing shimmer + progress bar
 * - Success: celebratory scale-up with checkmark
 * - Error: shake animation + compact error banner
 * - Disabled states: unified muted style with contextual text
 * - Active: CSS keyframe shimmer, integrated approval hint
 * - Connect wallet: warm pulse border
 *
 * Preserved: wallet open timer, step tracker, humanize logic,
 * all existing props and swap execution flow.
 */

import { memo, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wallet,
  ArrowRight,
  ExternalLink,
  Zap,
  ShieldAlert,
  Search,
} from "lucide-react";
import type { AllowedToken } from "../utils/saucerswap";

/** [C108-S13] How long to wait before showing "Open Wallet" button (ms) */
const WALLET_OPEN_DELAY_MS = 2000;
/** [MOB-WEB3-04] On mobile, show "Open Wallet" almost immediately since user must switch apps */
const WALLET_OPEN_DELAY_MOBILE_MS = 800;

interface SwapButtonProProps {
  status: "idle" | "processing" | "success" | "error";
  canSwap: boolean;
  isWalletConnected: boolean;
  isWrapUnwrap: boolean;
  isWrapping: boolean;
  inputToken: AllowedToken;
  outputToken: AllowedToken;
  hasRoute: boolean;
  routeSearching: boolean;
  insufficientBalance: boolean;
  gasReserveShortfall?: boolean;
  hasValidOutput: boolean;
  swapStep: { step: number; total: number; description: string } | null;
  swapError: string | null;
  lastTxId: string | null;
  txUrl: string | null;
  onSwap: () => void;
  onReset: () => void;
  onHover?: () => void;
  onOpenWallet?: () => void;
  isDark: boolean;
  approvalNeeded?: boolean | null;
}

/**
 * [C108-S13] Clean up internal technical descriptions to user-friendly text.
 */
function humanizeDescription(desc: string): string {
  return desc
    .replace(/\s*via V[12] Router/gi, "")
    .replace(/\s*\(atomic\)/gi, "")
    .replace(/\s*\(multi-hop,?\s*atomic\)/gi, "")
    .replace(/\s*\(multi-hop\)/gi, "")
    .replace(/\s*\(infinite\)/gi, "")
    .trim();
}

export const SwapButtonPro = memo(function SwapButtonPro({
  status,
  canSwap,
  isWalletConnected,
  isWrapUnwrap,
  isWrapping,
  inputToken,
  outputToken,
  hasRoute,
  routeSearching,
  insufficientBalance,
  gasReserveShortfall,
  hasValidOutput,
  swapStep,
  swapError,
  lastTxId,
  txUrl,
  onSwap,
  onReset,
  onHover,
  onOpenWallet,
  isDark,
  approvalNeeded,
}: SwapButtonProProps) {
  // ── [C108-S13] Wallet open timer ──
  const [showOpenWallet, setShowOpenWallet] = useState(false);
  const walletTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStepRef = useRef<number | null>(null);
  const isMobileRef = useRef(typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

  useEffect(() => {
    if (status === "processing") {
      const currentStep = swapStep?.step ?? null;
      if (currentStep !== lastStepRef.current) {
        lastStepRef.current = currentStep;
        setShowOpenWallet(false);
        if (walletTimerRef.current) clearTimeout(walletTimerRef.current);
        const delay = isMobileRef.current ? WALLET_OPEN_DELAY_MOBILE_MS : WALLET_OPEN_DELAY_MS;
        walletTimerRef.current = setTimeout(() => {
          setShowOpenWallet(true);
        }, delay);
      }
    } else {
      setShowOpenWallet(false);
      lastStepRef.current = null;
      if (walletTimerRef.current) {
        clearTimeout(walletTimerRef.current);
        walletTimerRef.current = null;
      }
    }
    return () => {
      if (walletTimerRef.current) clearTimeout(walletTimerRef.current);
    };
  }, [status, swapStep?.step]);

  const stepLabel = swapStep
    ? swapStep.step === 0 && swapStep.total === 0
      ? humanizeDescription(swapStep.description)
      : `Step ${swapStep.step} of ${swapStep.total}: ${humanizeDescription(swapStep.description)}`
    : "Preparing transaction...";

  const isPreflight = swapStep?.step === 0 && swapStep?.total === 0;

  // Progress fraction for the bar (0 → 1)
  const progressFraction = swapStep && swapStep.total > 0
    ? Math.max(0.05, swapStep.step / swapStep.total)
    : 0.1;

  // ── Resolve which idle sub-state to render ──
  type IdleVariant = "connect" | "searching" | "noRoute" | "gasReserve" | "insufficient" | "noQuote" | "ready";

  const idleVariant: IdleVariant = (() => {
    if (!isWalletConnected) return "connect";
    if (!hasRoute && !isWrapUnwrap && routeSearching) return "searching";
    if (!hasRoute && !isWrapUnwrap) return "noRoute";
    if (gasReserveShortfall) return "gasReserve";
    if (insufficientBalance) return "insufficient";
    if (!hasValidOutput && hasRoute) return "noQuote";
    return "ready";
  })();

  // Approval text integrated into button label
  const swapLabel = isWrapUnwrap
    ? `${isWrapping ? "Wrap" : "Unwrap"} ${inputToken.symbol}`
    : approvalNeeded === true
    ? `Approve & Swap`
    : `Swap`;

  return (
    <div className="mt-4 space-y-2">
      <AnimatePresence mode="wait">
        {/* ═══ PROCESSING ═══ */}
        {status === "processing" ? (
          <motion.div
            key="processing"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className={`relative w-full rounded-2xl overflow-hidden ${
                isDark
                  ? "bg-gradient-to-r from-pink-600/90 to-purple-600/90"
                  : "bg-gradient-to-r from-pink-500 to-purple-500"
              }`}
            >
              {/* Flowing shimmer overlay */}
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
                  backgroundSize: "200% 100%",
                  animation: "shimmerFlow 1.8s ease-in-out infinite",
                }}
              />

              <div className="relative px-5 py-4 text-white">
                <div className="flex items-center justify-center gap-2.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm font-bold">{stepLabel}</span>
                </div>

                {/* Sub-hint */}
                {!isPreflight && (
                  <p className="text-center text-xs text-white/60 mt-1.5 font-medium">
                    Sign in your HashPack wallet
                  </p>
                )}

                {/* Progress bar */}
                {swapStep && swapStep.total > 0 && (
                  <div className={`mt-3 h-1 rounded-full overflow-hidden ${
                    isDark ? "bg-white/10" : "bg-white/20"
                  }`}>
                    <motion.div
                      className="h-full rounded-full bg-white/50"
                      initial={{ width: "5%" }}
                      animate={{ width: `${progressFraction * 100}%` }}
                      transition={{ type: "spring", stiffness: 100, damping: 20 }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* "Open Wallet" — appears after delay */}
            <AnimatePresence>
              {showOpenWallet && onOpenWallet && !isPreflight && (
                <motion.button
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: "auto", marginTop: 8 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  onClick={onOpenWallet}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                    isDark
                      ? "bg-white/8 hover:bg-white/12 text-white/80 border border-white/10"
                      : "bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200"
                  }`}
                >
                  <Wallet className="w-4 h-4" />
                  Open Wallet
                  <ExternalLink className="w-3.5 h-3.5 opacity-50" />
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>

        /* ═══ SUCCESS ═══ */
        ) : status === "success" ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            <div className="relative w-full rounded-2xl overflow-hidden bg-gradient-to-r from-emerald-600 to-green-500">
              {/* Auto-dismiss progress bar */}
              <div
                className="absolute bottom-0 left-0 h-[2px] bg-white/30"
                style={{ width: "100%", animation: "shrink 5s linear forwards" }}
              />
              <div className="px-5 py-4 flex items-center justify-center gap-2.5 text-white">
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.1 }}
                >
                  <CheckCircle2 className="w-5 h-5" />
                </motion.div>
                <span className="font-bold">
                  {isWrapUnwrap ? `${isWrapping ? "Wrap" : "Unwrap"} Complete!` : "Swap Complete!"}
                </span>
              </div>
            </div>

            {/* HashScan link + New Swap */}
            <div className="flex items-center justify-between mt-2.5">
              {txUrl && lastTxId ? (
                <a
                  href={txUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                    isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-500"
                  }`}
                >
                  <ExternalLink className="w-3 h-3" />
                  View on HashScan
                </a>
              ) : <span />}
              <button
                onClick={onReset}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                  isDark ? "text-slate-400 hover:text-white hover:bg-slate-800/60" : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                }`}
              >
                New Swap
              </button>
            </div>
          </motion.div>

        /* ═══ ERROR ═══ */
        ) : status === "error" ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, x: 0 }}
            animate={{
              opacity: 1,
              x: [0, -6, 6, -4, 4, 0],
            }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.4 }}
          >
            <button
              onClick={onReset}
              className={`w-full rounded-2xl overflow-hidden transition-colors ${
                isDark
                  ? "bg-red-500/10 hover:bg-red-500/15 border border-red-500/20"
                  : "bg-red-50 hover:bg-red-100 border border-red-200"
              }`}
            >
              <div className="px-5 py-3.5">
                <div className="flex items-center justify-center gap-2">
                  <AlertCircle className={`w-4 h-4 ${isDark ? "text-red-400" : "text-red-500"}`} />
                  <span className={`text-sm font-bold ${isDark ? "text-red-400" : "text-red-600"}`}>
                    Swap Failed
                  </span>
                  <span className={`text-xs font-medium ml-1 ${isDark ? "text-red-400/50" : "text-red-400"}`}>
                    — tap to retry
                  </span>
                </div>
                {swapError && (
                  <p className={`mt-2 text-xs leading-relaxed break-words whitespace-pre-line text-center ${
                    isDark ? "text-red-400/70" : "text-red-500/80"
                  }`}>
                    {swapError.length > 150 ? swapError.slice(0, 150) + "..." : swapError}
                  </p>
                )}
              </div>
            </button>
          </motion.div>

        /* ═══ IDLE STATES ═══ */
        ) : idleVariant === "connect" ? (
          <motion.button
            key="connect"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            disabled
            className={`w-full py-4 rounded-2xl font-bold cursor-not-allowed relative overflow-hidden ${
              isDark
                ? "bg-slate-800/60 text-slate-400 border border-pink-500/10"
                : "bg-gray-50 text-gray-400 border border-pink-200/40"
            }`}
          >
            {/* Subtle pulse border glow */}
            <div
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{
                boxShadow: isDark
                  ? "inset 0 0 0 1px rgba(236,72,153,0.08)"
                  : "inset 0 0 0 1px rgba(236,72,153,0.06)",
                animation: "pulseGlow 3s ease-in-out infinite",
              }}
            />
            <div className="relative flex items-center justify-center gap-2">
              <Wallet className="w-4 h-4" />
              <span>Connect HashPack to Swap</span>
            </div>
          </motion.button>

        ) : idleVariant === "searching" ? (
          <motion.button
            key="searching"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            disabled
            className={`w-full py-3.5 rounded-2xl font-semibold cursor-wait ${
              isDark
                ? "bg-slate-800/50 text-slate-500 border border-white/[0.04]"
                : "bg-gray-50 text-gray-400 border border-gray-200"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Search className="w-3.5 h-3.5 animate-pulse" />
              <span className="text-sm">Finding route...</span>
            </div>
          </motion.button>

        ) : idleVariant === "noRoute" ? (
          <motion.button
            key="noRoute"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            disabled
            className={`w-full py-3.5 rounded-2xl font-semibold cursor-not-allowed ${
              isDark
                ? "bg-slate-800/50 text-slate-500 border border-white/[0.04]"
                : "bg-gray-50 text-gray-400 border border-gray-200"
            }`}
          >
            <div className="flex items-center justify-center gap-2 text-sm">
              <AlertCircle className="w-3.5 h-3.5" />
              No route available
            </div>
          </motion.button>

        ) : idleVariant === "gasReserve" ? (
          <motion.button
            key="gasReserve"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            disabled
            className={`w-full py-3.5 rounded-2xl font-semibold cursor-not-allowed ${
              isDark
                ? "bg-amber-500/8 text-amber-400/80 border border-amber-500/15"
                : "bg-amber-50 text-amber-600 border border-amber-200"
            }`}
          >
            <div className="flex items-center justify-center gap-2 text-sm">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>3 HBAR reserved for gas</span>
            </div>
          </motion.button>

        ) : idleVariant === "insufficient" ? (
          <motion.button
            key="insufficient"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            disabled
            className={`w-full py-3.5 rounded-2xl font-semibold cursor-not-allowed ${
              isDark
                ? "bg-red-500/8 text-red-400/80 border border-red-500/15"
                : "bg-red-50/80 text-red-500 border border-red-200"
            }`}
          >
            <div className="flex items-center justify-center gap-2 text-sm">
              <AlertCircle className="w-3.5 h-3.5" />
              Insufficient {inputToken.symbol}
            </div>
          </motion.button>

        ) : idleVariant === "noQuote" ? (
          <motion.button
            key="noQuote"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            disabled
            className={`w-full py-3.5 rounded-2xl font-semibold cursor-not-allowed ${
              isDark
                ? "bg-slate-800/50 text-slate-500 border border-white/[0.04]"
                : "bg-gray-50 text-gray-400 border border-gray-200"
            }`}
          >
            <div className="flex items-center justify-center gap-2 text-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Fetching quote...
            </div>
          </motion.button>

        ) : (
          /* ═══ READY — Main swap CTA ═══ */
          <motion.button
            key="swap"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={canSwap ? { scale: 1.01, y: -1 } : undefined}
            whileTap={canSwap ? { scale: 0.98 } : undefined}
            onClick={onSwap}
            disabled={!canSwap}
            onPointerEnter={onHover}
            className={`w-full py-4 rounded-2xl font-bold transition-all duration-300 relative overflow-hidden ${
              !canSwap
                ? isDark
                  ? "bg-slate-800/60 text-slate-500 border border-white/[0.04] cursor-not-allowed"
                  : "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed"
                : isWrapUnwrap
                ? "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-500/25"
                : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/25"
            }`}
          >
            {/* Animated shimmer sweep */}
            {canSwap && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)",
                  backgroundSize: "250% 100%",
                  animation: "shimmerFlow 2.5s ease-in-out infinite",
                }}
              />
            )}

            <span className="relative flex items-center justify-center gap-2">
              {isWrapUnwrap ? (
                <>
                  {swapLabel}
                  <ArrowRight className="w-4 h-4" />
                  {outputToken.symbol}
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  {swapLabel} {inputToken.symbol}
                  <ArrowRight className="w-4 h-4 opacity-60" />
                  {outputToken.symbol}
                </>
              )}
            </span>

            {/* Integrated approval hint — subtle text below main label */}
            {!isWrapUnwrap && approvalNeeded !== null && canSwap && (
              <span className={`relative block text-[10px] font-medium mt-0.5 ${
                approvalNeeded === false ? "text-white/40" : "text-white/35"
              }`}>
                {approvalNeeded === false ? "1-click — already approved" : "2 signatures required"}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Keyframe styles (injected once) ── */}
      <style>{`
        @keyframes shimmerFlow {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
});

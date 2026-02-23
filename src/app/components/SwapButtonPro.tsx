/**
 * SwapButtonPro — Premium animated swap execution button.
 *
 * States: idle, processing (with step tracker), success, error,
 * not connected, no route, insufficient balance.
 *
 * Features:
 * - Gradient shimmer on hover
 * - Processing pulse animation with step description
 * - [C108-S13] "Open Wallet" button appears after 3s if no wallet response
 * - [C108-S13] Cleaner step descriptions: "Step 1 of 2: Approving SAUCE..."
 * - Success ripple effect
 * - Smooth state transitions
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
  ExternalLink as OpenIcon,
} from "lucide-react";
import type { AllowedToken } from "../utils/saucerswap";

/** [C108-S13] How long to wait before showing "Open Wallet" button (ms) */
const WALLET_OPEN_DELAY_MS = 3000;

interface SwapButtonProProps {
  status: "idle" | "processing" | "success" | "error";
  canSwap: boolean;
  isWalletConnected: boolean;
  isWrapUnwrap: boolean;
  isWrapping: boolean;
  inputToken: AllowedToken;
  outputToken: AllowedToken;
  // Route state
  hasRoute: boolean;
  routeSearching: boolean;
  insufficientBalance: boolean;
  // [C93] Quote validation
  hasValidOutput: boolean;
  // Swap step tracking
  swapStep: { step: number; total: number; description: string } | null;
  // Error
  swapError: string | null;
  // Transaction
  lastTxId: string | null;
  txUrl: string | null;
  // Handlers
  onSwap: () => void;
  onReset: () => void;
  /** [C81-01] Called on pointerEnter to pre-warm WC relay before click */
  onHover?: () => void;
  /** [C108-S13] Called to attempt opening the wallet app/extension */
  onOpenWallet?: () => void;
  isDark: boolean;
  /** [C100-S11] Pre-flight approval status: true=needs approve popup, false=1-click swap, null=unknown */
  approvalNeeded?: boolean | null;
}

/**
 * [C108-S13] Clean up internal technical descriptions to user-friendly text.
 * Strip "via V2 Router", "via V1 Router", "(atomic)", "(multi-hop)", etc.
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
  // After 3s of processing with no wallet response, show "Open Wallet" button.
  const [showOpenWallet, setShowOpenWallet] = useState(false);
  const walletTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStepRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === "processing") {
      // Reset timer whenever a NEW step arrives (wallet responded to previous step)
      const currentStep = swapStep?.step ?? null;
      if (currentStep !== lastStepRef.current) {
        lastStepRef.current = currentStep;
        setShowOpenWallet(false);
        if (walletTimerRef.current) clearTimeout(walletTimerRef.current);
        walletTimerRef.current = setTimeout(() => {
          setShowOpenWallet(true);
        }, WALLET_OPEN_DELAY_MS);
      }
    } else {
      // Not processing — clear everything
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

  // ── [C108-S13] Build human-friendly step label ──
  const stepLabel = swapStep
    ? `Step ${swapStep.step} of ${swapStep.total}: ${humanizeDescription(swapStep.description)}`
    : "Preparing transaction...";

  return (
    <div className="mt-5 space-y-2">
      <AnimatePresence mode="wait">
        {status === "processing" ? (
          <motion.div
            key="processing"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <button
              disabled
              className={`w-full py-4 rounded-2xl font-bold cursor-wait relative overflow-hidden ${
                isDark
                  ? "bg-gradient-to-r from-amber-600/90 to-yellow-500/90 text-white"
                  : "bg-gradient-to-r from-amber-500 to-yellow-400 text-white"
              }`}
            >
              {/* Shimmer */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2s_infinite]" />
              
              <div className="relative flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">{stepLabel}</span>
                </div>

                {/* Step progress dots */}
                {swapStep && swapStep.total > 1 && (
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: swapStep.total }).map((_, i) => (
                      <div
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full transition-all ${
                          i < swapStep.step
                            ? "bg-white scale-100"
                            : i === swapStep.step
                            ? "bg-white/60 scale-110 animate-pulse"
                            : "bg-white/20"
                        }`}
                      />
                    ))}
                  </div>
                )}

                {/* [C108-S13] "Waiting for wallet..." + sub-hint */}
                <span className="text-xs text-amber-200/70 font-normal">
                  Sign in your HashPack wallet to continue
                </span>
              </div>
            </button>

            {/* [C108-S13] "Open Wallet" button — appears after 3s delay */}
            <AnimatePresence>
              {showOpenWallet && onOpenWallet && (
                <motion.button
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: "auto", marginTop: 8 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  onClick={onOpenWallet}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                    isDark
                      ? "bg-white/10 hover:bg-white/15 text-amber-300 border border-amber-500/20"
                      : "bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-300"
                  }`}
                >
                  <Wallet className="w-4 h-4" />
                  Open Wallet
                  <OpenIcon className="w-3.5 h-3.5 opacity-60" />
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        ) : status === "success" ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <button
              disabled
              className="w-full py-4 rounded-2xl font-bold bg-gradient-to-r from-emerald-600 to-green-500 text-white relative overflow-hidden"
            >
              <div className="absolute bottom-0 left-0 h-[3px] bg-white/30 animate-[shrink_5s_linear_forwards]" style={{ width: "100%" }} />
              <div className="flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>{isWrapUnwrap ? `${isWrapping ? "Wrap" : "Unwrap"} Complete!` : "Swap Complete!"}</span>
              </div>
            </button>
            {txUrl && lastTxId && (
              <motion.a
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                href={txUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-1.5 mt-2 text-xs font-medium transition-colors ${
                  isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-500"
                }`}
              >
                <ExternalLink className="w-3 h-3" />
                View on HashScan
              </motion.a>
            )}
            <button
              onClick={onReset}
              className={`w-full mt-2 py-2 rounded-xl text-xs font-medium transition-colors ${
                isDark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              New Swap
            </button>
          </motion.div>
        ) : status === "error" ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <button
              disabled
              className="w-full py-4 rounded-2xl font-bold bg-gradient-to-r from-red-600 to-orange-500 text-white relative overflow-hidden"
            >
              <div className="absolute bottom-0 left-0 h-[3px] bg-white/30 animate-[shrink_5s_linear_forwards]" style={{ width: "100%" }} />
              <div className="flex items-center justify-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Swap Failed
              </div>
            </button>
            {swapError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className={`flex items-start gap-1.5 mt-2 p-2.5 rounded-xl text-xs ${
                  isDark ? "bg-red-500/8 border border-red-500/15 text-red-400" : "bg-red-50 border border-red-200 text-red-600"
                }`}
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="break-words whitespace-pre-line leading-relaxed">{swapError}</span>
              </motion.div>
            )}
            <button
              onClick={onReset}
              className={`w-full mt-2 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                isDark
                  ? "bg-white/10 hover:bg-white/15 text-white border border-white/10"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
              }`}
            >
              Try Again
            </button>
          </motion.div>
        ) : !isWalletConnected ? (
          <motion.button
            key="connect"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            disabled
            className={`w-full py-4 rounded-2xl font-bold cursor-not-allowed ${
              isDark ? "bg-slate-800/80 text-slate-500 border border-white/[0.04]" : "bg-gray-100 text-gray-400 border border-gray-200"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Wallet className="w-4 h-4" />
              Connect HashPack to Swap
            </div>
          </motion.button>
        ) : !hasRoute && !isWrapUnwrap ? (
          <motion.button
            key="noroute"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            disabled
            className={`w-full py-4 rounded-2xl font-bold cursor-not-allowed ${
              isDark ? "bg-slate-800/80 text-slate-500 border border-white/[0.04]" : "bg-gray-100 text-gray-400 border border-gray-200"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              {routeSearching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Checking Route...</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4" />
                  <span>No Route Available</span>
                </>
              )}
            </div>
          </motion.button>
        ) : insufficientBalance ? (
          <motion.button
            key="insufficient"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            disabled
            className={`w-full py-4 rounded-2xl font-bold cursor-not-allowed ${
              isDark
                ? "bg-red-900/30 text-red-400 border border-red-500/15"
                : "bg-red-50 text-red-500 border border-red-200"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Insufficient {inputToken.symbol} Balance
            </div>
          </motion.button>
        ) : !hasValidOutput && hasRoute ? (
          <motion.button
            key="noquote"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            disabled
            className={`w-full py-4 rounded-2xl font-bold cursor-not-allowed ${
              isDark
                ? "bg-amber-900/20 text-amber-400 border border-amber-500/15"
                : "bg-amber-50 text-amber-600 border border-amber-200"
            }`}
          >
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>Quote Unavailable</span>
              </div>
              <span className={`text-xs font-normal ${
                isDark ? "text-amber-400/60" : "text-amber-500/80"
              }`}>
                No price data for {inputToken.symbol}/{outputToken.symbol} — try a different pair or amount
              </span>
            </div>
          </motion.button>
        ) : (
          <motion.button
            key="swap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileHover={canSwap ? { scale: 1.01 } : undefined}
            whileTap={canSwap ? { scale: 0.98 } : undefined}
            onClick={onSwap}
            disabled={!canSwap}
            className={`w-full py-4 rounded-2xl font-bold transition-all duration-300 relative overflow-hidden ${
              !canSwap
                ? isDark
                  ? "bg-slate-800/80 text-slate-500 border border-white/[0.04] cursor-not-allowed"
                  : "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed"
                : isWrapUnwrap
                ? "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-500/20"
                : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/20"
            }`}
            onPointerEnter={onHover}
          >
            {/* Hover shimmer */}
            {canSwap && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent translate-x-[-100%] hover:translate-x-[100%] transition-transform duration-700" />
            )}
            <span className="relative flex items-center justify-center gap-2">
              {isWrapUnwrap ? (
                <>
                  {isWrapping ? "Wrap" : "Unwrap"} {inputToken.symbol}
                  <ArrowRight className="w-4 h-4" />
                  {outputToken.symbol}
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  {approvalNeeded === false ? (
                    <>Swap {inputToken.symbol}</>
                  ) : approvalNeeded === true ? (
                    <>Approve & Swap {inputToken.symbol}</>
                  ) : (
                    <>Swap {inputToken.symbol}</>
                  )}
                  <ArrowRight className="w-4 h-4" />
                  {outputToken.symbol}
                </>
              )}
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* [C100-S11] Pre-flight popup count indicator */}
      {status === "idle" && canSwap && !isWrapUnwrap && approvalNeeded !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`flex items-center justify-center gap-1.5 text-[11px] font-medium ${
            approvalNeeded === false
              ? isDark ? "text-emerald-400/70" : "text-emerald-600/70"
              : isDark ? "text-amber-400/60" : "text-amber-600/60"
          }`}
        >
          {approvalNeeded === false ? (
            <>
              <CheckCircle2 className="w-3 h-3" />
              1-click swap — already approved
            </>
          ) : (
            <>
              <Zap className="w-3 h-3" />
              2 signatures — approve + swap
            </>
          )}
        </motion.div>
      )}
    </div>
  );
});
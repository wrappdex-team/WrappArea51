/**
 * QuoteDetailsPro — Premium quote summary panel with visual confidence meter.
 *
 * Shows:
 * - Exchange rate
 * - Price impact (color-coded bar)
 * - Minimum received
 * - Slippage tolerance
 * - Quote confidence (visual arc meter)
 * - Quote refresh countdown (circular progress)
 * - Scored route comparison (expandable)
 */

import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield,
  AlertCircle,
  ChevronDown,
  Droplets,
  RefreshCw,
  TrendingDown,
  Clock,
  Zap,
} from "lucide-react";
import { Tip } from "./Tip";
import type { SwapQuote, ScoredRouteInfo, AllowedToken } from "../utils/saucerswap";

interface QuoteDetailsProProps {
  quote: SwapQuote;
  inputToken: AllowedToken;
  outputToken: AllowedToken;
  effectiveSlippage: number;
  isWrapUnwrap: boolean;
  isDark: boolean;
  // Countdown
  quoteCountdown: number;
  maxCountdown: number;
  onRefresh: () => void;
  // Auto-slippage
  autoSlippageWarning: { recommended: number; message: string } | null;
  onSetSlippage: (val: number) => void;
  // Scored routes
  scoredRoutes: ScoredRouteInfo[];
  showRouteComparison: boolean;
  onToggleRouteComparison: () => void;
}

export const QuoteDetailsPro = memo(function QuoteDetailsPro({
  quote,
  inputToken,
  outputToken,
  effectiveSlippage,
  isWrapUnwrap,
  isDark,
  quoteCountdown,
  maxCountdown,
  onRefresh,
  autoSlippageWarning,
  onSetSlippage,
  scoredRoutes,
  showRouteComparison,
  onToggleRouteComparison,
}: QuoteDetailsProProps) {
  // Price impact color
  const impactColor = useMemo(() => {
    if (quote.priceImpact > 5) return { text: "text-red-400", bg: "bg-red-500", label: "High" };
    if (quote.priceImpact > 2) return { text: "text-amber-400", bg: "bg-amber-500", label: "Moderate" };
    if (quote.priceImpact > 0.5) return { text: "text-yellow-400", bg: "bg-yellow-500", label: "Low" };
    return { text: "text-emerald-400", bg: "bg-emerald-500", label: "Minimal" };
  }, [quote.priceImpact]);

  // Confidence config
  const confidenceConfig = useMemo(() => {
    if (quote.confidence === "high") return {
      color: isDark ? "text-emerald-400" : "text-emerald-600",
      bg: isDark ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200",
      label: "On-chain",
      icon: Shield,
      tip: `On-chain quote via ${quote.quoteSource || "router"}${quote.serverDurationMs ? ` (${quote.serverDurationMs}ms)` : ""}`,
    };
    if (quote.confidence === "medium") return {
      color: isDark ? "text-blue-400" : "text-blue-600",
      bg: isDark ? "bg-blue-500/10 border-blue-500/20" : "bg-blue-50 border-blue-200",
      label: "API",
      icon: Zap,
      tip: `API quote via ${quote.quoteSource || "SaucerSwap"}${quote.serverDurationMs ? ` (${quote.serverDurationMs}ms)` : ""}`,
    };
    return {
      color: isDark ? "text-amber-400" : "text-amber-600",
      bg: isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200",
      label: "Estimate",
      icon: Clock,
      tip: "Price-based estimate -- actual output may differ",
    };
  }, [quote.confidence, quote.quoteSource, quote.serverDurationMs, isDark]);

  const ConfIcon = confidenceConfig.icon;

  // Countdown progress (0 to 1)
  const countdownProgress = quoteCountdown / maxCountdown;
  const countdownUrgent = quoteCountdown <= 5;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className={`mt-3 rounded-xl overflow-hidden ${
        isDark
          ? "bg-slate-800/30 border border-white/[0.04]"
          : "bg-gray-50/80 border border-gray-100"
      }`}
    >
      <div className="p-3.5 space-y-2.5 text-sm">
        {/* Rate */}
        <Row isDark={isDark} label="Rate">
          <span className={`font-medium ${isDark ? "text-white" : "text-slate-800"}`}>
            1 {inputToken.symbol} ={" "}
            {quote.executionPrice >= 1
              ? quote.executionPrice.toFixed(4)
              : quote.executionPrice.toFixed(8)}{" "}
            {outputToken.symbol}
          </span>
        </Row>

        {!isWrapUnwrap && (
          <>
            {/* Price Impact with visual bar */}
            <Row isDark={isDark} label="Price Impact">
              <div className="flex items-center gap-2">
                <span className={`font-medium ${impactColor.text}`}>
                  {quote.priceImpact.toFixed(3)}%
                </span>
                <div className={`w-16 h-1.5 rounded-full overflow-hidden ${
                  isDark ? "bg-slate-700/50" : "bg-gray-200"
                }`}>
                  <motion.div
                    className={`h-full rounded-full ${impactColor.bg}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, quote.priceImpact * 10)}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </div>
                <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {impactColor.label}
                </span>
              </div>
            </Row>

            {/* Min received */}
            <Row isDark={isDark} label="Min. Received">
              <div className="flex items-center gap-1">
                <TrendingDown className={`w-3 h-3 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                <span className={`font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                  {quote.minimumOutput >= 1
                    ? quote.minimumOutput.toFixed(4)
                    : quote.minimumOutput.toFixed(8)}{" "}
                  {outputToken.symbol}
                </span>
              </div>
            </Row>

            {/* Slippage */}
            <Row isDark={isDark} label="Slippage">
              <span className={`font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                {effectiveSlippage}%
              </span>
            </Row>

            {/* Confidence badge */}
            <Row isDark={isDark} label="Quote">
              <Tip content={confidenceConfig.tip} side="top">
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold border ${confidenceConfig.bg} ${confidenceConfig.color}`}>
                  <ConfIcon className="w-2.5 h-2.5" />
                  {confidenceConfig.label}
                </span>
              </Tip>
            </Row>

            {/* Auto-slippage warning */}
            <AnimatePresence>
              {autoSlippageWarning && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${
                    isDark
                      ? "bg-amber-500/8 border border-amber-500/20 text-amber-300"
                      : "bg-amber-50 border border-amber-200 text-amber-700"
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                  <div className="flex-1">
                    <span>{autoSlippageWarning.message}</span>
                    <button
                      onClick={() => onSetSlippage(autoSlippageWarning.recommended)}
                      className={`ml-1.5 font-bold underline underline-offset-2 transition-colors ${
                        isDark ? "text-amber-300 hover:text-amber-200" : "text-amber-800 hover:text-amber-900"
                      }`}
                    >
                      Set to {autoSlippageWarning.recommended}%
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scored route comparison */}
            {scoredRoutes.length > 1 && (
              <div className={`pt-2 border-t ${isDark ? "border-white/[0.04]" : "border-gray-100"}`}>
                <button
                  onClick={onToggleRouteComparison}
                  className={`flex items-center gap-1.5 text-xs w-full transition-colors ${
                    isDark ? "text-purple-400 hover:text-purple-300" : "text-purple-600 hover:text-purple-700"
                  }`}
                >
                  <Droplets className="w-3 h-3" />
                  <span className="font-semibold">Compare {scoredRoutes.length} routes</span>
                  <ChevronDown className={`w-3 h-3 ml-auto transition-transform duration-200 ${showRouteComparison ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence>
                  {showRouteComparison && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 space-y-1.5 overflow-hidden"
                    >
                      {scoredRoutes.slice(0, 3).map((sr, idx) => {
                        const isBest = idx === 0;
                        const outputLabel = sr.humanOutput >= 1
                          ? sr.humanOutput.toFixed(4)
                          : sr.humanOutput.toFixed(8);
                        return (
                          <motion.div
                            key={`${sr.source}-${idx}`}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className={`p-2.5 rounded-lg text-xs ${
                              isBest
                                ? isDark ? "bg-emerald-500/8 border border-emerald-500/15" : "bg-emerald-50 border border-emerald-200"
                                : isDark ? "bg-slate-800/30 border border-white/[0.03]" : "bg-white border border-gray-100"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                {isBest && (
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                                    isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                                  }`}>BEST</span>
                                )}
                                <span className={`font-semibold ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                                  {sr.label}
                                </span>
                              </div>
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
                                sr.confidence === "high"
                                  ? isDark ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : sr.confidence === "medium"
                                  ? isDark ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-blue-50 text-blue-700 border-blue-200"
                                  : isDark ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}>
                                <Shield className="w-2 h-2" />
                                {sr.confidence === "high" ? "On-chain" : sr.confidence === "medium" ? "API" : "Est."}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                                {outputLabel} {outputToken?.symbol}
                              </span>
                              <span className={`${
                                sr.priceImpact > 2 ? "text-red-400" : sr.priceImpact > 0.5 ? "text-amber-400" : isDark ? "text-slate-500" : "text-gray-400"
                              }`}>
                                {sr.priceImpact > 0 ? `${sr.priceImpact.toFixed(2)}% impact` : `${sr.hops} hop${sr.hops !== 1 ? "s" : ""}`}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </>
        )}

        {/* Quote refresh with circular countdown */}
        <div className={`pt-2 border-t flex items-center justify-between ${
          isDark ? "border-white/[0.04]" : "border-gray-100"
        }`}>
          <div className="flex items-center gap-2">
            {/* Circular countdown */}
            <div className="relative w-5 h-5">
              <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                <circle
                  cx="10" cy="10" r="8"
                  fill="none"
                  stroke={isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}
                  strokeWidth="2"
                />
                <circle
                  cx="10" cy="10" r="8"
                  fill="none"
                  stroke={countdownUrgent ? "#f59e0b" : isDark ? "#ec4899" : "#db2777"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 8}`}
                  strokeDashoffset={`${2 * Math.PI * 8 * (1 - countdownProgress)}`}
                  className="transition-all duration-1000 ease-linear"
                />
              </svg>
              <span className={`absolute inset-0 flex items-center justify-center text-[8px] font-bold ${
                countdownUrgent
                  ? "text-amber-400"
                  : isDark ? "text-slate-400" : "text-gray-500"
              }`}>
                {quoteCountdown}
              </span>
            </div>
            <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {countdownUrgent ? "Refreshing soon..." : "Quote refreshes"}
            </span>
          </div>
          <Tip content="Refresh quote now" side="top">
            <button
              onClick={onRefresh}
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg font-medium transition-all ${
                isDark
                  ? "text-pink-400 hover:bg-pink-500/10 hover:text-pink-300"
                  : "text-pink-600 hover:bg-pink-50 hover:text-pink-700"
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${countdownUrgent ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </Tip>
        </div>
      </div>
    </motion.div>
  );
});

// ── Helper: Row layout ──────────────────────────────────────────────

function Row({ isDark, label, children }: { isDark: boolean; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{label}</span>
      {children}
    </div>
  );
}
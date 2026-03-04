/**
 * QuoteDetailsPro — Minimal expandable quote details panel.
 *
 * SESSION 6 redesign:
 * - Collapsed: exchange rate + micro countdown ring + confidence dot + chevron
 * - Expanded: compact 2-column grid for key metrics, contextual warning banners,
 *   route comparison sub-section, inline refresh
 * - Slippage controls removed (moved to SettingsDrawer in Session 4)
 * - Overall lighter feel with less visual noise
 */

import { memo, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Droplets,
  RefreshCw,
  TrendingDown,
  Clock,
  Zap,
  Info,
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
  quoteCountdown: number;
  maxCountdown: number;
  onRefresh: () => void;
  autoSlippageWarning: { recommended: number; message: string } | null;
  onSetSlippage: (val: number) => void;
  scoredRoutes: ScoredRouteInfo[];
  showRouteComparison: boolean;
  onToggleRouteComparison: () => void;
  // Legacy props kept for SwapPanel compatibility — slippage editing now in SettingsDrawer
  slippage: number;
  customSlippage: string;
  onSetCustomSlippage: (val: string) => void;
  feeOnTransfer?: {
    detected: boolean;
    totalFeePercent: number;
    summary: string;
  };
  quoteStale?: boolean;
  routeDegradation?: {
    v2Amount: number;
    v1Amount: number;
    outputSymbol: string;
    outputDecimals: number;
  } | null;
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
  feeOnTransfer,
  quoteStale,
  routeDegradation,
}: QuoteDetailsProProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isHighSlippage = effectiveSlippage > 5;

  // Price impact tier
  const impactTier = useMemo(() => {
    if (quote.priceImpact > 5) return { text: "text-red-400", bg: "bg-red-500", dot: "bg-red-400", label: "High" };
    if (quote.priceImpact > 2) return { text: "text-amber-400", bg: "bg-amber-500", dot: "bg-amber-400", label: "Moderate" };
    if (quote.priceImpact > 0.5) return { text: "text-yellow-400", bg: "bg-yellow-500", dot: "bg-yellow-400", label: "Low" };
    return { text: "text-emerald-400", bg: "bg-emerald-500", dot: "bg-emerald-400", label: "Minimal" };
  }, [quote.priceImpact]);

  // Confidence config — reuse for dot + expanded badge
  const conf = useMemo(() => {
    if (quote.confidence === "high") return {
      dot: "bg-emerald-400", color: isDark ? "text-emerald-400" : "text-emerald-600",
      bg: isDark ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200",
      label: "On-chain", icon: Shield,
      tip: `On-chain quote via ${quote.quoteSource || "router"}${quote.serverDurationMs ? ` (${quote.serverDurationMs}ms)` : ""}`,
    };
    if (quote.confidence === "medium") return {
      dot: "bg-blue-400", color: isDark ? "text-blue-400" : "text-blue-600",
      bg: isDark ? "bg-blue-500/10 border-blue-500/20" : "bg-blue-50 border-blue-200",
      label: "API", icon: Zap,
      tip: `API quote via ${quote.quoteSource || "SaucerSwap"}${quote.serverDurationMs ? ` (${quote.serverDurationMs}ms)` : ""}`,
    };
    return {
      dot: "bg-amber-400", color: isDark ? "text-amber-400" : "text-amber-600",
      bg: isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200",
      label: "Estimate", icon: Clock,
      tip: "Price-based estimate — actual output may differ",
    };
  }, [quote.confidence, quote.quoteSource, quote.serverDurationMs, isDark]);

  const ConfIcon = conf.icon;

  // Countdown
  const countdownProgress = quoteCountdown / maxCountdown;
  const countdownUrgent = quoteCountdown <= 5;

  // Rate string
  const rateString = useMemo(() => {
    const price = quote.executionPrice >= 1
      ? quote.executionPrice.toFixed(4)
      : quote.executionPrice.toFixed(8);
    return `1 ${inputToken.symbol} = ${price} ${outputToken.symbol}`;
  }, [quote.executionPrice, inputToken.symbol, outputToken.symbol]);

  // How many warnings are active
  const hasWarnings = !!(feeOnTransfer?.detected || routeDegradation || autoSlippageWarning);

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
      {/* ── Collapsed header — always visible ── */}
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        className={`w-full flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2 transition-colors ${
          isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-100/60"
        }`}
      >
        {/* Micro countdown ring */}
        <Tip content={quoteStale ? "Updating quote..." : `Refreshes in ${quoteCountdown}s`} side="top">
          <div className="relative w-4 h-4 shrink-0">
            <svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
              <circle
                cx="8" cy="8" r="6" fill="none"
                stroke={isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}
                strokeWidth="1.5"
              />
              <circle
                cx="8" cy="8" r="6" fill="none"
                stroke={countdownUrgent ? "#f59e0b" : isDark ? "rgba(236,72,153,0.5)" : "rgba(219,39,119,0.4)"}
                strokeWidth="1.5" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 6}`}
                strokeDashoffset={`${2 * Math.PI * 6 * (1 - countdownProgress)}`}
                className="transition-all duration-1000 ease-linear"
              />
            </svg>
            {quoteStale && (
              <RefreshCw className="absolute inset-0 m-auto w-2 h-2 text-amber-400 animate-spin" />
            )}
          </div>
        </Tip>

        {/* Rate */}
        <span className={`text-xs font-medium truncate min-w-0 flex-1 text-left ${
          isDark ? "text-slate-300" : "text-slate-600"
        }`}>
          {rateString}
        </span>

        {/* Right side badges */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Warning dot */}
          {hasWarnings && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          )}
          {/* Slippage chip */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            isHighSlippage
              ? isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"
              : isDark ? "bg-slate-700/60 text-slate-500" : "bg-gray-200/80 text-gray-400"
          }`}>
            {effectiveSlippage}%
          </span>
          {/* Confidence dot */}
          {!isWrapUnwrap && (
            <Tip content={conf.tip} side="top">
              <span className={`w-2 h-2 rounded-full ${conf.dot}`} />
            </Tip>
          )}
          {/* Chevron */}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${
            isDark ? "text-slate-500" : "text-gray-400"
          } ${isExpanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* ── Expandable details ── */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className={`px-2.5 sm:px-3.5 pb-3 ${
              isDark ? "border-t border-white/[0.04]" : "border-t border-gray-100"
            }`}>
              {/* ── Contextual warnings ── */}
              {hasWarnings && (
                <div className="pt-2.5 space-y-2">
                  {feeOnTransfer?.detected && (
                    <WarningBanner isDark={isDark} variant="amber" icon={<AlertTriangle className="w-3 h-3 shrink-0" />}>
                      <b>Transfer Fee Token</b> — ~{feeOnTransfer.totalFeePercent.toFixed(1)}% custom fee. Slippage adjusted automatically.
                    </WarningBanner>
                  )}
                  {routeDegradation && (
                    <WarningBanner isDark={isDark} variant="blue" icon={<Info className="w-3 h-3 shrink-0" />}>
                      <b>V1 Routing</b> — V2 would give ~{formatNum(routeDegradation.v2Amount)} {routeDegradation.outputSymbol}, V1 delivers ~{formatNum(routeDegradation.v1Amount)} ({((1 - routeDegradation.v1Amount / routeDegradation.v2Amount) * 100).toFixed(0)}% less).
                    </WarningBanner>
                  )}
                  {autoSlippageWarning && (
                    <WarningBanner isDark={isDark} variant="amber" icon={<AlertCircle className="w-3 h-3 shrink-0" />}>
                      {autoSlippageWarning.message}{" "}
                      <button
                        onClick={() => onSetSlippage(autoSlippageWarning.recommended)}
                        className={`font-bold underline underline-offset-2 ${
                          isDark ? "text-amber-300 hover:text-amber-200" : "text-amber-800 hover:text-amber-900"
                        }`}
                      >
                        Set to {autoSlippageWarning.recommended}%
                      </button>
                    </WarningBanner>
                  )}
                </div>
              )}

              {/* ── Key metrics grid ── */}
              {!isWrapUnwrap && (
                <div className={`grid grid-cols-2 gap-x-4 gap-y-2 pt-2.5 ${
                  hasWarnings ? `mt-2 border-t ${isDark ? "border-white/[0.04]" : "border-gray-100"}` : ""
                }`}>
                  {/* Price impact */}
                  <MetricCell isDark={isDark} label="Price Impact">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-semibold ${impactTier.text}`}>
                        {quote.priceImpact.toFixed(3)}%
                      </span>
                      <div className={`w-10 h-1 rounded-full overflow-hidden ${
                        isDark ? "bg-slate-700/50" : "bg-gray-200"
                      }`}>
                        <motion.div
                          className={`h-full rounded-full ${impactTier.bg}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, quote.priceImpact * 10)}%` }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                    </div>
                  </MetricCell>

                  {/* Confidence */}
                  <MetricCell isDark={isDark} label="Quote">
                    <Tip content={conf.tip} side="top">
                      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${conf.bg} ${conf.color}`}>
                        <ConfIcon className="w-2.5 h-2.5" />
                        {conf.label}
                      </span>
                    </Tip>
                  </MetricCell>

                  {/* Min received */}
                  <MetricCell isDark={isDark} label="Min. Received">
                    <span className={`text-xs font-medium flex items-center gap-1 ${
                      isDark ? "text-slate-200" : "text-slate-700"
                    }`}>
                      <TrendingDown className={`w-3 h-3 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                      {formatNum(quote.minimumOutput)} {outputToken.symbol}
                    </span>
                  </MetricCell>

                  {/* Slippage */}
                  <MetricCell isDark={isDark} label="Slippage">
                    <span className={`text-xs font-semibold ${
                      isHighSlippage
                        ? "text-amber-400"
                        : isDark ? "text-slate-200" : "text-slate-700"
                    }`}>
                      {effectiveSlippage}%
                    </span>
                  </MetricCell>
                </div>
              )}

              {/* ── Route comparison ── */}
              {scoredRoutes.length > 1 && (
                <div className={`pt-2 mt-2 border-t ${isDark ? "border-white/[0.04]" : "border-gray-100"}`}>
                  <button
                    onClick={onToggleRouteComparison}
                    className={`flex items-center gap-1.5 text-[11px] w-full transition-colors ${
                      isDark ? "text-purple-400 hover:text-purple-300" : "text-purple-600 hover:text-purple-700"
                    }`}
                  >
                    <Droplets className="w-3 h-3" />
                    <span className="font-semibold">Compare {scoredRoutes.length} routes</span>
                    <ChevronDown className={`w-3 h-3 ml-auto transition-transform duration-200 ${
                      showRouteComparison ? "rotate-180" : ""
                    }`} />
                  </button>

                  <AnimatePresence>
                    {showRouteComparison && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-1.5 space-y-1 overflow-hidden"
                      >
                        {scoredRoutes.slice(0, 3).map((sr, idx) => {
                          const isBest = idx === 0;
                          return (
                            <motion.div
                              key={`${sr.source}-${idx}`}
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: idx * 0.04 }}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] ${
                                isBest
                                  ? isDark ? "bg-emerald-500/8 border border-emerald-500/15" : "bg-emerald-50 border border-emerald-200"
                                  : isDark ? "bg-slate-800/30 border border-white/[0.03]" : "bg-white border border-gray-100"
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                {isBest && (
                                  <span className={`text-[8px] px-1 py-px rounded font-bold ${
                                    isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                                  }`}>BEST</span>
                                )}
                                <span className={`font-semibold ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                                  {sr.label}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                                  {formatNum(sr.humanOutput)} {outputToken?.symbol}
                                </span>
                                <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium border ${
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
                            </motion.div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* ── Inline refresh ── */}
              <div className={`flex items-center justify-between pt-2 mt-2 border-t ${
                isDark ? "border-white/[0.04]" : "border-gray-100"
              }`}>
                <span className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                  {quoteStale ? "Updating..." : `Refreshes in ${quoteCountdown}s`}
                </span>
                <button
                  onClick={onRefresh}
                  className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium transition-all ${
                    isDark
                      ? "text-pink-400 hover:bg-pink-500/10"
                      : "text-pink-600 hover:bg-pink-50"
                  }`}
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${quoteStale ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// ── Helpers ──────────────────────────────────────────────────────────

function formatNum(n: number): string {
  return n >= 1 ? n.toFixed(4) : n.toFixed(8);
}

/** Compact metric cell for the 2-column grid */
function MetricCell({ isDark, label, children }: { isDark: boolean; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-[10px] font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        {label}
      </span>
      {children}
    </div>
  );
}

/** Contextual warning banner */
function WarningBanner({
  isDark, variant, icon, children,
}: {
  isDark: boolean;
  variant: "amber" | "blue";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const colors = variant === "amber"
    ? isDark ? "bg-amber-500/8 border-amber-500/15 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-700"
    : isDark ? "bg-blue-500/8 border-blue-500/15 text-blue-300" : "bg-blue-50 border-blue-200 text-blue-700";

  return (
    <div className={`flex items-start gap-1.5 px-2.5 py-2 rounded-lg text-[11px] leading-relaxed border ${colors}`}>
      <span className="mt-0.5">{icon}</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}
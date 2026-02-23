/**
 * QuoteDetailsPro — Unified collapsible quote + settings panel.
 *
 * Collapsed (default): Compact header with rate, slippage badge, confidence badge, chevron.
 * Expanded:            Full details — price impact, min received, slippage tolerance
 *                      pills, confidence, auto-slippage warning, route comparison,
 *                      quote refresh countdown, and exact-approval info.
 */

import { memo, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
  Settings2,
} from "lucide-react";
import { Tip } from "./Tip";
import type { SwapQuote, ScoredRouteInfo, AllowedToken } from "../utils/saucerswap";

const SLIPPAGE_OPTIONS = [1.0, 3.0];

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
  // Slippage settings (merged from SlippageSettingsPro)
  slippage: number;
  customSlippage: string;
  onSetCustomSlippage: (val: string) => void;
  // [FOT] Fee-on-transfer token info
  feeOnTransfer?: {
    detected: boolean;
    totalFeePercent: number;
    summary: string;
  };
  // [Step 16] Quote freshness — true when TTL expired and prices are refreshing
  quoteStale?: boolean;
  // [V1-DEGRADE] Route degradation info — shown when V2 multi-hop is forced to V1
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
  slippage,
  customSlippage,
  onSetCustomSlippage,
  feeOnTransfer,
  quoteStale,
  routeDegradation,
}: QuoteDetailsProProps) {
  // ── Collapsed by default ──
  const [isExpanded, setIsExpanded] = useState(false);

  const isCustom = !!customSlippage;
  const isHighSlippage = effectiveSlippage > 5;

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

  // Formatted rate string (reused in collapsed header)
  const rateString = useMemo(() => {
    const price = quote.executionPrice >= 1
      ? quote.executionPrice.toFixed(4)
      : quote.executionPrice.toFixed(8);
    return `1 ${inputToken.symbol} = ${price} ${outputToken.symbol}`;
  }, [quote.executionPrice, inputToken.symbol, outputToken.symbol]);

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
      {/* ── Clickable collapsed header — always visible ── */}
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm transition-colors ${
          isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-100/60"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Info className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
          <span className={`font-medium truncate ${isDark ? "text-slate-300" : "text-slate-600"}`}>
            {rateString}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {/* Slippage badge */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            isHighSlippage
              ? isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"
              : isDark ? "bg-slate-700/60 text-slate-500" : "bg-gray-200/80 text-gray-400"
          }`}>
            {effectiveSlippage}%
          </span>
          {/* [FOT] Fee token badge (compact) */}
          {feeOnTransfer?.detected && (
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${
              isDark ? "bg-amber-500/10 border-amber-500/20 text-amber-400" : "bg-amber-50 border-amber-200 text-amber-600"
            }`}>
              <AlertTriangle className="w-2.5 h-2.5" />
              Fee
            </span>
          )}
          {/* [V1-DEGRADE] Route degradation badge (compact, always visible) */}
          {routeDegradation && (
            <Tip content={`V1 routing: ~${routeDegradation.v1Amount >= 1 ? routeDegradation.v1Amount.toFixed(4) : routeDegradation.v1Amount.toFixed(6)} ${routeDegradation.outputSymbol} (V2 would give ~${routeDegradation.v2Amount >= 1 ? routeDegradation.v2Amount.toFixed(4) : routeDegradation.v2Amount.toFixed(6)})`} side="top">
              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${
                isDark ? "bg-blue-500/10 border-blue-500/20 text-blue-400" : "bg-blue-50 border-blue-200 text-blue-600"
              }`}>
                <Info className="w-2.5 h-2.5" />
                V1
              </span>
            </Tip>
          )}
          {/* [Step 16] Stale quote badge — shows when TTL expired, refreshing */}
          {quoteStale && (
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${
              isDark ? "bg-orange-500/10 border-orange-500/20 text-orange-400" : "bg-orange-50 border-orange-200 text-orange-600"
            }`}>
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              Updating
            </span>
          )}
          {/* Confidence badge (compact) */}
          {!isWrapUnwrap && (
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${confidenceConfig.bg} ${confidenceConfig.color}`}>
              <ConfIcon className="w-2.5 h-2.5" />
              {confidenceConfig.label}
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isDark ? "text-slate-500" : "text-gray-400"
            } ${isExpanded ? "rotate-180" : ""}`}
          />
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
            <div className={`px-3.5 pb-3.5 space-y-2.5 text-sm ${
              isDark ? "border-t border-white/[0.04]" : "border-t border-gray-100"
            }`}>
              {/* [FOT] Fee-on-transfer warning banner */}
              {feeOnTransfer?.detected && (
                <div className={`mt-2.5 flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
                  isDark
                    ? "bg-amber-500/10 border border-amber-500/20 text-amber-300"
                    : "bg-amber-50 border border-amber-200 text-amber-700"
                }`}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Transfer Fee Token</span>
                    <span className="opacity-80"> — This token has a ~{feeOnTransfer.totalFeePercent.toFixed(1)}% custom fee on transfers. Slippage is adjusted automatically to prevent failed swaps. {feeOnTransfer.summary}</span>
                  </div>
                </div>
              )}

              {/* [V1-DEGRADE] Route degradation warning banner */}
              {routeDegradation && (
                <div className={`mt-2.5 flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs ${
                  isDark
                    ? "bg-blue-500/10 border border-blue-500/20 text-blue-300"
                    : "bg-blue-50 border border-blue-200 text-blue-700"
                }`}>
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">V1 Routing</span>
                    <span className="opacity-80">
                      {" "}— This multi-hop route uses V1 AMM pools.
                      V2 concentrated liquidity would give{" "}
                      <span className="font-semibold">
                        ~{routeDegradation.v2Amount >= 1
                          ? routeDegradation.v2Amount.toFixed(4)
                          : routeDegradation.v2Amount.toFixed(8)}{" "}
                        {routeDegradation.outputSymbol}
                      </span>
                      {" "}but V1 delivers{" "}
                      <span className="font-semibold">
                        ~{routeDegradation.v1Amount >= 1
                          ? routeDegradation.v1Amount.toFixed(4)
                          : routeDegradation.v1Amount.toFixed(8)}{" "}
                        {routeDegradation.outputSymbol}
                      </span>
                      {" "}({((1 - routeDegradation.v1Amount / routeDegradation.v2Amount) * 100).toFixed(0)}% less).
                      Output shown reflects V1 rate.
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-2.5">
                {/* Rate (full) */}
                <Row isDark={isDark} label="Rate">
                  <span className={`font-medium ${isDark ? "text-white" : "text-slate-800"}`}>
                    {rateString}
                  </span>
                </Row>
              </div>

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

              {/* ── Slippage Tolerance (merged from SlippageSettingsPro) ── */}
              <div className={`pt-2.5 border-t ${isDark ? "border-white/[0.04]" : "border-gray-100"}`}>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Settings2 className={`w-3.5 h-3.5 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
                  <span className={`text-xs font-semibold tracking-wide uppercase ${
                    isDark ? "text-slate-400" : "text-gray-500"
                  }`}>
                    Slippage Tolerance
                  </span>
                  {isHighSlippage && (
                    <Tip content="High slippage may result in unfavorable rates" side="top">
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                    </Tip>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {SLIPPAGE_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => { onSetSlippage(opt); onSetCustomSlippage(""); }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                        slippage === opt && !isCustom
                          ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-md shadow-pink-500/20"
                          : isDark
                          ? "bg-slate-700/40 text-slate-300 hover:bg-slate-700/60 border border-white/[0.03]"
                          : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                      }`}
                    >
                      {opt}%
                    </button>
                  ))}
                  <div className="relative flex-1">
                    <input
                      type="number"
                      placeholder="Custom"
                      className={`w-full py-1.5 px-2.5 rounded-lg text-xs font-semibold text-center outline-none transition-all duration-200 ${
                        isCustom
                          ? isDark
                            ? "bg-pink-500/10 border-2 border-pink-500/30 text-pink-300"
                            : "bg-pink-50 border-2 border-pink-300 text-pink-700"
                          : isDark
                          ? "bg-slate-700/40 border border-white/[0.03] text-slate-300 placeholder:text-slate-600"
                          : "bg-white border border-gray-200 text-gray-600 placeholder:text-gray-300"
                      }`}
                      value={customSlippage}
                      onChange={e => onSetCustomSlippage(e.target.value)}
                    />
                    {isCustom && (
                      <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold ${
                        isDark ? "text-pink-400" : "text-pink-600"
                      }`}>%</span>
                    )}
                  </div>
                </div>

                {/* Exact approval note */}
                <div className={`flex items-center gap-1.5 mt-2.5 pt-2 border-t ${isDark ? "border-white/[0.04]" : "border-gray-200/60"}`}>
                  <Shield className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
                  <span className={`text-[10px] leading-tight ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Approvals match your swap amount exactly
                  </span>
                </div>
              </div>

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
                    {quoteStale ? "Updating quote..." : countdownUrgent ? "Refreshing soon..." : "Quote refreshes"}
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
                    <RefreshCw className={`w-3 h-3 ${quoteStale || countdownUrgent ? "animate-spin" : ""}`} />
                    {quoteStale ? "Updating..." : "Refresh"}
                  </button>
                </Tip>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
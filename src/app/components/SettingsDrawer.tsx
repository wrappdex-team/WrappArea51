/**
 * SettingsDrawer — Compact inline slippage settings panel.
 *
 * SESSION 4: Extracted from QuoteDetailsPro into a standalone drawer
 * triggered by a gear icon in the SwapCardPro header.
 *
 * Features:
 * - Slippage tolerance preset pills (1%, 3%) + custom input
 * - High slippage warning
 * - Auto-slippage recommendation
 * - Exact approval security note
 * - Smooth AnimatePresence slide-down
 */

import { memo } from "react";
import { motion } from "motion/react";
import {
  Settings2,
  AlertTriangle,
  AlertCircle,
  Shield,
} from "lucide-react";
import { Tip } from "./Tip";

const SLIPPAGE_OPTIONS = [1.0, 3.0];

interface SettingsDrawerProps {
  isDark: boolean;
  slippage: number;
  customSlippage: string;
  effectiveSlippage: number;
  onSetSlippage: (val: number) => void;
  onSetCustomSlippage: (val: string) => void;
  autoSlippageWarning: { recommended: number; message: string } | null;
}

export const SettingsDrawer = memo(function SettingsDrawer({
  isDark,
  slippage,
  customSlippage,
  effectiveSlippage,
  onSetSlippage,
  onSetCustomSlippage,
  autoSlippageWarning,
}: SettingsDrawerProps) {
  const isCustom = !!customSlippage;
  const isHighSlippage = effectiveSlippage > 5;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 32 }}
      className="overflow-hidden"
    >
      <div className={`px-3 sm:px-5 py-3 sm:py-4 ${
        isDark ? "border-b border-white/[0.04]" : "border-b border-gray-100"
      }`}>
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-3">
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
          {/* Current value badge */}
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            isHighSlippage
              ? isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"
              : isDark ? "bg-slate-700/60 text-slate-500" : "bg-gray-200/80 text-gray-400"
          }`}>
            {effectiveSlippage}%
          </span>
        </div>

        {/* Slippage pills + custom input */}
        <div className="flex items-center gap-1.5">
          {SLIPPAGE_OPTIONS.map(opt => (
            <button
              key={opt}
              onClick={() => { onSetSlippage(opt); onSetCustomSlippage(""); }}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                slippage === opt && !isCustom
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-md shadow-pink-500/20"
                  : isDark
                  ? "bg-slate-700/40 text-slate-300 hover:bg-slate-700/60 border border-white/[0.04]"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              {opt}%
            </button>
          ))}
          <div className="relative flex-1">
            <input
              type="number"
              inputMode="decimal"
              placeholder="Custom"
              className={`w-full py-2 px-2.5 rounded-xl text-xs font-semibold text-center outline-none transition-all duration-200 ${
                isCustom
                  ? isDark
                    ? "bg-pink-500/10 border-2 border-pink-500/30 text-pink-300"
                    : "bg-pink-50 border-2 border-pink-300 text-pink-700"
                  : isDark
                  ? "bg-slate-700/40 border border-white/[0.04] text-slate-300 placeholder:text-slate-600"
                  : "bg-white border border-gray-200 text-gray-600 placeholder:text-gray-300"
              }`}
              value={customSlippage}
              onChange={e => onSetCustomSlippage(e.target.value)}
            />
            {isCustom && (
              <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold ${
                isDark ? "text-pink-400" : "text-pink-600"
              }`}>%</span>
            )}
          </div>
        </div>

        {/* Auto-slippage recommendation */}
        {autoSlippageWarning && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-start gap-2 mt-3 p-2.5 rounded-xl text-xs ${
              isDark
                ? "bg-amber-500/8 border border-amber-500/20 text-amber-300"
                : "bg-amber-50 border border-amber-200 text-amber-700"
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <div className="flex-1">
              <span>{autoSlippageWarning.message}</span>
              <button
                onClick={() => { onSetSlippage(autoSlippageWarning.recommended); onSetCustomSlippage(""); }}
                className={`ml-1.5 font-bold underline underline-offset-2 transition-colors ${
                  isDark ? "text-amber-300 hover:text-amber-200" : "text-amber-800 hover:text-amber-900"
                }`}
              >
                Set to {autoSlippageWarning.recommended}%
              </button>
            </div>
          </motion.div>
        )}

        {/* Exact approval note */}
        <div className={`flex items-center gap-1.5 mt-3 pt-2.5 border-t ${
          isDark ? "border-white/[0.04]" : "border-gray-200/60"
        }`}>
          <Shield className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
          <span className={`text-[10px] leading-tight ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            Approvals match your swap amount exactly
          </span>
        </div>
      </div>
    </motion.div>
  );
});
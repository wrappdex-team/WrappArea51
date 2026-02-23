/**
 * SlippageSettingsPro — Minimalist slippage settings drawer.
 *
 * Features:
 * - Two preset buttons: 1% and 3% (default)
 * - Custom slippage input with validation
 * - Smooth expand/collapse animation
 * - Exact-amount approval security note
 *
 * [STEP-15] Infinite approval toggle removed — all approvals now use
 * exact swap amounts to prevent AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY errors.
 */

import { memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Settings2,
  ChevronDown,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { Tip } from "./Tip";

const SLIPPAGE_OPTIONS = [1.0, 3.0];

interface SlippageSettingsProProps {
  slippage: number;
  customSlippage: string;
  effectiveSlippage: number;
  showSlippage: boolean;
  onToggle: () => void;
  onSetSlippage: (val: number) => void;
  onSetCustomSlippage: (val: string) => void;
  isDark: boolean;
}

export const SlippageSettingsPro = memo(function SlippageSettingsPro({
  slippage,
  customSlippage,
  effectiveSlippage,
  showSlippage,
  onToggle,
  onSetSlippage,
  onSetCustomSlippage,
  isDark,
}: SlippageSettingsProProps) {
  const isCustom = !!customSlippage;
  const isHighSlippage = effectiveSlippage > 5;

  return (
    <div className="mt-4">
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 text-sm w-full group py-1 transition-colors ${
          isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        <Settings2 className={`w-4 h-4 transition-transform duration-300 ${showSlippage ? "rotate-90" : ""}`} />
        <span className="font-medium">Settings</span>
        <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${
          isHighSlippage
            ? isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"
            : isDark ? "bg-slate-800/60 text-slate-500" : "bg-gray-100 text-gray-400"
        }`}>
          {effectiveSlippage}%
        </span>
        <ChevronDown className={`w-4 h-4 ml-auto transition-transform duration-200 ${showSlippage ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {showSlippage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className={`mt-2.5 p-4 rounded-xl space-y-3 ${
              isDark
                ? "bg-slate-800/30 border border-white/[0.04]"
                : "bg-gray-50/80 border border-gray-100"
            }`}>
              {/* Slippage tolerance */}
              <div>
                <div className="flex items-center gap-1.5 mb-2.5">
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

                <div className="flex items-center gap-2">
                  {SLIPPAGE_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => { onSetSlippage(opt); onSetCustomSlippage(""); }}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
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
                      className={`w-full py-2 px-3 rounded-xl text-sm font-semibold text-center outline-none transition-all duration-200 ${
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
                      <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold ${
                        isDark ? "text-pink-400" : "text-pink-600"
                      }`}>%</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Exact approval info note */}
              <div className={`pt-3 border-t ${isDark ? "border-white/[0.04]" : "border-gray-200/60"}`}>
                <div className="flex items-center gap-2">
                  <Shield className={`w-4 h-4 flex-shrink-0 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
                  <div>
                    <span className={`text-xs font-semibold ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                      Exact Amount Approval
                    </span>
                    <p className={`text-[10px] leading-tight mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      Token approvals match your swap amount exactly for maximum security
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

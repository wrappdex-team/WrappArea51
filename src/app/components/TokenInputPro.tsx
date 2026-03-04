/**
 * TokenInputPro — Premium token amount input field.
 *
 * SESSION 2 redesign:
 * - USD value below amount (amount → value visual flow)
 * - Balance integrated into label row
 * - HTS ID removed (dev info, not user-facing)
 * - Prominent MAX button
 * - Scroll-to-change prevention on number input
 * - Shimmer skeleton while loading quotes
 * - Larger inviting placeholder when empty
 * - Better token selector hit area
 */

import { memo, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Wallet, RefreshCw } from "lucide-react";
import { TokenIcon } from "./TokenIcon";
import { Tip } from "./Tip";
import type { AllowedToken } from "../utils/saucerswap";

interface TokenInputProProps {
  label: "You Pay" | "You Receive";
  token: AllowedToken;
  amount: string;
  usdValue: number;
  balance: number | null;
  isWalletConnected: boolean;
  readOnly?: boolean;
  loading?: boolean;
  isDark: boolean;
  // Handlers
  onAmountChange?: (value: string) => void;
  onTokenClick: () => void;
  onMaxClick?: () => void;
  onRefreshBalance?: () => void;
}

export const TokenInputPro = memo(function TokenInputPro({
  label,
  token,
  amount,
  usdValue,
  balance,
  isWalletConnected,
  readOnly = false,
  loading = false,
  isDark,
  onAmountChange,
  onTokenClick,
  onMaxClick,
  onRefreshBalance,
}: TokenInputProProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isPay = label === "You Pay";
  const hasAmount = amount && parseFloat(amount) > 0;

  const handleClick = useCallback(() => {
    if (!readOnly && inputRef.current) {
      inputRef.current.focus();
    }
  }, [readOnly]);

  // Prevent scroll-to-change on number inputs
  const handleWheel = useCallback((e: React.WheelEvent) => {
    (e.target as HTMLInputElement).blur();
  }, []);

  return (
    <div
      onClick={handleClick}
      className={`relative rounded-2xl transition-all duration-300 cursor-text ${
        isDark
          ? focused
            ? "bg-slate-800/90 border border-pink-500/25 shadow-[0_0_24px_-6px_rgba(236,72,153,0.12)]"
            : "bg-slate-800/50 border border-white/[0.04] hover:border-white/[0.08]"
          : focused
          ? "bg-white border border-pink-300/60 shadow-[0_0_24px_-6px_rgba(236,72,153,0.1)]"
          : "bg-gray-50/80 border border-gray-200/60 hover:border-gray-300"
      }`}
    >
      {/* ── Top row: Label + Balance ── */}
      <div className="flex items-center justify-between px-3 sm:px-4 pt-3 sm:pt-3.5 pb-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-semibold tracking-wide uppercase ${
            isDark ? "text-slate-500" : "text-gray-400"
          }`}>
            {label}
          </span>
          {isPay && isWalletConnected && onRefreshBalance && (
            <button
              onClick={(e) => { e.stopPropagation(); onRefreshBalance(); }}
              aria-label="Refresh balances"
              className={`p-0.5 rounded transition-colors ${
                isDark ? "hover:bg-slate-700 text-slate-600" : "hover:bg-gray-200 text-gray-400"
              }`}
            >
              <RefreshCw className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
        {isWalletConnected && balance !== null && (
          <div className="flex items-center gap-1.5">
            {isPay && onMaxClick && balance > 0 && (
              <Tip
                content={token.isNative
                  ? "Use max balance (3 HBAR reserved for gas)"
                  : "Use max balance"
                }
                side="top"
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onMaxClick(); }}
                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg transition-all duration-200 ${
                    isDark
                      ? "text-pink-400 bg-pink-500/8 hover:bg-pink-500/15 border border-pink-500/15"
                      : "text-pink-600 bg-pink-50 hover:bg-pink-100 border border-pink-200/60"
                  }`}
                >
                  MAX
                </button>
              </Tip>
            )}
            <span className={`text-[11px] flex items-center gap-1 ${
              isDark ? "text-slate-500" : "text-gray-400"
            }`}>
              <Wallet className="w-2.5 h-2.5" />
              {balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </span>
          </div>
        )}
      </div>

      {/* ── Main row: Amount + Token selector ── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 pt-1.5 pb-1">
        <div className="flex-1 min-w-0">
          {/* Amount input */}
          <div className="relative">
            {loading && !hasAmount ? (
              /* Shimmer skeleton while waiting for quote */
              <div className={`h-9 w-32 rounded-lg animate-pulse ${
                isDark ? "bg-slate-700/50" : "bg-gray-200/60"
              }`} />
            ) : (
              <input
                ref={inputRef}
                type="number"
                inputMode="decimal"
                placeholder="0"
                readOnly={readOnly}
                aria-label={label}
                className={`bg-transparent w-full outline-none font-bold tabular-nums ${
                  readOnly ? "cursor-default" : ""
                } ${loading ? "opacity-60" : ""} ${
                  hasAmount
                    ? isDark ? "text-white" : "text-slate-900"
                    : isDark ? "text-slate-600 placeholder:text-slate-700" : "text-gray-300 placeholder:text-gray-300"
                }`}
                style={{ fontSize: amount && amount.length > 12 ? "1.125rem" : amount && amount.length > 8 ? "1.25rem" : "1.75rem" }}
                value={amount}
                onChange={e => onAmountChange?.(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onWheel={handleWheel}
              />
            )}
          </div>

          {/* USD value — directly below amount for visual flow */}
          <div className="h-5 mt-0.5">
            <AnimatePresence mode="wait">
              {usdValue > 0 ? (
                <motion.span
                  key={usdValue.toFixed(2)}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}
                >
                  ~${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </motion.span>
              ) : hasAmount && loading ? (
                <motion.span
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`text-xs ${isDark ? "text-slate-600" : "text-gray-300"}`}
                >
                  Fetching price...
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        {/* Token selector button */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          onClick={(e) => { e.stopPropagation(); onTokenClick(); }}
          aria-label={`Select ${label.toLowerCase()} token, currently ${token.symbol}`}
          className={`flex items-center gap-1.5 sm:gap-2.5 pl-2 sm:pl-2.5 pr-2.5 sm:pr-3 py-2 sm:py-2.5 rounded-2xl whitespace-nowrap transition-all duration-200 shrink-0 ${
            isDark
              ? "bg-slate-700/70 hover:bg-slate-600/90 border border-white/[0.06] hover:border-white/[0.1]"
              : "bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 shadow-sm"
          }`}
        >
          <TokenIcon src={token.logo} symbol={token.symbol} htsId={token.htsId} size="w-7 h-7" />
          <span className={`font-extrabold text-sm ${isDark ? "text-white" : "text-slate-800"}`}>
            {token.symbol}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${isDark ? "text-slate-400" : "text-gray-400"}`} />
        </motion.button>
      </div>

      {/* ── Bottom padding ── */}
      <div className="h-2.5" />
    </div>
  );
});
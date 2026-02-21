/**
 * TokenInputPro — Premium token amount input field.
 *
 * Features:
 * - Large amount display with USD value
 * - Token selector button with icon + chevron
 * - Balance display with MAX shortcut
 * - Visual "You Pay" / "You Receive" labels
 * - Subtle gradient glow on focus
 * - Responsive design
 */

import { memo, useState, useRef, useCallback } from "react";
import { motion } from "motion/react";
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

  const handleClick = useCallback(() => {
    if (!readOnly && inputRef.current) {
      inputRef.current.focus();
    }
  }, [readOnly]);

  return (
    <div
      onClick={handleClick}
      className={`relative rounded-2xl p-4 transition-all duration-200 cursor-text ${
        isDark
          ? focused
            ? "bg-slate-800/80 border border-pink-500/20 shadow-[0_0_20px_-5px_rgba(236,72,153,0.1)]"
            : "bg-slate-800/50 border border-white/[0.04] hover:border-white/[0.08]"
          : focused
          ? "bg-white border border-pink-300/50 shadow-[0_0_20px_-5px_rgba(236,72,153,0.08)]"
          : "bg-gray-50/80 border border-gray-200/60 hover:border-gray-300"
      }`}
    >
      {/* Label row */}
      <div className="flex items-center justify-between mb-2.5">
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
        {usdValue > 0 && (
          <motion.span
            key={usdValue.toFixed(2)}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}
          >
            ~${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </motion.span>
        )}
      </div>

      {/* Amount + Token selector */}
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="number"
          placeholder="0"
          readOnly={readOnly}
          aria-label={label}
          className={`bg-transparent flex-1 outline-none min-w-0 font-bold ${
            readOnly ? "cursor-default" : ""
          } ${loading ? "animate-pulse" : ""} ${
            amount && parseFloat(amount) > 0
              ? isDark ? "text-white" : "text-slate-900"
              : isDark ? "text-slate-600 placeholder:text-slate-700" : "text-gray-300 placeholder:text-gray-300"
          }`}
          style={{ fontSize: amount && amount.length > 12 ? "1.25rem" : "1.75rem" }}
          value={amount}
          onChange={e => onAmountChange?.(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />

        {/* Token button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={(e) => { e.stopPropagation(); onTokenClick(); }}
          aria-label={`Select ${label.toLowerCase()} token, currently ${token.symbol}`}
          className={`flex items-center gap-2 pl-2 pr-2.5 py-2 rounded-2xl whitespace-nowrap transition-all shrink-0 ${
            isDark
              ? "bg-slate-700/60 hover:bg-slate-600/80 border border-white/[0.06]"
              : "bg-white hover:bg-gray-50 border border-gray-200 shadow-sm"
          }`}
        >
          <TokenIcon src={token.logo} symbol={token.symbol} size="w-7 h-7" />
          <span className={`font-extrabold text-sm ${isDark ? "text-white" : "text-slate-800"}`}>
            {token.symbol}
          </span>
          <ChevronDown className={`w-4 h-4 ${isDark ? "text-slate-400" : "text-gray-400"}`} />
        </motion.button>
      </div>

      {/* Balance row */}
      <div className="flex items-center justify-between mt-2">
        <span className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
          {token.isNative ? "Native HBAR" : `HTS: ${token.htsId}`}
        </span>
        {isWalletConnected && balance !== null && (
          <div className="flex items-center gap-1">
            {isPay && onMaxClick && balance > 0 && (
              <Tip content="Use max balance" side="top">
                <button
                  onClick={(e) => { e.stopPropagation(); onMaxClick(); }}
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md transition-colors ${
                    isDark
                      ? "text-pink-400 hover:bg-pink-500/10"
                      : "text-pink-600 hover:bg-pink-50"
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
    </div>
  );
});

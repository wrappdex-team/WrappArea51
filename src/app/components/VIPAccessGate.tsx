/**
 * VIP Access Gate — Minimal token-gate lock screen.
 * Shows only what's needed: lock state, threshold, and wallet status.
 */

import { Lock } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { GATE_THRESHOLD, formatTokenCount } from "../utils/dao";

interface VIPAccessGateProps {
  featureName?: string;
}

export function VIPAccessGate({
  featureName = "CEX Trading Terminal",
}: VIPAccessGateProps) {
  const { isDark } = useTheme();
  const { primaryWallet, hederaAccount } = useWallet();

  const balanceDisplay = hederaAccount?.tokens
    ? (() => {
        const t = hederaAccount.tokens.find((t) => t.tokenId === "0.0.9356476");
        return t ? formatTokenCount(t.balance) : "0";
      })()
    : primaryWallet
      ? "Loading..."
      : null;

  return (
    <div className="min-h-[calc(100vh-140px)] flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-4 max-w-xs w-full">
        {/* Lock icon */}
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center ${
            isDark
              ? "bg-white/[0.04] border border-white/[0.06]"
              : "bg-gray-100 border border-gray-200"
          }`}
        >
          <Lock className={`w-5 h-5 ${isDark ? "text-white/40" : "text-gray-400"}`} />
        </div>

        {/* Title + requirement */}
        <div className="text-center space-y-1">
          <p className={`text-sm font-medium ${isDark ? "text-white/80" : "text-gray-700"}`}>
            {featureName}
          </p>
          <p className={`text-xs ${isDark ? "text-white/30" : "text-gray-400"}`}>
            Requires {formatTokenCount(GATE_THRESHOLD)} HBAR.ħ or 1 VIP NFT
          </p>
        </div>

        {/* Balance or connect prompt */}
        {balanceDisplay ? (
          <span
            className={`text-xs tabular-nums ${isDark ? "text-white/20" : "text-gray-300"}`}
          >
            Balance: {balanceDisplay}
          </span>
        ) : (
          <span className={`text-xs ${isDark ? "text-white/20" : "text-gray-300"}`}>
            Connect wallet to verify
          </span>
        )}
      </div>
    </div>
  );
}
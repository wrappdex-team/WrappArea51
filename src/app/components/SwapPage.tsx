import { useMemo } from "react";
import { SwapPanel } from "./SwapPanel";
import { VIPAccessGate } from "./VIPAccessGate";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import { isVipEligible } from "../utils/vip";

export function SwapPage() {
  const { hederaAccount, hederaNetwork } = useWallet();
  const { isDark } = useTheme();

  const isVip = useMemo(() => {
    if (!hederaAccount?.tokens) return false;
    return isVipEligible(hederaAccount.tokens, hederaNetwork);
  }, [hederaAccount?.tokens, hederaNetwork]);

  if (!isVip) {
    return <VIPAccessGate featureName="Swap" />;
  }

  return (
    <div className={`min-h-[calc(100vh-140px)] ${
      isDark
        ? "bg-gradient-to-b from-transparent via-transparent to-transparent"
        : ""
    }`}>
      {/* Subtle ambient background effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div
          className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full opacity-[0.03]"
          style={{
            background: "radial-gradient(circle, rgba(236,72,153,0.4) 0%, transparent 70%)",
            filter: "blur(80px)",
          }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full opacity-[0.03]"
          style={{
            background: "radial-gradient(circle, rgba(139,92,246,0.4) 0%, transparent 70%)",
            filter: "blur(80px)",
          }}
        />
      </div>

      <div className="max-w-7xl mx-auto px-2 sm:px-4">
        <SwapPanel />
      </div>
    </div>
  );
}

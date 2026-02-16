import { useMemo } from "react";
import { SwapPanel } from "./SwapPanel";
import { VIPAccessGate } from "./VIPAccessGate";
import { useWallet } from "../contexts/WalletContext";
import { isVipEligible } from "../utils/vip";

export function SwapPage() {
  const { hederaAccount, hederaNetwork } = useWallet();

  const isVip = useMemo(() => {
    if (!hederaAccount?.tokens) return false;
    return isVipEligible(hederaAccount.tokens, hederaNetwork);
  }, [hederaAccount?.tokens, hederaNetwork]);

  if (!isVip) {
    return <VIPAccessGate featureName="Swap" />;
  }

  return (
    <div className="min-h-[calc(100vh-140px)]">
      <div className="max-w-7xl mx-auto">
        <SwapPanel />
      </div>
    </div>
  );
}

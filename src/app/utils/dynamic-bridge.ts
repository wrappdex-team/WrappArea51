/**
 * Dynamic Labs ↔ WalletContext Bridge
 *
 * Listens for Dynamic SDK wallet events (connect / disconnect) and forwards
 * them into the existing WalletContext `connectedWallets` array so the rest
 * of the app (header, VIP gates, DAO, etc.) recognizes the connected wallet
 * without needing to rewrite every consumer.
 *
 * Usage:
 *   Place <DynamicWalletBridge /> inside BOTH <DynamicContextProvider> and
 *   <WalletProvider> in the component tree.
 */

import { useEffect, useRef, useCallback } from "react";
import { useDynamicContext, useIsLoggedIn } from "@dynamic-labs/sdk-react-core";
import { useWallet } from "../contexts/WalletContext";
import { log } from "./logger";

/**
 * Determines wallet type from the Dynamic wallet network.
 */
function resolveWalletType(
  network?: string | number,
  chain?: string,
): "hedera" | "ethereum" | "solana" {
  const n = String(network || chain || "").toLowerCase();
  if (n.includes("hedera") || n.includes("hbar")) return "hedera";
  if (n.includes("solana") || n.includes("sol")) return "solana";
  return "ethereum";
}

/**
 * Hook that bridges Dynamic wallet state → WalletContext.
 *
 * This does NOT render any UI. It simply watches for changes in the Dynamic
 * SDK context and calls `connectWallet` / `disconnectWallet` on the existing
 * WalletContext so all downstream consumers see the Dynamic-connected wallet
 * in the unified `connectedWallets` array.
 */
export function useDynamicBridge() {
  const { primaryWallet, user, sdkHasLoaded } = useDynamicContext();
  const isLoggedIn = useIsLoggedIn();
  const {
    connectedWallets,
    connectWallet,
    disconnectWallet,
  } = useWallet();

  // Track which Dynamic address we last synced, to avoid duplicate calls
  const lastSyncedRef = useRef<string | null>(null);

  // Sync Dynamic wallet → WalletContext on login
  const syncWallet = useCallback(() => {
    if (!sdkHasLoaded) return;

    if (isLoggedIn && primaryWallet) {
      const address = primaryWallet.address;
      if (!address || typeof address !== "string" || address === lastSyncedRef.current) return;

      const chain = (primaryWallet as any).chain || (primaryWallet as any).network || "";
      const walletType = resolveWalletType(chain);

      // Check if this address is already tracked (could be from MetaMask/HashPack direct)
      const alreadyTracked = connectedWallets.some(
        (w) => typeof w.address === "string" && w.address.toLowerCase() === address.toLowerCase(),
      );

      if (!alreadyTracked) {
        const connectorName = (primaryWallet as any).connector?.name
          || (primaryWallet as any).walletName
          || "Dynamic";

        log.info("DynamicBridge", `Syncing Dynamic wallet → WalletContext`, {
          address: `${address.slice(0, 8)}...`,
          type: walletType,
          connector: connectorName,
        });

        connectWallet(walletType, `Dynamic (${connectorName})`);
      }

      lastSyncedRef.current = address;
    } else if (!isLoggedIn && lastSyncedRef.current) {
      // User logged out from Dynamic — remove from WalletContext
      const prevAddress = lastSyncedRef.current;
      const trackedWallet = connectedWallets.find(
        (w) =>
          w.connector.startsWith("Dynamic") &&
          typeof w.address === "string" &&
          w.address.toLowerCase() === prevAddress.toLowerCase(),
      );
      if (trackedWallet) {
        log.info("DynamicBridge", "Dynamic wallet disconnected, removing from WalletContext");
        disconnectWallet(trackedWallet.address);
      }
      lastSyncedRef.current = null;
    }
  }, [
    sdkHasLoaded,
    isLoggedIn,
    primaryWallet,
    connectedWallets,
    connectWallet,
    disconnectWallet,
  ]);

  useEffect(() => {
    syncWallet();
  }, [syncWallet]);
}

/**
 * React component wrapper that invokes the bridge hook.
 * Must be rendered inside both <DynamicContextProvider> and <WalletProvider>.
 */
export function DynamicWalletBridge() {
  useDynamicBridge();
  return null;
}
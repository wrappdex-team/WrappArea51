// Must be the very first import — sets up Buffer/process/global polyfills
// before any SDK code (@hashgraph/sdk, @walletconnect/sign-client) loads
import "./utils/polyfills";

import { useEffect, useState } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ThemeProvider } from "./contexts/ThemeContext";
import { WalletProvider } from "./contexts/WalletContext";
import { DynamicSDKWrapper, isDynamicSDKAvailable } from "./components/DynamicSDKWrapper";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { SigningProvider } from "./contexts/SigningContext";
import { PartneredLogosProvider } from "./contexts/PartneredLogosContext";
import { initPerformanceMonitoring } from "./utils/performance";
import { runHealthChecks } from "./utils/health";
import { preloadCriticalRoutes } from "./utils/preload";
import { log } from "./utils/logger";
import { TermsGate } from "./components/TermsGate";

// [WALLET-SURGERY Step 1] Pre-warm the WalletConnect SignClient at page load.
// This eliminates the 3-4s "Initializing WalletConnect..." spinner when the user
// clicks "Connect HashPack". The WC SDK is dynamically imported and the relay
// WebSocket is connected in the background — by the time the user interacts,
// the client is already initialized and the relay is warm.
//
// [CONNECT-PERF] Also pre-warm the WC Modal package and start a pre-connect
// relay keepalive. Without this, the relay WebSocket drops after ~30-60s of
// inactivity (no keepalive runs before wallet connection), so clicking
// "Connect" after browsing for a minute triggers a 10s+ reconnection cycle.
import { getSignClient, getWCModal, startPreConnectKeepalive } from "./utils/wallet-core";
const _wcPrewarm = getSignClient().then(() => {
  // SignClient ready — start pre-connect keepalive to prevent relay drop
  startPreConnectKeepalive();
  // Also pre-warm the WC Modal package (dynamic import) so it's cached
  getWCModal().catch(() => { /* non-critical */ });
}).catch(() => {
  // Non-critical — if it fails here, connectHashPack will retry on demand
});

/**
 * LazyDynamicBridge — only loads the Dynamic ↔ WalletContext bridge
 * when the Dynamic SDK has been successfully initialized.
 * This avoids eager static imports of @dynamic-labs/sdk-react-core
 * in the main module graph, which would cause App.tsx to fail if the
 * SDK can't be loaded.
 */
function LazyDynamicBridge() {
  const [Bridge, setBridge] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    // Check periodically until SDK is available (loaded async by DynamicSDKWrapper)
    const check = () => {
      if (isDynamicSDKAvailable) {
        import("./utils/dynamic-bridge")
          .then((mod) => setBridge(() => mod.DynamicWalletBridge))
          .catch((err) =>
            log.warn("App", "Failed to load DynamicWalletBridge", err.message)
          );
        return true;
      }
      return false;
    };

    if (check()) return;

    // Poll briefly in case SDK is still loading
    const timer = setInterval(() => {
      if (check()) clearInterval(timer);
    }, 500);

    // Stop polling after 10 seconds
    const timeout = setTimeout(() => clearInterval(timer), 10000);

    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, []);

  if (!Bridge) return null;
  return <Bridge />;
}

export default function App() {
  useEffect(() => {
    // Initialize production monitoring & diagnostics on first render
    initPerformanceMonitoring();

    // Run service health checks (non-blocking)
    runHealthChecks().catch(() => {
      log.warn("App", "Health checks failed — some services may be unreachable");
    });

    // Preload critical route chunks during idle time
    preloadCriticalRoutes();

    log.info("App", "HBAR.h initialized", {
      mode: import.meta.env.MODE,
      prod: import.meta.env.PROD,
    });
  }, []);

  return (
    <AppErrorBoundary>
      <TermsGate>
        <DynamicSDKWrapper>
          <ThemeProvider>
            <WalletProvider>
              <SigningProvider>
                <PartneredLogosProvider>
                  <LazyDynamicBridge />
                  <RouterProvider router={router} />
                </PartneredLogosProvider>
              </SigningProvider>
            </WalletProvider>
          </ThemeProvider>
        </DynamicSDKWrapper>
      </TermsGate>
    </AppErrorBoundary>
  );
}
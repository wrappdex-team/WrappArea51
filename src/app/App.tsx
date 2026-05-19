// Must be the very first import — sets up Buffer/process/global polyfills
// before any SDK code (@hashgraph/sdk, @walletconnect/sign-client) loads
import "./utils/polyfills";

import { useEffect, useState } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ThemeProvider } from "./contexts/ThemeContext";
import { WalletProvider } from "./contexts/WalletContext";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { SigningProvider } from "./contexts/SigningContext";
import { PartneredLogosProvider } from "./contexts/PartneredLogosContext";
import { initPerformanceMonitoring } from "./utils/performance";
import { runHealthChecks } from "./utils/health";
import { preloadCriticalRoutes } from "./utils/preload";
import { log } from "./utils/logger";

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

    log.info("App", "WRAPpDEX initialized", {
      mode: import.meta.env.MODE,
      prod: import.meta.env.PROD,
    });
  }, []);

  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <WalletProvider>
          <SigningProvider>
            <PartneredLogosProvider>
              <RouterProvider router={router} />
            </PartneredLogosProvider>
          </SigningProvider>
        </WalletProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
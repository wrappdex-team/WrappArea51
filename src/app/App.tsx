// Must be the very first import — sets up Buffer/process/global polyfills
// before any SDK code (@hashgraph/sdk, @walletconnect/sign-client) loads
import "./utils/polyfills";

import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ThemeProvider } from "./contexts/ThemeContext";
import { WalletProvider } from "./contexts/WalletContext";
import { initPerformanceMonitoring } from "./utils/performance";
import { runHealthChecks } from "./utils/health";
import { preloadCriticalRoutes } from "./utils/preload";
import { log } from "./utils/logger";

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

    log.info("App", "HBAR.ħ initialized", {
      mode: import.meta.env.MODE,
      prod: import.meta.env.PROD,
    });
  }, []);

  return (
    <ThemeProvider>
      <WalletProvider>
        <RouterProvider router={router} />
      </WalletProvider>
    </ThemeProvider>
  );
}
import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Layout } from "./components/Layout";

/**
 * Retry wrapper for dynamic imports.
 *
 * Vite occasionally fails to fetch a dynamically imported module on the first
 * attempt — especially right after dependency changes, when stale pre-bundle
 * cache can cause "TypeError: Failed to fetch dynamically imported module".
 * Retrying after a short delay (with a cache-busting query parameter) resolves
 * these transient failures without requiring a full page reload.
 *
 * Cache-busting: On retry, we append `?t=<timestamp>` to the module URL by
 * re-importing with `import()`. Vite treats the timestamped URL as a fresh
 * request, bypassing any stale browser or service-worker cache.
 */
function retryImport<T>(
  importFn: () => Promise<T>,
  retries = 2,
  delay = 1000
): Promise<T> {
  return importFn().catch((err) => {
    if (retries <= 0) throw err;

    // Detect chunk-load failures specifically
    const msg = err?.message || "";
    const isChunkError =
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Loading chunk") ||
      msg.includes("Loading CSS chunk") ||
      msg.includes("error loading dynamically imported module");

    if (!isChunkError) throw err; // Don't retry non-chunk errors

    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        retryImport(importFn, retries - 1, delay * 1.5)
          .then(resolve)
          .catch(reject);
      }, delay);
    });
  });
}

// Lazy-load all route components for code splitting (with retry)
const Dashboard = lazy(() => retryImport(() => import("./components/Dashboard")).then(m => ({ default: m.Dashboard })));
const Trading = lazy(() => retryImport(() => import("./components/Trading")).then(m => ({ default: m.Trading })));
const SwapPage = lazy(() => retryImport(() => import("./components/SwapPage")).then(m => ({ default: m.SwapPage })));
const BuySell = lazy(() => retryImport(() => import("./components/BuySell")).then(m => ({ default: m.BuySell })));
const DeFi = lazy(() => retryImport(() => import("./components/DeFi")).then(m => ({ default: m.DeFi })));
const SmartLiquidity = lazy(() => retryImport(() => import("./components/SmartLiquidity")).then(m => ({ default: m.SmartLiquidity })));
const Wallet = lazy(() => retryImport(() => import("./components/Wallet")).then(m => ({ default: m.Wallet })));
const DAO = lazy(() => retryImport(() => import("./components/DAO")).then(m => ({ default: m.DAO })));
const Bridges = lazy(() => retryImport(() => import("./components/Bridges")).then(m => ({ default: m.Bridges })));

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "trading", Component: Trading },
      { path: "trading/:symbol", Component: Trading },
      { path: "swap", Component: SwapPage },
      { path: "buy-sell", Component: BuySell },
      { path: "wallet", Component: Wallet },
      { path: "dao", Component: DAO },
      { path: "bridges", Component: Bridges },
      { path: "defi", Component: DeFi },
      { path: "smart-liquidity", element: <Navigate to="/trading" replace /> },
    ],
  },
]);
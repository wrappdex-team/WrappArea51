import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
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

// Landing page — standalone, no DEX chrome
const LandingPage = lazy(() => retryImport(() => import("./components/landing/LandingPage")).then(m => ({ default: m.LandingPage })));

// Lazy-load all route components for code splitting (with retry)
const Dashboard = lazy(() => retryImport(() => import("./components/Dashboard")).then(m => ({ default: m.Dashboard })));
const Trading = lazy(() => retryImport(() => import("./components/Trading")).then(m => ({ default: m.Trading })));
const SwapPage = lazy(() => retryImport(() => import("./components/SwapPage")).then(m => ({ default: m.SwapPage })));
const BuySell = lazy(() => retryImport(() => import("./components/BuySell")).then(m => ({ default: m.BuySell })));
const DeFi = lazy(() => retryImport(() => import("./components/DeFi")).then(m => ({ default: m.DeFi })));
const Wallet = lazy(() => retryImport(() => import("./components/Wallet")).then(m => ({ default: m.Wallet })));
const DAO = lazy(() => retryImport(() => import("./components/DAO")).then(m => ({ default: m.DAO })));
const Bridges = lazy(() => retryImport(() => import("./components/Bridges")).then(m => ({ default: m.Bridges })));
const Audit = lazy(() => retryImport(() => import("./components/Audit")).then(m => ({ default: m.Audit })));
const TermsOfService = lazy(() => retryImport(() => import("./components/TermsOfService")).then(m => ({ default: m.TermsOfService })));
const PrivacyPolicy = lazy(() => retryImport(() => import("./components/PrivacyPolicy")).then(m => ({ default: m.PrivacyPolicy })));
const WhitePaper = lazy(() => retryImport(() => import("./components/WhitePaper")).then(m => ({ default: m.WhitePaper })));
const Branding = lazy(() => retryImport(() => import("./components/Branding")).then(m => ({ default: m.Branding })));
const NotFound = lazy(() => retryImport(() => import("./components/NotFound")).then(m => ({ default: m.NotFound })));

/**
 * Route Architecture — wrappdex.io
 *
 * /                → Institutional landing page (no DEX chrome)
 * /markets         → DEX Dashboard (default DEX entry)
 * /trading         → Trading terminal
 * /swap            → Token swap
 * /buy-sell        → Fiat on/off ramp
 * /defi            → DeFi hub
 * /wallet          → Portfolio & wallet
 * /dao             → Governance
 * /bridges         → Cross-chain
 * /audit           → Security reports
 * /white-paper     → Wrapp Paper
 * /branding        → Brand identity
 * /terms           → Terms of Service
 * /privacy         → Privacy Policy
 */

/** Transparent pass-through wrapper — Suspense boundary for the landing page lazy chunk */
function RootShell() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="flex items-baseline font-black tracking-[-0.05em] leading-none select-none text-3xl animate-pulse">
            <span className="text-black">WRAP</span>
            <span className="text-[#1D63ED] italic -skew-x-6">p</span>
            <span className="text-[0.45em] ml-2 font-black uppercase tracking-[0.3em] text-slate-500 opacity-80">Dex</span>
          </div>
        </div>
      }
    >
      <Outlet />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootShell,
    children: [
      // Landing page — clean institutional site, no DEX layout
      { index: true, Component: LandingPage },

      // DEX application — all routes share the Layout chrome
      {
        Component: Layout,
        children: [
          { path: "markets", Component: Dashboard },
          { path: "trading", Component: Trading },
          { path: "trading/:symbol", Component: Trading },
          { path: "swap", Component: SwapPage },
          { path: "buy-sell", Component: BuySell },
          { path: "wallet", Component: Wallet },
          { path: "dao", Component: DAO },
          { path: "bridges", Component: Bridges },
          { path: "defi", Component: DeFi },
          { path: "audit", Component: Audit },
          { path: "terms", Component: TermsOfService },
          { path: "privacy", Component: PrivacyPolicy },
          { path: "white-paper", Component: WhitePaper },
          { path: "branding", Component: Branding },
          { path: "smart-liquidity", element: <Navigate to="/trading" replace /> },
          { path: "*", Component: NotFound },
        ],
      },
    ],
  },
]);
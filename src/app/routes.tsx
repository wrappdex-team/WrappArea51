import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { Layout } from "./components/Layout";
import { TermsGate } from "./components/TermsGate";

/**
 * Retry wrapper for dynamic imports.
 */
function retryImport<T>(
  importFn: () => Promise<T>,
  retries = 2,
  delay = 1000
): Promise<T> {
  return importFn().catch((err) => {
    if (retries <= 0) throw err;
    const msg = err?.message || "";
    const isChunkError =
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Loading chunk") ||
      msg.includes("Loading CSS chunk") ||
      msg.includes("error loading dynamically imported module");
    if (!isChunkError) throw err;
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        retryImport(importFn, retries - 1, delay * 1.5)
          .then(resolve)
          .catch(reject);
      }, delay);
    });
  });
}

// Lazy-loaded components
const LandingPage = lazy(() => retryImport(() => import("./components/landing/LandingPage")).then(m => ({ default: m.LandingPage })));
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
const PenTest = lazy(() => retryImport(() => import("./components/PenTest")).then(m => ({ default: m.PenTest })));
const Predict = lazy(() => retryImport(() => import("./components/Predict")).then(m => ({ default: m.Predict })));   // ← ADDED
const NotFound = lazy(() => retryImport(() => import("./components/NotFound")).then(m => ({ default: m.NotFound })));

/** TermsGateLayout wrapper */
function TermsGateLayout() {
  return (
    <TermsGate>
      <Layout />
    </TermsGate>
  );
}

/** RootShell for landing page */
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
      { index: true, Component: LandingPage },
      {
        Component: TermsGateLayout,
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
          { path: "pentest", Component: PenTest },
          { path: "predict", Component: Predict },                    // ← ADDED
          { path: "smart-liquidity", element: <Navigate to="/trading" replace /> },
          { path: "*", Component: NotFound },
        ],
      },
    ],
  },
]);
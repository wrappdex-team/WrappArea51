/**
 * Route Preloading — Hover-based Prefetch for Code-Split Routes
 *
 * When the user hovers over a navigation link, we eagerly start loading
 * the lazy-loaded route chunk. This eliminates the loading spinner on
 * ~90% of navigations because the chunk is already cached by the time
 * the user clicks.
 *
 * Usage:
 *   import { preloadRoute } from "../utils/preload";
 *   <Link to="/trading" onMouseEnter={() => preloadRoute("/trading")}>
 */

import { log } from "./logger";

/**
 * Retry wrapper for dynamic imports — same logic as routes.tsx.
 * Only retries chunk-load failures (stale cache, transient network errors).
 */
function retryImport<T>(
  importFn: () => Promise<T>,
  retries = 2,
  delay = 800
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

// Map route paths to their dynamic import functions (with retry)
const ROUTE_IMPORTERS: Record<string, () => Promise<unknown>> = {
  "/markets": () => retryImport(() => import("../components/Dashboard")),
  "/trading": () => retryImport(() => import("../components/Trading")),
  "/swap": () => retryImport(() => import("../components/SwapPage")),
  "/buy-sell": () => retryImport(() => import("../components/BuySell")),
  "/defi": () => retryImport(() => import("../components/DeFi")),
  "/wallet": () => retryImport(() => import("../components/Wallet")),
  "/dao": () => retryImport(() => import("../components/DAO")),
  "/bridges": () => retryImport(() => import("../components/Bridges")),
  "/audit": () => retryImport(() => import("../components/Audit")),
};

// Track which routes have already been preloaded
const _preloaded = new Set<string>();

/**
 * Preload a route's lazy-loaded chunk.
 * Calling this multiple times for the same route is safe (no-op after first).
 */
export function preloadRoute(path: string): void {
  // Normalize: strip trailing slash, handle /trading/:symbol
  const normalized = path.replace(/\/+$/, "") || "/";
  const basePath = normalized.split("/").slice(0, 2).join("/") || "/";

  if (_preloaded.has(basePath)) return;

  const importer = ROUTE_IMPORTERS[basePath];
  if (!importer) return;

  _preloaded.add(basePath);

  // Fire-and-forget — errors are fine (user hasn't navigated yet)
  importer()
    .then(() => {
      log.debug("Preload", `Preloaded route chunk: ${basePath}`);
    })
    .catch(() => {
      // Remove from set so it can be retried
      _preloaded.delete(basePath);
    });
}

/**
 * Preload critical routes after initial page load.
 * Call this after the app has finished rendering the initial route.
 * Uses requestIdleCallback (or setTimeout fallback) to avoid blocking.
 */
export function preloadCriticalRoutes(): void {
  const idle =
    typeof window !== "undefined" && "requestIdleCallback" in window
      ? (window as any).requestIdleCallback
      : (fn: () => void) => setTimeout(fn, 2000);

  idle(() => {
    // Preload the most commonly visited routes
    preloadRoute("/markets");
    preloadRoute("/swap");
    preloadRoute("/trading");
  });
}
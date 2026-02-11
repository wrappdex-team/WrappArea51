/**
 * Web Vitals & Route Timing — lightweight performance monitoring.
 */

import { log } from "./logger";
import { ENV } from "./env";

interface PerfMetric { name: string; value: number; rating: "good" | "needs-improvement" | "poor"; }
interface RouteMetric { route: string; loadTimeMs: number; }

const _vitals: PerfMetric[] = [];
const _routes: RouteMetric[] = [];
let _routeStart: number | null = null;
let _init = false;

function rate(name: string, v: number): PerfMetric["rating"] {
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000], FID: [100, 300], CLS: [0.1, 0.25],
    TTFB: [800, 1800], INP: [200, 500],
  };
  const [good, mid] = thresholds[name] || [1000, 3000];
  return v <= good ? "good" : v <= mid ? "needs-improvement" : "poor";
}

function observe(type: string, handler: (entry: PerformanceEntry) => void) {
  try {
    new PerformanceObserver((list) => list.getEntries().forEach(handler))
      .observe({ type, buffered: true } as any);
  } catch { /* unsupported */ }
}

export function initPerformanceMonitoring(): void {
  if (_init || typeof window === "undefined" || !ENV.FEATURES.PERF_MONITORING) return;
  _init = true;

  observe("largest-contentful-paint", (e) => {
    _vitals.push({ name: "LCP", value: e.startTime, rating: rate("LCP", e.startTime) });
  });
  observe("first-input", (e) => {
    const fid = (e as any).processingStart - e.startTime;
    _vitals.push({ name: "FID", value: fid, rating: rate("FID", fid) });
  });
  observe("navigation", (e) => {
    const nav = e as PerformanceNavigationTiming;
    const ttfb = nav.responseStart - nav.requestStart;
    if (ttfb > 0) _vitals.push({ name: "TTFB", value: ttfb, rating: rate("TTFB", ttfb) });
  });

  log.debug("Perf", "Monitoring initialized");
}

export function trackRouteChange(route: string): void {
  const now = performance.now();
  const load = _routeStart !== null ? now - _routeStart : 0;
  _routeStart = now;
  if (load > 0) {
    _routes.push({ route, loadTimeMs: Math.round(load) });
    if (_routes.length > 50) _routes.shift();
  }
}

export function getMetricsSummary() {
  const avg = _routes.length > 0
    ? Math.round(_routes.reduce((s, m) => s + m.loadTimeMs, 0) / _routes.length)
    : 0;
  return { webVitals: [..._vitals], routeMetrics: [..._routes], avgRouteLoadMs: avg };
}

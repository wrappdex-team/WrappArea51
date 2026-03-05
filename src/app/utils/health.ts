/**
 * Service health checks — validates API connectivity on startup.
 *
 * IMPLEMENTATION NOTE — Health probes now route through our server-side
 * proxies instead of hitting external APIs directly from the browser.
 * This avoids CORS errors (CoinGecko), 401s (SaucerSwap API key), and
 * DNS failures (CoinCap v2) that polluted the browser console.
 * The server-side /health endpoint already checks all upstream services.
 */

import { log } from "./logger";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";

export type ServiceStatus = "healthy" | "degraded" | "down";

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  overall: ServiceStatus;
  services: ServiceHealth[];
}

let _last: HealthReport | null = null;

const SERVER_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

export async function runHealthChecks(): Promise<HealthReport> {
  const t0 = performance.now();
  try {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 8000);
    const res = await fetch(`${SERVER_BASE}/health`, {
      signal: c.signal,
      headers: {
        Authorization: `Bearer ${publicAnonKey}`,
        Accept: "application/json",
      },
    });
    clearTimeout(timer);
    const ms = Math.round(performance.now() - t0);

    if (!res.ok) {
      _last = {
        overall: "degraded",
        services: [{ name: "Server", status: "degraded", latencyMs: ms, error: `HTTP ${res.status}` }],
      };
      log.info("Health", `degraded — server returned HTTP ${res.status}`);
      return _last;
    }

    const data = await res.json();
    // Map server health response to our format
    // Server returns { checks: { kvStore: {status, latencyMs}, binance: {...}, ... } }
    const services: ServiceHealth[] = [];
    const checks = data.checks || data.services;
    if (checks && typeof checks === "object") {
      for (const [name, info] of Object.entries(checks) as [string, any][]) {
        services.push({
          name,
          status: info.status === "ok" ? "healthy" : info.status === "degraded" ? "degraded" : "down",
          latencyMs: info.latencyMs ?? ms,
          error: info.detail || info.error,
        });
      }
    }
    if (services.length === 0) {
      services.push({ name: "Server", status: "healthy", latencyMs: ms });
    }

    const down = services.filter((s) => s.status === "down").length;
    const degraded = services.filter((s) => s.status === "degraded").length;
    const overall: ServiceStatus = down > 0 ? (down + degraded >= services.length ? "down" : "degraded") : degraded > 0 ? "degraded" : "healthy";

    _last = { overall, services };
    log.info("Health", `${overall} (${services.length} services, ${ms}ms)`);
    return _last;
  } catch (err: any) {
    const ms = Math.round(performance.now() - t0);
    _last = {
      overall: "degraded",
      services: [{ name: "Server", status: "down", latencyMs: ms, error: err?.message || "Network error" }],
    };
    log.warn("Health", `Server health check failed: ${err?.message || err}`);
    return _last;
  }
}

export function getHealthStatus(): HealthReport | null { return _last; }
export function isSystemHealthy(): boolean { return !_last || _last.overall !== "down"; }
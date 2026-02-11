/**
 * Service health checks — validates API connectivity on startup.
 */

import { log } from "./logger";
import { ENV } from "./env";

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

async function check(name: string, url: string, timeoutMs = 5000): Promise<ServiceHealth> {
  const t0 = performance.now();
  try {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), timeoutMs);
    const res = await fetch(url, { method: "HEAD", signal: c.signal, mode: "no-cors" });
    clearTimeout(timer);
    const ms = Math.round(performance.now() - t0);
    const ok = res.ok || res.type === "opaque" || res.status === 0;
    return { name, status: ok ? (ms > 3000 ? "degraded" : "healthy") : "degraded", latencyMs: ms };
  } catch (err: any) {
    return {
      name,
      status: err?.name === "AbortError" ? "degraded" : "down",
      latencyMs: Math.round(performance.now() - t0),
      error: err?.name === "AbortError" ? "Timeout" : err?.message || "Network error",
    };
  }
}

export async function runHealthChecks(): Promise<HealthReport> {
  const services = await Promise.all([
    check("SaucerSwap", `${ENV.SAUCERSWAP_API}/tokens`),
    check("Mirror Node", `${ENV.MIRROR_NODE}/api/v1/transactions?limit=1`),
    check("CoinCap", `${ENV.COINCAP_API}/assets?limit=1`),
    check("CoinGecko", `${ENV.COINGECKO_API}/ping`),
  ]);

  const down = services.filter((s) => s.status === "down").length;
  const degraded = services.filter((s) => s.status === "degraded").length;
  const overall: ServiceStatus = down > 0 ? (down + degraded >= services.length ? "down" : "degraded") : degraded > 0 ? "degraded" : "healthy";

  _last = { overall, services };
  log.info("Health", `${overall} (${services.length} services)`);
  return _last;
}

export function getHealthStatus(): HealthReport | null { return _last; }
export function isSystemHealthy(): boolean { return !_last || _last.overall !== "down"; }

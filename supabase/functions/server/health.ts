// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK — Multi-service probe with KV caching
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "./kv_store.tsx";
import { ROUTE_PREFIX, saucerswapBreaker, mirrorNodeBreaker, coingeckoBreaker, oneInchBreaker } from "./shared.ts";

// ── Constants ───────────────────────────────────────────────────────

const HEALTH_CACHE_KEY_V2 = "sys_health_cache";
const HEALTH_CACHE_TTL_MS_V2 = 24 * 60 * 60 * 1000;
const HEALTH_API_TIMEOUT_MS_V2 = 6_000;

// ── Types ───────────────────────────────────────────────────────────

interface HealthCheckResultV2 {
  status: "ok" | "degraded" | "error";
  latencyMs: number;
  detail?: string;
}

interface HealthSnapshotV2 {
  timestamp: number;
  totalMs: number;
  checks: Record<string, HealthCheckResultV2>;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Extract a safe, non-leaky error summary for health probe detail fields. */
function safeProbeDetail(err: unknown): string {
  if (err instanceof Error) {
    // Return the error class + a truncated message stripped of file paths.
    // Pattern: remove anything that looks like a file:///… or /home/… path segment.
    const msg = (err.message || "").replace(/(?:file:\/\/\/|\/[\w./-]+\/)[^\s)]+/g, "<path>").slice(0, 80);
    return `${err.constructor.name}: ${msg}`;
  }
  return "Unknown error";
}

async function probeApiV2(url: string): Promise<HealthCheckResultV2> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HEALTH_API_TIMEOUT_MS_V2);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    if (res.ok) return { status: "ok", latencyMs, detail: `HTTP ${res.status}` };
    return { status: "degraded", latencyMs, detail: `HTTP ${res.status}` };
  } catch (err: any) {
    clearTimeout(timer);
    return {
      status: "error",
      latencyMs: Date.now() - t0,
      detail: err?.name === "AbortError" ? `Timeout (>${HEALTH_API_TIMEOUT_MS_V2}ms)` : safeProbeDetail(err),
    };
  }
}

// ── Deep CoinCap diagnostic probe ───────────────────────────────────
// CoinCap v2 (api.coincap.io) has been unreliable from Supabase Edge
// Functions (Deno runtime). This probe tries multiple strategies to
// diagnose whether the issue is DNS, TLS, IP-blocking, or API-level.
// IMPLEMENTATION NOTE: The frontend (browser) fetches CoinCap directly
// via CORS — this server probe tests Deno-side reachability separately.
async function probeCoinCap(): Promise<HealthCheckResultV2> {
  const t0 = Date.now();
  const attempts: string[] = [];
  const apiKey = Deno.env.get("COINCAP_API_KEY") || "";

  // Strategy 1: Standard v2 endpoint (what we actually use)
  try {
    const ac1 = new AbortController();
    const t1 = setTimeout(() => ac1.abort(), 5000);
    const res = await fetch("https://api.coincap.io/v2/assets/bitcoin", {
      signal: ac1.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "WRAPpDEX-HealthCheck/1.0",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
      },
    });
    clearTimeout(t1);
    const latencyMs = Date.now() - t0;
    if (res.ok) {
      const json = await res.json();
      const price = json?.data?.priceUsd;
      return {
        status: "ok",
        latencyMs,
        detail: `HTTP ${res.status} — BTC $${parseFloat(price || 0).toFixed(0)} (v2 API)`,
      };
    }
    attempts.push(`v2: HTTP ${res.status}`);
  } catch (err: any) {
    const msg = err?.name === "AbortError" ? "timeout >5s" : (err?.message || "unknown").slice(0, 60);
    attempts.push(`v2: ${msg}`);
    console.log(`[Health] CoinCap v2 probe failed:`, err?.message || err);
  }

  // Strategy 2: Try v3 REST endpoint (CoinCap moved some infra here)
  try {
    const ac2 = new AbortController();
    const t2 = setTimeout(() => ac2.abort(), 5000);
    const res = await fetch("https://rest.coincap.io/v3/assets/bitcoin", {
      signal: ac2.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "WRAPpDEX-HealthCheck/1.0",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
      },
    });
    clearTimeout(t2);
    const latencyMs = Date.now() - t0;
    if (res.ok) {
      return {
        status: "degraded",
        latencyMs,
        detail: `v2 DOWN but v3 OK (HTTP ${res.status}) — migrate needed`,
      };
    }
    attempts.push(`v3: HTTP ${res.status}`);
  } catch (err: any) {
    const msg = err?.name === "AbortError" ? "timeout >5s" : (err?.message || "unknown").slice(0, 60);
    attempts.push(`v3: ${msg}`);
  }

  // Strategy 3: Try bare domain (DNS/TLS test)
  try {
    const ac3 = new AbortController();
    const t3 = setTimeout(() => ac3.abort(), 4000);
    const res = await fetch("https://coincap.io/", {
      signal: ac3.signal,
      method: "HEAD",
      headers: { "User-Agent": "WRAPpDEX-HealthCheck/1.0" },
    });
    clearTimeout(t3);
    attempts.push(`coincap.io HEAD: HTTP ${res.status}`);
  } catch (err: any) {
    const msg = err?.name === "AbortError" ? "timeout >4s" : (err?.message || "unknown").slice(0, 40);
    attempts.push(`coincap.io HEAD: ${msg}`);
  }

  const latencyMs = Date.now() - t0;
  const detail = attempts.join(" | ");
  console.log(`[Health] CoinCap deep probe: ${detail}`);
  return { status: "error", latencyMs, detail };
}

// ── Route Registration ──────────────────────────────────────────────

export function registerHealthRoutes(app: Hono): void {

  app.get(`${ROUTE_PREFIX}/health`, async (c) => {
    const forceRefresh = c.req.query("refresh") === "1";

    // Serve from cache when valid
    if (!forceRefresh) {
      try {
        const cached: (HealthSnapshotV2 & { fromCache?: boolean }) | null = await kv.get(HEALTH_CACHE_KEY_V2);
        if (cached && Date.now() - cached.timestamp < HEALTH_CACHE_TTL_MS_V2) {
          // Breaker state is always live — never cached (it changes per-request)
          const circuitBreakers = {
            saucerswap: saucerswapBreaker.getStatus(),
            mirrorNode: mirrorNodeBreaker.getStatus(),
            coingecko: coingeckoBreaker.getStatus(),
            oneInch: oneInchBreaker.getStatus(),
          };
          return c.json({ ...cached, circuitBreakers, fromCache: true });
        }
      } catch { /* cache miss — proceed to live check */ }
    }

    const start = Date.now();

    const kvProbe = async (): Promise<HealthCheckResultV2> => {
      const t0 = Date.now();
      const probeKey = `health_probe_${Date.now()}`;
      try {
        await kv.set(probeKey, { ok: true, ts: t0 });
        const readback: { ok: boolean } | null = await kv.get(probeKey);
        await kv.del(probeKey);
        const latencyMs = Date.now() - t0;
        if (readback?.ok) return { status: "ok", latencyMs, detail: "Read/write verified" };
        return { status: "degraded", latencyMs, detail: "Write ok, readback mismatch" };
      } catch (err: any) {
        console.log(`[Health] KV probe error:`, err);
        return { status: "error", latencyMs: Date.now() - t0, detail: safeProbeDetail(err) };
      }
    };

    const storageProbe = async (): Promise<HealthCheckResultV2> => {
      const t0 = Date.now();
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const supabase = createSupabaseClient(supabaseUrl, supabaseKey);
        const { data, error } = await supabase.storage.listBuckets();
        if (error) return { status: "error", latencyMs: Date.now() - t0, detail: "Storage API returned error" };
        return { status: "ok", latencyMs: Date.now() - t0, detail: `${data?.length ?? 0} bucket(s)` };
      } catch (err: any) {
        console.log(`[Health] Storage probe error:`, err);
        return { status: "error", latencyMs: Date.now() - t0, detail: safeProbeDetail(err) };
      }
    };

    const [kvResult, storageResult, binance, coingecko, coincap, fng, dexscreener] = await Promise.all([
      kvProbe(),
      storageProbe(),
      probeApiV2("https://api.binance.com/api/v3/ping"),
      probeApiV2("https://api.coingecko.com/api/v3/ping"),
      probeCoinCap(),
      probeApiV2("https://api.alternative.me/fng/?limit=1"),
      probeApiV2("https://api.dexscreener.com/latest/dex/tokens/0x0000000000000000000000000000000000000000"),
    ]);

    // Circuit breaker status — live snapshot (never cached).
    // Health probes above bypass breakers (raw fetch) so they test actual
    // service availability; breaker state shows how the AMM/auth/news
    // modules currently perceive each dependency.
    const circuitBreakers = {
      saucerswap: saucerswapBreaker.getStatus(),
      mirrorNode: mirrorNodeBreaker.getStatus(),
      coingecko: coingeckoBreaker.getStatus(),
      oneInch: oneInchBreaker.getStatus(),
    };

    const snapshot: HealthSnapshotV2 = {
      timestamp: Date.now(),
      totalMs: Date.now() - start,
      checks: {
        kvStore: kvResult,
        storage: storageResult,
        binance,
        coingecko,
        coincap,
        fearGreed: fng,
        dexscreener,
      },
    };

    kv.set(HEALTH_CACHE_KEY_V2, snapshot).catch((err) => {
      console.log(`[Health] Failed to cache snapshot: ${err}`);
    });

    console.log(`[Health] Live check complete in ${snapshot.totalMs}ms`);
    return c.json({ ...snapshot, circuitBreakers, fromCache: false });
  });
}
// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK — Multi-service probe with KV caching
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "./kv_store.tsx";
import { ROUTE_PREFIX } from "./shared.ts";

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

// ── Route Registration ──────────────────────────────────────────────

export function registerHealthRoutes(app: Hono): void {

  app.get(`${ROUTE_PREFIX}/health`, async (c) => {
    const forceRefresh = c.req.query("refresh") === "1";

    // Serve from cache when valid
    if (!forceRefresh) {
      try {
        const cached: (HealthSnapshotV2 & { fromCache?: boolean }) | null = await kv.get(HEALTH_CACHE_KEY_V2);
        if (cached && Date.now() - cached.timestamp < HEALTH_CACHE_TTL_MS_V2) {
          return c.json({ ...cached, fromCache: true });
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

    const [kvResult, storageResult, coingecko, coincap, fng, dexscreener] = await Promise.all([
      kvProbe(),
      storageProbe(),
      probeApiV2("https://api.coingecko.com/api/v3/ping"),
      probeApiV2("https://api.coincap.io/v2/assets?limit=1"),
      probeApiV2("https://api.alternative.me/fng/?limit=1"),
      probeApiV2("https://api.dexscreener.com/latest/dex/tokens/0x0000000000000000000000000000000000000000"),
    ]);

    const snapshot: HealthSnapshotV2 = {
      timestamp: Date.now(),
      totalMs: Date.now() - start,
      checks: {
        kvStore: kvResult,
        storage: storageResult,
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
    return c.json({ ...snapshot, fromCache: false });
  });
}
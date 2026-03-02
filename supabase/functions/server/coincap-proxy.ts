// =====================================================================
// COINCAP PROXY — Forwards CoinCap API requests with API key auth
// =====================================================================
//
// CoinCap v3 (rest.coincap.io/v3) is the primary endpoint.
// v2 (api.coincap.io/v2) is kept as a degraded fallback only.
// The API key is stored in COINCAP_API_KEY env var. This proxy keeps it
// server-side so the frontend never exposes the secret.
//
// Endpoint:
//   GET /coincap-proxy?path=<url_encoded_path>
//
// Supported paths:
//   /assets                           — list/batch: ?ids=bitcoin,ethereum&limit=100
//   /assets/{id}                      — single asset detail
//   /assets/{id}/history              — historical price: ?interval=h1&start=...&end=...
//   /assets/{id}/markets              — market pairs for asset
//   /rates                            — all fiat/crypto exchange rates
//   /rates/{id}                       — single rate
//
// IMPLEMENTATION NOTE: v3 is PRIMARY. v2 is degraded fallback.
// The batch endpoint (/assets?ids=bitcoin,ethereum,...) is the preferred
// way to fetch multiple assets in a single request — far more efficient
// than N individual /assets/{id} calls.
// =====================================================================

import type { Hono } from "npm:hono@4.6.3";
import { ROUTE_PREFIX } from "./shared.ts";

// v3 is primary — better uptime, actively maintained
const COINCAP_V3 = "https://rest.coincap.io/v3";
// v2 is degraded fallback — unreliable from edge functions
const COINCAP_V2 = "https://api.coincap.io/v2";
const PROXY_TIMEOUT_MS = 8_000;

// ── In-Memory Cache (2 min TTL for prices, 5 min for history) ───────
interface CacheEntry { body: string; fetchedAt: number; ttlMs: number; }
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_PRICE_MS = 2 * 60 * 1000;   // 2 min for price data
const CACHE_TTL_HISTORY_MS = 5 * 60 * 1000;  // 5 min for history data
const CACHE_MAX = 300;

function evictStale(): void {
  const now = Date.now();
  for (const [k, v] of _cache) {
    if (now - v.fetchedAt > v.ttlMs) _cache.delete(k);
  }
  if (_cache.size > CACHE_MAX) {
    const sorted = [..._cache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    for (const [k] of sorted.slice(0, sorted.length - CACHE_MAX)) _cache.delete(k);
  }
}

// Determine cache TTL based on path type
function cacheTtlForPath(path: string): number {
  if (path.includes("/history")) return CACHE_TTL_HISTORY_MS;
  return CACHE_TTL_PRICE_MS;
}

// Allowed path prefixes (whitelist to prevent open proxy abuse)
const ALLOWED_PREFIXES = ["/assets", "/rates", "/exchanges", "/markets"];

function isAllowedPath(path: string): boolean {
  return ALLOWED_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function registerCoinCapProxyRoutes(app: Hono): void {
  app.get(`${ROUTE_PREFIX}/coincap-proxy`, async (c) => {
    const pathParam = c.req.query("path");
    if (!pathParam) {
      return c.json({ error: "Missing ?path= parameter" }, 400);
    }

    // Security: only proxy known CoinCap endpoint prefixes
    if (!isAllowedPath(pathParam)) {
      return c.json({ error: "Path not allowed — only /assets, /rates, /exchanges, /markets" }, 400);
    }

    const apiKey = Deno.env.get("COINCAP_API_KEY") || "";
    if (!apiKey) {
      console.log("[CoinCapProxy] COINCAP_API_KEY not set");
      return c.json({ error: "CoinCap API key not configured" }, 500);
    }

    // Check cache
    evictStale();
    const cached = _cache.get(pathParam);
    if (cached) {
      return new Response(cached.body, {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-CoinCap-Source": "cache",
        },
      });
    }

    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": "WRAPpDEX/1.0",
      "Authorization": `Bearer ${apiKey}`,
    };

    // v3 PRIMARY, v2 degraded fallback
    const endpoints = [COINCAP_V3, COINCAP_V2];
    for (const baseUrl of endpoints) {
      try {
        const url = `${baseUrl}${pathParam}`;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
        const res = await fetch(url, { signal: ac.signal, headers });
        clearTimeout(timer);

        if (res.ok) {
          const body = await res.text();
          const ttl = cacheTtlForPath(pathParam);
          _cache.set(pathParam, { body, fetchedAt: Date.now(), ttlMs: ttl });
          const source = baseUrl.includes("v3") ? "v3" : "v2-fallback";
          console.log(`[CoinCapProxy] OK (${source}) ${pathParam.slice(0, 80)}`);
          return new Response(body, {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "X-CoinCap-Source": source,
            },
          });
        }
        console.log(`[CoinCapProxy] ${baseUrl} returned HTTP ${res.status} for ${pathParam.slice(0, 80)}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[CoinCapProxy] ${baseUrl} failed: ${msg.slice(0, 80)}`);
      }
    }

    return c.json({ error: "All CoinCap endpoints failed (v3 primary, v2 fallback)" }, 502);
  });
}

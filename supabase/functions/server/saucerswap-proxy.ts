// ═══════════════════════════════════════════════════════════════════════
// SAUCERSWAP API PROXY — Server-Side Key Protection
// ═══════════════════════════════════════════════════════════════════════
//
// SECURITY AUDIT PEN-06/07/08 (2026-03-17): 1 route — GET /ss-proxy.
// READ-ONLY proxy with path allowlist. API key stays server-side.
// Rate limited. No state changes. SAFE.
// ═══════════════════════════════════════════════════════════════════════
//
// [C108] Transparent proxy for SaucerSwap API requests. Keeps the partner
// API key (SAUCERSWAP_API_KEY) server-side to prevent client-side abuse
// of rate limits. Replaces the former client-side SAUCERSWAP_PARTNER_ID
// constant that was hardcoded in prices.ts.
//
// Endpoint:
//   GET /ss-proxy?path=/tokens
//   GET /ss-proxy?path=/v1/pools
//   GET /ss-proxy?path=/v2/pools/verbose
//   GET /ss-proxy?path=/tokens/0.0.9356476
//
// Features:
//   - Attaches SAUCERSWAP_API_KEY as x-api-key header
//   - In-memory response cache (30s TTL) to reduce upstream calls
//   - Circuit breaker (shared saucerswapBreaker instance)
//   - IP-based rate limiting
//   - Path whitelist to prevent SSRF
//
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import {
  isRateLimited,
  getClientIp,
  saucerswapBreaker,
  isHttpFailure,
  CircuitBreakerOpenError,
  ROUTE_PREFIX,
} from "./shared.ts";

const SAUCERSWAP_API = "https://api.saucerswap.finance";

// ── Path Whitelist ──────────────────────────────────────────────────
// Only allow paths that match known SaucerSwap API patterns.
// Prevents SSRF by restricting the proxy to legitimate endpoints.
//
// Supported paths:
//   /tokens, /v1/pools, /v2/pools, /v2/pools/verbose
//   /V2/nfts/{accountId}/positions  (uppercase V2 — SaucerSwap quirk)
//   /v2/farm/allData
//   /tokens/0.0.9356476

const ALLOWED_PATHS: RegExp[] = [
  // Standard lowercase v1/v2 endpoints: /tokens, /v1/pools, /v2/pools/verbose, etc.
  /^\/(v[12]\/)?(tokens|pools|liqpools|lp)(\/[a-zA-Z0-9._-]+)?(\/[a-zA-Z0-9._-]+)?$/,
  // V2 positions endpoint: /V2/nfts/{accountId}/positions (uppercase V2)
  /^\/V2\/nfts\/0\.0\.\d+\/positions$/,
  // V2 farm data
  /^\/v2\/farm\/[a-zA-Z]+$/,
];

function isAllowedPath(path: string): boolean {
  if (!path || !path.startsWith("/")) return false;
  if (path.length > 200) return false;
  return ALLOWED_PATHS.some(re => re.test(path));
}

// ── In-Memory Response Cache ────────────────────────────────────────
// Short TTL (30s) balances freshness vs upstream load reduction.
// Max 200 entries to bound memory usage.

interface CacheEntry {
  body: any;
  ts: number;
  status: number;
}

const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 200;

function getCached(key: string): CacheEntry | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key: string, body: any, status: number): void {
  // Evict expired entries if over limit
  if (_cache.size >= CACHE_MAX) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of _cache) {
      if (v.ts < cutoff) _cache.delete(k);
    }
    // If still over limit, clear oldest half
    if (_cache.size >= CACHE_MAX) {
      const entries = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < entries.length / 2; i++) {
        _cache.delete(entries[i][0]);
      }
    }
  }
  _cache.set(key, { body, ts: Date.now(), status });
}

// ── Upstream Fetch ──────────────────────────────────────────────────

function getApiKey(): string {
  return Deno.env.get("SAUCERSWAP_API_KEY") ?? "";
}

async function upstream(path: string): Promise<{ status: number; body: any }> {
  const url = `${SAUCERSWAP_API}${path}`;
  const apiKey = getApiKey();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await saucerswapBreaker.call(
      () => fetch(url, { headers, signal: controller.signal }),
      isHttpFailure,
    );

    let body: any;
    try {
      body = await res.json();
    } catch {
      body = { error: `Upstream returned non-JSON (status ${res.status})` };
    }

    if (!res.ok) {
      console.log(`[SS-Proxy] Upstream ${res.status} for ${path}`);
      return { status: res.status, body: { error: "SaucerSwap API error", statusCode: res.status } };
    }

    return { status: 200, body };
  } catch (err: any) {
    if (err instanceof CircuitBreakerOpenError) {
      return { status: 503, body: { error: "SaucerSwap API temporarily unavailable", code: "CIRCUIT_OPEN" } };
    }
    if (err?.name === "AbortError") {
      console.log(`[SS-Proxy] Upstream timeout for ${path}`);
      return { status: 504, body: { error: "SaucerSwap API timeout" } };
    }
    console.log(`[SS-Proxy] Upstream fetch error for ${path}: ${err?.message}`);
    return { status: 502, body: { error: "Failed to reach SaucerSwap API", details: err?.message } };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Route Registration ──────────────────────────────────────────────

export function registerSaucerswapProxyRoutes(app: Hono) {
  const PREFIX = `${ROUTE_PREFIX}/ss-proxy`;

  // GET /ss-proxy?path=/tokens
  // Transparently proxies to SaucerSwap API with the API key attached.
  app.get(PREFIX, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) {
      return c.json({ error: "Rate limited" }, 429);
    }

    const path = c.req.query("path");
    if (!path) {
      return c.json({ error: "Missing required query parameter: path" }, 400);
    }

    if (!isAllowedPath(path)) {
      return c.json({ error: "Invalid or disallowed SaucerSwap API path" }, 400);
    }

    // Check cache
    const cached = getCached(path);
    if (cached) {
      return c.json({ ...cached.body, _cached: true }, cached.status as any);
    }

    // Forward to SaucerSwap
    const { status, body } = await upstream(path);

    // Cache successful responses
    if (status === 200) {
      setCache(path, body, status);
    }

    return c.json(body, status as any);
  });
}
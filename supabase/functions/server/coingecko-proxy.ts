// =====================================================================
// COINGECKO PROXY — Forwards CoinGecko API requests server-side
// =====================================================================
//
// CoinGecko free tier works from server-side (no CORS restrictions),
// but CORS-blocks direct browser requests from custom domains.
// This proxy eliminates 2-4 console CORS errors per page load.
//
// Endpoint:
//   GET /coingecko-proxy?path=<url_encoded_path_with_query>
//
// Supported path prefixes (whitelist — not an open proxy):
//   /coins/markets    — batch price + market cap data
//   /coins/{id}/ohlc  — OHLC chart data
//   /simple/price     — simple price lookup
//   /global           — global market overview
//
// IMPLEMENTATION NOTE: No API key needed — CoinGecko free tier is
// sufficient for our volume. The proxy just solves the CORS problem.
// Rate limit: CoinGecko free tier allows ~10-30 req/min. The 2-min
// cache ensures we stay well under that even with multiple users.
// =====================================================================

import type { Hono } from "npm:hono@4.6.3";
import { ROUTE_PREFIX } from "./shared.ts";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const PROXY_TIMEOUT_MS = 10_000;

// ── In-Memory Cache ─────────────────────────────────────────────────
interface CacheEntry { body: string; fetchedAt: number; ttlMs: number; }
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_PRICE_MS  = 2 * 60 * 1000;  // 2 min for /coins/markets, /simple/price, /global
const CACHE_TTL_OHLC_MS   = 5 * 60 * 1000;  // 5 min for OHLC chart data
const CACHE_MAX = 200;

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

function cacheTtlForPath(path: string): number {
  if (path.includes("/ohlc")) return CACHE_TTL_OHLC_MS;
  return CACHE_TTL_PRICE_MS;
}

// Allowed path prefixes (security whitelist)
const ALLOWED_PREFIXES = [
  "/coins/markets",
  "/coins/",         // covers /coins/{id}/ohlc
  "/simple/price",
  "/global",
];

function isAllowedPath(path: string): boolean {
  return ALLOWED_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function registerCoinGeckoProxyRoutes(app: Hono): void {
  app.get(`${ROUTE_PREFIX}/coingecko-proxy`, async (c) => {
    const pathParam = c.req.query("path");
    if (!pathParam) {
      return c.json({ error: "Missing ?path= parameter" }, 400);
    }

    // Security: only proxy known CoinGecko endpoint prefixes
    if (!isAllowedPath(pathParam)) {
      return c.json({ error: "Path not allowed — only /coins/*, /simple/price, /global" }, 400);
    }

    // Check cache
    evictStale();
    const cached = _cache.get(pathParam);
    if (cached) {
      return new Response(cached.body, {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-CoinGecko-Source": "cache",
        },
      });
    }

    try {
      const url = `${COINGECKO_BASE}${pathParam}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          "Accept": "application/json",
          "User-Agent": "WRAPpDEX/1.0",
        },
      });
      clearTimeout(timer);

      if (res.ok) {
        const body = await res.text();
        const ttl = cacheTtlForPath(pathParam);
        _cache.set(pathParam, { body, fetchedAt: Date.now(), ttlMs: ttl });
        console.log(`[CoinGeckoProxy] OK ${pathParam.slice(0, 80)}`);
        return new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "X-CoinGecko-Source": "live",
          },
        });
      }

      // Rate-limited or error — return status to caller
      const errBody = await res.text().catch(() => "");
      console.log(`[CoinGeckoProxy] HTTP ${res.status} for ${pathParam.slice(0, 80)}`);
      return c.json(
        { error: `CoinGecko returned HTTP ${res.status}`, detail: errBody.slice(0, 200) },
        res.status === 429 ? 429 : 502,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[CoinGeckoProxy] Failed: ${msg.slice(0, 120)}`);
      return c.json({ error: `CoinGecko proxy fetch failed: ${msg.slice(0, 200)}` }, 502);
    }
  });
}

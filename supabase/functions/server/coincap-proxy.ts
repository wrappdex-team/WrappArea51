// =====================================================================
// COINCAP PROXY — Forwards CoinCap API requests with API key auth
// =====================================================================
//
// CoinCap now requires an API key (Authorization: Bearer <key>).
// The key is stored in COINCAP_API_KEY env var. This proxy keeps it
// server-side so the frontend never exposes the secret.
//
// Endpoint:
//   GET /coincap-proxy?path=<url_encoded_path>
//
// Examples:
//   ?path=/assets/bitcoin
//   ?path=/assets/bitcoin/history?interval=h1&start=...&end=...
//
// IMPLEMENTATION NOTE: Tries v2 first, then v3 fallback.
// =====================================================================

import type { Hono } from "npm:hono@4.6.3";
import { ROUTE_PREFIX } from "./shared.ts";

const COINCAP_V2 = "https://api.coincap.io/v2";
const COINCAP_V3 = "https://rest.coincap.io/v3";
const PROXY_TIMEOUT_MS = 8_000;

// Simple in-memory cache (5 min TTL, max 200 entries)
interface CacheEntry { body: string; fetchedAt: number; }
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;

function evictStale(): void {
  const now = Date.now();
  for (const [k, v] of _cache) {
    if (now - v.fetchedAt > CACHE_TTL_MS) _cache.delete(k);
  }
  if (_cache.size > CACHE_MAX) {
    const sorted = [..._cache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    for (const [k] of sorted.slice(0, sorted.length - CACHE_MAX)) _cache.delete(k);
  }
}

export function registerCoinCapProxyRoutes(app: Hono): void {
  app.get(`${ROUTE_PREFIX}/coincap-proxy`, async (c) => {
    const pathParam = c.req.query("path");
    if (!pathParam) {
      return c.json({ error: "Missing ?path= parameter" }, 400);
    }

    // Validate path starts with /assets (only proxy asset endpoints)
    if (!pathParam.startsWith("/assets")) {
      return c.json({ error: "Only /assets/* paths are allowed" }, 400);
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

    // Try v2, then v3
    const endpoints = [COINCAP_V2, COINCAP_V3];
    for (const baseUrl of endpoints) {
      try {
        const url = `${baseUrl}${pathParam}`;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
        const res = await fetch(url, { signal: ac.signal, headers });
        clearTimeout(timer);

        if (res.ok) {
          const body = await res.text();
          // Cache successful responses
          _cache.set(pathParam, { body, fetchedAt: Date.now() });
          console.log(`[CoinCapProxy] OK ${baseUrl}${pathParam.slice(0, 60)}`);
          return new Response(body, {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "X-CoinCap-Source": baseUrl.includes("v3") ? "v3" : "v2",
            },
          });
        }
        console.log(`[CoinCapProxy] ${baseUrl} returned HTTP ${res.status} for ${pathParam.slice(0, 60)}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[CoinCapProxy] ${baseUrl} failed: ${msg.slice(0, 80)}`);
      }
    }

    return c.json({ error: "All CoinCap endpoints failed" }, 502);
  });
}

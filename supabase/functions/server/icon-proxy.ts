// =====================================================================
// ICON PROXY — Serves external token/partner images from our own origin.
// =====================================================================
//
// Problem: External CDN URLs (s2.coinmarketcap.com, saucerswap.finance)
// are blocked on Vercel deployments due to referrer/hotlink protection.
// Icons load fine on localhost but break on production domains.
//
// Solution: This endpoint fetches the image server-side (no referrer/CORS
// issues) and returns it with proper cache headers. The frontend falls
// back to this proxy when direct CDN URLs fail.
//
// Endpoint:
//   GET /icon-proxy?url=<encoded_url>
//
// Security:
//   - Strict domain whitelist (no open proxy)
//   - URL length limit (2048 chars)
//   - Response size limit (500 KB)
//   - In-memory cache (1h TTL, max 300 entries, LRU eviction)
//   - Rate limiting via shared infra
// =====================================================================

import type { Hono } from "npm:hono@4.6.3";
import { ROUTE_PREFIX, getClientIp } from "./shared.ts";

// ── Domain Whitelist ────────────────────────────────────────────────
// Only proxy images from these known-good domains.
const ALLOWED_DOMAINS = new Set([
  "s2.coinmarketcap.com",
  "s3.coinmarketcap.com",
  "coinmarketcap.com",
  "www.saucerswap.finance",
  "saucerswap.finance",
  "api.saucerswap.finance",
  "assets.coingecko.com",
  "coin-images.coingecko.com",
  "avatars.githubusercontent.com",
  "raw.githubusercontent.com",
  "altlantis.io",
  "www.google.com",        // Google favicons
  "hsuite.network",
  "www.hsuite.network",
  "hashport.network",
  "www.hashport.network",
  "www.impart.global",
  "impart.global",
  "ivyfi.io",
  "www.ivyfi.io",
]);

function isAllowedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "https:") return false;
    return ALLOWED_DOMAINS.has(url.hostname);
  } catch {
    return false;
  }
}

// ── Simple In-Memory Rate Limiter (icons-specific) ──────────────────
// More generous than the global rate limiter: 100 req/min per IP.
// In-memory only — icons don't need KV persistence.
const _iconRateLimit = new Map<string, { count: number; resetAt: number }>();
const ICON_RL_WINDOW = 60_000;
const ICON_RL_MAX = 100;

function isIconRateLimited(ip: string): boolean {
  const now = Date.now();
  // Evict stale entries periodically
  if (_iconRateLimit.size > 2_000) {
    for (const [k, v] of _iconRateLimit) {
      if (now > v.resetAt) _iconRateLimit.delete(k);
    }
  }
  const entry = _iconRateLimit.get(ip);
  if (entry && now <= entry.resetAt) {
    entry.count++;
    return entry.count > ICON_RL_MAX;
  }
  _iconRateLimit.set(ip, { count: 1, resetAt: now + ICON_RL_WINDOW });
  return false;
}

// ── In-Memory Cache ─────────────────────────────────────────────────
interface CachedIcon {
  data: Uint8Array;
  contentType: string;
  fetchedAt: number;
}

const _cache = new Map<string, CachedIcon>();
const CACHE_TTL_MS = 3_600_000;  // 1 hour
const CACHE_MAX_ENTRIES = 300;
const MAX_RESPONSE_BYTES = 512_000; // 500 KB

function evictStale(): void {
  const now = Date.now();
  for (const [key, entry] of _cache) {
    if (now - entry.fetchedAt > CACHE_TTL_MS) {
      _cache.delete(key);
    }
  }
  // LRU eviction if still over limit
  if (_cache.size > CACHE_MAX_ENTRIES) {
    const entries = [..._cache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    const toRemove = entries.slice(0, entries.length - CACHE_MAX_ENTRIES);
    for (const [key] of toRemove) _cache.delete(key);
  }
}

// ── Content-Type Detection ──────────────────────────────────────────
function guessContentType(url: string, headers: Headers): string {
  const ct = headers.get("content-type");
  if (ct && ct.startsWith("image/")) return ct.split(";")[0].trim();
  // Fallback: guess from URL extension
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "svg": return "image/svg+xml";
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "avif": return "image/avif";
    default: return "image/png";
  }
}

// ── Route Registration ──────────────────────────────────────────────

export function registerIconProxyRoutes(app: Hono): void {
  app.get(`${ROUTE_PREFIX}/icon-proxy`, async (c) => {
    const ip = getClientIp(c);
    // More generous rate limit for icons (100 req/min)
    if (isIconRateLimited(ip)) {
      return c.json({ error: "Rate limited" }, 429);
    }

    const urlParam = c.req.query("url");
    if (!urlParam) {
      return c.json({ error: "Missing ?url= parameter" }, 400);
    }

    // Decode and validate
    let targetUrl: string;
    try {
      targetUrl = decodeURIComponent(urlParam);
    } catch {
      return c.json({ error: "Invalid URL encoding" }, 400);
    }

    if (targetUrl.length > 2048) {
      return c.json({ error: "URL too long" }, 400);
    }

    if (!isAllowedUrl(targetUrl)) {
      console.log(`[IconProxy] Blocked non-whitelisted URL: ${targetUrl.slice(0, 120)}`);
      return c.json({ error: "Domain not allowed" }, 403);
    }

    // Check cache
    evictStale();
    const cached = _cache.get(targetUrl);
    if (cached) {
      return new Response(cached.data, {
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
          "Access-Control-Allow-Origin": "*",
          "X-Icon-Source": "cache",
        },
      });
    }

    // Fetch from upstream
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "WRAPpDEX-IconProxy/1.0",
          "Accept": "image/*,*/*;q=0.8",
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        console.log(`[IconProxy] Upstream returned ${res.status} for: ${targetUrl.slice(0, 120)}`);
        return c.json({ error: `Upstream returned ${res.status}` }, 502);
      }

      // Read body with size limit
      const reader = res.body?.getReader();
      if (!reader) {
        return c.json({ error: "No response body" }, 502);
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.byteLength;
        if (totalSize > MAX_RESPONSE_BYTES) {
          reader.cancel();
          return c.json({ error: "Image too large" }, 413);
        }
        chunks.push(value);
      }

      // Merge chunks
      const data = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const contentType = guessContentType(targetUrl, res.headers);

      // Store in cache
      _cache.set(targetUrl, { data, contentType, fetchedAt: Date.now() });

      return new Response(data, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
          "Access-Control-Allow-Origin": "*",
          "X-Icon-Source": "upstream",
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[IconProxy] Fetch failed for ${targetUrl.slice(0, 120)}: ${msg}`);
      return c.json({ error: "Upstream fetch failed" }, 502);
    }
  });
}
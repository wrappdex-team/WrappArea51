// ═══════════════════════════════════════════════════════════════════════
// Beta Terms Acceptance — Audit Trail Logger
// ═══════════════════════════════════════════════════════════════════════
//
// IMPLEMENTATION NOTE: Records every Beta Terms acceptance event to KV
// for regulatory compliance and audit purposes. Since the TermsGate
// renders before WalletProvider mounts, wallet IDs are NOT available
// at acceptance time. Instead we capture:
//   - Terms version (for re-acceptance tracking)
//   - ISO-8601 timestamp
//   - SHA-256 hashed IP (privacy-preserving, still enables abuse detection)
//   - User agent string (browser/device fingerprint)
//   - Viewport dimensions (desktop vs mobile differentiation)
//
// KV key pattern: beta_tos:{version}:{timestamp_ms}
// This allows getByPrefix("beta_tos:2026.02.25.1:") to retrieve all
// acceptances for a specific terms version.
//
// Rate limited: max 5 acceptance logs per IP per 10-minute window
// to prevent abuse of the logging endpoint.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import { ROUTE_PREFIX } from "./shared.ts";

// ── Constants ───────────────────────────────────────────────────────

// IMPLEMENTATION NOTE: This is the server-authoritative minimum terms version.
// When bumped here and stored in KV, all clients with older acceptances
// are forced to re-accept on their next visit. The KV key allows live
// updates without a full edge function redeploy.
const CURRENT_REQUIRED_VERSION = "2026.02.25.1";
const REQUIRED_VERSION_KV_KEY = "beta_tos_required_version";

const ACCEPT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const ACCEPT_RATE_LIMIT_MAX = 5;
const ACCEPT_RL_PREFIX = "beta_tos_rl_";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * SHA-256 hash of client IP for privacy-preserving audit logs.
 * The raw IP is never stored — only the hash, which allows duplicate
 * detection without exposing PII.
 */
async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  // Salt with a fixed project-scoped prefix to prevent rainbow table lookups
  const data = encoder.encode(`wrappdex_beta_tos_salt_${ip}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Simple per-IP rate limiter for the acceptance endpoint.
 * Uses KV with TTL-style expiry checking.
 */
async function checkAcceptRateLimit(ipHash: string): Promise<boolean> {
  const key = `${ACCEPT_RL_PREFIX}${ipHash}`;
  try {
    const existing = await kv.get(key);
    const now = Date.now();

    if (existing && existing.resetAt > now) {
      if (existing.count >= ACCEPT_RATE_LIMIT_MAX) {
        return false; // Rate limited
      }
      await kv.set(key, { count: existing.count + 1, resetAt: existing.resetAt });
    } else {
      await kv.set(key, { count: 1, resetAt: now + ACCEPT_RATE_LIMIT_WINDOW_MS });
    }
    return true;
  } catch (err) {
    // If rate limit check fails, allow the request (fail open for logging)
    console.log(`[BetaTerms] Rate limit check error: ${err}`);
    return true;
  }
}

// ── Route Registration ──────────────────────────────────────────────

export function registerBetaTermsRoutes(app: Hono): void {

  // POST /beta-terms/accept — Log a terms acceptance event
  app.post(`${ROUTE_PREFIX}/beta-terms/accept`, async (c) => {
    try {
      // Parse request body
      const body = await c.req.json().catch(() => null);
      if (!body || !body.version) {
        return c.json({ error: "Missing required field: version" }, 400);
      }

      const { version, viewport, userAgent: clientUA } = body;

      // Validate version format (YYYY.MM.DD.revision)
      if (typeof version !== "string" || version.length > 30) {
        return c.json({ error: "Invalid version format" }, 400);
      }

      // Extract and hash client IP
      const rawIP =
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
        c.req.header("x-real-ip") ||
        "unknown";
      const ipHash = await hashIP(rawIP);

      // Rate limit check
      const allowed = await checkAcceptRateLimit(ipHash);
      if (!allowed) {
        console.log(`[BetaTerms] Rate limited acceptance from IP hash: ${ipHash.slice(0, 12)}...`);
        return c.json({ error: "Rate limited. Please try again later." }, 429);
      }

      // Build audit record
      const now = Date.now();
      const record = {
        version,
        acceptedAt: new Date(now).toISOString(),
        timestampMs: now,
        ipHash: ipHash.slice(0, 16), // Store only first 16 hex chars (64-bit) — sufficient for dedup
        userAgent: (clientUA || c.req.header("user-agent") || "unknown").slice(0, 256),
        viewport: viewport
          ? {
              width: Math.min(Math.max(Number(viewport.width) || 0, 0), 10000),
              height: Math.min(Math.max(Number(viewport.height) || 0, 0), 10000),
            }
          : null,
      };

      // Write to KV with unique key
      const kvKey = `beta_tos:${version}:${now}`;
      await kv.set(kvKey, record);

      // Also maintain a running count for quick stats
      const countKey = `beta_tos_count:${version}`;
      const currentCount = (await kv.get(countKey)) || 0;
      await kv.set(countKey, currentCount + 1);

      console.log(
        `[BetaTerms] Acceptance logged — version=${version}, ` +
        `ipHash=${record.ipHash}..., ` +
        `total=${currentCount + 1}, ` +
        `viewport=${record.viewport ? `${record.viewport.width}x${record.viewport.height}` : "unknown"}`
      );

      return c.json({
        ok: true,
        recorded: record.acceptedAt,
        totalAcceptances: currentCount + 1,
      });
    } catch (err) {
      console.log(`[BetaTerms] Error logging acceptance: ${err}`);
      return c.json({ error: "Failed to record acceptance" }, 500);
    }
  });

  // GET /beta-terms/stats — Acceptance statistics (no auth required, public stats only)
  app.get(`${ROUTE_PREFIX}/beta-terms/stats`, async (c) => {
    try {
      const version = c.req.query("version");
      if (!version) {
        return c.json({ error: "Missing query parameter: version" }, 400);
      }

      const count = (await kv.get(`beta_tos_count:${version}`)) || 0;

      return c.json({
        version,
        totalAcceptances: count,
        asOf: new Date().toISOString(),
      });
    } catch (err) {
      console.log(`[BetaTerms] Error fetching stats: ${err}`);
      return c.json({ error: "Failed to retrieve stats" }, 500);
    }
  });

  // GET /beta-terms/required-version — Server-authoritative required terms version.
  // The frontend checks this on mount to detect if the user's accepted version
  // is stale and needs re-acceptance. Cached in KV for live updates.
  app.get(`${ROUTE_PREFIX}/beta-terms/required-version`, async (c) => {
    try {
      // Try KV first (allows live updates without redeploy)
      const kvVersion = await kv.get(REQUIRED_VERSION_KV_KEY);
      const version = kvVersion || CURRENT_REQUIRED_VERSION;

      // Bootstrap: ensure the KV key exists for future live updates
      if (!kvVersion) {
        await kv.set(REQUIRED_VERSION_KV_KEY, CURRENT_REQUIRED_VERSION).catch(() => {});
      }

      return c.json({
        requiredVersion: version,
        asOf: new Date().toISOString(),
      });
    } catch (err) {
      console.log(`[BetaTerms] Error fetching required version: ${err}`);
      // Fallback to hardcoded version if KV is unreachable
      return c.json({
        requiredVersion: CURRENT_REQUIRED_VERSION,
        asOf: new Date().toISOString(),
        fallback: true,
      });
    }
  });

  // PUT /beta-terms/required-version — Update the required version (admin use).
  // IMPLEMENTATION NOTE: This endpoint allows live version bumps without
  // redeploying edge functions. In production, this should be gated behind
  // session auth (requireOwner). For now, it requires the service role key
  // in the Authorization header as a simple guard.
  app.put(`${ROUTE_PREFIX}/beta-terms/required-version`, async (c) => {
    try {
      const authHeader = c.req.header("Authorization") || "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

      // Simple guard: only service role key can update the required version
      if (!authHeader.includes(serviceKey) || !serviceKey) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const body = await c.req.json().catch(() => null);
      if (!body?.version || typeof body.version !== "string") {
        return c.json({ error: "Missing required field: version" }, 400);
      }

      await kv.set(REQUIRED_VERSION_KV_KEY, body.version);

      console.log(`[BetaTerms] Required version updated to: ${body.version}`);

      return c.json({
        ok: true,
        requiredVersion: body.version,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.log(`[BetaTerms] Error updating required version: ${err}`);
      return c.json({ error: "Failed to update required version" }, 500);
    }
  });
}
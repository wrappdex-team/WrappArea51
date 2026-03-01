// ═══════════════════════════════════════════════════════════════════════
// Stargate VT API Proxy — LayerZero Value Transfer API pass-through
// ═══════════════════════════════════════════════════════════════════════
//
// IMPLEMENTATION NOTE: The LayerZero VT API (https://transfer.layerzero-api.com/v1)
// does not return CORS headers, so browser-side fetch() fails with "Failed to fetch".
// This proxy forwards GET and POST requests from the frontend to the VT API,
// adding our own CORS headers via Hono's cors middleware (already applied globally).
//
// Supported routes:
//   GET  /stargate-vt/tokens           -> GET  /v1/tokens
//   POST /stargate-vt/quotes           -> POST /v1/quotes
//   POST /stargate-vt/build-user-steps -> POST /v1/build-user-steps
//
// No API key required — the VT API is public.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";

const VT_API_BASE = "https://transfer.layerzero-api.com/v1";
const PREFIX = "/make-server-54299934/stargate-vt";
const TIMEOUT_MS = 20_000;

/**
 * Forward a request to the VT API, preserving method, query params, and body.
 */
async function proxyToVT(
  vtPath: string,
  method: string,
  queryString: string,
  body?: string | null,
): Promise<Response> {
  const url = `${VT_API_BASE}${vtPath}${queryString ? `?${queryString}` : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (body && (method === "POST" || method === "PUT")) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      headers,
      body: method === "POST" || method === "PUT" ? body : undefined,
      signal: controller.signal,
    });

    const responseBody = await res.text();
    return new Response(responseBody, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (err: any) {
    const isTimeout = err?.name === "AbortError";
    const msg = isTimeout
      ? `VT API proxy timeout after ${TIMEOUT_MS / 1000}s: ${url}`
      : `VT API proxy error: ${err?.message ?? err}`;
    console.log(`[stargate-vt-proxy] ERROR: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: isTimeout ? 504 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

export function registerStargateVtProxyRoutes(app: InstanceType<typeof Hono>) {
  // GET /stargate-vt/tokens?...
  app.get(`${PREFIX}/tokens`, async (c) => {
    const qs = new URL(c.req.url).search.replace(/^\?/, "");
    console.log(`[stargate-vt-proxy] GET /tokens?${qs}`);
    return proxyToVT("/tokens", "GET", qs);
  });

  // POST /stargate-vt/quotes
  app.post(`${PREFIX}/quotes`, async (c) => {
    const body = await c.req.text();
    console.log(`[stargate-vt-proxy] POST /quotes (${body.length} bytes)`);
    return proxyToVT("/quotes", "POST", "", body);
  });

  // POST /stargate-vt/build-user-steps
  app.post(`${PREFIX}/build-user-steps`, async (c) => {
    const body = await c.req.text();
    console.log(`[stargate-vt-proxy] POST /build-user-steps (${body.length} bytes)`);
    return proxyToVT("/build-user-steps", "POST", "", body);
  });

  console.log("[stargate-vt-proxy] Stargate VT proxy routes registered");
}

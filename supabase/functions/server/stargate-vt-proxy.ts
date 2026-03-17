// ═══════════════════════════════════════════════════════════════════════
// Stargate VT API Proxy — LayerZero Value Transfer API pass-through
// ═══════════════════════════════════════════════════════════════════════
//
// IMPLEMENTATION NOTE: The LayerZero VT API (https://transfer.layerzero-api.com/v1)
// does not return CORS headers, so browser-side fetch() fails with "Failed to fetch".
// This proxy forwards GET and POST requests from the frontend to the VT API,
// adding our own CORS headers via Hono's cors middleware (already applied globally).
//
// Auth: The VT API requires an API key for /quotes, /build-user-steps, /status,
// and /submit-signature endpoints. The key is read from LAYERZERO_VT_API_KEY env
// and sent as `x-api-key` header. The /tokens endpoint is public (no key needed).
//
// Supported routes:
//   GET  /stargate-vt/tokens           -> GET  /v1/tokens          (public)
//   POST /stargate-vt/quotes           -> POST /v1/quotes          (auth)
//   POST /stargate-vt/build-user-steps -> POST /v1/build-user-steps (auth)
//   GET  /stargate-vt/status           -> GET  /v1/status          (auth)
//   POST /stargate-vt/rpc              -> JSON-RPC proxy for balance checks
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { requireAuth } from "./auth.ts";
import { isRateLimited, getClientIp } from "./shared.ts";

const VT_API_BASE = "https://transfer.layerzero-api.com/v1";
const PREFIX = "/make-server-54299934/stargate-vt";
const TIMEOUT_MS = 20_000;

/**
 * Read the LayerZero VT API key from environment.
 * Returns empty string if not set — callers should check and return a
 * helpful error message rather than forwarding an unauthorized request.
 */
function getApiKey(): string {
  return Deno.env.get("LAYERZERO_VT_API_KEY") ?? "";
}

/**
 * Forward a request to the VT API, preserving method, query params, and body.
 * If `authenticated` is true, adds the x-api-key header.
 */
async function proxyToVT(
  vtPath: string,
  method: string,
  queryString: string,
  body?: string | null,
  authenticated: boolean = false,
): Promise<Response> {
  const url = `${VT_API_BASE}${vtPath}${queryString ? `?${queryString}` : ""}`;

  // Check API key for authenticated endpoints
  if (authenticated) {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(`[stargate-vt-proxy] ERROR: LAYERZERO_VT_API_KEY not set, cannot proxy ${method} ${vtPath}`);
      return new Response(
        JSON.stringify({
          error: "Bridge API key not configured. Please set LAYERZERO_VT_API_KEY in Supabase Edge Function secrets.",
          code: "MISSING_API_KEY",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (body && (method === "POST" || method === "PUT")) {
      headers["Content-Type"] = "application/json";
    }
    // Add API key for authenticated endpoints
    if (authenticated) {
      const apiKey = getApiKey();
      headers["x-api-key"] = apiKey;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: method === "POST" || method === "PUT" ? body : undefined,
      signal: controller.signal,
    });

    const responseBody = await res.text();

    // Log non-200 responses for debugging
    if (!res.ok) {
      console.log(`[stargate-vt-proxy] ${method} ${vtPath} returned ${res.status}: ${responseBody.slice(0, 300)}`);
    }

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

// ═══════════════════════════════════════════════════════════════════════
// Allowed RPC endpoints for balance proxy (prevent open relay abuse)
// ═══════════════════════════════════════════════════════════════════════
const ALLOWED_RPC_HOSTS = new Set([
  "eth.llamarpc.com",
  "mainnet.optimism.io",
  "bsc-dataseed1.binance.org",
  "polygon-rpc.com",
  "rpc.ftm.tools",
  "mainnet.era.zksync.io",
  "mainnet.base.org",
  "arb1.arbitrum.io",
  "api.avax.network",
  "rpc.linea.build",
  "rpc.scroll.io",
  "rpc.mantle.xyz",
  "andromeda.metis.io",
  "evm.kava.io",
  "opbnb-mainnet-rpc.bnbchain.org",
  "1rpc.io",
  "aurora-mainnet.drpc.org",
  "mainnet.mode.network",
  "rpc.sei-apis.com",
  "evm-rpc.sei-apis.com",
  "rpc.gravity.xyz",
  "rpc.xlayer.tech",
  "rpc.rarible.superseed.xyz",
  "rpc.coredao.org",
]);

// IMPLEMENTATION NOTE: W3-04 — Restrict RPC methods to read-only calls
// to prevent abuse of the proxy for state-changing transactions.
const ALLOWED_RPC_METHODS = new Set([
  "eth_getBalance",
  "eth_call",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_chainId",
  "net_version",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getTokenBalance",
]);

export function registerStargateVtProxyRoutes(app: InstanceType<typeof Hono>) {
  // ── Public endpoint ────────────────────────────────────────────────
  // GET /stargate-vt/tokens?...
  app.get(`${PREFIX}/tokens`, async (c) => {
    const qs = new URL(c.req.url).search.replace(/^\?/, "");
    console.log(`[stargate-vt-proxy] GET /tokens?${qs.slice(0, 100)}`);
    return proxyToVT("/tokens", "GET", qs, null, false);
  });

  // ── Authenticated endpoints ────────────────────────────────────────
  // IMPLEMENTATION NOTE: PEN-04 — All VT API proxy endpoints now require
  // wallet auth + rate limiting to prevent API key quota abuse.

  // POST /stargate-vt/quotes
  app.post(`${PREFIX}/quotes`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.text();
    console.log(`[stargate-vt-proxy] POST /quotes by ${auth.accountId} (${body.length} bytes)`);
    return proxyToVT("/quotes", "POST", "", body, true);
  });

  // POST /stargate-vt/build-user-steps
  app.post(`${PREFIX}/build-user-steps`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.text();
    console.log(`[stargate-vt-proxy] POST /build-user-steps by ${auth.accountId} (${body.length} bytes)`);
    return proxyToVT("/build-user-steps", "POST", "", body, true);
  });

  // GET /stargate-vt/status?txHash=...
  app.get(`${PREFIX}/status`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;

    const qs = new URL(c.req.url).search.replace(/^\?/, "");
    console.log(`[stargate-vt-proxy] GET /status by ${auth.accountId}?${qs.slice(0, 100)}`);
    return proxyToVT("/status", "GET", qs, null, true);
  });

  // ── RPC Proxy for balance checks ──────────────────────────────────
  // IMPLEMENTATION NOTE: PEN-04 — RPC proxy now requires auth, rate limiting,
  // and restricts JSON-RPC methods to a read-only allowlist.
  app.post(`${PREFIX}/rpc`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;

      const { rpcUrl, ...rpcBody } = await c.req.json();

      if (!rpcUrl || typeof rpcUrl !== "string") {
        return c.json({ error: "Missing rpcUrl" }, 400);
      }

      // Validate the RPC URL is in our allowlist
      let hostname: string;
      try {
        hostname = new URL(rpcUrl).hostname;
      } catch {
        return c.json({ error: "Invalid rpcUrl" }, 400);
      }

      if (!ALLOWED_RPC_HOSTS.has(hostname)) {
        console.log(`[stargate-vt-proxy] RPC proxy denied for host: ${hostname}`);
        return c.json({ error: `RPC host not allowed: ${hostname}` }, 403);
      }

      // Validate the RPC method is in our read-only allowlist
      const method = rpcBody?.method;
      if (!method || typeof method !== "string" || !ALLOWED_RPC_METHODS.has(method)) {
        console.log(`[stargate-vt-proxy] RPC method denied: ${method}`);
        return c.json({ error: `RPC method not allowed: ${method}` }, 403);
      }

      console.log(`[stargate-vt-proxy] RPC proxy by ${auth.accountId} -> ${hostname} method=${method}`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rpcBody),
          signal: controller.signal,
        });

        const data = await res.text();
        return new Response(data, {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      console.log(`[stargate-vt-proxy] RPC proxy error: ${err?.message}`);
      return c.json({ error: `RPC proxy error: ${err?.message}` }, 502);
    }
  });

  const apiKey = getApiKey();
  console.log(
    `[stargate-vt-proxy] Routes registered. API key: ${apiKey ? "configured ✓" : "NOT SET ✗ (quotes/build-user-steps will fail)"}`,
  );
}
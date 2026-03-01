// ═══════════════════════════════════════════════════════════════════════
// 1inch DEX Aggregator — Full-Coverage Server Proxy
// ═══════════════════════════════════════════════════════════════════════
//
// Proxies frontend requests to the 1inch Developer Portal APIs, keeping
// the ONEINCH_API_KEY secure on the server (never sent to the browser).
//
// API domains proxied (6 total):
//   Swap API v6.0        — Classic on-chain aggregated swaps
//   Fusion API v2.0      — Gasless intent-based swaps (resolvers pay gas)
//   Fusion+ API v1.0     — Cross-chain intent-based swaps
//   Token API v1.2       — Token metadata, search, custom import
//   Balance API v1.2     — Multi-token wallet balances
//   Price API v1.1       — USD token prices
//
// Route inventory (19 routes):
//
//   ── Swap API v6.0 (existing, refactored) ──
//   GET  /1inch/quote/:chainId         → /swap/v6.0/{chainId}/quote
//   GET  /1inch/swap/:chainId          → /swap/v6.0/{chainId}/swap
//   GET  /1inch/allowance/:chainId     → /swap/v6.0/{chainId}/approve/allowance
//   GET  /1inch/approve/:chainId       → /swap/v6.0/{chainId}/approve/transaction
//   GET  /1inch/tokens/:chainId        → /swap/v6.0/{chainId}/tokens
//
//   ── Fusion API v2.0 (new) ──
//   POST /1inch/fusion/quote/:chainId          → /fusion/quoter/v2.0/{chainId}/quote/receive
//   POST /1inch/fusion/build/:chainId          → /fusion/relayer/v2.0/{chainId}/order/build
//   POST /1inch/fusion/submit/:chainId         → /fusion/relayer/v2.0/{chainId}/order/submit
//   GET  /1inch/fusion/status/:chainId/:hash   → /fusion/orders/v2.0/{chainId}/order/status/{hash}
//   GET  /1inch/fusion/active/:chainId         → /fusion/orders/v2.0/{chainId}/order/active
//
//   ── Fusion+ API v1.0 (new) ──
//   POST /1inch/fusion-plus/quote              → /fusion-plus/v1.0/quote/receive
//   POST /1inch/fusion-plus/build              → /fusion-plus/v1.0/order/build
//   POST /1inch/fusion-plus/submit             → /fusion-plus/v1.0/order/submit
//   GET  /1inch/fusion-plus/status/:hash       → /fusion-plus/v1.0/order/status/{hash}
//
//   ── Token / Balance / Price APIs (new) ──
//   GET  /1inch/balance/:chainId/:wallet       → /balance/v1.2/{chainId}/balances/{wallet}
//   GET  /1inch/price/:chainId                 → /price/v1.1/{chainId}
//   GET  /1inch/token/search/:chainId          → /token/v1.2/{chainId}/search
//   GET  /1inch/token/custom/:chainId          → /token/v1.2/{chainId}/custom
//
// IMPLEMENTATION NOTE: All routes use a shared `upstreamFetch` engine with
// circuit breaker, request timeout, API key injection, and structured error
// responses. Each API domain has a dedicated upstream function that builds
// the correct base URL. POST routes forward the JSON body unchanged; GET
// routes forward query parameters. Validation is applied before every
// upstream call to reject malformed inputs at the proxy boundary.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { isRateLimited, getClientIp, oneInchBreaker, isHttpFailure, CircuitBreakerOpenError } from "./shared.ts";

/* ══════════════════════════════════════════════════════════════════════
 * Constants
 * ══════════════════════════════════════════════════════════════════════ */

/** Route prefix — matches ROUTE_PREFIX in shared.ts */
const PREFIX = "/make-server-54299934/1inch";

/**
 * 1inch Developer Portal API base URLs — one per API domain.
 *
 * IMPLEMENTATION NOTE: The 1inch Fusion API uses sub-service paths
 * (quoter, relayer, orders) between the product name and version.
 * Swap and Fusion include {chainId} in the path; Fusion+ does not
 * (chain IDs are in the request body). Token, Balance, and Price
 * APIs include {chainId} in the path.
 */
const API = {
  swap:           "https://api.1inch.dev/swap/v6.0",
  fusionQuoter:   "https://api.1inch.dev/fusion/quoter/v2.0",
  fusionRelayer:  "https://api.1inch.dev/fusion/relayer/v2.0",
  fusionOrders:   "https://api.1inch.dev/fusion/orders/v2.0",
  fusionPlus:     "https://api.1inch.dev/fusion-plus/v1.0",
  token:          "https://api.1inch.dev/token/v1.2",
  balance:        "https://api.1inch.dev/balance/v1.2",
  price:          "https://api.1inch.dev/price/v1.1",
} as const;

/**
 * Supported chain IDs — expanded from the original 6 to cover all chains
 * in the frontend chain registry (src/app/utils/oneinch/chains.ts).
 *
 * IMPLEMENTATION NOTE: If a chain is not in this set, the proxy rejects
 * the request with HTTP 400 before making any upstream call. This prevents
 * the API key from being used on unsupported chains (defence in depth).
 */
const SUPPORTED_CHAINS = new Set<number>([
  1,            // Ethereum
  56,           // BNB Chain
  137,          // Polygon
  42161,        // Arbitrum
  10,           // Optimism
  8453,         // Base
  43114,        // Avalanche
  100,          // Gnosis
  324,          // zkSync Era
  250,          // Fantom
  1313161554,   // Aurora
  8217,         // Klaytn
]);

/**
 * Chains that support Fusion v2.0 (gasless swaps).
 * A subset of SUPPORTED_CHAINS — the proxy validates Fusion requests
 * against this set to avoid forwarding calls that will fail upstream.
 */
const FUSION_CHAINS = new Set<number>([
  1, 56, 137, 42161, 10, 8453, 43114, 100,
]);

/**
 * Chains that support Fusion+ (cross-chain swaps).
 * Validated on both srcChainId and dstChainId in cross-chain requests.
 */
const FUSION_PLUS_CHAINS = new Set<number>([
  1, 56, 137, 42161, 10, 8453, 43114,
]);

/** Request timeout for upstream 1inch API calls */
const UPSTREAM_TIMEOUT_MS = 15_000;

/** Request timeout for Fusion order submission (can be slower) */
const FUSION_SUBMIT_TIMEOUT_MS = 20_000;

/** Log tag for all proxy log lines */
const TAG = "[1inch]";

/* ══════════════════════════════════════════════════════════════════════
 * Validation Helpers
 * ══════════════════════════════════════════════════════════════════════ */

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ORDER_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Validate an Ethereum address (contract or EOA) or the native token sentinel */
function isValidEthAddress(addr: unknown): addr is string {
  return typeof addr === "string" && (ETH_ADDRESS_RE.test(addr) || addr.toLowerCase() === NATIVE_ADDRESS.toLowerCase());
}

/** Validate an Ethereum address strictly (no native sentinel — for wallet addresses) */
function isValidWalletAddress(addr: unknown): addr is string {
  return typeof addr === "string" && ETH_ADDRESS_RE.test(addr);
}

/** Validate an order hash (0x + 64 hex chars) */
function isValidOrderHash(hash: unknown): hash is string {
  return typeof hash === "string" && ORDER_HASH_RE.test(hash);
}

/** Parse and validate a chain ID from a route parameter */
function parseChainId(raw: string, allowedSet: Set<number> = SUPPORTED_CHAINS): number | null {
  const n = parseInt(raw, 10);
  return allowedSet.has(n) ? n : null;
}

/** Read the 1inch API key from Deno environment */
function getApiKey(): string | null {
  const key = Deno.env.get("ONEINCH_API_KEY");
  return key && key.length > 0 ? key : null;
}

/* ═══════════���══════════════════════════════════════════════════════════
 * Caches — per API domain with appropriate TTLs
 *
 * IMPLEMENTATION NOTE: Caches are in-memory (per-isolate). This is
 * intentional — Deno Deploy edge isolates are ephemeral, and cache
 * misses just mean one extra upstream call. The caches absorb burst
 * traffic from rapid UI interactions (typing, clicking, React re-renders).
 * ══════════════════════════════════════════════════════════════════════ */

interface CacheEntry {
  data: unknown;
  ts: number;
}

class SimpleCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly name: string;

  constructor(name: string, ttlMs: number, maxEntries: number) {
    this.name = name;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): unknown | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: unknown): void {
    // Evict expired entries if at capacity
    if (this.store.size >= this.maxEntries) {
      const cutoff = Date.now() - this.ttlMs;
      for (const [k, v] of this.store) {
        if (v.ts < cutoff) this.store.delete(k);
      }
      // If still over, clear all
      if (this.store.size >= this.maxEntries) {
        this.store.clear();
        console.log(`${TAG} ${this.name} cache full — evicted all entries`);
      }
    }
    this.store.set(key, { data, ts: Date.now() });
  }

  /** Cache stats for health endpoint */
  stats(): { name: string; size: number; ttlMs: number; maxEntries: number } {
    return { name: this.name, size: this.store.size, ttlMs: this.ttlMs, maxEntries: this.maxEntries };
  }
}

/** Classic swap quote cache — 10s TTL, absorbs rapid typing bursts */
const quoteCache = new SimpleCache("quote", 10_000, 500);

/** Token list cache — 5 min TTL, lists rarely change */
const tokenListCache = new SimpleCache("tokenList", 300_000, 50);

/** Price cache — 60s TTL, prices are moderately volatile */
const priceCache = new SimpleCache("price", 60_000, 50);

/** Balance cache — 30s TTL, balances change with each transaction */
const balanceCache = new SimpleCache("balance", 30_000, 200);

/** Token search cache — 60s TTL, search results are stable */
const tokenSearchCache = new SimpleCache("tokenSearch", 60_000, 200);

/* ══════════════════════════════════════════════════════════════════════
 * Upstream Fetch Engine
 *
 * Single fetch function used by all routes. Handles:
 *   1. API key injection (Authorization: Bearer)
 *   2. Circuit breaker protection
 *   3. AbortController timeout
 *   4. Structured error response generation
 *   5. Detailed logging for debugging
 * ══════════════════════════════════════════════════════════════════════ */

interface UpstreamResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Execute an authenticated request to a 1inch API endpoint.
 *
 * @param method  HTTP method (GET or POST)
 * @param url     Full upstream URL (built by domain-specific helpers)
 * @param body    JSON body for POST requests (null for GET)
 * @param timeoutMs  Request timeout (default: UPSTREAM_TIMEOUT_MS)
 * @returns       { status, body } — status is the HTTP status code to return
 */
async function upstreamFetch(
  method: "GET" | "POST",
  url: string,
  body: string | null = null,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<UpstreamResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      status: 200,
      body: { configured: false, error: "1inch API key not configured. Set ONEINCH_API_KEY in Supabase secrets." },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    };
    if (method === "POST" && body) {
      headers["Content-Type"] = "application/json";
    }

    const res = await oneInchBreaker.call(
      () => fetch(url, {
        method,
        headers,
        body: method === "POST" ? body : undefined,
        signal: controller.signal,
      }),
      isHttpFailure,
    );

    // Parse response body
    let parsed: Record<string, unknown>;
    try {
      parsed = await res.json();
    } catch {
      parsed = { error: `Non-JSON response (HTTP ${res.status})` };
    }

    if (!res.ok) {
      const detail =
        typeof parsed.description === "string" ? parsed.description
        : typeof parsed.error === "string" ? parsed.error
        : typeof parsed.message === "string" ? parsed.message
        : JSON.stringify(parsed);

      console.log(`${TAG} Upstream ${res.status} for ${method} ${url}: ${detail}`);
      return {
        status: res.status,
        body: { error: "1inch API error", details: detail, statusCode: res.status },
      };
    }

    return { status: 200, body: parsed };
  } catch (err: any) {
    if (err instanceof CircuitBreakerOpenError) {
      console.log(`${TAG} Circuit breaker OPEN — rejecting ${method} ${url}`);
      return {
        status: 503,
        body: { error: "1inch API temporarily unavailable — retry shortly", code: "CIRCUIT_OPEN" },
      };
    }
    if (err?.name === "AbortError") {
      console.log(`${TAG} Upstream timeout (${timeoutMs}ms) for ${method} ${url}`);
      return { status: 504, body: { error: "1inch API request timed out" } };
    }
    console.log(`${TAG} Upstream fetch error for ${method} ${url}: ${err?.message}`);
    return { status: 502, body: { error: "Failed to reach 1inch API", details: err?.message } };
  } finally {
    clearTimeout(timer);
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * Domain-Specific URL Builders
 *
 * Each builder produces the full upstream URL for its API domain.
 * This keeps route handlers clean and ensures URL construction is
 * correct and consistent.
 * ══════════════════════════════════════════════════════════════════════ */

/** Build a Swap API v6.0 URL: /swap/v6.0/{chainId}/{path}?{query} */
function swapUrl(chainId: number, path: string, qs?: string): string {
  return `${API.swap}/${chainId}${path}${qs ? `?${qs}` : ""}`;
}

/** Build a Fusion Quoter URL: /fusion/quoter/v2.0/{chainId}/{path}?{query} */
function fusionQuoterUrl(chainId: number, path: string, qs?: string): string {
  return `${API.fusionQuoter}/${chainId}${path}${qs ? `?${qs}` : ""}`;
}

/** Build a Fusion Relayer URL: /fusion/relayer/v2.0/{chainId}/{path}?{query} */
function fusionRelayerUrl(chainId: number, path: string, qs?: string): string {
  return `${API.fusionRelayer}/${chainId}${path}${qs ? `?${qs}` : ""}`;
}

/** Build a Fusion Orders URL: /fusion/orders/v2.0/{chainId}/{path}?{query} */
function fusionOrdersUrl(chainId: number, path: string, qs?: string): string {
  return `${API.fusionOrders}/${chainId}${path}${qs ? `?${qs}` : ""}`;
}

/** Build a Fusion+ API v1.0 URL: /fusion-plus/v1.0/{path}?{query} (no chainId) */
function fusionPlusUrl(path: string, qs?: string): string {
  return `${API.fusionPlus}${path}${qs ? `?${qs}` : ""}`;
}

/** Build a Token API v1.2 URL: /token/v1.2/{chainId}/{path}?{query} */
function tokenUrl(chainId: number, path: string, qs?: string): string {
  return `${API.token}/${chainId}${path}${qs ? `?${qs}` : ""}`;
}

/** Build a Balance API v1.2 URL: /balance/v1.2/{chainId}/balances/{wallet} */
function balanceUrl(chainId: number, wallet: string): string {
  return `${API.balance}/${chainId}/balances/${wallet}`;
}

/** Build a Price API v1.1 URL: /price/v1.1/{chainId}?{query} */
function priceUrl(chainId: number, qs?: string): string {
  return `${API.price}/${chainId}${qs ? `?${qs}` : ""}`;
}

/* ══════════════════════════════════════════════════════════════════════
 * Route Registration
 * ══════════════════════════════════════════════════════════════════════ */

export function registerOneInchRoutes(app: Hono) {

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  SWAP API v6.0 — Classic On-Chain Aggregation (5 routes)       ║
  // ╚══════════════════════════════════════════════════════════════════╝

  // ── GET /1inch/quote/:chainId ────────────────────────────────────
  // Aggregation quote — returns expected output amount + route.
  // Required query: src, dst, amount
  // Optional query: includeGas, fee, protocols, includeTokensInfo
  app.get(`${PREFIX}/quote/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const q = c.req.query();
    if (!isValidEthAddress(q.src)) return c.json({ error: "Invalid src address" }, 400);
    if (!isValidEthAddress(q.dst)) return c.json({ error: "Invalid dst address" }, 400);
    if (!q.amount || !/^\d+$/.test(q.amount)) return c.json({ error: "Invalid amount — must be a non-negative integer in smallest unit" }, 400);

    // Cache check
    const cacheKey = `q:${chainId}:${q.src}:${q.dst}:${q.amount}`;
    const cached = quoteCache.get(cacheKey);
    if (cached) return c.json({ ...(cached as Record<string, unknown>), cached: true });

    const params = new URLSearchParams({ src: q.src, dst: q.dst, amount: q.amount });
    if (q.includeGas === "true") params.set("includeGas", "true");
    if (q.includeTokensInfo === "true") params.set("includeTokensInfo", "true");
    if (q.fee) params.set("fee", q.fee);
    if (q.protocols) params.set("protocols", q.protocols);

    const { status, body } = await upstreamFetch("GET", swapUrl(chainId, "/quote", params.toString()));

    // Cache successful quotes
    if (status === 200 && body.dstAmount) {
      quoteCache.set(cacheKey, body);
    }

    return c.json(body, status as any);
  });

  // ── GET /1inch/swap/:chainId ─────────────────────────────────────
  // Returns pre-built swap transaction calldata for signing.
  // Required query: src, dst, amount, from, slippage
  app.get(`${PREFIX}/swap/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const q = c.req.query();
    if (!isValidEthAddress(q.src)) return c.json({ error: "Invalid src address" }, 400);
    if (!isValidEthAddress(q.dst)) return c.json({ error: "Invalid dst address" }, 400);
    if (!q.amount || !/^\d+$/.test(q.amount)) return c.json({ error: "Invalid amount — must be a non-negative integer in smallest unit" }, 400);
    if (!isValidWalletAddress(q.from)) return c.json({ error: "Invalid from address" }, 400);

    const slippage = parseFloat(q.slippage || "1");
    if (isNaN(slippage) || slippage < 0 || slippage > 50) {
      return c.json({ error: "Slippage must be between 0 and 50" }, 400);
    }

    const params = new URLSearchParams({
      src: q.src, dst: q.dst, amount: q.amount,
      from: q.from!, slippage: slippage.toString(),
    });
    if (q.disableEstimate === "true") params.set("disableEstimate", "true");
    if (q.protocols) params.set("protocols", q.protocols);
    if (q.receiver && isValidWalletAddress(q.receiver)) params.set("receiver", q.receiver);
    if (q.referrer && isValidWalletAddress(q.referrer)) params.set("referrer", q.referrer);

    const { status, body } = await upstreamFetch("GET", swapUrl(chainId, "/swap", params.toString()));
    return c.json(body, status as any);
  });

  // ── GET /1inch/allowance/:chainId ────────────────────────────────
  // Check current ERC-20 allowance for the 1inch router.
  // Required query: tokenAddress, walletAddress
  app.get(`${PREFIX}/allowance/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const q = c.req.query();
    if (!isValidWalletAddress(q.tokenAddress)) return c.json({ error: "Invalid tokenAddress" }, 400);
    if (!isValidWalletAddress(q.walletAddress)) return c.json({ error: "Invalid walletAddress" }, 400);

    const params = new URLSearchParams({
      tokenAddress: q.tokenAddress!,
      walletAddress: q.walletAddress!,
    });

    const { status, body } = await upstreamFetch("GET", swapUrl(chainId, "/approve/allowance", params.toString()));
    return c.json(body, status as any);
  });

  // ── GET /1inch/approve/:chainId ──────────────────────────────────
  // Generate an ERC-20 approve() transaction for the 1inch router.
  // Required query: tokenAddress
  // Optional query: amount (omit for infinite approval)
  app.get(`${PREFIX}/approve/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const q = c.req.query();
    if (!isValidWalletAddress(q.tokenAddress)) return c.json({ error: "Invalid tokenAddress" }, 400);

    const params = new URLSearchParams({ tokenAddress: q.tokenAddress! });
    if (q.amount && /^\d+$/.test(q.amount)) params.set("amount", q.amount);

    const { status, body } = await upstreamFetch("GET", swapUrl(chainId, "/approve/transaction", params.toString()));
    return c.json(body, status as any);
  });

  // ── GET /1inch/tokens/:chainId ───────────────────────────────────
  // Full token list for the chain (thousands of tokens).
  // Cached aggressively — token metadata rarely changes.
  app.get(`${PREFIX}/tokens/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const cacheKey = `tokens:${chainId}`;
    const cached = tokenListCache.get(cacheKey);
    if (cached) return c.json(cached);

    const { status, body } = await upstreamFetch("GET", swapUrl(chainId, "/tokens"));

    if (status === 200 && body.tokens) {
      tokenListCache.set(cacheKey, body);
    }

    return c.json(body, status as any);
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  FUSION API v2.0 — Gasless Intent-Based Swaps (5 routes)       ║
  // ╚══════════════════════════════════════════════════════════════════╝

  // ── POST /1inch/fusion/quote/:chainId ────────────────────────────
  // Request a Fusion quote — returns per-preset (fast/medium/slow) fill
  // estimates and a quoteId required for the order/build step.
  //
  // Body: { srcTokenAddress, dstTokenAddress, amount, walletAddress, ... }
  app.post(`${PREFIX}/fusion/quote/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"), FUSION_CHAINS);
    if (!chainId) return c.json({ error: "Fusion not supported on this chain" }, 400);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!isValidEthAddress(body.srcTokenAddress)) return c.json({ error: "Invalid srcTokenAddress" }, 400);
    if (!isValidEthAddress(body.dstTokenAddress)) return c.json({ error: "Invalid dstTokenAddress" }, 400);
    if (typeof body.amount !== "string" || !/^\d+$/.test(body.amount)) {
      return c.json({ error: "Invalid amount — must be a non-negative integer string" }, 400);
    }
    if (!isValidWalletAddress(body.walletAddress)) return c.json({ error: "Invalid walletAddress" }, 400);

    // IMPLEMENTATION NOTE: The 1inch Fusion Quoter v2.0 expects addresses
    // in lowercase. Normalise before forwarding upstream. Only pass fields
    // the API explicitly supports to avoid "invalid address" rejections
    // from unrecognised body fields.
    const upstreamBody: Record<string, unknown> = {
      srcTokenAddress: (body.srcTokenAddress as string).toLowerCase(),
      dstTokenAddress: (body.dstTokenAddress as string).toLowerCase(),
      amount: body.amount,
      walletAddress: (body.walletAddress as string).toLowerCase(),
    };
    // Optional fields — only include if provided
    if (body.permit) upstreamBody.permit = body.permit;
    if (typeof body.fee === "number") upstreamBody.fee = body.fee;
    if (body.source) upstreamBody.source = body.source;
    if (typeof body.enableEstimate === "boolean") upstreamBody.enableEstimate = body.enableEstimate;
    if (body.isPermit2) upstreamBody.isPermit2 = body.isPermit2;

    const upstreamUrl = fusionQuoterUrl(chainId, "/quote/receive");
    console.log(`${TAG} Fusion quote: chain=${chainId} src=${upstreamBody.srcTokenAddress} dst=${upstreamBody.dstTokenAddress} amt=${upstreamBody.amount} url=${upstreamUrl}`);

    const { status, body: resBody } = await upstreamFetch(
      "POST",
      upstreamUrl,
      JSON.stringify(upstreamBody),
    );
    if (status !== 200) {
      console.log(`${TAG} Fusion quote upstream error: status=${status} body=${JSON.stringify(resBody).slice(0, 500)}`);
    }
    return c.json(resBody, status as any);
  });

  // ── POST /1inch/fusion/build/:chainId ────────────────────────────
  // Build a Fusion order — returns EIP-712 typed data for the user to sign.
  // The user signs this with eth_signTypedData_v4 (zero gas cost).
  //
  // Body: { quoteId, walletAddress, preset, ... }
  app.post(`${PREFIX}/fusion/build/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"), FUSION_CHAINS);
    if (!chainId) return c.json({ error: "Fusion not supported on this chain" }, 400);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.quoteId !== "string" || !body.quoteId) {
      return c.json({ error: "Missing or invalid quoteId" }, 400);
    }
    if (!isValidWalletAddress(body.walletAddress)) return c.json({ error: "Invalid walletAddress" }, 400);

    console.log(`${TAG} Fusion build: chain=${chainId} quoteId=${body.quoteId}`);

    const { status, body: resBody } = await upstreamFetch(
      "POST",
      fusionRelayerUrl(chainId, "/order/build"),
      JSON.stringify(body),
    );
    return c.json(resBody, status as any);
  });

  // ── POST /1inch/fusion/submit/:chainId ───────────────────────────
  // Submit a signed Fusion order to the resolver network.
  //
  // IMPLEMENTATION NOTE: This is the most security-sensitive Fusion route.
  // The body contains the user's EIP-712 signature. We forward it unchanged
  // to 1inch — the proxy never reads, stores, or logs the signature.
  //
  // Body: { orderHash, signature, quoteId, ... }
  app.post(`${PREFIX}/fusion/submit/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"), FUSION_CHAINS);
    if (!chainId) return c.json({ error: "Fusion not supported on this chain" }, 400);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.orderHash !== "string" || !body.orderHash) {
      return c.json({ error: "Missing or invalid orderHash" }, 400);
    }
    if (typeof body.signature !== "string" || !body.signature) {
      return c.json({ error: "Missing or invalid signature" }, 400);
    }

    // IMPLEMENTATION NOTE: Do NOT log the signature — it is a sensitive cryptographic value.
    console.log(`${TAG} Fusion submit: chain=${chainId} orderHash=${body.orderHash}`);

    const { status, body: resBody } = await upstreamFetch(
      "POST",
      fusionRelayerUrl(chainId, "/order/submit"),
      JSON.stringify(body),
      FUSION_SUBMIT_TIMEOUT_MS,
    );
    return c.json(resBody, status as any);
  });

  // ── GET /1inch/fusion/status/:chainId/:orderHash ─────────────────
  // Poll the status of a Fusion order (pending → assigned → filled).
  app.get(`${PREFIX}/fusion/status/:chainId/:orderHash`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"), FUSION_CHAINS);
    if (!chainId) return c.json({ error: "Fusion not supported on this chain" }, 400);

    const orderHash = c.req.param("orderHash");
    if (!isValidOrderHash(orderHash)) return c.json({ error: "Invalid orderHash — must be 0x + 64 hex chars" }, 400);

    const { status, body } = await upstreamFetch(
      "GET",
      fusionOrdersUrl(chainId, `/order/status/${orderHash}`),
    );
    return c.json(body, status as any);
  });

  // ── GET /1inch/fusion/active/:chainId ────────────────────────────
  // List a user's active (unfilled) Fusion orders on a chain.
  // Required query: walletAddress
  app.get(`${PREFIX}/fusion/active/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"), FUSION_CHAINS);
    if (!chainId) return c.json({ error: "Fusion not supported on this chain" }, 400);

    const walletAddress = c.req.query("walletAddress");
    if (!isValidWalletAddress(walletAddress)) return c.json({ error: "Invalid walletAddress query parameter" }, 400);

    const params = new URLSearchParams({ walletAddress });

    const { status, body } = await upstreamFetch(
      "GET",
      fusionOrdersUrl(chainId, "/order/active", params.toString()),
    );
    return c.json(body, status as any);
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  FUSION+ API v1.0 — Cross-Chain Intent-Based Swaps (4 routes)  ║
  // ╚══════════════════════════════════════════════════════════════════╝

  // ── POST /1inch/fusion-plus/quote ────────────────────────────────
  // Request a cross-chain swap quote.
  //
  // Body: { srcChainId, dstChainId, srcTokenAddress, dstTokenAddress, amount, walletAddress, ... }
  //
  // IMPLEMENTATION NOTE: Fusion+ URLs do NOT include chainId in the path.
  // Source and destination chain IDs are in the request body. We validate
  // both against FUSION_PLUS_CHAINS before forwarding.
  app.post(`${PREFIX}/fusion-plus/quote`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate chain IDs
    const srcChainId = typeof body.srcChainId === "number" ? body.srcChainId : NaN;
    const dstChainId = typeof body.dstChainId === "number" ? body.dstChainId : NaN;
    if (!FUSION_PLUS_CHAINS.has(srcChainId)) return c.json({ error: `Fusion+ not supported on source chain ${srcChainId}` }, 400);
    if (!FUSION_PLUS_CHAINS.has(dstChainId)) return c.json({ error: `Fusion+ not supported on destination chain ${dstChainId}` }, 400);
    if (srcChainId === dstChainId) return c.json({ error: "Source and destination chains must differ for cross-chain swaps — use Fusion for same-chain" }, 400);

    // Validate required token/amount/wallet fields
    if (!isValidEthAddress(body.srcTokenAddress)) return c.json({ error: "Invalid srcTokenAddress" }, 400);
    if (!isValidEthAddress(body.dstTokenAddress)) return c.json({ error: "Invalid dstTokenAddress" }, 400);
    if (typeof body.amount !== "string" || !/^\d+$/.test(body.amount)) {
      return c.json({ error: "Invalid amount — must be a non-negative integer string" }, 400);
    }
    if (!isValidWalletAddress(body.walletAddress)) return c.json({ error: "Invalid walletAddress" }, 400);

    // IMPLEMENTATION NOTE: Lowercase all addresses before forwarding upstream
    // (same defensive measure as the Fusion quote route).
    const upstreamBody: Record<string, unknown> = {
      srcChainId,
      dstChainId,
      srcTokenAddress: (body.srcTokenAddress as string).toLowerCase(),
      dstTokenAddress: (body.dstTokenAddress as string).toLowerCase(),
      amount: body.amount,
      walletAddress: (body.walletAddress as string).toLowerCase(),
    };
    if (typeof body.enableEstimate === "boolean") upstreamBody.enableEstimate = body.enableEstimate;
    if (typeof body.fee === "number") upstreamBody.fee = body.fee;

    const upstreamUrl = fusionPlusUrl("/quote/receive");
    console.log(`${TAG} Fusion+ quote: ${srcChainId}→${dstChainId} src=${upstreamBody.srcTokenAddress} dst=${upstreamBody.dstTokenAddress} amt=${upstreamBody.amount} url=${upstreamUrl}`);

    const { status, body: resBody } = await upstreamFetch(
      "POST",
      upstreamUrl,
      JSON.stringify(upstreamBody),
    );
    if (status !== 200) {
      console.log(`${TAG} Fusion+ quote upstream error: status=${status} body=${JSON.stringify(resBody).slice(0, 500)}`);
    }
    return c.json(resBody, status as any);
  });

  // ── POST /1inch/fusion-plus/build ────────────────────────────────
  // Build a cross-chain order — returns EIP-712 typed data for signing.
  //
  // Body: { quoteId, walletAddress, preset, ... }
  app.post(`${PREFIX}/fusion-plus/build`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.quoteId !== "string" || !body.quoteId) {
      return c.json({ error: "Missing or invalid quoteId" }, 400);
    }
    if (!isValidWalletAddress(body.walletAddress)) return c.json({ error: "Invalid walletAddress" }, 400);

    console.log(`${TAG} Fusion+ build: quoteId=${body.quoteId}`);

    const { status, body: resBody } = await upstreamFetch(
      "POST",
      fusionPlusUrl("/order/build"),
      JSON.stringify(body),
    );
    return c.json(resBody, status as any);
  });

  // ── POST /1inch/fusion-plus/submit ───────────────────────────────
  // Submit a signed cross-chain order to the resolver network.
  //
  // IMPLEMENTATION NOTE: Same security posture as Fusion submit —
  // the signature is forwarded opaquely, never logged or stored.
  //
  // Body: { orderHash, signature, quoteId, ... }
  app.post(`${PREFIX}/fusion-plus/submit`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.orderHash !== "string" || !body.orderHash) {
      return c.json({ error: "Missing or invalid orderHash" }, 400);
    }
    if (typeof body.signature !== "string" || !body.signature) {
      return c.json({ error: "Missing or invalid signature" }, 400);
    }

    console.log(`${TAG} Fusion+ submit: orderHash=${body.orderHash}`);

    const { status, body: resBody } = await upstreamFetch(
      "POST",
      fusionPlusUrl("/order/submit"),
      JSON.stringify(body),
      FUSION_SUBMIT_TIMEOUT_MS,
    );
    return c.json(resBody, status as any);
  });

  // ── GET /1inch/fusion-plus/status/:orderHash ─────────────────────
  // Poll the status of a cross-chain Fusion+ order.
  // Status lifecycle: SrcPending → SrcFilled → DstPending → DstFilled
  app.get(`${PREFIX}/fusion-plus/status/:orderHash`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const orderHash = c.req.param("orderHash");
    if (!isValidOrderHash(orderHash)) return c.json({ error: "Invalid orderHash — must be 0x + 64 hex chars" }, 400);

    const { status, body } = await upstreamFetch(
      "GET",
      fusionPlusUrl(`/order/status/${orderHash}`),
    );
    return c.json(body, status as any);
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  TOKEN API v1.2 — Metadata & Search (2 routes)                 ║
  // ╚══════════════════════════════════════════════════════════════════╝

  // ── GET /1inch/token/search/:chainId ─────────────────────────────
  // Search tokens by name or symbol. Used for the token selector autocomplete.
  // Required query: query
  app.get(`${PREFIX}/token/search/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const query = c.req.query("query");
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return c.json({ error: "Missing search query" }, 400);
    }

    // Sanitise the search query — strip special chars, cap length
    const sanitised = query.replace(/[^a-zA-Z0-9\s.-]/g, "").trim().slice(0, 50);
    if (!sanitised) return c.json({ error: "Invalid search query" }, 400);

    const cacheKey = `search:${chainId}:${sanitised.toLowerCase()}`;
    const cached = tokenSearchCache.get(cacheKey);
    if (cached) return c.json(cached);

    const params = new URLSearchParams({ query: sanitised });

    const { status, body } = await upstreamFetch("GET", tokenUrl(chainId, "/search", params.toString()));

    if (status === 200) {
      tokenSearchCache.set(cacheKey, body);
    }

    return c.json(body, status as any);
  });

  // ── GET /1inch/token/custom/:chainId ─────────────────────────────
  // Resolve token metadata by contract address. Used for custom token import.
  // Required query: address
  app.get(`${PREFIX}/token/custom/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const address = c.req.query("address");
    if (!isValidWalletAddress(address)) return c.json({ error: "Invalid token address" }, 400);

    const params = new URLSearchParams({ addresses: address });

    const { status, body } = await upstreamFetch("GET", tokenUrl(chainId, "/custom", params.toString()));
    return c.json(body, status as any);
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  BALANCE API v1.2 — Wallet Token Balances (1 route)            ║
  // ╚══════════════════════════════════════════════════════════════════╝

  // ── GET /1inch/balance/:chainId/:wallet ──────────────────────────
  // Fetch all token balances for a wallet address on a chain.
  // Returns: { "0xtoken1": "1000000", "0xtoken2": "500000000000000000" }
  app.get(`${PREFIX}/balance/:chainId/:wallet`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const wallet = c.req.param("wallet");
    if (!isValidWalletAddress(wallet)) return c.json({ error: "Invalid wallet address" }, 400);

    const cacheKey = `bal:${chainId}:${wallet.toLowerCase()}`;
    const cached = balanceCache.get(cacheKey);
    if (cached) return c.json(cached);

    const { status, body } = await upstreamFetch("GET", balanceUrl(chainId, wallet));

    if (status === 200) {
      balanceCache.set(cacheKey, body);
    }

    return c.json(body, status as any);
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  PRICE API v1.1 — USD Token Prices (1 route)                   ║
  // ╚══════════════════════════════════════════════════════════════════╝

  // ── GET /1inch/price/:chainId ────────────────────────────────────
  // Fetch USD prices for tokens on a chain.
  // Optional query: tokens (comma-separated addresses), currency
  // Returns: { "0xtoken1": "1.00", "0xtoken2": "2345.67" }
  app.get(`${PREFIX}/price/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    // Build query string from optional parameters
    const q = c.req.query();
    const params = new URLSearchParams();

    // Optional: filter to specific token addresses
    if (q.tokens && typeof q.tokens === "string") {
      // Validate each comma-separated address
      const addresses = q.tokens.split(",").map((a) => a.trim()).filter(Boolean);
      const valid = addresses.every((a) => isValidEthAddress(a));
      if (!valid) return c.json({ error: "Invalid token address in tokens parameter" }, 400);
      params.set("tokens", addresses.join(","));
    }

    // Optional: currency (default: USD)
    if (q.currency && typeof q.currency === "string" && /^[A-Z]{3}$/.test(q.currency)) {
      params.set("currency", q.currency);
    }

    const qs = params.toString();
    const cacheKey = `price:${chainId}:${qs || "__all__"}`;
    const cached = priceCache.get(cacheKey);
    if (cached) return c.json(cached);

    const { status, body } = await upstreamFetch("GET", priceUrl(chainId, qs || undefined));

    if (status === 200) {
      priceCache.set(cacheKey, body);
    }

    return c.json(body, status as any);
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  Diagnostics — Cache Stats (admin only, non-authenticated)     ║
  // ╚══════════════════════════════════════════════════════════════════╝

  // ── GET /1inch/health ────────────────────────────────────────────
  // Returns proxy health: API key status, circuit breaker state, cache stats.
  // Useful for the admin debug panel.
  app.get(`${PREFIX}/health`, (c) => {
    const apiKey = getApiKey();
    return c.json({
      apiKeyConfigured: !!apiKey,
      circuitBreaker: oneInchBreaker.getStatus(),
      caches: [
        quoteCache.stats(),
        tokenListCache.stats(),
        priceCache.stats(),
        balanceCache.stats(),
        tokenSearchCache.stats(),
      ],
      supportedChains: Array.from(SUPPORTED_CHAINS).sort((a, b) => a - b),
      fusionChains: Array.from(FUSION_CHAINS).sort((a, b) => a - b),
      fusionPlusChains: Array.from(FUSION_PLUS_CHAINS).sort((a, b) => a - b),
    });
  });

  // ── Startup log ──────────────────────────────────────────────────
  const apiKey = getApiKey();
  console.log(
    `${TAG} Routes registered (19 routes, 6 API domains). ` +
    `API key: ${apiKey ? "configured \u2713" : "NOT SET \u2717"} | ` +
    `Chains: ${SUPPORTED_CHAINS.size} classic, ${FUSION_CHAINS.size} fusion, ${FUSION_PLUS_CHAINS.size} fusion+`,
  );
}
// ═══════════════════════════════════════════════════════════════════════
// 1inch Swap API v6.0 — Server-side Proxy
// ═══════════════════════════════════════════════════════════════════════
//
// Proxies frontend requests to the 1inch Developer Portal API, keeping
// the API key secure on the server. Supports quote, swap, allowance
// check, and token approval transaction generation across 6 EVM chains.
//
// Endpoints:
//   GET /1inch/quote/:chainId       — Aggregation quote
//   GET /1inch/swap/:chainId        — Swap transaction calldata
//   GET /1inch/allowance/:chainId   — ERC-20 spender allowance
//   GET /1inch/approve/:chainId     — Approval transaction calldata
//   GET /1inch/tokens/:chainId      — Token list
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { isRateLimited, getClientIp, oneInchBreaker, isHttpFailure, CircuitBreakerOpenError } from "./shared.ts";

const ONEINCH_BASE = "https://api.1inch.dev/swap/v6.0";
const SUPPORTED_CHAINS = new Set([1, 137, 56, 42161, 10, 8453]);
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// In-memory quote cache — avoids redundant upstream calls during rapid typing.
// Short TTL (10 s) ensures price freshness while cutting burst load by ~60-80 %.
const _quoteCache = new Map<string, { data: any; ts: number }>();
const QUOTE_CACHE_TTL_MS = 10_000;
const QUOTE_CACHE_MAX = 500;

function isValidEthAddress(addr: unknown): addr is string {
  return typeof addr === "string" && (ETH_ADDRESS_RE.test(addr) || addr === NATIVE_ADDRESS);
}

function parseChainId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return SUPPORTED_CHAINS.has(n) ? n : null;
}

function getApiKey(): string | null {
  const key = Deno.env.get("ONEINCH_API_KEY");
  return key && key.length > 0 ? key : null;
}

// Upstream fetch with Authorization header + timeout
async function upstream(path: string, queryString: string): Promise<{ status: number; body: any }> {
  const url = `${ONEINCH_BASE}${path}${queryString ? `?${queryString}` : ""}`;
  const apiKey = getApiKey();
  if (!apiKey) return { status: 200, body: { configured: false, error: "1inch API key not configured" } };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await oneInchBreaker.call(
      () => fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      }),
      isHttpFailure,
    );

    let body: any;
    try {
      body = await res.json();
    } catch {
      body = { error: `Upstream returned non-JSON (status ${res.status})` };
    }

    if (!res.ok) {
      const detail = body?.description || body?.error || body?.message || JSON.stringify(body);
      console.log(`[1inch] Upstream ${res.status} for ${path}: ${detail}`);
      return {
        status: res.status,
        body: { error: "1inch API error", details: detail, statusCode: res.status },
      };
    }

    return { status: 200, body };
  } catch (err: any) {
    if (err instanceof CircuitBreakerOpenError) {
      return { status: 503, body: { error: "1inch API temporarily unavailable — retry shortly", code: "CIRCUIT_OPEN" } };
    }
    if (err?.name === "AbortError") {
      console.log(`[1inch] Upstream timeout for ${path}`);
      return { status: 504, body: { error: "1inch API timeout" } };
    }
    console.log(`[1inch] Upstream fetch error for ${path}: ${err?.message}`);
    return { status: 502, body: { error: "Failed to reach 1inch API", details: err?.message } };
  } finally {
    clearTimeout(timeout);
  }
}

export function registerOneInchRoutes(app: Hono) {
  const PREFIX = "/make-server-54299934/1inch";

  // ── GET /1inch/quote/:chainId ────────────────────────────────────
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
    if (!q.amount || !/^\d+$/.test(q.amount)) return c.json({ error: "Invalid amount" }, 400);

    // Cache check
    const cacheKey = `q:${chainId}:${q.src}:${q.dst}:${q.amount}`;
    const cached = _quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < QUOTE_CACHE_TTL_MS) {
      return c.json({ ...cached.data, cached: true });
    }

    const params = new URLSearchParams({ src: q.src, dst: q.dst, amount: q.amount });
    if (q.includeGas === "true") params.set("includeGas", "true");
    if (q.fee) params.set("fee", q.fee);
    if (q.protocols) params.set("protocols", q.protocols);

    const { status, body } = await upstream(`/${chainId}/quote`, params.toString());

    // Cache successful quotes
    if (status === 200 && body.dstAmount) {
      if (_quoteCache.size >= QUOTE_CACHE_MAX) {
        // Evict oldest entries
        const cutoff = Date.now() - QUOTE_CACHE_TTL_MS;
        for (const [k, v] of _quoteCache) {
          if (v.ts < cutoff) _quoteCache.delete(k);
        }
        // If still over limit, clear all
        if (_quoteCache.size >= QUOTE_CACHE_MAX) _quoteCache.clear();
      }
      _quoteCache.set(cacheKey, { data: body, ts: Date.now() });
    }

    return c.json(body, status as any);
  });

  // ── GET /1inch/swap/:chainId ─────────────────────────────────────
  // Required query: src, dst, amount, from, slippage
  app.get(`${PREFIX}/swap/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const q = c.req.query();
    if (!isValidEthAddress(q.src)) return c.json({ error: "Invalid src address" }, 400);
    if (!isValidEthAddress(q.dst)) return c.json({ error: "Invalid dst address" }, 400);
    if (!q.amount || !/^\d+$/.test(q.amount)) return c.json({ error: "Invalid amount" }, 400);
    if (!ETH_ADDRESS_RE.test(q.from || "")) return c.json({ error: "Invalid from address" }, 400);

    const slippage = parseFloat(q.slippage || "1");
    if (isNaN(slippage) || slippage < 0 || slippage > 50) {
      return c.json({ error: "Slippage must be 0-50" }, 400);
    }

    const params = new URLSearchParams({
      src: q.src, dst: q.dst, amount: q.amount,
      from: q.from!, slippage: slippage.toString(),
    });
    if (q.disableEstimate === "true") params.set("disableEstimate", "true");
    if (q.protocols) params.set("protocols", q.protocols);
    if (q.receiver && ETH_ADDRESS_RE.test(q.receiver)) params.set("receiver", q.receiver);

    const { status, body } = await upstream(`/${chainId}/swap`, params.toString());
    return c.json(body, status as any);
  });

  // ── GET /1inch/allowance/:chainId ────────────────────────────────
  // Required query: tokenAddress, walletAddress
  app.get(`${PREFIX}/allowance/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const q = c.req.query();
    if (!ETH_ADDRESS_RE.test(q.tokenAddress || "")) return c.json({ error: "Invalid tokenAddress" }, 400);
    if (!ETH_ADDRESS_RE.test(q.walletAddress || "")) return c.json({ error: "Invalid walletAddress" }, 400);

    const params = new URLSearchParams({
      tokenAddress: q.tokenAddress!,
      walletAddress: q.walletAddress!,
    });

    const { status, body } = await upstream(`/${chainId}/approve/allowance`, params.toString());
    return c.json(body, status as any);
  });

  // ── GET /1inch/approve/:chainId ──────────────────────────────────
  // Required query: tokenAddress
  // Optional query: amount (omit for infinite approval)
  app.get(`${PREFIX}/approve/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const q = c.req.query();
    if (!ETH_ADDRESS_RE.test(q.tokenAddress || "")) return c.json({ error: "Invalid tokenAddress" }, 400);

    const params = new URLSearchParams({ tokenAddress: q.tokenAddress! });
    if (q.amount && /^\d+$/.test(q.amount)) params.set("amount", q.amount);

    const { status, body } = await upstream(`/${chainId}/approve/transaction`, params.toString());
    return c.json(body, status as any);
  });

  // ── GET /1inch/tokens/:chainId ───────────────────────────────────
  // Returns all tokens known to the 1inch swap router on this chain.
  // Response cached aggressively (5 min) — token lists rarely change.
  const _tokenCache = new Map<number, { data: any; ts: number }>();
  const TOKEN_CACHE_TTL_MS = 300_000;

  app.get(`${PREFIX}/tokens/:chainId`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const chainId = parseChainId(c.req.param("chainId"));
    if (!chainId) return c.json({ error: "Unsupported chain" }, 400);

    const cached = _tokenCache.get(chainId);
    if (cached && Date.now() - cached.ts < TOKEN_CACHE_TTL_MS) {
      return c.json(cached.data);
    }

    const { status, body } = await upstream(`/${chainId}/tokens`, "");

    if (status === 200 && body.tokens) {
      _tokenCache.set(chainId, { data: body, ts: Date.now() });
    }

    return c.json(body, status as any);
  });
}
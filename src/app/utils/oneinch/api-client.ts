/**
 * 1inch DEX Aggregator — Authenticated API Client
 *
 * Single-responsibility fetch wrapper for all 1inch API calls.
 * Every request is routed through the Supabase edge function proxy
 * at `/make-server-54299934/1inch/*`, which injects the
 * ONEINCH_API_KEY server-side — the key never touches the browser.
 *
 * Features:
 *   - AbortController-based request timeout (configurable per call)
 *   - Exponential backoff retry with jitter (configurable)
 *   - Structured error classification (OneInchErrorKind)
 *   - In-memory response cache with TTL + LRU eviction
 *   - Request deduplication (concurrent identical GETs share one fetch)
 *   - External AbortSignal forwarding (for React effect cleanup)
 *
 * IMPLEMENTATION NOTE: This client does NOT import ethers.js, web3.js,
 * or any heavy crypto library. It is a pure fetch-based HTTP client
 * that returns typed JSON. EIP-712 signing is handled by the wallet
 * (window.ethereum) at the component layer.
 *
 * @module oneinch/api-client
 */

import { log } from "../logger";
import { projectId, publicAnonKey } from "../../../../utils/supabase/info";
import type { OneInchError, OneInchErrorKind } from "./types";

/* ══════════════════════════════════════════════════════════════════════
 * Constants
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Base URL for all 1inch API calls — proxied through our Supabase
 * edge function. The proxy adds the ONEINCH_API_KEY header and
 * forwards to `https://api.1inch.dev/*`.
 */
const PROXY_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/1inch`;

/** Default request timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Default retry count (0 = no retries, 2 = up to 3 total attempts) */
const DEFAULT_RETRIES = 2;

/** Base delay between retries (actual delay = base × 2^attempt + jitter) */
const DEFAULT_RETRY_BASE_MS = 1_000;

/** Maximum cache entries before LRU eviction kicks in */
const CACHE_MAX_ENTRIES = 500;

/** Log tag for all API client log lines */
const TAG = "1inch:client";

/* ══════════════════════════════════════════════════════════════════════
 * Cache — in-memory with TTL + LRU eviction
 *
 * IMPLEMENTATION NOTE: We intentionally avoid localStorage here.
 * API responses (quotes, prices) are ephemeral and stale data is
 * worse than no data. The in-memory cache serves purely to absorb
 * rapid-fire typing debounce bursts and React re-render storms.
 * ══════════════════════════════════════════════════════════════════════ */

interface CacheEntry<T = unknown> {
  readonly data: T;
  readonly expiresAt: number;
  lastAccessed: number;
}

const cache = new Map<string, CacheEntry>();

/** Read from cache, returning null on miss or expiry */
function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  entry.lastAccessed = Date.now();
  return entry.data as T;
}

/** Write to cache with TTL (milliseconds) */
function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  // LRU eviction: if at capacity, remove the least-recently-accessed entry
  if (cache.size >= CACHE_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of cache) {
      if (v.lastAccessed < oldestTime) {
        oldestTime = v.lastAccessed;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }

  const now = Date.now();
  cache.set(key, { data, expiresAt: now + ttlMs, lastAccessed: now });
}

/**
 * Invalidate cache entries by exact key or prefix.
 * Called after swaps complete to ensure fresh balances/quotes.
 */
export function invalidateCache(keyOrPrefix?: string): void {
  if (!keyOrPrefix) {
    cache.clear();
    log.debug(TAG, "Cache cleared (all entries)");
    return;
  }
  let removed = 0;
  for (const key of cache.keys()) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) {
      cache.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    log.debug(TAG, `Cache invalidated: ${removed} entries matching "${keyOrPrefix}"`);
  }
}

/** Current cache size — exposed for health/debug dashboards */
export function cacheSize(): number {
  return cache.size;
}

/* ══════════════════════════════════════════════════════════════════════
 * Request Deduplication
 *
 * Concurrent identical GET requests share a single in-flight fetch.
 * This prevents the React double-render in StrictMode from firing
 * two network calls for every quote.
 * ══════════════════════════════════════════════════════════════════════ */

const inflight = new Map<string, Promise<unknown>>();

/* ══════════════════════════════════════════════════════════════════════
 * Error Classification
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * HTTP status codes that should trigger a retry.
 * 429 (rate limit) and 5xx (server errors) are transient.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Classify a raw HTTP error into a structured OneInchError.
 *
 * IMPLEMENTATION NOTE: The classification logic must handle responses
 * from BOTH the upstream 1inch API AND our own proxy layer (which may
 * add its own error shapes, e.g., `{ configured: false }`).
 */
function classifyError(
  status: number,
  message: string,
  body?: Record<string, unknown>,
): OneInchError {
  let kind: OneInchErrorKind;
  let retryable = false;

  // Our proxy returns `{ configured: false }` when the API key is missing
  if (body?.configured === false || message.includes("not configured")) {
    kind = "API_KEY_MISSING";
  } else if (status === 401 || status === 403) {
    kind = "API_KEY_INVALID";
  } else if (status === 429) {
    kind = "RATE_LIMITED";
    retryable = true;
  } else if (status === 400) {
    // 1inch returns 400 for "insufficient liquidity" and "cannot estimate"
    const lowerMsg = message.toLowerCase();
    if (
      lowerMsg.includes("insufficient liquidity") ||
      lowerMsg.includes("cannot estimate") ||
      lowerMsg.includes("not enough")
    ) {
      kind = "INSUFFICIENT_LIQUIDITY";
    } else {
      kind = "INVALID_PARAMS";
    }
  } else if (status === 404) {
    // IMPLEMENTATION NOTE: A 404 with a non-JSON body means our Hono
    // proxy returned its default "Not Found" — the route hasn't been
    // deployed yet. A 404 with a JSON body means the upstream 1inch
    // API returned 404 (rare — usually means deprecated endpoint).
    kind = "ROUTE_NOT_FOUND";
  } else if (status >= 500) {
    kind = "UPSTREAM_ERROR";
    retryable = true;
  } else if (status === 503 && message.includes("CIRCUIT_OPEN")) {
    kind = "CIRCUIT_OPEN";
    retryable = true;
  } else if (status === 504 || message.includes("timeout")) {
    kind = "TIMEOUT";
    retryable = true;
  } else if (status === 0) {
    kind = "NETWORK_ERROR";
    retryable = true;
  } else {
    kind = "UNKNOWN";
  }

  // Extract the most descriptive message from the response body
  const baseDetails =
    typeof body?.details === "string"
      ? body.details
      : typeof body?.description === "string"
        ? body.description
        : typeof body?.error === "string"
          ? body.error
          : undefined;

  // IMPLEMENTATION NOTE: 1inch returns a `meta` array identifying WHICH field
  // is invalid (e.g., [{ type: "field", value: "walletAddress", message: "..." }]).
  // Appending this to `details` gives us precise diagnostics in the UI and logs
  // without needing a separate error type field for the meta array.
  let details = baseDetails;
  if (Array.isArray(body?.meta) && (body.meta as unknown[]).length > 0) {
    const metaInfo = (body.meta as Array<{ value?: string; message?: string }>)
      .map(m => [m.value, m.message].filter(Boolean).join(": "))
      .join("; ");
    if (metaInfo) {
      details = details ? `${details} [field → ${metaInfo}]` : `[field → ${metaInfo}]`;
    }
  }

  return Object.freeze({ kind, status, message, details, retryable });
}

/**
 * Custom error class for structured 1inch API failures.
 * Extends Error so it plays nicely with try/catch and error boundaries.
 */
export class OneInchApiError extends Error {
  /** Structured error metadata */
  readonly error: OneInchError;

  constructor(error: OneInchError) {
    super(error.message);
    this.name = "OneInchApiError";
    this.error = error;
  }

  /** Convenience accessors */
  get kind(): OneInchErrorKind { return this.error.kind; }
  get status(): number { return this.error.status; }
  get retryable(): boolean { return this.error.retryable; }
  get details(): string | undefined { return this.error.details; }
}

/* ══════════════════════════════════════════════════════════════════════
 * Request Options
 * ══════════════════════════════════════════════════════════════════════ */

export interface RequestOptions {
  /** Request timeout in ms (default: 15 000) */
  readonly timeout?: number;
  /** Number of retries on transient failures (default: 2) */
  readonly retries?: number;
  /** Base delay between retries in ms (default: 1 000) */
  readonly retryBaseMs?: number;
  /** Cache key — if provided, successful GET responses are cached */
  readonly cacheKey?: string;
  /** Cache TTL in ms (default: 10 000 for quotes, 300 000 for tokens) */
  readonly cacheTtlMs?: number;
  /** External AbortSignal (for React effect cleanup) */
  readonly signal?: AbortSignal;
}

/* ══════════════════════════════════════════════════════════════════════
 * Core Fetch Engine
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Execute an authenticated request to the 1inch proxy.
 *
 * @typeParam T - Expected response body type
 * @param method  - HTTP method
 * @param path    - Path relative to the proxy base (e.g., "/quote/1")
 * @param body    - Request body for POST (omit for GET)
 * @param opts    - Request options (timeout, retries, cache, signal)
 * @returns       Parsed JSON response
 * @throws        OneInchApiError on any failure
 */
async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    cacheKey,
    cacheTtlMs = 10_000,
    signal: externalSignal,
  } = opts;

  const url = `${PROXY_BASE}${path}`;

  // ── Cache check (GET only) ──
  if (method === "GET" && cacheKey) {
    const cached = cacheGet<T>(cacheKey);
    if (cached !== null) {
      log.debug(TAG, `Cache hit: ${cacheKey}`);
      return cached;
    }
  }

  // ── Deduplication (GET only) ──
  if (method === "GET") {
    const dedupeKey = `${method}:${url}`;
    const existing = inflight.get(dedupeKey);
    if (existing) {
      log.debug(TAG, `Deduplicating: ${dedupeKey}`);
      return existing as Promise<T>;
    }
  }

  // ── Build the fetch promise with retry logic ──
  const doFetch = async (): Promise<T> => {
    let lastError: OneInchApiError | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      // Exponential backoff with jitter between retries
      if (attempt > 0) {
        const delay = retryBaseMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        log.debug(TAG, `Retry ${attempt}/${retries} after ${Math.round(delay)}ms: ${path}`);
        await new Promise((r) => setTimeout(r, delay));
      }

      // Check external signal before each attempt
      if (externalSignal?.aborted) {
        throw new DOMException("Request aborted by caller", "AbortError");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      // Forward external abort to our controller
      const onExternalAbort = () => controller.abort();
      externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: `Bearer ${publicAnonKey}`,
        };
        if (body !== undefined && method !== "GET") {
          headers["Content-Type"] = "application/json";
        }

        const res = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onExternalAbort);

        // ── Parse response ──
        let parsed: Record<string, unknown>;
        try {
          parsed = await res.json();
        } catch {
          parsed = { error: `Non-JSON response (HTTP ${res.status})` };
        }

        // ── Handle API key not configured ──
        if (parsed.configured === false) {
          throw new OneInchApiError(
            classifyError(200, "1inch API key not configured", parsed),
          );
        }

        // ── Handle HTTP errors ──
        if (!res.ok) {
          const msg =
            typeof parsed.error === "string"
              ? parsed.error
              : typeof parsed.details === "string"
                ? parsed.details
                : `HTTP ${res.status}: ${res.statusText}`;

          // [DIAG] Log full response body for non-OK responses so we can trace
          // exactly what 1inch/server returned (especially _debug and meta fields)
          log.warn(TAG, `[DIAG] ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(parsed).slice(0, 2000)}`);

          const classified = classifyError(res.status, msg, parsed);

          if (classified.retryable && attempt < retries) {
            lastError = new OneInchApiError(classified);
            log.warn(TAG, `Retryable error (attempt ${attempt + 1}/${retries + 1}): ${msg}`);
            continue;
          }

          throw new OneInchApiError(classified);
        }

        // ── Success — cache if applicable ──
        const data = parsed as T;
        if (method === "GET" && cacheKey) {
          cacheSet(cacheKey, data, cacheTtlMs);
        }

        return data;
      } catch (err: unknown) {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onExternalAbort);

        // Re-throw our own errors and external aborts
        if (err instanceof OneInchApiError) throw err;
        if (err instanceof DOMException && err.name === "AbortError") {
          if (externalSignal?.aborted) throw err;

          // Internal timeout
          const timeoutError = classifyError(
            0,
            `Request timed out after ${timeout}ms: ${path}`,
          );
          if (attempt < retries) {
            lastError = new OneInchApiError(timeoutError);
            log.warn(TAG, `Timeout (attempt ${attempt + 1}/${retries + 1}): ${path}`);
            continue;
          }
          throw new OneInchApiError(timeoutError);
        }

        // Network errors (DNS failure, TLS, etc.)
        const networkError = classifyError(
          0,
          err instanceof Error ? err.message : "Network error",
        );
        if (attempt < retries) {
          lastError = new OneInchApiError(networkError);
          log.warn(TAG, `Network error (attempt ${attempt + 1}/${retries + 1}): ${path}`);
          continue;
        }
        throw new OneInchApiError(networkError);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError ?? new OneInchApiError(
      classifyError(0, "Request failed after all retries"),
    );
  };

  // ── Execute with deduplication ──
  const dedupeKey = method === "GET" ? `${method}:${url}` : null;

  if (dedupeKey) {
    const promise = doFetch().finally(() => {
      inflight.delete(dedupeKey);
    });
    inflight.set(dedupeKey, promise);
    return promise;
  }

  return doFetch();
}

/* ══════════════════════════════════════════════════════════════════════
 * Public API
 *
 * IMPLEMENTATION NOTE: The public surface is intentionally minimal —
 * get(), post(), invalidateCache(). All 1inch-specific business logic
 * lives in the domain modules (fusion.ts, tokens.ts, etc.) that call
 * these primitives.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Authenticated GET request to the 1inch proxy.
 *
 * @example
 * ```ts
 * const quote = await oneInchApi.get<ClassicQuoteResponse>(
 *   `/quote/1?src=${src}&dst=${dst}&amount=${amount}`,
 *   { cacheKey: `quote:1:${src}:${dst}:${amount}`, cacheTtlMs: 10_000 },
 * );
 * ```
 */
async function get<T>(path: string, opts?: RequestOptions): Promise<T> {
  return request<T>("GET", path, undefined, opts);
}

/**
 * Authenticated POST request to the 1inch proxy.
 *
 * @example
 * ```ts
 * const quote = await oneInchApi.post<FusionQuoteResponse>(
 *   `/fusion/quote/1`,
 *   { srcTokenAddress: "0x...", dstTokenAddress: "0x...", amount: "1000000", walletAddress: "0x..." },
 * );
 * ```
 */
async function post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>("POST", path, body, opts);
}

/**
 * Check whether a caught error is a user-initiated abort (React cleanup).
 * Components should silently swallow these rather than showing error UI.
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Check whether a caught error indicates the API key is not configured.
 * The UI should show the "Set ONEINCH_API_KEY" prompt instead of an error.
 */
export function isApiKeyMissing(err: unknown): boolean {
  return err instanceof OneInchApiError && err.kind === "API_KEY_MISSING";
}

/**
 * Extract a human-friendly error message from any caught error.
 * Falls back gracefully for non-OneInchApiError exceptions.
 */
export function friendlyErrorMessage(err: unknown): string {
  if (err instanceof OneInchApiError) {
    switch (err.kind) {
      case "API_KEY_MISSING":
        return "1inch API key not configured. Set ONEINCH_API_KEY in Supabase secrets.";
      case "API_KEY_INVALID":
        return "1inch API key is invalid. Check your key at portal.1inch.dev.";
      case "RATE_LIMITED":
        return "Too many requests. Please wait a moment and try again.";
      case "INSUFFICIENT_LIQUIDITY":
        return "Insufficient liquidity for this trade. Try a smaller amount or different pair.";
      case "INVALID_PARAMS": {
        // Detect "invalid address" specifically — most likely cause is stale server deployment
        // where the old srcTokenAddress/dstTokenAddress fields are still being sent to
        // 1inch Fusion Quoter v2.0 (which expects fromTokenAddress/toTokenAddress).
        const rawDetail = err.details ?? err.message ?? "";
        if (rawDetail.toLowerCase().includes("invalid address")) {
          return `1inch rejected the address format (${rawDetail}). If this persists, ensure the server has been redeployed: supabase functions deploy make-server-54299934`;
        }
        return rawDetail || "Invalid swap parameters.";
      }
      case "UPSTREAM_ERROR":
        return "1inch API is temporarily unavailable. Please try again shortly.";
      case "CIRCUIT_OPEN":
        return "1inch API circuit breaker is open. Service will recover automatically.";
      case "TIMEOUT":
        return "Request timed out. Please try again.";
      case "NETWORK_ERROR":
        return "Network error. Check your internet connection.";
      case "ROUTE_NOT_FOUND":
        return "Endpoint not found (404). Either the server needs redeployment or the upstream 1inch API endpoint has changed.";
      default:
        return err.details ?? err.message;
    }
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

/* ══════════════════════════════════════════════════════════════════════
 * Exported Client Object
 *
 * Usage:
 *   import { oneInchApi } from "../utils/oneinch/api-client";
 *   const data = await oneInchApi.get<SomeType>("/quote/1?...");
 * ══════════════════════════════════════════════════════════════════════ */

export const oneInchApi = Object.freeze({
  get,
  post,
  invalidateCache,
  cacheSize,
  isAbortError,
  isApiKeyMissing,
  friendlyErrorMessage,
}) as {
  get: typeof get;
  post: typeof post;
  invalidateCache: typeof invalidateCache;
  cacheSize: typeof cacheSize;
  isAbortError: typeof isAbortError;
  isApiKeyMissing: typeof isApiKeyMissing;
  friendlyErrorMessage: typeof friendlyErrorMessage;
};
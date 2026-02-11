/**
 * Resilient API Client — retry, timeout, cache.
 */

import { log } from "./logger";

export interface ApiOptions {
  timeout?: number;
  retries?: number;
  retryBaseDelay?: number;
  headers?: Record<string, string>;
  cacheKey?: string;
  cacheTTL?: number;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Cache ──────────────────────────────────────────────────────────

const _cache = new Map<string, { data: unknown; expires: number }>();

function getCached<T>(key: string): T | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { _cache.delete(key); return null; }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttl: number): void {
  _cache.set(key, { data, expires: Date.now() + ttl });
}

export function invalidateCache(keyOrPrefix?: string): void {
  if (!keyOrPrefix) { _cache.clear(); return; }
  for (const key of _cache.keys()) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) _cache.delete(key);
  }
}

// ── Core ───────────────────────────────────────────────────────────

function isRetryableStatus(s: number): boolean {
  return s === 429 || s === 502 || s === 503 || s === 504 || s === 0;
}

async function resilientFetch<T>(
  url: string,
  method: "GET" | "POST",
  body: unknown | undefined,
  opts: ApiOptions = {}
): Promise<T> {
  const {
    timeout = 10_000, retries = 2, retryBaseDelay = 1_000,
    headers = {}, cacheKey, cacheTTL = 30_000, signal: extSignal,
  } = opts;

  if (method === "GET" && cacheKey) {
    const cached = getCached<T>(cacheKey);
    if (cached !== null) return cached;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = retryBaseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeout);
    if (extSignal?.aborted) { clearTimeout(tid); throw new DOMException("Aborted", "AbortError"); }

    try {
      const h: Record<string, string> = { Accept: "application/json", ...headers };
      if (body && method !== "GET") h["Content-Type"] = "application/json";

      const res = await fetch(url, {
        method, headers: h,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(tid);

      if (!res.ok) {
        const retryable = isRetryableStatus(res.status);
        const msg = `HTTP ${res.status}: ${res.statusText}`;
        if (retryable && attempt < retries) { lastError = new ApiError(msg, res.status, url, true); continue; }
        throw new ApiError(msg, res.status, url, retryable);
      }

      const ct = res.headers.get("content-type") || "";
      const data: T = ct.includes("application/json") ? await res.json() : (await res.text()) as unknown as T;
      if (method === "GET" && cacheKey) setCache(cacheKey, data, cacheTTL);
      return data;
    } catch (err: unknown) {
      clearTimeout(tid);
      if (err instanceof DOMException && err.name === "AbortError") {
        if (extSignal?.aborted) throw err;
        lastError = new ApiError(`Timeout after ${timeout}ms`, 0, url, true);
        if (attempt < retries) continue;
        throw lastError;
      }
      if (err instanceof ApiError) throw err;
      lastError = new ApiError(err instanceof Error ? err.message : "Network error", 0, url, true);
      if (err instanceof TypeError && attempt < retries) continue;
      throw lastError;
    }
  }
  throw lastError || new ApiError("Request failed", 0, url, false);
}

async function get<T>(url: string, opts?: ApiOptions): Promise<T> {
  return resilientFetch<T>(url, "GET", undefined, opts);
}

async function post<T>(url: string, body?: unknown, opts?: ApiOptions): Promise<T> {
  return resilientFetch<T>(url, "POST", body, opts);
}

export const api = { get, post, invalidateCache } as const;

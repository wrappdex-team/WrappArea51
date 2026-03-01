/**
 * 1inch DEX Aggregator — Dual-Layer Token Cache
 *
 * Two-tier caching system for token data:
 *
 *   Layer 1 (L1): In-memory Map — sub-millisecond reads, lost on page reload.
 *   Layer 2 (L2): localStorage  — persists across sessions, ~1ms reads.
 *
 * Different data types get different TTLs:
 *   - Token metadata (symbol, name, logo): 1 hour  — rarely changes.
 *   - USD prices:                          5 min    — moderately volatile.
 *   - Wallet balances:                     30 sec   — L1 only, changes per tx.
 *   - Search results:                      5 min    — API results are stable.
 *   - Favorites/recents:                   No TTL   — user preferences.
 *
 * IMPLEMENTATION NOTE: localStorage is used as a persistence layer, NOT
 * a security boundary. Token metadata and prices are not sensitive.
 * Favorites/recents are user preferences. Wallet balances are never
 * written to localStorage (L1 only) to avoid stale balance display
 * after external transfers.
 *
 * @module oneinch/token-cache
 */

import { log } from "../logger";

/* ======================================================================
 * Constants
 * ====================================================================== */

const TAG = "1inch:cache";
const LS_PREFIX = "wrappdex:1inch:";

/** TTL presets in milliseconds */
export const CacheTTL = {
  /** Token metadata — symbol, name, logo, decimals (rarely changes) */
  TOKEN_METADATA: 60 * 60 * 1000,  // 1 hour
  /** Full token list for a chain */
  TOKEN_LIST: 60 * 60 * 1000,      // 1 hour
  /** USD prices (moderately volatile) */
  PRICES: 5 * 60 * 1000,           // 5 min
  /** Wallet balances (changes per tx, L1 only) */
  BALANCES: 30 * 1000,             // 30 sec
  /** API search results */
  SEARCH: 5 * 60 * 1000,           // 5 min
  /** No expiry — user preferences */
  FOREVER: Infinity,
} as const;

/* ======================================================================
 * L1: In-Memory Cache
 * ====================================================================== */

interface L1Entry {
  data: unknown;
  expiresAt: number;
}

const l1 = new Map<string, L1Entry>();
const L1_MAX_ENTRIES = 1000;

function l1Get<T>(key: string): T | null {
  const entry = l1.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    l1.delete(key);
    return null;
  }
  return entry.data as T;
}

function l1Set(key: string, data: unknown, ttlMs: number): void {
  if (l1.size >= L1_MAX_ENTRIES) {
    // Evict expired entries first
    const now = Date.now();
    for (const [k, v] of l1) {
      if (now > v.expiresAt) l1.delete(k);
    }
    // If still full, evict oldest 25%
    if (l1.size >= L1_MAX_ENTRIES) {
      const toDelete = Math.floor(L1_MAX_ENTRIES * 0.25);
      let deleted = 0;
      for (const k of l1.keys()) {
        if (deleted >= toDelete) break;
        l1.delete(k);
        deleted++;
      }
    }
  }
  l1.set(key, {
    data,
    expiresAt: ttlMs === Infinity ? Number.MAX_SAFE_INTEGER : Date.now() + ttlMs,
  });
}

function l1Delete(key: string): void {
  l1.delete(key);
}

/* ======================================================================
 * L2: localStorage Cache
 *
 * IMPLEMENTATION NOTE: We wrap every localStorage call in try/catch
 * because Safari private browsing, storage quotas, and other browsers
 * can throw on set/get. The app must work without localStorage.
 * ====================================================================== */

interface L2Entry {
  d: unknown;   // data (short key to save space)
  e: number;    // expiresAt timestamp
  v: number;    // version (for future migration)
}

const L2_VERSION = 1;
const L2_MAX_KEYS = 200;

function l2Key(key: string): string {
  return `${LS_PREFIX}${key}`;
}

function l2Get<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(l2Key(key));
    if (!raw) return null;
    const entry: L2Entry = JSON.parse(raw);
    if (entry.v !== L2_VERSION) {
      localStorage.removeItem(l2Key(key));
      return null;
    }
    if (entry.e !== 0 && Date.now() > entry.e) {
      localStorage.removeItem(l2Key(key));
      return null;
    }
    return entry.d as T;
  } catch {
    return null;
  }
}

function l2Set(key: string, data: unknown, ttlMs: number): void {
  try {
    const entry: L2Entry = {
      d: data,
      e: ttlMs === Infinity ? 0 : Date.now() + ttlMs,
      v: L2_VERSION,
    };
    localStorage.setItem(l2Key(key), JSON.stringify(entry));
  } catch (err: any) {
    // Storage full — evict old entries and retry once
    if (err?.name === "QuotaExceededError" || err?.code === 22) {
      l2Evict();
      try {
        const entry: L2Entry = {
          d: data,
          e: ttlMs === Infinity ? 0 : Date.now() + ttlMs,
          v: L2_VERSION,
        };
        localStorage.setItem(l2Key(key), JSON.stringify(entry));
      } catch {
        log.warn(TAG, "localStorage write failed after eviction");
      }
    }
  }
}

function l2Delete(key: string): void {
  try {
    localStorage.removeItem(l2Key(key));
  } catch { /* ignore */ }
}

/** Evict expired + oldest entries from localStorage */
function l2Evict(): void {
  try {
    const now = Date.now();
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) keys.push(k);
    }

    // Remove expired entries
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const entry: L2Entry = JSON.parse(raw);
        if (entry.e !== 0 && now > entry.e) {
          localStorage.removeItem(k);
        }
      } catch {
        localStorage.removeItem(k);
      }
    }

    // If still too many, remove oldest
    const remaining: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) remaining.push(k);
    }
    if (remaining.length > L2_MAX_KEYS) {
      const toRemove = remaining.length - Math.floor(L2_MAX_KEYS * 0.75);
      for (let i = 0; i < toRemove && i < remaining.length; i++) {
        localStorage.removeItem(remaining[i]);
      }
    }
  } catch {
    log.warn(TAG, "localStorage eviction failed");
  }
}

/* ======================================================================
 * Public API — Dual-Layer Operations
 * ====================================================================== */

/**
 * Read from cache — checks L1 first, then L2.
 * If found in L2 but not L1, promotes to L1 for subsequent fast access.
 */
export function cacheGet<T>(key: string): T | null {
  // L1 check (fast path)
  const l1Result = l1Get<T>(key);
  if (l1Result !== null) return l1Result;

  // L2 check (slower, persisted)
  const l2Result = l2Get<T>(key);
  if (l2Result !== null) {
    // Promote to L1 with a conservative TTL (remaining L2 TTL or 5 min)
    l1Set(key, l2Result, 5 * 60 * 1000);
    return l2Result;
  }

  return null;
}

/**
 * Write to both L1 and L2 caches.
 *
 * @param key     Cache key
 * @param data    Data to cache
 * @param ttlMs   TTL in milliseconds (use CacheTTL presets)
 * @param l1Only  If true, skip localStorage (for sensitive/ephemeral data like balances)
 */
export function cacheSet<T>(key: string, data: T, ttlMs: number, l1Only = false): void {
  l1Set(key, data, ttlMs);
  if (!l1Only) {
    l2Set(key, data, ttlMs);
  }
}

/**
 * Delete from both caches.
 */
export function cacheDelete(key: string): void {
  l1Delete(key);
  l2Delete(key);
}

/**
 * Invalidate all entries matching a key prefix.
 * Used after swaps to bust balance/quote caches.
 */
export function cacheInvalidatePrefix(prefix: string): void {
  // L1 invalidation
  for (const key of l1.keys()) {
    if (key.startsWith(prefix)) l1.delete(key);
  }

  // L2 invalidation
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(l2Key(prefix))) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

/**
 * Clear all 1inch caches (both layers).
 * Used for debugging or when switching wallets.
 */
export function cacheClearAll(): void {
  l1.clear();
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
    log.debug(TAG, `Cleared ${toRemove.length} localStorage entries`);
  } catch { /* ignore */ }
}

/** Diagnostic: count of L1 entries */
export function cacheL1Size(): number {
  return l1.size;
}

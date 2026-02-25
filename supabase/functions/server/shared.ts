// ═══════════════════════════════════════════════════════════════════════
// Shared Infrastructure — Rate Limiting, Sanitization, Crypto, KV Locks
// ═══════════════════════════════════════════════════════════════════════

import * as kv from "./kv_store.tsx";

// ── Rate Limiter (KV-backed, per-IP) ─────────────────────────────────
// L1: in-memory cache for hot-path speed. L2: KV for persistence.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_PREFIX = "rl_";
const _rateLimitL1 = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_L1_MAX_SIZE = 10_000; // Cap in-memory map to prevent unbounded growth

// ── Per-Account Rate Limiter ─────────────────────────────────────────
// Supplements IP-based limiting with account-level throttling.
// Prevents spam from compromised sessions sharing different IPs.
// L1-only (in-memory) — KV cost not justified for short windows.
//
// NOTE [PERF-01]:
//   Per-account limiting is critical because a single compromised session
//   could rotate source IPs (proxies/VPNs) to bypass IP limits. Account-level
//   tracking is immune to IP rotation.

const ACCOUNT_RATE_LIMIT_WINDOW_MS = 60_000;    // 1-minute window
const ACCOUNT_RATE_LIMIT_MAX_SWAPS = 15;         // Max 15 swaps/min per account
const ACCOUNT_RATE_LIMIT_MAX_MUTATIONS = 30;     // Max 30 total mutations/min
const _accountRateLimitL1 = new Map<string, { swapCount: number; mutationCount: number; resetAt: number }>();
const ACCOUNT_RATE_LIMIT_L1_MAX_SIZE = 5_000;

export async function isAccountRateLimited(
  accountId: string,
  action: "swap" | "liquidity" | "other" = "other",
): Promise<boolean> {
  const now = Date.now();

  // Periodic eviction
  if (_accountRateLimitL1.size > ACCOUNT_RATE_LIMIT_L1_MAX_SIZE) {
    for (const [k, v] of _accountRateLimitL1) {
      if (now > v.resetAt) _accountRateLimitL1.delete(k);
    }
  }

  const entry = _accountRateLimitL1.get(accountId);
  if (entry && now <= entry.resetAt) {
    entry.mutationCount++;
    if (action === "swap") entry.swapCount++;
    if (entry.mutationCount > ACCOUNT_RATE_LIMIT_MAX_MUTATIONS) return true;
    if (action === "swap" && entry.swapCount > ACCOUNT_RATE_LIMIT_MAX_SWAPS) return true;
    return false;
  }

  // Fresh window
  _accountRateLimitL1.set(accountId, {
    swapCount: action === "swap" ? 1 : 0,
    mutationCount: 1,
    resetAt: now + ACCOUNT_RATE_LIMIT_WINDOW_MS,
  });
  return false;
}

export async function isRateLimited(ip: string): Promise<boolean> {
  const now = Date.now();
  const kvKey = RATE_LIMIT_PREFIX + ip.replace(/[^a-zA-Z0-9._:-]/g, "_");

  // Periodic L1 eviction — prune expired entries when map grows large
  if (_rateLimitL1.size > RATE_LIMIT_L1_MAX_SIZE) {
    for (const [k, v] of _rateLimitL1) {
      if (now > v.resetAt) _rateLimitL1.delete(k);
    }
  }

  // L1: fast in-memory check (covers warm instances)
  const l1 = _rateLimitL1.get(ip);
  if (l1 && now <= l1.resetAt) {
    l1.count++;
    if (l1.count > RATE_LIMIT_MAX_REQUESTS) return true;
    // Async write-through to KV (non-blocking)
    kv.set(kvKey, { count: l1.count, resetAt: l1.resetAt }).catch(() => {});
    return false;
  }

  // L2: KV check (covers cold starts / new instances)
  try {
    const l2: { count: number; resetAt: number } | null = await kv.get(kvKey);
    if (l2 && now <= l2.resetAt) {
      const updated = { count: l2.count + 1, resetAt: l2.resetAt };
      _rateLimitL1.set(ip, updated);
      kv.set(kvKey, updated).catch(() => {});
      return updated.count > RATE_LIMIT_MAX_REQUESTS;
    }
  } catch {
    // KV unreachable — cannot verify whether this IP has prior request history.
    // Fail conservative: start a penalized L1 window so subsequent requests on
    // this instance are tracked, but reduce the remaining budget to prevent the
    // edge case where KV flakiness effectively doubles the allowed burst rate.
    console.log(`[RateLimit] KV read failed for ${ip} — enforcing conservative L1 limit`);
    const penalized = { count: Math.ceil(RATE_LIMIT_MAX_REQUESTS * 0.6), resetAt: now + RATE_LIMIT_WINDOW_MS };
    _rateLimitL1.set(ip, penalized);
    kv.set(kvKey, penalized).catch(() => {});
    return penalized.count > RATE_LIMIT_MAX_REQUESTS;
  }

  // Fresh window
  const fresh = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  _rateLimitL1.set(ip, fresh);
  kv.set(kvKey, fresh).catch(() => {});
  return false;
}

// Trusted-proxy IP resolution for Supabase Edge Functions.
// Supabase runs behind Cloudflare → Kong API gateway → Deno Deploy.
//
// Priority (most trustworthy first):
//   1. cf-connecting-ip  — Set by Cloudflare at the edge; cannot be spoofed by clients.
//   2. x-real-ip         — Set by Kong/nginx reverse proxy layer; infrastructure-controlled.
//   3. x-forwarded-for   — LAST entry only (rightmost-first). Cloudflare appends the real
//                          client IP, so the rightmost value is the most recently proxy-appended.
//                          The leftmost value is client-supplied and trivially spoofable.
//
// All values are validated against IPv4/IPv6 format to reject garbage injection.
const _IP_V4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const _IP_V6_RE = /^[0-9a-fA-F:]+$/;
function _isValidIp(ip: string | undefined | null): ip is string {
  if (!ip) return false;
  const trimmed = ip.trim();
  return trimmed.length > 0 && trimmed.length <= 45 && (_IP_V4_RE.test(trimmed) || _IP_V6_RE.test(trimmed));
}

export function getClientIp(c: any): string {
  // 1. Cloudflare-set header — highest trust
  const cfIp = c.req.header("cf-connecting-ip")?.trim();
  if (_isValidIp(cfIp)) return cfIp;

  // 2. Reverse-proxy header
  const realIp = c.req.header("x-real-ip")?.trim();
  if (_isValidIp(realIp)) return realIp;

  // 3. XFF fallback — rightmost entry (last proxy-appended, not client-supplied)
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",");
    // Walk from right to left, return first valid IP
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts[i].trim();
      if (_isValidIp(candidate)) return candidate;
    }
  }

  return "unknown";
}

// ── Input Sanitization ───────────────────────────────────────────────

export function sanitizeString(input: string, maxLength: number): string {
  return input
    .normalize("NFC")
    .replace(/[<>"'&]/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    // Strip zero-width and invisible Unicode characters
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    // Strip bidirectional override/control characters (text direction spoofing)
    .replace(/[\u202A-\u202E\u2066-\u2069\u061C\u200E\u200F]/g, "")
    // Strip combining diacritical marks beyond the first per base char (homoglyph stacking)
    .replace(/([\u0300-\u036F]){2,}/g, "$1")
    .trim()
    .slice(0, maxLength);
}

export function isValidHederaAccountId(id: string): boolean {
  return /^0\.0\.\d{1,10}$/.test(id);
}

/**
 * Validate that a string is a safe non-negative integer suitable for BigInt conversion.
 * Rejects: empty, negative, decimal, scientific notation, non-digit chars, leading zeros
 * (except bare "0"), and strings longer than maxDigits (default 78 — max uint256).
 */
export function isValidBigIntString(s: unknown, maxDigits = 78): boolean {
  if (typeof s !== "string" || s.length === 0 || s.length > maxDigits) return false;
  if (!/^\d+$/.test(s)) return false;
  // Reject leading zeros (except bare "0")
  if (s.length > 1 && s[0] === "0") return false;
  return true;
}

/**
 * Validate a pool ID matches the expected deterministic format: sl-{symbol}-{symbol}
 * or a multi-hop composite: sl-{sym}-{sym}+sl-{sym}-{sym}
 */
export function isValidPoolId(id: unknown): boolean {
  if (typeof id !== "string" || id.length === 0 || id.length > 80) return false;
  return /^sl-[a-z]{2,10}-[a-z]{2,10}(\+sl-[a-z]{2,10}-[a-z]{2,10})?$/.test(id);
}

// ── Crypto-safe helpers ──────────────────────────────────────────────

export function secureRandomFloat(): number {
  // Generate a cryptographically secure float in [0, 1)
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / (0xFFFFFFFF + 1);
}

export function secureRandomInt(max: number): number {
  return Math.floor(secureRandomFloat() * max);
}

export function generateTicketId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `TKT-${hex}`;
}

// ── KV-Based Distributed Lock ───────────────────────────────────────
// Pessimistic lock using KV with write-verify-retry pattern + double-check.
// TTL safety valve ensures release even if holder crashes.
//
// Double-verify pattern: After the initial write-then-read confirms our
// holder, we wait a brief grace period and re-read. This catches the edge
// case where two concurrent writers both wrote within the same KV propagation
// window and both passed the first verify. The second verify (after the
// grace delay) sees the final settled state.
//
// Remaining limitation: KV does not support atomic SETNX, so a sub-millisecond
// race is still theoretically possible. The CAS layer on pool state
// (compareAndSavePool) is the authoritative guard — it will reject any
// write that arrives with a stale version. For production at scale,
// migrate to Redis SETNX or Postgres advisory locks.

export interface KvLockConfig {
  key: string;         // Full KV key for this lock
  ttlMs: number;       // Max hold time before TTL expiry (safety valve)
  waitMs: number;      // Max time to wait for acquisition
  retryMs: number;     // Base retry interval (jittered)
}

interface KvLock {
  holder: string;      // Random UUID identifying the lock holder
  acquiredAt: number;
  expiresAt: number;
  epoch: number;       // Crypto-random fencing token — globally unique across isolates
}

/**
 * Crypto-random fencing token — replaces a monotonic counter that was
 * process-local and therefore meaningless across Edge Function isolates.
 * A 48-bit random integer has a ~1-in-281-trillion collision probability
 * per acquisition attempt, making cross-isolate epoch collisions negligible.
 */
function cryptoRandomEpoch(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // Use 48 bits (safe within Number.MAX_SAFE_INTEGER = 2^53 - 1)
  return (buf[0] * 0x10000) + (buf[1] >>> 16);
}

/** Grace period between first and second verify (double-check) */
const LOCK_GRACE_MS = 15;

/**
 * Acquire a KV-backed pessimistic lock with double-verify pattern.
 * 1. Write lock with unique holder + epoch
 * 2. First verify: read-after-write confirms our holder
 * 3. Grace wait: allows any concurrent writer's set to propagate
 * 4. Second verify: re-read confirms we still own it
 *
 * Returns the holder UUID on success, null on timeout.
 */
export async function acquireKvLock(cfg: KvLockConfig): Promise<string | null> {
  const holderId = crypto.randomUUID();
  const deadline = Date.now() + cfg.waitMs;

  while (Date.now() < deadline) {
    const existing: KvLock | null = await kv.get(cfg.key);

    // Lock is free or expired → try to acquire
    if (!existing || Date.now() > existing.expiresAt) {
      const epoch = cryptoRandomEpoch();
      const lock: KvLock = {
        holder: holderId,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + cfg.ttlMs,
        epoch,
      };
      await kv.set(cfg.key, lock);

      // First verify: read-after-write
      const v1: KvLock | null = await kv.get(cfg.key);
      if (v1?.holder === holderId && v1?.epoch === epoch) {
        // Grace period — let any concurrent writer's set propagate
        await new Promise(r => setTimeout(r, LOCK_GRACE_MS));

        // Second verify: confirm we still own it after grace period
        const v2: KvLock | null = await kv.get(cfg.key);
        if (v2?.holder === holderId && v2?.epoch === epoch) {
          return holderId; // Lock acquired — double-verified
        }
        // Someone overwrote during grace period — fall through to retry
      }
      // Someone else won — fall through to retry
    }

    // Jittered backoff to prevent thundering herd
    const jitter = cfg.retryMs + Math.random() * cfg.retryMs;
    await new Promise(r => setTimeout(r, jitter));
  }

  console.log(`[Lock] Timeout on ${cfg.key} after ${cfg.waitMs}ms`);
  return null;
}

/** Release a KV lock. Only the holder can release it. */
export async function releaseKvLock(key: string, holderId: string): Promise<void> {
  try {
    const existing: KvLock | null = await kv.get(key);
    // Only release if we still own it AND the lock hasn't expired.
    // If expired, a new holder may have acquired between our read and delete —
    // deleting would remove their valid lock. Let TTL clean up stale locks.
    if (existing?.holder === holderId && Date.now() < existing.expiresAt) {
      await kv.del(key);
    }
  } catch {
    // Best-effort release — TTL will clean up regardless
  }
}

/**
 * Execute a function while holding a KV lock.
 * Throws `{ code: "LOCK_TIMEOUT" }` if acquisition fails.
 */
export async function withKvLock<T>(cfg: KvLockConfig, fn: () => Promise<T>): Promise<T> {
  const holderId = await acquireKvLock(cfg);
  if (!holderId) {
    throw { code: "LOCK_TIMEOUT", message: `Lock acquisition timeout on ${cfg.key}` };
  }
  try {
    return await fn();
  } finally {
    await releaseKvLock(cfg.key, holderId);
  }
}

// ── Shared Lock Constants ───────────────────────────────────────────

export const POOL_LOCK_RETRY_INTERVAL_MS = 40;    // Spin-wait interval

// ── Hedera Mirror Node ──────────────────────────────────────────────
// Canonical hostnames — single source of truth for every server module.
// Always use mainnet-public (the community-facing public endpoint).
// `mainnet.mirrornode.hedera.com` also resolves but is not the canonical
// hostname; mixing the two causes independent failure modes.

export const HEDERA_MIRROR_MAINNET = "https://mainnet-public.mirrornode.hedera.com";
export const HEDERA_MIRROR_TESTNET = "https://testnet.mirrornode.hedera.com";

// ── Route Prefix ────────────────────────────────────────────────────
// All Hono routes are registered under this path prefix.
// Single source of truth — eliminates 30+ hardcoded repetitions across modules.

export const ROUTE_PREFIX = "/make-server-54299934";

// ── Circuit Breaker ─────────────────────────────────────────────────
// Prevents cascading failures when external services (SaucerSwap, Mirror
// Node, CoinGecko, 1inch) become unavailable. Without this, a 5-minute
// outage generates thousands of failing HTTP requests that consume CPU,
// saturate connection pools, and delay recovery.
//
// States:
//   CLOSED    → Normal. Failures counted in rolling window.
//               Trips to OPEN when failureThreshold reached.
//   OPEN      → Requests short-circuit immediately (no HTTP call).
//               After openDurationMs, transitions to HALF_OPEN.
//   HALF_OPEN → Single probe allowed through. Success → CLOSED. Failure → OPEN.
//
// Per-isolate (in-memory): each Deno Deploy isolate independently detects
// outages along its network path. This is intentional — a service may be
// reachable from one edge region but not another.

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number;
  failureWindowMs: number;
  openDurationMs: number;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreakerOpenError extends Error {
  readonly code = "CIRCUIT_OPEN" as const;
  readonly service: string;
  constructor(service: string) {
    super(`${service} circuit breaker is OPEN — service temporarily unavailable`);
    this.service = service;
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures: number[] = [];
  private openedAt = 0;
  private halfOpenInFlight = false;
  private readonly cfg: CircuitBreakerConfig;

  constructor(cfg: CircuitBreakerConfig) {
    this.cfg = cfg;
  }

  get currentState(): CircuitState { return this.state; }

  /**
   * Execute fn() through the breaker.
   *
   * @param fn          Async operation to protect (typically a fetch call).
   * @param isFailure   Optional result classifier. If fn() resolves but the
   *                    result indicates a service-level error (e.g. HTTP 5xx),
   *                    return true to count it as a breaker failure. The result
   *                    is still returned to the caller for status-specific handling.
   */
  async call<T>(fn: () => Promise<T>, isFailure?: (result: T) => boolean): Promise<T> {
    this.transitionIfReady();

    if (this.state === "OPEN") {
      throw new CircuitBreakerOpenError(this.cfg.name);
    }

    if (this.state === "HALF_OPEN") {
      if (this.halfOpenInFlight) {
        // Another probe is already in progress — reject to avoid piling on
        throw new CircuitBreakerOpenError(this.cfg.name);
      }
      this.halfOpenInFlight = true;
    }

    try {
      const result = await fn();

      // Check if the "successful" result is actually a service failure
      if (isFailure?.(result)) {
        this.onFailure();
        return result; // Still return — caller handles HTTP status-specific logic
      }

      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Snapshot for health/monitoring endpoints. */
  getStatus(): {
    state: CircuitState;
    failures: number;
    service: string;
    openedAt: number | null;
    nextProbeAt: number | null;
  } {
    this.transitionIfReady();
    return {
      service: this.cfg.name,
      state: this.state,
      failures: this.failures.length,
      openedAt: this.state !== "CLOSED" ? this.openedAt : null,
      nextProbeAt: this.state === "OPEN" ? this.openedAt + this.cfg.openDurationMs : null,
    };
  }

  /** Time-based state transition (OPEN → HALF_OPEN after cooldown). */
  private transitionIfReady(): void {
    if (this.state === "OPEN" && Date.now() >= this.openedAt + this.cfg.openDurationMs) {
      console.log(`[Breaker:${this.cfg.name}] OPEN → HALF_OPEN (cooldown elapsed, allowing probe)`);
      this.state = "HALF_OPEN";
      this.halfOpenInFlight = false;
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      console.log(`[Breaker:${this.cfg.name}] HALF_OPEN → CLOSED (probe succeeded)`);
      this.state = "CLOSED";
      this.failures = [];
      this.halfOpenInFlight = false;
    }
    // CLOSED success is a no-op — only failures are tracked
  }

  private onFailure(): void {
    const now = Date.now();

    if (this.state === "HALF_OPEN") {
      console.log(`[Breaker:${this.cfg.name}] HALF_OPEN → OPEN (probe failed — resetting cooldown)`);
      this.state = "OPEN";
      this.openedAt = now;
      this.halfOpenInFlight = false;
      return;
    }

    // CLOSED: accumulate failure in rolling window
    this.failures.push(now);
    const cutoff = now - this.cfg.failureWindowMs;
    this.failures = this.failures.filter(t => t > cutoff);

    if (this.failures.length >= this.cfg.failureThreshold) {
      console.log(
        `[Breaker:${this.cfg.name}] CLOSED → OPEN ` +
        `(${this.failures.length}/${this.cfg.failureThreshold} failures in ${this.cfg.failureWindowMs / 1000}s window)`
      );
      this.state = "OPEN";
      this.openedAt = now;
      this.failures = [];
    }
  }
}

// ── Pre-configured Breaker Instances (one per external service) ─────

/** SaucerSwap price oracle — critical for swap quotes and display prices. */
export const saucerswapBreaker = new CircuitBreaker({
  name: "SaucerSwap",
  failureThreshold: 5,
  failureWindowMs: 60_000,
  openDurationMs: 30_000,
});

/** Hedera Mirror Node — auth (pubkey fetch), VIP verification, news. */
export const mirrorNodeBreaker = new CircuitBreaker({
  name: "MirrorNode",
  failureThreshold: 5,
  failureWindowMs: 60_000,
  openDurationMs: 30_000,
});

/** CoinGecko — trending coins, global market data (non-critical). */
export const coingeckoBreaker = new CircuitBreaker({
  name: "CoinGecko",
  failureThreshold: 3,
  failureWindowMs: 60_000,
  openDurationMs: 60_000,
});

/** 1inch DEX aggregator — swap/quote proxy for EVM chains. */
export const oneInchBreaker = new CircuitBreaker({
  name: "1inch",
  failureThreshold: 5,
  failureWindowMs: 60_000,
  openDurationMs: 30_000,
});

/** HTTP 5xx / 429 classifier for use with breaker.call(fetch, isHttpFailure). */
export const isHttpFailure = (res: Response): boolean =>
  res.status >= 500 || res.status === 429;
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

// ── Admin Authorization (DEPRECATED) ────────────────────────────────
// The old isAdminAuthorized() checked the service role key sent from
// the client. This was a security vulnerability — the service role key
// is a god key for all Supabase resources and must NEVER be transmitted
// over the wire. All admin operations now use ED25519 session auth via
// requireOwner() in auth.ts. This stub remains only to produce a clear
// error if any code path still references it.

/** @deprecated Use requireOwner() from auth.ts instead. */
export function isAdminAuthorized(_c: any): boolean {
  console.error("[SECURITY] DEPRECATED: isAdminAuthorized() called — migrate to requireOwner() from auth.ts");
  return false; // Fail-closed: always deny
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
    // Only release if we still own it (could have expired and been re-acquired)
    if (existing?.holder === holderId) {
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
// hostname; mixing the two causes independent failure modes (P7 audit).

export const HEDERA_MIRROR_MAINNET = "https://mainnet-public.mirrornode.hedera.com";
export const HEDERA_MIRROR_TESTNET = "https://testnet.mirrornode.hedera.com";

// ── Route Prefix ────────────────────────────────────────────────────
// All Hono routes are registered under this path prefix.
// Single source of truth — eliminates 30+ hardcoded repetitions across modules.

export const ROUTE_PREFIX = "/make-server-54299934";
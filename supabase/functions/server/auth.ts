// ═══════════════════════════════════════════════════════════════════════
// AUTHENTICATION — ED25519 Challenge-Response Sessions
// ═══════════════════════════════════════════════════════════════════════
//
// Flow:
//   1. GET  /auth/challenge/:accountId → server issues CSPRNG nonce (5-min TTL)
//   2. Client signs nonce in HashPack wallet (ED25519)
//   3. POST /auth/session → server verifies sig against Mirror Node public key
//   4. Server returns 32-byte CSPRNG session token (30-min TTL, KV-stored)
//   5. All mutating requests carry X-Session-Token header
//
// Security: single-use nonces, replay protection, account-bound sessions,
// public key caching (10-min TTL), fail-closed on unsupported key types.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import { getClientIp, isRateLimited, isValidHederaAccountId, ROUTE_PREFIX, HEDERA_MIRROR_MAINNET } from "./shared.ts";

// ── Constants ───────────────────────────────────────────────────────

const AUTH_CHALLENGE_PREFIX = "auth_ch_";
export const AUTH_SESSION_PREFIX = "auth_sess_";
const AUTH_PUBKEY_CACHE_PREFIX = "auth_pk_";
const AUTH_ACCT_SESSION_PREFIX = "auth_as_";  // Per-account session index
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 30 * 60 * 1000;
const AUTH_PUBKEY_CACHE_TTL_MS = 10 * 60 * 1000;
const AUTH_VERSION = "wrappdex:auth:v1";
const ED25519_DER_PREFIX = "302a300506032b6570032100";

// ── Types ───────────────────────────────────────────────────────────

interface AuthChallenge {
  challengeId: string; accountId: string; nonce: string; message: string;
  createdAt: number; expiresAt: number; used: boolean;
}

export interface AuthSession { token: string; accountId: string; createdAt: number; expiresAt: number; }

interface PublicKeyResult { type: "ED25519"; rawKeyHex: string; error?: undefined; }
interface PublicKeyError { type?: undefined; rawKeyHex?: undefined; error: string; }

// ── Hex/Byte Helpers ────────────────────────────────────────────────

const SESSION_TOKEN_RE = /^[0-9a-f]{64}$/;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Challenge & Session Generators ──────────────────────────────────

function generateChallengeNonce(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

function generateSessionToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

function buildChallengeMessage(accountId: string, nonce: string, timestamp: number): string {
  const dateStr = new Date(timestamp).toISOString();
  return [
    "Wrappdex Identity Verification",
    "",
    "Sign this message to prove you own this account.",
    "No transaction will be submitted and no fees will be charged.",
    "",
    `Account: ${accountId}`,
    `Nonce: ${nonce}`,
    `Issued: ${dateStr}`,
    `Version: ${AUTH_VERSION}`,
  ].join("\n");
}

// ── Mirror Node Public Key Fetch (cached 10 min) ────────────────────

async function fetchAccountPublicKey(accountId: string): Promise<PublicKeyResult | PublicKeyError> {
  const cacheKey = AUTH_PUBKEY_CACHE_PREFIX + accountId;
  try {
    const cached: { key: PublicKeyResult; ts: number } | null = await kv.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < AUTH_PUBKEY_CACHE_TTL_MS) return cached.key;
  } catch { /* cache miss */ }

  try {
    const res = await fetch(`${HEDERA_MIRROR_MAINNET}/api/v1/accounts/${accountId}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      if (res.status === 404) return { error: `Account ${accountId} not found on Hedera mainnet` };
      return { error: `Mirror Node returned HTTP ${res.status}` };
    }
    const data = await res.json();
    const keyData = data?.key;
    if (!keyData || !keyData._type || !keyData.key) {
      return { error: "Account has no public key (possibly a smart contract account)" };
    }
    if (keyData._type !== "ED25519") {
      return { error: `Unsupported key type: ${keyData._type}. Only ED25519 accounts supported for authentication.` };
    }
    let rawKeyHex: string = keyData.key.toLowerCase();
    if (rawKeyHex.startsWith(ED25519_DER_PREFIX)) {
      rawKeyHex = rawKeyHex.substring(ED25519_DER_PREFIX.length);
    }
    if (rawKeyHex.length !== 64) {
      return { error: `Invalid ED25519 key length: expected 64 hex chars, got ${rawKeyHex.length}` };
    }
    const result: PublicKeyResult = { type: "ED25519", rawKeyHex };
    try { await kv.set(cacheKey, { key: result, ts: Date.now() }); } catch { /* non-critical */ }
    return result;
  } catch (err: any) {
    console.log(`[AUTH] Mirror Node fetch failed for ${accountId}: ${err?.message || err}`);
    return { error: "Mirror Node temporarily unavailable — please retry" };
  }
}

// ── ED25519 Signature Extraction & Verification (Web Crypto API) ────

/**
 * Extract a raw 64-byte ED25519 signature from a byte array that may be a
 * protobuf-encoded SignatureMap.  Scans for field-tag 0x1A (field 3, wire
 * type 2 = length-delimited) followed by length 0x40 (64).
 */
function extractED25519SigFromBytes(bytes: Uint8Array): Uint8Array | null {
  for (let i = 0; i < bytes.length - 65; i++) {
    if (bytes[i] === 0x1A && bytes[i + 1] === 0x40) {
      return bytes.slice(i + 2, i + 66);
    }
  }
  return null;
}

/**
 * Decode the signature string into exactly 64 bytes.
 * Strategies tried in order:
 *   1. Hex decode (128 hex chars → 64 bytes)
 *   2. Hex decode to >64 bytes → extract ED25519 from protobuf structure
 *   3. Base64 decode → 64 bytes directly
 *   4. Base64 decode to >64 bytes → extract ED25519 from protobuf structure
 */
function decodeSigTo64Bytes(raw: string): Uint8Array | null {
  // Strategy 1 & 2: pure hex
  if (/^[0-9a-fA-F]+$/.test(raw)) {
    const bytes = hexToBytes(raw);
    if (bytes.length === 64) {
      console.log("[AUTH] Sig decoded: hex → 64 bytes");
      return bytes;
    }
    // Hex decoded to >64 bytes — might be full protobuf SignatureMap in hex
    if (bytes.length > 64) {
      const extracted = extractED25519SigFromBytes(bytes);
      if (extracted) {
        console.log(`[AUTH] Sig decoded: hex → ${bytes.length}B → extracted ED25519 from protobuf`);
        return extracted;
      }
    }
    console.log(`[AUTH] Sig hex decoded to ${bytes.length} bytes — not 64 and no ED25519 field`);
  }

  // Strategy 3 & 4: base64 decode
  try {
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length === 64) {
      console.log("[AUTH] Sig decoded: base64 → 64 bytes");
      return bytes;
    }
    if (bytes.length > 64) {
      const extracted = extractED25519SigFromBytes(bytes);
      if (extracted) {
        console.log(`[AUTH] Sig decoded: base64 → ${bytes.length}B → extracted ED25519 from protobuf`);
        return extracted;
      }
    }
    console.log(`[AUTH] Sig base64 decoded to ${bytes.length} bytes — not 64 and no ED25519 field`);
  } catch {
    console.log("[AUTH] Sig is not valid base64 either");
  }

  return null;
}

async function verifyED25519Signature(
  publicKeyHex: string, messageBytes: Uint8Array, signatureHex: string,
): Promise<boolean> {
  try {
    const pubKeyBytes = hexToBytes(publicKeyHex);
    if (pubKeyBytes.length !== 32) { console.log(`[AUTH] PubKey length invalid: ${pubKeyBytes.length}`); return false; }

    const sigBytes = decodeSigTo64Bytes(signatureHex);
    if (!sigBytes) {
      console.log(`[AUTH] Could not decode signature to 64 bytes from input (${signatureHex.length} chars)`);
      return false;
    }

    console.log(`[AUTH] Verifying: pubKey=${publicKeyHex.slice(0, 16)}... sig=${bytesToHex(sigBytes).slice(0, 32)}... msg=${messageBytes.length}B`);

    const cryptoKey = await crypto.subtle.importKey("raw", pubKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", cryptoKey, sigBytes, messageBytes);
  } catch (err: any) {
    console.log(`[AUTH] ED25519 verification error: ${err?.message || err}`);
    return false;
  }
}

// ── Owner & Admin Session Authorization ─────────────────────────────
// All admin operations use ED25519 session auth. The service role key is
// NEVER transmitted from any client. Owner (0.0.518487) has elevated
// "god key" privileges for site-wide administrative operations.
//
// Privilege tiers:
//   Owner  — full site admin (chat clear, spin reset, AMM kill, oracle, admins)
//   Admin  — DAO proposal management only (create/edit/delete proposals)
//   User   — vote, comment, LP, swap (standard ED25519 session)

export const OWNER_ACCOUNT = "0.0.518487";

const ADMIN_AUDIT_KEY = "admin_audit_log";
const ADMIN_AUDIT_MAX_ENTRIES = 500;

/**
 * Require an authenticated ED25519 session belonging to the OWNER account.
 * Used for god-key operations: chat admin, spin reset, AMM kill switch,
 * oracle config, admin list management, storage debug.
 */
export async function requireOwner(c: any): Promise<{ accountId: string } | Response> {
  const session = await validateSession(c);
  if (!session) {
    return c.json({
      error: "Authentication required — sign a wallet challenge first",
      code: "AUTH_REQUIRED",
    }, 401);
  }
  if (session.accountId !== OWNER_ACCOUNT) {
    const ip = getClientIp(c);
    console.log(`[SECURITY] Non-owner privileged access attempt: ${session.accountId} from IP ${ip}`);
    return c.json({ error: "Owner authorization required", code: "OWNER_REQUIRED" }, 403);
  }
  return { accountId: session.accountId };
}

/**
 * Append to the admin audit log (KV-backed, capped, append-only).
 * Non-blocking — failures are logged but never halt the calling operation.
 */
export async function logAdminAction(
  action: string, accountId: string, ip: string, details?: string,
): Promise<void> {
  try {
    const entry = {
      action, accountId, ip,
      ts: Date.now(),
      iso: new Date().toISOString(),
      details: details || null,
    };
    const log: any[] = (await kv.get(ADMIN_AUDIT_KEY)) ?? [];
    log.push(entry);
    if (log.length > ADMIN_AUDIT_MAX_ENTRIES) {
      log.splice(0, log.length - ADMIN_AUDIT_MAX_ENTRIES);
    }
    await kv.set(ADMIN_AUDIT_KEY, log);
  } catch (err) {
    console.log(`[ADMIN-AUDIT] Failed to write audit entry: ${err}`);
  }
}

// ── Session Helpers (exported for other modules) ────────────────────

/** Validate session token and return bound accountId. */
export async function validateSession(c: any): Promise<{ accountId: string } | null> {
  const token = c.req.header("x-session-token") || "";
  if (!token || !SESSION_TOKEN_RE.test(token)) return null;
  try {
    const session: AuthSession | null = await kv.get(AUTH_SESSION_PREFIX + token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      kv.del(AUTH_SESSION_PREFIX + token).catch(() => {});
      return null;
    }
    return { accountId: session.accountId };
  } catch { return null; }
}

/** Require authenticated session. Returns accountId from verified session. */
export async function requireAuth(c: any): Promise<{ accountId: string } | Response> {
  const session = await validateSession(c);
  if (!session) {
    return c.json({
      error: "Authentication required. Sign a challenge via GET /auth/challenge/:accountId then POST /auth/session.",
      code: "AUTH_REQUIRED",
    }, 401);
  }
  return { accountId: session.accountId };
}

// ── Route Registration ─────────────────────────────────────────────

export function registerAuthRoutes(app: Hono): void {

  // GET /auth/challenge/:accountId — Issue a time-limited challenge nonce
  app.get(`${ROUTE_PREFIX}/auth/challenge/:accountId`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const accountId = c.req.param("accountId");
      if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid Hedera account ID" }, 400);

      const keyResult = await fetchAccountPublicKey(accountId);
      if (keyResult.error) return c.json({ error: keyResult.error, code: "KEY_FETCH_FAILED" }, 400);

      const now = Date.now();
      const nonce = generateChallengeNonce();
      const challengeId = `ch_${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;
      const message = buildChallengeMessage(accountId, nonce, now);

      const challenge: AuthChallenge = { challengeId, accountId, nonce, message, createdAt: now, expiresAt: now + AUTH_CHALLENGE_TTL_MS, used: false };
      await kv.set(AUTH_CHALLENGE_PREFIX + challengeId, challenge);
      console.log(`[AUTH] Challenge issued: ${challengeId} for ${accountId}`);
      return c.json({ challengeId, message, expiresAt: challenge.expiresAt, keyType: keyResult.type });
    } catch (err) {
      console.error("[AUTH] Error in GET /auth/challenge:", err);
      return c.json({ error: "Challenge generation failed" }, 500);
    }
  });

  // POST /auth/session — Verify signature and create session token
  //
  // Nonce consumption strategy: DELETE-BEFORE-VERIFY
  //   The challenge is deleted from KV immediately after reading, BEFORE
  //   signature verification. This closes the race window that existed
  //   when we used a mark-as-used (read → set used=true) pattern — two
  //   concurrent requests could both read used=false in that window.
  //
  //   With delete-first, the second request gets null from kv.get and fails.
  //   Trade-off: if verification fails (bad sig, Mirror Node down), the
  //   challenge is already consumed — the user must request a new one.
  //   This is the correct security posture: one attempt per nonce.
  //
  //   Residual race: KV read + delete is not atomic, so two requests
  //   arriving within ~1ms could both read the challenge before either
  //   deletes it. In a wallet-signing flow (user clicks "Sign"), this
  //   is practically unreachable. Both sessions would bind to the same
  //   accountId with no privilege escalation.

  app.post(`${ROUTE_PREFIX}/auth/session`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const body = await c.req.json();
      const { challengeId, signature, accountId } = body;
      if (!challengeId || !signature || !accountId) return c.json({ error: "Missing: challengeId, signature, accountId" }, 400);
      if (!isValidHederaAccountId(accountId)) return c.json({ error: "Invalid Hedera account ID" }, 400);

      // ── Retrieve challenge ──
      const challengeKey = AUTH_CHALLENGE_PREFIX + challengeId;
      const challenge: AuthChallenge | null = await kv.get(challengeKey);
      if (!challenge) return c.json({ error: "Challenge not found or already consumed", code: "CHALLENGE_INVALID" }, 400);

      // ── Consume nonce immediately — delete from KV before any further work ──
      // A concurrent request arriving after this point will get null and fail.
      await kv.del(challengeKey);

      // ── Validate challenge fields (operating on in-memory copy) ──
      if (challenge.used) {
        // Belt-and-suspenders: should not occur with delete-first pattern,
        // but guards against legacy challenge objects still flagged as used.
        return c.json({ error: "Challenge already consumed (replay rejected)", code: "CHALLENGE_USED" }, 400);
      }
      if (Date.now() > challenge.expiresAt) {
        return c.json({ error: "Challenge expired. Request a new one.", code: "CHALLENGE_EXPIRED" }, 400);
      }
      if (challenge.accountId !== accountId) {
        return c.json({ error: "Challenge was issued for a different account", code: "CHALLENGE_ACCOUNT_MISMATCH" }, 403);
      }

      // ── Fetch public key and verify ED25519 signature ──
      const keyResult = await fetchAccountPublicKey(accountId);
      if (keyResult.error) return c.json({ error: `Cannot verify: ${keyResult.error}`, code: "KEY_FETCH_FAILED" }, 400);

      const messageBytes = new TextEncoder().encode(challenge.message);
      const cleanSig = signature.startsWith("0x") ? signature.slice(2) : signature;

      // Diagnostic logging for signature debugging
      console.log(`[AUTH] Verifying sig for ${accountId}: sigLen=${cleanSig.length} chars, msgLen=${messageBytes.length} bytes, pubKey=${keyResult.rawKeyHex.slice(0, 16)}...`);
      console.log(`[AUTH] Sig preview: ${cleanSig.slice(0, 40)}...`);
      console.log(`[AUTH] Message first 80 chars: ${challenge.message.slice(0, 80)}`);

      // Primary: verify against original challenge message (UTF-8 bytes)
      let isValid = await verifyED25519Signature(keyResult.rawKeyHex, messageBytes, cleanSig);

      // Fallback A: Some wallets sign the base64-encoded message string
      // (per HIP-820 spec where message param is base64). If the wallet
      // received base64 and signed those bytes without decoding first.
      if (!isValid) {
        try {
          const b64Msg = btoa(challenge.message);
          const b64MsgBytes = new TextEncoder().encode(b64Msg);
          console.log(`[AUTH] Primary failed — trying base64 message variant (${b64MsgBytes.length}B)`);
          isValid = await verifyED25519Signature(keyResult.rawKeyHex, b64MsgBytes, cleanSig);
          if (isValid) console.log("[AUTH] Signature verified via base64-message fallback");
        } catch { /* btoa might fail on non-Latin1 — skip this fallback */ }
      }

      // Fallback B: Some wallets sign just the nonce bytes (raw hex nonce)
      if (!isValid && challenge.nonce) {
        const nonceBytes = new TextEncoder().encode(challenge.nonce);
        console.log(`[AUTH] Base64 variant failed — trying nonce-only variant (${nonceBytes.length}B)`);
        isValid = await verifyED25519Signature(keyResult.rawKeyHex, nonceBytes, cleanSig);
        if (isValid) console.log("[AUTH] Signature verified via nonce-only fallback");
      }

      if (!isValid) {
        console.log(`[AUTH] ALL verification strategies FAILED for ${accountId} challenge=${challengeId} sigChars=${cleanSig.length}`);
        return c.json({ error: "Signature verification failed. Ensure you signed the exact challenge message.", code: "SIGNATURE_INVALID" }, 401);
      }

      // ── Revoke existing session for this account ──
      // Ensures only one active session per account. Prevents the scenario
      // where a privilege escalation (e.g., addAdmin) completes with a stale
      // token that wasn't properly revoked by the client-side DELETE.
      try {
        const oldToken: string | null = await kv.get(AUTH_ACCT_SESSION_PREFIX + accountId);
        if (oldToken) {
          await kv.del(AUTH_SESSION_PREFIX + oldToken);
          console.log(`[AUTH] Revoked previous session for ${accountId}`);
        }
      } catch { /* best-effort — new session is still safe to create */ }

      // ── Create session (challenge already consumed by kv.del above) ──
      const token = generateSessionToken();
      const now = Date.now();
      const session: AuthSession = { token, accountId, createdAt: now, expiresAt: now + AUTH_SESSION_TTL_MS };
      await kv.set(AUTH_SESSION_PREFIX + token, session);
      // Update per-account index so future logins can revoke this session
      await kv.set(AUTH_ACCT_SESSION_PREFIX + accountId, token);
      console.log(`[AUTH] Session created for ${accountId} (expires ${AUTH_SESSION_TTL_MS / 60000}min)`);
      return c.json({ sessionToken: token, accountId, expiresAt: session.expiresAt, ttlMs: AUTH_SESSION_TTL_MS });
    } catch (err) {
      console.error("[AUTH] Error in POST /auth/session:", err);
      return c.json({ error: "Session creation failed" }, 500);
    }
  });

  // GET /auth/session/validate — Check session validity
  app.get(`${ROUTE_PREFIX}/auth/session/validate`, async (c) => {
    const session = await validateSession(c);
    if (!session) return c.json({ valid: false }, 401);
    return c.json({ valid: true, accountId: session.accountId });
  });

  // DELETE /auth/session — Revoke session (logout)
  app.delete(`${ROUTE_PREFIX}/auth/session`, async (c) => {
    const token = c.req.header("x-session-token") || "";
    if (token) {
      // Read session to get accountId for per-account index cleanup
      try {
        const session: AuthSession | null = await kv.get(AUTH_SESSION_PREFIX + token);
        if (session?.accountId) {
          const indexed: string | null = await kv.get(AUTH_ACCT_SESSION_PREFIX + session.accountId);
          if (indexed === token) {
            kv.del(AUTH_ACCT_SESSION_PREFIX + session.accountId).catch(() => {});
          }
        }
      } catch { /* best-effort — token deletion below is the critical op */ }
      kv.del(AUTH_SESSION_PREFIX + token).catch(() => {});
    }
    return c.json({ success: true });
  });

  // GET /auth/admin-audit — Owner-only: review admin action audit trail
  app.get(`${ROUTE_PREFIX}/auth/admin-audit`, async (c) => {
    const ownerAuth = await requireOwner(c);
    if (ownerAuth instanceof Response) return ownerAuth;
    try {
      const log: any[] = (await kv.get(ADMIN_AUDIT_KEY)) ?? [];
      return c.json({ entries: log, count: log.length, maxEntries: ADMIN_AUDIT_MAX_ENTRIES });
    } catch {
      return c.json({ error: "Failed to load audit log" }, 500);
    }
  });
}
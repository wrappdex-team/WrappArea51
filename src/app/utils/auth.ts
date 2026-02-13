/**
 * Wrappdex Authentication — Challenge-Response Session Management
 *
 * [AUDIT-AMM-01] Implements cryptographic proof of Hedera account ownership
 * using ED25519 challenge-response signing via HashConnect (HashPack wallet).
 *
 * Flow:
 *   1. requestChallenge(accountId) — server issues CSPRNG nonce
 *   2. signChallenge(accountId, message) — HashPack signs via HashConnect
 *   3. createSession(accountId, challengeId, signature) — server verifies & issues token
 *   4. getSessionToken() — returns cached token for authenticated requests
 *
 * Session tokens are 30-minute TTL, cached in-memory on the client.
 * A single wallet signature creates a session for all subsequent operations.
 *
 * Security Properties:
 *   - Private key never leaves HashPack wallet
 *   - Challenge nonces are single-use (server enforces)
 *   - Session tokens are CSPRNG-generated, KV-backed server-side
 *   - Account binding: session locked to specific accountId
 */

import { projectId, publicAnonKey } from "/utils/supabase/info";
import { signMessage } from "./hashpack";

// ── Types ───────────────────────────────────────────────────────────

interface ChallengeResponse {
  challengeId: string;
  message: string;       // The string that must be signed
  expiresAt: number;
  keyType: string;
}

interface SessionResponse {
  sessionToken: string;
  accountId: string;
  expiresAt: number;
  ttlMs: number;
}

interface AuthState {
  sessionToken: string;
  accountId: string;
  expiresAt: number;
}

// ── API Base ────────────────────────────────────────────────────────

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

const baseHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${publicAnonKey}`,
};

// ── Session Cache ──────────────────────────────────────────────────
// In-memory cache with 2-minute safety margin before actual expiry

let _currentSession: AuthState | null = null;
const SESSION_SAFETY_MARGIN_MS = 2 * 60 * 1000; // Refresh 2 min before expiry

/**
 * Get the current valid session token, or null if no valid session exists.
 */
export function getSessionToken(): string | null {
  if (!_currentSession) return null;
  if (Date.now() > _currentSession.expiresAt - SESSION_SAFETY_MARGIN_MS) {
    _currentSession = null;
    return null;
  }
  return _currentSession.sessionToken;
}

/**
 * Get the authenticated accountId from the current session.
 */
export function getSessionAccountId(): string | null {
  if (!_currentSession) return null;
  if (Date.now() > _currentSession.expiresAt - SESSION_SAFETY_MARGIN_MS) {
    _currentSession = null;
    return null;
  }
  return _currentSession.accountId;
}

/**
 * Check if a valid session exists for the given accountId.
 */
export function hasValidSession(accountId: string): boolean {
  const token = getSessionToken();
  return token !== null && _currentSession?.accountId === accountId;
}

/**
 * Clear the current session (e.g., on wallet disconnect).
 */
export function clearSession(): void {
  if (_currentSession?.sessionToken) {
    // Best-effort server-side revocation (fire and forget)
    fetch(`${API_BASE}/auth/session`, {
      method: "DELETE",
      headers: { ...baseHeaders, "X-Session-Token": _currentSession.sessionToken },
    }).catch(() => {});
  }
  _currentSession = null;
}

// ── Challenge-Response Flow ────────────────────────────────────────

/**
 * Step 1: Request a challenge nonce from the server.
 * The server verifies the account exists and has an ED25519 key.
 */
async function requestChallenge(accountId: string): Promise<ChallengeResponse> {
  const res = await fetch(`${API_BASE}/auth/challenge/${accountId}`, {
    headers: baseHeaders,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as ChallengeResponse;
}

/**
 * Step 2: Sign the challenge message using HashConnect (HashPack wallet).
 * The user will see a signing prompt in their HashPack wallet.
 * Returns the signature as a hex string.
 */
async function signChallengeMessage(accountId: string, message: string): Promise<string> {
  const result = await signMessage(accountId, message);
  if (!result || !result.signatures) {
    throw new Error("Signing failed — wallet may have rejected the request or is not connected");
  }

  // Extract signature bytes from HashConnect result
  // HashConnect v3 returns various formats — handle them all
  const sigs = result.signatures;

  let sigHex: string | null = null;

  if (typeof sigs === "string") {
    // Direct hex string
    sigHex = sigs;
  } else if (sigs instanceof Uint8Array) {
    // Raw bytes
    sigHex = Array.from(sigs).map(b => b.toString(16).padStart(2, "0")).join("");
  } else if (Array.isArray(sigs)) {
    // Array of signatures — take the first one
    const first = sigs[0];
    if (typeof first === "string") {
      sigHex = first;
    } else if (first instanceof Uint8Array) {
      sigHex = Array.from(first).map(b => b.toString(16).padStart(2, "0")).join("");
    } else if (first && typeof first === "object") {
      // Object with signature field
      const raw = first.signature || first.sig || first.data || first.bytes;
      if (typeof raw === "string") {
        sigHex = raw;
      } else if (raw instanceof Uint8Array) {
        sigHex = Array.from(raw).map(b => b.toString(16).padStart(2, "0")).join("");
      }
      // HashConnect may wrap in { signedPayload: { signature } }
      if (!sigHex && first.signedPayload) {
        const sp = first.signedPayload;
        const spSig = sp.signature || sp.sig;
        if (typeof spSig === "string") sigHex = spSig;
        else if (spSig instanceof Uint8Array) sigHex = Array.from(spSig).map(b => b.toString(16).padStart(2, "0")).join("");
      }
    }
  } else if (typeof sigs === "object" && sigs !== null) {
    // Object with signature field
    const raw = (sigs as any).signature || (sigs as any).sig || (sigs as any).data;
    if (typeof raw === "string") sigHex = raw;
    else if (raw instanceof Uint8Array) sigHex = Array.from(raw).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  if (!sigHex) {
    console.error("[Auth] Could not extract signature from HashConnect result:", sigs);
    throw new Error("Could not extract signature from wallet response");
  }

  // Clean up hex string
  if (sigHex.startsWith("0x")) sigHex = sigHex.slice(2);

  return sigHex;
}

/**
 * Step 3: Submit the signature to the server to create a session.
 */
async function submitSession(
  accountId: string,
  challengeId: string,
  signature: string,
): Promise<SessionResponse> {
  const res = await fetch(`${API_BASE}/auth/session`, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({ accountId, challengeId, signature }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as SessionResponse;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Full authentication flow: challenge → sign → session.
 *
 * Call this once before performing mutating operations (swap, add/remove liquidity).
 * If a valid session already exists for this accountId, returns immediately.
 *
 * The user will see ONE signing prompt in HashPack. All subsequent
 * operations within the 30-minute session window are authenticated
 * without additional wallet prompts.
 *
 * @param accountId - Hedera account ID (e.g., "0.0.12345")
 * @returns The session token string
 * @throws Error if any step fails (network, signing, verification)
 */
export async function authenticate(accountId: string): Promise<string> {
  // Reuse existing valid session
  if (hasValidSession(accountId)) {
    return _currentSession!.sessionToken;
  }

  // Clear any stale session for a different account
  if (_currentSession && _currentSession.accountId !== accountId) {
    clearSession();
  }

  console.log(`[Auth] Starting authentication for ${accountId}...`);

  // Step 1: Request challenge
  const challenge = await requestChallenge(accountId);
  console.log(`[Auth] Challenge received: ${challenge.challengeId}`);

  // Step 2: Sign in wallet
  const signature = await signChallengeMessage(accountId, challenge.message);
  console.log(`[Auth] Signature obtained (${signature.length} hex chars)`);

  // Step 3: Create session
  const session = await submitSession(accountId, challenge.challengeId, signature);
  console.log(`[Auth] Session created, expires in ${session.ttlMs / 60000}min`);

  // Cache the session
  _currentSession = {
    sessionToken: session.sessionToken,
    accountId: session.accountId,
    expiresAt: session.expiresAt,
  };

  return session.sessionToken;
}

/**
 * Get headers for an authenticated API request.
 * Includes the session token as X-Session-Token.
 *
 * @param sessionToken - Token from authenticate()
 * @returns Headers object to spread into fetch options
 */
export function authHeaders(sessionToken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${publicAnonKey}`,
    "X-Session-Token": sessionToken,
  };
}

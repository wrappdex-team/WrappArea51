/**
 * Wrappdex Authentication — ED25519 Challenge-Response Sessions
 *
 * Flow: requestChallenge → wallet signs → server verifies → 30-min session token.
 * Private key never leaves the wallet. Nonces are single-use, sessions KV-backed.
 */

import { projectId, publicAnonKey } from "/utils/supabase/info";
import { signMessage } from "./hashpack";
import { log } from "./logger";

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
 * Returns a promise that resolves once the server-side revocation
 * completes (or fails — best-effort). Callers that need atomicity
 * (forceReauthenticate) should await this.
 */
export async function clearSession(): Promise<void> {
  if (_currentSession?.sessionToken) {
    try {
      await fetch(`${API_BASE}/auth/session`, {
        method: "DELETE",
        headers: { ...baseHeaders, "X-Session-Token": _currentSession.sessionToken },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Revocation failed — server will expire it via TTL (30 min max)
      log.warn("Auth", "Session revocation request failed — will expire via TTL");
    }
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
 * Returns the extracted signature hex AND the raw signatureMap (if available)
 * for server-side re-extraction fallback.
 */
async function signChallengeMessage(accountId: string, message: string): Promise<{ sigHex: string; rawSignatureMap?: string }> {
  const result = await signMessage(accountId, message);
  if (!result || !result.signatures) {
    throw new Error("Signing failed — wallet may have rejected the request or is not connected");
  }

  // Capture raw signatureMap for server-side fallback.
  // If client-side protobuf extraction gets wrong bytes (e.g., pubKeyPrefix
  // contains 0x1A 0x40), the server can re-extract from the raw protobuf.
  const rawSignatureMap: string | undefined = result.rawSignatureMap;

  // Extract signature from WalletConnect result.
  // wallet-core.ts _parseSignMessageResponse already normalises most formats
  // to an array of strings, but we still handle edge cases defensively.
  const sigs = result.signatures;
  log.info("Auth", `Raw signatures type=${typeof sigs} isArray=${Array.isArray(sigs)} preview=${JSON.stringify(sigs).slice(0, 300)}`);

  let sigHex: string | null = null;

  if (typeof sigs === "string") {
    sigHex = sigs;
  } else if (sigs instanceof Uint8Array) {
    sigHex = Array.from(sigs).map(b => b.toString(16).padStart(2, "0")).join("");
  } else if (Array.isArray(sigs)) {
    const first = sigs[0];
    if (typeof first === "string") {
      sigHex = first;
    } else if (first instanceof Uint8Array) {
      sigHex = Array.from(first).map(b => b.toString(16).padStart(2, "0")).join("");
    } else if (first && typeof first === "object") {
      // Check ed25519 key (HIP-820 protobuf-style), then common names
      const raw = first.ed25519 || first.signature || first.sig || first.data || first.bytes;
      if (typeof raw === "string") {
        sigHex = raw;
      } else if (raw instanceof Uint8Array) {
        sigHex = Array.from(raw).map(b => b.toString(16).padStart(2, "0")).join("");
      }
      if (!sigHex && first.signedPayload) {
        const sp = first.signedPayload;
        const spSig = sp.ed25519 || sp.signature || sp.sig;
        if (typeof spSig === "string") sigHex = spSig;
        else if (spSig instanceof Uint8Array) sigHex = Array.from(spSig).map(b => b.toString(16).padStart(2, "0")).join("");
      }
    }
  } else if (typeof sigs === "object" && sigs !== null) {
    const raw = (sigs as any).ed25519 || (sigs as any).signature || (sigs as any).sig || (sigs as any).data;
    if (typeof raw === "string") sigHex = raw;
    else if (raw instanceof Uint8Array) sigHex = Array.from(raw).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  if (!sigHex) {
    log.error("Auth", "Could not extract signature from wallet result", sigs);
    throw new Error("Could not extract signature from wallet response");
  }

  // Strip 0x prefix if present
  if (sigHex.startsWith("0x")) sigHex = sigHex.slice(2);

  // If the string looks like base64 (not valid hex), convert to hex
  if (sigHex.length > 0 && !/^[0-9a-fA-F]+$/.test(sigHex)) {
    try {
      const bin = atob(sigHex);
      sigHex = Array.from(new Uint8Array(bin.length), (_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
      log.info("Auth", `Converted base64 signature to hex (${sigHex.length} chars)`);
    } catch {
      log.error("Auth", "Signature is neither valid hex nor base64", sigHex.slice(0, 40));
      throw new Error("Signature format not recognised");
    }
  }

  log.info("Auth", `Final signature: ${sigHex.length} hex chars, preview=${sigHex.slice(0, 32)}...`);
  
  // Expected: 128 hex chars = 64 bytes (raw ED25519 signature).
  // If longer, the server's decodeSigTo64Bytes will extract the ED25519
  // field from the protobuf structure. Log for diagnostics.
  if (sigHex.length !== 128) {
    log.warn("Auth", `Signature is ${sigHex.length} hex chars (expected 128 for raw ED25519). Server will attempt protobuf extraction.`);
  }
  
  return { sigHex, rawSignatureMap };
}

/**
 * Step 3: Submit the signature to the server to create a session.
 */
async function submitSession(
  accountId: string,
  challengeId: string,
  signature: string,
  rawSignatureMap?: string,
): Promise<SessionResponse> {
  const body: Record<string, string> = { accountId, challengeId, signature };
  // Include raw signatureMap so the server can re-extract the ED25519 signature
  // from the full protobuf if the client-side extraction produced wrong bytes.
  if (rawSignatureMap) {
    body.rawSignatureMap = rawSignatureMap;
  }
  const res = await fetch(`${API_BASE}/auth/session`, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) {
    // Log server error response. Diagnostic details (signature bytes, public
    // keys, message hex, self-test results) are now logged SERVER-SIDE ONLY
    // and are no longer returned in the HTTP response body. Check server
    // logs (tagged [AUTH][DIAG]) for signature verification troubleshooting.
    log.error("Auth", `submitSession failed: HTTP ${res.status} code=${data.code} error=${data.error}`);
    throw new Error(data.error || `HTTP ${res.status}`);
  }
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
    await clearSession();
  }

  log.info("Auth", `Starting authentication for ${accountId}`);

  // Step 1: Request challenge
  const challenge = await requestChallenge(accountId);
  log.info("Auth", `Challenge received: ${challenge.challengeId}`);

  // Step 2: Sign in wallet
  const { sigHex, rawSignatureMap } = await signChallengeMessage(accountId, challenge.message);
  log.info("Auth", `Signature obtained (${sigHex.length} hex chars)`);

  // Client-side diagnostic: log the message bytes the server should verify against
  // This lets us cross-check if the server has the same message bytes
  try {
    const clientMsgBytes = new TextEncoder().encode(challenge.message);
    const clientMsgHex = Array.from(clientMsgBytes.slice(0, 100)).map(b => b.toString(16).padStart(2, "0")).join("");
    console.log(`[AUTH] Client message bytes: ${clientMsgBytes.length}B, hex(first 100B): ${clientMsgHex}`);
    console.log(`[AUTH] Client message string (first 80): ${challenge.message.slice(0, 80).replace(/\n/g, "\\n")}`);
    console.log(`[AUTH] Client sig hex: ${sigHex}`);
    if (rawSignatureMap) {
      console.log(`[AUTH] Client rawSignatureMap (${rawSignatureMap.length} chars): ${rawSignatureMap.slice(0, 80)}...`);
    }
  } catch { /* diagnostic only */ }

  // Step 3: Create session
  const session = await submitSession(accountId, challenge.challengeId, sigHex, rawSignatureMap);
  log.info("Auth", `Session created, expires in ${session.ttlMs / 60000}min`);

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
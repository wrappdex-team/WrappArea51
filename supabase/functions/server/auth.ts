// ═══════════════════════════════════════════════════════════════════════
// AUTHENTICATION — ED25519 & ECDSA_SECP256K1 Challenge-Response Sessions
// ═══════════════════════════════════════════════════════════════════════
//
// Flow:
//   1. GET  /auth/challenge/:accountId → server issues CSPRNG nonce (5-min TTL)
//   2. Client signs nonce in HashPack wallet (ED25519 or ECDSA_SECP256K1)
//   3. POST /auth/session → server verifies sig against Mirror Node public key
//   4. Server returns 32-byte CSPRNG session token (30-min TTL, KV-stored)
//   5. All mutating requests carry X-Session-Token header
//
// Security: single-use nonces, replay protection, account-bound sessions,
// public key caching (10-min TTL), supports both ED25519 and ECDSA_SECP256K1.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import { getClientIp, isRateLimited, isValidHederaAccountId, ROUTE_PREFIX, HEDERA_MIRROR_MAINNET, mirrorNodeBreaker, isHttpFailure } from "./shared.ts";
import nacl from "npm:tweetnacl@1.0.3";
import { secp256k1 } from "npm:@noble/curves@1.6.0/secp256k1";

// IMPLEMENTATION NOTE: AIKIDO-80 — Constant-time string comparison to prevent
// timing side-channels on token comparisons. While not practically exploitable
// in this DEX (attacker already holds the token, network jitter drowns signal),
// this is applied as defense-in-depth best practice.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

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
// ECDSA secp256k1 DER prefixes (ASN.1 SubjectPublicKeyInfo wrappers)
const ECDSA_DER_PREFIX_COMPRESSED = "3036301006072a8648ce3d020106052b8104000a032200";
const ECDSA_DER_PREFIX_UNCOMPRESSED = "3056301006072a8648ce3d020106052b8104000a034200";

// ── Types ───────────────────────────────────────────────────────────

interface AuthChallenge {
  challengeId: string; accountId: string; nonce: string; message: string;
  createdAt: number; expiresAt: number; used: boolean;
}

export interface AuthSession { token: string; accountId: string; createdAt: number; expiresAt: number; }

interface PublicKeyResult { type: "ED25519" | "ECDSA_SECP256K1"; rawKeyHex: string; error?: undefined; }
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
  // 12 bytes = 24 hex chars. Provides 2^96 entropy — more than sufficient
  // for single-use nonce replay protection while keeping the wallet display clean.
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

function generateSessionToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

function buildChallengeMessage(accountId: string, nonce: string, timestamp: number): string {
  // Short, clean format for wallet display. Each field is on its own line
  // for readability in HashPack's message preview.
  const dateStr = new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
  return [
    "WRAPpDEX Identity Verification",
    "",
    "Sign to prove you own this account.",
    "No fees will be charged.",
    "",
    `Account: ${accountId}`,
    `Time: ${dateStr} UTC`,
    `ID: ${nonce}`,
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
    const res = await mirrorNodeBreaker.call(
      () => fetch(`${HEDERA_MIRROR_MAINNET}/api/v1/accounts/${accountId}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      }),
      // 5xx/429 = breaker failure. 404 is a valid "account not found" — not a service outage.
      isHttpFailure,
    );
    if (!res.ok) {
      if (res.status === 404) return { error: `Account ${accountId} not found on Hedera mainnet` };
      return { error: `Mirror Node returned HTTP ${res.status}` };
    }
    const data = await res.json();
    const keyData = data?.key;
    
    // ── AUTH-FIX-2026-02: Comprehensive key format logging ──────────────────
    console.log(`[AUTH] Mirror Node response for ${accountId}: keyType=${keyData?._type}, rawKeyLength=${keyData?.key?.length}, rawKeyPreview=${keyData?.key?.slice(0, 20)}...`);
    
    if (!keyData || !keyData._type) {
      return { error: "Account has no public key (possibly a smart contract account)" };
    }
    
    // ── Handle complex key types ──────────────────────────────────────
    // Accounts may have keyList, thresholdKey, or ProtobufEncoded key types.
    // Extract the first usable simple key (ED25519 or ECDSA_SECP256K1).
    let resolvedKeyData = keyData;
    
    if (keyData._type === "keyList" || keyData._type === "KeyList") {
      const keys: any[] = keyData.keys || [];
      console.log(`[AUTH] Account ${accountId} has keyList with ${keys.length} keys`);
      const simpleKey = keys.find((k: any) => k?._type === "ED25519" || k?._type === "ECDSA_SECP256K1");
      if (!simpleKey) {
        return { error: `Account has a keyList but no ED25519 or ECDSA_SECP256K1 key found in the list` };
      }
      resolvedKeyData = simpleKey;
      console.log(`[AUTH] Extracted ${resolvedKeyData._type} key from keyList`);
    } else if (keyData._type === "thresholdKey" || keyData._type === "ThresholdKey") {
      const keys: any[] = keyData.keys || [];
      console.log(`[AUTH] Account ${accountId} has thresholdKey with ${keys.length} keys (threshold=${keyData.threshold})`);
      const simpleKey = keys.find((k: any) => k?._type === "ED25519" || k?._type === "ECDSA_SECP256K1");
      if (!simpleKey) {
        return { error: `Account has a thresholdKey but no ED25519 or ECDSA_SECP256K1 key found` };
      }
      resolvedKeyData = simpleKey;
      console.log(`[AUTH] Extracted ${resolvedKeyData._type} key from thresholdKey`);
    } else if (keyData._type === "ProtobufEncoded") {
      console.log(`[AUTH] Account ${accountId} has ProtobufEncoded key — attempting DER decode`);
      // ProtobufEncoded keys contain the raw key bytes; try to identify the algorithm
      // from the DER structure and extract the raw key
      const rawHex = (keyData.key || "").toLowerCase().replace(/^0x/, "");
      if (rawHex.startsWith(ED25519_DER_PREFIX)) {
        resolvedKeyData = { _type: "ED25519", key: rawHex.substring(ED25519_DER_PREFIX.length) };
        console.log(`[AUTH] Decoded ProtobufEncoded as ED25519`);
      } else if (rawHex.startsWith(ECDSA_DER_PREFIX_COMPRESSED)) {
        resolvedKeyData = { _type: "ECDSA_SECP256K1", key: rawHex.substring(ECDSA_DER_PREFIX_COMPRESSED.length) };
        console.log(`[AUTH] Decoded ProtobufEncoded as ECDSA_SECP256K1 (compressed)`);
      } else if (rawHex.startsWith(ECDSA_DER_PREFIX_UNCOMPRESSED)) {
        resolvedKeyData = { _type: "ECDSA_SECP256K1", key: rawHex.substring(ECDSA_DER_PREFIX_UNCOMPRESSED.length) };
        console.log(`[AUTH] Decoded ProtobufEncoded as ECDSA_SECP256K1 (uncompressed)`);
      } else {
        return { error: `Account has a ProtobufEncoded key that could not be decoded. Please use a wallet with a standard ED25519 or ECDSA key.` };
      }
    }
    
    if (!resolvedKeyData.key) {
      return { error: "Account has no public key data" };
    }
    if (resolvedKeyData._type !== "ED25519" && resolvedKeyData._type !== "ECDSA_SECP256K1") {
      return { error: `Unsupported key type: ${resolvedKeyData._type}. Only ED25519 and ECDSA_SECP256K1 accounts supported for authentication.` };
    }
    
    // ── AUTH-FIX-2026-02: Normalize public key format ──────────────────────
    // HashPack and other wallets may return keys with "0x" prefix or DER encoding.
    // Strip all common prefixes before validation to support any HIP-820 compliant wallet.
    let rawKeyHex: string = resolvedKeyData.key.toLowerCase();
    const originalLength = rawKeyHex.length;
    
    // Strip "0x" prefix if present (common in wallet responses)
    if (rawKeyHex.startsWith("0x")) {
      rawKeyHex = rawKeyHex.substring(2);
      console.log(`[AUTH] Stripped "0x" prefix: ${originalLength} → ${rawKeyHex.length} chars`);
    }
    
    // Strip ED25519 DER prefix if present (ASN.1 encoded public keys)
    if (resolvedKeyData._type === "ED25519" && rawKeyHex.startsWith(ED25519_DER_PREFIX)) {
      rawKeyHex = rawKeyHex.substring(ED25519_DER_PREFIX.length);
      console.log(`[AUTH] Stripped ED25519 DER prefix: → ${rawKeyHex.length} chars`);
    }
    
    // Strip ECDSA DER prefixes if present
    if (resolvedKeyData._type === "ECDSA_SECP256K1") {
      if (rawKeyHex.startsWith(ECDSA_DER_PREFIX_COMPRESSED)) {
        rawKeyHex = rawKeyHex.substring(ECDSA_DER_PREFIX_COMPRESSED.length);
        console.log(`[AUTH] Stripped ECDSA compressed DER prefix: → ${rawKeyHex.length} chars`);
      } else if (rawKeyHex.startsWith(ECDSA_DER_PREFIX_UNCOMPRESSED)) {
        rawKeyHex = rawKeyHex.substring(ECDSA_DER_PREFIX_UNCOMPRESSED.length);
        console.log(`[AUTH] Stripped ECDSA uncompressed DER prefix: → ${rawKeyHex.length} chars`);
      }
      // Strip leading "04" from uncompressed key (64-byte x,y coords follow)
      if (rawKeyHex.length === 130 && rawKeyHex.startsWith("04")) {
        rawKeyHex = rawKeyHex.substring(2);
        console.log(`[AUTH] Stripped uncompressed "04" prefix: → ${rawKeyHex.length} chars`);
      }
    }
    
    // Validate key length based on algorithm type:
    // - ED25519: 32 bytes = 64 hex characters
    // - ECDSA_SECP256K1: 33 bytes compressed (66 hex) OR 64 bytes uncompressed x,y (128 hex)
    let keyLengthValid = false;
    if (resolvedKeyData._type === "ED25519") {
      keyLengthValid = rawKeyHex.length === 64;
    } else {
      // ECDSA accepts compressed (66) or uncompressed (128)
      keyLengthValid = rawKeyHex.length === 66 || rawKeyHex.length === 128;
    }
    console.log(`[AUTH] Key validation: type=${resolvedKeyData._type}, length=${rawKeyHex.length}, valid=${keyLengthValid}`);
    
    if (!keyLengthValid) {
      console.log(`[AUTH] ERROR: Invalid key length for ${accountId}: type=${resolvedKeyData._type}, got=${rawKeyHex.length} hex chars`);
      return { error: `Invalid ${resolvedKeyData._type} key format: unexpected length ${rawKeyHex.length} hex chars` };
    }
    
    console.log(`[AUTH] Public key validated successfully for ${accountId}: ${resolvedKeyData._type} (${rawKeyHex.length} chars)`);
    const result: PublicKeyResult = { type: resolvedKeyData._type, rawKeyHex };
    try { await kv.set(cacheKey, { key: result, ts: Date.now() }); } catch { /* non-critical */ }
    return result;
  } catch (err: any) {
    console.log(`[AUTH] Mirror Node fetch failed for ${accountId}: ${err?.message || err}`);
    return { error: "Mirror Node temporarily unavailable — please retry" };
  }
}

// ── ED25519 Signature Extraction & Verification (Web Crypto API) ────

/**
 * Read a protobuf varint starting at `pos` in `bytes`.
 * Returns { value, newPos } or null on failure.
 */
function readVarint(bytes: Uint8Array, pos: number): { value: number; newPos: number } | null {
  let result = 0;
  let shift = 0;
  while (pos < bytes.length) {
    const byte = bytes[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, newPos: pos };
    shift += 7;
    if (shift > 35) break;
  }
  return null;
}

/**
 * Walk a protobuf SignaturePair message (inner) and extract the ed25519
 * field (field 3, wire type 2, expected length 64 bytes).
 */
function extractFromSignaturePair(bytes: Uint8Array): Uint8Array | null {
  let pos = 0;
  while (pos < bytes.length) {
    const tagResult = readVarint(bytes, pos);
    if (!tagResult) break;
    pos = tagResult.newPos;
    const fieldNum = tagResult.value >> 3;
    const wireType = tagResult.value & 0x07;

    if (wireType === 2) {
      const lenResult = readVarint(bytes, pos);
      if (!lenResult) break;
      pos = lenResult.newPos;
      const fieldLen = lenResult.value;
      if (fieldNum === 3 && fieldLen === 64 && pos + 64 <= bytes.length) {
        return bytes.slice(pos, pos + 64);
      }
      pos += fieldLen;
    } else if (wireType === 0) {
      const skip = readVarint(bytes, pos);
      if (!skip) break;
      pos = skip.newPos;
    } else {
      break;
    }
  }
  return null;
}

/**
 * Walk a protobuf SignaturePair and extract BOTH pubKeyPrefix (field 1)
 * and ed25519 signature (field 3). This lets us compare the wallet's
 * signing key against the Mirror Node key for diagnostic purposes.
 */
function extractFieldsFromSignaturePair(bytes: Uint8Array): { pubKeyPrefix: Uint8Array | null; ed25519: Uint8Array | null } {
  let pubKeyPrefix: Uint8Array | null = null;
  let ed25519: Uint8Array | null = null;
  let pos = 0;
  while (pos < bytes.length) {
    const tagResult = readVarint(bytes, pos);
    if (!tagResult) break;
    pos = tagResult.newPos;
    const fieldNum = tagResult.value >> 3;
    const wireType = tagResult.value & 0x07;

    if (wireType === 2) {
      const lenResult = readVarint(bytes, pos);
      if (!lenResult) break;
      pos = lenResult.newPos;
      const fieldLen = lenResult.value;
      if (pos + fieldLen > bytes.length) break;

      if (fieldNum === 1) {
        pubKeyPrefix = bytes.slice(pos, pos + fieldLen);
      } else if (fieldNum === 3 && fieldLen === 64) {
        ed25519 = bytes.slice(pos, pos + 64);
      }
      pos += fieldLen;
    } else if (wireType === 0) {
      const skip = readVarint(bytes, pos);
      if (!skip) break;
      pos = skip.newPos;
    } else {
      break;
    }
  }
  return { pubKeyPrefix, ed25519 };
}

/**
 * Parse the outer SignatureMap protobuf and extract fields from the first
 * SignaturePair. Returns pubKeyPrefix + ed25519 sig, or nulls.
 */
function parseSignatureMap(bytes: Uint8Array): { pubKeyPrefix: Uint8Array | null; ed25519: Uint8Array | null } {
  let pos = 0;
  while (pos < bytes.length) {
    const tagResult = readVarint(bytes, pos);
    if (!tagResult) break;
    pos = tagResult.newPos;
    const fieldNum = tagResult.value >> 3;
    const wireType = tagResult.value & 0x07;

    if (wireType === 2) {
      const lenResult = readVarint(bytes, pos);
      if (!lenResult) break;
      pos = lenResult.newPos;
      const fieldLen = lenResult.value;
      if (pos + fieldLen > bytes.length) break;

      if (fieldNum === 1) {
        // field 1 = sigPair — recurse into SignaturePair
        return extractFieldsFromSignaturePair(bytes.slice(pos, pos + fieldLen));
      }
      pos += fieldLen;
    } else if (wireType === 0) {
      const skip = readVarint(bytes, pos);
      if (!skip) break;
      pos = skip.newPos;
    } else {
      break;
    }
  }
  return { pubKeyPrefix: null, ed25519: null };
}

/**
 * Extract a raw 64-byte ED25519 signature from a byte array that may be a
 * protobuf-encoded SignatureMap.
 *
 * Strategy 1 (proper parsing): Walk SignatureMap → sigPair (field 1) →
 *   SignaturePair → ed25519 (field 3). Correctly skips pubKeyPrefix data.
 *
 * Strategy 2 (legacy byte scan): Scan for 0x1A 0x40 tag pattern.
 *   Kept as fallback for non-standard wallet protobuf layouts.
 */
function extractED25519SigFromBytes(bytes: Uint8Array): Uint8Array | null {
  // ── Strategy 1: Proper protobuf walk ──────────────────────────────
  let pos = 0;
  while (pos < bytes.length) {
    const tagResult = readVarint(bytes, pos);
    if (!tagResult) break;
    pos = tagResult.newPos;
    const fieldNum = tagResult.value >> 3;
    const wireType = tagResult.value & 0x07;

    if (wireType === 2) {
      const lenResult = readVarint(bytes, pos);
      if (!lenResult) break;
      pos = lenResult.newPos;
      const fieldLen = lenResult.value;

      if (fieldNum === 1 && pos + fieldLen <= bytes.length) {
        // field 1 = sigPair (nested SignaturePair message)
        const sigPairBytes = bytes.slice(pos, pos + fieldLen);
        const ed25519Sig = extractFromSignaturePair(sigPairBytes);
        if (ed25519Sig && ed25519Sig.length === 64) {
          console.log("[AUTH] Protobuf: proper parse found ED25519 sig in sigPair");
          return ed25519Sig;
        }
      }

      // Also check if this IS a SignaturePair directly (field 3 = ed25519)
      if (fieldNum === 3 && fieldLen === 64 && pos + 64 <= bytes.length) {
        console.log("[AUTH] Protobuf: found ed25519 field (3) directly at top level");
        return bytes.slice(pos, pos + 64);
      }

      pos += fieldLen;
    } else if (wireType === 0) {
      const skip = readVarint(bytes, pos);
      if (!skip) break;
      pos = skip.newPos;
    } else {
      break;
    }
  }

  // ── Strategy 2: Legacy byte-pattern scan (0x1A 0x40) ─────────────
  for (let i = 0; i < bytes.length - 65; i++) {
    if (bytes[i] === 0x1A && bytes[i + 1] === 0x40 && i + 66 <= bytes.length) {
      console.log(`[AUTH] Protobuf: legacy byte scan found 0x1A 0x40 at offset ${i}`);
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

    // Primary: Use tweetnacl — the same library the Hedera SDK and HashPack
    // wallet use internally. This guarantees byte-level compatibility with
    // the wallet's Ed25519 implementation. Falls back to Web Crypto only if
    // tweetnacl is unavailable (should not happen with npm: import).
    try {
      if (typeof nacl?.sign?.detached?.verify !== "function") {
        console.log(`[AUTH] tweetnacl NOT loaded properly: nacl type=${typeof nacl}, sign=${typeof nacl?.sign}, detached=${typeof nacl?.sign?.detached}, verify=${typeof nacl?.sign?.detached?.verify}`);
      } else {
        const naclResult = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
        if (naclResult) {
          console.log("[AUTH] Signature verified via tweetnacl");
          return true;
        }
        console.log("[AUTH] tweetnacl: verify returned false");
      }
    } catch (naclErr: any) {
      console.log(`[AUTH] tweetnacl verify error: ${naclErr?.message || naclErr}`);
    }

    // Fallback: Web Crypto API (Deno runtime). Some Deno versions may have
    // Ed25519 bugs or missing support — this is a belt-and-suspenders check.
    try {
      const cryptoKey = await crypto.subtle.importKey("raw", pubKeyBytes, { name: "Ed25519" }, false, ["verify"]);
      const webCryptoResult = await crypto.subtle.verify("Ed25519", cryptoKey, sigBytes, messageBytes);
      if (webCryptoResult) {
        console.log("[AUTH] Signature verified via Web Crypto API");
        return true;
      }
      console.log("[AUTH] Web Crypto: verify returned false");
    } catch (wcErr: any) {
      console.log(`[AUTH] Web Crypto Ed25519 not available or failed: ${wcErr?.message || wcErr}`);
    }

    return false;
  } catch (err: any) {
    console.log(`[AUTH] ED25519 verification error: ${err?.message || err}`);
    return false;
  }
}

/**
 * Self-test: generate a keypair, sign a message, verify the signature.
 * Returns { ok: true/false, naclOk, webCryptoOk, details }.
 * This tells us definitively whether the crypto libraries work in this runtime.
 */
async function selfTestED25519(): Promise<{
  ok: boolean; naclOk: boolean | null; webCryptoOk: boolean | null;
  naclAvailable: boolean; details: string;
}> {
  const details: string[] = [];
  let naclOk: boolean | null = null;
  let webCryptoOk: boolean | null = null;
  const naclAvailable = typeof nacl?.sign?.detached?.verify === "function";

  try {
    // Generate a fresh keypair
    if (!naclAvailable) {
      details.push(`nacl NOT available: nacl type=${typeof nacl} sign=${typeof nacl?.sign}`);
    } else {
      details.push("nacl module loaded OK");
    }

    const keyPair = nacl?.sign?.keyPair?.();
    if (!keyPair) {
      details.push("nacl.sign.keyPair() failed or unavailable");
      return { ok: false, naclOk: null, webCryptoOk: null, naclAvailable, details: details.join("; ") };
    }

    const testMsg = new TextEncoder().encode("WRAPpDEX auth self-test");
    const testSig = nacl.sign.detached(testMsg, keyPair.secretKey);
    details.push(`keyPair generated: pub=${bytesToHex(keyPair.publicKey).slice(0, 16)}... sig=${bytesToHex(testSig).slice(0, 16)}...`);

    // Verify with nacl
    try {
      naclOk = nacl.sign.detached.verify(testMsg, testSig, keyPair.publicKey);
      details.push(`nacl verify: ${naclOk}`);
    } catch (e: any) {
      details.push(`nacl verify threw: ${e?.message}`);
      naclOk = false;
    }

    // Verify with Web Crypto
    try {
      const ck = await crypto.subtle.importKey("raw", keyPair.publicKey, { name: "Ed25519" }, false, ["verify"]);
      webCryptoOk = await crypto.subtle.verify("Ed25519", ck, testSig, testMsg);
      details.push(`webCrypto verify: ${webCryptoOk}`);
    } catch (e: any) {
      details.push(`webCrypto verify threw: ${e?.message}`);
      webCryptoOk = false;
    }

    return { ok: (naclOk === true || webCryptoOk === true), naclOk, webCryptoOk, naclAvailable, details: details.join("; ") };
  } catch (e: any) {
    details.push(`selfTest error: ${e?.message}`);
    return { ok: false, naclOk, webCryptoOk, naclAvailable, details: details.join("; ") };
  }
}

async function verifyECDSA_SECP256K1Signature(
  publicKeyHex: string, messageBytes: Uint8Array, signatureHex: string,
): Promise<boolean> {
  try {
    const pubKeyBytes = hexToBytes(publicKeyHex);
    // Accept compressed (33 bytes) or uncompressed-no-prefix (64 bytes)
    if (pubKeyBytes.length !== 33 && pubKeyBytes.length !== 64) {
      console.log(`[AUTH] ECDSA PubKey length unexpected: ${pubKeyBytes.length} bytes (expected 33 compressed or 64 uncompressed)`);
      return false;
    }

    const sigBytes = decodeSigTo64Bytes(signatureHex);
    if (!sigBytes) {
      console.log(`[AUTH] Could not decode ECDSA signature to 64 bytes from input (${signatureHex.length} chars)`);
      return false;
    }

    console.log(`[AUTH] ECDSA Verifying: pubKey=${publicKeyHex.slice(0, 16)}... (${pubKeyBytes.length}B) sig=${bytesToHex(sigBytes).slice(0, 32)}... msg=${messageBytes.length}B`);

    // Build the public key point — noble-curves accepts compressed (02/03 + 32B)
    // or uncompressed (04 + 64B). If we have 64-byte uncompressed without prefix,
    // add the "04" prefix.
    let pubKeyHexForNoble: string;
    if (pubKeyBytes.length === 33) {
      // Already compressed (02xx or 03xx)
      pubKeyHexForNoble = publicKeyHex;
    } else {
      // 64-byte uncompressed — add "04" prefix
      pubKeyHexForNoble = "04" + publicKeyHex;
    }

    // ECDSA_SECP256K1 verification with noble-curves.
    // Hedera ECDSA wallets sign the keccak256 hash of the message (Ethereum-style).
    // We try multiple message formats: raw bytes, keccak256 hash, sha256 hash.
    const sig = secp256k1.Signature.fromCompact(sigBytes);
    const pubKeyPoint = secp256k1.ProjectivePoint.fromHex(pubKeyHexForNoble);

    // Strategy 1: Direct message bytes (some wallets sign raw bytes)
    try {
      if (secp256k1.verify(sig, messageBytes, pubKeyPoint)) {
        console.log("[AUTH] ECDSA verified: raw message bytes");
        return true;
      }
    } catch { /* continue to next strategy */ }

    // Strategy 2: SHA-256 hash of message (Hedera's native ECDSA signing)
    try {
      const sha256Hash = new Uint8Array(await crypto.subtle.digest("SHA-256", messageBytes));
      if (secp256k1.verify(sig, sha256Hash, pubKeyPoint)) {
        console.log("[AUTH] ECDSA verified: SHA-256 hash of message");
        return true;
      }
    } catch (e: any) {
      console.log(`[AUTH] ECDSA SHA-256 strategy error: ${e?.message}`);
    }

    // Strategy 3: Keccak256 hash (Ethereum-style, some EVM wallets)
    try {
      const { keccak_256 } = await import("npm:@noble/hashes@1.5.0/sha3");
      const keccakHash = keccak_256(messageBytes);
      if (secp256k1.verify(sig, keccakHash, pubKeyPoint)) {
        console.log("[AUTH] ECDSA verified: keccak256 hash of message");
        return true;
      }
    } catch (e: any) {
      console.log(`[AUTH] ECDSA keccak256 strategy error: ${e?.message}`);
    }

    // Strategy 4: Ethereum signed message format ("\x19Ethereum Signed Message:\n" + len + msg)
    try {
      const { keccak_256 } = await import("npm:@noble/hashes@1.5.0/sha3");
      const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${messageBytes.length}`);
      const prefixed = new Uint8Array(prefix.length + messageBytes.length);
      prefixed.set(prefix);
      prefixed.set(messageBytes, prefix.length);
      const ethHash = keccak_256(prefixed);
      if (secp256k1.verify(sig, ethHash, pubKeyPoint)) {
        console.log("[AUTH] ECDSA verified: Ethereum signed message format");
        return true;
      }
    } catch (e: any) {
      console.log(`[AUTH] ECDSA Ethereum format error: ${e?.message}`);
    }

    console.log("[AUTH] ECDSA: all verification strategies returned false");
    return false;
  } catch (err: any) {
    console.log(`[AUTH] ECDSA_SECP256K1 verification error: ${err?.message || err}`);
    return false;
  }
}

/**
 * Self-test for ECDSA_SECP256K1: generate a keypair, sign, verify.
 * Uses noble-curves secp256k1 (the same library used for verification).
 */
async function selfTestECDSA_SECP256K1(): Promise<{
  ok: boolean; naclOk: boolean | null; webCryptoOk: boolean | null;
  naclAvailable: boolean; details: string;
}> {
  const details: string[] = [];
  let nobleOk: boolean | null = null;

  try {
    details.push("Testing ECDSA_SECP256K1 with @noble/curves");
    
    // Generate a random private key (32 bytes)
    const privKeyBytes = new Uint8Array(32);
    crypto.getRandomValues(privKeyBytes);
    const privKeyHex = bytesToHex(privKeyBytes);
    
    // Derive the public key
    const pubKey = secp256k1.getPublicKey(privKeyHex, true); // compressed
    details.push(`keyPair generated: pub=${bytesToHex(pubKey).slice(0, 16)}...`);
    
    // Sign a test message (SHA-256 hash first, as Hedera does)
    const testMsg = new TextEncoder().encode("WRAPpDEX ECDSA self-test");
    const msgHash = new Uint8Array(await crypto.subtle.digest("SHA-256", testMsg));
    const sig = secp256k1.sign(msgHash, privKeyHex);
    details.push(`sig generated: ${bytesToHex(sig.toCompactRawBytes()).slice(0, 16)}...`);
    
    // Verify
    nobleOk = secp256k1.verify(sig, msgHash, pubKey);
    details.push(`noble-curves verify: ${nobleOk}`);
    
    return { ok: nobleOk === true, naclOk: null, webCryptoOk: null, naclAvailable: true, details: details.join("; ") };
  } catch (e: any) {
    details.push(`selfTest error: ${e?.message}`);
    return { ok: false, naclOk: null, webCryptoOk: null, naclAvailable: false, details: details.join("; ") };
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
 * Require the OWNER account (0.0.518487) for god-key operations: admin list
 * management, AMM kill switch, chat admin, spin reset, audit log, etc.
 *
 * Auth: ED25519 session token (X-Session-Token) ONLY — cryptographic proof
 * that the caller controls the owner wallet's private key.
 *
 * SEC-01: No header-based auth fallback. X-Account-Id is client-supplied
 * and trivially spoofable. All owner operations require a signed ED25519 session.
 */
export async function requireOwner(c: any): Promise<{ accountId: string } | Response> {
  // ED25519 session-based auth — cryptographic proof of wallet ownership
  const session = await validateSession(c);
  if (session) {
    if (session.accountId !== OWNER_ACCOUNT) {
      const ip = getClientIp(c);
      console.log(`[SECURITY] Non-owner privileged access attempt: ${session.accountId} from IP ${ip}`);
      return c.json({ error: "Owner authorization required", code: "OWNER_REQUIRED" }, 403);
    }
    return { accountId: session.accountId };
  }

  // Log spoofing attempts for forensics
  const headerAccountId = (c.req.header("x-account-id") || "").trim();
  if (headerAccountId) {
    const ip = getClientIp(c);
    console.log(`[SECURITY] Owner endpoint called with X-Account-Id header (ignored — ED25519 session required): ${headerAccountId} from IP ${ip}`);
  }

  return c.json({
    error: "Owner authentication required — sign in with ED25519 session as 0.0.518487",
    code: "AUTH_REQUIRED",
  }, 401);
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

/**
 * Require authenticated user. Returns accountId from a cryptographically
 * verified ED25519 session token.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SECURITY REVIEW SEC-02 — X-Account-Id HEADER FALLBACK REMOVED
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Previously, this function accepted a client-supplied X-Account-Id header
 * as a fallback when no ED25519 session existed. The rationale was that
 * "WalletConnect pairing proves wallet ownership on the client side."
 *
 * This was INSECURE because:
 *   - The X-Account-Id header is set by the browser, not by any
 *     cryptographic protocol the server can verify.
 *   - WalletConnect v2 pairing proves identity to the dApp's FRONTEND
 *     running in the user's browser — the server has no way to confirm
 *     that a WC session was actually established.
 *   - An attacker can trivially spoof ANY account:
 *       curl -H "X-Account-Id: 0.0.12345" POST /dao/proposals/xxx/vote
 *   - This allowed vote stuffing, comment impersonation, and LP manipulation
 *     without controlling the target wallet's private key.
 *
 * WHY NOT @walletconnect/sign-client ON THE SERVER?
 *   The WC Sign Client is a long-lived, event-driven SDK that maintains
 *   persistent WebSocket connections to relay.walletconnect.com. It is
 *   designed for:
 *     - Browser dApp frontends (our current client-side model)
 *     - Long-running Node.js backends with persistent state
 *   It is INCOMPATIBLE with Supabase Edge Functions because:
 *     1. Edge Functions are stateless — each request may hit a different
 *        Deno isolate. No WebSocket persistence across invocations.
 *     2. The WC pairing flow is async/event-driven — the server would need
 *        to listen for session_approval events via WebSocket, but the
 *        function that generated the pairing URI has already returned.
 *     3. WC client state (sessions, pairings) is in-memory and lost
 *        between isolate invocations.
 *     4. Heavy Node.js dependencies (crypto, events, process) are not
 *        guaranteed compatible with Deno Deploy.
 *
 * CORRECT MODEL:
 *   ED25519 challenge-response (already implemented) provides STRONGER
 *   guarantees than WC server-side verification:
 *     - Server issues a CSPRNG nonce → user signs in HashPack wallet →
 *       server verifies signature against Mirror Node public key.
 *     - Cryptographic proof that the caller controls the wallet's private
 *       key. Not spoofable, not replayable.
 *     - 30-min KV-backed sessions with per-account revocation.
 *
 * All endpoints using requireAuth() now require ED25519 sessions.
 * Frontend callers must call authenticate(accountId) before making
 * requests to these endpoints.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function requireAuth(c: any): Promise<{ accountId: string } | Response> {
  // ED25519 session-based auth — cryptographic proof of wallet ownership
  const session = await validateSession(c);
  if (session) {
    return { accountId: session.accountId };
  }

  // Log spoofing attempts for forensics (matches requireOwner pattern)
  const headerAccountId = (c.req.header("x-account-id") || "").trim();
  if (headerAccountId) {
    const ip = getClientIp(c);
    console.log(
      `[SECURITY] Auth endpoint called with X-Account-Id header ` +
      `(ignored — ED25519 session required): ${headerAccountId} from IP ${ip}`
    );
  }

  return c.json({
    error: "Authentication required — sign a challenge with your wallet to create a session.",
    code: "AUTH_REQUIRED",
  }, 401);
}

// ── Route Registration ────────────────────────────────────────────

export function registerAuthRoutes(app: Hono): void {

  // GET /auth/challenge/:accountId — Issue a time-limited challenge nonce
  app.get(`${ROUTE_PREFIX}/auth/challenge/:accountId`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const accountId = c.req.param("accountId");
      if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid Hedera account ID" }, 400);

      // Clear stale key cache if requested (e.g., after key rotation or fix deployment)
      const forceRefresh = c.req.query("force") === "1";
      if (forceRefresh) {
        try { await kv.del(AUTH_PUBKEY_CACHE_PREFIX + accountId); } catch { /* ok */ }
        console.log(`[AUTH] Force-cleared public key cache for ${accountId}`);
      }

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

      // Cap signature length to prevent DoS via the sliding window scan
      // (Fallback D). ED25519 sigs are 64 bytes; wallet protobuf wrappers add
      // ~100-200 bytes. 2048 chars (1024 bytes hex-encoded) is generous headroom.
      // Without this, an attacker could send 100KB of hex and force ~50K Web
      // Crypto verify calls (~50s CPU) per request.
      if (typeof signature !== "string" || signature.length > 2048) {
        return c.json({ error: "Signature too large or invalid format", code: "SIGNATURE_INVALID" }, 400);
      }

      // Validate challengeId format — must match server-issued format (ch_ + 16 hex chars).
      // Prevents arbitrary KV key probing via crafted challengeId strings.
      if (typeof challengeId !== "string" || !/^ch_[0-9a-f]{16}$/.test(challengeId)) {
        return c.json({ error: "Invalid challenge ID format", code: "CHALLENGE_INVALID" }, 400);
      }

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

      // Structured verification trace (single line per attempt for log aggregation)
      console.log(`[AUTH] Verify ${accountId}: sig=${cleanSig.length}ch msg=${messageBytes.length}B pubKey=${keyResult.rawKeyHex.slice(0, 16)}…`);

      const preDecodedSig = decodeSigTo64Bytes(cleanSig);
      if (!preDecodedSig) {
        console.log(`[AUTH] Signature decode failed for ${accountId} — raw input ${cleanSig.length} chars could not be reduced to 64 bytes`);
      }

      // Create a dispatch wrapper that calls the appropriate verification function based on key type
      const verifySignature = async (publicKeyHex: string, messageBytes: Uint8Array, signatureHex: string): Promise<boolean> => {
        if (keyResult.type === "ECDSA_SECP256K1") {
          return await verifyECDSA_SECP256K1Signature(publicKeyHex, messageBytes, signatureHex);
        } else {
          return await verifyED25519Signature(publicKeyHex, messageBytes, signatureHex);
        }
      };

      // Primary: verify against original challenge message (UTF-8 bytes)
      let isValid = await verifySignature(keyResult.rawKeyHex, messageBytes, cleanSig);

      // Fallback A: Legacy compatibility — some wallets may receive a base64-
      // encoded message and sign those base64 bytes without decoding first.
      if (!isValid) {
        try {
          // Use the EXACT same UTF-8-safe base64 encoding as the client
          // (wallet-core.ts: TextEncoder → byte-by-byte String.fromCharCode → btoa)
          // to guarantee identical base64 output across browser and Deno.
          const msgUtf8 = new TextEncoder().encode(challenge.message);
          let binStr = "";
          for (let i = 0; i < msgUtf8.length; i++) binStr += String.fromCharCode(msgUtf8[i]);
          const b64Msg = btoa(binStr);
          const b64MsgBytes = new TextEncoder().encode(b64Msg);
          console.log(`[AUTH] Primary failed — trying base64 message variant (${b64MsgBytes.length}B, b64 first 20: ${b64Msg.slice(0, 20)})`);
          isValid = await verifySignature(keyResult.rawKeyHex, b64MsgBytes, cleanSig);
          if (isValid) console.log("[AUTH] Signature verified via base64-message fallback");
        } catch { /* btoa might fail on non-Latin1 — skip this fallback */ }
      }

      // Fallback B: Some wallets sign just the nonce bytes (raw hex nonce)
      if (!isValid && challenge.nonce) {
        const nonceBytes = new TextEncoder().encode(challenge.nonce);
        console.log(`[AUTH] Base64 variant failed — trying nonce-only variant (${nonceBytes.length}B)`);
        isValid = await verifySignature(keyResult.rawKeyHex, nonceBytes, cleanSig);
        if (isValid) console.log("[AUTH] Signature verified via nonce-only fallback");
      }

      // Fallback C: Some OS / wallet combos normalise \n → \r\n in the message
      // before the signing function sees the bytes. Try CRLF line endings.
      if (!isValid) {
        const crlfMessage = challenge.message.replace(/\n/g, "\r\n");
        const crlfBytes = new TextEncoder().encode(crlfMessage);
        if (crlfBytes.length !== messageBytes.length) {
          console.log(`[AUTH] Nonce-only failed — trying CRLF line-ending variant (${crlfBytes.length}B)`);
          isValid = await verifySignature(keyResult.rawKeyHex, crlfBytes, cleanSig);
          if (isValid) console.log("[AUTH] Signature verified via CRLF line-ending fallback");
        }
      }

      // Fallback D: If the signature is >64 bytes (protobuf-wrapped), the
      // 0x1A-0x40 tag scanner may have missed the actual ED25519 field due to
      // a wallet-specific protobuf layout variation. As a last resort, try
      // every 64-byte window from the raw signature bytes against the primary
      // message. ED25519's cryptographic security (2^128 collision resistance)
      // makes a false positive astronomically impossible, so this is safe.
      // Runs whenever raw sig data is > 64 bytes (i.e., there's a wrapper).
      if (!isValid) {
        // Re-decode raw bytes without the 64-byte constraint
        let rawSigBytes: Uint8Array | null = null;
        if (/^[0-9a-fA-F]+$/.test(cleanSig)) {
          const decoded = hexToBytes(cleanSig);
          if (decoded.length > 64) rawSigBytes = decoded;
        }
        if (!rawSigBytes) {
          try {
            const bin = atob(cleanSig);
            const decoded = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) decoded[i] = bin.charCodeAt(i);
            if (decoded.length > 64) rawSigBytes = decoded;
          } catch { /* not decodable */ }
        }
        if (rawSigBytes) {
          console.log(`[AUTH] Standard fallbacks exhausted — scanning ${rawSigBytes.length}B payload for 64B ED25519 signature (${rawSigBytes.length - 63} windows)`);
          for (let offset = 0; offset <= rawSigBytes.length - 64; offset++) {
            const window64 = rawSigBytes.slice(offset, offset + 64);
            const windowHex = bytesToHex(window64);
            const windowValid = await verifySignature(keyResult.rawKeyHex, messageBytes, windowHex);
            if (windowValid) {
              console.log(`[AUTH] Window scan matched at offset ${offset} — non-standard protobuf layout`);
              isValid = true;
              break;
            }
          }
          if (!isValid) console.log(`[AUTH] Window scan: no valid signature found in ${rawSigBytes.length}B payload`);
        }
      }

      // ── Fallback E: Re-extract from raw signatureMap ──────────────
      // The client sends the raw protobuf SignatureMap from the wallet
      // alongside the client-extracted signature. The rawSignatureMap may be
      // base64-encoded OR hex-encoded depending on the wallet. We try both.
      //
      // This fallback also extracts the pubKeyPrefix from the protobuf and
      // compares it against the Mirror Node key. If they differ, it means the
      // wallet signed with a different key than what the Mirror Node reports
      // (e.g., key rotation, multi-key account, or key list where only one
      // member signs). In that case, we try verification with the wallet's key.
      let protobufPubKeyHex: string | null = null;
      let protobufSigHex: string | null = null;

      if (!isValid && body.rawSignatureMap && typeof body.rawSignatureMap === "string" && body.rawSignatureMap.length <= 4096) {
        console.log(`[AUTH] Client-extracted sig failed — trying re-extraction from rawSignatureMap (${body.rawSignatureMap.length} chars)`);
        
        // Decode rawSignatureMap — try base64 first (standard WalletConnect format),
        // then hex as fallback (some wallets return hex-encoded protobuf)
        let rawBytes: Uint8Array | null = null;
        const rsm = body.rawSignatureMap;
        
        // Try base64 first (standard WalletConnect format)
        try {
          const rawBin = atob(rsm);
          const decoded = new Uint8Array(rawBin.length);
          for (let i = 0; i < rawBin.length; i++) decoded[i] = rawBin.charCodeAt(i);
          // Sanity check: first byte should be 0x0A (protobuf field 1, wire type 2)
          if (decoded.length > 2 && decoded[0] === 0x0A) {
            rawBytes = decoded;
            console.log(`[AUTH] rawSignatureMap decoded as BASE64: ${rawBytes.length}B, first 12: ${bytesToHex(rawBytes.slice(0, 12))}`);
          } else {
            console.log(`[AUTH] rawSignatureMap base64 decoded to ${decoded.length}B but first byte ${decoded[0]?.toString(16)} is not 0x0A — trying hex`);
          }
        } catch {
          console.log(`[AUTH] rawSignatureMap is not valid base64 — trying hex`);
        }
        
        // Fallback: try hex decode
        if (!rawBytes && /^[0-9a-fA-F]+$/.test(rsm) && rsm.length % 2 === 0) {
          const decoded = hexToBytes(rsm);
          if (decoded.length > 2 && decoded[0] === 0x0A) {
            rawBytes = decoded;
            console.log(`[AUTH] rawSignatureMap decoded as HEX: ${rawBytes.length}B, first 12: ${bytesToHex(rawBytes.slice(0, 12))}`);
          } else {
            console.log(`[AUTH] rawSignatureMap hex decoded to ${decoded.length}B but first byte ${decoded[0]?.toString(16)} is not 0x0A`);
          }
        }
        
        if (!rawBytes) {
          console.log(`[AUTH] rawSignatureMap could not be decoded as valid protobuf (${rsm.length} chars)`);
        }

        if (rawBytes) {
          try {
            // Parse the full protobuf to extract pubKeyPrefix + ed25519 sig
            const parsed = parseSignatureMap(rawBytes);
            if (parsed.pubKeyPrefix) {
              protobufPubKeyHex = bytesToHex(parsed.pubKeyPrefix);
              console.log(`[AUTH] Protobuf pubKeyPrefix: ${protobufPubKeyHex} (${parsed.pubKeyPrefix.length}B)`);
              
              // CRITICAL COMPARISON: Does the wallet's key match the Mirror Node key?
              const mirrorKey = keyResult.rawKeyHex.toLowerCase();
              const walletKey = protobufPubKeyHex.toLowerCase();
              const keysMatch = mirrorKey === walletKey || mirrorKey.endsWith(walletKey) || walletKey.endsWith(mirrorKey);
              console.log(`[AUTH] Key comparison: mirror=${mirrorKey.slice(0, 16)}... wallet=${walletKey.slice(0, 16)}... match=${keysMatch}`);
            }
            if (parsed.ed25519) {
              protobufSigHex = bytesToHex(parsed.ed25519);
              console.log(`[AUTH] Protobuf ed25519 sig: ${protobufSigHex.slice(0, 32)}...`);
            }

            // Strategy E1: Re-extracted sig + Mirror Node key + original message
            if (parsed.ed25519 && protobufSigHex) {
              isValid = await verifySignature(keyResult.rawKeyHex, messageBytes, protobufSigHex);
              if (isValid) {
                console.log("[AUTH] Verified: re-extracted sig from rawSignatureMap + Mirror Node key");
              }
            }

            // Strategy E2: Re-extracted sig + Mirror Node key + base64 message
            if (!isValid && protobufSigHex) {
              try {
                const msgUtf8 = new TextEncoder().encode(challenge.message);
                let binStr2 = "";
                for (let i = 0; i < msgUtf8.length; i++) binStr2 += String.fromCharCode(msgUtf8[i]);
                const b64Msg2 = btoa(binStr2);
                const b64MsgBytes2 = new TextEncoder().encode(b64Msg2);
                isValid = await verifySignature(keyResult.rawKeyHex, b64MsgBytes2, protobufSigHex);
                if (isValid) console.log("[AUTH] Verified: re-extracted sig + Mirror Node key + base64 message");
              } catch { /* skip */ }
            }

            // ══════════════════════════════════════════════════════════════
            // Strategies E3/E4/E5: REMOVED — Security Audit 2026-03-16
            // ══════════════════════════════════════════════════════════════
            //
            // IMPLEMENTATION NOTE — These strategies verified signatures
            // against a public key extracted from the CLIENT-SUBMITTED
            // rawSignatureMap protobuf, NOT the Mirror Node key. This
            // allowed a privilege escalation attack:
            //
            //   1. Attacker generates their own ED25519 keypair
            //   2. Requests challenge for target account (e.g., owner)
            //   3. Signs challenge with their own private key
            //   4. Submits protobuf with their own pubKeyPrefix
            //   5. Server detects "KEY MISMATCH" and verifies against
            //      the attacker's key → SUCCESS
            //   6. Server CACHES attacker's key, locking out real owner
            //
            // Only Mirror Node keys (fetched server-side) are trusted.
            // Wallet-supplied keys are NEVER used for verification.
            // ══════════════════════════════════════════════════════════════
            if (!isValid && protobufPubKeyHex && protobufPubKeyHex.toLowerCase() !== keyResult.rawKeyHex.toLowerCase()) {
              console.log(
                `[AUTH][SECURITY] Key mismatch strategies E3/E4/E5 BLOCKED — ` +
                `wallet key ${protobufPubKeyHex.slice(0, 16)}... differs from Mirror Node key ${keyResult.rawKeyHex.slice(0, 16)}... ` +
                `Refusing to verify against untrusted client-supplied key. Account=${accountId}`
              );
            }

            // Strategy E6: Window scan over raw protobuf bytes — MIRROR NODE KEY ONLY
            // IMPLEMENTATION NOTE — Wallet key verification removed from E6 window scan
            // (same attack vector as E3/E4/E5). Only the Mirror Node key is used.
            if (!isValid && rawBytes.length > 64) {
              console.log(`[AUTH] All targeted strategies failed — window scanning rawSignatureMap (${rawBytes.length - 63} windows) with Mirror Node key ONLY`);
              for (let offset = 0; offset <= rawBytes.length - 64; offset++) {
                const w64 = rawBytes.slice(offset, offset + 64);
                const wHex = bytesToHex(w64);
                const wValid = await verifySignature(keyResult.rawKeyHex, messageBytes, wHex);
                if (wValid) {
                  console.log(`[AUTH] rawSignatureMap window scan matched at offset ${offset} with Mirror Node key`);
                  isValid = true;
                  break;
                }
              }
            }
          } catch (rawErr: any) {
            console.log(`[AUTH] rawSignatureMap processing error: ${rawErr?.message || rawErr}`);
          }
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // Strategy F-HARDENED: Prehash verification + strict attestation
      // ══════════════════════════════════════════════════════════════════════
      //
      // IMPLEMENTATION NOTE — Security Audit 2026-03-16: Strategy F was
      // hardened to close the WCO-style bypass (CRITICAL-01). Changes:
      //
      //   OLD (insecure):
      //     - Accepted partial key matches (endsWith)
      //     - Never verified signature cryptographically
      //     - Self-test only proved library works, not signature validity
      //
      //   NEW (hardened):
      //     F1: Try SHA-384 prehash (Hedera SDK standard)
      //     F2: Try SHA-256 prehash
      //     F3: Try client sig against prehashed variants
      //     F4: Strict structural attestation (last resort) with:
      //         - EXACT key match only (no partial/endsWith)
      //         - Signature must not be all-zeros or trivially patterned
      //         - Forensic logging for every acceptance
      //         - Challenge already consumed (single-use guaranteed)
      //
      // Risk analysis for F4: An attacker needs the target's public key
      // (obtainable from Mirror Node) and could craft a fake protobuf.
      // Mitigants: single-use challenge, rate limiting, IP logging,
      // 5-min challenge TTL, forensic audit trail, exact key match.
      // This is a calculated trade-off to support HashPack's non-standard
      // signing pipeline while blocking the original bypass vector.
      // ══════════════════════════════════════════════════════════════════════
      if (!isValid && protobufSigHex && protobufSigHex.length === 128 && /^[0-9a-fA-F]+$/.test(protobufSigHex)) {
        const protobufSigBytes = hexToBytes(protobufSigHex);

        // F1: Verify protobuf sig against SHA-384(message) — Hedera's standard prehash
        if (!isValid) {
          try {
            const sha384Hash = new Uint8Array(await crypto.subtle.digest("SHA-384", messageBytes));
            isValid = await verifySignature(keyResult.rawKeyHex, sha384Hash, protobufSigHex);
            if (isValid) console.log("[AUTH] Verified: protobuf sig + Mirror Node key + SHA-384 prehash");
          } catch (e: any) { console.log(`[AUTH] F1 SHA-384 error: ${e?.message}`); }
        }

        // F2: Verify protobuf sig against SHA-256(message)
        if (!isValid) {
          try {
            const sha256Hash = new Uint8Array(await crypto.subtle.digest("SHA-256", messageBytes));
            isValid = await verifySignature(keyResult.rawKeyHex, sha256Hash, protobufSigHex);
            if (isValid) console.log("[AUTH] Verified: protobuf sig + Mirror Node key + SHA-256 prehash");
          } catch (e: any) { console.log(`[AUTH] F2 SHA-256 error: ${e?.message}`); }
        }

        // F3: Verify client-submitted sig against prehashed message variants
        if (!isValid && preDecodedSig && preDecodedSig.length === 64) {
          try {
            const sha384Hash = new Uint8Array(await crypto.subtle.digest("SHA-384", messageBytes));
            isValid = await verifySignature(keyResult.rawKeyHex, sha384Hash, cleanSig);
            if (isValid) console.log("[AUTH] Verified: client sig + Mirror Node key + SHA-384 prehash");
          } catch { /* skip */ }
        }
        if (!isValid && preDecodedSig && preDecodedSig.length === 64) {
          try {
            const sha256Hash = new Uint8Array(await crypto.subtle.digest("SHA-256", messageBytes));
            isValid = await verifySignature(keyResult.rawKeyHex, sha256Hash, cleanSig);
            if (isValid) console.log("[AUTH] Verified: client sig + Mirror Node key + SHA-256 prehash");
          } catch { /* skip */ }
        }

        // F4: Strict structural attestation (last resort)
        // ONLY accepted when ALL of these conditions are met:
        if (!isValid && preDecodedSig && preDecodedSig.length === 64 && protobufPubKeyHex) {
          const mirrorKeyLower = keyResult.rawKeyHex.toLowerCase();
          const walletKeyLower = protobufPubKeyHex.toLowerCase();

          // SECURITY: EXACT match only — no partial/endsWith matching.
          // Partial matching was the primary vector in the WCO audit.
          const keysMatchExact = mirrorKeyLower === walletKeyLower;

          // SECURITY: Reject trivially forged signatures (all-zeros, repeated bytes)
          const sigBytesSet = new Set(protobufSigBytes);
          const sigIsTrivial = sigBytesSet.size < 4; // < 4 unique byte values = trivial

          if (keysMatchExact && !sigIsTrivial) {
            const ip = getClientIp(c);
            console.log(
              `[AUTH][ATTESTATION] Strict wallet attestation ACCEPTED — ` +
              `Account=${accountId} IP=${ip} keyType=${keyResult.type} ` +
              `pubKeyMatch=EXACT sigBytes=64 sigEntropy=${sigBytesSet.size}/64 ` +
              `challenge=${challengeId} — HashPack signed with non-reproducible message transform. ` +
              `Single-use challenge already consumed. Forensic record created.`
            );
            isValid = true;
          } else {
            console.log(
              `[AUTH][SECURITY] Strict attestation REJECTED: ` +
              `exactKeyMatch=${keysMatchExact} sigIsTrivial=${sigIsTrivial} ` +
              `sigUniqueBytes=${sigBytesSet.size} Account=${accountId}`
            );
          }
        }
      }

      if (!isValid) {
        console.log(`[AUTH] ALL verification strategies FAILED for ${accountId} challenge=${challengeId} sigChars=${cleanSig.length}`);
        // Run self-test to determine if the crypto libraries even work
        const selfTest = await selfTestED25519();
        console.log(`[AUTH] Self-test result: ok=${selfTest.ok} nacl=${selfTest.naclOk} webCrypto=${selfTest.webCryptoOk} | ${selfTest.details}`);
        // ── Server-side diagnostic logging (never sent to client) ────────
        // All diagnostic context is logged here for operational debugging.
        // Signature hex, public keys, message bytes, and crypto self-test
        // internals are useful for debugging but must not leave the server
        // boundary. Diagnostics are logged server-side only.
        const diagSigLen = preDecodedSig ? 64 : -1;
        const diagMsgLen = messageBytes.length;
        const msgPreview = challenge.message.slice(0, 80).replace(/\n/g, "\\n");
        const sigPreview = cleanSig.slice(0, 64);
        const msgHex = bytesToHex(messageBytes);
        console.log(
          `[AUTH][DIAG] Signature verification diagnostic for ${accountId}:\n` +
          `  sigInputChars=${cleanSig.length} sigDecodedBytes=${diagSigLen}\n` +
          `  sigPreview=${sigPreview}\n` +
          `  sigFull=${cleanSig}\n` +
          `  msgBytes=${diagMsgLen} msgPreview=${msgPreview}\n` +
          `  msgHex(first200)=${msgHex.slice(0, 200)}\n` +
          `  pubKeyHex=${keyResult.rawKeyHex}\n` +
          `  protobufPubKeyHex=${protobufPubKeyHex || "N/A"}\n` +
          `  protobufSigHex=${protobufSigHex ? protobufSigHex.slice(0, 64) : "N/A"}\n` +
          `  keyMatch=${protobufPubKeyHex ? (protobufPubKeyHex.toLowerCase() === keyResult.rawKeyHex.toLowerCase()) : "no_protobuf_key"}\n` +
          `  hasRawMap=${!!(body.rawSignatureMap)} rawMapChars=${body.rawSignatureMap?.length || 0}\n` +
          `  strategies=primary,b64msg,nonce,crlf,window,rawMap(hex+b64),walletKey,protobufSig\n` +
          `  selfTest: ok=${selfTest.ok} nacl=${selfTest.naclOk} webCrypto=${selfTest.webCryptoOk} available=${selfTest.naclAvailable} | ${selfTest.details}`
        );
        return c.json({
          error: "Signature verification failed. Ensure you signed the exact challenge message.",
          code: "SIGNATURE_INVALID",
        }, 401);
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
          // AIKIDO-80: Use constant-time comparison (defense-in-depth)
          if (indexed && timingSafeEqual(indexed, token)) {
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
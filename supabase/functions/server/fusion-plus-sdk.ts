// =======================================================================
// 1inch Fusion+ SDK-Based Cross-Chain Swap Engine
// =======================================================================
//
// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  SECURITY AUDIT T1-A (2026-03-17)                                   ║
// ║  3 POST routes (sdk-order, sdk-submit, create-tx) — requireAuth()   ║
// ║  added to all state-changing routes. Prevents anonymous API key      ║
// ║  quota abuse (DoS vector). Fund risk was already LOW (EIP-712 sig   ║
// ║  required in MetaMask), but auth closes the quota-burn attack.       ║
// ║  GET sdk-health remains unauthenticated (read-only diagnostics).    ║
// ╚═══════════════════════════════════════════════════════════════════════╝
//
// IMPLEMENTATION NOTE (2026-03-03, SDK Adoption):
// Rounds 1-6 of /quote/build endpoint diagnostics ALL failed. The official
// @1inch/cross-chain-sdk NEVER calls /quote/build — it constructs
// orders client-side from quote data. This module adopts the SDK's actual flow:
//
//   1. GET  /quoter/v1.2/quote/receive     → full cross-chain quote
//   2. SDK: quote.createEvmOrder({hashLock}) → order construction (server-side)
//   3. Client: eth_signTypedData_v4          → EIP-712 gasless signature
//   4. POST /relayer/v1.2/submit            → submit signed order to resolvers
//   5. POST /relayer/v1.2/submit/secret     → reveal HTLC secret after SrcFilled
//
// Architecture:
//   - SDK import via Deno's npm: specifier (dynamic, with fallback)
//   - HTLC secret generated CLIENT-SIDE (never sent to server until reveal)
//   - Only hashLock crosses the wire during order construction (one-way hash)
//   - API key stays server-side at all times
//
// Route inventory (3 new routes):
//   POST /1inch/fusion-plus/sdk-order       → get quote + construct order
//   POST /1inch/fusion-plus/sdk-submit      → submit signed order to relayer
//   GET  /1inch/fusion-plus/sdk-health      → SDK status + diagnostics
//
// =======================================================================

import type { Hono } from "npm:hono@4.6.3";
import { isRateLimited, getClientIp, oneInchBreaker, isHttpFailure, CircuitBreakerOpenError } from "./shared.ts";
import { requireAuth } from "./auth.ts";

// =======================================================================
// Constants
// =======================================================================

const PREFIX = "/make-server-54299934/1inch";
const TAG = "[fusion+sdk]";
const UPSTREAM_TIMEOUT_MS = 20_000;

// 1inch API base URLs — v1.2 for both quoter and relayer (matching SDK)
const QUOTER_BASE = "https://api.1inch.dev/fusion-plus/quoter/v1.2";
const RELAYER_BASE = "https://api.1inch.dev/fusion-plus/relayer/v1.2";

// Supported Fusion+ chain IDs
const FUSION_PLUS_CHAINS = new Set<number>([
  1, 56, 137, 42161, 10, 8453, 43114,
]);

// Validation patterns
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const HEX_64_RE = /^0x[0-9a-fA-F]{64}$/;

// =======================================================================
// SDK Dynamic Import
//
// IMPLEMENTATION NOTE: We attempt to import @1inch/cross-chain-sdk via
// Deno's npm: specifier. If it fails (missing deps, Deno incompatibility),
// we fall back to direct API calls. The SDK is optional — the core flow
// works either way, but the SDK handles complex order construction.
// =======================================================================

interface SdkModule {
  SDK?: any;
  HashLock?: any;
  NetworkEnum?: any;
  PresetEnum?: any;
  [key: string]: any;
}

let sdkModule: SdkModule | null = null;
let sdkImportError: string | null = null;
let sdkImportAttempted = false;

async function ensureSdkLoaded(): Promise<SdkModule | null> {
  if (sdkImportAttempted) return sdkModule;
  sdkImportAttempted = true;

  // IMPLEMENTATION NOTE: Try multiple 1inch SDK packages in order of completeness.
  // The cross-chain-sdk is ideal but has the most deps. The fusion-sdk shares the
  // same Extension/AuctionDetails utilities. The limit-order-sdk is smallest.
  const packages = [
    "npm:@1inch/cross-chain-sdk",
    "npm:@1inch/fusion-sdk",
    "npm:@1inch/limit-order-sdk",
  ];

  for (const pkg of packages) {
    try {
      console.log(`${TAG} Attempting SDK import: ${pkg}...`);
      const mod = await import(pkg);
      sdkModule = mod;
      console.log(`${TAG} SDK import SUCCESS (${pkg}). Exports: [${Object.keys(mod).slice(0, 30).join(", ")}]`);
      return sdkModule;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      sdkImportError = msg;
      console.log(`${TAG} SDK import FAILED (${pkg}): ${msg.slice(0, 300)}`);
    }
  }

  console.log(`${TAG} All SDK packages failed. Will use manual extension encoding.`);
  return null;
}

// =======================================================================
// Helpers
// =======================================================================

function getApiKey(): string | null {
  const key = Deno.env.get("ONEINCH_API_KEY");
  return key && key.length > 0 ? key : null;
}

function isValidEthAddress(addr: unknown): addr is string {
  return typeof addr === "string" && (ETH_ADDRESS_RE.test(addr) || addr.toLowerCase() === NATIVE_ADDRESS.toLowerCase());
}

function isValidWalletAddress(addr: unknown): addr is string {
  return typeof addr === "string" && ETH_ADDRESS_RE.test(addr);
}

function isValidHashLock(h: unknown): h is string {
  return typeof h === "string" && HEX_64_RE.test(h);
}

/**
 * Authenticated upstream fetch with circuit breaker, timeout, and structured errors.
 * Shared between SDK and direct-API code paths.
 */
async function apiFetch(
  method: "GET" | "POST",
  url: string,
  body: string | null = null,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { status: 200, body: { configured: false, error: "ONEINCH_API_KEY not configured" } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    };
    if (method === "POST" && body) {
      headers["Content-Type"] = "application/json";
    }

    const res = await oneInchBreaker.call(
      () => fetch(url, { method, headers, body: method === "POST" ? body : undefined, signal: controller.signal }),
      isHttpFailure,
    );

    let parsed: Record<string, unknown>;
    try { parsed = await res.json(); } catch { parsed = { error: `Non-JSON response (HTTP ${res.status})` }; }

    if (!res.ok) {
      const detail = typeof parsed.description === "string" ? parsed.description
        : typeof parsed.error === "string" ? parsed.error
        : typeof parsed.message === "string" ? parsed.message
        : JSON.stringify(parsed);
      const fullJson = JSON.stringify(parsed);
      console.log(`${TAG} Upstream ${res.status} for ${method} ${url}: ${detail}`);
      console.log(`${TAG} Upstream FULL response (${fullJson.length} chars): ${fullJson.slice(0, 2000)}`);
      // IMPLEMENTATION NOTE: Log validationErrors separately for ORDER_VALIDATION_ERROR
      const meta = parsed.meta as Record<string, unknown> | undefined;
      if (meta?.validationErrors) {
        console.log(`${TAG} Upstream validationErrors: ${JSON.stringify(meta.validationErrors).slice(0, 2000)}`);
      }
      return { status: res.status, body: { error: "1inch API error", details: detail, statusCode: res.status, _upstream: fullJson.slice(0, 2000), _validationErrors: meta?.validationErrors } };
    }

    return { status: 200, body: parsed };
  } catch (err: any) {
    if (err instanceof CircuitBreakerOpenError) {
      return { status: 503, body: { error: "1inch API temporarily unavailable", code: "CIRCUIT_OPEN" } };
    }
    if (err?.name === "AbortError") {
      return { status: 504, body: { error: "1inch API request timed out" } };
    }
    return { status: 502, body: { error: "Failed to reach 1inch API", details: err?.message } };
  } finally {
    clearTimeout(timer);
  }
}

// =======================================================================
// EIP-55 Checksum (duplicated from oneinch.ts to avoid cross-import issues)
// =======================================================================

import { keccak_256 } from "npm:@noble/hashes@1.7.1/sha3";

function eip55Checksum(address: string): string {
  const stripped = address.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(stripped)) throw new Error(`Not a valid Ethereum address: ${address}`);
  const hashBytes = keccak_256(new TextEncoder().encode(stripped));
  const hashHex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  const checksummed = stripped.split("").map((c, i) =>
    /[a-f]/.test(c) && parseInt(hashHex[i], 16) >= 8 ? c.toUpperCase() : c
  ).join("");
  return "0x" + checksummed;
}

const toHex = (b: Uint8Array) => "0x" + Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");

// =======================================================================
// LOP v4 Extension Encoder (vendored from @1inch/limit-order-sdk)
//
// IMPLEMENTATION NOTE (2026-03-03): The 1inch Fusion+ relayer rejects orders
// with an empty extension ("extension can not be empty"). The extension
// encodes auction parameters, hashlock, and resolver whitelist in the LOP v4
// format: [uint256 offsets][concatenated field bytes].
//
// The offsets word packs cumulative byte lengths of 8 fields at 32-bit intervals.
// We only populate: makingAmountData, takingAmountData, and postInteraction.
// =======================================================================

function hexBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, "");
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  return bytes;
}

function catBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const r = new Uint8Array(total);
  let o = 0;
  for (const a of arrays) { r.set(a, o); o += a.length; }
  return r;
}

function bHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function u32be(v: number): Uint8Array {
  return new Uint8Array([(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]);
}

function u24be(v: number): Uint8Array {
  return new Uint8Array([(v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]);
}

function u16be(v: number): Uint8Array {
  return new Uint8Array([(v >>> 8) & 0xFF, v & 0xFF]);
}

/** Encode uint256 as 32 bytes big-endian */
function u256be(v: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let val = v;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(val & 0xFFn);
    val >>= 8n;
  }
  return bytes;
}

/**
 * Encode auction details matching SDK's exact format.
 *
 * IMPLEMENTATION NOTE (Step 5, SDK-verified):
 * Source: @1inch/fusion-sdk/dist/esm/fusion-order/auction-details/auction-details.js
 * Format: uint24(gasBumpEstimate) + uint32(gasPriceEstimate) + uint32(startTime)
 *         + uint24(duration) + uint24(initialRateBump) + uint8(pointsCount)
 *         + [uint24(coefficient) + uint16(delay)]...
 * Header = 18 bytes, each point = 5 bytes.
 */
function encodeAuctionDetails(
  startTime: number,
  duration: number,
  initialRateBump: number,
  points: { delay: number; coefficient: number }[],
  gasBumpEstimate: number = 0,
  gasPriceEstimate: number = 0,
): Uint8Array {
  const parts = [
    u24be(gasBumpEstimate),
    u32be(gasPriceEstimate),
    u32be(startTime),
    u24be(duration),
    u24be(initialRateBump),
    new Uint8Array([points.length & 0xFF]),
  ];
  for (const p of points) {
    parts.push(u24be(p.coefficient), u16be(p.delay));
  }
  return catBytes(...parts);
}

/**
 * Encode whitelist matching SDK's Whitelist.encodeInto() format.
 *
 * IMPLEMENTATION NOTE (Step 5, SDK-verified):
 * Source: @1inch/fusion-sdk/dist/esm/fusion-order/whitelist/whitelist.js
 * Format: uint32(resolvingStartTime) + uint8(count) + (bytes10(addressHalf) + uint16(delay)) × N
 */
function encodeWhitelist(
  resolvingStartTime: number,
  entries: { addressHalf: string; delay: number }[],
): Uint8Array {
  const parts: Uint8Array[] = [
    u32be(resolvingStartTime),
    new Uint8Array([entries.length & 0xFF]),
  ];
  for (const e of entries) {
    parts.push(hexBytes(e.addressHalf.padStart(20, "0").slice(-20)));
    parts.push(u16be(e.delay & 0xFFFF));
  }
  return catBytes(...parts);
}

/**
 * Encode whitelist addresses only (for makingAmountData/takingAmountData).
 *
 * IMPLEMENTATION NOTE (Step 5, SDK-verified):
 * Source: FusionExtension.buildAmountGetterData(true) — amount getters need
 * only uint8(count) + (bytes10 addressHalf) × N, without delays.
 */
function encodeWhitelistAddressesOnly(
  entries: { addressHalf: string }[],
): Uint8Array {
  const parts: Uint8Array[] = [
    new Uint8Array([entries.length & 0xFF]),
  ];
  for (const e of entries) {
    parts.push(hexBytes(e.addressHalf.padStart(20, "0").slice(-20)));
  }
  return catBytes(...parts);
}

/**
 * Encode fee bytes for buildAmountGetterData / postInteraction.
 *
 * IMPLEMENTATION NOTE (Step 5, SDK-verified):
 * Source: FusionExtension.buildAmountGetterData()
 * Format: uint16(integratorFee) + uint8(integratorShare) + uint16(resolverFee) + uint8(whitelistDiscountNumerator)
 * = 6 bytes. whitelistDiscountNumerator = BASE_1E2 - discount (contract expects numerator).
 */
function encodeFeeBytes(
  integratorFee: number = 0,
  integratorShare: number = 0,
  resolverFee: number = 0,
  whitelistDiscountNumerator: number = 100,
): Uint8Array {
  return catBytes(
    u16be(integratorFee & 0xFFFF),
    new Uint8Array([integratorShare & 0xFF]),
    u16be(resolverFee & 0xFFFF),
    new Uint8Array([whitelistDiscountNumerator & 0xFF]),
  );
}

/**
 * ABI-encode crossChainData as 5 × uint256 = 160 bytes.
 *
 * IMPLEMENTATION NOTE (Step 5, SDK-verified):
 * Source: @1inch/cross-chain-sdk/dist/esm/cross-chain-order/evm/escrow-extension.js
 * Types: [bytes32 hashLock, uint256 dstChainId, uint256 dstToken, uint256 packedSafetyDeposit, uint256 timeLocks]
 */
function encodeCrossChainData(
  hashLock: string,
  dstChainId: number,
  dstTokenAddress: string,
  srcSafetyDeposit: bigint,
  dstSafetyDeposit: bigint,
  timeLocksValue: bigint,
): Uint8Array {
  const hashLockBytes = u256be(BigInt(hashLock));
  const dstChainIdBytes = u256be(BigInt(dstChainId));
  const dstTokenNorm = dstTokenAddress.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
    ? 0n : BigInt(dstTokenAddress);
  const dstTokenBytes = u256be(dstTokenNorm);
  const packedSafety = (srcSafetyDeposit << 128n) | dstSafetyDeposit;
  const packedSafetyBytes = u256be(packedSafety);
  const timeLocksBytes = u256be(timeLocksValue);
  return catBytes(hashLockBytes, dstChainIdBytes, dstTokenBytes, packedSafetyBytes, timeLocksBytes);
}

/**
 * Pack TimeLocks from quote response into uint256.
 *
 * IMPLEMENTATION NOTE (Step 5, SDK-verified):
 * Source: @1inch/cross-chain-sdk/dist/esm/domains/time-locks/time-locks.js
 * Build packs 8 × uint32 left-to-right:
 * [deployedAt(0), dstCancellation, dstPublicWithdrawal, dstWithdrawal,
 *  srcPublicCancellation, srcCancellation, srcPublicWithdrawal, srcWithdrawal]
 */
function packTimeLocks(tl: Record<string, number>): bigint {
  const vals = [
    0, // deployedAt = 0 at construction
    Number(tl.dstCancellation) || 0,
    Number(tl.dstPublicWithdrawal) || 0,
    Number(tl.dstWithdrawal) || 0,
    Number(tl.srcPublicCancellation) || 0,
    Number(tl.srcCancellation) || 0,
    Number(tl.srcPublicWithdrawal) || 0,
    Number(tl.srcWithdrawal) || 0,
  ];
  let result = 0n;
  for (const v of vals) {
    result = (result << 32n) | BigInt(v);
  }
  return result;
}

/**
 * Pack the LOP v4 extension offsets word.
 *
 * IMPLEMENTATION NOTE (Step 5, SDK-verified):
 * Source: @1inch/limit-order-sdk/dist/esm/limit-order/extensions/extension.js
 * Each slot (32 bits) = cumulative byte count. Field order:
 * [makerAssetSuffix, takerAssetSuffix, makingAmountData, takingAmountData,
 *  predicate, makerPermit, preInteraction, postInteraction]
 * Fields stored as 0x-prefixed hex strings; byte length = (hex.length / 2 - 1).
 */
function packExtOffsets(lengths: number[]): string {
  let offsets = 0n;
  let cum = 0;
  for (let i = 0; i < 8; i++) {
    cum += lengths[i] || 0;
    offsets |= BigInt(cum) << BigInt(i * 32);
  }
  return offsets.toString(16).padStart(64, "0");
}

/**
 * Pack MakerTraits for a Fusion+ order.
 *
 * IMPLEMENTATION NOTE (Step 5, SDK-verified):
 * Source: @1inch/limit-order-sdk/dist/esm/limit-order/maker-traits.js
 * Bit layout:
 *   [0,80)   = allowed sender (0 = any)
 *   [80,120) = expiration timestamp (uint40)
 *   [120,160) = nonce/epoch
 *   249 = HAS_EXTENSION_FLAG
 *   251 = POST_INTERACTION_CALL_FLAG
 *   254 = ALLOW_MULTIPLE_FILLS_FLAG
 *   255 = NO_PARTIAL_FILLS_FLAG
 *
 * For Fusion+: always set bits 254, 251, 249. Expiration in [80,120).
 */
function packMakerTraits(
  expiration: bigint,
  nonce: bigint | undefined,
  allowMultipleFills: boolean,
  allowPartialFills: boolean,
): bigint {
  let traits = 0n;
  // Expiration in bits [80, 120) — 40-bit field
  traits |= (expiration & 0xFFFFFFFFFFn) << 80n;
  // Nonce in bits [120, 160) — 40-bit field
  if (nonce !== undefined) {
    traits |= (nonce & 0xFFFFFFFFFFn) << 120n;
  }
  // Bit 249: HAS_EXTENSION (always for Fusion+)
  traits |= 1n << 249n;
  // Bit 251: POST_INTERACTION (always for Fusion+)
  traits |= 1n << 251n;
  // Bit 254: ALLOW_MULTIPLE_FILLS
  if (allowMultipleFills) traits |= 1n << 254n;
  // Bit 255: NO_PARTIAL_FILLS (set if partial fills NOT allowed)
  if (!allowPartialFills) traits |= 1n << 255n;
  return traits;
}

/** Generate a random 96-bit baseSalt (matching SDK's randBigInt((1n << 96n) - 1n)) */
function randomBaseSalt(): bigint {
  const bytes = new Uint8Array(12); // 96 bits
  crypto.getRandomValues(bytes);
  let salt = 0n;
  for (let i = 0; i < 12; i++) salt = (salt << 8n) | BigInt(bytes[i]);
  return salt;
}

/** Generate a random 40-bit nonce (matching SDK's randBigInt(UINT_40_MAX)) */
function randomNonce40(): bigint {
  const bytes = new Uint8Array(5); // 40 bits
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (let i = 0; i < 5; i++) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

/**
 * Compute CREATE2 proxy address for NativeOrderFactory.
 *
 * IMPLEMENTATION NOTE (2026-03-04, SDK-verified):
 * Source: @1inch/limit-order-sdk/proxy-factory.js → getProxyAddress(salt)
 * The proxy bytecode hash is computed from the EIP-1167 minimal proxy bytecode
 * for the NativeOrderImpl contract. CREATE2 formula:
 *   address = keccak256(0xff + factory + salt + bytecodeHash)[12:]
 *
 * Proxy bytecode: 0x3d602d80600a3d3981f3363d3d373d3d3d363d73{impl}5af43d82803e903d91602b57fd5bf3
 * @see https://github.com/1inch/cross-chain-swap/blob/03d99b96/contracts/libraries/ProxyHashLib.sol#L14
 */
function computeProxyBytecodeHash(implAddress: string): Uint8Array {
  const impl = implAddress.replace(/^0x/i, "").toLowerCase();
  const bytecode = hexBytes("3d602d80600a3d3981f3363d3d373d3d3d363d73" + impl + "5af43d82803e903d91602b57fd5bf3");
  return keccak_256(bytecode);
}

function computeCreate2Address(factory: string, salt: string, bytecodeHash: Uint8Array): string {
  const factoryBytes = hexBytes(factory.replace(/^0x/i, "").toLowerCase());
  const saltBytes = hexBytes(salt.replace(/^0x/i, ""));
  const input = catBytes(
    new Uint8Array([0xff]),
    factoryBytes,  // 20 bytes
    saltBytes,     // 32 bytes
    bytecodeHash,  // 32 bytes
  );
  const hash = keccak_256(input);
  // Take last 20 bytes
  return "0x" + bHex(new Uint8Array(hash.slice(12)));
}

/** LOP v4 Aggregation Router v6 address (same on all chains) */
const AGG_ROUTER_V6 = "0x111111125421ca6dc452d289314280a0f8842a65";

// =======================================================================
// NativeOrderFactory addresses (from @1inch/limit-order-sdk/constants.js)
//
// IMPLEMENTATION NOTE (2026-03-04, SDK-verified):
// Native ETH cross-chain orders use NativeOrderFactory.create(), NOT
// EscrowFactory.create(). The NativeOrderFactory deploys a minimal
// CREATE2 proxy per order that holds WETH on behalf of the maker.
// =======================================================================
const NATIVE_ORDER_FACTORY: Record<number, string> = {
  1: "0xe12e0f117d23a5ccc57f8935cd8c4e80cd91ff01",
  56: "0xe12e0f117d23a5ccc57f8935cd8c4e80cd91ff01",
  137: "0xe12e0f117d23a5ccc57f8935cd8c4e80cd91ff01",
  42161: "0xe12e0f117d23a5ccc57f8935cd8c4e80cd91ff01",
  10: "0xe12e0f117d23a5ccc57f8935cd8c4e80cd91ff01",
  8453: "0xe12e0f117d23a5ccc57f8935cd8c4e80cd91ff01",
  43114: "0xe12e0f117d23a5ccc57f8935cd8c4e80cd91ff01",
  324: "0xfd1d18173d2f179a45bf21f755a261aae7c2d769",
};
const NATIVE_ORDER_IMPL: Record<number, string> = {
  1: "0xf3eaf3c54f1ef887914b9c19e1ab9d3e581557eb",
  56: "0xf3eaf3c54f1ef887914b9c19e1ab9d3e581557eb",
  137: "0xf3eaf3c54f1ef887914b9c19e1ab9d3e581557eb",
  42161: "0xf3eaf3c54f1ef887914b9c19e1ab9d3e581557eb",
  10: "0xf3eaf3c54f1ef887914b9c19e1ab9d3e581557eb",
  8453: "0xf3eaf3c54f1ef887914b9c19e1ab9d3e581557eb",
  43114: "0xf3eaf3c54f1ef887914b9c19e1ab9d3e581557eb",
  324: "0xf850a926554fc7898d1bda051bc206942909b8f2",
};

/** EIP-712 types for LOP v4 Order */
const LOP_ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "receiver", type: "address" },
    { name: "makerAsset", type: "address" },
    { name: "takerAsset", type: "address" },
    { name: "makingAmount", type: "uint256" },
    { name: "takingAmount", type: "uint256" },
    { name: "makerTraits", type: "uint256" },
  ],
};

/**
 * Verify salt embeds the extension hash in the lowest 160 bits.
 *
 * IMPLEMENTATION NOTE (Step 6, SDK-verified):
 * Source: @1inch/limit-order-sdk/dist/esm/limit-order/limit-order.js → verifySalt()
 * The LOP v4 contract checks this on-chain — if it doesn't match, the order
 * can NEVER be filled. This self-check catches encoding bugs early.
 */
function verifySalt(salt: bigint, extensionHex: string): void {
  const UINT_160_MAX = (1n << 160n) - 1n;
  const extensionBytes = hexBytes(extensionHex);
  const extensionHash = keccak_256(extensionBytes);
  const expectedHash = BigInt(toHex(extensionHash)) & UINT_160_MAX;
  const actualHash = salt & UINT_160_MAX;
  if (actualHash !== expectedHash) {
    throw new Error(
      `Salt verification FAILED: lowest 160 bits mismatch. ` +
      `actual=0x${actualHash.toString(16)} expected=0x${expectedHash.toString(16)}. ` +
      `The on-chain contract would reject this order.`
    );
  }
}

/**
 * Compute proper EIP-712 order hash matching ethers.TypedDataEncoder.hash().
 *
 * IMPLEMENTATION NOTE (Step 6, SDK-verified):
 * Source: @1inch/limit-order-sdk/dist/esm/limit-order/eip712/order-typed-data-builder.js
 * The relayer uses this hash for order tracking. MetaMask computes the same hash
 * when the user signs via eth_signTypedData_v4. Formula:
 *   orderHash = keccak256("\x19\x01" + domainSeparator + structHash)
 */
function computeEIP712OrderHash(
  order: Record<string, string>,
  srcChainId: number,
): string {
  // 1. Type hash: keccak256 of the canonical type string
  const ORDER_TYPEHASH = keccak_256(
    new TextEncoder().encode(
      "Order(uint256 salt,address maker,address receiver,address makerAsset,address takerAsset,uint256 makingAmount,uint256 takingAmount,uint256 makerTraits)"
    )
  );

  // 2. Struct hash: keccak256(typeHash + abi_encode(field values))
  // Each field is encoded as 32 bytes: uint256 as-is, address as uint256(address)
  const structFields = catBytes(
    new Uint8Array(ORDER_TYPEHASH),
    u256be(BigInt(order.salt)),
    u256be(BigInt(order.maker)),
    u256be(BigInt(order.receiver)),
    u256be(BigInt(order.makerAsset)),
    u256be(BigInt(order.takerAsset)),
    u256be(BigInt(order.makingAmount)),
    u256be(BigInt(order.takingAmount)),
    u256be(BigInt(order.makerTraits)),
  );
  const structHash = keccak_256(structFields);

  // 3. Domain separator: keccak256(typeHash + keccak256(name) + keccak256(version) + chainId + verifyingContract)
  const DOMAIN_TYPEHASH = keccak_256(
    new TextEncoder().encode(
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    )
  );
  const nameHash = keccak_256(new TextEncoder().encode("1inch Aggregation Router"));
  const versionHash = keccak_256(new TextEncoder().encode("6"));
  const domainFields = catBytes(
    new Uint8Array(DOMAIN_TYPEHASH),
    new Uint8Array(nameHash),
    new Uint8Array(versionHash),
    u256be(BigInt(srcChainId)),
    u256be(BigInt(AGG_ROUTER_V6)),
  );
  const domainSeparator = keccak_256(domainFields);

  // 4. Final hash: keccak256("\x19\x01" + domainSeparator + structHash)
  const prefix = new Uint8Array([0x19, 0x01]);
  const finalInput = catBytes(prefix, new Uint8Array(domainSeparator), new Uint8Array(structHash));
  const finalHash = keccak_256(finalInput);

  return toHex(finalHash);
}

/**
 * Build a complete Fusion+ order with extension from raw quote data.
 *
 * IMPLEMENTATION NOTE (Step 5, SDK-verified rewrite):
 * Every byte justified by reading the actual SDK source in node_modules:
 *   - @1inch/cross-chain-sdk: EscrowExtension, EvmCrossChainOrder, TimeLocks, HashLock
 *   - @1inch/fusion-sdk: FusionExtension, FusionOrder, AuctionDetails, Whitelist
 *   - @1inch/limit-order-sdk: Extension, LimitOrder, MakerTraits
 *
 * Key fixes from Steps 2-4 analysis:
 *   1. AuctionDetails: uint24 gasBump + uint32 gasPrice + uint32 startTime +
 *      uint24 duration + uint24 initialRateBump + uint8 pointsCount + (uint24 coeff + uint16 delay) × N
 *   2. makingAmountData = settlement(20) + auctionDetails + fees(6) + uint8(wlCount) + (bytes10 addr) × N
 *   3. takingAmountData = identical to makingAmountData
 *   4. postInteraction = settlement(20) + integrator(20) + protocol(20) + fees(6)
 *      + whitelist(5+12N) + crossChainData(160)
 *   5. crossChainData = ABI-encoded [hashLock, dstChainId, dstToken, packedDeposits, timeLocks] = 160 bytes
 *   6. takerAsset = TRUE_ERC20 (0xda0000d4000015a526378bb6fafc650cea5966f8), NOT dstToken
 *   7. salt = (random96 << 160) | (keccak256(extension.encode()) & UINT_160_MAX)
 *   8. MakerTraits: bits 251, 249 always; 254 only if allowMultipleFills=true (default false); nonce in [120,160) if bitInvalidatorMode
 *   9. All order struct fields are decimal strings (not hex for salt/makerTraits)
 *  10. receiver = escrowFactory (if fees) or 0x0 (if receiver==maker, no fees)
 *  11. customData = '0x' (empty for EVM→EVM)
 */
function buildServerSideOrder(
  rawQuote: Record<string, unknown>,
  hashLock: string,
  walletAddress: string,
  srcChainId: number,
  dstChainId: number,
): { order: Record<string, string>; extension: string; typedData: any; orderHash: string; diagnostics: Record<string, unknown> } | null {
  const diag: Record<string, unknown> = { method: "server-manual-ext-v6" };

  try {
    // ── Extract preset data ──
    const presets = rawQuote.presets as Record<string, any> | undefined;
    const recommended = (rawQuote.recommendedPreset as string) || "medium";
    const preset = presets?.[recommended];
    if (!preset) {
      diag.error = `No preset "${recommended}". Available: ${presets ? Object.keys(presets).join(",") : "none"}`;
      console.log(`${TAG} [EXT] ${diag.error}`);
      return null;
    }

    // ── Find escrow factory address ──
    // IMPLEMENTATION NOTE: SDK uses quote.srcEscrowFactory as the extension address.
    let escrowFactoryAddr = "";
    const addressFieldCandidates = [
      "srcEscrowFactory", "settlementAddress", "settlementContract",
      "escrowFactory", "srcSettlement", "settlement", "escrowAddress",
    ];
    for (const key of addressFieldCandidates) {
      const val = rawQuote[key];
      if (typeof val === "string" && /^0x[0-9a-fA-F]{40}$/i.test(val)) {
        escrowFactoryAddr = val.toLowerCase();
        diag.escrowSource = `rawQuote.${key}`;
        break;
      }
    }
    if (!escrowFactoryAddr) {
      for (const key of ["srcEscrowFactory", "settlementAddress", "escrowFactory"]) {
        const val = preset[key];
        if (typeof val === "string" && /^0x[0-9a-fA-F]{40}$/i.test(val)) {
          escrowFactoryAddr = val.toLowerCase();
          diag.escrowSource = `preset.${key}`;
          break;
        }
      }
    }

    const allQuoteKeys = Object.keys(rawQuote);
    const allPresetKeys = Object.keys(preset);
    diag.rawQuoteKeys = allQuoteKeys;
    diag.presetKeys = allPresetKeys;

    const addressLikeFields: Record<string, string> = {};
    for (const key of allQuoteKeys) {
      const val = rawQuote[key];
      if (typeof val === "string" && /^0x[0-9a-fA-F]{40}$/i.test(val)) {
        addressLikeFields[key] = val;
      }
    }
    diag.addressLikeFields = addressLikeFields;
    diag.timeLocks = rawQuote.timeLocks ?? "missing";
    diag.srcSafetyDeposit = rawQuote.srcSafetyDeposit ?? "missing";
    diag.dstSafetyDeposit = rawQuote.dstSafetyDeposit ?? "missing";
    diag.whitelist = rawQuote.whitelist ?? "missing";

    console.log(`${TAG} [EXT] Raw quote dump (2000 chars): ${JSON.stringify(rawQuote).slice(0, 2000)}`);
    console.log(`${TAG} [EXT] Address-like fields: ${JSON.stringify(addressLikeFields)}`);

    if (!escrowFactoryAddr) {
      // IMPLEMENTATION NOTE: Hardcoded fallback from SDK's deployments.js.
      // All chains except zkSync (324) use the same escrow factory address.
      escrowFactoryAddr = srcChainId === 324
        ? "0xd9085ac07da21bd6eb003a530a524ab054ca8652"
        : "0x03a25b3215a0e5c15cf23ac4d2e5cf86c0ff7efa";
      diag.escrowSource = "hardcoded-fallback";
      console.log(`${TAG} [EXT] No escrow factory in quote, using hardcoded fallback: ${escrowFactoryAddr}`);
    }

    console.log(`${TAG} [EXT] Using escrow factory: ${escrowFactoryAddr} (from ${diag.escrowSource})`);

    // ── Auction details ──
    const nowSec = Math.floor(Date.now() / 1000);
    const startAuctionIn = Number(preset.startAuctionIn) || 12;
    const startTime = nowSec + startAuctionIn;
    const duration = Number(preset.auctionDuration) || 180;
    const initialRateBump = Number(preset.initialRateBump) || 50000;
    const points = (preset.points || []) as { delay: number; coefficient: number }[];
    const gasBumpEstimate = Number(preset.gasCost?.gasBumpEstimate ?? preset.gasBumpEstimate ?? 0);
    const gasPriceEstimate = Number(preset.gasCost?.gasPriceEstimate ?? preset.gasPriceEstimate ?? 0);

    diag.auctionParams = { startTime, startAuctionIn, duration, initialRateBump, pointCount: points.length, gasBumpEstimate, gasPriceEstimate };
    const auctionBytes = encodeAuctionDetails(startTime, duration, initialRateBump, points, gasBumpEstimate, gasPriceEstimate);

    // ── Whitelist processing ──
    // IMPLEMENTATION NOTE (Step 5): Quote API returns whitelist as plain address strings.
    // Source: quote.js → response.whitelist.map((w) => EvmAddress.fromString(w))
    // Whitelist.new(resolvingStartTime, [{address, allowFrom}]) sorts by allowFrom ASC,
    // clamps to resolvingStartTime, then converts to relative delays.
    // Without exclusiveResolver, all allowFrom = 0 → clamped to resolvingStartTime → delay = 0.
    const rawWhitelist = (rawQuote.whitelist || []) as (string | { address: string; allowFrom?: number })[];
    const exclusiveResolver = preset.exclusiveResolver as string | undefined;
    const resolvingStartTime = nowSec; // SDK uses BigInt(now()) when not provided

    // Build whitelist entries with addressHalf (last 10 bytes) and delays
    const wlEntries: { addressHalf: string; delay: number; allowFrom: number }[] = [];
    for (const w of rawWhitelist) {
      const addr = typeof w === "string" ? w : w.address;
      if (!addr) continue;
      const addrHex = addr.replace(/^0x/i, "").toLowerCase();
      const addressHalf = addrHex.slice(-20); // last 20 hex chars = 10 bytes

      // Compute allowFrom: exclusive resolver gets 0, others get auctionStartTime
      let allowFrom = 0;
      if (exclusiveResolver) {
        const exclHex = exclusiveResolver.replace(/^0x/i, "").toLowerCase();
        const isExclusive = addrHex === exclHex;
        allowFrom = isExclusive ? 0 : startTime;
      }
      // Clamp: if allowFrom < resolvingStartTime, set to resolvingStartTime
      if (allowFrom < resolvingStartTime) allowFrom = resolvingStartTime;

      wlEntries.push({ addressHalf, delay: 0, allowFrom });
    }

    // Sort by allowFrom ASC, then compute relative delays
    wlEntries.sort((a, b) => a.allowFrom - b.allowFrom);
    let sumDelay = 0;
    for (const e of wlEntries) {
      const delay = e.allowFrom - resolvingStartTime - sumDelay;
      e.delay = Math.max(0, delay);
      sumDelay += e.delay;
    }

    diag.whitelistCount = wlEntries.length;
    diag.whitelistEntries = wlEntries.map(e => ({ addr: e.addressHalf.slice(0, 8) + "...", delay: e.delay }));

    // ── Fee bytes ──
    // IMPLEMENTATION NOTE: For our case without integrator/resolver fees, all zero.
    // whitelistDiscountNumerator = 100 (BASE_1E2 - 0 discount = 100)
    const feeInfo = rawQuote.feeInfo as Record<string, any> | undefined;
    let integratorFeeVal = 0, integratorShareVal = 0, resolverFeeVal = 0, whitelistDiscountNum = 100;
    let integratorReceiver = "0x0000000000000000000000000000000000000000";
    let protocolReceiver = "0x0000000000000000000000000000000000000000";
    if (feeInfo?.resolverFee) {
      // IMPLEMENTATION NOTE: SDK's Bps.toFraction(BASE_1E5) = bps_value * 100000 / 10000 = bps * 10
      resolverFeeVal = (Number(feeInfo.resolverFee.bps) || 0) * 10;
      if (feeInfo.resolverFee.receiver) protocolReceiver = feeInfo.resolverFee.receiver.toLowerCase();
      const discountPercent = Number(feeInfo.resolverFee.whitelistDiscountPercent) || 0;
      whitelistDiscountNum = 100 - Math.round(discountPercent);
    }
    if (feeInfo?.integratorFee) {
      // IMPLEMENTATION NOTE: SDK's Bps.toFraction(BASE_1E5) = bps * 10
      integratorFeeVal = (Number(feeInfo.integratorFee.bps) || 0) * 10;
      integratorShareVal = Math.round(Number(feeInfo.integratorFee.share) || 0);
      if (feeInfo.integratorFee.receiver) integratorReceiver = feeInfo.integratorFee.receiver.toLowerCase();
    }

    // IMPLEMENTATION NOTE: SDK's buildFees() returns undefined if BOTH fee values are zero.
    // FusionOrder sets receiver=escrowFactory only when buildFees() is truthy.
    const hasFees = resolverFeeVal > 0 || integratorFeeVal > 0;

    const feeBytes = encodeFeeBytes(integratorFeeVal, integratorShareVal, resolverFeeVal, whitelistDiscountNum);
    diag.feeBytes = { integratorFeeVal, integratorShareVal, resolverFeeVal, whitelistDiscountNum, hasFees };

    // ── Build makingAmountData / takingAmountData ──
    // IMPLEMENTATION NOTE (Step 5): FusionExtension.buildAmountGetterData(true):
    // = auctionDetails.encode() + fees(6) + uint8(wlCount) + (bytes10 addressHalf) × N
    // ExtensionBuilder.withMakingAmountData(address, data) → address.toString() + trim0x(data)
    // So: makingAmountData = escrowFactory(20) + auctionDetails + fees(6) + wlAddresses
    const escrowAddrBytes = hexBytes(escrowFactoryAddr);
    const wlAddressesOnly = encodeWhitelistAddressesOnly(wlEntries);
    const amountGetterData = catBytes(auctionBytes, feeBytes, wlAddressesOnly);
    const makingAmountData = catBytes(escrowAddrBytes, amountGetterData);
    const takingAmountData = catBytes(escrowAddrBytes, amountGetterData); // must be identical

    // ── Build postInteraction ──
    // IMPLEMENTATION NOTE (Step 5): EscrowExtension.build() produces:
    // extensionAddr(20) + integrator(20) + protocol(20) + feeAndWhitelist + crossChainData(160)
    //
    // Where feeAndWhitelist = buildAmountGetterData(false) =
    //   fees(6) + whitelist.encodeInto()
    //   whitelist.encodeInto() = uint32(resolvingStartTime) + uint8(count) + (bytes10 addr + uint16 delay) × N

    const whitelistEncoded = encodeWhitelist(resolvingStartTime, wlEntries);
    const feeAndWhitelist = catBytes(feeBytes, whitelistEncoded);

    // ── Cross-chain data (160 bytes) ──
    const srcSafetyDeposit = BigInt(rawQuote.srcSafetyDeposit as string || "0");
    const dstSafetyDeposit = BigInt(rawQuote.dstSafetyDeposit as string || "0");
    const timeLocks = rawQuote.timeLocks as Record<string, number> | undefined;
    const timeLocksValue = timeLocks ? packTimeLocks(timeLocks) : 0n;

    const dstTokenAddress = rawQuote.dstTokenAddress as string || "0x0000000000000000000000000000000000000000";
    const crossChainData = encodeCrossChainData(
      hashLock, dstChainId, dstTokenAddress,
      srcSafetyDeposit, dstSafetyDeposit, timeLocksValue,
    );

    diag.crossChainDataLen = crossChainData.length; // should be 160
    diag.timeLocksValue = timeLocksValue.toString(16);

    const integratorAddrBytes = hexBytes(integratorReceiver);
    const protocolAddrBytes = hexBytes(protocolReceiver);

    const postInteractionBytes = catBytes(
      escrowAddrBytes,      // 20 bytes — escrow factory
      integratorAddrBytes,  // 20 bytes — integrator fee receiver (0x0 if none)
      protocolAddrBytes,    // 20 bytes — protocol fee receiver (0x0 if none)
      feeAndWhitelist,      // fees(6) + whitelist(5 + 12*N)
      crossChainData,       // 160 bytes — ABI-encoded cross-chain params
    );

    // ── Pack LOP v4 extension ──
    // IMPLEMENTATION NOTE (Step 5): Extension.encode() from limit-order-sdk:
    // Fields ordered: [makerAssetSuffix, takerAssetSuffix, makingAmountData,
    //   takingAmountData, predicate, makerPermit, preInteraction, postInteraction]
    // encode() = 0x + offsets(64 hex) + concatenated fields + customData
    const fieldLengths = [
      0, // makerAssetSuffix
      0, // takerAssetSuffix
      makingAmountData.length,
      takingAmountData.length,
      0, // predicate
      0, // makerPermit
      0, // preInteraction
      postInteractionBytes.length,
    ];

    const offsetsHex = packExtOffsets(fieldLengths);
    const fieldsHex = bHex(makingAmountData) + bHex(takingAmountData) + bHex(postInteractionBytes);

    // customData = empty for EVM→EVM (SDK: encodeCustomData returns ZX/'0x')
    const extension = "0x" + offsetsHex + fieldsHex;

    diag.extensionLength = extension.length;
    diag.extensionByteCount = (extension.length - 2) / 2;
    diag.fieldLengths = fieldLengths;

    // ── Compute salt = (baseSalt << 160) | (keccak256(extension) & UINT_160_MAX) ──
    // IMPLEMENTATION NOTE (Step 5): LimitOrder.buildSalt() from limit-order-sdk.
    // extension.keccak256() = BigInt(keccak256(this.encode()))
    const extensionRawBytes = hexBytes(extension);
    const extensionHash = keccak_256(extensionRawBytes);
    const extensionHashBigInt = BigInt(toHex(extensionHash));
    const UINT_160_MAX = (1n << 160n) - 1n;
    const baseSalt = randomBaseSalt();
    const salt = (baseSalt << 160n) | (extensionHashBigInt & UINT_160_MAX);

    // ── Verify salt embeds extension hash (Step 6) ──
    // IMPLEMENTATION NOTE: This matches LimitOrder.verifySalt() from the SDK.
    // If this throws, we have an encoding bug — the on-chain contract would reject.
    verifySalt(salt, extension);

    diag.baseSalt = baseSalt.toString(16);
    diag.extensionHash = toHex(extensionHash).slice(0, 18) + "...";
    diag.saltVerified = true;

    // ── Build MakerTraits ──
    // IMPLEMENTATION NOTE (SDK-verified): FusionOrder.defaultExtra.allowMultipleFills = false.
    // Preset class assigns directly from API: this.allowMultipleFills = preset.allowMultipleFills.
    // The previous default of `true` was WRONG — caused bit 254 to be set incorrectly and
    // nonce to be omitted, producing a makerTraits mismatch vs relayer expectations.
    const allowMultipleFills = preset.allowMultipleFills === true; // default false (SDK verified)
    const allowPartialFills = preset.allowPartialFills !== false; // default true (SDK verified)
    const orderExpirationDelay = 12n; // SDK default
    const deadline = BigInt(startTime) + BigInt(duration) + orderExpirationDelay;

    // Nonce: required when partial or multiple fills disallowed (bit invalidator mode)
    // IMPLEMENTATION NOTE (SDK-verified): createEvmOrder uses randBigInt(UINT_40_MAX) for nonce.
    // Previous code used nowSec % 65535 (16-bit) — insufficient for the 40-bit nonce field.
    const isBitInvalidatorMode = !allowPartialFills || !allowMultipleFills;
    const nonce = isBitInvalidatorMode ? randomNonce40() : undefined;

    const makerTraits = packMakerTraits(deadline, nonce, allowMultipleFills, allowPartialFills);

    diag.makerTraitsBits = {
      deadline: deadline.toString(),
      nonce: nonce?.toString(),
      allowMultipleFills,
      allowPartialFills,
      isBitInvalidatorMode,
      presetAllowMultipleFills: preset.allowMultipleFills,
      presetAllowPartialFills: preset.allowPartialFills,
    };
    console.log(`${TAG} [EXT-v6] MakerTraits flags: allowMulti=${allowMultipleFills}(preset=${preset.allowMultipleFills}) allowPartial=${allowPartialFills}(preset=${preset.allowPartialFills}) bitInvalidator=${isBitInvalidatorMode} nonce=${nonce?.toString() ?? "none"} deadline=${deadline}`);

    // ── Build order struct ──
    // IMPLEMENTATION NOTE (Step 5): LimitOrder.build() produces ALL decimal strings.
    // takerAsset = TRUE_ERC20 (not dstTokenAddress!)
    // receiver = escrowFactory if fees exist, else 0x0 (optimized: receiver==maker → 0x0)
    const srcTokenAmount = rawQuote.srcTokenAmount as string;
    const auctionEndAmount = preset.auctionEndAmount as string;
    const takingAmountStr = auctionEndAmount || rawQuote.dstTokenAmount as string;
    let srcTokenAddress = rawQuote.srcTokenAddress as string;

    if (!srcTokenAmount || !takingAmountStr || !srcTokenAddress) {
      diag.error = `Missing order fields: srcAmt=${srcTokenAmount} takAmt=${takingAmountStr} srcTok=${srcTokenAddress}`;
      return null;
    }

    // IMPLEMENTATION NOTE (2026-03-04, Native ETH → WETH):
    // The create() escrow contract works with ERC20 tokens, not native ETH.
    // When the user swaps native ETH, the contract receives msg.value and wraps
    // it internally. The order's makerAsset must be WETH, not the native sentinel.
    // 1inch.com's MetaMask popup confirms: MakerAsset = WETH for native ETH swaps.
    const WETH_BY_CHAIN: Record<number, string> = {
      1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",       // Ethereum (WETH) — FIXED: was wrong address
      56: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",      // BNB Chain (WBNB)
      137: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",     // Polygon (WMATIC)
      42161: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",    // Arbitrum
      10: "0x4200000000000000000000000000000000000006",        // Optimism
      8453: "0x4200000000000000000000000000000000000006",      // Base
      43114: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",    // Avalanche (WAVAX)
    };
    if (srcTokenAddress.toLowerCase() === NATIVE_ADDRESS.toLowerCase()) {
      const wrappedAddr = WETH_BY_CHAIN[srcChainId];
      if (wrappedAddr) {
        console.log(`${TAG} [EXT-v6] Replacing native sentinel with WETH: ${wrappedAddr}`);
        srcTokenAddress = wrappedAddr;
        diag.nativeToWrapped = true;
      }
    }

    // TRUE_ERC20 address — same on all chains except zkSync
    const TRUE_ERC20 = srcChainId === 324
      ? "0xd66097c27eb8dee404bac235737932260edc6f3b"
      : "0xda0000d4000015a526378bb6fafc650cea5966f8";

    // IMPLEMENTATION NOTE: SDK's Address class ALWAYS lowercases (this.val = val.toLowerCase()).
    // The relayer may do exact string matching against its quote database.
    // All address fields in the order struct MUST be lowercase to match SDK behavior.

    // IMPLEMENTATION NOTE (2026-03-04, Matching 1inch.com):
    // 1inch.com sets Receiver == Maker (user's wallet) in all cases.
    // The LOP v4 spec says 0x0 means "same as maker", but the NativeOrderSettlement
    // create() contract may not implement this convention. Using explicit address
    // for parity with 1inch.com's behavior.
    const orderReceiver = walletAddress.toLowerCase();

    const order: Record<string, string> = {
      salt: salt.toString(),  // DECIMAL string (SDK: this.salt.toString())
      maker: walletAddress.toLowerCase(),
      receiver: orderReceiver,
      makerAsset: srcTokenAddress.toLowerCase(),
      takerAsset: TRUE_ERC20,  // already lowercase constant
      makingAmount: srcTokenAmount,
      takingAmount: takingAmountStr,
      makerTraits: makerTraits.toString(),  // DECIMAL string (SDK: asBigInt().toString())
    };

    diag.orderFields = {
      salt: order.salt.slice(0, 20) + "...",
      maker: order.maker,
      receiver: order.receiver,
      makerAsset: order.makerAsset,
      takerAsset: order.takerAsset,
      makingAmount: order.makingAmount,
      takingAmount: order.takingAmount,
      makerTraits: order.makerTraits.slice(0, 20) + "...",
    };

    // ── Build EIP-712 typed data ──
    const typedData = {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...LOP_ORDER_TYPES,
      },
      primaryType: "Order",
      domain: {
        name: "1inch Aggregation Router",
        version: "6",
        chainId: srcChainId,
        verifyingContract: AGG_ROUTER_V6,
      },
      message: order,
    };

    // ── Compute order hash (proper EIP-712) ──
    // IMPLEMENTATION NOTE (Step 6): Replaced simplified JSON hash with proper
    // EIP-712 hash matching ethers.TypedDataEncoder.hash(). This is critical:
    // the relayer expects this exact hash, and MetaMask produces it when signing.
    const orderHash = computeEIP712OrderHash(order, srcChainId);

    // ── Diagnostics logging ──
    const totalDataBytes = fieldLengths.reduce((s, l) => s + l, 0);
    const makingLen = makingAmountData.length;
    const takingLen = takingAmountData.length;
    const postLen = postInteractionBytes.length;

    console.log(`${TAG} [EXT-v6] Server-side order built: ext=${extension.length} chars (${(extension.length - 2) / 2} bytes), wl=${wlEntries.length} resolvers, auction=${duration}s`);
    console.log(`${TAG} [EXT-v6] Field bytes: making=${makingLen} taking=${takingLen} post=${postLen} total=${totalDataBytes}`);
    console.log(`${TAG} [EXT-v6] Auction: header=18 + ${points.length}*5pts = ${auctionBytes.length} bytes`);
    console.log(`${TAG} [EXT-v6] Whitelist: ${wlEntries.length} entries, encoded=${whitelistEncoded.length} bytes (5+12*${wlEntries.length}=${5 + 12 * wlEntries.length})`);
    console.log(`${TAG} [EXT-v6] CrossChainData: ${crossChainData.length} bytes (expected 160)`);
    console.log(`${TAG} [EXT-v6] PostInteraction breakdown: escrow(20) + integrator(20) + protocol(20) + fees(${feeBytes.length}) + whitelist(${whitelistEncoded.length}) + cc(${crossChainData.length}) = ${postLen}`);
    console.log(`${TAG} [EXT-v6] Salt: baseSalt=${baseSalt.toString(16).slice(0, 12)}... extHash=${toHex(extensionHash).slice(0, 18)}... verified=true final=${order.salt.slice(0, 20)}...`);
    console.log(`${TAG} [EXT-v6] MakerTraits: ${order.makerTraits.slice(0, 20)}... takerAsset=${order.takerAsset} receiver=${order.receiver}`);
    console.log(`${TAG} [EXT-v6] Addresses (all lowercase): maker=${order.maker} makerAsset=${order.makerAsset} takerAsset=${order.takerAsset}`);
    console.log(`${TAG} [EXT-v6] Fees: intFee=${integratorFeeVal} intShare=${integratorShareVal} resFee=${resolverFeeVal} wlDiscount=${whitelistDiscountNum} hasFees=${hasFees}`);
    console.log(`${TAG} [EXT-v6] EIP-712 orderHash: ${orderHash}`);

    return { order, extension, typedData, orderHash, diagnostics: diag };
  } catch (err: any) {
    diag.error = err?.message;
    console.log(`${TAG} [EXT-v6] Server-side order construction failed: ${err?.message}`);
    console.log(`${TAG} [EXT-v6] Stack: ${err?.stack?.slice(0, 500)}`);
    return null;
  }
}

// =======================================================================
// Direct API Flow (Fallback when SDK unavailable)
//
// IMPLEMENTATION NOTE: This flow calls the 1inch API directly without
// the SDK. The quoter v1.2 /quote/receive endpoint returns the full
// cross-chain quote including preset data (auction params, amounts).
//
// The critical difference from Rounds 1-6: we do NOT call /quote/build.
// Instead, we construct a minimal order structure from the quote response
// and submit directly to the relayer with the required fields.
//
// The relayer v1.2 /submit endpoint expects:
//   { srcChainId, order, signature, quoteId, extension, secretHashes? }
//
// If the SDK is unavailable, we return the raw quote data to the client
// along with instructions for the client to construct the order. This is
// the "thin server" approach — the server proxies API calls (with the key),
// but order construction happens client-side (where the SDK runs natively).
// =======================================================================

interface DirectQuoteResult {
  success: boolean;
  quoteId?: string;
  srcTokenAmount?: string;
  dstTokenAmount?: string;
  presets?: Record<string, unknown>;
  recommendedPreset?: string;
  // IMPLEMENTATION NOTE: The full raw response is included so the client-side
  // order builder always has token addresses even if the API doesn't echo them.
  rawQuote?: Record<string, unknown>;
  // Fields for order construction (if available in v1.2 response)
  order?: unknown;
  extension?: string;
  typedData?: unknown;
  error?: string;
  _apiVersion?: string;
}

/**
 * Get a cross-chain quote via the v1.2 quoter endpoint.
 *
 * IMPLEMENTATION NOTE: v1.2 is the version used by the official SDK.
 * We try both v1.2 and v1.0 (which we know works from earlier rounds).
 */
async function getDirectQuote(
  srcChainId: number,
  dstChainId: number,
  srcTokenAddress: string,
  dstTokenAddress: string,
  amount: string,
  walletAddress: string,
  hashLock: string,
): Promise<DirectQuoteResult> {
  // Build query params matching the SDK's QuoterRequest format
  const qs = new URLSearchParams({
    srcChain: String(srcChainId),
    dstChain: String(dstChainId),
    srcTokenAddress,
    dstTokenAddress,
    amount,
    walletAddress,
    enableEstimate: "true",
  });

  // Trial 1: v1.2 (SDK version)
  const v12Url = `${QUOTER_BASE}/quote/receive?${qs.toString()}`;
  console.log(`${TAG} [QUOTE] Trying v1.2: GET ${v12Url.slice(0, 140)}...`);
  const v12Result = await apiFetch("GET", v12Url);

  if (v12Result.status === 200 && v12Result.body.quoteId) {
    console.log(`${TAG} [QUOTE] v1.2 SUCCESS: quoteId=${(v12Result.body.quoteId as string).slice(0, 30)}... keys=[${Object.keys(v12Result.body).join(",")}]`);
    // IMPLEMENTATION NOTE: Enrich rawQuote with request params so the client-side
    // order builder always has token addresses even if the API doesn't echo them.
    const enriched12 = { ...v12Result.body, srcTokenAddress, dstTokenAddress, srcChain: srcChainId, dstChain: dstChainId, walletAddress };
    return {
      success: true,
      quoteId: v12Result.body.quoteId as string,
      srcTokenAmount: v12Result.body.srcTokenAmount as string,
      dstTokenAmount: v12Result.body.dstTokenAmount as string,
      presets: v12Result.body.presets as Record<string, unknown>,
      recommendedPreset: v12Result.body.recommendedPreset as string,
      rawQuote: enriched12,
      _apiVersion: "v1.2",
    };
  }

  console.log(`${TAG} [QUOTE] v1.2 failed (${v12Result.status}), trying v1.0...`);

  // Trial 2: v1.0 (known working from previous rounds)
  const v10Url = `https://api.1inch.dev/fusion-plus/quoter/v1.0/quote/receive?${qs.toString()}`;
  const v10Result = await apiFetch("GET", v10Url);

  if (v10Result.status === 200 && v10Result.body.quoteId) {
    console.log(`${TAG} [QUOTE] v1.0 SUCCESS: quoteId=${(v10Result.body.quoteId as string).slice(0, 30)}... keys=[${Object.keys(v10Result.body).join(",")}]`);
    const enriched10 = { ...v10Result.body, srcTokenAddress, dstTokenAddress, srcChain: srcChainId, dstChain: dstChainId, walletAddress };
    return {
      success: true,
      quoteId: v10Result.body.quoteId as string,
      srcTokenAmount: v10Result.body.srcTokenAmount as string,
      dstTokenAmount: v10Result.body.dstTokenAmount as string,
      presets: v10Result.body.presets as Record<string, unknown>,
      recommendedPreset: v10Result.body.recommendedPreset as string,
      rawQuote: enriched10,
      _apiVersion: "v1.0",
    };
  }

  return {
    success: false,
    error: `Both v1.2 and v1.0 quoter failed. v1.2: HTTP ${v12Result.status} — ${JSON.stringify(v12Result.body).slice(0, 300)}. v1.0: HTTP ${v10Result.status} — ${JSON.stringify(v10Result.body).slice(0, 300)}`,
  };
}

// =======================================================================
// SDK-Based Order Construction
//
// IMPLEMENTATION NOTE: When the SDK is available, we use it to:
// 1. Create a proper SDK instance with the API key
// 2. Get a quote via the SDK's quoter
// 3. Construct the order via quote.createEvmOrder({hashLock})
// 4. Extract EIP-712 typed data for client-side signing
//
// The SDK handles all the complex bit-packing for MakerTraits,
// extension encoding, resolver whitelist, and auction parameters.
// =======================================================================

interface SdkOrderResult {
  success: boolean;
  /** True when quote was obtained but order/typedData must be constructed client-side */
  needsClientConstruction?: boolean;
  method: "sdk" | "direct-v1.2" | "direct-v1.0";
  // Order data for signing
  typedData?: unknown;
  order?: unknown;
  orderHash?: string;
  extension?: string;
  quoteId?: string;
  // Quote data
  srcTokenAmount?: string;
  dstTokenAmount?: string;
  recommendedPreset?: string;
  // Raw data for debugging
  rawQuote?: Record<string, unknown>;
  // Error info
  error?: string;
  _diagnostics?: unknown;
}

async function buildOrderViaSdk(
  srcChainId: number,
  dstChainId: number,
  srcTokenAddress: string,
  dstTokenAddress: string,
  amount: string,
  walletAddress: string,
  hashLock: string,
  secretHash: string,
): Promise<SdkOrderResult> {
  const sdk = await ensureSdkLoaded();

  if (sdk) {
    try {
      console.log(`${TAG} [SDK-ORDER] Attempting SDK-based order construction...`);
      console.log(`${TAG} [SDK-ORDER] SDK exports: [${Object.keys(sdk).slice(0, 20).join(", ")}]`);

      // IMPLEMENTATION NOTE: The SDK's constructor and API may vary by version.
      // We try the most common patterns: SDK class, HashLock utility, etc.
      // If the SDK API doesn't match, we fall through to direct API flow.

      const apiKey = getApiKey();
      if (!apiKey) {
        return { success: false, method: "sdk", error: "ONEINCH_API_KEY not configured" };
      }

      // Attempt to use the SDK's main class
      // The SDK typically exports: SDK, HashLock, NetworkEnum, PresetEnum
      const SdkClass = sdk.SDK || sdk.default?.SDK || sdk.CrossChainSdk || sdk.default;

      if (typeof SdkClass === "function") {
        console.log(`${TAG} [SDK-ORDER] Found SDK class: ${SdkClass.name}`);

        // IMPLEMENTATION NOTE: The SDK constructor typically takes:
        // { url: string, authKey: string } or { blockchainProvider, ... }
        // We try the simplest constructor first.
        let sdkInstance: any;
        try {
          sdkInstance = new SdkClass({
            url: "https://api.1inch.dev/fusion-plus",
            authKey: apiKey,
          });
        } catch (e1: any) {
          console.log(`${TAG} [SDK-ORDER] Constructor pattern 1 failed: ${e1?.message}`);
          try {
            // Alternative constructor pattern
            sdkInstance = SdkClass.new({
              authKey: apiKey,
            });
          } catch (e2: any) {
            console.log(`${TAG} [SDK-ORDER] Constructor pattern 2 failed: ${e2?.message}`);
          }
        }

        if (sdkInstance) {
          console.log(`${TAG} [SDK-ORDER] SDK instance created. Methods: [${Object.getOwnPropertyNames(Object.getPrototypeOf(sdkInstance)).join(", ")}]`);

          // Try to get quote and create order via SDK
          try {
            // The SDK's getQuote method
            const getQuote = sdkInstance.getQuote || sdkInstance.getQuoteAndOrder;
            if (typeof getQuote === "function") {
              const quoteResult = await getQuote.call(sdkInstance, {
                srcChainId,
                dstChainId,
                srcTokenAddress,
                dstTokenAddress,
                amount,
                walletAddress,
                enableEstimate: true,
              });

              console.log(`${TAG} [SDK-ORDER] SDK quote result type: ${typeof quoteResult}, keys: [${quoteResult ? Object.keys(quoteResult).slice(0, 15).join(", ") : "null"}]`);

              // Try to create the EVM order from the quote
              if (quoteResult && typeof quoteResult.createEvmOrder === "function") {
                const HashLockClass = sdk.HashLock;
                let hashLockObj: any;

                if (HashLockClass && typeof HashLockClass.forSingleFill === "function") {
                  // Use SDK's HashLock utility
                  hashLockObj = HashLockClass.forSingleFill(hashLock);
                  console.log(`${TAG} [SDK-ORDER] Used HashLock.forSingleFill()`);
                } else {
                  // Pass raw hashLock
                  hashLockObj = hashLock;
                }

                const evmOrder = quoteResult.createEvmOrder({ hashLock: hashLockObj });

                console.log(`${TAG} [SDK-ORDER] Order created. Type: ${typeof evmOrder}, keys: [${evmOrder ? Object.keys(evmOrder).slice(0, 15).join(", ") : "null"}]`);

                // Extract typed data for EIP-712 signing
                const typedData = evmOrder.getTypedData?.() || evmOrder.typedData;
                const order = evmOrder.order || evmOrder;
                const extension = evmOrder.extension || evmOrder.getExtension?.();
                const orderHash = evmOrder.getOrderHash?.() || evmOrder.orderHash;
                const quoteId = quoteResult.quoteId;

                return {
                  success: true,
                  method: "sdk",
                  typedData,
                  order,
                  orderHash,
                  extension: typeof extension === "string" ? extension : JSON.stringify(extension),
                  quoteId,
                  srcTokenAmount: quoteResult.srcTokenAmount,
                  dstTokenAmount: quoteResult.dstTokenAmount,
                  recommendedPreset: quoteResult.recommendedPreset,
                  rawQuote: quoteResult,
                };
              }
            }
          } catch (sdkErr: any) {
            console.log(`${TAG} [SDK-ORDER] SDK order construction failed: ${sdkErr?.message}`);
            console.log(`${TAG} [SDK-ORDER] Stack: ${sdkErr?.stack?.slice(0, 500)}`);
          }
        }
      } else {
        console.log(`${TAG} [SDK-ORDER] No SDK class found in exports. Available: [${Object.keys(sdk).join(", ")}]`);
      }
    } catch (sdkErr: any) {
      console.log(`${TAG} [SDK-ORDER] SDK flow failed: ${sdkErr?.message}`);
    }
  }

  // ── Fallback: Direct API flow ──
  // Get quote via direct API, return raw data for client-side order construction
  console.log(`${TAG} [SDK-ORDER] Falling back to direct API flow...`);

  const quoteResult = await getDirectQuote(
    srcChainId, dstChainId,
    srcTokenAddress, dstTokenAddress,
    amount, walletAddress, hashLock,
  );

  if (!quoteResult.success) {
    return {
      success: false,
      method: "direct-v1.0",
      error: quoteResult.error,
    };
  }

  // IMPLEMENTATION NOTE (SDK Adoption Fix, 2026-03-03): The quoter API returns
  // quote data but NOT pre-built order/typedData. That's expected — the SDK
  // constructs orders from the quote. We now try server-side order construction
  // FIRST (manual extension encoding), falling through to client-side only if
  // the server can't find the settlement address.
  const rawQuote = quoteResult.rawQuote || {};
  const hasOrder = !!rawQuote.order;
  const hasTypedData = !!rawQuote.typedData;
  const hasExtension = !!rawQuote.extension;

  console.log(`${TAG} [SDK-ORDER] Direct quote has pre-built data: order=${hasOrder} typedData=${hasTypedData} extension=${hasExtension}`);

  // ── Try server-side order construction with manual extension encoding ──
  // IMPLEMENTATION NOTE: This is the key fix for "extension can not be empty".
  // We build the LOP v4 extension from the quote's preset data, whitelist,
  // and hashlock. The settlement/escrow address must be in the quote response.
  if (!hasOrder || !hasTypedData) {
    console.log(`${TAG} [SDK-ORDER] Attempting server-side manual order construction...`);
    const serverOrder = buildServerSideOrder(rawQuote, hashLock, walletAddress, srcChainId, dstChainId);

    if (serverOrder) {
      console.log(`${TAG} [SDK-ORDER] Server-side order BUILT: ext=${serverOrder.extension.length} chars`);
      return {
        success: true,
        needsClientConstruction: false,
        method: quoteResult._apiVersion === "v1.2" ? "direct-v1.2" : "direct-v1.0",
        typedData: serverOrder.typedData,
        order: serverOrder.order,
        orderHash: serverOrder.orderHash,
        extension: serverOrder.extension,
        quoteId: quoteResult.quoteId,
        srcTokenAmount: quoteResult.srcTokenAmount,
        dstTokenAmount: quoteResult.dstTokenAmount,
        recommendedPreset: quoteResult.recommendedPreset,
        rawQuote: quoteResult.rawQuote,
        _diagnostics: {
          sdkAvailable: !!sdkModule,
          sdkImportError,
          apiVersion: quoteResult._apiVersion,
          quoteKeys: Object.keys(rawQuote),
          serverOrderBuilt: true,
          ...serverOrder.diagnostics,
          note: "Order + extension built server-side (manual encoding). Settlement address found in quote response.",
        },
      };
    } else {
      console.log(`${TAG} [SDK-ORDER] Server-side order construction failed. Falling through to client-side.`);
    }
  }

  // ── Final fallback: return raw quote for client-side construction ──
  return {
    success: true,
    needsClientConstruction: !(hasOrder && hasTypedData),
    method: quoteResult._apiVersion === "v1.2" ? "direct-v1.2" : "direct-v1.0",
    typedData: rawQuote.typedData || null,
    order: rawQuote.order || null,
    orderHash: rawQuote.orderHash as string || undefined,
    extension: rawQuote.extension as string || undefined,
    quoteId: quoteResult.quoteId,
    srcTokenAmount: quoteResult.srcTokenAmount,
    dstTokenAmount: quoteResult.dstTokenAmount,
    recommendedPreset: quoteResult.recommendedPreset,
    rawQuote: quoteResult.rawQuote,
    _diagnostics: {
      sdkAvailable: !!sdkModule,
      sdkImportError,
      apiVersion: quoteResult._apiVersion,
      quoteKeys: Object.keys(rawQuote),
      hasPreBuiltOrder: hasOrder,
      hasPreBuiltTypedData: hasTypedData,
      hasPreBuiltExtension: hasExtension,
      serverOrderAttempted: true,
      serverOrderFailed: true,
      note: "Server-side order construction failed (likely missing settlement address). " +
            "Client must construct via @1inch/cross-chain-sdk createEvmOrder({hashLock}). " +
            "Check server logs for raw quote dump — the settlement address field name may differ.",
    },
  };
}

// =======================================================================
// Route Registration
// =======================================================================

export function registerFusionPlusSdkRoutes(app: Hono) {

  // ── POST /1inch/fusion-plus/sdk-order ──────────────────────────────
  // Get a cross-chain quote AND construct the order for signing.
  //
  // Request body:
  //   { srcChainId, dstChainId, srcTokenAddress, dstTokenAddress,
  //     amount, walletAddress, hashLock, secretHash? }
  //
  // IMPLEMENTATION NOTE: hashLock is generated CLIENT-SIDE from the
  // HTLC secret. The secret itself is NEVER sent to this endpoint.
  // The server only needs the hashLock to embed in the order.
  //
  // Response (success):
  //   { success: true, method: "sdk"|"direct-v1.2"|"direct-v1.0",
  //     typedData, order, orderHash, extension, quoteId, ... }
  //
  // Response (failure):
  //   { success: false, error: "...", _diagnostics: {...} }
  app.post(`${PREFIX}/fusion-plus/sdk-order`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    // SECURITY AUDIT T1-A: requireAuth() prevents anonymous API key quota abuse
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;

    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }

    // Validate inputs
    const srcChainId = typeof body.srcChainId === "number" ? body.srcChainId : NaN;
    const dstChainId = typeof body.dstChainId === "number" ? body.dstChainId : NaN;
    if (!FUSION_PLUS_CHAINS.has(srcChainId)) return c.json({ error: `Fusion+ not supported on src chain ${srcChainId}` }, 400);
    if (!FUSION_PLUS_CHAINS.has(dstChainId)) return c.json({ error: `Fusion+ not supported on dst chain ${dstChainId}` }, 400);
    if (srcChainId === dstChainId) return c.json({ error: "Source and destination chains must differ" }, 400);
    if (!isValidEthAddress(body.srcTokenAddress)) return c.json({ error: "Invalid srcTokenAddress" }, 400);
    if (!isValidEthAddress(body.dstTokenAddress)) return c.json({ error: "Invalid dstTokenAddress" }, 400);
    if (typeof body.amount !== "string" || !/^\d+$/.test(body.amount)) return c.json({ error: "Invalid amount" }, 400);
    if (!isValidWalletAddress(body.walletAddress)) return c.json({ error: "Invalid walletAddress" }, 400);
    if (!isValidHashLock(body.hashLock)) return c.json({ error: "Invalid hashLock — must be 0x + 64 hex chars" }, 400);

    // Lowercase all addresses (matching SDK's Address class behavior)
    // IMPLEMENTATION NOTE: SDK's Address class always lowercases. The quote API may store
    // the wallet address and later compare it against the order's maker field. Both must match.
    const cWallet = (body.walletAddress as string).toLowerCase();
    const cSrc = (body.srcTokenAddress as string).toLowerCase();
    const cDst = (body.dstTokenAddress as string).toLowerCase();

    const amt = body.amount as string;
    const hashLock = body.hashLock as string;
    const secretHash = (typeof body.secretHash === "string" && HEX_64_RE.test(body.secretHash)) ? body.secretHash : undefined;

    console.log(`${TAG} [SDK-ORDER] ${srcChainId}→${dstChainId} amt=${amt} wallet=${cWallet.slice(0, 10)}... hashLock=${hashLock.slice(0, 18)}...`);

    const result = await buildOrderViaSdk(
      srcChainId, dstChainId, cSrc, cDst, amt, cWallet,
      hashLock, secretHash || hashLock,
    );

    if (result.success) {
      const clientNote = result.needsClientConstruction ? " (needsClientConstruction=true, no typedData)" : "";
      console.log(`${TAG} [SDK-ORDER] SUCCESS via ${result.method}: quoteId=${result.quoteId?.slice(0, 20)}... orderHash=${result.orderHash?.slice(0, 18) ?? "pending"}${clientNote}`);
      return c.json(result, 200);
    }

    console.log(`${TAG} [SDK-ORDER] FAILED: ${result.error?.slice(0, 200)}`);
    return c.json(result, 502);
  });

  // ── POST /1inch/fusion-plus/sdk-submit ─────────────────────────────
  // Submit a signed cross-chain order to the Fusion+ relayer.
  //
  // IMPLEMENTATION NOTE: This endpoint accepts the order + signature
  // from the client and forwards to POST /relayer/v1.2/submit.
  // The body format matches the SDK's relayer submission:
  //   { srcChainId, order, signature, quoteId, extension, secretHashes? }
  //
  // For single-fill orders (1 secret), secretHashes is omitted (per SDK).
  app.post(`${PREFIX}/fusion-plus/sdk-submit`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    // SECURITY AUDIT T1-A: requireAuth() prevents anonymous API key quota abuse
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;

    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }

    // Validate required fields
    if (typeof body.srcChainId !== "number" || !FUSION_PLUS_CHAINS.has(body.srcChainId)) {
      return c.json({ error: "Invalid srcChainId" }, 400);
    }
    if (!body.order) return c.json({ error: "Missing order" }, 400);
    if (typeof body.signature !== "string" || !body.signature) return c.json({ error: "Missing signature" }, 400);
    if (typeof body.quoteId !== "string" || !body.quoteId) return c.json({ error: "Missing quoteId" }, 400);

    // Build the relayer submission payload
    // IMPLEMENTATION NOTE (SDK pattern): secretHashes is omitted for single-fill
    // orders. The SDK does: secretHashes.length === 1 ? undefined : secretHashes
    const submitPayload: Record<string, unknown> = {
      srcChainId: body.srcChainId,
      order: body.order,
      signature: body.signature,
      quoteId: body.quoteId,
    };
    if (typeof body.extension === "string" && body.extension) {
      submitPayload.extension = body.extension;
    }
    if (Array.isArray(body.secretHashes) && body.secretHashes.length > 1) {
      // Only include secretHashes for multi-fill (2+ secrets)
      submitPayload.secretHashes = body.secretHashes;
    }

    const submitUrl = `${RELAYER_BASE}/submit`;
    console.log(`${TAG} [SDK-SUBMIT] POST ${submitUrl} payload keys=[${Object.keys(submitPayload).join(",")}] srcChain=${body.srcChainId} quoteId=${(body.quoteId as string).slice(0, 20)}...`);
    // IMPLEMENTATION NOTE: Log full order struct for debugging makerTraits/receiver/salt mismatches
    console.log(`${TAG} [SDK-SUBMIT] Order struct: ${JSON.stringify(body.order).slice(0, 1500)}`);
    console.log(`${TAG} [SDK-SUBMIT] Signature (first 40): ${(body.signature as string).slice(0, 40)}...`);

    // IMPLEMENTATION NOTE: Log the extension hex for debugging byte count mismatches.
    // The relayer error "Can not consume X bytes, have only Y" refers to extension data size.
    const extHex = typeof submitPayload.extension === "string" ? submitPayload.extension : "none";
    const extDataBytes = extHex.startsWith("0x") ? (extHex.length - 2) / 2 : 0;
    const extBodyBytes = extDataBytes > 32 ? extDataBytes - 32 : 0; // subtract 32-byte offsets
    console.log(`${TAG} [SDK-SUBMIT] Extension: ${extHex.length} hex chars, ${extDataBytes} total bytes, ${extBodyBytes} body bytes (after offsets)`);
    console.log(`${TAG} [SDK-SUBMIT] Extension hex (first 300 chars): ${extHex.slice(0, 300)}`);

    // IMPLEMENTATION NOTE: Log signature length to verify native vs ERC20 format.
    // Native: ABI-encoded 8×uint256 = 256 bytes = 514 hex chars ("0x"+512).
    // ERC20: EIP-712 sig = 65 bytes = 132 hex chars ("0x"+130).
    const sigHex = body.signature as string;
    const sigBytes = sigHex.startsWith("0x") ? (sigHex.length - 2) / 2 : sigHex.length / 2;
    const sigType = sigBytes === 256 ? "NATIVE(ABI-order)" : sigBytes === 65 ? "ERC20(EIP-712)" : `UNEXPECTED(${sigBytes}b)`;
    console.log(`${TAG} [SDK-SUBMIT] Signature: ${sigBytes} bytes = ${sigType}`);
    console.log(`${TAG} [SDK-SUBMIT] Full payload JSON (3000ch): ${JSON.stringify(submitPayload).slice(0, 3000)}`);

    const { status, body: resBody } = await apiFetch("POST", submitUrl, JSON.stringify(submitPayload), 25_000);

    if (status === 200) {
      console.log(`${TAG} [SDK-SUBMIT] SUCCESS (v1.2): ${JSON.stringify(resBody).slice(0, 500)}`);
    } else {
      console.log(`${TAG} [SDK-SUBMIT] FAILED (${status}): ${JSON.stringify(resBody).slice(0, 2000)}`);

      // IMPLEMENTATION NOTE: If v1.2 submit fails, try v1.0 as fallback
      const v10SubmitUrl = `https://api.1inch.dev/fusion-plus/relayer/v1.0/submit`;
      console.log(`${TAG} [SDK-SUBMIT] Trying v1.0 fallback: POST ${v10SubmitUrl}`);
      const v10Result = await apiFetch("POST", v10SubmitUrl, JSON.stringify(submitPayload), 25_000);
      if (v10Result.status === 200) {
        console.log(`${TAG} [SDK-SUBMIT] v1.0 SUCCESS: ${JSON.stringify(v10Result.body).slice(0, 300)}`);
        return c.json({ ...v10Result.body, _relayerVersion: "v1.0" }, 200);
      }
      console.log(`${TAG} [SDK-SUBMIT] v1.0 also FAILED (${v10Result.status}): ${JSON.stringify(v10Result.body).slice(0, 2000)}`);

      // IMPLEMENTATION NOTE: Surface the relayer's actual rejection reason so the
      // frontend can display it — previously this was lost in the error chain.
      // Priority: details (extracted by apiFetch) > description > message > error (generic wrapper)
      const v12Reason = typeof resBody?.details === "string" ? resBody.details
        : typeof resBody?.description === "string" ? resBody.description
        : typeof resBody?.message === "string" ? resBody.message
        : typeof resBody?.error === "string" && resBody.error !== "1inch API error" ? resBody.error
        : JSON.stringify(resBody).slice(0, 300);
      const v10Reason = typeof v10Result.body?.details === "string" ? v10Result.body.details
        : typeof v10Result.body?.description === "string" ? v10Result.body.description
        : typeof v10Result.body?.message === "string" ? v10Result.body.message
        : typeof v10Result.body?.error === "string" && v10Result.body.error !== "1inch API error" ? v10Result.body.error
        : JSON.stringify(v10Result.body).slice(0, 300);

      return c.json({
        error: "Relayer submission failed",
        details: `v1.2 (${status}): ${v12Reason} | v1.0 (${v10Result.status}): ${v10Reason}`,
        _validationErrors: resBody?._validationErrors ?? v10Result.body?._validationErrors ?? null,
        v12: { status, body: resBody },
        v10: { status: v10Result.status, body: v10Result.body },
      }, status as any);
    }

    return c.json({ ...resBody, _relayerVersion: "v1.2" }, 200);
  });

  // ── GET /1inch/fusion-plus/sdk-health ──────────────────────────────
  // Diagnostics endpoint — reports SDK availability, import status,
  // and tests the v1.2 quoter connectivity.
  app.get(`${PREFIX}/fusion-plus/sdk-health`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    // Ensure SDK import has been attempted
    await ensureSdkLoaded();

    const apiKey = getApiKey();

    const health: Record<string, unknown> = {
      sdkImported: !!sdkModule,
      sdkImportError,
      sdkExports: sdkModule ? Object.keys(sdkModule).slice(0, 30) : null,
      apiKeyConfigured: !!apiKey,
      relayerBaseUrl: RELAYER_BASE,
      quoterBaseUrl: QUOTER_BASE,
      fusionPlusChains: Array.from(FUSION_PLUS_CHAINS),
      timestamp: new Date().toISOString(),
    };

    // IMPLEMENTATION NOTE: Self-test CREATE2 proxy address computation against SDK test vectors.
    // Confirms computeProxyBytecodeHash + computeCreate2Address match the SDK's ProxyFactory.
    try {
      const tv1Factory = "0x4bc5a9d205adf1091d596bc2e1aa0d6b9dc3b12c";
      const tv1Impl = "0xfbc2d33fc6c7fadb155974b847dc04f39010caa9";
      const tv1Salt = "0x3fccfe0035a1010d48c1573e1fc78290082e778619ddb01429af83b5f3faf29c";
      const tv1Expected = "0x762bef5aa97185121b080f6cacb58901fe1e7751";
      const tv1Bytecode = computeProxyBytecodeHash(tv1Impl);
      const tv1Result = computeCreate2Address(tv1Factory, tv1Salt, tv1Bytecode);
      const tv2Factory = "0x584aeab186d81dbb52a8a14820c573480c3d4773";
      const tv2Impl = "0xddc60c7babfc55d8030f51910b157e179f7a41fc";
      const tv2Salt = "0x7d1798e1fe1eef8c94c50886f476477781a4d56f4126ae8a3a88f5546649d153";
      const tv2Expected = "0xf81af95bb417a82923e5fa001b1e052034026e64";
      const tv2Bytecode = computeProxyBytecodeHash(tv2Impl);
      const tv2Result = computeCreate2Address(tv2Factory, tv2Salt, tv2Bytecode);
      health.create2SelfTest = {
        test1: { expected: tv1Expected, got: tv1Result, pass: tv1Result === tv1Expected },
        test2: { expected: tv2Expected, got: tv2Result, pass: tv2Result === tv2Expected },
      };
    } catch (e: any) {
      health.create2SelfTest = { error: e?.message };
    }

    // Test v1.2 quoter connectivity (lightweight: just check if endpoint responds)
    if (apiKey) {
      try {
        // IMPLEMENTATION NOTE: We test connectivity by making a minimal request
        // that we expect to fail with a validation error (not a 404 or 401).
        // A validation error proves the endpoint exists and our API key works.
        const testUrl = `${QUOTER_BASE}/quote/receive?srcChain=1&dstChain=8453&srcTokenAddress=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&dstTokenAddress=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&amount=1000000000000000&walletAddress=0x0000000000000000000000000000000000000001&enableEstimate=false`;
        const testResult = await apiFetch("GET", testUrl, null, 10_000);
        health.v12QuoterTest = {
          status: testResult.status,
          // A 200 or 400 (validation error) both prove the endpoint is alive
          alive: testResult.status === 200 || testResult.status === 400,
          responseKeys: Object.keys(testResult.body).slice(0, 10),
          snippet: JSON.stringify(testResult.body).slice(0, 300),
        };
      } catch (err: any) {
        health.v12QuoterTest = { alive: false, error: err?.message };
      }
    }

    return c.json(health, 200);
  });

  // ── POST /1inch/fusion-plus/create-tx ──────────────────────────────
  // IMPLEMENTATION NOTE (2026-03-04, SDK-verified rewrite):
  //
  // After studying every file in the 1inch SDKs (cross-chain-sdk, limit-order-sdk,
  // fusion-sdk), the root cause of the "likely to fail" revert was identified:
  //
  // WRONG: We were calling create(Order, bytes extension) on EscrowFactory (0x03a25b...)
  // RIGHT: Native ETH orders call create(Order) on NativeOrderFactory (0xe12e0f...)
  //        ERC20 orders don't use create() at all — they use EIP-712 sign + relayer submit
  //
  // SDK flow for NATIVE ETH cross-chain:
  //   1. Build order with user as maker, makerAsset = WETH
  //   2. Compute EIP-712 order hash (temp order)
  //   3. Compute proxy address = CREATE2(NativeOrderFactory, orderHash, proxyBytecodeHash)
  //   4. Build FINAL order with maker = proxy address (for relayer)
  //   5. NativeOrderFactory.create(orderWithUserAsMaker) payable — locks ETH
  //   6. Submit FINAL order to relayer with nativeSignature = ABI-encoded original order
  //
  // NativeOrderFactory ABI (from @1inch/limit-order-sdk):
  //   create(tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256))
  //   ALL fields are uint256 (not address), NO extension parameter
  //   Contract checks: maker == msg.sender, makingAmount == msg.value
  //
  // SDK flow for ERC20 cross-chain:
  //   1. Build order normally (user as maker)
  //   2. User signs via eth_signTypedData_v4 (EIP-712)
  //   3. Submit order + signature to relayer
  //   (no on-chain create() call)
  //
  app.post(`${PREFIX}/fusion-plus/create-tx`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    // SECURITY AUDIT T1-A: requireAuth() prevents anonymous API key quota abuse
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;

    let reqBody: Record<string, unknown>;
    try { reqBody = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }

    const srcChainId = typeof reqBody.srcChainId === "number" ? reqBody.srcChainId : NaN;
    const dstChainId = typeof reqBody.dstChainId === "number" ? reqBody.dstChainId : NaN;
    if (!FUSION_PLUS_CHAINS.has(srcChainId)) return c.json({ error: `Fusion+ unsupported on chain ${srcChainId}` }, 400);
    if (!FUSION_PLUS_CHAINS.has(dstChainId)) return c.json({ error: `Fusion+ unsupported on chain ${dstChainId}` }, 400);
    if (!isValidEthAddress(reqBody.srcTokenAddress)) return c.json({ error: "Invalid srcTokenAddress" }, 400);
    if (!isValidEthAddress(reqBody.dstTokenAddress)) return c.json({ error: "Invalid dstTokenAddress" }, 400);
    if (typeof reqBody.amount !== "string" || !/^\d+$/.test(reqBody.amount)) return c.json({ error: "Invalid amount" }, 400);
    if (!isValidWalletAddress(reqBody.walletAddress)) return c.json({ error: "Invalid walletAddress" }, 400);
    if (typeof reqBody.hashLock !== "string") return c.json({ error: "Missing hashLock" }, 400);

    let cWallet: string; try { cWallet = eip55Checksum(reqBody.walletAddress as string); } catch { cWallet = reqBody.walletAddress as string; }
    let cSrc: string; try { cSrc = eip55Checksum(reqBody.srcTokenAddress as string); } catch { cSrc = reqBody.srcTokenAddress as string; }
    let cDst: string; try { cDst = eip55Checksum(reqBody.dstTokenAddress as string); } catch { cDst = reqBody.dstTokenAddress as string; }
    const amt = reqBody.amount as string;
    const hl = reqBody.hashLock as string;
    const isNative = (reqBody.srcTokenAddress as string).toLowerCase() === NATIVE_ADDRESS.toLowerCase();

    console.log(`${TAG} [CREATE-TX] ${srcChainId}->${dstChainId} amt=${amt} native=${isNative} wallet=${cWallet.slice(0,10)}... hl=${hl.slice(0,18)}...`);

    // Step 1: Quote (GET with query params — 1inch quoter ignores POST bodies)
    const quoteQs = new URLSearchParams({
      srcChain: String(srcChainId),
      dstChain: String(dstChainId),
      srcTokenAddress: cSrc,
      dstTokenAddress: cDst,
      amount: amt,
      walletAddress: cWallet,
      enableEstimate: "true",
    });
    const quoteUrl = `${QUOTER_BASE}/quote/receive?${quoteQs.toString()}`;
    console.log(`${TAG} [CREATE-TX] Quote URL: GET ${quoteUrl.slice(0, 160)}...`);
    const qr = await apiFetch("GET", quoteUrl, null, UPSTREAM_TIMEOUT_MS);
    if (qr.status !== 200 || !qr.body) {
      console.log(`${TAG} [CREATE-TX] Quote FAILED (${qr.status}): ${JSON.stringify(qr.body).slice(0, 500)}`);
      return c.json({ error: "Quote failed", details: `${qr.status}`, quoteResponse: qr.body }, 502);
    }
    const rq = qr.body as Record<string, unknown>;
    console.log(`${TAG} [CREATE-TX] Quote OK: quoteId=${(rq.quoteId as string || "").slice(0,20)}... keys=[${Object.keys(rq).join(",")}]`);

    // Enrich quote with request params (API doesn't echo these back)
    if (!rq.srcTokenAddress) rq.srcTokenAddress = cSrc;
    if (!rq.dstTokenAddress) rq.dstTokenAddress = cDst;
    if (!rq.srcChain) rq.srcChain = srcChainId;
    if (!rq.dstChain) rq.dstChain = dstChainId;
    if (!rq.walletAddress) rq.walletAddress = cWallet;

    // Step 2: Build order + extension (user as maker, makerAsset already WETH for native)
    const built = buildServerSideOrder(rq, hl, cWallet.toLowerCase(), srcChainId, dstChainId);
    if (!built) {
      console.log(`${TAG} [CREATE-TX] Order build FAILED. Quote keys: [${Object.keys(rq).join(",")}]`);
      console.log(`${TAG} [CREATE-TX] Quote dump (2000ch): ${JSON.stringify(rq).slice(0, 2000)}`);
      return c.json({ error: "Order construction failed", rawQuoteKeys: Object.keys(rq) }, 500);
    }
    const { order: ord, extension: ext, typedData, orderHash: tempOrderHash, diagnostics: diag } = built;
    console.log(`${TAG} [CREATE-TX] Order OK: tempHash=${tempOrderHash.slice(0,18)}... ext=${ext.length}ch`);

    // ── NATIVE ETH FLOW ──
    // IMPLEMENTATION NOTE (SDK-verified): For native ETH, we must:
    // 1. Use the temp order hash to compute the CREATE2 proxy address
    // 2. Build a FINAL order with maker = proxy (for relayer submission)
    // 3. Generate create() calldata for NativeOrderFactory with user as maker
    // 4. Generate nativeSignature = ABI-encoded order with user as maker
    if (isNative) {
      // Get NativeOrderFactory + impl addresses (from quote or hardcoded)
      let nofAddr = (rq.nativeOrderFactoryAddress as string) || NATIVE_ORDER_FACTORY[srcChainId] || "";
      let noiAddr = (rq.nativeOrderImplAddress as string) || NATIVE_ORDER_IMPL[srcChainId] || "";
      if (!nofAddr || !noiAddr) {
        console.log(`${TAG} [CREATE-TX] No NativeOrderFactory addresses for chain ${srcChainId}`);
        return c.json({ error: `NativeOrderFactory not available for chain ${srcChainId}` }, 500);
      }
      nofAddr = nofAddr.toLowerCase();
      noiAddr = noiAddr.toLowerCase();

      console.log(`${TAG} [CREATE-TX] Native flow: NativeOrderFactory=${nofAddr} impl=${noiAddr}`);

      // Compute proxy address = CREATE2(factory, tempOrderHash, bytecodeHash(impl))
      const bytecodeHash = computeProxyBytecodeHash(noiAddr);
      const proxyAddress = computeCreate2Address(nofAddr, tempOrderHash, bytecodeHash);
      console.log(`${TAG} [CREATE-TX] Proxy address: ${proxyAddress}`);

      // Build FINAL order for relayer: maker = proxy, everything else same
      const relayerOrder: Record<string, string> = {
        ...ord,
        maker: proxyAddress.toLowerCase(),
      };

      // Recompute order hash for the relayer order (with proxy as maker)
      const relayerOrderHash = computeEIP712OrderHash(relayerOrder, srcChainId);
      console.log(`${TAG} [CREATE-TX] Relayer order hash: ${relayerOrderHash.slice(0,18)}...`);

      // Generate nativeSignature = ABI-encoded original order (user as maker)
      // IMPLEMENTATION NOTE (SDK-verified): LimitOrder.nativeSignature() calls toCalldata()
      // which is AbiCoder.encode([Web3Type], [order.build()]). For our manual encoding,
      // this is 8 × uint256 = 256 bytes (addresses padded to 32 bytes).
      function abiU256(a: string): Uint8Array {
        // For addresses: pad left to 32 bytes. For numbers: BigInt → 32 bytes
        if (/^0x/i.test(a)) {
          const b = new Uint8Array(32);
          const ab = hexBytes(a.replace(/^0x/i, "").toLowerCase());
          b.set(ab, 32 - ab.length);
          return b;
        }
        return u256be(BigInt(a));
      }
      const nativeSig = "0x" + bHex(catBytes(
        abiU256(ord.salt), abiU256(ord.maker), abiU256(ord.receiver),
        abiU256(ord.makerAsset), abiU256(ord.takerAsset),
        abiU256(ord.makingAmount), abiU256(ord.takingAmount), abiU256(ord.makerTraits),
      ));

      // Generate create() calldata for NativeOrderFactory
      // IMPLEMENTATION NOTE (SDK-verified): The NativeOrderFactory ABI has ALL uint256 fields:
      //   create((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256))
      // The create() call passes the order with USER as maker (not proxy).
      // Contract checks: order.maker == msg.sender, order.makingAmount == msg.value
      const createSig = "create((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256))";
      const createSel = bHex(new Uint8Array(keccak_256(new TextEncoder().encode(createSig)).slice(0, 4)));

      // ABI-encode: all fields as uint256 (addresses are uint256 in this ABI)
      const createOrderBytes = catBytes(
        u256be(BigInt(ord.salt)),
        u256be(BigInt(ord.maker)),         // user address as uint256
        u256be(BigInt(ord.receiver)),      // receiver as uint256
        u256be(BigInt(ord.makerAsset)),    // WETH as uint256
        u256be(BigInt(ord.takerAsset)),    // TRUE_ERC20 as uint256
        u256be(BigInt(ord.makingAmount)),
        u256be(BigInt(ord.takingAmount)),
        u256be(BigInt(ord.makerTraits)),
      );
      const createCalldata = "0x" + createSel + bHex(createOrderBytes);

      console.log(`${TAG} [CREATE-TX] Native OK: sel=0x${createSel} cd=${createCalldata.length}ch to=${nofAddr} val=${amt}`);
      console.log(`${TAG} [CREATE-TX] nativeSig=${nativeSig.length}ch proxyMaker=${proxyAddress}`);

      return c.json({
        success: true,
        isNative: true,
        // The on-chain create() tx for MetaMask
        tx: { to: nofAddr, data: createCalldata, value: amt },
        // The RELAYER order (maker = proxy) + signature for off-chain submission
        relayerOrder,
        relayerOrderHash,
        nativeSignature: nativeSig,
        extension: ext,
        quoteId: rq.quoteId || "",
        srcTokenAmount: rq.srcTokenAmount,
        dstTokenAmount: rq.dstTokenAmount,
        // Original order for reference
        originalOrder: ord,
        tempOrderHash,
        proxyAddress,
        _diagnostics: {
          ...diag,
          flow: "native-NativeOrderFactory",
          contractAddress: nofAddr,
          implAddress: noiAddr,
          selector: "0x" + createSel,
          createSig,
          calldataLen: createCalldata.length,
          proxyAddress,
        },
      }, 200);
    }

    // ── ERC20 FLOW ──
    // IMPLEMENTATION NOTE (SDK-verified): For ERC20 tokens, there is NO on-chain
    // create() call. The flow is:
    //   1. User approves tokens to the Aggregation Router
    //   2. User signs the order via eth_signTypedData_v4 (EIP-712)
    //   3. Client submits order + signature to relayer via sdk-submit endpoint
    // The typedData for signing is already built by buildServerSideOrder().
    console.log(`${TAG} [CREATE-TX] ERC20 flow: returning typedData for EIP-712 signing`);

    return c.json({
      success: true,
      isNative: false,
      // No on-chain tx — client signs with EIP-712 then submits to relayer
      order: ord,
      orderHash: tempOrderHash,
      typedData,
      extension: ext,
      quoteId: rq.quoteId || "",
      srcTokenAmount: rq.srcTokenAmount,
      dstTokenAmount: rq.dstTokenAmount,
      // Approval target: the Aggregation Router (where the order gets filled)
      approvalTarget: AGG_ROUTER_V6,
      _diagnostics: {
        ...diag,
        flow: "erc20-sign-submit",
        approvalTarget: AGG_ROUTER_V6,
      },
    }, 200);
  });
}
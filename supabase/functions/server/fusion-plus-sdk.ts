// =======================================================================
// 1inch Fusion+ SDK-Based Cross-Chain Swap Engine
// =======================================================================
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
      console.log(`${TAG} Upstream ${res.status} for ${method} ${url}: ${detail} | full=${JSON.stringify(parsed).slice(0, 500)}`);
      return { status: res.status, body: { error: "1inch API error", details: detail, statusCode: res.status, _upstream: JSON.stringify(parsed).slice(0, 600) } };
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
 * Encode auction details in the format used by the 1inch Fusion settlement.
 * Format: uint32(startTime) + uint24(duration) + uint24(initialRateBump)
 *         + [uint16(delay) + uint24(coefficient)]...
 */
function encodeAuctionDetails(
  startTime: number,
  duration: number,
  initialRateBump: number,
  points: { delay: number; coefficient: number }[],
): Uint8Array {
  const parts = [u32be(startTime), u24be(duration), u24be(initialRateBump)];
  for (const p of points) {
    parts.push(u16be(p.delay), u24be(p.coefficient));
  }
  return catBytes(...parts);
}

/**
 * Pack the LOP v4 extension offsets word.
 * Each slot (32 bits) contains the CUMULATIVE byte length up to and including
 * that field. Slot 0 = makerAssetSuffix end, ..., Slot 7 = postInteraction end.
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
 * Pack MakerTraits for a Fusion+ order (same layout as client-side builder).
 * bits 40-103: expiration, bits 104-119: nonce, bit 253: hasExtension
 */
function packMakerTraits(expiration: number, nonce: number, hasExtension: boolean): bigint {
  let traits = 0n;
  traits |= (BigInt(expiration) & 0xFFFFFFFFFFFFFFFFn) << 40n;
  traits |= (BigInt(nonce) & 0xFFFFn) << 104n;
  if (hasExtension) traits |= 1n << 253n;
  return traits;
}

/** Generate a random 256-bit salt */
function randomSalt(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let salt = 0n;
  for (let i = 0; i < 32; i++) salt = (salt << 8n) | BigInt(bytes[i]);
  return salt;
}

/** LOP v4 Aggregation Router v6 address (same on all chains) */
const AGG_ROUTER_V6 = "0x111111125421ca6dc452d289314280a0f8842a65";

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
 * Build a complete Fusion+ order with extension from raw quote data.
 *
 * IMPLEMENTATION NOTE: This is the server-side manual builder. It encodes
 * the LOP v4 extension with auction details, resolver whitelist, and hashlock.
 * The settlement/escrow address is extracted from the quote response.
 * If the address can't be found, this returns null (falls through to client-side).
 */
function buildServerSideOrder(
  rawQuote: Record<string, unknown>,
  hashLock: string,
  walletAddress: string,
  srcChainId: number,
  dstChainId: number,
): { order: Record<string, string>; extension: string; typedData: any; orderHash: string; diagnostics: Record<string, unknown> } | null {
  const diag: Record<string, unknown> = { method: "server-manual-ext" };

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

    // ── Find settlement/escrow address ──
    // IMPLEMENTATION NOTE: The quote response from the v1.2 API may include
    // the settlement or escrow factory address under various field names.
    // We search for it aggressively and log all available keys for diagnostics.
    let settlAddr = "";
    const addressFieldCandidates = [
      "settlementAddress", "settlementContract", "srcEscrowFactory",
      "escrowFactory", "srcSettlement", "settlement", "escrowAddress",
    ];
    for (const key of addressFieldCandidates) {
      const val = rawQuote[key];
      if (typeof val === "string" && /^0x[0-9a-fA-F]{40}$/i.test(val)) {
        settlAddr = val;
        diag.settlementSource = `rawQuote.${key}`;
        break;
      }
    }
    // Check inside preset
    if (!settlAddr) {
      for (const key of ["srcEscrowFactory", "settlementAddress", "escrowFactory"]) {
        const val = preset[key];
        if (typeof val === "string" && /^0x[0-9a-fA-F]{40}$/i.test(val)) {
          settlAddr = val;
          diag.settlementSource = `preset.${key}`;
          break;
        }
      }
    }
    // Check whitelist[0].address as potential settlement (unlikely but worth trying)
    // Actually, whitelist entries are resolver addresses, not settlement. Skip.

    // IMPLEMENTATION NOTE: Log ALL available keys for diagnostics.
    // This helps identify which field contains the settlement address.
    const allQuoteKeys = Object.keys(rawQuote);
    const allPresetKeys = Object.keys(preset);
    diag.rawQuoteKeys = allQuoteKeys;
    diag.presetKeys = allPresetKeys;

    // Log all string values that look like addresses (for discovery)
    const addressLikeFields: Record<string, string> = {};
    for (const key of allQuoteKeys) {
      const val = rawQuote[key];
      if (typeof val === "string" && /^0x[0-9a-fA-F]{40}$/i.test(val)) {
        addressLikeFields[key] = val;
      }
    }
    for (const key of allPresetKeys) {
      const val = preset[key];
      if (typeof val === "string" && /^0x[0-9a-fA-F]{40}$/i.test(val)) {
        addressLikeFields[`preset.${key}`] = val;
      }
    }
    diag.addressLikeFields = addressLikeFields;

    // Dump cross-chain specific fields
    diag.timeLocks = rawQuote.timeLocks ?? "missing";
    diag.srcSafetyDeposit = rawQuote.srcSafetyDeposit ?? "missing";
    diag.dstSafetyDeposit = rawQuote.dstSafetyDeposit ?? "missing";
    diag.whitelist = rawQuote.whitelist ?? "missing";

    // Full quote dump for next-iteration debugging (truncated)
    console.log(`${TAG} [EXT] Raw quote dump (2000 chars): ${JSON.stringify(rawQuote).slice(0, 2000)}`);
    console.log(`${TAG} [EXT] Address-like fields: ${JSON.stringify(addressLikeFields)}`);

    if (!settlAddr) {
      diag.error = "No settlement/escrow address found in quote response";
      console.log(`${TAG} [EXT] ${diag.error}. Keys: [${allQuoteKeys.join(", ")}]. Preset keys: [${allPresetKeys.join(", ")}]`);
      // IMPLEMENTATION NOTE: Return null so the client-side builder can try.
      // The comprehensive logs above will reveal which field has the address.
      return null;
    }

    console.log(`${TAG} [EXT] Using settlement address: ${settlAddr} (from ${diag.settlementSource})`);

    // ── Encode auction details ──
    const now = Math.floor(Date.now() / 1000);
    const startAuctionIn = Number(preset.startAuctionIn) || 12;
    const startTime = now + startAuctionIn;
    const duration = Number(preset.auctionDuration) || 180;
    const initialRateBump = Number(preset.initialRateBump) || 50000;
    const points = (preset.points || []) as { delay: number; coefficient: number }[];

    diag.auctionParams = { startTime, startAuctionIn, duration, initialRateBump, pointCount: points.length };
    const auctionBytes = encodeAuctionDetails(startTime, duration, initialRateBump, points);
    const settleBytes = hexBytes(settlAddr);

    // ── Build extension fields ──
    // Field 2: makingAmountData = settlement(20) + auctionDetails
    const makingAmountData = catBytes(settleBytes, auctionBytes);
    // Field 3: takingAmountData = settlement(20) + auctionDetails
    const takingAmountData = catBytes(settleBytes, auctionBytes);

    // Field 7: postInteraction = settlement(20) + resolver_count(1) + whitelist + hashlock(32)
    const whitelist = (rawQuote.whitelist || []) as { address: string; allowFrom: number }[];
    const wlParts: Uint8Array[] = [];
    for (const w of whitelist) {
      try {
        wlParts.push(hexBytes(w.address));
        wlParts.push(u32be(w.allowFrom || 0));
      } catch (e: any) {
        console.log(`${TAG} [EXT] Skipping invalid whitelist entry: ${JSON.stringify(w)} — ${e?.message}`);
      }
    }
    const wlBytes = wlParts.length > 0 ? catBytes(...wlParts) : new Uint8Array(0);
    const hashLockBytes = hexBytes(hashLock);

    // Post interaction: settlement(20) + count(1) + whitelist + hashlock(32)
    // IMPLEMENTATION NOTE: The count byte tells the settlement contract how many
    // resolvers are in the whitelist. Each entry is 24 bytes (address + allowFrom).
    const postInteraction = catBytes(
      settleBytes,
      new Uint8Array([whitelist.length & 0xFF]),
      wlBytes,
      hashLockBytes,
    );

    // ── Add cross-chain extras if available ──
    // For Fusion+, the postInteraction may also need srcSafetyDeposit,
    // dstSafetyDeposit, and timeLocks. We append them if present.
    let crossChainSuffix = new Uint8Array(0);
    const srcSafety = rawQuote.srcSafetyDeposit;
    const dstSafety = rawQuote.dstSafetyDeposit;
    const timeLocks = rawQuote.timeLocks as Record<string, number> | undefined;

    if (srcSafety !== undefined && dstSafety !== undefined) {
      try {
        const srcDepBytes = u256be(BigInt(srcSafety as string));
        const dstDepBytes = u256be(BigInt(dstSafety as string));
        crossChainSuffix = catBytes(crossChainSuffix, srcDepBytes, dstDepBytes);
        diag.safetyDepositsEncoded = true;
      } catch (e: any) {
        console.log(`${TAG} [EXT] Failed to encode safety deposits: ${e?.message}`);
      }
    }

    if (timeLocks) {
      try {
        // Encode time locks as 8 × uint32 = 32 bytes
        const tlKeys = [
          "srcWithdrawal", "srcPublicWithdrawal", "srcCancellation", "srcPublicCancellation",
          "dstWithdrawal", "dstPublicWithdrawal", "dstCancellation", "dstPublicCancellation",
        ];
        const tlParts: Uint8Array[] = [];
        for (const k of tlKeys) {
          tlParts.push(u32be(Number(timeLocks[k]) || 0));
        }
        crossChainSuffix = catBytes(crossChainSuffix, ...tlParts);
        diag.timeLocksEncoded = true;
      } catch (e: any) {
        console.log(`${TAG} [EXT] Failed to encode timeLocks: ${e?.message}`);
      }
    }

    // Append cross-chain suffix to postInteraction
    const fullPostInteraction = crossChainSuffix.length > 0
      ? catBytes(postInteraction, crossChainSuffix)
      : postInteraction;

    // ── Pack LOP v4 extension ──
    const fields = [
      new Uint8Array(0), // 0: makerAssetSuffix
      new Uint8Array(0), // 1: takerAssetSuffix
      makingAmountData,   // 2: makingAmountData
      takingAmountData,   // 3: takingAmountData
      new Uint8Array(0), // 4: predicate
      new Uint8Array(0), // 5: makerPermit
      new Uint8Array(0), // 6: preInteraction
      fullPostInteraction, // 7: postInteraction
    ];

    const offsetsHex = packExtOffsets(fields.map(f => f.length));
    const dataHex = fields.map(f => bHex(f)).join("");
    const extension = "0x" + offsetsHex + dataHex;

    diag.extensionLength = extension.length;
    diag.fieldLengths = fields.map(f => f.length);

    // ── Build order struct ──
    const srcTokenAmount = rawQuote.srcTokenAmount as string;
    const auctionEndAmount = preset.auctionEndAmount as string;
    const takingAmount = auctionEndAmount || rawQuote.dstTokenAmount as string;
    const srcTokenAddress = rawQuote.srcTokenAddress as string;
    const dstTokenAddress = rawQuote.dstTokenAddress as string;

    if (!srcTokenAmount || !takingAmount || !srcTokenAddress || !dstTokenAddress) {
      diag.error = `Missing order fields: srcAmt=${srcTokenAmount} takAmt=${takingAmount} srcTok=${srcTokenAddress} dstTok=${dstTokenAddress}`;
      return null;
    }

    // IMPLEMENTATION NOTE: In LOP v4, receiver=0x0 means "same as maker".
    // The SDK typically uses 0x0 for the receiver field in Fusion orders.
    const expiration = now + startAuctionIn + duration + 120;
    const nonce = now % 65535;
    const salt = randomSalt();
    const makerTraits = packMakerTraits(expiration, nonce, true);

    const order = {
      salt: "0x" + salt.toString(16),
      maker: walletAddress,
      receiver: "0x0000000000000000000000000000000000000000",
      makerAsset: srcTokenAddress,
      takerAsset: dstTokenAddress,
      makingAmount: srcTokenAmount,
      takingAmount: takingAmount,
      makerTraits: "0x" + makerTraits.toString(16),
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

    // Compute order hash (simplified — relayer re-computes anyway)
    const orderHashInput = new TextEncoder().encode(JSON.stringify(order));
    const hashBytes = keccak_256(orderHashInput);
    const orderHash = toHex(hashBytes);

    console.log(`${TAG} [EXT] Server-side order built: ext=${extension.length} chars, wl=${whitelist.length} resolvers, auction=${duration}s, salt=${order.salt.slice(0, 14)}...`);

    return { order, extension, typedData, orderHash, diagnostics: diag };
  } catch (err: any) {
    diag.error = err?.message;
    console.log(`${TAG} [EXT] Server-side order construction failed: ${err?.message}`);
    console.log(`${TAG} [EXT] Stack: ${err?.stack?.slice(0, 300)}`);
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

    // EIP-55 checksum all addresses
    let cWallet: string, cSrc: string, cDst: string;
    try { cWallet = eip55Checksum(body.walletAddress as string); } catch { cWallet = body.walletAddress as string; }
    try { cSrc = eip55Checksum(body.srcTokenAddress as string); } catch { cSrc = body.srcTokenAddress as string; }
    try { cDst = eip55Checksum(body.dstTokenAddress as string); } catch { cDst = body.dstTokenAddress as string; }

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

    const { status, body: resBody } = await apiFetch("POST", submitUrl, JSON.stringify(submitPayload), 25_000);

    if (status === 200) {
      console.log(`${TAG} [SDK-SUBMIT] SUCCESS: ${JSON.stringify(resBody).slice(0, 300)}`);
    } else {
      console.log(`${TAG} [SDK-SUBMIT] FAILED (${status}): ${JSON.stringify(resBody).slice(0, 500)}`);

      // IMPLEMENTATION NOTE: If v1.2 submit fails, try v1.0 as fallback
      const v10SubmitUrl = `https://api.1inch.dev/fusion-plus/relayer/v1.0/submit`;
      console.log(`${TAG} [SDK-SUBMIT] Trying v1.0 fallback: POST ${v10SubmitUrl}`);
      const v10Result = await apiFetch("POST", v10SubmitUrl, JSON.stringify(submitPayload), 25_000);
      if (v10Result.status === 200) {
        console.log(`${TAG} [SDK-SUBMIT] v1.0 SUCCESS: ${JSON.stringify(v10Result.body).slice(0, 300)}`);
        return c.json({ ...v10Result.body, _relayerVersion: "v1.0" }, 200);
      }
      console.log(`${TAG} [SDK-SUBMIT] v1.0 also FAILED (${v10Result.status}): ${JSON.stringify(v10Result.body).slice(0, 500)}`);

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
}
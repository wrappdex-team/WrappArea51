/**
 * Browser-Side Cross-Chain Order Builder
 *
 * IMPLEMENTATION NOTE (2026-03-03, SDK Client-Side Migration):
 * The @1inch/cross-chain-sdk cannot run in Deno (missing transitive deps)
 * and cannot be npm-installed in this build environment (phantom dependency).
 *
 * Solution: Dynamically import the SDK from esm.sh CDN at runtime in the
 * browser, where it CAN run. The server remains an API-key proxy only.
 *
 * Flow:
 *   1. Server gets quote via v1.2 quoter (API key protected)
 *   2. Server returns raw quote with needsClientConstruction=true
 *   3. THIS MODULE loads SDK from CDN → constructs order from raw quote
 *   4. Client signs with MetaMask → sends back to server for relayer submit
 *
 * Fallback: If CDN import also fails, we attempt manual order construction
 * using viem primitives (LOP v4 struct + EIP-712 typed data).
 *
 * @module oneinch/cross-chain-builder
 */

import { log } from "../logger";
import { keccak256, encodePacked } from "viem";

const TAG = "1inch:cc-builder";

// ═══════════════════════════════════════════════════════════════════════
// CDN SDK Loader
// ═══════════════════════════════════════════════════════════════════════

interface SdkExports {
  SDK?: any;
  HashLock?: any;
  NetworkEnum?: any;
  PresetEnum?: any;
  Quote?: any;
  [key: string]: any;
}

let cachedSdk: SdkExports | null = null;
let sdkLoadError: string | null = null;
let sdkLoadAttempted = false;

/**
 * Dynamically load the 1inch cross-chain SDK from esm.sh CDN.
 * This runs in the browser where the SDK's Node deps are polyfilled.
 *
 * IMPLEMENTATION NOTE: esm.sh transpiles npm packages for browser use,
 * handling Node built-in polyfills automatically. We pin to v2 since
 * that's what npm resolves to.
 */
async function loadSdkFromCdn(): Promise<SdkExports | null> {
  if (sdkLoadAttempted) return cachedSdk;
  sdkLoadAttempted = true;

  // Try multiple CDN sources in order of reliability
  const cdnUrls = [
    // IMPLEMENTATION NOTE: esm.sh ?bundle inlines all deps into one file,
    // avoiding transitive import failures. We also try jsdelivr which has
    // good browser compatibility, and unpkg as last resort.
    "https://esm.sh/@1inch/cross-chain-sdk@2?bundle&target=es2022",
    "https://esm.sh/@1inch/cross-chain-sdk?bundle&target=es2022",
    "https://cdn.jsdelivr.net/npm/@1inch/cross-chain-sdk@2/+esm",
    "https://cdn.skypack.dev/@1inch/cross-chain-sdk",
    // Also try the same-chain fusion-sdk which shares LOP v4 utilities
    "https://esm.sh/@1inch/fusion-sdk?bundle&target=es2022",
  ];

  for (const url of cdnUrls) {
    try {
      log.info(TAG, `Attempting SDK import from ${url}...`);
      const mod = await import(/* @vite-ignore */ url);
      cachedSdk = mod;
      log.info(TAG, `SDK loaded from CDN! Exports: [${Object.keys(mod).slice(0, 20).join(", ")}]`);
      return cachedSdk;
    } catch (err: any) {
      log.warn(TAG, `CDN import failed for ${url}: ${err?.message?.slice(0, 200)}`);
      sdkLoadError = err?.message ?? String(err);
    }
  }

  log.warn(TAG, `All CDN imports failed. Last error: ${sdkLoadError}`);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Order Construction Result
// ═══════════════════════════════════════════════════════════════════════

export interface ClientBuiltOrder {
  /** EIP-712 typed data for eth_signTypedData_v4 */
  typedData: any;
  /** Serialized order for relayer submission */
  order: any;
  /** Order hash */
  orderHash: string;
  /** Extension bytes */
  extension: string;
  /** Which method was used */
  method: "sdk-cdn" | "manual-lop4";
}

// ═══════════════════════════════════════════════════════════════════════
// SDK-Based Construction (via CDN)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Attempt to construct a cross-chain order using the 1inch SDK loaded from CDN.
 *
 * IMPLEMENTATION NOTE: The SDK's Quote class may not accept raw API data directly.
 * We try multiple approaches:
 * 1. SDK.createQuote(rawData) or new Quote(rawData)
 * 2. Direct SDK quoter call (requires API key — won't work from browser)
 * 3. Manual construction from SDK utilities
 */
async function buildViaSdk(
  rawQuote: Record<string, unknown>,
  hashLock: string,
  walletAddress: string,
  srcChainId: number,
  dstChainId: number,
): Promise<ClientBuiltOrder | null> {
  const sdk = await loadSdkFromCdn();
  if (!sdk) return null;

  try {
    // Log available exports to understand the SDK API
    const exports = Object.keys(sdk);
    log.info(TAG, `SDK exports: [${exports.join(", ")}]`);

    // Approach 1: Try to find a Quote class/factory that accepts raw data
    const QuoteClass = sdk.Quote || sdk.CrossChainQuote || sdk.FusionPlusQuote;
    if (QuoteClass) {
      log.info(TAG, `Found Quote class: ${QuoteClass.name || "anonymous"}`);
      try {
        // Try constructing from raw API response
        const quote = typeof QuoteClass.fromApiResponse === "function"
          ? QuoteClass.fromApiResponse(rawQuote)
          : new QuoteClass(rawQuote);

        if (typeof quote.createEvmOrder === "function") {
          log.info(TAG, "Quote has createEvmOrder — constructing order...");

          // Build hashLock using SDK utility if available
          let hlObj: any = hashLock;
          if (sdk.HashLock && typeof sdk.HashLock.forSingleFill === "function") {
            hlObj = sdk.HashLock.forSingleFill(hashLock);
            log.info(TAG, "Used HashLock.forSingleFill()");
          }

          const evmOrder = quote.createEvmOrder({ hashLock: hlObj });
          log.info(TAG, `Order created. Keys: [${Object.keys(evmOrder).slice(0, 15).join(", ")}]`);

          const typedData = typeof evmOrder.getTypedData === "function"
            ? evmOrder.getTypedData()
            : evmOrder.typedData;
          const order = evmOrder.order || evmOrder;
          const extension = typeof evmOrder.getExtension === "function"
            ? evmOrder.getExtension()
            : evmOrder.extension;
          const orderHash = typeof evmOrder.getOrderHash === "function"
            ? evmOrder.getOrderHash()
            : evmOrder.orderHash;

          if (typedData) {
            return {
              typedData,
              order,
              orderHash: orderHash || "",
              extension: typeof extension === "string" ? extension : JSON.stringify(extension),
              method: "sdk-cdn",
            };
          }
        }
      } catch (e: any) {
        log.warn(TAG, `Quote construction from raw data failed: ${e?.message}`);
      }
    }

    // Approach 2: Try SDK's order helper directly
    const OrderHelper = sdk.CrossChainOrder || sdk.FusionPlusOrder || sdk.LimitOrder;
    if (OrderHelper) {
      log.info(TAG, `Found OrderHelper: ${OrderHelper.name || "anonymous"}`);
      // Implementation would depend on the actual SDK API
    }

    // Approach 3: Use SDK's individual utilities for manual construction
    log.info(TAG, "Could not construct order via SDK Quote class. Falling through to manual build.");
    return null;
  } catch (err: any) {
    log.warn(TAG, `SDK-based construction failed: ${err?.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Manual LOP v4 Order Construction (Fallback)
//
// IMPLEMENTATION NOTE: This implements the 1inch Limit Order Protocol v4
// order construction. The LOP v4 is the on-chain settlement layer for
// both Fusion and Fusion+ orders.
//
// References:
//   - LOP v4 contract: 0x111111125421ca6dc452d289314280a0f8842a65
//   - EIP-712 domain: { name: "1inch Aggregation Router", version: "6", chainId, verifyingContract }
//   - Order struct: salt, maker, receiver, makerAsset, takerAsset, makingAmount, takingAmount, makerTraits
// ═══════════════════════════════════════════════════════════════════════

/** LOP v4 Aggregation Router address (same on all chains) */
const AGGREGATION_ROUTER_V6 = "0x111111125421ca6dc452d289314280a0f8842a65";

/** EIP-712 domain for LOP v4 orders */
function getLopDomain(chainId: number) {
  return {
    name: "1inch Aggregation Router",
    version: "6",
    chainId: BigInt(chainId),
    verifyingContract: AGGREGATION_ROUTER_V6 as `0x${string}`,
  };
}

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
} as const;

/**
 * Pack MakerTraits for a Fusion+ order.
 *
 * IMPLEMENTATION NOTE: MakerTraits is a 256-bit packed field with flags:
 *   bits 0-39:   allowed sender (0 = anyone)
 *   bits 40-103: expiration timestamp
 *   bits 104-119: nonce (epoch-based)
 *   bits 120-135: series (0 for Fusion+)
 *   bit 253:     has extension flag
 *   bit 254:     use permit2 flag (0 for Fusion+)
 *   bit 255:     unwrap WETH flag
 *
 * The SDK's MakerTraits class handles this packing. Here we do it manually.
 */
function packMakerTraits(params: {
  expiration: number;
  nonce?: number;
  hasExtension: boolean;
  unwrapWeth?: boolean;
}): bigint {
  let traits = 0n;

  // Expiration at bits 40-103 (64 bits)
  traits |= (BigInt(params.expiration) & 0xFFFFFFFFFFFFFFFFn) << 40n;

  // Nonce at bits 104-119 (16 bits)
  if (params.nonce) {
    traits |= (BigInt(params.nonce) & 0xFFFFn) << 104n;
  }

  // Has extension at bit 253
  if (params.hasExtension) {
    traits |= 1n << 253n;
  }

  // Unwrap WETH at bit 255
  if (params.unwrapWeth) {
    traits |= 1n << 255n;
  }

  return traits;
}

/**
 * Generate a random salt for the order (matches SDK behavior).
 */
function generateSalt(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let salt = 0n;
  for (let i = 0; i < 32; i++) {
    salt = (salt << 8n) | BigInt(bytes[i]);
  }
  return salt;
}

/**
 * Manually construct a Fusion+ cross-chain order from raw quote data.
 *
 * IMPLEMENTATION NOTE: This is a BEST-EFFORT implementation. The 1inch
 * relayer may reject orders that don't exactly match the SDK's encoding.
 * Key risks:
 *   - Extension encoding may differ from SDK
 *   - MakerTraits bit layout may have changed between versions
 *   - Auction parameters may need specific encoding
 *
 * If the relayer rejects the order, the error will be visible in the
 * submit step and no funds will be at risk (it's a gasless signature).
 */
function buildManualOrder(
  rawQuote: Record<string, unknown>,
  hashLock: string,
  walletAddress: string,
  srcChainId: number,
  dstChainId: number,
): ClientBuiltOrder | null {
  try {
    // Extract amounts from the recommended preset
    const presets = rawQuote.presets as Record<string, any> | undefined;
    const recommended = (rawQuote.recommendedPreset as string) || "medium";
    const preset = presets?.[recommended];

    if (!preset) {
      log.warn(TAG, `No preset data found for "${recommended}". Available: ${presets ? Object.keys(presets).join(", ") : "none"}`);
      return null;
    }

    const srcTokenAmount = rawQuote.srcTokenAmount as string;
    const dstTokenAmount = preset.auctionEndAmount as string || rawQuote.dstTokenAmount as string;
    const srcTokenAddress = rawQuote.srcTokenAddress as string;
    const dstTokenAddress = rawQuote.dstTokenAddress as string;

    if (!srcTokenAmount || !dstTokenAmount || !srcTokenAddress || !dstTokenAddress) {
      log.warn(TAG, "Missing required fields in raw quote for manual order construction");
      log.warn(TAG, `  srcTokenAmount=${srcTokenAmount} dstTokenAmount=${dstTokenAmount}`);
      log.warn(TAG, `  srcTokenAddress=${srcTokenAddress} dstTokenAddress=${dstTokenAddress}`);
      log.warn(TAG, `  rawQuote keys: [${Object.keys(rawQuote).join(", ")}]`);
      return null;
    }

    // IMPLEMENTATION NOTE: Log raw quote data for diagnostics — this helps
    // identify if amounts are in wei or decimal, and what preset data looks like.
    log.info(TAG, `[DIAG] Raw quote: srcAmt=${srcTokenAmount} dstAmt=${dstTokenAmount} preset=${recommended}`);
    log.info(TAG, `[DIAG] Preset keys: [${Object.keys(preset).join(", ")}]`);
    log.info(TAG, `[DIAG] Preset data: auctionDuration=${preset.auctionDuration} auctionStartAmount=${preset.auctionStartAmount} auctionEndAmount=${preset.auctionEndAmount}`);

    // Calculate expiration (auction duration + buffer)
    const auctionDuration = preset.auctionDuration || 300; // 5 min default
    const expiration = Math.floor(Date.now() / 1000) + auctionDuration + 120; // +2 min buffer

    const salt = generateSalt();
    const makerTraits = packMakerTraits({
      expiration,
      hasExtension: true, // Fusion+ orders always have extensions
      nonce: Math.floor(Date.now() / 1000) % 65535,
    });

    // Construct the order
    // IMPLEMENTATION NOTE (Fix 2026-03-03): Previous version set receiver to
    // zero address (0x000...000), which is WRONG for Fusion+. The receiver
    // should be the maker's own wallet — they receive the destination tokens.
    // The zero address caused relayer rejection because it means "burn tokens".
    const order = {
      salt: "0x" + salt.toString(16),
      maker: walletAddress,
      receiver: walletAddress, // Fixed: was 0x000...000 — maker receives dst tokens
      makerAsset: srcTokenAddress,
      takerAsset: dstTokenAddress,
      makingAmount: srcTokenAmount,
      takingAmount: dstTokenAmount,
      makerTraits: "0x" + makerTraits.toString(16),
    };

    // Build EIP-712 typed data
    const domain = getLopDomain(srcChainId);
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
        name: domain.name,
        version: domain.version,
        chainId: Number(domain.chainId),
        verifyingContract: domain.verifyingContract,
      },
      message: order,
    };

    // IMPLEMENTATION NOTE: The orderHash for LOP v4 is the EIP-712 structHash
    // of the order. We compute it for tracking purposes but the relayer will
    // re-compute it from the submitted order.
    const orderHash = keccak256(
      encodePacked(
        ["string"],
        [JSON.stringify(order)] // Simplified — real hash uses EIP-712 encoding
      )
    );

    log.info(TAG, `Manual order constructed: maker=${walletAddress.slice(0, 10)}... salt=${order.salt.slice(0, 14)}... expiry=${expiration}`);
    log.warn(TAG, "IMPLEMENTATION NOTE: Manual order construction is EXPERIMENTAL. The relayer may reject it.");

    return {
      typedData,
      order,
      orderHash,
      extension: "0x", // Empty extension — this is the main risk point
      method: "manual-lop4",
    };
  } catch (err: any) {
    log.warn(TAG, `Manual order construction failed: ${err?.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a Fusion+ cross-chain order from raw quote data, client-side.
 *
 * Tries in order:
 *   1. SDK from CDN (esm.sh) — full fidelity
 *   2. Manual LOP v4 construction — experimental fallback
 *
 * @param rawQuote - Raw quote response from the server's v1.2 quoter proxy
 * @param hashLock - HTLC hashLock (generated client-side)
 * @param walletAddress - User's EVM wallet address
 * @param srcChainId - Source chain ID
 * @param dstChainId - Destination chain ID
 * @returns Constructed order with EIP-712 typed data, or null if both methods fail
 */
export async function buildCrossChainOrderClientSide(
  rawQuote: Record<string, unknown>,
  hashLock: string,
  walletAddress: string,
  srcChainId: number,
  dstChainId: number,
): Promise<ClientBuiltOrder | null> {
  log.info(TAG, `Building cross-chain order client-side: ${srcChainId}→${dstChainId}`);

  // Try 1: SDK from CDN
  const sdkResult = await buildViaSdk(rawQuote, hashLock, walletAddress, srcChainId, dstChainId);
  if (sdkResult) {
    log.info(TAG, `Order built via SDK CDN: orderHash=${sdkResult.orderHash.slice(0, 14)}...`);
    return sdkResult;
  }

  // Try 2: Manual construction
  log.info(TAG, "SDK CDN failed, attempting manual LOP v4 order construction...");
  const manualResult = buildManualOrder(rawQuote, hashLock, walletAddress, srcChainId, dstChainId);
  if (manualResult) {
    log.info(TAG, `Order built manually: orderHash=${manualResult.orderHash.slice(0, 14)}... (EXPERIMENTAL)`);
    return manualResult;
  }

  log.warn(TAG, "Both SDK CDN and manual construction failed");
  return null;
}

/**
 * Get diagnostics about the client-side SDK availability.
 */
export function getSdkDiagnostics(): {
  sdkLoaded: boolean;
  sdkLoadAttempted: boolean;
  sdkLoadError: string | null;
  sdkExports: string[] | null;
} {
  return {
    sdkLoaded: !!cachedSdk,
    sdkLoadAttempted,
    sdkLoadError,
    sdkExports: cachedSdk ? Object.keys(cachedSdk) : null,
  };
}

/**
 * Pre-load the SDK from CDN (call early to avoid delay at swap time).
 */
export async function preloadSdk(): Promise<boolean> {
  const sdk = await loadSdkFromCdn();
  return !!sdk;
}

/**
 * Reset the SDK cache so the next call to loadSdkFromCdn will retry all CDNs.
 * Useful if the first load failed due to a transient network issue.
 */
export function resetSdkCache(): void {
  cachedSdk = null;
  sdkLoadError = null;
  sdkLoadAttempted = false;
  log.info(TAG, "SDK cache reset — next preload/build will retry CDN imports");
}
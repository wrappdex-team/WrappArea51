/**
 * 1inch Fusion+ v1.2 — Cross-Chain Intent-Based Swap Engine
 *
 * Provides the full lifecycle for Fusion+ cross-chain swaps:
 *   1. getCrossChainQuote()      — Request a cross-chain quote
 *   2. buildCrossChainOrder()    — (Step 11) Build EIP-712 typed data for signing
 *   3. submitCrossChainOrder()   — (Step 11) Submit the signed order
 *   4. pollCrossChainStatus()    — (Step 12) Poll until DstFilled/Failed/Expired
 *
 * Key differentiator: The user swaps across chains (e.g. ETH on Arbitrum
 * to USDC on Base) with a single signature. Resolvers handle the
 * cross-chain messaging and execution.
 *
 * IMPLEMENTATION NOTE: This module mirrors fusion.ts but targets the
 * Fusion+ API v1.2 endpoints (quoter/relayer/orders services).
 * Cross-chain quotes include chainId pairs in the request body
 * (no chainId in URL path).
 *
 * @module oneinch/fusion-plus
 */

import { log } from "../logger";
import { oneInchApi } from "./api-client";
import { getChainById, FUSION_PLUS_CHAINS } from "./chains";
import { keccak256 } from "viem";
import { NATIVE_TOKEN_ADDRESS } from "./types";
import type {
  FusionPreset,
  FusionPlusQuoteParams,
  FusionPlusQuoteResponse,
  FusionPlusOrderStatus,
  FusionPresetQuote,
} from "./types";

/* ═════════════════════════════════════════════════════════════════════
 * Constants
 * ══════════════════════════════════════════════════════════════════════ */

const TAG = "1inch:fusion+";

/** How long to cache a cross-chain quote (15s — slightly longer than Fusion) */
const QUOTE_CACHE_TTL_MS = 15_000;

/** Auto-refresh interval for cross-chain quotes */
export const CROSS_CHAIN_QUOTE_REFRESH_INTERVAL_MS = 20_000;

/** Poll interval for cross-chain order status */
export const CROSS_CHAIN_POLL_INTERVAL_MS = 8_000;

/** Max time to poll cross-chain order status (10 minutes — cross-chain is slower) */
export const CROSS_CHAIN_POLL_MAX_DURATION_MS = 600_000;

/* ══════════════════════════════════════════════════════════════════════
 * Native → Wrapped Token Address Mapping (per chain)
 *
 * IMPLEMENTATION NOTE: Same as fusion.ts — the Fusion+ API also operates
 * on ERC-20 tokens only. Native token placeholders must be resolved to
 * their wrapped equivalents before sending to the API.
 * ══════════════════════════════════════════════════════════════════════ */

const WRAPPED_NATIVE_BY_CHAIN: Record<number, string> = {
  1:     "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH (Ethereum)
  56:    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB (BSC)
  137:   "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WPOL (Polygon)
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH (Arbitrum)
  10:    "0x4200000000000000000000000000000000000006", // WETH (Optimism)
  8453:  "0x4200000000000000000000000000000000000006", // WETH (Base)
  43114: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX (Avalanche)
};

/**
 * Resolve a token address for Fusion+ API calls. If the address is the
 * native placeholder (0xEeee...eeEE), return the wrapped ERC-20 address
 * for the given chain. Otherwise, return the address as-is.
 */
function resolveTokenForFusionPlus(address: string, chainId: number): string {
  if (address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
    const wrapped = WRAPPED_NATIVE_BY_CHAIN[chainId];
    if (!wrapped) {
      throw new Error(
        `No wrapped native token configured for chain ${chainId}. ` +
        `Fusion+ cannot swap native tokens without a wrapped equivalent.`
      );
    }
    log.info(TAG, `Resolved native token -> ${wrapped.slice(0, 10)}... (chain ${chainId})`);
    // IMPLEMENTATION NOTE: Return the checksummed wrapped address as-is.
    // The 1inch Fusion+ API expects EIP-55 checksummed addresses.
    return wrapped;
  }
  // Pass through as-is — token addresses from the 1inch Token API are already
  // EIP-55 checksummed, and the Fusion+ API requires that format.
  return address;
}

/* ══════════════════════════════════════════════════════════════════════
 * Parsed Types
 * ══════════════════════════════════════════════════════════════════════ */

/** Human-friendly parsed preset for cross-chain quotes */
export interface ParsedCrossChainPreset {
  readonly preset: FusionPreset;
  readonly dstAmount: string;
  readonly auctionDuration?: number;
  readonly auctionStartAmount?: string;
  readonly auctionEndAmount?: string;
}

/** Fully parsed cross-chain quote with convenience fields */
export interface ParsedCrossChainQuote {
  /** Raw API response (for passing to build step) */
  readonly raw: FusionPlusQuoteResponse;
  /** Quote ID for building the order */
  readonly quoteId: string;
  /** Source chain ID */
  readonly srcChainId: number;
  /** Destination chain ID */
  readonly dstChainId: number;
  /** Source token amount (smallest unit) */
  readonly srcTokenAmount: string;
  /** Destination token amount — recommended preset (smallest unit) */
  readonly dstTokenAmount: string;
  /** Recommended preset name */
  readonly recommendedPreset: FusionPreset;
  /** Per-preset estimates */
  readonly presets: ParsedCrossChainPreset[];
  /** Estimated total time in seconds */
  readonly estimatedTimeSeconds: number | null;
  /** Fee breakdown */
  readonly fees: {
    readonly srcChainFee: string | null;
    readonly dstChainFee: string | null;
    readonly protocolFee: string | null;
  };
  /** USD volume if available */
  readonly volumeUsd: number | null;
  /** Timestamp when fetched */
  readonly fetchedAt: number;
  /** Whether the quote is still fresh (within refresh interval) */
  readonly isFresh: boolean;
}

/* ══════════════════════════════════════════════════════════════════════
 * Preset Metadata
 * ══════════════════════════════════════════════════════════════════════ */

/** Human-readable labels for cross-chain preset speeds */
export const CROSS_CHAIN_PRESET_LABELS: Record<string, string> = {
  fast: "Fast",
  medium: "Medium",
  slow: "Slow",
};

/** Estimated times for cross-chain presets (seconds) */
export const CROSS_CHAIN_PRESET_TIMES: Record<string, number> = {
  fast: 120,    // ~2 minutes
  medium: 300,  // ~5 minutes
  slow: 600,    // ~10 minutes
};

/** Icons for presets */
export const CROSS_CHAIN_PRESET_ICONS: Record<string, string> = {
  fast: "\u26A1",    // ⚡
  medium: "\u23F3",  // ⏳
  slow: "\uD83D\uDC22",    // 🐢
};

/** Descriptions for presets */
export const CROSS_CHAIN_PRESET_DESCRIPTIONS: Record<string, string> = {
  fast: "Priority execution across chains — slightly worse rate",
  medium: "Balanced speed and rate — recommended for most users",
  slow: "Best rate — may take longer for cross-chain settlement",
};

/* ══════════════════════════════════════════════════════════════════════
 * Status Metadata
 * ══════════════════════════════════════════════════════════════════════ */

/** Human-readable status labels */
export const CROSS_CHAIN_STATUS_LABELS: Record<FusionPlusOrderStatus, string> = {
  SrcPending: "Source Pending",
  SrcFilled: "Source Filled",
  DstPending: "Bridge in Transit",
  DstFilled: "Completed",
  Failed: "Failed",
  Expired: "Expired",
  Cancelled: "Cancelled",
};

/** Status icons */
export const CROSS_CHAIN_STATUS_ICONS: Record<FusionPlusOrderStatus, string> = {
  SrcPending: "\u23F3",   // ⏳
  SrcFilled: "\u2705",    // ✅
  DstPending: "\uD83C\uDF09",   // 🌉
  DstFilled: "\uD83C\uDF89",    // 🎉
  Failed: "\u274C",       // ❌
  Expired: "\u23F0",      // ⏰
  Cancelled: "\uD83D\uDEAB",    // 🚫
};

/** Progress bar percentages per status */
export const CROSS_CHAIN_STATUS_PROGRESS: Record<FusionPlusOrderStatus, number> = {
  SrcPending: 15,
  SrcFilled: 40,
  DstPending: 70,
  DstFilled: 100,
  Failed: 0,
  Expired: 0,
  Cancelled: 0,
};

/* ══════════════════════════════════════════════════════════════════════
 * Quote Parsing
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Parse a raw preset from the API response into our simplified format.
 */
function parsePreset(
  raw: FusionPresetQuote | undefined,
  name: FusionPreset,
): ParsedCrossChainPreset | null {
  if (!raw) return null;
  return {
    preset: name,
    dstAmount: raw.auctionEndAmount ?? "0",
    auctionDuration: raw.auctionDuration,
    auctionStartAmount: raw.auctionStartAmount,
    auctionEndAmount: raw.auctionEndAmount,
  };
}

/**
 * Parse a full Fusion+ quote response into our convenience type.
 */
function parseCrossChainQuote(res: FusionPlusQuoteResponse): ParsedCrossChainQuote {
  const recommended = res.recommendedPreset ?? "medium";

  const presets: ParsedCrossChainPreset[] = [];
  if (res.presets?.fast) {
    const p = parsePreset(res.presets.fast, "fast");
    if (p) presets.push(p);
  }
  if (res.presets?.medium) {
    const p = parsePreset(res.presets.medium, "medium");
    if (p) presets.push(p);
  }
  if (res.presets?.slow) {
    const p = parsePreset(res.presets.slow, "slow");
    if (p) presets.push(p);
  }

  const now = Date.now();
  return {
    raw: res,
    quoteId: res.quoteId,
    srcChainId: res.srcChainId,
    dstChainId: res.dstChainId,
    srcTokenAmount: res.srcTokenAmount,
    dstTokenAmount: res.dstTokenAmount,
    recommendedPreset: recommended,
    presets,
    estimatedTimeSeconds: res.estimatedTime ?? null,
    fees: {
      srcChainFee: res.fees?.srcChainFee ?? null,
      dstChainFee: res.fees?.dstChainFee ?? null,
      protocolFee: res.fees?.protocolFee ?? null,
    },
    volumeUsd: null,
    fetchedAt: now,
    get isFresh() { return Date.now() - now < CROSS_CHAIN_QUOTE_REFRESH_INTERVAL_MS; },
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * API Functions
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Request a Fusion+ cross-chain swap quote.
 *
 * @param srcChainId         - Source chain EVM ID
 * @param dstChainId         - Destination chain EVM ID
 * @param srcTokenAddress    - Source token address
 * @param dstTokenAddress    - Destination token address
 * @param amount             - Amount in smallest unit (string)
 * @param walletAddress      - User's wallet address
 * @param signal             - Optional AbortSignal for cancellation
 * @returns ParsedCrossChainQuote with per-preset fill estimates
 * @throws OneInchApiError on API failure
 */
export async function getCrossChainQuote(
  srcChainId: number,
  dstChainId: number,
  srcTokenAddress: string,
  dstTokenAddress: string,
  amount: string,
  walletAddress: string,
  signal?: AbortSignal,
): Promise<ParsedCrossChainQuote> {
  // Validate chains support Fusion+
  const srcChain = getChainById(srcChainId);
  const dstChain = getChainById(dstChainId);
  if (!srcChain?.supportsFusionPlus) {
    throw new Error(`Fusion+ is not supported on source chain ${srcChainId} (${srcChain?.name ?? "unknown"})`);
  }
  if (!dstChain?.supportsFusionPlus) {
    throw new Error(`Fusion+ is not supported on destination chain ${dstChainId} (${dstChain?.name ?? "unknown"})`);
  }
  if (srcChainId === dstChainId) {
    throw new Error("Source and destination chains must differ for cross-chain swaps. Use Fusion for same-chain.");
  }

  // Resolve native tokens to wrapped equivalents
  const resolvedSrc = resolveTokenForFusionPlus(srcTokenAddress, srcChainId);
  const resolvedDst = resolveTokenForFusionPlus(dstTokenAddress, dstChainId);

  const body: FusionPlusQuoteParams = {
    srcChainId,
    dstChainId,
    srcTokenAddress: resolvedSrc,
    dstTokenAddress: resolvedDst,
    amount,
    walletAddress,
    enableEstimate: true,
  };

  const cacheKey = `fusion-plus-quote:${srcChainId}:${dstChainId}:${resolvedSrc}:${resolvedDst}:${amount}`;

  log.info(TAG, `Requesting cross-chain quote: ${srcChain.name} -> ${dstChain.name} src=${resolvedSrc.slice(0, 10)}... dst=${resolvedDst.slice(0, 10)}... amount=${amount}`);

  const res = await oneInchApi.post<FusionPlusQuoteResponse & { _trialWinner?: string; _trials?: unknown[] }>(
    `/fusion-plus/quote`,
    body,
    { signal, cacheKey, cacheTtlMs: QUOTE_CACHE_TTL_MS },
  );

  // IMPLEMENTATION NOTE (2026-03-03j): Log multi-trial diagnostic fields from server
  if (res._trialWinner) {
    log.info(TAG, `[MULTI-TRIAL] ✓ Winning URL pattern: ${res._trialWinner}`);
  }
  if ((res as any)._trials) {
    log.warn(TAG, `[MULTI-TRIAL] All trials failed:`, JSON.stringify((res as any)._trials));
  }

  return parseCrossChainQuote(res);
}

/* ══════════════════════════════════════════════════════════════════════
 * Build — Construct EIP-712 typed data for the user to sign
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Response from the Fusion+ build endpoint.
 * Contains EIP-712 typed data that the user signs (gasless).
 */
export interface FusionPlusBuildResponse {
  /** EIP-712 typed data to sign with eth_signTypedData_v4 */
  typedData: unknown;
  /** Order struct for submission */
  order: unknown;
  /** Order hash (used for status tracking) */
  orderHash: string;
  /** Extension data */
  extension: string;
  /** Source secrets for HTLC resolution */
  srcSecrets?: string[];
  /** Secret hashes */
  secretHashes?: string[];
  /** Quote ID (echoed back) */
  quoteId: string;
  /** HTLC secret — generated by server, needed for submitSecret later */
  _secret?: string;
  /** HTLC hashLock — keccak256(secret), committed in the order */
  _hashLock?: string;
  /** Raw response for debugging */
  [key: string]: unknown;
}

/**
 * Build a Fusion+ cross-chain order — returns EIP-712 typed data for signing.
 *
 * IMPLEMENTATION NOTE (Round 3): The /quote/build endpoint needs the FULL
 * swap params (same as /quote/receive), NOT just quoteId. Diagnostics proved
 * that sending only quoteId+walletAddress gets "amount cannot be empty".
 *
 * The response contains typedData that must be signed with
 * eth_signTypedData_v4 — this is a signature, NOT a transaction,
 * so the user pays ZERO gas.
 */
export interface BuildCrossChainParams {
  srcChainId: number;
  dstChainId: number;
  srcTokenAddress: string;
  dstTokenAddress: string;
  amount: string;          // in smallest unit (wei)
  walletAddress: string;
  enableEstimate?: boolean;
  quoteId?: string;        // optional — may help with price locking
  preset?: string;         // fast/medium/slow
}

export async function buildCrossChainOrder(
  params: BuildCrossChainParams,
  signal?: AbortSignal,
): Promise<FusionPlusBuildResponse> {
  // Resolve native tokens to wrapped equivalents (same as getCrossChainQuote)
  const resolvedSrc = resolveTokenForFusionPlus(params.srcTokenAddress, params.srcChainId);
  const resolvedDst = resolveTokenForFusionPlus(params.dstTokenAddress, params.dstChainId);

  const body = {
    srcChainId: params.srcChainId,
    dstChainId: params.dstChainId,
    srcTokenAddress: resolvedSrc,
    dstTokenAddress: resolvedDst,
    amount: params.amount,
    walletAddress: params.walletAddress,
    enableEstimate: params.enableEstimate ?? true,
    ...(params.quoteId ? { quoteId: params.quoteId } : {}),
    ...(params.preset ? { preset: params.preset } : {}),
  };

  log.info(TAG, `Building Fusion+ order: ${params.srcChainId}→${params.dstChainId} amt=${params.amount} wallet=${params.walletAddress}`);

  const res = await oneInchApi.post<FusionPlusBuildResponse>(
    `/fusion-plus/build`,
    body,
    { signal },
  );

  log.info(TAG, `Fusion+ build response: orderHash=${res.orderHash ?? "none"} hasTypedData=${!!res.typedData} keys=[${Object.keys(res).join(",")}]`);
  return res;
}

/* ══════════════════════════════════════════════════════════════════════
 * Submit — Send the signed order to resolvers
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Submit a signed Fusion+ cross-chain order to the resolver network.
 *
 * Calls POST /fusion-plus/submit via our server proxy which forwards to
 * /fusion-plus/relayer/v1.2/submit.
 */
export async function submitCrossChainOrder(
  params: {
    quoteId: string;
    orderHash: string;
    signature: string;
    order: unknown;
    extension: string;
    srcSecrets?: string[];
    secretHashes?: string[];
  },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  log.info(TAG, `Submitting Fusion+ order: orderHash=${params.orderHash}`);

  const res = await oneInchApi.post<Record<string, unknown>>(
    `/fusion-plus/submit`,
    params,
    { signal },
  );

  log.info(TAG, `Fusion+ submit response: ${JSON.stringify(res).slice(0, 200)}`);
  return res;
}

/* ══════════════════════════════════════════════════════════════════════
 * Submit Secret — Reveal HTLC secret for cross-chain settlement
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Submit a secret to resolve an HTLC fill for a Fusion+ order.
 */
export async function submitSecret(
  orderHash: string,
  secret: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  log.info(TAG, `Submitting secret for Fusion+ order: orderHash=${orderHash}`);

  const res = await oneInchApi.post<Record<string, unknown>>(
    `/fusion-plus/submit-secret`,
    { orderHash, secret },
    { signal },
  );

  log.info(TAG, `Fusion+ submit-secret response: ${JSON.stringify(res).slice(0, 200)}`);
  return res;
}

/* ══════════════════════════════════════════════════════════════════════
 * Poll Status — Track order progress across chains
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Parsed order status response.
 */
export interface FusionPlusOrderStatusResponse {
  status: FusionPlusOrderStatus;
  orderHash: string;
  srcChainId?: number;
  dstChainId?: number;
  fills?: unknown[];
  [key: string]: unknown;
}

/**
 * Poll the status of a cross-chain Fusion+ order.
 */
export async function getCrossChainOrderStatus(
  orderHash: string,
  signal?: AbortSignal,
): Promise<FusionPlusOrderStatusResponse> {
  const res = await oneInchApi.get<FusionPlusOrderStatusResponse>(
    `/fusion-plus/status/${orderHash}`,
    { signal },
  );
  return res;
}

/**
 * Check if a cross-chain order is ready to accept secret fills.
 */
export async function getReadyFills(
  orderHash: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return oneInchApi.get<Record<string, unknown>>(
    `/fusion-plus/ready-fills/${orderHash}`,
    { signal },
  );
}

/**
 * Get the secrets associated with an order (for debugging/status).
 */
export async function getOrderSecrets(
  orderHash: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return oneInchApi.get<Record<string, unknown>>(
    `/fusion-plus/secrets/${orderHash}`,
    { signal },
  );
}

/**
 * Poll a cross-chain order until terminal status or timeout.
 *
 * @param orderHash - The order hash to poll
 * @param onStatusChange - Callback for each status change
 * @param signal - Optional abort signal
 * @returns Final status response
 */
export async function pollCrossChainOrder(
  orderHash: string,
  onStatusChange?: (status: FusionPlusOrderStatus, response: FusionPlusOrderStatusResponse) => void,
  signal?: AbortSignal,
): Promise<FusionPlusOrderStatusResponse> {
  const startTime = Date.now();
  let lastStatus: FusionPlusOrderStatus | null = null;

  while (Date.now() - startTime < CROSS_CHAIN_POLL_MAX_DURATION_MS) {
    if (signal?.aborted) throw new DOMException("Polling aborted", "AbortError");

    try {
      const res = await getCrossChainOrderStatus(orderHash, signal);

      if (res.status !== lastStatus) {
        lastStatus = res.status;
        log.info(TAG, `Order ${orderHash.slice(0, 10)}... status: ${res.status}`);
        onStatusChange?.(res.status, res);
      }

      if (isCrossChainTerminalStatus(res.status)) {
        return res;
      }

      // IMPLEMENTATION NOTE: If order is ready for secret fills, we could
      // auto-submit secrets here. For now, log it for manual handling.
      if (res.status === "SrcFilled") {
        log.info(TAG, `Order SrcFilled — checking if ready for secret submission...`);
      }
    } catch (err) {
      // Don't abort polling on transient errors
      log.warn(TAG, `Poll error for ${orderHash.slice(0, 10)}...: ${err}`);
    }

    await new Promise(r => setTimeout(r, CROSS_CHAIN_POLL_INTERVAL_MS));
  }

  throw new Error(`Cross-chain order polling timed out after ${CROSS_CHAIN_POLL_MAX_DURATION_MS / 1000}s`);
}

/* ══════════════════════════════════════════════════════════════════════
 * Utility Functions
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Check if a chain supports Fusion+ cross-chain swaps.
 */
export function isFusionPlusSupported(chainId: number): boolean {
  const chain = getChainById(chainId);
  return !!chain?.supportsFusionPlus;
}

/**
 * Get all chain IDs that support Fusion+.
 */
export function getFusionPlusChainIds(): number[] {
  return FUSION_PLUS_CHAINS.map((c) => c.id);
}

/**
 * Get chains available as destination for a given source chain.
 * Returns all Fusion+ chains except the source chain.
 */
export function getDestinationChains(srcChainId: number) {
  return FUSION_PLUS_CHAINS.filter((c) => c.id !== srcChainId);
}

/**
 * Whether a cross-chain order status is terminal (no more polling needed).
 */
export function isCrossChainTerminalStatus(status: FusionPlusOrderStatus): boolean {
  return status === "DstFilled" || status === "Failed" || status === "Expired" || status === "Cancelled";
}

/**
 * Whether a cross-chain order status is success.
 */
export function isCrossChainSuccessStatus(status: FusionPlusOrderStatus): boolean {
  return status === "DstFilled";
}

/**
 * Format a cross-chain route description.
 * Example: "ETH (Arbitrum) -> Fusion+ -> USDC (Base)"
 */
export function formatCrossChainRoute(
  srcSymbol: string,
  srcChainName: string,
  dstSymbol: string,
  dstChainName: string,
): string {
  return `${srcSymbol} (${srcChainName}) \u2192 1inch Fusion+ \u2192 ${dstSymbol} (${dstChainName})`;
}

/**
 * Format estimated time for display.
 */
export function formatEstimatedTime(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "~2-5 min";
  if (seconds < 60) return `~${seconds}s`;
  const mins = Math.round(seconds / 60);
  return `~${mins} min`;
}

/**
 * Format a cross-chain fee amount for display (in token decimals).
 */
export function formatCrossChainAmount(rawAmount: string, decimals: number): string {
  if (!rawAmount || rawAmount === "0") return "0";
  const str = rawAmount.padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals);
  const trimmed = frac.replace(/0+$/, "");
  const display = trimmed ? `${whole}.${trimmed.slice(0, 6)}` : whole;
  return parseFloat(display).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

/**
 * Persist a cross-chain order hash for tracking (localStorage).
 */
export function persistCrossChainOrderHash(
  orderHash: string,
  srcChainId: number,
  dstChainId: number,
  srcSymbol: string,
  dstSymbol: string,
  srcAmount: string,
): void {
  try {
    const key = "wrappdex:1inch:cross-chain-orders";
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    existing.unshift({
      orderHash,
      srcChainId,
      dstChainId,
      srcSymbol,
      dstSymbol,
      srcAmount,
      createdAt: Date.now(),
    });
    // Keep last 20 orders
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 20)));
  } catch {
    log.warn(TAG, "Failed to persist cross-chain order hash");
  }
}

/**
 * Load persisted cross-chain order hashes from localStorage.
 */
export function loadPersistedCrossChainOrders(): Array<{
  orderHash: string;
  srcChainId: number;
  dstChainId: number;
  srcSymbol: string;
  dstSymbol: string;
  srcAmount: string;
  createdAt: number;
}> {
  try {
    const key = "wrappdex:1inch:cross-chain-orders";
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

/* ======================================================================
 * SDK-Based Cross-Chain Flow (Post Round 6)
 *
 * IMPLEMENTATION NOTE (2026-03-03, SDK Adoption):
 * The /quote/build endpoint is confirmed non-functional (Rounds 1-6).
 * The official @1inch/cross-chain-sdk uses a different flow:
 *   1. GET /quoter/v1.2/quote/receive (quote)
 *   2. Client-side order construction (createEvmOrder)
 *   3. EIP-712 signing (MetaMask)
 *   4. POST /relayer/v1.2/submit (submit)
 *   5. POST /relayer/v1.2/submit/secret (HTLC reveal)
 *
 * This section provides client-side functions for the SDK flow.
 * HTLC secret is generated CLIENT-SIDE (more secure — never sent
 * to server until the reveal step).
 * ====================================================================== */

/**
 * Generate an HTLC secret and hashLock for Fusion+ cross-chain swaps.
 *
 * IMPLEMENTATION NOTE: The secret is generated using crypto.getRandomValues()
 * (CSPRNG). The hashLock uses keccak256 with the first byte zeroed — this
 * matches the SDK's HashLock.forSingleFill() pattern. The secret MUST be
 * kept client-side and only revealed via submitSecret() after SrcFilled.
 *
 * @returns { secret, secretHash, hashLock } — all as 0x-prefixed hex strings
 */
export function generateHtlcSecret(): {
  secret: string;
  secretHash: string;
  hashLock: string;
} {
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);

  const toHex = (b: Uint8Array) => "0x" + Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
  const secret = toHex(secretBytes);

  // IMPLEMENTATION NOTE: keccak256 from viem returns a 0x-prefixed hex string.
  // We convert secretBytes to hex first since viem's keccak256 accepts Hex | ByteArray.
  const secretHash = keccak256(secretBytes);
  // Zero first byte — matches the SDK's HashLock.forSingleFill() pattern
  // Parse the hex hash back to bytes, zero byte 0, convert back to hex
  const hashHexClean = secretHash.slice(2); // remove 0x
  const hlBytes = new Uint8Array(hashHexClean.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  hlBytes[0] = 0;
  const hashLock = toHex(hlBytes);

  log.info(TAG, `Generated HTLC: secret=${secret.slice(0, 14)}... hashLock=${hashLock.slice(0, 14)}...`);
  return { secret, secretHash, hashLock };
}

/**
 * Response from the SDK-based order construction endpoint.
 */
export interface SdkOrderResponse {
  success: boolean;
  /** True when the quote was obtained but order/typedData must be constructed client-side */
  needsClientConstruction?: boolean;
  method: "sdk" | "direct-v1.2" | "direct-v1.0";
  typedData?: unknown;
  order?: unknown;
  orderHash?: string;
  extension?: string;
  quoteId?: string;
  srcTokenAmount?: string;
  dstTokenAmount?: string;
  recommendedPreset?: string;
  rawQuote?: Record<string, unknown>;
  error?: string;
  _diagnostics?: unknown;
  [key: string]: unknown;
}

/**
 * Build a Fusion+ cross-chain order via the SDK-based server endpoint.
 *
 * IMPLEMENTATION NOTE (SDK Adoption): This replaces the old buildCrossChainOrder()
 * which called /fusion-plus/build (Rounds 1-6, all failed). The new endpoint
 * /fusion-plus/sdk-order uses the SDK's approach:
 *   1. Gets a quote via v1.2 quoter
 *   2. Constructs the order (SDK or raw quote data)
 *   3. Returns EIP-712 typed data for client-side signing
 *
 * The hashLock is generated CLIENT-SIDE and sent to the server. The secret
 * is kept client-side until the HTLC reveal step.
 */
export async function sdkBuildCrossChainOrder(
  params: BuildCrossChainParams & { hashLock: string; secretHash?: string },
  signal?: AbortSignal,
): Promise<SdkOrderResponse> {
  const resolvedSrc = resolveTokenForFusionPlus(params.srcTokenAddress, params.srcChainId);
  const resolvedDst = resolveTokenForFusionPlus(params.dstTokenAddress, params.dstChainId);

  const body = {
    srcChainId: params.srcChainId,
    dstChainId: params.dstChainId,
    srcTokenAddress: resolvedSrc,
    dstTokenAddress: resolvedDst,
    amount: params.amount,
    walletAddress: params.walletAddress,
    hashLock: params.hashLock,
    ...(params.secretHash ? { secretHash: params.secretHash } : {}),
    ...(params.quoteId ? { quoteId: params.quoteId } : {}),
  };

  log.info(TAG, `[SDK] Building order: ${params.srcChainId}\u2192${params.dstChainId} amt=${params.amount} hashLock=${params.hashLock.slice(0, 14)}...`);

  const res = await oneInchApi.post<SdkOrderResponse>(
    `/fusion-plus/sdk-order`,
    body,
    { signal, retries: 1 },
  );

  log.info(TAG, `[SDK] Build response: success=${res.success} method=${res.method} orderHash=${res.orderHash?.slice(0, 14) ?? "none"} hasTypedData=${!!res.typedData}`);
  return res;
}

/**
 * Submit a signed cross-chain order via the SDK-based server endpoint.
 *
 * IMPLEMENTATION NOTE: This endpoint forwards to the relayer v1.2/submit
 * endpoint, matching the SDK's submission format. For single-fill orders,
 * secretHashes is omitted (per SDK pattern).
 */
export async function sdkSubmitCrossChainOrder(
  params: {
    srcChainId: number;
    order: unknown;
    signature: string;
    quoteId: string;
    extension?: string;
    secretHashes?: string[];
  },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  log.info(TAG, `[SDK] Submitting order: srcChain=${params.srcChainId} quoteId=${params.quoteId.slice(0, 20)}...`);

  const res = await oneInchApi.post<Record<string, unknown>>(
    `/fusion-plus/sdk-submit`,
    params,
    { signal, retries: 1 },
  );

  log.info(TAG, `[SDK] Submit response: ${JSON.stringify(res).slice(0, 200)}`);
  return res;
}

/**
 * Check SDK health — reports whether the server-side SDK is available
 * and whether the v1.2 quoter is reachable.
 */
export async function getSdkHealth(
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return oneInchApi.get<Record<string, unknown>>(
    `/fusion-plus/sdk-health`,
    { signal, retries: 0 },
  );
}
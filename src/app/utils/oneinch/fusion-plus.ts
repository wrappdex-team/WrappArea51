/**
 * 1inch Fusion+ v1.0 — Cross-Chain Intent-Based Swap Engine
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
 * Fusion+ API v1.0 endpoints. Cross-chain quotes include chainId pairs
 * in the request body (no chainId in URL path).
 *
 * @module oneinch/fusion-plus
 */

import { log } from "../logger";
import { oneInchApi } from "./api-client";
import { getChainById, FUSION_PLUS_CHAINS } from "./chains";
import { NATIVE_TOKEN_ADDRESS } from "./types";
import type {
  FusionPreset,
  FusionPlusQuoteParams,
  FusionPlusQuoteResponse,
  FusionPlusOrderStatus,
  FusionPresetQuote,
} from "./types";

/* ══════════════════════════════════════════════════════════════════════
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
    // IMPLEMENTATION NOTE: The 1inch Fusion+ API requires lowercase addresses.
    return wrapped.toLowerCase();
  }
  // Always lowercase — the Fusion+ API rejects checksummed (mixed-case) addresses
  return address.toLowerCase();
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
    walletAddress: walletAddress.toLowerCase(),
    enableEstimate: true,
  };

  const cacheKey = `fusion-plus-quote:${srcChainId}:${dstChainId}:${resolvedSrc}:${resolvedDst}:${amount}`;

  log.info(TAG, `Requesting cross-chain quote: ${srcChain.name} -> ${dstChain.name} src=${resolvedSrc.slice(0, 10)}... dst=${resolvedDst.slice(0, 10)}... amount=${amount}`);

  const res = await oneInchApi.post<FusionPlusQuoteResponse>(
    `/fusion-plus/quote`,
    body,
    { signal, cacheKey, cacheTtlMs: QUOTE_CACHE_TTL_MS },
  );

  return parseCrossChainQuote(res);
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
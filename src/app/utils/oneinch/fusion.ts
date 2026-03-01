/**
 * 1inch Fusion v2.0 — Gasless Intent-Based Swap Engine
 *
 * Provides the full lifecycle for Fusion swaps:
 *   1. getFusionQuote()     — Request a quote with per-preset fill estimates
 *   2. buildFusionOrder()   — (Step 6) Build EIP-712 typed data for signing
 *   3. submitFusionOrder()  — (Step 7) Submit the signed order to resolvers
 *   4. pollFusionStatus()   — (Step 7) Poll until filled/expired/failed
 *
 * Key differentiator: The user pays ZERO gas. Resolvers (professional
 * market-makers) execute the on-chain swap and pay gas themselves,
 * recovering the cost from the price spread.
 *
 * IMPLEMENTATION NOTE: This module is a thin business-logic layer over
 * the api-client.ts transport. All HTTP concerns (retry, cache, auth,
 * error classification) are handled by the api-client.
 *
 * @module oneinch/fusion
 */

import { log } from "../logger";
import { oneInchApi, OneInchApiError, isAbortError, friendlyErrorMessage } from "./api-client";
import { getChainById, CHAINS } from "./chains";
import type {
  FusionPreset,
  FusionQuoteParams,
  FusionQuoteResponse,
  FusionPresetQuote,
  FusionOrderBuildParams,
  FusionOrderBuildResponse,
  EIP712TypedData,
  FusionOrderSubmitParams,
  FusionOrderStatusResponse,
  FusionOrderStatus,
} from "./types";

/* ══════════════��═══════════════════════════════════════════════════════
 * Constants
 * ══════════════════════════════════════════════════════════════════════ */

const TAG = "1inch:fusion";

/** How long to cache a Fusion quote (10s — quotes are time-sensitive) */
const QUOTE_CACHE_TTL_MS = 10_000;

/** Auto-refresh interval for Fusion quotes (15 seconds) */
export const FUSION_QUOTE_REFRESH_INTERVAL_MS = 15_000;

/** Human-readable labels for each preset */
export const PRESET_LABELS: Record<FusionPreset, string> = {
  fast: "Fast",
  medium: "Medium",
  slow: "Slow",
  custom: "Custom",
};

/** Estimated fill times (fallback if API doesn't return estimatedTime) */
export const PRESET_ESTIMATED_TIMES: Record<FusionPreset, number> = {
  fast: 60,
  medium: 180,
  slow: 600,
  custom: 300,
};

/** Emoji icons for presets */
export const PRESET_ICONS: Record<FusionPreset, string> = {
  fast: "\u26A1",     // ⚡
  medium: "\u23F1",   // ⏱
  slow: "\uD83D\uDCB0", // 💰
  custom: "\u2699",   // ⚙
};

/** Short human descriptions for presets */
export const PRESET_DESCRIPTIONS: Record<FusionPreset, string> = {
  fast: "~1 min fill, slightly lower output",
  medium: "~3 min fill, balanced rate",
  slow: "~10 min fill, best rate",
  custom: "Custom parameters",
};

/* ══════════════════════════════════════════════════════════════════════
 * Fusion Quote
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Parsed Fusion quote — a convenience wrapper around the raw API response
 * with pre-computed display values.
 */
export interface ParsedFusionQuote {
  /** Raw API response */
  readonly raw: FusionQuoteResponse;
  /** Quote ID (needed for build step) */
  readonly quoteId: string;
  /** Source amount (smallest unit) */
  readonly srcTokenAmount: string;
  /** Recommended preset from the API */
  readonly recommendedPreset: FusionPreset;
  /** All available presets with parsed data */
  readonly presets: ParsedPreset[];
  /** Estimated gas the RESOLVER pays (user saves this!) */
  readonly estimatedGasSaved: number | null;
  /** USD volume of the trade */
  readonly volumeUsd: number | null;
  /** Timestamp when this quote was fetched */
  readonly fetchedAt: number;
  /** Whether this quote is still fresh (< 15s old) */
  readonly isFresh: boolean;
}

/** Individual preset with display-ready values */
export interface ParsedPreset {
  /** Preset tier */
  readonly preset: FusionPreset;
  /** Expected output in smallest unit */
  readonly dstAmount: string;
  /** Estimated fill time in seconds */
  readonly estimatedTime: number;
  /** Human-readable fill time (e.g., "~1 min") */
  readonly timeLabel: string;
  /** Auction start amount */
  readonly auctionStartAmount: string;
  /** Auction end amount (worst case) */
  readonly auctionEndAmount: string;
  /** Whether this is the API-recommended preset */
  readonly isRecommended: boolean;
}

/**
 * Format seconds into a human-readable duration.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  if (seconds < 120) return "~1 min";
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
  return `~${(seconds / 3600).toFixed(1)} hr`;
}

/**
 * Parse a raw FusionPresetQuote into a display-ready ParsedPreset.
 */
function parsePreset(
  raw: FusionPresetQuote | undefined,
  presetName: FusionPreset,
  recommended: FusionPreset,
): ParsedPreset | null {
  if (!raw) return null;
  const estimatedTime = raw.estimatedTime ?? PRESET_ESTIMATED_TIMES[presetName];
  return {
    preset: presetName,
    dstAmount: raw.dstAmount,
    estimatedTime,
    timeLabel: formatDuration(estimatedTime),
    auctionStartAmount: raw.auctionStartAmount,
    auctionEndAmount: raw.auctionEndAmount,
    isRecommended: presetName === recommended,
  };
}

/**
 * Parse the full API response into a ParsedFusionQuote.
 */
function parseQuoteResponse(res: FusionQuoteResponse): ParsedFusionQuote {
  const recommended = res.recommendedPreset || "medium";
  const presets: ParsedPreset[] = [];

  for (const tier of ["fast", "medium", "slow"] as const) {
    const parsed = parsePreset(res.presets?.[tier], tier, recommended);
    if (parsed) presets.push(parsed);
  }
  // If the API returned a custom preset, include it too
  if (res.presets?.custom) {
    const parsed = parsePreset(res.presets.custom, "custom", recommended);
    if (parsed) presets.push(parsed);
  }

  const now = Date.now();
  return {
    raw: res,
    quoteId: res.quoteId,
    srcTokenAmount: res.srcTokenAmount,
    recommendedPreset: recommended,
    presets,
    estimatedGasSaved: res.estimatedGas ?? null,
    volumeUsd: res.volume?.usd ? parseFloat(res.volume.usd) : null,
    fetchedAt: now,
    get isFresh() { return Date.now() - now < FUSION_QUOTE_REFRESH_INTERVAL_MS; },
  };
}

/**
 * Request a Fusion gasless swap quote.
 *
 * @param chainId           - EVM chain ID (must support Fusion)
 * @param srcTokenAddress   - Source token address
 * @param dstTokenAddress   - Destination token address
 * @param amount            - Amount in smallest unit (string)
 * @param walletAddress     - User's wallet address
 * @param signal            - Optional AbortSignal for cancellation
 * @returns ParsedFusionQuote with per-preset fill estimates
 * @throws OneInchApiError on API failure
 */
export async function getFusionQuote(
  chainId: number,
  srcTokenAddress: string,
  dstTokenAddress: string,
  amount: string,
  walletAddress: string,
  signal?: AbortSignal,
): Promise<ParsedFusionQuote> {
  // Validate chain supports Fusion
  const chain = getChainById(chainId);
  if (!chain?.supportsFusion) {
    throw new Error(`Fusion is not supported on chain ${chainId} (${chain?.name ?? "unknown"})`);
  }

  const body: FusionQuoteParams = {
    srcTokenAddress,
    dstTokenAddress,
    amount,
    walletAddress,
    enableEstimate: true,
  };

  const cacheKey = `fusion-quote:${chainId}:${srcTokenAddress}:${dstTokenAddress}:${amount}`;

  log.info(TAG, `Requesting Fusion quote: chain=${chainId} ${srcTokenAddress} -> ${dstTokenAddress} amount=${amount}`);

  const res = await oneInchApi.post<FusionQuoteResponse>(
    `/fusion/quote/${chainId}`,
    body,
    { signal, cacheKey, cacheTtlMs: QUOTE_CACHE_TTL_MS },
  );

  if (!res.quoteId || !res.presets) {
    log.warn(TAG, "Fusion quote response missing quoteId or presets", res);
    throw new Error("Invalid Fusion quote response — missing quoteId or presets");
  }

  const parsed = parseQuoteResponse(res);
  log.info(TAG, `Fusion quote received: quoteId=${parsed.quoteId} recommended=${parsed.recommendedPreset} presets=${parsed.presets.length}`);

  return parsed;
}

/* ══════════════════════════════════════════════════════════════════════
 * Chain Support Helpers
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Check if a chain supports Fusion gasless swaps.
 */
export function isFusionSupported(chainId: number): boolean {
  const chain = getChainById(chainId);
  return chain?.supportsFusion ?? false;
}

/**
 * Get the list of chain IDs that support Fusion.
 */
export function getFusionChainIds(): number[] {
  return CHAINS
    .filter(c => c.supportsFusion)
    .map(c => c.id);
}

/* ══════════════════════════════════════════════════════════════════════
 * Display Utilities
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Format a destination amount from smallest unit to human-readable,
 * given the token's decimals.
 */
export function formatFusionAmount(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const str = raw.padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals);
  const trimmed = frac.replace(/0+$/, "");
  const display = trimmed ? `${whole}.${trimmed.slice(0, 8)}` : whole;
  return parseFloat(display).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

/**
 * Calculate the rate difference between two presets as a percentage.
 * Positive = better rate, negative = worse rate.
 */
export function presetRateDifference(
  baseline: ParsedPreset,
  comparison: ParsedPreset,
): number {
  const baseAmt = parseFloat(baseline.dstAmount) || 0;
  const compAmt = parseFloat(comparison.dstAmount) || 0;
  if (baseAmt === 0) return 0;
  return ((compAmt - baseAmt) / baseAmt) * 100;
}

/**
 * Format a gas estimate as a USD savings estimate.
 * Assumes current gas price ~ $0.000003 per gas unit on L1.
 *
 * IMPLEMENTATION NOTE: This is a rough estimate for display purposes.
 * The actual savings depend on the current gas price, which we don't
 * fetch here. Future steps should use the gas price oracle.
 */
export function estimateGasSavingsUsd(
  gasUnits: number,
  chainId: number = 1,
): string {
  // Very rough gas price estimates per chain (USD per gas unit)
  const gasPriceEstimates: Record<number, number> = {
    1: 0.000015,     // Ethereum L1 ~15 gwei @ ~$3k ETH
    56: 0.0000003,   // BSC ~3 gwei @ ~$600 BNB
    137: 0.000000015, // Polygon ~30 gwei @ ~$0.50 POL
    42161: 0.0000001, // Arbitrum ~0.1 gwei (L2 cheap)
    10: 0.0000001,   // Optimism ~0.1 gwei (L2 cheap)
    8453: 0.0000001,  // Base ~0.1 gwei (L2 cheap)
    43114: 0.000002,  // Avalanche ~25 nAVAX
  };

  const pricePerGas = gasPriceEstimates[chainId] ?? 0.000005;
  const savings = gasUnits * pricePerGas;

  if (savings < 0.01) return "< $0.01";
  if (savings < 1) return `~$${savings.toFixed(2)}`;
  return `~$${savings.toFixed(2)}`;
}

/**
 * Get the countdown display string (e.g., "12s") for a quote refresh.
 */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "0s";
  const seconds = Math.ceil(remainingMs / 1000);
  return `${seconds}s`;
}

/* ══════════════════════════════════════════════════════════════════════
 * Step 6 — Fusion Order Building & EIP-712 Signing
 *
 * IMPLEMENTATION NOTE: The Fusion swap lifecycle has two signing-related
 * concerns that are easy to confuse:
 *
 *   1. TOKEN APPROVAL (one-time, costs gas)
 *      The source ERC-20 token must be approved for the 1inch router/
 *      settlement contract. This uses a standard ERC-20 approve() tx.
 *      Native tokens (ETH, POL, BNB) skip this step.
 *
 *   2. ORDER SIGNING (every swap, gasless)
 *      The Fusion order is an EIP-712 typed data struct. The user signs
 *      it with eth_signTypedData_v4. This is a SIGNATURE, not a tx —
 *      zero gas is spent. The signed order is then submitted to
 *      professional resolvers who execute the on-chain swap.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Result of building + signing a Fusion order.
 * Contains everything needed for the Step 7 submit call.
 */
export interface FusionSignedOrder {
  /** Unique order hash */
  readonly orderHash: string;
  /** EIP-712 signature from the user's wallet */
  readonly signature: string;
  /** Quote ID for traceability */
  readonly quoteId: string;
  /** Serialised order struct (pass-through to submit) */
  readonly order?: Record<string, unknown>;
  /** Extension data (pass-through to submit) */
  readonly extension?: string;
  /** The typed data that was signed (for debugging/display) */
  readonly typedData: EIP712TypedData;
}

/**
 * Build a Fusion order — returns EIP-712 typed data ready for signing.
 *
 * Calls POST /fusion/build/:chainId via our server proxy.
 * The response contains typed data that must be signed with
 * eth_signTypedData_v4 — this is a signature, NOT a transaction,
 * so the user pays ZERO gas.
 *
 * @param chainId        - EVM chain ID
 * @param quoteId        - Quote ID from getFusionQuote()
 * @param walletAddress  - User's wallet address
 * @param preset         - Speed preset (fast/medium/slow)
 * @param signal         - Optional AbortSignal
 * @returns FusionOrderBuildResponse with orderHash + typedData
 */
export async function buildFusionOrder(
  chainId: number,
  quoteId: string,
  walletAddress: string,
  preset: FusionPreset,
  signal?: AbortSignal,
): Promise<FusionOrderBuildResponse> {
  const chain = getChainById(chainId);
  if (!chain?.supportsFusion) {
    throw new Error(`Fusion is not supported on chain ${chainId}`);
  }

  const body: FusionOrderBuildParams = {
    quoteId,
    walletAddress,
    preset,
  };

  log.info(TAG, `Building Fusion order: chain=${chainId} quoteId=${quoteId} preset=${preset}`);

  // No caching — each build generates a unique nonce + deadline
  const res = await oneInchApi.post<FusionOrderBuildResponse>(
    `/fusion/build/${chainId}`,
    body,
    { signal },
  );

  if (!res.orderHash || !res.typedData) {
    log.error(TAG, "Fusion build response missing orderHash or typedData", res);
    throw new Error("Invalid Fusion build response — missing orderHash or typedData");
  }

  // Validate EIP-712 structure
  if (!res.typedData.types || !res.typedData.domain || !res.typedData.message) {
    log.error(TAG, "Fusion build response has malformed typedData", res.typedData);
    throw new Error("Malformed EIP-712 typed data in Fusion build response");
  }

  log.info(TAG, `Fusion order built: orderHash=${res.orderHash} primaryType=${res.typedData.primaryType}`);

  return res;
}

/**
 * Sign a Fusion order using EIP-712 typed data signing.
 *
 * Uses eth_signTypedData_v4 — the MetaMask/Rabby standard for
 * structured data signing. The wallet shows a human-readable breakdown
 * of the order fields (maker, taker tokens, amounts, deadline).
 *
 * This is a SIGNATURE, not a TRANSACTION — the user pays zero gas.
 *
 * @param typedData  - EIP-712 typed data from buildFusionOrder()
 * @param account    - The signer's EVM address
 * @returns The hex-encoded EIP-712 signature (65 bytes: r + s + v)
 * @throws Error if the user rejects or wallet is unavailable
 */
export async function signFusionOrder(
  typedData: EIP712TypedData,
  account: string,
): Promise<string> {
  if (!window.ethereum) {
    throw new Error("No EVM wallet detected. Install MetaMask or another wallet.");
  }

  log.info(TAG, `Requesting EIP-712 signature from ${account.slice(0, 8)}... primaryType=${typedData.primaryType}`);

  // IMPLEMENTATION NOTE: eth_signTypedData_v4 expects:
  //   params[0] = signer address (checksummed)
  //   params[1] = JSON.stringify(typedData)
  //
  // The typed data MUST include EIP712Domain in types.
  // The 1inch API returns it pre-built — we pass it through as-is.
  // MetaMask displays a human-readable breakdown of the order.
  const signature = await window.ethereum.request({
    method: "eth_signTypedData_v4",
    params: [account, JSON.stringify(typedData)],
  });

  if (!signature || typeof signature !== "string") {
    throw new Error("Wallet returned an invalid signature");
  }

  log.info(TAG, `EIP-712 signature obtained: ${signature.slice(0, 12)}...${signature.slice(-8)} (${signature.length} chars)`);

  return signature;
}

/**
 * Build AND sign a Fusion order in one call — convenience wrapper.
 *
 * Combines buildFusionOrder() + signFusionOrder() into a single async
 * flow. Returns a FusionSignedOrder containing everything needed for
 * the Step 7 submit call.
 */
export async function buildAndSignFusionOrder(
  chainId: number,
  quoteId: string,
  walletAddress: string,
  preset: FusionPreset,
  signal?: AbortSignal,
): Promise<FusionSignedOrder> {
  // Step 1: Build the order (API call — gets EIP-712 typed data)
  const buildResult = await buildFusionOrder(chainId, quoteId, walletAddress, preset, signal);

  // Step 2: Sign the typed data (wallet popup — no gas!)
  const signature = await signFusionOrder(buildResult.typedData, walletAddress);

  return {
    orderHash: buildResult.orderHash,
    signature,
    quoteId: buildResult.quoteId ?? quoteId,
    order: buildResult.order,
    extension: buildResult.extension,
    typedData: buildResult.typedData,
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * Step 7 — Fusion Order Submission & Status Polling
 *
 * IMPLEMENTATION NOTE: After signing the order, the user submits it
 * to the 1inch Fusion resolvers. The resolvers execute the on-chain
 * swap and pay gas themselves. We poll the status of the order to
 * determine when it is filled, expired, or failed.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Submit a signed Fusion order to the resolvers.
 *
 * Calls POST /fusion/submit/:chainId via our server proxy.
 * The response contains the order hash and status.
 *
 * @param chainId        - EVM chain ID
 * @param orderHash      - Order hash from buildFusionOrder()
 * @param signature      - EIP-712 signature from signFusionOrder()
 * @param quoteId        - Quote ID from getFusionQuote()
 * @param signal         - Optional AbortSignal
 * @returns FusionOrderStatusResponse with order hash and status
 */
export async function submitFusionOrder(
  chainId: number,
  orderHash: string,
  signature: string,
  quoteId: string,
  signal?: AbortSignal,
): Promise<FusionOrderStatusResponse> {
  const chain = getChainById(chainId);
  if (!chain?.supportsFusion) {
    throw new Error(`Fusion is not supported on chain ${chainId}`);
  }

  const body: FusionOrderSubmitParams = {
    orderHash,
    signature,
    quoteId,
  };

  log.info(TAG, `Submitting Fusion order: chain=${chainId} orderHash=${orderHash}`);

  // IMPLEMENTATION NOTE: The 1inch Fusion submit API may return various
  // response shapes (e.g., { success: true }, { orderHash: "0x..." }, or
  // just a 200). We normalise the response so callers always get a
  // consistent FusionOrderStatusResponse with at least orderHash + status.
  const res = await oneInchApi.post<Record<string, unknown>>(
    `/fusion/submit/${chainId}`,
    body,
    { signal },
  );

  const result: FusionOrderStatusResponse = {
    orderHash: (res.orderHash as string) || orderHash,
    status: (res.status as FusionOrderStatus) || "pending",
    srcTokenAddress: res.srcTokenAddress as string | undefined,
    dstTokenAddress: res.dstTokenAddress as string | undefined,
  };

  log.info(TAG, `Fusion order submitted: orderHash=${result.orderHash} status=${result.status}`);

  return result;
}

/**
 * Poll the status of a Fusion order.
 *
 * Calls GET /fusion/status/:chainId/:orderHash via our server proxy.
 * The response contains the order hash and status.
 *
 * @param chainId        - EVM chain ID
 * @param orderHash      - Order hash from buildFusionOrder()
 * @param signal         - Optional AbortSignal
 * @returns FusionOrderStatusResponse with order hash and status
 */
export async function pollFusionStatus(
  chainId: number,
  orderHash: string,
  signal?: AbortSignal,
): Promise<FusionOrderStatusResponse> {
  const chain = getChainById(chainId);
  if (!chain?.supportsFusion) {
    throw new Error(`Fusion is not supported on chain ${chainId}`);
  }

  log.info(TAG, `Polling Fusion order status: chain=${chainId} orderHash=${orderHash}`);

  const res = await oneInchApi.get<FusionOrderStatusResponse>(
    `/fusion/status/${chainId}/${orderHash}`,
    { signal },
  );

  if (!res.orderHash || !res.status) {
    log.error(TAG, "Fusion status response missing orderHash or status", res);
    throw new Error("Invalid Fusion status response — missing orderHash or status");
  }

  log.info(TAG, `Fusion order status: orderHash=${res.orderHash} status=${res.status}`);

  return res;
}

/**
 * Full Fusion submission flow: submit order → poll status → return final status.
 *
 * @param onStatus - Optional callback for UI status updates
 * @returns Final FusionOrderStatusResponse
 * @throws Error if the submission fails or times out
 */
export async function ensureFusionSubmission(
  chainId: number,
  orderHash: string,
  signature: string,
  quoteId: string,
  onStatus?: (status: "submitting" | "waiting" | "filled" | "expired" | "failed") => void,
): Promise<FusionOrderStatusResponse> {
  onStatus?.("submitting");

  const submitRes = await submitFusionOrder(chainId, orderHash, signature, quoteId);

  onStatus?.("waiting");
  const statusRes = await pollFusionStatus(chainId, orderHash);

  if (statusRes.status === "filled") {
    onStatus?.("filled");
    log.info(TAG, "Fusion order filled on-chain");
    return statusRes;
  }

  if (statusRes.status === "expired") {
    onStatus?.("expired");
    log.info(TAG, "Fusion order expired");
    return statusRes;
  }

  if (statusRes.status === "failed") {
    onStatus?.("failed");
    log.info(TAG, "Fusion order failed");
    return statusRes;
  }

  throw new Error("Fusion order did not reach a final status within the expected timeframe");
}

/* ══════════════════════════════════════════════════════════════════════
 * Token Approval Helpers (Permit2 / ERC-20 Approve)
 *
 * Fusion v2.0 requires the source token to be approved for the 1inch
 * router/settlement contract. We reuse the existing /allowance and
 * /approve endpoints from Swap API v6.0 — same spender contract.
 *
 * Native tokens (ETH, POL, BNB) do NOT require approval.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Check if a token is approved for spending by the 1inch router.
 *
 * @returns true if allowance >= amount, false if approval needed
 */
export async function checkFusionAllowance(
  chainId: number,
  tokenAddress: string,
  walletAddress: string,
  amount: string,
): Promise<boolean> {
  try {
    const res = await oneInchApi.get<{ allowance: string; configured?: false }>(
      `/allowance/${chainId}?tokenAddress=${tokenAddress}&walletAddress=${walletAddress}`,
    );
    if (res.configured === false) {
      throw new Error("1inch API key not configured");
    }
    const sufficient = BigInt(res.allowance || "0") >= BigInt(amount);
    log.info(TAG, `Allowance check: token=${tokenAddress.slice(0, 10)}... allowance=${res.allowance} required=${amount} ok=${sufficient}`);
    return sufficient;
  } catch (err) {
    log.warn(TAG, "Allowance check failed, assuming approval needed", err);
    return false;
  }
}

/**
 * Send an approval transaction for the 1inch router to spend a token.
 *
 * IMPLEMENTATION NOTE: This is the ONE place in Fusion where the user
 * pays gas — a single ERC-20 approve() call. After this, all Fusion
 * swaps for this token are gasless. We request max approval to avoid
 * repeated approval txs.
 *
 * @returns Transaction hash of the approval
 */
export async function sendApprovalTransaction(
  chainId: number,
  tokenAddress: string,
  amount?: string,
): Promise<string> {
  if (!window.ethereum) {
    throw new Error("No EVM wallet detected");
  }

  log.info(TAG, `Requesting approval tx: chain=${chainId} token=${tokenAddress.slice(0, 10)}...`);

  const res = await oneInchApi.get<{
    to: string; data: string; value: string; gas?: number; configured?: false;
  }>(
    `/approve/${chainId}?tokenAddress=${tokenAddress}${amount ? `&amount=${amount}` : ""}`,
  );

  if (res.configured === false) throw new Error("1inch API key not configured");
  if (!res.to || !res.data) throw new Error("Invalid approval response from 1inch");

  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  const from = accounts?.[0];
  if (!from) throw new Error("No connected account");

  const txHash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from,
      to: res.to,
      data: res.data,
      value: res.value || "0x0",
      ...(res.gas ? { gas: "0x" + res.gas.toString(16) } : {}),
    }],
  });

  log.info(TAG, `Approval tx sent: ${txHash}`);
  return txHash;
}

/**
 * Wait for a transaction to be mined (poll for receipt).
 *
 * @param txHash    - Transaction hash to wait for
 * @param timeoutMs - Maximum wait time (default: 60s)
 * @returns true if mined successfully
 * @throws Error if the transaction reverted
 */
export async function waitForTransaction(
  txHash: string,
  timeoutMs: number = 60_000,
): Promise<boolean> {
  if (!window.ethereum) return false;

  const deadline = Date.now() + timeoutMs;
  const pollInterval = 2_000;

  log.info(TAG, `Waiting for tx ${txHash.slice(0, 12)}... (timeout: ${timeoutMs / 1000}s)`);

  while (Date.now() < deadline) {
    try {
      const receipt = await window.ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      });
      if (receipt) {
        const status = receipt.status;
        const success = status === "0x1" || status === 1 || status === true;
        log.info(TAG, `Tx ${txHash.slice(0, 12)}... mined: status=${status} success=${success}`);
        if (!success) throw new Error(`Transaction reverted: ${txHash}`);
        return true;
      }
    } catch (err: any) {
      if (err?.message?.includes("reverted")) throw err;
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }

  log.warn(TAG, `Tx ${txHash.slice(0, 12)}... not mined within ${timeoutMs / 1000}s`);
  return false;
}

/**
 * Full Fusion approval flow: check allowance → approve if needed → wait for mining.
 *
 * @param onStatus - Optional callback for UI status updates
 * @returns true if approved and ready
 * @throws Error if the approval tx fails or times out
 */
export async function ensureFusionApproval(
  chainId: number,
  tokenAddress: string,
  walletAddress: string,
  amount: string,
  onStatus?: (status: "checking" | "approving" | "waiting" | "approved") => void,
): Promise<boolean> {
  onStatus?.("checking");

  const isApproved = await checkFusionAllowance(chainId, tokenAddress, walletAddress, amount);
  if (isApproved) {
    log.info(TAG, "Token already approved for Fusion");
    onStatus?.("approved");
    return true;
  }

  onStatus?.("approving");
  log.info(TAG, "Token needs approval for Fusion — sending approval tx");

  const txHash = await sendApprovalTransaction(chainId, tokenAddress);

  onStatus?.("waiting");
  const mined = await waitForTransaction(txHash, 60_000);

  if (mined) {
    onStatus?.("approved");
    log.info(TAG, "Fusion approval confirmed on-chain");
    return true;
  }

  throw new Error("Approval transaction was not confirmed within 60 seconds");
}

/* ══════════════════════════════════════════════════════════════════════
 * Fusion Order Status Display Helpers
 *
 * IMPLEMENTATION NOTE: These helpers translate the raw FusionOrderStatus
 * into user-facing labels, colours, and progress fractions for the UI.
 * Terminal states (filled, expired, cancelled, failed) have distinct
 * visual treatments so the user knows the outcome immediately.
 * ══════════════════════════════════════════════════════════════════════ */

/** Whether a Fusion order status is terminal (no more polling needed). */
export function isFusionTerminalStatus(status: FusionOrderStatus): boolean {
  return status === "filled" || status === "expired" || status === "cancelled" || status === "failed";
}

/** Whether the outcome was successful. */
export function isFusionSuccessStatus(status: FusionOrderStatus): boolean {
  return status === "filled";
}

/** Human-readable label for each order status. */
export const FUSION_STATUS_LABELS: Record<FusionOrderStatus, string> = {
  pending:   "Waiting for resolver…",
  assigned:  "Resolver picked up order!",
  executing: "Swap executing on-chain…",
  filled:    "Swap complete!",
  expired:   "Order expired — no resolver filled it",
  cancelled: "Order cancelled",
  failed:    "Resolver tx failed",
};

/** Emoji icon for each status (used in the progress UI). */
export const FUSION_STATUS_ICONS: Record<FusionOrderStatus, string> = {
  pending:   "⏳",
  assigned:  "🤝",
  executing: "⛓️",
  filled:    "✅",
  expired:   "⏰",
  cancelled: "🚫",
  failed:    "❌",
};

/** Progress fraction 0–1 for each status (for progress bar). */
export const FUSION_STATUS_PROGRESS: Record<FusionOrderStatus, number> = {
  pending:   0.2,
  assigned:  0.5,
  executing: 0.8,
  filled:    1.0,
  expired:   1.0,
  cancelled: 1.0,
  failed:    1.0,
};

/** Default polling interval (3 seconds). */
export const FUSION_POLL_INTERVAL_MS = 3_000;

/** Maximum polling duration (10 minutes — Fusion slow orders can take a while). */
export const FUSION_POLL_MAX_DURATION_MS = 10 * 60 * 1000;
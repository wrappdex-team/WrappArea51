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
import { getEthereumProvider } from "../metamask";
import { oneInchApi, OneInchApiError, isAbortError, friendlyErrorMessage } from "./api-client";
import { getChainById, CHAINS } from "./chains";
import { NATIVE_TOKEN_ADDRESS } from "./types";
import { getAddress } from "viem";
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

/* ════════════════════════════════════════════════════════════════════
 * Constants
 * ══════════════════════════════════════════════════════════════════════ */

const TAG = "1inch:fusion";

/** How long to cache a Fusion quote (10s — quotes are time-sensitive) */
const QUOTE_CACHE_TTL_MS = 10_000;

/* ══════════════════════════════════════════════════════════════════════
 * Proxy Deployment Verification
 *
 * IMPLEMENTATION NOTE: pingFusionProxy() is called once (lazily) when
 * the first Fusion quote is attempted. It hits GET /1inch/ping on our
 * server — a zero-upstream-call diagnostic endpoint — and logs whether
 * the Fusion v2 field mapping fix (fromTokenAddress/toTokenAddress) is
 * deployed. If the endpoint 404s, the OLD server is still live and the
 * "invalid address" bug will still occur.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Deployment status of the 1inch server proxy.
 *   "unknown"      — ping not yet attempted
 *   "v2-deployed"  — server has fromTokenAddress/toTokenAddress fix + EIP-55 checksumming
 *   "old-server"   — /1inch/ping returned 404 → old server still deployed
 *   "unreachable"  — ping failed for a non-deployment reason (network, timeout)
 */
export type FusionProxyStatus = "unknown" | "v2-deployed" | "old-server" | "unreachable";

let _proxyPinged = false;
let _proxyStatus: FusionProxyStatus = "unknown";

/** Return the current proxy deployment status (set after first ping). */
export function getFusionProxyStatus(): FusionProxyStatus {
  return _proxyStatus;
}

async function pingFusionProxy(): Promise<void> {
  if (_proxyPinged) return;
  _proxyPinged = true;
  try {
    const ping = await oneInchApi.get<{
      ok?: boolean;
      fusionFieldMapping?: string;
      serverBuild?: string;
      fusionChecksumming?: string;
    }>("/ping", { timeout: 4_000, retries: 0 });

    if (ping.fusionFieldMapping === "v2") {
      _proxyStatus = "v2-deployed";
      log.info(TAG,
        `[DIAG] ✅ Server v2 deployed — build=${ping.serverBuild}`,
        `\n  fusionFieldMapping=fromTokenAddress/toTokenAddress`,
        `\n  fusionChecksumming=${ping.fusionChecksumming ?? "unknown"}`,
      );
    } else {
      _proxyStatus = "old-server";
      log.warn(TAG, `[DIAG] ⚠️ Server ping returned unexpected payload (may be old): ${JSON.stringify(ping)}`);
    }
  } catch (e: any) {
    if (e?.status === 404 || e?.kind === "ROUTE_NOT_FOUND") {
      _proxyStatus = "old-server";
      log.warn(TAG,
        `[DIAG] ❌ GET /1inch/ping → 404 — OLD SERVER STILL DEPLOYED.`,
        `\n  The srcTokenAddress→fromTokenAddress field mapping fix is NOT live.`,
        `\n  Fusion quotes will fail with "invalid address" until deployed.`,
        `\n  FIX: supabase functions deploy make-server-54299934`,
      );
    } else {
      _proxyStatus = "unreachable";
      log.warn(TAG, `[DIAG] Proxy ping failed (non-critical): ${e?.message ?? e}`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * Native → Wrapped Token Address Mapping
 *
 * IMPLEMENTATION NOTE: The Fusion API operates on ERC-20 tokens ONLY.
 * It does NOT accept the "native placeholder" address
 * (0xEeee...eeEE) that the Classic Swap API v6.0 uses for ETH/POL/BNB.
 * When a user selects a native token for a Fusion swap, we must
 * silently replace it with the wrapped ERC-20 equivalent (WETH, WPOL,
 * WBNB, etc.) before sending the quote/build request. The UI still
 * shows "ETH" — the resolver handles wrapping internally.
 * ═════════════════════════════════════════════════════════════════════ */

const WRAPPED_NATIVE_BY_CHAIN: Record<number, string> = {
  1:     "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH (Ethereum)
  56:    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB (BSC)
  137:   "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WPOL (Polygon)
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH (Arbitrum)
  10:    "0x4200000000000000000000000000000000000006", // WETH (Optimism)
  8453:  "0x4200000000000000000000000000000000000006", // WETH (Base)
  43114: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX (Avalanche)
  100:   "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", // WXDAI (Gnosis)
};

/**
 * Resolve a token address for Fusion API calls. If the address is the
 * native placeholder (0xEeee…eeEE), return the wrapped ERC-20 address
 * for the given chain. Otherwise, return the address as-is.
 */
function resolveTokenForFusion(address: string, chainId: number): string {
  if (address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
    const wrapped = WRAPPED_NATIVE_BY_CHAIN[chainId];
    if (!wrapped) {
      throw new Error(
        `No wrapped native token configured for chain ${chainId}. ` +
        `Fusion cannot swap native tokens without a wrapped equivalent.`
      );
    }
    log.info(TAG, `Resolved native token → ${wrapped.slice(0, 10)}... (chain ${chainId})`);
    // IMPLEMENTATION NOTE: Return EIP-55 checksummed address via viem's getAddress.
    // The 1inch Fusion API v2.0 STRICTLY requires EIP-55 checksummed addresses —
    // any deviation (lowercase, wrong mixed-case) causes "invalid address" rejections.
    return getAddress(wrapped);
  }
  // IMPLEMENTATION NOTE: Always ensure EIP-55 checksum via viem's getAddress.
  // Token addresses from the 1inch Token API, user-selected tokens, or the
  // widget's POPULAR_TOKENS list may arrive with inconsistent casing.
  // The Fusion API rejects anything that isn't strict EIP-55.
  try {
    return getAddress(address);
  } catch {
    // If getAddress throws (truly invalid address), return as-is and let the API reject it
    log.warn(TAG, `Could not checksum address: ${address} — passing through as-is`);
    return address;
  }
}

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
 * Parse a raw preset from 1inch Fusion Quoter v2.0 into a display-ready ParsedPreset.
 *
 * IMPLEMENTATION NOTE: The actual v2.0 API response uses different field names than
 * our original type definitions (based on early/unofficial docs):
 *   - `startAmount`      (actual) vs `dstAmount`      (our type)
 *   - `auctionDuration`  (actual) vs `estimatedTime`  (our type)
 *
 * This parser handles BOTH naming conventions for forward + backward compatibility.
 */
function parsePreset(
  raw: Record<string, unknown> | undefined,
  presetName: FusionPreset,
  recommended: FusionPreset,
): ParsedPreset | null {
  if (!raw) return null;
  // v2.0 actual: auctionDuration | Our old type: estimatedTime | Fallback: hardcoded per-tier
  const estimatedTime =
    (typeof raw.auctionDuration === "number" ? raw.auctionDuration : null) ??
    (typeof raw.estimatedTime === "number" ? raw.estimatedTime : null) ??
    PRESET_ESTIMATED_TIMES[presetName];
  // v2.0 actual: startAmount | Also accept: auctionStartAmount | Our old type: dstAmount
  const dstAmount =
    (typeof raw.startAmount === "string" ? raw.startAmount : null) ??
    (typeof raw.auctionStartAmount === "string" ? raw.auctionStartAmount : null) ??
    (typeof raw.dstAmount === "string" ? raw.dstAmount : null) ??
    "0";
  const auctionStartAmount =
    (typeof raw.auctionStartAmount === "string" ? raw.auctionStartAmount : null) ?? dstAmount;
  const auctionEndAmount =
    (typeof raw.auctionEndAmount === "string" ? raw.auctionEndAmount : null) ?? "0";

  return {
    preset: presetName,
    dstAmount,
    estimatedTime,
    timeLabel: formatDuration(estimatedTime),
    auctionStartAmount,
    auctionEndAmount,
    isRecommended: presetName === recommended,
  };
}

/**
 * Parse the full API response into a ParsedFusionQuote.
 *
 * IMPLEMENTATION NOTE: The 1inch Fusion Quoter v2.0 response uses field names
 * that differ from our original type definitions:
 *   - `recommended_preset` (actual, snake_case) vs `recommendedPreset` (our type, camelCase)
 *   - `fromTokenAmount`    (actual) vs `srcTokenAmount` (our type)
 *   - `volume.usd`         (actual: { fromToken, toToken } object) vs (our type: string)
 *
 * This parser handles BOTH naming conventions to ensure compatibility regardless
 * of which version of the API responds.
 */
function parseQuoteResponse(res: FusionQuoteResponse): ParsedFusionQuote {
  // Cast to any for accessing actual v2.0 field names alongside our typed ones
  const raw = res as unknown as Record<string, unknown>;

  // v2.0 actual: recommended_preset (snake_case) | Our type: recommendedPreset (camelCase)
  const recommended: FusionPreset =
    (typeof raw.recommended_preset === "string" ? raw.recommended_preset as FusionPreset : null) ??
    (typeof raw.recommendedPreset === "string" ? raw.recommendedPreset as FusionPreset : null) ??
    "medium";

  const presets: ParsedPreset[] = [];
  const presetsObj = raw.presets as Record<string, Record<string, unknown>> | undefined;

  if (presetsObj) {
    for (const tier of ["fast", "medium", "slow"] as const) {
      const parsed = parsePreset(presetsObj[tier], tier, recommended);
      if (parsed) presets.push(parsed);
    }
    // If the API returned a custom preset, include it too
    if (presetsObj.custom) {
      const parsed = parsePreset(presetsObj.custom, "custom", recommended);
      if (parsed) presets.push(parsed);
    }
  }

  // v2.0 actual: fromTokenAmount | Our type: srcTokenAmount
  const srcTokenAmount =
    (typeof raw.fromTokenAmount === "string" ? raw.fromTokenAmount : null) ??
    (typeof raw.srcTokenAmount === "string" ? raw.srcTokenAmount : null) ??
    "";

  // v2.0 actual: volume.usd is { fromToken: string, toToken: string }
  // Our old type: volume.usd is a string
  let volumeUsd: number | null = null;
  if (raw.volume && typeof raw.volume === "object") {
    const vol = (raw.volume as Record<string, unknown>).usd;
    if (typeof vol === "string") {
      volumeUsd = parseFloat(vol);
    } else if (vol && typeof vol === "object") {
      const volObj = vol as Record<string, string>;
      // Use fromToken USD volume as the trade volume
      const fromVal = volObj.fromToken ?? volObj.toToken;
      if (fromVal) volumeUsd = parseFloat(fromVal);
    }
  }

  // v2.0 response has gasCost in presets, not top-level estimatedGas
  const estimatedGas = typeof raw.estimatedGas === "number" ? raw.estimatedGas : null;

  const now = Date.now();
  return {
    raw: res,
    quoteId:
      // IMPLEMENTATION NOTE: 1inch v2.0 may return quoteId as "quoteId" or "quote_id" (snake_case)
      // — same pattern as recommended_preset. Also check id as fallback.
      (typeof res.quoteId === "string" && res.quoteId ? res.quoteId : null) ??
      (typeof raw.quoteId === "string" && (raw.quoteId as string) ? (raw.quoteId as string) : null) ??
      (typeof raw.quote_id === "string" && (raw.quote_id as string) ? (raw.quote_id as string) : null) ??
      (typeof raw.id === "string" && (raw.id as string) ? (raw.id as string) : null) ??
      "",
    srcTokenAmount,
    recommendedPreset: recommended,
    presets,
    estimatedGasSaved: estimatedGas,
    volumeUsd,
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
 * @param enableEstimate    - Whether to validate balance+approval on-chain (default: false).
 *                            Set to true for the "execution quote" (after approval) — this
 *                            is REQUIRED to get a valid quoteId from the 1inch Fusion Quoter.
 *                            The 1inch.io website uses a 2-phase approach:
 *                              Phase 1 (display): enableEstimate=false → fast price display
 *                              Phase 2 (execute): enableEstimate=true  → gets real quoteId
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
  enableEstimate: boolean = false,
): Promise<ParsedFusionQuote> {
  // Validate chain supports Fusion
  const chain = getChainById(chainId);
  if (!chain?.supportsFusion) {
    throw new Error(`Fusion is not supported on chain ${chainId} (${chain?.name ?? "unknown"})`);
  }

  // [DIAG] One-time ping to confirm the v2 field mapping fix is deployed
  pingFusionProxy().catch(() => {});

  const resolvedSrc = resolveTokenForFusion(srcTokenAddress, chainId);
  const resolvedDst = resolveTokenForFusion(dstTokenAddress, chainId);
  const checksummedWallet = (() => {
    try { return getAddress(walletAddress); } catch { return walletAddress; }
  })();

  // IMPLEMENTATION NOTE — Dual field name strategy (backward + forward compatible):
  //
  // 1inch Fusion Quoter v2.0 requires `fromTokenAddress` / `toTokenAddress`.
  // Our server proxy validates using `srcTokenAddress` / `dstTokenAddress` (our
  // internal naming convention), then remaps to the upstream field names.
  //
  // However, older server deployments forwarded the client body as-is to 1inch.
  // By including BOTH naming conventions we handle both scenarios without code change:
  //   • Old server (body forwarded as-is)  → 1inch sees fromToken/toToken  ✅
  //   • New server (explicit field mapping) → uses srcToken/dstToken for validation,
  //     rebuilds upstream body with fromToken/toToken                       ✅
  //
  // Extra unknown fields in the 1inch JSON body are silently ignored — no side-effects.
  const body: FusionQuoteParams & { fromTokenAddress: string; toTokenAddress: string } = {
    // Old server field names (used for proxy validation + new-server mapping)
    srcTokenAddress: resolvedSrc,
    dstTokenAddress: resolvedDst,
    // New field names — directly consumed by 1inch Fusion Quoter v2.0
    // if the body is forwarded as-is by an older server deployment
    fromTokenAddress: resolvedSrc,
    toTokenAddress:   resolvedDst,
    amount,
    // EIP-55 checksummed wallet — Fusion API v2.0 requires strict mixed-case format
    walletAddress: checksummedWallet,
    // IMPLEMENTATION NOTE: enableEstimate MUST be false for Hedera EVM wallets.
    //
    // When enableEstimate=true, 1inch Fusion Quoter v2.0 calls the on-chain
    // Settlement contract (simulateTransfer) to validate the wallet's:
    //   1. Token approval for the 1inch router
    //   2. Sufficient token balance
    //
    // A Hedera EVM address (e.g. 0x4bd5190073e6d2e23ac278a7b7f540753fe6981f)
    // has ZERO state on Ethereum mainnet — no tokens, no approvals, no nonce.
    // When 1inch simulates against this wallet, the call reverts and 1inch
    // returns 400 "invalid address" (their generic simulation failure code).
    //
    // Setting enableEstimate=false skips the on-chain simulation entirely.
    // The quote returns pricing/preset data based purely on the token pair
    // and amount, which is all we need at the quote stage. Token approvals
    // are handled separately by ensureFusionApproval() before order build.
    enableEstimate,
  };

  // [DIAG] Verbose logging — shows both field name sets sent to the server
  log.info(TAG, `[DIAG] Fusion quote body:`,
    `\n  chain=${chainId}`,
    `\n  srcTokenAddress=${resolvedSrc}  ← server validation`,
    `\n  fromTokenAddress=${resolvedSrc} ← 1inch Quoter v2.0 upstream`,
    `\n  dstTokenAddress=${resolvedDst}  ← server validation`,
    `\n  toTokenAddress=${resolvedDst}   ← 1inch Quoter v2.0 upstream`,
    `\n  walletAddress=${checksummedWallet}`,
    `\n  amount=${amount}`,
    `\n  enableEstimate=${enableEstimate} ← MUST be false for Hedera EVM wallets`,
    `\n  [dual-field=ON, enableEstimate=OFF — works for all wallets]`,
  );

  const res = await oneInchApi.post<FusionQuoteResponse>(
    `/fusion/quote/${chainId}`,
    body,
    { signal },
  );

  // IMPLEMENTATION NOTE: The v2.0 docs show quoteId can be null for some
  // quote responses (e.g., when no resolver is available). We should only
  // fail hard if presets are completely missing — a null quoteId is acceptable
  // at the quote stage (it becomes required only for order/build).
  if (!res.presets) {
    log.warn(TAG, "Fusion quote response missing presets — full response:", JSON.stringify(res).slice(0, 500));
    throw new Error("Invalid Fusion quote response — missing presets");
  }

  // [DIAG] Log ALL top-level keys and quoteId candidates so we can see what field
  // name 1inch actually returns (quoteId vs quote_id vs id vs something else)
  const rawKeys = Object.keys(res as Record<string, unknown>);
  const rawObj = res as Record<string, unknown>;
  log.info(TAG, `[DIAG] Quote response top-level keys: [${rawKeys.join(", ")}]`);
  log.info(TAG, `[DIAG] quoteId candidates:`,
    `\n  res.quoteId=${JSON.stringify(rawObj.quoteId)}`,
    `\n  res.quote_id=${JSON.stringify(rawObj.quote_id)}`,
    `\n  res.id=${JSON.stringify(rawObj.id)}`,
    `\n  typeof quoteId=${typeof rawObj.quoteId}`,
    `\n  full response (first 800 chars)=${JSON.stringify(res).slice(0, 800)}`,
  );

  const parsed = parseQuoteResponse(res);
  // [DIAG] Log the quoteId value AND which field it came from — critical for debugging build failures
  const _qidSource =
    (typeof rawObj.quoteId === "string" && rawObj.quoteId) ? `quoteId="${rawObj.quoteId}"` :
    (typeof rawObj.quote_id === "string" && rawObj.quote_id) ? `quote_id="${rawObj.quote_id}"` :
    (typeof rawObj.id === "string" && rawObj.id) ? `id="${rawObj.id}" ← FALLBACK FIELD (might not be a real quoteId!)` :
    "NONE";
  log.info(TAG, `[DIAG] quoteId source: ${_qidSource} → parsed="${parsed.quoteId}"`);
  log.info(TAG, `Fusion quote received: quoteId=${parsed.quoteId || "(EMPTY)"} recommended=${parsed.recommendedPreset} presets=${parsed.presets.length}`);

  // IMPLEMENTATION NOTE: If quoteId is empty, the order build step will fail.
  // Warn prominently so it's visible in console.
  if (!parsed.quoteId) {
    log.warn(TAG, `⚠️ QUOTE HAS NO quoteId — the build step WILL fail. This may mean:`
      + `\n  1. The trade amount is too small for resolvers to profit`
      + `\n  2. The token pair has no Fusion liquidity`
      + `\n  3. 1inch returned quoteId under a different field name (check DIAG logs above)`);
  }

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
    // IMPLEMENTATION NOTE: Checksum wallet address for Fusion Relayer v2.0
    walletAddress: (() => { try { return getAddress(walletAddress); } catch { return walletAddress; } })(),
    preset,
  };

  log.info(TAG, `Building Fusion order: chain=${chainId} quoteId=${quoteId} wallet=${walletAddress} preset=${preset} path=/fusion/build/${chainId}`);

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
  const _eth = getEthereumProvider();
  if (!_eth) {
    throw new Error("No EVM wallet detected. Install MetaMask or another wallet.");
  }

  // IMPLEMENTATION NOTE: eth_signTypedData_v4 expects:
  //   params[0] = signer address (checksummed — MetaMask requires exact match)
  //   params[1] = JSON.stringify(typedData)
  //
  // The typed data MUST include EIP712Domain in types.
  // The 1inch API returns it pre-built — we pass it through as-is.
  // MetaMask displays a human-readable breakdown of the order.

  // [DIAG] Log all addresses involved for debugging "invalid address" errors
  const domain = typedData?.domain;
  log.info(TAG, `Requesting EIP-712 signature:`,
    `\n  signer=${account}`,
    `\n  primaryType=${typedData.primaryType}`,
    `\n  domain.name=${domain?.name}`,
    `\n  domain.verifyingContract=${domain?.verifyingContract}`,
    `\n  domain.chainId=${domain?.chainId}`,
    `\n  message keys=${Object.keys(typedData?.message ?? {}).join(",")}`,
  );

  // [DIAG] Verify the signer account matches a wallet account
  try {
    const walletAccounts: string[] = await _eth.request({ method: "eth_accounts" });
    const signerLower = account.toLowerCase();
    const match = walletAccounts.find(a => a.toLowerCase() === signerLower);
    if (!match) {
      log.warn(TAG, `SIGNER MISMATCH: ${account} not in wallet accounts [${walletAccounts.join(", ")}]`);
    } else if (match !== account) {
      // MetaMask returns checksummed addresses — use the wallet's version to avoid "invalid address"
      log.info(TAG, `Using wallet's checksummed address: ${match} (was: ${account})`);
      account = match;
    }
  } catch { /* non-critical diagnostic */ }

  const signature = await _eth.request({
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
 * ═════════════════════════════════════════════════════════════════════ */

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
  const _eth = getEthereumProvider();
  if (!_eth) {
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

  const accounts = await _eth.request({ method: "eth_accounts" });
  const from = accounts?.[0];
  if (!from) throw new Error("No connected account");

  const txHash = await _eth.request({
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
  const _eth = getEthereumProvider();
  if (!_eth) return false;

  const deadline = Date.now() + timeoutMs;
  const pollInterval = 2_000;

  log.info(TAG, `Waiting for tx ${txHash.slice(0, 12)}... (timeout: ${timeoutMs / 1000}s)`);

  while (Date.now() < deadline) {
    try {
      const receipt = await _eth.request({
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

/* ══════════════════════════════════════════════════════════════════════
 * Step 8 — Active Order Fetching & Order Status Lookup
 *
 * IMPLEMENTATION NOTE: These functions support the OneInchOrderTracker
 * component. Active orders are fetched from the Fusion Orders API via
 * our proxy. Individual order status lookups are used for tracking
 * localStorage-persisted order hashes across sessions.
 * ══════════════════════════════════════════════════════════════════════ */

/** Tracker polling interval (5 seconds for the order dashboard). */
export const TRACKER_POLL_INTERVAL_MS = 5_000;

/** LocalStorage key for persisted order hashes */
export const ORDER_HISTORY_KEY = "wrappdex:fusion:order-history";

/** Maximum number of order hashes to persist in localStorage */
export const MAX_PERSISTED_ORDERS = 50;

/**
 * A single tracked order — combines API response with display metadata.
 */
export interface TrackedOrder {
  /** Order hash */
  readonly orderHash: string;
  /** Chain ID */
  readonly chainId: number;
  /** Current status */
  readonly status: FusionOrderStatus;
  /** Source token address */
  readonly srcTokenAddress?: string;
  /** Destination token address */
  readonly dstTokenAddress?: string;
  /** Input amount (smallest unit) */
  readonly srcTokenAmount?: string;
  /** Output amount (smallest unit) */
  readonly dstTokenAmount?: string;
  /** ISO 8601 creation timestamp */
  readonly createdAt?: string;
  /** ISO 8601 fill timestamp */
  readonly filledAt?: string;
  /** Resolver address */
  readonly resolverAddress?: string;
  /** On-chain fill tx hash */
  readonly txHash?: string;
  /** Whether this order came from localStorage (history) vs active API */
  readonly isHistorical?: boolean;
}

/**
 * Fetch active (unfilled) Fusion orders for a wallet on a given chain.
 *
 * @param chainId       - EVM chain ID
 * @param walletAddress - User's EVM wallet address
 * @param signal        - Optional AbortSignal
 * @returns Array of active orders
 */
export async function fetchActiveOrders(
  chainId: number,
  walletAddress: string,
  signal?: AbortSignal,
): Promise<TrackedOrder[]> {
  if (!isFusionSupported(chainId)) return [];

  try {
    const res = await oneInchApi.get<{ orders?: FusionOrderStatusResponse[] }>(
      `/fusion/active/${chainId}?walletAddress=${walletAddress}`,
      { signal, timeout: 10_000 },
    );

    const orders = res.orders ?? (Array.isArray(res) ? res : []);

    return orders.map((o: FusionOrderStatusResponse) => ({
      orderHash: o.orderHash,
      chainId,
      status: o.status,
      srcTokenAddress: o.srcTokenAddress,
      dstTokenAddress: o.dstTokenAddress,
      srcTokenAmount: o.srcTokenAmount,
      dstTokenAmount: o.dstTokenAmount,
      createdAt: o.createdAt,
      filledAt: o.filledAt,
      resolverAddress: o.resolverAddress,
      txHash: o.txHash,
      isHistorical: false,
    }));
  } catch (err) {
    if (isAbortError(err)) throw err;
    log.warn(TAG, `Failed to fetch active orders for chain ${chainId}`, err);
    return [];
  }
}

/**
 * Fetch the status of a single Fusion order by hash.
 *
 * @param chainId   - EVM chain ID
 * @param orderHash - The order hash
 * @param signal    - Optional AbortSignal
 * @returns Order status or null if not found
 */
export async function fetchOrderStatus(
  chainId: number,
  orderHash: string,
  signal?: AbortSignal,
): Promise<TrackedOrder | null> {
  try {
    const res = await oneInchApi.get<FusionOrderStatusResponse>(
      `/fusion/status/${chainId}/${orderHash}`,
      { signal, timeout: 10_000 },
    );

    return {
      orderHash: res.orderHash || orderHash,
      chainId,
      status: res.status,
      srcTokenAddress: res.srcTokenAddress,
      dstTokenAddress: res.dstTokenAddress,
      srcTokenAmount: res.srcTokenAmount,
      dstTokenAmount: res.dstTokenAmount,
      createdAt: res.createdAt,
      filledAt: res.filledAt,
      resolverAddress: res.resolverAddress,
      txHash: res.txHash,
      isHistorical: true,
    };
  } catch (err) {
    if (isAbortError(err)) throw err;
    log.warn(TAG, `Failed to fetch order status: ${orderHash}`, err);
    return null;
  }
}

/** Persisted order hash entry */
export interface PersistedOrderEntry {
  readonly orderHash: string;
  readonly chainId: number;
  readonly createdAt: string;
  readonly srcSymbol?: string;
  readonly dstSymbol?: string;
}

/**
 * Save an order hash to localStorage history.
 */
export function persistOrderHash(entry: PersistedOrderEntry): void {
  try {
    const raw = localStorage.getItem(ORDER_HISTORY_KEY);
    const history: PersistedOrderEntry[] = raw ? JSON.parse(raw) : [];

    // Avoid duplicates
    if (history.some(h => h.orderHash === entry.orderHash)) return;

    // Prepend and cap
    history.unshift(entry);
    if (history.length > MAX_PERSISTED_ORDERS) history.length = MAX_PERSISTED_ORDERS;

    localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(history));
    log.debug(TAG, `Persisted order ${entry.orderHash.slice(0, 10)}... (${history.length} total)`);
  } catch {
    log.warn(TAG, "Failed to persist order hash to localStorage");
  }
}

/**
 * Load persisted order hashes from localStorage.
 */
export function loadPersistedOrders(): PersistedOrderEntry[] {
  try {
    const raw = localStorage.getItem(ORDER_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
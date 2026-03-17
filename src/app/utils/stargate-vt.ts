/**
 * Stargate V2 — LayerZero Value Transfer (VT) API Client
 *
 * Replaces the legacy manual ABI-encoding approach with the official
 * LayerZero REST API. The VT API returns pre-built, ready-to-sign EVM
 * transactions — no manual ABI encoding, no hardcoded pool addresses,
 * no hardcoded endpoint IDs.
 *
 * API base: https://transfer.layerzero-api.com/v1
 *
 * Endpoints used:
 *   GET  /v1/tokens          — Discover supported chains & tokens
 *   POST /v1/quotes          — Get bridge quotes with fee breakdowns
 *   POST /v1/build-user-steps — Get executable transactions for a quote
 *
 * IMPLEMENTATION NOTE: Stargate Rebuild Steps 1-7, 13-14.
 * Steps 1-7: Token fetching, quotes, build-user-steps, execution, balance checking.
 * Step 13:   Error classification (classifyError, VTErrorKind, buildDebugReport),
 *            5-min receipt timeout, isUserRejection helper.
 * Step 14:   Safety guards (runSafetyChecks, estimateGasCost, checkQuoteExpiry),
 *            fee/slippage/balance/expiry/gas warnings with severity levels.
 * Step 15:   Bridge receipts (BridgeReceipt type, saveBridgeReceipt,
 *            loadBridgeReceipts, clearBridgeReceipts) with localStorage.
 * Step 16:   Smart display formatting (formatDisplayAmount, formatUsd) with
 *            locale-aware Intl.NumberFormat, adaptive decimals by token type,
 *            "< $0.01" for dust USD amounts.
 * Step 17:   API health check (testApiConnection, ApiHealthResult) for
 *            admin debug panel mount status indicator.
 */

import { log } from "./logger";
import { switchChain, getChainId, getEthereumProvider } from "./metamask";
import { NATIVE_TOKEN_ADDRESS } from "./stargate-chains";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { getSessionToken } from "./auth";

/* ══════════════════════════════════════════════════════════════
 * Constants
 * ══════════════════════════════════════════════════════════════ */

/**
 * IMPLEMENTATION NOTE: The LayerZero VT API does not return CORS headers,
 * so direct browser fetch() fails. All requests are proxied through our
 * Supabase edge function at /stargate-vt/* which forwards to
 * https://transfer.layerzero-api.com/v1/*.
 */
const VT_API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/stargate-vt`;

/** Cache TTL — tokens don't change often, 5 minutes is safe */
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

/** Request timeout for all VT API calls */
const REQUEST_TIMEOUT_MS = 15_000;

/* ══════════════════════════════════════════════════════════════
 * Types — /v1/tokens
 * ══════════════════════════════════════════════════════════════ */

export interface VTToken {
  /** Whether this token is currently active on the VT API */
  isSupported: boolean;
  /** Chain identifier (e.g., "ethereum", "arbitrum", "polygon") */
  chainKey: string;
  /** Token contract address (0xEeee... for native tokens) */
  address: string;
  /** Token decimals (e.g., 6 for USDC, 18 for ETH) */
  decimals: number;
  /** Token symbol (e.g., "USDC", "ETH") */
  symbol: string;
  /** Human-readable token name */
  name: string;
  /** URL to token logo image (optional) */
  logoUrl?: string;
  /** Current price in USD (optional) */
  price?: { usd: number };
}

export interface VTTokensResponse {
  tokens: VTToken[];
  pagination?: { nextToken?: string };
}

/* ══════════════════════════════════════════════════════════════
 * Types — /v1/quotes (request)
 * ══════════════════════════════════════════════════════════════ */

export interface VTQuoteRequest {
  /** Raw amount in smallest unit (e.g., "1000000" for 1 USDC) */
  amount: string;
  /** Source chain key (e.g., "ethereum", "arbitrum") */
  srcChainKey: string;
  /** Source token contract address */
  srcTokenAddress: string;
  /** Sender wallet address on the source chain */
  srcWalletAddress: string;
  /** Destination chain key */
  dstChainKey: string;
  /** Destination token contract address */
  dstTokenAddress: string;
  /** Receiver wallet address on the destination chain */
  dstWalletAddress: string;
  /** Optional transfer configuration */
  options?: VTQuoteOptions;
}

export interface VTQuoteOptions {
  /** How to interpret the `amount` field */
  amountType?: "EXACT_SRC_AMOUNT";
  /** Maximum acceptable fee as a percentage */
  feeTolerance?: { type: "PERCENT"; amount: number };
  /** Native token to airdrop on destination (in dst native decimals) */
  dstNativeDropAmount?: string;
}

/* ═════════════════════════════════════════════════════════════
 * Types — /v1/quotes (response)
 * ══════════════════════════════════════════════════════════════ */

/** Fee types returned by the VT API */
export type VTFeeType = "MESSAGE" | "GENERAL" | "DST_NATIVE_DROP" | "CCTP_RECEIVE";

export interface VTFee {
  /** Chain where this fee is paid */
  chainKey: string;
  /** Fee category */
  type: VTFeeType;
  /** Human-readable fee description */
  description: string;
  /** Fee amount in smallest unit of the fee token */
  amount: string;
  /** Address of the fee token */
  address: string;
}

/**
 * Route step types correspond to the bridge protocol used.
 * STARGATE_V2_TAXI = instant finality (higher fee)
 * STARGATE_V2_BUS  = batched (lower fee, slower)
 */
export type VTRouteStepType =
  | "OFT_V1"
  | "OFT_V2"
  | "STARGATE_V1"
  | "STARGATE_V2_TAXI"
  | "STARGATE_V2_BUS"
  | "AORI_V1"
  | "CCTP_V1"
  | "CCTP_V2"
  | "HYPERCORE_TO_HYPEREVM"
  | "HYPEREVM_TO_HYPERCORE";

export interface VTRouteStep {
  /** Bridge protocol used for this leg */
  type: VTRouteStepType;
  /** Source chain for this leg */
  srcChainKey: string;
  /** Human-readable description of this step */
  description?: string;
  /** Estimated transfer duration */
  duration?: { estimated: string | null };
  /** Per-step fee breakdown */
  fees?: VTFee[];
}

/** Pre-built EVM transaction — ready to submit to MetaMask unchanged */
export interface VTEvmTransaction {
  /** Target chain ID (e.g., 1 for Ethereum, 42161 for Arbitrum) */
  chainId: number;
  /** ABI-encoded calldata (hex string with 0x prefix) */
  data?: string;
  /** Sender address */
  from?: string;
  /** Contract address to call */
  to: string;
  /** Native value to send (in wei, as a string) */
  value?: string;
  /** Gas limit computed by the API */
  gasLimit?: string;
}

/** Chain types supported by the VT API */
export type VTChainType = "EVM" | "SOLANA" | "APTOS" | "TON" | "TRON" | "STARKNET";

/**
 * A single executable step returned by /v1/quotes or /v1/build-user-steps.
 *
 * For EVM chains, transaction.encoded contains { chainId, data, from, to, value, gasLimit }
 * that can be passed directly to eth_sendTransaction — no manual ABI encoding needed.
 */
export interface VTUserStep {
  /** Always "TRANSACTION" for steps that require a wallet signature */
  type: "TRANSACTION";
  /** Human-readable description (e.g., "Approve USDC", "Bridge USDC to Arbitrum") */
  description: string;
  /** Chain where this transaction executes */
  chainKey: string;
  /** Chain type — we only support "EVM" */
  chainType: VTChainType;
  /** Wallet address that must sign this transaction */
  signerAddress: string;
  /** The pre-built transaction */
  transaction: { encoded: VTEvmTransaction };
}

export interface VTQuote {
  /** Unique quote identifier — used with /v1/build-user-steps */
  id: string;
  /** Ordered route legs describing the bridge path */
  routeSteps: VTRouteStep[];
  /** Aggregate fee breakdown */
  fees: VTFee[];
  /** Estimated total transfer time */
  duration: { estimated: string | null };
  /** Total fee in USD (e.g., "0.42") */
  feeUsd?: string;
  /** Total fee as a percentage (e.g., "0.06") */
  feePercent?: string;
  /** ISO timestamp when this quote expires */
  expiresAt?: string;
  /** Source amount in smallest unit */
  srcAmount: string;
  /** Expected destination amount in smallest unit */
  dstAmount: string;
  /** Minimum destination amount after slippage */
  dstAmountMin?: string;
  /** Source amount in USD */
  srcAmountUsd?: string;
  /** Destination amount in USD */
  dstAmountUsd?: string;
  /**
   * Pre-built user steps (may be included inline on quotes,
   * or fetched separately via /v1/build-user-steps)
   */
  userSteps?: VTUserStep[];
}

export interface VTQuotesResponse {
  /** Null on success, error object on failure */
  error: null | { status: number; message: string; issues?: { message: string }[] };
  /** Array of available bridge quotes */
  quotes: VTQuote[];
}

/* ══════════════════════════════════════════════════════════════
 * In-memory cache
 *
 * Keys are the full query-string fingerprint so that
 * fetchSupportedTokens("ethereum") and fetchSupportedTokens()
 * are cached independently.
 * ══════════════════════════════════════════════════════════════ */

interface CacheEntry {
  tokens: VTToken[];
  timestamp: number;
}

const tokenCache = new Map<string, CacheEntry>();

function getCached(key: string): VTToken[] | null {
  const entry = tokenCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TOKEN_CACHE_TTL_MS) {
    tokenCache.delete(key);
    return null;
  }
  return entry.tokens;
}

function setCache(key: string, tokens: VTToken[]): void {
  tokenCache.set(key, { tokens, timestamp: Date.now() });
}

/** Manually invalidate all cached tokens (e.g., after a bridge completes) */
export function clearTokenCache(): void {
  tokenCache.clear();
  log.debug("StargateVT", "Token cache cleared");
}

/* ══════════════════════════════════════════════════════════════
 * Internal helpers
 * ══════════════════════════════════════════════════════════════ */

/**
 * Fetch with timeout wrapper — AbortController-based.
 * Throws a descriptive error on timeout or network failure.
 */
async function vtFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // IMPLEMENTATION NOTE: PEN-04 — Include ED25519 session token for
    // authenticated stargate-vt proxy endpoints (quotes, build-user-steps, rpc).
    const authHeaders: Record<string, string> = {
      "Accept": "application/json",
      "Authorization": `Bearer ${publicAnonKey}`,
    };
    const sessionToken = getSessionToken();
    if (sessionToken) {
      authHeaders["X-Session-Token"] = sessionToken;
    }

    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
    });
    return res;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(
        `VT API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${url}`
      );
    }
    throw new Error(`VT API network error for ${url}: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a cache key from the query parameters used for a token request.
 * Deterministic ordering ensures identical queries hit the same cache slot.
 */
function tokenCacheKey(params: Record<string, string>): string {
  const sorted = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `tokens:${sorted || "__all__"}`;
}

/* ═════════════════════════════════════════════════════════════
 * Public API — Token fetching
 * ══════════════════════════════════════════════════════════════ */

/**
 * Fetch all supported tokens from the VT API, optionally filtered by chain.
 *
 * Features:
 *   - 5-minute in-memory cache per unique query
 *   - Automatic pagination (follows nextToken until exhausted)
 *   - Filters to isSupported === true
 *
 * @param chainKey  Optional chain filter (e.g., "ethereum", "arbitrum")
 * @returns         Array of supported VTToken objects
 */
export async function fetchSupportedTokens(
  chainKey?: string
): Promise<VTToken[]> {
  const queryParams: Record<string, string> = {};
  if (chainKey) queryParams.transferrableFromChainKey = chainKey;

  const cacheKey = tokenCacheKey(queryParams);
  const cached = getCached(cacheKey);
  if (cached) {
    log.debug("StargateVT", `Token cache hit for "${cacheKey}" (${cached.length} tokens)`);
    return cached;
  }

  log.info("StargateVT", `Fetching supported tokens`, { chainKey: chainKey ?? "all" });

  const allTokens: VTToken[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;

  // IMPLEMENTATION NOTE: The VT API paginates large token sets.
  // We follow nextToken until the API stops returning one.
  // Safety valve: cap at 50 pages to prevent infinite loops on malformed responses.
  const MAX_PAGES = 50;

  do {
    const url = buildTokensUrl(queryParams, nextToken);
    const res = await vtFetch(url);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const errMsg = `VT API /v1/tokens returned ${res.status}: ${body.slice(0, 200)}`;
      log.error("StargateVT", errMsg);
      throw new Error(errMsg);
    }

    const data: VTTokensResponse = await res.json();

    if (data.tokens && Array.isArray(data.tokens)) {
      allTokens.push(...data.tokens);
    }

    nextToken = data.pagination?.nextToken;
    pageCount++;

    if (pageCount >= MAX_PAGES) {
      log.warn("StargateVT", `Pagination safety cap reached (${MAX_PAGES} pages)`);
      break;
    }
  } while (nextToken);

  // Filter to supported tokens only
  const supported = allTokens.filter((t) => t.isSupported);

  log.info("StargateVT", `Fetched ${supported.length} supported tokens (${pageCount} pages, ${allTokens.length} total)`);

  setCache(cacheKey, supported);
  return supported;
}

/**
 * Fetch tokens that can receive a transfer from a specific source token.
 *
 * Use this to populate the "destination token" dropdown after the user
 * selects a source chain + token — it ensures only valid routes are shown.
 *
 * @param srcChainKey       Source chain (e.g., "ethereum")
 * @param srcTokenAddress   Source token address (e.g., USDC contract)
 * @returns                 Array of destination VTToken objects
 */
export async function getTransferrableTokens(
  srcChainKey: string,
  srcTokenAddress: string
): Promise<VTToken[]> {
  const queryParams: Record<string, string> = {
    transferrableFromChainKey: srcChainKey,
    transferrableFromTokenAddress: srcTokenAddress,
  };

  const cacheKey = tokenCacheKey(queryParams);
  const cached = getCached(cacheKey);
  if (cached) {
    log.debug("StargateVT", `Transferrable cache hit for ${srcChainKey}:${srcTokenAddress.slice(0, 10)}... (${cached.length} tokens)`);
    return cached;
  }

  log.info("StargateVT", "Fetching transferrable tokens", {
    srcChainKey,
    srcToken: srcTokenAddress.slice(0, 10) + "...",
  });

  const allTokens: VTToken[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 50;

  do {
    const url = buildTokensUrl(queryParams, nextToken);
    const res = await vtFetch(url);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const errMsg = `VT API /v1/tokens (transferrable) returned ${res.status}: ${body.slice(0, 200)}`;
      log.error("StargateVT", errMsg);
      throw new Error(errMsg);
    }

    const data: VTTokensResponse = await res.json();

    if (data.tokens && Array.isArray(data.tokens)) {
      allTokens.push(...data.tokens);
    }

    nextToken = data.pagination?.nextToken;
    pageCount++;

    if (pageCount >= MAX_PAGES) {
      log.warn("StargateVT", `Transferrable pagination cap reached (${MAX_PAGES} pages)`);
      break;
    }
  } while (nextToken);

  const supported = allTokens.filter((t) => t.isSupported);

  log.info("StargateVT", `Fetched ${supported.length} transferrable destinations from ${srcChainKey}`);

  setCache(cacheKey, supported);
  return supported;
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Quote fetching
 * ══════════════════════════════════════════════════════════════ */

/** Default options merged into every quote request */
const DEFAULT_QUOTE_OPTIONS: VTQuoteOptions = {
  amountType: "EXACT_SRC_AMOUNT",
  feeTolerance: { type: "PERCENT", amount: 1 },
  dstNativeDropAmount: "0",
};

/**
 * Fetch bridge quotes from the VT API.
 *
 * Returns an array of quotes sorted by best destination amount (highest first).
 * Each quote contains fee breakdowns, estimated duration, and optionally
 * pre-built user steps for execution.
 *
 * @param req  Quote request parameters (amount, chains, tokens, wallets)
 * @returns    Sorted array of VTQuote objects (best destination amount first)
 * @throws     On network error, timeout, or API error response
 */
export async function fetchQuotes(req: VTQuoteRequest): Promise<VTQuote[]> {
  // Merge caller options with defaults
  const body = {
    amount: req.amount,
    srcChainKey: req.srcChainKey,
    srcTokenAddress: req.srcTokenAddress,
    srcWalletAddress: req.srcWalletAddress,
    dstChainKey: req.dstChainKey,
    dstTokenAddress: req.dstTokenAddress,
    dstWalletAddress: req.dstWalletAddress,
    options: {
      ...DEFAULT_QUOTE_OPTIONS,
      ...req.options,
    },
  };

  log.info("StargateVT", "Fetching bridge quotes", {
    src: `${body.srcChainKey}:${body.srcTokenAddress.slice(0, 10)}...`,
    dst: `${body.dstChainKey}:${body.dstTokenAddress.slice(0, 10)}...`,
    amount: body.amount,
  });

  const res = await vtFetch(`${VT_API_BASE}/quotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // IMPLEMENTATION NOTE: The VT API returns 200 even for "soft" errors,
  // wrapping them in the `error` field. We handle both HTTP errors and
  // API-level errors in the response body.
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const errMsg = `VT API /v1/quotes returned HTTP ${res.status}: ${text.slice(0, 300)}`;
    log.error("StargateVT", errMsg);
    throw new VTApiError(res.status, errMsg);
  }

  const data: VTQuotesResponse = await res.json();

  // Check for API-level error in the response body
  if (data.error) {
    const issues = data.error.issues?.map((i) => i.message).join("; ") ?? "";
    const errMsg = `VT API quote error: ${data.error.message}${issues ? ` [${issues}]` : ""}`;
    log.error("StargateVT", errMsg, { status: data.error.status });
    throw new VTApiError(data.error.status, errMsg);
  }

  if (!data.quotes || !Array.isArray(data.quotes) || data.quotes.length === 0) {
    log.warn("StargateVT", "No quotes returned for route", {
      src: body.srcChainKey,
      dst: body.dstChainKey,
    });
    return [];
  }

  // Sort by best destination amount (highest first = best deal for user)
  const sorted = [...data.quotes].sort((a, b) => {
    return compareBigIntStrings(b.dstAmount, a.dstAmount);
  });

  // Log summary for debugging
  const best = sorted[0];
  log.info("StargateVT", `Received ${sorted.length} quote(s)`, {
    bestDstAmount: best.dstAmount,
    bestFeeUsd: best.feeUsd ?? "N/A",
    bestFeePercent: best.feePercent ? `${best.feePercent}%` : "N/A",
    bestRoute: best.routeSteps.map((s) => s.type).join(" → "),
    expiresAt: best.expiresAt ?? "N/A",
  });

  return sorted;
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Build user steps (executable transactions)
 * ══════════════════════════════════════════════════════════════ */

/** Response shape from POST /v1/build-user-steps */
interface VTBuildUserStepsResponse {
  error: null | { status: number; message: string; issues?: { message: string }[] };
  userSteps: VTUserStep[];
}

/**
 * Fetch executable transaction steps for a previously obtained quote.
 *
 * The VT API returns pre-built EVM transactions with { chainId, data, from, to, value, gasLimit }
 * that can be passed directly to MetaMask's eth_sendTransaction — no manual ABI encoding.
 *
 * @param quoteId  Quote ID from a VTQuote returned by fetchQuotes()
 * @returns        Array of VTUserStep objects in execution order
 * @throws         VTApiError on API errors, or Error on validation failures
 */
export async function fetchUserSteps(quoteId: string): Promise<VTUserStep[]> {
  log.info("StargateVT", "Building user steps for quote", { quoteId });

  const res = await vtFetch(`${VT_API_BASE}/build-user-steps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // IMPLEMENTATION NOTE: A 404 typically means the quote has expired.
    const isExpired = res.status === 404;
    const errMsg = isExpired
      ? `Quote expired (${quoteId}). Please refresh and try again.`
      : `VT API /v1/build-user-steps returned HTTP ${res.status}: ${text.slice(0, 300)}`;
    log.error("StargateVT", errMsg);
    throw new VTApiError(res.status, errMsg);
  }

  const data: VTBuildUserStepsResponse = await res.json();

  // Check API-level error in response body
  if (data.error) {
    const issues = data.error.issues?.map((i) => i.message).join("; ") ?? "";
    const errMsg = `VT API build-user-steps error: ${data.error.message}${issues ? ` [${issues}]` : ""}`;
    log.error("StargateVT", errMsg, { status: data.error.status });
    throw new VTApiError(data.error.status, errMsg);
  }

  if (!data.userSteps || data.userSteps.length === 0) {
    const errMsg = `No executable steps returned for quote ${quoteId}. The route may be temporarily unavailable.`;
    log.error("StargateVT", errMsg);
    throw new Error(errMsg);
  }

  // Validate all steps are EVM — we don't support Solana/Aptos/etc.
  const nonEvmSteps = data.userSteps.filter((s) => s.chainType !== "EVM");
  if (nonEvmSteps.length > 0) {
    const unsupported = nonEvmSteps.map((s) => `${s.chainType}:${s.chainKey}`).join(", ");
    const errMsg = `Unsupported chain type(s) in bridge route: ${unsupported}. Only EVM chains are supported.`;
    log.error("StargateVT", errMsg);
    throw new Error(errMsg);
  }

  // Validate each step has the required transaction fields
  for (const step of data.userSteps) {
    const tx = step.transaction?.encoded;
    if (!tx || !tx.to || !tx.chainId) {
      const errMsg = `Malformed transaction in step "${step.description}": missing 'to' or 'chainId'`;
      log.error("StargateVT", errMsg, { step });
      throw new Error(errMsg);
    }
  }

  log.info("StargateVT", `Built ${data.userSteps.length} user step(s)`, {
    steps: data.userSteps.map((s) => ({
      desc: s.description,
      chain: s.chainKey,
      to: s.transaction.encoded.to.slice(0, 10) + "...",
    })),
  });

  return data.userSteps;
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Convenience: quote + steps in one call
 * ══════════════════════════════════════════════════════════════ */

/** Bundled result from getQuoteWithSteps — everything the widget needs */
export interface QuoteWithSteps {
  /** The best quote (display: fees, amounts, duration) */
  quote: VTQuote;
  /** Ordered executable transactions for MetaMask */
  steps: VTUserStep[];
}

/**
 * One-call convenience: fetch the best quote and its executable steps.
 *
 * Flow: fetchQuotes → pick best → fetchUserSteps → return both.
 * The widget calls this once and gets everything needed for display + execution.
 *
 * @param req  Quote request parameters
 * @returns    The best quote (for display) and its executable steps (for MetaMask)
 * @throws     Descriptive errors for no-route, expired-quote, and API failures
 */
export async function getQuoteWithSteps(req: VTQuoteRequest): Promise<QuoteWithSteps> {
  // Step 1: Get sorted quotes (best dstAmount first)
  const quotes = await fetchQuotes(req);

  if (quotes.length === 0) {
    throw new Error(
      `No quotes available for ${req.srcChainKey} → ${req.dstChainKey}. ` +
      `This route may not be supported, or the amount may be too small.`
    );
  }

  const bestQuote = quotes[0];

  log.info("StargateVT", "Selected best quote", {
    id: bestQuote.id,
    dstAmount: bestQuote.dstAmount,
    feeUsd: bestQuote.feeUsd ?? "N/A",
    route: bestQuote.routeSteps.map((s) => s.type).join(" → "),
  });

  // IMPLEMENTATION NOTE: Some quotes include userSteps inline, which
  // saves a round-trip. If present and non-empty, validate and use them.
  // Otherwise, fetch steps separately via /v1/build-user-steps.
  let steps: VTUserStep[];

  if (bestQuote.userSteps && bestQuote.userSteps.length > 0) {
    log.debug("StargateVT", "Using inline userSteps from quote (skipping build-user-steps call)");
    steps = bestQuote.userSteps;

    // Still validate EVM-only
    const nonEvm = steps.filter((s) => s.chainType !== "EVM");
    if (nonEvm.length > 0) {
      const unsupported = nonEvm.map((s) => `${s.chainType}:${s.chainKey}`).join(", ");
      throw new Error(`Unsupported chain type(s) in bridge route: ${unsupported}. Only EVM chains are supported.`);
    }
  } else {
    // Step 2: Build executable steps from the quote ID
    try {
      steps = await fetchUserSteps(bestQuote.id);
    } catch (err: any) {
      // Enhance error message for expired quotes
      if (err instanceof VTApiError && err.status === 404) {
        throw new Error(
          "Quote expired before steps could be built. Please refresh to get a new quote."
        );
      }
      throw err;
    }
  }

  return { quote: bestQuote, steps };
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Display helpers
 * ══════════════════════════════════════════════════════════════ */

/** Formatted fee/amount info for the bridge widget UI */
export interface FeeDisplayInfo {
  /** Total fee in USD, formatted (e.g., "$0.42") */
  totalFeeUsd: string;
  /** Fee as a percentage (e.g., "0.06%") */
  feePercent: string;
  /** Estimated transfer time (e.g., "~2 min") */
  estimatedDuration: string;
  /** Destination amount in human-readable units (e.g., "99.58") */
  youReceive: string;
  /** Destination amount in USD (e.g., "$99.58") */
  youReceiveUsd: string;
  /** Source amount in human-readable units (e.g., "100.00") */
  youSend: string;
  /** Source amount in USD (e.g., "$100.00") */
  youSendUsd: string;
  /** Minimum received after slippage (e.g., "99.28") */
  minReceived: string;
  /** Route type label (e.g., "Stargate V2 (Taxi)") */
  routeTypeLabel: string;
  /** Raw route step type (e.g., "STARGATE_V2_TAXI") */
  routeType: string;
  /** ISO expiry timestamp (pass-through from quote) */
  expiresAt: string | null;
}

/**
 * Format a quote's fee/amount data for display in the bridge widget.
 *
 * Converts raw API values into human-friendly strings. The widget
 * never needs to do its own formatting — just call this and render.
 *
 * @param quote       The VTQuote to format
 * @param dstDecimals Destination token decimals (needed to format dstAmount)
 * @param srcDecimals Source token decimals (needed to format srcAmount)
 * @returns           Formatted display info
 */
export function formatFeeDisplay(
  quote: VTQuote,
  dstDecimals: number,
  srcDecimals?: number,
  dstSymbol?: string,
  srcSymbol?: string,
): FeeDisplayInfo {
  // Step 16: Use formatUsd for locale-aware, "< $0.01"–aware USD formatting
  const totalFeeUsd = formatUsd(quote.feeUsd);

  const feePercent = quote.feePercent
    ? `${parseFloat(quote.feePercent).toFixed(2)}%`
    : "—";

  const estimatedDuration = formatDuration(quote.duration?.estimated);

  // Convert raw dstAmount (smallest unit) to human-readable
  const youReceiveRaw = formatTokenAmount(quote.dstAmount, dstDecimals);
  const youReceive = formatDisplayAmount(youReceiveRaw, dstSymbol ?? "", dstDecimals);

  const youReceiveUsd = formatUsd(quote.dstAmountUsd);

  const youSendRaw = srcDecimals != null
    ? formatTokenAmount(quote.srcAmount, srcDecimals)
    : "—";
  const youSend = youSendRaw !== "—"
    ? formatDisplayAmount(youSendRaw, srcSymbol ?? "", srcDecimals ?? 18)
    : "—";

  const youSendUsd = formatUsd(quote.srcAmountUsd);

  const minReceivedRaw = quote.dstAmountMin
    ? formatTokenAmount(quote.dstAmountMin, dstDecimals)
    : "—";
  const minReceived = minReceivedRaw !== "—"
    ? formatDisplayAmount(minReceivedRaw, dstSymbol ?? "", dstDecimals)
    : "—";

  const routeTypeLabel = quote.routeSteps.map((s) => {
    switch (s.type) {
      case "STARGATE_V2_TAXI":
        return "Stargate V2 (Taxi)";
      case "STARGATE_V2_BUS":
        return "Stargate V2 (Bus)";
      default:
        return s.type;
    }
  }).join(" → ");

  const routeType = quote.routeSteps.map((s) => s.type).join(" → ");

  return {
    totalFeeUsd,
    feePercent,
    estimatedDuration,
    youReceive,
    youReceiveUsd,
    youSend,
    youSendUsd,
    minReceived,
    routeTypeLabel,
    routeType,
    expiresAt: quote.expiresAt ?? null,
  };
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Token balance checking
 *
 * IMPLEMENTATION NOTE: The VT API handles allowance/approval internally
 * (it returns an "Approve" userStep when needed). We only need balance
 * checking so the widget can show the user's available balance and
 * validate the input amount before requesting a quote.
 * ══════════════════════════════════════════════════════════════ */

/** Balance result with both raw and formatted values */
export interface TokenBalance {
  /** Raw balance as a bigint (in smallest unit, e.g., wei) */
  raw: bigint;
  /** Human-readable formatted balance (e.g., "1.50") */
  formatted: string;
}

/** ERC-20 balanceOf(address) function selector */
const BALANCE_OF_SELECTOR = "0x70a08231";

/**
 * RPC endpoint map for chains we support balance queries on.
 *
 * IMPLEMENTATION NOTE: We use public RPCs for read-only balance checks.
 * MetaMask's provider could also work, but using direct RPCs avoids
 * requiring the user to be on the correct chain just to check a balance.
 */
const CHAIN_RPC_URLS: Record<number, string> = {
  1: "https://eth.llamarpc.com",
  10: "https://mainnet.optimism.io",
  56: "https://bsc-dataseed1.binance.org",
  137: "https://polygon-rpc.com",
  250: "https://rpc.ftm.tools",
  324: "https://mainnet.era.zksync.io",
  8453: "https://mainnet.base.org",
  42161: "https://arb1.arbitrum.io/rpc",
  43114: "https://api.avax.network/ext/bc/C/rpc",
  59144: "https://rpc.linea.build",
  534352: "https://rpc.scroll.io",
  5000: "https://rpc.mantle.xyz",
  1088: "https://andromeda.metis.io/?owner=1088",
  2222: "https://evm.kava.io",
  204: "https://opbnb-mainnet-rpc.bnbchain.org",
  1116: "https://rpc.coredao.org",
  1329: "https://evm-rpc.sei-apis.com",
  196: "https://rpc.xlayer.tech",
};

/**
 * Get the token balance for a user on a specific chain.
 *
 * - For native tokens (0xEeee...): uses eth_getBalance
 * - For ERC-20 tokens: uses balanceOf(address) via eth_call
 *
 * Uses direct RPC calls (not MetaMask) so the user doesn't need to
 * be on the correct chain to check balances.
 *
 * @param userAddress   EVM wallet address (0x...)
 * @param chainId       EVM chain ID (e.g., 1 for Ethereum)
 * @param tokenAddress  Token contract address (or NATIVE_TOKEN_ADDRESS for native)
 * @param decimals      Token decimals for formatting
 * @returns             { raw: bigint, formatted: string }
 */
export async function getTokenBalance(
  userAddress: string,
  chainId: number,
  tokenAddress: string,
  decimals: number
): Promise<TokenBalance> {
  const rpcUrl = CHAIN_RPC_URLS[chainId];
  if (!rpcUrl) {
    log.warn("StargateVT", `No RPC URL for chainId ${chainId}, falling back to MetaMask provider`);
    return getTokenBalanceViaProvider(userAddress, tokenAddress, decimals);
  }

  const isNative = tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();

  try {
    let rawHex: string;

    if (isNative) {
      // Native token: eth_getBalance
      rawHex = await rpcCall(rpcUrl, "eth_getBalance", [userAddress, "latest"]);
    } else {
      // ERC-20: balanceOf(address)
      // Encode: selector (4 bytes) + address padded to 32 bytes
      const paddedAddress = userAddress.toLowerCase().replace("0x", "").padStart(64, "0");
      const callData = `${BALANCE_OF_SELECTOR}${paddedAddress}`;

      rawHex = await rpcCall(rpcUrl, "eth_call", [
        { to: tokenAddress, data: callData },
        "latest",
      ]);
    }

    const raw = rawHex && rawHex !== "0x" ? BigInt(rawHex) : 0n;
    const formatted = formatTokenAmount(raw.toString(), decimals);

    log.debug("StargateVT", `Balance for ${tokenAddress.slice(0, 10)}... on chain ${chainId}`, {
      raw: raw.toString(),
      formatted,
      isNative,
    });

    return { raw, formatted };
  } catch (err: any) {
    log.error("StargateVT", `Balance check failed for ${tokenAddress.slice(0, 10)}... on chain ${chainId}: ${err?.message}`);
    return { raw: 0n, formatted: "0.00" };
  }
}

/**
 * Fallback: get balance via MetaMask's provider (requires user to be on correct chain).
 */
async function getTokenBalanceViaProvider(
  userAddress: string,
  tokenAddress: string,
  decimals: number
): Promise<TokenBalance> {
  const eth = getEthereumProvider();
  if (!eth) return { raw: 0n, formatted: "0.00" };

  const isNative = tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();

  try {
    let rawHex: string;

    if (isNative) {
      rawHex = await eth.request({
        method: "eth_getBalance",
        params: [userAddress, "latest"],
      });
    } else {
      const paddedAddress = userAddress.toLowerCase().replace("0x", "").padStart(64, "0");
      const callData = `${BALANCE_OF_SELECTOR}${paddedAddress}`;

      rawHex = await eth.request({
        method: "eth_call",
        params: [{ to: tokenAddress, data: callData }, "latest"],
      });
    }

    const raw = rawHex && rawHex !== "0x" ? BigInt(rawHex) : 0n;
    return { raw, formatted: formatTokenAmount(raw.toString(), decimals) };
  } catch {
    return { raw: 0n, formatted: "0.00" };
  }
}

/**
 * Plain fetch wrapper for RPC calls — NO Authorization header.
 *
 * IMPLEMENTATION NOTE: vtFetch adds `Authorization: Bearer <anonKey>` which
 * is needed for our Supabase proxy, but causes CORS preflight failures on
 * public RPC endpoints (eth.llamarpc.com, mainnet.base.org, etc.).
 * This separate helper keeps RPC calls clean.
 */
async function rpcFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    return res;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`RPC request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${url}`);
    }
    throw new Error(`RPC network error for ${url}: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Minimal JSON-RPC call helper for EVM RPC endpoints.
 *
 * IMPLEMENTATION NOTE: Many public RPCs reject browser-origin requests due
 * to CORS (Content-Type: application/json triggers preflight). We route
 * through our server-side /stargate-vt/rpc proxy which forwards the call
 * from the Deno edge function (no CORS issues server-to-server).
 */
async function rpcCall(rpcUrl: string, method: string, params: any[]): Promise<string> {
  const rpcBody = { jsonrpc: "2.0", id: 1, method, params };

  // Route through server-side proxy to avoid CORS
  const proxyUrl = `${VT_API_BASE}/rpc`;
  const res = await vtFetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rpcUrl, ...rpcBody }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RPC ${method} failed with HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.error) {
    // JSON-RPC level error vs proxy error
    const errMsg = typeof data.error === "string"
      ? data.error
      : data.error.message ?? JSON.stringify(data.error);
    throw new Error(`RPC ${method} error: ${errMsg}`);
  }

  return data.result;
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Amount formatting & parsing
 *
 * IMPLEMENTATION NOTE: formatTokenAmount is also used internally by
 * formatFeeDisplay. parseTokenAmount is the inverse — it converts
 * human-readable amounts to raw smallest-unit strings for the VT API.
 * ══════════════════════════════════════════════════════════════ */

/**
 * Convert a raw token amount (smallest unit) to a human-readable string.
 *
 * Accepts string or bigint. Uses pure string manipulation to avoid
 * floating-point precision loss on large amounts.
 *
 * @param rawAmount  Raw amount in smallest unit (e.g., "1500000" or 1500000n)
 * @param decimals   Token decimals (e.g., 6 for USDC, 18 for ETH)
 * @returns          Human-readable string (e.g., "1.50")
 */
export function formatTokenAmount(rawAmount: string | bigint, decimals: number): string {
  const str = typeof rawAmount === "bigint" ? rawAmount.toString() : rawAmount;
  if (!str || decimals < 0) return "0";

  // Pad the string to ensure it has more digits than decimals
  const padded = str.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals) || "0";
  const fracPart = padded.slice(padded.length - decimals);

  if (decimals === 0) return intPart;

  // Trim trailing zeros but keep at least 2 decimal places for USD-like tokens
  const minFrac = Math.min(decimals, 2);
  let trimmed = fracPart.replace(/0+$/, "");
  if (trimmed.length < minFrac) {
    trimmed = trimmed.padEnd(minFrac, "0");
  }
  // Cap at 6 decimal places for readability
  if (trimmed.length > 6) {
    trimmed = trimmed.slice(0, 6);
  }

  return `${intPart}.${trimmed}`;
}

/* ── Step 16: Smart display formatting ── */

/** Stablecoin symbols for formatting heuristics */
const STABLECOINS = new Set([
  "USDC", "USDT", "DAI", "BUSD", "FRAX", "LUSD", "TUSD", "USDP",
  "sUSD", "GUSD", "USDD", "cUSD", "USDbC", "USDe", "PYUSD",
]);

/**
 * Determine appropriate decimal places for a token amount display.
 *
 * IMPLEMENTATION NOTE: Uses symbol-based heuristics:
 *  - Stablecoins (USDC, USDT, DAI, etc.) → 2 decimals
 *  - ETH/WETH/native tokens with 18 decimals → up to 6 (trimmed)
 *  - Other tokens → up to 4 (trimmed)
 */
function getDisplayDecimals(symbol: string, decimals: number): number {
  if (STABLECOINS.has(symbol)) return 2;
  if (decimals >= 18) return 6;
  if (decimals >= 8) return 4;
  return Math.min(decimals, 2);
}

/**
 * Format a human-readable token amount for display with locale-aware
 * number formatting and smart decimal places.
 *
 * @param humanAmount  The human-readable amount string (from formatTokenAmount)
 * @param symbol       Token symbol (used to determine decimal places)
 * @param decimals     Token decimals (used as fallback heuristic)
 * @returns            Locale-formatted string (e.g., "1,234.56", "0.001234")
 */
export function formatDisplayAmount(
  humanAmount: string,
  symbol: string = "",
  decimals: number = 18,
): string {
  if (!humanAmount || humanAmount === "0" || humanAmount === "0.00") return "0";

  const num = parseFloat(humanAmount);
  if (isNaN(num) || num === 0) return "0";

  const maxFrac = getDisplayDecimals(symbol, decimals);

  // For very small amounts, show significant digits instead of "0.00"
  if (num > 0 && num < Math.pow(10, -maxFrac)) {
    const sigDigits = num.toPrecision(2);
    return sigDigits;
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(num);
}

/**
 * Format a USD amount string for display.
 *
 * Shows "$1,234.56" for normal amounts, "< $0.01" for dust,
 * and "—" for unavailable values.
 *
 * @param usdStr  Raw USD string from the API (e.g., "1234.5678") or undefined
 * @returns       Formatted string (e.g., "$1,234.57", "< $0.01")
 */
export function formatUsd(usdStr: string | number | undefined | null): string {
  if (usdStr == null || usdStr === "") return "—";
  const num = typeof usdStr === "number" ? usdStr : parseFloat(String(usdStr));
  if (isNaN(num)) return "—";
  if (num === 0) return "$0.00";
  if (num > 0 && num < 0.01) return "< $0.01";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/* ── Step 17: API connection health check ── */

/** Result from testApiConnection */
export interface ApiHealthResult {
  connected: boolean;
  latencyMs: number;
  tokenCount?: number;
  error?: string;
}

/**
 * Test the VT API connection by calling GET /v1/tokens with a minimal
 * request (limit=1). Returns health status + latency.
 *
 * IMPLEMENTATION NOTE: Used by the admin debug panel on mount to show
 * "Bridge service: Connected ✓" or "Bridge service: Unavailable ✗".
 */
export async function testApiConnection(): Promise<ApiHealthResult> {
  const start = performance.now();
  try {
    const url = `${VT_API_BASE}/tokens?limit=1`;
    const res = await vtFetch(url);
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      return {
        connected: false,
        latencyMs,
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }
    const data = await res.json();
    const tokenCount = Array.isArray(data?.tokens) ? data.tokens.length : undefined;
    log.info("StargateVT", "API health check passed", { latencyMs, tokenCount });
    return { connected: true, latencyMs, tokenCount };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    log.error("StargateVT", `API health check failed: ${err.message}`);
    return { connected: false, latencyMs, error: err.message };
  }
}

/**
 * Convert a human-readable token amount to raw smallest-unit string.
 *
 * This is the inverse of formatTokenAmount. The VT API expects amounts
 * in smallest units (e.g., "1500000" for 1.5 USDC with 6 decimals).
 *
 * Uses pure string manipulation to avoid floating-point precision loss.
 *
 * @param humanAmount  Human-readable amount (e.g., "1.5", "100", "0.001")
 * @param decimals     Token decimals (e.g., 6 for USDC, 18 for ETH)
 * @returns            Raw amount string in smallest unit (e.g., "1500000")
 */
export function parseTokenAmount(humanAmount: string, decimals: number): string {
  if (!humanAmount || humanAmount === "0") return "0";

  // Remove any leading/trailing whitespace and commas
  const cleaned = humanAmount.trim().replace(/,/g, "");

  // Split on decimal point
  const parts = cleaned.split(".");
  const integerPart = parts[0] || "0";
  let fractionalPart = parts[1] || "";

  // Pad or truncate fractional part to exactly `decimals` digits
  if (fractionalPart.length > decimals) {
    // Truncate excess precision (no rounding — user sees what they get)
    fractionalPart = fractionalPart.slice(0, decimals);
  } else {
    fractionalPart = fractionalPart.padEnd(decimals, "0");
  }

  // Concatenate and strip leading zeros
  const raw = (integerPart + fractionalPart).replace(/^0+/, "") || "0";

  return raw;
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Safety guards (Step 14)
 *
 * IMPLEMENTATION NOTE: These helpers power the widget's pre-bridge
 * safety checks — gas estimation, quote expiry, and sanity flags.
 * ══════════════════════════════════════════════════════════════ */

/** Severity for safety warnings */
export type WarningSeverity = "info" | "warn" | "block";

/** A single safety warning to display in the widget */
export interface SafetyWarning {
  id: string;
  severity: WarningSeverity;
  message: string;
}

/** Threshold constants for safety checks */
const SAFETY = {
  /** Warn if bridging > 80% of balance */
  HIGH_BALANCE_PCT: 0.80,
  /** Warn if fee > 5% */
  HIGH_FEE_PCT: 5,
  /** Warn if dstAmountUsd < srcAmountUsd * this factor */
  SLIPPAGE_FACTOR: 0.95,
  /** Warn if any step's gasLimit exceeds this */
  GAS_LIMIT_WARN: 2_000_000,
  /** Auto-refresh quote if expires within this many seconds */
  EXPIRY_REFRESH_SEC: 30,
} as const;

export { SAFETY as SAFETY_THRESHOLDS };

/**
 * Estimate total gas cost in USD for a set of user steps.
 *
 * Uses the native token price and the gasLimit from each step.
 * Falls back gracefully if gasLimit is missing (MetaMask estimates).
 *
 * @param steps            User steps from VT API
 * @param nativeTokenPrice USD price of the source chain's native token
 * @param gasPrice         Current gas price in gwei (default: 30 for mainnet)
 * @returns                { totalGasWei, totalGasUsd, perStep, hasHighGas }
 */
export function estimateGasCost(
  steps: VTUserStep[],
  nativeTokenPrice: number,
  gasPrice: number = 30
): {
  totalGasWei: bigint;
  totalGasUsd: string;
  perStep: { description: string; gasLimit: number; gasUsd: string }[];
  hasHighGas: boolean;
} {
  let totalGasUnits = 0n;
  let hasHighGas = false;
  const perStep: { description: string; gasLimit: number; gasUsd: string }[] = [];

  for (const step of steps) {
    const gl = step.transaction?.encoded?.gasLimit;
    const gasLimit = gl ? parseInt(gl, 10) : 0;

    if (gasLimit > SAFETY.GAS_LIMIT_WARN) {
      hasHighGas = true;
    }

    if (gasLimit > 0) {
      totalGasUnits += BigInt(gasLimit);
      const gasCostUsd = (gasLimit * gasPrice * 1e-9 * nativeTokenPrice);
      perStep.push({
        description: step.description,
        gasLimit,
        gasUsd: `$${gasCostUsd.toFixed(2)}`,
      });
    } else {
      perStep.push({
        description: step.description,
        gasLimit: 0,
        gasUsd: "auto",
      });
    }
  }

  const totalGasWei = totalGasUnits * BigInt(Math.round(gasPrice)) * 1000000000n;
  const totalGasEth = Number(totalGasWei) / 1e18;
  const totalGasUsd = `$${(totalGasEth * nativeTokenPrice).toFixed(2)}`;

  return { totalGasWei, totalGasUsd, perStep, hasHighGas };
}

/**
 * Check if a quote's expiresAt timestamp is within the danger zone.
 *
 * @param expiresAt  ISO 8601 timestamp string (or null)
 * @returns          { isExpired, secondsLeft, shouldRefresh }
 */
export function checkQuoteExpiry(expiresAt: string | null | undefined): {
  isExpired: boolean;
  secondsLeft: number;
  shouldRefresh: boolean;
} {
  if (!expiresAt) return { isExpired: false, secondsLeft: Infinity, shouldRefresh: false };

  const now = Date.now();
  const expiry = new Date(expiresAt).getTime();
  const secondsLeft = Math.max(0, Math.floor((expiry - now) / 1000));

  return {
    isExpired: secondsLeft <= 0,
    secondsLeft,
    shouldRefresh: secondsLeft > 0 && secondsLeft < SAFETY.EXPIRY_REFRESH_SEC,
  };
}

/**
 * Run all safety checks on the current bridge configuration.
 * Returns an array of warnings (may be empty if all checks pass).
 */
export function runSafetyChecks(params: {
  srcAmount: string;
  dstAmount: string;
  srcAmountUsd?: string;
  dstAmountUsd?: string;
  feePercent?: string;
  expiresAt?: string | null;
  userBalanceRaw?: bigint;
  srcDecimals: number;
  srcSymbol: string;
  balanceFormatted?: string;
  steps?: VTUserStep[];
}): SafetyWarning[] {
  const warnings: SafetyWarning[] = [];

  // 1. dstAmount = 0 → block
  if (!params.dstAmount || params.dstAmount === "0") {
    warnings.push({
      id: "dst-zero",
      severity: "block",
      message: "This route is not available right now",
    });
    return warnings;
  }

  // 2. Fee > 5% → warn
  if (params.feePercent) {
    const feePct = parseFloat(params.feePercent);
    if (!isNaN(feePct) && feePct > SAFETY.HIGH_FEE_PCT) {
      warnings.push({
        id: "high-fee",
        severity: "warn",
        message: `High fees detected (${feePct.toFixed(1)}%). Consider bridging later or trying a different route.`,
      });
    }
  }

  // 3. Slippage check — dstAmountUsd < srcAmountUsd * 0.95
  if (params.srcAmountUsd && params.dstAmountUsd) {
    const srcUsd = parseFloat(params.srcAmountUsd);
    const dstUsd = parseFloat(params.dstAmountUsd);
    if (!isNaN(srcUsd) && !isNaN(dstUsd) && srcUsd > 0 && dstUsd < srcUsd * SAFETY.SLIPPAGE_FACTOR) {
      const lossPct = ((1 - dstUsd / srcUsd) * 100).toFixed(1);
      warnings.push({
        id: "high-slippage",
        severity: "warn",
        message: `You may lose ~${lossPct}% of value due to fees and slippage.`,
      });
    }
  }

  // 4. Balance > 80% used → info warning
  if (params.userBalanceRaw != null && params.userBalanceRaw > 0n) {
    try {
      const rawSrcAmount = BigInt(parseTokenAmount(params.srcAmount, params.srcDecimals));
      if (rawSrcAmount > 0n) {
        const ratio = Number(rawSrcAmount * 100n / params.userBalanceRaw);
        if (ratio > SAFETY.HIGH_BALANCE_PCT * 100) {
          warnings.push({
            id: "high-balance-pct",
            severity: "info",
            message: `This is most of your ${params.srcSymbol} balance (${params.balanceFormatted ?? "?"} ${params.srcSymbol})`,
          });
        }
      }
    } catch { /* skip if parse fails */ }
  }

  // 5. Quote expiry → warn/block
  if (params.expiresAt) {
    const expiry = checkQuoteExpiry(params.expiresAt);
    if (expiry.isExpired) {
      warnings.push({
        id: "quote-expired",
        severity: "block",
        message: "Quote has expired. Please refresh to get a new quote.",
      });
    } else if (expiry.shouldRefresh) {
      warnings.push({
        id: "quote-expiring",
        severity: "info",
        message: `Quote expires in ${expiry.secondsLeft}s — will refresh automatically.`,
      });
    }
  }

  // 6. Gas sanity — check for unusually high gasLimit
  if (params.steps) {
    for (const step of params.steps) {
      const gl = step.transaction?.encoded?.gasLimit;
      if (gl) {
        const gasLimit = parseInt(gl, 10);
        if (gasLimit > SAFETY.GAS_LIMIT_WARN) {
          warnings.push({
            id: `high-gas-${step.description}`,
            severity: "warn",
            message: `Unusually high gas estimate for "${step.description}". Verify on stargate.finance before proceeding.`,
          });
          break;
        }
      }
    }
  }

  return warnings;
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Bridge Receipts (Step 15)
 *
 * IMPLEMENTATION NOTE: Stores completed bridge records in localStorage
 * for the "Recent Bridges" widget section. Max 5 entries, FIFO eviction.
 * ══════════════════════════════════════════════════════════════ */

const RECEIPTS_KEY = "wrappdex_bridge_receipts";
const MAX_RECEIPTS = 5;

/** Persistent record of a completed bridge transaction */
export interface BridgeReceipt {
  /** Unique ID (timestamp-based) */
  id: string;
  /** ISO timestamp of bridge initiation */
  timestamp: string;
  /** Source chain name */
  srcChainName: string;
  /** Source chain ID (for explorer links) */
  srcChainId: number;
  /** Source token symbol */
  srcTokenSymbol: string;
  /** Amount sent (human-readable) */
  srcAmount: string;
  /** Destination chain name */
  dstChainName: string;
  /** Destination chain ID */
  dstChainId: number;
  /** Destination token symbol */
  dstTokenSymbol: string;
  /** Expected receive amount (human-readable) */
  dstAmount: string;
  /** Total fee in USD (e.g., "$0.42") */
  feeUsd: string;
  /** Fee percentage (e.g., "0.06%") */
  feePercent: string;
  /** Route type label (e.g., "Stargate V2") */
  routeType: string;
  /** Estimated duration label (e.g., "~2 min") */
  estimatedDuration: string;
  /** Final bridge tx hash (0x...) */
  txHash: string;
  /** All step tx hashes (for multi-step bridges) */
  stepTxHashes: string[];
}

/** Save a new bridge receipt, evicting oldest if over limit. */
export function saveBridgeReceipt(receipt: BridgeReceipt): void {
  try {
    const existing = loadBridgeReceipts();
    existing.unshift(receipt);
    if (existing.length > MAX_RECEIPTS) existing.length = MAX_RECEIPTS;
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(existing));
  } catch (e) {
    log.warn("BridgeReceipt", `Failed to save receipt: ${e}`);
  }
}

/** Load all stored bridge receipts (newest first). */
export function loadBridgeReceipts(): BridgeReceipt[] {
  try {
    const raw = localStorage.getItem(RECEIPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** Clear all stored receipts. */
export function clearBridgeReceipts(): void {
  try {
    localStorage.removeItem(RECEIPTS_KEY);
  } catch { /* ignore */ }
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Transaction execution via MetaMask
 * ══════════════════════════════════════════════════════════════ */

/** Callbacks for UI progress updates during multi-step execution */
export interface StepCallbacks {
  /** Called when a step begins (e.g., show spinner with description) */
  onStepStart?: (index: number, total: number, description: string) => void;
  /** Called when the user signs in MetaMask and the tx is submitted to the mempool */
  onStepSubmitted?: (index: number, txHash: string, description: string) => void;
  /** Called when a step's tx is confirmed on-chain */
  onStepComplete?: (index: number, txHash: string, description: string) => void;
  /** Called when a step fails — execution halts after this */
  onStepError?: (index: number, error: Error, description: string) => void;
}

/** Result of a single executed step */
interface StepResult {
  txHash: string;
  description: string;
  chainKey: string;
}

/** Polling interval for tx receipt checks */
const RECEIPT_POLL_INTERVAL_MS = 2_000;
/** Maximum time to wait for a tx receipt before giving up (5 min — bridge txs can take a while) */
const RECEIPT_TIMEOUT_MS = 300_000;

/**
 * Execute an ordered array of VT API user steps through MetaMask.
 *
 * Steps are executed SEQUENTIALLY because each may depend on the previous
 * (e.g., "Approve USDC" must confirm before "Bridge USDC to Arbitrum").
 *
 * CRITICAL: The transaction data from the VT API is passed to MetaMask
 * UNCHANGED. The API already computed the exact calldata, value, and gasLimit.
 * We only convert numeric strings to hex where the EIP-1193 spec requires it.
 *
 * @param steps      Ordered VTUserStep array from fetchUserSteps/getQuoteWithSteps
 * @param callbacks  Optional UI progress callbacks
 * @returns          Array of confirmed transaction hashes (one per step)
 * @throws           On MetaMask rejection, chain switch failure, or tx revert
 */
export async function executeUserSteps(
  steps: VTUserStep[],
  callbacks?: StepCallbacks
): Promise<string[]> {
  const _eth = getEthereumProvider();
  if (!_eth) {
    throw new Error("MetaMask is not installed. Please install MetaMask to bridge tokens.");
  }

  if (steps.length === 0) {
    throw new Error("No transaction steps to execute.");
  }

  log.info("StargateVT", `Executing ${steps.length} user step(s)`, {
    steps: steps.map((s) => s.description),
  });

  const txHashes: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const tx = step.transaction.encoded;

    // Notify UI
    callbacks?.onStepStart?.(i, steps.length, step.description);
    log.info("StargateVT", `Step ${i + 1}/${steps.length}: ${step.description}`, {
      chainKey: step.chainKey,
      chainId: tx.chainId,
      to: tx.to,
      value: tx.value ?? "0",
      hasData: !!tx.data,
      gasLimit: tx.gasLimit ?? "auto",
    });

    try {
      // 1. Ensure MetaMask is on the correct chain
      await ensureCorrectChain(tx.chainId);

      // 2. Build the eth_sendTransaction params
      //    IMPLEMENTATION NOTE: We pass the API's transaction fields through
      //    unchanged. Only format conversion (decimal string → hex) is applied
      //    where the EIP-1193 JSON-RPC spec mandates hex encoding.
      const txParams: Record<string, string> = {
        to: tx.to,
      };

      if (tx.from) {
        txParams.from = tx.from;
      } else {
        // If the API didn't specify 'from', use the signer address from the step
        txParams.from = step.signerAddress;
      }

      if (tx.data) {
        txParams.data = tx.data;
      }

      if (tx.value) {
        txParams.value = toHex(tx.value);
      }

      if (tx.gasLimit) {
        // IMPLEMENTATION NOTE: The API provides a computed gasLimit. We pass it
        // as the 'gas' param so MetaMask uses it instead of estimating.
        // This avoids estimation failures on complex bridge transactions.
        txParams.gas = toHex(tx.gasLimit);
      }
      // If no gasLimit provided, omit 'gas' — MetaMask will estimate

      // 3. Submit to MetaMask — user sees the approval popup
      log.debug("StargateVT", `Submitting tx to MetaMask`, { txParams });

      const txHash: string = await _eth.request({
        method: "eth_sendTransaction",
        params: [txParams],
      });

      log.info("StargateVT", `Step ${i + 1} submitted: ${txHash}`);
      callbacks?.onStepSubmitted?.(i, txHash, step.description);

      // 4. Wait for on-chain confirmation
      await waitForReceipt(txHash);

      log.info("StargateVT", `Step ${i + 1} confirmed: ${txHash}`);

      txHashes.push(txHash);
      callbacks?.onStepComplete?.(i, txHash, step.description);

    } catch (err: any) {
      const error = normalizeMetaMaskError(err, step.description);
      log.error("StargateVT", `Step ${i + 1} failed: ${error.message}`, { err });
      callbacks?.onStepError?.(i, error, step.description);
      throw error;
    }
  }

  log.info("StargateVT", `All ${steps.length} steps completed`, { txHashes });
  return txHashes;
}

/* ══════════════════════════════════════════════════════════════
 * Internal helpers — chain switching
 * ══════════════════════════════════════════════════════════════ */

/**
 * Ensure MetaMask is connected to the required chain.
 * If already on the correct chain, this is a no-op.
 * Uses the existing switchChain from metamask.ts which handles
 * wallet_switchEthereumChain + wallet_addEthereumChain fallback.
 */
async function ensureCorrectChain(requiredChainId: number): Promise<void> {
  const currentChainId = await getChainId();

  if (currentChainId === requiredChainId) {
    log.debug("StargateVT", `Already on chain ${requiredChainId}`);
    return;
  }

  log.info("StargateVT", `Switching chain: ${currentChainId} → ${requiredChainId}`);

  const success = await switchChain(requiredChainId);
  if (!success) {
    throw new Error(
      `Failed to switch MetaMask to chain ${requiredChainId}. ` +
      `Please switch manually and try again.`
    );
  }

  // Verify the switch actually happened
  const newChainId = await getChainId();
  if (newChainId !== requiredChainId) {
    throw new Error(
      `Chain switch verification failed. Expected ${requiredChainId}, got ${newChainId}. ` +
      `Please switch manually in MetaMask.`
    );
  }

  log.info("StargateVT", `Successfully switched to chain ${requiredChainId}`);
}

/* ══════════════════════════════════════════════════════════════
 * Internal helpers — receipt polling
 * ══════════════════════════════════════════════════════════════ */

/**
 * Poll eth_getTransactionReceipt until the tx is confirmed or timeout.
 * Throws on timeout or reverted transaction.
 */
async function waitForReceipt(txHash: string): Promise<void> {
  const start = Date.now();
  const eth = getEthereumProvider();
  if (!eth) throw new Error("No EVM wallet provider available");

  while (Date.now() - start < RECEIPT_TIMEOUT_MS) {
    try {
      const receipt = await eth.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      });

      if (receipt) {
        // IMPLEMENTATION NOTE: receipt.status is "0x1" for success, "0x0" for revert.
        // Some providers return numeric 1/0 instead of hex strings.
        const status = typeof receipt.status === "string"
          ? parseInt(receipt.status, 16)
          : receipt.status;

        if (status === 0) {
          throw new Error(
            `Transaction reverted on-chain (${txHash}). ` +
            `The bridge contract rejected the transaction. This may indicate ` +
            `insufficient balance, expired approval, or a route issue.`
          );
        }

        // status === 1 → success
        return;
      }
    } catch (err: any) {
      // If the error is our own revert error, re-throw it
      if (err.message?.includes("reverted on-chain")) throw err;
      // Otherwise it's a provider error — log and keep polling
      log.warn("StargateVT", `Receipt poll error for ${txHash}: ${err?.message}`);
    }

    // Wait before next poll
    await sleep(RECEIPT_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Transaction receipt timeout after ${RECEIPT_TIMEOUT_MS / 1000}s for ${txHash}. ` +
    `The transaction may still confirm — check the block explorer.`
  );
}

/* ══════════════════════════════════════════════════════════════
 * Internal helpers — hex conversion & error normalization
 * ══════════════════════════════════════════════════════════════ */

/**
 * Convert a decimal string or number to a hex string with 0x prefix.
 * The EIP-1193 JSON-RPC spec requires hex encoding for value/gas fields.
 *
 * IMPLEMENTATION NOTE: We use BigInt to handle values that exceed
 * Number.MAX_SAFE_INTEGER (common for wei amounts).
 */
function toHex(value: string | number): string {
  try {
    const bi = BigInt(value);
    return `0x${bi.toString(16)}`;
  } catch {
    // Fallback: if already hex-prefixed, return as-is
    if (typeof value === "string" && value.startsWith("0x")) return value;
    // Last resort: try Number conversion (loses precision for large values)
    return `0x${Number(value).toString(16)}`;
  }
}

/**
 * Normalize MetaMask errors into user-friendly messages.
 * MetaMask error codes: 4001 = user rejected, 4100 = unauthorized,
 * -32603 = internal error, -32002 = already pending.
 */
function normalizeMetaMaskError(err: any, stepDescription: string): Error {
  const code = err?.code;
  const message = err?.message ?? String(err);

  if (code === 4001 || message.includes("User denied") || message.includes("rejected")) {
    return new Error(
      `Transaction rejected by user during "${stepDescription}". Bridge cancelled.`
    );
  }

  if (code === -32002 || message.includes("already pending")) {
    return new Error(
      `A MetaMask request is already pending. Please check MetaMask and approve or reject ` +
      `the existing request before trying again.`
    );
  }

  if (code === -32603 || message.includes("Internal JSON-RPC error")) {
    return new Error(
      `MetaMask internal error during "${stepDescription}": ${message}. ` +
      `This may indicate insufficient gas or a contract error.`
    );
  }

  if (message.includes("insufficient funds")) {
    return new Error(
      `Insufficient funds for "${stepDescription}". ` +
      `Make sure you have enough native tokens to cover gas fees.`
    );
  }

  return new Error(`Bridge step "${stepDescription}" failed: ${message}`);
}

/** Simple async sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ══════════════════════════════════════════════════════════════
 * Internal helpers — formatting
 * ══════════════════════════════════════════════════════════════ */

/**
 * Format a duration string from the VT API (ISO 8601 or seconds)
 * into a human-friendly display string.
 */
function formatDuration(estimated: string | null | undefined): string {
  if (!estimated) return "—";

  // The API may return seconds as a plain number string
  const seconds = parseInt(estimated, 10);
  if (!isNaN(seconds) && seconds > 0) {
    if (seconds < 60) return `~${seconds}s`;
    if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min`;
    return `~${(seconds / 3600).toFixed(1)} hr`;
  }

  // If it's an ISO duration like "PT2M" or a descriptive string, return as-is
  return estimated;
}

/* ══════════════════════════════════════════════════════════════
 * Error class
 * ══════════════════════════════════════════════════════════════ */

/**
 * Structured error from the VT API with HTTP status code.
 * Callers can inspect `status` for retry/display logic:
 *   400 = bad request, 404 = expired, 429 = rate limited, 500 = server error
 */
export class VTApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "VTApiError";
  }
}

/* ══════════════════════════════════════════════════════════════
 * Internal helpers — numeric comparison
 * ══════════════════════════════════════════════════════════════ */

/**
 * Compare two numeric strings as BigInts for sorting.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 * Falls back to string comparison if BigInt parsing fails.
 */
function compareBigIntStrings(a: string, b: string): number {
  try {
    const ba = BigInt(a);
    const bb = BigInt(b);
    if (ba < bb) return -1;
    if (ba > bb) return 1;
    return 0;
  } catch {
    return a.localeCompare(b);
  }
}

/* ══════════════════════════════════════════════════════════════
 * URL builder
 * ══════════════════════════════════════════════════════════════ */

function buildTokensUrl(
  params: Record<string, string>,
  nextToken?: string
): string {
  const url = new URL(`${VT_API_BASE}/tokens`);
  for (const [key, val] of Object.entries(params)) {
    if (val) url.searchParams.set(key, val);
  }
  if (nextToken) {
    // IMPLEMENTATION NOTE: The VT API uses a nested pagination object.
    // The OpenAPI spec shows `pagination: { nextToken }` as a query param.
    // Encode as JSON per the spec's object-type parameter.
    url.searchParams.set("pagination", JSON.stringify({ nextToken }));
  }
  return url.toString();
}

/* ══════════════════════════════════════════════════════════════
 * Public API — Error classification (Step 13)
 *
 * IMPLEMENTATION NOTE: These helpers let the widget display contextual,
 * user-friendly error messages and decide on auto-recovery behavior
 * (e.g., auto-refresh on 404, countdown on 429).
 * ══════════════════════════════════════════════════════════════ */

/** Semantic error kind for UI display logic */
export type VTErrorKind =
  | "user-rejected"      // MetaMask 4001 — not a real error
  | "pending-request"    // MetaMask -32002 — already pending approval
  | "rpc-error"          // MetaMask -32603 — internal JSON-RPC
  | "bad-request"        // VT API 400 — invalid params
  | "quote-expired"      // VT API 404 — quote no longer valid
  | "rate-limited"       // VT API 429 — too many requests
  | "server-error"       // VT API 5xx — service unavailable
  | "timeout"            // Request timed out
  | "network-error"      // fetch() failed (offline, DNS, etc.)
  | "insufficient-funds" // Wallet balance too low
  | "tx-reverted"        // On-chain revert
  | "unknown";           // Catch-all

/** Classified error with user-friendly message and metadata */
export interface ClassifiedError {
  kind: VTErrorKind;
  /** Short, user-facing message (safe to display in the UI) */
  userMessage: string;
  /** Full technical message (for logs / debug report) */
  technicalMessage: string;
  /** Suggested retry delay in seconds (0 = no auto-retry) */
  retryAfterSec: number;
  /** Whether this is a "soft" error that should NOT show the red error panel */
  isSoft: boolean;
}

/**
 * Classify any error thrown during VT API / MetaMask operations into a
 * structured format the widget can use for display and auto-recovery.
 */
export function classifyError(err: any): ClassifiedError {
  const msg: string = err?.message ?? String(err);

  // ── MetaMask errors (check first — these happen during execution) ──
  if (err?.code === 4001 || msg.includes("User denied") || msg.includes("rejected by user") || msg.includes("user rejected")) {
    return {
      kind: "user-rejected",
      userMessage: "Transaction cancelled",
      technicalMessage: msg,
      retryAfterSec: 0,
      isSoft: true,
    };
  }

  if (err?.code === -32002 || msg.includes("already pending")) {
    return {
      kind: "pending-request",
      userMessage: "Please check MetaMask for a pending request",
      technicalMessage: msg,
      retryAfterSec: 0,
      isSoft: false,
    };
  }

  if (err?.code === -32603 || msg.includes("Internal JSON-RPC")) {
    return {
      kind: "rpc-error",
      userMessage: "Transaction failed — check gas and try again",
      technicalMessage: msg,
      retryAfterSec: 0,
      isSoft: false,
    };
  }

  if (msg.includes("insufficient funds")) {
    return {
      kind: "insufficient-funds",
      userMessage: "Insufficient funds for gas + bridge amount",
      technicalMessage: msg,
      retryAfterSec: 0,
      isSoft: false,
    };
  }

  if (msg.includes("reverted on-chain")) {
    return {
      kind: "tx-reverted",
      userMessage: "Transaction reverted on-chain — the bridge contract rejected it",
      technicalMessage: msg,
      retryAfterSec: 0,
      isSoft: false,
    };
  }

  // ── VT API errors ──
  if (err instanceof VTApiError) {
    if (err.status === 400) {
      return {
        kind: "bad-request",
        userMessage: "Invalid transfer configuration — check amounts and tokens",
        technicalMessage: msg,
        retryAfterSec: 0,
        isSoft: false,
      };
    }
    if (err.status === 404) {
      return {
        kind: "quote-expired",
        userMessage: "Quote expired, refreshing...",
        technicalMessage: msg,
        retryAfterSec: 2,
        isSoft: true,
      };
    }
    if (err.status === 429) {
      return {
        kind: "rate-limited",
        userMessage: "Too many requests — please wait",
        technicalMessage: msg,
        retryAfterSec: 15,
        isSoft: false,
      };
    }
    if (err.status >= 500) {
      return {
        kind: "server-error",
        userMessage: "Bridge service temporarily unavailable",
        technicalMessage: msg,
        retryAfterSec: 10,
        isSoft: false,
      };
    }
  }

  // ── Network / timeout errors ──
  if (msg.includes("timed out")) {
    return {
      kind: "timeout",
      userMessage: "Request timed out — please try again",
      technicalMessage: msg,
      retryAfterSec: 3,
      isSoft: false,
    };
  }

  if (msg.includes("network error") || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return {
      kind: "network-error",
      userMessage: "Network error — check your connection",
      technicalMessage: msg,
      retryAfterSec: 5,
      isSoft: false,
    };
  }

  // ── Catch-all ──
  return {
    kind: "unknown",
    userMessage: msg.length > 120 ? msg.slice(0, 120) + "..." : msg,
    technicalMessage: msg,
    retryAfterSec: 0,
    isSoft: false,
  };
}

/**
 * Check if an error is a user rejection (not a real error).
 * Convenience wrapper — the widget uses this to decide whether to
 * show the error panel or silently dismiss.
 */
export function isUserRejection(err: any): boolean {
  return classifyError(err).kind === "user-rejected";
}

/**
 * Build a debug report string for clipboard copy ("Report Issue").
 * Contains all context needed to diagnose a bridge failure.
 */
export function buildDebugReport(context: {
  quoteId?: string;
  routeType?: string;
  srcChain?: string;
  dstChain?: string;
  srcToken?: string;
  dstToken?: string;
  amount?: string;
  walletAddress?: string;
  walletChainId?: number;
  error?: string;
  txHashes?: string[];
  phase?: string;
}): string {
  const ts = new Date().toISOString();
  const lines = [
    `=== WRAPpDEX Bridge Debug Report ===`,
    `Timestamp: ${ts}`,
    `Phase: ${context.phase ?? "unknown"}`,
    ``,
    `-- Route --`,
    `Quote ID: ${context.quoteId ?? "N/A"}`,
    `Route: ${context.routeType ?? "N/A"}`,
    `From: ${context.srcChain ?? "?"} → ${context.dstChain ?? "?"}`,
    `Tokens: ${context.srcToken ?? "?"} → ${context.dstToken ?? "?"}`,
    `Amount: ${context.amount ?? "N/A"}`,
    ``,
    `-- Wallet --`,
    `Address: ${context.walletAddress ?? "N/A"}`,
    `Chain ID: ${context.walletChainId ?? "N/A"}`,
    ``,
    `-- Error --`,
    context.error ?? "No error message",
    ``,
    `-- Tx Hashes --`,
    ...(context.txHashes?.length ? context.txHashes : ["None"]),
    ``,
    `================================`,
  ];
  return lines.join("\n");
}
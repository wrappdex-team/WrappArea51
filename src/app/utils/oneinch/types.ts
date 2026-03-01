/**
 * 1inch DEX Aggregator — Canonical Type Definitions
 *
 * Covers every API surface the WRAPpDEX 1inch integration touches:
 *   - Swap API v6.0       (classic on-chain aggregation)
 *   - Fusion API v2.0     (gasless intent-based swaps)
 *   - Fusion+ API v1.0    (cross-chain intent-based swaps)
 *   - Token API v1.2      (metadata, search, custom import)
 *   - Balance API v1.2    (multi-token wallet balances)
 *   - Price API v1.1      (USD prices for tokens)
 *   - Orderbook API v4.0  (limit orders)
 *
 * IMPLEMENTATION NOTE: Types are organised by API domain, then by
 * request → response ordering within each domain. Every field carries
 * a JSDoc comment so IDE hover-info is useful without needing to open
 * the 1inch portal docs.
 *
 * @module oneinch/types
 */

/* ══════════════════════════════════════════════════════════════════════
 * Shared Primitives
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * The sentinel address the 1inch API uses for chain-native tokens
 * (ETH on Ethereum, POL on Polygon, BNB on BSC, etc.).
 */
export const NATIVE_TOKEN_ADDRESS =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

/**
 * Swap execution mode — determines the underlying 1inch protocol used.
 *
 *   `fusion`      – Gasless intent-based swap (resolvers pay gas).
 *   `classic`     – Traditional on-chain aggregated swap (user pays gas).
 *   `limit`       – Limit order placed in the 1inch orderbook.
 *   `crossChain`  – Fusion+ cross-chain intent-based swap.
 */
export type SwapMode = "fusion" | "classic" | "limit" | "crossChain";

/**
 * Universal error envelope returned by the API client when an upstream
 * call fails. Carries enough context for the UI to show a useful message
 * AND for the developer to diagnose the root cause.
 */
export interface OneInchError {
  /** Machine-readable error classification */
  readonly kind: OneInchErrorKind;
  /** HTTP status from upstream (0 if network/timeout) */
  readonly status: number;
  /** Human-readable error description */
  readonly message: string;
  /** Raw upstream error body, if available */
  readonly details?: string;
  /** Whether the caller should retry */
  readonly retryable: boolean;
}

/**
 * Exhaustive error classification.
 *
 * IMPLEMENTATION NOTE: Every API call in api-client.ts maps raw HTTP
 * status codes and error shapes to one of these kinds, giving the UI
 * a reliable `switch` target for user-facing messages.
 */
export type OneInchErrorKind =
  | "API_KEY_MISSING"       // ONEINCH_API_KEY not set in Supabase secrets
  | "API_KEY_INVALID"       // Key exists but 1inch rejects it (401/403)
  | "RATE_LIMITED"          // 429 from 1inch or our own rate limiter
  | "INSUFFICIENT_LIQUIDITY" // No route found for this pair/amount
  | "INVALID_PARAMS"        // Bad request (400) — malformed input
  | "UPSTREAM_ERROR"        // 5xx from 1inch
  | "CIRCUIT_OPEN"          // Our circuit breaker tripped
  | "TIMEOUT"               // Request exceeded deadline
  | "NETWORK_ERROR"         // DNS/TLS/fetch failure
  | "ROUTE_NOT_FOUND"       // 404 from our proxy — endpoint not deployed
  | "UNKNOWN";              // Catch-all

/* ══════════════════════════════════════════════════════════════════════
 * Token API v1.2
 * ══════════════════════════════════════════════════════════════════════ */

/** Core token metadata — shared across all API domains */
export interface TokenInfo {
  /** EVM contract address (checksummed) or NATIVE_TOKEN_ADDRESS */
  readonly address: string;
  /** Ticker symbol (e.g., "USDC", "WETH") */
  readonly symbol: string;
  /** Human-readable name (e.g., "USD Coin") */
  readonly name: string;
  /** On-chain decimal precision (e.g., 6 for USDC, 18 for ETH) */
  readonly decimals: number;
  /** URL to token logo image (may be null for obscure tokens) */
  readonly logoURI: string | null;
  /** Whether this is the chain's native gas token */
  readonly isNative: boolean;
  /** Tags from 1inch (e.g., "tokens", "PEG:USD") */
  readonly tags?: readonly string[];
  /** Whether 1inch has verified this token's contract */
  readonly isVerified?: boolean;
}

/** Response from GET /token/v1.2/{chainId}/search */
export interface TokenSearchResponse {
  readonly tokens: TokenInfo[];
}

/** Response from GET /token/v1.2/{chainId}/custom */
export interface TokenCustomResponse {
  /** The resolved token, or null if the address is invalid/unknown */
  readonly token: TokenInfo | null;
}

/**
 * Full token list response from GET /swap/v6.0/{chainId}/tokens.
 * Keyed by lowercase address → token metadata.
 */
export interface TokenListResponse {
  readonly tokens: Record<string, RawTokenFromAPI>;
}

/**
 * Raw token shape as returned by the 1inch Swap API token endpoint.
 * Normalised into TokenInfo by the tokens module.
 */
export interface RawTokenFromAPI {
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly logoURI?: string;
  readonly tags?: string[];
  readonly isVerified?: boolean;
}

/* ══════════════════════════════════════════════════════════════════════
 * Price API v1.1
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Response from GET /price/v1.1/{chainId}.
 * Maps lowercase token address → USD price as a string.
 */
export type PriceResponse = Record<string, string>;

/* ══════════════════════════════════════════════════════════════════════
 * Balance API v1.2
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Response from GET /balance/v1.2/{chainId}/balances/{walletAddress}.
 * Maps lowercase token address → raw balance in smallest unit.
 */
export type BalanceResponse = Record<string, string>;

/* ══════════════════════════════════════════════════════════════════════
 * Swap API v6.0 — Classic Aggregation
 * ══════════════════════════════════════════════════════════════════════ */

/** Parameters for requesting a classic swap quote */
export interface ClassicQuoteParams {
  /** Source token address */
  readonly src: string;
  /** Destination token address */
  readonly dst: string;
  /** Amount in smallest unit (e.g., "1000000" for 1 USDC) */
  readonly amount: string;
  /** Include estimated gas in the response */
  readonly includeGas?: boolean;
  /** Referrer fee percentage (0–3) */
  readonly fee?: string;
  /** Restrict to specific DEX protocols (comma-separated) */
  readonly protocols?: string;
  /** Include full token metadata in the response */
  readonly includeTokensInfo?: boolean;
}

/** Response from GET /swap/v6.0/{chainId}/quote */
export interface ClassicQuoteResponse {
  /** Destination amount in smallest unit */
  readonly dstAmount: string;
  /** Source token metadata */
  readonly srcToken: { address: string; symbol: string; decimals: number; name: string; logoURI?: string };
  /** Destination token metadata */
  readonly dstToken: { address: string; symbol: string; decimals: number; name: string; logoURI?: string };
  /** Estimated gas units */
  readonly gas?: number;
  /** Aggregation protocols used in the optimal route */
  readonly protocols?: ReadonlyArray<ReadonlyArray<ReadonlyArray<ProtocolPart>>>;
  /** Whether this quote was served from our server-side cache */
  readonly cached?: boolean;
  /**
   * Sentinel field — present only when the API key is not configured.
   * If `configured === false`, the UI should show an API key prompt
   * instead of a quote error.
   */
  readonly configured?: false;
  /** Error message from upstream, if any */
  readonly error?: string;
  /** Detailed error description */
  readonly details?: string;
}

/**
 * One leg of the optimal swap route.
 * A single swap may be split across multiple DEXes for better pricing.
 */
export interface ProtocolPart {
  /** DEX protocol name (e.g., "UNISWAP_V3", "CURVE", "SUSHISWAP") */
  readonly name: string;
  /** Percentage of the total amount routed through this protocol */
  readonly part: number;
  /** Source token for this leg */
  readonly fromTokenAddress: string;
  /** Destination token for this leg */
  readonly toTokenAddress: string;
}

/** Parameters for building a classic swap transaction */
export interface ClassicSwapParams {
  /** Source token address */
  readonly src: string;
  /** Destination token address */
  readonly dst: string;
  /** Amount in smallest unit */
  readonly amount: string;
  /** Sender/signer address */
  readonly from: string;
  /** Maximum acceptable slippage (0–50%) */
  readonly slippage: number;
  /** Skip on-chain simulation (required when sender has no balance yet) */
  readonly disableEstimate?: boolean;
  /** Restrict to specific DEX protocols */
  readonly protocols?: string;
  /** Send output to a different address */
  readonly receiver?: string;
  /** Referrer address for fee sharing */
  readonly referrer?: string;
}

/** Response from GET /swap/v6.0/{chainId}/swap */
export interface ClassicSwapResponse {
  /** The pre-built transaction to sign */
  readonly tx: ClassicSwapTransaction;
  /** Destination amount in smallest unit */
  readonly dstAmount?: string;
  /** Source token metadata */
  readonly srcToken?: { address: string; symbol: string; decimals: number };
  /** Destination token metadata */
  readonly dstToken?: { address: string; symbol: string; decimals: number };
  /** Aggregation route used */
  readonly protocols?: ReadonlyArray<ReadonlyArray<ReadonlyArray<ProtocolPart>>>;
  /** Sentinel for unconfigured API key */
  readonly configured?: false;
  /** Error message */
  readonly error?: string;
  /** Error details */
  readonly details?: string;
}

/** EVM transaction returned by the Classic Swap API */
export interface ClassicSwapTransaction {
  /** Target contract address */
  readonly to: string;
  /** ABI-encoded calldata */
  readonly data: string;
  /** Native value in wei */
  readonly value: string;
  /** Estimated gas limit */
  readonly gas?: number;
  /** Gas price in wei (optional) */
  readonly gasPrice?: string;
}

/** Allowance check response */
export interface AllowanceResponse {
  /** Current allowance in smallest unit */
  readonly allowance: string;
  /** Sentinel for unconfigured API key */
  readonly configured?: false;
}

/** Approval transaction response */
export interface ApprovalResponse {
  /** Spender contract address */
  readonly to: string;
  /** ABI-encoded approve() calldata */
  readonly data: string;
  /** Native value (always "0") */
  readonly value: string;
  /** Estimated gas limit */
  readonly gas?: number;
  /** Sentinel for unconfigured API key */
  readonly configured?: false;
}

/* ═════════════════════════════════════════════════════════════════════
 * Fusion API v2.0 — Gasless Intent-Based Swaps
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Preset speed tiers for Fusion order execution.
 *
 * Faster presets offer slightly worse rates because resolvers demand
 * a premium for immediate execution. The UI should display all three
 * and let the user choose.
 */
export type FusionPreset = "fast" | "medium" | "slow" | "custom";

/** Parameters for requesting a Fusion quote */
export interface FusionQuoteParams {
  /** Source token address */
  readonly srcTokenAddress: string;
  /** Destination token address */
  readonly dstTokenAddress: string;
  /** Amount in smallest unit */
  readonly amount: string;
  /** Wallet address of the user */
  readonly walletAddress: string;
  /** Enable gas estimation in the response */
  readonly enableEstimate?: boolean;
  /** Permit2-compatible token approval (gasless approval) */
  readonly permit?: string;
  /** Fee configuration for integrators */
  readonly fee?: number;
  /** Receiver address (if different from walletAddress) */
  readonly receiver?: string;
  /** Source chain ID (for Fusion+ — omit for same-chain) */
  readonly srcChain?: number;
}

/** Preset-specific quote details */
export interface FusionPresetQuote {
  /** The preset speed tier */
  readonly preset: FusionPreset;
  /** Expected output in smallest unit */
  readonly dstAmount: string;
  /** Auction start amount (resolver sees this initially) */
  readonly auctionStartAmount: string;
  /** Auction end amount (worst price resolver will accept) */
  readonly auctionEndAmount: string;
  /** Estimated fill time in seconds */
  readonly estimatedTime: number;
  /** Auction duration in seconds (Fusion+ cross-chain quotes) */
  readonly auctionDuration?: number;
}

/** Response from POST /fusion/v2.0/{chainId}/quote/receive */
export interface FusionQuoteResponse {
  /** Quote identifier — required for the /order/build call */
  readonly quoteId: string;
  /** Source token amount in smallest unit */
  readonly srcTokenAmount: string;
  /** Recommended preset based on current market conditions */
  readonly recommendedPreset: FusionPreset;
  /** Per-preset fill estimates */
  readonly presets: {
    readonly fast: FusionPresetQuote;
    readonly medium: FusionPresetQuote;
    readonly slow: FusionPresetQuote;
    readonly custom?: FusionPresetQuote;
  };
  /** Volume data for price impact calculation */
  readonly volume?: { readonly usd: string };
  /** Fee token info */
  readonly feeToken?: string;
  /** Estimated gas that the resolver will pay (user saves this!) */
  readonly estimatedGas?: number;
  /** Settlement contract address */
  readonly settlementAddress?: string;
  /** Whitelist of resolvers that can fill this order */
  readonly whitelistedResolvers?: readonly string[];
}

/** Parameters for building a Fusion order (ready to sign) */
export interface FusionOrderBuildParams {
  /** Quote ID from FusionQuoteResponse.quoteId */
  readonly quoteId: string;
  /** Wallet address of the order creator */
  readonly walletAddress: string;
  /** Selected speed preset */
  readonly preset: FusionPreset;
  /** Permit2 data (if using gasless approval) */
  readonly permit?: string;
  /** Optional: use a specific nonce */
  readonly nonce?: string;
  /** Receiver address (if different from walletAddress) */
  readonly receiver?: string;
}

/** Response from POST /fusion/v2.0/{chainId}/order/build */
export interface FusionOrderBuildResponse {
  /** Unique order hash */
  readonly orderHash: string;
  /**
   * EIP-712 typed data for the user to sign.
   * Pass to `eth_signTypedData_v4` — this is NOT a transaction,
   * so the user pays zero gas.
   */
  readonly typedData: EIP712TypedData;
  /**
   * Serialised order struct — must be forwarded unchanged to
   * POST /order/submit alongside the signature.
   */
  readonly order?: Record<string, unknown>;
  /**
   * Extension data blob — opaque to us, forwarded to submit.
   */
  readonly extension?: string;
  /**
   * Quote ID echo — used for traceability in the submit call.
   */
  readonly quoteId?: string;
}

/**
 * EIP-712 typed data structure for signing Fusion orders.
 *
 * IMPLEMENTATION NOTE: This exact structure is what MetaMask/Rabby
 * expect when calling `eth_signTypedData_v4`. The API returns it
 * pre-built — we just pass it through.
 */
export interface EIP712TypedData {
  readonly types: Record<string, readonly EIP712Field[]>;
  readonly primaryType: string;
  readonly domain: EIP712Domain;
  readonly message: Record<string, unknown>;
}

/** EIP-712 type field definition */
export interface EIP712Field {
  readonly name: string;
  readonly type: string;
}

/** EIP-712 domain separator */
export interface EIP712Domain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: string;
}

/** Parameters for submitting a signed Fusion order */
export interface FusionOrderSubmitParams {
  /** The order hash from FusionOrderBuildResponse */
  readonly orderHash: string;
  /** The EIP-712 signature from the user's wallet */
  readonly signature: string;
  /** Quote ID for traceability */
  readonly quoteId: string;
  /** Extension data (returned by build, pass through unchanged) */
  readonly extension?: string;
  /** Order data (returned by build, pass through unchanged) */
  readonly order?: Record<string, unknown>;
}

/**
 * Order fill status lifecycle.
 *
 *   pending    → Order created, waiting for resolver pickup.
 *   assigned   → A resolver has committed to fill the order.
 *   executing  → Resolver is executing the on-chain swap.
 *   filled     → Order fully filled. User received tokens.
 *   expired    → No resolver filled before the deadline.
 *   cancelled  → User cancelled before fill.
 *   failed     → Resolver attempted but the on-chain tx reverted.
 */
export type FusionOrderStatus =
  | "pending"
  | "assigned"
  | "executing"
  | "filled"
  | "expired"
  | "cancelled"
  | "failed";

/** Response from GET /fusion/v2.0/{chainId}/order/status/{orderHash} */
export interface FusionOrderStatusResponse {
  /** Current lifecycle status */
  readonly status: FusionOrderStatus;
  /** Order hash */
  readonly orderHash: string;
  /** Src token address */
  readonly srcTokenAddress?: string;
  /** Dst token address */
  readonly dstTokenAddress?: string;
  /** Input amount in smallest unit */
  readonly srcTokenAmount?: string;
  /** Actual output amount in smallest unit (populated on fill) */
  readonly dstTokenAmount?: string;
  /** Timestamp when the order was created (ISO 8601) */
  readonly createdAt?: string;
  /** Timestamp when the order was filled (ISO 8601, null if not filled) */
  readonly filledAt?: string;
  /** Resolver address that filled the order */
  readonly resolverAddress?: string;
  /** Fill transaction hash on-chain (null until filled) */
  readonly txHash?: string;
  /** Remaining auction amount */
  readonly remainingAmount?: string;
}

/** Response from GET /fusion/v2.0/{chainId}/order/active */
export interface FusionActiveOrdersResponse {
  readonly orders: readonly FusionOrderStatusResponse[];
}

/* ══════════════════════════════════════════════════════════════════════
 * Fusion+ API v1.0 — Cross-Chain Intent-Based Swaps
 * ══════════════════════════════════════════════════════════════════════ */

/** Parameters for requesting a Fusion+ cross-chain quote */
export interface FusionPlusQuoteParams {
  /** Source chain EVM ID */
  readonly srcChainId: number;
  /** Destination chain EVM ID */
  readonly dstChainId: number;
  /** Source token address */
  readonly srcTokenAddress: string;
  /** Destination token address */
  readonly dstTokenAddress: string;
  /** Amount in smallest unit */
  readonly amount: string;
  /** User's wallet address on the source chain */
  readonly walletAddress: string;
  /** Enable gas estimation */
  readonly enableEstimate?: boolean;
  /** Referrer fee (basis points) */
  readonly fee?: number;
}

/** Response from POST /fusion-plus/v1.0/quote/receive */
export interface FusionPlusQuoteResponse {
  /** Unique quote ID for building the cross-chain order */
  readonly quoteId: string;
  /** Source chain ID */
  readonly srcChainId: number;
  /** Destination chain ID */
  readonly dstChainId: number;
  /** Source token amount in smallest unit */
  readonly srcTokenAmount: string;
  /** Expected destination amount in smallest unit */
  readonly dstTokenAmount: string;
  /** Recommended speed preset */
  readonly recommendedPreset: FusionPreset;
  /** Per-preset estimates (some presets may be absent for certain pairs) */
  readonly presets?: {
    readonly fast?: FusionPresetQuote;
    readonly medium?: FusionPresetQuote;
    readonly slow?: FusionPresetQuote;
  };
  /** Estimated total time for the cross-chain transfer */
  readonly estimatedTime?: number;
  /** Cross-chain fee breakdown */
  readonly fees?: {
    readonly srcChainFee?: string;
    readonly dstChainFee?: string;
    readonly protocolFee?: string;
  };
}

/** Parameters for building a Fusion+ cross-chain order */
export interface FusionPlusOrderBuildParams {
  /** Quote ID from FusionPlusQuoteResponse */
  readonly quoteId: string;
  /** User's wallet address */
  readonly walletAddress: string;
  /** Selected speed preset */
  readonly preset: FusionPreset;
  /** Receiver address on the destination chain */
  readonly receiver?: string;
  /** Permit2 data */
  readonly permit?: string;
}

/** Response from POST /fusion-plus/v1.0/order/build */
export interface FusionPlusOrderBuildResponse {
  /** Unique order hash */
  readonly orderHash: string;
  /** EIP-712 typed data for signing */
  readonly typedData: EIP712TypedData;
  /** Source chain ID */
  readonly srcChainId: number;
  /** Destination chain ID */
  readonly dstChainId: number;
}

/**
 * Cross-chain order status lifecycle.
 *
 *   SrcPending   → Order signed, waiting for source-chain resolver.
 *   SrcFilled    → Source chain swap completed.
 *   DstPending   → Cross-chain message in transit.
 *   DstFilled    → Destination chain delivery completed.
 *   Failed       → Order failed at some stage.
 *   Expired      → No resolver filled before deadline.
 *   Cancelled    → User cancelled.
 */
export type FusionPlusOrderStatus =
  | "SrcPending"
  | "SrcFilled"
  | "DstPending"
  | "DstFilled"
  | "Failed"
  | "Expired"
  | "Cancelled";

/** Response from GET /fusion-plus/v1.0/order/status/{orderHash} */
export interface FusionPlusOrderStatusResponse {
  /** Current lifecycle status */
  readonly status: FusionPlusOrderStatus;
  /** Order hash */
  readonly orderHash: string;
  /** Source chain transaction hash */
  readonly srcTxHash?: string;
  /** Destination chain transaction hash */
  readonly dstTxHash?: string;
  /** Source token amount */
  readonly srcTokenAmount?: string;
  /** Actual destination token amount */
  readonly dstTokenAmount?: string;
  /** Source chain ID */
  readonly srcChainId?: number;
  /** Destination chain ID */
  readonly dstChainId?: number;
  /** Timestamps */
  readonly createdAt?: string;
  readonly srcFilledAt?: string;
  readonly dstFilledAt?: string;
}

/* ══════════════════════════════════════════════════════════════════════
 * Orderbook API v4.0 — Limit Orders
 * ══════════════════════════════════════════════════════════════════════ */

/** Parameters for creating a limit order */
export interface LimitOrderParams {
  /** Source token address */
  readonly srcTokenAddress: string;
  /** Destination token address */
  readonly dstTokenAddress: string;
  /** Source amount in smallest unit */
  readonly srcAmount: string;
  /** Desired destination amount in smallest unit (sets the limit price) */
  readonly dstAmount: string;
  /** Order creator's address */
  readonly walletAddress: string;
  /** Expiry duration in seconds from now */
  readonly expiry: number;
  /** Allow partial fills */
  readonly allowPartialFill?: boolean;
}

/** A limit order record from the orderbook */
export interface LimitOrder {
  /** Unique order hash */
  readonly orderHash: string;
  /** Source token address */
  readonly srcTokenAddress: string;
  /** Destination token address */
  readonly dstTokenAddress: string;
  /** Total source amount */
  readonly srcAmount: string;
  /** Desired destination amount (limit price) */
  readonly dstAmount: string;
  /** Amount already filled (source side) */
  readonly filledAmount: string;
  /** Order creator */
  readonly maker: string;
  /** Order creation timestamp (Unix seconds) */
  readonly createdAt: number;
  /** Order expiry timestamp (Unix seconds, 0 = no expiry) */
  readonly expiry: number;
  /** Whether the order is still active */
  readonly isActive: boolean;
  /** Fill percentage (0–100) */
  readonly fillPercent: number;
}

/** Response from the orderbook active orders endpoint */
export interface LimitOrdersResponse {
  readonly orders: readonly LimitOrder[];
}

/* ══════════════════════════════════════════════════════════════════════
 * UI-Layer Types (not from the API — used by components)
 * ══════════════════════════════════════════════════════════════════════ */

/** Enriched token with balance + price for display in the token selector */
export interface EnrichedToken extends TokenInfo {
  /** Wallet balance in smallest unit (null if balance unknown) */
  readonly balance: string | null;
  /** USD price per whole token (null if price unknown) */
  readonly priceUsd: number | null;
  /** Formatted balance for display (e.g., "1,234.56") */
  readonly formattedBalance: string | null;
  /** Balance × price (null if either is unknown) */
  readonly balanceUsd: number | null;
}

/** A recently used token, persisted in localStorage */
export interface RecentToken {
  /** Chain ID where this token was used */
  readonly chainId: number;
  /** Token address */
  readonly address: string;
  /** Token symbol (for display without needing a metadata lookup) */
  readonly symbol: string;
  /** Timestamp of last use */
  readonly lastUsed: number;
}

/** A user's favorite token, persisted in localStorage */
export interface FavoriteToken {
  /** Chain ID */
  readonly chainId: number;
  /** Token address */
  readonly address: string;
}

/**
 * Unified swap transaction result — the output of any successful swap
 * execution (Classic, Fusion, or Fusion+). Stored in transaction history.
 */
export interface SwapReceipt {
  /** Swap mode used */
  readonly mode: SwapMode;
  /** Chain ID where the swap originated */
  readonly chainId: number;
  /** Destination chain ID (only for cross-chain) */
  readonly dstChainId?: number;
  /** Source token */
  readonly srcToken: { address: string; symbol: string; decimals: number };
  /** Destination token */
  readonly dstToken: { address: string; symbol: string; decimals: number };
  /** Input amount (human-readable) */
  readonly srcAmount: string;
  /** Output amount (human-readable, may be estimated for Fusion) */
  readonly dstAmount: string;
  /** Transaction hash (Classic) or order hash (Fusion/Fusion+) */
  readonly hash: string;
  /** Block explorer URL for the transaction */
  readonly explorerUrl: string;
  /** ISO 8601 timestamp */
  readonly timestamp: string;
  /** Final status */
  readonly status: "success" | "pending" | "failed";
}

/**
 * Price impact severity — drives UI warning coloring.
 *
 *   none     – < 0.5%  (no warning)
 *   low      – 0.5–2%  (yellow info)
 *   medium   – 2–5%    (orange warning)
 *   high     – 5–15%   (red warning with confirmation gate)
 *   extreme  – > 15%   (red block — require explicit "I understand" toggle)
 */
export type PriceImpactSeverity = "none" | "low" | "medium" | "high" | "extreme";
/**
 * Atomic Swap Types — Hedera-Native DEX Settlement Layer
 *
 * Type definitions for the WRAPpDEX atomic swap system. Every swap is a single
 * Hedera `TransferTransaction` containing both token legs, executed atomically
 * at consensus. No intermediate state, no server-held reserves, no KV.
 *
 * Architecture:
 *   Pool accounts are real Hedera accounts holding real HTS tokens.
 *   Reserves === pool account balance (verified via Mirror Node).
 *   AMM math runs client-side (browser). The server only validates + co-signs.
 *   Settlement is a single CryptoTransfer with both legs — atomic or nothing.
 *
 * SENIOR DEV NOTE [ATOMIC-01]:
 *   Phase 1 uses server-held pool account keys (signing oracle pattern).
 *   Phase 2 upgrades to threshold keys (2-of-3 multisig on pool accounts).
 *   Phase 3 uses Hedera account abstraction (HIP-206) for on-chain AMM rules.
 *   The architecture is designed so each phase is a key-management upgrade,
 *   not a protocol rewrite.
 */

// ── Token Definitions ───────────────────────────────────────────────

export interface AtomicTokenDef {
  /** Canonical HTS token ID on Hedera mainnet (e.g., "0.0.456858") */
  tokenId: string;
  /** Human-readable symbol (e.g., "USDC") */
  symbol: string;
  /** Full token name (e.g., "USD Coin") */
  name: string;
  /** Token decimal places — used for raw ↔ display conversion */
  decimals: number;
  /** Stale fallback price (USD) — used ONLY when all oracles fail */
  fallbackPriceUsd: number;
  /** Bridge origin if applicable */
  bridge?: "HashPort" | "LayerZero" | "Circle" | "Tether";
  /** Tier 1 = routing hub eligible. Tier 2 = available but not hub. */
  tier: 1 | 2;
  /**
   * SaucerSwap-listed token ID when different from `tokenId`.
   * Used for oracle price resolution (e.g., our WBTC → SaucerSwap's WBTC).
   */
  saucerswapId?: string;
  /**
   * EVM address for Hedera's EVM bridge / JSON-RPC relay.
   * Auto-derived from tokenId unless overridden (WHBAR smart contract).
   */
  evmAddress?: string;
}

// ── Pool Account Definitions ────────────────────────────────────────

/**
 * A pool is backed by a real Hedera account holding both tokens.
 * The account's on-chain token balances ARE the reserves.
 */
export interface PoolAccountDef {
  /** Deterministic pool ID (e.g., "ap-usdc-whbar") — "ap" = atomic pool */
  poolId: string;
  /** Token A symbol (alphabetically first) */
  tokenA: string;
  /** Token B symbol (alphabetically second) */
  tokenB: string;
  /** Hedera account ID holding pool reserves (e.g., "0.0.XXXXXX") */
  accountId: string;
  /** HTS token ID of the LP share token for this pool */
  lpTokenId: string;
  /** LP token decimals (typically 8 for Hedera HTS) */
  lpDecimals: number;
  /** Pool creation timestamp */
  createdAt: number;
  /** Pool status — only "active" pools are routable */
  status: "active" | "paused" | "deprecated";
  /** Swap fee in basis points (25 bps = 0.25%) — protocol-fixed */
  swapFeeBps: number;
}

// ── On-Chain Reserve State ──────────────────────────────────────────

/**
 * Pool reserves read directly from the Hedera Mirror Node.
 * These are the ACTUAL token balances of the pool account — ground truth.
 *
 * SENIOR DEV NOTE [ATOMIC-02]:
 *   Reserves are NEVER cached for swap math. Every swap reads fresh balances
 *   from Mirror Node. The server validates the same balances before co-signing.
 *   Race condition window is 3-5s (Hedera finality), mitigated by the server
 *   re-reading reserves inside the signing lock.
 */
export interface PoolReserves {
  poolId: string;
  /** Pool account's balance of token A (raw integer units) */
  reserveA: bigint;
  /** Pool account's balance of token B (raw integer units) */
  reserveB: bigint;
  /** Token A decimals (for display conversion) */
  decimalsA: number;
  /** Token B decimals (for display conversion) */
  decimalsB: number;
  /** LP token total supply (raw units) — from Mirror Node token info */
  lpTotalSupply: bigint;
  /** Mirror Node query timestamp */
  fetchedAt: number;
  /** Whether the reserves were successfully fetched (false = stale/estimated) */
  isLive: boolean;
}

// ── Swap Quote ──────────────────────────────────────────────────────

export interface AtomicSwapQuote {
  /** Pool ID for this route */
  poolId: string;
  /** Input token symbol */
  tokenIn: string;
  /** Output token symbol */
  tokenOut: string;
  /** Display amount in (human-readable) */
  amountIn: number;
  /** Display amount out (human-readable) */
  amountOut: number;
  /** Raw input amount (integer string, token's smallest unit) */
  amountInRaw: string;
  /** Raw output amount (integer string, token's smallest unit) */
  amountOutRaw: string;
  /** Effective exchange rate (amountOut / amountIn) */
  effectiveRate: number;
  /** Price impact in basis points */
  priceImpactBps: number;
  /** Total fee in basis points */
  feeBps: number;
  /** Estimated fee in USD */
  feeUsd: number;
  /** Route path (e.g., ["USDC", "WHBAR"] or ["WBTC", "WHBAR", "USDC"]) */
  route: string[];
  /** Minimum output after slippage tolerance */
  minAmountOut: number;
  /** Minimum output raw (integer string) */
  minAmountOutRaw: string;
  /** Whether this is a multi-hop route */
  isMultiHop: boolean;
  /** Oracle prices used for display */
  prices: { tokenIn: number; tokenOut: number };
  /** Quote timestamp */
  timestamp: number;
  /** Reserves at quote time (for staleness detection) */
  reservesAt: number;
}

// ── Swap Request / Result ───────────────────────────────────────────

export interface AtomicSwapRequest {
  /** User's Hedera account ID (signer) */
  userAccountId: string;
  /** Pool ID to swap through */
  poolId: string;
  /** Input token symbol */
  tokenIn: string;
  /** Output token symbol */
  tokenOut: string;
  /** Raw input amount (integer string) */
  amountInRaw: string;
  /** Minimum acceptable output (raw integer string) — slippage protection */
  minAmountOutRaw: string;
  /** Slippage tolerance in basis points (e.g., 50 = 0.5%) */
  slippageBps: number;
  /** Transaction memo */
  memo?: string;
}

export interface AtomicSwapResult {
  success: boolean;
  /** Hedera transaction ID (e.g., "0.0.12345@1234567890.123456789") */
  transactionId?: string;
  /** Output amount (raw integer string) */
  amountOutRaw?: string;
  /** Output amount (display) */
  amountOut?: number;
  /** HashScan URL for the transaction */
  hashScanUrl?: string;
  /** Mirror Node receipt status */
  receiptStatus?: string;
  /** Error message if failed */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: AtomicSwapErrorCode;
}

export type AtomicSwapErrorCode =
  | "INSUFFICIENT_BALANCE"
  | "SLIPPAGE_EXCEEDED"
  | "POOL_NOT_FOUND"
  | "POOL_PAUSED"
  | "TOKEN_NOT_ASSOCIATED"
  | "INSUFFICIENT_LIQUIDITY"
  | "SIGNER_REJECTED"
  | "SIGNER_TIMEOUT"
  | "SERVER_SIGN_FAILED"
  | "NETWORK_ERROR"
  | "RESERVE_STALE"
  | "K_INVARIANT_VIOLATION"
  | "RATE_LIMITED"
  | "TRANSACTION_EXPIRED"
  | "UNKNOWN";

// ── Liquidity Operations ────────────────────────────────────────────

export interface AddLiquidityRequest {
  /** User's Hedera account ID */
  userAccountId: string;
  /** Pool ID */
  poolId: string;
  /** Raw amount of token A to deposit */
  amountARaw: string;
  /** Raw amount of token B to deposit */
  amountBRaw: string;
  /** Slippage tolerance in bps */
  slippageBps: number;
}

export interface AddLiquidityResult {
  success: boolean;
  transactionId?: string;
  /** LP shares minted (raw integer string) */
  sharesMinted?: string;
  hashScanUrl?: string;
  error?: string;
  errorCode?: AtomicSwapErrorCode;
}

export interface RemoveLiquidityRequest {
  /** User's Hedera account ID */
  userAccountId: string;
  /** Pool ID */
  poolId: string;
  /** LP shares to burn (raw integer string) */
  sharesRaw: string;
  /** Minimum token A to receive (raw) — slippage */
  minAmountARaw: string;
  /** Minimum token B to receive (raw) — slippage */
  minAmountBRaw: string;
}

export interface RemoveLiquidityResult {
  success: boolean;
  transactionId?: string;
  amountAOutRaw?: string;
  amountBOutRaw?: string;
  hashScanUrl?: string;
  error?: string;
  errorCode?: AtomicSwapErrorCode;
}

// ── Server Signing Protocol ─────────────────────────────────────────

/**
 * Request body sent to the server's co-sign endpoint.
 * The server validates the transaction matches AMM rules, then signs pool-side.
 *
 * SEC-03: The server NEVER trusts client-supplied amounts. It re-reads reserves
 * from Mirror Node and recomputes the expected output independently. If the
 * client's output differs from the server's computation by more than 1 raw unit
 * (rounding tolerance), the request is rejected.
 */
export interface SignSwapRequest {
  /** Frozen transaction bytes (base64) — built by the client */
  transactionBytes: string;
  /** Pool ID (server validates this matches the transaction) */
  poolId: string;
  /** Input token symbol */
  tokenIn: string;
  /** Output token symbol */
  tokenOut: string;
  /** Raw input amount (server re-verifies) */
  amountInRaw: string;
  /** Raw output amount (server re-verifies independently) */
  amountOutRaw: string;
  /** User's account ID (server validates matches transaction payer) */
  userAccountId: string;
}

export interface SignSwapResponse {
  success: boolean;
  /** Pool-signed transaction bytes (base64) — client adds user sig + submits */
  signedTransactionBytes?: string;
  /** Server-computed output amount (for client-side verification) */
  serverAmountOutRaw?: string;
  /** Server-read reserves at signing time */
  serverReserves?: { reserveA: string; reserveB: string; fetchedAt: number };
  /** Error */
  error?: string;
  errorCode?: AtomicSwapErrorCode;
}

// ── Fee Structure ───────────────────────────────────────────────────

/**
 * Fee breakdown for a swap. Displayed in the UI before user confirms.
 */
export interface SwapFeeBreakdown {
  /** Total AMM fee in bps (stays in pool reserves, increases k) */
  ammFeeBps: number;
  /** LP effective share after protocol extraction */
  lpFeeBps: number;
  /** Protocol share (tracked, extractable) */
  protocolFeeBps: number;
  /** AMM fee in USD */
  ammFeeUsd: number;
  /** Flat micro-fee in HBAR (network transaction cost to user) */
  networkFeeTinybar: number;
  /** Estimated Hedera network fee for the CryptoTransfer */
  hederaNetworkFeeUsd: number;
}

// ── Pool Health / Metrics ───────────────────────────────────────────

export interface PoolMetrics {
  poolId: string;
  tvlUsd: number;
  reserveADisplay: number;
  reserveBDisplay: number;
  priceA: number;
  priceB: number;
  /** Pool account's HBAR balance (for rent/auto-renew) */
  hbarBalance: number;
  /** Whether both tokens are associated with the pool account */
  tokensAssociated: boolean;
  /** LP token total supply */
  lpTotalSupply: number;
  /** Last Mirror Node refresh */
  lastRefreshed: number;
}

/**
 * 1inch DEX Aggregator — Module Barrel
 *
 * Re-exports everything from the oneinch sub-modules for convenient
 * single-path imports:
 *
 *   import { oneInchApi, CHAINS, POPULAR_TOKENS, ... } from "../utils/oneinch";
 *
 * IMPLEMENTATION NOTE: This barrel follows the same pattern as the
 * SaucerSwap module barrel at `/src/app/utils/saucerswap/index.ts`.
 * Each sub-module has a single responsibility:
 *
 *   types.ts      — TypeScript type definitions (no runtime code)
 *   api-client.ts — Authenticated fetch wrapper with retry/cache
 *   chains.ts     — EVM chain registry and lookup utilities
 *   tokens.ts     — Token list management, search, favorites, balances
 *
 * Future sub-modules (Steps 2+):
 *   fusion.ts     — Fusion v2.0 gasless swap logic
 *   fusion-plus.ts — Fusion+ cross-chain swap logic
 *   limit-orders.ts — Limit order creation and management
 *   classic.ts    — Classic Swap API v6.0 business logic
 *
 * @module oneinch
 */

// ── Types (re-exported for convenience — no runtime cost) ──
export type {
  // Shared primitives
  SwapMode,
  OneInchError,
  OneInchErrorKind,

  // Token API
  TokenInfo,
  EnrichedToken,
  RecentToken,
  FavoriteToken,
  RawTokenFromAPI,
  TokenListResponse,
  TokenSearchResponse,
  TokenCustomResponse,

  // Price & Balance APIs
  PriceResponse,
  BalanceResponse,

  // Classic Swap API v6.0
  ClassicQuoteParams,
  ClassicQuoteResponse,
  ProtocolPart,
  ClassicSwapParams,
  ClassicSwapResponse,
  ClassicSwapTransaction,
  AllowanceResponse,
  ApprovalResponse,

  // Fusion API v2.0
  FusionPreset,
  FusionQuoteParams,
  FusionPresetQuote,
  FusionQuoteResponse,
  FusionOrderBuildParams,
  FusionOrderBuildResponse,
  EIP712TypedData,
  EIP712Field,
  EIP712Domain,
  FusionOrderSubmitParams,
  FusionOrderStatus,
  FusionOrderStatusResponse,
  FusionActiveOrdersResponse,

  // Fusion+ API v1.0
  FusionPlusQuoteParams,
  FusionPlusQuoteResponse,
  FusionPlusOrderBuildParams,
  FusionPlusOrderBuildResponse,
  FusionPlusOrderStatus,
  FusionPlusOrderStatusResponse,

  // Limit Orders
  LimitOrderParams,
  LimitOrder,
  LimitOrdersResponse,

  // UI-layer types
  PriceImpactSeverity,
  SwapReceipt,
} from "./types";

export { NATIVE_TOKEN_ADDRESS } from "./types";

// ── API Client ──
export {
  oneInchApi,
  OneInchApiError,
  invalidateCache,
  cacheSize,
  isAbortError,
  isApiKeyMissing,
  friendlyErrorMessage,
} from "./api-client";

// ── Chains ──
export type { NativeCurrency, ChainConfig } from "./chains";
export {
  CHAINS,
  DEFAULT_CHAIN,
  CLASSIC_CHAINS,
  FUSION_CHAINS,
  FUSION_PLUS_CHAINS,
  SUPPORTED_CHAIN_IDS,
  getChainById,
  getChainByHex,
  isSupportedChain,
  explorerTxUrl,
  explorerAddressUrl,
} from "./chains";

// ── Tokens ──
export {
  POPULAR_TOKENS,
  normaliseToken,
  fetchTokenList,
  mergeTokenLists,
  searchTokens,
  getDefaultPair,
  // Favorites
  loadFavorites,
  isFavorite,
  toggleFavorite,
  getFavoriteTokens,
  // Recents
  loadRecents,
  recordRecentToken,
  getRecentTokens,
  // Custom tokens
  loadCustomTokens,
  saveCustomToken,
  removeCustomToken,
  // Enrichment
  fetchBalances,
  fetchPrices,
  enrichTokens,
  // Formatting
  formatBalance,
  toSmallestUnit,
  formatUsd,
  calcPriceImpact,
  priceImpactSeverity,
} from "./tokens";

// ── Token Cache ──
export {
  cacheGet as tokenCacheGet,
  cacheSet as tokenCacheSet,
  cacheDelete as tokenCacheDelete,
  cacheInvalidatePrefix as tokenCacheInvalidatePrefix,
  cacheClearAll as tokenCacheClearAll,
  cacheL1Size as tokenCacheL1Size,
  CacheTTL,
} from "./token-cache";

// ── Fusion v2.0 — Gasless Swaps ──
export type { ParsedFusionQuote, ParsedPreset, FusionSignedOrder } from "./fusion";
export {
  getFusionQuote,
  buildFusionOrder,
  signFusionOrder,
  buildAndSignFusionOrder,
  submitFusionOrder,
  pollFusionStatus,
  ensureFusionSubmission,
  checkFusionAllowance,
  sendApprovalTransaction,
  waitForTransaction,
  ensureFusionApproval,
  isFusionSupported,
  isFusionTerminalStatus,
  isFusionSuccessStatus,
  getFusionChainIds,
  formatFusionAmount,
  presetRateDifference,
  estimateGasSavingsUsd,
  formatCountdown,
  FUSION_QUOTE_REFRESH_INTERVAL_MS,
  FUSION_POLL_INTERVAL_MS,
  FUSION_POLL_MAX_DURATION_MS,
  PRESET_LABELS,
  PRESET_ESTIMATED_TIMES,
  PRESET_ICONS,
  PRESET_DESCRIPTIONS,
  FUSION_STATUS_LABELS,
  FUSION_STATUS_ICONS,
  FUSION_STATUS_PROGRESS,
} from "./fusion";

// ── Fusion+ v1.0 — Cross-Chain Swaps ──
export type { ParsedCrossChainQuote, ParsedCrossChainPreset } from "./fusion-plus";
export {
  getCrossChainQuote,
  isFusionPlusSupported,
  getFusionPlusChainIds,
  getDestinationChains,
  isCrossChainTerminalStatus,
  isCrossChainSuccessStatus,
  formatCrossChainRoute,
  formatEstimatedTime,
  formatCrossChainAmount,
  persistCrossChainOrderHash,
  loadPersistedCrossChainOrders,
  CROSS_CHAIN_QUOTE_REFRESH_INTERVAL_MS,
  CROSS_CHAIN_POLL_INTERVAL_MS,
  CROSS_CHAIN_POLL_MAX_DURATION_MS,
  CROSS_CHAIN_PRESET_LABELS,
  CROSS_CHAIN_PRESET_TIMES,
  CROSS_CHAIN_PRESET_ICONS,
  CROSS_CHAIN_PRESET_DESCRIPTIONS,
  CROSS_CHAIN_STATUS_LABELS,
  CROSS_CHAIN_STATUS_ICONS,
  CROSS_CHAIN_STATUS_PROGRESS,
} from "./fusion-plus";
/**
 * SaucerSwap Integration — Pure Re-export Header
 *
 * [C48–C78] All utility code has been extracted into sub-modules under
 * ./saucerswap/ for maintainability. This file is a backward-compatible
 * re-export surface so that existing consumers can continue to import
 * via `import { ... } from "../utils/saucerswap"` without changes.
 *
 * Sub-modules (17 total, acyclic dependency graph):
 *   tokens.ts           — AllowedToken, registry, pure helpers, icon fetch
 *   contracts.ts        — Contract addresses, fee tiers, network endpoints
 *   abi.ts              — ABI encode/decode helpers (pure byte manipulation)
 *   prices.ts           — Price fetching, caching, estimation, saucerFetch
 *   pools.ts            — Pool detection, caching, ssProxy, resolveEvm
 *   routing.ts          — Path building, multi-hop, pool routes
 *   quotes.ts           — Multi-strategy quote fetching, estimation
 *   balances.ts         — Token association, balance checking
 *   helpers.ts          — Pure formatters, URL builders, tx ID formatting
 *   stats.ts            — HBAR price, pool data, protocol stats
 *   wrapping.ts         — HBAR <-> WHBAR wrap/unwrap
 *   verification.ts     — Contract verification, router discovery
 *   diagnostics.ts      — Transaction diagnosis, network health
 *   simulation.ts       — Swap/wrap-unwrap simulation for test mode
 *   swap-engine.ts      — Swap execution engine (V1/V2, single/multi-hop)
 *   swap-verification.ts — Post-swap verification, balance checks, association
 *   prewarm.ts          — Pre-warm caches for improved performance
 *
 * Barrel: ./saucerswap/index.ts re-exports the same set for direct
 * sub-module imports (`import { ... } from "../utils/saucerswap/index"`).
 *
 * No active code remains in this file — only `export *` re-exports.
 *
 * [C78] Dead import block removed — all imports that were retained for
 * documentation in C77 have been cleaned up. The tombstone comments
 * below document the extraction history for audit trail purposes.
 */

// ═══════════════════════════════════════════════════════════════════════
// RE-EXPORTS — every public name from every sub-module
// ═══════════════════════════════════════════════════════════════════════
export * from "./saucerswap/tokens";
export * from "./saucerswap/contracts";
export * from "./saucerswap/abi";
export * from "./saucerswap/prices";
export * from "./saucerswap/pools";
export * from "./saucerswap/routing";
export * from "./saucerswap/quotes";
export * from "./saucerswap/balances";
export * from "./saucerswap/helpers";
export * from "./saucerswap/stats";
export * from "./saucerswap/wrapping";
export * from "./saucerswap/verification";
export * from "./saucerswap/diagnostics";
export * from "./saucerswap/simulation";
export * from "./saucerswap/prewarm";
export * from "./saucerswap/swap-engine";
export * from "./saucerswap/swap-verification";

// ═══════════════════════════════════════════════════════════════════════
// EXTRACTION HISTORY — tombstone audit trail
//
// Each entry records when a definition was excised from this monolith
// and moved to its canonical sub-module. Retained for git-blame and
// cross-session context. Safe to remove entirely once all consumers
// have been migrated to direct sub-module imports.
// ═══════════════════════════════════════════════════════════════════════

// [C57] AllowedToken, htsIdToEvmAddress, evmAddressToHtsId → tokens.ts
// [C58] SAUCERSWAP_TOKENS, TOKEN_BY_SYMBOL, TOKEN_BY_HTS_ID → tokens.ts
// [C58] getSaucerswapRoutingId, getSaucerswapRoutingEvmAddress, resolveToken,
//       isNativeHbar, isHbarWhbarPair, getWhbarToken → tokens.ts
// [C66] fetchAndApplyTokenIcons → tokens.ts
// [C58] Contract addresses, fee tiers, getter functions → contracts.ts
// [C58] MIRROR_NODES, JSON_RPC_RELAY, makeAbort → contracts.ts / prices.ts
// [C58] saucerFetch, _apiDiagLogged → prices.ts
// [C58] bytesToHex, hexToBytes, encodeGetAmountsOut, decodeAmountsOutResult → abi.ts
// [C58] encodeUint256, encodeAddress, encodeErc20Approve, concatBytes → abi.ts
// [C59] encodeSaucerSwapCall, encodeSaucerSwapETHForTokens, encodeSaucerSwapTokensForETH → abi.ts
// [C59] encodeGetPair, encodeGetPool, encodeExactInputSingle, encodeSwapPath,
//       encodeExactInput, encodeUnwrapWHBAR, encodeMulticall,
//       encodeQuoteExactInputSingle, encodeQuoteExactInput → abi.ts
// [C59] FALLBACK_TOKEN_PRICES_USD, TOKEN_PRICES_USD, fetchLiveTokenPrices,
//       getTokenPriceUsd, fetchHbarhTokenPrice, LP price oracle,
//       LP_TOKEN_WHBAR_HBARH, SaucerTokenPriceEntry, fetchAllTokenPricesById,
//       estimateOutputFromPrices → prices.ts
// [C50] PoolRoute, resolvePoolToken, fetchPoolRoutes, getPoolRoutes, findSwapRoute → routing.ts
// [C53] buildSwapPath, getIntermediaryTokens, findBestMultiHopRoute → routing.ts
// [C53] RawQuote, SwapQuote, fetchSaucerSwapQuote, fetchRouterQuote → quotes.ts
// [C55] estimateSwapQuote → quotes.ts
// [C51] QuoteConfidence, fetchServerQuote → quotes.ts
// [C57] SAUCERSWAP_V2_QUOTER, fetchV2RouterQuote → quotes.ts
// [C61] Pool detection: PoolVersion, PoolVersionInfo, SaucerSwapV2PoolEntry,
//       fetchSaucerSwapV2PoolList, lookupV2PoolFromAPI, KNOWN_V2_POOLS,
//       lookupKnownV2Pool, detectPoolVersion → pools.ts
// [C61] discoverV2Factory, _v2FactoryCache → pools.ts
// [C64] SS_PROXY_BASE, ssProxy, resolveAccountEvmAddress → pools.ts
// [C65] resolveContractEvmAddress → pools.ts
// [C67] isTokenAssociated, getTokenBalance, getNativeHbarBalance → balances.ts
// [C68] parseTokenAmount, formatTokenAmountRaw, formatUsdCompact,
//       formatTokenAmount, getSaucerSwapPoolUrl, getSaucerSwapSwapUrl,
//       getHashScanTxUrl, getHashScanTokenUrl, formatTxIdForMirrorNode → helpers.ts
// [C67] HbarhTokenData, SaucerSwapPool, TokenInfo interfaces → stats.ts
// [C68] fetchHbarhPrice, fetchTopPools, fetchTokenInfo, ProtocolStats,
//       fetchProtocolStats, generateSparkline → stats.ts
// [C75] ContractInfo, _verifiedContractCache, _seedKnownContractCache → verification.ts
// [C75] verifyIsContract → verification.ts
// [C76] discoverSaucerSwapRouter, _discoveredRouter → verification.ts
// [C76] simulateSwap → simulation.ts
// [C76] simulateWrapUnwrap → simulation.ts
// [C76] wrapHbar → wrapping.ts
// [C76] unwrapHbar → wrapping.ts
// [C73] TransactionDiagnosis, diagnoseTransaction → diagnostics.ts
// [C73] NetworkHealth, checkNetworkHealth → diagnostics.ts
// [C77] SwapResult, DryRunParams, DryRunResult → swap-engine.ts
// [C77] executeSaucerSwapV2Direct, executeSaucerSwap,
//       executeSaucerSwapDirect, executeSaucerSwapV2MultiHop,
//       preSwapDryRun → swap-engine.ts
// [C77] SwapVerification, verifySwapTransaction, parseTransactionRecord,
//       checkBalanceChange, ensureTokenAssociated,
//       validateSwapPrerequisites → swap-verification.ts
/**
 * [C48] SaucerSwap Quote Fetching
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: Multi-strategy quote fetching (server-proxied with browser
 * fallback), V1 router quotes, V2 QuoterV2 quotes, SaucerSwap API
 * quotes, and client-side swap estimation.
 *
 * fetchSaucerSwapQuote()  -- Main multi-strategy quote fetcher (server-proxied)
 * fetchRouterQuote()      -- V1 router getAmountsOut via Mirror Node / RPC
 * fetchV2RouterQuote()    -- V2 QuoterV2 quoteExactInputSingle
 * estimateSwapQuote()     -- Client-side price-based estimation (no network)
 */

import { log } from "../logger";
import type { AllowedToken, HederaNetwork } from "./tokens";
import { resolveToken, evmAddressToHtsId, getSaucerswapRoutingId } from "./tokens";
import {
  MIRROR_NODES,
  JSON_RPC_RELAY,
  SAUCERSWAP_V2_QUOTER,
} from "./contracts";
import {
  bytesToHex,
  encodeGetAmountsOut,
  decodeAmountsOutResult,
  encodeQuoteExactInputSingle,
  encodeQuoteExactInput,
} from "./abi";
import {
  saucerFetch,
  makeAbort,
  TOKEN_PRICES_USD,
  estimateOutputFromPrices,
  getLivePriceCacheAge,
} from "./prices";
import { ssProxy, resolveContractEvmAddress } from "./pools";
import { buildSwapPath } from "./routing";

// ══════════════════════════════════════════════════════════════════════
// ── [C51] Quote Confidence Levels ────────────────────────────────────
// high   = on-chain router/quoter (V1 getAmountsOut or V2 QuoterV2)
// medium = SaucerSwap REST API quote
// low    = client-side price-based estimation
export type QuoteConfidence = "high" | "medium" | "low";

export interface RawQuote {
  amountOut: number;
  priceImpact: number;
  route: string[];
  source: "router" | "api" | "price-estimate";
  /** [C51] Quote confidence level — maps to source strategy tier. */
  confidence: QuoteConfidence;
  /** [C51] Pool version that produced this quote, if known. */
  poolVersion?: "v1" | "v2";
  /** [C51] Fee tier for V2 quotes (hundredths of a bip). */
  feeTier?: number;
}

export interface SwapQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  route: string[];
  fee: number;
  minimumOutput: number;
  executionPrice: number;
  /** [C51] Quote confidence level — displayed as badge in SwapPanel. */
  confidence: QuoteConfidence;
  /** [C51] Which quote strategy produced this result. */
  quoteSource?: string;
  /** [C51] Server-side quote duration in ms (null for client-side estimates). */
  serverDurationMs?: number | null;
}

// [C52] Scored route for frontend comparison UI
export interface ScoredRouteInfo {
  amountOut: string;
  humanOutput: number;
  source: string;
  confidence: QuoteConfidence;
  route: string[];         // HTS IDs
  routeLabels: string[];   // Human-readable symbols
  score: number;           // Composite score (0-1)
  label: string;           // "USDC → WHBAR → SAUCE"
  intermediary: string;    // HTS ID of middle token
  hops: number;
  poolVersion?: string;
  feeTier?: number;
  priceImpact: number;
}

// ═══════════════════════════════════════════════════════════════════════
// ── [STEP1] VALIDATED ROUTE PASSTHROUGH ─────────────────────────────
//
// Carries the server's winning route details from quote → execution.
// When present, executeSaucerSwap() skips ALL route re-discovery
// (findRouteViaGraph, _preValidateV2MultiHop)
// and uses the pre-validated data directly. This eliminates 4-15s of
// redundant RPC calls between "Swap clicked" and "wallet opens".
// ═══════════════════════════════════════════════════════════════════════

export interface ValidatedRoute {
  /** Pool version that produced the winning quote */
  version: "v1" | "v2";
  /** Fee tiers per hop (1 element for direct, 2 for 2-hop multi-hop) */
  feeTiers: number[];
  /** HTS IDs in order: [input, ...intermediaries, output] */
  routeHtsIds: string[];
  /** EVM addresses in order (V2-alias-resolved for V2 routes) */
  pathEvmAddresses: string[];
  /** Hex-encoded V2 packed path (null for V1 routes — Step 2 will populate) */
  packedPathHex: string | null;
  /** Pool address (for single-hop routes) */
  poolAddress?: string;
  /** Source strategy that won (e.g., "v2-quoter", "v1-via-USDC") */
  source: string;
  /** Raw output amount from the winning strategy (string for BigInt safety) */
  rawAmountOut: string;
  /** Timestamp when this route was validated on the server */
  validatedAt: number;
}

// [C51+C52] Combined result from fetchServerQuote
export interface ServerQuoteResult {
  quote: SwapQuote;
  scoredRoutes: ScoredRouteInfo[];
  /** [STEP1] Pre-validated route from server — pass to executeSaucerSwap() to skip re-discovery */
  validatedRoute: ValidatedRoute | null;
  /**
   * [STEP6] Pre-checked approval status — bundled with quote fetch.
   * When present, executeSaucerSwap() can skip the Mirror Node allowance
   * query in approveIfNeeded(), saving 1-2s on the critical path.
   */
  approvalStatus?: {
    approvalNeeded: boolean;
    v1Allowance: number;
    v2Allowance: number;
    rawInputNeeded: number;
    /** Router HTS ID that matches the winning route's version */
    spenderForRoute: string;
    routerVersion: "v1" | "v2";
    checkedAt: number;
  } | null;
}

// ════════════════════════════════════════════════════════════════════════
// ── V1 ROUTER QUOTE ───────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * Strategy 1: Call the router's getAmountsOut() view function via Mirror Node
 * contract simulation. Uses actual on-chain pool reserves for accurate quotes.
 *
 * Key implementation notes:
 * - Gas limit MUST be 1,500,000+ (not 300k) -- Hedera EVM gas costs are much
 *   higher than Ethereum. getAmountsOut() calls getReserves() on each pair
 *   contract, and each SLOAD is ~2,100 gas on Hedera. 300k was exhausting
 *   and returning "0x" (empty result / out-of-gas revert).
 * - Timeout is generous (15s) since the simulation can be slow.
 *
 * The function tries two strategies in order:
 * 1. JSON-RPC relay (HashIO) eth_call -- most reliable for cross-contract
 *    view calls because the relay fully emulates the EVM execution.
 * 2. Mirror Node /api/v1/contracts/call -- sometimes returns empty for
 *    multi-hop getAmountsOut() due to cross-contract storage read limits.
 */
export async function fetchRouterQuote(
  amountIn: bigint,
  pathAddresses: string[],
  routerHtsId: string,
  network: HederaNetwork
): Promise<bigint | null> {
  const routerEvm = await resolveContractEvmAddress(routerHtsId, network);
  const callData = encodeGetAmountsOut(amountIn, pathAddresses);
  const callDataHex = bytesToHex(callData);
  const gasHex = "0x" + (1_500_000).toString(16); // 0x16E360

  log.info("SaucerSwap", `Router quote: getAmountsOut(${amountIn}, [${pathAddresses.join(", ")}]) -> router ${routerEvm}`);

  // -- Strategy A: JSON-RPC relay (eth_call) --
  try {
    const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(15000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{
          to: routerEvm,
          data: callDataHex,
          gas: gasHex,
        }, "latest"],
        id: 1,
      }),
    });

    if (rpcRes.ok) {
      const rpcData = await rpcRes.json();
      if (rpcData.result && rpcData.result !== "0x" && rpcData.result.length > 2) {
        const amountOut = decodeAmountsOutResult(rpcData.result);
        if (amountOut !== null && amountOut > 0n) {
          log.info("SaucerSwap", `Router quote via JSON-RPC relay: amountOut=${amountOut}`);
          return amountOut;
        }
      }
      // Log RPC error if present
      if (rpcData.error) {
        log.info("SaucerSwap", `JSON-RPC eth_call error: ${rpcData.error.message || JSON.stringify(rpcData.error).slice(0, 200)}`);
      }
    }
  } catch (err: any) {
    log.info("SaucerSwap", `JSON-RPC relay quote failed: ${err?.message || err}`);
  }

  // -- Strategy B: Mirror Node /api/v1/contracts/call --
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(`${base}/api/v1/contracts/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(15000),
      body: JSON.stringify({
        block: "latest",
        data: callDataHex,
        estimate: false,
        from: "0x0000000000000000000000000000000000000000",
        to: routerEvm,
        gas: 1_500_000,
        gasPrice: 0,
        value: 0,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      log.info("SaucerSwap", `Mirror Node contract call HTTP ${res.status} ${errBody.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const resultHex = data.result;

    if (!resultHex || resultHex === "0x") {
      const errMsg = data.error_message || data._status?.messages?.[0]?.message || "";
      log.info("SaucerSwap", `Mirror Node contract call returned empty result -- ${errMsg || "cross-contract calls may not be supported in simulation."} Falling back to price estimate.`);
      return null;
    }

    const amountOut = decodeAmountsOutResult(resultHex);
    if (amountOut !== null && amountOut > 0n) {
      log.debug("Quote", `Router quote via Mirror Node: amountOut=${amountOut} (result ${resultHex.length} chars)`);
      return amountOut;
    }

    log.debug("Quote", `Router quote decoded to zero/null from result: ${resultHex.slice(0, 66)}...`);
    return null;
  } catch (err: any) {
    log.debug("Quote", `Mirror Node router quote failed: ${err?.message || err}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// ── V2 QUOTER QUOTE ───────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

let _v2QuoterEvmCache: Record<string, string | null> = {};

/**
 * Fetch a V2 quote via the QuoterV2 contract's quoteExactInputSingle.
 *
 * Returns the expected output amount or null if the quote fails.
 * Uses JSON-RPC eth_call (view function, no gas cost).
 */
export async function fetchV2RouterQuote(
  tokenInEvm: string,
  tokenOutEvm: string,
  amountIn: bigint,
  fee: number,
  network: HederaNetwork
): Promise<bigint | null> {
  const quoterId = SAUCERSWAP_V2_QUOTER[network] || SAUCERSWAP_V2_QUOTER.mainnet;

  // Skip if QuoterV2 address is unconfigured
  if (!quoterId || quoterId === "0.0.0") {
    log.warn("Quote", "V2 QuoterV2 address not configured -- skipping V2 on-chain quote");
    return null;
  }

  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;

  // Resolve QuoterV2 EVM address
  let quoterEvm: string;
  if (_v2QuoterEvmCache[network]) {
    quoterEvm = _v2QuoterEvmCache[network]!;
  } else {
    quoterEvm = await resolveContractEvmAddress(quoterId, network);
    _v2QuoterEvmCache[network] = quoterEvm;
  }

  const callData = bytesToHex(encodeQuoteExactInputSingle(tokenInEvm, tokenOutEvm, amountIn, fee));
  const gasHex = "0x" + (1_500_000).toString(16);

  log.debug("Quote", `V2 Quote: quoteExactInputSingle(${tokenInEvm.slice(0,10)}..., ${tokenOutEvm.slice(0,10)}..., ${amountIn}, fee=${fee}) -> quoter ${quoterEvm}`);

  // -- Strategy A: JSON-RPC relay eth_call --
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(12000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: quoterEvm, data: callData, gas: gasHex }, "latest"],
        id: 1,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.result && data.result !== "0x" && data.result.length >= 66 && !data.error) {
        // QuoterV2 returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
        // First 32 bytes (after 0x) = amountOut
        const amountOutHex = data.result.slice(2, 66);
        const amountOut = BigInt("0x" + amountOutHex);
        if (amountOut > 0n) {
          log.debug("Quote", `V2 Quote via JSON-RPC: amountOut=${amountOut}`);
          return amountOut;
        }
      }
      if (data.error) {
        log.debug("Quote", `V2 Quote RPC error: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
      } else {
        // [C9-02] Diagnostic: log exactly what the RPC returned
        const resultLen = data.result?.length ?? 0;
        const resultPreview = data.result ? data.result.slice(0, 80) : "null";
        log.debug("Quote", `V2 Quote RPC: non-parseable -- result=${resultPreview} (${resultLen} chars)`);
      }
    } else {
      log.debug("Quote", `V2 Quote RPC HTTP ${res.status} ${res.statusText}`);
    }
  } catch (err: any) {
    log.debug("Quote", `V2 Quote via RPC failed: ${err?.message || err}`);
  }

  // -- Strategy B: Mirror Node /api/v1/contracts/call --
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const mnRes = await fetch(`${base}/api/v1/contracts/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(12000),
      body: JSON.stringify({
        block: "latest",
        data: callData,
        estimate: false,
        from: "0x0000000000000000000000000000000000000000",
        to: quoterEvm,
        gas: 1_500_000,
        gasPrice: 0,
        value: 0,
      }),
    });

    if (mnRes.ok) {
      const mnData = await mnRes.json();
      if (mnData.result && mnData.result !== "0x" && mnData.result.length >= 66) {
        const amountOutHex = mnData.result.slice(2, 66);
        const amountOut = BigInt("0x" + amountOutHex);
        if (amountOut > 0n) {
          log.debug("Quote", `V2 Quote via Mirror Node: amountOut=${amountOut}`);
          return amountOut;
        }
        log.debug("Quote", `V2 Quote Mirror: amountOut is 0 -- result: ${mnData.result.slice(0, 80)}`);
      } else {
        // [C9-02] Mirror Node contract simulation doesn't support cross-contract
        // calls (QuoterV2 -> Pool), so this is expected to return empty.
        const preview = mnData.result ? mnData.result.slice(0, 60) : "null";
        const errMsg = mnData._status?.messages?.[0]?.message || mnData.message || "";
        log.debug("Quote", `V2 Quote Mirror: empty/short result=${preview}, err=${errMsg.slice(0, 100)}`);
      }
    } else {
      log.debug("Quote", `V2 Quote Mirror HTTP ${mnRes.status}`);
    }
  } catch (err: any) {
    log.debug("Quote", `V2 Quote via Mirror Node failed: ${err?.message || err}`);
  }

  // -- Strategy C: SaucerSwap REST API V2 quote --
  try {
    const htsIdIn = evmAddressToHtsId(tokenInEvm);
    const htsIdOut = evmAddressToHtsId(tokenOutEvm);
    const quoteEndpoints = [
      `/v2/swap/quote?tokenIn=${htsIdIn}&tokenOut=${htsIdOut}&amountIn=${amountIn}&fee=${fee}`,
      `/v2/swap/quote?tokenA=${htsIdIn}&tokenB=${htsIdOut}&amount=${amountIn}&fee=${fee}`,
    ];
    for (const ep of quoteEndpoints) {
      try {
        const qRes = await saucerFetch(ep, 8000);
        if (qRes) {
          const qData = await qRes.json();
          const rawOut = qData?.amountOut ?? qData?.amount_out ?? qData?.outputAmount ?? qData?.quote;
          if (rawOut !== undefined && rawOut !== null) {
            const out = BigInt(rawOut.toString().replace(/[^0-9]/g, ""));
            if (out > 0n) {
              log.debug("Quote", `V2 Quote via SaucerSwap API: amountOut=${out}`);
              return out;
            }
          }
          log.debug("Quote", `V2 Quote API: response keys=${Object.keys(qData).join(",")}, no amountOut`);
        }
      } catch { /* try next */ }
    }
  } catch (e: any) {
    log.debug("Quote", `V2 Quote API fallback error: ${e?.message || e}`);
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// ── [STEP-5] V2 MULTI-HOP QUOTE via QuoterV2.quoteExactInput ─────────
// ════════════════════════════════════════════════════════════════════════

/**
 * [Step 5] Fetch a V2 multi-hop quote via QuoterV2.quoteExactInput().
 *
 * Takes a pre-built packed path (from encodeSwapPath) and validates it
 * against the QuoterV2 contract on-chain. This is the SAME packed path
 * encoding and the SAME contract that the V2 SwapRouter's exactInput
 * will use — so if QuoterV2 returns a valid quote, the swap WILL succeed
 * (barring price movement between quote and execution).
 *
 * Returns the expected output amount or null if the quote fails.
 * No gas cost — uses eth_call (view function).
 *
 * Used by:
 *   1. [Step 6] V2-SKIP lift blocks — pre-validates the V2 path before
 *      committing to V2 execution (avoids wasting user wallet popups)
 *   2. [SWAP-FIX-5] executeSaucerSwapV2MultiHop — full-path validation
 *      after per-hop fee tier correction
 */
export async function fetchV2MultiHopQuote(
  packedPath: Uint8Array,
  amountIn: bigint,
  network: HederaNetwork,
): Promise<bigint | null> {
  const quoterId = SAUCERSWAP_V2_QUOTER[network] || SAUCERSWAP_V2_QUOTER.mainnet;
  if (!quoterId || quoterId === "0.0.0") {
    log.warn("Quote", "V2 QuoterV2 not configured — skipping multi-hop quote");
    return null;
  }

  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;

  // Resolve QuoterV2 EVM address (cached)
  let quoterEvm: string;
  if (_v2QuoterEvmCache[network]) {
    quoterEvm = _v2QuoterEvmCache[network]!;
  } else {
    quoterEvm = await resolveContractEvmAddress(quoterId, network);
    _v2QuoterEvmCache[network] = quoterEvm;
  }

  const callData = bytesToHex(encodeQuoteExactInput(packedPath, amountIn));
  // Higher gas for multi-hop: each hop involves cross-contract Pool.swap simulation
  const gasHex = "0x" + (3_000_000).toString(16);

  log.debug("Quote", `V2 multi-hop quote: quoteExactInput(${packedPath.length}B path, ${amountIn}) → quoter ${quoterEvm}`);

  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(12000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: quoterEvm, data: callData, gas: gasHex }, "latest"],
        id: 1,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.result && data.result !== "0x" && data.result.length >= 66 && !data.error) {
        // quoteExactInput returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList,
        //   uint32[] initializedTicksCrossedList, uint256 gasEstimate)
        // First 32 bytes (word 0) = amountOut (static type in tuple head)
        const amountOutHex = data.result.slice(2, 66);
        const amountOut = BigInt("0x" + amountOutHex);
        if (amountOut > 0n) {
          log.debug("Quote", `V2 multi-hop QuoterV2: amountOut=${amountOut} ✓`);
          return amountOut;
        }
      }
      if (data.error) {
        log.debug("Quote", `V2 multi-hop QuoterV2 error: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
      }
    } else {
      log.debug("Quote", `V2 multi-hop QuoterV2 HTTP ${res.status}`);
    }
  } catch (err: any) {
    log.debug("Quote", `V2 multi-hop QuoterV2 failed: ${err?.message || err}`);
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// ── MAIN MULTI-STRATEGY QUOTE FETCHER ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

/**
 * Multi-strategy quote fetcher. Tries in order:
 * 0. Server proxy (5 concurrent strategies server-side) [C47]
 * 1. Router getAmountsOut via Mirror Node (on-chain, most accurate)
 * 2. SaucerSwap REST API (may not be available)
 * 3. Price-based estimation (always available, less accurate for large trades)
 *
 * Exported so SwapPanel can pre-fetch quotes before the confirmation modal
 * to show the user which quote strategy will be used and the actual on-chain output.
 */
export async function fetchSaucerSwapQuote(
  inputTokenId: string,
  outputTokenId: string,
  amountIn: string,
  options?: {
    pathAddresses?: string[];
    routerHtsId?: string;
    network?: HederaNetwork;
    inputToken?: AllowedToken;
    outputToken?: AllowedToken;
  }
): Promise<RawQuote | null> {
  const rawAmountIn = BigInt(amountIn);

  // -- [C47] Strategy 0: Server proxy quote (5 concurrent strategies server-side) --
  try {
    const network = options?.network || "mainnet";
    const inputDecimals = options?.inputToken?.decimals?.toString() || "8";
    const outputDecimals = options?.outputToken?.decimals?.toString() || "8";
    // [ALIAS-FIX] Send CANONICAL HTS IDs to server, with wrapper aliases as hints.
    // V1 Router getAmountsOut needs canonical addresses (V1 Factory pairs are
    // registered under canonical IDs). V2 QuoterV2 resolves aliases server-side.
    // Previously the wrapper ID was sent as inputToken/outputToken, causing V1
    // strategies to miss the pool — the price-estimate fallback then returned
    // an inflated amount, triggering the PRICE-IMPACT-GUARD false positive.
    const canonicalInputId = options?.inputToken?.htsId
      ? (options.inputToken.htsId === "native" ? inputTokenId : options.inputToken.htsId)
      : inputTokenId;
    const canonicalOutputId = options?.outputToken?.htsId
      ? (options.outputToken.htsId === "native" ? outputTokenId : options.outputToken.htsId)
      : outputTokenId;
    const _inputAlias = options?.inputToken?.saucerswapAliasId || "";
    const _outputAlias = options?.outputToken?.saucerswapAliasId || "";

    const proxyParams: Record<string, string> = {
      inputToken: canonicalInputId,
      outputToken: canonicalOutputId,
      amountIn,
      inputDecimals,
      outputDecimals,
      network,
    };
    // Only include alias hints when they differ from canonical
    if (_inputAlias && _inputAlias !== canonicalInputId) {
      proxyParams.inputAliasId = _inputAlias;
    }
    if (_outputAlias && _outputAlias !== canonicalOutputId) {
      proxyParams.outputAliasId = _outputAlias;
    }
    log.debug("Quote", `[ALIAS-FIX] Server proxy: inputToken=${canonicalInputId}${_inputAlias ? ` alias=${_inputAlias}` : ""}, outputToken=${canonicalOutputId}${_outputAlias ? ` alias=${_outputAlias}` : ""}`);

    const proxyData = await ssProxy<{
      amountOut: number;
      source: string;
      confidence: string;
      priceImpact?: number;
      route?: string[];
      poolVersion?: string;
      feeTier?: number;
    }>("/quote", proxyParams, 12000); // [PERF-01] 12s (reduced from 18s) — fail faster, fall through to browser strategies

    if (proxyData && proxyData.amountOut > 0) {
      const sourceMap: Record<string, RawQuote["source"]> = {
        "v1-router": "router",
        "v1-multihop-whbar": "router",
        "v2-quoter": "router",
        "v2-quoter-single": "router",
        "v2-quoter-multihop": "router",
        "v2-multihop": "router",
        "api": "api",
        "saucerswap-api": "api",
        "price-estimate": "price-estimate",
      };
      // Any source starting with "v1-via-" or "v2-via-" is a multi-hop route
      const mappedSource = sourceMap[proxyData.source]
        || (proxyData.source.startsWith("v1-via-") || proxyData.source.startsWith("v2-via-") ? "router" : "api");
      log.info("Quote",
        `[C47] Server quote: amountOut=${proxyData.amountOut},` +
        ` source=${proxyData.source} (${proxyData.confidence})`
      );
      return {
        amountOut: proxyData.amountOut,
        priceImpact: proxyData.priceImpact || 0,
        route: proxyData.route || [inputTokenId, outputTokenId],
        source: mappedSource,
        confidence: proxyData.confidence as QuoteConfidence,
        poolVersion: (proxyData.poolVersion === "v2" || proxyData.source.startsWith("v2-quoter")) ? "v2" : "v1",
        feeTier: proxyData.feeTier,
      };
    }
    log.info("Quote", "[C47] Server quote returned no result -- falling through to browser strategies");
  } catch (proxyErr: any) {
    log.warn("Quote", `[C47] Server quote error -- falling through: ${proxyErr?.message || proxyErr}`);
  }

  // -- Strategy 1 (legacy fallback): Router getAmountsOut via Mirror Node --
  if (options?.pathAddresses && options?.routerHtsId && options?.network) {
    const routerAmountOut = await fetchRouterQuote(
      rawAmountIn,
      options.pathAddresses,
      options.routerHtsId,
      options.network
    );
    if (routerAmountOut !== null) {
      return {
        amountOut: Number(routerAmountOut),
        priceImpact: 0, // Actual impact is baked into the on-chain result
        route: [inputTokenId, outputTokenId],
        source: "router",
        confidence: "high",
        poolVersion: "v1",
      };
    }
  }

  // -- Strategy 2: SaucerSwap REST API --
  const quoteParams = [
    "?inputToken=" + inputTokenId + "&outputToken=" + outputTokenId + "&amountIn=" + amountIn,
    "?tokenA=" + inputTokenId + "&tokenB=" + outputTokenId + "&amountIn=" + amountIn,
  ];
  for (const qs of quoteParams) {
    try {
      const res = await saucerFetch("/swap/quote" + qs, 8000);
      if (res) {
        const data = await res.json();
        return {
          amountOut: parseInt(data.amountOut || data.outputAmount || "0", 10),
          priceImpact: parseFloat(data.priceImpact || "0"),
          route: data.route || [inputTokenId, outputTokenId],
          source: "api",
          confidence: "medium",
        };
      }
    } catch { /* fall through */ }
  }

  // -- Strategy 3: Price-based estimation --
  // This should almost always succeed now that HBAR/WHBAR have non-zero
  // fallback prices and the proxy prefers stale live prices over zero.
  if (options?.inputToken && options?.outputToken) {
    const hops = (options.pathAddresses?.length || 2) - 1;
    const estimated = estimateOutputFromPrices(
      Number(rawAmountIn),
      options.inputToken,
      options.outputToken,
      hops
    );
    if (estimated !== null) {
      log.debug("Quote", `Using price-based quote estimate: ${estimated} (${hops} hop${hops > 1 ? "s" : ""})`);
      return {
        amountOut: estimated,
        priceImpact: 0.05,
        route: [inputTokenId, outputTokenId],
        source: "price-estimate",
        confidence: "low",
      };
    }
    log.warn(
      "Quote",
      `Price-based estimation also failed for ${options.inputToken.symbol} -> ${options.outputToken.symbol}. ` +
      `Prices: ${options.inputToken.symbol}=$${TOKEN_PRICES_USD[options.inputToken.isNative ? "HBAR" : options.inputToken.symbol]}, ` +
      `${options.outputToken.symbol}=$${TOKEN_PRICES_USD[options.outputToken.isNative ? "HBAR" : options.outputToken.symbol]}. ` +
      `Live cache age: ${Math.round(getLivePriceCacheAge() / 1000)}s`
    );
  } else {
    log.warn(
      "Quote",
      "Strategy 3 (price estimation) skipped -- inputToken/outputToken not provided in options"
    );
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// ── CLIENT-SIDE ESTIMATION ────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * Client-side swap quote estimation using token prices.
 * No network calls -- uses cached prices and fee model.
 * Suitable for UI preview before executing a real quote.
 */
export function estimateSwapQuote(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: number,
  inputPriceUsd: number,
  outputPriceUsd: number,
  slippagePct: number = 3
): SwapQuote {
  const feePct = 0.3;
  const feeAmount = inputAmount * (feePct / 100);
  const effectiveInput = inputAmount - feeAmount;

  const priceRatio = outputPriceUsd > 0 ? inputPriceUsd / outputPriceUsd : 0;
  const rawOutput = effectiveInput * priceRatio;

  const notionalUsd = inputAmount * inputPriceUsd;
  let priceImpact: number;
  if (notionalUsd < 1000) priceImpact = 0.01;
  else if (notionalUsd < 10000) priceImpact = 0.05 + (notionalUsd / 10000) * 0.1;
  else if (notionalUsd < 100000) priceImpact = 0.15 + (notionalUsd / 100000) * 0.5;
  else priceImpact = 0.65 + Math.min((notionalUsd / 1000000) * 2, 5);

  const outputAfterImpact = rawOutput * (1 - priceImpact / 100);
  const minimumOutput = outputAfterImpact * (1 - slippagePct / 100);
  const executionPrice = inputAmount > 0 ? outputAfterImpact / inputAmount : 0;

  const inputResolved = resolveToken(inputSymbol);
  const outputResolved = resolveToken(outputSymbol);
  let route: string[];
  if (!inputResolved || !outputResolved) {
    route = [inputSymbol, outputSymbol];
  } else {
    route = buildSwapPath(inputResolved, outputResolved).map((t) => t.symbol);
  }

  return {
    inputToken: inputSymbol,
    outputToken: outputSymbol,
    inputAmount,
    outputAmount: outputAfterImpact,
    priceImpact,
    route,
    fee: feeAmount * inputPriceUsd,
    minimumOutput,
    executionPrice,
    confidence: "low",
    quoteSource: "price-estimate",
    serverDurationMs: null,
  };
}

// ════════════════════════════════════════════════════════════════════════
// ── [C51] SERVER-SIDE QUOTE FETCHER FOR SWAPPANEL ─────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * [C51] Fetch a high-confidence server-side quote and return a full SwapQuote.
 *
 * Called by SwapPanel AFTER the instant client-side estimate to upgrade
 * the quote with on-chain data. Returns null if the server is unavailable
 * or returns no quotes — the client-side estimate remains active.
 *
 * The two-phase UX:
 *   1. Instant: estimateSwapQuote() → SwapQuote with confidence="low"
 *   2. Async:   fetchServerQuote()  → SwapQuote with confidence="high"/"medium"
 *
 * If the server returns confidence="low", the quote is still an upgrade
 * because it was computed server-side with fresher price data.
 *
 * [STEP6] When accountId is provided and the input is a non-native token,
 * the function fires allowance checks for both V1 and V2 routers IN PARALLEL
 * with the server quote fetch. The result is returned as `approvalStatus`
 * on the ServerQuoteResult, allowing the swap engine to skip the 1-2s
 * Mirror Node allowance query during execution.
 */
export async function fetchServerQuote(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  inputAmount: number,
  slippagePct: number = 0.5,
  network: HederaNetwork = "mainnet",
  accountId?: string,
): Promise<ServerQuoteResult | null> {
  if (inputAmount <= 0) return null;

  const inputHtsId = inputToken.isNative ? "HBAR" : inputToken.htsId;
  const outputHtsId = outputToken.isNative ? "HBAR" : outputToken.htsId;
  const rawAmountIn = Math.floor(inputAmount * Math.pow(10, inputToken.decimals)).toString();

  // [C99] Resolve alias IDs for V2 routing — only send if different from canonical
  const inputAliasId = !inputToken.isNative ? getSaucerswapRoutingId(inputToken) : undefined;
  const outputAliasId = !outputToken.isNative ? getSaucerswapRoutingId(outputToken) : undefined;

  const startMs = Date.now();

  // [STEP6] Fire allowance checks in parallel with the quote fetch.
  // Only for non-native input tokens when accountId is available.
  // These hit the Mirror Node allowance endpoint (~200-500ms) and
  // run concurrently with the server quote (~500-2000ms) so they're free.
  type AllowanceResult = { v1: number; v2: number; rawNeeded: number; v1Router: string; v2Router: string };
  let allowancePromise: Promise<AllowanceResult | null> | null = null;

  if (accountId && !inputToken.isNative && inputToken.htsId) {
    allowancePromise = (async (): Promise<AllowanceResult | null> => {
      try {
        const { fetchTokenAllowance } = await import("./balances");
        const { SAUCERSWAP_V1_ROUTER, SAUCERSWAP_V2_ROUTER } = await import("./contracts");
        const v1Router = SAUCERSWAP_V1_ROUTER[network] || SAUCERSWAP_V1_ROUTER.mainnet;
        const v2Router = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
        const rawNeeded = parseInt(rawAmountIn, 10);

        const [v1, v2] = await Promise.all([
          fetchTokenAllowance(accountId, inputToken.htsId, v1Router, network).catch(() => 0),
          fetchTokenAllowance(accountId, inputToken.htsId, v2Router, network).catch(() => 0),
        ]);
        log.debug("Quote", `[STEP6] Parallel allowance check: V1=${v1} V2=${v2} needed=${rawNeeded} for ${inputToken.symbol}`);
        return { v1, v2, rawNeeded, v1Router, v2Router };
      } catch (err: any) {
        log.debug("Quote", `[STEP6] Allowance check failed (non-blocking): ${err?.message}`);
        return null;
      }
    })();
  }

  try {
    const proxyParams: Record<string, string> = {
      inputToken: inputHtsId,
      outputToken: outputHtsId,
      amountIn: rawAmountIn,
      slippage: slippagePct.toString(),
      inputDecimals: inputToken.decimals.toString(),
      outputDecimals: outputToken.decimals.toString(),
      network,
      // [C99] Pass alias hints — server uses these to extend TOKEN_ALIAS_MAP
      // for V2 QuoterV2 calls. Only sent when alias differs from canonical.
      ...(inputAliasId && inputAliasId !== inputHtsId ? { inputAliasId } : {}),
      ...(outputAliasId && outputAliasId !== outputHtsId ? { outputAliasId } : {}),
      // [STEP6] Account ID for allowance checks
      ...(accountId ? { accountId } : {}),
    };
    const proxyData = await ssProxy<{
      amountOut: number;
      source: string;
      confidence: string;
      priceImpact?: number;
      route?: string[];
      poolVersion?: string;
      feeTier?: number;
    }>("/quote", proxyParams, 12000); // [PERF-01] 12s (reduced from 18s) — fail faster, fall through to browser strategies

    const durationMs = Date.now() - startMs;

    if (!proxyData || !proxyData.amountOut || proxyData.amountOut === "0") {
      log.info("Quote", `[C51] Server quote returned empty (${durationMs}ms)`);
      return null;
    }

    // Parse raw output to human-readable
    const rawOut = Number(BigInt(proxyData.amountOut));
    const humanOutput = rawOut / Math.pow(10, outputToken.decimals);

    if (humanOutput <= 0) return null;

    // Build route labels from HTS IDs
    const routeLabels = (proxyData.route || [inputHtsId, outputHtsId]).map(id => {
      if (id === "HBAR" || id === "0.0.1456986") return inputToken.isNative ? "HBAR" : "WHBAR";
      const tok = resolveToken(id);
      return tok?.symbol || id;
    });

    // Calculate derived fields
    const executionPrice = inputAmount > 0 ? humanOutput / inputAmount : 0;
    const minimumOutput = humanOutput * (1 - slippagePct / 100);
    const feePct = 0.3;
    const feeUsd = inputAmount * (feePct / 100) * (TOKEN_PRICES_USD[inputToken.isNative ? "HBAR" : inputToken.symbol] || 0);

    const confidence = proxyData.confidence || "medium";

    log.info("Quote",
      `[C51] Server quote: ${humanOutput.toFixed(6)} ${outputToken.symbol}` +
      ` (${confidence}, ${proxyData.source}, ${proxyData.durationMs || durationMs}ms)`
    );

    // [C52] Build scored routes — prefer server's scoredRoutes (proper composite scoring)
    // Fall back to rebuilding from allQuotes if server didn't provide them
    let scoredRoutes: ScoredRouteInfo[];

    if (proxyData.scoredRoutes && proxyData.scoredRoutes.length > 0) {
      // Server provided properly scored routes — use them directly
      scoredRoutes = proxyData.scoredRoutes.map(sr => {
        const q = sr.quote;
        const rOut = Number(BigInt(q.amountOut));
        const hOut = rOut / Math.pow(10, outputToken.decimals);
        const rLabels = (q.route || [inputHtsId, outputHtsId]).map(id => {
          if (id === "HBAR" || id === "0.0.1456986") return inputToken.isNative ? "HBAR" : "WHBAR";
          const tok = resolveToken(id);
          return tok?.symbol || id;
        });
        return {
          amountOut: q.amountOut,
          humanOutput: hOut,
          source: q.source,
          confidence: q.confidence,
          route: q.route || [],
          routeLabels: rLabels,
          score: sr.score,
          label: sr.label || rLabels.join(" → "),
          intermediary: sr.intermediary,
          hops: sr.hops,
          poolVersion: q.poolVersion,
          feeTier: q.feeTier,
          priceImpact: q.priceImpact || 0,
        };
      });
    } else {
      // Fallback: build from allQuotes with simple scoring
      scoredRoutes = (proxyData.allQuotes || []).map(q => {
        const rawOut = Number(BigInt(q.amountOut));
        const humanOut = rawOut / Math.pow(10, outputToken.decimals);
        const rLabels = (q.route || [inputHtsId, outputHtsId]).map(id => {
          if (id === "HBAR" || id === "0.0.1456986") return inputToken.isNative ? "HBAR" : "WHBAR";
          const tok = resolveToken(id);
          return tok?.symbol || id;
        });
        const score = 1 - (q.priceImpact || 0) / 100;
        const label = rLabels.join(" → ");
        const intermediary = q.route?.length === 3 ? q.route[1] : "";
        const hops = q.route?.length ? q.route.length - 1 : 0;
        return {
          amountOut: q.amountOut, humanOutput: humanOut, source: q.source,
          confidence: q.confidence, route: q.route || [], routeLabels: rLabels,
          score, label, intermediary, hops,
          poolVersion: q.poolVersion, feeTier: q.feeTier,
          priceImpact: q.priceImpact || 0,
        };
      }).sort((a, b) => b.score - a.score);
    }

    // [STEP6] Resolve allowance status from parallel check
    let approvalStatus: ServerQuoteResult["approvalStatus"] = null;
    if (allowancePromise) {
      const allowanceResult = await allowancePromise;
      if (allowanceResult) {
        const { v1, v2, rawNeeded, v1Router, v2Router } = allowanceResult;
        // Determine which router has the better allowance
        const bestAllowance = Math.max(v1, v2);
        const approvalNeeded = bestAllowance < rawNeeded;
        // Pick the router with higher allowance (or V2 if tied — preferred for deeper liquidity)
        const routerVersion: "v1" | "v2" = v2 >= v1 ? "v2" : "v1";
        const spenderForRoute = routerVersion === "v2" ? v2Router : v1Router;
        approvalStatus = {
          approvalNeeded,
          v1Allowance: v1,
          v2Allowance: v2,
          rawInputNeeded: rawNeeded,
          spenderForRoute,
          routerVersion,
          checkedAt: Date.now(),
        };
        log.info("Quote",
          `[STEP6] Approval status: ${approvalNeeded ? "NEEDS APPROVAL" : "PRE-APPROVED"} ` +
          `(best=${bestAllowance} needed=${rawNeeded} via ${routerVersion.toUpperCase()})`,
        );
      }
    }

    return {
      quote: {
        inputToken: inputToken.symbol,
        outputToken: outputToken.symbol,
        inputAmount,
        outputAmount: humanOutput,
        priceImpact: proxyData.priceImpact || 0,
        route: routeLabels,
        fee: feeUsd,
        minimumOutput,
        executionPrice,
        confidence,
        quoteSource: proxyData.source,
        serverDurationMs: proxyData.durationMs || durationMs,
      },
      scoredRoutes: scoredRoutes,
      validatedRoute: proxyData.routeDetails || null,
      approvalStatus: approvalStatus,
    };
  } catch (err: any) {
    log.warn("Quote", `[C51] fetchServerQuote failed (${Date.now() - startMs}ms): ${err?.message || err}`);
    return null;
  }
}
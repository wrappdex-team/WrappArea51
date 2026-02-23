/**
 * [C72] SaucerSwap Swap Simulation
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: simulateSwap, simulateWrapUnwrap
 *
 * Dependencies: tokens (resolveToken, getWhbarToken, isNativeHbar, isHbarWhbarPair,
 *               getSaucerswapRoutingEvmAddress, getSaucerswapRoutingId),
 *               contracts (getSaucerSwapRouter), routing (findSwapRoute, buildSwapPath),
 *               quotes (fetchSaucerSwapQuote, estimateSwapQuote, SwapQuote),
 *               prices (TOKEN_PRICES_USD), verification (discoverSaucerSwapRouter),
 *               routing (PoolRoute)
 */

import type { AllowedToken } from "./tokens";
import {
  resolveToken, getWhbarToken, isNativeHbar, isHbarWhbarPair,
  getSaucerswapRoutingEvmAddress, getSaucerswapRoutingId,
} from "./tokens";
import { getSaucerSwapRouter } from "./contracts";
import { findSwapRoute, buildSwapPath } from "./routing";
import type { PoolRoute } from "./routing";
import { fetchSaucerSwapQuote, estimateSwapQuote } from "./quotes";
import type { SwapQuote } from "./quotes";
import { TOKEN_PRICES_USD } from "./prices";
import { discoverSaucerSwapRouter } from "./verification";

// [C77] SwapResult now lives in canonical swap-engine.ts sub-module.
// Previous local duplicate removed — import from canonical source.
import type { SwapResult } from "./swap-engine";

/**
 * Simulate a swap for testing purposes.
 * Uses the route finder + price estimation to show realistic results
 * without requiring a wallet connection or live blockchain execution.
 */
export async function simulateSwap(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string,
  slippagePct: number = 3
): Promise<SwapResult & { quote: SwapQuote | null; route: string[]; routeDetail: PoolRoute[] }> {
  const route = findSwapRoute(inputSymbol, outputSymbol);
  if (!route) {
    return {
      success: false,
      error: `No pool route found for ${inputSymbol} → ${outputSymbol}`,
      executionVenue: "simulated",
      quote: null,
      route: [],
      routeDetail: [],
    };
  }

  const input = resolveToken(inputSymbol)!;
  const output = resolveToken(outputSymbol)!;
  const amount = parseFloat(inputAmount);
  if (isNaN(amount) || amount <= 0) {
    return {
      success: false,
      error: "Invalid input amount",
      executionVenue: "simulated",
      quote: null,
      route: route.path.map(t => t.symbol),
      routeDetail: route.pools,
    };
  }

  // Build path for router quote
  const whbar = getWhbarToken();
  const logicalInput = input.isNative ? whbar : input;
  const logicalOutput = output.isNative ? whbar : output;
  const logicalPath = buildSwapPath(logicalInput, logicalOutput);
  // Use SaucerSwap alias EVM addresses for routing (bridge tokens have different pool IDs)
  const pathAddresses = logicalPath.map(t => getSaucerswapRoutingEvmAddress(t));
  // Use discovered router if available, otherwise fall back to configured default
  const discoveredRouter = await discoverSaucerSwapRouter("mainnet");
  const v1Router = discoveredRouter || getSaucerSwapRouter("mainnet", "v1");

  // Try to fetch a real quote via multi-strategy system
  const rawAmount = Math.floor(amount * Math.pow(10, input.decimals));
  let apiQuoteAmount: number | null = null;
  try {
    // Use SaucerSwap alias IDs for bridge tokens (their pool IDs differ from canonical bridge IDs)
    const quoteInputId = input.isNative ? whbar.htsId : getSaucerswapRoutingId(input);
    const quoteOutputId = output.isNative ? whbar.htsId : getSaucerswapRoutingId(output);
    const rawQuote = await fetchSaucerSwapQuote(quoteInputId, quoteOutputId, rawAmount.toString(), {
      pathAddresses,
      routerHtsId: v1Router,
      network: "mainnet",
      inputToken: logicalInput,
      outputToken: logicalOutput,
    });
    if (rawQuote && rawQuote.amountOut > 0) {
      apiQuoteAmount = rawQuote.amountOut / Math.pow(10, output.decimals);
    }
  } catch { /* use estimation */ }

  // Price-based estimation as fallback for display purposes
  const inputPriceUsd = TOKEN_PRICES_USD[input.isNative ? "HBAR" : input.symbol] || 0.01;
  const outputPriceUsd = TOKEN_PRICES_USD[output.isNative ? "HBAR" : output.symbol] || 0.01;

  const quote = estimateSwapQuote(
    inputSymbol,
    outputSymbol,
    amount,
    inputPriceUsd,
    outputPriceUsd,
    slippagePct
  );

  // Use API quote if available, otherwise estimation
  const outputAmount = apiQuoteAmount ?? quote.outputAmount;

  // Simulate network delay
  await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));

  const txId = `0.0.0@${Math.floor(Date.now() / 1000)}.${Math.floor(Math.random() * 999999999).toString().padStart(9, "0")}`;

  return {
    success: true,
    transactionId: txId,
    outputAmount,
    route: route.path.map(t => t.symbol),
    priceImpact: quote.priceImpact,
    executionVenue: "simulated",
    quote,
    routeDetail: route.pools,
  };
}

// ══════════════════════════════════════════════════════════════════════
// ── WRAP/UNWRAP SIMULATION ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Simulate an HBAR <-> WHBAR wrap/unwrap for Test Mode.
 * Wrapping/unwrapping is always 1:1 with no fee or price impact.
 */
export async function simulateWrapUnwrap(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string
): Promise<SwapResult & { quote: SwapQuote | null; route: string[]; routeDetail: PoolRoute[] }> {
  const amount = parseFloat(inputAmount);
  if (isNaN(amount) || amount <= 0) {
    return {
      success: false,
      error: "Invalid amount",
      executionVenue: "simulated",
      quote: null,
      route: [],
      routeDetail: [],
    };
  }

  const isWrap = isNativeHbar(inputSymbol); // HBAR → WHBAR = wrap
  const action = isWrap ? "Wrap" : "Unwrap";

  // Simulate network delay
  await new Promise(r => setTimeout(r, 400 + Math.random() * 600));

  const txId = `0.0.0@${Math.floor(Date.now() / 1000)}.${Math.floor(Math.random() * 999999999).toString().padStart(9, "0")}`;

  const quote: SwapQuote = {
    inputToken: inputSymbol,
    outputToken: outputSymbol,
    inputAmount: amount,
    outputAmount: amount, // 1:1
    priceImpact: 0,
    route: [inputSymbol, outputSymbol],
    fee: 0,
    minimumOutput: amount,
    executionPrice: 1,
  };

  return {
    success: true,
    transactionId: txId,
    outputAmount: amount,
    route: [inputSymbol, outputSymbol],
    priceImpact: 0,
    executionVenue: "simulated",
    quote,
    routeDetail: [],
  };
}
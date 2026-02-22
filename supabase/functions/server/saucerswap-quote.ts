// ═══════════════════════════════════════════════════════════════════════
// SAUCERSWAP QUOTE ENGINE  [C46]
// ═══════════════════════════════════════════════════════════════════════
//
// Server-side quote fetching with parallel multi-strategy racing.
// All 5 strategies run concurrently via Promise.allSettled() and the
// best quote is selected by confidence ranking.
//
//   Strategies (all run in parallel):
//     1. V1 Router getAmountsOut() via JSON-RPC (+ Mirror Node fallback)
//     2. V2 QuoterV2 quoteExactInputSingle() via JSON-RPC (+ Mirror fallback)
//     3. V2 QuoterV2 quoteExactInput() multi-hop via JSON-RPC (NEW)
//     4. SaucerSwap REST API /swap/quote
//     5. Price-based estimation fallback
//
//   Confidence ranking:  router > quoter > api > estimate
//
//   Quote cache: 10s TTL for same pair+amount combo.
//
// SENIOR DEV NOTE: This module imports core utilities from
// saucerswap-engine.ts.  It is registered separately in index.tsx.
// ════════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import {
  getClientIp,
  isRateLimited,
  ROUTE_PREFIX,
} from "./shared.ts";
import {
  htsIdToEvmAddress,
  ssFetchJsonRpc,
  ssMirrorContractCall,
  ssFetchSaucerSwapApi,
  ssResolveEvmAddress,
  ssDetectPoolVersion,
  type PoolVersionInfo,
} from "./saucerswap-engine.ts";

// ═════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════

/** V1 Router — for getAmountsOut() view function. */
const V1_ROUTER_IDS: Record<string, string> = {
  mainnet: "0.0.3045981",  // SaucerSwap V1 RouterV3
  testnet: "0.0.19264",
};

/** V2 QuoterV2 — for quoteExactInputSingle/quoteExactInput. */
const V2_QUOTER_IDS: Record<string, string> = {
  mainnet: "0.0.3949424",  // SaucerSwap V2 QuoterV2 (SEC-16)
  testnet: "0.0.1390002",
};

/** WHBAR Token HTS ID — used as intermediary for multi-hop. */
const WHBAR_HTS_ID = "0.0.1456986";

// [C52] Full intermediary candidate list — tested in parallel for Token→Token
// pairs with no direct pool. Ordered by typical liquidity depth.
// [C90] Expanded: added common bridge tokens (WBNB, WETH, WBTC, DAI) that
// serve as secondary liquidity hubs for exotic pairs.
const INTERMEDIARY_TOKENS: { htsId: string; symbol: string }[] = [
  { htsId: "0.0.1456986", symbol: "WHBAR" },
  { htsId: "0.0.456858",  symbol: "USDC" },
  { htsId: "0.0.1055472", symbol: "USDT" },
  { htsId: "0.0.731861",  symbol: "SAUCE" },
  { htsId: "0.0.834116",  symbol: "HBARX" },
  { htsId: "0.0.1055459", symbol: "USDCh" },
  { htsId: "0.0.1055481", symbol: "WETH" },
  { htsId: "0.0.1055482", symbol: "WBTC" },
  { htsId: "0.0.1157005", symbol: "WBNB" },
  { htsId: "0.0.1055480", symbol: "LINK" },
];

/** Quote cache TTL: 10 seconds. */
const QUOTE_CACHE_TTL_MS = 10_000;

/** Gas hex for Hedera EVM calls (1,500,000 — Hedera needs more gas than Ethereum). */
const GAS_HEX = "0x16e360";

/**
 * Overall quote timeout: 15 seconds hard ceiling.
 * Individual strategies have their own timeouts (RPC 12s, Mirror 10s),
 * but this protects the endpoint from hanging on edge cases.
 */
const QUOTE_OVERALL_TIMEOUT_MS = 15_000;

/**
 * V2 fee tiers in hundredths of a bip — ALL known SaucerSwap V2 tiers.
 * Ordered by most common first for early success in Promise.any races.
 */
const V2_FEE_TIERS = [3000, 1500, 10000, 500, 100] as const;

// ═════════════════════════════════════════════════════════════════════
// PARALLEL RPC + MIRROR RACE  [C92]
// ═════════════════════════════════════════════════════════════════════
// Runs BOTH JSON-RPC (HashIO) and Mirror Node contract call simultaneously.
// Returns the first non-empty hex result. Cuts worst-case latency in half
// compared to sequential fallback.

async function raceRpcAndMirror(
  toEvm: string, calldata: string, network: string, gasLimit: number = 1_500_000,
): Promise<string | null> {
  const validate = (r: any): r is string =>
    r != null && typeof r === "string" && r !== "0x" && r.length > 2;

  const rpcP = ssFetchJsonRpc(
    "eth_call", [{ to: toEvm, data: calldata, gas: GAS_HEX }, "latest"], network,
  ).then(r => { if (validate(r)) return r as string; throw new Error("rpc-empty"); });

  const mirrorP = ssMirrorContractCall(toEvm, calldata, network, gasLimit)
    .then(r => { if (validate(r)) return r as string; throw new Error("mirror-empty"); });

  try {
    return await Promise.any([rpcP, mirrorP]);
  } catch {
    return null; // Both failed or returned empty
  }
}

/**
 * Fallback token prices in USD.
 * [C33-01] Updated to current market values.
 * Used when SaucerSwap /tokens API is unavailable.
 */
const FALLBACK_PRICES_USD: Record<string, number> = {
  "0.0.1456986": 0.10,   // WHBAR
  "0.0.731861": 0.045,   // SAUCE
  "0.0.456858": 1.0,     // USDC
  "0.0.1055472": 1.0,    // USDT
  "0.0.1055482": 104000, // WBTC
  "0.0.1055481": 2650,   // WETH
  "0.0.1055480": 16.50,  // LINK
  "0.0.834116": 0.11,    // HBARX
  "0.0.7374029": 0.000001, // HBAR.h
  "0.0.968069": 0.018,   // HST
  "0.0.1157005": 660,    // WBNB
  "0.0.1055459": 1.0,    // USDCh
  "0.0.6792100": 0.015,  // PACK
  "0.0.3157928": 0.002,  // DOVU
  "0.0.4722969": 0.0003, // KARATE
};

const VALID_NETWORKS = new Set(["mainnet", "testnet"]);

// ═════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════

export interface QuoteResult {
  amountOut: string;         // Raw output amount (string for BigInt safety)
  source: string;            // "v1-router" | "v2-quoter" | "v2-multihop" | "api" | "price-estimate"
  confidence: "high" | "medium" | "low";
  priceImpact: number;       // 0 for router/quoter (baked in), estimated for others
  route: string[];           // HTS IDs in the route
  poolVersion?: "v1" | "v2";
  feeTier?: number;
}

// ═════════════════════════════════════════════════════════════════════
// CACHES
// ═════════════════════════════════════════════════════════════════════

interface CacheEntry<T> { value: T; ts: number; }
const _quoteCache = new Map<string, CacheEntry<QuoteResult>>();
const _contractEvmCache: Record<string, string> = {};

/** Token price cache from /tokens API (5 min TTL). */
let _tokenPrices: Map<string, number> | null = null;
let _tokenPricesTs = 0;
const TOKEN_PRICE_TTL_MS = 300_000;

// ═════════════════════════════════════════════════════════════════════
// ABI ENCODING / DECODING  [C46]
// ═════════════════════════════════════════════════════════════════════

function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function encodeUint256(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) { bytes[i] = Number(v & 0xffn); v >>= 8n; }
  return bytes;
}

function encodeAddress(addr: string): Uint8Array {
  const hex = addr.replace("0x", "").padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

function decodeBigUint(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 32; i++) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value;
}

/**
 * Encode getAmountsOut(uint256 amountIn, address[] path)
 * Selector: 0xd06ca61f
 */
function encodeGetAmountsOut(amountIn: bigint, path: string[]): string {
  const selector = new Uint8Array([0xd0, 0x6c, 0xa6, 0x1f]);
  const parts: Uint8Array[] = [selector, encodeUint256(amountIn), encodeUint256(64n), encodeUint256(BigInt(path.length))];
  for (const addr of path) parts.push(encodeAddress(addr));
  return bytesToHex(concatBytes(...parts));
}

/**
 * Decode getAmountsOut return → uint256[] amounts.
 * Returns the last element (output amount) or null.
 */
function decodeAmountsOut(hexData: string): bigint | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 96) return null;
    const arrLen = Number(decodeBigUint(bytes, 32));
    if (arrLen <= 0 || bytes.length < 64 + arrLen * 32) return null;
    return decodeBigUint(bytes, 64 + (arrLen - 1) * 32);
  } catch { return null; }
}

/**
 * Encode quoteExactInputSingle((address,address,uint256,uint24,uint160))
 * Selector: 0xc6a5026a
 */
function encodeQuoteExactInputSingle(
  tokenIn: string, tokenOut: string, amountIn: bigint, fee: number,
): string {
  const selector = new Uint8Array([0xc6, 0xa5, 0x02, 0x6a]);
  return bytesToHex(concatBytes(
    selector, encodeAddress(tokenIn), encodeAddress(tokenOut),
    encodeUint256(amountIn), encodeUint256(BigInt(fee)), encodeUint256(0n),
  ));
}

/**
 * Encode a packed V2 swap path: abi.encodePacked(token0, fee0, token1, ...)
 * Each address is 20 bytes, each fee is 3 bytes (uint24 big-endian).
 */
function encodePackedPath(hops: { tokenEvm: string; fee: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < hops.length; i++) {
    const addrHex = hops[i].tokenEvm.replace("0x", "").padStart(40, "0");
    const addrBytes = new Uint8Array(20);
    for (let j = 0; j < 20; j++) addrBytes[j] = parseInt(addrHex.slice(j * 2, j * 2 + 2), 16);
    parts.push(addrBytes);
    if (i < hops.length - 1) {
      const fee = hops[i].fee;
      const feeBytes = new Uint8Array(3);
      feeBytes[0] = (fee >> 16) & 0xff; feeBytes[1] = (fee >> 8) & 0xff; feeBytes[2] = fee & 0xff;
      parts.push(feeBytes);
    }
  }
  return concatBytes(...parts);
}

/**
 * Encode quoteExactInput(bytes path, uint256 amountIn)
 * Selector: 0xcdca1753
 */
function encodeQuoteExactInput(packedPath: Uint8Array, amountIn: bigint): string {
  const selector = new Uint8Array([0xcd, 0xca, 0x17, 0x53]);
  const pathLen = encodeUint256(BigInt(packedPath.length));
  const paddedLen = Math.ceil(packedPath.length / 32) * 32;
  const pathPadded = new Uint8Array(paddedLen);
  pathPadded.set(packedPath);
  return bytesToHex(concatBytes(selector, encodeUint256(64n), encodeUint256(amountIn), pathLen, pathPadded));
}

// ═════════════════════════════════════════════════════════════════════
// CONTRACT EVM ADDRESS RESOLUTION (cached)
// ═════════════════════════════════════════════════════════════════════

async function resolveContract(contractId: string, network: string): Promise<string> {
  const key = `${network}:${contractId}`;
  if (_contractEvmCache[key]) return _contractEvmCache[key];
  const evm = await ssResolveEvmAddress(contractId, "contract", network);
  _contractEvmCache[key] = evm;
  return evm;
}

// ═════════════════════════════════════════════════════════════════════
// TOKEN PRICE FETCHING
// ═════════════════════════════════════════════════════════════════════

async function ensureTokenPrices(): Promise<Map<string, number>> {
  if (_tokenPrices && Date.now() - _tokenPricesTs < TOKEN_PRICE_TTL_MS) return _tokenPrices;

  const data = await ssFetchSaucerSwapApi("/tokens");
  const prices = new Map<string, number>();

  // Seed with fallbacks
  for (const [id, price] of Object.entries(FALLBACK_PRICES_USD)) {
    prices.set(id, price);
  }

  if (data) {
    const tokens = Array.isArray(data) ? data : Object.values(data);
    for (const t of tokens as any[]) {
      const priceUsd = parseFloat(t.priceUsd || t.price || "0");
      const htsId = t.id || t.tokenId || t.token_id || "";
      if (htsId && priceUsd > 0) prices.set(htsId, priceUsd);
    }
    console.log(`[SS-Quote] Token prices refreshed: ${prices.size} tokens`);
  }

  _tokenPrices = prices;
  _tokenPricesTs = Date.now();
  return prices;
}

// ═════════════════════════════════════════════════════════════════════
// QUOTE STRATEGIES  [C46]
// ═════════════════════════════════════════════════════════════════════

/** Strategy 1: V1 Router getAmountsOut() — [C92] parallel RPC + Mirror race */
async function strategyV1Router(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  const routerId = V1_ROUTER_IDS[network] || V1_ROUTER_IDS.mainnet;
  const routerEvm = await resolveContract(routerId, network);
  const calldata = encodeGetAmountsOut(amountIn, [tokenInEvm, tokenOutEvm]);

  // [C92] Race RPC + Mirror in parallel — whichever succeeds first wins
  const result = await raceRpcAndMirror(routerEvm, calldata, network);
  if (result) {
    const out = decodeAmountsOut(result);
    if (out !== null && out > 0n) {
      console.log(`[SS-Quote] V1 router (race): amountOut=${out}`);
      return { amountOut: out.toString(), source: "v1-router", confidence: "high", priceImpact: 0, route: [inputHtsId, outputHtsId], poolVersion: "v1" };
    }
  }

  return null;
}

/** [C90] Strategy 1b: V1 Router multi-hop via WHBAR.
 * getAmountsOut with 3-token path: tokenIn → WHBAR → tokenOut.
 * Catches exotic pairs that have V1 AMM liquidity through WHBAR hub.
 * [C92] Uses parallel RPC + Mirror race. */
async function strategyV1RouterMultiHop(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  const whbarEvm = htsIdToEvmAddress(WHBAR_HTS_ID);
  // Skip if either token is already WHBAR
  if (tokenInEvm.toLowerCase() === whbarEvm.toLowerCase() ||
      tokenOutEvm.toLowerCase() === whbarEvm.toLowerCase()) return null;

  const routerId = V1_ROUTER_IDS[network] || V1_ROUTER_IDS.mainnet;
  const routerEvm = await resolveContract(routerId, network);
  const calldata = encodeGetAmountsOut(amountIn, [tokenInEvm, whbarEvm, tokenOutEvm]);

  // [C92] Race RPC + Mirror in parallel
  const result = await raceRpcAndMirror(routerEvm, calldata, network);
  if (result) {
    const out = decodeAmountsOut(result);
    if (out !== null && out > 0n) {
      console.log(`[SS-Quote] V1 multi-hop via WHBAR (race): amountOut=${out}`);
      return {
        amountOut: out.toString(), source: "v1-multihop-whbar", confidence: "high",
        priceImpact: 0, route: [inputHtsId, WHBAR_HTS_ID, outputHtsId], poolVersion: "v1",
      };
    }
  }
  return null;
}

/** Strategy 2: V2 QuoterV2 quoteExactInputSingle() — [C92] ALL fee tiers + parallel race.
 * This is the #1 fix for missing quotes: instead of trying ONE fee tier,
 * we probe ALL 5 SaucerSwap V2 tiers in parallel and pick the best output.
 * Each tier races RPC + Mirror simultaneously. */
async function strategyV2Quoter(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  _fee: number, inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  const quoterId = V2_QUOTER_IDS[network] || V2_QUOTER_IDS.mainnet;
  const quoterEvm = await resolveContract(quoterId, network);

  // [C92] Try ALL V2 fee tiers in parallel — pick the one with highest output.
  // Previously only tried the detected fee (or default 3000), missing pools
  // at other tiers entirely. This is the root cause of many "no quote" failures.
  const feeProbes = V2_FEE_TIERS.map(async (fee): Promise<QuoteResult | null> => {
    const calldata = encodeQuoteExactInputSingle(tokenInEvm, tokenOutEvm, amountIn, fee);
    const result = await raceRpcAndMirror(quoterEvm, calldata, network);
    if (result && result.length >= 66) {
      const cleanHex = result.startsWith("0x") ? result.slice(2) : result;
      const out = BigInt("0x" + cleanHex.slice(0, 64));
      if (out > 0n) {
        return {
          amountOut: out.toString(), source: "v2-quoter", confidence: "high",
          priceImpact: 0, route: [inputHtsId, outputHtsId], poolVersion: "v2", feeTier: fee,
        };
      }
    }
    return null;
  });

  // Wait for all tiers to complete (failed tiers return null quickly on revert)
  const results = await Promise.allSettled(feeProbes);

  // Pick the result with the highest output amount
  let best: QuoteResult | null = null;
  let bestOut = 0n;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      const out = BigInt(r.value.amountOut);
      if (out > bestOut) {
        best = r.value;
        bestOut = out;
      }
    }
  }

  if (best) {
    console.log(`[SS-Quote] V2 quoter (all-tier race): amountOut=${best.amountOut} fee=${best.feeTier}`);
  }
  return best;
}

/** Strategy 3: V2 QuoterV2 quoteExactInput() multi-hop through WHBAR. */
async function strategyV2MultiHop(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  const whbarEvm = htsIdToEvmAddress(WHBAR_HTS_ID);

  // Skip if either token is already WHBAR
  if (tokenInEvm.toLowerCase() === whbarEvm.toLowerCase() ||
      tokenOutEvm.toLowerCase() === whbarEvm.toLowerCase()) return null;

  const quoterId = V2_QUOTER_IDS[network] || V2_QUOTER_IDS.mainnet;
  const quoterEvm = await resolveContract(quoterId, network);

  // Try common fee combos for the 2-hop path: tokenIn → WHBAR → tokenOut
  // [C90] Expanded to cover ALL SaucerSwap V2 fee tiers (100, 500, 1500, 3000, 10000).
  // Promise.any returns the FIRST successful result — we get speed AND coverage.
  const feeCombos: [number, number][] = [
    [3000, 3000], [1500, 3000], [3000, 1500], [1500, 1500],
    [10000, 3000], [3000, 10000], [500, 3000], [3000, 500],
    [10000, 10000], [500, 500], [100, 3000], [3000, 100],
  ];

  const probes = feeCombos.map(async ([fee1, fee2]) => {
    const packedPath = encodePackedPath([
      { tokenEvm: tokenInEvm, fee: fee1 },
      { tokenEvm: whbarEvm, fee: fee2 },
      { tokenEvm: tokenOutEvm, fee: 0 },
    ]);
    const calldata = encodeQuoteExactInput(packedPath, amountIn);

    const rpcResult = await ssFetchJsonRpc("eth_call", [{ to: quoterEvm, data: calldata, gas: GAS_HEX }, "latest"], network);
    if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length >= 66) {
      const amountOutHex = rpcResult.slice(2, 66);
      const out = BigInt("0x" + amountOutHex);
      if (out > 0n) {
        console.log(`[SS-Quote] V2 multi-hop (RPC): amountOut=${out} fees=${fee1}/${fee2}`);
        return {
          amountOut: out.toString(), source: "v2-multihop", confidence: "high" as const, priceImpact: 0,
          route: [inputHtsId, WHBAR_HTS_ID, outputHtsId], poolVersion: "v2" as const, feeTier: fee1,
        };
      }
    }
    throw new Error("no-result"); // Signal Promise.any to try next
  });

  try {
    return await Promise.any(probes);
  } catch {
    // All combos failed — AggregateError
    return null;
  }
}

/** Strategy 4: SaucerSwap REST API /swap/quote */
async function strategyApiQuote(
  amountIn: string, inputHtsId: string, outputHtsId: string,
): Promise<QuoteResult | null> {
  const endpoints = [
    `/swap/quote?inputToken=${inputHtsId}&outputToken=${outputHtsId}&amountIn=${amountIn}`,
    `/swap/quote?tokenA=${inputHtsId}&tokenB=${outputHtsId}&amountIn=${amountIn}`,
  ];

  for (const ep of endpoints) {
    const data = await ssFetchSaucerSwapApi(ep);
    if (data) {
      const rawOut = data.amountOut ?? data.outputAmount ?? data.amount_out ?? data.quote;
      if (rawOut !== undefined && rawOut !== null) {
        const out = BigInt(String(rawOut).replace(/[^0-9]/g, ""));
        if (out > 0n) {
          console.log(`[SS-Quote] API quote: amountOut=${out}`);
          return {
            amountOut: out.toString(), source: "api", confidence: "medium",
            priceImpact: parseFloat(data.priceImpact || "0"),
            route: data.route || [inputHtsId, outputHtsId],
          };
        }
      }
    }
  }

  return null;
}

/** Strategy 5: Price-based estimation fallback. */
async function strategyPriceEstimate(
  amountIn: bigint, inputHtsId: string, outputHtsId: string,
  inputDecimals: number, outputDecimals: number,
): Promise<QuoteResult | null> {
  const prices = await ensureTokenPrices();

  // For native HBAR, look up WHBAR price
  const inPrice = prices.get(inputHtsId) ?? prices.get(WHBAR_HTS_ID) ?? 0;
  const outPrice = prices.get(outputHtsId) ?? 0;

  if (inPrice <= 0 || outPrice <= 0) {
    console.log(`[SS-Quote] Price estimate failed: inPrice=${inPrice} outPrice=${outPrice} for ${inputHtsId}/${outputHtsId}`);
    return null;
  }

  const humanInput = Number(amountIn) / Math.pow(10, inputDecimals);
  const valueUsd = humanInput * inPrice;
  const feeMultiplier = 0.997; // 0.3% fee
  const outputHuman = (valueUsd * feeMultiplier) / outPrice;
  const rawOutput = Math.floor(outputHuman * Math.pow(10, outputDecimals));

  if (rawOutput <= 0) return null;

  console.log(`[SS-Quote] Price estimate: ${humanInput} × $${inPrice} × ${feeMultiplier} / $${outPrice} = ${outputHuman} (raw: ${rawOutput})`);
  return {
    amountOut: rawOutput.toString(), source: "price-estimate", confidence: "low",
    priceImpact: 0.05, route: [inputHtsId, outputHtsId],
  };
}

// ═════════════════════════════════════════════════════════════════════
// [C52] SMART MULTI-ROUTE SCORING
// ═════════════════════════════════════════════════════════════════════
//
// For Token→Token pairs with no direct pool, tests ALL intermediary
// candidates in parallel and returns scored routes.
//
// Score formula (normalized 0-1):
//   score = (outputNorm × 0.7) + (confidenceNorm × 0.2) + (hopPenalty × -0.1)
//
// where:
//   outputNorm     = thisOutput / maxOutput across all routes
//   confidenceNorm = { high: 1.0, medium: 0.6, low: 0.3 }
//   hopPenalty     = (numHops - 1) / maxPossibleHops  (1-hop = 0, 2-hop = 1)

export interface ScoredRoute {
  quote: QuoteResult;
  score: number;
  label: string;       // e.g. "USDC → WHBAR → SAUCE"
  intermediary: string; // HTS ID of intermediary token
  hops: number;
}

/**
 * [C52] Test all intermediary candidates for a Token→Token pair.
 * Each intermediary is tested with BOTH V1 and V2 routing in parallel.
 * Returns all successful routes, unsorted (scoring happens in orchestrator).
 */
async function probeAllIntermediaries(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
  inputDecimals: number, outputDecimals: number,
): Promise<QuoteResult[]> {
  const routerId = V1_ROUTER_IDS[network] || V1_ROUTER_IDS.mainnet;
  const quoterId = V2_QUOTER_IDS[network] || V2_QUOTER_IDS.mainnet;

  // Filter out intermediaries that are the input or output
  const candidates = INTERMEDIARY_TOKENS.filter(
    t => t.htsId !== inputHtsId && t.htsId !== outputHtsId
  );

  if (candidates.length === 0) return [];

  const [routerEvm, quoterEvm] = await Promise.all([
    resolveContract(routerId, network),
    resolveContract(quoterId, network),
  ]);

  const probes: Promise<QuoteResult | null>[] = [];

  for (const mid of candidates) {
    const midEvm = htsIdToEvmAddress(mid.htsId);

    // V1 multi-hop: tokenIn → mid → tokenOut via getAmountsOut
    probes.push((async (): Promise<QuoteResult | null> => {
      try {
        const calldata = encodeGetAmountsOut(amountIn, [tokenInEvm, midEvm, tokenOutEvm]);
        const rpcResult = await ssFetchJsonRpc("eth_call", [{ to: routerEvm, data: calldata, gas: GAS_HEX }, "latest"], network);
        if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length > 2) {
          const out = decodeAmountsOut(rpcResult);
          if (out !== null && out > 0n) {
            return {
              amountOut: out.toString(), source: `v1-via-${mid.symbol}`, confidence: "high",
              priceImpact: 0, route: [inputHtsId, mid.htsId, outputHtsId], poolVersion: "v1",
            };
          }
        }
      } catch { /* non-fatal */ }
      return null;
    })());

    // V2 multi-hop: tokenIn → mid → tokenOut via quoteExactInput
    // [C90] Expanded fee combos to cover ALL SaucerSwap V2 tiers.
    // This is the key fix for exotic pairs — wrong fee tier = no quote.
    const feeCombos: [number, number][] = [
      [3000, 3000], [1500, 3000], [3000, 1500], [10000, 3000],
      [3000, 10000], [500, 3000], [3000, 500],
    ];
    for (const [fee1, fee2] of feeCombos) {
      probes.push((async (): Promise<QuoteResult | null> => {
        try {
          const packedPath = encodePackedPath([
            { tokenEvm: tokenInEvm, fee: fee1 },
            { tokenEvm: midEvm, fee: fee2 },
            { tokenEvm: tokenOutEvm, fee: 0 },
          ]);
          const calldata = encodeQuoteExactInput(packedPath, amountIn);
          const rpcResult = await ssFetchJsonRpc("eth_call", [{ to: quoterEvm, data: calldata, gas: GAS_HEX }, "latest"], network);
          if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length >= 66) {
            const out = BigInt("0x" + rpcResult.slice(2, 66));
            if (out > 0n) {
              return {
                amountOut: out.toString(), source: `v2-via-${mid.symbol}`, confidence: "high",
                priceImpact: 0, route: [inputHtsId, mid.htsId, outputHtsId], poolVersion: "v2", feeTier: fee1,
              };
            }
          }
        } catch { /* non-fatal */ }
        return null;
      })());
    }
  }

  // Race all probes with a 12s sub-timeout (some will be slow)
  const timeout = new Promise<PromiseSettledResult<QuoteResult | null>[]>((resolve) =>
    setTimeout(() => resolve([]), 12_000)
  );
  const results = await Promise.race([Promise.allSettled(probes), timeout]);

  const routes: QuoteResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) routes.push(r.value);
  }

  console.log(`[C52] Multi-route probed ${probes.length} combos → ${routes.length} valid routes`);
  return routes;
}

/**
 * [C52] Score and rank routes using the composite formula.
 * Returns top 3 scored routes sorted by score descending.
 */
function scoreRoutes(allQuotes: QuoteResult[]): ScoredRoute[] {
  if (allQuotes.length === 0) return [];

  const CONF_NORM: Record<string, number> = { high: 1.0, medium: 0.6, low: 0.3 };

  // Find max output for normalization
  let maxOutput = 0n;
  for (const q of allQuotes) {
    const out = BigInt(q.amountOut);
    if (out > maxOutput) maxOutput = out;
  }
  if (maxOutput === 0n) return [];

  const scored: ScoredRoute[] = allQuotes.map(q => {
    const output = BigInt(q.amountOut);
    const outputNorm = Number(output * 10000n / maxOutput) / 10000;
    const confNorm = CONF_NORM[q.confidence] || 0.3;
    const hops = q.route.length - 1; // 2 tokens = 1 hop, 3 tokens = 2 hops
    const hopPenalty = Math.max(0, hops - 1); // 1-hop = 0 penalty, 2-hop = 1

    const score = (outputNorm * 0.7) + (confNorm * 0.2) + (hopPenalty * -0.1);

    // Build label from route
    const label = q.route.map(id => {
      const entry = INTERMEDIARY_TOKENS.find(t => t.htsId === id);
      return entry?.symbol || id;
    }).join(" → ");

    const intermediary = q.route.length === 3 ? q.route[1] : "";

    return { quote: q, score, label, intermediary, hops };
  });

  // Sort by score descending, take top 3
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}

// ═════════════════════════════════════════════════════════════════════
// QUOTE ORCHESTRATOR  [C46] + [C52]
// ═════════════════════════════════════════════════════════════════════

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export async function ssQuote(params: {
  inputToken: string;
  outputToken: string;
  amountIn: string;
  slippage: number;
  inputDecimals: number;
  outputDecimals: number;
  network: string;
}): Promise<{ best: QuoteResult | null; allQuotes: QuoteResult[]; scoredRoutes: ScoredRoute[]; poolInfo: PoolVersionInfo | null }> {
  const { inputToken, outputToken, amountIn, slippage, inputDecimals, outputDecimals, network } = params;
  const amountInBigInt = BigInt(amountIn);

  // Resolve tokens to EVM addresses (HBAR → WHBAR for routing)
  const inputHtsId = inputToken === "HBAR" ? WHBAR_HTS_ID : inputToken;
  const outputHtsId = outputToken === "HBAR" ? WHBAR_HTS_ID : outputToken;
  const tokenInEvm = htsIdToEvmAddress(inputHtsId);
  const tokenOutEvm = htsIdToEvmAddress(outputHtsId);

  // Check quote cache
  const cacheKey = `${network}:${inputHtsId}:${outputHtsId}:${amountIn}`;
  const cachedEntry = _quoteCache.get(cacheKey);
  if (cachedEntry && Date.now() - cachedEntry.ts < QUOTE_CACHE_TTL_MS) {
    return { best: cachedEntry.value, allQuotes: [cachedEntry.value], scoredRoutes: [], poolInfo: null };
  }

  // Detect pool (uses C45 cache internally)
  const poolInfo = await ssDetectPoolVersion(tokenInEvm, tokenOutEvm, network);
  const fee = poolInfo?.feeTier || 3000;

  // [C52] Determine if multi-route probing is needed:
  // If there's no direct pool detected, probe ALL intermediaries in parallel
  const needsMultiRoute = !poolInfo && inputHtsId !== outputHtsId;

  // Launch ALL strategies in parallel
  // [C46] Wrapped with overall timeout to prevent hangs
  const timeoutPromise = new Promise<PromiseSettledResult<QuoteResult | null>[]>((resolve) =>
    setTimeout(() => resolve([]), QUOTE_OVERALL_TIMEOUT_MS)
  );
  const strategiesPromise = Promise.allSettled([
    strategyV1Router(amountInBigInt, tokenInEvm, tokenOutEvm, inputHtsId, outputHtsId, network),
    // [C90] V1 multi-hop via WHBAR — catches pairs where V1 has both legs but no direct pair
    strategyV1RouterMultiHop(amountInBigInt, tokenInEvm, tokenOutEvm, inputHtsId, outputHtsId, network),
    // [C92] ALWAYS run V2 quoter across ALL fee tiers — no pool version gate.
    // Previously gated by `poolInfo?.version === "v2" || !poolInfo` which skipped
    // V2 when pool was detected as V1. But pairs can have BOTH V1 and V2 pools.
    strategyV2Quoter(amountInBigInt, tokenInEvm, tokenOutEvm, fee, inputHtsId, outputHtsId, network),
    strategyV2MultiHop(amountInBigInt, tokenInEvm, tokenOutEvm, inputHtsId, outputHtsId, network),
    strategyApiQuote(amountIn, inputToken === "HBAR" ? WHBAR_HTS_ID : inputToken, outputToken === "HBAR" ? WHBAR_HTS_ID : outputToken),
    strategyPriceEstimate(amountInBigInt, inputHtsId, outputHtsId, inputDecimals, outputDecimals),
  ]);

  // [C52] Run multi-route probing in parallel with main strategies
  // [C92] Also probe intermediaries when pool IS detected — catches better multi-hop routes
  const multiRoutePromise = (inputHtsId !== outputHtsId)
    ? probeAllIntermediaries(amountInBigInt, tokenInEvm, tokenOutEvm, inputHtsId, outputHtsId, network, inputDecimals, outputDecimals)
    : Promise.resolve([] as QuoteResult[]);

  const [strategies, multiRouteResults] = await Promise.all([
    Promise.race([strategiesPromise, timeoutPromise]),
    multiRoutePromise,
  ]);

  // Collect successful results from main strategies
  const allQuotes: QuoteResult[] = [];
  for (const result of strategies) {
    if (result.status === "fulfilled" && result.value) {
      allQuotes.push(result.value);
    }
  }

  // [C52] Merge multi-route results, dedup by source
  const seenSources = new Set(allQuotes.map(q => q.source));
  for (const mq of multiRouteResults) {
    if (!seenSources.has(mq.source)) {
      allQuotes.push(mq);
      seenSources.add(mq.source);
    }
  }

  console.log(`[SS-Quote] ${allQuotes.length} total quotes for ${inputHtsId}→${outputHtsId} (${multiRouteResults.length} from multi-route)`);

  if (allQuotes.length === 0) return { best: null, allQuotes: [], scoredRoutes: [], poolInfo };

  // [C92] Rank by HIGHEST OUTPUT among high-confidence quotes first,
  // then by confidence for lower tiers. This ensures the user always gets
  // the best output amount, not just the first high-confidence result.
  allQuotes.sort((a, b) => {
    const aConf = CONFIDENCE_RANK[a.confidence] || 0;
    const bConf = CONFIDENCE_RANK[b.confidence] || 0;
    // Both high confidence → pick highest output
    if (aConf === 3 && bConf === 3) {
      return BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : -1;
    }
    // Different confidence → prefer higher confidence
    if (aConf !== bConf) return bConf - aConf;
    // Same non-high confidence → pick highest output
    return BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : -1;
  });

  const best = allQuotes[0];

  // [C52] Score routes for frontend comparison
  const scoredRoutes = scoreRoutes(allQuotes);

  // Cache the best result
  _quoteCache.set(cacheKey, { value: best, ts: Date.now() });
  // Evict old cache entries
  if (_quoteCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of _quoteCache) {
      if (now - v.ts > QUOTE_CACHE_TTL_MS) _quoteCache.delete(k);
    }
  }

  return { best, allQuotes, scoredRoutes, poolInfo };
}

// ═════════════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═════════════════════════════════════════════════════════════════════

function normalizeNetwork(raw: string | undefined | null): string {
  const n = (raw || "mainnet").toLowerCase().trim();
  return VALID_NETWORKS.has(n) ? n : "mainnet";
}

export function registerSaucerswapQuoteRoutes(app: Hono): void {

  // ────────────────────────────────────────────────────────────────────
  // GET /saucerswap/quote
  //
  // [C46] Server-side parallel multi-strategy quote fetching.
  //
  // Runs ALL 5 quote strategies concurrently and returns the best.
  // Resolves in ~1-2s vs 23+s from browser.
  //
  // Query params:
  //   inputToken    (required) HTS ID (e.g. "0.0.731861") or "HBAR"
  //   outputToken   (required) HTS ID or "HBAR"
  //   amountIn      (required) Raw amount in smallest units
  //   slippage      (optional) Percentage, default 0.5
  //   inputDecimals (optional) Defaults to 8
  //   outputDecimals(optional) Defaults to 8
  //   network       (optional) "mainnet" (default) | "testnet"
  //
  // Response (200):
  //   {
  //     amountOut: string,
  //     amountOutMin: string,       // After slippage
  //     source: string,
  //     confidence: "high"|"medium"|"low",
  //     priceImpact: number,
  //     route: string[],
  //     poolVersion?: "v1"|"v2",
  //     feeTier?: number,
  //     allQuotes: QuoteResult[],
  //     scoredRoutes: ScoredRoute[],
  //     fromCache: boolean,
  //     durationMs: number
  //   }
  //
  // Response (404):
  //   { error: "No quotes available" }
  // ────────────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/saucerswap/quote`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const inputToken    = c.req.query("inputToken") || "";
    const outputToken   = c.req.query("outputToken") || "";
    const amountIn      = c.req.query("amountIn") || "";
    const slippage      = parseFloat(c.req.query("slippage") || "0.5");
    const inputDecimals = parseInt(c.req.query("inputDecimals") || "8", 10);
    const outputDecimals = parseInt(c.req.query("outputDecimals") || "8", 10);
    const network       = normalizeNetwork(c.req.query("network"));

    // Validate inputs
    if (!inputToken || (!inputToken.startsWith("0.0.") && inputToken !== "HBAR")) {
      return c.json({ error: "Invalid inputToken", detail: 'Expected "0.0.xxxxx" or "HBAR"' }, 400);
    }
    if (!outputToken || (!outputToken.startsWith("0.0.") && outputToken !== "HBAR")) {
      return c.json({ error: "Invalid outputToken", detail: 'Expected "0.0.xxxxx" or "HBAR"' }, 400);
    }
    if (!amountIn || !/^\d+$/.test(amountIn) || amountIn === "0") {
      return c.json({ error: "Invalid amountIn", detail: "Expected positive integer string" }, 400);
    }
    if (inputToken === outputToken) {
      return c.json({ error: "inputToken and outputToken must be different" }, 400);
    }

    const startMs = Date.now();

    try {
      // Check cache for fromCache flag
      const inputHtsId = inputToken === "HBAR" ? WHBAR_HTS_ID : inputToken;
      const outputHtsId = outputToken === "HBAR" ? WHBAR_HTS_ID : outputToken;
      const cacheKey = `${network}:${inputHtsId}:${outputHtsId}:${amountIn}`;
      const wasCached = _quoteCache.has(cacheKey) && Date.now() - (_quoteCache.get(cacheKey)?.ts ?? 0) < QUOTE_CACHE_TTL_MS;

      const { best, allQuotes, scoredRoutes, poolInfo } = await ssQuote({
        inputToken, outputToken, amountIn, slippage, inputDecimals, outputDecimals, network,
      });

      const durationMs = Date.now() - startMs;

      if (!best) {
        return c.json({
          error: "No quotes available",
          inputToken, outputToken, amountIn, durationMs,
          poolInfo,
        }, 404);
      }

      // Calculate amountOutMin with slippage
      const amountOutBig = BigInt(best.amountOut);
      const slippageBps = Math.floor(slippage * 100); // 0.5% → 50 bps
      const amountOutMin = amountOutBig - (amountOutBig * BigInt(slippageBps)) / 10000n;

      return c.json({
        amountOut: best.amountOut,
        amountOutMin: amountOutMin.toString(),
        source: best.source,
        confidence: best.confidence,
        priceImpact: best.priceImpact,
        route: best.route,
        poolVersion: best.poolVersion || poolInfo?.version,
        feeTier: best.feeTier || poolInfo?.feeTier,
        allQuotes,
        scoredRoutes,
        poolInfo,
        fromCache: wasCached,
        durationMs,
      });
    } catch (err: any) {
      console.log(`[SS-Quote] /quote error: ${err?.message || err}`);
      return c.json({
        error: "Quote failed",
        detail: err?.message || "Unknown error",
        durationMs: Date.now() - startMs,
      }, 502);
    }
  });
}
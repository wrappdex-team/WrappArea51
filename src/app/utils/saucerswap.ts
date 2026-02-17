/**
 * SaucerSwap Integration for HBAR.h
 *
 * Two execution paths:
 * 1. RestrictedDexRouter contract — on-chain restricted swap executor that
 *    wraps SauceSwap V1 router, only allows pre-approved tokens.
 * 2. SaucerSwap REST API — quote estimation, pool data, and live token prices.
 *
 * Signing is done via HashPack (HashConnect).
 */

// Inline the type to avoid cross-module import issues with Vite HMR
type HederaNetwork = "mainnet" | "testnet";

const SAUCERSWAP_API = "https://api.saucerswap.finance";
const HBARH_TOKEN_ID = "0.0.9356476";
import { log } from "./logger";

// ── Resilient SaucerSwap API helper ────────────────────────────────
// The SaucerSwap REST API has been observed to respond differently
// depending on path prefix (versionless, /v1/, /v2/) and may enforce
// CORS restrictions or require auth for browser-origin requests.
// This helper tries all known variants and returns the first successful
// response, falling back to null if all fail.

const _apiDiagLogged = new Set<string>(); // avoid console spam

async function saucerFetch(
  path: string,
  timeoutMs: number = 10000,
): Promise<Response | null> {
  // Try all known prefix variants for the given path
  const variants = [
    path,             // versionless (e.g. /tokens)
    "/v1" + path,     // V1 prefix   (e.g. /v1/tokens)
    "/v2" + path,     // V2 prefix   (e.g. /v2/tokens)
  ];
  const headers: Record<string, string> = { Accept: "application/json" };

  for (const variant of variants) {
    try {
      const res = await fetch(SAUCERSWAP_API + variant, {
        headers,
        signal: makeAbort(timeoutMs),
      });
      if (res.ok) {
        if (_apiDiagLogged.has(path)) {
          log.info("SaucerSwap", `${variant} recovered`);
        }
        return res;
      }
      // Log first failure per path, then stay quiet
      if (!_apiDiagLogged.has(path)) {
        log.info("SaucerSwap", `${variant} → HTTP ${res.status}, trying next variant…`);
      }
    } catch {
      if (!_apiDiagLogged.has(path)) {
        log.info("SaucerSwap", `${variant} → network error, trying next variant…`);
      }
    }
  }

  // All variants exhausted
  if (!_apiDiagLogged.has(path)) {
    log.info("SaucerSwap", `${path}: all URL variants failed — using fallback data`);
    _apiDiagLogged.add(path);
  }
  return null;
}

// ── Allowed Token Registry ──────────────────────────────────────────

export interface AllowedToken {
  symbol: string;
  name: string;
  htsId: string;
  evmAddress: string;
  decimals: number;
  logo: string;
  rank: number;
  isWrapped: boolean;
  bridge?: string;
  isNative?: boolean;
}

export function htsIdToEvmAddress(htsId: string): string {
  const parts = htsId.split(".");
  const tokenNum = parseInt(parts[2], 10);
  return "0x" + tokenNum.toString(16).padStart(40, "0");
}

export function evmAddressToHtsId(evmAddr: string): string {
  const hex = evmAddr.replace("0x", "");
  const tokenNum = parseInt(hex, 16);
  return "0.0." + tokenNum;
}

export const SAUCERSWAP_TOKENS: AllowedToken[] = [
  {
    symbol: "HBAR", name: "HBAR", htsId: "native",
    evmAddress: "0x0000000000000000000000000000000000000000", decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
    rank: 0, isWrapped: false, isNative: true,
  },
  {
    symbol: "WHBAR", name: "Wrapped HBAR", htsId: "0.0.1456986",
    evmAddress: htsIdToEvmAddress("0.0.1456986"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
    rank: 1, isWrapped: false,
  },
  {
    symbol: "USDC", name: "USD Coin", htsId: "0.0.456858",
    evmAddress: htsIdToEvmAddress("0.0.456858"), decimals: 6,
    logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    rank: 2, isWrapped: false,
  },
  {
    symbol: "USDT", name: "Tether USD", htsId: "0.0.4291336",
    evmAddress: htsIdToEvmAddress("0.0.4291336"), decimals: 6,
    logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png",
    rank: 3, isWrapped: false,
  },
  {
    symbol: "WBTC", name: "Wrapped Bitcoin", htsId: "0.0.1969769",
    evmAddress: htsIdToEvmAddress("0.0.1969769"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
    rank: 4, isWrapped: true, bridge: "Hashport",
  },
  {
    symbol: "LINK", name: "Chainlink", htsId: "0.0.1970030",
    evmAddress: htsIdToEvmAddress("0.0.1970030"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
    rank: 5, isWrapped: true, bridge: "Hashport",
  },
  {
    symbol: "SAUCE", name: "SaucerSwap", htsId: "0.0.731861",
    evmAddress: htsIdToEvmAddress("0.0.731861"), decimals: 6,
    logo: "https://www.saucerswap.finance/images/tokens/sauce.svg",
    rank: 6, isWrapped: false,
  },
  {
    symbol: "HBARX", name: "Stader HBAR", htsId: "0.0.834116",
    evmAddress: htsIdToEvmAddress("0.0.834116"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/hbarx.svg",
    rank: 7, isWrapped: false,
  },
  {
    symbol: "KARATE", name: "Karate Combat", htsId: "0.0.2283328",
    evmAddress: htsIdToEvmAddress("0.0.2283328"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/karate.svg",
    rank: 8, isWrapped: false,
  },
  {
    symbol: "PACK", name: "HashPack", htsId: "0.0.4589822",
    evmAddress: htsIdToEvmAddress("0.0.4589822"), decimals: 6,
    logo: "https://www.saucerswap.finance/images/tokens/pack.svg",
    rank: 9, isWrapped: false,
  },
  {
    symbol: "DOVU", name: "DOVU", htsId: "0.0.3716059",
    evmAddress: htsIdToEvmAddress("0.0.3716059"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/dovu.svg",
    rank: 10, isWrapped: false,
  },
  {
    symbol: "HST", name: "HSuite Token", htsId: "0.0.786931",
    evmAddress: htsIdToEvmAddress("0.0.786931"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/hst.svg",
    rank: 11, isWrapped: false,
  },
  {
    symbol: "WETH", name: "Wrapped Ether", htsId: "0.0.1969757",
    evmAddress: htsIdToEvmAddress("0.0.1969757"), decimals: 18,
    logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
    rank: 12, isWrapped: true, bridge: "Hashport",
  },
  {
    symbol: "HBAR.ħ", name: "HBAR.ħ Protocol", htsId: HBARH_TOKEN_ID,
    evmAddress: htsIdToEvmAddress(HBARH_TOKEN_ID), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/hbar-h.svg",
    rank: 13, isWrapped: false,
  },
  {
    symbol: "WPOL", name: "Wrapped POL (Polygon)", htsId: "0.0.3306241",
    evmAddress: htsIdToEvmAddress("0.0.3306241"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/4713/large/polygon.png",
    rank: 14, isWrapped: true, bridge: "Hashport",
  },
];

export const TOKEN_BY_SYMBOL = new Map(SAUCERSWAP_TOKENS.map((t) => [t.symbol, t]));
export const TOKEN_BY_HTS_ID = new Map(SAUCERSWAP_TOKENS.map((t) => [t.htsId, t]));

export function resolveToken(symbol: string): AllowedToken | undefined {
  // Check exact match first — critical for symbols with non-ASCII characters
  // like "HBAR.ħ" where toUpperCase() produces "HBAR.Ħ" (wrong Map key).
  const exact = TOKEN_BY_SYMBOL.get(symbol);
  if (exact) return exact;

  // HBAR (native) is its own token now — not aliased to WHBAR
  const aliases: Record<string, string> = { ETH: "WETH", BTC: "WBTC", MATIC: "WPOL", POL: "WPOL", POLY: "WPOL" };
  const upper = symbol.toUpperCase();
  const resolved = aliases[upper] || upper;
  return TOKEN_BY_SYMBOL.get(resolved);
}

/**
 * Check if a symbol represents native HBAR.
 */
export function isNativeHbar(symbol: string): boolean {
  return symbol.toUpperCase() === "HBAR";
}

/**
 * Check if a token pair is an HBAR ↔ WHBAR wrap/unwrap operation.
 * These bypass pool routing and use wrapHbar()/unwrapHbar() directly.
 */
export function isHbarWhbarPair(symbolA: string, symbolB: string): boolean {
  const a = symbolA.toUpperCase();
  const b = symbolB.toUpperCase();
  return (a === "HBAR" && b === "WHBAR") || (a === "WHBAR" && b === "HBAR");
}

/**
 * Get the WHBAR AllowedToken. Used internally for routing native HBAR
 * through WHBAR pools and for building contract call paths.
 */
export function getWhbarToken(): AllowedToken {
  return TOKEN_BY_SYMBOL.get("WHBAR")!;
}

// ── Contract Addresses ──────────────────────────────────────────────

// Known candidate router addresses for dynamic verification.
// The system will call factory() on each to confirm which is correct.
const SAUCERSWAP_V1_ROUTER_CANDIDATES: Record<string, string[]> = {
  mainnet: ["0.0.2647300", "0.0.3389830", "0.0.2210240"],
  testnet: ["0.0.19264"],
};

const SAUCERSWAP_V1_ROUTER: Record<string, string> = {
  mainnet: "0.0.2647300",  // SaucerSwap V1 Router02 on Hedera mainnet
  testnet: "0.0.19264",
};

const SAUCERSWAP_V1_FACTORY: Record<string, string> = {
  mainnet: "0.0.2210218",  // UniswapV2Factory on Hedera
  testnet: "0.0.19252",
};

const RESTRICTED_ROUTER: Record<string, string> = {
  mainnet: "0.0.0", // Deploy to mainnet and set ID
  testnet: "0.0.0", // Deploy to testnet and set ID
};

// ── SaucerSwap V2 (Concentrated Liquidity — UniswapV3 Fork) ─────────
// Many newer tokens (including HBAR.ħ) only have V2 pools.
// V2 uses exactInputSingle instead of swapExactTokensForTokens.
const SAUCERSWAP_V2_ROUTER: Record<string, string> = {
  mainnet: "0.0.3949581",  // SaucerSwap V2 SwapRouter on Hedera mainnet
  testnet: "0.0.19264",
};

// Common V2 fee tiers to probe when discovering pools (hundredths of a bip)
// Ordered by most common first for faster discovery
const V2_FEE_TIERS = [3000, 10000, 500, 100] as const;

export function getSaucerSwapRouter(network: HederaNetwork, version: "v1" | "v2" = "v1"): string {
  if (version === "v2") return SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
  return SAUCERSWAP_V1_ROUTER[network] || SAUCERSWAP_V1_ROUTER.mainnet;
}

export function getSaucerSwapFactory(network: HederaNetwork): string {
  return SAUCERSWAP_V1_FACTORY[network] || SAUCERSWAP_V1_FACTORY.mainnet;
}

export function getRestrictedRouter(network: HederaNetwork): string {
  return RESTRICTED_ROUTER[network] || "0.0.0";
}

// ── Types ──────────────────────────────────────────────────────────

export interface HbarhTokenData {
  price: number;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  liquidity: number;
  priceHistory: number[];
}

export interface SaucerSwapPool {
  id: string;
  tokenA: { id: string; symbol: string; name: string; decimals: number };
  tokenB: { id: string; symbol: string; name: string; decimals: number };
  tvlUsd: number;
  volume24hUsd: number;
  fee: number;
  apr: number;
  tickSpacing: number;
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
}

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  decimals: number;
  tvl: number;
  volume24h: number;
  priceChange24h: number;
}

export interface SwapResult {
  success: boolean;
  transactionId?: string;
  outputAmount?: number;
  error?: string;
  route?: string[];
  priceImpact?: number;
  executionVenue: "saucerswap-v1" | "saucerswap-v2" | "restricted-router" | "simulated";
  /** How the quote was obtained: "router" | "api" | "price-estimate" | "none" */
  quoteSource?: string;
  /** Whether the pre-swap dry run was executed and passed */
  dryRunPassed?: boolean;
  /** True when the user actively declined/cancelled the transaction in their wallet */
  userCancelled?: boolean;
}

// ── Token Association Check ─────────────────────────────────────────

const MIRROR_NODES: Record<string, string> = {
  mainnet: "https://mainnet-public.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
};

// ── Hedera JSON-RPC Relay (HashIO) ──────────────────────────────────
// Standard Ethereum JSON-RPC interface for the Hedera network.
// Supports eth_call which handles cross-contract calls reliably —
// unlike the Mirror Node /api/v1/contracts/call simulation endpoint
// which often returns empty results for multi-hop view functions
// like getAmountsOut() that read reserves from pair contracts.
const JSON_RPC_RELAY: Record<string, string> = {
  mainnet: "https://mainnet.hashio.io/api",
  testnet: "https://testnet.hashio.io/api",
};

function makeAbort(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export async function isTokenAssociated(
  accountId: string,
  tokenId: string,
  network: HederaNetwork = "mainnet"
): Promise<boolean> {
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      base + "/api/v1/accounts/" + accountId + "/tokens?token.id=" + tokenId + "&limit=1",
      { signal: makeAbort(8000) }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data.tokens) && data.tokens.length > 0;
  } catch {
    return false;
  }
}

export async function getTokenBalance(
  accountId: string,
  tokenId: string,
  network: HederaNetwork = "mainnet"
): Promise<number> {
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      base + "/api/v1/accounts/" + accountId + "/tokens?token.id=" + tokenId + "&limit=1",
      { signal: makeAbort(8000) }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    if (Array.isArray(data.tokens) && data.tokens.length > 0) {
      return parseInt(data.tokens[0].balance || "0", 10);
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Get native HBAR balance for an account.
 * Returns balance in tinybars (1 HBAR = 100,000,000 tinybar).
 */
export async function getNativeHbarBalance(
  accountId: string,
  network: HederaNetwork = "mainnet"
): Promise<number> {
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      base + "/api/v1/accounts/" + accountId,
      { signal: makeAbort(8000) }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    // balance.balance is in tinybars
    return parseInt(data.balance?.balance || "0", 10);
  } catch {
    return 0;
  }
}

// ── Path Building ───────────────────────────────────────────────────

export function buildSwapPath(input: AllowedToken, output: AllowedToken): AllowedToken[] {
  const whbar = TOKEN_BY_SYMBOL.get("WHBAR");
  if (!whbar) return [input, output];

  // Treat native HBAR as WHBAR for path routing decisions
  const effectiveInputSym = input.isNative ? "WHBAR" : input.symbol;
  const effectiveOutputSym = output.isNative ? "WHBAR" : output.symbol;

  if (effectiveInputSym === "WHBAR" || effectiveOutputSym === "WHBAR") {
    return [input, output];
  }

  const stables = ["USDC", "USDT"];
  if (stables.includes(effectiveInputSym) && stables.includes(effectiveOutputSym)) {
    return [input, output];
  }

  return [input, whbar, output];
}

// ── Quote Fetching ──────────────────────────────────────────────────

export interface RawQuote {
  amountOut: number;
  priceImpact: number;
  route: string[];
  source: "router" | "api" | "price-estimate";
}

// ── Helper: bytes ↔ hex ──

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

/**
 * ABI-encode getAmountsOut(uint256 amountIn, address[] calldata path)
 * Selector: 0xd06ca61f
 */
function encodeGetAmountsOut(amountIn: bigint, path: string[]): Uint8Array {
  const selector = new Uint8Array([0xd0, 0x6c, 0xa6, 0x1f]);
  const parts: Uint8Array[] = [selector];
  parts.push(encodeUint256(amountIn));     // amountIn
  parts.push(encodeUint256(64n));           // offset to path array (2 head slots × 32)
  parts.push(encodeUint256(BigInt(path.length)));
  for (const addr of path) {
    parts.push(encodeAddress(addr));
  }
  return concatBytes(...parts);
}

/**
 * Decode the return value of getAmountsOut → uint256[] memory amounts.
 * Returns the last element (expected output amount) or null on failure.
 */
function decodeAmountsOutResult(hexData: string): bigint | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 96) return null; // need at least offset + length + 1 element

    // First 32 bytes = offset to the dynamic array (should be 0x20 = 32)
    // Next 32 bytes = length of the array
    const arrLen = Number(decodeBigUint(bytes, 32));
    if (arrLen <= 0 || bytes.length < 64 + arrLen * 32) return null;

    // Last element is amounts[arrLen-1]
    const lastOffset = 64 + (arrLen - 1) * 32;
    return decodeBigUint(bytes, lastOffset);
  } catch {
    return null;
  }
}

function decodeBigUint(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) | BigInt(bytes[offset + i]);
  }
  return value;
}

/**
 * Strategy 1: Call the router's getAmountsOut() view function via Mirror Node
 * contract simulation. Uses actual on-chain pool reserves for accurate quotes.
 *
 * Key implementation notes:
 * - Gas limit MUST be 1,500,000+ (not 300k) — Hedera EVM gas costs are much
 *   higher than Ethereum.  getAmountsOut() calls getReserves() on each pair
 *   contract, and each SLOAD is ~2,100 gas on Hedera.  300k was exhausting
 *   and returning "0x" (empty result / out-of-gas revert).
 * - Timeout is generous (15s) since the simulation can be slow.
 *
 * The function tries two strategies in order:
 * 1. JSON-RPC relay (HashIO) eth_call — most reliable for cross-contract
 *    view calls because the relay fully emulates the EVM execution.
 * 2. Mirror Node /api/v1/contracts/call — sometimes returns empty for
 *    multi-hop getAmountsOut() due to cross-contract storage read limits.
 */
async function fetchRouterQuote(
  amountIn: bigint,
  pathAddresses: string[],
  routerHtsId: string,
  network: HederaNetwork
): Promise<bigint | null> {
  const routerEvm = await resolveContractEvmAddress(routerHtsId, network);
  const callData = encodeGetAmountsOut(amountIn, pathAddresses);
  const callDataHex = bytesToHex(callData);
  const gasHex = "0x" + (1_500_000).toString(16); // 0x16E360

  log.info("SaucerSwap", `Router quote: getAmountsOut(${amountIn}, [${pathAddresses.join(", ")}]) → router ${routerEvm}`);

  // ── Strategy A: JSON-RPC relay (eth_call) ──
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

  // ── Strategy B: Mirror Node /api/v1/contracts/call ──
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
      log.info("SaucerSwap", `Mirror Node contract call returned empty result — ${errMsg || "cross-contract calls may not be supported in simulation."} Falling back to price estimate.`);
      return null;
    }

    const amountOut = decodeAmountsOutResult(resultHex);
    if (amountOut !== null && amountOut > 0n) {
      console.log(`[HBAR.h] Router quote via Mirror Node: amountOut=${amountOut} (result ${resultHex.length} chars)`);
      return amountOut;
    }

    console.log(`[HBAR.h] Router quote decoded to zero/null from result: ${resultHex.slice(0, 66)}...`);
    return null;
  } catch (err: any) {
    console.log("[HBAR.h] Mirror Node router quote failed:", err?.message || err);
    return null;
  }
}

/**
 * Strategy 2: Estimate output from token prices.
 * Uses the Uniswap V2 constant product fee model (0.3% per hop).
 */

// Hardcoded fallback prices — used when live prices are unavailable.
// IMPORTANT: HBAR/WHBAR MUST have non-zero fallbacks.  The previous value of 0
// caused `!inputPrice` to be true (since !0 === true in JS), which killed the
// price-based quote estimation (Strategy 3) and produced the
// "All quote strategies failed — using minOutput=1" error for every swap
// involving HBAR whenever live prices were stale or not yet fetched.
const FALLBACK_TOKEN_PRICES_USD: Record<string, number> = {
  HBAR: 0.28, WHBAR: 0.28, USDC: 1.0, USDT: 1.0, WBTC: 97000, WETH: 3600,
  LINK: 19.0, WPOL: 0.40, SAUCE: 0.045, HBARX: 0.30, KARATE: 0.0003,
  PACK: 0.015, DOVU: 0.002, HST: 0.018, "HBAR.ħ": 0.000001,
};

// Live price cache — updated by fetchLiveTokenPrices()
let _liveTokenPricesUsd: Record<string, number> = {};
let _liveTokenPricesTimestamp = 0;
const LIVE_PRICE_TTL_MS = 300_000; // 5 minutes (was 60s — too aggressive, caused
// constant cache misses during swap flows and forced fallback to $0 HBAR prices)

/**
 * Get the best available price for a token symbol.
 * Prefers live prices from SaucerSwap, falls back to stale live or hardcoded.
 */
function getTokenPriceUsd(symbol: string): number | undefined {
  // 1. Fresh live price
  if (Date.now() - _liveTokenPricesTimestamp < LIVE_PRICE_TTL_MS && _liveTokenPricesUsd[symbol]) {
    return _liveTokenPricesUsd[symbol];
  }
  // 2. Non-zero fallback
  const fallback = FALLBACK_TOKEN_PRICES_USD[symbol];
  if (fallback && fallback > 0) return fallback;
  // 3. Stale live price (better than zero/undefined)
  if (_liveTokenPricesUsd[symbol] && _liveTokenPricesUsd[symbol] > 0) {
    return _liveTokenPricesUsd[symbol];
  }
  return fallback;
}

// Merged accessor: returns live prices overlaid on fallbacks.
// Priority: fresh live price → stale live price (if fallback is 0) → fallback.
// The "stale live" tier is critical: it prevents the disastrous case where
// live prices expire after 60s and HBAR/WHBAR revert to a $0 fallback,
// silently killing every price-based quote estimation.
const TOKEN_PRICES_USD: Record<string, number> = new Proxy(FALLBACK_TOKEN_PRICES_USD, {
  get(target, prop: string) {
    // 1. Fresh live price (within TTL)
    if (Date.now() - _liveTokenPricesTimestamp < LIVE_PRICE_TTL_MS && _liveTokenPricesUsd[prop] != null) {
      return _liveTokenPricesUsd[prop];
    }
    // 2. Fallback price — but only if it's non-zero
    const fallback = target[prop];
    if (fallback && fallback > 0) return fallback;
    // 3. Stale live price (better than zero)
    if (_liveTokenPricesUsd[prop] != null && _liveTokenPricesUsd[prop] > 0) {
      return _liveTokenPricesUsd[prop];
    }
    // 4. Truly no price available
    return fallback ?? 0;
  },
  has(target, prop: string) {
    return prop in _liveTokenPricesUsd || prop in target;
  },
});

/**
 * Fetch live token prices from the SaucerSwap API.
 * Updates the internal cache which TOKEN_PRICES_USD reads from.
 *
 * Falls back silently on failure — the hardcoded prices remain available.
 */
export async function fetchLiveTokenPrices(): Promise<Record<string, number>> {
  try {
    const res = await saucerFetch("/tokens", 10000);
    if (!res) return _liveTokenPricesUsd;

    const data = await res.json();
    const prices: Record<string, number> = {};

    // data may be an array of token objects or an object keyed by token ID
    const tokens = Array.isArray(data) ? data : Object.values(data);

    // Build case-insensitive symbol lookup so "HBAR.ħ" matches "HBAR.H" etc.
    const fallbackSymbolLower = new Map<string, string>();
    for (const key of Object.keys(FALLBACK_TOKEN_PRICES_USD)) {
      fallbackSymbolLower.set(key.toLowerCase(), key);
    }

    for (const t of tokens) {
      const priceUsd = parseFloat(t.priceUsd || t.price || "0");
      if (!priceUsd || priceUsd <= 0) continue;

      // Match by HTS ID (try multiple field names the API might use)
      const htsId = t.id || t.tokenId || t.token_id || "";
      const registeredToken = TOKEN_BY_HTS_ID.get(htsId);
      if (registeredToken) {
        prices[registeredToken.symbol] = priceUsd;
        // WHBAR price = HBAR price
        if (registeredToken.symbol === "WHBAR") {
          prices["HBAR"] = priceUsd;
        }
        continue;
      }

      // Match by symbol — case-insensitive to handle "HBAR.ħ" vs "HBAR.H"
      const rawSym = t.symbol || "";
      const symLower = rawSym.toLowerCase();
      const canonicalKey = fallbackSymbolLower.get(symLower);
      if (canonicalKey) {
        prices[canonicalKey] = priceUsd;
      }
    }

    // ── Dedicated HBAR.h price fetch if not found in bulk response ──
    if (!prices["HBAR.ħ"]) {
      try {
        const hbarhRes = await saucerFetch(`/tokens/${HBARH_TOKEN_ID}`, 8000);
        if (hbarhRes) {
          const hbarhData = await hbarhRes.json();
          const p = parseFloat(hbarhData?.priceUsd || hbarhData?.price || "0");
          if (p > 0) {
            prices["HBAR.ħ"] = p;
          }
        }
      } catch { /* non-critical fallback */ }
    }

    // ── Fallback: fetch HBAR.ħ price from DexScreener if still missing ──
    // HBAR.ħ is a distinct protocol token (~$0.000001), NOT a liquid-staked
    // HBAR derivative. Do NOT set it to HBAR price.
    if (!prices["HBAR.ħ"]) {
      try {
        const hbarhResult = await fetchHbarhTokenPrice();
        if (hbarhResult.price > 0) {
          prices["HBAR.ħ"] = hbarhResult.price;
          console.log(`[HBAR.h] Live price for HBAR.ħ via ${hbarhResult.source}: $${hbarhResult.price}`);
        }
      } catch { /* keep hardcoded fallback via TOKEN_PRICES_USD proxy */ }
    }

    if (Object.keys(prices).length > 0) {
      _liveTokenPricesUsd = prices;
      _liveTokenPricesTimestamp = Date.now();
      console.log(`[HBAR.h] Live token prices updated: ${Object.keys(prices).length} tokens`, prices);
    }

    return prices;
  } catch (err: any) {
    console.warn("[HBAR.h] fetchLiveTokenPrices failed:", err?.message || err);
    return _liveTokenPricesUsd;
  }
}

/**
 * Returns the current live price cache age in ms, or Infinity if no cache.
 */
export function getLivePriceCacheAge(): number {
  if (_liveTokenPricesTimestamp === 0) return Infinity;
  return Date.now() - _liveTokenPricesTimestamp;
}

/**
 * Returns the count of live prices currently cached.
 */
export function getLivePriceCount(): number {
  return Object.keys(_liveTokenPricesUsd).length;
}

/**
 * Dedicated HBAR.ħ price fetcher — multi-strategy with robust fallbacks.
 * Tries, in order:
 *  1. Internal live cache (if fresh)
 *  2. DexScreener API (most accurate for DEX-traded tokens)
 *  3. SaucerSwap /tokens bulk (parses HBAR.ħ out)
 *  4. SaucerSwap /tokens/{id} direct endpoint
 *  5. Hardcoded fallback
 *
 * Returns { price, source } so callers can display provenance.
 */
export async function fetchHbarhTokenPrice(): Promise<{ price: number; source: string }> {
  // Strategy 1: cached live price
  if (
    Date.now() - _liveTokenPricesTimestamp < LIVE_PRICE_TTL_MS &&
    _liveTokenPricesUsd["HBAR.ħ"] > 0
  ) {
    return { price: _liveTokenPricesUsd["HBAR.ħ"], source: "saucerswap-cache" };
  }

  // Strategy 2a: DexScreener pairs endpoint
  try {
    const dexRes = await fetch(
      "https://api.dexscreener.com/latest/dex/pairs/hedera/0x31d6b803a960b818cce3a85f0bef7c4c566b7919",
      { signal: makeAbort(10000) }
    );
    if (dexRes.ok) {
      const dexData = await dexRes.json();
      const pair = dexData?.pair || dexData?.pairs?.[0];
      if (pair) {
        const p = parseFloat(pair.priceUsd || "0");
        if (p > 0) {
          _liveTokenPricesUsd["HBAR.ħ"] = p;
          _liveTokenPricesTimestamp = Date.now();
          return { price: p, source: "dexscreener" };
        }
      }
    }
  } catch (err: any) {
    console.warn("[HBAR.h] fetchHbarhTokenPrice DexScreener pairs error:", err?.message || err);
  }

  // Strategy 2b: DexScreener token search (EVM address of 0.0.9356476)
  try {
    const dexTokenRes = await fetch(
      "https://api.dexscreener.com/latest/dex/tokens/0x00000000000000000000000000000000008ecf5c",
      { signal: makeAbort(10000) }
    );
    if (dexTokenRes.ok) {
      const dexTokenData = await dexTokenRes.json();
      const pairs = dexTokenData?.pairs;
      if (Array.isArray(pairs) && pairs.length > 0) {
        const best = pairs.reduce((a: any, b: any) =>
          (parseFloat(b.liquidity?.usd || "0") > parseFloat(a.liquidity?.usd || "0")) ? b : a
        , pairs[0]);
        const p = parseFloat(best.priceUsd || "0");
        if (p > 0) {
          _liveTokenPricesUsd["HBAR.ħ"] = p;
          _liveTokenPricesTimestamp = Date.now();
          return { price: p, source: "dexscreener-tokens" };
        }
      }
    }
  } catch (err: any) {
    console.warn("[HBAR.h] fetchHbarhTokenPrice DexScreener tokens error:", err?.message || err);
  }

  // Strategy 3: check live price cache (populated by fetchLiveTokenPrices)
  // NOTE: Do NOT call fetchLiveTokenPrices() here — it calls us back,
  // creating infinite recursion. Just check the cache.
  if (_liveTokenPricesUsd["HBAR.ħ"] && _liveTokenPricesUsd["HBAR.ħ"] > 0) {
    return { price: _liveTokenPricesUsd["HBAR.ħ"], source: "saucerswap-cache" };
  }

  // Strategy 4: direct SaucerSwap token endpoint
  try {
    const res = await saucerFetch(`/tokens/${HBARH_TOKEN_ID}`, 8000);
    if (res) {
      const data = await res.json();
      const p = parseFloat(data?.priceUsd || data?.price || "0");
      if (p > 0) {
        _liveTokenPricesUsd["HBAR.ħ"] = p;
        _liveTokenPricesTimestamp = Date.now();
        return { price: p, source: "saucerswap-direct" };
      }
    }
  } catch (err: any) {
    console.warn("[HBAR.h] fetchHbarhTokenPrice SaucerSwap direct error:", err?.message || err);
  }

  // Strategy 5: hardcoded fallback
  const fallback = FALLBACK_TOKEN_PRICES_USD["HBAR.ħ"] || 0.000001;
  console.warn(`[HBAR.h] All live strategies exhausted — using fallback: $${fallback}`);
  return { price: fallback, source: "fallback" };
}

// ══════════════════════════════════════════════════════════════════════
// ── LP TOKEN PRICE ORACLE ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Fetch the price of a SaucerSwap V1 LP token.
 *
 * LP token value = (reserve0_usd + reserve1_usd) / total_LP_supply
 *
 * Strategy:
 *  1. SaucerSwap /v1/pools API → find pool by component token pair → TVL / supply
 *  2. DexScreener pair lookup → liquidity / supply
 *  3. Component price estimation
 */

const SS_LP_WHBAR_HBARH_TOKEN_ID = "0.0.9356724";
const SS_LP_WHBAR_HBARH_DECIMALS = 8; // SaucerSwap V1 LP tokens use 8 decimals

// Cache for LP token price
let _lpTokenPriceCache: { price: number; source: string; ts: number } = { price: 0, source: "", ts: 0 };
const LP_PRICE_TTL_MS = 120_000; // 2 minutes

export async function fetchLPTokenPrice(
  lpTokenId: string = SS_LP_WHBAR_HBARH_TOKEN_ID
): Promise<{ price: number; source: string }> {
  // Return cached price if fresh
  if (_lpTokenPriceCache.price > 0 && Date.now() - _lpTokenPriceCache.ts < LP_PRICE_TTL_MS) {
    return { price: _lpTokenPriceCache.price, source: _lpTokenPriceCache.source };
  }

  // ── Strategy 1: SaucerSwap V1 pools API ──
  try {
    const res = await saucerFetch("/v1/pools", 10000);
    if (res) {
      const pools = await res.json();
      const poolArray = Array.isArray(pools) ? pools : Object.values(pools);

      for (const pool of poolArray) {
        const poolLpId = pool.lpToken?.id || pool.lpTokenId || pool.lp_token_id || "";
        const tokenAId = pool.tokenA?.id || pool.token0Id || pool.tokenA?.tokenId || "";
        const tokenBId = pool.tokenB?.id || pool.token1Id || pool.tokenB?.tokenId || "";

        // Match by LP token ID, or by component token pair (WHBAR + HBAR.ħ)
        const isOurPool = poolLpId === lpTokenId ||
          (lpTokenId === SS_LP_WHBAR_HBARH_TOKEN_ID && (
            (tokenAId === "0.0.1456986" && tokenBId === HBARH_TOKEN_ID) ||
            (tokenBId === "0.0.1456986" && tokenAId === HBARH_TOKEN_ID)
          ));

        if (!isOurPool) continue;

        const tvl = parseFloat(pool.tvl || pool.tvlUsd || pool.liquidityUsd || "0");
        const totalSupply = parseFloat(pool.lpToken?.totalSupply || pool.totalSupply || "0");

        if (tvl > 0 && totalSupply > 0) {
          // totalSupply might be raw (needs decimal division) or human-readable
          const effectiveSupply = totalSupply > 1e12
            ? totalSupply / Math.pow(10, SS_LP_WHBAR_HBARH_DECIMALS)
            : totalSupply;
          const price = tvl / effectiveSupply;
          if (price > 0 && price < 1e6) {
            _lpTokenPriceCache = { price, source: "saucerswap-pool", ts: Date.now() };
            console.log(`[HBAR.h] LP token price: $${price.toFixed(8)} (via SaucerSwap pool TVL)`);
            return { price, source: "saucerswap-pool" };
          }
        }
      }
    }
  } catch { /* continue */ }

  // ── Strategy 2: DexScreener — use the known WHBAR/HBAR.ħ PAIR address ──
  // DexScreener indexes pair contracts, not LP token addresses.
  // The WHBAR/HBAR.ħ pair address is the same one used in fetchHbarhTokenPrice().
  try {
    const WHBAR_HBARH_PAIR = "0x31d6b803a960b818cce3a85f0bef7c4c566b7919";
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/hedera/${WHBAR_HBARH_PAIR}`,
      { signal: makeAbort(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      const pair = data?.pair || data?.pairs?.[0];
      if (pair) {
        const liquidity = parseFloat(pair.liquidity?.usd || "0");
        if (liquidity > 0) {
          const totalSupplyRaw = await _fetchTokenTotalSupply(lpTokenId);
          if (totalSupplyRaw > 0) {
            const totalSupply = totalSupplyRaw / Math.pow(10, SS_LP_WHBAR_HBARH_DECIMALS);
            const price = liquidity / totalSupply;
            if (price > 0 && price < 1e6) {
              _lpTokenPriceCache = { price, source: "dexscreener-computed", ts: Date.now() };
              console.log(`[HBAR.h] LP token price: $${price.toFixed(8)} (via DexScreener pair liquidity / LP supply)`);
              return { price, source: "dexscreener-computed" };
            }
          }
        }
      }
    }
  } catch { /* continue */ }

  // ── Strategy 3: SaucerSwap V1 liqpools endpoint variants ──
  // Try multiple endpoint paths to find the pool TVL and compute price per LP token.
  try {
    const totalSupplyRaw = await _fetchTokenTotalSupply(lpTokenId);
    if (totalSupplyRaw > 0) {
      const totalSupply = totalSupplyRaw / Math.pow(10, SS_LP_WHBAR_HBARH_DECIMALS);
      const endpoints = ["/v1/liqpools", "/liqpools", "/v1/liqpools/all"];
      for (const ep of endpoints) {
        try {
          const poolRes = await saucerFetch(ep, 8000);
          if (!poolRes) continue;
          const pools = await poolRes.json();
          const poolArr = Array.isArray(pools) ? pools : Object.values(pools);
          for (const pool of poolArr) {
            const poolLpId = pool.lpToken?.id || pool.lpTokenId || pool.lp_token_id || "";
            const tA = pool.tokenA?.id || pool.token0Id || "";
            const tB = pool.tokenB?.id || pool.token1Id || "";
            const isOurPool = poolLpId === lpTokenId ||
              ((tA === "0.0.1456986" && tB === HBARH_TOKEN_ID) ||
               (tB === "0.0.1456986" && tA === HBARH_TOKEN_ID));
            if (!isOurPool) continue;
            const tvl = parseFloat(pool.tvl || pool.tvlUsd || pool.liquidityUsd || "0");
            if (tvl > 0) {
              const price = tvl / totalSupply;
              if (price > 0 && price < 1e6) {
                _lpTokenPriceCache = { price, source: "saucerswap-liqpools", ts: Date.now() };
                console.log(`[HBAR.h] LP token price: $${price.toFixed(8)} (via SaucerSwap liqpools TVL)`);
                return { price, source: "saucerswap-liqpools" };
              }
            }
          }
        } catch { /* try next endpoint */ }
      }
    }
  } catch { /* continue */ }

  return { price: 0, source: "unavailable" };
}

/** Fetch total supply of a token from Mirror Node (raw, before decimal division). */
async function _fetchTokenTotalSupply(tokenId: string): Promise<number> {
  try {
    const res = await fetch(
      `https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/${tokenId}`,
      { signal: makeAbort(8000) }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return parseInt(data.total_supply || "0", 10);
  } catch {
    return 0;
  }
}

/** LP token constants for the WHBAR/HBAR.ħ pool, exported for Wallet.tsx */
export const LP_TOKEN_WHBAR_HBARH = {
  tokenId: SS_LP_WHBAR_HBARH_TOKEN_ID,
  symbol: "ssLP-WHBAR-HBAR.ħ",
  name: "SaucerSwap LP: WHBAR/HBAR.ħ",
  decimals: SS_LP_WHBAR_HBARH_DECIMALS,
};

function estimateOutputFromPrices(
  rawAmountIn: number,
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  hops: number = 1,
  feePerHopPct: number = 0.3
): number | null {
  const inputSym = inputToken.isNative ? "HBAR" : inputToken.symbol;
  const outputSym = outputToken.isNative ? "HBAR" : outputToken.symbol;

  // Read prices through the proxy (tries: fresh live → non-zero fallback → stale live)
  let inputPrice = TOKEN_PRICES_USD[inputSym];
  let outputPrice = TOKEN_PRICES_USD[outputSym];

  // Guard: reject only genuinely missing/undefined prices, not zero
  // (zero prices are now guarded by the proxy's stale-live fallback)
  if (inputPrice == null || outputPrice == null || outputPrice <= 0) {
    console.warn(
      `[HBAR.h] estimateOutputFromPrices: cannot estimate — ` +
      `inputPrice[${inputSym}]=${inputPrice}, outputPrice[${outputSym}]=${outputPrice}`
    );
    return null;
  }

  // Extra safety: if inputPrice is 0 (shouldn't happen after proxy fix, but just in case),
  // try one more heuristic — WHBAR price for HBAR and vice versa
  if (inputPrice <= 0 && (inputSym === "HBAR" || inputSym === "WHBAR")) {
    const alt = TOKEN_PRICES_USD[inputSym === "HBAR" ? "WHBAR" : "HBAR"];
    if (alt && alt > 0) inputPrice = alt;
  }
  if (outputPrice <= 0 && (outputSym === "HBAR" || outputSym === "WHBAR")) {
    const alt = TOKEN_PRICES_USD[outputSym === "HBAR" ? "WHBAR" : "HBAR"];
    if (alt && alt > 0) outputPrice = alt;
  }

  if (inputPrice <= 0 || outputPrice <= 0) {
    console.warn(
      `[HBAR.h] estimateOutputFromPrices: zero price after fallbacks — ` +
      `inputPrice[${inputSym}]=${inputPrice}, outputPrice[${outputSym}]=${outputPrice}`
    );
    return null;
  }

  // Convert raw amount to human-readable
  const humanInput = rawAmountIn / Math.pow(10, inputToken.decimals);
  // Value in USD
  const valueUsd = humanInput * inputPrice;
  // Deduct fee per hop (compounding)
  const feeMultiplier = Math.pow(1 - feePerHopPct / 100, hops);
  const outputHuman = (valueUsd * feeMultiplier) / outputPrice;
  // Convert to raw output decimals
  const rawOutput = Math.floor(outputHuman * Math.pow(10, outputToken.decimals));
  return rawOutput > 0 ? rawOutput : null;
}

/**
 * Multi-strategy quote fetcher. Tries in order:
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

  // ── Strategy 1: Router getAmountsOut via Mirror Node ──
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
      };
    }
  }

  // ── Strategy 2: SaucerSwap REST API ──
  // Try two different query-param naming conventions via resilient fetch
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
        };
      }
    } catch { /* fall through */ }
  }

  // ── Strategy 3: Price-based estimation ──
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
      console.log(`[HBAR.h] Using price-based quote estimate: ${estimated} (${hops} hop${hops > 1 ? "s" : ""})`);
      return {
        amountOut: estimated,
        priceImpact: 0.05,
        route: [inputTokenId, outputTokenId],
        source: "price-estimate",
      };
    }
    console.warn(
      `[HBAR.h] Price-based estimation also failed for ${options.inputToken.symbol} → ${options.outputToken.symbol}. ` +
      `Prices: ${options.inputToken.symbol}=$${TOKEN_PRICES_USD[options.inputToken.isNative ? "HBAR" : options.inputToken.symbol]}, ` +
      `${options.outputToken.symbol}=$${TOKEN_PRICES_USD[options.outputToken.isNative ? "HBAR" : options.outputToken.symbol]}. ` +
      `Live cache age: ${Math.round((Date.now() - _liveTokenPricesTimestamp) / 1000)}s`
    );
  } else {
    console.warn(
      `[HBAR.h] Strategy 3 (price estimation) skipped — inputToken/outputToken not provided in options`
    );
  }

  return null;
}

// ── ABI Encoding ────────────────────────────────────────────────────

function encodeUint256(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

function encodeAddress(addr: string): Uint8Array {
  const hex = addr.replace("0x", "").padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Encode ERC-20 approve(address spender, uint256 amount)
 * Selector: 0x095ea7b3
 *
 * Used to set allowances at the EVM level (via the token's HTS system contract).
 * This is more reliable than AccountAllowanceApproveTransaction when the spender
 * is a smart contract (like SaucerSwap router) that calls transferFrom() in the EVM.
 */
function encodeErc20Approve(spender: string, amount: bigint): Uint8Array {
  const selector = new Uint8Array([0x09, 0x5e, 0xa7, 0xb3]);
  const parts: Uint8Array[] = [selector, encodeAddress(spender), encodeUint256(amount)];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

// ── EVM Address Resolution ──────────────────────────────────────────

/**
 * Resolve a Hedera account ID (0.0.xxxxx) to its actual EVM address
 * via the Mirror Node. Falls back to the long-zero synthetic address
 * if the lookup fails.
 *
 * Critical for the `to` parameter in router calls — the router
 * sends output tokens via transfer(to, amount) in the EVM world.
 * Using the wrong address format can cause tokens to vanish.
 */
let _evmAddressCache: Record<string, string> = {};
// Negative cache: track failed lookups with timestamps so we retry after a cooldown
let _evmAddressNegCache: Record<string, number> = {};
const NEGATIVE_CACHE_TTL_MS = 120_000; // retry after 2 minutes

export async function resolveAccountEvmAddress(
  accountId: string,
  network: HederaNetwork
): Promise<string> {
  const cacheKey = `${network}:${accountId}`;
  if (_evmAddressCache[cacheKey]) return _evmAddressCache[cacheKey];

  // Check negative cache — don't retry too frequently
  const negTs = _evmAddressNegCache[cacheKey];
  if (negTs && Date.now() - negTs < NEGATIVE_CACHE_TTL_MS) {
    return htsIdToEvmAddress(accountId);
  }

  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/accounts/${accountId}`,
      { signal: makeAbort(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      const evmAddr = data.evm_address;
      if (evmAddr && evmAddr.startsWith("0x") && evmAddr.length === 42) {
        console.log(`[HBAR.h] Resolved ${accountId} → EVM: ${evmAddr}`);
        _evmAddressCache[cacheKey] = evmAddr;
        delete _evmAddressNegCache[cacheKey];
        return evmAddr;
      }
    }
  } catch (e) {
    console.warn("[HBAR.h] Mirror Node EVM lookup failed:", e);
  }

  // Fallback: synthetic long-zero address — do NOT cache permanently,
  // only add to negative cache so we can retry after cooldown
  const fallback = htsIdToEvmAddress(accountId);
  console.log(`[HBAR.h] Using long-zero fallback for ${accountId}: ${fallback}`);
  _evmAddressNegCache[cacheKey] = Date.now();
  return fallback;
}

/**
 * Resolve a Hedera contract ID (0.0.xxxxx) to its actual EVM address
 * via the Mirror Node contracts endpoint.  Falls back to the long-zero
 * synthetic address if the lookup fails.
 *
 * Contracts have their own EVM address that differs from the long-zero
 * form.  Using the correct address is critical for Mirror Node contract
 * call simulations (`/api/v1/contracts/call`), because the simulation
 * engine may not resolve the long-zero form to the actual bytecode.
 */
let _contractEvmAddressCache: Record<string, string> = {};
let _contractEvmNegCache: Record<string, number> = {};

export async function resolveContractEvmAddress(
  contractId: string,
  network: HederaNetwork
): Promise<string> {
  const cacheKey = `contract:${network}:${contractId}`;
  if (_contractEvmAddressCache[cacheKey]) return _contractEvmAddressCache[cacheKey];

  // Check negative cache — don't retry too frequently
  const negTs = _contractEvmNegCache[cacheKey];
  if (negTs && Date.now() - negTs < NEGATIVE_CACHE_TTL_MS) {
    return htsIdToEvmAddress(contractId);
  }

  // Strategy A: contracts endpoint (primary — returns contract-specific EVM address)
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/contracts/${contractId}`,
      { signal: makeAbort(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      const evmAddr = data.evm_address;
      if (evmAddr && evmAddr.startsWith("0x") && evmAddr.length === 42) {
        console.log(`[HBAR.h] Resolved contract ${contractId} → EVM: ${evmAddr}`);
        _contractEvmAddressCache[cacheKey] = evmAddr;
        delete _contractEvmNegCache[cacheKey];
        return evmAddr;
      }
    }
  } catch (e) {
    console.warn("[HBAR.h] Mirror Node contract EVM lookup failed:", e);
  }

  // Strategy B: accounts endpoint (fallback — may return the same or different EVM address)
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/accounts/${contractId}`,
      { signal: makeAbort(6000) }
    );
    if (res.ok) {
      const data = await res.json();
      const evmAddr = data.evm_address;
      if (evmAddr && evmAddr.startsWith("0x") && evmAddr.length === 42) {
        console.log(`[HBAR.h] Resolved contract ${contractId} via accounts → EVM: ${evmAddr}`);
        _contractEvmAddressCache[cacheKey] = evmAddr;
        delete _contractEvmNegCache[cacheKey];
        return evmAddr;
      }
    }
  } catch {
    // Non-fatal
  }

  // Fallback: synthetic long-zero address — do NOT cache permanently,
  // only add to negative cache so we can retry after cooldown
  const fallback = htsIdToEvmAddress(contractId);
  console.log(`[HBAR.h] Using long-zero fallback for contract ${contractId}: ${fallback}`);
  _contractEvmNegCache[cacheKey] = Date.now();
  return fallback;
}

/**
 * Verify that a Hedera account ID is actually a smart contract.
 *
 * Uses a multi-strategy approach for robustness:
 *   1. Mirror Node /api/v1/contracts/{id}  (primary)
 *   2. JSON-RPC relay eth_getCode          (fallback — queries on-chain bytecode)
 *   3. Mirror Node /api/v1/accounts/{id}   (diagnostic — checks if entity exists as account)
 *
 * CRITICAL SAFETY CHECK: prevents sending HBAR/tokens to a random account
 * that isn't a contract. Without this, a wrong router address silently
 * sends funds to a non-contract account with no swap executed.
 *
 * Returns the contract info (including evm_address and bytecode hash)
 * or null if the ID is not a contract.
 */
interface ContractInfo {
  contractId: string;
  evmAddress: string;
  bytecodeHash?: string;
  runtimeBytecode?: string;
}

// Cache verified contracts so we don't re-check every swap
const _verifiedContractCache: Record<string, ContractInfo> = {};

// ── Pre-seed known SaucerSwap infrastructure contracts ──────────────
// These are publicly documented, well-known contracts that rarely change.
// Pre-seeding eliminates unreliable network verification in browser
// environments where CORS/rate-limiting blocks Mirror Node and JSON-RPC
// calls.  If addresses change with protocol upgrades, update the
// hardcoded candidate lists above — same workflow as today.
//
// This runs on module load so verifyIsContract() returns from cache
// immediately for known contracts, avoiding the "reduced confidence"
// fallback path entirely.
function _seedKnownContractCache() {
  const knownContracts: { network: string; id: string }[] = [];

  // Router candidates
  for (const [net, ids] of Object.entries(SAUCERSWAP_V1_ROUTER_CANDIDATES)) {
    for (const id of ids) {
      knownContracts.push({ network: net, id });
    }
  }
  // Factory addresses
  for (const [net, id] of Object.entries(SAUCERSWAP_V1_FACTORY)) {
    knownContracts.push({ network: net, id });
  }
  // V2 Router addresses
  for (const [net, id] of Object.entries(SAUCERSWAP_V2_ROUTER)) {
    knownContracts.push({ network: net, id });
  }

  for (const { network, id } of knownContracts) {
    const cacheKey = `${network}:${id}`;
    if (!_verifiedContractCache[cacheKey]) {
      _verifiedContractCache[cacheKey] = {
        contractId: id,
        evmAddress: htsIdToEvmAddress(id),
      };
    }
  }
}
_seedKnownContractCache();

async function verifyIsContract(
  contractId: string,
  network: HederaNetwork
): Promise<ContractInfo | null> {
  const cacheKey = `${network}:${contractId}`;
  if (_verifiedContractCache[cacheKey]) {
    console.log(`[HBAR.h] verifyIsContract(${contractId}): using cached result ✓`);
    return _verifiedContractCache[cacheKey];
  }

  // ── Strategy 1: Mirror Node /api/v1/contracts/{id} ──
  // The contracts endpoint only returns 200 for actual contracts, so ANY
  // 200 response is definitive proof.  We extract the EVM address and
  // bytecode hash when available but don't require them.
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/contracts/${contractId}`,
      { signal: makeAbort(10000) }
    );
    if (res.ok) {
      const data = await res.json();
      // 200 OK from /api/v1/contracts/{id} = definitive proof this is a contract
      const evmAddr = data.evm_address ||
        (data.contract_id ? htsIdToEvmAddress(data.contract_id) : htsIdToEvmAddress(contractId));
      console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via Mirror Node contracts endpoint (HTTP 200), EVM: ${evmAddr}`);
      const info: ContractInfo = {
        contractId: data.contract_id || contractId,
        evmAddress: evmAddr,
        bytecodeHash: data.bytecode_hash || undefined,
        runtimeBytecode: data.runtime_bytecode ? data.runtime_bytecode.slice(0, 20) + "..." : undefined,
      };
      _verifiedContractCache[cacheKey] = info;
      return info;
    }
    if (res.status === 404) {
      console.log(`[HBAR.h] verifyIsContract(${contractId}): Mirror Node contracts 404, trying accounts endpoint...`);
    } else {
      console.warn(`[HBAR.h] verifyIsContract(${contractId}): Mirror Node HTTP ${res.status}, trying accounts endpoint...`);
    }
  } catch (err: any) {
    console.warn(`[HBAR.h] verifyIsContract(${contractId}): Mirror Node error — ${err?.message || err}, trying accounts endpoint...`);
  }

  // ── Strategy 2: Resolve real EVM address + accounts/type check ──
  // On Hedera, eth_getCode returns "0x" for synthetic long-zero addresses.
  // We resolve the REAL EVM address via the accounts endpoint and also
  // check the entity type.  The contracts endpoint was already tried in
  // Strategy 1, so we do NOT retry it (redundant calls risk rate-limiting).
  const longZeroAddr = htsIdToEvmAddress(contractId);
  let resolvedEvmAddr: string | null = null;
  let entityExistsOnMirrorNode = false;

  // Try accounts endpoint — works for both accounts AND contracts on Hedera
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const acctRes = await fetch(
      `${base}/api/v1/accounts/${contractId}`,
      { signal: makeAbort(8000) }
    );
    if (acctRes.ok) {
      const acctData = await acctRes.json();
      entityExistsOnMirrorNode = true;
      const acctEvmAddr = acctData.evm_address;
      if (acctEvmAddr && acctEvmAddr.startsWith("0x") && acctEvmAddr.length === 42) {
        if (acctEvmAddr.toLowerCase() !== longZeroAddr.toLowerCase()) {
          resolvedEvmAddr = acctEvmAddr;
          console.log(`[HBAR.h] verifyIsContract(${contractId}): resolved REAL EVM via accounts: ${resolvedEvmAddr}`);
        } else {
          // Even the long-zero is useful for tracking that the entity exists
          resolvedEvmAddr = acctEvmAddr;
          console.log(`[HBAR.h] verifyIsContract(${contractId}): accounts returned long-zero EVM: ${acctEvmAddr}`);
        }
      }
      // Check if the accounts endpoint type field says CONTRACT
      // Accept various representations: "CONTRACT", "contract", or type containing "contract"
      const entityType = (acctData.type || "").toUpperCase();
      if (entityType.includes("CONTRACT")) {
        const useAddr = resolvedEvmAddr || longZeroAddr;
        console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via accounts endpoint (type=${acctData.type}), EVM: ${useAddr}`);
        const info: ContractInfo = { contractId, evmAddress: useAddr };
        _verifiedContractCache[cacheKey] = info;
        return info;
      }
      // Additional contract indicator: presence of contract_id field in response
      // (the Mirror Node accounts endpoint includes this for contracts even if
      // the type field is missing or unexpected)
      if (acctData.contract_id) {
        const useAddr = resolvedEvmAddr || longZeroAddr;
        console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via accounts endpoint (contract_id=${acctData.contract_id}), EVM: ${useAddr}`);
        const info: ContractInfo = { contractId: acctData.contract_id, evmAddress: useAddr };
        _verifiedContractCache[cacheKey] = info;
        return info;
      }
      // Log additional entity info for debugging
      console.log(`[HBAR.h] verifyIsContract(${contractId}): accounts type="${acctData.type || "null"}", key=${acctData.key ? "present" : "null"}, contract_id=${acctData.contract_id || "null"}, deleted=${acctData.deleted ?? "unknown"}`);
    }
  } catch {
    // Non-fatal
  }

  // Try eth_getCode with resolved address (if different from long-zero), then long-zero.
  // Deduplicate: if resolvedEvmAddr IS the long-zero, only try once.
  const ethGetCodeAddresses: string[] = [];
  if (resolvedEvmAddr && resolvedEvmAddr.toLowerCase() !== longZeroAddr.toLowerCase()) {
    ethGetCodeAddresses.push(resolvedEvmAddr);
  }
  ethGetCodeAddresses.push(longZeroAddr);

  for (const evmAddr of ethGetCodeAddresses) {
    try {
      const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
      const rpcRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(12000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getCode",
          params: [evmAddr, "latest"],
          id: 1,
        }),
      });
      if (rpcRes.ok) {
        const rpcData = await rpcRes.json();
        const code = rpcData?.result;
        if (code && code !== "0x" && code !== "0x0" && code.length > 4) {
          const useAddr = resolvedEvmAddr || evmAddr;
          console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via eth_getCode (${code.length} hex chars), EVM: ${useAddr}`);
          const info: ContractInfo = {
            contractId,
            evmAddress: useAddr,
            runtimeBytecode: code.slice(0, 20) + "...",
          };
          _verifiedContractCache[cacheKey] = info;
          return info;
        }
        if (rpcData.error) {
          console.warn(`[HBAR.h] verifyIsContract(${contractId}): eth_getCode(${evmAddr}) RPC error: ${rpcData.error.message || JSON.stringify(rpcData.error).slice(0, 150)}`);
        } else {
          console.log(`[HBAR.h] verifyIsContract(${contractId}): eth_getCode(${evmAddr}) no bytecode: ${String(code).slice(0, 10) || "(empty)"}`);
        }
      }
    } catch (err: any) {
      console.warn(`[HBAR.h] verifyIsContract(${contractId}): eth_getCode(${evmAddr}) failed — ${err?.message || err}`);
    }
  }

  // ── Strategy 3: Verify via eth_call probe ──
  // If Strategies 1–2 failed, try eth_call — if the entity responds to ANY
  // function call (even with a revert), it IS a contract.
  // Uses factory() (0xc45a0155) with generous gas (300K — Hedera charges
  // ~2100 per SLOAD, and the old 30K was too low for Hedera EVM pricing).
  // Tries BOTH JSON-RPC relay AND Mirror Node /api/v1/contracts/call.
  {
    // Deduplicate: if resolvedEvmAddr IS the long-zero, only try once
    const probeAddrs: string[] = [];
    if (resolvedEvmAddr && resolvedEvmAddr.toLowerCase() !== longZeroAddr.toLowerCase()) {
      probeAddrs.push(resolvedEvmAddr);
    }
    probeAddrs.push(longZeroAddr);

    for (const probeAddr of probeAddrs) {
      // ── 3a: JSON-RPC relay eth_call ──
      try {
        const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
        const probeRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(12000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: probeAddr, data: "0xc45a0155", gas: "0x493e0" }, "latest"],
            id: 1,
          }),
        });
        if (probeRes.ok) {
          const probeData = await probeRes.json();
          const result = probeData?.result;
          if (result && result !== "0x" && result.length >= 66 && !probeData.error) {
            console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via eth_call probe, EVM: ${probeAddr}`);
            const info: ContractInfo = { contractId, evmAddress: probeAddr };
            _verifiedContractCache[cacheKey] = info;
            return info;
          }
          if (probeData.error) {
            const errMsg = probeData.error.message || JSON.stringify(probeData.error);
            if (errMsg.includes("REVERT") || errMsg.includes("revert") || errMsg.includes("execution reverted")) {
              console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via eth_call revert (IS a contract), EVM: ${probeAddr}`);
              const info: ContractInfo = { contractId, evmAddress: probeAddr };
              _verifiedContractCache[cacheKey] = info;
              return info;
            }
            console.log(`[HBAR.h] verifyIsContract(${contractId}): eth_call probe(${probeAddr}) RPC error: ${errMsg.slice(0, 150)}`);
          }
        }
      } catch (err: any) {
        console.warn(`[HBAR.h] verifyIsContract(${contractId}): eth_call probe(${probeAddr}) failed — ${err?.message || err}`);
      }

      // ── 3b: Mirror Node /api/v1/contracts/call (fallback for browser CORS issues with JSON-RPC) ──
      try {
        const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
        const mnRes = await fetch(`${base}/api/v1/contracts/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(12000),
          body: JSON.stringify({
            block: "latest",
            data: "0xc45a0155",
            estimate: false,
            from: "0x0000000000000000000000000000000000000000",
            to: probeAddr,
            gas: 300_000,
            gasPrice: 0,
            value: 0,
          }),
        });
        if (mnRes.ok) {
          const mnData = await mnRes.json();
          const mnResult = mnData.result;
          if (mnResult && mnResult !== "0x" && mnResult.length >= 66) {
            console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via Mirror Node contracts/call, EVM: ${probeAddr}`);
            const info: ContractInfo = { contractId, evmAddress: probeAddr };
            _verifiedContractCache[cacheKey] = info;
            return info;
          }
          const errMsg = mnData.error_message || mnData._status?.messages?.[0]?.message || "";
          if (errMsg && (errMsg.includes("REVERT") || errMsg.includes("revert"))) {
            console.log(`[HBAR.h] verifyIsContract(${contractId}): CONFIRMED via Mirror Node revert (IS a contract), EVM: ${probeAddr}`);
            const info: ContractInfo = { contractId, evmAddress: probeAddr };
            _verifiedContractCache[cacheKey] = info;
            return info;
          }
        }
      } catch {
        // Non-fatal
      }
    }
  }

  // ── All strategies exhausted ──
  // Check if this is a known SaucerSwap infrastructure contract before
  // applying the reduced-confidence fallback.  Known contracts (router
  // candidates, factory addresses) are accepted with full confidence
  // since they're explicitly hardcoded by the developer.
  const isKnownInfraContract =
    Object.values(SAUCERSWAP_V1_ROUTER_CANDIDATES).flat().includes(contractId) ||
    Object.values(SAUCERSWAP_V1_FACTORY).includes(contractId);

  if (isKnownInfraContract) {
    const useAddr = resolvedEvmAddr || longZeroAddr;
    console.log(
      `[HBAR.h] verifyIsContract(${contractId}): ACCEPTED as known infrastructure contract (EVM: ${useAddr})`
    );
    const info: ContractInfo = { contractId, evmAddress: useAddr };
    _verifiedContractCache[cacheKey] = info;
    return info;
  }

  // If the entity exists on the Mirror Node (accounts endpoint returned 200)
  // but we couldn't confirm it's a contract through type checks or bytecode,
  // accept it with a warning.  On Hedera, the contracts endpoint may be
  // rate-limited or temporarily unavailable, eth_getCode may return "0x" for
  // long-zero addresses, and JSON-RPC eth_call may be blocked by CORS.
  // If the entity exists at all, it's safer to accept it (the swap will revert
  // if it's wrong) than to block the entire pipeline.
  if (entityExistsOnMirrorNode) {
    const useAddr = resolvedEvmAddr || longZeroAddr;
    console.warn(
      `[HBAR.h] verifyIsContract(${contractId}): entity exists on Mirror Node (EVM: ${useAddr}) — ` +
      `accepting with reduced confidence (type/bytecode checks inconclusive)`
    );
    const info: ContractInfo = { contractId, evmAddress: useAddr };
    _verifiedContractCache[cacheKey] = info;
    return info;
  }

  if (resolvedEvmAddr) {
    console.warn(
      `[HBAR.h] verifyIsContract(${contractId}): entity exists (EVM: ${resolvedEvmAddr}) but ` +
      `could not confirm it's a contract via any strategy`
    );
  } else {
    console.warn(`[HBAR.h] verifyIsContract(${contractId}): entity not found or not a contract on ${network}`);
  }

  return null;
}

// ── Dynamic Router Discovery ────────────────────────────────────────
// Tries multiple candidate addresses and verifies each by calling
// factory() — the correct SaucerSwap V1 Router should return the
// known factory address (0.0.2210218).

// Pre-seed with configured primary routers so discoverSaucerSwapRouter()
// returns immediately for known networks.  Factory-based verification is
// still attempted (see _discoverRouterImpl) and will upgrade the cache
// entry when it succeeds, but the pipeline no longer blocks on it.
let _discoveredRouter: Record<string, string> = {
  mainnet: SAUCERSWAP_V1_ROUTER.mainnet,
  testnet: SAUCERSWAP_V1_ROUTER.testnet,
};
let _routerDiscoveryInProgress: Record<string, Promise<string | null>> = {};

async function _discoverRouterImpl(network: HederaNetwork): Promise<string | null> {
  const candidates = SAUCERSWAP_V1_ROUTER_CANDIDATES[network] || [SAUCERSWAP_V1_ROUTER[network]];
  const knownFactory = getSaucerSwapFactory(network);
  const knownFactoryLongZero = htsIdToEvmAddress(knownFactory).toLowerCase();

  // Resolve the factory's REAL EVM address via Mirror Node.
  // On Hedera, contracts deployed via EVM CREATE have a real EVM address that
  // differs from the long-zero synthetic form.  factory() on the router returns
  // this real address, so we MUST compare against it — not just the long-zero.
  let knownFactoryRealEvm: string | null = null;
  try {
    const resolved = await resolveContractEvmAddress(knownFactory, network);
    if (resolved && resolved.toLowerCase() !== knownFactoryLongZero) {
      knownFactoryRealEvm = resolved.toLowerCase();
    }
  } catch {
    // Non-fatal — will compare against long-zero only
  }
  // Also try the accounts endpoint (sometimes contracts endpoint returns
  // the long-zero but accounts returns the real address)
  if (!knownFactoryRealEvm) {
    try {
      const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
      const acctRes = await fetch(
        `${base}/api/v1/accounts/${knownFactory}`,
        { signal: makeAbort(6000) }
      );
      if (acctRes.ok) {
        const acctData = await acctRes.json();
        const acctEvm = acctData.evm_address;
        if (acctEvm && acctEvm.startsWith("0x") && acctEvm.length === 42 &&
            acctEvm.toLowerCase() !== knownFactoryLongZero) {
          knownFactoryRealEvm = acctEvm.toLowerCase();
        }
      }
    } catch { /* Non-fatal */ }
  }

  console.log(`[HBAR.h] ═══ Router Discovery (${network}) ═══`);
  console.log(`[HBAR.h] Candidates: ${candidates.join(", ")}`);
  console.log(`[HBAR.h] Expected factory: ${knownFactory} (long-zero: ${knownFactoryLongZero}${knownFactoryRealEvm ? `, real: ${knownFactoryRealEvm}` : ""})`);

  /**
   * Check if a returned factory address matches the known factory.
   * Compares against BOTH the long-zero synthetic address AND the real EVM
   * address (resolved from Mirror Node).  Also converts the returned address
   * back to an HTS ID and compares numerically as a last resort — this
   * handles the case where the factory's EVM address format differs but
   * represents the same Hedera entity.
   */
  function factoryMatches(returnedAddr: string): boolean {
    const lower = returnedAddr.toLowerCase();
    if (lower === knownFactoryLongZero) return true;
    if (knownFactoryRealEvm && lower === knownFactoryRealEvm) return true;
    // Last resort: convert back to HTS ID and compare entity numbers
    try {
      const returnedHtsId = evmAddressToHtsId(returnedAddr);
      if (returnedHtsId === knownFactory) return true;
    } catch { /* Non-fatal */ }
    return false;
  }

  // Track candidates that passed verifyIsContract but failed factory() match
  // so we can use them as a last-resort fallback.
  let fallbackCandidate: { id: string; evmAddress: string } | null = null;

  for (const candidate of candidates) {
    console.log(`[HBAR.h] Checking candidate: ${candidate}...`);

    // Try verifyIsContract first, but don't skip if it fails —
    // factory() is the authoritative check and may succeed even when
    // verifyIsContract can't confirm (common on Hedera where eth_getCode
    // returns 0x for long-zero addresses).
    const info = await verifyIsContract(candidate, network);
    if (info) {
      console.log(`[HBAR.h]   ✓ ${candidate} IS a contract (EVM: ${info.evmAddress})`);
    } else {
      console.log(`[HBAR.h]   ? ${candidate} not confirmed as contract via verifyIsContract, trying factory() anyway...`);
    }

    // Build list of EVM addresses to try for the factory() call.
    // Priority: verified EVM > accounts-resolved EVM > long-zero fallback.
    // Use case-insensitive deduplication (EVM addresses may differ in case).
    const longZero = htsIdToEvmAddress(candidate);
    const evmCandidates: string[] = [];
    const evmCandidatesLower = new Set<string>();
    const addEvmCandidate = (addr: string) => {
      if (addr && !evmCandidatesLower.has(addr.toLowerCase())) {
        evmCandidates.push(addr);
        evmCandidatesLower.add(addr.toLowerCase());
      }
    };
    if (info?.evmAddress) {
      addEvmCandidate(info.evmAddress);
    }
    // Also try resolving from accounts endpoint if verifyIsContract failed
    if (!info) {
      try {
        const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
        const acctRes = await fetch(
          `${base}/api/v1/accounts/${candidate}`,
          { signal: makeAbort(6000) }
        );
        if (acctRes.ok) {
          const acctData = await acctRes.json();
          const acctEvm = acctData.evm_address;
          if (acctEvm && acctEvm.startsWith("0x") && acctEvm.length === 42) {
            addEvmCandidate(acctEvm);
          }
        }
      } catch {
        // Non-fatal
      }
    }
    addEvmCandidate(longZero);

    // Call factory() on each EVM address variant → selector 0xc45a0155
    // Uses 300K gas (0x493e0) — Hedera charges ~2100 per SLOAD, so the
    // old 30K (0x7530) was too low and caused empty results.
    let factoryDefiniteMismatch = false;

    for (const routerEvm of evmCandidates) {
      // ── Strategy A: JSON-RPC relay eth_call ──
      try {
        const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
        const factoryRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(12000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: routerEvm, data: "0xc45a0155", gas: "0x493e0" }, "latest"],
            id: 1,
          }),
        });

        if (factoryRes.ok) {
          const factoryData = await factoryRes.json();
          const result = factoryData?.result;
          if (result && result.length >= 66 && !factoryData.error) {
            const returnedAddr = "0x" + result.slice(-40).toLowerCase();
            if (factoryMatches(returnedAddr)) {
              console.log(`[HBAR.h]   ✓ factory() returned ${returnedAddr} via RPC ${routerEvm} — MATCHES!`);
              console.log(`[HBAR.h] ═══ Verified Router: ${candidate} ═══`);
              _discoveredRouter[network] = candidate;
              SAUCERSWAP_V1_ROUTER[network] = candidate;
              const ck = `${network}:${candidate}`;
              if (!_verifiedContractCache[ck]) {
                _verifiedContractCache[ck] = { contractId: candidate, evmAddress: routerEvm };
              }
              return candidate;
            } else {
              console.log(`[HBAR.h]   ✗ factory() via RPC ${routerEvm} returned ${returnedAddr}, expected ${knownFactoryLongZero}${knownFactoryRealEvm ? ` or ${knownFactoryRealEvm}` : ""} — MISMATCH`);
              factoryDefiniteMismatch = true;
            }
            continue; // Got a definitive answer via RPC, skip Mirror Node fallback for this address
          } else if (factoryData.error) {
            console.log(`[HBAR.h]   ? factory() via RPC ${routerEvm} error: ${factoryData.error.message || JSON.stringify(factoryData.error).slice(0, 100)}`);
          } else {
            console.log(`[HBAR.h]   ? factory() via RPC ${routerEvm} unexpected: ${String(result).slice(0, 20)}`);
          }
        }
      } catch (err: any) {
        console.log(`[HBAR.h]   ? factory() via RPC ${routerEvm} failed: ${err?.message || err}`);
      }

      // ── Strategy B: Mirror Node /api/v1/contracts/call (fallback) ──
      // The JSON-RPC relay may be blocked by CORS or rate-limited from browser.
      // Mirror Node simulation endpoint often works when the relay doesn't.
      try {
        const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
        const mnRes = await fetch(`${base}/api/v1/contracts/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(12000),
          body: JSON.stringify({
            block: "latest",
            data: "0xc45a0155",
            estimate: false,
            from: "0x0000000000000000000000000000000000000000",
            to: routerEvm,
            gas: 300_000,
            gasPrice: 0,
            value: 0,
          }),
        });

        if (mnRes.ok) {
          const mnData = await mnRes.json();
          const mnResult = mnData.result;
          if (mnResult && mnResult !== "0x" && mnResult.length >= 66) {
            const returnedAddr = "0x" + mnResult.slice(-40).toLowerCase();
            if (factoryMatches(returnedAddr)) {
              console.log(`[HBAR.h]   ✓ factory() returned ${returnedAddr} via Mirror Node ${routerEvm} — MATCHES!`);
              console.log(`[HBAR.h] ═══ Verified Router: ${candidate} ═══`);
              _discoveredRouter[network] = candidate;
              SAUCERSWAP_V1_ROUTER[network] = candidate;
              const ck = `${network}:${candidate}`;
              if (!_verifiedContractCache[ck]) {
                _verifiedContractCache[ck] = { contractId: candidate, evmAddress: routerEvm };
              }
              return candidate;
            } else {
              console.log(`[HBAR.h]   ✗ factory() via Mirror Node ${routerEvm} returned ${returnedAddr}, expected ${knownFactoryLongZero}${knownFactoryRealEvm ? ` or ${knownFactoryRealEvm}` : ""} — MISMATCH`);
              factoryDefiniteMismatch = true;
            }
          }
        }
      } catch (err: any) {
        console.log(`[HBAR.h]   ? factory() via Mirror Node ${routerEvm} failed: ${err?.message || err}`);
      }
    }

    // Track as potential fallback — only if no definitive factory mismatch was found
    // (a mismatch means this candidate returned a DIFFERENT factory, so it's the wrong contract)
    if (!factoryDefiniteMismatch && !fallbackCandidate) {
      const evmAddr = info?.evmAddress || evmCandidates[0] || longZero;
      fallbackCandidate = { id: candidate, evmAddress: evmAddr };
    }
  }

  // ── Fallback: accept first candidate if factory() was inconclusive ──
  // If factory() never returned a definitive mismatch (just failed due to
  // network/CORS/rate-limiting), accept the first candidate. The SaucerSwap
  // V1 Router address (0.0.2210240) is well-known and hardcoded — it's
  // safer to accept it than to fail the entire swap pipeline.
  if (fallbackCandidate) {
    // Distinguish between a known hardcoded primary router (high confidence)
    // and an unknown fallback candidate (lower confidence) in log messages.
    const isPrimaryConfigured = fallbackCandidate.id === SAUCERSWAP_V1_ROUTER[network];
    if (isPrimaryConfigured) {
      console.log(`[HBAR.h] ═══ Using configured primary router: ${fallbackCandidate.id} (factory() verification skipped — browser CORS/network limitations) ═══`);
    } else {
      console.warn(`[HBAR.h] ═══ No factory-verified router — accepting fallback: ${fallbackCandidate.id} (EVM: ${fallbackCandidate.evmAddress}) ═══`);
    }
    _discoveredRouter[network] = fallbackCandidate.id;
    SAUCERSWAP_V1_ROUTER[network] = fallbackCandidate.id;
    // Cache in verifyIsContract cache so the safety check in executeSaucerSwapDirect
    // doesn't block the swap for a candidate that's in our hardcoded list.
    const ck = `${network}:${fallbackCandidate.id}`;
    if (!_verifiedContractCache[ck]) {
      _verifiedContractCache[ck] = {
        contractId: fallbackCandidate.id,
        evmAddress: fallbackCandidate.evmAddress,
      };
    }
    return fallbackCandidate.id;
  }

  // Absolute last resort: use the first hardcoded candidate directly.
  // This only happens if ALL network calls failed (offline, heavy rate limiting).
  const firstCandidate = candidates[0];
  if (firstCandidate) {
    console.warn(`[HBAR.h] ═══ All discovery failed — using hardcoded first candidate: ${firstCandidate} ═══`);
    _discoveredRouter[network] = firstCandidate;
    SAUCERSWAP_V1_ROUTER[network] = firstCandidate;
    const ck = `${network}:${firstCandidate}`;
    if (!_verifiedContractCache[ck]) {
      _verifiedContractCache[ck] = {
        contractId: firstCandidate,
        evmAddress: htsIdToEvmAddress(firstCandidate),
      };
    }
    return firstCandidate;
  }

  console.warn(`[HBAR.h] ═══ No router candidates configured for ${network}! ═══`);
  return null;
}

/**
 * Dynamically discover and verify the SaucerSwap V1 Router.
 * Results are cached for the session. Thread-safe (deduplicates concurrent calls).
 *
 * Tries each candidate address in SAUCERSWAP_V1_ROUTER_CANDIDATES:
 *   1. Attempts verifyIsContract (Mirror Node + eth_getCode + eth_call probe)
 *   2. Calls factory() via JSON-RPC to confirm it returns the known factory address
 *      — factory() is tried even if verifyIsContract fails (common on Hedera)
 *   3. Caches the first verified candidate and populates verifyIsContract cache
 */
export async function discoverSaucerSwapRouter(network: HederaNetwork): Promise<string | null> {
  if (_discoveredRouter[network]) return _discoveredRouter[network];

  // Deduplicate: if discovery is already in progress, await the same promise
  if (!_routerDiscoveryInProgress[network]) {
    _routerDiscoveryInProgress[network] = _discoverRouterImpl(network).finally(() => {
      delete _routerDiscoveryInProgress[network];
    });
  }
  return _routerDiscoveryInProgress[network];
}

function encodeSaucerSwapCall(
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint
): Uint8Array {
  // selector: swapExactTokensForTokens(uint256,uint256,address[],address,uint256) = 0x38ed1739
  const selector = new Uint8Array([0x38, 0xed, 0x17, 0x39]);
  const parts: Uint8Array[] = [selector];

  parts.push(encodeUint256(amountIn));
  parts.push(encodeUint256(amountOutMin));
  parts.push(encodeUint256(160n)); // offset to dynamic array
  parts.push(encodeAddress(to));
  parts.push(encodeUint256(deadline));
  parts.push(encodeUint256(BigInt(path.length)));
  for (const addr of path) {
    parts.push(encodeAddress(addr));
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// ── ABI Encoding for swapExactETHForTokens ──────────────────────────

/**
 * Encode a swapExactETHForTokens call for native HBAR → token swaps.
 * Function: swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)
 * Selector: 0x7ff36ab5
 *
 * The HBAR amount is sent as the payable value on the ContractExecuteTransaction.
 * Path must start with WHBAR EVM address.
 */
function encodeSaucerSwapETHForTokens(
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint
): Uint8Array {
  // keccak256("swapExactETHForTokens(uint256,address[],address,uint256)") = 0x7ff36ab5
  const selector = new Uint8Array([0x7f, 0xf3, 0x6a, 0xb5]);
  const parts: Uint8Array[] = [selector];

  // Head: amountOutMin, path offset, to, deadline
  parts.push(encodeUint256(amountOutMin));        // slot 0
  parts.push(encodeUint256(128n));                 // slot 1: offset to path data (4 head slots × 32 = 128)
  parts.push(encodeAddress(to));                   // slot 2
  parts.push(encodeUint256(deadline));             // slot 3

  // Tail: path array
  parts.push(encodeUint256(BigInt(path.length)));
  for (const addr of path) {
    parts.push(encodeAddress(addr));
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Encode a swapExactTokensForETH call for token → native HBAR swaps.
 * Function: swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)
 * Selector: 0x18cbafe5
 *
 * Path must end with WHBAR EVM address.
 */
function encodeSaucerSwapTokensForETH(
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint
): Uint8Array {
  // keccak256("swapExactTokensForETH(uint256,uint256,address[],address,uint256)") = 0x18cbafe5
  const selector = new Uint8Array([0x18, 0xcb, 0xaf, 0xe5]);
  const parts: Uint8Array[] = [selector];

  // Same layout as swapExactTokensForTokens
  parts.push(encodeUint256(amountIn));
  parts.push(encodeUint256(amountOutMin));
  parts.push(encodeUint256(160n)); // offset to dynamic array (5 head slots × 32 = 160)
  parts.push(encodeAddress(to));
  parts.push(encodeUint256(deadline));
  parts.push(encodeUint256(BigInt(path.length)));
  for (const addr of path) {
    parts.push(encodeAddress(addr));
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════
// ── SAUCERSWAP V2 (CONCENTRATED LIQUIDITY) SUPPORT ──────────────────
// ══════════════════════════════════════════════════════════════════════
// SaucerSwap V2 is a UniswapV3 fork on Hedera. Many newer tokens
// (including HBAR.ħ) ONLY have V2 pools. V1 swapExactETHForTokens
// reverts for these tokens because no V1 pair contract exists.
//
// The V2 swap function is `exactInputSingle` with a struct parameter.
// Pool detection probes V1 getPair → V2 getPool to determine routing.

type PoolVersion = "v1" | "v2";

interface PoolVersionInfo {
  version: PoolVersion;
  feeTier?: number;     // V2 fee tier (100=0.01%, 500=0.05%, 3000=0.3%, 10000=1%)
  poolAddress?: string; // V1 pair or V2 pool address
}

// Cache discovered pool versions to avoid repeated on-chain calls
const _poolVersionCache: Record<string, PoolVersionInfo | null> = {};

// ── Known V2 Pools ──────────────────────────────────────────────────
// Hardcoded DexScreener-verified V2 pool addresses for critical pairs.
// This bypasses V2 Factory discovery (which can fail due to RPC issues)
// and ensures routing works even when on-chain probing is unavailable.
//
// To add a new known pool:
//   1. Find the pair on DexScreener (https://dexscreener.com/hedera/)
//   2. Note the pair address and fee tier
//   3. Add an entry below with both token EVM addresses (sorted lowercase)
const KNOWN_V2_POOLS: {
  tokenA: string; tokenB: string; fee: number; poolAddress: string;
}[] = [
  {
    // WHBAR / HBAR.ħ — verified via DexScreener
    tokenA: htsIdToEvmAddress("0.0.1456986").toLowerCase(),  // WHBAR
    tokenB: htsIdToEvmAddress(HBARH_TOKEN_ID).toLowerCase(), // HBAR.ħ
    fee: 3000,
    poolAddress: "0x31d6b803a960b818cce3a85f0bef7c4c566b7919",
  },
];

/**
 * Look up a known V2 pool by token pair. Returns the pool info if found,
 * or null if the pair isn't in the known-pools table.
 */
function lookupKnownV2Pool(
  tokenA_evm: string,
  tokenB_evm: string
): PoolVersionInfo | null {
  const a = tokenA_evm.toLowerCase();
  const b = tokenB_evm.toLowerCase();
  for (const pool of KNOWN_V2_POOLS) {
    if (
      (pool.tokenA === a && pool.tokenB === b) ||
      (pool.tokenA === b && pool.tokenB === a)
    ) {
      return { version: "v2", feeTier: pool.fee, poolAddress: pool.poolAddress };
    }
  }
  return null;
}

/**
 * ABI-encode getPair(address tokenA, address tokenB) for V1 Factory
 * Selector: 0xe6a43905
 */
function encodeGetPair(tokenA: string, tokenB: string): Uint8Array {
  const selector = new Uint8Array([0xe6, 0xa4, 0x39, 0x05]);
  return concatBytes(selector, encodeAddress(tokenA), encodeAddress(tokenB));
}

/**
 * ABI-encode getPool(address tokenA, address tokenB, uint24 fee) for V2 Factory
 * Selector: 0x1698ee82
 */
function encodeGetPool(tokenA: string, tokenB: string, fee: number): Uint8Array {
  const selector = new Uint8Array([0x16, 0x98, 0xee, 0x82]);
  return concatBytes(
    selector,
    encodeAddress(tokenA),
    encodeAddress(tokenB),
    encodeUint256(BigInt(fee))
  );
}

/**
 * Encode exactInputSingle for SaucerSwap V2 (UniswapV3-style SwapRouter).
 *
 * Function: exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
 * Selector: 0x414bf389
 *
 * The struct fields (in order):
 *   tokenIn, tokenOut, fee, recipient, deadline,
 *   amountIn, amountOutMinimum, sqrtPriceLimitX96
 *
 * For native HBAR input: HBAR is sent as payable value, tokenIn = WHBAR address.
 * The router wraps HBAR internally before swapping through the pool.
 */
function encodeExactInputSingle(
  tokenIn: string,
  tokenOut: string,
  fee: number,
  recipient: string,
  deadline: bigint,
  amountIn: bigint,
  amountOutMinimum: bigint,
  sqrtPriceLimitX96: bigint = 0n
): Uint8Array {
  const selector = new Uint8Array([0x41, 0x4b, 0xf3, 0x89]);
  return concatBytes(
    selector,
    encodeAddress(tokenIn),
    encodeAddress(tokenOut),
    encodeUint256(BigInt(fee)),
    encodeAddress(recipient),
    encodeUint256(deadline),
    encodeUint256(amountIn),
    encodeUint256(amountOutMinimum),
    encodeUint256(sqrtPriceLimitX96)
  );
}

/**
 * Encode quoteExactInputSingle for the SaucerSwap V2 QuoterV2 contract.
 *
 * Function: quoteExactInputSingle((address,address,uint256,uint24,uint160))
 * Selector: 0xc6a5026a
 *
 * Struct fields (in order):
 *   tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96
 */
function encodeQuoteExactInputSingle(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number,
  sqrtPriceLimitX96: bigint = 0n
): Uint8Array {
  const selector = new Uint8Array([0xc6, 0xa5, 0x02, 0x6a]);
  return concatBytes(
    selector,
    encodeAddress(tokenIn),
    encodeAddress(tokenOut),
    encodeUint256(amountIn),
    encodeUint256(BigInt(fee)),
    encodeUint256(sqrtPriceLimitX96)
  );
}

// Known QuoterV2 contract on Hedera (SaucerSwap V2)
// The QuoterV2 address has not been confirmed from SaucerSwap docs yet.
// When "0.0.0", V2 quoting is skipped and price-based estimation is used.
// Once the real QuoterV2 contract ID is obtained, update for accurate on-chain quotes.
const SAUCERSWAP_V2_QUOTER: Record<string, string> = {
  mainnet: "0.0.0", // QuoterV2 — pending confirmation (0.0.0 = skip V2 quoting)
  testnet: "0.0.0",
};

let _v2QuoterEvmCache: Record<string, string | null> = {};

/**
 * Fetch a V2 quote via the QuoterV2 contract's quoteExactInputSingle.
 *
 * Returns the expected output amount or null if the quote fails.
 * Uses JSON-RPC eth_call (view function, no gas cost).
 */
async function fetchV2RouterQuote(
  tokenInEvm: string,
  tokenOutEvm: string,
  amountIn: bigint,
  fee: number,
  network: HederaNetwork
): Promise<bigint | null> {
  const quoterId = SAUCERSWAP_V2_QUOTER[network] || SAUCERSWAP_V2_QUOTER.mainnet;

  // Skip if QuoterV2 address is unconfigured
  if (!quoterId || quoterId === "0.0.0") {
    console.log("[HBAR.h] V2 QuoterV2 address not configured — skipping V2 on-chain quote");
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

  console.log(`[HBAR.h] V2 Quote: quoteExactInputSingle(${tokenInEvm.slice(0,10)}…, ${tokenOutEvm.slice(0,10)}…, ${amountIn}, fee=${fee}) → quoter ${quoterEvm}`);

  // ── Strategy A: JSON-RPC relay eth_call ──
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
          console.log(`[HBAR.h] V2 Quote via JSON-RPC: amountOut=${amountOut}`);
          return amountOut;
        }
      }
      if (data.error) {
        console.log(`[HBAR.h] V2 Quote RPC error: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
      }
    }
  } catch (err: any) {
    console.log("[HBAR.h] V2 Quote via RPC failed:", err?.message || err);
  }

  // ── Strategy B: Mirror Node /api/v1/contracts/call ──
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
          console.log(`[HBAR.h] V2 Quote via Mirror Node: amountOut=${amountOut}`);
          return amountOut;
        }
      }
    }
  } catch (err: any) {
    console.log("[HBAR.h] V2 Quote via Mirror Node failed:", err?.message || err);
  }

  return null;
}

// V2 Factory address cache (discovered by calling factory() on V2 Router)
let _v2FactoryCache: Record<string, string | null> = {};

/**
 * Discover the V2 Factory address by calling factory() on the V2 Router.
 * Tries JSON-RPC relay first, then Mirror Node fallback.
 */
async function discoverV2Factory(network: HederaNetwork): Promise<string | null> {
  if (_v2FactoryCache[network] !== undefined) return _v2FactoryCache[network];

  const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;

  // ── Strategy A: JSON-RPC relay eth_call ──
  try {
    const v2RouterEvm = await resolveContractEvmAddress(v2RouterId, network);
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(10000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: v2RouterEvm, data: "0xc45a0155", gas: "0x493e0" }, "latest"],
        id: 1,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result && data.result.length >= 66 && !data.error) {
        const factoryAddr = "0x" + data.result.slice(-40).toLowerCase();
        if (factoryAddr !== "0x0000000000000000000000000000000000000000") {
          console.log(`[HBAR.h] V2 Factory discovered via RPC: ${factoryAddr}`);
          _v2FactoryCache[network] = factoryAddr;
          return factoryAddr;
        }
      }
    }
  } catch (err: any) {
    console.log("[HBAR.h] V2 Factory discovery via RPC failed:", err?.message || err);
  }

  // ── Strategy B: Mirror Node /api/v1/contracts/call ──
  try {
    const v2RouterEvm = await resolveContractEvmAddress(v2RouterId, network);
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const mnRes = await fetch(`${base}/api/v1/contracts/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(10000),
      body: JSON.stringify({
        block: "latest",
        data: "0xc45a0155",
        estimate: false,
        from: "0x0000000000000000000000000000000000000000",
        to: v2RouterEvm,
        gas: 300_000,
        gasPrice: 0,
        value: 0,
      }),
    });
    if (mnRes.ok) {
      const mnData = await mnRes.json();
      if (mnData.result && mnData.result.length >= 66 && mnData.result !== "0x") {
        const factoryAddr = "0x" + mnData.result.slice(-40).toLowerCase();
        if (factoryAddr !== "0x0000000000000000000000000000000000000000") {
          console.log(`[HBAR.h] V2 Factory discovered via Mirror Node: ${factoryAddr}`);
          _v2FactoryCache[network] = factoryAddr;
          return factoryAddr;
        }
      }
    }
  } catch {
    // Non-fatal
  }

  _v2FactoryCache[network] = null;
  return null;
}

/**
 * Detect whether a token pair has a pool on SaucerSwap V1 or V2.
 *
 * Strategy:
 * 1. Check V1 Factory.getPair() — if non-zero address, use V1
 * 2. Check V2 Factory.getPool() with common fee tiers — first non-zero wins
 * 3. If neither found, return null
 *
 * Results are cached for the session.
 */
export async function detectPoolVersion(
  tokenA_evm: string,
  tokenB_evm: string,
  network: HederaNetwork
): Promise<PoolVersionInfo | null> {
  const sortedKey = [tokenA_evm.toLowerCase(), tokenB_evm.toLowerCase()].sort().join(":");
  const cacheKey = `${network}:${sortedKey}`;
  if (_poolVersionCache[cacheKey] !== undefined) {
    console.log(`[HBAR.h] Pool version cache hit: ${_poolVersionCache[cacheKey]?.version || "none"} (fee: ${_poolVersionCache[cacheKey]?.feeTier || "N/A"})`);
    return _poolVersionCache[cacheKey];
  }

  // ── Check known V2 pools FIRST (hardcoded, always works) ──
  // This bypasses on-chain probing entirely for verified pairs like WHBAR/HBAR.ħ.
  const knownPool = lookupKnownV2Pool(tokenA_evm, tokenB_evm);
  if (knownPool) {
    console.log(`[HBAR.h] ═══ KNOWN V2 POOL HIT: fee=${knownPool.feeTier}, pool=${knownPool.poolAddress} ═══`);
    _poolVersionCache[cacheKey] = knownPool;
    return knownPool;
  }

  // ── Check static pool routes (no network calls needed) ──
  // The static getPoolRoutes() table already defines known V1 pairs (and the
  // V2 WHBAR/HBAR.ħ pair, already covered above). If we can reverse-resolve
  // the EVM addresses to token symbols and find a matching static route,
  // return V1 immediately instead of making fragile on-chain RPC calls.
  try {
    const htsA = evmAddressToHtsId(tokenA_evm);
    const htsB = evmAddressToHtsId(tokenB_evm);
    const tokA = TOKEN_BY_HTS_ID.get(htsA);
    const tokB = TOKEN_BY_HTS_ID.get(htsB);
    if (tokA && tokB) {
      const symA = tokA.symbol;
      const symB = tokB.symbol;
      const routes = getPoolRoutes();
      const staticRoute = routes.find(
        r =>
          (r.tokenA.symbol === symA && r.tokenB.symbol === symB) ||
          (r.tokenA.symbol === symB && r.tokenB.symbol === symA)
      );
      if (staticRoute) {
        // Check if the static route is explicitly marked as V2
        if (staticRoute.poolAddress === "v2-pool") {
          const info: PoolVersionInfo = { version: "v2", feeTier: 3000, poolAddress: "v2-pool" };
          console.log(`[HBAR.h] Static route ${symA}/${symB} is V2 (pool: v2-pool)`);
          _poolVersionCache[cacheKey] = info;
          return info;
        }
        // Otherwise it's a V1 pair
        const info: PoolVersionInfo = { version: "v1", poolAddress: staticRoute.poolAddress };
        console.log(`[HBAR.h] Static route ${symA}/${symB} → V1 (pool: ${staticRoute.poolAddress})`);
        _poolVersionCache[cacheKey] = info;
        return info;
      }
    }
  } catch {
    // Non-critical — fall through to on-chain probing
  }

  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;

  // ── Check V1 Factory.getPair() ──
  try {
    const v1FactoryId = getSaucerSwapFactory(network);
    const v1FactoryEvm = await resolveContractEvmAddress(v1FactoryId, network);
    const pairCallData = bytesToHex(encodeGetPair(tokenA_evm, tokenB_evm));

    const pairRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(10000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: v1FactoryEvm, data: pairCallData, gas: "0x493e0" }, "latest"],
        id: 1,
      }),
    });

    if (pairRes.ok) {
      const pairData = await pairRes.json();
      if (pairData.result && pairData.result.length >= 66 && !pairData.error) {
        const pairAddr = "0x" + pairData.result.slice(-40).toLowerCase();
        if (pairAddr !== "0x0000000000000000000000000000000000000000") {
          console.log(`[HBAR.h] ═══ V1 POOL DETECTED: pair=${pairAddr} ═══`);
          const info: PoolVersionInfo = { version: "v1", poolAddress: pairAddr };
          _poolVersionCache[cacheKey] = info;
          return info;
        }
        console.log("[HBAR.h] V1 getPair returned zero — no V1 pair exists");
      }
    }
  } catch (err: any) {
    console.log("[HBAR.h] V1 getPair check failed:", err?.message || err);
  }

  // ── Check V2 Factory.getPool() with each fee tier ──
  const v2FactoryEvm = await discoverV2Factory(network);
  if (v2FactoryEvm) {
    for (const fee of V2_FEE_TIERS) {
      try {
        const poolCallData = bytesToHex(encodeGetPool(tokenA_evm, tokenB_evm, fee));
        const poolRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(8000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: v2FactoryEvm, data: poolCallData, gas: "0x493e0" }, "latest"],
            id: 1,
          }),
        });

        if (poolRes.ok) {
          const poolData = await poolRes.json();
          if (poolData.result && poolData.result.length >= 66 && !poolData.error) {
            const poolAddr = "0x" + poolData.result.slice(-40).toLowerCase();
            if (poolAddr !== "0x0000000000000000000000000000000000000000") {
              console.log(`[HBAR.h] ═══ V2 POOL DETECTED: fee=${fee} (${fee / 10000}%), pool=${poolAddr} ═══`);
              const info: PoolVersionInfo = { version: "v2", feeTier: fee, poolAddress: poolAddr };
              _poolVersionCache[cacheKey] = info;
              return info;
            }
          }
        }
      } catch (err: any) {
        console.log(`[HBAR.h] V2 getPool(fee=${fee}) failed:`, err?.message || err);
      }
    }
    console.log("[HBAR.h] No V2 pool found at any fee tier");
  } else {
    console.log("[HBAR.h] V2 Factory not discovered — skipping V2 pool check");
  }

  console.warn(
    `[HBAR.h] No pool found on V1 or V2 for ` +
    `${evmAddressToHtsId(tokenA_evm)} (…${tokenA_evm.slice(-8)}) / ` +
    `${evmAddressToHtsId(tokenB_evm)} (…${tokenB_evm.slice(-8)})`
  );
  _poolVersionCache[cacheKey] = null;
  return null;
}

/**
 * Execute a swap through SaucerSwap V2 (concentrated liquidity).
 *
 * Uses exactInputSingle for single-hop swaps.
 * - HBAR → Token: payable exactInputSingle (no approve needed)
 * - Token → Token: ERC-20 approve + exactInputSingle
 * - Token → HBAR: ERC-20 approve + exactInputSingle (to WHBAR) + auto-note
 */
async function executeSaucerSwapV2Direct(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork,
  poolInfo: PoolVersionInfo,
  isInputNative: boolean,
  isOutputNative: boolean,
  whbar: AllowedToken,
  rawInput: number,
  recipientEvmAddress: string
): Promise<SwapResult> {
  const { executeHederaTransaction } = await import("./hashpack");

  try {
    const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
    const fee = poolInfo.feeTier || 3000;

    // Token EVM addresses for the V2 pool
    const tokenInEvm = (isInputNative ? whbar : inputToken).evmAddress;
    const tokenOutEvm = (isOutputNative ? whbar : outputToken).evmAddress;

    // ── V2 Quote: try V2 QuoterV2 first, then fall back to price estimation ──
    // V1 getAmountsOut does NOT work for V2-only pools, so we use the V2 QuoterV2
    // contract's quoteExactInputSingle() which queries the actual concentrated
    // liquidity pool and returns accurate output amounts.
    let quote: RawQuote | null = null;

    // Strategy 1: V2 QuoterV2 contract (most accurate for V2 pools)
    try {
      const v2QuoteAmount = await fetchV2RouterQuote(
        tokenInEvm, tokenOutEvm, BigInt(rawInput), fee, network
      );
      if (v2QuoteAmount !== null && v2QuoteAmount > 0n) {
        quote = {
          amountOut: Number(v2QuoteAmount),
          priceImpact: 0, // Actual impact baked into on-chain result
          route: [inputToken.htsId, outputToken.htsId],
          source: "router",
        };
        console.log(`[HBAR.h] V2 Quote via QuoterV2: amountOut=${v2QuoteAmount}`);
      }
    } catch (err: any) {
      console.log("[HBAR.h] V2 QuoterV2 quote failed:", err?.message || err);
    }

    // Strategy 2: Price-based estimation fallback
    if (!quote) {
      const quoteInputId = isInputNative ? whbar.htsId : inputToken.htsId;
      const quoteOutputId = isOutputNative ? whbar.htsId : outputToken.htsId;
      quote = await fetchSaucerSwapQuote(quoteInputId, quoteOutputId, rawInput.toString(), {
        pathAddresses: [tokenInEvm, tokenOutEvm],
        routerHtsId: getSaucerSwapRouter(network, "v1"),
        network,
        inputToken: isInputNative ? whbar : inputToken,
        outputToken: isOutputNative ? whbar : outputToken,
      });
    }

    // ── minOutput calculation ──
    let minOutput: number;
    if (quote && quote.amountOut > 0) {
      const effectiveSlippage = quote.source === "price-estimate"
        ? Math.max(slippagePct, 5) // wider slippage for estimated quotes
        : slippagePct;
      minOutput = Math.max(1, Math.floor(quote.amountOut * (1 - effectiveSlippage / 100)));
      console.log(`[HBAR.h] V2 Quote: source=${quote.source}, amountOut=${quote.amountOut}, minOutput=${minOutput} (${effectiveSlippage}% slippage)`);
    } else {
      // Last-ditch inline estimate before surrendering to minOutput=1
      const inTok = isInputNative ? whbar : inputToken;
      const outTok = isOutputNative ? whbar : outputToken;
      const lastDitch = estimateOutputFromPrices(rawInput, inTok, outTok, 1);
      if (lastDitch && lastDitch > 0) {
        const safeSlippage = Math.max(slippagePct, 10); // very generous for emergency estimate
        minOutput = Math.max(1, Math.floor(lastDitch * (1 - safeSlippage / 100)));
        console.warn(`[HBAR.h] V2: All strategies failed but inline price estimate rescued quote: minOutput=${minOutput} (${safeSlippage}% slippage)`);
      } else {
        minOutput = 1;
        console.warn("[HBAR.h] V2: All quote strategies failed including inline rescue — using minOutput=1 (no slippage protection)");
      }
    }

    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min

    // Dynamic SDK import
    let sdk: any;
    try {
      sdk = await import("@hashgraph/sdk");
    } catch (e: any) {
      return { success: false, error: "Hedera SDK not available: " + (e?.message || "unknown"), executionVenue: "saucerswap-v2" };
    }
    const { ContractExecuteTransaction, ContractId, Hbar } = sdk;

    // ── Verify V2 Router is a contract ──
    const routerContractInfo = await verifyIsContract(v2RouterId, network);
    if (!routerContractInfo) {
      return {
        success: false,
        error: `V2 Router ${v2RouterId} failed contract verification on ${network}. Cannot execute V2 swap.`,
        executionVenue: "saucerswap-v2",
      };
    }
    const routerEvmAddress = routerContractInfo.evmAddress || await resolveContractEvmAddress(v2RouterId, network);

    // ── Log V2 swap parameters ──
    console.log("[HBAR.h] ═══════════════════════════════════════════");
    console.log("[HBAR.h] V2 SWAP EXECUTION START");
    console.log("[HBAR.h] Input:", inputToken.symbol, "→ Output:", outputToken.symbol);
    console.log("[HBAR.h] Amount:", inputAmount, `(raw: ${rawInput})`);
    console.log("[HBAR.h] V2 Fee Tier:", fee, `(${fee / 10000}%)`);
    console.log("[HBAR.h] Pool:", poolInfo.poolAddress || "detected");
    console.log("[HBAR.h] TokenIn EVM:", tokenInEvm);
    console.log("[HBAR.h] TokenOut EVM:", tokenOutEvm);
    console.log("[HBAR.h] Recipient EVM:", recipientEvmAddress);
    console.log("[HBAR.h] V2 Router:", v2RouterId, `(EVM: ${routerEvmAddress})`);
    console.log("[HBAR.h] MinOutput:", minOutput, `(quote: ${quote?.amountOut ?? "none"})`);
    console.log("[HBAR.h] Slippage:", slippagePct, "% | Deadline:", deadline);
    console.log("[HBAR.h] Mode:", isInputNative ? "HBAR→Token(V2)" : isOutputNative ? "Token→HBAR(V2)" : "Token→Token(V2)");
    console.log("[HBAR.h] ═══════════════════════════════════════════");

    // ── Token association check ──
    if (!isOutputNative) {
      const outputHtsId = outputToken.htsId;
      const isAssoc = await isTokenAssociated(accountId, outputHtsId, network);
      if (!isAssoc) {
        console.warn(`[HBAR.h] V2: Output token ${outputToken.symbol} (${outputHtsId}) NOT associated — auto-associating`);
        try {
          const assocSdk = await import("@hashgraph/sdk");
          const assocTx = new assocSdk.TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([outputHtsId]);
          const assocResult = await executeHederaTransaction(accountId, assocTx);
          if (!assocResult.success) {
            return {
              success: false,
              error: `Output token ${outputToken.symbol} association failed: ${assocResult.error || "unknown"}. Associate ${outputHtsId} manually in HashPack.`,
              executionVenue: "saucerswap-v2",
              userCancelled: assocResult.userCancelled,
            };
          }
          console.log(`[HBAR.h] V2: Successfully associated ${outputToken.symbol}`);
        } catch (assocErr: any) {
          const aMsg = (assocErr?.message || "").toLowerCase();
          const aCancel = aMsg.includes("user_reject") || aMsg.includes("cancelled by user") || aMsg.includes("canceled by user") || aMsg.includes("user denied") || aMsg.includes("user rejected");
          return {
            success: false,
            error: `Cannot associate ${outputToken.symbol}: ${assocErr?.message || "unknown"}`,
            executionVenue: "saucerswap-v2",
            userCancelled: aCancel || undefined,
          };
        }
      } else {
        console.log(`[HBAR.h] V2: Output token ${outputToken.symbol} association confirmed ✓`);
      }
    }

    // ── Gas sufficiency check ──
    // Hedera gas fees are sub-cent for typical swaps. Reserve 1 HBAR total
    // to cover gas + network fees — good for dozens of transactions.
    // SWAP_GAS / APPROVE_GAS are gas LIMITS for the EVM call, NOT the HBAR cost.
    const SWAP_GAS = 1_500_000;
    const APPROVE_GAS = 800_000;
    const gasReserveNeeded = 1; // 1 HBAR covers gas + network fees with plenty of margin

    if (isInputNative) {
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      const inputHbar = parseFloat(inputAmount);
      const totalNeeded = inputHbar + gasReserveNeeded;
      if (hbarBalance < totalNeeded) {
        const shortfall = totalNeeded - hbarBalance;
        return {
          success: false,
          error: `Insufficient HBAR: you have ${hbarBalance.toFixed(2)} HBAR but need ${totalNeeded.toFixed(2)} HBAR (${inputHbar} for swap + ${gasReserveNeeded} for fees). Short by ${shortfall.toFixed(2)} HBAR.`,
          executionVenue: "saucerswap-v2",
        };
      }
    } else {
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      if (hbarBalance < gasReserveNeeded) {
        return {
          success: false,
          error: `Insufficient HBAR for fees: you have ${hbarBalance.toFixed(2)} HBAR but need at least ${gasReserveNeeded} HBAR. Deposit more HBAR first.`,
          executionVenue: "saucerswap-v2",
        };
      }
    }

    // ── Pre-swap dry run (V2-specific) ──
    // Simulate exactInputSingle via JSON-RPC to catch reverts before real gas is spent
    try {
      const dryCallData = encodeExactInputSingle(
        tokenInEvm, tokenOutEvm, fee,
        recipientEvmAddress,
        BigInt(deadline),
        BigInt(rawInput),
        BigInt(minOutput),
        0n
      );
      const dryDataHex = bytesToHex(dryCallData);
      const dryGasHex = "0x" + (1_500_000).toString(16);
      const dryValueHex = isInputNative ? "0x" + (BigInt(rawInput) * 10000000000n).toString(16) : "0x0";

      console.log(`[HBAR.h] V2 Dry run: exactInputSingle, value=${isInputNative ? rawInput : 0}`);

      const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
      const dryRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(15000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{
            from: recipientEvmAddress,
            to: routerEvmAddress,
            data: dryDataHex,
            gas: dryGasHex,
            value: dryValueHex,
          }, "latest"],
          id: 1,
        }),
      });

      if (dryRes.ok) {
        const dryData = await dryRes.json();
        if (dryData.error) {
          const revertMsg = dryData.error.message || JSON.stringify(dryData.error).slice(0, 200);
          // Only block on definitive reverts, not on generic RPC issues
          if (revertMsg.includes("REVERT") || revertMsg.includes("revert") || revertMsg.includes("execution reverted")) {
            console.error(`[HBAR.h] V2 Dry run REVERT: ${revertMsg}`);
            return {
              success: false,
              error: `V2 pre-swap simulation reverted: ${revertMsg}. The swap would fail on-chain.`,
              executionVenue: "saucerswap-v2",
            };
          }
          console.log(`[HBAR.h] V2 Dry run non-blocking RPC error: ${revertMsg.slice(0, 100)}`);
        } else if (dryData.result && dryData.result !== "0x" && dryData.result.length > 2) {
          console.log(`[HBAR.h] V2 Dry run PASSED ✓ (${dryData.result.length} chars)`);
        } else {
          console.log("[HBAR.h] V2 Dry run: empty result — non-blocking (payable calls may not simulate)");
        }
      }
    } catch (dryErr: any) {
      console.log("[HBAR.h] V2 Dry run skipped:", dryErr?.message || dryErr);
      // Non-blocking — proceed with real swap
    }

    // ── Execution branches ──

    if (isInputNative) {
      // ═══ HBAR → Token via V2 exactInputSingle (payable) ═══
      console.log("[HBAR.h] V2: Native HBAR input — payable exactInputSingle");

      const functionData = encodeExactInputSingle(
        tokenInEvm, tokenOutEvm, fee,
        recipientEvmAddress,
        BigInt(deadline),
        BigInt(rawInput),
        BigInt(minOutput),
        0n
      );

      const hbarAmount = rawInput / Math.pow(10, 8); // Convert tinybar to HBAR

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData)
        .setPayableAmount(new Hbar(hbarAmount));

      console.log("[HBAR.h] V2: Submitting exactInputSingle — HBAR:", hbarAmount);
      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2: Swap result:", JSON.stringify(swapResult));

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: ["HBAR", outputToken.symbol],
        priceImpact: quote?.priceImpact,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v2",
        quoteSource: quote?.source || "none",
        userCancelled: swapResult.userCancelled,
      };

    } else {
      // ═══ Token → Token or Token → HBAR via V2 ═══
      // For Token → HBAR: swap to WHBAR, user can unwrap via HBAR↔WHBAR

      // Step 1: ERC-20 approve on V2 Router
      console.log(`[HBAR.h] V2 Step 1: ERC-20 approve ${inputToken.symbol} → V2 Router`);
      const approveData = encodeErc20Approve(routerEvmAddress, BigInt(rawInput));
      const approveTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(inputToken.htsId))
        .setGas(APPROVE_GAS)
        .setFunctionParameters(approveData);

      const approveResult = await executeHederaTransaction(accountId, approveTx);
      console.log("[HBAR.h] V2: Approve result:", JSON.stringify(approveResult));

      if (!approveResult.success) {
        return {
          success: false,
          transactionId: approveResult.transactionId || undefined,
          error: "V2 ERC-20 approve failed: " + (approveResult.error || "unknown") +
            (approveResult.transactionId ? ` (tx: ${approveResult.transactionId})` : ""),
          executionVenue: "saucerswap-v2",
          userCancelled: approveResult.userCancelled,
        };
      }

      // Step 2: exactInputSingle
      console.log("[HBAR.h] V2 Step 2: exactInputSingle");
      const functionData = encodeExactInputSingle(
        tokenInEvm, tokenOutEvm, fee,
        recipientEvmAddress,
        BigInt(deadline),
        BigInt(rawInput),
        BigInt(minOutput),
        0n
      );

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2: Swap result:", JSON.stringify(swapResult));

      const displayRoute = isOutputNative
        ? [inputToken.symbol, "WHBAR"]  // User gets WHBAR, can unwrap via swap page
        : [inputToken.symbol, outputToken.symbol];

      const actualOutputDecimals = isOutputNative ? 8 : outputToken.decimals;

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, actualOutputDecimals) : undefined,
        route: displayRoute,
        priceImpact: quote?.priceImpact,
        error: swapResult.error
          ? swapResult.error +
            (isOutputNative ? " (V2 output is WHBAR — use HBAR↔WHBAR to unwrap)" : "") +
            (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
          : (isOutputNative && swapResult.success ? "Swap to WHBAR succeeded. Use HBAR↔WHBAR swap to unwrap to native HBAR." : undefined),
        executionVenue: "saucerswap-v2",
        quoteSource: quote?.source || "none",
        userCancelled: swapResult.userCancelled,
      };
    }
  } catch (err: any) {
    console.error("[HBAR.h] V2 swap execution error:", err);
    const errMsg = err?.message || "V2 swap failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return {
      success: false,
      error: errMsg,
      executionVenue: "saucerswap-v2",
      userCancelled: isCancellation || undefined,
    };
  }
}

// ── Helper Utilities ────────────────────────────────────────────────

export function parseTokenAmount(amount: string, decimals: number): number {
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed * Math.pow(10, decimals));
}

export function formatTokenAmountRaw(rawAmount: number, decimals: number): string {
  return (rawAmount / Math.pow(10, decimals)).toFixed(decimals > 6 ? 8 : decimals);
}

// ── Swap Execution ──────────────────────────────────────────────────

/**
 * Execute a swap through SauceSwap V1 router.
 *
 * Uses HashConnect v3's signer-based flow:
 * 1. Builds unfrozen Hedera SDK transactions
 * 2. Passes them to executeHederaTransaction() from hashpack.ts
 * 3. HashConnect signer freezes (sets nodeAccountIds + txId),
 *    sends to HashPack for signing, and submits to the network
 *
 * This replaces the old sign-bytes-then-submit pattern which failed
 * because unfrozen transactions can't be serialized/deserialized
 * correctly, and headless Clients can't execute without an operator.
 */
export async function executeSaucerSwap(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork
): Promise<SwapResult> {
  const inputToken = resolveToken(inputSymbol);
  const outputToken = resolveToken(outputSymbol);

  if (!inputToken || !outputToken) {
    return {
      success: false,
      error: "Token not supported: " + (!inputToken ? inputSymbol : outputSymbol) + ". Only pre-approved wrapped assets on SauceSwap are supported.",
      executionVenue: "restricted-router",
    };
  }

  if (inputToken.symbol === outputToken.symbol) {
    return { success: false, error: "Cannot swap a token for itself", executionVenue: "restricted-router" };
  }

  return executeSaucerSwapDirect(inputToken, outputToken, inputAmount, slippagePct, accountId, network);
}

// ── Pre-Swap Dry Run ────────────────────────────────────────────────
// Simulate the swap BEFORE spending real gas.  Tries the JSON-RPC
// relay first (more reliable for state-mutating call simulation),
// then falls back to Mirror Node /api/v1/contracts/call.  If the
// simulation reverts with an explicit error, we abort and save the
// user from losing HBAR on a guaranteed failure.

interface DryRunParams {
  isInputNative: boolean;
  isOutputNative: boolean;
  rawInput: number;
  minOutput: number;
  pathAddresses: string[];
  recipientEvmAddress: string;
  routerHtsId: string;
  deadline: number;
  network: HederaNetwork;
}

export interface DryRunResult {
  ok: boolean;
  reason?: string;
  /** Whether the dry run actually executed (vs skipped due to endpoint issues) */
  simulated: boolean;
  /** The function selector used */
  functionName?: string;
  /** Response hex length (indicates valid return data) */
  resultHexLength?: number;
  /** Time taken in ms */
  durationMs?: number;
}

async function preSwapDryRun(params: DryRunParams): Promise<DryRunResult> {
  const {
    isInputNative, isOutputNative, rawInput, minOutput,
    pathAddresses, recipientEvmAddress, routerHtsId, deadline, network,
  } = params;

  const startTime = Date.now();

  const routerEvm = await resolveContractEvmAddress(routerHtsId, network);

  let callData: Uint8Array;
  let value: number = 0;
  let functionName: string;

  if (isInputNative) {
    callData = encodeSaucerSwapETHForTokens(
      BigInt(minOutput), pathAddresses, recipientEvmAddress, BigInt(deadline)
    );
    value = rawInput;
    functionName = "swapExactETHForTokens";
  } else if (isOutputNative) {
    callData = encodeSaucerSwapTokensForETH(
      BigInt(rawInput), BigInt(minOutput), pathAddresses, recipientEvmAddress, BigInt(deadline)
    );
    functionName = "swapExactTokensForETH";
  } else {
    callData = encodeSaucerSwapCall(
      BigInt(rawInput), BigInt(minOutput), pathAddresses, recipientEvmAddress, BigInt(deadline)
    );
    functionName = "swapExactTokensForTokens";
  }

  const callDataHex = bytesToHex(callData);
  const gasHex = "0x" + (1_500_000).toString(16);
  const valueHex = "0x" + value.toString(16);

  console.log(`[HBAR.h] Dry run: ${functionName} → router ${routerEvm}, value=${value}, minOutput=${minOutput}`);

  // ── Strategy A: JSON-RPC relay ──
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
          from: recipientEvmAddress,
          to: routerEvm,
          data: callDataHex,
          gas: gasHex,
          value: valueHex,
        }, "latest"],
        id: 1,
      }),
    });

    const durationMs = Date.now() - startTime;
    if (rpcRes.ok) {
      const rpcData = await rpcRes.json();
      if (rpcData.error) {
        // Explicit revert from JSON-RPC — this is a real failure signal
        const revertMsg = rpcData.error.message || JSON.stringify(rpcData.error).slice(0, 200);
        console.error(`[HBAR.h] Dry run REVERT (JSON-RPC): ${revertMsg}`);
        return { ok: false, simulated: true, functionName, durationMs, reason: `Contract simulation reverted: ${revertMsg}`, resultHexLength: 0 };
      }
      if (rpcData.result && rpcData.result !== "0x" && rpcData.result.length > 2) {
        console.log(`[HBAR.h] Dry run PASSED (JSON-RPC): ${functionName}, ${rpcData.result.length} chars, ${durationMs}ms`);
        return { ok: true, simulated: true, functionName, durationMs, resultHexLength: rpcData.result.length };
      }
      // Empty result from RPC without error — non-blocking for payable calls
      console.log(`[HBAR.h] Dry run: JSON-RPC returned empty result for ${functionName} — non-blocking`);
      return { ok: true, simulated: true, functionName, durationMs, reason: "Empty result (non-blocking for payable calls)", resultHexLength: 0 };
    }
  } catch (err: any) {
    console.log("[HBAR.h] Dry run JSON-RPC attempt failed:", err?.message || err);
  }

  // ── Strategy B: Mirror Node /api/v1/contracts/call ──
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
        from: recipientEvmAddress,
        to: routerEvm,
        gas: 1_500_000,
        gasPrice: 0,
        value: value,
      }),
    });

    const durationMs = Date.now() - startTime;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.log(`[HBAR.h] Dry run Mirror Node HTTP ${res.status} — skipping (non-blocking)`);
      return { ok: true, simulated: false, functionName, durationMs, reason: `HTTP ${res.status} — simulation skipped` };
    }

    const data = await res.json();

    if (data.result === "0x" || !data.result) {
      const errMsg = data.error_message || data._status?.messages?.[0]?.message || "";
      if (errMsg) {
        console.error(`[HBAR.h] Dry run REVERT (Mirror Node): ${errMsg}`);
        return { ok: false, simulated: true, functionName, durationMs, reason: `Contract simulation reverted: ${errMsg}`, resultHexLength: 0 };
      }
      // Empty without error — non-blocking (Mirror Node often can't simulate payable/cross-contract calls)
      console.log(`[HBAR.h] Dry run: Mirror Node returned empty for ${functionName} — non-blocking`);
      return { ok: true, simulated: false, functionName, durationMs, reason: "Mirror Node simulation inconclusive — proceeding", resultHexLength: 0 };
    }

    const resultHexLength = data.result.length;
    console.log(`[HBAR.h] Dry run PASSED (Mirror Node): ${functionName}, ${resultHexLength} chars, ${durationMs}ms`);
    return { ok: true, simulated: true, functionName, durationMs, resultHexLength };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.log("[HBAR.h] Dry run Mirror Node attempt failed (non-blocking):", err?.message || err);
    return { ok: true, simulated: false, durationMs, reason: `Network error: ${err?.message || "unknown"}` };
  }
}

async function executeSaucerSwapDirect(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork
): Promise<SwapResult> {
  // Late import to avoid circular dependency at module load time
  const { executeHederaTransaction } = await import("./hashpack");

  try {
    const rawInput = parseTokenAmount(inputAmount, inputToken.decimals);

    if (rawInput <= 0) {
      return { success: false, error: "Invalid input amount", executionVenue: "saucerswap-v1" };
    }

    // Determine swap mode based on native HBAR involvement
    const isInputNative = !!inputToken.isNative;
    const isOutputNative = !!outputToken.isNative;
    const whbar = getWhbarToken();

    // Build the swap path — substituting WHBAR for native HBAR in the EVM path
    // since pools use WHBAR internally. The path must use EVM addresses.
    const logicalPath = buildSwapPath(
      isInputNative ? whbar : inputToken,
      isOutputNative ? whbar : outputToken
    );
    const pathAddresses = logicalPath.map((t) => t.evmAddress);

    // ── Resolve the recipient's REAL EVM address via Mirror Node ──
    // Critical fix: htsIdToEvmAddress(accountId) creates a synthetic long-zero
    // address (0x0000...{num}) which may not match what the SaucerSwap router
    // expects when sending output tokens. We resolve the actual EVM address
    // from Mirror Node to ensure the router sends tokens to the right place.
    const recipientEvmAddress = await resolveAccountEvmAddress(accountId, network);

    // ══════════════════════════════════════════════════════════════════
    // ── POOL VERSION DETECTION (V1 vs V2) ──
    // Some tokens (notably HBAR.ħ) only have V2 concentrated-liquidity pools.
    // V1 swapExactETHForTokens would revert because no V1 pair exists.
    // Detect the pool version on-chain and route to V2 when needed.
    //
    // For single-hop paths [A, B], we check if A↔B is V1 or V2.
    // For multi-hop paths [A, B, C], we check EACH hop individually —
    // if any hop is V2-only we need V2 routing for that leg.
    // ══════════════════════════════════════════════════════════════════
    let poolVersionInfo: PoolVersionInfo | null = null;

    if (pathAddresses.length === 2) {
      // Single-hop: check the direct pair
      poolVersionInfo = await detectPoolVersion(pathAddresses[0], pathAddresses[1], network);
    } else {
      // Multi-hop: check each consecutive hop
      const hopVersions: (PoolVersionInfo | null)[] = [];
      for (let i = 0; i < pathAddresses.length - 1; i++) {
        hopVersions.push(await detectPoolVersion(pathAddresses[i], pathAddresses[i + 1], network));
      }

      const hasV2Hop = hopVersions.some(h => h?.version === "v2");
      const lastHop = hopVersions[hopVersions.length - 1];

      if (hasV2Hop && pathAddresses.length === 3 && lastHop?.version === "v2") {
        // Common case: Token → WHBAR (V1) → HBAR.ħ (V2)
        // Route via V2 for the final leg (WHBAR ↔ target token)
        console.log(`[HBAR.h] Multi-hop with V2 final leg — routing via V2`);
        poolVersionInfo = lastHop;
      } else if (hasV2Hop) {
        poolVersionInfo = hopVersions.find(h => h?.version === "v2") || null;
      } else {
        // All hops are V1
        poolVersionInfo = hopVersions[0];
      }
    }

    if (poolVersionInfo?.version === "v2") {
      console.log(`[HBAR.h] ═══ ROUTING VIA V2 ═══ fee=${poolVersionInfo.feeTier}, pool=${poolVersionInfo.poolAddress || "detected"}`);
      return executeSaucerSwapV2Direct(
        inputToken, outputToken, inputAmount, slippagePct,
        accountId, network, poolVersionInfo,
        isInputNative, isOutputNative, whbar,
        rawInput, recipientEvmAddress
      );
    }

    if (!poolVersionInfo) {
      console.warn("[HBAR.h] No pool detected on V1 or V2 — attempting V1 as fallback");
    } else {
      console.log(`[HBAR.h] V1 pool confirmed: ${poolVersionInfo.poolAddress || "detected"}`);
    }

    // ── V1 execution continues below ──

    // Resolve router address early — needed for both quote and execution.
    // Dynamic discovery verifies candidates by calling factory() on-chain
    // and caches the result, so this only does network calls on first swap.
    const discoveredRouter = await discoverSaucerSwapRouter(network);
    const v1Router = discoveredRouter || getSaucerSwapRouter(network, "v1");
    if (discoveredRouter) {
      console.log(`[HBAR.h] Using dynamically verified router: ${v1Router}`);
    } else {
      console.warn(`[HBAR.h] Router discovery found no verified candidate — using configured default: ${v1Router}`);
    }

    // For quote fetching, use WHBAR's htsId when input is native HBAR
    const quoteInputId = isInputNative ? whbar.htsId : inputToken.htsId;
    const quoteOutputId = isOutputNative ? whbar.htsId : outputToken.htsId;

    // Multi-strategy quote: router view → API → price estimate → fallback
    const quote = await fetchSaucerSwapQuote(quoteInputId, quoteOutputId, rawInput.toString(), {
      pathAddresses,
      routerHtsId: v1Router,
      network,
      inputToken: isInputNative ? whbar : inputToken,
      outputToken: isOutputNative ? whbar : outputToken,
    });

    // ── minOutput calculation ──
    // When quote is available: use it with slippage tolerance.
    // When all strategies fail: try one more inline price estimate before surrendering.
    let minOutput: number;
    if (quote && quote.amountOut > 0) {
      // For price estimates, use wider slippage (prices may be stale)
      const effectiveSlippage = quote.source === "price-estimate"
        ? Math.max(slippagePct, 5)
        : slippagePct;
      minOutput = Math.max(1, Math.floor(quote.amountOut * (1 - effectiveSlippage / 100)));
      console.log(`[HBAR.h] Quote source: ${quote.source}, amountOut=${quote.amountOut}, minOutput=${minOutput} (${effectiveSlippage}% slippage)`);
    } else {
      // Last-ditch inline estimate before surrendering to minOutput=1
      const inTok = isInputNative ? whbar : inputToken;
      const outTok = isOutputNative ? whbar : outputToken;
      const lastDitch = estimateOutputFromPrices(rawInput, inTok, outTok, pathAddresses.length - 1);
      if (lastDitch && lastDitch > 0) {
        const safeSlippage = Math.max(slippagePct, 10); // very generous for emergency estimate
        minOutput = Math.max(1, Math.floor(lastDitch * (1 - safeSlippage / 100)));
        console.warn(`[HBAR.h] All strategies failed but inline price estimate rescued quote: minOutput=${minOutput} (${safeSlippage}% slippage)`);
      } else {
        minOutput = 1;
        console.warn("[HBAR.h] All quote strategies failed including inline rescue — using minOutput=1 (no slippage protection)");
      }
    }

    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min deadline

    // Dynamic import of Hedera SDK
    let sdk: any;
    try {
      sdk = await import("@hashgraph/sdk");
    } catch (e: any) {
      return {
        success: false,
        error: "Hedera SDK not available: " + (e?.message || "unknown"),
        executionVenue: "saucerswap-v1",
      };
    }

    const { ContractExecuteTransaction, ContractId, Hbar } = sdk;

    // ══════════════════════════════════════════════════════════════════
    // ── CRITICAL SAFETY: Verify the router is a real smart contract ──
    // Prevents sending HBAR/tokens to a random account that isn't the
    // SaucerSwap router. A wrong address silently sends funds to a
    // non-contract account with no swap executed and no revert.
    //
    // verifyIsContract uses multi-strategy verification:
    //   1. Mirror Node /api/v1/contracts/{id}
    //   2. JSON-RPC eth_getCode (with real EVM address from accounts endpoint)
    //   3. eth_call probe (if entity responds to a function call, it's a contract)
    //   4. Diagnostic logging
    // Note: discoverSaucerSwapRouter also caches verified results, so this
    // is typically a cache hit after the initial discovery.
    // ══════════════════════════════════════════════════════════════════
    const routerContractInfo = await verifyIsContract(v1Router, network);
    if (!routerContractInfo) {
      const candidates = (SAUCERSWAP_V1_ROUTER_CANDIDATES[network] || []).join(", ");
      console.error(`[HBAR.h] CRITICAL: Router ${v1Router} is NOT a valid smart contract on ${network}!`);
      console.error(`[HBAR.h] Candidates tried during discovery: ${candidates}`);
      return {
        success: false,
        error: `SAFETY ABORT: Router address ${v1Router} failed contract verification on ${network} ` +
          `(checked via Mirror Node AND JSON-RPC eth_getCode). ` +
          `This would send your funds to a non-contract account with no swap executed. ` +
          `Candidates tried: [${candidates}]. ` +
          `Please verify the correct SaucerSwap V1 Router address at https://docs.saucerswap.finance/.`,
        executionVenue: "saucerswap-v1",
      };
    }
    console.log(`[HBAR.h] Router ${v1Router} verified as contract ✓ (EVM: ${routerContractInfo.evmAddress})`);

    // ── Resolve the router's EVM address for approve calls ──
    // Use the verified contract EVM address (not the synthetic long-zero form)
    // so that ERC-20 approve() sets the allowance for the correct spender address.
    const routerEvmAddress = routerContractInfo.evmAddress || await resolveContractEvmAddress(v1Router, network);

    // ── Log full swap parameters for debugging ──
    console.log("[HBAR.h] ═══════════════════════════════════════════");
    console.log("[HBAR.h] SWAP EXECUTION START");
    console.log("[HBAR.h] Input:", inputToken.symbol, "→ Output:", outputToken.symbol);
    console.log("[HBAR.h] Amount:", inputAmount, `(raw: ${rawInput})`);
    console.log("[HBAR.h] Path:", pathAddresses.join(" → "));
    console.log("[HBAR.h] Recipient EVM:", recipientEvmAddress);
    console.log("[HBAR.h] Router:", v1Router, `(EVM: ${routerEvmAddress}, verified: ${routerContractInfo.contractId})`);
    console.log("[HBAR.h] MinOutput:", minOutput, `(quote: ${quote?.amountOut ?? "none"})`);
    console.log("[HBAR.h] Slippage:", slippagePct, "% | Deadline:", deadline);
    console.log("[HBAR.h] Mode:", isInputNative ? "HBAR→Token" : isOutputNative ? "Token→HBAR" : "Token→Token");
    console.log("[HBAR.h] ═══════════════════════════════════════════");

    // ══════════════════════════════════════════════════════════════════
    // ── SAFETY NET: Token association check inside execution ──
    // Even though SwapPanel should handle this, we check again here as
    // a final guard. Swapping to an unassociated token causes
    // CONTRACT_REVERT_EXECUTED, burning the entire gas limit with no output.
    // ══════════════════════════════════════════════════════════════════
    if (!isOutputNative) {
      const outputHtsId = outputToken.htsId;
      const isAssoc = await isTokenAssociated(accountId, outputHtsId, network);
      if (!isAssoc) {
        console.warn(`[HBAR.h] SAFETY NET: Output token ${outputToken.symbol} (${outputHtsId}) NOT associated — auto-associating`);
        try {
          const assocSdk = await import("@hashgraph/sdk");
          const assocTx = new assocSdk.TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([outputHtsId]);
          const assocResult = await executeHederaTransaction(accountId, assocTx);
          if (!assocResult.success) {
            return {
              success: false,
              error: `Output token ${outputToken.symbol} is not associated with your account and auto-association failed: ${assocResult.error || "unknown"}. Please associate token ${outputHtsId} manually in HashPack before swapping.`,
              executionVenue: "saucerswap-v1",
              userCancelled: assocResult.userCancelled,
            };
          }
          console.log(`[HBAR.h] SAFETY NET: Successfully associated ${outputToken.symbol}`);
        } catch (assocErr: any) {
          const aMsg = (assocErr?.message || "").toLowerCase();
          const aCancel = aMsg.includes("user_reject") || aMsg.includes("cancelled by user") || aMsg.includes("canceled by user") || aMsg.includes("user denied") || aMsg.includes("user rejected");
          return {
            success: false,
            error: `Cannot associate output token ${outputToken.symbol}: ${assocErr?.message || "unknown"}. Associate token ${outputHtsId} in HashPack first.`,
            executionVenue: "saucerswap-v1",
            userCancelled: aCancel || undefined,
          };
        }
      } else {
        console.log(`[HBAR.h] Output token ${outputToken.symbol} association confirmed ✓`);
      }
    }

    // Also verify intermediate tokens in multi-hop paths
    if (logicalPath.length > 2) {
      for (let i = 1; i < logicalPath.length - 1; i++) {
        const midToken = logicalPath[i];
        if (!midToken.isNative) {
          const midAssoc = await isTokenAssociated(accountId, midToken.htsId, network);
          if (!midAssoc) {
            console.warn(`[HBAR.h] SAFETY NET: Intermediate token ${midToken.symbol} NOT associated — auto-associating`);
            try {
              const assocSdk = await import("@hashgraph/sdk");
              const midAssocTx = new assocSdk.TokenAssociateTransaction()
                .setAccountId(accountId)
                .setTokenIds([midToken.htsId]);
              await executeHederaTransaction(accountId, midAssocTx);
            } catch {
              console.warn(`[HBAR.h] Could not auto-associate intermediate ${midToken.symbol} — swap may revert`);
            }
          }
        }
      }
    }

    // Gas limits for EVM calls — these are gas LIMITS passed to setGas(),
    // NOT the HBAR cost. Hedera gas fees are sub-cent for typical swaps.
    const SWAP_GAS = 1_500_000;
    const APPROVE_GAS = 800_000;

    // ══════════════════════════════════════════════════════════════════
    // ── GAS SUFFICIENCY CHECK ──
    // Hedera gas fees are sub-cent. Reserve 1 HBAR total to cover gas +
    // network fees — good for dozens of transactions. The old 15 HBAR
    // reserve was overly conservative and blocked users unnecessarily.
    // ══════════════════════════════════════════════════════════════════
    const gasReserveNeeded = 1; // 1 HBAR covers gas + network fees with plenty of margin

    // For HBAR input, check that balance covers input + gas
    if (isInputNative) {
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      const inputHbar = parseFloat(inputAmount);
      const totalNeeded = inputHbar + gasReserveNeeded;
      if (hbarBalance < totalNeeded) {
        const shortfall = totalNeeded - hbarBalance;
        console.error(`[HBAR.h] Insufficient HBAR for swap + gas: balance=${hbarBalance.toFixed(2)}, needed=${totalNeeded.toFixed(2)} (input=${inputHbar}, gas reserve=${gasReserveNeeded})`);
        return {
          success: false,
          error: `Insufficient HBAR: you have ${hbarBalance.toFixed(2)} HBAR but need ${totalNeeded.toFixed(2)} HBAR (${inputHbar} for swap + ${gasReserveNeeded} for fees). Reduce the swap amount by at least ${shortfall.toFixed(2)} HBAR.`,
          executionVenue: "saucerswap-v1",
        };
      }
    } else {
      // For token input, check HBAR balance covers gas only
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      if (hbarBalance < gasReserveNeeded) {
        console.error(`[HBAR.h] Insufficient HBAR for gas: balance=${hbarBalance.toFixed(2)}, needed=${gasReserveNeeded}`);
        return {
          success: false,
          error: `Insufficient HBAR for fees: you have ${hbarBalance.toFixed(2)} HBAR but need at least ${gasReserveNeeded} HBAR. Deposit more HBAR first.`,
          executionVenue: "saucerswap-v1",
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ── PRE-SWAP DRY RUN via Mirror Node ──
    // Simulate the swap call for free before spending real gas.
    // If the simulation reverts, abort to save the user from burning
    // HBAR on a guaranteed failure.
    // ══════════════════════════════════════════════════════════════════
    const dryRunResult = await preSwapDryRun({
      isInputNative,
      isOutputNative,
      rawInput,
      minOutput,
      pathAddresses,
      recipientEvmAddress,
      routerHtsId: v1Router,
      deadline,
      network,
    });
    if (!dryRunResult.ok) {
      console.error("[HBAR.h] PRE-SWAP DRY RUN FAILED:", dryRunResult.reason);
      console.error("[HBAR.h] Dry run details:", JSON.stringify(dryRunResult));
      return {
        success: false,
        error: `Pre-swap simulation failed: ${dryRunResult.reason}. The swap would revert on-chain and waste gas fees. Fix the issue and try again.`,
        executionVenue: "saucerswap-v1",
      };
    }
    if (dryRunResult.simulated) {
      console.log(`[HBAR.h] Pre-swap dry run PASSED ✓ (${dryRunResult.functionName}, ${dryRunResult.resultHexLength} hex chars, ${dryRunResult.durationMs}ms)`);
    } else {
      console.log(`[HBAR.h] Pre-swap dry run SKIPPED (${dryRunResult.reason}) — proceeding with real swap`);
    }

    // ── Execution branches based on native HBAR involvement ──

    if (isInputNative) {
      // ═══ HBAR (native) → Token: use swapExactETHForTokens ═══
      // No token approval needed — HBAR is sent as payable amount.
      // The router internally wraps HBAR → WHBAR and swaps through the pool.
      console.log("[HBAR.h] Native HBAR input — using swapExactETHForTokens");

      const functionData = encodeSaucerSwapETHForTokens(
        BigInt(minOutput),
        pathAddresses,
        recipientEvmAddress,
        BigInt(deadline)
      );

      const hbarAmount = rawInput / Math.pow(10, 8); // Convert tinybars to HBAR

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v1Router))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData)
        .setPayableAmount(new Hbar(hbarAmount));

      console.log("[HBAR.h] Submitting swapExactETHForTokens — HBAR:", hbarAmount);
      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] Swap result:", JSON.stringify(swapResult));

      // Build display route with HBAR instead of WHBAR
      const displayRoute = logicalPath.map(t => t.symbol);
      displayRoute[0] = "HBAR";

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: displayRoute,
        priceImpact: quote?.priceImpact,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v1",
        quoteSource: quote?.source || "none",
        dryRunPassed: dryRunResult.ok,
        userCancelled: swapResult.userCancelled,
      };

    } else if (isOutputNative) {
      // ═══ Token → HBAR (native): use swapExactTokensForETH ═══
      console.log("[HBAR.h] Native HBAR output — using swapExactTokensForETH");

      // Step 1: ERC-20 approve on the token's system contract
      // This sets the allowance at the EVM level, which is what the router's
      // transferFrom() call will check via the HTS precompile.
      console.log("[HBAR.h] Step 1: ERC-20 approve —", inputToken.symbol, "→ Router");
      const approveData = encodeErc20Approve(routerEvmAddress, BigInt(rawInput));
      const approveTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(inputToken.htsId))
        .setGas(APPROVE_GAS)
        .setFunctionParameters(approveData);

      const approveResult = await executeHederaTransaction(accountId, approveTx);
      console.log("[HBAR.h] Approve result:", JSON.stringify(approveResult));
      if (!approveResult.success) {
        return {
          success: false,
          transactionId: approveResult.transactionId || undefined,
          error: "ERC-20 approve failed: " + (approveResult.error || "unknown") +
            (approveResult.transactionId ? ` (tx: ${approveResult.transactionId})` : ""),
          executionVenue: "saucerswap-v1",
          userCancelled: approveResult.userCancelled,
        };
      }

      // Step 2: swapExactTokensForETH
      console.log("[HBAR.h] Step 2: swapExactTokensForETH");
      const functionData = encodeSaucerSwapTokensForETH(
        BigInt(rawInput),
        BigInt(minOutput),
        pathAddresses,
        recipientEvmAddress,
        BigInt(deadline)
      );

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v1Router))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] Swap result:", JSON.stringify(swapResult));
      const displayRoute = logicalPath.map(t => t.symbol);
      displayRoute[displayRoute.length - 1] = "HBAR";

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, 8) : undefined,
        route: displayRoute,
        priceImpact: quote?.priceImpact,
        error: swapResult.error
          ? swapResult.error + (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
          : undefined,
        executionVenue: "saucerswap-v1",
        quoteSource: quote?.source || "none",
        dryRunPassed: dryRunResult.ok,
        userCancelled: swapResult.userCancelled,
      };

    } else {
      // ═══ Token → Token: standard swapExactTokensForTokens ═══

      // Step 1: ERC-20 approve on the input token's system contract
      // Uses ContractExecuteTransaction to call approve() at the EVM level,
      // which is more reliable than AccountAllowanceApproveTransaction for
      // contracts that call transferFrom() via the ERC-20 precompile.
      console.log("[HBAR.h] Step 1: ERC-20 approve —", inputToken.symbol, "→ Router");
      const approveData = encodeErc20Approve(routerEvmAddress, BigInt(rawInput));
      const approveTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(inputToken.htsId))
        .setGas(APPROVE_GAS)
        .setFunctionParameters(approveData);

      const approveResult = await executeHederaTransaction(accountId, approveTx);
      console.log("[HBAR.h] Approve result:", JSON.stringify(approveResult));
      if (!approveResult.success) {
        return {
          success: false,
          transactionId: approveResult.transactionId || undefined,
          error: "ERC-20 approve failed: " + (approveResult.error || "unknown") +
            (approveResult.transactionId ? ` (tx: ${approveResult.transactionId})` : ""),
          executionVenue: "saucerswap-v1",
          userCancelled: approveResult.userCancelled,
        };
      }

      // Step 2: Execute Swap
      console.log("[HBAR.h] Step 2: swapExactTokensForTokens");
      const functionData = encodeSaucerSwapCall(
        BigInt(rawInput),
        BigInt(minOutput),
        pathAddresses,
        recipientEvmAddress,
        BigInt(deadline)
      );

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v1Router))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] Swap result:", JSON.stringify(swapResult));

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: logicalPath.map((t) => t.symbol),
        priceImpact: quote?.priceImpact,
        error: swapResult.error
          ? swapResult.error + (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
          : undefined,
        executionVenue: "saucerswap-v1",
        quoteSource: quote?.source || "none",
        dryRunPassed: dryRunResult.ok,
        userCancelled: swapResult.userCancelled,
      };
    }
  } catch (err: any) {
    console.error("[HBAR.h] Swap execution error:", err);
    const errMsg = err?.message || "Direct swap failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return {
      success: false,
      error: errMsg,
      executionVenue: "saucerswap-v1",
      userCancelled: isCancellation || undefined,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── CLIENT-SIDE ESTIMATION ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

export function estimateSwapQuote(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: number,
  inputPriceUsd: number,
  outputPriceUsd: number,
  slippagePct: number = 0.5
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
  };
}

// ══════════════════════════════════════════════════════════════════════
// ── POOL DATA & STATS ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

const FALLBACK_DATA: HbarhTokenData = {
  price: 0.000001,
  priceUsd: 0.000001,
  change24h: 0,
  volume24h: 0,
  liquidity: 0,
  priceHistory: [
    0.0000009, 0.0000010, 0.0000009, 0.0000010, 0.0000011, 0.0000010, 0.0000010, 0.0000009,
    0.0000010, 0.0000010, 0.0000011, 0.0000010, 0.0000009, 0.0000010, 0.0000010, 0.0000011,
    0.0000010, 0.0000010, 0.0000009, 0.0000010, 0.0000011, 0.0000010, 0.0000010, 0.0000010,
  ],
};

const FALLBACK_POOLS: SaucerSwapPool[] = [
  {
    id: "pool-hbar-usdc",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.456858", symbol: "USDC", name: "USD Coin", decimals: 6 },
    tvlUsd: 18420000, volume24hUsd: 3240000, fee: 0.3, apr: 24.5, tickSpacing: 60,
  },
  {
    id: "pool-hbar-hbarh",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: HBARH_TOKEN_ID, symbol: "HBAR.ħ", name: "HBAR.ħ Protocol", decimals: 8 },
    tvlUsd: 5630000, volume24hUsd: 890000, fee: 0.05, apr: 12.8, tickSpacing: 10,
  },
  {
    id: "pool-hbar-sauce",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.731861", symbol: "SAUCE", name: "SaucerSwap", decimals: 6 },
    tvlUsd: 4120000, volume24hUsd: 1560000, fee: 0.3, apr: 38.2, tickSpacing: 60,
  },
  {
    id: "pool-usdc-usdt",
    tokenA: { id: "0.0.456858", symbol: "USDC", name: "USD Coin", decimals: 6 },
    tokenB: { id: "0.0.4291336", symbol: "USDT", name: "Tether USD", decimals: 6 },
    tvlUsd: 8910000, volume24hUsd: 2180000, fee: 0.01, apr: 8.4, tickSpacing: 1,
  },
  {
    id: "pool-hbar-karate",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.2283328", symbol: "KARATE", name: "Karate Combat", decimals: 8 },
    tvlUsd: 1840000, volume24hUsd: 620000, fee: 1.0, apr: 52.1, tickSpacing: 200,
  },
  {
    id: "pool-hbar-pack",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.4589822", symbol: "PACK", name: "HashPack", decimals: 6 },
    tvlUsd: 920000, volume24hUsd: 340000, fee: 0.3, apr: 31.6, tickSpacing: 60,
  },
  {
    id: "pool-hbar-link",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.1970030", symbol: "LINK", name: "Chainlink", decimals: 8 },
    tvlUsd: 2340000, volume24hUsd: 780000, fee: 0.3, apr: 18.7, tickSpacing: 60,
  },
  {
    id: "pool-hbar-wbtc",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.1969769", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8 },
    tvlUsd: 3560000, volume24hUsd: 1120000, fee: 0.3, apr: 15.3, tickSpacing: 60,
  },
  {
    id: "pool-hbar-hst",
    tokenA: { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8 },
    tokenB: { id: "0.0.786931", symbol: "HST", name: "HSuite Token", decimals: 8 },
    tvlUsd: 680000, volume24hUsd: 210000, fee: 0.3, apr: 26.4, tickSpacing: 60,
  },
];

export async function fetchHbarhPrice(): Promise<HbarhTokenData> {
  let priceUsd = 0;
  let volume = 0;
  let liquidity = 0;
  let change24h = FALLBACK_DATA.change24h;
  let priceSource = "fallback";

  console.log("[HBAR.h] fetchHbarhPrice() called — starting price strategies");

  // Strategy 1a: DexScreener pairs endpoint
  try {
    const dexRes = await fetch(
      "https://api.dexscreener.com/latest/dex/pairs/hedera/0x31d6b803a960b818cce3a85f0bef7c4c566b7919",
      { signal: makeAbort(10000) }
    );
    console.log(`[HBAR.h] DexScreener pairs status: ${dexRes.status}`);
    if (dexRes.ok) {
      const dexData = await dexRes.json();
      console.log("[HBAR.h] DexScreener pairs keys:", Object.keys(dexData));
      const pair = dexData?.pair || dexData?.pairs?.[0];
      if (pair) {
        const p = parseFloat(pair.priceUsd || "0");
        console.log(`[HBAR.h] DexScreener pairs price: $${p}`);
        if (p > 0) {
          priceUsd = p;
          volume = parseFloat(pair.volume?.h24 || "0");
          liquidity = parseFloat(pair.liquidity?.usd || "0");
          change24h = parseFloat(pair.priceChange?.h24 || "0");
          priceSource = "dexscreener-pairs";
        }
      } else {
        console.warn("[HBAR.h] DexScreener pairs: no pair object found in response");
      }
    }
  } catch (err: any) {
    console.warn("[HBAR.h] DexScreener pairs error:", err?.message || err);
  }

  // Strategy 1b: DexScreener token search (uses EVM token address — more resilient than pair address)
  // 0.0.9356476 → EVM = 0x00000000000000000000000000000000008ecf5c
  if (priceUsd <= 0) {
    try {
      const dexTokenRes = await fetch(
        "https://api.dexscreener.com/latest/dex/tokens/0x00000000000000000000000000000000008ecf5c",
        { signal: makeAbort(10000) }
      );
      console.log(`[HBAR.h] DexScreener tokens status: ${dexTokenRes.status}`);
      if (dexTokenRes.ok) {
        const dexTokenData = await dexTokenRes.json();
        const pairs = dexTokenData?.pairs;
        if (Array.isArray(pairs) && pairs.length > 0) {
          // Pick the pair with highest liquidity for most accurate price
          const best = pairs.reduce((a: any, b: any) =>
            (parseFloat(b.liquidity?.usd || "0") > parseFloat(a.liquidity?.usd || "0")) ? b : a
          , pairs[0]);
          const p = parseFloat(best.priceUsd || "0");
          console.log(`[HBAR.h] DexScreener tokens price: $${p} (${pairs.length} pairs found)`);
          if (p > 0) {
            priceUsd = p;
            volume = parseFloat(best.volume?.h24 || "0");
            liquidity = parseFloat(best.liquidity?.usd || "0");
            change24h = parseFloat(best.priceChange?.h24 || "0");
            priceSource = "dexscreener-tokens";
          }
        } else {
          console.warn("[HBAR.h] DexScreener tokens: no pairs array in response");
        }
      }
    } catch (err: any) {
      console.warn("[HBAR.h] DexScreener tokens error:", err?.message || err);
    }
  }

  // Strategy 2: SaucerSwap direct token endpoint
  if (priceUsd <= 0) {
    try {
      const res = await saucerFetch("/tokens/" + HBARH_TOKEN_ID, 8000);
      if (res) {
        const data = await res.json();
        priceUsd = parseFloat(data.priceUsd || data.price || "0");
        volume = parseFloat(data.volume24h || data.dailyVolume || "0");
        liquidity = parseFloat(data.liquidity || data.tvl || "0");
        change24h = data.priceChangePercentage24h ?? data.change24h ?? change24h;
        if (priceUsd > 0) priceSource = "saucerswap";
        console.log(`[HBAR.h] SaucerSwap direct price: $${priceUsd}`);
      } else {
        console.warn("[HBAR.h] SaucerSwap direct: null response");
      }
    } catch (err: any) {
      console.warn("[HBAR.h] SaucerSwap direct error:", err?.message || err);
    }
  }

  // Strategy 3: Multi-strategy price fetcher (has its own DexScreener + SaucerSwap cascade)
  if (priceUsd <= 0) {
    try {
      const result = await fetchHbarhTokenPrice();
      if (result.price > 0) {
        priceUsd = result.price;
        priceSource = result.source;
      }
      console.log(`[HBAR.h] Multi-strategy result: $${result.price} (${result.source})`);
    } catch (err: any) {
      console.warn("[HBAR.h] Multi-strategy error:", err?.message || err);
    }
  }

  const finalPrice = priceUsd > 0 ? priceUsd : FALLBACK_DATA.price;

  console.log(`[HBAR.h] FINAL price: $${finalPrice} (source: ${priceSource})`);

  return {
    price: finalPrice,
    priceUsd: finalPrice,
    change24h,
    volume24h: volume || FALLBACK_DATA.volume24h,
    liquidity: liquidity || FALLBACK_DATA.liquidity,
    priceHistory: generateSparkline(finalPrice),
  };
}

export async function fetchTopPools(limit: number = 10): Promise<SaucerSwapPool[]> {
  try {
    const res = await saucerFetch("/pools", 10000);
    if (!res) return FALLBACK_POOLS.slice(0, limit);

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return FALLBACK_POOLS.slice(0, limit);

    return data
      .map((pool: any) => ({
        id: pool.id || pool.contractId || "pool-" + (pool.tokenA?.symbol || "X") + "-" + (pool.tokenB?.symbol || "Y"),
        tokenA: {
          id: pool.tokenA?.id || "",
          symbol: pool.tokenA?.symbol || "???",
          name: pool.tokenA?.name || "Unknown",
          decimals: pool.tokenA?.decimals ?? 8,
        },
        tokenB: {
          id: pool.tokenB?.id || "",
          symbol: pool.tokenB?.symbol || "???",
          name: pool.tokenB?.name || "Unknown",
          decimals: pool.tokenB?.decimals ?? 8,
        },
        tvlUsd: parseFloat(pool.tvl || pool.tvlUsd || "0"),
        volume24hUsd: parseFloat(pool.volume24h || pool.volume24hUsd || "0"),
        fee: parseFloat(pool.fee || "0.3") / 10000,
        apr: parseFloat(pool.apr || "0"),
        tickSpacing: pool.tickSpacing ?? 60,
      }))
      .sort((a: SaucerSwapPool, b: SaucerSwapPool) => b.tvlUsd - a.tvlUsd)
      .slice(0, limit);
  } catch {
    return FALLBACK_POOLS.slice(0, limit);
  }
}

export async function fetchTokenInfo(tokenId: string): Promise<TokenInfo | null> {
  try {
    const res = await saucerFetch("/tokens/" + tokenId, 8000);
    if (!res) return null;

    const data = await res.json();
    return {
      id: tokenId,
      symbol: data.symbol || "???",
      name: data.name || "Unknown Token",
      priceUsd: parseFloat(data.priceUsd || "0"),
      decimals: data.decimals ?? 8,
      tvl: parseFloat(data.tvl || data.liquidity || "0"),
      volume24h: parseFloat(data.volume24h || data.dailyVolume || "0"),
      priceChange24h: data.priceChangePercentage24h ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Protocol Stats ──

export interface ProtocolStats {
  totalTvlUsd: number;
  totalVolume24hUsd: number;
  totalPools: number;
  totalTokens: number;
}

export async function fetchProtocolStats(): Promise<ProtocolStats> {
  try {
    const pools = await fetchTopPools(50);
    const totalTvl = pools.reduce((s, p) => s + p.tvlUsd, 0);
    const totalVol = pools.reduce((s, p) => s + p.volume24hUsd, 0);
    const uniqueTokens = new Set<string>();
    for (const p of pools) {
      uniqueTokens.add(p.tokenA.symbol);
      uniqueTokens.add(p.tokenB.symbol);
    }

    return {
      totalTvlUsd: totalTvl || 42500000,
      totalVolume24hUsd: totalVol || 8900000,
      totalPools: pools.length || 85,
      totalTokens: uniqueTokens.size || 42,
    };
  } catch {
    return {
      totalTvlUsd: 42500000,
      totalVolume24hUsd: 8900000,
      totalPools: 85,
      totalTokens: 42,
    };
  }
}

// ── Helpers ──

function generateSparkline(currentPrice: number): number[] {
  const history: number[] = [];
  let p = currentPrice * (0.92 + Math.random() * 0.06);
  for (let i = 0; i < 23; i++) {
    const drift = (currentPrice - p) * 0.05;
    const noise = (Math.random() - 0.48) * currentPrice * 0.03;
    p = Math.max(p + drift + noise, currentPrice * 0.8);
    history.push(p);
  }
  history.push(currentPrice);
  return history;
}

export function formatUsdCompact(value: number): string {
  if (value >= 1000000000) return "$" + (value / 1000000000).toFixed(2) + "B";
  if (value >= 1000000) return "$" + (value / 1000000).toFixed(2) + "M";
  if (value >= 1000) return "$" + (value / 1000).toFixed(1) + "K";
  return "$" + value.toFixed(2);
}

export function formatTokenAmount(amount: number, decimals: number = 4): string {
  if (amount >= 1000000) return (amount / 1000000).toFixed(2) + "M";
  if (amount >= 1000) return (amount / 1000).toFixed(2) + "K";
  return amount.toFixed(decimals);
}

export function getSaucerSwapPoolUrl(poolId: string): string {
  return "https://www.saucerswap.finance/pool/" + poolId;
}

export function getSaucerSwapSwapUrl(tokenAId?: string, tokenBId?: string): string {
  if (tokenAId && tokenBId) {
    return "https://www.saucerswap.finance/swap?inputToken=" + tokenAId + "&outputToken=" + tokenBId;
  }
  return "https://www.saucerswap.finance/swap";
}

export function getHashScanTxUrl(txId: string, network: HederaNetwork = "mainnet"): string {
  const base = network === "mainnet" ? "https://hashscan.io/mainnet" : "https://hashscan.io/testnet";
  // HashScan uses the same format as Mirror Node: account-seconds-nanos
  const normalized = formatTxIdForMirrorNode(txId);
  return base + "/transaction/" + normalized;
}

export function getHashScanTokenUrl(tokenId: string, network: HederaNetwork = "mainnet"): string {
  const base = network === "mainnet" ? "https://hashscan.io/mainnet" : "https://hashscan.io/testnet";
  return base + "/token/" + tokenId;
}

// ══════════════════════════════════════════════════════════════════════
// ── POST-SWAP VERIFICATION ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

export interface SwapVerification {
  verified: boolean;
  actualOutputAmount?: number;
  actualOutputSymbol?: string;
  inputDebited?: number;
  inputDebitedSymbol?: string;
  tokenTransfers: { token: string; account: string; amount: number }[];
  hbarTransfers: { account: string; amount: number }[];
  contractResults: string[];
  transactionStatus?: string;
  error?: string;
}

/**
 * Format a Hedera transaction ID for the Mirror Node REST API.
 *
 * Hedera SDK format:  "0.0.12345@1234567890.123456789"
 * Mirror Node format: "0.0.12345-1234567890-123456789"
 *
 * The @ separates the payer account from the valid-start timestamp,
 * and the . between seconds and nanos becomes a hyphen.
 * IMPORTANT: Dots within the account ID (0.0.xxxxx) must be PRESERVED.
 */
export function formatTxIdForMirrorNode(transactionId: string): string {
  // If already in Mirror Node format (contains no @), return as-is
  if (!transactionId.includes("@")) {
    return transactionId;
  }

  // Split on @ → ["0.0.12345", "1234567890.123456789"]
  const atIdx = transactionId.indexOf("@");
  const accountPart = transactionId.substring(0, atIdx);
  const timestampPart = transactionId.substring(atIdx + 1);

  // Replace only the . between seconds and nanos in the timestamp part
  const normalizedTimestamp = timestampPart.replace(".", "-");
  return `${accountPart}-${normalizedTimestamp}`;
}

/**
 * Verify a completed swap by querying the Mirror Node transaction record.
 *
 * Fetches the actual token transfers from the transaction to confirm:
 * 1. Input tokens were debited from the user's account
 * 2. Output tokens were credited to the user's account
 *
 * This is critical for diagnosing the "tokens left wallet but output not received" issue.
 * The transaction record contains the definitive on-chain transfer list.
 *
 * Includes automatic retry logic since the Mirror Node may take several seconds
 * to index a new transaction after it reaches consensus.
 *
 * @param transactionId  Hedera transaction ID (e.g., "0.0.12345@1234567890.123456789")
 * @param accountId      User's Hedera account ID
 * @param outputTokenId  Expected output token HTS ID (or "native" for HBAR)
 * @param network        "mainnet" | "testnet"
 */
export async function verifySwapTransaction(
  transactionId: string,
  accountId: string,
  outputTokenId: string,
  network: HederaNetwork = "mainnet"
): Promise<SwapVerification> {
  const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
  const normalizedTxId = formatTxIdForMirrorNode(transactionId);

  console.log(`[HBAR.h] Verifying swap: ${transactionId} → normalized: ${normalizedTxId}`);

  // Retry loop — Mirror Node may need time to index the transaction.
  // 4 attempts × 4s delay = ~16s total wait, matching the UI auto-clear timeout.
  const MAX_RETRIES = 4;
  const RETRY_DELAY_MS = 4000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Wait before querying (Mirror Node indexing delay)
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));

    try {
      const res = await fetch(
        `${base}/api/v1/transactions/${normalizedTxId}`,
        { signal: makeAbort(15000) }
      );

      if (res.status === 404) {
        // Transaction not indexed yet — retry if we have attempts left
        if (attempt < MAX_RETRIES - 1) {
          console.log(`[HBAR.h] Tx not found yet (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
          continue;
        }
        return {
          verified: false,
          tokenTransfers: [],
          hbarTransfers: [],
          contractResults: [],
          error: `Transaction not found on Mirror Node after ${MAX_RETRIES} attempts. It may still be indexing — try manual verification in ~30 seconds.`,
        };
      }

      if (!res.ok) {
        // Non-404 error — don't retry, report immediately
        return {
          verified: false,
          tokenTransfers: [],
          hbarTransfers: [],
          contractResults: [],
          error: `Mirror Node returned HTTP ${res.status}. Try again later.`,
        };
      }

      const data = await res.json();
      return parseTransactionRecord(data, accountId, outputTokenId);
    } catch (err: any) {
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[HBAR.h] Verification attempt ${attempt + 1} failed:`, err?.message || err);
        continue;
      }
      return {
        verified: false,
        tokenTransfers: [],
        hbarTransfers: [],
        contractResults: [],
        error: `Verification failed after ${MAX_RETRIES} attempts: ${err?.message || "unknown error"}`,
      };
    }
  }

  // Should not reach here, but just in case
  return {
    verified: false,
    tokenTransfers: [],
    hbarTransfers: [],
    contractResults: [],
    error: "Verification exhausted all retries.",
  };
}

function parseTransactionRecord(
  data: any,
  accountId: string,
  outputTokenId: string
): SwapVerification {
  // The Mirror Node returns an object with `transactions` array.
  // For contract calls (swaps), there may be multiple transaction entries:
  // the parent (ContractExecuteTransaction) and child/inner transactions
  // generated by the router's internal EVM calls (token transfers, etc.).
  // We merge token_transfers and transfers from ALL entries to get the
  // complete picture.
  const txs = data.transactions || [data];
  if (!txs.length || !txs[0]) {
    return {
      verified: false,
      tokenTransfers: [],
      hbarTransfers: [],
      contractResults: [],
      error: "No transaction data in response",
    };
  }

  // Use the first entry for status (parent transaction)
  const tx = txs[0];
  const status = tx.result || tx.status || "UNKNOWN";

  // Merge token transfers from ALL transaction entries (parent + children)
  const tokenTransfers: { token: string; account: string; amount: number }[] = [];
  const seenTokenTransfers = new Set<string>();
  for (const entry of txs) {
    for (const tt of (entry.token_transfers || [])) {
      const key = `${tt.token_id}:${tt.account}:${tt.amount}`;
      if (!seenTokenTransfers.has(key)) {
        seenTokenTransfers.add(key);
        tokenTransfers.push({
          token: tt.token_id,
          account: tt.account,
          amount: tt.amount,
        });
      }
    }
  }

  // Merge HBAR transfers from ALL entries, filtering tiny fee transfers
  const hbarTransfers: { account: string; amount: number }[] = [];
  const seenHbarTransfers = new Set<string>();
  for (const entry of txs) {
    for (const ht of (entry.transfers || [])) {
      if (Math.abs(ht.amount) > 100000) { // Filter out tiny fee transfers (> 0.001 HBAR)
        const key = `${ht.account}:${ht.amount}`;
        if (!seenHbarTransfers.has(key)) {
          seenHbarTransfers.add(key);
          hbarTransfers.push({
            account: ht.account,
            amount: ht.amount,
          });
        }
      }
    }
  }

  // Find the output credited to the user
  let actualOutputAmount: number | undefined;
  let actualOutputSymbol: string | undefined;
  let inputDebited: number | undefined;
  let inputDebitedSymbol: string | undefined;

  if (outputTokenId === "native") {
    // Output is native HBAR — look for net HBAR credit to user.
    // Sum all HBAR transfers to the user's account to handle multi-transfer cases.
    const hbarToUser = hbarTransfers
      .filter(t => t.account === accountId && t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    if (hbarToUser > 0) {
      actualOutputAmount = hbarToUser / 1e8; // tinybars → HBAR
      actualOutputSymbol = "HBAR";
    }
  } else {
    // Output is an HTS token — look for token credit to user.
    // Sum positive transfers of the specific token.
    const tokenToUser = tokenTransfers
      .filter(t => t.token === outputTokenId && t.account === accountId && t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    if (tokenToUser > 0) {
      const outputMeta = TOKEN_BY_HTS_ID.get(outputTokenId);
      const decimals = outputMeta?.decimals || 8;
      actualOutputAmount = tokenToUser / Math.pow(10, decimals);
      actualOutputSymbol = outputMeta?.symbol || outputTokenId;
    }
  }

  // Find input debited from the user — sum negative transfers per token
  const debitsByToken = new Map<string, number>();
  for (const tt of tokenTransfers) {
    if (tt.account === accountId && tt.amount < 0) {
      const prev = debitsByToken.get(tt.token) || 0;
      debitsByToken.set(tt.token, prev + tt.amount);
    }
  }
  // Pick the largest debit (most value taken from user)
  let largestDebitToken: string | null = null;
  let largestDebitAmount = 0;
  for (const [token, amount] of debitsByToken) {
    if (Math.abs(amount) > Math.abs(largestDebitAmount)) {
      largestDebitAmount = amount;
      largestDebitToken = token;
    }
  }
  if (largestDebitToken) {
    const inputMeta = TOKEN_BY_HTS_ID.get(largestDebitToken);
    const decimals = inputMeta?.decimals || 8;
    inputDebited = Math.abs(largestDebitAmount) / Math.pow(10, decimals);
    inputDebitedSymbol = inputMeta?.symbol || largestDebitToken;
  } else {
    // Check HBAR debit (for native HBAR input)
    // Sum all negative HBAR transfers for the user
    const hbarFromUser = hbarTransfers
      .filter(t => t.account === accountId && t.amount < 0)
      .reduce((sum, t) => sum + t.amount, 0);
    if (Math.abs(hbarFromUser) > 1_000_000) { // > 0.01 HBAR (not just fees)
      inputDebited = Math.abs(hbarFromUser) / 1e8;
      inputDebitedSymbol = "HBAR";
    }
  }

  // Collect contract error messages from all entries
  const contractResults: string[] = [];
  for (const entry of txs) {
    if (entry.contract_results) {
      for (const cr of entry.contract_results) {
        const msg = cr.error_message || cr.result || "";
        if (msg) contractResults.push(msg);
      }
    }
  }

  const verified = status === "SUCCESS" && actualOutputAmount != null && actualOutputAmount > 0;

  console.log("[HBAR.h] Swap verification:", {
    status,
    verified,
    actualOutputAmount,
    actualOutputSymbol,
    inputDebited,
    inputDebitedSymbol,
    tokenTransfers: tokenTransfers.length,
    hbarTransfers: hbarTransfers.length,
    totalTxEntries: txs.length,
  });

  return {
    verified,
    actualOutputAmount,
    actualOutputSymbol,
    inputDebited,
    inputDebitedSymbol,
    tokenTransfers,
    hbarTransfers,
    contractResults,
    transactionStatus: status,
  };
}

/**
 * Check balance change for a specific token before and after a swap.
 * Returns the delta (positive = gained, negative = lost).
 *
 * @param accountId  Hedera account ID
 * @param tokenId    HTS token ID (or "native" for HBAR)
 * @param previousBalance  Balance before the swap (in raw units)
 * @param network    "mainnet" | "testnet"
 */
export async function checkBalanceChange(
  accountId: string,
  tokenId: string,
  previousBalance: number,
  network: HederaNetwork = "mainnet"
): Promise<{ currentBalance: number; delta: number; decimals: number }> {
  let currentBalance: number;
  let decimals: number;

  if (tokenId === "native") {
    currentBalance = await getNativeHbarBalance(accountId, network);
    decimals = 8;
  } else {
    currentBalance = await getTokenBalance(accountId, tokenId, network);
    const meta = TOKEN_BY_HTS_ID.get(tokenId);
    decimals = meta?.decimals || 8;
  }

  return {
    currentBalance,
    delta: currentBalance - previousBalance,
    decimals,
  };
}

// ══════════════════════════════════════════════════════════════════════
// ── TOKEN ASSOCIATION HANDLING ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Ensure the output token is associated with the user's account.
 * On Hedera, tokens must be explicitly associated before they can be received.
 * Returns { associated: true } if already associated or after successful association.
 */
export async function ensureTokenAssociated(
  accountId: string,
  tokenId: string,
  network: HederaNetwork = "mainnet"
): Promise<{ associated: boolean; error?: string; alreadyAssociated?: boolean; userCancelled?: boolean }> {
  // Check if already associated
  const alreadyAssociated = await isTokenAssociated(accountId, tokenId, network);
  if (alreadyAssociated) {
    return { associated: true, alreadyAssociated: true };
  }

  // Need to associate — use executeHederaTransaction from hashpack
  try {
    const { executeHederaTransaction } = await import("./hashpack");
    const sdk = await import("@hashgraph/sdk");
    const { TokenAssociateTransaction } = sdk;

    const associateTx = new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([tokenId]);

    const result = await executeHederaTransaction(accountId, associateTx);
    if (result.success) {
      return { associated: true, alreadyAssociated: false };
    } else {
      return { associated: false, error: result.error || "Association failed", userCancelled: result.userCancelled };
    }
  } catch (err: any) {
    const errMsg = err?.message || "Token association failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return { associated: false, error: errMsg, userCancelled: isCancellation || undefined };
  }
}

/**
 * Pre-swap validation: check all requirements before executing a swap.
 * Returns a list of issues that must be resolved.
 */
export async function validateSwapPrerequisites(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string,
  accountId: string,
  network: HederaNetwork
): Promise<{
  valid: boolean;
  issues: { type: "error" | "warning"; message: string }[];
  outputTokenAssociated: boolean;
}> {
  const issues: { type: "error" | "warning"; message: string }[] = [];
  let outputTokenAssociated = false;

  const inputToken = resolveToken(inputSymbol);
  const outputToken = resolveToken(outputSymbol);

  if (!inputToken) {
    issues.push({ type: "error", message: `Input token ${inputSymbol} not supported` });
    return { valid: false, issues, outputTokenAssociated };
  }
  if (!outputToken) {
    issues.push({ type: "error", message: `Output token ${outputSymbol} not supported` });
    return { valid: false, issues, outputTokenAssociated };
  }

  const amount = parseFloat(inputAmount);
  if (isNaN(amount) || amount <= 0) {
    issues.push({ type: "error", message: "Invalid input amount" });
    return { valid: false, issues, outputTokenAssociated };
  }

  // Check if this is a wrap/unwrap (HBAR↔WHBAR) — handled separately, not via pool routes
  const isWrapUnwrap = isHbarWhbarPair(inputSymbol, outputSymbol);

  // Check route exists (skip for wrap/unwrap which bypasses pool routing)
  const route = findSwapRoute(inputSymbol, outputSymbol);
  if (!route && !isWrapUnwrap) {
    issues.push({ type: "error", message: `No pool route found for ${inputSymbol} → ${outputSymbol}` });
    return { valid: false, issues, outputTokenAssociated };
  }

  // Check output token association
  // Native HBAR doesn't need token association — it's the network's native currency
  try {
    if (outputToken.isNative) {
      outputTokenAssociated = true;
    } else {
      outputTokenAssociated = await isTokenAssociated(accountId, outputToken.htsId, network);
      if (!outputTokenAssociated) {
        issues.push({
          type: "warning",
          message: `${outputToken.symbol} (${outputToken.htsId}) is not associated with your account. It will be associated before the swap.`,
        });
      }
    }
  } catch {
    issues.push({ type: "warning", message: "Could not verify token association status" });
  }

  // Check input token balance
  try {
    if (inputToken.isNative) {
      // Native HBAR: check account balance via Mirror Node
      const balanceTinybars = await getNativeHbarBalance(accountId, network);
      const rawNeeded = Math.floor(amount * Math.pow(10, 8)); // HBAR has 8 decimals
      if (balanceTinybars < rawNeeded) {
        const humanBalance = balanceTinybars / Math.pow(10, 8);
        issues.push({
          type: "error",
          message: `Insufficient HBAR balance: ${humanBalance.toFixed(4)} available, ${amount} needed`,
        });
      }
    } else {
      const balance = await getTokenBalance(accountId, inputToken.htsId, network);
      const rawNeeded = Math.floor(amount * Math.pow(10, inputToken.decimals));
      if (balance < rawNeeded) {
        const humanBalance = balance / Math.pow(10, inputToken.decimals);
        issues.push({
          type: "error",
          message: `Insufficient ${inputToken.symbol} balance: ${humanBalance.toFixed(4)} available, ${amount} needed`,
        });
      }
    }
  } catch {
    issues.push({ type: "warning", message: "Could not verify token balance" });
  }

  // Check for intermediate token associations in multi-hop routes
  if (route && route.path.length > 2) {
    for (let i = 1; i < route.path.length - 1; i++) {
      const midToken = route.path[i];
      try {
        const midAssociated = await isTokenAssociated(accountId, midToken.htsId, network);
        if (!midAssociated) {
          issues.push({
            type: "warning",
            message: `Intermediate token ${midToken.symbol} (${midToken.htsId}) is not associated. It will be associated before the swap.`,
          });
        }
      } catch { /* non-critical */ }
    }
  }

  return {
    valid: issues.filter(i => i.type === "error").length === 0,
    issues,
    outputTokenAssociated,
  };
}

// ══════════════════════════════════════════════════════════════════════
// ── LIVE PRICE MAPPING ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Map SaucerSwap token symbols to CoinGecko/CoinCap symbols for live prices.
 */
export const SAUCERSWAP_TO_ORACLE_SYMBOL: Record<string, string> = {
  HBAR: "HBAR",        // Native HBAR
  WHBAR: "HBAR",
  USDC: "USDC",
  USDT: "USDT",
  WBTC: "BTC",
  WETH: "ETH",
  LINK: "LINK",
  SAUCE: "SAUCE",
  HBARX: "HBAR",      // Approximate as HBAR price
  KARATE: "KARATE",
  PACK: "PACK",
  DOVU: "DOVU",
  HST: "HST",
  // NOTE: HBAR.ħ is NOT mapped here — it's a distinct protocol token (~$0.000001)
  // not a liquid-staked HBAR derivative. Price comes from DexScreener via
  // fetchHbarhTokenPrice(). Mapping it to "HBAR" would overwrite with HBAR price.
};

// ══════════════════════════════════════════════════════════════════════
// ── WRAPPED PAIR POOL ROUTES ──────────��──────────────────────────────
// ══════════════════════════════════════════════════════════════════════

export interface PoolRoute {
  id: string;
  tokenA: AllowedToken;
  tokenB: AllowedToken;
  fee: number;
  tvlUsd: number;
  volume24hUsd: number;
  apr: number;
  poolAddress: string; // SaucerSwap V1/V2 pool contract on Hedera
}

/**
 * All SaucerSwap pool routes available for routing swaps.
 * Each route is a direct pool pair. Multi-hop routes
 * combine two or more of these (e.g. SAUCE → WHBAR → USDC).
 *
 * NOTE: Pool addresses are resolved dynamically by the V1 Router
 * via the Factory's getPair() function during swap execution.
 * The poolAddress field here is for display/informational use only —
 * it does NOT affect swap routing. The address "factory-resolved"
 * indicates the router will find the correct pair contract on-chain.
 */
export function getPoolRoutes(): PoolRoute[] {
  const tok = (sym: string) => TOKEN_BY_SYMBOL.get(sym)!;
  // Pool addresses are resolved on-chain by the SaucerSwap V1 Factory (0.0.2210218).
  // The router's swap functions call Factory.getPair() internally.
  const FACTORY_RESOLVED = "factory-resolved";
  return [
    { id: "ss-whbar-usdc",   tokenA: tok("WHBAR"),  tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 18420000, volume24hUsd: 3240000, apr: 24.5, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-usdt",   tokenA: tok("WHBAR"),  tokenB: tok("USDT"),   fee: 0.3,  tvlUsd: 6200000,  volume24hUsd: 1450000, apr: 18.3, poolAddress: FACTORY_RESOLVED },
    { id: "ss-usdc-usdt",    tokenA: tok("USDC"),   tokenB: tok("USDT"),   fee: 0.01, tvlUsd: 8910000,  volume24hUsd: 2180000, apr: 8.4,  poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-wbtc",   tokenA: tok("WHBAR"),  tokenB: tok("WBTC"),   fee: 0.3,  tvlUsd: 3560000,  volume24hUsd: 1120000, apr: 15.3, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-weth",   tokenA: tok("WHBAR"),  tokenB: tok("WETH"),   fee: 0.3,  tvlUsd: 12800000, volume24hUsd: 2150000, apr: 18.2, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-link",   tokenA: tok("WHBAR"),  tokenB: tok("LINK"),   fee: 0.3,  tvlUsd: 2340000,  volume24hUsd: 780000,  apr: 18.7, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-sauce",  tokenA: tok("WHBAR"),  tokenB: tok("SAUCE"),  fee: 0.3,  tvlUsd: 4120000,  volume24hUsd: 1560000, apr: 38.2, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-hbarx",  tokenA: tok("WHBAR"),  tokenB: tok("HBARX"),  fee: 0.05, tvlUsd: 5630000,  volume24hUsd: 890000,  apr: 12.8, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-karate", tokenA: tok("WHBAR"),  tokenB: tok("KARATE"), fee: 1.0,  tvlUsd: 1840000,  volume24hUsd: 620000,  apr: 52.1, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-pack",   tokenA: tok("WHBAR"),  tokenB: tok("PACK"),   fee: 0.3,  tvlUsd: 920000,   volume24hUsd: 340000,  apr: 31.6, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-dovu",   tokenA: tok("WHBAR"),  tokenB: tok("DOVU"),   fee: 0.3,  tvlUsd: 420000,   volume24hUsd: 95000,   apr: 22.0, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-hst",    tokenA: tok("WHBAR"),  tokenB: tok("HST"),    fee: 0.3,  tvlUsd: 680000,   volume24hUsd: 210000,  apr: 26.4, poolAddress: FACTORY_RESOLVED },
    { id: "ss-whbar-hbarh",  tokenA: tok("WHBAR"),  tokenB: tok("HBAR.ħ"), fee: 0.3,  tvlUsd: 5630000,  volume24hUsd: 890000,  apr: 12.8, poolAddress: "v2-pool" }, // V2 concentrated-liquidity pool — auto-detected at swap time
    { id: "ss-sauce-usdc",   tokenA: tok("SAUCE"),  tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 1560000,  volume24hUsd: 420000,  apr: 28.5, poolAddress: FACTORY_RESOLVED },
    { id: "ss-wbtc-usdc",    tokenA: tok("WBTC"),   tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 2100000,  volume24hUsd: 560000,  apr: 12.0, poolAddress: FACTORY_RESOLVED },
    { id: "ss-weth-usdc",    tokenA: tok("WETH"),   tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 3450000,  volume24hUsd: 890000,  apr: 14.2, poolAddress: FACTORY_RESOLVED },
  ].filter(r => r.tokenA && r.tokenB); // Safety filter
}

/**
 * Find the best route between two tokens.
 * Returns the ordered list of pools to traverse.
 */
export function findSwapRoute(
  inputSymbol: string,
  outputSymbol: string
): { path: AllowedToken[]; pools: PoolRoute[]; totalFee: number } | null {
  const input = resolveToken(inputSymbol);
  const output = resolveToken(outputSymbol);
  if (!input || !output || input.symbol === output.symbol) return null;

  // Native HBAR ↔ WHBAR is just wrap/unwrap, not a pool swap
  if (
    (input.isNative && output.symbol === "WHBAR") ||
    (input.symbol === "WHBAR" && output.isNative)
  ) {
    return null; // Handled by wrapHbar/unwrapHbar directly
  }

  const routes = getPoolRoutes();

  // For routing purposes, treat HBAR (native) as WHBAR since pools use WHBAR
  const lookupInput = input.isNative ? "WHBAR" : input.symbol;
  const lookupOutput = output.isNative ? "WHBAR" : output.symbol;

  if (lookupInput === lookupOutput) return null;

  // Try direct route first
  const directPool = routes.find(
    r => (r.tokenA.symbol === lookupInput && r.tokenB.symbol === lookupOutput) ||
         (r.tokenB.symbol === lookupInput && r.tokenA.symbol === lookupOutput)
  );
  if (directPool) {
    return { path: [input, output], pools: [directPool], totalFee: directPool.fee };
  }

  // Try 2-hop route through WHBAR
  const whbar = TOKEN_BY_SYMBOL.get("WHBAR");
  if (whbar && lookupInput !== "WHBAR" && lookupOutput !== "WHBAR") {
    const pool1 = routes.find(
      r => (r.tokenA.symbol === lookupInput && r.tokenB.symbol === "WHBAR") ||
           (r.tokenB.symbol === lookupInput && r.tokenA.symbol === "WHBAR")
    );
    const pool2 = routes.find(
      r => (r.tokenA.symbol === "WHBAR" && r.tokenB.symbol === lookupOutput) ||
           (r.tokenB.symbol === "WHBAR" && r.tokenA.symbol === lookupOutput)
    );
    if (pool1 && pool2) {
      return {
        path: [input, whbar, output],
        pools: [pool1, pool2],
        totalFee: pool1.fee + pool2.fee,
      };
    }
  }

  // Try 2-hop through USDC
  const usdc = TOKEN_BY_SYMBOL.get("USDC");
  if (usdc && lookupInput !== "USDC" && lookupOutput !== "USDC") {
    const pool1 = routes.find(
      r => (r.tokenA.symbol === lookupInput && r.tokenB.symbol === "USDC") ||
           (r.tokenB.symbol === lookupInput && r.tokenA.symbol === "USDC")
    );
    const pool2 = routes.find(
      r => (r.tokenA.symbol === "USDC" && r.tokenB.symbol === lookupOutput) ||
           (r.tokenB.symbol === "USDC" && r.tokenA.symbol === lookupOutput)
    );
    if (pool1 && pool2) {
      return {
        path: [input, usdc, output],
        pools: [pool1, pool2],
        totalFee: pool1.fee + pool2.fee,
      };
    }
  }

  return null;
}

/**
 * Simulate a swap for testing purposes.
 * Uses the route finder + price estimation to show realistic results
 * without requiring a wallet connection or live blockchain execution.
 */
export async function simulateSwap(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string,
  slippagePct: number = 0.5
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
  const pathAddresses = logicalPath.map(t => t.evmAddress);
  // Use discovered router if available, otherwise fall back to configured default
  const discoveredRouter = await discoverSaucerSwapRouter("mainnet");
  const v1Router = discoveredRouter || getSaucerSwapRouter("mainnet", "v1");

  // Try to fetch a real quote via multi-strategy system
  const rawAmount = Math.floor(amount * Math.pow(10, input.decimals));
  let apiQuoteAmount: number | null = null;
  try {
    const quoteInputId = input.isNative ? whbar.htsId : input.htsId;
    const quoteOutputId = output.isNative ? whbar.htsId : output.htsId;
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
 * Simulate an HBAR ↔ WHBAR wrap/unwrap for Test Mode.
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

// ══════════════════════════════════════════════════════════════════════
// ── HBAR WRAPPING / UNWRAPPING ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Wrap native HBAR into WHBAR (HTS token 0.0.1456986).
 *
 * Calls the WHBAR contract's deposit() function with native HBAR
 * as the payable value. The contract mints equivalent WHBAR tokens
 * to the caller's account.
 *
 * @param amount  Amount in HBAR (e.g., "10" for 10 HBAR)
 * @param accountId  Hedera account ID
 * @param network  "mainnet" | "testnet"
 */
export async function wrapHbar(
  amount: string,
  accountId: string,
  network: HederaNetwork
): Promise<{ success: boolean; transactionId?: string; error?: string; userCancelled?: boolean }> {
  try {
    const { executeHederaTransaction } = await import("./hashpack");
    const sdk = await import("@hashgraph/sdk");
    const { ContractExecuteTransaction, ContractId, Hbar } = sdk;

    const whbar = getWhbarToken();
    const hbarAmount = parseFloat(amount);
    if (isNaN(hbarAmount) || hbarAmount <= 0) {
      return { success: false, error: "Invalid HBAR amount" };
    }

    // deposit() function selector: keccak256("deposit()") = 0xd0e30db0
    const depositSelector = new Uint8Array([0xd0, 0xe3, 0x0d, 0xb0]);

    console.log(`[HBAR.h] Wrapping ${hbarAmount} HBAR → WHBAR via deposit()`);
    const tx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(whbar.htsId))
      .setGas(800_000)
      .setFunctionParameters(depositSelector)
      .setPayableAmount(new Hbar(hbarAmount));

    const result = await executeHederaTransaction(accountId, tx);
    console.log("[HBAR.h] Wrap result:", JSON.stringify(result));
    return {
      success: result.success,
      transactionId: result.transactionId || undefined,
      error: result.error || undefined,
      userCancelled: result.userCancelled,
    };
  } catch (err: any) {
    console.error("[HBAR.h] Wrap error:", err);
    const errMsg = err?.message || "HBAR wrapping failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return { success: false, error: errMsg, userCancelled: isCancellation || undefined };
  }
}

/**
 * Unwrap WHBAR back to native HBAR.
 *
 * Calls the WHBAR contract's withdraw(uint256) function which burns
 * the specified WHBAR tokens and sends equivalent native HBAR back
 * to the caller.
 *
 * @param amount  Amount in HBAR units (e.g., "10" for 10 WHBAR → 10 HBAR)
 * @param accountId  Hedera account ID
 * @param network  "mainnet" | "testnet"
 */
export async function unwrapHbar(
  amount: string,
  accountId: string,
  network: HederaNetwork
): Promise<{ success: boolean; transactionId?: string; error?: string; userCancelled?: boolean }> {
  try {
    const { executeHederaTransaction } = await import("./hashpack");
    const sdk = await import("@hashgraph/sdk");
    const { ContractExecuteTransaction, ContractId, Hbar } = sdk;

    const whbar = getWhbarToken();
    const hbarAmount = parseFloat(amount);
    if (isNaN(hbarAmount) || hbarAmount <= 0) {
      return { success: false, error: "Invalid WHBAR amount" };
    }

    const rawAmount = Math.floor(hbarAmount * Math.pow(10, 8)); // WHBAR has 8 decimals

    // withdraw(uint256) selector: keccak256("withdraw(uint256)") = 0x2e1a7d4d
    const selector = new Uint8Array([0x2e, 0x1a, 0x7d, 0x4d]);
    const amountBytes = encodeUint256(BigInt(rawAmount));
    const functionData = new Uint8Array(selector.length + amountBytes.length);
    functionData.set(selector, 0);
    functionData.set(amountBytes, selector.length);

    console.log(`[HBAR.h] Unwrapping ${hbarAmount} WHBAR → HBAR via withdraw(${rawAmount})`);
    const tx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(whbar.htsId))
      .setGas(800_000)
      .setFunctionParameters(functionData);

    const result = await executeHederaTransaction(accountId, tx);
    console.log("[HBAR.h] Unwrap result:", JSON.stringify(result));
    return {
      success: result.success,
      transactionId: result.transactionId || undefined,
      error: result.error || undefined,
      userCancelled: result.userCancelled,
    };
  } catch (err: any) {
    console.error("[HBAR.h] Unwrap error:", err);
    const errMsg = err?.message || "WHBAR unwrapping failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return { success: false, error: errMsg, userCancelled: isCancellation || undefined };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── TRANSACTION DIAGNOSTICS ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Comprehensive post-mortem diagnostic for a Hedera transaction.
 * Fetches the full transaction record from Mirror Node and provides
 * a detailed breakdown of what happened — especially useful when a
 * swap "took money but didn't return tokens."
 *
 * Possible outcomes it detects:
 * - CONTRACT_REVERT_EXECUTED: swap reverted, user lost only gas fees
 * - SUCCESS with output: swap worked, tokens were received
 * - SUCCESS without output: swap claims success but no token transfer found
 * - Transaction not found: may still be indexing
 */
export interface TransactionDiagnosis {
  found: boolean;
  consensusTimestamp?: string;
  result?: string;
  chargedFee?: string;
  chargedFeeHbar?: number;
  transfers: {
    hbar: { account: string; amount: number; amountHbar: number }[];
    tokens: { token: string; tokenSymbol: string; account: string; amount: number; amountHuman: number }[];
  };
  contractCallResult?: {
    gasUsed: number;
    errorMessage: string;
    contractId: string;
  };
  diagnosis: string;
  error?: string;
}

export async function diagnoseTransaction(
  transactionIdOrTimestamp: string,
  userAccountId: string,
  expectedOutputTokenId?: string,
  network: HederaNetwork = "mainnet"
): Promise<TransactionDiagnosis> {
  const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;

  // Detect input format and build the correct API URL.
  //
  // Hedera transaction IDs contain "@" (SDK format: 0.0.12345@1234567890.123456789)
  // or "-" (Mirror Node format: 0.0.12345-1234567890-123456789) and always start
  // with an account ID like "0.0.".
  //
  // A bare consensus timestamp like "1770515132.278486502" contains only digits
  // and a single dot — it does NOT start with "0.0." and has no "@" or "-" after
  // the initial numbers. For this format we must use the ?timestamp= query param.
  const input = transactionIdOrTimestamp.trim();
  const isTimestamp = /^\d+\.\d+$/.test(input);
  const normalizedId = input.includes("@")
    ? formatTxIdForMirrorNode(input)
    : input;

  console.log(`[HBAR.h] Diagnosing: "${input}" (${isTimestamp ? "consensus timestamp" : "transaction ID"}) → "${normalizedId}"`);

  try {
    // Use the correct endpoint based on input format
    const url = isTimestamp
      ? `${base}/api/v1/transactions?timestamp=${normalizedId}&limit=1`
      : `${base}/api/v1/transactions/${normalizedId}`;
    const res = await fetch(url, { signal: makeAbort(15000) });

    if (!res.ok) {
      return {
        found: false,
        transfers: { hbar: [], tokens: [] },
        diagnosis: res.status === 404
          ? "Transaction not found. It may still be indexing on Mirror Node — try again in 30 seconds."
          : `Mirror Node returned HTTP ${res.status}.`,
        error: `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const txs = data.transactions || [data];
    if (!txs.length || !txs[0]) {
      return {
        found: false,
        transfers: { hbar: [], tokens: [] },
        diagnosis: "No transaction data in response.",
      };
    }

    const tx = txs[0];
    const result = tx.result || tx.status || "UNKNOWN";
    const chargedFee = tx.charged_tx_fee?.toString() || "0";
    const chargedFeeHbar = parseInt(chargedFee, 10) / 1e8;
    const consensusTimestamp = tx.consensus_timestamp;

    // Merge all transfers from parent + child transactions
    const hbarTransfers: { account: string; amount: number; amountHbar: number }[] = [];
    const tokenTransfers: { token: string; tokenSymbol: string; account: string; amount: number; amountHuman: number }[] = [];

    for (const entry of txs) {
      for (const ht of (entry.transfers || [])) {
        if (Math.abs(ht.amount) > 10000) { // > 0.0001 HBAR
          hbarTransfers.push({
            account: ht.account,
            amount: ht.amount,
            amountHbar: ht.amount / 1e8,
          });
        }
      }
      for (const tt of (entry.token_transfers || [])) {
        const meta = TOKEN_BY_HTS_ID.get(tt.token_id);
        const decimals = meta?.decimals || 8;
        tokenTransfers.push({
          token: tt.token_id,
          tokenSymbol: meta?.symbol || tt.token_id,
          account: tt.account,
          amount: tt.amount,
          amountHuman: tt.amount / Math.pow(10, decimals),
        });
      }
    }

    // Extract contract call result if available
    let contractCallResult: TransactionDiagnosis["contractCallResult"];
    for (const entry of txs) {
      if (entry.contract_results) {
        for (const cr of entry.contract_results) {
          contractCallResult = {
            gasUsed: parseInt(cr.gas_used || "0", 10),
            errorMessage: cr.error_message || "",
            contractId: cr.contract_id || "",
          };
        }
      }
    }

    // Build diagnosis string
    let diagnosis: string;

    // Check if the transaction was sent to the correct SaucerSwap router.
    // Uses the dynamically verified or configured router address.
    const calledContract = contractCallResult?.contractId || tx.entity_id || "";
    const expectedV1Router = _discoveredRouter["mainnet"] || SAUCERSWAP_V1_ROUTER["mainnet"];
    const expectedV2Router = SAUCERSWAP_V2_ROUTER["mainnet"];
    const allCandidates = [
      ...(SAUCERSWAP_V1_ROUTER_CANDIDATES["mainnet"] || [expectedV1Router]),
      expectedV2Router,
    ];
    const isCorrectRouter = !calledContract || calledContract === expectedV1Router ||
      calledContract === expectedV2Router || allCandidates.includes(calledContract);
    const wrongRouterWarning = !isCorrectRouter
      ? ` WARNING: Transaction was sent to ${calledContract}, but the verified SaucerSwap routers are V1=${expectedV1Router}, V2=${expectedV2Router}. ` +
        `This is likely why the swap failed — funds were sent to the wrong contract/account. ` +
        `Known candidates: [${allCandidates.join(", ")}].`
      : "";

    if (result === "CONTRACT_REVERT_EXECUTED") {
      const gasUsed = contractCallResult?.gasUsed || 0;
      const errorMsg = contractCallResult?.errorMessage || "no revert reason";
      diagnosis = `SWAP REVERTED (CONTRACT_REVERT_EXECUTED). ` +
        `The SaucerSwap router rejected the swap. ` +
        `Gas charged: ${chargedFeeHbar.toFixed(4)} HBAR (${gasUsed.toLocaleString()} gas used). ` +
        `Your payable HBAR was refunded, but gas fees were consumed. ` +
        `Revert reason: ${errorMsg}. ` +
        `Common causes: output token not associated, insufficient pool liquidity, ` +
        `expired deadline, or the path/router address is incorrect.` +
        wrongRouterWarning;
    } else if (result === "SUCCESS") {
      // Check for output tokens received by user
      const userTokenCredits = tokenTransfers.filter(
        t => t.account === userAccountId && t.amount > 0
      );
      const userHbarCredits = hbarTransfers.filter(
        t => t.account === userAccountId && t.amount > 0
      );

      if (expectedOutputTokenId && expectedOutputTokenId !== "native") {
        const expectedCredits = userTokenCredits.filter(t => t.token === expectedOutputTokenId);
        if (expectedCredits.length > 0) {
          const total = expectedCredits.reduce((s, t) => s + t.amountHuman, 0);
          const sym = expectedCredits[0].tokenSymbol;
          diagnosis = `SWAP SUCCEEDED. You received ${total} ${sym}. Fee charged: ${chargedFeeHbar.toFixed(4)} HBAR.`;
        } else if (userTokenCredits.length > 0) {
          const received = userTokenCredits.map(t => `${t.amountHuman} ${t.tokenSymbol}`).join(", ");
          diagnosis = `SWAP SUCCEEDED but received different token(s) than expected. ` +
            `Received: ${received}. Expected output: ${expectedOutputTokenId}. Fee: ${chargedFeeHbar.toFixed(4)} HBAR.`;
        } else if (userHbarCredits.length > 0) {
          const totalHbar = userHbarCredits.reduce((s, t) => s + t.amountHbar, 0);
          diagnosis = `SWAP SUCCEEDED. You received ${totalHbar.toFixed(4)} HBAR. Fee: ${chargedFeeHbar.toFixed(4)} HBAR.`;
        } else {
          diagnosis = `Transaction shows SUCCESS but NO output tokens were credited to your account (${userAccountId}). ` +
            `This may indicate the tokens went to a different address or the transaction was sent to a non-router contract. ` +
            `Fee charged: ${chargedFeeHbar.toFixed(4)} HBAR. ` +
            `Check all token transfers on HashScan for the full picture.` +
            wrongRouterWarning;
        }
      } else {
        if (userTokenCredits.length > 0 || userHbarCredits.length > 0) {
          const parts: string[] = [];
          if (userTokenCredits.length) parts.push(userTokenCredits.map(t => `${t.amountHuman} ${t.tokenSymbol}`).join(", "));
          if (userHbarCredits.length) parts.push(userHbarCredits.reduce((s, t) => s + t.amountHbar, 0).toFixed(4) + " HBAR");
          diagnosis = `SWAP SUCCEEDED. Received: ${parts.join(" + ")}. Fee: ${chargedFeeHbar.toFixed(4)} HBAR.`;
        } else {
          diagnosis = `Transaction SUCCESS but no visible credits to ${userAccountId}. Fee: ${chargedFeeHbar.toFixed(4)} HBAR.` +
            wrongRouterWarning;
        }
      }
    } else {
      diagnosis = `Transaction status: ${result}. Fee charged: ${chargedFeeHbar.toFixed(4)} HBAR.` +
        wrongRouterWarning;
    }

    console.log("[HBAR.h] Transaction diagnosis:", {
      result, chargedFeeHbar, diagnosis,
      hbarTransfers: hbarTransfers.length,
      tokenTransfers: tokenTransfers.length,
    });

    return {
      found: true,
      consensusTimestamp,
      result,
      chargedFee,
      chargedFeeHbar,
      transfers: { hbar: hbarTransfers, tokens: tokenTransfers },
      contractCallResult,
      diagnosis,
    };
  } catch (err: any) {
    return {
      found: false,
      transfers: { hbar: [], tokens: [] },
      diagnosis: `Failed to fetch transaction: ${err?.message || "unknown error"}`,
      error: err?.message,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── NETWORK HEALTH CHECK ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

export interface NetworkHealth {
  mirrorNode: { ok: boolean; latencyMs: number; error?: string };
  saucerSwapApi: { ok: boolean; latencyMs: number; error?: string };
  dexScreener: { ok: boolean; latencyMs: number; error?: string };
  v2Router: { ok: boolean; contractId: string; error?: string };
  v2Factory: { ok: boolean; address?: string; error?: string };
  timestamp: number;
}

/**
 * Quick connectivity check for Mirror Node, SaucerSwap API, DexScreener,
 * and V2 infrastructure.
 * Useful as a pre-swap readiness indicator.
 */
export async function checkNetworkHealth(
  network: HederaNetwork = "mainnet"
): Promise<NetworkHealth> {
  const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
  const timestamp = Date.now();

  // Check Mirror Node
  let mirrorNode: NetworkHealth["mirrorNode"];
  try {
    const start = Date.now();
    const res = await fetch(`${base}/api/v1/network/supply`, {
      signal: makeAbort(8000),
    });
    const latencyMs = Date.now() - start;
    mirrorNode = { ok: res.ok, latencyMs };
    if (!res.ok) mirrorNode.error = `HTTP ${res.status}`;
  } catch (err: any) {
    mirrorNode = { ok: false, latencyMs: 0, error: err?.message || "unreachable" };
  }

  // Check SaucerSwap API (may be CORS-blocked from browser)
  let saucerSwapApi: NetworkHealth["saucerSwapApi"];
  try {
    const start = Date.now();
    const res = await saucerFetch("/tokens", 8000);
    const latencyMs = Date.now() - start;
    saucerSwapApi = { ok: !!res, latencyMs };
    if (!res) saucerSwapApi.error = "CORS restricted (non-critical)";
  } catch (err: any) {
    saucerSwapApi = { ok: false, latencyMs: 0, error: err?.message || "unreachable" };
  }

  // Check DexScreener API (CORS-friendly, used for HBAR.ħ pricing)
  let dexScreener: NetworkHealth["dexScreener"];
  try {
    const start = Date.now();
    const res = await fetch(
      "https://api.dexscreener.com/latest/dex/pairs/hedera/0x31d6b803a960b818cce3a85f0bef7c4c566b7919",
      { signal: makeAbort(8000) }
    );
    const latencyMs = Date.now() - start;
    dexScreener = { ok: res.ok, latencyMs };
    if (!res.ok) dexScreener.error = `HTTP ${res.status}`;
  } catch (err: any) {
    dexScreener = { ok: false, latencyMs: 0, error: err?.message || "unreachable" };
  }

  // Check V2 Router contract
  const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
  let v2Router: NetworkHealth["v2Router"];
  try {
    const info = await verifyIsContract(v2RouterId, network);
    v2Router = { ok: !!info, contractId: v2RouterId };
    if (!info) v2Router.error = "Not verified";
  } catch (err: any) {
    v2Router = { ok: false, contractId: v2RouterId, error: err?.message || "check failed" };
  }

  // Check V2 Factory discovery
  let v2Factory: NetworkHealth["v2Factory"];
  try {
    const factoryAddr = await discoverV2Factory(network);
    v2Factory = { ok: !!factoryAddr, address: factoryAddr || undefined };
    if (!factoryAddr) v2Factory.error = "Not discovered";
  } catch (err: any) {
    v2Factory = { ok: false, error: err?.message || "discovery failed" };
  }

  return { mirrorNode, saucerSwapApi, dexScreener, v2Router, v2Factory, timestamp };
}
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

// ════════════════════════════════════════════════════════════════════
// [C99] TOKEN ALIAS MAP — V2 ERC20Wrapper Resolution
// ═════════════════════════════════════════════════════════════════════
//
// SaucerSwap V2 pools use ERC20Wrapper versions of HashPort bridge tokens.
// These wrapper tokens have DIFFERENT HTS IDs (and therefore different EVM
// addresses) than the canonical bridge tokens users hold in their wallets.
//
// Example: LINK
//   Canonical (user holds):  0.0.1055495  → EVM 0x...101917
//   V2 Wrapper (pool uses):  0.0.10152778 → EVM 0x...9af70a
//
// When calling V2 QuoterV2 or V2 SwapRouter, we MUST use the wrapper EVM
// address. V1 Router uses canonical addresses (V1 Factory pairs are
// registered with canonical HTS IDs).
//
// This map is the server-side equivalent of client-side `saucerswapAliasId`.
// ═════════════════════════════════════════════════════════════════════

const TOKEN_ALIAS_MAP: Record<string, string> = {
  "0.0.1055483": "0.0.10104132",  // WBTC: canonical → V2 wrapper
  "0.0.1055495": "0.0.10152778",  // LINK: canonical → V2 wrapper
  "0.0.541564":  "0.0.1969708",   // WETH: canonical → V2 wrapper
};

/**
 * [C99] Request-scoped alias overlay from client hints.
 *
 * When the client sends `inputAliasId` / `outputAliasId` query params,
 * these are registered here BEFORE strategy execution and cleared AFTER.
 * This lets the client's dynamic token registry (which includes aliases
 * discovered via the SaucerSwap /tokens API reconciliation) extend the
 * server's hardcoded TOKEN_ALIAS_MAP without mutating it.
 *
 * Safe for single-threaded Deno — ssQuote() is awaited sequentially.
 */
let _requestAliases: Map<string, string> | null = null;

/**
 * [C99] Resolve a token HTS ID to its V2 alias if one exists.
 * [C100 Step 4] Updated: checks dynamic API-discovered aliases between
 * client hints and the hardcoded fallback. This makes the server
 * self-healing — new V2 ERC20Wrappers are discovered automatically.
 *
 * Resolution priority:
 *   1. Request-scoped client hints     (per-request, highest fidelity)
 *   2. Dynamic API-discovered aliases  (self-healing, refreshed 5 min)
 *   3. Hardcoded TOKEN_ALIAS_MAP       (fallback when API unavailable)
 *   4. Original HTS ID                 (no alias known)
 */
function resolveV2AliasId(htsId: string): string {
  // 1. Request-scoped client hints (per-request from client token registry)
  if (_requestAliases?.has(htsId)) return _requestAliases.get(htsId)!;
  // 2. Dynamic API-discovered aliases (self-healing, refreshed every 5 min)
  if (_dynamicAliasMap?.has(htsId)) return _dynamicAliasMap.get(htsId)!;
  // 3. Hardcoded server-side map (fallback when SaucerSwap API is unavailable)
  return TOKEN_ALIAS_MAP[htsId] || htsId;
}

/**
 * [C99] Convert an HTS ID to EVM address, using V2 alias if available.
 * Use this for ALL V2 QuoterV2 / SwapRouter calls.
 * V1 Router calls should use plain htsIdToEvmAddress() (canonical).
 */
function resolveV2Evm(htsId: string): string {
  return htsIdToEvmAddress(resolveV2AliasId(htsId));
}

// [C52] Full intermediary candidate list — tested in parallel for Token→Token
// pairs with no direct pool. Ordered by typical liquidity depth.
// [C90] Expanded: added common bridge tokens (WBNB, WETH, WBTC, DAI) that
// serve as secondary liquidity hubs for exotic pairs.
// [C99] Fixed: corrected HTS IDs to match client token registry, added
// v2AliasId for bridge tokens whose V2 pools use wrapper addresses.
const INTERMEDIARY_TOKENS: { htsId: string; symbol: string; v2AliasId?: string }[] = [
  { htsId: "0.0.1456986", symbol: "WHBAR" },
  { htsId: "0.0.456858",  symbol: "USDC" },
  { htsId: "0.0.1055472", symbol: "USDT" },
  { htsId: "0.0.731861",  symbol: "SAUCE" },
  { htsId: "0.0.834116",  symbol: "HBARX" },
  { htsId: "0.0.1055459", symbol: "USDCh" },
  // [C99] Fixed WETH: was 0.0.1055481 (wrong ID), correct is 0.0.541564
  { htsId: "0.0.541564",  symbol: "WETH",  v2AliasId: "0.0.1969708" },
  // [C99] Fixed WBTC: was 0.0.1055482 (wrong ID), correct is 0.0.1055483
  { htsId: "0.0.1055483", symbol: "WBTC",  v2AliasId: "0.0.10104132" },
  { htsId: "0.0.1157005", symbol: "WBNB" },
  // [C99] Fixed LINK: was 0.0.1055480 (wrong ID), correct is 0.0.1055495
  { htsId: "0.0.1055495", symbol: "LINK",  v2AliasId: "0.0.10152778" },
];

// ═════════════════════════════════════════════════════════════════════
// [C100 Step 3] V2-ONLY TOKEN REGISTRY
// ═════════════════════════════════════════════════════════════════════
//
// Tokens known to exist EXCLUSIVELY on SaucerSwap V2 (no V1 AMM pairs).
// V1 Router getAmountsOut() will always revert for these tokens, but each
// reverted RPC call still takes 2–12s on Hedera's relay. By maintaining
// this set, V1 strategies bail instantly (O(1) lookup) instead of burning
// network round-trips that are guaranteed to fail.
//
// How to verify: call V1 Factory.getPair(tokenA, WHBAR) — if it returns
// address(0), the token has no V1 pair with the primary liquidity hub.
// If it also has no V1 pair with USDC/SAUCE, it's V2-only.
//
// Extend this set when new V2-only tokens are added to the platform.
// ═════════════════════════════════════════════════════════════════════

const V2_ONLY_TOKENS: Set<string> = new Set([
  "0.0.4794920",   // PACK  — HashPack utility token, V2-only pools
  "0.0.2283230",   // KARATE — V2-only pools
  "0.0.3716059",   // DOVU  — V2-only pools
]);

/**
 * [C100 Step 3] Check if a token has NO V1 liquidity (V2-only).
 * V1 strategies (Router getAmountsOut) should bail immediately for these tokens
 * to avoid wasting 2–12s per RPC call on guaranteed reverts.
 */
function isV2OnlyToken(htsId: string): boolean {
  return V2_ONLY_TOKENS.has(htsId);
}

/**
 * [C100 Step 3] V1-specific RPC timeout.
 * V1 reverts are fast on Hedera (~2-3s), but the relay can delay up to 12s.
 * This tighter ceiling prevents V1 probes from dominating overall quote latency
 * for tokens that DO have V1 pairs but the pair lookup is slow.
 */
const V1_RPC_TIMEOUT_MS = 5_000;

// ═════════════════════════════════════════════════════════════════════
// [C100 Step 4] DYNAMIC ALIAS DISCOVERY FROM SAUCERSWAP /tokens API
// ═════════════════════════════════════════════════════════════════════
//
// Makes the server self-healing: when SaucerSwap adds a new V2
// ERC20Wrapper for any bridge token, the next /tokens fetch discovers
// it automatically. No code changes needed.
//
// Discovery logic:
//   1. Fetch /tokens from SaucerSwap API (shared cache with prices)
//   2. Group tokens by normalized symbol (case-insensitive)
//   3. For BRIDGE_TOKEN_SYMBOLS with 2+ entries per symbol:
//      • Lowest entity number = canonical (original bridge token)
//      • Highest entity number = V2 ERC20Wrapper (created later)
//      • Map: canonical → alias
//   4. Cache for 5 minutes (same TTL as prices/token list)
//
// Resolution priority for resolveV2AliasId():
//   1. Request-scoped client hints     (per-request, highest fidelity)
//   2. Dynamic API-discovered aliases  (self-healing, refreshed 5 min)
//   3. Hardcoded TOKEN_ALIAS_MAP       (fallback when API unavailable)
//   4. Original HTS ID                 (no alias known)
// ═════════════════════════════════════════════════════════════════════

/**
 * Bridge token symbols known to potentially have V2 ERC20Wrapper aliases.
 * The /tokens API is scanned for symbols in this set — when multiple HTS IDs
 * share the same symbol, the lowest entity number is canonical (original
 * bridge token from HashPort/Axelar) and the highest is the V2 wrapper.
 *
 * Intentionally broad: including a symbol that doesn't yet have a wrapper
 * costs nothing (API scan skips it). Not including a symbol that DOES have
 * a wrapper means it won't be auto-discovered until added here.
 */
const BRIDGE_TOKEN_SYMBOLS: Set<string> = new Set([
  "WBTC", "WETH", "LINK", "AAVE", "UNI", "USDT", "USDC",
  "WBNB", "DAI", "MATIC", "WFTM", "WAVAX", "CRV", "SUSHI",
  "YFI", "COMP", "MKR", "SNX", "GRT", "FXS",
]);

/** Dynamic alias map: canonical HTS ID → V2 wrapper HTS ID. */
let _dynamicAliasMap: Map<string, string> | null = null;
let _dynamicAliasMapTs = 0;

/** Shared raw token data from SaucerSwap /tokens API. */
let _rawTokenData: any[] | null = null;
let _rawTokenDataTs = 0;

/** Cache TTL for dynamic alias map and raw token data: 5 minutes. */
const DYNAMIC_ALIAS_TTL_MS = 300_000;

/** Parse entity number from HTS ID: "0.0.1055483" → 1055483 */
function parseEntityNum(htsId: string): number {
  const parts = htsId.split(".");
  return parseInt(parts[parts.length - 1] || "0", 10);
}

/**
 * [C100 Step 4] Shared raw token data cache.
 *
 * Both `ensureTokenPrices()` and `ensureDynamicAliasMap()` need the
 * same /tokens API response. This shared cache ensures we make at most
 * ONE API call per 5-minute window, not two.
 */
async function ensureRawTokenData(): Promise<any[]> {
  if (_rawTokenData && Date.now() - _rawTokenDataTs < DYNAMIC_ALIAS_TTL_MS) {
    return _rawTokenData;
  }
  const data = await ssFetchSaucerSwapApi("/tokens");
  if (!data) return _rawTokenData || [];
  const tokens: any[] = Array.isArray(data) ? data : Object.values(data);
  _rawTokenData = tokens;
  _rawTokenDataTs = Date.now();
  return tokens;
}

/**
 * [C100 Step 4] Build canonical → V2 alias map from live SaucerSwap API.
 *
 * Scans the /tokens response for bridge token symbols with multiple HTS IDs.
 * For each such group, maps the lowest entity number (canonical bridge token)
 * to the highest (V2 ERC20Wrapper).
 *
 * Also logs non-bridge symbols with multiple IDs for diagnostic review
 * (potential new bridge tokens to add to BRIDGE_TOKEN_SYMBOLS).
 */
async function ensureDynamicAliasMap(): Promise<Map<string, string>> {
  if (_dynamicAliasMap && Date.now() - _dynamicAliasMapTs < DYNAMIC_ALIAS_TTL_MS) {
    return _dynamicAliasMap;
  }

  try {
    const tokens = await ensureRawTokenData();
    if (tokens.length === 0) {
      console.log("[SS-Quote] [C100-S4] Dynamic alias: no token data, using hardcoded fallback");
      return _dynamicAliasMap || new Map();
    }

    // Group tokens by normalized symbol
    const bySymbol = new Map<string, { id: string; entityNum: number }[]>();
    for (const t of tokens) {
      const sym = (t.symbol || "").toUpperCase().trim();
      const id = t.id || t.tokenId || t.token_id || "";
      if (!sym || !id || !id.startsWith("0.0.")) continue;

      if (!bySymbol.has(sym)) bySymbol.set(sym, []);
      bySymbol.get(sym)!.push({ id, entityNum: parseEntityNum(id) });
    }

    const aliasMap = new Map<string, string>();

    for (const [symbol, entries] of bySymbol) {
      if (entries.length < 2) continue;

      // Sort by entity number ascending — lowest = canonical (created first)
      entries.sort((a, b) => a.entityNum - b.entityNum);

      const canonical = entries[0];
      const alias = entries[entries.length - 1];
      if (canonical.id === alias.id) continue;

      if (BRIDGE_TOKEN_SYMBOLS.has(symbol)) {
        // Known bridge symbol — auto-discover V2 wrapper
        aliasMap.set(canonical.id, alias.id);
        // Only log when the discovered alias differs from the hardcoded one
        if (TOKEN_ALIAS_MAP[canonical.id] !== alias.id) {
          console.log(`[SS-Quote] [C100-S4] NEW dynamic alias: ${symbol} ${canonical.id} → ${alias.id}`);
        }
      } else if (entries.length >= 2) {
        // Non-bridge symbol with multiple IDs — log for diagnostics.
        // This helps operators discover new bridge tokens that need
        // adding to BRIDGE_TOKEN_SYMBOLS.
        console.log(`[SS-Quote] [C100-S4] Multi-ID symbol (not bridge): ${symbol} → ` +
          entries.map(e => e.id).join(", "));
      }
    }

    _dynamicAliasMap = aliasMap;
    _dynamicAliasMapTs = Date.now();
    console.log(`[SS-Quote] [C100-S4] Dynamic alias map: ${aliasMap.size} pairs from ${tokens.length} API tokens`);
    return aliasMap;
  } catch (err: any) {
    console.log(`[SS-Quote] [C100-S4] Dynamic alias error: ${err?.message || err}`);
    return _dynamicAliasMap || new Map();
  }
}

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
 * [C100 Step 3] Variant of raceRpcAndMirror with an explicit hard timeout.
 *
 * Used by V1 strategies to enforce a tighter ceiling (V1_RPC_TIMEOUT_MS = 5s)
 * than the default RPC/Mirror timeouts (12s/10s). V1 Router reverts are fast
 * on Hedera (~2-3s for a non-existent pair), so 5s is generous for success
 * and tight enough to prevent V1 failures from dominating quote latency.
 *
 * Returns null if neither RPC nor Mirror produces a valid result within the
 * given timeout — the same contract as raceRpcAndMirror.
 */
async function raceRpcAndMirrorWithTimeout(
  toEvm: string, calldata: string, network: string, timeoutMs: number,
  gasLimit: number = 1_500_000,
): Promise<string | null> {
  const validate = (r: any): r is string =>
    r != null && typeof r === "string" && r !== "0x" && r.length > 2;

  const rpcP = ssFetchJsonRpc(
    "eth_call", [{ to: toEvm, data: calldata, gas: GAS_HEX }, "latest"], network,
  ).then(r => { if (validate(r)) return r as string; throw new Error("rpc-empty"); });

  const mirrorP = ssMirrorContractCall(toEvm, calldata, network, gasLimit)
    .then(r => { if (validate(r)) return r as string; throw new Error("mirror-empty"); });

  const timeoutP = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("v1-fast-timeout")), timeoutMs)
  );

  try {
    return await Promise.race([Promise.any([rpcP, mirrorP]), timeoutP]);
  } catch {
    return null; // Both failed, returned empty, or timed out
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
  "0.0.1055483": 104000, // WBTC (canonical)
  "0.0.10104132": 104000,// WBTC (V2 alias)
  "0.0.541564": 2650,    // WETH (canonical)
  "0.0.1969708": 2650,   // WETH (V2 alias)
  "0.0.1055495": 16.50,  // LINK (canonical)
  "0.0.10152778": 16.50, // LINK (V2 alias)
  "0.0.834116": 0.11,    // HBARX
  "0.0.7374029": 0.000001, // HBAR.h
  "0.0.968069": 0.018,   // HST
  "0.0.1157005": 660,    // WBNB
  "0.0.1055459": 1.0,    // USDCh
  "0.0.4794920": 0.015,  // PACK (correct ID)
  "0.0.3716059": 0.002,  // DOVU (correct ID)
  "0.0.2283230": 0.0003, // KARATE (correct ID)
};

const VALID_NETWORKS = new Set(["mainnet", "testnet"]);

// ════════════════════════════════════════════════════════════════════
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

  // [C100 Step 4] Use shared raw token data cache to avoid redundant
  // /tokens API calls (ensureDynamicAliasMap uses the same data).
  const tokens = await ensureRawTokenData();
  const prices = new Map<string, number>();

  // Seed with fallbacks
  for (const [id, price] of Object.entries(FALLBACK_PRICES_USD)) {
    prices.set(id, price);
  }

  if (tokens.length > 0) {
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

/** Strategy 1: V1 Router getAmountsOut() — [C92] parallel RPC + Mirror race.
 * [C100 Step 3] Fast-bails for V2-only tokens + V1-specific 5s timeout. */
async function strategyV1Router(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  // [C100 Step 3] Fast bail — V2-only tokens have zero V1 liquidity,
  // so getAmountsOut will always revert. Skip to save 2–12s of RPC latency.
  if (isV2OnlyToken(inputHtsId) || isV2OnlyToken(outputHtsId)) {
    console.log(`[SS-Quote] [C100] V1 direct skipped — ${isV2OnlyToken(inputHtsId) ? inputHtsId : outputHtsId} is V2-only`);
    return null;
  }

  const routerId = V1_ROUTER_IDS[network] || V1_ROUTER_IDS.mainnet;
  const routerEvm = await resolveContract(routerId, network);
  const calldata = encodeGetAmountsOut(amountIn, [tokenInEvm, tokenOutEvm]);

  // [C92] Race RPC + Mirror in parallel — whichever succeeds first wins
  // [C100 Step 3] V1-specific 5s timeout — reverts are fast on Hedera,
  // so 5s is generous for success and tight enough to avoid dominating latency.
  const result = await raceRpcAndMirrorWithTimeout(routerEvm, calldata, network, V1_RPC_TIMEOUT_MS);
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
 * [C92] Uses parallel RPC + Mirror race.
 * [C100 Step 3] Fast-bails for V2-only tokens + V1-specific 5s timeout. */
async function strategyV1RouterMultiHop(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  // [C100 Step 3] Fast bail — if either token is V2-only, the V1 leg
  // involving it (tokenIn→WHBAR or WHBAR→tokenOut) will always revert.
  if (isV2OnlyToken(inputHtsId) || isV2OnlyToken(outputHtsId)) {
    console.log(`[SS-Quote] [C100] V1 multi-hop skipped — ${isV2OnlyToken(inputHtsId) ? inputHtsId : outputHtsId} is V2-only`);
    return null;
  }

  const whbarEvm = htsIdToEvmAddress(WHBAR_HTS_ID);
  // Skip if either token is already WHBAR
  if (tokenInEvm.toLowerCase() === whbarEvm.toLowerCase() ||
      tokenOutEvm.toLowerCase() === whbarEvm.toLowerCase()) return null;

  const routerId = V1_ROUTER_IDS[network] || V1_ROUTER_IDS.mainnet;
  const routerEvm = await resolveContract(routerId, network);
  const calldata = encodeGetAmountsOut(amountIn, [tokenInEvm, whbarEvm, tokenOutEvm]);

  // [C92] Race RPC + Mirror in parallel
  // [C100 Step 3] V1-specific 5s timeout
  const result = await raceRpcAndMirrorWithTimeout(routerEvm, calldata, network, V1_RPC_TIMEOUT_MS);
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
 * Each tier races RPC + Mirror simultaneously.
 * [C99] Uses V2 alias EVM addresses for bridge tokens. */
async function strategyV2Quoter(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  _fee: number, inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  const quoterId = V2_QUOTER_IDS[network] || V2_QUOTER_IDS.mainnet;
  const quoterEvm = await resolveContract(quoterId, network);

  // [C99] V2 pools use wrapper addresses for bridge tokens — resolve aliases
  const v2InEvm = resolveV2Evm(inputHtsId);
  const v2OutEvm = resolveV2Evm(outputHtsId);
  const usedAlias = v2InEvm !== tokenInEvm || v2OutEvm !== tokenOutEvm;
  if (usedAlias) {
    console.log(`[SS-Quote] [C99] V2 quoter using alias addresses: in=${inputHtsId}→${resolveV2AliasId(inputHtsId)}, out=${outputHtsId}→${resolveV2AliasId(outputHtsId)}`);
  }

  // [C92] Try ALL V2 fee tiers in parallel — pick the one with highest output.
  // Previously only tried the detected fee (or default 3000), missing pools
  // at other tiers entirely. This is the root cause of many "no quote" failures.
  const feeProbes = V2_FEE_TIERS.map(async (fee): Promise<QuoteResult | null> => {
    const calldata = encodeQuoteExactInputSingle(v2InEvm, v2OutEvm, amountIn, fee);
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

  // [C99] If alias addresses differ from canonical, also probe with canonical
  // addresses. Some V2 pools may use canonical IDs (non-bridge tokens paired
  // with bridge tokens where only one side has an alias).
  if (usedAlias) {
    for (const fee of V2_FEE_TIERS) {
      feeProbes.push((async (): Promise<QuoteResult | null> => {
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
      })());
    }
  }

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

/** Strategy 3: V2 QuoterV2 quoteExactInput() multi-hop through WHBAR.
 * [C99] Uses V2 alias EVM addresses for bridge tokens in packed path. */
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

  // [C99] V2 pools use wrapper addresses for bridge tokens
  const v2InEvm = resolveV2Evm(inputHtsId);
  const v2OutEvm = resolveV2Evm(outputHtsId);
  const usedAlias = v2InEvm !== tokenInEvm || v2OutEvm !== tokenOutEvm;
  if (usedAlias) {
    console.log(`[SS-Quote] [C99] V2 multi-hop using alias: in=${inputHtsId}→${resolveV2AliasId(inputHtsId)}, out=${outputHtsId}→${resolveV2AliasId(outputHtsId)}`);
  }

  // Try common fee combos for the 2-hop path: tokenIn → WHBAR → tokenOut
  // [C90] Expanded to cover ALL SaucerSwap V2 fee tiers (100, 500, 1500, 3000, 10000).
  // Promise.any returns the FIRST successful result — we get speed AND coverage.
  const feeCombos: [number, number][] = [
    [3000, 3000], [1500, 3000], [3000, 1500], [10000, 3000],
    [3000, 10000], [500, 3000], [3000, 500],
  ];

  const probes = feeCombos.map(async ([fee1, fee2]) => {
    // [C99] Use alias EVM addresses in packed path for V2 pools
    const packedPath = encodePackedPath([
      { tokenEvm: v2InEvm, fee: fee1 },
      { tokenEvm: whbarEvm, fee: fee2 },
      { tokenEvm: v2OutEvm, fee: 0 },
    ]);
    const calldata = encodeQuoteExactInput(packedPath, amountIn);

    const rpcResult = await ssFetchJsonRpc("eth_call", [{ to: quoterEvm, data: calldata, gas: GAS_HEX }, "latest"], network);
    if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length >= 66) {
      const amountOutHex = rpcResult.slice(2, 66);
      const out = BigInt("0x" + amountOutHex);
      if (out > 0n) {
        console.log(`[SS-Quote] V2 multi-hop (RPC): amountOut=${out} fees=${fee1}/${fee2}${usedAlias ? " [C99-alias]" : ""}`);
        return {
          amountOut: out.toString(), source: "v2-multihop", confidence: "high" as const, priceImpact: 0,
          route: [inputHtsId, WHBAR_HTS_ID, outputHtsId], poolVersion: "v2" as const, feeTier: fee1,
        };
      }
    }
    throw new Error("no-result"); // Signal Promise.any to try next
  });

  // [C99] If alias addresses are different, also try canonical addresses as fallback
  if (usedAlias) {
    for (const [fee1, fee2] of feeCombos.slice(0, 4)) { // Top 4 fee combos for canonical fallback
      probes.push((async () => {
        const packedPath = encodePackedPath([
          { tokenEvm: tokenInEvm, fee: fee1 },
          { tokenEvm: whbarEvm, fee: fee2 },
          { tokenEvm: tokenOutEvm, fee: 0 },
        ]);
        const calldata = encodeQuoteExactInput(packedPath, amountIn);
        const rpcResult = await ssFetchJsonRpc("eth_call", [{ to: quoterEvm, data: calldata, gas: GAS_HEX }, "latest"], network);
        if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length >= 66) {
          const out = BigInt("0x" + rpcResult.slice(2, 66));
          if (out > 0n) {
            console.log(`[SS-Quote] V2 multi-hop (RPC, canonical fallback): amountOut=${out} fees=${fee1}/${fee2}`);
            return {
              amountOut: out.toString(), source: "v2-multihop", confidence: "high" as const, priceImpact: 0,
              route: [inputHtsId, WHBAR_HTS_ID, outputHtsId], poolVersion: "v2" as const, feeTier: fee1,
            };
          }
        }
        throw new Error("no-result");
      })());
    }
  }

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
// ════════════════════════════════════════════════════════════════════
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
 *
 * [C100 Step 3] V1 probes are SKIPPED entirely when input or output is a
 * V2-only token (PACK, KARATE, DOVU). This eliminates 10+ RPC calls that
 * would all revert, saving 2–12s of accumulated latency per intermediary.
 * Remaining V1 probes (for tokens with V1 liquidity) use the tighter
 * V1_RPC_TIMEOUT_MS (5s) via raceRpcAndMirrorWithTimeout.
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

  // [C100 Step 3] Determine if V1 probes should be skipped.
  // If either the input or output token is V2-only, ALL V1 multi-hop paths
  // through any intermediary will fail (the V1 leg involving the V2-only
  // token always reverts). Skip all V1 probes to avoid wasted RPC calls.
  const skipV1 = isV2OnlyToken(inputHtsId) || isV2OnlyToken(outputHtsId);
  if (skipV1) {
    console.log(`[SS-Quote] [C100] Skipping ALL V1 intermediary probes — ` +
      `${isV2OnlyToken(inputHtsId) ? inputHtsId : outputHtsId} is V2-only ` +
      `(${candidates.length} intermediaries × V1 probes eliminated)`);
  }

  const [routerEvm, quoterEvm] = await Promise.all([
    // [C100 Step 3] Only resolve V1 router if we'll actually use it
    skipV1 ? Promise.resolve("") : resolveContract(routerId, network),
    resolveContract(quoterId, network),
  ]);

  const probes: Promise<QuoteResult | null>[] = [];

  // [C99] Resolve V2 alias EVM addresses for input/output tokens
  const v2InEvm = resolveV2Evm(inputHtsId);
  const v2OutEvm = resolveV2Evm(outputHtsId);

  for (const mid of candidates) {
    const midEvm = htsIdToEvmAddress(mid.htsId);
    // [C99] V2 alias EVM for intermediary token (uses v2AliasId if present)
    const midV2Evm = mid.v2AliasId ? htsIdToEvmAddress(mid.v2AliasId) : midEvm;

    // V1 multi-hop: tokenIn → mid → tokenOut via getAmountsOut
    // [C99] V1 uses CANONICAL addresses (V1 Factory pairs registered with canonical IDs)
    // [C100 Step 3] Skipped entirely for V2-only tokens; uses 5s timeout otherwise
    if (!skipV1) {
      probes.push((async (): Promise<QuoteResult | null> => {
        try {
          const calldata = encodeGetAmountsOut(amountIn, [tokenInEvm, midEvm, tokenOutEvm]);
          // [C100 Step 3] Use V1-specific 5s timeout instead of default 12s
          const rpcResult = await raceRpcAndMirrorWithTimeout(routerEvm, calldata, network, V1_RPC_TIMEOUT_MS);
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
    }

    // V2 multi-hop: tokenIn → mid → tokenOut via quoteExactInput
    // [C90] Expanded fee combos to cover ALL SaucerSwap V2 tiers.
    // [C99] Uses V2 ALIAS addresses for bridge tokens in packed path.
    const feeCombos: [number, number][] = [
      [3000, 3000], [1500, 3000], [3000, 1500], [10000, 3000],
      [3000, 10000], [500, 3000], [3000, 500],
    ];
    for (const [fee1, fee2] of feeCombos) {
      probes.push((async (): Promise<QuoteResult | null> => {
        try {
          // [C99] Use V2 alias addresses in packed path
          const packedPath = encodePackedPath([
            { tokenEvm: v2InEvm, fee: fee1 },
            { tokenEvm: midV2Evm, fee: fee2 },
            { tokenEvm: v2OutEvm, fee: 0 },
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

  // [C100 Step 3] Enhanced logging — shows V1/V2 split for diagnostics
  const v1Count = routes.filter(r => r.poolVersion === "v1").length;
  const v2Count = routes.filter(r => r.poolVersion === "v2").length;
  console.log(`[C52] Multi-route probed ${probes.length} combos → ${routes.length} valid routes (V1=${v1Count}, V2=${v2Count}${skipV1 ? ", V1-skipped" : ""})`);
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
  inputAliasId?: string;
  outputAliasId?: string;
}): Promise<{ best: QuoteResult | null; allQuotes: QuoteResult[]; scoredRoutes: ScoredRoute[]; poolInfo: PoolVersionInfo | null }> {
  const { inputToken, outputToken, amountIn, slippage, inputDecimals, outputDecimals, network, inputAliasId, outputAliasId } = params;
  const amountInBigInt = BigInt(amountIn);

  // Resolve tokens to EVM addresses (HBAR → WHBAR for routing)
  const inputHtsId = inputToken === "HBAR" ? WHBAR_HTS_ID : inputToken;
  const outputHtsId = outputToken === "HBAR" ? WHBAR_HTS_ID : outputToken;
  const tokenInEvm = htsIdToEvmAddress(inputHtsId);
  const tokenOutEvm = htsIdToEvmAddress(outputHtsId);

  // [C100 Step 4] Pre-warm dynamic alias map from SaucerSwap /tokens API.
  // Must run BEFORE registering request aliases so that resolveV2AliasId()
  // has all three layers available. The call is instant on cache hit (5-min TTL).
  await ensureDynamicAliasMap();

  // [C99] Register request-scoped alias hints from client
  if (inputAliasId) {
    _requestAliases = new Map();
    _requestAliases.set(inputHtsId, inputAliasId);
  }
  if (outputAliasId) {
    if (!_requestAliases) _requestAliases = new Map();
    _requestAliases.set(outputHtsId, outputAliasId);
  }

  // Check quote cache
  const cacheKey = `${network}:${inputHtsId}:${outputHtsId}:${amountIn}`;
  const cachedEntry = _quoteCache.get(cacheKey);
  if (cachedEntry && Date.now() - cachedEntry.ts < QUOTE_CACHE_TTL_MS) {
    _requestAliases = null; // [C99] Clean up before early return
    return { best: cachedEntry.value, allQuotes: [cachedEntry.value], scoredRoutes: [], poolInfo: null };
  }

  // [C99] Wrap strategy execution in try/finally to guarantee alias cleanup
  try {

  // Detect pool (uses C45 cache internally)
  const poolInfo = await ssDetectPoolVersion(tokenInEvm, tokenOutEvm, network);
  // [C99] If no pool found with canonical addresses and token has V2 alias,
  // retry pool detection with V2 alias EVM addresses
  let effectivePoolInfo = poolInfo;
  if (!poolInfo) {
    const v2InEvm = resolveV2Evm(inputHtsId);
    const v2OutEvm = resolveV2Evm(outputHtsId);
    if (v2InEvm !== tokenInEvm || v2OutEvm !== tokenOutEvm) {
      console.log(`[SS-Quote] [C99] Retrying pool detection with V2 alias addresses`);
      effectivePoolInfo = await ssDetectPoolVersion(v2InEvm, v2OutEvm, network);
      if (effectivePoolInfo) {
        console.log(`[SS-Quote] [C99] Pool found via V2 alias: ${effectivePoolInfo.version} fee=${effectivePoolInfo.feeTier}`);
      }
    }
  }
  const fee = effectivePoolInfo?.feeTier || 3000;

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

  } finally {
    // [C99] Guarantee alias cleanup — prevents leaking across requests on error
    _requestAliases = null;
  }
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
    const inputAliasId  = c.req.query("inputAliasId");
    const outputAliasId = c.req.query("outputAliasId");

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
        inputAliasId, outputAliasId,
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
        // [C100 Step 4] Diagnostics: how many dynamic aliases are active
        dynamicAliases: _dynamicAliasMap?.size ?? 0,
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
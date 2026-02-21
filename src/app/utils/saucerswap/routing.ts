/**
 * [C48] SaucerSwap Routing & Pool Route Definitions
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: Swap path building, multi-hop route finding,
 * intermediary token selection, pool route definitions (static & live),
 * and the client-facing findSwapRoute() function.
 *
 * buildSwapPath()           -- Build the on-chain token path for a swap
 * findSwapRoute()           -- Find the best route between two tokens
 * getIntermediaryTokens()   -- Get candidate intermediary tokens for multi-hop
 * findBestMultiHopRoute()   -- Try multi-hop via intermediary tokens
 * getPoolRoutes()           -- Static fallback pool routes
 * fetchPoolRoutes()         -- Live pool routes from backend proxy
 */

import { log } from "../logger";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import type { AllowedToken, HederaNetwork } from "./tokens";
import {
  TOKEN_BY_SYMBOL,
  TOKEN_BY_HTS_ID,
  resolveToken,
  getSaucerswapRoutingEvmAddress,
  evmAddressToHtsId,
} from "./tokens";
import type { PoolVersionInfo } from "./pools";
import { detectPoolVersion } from "./pools";

// ═══════════════════════════════════════════════════════════════════════
// ── SWAP PATH BUILDING ────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * Build the on-chain token path for a V1 router swap.
 * If input/output are both non-WHBAR non-stable, routes through WHBAR.
 * Stable-to-stable (USDC<->USDT) is direct.
 */
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

// ════════════════════════════════════════════════════════════════════════
// ── INTERMEDIARY TOKEN SELECTION ──────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * Get intermediary tokens for multi-hop routing.
 * These are the deepest liquidity hubs on SaucerSwap.
 * Excludes the input and output tokens to avoid circular routes.
 *
 * [C26-01] Expanded from 3 to 6 intermediary candidates for deeper
 * routing coverage. Also excludes WHBAR when input/output is native
 * HBAR to prevent the self-loop bug (WHBAR->WHBAR pool check).
 */
export function getIntermediaryTokens(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
): string[] {
  const whbar = TOKEN_BY_SYMBOL.get("WHBAR");
  const usdc = TOKEN_BY_SYMBOL.get("USDC");
  const sauce = TOKEN_BY_SYMBOL.get("SAUCE");
  const usdch = TOKEN_BY_SYMBOL.get("USDCh");
  // [C36-04] Changed from "USDTh" to "USDT" after merging USDTh into USDT.
  const usdth = TOKEN_BY_SYMBOL.get("USDT");
  const hbarx = TOKEN_BY_SYMBOL.get("HBARX");

  const candidates: AllowedToken[] = [];
  if (whbar) candidates.push(whbar);
  if (usdc) candidates.push(usdc);
  if (sauce) candidates.push(sauce);
  if (usdch) candidates.push(usdch);
  if (usdth) candidates.push(usdth);
  if (hbarx) candidates.push(hbarx);

  // Exclude tokens that are the input or output themselves.
  // [C26-01] For native HBAR, also exclude WHBAR since HBAR is internally
  // routed as WHBAR -- including it as intermediary creates a self-loop
  // (e.g., WHBAR->WHBAR pool check) that always fails.
  const inputEvm = getSaucerswapRoutingEvmAddress(inputToken).toLowerCase();
  const outputEvm = getSaucerswapRoutingEvmAddress(outputToken).toLowerCase();

  // Also get WHBAR EVM for native HBAR exclusion
  const whbarEvm = whbar ? getSaucerswapRoutingEvmAddress(whbar).toLowerCase() : "";
  const isInputEffectivelyWhbar = inputToken.isNative || inputEvm === whbarEvm;
  const isOutputEffectivelyWhbar = outputToken.isNative || outputEvm === whbarEvm;

  return candidates
    .map(t => getSaucerswapRoutingEvmAddress(t))
    .filter(addr => {
      const low = addr.toLowerCase();
      if (low === inputEvm || low === outputEvm) return false;
      // [C26-01] Exclude WHBAR when native HBAR is input/output
      if (low === whbarEvm && (isInputEffectivelyWhbar || isOutputEffectivelyWhbar)) return false;
      return true;
    });
}

/**
 * Find the best multi-hop route through intermediary tokens.
 * Tries each intermediary and returns the first valid route (V2 preferred).
 *
 * [C26-01] Adds safety check: skips intermediaries whose EVM address matches
 * the input or output token to prevent self-loop pool checks (e.g., WHBAR->WHBAR).
 *
 * Returns null if no valid route exists through any intermediary.
 */
export async function findBestMultiHopRoute(
  tokenInEvm: string,
  tokenOutEvm: string,
  intermediaries: string[],
  network: HederaNetwork,
): Promise<{ hops: PoolVersionInfo[]; tokens: string[] } | null> {
  const inLow = tokenInEvm.toLowerCase();
  const outLow = tokenOutEvm.toLowerCase();

  for (const mid of intermediaries) {
    const midLow = mid.toLowerCase();
    const midId = evmAddressToHtsId(mid);

    // [C26-01] Skip intermediaries that are the same as input or output --
    // prevents self-loop (e.g., WHBAR->WHBAR) when HBAR->Token uses WHBAR as both
    // the effective input (via buildSwapPath) and an intermediary candidate.
    if (midLow === inLow || midLow === outLow) {
      console.log(`[HBAR.h] Multi-hop: skipping ${midId} -- same as input or output`);
      continue;
    }

    console.log(`[HBAR.h] Multi-hop: trying intermediary ${midId} (${mid.slice(0, 14)}...)`);

    // Check both legs concurrently
    const [hop1, hop2] = await Promise.all([
      detectPoolVersion(tokenInEvm, mid, network),
      detectPoolVersion(mid, tokenOutEvm, network),
    ]);

    if (hop1 && hop2) {
      console.log(`[HBAR.h] Multi-hop: route found via ${midId} -- hop1=${hop1.version}(fee=${hop1.feeTier}) hop2=${hop2.version}(fee=${hop2.feeTier})`);
      return {
        hops: [hop1, hop2],
        tokens: [tokenInEvm, mid, tokenOutEvm],
      };
    }

    console.log(`[HBAR.h] Multi-hop: ${midId} -- hop1=${hop1 ? "ok" : "no"} hop2=${hop2 ? "ok" : "no"}`);
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// ── POOL ROUTE TYPES & DATA ───────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

export interface PoolRoute {
  id: string;
  tokenA: AllowedToken;
  tokenB: AllowedToken;
  fee: number;
  tvlUsd: number;
  volume24hUsd: number;
  apr: number;
  poolAddress: string; // SaucerSwap V1/V2 pool contract on Hedera
  source?: "v1" | "v2";
}

// -- Live pool data cache (populated by fetchPoolRoutes) --
let _livePoolRouteCache: PoolRoute[] | null = null;
let _livePoolCacheTs = 0;
const POOL_ROUTE_CACHE_TTL = 60_000; // 60s

/**
 * Resolve a pool token symbol to the correct AllowedToken.
 * Maps "HBAR" display label (from [C22-01] normalization) back to the
 * native HBAR AllowedToken for swap execution compatibility.
 */
function resolvePoolToken(symbol: string): AllowedToken | undefined {
  // "HBAR" from backend normalization -> native HBAR token
  if (symbol === "HBAR") return TOKEN_BY_SYMBOL.get("HBAR");
  // Direct match
  const direct = TOKEN_BY_SYMBOL.get(symbol);
  if (direct) return direct;
  // [C24-01] Strip [hts]/[HTS] suffix for resilience
  const cleaned = symbol.replace("[hts]", "").replace("[HTS]", "");
  if (cleaned !== symbol) return TOKEN_BY_SYMBOL.get(cleaned);
  // [C36-04] HBAR.h aliases
  const upper = symbol.toUpperCase();
  if (upper === "HBAR.H" || upper === "HBARH" || upper === "HBAR.\u0126") {
    return TOKEN_BY_SYMBOL.get("HBAR.\u0127");
  }
  // [C36-04] Try HTS ID-based fallback
  const byId = TOKEN_BY_HTS_ID.get(symbol);
  if (byId) return byId;
  return undefined;
}

/**
 * Fetch live pool routes from the WRAPpDEX backend proxy.
 * Backend fetches from SaucerSwap V1+V2 APIs, merges + sorts by TVL,
 * and normalizes WHBAR -> HBAR display names ([C22-01]).
 *
 * Returns PoolRoute[] for the swap panel pool table.
 * Caches 60s client-side to avoid redundant network calls.
 */
export async function fetchPoolRoutes(): Promise<PoolRoute[]> {
  // Return cache if fresh
  if (_livePoolRouteCache && Date.now() - _livePoolCacheTs < POOL_ROUTE_CACHE_TTL) {
    return _livePoolRouteCache;
  }

  try {
    const url = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/saucerswap/pools`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${publicAnonKey}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      log.warn("PoolRoutes", `Backend proxy -> HTTP ${res.status}`);
      return getPoolRoutes(); // Fallback to static
    }

    const data = await res.json();
    if (!data?.pools || !Array.isArray(data.pools)) {
      log.warn("PoolRoutes", "Invalid response structure");
      return getPoolRoutes();
    }

    const routes: PoolRoute[] = data.pools
      .map((p: any) => {
        const tA = resolvePoolToken(p.tokenA?.symbol || "");
        const tB = resolvePoolToken(p.tokenB?.symbol || "");
        if (!tA || !tB) return null;
        return {
          id: p.id || p.contractId || `${tA.symbol}-${tB.symbol}`,
          tokenA: tA,
          tokenB: tB,
          fee: typeof p.fee === "number" ? p.fee : 0.3,
          tvlUsd: typeof p.tvl === "number" ? p.tvl : 0,
          volume24hUsd: typeof p.volume24h === "number" ? p.volume24h : 0,
          apr: typeof p.totalAPR === "number" ? p.totalAPR : (typeof p.apr === "number" ? p.apr : 0),
          poolAddress: p.contractId || "factory-resolved",
          source: (p.source || "v1") as "v1" | "v2",
        };
      })
      .filter((r: PoolRoute | null): r is PoolRoute => r !== null && r.tvlUsd >= 100);

    if (routes.length > 0) {
      _livePoolRouteCache = routes;
      _livePoolCacheTs = Date.now();
      log.info("PoolRoutes", `Loaded ${routes.length} live pools from backend`);
      return routes;
    }
  } catch (err: any) {
    log.warn("PoolRoutes", `fetchPoolRoutes failed: ${err?.message || err}`);
  }

  return getPoolRoutes(); // Fallback
}

/**
 * Static pool route fallback -- used when the backend is unreachable.
 * [C22-01] Displays HBAR (native) instead of WHBAR.
 * Returns cached live data if available.
 */
export function getPoolRoutes(): PoolRoute[] {
  const tok = (sym: string) => TOKEN_BY_SYMBOL.get(sym)!;
  // Pool addresses are resolved on-chain by the SaucerSwap V1 Factory (0.0.1062784).
  // The router's swap functions call Factory.getPair() internally.
  const FR = "factory-resolved";
  // [C22-01] tokenA uses HBAR (native) instead of WHBAR for user-facing display.
  // The swap engine handles HBAR -> WHBAR wrapping transparently.
  const hardcoded: PoolRoute[] = [
    { id: "ss-hbar-usdc",   tokenA: tok("HBAR"),  tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-usdt",   tokenA: tok("HBAR"),  tokenB: tok("USDT"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-usdc-usdt",   tokenA: tok("USDC"),  tokenB: tok("USDT"),   fee: 0.01, tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-wbtc",   tokenA: tok("HBAR"),  tokenB: tok("WBTC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-weth",   tokenA: tok("HBAR"),  tokenB: tok("WETH"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-link",   tokenA: tok("HBAR"),  tokenB: tok("LINK"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-sauce",  tokenA: tok("HBAR"),  tokenB: tok("SAUCE"),  fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-hbarx",  tokenA: tok("HBAR"),  tokenB: tok("HBARX"),  fee: 0.05, tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-karate", tokenA: tok("HBAR"),  tokenB: tok("KARATE"), fee: 1.0,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-pack",   tokenA: tok("HBAR"),  tokenB: tok("PACK"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-dovu",   tokenA: tok("HBAR"),  tokenB: tok("DOVU"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-hst",    tokenA: tok("HBAR"),  tokenB: tok("HST"),    fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    // [C36-04] HBAR.h is a V1 AMM pool, not V2. Pool address resolved by V1 Factory.
    { id: "ss-hbar-hbarh",  tokenA: tok("HBAR"),  tokenB: tok("HBAR.\u0127"), fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-sauce-usdc",  tokenA: tok("SAUCE"), tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-wbtc-usdc",   tokenA: tok("WBTC"),  tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-weth-usdc",   tokenA: tok("WETH"),  tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
  ].filter(r => r.tokenA && r.tokenB); // Safety filter

  // [C36-04] Merge live API data with hardcoded fallbacks.
  // Previously, live data REPLACED hardcoded routes entirely, which caused
  // "No Route Available" for tokens not returned by the SaucerSwap API.
  // Now: live data takes priority, but hardcoded routes fill any gaps.
  if (_livePoolRouteCache && Date.now() - _livePoolCacheTs < POOL_ROUTE_CACHE_TTL * 5) {
    const pairKey = (a: string, b: string) => [a, b].sort().join("/");
    const livePairs = new Set(
      _livePoolRouteCache.map(r => pairKey(r.tokenA.symbol, r.tokenB.symbol))
    );
    const merged = [..._livePoolRouteCache];
    for (const hc of hardcoded) {
      const key = pairKey(hc.tokenA.symbol, hc.tokenB.symbol);
      if (!livePairs.has(key)) {
        merged.push(hc);
      }
    }
    return merged;
  }

  return hardcoded;
}

// ════════════════════════════════════════════════════════════════════════
// ── FIND SWAP ROUTE ───────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

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

  // Native HBAR <-> WHBAR is just wrap/unwrap, not a pool swap
  if (
    (input.isNative && output.symbol === "WHBAR") ||
    (input.symbol === "WHBAR" && output.isNative)
  ) {
    return null; // Handled by wrapHbar/unwrapHbar directly
  }

  const routes = getPoolRoutes();

  // [C22-01] Pool routes now display "HBAR" instead of "WHBAR".
  // Normalize both HBAR (native) and WHBAR to "HBAR" for pool lookup,
  // since pool tokens use the native HBAR AllowedToken.
  const lookupInput = (input.isNative || input.symbol === "WHBAR") ? "HBAR" : input.symbol;
  const lookupOutput = (output.isNative || output.symbol === "WHBAR") ? "HBAR" : output.symbol;

  if (lookupInput === lookupOutput) return null;

  // Try direct route first
  const directPool = routes.find(
    r => (r.tokenA.symbol === lookupInput && r.tokenB.symbol === lookupOutput) ||
         (r.tokenB.symbol === lookupInput && r.tokenA.symbol === lookupOutput)
  );
  if (directPool) {
    return { path: [input, output], pools: [directPool], totalFee: directPool.fee };
  }

  // Try 2-hop route through HBAR (pools display HBAR, on-chain wraps to WHBAR)
  const hbar = TOKEN_BY_SYMBOL.get("HBAR");
  if (hbar && lookupInput !== "HBAR" && lookupOutput !== "HBAR") {
    const pool1 = routes.find(
      r => (r.tokenA.symbol === lookupInput && r.tokenB.symbol === "HBAR") ||
           (r.tokenB.symbol === lookupInput && r.tokenA.symbol === "HBAR")
    );
    const pool2 = routes.find(
      r => (r.tokenA.symbol === "HBAR" && r.tokenB.symbol === lookupOutput) ||
           (r.tokenB.symbol === "HBAR" && r.tokenA.symbol === lookupOutput)
    );
    if (pool1 && pool2) {
      return {
        path: [input, hbar, output],
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

// ════════════════════════════════════════════════════════════════════════
// ── ASYNC ROUTE FINDING (ON-CHAIN FALLBACK) ─────────────────────────
// ════════════════════════════════════════════════════════════════════════

// ── Route cache for on-chain detection results ──
// Caches both positive (route found) and negative (no route) results
// to avoid redundant JSON-RPC calls when the user toggles tokens back.

type AsyncRouteResult = { path: AllowedToken[]; pools: PoolRoute[]; totalFee: number; onChain: boolean } | null;

interface RouteCacheEntry {
  result: AsyncRouteResult;
  ts: number;
}

const _asyncRouteCache = new Map<string, RouteCacheEntry>();
const ASYNC_ROUTE_CACHE_TTL = 120_000; // 2 minutes — on-chain pool topology changes slowly
const ASYNC_ROUTE_CACHE_MAX = 200; // cap to prevent unbounded growth with dynamic tokens

function _routeCacheKey(inputSymbol: string, outputSymbol: string, network: HederaNetwork): string {
  return `${inputSymbol}:${outputSymbol}:${network}`;
}

/**
 * Evict stale entries and enforce max cache size.
 * Called on every cache write — cheap when cache is small.
 */
function _routeCacheEvict(): void {
  const now = Date.now();
  for (const [key, entry] of _asyncRouteCache) {
    if (now - entry.ts > ASYNC_ROUTE_CACHE_TTL) {
      _asyncRouteCache.delete(key);
    }
  }
  // If still over max, drop oldest entries
  if (_asyncRouteCache.size > ASYNC_ROUTE_CACHE_MAX) {
    const sorted = [..._asyncRouteCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toRemove = sorted.slice(0, sorted.length - ASYNC_ROUTE_CACHE_MAX);
    for (const [key] of toRemove) {
      _asyncRouteCache.delete(key);
    }
  }
}

/** Clear the async route cache (useful after dynamic token refresh). */
export function clearAsyncRouteCache(): void {
  _asyncRouteCache.clear();
  console.log("[C56] Async route cache cleared");
}

/**
 * [C56] Async route finding with on-chain pool detection fallback.
 *
 * When `findSwapRoute()` (static pool list) returns null, this function
 * does REAL on-chain pool detection via `detectPoolVersion()` and
 * `findBestMultiHopRoute()`. This is the same logic the execution engine
 * uses, ensuring the UI never blocks a swap that the engine can execute.
 *
 * Results (including negative "no route" results) are cached for 2 minutes
 * to avoid redundant JSON-RPC calls when the user toggles token pairs.
 *
 * Returns a simplified route descriptor for the UI, NOT the full execution
 * parameters (those are computed inside executeSaucerSwapDirect).
 */
export async function findSwapRouteAsync(
  inputSymbol: string,
  outputSymbol: string,
  network: HederaNetwork = "mainnet",
): Promise<{ path: AllowedToken[]; pools: PoolRoute[]; totalFee: number; onChain: boolean } | null> {
  // Try sync route first (instant, no network calls)
  const syncRoute = findSwapRoute(inputSymbol, outputSymbol);
  if (syncRoute) return { ...syncRoute, onChain: false };

  const input = resolveToken(inputSymbol);
  const output = resolveToken(outputSymbol);
  if (!input || !output || input.symbol === output.symbol) return null;

  // Skip wrap/unwrap pairs
  if (
    (input.isNative && output.symbol === "WHBAR") ||
    (input.symbol === "WHBAR" && output.isNative)
  ) return null;

  // ── Check route cache before expensive on-chain calls ──
  const cacheKey = _routeCacheKey(inputSymbol, outputSymbol, network);
  const cached = _asyncRouteCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ASYNC_ROUTE_CACHE_TTL) {
    console.log(`[C56] Route cache hit for ${inputSymbol} → ${outputSymbol} (${cached.result ? "route" : "no-route"})`);
    return cached.result;
  }

  const whbar = TOKEN_BY_SYMBOL.get("WHBAR");
  if (!whbar) return null;

  // Use routing-aware EVM addresses
  const directInEvm = getSaucerswapRoutingEvmAddress(input.isNative ? whbar : input);
  const directOutEvm = getSaucerswapRoutingEvmAddress(output.isNative ? whbar : output);

  console.log(`[C56] Async route search: ${inputSymbol} → ${outputSymbol}`);

  // Step 1: Check for direct on-chain pool
  const directPool = await detectPoolVersion(directInEvm, directOutEvm, network);
  if (directPool) {
    console.log(`[C56] Direct on-chain pool found: ${directPool.version} (fee=${directPool.feeTier || "N/A"})`);
    const syntheticPool: PoolRoute = {
      id: `onchain-${input.symbol}-${output.symbol}`,
      tokenA: input,
      tokenB: output,
      fee: directPool.feeTier ? directPool.feeTier / 10000 : 0.3,
      tvlUsd: 0,
      volume24hUsd: 0,
      apr: 0,
      poolAddress: directPool.poolAddress || "on-chain-detected",
      source: directPool.version,
    };
    const result: AsyncRouteResult = {
      path: [input, output],
      pools: [syntheticPool],
      totalFee: syntheticPool.fee,
      onChain: true,
    };
    // Cache the positive result
    _routeCacheEvict();
    _asyncRouteCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  }

  // Step 2: Multi-hop through intermediaries
  const intermediaries = getIntermediaryTokens(input, output);
  const multiHop = await findBestMultiHopRoute(directInEvm, directOutEvm, intermediaries, network);
  if (multiHop) {
    // Resolve intermediary tokens for display
    const midEvm = multiHop.tokens[1]; // The intermediary
    const midHtsId = evmAddressToHtsId(midEvm);
    const midToken = TOKEN_BY_SYMBOL.get("HBAR")?.htsId === "native" && midEvm.toLowerCase() === getSaucerswapRoutingEvmAddress(whbar).toLowerCase()
      ? TOKEN_BY_SYMBOL.get("HBAR")!
      : (TOKEN_BY_HTS_ID.get(midHtsId) || { symbol: midHtsId, name: midHtsId, htsId: midHtsId, evmAddress: midEvm, decimals: 8, logo: "", rank: 999, isWrapped: false } as AllowedToken);

    console.log(`[C56] Multi-hop on-chain route found: ${input.symbol} → ${midToken.symbol} → ${output.symbol}`);

    const pool1: PoolRoute = {
      id: `onchain-hop1-${input.symbol}-${midToken.symbol}`,
      tokenA: input,
      tokenB: midToken,
      fee: multiHop.hops[0].feeTier ? multiHop.hops[0].feeTier / 10000 : 0.3,
      tvlUsd: 0, volume24hUsd: 0, apr: 0,
      poolAddress: multiHop.hops[0].poolAddress || "on-chain-detected",
      source: multiHop.hops[0].version,
    };
    const pool2: PoolRoute = {
      id: `onchain-hop2-${midToken.symbol}-${output.symbol}`,
      tokenA: midToken,
      tokenB: output,
      fee: multiHop.hops[1].feeTier ? multiHop.hops[1].feeTier / 10000 : 0.3,
      tvlUsd: 0, volume24hUsd: 0, apr: 0,
      poolAddress: multiHop.hops[1].poolAddress || "on-chain-detected",
      source: multiHop.hops[1].version,
    };

    const result: AsyncRouteResult = {
      path: [input, midToken, output],
      pools: [pool1, pool2],
      totalFee: pool1.fee + pool2.fee,
      onChain: true,
    };
    // Cache the positive result
    _routeCacheEvict();
    _asyncRouteCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  }

  // Cache negative result (no route) to avoid re-checking
  console.log(`[C56] No route found for ${inputSymbol} → ${outputSymbol} (sync + on-chain)`);
  _routeCacheEvict();
  _asyncRouteCache.set(cacheKey, { result: null, ts: Date.now() });
  return null;
}
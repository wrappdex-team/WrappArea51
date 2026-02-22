/**
 * [C48] SaucerSwap Pool Detection & Caching
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: Pool version detection (server-proxied with browser fallback),
 * V2/V1 pool API caching, known-pool lookup, V2 Factory discovery,
 * and shared infrastructure (ssProxy, resolveContractEvmAddress).
 *
 * Pool detection strategy (SEC-17):
 *   0. KNOWN_V2_POOLS hardcoded table (no network call)
 *   1. Server proxy /detect-pool (5 concurrent strategies, cached)
 *   2. SaucerSwap REST API V2 + V1 pool lookup
 *   3. V2 Factory.getPool() via JSON-RPC + Mirror Node
 *   4. V1 Factory.getPair() via JSON-RPC + Mirror Node
 *   5. Return null -- caller MUST abort the swap
 */

import { log } from "../logger";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import type { HederaNetwork } from "./tokens";
import { TOKEN_BY_HTS_ID, htsIdToEvmAddress, evmAddressToHtsId } from "./tokens";
import {
  MIRROR_NODES,
  JSON_RPC_RELAY,
  V2_FEE_TIERS,
  SAUCERSWAP_V2_ROUTER,
  getSaucerSwapFactory,
} from "./contracts";
import { bytesToHex, encodeGetPool, encodeGetPair } from "./abi";
import { saucerFetch, makeAbort } from "./prices";

// ═══════════════════════════════════════════════════��════════════════════
// ── SHARED INFRASTRUCTURE ─────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

// ── Server Proxy ────────────────────────────────────────────────────

const SS_PROXY_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/saucerswap`;

/**
 * [C47] Generic server proxy for SaucerSwap Engine endpoints.
 * All GET requests with query params.
 * Returns parsed JSON on success, null on failure.
 */
export async function ssProxy<T = any>(
  path: string,
  params: Record<string, string>,
  timeoutMs: number = 12000,
): Promise<T | null> {
  try {
    const qs = new URLSearchParams(params).toString();
    const url = `${SS_PROXY_BASE}${path}?${qs}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${publicAnonKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.info("SS-Proxy", `${path} -> HTTP ${res.status} ${body.slice(0, 200)}`);
      return null;
    }
    return await res.json() as T;
  } catch (err: any) {
    log.info("SS-Proxy", `${path} -> ${err?.message || err}`);
    return null;
  }
}

// ── EVM Address Resolution ──────────────────────────────────────────

const NEGATIVE_CACHE_TTL_MS = 120_000; // retry after 2 minutes

// Account EVM address cache
let _evmAddressCache: Record<string, string> = {};
let _evmAddressNegCache: Record<string, number> = {};

/**
 * Resolve a Hedera account ID (0.0.xxxxx) to its actual EVM address.
 * Falls back to synthetic long-zero address if lookup fails.
 *
 * Uses server proxy with direct Mirror Node fallback.
 */
export async function resolveAccountEvmAddress(
  accountId: string,
  network: HederaNetwork
): Promise<string> {
  const cacheKey = `${network}:${accountId}`;
  if (_evmAddressCache[cacheKey]) return _evmAddressCache[cacheKey];

  // Check negative cache -- don't retry too frequently
  const negTs = _evmAddressNegCache[cacheKey];
  if (negTs && Date.now() - negTs < NEGATIVE_CACHE_TTL_MS) {
    return htsIdToEvmAddress(accountId);
  }

  // [C47] Server proxy -- cached server-side, circuit-breaker protected
  const data = await ssProxy<{ evmAddress: string; isActual: boolean }>("/resolve-evm", {
    id: accountId, type: "account", network,
  });
  if (data?.evmAddress && data.evmAddress.startsWith("0x") && data.evmAddress.length === 42) {
    console.log(`[HBAR.h] [C47] Resolved ${accountId} -> EVM: ${data.evmAddress} (via proxy, actual=${data.isActual})`);
    _evmAddressCache[cacheKey] = data.evmAddress;
    delete _evmAddressNegCache[cacheKey];
    return data.evmAddress;
  }

  // Fallback: direct Mirror Node (browser may hit CORS/rate limits)
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/accounts/${accountId}`,
      { signal: makeAbort(8000) }
    );
    if (res.ok) {
      const resp = await res.json();
      const evmAddr = resp.evm_address;
      if (evmAddr && evmAddr.startsWith("0x") && evmAddr.length === 42) {
        console.log(`[HBAR.h] Resolved ${accountId} -> EVM: ${evmAddr}`);
        _evmAddressCache[cacheKey] = evmAddr;
        delete _evmAddressNegCache[cacheKey];
        return evmAddr;
      }
    }
  } catch (e) {
    console.warn("[HBAR.h] Mirror Node EVM lookup failed:", e);
  }

  // Fallback: synthetic long-zero address
  const fallback = htsIdToEvmAddress(accountId);
  console.log(`[HBAR.h] Using long-zero fallback for ${accountId}: ${fallback}`);
  _evmAddressNegCache[cacheKey] = Date.now();
  return fallback;
}

// Contract EVM address cache
let _contractEvmAddressCache: Record<string, string> = {};
let _contractEvmNegCache: Record<string, number> = {};

/**
 * Resolve a Hedera contract ID (0.0.xxxxx) to its actual EVM address
 * via the Mirror Node contracts endpoint. Falls back to the long-zero
 * synthetic address if the lookup fails.
 *
 * Contracts have their own EVM address that differs from the long-zero
 * form. Using the correct address is critical for Mirror Node contract
 * call simulations (`/api/v1/contracts/call`), because the simulation
 * engine may not resolve the long-zero form to the actual bytecode.
 */
export async function resolveContractEvmAddress(
  contractId: string,
  network: HederaNetwork
): Promise<string> {
  const cacheKey = `contract:${network}:${contractId}`;
  if (_contractEvmAddressCache[cacheKey]) return _contractEvmAddressCache[cacheKey];

  // Check negative cache -- don't retry too frequently
  const negTs = _contractEvmNegCache[cacheKey];
  if (negTs && Date.now() - negTs < NEGATIVE_CACHE_TTL_MS) {
    return htsIdToEvmAddress(contractId);
  }

  // [C47] Server proxy -- cached server-side, uses contracts+accounts dual-strategy
  const data = await ssProxy<{ evmAddress: string; isActual: boolean }>("/resolve-evm", {
    id: contractId, type: "contract", network,
  });
  if (data?.evmAddress && data.evmAddress.startsWith("0x") && data.evmAddress.length === 42) {
    console.log(`[HBAR.h] [C47] Resolved contract ${contractId} -> EVM: ${data.evmAddress} (via proxy, actual=${data.isActual})`);
    _contractEvmAddressCache[cacheKey] = data.evmAddress;
    delete _contractEvmNegCache[cacheKey];
    return data.evmAddress;
  }

  // Fallback: direct Mirror Node contracts endpoint
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/contracts/${contractId}`,
      { signal: makeAbort(8000) }
    );
    if (res.ok) {
      const resp = await res.json();
      const evmAddr = resp.evm_address;
      if (evmAddr && evmAddr.startsWith("0x") && evmAddr.length === 42) {
        console.log(`[HBAR.h] Resolved contract ${contractId} -> EVM: ${evmAddr}`);
        _contractEvmAddressCache[cacheKey] = evmAddr;
        delete _contractEvmNegCache[cacheKey];
        return evmAddr;
      }
    }
  } catch (e) {
    console.warn("[HBAR.h] Mirror Node contract EVM lookup failed:", e);
  }

  // Fallback: accounts endpoint
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(
      `${base}/api/v1/accounts/${contractId}`,
      { signal: makeAbort(6000) }
    );
    if (res.ok) {
      const resp = await res.json();
      const evmAddr = resp.evm_address;
      if (evmAddr && evmAddr.startsWith("0x") && evmAddr.length === 42) {
        console.log(`[HBAR.h] Resolved contract ${contractId} via accounts -> EVM: ${evmAddr}`);
        _contractEvmAddressCache[cacheKey] = evmAddr;
        delete _contractEvmNegCache[cacheKey];
        return evmAddr;
      }
    }
  } catch {
    // Non-fatal
  }

  // Fallback: synthetic long-zero address
  const fallback = htsIdToEvmAddress(contractId);
  console.log(`[HBAR.h] Using long-zero fallback for contract ${contractId}: ${fallback}`);
  _contractEvmNegCache[cacheKey] = Date.now();
  return fallback;
}

// ════════════════════════════════════════════════════════════════════════
// ── TYPES ─────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

export type PoolVersion = "v1" | "v2";

export interface PoolVersionInfo {
  version: PoolVersion;
  feeTier?: number;     // V2 fee tier (100=0.01%, 500=0.05%, 3000=0.3%, 10000=1%)
  poolAddress?: string; // V1 pair or V2 pool address
}

interface SaucerSwapV2PoolEntry {
  id?: string;
  contractId?: string;
  tokenA?: { id?: string; serialNumber?: number; decimals?: number };
  tokenB?: { id?: string; serialNumber?: number; decimals?: number };
  fee?: number;
  feeTier?: number;
  sqrtPrice?: string;
  liquidity?: string;
  tick?: number;
  tickSpacing?: number;
}

// ════════════════════════════════════════════════════════════════════════
// ── POOL CACHES ───────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

// Pool version detection cache (positive = permanent, negative = TTL)
const _poolVersionCache: Record<string, PoolVersionInfo | null> = {};
const _poolVersionNegCacheTs: Record<string, number> = {};
const POOL_NEG_CACHE_TTL_MS = 30_000; // Retry "no pool found" after 30s

// SaucerSwap V2 pool list cache
let _ssV2PoolsCache: SaucerSwapV2PoolEntry[] | null = null;
let _ssV2PoolsFetchInFlight: Promise<SaucerSwapV2PoolEntry[] | null> | null = null;
let _ssV2PoolsFetchTs = 0;

// [C36-04] V1 pool list cache (same pattern as V2)
let _ssV1PoolsCache: any[] | null = null;
let _ssV1PoolsFetchInFlight: Promise<any[] | null> | null = null;
let _ssV1PoolsFetchTs = 0;

const SS_POOLS_CACHE_TTL_MS = 5 * 60_000; // Refresh every 5 min

// Diagnostic logging de-duplication (avoid console spam)
const _poolDiagLogged = new Set<string>();

// ════════════════════════════════════════════════════════════════════════
// ── V2 FACTORY DISCOVERY ──────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

// V2 Factory address cache (discovered by calling factory() on V2 Router).
// The long-zero form of 0.0.3946833 is used as a FALLBACK if discovery fails,
// but we attempt real discovery first to get the CREATE-derived EVM address
// which is more reliable for JSON-RPC eth_call on some relay implementations.
let _v2FactoryCache: Record<string, string | null> = {};
const V2_FACTORY_FALLBACK: Record<string, string> = {
  mainnet: htsIdToEvmAddress("0.0.3946833"), // V2 Factory long-zero (SEC-16 verified)
  testnet: htsIdToEvmAddress("0.0.1197038"), // V2 Factory testnet
};

/**
 * Discover the V2 Factory address by calling factory() on the V2 Router.
 * Tries JSON-RPC relay first, then Mirror Node fallback, then long-zero fallback.
 */
export async function discoverV2Factory(network: HederaNetwork): Promise<string | null> {
  if (_v2FactoryCache[network] !== undefined) return _v2FactoryCache[network];

  const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;

  // -- Strategy A: JSON-RPC relay eth_call --
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

  // -- Strategy B: Mirror Node /api/v1/contracts/call --
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

  // Strategy C: Use the known long-zero fallback address (SEC-16 verified)
  const fallback = V2_FACTORY_FALLBACK[network] || null;
  if (fallback) {
    console.log(`[HBAR.h] V2 Factory: using long-zero fallback ${fallback} (RPC + Mirror discovery both failed)`);
    _v2FactoryCache[network] = fallback;
    return fallback;
  }

  _v2FactoryCache[network] = null;
  return null;
}

// ═════════════════��══════════════════════════════════════════════════════
// ── V2 POOL LIST FETCHER ──────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

// [C82] Exported so the pool graph builder in routing.ts can use the cached list.
export async function fetchSaucerSwapV2PoolList(): Promise<SaucerSwapV2PoolEntry[] | null> {
  // Return cached if fresh
  if (_ssV2PoolsCache && Date.now() - _ssV2PoolsFetchTs < SS_POOLS_CACHE_TTL_MS) {
    return _ssV2PoolsCache;
  }
  // Deduplicate concurrent fetches
  if (_ssV2PoolsFetchInFlight) return _ssV2PoolsFetchInFlight;

  _ssV2PoolsFetchInFlight = (async () => {
    // Try multiple possible endpoint paths for V2 pool data
    // [C16-03] Try /v2/pools/full FIRST -- it includes token pair details
    // (tokenA.id, tokenB.id) needed for pool matching. The basic /v2/pools
    // may omit token sub-objects on some SaucerSwap API versions.
    const endpoints = ["/v2/pools/full", "/v2/pools", "/pools"];
    for (const ep of endpoints) {
      try {
        const res = await saucerFetch(ep, 12000);
        if (res) {
          const data = await res.json();
          const rawPools = Array.isArray(data) ? data : (data?.pools || data?.data || []);
          // Filter to only pools that have token pair info (skip LP-only entries)
          const pools: SaucerSwapV2PoolEntry[] = rawPools.filter((p: any) =>
            (p.tokenA?.id || p.token0?.id || p.token0Id) &&
            (p.tokenB?.id || p.token1?.id || p.token1Id)
          );
          if (pools.length > 0) {
            _ssV2PoolsCache = pools;
            _ssV2PoolsFetchTs = Date.now();
            console.log(`[HBAR.h] SaucerSwap V2 pool list fetched via ${ep}: ${pools.length} pools (raw: ${rawPools.length})`);
            return pools;
          }
          console.log(`[HBAR.h] SaucerSwap ${ep}: ${rawPools.length} entries but none with token pair info`);
        }
      } catch (e: any) {
        console.log(`[HBAR.h] SaucerSwap ${ep} failed:`, e?.message || e);
      }
    }
    _ssV2PoolsFetchInFlight = null;
    return _ssV2PoolsCache; // Return stale cache if available
  })();

  const result = await _ssV2PoolsFetchInFlight;
  _ssV2PoolsFetchInFlight = null;
  return result;
}

// ════════════════════════════════════════════════════════════════════════
// ── V2 POOL API LOOKUP ────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * Look up a V2 pool from the SaucerSwap REST API cache.
 * Matches by HTS token IDs (more reliable than EVM addresses).
 * Handles multiple possible response field names from the API.
 */
export async function lookupV2PoolFromAPI(
  tokenA_evm: string,
  tokenB_evm: string,
  network: HederaNetwork
): Promise<PoolVersionInfo | null> {
  if (network !== "mainnet") return null; // API only for mainnet

  const pools = await fetchSaucerSwapV2PoolList();
  if (!pools || pools.length === 0) return null;

  // Convert EVM addresses to HTS IDs for matching
  const htsIdA = evmAddressToHtsId(tokenA_evm);
  const htsIdB = evmAddressToHtsId(tokenB_evm);

  // [C36-04] Also resolve token symbols for fuzzy matching fallback
  const tokenObjA = TOKEN_BY_HTS_ID.get(htsIdA);
  const tokenObjB = TOKEN_BY_HTS_ID.get(htsIdB);
  const symbolA = tokenObjA?.symbol?.toUpperCase() || "";
  const symbolB = tokenObjB?.symbol?.toUpperCase() || "";

  // Log what we're looking for
  console.log(`[HBAR.h] API pool lookup: searching for ${htsIdA} (${symbolA}) / ${htsIdB} (${symbolB}) in ${pools.length} V2 pools`);

  // [C36-04] Helper: extract pool token info from various API response formats
  const extractPoolTokenInfo = (pool: any) => {
    const tA = pool.tokenA || (pool as any).token0 || {};
    const tB = pool.tokenB || (pool as any).token1 || {};
    return {
      idA: tA.id || (pool as any).token0Id || "",
      idB: tB.id || (pool as any).token1Id || "",
      symA: (tA.symbol || "").toUpperCase(),
      symB: (tB.symbol || "").toUpperCase(),
    };
  };

  for (const pool of pools) {
    const { idA: poolTokenA, idB: poolTokenB, symA: poolSymA, symB: poolSymB } = extractPoolTokenInfo(pool);
    if (!poolTokenA || !poolTokenB) continue;

    // Primary match: by HTS token ID (exact)
    const matchedById =
      (poolTokenA === htsIdA && poolTokenB === htsIdB) ||
      (poolTokenA === htsIdB && poolTokenB === htsIdA);

    // [C36-04] Fallback match: by token symbol (handles ID mismatches for bridge tokens)
    // Only used when at least one side matches by ID and the other matches by symbol.
    // This prevents false positives from unrelated pools with similar symbols.
    const matchedBySymbol = !matchedById && symbolA && symbolB && (
      (poolTokenA === htsIdA && poolSymB === symbolB) ||
      (poolTokenA === htsIdB && poolSymB === symbolA) ||
      (poolTokenB === htsIdA && poolSymA === symbolB) ||
      (poolTokenB === htsIdB && poolSymA === symbolA) ||
      (poolSymA === symbolA && poolSymB === symbolB) ||
      (poolSymA === symbolB && poolSymB === symbolA)
    );

    if (matchedById || matchedBySymbol) {
      const fee = pool.fee ?? pool.feeTier ?? (pool as any).feeRate ?? 3000;
      const poolAddr = pool.contractId
        ? htsIdToEvmAddress(pool.contractId).toLowerCase()
        : (pool.id && pool.id.startsWith("0x") ? pool.id : undefined);

      // [C36-04] When matched by symbol (not ID), log the ID mismatch for investigation
      if (matchedBySymbol && !matchedById) {
        console.warn(`[HBAR.h] [C36-04] V2 POOL FOUND BY SYMBOL FALLBACK:`);
        console.warn(`  Searched: ${htsIdA} (${symbolA}) / ${htsIdB} (${symbolB})`);
        console.warn(`  Found:    ${poolTokenA} (${poolSymA}) / ${poolTokenB} (${poolSymB})`);
        console.warn(`  Fee=${fee}, pool=${poolAddr || "unknown"}`);
        console.warn(`  Token ID mismatch -- pool uses different IDs than our registry.`);
        console.warn(`  The swap may use the registry EVM addresses for routing. If it fails,`);
        console.warn(`  update the token's htsId in SAUCERSWAP_TOKENS to match the pool.`);
      }

      console.log(`[HBAR.h] === V2 POOL FOUND VIA API: ${poolTokenA}/${poolTokenB} fee=${fee} pool=${poolAddr || "unknown"} (match: ${matchedById ? "ID" : "symbol"}) ===`);
      if (!_ssV2PoolsCache || _ssV2PoolsFetchTs === 0) {
        console.log(`[HBAR.h] API pool sample:`, JSON.stringify(pool).slice(0, 300));
      }
      return { version: "v2", feeTier: fee, poolAddress: poolAddr };
    }
  }

  // Log first pool's structure for debugging (only once)
  if (pools.length > 0 && !_poolDiagLogged.has("v2-pool-debug")) {
    _poolDiagLogged.add("v2-pool-debug");
    console.log(`[HBAR.h] V2 API pool sample (no match for ${htsIdA}/${htsIdB}):`, JSON.stringify(pools[0]).slice(0, 400));
    // [C36-04] Log a few more pools for debugging token ID patterns
    if (pools.length > 1) console.log(`[HBAR.h] V2 API pool[1]:`, JSON.stringify(pools[1]).slice(0, 300));
    if (pools.length > 2) console.log(`[HBAR.h] V2 API pool[2]:`, JSON.stringify(pools[2]).slice(0, 300));
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// ── KNOWN V2 POOLS ────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

// Hardcoded DexScreener-verified V2 pool addresses for critical pairs.
// This bypasses V2 Factory discovery (which can fail due to RPC issues)
// and ensures routing works even when on-chain probing is unavailable.
//
// To add a new known pool:
//   1. Find the pair on DexScreener (https://dexscreener.com/hedera/)
//   2. Note the pair address and fee tier
//   3. Add an entry below with both token EVM addresses (sorted lowercase)
// [C36-04] WHBAR/HBAR.h was listed here as V2 but it's actually a V1 AMM pool.
// HBAR->HBAR.h swaps reverted: V2 exactInputSingle hit a non-existent V2 pool.
// Reverse (HBAR.h->HBAR) worked because C37 forces Token->HBAR to V1.
// Removed so detectPoolVersion falls through to V1 API/Factory detection.
const KNOWN_V2_POOLS: {
  tokenA: string; tokenB: string; fee: number; poolAddress: string;
}[] = [
  // Add verified V2 concentrated-liquidity pools here as needed.
];

/**
 * Look up a known V2 pool by token pair. Returns the pool info if found,
 * or null if the pair isn't in the known-pools table.
 */
export function lookupKnownV2Pool(
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

// ════════════════════════════════════════════════════════════════════════
// ── MAIN POOL DETECTION ───────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * Detect whether a token pair has a pool on SaucerSwap V2 or V1.
 *
 * Strategy (SEC-17):
 * 0. Check KNOWN_V2_POOLS hardcoded table (no network call)
 * 1. SaucerSwap REST API pool lookup (most reliable from browser, proper CORS)
 * 2. V2 Factory.getPool() via JSON-RPC relay + Mirror Node fallback
 * 3. V1 Factory.getPair() via JSON-RPC relay + Mirror Node fallback
 * 4. If none found, return null -- caller MUST abort the swap
 *
 * V2 is checked first because SaucerSwap V2 (concentrated liquidity) has
 * the deepest liquidity for most active pairs. Positive results are cached
 * permanently; negative results expire after 30s to allow retry.
 */
export async function detectPoolVersion(
  tokenA_evm: string,
  tokenB_evm: string,
  network: HederaNetwork
): Promise<PoolVersionInfo | null> {
  const sortedKey = [tokenA_evm.toLowerCase(), tokenB_evm.toLowerCase()].sort().join(":");
  const cacheKey = `${network}:${sortedKey}`;
  if (_poolVersionCache[cacheKey] !== undefined) {
    // For positive results (pool found), use permanently cached value.
    // For negative results (null), check TTL -- allow retry after 30s.
    if (_poolVersionCache[cacheKey] !== null) {
      console.log(`[HBAR.h] Pool version cache hit: ${_poolVersionCache[cacheKey]?.version} (fee: ${_poolVersionCache[cacheKey]?.feeTier || "N/A"})`);
      return _poolVersionCache[cacheKey];
    }
    const negTs = _poolVersionNegCacheTs[cacheKey];
    if (negTs && Date.now() - negTs < POOL_NEG_CACHE_TTL_MS) {
      console.log("[HBAR.h] Pool version negative cache hit -- no pool found (will retry after TTL)");
      return null;
    }
    // TTL expired -- retry detection
    delete _poolVersionCache[cacheKey];
    delete _poolVersionNegCacheTs[cacheKey];
  }

  // -- Check known V2 pools FIRST (hardcoded, always works) --
  const knownPool = lookupKnownV2Pool(tokenA_evm, tokenB_evm);
  if (knownPool) {
    console.log(`[HBAR.h] === KNOWN V2 POOL HIT: fee=${knownPool.feeTier}, pool=${knownPool.poolAddress} ===`);
    _poolVersionCache[cacheKey] = knownPool;
    return knownPool;
  }

  // -- [C47] Server proxy -- parallel 4-strategy detection, cached, no CORS --
  try {
    const proxyResult = await ssProxy<{
      version: "v1" | "v2";
      feeTier?: number;
      poolAddress?: string;
      source?: string;
    }>("/detect-pool", {
      tokenA: tokenA_evm,
      tokenB: tokenB_evm,
      network,
    });
    if (proxyResult?.version) {
      const info: PoolVersionInfo = {
        version: proxyResult.version,
        feeTier: proxyResult.feeTier,
        poolAddress: proxyResult.poolAddress,
      };
      console.log(
        `[HBAR.h] [C47] Pool detected via proxy: ${info.version}` +
        ` fee=${info.feeTier || "N/A"}` +
        ` pool=${info.poolAddress || "unknown"}` +
        ` (source: ${proxyResult.source})`
      );
      _poolVersionCache[cacheKey] = info;
      return info;
    }
    // Proxy returned null/404 -- fall through to browser strategies
    console.log("[HBAR.h] [C47] Proxy pool detection returned no result -- falling through to browser strategies");
  } catch (proxyErr: any) {
    console.log("[HBAR.h] [C47] Proxy pool detection error -- falling through:", proxyErr?.message || proxyErr);
  }

  // ┌─────────────────────────────────────────────────────────────────────┐
  // |  SEC-17 -- MULTI-STRATEGY POOL VERIFICATION                         |
  // |                                                                    |
  // |  Pool detection uses multiple strategies to avoid false negatives  |
  // |  from browser CORS / rate-limiting / RPC issues:                   |
  // |                                                                    |
  // |  1. SaucerSwap REST API (most reliable -- proper CORS, no ABI)    |
  // |  2. V2 Factory.getPool() via JSON-RPC relay                       |
  // |  3. V2 Factory.getPool() via Mirror Node contracts/call           |
  // |  4. V1 Factory.getPair() via JSON-RPC relay                       |
  // |  5. V1 Factory.getPair() via Mirror Node contracts/call           |
  // |                                                                    |
  // |  If ALL strategies fail, return null -- the caller MUST abort.    |
  // └─────────────────────────────────────────────────────────────────────┘

  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
  const mirrorBase = MIRROR_NODES[network] || MIRROR_NODES.mainnet;

  // Diagnostic logging for the token pair being probed
  console.log(`[HBAR.h] Pool detection: ${evmAddressToHtsId(tokenA_evm)} (${tokenA_evm.slice(0, 10)}...) / ${evmAddressToHtsId(tokenB_evm)} (${tokenB_evm.slice(0, 10)}...)`);

  // -- Strategy 1: SaucerSwap REST API pool lookup --
  try {
    const apiResult = await lookupV2PoolFromAPI(tokenA_evm, tokenB_evm, network);
    if (apiResult) {
      _poolVersionCache[cacheKey] = apiResult;
      return apiResult;
    }
    console.log("[HBAR.h] SaucerSwap API: no V2 pool match -- trying V1 API then on-chain");
  } catch (e: any) {
    console.log("[HBAR.h] SaucerSwap V2 API pool lookup error:", e?.message || e);
  }

  // -- Strategy 1b: SaucerSwap V1 pools API --
  // Some older pairs only exist on V1. Check the V1 pools endpoint by HTS ID.
  // [C36-04] Enhanced with symbol-based fallback matching + response caching.
  try {
    const htsIdA = evmAddressToHtsId(tokenA_evm);
    const htsIdB = evmAddressToHtsId(tokenB_evm);
    const tokenObjA = TOKEN_BY_HTS_ID.get(htsIdA);
    const tokenObjB = TOKEN_BY_HTS_ID.get(htsIdB);
    const symbolA = tokenObjA?.symbol?.toUpperCase() || "";
    const symbolB = tokenObjB?.symbol?.toUpperCase() || "";

    // [C36-04] Use cached V1 pool list (same 5-min TTL as V2)
    if (!_ssV1PoolsCache || Date.now() - _ssV1PoolsFetchTs > SS_POOLS_CACHE_TTL_MS) {
      if (!_ssV1PoolsFetchInFlight) {
        _ssV1PoolsFetchInFlight = (async () => {
          try {
            const v1Res = await saucerFetch("/v1/pools", 10000);
            if (v1Res) {
              const v1Data = await v1Res.json();
              const raw = Array.isArray(v1Data) ? v1Data : Object.values(v1Data);
              _ssV1PoolsCache = raw;
              _ssV1PoolsFetchTs = Date.now();
              console.log(`[HBAR.h] SaucerSwap V1 pool list fetched: ${raw.length} pools`);
              return raw;
            }
          } catch (e: any) {
            console.log(`[HBAR.h] V1 pool list fetch failed:`, e?.message || e);
          }
          _ssV1PoolsFetchInFlight = null;
          return _ssV1PoolsCache;
        })();
      }
      await _ssV1PoolsFetchInFlight;
      _ssV1PoolsFetchInFlight = null;
    }

    const v1Pools = _ssV1PoolsCache || [];
    // [C36-04] Log first V1 pool structure on first run for debugging format issues
    if (v1Pools.length > 0 && !_poolDiagLogged.has("v1-pool-debug")) {
      _poolDiagLogged.add("v1-pool-debug");
      console.log(`[HBAR.h] V1 API pool sample:`, JSON.stringify(v1Pools[0]).slice(0, 400));
    }
    for (const pool of v1Pools) {
      // [C36-04] Robust token extraction: handle tokenA/tokenB as objects OR strings
      const rawA = (pool as any).tokenA;
      const rawB = (pool as any).tokenB;
      const pA = typeof rawA === "string" ? rawA
        : (rawA?.id || rawA?.tokenId || (pool as any).token0?.id || (pool as any).token0Id || "");
      const pB = typeof rawB === "string" ? rawB
        : (rawB?.id || rawB?.tokenId || (pool as any).token1?.id || (pool as any).token1Id || "");
      const sA = (typeof rawA === "object" ? (rawA?.symbol || "") : "").toUpperCase();
      const sB = (typeof rawB === "object" ? (rawB?.symbol || "") : "").toUpperCase();

      // Primary: match by HTS ID
      const idMatch = (pA === htsIdA && pB === htsIdB) || (pA === htsIdB && pB === htsIdA);
      // Fallback: match by symbol (handles ID differences for bridge tokens)
      const symMatch = !idMatch && symbolA && symbolB && (
        (sA === symbolA && sB === symbolB) || (sA === symbolB && sB === symbolA)
      );

      if (idMatch || symMatch) {
        const pairAddr = (pool as any).contractId
          ? htsIdToEvmAddress((pool as any).contractId).toLowerCase()
          : ((pool as any).id?.startsWith?.("0x") ? (pool as any).id : undefined);
        if (symMatch && !idMatch) {
          console.warn(`[HBAR.h] [C36-04] V1 POOL FOUND BY SYMBOL FALLBACK: ${pA}(${sA})/${pB}(${sB}) vs ${htsIdA}(${symbolA})/${htsIdB}(${symbolB})`);
        }
        console.log(`[HBAR.h] === V1 POOL FOUND VIA API: ${pA}/${pB} pair=${pairAddr || "unknown"} (match: ${idMatch ? "ID" : "symbol"}) ===`);
        const info: PoolVersionInfo = { version: "v1", poolAddress: pairAddr };
        _poolVersionCache[cacheKey] = info;
        return info;
      }
    }
    if (v1Pools.length > 0) {
      console.log(`[HBAR.h] SaucerSwap V1 API: no match in ${v1Pools.length} pools for ${htsIdA}(${symbolA}) / ${htsIdB}(${symbolB})`);
    }
  } catch (e: any) {
    console.log("[HBAR.h] SaucerSwap V1 API pool lookup error:", e?.message || e);
  }

  // -- Strategy 2: V2 Factory.getPool() via JSON-RPC + Mirror Node fallback --
  const v2FactoryEvm = await discoverV2Factory(network);
  if (v2FactoryEvm) {
    for (const fee of V2_FEE_TIERS) {
      const poolCallData = bytesToHex(encodeGetPool(tokenA_evm, tokenB_evm, fee));

      // 2a: JSON-RPC relay eth_call
      try {
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
          if (poolData.error) {
            console.log(`[HBAR.h] V2 getPool(fee=${fee}) RPC error: ${JSON.stringify(poolData.error).slice(0, 120)}`);
          } else if (poolData.result && poolData.result.length >= 66) {
            const poolAddr = "0x" + poolData.result.slice(-40).toLowerCase();
            if (poolAddr !== "0x0000000000000000000000000000000000000000") {
              console.log(`[HBAR.h] === V2 POOL DETECTED (RPC): fee=${fee} (${fee / 10000}%), pool=${poolAddr} ===`);
              const info: PoolVersionInfo = { version: "v2", feeTier: fee, poolAddress: poolAddr };
              _poolVersionCache[cacheKey] = info;
              return info;
            }
          } else {
            console.log(`[HBAR.h] V2 getPool(fee=${fee}) RPC: empty/short result (${poolData.result?.length || 0} chars)`);
          }
          // If we got a valid zero response, skip Mirror Node for this fee tier
          if (poolData.result && poolData.result.length >= 66 && !poolData.error) continue;
        } else {
          console.log(`[HBAR.h] V2 getPool(fee=${fee}) RPC HTTP ${poolRes.status}`);
        }
      } catch (err: any) {
        console.log(`[HBAR.h] V2 getPool(fee=${fee}) RPC failed: ${err?.message || err}`);
      }

      // 2b: Mirror Node contracts/call fallback (often works when RPC relay doesn't)
      try {
        const mnRes = await fetch(`${mirrorBase}/api/v1/contracts/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: makeAbort(10000),
          body: JSON.stringify({
            block: "latest",
            data: poolCallData,
            estimate: false,
            from: "0x0000000000000000000000000000000000000000",
            to: v2FactoryEvm,
            gas: 300_000,
            gasPrice: 0,
            value: 0,
          }),
        });

        if (mnRes.ok) {
          const mnData = await mnRes.json();
          if (mnData.result && mnData.result.length >= 66 && mnData.result !== "0x") {
            const poolAddr = "0x" + mnData.result.slice(-40).toLowerCase();
            if (poolAddr !== "0x0000000000000000000000000000000000000000") {
              console.log(`[HBAR.h] === V2 POOL DETECTED (Mirror): fee=${fee} (${fee / 10000}%), pool=${poolAddr} ===`);
              const info: PoolVersionInfo = { version: "v2", feeTier: fee, poolAddress: poolAddr };
              _poolVersionCache[cacheKey] = info;
              return info;
            }
          }
        }
      } catch (mnErr: any) {
        console.log(`[HBAR.h] V2 getPool(fee=${fee}) Mirror fallback failed: ${mnErr?.message || mnErr}`);
      }
    }
    console.log("[HBAR.h] No V2 pool found at any fee tier -- checking V1");
  } else {
    console.log("[HBAR.h] V2 Factory not discovered -- skipping V2 pool check, trying V1");
  }

  // -- Strategy 3: V1 Factory.getPair() via JSON-RPC + Mirror Node fallback --
  const v1FactoryId = getSaucerSwapFactory(network);
  const v1FactoryEvm = await resolveContractEvmAddress(v1FactoryId, network);
  const pairCallData = bytesToHex(encodeGetPair(tokenA_evm, tokenB_evm));

  // 3a: JSON-RPC relay
  try {
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
          console.log(`[HBAR.h] === V1 POOL DETECTED (RPC): pair=${pairAddr} ===`);
          const info: PoolVersionInfo = { version: "v1", poolAddress: pairAddr };
          _poolVersionCache[cacheKey] = info;
          return info;
        }
        console.log("[HBAR.h] V1 getPair (RPC): returned zero -- no V1 pair");
      }
    }
  } catch (err: any) {
    console.log("[HBAR.h] V1 getPair (RPC) failed:", err?.message || err);
  }

  // 3b: Mirror Node contracts/call fallback
  try {
    const mnPairRes = await fetch(`${mirrorBase}/api/v1/contracts/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(10000),
      body: JSON.stringify({
        block: "latest",
        data: pairCallData,
        estimate: false,
        from: "0x0000000000000000000000000000000000000000",
        to: v1FactoryEvm,
        gas: 300_000,
        gasPrice: 0,
        value: 0,
      }),
    });

    if (mnPairRes.ok) {
      const mnPairData = await mnPairRes.json();
      if (mnPairData.result && mnPairData.result.length >= 66 && mnPairData.result !== "0x") {
        const pairAddr = "0x" + mnPairData.result.slice(-40).toLowerCase();
        if (pairAddr !== "0x0000000000000000000000000000000000000000") {
          console.log(`[HBAR.h] === V1 POOL DETECTED (Mirror): pair=${pairAddr} ===`);
          const info: PoolVersionInfo = { version: "v1", poolAddress: pairAddr };
          _poolVersionCache[cacheKey] = info;
          return info;
        }
        console.log("[HBAR.h] V1 getPair (Mirror): returned zero -- no V1 pair");
      }
    }
  } catch (mnErr: any) {
    console.log("[HBAR.h] V1 getPair (Mirror) failed:", mnErr?.message || mnErr);
  }

  console.warn(
    `[HBAR.h] No pool found on V1 or V2 for ` +
    `${evmAddressToHtsId(tokenA_evm)} (...${tokenA_evm.slice(-8)}) / ` +
    `${evmAddressToHtsId(tokenB_evm)} (...${tokenB_evm.slice(-8)})`
  );
  _poolVersionCache[cacheKey] = null;
  _poolVersionNegCacheTs[cacheKey] = Date.now();
  return null;
}
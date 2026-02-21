// ═══════════════════════════════════════════════════════════════════════
// SAUCERSWAP ENGINE — Server-Side Swap Brain
// ═══════════════════════════════════════════════════════════════════════
//
// [C44] Phase 1 — Balance, association, EVM resolution endpoints.
// [C45] Phase 1 continued — Server-side pool detection with parallel
//       V2 fee-tier probing, SaucerSwap API pool lookup, and on-chain
//       Factory.getPool()/getPair() via JSON-RPC + Mirror Node fallback.
// [C46] Phase 1 continued — Server-side quote fetching with parallel
//       multi-strategy racing (V1 router, V2 QuoterV2, V2 multi-hop,
//       SaucerSwap API, price estimation).
//
// Moves unreliable browser-side Mirror Node / JSON-RPC relay calls to
// the Deno edge function server.  Eliminates CORS, ad-blocker, and
// rate-limit issues that plague direct browser → Hedera infrastructure
// calls — the #1 root cause of Token→Token swap failures.
//
//   Endpoints:
//     GET /saucerswap/balance       — HTS token balance + native HBAR balance
//     GET /saucerswap/association     Token association check
//     GET /saucerswap/resolve-evm   — Hedera ID → EVM address resolution
//     GET /saucerswap/detect-pool   — Pool version detection (V1 vs V2)
//     GET /saucerswap/quote         — Parallel multi-strategy quote (saucerswap-quote.ts)
//     GET /saucerswap/engine-status — Health/debug endpoint
//
//   Internal utilities (exported for future phases):
//     ssFetchMirror()         — Mirror Node GET with circuit breaker
//     ssFetchJsonRpc()        — HashIO JSON-RPC relay with circuit breaker
//     ssFetchSaucerSwapApi()  — SaucerSwap REST API with circuit breaker
//     ssMirrorContractCall()  — Mirror Node POST /contracts/call simulation
//     ssResolveEvmAddress()   — Cached EVM address resolver
//     ssDetectPoolVersion()   — Server-side pool detection (parallel V2 fee tiers)
//
//   Caches (in-memory, per-isolate):
//     Balance:      15s TTL  — balances change frequently
//     Association:  60s TTL  — associations rarely change
//     EVM address:  permanent (positive), 2 min negative cache
//     Pool detect:  permanent (positive), 30s negative cache
//     V2 pool list: 5 min TTL (SaucerSwap API)
//     V1 pool list: 5 min TTL (SaucerSwap API)
//
//   Circuit breakers:
//     mirrorNodeBreaker  — from shared.ts (pre-existing)
//     saucerswapBreaker  — from shared.ts (pre-existing, for SS API calls)
//     hashioBreaker      — new, for JSON-RPC relay calls
//
//   Auth: Public (read-only data — no mutations).
//   Rate limited per-IP via shared isRateLimited().
//
//   SENIOR DEV NOTE: This module is the foundation for C45 (pool detection),
//   C46 (quote fetching), and C47 (frontend migration).  Future phases will
//   add routes here rather than creating additional server files.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import {
  getClientIp,
  isRateLimited,
  isValidHederaAccountId,
  ROUTE_PREFIX,
  mirrorNodeBreaker,
  saucerswapBreaker,
  isHttpFailure,
  HEDERA_MIRROR_MAINNET,
  HEDERA_MIRROR_TESTNET,
  CircuitBreaker,
} from "./shared.ts";

// ═════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════

/** Hedera Mirror Node base URLs — uses canonical shared constants. */
const MIRROR_NODES: Record<string, string> = {
  mainnet: HEDERA_MIRROR_MAINNET,
  testnet: HEDERA_MIRROR_TESTNET,
};

/** HashIO JSON-RPC relay (Hedera community endpoint). */
const JSON_RPC_RELAY: Record<string, string> = {
  mainnet: "https://mainnet.hashio.io/api",
  testnet: "https://testnet.hashio.io/api",
};

/** SaucerSwap REST API — authoritative pool/token data source. */
const SS_API = "https://api.saucerswap.finance";

/** Fetch timeout for Mirror Node calls. */
const MIRROR_TIMEOUT_MS = 10_000;

/** Fetch timeout for JSON-RPC relay calls. */
const JSON_RPC_TIMEOUT_MS = 12_000;

/** Only "mainnet" and "testnet" are valid. */
const VALID_NETWORKS = new Set(["mainnet", "testnet"]);

// ── SaucerSwap Contract Addresses (verified — see Background section) ──

/** V2 Factory — for getPool(tokenA, tokenB, fee) queries. */
const V2_FACTORY_IDS: Record<string, string> = {
  mainnet: "0.0.3946833",  // SaucerSwap V2 Factory — docs.saucerswap.finance
  testnet: "0.0.1197038",
};

/** V1 Factory — for getPair(tokenA, tokenB) queries. */
const V1_FACTORY_IDS: Record<string, string> = {
  mainnet: "0.0.1062784",  // SaucerSwap V1 Factory — docs.saucerswap.finance
  testnet: "0.0.9959",
};

/**
 * V2 fee tiers to probe when discovering pools (hundredths of a bip).
 * Ordered by most common first for faster short-circuit on API match.
 * [C27-02] Includes 1500 (0.15%) — SaucerSwap V2 custom tier.
 */
const V2_FEE_TIERS = [3000, 1500, 10000, 500, 100] as const;

// ── Cache TTLs ──────────────────────────────────────────────────────

const BALANCE_CACHE_TTL_MS    = 15_000;    // 15s — balances change often
const ASSOCIATION_CACHE_TTL_MS = 60_000;   // 60s — associations rarely change
const EVM_NEGATIVE_CACHE_TTL_MS = 120_000; // 2 min — retry failed lookups
const POOL_NEG_CACHE_TTL_MS   = 30_000;    // 30s — retry failed pool lookups
const SS_POOL_LIST_CACHE_TTL_MS = 300_000; // 5 min — SaucerSwap API pool lists

/** Max entries per cache to prevent unbounded memory growth. */
const CACHE_MAX_ENTRIES = 5_000;

// ═════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  value: T;
  ts: number;
}

/** Result of pool version detection — matches client-side PoolVersionInfo. */
export interface PoolVersionInfo {
  version: "v1" | "v2";
  feeTier?: number;        // V2 only: fee in hundredths of a bip (e.g. 3000 = 0.3%)
  poolAddress?: string;    // EVM address of the pool/pair contract
  source: string;          // How the pool was discovered (for diagnostics)
}

interface BalanceResult {
  tokenBalance: number;
  hbarBalance: number;
  decimals: number | null;
  isAssociated: boolean;
}

// ═════════════════════════════════════════════════════════════════════
// IN-MEMORY CACHES
// ═════════════════════════════════════════════════════════════════════

const _balanceCache     = new Map<string, CacheEntry<BalanceResult>>();
const _associationCache = new Map<string, CacheEntry<boolean>>();
const _evmPositiveCache = new Map<string, string>();
const _evmNegativeCache = new Map<string, number>();

/** Pool detection: positive results cached permanently. */
const _poolDetectCache    = new Map<string, PoolVersionInfo>();
/** Pool detection: negative results (no pool found) cached 30s. */
const _poolDetectNegCache = new Map<string, number>();

/** SaucerSwap V2 pool list (from /v2/pools/full). */
let _ssV2Pools: any[] | null = null;
let _ssV2PoolsTs = 0;
let _ssV2PoolsInFlight: Promise<any[] | null> | null = null;

/** SaucerSwap V1 pool list (from /v1/pools). */
let _ssV1Pools: any[] | null = null;
let _ssV1PoolsTs = 0;
let _ssV1PoolsInFlight: Promise<any[] | null> | null = null;

/** V2 Factory EVM address cache (per-network, permanent). */
const _v2FactoryEvmCache: Record<string, string | null> = {};

// ═════════════════════════════════════════════════════════════════════
// CACHE HELPERS
// ═════════════════════════════════════════════════════════════════════

function evictExpired<T>(cache: Map<string, CacheEntry<T>>, ttlMs: number): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.ts > ttlMs) cache.delete(key);
  }
  if (cache.size > CACHE_MAX_ENTRIES) {
    const entries = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toDelete = Math.ceil(entries.length * 0.2);
    for (let i = 0; i < toDelete; i++) cache.delete(entries[i][0]);
  }
}

function getCached<T>(
  cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number,
): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > ttlMs) { cache.delete(key); return undefined; }
  return entry.value;
}

function setCached<T>(
  cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number,
): void {
  evictExpired(cache, ttlMs);
  cache.set(key, { value, ts: Date.now() });
}

// ═════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER — HashIO JSON-RPC Relay
// ═════════════════════════════════════════════════════════════════════

export const hashioBreaker = new CircuitBreaker({
  name: "HashIO",
  failureThreshold: 5,
  failureWindowMs: 60_000,
  openDurationMs: 30_000,
});

// ═════════════════════════════════════════════════════════════════════
// ABI ENCODING HELPERS (pure functions — no network calls)
// ═════════════════════════════════════════════════════════════════════
// [C45] Server-side copies of the client-side ABI encoding utils.
// Needed for on-chain Factory.getPool() and Factory.getPair() calls.

function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

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

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

/**
 * ABI-encode getPool(address tokenA, address tokenB, uint24 fee) for V2 Factory.
 * Selector: 0x1698ee82
 * Returns hex-encoded calldata string.
 */
function encodeGetPool(tokenA: string, tokenB: string, fee: number): string {
  const selector = new Uint8Array([0x16, 0x98, 0xee, 0x82]);
  return bytesToHex(concatBytes(
    selector,
    encodeAddress(tokenA),
    encodeAddress(tokenB),
    encodeUint256(BigInt(fee)),
  ));
}

/**
 * ABI-encode getPair(address tokenA, address tokenB) for V1 Factory.
 * Selector: 0xe6a43905
 * Returns hex-encoded calldata string.
 */
function encodeGetPair(tokenA: string, tokenB: string): string {
  const selector = new Uint8Array([0xe6, 0xa4, 0x39, 0x05]);
  return bytesToHex(concatBytes(
    selector,
    encodeAddress(tokenA),
    encodeAddress(tokenB),
  ));
}

// ═════════════════════════════════════════════════════════════════════
// CORE FETCH UTILITIES
// ═════════════════════════════════════════════════════════════════════

/** Convert Hedera entity ID to long-zero EVM address (pure math). */
export function htsIdToEvmAddress(htsId: string): string {
  const parts = htsId.split(".");
  const num = parseInt(parts[2] || "0", 10);
  return "0x" + num.toString(16).padStart(40, "0");
}

/** Convert EVM address back to Hedera entity ID (long-zero only). */
export function evmAddressToHtsId(evmAddr: string): string {
  const hex = evmAddr.replace("0x", "");
  const num = parseInt(hex, 16);
  return "0.0." + num;
}

/**
 * Fetch from Hedera Mirror Node (GET) with circuit breaker and timeout.
 * [C44] All Mirror Node GET calls MUST go through this function.
 */
export async function ssFetchMirror(
  path: string, network: string = "mainnet",
): Promise<any | null> {
  const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
  try {
    const res = await mirrorNodeBreaker.call(
      () => fetch(base + path, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
      }),
      isHttpFailure,
    );
    if (!res.ok) { console.log(`[SS-Engine] Mirror GET ${path} → HTTP ${res.status}`); return null; }
    return await res.json();
  } catch (err: any) {
    const tag = err?.code === "CIRCUIT_OPEN" ? "circuit breaker OPEN" : (err?.message || err);
    console.log(`[SS-Engine] Mirror GET ${path} → ${tag}`);
    return null;
  }
}

/**
 * POST to Hedera Mirror Node /api/v1/contracts/call for EVM simulation.
 * Returns the hex `result` string, or null on failure.
 *
 * [C45] This replaces the browser-side Mirror Node contracts/call pattern.
 * Server-side calls bypass CORS and are protected by circuit breaker.
 */
export async function ssMirrorContractCall(
  toEvmAddress: string, calldata: string, network: string = "mainnet",
  gasLimit: number = 300_000,
): Promise<string | null> {
  const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
  try {
    const res = await mirrorNodeBreaker.call(
      () => fetch(`${base}/api/v1/contracts/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
        body: JSON.stringify({
          block: "latest",
          data: calldata,
          estimate: false,
          from: "0x0000000000000000000000000000000000000000",
          to: toEvmAddress,
          gas: gasLimit,
          gasPrice: 0,
          value: 0,
        }),
      }),
      isHttpFailure,
    );
    if (!res.ok) { console.log(`[SS-Engine] Mirror POST contracts/call → HTTP ${res.status}`); return null; }
    const data = await res.json();
    if (data.result && typeof data.result === "string" && data.result !== "0x") {
      return data.result;
    }
    return null;
  } catch (err: any) {
    const tag = err?.code === "CIRCUIT_OPEN" ? "circuit breaker OPEN" : (err?.message || err);
    console.log(`[SS-Engine] Mirror POST contracts/call → ${tag}`);
    return null;
  }
}

/**
 * Send a JSON-RPC eth_call to HashIO relay with circuit breaker.
 * [C44] Server-side calls bypass CORS and are protected by circuit breaker.
 */
export async function ssFetchJsonRpc(
  method: string, params: any[], network: string = "mainnet",
): Promise<any | null> {
  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
  try {
    const res = await hashioBreaker.call(
      () => fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        signal: AbortSignal.timeout(JSON_RPC_TIMEOUT_MS),
      }),
      isHttpFailure,
    );
    if (!res.ok) { console.log(`[SS-Engine] RPC ${method} → HTTP ${res.status}`); return null; }
    const data = await res.json();
    if (data.error) {
      console.log(`[SS-Engine] RPC ${method} → error: ${JSON.stringify(data.error).slice(0, 200)}`);
      return null;
    }
    return data.result ?? null;
  } catch (err: any) {
    const tag = err?.code === "CIRCUIT_OPEN" ? "circuit breaker OPEN" : (err?.message || err);
    console.log(`[SS-Engine] RPC ${method} → ${tag}`);
    return null;
  }
}

/**
 * Fetch from SaucerSwap REST API with circuit breaker and timeout.
 * Uses SAUCERSWAP_API_KEY env var for higher rate limits when available.
 *
 * [C45] The SaucerSwap API is the authoritative source for pool data.
 * From the server there are no CORS issues, so this is much more reliable.
 */
export async function ssFetchSaucerSwapApi(
  path: string,
): Promise<any | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = Deno.env.get("SAUCERSWAP_API_KEY") ?? "";
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const res = await saucerswapBreaker.call(
      () => fetch(SS_API + path, {
        headers,
        signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
      }),
      isHttpFailure,
    );
    if (!res.ok) { console.log(`[SS-Engine] SS-API ${path} → HTTP ${res.status}`); return null; }
    return await res.json();
  } catch (err: any) {
    const tag = err?.code === "CIRCUIT_OPEN" ? "circuit breaker OPEN" : (err?.message || err);
    console.log(`[SS-Engine] SS-API ${path} → ${tag}`);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════
// EVM ADDRESS RESOLUTION
// ═════════════════════════════════════════════════════════════════════

/**
 * Resolve a Hedera account or contract ID to its actual EVM address.
 * Falls back to long-zero synthetic address.
 * Positive: permanent cache.  Negative: 2 min cooldown.
 */
export async function ssResolveEvmAddress(
  entityId: string, type: "account" | "contract" = "account", network: string = "mainnet",
): Promise<string> {
  const cacheKey = `${type}:${network}:${entityId}`;
  const cached = _evmPositiveCache.get(cacheKey);
  if (cached) return cached;

  const negTs = _evmNegativeCache.get(cacheKey);
  if (negTs && Date.now() - negTs < EVM_NEGATIVE_CACHE_TTL_MS) {
    return htsIdToEvmAddress(entityId);
  }

  // Periodic negative cache eviction
  if (_evmNegativeCache.size > CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, ts] of _evmNegativeCache) {
      if (now - ts > EVM_NEGATIVE_CACHE_TTL_MS) _evmNegativeCache.delete(k);
    }
  }

  // Strategy A: type-specific endpoint
  const endpoint = type === "contract" ? "contracts" : "accounts";
  const data = await ssFetchMirror(`/api/v1/${endpoint}/${entityId}`, network);
  if (data?.evm_address && typeof data.evm_address === "string" &&
      data.evm_address.startsWith("0x") && data.evm_address.length === 42) {
    console.log(`[SS-Engine] Resolved ${type} ${entityId} → EVM: ${data.evm_address}`);
    _evmPositiveCache.set(cacheKey, data.evm_address);
    _evmNegativeCache.delete(cacheKey);
    if (_evmPositiveCache.size > CACHE_MAX_ENTRIES) {
      const firstKey = _evmPositiveCache.keys().next().value;
      if (firstKey) _evmPositiveCache.delete(firstKey);
    }
    return data.evm_address;
  }

  // Strategy B: fallback endpoint for contracts
  if (type === "contract") {
    const fb = await ssFetchMirror(`/api/v1/accounts/${entityId}`, network);
    if (fb?.evm_address && typeof fb.evm_address === "string" &&
        fb.evm_address.startsWith("0x") && fb.evm_address.length === 42) {
      console.log(`[SS-Engine] Resolved contract ${entityId} via accounts fallback → EVM: ${fb.evm_address}`);
      _evmPositiveCache.set(cacheKey, fb.evm_address);
      _evmNegativeCache.delete(cacheKey);
      return fb.evm_address;
    }
  }

  const fallback = htsIdToEvmAddress(entityId);
  console.log(`[SS-Engine] Using long-zero fallback for ${type} ${entityId}: ${fallback}`);
  _evmNegativeCache.set(cacheKey, Date.now());
  return fallback;
}

// ═════════════════════════════════════════════════════════════════════
// BALANCE FETCHING  [C44]
// ═════════════════════════════════════════════════════════════════════

async function fetchBalance(
  accountId: string, tokenId: string, network: string,
): Promise<BalanceResult> {
  const cacheKey = `${network}:${accountId}:${tokenId}`;
  const cached = getCached(_balanceCache, cacheKey, BALANCE_CACHE_TTL_MS);
  if (cached) return cached;

  const [accountData, tokenData] = await Promise.all([
    ssFetchMirror(`/api/v1/accounts/${accountId}`, network),
    tokenId !== "native"
      ? ssFetchMirror(`/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}&limit=1`, network)
      : Promise.resolve(null),
  ]);

  const hbarBalance = accountData ? parseInt(accountData.balance?.balance || "0", 10) : 0;
  let tokenBalance = 0;
  let decimals: number | null = null;
  let isAssociated = false;

  if (tokenId === "native") {
    tokenBalance = hbarBalance; decimals = 8; isAssociated = true;
  } else if (tokenData?.tokens?.[0]) {
    const entry = tokenData.tokens[0];
    tokenBalance = parseInt(entry.balance || "0", 10);
    decimals = entry.decimals != null ? parseInt(String(entry.decimals), 10) : null;
    isAssociated = true;
  }

  const result: BalanceResult = { tokenBalance, hbarBalance, decimals, isAssociated };
  setCached(_balanceCache, cacheKey, result, BALANCE_CACHE_TTL_MS);
  return result;
}

// ═════════════════════════════════════════════════════════════════════
// ASSOCIATION CHECK  [C44]
// ═════════════════════════════════════════════════════════════════════

async function checkAssociation(
  accountId: string, tokenId: string, network: string,
): Promise<boolean> {
  if (tokenId === "native") return true;
  const cacheKey = `${network}:${accountId}:${tokenId}`;
  const cached = getCached(_associationCache, cacheKey, ASSOCIATION_CACHE_TTL_MS);
  if (cached !== undefined) return cached;

  const data = await ssFetchMirror(
    `/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}&limit=1`, network,
  );
  const isAssociated = !!(data?.tokens?.length > 0);
  setCached(_associationCache, cacheKey, isAssociated, ASSOCIATION_CACHE_TTL_MS);
  return isAssociated;
}

// ═════════════════════════════════════════════════════════════════════
// SAUCERSWAP API POOL LIST FETCHING  [C45]
// ═════════════════════════════════════════════════════════════════════

/**
 * Fetch the V2 pool list from the SaucerSwap API with 5-min cache.
 * Deduplicates concurrent fetches (in-flight guard).
 * [C45] Matches the client-side fetchSaucerSwapV2PoolList() logic.
 */
async function ensureV2PoolList(): Promise<any[]> {
  if (_ssV2Pools && Date.now() - _ssV2PoolsTs < SS_POOL_LIST_CACHE_TTL_MS) {
    return _ssV2Pools;
  }
  if (_ssV2PoolsInFlight) return (await _ssV2PoolsInFlight) || [];

  _ssV2PoolsInFlight = (async () => {
    // Try /v2/pools/full first (includes token sub-objects), fallback to /v2/pools
    for (const ep of ["/v2/pools/full", "/v2/pools"]) {
      const data = await ssFetchSaucerSwapApi(ep);
      if (data) {
        const raw = Array.isArray(data) ? data : (data?.pools || data?.data || []);
        // Filter to pools with token info
        const pools = raw.filter((p: any) =>
          (p.tokenA?.id || p.token0?.id || p.token0Id) &&
          (p.tokenB?.id || p.token1?.id || p.token1Id)
        );
        if (pools.length > 0) {
          _ssV2Pools = pools;
          _ssV2PoolsTs = Date.now();
          console.log(`[SS-Engine] V2 pool list via ${ep}: ${pools.length} pools (raw: ${raw.length})`);
          _ssV2PoolsInFlight = null;
          return pools;
        }
      }
    }
    _ssV2PoolsInFlight = null;
    return _ssV2Pools;
  })();

  return (await _ssV2PoolsInFlight) || [];
}

/**
 * Fetch the V1 pool list from the SaucerSwap API with 5-min cache.
 * [C45] Matches the client-side V1 pool fetching logic from C36-04.
 */
async function ensureV1PoolList(): Promise<any[]> {
  if (_ssV1Pools && Date.now() - _ssV1PoolsTs < SS_POOL_LIST_CACHE_TTL_MS) {
    return _ssV1Pools;
  }
  if (_ssV1PoolsInFlight) return (await _ssV1PoolsInFlight) || [];

  _ssV1PoolsInFlight = (async () => {
    const data = await ssFetchSaucerSwapApi("/v1/pools");
    if (data) {
      const raw = Array.isArray(data) ? data : Object.values(data);
      _ssV1Pools = raw as any[];
      _ssV1PoolsTs = Date.now();
      console.log(`[SS-Engine] V1 pool list: ${raw.length} pools`);
      _ssV1PoolsInFlight = null;
      return raw as any[];
    }
    _ssV1PoolsInFlight = null;
    return _ssV1Pools;
  })();

  return (await _ssV1PoolsInFlight) || [];
}

// ═════════════════════════════════════════════════════════════════════
// V2 FACTORY EVM ADDRESS DISCOVERY  [C45]
// ═════════════════════════════════════════════════════════════════════

/**
 * Get the V2 Factory EVM address, with permanent cache and long-zero fallback.
 * Tries resolving the real EVM address via Mirror Node first.
 */
async function getV2FactoryEvm(network: string): Promise<string> {
  if (_v2FactoryEvmCache[network]) return _v2FactoryEvmCache[network]!;

  const factoryId = V2_FACTORY_IDS[network] || V2_FACTORY_IDS.mainnet;
  const evm = await ssResolveEvmAddress(factoryId, "contract", network);
  _v2FactoryEvmCache[network] = evm;
  return evm;
}

// ═════════════════════════════════════════════════════════════════════
// POOL DETECTION — Core Logic  [C45]
// ═════════════════════════════════════════════════════════════════════
//
// Strategy (matches client-side SEC-17 with key optimizations):
//
//   0. Cache check (positive = permanent, negative = 30s TTL)
//   1. SaucerSwap V2 API pool lookup (match by HTS ID + symbol fallback)
//   2. SaucerSwap V1 API pool lookup (match by HTS ID + symbol fallback)
//   3. V2 Factory.getPool() — ALL 5 FEE TIERS IN PARALLEL via JSON-RPC
//      (with Mirror Node fallback for any that fail)
//   4. V1 Factory.getPair() via JSON-RPC (with Mirror Node fallback)
//   5. Return null (404)
//
// [C45] KEY IMPROVEMENT: V2 fee-tier probing runs ALL 5 tiers in parallel.
// The client-side version serializes them (5 × 8s timeout = 40s worst case).
// Server-side: max(timeouts) = ~12s worst case.

/** Zero address constant for comparison. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Extract an address from a 32-byte ABI-encoded return value.
 * Returns lowercase 0x-prefixed address, or null if it's the zero address
 * or the data is too short.
 */
function decodeAddressResult(hexResult: string | null): string | null {
  if (!hexResult || hexResult.length < 66) return null;
  const addr = "0x" + hexResult.slice(-40).toLowerCase();
  return addr === ZERO_ADDRESS ? null : addr;
}

/**
 * [C45] Look up a V2 pool from the cached SaucerSwap V2 API pool list.
 * Matches by HTS token IDs (primary) and symbol (fallback for bridge tokens).
 * Mirrors the client-side lookupV2PoolFromAPI() from C36-04.
 */
async function lookupV2PoolFromApi(
  tokenA_evm: string, tokenB_evm: string, network: string,
): Promise<PoolVersionInfo | null> {
  if (network !== "mainnet") return null; // API only for mainnet

  const pools = await ensureV2PoolList();
  if (!pools || pools.length === 0) return null;

  const htsIdA = evmAddressToHtsId(tokenA_evm);
  const htsIdB = evmAddressToHtsId(tokenB_evm);

  for (const pool of pools) {
    // [C36-04] Robust token extraction: handle tokenA/tokenB as objects or strings
    const tA = pool.tokenA || pool.token0 || {};
    const tB = pool.tokenB || pool.token1 || {};
    const idA = tA.id || pool.token0Id || "";
    const idB = tB.id || pool.token1Id || "";

    // Primary match: by HTS token ID (exact)
    const matchedById =
      (idA === htsIdA && idB === htsIdB) ||
      (idA === htsIdB && idB === htsIdA);

    // [C36-04] Fallback: symbol match (handles bridge token ID mismatches)
    const symA = (tA.symbol || "").toUpperCase();
    const symB = (tB.symbol || "").toUpperCase();
    // We don't have the local token registry here, but we can still do
    // a pure-symbol cross-match when ID match fails
    const matchedBySymbol = !matchedById && symA && symB && (
      // At least one ID matches and the other matches by symbol in the other pair
      (idA === htsIdA && symB !== "" && idB !== htsIdB) ||
      (idA === htsIdB && symB !== "" && idB !== htsIdA) ||
      (idB === htsIdA && symA !== "" && idA !== htsIdB) ||
      (idB === htsIdB && symA !== "" && idA !== htsIdA)
    );
    // Only use pure symbol match as last resort — too many false positives
    // without the token registry. Stick to ID-based for server-side.
    // TODO [C59]: When token registry is server-side, enable full symbol fallback.

    if (matchedById) {
      const fee = pool.fee ?? pool.feeTier ?? pool.feeRate ?? 3000;
      const poolAddr = pool.contractId
        ? htsIdToEvmAddress(pool.contractId).toLowerCase()
        : (pool.id?.startsWith?.("0x") ? pool.id : undefined);

      console.log(`[SS-Engine] V2 API match: ${idA}/${idB} fee=${fee} pool=${poolAddr || "?"} (match: ID)`);
      return { version: "v2", feeTier: fee, poolAddress: poolAddr, source: "api-v2" };
    }

    // Log symbol fallback match but don't use it without registry validation
    if (matchedBySymbol) {
      console.log(`[SS-Engine] V2 API potential symbol match: ${idA}(${symA})/${idB}(${symB}) for ${htsIdA}/${htsIdB} — skipping (no registry validation)`);
    }
  }

  return null;
}

/**
 * [C45] Look up a V1 pool from the cached SaucerSwap V1 API pool list.
 * Mirrors the client-side V1 lookup logic from C36-04.
 */
async function lookupV1PoolFromApi(
  tokenA_evm: string, tokenB_evm: string, network: string,
): Promise<PoolVersionInfo | null> {
  if (network !== "mainnet") return null;

  const pools = await ensureV1PoolList();
  if (!pools || pools.length === 0) return null;

  const htsIdA = evmAddressToHtsId(tokenA_evm);
  const htsIdB = evmAddressToHtsId(tokenB_evm);

  for (const pool of pools) {
    // [C36-04] Robust token extraction: handle tokenA/tokenB as objects or strings
    const rawA = pool.tokenA;
    const rawB = pool.tokenB;
    const pA = typeof rawA === "string" ? rawA
      : (rawA?.id || rawA?.tokenId || pool.token0?.id || pool.token0Id || "");
    const pB = typeof rawB === "string" ? rawB
      : (rawB?.id || rawB?.tokenId || pool.token1?.id || pool.token1Id || "");

    // Primary match: by HTS token ID
    const idMatch = (pA === htsIdA && pB === htsIdB) || (pA === htsIdB && pB === htsIdA);

    if (idMatch) {
      const pairAddr = pool.contractId
        ? htsIdToEvmAddress(pool.contractId).toLowerCase()
        : (pool.id?.startsWith?.("0x") ? pool.id : undefined);

      console.log(`[SS-Engine] V1 API match: ${pA}/${pB} pair=${pairAddr || "?"}`);
      return { version: "v1", poolAddress: pairAddr, source: "api-v1" };
    }
  }

  return null;
}

/**
 * [C45] Probe a single V2 fee tier via JSON-RPC eth_call, with Mirror Node fallback.
 * Returns PoolVersionInfo if a non-zero pool address is found, null otherwise.
 *
 * This is called in parallel for all 5 fee tiers — the key perf improvement.
 */
async function probeV2FeeTier(
  tokenA_evm: string, tokenB_evm: string, fee: number,
  v2FactoryEvm: string, network: string,
): Promise<PoolVersionInfo | null> {
  const calldata = encodeGetPool(tokenA_evm, tokenB_evm, fee);

  // Strategy A: JSON-RPC relay eth_call
  const rpcResult = await ssFetchJsonRpc(
    "eth_call",
    [{ to: v2FactoryEvm, data: calldata, gas: "0x493e0" }, "latest"],
    network,
  );
  const rpcAddr = decodeAddressResult(rpcResult);
  if (rpcAddr) {
    console.log(`[SS-Engine] V2 pool (RPC): fee=${fee} (${fee / 10000}%) pool=${rpcAddr}`);
    return { version: "v2", feeTier: fee, poolAddress: rpcAddr, source: "factory-v2-rpc" };
  }
  // If we got a valid zero response from RPC, skip Mirror fallback for this tier
  if (rpcResult && typeof rpcResult === "string" && rpcResult.length >= 66) {
    return null; // Definitive "no pool at this tier"
  }

  // Strategy B: Mirror Node contracts/call fallback (works when RPC doesn't)
  const mnResult = await ssMirrorContractCall(v2FactoryEvm, calldata, network);
  const mnAddr = decodeAddressResult(mnResult);
  if (mnAddr) {
    console.log(`[SS-Engine] V2 pool (Mirror): fee=${fee} (${fee / 10000}%) pool=${mnAddr}`);
    return { version: "v2", feeTier: fee, poolAddress: mnAddr, source: "factory-v2-mirror" };
  }

  return null;
}

/**
 * [C45] Probe V1 Factory.getPair() via JSON-RPC, with Mirror Node fallback.
 */
async function probeV1Pair(
  tokenA_evm: string, tokenB_evm: string,
  v1FactoryEvm: string, network: string,
): Promise<PoolVersionInfo | null> {
  const calldata = encodeGetPair(tokenA_evm, tokenB_evm);

  // Strategy A: JSON-RPC relay eth_call
  const rpcResult = await ssFetchJsonRpc(
    "eth_call",
    [{ to: v1FactoryEvm, data: calldata, gas: "0x493e0" }, "latest"],
    network,
  );
  const rpcAddr = decodeAddressResult(rpcResult);
  if (rpcAddr) {
    console.log(`[SS-Engine] V1 pair (RPC): pair=${rpcAddr}`);
    return { version: "v1", poolAddress: rpcAddr, source: "factory-v1-rpc" };
  }

  // Strategy B: Mirror Node contracts/call fallback
  const mnResult = await ssMirrorContractCall(v1FactoryEvm, calldata, network);
  const mnAddr = decodeAddressResult(mnResult);
  if (mnAddr) {
    console.log(`[SS-Engine] V1 pair (Mirror): pair=${mnAddr}`);
    return { version: "v1", poolAddress: mnAddr, source: "factory-v1-mirror" };
  }

  return null;
}

/**
 * [C45] Server-side pool version detection.
 *
 * Equivalent to client-side detectPoolVersion() but with key improvements:
 *   - All 5 V2 fee-tier probes run in PARALLEL (client does serial)
 *   - No CORS / ad-blocker interference
 *   - Circuit breaker protection prevents cascading failures
 *   - SaucerSwap API key for higher rate limits
 *
 * @param tokenA_evm  EVM address of token A (0x-prefixed, 42 chars)
 * @param tokenB_evm  EVM address of token B (0x-prefixed, 42 chars)
 * @param network     "mainnet" | "testnet"
 * @returns           PoolVersionInfo if found, null if no pool exists
 */
export async function ssDetectPoolVersion(
  tokenA_evm: string, tokenB_evm: string, network: string = "mainnet",
): Promise<PoolVersionInfo | null> {
  // Canonical cache key: sorted lowercase addresses
  const sortedKey = [tokenA_evm.toLowerCase(), tokenB_evm.toLowerCase()].sort().join(":");
  const cacheKey = `${network}:${sortedKey}`;

  // ── Cache check ──
  const cached = _poolDetectCache.get(cacheKey);
  if (cached) {
    console.log(`[SS-Engine] Pool cache hit: ${cached.version} fee=${cached.feeTier || "N/A"} source=${cached.source}`);
    return cached;
  }
  const negTs = _poolDetectNegCache.get(cacheKey);
  if (negTs && Date.now() - negTs < POOL_NEG_CACHE_TTL_MS) {
    return null;
  }
  // Clear expired negative entries
  if (_poolDetectNegCache.size > CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, ts] of _poolDetectNegCache) {
      if (now - ts > POOL_NEG_CACHE_TTL_MS) _poolDetectNegCache.delete(k);
    }
  }

  const htsA = evmAddressToHtsId(tokenA_evm);
  const htsB = evmAddressToHtsId(tokenB_evm);
  console.log(`[SS-Engine] Pool detection: ${htsA} (${tokenA_evm.slice(0, 10)}...) / ${htsB} (${tokenB_evm.slice(0, 10)}...)`);

  // ── Strategy 1: SaucerSwap V2 API pool lookup ──
  // The API is the most reliable source — no ABI encoding, proper CORS.
  try {
    const v2Api = await lookupV2PoolFromApi(tokenA_evm, tokenB_evm, network);
    if (v2Api) {
      _poolDetectCache.set(cacheKey, v2Api);
      return v2Api;
    }
  } catch (e: any) {
    console.log(`[SS-Engine] V2 API lookup error: ${e?.message || e}`);
  }

  // ── Strategy 2: SaucerSwap V1 API pool lookup ──
  try {
    const v1Api = await lookupV1PoolFromApi(tokenA_evm, tokenB_evm, network);
    if (v1Api) {
      _poolDetectCache.set(cacheKey, v1Api);
      return v1Api;
    }
  } catch (e: any) {
    console.log(`[SS-Engine] V1 API lookup error: ${e?.message || e}`);
  }

  // ── Strategy 3: V2 Factory.getPool() — ALL 5 fee tiers in PARALLEL ──
  // [C45] KEY IMPROVEMENT: Client serializes 5 tiers × (RPC + Mirror fallback)
  // = up to 10 sequential calls.  Server does them all in parallel.
  const v2FactoryEvm = await getV2FactoryEvm(network);
  if (v2FactoryEvm) {
    const v2Probes = V2_FEE_TIERS.map(fee =>
      probeV2FeeTier(tokenA_evm, tokenB_evm, fee, v2FactoryEvm, network)
    );

    const v2Results = await Promise.allSettled(v2Probes);

    // Take the first successful result (ordered by fee tier priority)
    for (const result of v2Results) {
      if (result.status === "fulfilled" && result.value) {
        _poolDetectCache.set(cacheKey, result.value);
        if (_poolDetectCache.size > CACHE_MAX_ENTRIES) {
          const firstKey = _poolDetectCache.keys().next().value;
          if (firstKey) _poolDetectCache.delete(firstKey);
        }
        return result.value;
      }
    }
    console.log("[SS-Engine] No V2 pool at any fee tier — checking V1 on-chain");
  } else {
    console.log("[SS-Engine] V2 Factory not discovered — skipping V2 on-chain");
  }

  // ── Strategy 4: V1 Factory.getPair() via JSON-RPC + Mirror fallback ──
  const v1FactoryId = V1_FACTORY_IDS[network] || V1_FACTORY_IDS.mainnet;
  const v1FactoryEvm = await ssResolveEvmAddress(v1FactoryId, "contract", network);

  const v1Result = await probeV1Pair(tokenA_evm, tokenB_evm, v1FactoryEvm, network);
  if (v1Result) {
    _poolDetectCache.set(cacheKey, v1Result);
    if (_poolDetectCache.size > CACHE_MAX_ENTRIES) {
      const firstKey = _poolDetectCache.keys().next().value;
      if (firstKey) _poolDetectCache.delete(firstKey);
    }
    return v1Result;
  }

  // ── No pool found ──
  console.log(
    `[SS-Engine] No pool found for ${htsA} (…${tokenA_evm.slice(-8)}) / ` +
    `${htsB} (…${tokenB_evm.slice(-8)})`
  );
  _poolDetectNegCache.set(cacheKey, Date.now());
  return null;
}

// ═════════════════════════════════════════════════════════════════════
// INPUT VALIDATION
// ═════════════════════════════════════════════════════════════════════

function isValidTokenId(id: string): boolean {
  if (id === "native") return true;
  return /^0\.0\.\d{1,10}$/.test(id);
}

function isValidEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function normalizeNetwork(raw: string | undefined | null): string {
  const n = (raw || "mainnet").toLowerCase().trim();
  return VALID_NETWORKS.has(n) ? n : "mainnet";
}

// ═════════════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═════════════════════════════════════════════════════════════════════

export function registerSaucerswapEngineRoutes(app: Hono): void {

  // ────────────────────────────────────────────────────────────────────
  // GET /saucerswap/balance
  // [C44] Token balance + native HBAR balance in one call.
  // ────────────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/saucerswap/balance`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const accountId = c.req.query("account") || "";
    const tokenId   = c.req.query("token") || "";
    const network   = normalizeNetwork(c.req.query("network"));

    if (!isValidHederaAccountId(accountId)) {
      return c.json({ error: "Invalid account ID", detail: `Expected 0.0.xxxxx, got: "${accountId}"` }, 400);
    }
    if (!isValidTokenId(tokenId)) {
      return c.json({ error: "Invalid token ID", detail: `Expected 0.0.xxxxx or "native", got: "${tokenId}"` }, 400);
    }

    try {
      const cacheKey = `${network}:${accountId}:${tokenId}`;
      const wasCached = getCached(_balanceCache, cacheKey, BALANCE_CACHE_TTL_MS) !== undefined;
      const result = await fetchBalance(accountId, tokenId, network);
      return c.json({ ...result, fromCache: wasCached });
    } catch (err: any) {
      console.log(`[SS-Engine] /balance error: ${err?.message || err}`);
      return c.json({ error: "Balance fetch failed", detail: err?.message || "Unknown error" }, 502);
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /saucerswap/association
  // [C44] Token association check.
  // ────────────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/saucerswap/association`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const accountId = c.req.query("account") || "";
    const tokenId   = c.req.query("token") || "";
    const network   = normalizeNetwork(c.req.query("network"));

    if (!isValidHederaAccountId(accountId)) {
      return c.json({ error: "Invalid account ID", detail: `Expected 0.0.xxxxx, got: "${accountId}"` }, 400);
    }
    if (!isValidTokenId(tokenId)) {
      return c.json({ error: "Invalid token ID", detail: `Expected 0.0.xxxxx or "native", got: "${tokenId}"` }, 400);
    }

    try {
      const cacheKey = `${network}:${accountId}:${tokenId}`;
      const wasCached = getCached(_associationCache, cacheKey, ASSOCIATION_CACHE_TTL_MS) !== undefined;
      const isAssociated = await checkAssociation(accountId, tokenId, network);
      return c.json({ isAssociated, fromCache: wasCached });
    } catch (err: any) {
      console.log(`[SS-Engine] /association error: ${err?.message || err}`);
      return c.json({ error: "Association check failed", detail: err?.message || "Unknown error" }, 502);
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /saucerswap/resolve-evm
  // [C44] Hedera ID → EVM address resolution.
  // ────────────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/saucerswap/resolve-evm`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const entityId   = c.req.query("id") || "";
    const entityType = (c.req.query("type") || "account").toLowerCase().trim();
    const network    = normalizeNetwork(c.req.query("network"));

    if (!isValidHederaAccountId(entityId)) {
      return c.json({ error: "Invalid entity ID", detail: `Expected 0.0.xxxxx, got: "${entityId}"` }, 400);
    }
    if (entityType !== "account" && entityType !== "contract") {
      return c.json({ error: "Invalid type", detail: `Expected "account" or "contract", got: "${entityType}"` }, 400);
    }

    try {
      const cacheKey = `${entityType}:${network}:${entityId}`;
      const wasCached = _evmPositiveCache.has(cacheKey);
      const evmAddress = await ssResolveEvmAddress(entityId, entityType as "account" | "contract", network);
      const longZero = htsIdToEvmAddress(entityId);
      const isActual = evmAddress.toLowerCase() !== longZero.toLowerCase() || _evmPositiveCache.has(cacheKey);
      return c.json({ evmAddress, isActual, fromCache: wasCached });
    } catch (err: any) {
      console.log(`[SS-Engine] /resolve-evm error: ${err?.message || err}`);
      const fallback = htsIdToEvmAddress(entityId);
      return c.json({
        evmAddress: fallback, isActual: false, fromCache: false,
        warning: "Resolution failed, using synthetic long-zero address",
        detail: err?.message || "Unknown error",
      });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /saucerswap/detect-pool
  //
  // [C45] Server-side pool version detection.
  //
  // Detects whether a token pair has a pool on SaucerSwap V1 or V2.
  // Returns the pool version, fee tier (V2), pool address, and discovery
  // source.  Returns 404 if no pool exists.
  //
  // Query params:
  //   tokenA  (required)  EVM address of token A (0x-prefixed, 42 chars)
  //   tokenB  (required)  EVM address of token B (0x-prefixed, 42 chars)
  //   network (optional)  "mainnet" (default) | "testnet"
  //
  // Response (200):
  //   {
  //     version: "v1" | "v2",
  //     feeTier?: number,       // V2 only (e.g. 3000 = 0.3%)
  //     poolAddress?: string,   // EVM address of the pool/pair
  //     source: string,         // "api-v2" | "api-v1" | "factory-v2-rpc" | ...
  //     fromCache: boolean,
  //     tokenA_hts: string,     // Resolved HTS ID (for diagnostics)
  //     tokenB_hts: string
  //   }
  //
  // Response (404):
  //   { error: "No pool found", tokenA_hts, tokenB_hts }
  // ────────────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/saucerswap/detect-pool`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const tokenA  = c.req.query("tokenA") || "";
    const tokenB  = c.req.query("tokenB") || "";
    const network = normalizeNetwork(c.req.query("network"));

    if (!isValidEvmAddress(tokenA)) {
      return c.json({
        error: "Invalid tokenA",
        detail: `Expected 0x-prefixed 40-char hex, got: "${tokenA}"`,
      }, 400);
    }
    if (!isValidEvmAddress(tokenB)) {
      return c.json({
        error: "Invalid tokenB",
        detail: `Expected 0x-prefixed 40-char hex, got: "${tokenB}"`,
      }, 400);
    }
    if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
      return c.json({ error: "tokenA and tokenB must be different" }, 400);
    }

    const tokenA_hts = evmAddressToHtsId(tokenA);
    const tokenB_hts = evmAddressToHtsId(tokenB);

    try {
      // Check cache for fromCache flag
      const sortedKey = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort().join(":");
      const cacheKey = `${network}:${sortedKey}`;
      const wasCached = _poolDetectCache.has(cacheKey);

      const startMs = Date.now();
      const result = await ssDetectPoolVersion(tokenA, tokenB, network);
      const durationMs = Date.now() - startMs;

      if (result) {
        return c.json({
          ...result,
          fromCache: wasCached,
          tokenA_hts,
          tokenB_hts,
          durationMs,
        });
      }

      return c.json({
        error: "No pool found",
        tokenA_hts,
        tokenB_hts,
        durationMs,
      }, 404);
    } catch (err: any) {
      console.log(`[SS-Engine] /detect-pool error: ${err?.message || err}`);
      return c.json({
        error: "Pool detection failed",
        detail: err?.message || "Unknown error",
        tokenA_hts,
        tokenB_hts,
      }, 502);
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /saucerswap/engine-status
  // [C44] Health/debug endpoint for the swap engine.
  // ────────────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/saucerswap/engine-status`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    return c.json({
      engine: "saucerswap-engine",
      version: "C48",
      circuitBreakers: {
        mirrorNode: mirrorNodeBreaker.getStatus(),
        hashio: hashioBreaker.getStatus(),
        saucerswap: saucerswapBreaker.getStatus(),
      },
      caches: {
        balance:         { size: _balanceCache.size, ttlMs: BALANCE_CACHE_TTL_MS },
        association:     { size: _associationCache.size, ttlMs: ASSOCIATION_CACHE_TTL_MS },
        evmPositive:     { size: _evmPositiveCache.size, ttl: "permanent" },
        evmNegative:     { size: _evmNegativeCache.size, ttlMs: EVM_NEGATIVE_CACHE_TTL_MS },
        poolDetect:      { size: _poolDetectCache.size, ttl: "permanent" },
        poolDetectNeg:   { size: _poolDetectNegCache.size, ttlMs: POOL_NEG_CACHE_TTL_MS },
        v2PoolList:      { size: _ssV2Pools?.length ?? 0, ttlMs: SS_POOL_LIST_CACHE_TTL_MS },
        v1PoolList:      { size: _ssV1Pools?.length ?? 0, ttlMs: SS_POOL_LIST_CACHE_TTL_MS },
        v2FactoryEvm:    _v2FactoryEvmCache,
      },
      timestamp: Date.now(),
    });
  });
}
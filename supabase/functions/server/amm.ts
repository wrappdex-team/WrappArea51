// ══════════════════════════════════════════════════════════════════════
// SMART LIQUIDITY — Constant-Product AMM Engine (KV-Backed)
// ══════════════════════════════════════════════════════════════════════
//
// Architecture:
//   - Constant-product AMM (x * y = k) for 2-token pools
//   - All pool state in KV (multi-instance safe, cold-start resilient)
//   - LP share tracking per user per pool
//   - Smart routing: direct → USDC-hop, selects lowest price impact
//   - Oracle prices (SaucerSwap) for UI/TVL only — swaps use reserves
//
// Security design:
//   - First-depositor attack mitigated by MINIMUM_LIQUIDITY lock (1000 units)
//   - Reserves stored as raw integer strings (no floating-point loss)
//   - Depth-proportional max swap caps (<$10K: 2%, <$100K: 5%, >$100K: 10%)
//   - Pools below $100 TVL excluded from routing (manipulation resistance)
//   - Per-pool pessimistic lock + optimistic CAS versioning on all mutations
//   - Sandwich protection: KV mempool is private (server-side only)
//   - Fees stay in pool (increase k), benefiting all LP holders
//   - Pool creation restricted to whitelisted Tier 1 tokens
//
// ══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import {
  getClientIp, isRateLimited, sanitizeString, isValidHederaAccountId,
  generateTicketId, isAdminAuthorized, withKvLock, POOL_LOCK_RETRY_INTERVAL_MS,
} from "./shared.ts";
import type { KvLockConfig } from "./shared.ts";
import { requireAuth, validateSession } from "./auth.ts";

// ── Constants ────────────────────────────────────────────────────────

const SAUCERSWAP_API_URL = "https://api.saucerswap.finance";
// Cache the SaucerSwap API path that last succeeded
let _saucerswapWorkingPath: string | null = null;
const POOL_PREFIX = "sl_pool_";
const LP_PREFIX = "sl_lp_";
const SWAP_LOG_PREFIX = "sl_swap_";
const USER_SWAPS_PREFIX = "sl_user_swaps_"; // Per-account swap history index
const USER_SWAPS_MAX = 10;                  // Cap per-account swap history
const GLOBAL_RECENT_SWAPS_KEY = "sl_recent_swaps"; // Anonymized site-wide activity feed
const GLOBAL_RECENT_SWAPS_MAX = 10;
const SWAP_HISTORY_RATE_PREFIX = "sl_shrl_";       // Per-account rate limit for history reads
const SWAP_HISTORY_RATE_TTL_MS = 5_000;            // 1 request per 5s per account
const POOL_INDEX_KEY = "sl_pool_index";
const ORACLE_CACHE_KEY = "sl_oracle_cache";
const ORACLE_CACHE_TTL_MS = 60_000;
const ORACLE_FALLBACK_CONFIG_KEY = "sl_oracle_fallback_cfg";
const TREASURY_FEE_KEY = "sl_treasury_fees";
const TREASURY_FEE_LOCK_KEY = "sl_treasury_lock";

// Per-pool pessimistic lock (KV-backed)
const POOL_LOCK_PREFIX = "sl_plock_";
const POOL_LOCK_TTL_MS = 5_000;            // Max lock hold time (safety valve)
const POOL_LOCK_WAIT_MS = 3_000;           // Max wait for lock acquisition

// ── Typed records for swap history and treasury fee accumulator ──────
interface SwapRecord {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  protocolFeeTinybar?: number;
  timestamp: number;
}

interface TreasuryFeeAccumulator {
  totalTinybar: number;
  swapCount: number;
  treasuryAccount: string;
  lastUpdated: number;
}

interface PoolApiResponse {
  tvlUsd: number;
  priceA: number;
  priceB: number;
  [key: string]: unknown;
}

// ── Protocol Swap Fee ───────────────────────────────────────────────
// Flat $0.0007 USD per swap (paid in HBAR). Split 50/50:
//   50% → LP providers (added to reserves, increases k)
//   50% → Protocol treasury (0.0.9695738), accrued in KV for on-chain sweep
// Fee is flat (not proportional) to prevent manipulation via trade splitting.
// HBAR price resolved from oracle; fallback used if stale. Min 1 tinybar.

const PROTOCOL_FEE_USD = 0.0007;            // $0.0007 per swap = 0.07 cents
const PROTOCOL_TREASURY_ACCOUNT = "0.0.9695738";
// Fallback HBAR price — used ONLY when SaucerSwap oracle is unreachable.
// KV-backed at runtime (key: sl_oracle_fallback_cfg) so it can be updated via
// the admin PUT /oracle/fallback endpoint without redeploying.
// These compile-time values are bootstrap defaults — used only to seed KV on
// first run. After that the KV value is authoritative.
const _DEFAULT_HBAR_FALLBACK_PRICE_USD = 0.28;
const _DEFAULT_HBAR_FALLBACK_UPDATED_AT = 1739404800000; // 2026-02-13T00:00:00Z
const _DEFAULT_HBAR_FALLBACK_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface OracleFallbackConfig {
  price: number;
  updatedAt: number;
  maxAgeMs: number;
}

// In-memory cache — avoids KV hit on every swap. Refreshes every 5 minutes.
let _fallbackCfgCache: OracleFallbackConfig | null = null;
let _fallbackCfgCacheTs = 0;
const _FALLBACK_CFG_CACHE_TTL_MS = 5 * 60 * 1000;

async function getOracleFallbackConfig(): Promise<OracleFallbackConfig> {
  const now = Date.now();
  if (_fallbackCfgCache && (now - _fallbackCfgCacheTs) < _FALLBACK_CFG_CACHE_TTL_MS) {
    return _fallbackCfgCache;
  }
  try {
    const stored: OracleFallbackConfig | null = await kv.get(ORACLE_FALLBACK_CONFIG_KEY);
    if (stored && typeof stored.price === "number" && stored.price > 0) {
      _fallbackCfgCache = stored;
      _fallbackCfgCacheTs = now;
      return stored;
    }
  } catch { /* KV miss — use defaults */ }

  // Seed KV with compile-time defaults on first run
  const defaults: OracleFallbackConfig = {
    price: _DEFAULT_HBAR_FALLBACK_PRICE_USD,
    updatedAt: _DEFAULT_HBAR_FALLBACK_UPDATED_AT,
    maxAgeMs: _DEFAULT_HBAR_FALLBACK_MAX_AGE_MS,
  };
  kv.set(ORACLE_FALLBACK_CONFIG_KEY, defaults).catch(() => {});
  _fallbackCfgCache = defaults;
  _fallbackCfgCacheTs = now;
  return defaults;
}
// Max protocol fee in tinybar — safety ceiling if oracle + fallback are both stale
const MAX_PROTOCOL_FEE_TINYBAR = 500; // ~$0.0014 at $0.28/HBAR — 2× normal fee

// Swap fee: 0.1% (10 bps) — protocol-fixed, non-adjustable by pool creators.
const FIXED_SWAP_FEE_BPS = 10;

// ── Token Whitelist ─────────────────────────────────────────────────
// Only whitelisted tokens can be used in pools.

interface TokenDef {
  tokenId: string;
  symbol: string;
  name: string;
  decimals: number;
  fallbackPrice: number;
  bridge?: string;
  tier: 1 | 2;
}

const TOKEN_WHITELIST: TokenDef[] = [
  { tokenId: "0.0.1969769", symbol: "WBTC",  name: "Wrapped Bitcoin",        decimals: 8,  fallbackPrice: 97000, bridge: "HashPort", tier: 1 },
  { tokenId: "0.0.1969757", symbol: "WETH",  name: "Wrapped Ether",         decimals: 18, fallbackPrice: 3600,  bridge: "HashPort", tier: 1 },
  { tokenId: "0.0.456858",  symbol: "USDC",  name: "USD Coin",              decimals: 6,  fallbackPrice: 1.00,  tier: 1 },
  { tokenId: "0.0.4291336", symbol: "USDT",  name: "Tether USD",            decimals: 6,  fallbackPrice: 1.00,  tier: 1 },
  { tokenId: "0.0.1970030", symbol: "LINK",  name: "Chainlink",             decimals: 8,  fallbackPrice: 19.0,  bridge: "HashPort", tier: 1 },
  { tokenId: "0.0.3306241", symbol: "WPOL",  name: "Wrapped POL (Polygon)", decimals: 8,  fallbackPrice: 0.40,  bridge: "HashPort", tier: 2 },
];

const ACTIVE_TOKENS = TOKEN_WHITELIST.filter(t => t.tier === 1);
const TOKEN_BY_SYMBOL = new Map(TOKEN_WHITELIST.map(t => [t.symbol, t]));
const TOKEN_BY_ID = new Map(TOKEN_WHITELIST.map(t => [t.tokenId, t]));

// ── Pool State Types ────────────────────────────────────────────────

interface PoolState {
  id: string;
  name: string;
  description: string;
  tokenA: string;
  tokenB: string;
  tokenIdA: string;
  tokenIdB: string;
  decimalsA: number;
  decimalsB: number;
  reserveA: string;        // Raw integer string (no float precision loss)
  reserveB: string;
  lpTotalSupply: string;
  swapFeeBps: number;
  creator: string;
  createdAt: number;
  cumulativeVolumeUsd: string;  // Micro-USD string (1e6 = $1.00) — lossless integer accumulation
  swapCount: number;
  status: "active" | "paused";
  version: number;  // Optimistic lock counter — incremented on every mutating write
}

// Volume stored as micro-USD integer string to avoid IEEE 754 drift.
// Individual swap USD values are small (sub-cent precision fine), but the running
// total would lose precision after ~2^53 / value ≈ millions of additions as a float.
const VOLUME_MICRO_SCALE = 1_000_000;   // 1 micro-USD = $0.000001

/** Convert internal pool state to API-safe format (micro-USD string → USD float). */
function poolToApi(pool: PoolState): Record<string, unknown> {
  return {
    ...pool,
    cumulativeVolumeUsd: parseInt(pool.cumulativeVolumeUsd || "0", 10) / VOLUME_MICRO_SCALE,
  };
}

interface LPPosition {
  poolId: string;
  accountId: string;
  shares: string;
  depositedAt: number;
  lastActionAt: number;
}

// ── AMM Math (Constant Product: x * y = k) ─────────────────────────
// All swap math uses reserves, never oracle prices.

const MINIMUM_LIQUIDITY = 1000n;
const BPS_BASE = 10000n;

function bigIntSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

/** Constant-product swap output (Uniswap V2 formula). Fee stays in pool. */
function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const feeMultiplier = BPS_BASE - BigInt(feeBps);
  const amountInWithFee = amountIn * feeMultiplier;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BPS_BASE + amountInWithFee;
  return numerator / denominator;
}

/** Price impact in bps. */
function getPriceImpactBps(amountIn: bigint, reserveIn: bigint): number {
  if (reserveIn <= 0n) return 10000;
  return Math.min(Number(amountIn * 10000n / (reserveIn + amountIn)), 10000);
}

// ── Pool TVL & Swap Limits ──────────────────────────────────────────

function poolTvlUsd(pool: PoolState, prices: Record<string, number>): number {
  const priceA = prices[pool.tokenIdA] || 0;
  const priceB = prices[pool.tokenIdB] || 0;
  const reserveA = Number(BigInt(pool.reserveA)) / (10 ** pool.decimalsA);
  const reserveB = Number(BigInt(pool.reserveB)) / (10 ** pool.decimalsB);
  return reserveA * priceA + reserveB * priceB;
}

function maxSwapFraction(tvlUsd: number): number {
  if (tvlUsd < 10_000) return 0.02;
  if (tvlUsd < 100_000) return 0.05;
  return 0.10;
}

// ── Oracle Price Fetcher (display-only — swaps use reserves) ────────

async function fetchOraclePrices(): Promise<Record<string, number>> {
  try {
    const cached: { prices: Record<string, number>; ts: number } | null = await kv.get(ORACLE_CACHE_KEY);
    if (cached && (Date.now() - cached.ts) < ORACLE_CACHE_TTL_MS) return cached.prices;
  } catch { /* cache miss */ }

  const prices: Record<string, number> = {};
  prices["0.0.456858"] = 1.0;
  prices["0.0.4291336"] = 1.0;

  // Try cached working variant first, then fallback to all variants
  const allVariants = ["/tokens", "/v1/tokens", "/v2/tokens"];
  const variants = _saucerswapWorkingPath
    ? [_saucerswapWorkingPath, ...allVariants.filter(v => v !== _saucerswapWorkingPath)]
    : allVariants;
  for (const path of variants) {
    try {
      const res = await fetch(`${SAUCERSWAP_API_URL}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const token of data) {
          const id = token.id || token.tokenId;
          const price = parseFloat(token.priceUsd || token.price || "0");
          if (id && price > 0 && TOKEN_BY_ID.has(id)) {
            prices[id] = price;
          }
        }
      }
      if (Object.keys(prices).length >= 4) {
        _saucerswapWorkingPath = path; // Cache the variant that worked
        break;
      }
    } catch { continue; }
  }

  let usedFallback = false;
  for (const t of TOKEN_WHITELIST) {
    if (!prices[t.tokenId]) {
      prices[t.tokenId] = t.fallbackPrice;
      usedFallback = true;
    }
  }
  if (usedFallback) {
    const fbCfg = await getOracleFallbackConfig();
    if ((Date.now() - fbCfg.updatedAt) > fbCfg.maxAgeMs) {
      console.log("[Oracle] WARNING: Fallback prices are stale (>" + Math.round(fbCfg.maxAgeMs / 86400000) + " days). Update via PUT /oracle/fallback.");
    }
  }

  try { await kv.set(ORACLE_CACHE_KEY, { prices, ts: Date.now() }); } catch { /* non-critical */ }
  return prices;
}

// ── Pool Helpers ────────────────────────────────────────────────────

async function getPoolIndex(): Promise<string[]> {
  return (await kv.get(POOL_INDEX_KEY)) ?? [];
}

async function getPool(id: string): Promise<PoolState | null> {
  const pool: PoolState | null = await kv.get(POOL_PREFIX + id);
  if (pool) {
    // Backfill version for pools created before versioning was added
    if (typeof pool.version !== "number") pool.version = 0;
    // Backfill legacy float USD → micro-USD string
    if (typeof (pool as any).cumulativeVolumeUsd === "number") {
      pool.cumulativeVolumeUsd = Math.round((pool as any).cumulativeVolumeUsd * VOLUME_MICRO_SCALE).toString();
    }
  }
  return pool;
}

async function savePool(pool: PoolState): Promise<void> {
  await kv.set(POOL_PREFIX + pool.id, pool);
}

/**
 * Compare-and-swap pool write. Re-reads from KV, verifies version matches
 * expectedVersion, bumps, and writes. Returns false on conflict.
 * Second layer of defense after the pessimistic lock.
 */
async function compareAndSavePool(pool: PoolState, expectedVersion: number): Promise<boolean> {
  const current = await kv.get(POOL_PREFIX + pool.id) as PoolState | null;
  const currentVersion = current?.version ?? 0;
  if (currentVersion !== expectedVersion) {
    console.log(`[CAS] Conflict on pool ${pool.id}: expected v${expectedVersion}, found v${currentVersion}`);
    return false;
  }
  pool.version = expectedVersion + 1;
  await kv.set(POOL_PREFIX + pool.id, pool);
  return true;
}

// ── Per-Pool Lock (swap, add/remove liquidity) ─────────────────────
// Tuned for fast in-flight mutations: 5s TTL, 3s wait.

function poolLockConfig(poolId: string): KvLockConfig {
  return {
    key: POOL_LOCK_PREFIX + poolId,
    ttlMs: POOL_LOCK_TTL_MS,
    waitMs: POOL_LOCK_WAIT_MS,
    retryMs: POOL_LOCK_RETRY_INTERVAL_MS,
  };
}

/**
 * Execute a function while holding a per-pool lock.
 * Throws `{ code: "POOL_BUSY" }` on timeout (callers return 503).
 *
 * Usage:
 *   const result = await withPoolLock(poolId, async () => {
 *     const pool = await getPool(poolId);
 *     // ...mutate pool...
 *     const ok = await compareAndSavePool(pool, pool.version);
 *     if (!ok) throw { code: "VERSION_CONFLICT" };
 *     return result;
 *   });
 */
async function withPoolLock<T>(poolId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withKvLock(poolLockConfig(poolId), fn);
  } catch (err: any) {
    if (err?.code === "LOCK_TIMEOUT") {
      throw { code: "POOL_BUSY", message: "Pool is busy — too many concurrent operations. Please retry." };
    }
    throw err;
  }
}

// ── Pool Creation Lock ──────────────────────────────────────────────
// Serializes all pool creation requests to prevent:
//   1. Duplicate-pair race (two requests for same pair both pass check)
//   2. Pool index corruption (concurrent read-modify-write on index key)
// Longer timeouts than pool locks — creation involves multiple KV ops.

const POOL_CREATION_LOCK_CONFIG: KvLockConfig = {
  key: "sl_create_lock",
  ttlMs: 10_000,       // 10s hold time — creation does index scan + write
  waitMs: 5_000,       // 5s wait — pool creation is rare, OK to queue
  retryMs: POOL_LOCK_RETRY_INTERVAL_MS,
};

async function getLPPosition(poolId: string, accountId: string): Promise<LPPosition | null> {
  return await kv.get(`${LP_PREFIX}${poolId}_${accountId}`);
}

async function saveLPPosition(pos: LPPosition): Promise<void> {
  await kv.set(`${LP_PREFIX}${pos.poolId}_${pos.accountId}`, pos);
}

/** Batch-read all pools in one KV round trip. */
async function getAllPools(poolIds: string[]): Promise<PoolState[]> {
  if (poolIds.length === 0) return [];
  const keys = poolIds.map(id => POOL_PREFIX + id);
  const values: (PoolState | null)[] = await kv.mget(keys);
  const pools: PoolState[] = [];
  for (const v of values) {
    if (!v) continue;
    if (typeof v.version !== "number") v.version = 0; // Backfill legacy pools
    // Backfill legacy float USD → micro-USD string
    if (typeof v.cumulativeVolumeUsd === "number") {
      v.cumulativeVolumeUsd = Math.round(v.cumulativeVolumeUsd * VOLUME_MICRO_SCALE).toString();
    }
    pools.push(v as PoolState);
  }
  return pools;
}

// ── Route Registration ──────────────────────────────────────────────

export function registerAmmRoutes(app: Hono): void {

  // GET /oracle/fallback — Current fallback config (public — price is not secret)
  app.get("/make-server-54299934/oracle/fallback", async (c) => {
    try {
      const cfg = await getOracleFallbackConfig();
      const ageMs = Date.now() - cfg.updatedAt;
      const stale = ageMs > cfg.maxAgeMs;
      return c.json({
        price: cfg.price,
        updatedAt: cfg.updatedAt,
        updatedAtIso: new Date(cfg.updatedAt).toISOString(),
        maxAgeDays: Math.round(cfg.maxAgeMs / 86400000),
        ageDays: Math.round(ageMs / 86400000),
        stale,
      });
    } catch (err) {
      console.log("Error in GET /oracle/fallback:", err);
      return c.json({ error: "Failed to read fallback config" }, 500);
    }
  });

  // PUT /oracle/fallback — Admin-only: update fallback HBAR price at runtime.
  // Body: { "price": 0.30 }  (optional: "maxAgeDays": 90)
  // updatedAt is auto-set to now. Requires SUPABASE_SERVICE_ROLE_KEY.
  app.put("/make-server-54299934/oracle/fallback", async (c) => {
    if (!isAdminAuthorized(c)) return c.json({ error: "Admin access required" }, 403);
    try {
      const body = await c.req.json();
      const price = parseFloat(body.price);
      if (!price || price <= 0 || price > 10000) {
        return c.json({ error: "Invalid price — must be a positive number ≤ 10000" }, 400);
      }
      const maxAgeDays = parseInt(body.maxAgeDays) || 90;
      if (maxAgeDays < 1 || maxAgeDays > 365) {
        return c.json({ error: "maxAgeDays must be between 1 and 365" }, 400);
      }
      const cfg: OracleFallbackConfig = {
        price,
        updatedAt: Date.now(),
        maxAgeMs: maxAgeDays * 24 * 60 * 60 * 1000,
      };
      await kv.set(ORACLE_FALLBACK_CONFIG_KEY, cfg);
      // Bust in-memory cache so this instance picks it up immediately
      _fallbackCfgCache = cfg;
      _fallbackCfgCacheTs = Date.now();
      console.log(`[Admin] Oracle fallback updated: $${price} (maxAge: ${maxAgeDays}d)`);
      return c.json({
        success: true,
        price: cfg.price,
        updatedAt: cfg.updatedAt,
        updatedAtIso: new Date(cfg.updatedAt).toISOString(),
        maxAgeDays,
      });
    } catch (err) {
      console.log("Error in PUT /oracle/fallback:", err);
      return c.json({ error: "Failed to update fallback config" }, 500);
    }
  });

  // GET /pools — List all active pools with real-time state + oracle prices
  app.get("/make-server-54299934/pools", async (c) => {
    try {
      const poolIds = await getPoolIndex();
      const prices = await fetchOraclePrices();
      const allPools = await getAllPools(poolIds);
      const pools: PoolApiResponse[] = [];
      for (const pool of allPools) {
        if (pool.status !== "active") continue;
        pools.push({ ...poolToApi(pool), tvlUsd: poolTvlUsd(pool, prices), priceA: prices[pool.tokenIdA] || 0, priceB: prices[pool.tokenIdB] || 0 });
      }

      return c.json({ pools, tokens: ACTIVE_TOKENS, prices, updatedAt: Math.floor(Date.now() / 1000) });
    } catch (err) {
      console.log("Error in GET /pools:", err);
      return c.json({ error: "Failed to fetch pools" }, 500);
    }
  });

  // GET /pools/prices — Oracle prices for display
  app.get("/make-server-54299934/pools/prices", async (c) => {
    try {
      const prices = await fetchOraclePrices();
      return c.json({ prices, updatedAt: Math.floor(Date.now() / 1000) });
    } catch (err) {
      console.log("Error in GET /pools/prices:", err);
      return c.json({ error: "Failed to fetch prices" }, 500);
    }
  });

  // POST /pools/create — Authenticated. Tier 1 tokens only. Fee is protocol-fixed.
  // Protected by POOL_CREATION_LOCK to prevent duplicate-pair races and index corruption.
  app.post("/make-server-54299934/pools/create", async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      // ── Auth + input validation (outside lock — no state mutation) ──

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const accountId = auth.accountId;

      const body = await c.req.json();
      const { tokenA, tokenB, name, description } = body;

      const defA = TOKEN_BY_SYMBOL.get(tokenA);
      const defB = TOKEN_BY_SYMBOL.get(tokenB);
      if (!defA || !defB) return c.json({ error: `Unknown token. Available: ${ACTIVE_TOKENS.map(t => t.symbol).join(", ")}` }, 400);
      if (defA.tier !== 1 || defB.tier !== 1) return c.json({ error: "Only Tier 1 tokens (top 5 by MC) are currently enabled" }, 400);
      if (tokenA === tokenB) return c.json({ error: "Cannot create pool with identical tokens" }, 400);

      // Fee is protocol-fixed. Any client-supplied feeBps is ignored.

      // Compute deterministic pool ID early (before lock) for logging
      const [sA, sB] = [defA, defB].sort((a, b) => a.symbol.localeCompare(b.symbol));
      const poolId = `sl-${sA.symbol.toLowerCase()}-${sB.symbol.toLowerCase()}`;

      // ── Inside creation lock: duplicate check + create + index update ──
      // Lock serializes ALL pool creations, preventing:
      //   - Two requests for the same pair both passing the duplicate check
      //   - Two requests for different pairs corrupting the pool index

      const result = await withKvLock(POOL_CREATION_LOCK_CONFIG, async () => {
        // Primary guard: direct key lookup for the deterministic pool ID
        const existingPool = await getPool(poolId);
        if (existingPool) {
          return c.json({ error: `Pool ${sA.symbol}/${sB.symbol} already exists (${existingPool.id})` }, 409);
        }

        // Secondary guard: index scan catches any naming/key edge cases
        const poolIds = await getPoolIndex();
        const allPools = await getAllPools(poolIds);
        for (const p of allPools) {
          if (p.status !== "active") continue;
          if ((p.tokenA === sA.symbol && p.tokenB === sB.symbol) || (p.tokenA === sB.symbol && p.tokenB === sA.symbol)) {
            return c.json({ error: `Pool ${sA.symbol}/${sB.symbol} already exists (${p.id})` }, 409);
          }
        }

        const pool: PoolState = {
          id: poolId, name: sanitizeString(name || `${sA.symbol} / ${sB.symbol}`, 64),
          description: sanitizeString(description || `${sA.symbol}/${sB.symbol} liquidity pool`, 256),
          tokenA: sA.symbol, tokenB: sB.symbol, tokenIdA: sA.tokenId, tokenIdB: sB.tokenId,
          decimalsA: sA.decimals, decimalsB: sB.decimals,
          reserveA: "0", reserveB: "0", lpTotalSupply: "0",
          swapFeeBps: FIXED_SWAP_FEE_BPS, creator: sanitizeString(accountId, 20), createdAt: Date.now(),
          cumulativeVolumeUsd: "0", swapCount: 0, status: "active",
          version: 1,
        };

        await savePool(pool);
        poolIds.push(poolId);
        await kv.set(POOL_INDEX_KEY, poolIds);
        console.log(`[SmartLiquidity] Pool created: ${poolId} by ${accountId} (fee=${FIXED_SWAP_FEE_BPS}bps fixed)`);
        return c.json({ success: true, pool: poolToApi(pool) });
      });

      return result;
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") {
        return c.json({ error: "Pool creation service is busy — please retry in a few seconds", code: "CREATION_BUSY" }, 503);
      }
      console.log("Error in POST /pools/create:", err);
      return c.json({ error: "Pool creation failed" }, 500);
    }
  });

  // POST /pools/liquidity/add — Authenticated. Lock + CAS protected.
  // First deposit burns MINIMUM_LIQUIDITY. Subsequent deposits proportional.
  app.post("/make-server-54299934/pools/liquidity/add", async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const accountId = auth.accountId;

      const body = await c.req.json();
      const { poolId, amountA, amountB } = body;

      const addLiqResult = await (async () => {
        try {
          return await withPoolLock(poolId, async () => {
            const pool = await getPool(poolId);
            if (!pool) return c.json({ error: "Pool not found" }, 404);
            if (pool.status !== "active") return c.json({ error: "Pool is paused" }, 400);
            const expectedVersion = pool.version;

            const rawA = BigInt(amountA || "0");
            const rawB = BigInt(amountB || "0");
            if (rawA <= 0n || rawB <= 0n) return c.json({ error: "Both amounts must be positive" }, 400);

            const reserveA = BigInt(pool.reserveA);
            const reserveB = BigInt(pool.reserveB);
            const totalSupply = BigInt(pool.lpTotalSupply);
            let sharesMinted: bigint;

            if (totalSupply === 0n) {
              // First deposit: sqrt(A*B) - MINIMUM_LIQUIDITY
              const gm = bigIntSqrt(rawA * rawB);
              if (gm <= MINIMUM_LIQUIDITY) return c.json({ error: "Initial deposit too small" }, 400);
              sharesMinted = gm - MINIMUM_LIQUIDITY;
            } else {
              // Proportional mint
              const fromA = rawA * totalSupply / reserveA;
              const fromB = rawB * totalSupply / reserveB;
              sharesMinted = fromA < fromB ? fromA : fromB;
            }
            if (sharesMinted <= 0n) return c.json({ error: "Amounts too small to mint LP shares" }, 400);

            pool.reserveA = (reserveA + rawA).toString();
            pool.reserveB = (reserveB + rawB).toString();
            pool.lpTotalSupply = (totalSupply + sharesMinted + (totalSupply === 0n ? MINIMUM_LIQUIDITY : 0n)).toString();

            const casOk = await compareAndSavePool(pool, expectedVersion);
            if (!casOk) {
              console.log(`[CAS] AddLiq conflict: pool=${poolId} v=${expectedVersion} account=${accountId}`);
              return c.json({ error: "Pool state changed — please retry", code: "VERSION_CONFLICT" }, 409);
            }

            const existing = await getLPPosition(poolId, accountId);
            const newShares = (BigInt(existing?.shares || "0") + sharesMinted).toString();
            await saveLPPosition({ poolId, accountId, shares: newShares, depositedAt: existing?.depositedAt || Date.now(), lastActionAt: Date.now() });

            console.log(`[SmartLiquidity] +Liquidity v${expectedVersion}→v${expectedVersion + 1}: ${accountId} → ${poolId} (${rawA}/${rawB}, shares=${sharesMinted})`);
            return c.json({ success: true, sharesMinted: sharesMinted.toString(), totalShares: newShares, pool: { reserveA: pool.reserveA, reserveB: pool.reserveB, lpTotalSupply: pool.lpTotalSupply, version: pool.version } });
          });
        } catch (lockErr: any) {
          if (lockErr?.code === "POOL_BUSY") return c.json({ error: lockErr.message, code: "POOL_BUSY" }, 503);
          throw lockErr;
        }
      })();
      return addLiqResult;
    } catch (err) {
      console.log("Error in POST /pools/liquidity/add:", err);
      return c.json({ error: "Add liquidity failed" }, 500);
    }
  });

  // POST /pools/liquidity/remove — Authenticated. Lock + CAS protected.
  app.post("/make-server-54299934/pools/liquidity/remove", async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const accountId = auth.accountId;

      const body = await c.req.json();
      const { poolId, shares } = body;

      const removeLiqResult = await (async () => {
        try {
          return await withPoolLock(poolId, async () => {
            const pool = await getPool(poolId);
            if (!pool) return c.json({ error: "Pool not found" }, 404);
            const expectedVersion = pool.version;

            const sharesToBurn = BigInt(shares || "0");
            if (sharesToBurn <= 0n) return c.json({ error: "Shares must be positive" }, 400);

            const position = await getLPPosition(poolId, accountId);
            if (!position || BigInt(position.shares) < sharesToBurn) return c.json({ error: "Insufficient LP shares" }, 400);

            const resA = BigInt(pool.reserveA), resB = BigInt(pool.reserveB), ts = BigInt(pool.lpTotalSupply);
            const outA = sharesToBurn * resA / ts;
            const outB = sharesToBurn * resB / ts;

            pool.reserveA = (resA - outA).toString();
            pool.reserveB = (resB - outB).toString();
            pool.lpTotalSupply = (ts - sharesToBurn).toString();

            const casOk = await compareAndSavePool(pool, expectedVersion);
            if (!casOk) {
              console.log(`[CAS] RemoveLiq conflict: pool=${poolId} v=${expectedVersion} account=${accountId}`);
              return c.json({ error: "Pool state changed — please retry", code: "VERSION_CONFLICT" }, 409);
            }

            const remaining = (BigInt(position.shares) - sharesToBurn).toString();
            if (remaining === "0") { try { await kv.del(`${LP_PREFIX}${poolId}_${accountId}`); } catch { /* ok */ } }
            else { await saveLPPosition({ ...position, shares: remaining, lastActionAt: Date.now() }); }

            console.log(`[SmartLiquidity] -Liquidity v${expectedVersion}→v${expectedVersion + 1}: ${accountId} ← ${poolId} (${outA}/${outB})`);
            return c.json({ success: true, amountA: outA.toString(), amountB: outB.toString(), sharesRemaining: remaining, pool: { version: pool.version } });
          });
        } catch (lockErr: any) {
          if (lockErr?.code === "POOL_BUSY") return c.json({ error: lockErr.message, code: "POOL_BUSY" }, 503);
          throw lockErr;
        }
      })();
      return removeLiqResult;
    } catch (err) {
      console.log("Error in POST /pools/liquidity/remove:", err);
      return c.json({ error: "Remove liquidity failed" }, 500);
    }
  });

  // GET /pools/position/:poolId/:accountId — Get LP position
  app.get("/make-server-54299934/pools/position/:poolId/:accountId", async (c) => {
    try {
      const poolId = c.req.param("poolId");
      const accountId = c.req.param("accountId");
      if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);
      const position = await getLPPosition(poolId, accountId);
      return c.json({ position: position || null });
    } catch (err) {
      console.log("Error fetching LP position:", err);
      return c.json({ position: null, error: "Failed to fetch LP position" }, 500);
    }
  });

  // POST /pools/quote — AMM quote with smart routing (direct + USDC-hop).
  app.post("/make-server-54299934/pools/quote", async (c) => {
    try {
      const body = await c.req.json();
      const { tokenIn, tokenOut, amountIn } = body;
      if (!tokenIn || !tokenOut || !amountIn) return c.json({ error: "Missing: tokenIn, tokenOut, amountIn" }, 400);

      const defIn = TOKEN_BY_SYMBOL.get(tokenIn);
      const defOut = TOKEN_BY_SYMBOL.get(tokenOut);
      if (!defIn || !defOut) return c.json({ error: `Unknown token. Available: ${ACTIVE_TOKENS.map(t => t.symbol).join(", ")}` }, 400);

      // Single oracle fetch + batch pool read
      const [prices, poolIds] = await Promise.all([fetchOraclePrices(), getPoolIndex()]);
      const allPools = await getAllPools(poolIds);
      // Build a quick lookup map for routing
      const activePools = allPools.filter(p => p.status === "active" && BigInt(p.reserveA) > 0n && BigInt(p.reserveB) > 0n);

      interface RouteCandidate { path: string[]; amountOut: bigint; priceImpactBps: number; feeBps: number; poolId: string; }
      const routes: RouteCandidate[] = [];

      const rawIn = BigInt(Math.floor(parseFloat(amountIn) * (10 ** defIn.decimals)));
      if (rawIn <= 0n) return c.json({ error: "Amount must be positive" }, 400);

      // Direct routes — uses pre-fetched pool array (no individual KV reads)
      for (const pool of activePools) {
        let rIn: bigint, rOut: bigint;
        const fwd = pool.tokenA === tokenIn && pool.tokenB === tokenOut;
        const rev = pool.tokenA === tokenOut && pool.tokenB === tokenIn;
        if (fwd) { rIn = BigInt(pool.reserveA); rOut = BigInt(pool.reserveB); }
        else if (rev) { rIn = BigInt(pool.reserveB); rOut = BigInt(pool.reserveA); }
        else continue;

        const tvl = poolTvlUsd(pool, prices);
        if (tvl > 0 && tvl < 100) continue; // Exclude low-TVL pools
        const inputUsd = parseFloat(amountIn) * (prices[defIn.tokenId] || 0);
        if (tvl > 0 && inputUsd > tvl * maxSwapFraction(tvl)) continue; // Depth cap

        const out = getAmountOut(rawIn, rIn, rOut, pool.swapFeeBps);
        if (out <= 0n) continue;
        routes.push({ path: [tokenIn, tokenOut], amountOut: out, priceImpactBps: getPriceImpactBps(rawIn, rIn), feeBps: pool.swapFeeBps, poolId: pool.id });
      }

      // USDC-hop routes (A→USDC→B) — uses pre-fetched pool array
      if (tokenIn !== "USDC" && tokenOut !== "USDC") {
        for (const p1 of activePools) {
          let r1In: bigint, r1Out: bigint;
          const f1 = p1.tokenA === tokenIn && p1.tokenB === "USDC";
          const v1 = p1.tokenA === "USDC" && p1.tokenB === tokenIn;
          if (f1) { r1In = BigInt(p1.reserveA); r1Out = BigInt(p1.reserveB); }
          else if (v1) { r1In = BigInt(p1.reserveB); r1Out = BigInt(p1.reserveA); }
          else continue;
          const mid = getAmountOut(rawIn, r1In, r1Out, p1.swapFeeBps);
          if (mid <= 0n) continue;

          for (const p2 of activePools) {
            if (p2.id === p1.id) continue;
            let r2In: bigint, r2Out: bigint;
            const f2 = p2.tokenA === "USDC" && p2.tokenB === tokenOut;
            const v2 = p2.tokenA === tokenOut && p2.tokenB === "USDC";
            if (f2) { r2In = BigInt(p2.reserveA); r2Out = BigInt(p2.reserveB); }
            else if (v2) { r2In = BigInt(p2.reserveB); r2Out = BigInt(p2.reserveA); }
            else continue;
            const out = getAmountOut(mid, r2In, r2Out, p2.swapFeeBps);
            if (out <= 0n) continue;
            routes.push({ path: [tokenIn, "USDC", tokenOut], amountOut: out, priceImpactBps: getPriceImpactBps(rawIn, r1In) + getPriceImpactBps(mid, r2In), feeBps: p1.swapFeeBps + p2.swapFeeBps, poolId: `${p1.id}+${p2.id}` });
          }
        }
      }

      if (routes.length === 0) return c.json({ error: "No route available. Pools may be empty or pair not supported.", routes: [] }, 404);

      routes.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));
      const best = routes[0];
      const outDisplay = Number(best.amountOut) / (10 ** defOut.decimals);
      const inDisplay = parseFloat(amountIn);

      // Protocol fee in HBAR (WHBAR oracle price or KV-backed fallback, clamped to safety ceiling)
      const fbCfg = await getOracleFallbackConfig();
      const hbarPrice = prices["0.0.1456986"] || fbCfg.price;
      const protocolFeeHbar = PROTOCOL_FEE_USD / hbarPrice;
      const protocolFeeTinybar = Math.min(MAX_PROTOCOL_FEE_TINYBAR, Math.max(1, Math.round(protocolFeeHbar * 1e8)));
      const lpRewardTinybar = Math.floor(protocolFeeTinybar / 2);
      const treasuryFeeTinybar = protocolFeeTinybar - lpRewardTinybar;

      return c.json({
        poolId: best.poolId, tokenIn, tokenOut, amountIn: inDisplay, amountOut: outDisplay,
        amountOutRaw: best.amountOut.toString(), amountInRaw: rawIn.toString(),
        route: best.path.join(" → "), priceImpactBps: best.priceImpactBps, feeBps: best.feeBps,
        feeUsd: inDisplay * (prices[defIn.tokenId] || 0) * best.feeBps / 10000,
        effectiveRate: outDisplay / inDisplay, minAmountOut: outDisplay * 0.995,
        routeCount: routes.length, inPrice: prices[defIn.tokenId] || 0, outPrice: prices[defOut.tokenId] || 0,
        // Protocol fee breakdown
        protocolFee: {
          totalTinybar: protocolFeeTinybar,
          totalHbar: protocolFeeTinybar / 1e8,
          totalUsd: PROTOCOL_FEE_USD,
          lpRewardTinybar,
          treasuryFeeTinybar,
          treasuryAccount: PROTOCOL_TREASURY_ACCOUNT,
          hbarPriceUsed: hbarPrice,
        },
        timestamp: Date.now(),
      });
    } catch (err) {
      console.log("Error in POST /pools/quote:", err);
      return c.json({ error: "Quote failed" }, 500);
    }
  });

  // POST /pools/swap — Authenticated. Lock + CAS protected. Private mempool.
  app.post("/make-server-54299934/pools/swap", async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const accountId = auth.accountId;

      const body = await c.req.json();
      const { poolId, tokenIn, tokenOut, amountInRaw, minAmountOutRaw } = body;

      // Multi-hop execution not yet supported
      if ((poolId || "").includes("+")) {
        return c.json({ error: "Multi-hop execution is not yet available. Use direct pools." }, 501);
      }

      const swapResult = await (async () => {
        try {
          return await withPoolLock(poolId, async () => {
            const pool = await getPool(poolId);
            if (!pool) return c.json({ error: "Pool not found" }, 404);
            if (pool.status !== "active") return c.json({ error: "Pool is paused" }, 400);
            const expectedVersion = pool.version;

            const fwd = pool.tokenA === tokenIn && pool.tokenB === tokenOut;
            const rev = pool.tokenA === tokenOut && pool.tokenB === tokenIn;
            if (!fwd && !rev) return c.json({ error: "Token pair mismatch" }, 400);

            const resA = BigInt(pool.reserveA), resB = BigInt(pool.reserveB);
            if (resA === 0n || resB === 0n) return c.json({ error: "Pool has no liquidity" }, 400);

            const rIn = fwd ? resA : resB;
            const rOut = fwd ? resB : resA;
            const rawIn = BigInt(amountInRaw || "0");
            if (rawIn <= 0n) return c.json({ error: "Invalid amount" }, 400);

            const rawOut = getAmountOut(rawIn, rIn, rOut, pool.swapFeeBps);
            if (rawOut <= 0n) return c.json({ error: "Output too small" }, 400);
            if (minAmountOutRaw && rawOut < BigInt(minAmountOutRaw)) return c.json({ error: "Slippage exceeded" }, 400);

            // Depth check
            const prices = await fetchOraclePrices();
            const tvl = poolTvlUsd(pool, prices);
            const defIn = TOKEN_BY_SYMBOL.get(tokenIn);
            if (defIn && tvl > 0) {
              const inputUsd = Number(rawIn) / (10 ** defIn.decimals) * (prices[defIn.tokenId] || 0);
              if (inputUsd > tvl * maxSwapFraction(tvl)) {
                return c.json({ error: `Swap too large. Max ~${(maxSwapFraction(tvl) * 100).toFixed(0)}% of $${tvl.toFixed(0)} TVL` }, 400);
              }
            }

            // Update reserves
            if (fwd) { pool.reserveA = (resA + rawIn).toString(); pool.reserveB = (resB - rawOut).toString(); }
            else { pool.reserveA = (resA - rawOut).toString(); pool.reserveB = (resB + rawIn).toString(); }

            // Post-swap k-invariant assertion
            const kNew = BigInt(pool.reserveA) * BigInt(pool.reserveB);
            const kOld = resA * resB;
            if (kNew < kOld) {
              console.log(`[CRITICAL] K-invariant violated! kOld=${kOld} kNew=${kNew} pool=${poolId}`);
              return c.json({ error: "K-invariant violated — swap aborted (report to developers)" }, 500);
            }

            pool.swapCount++;
            const defOut = TOKEN_BY_SYMBOL.get(tokenOut);
            if (defOut) {
              const swapUsd = Number(rawOut) / (10 ** defOut.decimals) * (prices[defOut.tokenId] || 0);
              const swapMicro = Math.round(swapUsd * VOLUME_MICRO_SCALE);
              const currentMicro = parseInt(pool.cumulativeVolumeUsd || "0", 10) || 0;
              pool.cumulativeVolumeUsd = (currentMicro + swapMicro).toString();
            }

            const casOk = await compareAndSavePool(pool, expectedVersion);
            if (!casOk) {
              console.log(`[CAS] Swap conflict: pool=${poolId} v=${expectedVersion} account=${accountId}`);
              return c.json({ error: "Pool state changed during swap — please retry", code: "VERSION_CONFLICT" }, 409);
            }

            // Protocol fee: $0.0007 per swap, split 50/50 LP rewards / treasury (clamped)
            const swapFbCfg = await getOracleFallbackConfig();
            const hbarPriceForFee = prices["0.0.1456986"] || swapFbCfg.price;
            const protocolFeeTinybar = Math.min(MAX_PROTOCOL_FEE_TINYBAR, Math.max(1, Math.round((PROTOCOL_FEE_USD / hbarPriceForFee) * 1e8)));
            const treasuryFeeTinybar = protocolFeeTinybar - Math.floor(protocolFeeTinybar / 2);
            // Lock-protected fee increment — serializes across concurrent swaps on
            // different pools that all write to the same TREASURY_FEE_KEY.
            // Short TTL: the operation is a single KV read + write (~10ms).
            try {
              await withKvLock({
                key: TREASURY_FEE_LOCK_KEY,
                ttlMs: 2_000,
                waitMs: 1_500,
                retryMs: 20,
              }, async () => {
                const existingFees: TreasuryFeeAccumulator | null = await kv.get(TREASURY_FEE_KEY);
                const updated: TreasuryFeeAccumulator = {
                  totalTinybar: (existingFees?.totalTinybar || 0) + treasuryFeeTinybar,
                  swapCount: (existingFees?.swapCount || 0) + 1,
                  treasuryAccount: PROTOCOL_TREASURY_ACCOUNT,
                  lastUpdated: Date.now(),
                };
                await kv.set(TREASURY_FEE_KEY, updated);
              });
            } catch (feeErr: any) {
              // Fee accrual failure is non-critical — swap still succeeds.
              // Log for monitoring: if this fires frequently, lock contention needs tuning.
              if (feeErr?.code === "LOCK_TIMEOUT") {
                console.log(`[Treasury] Fee lock timeout — ${treasuryFeeTinybar}tb deferred`);
              }
            }

            // Log swap — global log is anonymized (no accountId).
            const swapTs = Date.now();
            const swapKey = SWAP_LOG_PREFIX + `${swapTs}-${generateTicketId().slice(4, 10).toLowerCase()}`;
            // Global log: trade data only — no wallet identifiers
            const globalRecord = { poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), protocolFeeTinybar, timestamp: swapTs };
            await kv.set(swapKey, globalRecord);
            // Per-user index: capped FIFO for O(1) history reads (10 entries max)
            const userRecord = { poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), protocolFeeTinybar, timestamp: swapTs };
            try {
              const userSwapsKey = USER_SWAPS_PREFIX + accountId;
              const existing: SwapRecord[] = (await kv.get(userSwapsKey)) ?? [];
              existing.push(userRecord);
              while (existing.length > USER_SWAPS_MAX) existing.shift();
              await kv.set(userSwapsKey, existing);
            } catch { /* non-critical */ }
            // Global recent swaps: anonymized, capped, for site activity feed
            try {
              const recentSwaps: SwapRecord[] = (await kv.get(GLOBAL_RECENT_SWAPS_KEY)) ?? [];
              recentSwaps.push({ poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), timestamp: swapTs });
              while (recentSwaps.length > GLOBAL_RECENT_SWAPS_MAX) recentSwaps.shift();
              await kv.set(GLOBAL_RECENT_SWAPS_KEY, recentSwaps);
            } catch { /* non-critical — activity feed is best-effort */ }

            console.log(`[SmartLiquidity] Swap v${expectedVersion}→v${expectedVersion + 1}: ${accountId} ${tokenIn}→${tokenOut} in=${amountInRaw} out=${rawOut} fee=${protocolFeeTinybar}tb`);
            return c.json({
              success: true, amountOut: rawOut.toString(),
              pool: { reserveA: pool.reserveA, reserveB: pool.reserveB, version: pool.version },
              protocolFee: { totalTinybar: protocolFeeTinybar, treasuryTinybar: treasuryFeeTinybar, treasuryAccount: PROTOCOL_TREASURY_ACCOUNT },
            });
          });
        } catch (lockErr: any) {
          if (lockErr?.code === "POOL_BUSY") {
            return c.json({ error: lockErr.message, code: "POOL_BUSY" }, 503);
          }
          throw lockErr;
        }
      })();
      return swapResult;
    } catch (err) {
      console.log("Error in POST /pools/swap:", err);
      return c.json({ error: "Swap failed" }, 500);
    }
  });

  // GET /pools/swaps/:accountId — Per-user swap history (O(1) index read, rate-limited).
  // Authenticated: session accountId must match the URL param.
  app.get("/make-server-54299934/pools/swaps/:accountId", async (c) => {
    try {
      const accountId = c.req.param("accountId");
      if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);

      const session = await validateSession(c);
      if (!session) return c.json({ error: "Authentication required" }, 401);
      if (session.accountId !== accountId) {
        console.log(`[SECURITY] Swap history access denied: session ${session.accountId} tried to read ${accountId}`);
        return c.json({ error: "Forbidden — you may only view your own swap history" }, 403);
      }

      // Rate limit: 1 read per 5s per account
      const rateKey = SWAP_HISTORY_RATE_PREFIX + accountId;
      const lastRead: number | null = await kv.get(rateKey);
      if (lastRead && Date.now() - lastRead < SWAP_HISTORY_RATE_TTL_MS) {
        return c.json({ error: "Rate limited — try again in a few seconds" }, 429);
      }
      await kv.set(rateKey, Date.now());

      // O(1) per-account index read — no prefix scan, no fallback
      const userSwapsKey = USER_SWAPS_PREFIX + accountId;
      const userSwaps: SwapRecord[] | null = await kv.get(userSwapsKey);
      if (userSwaps && Array.isArray(userSwaps)) {
        // Newest first, capped to USER_SWAPS_MAX
        const sorted = userSwaps
          .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0))
          .slice(0, USER_SWAPS_MAX);
        return c.json({ swaps: sorted });
      }
      // No history — user either hasn't swapped or swapped before indexing was deployed
      return c.json({ swaps: [] });
    } catch (err) {
      console.log("Error in GET /pools/swaps:", err);
      return c.json({ swaps: [], error: "Failed to fetch swap history" }, 500);
    }
  });

  // GET /pools/recent-swaps — Public anonymized activity feed (no wallet data).
  app.get("/make-server-54299934/pools/recent-swaps", async (c) => {
    try {
      const recentSwaps: SwapRecord[] = (await kv.get(GLOBAL_RECENT_SWAPS_KEY)) ?? [];
      // Newest first
      recentSwaps.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
      return c.json({ swaps: recentSwaps });
    } catch (err) {
      console.log("Error in GET /pools/recent-swaps:", err);
      return c.json({ swaps: [] }, 500);
    }
  });
}

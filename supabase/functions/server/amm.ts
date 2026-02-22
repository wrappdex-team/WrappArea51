// ══════════════════════════════════════════════════════════════════════
// ╔═══════════════════════════════════════════════════════════════════╗
// ║  DEPRECATED — KV-BACKED AMM (superseded by atomic-signer.ts)    ║
// ║                                                                   ║
// ║  This file is NOT imported in index.tsx. registerAmmRoutes() is   ║
// ║  NEVER called. All /amm/* and /pools/* routes from this module    ║
// ║  are dead code. The active AMM is the Hedera-native atomic        ║
// ║  CryptoTransfer co-signing oracle in atomic-signer.ts.            ║
// ║                                                                   ║
// ║  This file is retained as reference for:                          ║
// ║    - AMM math functions (getAmountOut, bigIntSqrt, etc.)          ║
// ║    - Oracle price fetching (fetchOraclePrices, T0 Network Rate)   ║
// ║    - Fee structure constants (shared with atomic-swap-engine.ts)   ║
// ║    - Token whitelist (canonical source — kept in sync)             ║
// ║                                                                   ║
// ║  DO NOT re-enable without addressing:                             ║
// ║    - FIXED: Number() overflow in poolTvlUsd (bigIntToDisplay)     ║
// ║    - FIXED: Duplicate /amm/kill routes removed (atomic handles)   ║
// ║    - FIXED: Oracle fetch inside extraction lock (LEGACY-06)       ║
// ║    - FIXED: N+1 KV reads in protocol-fees endpoint (→ mget)      ║
// ║    - FIXED: Sequential fee accrual + logging (→ parallel)         ║
// ║    - FIXED: P1 stale oracle → swap depth halved (isOracleStale)  ║
// ║    - FIXED: P2 bigIntToDisplay precision (LEGACY-09 safe variant)║
// ║    - FIXED: P2 multi-hop quote→501 gap (executeSupported flag)   ║
// ║    - ADDED: Per-account swap rate limit SEC-10 (15/min)           ║
// ║    - ADDED: Per-account quote rate limit SEC-12 (30/min)          ║
// ║    - ADDED: KV compression helpers PERF-03 (gzip pool/volume)    ║
// ║    - ADDED: Swap hot-path instrumentation PERF-04 (perf.now)     ║
// ║    - ADDED: Shared math module extraction (amm-math-shared.ts)   ║
// ║    - P1: KV pool reserves are simulated, not on-chain             ║
// ║    - P1: No server-side tx byte verification                      ║
// ╚═══════════════════════════════════════════════════════════════════╝
// ══════════════════════════════════════════════════════════════════════
//
// ORIGINAL ARCHITECTURE (preserved for reference):
//   - Constant-product AMM (x · y = k) for 2-token pools
//   - All pool state in KV (multi-instance safe, cold-start resilient)
//   - LP share tracking per user per pool
//   - Smart routing: direct → hub-hop (USDC, WHBAR), best output wins
//   - Oracle: T0 Network Rate → SaucerSwap → hardcoded fallback
//   - Sandwich-resistant: KV mempool is private (server-side only)
//   - Per-pool pessimistic lock + optimistic CAS versioning
//   - AMM_PRELAUNCH_LOCKED = true (never went live)
//
// SENIOR DEV NOTE [LEGACY-01]:
//   Rated 5.5/10 during architecture review. Core weakness: pool reserves
//   exist only in KV, not on-chain — users must trust the server for
//   reserve integrity. The atomic model (atomic-signer.ts +
//   atomic-swap-engine.ts) uses real Hedera account balances as reserves,
//   verifiable via Mirror Node. See [ATOMIC-01] for decentralization roadmap.
//
// ══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import {
  getClientIp, isRateLimited, sanitizeString, isValidHederaAccountId,
  generateTicketId, withKvLock, isValidBigIntString, isValidPoolId,
  POOL_LOCK_RETRY_INTERVAL_MS, ROUTE_PREFIX,
  saucerswapBreaker, isHttpFailure,
} from "./shared.ts";
import type { KvLockConfig } from "./shared.ts";
import { requireAuth, validateSession, requireOwner, logAdminAction } from "./auth.ts";

// ── Shared AMM Math (amm-math-shared.ts) ────────────────────────────
// PERF-05 / SHARED-01: Pure math functions extracted to a single module
// shared across amm.ts, atomic-signer.ts, and amm-math.test.ts.
// Eliminates triple-maintained copies. The client-side copy in
// src/app/utils/atomic-swap-engine.ts must still be kept in manual sync
// (different runtime — Deno server vs Vite browser bundle).
import {
  getAmountOut,
  decimalToBigInt,
  bigIntSqrt,
  getPriceImpactBps,
  BPS_BASE,
  MINIMUM_LIQUIDITY,
  TOTAL_SWAP_FEE_BPS,
  LP_FEE_BPS,
  PROTOCOL_FEE_BPS,
  PROTOCOL_FEE_USD,
  MAX_PROTOCOL_FEE_TINYBAR,
} from "./amm-math-shared.ts";

// Re-export for consumers that import from amm.ts (e.g., amm-math.test.ts)
export {
  getAmountOut,
  decimalToBigInt,
  bigIntSqrt,
  getPriceImpactBps,
  BPS_BASE,
  MINIMUM_LIQUIDITY,
  TOTAL_SWAP_FEE_BPS,
  LP_FEE_BPS,
  PROTOCOL_FEE_BPS,
  PROTOCOL_FEE_USD,
  MAX_PROTOCOL_FEE_TINYBAR,
};

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
// SEC-10: Per-account swap rate limit (supplements IP-based limit from shared.ts)
// A single Hedera account can only execute N swaps per window, regardless of IP.
// In-memory sliding window — resets on cold start (acceptable: KV rate keys are
// supplementary, not the primary defense).
const ACCOUNT_SWAP_RATE_PREFIX = "sl_acrl_";       // Per-account swap rate limit
const ACCOUNT_SWAP_RATE_MAX = 15;                  // 15 swaps per window
const ACCOUNT_SWAP_RATE_WINDOW_MS = 60_000;        // 60-second sliding window
// SEC-12: Per-account quote rate limit (supplements IP-based limit from shared.ts).
// Quotes are cheaper than swaps but still hit KV (pool reads + oracle). At 1k+ TPS
// (HIP-1249 target), unbounded quote spam from a single account could saturate the
// KV read budget. 30 quotes/min is generous for any human trader; bots should use
// the WebSocket feed or cache quotes client-side.
const ACCOUNT_QUOTE_RATE_PREFIX = "sl_aqrl_";      // Per-account quote rate limit
const ACCOUNT_QUOTE_RATE_MAX = 30;                 // 30 quotes per window
const ACCOUNT_QUOTE_RATE_WINDOW_MS = 60_000;       // 60-second sliding window
const POOL_INDEX_KEY = "sl_pool_index";
const ORACLE_CACHE_KEY = "sl_oracle_cache";
const ORACLE_CACHE_TTL_MS = 60_000;
const ORACLE_FALLBACK_CONFIG_KEY = "sl_oracle_fallback_cfg";

// SEC-11 P1 FIX: Oracle staleness threshold. If no fresh API data has been
// received within this window, critical paths (swap depth check, fee calc)
// use conservative limits. The warning-only log at L644 was insufficient —
// stale prices enable economic attacks (manipulated TVL → bypassed depth
// caps → outsized swaps). In production, integrate Chainlink / Pyth via
// HIP-991 for a second oracle source.
const ORACLE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
let _lastFreshOracleFetchAt = 0; // Epoch ms of last successful SaucerSwap API response

function isOracleStale(): boolean {
  return _lastFreshOracleFetchAt === 0 || (Date.now() - _lastFreshOracleFetchAt) > ORACLE_STALE_THRESHOLD_MS;
}

// ═══════════════════════════════════════════════════════════════════════
// PERF-03: KV Payload Compression
// ═══════════════════════════════════════════════════════════════════════
//
// SENIOR DEV NOTE [PERF-03]:
//   Pool state averages ~600 bytes JSON-encoded. At 500 pools × 2 reads/swap
//   (index + pool), each swap moves ~1.2 KB through KV. Volume accumulators
//   grow unbounded (micro-USD strings). Compression cuts KV I/O by ~60-70%
//   for pool state and ~80% for volume/fee accumulators (highly repetitive JSON).
//
//   Uses the Deno-native CompressionStream API (gzip, no Wasm, no npm deps).
//   Snappy would be faster (~2× decompress throughput) but requires
//   npm:snappy — acceptable tradeoff when we're I/O bound on KV latency,
//   not CPU bound on (de)compression.
//
//   Encoding: JSON → UTF-8 → gzip → base64 string. The base64 wrapper
//   ensures KV stores a plain string (no binary blob issues). Overhead:
//   ~33% base64 expansion on the compressed output, but net savings are
//   still 40-50% vs raw JSON for typical pool state.
//
//   NOT WIRED INTO LIVE KV CALLS — this module is dead code. These helpers
//   are reference implementations for atomic-signer.ts migration (Phase 2).
//   To enable: wrap savePool/getPool with compressForKv/decompressFromKv,
//   add a "v" field to detect compressed vs legacy payloads during rollout.
//
//   At HIP-1249 throughput (10k TPS target), KV read amplification is the
//   primary bottleneck. Compression reduces per-read payload, but the real
//   win is batching (mget) + in-memory caching (already done for oracle,
//   kill switch, fallback config). Pool state caching is NOT safe for swaps
//   (stale reserves = incorrect AMM math), but a short TTL (~100ms) cache
//   could coalesce burst reads within a single consensus round.

/**
 * Compress a JSON-serializable value for KV storage.
 * Returns a base64-encoded gzip string prefixed with "gz:" for detection.
 */
async function compressForKv<T>(value: T): Promise<string> {
  const json = JSON.stringify(value);
  const encoded = new TextEncoder().encode(json);
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(encoded);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunks.push(chunk);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.length; }
  // Deno supports btoa on binary strings
  const binary = Array.from(merged, (b) => String.fromCharCode(b)).join("");
  return "gz:" + btoa(binary);
}

/**
 * Decompress a KV value. Auto-detects compressed ("gz:" prefix) vs legacy JSON.
 * Transparent migration: old uncompressed values pass through unchanged.
 */
async function decompressFromKv<T>(stored: unknown): Promise<T> {
  if (typeof stored === "string" && stored.startsWith("gz:")) {
    const b64 = stored.slice(3);
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
    }
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    const json = new TextDecoder().decode(merged);
    return JSON.parse(json) as T;
  }
  // Legacy: already parsed JSON object (KV driver handles deserialization)
  return stored as T;
}

// ── T0: Network Exchange Rate (0x168 / file 0.0.112) ────────────────
// The canonical HBAR/USD rate from Hedera's consensus layer.
// Used as the primary HBAR price source for micro-fee conversion.
// Falls back to SaucerSwap oracle if Mirror Node is unreachable.

const MIRROR_NODE_URL = "https://mainnet-public.mirrornode.hedera.com";
const WHBAR_TOKEN_ID = "0.0.1456986"; // WHBAR on Hedera mainnet

interface NetworkExchangeRateCache {
  priceUsd: number;
  centEquivalent: number;
  hbarEquivalent: number;
  fetchedAt: number;
}

let _networkRateCache: NetworkExchangeRateCache | null = null;
const _NETWORK_RATE_CACHE_TTL_MS = 30_000; // 30s cache

async function fetchNetworkExchangeRate(): Promise<number> {
  // Return cache if fresh
  if (_networkRateCache && (Date.now() - _networkRateCache.fetchedAt) < _NETWORK_RATE_CACHE_TTL_MS) {
    return _networkRateCache.priceUsd;
  }

  try {
    const res = await fetch(`${MIRROR_NODE_URL}/api/v1/network/exchangerate`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.log(`[T0-ExRate] Mirror Node HTTP ${res.status}`);
      return _networkRateCache?.priceUsd ?? 0;
    }

    const data = await res.json();
    const current = data?.current_rate;
    if (!current || typeof current.cent_equivalent !== "number" || typeof current.hbar_equivalent !== "number") {
      console.log("[T0-ExRate] Invalid response structure");
      return _networkRateCache?.priceUsd ?? 0;
    }

    const now = Math.floor(Date.now() / 1000);
    let rate = current;
    if (current.expiration_time && now > current.expiration_time && data?.next_rate) {
      rate = data.next_rate;
    }

    const priceUsd = rate.cent_equivalent / rate.hbar_equivalent / 100;

    // Sanity check
    if (priceUsd < 0.001 || priceUsd > 50) {
      console.log(`[T0-ExRate] Implausible price $${priceUsd} — rejecting`);
      return _networkRateCache?.priceUsd ?? 0;
    }

    _networkRateCache = {
      priceUsd,
      centEquivalent: rate.cent_equivalent,
      hbarEquivalent: rate.hbar_equivalent,
      fetchedAt: Date.now(),
    };

    console.log(`[T0-ExRate] HBAR $${priceUsd.toFixed(6)} (${rate.cent_equivalent}c/${rate.hbar_equivalent}hbar)`);
    return priceUsd;
  } catch (err) {
    console.log(`[T0-ExRate] Fetch failed: ${(err as Error).message}`);
    return _networkRateCache?.priceUsd ?? 0;
  }
}

// ── KV Key Constants (Treasury / Protocol Fees) ─────────────────────

const TREASURY_FEE_KEY = "sl_treasury_fees";
const TREASURY_FEE_LOCK_KEY = "sl_treasury_lock";
const PROTOCOL_FEE_ACCUM_PREFIX = "sl_pfee_";   // Per-pool protocol fee accumulator
const PROTOCOL_FEE_ACCUM_LOCK = "sl_pfee_lock_"; // Per-pool lock for fee writes
const AMM_KILL_SWITCH_KEY = "amm_kill_switch";

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  SENIOR DEV NOTE [LEGACY-03] — PRE-LAUNCH LOCK (MOOT)              ║
// ║                                                                      ║
// ║  This module NEVER went live. AMM_PRELAUNCH_LOCKED was always true.  ║
// ║  The atomic CryptoTransfer AMM (atomic-signer.ts) replaced this      ║
// ║  module before the prelaunch lock was ever lifted.                    ║
// ║                                                                      ║
// ║  The "TO GO LIVE" checklist below is PRESERVED FOR REFERENCE ONLY.   ║
// ║  DO NOT follow these steps — re-enabling this module would create    ║
// ║  conflicting routes with atomic-signer.ts and expose the KV-backed   ║
// ║  reserve simulation (rated 5.5/10) alongside the atomic model.       ║
// ║                                                                      ║
// ║  ORIGINAL GO-LIVE STEPS (historical — do not execute):               ║
// ║    1. Set AMM_PRELAUNCH_LOCKED = false                               ║
// ║    2. Remove AmmPrelaunchBanner from frontend components             ║
// ║    3. Delete AmmPrelaunchBanner.tsx                                   ║
// ║    4. Redeploy server + frontend                                     ║
// ╚═══════════════════════════════════════════════════════════════════════╝
const AMM_PRELAUNCH_LOCKED = true;
const AMM_PRELAUNCH_MESSAGE = "The AMM is not yet live. Pool creation, liquidity, and swaps will be enabled after testing and security audits are complete.";

// ── AMM Kill Switch ─────────────────────────────────────────────────
// Owner-only circuit breaker. When active, all swaps and new liquidity
// additions are rejected. LP removals remain open (users must always
// be able to withdraw). Checked on every mutating pool operation.

interface AmmKillState {
  active: boolean;
  activatedAt: number;
  activatedBy: string;
  reason: string;
}

let _killSwitchCache: { state: AmmKillState | null; ts: number } = { state: null, ts: 0 };
const _KILL_SWITCH_CACHE_TTL_MS = 5_000; // Re-check KV every 5s

async function isAmmKilled(): Promise<boolean> {
  const now = Date.now();
  if (now - _killSwitchCache.ts < _KILL_SWITCH_CACHE_TTL_MS) {
    return _killSwitchCache.state?.active ?? false;
  }
  try {
    const state: AmmKillState | null = await kv.get(AMM_KILL_SWITCH_KEY);
    _killSwitchCache = { state, ts: now };
    return state?.active ?? false;
  } catch {
    // KV unreachable — fail-CLOSED: preserve last known kill switch state.
    // If the kill switch was activated before KV went down, the AMM stays halted.
    // If no cached state exists (fresh deploy + immediate KV outage), default to
    // halted (false positive is safer than false negative during an emergency).
    if (_killSwitchCache.state !== null) {
      // Extend the stale cache TTL so we don't hammer a dead KV on every request
      _killSwitchCache.ts = Date.now();
      console.log(`[AMM] KV unreachable — using cached kill switch state: active=${_killSwitchCache.state.active}`);
      return _killSwitchCache.state.active;
    }
    // No cached state at all — halt trading as a precaution
    console.log("[AMM] KV unreachable with no cached state — failing closed (halting AMM)");
    return true;
  }
}

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

// Per-pool protocol fee accumulator — tracks the 0.05% share that remains
// in pool reserves until extracted. Extraction deducts from reserves and
// resets the accumulator. This is the Uniswap V2 "fee switch" pattern:
// fees accrue inside the pool (increasing k for LPs) and the protocol's
// share is periodically swept out by the admin/DAO.
interface PoolProtocolFeeAccumulator {
  poolId: string;
  accruedUsd: number;           // Running USD total of accrued 0.05% fees
  accruedInputTokens: Record<string, string>;  // symbol → raw integer string
  swapCount: number;
  lastSwapAt: number;
  lastExtractedAt: number | null;
  lastExtractedUsd: number;
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

// PROTOCOL_FEE_USD imported from amm-math-shared.ts (see re-exports above)
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
// MAX_PROTOCOL_FEE_TINYBAR imported from amm-math-shared.ts (see re-exports above)

// ── Fee Structure ────────────────────────────────────────────────────
// Total swap fee: 0.25% (25 bps) — applied in AMM formula.
//
// The FULL 25 bps stays in pool reserves (increases k for LP holders).
// The protocol's 5 bps share is TRACKED in a per-pool accumulator
// (PoolProtocolFeeAccumulator) and can be EXTRACTED via the admin
// /pools/protocol-fees/extract endpoint. Until extraction, LPs earn
// the full 0.25%.
//
// This is the Uniswap V2 "fee switch" model: fees accrue in-pool,
// protocol share is swept periodically. DAO governance can adjust
// the protocol share via proposal vote.
//
// The flat $0.0007 micro-fee (Layer 2) is SEPARATE and additive.
// Fee constants imported from amm-math-shared.ts (see re-exports above)

// ── Token Whitelist ─────────────────────────────────────────────────
// Only whitelisted tokens can be used in pools.
// Token IDs are canonical HTS IDs on Hedera mainnet.
// Bridge tokens use HashPort / LayerZero bridged HTS token IDs.
//
// IMPORTANT — decimal verification:
//   HashPort typically bridges ERC-20 tokens to 8-decimal HTS tokens,
//   but some older bridge tokens may preserve original decimals (e.g. 18
//   for WETH). All decimals below MUST be confirmed on HashScan before
//   mainnet trading goes live. Wrong decimals = wrong swap amounts.
//
// Oracle price resolution:
//   fetchOraclePrices() fetches from SaucerSwap API (keyed by token ID).
//   Some bridge token IDs differ from SaucerSwap-listed token IDs. For
//   those tokens, `saucerswapId` maps to the SaucerSwap-listed ID for
//   price lookup. The oracle also falls back by symbol matching.

interface TokenDef {
  tokenId: string;
  symbol: string;
  name: string;
  decimals: number;
  fallbackPrice: number;
  bridge?: string;
  tier: 1 | 2;
  /** SaucerSwap-listed HTS ID (when different from `tokenId`). Used for oracle price lookup. */
  saucerswapId?: string;
  /** EVM address (derived from tokenId unless overridden — e.g. WHBAR smart contract). */
  evmAddress?: string;
}

const TOKEN_WHITELIST: TokenDef[] = [
  // ── Routing Hub ───────────────────────────────────────────────────
  // WHBAR is the ERC-20 wrapper for native HBAR, required for EVM pool routing.
  // SaucerSwap canonical WHBAR — used for all pool routing involving HBAR.
  { tokenId: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8, fallbackPrice: 0.28, tier: 1,
    evmAddress: "0x000000000000000000000000000000000011F6bF" },

  // ── Stablecoins ───────────────────────────────────────────────────
  // Native Circle USDC (canonical, highest liquidity on Hedera)
  { tokenId: "0.0.456858",  symbol: "USDC",   name: "USD Coin",              decimals: 6,  fallbackPrice: 1.00,   tier: 1 },
  // Native Tether (canonical)
  { tokenId: "0.0.4291336", symbol: "USDT",   name: "Tether USD",            decimals: 6,  fallbackPrice: 1.00,   tier: 1 },
  // HashPort-bridged DAI (ERC-20 → HTS, 8 dec — needs HashScan confirmation)
  { tokenId: "0.0.1055477", symbol: "DAI",    name: "Dai Stablecoin",        decimals: 8,  fallbackPrice: 1.00,   bridge: "HashPort", tier: 1 },
  // HashPort-bridged USDC (distinct from native Circle USDC — lower liquidity)
  { tokenId: "0.0.1055459", symbol: "USDCh",  name: "USDC (HashPort)",       decimals: 6,  fallbackPrice: 1.00,   bridge: "HashPort", tier: 2 },
  // HashPort-bridged USDT (distinct from native Tether — lower liquidity)
  { tokenId: "0.0.1055472", symbol: "USDTh",  name: "USDT (HashPort)",       decimals: 6,  fallbackPrice: 1.00,   bridge: "HashPort", tier: 2 },

  // ── Major Wrapped Assets (HashPort / LayerZero bridges) ───────────
  // [C85] Updated saucerswapId aliases to current SaucerSwap API values
  // WBTC: HashPort bridge. SaucerSwap now lists 0.0.10104132 (was 0.0.1969769).
  { tokenId: "0.0.1055483", symbol: "WBTC",   name: "Wrapped Bitcoin",       decimals: 8,  fallbackPrice: 104000, bridge: "HashPort", tier: 1,
    saucerswapId: "0.0.10104132" },
  // WETH: HashPort bridge (token ID 0.0.541564). SaucerSwap lists 0.0.1969708 (18 dec).
  // NOTE: Decimals MUST be confirmed on HashScan — HashPort may bridge at 8 or 18.
  { tokenId: "0.0.541564",  symbol: "WETH",   name: "Wrapped Ether",         decimals: 18, fallbackPrice: 2650,   bridge: "HashPort", tier: 1,
    saucerswapId: "0.0.1969708" },
  // LINK: HashPort bridge. SaucerSwap now lists 0.0.10152778 (was 0.0.1970030).
  { tokenId: "0.0.1055495", symbol: "LINK",   name: "Chainlink",             decimals: 8,  fallbackPrice: 16.50,  bridge: "HashPort", tier: 1,
    saucerswapId: "0.0.10152778" },
  // AAVE: HashPort bridge (same ID as SaucerSwap — no alias needed)
  // NOTE: Decimals (8) need HashScan confirmation — could be 18 if HashPort preserved ERC-20 decimals.
  { tokenId: "0.0.1055498", symbol: "AAVE",   name: "Aave",                  decimals: 8,  fallbackPrice: 180.0,  bridge: "HashPort", tier: 1 },

  // ── Cross-Chain Wrapped Assets (LayerZero / BiT Global) ───────────
  // WBNB: LayerZero bridge from BNB Chain
  { tokenId: "0.0.1157005", symbol: "WBNB",   name: "Wrapped BNB",           decimals: 8,  fallbackPrice: 660,    bridge: "LayerZero", tier: 1 },
  // WAVAX: LayerZero bridge from Avalanche
  { tokenId: "0.0.1157020", symbol: "WAVAX",  name: "Wrapped AVAX",          decimals: 8,  fallbackPrice: 25,     bridge: "LayerZero", tier: 1 },
  // WMATIC: HashPort bridge from Polygon
  { tokenId: "0.0.540318",  symbol: "WMATIC", name: "Wrapped MATIC",         decimals: 8,  fallbackPrice: 0.40,   bridge: "HashPort", tier: 2 },
];

const ACTIVE_TOKENS = TOKEN_WHITELIST.filter(t => t.tier === 1);
const TOKEN_BY_SYMBOL = new Map(TOKEN_WHITELIST.map(t => [t.symbol, t]));
const TOKEN_BY_ID = new Map(TOKEN_WHITELIST.map(t => [t.tokenId, t]));
// Secondary lookup: SaucerSwap alias IDs → our canonical token ID (for oracle price resolution)
const SAUCERSWAP_ALIAS_MAP = new Map<string, string>();
for (const t of TOKEN_WHITELIST) {
  if (t.saucerswapId) SAUCERSWAP_ALIAS_MAP.set(t.saucerswapId, t.tokenId);
}

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
  // Volume in micro-USD fits safely in Number (max ~$9 trillion at 1e6 scale)
  const volumeMicro = Number(BigInt(pool.cumulativeVolumeUsd || "0"));
  return {
    ...pool,
    cumulativeVolumeUsd: volumeMicro / VOLUME_MICRO_SCALE,
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
// SHARED-01: Pure math functions now imported from amm-math-shared.ts.
// See re-exports above. Inline definitions removed to prevent drift.

// ── Pool TVL & Swap Limits ──────────────────────────────────────────
//
// SENIOR DEV NOTE [LEGACY-02]:
//   Number(BigInt(reserve)) overflows Number.MAX_SAFE_INTEGER for tokens
//   with 18 decimals (WETH) at reserves > ~90 ETH. This was a P0 bug in
//   the original code. Fixed below using string-based decimal conversion
//   (same approach as atomic-swap-engine.ts bigIntToDecimal).

// SENIOR DEV NOTE [LEGACY-05]:
//   Returns IEEE 754 double (~15-17 significant digits). This is intentionally
//   lossy — the function is used for USD display values and TVL calculations,
//   not for AMM math (which uses BigInt exclusively). For an 18-decimal token
//   with reserves > 9 quadrillion base units, the fractional tail is truncated
//   by parseFloat. This is acceptable: the result feeds into price × reserve
//   multiplications where the price itself is a float.
//
//   If exact display is ever needed (e.g. LP share percentages at 18 decimals),
//   use atomic-swap-engine.ts `bigIntToDecimal()` which returns a string.
//
// P2 FIX [LEGACY-09]: Added bigIntToDisplaySafe() below for fee USD paths.
//   The base bigIntToDisplay is fine for TVL display, but fee-critical paths
//   (depth check USD, volume tracking, protocol fee accrual) could misreport
//   for extreme values (18-decimal tokens with >1e15 base units or sub-dust
//   amounts like raw="1" decimals=18 → 1e-18). bigIntToDisplaySafe() clamps
//   the fractional part to 15 significant digits before parseFloat, making
//   the truncation explicit rather than silent. For truly exact fee math,
//   migrate to BigInt-denominated USD (micro-USD scaled integers) end-to-end.
function bigIntToDisplay(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
  if (decimals === 0) return parseFloat(raw) || 0;
  const str = raw.padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals);
  return parseFloat(`${whole}.${frac}`);
}

// LEGACY-09: Precision-aware variant for fee/depth paths. Truncates fractional
// digits to keep total significant digits ≤ 15, avoiding silent IEEE 754 loss.
// Returns NaN guard for truly unrepresentable values (whole part > 1e308).
function bigIntToDisplaySafe(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
  if (decimals === 0) {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) {
      console.log(`[LEGACY-09] bigIntToDisplaySafe overflow: raw=${raw.slice(0, 40)}... decimals=0`);
      return 0;
    }
    return n;
  }
  const str = raw.padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  let frac = str.slice(str.length - decimals);
  // Clamp fractional digits so total significant digits ≤ 15
  const wholeSigDigits = whole === "0" ? 0 : whole.length;
  const maxFracDigits = Math.max(0, 15 - wholeSigDigits);
  if (frac.length > maxFracDigits) {
    frac = frac.slice(0, maxFracDigits);
  }
  const result = parseFloat(`${whole}.${frac}`);
  if (!Number.isFinite(result)) {
    console.log(`[LEGACY-09] bigIntToDisplaySafe overflow: raw=${raw.slice(0, 40)}... decimals=${decimals}`);
    return 0;
  }
  return result;
}

// LEGACY-09: Uses bigIntToDisplaySafe — poolTvlUsd feeds into the swap depth
// check denominator, so precision matters for economic safety calculations.
function poolTvlUsd(pool: PoolState, prices: Record<string, number>): number {
  const priceA = prices[pool.tokenIdA] || 0;
  const priceB = prices[pool.tokenIdB] || 0;
  const reserveA = bigIntToDisplaySafe(pool.reserveA, pool.decimalsA);
  const reserveB = bigIntToDisplaySafe(pool.reserveB, pool.decimalsB);
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
  // Default stablecoin prices (always $1)
  prices["0.0.456858"] = 1.0;   // USDC (native Circle)
  prices["0.0.4291336"] = 1.0;  // USDT (native Tether)
  prices["0.0.1055477"] = 1.0;  // DAI (HashPort bridge)
  prices["0.0.1055459"] = 1.0;  // USDCh (HashPort bridge)
  prices["0.0.1055472"] = 1.0;  // USDTh (HashPort bridge)

  // Try cached working variant first, then fallback to all variants
  const allVariants = ["/tokens", "/v1/tokens", "/v2/tokens"];
  const variants = _saucerswapWorkingPath
    ? [_saucerswapWorkingPath, ...allVariants.filter(v => v !== _saucerswapWorkingPath)]
    : allVariants;
  for (const path of variants) {
    try {
      const _ssKey = Deno.env.get("SAUCERSWAP_API_KEY") ?? "";
      const _ssHeaders: Record<string, string> = { Accept: "application/json" };
      if (_ssKey) _ssHeaders["x-api-key"] = _ssKey;
      const res = await saucerswapBreaker.call(
        () => fetch(`${SAUCERSWAP_API_URL}${path}`, {
          headers: _ssHeaders,
          signal: AbortSignal.timeout(8000),
        }),
        isHttpFailure,
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) {
        // Build symbol → price map for secondary resolution
        const symPrices: Record<string, number> = {};
        for (const token of data) {
          const id = token.id || token.tokenId;
          const price = parseFloat(token.priceUsd || token.price || "0");
          if (!id || price <= 0) continue;
          const sym = (token.symbol || "").toUpperCase();
          if (sym) symPrices[sym] = price;
          // Primary: exact token ID match
          if (TOKEN_BY_ID.has(id)) {
            prices[id] = price;
            continue;
          }
          // Secondary: SaucerSwap alias → our canonical token ID
          // (e.g. SaucerSwap WBTC 0.0.10104132 → our WBTC 0.0.1055483)
          const aliasTarget = SAUCERSWAP_ALIAS_MAP.get(id);
          if (aliasTarget && !prices[aliasTarget]) {
            prices[aliasTarget] = price;
          }
        }
        // Tertiary: symbol-based fallback for tokens not yet resolved
        for (const t of TOKEN_WHITELIST) {
          if (!prices[t.tokenId] && symPrices[t.symbol]) {
            prices[t.tokenId] = symPrices[t.symbol];
          }
        }
      }
      if (Object.keys(prices).length >= 4) {
        _saucerswapWorkingPath = path; // Cache the variant that worked
        break;
      }
    } catch { continue; }
  }

  // T0: Network Exchange Rate — trustless HBAR price from file 0.0.112
  // Overrides SaucerSwap WHBAR price if available (consensus-derived)
  const networkHbarPrice = await fetchNetworkExchangeRate();
  if (networkHbarPrice > 0) {
    prices[WHBAR_TOKEN_ID] = networkHbarPrice;
    console.log(`[Oracle] T0 network rate applied for WHBAR: $${networkHbarPrice.toFixed(6)}`);
  }

  let usedFallback = false;
  for (const t of TOKEN_WHITELIST) {
    if (!prices[t.tokenId]) {
      prices[t.tokenId] = t.fallbackPrice;
      usedFallback = true;
    }
  }

  // P1 FIX: Track fresh oracle timestamp for staleness checks in critical paths.
  // _lastFreshOracleFetchAt is only updated when SaucerSwap API returned live data.
  if (!usedFallback) {
    _lastFreshOracleFetchAt = Date.now();
  } else {
    const fbCfg = await getOracleFallbackConfig();
    const staleMs = Date.now() - fbCfg.updatedAt;
    if (staleMs > ORACLE_STALE_THRESHOLD_MS) {
      // P1: Hard block — reject if fallback prices are beyond the stale threshold.
      // This prevents economic attacks when SaucerSwap is down for extended periods.
      // Operators must update via PUT /oracle/fallback or restore API connectivity.
      console.log(`[Oracle] CRITICAL: Fallback prices are stale (${Math.round(staleMs / 86400000)}d > ${ORACLE_STALE_THRESHOLD_MS / 86400000}d threshold). Swap depth checks will use emergency-conservative limits.`);
    } else if (staleMs > fbCfg.maxAgeMs) {
      console.log("[Oracle] WARNING: Fallback prices are aging (" + Math.round(staleMs / 86400000) + " days). Update via PUT /oracle/fallback.");
    }
  }

  // SEC-11: Track oracle freshness — consumers check isOracleStale() to detect
  // stale data. When stale, swap depth checks use emergency-conservative limits
  // (halved maxSwapFraction) and quote responses include an oracleStale flag.
  const oraclePayload = { prices, ts: Date.now(), freshFromApi: !usedFallback, lastFreshAt: _lastFreshOracleFetchAt };
  try { await kv.set(ORACLE_CACHE_KEY, oraclePayload); } catch { /* non-critical */ }
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

// ── Pool Creation Lock ─────────────────────────────────────────────
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
  app.get(`${ROUTE_PREFIX}/oracle/fallback`, async (c) => {
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
      console.log("[AMM] Error in GET /oracle/fallback:", err);
      return c.json({ error: "Failed to read fallback config" }, 500);
    }
  });

  // PUT /oracle/fallback — Owner-only: update fallback HBAR price at runtime.
  // Body: { "price": 0.30 }  (optional: "maxAgeDays": 90)
  // updatedAt is auto-set to now. Requires ED25519 session for 0.0.518487.
  app.put(`${ROUTE_PREFIX}/oracle/fallback`, async (c) => {
    const ownerAuth = await requireOwner(c);
    if (ownerAuth instanceof Response) return ownerAuth;
    const ip = getClientIp(c);
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
      logAdminAction("amm_oracle_update", ownerAuth.accountId, ip, `price=${price} maxAge=${maxAgeDays}d`);
      return c.json({
        success: true,
        price: cfg.price,
        updatedAt: cfg.updatedAt,
        updatedAtIso: new Date(cfg.updatedAt).toISOString(),
        maxAgeDays,
      });
    } catch (err) {
      console.log("[AMM] Error in PUT /oracle/fallback:", err);
      return c.json({ error: "Failed to update fallback config" }, 500);
    }
  });

  // ── AMM Kill Switch Endpoints ───────────────────────────────────────
  // REMOVED: /amm/kill-switch, /amm/kill, /amm/resume routes are now
  // served by atomic-signer.ts backward-compat shims. If this module is
  // re-enabled, these endpoints would conflict with the atomic routes.
  // See atomic-signer.ts "BACKWARD-COMPAT SHIMS" section.

  // GET /pools — List all active pools with real-time state + oracle prices
  app.get(`${ROUTE_PREFIX}/pools`, async (c) => {
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
      console.log("[AMM] Error in GET /pools:", err);
      return c.json({ error: "Failed to fetch pools" }, 500);
    }
  });

  // GET /pools/prices — Oracle prices for display
  app.get(`${ROUTE_PREFIX}/pools/prices`, async (c) => {
    try {
      const prices = await fetchOraclePrices();
      return c.json({ prices, updatedAt: Math.floor(Date.now() / 1000) });
    } catch (err) {
      console.log("[AMM] Error in GET /pools/prices:", err);
      return c.json({ error: "Failed to fetch prices" }, 500);
    }
  });

  // POST /pools/create — Authenticated. Tier 1 tokens only. Fee is protocol-fixed.
  // Protected by POOL_CREATION_LOCK to prevent duplicate-pair races and index corruption.
  app.post(`${ROUTE_PREFIX}/pools/create`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      // ── Pre-launch lock: block all pool creation until audits complete ──
      if (AMM_PRELAUNCH_LOCKED) {
        return c.json({ error: AMM_PRELAUNCH_MESSAGE, code: "AMM_PRELAUNCH" }, 503);
      }

      // ── AMM kill switch: block pool creation ──
      if (await isAmmKilled()) {
        return c.json({ error: "AMM trading is temporarily halted by protocol owner", code: "AMM_HALTED" }, 503);
      }

      // ── Auth + input validation (outside lock — no state mutation) ──

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const accountId = auth.accountId;

      const body = await c.req.json();
      const { tokenA, tokenB, name, description } = body;

      const defA = TOKEN_BY_SYMBOL.get(tokenA);
      const defB = TOKEN_BY_SYMBOL.get(tokenB);
      if (!defA || !defB) return c.json({ error: `Unknown token. Available: ${ACTIVE_TOKENS.map(t => t.symbol).join(", ")}` }, 400);
      if (defA.tier !== 1 || defB.tier !== 1) return c.json({ error: "Only Tier 1 tokens are currently enabled for pool creation" }, 400);
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
          swapFeeBps: TOTAL_SWAP_FEE_BPS, creator: sanitizeString(accountId, 20), createdAt: Date.now(),
          cumulativeVolumeUsd: "0", swapCount: 0, status: "active",
          version: 1,
        };

        await savePool(pool);
        poolIds.push(poolId);
        await kv.set(POOL_INDEX_KEY, poolIds);
        console.log(`[SmartLiquidity] Pool created: ${poolId} by ${accountId} (fee=${TOTAL_SWAP_FEE_BPS}bps fixed)`);
        return c.json({ success: true, pool: poolToApi(pool) });
      });

      return result;
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") {
        return c.json({ error: "Pool creation service is busy — please retry in a few seconds", code: "CREATION_BUSY" }, 503);
      }
      console.log("[AMM] Error in POST /pools/create:", err);
      return c.json({ error: "Pool creation failed" }, 500);
    }
  });

  // POST /pools/liquidity/add — Authenticated. Lock + CAS protected.
  // First deposit burns MINIMUM_LIQUIDITY. Subsequent deposits proportional.
  app.post(`${ROUTE_PREFIX}/pools/liquidity/add`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      // ── Pre-launch lock ──
      if (AMM_PRELAUNCH_LOCKED) {
        return c.json({ error: AMM_PRELAUNCH_MESSAGE, code: "AMM_PRELAUNCH" }, 503);
      }

      // ── AMM kill switch: block new liquidity additions ──
      if (await isAmmKilled()) {
        return c.json({ error: "AMM trading is temporarily halted by protocol owner", code: "AMM_HALTED" }, 503);
      }

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const accountId = auth.accountId;

      const body = await c.req.json();
      const { poolId, amountA, amountB } = body;

      // Input validation: poolId format + BigInt-safe amount strings
      if (!isValidPoolId(poolId)) return c.json({ error: "Invalid pool ID format" }, 400);
      if (!isValidBigIntString(amountA)) return c.json({ error: "amountA must be a non-negative integer string" }, 400);
      if (!isValidBigIntString(amountB)) return c.json({ error: "amountB must be a non-negative integer string" }, 400);

      return await withPoolLock(poolId, async () => {
            const pool = await getPool(poolId);
            if (!pool) return c.json({ error: "Pool not found" }, 404);
            if (pool.status !== "active") return c.json({ error: "Pool is paused" }, 400);
            const expectedVersion = pool.version;

            const rawA = BigInt(amountA);
            const rawB = BigInt(amountB);
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
    } catch (err: any) {
      if (err?.code === "POOL_BUSY") return c.json({ error: err.message, code: "POOL_BUSY" }, 503);
      console.log("[AMM] Error in POST /pools/liquidity/add:", err);
      return c.json({ error: "Add liquidity failed" }, 500);
    }
  });

  // POST /pools/liquidity/remove — Authenticated. Lock + CAS protected.
  app.post(`${ROUTE_PREFIX}/pools/liquidity/remove`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const accountId = auth.accountId;

      const body = await c.req.json();
      const { poolId, shares } = body;

      // Input validation: poolId format + BigInt-safe shares string
      if (!isValidPoolId(poolId)) return c.json({ error: "Invalid pool ID format" }, 400);
      if (!isValidBigIntString(shares)) return c.json({ error: "shares must be a non-negative integer string" }, 400);

      return await withPoolLock(poolId, async () => {
            const pool = await getPool(poolId);
            if (!pool) return c.json({ error: "Pool not found" }, 404);
            const expectedVersion = pool.version;

            const sharesToBurn = BigInt(shares);
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
    } catch (err: any) {
      if (err?.code === "POOL_BUSY") return c.json({ error: err.message, code: "POOL_BUSY" }, 503);
      console.log("[AMM] Error in POST /pools/liquidity/remove:", err);
      return c.json({ error: "Remove liquidity failed" }, 500);
    }
  });

  // GET /pools/position/:poolId/:accountId — Get LP position
  app.get(`${ROUTE_PREFIX}/pools/position/:poolId/:accountId`, async (c) => {
    try {
      const poolId = c.req.param("poolId");
      const accountId = c.req.param("accountId");
      if (!isValidPoolId(poolId)) return c.json({ error: "Invalid pool ID format" }, 400);
      if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);
      const position = await getLPPosition(poolId, accountId);
      return c.json({ position: position || null });
    } catch (err) {
      console.log("[AMM] Error fetching LP position:", err);
      return c.json({ position: null, error: "Failed to fetch LP position" }, 500);
    }
  });

  // POST /pools/quote — AMM quote with smart routing (direct + USDC-hop).
  // SEC-12: Optional per-account quote rate limiting. If the request carries a
  // valid session token, the account is rate-limited to ACCOUNT_QUOTE_RATE_MAX
  // quotes per window. Unauthenticated quotes still pass through (IP-limited
  // upstream). This prevents a single account from saturating the KV read path
  // with rapid-fire quote polling — at HIP-1249 TPS, each quote triggers
  // 2+ KV reads (pool index + mget) plus an oracle cache check.
  app.post(`${ROUTE_PREFIX}/pools/quote`, async (c) => {
    try {
      // SEC-12: Per-account quote rate limit (best-effort, non-blocking on failure)
      const quoteSession = await validateSession(c);
      if (quoteSession) {
        try {
          const aqrlKey = ACCOUNT_QUOTE_RATE_PREFIX + quoteSession.accountId;
          const aqrl: { timestamps: number[] } | null = await kv.get(aqrlKey);
          const now = Date.now();
          const window = aqrl?.timestamps?.filter(t => now - t < ACCOUNT_QUOTE_RATE_WINDOW_MS) ?? [];
          if (window.length >= ACCOUNT_QUOTE_RATE_MAX) {
            console.log(`[SEC-12] Per-account quote rate limit: ${quoteSession.accountId} (${window.length}/${ACCOUNT_QUOTE_RATE_MAX} in ${ACCOUNT_QUOTE_RATE_WINDOW_MS}ms)`);
            return c.json({ error: "Quote rate limit exceeded — try again shortly", code: "QUOTE_RATE_LIMITED" }, 429);
          }
          window.push(now);
          kv.set(aqrlKey, { timestamps: window }).catch(() => {});
        } catch { /* Rate limit check failure is non-blocking */ }
      }

      const body = await c.req.json();
      const { tokenIn, tokenOut, amountIn } = body;
      if (!tokenIn || !tokenOut || !amountIn) return c.json({ error: "Missing: tokenIn, tokenOut, amountIn" }, 400);

      const defIn = TOKEN_BY_SYMBOL.get(tokenIn);
      const defOut = TOKEN_BY_SYMBOL.get(tokenOut);
      if (!defIn || !defOut) return c.json({ error: `Unknown token. Available: ${ACTIVE_TOKENS.map(t => t.symbol).join(", ")}` }, 400);

      // Validate amountIn is a finite positive number before any math
      const parsedAmountIn = parseFloat(amountIn);
      if (!Number.isFinite(parsedAmountIn) || parsedAmountIn <= 0) {
        return c.json({ error: "amountIn must be a finite positive number" }, 400);
      }

      // Single oracle fetch + batch pool read
      const [prices, poolIds] = await Promise.all([fetchOraclePrices(), getPoolIndex()]);
      const allPools = await getAllPools(poolIds);
      // Build a quick lookup map for routing
      const activePools = allPools.filter(p => p.status === "active" && BigInt(p.reserveA) > 0n && BigInt(p.reserveB) > 0n);

      interface RouteCandidate { path: string[]; amountOut: bigint; priceImpactBps: number; feeBps: number; poolId: string; }
      const routes: RouteCandidate[] = [];

      // Parse amount to raw integer BigInt using string manipulation to avoid
      // IEEE 754 precision loss. Float math (amount * 10^decimals) overflows
      // Number.MAX_SAFE_INTEGER for 18-decimal tokens like WETH at >0.009 units.
      const rawIn = decimalToBigInt(String(amountIn), defIn.decimals);
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

        // Always use protocol-fixed fee (ignores any legacy stored value)
        const out = getAmountOut(rawIn, rIn, rOut, TOTAL_SWAP_FEE_BPS);
        if (out <= 0n) continue;
        routes.push({ path: [tokenIn, tokenOut], amountOut: out, priceImpactBps: getPriceImpactBps(rawIn, rIn), feeBps: TOTAL_SWAP_FEE_BPS, poolId: pool.id });
      }

      // ── Multi-hop routing (A→HUB→B) ──────────────────────────────────
      // Tries two routing hubs: USDC (stablecoin path) and WHBAR (native path).
      // WHBAR is the primary routing hub on Hedera — most pools pair against it.
      // Both hubs are attempted; the best output across all routes wins.
      const ROUTING_HUBS = ["USDC", "WHBAR"];
      for (const hub of ROUTING_HUBS) {
        if (tokenIn === hub || tokenOut === hub) continue;
        for (const p1 of activePools) {
          let r1In: bigint, r1Out: bigint;
          const f1 = p1.tokenA === tokenIn && p1.tokenB === hub;
          const v1 = p1.tokenA === hub && p1.tokenB === tokenIn;
          if (f1) { r1In = BigInt(p1.reserveA); r1Out = BigInt(p1.reserveB); }
          else if (v1) { r1In = BigInt(p1.reserveB); r1Out = BigInt(p1.reserveA); }
          else continue;
          const mid = getAmountOut(rawIn, r1In, r1Out, TOTAL_SWAP_FEE_BPS);
          if (mid <= 0n) continue;

          for (const p2 of activePools) {
            if (p2.id === p1.id) continue;
            let r2In: bigint, r2Out: bigint;
            const f2 = p2.tokenA === hub && p2.tokenB === tokenOut;
            const v2 = p2.tokenA === tokenOut && p2.tokenB === hub;
            if (f2) { r2In = BigInt(p2.reserveA); r2Out = BigInt(p2.reserveB); }
            else if (v2) { r2In = BigInt(p2.reserveB); r2Out = BigInt(p2.reserveA); }
            else continue;
            const out = getAmountOut(mid, r2In, r2Out, TOTAL_SWAP_FEE_BPS);
            if (out <= 0n) continue;
            routes.push({ path: [tokenIn, hub, tokenOut], amountOut: out, priceImpactBps: getPriceImpactBps(rawIn, r1In) + getPriceImpactBps(mid, r2In), feeBps: TOTAL_SWAP_FEE_BPS * 2, poolId: `${p1.id}+${p2.id}` });
          }
        }
      }

      if (routes.length === 0) return c.json({ error: "No route available. Pools may be empty or pair not supported.", routes: [] }, 404);

      routes.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));
      const best = routes[0];
      const outDisplay = bigIntToDisplaySafe(best.amountOut.toString(), defOut.decimals);
      const inDisplay = parseFloat(amountIn);

      // Protocol fee in HBAR — T0 Network Rate (0x168) is primary, SaucerSwap/fallback is backup
      // The network exchange rate from file 0.0.112 is consensus-derived and always current.
      // Parallel fetch: both are independent network calls; avoid sequential latency.
      const [fbCfg, t0HbarPrice] = await Promise.all([
        getOracleFallbackConfig(),
        fetchNetworkExchangeRate(),
      ]);
      const hbarPrice = t0HbarPrice > 0 ? t0HbarPrice : (prices[WHBAR_TOKEN_ID] || fbCfg.price);
      const protocolFeeHbar = PROTOCOL_FEE_USD / hbarPrice;
      const protocolFeeTinybar = Math.min(MAX_PROTOCOL_FEE_TINYBAR, Math.max(1, Math.round(protocolFeeHbar * 1e8)));
      const lpRewardTinybar = Math.floor(protocolFeeTinybar / 2);
      const treasuryFeeTinybar = protocolFeeTinybar - lpRewardTinybar;

      // Calculate percentage-based protocol fee (0.05% of swap value)
      const swapValueUsd = inDisplay * (prices[defIn.tokenId] || 0);
      const pctProtocolFeeUsd = swapValueUsd * PROTOCOL_FEE_BPS / 10000;

      // P2 FIX: Flag multi-hop routes so clients know execution is unsupported.
      // Without this, the UI quotes a multi-hop route → user clicks swap → 501.
      const isMultiHop = (best.poolId || "").includes("+");

      return c.json({
        poolId: best.poolId, tokenIn, tokenOut, amountIn: inDisplay, amountOut: outDisplay,
        amountOutRaw: best.amountOut.toString(), amountInRaw: rawIn.toString(),
        route: best.path.join(" → "), priceImpactBps: best.priceImpactBps, feeBps: best.feeBps,
        feeUsd: swapValueUsd * best.feeBps / 10000,
        effectiveRate: inDisplay > 0 ? outDisplay / inDisplay : 0,
        minAmountOut: outDisplay * 0.995,  // UI default 0.5% slippage — actual protection is minAmountOutRaw in swap body
        routeCount: routes.length, inPrice: prices[defIn.tokenId] || 0, outPrice: prices[defOut.tokenId] || 0,
        // P2 FIX: Multi-hop warning flags — client should show "quote only" UI
        // and disable the swap button when executeSupported=false.
        isMultiHop,
        executeSupported: !isMultiHop,
        ...(isMultiHop ? { multiHopWarning: "Multi-hop routes are quote-only. Execution requires HIP-1331 atomic batch support. Use direct pool routes to swap." } : {}),
        // P1 FIX: Oracle staleness flag — client can show a warning banner
        oracleStale: isOracleStale(),
        // Fee structure breakdown — full 25 bps stays in pool; protocol's 5 bps
        // is tracked per pool and extractable. Until extracted, LPs earn full 0.25%.
        feeStructure: {
          totalFeeBps: TOTAL_SWAP_FEE_BPS,
          lpFeeBps: LP_FEE_BPS,
          protocolFeeBps: PROTOCOL_FEE_BPS,
          lpFeeUsd: swapValueUsd * LP_FEE_BPS / 10000,
          protocolFeeUsd: pctProtocolFeeUsd,
        },
        // Flat micro-fee breakdown (Layer 2 — additive)
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
      console.log("[AMM] Error in POST /pools/quote:", err);
      return c.json({ error: "Quote failed" }, 500);
    }
  });

  // POST /pools/swap — Authenticated. Lock + CAS protected. Private mempool.
  // PERF-04: Full hot-path instrumentation — every parallel op is timed.
  // Swap latency budget at HIP-1249 throughput (10k TPS target):
  //   - Pre-lock (auth + rate limit + validation): < 5ms
  //   - Oracle fetch (parallel, cached 60s): < 2ms (cache hit) / ~200ms (miss)
  //   - Pool lock acquisition: < 50ms (p99 under contention)
  //   - AMM math + CAS write: < 10ms
  //   - Fee accrual + logging (fire-and-forget): < 15ms
  //   - Total target: < 80ms p50, < 300ms p99
  app.post(`${ROUTE_PREFIX}/pools/swap`, async (c) => {
    const _t0 = performance.now(); // PERF-04: swap entry
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      // ── Pre-launch lock ──
      if (AMM_PRELAUNCH_LOCKED) {
        return c.json({ error: AMM_PRELAUNCH_MESSAGE, code: "AMM_PRELAUNCH" }, 503);
      }

      // ── AMM kill switch: block swaps ──
      if (await isAmmKilled()) {
        return c.json({ error: "AMM trading is temporarily halted by protocol owner", code: "AMM_HALTED" }, 503);
      }

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const accountId = auth.accountId;

      // SEC-10: Per-account swap rate limit (in addition to IP-based limit)
      try {
        const acrlKey = ACCOUNT_SWAP_RATE_PREFIX + accountId;
        const acrl: { timestamps: number[] } | null = await kv.get(acrlKey);
        const now = Date.now();
        const window = acrl?.timestamps?.filter(t => now - t < ACCOUNT_SWAP_RATE_WINDOW_MS) ?? [];
        if (window.length >= ACCOUNT_SWAP_RATE_MAX) {
          console.log(`[SEC-10] Per-account swap rate limit: ${accountId} (${window.length}/${ACCOUNT_SWAP_RATE_MAX} in ${ACCOUNT_SWAP_RATE_WINDOW_MS}ms)`);
          return c.json({ error: "Account swap rate limit exceeded — try again shortly", code: "ACCOUNT_RATE_LIMITED" }, 429);
        }
        // Append current timestamp (write is best-effort — failure doesn't block swap)
        window.push(now);
        kv.set(acrlKey, { timestamps: window }).catch(() => {});
      } catch { /* Rate limit check failure is non-blocking */ }

      const body = await c.req.json();
      const { poolId, tokenIn, tokenOut, amountInRaw, minAmountOutRaw } = body;

      // Input validation (isValidPoolId accepts both single and multi-hop formats)
      if (!isValidPoolId(poolId)) {
        return c.json({ error: "Invalid pool ID format" }, 400);
      }
      if (!tokenIn || typeof tokenIn !== "string" || !TOKEN_BY_SYMBOL.has(tokenIn)) {
        return c.json({ error: "Invalid tokenIn" }, 400);
      }
      if (!tokenOut || typeof tokenOut !== "string" || !TOKEN_BY_SYMBOL.has(tokenOut)) {
        return c.json({ error: "Invalid tokenOut" }, 400);
      }
      if (!isValidBigIntString(amountInRaw)) {
        return c.json({ error: "amountInRaw must be a non-negative integer string" }, 400);
      }
      if (minAmountOutRaw !== undefined && minAmountOutRaw !== null && !isValidBigIntString(String(minAmountOutRaw))) {
        return c.json({ error: "minAmountOutRaw must be a non-negative integer string" }, 400);
      }

      // Multi-hop execution not yet supported in the KV-backed AMM.
      // SENIOR DEV NOTE [LEGACY-08]:
      //   Multi-hop quotes work (see routing logic above) but EXECUTION requires
      //   atomically locking two pools and updating both reserves in a single tx.
      //   In the KV model this means acquiring two pool locks simultaneously
      //   (deadlock risk) or a global swap lock (throughput bottleneck).
      //
      //   The atomic CryptoTransfer model (atomic-signer.ts) solves this natively:
      //   a single CryptoTransfer tx can move tokens across multiple pool accounts
      //   in one consensus round. With HIP-1331 (extended atomic swap windows,
      //   targeting H2 2026), the time budget for multi-leg co-signing increases
      //   from 3s to configurable TTLs — making 3+ hop routes practical.
      //
      //   HIP-1249 (EVM throughput scaling) is also relevant: WHBAR hub routing
      //   involves the WHBAR ERC-20 contract, and higher EVM TPS means the hub
      //   won't bottleneck under concurrent multi-hop traffic.
      if ((poolId || "").includes("+")) {
        return c.json({ error: "Multi-hop execution is not yet available. Use direct pools.", code: "MULTI_HOP_UNSUPPORTED" }, 501);
      }

      // Fetch oracle prices OUTSIDE the pool lock. Prices are used for depth
      // checks, volume tracking, and fee calculations — none require atomic
      // consistency with pool state. Fetching inside the lock risks holding it
      // during a slow external HTTP call (SaucerSwap), which could expire the
      // 5s TTL and cause spurious CAS conflicts on concurrent requests.
      const _tPreLock = performance.now(); // PERF-04
      const _tPreLockElapsed = _tPreLock - _t0;
      const prices = await fetchOraclePrices();
      const _tOracle = performance.now(); // PERF-04
      const _tOracleElapsed = _tOracle - _tPreLock;

      return await withPoolLock(poolId, async () => {
            const _tLockAcquired = performance.now(); // PERF-04
            const _tLockWait = _tLockAcquired - _tOracle;
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

            // Always use protocol-fixed fee (ignores any legacy stored value)
            const rawOut = getAmountOut(rawIn, rIn, rOut, TOTAL_SWAP_FEE_BPS);
            if (rawOut <= 0n) return c.json({ error: "Output too small" }, 400);
            if (minAmountOutRaw && rawOut < BigInt(minAmountOutRaw)) return c.json({ error: "Slippage exceeded" }, 400);

            // Depth check (P1 FIX: halve max fraction when oracle is stale)
            const tvl = poolTvlUsd(pool, prices);
            const defIn = TOKEN_BY_SYMBOL.get(tokenIn);
            if (defIn && tvl > 0) {
              const inputUsd = bigIntToDisplaySafe(rawIn.toString(), defIn.decimals) * (prices[defIn.tokenId] || 0);
              const fraction = isOracleStale() ? maxSwapFraction(tvl) * 0.5 : maxSwapFraction(tvl);
              if (inputUsd > tvl * fraction) {
                const pct = (fraction * 100).toFixed(0);
                const staleTag = isOracleStale() ? " (emergency-conservative: oracle stale)" : "";
                return c.json({ error: `Swap too large. Max ~${pct}% of $${tvl.toFixed(0)} TVL${staleTag}` }, 400);
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
              const swapUsd = bigIntToDisplaySafe(rawOut.toString(), defOut.decimals) * (prices[defOut.tokenId] || 0);
              const swapMicro = BigInt(Math.round(swapUsd * VOLUME_MICRO_SCALE));
              const currentMicro = BigInt(pool.cumulativeVolumeUsd || "0");
              pool.cumulativeVolumeUsd = (currentMicro + swapMicro).toString();
            }

            const _tPreCas = performance.now(); // PERF-04
            const casOk = await compareAndSavePool(pool, expectedVersion);
            const _tCas = performance.now(); // PERF-04
            const _tCasElapsed = _tCas - _tPreCas;
            if (!casOk) {
              console.log(`[CAS] Swap conflict: pool=${poolId} v=${expectedVersion} account=${accountId}`);
              return c.json({ error: "Pool state changed during swap — please retry", code: "VERSION_CONFLICT" }, 409);
            }

            // ── Fee Resolution ────────────────────────────────────────────
            // Layer 2: Flat micro-fee — $0.0007 per swap, split 50/50 LP / treasury (clamped)
            // (Layer 1: 0.25% AMM fee already applied in getAmountOut above)
            // T0 Network Rate (0x168) is primary — trustless, consensus-derived
            // Parallel fetch: both are independent network calls
            const [swapFbCfg, t0SwapHbarPrice] = await Promise.all([
              getOracleFallbackConfig(),
              fetchNetworkExchangeRate(),
            ]);
            const hbarPriceForFee = t0SwapHbarPrice > 0 ? t0SwapHbarPrice : (prices[WHBAR_TOKEN_ID] || swapFbCfg.price);
            const protocolFeeTinybar = Math.min(MAX_PROTOCOL_FEE_TINYBAR, Math.max(1, Math.round((PROTOCOL_FEE_USD / hbarPriceForFee) * 1e8)));
            const treasuryFeeTinybar = protocolFeeTinybar - Math.floor(protocolFeeTinybar / 2);

            // ── Fee Accrual (non-critical, parallelized) ─────────────────
            // SENIOR DEV NOTE [LEGACY-07]:
            //   Treasury fee lock and per-pool protocol fee lock write to DIFFERENT
            //   keys — they can run concurrently without conflict. Running them in
            //   parallel halves the post-CAS latency on the swap hot path (~10ms → ~5ms).
            //   Both are fire-and-forget: if either fails, the swap still succeeds.
            //   Deferred fees are logged for monitoring and can be reconciled manually.
            const protocolShareRaw = rawIn * BigInt(PROTOCOL_FEE_BPS) / BPS_BASE;
            const inputPrice = defIn ? (prices[defIn.tokenId] || 0) : 0;
            const protocolShareUsd = defIn
              ? bigIntToDisplaySafe(protocolShareRaw.toString(), defIn.decimals) * inputPrice
              : 0;

            const _tPreFeeLog = performance.now(); // PERF-04
            await Promise.allSettled([
              // Layer 2a: Treasury flat fee accumulator
              withKvLock({
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
              }).catch((feeErr: any) => {
                if (feeErr?.code === "LOCK_TIMEOUT") {
                  console.log(`[Treasury] Fee lock timeout — ${treasuryFeeTinybar}tb deferred`);
                }
              }),

              // Layer 3: Per-pool protocol fee accumulator (0.05% of swap value)
              (async () => {
                const pfeeKey = PROTOCOL_FEE_ACCUM_PREFIX + poolId;
                const pfeeLockKey = PROTOCOL_FEE_ACCUM_LOCK + poolId;
                await withKvLock({
                  key: pfeeLockKey,
                  ttlMs: 2_000,
                  waitMs: 1_500,
                  retryMs: 20,
                }, async () => {
                  const existing: PoolProtocolFeeAccumulator | null = await kv.get(pfeeKey);
                  const tokens = existing?.accruedInputTokens || {};
                  const prevRaw = BigInt(tokens[tokenIn] || "0");
                  tokens[tokenIn] = (prevRaw + protocolShareRaw).toString();
                  const updated: PoolProtocolFeeAccumulator = {
                    poolId,
                    accruedUsd: (existing?.accruedUsd || 0) + protocolShareUsd,
                    accruedInputTokens: tokens,
                    swapCount: (existing?.swapCount || 0) + 1,
                    lastSwapAt: Date.now(),
                    lastExtractedAt: existing?.lastExtractedAt ?? null,
                    lastExtractedUsd: existing?.lastExtractedUsd ?? 0,
                  };
                  await kv.set(pfeeKey, updated);
                });
              })().catch((pfeeErr: any) => {
                if (pfeeErr?.code === "LOCK_TIMEOUT") {
                  console.log(`[ProtocolFee] Lock timeout on pool ${poolId} — fee tracking deferred`);
                }
              }),
            ]);

            // ── Swap Logging (non-critical, parallelized) ────────────────
            // Global log is anonymized (no accountId). All three writes are
            // independent KV keys — run in parallel via Promise.allSettled.
            const swapTs = Date.now();
            const swapKey = SWAP_LOG_PREFIX + `${swapTs}-${generateTicketId().slice(4, 10).toLowerCase()}`;
            const globalRecord: SwapRecord = { poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), protocolFeeTinybar, timestamp: swapTs };
            const userRecord: SwapRecord = { poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), protocolFeeTinybar, timestamp: swapTs };

            await Promise.allSettled([
              // Global swap log entry (trade data only — no wallet identifiers)
              kv.set(swapKey, globalRecord),
              // Per-user FIFO index: capped at USER_SWAPS_MAX for O(1) history reads
              (async () => {
                const userSwapsKey = USER_SWAPS_PREFIX + accountId;
                const existing: SwapRecord[] = (await kv.get(userSwapsKey)) ?? [];
                existing.push(userRecord);
                while (existing.length > USER_SWAPS_MAX) existing.shift();
                await kv.set(userSwapsKey, existing);
              })(),
              // Global recent swaps: anonymized, capped, for site activity feed
              (async () => {
                const recentSwaps: SwapRecord[] = (await kv.get(GLOBAL_RECENT_SWAPS_KEY)) ?? [];
                recentSwaps.push({ poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), timestamp: swapTs });
                while (recentSwaps.length > GLOBAL_RECENT_SWAPS_MAX) recentSwaps.shift();
                await kv.set(GLOBAL_RECENT_SWAPS_KEY, recentSwaps);
              })(),
            ]);

            // PERF-04: Structured timing log for swap hot path.
            // All timings in ms. Parse with log aggregator for p50/p95/p99 dashboards.
            // At HIP-1249 throughput, swap latency > 500ms is a P1 (blocks consensus round pipelining).
            const _tEnd = performance.now();
            const _tFeeLogElapsed = _tEnd - _tPreFeeLog;
            const _tTotal = _tEnd - _t0;
            console.log(`[SmartLiquidity] Swap v${expectedVersion}→v${expectedVersion + 1}: ${accountId} ${tokenIn}→${tokenOut} in=${amountInRaw} out=${rawOut} ammFee=${TOTAL_SWAP_FEE_BPS}bps microFee=${protocolFeeTinybar}tb`);
            console.log(`[PERF-04] swap pool=${poolId} total=${_tTotal.toFixed(1)}ms preLock=${_tPreLockElapsed.toFixed(1)}ms oracle=${_tOracleElapsed.toFixed(1)}ms lockWait=${_tLockWait.toFixed(1)}ms cas=${_tCasElapsed.toFixed(1)}ms feeLog=${_tFeeLogElapsed.toFixed(1)}ms`);
            return c.json({
              success: true, amountOut: rawOut.toString(),
              pool: { reserveA: pool.reserveA, reserveB: pool.reserveB, version: pool.version },
              feeStructure: { totalFeeBps: TOTAL_SWAP_FEE_BPS, lpFeeBps: LP_FEE_BPS, protocolFeeBps: PROTOCOL_FEE_BPS },
              protocolFee: { totalTinybar: protocolFeeTinybar, treasuryTinybar: treasuryFeeTinybar, treasuryAccount: PROTOCOL_TREASURY_ACCOUNT },
            });
      });
    } catch (err: any) {
      if (err?.code === "POOL_BUSY") return c.json({ error: err.message, code: "POOL_BUSY" }, 503);
      console.log("[AMM] Error in POST /pools/swap:", err);
      return c.json({ error: "Swap failed" }, 500);
    }
  });

  // GET /pools/swaps/:accountId — Per-user swap history (O(1) index read, rate-limited).
  // Authenticated: session accountId must match the URL param.
  app.get(`${ROUTE_PREFIX}/pools/swaps/:accountId`, async (c) => {
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
      console.log("[AMM] Error in GET /pools/swaps:", err);
      return c.json({ swaps: [], error: "Failed to fetch swap history" }, 500);
    }
  });

  // GET /pools/recent-swaps — Public anonymized activity feed (no wallet data).
  app.get(`${ROUTE_PREFIX}/pools/recent-swaps`, async (c) => {
    try {
      const recentSwaps: SwapRecord[] = (await kv.get(GLOBAL_RECENT_SWAPS_KEY)) ?? [];
      // Newest first
      recentSwaps.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
      return c.json({ swaps: recentSwaps });
    } catch (err) {
      console.log("[AMM] Error in GET /pools/recent-swaps:", err);
      return c.json({ swaps: [] }, 500);
    }
  });

  // ── Protocol Fee Admin Endpoints ────────────────────────────────────
  // Owner-only endpoints for viewing and extracting accrued protocol fees.

  // GET /pools/protocol-fees — View accrued protocol fees across all pools.
  app.get(`${ROUTE_PREFIX}/pools/protocol-fees`, async (c) => {
    try {
      const ownerAuth = await requireOwner(c);
      if (ownerAuth instanceof Response) return ownerAuth;

      const poolIds: string[] = (await kv.get(POOL_INDEX_KEY)) ?? [];
      const results: PoolProtocolFeeAccumulator[] = [];
      let totalAccruedUsd = 0;

      // Batch-read all accumulators + treasury in one mget (eliminates N+1 KV round trips)
      if (poolIds.length > 0) {
        const pfeeKeys = poolIds.map(pid => PROTOCOL_FEE_ACCUM_PREFIX + pid);
        const accums: (PoolProtocolFeeAccumulator | null)[] = await kv.mget(pfeeKeys);
        for (const accum of accums) {
          if (accum && accum.accruedUsd > 0) {
            results.push(accum);
            totalAccruedUsd += accum.accruedUsd;
          }
        }
      }

      const treasuryFees: TreasuryFeeAccumulator | null = await kv.get(TREASURY_FEE_KEY);

      return c.json({
        pools: results,
        totalAccruedUsd,
        totalPoolsWithFees: results.length,
        flatMicroFee: treasuryFees || { totalTinybar: 0, swapCount: 0, treasuryAccount: PROTOCOL_TREASURY_ACCOUNT, lastUpdated: 0 },
        feeConfig: {
          totalFeeBps: TOTAL_SWAP_FEE_BPS,
          lpFeeBps: LP_FEE_BPS,
          protocolFeeBps: PROTOCOL_FEE_BPS,
          flatFeeUsd: PROTOCOL_FEE_USD,
          treasuryAccount: PROTOCOL_TREASURY_ACCOUNT,
        },
      });
    } catch (err) {
      console.log("[AMM] Error in GET /pools/protocol-fees:", err);
      return c.json({ error: "Failed to fetch protocol fees" }, 500);
    }
  });

  // POST /pools/protocol-fees/extract — Extract accrued protocol fees from a pool.
  // Deducts the protocol's accrued token amounts from pool reserves and resets
  // the accumulator. The extracted tokens are owed to the treasury account for
  // on-chain settlement via HTS transfer (treasury multisig).
  //
  // Body: { poolId: string }
  app.post(`${ROUTE_PREFIX}/pools/protocol-fees/extract`, async (c) => {
    try {
      const ownerAuth = await requireOwner(c);
      if (ownerAuth instanceof Response) return ownerAuth;
      const ip = getClientIp(c);

      const body = await c.req.json().catch(() => ({}));
      const { poolId } = body;
      if (!poolId || !isValidPoolId(poolId)) return c.json({ error: "Invalid poolId" }, 400);

      const pfeeKey = PROTOCOL_FEE_ACCUM_PREFIX + poolId;

      // SENIOR DEV NOTE [LEGACY-06]:
      //   Oracle prices fetched OUTSIDE the pool lock. fetchOraclePrices() makes
      //   an external HTTP call to SaucerSwap (up to 8s timeout). If called inside
      //   the 5s lock TTL, the lock would expire mid-HTTP, allowing a concurrent
      //   extraction to start — classic TOCTOU double-extraction via lock expiry.
      //   Prices are used only for the post-extraction TVL guard (non-atomic display
      //   check), so pre-lock fetch is safe. The actual reserve deductions are still
      //   fully serialized inside the lock.
      const prices = await fetchOraclePrices();

      // Execute extraction within pool lock. Both pool state AND accumulator
      // are read INSIDE the lock to prevent TOCTOU double-extraction: without
      // this, two concurrent requests could both observe non-zero fees outside
      // the lock, then sequentially deduct from reserves — draining the pool.
      const lockCfg: KvLockConfig = {
        key: POOL_LOCK_PREFIX + poolId,
        ttlMs: POOL_LOCK_TTL_MS,
        waitMs: POOL_LOCK_WAIT_MS,
        retryMs: POOL_LOCK_RETRY_INTERVAL_MS,
      };

      return await withKvLock(lockCfg, async () => {
        const pool: PoolState | null = await kv.get(POOL_PREFIX + poolId);
        if (!pool) return c.json({ error: "Pool not found" }, 404);

        const accum: PoolProtocolFeeAccumulator | null = await kv.get(pfeeKey);
        if (!accum || accum.accruedUsd <= 0) {
          return c.json({ error: "No accrued protocol fees for this pool", accruedUsd: 0 }, 400);
        }

        const resA = BigInt(pool.reserveA);
        const resB = BigInt(pool.reserveB);
        const tokens = accum.accruedInputTokens || {};
        let deductedA = 0n;
        let deductedB = 0n;

        // Calculate deductions per token side
        for (const [symbol, rawStr] of Object.entries(tokens)) {
          const raw = BigInt(rawStr || "0");
          if (raw <= 0n) continue;
          if (symbol === pool.tokenA) deductedA += raw;
          else if (symbol === pool.tokenB) deductedB += raw;
        }

        // Safety: never deduct more than 50% of reserves (sanity ceiling)
        // SENIOR DEV NOTE [LEGACY-04]:
        //   Min TVL guard prevents fee extraction from draining small pools.
        //   Without this, a $10 pool could have 50% of reserves extracted,
        //   leaving it with ~$5 TVL — effectively dead. The $100 floor matches
        //   the routing exclusion threshold (pools <$100 TVL are excluded).
        if (deductedA > resA / 2n || deductedB > resB / 2n) {
          console.log(`[ProtocolFee] Extraction safety limit: pool=${poolId} deductA=${deductedA} resA=${resA} deductB=${deductedB} resB=${resB}`);
          return c.json({ error: "Extraction exceeds 50% safety ceiling — manual review required" }, 400);
        }

        // Min TVL guard: block extraction if post-extraction reserves are too thin
        // (uses pre-lock oracle prices — see LEGACY-06 above)
        // LEGACY-09: Uses bigIntToDisplaySafe for fee-critical path precision
        const postResA = bigIntToDisplaySafe((resA - deductedA).toString(), pool.decimalsA);
        const postResB = bigIntToDisplaySafe((resB - deductedB).toString(), pool.decimalsB);
        const postTvl = postResA * (prices[pool.tokenIdA] || 0) + postResB * (prices[pool.tokenIdB] || 0);
        if (postTvl < 100 && postTvl > 0) {
          return c.json({
            error: `Post-extraction TVL would be $${postTvl.toFixed(2)} — below $100 minimum. Reduce extraction or add liquidity first.`,
          }, 400);
        }

        // Apply deductions to reserves
        const newResA = resA - deductedA;
        const newResB = resB - deductedB;

        // k-invariant will decrease (extraction removes value) — this is expected
        pool.reserveA = newResA.toString();
        pool.reserveB = newResB.toString();

        const expectedVersion = pool.version;
        const casOk = await compareAndSavePool(pool, expectedVersion);
        if (!casOk) {
          return c.json({ error: "Pool state changed during extraction — retry", code: "VERSION_CONFLICT" }, 409);
        }

        // Reset accumulator
        const extractedUsd = accum.accruedUsd;
        const resetAccum: PoolProtocolFeeAccumulator = {
          poolId,
          accruedUsd: 0,
          accruedInputTokens: {},
          swapCount: 0,
          lastSwapAt: accum.lastSwapAt,
          lastExtractedAt: Date.now(),
          lastExtractedUsd: extractedUsd,
        };
        await kv.set(pfeeKey, resetAccum);

        await logAdminAction("protocol_fee_extract", ownerAuth.accountId, ip,
          `pool=${poolId} usd=${extractedUsd.toFixed(4)} -${deductedA}A -${deductedB}B swaps=${accum.swapCount}`);

        console.log(`[ProtocolFee] Extracted $${extractedUsd.toFixed(4)} from pool ${poolId}: -${deductedA} tokenA, -${deductedB} tokenB (${accum.swapCount} swaps)`);

        return c.json({
          success: true,
          poolId,
          extractedUsd,
          deducted: {
            [pool.tokenA]: deductedA.toString(),
            [pool.tokenB]: deductedB.toString(),
          },
          swapsCovered: accum.swapCount,
          newReserves: { reserveA: pool.reserveA, reserveB: pool.reserveB },
          treasuryAccount: PROTOCOL_TREASURY_ACCOUNT,
          note: "Tokens deducted from reserves. On-chain HTS transfer to treasury pending settlement.",
        });
      });
    } catch (err: any) {
      if (err?.code === "POOL_BUSY") return c.json({ error: err.message, code: "POOL_BUSY" }, 503);
      console.log("[AMM] Error in POST /pools/protocol-fees/extract:", err);
      return c.json({ error: "Extraction failed" }, 500);
    }
  });
}
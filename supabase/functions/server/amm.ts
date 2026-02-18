// ══════════════════════════════════════════════════════════════════════
// SMART LIQUIDITY — Constant-Product AMM Engine (KV-Backed)
// ══════════════════════════════════════════════════════════════════════
//
// Architecture:
//   - Constant-product AMM (x * y = k) for 2-token pools
//   - All pool state in KV (multi-instance safe, cold-start resilient)
//   - LP share tracking per user per pool
//   - Smart routing: direct → USDC-hop, selects lowest price impact
//   - Oracle prices (T0 Network Rate → SaucerSwap fallback) for UI/TVL only — swaps use reserves
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
  generateTicketId, withKvLock, isValidBigIntString, isValidPoolId,
  POOL_LOCK_RETRY_INTERVAL_MS, ROUTE_PREFIX,
  saucerswapBreaker, isHttpFailure,
} from "./shared.ts";
import type { KvLockConfig } from "./shared.ts";
import { requireAuth, validateSession, requireOwner, logAdminAction, OWNER_ACCOUNT } from "./auth.ts";

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
const TREASURY_FEE_KEY = "sl_treasury_fees";
const TREASURY_FEE_LOCK_KEY = "sl_treasury_lock";
const PROTOCOL_FEE_ACCUM_PREFIX = "sl_pfee_";   // Per-pool protocol fee accumulator
const PROTOCOL_FEE_ACCUM_LOCK = "sl_pfee_lock_"; // Per-pool lock for fee writes
const AMM_KILL_SWITCH_KEY = "amm_kill_switch";

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  SENIOR DEV NOTE — PRE-LAUNCH AMM LOCK                             ║
// ║                                                                     ║
// ║  The AMM is temporarily locked while we complete testing & audits.  ║
// ║  All mutating pool operations (create pool, add liquidity, swap)    ║
// ║  are blocked at the server level.  The frontend mirrors this with   ║
// ║  a locked UI state on every AMM entry point.                        ║
// ║                                                                     ║
// ║  TO GO LIVE:                                                        ║
// ║    1. Set AMM_PRELAUNCH_LOCKED = false below                        ║
// ║    2. Remove the AmmPrelaunchBanner usage in frontend components:   ║
// ║       - SmartLiquidity.tsx       (SwapPanel early-return +          ║
// ║                                   CreatePoolModal + AddLiqModal)    ║
// ║       - TradingPoolsSection.tsx  (CreatePoolModal + AddLiqModal)    ║
// ║       - TradingSwapPanel.tsx     (ammPrelaunch state + banner)      ║
// ║       - PoolCreator.tsx          (AMM_PRELAUNCH_UI_LOCKED gate)     ║
// ║    3. Delete AmmPrelaunchBanner.tsx once no longer imported          ║
// ║    4. Redeploy server + frontend                                    ║
// ║                                                                     ║
// ║  This is SEPARATE from the kill switch (emergency halt).            ║
// ║  This is a planned pre-launch hold.                                 ║
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
    // KV unreachable — fail-open: allow trading to continue.
    // A KV outage already prevents pool mutations (lock acquisition fails),
    // so adding a trading halt here would be redundant and disruptive.
    return false;
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

export const PROTOCOL_FEE_USD = 0.0007;            // $0.0007 per swap = 0.07 cents
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
export const MAX_PROTOCOL_FEE_TINYBAR = 500_000; // ~$0.0014 at $0.28/HBAR — 2× normal fee

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
export const TOTAL_SWAP_FEE_BPS = 25;       // 0.25% total — applied in AMM formula
export const LP_FEE_BPS = 20;               // 0.20% — LP effective share (after protocol extraction)
export const PROTOCOL_FEE_BPS = 5;          // 0.05% — tracked per pool, extractable

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
  // WBTC: HashPort/LayerZero bridge. SaucerSwap lists a different WBTC (0.0.1969769).
  { tokenId: "0.0.1055483", symbol: "WBTC",   name: "Wrapped Bitcoin",       decimals: 8,  fallbackPrice: 104000, bridge: "HashPort", tier: 1,
    saucerswapId: "0.0.1969769" },
  // WETH: HashPort bridge (token ID 0.0.541564). SaucerSwap lists 0.0.1969757 (18 dec).
  // NOTE: Decimals MUST be confirmed on HashScan — HashPort may bridge at 8 or 18.
  { tokenId: "0.0.541564",  symbol: "WETH",   name: "Wrapped Ether",         decimals: 18, fallbackPrice: 2650,   bridge: "HashPort", tier: 1,
    saucerswapId: "0.0.1969757" },
  // LINK: HashPort bridge. SaucerSwap lists 0.0.1970030.
  { tokenId: "0.0.1055495", symbol: "LINK",   name: "Chainlink",             decimals: 8,  fallbackPrice: 16.50,  bridge: "HashPort", tier: 1,
    saucerswapId: "0.0.1970030" },
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
  return {
    ...pool,
    cumulativeVolumeUsd: Number(BigInt(pool.cumulativeVolumeUsd || "0")) / VOLUME_MICRO_SCALE,
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

export const MINIMUM_LIQUIDITY = 1000n;
export const BPS_BASE = 10000n;

export function bigIntSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

/**
 * Parse a decimal string (e.g. "1.5") to raw integer BigInt at given decimal
 * precision. Uses string manipulation, not float math, to avoid IEEE 754
 * precision loss for tokens with >15 significant digits (WETH at 18 decimals).
 */
export function decimalToBigInt(amount: string, decimals: number): bigint {
  const clean = amount.replace(/,/g, "").trim();
  if (!/^\d+\.?\d*$/.test(clean)) return 0n;
  const [whole, frac = ""] = clean.split(".");
  const paddedFrac = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + paddedFrac);
}

/** Constant-product swap output (Uniswap V2 formula). Fee stays in pool. */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const feeMultiplier = BPS_BASE - BigInt(feeBps);
  const amountInWithFee = amountIn * feeMultiplier;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BPS_BASE + amountInWithFee;
  return numerator / denominator;
}

/** Price impact in bps. */
export function getPriceImpactBps(amountIn: bigint, reserveIn: bigint): number {
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
      const res = await saucerswapBreaker.call(
        () => fetch(`${SAUCERSWAP_API_URL}${path}`, {
          headers: { Accept: "application/json" },
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
          // (e.g. SaucerSwap WBTC 0.0.1969769 → our WBTC 0.0.1055483)
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
      console.error("[AMM] Error in GET /oracle/fallback:", err);
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
      console.error("[AMM] Error in PUT /oracle/fallback:", err);
      return c.json({ error: "Failed to update fallback config" }, 500);
    }
  });

  // ── AMM Kill Switch Endpoints (Owner-only) ────────────────────────

  // GET /amm/kill-switch — Public: check if AMM is halted
  app.get(`${ROUTE_PREFIX}/amm/kill-switch`, async (c) => {
    try {
      const state: AmmKillState | null = await kv.get(AMM_KILL_SWITCH_KEY);
      return c.json({
        active: state?.active ?? false,
        activatedAt: state?.activatedAt ?? null,
        reason: state?.reason ?? null,
        prelaunchLocked: AMM_PRELAUNCH_LOCKED,
      });
    } catch {
      return c.json({ active: false }, 500);
    }
  });

  // POST /amm/kill — Owner-only: halt all AMM swaps and new liquidity
  app.post(`${ROUTE_PREFIX}/amm/kill`, async (c) => {
    const ownerAuth = await requireOwner(c);
    if (ownerAuth instanceof Response) return ownerAuth;
    const ip = getClientIp(c);
    try {
      let reason = "Emergency halt";
      try { const body = await c.req.json(); reason = sanitizeString(body.reason || reason, 200); } catch { /* no body */ }
      const state: AmmKillState = {
        active: true,
        activatedAt: Date.now(),
        activatedBy: ownerAuth.accountId,
        reason,
      };
      await kv.set(AMM_KILL_SWITCH_KEY, state);
      _killSwitchCache = { state, ts: Date.now() };
      console.log(`[CRITICAL] AMM KILL SWITCH ACTIVATED by ${ownerAuth.accountId}: ${reason}`);
      logAdminAction("amm_kill_activate", ownerAuth.accountId, ip, reason);
      return c.json({ success: true, ...state });
    } catch (err) {
      console.error("[AMM] Error activating kill switch:", err);
      return c.json({ error: "Failed to activate kill switch" }, 500);
    }
  });

  // POST /amm/resume — Owner-only: resume AMM trading
  app.post(`${ROUTE_PREFIX}/amm/resume`, async (c) => {
    const ownerAuth = await requireOwner(c);
    if (ownerAuth instanceof Response) return ownerAuth;
    const ip = getClientIp(c);
    try {
      const state: AmmKillState = {
        active: false,
        activatedAt: Date.now(),
        activatedBy: ownerAuth.accountId,
        reason: "Resumed by owner",
      };
      await kv.set(AMM_KILL_SWITCH_KEY, state);
      _killSwitchCache = { state, ts: Date.now() };
      console.log(`[AMM] Kill switch DEACTIVATED by ${ownerAuth.accountId}`);
      logAdminAction("amm_kill_resume", ownerAuth.accountId, ip);
      return c.json({ success: true, active: false });
    } catch (err) {
      console.error("[AMM] Error deactivating kill switch:", err);
      return c.json({ error: "Failed to resume AMM" }, 500);
    }
  });

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
      console.error("[AMM] Error in GET /pools:", err);
      return c.json({ error: "Failed to fetch pools" }, 500);
    }
  });

  // GET /pools/prices — Oracle prices for display
  app.get(`${ROUTE_PREFIX}/pools/prices`, async (c) => {
    try {
      const prices = await fetchOraclePrices();
      return c.json({ prices, updatedAt: Math.floor(Date.now() / 1000) });
    } catch (err) {
      console.error("[AMM] Error in GET /pools/prices:", err);
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
      console.error("[AMM] Error in POST /pools/create:", err);
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
      console.error("[AMM] Error in POST /pools/liquidity/add:", err);
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
      console.error("[AMM] Error in POST /pools/liquidity/remove:", err);
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
      console.error("[AMM] Error fetching LP position:", err);
      return c.json({ position: null, error: "Failed to fetch LP position" }, 500);
    }
  });

  // POST /pools/quote — AMM quote with smart routing (direct + USDC-hop).
  app.post(`${ROUTE_PREFIX}/pools/quote`, async (c) => {
    try {
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
      const outDisplay = Number(best.amountOut) / (10 ** defOut.decimals);
      const inDisplay = parseFloat(amountIn);

      // Protocol fee in HBAR — T0 Network Rate (0x168) is primary, SaucerSwap/fallback is backup
      // The network exchange rate from file 0.0.112 is consensus-derived and always current.
      const fbCfg = await getOracleFallbackConfig();
      const t0HbarPrice = await fetchNetworkExchangeRate();
      const hbarPrice = t0HbarPrice > 0 ? t0HbarPrice : (prices[WHBAR_TOKEN_ID] || fbCfg.price);
      const protocolFeeHbar = PROTOCOL_FEE_USD / hbarPrice;
      const protocolFeeTinybar = Math.min(MAX_PROTOCOL_FEE_TINYBAR, Math.max(1, Math.round(protocolFeeHbar * 1e8)));
      const lpRewardTinybar = Math.floor(protocolFeeTinybar / 2);
      const treasuryFeeTinybar = protocolFeeTinybar - lpRewardTinybar;

      // Calculate percentage-based protocol fee (0.05% of swap value)
      const swapValueUsd = inDisplay * (prices[defIn.tokenId] || 0);
      const pctProtocolFeeUsd = swapValueUsd * PROTOCOL_FEE_BPS / 10000;

      return c.json({
        poolId: best.poolId, tokenIn, tokenOut, amountIn: inDisplay, amountOut: outDisplay,
        amountOutRaw: best.amountOut.toString(), amountInRaw: rawIn.toString(),
        route: best.path.join(" → "), priceImpactBps: best.priceImpactBps, feeBps: best.feeBps,
        feeUsd: swapValueUsd * best.feeBps / 10000,
        effectiveRate: outDisplay / inDisplay, minAmountOut: outDisplay * 0.995,
        routeCount: routes.length, inPrice: prices[defIn.tokenId] || 0, outPrice: prices[defOut.tokenId] || 0,
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
      console.error("[AMM] Error in POST /pools/quote:", err);
      return c.json({ error: "Quote failed" }, 500);
    }
  });

  // POST /pools/swap — Authenticated. Lock + CAS protected. Private mempool.
  app.post(`${ROUTE_PREFIX}/pools/swap`, async (c) => {
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

      // Multi-hop execution not yet supported
      if ((poolId || "").includes("+")) {
        return c.json({ error: "Multi-hop execution is not yet available. Use direct pools." }, 501);
      }

      // Fetch oracle prices OUTSIDE the pool lock. Prices are used for depth
      // checks, volume tracking, and fee calculations — none require atomic
      // consistency with pool state. Fetching inside the lock risks holding it
      // during a slow external HTTP call (SaucerSwap), which could expire the
      // 5s TTL and cause spurious CAS conflicts on concurrent requests.
      const prices = await fetchOraclePrices();

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

            // Always use protocol-fixed fee (ignores any legacy stored value)
            const rawOut = getAmountOut(rawIn, rIn, rOut, TOTAL_SWAP_FEE_BPS);
            if (rawOut <= 0n) return c.json({ error: "Output too small" }, 400);
            if (minAmountOutRaw && rawOut < BigInt(minAmountOutRaw)) return c.json({ error: "Slippage exceeded" }, 400);

            // Depth check
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
              console.error(`[CRITICAL] K-invariant violated! kOld=${kOld} kNew=${kNew} pool=${poolId}`);
              return c.json({ error: "K-invariant violated — swap aborted (report to developers)" }, 500);
            }

            pool.swapCount++;
            const defOut = TOKEN_BY_SYMBOL.get(tokenOut);
            if (defOut) {
              const swapUsd = Number(rawOut) / (10 ** defOut.decimals) * (prices[defOut.tokenId] || 0);
              const swapMicro = BigInt(Math.round(swapUsd * VOLUME_MICRO_SCALE));
              const currentMicro = BigInt(pool.cumulativeVolumeUsd || "0");
              pool.cumulativeVolumeUsd = (currentMicro + swapMicro).toString();
            }

            const casOk = await compareAndSavePool(pool, expectedVersion);
            if (!casOk) {
              console.log(`[CAS] Swap conflict: pool=${poolId} v=${expectedVersion} account=${accountId}`);
              return c.json({ error: "Pool state changed during swap — please retry", code: "VERSION_CONFLICT" }, 409);
            }

            // Layer 2: Flat micro-fee — $0.0007 per swap, split 50/50 LP / treasury (clamped)
            // (Layer 1: 0.25% AMM fee already applied in getAmountOut above)
            // T0 Network Rate (0x168) is primary — trustless, consensus-derived
            const swapFbCfg = await getOracleFallbackConfig();
            const t0SwapHbarPrice = await fetchNetworkExchangeRate();
            const hbarPriceForFee = t0SwapHbarPrice > 0 ? t0SwapHbarPrice : (prices[WHBAR_TOKEN_ID] || swapFbCfg.price);
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

            // Layer 3: Per-pool protocol fee accumulator (0.05% of swap value)
            // Tracks the protocol's 5 bps share that remains in pool reserves.
            // Extractable via admin endpoint; until extracted, LPs earn full 0.25%.
            try {
              const pfeeKey = PROTOCOL_FEE_ACCUM_PREFIX + poolId;
              const pfeeLockKey = PROTOCOL_FEE_ACCUM_LOCK + poolId;
              const protocolShareRaw = rawIn * BigInt(PROTOCOL_FEE_BPS) / BPS_BASE;
              const inputPrice = defIn ? (prices[defIn.tokenId] || 0) : 0;
              const protocolShareUsd = defIn
                ? Number(protocolShareRaw) / (10 ** defIn.decimals) * inputPrice
                : 0;
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
            } catch (pfeeErr: any) {
              // Non-critical — swap succeeds even if fee tracking fails.
              if (pfeeErr?.code === "LOCK_TIMEOUT") {
                console.log(`[ProtocolFee] Lock timeout on pool ${poolId} — fee tracking deferred`);
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

            console.log(`[SmartLiquidity] Swap v${expectedVersion}→v${expectedVersion + 1}: ${accountId} ${tokenIn}→${tokenOut} in=${amountInRaw} out=${rawOut} ammFee=${TOTAL_SWAP_FEE_BPS}bps microFee=${protocolFeeTinybar}tb`);
            return c.json({
              success: true, amountOut: rawOut.toString(),
              pool: { reserveA: pool.reserveA, reserveB: pool.reserveB, version: pool.version },
              feeStructure: { totalFeeBps: TOTAL_SWAP_FEE_BPS, lpFeeBps: LP_FEE_BPS, protocolFeeBps: PROTOCOL_FEE_BPS },
              protocolFee: { totalTinybar: protocolFeeTinybar, treasuryTinybar: treasuryFeeTinybar, treasuryAccount: PROTOCOL_TREASURY_ACCOUNT },
            });
      });
    } catch (err: any) {
      if (err?.code === "POOL_BUSY") return c.json({ error: err.message, code: "POOL_BUSY" }, 503);
      console.error("[AMM] Error in POST /pools/swap:", err);
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
      console.error("[AMM] Error in GET /pools/swaps:", err);
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
      console.error("[AMM] Error in GET /pools/recent-swaps:", err);
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

      for (const pid of poolIds) {
        const pfeeKey = PROTOCOL_FEE_ACCUM_PREFIX + pid;
        const accum: PoolProtocolFeeAccumulator | null = await kv.get(pfeeKey);
        if (accum && accum.accruedUsd > 0) {
          results.push(accum);
          totalAccruedUsd += accum.accruedUsd;
        }
      }

      // Also include flat micro-fee treasury
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
      console.error("[AMM] Error in GET /pools/protocol-fees:", err);
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
        if (deductedA > resA / 2n || deductedB > resB / 2n) {
          console.error(`[ProtocolFee] Extraction safety limit: pool=${poolId} deductA=${deductedA} resA=${resA} deductB=${deductedB} resB=${resB}`);
          return c.json({ error: "Extraction exceeds 50% safety ceiling — manual review required" }, 400);
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
      console.error("[AMM] Error in POST /pools/protocol-fees/extract:", err);
      return c.json({ error: "Extraction failed" }, 500);
    }
  });
}
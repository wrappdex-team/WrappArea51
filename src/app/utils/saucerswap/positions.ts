/**
 * [LP-03] SaucerSwap V2 Position Data Service
 *
 * Fetches, enriches, and caches user V2 concentrated liquidity positions.
 *
 * Data pipeline (in priority order):
 *   A. WRAPpDEX server proxy → /ss-proxy?path=/V2/nfts/{accountId}/positions
 *   B. Direct SaucerSwap API → /V2/nfts/{accountId}/positions
 *
 * Pool state (sqrtPriceX96, tickCurrent) is resolved via:
 *   A. In-memory V2 pool cache (from /v2/pools, shared with DeFi dashboard)
 *   B. JSON-RPC eth_call → slot0() on the pool contract
 *
 * Mint fee is resolved via:
 *   A. JSON-RPC eth_call → Factory.mintFee() + Mirror Node exchange rate
 *
 * All computations (token amounts, USD values, in-range status) use the
 * pure math from tick-math.ts — zero external SDK dependencies.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUDIT NOTES:
 *
 * (1) Position amounts are computed from on-chain liquidity + tick range
 *     using the same Uniswap V3 math as the smart contract. This
 *     matches what the user would receive if they closed the position.
 *
 * (2) Unclaimed fees (tokensOwed0/tokensOwed1) come directly from the
 *     SaucerSwap REST API which indexes on-chain feeGrowth deltas.
 *     These may lag by a few seconds behind real-time.
 *
 * (3) USD prices come from the SaucerSwap API token metadata (priceUsd
 *     field) — same source the swap engine uses. No separate oracle.
 *
 * (4) WHBAR positions display as "HBAR" to users. Internally, all
 *     computations use the WHBAR token ID (0.0.1456986).
 *
 * (5) Caching:
 *       Positions list:  30s TTL (can change on every swap/LP action)
 *       V2 pool state:   60s TTL (shared cache, matches DeFi dashboard)
 *       Mint fee:        300s TTL (exchange rate is slow-moving)
 *
 * References:
 *   SaucerSwap Positions API: https://docs.saucerswap.finance
 *   Hedera Mirror Node: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 *   Hedera JSON-RPC Relay: https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 * ════════════════════════════════════════════════════════════════════════
 */

import { log } from "../logger";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import type { HederaNetwork } from "./tokens";
import { htsIdToEvmAddress } from "./tokens";
import {
  MIRROR_NODES,
  JSON_RPC_RELAY,
  SAUCERSWAP_V2_FACTORY,
  SAUCERSWAP_V2_NFT_MANAGER,
  SAUCERSWAP_V2_LP_NFT,
} from "./contracts";
import {
  bytesToHex,
  encodeSlot0,
  decodeSlot0Result,
  encodeLiquidity,
  decodeLiquidityResult,
  encodeMintFee,
  decodeMintFeeResult,
  encodeGetPool,
} from "./abi";
import { makeAbort } from "./prices";
import { resolveContractEvmAddress } from "./pools";
import {
  getSqrtRatioAtTick,
  getAmountsForLiquidity,
  isInRange,
  sqrtPriceX96ToPrice,
} from "./tick-math";

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Types
// ═══════════════════════════════════════════════════════════════════════

/** Raw token data from SaucerSwap V2 positions/pools API */
export interface ApiTokenV2 {
  decimals: number;
  icon?: string;
  id: string;         // HTS token ID (e.g. "0.0.456858")
  name: string;
  price: string;
  priceUsd: number;
  symbol: string;
  dueDiligenceComplete: boolean;
  isFeeOnTransferToken: boolean;
  description: string | null;
  website: string | null;
  twitterHandle: string | null;
  sentinelReport: string | null;
}

/** Raw position data from SaucerSwap REST API /V2/nfts/{accountId}/positions */
export interface ApiNftPositionV2 {
  tokenSN: number;
  accountId: string;
  token0: ApiTokenV2 | undefined;
  token1: ApiTokenV2 | undefined;
  fee: number;           // Fee tier in hundredths of a bip (e.g. 3000 = 0.30%)
  tickLower: number;
  tickUpper: number;
  liquidity: number;     // Note: API returns JS number, may lose precision for very large values
  feeGrowthInside0LastX128: number;
  feeGrowthInside1LastX128: number;
  tokensOwed0: number;
  tokensOwed1: number;
  createdAt: number;     // Unix timestamp seconds
  updatedAt: number;
  lastSyncedAt: number;
  deleted: boolean;
}

/** Raw V2 pool data from SaucerSwap REST API /v2/pools */
export interface ApiLiquidityPoolV2 {
  id: number;
  contractId: string;     // Hedera contract ID (e.g. "0.0.12345678")
  tokenA: ApiTokenV2;
  amountA: string;        // Total reserves, smallest unit
  tokenB: ApiTokenV2;
  amountB: string;
  fee: number;            // Fee tier in hundredths of a bip
  sqrtRatioX96: string;   // Current sqrt price as decimal string
  tickCurrent: number;
  liquidity: string;      // Current in-range liquidity as decimal string
}

/**
 * Enriched V2 position — all computed values for display.
 * This is the primary type consumed by UI components.
 */
export interface V2PositionEnriched {
  // ── Identity ──
  tokenSN: number;
  accountId: string;

  // ── Token Pair ──
  token0: {
    htsId: string;
    symbol: string;
    name: string;
    decimals: number;
    priceUsd: number;
    logo: string;
  };
  token1: {
    htsId: string;
    symbol: string;
    name: string;
    decimals: number;
    priceUsd: number;
    logo: string;
  };

  // ── Pool Parameters ──
  feeTier: number;           // Raw fee tier (e.g. 3000)
  feePercent: number;        // Human-readable (e.g. 0.30)
  poolContractId: string;    // Hedera contract ID of the pool

  // ── Position Range ──
  tickLower: number;
  tickUpper: number;
  priceLower: number;        // Human-readable lower price (token1 per token0)
  priceUpper: number;        // Human-readable upper price
  currentPrice: number;      // Current pool price
  currentTick: number;
  sqrtPriceX96: bigint;
  inRange: boolean;

  // ── Liquidity & Amounts ──
  liquidity: bigint;
  amount0: bigint;           // Current token0 in position (smallest unit)
  amount1: bigint;           // Current token1 in position (smallest unit)
  amount0Human: number;      // Human-readable with decimals applied
  amount1Human: number;

  // ── Fees ──
  tokensOwed0: bigint;       // Unclaimed fee token0 (smallest unit)
  tokensOwed1: bigint;       // Unclaimed fee token1 (smallest unit)
  feesOwed0Human: number;
  feesOwed1Human: number;
  feesOwed0Usd: number;
  feesOwed1Usd: number;
  totalFeesUsd: number;

  // ── USD Valuation ──
  valueToken0Usd: number;
  valueToken1Usd: number;
  totalValueUsd: number;

  // ── Metadata ──
  createdAt: number;         // Unix seconds
  updatedAt: number;
  deleted: boolean;
}

/** Pool state snapshot for position enrichment */
export interface V2PoolState {
  contractId: string;
  sqrtPriceX96: bigint;
  tickCurrent: number;
  liquidity: bigint;
}

/** Mint fee resolved to HBAR */
export interface MintFeeInfo {
  tinycent: number;
  hbarAmount: number;         // In HBAR units (not tinybar)
  tinybarAmount: number;      // In tinybar
  exchangeRate: {
    centEquivalent: number;
    hbarEquivalent: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Constants & Cache Infrastructure
// ═══════════════════════════════════════════════════════════════════════

const WHBAR_TOKEN_ID = "0.0.1456986";

// ── Proxy URL for SaucerSwap API ────────────────────────────────────
const SS_PROXY_URL = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/ss-proxy`;
const SAUCERSWAP_API = "https://api.saucerswap.finance";

// ── Timeouts ────────────────────────────────────────────────────────
const POSITIONS_TIMEOUT_MS = 12_000;
const RPC_TIMEOUT_MS = 15_000;
const EXCHANGE_RATE_TIMEOUT_MS = 8_000;

// ── Cache TTLs ──────────────────────────────────────────────────────
const POSITIONS_CACHE_TTL_MS = 30_000;   // 30s — positions change on every LP action
const POOL_STATE_CACHE_TTL_MS = 60_000;  // 60s — matches DeFi dashboard refresh
const MINT_FEE_CACHE_TTL_MS = 300_000;   // 5min — exchange rate is slow-moving
const V2_POOLS_CACHE_TTL_MS = 60_000;    // 60s — pool list for matching

// ── Position cache: keyed by accountId ──────────────────────────────
const _positionsCache: Map<string, { data: ApiNftPositionV2[]; ts: number }> = new Map();

// ── Mirror Node NFT ownership cache: keyed by accountId ─────────────
// [LP-REM-FIX-4] Authoritative set of LP NFT serials the user owns.
// Fetched from Hedera Mirror Node — the source of truth for HTS NFT ownership.
const _ownedSerialsCache: Map<string, { serials: Set<number>; ts: number }> = new Map();
const OWNED_SERIALS_CACHE_TTL_MS = 30_000; // 30s — same as positions cache

// ── Pool state cache: keyed by contractId ───────────────────────────
const _poolStateCache: Map<string, { data: V2PoolState; ts: number }> = new Map();

// ── V2 pools list cache (used for matching positions to pools) ──────
let _v2PoolsCache: ApiLiquidityPoolV2[] | null = null;
let _v2PoolsCacheTs = 0;

// ── Mint fee cache ──────────────────────────────────────────────────
let _mintFeeCache: MintFeeInfo | null = null;
let _mintFeeCacheTs = 0;

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: SaucerSwap API Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch from SaucerSwap API with server proxy → direct fallback.
 * Similar to saucerFetch in prices.ts but for arbitrary paths
 * that may have non-standard version prefixes (e.g. /V2/).
 */
async function fetchSaucerSwapJson<T>(path: string, timeoutMs: number = POSITIONS_TIMEOUT_MS): Promise<T | null> {
  // Strategy 1: Server proxy (has API key, caching, circuit breaker)
  try {
    const proxyUrl = `${SS_PROXY_URL}?path=${encodeURIComponent(path)}`;
    const res = await fetch(proxyUrl, {
      headers: {
        Authorization: `Bearer ${publicAnonKey}`,
        Accept: "application/json",
      },
      signal: makeAbort(timeoutMs),
    });
    if (res.ok) {
      const data = await res.json() as T;
      log.info("LP-Positions", `[DIAG] Proxy ${path} → OK (${Array.isArray(data) ? data.length + " items" : "object"})`);
      return data;
    }
    // Log the error body for debugging (e.g. whitelist rejection = 400)
    let errBody = "";
    try { errBody = await res.text(); } catch {}
    log.info("LP-Positions", `[DIAG] Proxy ${path} → HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    console.warn(`[LP-Positions] Proxy BLOCKED ${path} → ${res.status}: ${errBody.slice(0, 200)}`);
  } catch (err: any) {
    log.info("LP-Positions", `[DIAG] Proxy ${path} → ${err?.message || err}`);
  }

  // Strategy 2: Direct SaucerSwap API (no API key — public rate limits)
  try {
    const directUrl = SAUCERSWAP_API + path;
    log.info("LP-Positions", `[DIAG] Direct fallback: ${directUrl}`);
    const res = await fetch(directUrl, {
      headers: { Accept: "application/json" },
      signal: makeAbort(timeoutMs),
    });
    if (res.ok) {
      const data = await res.json() as T;
      log.info("LP-Positions", `[DIAG] Direct ${path} → OK (${Array.isArray(data) ? data.length + " items" : "object"})`);
      return data;
    }
    log.info("LP-Positions", `[DIAG] Direct ${path} → HTTP ${res.status}`);
  } catch (err: any) {
    log.info("LP-Positions", `[DIAG] Direct ${path} → ${err?.message || err}`);
    console.warn(`[LP-Positions] Direct fallback also failed for ${path}: ${err?.message}`);
  }

  console.error(`[LP-Positions] BOTH proxy and direct failed for ${path} — returning null`);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: V2 Pool List (for matching positions → pool state)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch all V2 pools from SaucerSwap API.
 * Used to match user positions to their pool's current state.
 *
 * Cached for 60s — shared with the DeFi dashboard page.
 */
async function fetchV2PoolsList(network: HederaNetwork): Promise<ApiLiquidityPoolV2[]> {
  const now = Date.now();
  if (_v2PoolsCache && now - _v2PoolsCacheTs < V2_POOLS_CACHE_TTL_MS) {
    return _v2PoolsCache;
  }

  const data = await fetchSaucerSwapJson<ApiLiquidityPoolV2[]>("/v2/pools");
  if (data && Array.isArray(data) && data.length > 0) {
    _v2PoolsCache = data;
    _v2PoolsCacheTs = now;
    log.info("LP-Positions", `Fetched ${data.length} V2 pools for position matching`);
    return data;
  }

  // Return stale cache if available, empty array if not
  return _v2PoolsCache || [];
}

/**
 * Find a V2 pool by token pair + fee tier.
 *
 * The SaucerSwap API uses tokenA/tokenB ordering which may differ from
 * the position's token0/token1. We match by checking both orderings.
 *
 * @returns Pool data or null if not found
 */
function findPoolInCache(
  token0Id: string,
  token1Id: string,
  feeTier: number,
  pools: ApiLiquidityPoolV2[],
): ApiLiquidityPoolV2 | null {
  for (const pool of pools) {
    const aId = pool.tokenA.id;
    const bId = pool.tokenB.id;
    // Check both orderings — pool may have (tokenA, tokenB) in either order
    const pairMatch = (aId === token0Id && bId === token1Id) ||
                      (aId === token1Id && bId === token0Id);
    if (pairMatch && pool.fee === feeTier) {
      return pool;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: Pool State via JSON-RPC (fallback when pool not in cache)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch pool state (slot0 + liquidity) via JSON-RPC eth_call.
 *
 * Used when the pool isn't found in the V2 pools list (rare — e.g.
 * newly created pool not yet indexed by SaucerSwap API).
 *
 * @param poolContractId - Hedera contract ID of the pool (e.g. "0.0.12345678")
 * @param network - Hedera network
 * @returns Pool state or null on failure
 */
export async function fetchPoolStateViaRPC(
  poolContractId: string,
  network: HederaNetwork,
): Promise<V2PoolState | null> {
  // Check cache
  const cached = _poolStateCache.get(poolContractId);
  if (cached && Date.now() - cached.ts < POOL_STATE_CACHE_TTL_MS) {
    return cached.data;
  }

  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
  const poolEvmAddress = await resolveContractEvmAddress(poolContractId, network);

  const slot0Hex = bytesToHex(encodeSlot0());
  const liquidityHex = bytesToHex(encodeLiquidity());
  const gasHex = "0x" + (300_000).toString(16);

  try {
    // Parallel JSON-RPC calls for slot0 and liquidity
    const [slot0Res, liqRes] = await Promise.all([
      fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(RPC_TIMEOUT_MS),
        body: JSON.stringify({
          jsonrpc: "2.0", method: "eth_call",
          params: [{ to: poolEvmAddress, data: slot0Hex, gas: gasHex }, "latest"],
          id: 1,
        }),
      }),
      fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(RPC_TIMEOUT_MS),
        body: JSON.stringify({
          jsonrpc: "2.0", method: "eth_call",
          params: [{ to: poolEvmAddress, data: liquidityHex, gas: gasHex }, "latest"],
          id: 2,
        }),
      }),
    ]);

    if (!slot0Res.ok || !liqRes.ok) {
      log.info("LP-Positions", `Pool RPC failed: slot0=${slot0Res.status}, liq=${liqRes.status}`);
      return null;
    }

    const slot0Data = await slot0Res.json();
    const liqData = await liqRes.json();

    if (!slot0Data.result || slot0Data.result === "0x" || slot0Data.result.length < 10) {
      log.info("LP-Positions", `slot0() returned empty for pool ${poolContractId}`);
      return null;
    }

    const slot0 = decodeSlot0Result(slot0Data.result);
    if (!slot0) {
      log.info("LP-Positions", `Failed to decode slot0() for pool ${poolContractId}`);
      return null;
    }

    const liquidity = liqData.result && liqData.result !== "0x"
      ? decodeLiquidityResult(liqData.result) ?? 0n
      : 0n;

    const state: V2PoolState = {
      contractId: poolContractId,
      sqrtPriceX96: slot0.sqrtPriceX96,
      tickCurrent: slot0.tick,
      liquidity,
    };

    // Cache result
    _poolStateCache.set(poolContractId, { data: state, ts: Date.now() });

    log.info("LP-Positions",
      `Pool ${poolContractId} state via RPC: tick=${slot0.tick}, sqrtPrice=${slot0.sqrtPriceX96}`);

    return state;
  } catch (err: any) {
    log.info("LP-Positions", `Pool RPC error for ${poolContractId}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Find a pool's contract ID using the V2 Factory.getPool() via JSON-RPC.
 *
 * Used when we have token addresses and fee tier but not the contract ID.
 *
 * @returns Pool contract's EVM address, or null if pool doesn't exist
 */
export async function findPoolViaFactory(
  token0EvmAddress: string,
  token1EvmAddress: string,
  feeTier: number,
  network: HederaNetwork,
): Promise<string | null> {
  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
  const factoryId = SAUCERSWAP_V2_FACTORY[network] || SAUCERSWAP_V2_FACTORY.mainnet;
  const factoryEvm = await resolveContractEvmAddress(factoryId, network);

  const callData = encodeGetPool(token0EvmAddress, token1EvmAddress, feeTier);
  const callDataHex = bytesToHex(callData);
  const gasHex = "0x" + (300_000).toString(16);

  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(RPC_TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call",
        params: [{ to: factoryEvm, data: callDataHex, gas: gasHex }, "latest"],
        id: 1,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.result || data.result === "0x" || data.result.length < 42) return null;

    // Result is an ABI-encoded address (32 bytes, address in last 20 bytes)
    const hex = data.result.replace("0x", "");
    if (hex.length < 64) return null;

    // Extract the address (last 40 hex chars of the 64-char word)
    const addressHex = hex.slice(24, 64);

    // Check for zero address (pool doesn't exist)
    if (addressHex === "0".repeat(40)) {
      log.info("LP-Positions", `Pool not found via Factory for fee=${feeTier}`);
      return null;
    }

    return "0x" + addressHex;
  } catch (err: any) {
    log.info("LP-Positions", `Factory.getPool RPC error: ${err?.message || err}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Mint Fee Resolution
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch the current mint fee for creating/increasing V2 liquidity positions.
 *
 * Pipeline:
 *   1. JSON-RPC eth_call → Factory.mintFee() → tinycent (USD)
 *   2. Mirror Node → /api/v1/network/exchangerate → cent/HBAR ratio
 *   3. Convert: tinybar = tinycent / (centEquivalent / hbarEquivalent)
 *
 * Cached for 5 minutes (exchange rate updates are infrequent).
 *
 * @returns Mint fee info with HBAR amount, or null on failure
 */
export async function fetchMintFeeInfo(
  network: HederaNetwork,
): Promise<MintFeeInfo | null> {
  // Check cache
  if (_mintFeeCache && Date.now() - _mintFeeCacheTs < MINT_FEE_CACHE_TTL_MS) {
    return _mintFeeCache;
  }

  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
  const factoryId = SAUCERSWAP_V2_FACTORY[network] || SAUCERSWAP_V2_FACTORY.mainnet;
  const factoryEvm = await resolveContractEvmAddress(factoryId, network);

  const mintFeeHex = bytesToHex(encodeMintFee());
  const gasHex = "0x" + (300_000).toString(16);

  try {
    // ── Step 1: Get mint fee in tinycent from Factory ──────────────
    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(RPC_TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call",
        params: [{ to: factoryEvm, data: mintFeeHex, gas: gasHex }, "latest"],
        id: 1,
      }),
    });

    if (!rpcRes.ok) {
      log.info("LP-Positions", `mintFee() RPC HTTP ${rpcRes.status}`);
      return null;
    }

    const rpcData = await rpcRes.json();
    if (!rpcData.result || rpcData.result === "0x") {
      log.info("LP-Positions", `mintFee() returned empty`);
      return null;
    }

    const tinycentBigInt = decodeMintFeeResult(rpcData.result);
    if (tinycentBigInt === null) {
      log.info("LP-Positions", `Failed to decode mintFee() result`);
      return null;
    }
    const tinycent = Number(tinycentBigInt);

    // ── Step 2: Get exchange rate from Mirror Node ────────────────
    const mirrorBase = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const rateRes = await fetch(`${mirrorBase}/api/v1/network/exchangerate`, {
      signal: makeAbort(EXCHANGE_RATE_TIMEOUT_MS),
    });

    if (!rateRes.ok) {
      log.info("LP-Positions", `Exchange rate HTTP ${rateRes.status}`);
      return null;
    }

    const rateData = await rateRes.json();
    const currentRate = rateData.current_rate;
    if (!currentRate || !currentRate.cent_equivalent || !currentRate.hbar_equivalent) {
      log.info("LP-Positions", `Invalid exchange rate response`);
      return null;
    }

    const centEquivalent = Number(currentRate.cent_equivalent);
    const hbarEquivalent = Number(currentRate.hbar_equivalent);

    if (centEquivalent <= 0 || hbarEquivalent <= 0) {
      log.info("LP-Positions", `Zero exchange rate: cent=${centEquivalent}, hbar=${hbarEquivalent}`);
      return null;
    }

    // ── Step 3: Convert tinycent → tinybar → HBAR ────────────────
    // Per official SaucerSwap docs:
    //   https://docs.saucerswap.finance/technical-reference/concentrated-liquidity/liquidity-position-fee
    // mintFee() returns the fee in "tinycent" (a SaucerSwap-specific unit).
    // Conversion: tinybar = tinycent / (centEquivalent / hbarEquivalent)
    // Then:       HBAR    = tinybar / 100_000_000
    // NOTE: "tinycent" is NOT 1/100th of a cent — it maps directly to
    // tinybar via the exchange rate ratio. The official docs confirm
    // this formula with Hbar.from(tinybar, HbarUnit.Tinybar).

    const centToHbarRatio = centEquivalent / hbarEquivalent;
    const tinybarAmount = Math.ceil(tinycent / centToHbarRatio);
    const hbarAmount = tinybarAmount / 100_000_000;

    const result: MintFeeInfo = {
      tinycent,
      hbarAmount,
      tinybarAmount,
      exchangeRate: { centEquivalent, hbarEquivalent },
    };

    // Cache
    _mintFeeCache = result;
    _mintFeeCacheTs = Date.now();

    log.info("LP-Positions",
      `Mint fee: ${tinycent} tinycent = ${hbarAmount.toFixed(4)} HBAR ` +
      `(rate: ${centEquivalent}¢/${hbarEquivalent}ℏ)`);

    return result;
  } catch (err: any) {
    log.info("LP-Positions", `Mint fee fetch error: ${err?.message || err}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: Token Logo Resolution
// ═══════════════════════════════════════════════════════════════════════

/**
 * Resolve a SaucerSwap token icon URL.
 * SaucerSwap API returns relative paths — we prefix with their base URL.
 */
function resolveTokenIcon(apiIcon?: string, symbol?: string): string {
  if (apiIcon) {
    if (apiIcon.startsWith("http")) return apiIcon;
    return `https://www.saucerswap.finance${apiIcon}`;
  }
  // Fallback: SaucerSwap's standard icon path
  const cleanSymbol = (symbol || "unknown").replace("[hts]", "").replace("[HTS]", "").toLowerCase();
  return `https://www.saucerswap.finance/images/tokens/${cleanSymbol}.svg`;
}

/**
 * Normalize WHBAR display.
 * Positions involving WHBAR show "HBAR" to users since we auto-wrap/unwrap.
 */
function displaySymbolForLP(symbol: string, htsId: string): string {
  if (symbol === "WHBAR" || htsId === WHBAR_TOKEN_ID) return "HBAR";
  return symbol.replace("[hts]", "").replace("[HTS]", "");
}

function displayNameForLP(name: string, symbol: string, htsId: string): string {
  if (symbol === "WHBAR" || htsId === WHBAR_TOKEN_ID) return "HBAR";
  return name;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: Position Fetching & Enrichment
// ═══════════════════════════════════════════════════════════════════════

// ── [LP-REM-FIX-4] Mirror Node NFT Ownership Verification ──────────
//
// The SaucerSwap API positions endpoint can return stale data for
// positions whose NFTs have been burned (full removal + burn on
// SaucerSwap's own UI or another frontend). The API indexer may lag
// behind the actual HTS state by minutes or even hours.
//
// The Hedera Mirror Node is the authoritative source for NFT ownership.
// By querying it, we can definitively determine which LP NFT serials
// the user actually holds, and filter out ghost positions before they
// ever reach the UI.
//
// Endpoint: GET /api/v1/tokens/{lpNftTokenId}/nfts?account.id={accountId}
// Returns: { nfts: [{ serial_number: N, ... }, ...], links: { next } }

/**
 * Fetch the set of LP NFT serial numbers the user actually owns on-chain.
 * Uses Hedera Mirror Node — the source of truth for HTS NFT ownership.
 *
 * Paginated: follows `links.next` to get all serials (users may have 100+).
 * Cached for 30s to match the position cache TTL.
 *
 * @returns Set of owned serial numbers, or null if the check failed
 *          (null = skip filtering, don't block the user)
 */
async function fetchOwnedLpNftSerials(
  accountId: string,
  network: HederaNetwork,
): Promise<Set<number> | null> {
  const cacheKey = `${network}:${accountId}`;
  const cached = _ownedSerialsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OWNED_SERIALS_CACHE_TTL_MS) {
    return cached.serials;
  }

  const lpNftTokenId = SAUCERSWAP_V2_LP_NFT[network] || SAUCERSWAP_V2_LP_NFT.mainnet;
  const mirrorBase = MIRROR_NODES[network] || MIRROR_NODES.mainnet;

  const serials = new Set<number>();
  let nextUrl: string | null =
    `${mirrorBase}/api/v1/tokens/${lpNftTokenId}/nfts?account.id=${accountId}&limit=100`;

  try {
    let pages = 0;
    while (nextUrl && pages < 10) { // Safety cap at 10 pages (1000 NFTs)
      pages++;
      const res = await fetch(nextUrl, { signal: makeAbort(8_000) });
      if (!res.ok) {
        log.info("LP-Positions", `[FIX-4] Mirror Node NFT query HTTP ${res.status}`);
        return null; // Don't block on failure — skip filtering
      }
      const data = await res.json();

      if (data.nfts && Array.isArray(data.nfts)) {
        for (const nft of data.nfts) {
          if (typeof nft.serial_number === "number") {
            serials.add(nft.serial_number);
          }
        }
      }

      // Follow pagination
      nextUrl = data.links?.next
        ? (data.links.next.startsWith("http") ? data.links.next : `${mirrorBase}${data.links.next}`)
        : null;
    }

    // Cache the result
    _ownedSerialsCache.set(cacheKey, { serials, ts: Date.now() });

    log.info("LP-Positions",
      `[FIX-4] Mirror Node: user ${accountId} owns ${serials.size} LP NFT serials` +
      (serials.size <= 20 ? `: [${[...serials].join(", ")}]` : ""));

    return serials;
  } catch (err: any) {
    log.info("LP-Positions", `[FIX-4] Mirror Node NFT query failed: ${err?.message || err}`);
    return null; // Don't block on failure
  }
}

/**
 * Fetch raw V2 positions for a given account from SaucerSwap REST API.
 *
 * Note: The SaucerSwap V2 positions endpoint uses UPPERCASE "/V2/" —
 * this is a quirk of their API (different from the lowercase "/v2/pools").
 *
 * @param accountId - Hedera account ID (e.g. "0.0.1234")
 * @param network - Hedera network
 * @returns Array of raw positions (empty if none or on error)
 */
export async function fetchRawV2Positions(
  accountId: string,
  network: HederaNetwork = "mainnet",
): Promise<ApiNftPositionV2[]> {
  if (!accountId || !accountId.startsWith("0.0.")) {
    log.info("LP-Positions", `Invalid accountId: ${accountId}`);
    return [];
  }

  // Check cache
  const cacheKey = `${network}:${accountId}`;
  const cached = _positionsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < POSITIONS_CACHE_TTL_MS) {
    return cached.data;
  }

  // SaucerSwap V2 positions endpoint (note: uppercase /V2/)
  const path = `/V2/nfts/${accountId}/positions`;
  const data = await fetchSaucerSwapJson<ApiNftPositionV2[]>(path, POSITIONS_TIMEOUT_MS);

  if (data && Array.isArray(data)) {
    // Filter out deleted positions AND zero-liquidity ghost positions
    // [LP-REM-FIX-3] Zero liquidity positions are ghosts — the NFT was
    // likely burned but the SaucerSwap API indexer hasn't caught up yet.
    const active = data.filter(p => {
      if (p.deleted) return false;
      if (p.liquidity <= 0 && p.tokensOwed0 <= 0 && p.tokensOwed1 <= 0) {
        log.info("LP-Positions", `Filtering out ghost position SN=${p.tokenSN}: liq=0, owed0=0, owed1=0`);
        return false;
      }
      return true;
    });
    _positionsCache.set(cacheKey, { data: active, ts: Date.now() });
    log.info("LP-Positions", `Fetched ${active.length} active V2 positions for ${accountId} (${data.length} total, ${data.length - active.length} filtered)`);
    return active;
  }

  // Return stale cache if available
  if (cached) {
    log.info("LP-Positions", `Using stale cache for ${accountId} (${cached.data.length} positions)`);
    return cached.data;
  }

  return [];
}

/**
 * Enrich a raw V2 position with computed values: token amounts, USD values,
 * in-range status, and unclaimed fees.
 *
 * @param position - Raw position from SaucerSwap API
 * @param poolState - Pool's current state (sqrtPriceX96, tickCurrent)
 * @returns Enriched position ready for display, or null if data is insufficient
 */
function enrichPosition(
  position: ApiNftPositionV2,
  poolState: V2PoolState,
): V2PositionEnriched | null {
  const { token0: t0, token1: t1 } = position;

  // Validate required token data
  if (!t0 || !t1 || !t0.id || !t1.id) {
    log.info("LP-Positions", `Position SN=${position.tokenSN}: missing token data, skipping`);
    return null;
  }

  try {
    const decimals0 = t0.decimals || 0;
    const decimals1 = t1.decimals || 0;
    const priceUsd0 = t0.priceUsd || 0;
    const priceUsd1 = t1.priceUsd || 0;

    // ── Compute tick-based values ──────────────────────────────────
    const liquidity = BigInt(Math.floor(position.liquidity || 0));
    const sqrtPriceX96 = poolState.sqrtPriceX96;
    const tickCurrent = poolState.tickCurrent;

    // Compute token amounts from liquidity + range
    const sqrtRatioAX96 = getSqrtRatioAtTick(position.tickLower);
    const sqrtRatioBX96 = getSqrtRatioAtTick(position.tickUpper);
    const { amount0, amount1 } = getAmountsForLiquidity(
      sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, liquidity,
    );

    // Convert to human-readable
    const amount0Human = Number(amount0) / Math.pow(10, decimals0);
    const amount1Human = Number(amount1) / Math.pow(10, decimals1);

    // ── Price computation ──────────────────────────────────────────
    const currentPrice = sqrtPriceX96ToPrice(sqrtPriceX96, decimals0, decimals1);
    const priceLower = sqrtPriceX96ToPrice(sqrtRatioAX96, decimals0, decimals1);
    const priceUpper = sqrtPriceX96ToPrice(sqrtRatioBX96, decimals0, decimals1);

    // ── In-range check ─────────────────────────────────────────────
    const posInRange = isInRange(tickCurrent, position.tickLower, position.tickUpper);

    // ── Unclaimed fees ─────────────────────────────────────────────
    // SaucerSwap API returns tokensOwed as numbers (may be fractional)
    const tokensOwed0 = BigInt(Math.floor(position.tokensOwed0 || 0));
    const tokensOwed1 = BigInt(Math.floor(position.tokensOwed1 || 0));
    const feesOwed0Human = Number(tokensOwed0) / Math.pow(10, decimals0);
    const feesOwed1Human = Number(tokensOwed1) / Math.pow(10, decimals1);
    const feesOwed0Usd = feesOwed0Human * priceUsd0;
    const feesOwed1Usd = feesOwed1Human * priceUsd1;

    // ── USD valuation ──────────────────────────────────────────────
    const valueToken0Usd = amount0Human * priceUsd0;
    const valueToken1Usd = amount1Human * priceUsd1;

    return {
      tokenSN: position.tokenSN,
      accountId: position.accountId,

      token0: {
        htsId: t0.id,
        symbol: displaySymbolForLP(t0.symbol, t0.id),
        name: displayNameForLP(t0.name, t0.symbol, t0.id),
        decimals: decimals0,
        priceUsd: priceUsd0,
        logo: resolveTokenIcon(t0.icon, t0.symbol),
      },
      token1: {
        htsId: t1.id,
        symbol: displaySymbolForLP(t1.symbol, t1.id),
        name: displayNameForLP(t1.name, t1.symbol, t1.id),
        decimals: decimals1,
        priceUsd: priceUsd1,
        logo: resolveTokenIcon(t1.icon, t1.symbol),
      },

      feeTier: position.fee,
      feePercent: position.fee / 10_000,
      poolContractId: poolState.contractId,

      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      priceLower,
      priceUpper,
      currentPrice,
      currentTick: tickCurrent,
      sqrtPriceX96,
      inRange: posInRange,

      liquidity,
      amount0,
      amount1,
      amount0Human,
      amount1Human,

      tokensOwed0,
      tokensOwed1,
      feesOwed0Human,
      feesOwed1Human,
      feesOwed0Usd,
      feesOwed1Usd,
      totalFeesUsd: feesOwed0Usd + feesOwed1Usd,

      valueToken0Usd,
      valueToken1Usd,
      totalValueUsd: valueToken0Usd + valueToken1Usd,

      createdAt: position.createdAt,
      updatedAt: position.updatedAt,
      deleted: position.deleted,
    };
  } catch (err: any) {
    log.info("LP-Positions",
      `Failed to enrich position SN=${position.tokenSN}: ${err?.message || err}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9: Main Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch and enrich all V2 positions for a user.
 *
 * This is the primary function consumed by UI components. It:
 *   1. Fetches raw positions from SaucerSwap API
 *   2. Fetches V2 pool list for state matching
 *   3. For each position: matches to pool → enriches with amounts/USD
 *   4. Falls back to JSON-RPC for unmatched pools
 *
 * @param accountId - Hedera account ID
 * @param network - Hedera network
 * @returns Array of enriched positions (may be empty), sorted by USD value desc
 */
export async function fetchUserV2Positions(
  accountId: string,
  network: HederaNetwork = "mainnet",
): Promise<V2PositionEnriched[]> {
  if (!accountId) return [];

  const startMs = Date.now();

  // ── Step 1: Fetch raw positions, V2 pool list, AND owned NFT serials in parallel ──
  const [rawPositions, v2Pools, ownedSerials] = await Promise.all([
    fetchRawV2Positions(accountId, network),
    fetchV2PoolsList(network),
    fetchOwnedLpNftSerials(accountId, network),
  ]);

  if (rawPositions.length === 0) {
    log.info("LP-Positions", `No V2 positions for ${accountId}`);
    return [];
  }

  // ── Step 1.5 [LP-REM-FIX-4]: Filter ghost positions via Mirror Node ──
  // Cross-reference SaucerSwap API positions against the authoritative
  // set of LP NFT serials the user actually owns on-chain.
  // If Mirror Node query failed (ownedSerials === null), skip filtering
  // to avoid blocking legitimate positions.
  let verifiedPositions = rawPositions;
  if (ownedSerials !== null) {
    const beforeCount = rawPositions.length;
    verifiedPositions = rawPositions.filter(p => {
      if (ownedSerials.has(p.tokenSN)) return true;
      log.info("LP-Positions",
        `[FIX-4] GHOST POSITION FILTERED: SN=${p.tokenSN} — NFT not owned (burned/transferred)`);
      return false;
    });
    const ghostCount = beforeCount - verifiedPositions.length;
    if (ghostCount > 0) {
      log.info("LP-Positions",
        `[FIX-4] Filtered ${ghostCount} ghost position(s) via Mirror Node ownership check`);
    }
  } else {
    log.info("LP-Positions",
      "[FIX-4] Mirror Node ownership check unavailable — skipping ghost filter");
  }

  log.info("LP-Positions",
    `Enriching ${verifiedPositions.length} positions against ${v2Pools.length} pools...`);

  // ── Step 2: Match each position to its pool ─────────────────────
  const enriched: V2PositionEnriched[] = [];
  const unmatchedPositions: ApiNftPositionV2[] = [];

  for (const pos of verifiedPositions) {
    if (!pos.token0 || !pos.token1) {
      continue; // Skip positions with missing token data
    }

    // Try to find pool in the cached V2 pools list
    const pool = findPoolInCache(pos.token0.id, pos.token1.id, pos.fee, v2Pools);

    if (pool) {
      // Pool found — use its state for enrichment
      const poolState: V2PoolState = {
        contractId: pool.contractId,
        sqrtPriceX96: BigInt(pool.sqrtRatioX96 || "0"),
        tickCurrent: pool.tickCurrent,
        liquidity: BigInt(pool.liquidity || "0"),
      };

      const result = enrichPosition(pos, poolState);
      if (result) enriched.push(result);
    } else {
      // Pool not in list — queue for RPC fallback
      unmatchedPositions.push(pos);
    }
  }

  // ── Step 3: Handle unmatched positions via JSON-RPC ─────────────
  if (unmatchedPositions.length > 0) {
    log.info("LP-Positions",
      `${unmatchedPositions.length} positions not matched to cached pools — trying RPC fallback`);

    for (const pos of unmatchedPositions) {
      if (!pos.token0 || !pos.token1) continue;

      try {
        // Find pool contract via Factory.getPool()
        const token0Evm = htsIdToEvmAddress(pos.token0.id);
        const token1Evm = htsIdToEvmAddress(pos.token1.id);
        const poolEvmAddress = await findPoolViaFactory(token0Evm, token1Evm, pos.fee, network);

        if (!poolEvmAddress) {
          log.info("LP-Positions",
            `Could not find pool for SN=${pos.tokenSN} (${pos.token0.symbol}/${pos.token1.symbol} @ ${pos.fee})`);
          continue;
        }

        // Get pool state via RPC
        // We need the HTS contract ID — convert from EVM address
        // For RPC calls we can use the EVM address directly
        const poolState = await fetchPoolStateViaRPC(
          `pool-${pos.token0.id}-${pos.token1.id}-${pos.fee}`, // synthetic ID for caching
          network,
        );

        if (poolState) {
          const result = enrichPosition(pos, poolState);
          if (result) enriched.push(result);
        }
      } catch (err: any) {
        log.info("LP-Positions",
          `RPC fallback failed for SN=${pos.tokenSN}: ${err?.message || err}`);
      }
    }
  }

  // ── Step 4: Sort by total USD value (highest first) ─────────────
  enriched.sort((a, b) => b.totalValueUsd - a.totalValueUsd);

  const elapsed = Date.now() - startMs;
  log.info("LP-Positions",
    `Enriched ${enriched.length}/${rawPositions.length} positions for ${accountId} in ${elapsed}ms`);

  return enriched;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 10: Cache Management
// ═══════════════════════════════════════════════════════════════════════

/**
 * Invalidate all position caches.
 * Call after any liquidity mutation (mint, increase, decrease, collect)
 * to ensure the UI reflects the latest on-chain state.
 */
export function invalidatePositionCaches(): void {
  _positionsCache.clear();
  _poolStateCache.clear();
  _ownedSerialsCache.clear(); // [LP-REM-FIX-4] Also clear ownership cache
  log.info("LP-Positions", "All position caches invalidated");
}

/**
 * Invalidate position cache for a specific account.
 * More targeted than invalidatePositionCaches() — use after a single
 * user's LP action to avoid invalidating other users' cached data.
 */
export function invalidatePositionCacheForAccount(accountId: string, network: HederaNetwork = "mainnet"): void {
  const cacheKey = `${network}:${accountId}`;
  _positionsCache.delete(cacheKey);
  _ownedSerialsCache.delete(cacheKey); // [LP-REM-FIX-4] Also clear ownership cache
  log.info("LP-Positions", `Position cache invalidated for ${accountId}`);
}

/**
 * Invalidate the V2 pools list cache.
 * Call when pool data is known to be stale (e.g. after creating a new pool).
 */
export function invalidateV2PoolsCache(): void {
  _v2PoolsCache = null;
  _v2PoolsCacheTs = 0;
  log.info("LP-Positions", "V2 pools list cache invalidated");
}

/**
 * Get the V2 LP NFT token ID for a network.
 * Needed for NFT association checks before minting positions.
 */
export function getV2LpNftTokenId(network: HederaNetwork): string {
  return SAUCERSWAP_V2_LP_NFT[network] || SAUCERSWAP_V2_LP_NFT.mainnet;
}

/**
 * Get the V2 NFT Manager contract ID for a network.
 * Needed as the spender for token allowances during LP operations.
 */
export function getV2NftManagerId(network: HederaNetwork): string {
  return SAUCERSWAP_V2_NFT_MANAGER[network] || SAUCERSWAP_V2_NFT_MANAGER.mainnet;
}
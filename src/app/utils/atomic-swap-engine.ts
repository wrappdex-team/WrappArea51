/**
 * Atomic Swap Engine — Client-Side Constant-Product AMM on Hedera
 *
 * ALL swap math runs in the browser. No server dependency for computation.
 * Reserves are the pool account's actual on-chain token balances, read via
 * Hedera Mirror Node REST API. Settlement is an atomic CryptoTransfer.
 *
 * This module provides:
 *   1. Pure AMM math (constant product x·y=k, BigInt-safe)
 *   2. Mirror Node reserve reading (on-chain ground truth)
 *   3. Transaction building (Hedera SDK TransferTransaction)
 *   4. Swap quoting (reserve read → AMM math → quote)
 *   5. Token whitelist & pool registry
 *
 * The server's ONLY role is co-signing the pool account's side of the
 * CryptoTransfer. It validates the math independently and holds pool keys.
 *
 * SENIOR DEV NOTE [ATOMIC-03]:
 *   The engine is deliberately stateless. No in-memory pool state, no cached
 *   reserves for swap math. Every quote/swap reads fresh reserves from Mirror
 *   Node. This eliminates desync between client and on-chain state.
 *   Performance cost: ~200ms per Mirror Node round-trip. Acceptable for a DEX
 *   where correctness > speed.
 *
 * References:
 *   - Uniswap V2 Whitepaper: https://uniswap.org/whitepaper.pdf
 *   - Hedera TransferTransaction: https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-cryptocurrency
 *   - HIP-16 (Scheduled Transactions): https://hips.hedera.com/hip/hip-16
 *   - Mirror Node REST API: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 */

import type {
  AtomicTokenDef,
  PoolAccountDef,
  PoolReserves,
  AtomicSwapQuote,
  AtomicSwapRequest,
  SwapFeeBreakdown,
  PoolMetrics,
} from "./atomic-swap-types";
import { log } from "./logger";
import { SAUCERSWAP_PARTNER_ID } from "./saucerswap";
import {
  TransferTransaction, AccountId, TokenId, TransactionId, Long,
} from "./hedera-sdk";

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Constants & Configuration
// ═══════════════════════════════════════════════════════════════════════

const MIRROR_NODE_MAINNET = "https://mainnet-public.mirrornode.hedera.com";
const HASHSCAN_URL = "https://hashscan.io/mainnet";

/** Fetch timeout for Mirror Node queries (ms) */
const MIRROR_TIMEOUT_MS = 10_000;

// ── AMM Fee Constants (protocol-fixed, matches server) ──────────────

/** Total swap fee in basis points — stays in pool reserves (increases k) */
export const TOTAL_SWAP_FEE_BPS = 25; // 0.25%
/** LP effective share after protocol extraction */
export const LP_FEE_BPS = 20; // 0.20%
/** Protocol share — tracked per pool, extractable by admin */
export const PROTOCOL_FEE_BPS = 5; // 0.05%
/** BPS denominator */
export const BPS_BASE = 10_000n;
/** Minimum liquidity burned on first deposit (Uniswap V2 attack mitigation) */
export const MINIMUM_LIQUIDITY = 1_000n;

/**
 * Flat protocol micro-fee per swap in USD.
 * Converted to HBAR at oracle rate, split 50/50 LP/treasury.
 * Separate from the 0.25% AMM fee.
 */
export const PROTOCOL_FEE_USD = 0.0007;

/** Maximum protocol fee in tinybar — safety ceiling */
export const MAX_PROTOCOL_FEE_TINYBAR = 500_000;

/** Protocol treasury account */
export const PROTOCOL_TREASURY_ACCOUNT = "0.0.9695738";

/**
 * Maximum swap size as fraction of pool TVL.
 * Depth-proportional caps to prevent manipulation of shallow pools.
 */
function maxSwapFraction(tvlUsd: number): number {
  if (tvlUsd < 10_000) return 0.02; // 2% of sub-$10K pools
  if (tvlUsd < 100_000) return 0.05; // 5% of sub-$100K pools
  return 0.10; // 10% of deep pools
}

/** Minimum pool TVL for routing eligibility — excludes dust pools */
const MIN_ROUTING_TVL_USD = 100;

// ── Default slippage (bps) ──────────────────────────────────────────

export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
export const MAX_SLIPPAGE_BPS = 500; // 5%

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Token Whitelist
// ═══════════════════════════════════════════════════════════════════════
//
// Canonical HTS token IDs on Hedera mainnet. Same whitelist as
// atomic-signer.ts (server) — kept in sync. Bridge token decimals
// MUST be confirmed on HashScan before mainnet trading goes live.
//
// Oracle price resolution order:
//   1. Exact token ID match in SaucerSwap /tokens
//   2. saucerswapId alias lookup
//   3. Symbol-based fallback
//   4. Hardcoded fallback (stale — last resort)

export const TOKEN_WHITELIST: AtomicTokenDef[] = [
  // ── Routing Hub ─────────────────────────────────────────────────────
  {
    tokenId: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR",
    decimals: 8, fallbackPriceUsd: 0.10, tier: 1, // [C33-01] Updated from 0.28 to match current oracle
    evmAddress: "0x000000000000000000000000000000000011F6bF",
  },

  // ── Stablecoins ─────────────────────────────────────────────────────
  { tokenId: "0.0.456858",  symbol: "USDC",   name: "USD Coin",              decimals: 6,  fallbackPriceUsd: 1.00,   tier: 1, bridge: "Circle" },
  { tokenId: "0.0.4291336", symbol: "USDT",   name: "Tether USD",            decimals: 6,  fallbackPriceUsd: 1.00,   tier: 1, bridge: "Tether" },
  { tokenId: "0.0.1055477", symbol: "DAI",    name: "Dai Stablecoin",        decimals: 8,  fallbackPriceUsd: 1.00,   bridge: "HashPort", tier: 1 },
  { tokenId: "0.0.1055459", symbol: "USDCh",  name: "USDC (HashPort)",       decimals: 6,  fallbackPriceUsd: 1.00,   bridge: "HashPort", tier: 2 },
  { tokenId: "0.0.1055472", symbol: "USDTh",  name: "USDT (HashPort)",       decimals: 6,  fallbackPriceUsd: 1.00,   bridge: "HashPort", tier: 2 },

  // ── Major Wrapped Assets ────────────────────────────────────────────
  // [C85] Updated saucerswapId aliases to current SaucerSwap API values
  { tokenId: "0.0.1055483", symbol: "WBTC",   name: "Wrapped Bitcoin",       decimals: 8,  fallbackPriceUsd: 104000, bridge: "HashPort", tier: 1, saucerswapId: "0.0.10104132" },
  { tokenId: "0.0.541564",  symbol: "WETH",   name: "Wrapped Ether",         decimals: 18, fallbackPriceUsd: 2650,   bridge: "HashPort", tier: 1, saucerswapId: "0.0.1969708" },
  { tokenId: "0.0.1055495", symbol: "LINK",   name: "Chainlink",             decimals: 8,  fallbackPriceUsd: 16.50,  bridge: "HashPort", tier: 1, saucerswapId: "0.0.10152778" },
  { tokenId: "0.0.1055498", symbol: "AAVE",   name: "Aave",                  decimals: 8,  fallbackPriceUsd: 17.25,  bridge: "HashPort", tier: 1 }, // [C33-01] Updated from 180.0

  // ── Cross-Chain Wrapped Assets ──────────────────────────────────────
  { tokenId: "0.0.1157005", symbol: "WBNB",   name: "Wrapped BNB",           decimals: 8,  fallbackPriceUsd: 660,    bridge: "LayerZero", tier: 1 },
  { tokenId: "0.0.1157020", symbol: "WAVAX",  name: "Wrapped AVAX",          decimals: 8,  fallbackPriceUsd: 9.15,   bridge: "LayerZero", tier: 1 }, // [C33-01] Updated from 25
  { tokenId: "0.0.540318",  symbol: "WMATIC", name: "Wrapped MATIC",         decimals: 8,  fallbackPriceUsd: 0.13,   bridge: "HashPort", tier: 2 }, // [C33-01] Updated from 0.40
];

/** Tier 1 tokens — eligible for pool creation and routing hubs */
export const ACTIVE_TOKENS = TOKEN_WHITELIST.filter(t => t.tier === 1);

/** Quick lookups */
export const TOKEN_BY_SYMBOL = new Map(TOKEN_WHITELIST.map(t => [t.symbol, t]));
export const TOKEN_BY_ID = new Map(TOKEN_WHITELIST.map(t => [t.tokenId, t]));

/** SaucerSwap alias map: their token ID → our canonical token ID */
const SAUCERSWAP_ALIAS_MAP = new Map<string, string>();
for (const t of TOKEN_WHITELIST) {
  if (t.saucerswapId) SAUCERSWAP_ALIAS_MAP.set(t.saucerswapId, t.tokenId);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Pool Registry
// ═══════════════════════════════════════════════════════════════════════
//
// SENIOR DEV NOTE [ATOMIC-04]:
//   Pool accounts must be created on-chain BEFORE trading can begin.
//   Each pool requires:
//     1. A Hedera account (created via AccountCreateTransaction)
//     2. Token associations for both pool tokens + LP token
//     3. An LP HTS fungible token (created via TokenCreateTransaction)
//     4. Registration here and in the server's pool signer
//     5. Initial liquidity deposit via atomic CryptoTransfer
//
//   Pool accounts listed below with accountId "PENDING" are registered but
//   not yet deployed. The UI will show them as "coming soon."
//
//   When deploying: create the account, associate tokens, create LP token,
//   update the accountId + lpTokenId here and in the server config, then
//   deposit initial liquidity.

export const POOL_REGISTRY: PoolAccountDef[] = [
  {
    poolId: "ap-usdc-whbar",
    tokenA: "USDC",
    tokenB: "WHBAR",
    accountId: "PENDING",     // TODO: Deploy pool account on mainnet
    lpTokenId: "PENDING",     // TODO: Create LP token after pool account
    lpDecimals: 8,
    createdAt: 0,
    status: "paused",         // Will be "active" after deployment
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
  },
  {
    poolId: "ap-usdt-whbar",
    tokenA: "USDT",
    tokenB: "WHBAR",
    accountId: "PENDING",
    lpTokenId: "PENDING",
    lpDecimals: 8,
    createdAt: 0,
    status: "paused",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
  },
  {
    poolId: "ap-usdc-usdt",
    tokenA: "USDC",
    tokenB: "USDT",
    accountId: "PENDING",
    lpTokenId: "PENDING",
    lpDecimals: 8,
    createdAt: 0,
    status: "paused",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
  },
  {
    poolId: "ap-wbtc-whbar",
    tokenA: "WBTC",
    tokenB: "WHBAR",
    accountId: "PENDING",
    lpTokenId: "PENDING",
    lpDecimals: 8,
    createdAt: 0,
    status: "paused",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
  },
  {
    poolId: "ap-weth-whbar",
    tokenA: "WETH",
    tokenB: "WHBAR",
    accountId: "PENDING",
    lpTokenId: "PENDING",
    lpDecimals: 8,
    createdAt: 0,
    status: "paused",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
  },
  {
    poolId: "ap-weth-usdc",
    tokenA: "WETH",
    tokenB: "USDC",
    accountId: "PENDING",
    lpTokenId: "PENDING",
    lpDecimals: 8,
    createdAt: 0,
    status: "paused",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
  },
  {
    poolId: "ap-link-whbar",
    tokenA: "LINK",
    tokenB: "WHBAR",
    accountId: "PENDING",
    lpTokenId: "PENDING",
    lpDecimals: 8,
    createdAt: 0,
    status: "paused",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
  },
  {
    poolId: "ap-dai-usdc",
    tokenA: "DAI",
    tokenB: "USDC",
    accountId: "PENDING",
    lpTokenId: "PENDING",
    lpDecimals: 8,
    createdAt: 0,
    status: "paused",
    swapFeeBps: TOTAL_SWAP_FEE_BPS,
  },
];

/** Active (deployed) pools only */
export const ACTIVE_POOLS = POOL_REGISTRY.filter(p => p.status === "active" && p.accountId !== "PENDING");

/** Pool lookup by ID */
export const POOL_BY_ID = new Map(POOL_REGISTRY.map(p => [p.poolId, p]));

/** Find pool for a given token pair (order-independent) */
export function findPoolForPair(symbolA: string, symbolB: string): PoolAccountDef | null {
  const [a, b] = [symbolA, symbolB].sort();
  return POOL_REGISTRY.find(p => {
    const [pa, pb] = [p.tokenA, p.tokenB].sort();
    return pa === a && pb === b;
  }) ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: AMM Math (Constant Product x·y=k)
// ═══════════════════════════════════════════════════════════════════════
//
// All math uses BigInt to avoid IEEE 754 precision loss.
// These functions are PURE — no side effects, no network calls.
// Identical to server-side math in atomic-signer.ts for deterministic verification.

/**
 * Integer square root (Babylonian method).
 * Used for initial LP share minting: shares = sqrt(A * B) - MINIMUM_LIQUIDITY.
 */
export function bigIntSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("Cannot compute sqrt of negative bigint");
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Parse a decimal string to raw BigInt at given decimal precision.
 * Uses STRING manipulation (not float math) to prevent IEEE 754 precision loss.
 *
 * Example: decimalToBigInt("1.5", 8) → 150_000_000n
 *
 * SEC-04: Input validated to reject malformed/malicious strings.
 */
export function decimalToBigInt(amount: string, decimals: number): bigint {
  const clean = amount.replace(/,/g, "").trim();
  if (!/^\d+\.?\d*$/.test(clean)) return 0n;
  const [whole, frac = ""] = clean.split(".");
  const paddedFrac = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + paddedFrac);
}

/**
 * Convert raw BigInt to display string with specified decimals.
 * Example: bigIntToDecimal(150_000_000n, 8) → "1.5"
 */
export function bigIntToDecimal(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const str = raw.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Constant-product swap output (Uniswap V2 formula).
 * Fee is deducted from input before the swap computation.
 * The fee stays in pool reserves (increases k for LP holders).
 *
 * Formula: amountOut = (amountIn * feeMultiplier * reserveOut) / (reserveIn * BPS_BASE + amountIn * feeMultiplier)
 *
 * @param amountIn  Raw input amount (token's smallest unit)
 * @param reserveIn  Reserve of input token (raw)
 * @param reserveOut Reserve of output token (raw)
 * @param feeBps    Fee in basis points (e.g., 25 = 0.25%)
 * @returns Raw output amount
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const feeMultiplier = BPS_BASE - BigInt(feeBps);
  const amountInWithFee = amountIn * feeMultiplier;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BPS_BASE + amountInWithFee;
  return numerator / denominator;
}

/**
 * Inverse: compute required input for a desired output.
 * Used for "exact output" swaps (user specifies how much they want to receive).
 */
export function getAmountIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  if (amountOut >= reserveOut) return 0n; // Cannot drain pool
  const feeMultiplier = BPS_BASE - BigInt(feeBps);
  const numerator = reserveIn * amountOut * BPS_BASE;
  const denominator = (reserveOut - amountOut) * feeMultiplier;
  return numerator / denominator + 1n; // +1 to ensure sufficient input (round up)
}

/**
 * Price impact in basis points.
 * Measures how much the swap moves the pool's spot price.
 */
export function getPriceImpactBps(amountIn: bigint, reserveIn: bigint): number {
  if (reserveIn <= 0n) return 10_000;
  return Math.min(Number(amountIn * 10_000n / (reserveIn + amountIn)), 10_000);
}

/**
 * Compute spot price of token A in terms of token B.
 * spotPrice = reserveB / reserveA (adjusted for decimals).
 */
export function getSpotPrice(
  reserveA: bigint, decimalsA: number,
  reserveB: bigint, decimalsB: number,
): number {
  if (reserveA <= 0n || reserveB <= 0n) return 0;
  const a = Number(reserveA) / 10 ** decimalsA;
  const b = Number(reserveB) / 10 ** decimalsB;
  return b / a;
}

/**
 * Compute LP shares to mint for a deposit.
 * First deposit: sqrt(amountA * amountB) - MINIMUM_LIQUIDITY
 * Subsequent: min(amountA * totalSupply / reserveA, amountB * totalSupply / reserveB)
 */
export function computeLPSharesMint(
  amountA: bigint, amountB: bigint,
  reserveA: bigint, reserveB: bigint,
  totalSupply: bigint,
): { shares: bigint; isFirstDeposit: boolean } {
  if (totalSupply === 0n) {
    // First deposit: geometric mean minus minimum liquidity lock
    const gm = bigIntSqrt(amountA * amountB);
    if (gm <= MINIMUM_LIQUIDITY) {
      return { shares: 0n, isFirstDeposit: true };
    }
    return { shares: gm - MINIMUM_LIQUIDITY, isFirstDeposit: true };
  }
  // Proportional mint: min of both ratios
  const fromA = amountA * totalSupply / reserveA;
  const fromB = amountB * totalSupply / reserveB;
  return { shares: fromA < fromB ? fromA : fromB, isFirstDeposit: false };
}

/**
 * Compute token amounts returned when burning LP shares.
 */
export function computeLPSharesBurn(
  shares: bigint,
  reserveA: bigint, reserveB: bigint,
  totalSupply: bigint,
): { amountA: bigint; amountB: bigint } {
  if (totalSupply === 0n || shares === 0n) return { amountA: 0n, amountB: 0n };
  return {
    amountA: shares * reserveA / totalSupply,
    amountB: shares * reserveB / totalSupply,
  };
}

/**
 * Compute optimal deposit amounts to match current pool ratio.
 * Given a desired amount of token A, returns the proportional amount of token B.
 */
export function computeOptimalDeposit(
  desiredAmountA: bigint,
  reserveA: bigint, reserveB: bigint,
): bigint {
  if (reserveA === 0n || reserveB === 0n) return 0n;
  return desiredAmountA * reserveB / reserveA;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: Mirror Node Integration (On-Chain Reserve Reading)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch a specific HTS token balance for a Hedera account.
 * Returns the RAW balance (integer units, no decimal adjustment).
 */
async function fetchAccountTokenBalance(
  accountId: string,
  tokenId: string,
): Promise<{ rawBalance: bigint; found: boolean }> {
  try {
    const url = `${MIRROR_NODE_MAINNET}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}&limit=1`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), MIRROR_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn("AtomicSwap", `Mirror Node returned ${res.status} for ${accountId} token ${tokenId}`);
      return { rawBalance: 0n, found: false };
    }

    const data = await res.json();
    const tokens: Array<{ token_id: string; balance: number }> = data.tokens || [];
    if (tokens.length === 0) return { rawBalance: 0n, found: false };

    return { rawBalance: BigInt(tokens[0].balance), found: true };
  } catch (err: any) {
    log.warn("AtomicSwap", `Mirror Node token balance fetch failed: ${err?.message}`);
    return { rawBalance: 0n, found: false };
  }
}

/**
 * Fetch the total supply of an HTS token (for LP share tracking).
 */
async function fetchTokenTotalSupply(tokenId: string): Promise<bigint> {
  if (tokenId === "PENDING") return 0n;
  try {
    const url = `${MIRROR_NODE_MAINNET}/api/v1/tokens/${tokenId}`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), MIRROR_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);

    if (!res.ok) return 0n;
    const data = await res.json();
    return BigInt(data.total_supply ?? "0");
  } catch {
    return 0n;
  }
}

/**
 * Read pool reserves from the Mirror Node — on-chain ground truth.
 * The pool account's HTS token balances ARE the reserves.
 *
 * SENIOR DEV NOTE [ATOMIC-05]:
 *   This is the critical difference from the KV-backed AMM. Reserves are
 *   not a server-managed integer in a database — they are the actual token
 *   balances of a real Hedera account, verifiable by anyone via Mirror Node
 *   or HashScan. No trust required.
 */
export async function fetchPoolReserves(pool: PoolAccountDef): Promise<PoolReserves> {
  const tokenA = TOKEN_BY_SYMBOL.get(pool.tokenA);
  const tokenB = TOKEN_BY_SYMBOL.get(pool.tokenB);

  if (!tokenA || !tokenB) {
    log.error("AtomicSwap", `Unknown tokens in pool ${pool.poolId}: ${pool.tokenA}/${pool.tokenB}`);
    return _emptyReserves(pool);
  }

  if (pool.accountId === "PENDING") {
    return _emptyReserves(pool);
  }

  // Parallel fetch: both token balances + LP total supply
  const [balA, balB, lpSupply] = await Promise.all([
    fetchAccountTokenBalance(pool.accountId, tokenA.tokenId),
    fetchAccountTokenBalance(pool.accountId, tokenB.tokenId),
    fetchTokenTotalSupply(pool.lpTokenId),
  ]);

  return {
    poolId: pool.poolId,
    reserveA: balA.rawBalance,
    reserveB: balB.rawBalance,
    decimalsA: tokenA.decimals,
    decimalsB: tokenB.decimals,
    lpTotalSupply: lpSupply,
    fetchedAt: Date.now(),
    isLive: balA.found && balB.found,
  };
}

function _emptyReserves(pool: PoolAccountDef): PoolReserves {
  const tokenA = TOKEN_BY_SYMBOL.get(pool.tokenA);
  const tokenB = TOKEN_BY_SYMBOL.get(pool.tokenB);
  return {
    poolId: pool.poolId,
    reserveA: 0n,
    reserveB: 0n,
    decimalsA: tokenA?.decimals ?? 0,
    decimalsB: tokenB?.decimals ?? 0,
    lpTotalSupply: 0n,
    fetchedAt: Date.now(),
    isLive: false,
  };
}

/**
 * Fetch reserves for ALL active pools in parallel.
 */
export async function fetchAllPoolReserves(): Promise<Map<string, PoolReserves>> {
  const results = new Map<string, PoolReserves>();
  const activePools = POOL_REGISTRY.filter(p => p.accountId !== "PENDING");

  if (activePools.length === 0) return results;

  const settled = await Promise.allSettled(
    activePools.map(p => fetchPoolReserves(p)),
  );

  for (const result of settled) {
    if (result.status === "fulfilled") {
      results.set(result.value.poolId, result.value);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Oracle Price Fetching (Display Only — Swaps Use Reserves)
// ══════════════════════════════════════════════════════════════════════

/** In-memory oracle cache (short TTL — display prices only) */
let _oracleCache: { prices: Record<string, number>; ts: number } | null = null;
const ORACLE_CACHE_TTL_MS = 30_000; // 30s

/**
 * Fetch oracle prices for all whitelisted tokens.
 * Used ONLY for UI display (TVL, USD values). Swap math uses reserves.
 *
 * Priority:
 *   1. SaucerSwap /tokens API (primary)
 *   2. Hedera Network Exchange Rate (WHBAR only)
 *   3. Hardcoded fallbacks (last resort)
 */
export async function fetchOraclePrices(): Promise<Record<string, number>> {
  // Return cached if fresh
  if (_oracleCache && Date.now() - _oracleCache.ts < ORACLE_CACHE_TTL_MS) {
    return _oracleCache.prices;
  }

  const prices: Record<string, number> = {};

  // Default stablecoin prices
  prices["0.0.456858"] = 1.0;   // USDC
  prices["0.0.4291336"] = 1.0;  // USDT (native — legacy, may not have SaucerSwap pools)
  prices["0.0.1055477"] = 1.0;  // DAI
  prices["0.0.1055459"] = 1.0;  // USDCh
  prices["0.0.1055472"] = 1.0;  // USDT (HashPort — primary SaucerSwap USDT) [C36-04]

  // Try SaucerSwap API
  const variants = ["/tokens", "/v1/tokens", "/v2/tokens"];
  for (const path of variants) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 8_000);
      const res = await fetch(`https://api.saucerswap.finance${path}`, {
        headers: {
          Accept: "application/json",
          ...(SAUCERSWAP_PARTNER_ID ? { "x-api-key": SAUCERSWAP_PARTNER_ID } : {}),
        },
        signal: ctrl.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data)) continue;

      const symPrices: Record<string, number> = {};
      for (const token of data) {
        const id = token.id || token.tokenId;
        const price = parseFloat(token.priceUsd || token.price || "0");
        if (!id || price <= 0) continue;
        const sym = (token.symbol || "").toUpperCase();
        if (sym) symPrices[sym] = price;

        // Primary: exact match
        if (TOKEN_BY_ID.has(id)) { prices[id] = price; continue; }
        // Secondary: SaucerSwap alias
        const aliasTarget = SAUCERSWAP_ALIAS_MAP.get(id);
        if (aliasTarget && !prices[aliasTarget]) prices[aliasTarget] = price;
      }

      // Tertiary: symbol fallback
      for (const t of TOKEN_WHITELIST) {
        if (!prices[t.tokenId] && symPrices[t.symbol]) {
          prices[t.tokenId] = symPrices[t.symbol];
        }
      }

      if (Object.keys(prices).length >= 4) break;
    } catch {
      continue;
    }
  }

  // Hedera Network Exchange Rate (WHBAR — trustless, consensus-derived)
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(`${MIRROR_NODE_MAINNET}/api/v1/network/exchangerate`, {
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const current = data?.current_rate;
      if (current?.cent_equivalent && current?.hbar_equivalent) {
        const priceUsd = current.cent_equivalent / current.hbar_equivalent / 100;
        if (priceUsd > 0.001 && priceUsd < 50) {
          prices["0.0.1456986"] = priceUsd; // WHBAR
        }
      }
    }
  } catch { /* non-critical */ }

  // Fill remaining with fallbacks
  for (const t of TOKEN_WHITELIST) {
    if (!prices[t.tokenId]) prices[t.tokenId] = t.fallbackPriceUsd;
  }

  // ── Oracle Deviation Defense ──────────────────────────────────────
  // Reject oracle prices that deviate >50% from hardcoded fallbacks.
  // Oracle manipulation cannot affect swap execution (swaps use reserves),
  // but TVL/depth-cap calculations depend on oracle prices. A manipulated
  // oracle could push TVL artificially high → widen depth caps → enable
  // larger swaps than intended. This sanity check mitigates that vector.
  //
  // SENIOR DEV NOTE [PERF-02]:
  //   Threshold is 50% (generous) because legitimate price swings can be
  //   large for volatile assets (WETH, WBTC). The goal is catching gross
  //   manipulation (10x), not normal volatility. Stablecoins get a tighter
  //   10% bound since they should never deviate significantly from $1.
  for (const t of TOKEN_WHITELIST) {
    const oraclePrice = prices[t.tokenId];
    const fallback = t.fallbackPriceUsd;
    if (!oraclePrice || !fallback || fallback <= 0) continue;

    const ratio = oraclePrice / fallback;
    const isStable = ["USDC", "USDT", "DAI", "USDCh", "USDTh"].includes(t.symbol);
    const maxDeviation = isStable ? 0.10 : 0.50; // 10% for stables, 50% for volatile

    if (ratio < (1 - maxDeviation) || ratio > (1 + maxDeviation)) {
      log.warn("Oracle", `Price deviation rejected for ${t.symbol}: oracle=$${oraclePrice} fallback=$${fallback} ratio=${ratio.toFixed(3)}`);
      prices[t.tokenId] = fallback; // Fall back to hardcoded price
    }
  }

  _oracleCache = { prices, ts: Date.now() };
  return prices;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: Swap Quoting (Reserves + Math → Quote)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get a swap quote with smart routing (direct → hub-hop).
 *
 * This is the main entry point for the UI's swap interface.
 * Reads fresh reserves from Mirror Node, computes output using AMM math,
 * and returns a detailed quote with fee breakdown.
 *
 * No server call needed — everything computed client-side.
 */
export async function getSwapQuote(
  tokenInSymbol: string,
  tokenOutSymbol: string,
  amountInDisplay: string,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): Promise<AtomicSwapQuote | { error: string }> {
  const defIn = TOKEN_BY_SYMBOL.get(tokenInSymbol);
  const defOut = TOKEN_BY_SYMBOL.get(tokenOutSymbol);
  if (!defIn || !defOut) return { error: `Unknown token. Available: ${ACTIVE_TOKENS.map(t => t.symbol).join(", ")}` };
  if (tokenInSymbol === tokenOutSymbol) return { error: "Cannot swap a token for itself" };

  const parsedAmount = parseFloat(amountInDisplay);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return { error: "Amount must be a positive number" };
  }

  const rawIn = decimalToBigInt(amountInDisplay, defIn.decimals);
  if (rawIn <= 0n) return { error: "Amount too small" };

  // Fetch reserves for all active pools
  const reservesMap = await fetchAllPoolReserves();
  const prices = await fetchOraclePrices();

  // Build route candidates
  interface RouteCandidate {
    poolId: string;
    path: string[];
    amountOut: bigint;
    priceImpactBps: number;
    feeBps: number;
    reservesAt: number;
  }
  const routes: RouteCandidate[] = [];

  // Direct routes
  for (const pool of ACTIVE_POOLS) {
    const reserves = reservesMap.get(pool.poolId);
    if (!reserves || !reserves.isLive) continue;
    if (reserves.reserveA === 0n || reserves.reserveB === 0n) continue;

    const fwd = pool.tokenA === tokenInSymbol && pool.tokenB === tokenOutSymbol;
    const rev = pool.tokenA === tokenOutSymbol && pool.tokenB === tokenInSymbol;
    if (!fwd && !rev) continue;

    const rIn = fwd ? reserves.reserveA : reserves.reserveB;
    const rOut = fwd ? reserves.reserveB : reserves.reserveA;

    // TVL check
    const tvl = _poolTvlUsd(reserves, pool, prices);
    if (tvl > 0 && tvl < MIN_ROUTING_TVL_USD) continue;

    // Depth cap
    const inputUsd = parsedAmount * (prices[defIn.tokenId] || 0);
    if (tvl > 0 && inputUsd > tvl * maxSwapFraction(tvl)) continue;

    const out = getAmountOut(rawIn, rIn, rOut, TOTAL_SWAP_FEE_BPS);
    if (out <= 0n) continue;

    routes.push({
      poolId: pool.poolId,
      path: [tokenInSymbol, tokenOutSymbol],
      amountOut: out,
      priceImpactBps: getPriceImpactBps(rawIn, rIn),
      feeBps: TOTAL_SWAP_FEE_BPS,
      reservesAt: reserves.fetchedAt,
    });
  }

  // Multi-hop routes (A → HUB → B)
  const ROUTING_HUBS = ["USDC", "WHBAR"];
  for (const hub of ROUTING_HUBS) {
    if (tokenInSymbol === hub || tokenOutSymbol === hub) continue;

    for (const p1 of ACTIVE_POOLS) {
      const r1 = reservesMap.get(p1.poolId);
      if (!r1?.isLive || r1.reserveA === 0n || r1.reserveB === 0n) continue;

      const f1 = p1.tokenA === tokenInSymbol && p1.tokenB === hub;
      const v1 = p1.tokenA === hub && p1.tokenB === tokenInSymbol;
      if (!f1 && !v1) continue;

      const r1In = f1 ? r1.reserveA : r1.reserveB;
      const r1Out = f1 ? r1.reserveB : r1.reserveA;
      const mid = getAmountOut(rawIn, r1In, r1Out, TOTAL_SWAP_FEE_BPS);
      if (mid <= 0n) continue;

      for (const p2 of ACTIVE_POOLS) {
        if (p2.poolId === p1.poolId) continue;
        const r2 = reservesMap.get(p2.poolId);
        if (!r2?.isLive || r2.reserveA === 0n || r2.reserveB === 0n) continue;

        const f2 = p2.tokenA === hub && p2.tokenB === tokenOutSymbol;
        const v2 = p2.tokenA === tokenOutSymbol && p2.tokenB === hub;
        if (!f2 && !v2) continue;

        const r2In = f2 ? r2.reserveA : r2.reserveB;
        const r2Out = f2 ? r2.reserveB : r2.reserveA;
        const out = getAmountOut(mid, r2In, r2Out, TOTAL_SWAP_FEE_BPS);
        if (out <= 0n) continue;

        routes.push({
          poolId: `${p1.poolId}+${p2.poolId}`,
          path: [tokenInSymbol, hub, tokenOutSymbol],
          amountOut: out,
          priceImpactBps: getPriceImpactBps(rawIn, r1In) + getPriceImpactBps(mid, r2In),
          feeBps: TOTAL_SWAP_FEE_BPS * 2,
          reservesAt: Math.min(r1.fetchedAt, r2.fetchedAt),
        });
      }
    }
  }

  if (routes.length === 0) {
    // Check if pools exist but are pending
    const pendingPool = findPoolForPair(tokenInSymbol, tokenOutSymbol);
    if (pendingPool && pendingPool.accountId === "PENDING") {
      return { error: `${tokenInSymbol}/${tokenOutSymbol} pool is registered but not yet deployed on Hedera. Coming soon.` };
    }
    return { error: "No route available. Pool may not exist or has no liquidity." };
  }

  // Select best route (highest output)
  routes.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));
  const best = routes[0];

  const outDisplay = Number(best.amountOut) / 10 ** defOut.decimals;
  const inDisplay = parsedAmount;
  const slippageMultiplier = (10_000 - slippageBps) / 10_000;
  const minAmountOut = outDisplay * slippageMultiplier;
  const minAmountOutRaw = best.amountOut * BigInt(10_000 - slippageBps) / 10_000n;

  const inPrice = prices[defIn.tokenId] || 0;
  const outPrice = prices[defOut.tokenId] || 0;
  const swapValueUsd = inDisplay * inPrice;

  return {
    poolId: best.poolId,
    tokenIn: tokenInSymbol,
    tokenOut: tokenOutSymbol,
    amountIn: inDisplay,
    amountOut: outDisplay,
    amountInRaw: rawIn.toString(),
    amountOutRaw: best.amountOut.toString(),
    effectiveRate: inDisplay > 0 ? outDisplay / inDisplay : 0,
    priceImpactBps: best.priceImpactBps,
    feeBps: best.feeBps,
    feeUsd: swapValueUsd * best.feeBps / 10_000,
    route: best.path,
    minAmountOut,
    minAmountOutRaw: minAmountOutRaw.toString(),
    isMultiHop: best.path.length > 2,
    prices: { tokenIn: inPrice, tokenOut: outPrice },
    timestamp: Date.now(),
    reservesAt: best.reservesAt,
  };
}

/**
 * Compute fee breakdown for a swap (display in UI).
 */
export function computeFeeBreakdown(
  amountInDisplay: number,
  tokenInPrice: number,
  hbarPrice: number,
  feeBps: number = TOTAL_SWAP_FEE_BPS,
): SwapFeeBreakdown {
  const swapValueUsd = amountInDisplay * tokenInPrice;
  const ammFeeUsd = swapValueUsd * feeBps / 10_000;
  const protocolFeeHbar = PROTOCOL_FEE_USD / Math.max(hbarPrice, 0.01);
  const networkFeeTinybar = Math.min(
    MAX_PROTOCOL_FEE_TINYBAR,
    Math.max(1, Math.round(protocolFeeHbar * 1e8)),
  );

  return {
    ammFeeBps: feeBps,
    lpFeeBps: LP_FEE_BPS,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    ammFeeUsd,
    networkFeeTinybar,
    hederaNetworkFeeUsd: 0.0001, // Hedera's ~$0.0001 base fee for CryptoTransfer
  };
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 8: Transaction Building (Hedera SDK)
// ═══════════════════════════════════════════════════════════════════════
//
// SENIOR DEV NOTE [ATOMIC-06]:
//   Transactions are built CLIENT-SIDE using the Hedera SDK. The resulting
//   frozen (but unsigned) transaction bytes are sent to the server for
//   pool-side co-signing. The client then sends the pool-signed bytes
//   to the user's wallet (HashPack via WalletConnect) for the final
//   user-side signature + submission.
//
//   Flow: Client builds → Server validates + co-signs → Wallet signs + submits
//
//   The TransferTransaction contains BOTH token legs in a single atomic
//   operation. Hedera consensus guarantees: both execute or neither does.
//   There is no intermediate state.

/**
 * Build an atomic swap TransferTransaction.
 *
 * The transaction moves tokens in both directions atomically:
 *   User → Pool: tokenIn (amountIn)
 *   Pool → User: tokenOut (amountOut)
 *
 * Requires signatures from BOTH the user AND the pool account.
 * The user pays the Hedera network fee (~$0.0001).
 *
 * @returns Frozen transaction bytes (Uint8Array) ready for signing
 */
export async function buildSwapTransaction(
  request: AtomicSwapRequest,
): Promise<{ transactionBytes: Uint8Array; transactionId: string } | { error: string }> {
  try {
    const pool = POOL_BY_ID.get(request.poolId);
    if (!pool) return { error: `Pool ${request.poolId} not found` };
    if (pool.accountId === "PENDING") return { error: `Pool ${request.poolId} is not yet deployed` };
    if (pool.status !== "active") return { error: `Pool ${request.poolId} is paused` };

    const defIn = TOKEN_BY_SYMBOL.get(request.tokenIn);
    const defOut = TOKEN_BY_SYMBOL.get(request.tokenOut);
    if (!defIn || !defOut) return { error: "Unknown token" };

    const userAccount = AccountId.fromString(request.userAccountId);
    const poolAccount = AccountId.fromString(pool.accountId);
    const tokenInId = TokenId.fromString(defIn.tokenId);
    const tokenOutId = TokenId.fromString(defOut.tokenId);
    const amountIn = BigInt(request.amountInRaw);
    const amountOut = BigInt(request.minAmountOutRaw); // Use min (slippage-adjusted)

    // Select consensus nodes (mainnet)
    const nodeAccountIds = [
      AccountId.fromString("0.0.3"),
      AccountId.fromString("0.0.4"),
      AccountId.fromString("0.0.5"),
    ];

    const txId = TransactionId.generate(userAccount);

    const tx = new TransferTransaction()
      // Leg 1: User sends tokenIn to pool
      .addTokenTransfer(tokenInId, userAccount, toLong(-amountIn))
      .addTokenTransfer(tokenInId, poolAccount, toLong(amountIn))
      // Leg 2: Pool sends tokenOut to user
      .addTokenTransfer(tokenOutId, poolAccount, toLong(-amountOut))
      .addTokenTransfer(tokenOutId, userAccount, toLong(amountOut))
      .setNodeAccountIds(nodeAccountIds)
      .setTransactionId(txId)
      .setTransactionMemo(request.memo || `WRAPpDEX:swap:${request.tokenIn}>${request.tokenOut}`)
      .setTransactionValidDuration(180) // 3 minutes
      .freeze();

    const txBytes = tx.toBytes();
    const txIdString = txId.toString();

    log.info("AtomicSwap", `Built swap TX: ${txIdString} | ${request.tokenIn}→${request.tokenOut} | in=${request.amountInRaw} out=${request.minAmountOutRaw}`);

    return { transactionBytes: txBytes, transactionId: txIdString };
  } catch (err: any) {
    log.error("AtomicSwap", `Failed to build swap transaction: ${err?.message}`);
    return { error: `Transaction build failed: ${err?.message}` };
  }
}

/**
 * Build an add-liquidity TransferTransaction.
 *
 * Three-leg atomic transfer:
 *   User → Pool: tokenA (amountA)
 *   User → Pool: tokenB (amountB)
 *   Pool treasury → User: LP tokens (sharesMinted)
 */
export async function buildAddLiquidityTransaction(params: {
  userAccountId: string;
  pool: PoolAccountDef;
  amountARaw: string;
  amountBRaw: string;
  sharesMintedRaw: string;
  memo?: string;
}): Promise<{ transactionBytes: Uint8Array; transactionId: string } | { error: string }> {
  try {
    const defA = TOKEN_BY_SYMBOL.get(params.pool.tokenA);
    const defB = TOKEN_BY_SYMBOL.get(params.pool.tokenB);
    if (!defA || !defB) return { error: "Unknown token" };
    if (params.pool.accountId === "PENDING") return { error: "Pool not deployed" };
    if (params.pool.lpTokenId === "PENDING") return { error: "LP token not created" };

    const userAccount = AccountId.fromString(params.userAccountId);
    const poolAccount = AccountId.fromString(params.pool.accountId);
    const tokenAId = TokenId.fromString(defA.tokenId);
    const tokenBId = TokenId.fromString(defB.tokenId);
    const lpTokenId = TokenId.fromString(params.pool.lpTokenId);

    const nodeAccountIds = [
      AccountId.fromString("0.0.3"),
      AccountId.fromString("0.0.4"),
      AccountId.fromString("0.0.5"),
    ];

    const txId = TransactionId.generate(userAccount);

    const amtA = BigInt(params.amountARaw);
    const amtB = BigInt(params.amountBRaw);
    const shares = BigInt(params.sharesMintedRaw);

    const tx = new TransferTransaction()
      // Leg 1: User sends tokenA to pool
      .addTokenTransfer(tokenAId, userAccount, toLong(-amtA))
      .addTokenTransfer(tokenAId, poolAccount, toLong(amtA))
      // Leg 2: User sends tokenB to pool
      .addTokenTransfer(tokenBId, userAccount, toLong(-amtB))
      .addTokenTransfer(tokenBId, poolAccount, toLong(amtB))
      // Leg 3: Pool sends LP tokens to user
      .addTokenTransfer(lpTokenId, poolAccount, toLong(-shares))
      .addTokenTransfer(lpTokenId, userAccount, toLong(shares))
      .setNodeAccountIds(nodeAccountIds)
      .setTransactionId(txId)
      .setTransactionMemo(params.memo || `WRAPpDEX:addLiq:${params.pool.tokenA}/${params.pool.tokenB}`)
      .setTransactionValidDuration(180)
      .freeze();

    return { transactionBytes: tx.toBytes(), transactionId: txId.toString() };
  } catch (err: any) {
    return { error: `Add liquidity TX build failed: ${err?.message}` };
  }
}

/**
 * Build a remove-liquidity TransferTransaction.
 *
 * Three-leg atomic transfer:
 *   User → Pool: LP tokens (sharesToBurn)
 *   Pool → User: tokenA (proportional)
 *   Pool → User: tokenB (proportional)
 */
export async function buildRemoveLiquidityTransaction(params: {
  userAccountId: string;
  pool: PoolAccountDef;
  sharesRaw: string;
  amountAOutRaw: string;
  amountBOutRaw: string;
  memo?: string;
}): Promise<{ transactionBytes: Uint8Array; transactionId: string } | { error: string }> {
  try {
    const defA = TOKEN_BY_SYMBOL.get(params.pool.tokenA);
    const defB = TOKEN_BY_SYMBOL.get(params.pool.tokenB);
    if (!defA || !defB) return { error: "Unknown token" };
    if (params.pool.accountId === "PENDING") return { error: "Pool not deployed" };
    if (params.pool.lpTokenId === "PENDING") return { error: "LP token not created" };

    const userAccount = AccountId.fromString(params.userAccountId);
    const poolAccount = AccountId.fromString(params.pool.accountId);
    const tokenAId = TokenId.fromString(defA.tokenId);
    const tokenBId = TokenId.fromString(defB.tokenId);
    const lpTokenId = TokenId.fromString(params.pool.lpTokenId);

    const nodeAccountIds = [
      AccountId.fromString("0.0.3"),
      AccountId.fromString("0.0.4"),
      AccountId.fromString("0.0.5"),
    ];

    const txId = TransactionId.generate(userAccount);

    const lpShares = BigInt(params.sharesRaw);
    const amtAOut = BigInt(params.amountAOutRaw);
    const amtBOut = BigInt(params.amountBOutRaw);

    const tx = new TransferTransaction()
      // Leg 1: User sends LP tokens to pool
      .addTokenTransfer(lpTokenId, userAccount, toLong(-lpShares))
      .addTokenTransfer(lpTokenId, poolAccount, toLong(lpShares))
      // Leg 2: Pool sends tokenA to user
      .addTokenTransfer(tokenAId, poolAccount, toLong(-amtAOut))
      .addTokenTransfer(tokenAId, userAccount, toLong(amtAOut))
      // Leg 3: Pool sends tokenB to user
      .addTokenTransfer(tokenBId, poolAccount, toLong(-amtBOut))
      .addTokenTransfer(tokenBId, userAccount, toLong(amtBOut))
      .setNodeAccountIds(nodeAccountIds)
      .setTransactionId(txId)
      .setTransactionMemo(params.memo || `WRAPpDEX:removeLiq:${params.pool.tokenA}/${params.pool.tokenB}`)
      .setTransactionValidDuration(180)
      .freeze();

    return { transactionBytes: tx.toBytes(), transactionId: txId.toString() };
  } catch (err: any) {
    return { error: `Remove liquidity TX build failed: ${err?.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9: Pool Metrics (TVL, Health)
// ═══════════════════════════════════════════════════════════════════════

function _poolTvlUsd(
  reserves: PoolReserves,
  pool: PoolAccountDef,
  prices: Record<string, number>,
): number {
  const tokenA = TOKEN_BY_SYMBOL.get(pool.tokenA);
  const tokenB = TOKEN_BY_SYMBOL.get(pool.tokenB);
  if (!tokenA || !tokenB) return 0;

  const priceA = prices[tokenA.tokenId] || 0;
  const priceB = prices[tokenB.tokenId] || 0;
  const displayA = Number(reserves.reserveA) / 10 ** tokenA.decimals;
  const displayB = Number(reserves.reserveB) / 10 ** tokenB.decimals;

  return displayA * priceA + displayB * priceB;
}

/**
 * Get comprehensive pool metrics (for UI pool list / detail view).
 */
export async function getPoolMetrics(poolId: string): Promise<PoolMetrics | null> {
  const pool = POOL_BY_ID.get(poolId);
  if (!pool) return null;

  const tokenA = TOKEN_BY_SYMBOL.get(pool.tokenA);
  const tokenB = TOKEN_BY_SYMBOL.get(pool.tokenB);
  if (!tokenA || !tokenB) return null;

  if (pool.accountId === "PENDING") {
    return {
      poolId,
      tvlUsd: 0,
      reserveADisplay: 0,
      reserveBDisplay: 0,
      priceA: tokenA.fallbackPriceUsd,
      priceB: tokenB.fallbackPriceUsd,
      hbarBalance: 0,
      tokensAssociated: false,
      lpTotalSupply: 0,
      lastRefreshed: Date.now(),
    };
  }

  const [reserves, prices] = await Promise.all([
    fetchPoolReserves(pool),
    fetchOraclePrices(),
  ]);

  const priceA = prices[tokenA.tokenId] || 0;
  const priceB = prices[tokenB.tokenId] || 0;
  const displayA = Number(reserves.reserveA) / 10 ** tokenA.decimals;
  const displayB = Number(reserves.reserveB) / 10 ** tokenB.decimals;
  const tvlUsd = displayA * priceA + displayB * priceB;

  return {
    poolId,
    tvlUsd,
    reserveADisplay: displayA,
    reserveBDisplay: displayB,
    priceA,
    priceB,
    hbarBalance: 0, // TODO: fetch HBAR balance for rent monitoring
    tokensAssociated: reserves.isLive,
    lpTotalSupply: Number(reserves.lpTotalSupply) / 10 ** pool.lpDecimals,
    lastRefreshed: reserves.fetchedAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 10: Utility / Helpers
// ══════════════════════════════════════════════════════════════════════

/** Generate HashScan URL for a transaction */
export function getSwapHashScanUrl(transactionId: string): string {
  return `${HASHSCAN_URL}/transaction/${transactionId}`;
}

/** Generate HashScan URL for a pool account */
export function getPoolHashScanUrl(accountId: string): string {
  return `${HASHSCAN_URL}/account/${accountId}`;
}

/** Check if an amount exceeds pool depth limits */
export function isSwapTooLarge(
  amountInDisplay: number,
  tokenInPrice: number,
  poolTvlUsd: number,
): boolean {
  if (poolTvlUsd <= 0) return false;
  const inputUsd = amountInDisplay * tokenInPrice;
  return inputUsd > poolTvlUsd * maxSwapFraction(poolTvlUsd);
}

/** Validate a Hedera account ID format */
export function isValidAccountId(id: string): boolean {
  return /^0\.0\.\d{1,10}$/.test(id);
}

/**
 * Get the deployment status of the atomic swap system.
 * Used by the UI to show appropriate messaging.
 */
export function getSystemStatus(): {
  totalPools: number;
  activePools: number;
  pendingPools: number;
  isLive: boolean;
  message: string;
} {
  const total = POOL_REGISTRY.length;
  const active = ACTIVE_POOLS.length;
  const pending = POOL_REGISTRY.filter(p => p.accountId === "PENDING").length;

  return {
    totalPools: total,
    activePools: active,
    pendingPools: pending,
    isLive: active > 0,
    message: active > 0
      ? `${active} pool${active > 1 ? "s" : ""} live with atomic on-chain settlement`
      : `${pending} pool${pending > 1 ? "s" : ""} registered, pending on-chain deployment. AMM math and transaction infrastructure are ready — pools will go live after Hedera account creation and initial liquidity.`,
  };
}
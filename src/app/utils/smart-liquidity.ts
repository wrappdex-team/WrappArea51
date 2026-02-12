/**
 * Smart Liquidity Engine — Real KV-Backed AMM Pools on Hedera
 *
 * All pool state lives on the server (KV-backed). This client module:
 *   - Fetches real pool data from the server (no mock reserves)
 *   - Requests swap quotes computed by the server's constant-product AMM
 *   - Executes swaps that update server-side reserves
 *   - Manages LP positions (add/remove liquidity)
 *   - Displays oracle prices for UI only (swaps use reserves)
 *
 * Token Whitelist (Tier 1 — Top 5 by MC on Hedera):
 *   WBTC:  0.0.1969769  (8 decimals,  HashPort bridge)
 *   WETH:  0.0.1969757  (18 decimals, HashPort bridge)
 *   USDC:  0.0.456858   (6 decimals,  native)
 *   USDT:  0.0.4291336  (6 decimals,  native)
 *   LINK:  0.0.1970030  (8 decimals,  HashPort bridge)
 *
 * HSuite Smart Node Integration (future):
 *   Pool creation and on-chain execution will route through HSuite validators.
 *   Docs: https://docs.hsuite.network/developers
 *   SDK:  https://github.com/HSuiteNetwork/smart-app
 */

import { projectId, publicAnonKey } from "/utils/supabase/info";

// ── Types ───────────────────────────────────────────────────────────

export interface TokenDef {
  tokenId: string;
  symbol: string;
  name: string;
  decimals: number;
  fallbackPrice: number;
  bridge?: string;
  tier: number;
}

export interface PoolState {
  id: string;
  name: string;
  description: string;
  tokenA: string;
  tokenB: string;
  tokenIdA: string;
  tokenIdB: string;
  decimalsA: number;
  decimalsB: number;
  reserveA: string;
  reserveB: string;
  lpTotalSupply: string;
  swapFeeBps: number;
  creator: string;
  createdAt: number;
  cumulativeVolumeUsd: number;
  swapCount: number;
  status: "active" | "paused";
  // Enriched by server
  tvlUsd?: number;
  priceA?: number;
  priceB?: number;
}

export interface LPPosition {
  poolId: string;
  accountId: string;
  shares: string;
  depositedAt: number;
  lastActionAt: number;
}

export interface SwapQuote {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  amountInRaw: string;
  amountOutRaw: string;
  route: string;
  priceImpactBps: number;
  feeBps: number;
  feeUsd: number;
  effectiveRate: number;
  minAmountOut: number;
  routeCount: number;
  inPrice: number;
  outPrice: number;
  timestamp: number;
}

export interface PoolStats {
  totalPools: number;
  totalTvlUsd: number;
  totalVolumeUsd: number;
  avgFeeBps: number;
}

// ── Server API Base ─────────────────────────────────────────────────

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${publicAnonKey}`,
};

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
    signal: options?.signal ?? AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

// ── Token Registry (client-side cache of server whitelist) ──────────

export interface WrappedTokenSeed {
  tokenId: string;
  symbol: string;
  name: string;
  decimals: number;
  fallbackPrice: number;
  logo: string;
  bridge?: string;
}

export const WRAPPED_TOKENS: WrappedTokenSeed[] = [
  { tokenId: "0.0.1969769", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, fallbackPrice: 97000, logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png", bridge: "HashPort" },
  { tokenId: "0.0.1969757", symbol: "WETH", name: "Wrapped Ether", decimals: 18, fallbackPrice: 3600, logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png", bridge: "HashPort" },
  { tokenId: "0.0.456858", symbol: "USDC", name: "USD Coin", decimals: 6, fallbackPrice: 1.00, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
  { tokenId: "0.0.4291336", symbol: "USDT", name: "Tether USD", decimals: 6, fallbackPrice: 1.00, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
  { tokenId: "0.0.1970030", symbol: "LINK", name: "Chainlink", decimals: 8, fallbackPrice: 19.0, logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png", bridge: "HashPort" },
];

const TOKEN_BY_SYMBOL = new Map(WRAPPED_TOKENS.map(t => [t.symbol, t]));

// ── Pool Fetching ───────────────────────────────────────────────────

let _poolsCache: { pools: PoolState[]; tokens: TokenDef[]; prices: Record<string, number>; ts: number } | null = null;
const CACHE_TTL = 30_000;

export async function fetchPools(): Promise<PoolState[]> {
  if (_poolsCache && Date.now() - _poolsCache.ts < CACHE_TTL) return _poolsCache.pools;
  const data = await apiFetch<{ pools: PoolState[]; tokens: TokenDef[]; prices: Record<string, number> }>("/pools");
  _poolsCache = { ...data, ts: Date.now() };
  return data.pools;
}

export async function fetchOraclePrices(): Promise<Record<string, number>> {
  if (_poolsCache && Date.now() - _poolsCache.ts < CACHE_TTL) return _poolsCache.prices;
  const data = await apiFetch<{ prices: Record<string, number> }>("/pools/prices");
  return data.prices;
}

export async function getPoolStats(): Promise<PoolStats> {
  const pools = await fetchPools();
  const totalTvl = pools.reduce((s, p) => s + (p.tvlUsd || 0), 0);
  const totalVol = pools.reduce((s, p) => s + p.cumulativeVolumeUsd, 0);
  const avgFee = pools.length > 0 ? Math.round(pools.reduce((s, p) => s + p.swapFeeBps, 0) / pools.length) : 0;
  return { totalPools: pools.length, totalTvlUsd: totalTvl, totalVolumeUsd: totalVol, avgFeeBps: avgFee };
}

// ── Pool Creation ───────────────────────────────────────────────────

export async function createPool(
  tokenA: string,
  tokenB: string,
  feeBps: number,
  accountId: string,
  name?: string,
  description?: string,
): Promise<{ success: boolean; pool?: PoolState; error?: string }> {
  try {
    return await apiFetch<{ success: boolean; pool: PoolState }>("/pools/create", {
      method: "POST",
      body: JSON.stringify({ tokenA, tokenB, feeBps, accountId, name, description }),
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Liquidity Management ────────────────────────────────────────────

export async function addLiquidity(
  poolId: string,
  amountA: string,
  amountB: string,
  accountId: string,
): Promise<{ success: boolean; sharesMinted?: string; error?: string }> {
  try {
    return await apiFetch("/pools/liquidity/add", {
      method: "POST",
      body: JSON.stringify({ poolId, amountA, amountB, accountId }),
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function removeLiquidity(
  poolId: string,
  shares: string,
  accountId: string,
): Promise<{ success: boolean; amountA?: string; amountB?: string; error?: string }> {
  try {
    return await apiFetch("/pools/liquidity/remove", {
      method: "POST",
      body: JSON.stringify({ poolId, shares, accountId }),
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getLPPosition(
  poolId: string,
  accountId: string,
): Promise<LPPosition | null> {
  try {
    const data = await apiFetch<{ position: LPPosition | null }>(`/pools/position/${poolId}/${accountId}`);
    return data.position;
  } catch {
    return null;
  }
}

// ── Swap Quotes & Execution ─────────────────────────────────────────

export async function getSwapQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: number,
): Promise<SwapQuote | null> {
  try {
    return await apiFetch<SwapQuote>("/pools/quote", {
      method: "POST",
      body: JSON.stringify({ tokenIn, tokenOut, amountIn }),
    });
  } catch (err) {
    console.debug("[SmartLiquidity] Quote failed:", (err as Error).message);
    return null;
  }
}

export async function executeSwap(
  accountId: string,
  poolId: string,
  tokenIn: string,
  tokenOut: string,
  amountInRaw: string,
  minAmountOutRaw?: string,
): Promise<{ success: boolean; amountOut?: string; error?: string }> {
  try {
    return await apiFetch("/pools/swap", {
      method: "POST",
      body: JSON.stringify({ accountId, poolId, tokenIn, tokenOut, amountInRaw, minAmountOutRaw }),
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Oracle Refresh (invalidates client cache) ───────────────────────

export async function refreshOracles(): Promise<void> {
  _poolsCache = null;
  await fetchPools();
}

// ── Formatting Helpers ──────────────────────────────────────────────

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatFeeBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function timeSince(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function displayReserve(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const val = Number(BigInt(raw)) / (10 ** decimals);
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(8);
}

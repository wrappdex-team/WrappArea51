/**
 * Bonzo Finance Integration — Aave V2 lending/borrowing on Hedera
 *
 * Bonzo Finance (bonzo.finance) is an Aave V2 fork deployed on Hedera mainnet.
 * This module provides:
 *   1. Market definitions for 8 target assets (HBAR, USDC, WBTC, WETH, LINK, AAVE, DAI, BONZO)
 *   2. Data fetching via Bonzo Data API + Mirror Node fallback
 *   3. User position fetching
 *   4. Transaction building for supply/withdraw/borrow/repay
 *   5. Deep-links to Bonzo's lending app
 *
 * Data pipeline (in priority order):
 *   A. Bonzo Data API → https://mainnet-data-staging.bonzo.finance/  [REST, real-time]
 *   B. Mirror Node → ProtocolDataProvider.getReserveData(asset)      [on-chain fallback]
 *   C. Defaults: markets shown with null rates, labelled "awaiting data"
 *
 * GitHub: https://github.com/Bonzo-Labs/bonzo-finance-contracts
 */

// ── Types ──────────────────────────────────────────────────────────
import { log } from "./logger";

export interface BonzoMarket {
  id: string;
  symbol: string;
  name: string;
  /** Hedera HTS token ID (or "native" for HBAR) */
  hederaTokenId: string;
  /** EVM address derived from HTS ID, used for contract calls */
  evmAddress: string;
  logo: string;
  decimals: number;

  // ── Rate data (null until API/Mirror Node responds) ──
  supplyAPY: number | null;
  variableBorrowAPY: number | null;
  stableBorrowAPY: number | null;

  // ── Volume data (null until API/Mirror Node responds) ──
  totalSupplyUSD: number | null;
  totalBorrowUSD: number | null;
  availableLiquidityUSD: number | null;
  utilization: number | null;

  // ── Token amounts (raw, non-USD) ──
  totalSupplyNative: number | null;
  totalBorrowNative: number | null;
  availableLiquidityNative: number | null;
  priceUSD: number | null;

  // ── Risk parameters ──
  maxLTV: number | null;
  liquidationThreshold: number | null;
  liquidationBonus: number | null;
  canBeCollateral: boolean;
  borrowEnabled: boolean;

  // ── Links ──
  supplyUrl: string;
  borrowUrl: string;

  /** "live" when fetched from API/chain, "pending" when using defaults */
  dataSource: "live" | "pending";
}

export interface BonzoProtocolStats {
  totalSupplyUSD: number | null;
  totalBorrowUSD: number | null;
  totalMarketsCount: number;
  totalAvailableLiquidityUSD: number | null;
  dataSource: "live" | "pending";
}

export interface BonzoUserPosition {
  symbol: string;
  hederaTokenId: string;
  logo: string;
  decimals: number;
  supplied: number;
  suppliedUSD: number;
  borrowed: number;
  borrowedUSD: number;
  supplyAPY: number;
  borrowAPY: number;
  usedAsCollateral: boolean;
}

export interface BonzoUserSummary {
  totalSuppliedUSD: number;
  totalBorrowedUSD: number;
  healthFactor: number;
  netAPY: number;
  borrowPowerUsed: number;
  positions: BonzoUserPosition[];
}

// ── Constants ──────────────────────────────────────────────────────

/** Bonzo Data API (staging — public, no auth required) */
const BONZO_DATA_API = "https://mainnet-data-staging.bonzo.finance";

/** Bonzo app confirmed URL */
const BONZO_LEND_URL = "https://app.bonzo.finance/lend";

/** Hedera mainnet Mirror Node */
const MIRROR_NODE = "https://mainnet-public.mirrornode.hedera.com";

/** Hedera JSON-RPC relay for EVM calls */
const HEDERA_RPC = "https://mainnet.hashio.io/api";

/**
 * Bonzo contract addresses on Hedera mainnet.
 * Populated from https://github.com/Bonzo-Labs/bonzo-finance-contracts
 */
const BONZO_CONTRACTS = {
  /** EVM address of ProtocolDataProvider (AaveProtocolDataProvider.sol) */
  protocolDataProvider: "" as string,
  /** EVM address of LendingPool (LendingPool.sol) */
  lendingPool: "" as string,
};

// ── Aave V2 LendingPool function selectors ────────────────────────
// Standard Aave V2 selectors — Bonzo is a direct fork
export const LENDING_POOL_SELECTORS = {
  /** deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) */
  deposit: "0xe8eda9df",
  /** withdraw(address asset, uint256 amount, address to) */
  withdraw: "0x69328dec",
  /** borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) */
  borrow: "0xa415bcad",
  /** repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) */
  repay: "0x573ade81",
  /** getUserAccountData(address user) → (totalCollateralETH, totalDebtETH, availableBorrowsETH, currentLiquidationThreshold, ltv, healthFactor) */
  getUserAccountData: "0xbf92857c",
};

// ── HTS ID → EVM address conversion ───────────────────────────────

export function htsIdToEvmAddress(htsId: string): string {
  if (htsId === "native") return "0x0000000000000000000000000000000000000000";
  const parts = htsId.split(".");
  const tokenNum = parseInt(parts[2], 10);
  return "0x" + tokenNum.toString(16).padStart(40, "0");
}

export function accountIdToEvmAddress(accountId: string): string {
  const parts = accountId.split(".");
  const num = parseInt(parts[2], 10);
  return "0x" + num.toString(16).padStart(40, "0");
}

// ── Token registry ─────────────────────────────────────────────────

interface BonzoTokenDef {
  symbol: string;
  name: string;
  hederaTokenId: string;
  decimals: number;
  logo: string;
  canBeCollateral: boolean;
  borrowEnabled: boolean;
  defaultMaxLTV: number;
  defaultLiquidationThreshold: number;
  defaultLiquidationBonus: number;
}

const BONZO_SUPPORTED_TOKENS: BonzoTokenDef[] = [
  {
    symbol: "HBAR",
    name: "Hedera",
    hederaTokenId: "0.0.1456986", // WHBAR on SaucerSwap — Bonzo uses wrapped form
    decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
    canBeCollateral: true,
    borrowEnabled: true,
    defaultMaxLTV: 65,
    defaultLiquidationThreshold: 75,
    defaultLiquidationBonus: 110,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    hederaTokenId: "0.0.456858",
    decimals: 6,
    logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    canBeCollateral: true,
    borrowEnabled: true,
    defaultMaxLTV: 80,
    defaultLiquidationThreshold: 85,
    defaultLiquidationBonus: 105,
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    hederaTokenId: "0.0.1055483",
    decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
    canBeCollateral: true,
    borrowEnabled: true,
    defaultMaxLTV: 70,
    defaultLiquidationThreshold: 80,
    defaultLiquidationBonus: 110,
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    hederaTokenId: "0.0.9770617", // [LIQUIDITY-FIX] Updated to high-liquidity WETH
    decimals: 18,
    logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
    canBeCollateral: true,
    borrowEnabled: true,
    defaultMaxLTV: 75,
    defaultLiquidationThreshold: 82,
    defaultLiquidationBonus: 107,
  },
  {
    symbol: "LINK",
    name: "Chainlink",
    hederaTokenId: "0.0.1969760", // Hashport bridged LINK on Hedera
    decimals: 18,
    logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
    canBeCollateral: true,
    borrowEnabled: true,
    defaultMaxLTV: 60,
    defaultLiquidationThreshold: 70,
    defaultLiquidationBonus: 110,
  },
  {
    symbol: "AAVE",
    name: "Aave",
    hederaTokenId: "0.0.1055498",
    decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png",
    canBeCollateral: true,
    borrowEnabled: true,
    defaultMaxLTV: 55,
    defaultLiquidationThreshold: 70,
    defaultLiquidationBonus: 110,
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    hederaTokenId: "0.0.1055477",
    decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
    canBeCollateral: true,
    borrowEnabled: true,
    defaultMaxLTV: 75,
    defaultLiquidationThreshold: 80,
    defaultLiquidationBonus: 105,
  },
  {
    symbol: "BONZO",
    name: "Bonzo",
    hederaTokenId: "0.0.1540481",
    decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/35498/standard/bonzo.png",
    canBeCollateral: false,
    borrowEnabled: false,
    defaultMaxLTV: 0,
    defaultLiquidationThreshold: 0,
    defaultLiquidationBonus: 0,
  },
];

export { BONZO_SUPPORTED_TOKENS };

// ── ABI selectors for Aave V2 ProtocolDataProvider ─────────────────

const ABI = {
  getReserveData: "0x35ea6a75",
  getReserveConfigurationData: "0x3e150141",
};

// ── Mirror Node contract call ──────────────────────────────────────

async function mirrorCall(to: string, data: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${MIRROR_NODE}/api/v1/contracts/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, to, estimate: false, block: "latest" }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result || null;
  } catch {
    return null;
  }
}

function encodeGetReserveData(assetEvmAddress: string): string {
  const paddedAddr = assetEvmAddress.replace("0x", "").padStart(64, "0");
  return ABI.getReserveData + paddedAddr;
}

function encodeGetReserveConfig(assetEvmAddress: string): string {
  const paddedAddr = assetEvmAddress.replace("0x", "").padStart(64, "0");
  return ABI.getReserveConfigurationData + paddedAddr;
}

/** Aave V2 RAY = 1e27 */
function rayToAPY(rayHex: string): number {
  try {
    const ray = BigInt("0x" + rayHex);
    const RAY = BigInt("1000000000000000000000000000");
    const rateDecimal = Number(ray) / Number(RAY);
    return rateDecimal * 100;
  } catch {
    return 0;
  }
}

function decodeReserveData(result: string): {
  availableLiquidity: bigint;
  totalStableDebt: bigint;
  totalVariableDebt: bigint;
  liquidityRate: string;
  variableBorrowRate: string;
  stableBorrowRate: string;
} | null {
  try {
    const hex = result.replace("0x", "");
    if (hex.length < 640) return null;
    return {
      availableLiquidity: BigInt("0x" + hex.slice(0, 64)),
      totalStableDebt: BigInt("0x" + hex.slice(64, 128)),
      totalVariableDebt: BigInt("0x" + hex.slice(128, 192)),
      liquidityRate: hex.slice(192, 256),
      variableBorrowRate: hex.slice(256, 320),
      stableBorrowRate: hex.slice(320, 384),
    };
  } catch {
    return null;
  }
}

function decodeReserveConfig(result: string): {
  ltv: number;
  liquidationThreshold: number;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  isActive: boolean;
} | null {
  try {
    const hex = result.replace("0x", "");
    if (hex.length < 640) return null;
    return {
      ltv: Number(BigInt("0x" + hex.slice(64, 128))) / 100,
      liquidationThreshold: Number(BigInt("0x" + hex.slice(128, 192))) / 100,
      usageAsCollateralEnabled: BigInt("0x" + hex.slice(320, 384)) !== BigInt(0),
      borrowingEnabled: BigInt("0x" + hex.slice(384, 448)) !== BigInt(0),
      isActive: BigInt("0x" + hex.slice(512, 576)) !== BigInt(0),
    };
  } catch {
    return null;
  }
}

// ── Bonzo Data API fetching ────────────────────────────────────────

interface BonzoAPIReserve {
  symbol?: string;
  name?: string;
  underlyingAsset?: string;
  aTokenAddress?: string;
  variableDebtTokenAddress?: string;
  stableDebtTokenAddress?: string;
  liquidityRate?: string | number;
  variableBorrowRate?: string | number;
  stableBorrowRate?: string | number;
  availableLiquidity?: string | number;
  totalDeposits?: string | number;
  totalCurrentVariableDebt?: string | number;
  totalCurrentStableDebt?: string | number;
  totalLiquidity?: string | number;
  utilizationRate?: string | number;
  baseLTVasCollateral?: string | number;
  reserveLiquidationThreshold?: string | number;
  reserveLiquidationBonus?: string | number;
  usageAsCollateralEnabled?: boolean;
  borrowingEnabled?: boolean;
  isActive?: boolean;
  priceInUsd?: string | number;
  decimals?: number;
  // Alternative field names from different API versions
  supplyAPY?: number;
  borrowAPY?: number;
  tvl?: number;
  totalSupply?: number | string;
  totalBorrow?: number | string;
}

/**
 * Try multiple endpoints on the Bonzo Data API to find reserves data.
 */
async function fetchBonzoDataAPI(): Promise<BonzoAPIReserve[] | null> {
  const endpoints = [
    "/reserves",
    "/v1/reserves",
    "/markets",
    "/v1/markets",
    "/protocol/reserves",
    "/api/reserves",
    "/reserve/list",
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${BONZO_DATA_API}${endpoint}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);

      if (!res.ok) continue;
      const data = await res.json();

      // The response might be an array or an object with a data/reserves field
      let reserves: BonzoAPIReserve[] | null = null;
      if (Array.isArray(data)) {
        reserves = data;
      } else if (data?.reserves && Array.isArray(data.reserves)) {
        reserves = data.reserves;
      } else if (data?.data && Array.isArray(data.data)) {
        reserves = data.data;
      } else if (data?.markets && Array.isArray(data.markets)) {
        reserves = data.markets;
      }

      if (reserves && reserves.length > 0) {
        log.info("Bonzo", `Data API hit: ${endpoint} — ${reserves.length} reserves`);
        return reserves;
      }
    } catch {
      // Try next endpoint
    }
  }

  log.info("Bonzo", "Data API: no working endpoint found, using fallback");
  return null;
}

/**
 * Try to fetch user data from Bonzo Data API
 */
async function fetchBonzoUserDataAPI(accountAddress: string): Promise<any | null> {
  const endpoints = [
    `/users/${accountAddress}`,
    `/v1/users/${accountAddress}`,
    `/accounts/${accountAddress}`,
    `/v1/accounts/${accountAddress}`,
    `/user/${accountAddress}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${BONZO_DATA_API}${endpoint}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);

      if (!res.ok) continue;
      const data = await res.json();
      if (data) {
        log.info("Bonzo", `User data hit: ${endpoint}`);
        return data;
      }
    } catch {
      // Try next
    }
  }
  return null;
}

/**
 * Match API reserve to our token definitions
 */
function matchReserveToToken(reserve: BonzoAPIReserve, token: BonzoTokenDef): boolean {
  const sym = (reserve.symbol || "").toUpperCase();
  const name = (reserve.name || "").toUpperCase();
  const tokenSym = token.symbol.toUpperCase();
  const tokenEvmAddr = htsIdToEvmAddress(token.hederaTokenId).toLowerCase();
  const reserveAddr = (reserve.underlyingAsset || "").toLowerCase();

  // Direct symbol match
  if (sym === tokenSym) return true;
  // Wrapped variants
  if (tokenSym === "HBAR" && (sym === "WHBAR" || sym === "WBAR")) return true;
  if (tokenSym === "WBTC" && (sym === "WBTC" || sym === "WBTC[HTS]" || sym.includes("BTC"))) return true;
  if (tokenSym === "WETH" && (sym === "WETH" || sym === "WETH[HTS]" || sym.includes("ETH"))) return true;
  if (tokenSym === "LINK" && (sym === "LINK" || sym === "LINK[HTS]" || sym === "WLNK")) return true;
  if (tokenSym === "AAVE" && (sym === "AAVE" || sym === "AAVE[HTS]" || sym === "WAAVE")) return true;
  if (tokenSym === "DAI" && (sym === "DAI" || sym === "DAI[HTS]" || sym === "WDAI")) return true;
  // Name match
  if (name.includes(token.name.toUpperCase())) return true;
  // Address match
  if (reserveAddr && reserveAddr === tokenEvmAddr) return true;
  return false;
}

/**
 * Parse a rate value from the API (could be ray-encoded, decimal, or percentage)
 */
function parseRate(val: string | number | undefined): number | null {
  if (val === undefined || val === null) return null;
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return null;
  // If > 1e20, it's ray-encoded
  if (num > 1e20) {
    return (num / 1e27) * 100;
  }
  // If between 0 and 1, it's a decimal fraction
  if (num > 0 && num < 1) {
    return num * 100;
  }
  // Otherwise assume it's already a percentage
  return num;
}

function parseAmount(val: string | number | undefined, decimals: number): number | null {
  if (val === undefined || val === null) return null;
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return null;
  // If very large, it's likely in wei/smallest unit
  if (num > 1e12) {
    return num / Math.pow(10, decimals);
  }
  return num;
}

// ── Build default markets ──────────────────────────────────────────

function buildDefaultMarkets(): BonzoMarket[] {
  return BONZO_SUPPORTED_TOKENS.map((token) => ({
    id: `bonzo-${token.symbol.toLowerCase()}`,
    symbol: token.symbol,
    name: token.name,
    hederaTokenId: token.hederaTokenId,
    evmAddress: htsIdToEvmAddress(token.hederaTokenId),
    logo: token.logo,
    decimals: token.decimals,
    supplyAPY: null,
    variableBorrowAPY: null,
    stableBorrowAPY: null,
    totalSupplyUSD: null,
    totalBorrowUSD: null,
    availableLiquidityUSD: null,
    utilization: null,
    totalSupplyNative: null,
    totalBorrowNative: null,
    availableLiquidityNative: null,
    priceUSD: null,
    maxLTV: token.defaultMaxLTV,
    liquidationThreshold: token.defaultLiquidationThreshold,
    liquidationBonus: token.defaultLiquidationBonus,
    canBeCollateral: token.canBeCollateral,
    borrowEnabled: token.borrowEnabled,
    supplyUrl: BONZO_LEND_URL,
    borrowUrl: BONZO_LEND_URL,
    dataSource: "pending" as const,
  }));
}

// ── Fetch single reserve from Mirror Node ──────────────────────────

async function fetchReserveOnChain(
  token: BonzoTokenDef,
  providerAddress: string,
): Promise<Partial<BonzoMarket> | null> {
  const evmAddr = htsIdToEvmAddress(token.hederaTokenId);

  const [reserveResult, configResult] = await Promise.all([
    mirrorCall(providerAddress, encodeGetReserveData(evmAddr)),
    mirrorCall(providerAddress, encodeGetReserveConfig(evmAddr)),
  ]);

  const reserve = reserveResult ? decodeReserveData(reserveResult) : null;
  const config = configResult ? decodeReserveConfig(configResult) : null;

  if (!reserve) return null;

  const supplyAPY = rayToAPY(reserve.liquidityRate);
  const variableBorrowAPY = rayToAPY(reserve.variableBorrowRate);
  const stableBorrowAPY = rayToAPY(reserve.stableBorrowRate);

  const totalDebt = reserve.totalStableDebt + reserve.totalVariableDebt;
  const totalSupply = reserve.availableLiquidity + totalDebt;
  const utilization = totalSupply > BigInt(0)
    ? Number((totalDebt * BigInt(10000)) / totalSupply) / 100
    : 0;

  return {
    supplyAPY,
    variableBorrowAPY,
    stableBorrowAPY: stableBorrowAPY > 0 ? stableBorrowAPY : null,
    utilization: Math.round(utilization * 10) / 10,
    maxLTV: config?.ltv ?? token.defaultMaxLTV,
    liquidationThreshold: config?.liquidationThreshold ?? token.defaultLiquidationThreshold,
    canBeCollateral: config?.usageAsCollateralEnabled ?? token.canBeCollateral,
    borrowEnabled: config?.borrowingEnabled ?? token.borrowEnabled,
    dataSource: "live" as const,
  };
}

// ── Public API ─────────────────────────────────────────────────────

let _cache: { markets: BonzoMarket[]; stats: BonzoProtocolStats; ts: number } | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * Fetch Bonzo market data.
 * Pipeline: Bonzo Data API → Mirror Node → Defaults
 */
export async function fetchBonzoMarkets(): Promise<{
  markets: BonzoMarket[];
  stats: BonzoProtocolStats;
}> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return { markets: _cache.markets, stats: _cache.stats };
  }

  const defaults = buildDefaultMarkets();

  // ── Strategy A: Bonzo Data API ──
  try {
    const apiReserves = await fetchBonzoDataAPI();
    if (apiReserves && apiReserves.length > 0) {
      const markets = defaults.map((market) => {
        const token = BONZO_SUPPORTED_TOKENS.find((t) => t.symbol === market.symbol)!;
        const matched = apiReserves.find((r) => matchReserveToToken(r, token));
        if (!matched) return market;

        const supplyAPY = matched.supplyAPY ?? parseRate(matched.liquidityRate);
        const borrowAPY = matched.borrowAPY ?? parseRate(matched.variableBorrowRate);
        const stableAPY = parseRate(matched.stableBorrowRate);
        const price = matched.priceInUsd ? parseFloat(String(matched.priceInUsd)) : null;

        const totalSupplyNative = parseAmount(
          matched.totalDeposits ?? matched.totalLiquidity ?? matched.totalSupply,
          token.decimals
        );
        const totalBorrowNative = parseAmount(
          matched.totalCurrentVariableDebt ?? matched.totalBorrow,
          token.decimals
        );
        const availLiqNative = parseAmount(matched.availableLiquidity, token.decimals);

        const util = matched.utilizationRate != null
          ? parseRate(matched.utilizationRate)
          : (totalSupplyNative && totalBorrowNative && totalSupplyNative > 0)
            ? (totalBorrowNative / totalSupplyNative) * 100
            : null;

        const ltv = matched.baseLTVasCollateral != null
          ? parseFloat(String(matched.baseLTVasCollateral)) / (parseFloat(String(matched.baseLTVasCollateral)) > 100 ? 100 : 1)
          : token.defaultMaxLTV;

        const liqThresh = matched.reserveLiquidationThreshold != null
          ? parseFloat(String(matched.reserveLiquidationThreshold)) / (parseFloat(String(matched.reserveLiquidationThreshold)) > 100 ? 100 : 1)
          : token.defaultLiquidationThreshold;

        return {
          ...market,
          supplyAPY: supplyAPY,
          variableBorrowAPY: borrowAPY,
          stableBorrowAPY: stableAPY,
          totalSupplyNative,
          totalBorrowNative,
          availableLiquidityNative: availLiqNative,
          priceUSD: price,
          totalSupplyUSD: totalSupplyNative && price ? totalSupplyNative * price : matched.tvl ?? null,
          totalBorrowUSD: totalBorrowNative && price ? totalBorrowNative * price : null,
          availableLiquidityUSD: availLiqNative && price ? availLiqNative * price : null,
          utilization: util != null ? Math.round(util * 10) / 10 : null,
          maxLTV: ltv,
          liquidationThreshold: liqThresh,
          canBeCollateral: matched.usageAsCollateralEnabled ?? token.canBeCollateral,
          borrowEnabled: matched.borrowingEnabled ?? token.borrowEnabled,
          dataSource: "live" as const,
        } satisfies BonzoMarket;
      });

      const liveMarkets = markets.filter((m) => m.dataSource === "live");
      const totalSupplyUSD = liveMarkets.reduce((s, m) => s + (m.totalSupplyUSD ?? 0), 0);
      const totalBorrowUSD = liveMarkets.reduce((s, m) => s + (m.totalBorrowUSD ?? 0), 0);
      const totalAvailableLiquidityUSD = liveMarkets.reduce((s, m) => s + (m.availableLiquidityUSD ?? 0), 0);

      const stats: BonzoProtocolStats = {
        totalSupplyUSD: totalSupplyUSD > 0 ? totalSupplyUSD : null,
        totalBorrowUSD: totalBorrowUSD > 0 ? totalBorrowUSD : null,
        totalAvailableLiquidityUSD: totalAvailableLiquidityUSD > 0 ? totalAvailableLiquidityUSD : null,
        totalMarketsCount: markets.length,
        dataSource: liveMarkets.length > 0 ? "live" : "pending",
      };

      _cache = { markets, stats, ts: Date.now() };
      return { markets, stats };
    }
  } catch (err) {
    log.warn("Bonzo", "Data API error", err);
  }

  // ── Strategy B: Mirror Node contract calls ──
  const providerAddr = BONZO_CONTRACTS.protocolDataProvider;
  if (providerAddr) {
    log.info("Bonzo", "Fetching reserve data from Mirror Node...");
    const results = await Promise.allSettled(
      BONZO_SUPPORTED_TOKENS.map((token) => fetchReserveOnChain(token, providerAddr))
    );

    const markets: BonzoMarket[] = defaults.map((market, i) => {
      const result = results[i];
      if (result.status === "fulfilled" && result.value) {
        return { ...market, ...result.value } as BonzoMarket;
      }
      return market;
    });

    const liveMarkets = markets.filter((m) => m.dataSource === "live");
    const stats: BonzoProtocolStats = {
      totalSupplyUSD: null,
      totalBorrowUSD: null,
      totalAvailableLiquidityUSD: null,
      totalMarketsCount: markets.length,
      dataSource: liveMarkets.length > 0 ? "live" : "pending",
    };

    _cache = { markets, stats, ts: Date.now() };
    return { markets, stats };
  }

  // ── Strategy C: Defaults ──
  log.info("Bonzo", "Returning defaults (API unavailable, contract addresses not configured)");
  const stats: BonzoProtocolStats = {
    totalSupplyUSD: null,
    totalBorrowUSD: null,
    totalAvailableLiquidityUSD: null,
    totalMarketsCount: defaults.length,
    dataSource: "pending",
  };
  _cache = { markets: defaults, stats, ts: Date.now() };
  return { markets: defaults, stats };
}

/**
 * Fetch user positions from Bonzo
 */
export async function fetchBonzoUserPositions(accountId: string): Promise<BonzoUserSummary | null> {
  // Try Bonzo Data API first
  const evmAddr = accountIdToEvmAddress(accountId);
  const userData = await fetchBonzoUserDataAPI(evmAddr);

  if (userData) {
    try {
      const positions: BonzoUserPosition[] = [];
      const reservesData = userData.reserves || userData.positions || userData.data || [];

      for (const r of reservesData) {
        const token = BONZO_SUPPORTED_TOKENS.find(
          (t) =>
            t.symbol.toUpperCase() === (r.symbol || "").toUpperCase() ||
            htsIdToEvmAddress(t.hederaTokenId).toLowerCase() === (r.underlyingAsset || "").toLowerCase()
        );
        if (!token) continue;

        const supplied = parseAmount(r.currentATokenBalance ?? r.supplied ?? 0, token.decimals) ?? 0;
        const borrowed = parseAmount(r.currentVariableDebt ?? r.borrowed ?? 0, token.decimals) ?? 0;

        if (supplied > 0 || borrowed > 0) {
          const price = parseFloat(String(r.priceInUsd ?? 0));
          positions.push({
            symbol: token.symbol,
            hederaTokenId: token.hederaTokenId,
            logo: token.logo,
            decimals: token.decimals,
            supplied,
            suppliedUSD: supplied * price,
            borrowed,
            borrowedUSD: borrowed * price,
            supplyAPY: parseRate(r.liquidityRate ?? r.supplyAPY) ?? 0,
            borrowAPY: parseRate(r.variableBorrowRate ?? r.borrowAPY) ?? 0,
            usedAsCollateral: r.usageAsCollateralEnabledOnUser ?? true,
          });
        }
      }

      const totalSuppliedUSD = positions.reduce((s, p) => s + p.suppliedUSD, 0);
      const totalBorrowedUSD = positions.reduce((s, p) => s + p.borrowedUSD, 0);
      const healthFactor = userData.healthFactor
        ? parseFloat(String(userData.healthFactor))
        : totalBorrowedUSD > 0 ? (totalSuppliedUSD * 0.75) / totalBorrowedUSD : Infinity;

      const weightedSupplyAPY = totalSuppliedUSD > 0
        ? positions.reduce((s, p) => s + (p.supplyAPY * p.suppliedUSD), 0) / totalSuppliedUSD
        : 0;
      const weightedBorrowAPY = totalBorrowedUSD > 0
        ? positions.reduce((s, p) => s + (p.borrowAPY * p.borrowedUSD), 0) / totalBorrowedUSD
        : 0;
      const netAPY = totalSuppliedUSD > 0
        ? ((weightedSupplyAPY * totalSuppliedUSD - weightedBorrowAPY * totalBorrowedUSD) / totalSuppliedUSD)
        : 0;

      return {
        totalSuppliedUSD,
        totalBorrowedUSD,
        healthFactor: isFinite(healthFactor) ? healthFactor : 999,
        netAPY,
        borrowPowerUsed: totalSuppliedUSD > 0 ? (totalBorrowedUSD / (totalSuppliedUSD * 0.75)) * 100 : 0,
        positions,
      };
    } catch (err) {
      log.warn("Bonzo", "Error parsing user data", err);
    }
  }

  // Try Mirror Node getUserAccountData if LendingPool is configured
  if (BONZO_CONTRACTS.lendingPool) {
    const paddedAddr = evmAddr.replace("0x", "").padStart(64, "0");
    const callData = LENDING_POOL_SELECTORS.getUserAccountData + paddedAddr;
    const result = await mirrorCall(BONZO_CONTRACTS.lendingPool, callData);
    if (result) {
      try {
        const hex = result.replace("0x", "");
        if (hex.length >= 384) {
          const totalCollateral = Number(BigInt("0x" + hex.slice(0, 64))) / 1e18;
          const totalDebt = Number(BigInt("0x" + hex.slice(64, 128))) / 1e18;
          const availBorrows = Number(BigInt("0x" + hex.slice(128, 192))) / 1e18;
          const hf = Number(BigInt("0x" + hex.slice(320, 384))) / 1e18;

          return {
            totalSuppliedUSD: totalCollateral,
            totalBorrowedUSD: totalDebt,
            healthFactor: isFinite(hf) ? hf : 999,
            netAPY: 0,
            borrowPowerUsed: totalCollateral > 0 ? ((totalCollateral - availBorrows) / totalCollateral) * 100 : 0,
            positions: [],
          };
        }
      } catch { /* parse error */ }
    }
  }

  return null;
}

/**
 * Force refresh on next fetch.
 */
export function invalidateBonzoCache(): void {
  _cache = null;
}

// ── Link helpers ───────────────────────────────────────────────────

export function getBonzoLendUrl(): string {
  return BONZO_LEND_URL;
}

export function getBonzoMarketsUrl(): string {
  return BONZO_LEND_URL;
}

export function getBonzoDashboardUrl(): string {
  return "https://app.bonzo.finance";
}

export function isBonzoConfigured(): boolean {
  return !!BONZO_CONTRACTS.protocolDataProvider;
}

export function isBonzoLendingPoolConfigured(): boolean {
  return !!BONZO_CONTRACTS.lendingPool;
}

// ── Transaction encoding helpers ────────────────────────────────────
// These encode raw calldata for Aave V2 LendingPool functions.
// Used by BonzoLendBorrow.tsx to build ContractExecuteTransaction.
//
// ═══════════════════════════════════════════════════════════════════════
// Callers must pre-validate: amount > 0, valid EVM addresses, no uint256 overflow.
// Selectors are standard Aave V2 (Bonzo is a direct fork).
// Limitation: Token approval (ERC-20 `approve`) for the LendingPool is
// assumed to be handled by the caller's UI flow before invoking these
// helpers. A pre-flight allowance check can be added here when the
// full supply/borrow transaction pipeline is integrated.
// ═══════════════════════════════════════════════════════════════════════

function padAddress(addr: string): string {
  return addr.replace("0x", "").padStart(64, "0");
}

function padUint256(val: bigint): string {
  return val.toString(16).padStart(64, "0");
}

export function encodeDeposit(asset: string, amount: bigint, onBehalfOf: string): string {
  return (
    LENDING_POOL_SELECTORS.deposit +
    padAddress(asset) +
    padUint256(amount) +
    padAddress(onBehalfOf) +
    padUint256(BigInt(0)) // referralCode
  );
}

export function encodeWithdraw(asset: string, amount: bigint, to: string): string {
  return (
    LENDING_POOL_SELECTORS.withdraw +
    padAddress(asset) +
    padUint256(amount) +
    padAddress(to)
  );
}

export function encodeBorrow(
  asset: string,
  amount: bigint,
  interestRateMode: bigint,
  onBehalfOf: string,
): string {
  return (
    LENDING_POOL_SELECTORS.borrow +
    padAddress(asset) +
    padUint256(amount) +
    padUint256(interestRateMode) +
    padUint256(BigInt(0)) + // referralCode
    padAddress(onBehalfOf)
  );
}

export function encodeRepay(
  asset: string,
  amount: bigint,
  rateMode: bigint,
  onBehalfOf: string,
): string {
  return (
    LENDING_POOL_SELECTORS.repay +
    padAddress(asset) +
    padUint256(amount) +
    padUint256(rateMode) +
    padAddress(onBehalfOf)
  );
}

/** Get the Bonzo LendingPool EVM address (empty string if not configured) */
export function getBonzoLendingPoolAddress(): string {
  return BONZO_CONTRACTS.lendingPool;
}
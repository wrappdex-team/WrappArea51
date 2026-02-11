/**
 * Bonzo Finance Integration — Aave V2 lending/borrowing on Hedera
 *
 * Bonzo Finance (bonzo.finance) is an Aave V2 fork deployed on Hedera mainnet.
 * This module provides:
 *   1. Market definitions for the 5 target assets (HBAR, USDC, WBTC, WETH, BONZO)
 *   2. On-chain data fetching via Hedera Mirror Node contract calls
 *   3. Deep-links to Bonzo's lending app at https://app.bonzo.finance/lend
 *
 * Data pipeline (in priority order):
 *   A. Mirror Node → ProtocolDataProvider.getReserveData(asset)  [on-chain, real-time]
 *   B. Fallback: markets shown with null rates, labelled "awaiting data"
 *
 * To activate live data, populate BONZO_CONTRACTS with deployed addresses.
 *
 * GitHub: https://github.com/Bonzo-Labs/bonzo-finance-contracts
 */

// ── Types ──────────────────────────────────────────────────────────

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

  // ── Rate data (null until Mirror Node responds) ──
  supplyAPY: number | null;
  variableBorrowAPY: number | null;
  stableBorrowAPY: number | null;

  // ── Volume data (null until Mirror Node responds) ──
  totalSupplyUSD: number | null;
  totalBorrowUSD: number | null;
  availableLiquidityUSD: number | null;
  utilization: number | null;

  // ── Risk parameters (from contract config or defaults) ──
  maxLTV: number | null;
  liquidationThreshold: number | null;
  canBeCollateral: boolean;

  // ── Links ──
  supplyUrl: string;
  borrowUrl: string;

  /** "live" when fetched from chain, "pending" when using defaults */
  dataSource: "live" | "pending";
}

export interface BonzoProtocolStats {
  totalSupplyUSD: number | null;
  totalBorrowUSD: number | null;
  totalMarketsCount: number;
  dataSource: "live" | "pending";
}

// ── Constants ──────────────────────────────────────────────────────

/** Bonzo app confirmed URL */
const BONZO_LEND_URL = "https://app.bonzo.finance/lend";

/** Hedera mainnet Mirror Node (matches hedera.ts) */
const MIRROR_NODE = "https://mainnet-public.mirrornode.hedera.com";

/**
 * Bonzo contract addresses on Hedera mainnet.
 *
 * TODO: Populate these with the actual deployed addresses from
 * https://github.com/Bonzo-Labs/bonzo-finance-contracts
 *
 * - protocolDataProvider: Aave V2 ProtocolDataProvider contract
 *   (exposes getReserveData, getReserveConfigurationData, getAllReservesTokens)
 * - lendingPool: Aave V2 LendingPool contract
 *   (main entry point for supply/borrow transactions)
 */
const BONZO_CONTRACTS = {
  /** EVM address of ProtocolDataProvider (AaveProtocolDataProvider.sol) */
  protocolDataProvider: "" as string,
  /** EVM address of LendingPool (LendingPool.sol) */
  lendingPool: "" as string,
};

// ── HTS ID → EVM address conversion (matches saucerswap.ts) ──

function htsIdToEvmAddress(htsId: string): string {
  if (htsId === "native") return "0x0000000000000000000000000000000000000000";
  const parts = htsId.split(".");
  const tokenNum = parseInt(parts[2], 10);
  return "0x" + tokenNum.toString(16).padStart(40, "0");
}

// ── Token registry ─────────────────────────────────────────────────
// HTS IDs verified against SAUCERSWAP_TOKENS in saucerswap.ts
// and the Hedera token service.

interface BonzoTokenDef {
  symbol: string;
  name: string;
  hederaTokenId: string;
  decimals: number;
  logo: string;
  canBeCollateral: boolean;
  defaultMaxLTV: number;
  defaultLiquidationThreshold: number;
}

const BONZO_SUPPORTED_TOKENS: BonzoTokenDef[] = [
  {
    symbol: "HBAR",
    name: "Hedera",
    hederaTokenId: "0.0.1456986", // WHBAR on SaucerSwap — Bonzo uses wrapped form
    decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
    canBeCollateral: true,
    defaultMaxLTV: 65,
    defaultLiquidationThreshold: 75,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    hederaTokenId: "0.0.456858",
    decimals: 6,
    logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    canBeCollateral: true,
    defaultMaxLTV: 80,
    defaultLiquidationThreshold: 85,
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    hederaTokenId: "0.0.1969769", // Hashport bridged WBTC on Hedera
    decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
    canBeCollateral: true,
    defaultMaxLTV: 70,
    defaultLiquidationThreshold: 80,
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    hederaTokenId: "0.0.1969757", // Hashport bridged WETH on Hedera
    decimals: 18,
    logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
    canBeCollateral: true,
    defaultMaxLTV: 75,
    defaultLiquidationThreshold: 82,
  },
  {
    symbol: "BONZO",
    name: "Bonzo",
    hederaTokenId: "0.0.1540481",
    decimals: 8,
    logo: "https://s2.coinmarketcap.com/static/img/coins/64x64/31229.png",
    canBeCollateral: false,
    defaultMaxLTV: 0,
    defaultLiquidationThreshold: 0,
  },
];

// ── ABI selectors for Aave V2 ProtocolDataProvider ─────────────────
// These are standard Aave V2 function selectors and apply to Bonzo's fork.

const ABI = {
  /**
   * getReserveData(address asset) returns:
   *   (availableLiquidity, totalStableDebt, totalVariableDebt,
   *    liquidityRate, variableBorrowRate, stableBorrowRate,
   *    averageStableBorrowRate, liquidityIndex, variableBorrowIndex,
   *    lastUpdateTimestamp)
   */
  getReserveData: "0x35ea6a75",
  /**
   * getReserveConfigurationData(address asset) returns:
   *   (decimals, ltv, liquidationThreshold, liquidationBonus,
   *    reserveFactor, usageAsCollateralEnabled, borrowingEnabled,
   *    stableBorrowRateEnabled, isActive, isFrozen)
   */
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

/** Encode a getReserveData(address) call */
function encodeGetReserveData(assetEvmAddress: string): string {
  // Pad address to 32 bytes (remove 0x, pad to 64 hex chars)
  const paddedAddr = assetEvmAddress.replace("0x", "").padStart(64, "0");
  return ABI.getReserveData + paddedAddr;
}

/** Encode a getReserveConfigurationData(address) call */
function encodeGetReserveConfig(assetEvmAddress: string): string {
  const paddedAddr = assetEvmAddress.replace("0x", "").padStart(64, "0");
  return ABI.getReserveConfigurationData + paddedAddr;
}

/** Aave V2 RAY = 1e27. Convert ray-encoded rate to annual percentage. */
function rayToAPY(rayHex: string): number {
  // Parse hex string to a number — ray values are uint256
  // For rates, we need BigInt to handle the precision
  try {
    const ray = BigInt("0x" + rayHex);
    const RAY = BigInt("1000000000000000000000000000"); // 1e27
    // APY ≈ rate / RAY * 100 (simplified — ignores compounding)
    const rateDecimal = Number(ray) / Number(RAY);
    return rateDecimal * 100;
  } catch {
    return 0;
  }
}

/** Decode getReserveData response (10 uint256 values) */
function decodeReserveData(result: string): {
  availableLiquidity: bigint;
  totalStableDebt: bigint;
  totalVariableDebt: bigint;
  liquidityRate: string;      // hex, ray-encoded
  variableBorrowRate: string;  // hex, ray-encoded
  stableBorrowRate: string;    // hex, ray-encoded
} | null {
  try {
    const hex = result.replace("0x", "");
    if (hex.length < 640) return null; // 10 × 64 hex chars
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

/** Decode getReserveConfigurationData response */
function decodeReserveConfig(result: string): {
  ltv: number;
  liquidationThreshold: number;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  isActive: boolean;
} | null {
  try {
    const hex = result.replace("0x", "");
    if (hex.length < 640) return null; // 10 × 64 hex chars
    return {
      ltv: Number(BigInt("0x" + hex.slice(64, 128))) / 100,               // basis points → %
      liquidationThreshold: Number(BigInt("0x" + hex.slice(128, 192))) / 100,
      usageAsCollateralEnabled: BigInt("0x" + hex.slice(320, 384)) !== BigInt(0),
      borrowingEnabled: BigInt("0x" + hex.slice(384, 448)) !== BigInt(0),
      isActive: BigInt("0x" + hex.slice(512, 576)) !== BigInt(0),
    };
  } catch {
    return null;
  }
}

// ── Build default markets (no live data) ───────────────────────────

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
    maxLTV: token.defaultMaxLTV,
    liquidationThreshold: token.defaultLiquidationThreshold,
    canBeCollateral: token.canBeCollateral,
    supplyUrl: BONZO_LEND_URL,
    borrowUrl: BONZO_LEND_URL,
    dataSource: "pending" as const,
  }));
}

// ── Fetch single reserve data from chain ───────────────────────────

async function fetchReserveOnChain(
  token: BonzoTokenDef,
  providerAddress: string,
): Promise<Partial<BonzoMarket> | null> {
  const evmAddr = htsIdToEvmAddress(token.hederaTokenId);

  // Fetch reserve data + config in parallel
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

  // Calculate total supply = availableLiquidity + totalStableDebt + totalVariableDebt
  // These are in token units (need price for USD — we approximate with null for now)
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
    dataSource: "live" as const,
  };
}

// ── Public API ─────────────────────────────────────────────────────

let _cache: { markets: BonzoMarket[]; stats: BonzoProtocolStats; ts: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Fetch Bonzo market data.
 *
 * If BONZO_CONTRACTS.protocolDataProvider is configured, performs
 * real on-chain reads via Mirror Node. Otherwise returns markets
 * with null rate fields, labelled "pending".
 */
export async function fetchBonzoMarkets(): Promise<{
  markets: BonzoMarket[];
  stats: BonzoProtocolStats;
}> {
  // Return from cache if fresh
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return { markets: _cache.markets, stats: _cache.stats };
  }

  const defaults = buildDefaultMarkets();
  const providerAddr = BONZO_CONTRACTS.protocolDataProvider;

  // If contract address not configured, return defaults
  if (!providerAddr) {
    console.log("[HBAR.h] Bonzo ProtocolDataProvider address not configured — showing market structure only");
    const stats: BonzoProtocolStats = {
      totalSupplyUSD: null,
      totalBorrowUSD: null,
      totalMarketsCount: defaults.length,
      dataSource: "pending",
    };
    _cache = { markets: defaults, stats, ts: Date.now() };
    return { markets: defaults, stats };
  }

  // Fetch all reserves in parallel
  console.log("[HBAR.h] Fetching Bonzo reserve data from Mirror Node...");
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
    totalSupplyUSD: null, // Need price oracle for USD conversion
    totalBorrowUSD: null,
    totalMarketsCount: markets.length,
    dataSource: liveMarkets.length > 0 ? "live" : "pending",
  };

  _cache = { markets, stats, ts: Date.now() };
  return { markets, stats };
}

/**
 * Force refresh on next fetch.
 */
export function invalidateBonzoCache(): void {
  _cache = null;
}

// ── Link helpers ───────────────────────────────────────────────────

/** Main Bonzo lending page — supply and borrow all assets */
export function getBonzoLendUrl(): string {
  return BONZO_LEND_URL;
}

/** Bonzo markets overview */
export function getBonzoMarketsUrl(): string {
  return BONZO_LEND_URL;
}

/** Bonzo user dashboard */
export function getBonzoDashboardUrl(): string {
  return "https://app.bonzo.finance";
}

/** Whether the on-chain data pipeline is configured */
export function isBonzoConfigured(): boolean {
  return !!BONZO_CONTRACTS.protocolDataProvider;
}
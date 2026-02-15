/**
 * Staking Provider — Backend plugin interface for staking data
 *
 * This module defines the data contract for the DeFi → Staking tab.
 * All pools are structurally defined here; metric fields (APY, totalStaked,
 * rewards accrued) are intentionally nullable — they return `null` until
 * a production data source is connected.
 *
 * To activate with real data:
 *   1. Implement `fetchLiveStakingData()` against your staking contract /
 *      indexer / Mirror Node endpoint.
 *   2. Replace the body of `fetchStakingPools()` to call it.
 *   3. The DeFi component already handles null metrics gracefully
 *      (shows "Pending" badges instead of numbers).
 *
 * Pool roster matches the liquidity-pool tokens visible on the Pools tab.
 */

// ── Types ──────────────────────────────────────────────────────────

export type StakingStatus = "active" | "pending" | "deprecated";

export interface StakingPool {
  /** Unique pool identifier */
  id: string;
  /** Token to stake */
  token: string;
  /** Display name */
  name: string;
  /** Token logo URL */
  logo: string;
  /** Lock period label (e.g. "Flexible", "30 days") */
  lockPeriod: string;
  /** Minimum stake amount (in token units), null = no minimum */
  minStake: number | null;
  /** Reward token(s) description */
  rewardTokens: string;
  /** Current status */
  status: StakingStatus;

  // ── Live metrics (null until backend connected) ──
  /** Annual percentage yield */
  apy: number | null;
  /** Total tokens staked across all users */
  totalStaked: number | null;
  /** Total USD value staked */
  totalStakedUSD: number | null;
  /** Number of unique stakers */
  stakerCount: number | null;
  /** Data freshness */
  dataSource: "live" | "pending";
}

export interface StakingStats {
  totalPoolsActive: number;
  totalPoolsPending: number;
  totalValueLockedUSD: number | null;
  dataSource: "live" | "pending";
}

// ── Token logos (shared with rest of codebase) ─────────────────────

const LOGOS = {
  HBAR:    "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  "HBAR.ħ": "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  USDC:    "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  SAUCE:   "https://www.saucerswap.finance/images/tokens/sauce.svg",
  HBARX:   "https://www.saucerswap.finance/images/tokens/hbarx.svg",
};

// ── Pool definitions ───────────────────────────────────────────────
// Structural data only — metrics are null (pending backend activation)

const STAKING_POOLS: StakingPool[] = [
  {
    id: "stake-hbar-flex",
    token: "HBAR",
    name: "HBAR Flexible Staking",
    logo: LOGOS.HBAR,
    lockPeriod: "Flexible",
    minStake: 100,
    rewardTokens: "HBAR",
    status: "pending",
    apy: null,
    totalStaked: null,
    totalStakedUSD: null,
    stakerCount: null,
    dataSource: "pending",
  },
  {
    id: "stake-hbar-30",
    token: "HBAR",
    name: "HBAR 30-Day Lock",
    logo: LOGOS.HBAR,
    lockPeriod: "30 days",
    minStake: 500,
    rewardTokens: "HBAR",
    status: "pending",
    apy: null,
    totalStaked: null,
    totalStakedUSD: null,
    stakerCount: null,
    dataSource: "pending",
  },
  {
    id: "stake-hbar-60",
    token: "HBAR",
    name: "HBAR 60-Day Lock",
    logo: LOGOS.HBAR,
    lockPeriod: "60 days",
    minStake: 500,
    rewardTokens: "HBAR",
    status: "pending",
    apy: null,
    totalStaked: null,
    totalStakedUSD: null,
    stakerCount: null,
    dataSource: "pending",
  },
  {
    id: "stake-hbarh-30",
    token: "HBAR.ħ",
    name: "HBAR.ħ 30-Day Lock",
    logo: LOGOS["HBAR.ħ"],
    lockPeriod: "30 days",
    minStake: 500,
    rewardTokens: "HBAR.ħ + HBAR",
    status: "pending",
    apy: null,
    totalStaked: null,
    totalStakedUSD: null,
    stakerCount: null,
    dataSource: "pending",
  },
  {
    id: "stake-hbarh-90",
    token: "HBAR.ħ",
    name: "HBAR.ħ 90-Day Lock",
    logo: LOGOS["HBAR.ħ"],
    lockPeriod: "90 days",
    minStake: 1000,
    rewardTokens: "HBAR.ħ + HBAR",
    status: "pending",
    apy: null,
    totalStaked: null,
    totalStakedUSD: null,
    stakerCount: null,
    dataSource: "pending",
  },
];

// ── Public API ─────────────────────────────────────────────────────

/**
 * Fetch staking pool data.
 *
 * Currently returns structural pool definitions with null metrics.
 * When a live backend is ready, replace the body of this function
 * with an API call to your staking indexer / contract reader.
 */
export async function fetchStakingPools(): Promise<{
  pools: StakingPool[];
  stats: StakingStats;
}> {
  // Pool definitions with null metrics — the DeFi component renders these
  // with "Pending" badges until a live staking indexer is connected.
  // See module header for the activation steps.

  const pools = STAKING_POOLS;
  const active = pools.filter((p) => p.status === "active").length;
  const pending = pools.filter((p) => p.status === "pending").length;

  return {
    pools,
    stats: {
      totalPoolsActive: active,
      totalPoolsPending: pending,
      totalValueLockedUSD: null,
      dataSource: "pending",
    },
  };
}

/**
 * Invalidate any cached staking data.
 * Called when wallet connects or network changes.
 */
export function invalidateStakingCache(): void {
  // No-op: cache invalidation will be wired up when a live data source is connected.
}
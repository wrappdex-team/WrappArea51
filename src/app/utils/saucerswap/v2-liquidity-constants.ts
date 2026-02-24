/**
 * V2 Liquidity Constants — Gas, Errors, Timeouts, Safety Thresholds
 *
 * [LP-16] Step 16 of the V2 Liquidity Master Plan.
 * Central source of truth for all V2 liquidity operation parameters.
 * Gas values from SaucerSwap docs; timeouts mirror swap-engine.ts patterns.
 */

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Gas Limits (from SaucerSwap V2 documentation)
// ═══════════════════════════════════════════════════════════════════════

/** Recommended gas limits per operation type */
export const V2_GAS_LIMITS = {
  /** mint() — new position creation via NFT Position Manager */
  MINT: 900_000,
  /** increaseLiquidity() — add to existing position */
  INCREASE_LIQUIDITY: 330_000,
  /** decreaseLiquidity() — partial/full removal */
  DECREASE_LIQUIDITY: 300_000,
  /** collect() — claim earned trading fees */
  COLLECT: 300_000,
  /** decreaseLiquidity + collect combined multicall */
  DECREASE_AND_COLLECT: 600_000,
  /** burn() — destroy NFT after full removal */
  BURN: 50_000,
  /** Full removal: decrease + collect + unwrapWHBAR + burn */
  FULL_REMOVAL_WITH_BURN: 700_000,
  /** Token association (HTS) */
  TOKEN_ASSOCIATE: 60_000,
  /** Token approval (ERC-20 style) */
  TOKEN_APPROVE: 60_000,
} as const;

/** Gas price estimate in HBAR (conservative) */
export const GAS_PRICE_HBAR_PER_UNIT = 0.000_000_852; // ~852 tinybar per gas unit

/** Estimate HBAR cost for a gas limit */
export function estimateGasCostHbar(gasLimit: number): number {
  return gasLimit * GAS_PRICE_HBAR_PER_UNIT;
}

/** Format gas cost for display */
export function formatGasCost(gasLimit: number): string {
  const cost = estimateGasCostHbar(gasLimit);
  if (cost >= 1) return `~${cost.toFixed(2)} HBAR`;
  if (cost >= 0.01) return `~${cost.toFixed(4)} HBAR`;
  return `<0.01 HBAR`;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Timeout & Session Constants
// ═══════════════════════════════════════════════════════════════════════

/** WalletConnect transaction signing timeout (matches swap-engine.ts) */
export const TX_SIGN_TIMEOUT_MS = 90_000;

/** [STALE-ALLOW] Pattern: seconds before warning user about stale session */
export const STALE_SESSION_WARNING_MS = 60_000;

/** JSON-RPC relay request timeout */
export const RPC_TIMEOUT_MS = 15_000;

/** Mirror Node fallback timeout */
export const MIRROR_TIMEOUT_MS = 10_000;

/** Maximum retries for RPC calls before falling back to Mirror Node */
export const RPC_MAX_RETRIES = 2;

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Safety Thresholds (Step 13)
// ═══════════════════════════════════════════════════════════════════════

/** Price range width (%) below which we warn about high IL risk */
export const NARROW_RANGE_WARN_PCT = 2;

/** Price range width (%) below which we show critical IL warning */
export const NARROW_RANGE_CRITICAL_PCT = 0.5;

/** Minimum pool TVL (USD) before showing low-liquidity warning */
export const LOW_TVL_WARN_USD = 1_000;

/** Very low TVL threshold — stronger warning */
export const VERY_LOW_TVL_USD = 100;

/** Default slippage tolerance in basis points */
export const DEFAULT_SLIPPAGE_BPS = 100; // 1%

/** Maximum allowed slippage in basis points */
export const MAX_SLIPPAGE_BPS = 5_000; // 50%

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: Impermanent Loss Estimation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Estimate impermanent loss for a concentrated liquidity position.
 *
 * For concentrated liquidity (Uniswap V3 / SaucerSwap V2), IL is amplified
 * compared to full-range because liquidity is concentrated in a narrower band.
 *
 * Formula: IL_concentrated = IL_fullRange * concentrationMultiplier
 * where concentrationMultiplier ≈ sqrt(priceRange) / sqrt(actualPriceMove)
 *
 * Simplified model (assumes position stays in range):
 *   IL(r) = 2*sqrt(r)/(1+r) - 1   where r = newPrice/oldPrice
 *   concentrated_IL ≈ IL(r) * (fullRange / positionRange) factor
 *
 * @param priceChangePct - Price change as decimal (0.10 = +10%)
 * @param rangeWidthPct - Position range width as decimal (0.20 = ±10% = 20% total)
 * @returns IL as a positive percentage (e.g., 0.5 means 0.5% loss)
 */
export function estimateImpermanentLoss(
  priceChangePct: number,
  rangeWidthPct: number,
): number {
  if (rangeWidthPct <= 0 || priceChangePct === 0) return 0;

  const r = 1 + priceChangePct;
  if (r <= 0) return 100; // Price went to zero

  // Full-range IL formula: 2*sqrt(r)/(1+r) - 1
  const fullRangeIL = Math.abs(2 * Math.sqrt(r) / (1 + r) - 1);

  // Concentration factor: narrower range = higher IL
  // For a position covering ±X% of price, concentration ≈ 1/rangeWidth
  // Capped to avoid unrealistic numbers
  const concentrationFactor = Math.min(1 / Math.max(rangeWidthPct, 0.01), 50);

  // Concentrated IL = fullRangeIL * concentrationFactor (simplified)
  // Cap at 100% (can't lose more than everything)
  return Math.min(fullRangeIL * concentrationFactor * 100, 100);
}

/** Standard price move scenarios for IL estimation display */
export const IL_SCENARIOS = [
  { label: "±10%", move: 0.10 },
  { label: "±25%", move: 0.25 },
  { label: "±50%", move: 0.50 },
] as const;

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: Contract Error Classification (Step 16)
// ═══════════════════════════════════════════════════════════════════════

/** Known contract revert reason strings from SaucerSwap V2 */
export const CONTRACT_ERRORS: Record<string, { message: string; severity: "warn" | "error" | "info" }> = {
  "INSUFFICIENT_LIQUIDITY": {
    message: "Not enough liquidity in pool for this operation",
    severity: "error",
  },
  "PRICE_SLIPPAGE": {
    message: "Price moved beyond your slippage tolerance. Try increasing slippage or reducing amount.",
    severity: "warn",
  },
  "EXPIRED": {
    message: "Transaction deadline expired. Please try again.",
    severity: "warn",
  },
  "NOT_APPROVED": {
    message: "Token approval required. Please approve the tokens first.",
    severity: "error",
  },
  "STF": {
    message: "Safe transfer failed — check token association and balances",
    severity: "error",
  },
  "LOK": {
    message: "Pool is temporarily locked (reentrancy guard). Try again in a moment.",
    severity: "warn",
  },
  "TLU": {
    message: "Invalid tick range: tickLower must be less than tickUpper",
    severity: "error",
  },
  "TLM": {
    message: "Tick is below minimum allowed value",
    severity: "error",
  },
  "TUM": {
    message: "Tick is above maximum allowed value",
    severity: "error",
  },
  "AS": {
    message: "Amount specified cannot be zero",
    severity: "error",
  },
  "SPL": {
    message: "Sqrt price limit exceeded — price moved too far",
    severity: "warn",
  },
  "CONTRACT_REVERT_EXECUTED": {
    message: "Transaction reverted by the contract. Check parameters and try again.",
    severity: "error",
  },
  "INSUFFICIENT_PAYER_BALANCE": {
    message: "Insufficient HBAR balance for gas + payable amount",
    severity: "error",
  },
  "INSUFFICIENT_TX_FEE": {
    message: "Transaction fee too low. Try again with default gas settings.",
    severity: "error",
  },
  "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT": {
    message: "Token not associated. Associate the token before proceeding.",
    severity: "error",
  },
};

/**
 * Parse a contract error/revert reason into a user-friendly message.
 * Handles raw Hedera SDK errors, JSON-RPC errors, and contract reverts.
 */
export function classifyContractError(error: unknown): {
  message: string;
  severity: "warn" | "error" | "info";
  code?: string;
} {
  const errStr = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : JSON.stringify(error);

  // Check known error patterns
  for (const [code, info] of Object.entries(CONTRACT_ERRORS)) {
    if (errStr.includes(code)) {
      return { ...info, code };
    }
  }

  // WalletConnect / HashPack specific errors
  if (errStr.includes("USER_REJECTED") || errStr.includes("user rejected") || errStr.includes("User rejected")) {
    return { message: "Transaction was rejected in your wallet.", severity: "info", code: "USER_REJECTED" };
  }
  if (errStr.includes("timeout") || errStr.includes("Timeout") || errStr.includes("TIMEOUT")) {
    return { message: "Wallet signing timed out. Please try again — you may need to reconnect your wallet.", severity: "warn", code: "TIMEOUT" };
  }
  if (errStr.includes("session") && (errStr.includes("expired") || errStr.includes("stale"))) {
    return { message: "WalletConnect session expired. Disconnect and reconnect your wallet.", severity: "warn", code: "STALE_SESSION" };
  }
  if (errStr.includes("INVALID_SIGNATURE") || errStr.includes("INVALID_TRANSACTION")) {
    return { message: "Invalid transaction signature. Try disconnecting and reconnecting your wallet.", severity: "error", code: "INVALID_SIGNATURE" };
  }

  // Generic fallback
  return {
    message: errStr.length > 200 ? errStr.slice(0, 200) + "..." : errStr,
    severity: "error",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Safety Warning Types (Step 13)
// ═══════════════════════════════════════════════════════════════════════

export type WarningSeverity = "info" | "warn" | "critical";

export interface SafetyWarning {
  id: string;
  severity: WarningSeverity;
  title: string;
  message: string;
}

/**
 * Compute safety warnings for an add-liquidity operation.
 */
export function computeSafetyWarnings(params: {
  currentPrice: number;
  priceLower: number;
  priceUpper: number;
  poolTvl: number;
  rangeWidthPct: number;
  token0Symbol?: string;
  token1Symbol?: string;
}): SafetyWarning[] {
  const warnings: SafetyWarning[] = [];
  const { currentPrice, priceLower, priceUpper, poolTvl, rangeWidthPct, token0Symbol = "token0", token1Symbol = "token1" } = params;

  // 1. Out-of-range warning (single-sided deposit)
  if (currentPrice > 0 && priceLower > 0 && priceUpper > 0) {
    if (currentPrice < priceLower) {
      warnings.push({
        id: "out-of-range-above",
        severity: "warn",
        title: "Single-Sided Deposit",
        message: `Current price is below your range. You'll deposit only ${token1Symbol} and won't earn fees until price rises into your range.`,
      });
    } else if (currentPrice > priceUpper) {
      warnings.push({
        id: "out-of-range-below",
        severity: "warn",
        title: "Single-Sided Deposit",
        message: `Current price is above your range. You'll deposit only ${token0Symbol} and won't earn fees until price falls into your range.`,
      });
    }
  }

  // 2. Narrow range warning (high IL risk)
  if (rangeWidthPct > 0 && rangeWidthPct < NARROW_RANGE_CRITICAL_PCT) {
    warnings.push({
      id: "range-critical",
      severity: "critical",
      title: "Extremely Narrow Range",
      message: `Your range covers only ${rangeWidthPct.toFixed(2)}% of price movement. This creates extreme impermanent loss risk — even small price fluctuations can push your position out of range.`,
    });
  } else if (rangeWidthPct > 0 && rangeWidthPct < NARROW_RANGE_WARN_PCT) {
    warnings.push({
      id: "range-narrow",
      severity: "warn",
      title: "Narrow Price Range",
      message: `Your range is ${rangeWidthPct.toFixed(1)}% wide. Concentrated positions earn higher fees but suffer amplified impermanent loss. Monitor your position closely.`,
    });
  }

  // 3. Low TVL warning
  if (poolTvl > 0 && poolTvl < VERY_LOW_TVL_USD) {
    warnings.push({
      id: "tvl-very-low",
      severity: "critical",
      title: "Very Low Liquidity Pool",
      message: `This pool has only ${formatUsdCompact(poolTvl)} TVL. Extremely thin liquidity means high slippage and possible difficulty removing your position.`,
    });
  } else if (poolTvl > 0 && poolTvl < LOW_TVL_WARN_USD) {
    warnings.push({
      id: "tvl-low",
      severity: "warn",
      title: "Low Liquidity Pool",
      message: `This pool has ${formatUsdCompact(poolTvl)} TVL. Low-liquidity pools may have higher slippage and lower fee earnings.`,
    });
  }

  return warnings;
}

function formatUsdCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
/**
 * AddLiquidityV2Modal — SaucerSwap V2 Concentrated Liquidity Provision
 *
 * Full-featured modal for minting new V2 LP positions with:
 *   - Price range selection (presets + custom)
 *   - Dual token deposit inputs with auto-calculation
 *   - Real-time mint amount computation via tick-math.ts
 *   - Real-time wallet balance display with USD values [LP-UX-01]
 *   - Insufficient balance validation with per-input red warnings
 *   - Window-focus balance refresh (10s debounce)
 *   - HBAR gas reserve (2 HBAR) to prevent account drain
 *   - 25%/50%/75%/MAX quick-fill percentage pills [LP-UX-02]
 *   - Smart paired-balance warnings (amber advisory, non-blocking)
 *   - Per-input USD value display & total deposit value [LP-UX-03]
 *   - Dust amount guard (prevents sub-unit rounding-to-zero mints)
 *   - Comprehensive HBAR shortfall detection (deposit+fee+gas) [LP-UX-03]
 *   - Contextual CTA button with insufficient-funds red state [LP-UX-03]
 *   - Compact token input cards (24px icons, inline pills, right-aligned input) [LP-UX-04]
 *   - Slim + pill divider between token cards [LP-UX-04]
 *   - Dark theme: bg-slate-800/60, border-slate-700/50, pink/purple accents [LP-UX-04]
 *   - Auto-calculated price range presets (±5/10/25/50%, Custom%, Full) [LP-UX-04]
 *   - Full range default with ħ–Ħ / ∞ symbols instead of scientific notation [LP-UX-04]
 *   - Custom % input with direct min/max price fallback [LP-UX-04]
 *   - Fixed TokenIcon size prop (Tailwind classes vs numbers) [LP-UX-04]
 *   - Full-screen mobile sheet with safe area insets [LP-UX-05]
 *   - 44px minimum touch targets for all buttons on mobile [LP-UX-05]
 *   - Grid-based range presets to avoid 6-button cramping [LP-UX-05]
 *   - inputMode="decimal" for mobile numeric keyboards [LP-UX-05]
 *   - Wrappable quick-fill pills on narrow screens [LP-UX-05]
 *   - Slippage settings
 *   - Transaction flow states
 *
 * [LP-07] Step 7 of the V2 Liquidity Master Plan.
 * [LP-UX-01] Step 1 of the 5-Step UX Overhaul — Balance Resolution.
 * [LP-UX-02] Step 2 of the 5-Step UX Overhaul — Quick-Fill Buttons.
 * [LP-UX-03] Step 3 of the 5-Step UX Overhaul — Validation & Funds Guard.
 * [LP-UX-04] Step 4 of the 5-Step UX Overhaul — Compact Token Input Cards.
 * [LP-UX-05] Step 5 of the 5-Step UX Overhaul — Mobile Responsiveness.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { log } from "../utils/logger";
import {
  X,
  Droplets,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Info,
  Zap,
  Plus,
  ShieldAlert,
  Fuel,
  Wallet,
  RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import { TokenIcon } from "./TokenIcon";
import type { LivePool } from "../utils/defi-stats";
import {
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  nearestUsableTick,
  getTickSpacing,
  computeMintAmounts,
  mintAmountsWithSlippage,
  sqrtPriceX96ToPrice,
  priceToTick,
  tickToPrice,
  getMinMaxTick,
  TICK_SPACINGS,
  validateTickRange,
  type MintAmounts,
} from "../utils/saucerswap/tick-math";
import {
  fetchMintFeeInfo,
  fetchPoolStateViaRPC,
  type V2PoolState,
  type MintFeeInfo,
} from "../utils/saucerswap/positions";
import {
  computeSafetyWarnings,
  estimateImpermanentLoss,
  IL_SCENARIOS,
  V2_GAS_LIMITS,
  formatGasCost,
  classifyContractError,
} from "../utils/saucerswap/v2-liquidity-constants";
import { V2TokenAssociationGuard, type GuardResult } from "./V2TokenAssociationGuard";
import { logLpOperation } from "../utils/saucerswap/v2-lp-history";
import { mintPosition } from "../utils/saucerswap/v2-liquidity-engine";

// ── Types ────────────────────────────────────────────────────────────

type ModalState = "idle" | "computing" | "confirming" | "success" | "error";

interface AddLiquidityV2ModalProps {
  pool: LivePool;
  onClose: () => void;
  onSuccess?: () => void;
}

// ── Fee tier raw value from pool percentage ──────────────────────────
function feePercentToTier(pct: number): number {
  if (pct <= 0.02) return 100;
  if (pct <= 0.08) return 500;
  if (pct <= 0.2) return 1500;
  if (pct <= 0.5) return 3000;
  return 10000;
}

// ── Formatters ───────────────────────────────────────────────────────
function formatPrice(n: number): string {
  if (n >= 1_000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  if (n > 0) return n.toExponential(3);
  return "0";
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return "$0.00";
}

// ── [LP-UX-01] Balance Formatter ─────────────────────────────────────
// Bank-grade number formatting with locale-aware commas and smart decimals.
// Large balances show fewer decimals; tiny balances show more precision.
function formatBalance(n: number): string {
  if (n <= 0) return "0";
  if (n >= 1_000_000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1_000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (n >= 0.0001) return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  if (n > 0) return n.toExponential(3);
  return "0";
}

// ── [LP-UX-01] HBAR Reserve for Gas ──────────────────────────────────
// We reserve 2 HBAR for gas and transaction overhead (association fees,
// ContractExecuteTransaction gas, etc.) to prevent users from draining
// their account to zero and failing subsequent transactions.
const HBAR_GAS_RESERVE = 2;

// ── [LP-UX-02] Quick-Fill Percentage Presets ─────────────────────────
// Bank-grade quick-fill buttons let users set deposit amounts as a
// percentage of their available balance. MAX uses the full available
// balance (already net of HBAR gas reserve for HBAR tokens).
const QUICK_FILL_PCTS = [
  { label: "25%",  value: 0.25 },
  { label: "50%",  value: 0.50 },
  { label: "75%",  value: 0.75 },
  { label: "MAX",  value: 1.00 },
] as const;

// ── [LP-UX-02] Smart Amount Formatter ────────────────────────────────
// Formats quick-fill amounts with appropriate precision based on magnitude.
// Avoids jarring long decimals for large amounts while preserving precision
// for tiny token balances (e.g. wrapped BTC).
function formatQuickFillAmount(n: number, tokenDecimals: number): string {
  if (n <= 0) return "";
  const maxDec = Math.min(tokenDecimals, 8);
  let fixed: string;
  if (n >= 10_000)    fixed = n.toFixed(Math.min(maxDec, 2));
  else if (n >= 100)  fixed = n.toFixed(Math.min(maxDec, 4));
  else if (n >= 1)    fixed = n.toFixed(Math.min(maxDec, 4));
  else if (n >= 0.01) fixed = n.toFixed(Math.min(maxDec, 6));
  else                fixed = n.toFixed(maxDec);
  // Trim trailing zeros but keep at least 1 decimal for clarity
  fixed = fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ".0");
  return fixed;
}

// ── [LP-UX-04] Range Presets ─────────────────────────────────────────
// Percentage-based range presets auto-calculate min/max around current price.
// "Full" is the default — covers the entire tick range for the fee tier.
// "Custom" lets the user type an arbitrary ±X% for fine-grained control.
const RANGE_PRESETS = [
  { label: "±5%",  factor: 0.05 },
  { label: "±10%", factor: 0.10 },
  { label: "±25%", factor: 0.25 },
  { label: "±50%", factor: 0.50 },
  { label: "Custom", factor: -2 }, // sentinel: user types custom %
  { label: "Full",   factor: -1 }, // sentinel: full tick range (ħ–Ħ)
];
const PRESET_CUSTOM_IDX = 4; // Index of "Custom" in RANGE_PRESETS
const PRESET_FULL_IDX   = 5; // Index of "Full" in RANGE_PRESETS

// ── [LP-UX-04] Full-Range Price Formatter ────────────────────────────
// Replaces ugly scientific notation (2.954e-39 / 3.384e+38) with
// stylized ħ (HBAR small) and Ħ (HBAR large) symbols that convey
// "practically zero" to "practically infinite" in a visually elegant way.
function isFullRange(pLow: number, pHigh: number): boolean {
  return pLow < 1e-10 && pHigh > 1e20;
}

function formatPriceDisplay(n: number, fullRange: boolean, position: "low" | "high" | "mid"): string {
  if (fullRange) {
    if (position === "low") return "0";      // ħ shown separately via JSX
    if (position === "high") return "∞";     // Ħ shown separately via JSX
  }
  return formatPrice(n);
}

export function AddLiquidityV2Modal({ pool, onClose, onSuccess }: AddLiquidityV2ModalProps) {
  useEscapeKey(onClose);
  const { isDark } = useTheme();
  const { primaryWallet, hederaAccount, hederaNetwork, hbarPrice, refreshHederaBalance } = useWallet();
  const accountId = hederaAccount?.accountId || primaryWallet?.accountId || "";

  // ── Fee tier computation ──────────────────────────────────────────
  const feeTier = useMemo(() => feePercentToTier(pool.fee), [pool.fee]);
  const tickSpacing = useMemo(() => {
    try { return getTickSpacing(feeTier); }
    catch { return 60; } // default to 3000 tier spacing
  }, [feeTier]);

  // ── Pool state ────────────────────────────────────────────────────
  const [poolState, setPoolState] = useState<V2PoolState | null>(null);
  const [mintFee, setMintFee] = useState<MintFeeInfo | null>(null);
  const [loadingState, setLoadingState] = useState(true);

  // ── User inputs ───────────────────────────────────────────────────
  const [selectedPreset, setSelectedPreset] = useState(PRESET_FULL_IDX); // Full range default [LP-UX-04]
  const [customPriceLower, setCustomPriceLower] = useState("");
  const [customPriceUpper, setCustomPriceUpper] = useState("");
  const [customPct, setCustomPct] = useState(""); // [LP-UX-04] Custom ±X% input
  const [amount0Input, setAmount0Input] = useState("");
  const [amount1Input, setAmount1Input] = useState("");
  const [activeInput, setActiveInput] = useState<0 | 1>(0);
  const [slippageBps, setSlippageBps] = useState(100); // 1%
  const [modalState, setModalState] = useState<ModalState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txId, setTxId] = useState("");

  // ── [LP-14] Token association guard state ──────────────────────────
  const [guardResult, setGuardResult] = useState<GuardResult>("pending");

  // ── [LP-UX-02] Quick-fill percentage tracking ─────────────────────
  // Tracks which percentage pill is currently active for each token.
  // null = no pill selected (user typed manually or hasn't selected).
  // Cleared on manual input to avoid stale highlights.
  const [selectedPct0, setSelectedPct0] = useState<number | null>(null);
  const [selectedPct1, setSelectedPct1] = useState<number | null>(null);

  // Token info from pool
  const token0 = pool.tokenA;
  const token1 = pool.tokenB;

  // ── WHBAR Detection ───────────────────────────────────────────────
  // [LP-12] SaucerSwap V2 pools pair with WHBAR CONTRACT (0.0.1456985),
  // but WRAPpDEX displays "HBAR" and accepts native HBAR from users.
  // Behind the scenes: HBAR deposits are auto-wrapped, WHBAR is used in
  // mint params, and refundETH returns excess native HBAR.
  const WHBAR_HTS_IDS = ["0.0.1456986", "0.0.1456985"];
  const isToken0Hbar = token0.symbol === "HBAR" || token0.symbol === "WHBAR" ||
    (pool.tokenA.htsId != null && WHBAR_HTS_IDS.includes(pool.tokenA.htsId));
  const isToken1Hbar = token1.symbol === "HBAR" || token1.symbol === "WHBAR" ||
    (pool.tokenB.htsId != null && WHBAR_HTS_IDS.includes(pool.tokenB.htsId));
  const poolInvolvesHbar = isToken0Hbar || isToken1Hbar;

  // Display symbol: always show "HBAR" to users for WHBAR pools
  const displaySymbol0 = isToken0Hbar ? "HBAR" : token0.symbol;
  const displaySymbol1 = isToken1Hbar ? "HBAR" : token1.symbol;

  // Use decimals from pool data (API-provided), with known-symbol fallback
  const decimals0 = pool.tokenA.decimals || 8;
  const decimals1 = pool.tokenB.decimals || 8;

  // ── Fetch pool state + mint fee on mount ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingState(true);

    // 20s timeout to prevent hanging forever if RPC relay is down
    const timeout = setTimeout(() => {
      if (!cancelled) {
        log.warn("LP-Pool", "Pool fetch timed out after 20s", pool.contractId);
        setLoadingState(false);
      }
    }, 20_000);

    Promise.all([
      fetchPoolStateViaRPC(pool.contractId, hederaNetwork as any),
      fetchMintFeeInfo(hederaNetwork as any),
    ]).then(([state, fee]) => {
      clearTimeout(timeout);
      if (cancelled) return;
      setPoolState(state);
      setMintFee(fee);
      setLoadingState(false);
    }).catch(() => {
      clearTimeout(timeout);
      if (!cancelled) setLoadingState(false);
    });

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [pool.contractId, hederaNetwork]);

  // ── Current price from pool state ─────────────────────────────────
  const currentPrice = useMemo(() => {
    if (!poolState || poolState.sqrtPriceX96 <= 0n) return 0;
    return sqrtPriceX96ToPrice(poolState.sqrtPriceX96, decimals0, decimals1);
  }, [poolState, decimals0, decimals1]);

  // ═══════════════════════════════════════════════════════════════════
  // [LP-UX-01] BALANCE RESOLUTION
  // ═══════════════════════════════════════════════════════════════════
  // Resolves real-time wallet balances for both pool tokens.
  //
  // For HBAR/WHBAR: Uses hederaAccount.hbarBalance (native HBAR)
  //   - SaucerSwap V2 auto-wraps HBAR → WHBAR during mint, so we show
  //     the user's native HBAR balance even for WHBAR pool slots.
  //   - Available balance = hbarBalance - HBAR_GAS_RESERVE - mintFee
  //
  // For HTS tokens: Finds by tokenId in hederaAccount.tokens[]
  //   - `.balance` is already human-readable (divided by 10^decimals)
  //   - No reserve needed — full balance is available for deposit
  //
  // USD prices are derived from the pool's current price + hbarPrice:
  //   - If token is HBAR → priceUsd = hbarPrice
  //   - If pool involves HBAR → derive from pool price ratio
  //   - Both non-HBAR → USD unavailable (shows "-" gracefully)
  // ═══════════════════════════════════════════════════════════════════

  // Balance refresh state — tracks the subtle spinner on manual/focus refresh
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const lastRefreshRef = useRef<number>(Date.now());

  // ── Token 0 balance ───────────────────────────────────────────────
  const balance0 = useMemo((): { raw: number; available: number; usd: number; loaded: boolean } => {
    if (!hederaAccount) return { raw: 0, available: 0, usd: 0, loaded: false };

    let rawBalance = 0;

    if (isToken0Hbar) {
      // HBAR: use native balance, subtract gas reserve + mint fee
      rawBalance = hederaAccount.hbarBalance || 0;
      const mintFeeReserve = mintFee?.hbarAmount || 0;
      const available = Math.max(0, rawBalance - HBAR_GAS_RESERVE - mintFeeReserve);
      const usd = rawBalance * (hbarPrice || 0);
      return { raw: rawBalance, available, usd, loaded: true };
    }

    // HTS token: find by token ID in wallet
    const tokenEntry = hederaAccount.tokens?.find(
      (t) => t.tokenId === pool.tokenA.htsId
    );
    rawBalance = tokenEntry?.balance || 0;
    const available = rawBalance; // No reserve needed for HTS tokens

    // USD: derive from pool price if HBAR is in the pair
    let usd = 0;
    if (hbarPrice > 0 && currentPrice > 0) {
      if (isToken1Hbar) {
        // token0 → token1(HBAR): 1 token0 = currentPrice HBAR
        const token0PriceUsd = currentPrice * hbarPrice;
        usd = rawBalance * token0PriceUsd;
      }
      // If neither is HBAR, we can't derive — usd stays 0
    }

    return { raw: rawBalance, available, usd, loaded: true };
  }, [hederaAccount, isToken0Hbar, pool.tokenA.htsId, mintFee, hbarPrice, currentPrice, isToken1Hbar]);

  // ── Token 1 balance ───────────────────────────────────────────────
  const balance1 = useMemo((): { raw: number; available: number; usd: number; loaded: boolean } => {
    if (!hederaAccount) return { raw: 0, available: 0, usd: 0, loaded: false };

    let rawBalance = 0;

    if (isToken1Hbar) {
      // HBAR: use native balance, subtract gas reserve + mint fee
      rawBalance = hederaAccount.hbarBalance || 0;
      const mintFeeReserve = mintFee?.hbarAmount || 0;
      const available = Math.max(0, rawBalance - HBAR_GAS_RESERVE - mintFeeReserve);
      const usd = rawBalance * (hbarPrice || 0);
      return { raw: rawBalance, available, usd, loaded: true };
    }

    // HTS token: find by token ID in wallet
    const tokenEntry = hederaAccount.tokens?.find(
      (t) => t.tokenId === pool.tokenB.htsId
    );
    rawBalance = tokenEntry?.balance || 0;
    const available = rawBalance;

    // USD: derive from pool price if HBAR is in the pair
    let usd = 0;
    if (hbarPrice > 0 && currentPrice > 0) {
      if (isToken0Hbar) {
        // token1 per token0(HBAR): 1 HBAR = currentPrice token1
        // So 1 token1 = 1/currentPrice HBAR = hbarPrice/currentPrice USD
        const token1PriceUsd = currentPrice > 0 ? hbarPrice / currentPrice : 0;
        usd = rawBalance * token1PriceUsd;
      }
    }

    return { raw: rawBalance, available, usd, loaded: true };
  }, [hederaAccount, isToken1Hbar, pool.tokenB.htsId, mintFee, hbarPrice, currentPrice, isToken0Hbar]);

  // ── [LP-UX-03] Per-Token USD Price ─────────────────────────────────
  // Derives a stable USD price for each token in the pair. Used by:
  //   - Input USD display (shows USD value of deposit amount as you type)
  //   - Total deposit value in summary
  //   - Future fee/yield projections
  //
  // Derivation:
  //   - HBAR → hbarPrice directly from WalletContext (Mirror Node feed)
  //   - Non-HBAR paired with HBAR → algebraically from pool price ratio:
  //       currentPrice = token1 per token0 (from sqrtPriceX96)
  //       If token0=HBAR: 1 HBAR = currentPrice token1 → token1PriceUsd = hbarPrice / currentPrice
  //       If token1=HBAR: 1 token0 = currentPrice HBAR → token0PriceUsd = currentPrice × hbarPrice
  //   - Both non-HBAR → 0 (no reliable derivation without oracle)
  const tokenPriceUsd0 = useMemo((): number => {
    if (isToken0Hbar) return hbarPrice || 0;
    if (isToken1Hbar && hbarPrice > 0 && currentPrice > 0) {
      return currentPrice * hbarPrice; // 1 token0 = currentPrice HBAR = currentPrice × hbarPrice USD
    }
    return 0;
  }, [isToken0Hbar, isToken1Hbar, hbarPrice, currentPrice]);

  const tokenPriceUsd1 = useMemo((): number => {
    if (isToken1Hbar) return hbarPrice || 0;
    if (isToken0Hbar && hbarPrice > 0 && currentPrice > 0) {
      return currentPrice > 0 ? hbarPrice / currentPrice : 0; // 1 token1 = hbarPrice/currentPrice USD
    }
    return 0;
  }, [isToken0Hbar, isToken1Hbar, hbarPrice, currentPrice]);

  // ── Insufficient balance flags ────────────────────────────────────
  // Real-time per-input validation. Shows red warning on individual cards
  // and feeds into the global validationError to disable the CTA button.
  // [PRECISION-FIX] 0.001 tolerance buffer prevents false alerts when
  // calculated amounts match balances but differ by tiny rounding precision.
  const BALANCE_TOLERANCE = 0.001;
  
  const insufficientBalance0 = useMemo(() => {
    if (!balance0.loaded || !amount0Input) return false;
    const inputVal = parseFloat(amount0Input);
    if (!inputVal || inputVal <= 0) return false;
    // Allow up to 0.001 over balance (rounding tolerance)
    return inputVal > balance0.available + BALANCE_TOLERANCE;
  }, [balance0.loaded, balance0.available, amount0Input]);

  const insufficientBalance1 = useMemo(() => {
    if (!balance1.loaded || !amount1Input) return false;
    const inputVal = parseFloat(amount1Input);
    if (!inputVal || inputVal <= 0) return false;
    // Allow up to 0.001 over balance (rounding tolerance)
    return inputVal > balance1.available + BALANCE_TOLERANCE;
  }, [balance1.loaded, balance1.available, amount1Input]);

  // ── [LP-UX-02] Paired balance warning (non-blocking) ─────────────
  // When the active input drives the paired amount beyond the other
  // token's balance, show an amber advisory — but DON'T block the
  // transaction. The user deliberately chose their primary amount;
  // they may have more funds incoming or accept partial fills.
  const pairedExceedsBalance = useMemo(() => {
    if (activeInput === 0 && insufficientBalance1 && amount0Input) return 1; // Token B exceeded
    if (activeInput === 1 && insufficientBalance0 && amount1Input) return 0; // Token A exceeded
    return null; // No paired issue
  }, [activeInput, insufficientBalance0, insufficientBalance1, amount0Input, amount1Input]);

  // ── [LP-UX-03] Input USD Values ───────────────────────────────────
  // Real-time USD conversion of whatever the user has typed (or the
  // auto-fill has calculated). Displayed inline under each input for
  // instant dollar awareness — essential for bank-grade DeFi UX.
  const inputUsd0 = useMemo((): number => {
    if (!amount0Input || tokenPriceUsd0 <= 0) return 0;
    const val = parseFloat(amount0Input);
    return val > 0 ? val * tokenPriceUsd0 : 0;
  }, [amount0Input, tokenPriceUsd0]);

  const inputUsd1 = useMemo((): number => {
    if (!amount1Input || tokenPriceUsd1 <= 0) return 0;
    const val = parseFloat(amount1Input);
    return val > 0 ? val * tokenPriceUsd1 : 0;
  }, [amount1Input, tokenPriceUsd1]);

  // ── [LP-UX-03] Total Deposit Value ────────────────────────────────
  // Combined USD value of both token deposits. Shown in the summary
  // section so the user sees their total capital commitment at a glance.
  const totalDepositUsd = useMemo((): number => {
    return inputUsd0 + inputUsd1;
  }, [inputUsd0, inputUsd1]);

  // ── [LP-UX-03] HBAR Total Requirement Check ──────────────────────
  // For pools involving HBAR, validates that the user's TOTAL HBAR
  // holdings cover: deposit + mint fee + gas reserve. This is more
  // comprehensive than the per-input check because it accounts for
  // the mint fee that isn't part of the deposit amount.
  const hbarTotalShortfall = useMemo((): number => {
    if (!poolInvolvesHbar || !hederaAccount) return 0;
    const hbarBalance = hederaAccount.hbarBalance || 0;
    const mintFeeHbar = mintFee?.hbarAmount || 0;
    const depositHbar = isToken0Hbar
      ? parseFloat(amount0Input || "0")
      : parseFloat(amount1Input || "0");
    const totalNeeded = depositHbar + mintFeeHbar + HBAR_GAS_RESERVE;
    return totalNeeded > hbarBalance ? totalNeeded - hbarBalance : 0;
  }, [poolInvolvesHbar, hederaAccount, mintFee, isToken0Hbar, amount0Input, amount1Input]);

  // ── [LP-UX-02] Quick-Fill Handlers ────────────────────────────────
  // Sets the amount input to a percentage of the user's available
  // balance and marks that token as the active input, triggering
  // computeMintAmounts → auto-fill of the paired token.
  const handleQuickFill0 = useCallback((pctValue: number) => {
    if (!balance0.loaded || balance0.available <= 0) return;
    const amount = balance0.available * pctValue;
    const formatted = formatQuickFillAmount(amount, decimals0);
    if (!formatted) return;
    setAmount0Input(formatted);
    setActiveInput(0);
    setSelectedPct0(pctValue);
    setSelectedPct1(null); // Clear the other side's pill highlight
  }, [balance0.loaded, balance0.available, decimals0]);

  const handleQuickFill1 = useCallback((pctValue: number) => {
    if (!balance1.loaded || balance1.available <= 0) return;
    const amount = balance1.available * pctValue;
    const formatted = formatQuickFillAmount(amount, decimals1);
    if (!formatted) return;
    setAmount1Input(formatted);
    setActiveInput(1);
    setSelectedPct1(pctValue);
    setSelectedPct0(null); // Clear the other side's pill highlight
  }, [balance1.loaded, balance1.available, decimals1]);

  // ── [LP-UX-01] Window Focus Refresh ───────────────────────────────
  // When the user tabs back to the app (e.g. after confirming a tx in
  // HashPack, or switching from another tab), silently refresh balances.
  // Debounced to 10s to avoid hammering the Mirror Node API.
  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastRefreshRef.current < 10_000) return; // 10s debounce
      lastRefreshRef.current = now;
      setBalanceRefreshing(true);
      refreshHederaBalance()
        .catch(() => {}) // Non-blocking — stale data is better than no data
        .finally(() => setBalanceRefreshing(false));
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshHederaBalance]);

  // ── Initial balance refresh on modal open ─────────────────────────
  // Ensure we have the freshest balances when the modal opens, since the
  // user may have done swaps or transfers since the WalletContext last
  // auto-refreshed (30s interval).
  useEffect(() => {
    if (!accountId) return;
    setBalanceRefreshing(true);
    refreshHederaBalance()
      .catch(() => {})
      .finally(() => setBalanceRefreshing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount — accountId is stable during modal lifetime

  // ── Tick range from preset or custom ──────────────────────────────
  // [LP-UX-04] Always produces valid tick ranges for percentage presets
  // and Full range. Only Custom with no user input returns ZERO.
  // Helper: compute full-range ticks as a safe fallback
  const fullRangeTicks = useMemo(() => {
    try {
      const { minTick, maxTick } = getMinMaxTick(feeTier);
      return { tl: minTick, tu: maxTick };
    } catch {
      return { tl: -887220, tu: 887220 }; // Safe default for 60-spacing
    }
  }, [feeTier]);

  const { tickLower, tickUpper, priceLower, priceUpper } = useMemo(() => {
    const ZERO = { tickLower: 0, tickUpper: 0, priceLower: 0, priceUpper: 0 };
    if (!currentPrice || currentPrice <= 0) {
      log.debug("LP-Range", "currentPrice not ready", currentPrice);
      return ZERO;
    }

    const preset = RANGE_PRESETS[selectedPreset];
    if (!preset) {
      log.warn("LP-Range", "Invalid preset index", selectedPreset);
      return ZERO;
    }

    try {
      let tl: number, tu: number;

      if (preset.factor === -1) {
        // Full range — covers entire tick space for this fee tier
        tl = fullRangeTicks.tl;
        tu = fullRangeTicks.tu;
      } else if (preset.factor === -2) {
        // [LP-UX-04] Custom ±X% — user types a custom percentage
        const pctVal = parseFloat(customPct);
        if (pctVal > 0 && pctVal <= 99) {
          const factor = pctVal / 100;
          const pLower = currentPrice * (1 - factor);
          const pUpper = currentPrice * (1 + factor);
          tl = nearestUsableTick(priceToTick(Math.max(pLower, 1e-30), decimals0, decimals1), tickSpacing);
          tu = nearestUsableTick(priceToTick(pUpper, decimals0, decimals1), tickSpacing);
        } else if (customPriceLower && customPriceUpper) {
          // Fallback: direct price inputs
          const pLower = parseFloat(customPriceLower);
          const pUpper = parseFloat(customPriceUpper);
          if (pLower > 0 && pUpper > pLower) {
            tl = nearestUsableTick(priceToTick(pLower, decimals0, decimals1), tickSpacing);
            tu = nearestUsableTick(priceToTick(pUpper, decimals0, decimals1), tickSpacing);
          } else {
            return ZERO; // Custom mode with no valid input — waiting for user
          }
        } else {
          return ZERO; // Custom mode — waiting for user input
        }
      } else {
        // Preset percentage range (±5%, ±10%, ±25%, ±50%)
        // Clamp lower price to a tiny positive to avoid log(0) in priceToTick
        const pLower = Math.max(currentPrice * (1 - preset.factor), 1e-30);
        const pUpper = currentPrice * (1 + preset.factor);
        tl = nearestUsableTick(priceToTick(pLower, decimals0, decimals1), tickSpacing);
        tu = nearestUsableTick(priceToTick(pUpper, decimals0, decimals1), tickSpacing);
      }

      // Ensure tl < tu — if collapsed to same tick, expand by one spacing
      if (tl >= tu) {
        log.warn("LP-Range", "Tick range collapsed, expanding", { tl, tu, tickSpacing, preset: preset.label });
        tu = tl + tickSpacing;
      }

      // Safety: validate ticks are within global bounds
      const { minTick, maxTick } = getMinMaxTick(feeTier);
      if (tl < minTick) tl = minTick;
      if (tu > maxTick) tu = maxTick;
      if (tl >= tu) {
        // If clamping broke the range, fallback to full range
        log.warn("LP-Range", "Tick range invalid after clamping, falling back to full range");
        tl = fullRangeTicks.tl;
        tu = fullRangeTicks.tu;
      }

      const pL = tickToPrice(tl, decimals0, decimals1);
      const pU = tickToPrice(tu, decimals0, decimals1);

      log.debug("LP-Range", "Tick range computed", {
        preset: preset.label, tl, tu, pL: pL.toFixed(6), pU: pU.toFixed(6),
        currentPrice: currentPrice.toFixed(6), feeTier, tickSpacing,
      });

      return { tickLower: tl, tickUpper: tu, priceLower: pL, priceUpper: pU };
    } catch (err) {
      console.error("[LP-UX-04] Tick range computation error, falling back to full range:", err);
      // Fallback to full range instead of ZERO — ensures the user always gets valid ticks
      try {
        const pL = tickToPrice(fullRangeTicks.tl, decimals0, decimals1);
        const pU = tickToPrice(fullRangeTicks.tu, decimals0, decimals1);
        return { tickLower: fullRangeTicks.tl, tickUpper: fullRangeTicks.tu, priceLower: pL, priceUpper: pU };
      } catch {
        return ZERO;
      }
    }
  }, [currentPrice, selectedPreset, customPriceLower, customPriceUpper, customPct, feeTier, tickSpacing, decimals0, decimals1, fullRangeTicks]);

  // ── Compute mint amounts ──────────────────────────────────────────
  const mintResult = useMemo((): MintAmounts | null => {
    if (!poolState || tickLower >= tickUpper) return null;

    const inputStr = activeInput === 0 ? amount0Input : amount1Input;
    const inputVal = parseFloat(inputStr);
    if (!inputVal || inputVal <= 0) return null;

    const rawAmount = BigInt(Math.floor(inputVal * Math.pow(10, activeInput === 0 ? decimals0 : decimals1)));
    if (rawAmount <= 0n) return null;

    try {
      const result = computeMintAmounts(
        poolState.sqrtPriceX96,
        tickLower,
        tickUpper,
        rawAmount,
        activeInput === 0,
      );
      log.debug("LP-Mint", "computeMintAmounts result", {
        amount0: result.amount0.toString(),
        amount1: result.amount1.toString(),
        liquidity: result.liquidity.toString(),
      });
      return result;
    } catch (err) {
      console.error("[LP-UX-04] computeMintAmounts error:", err, { tickLower, tickUpper, rawAmount: rawAmount.toString() });
      return null;
    }
  }, [poolState, tickLower, tickUpper, amount0Input, amount1Input, activeInput, decimals0, decimals1]);

  // Auto-fill the other input
  useEffect(() => {
    if (!mintResult) return;
    if (activeInput === 0 && mintResult.amount1 > 0n) {
      const val = Number(mintResult.amount1) / Math.pow(10, decimals1);
      setAmount1Input(val > 0 ? val.toFixed(6) : "");
    } else if (activeInput === 1 && mintResult.amount0 > 0n) {
      const val = Number(mintResult.amount0) / Math.pow(10, decimals0);
      setAmount0Input(val > 0 ? val.toFixed(6) : "");
    }
  }, [mintResult, activeInput, decimals0, decimals1]);

  // ── Validation ────────────────────────────────────────────────────
  const validationError = useMemo(() => {
    if (!accountId) return "Connect wallet first";
    if (loadingState) return "Loading pool data...";
    if (!poolState) return "Pool state unavailable";
    if (tickLower >= tickUpper) {
      // Custom mode with no input is expected — show a gentle prompt
      if (selectedPreset === PRESET_CUSTOM_IDX) return "Enter a custom range percentage";
      log.warn("LP-Validate", "tickLower >= tickUpper", { tickLower, tickUpper, selectedPreset });
      return "Invalid price range";
    }
    const rangeErr = validateTickRange(tickLower, tickUpper, feeTier);
    if (rangeErr) {
      log.warn("LP-Validate", "validateTickRange failed", { rangeErr, tickLower, tickUpper, feeTier });
      return rangeErr;
    }
    if (!amount0Input && !amount1Input) return "Enter an amount";
    // [LP-UX-03] Dust guard — amounts that round to 0 raw units can't mint
    const inputStr = activeInput === 0 ? amount0Input : amount1Input;
    const inputVal = parseFloat(inputStr || "0");
    const inputDec = activeInput === 0 ? decimals0 : decimals1;
    if (inputVal > 0 && Math.floor(inputVal * Math.pow(10, inputDec)) <= 0) {
      return "Amount too small (rounds to zero)";
    }
    if (!mintResult) return "Enter a valid amount";
    // [LP-UX-02] Balance validation — block only on the ACTIVE input's
    // insufficient balance. If the paired (auto-filled) side exceeds its
    // balance, that's shown as an amber warning but doesn't block the CTA.
    // Rationale: the user deliberately chose their primary deposit amount.
    if (activeInput === 0 && insufficientBalance0) return `Insufficient ${displaySymbol0} balance`;
    if (activeInput === 1 && insufficientBalance1) return `Insufficient ${displaySymbol1} balance`;
    // [LP-UX-03] Comprehensive HBAR shortfall — checks deposit + mint fee + gas reserve
    // against total HBAR balance. Catches edge cases where the deposit alone fits
    // but adding the mint fee tips the account into insufficient territory.
    if (hbarTotalShortfall > 0) {
      return `Need ${hbarTotalShortfall.toFixed(2)} more HBAR (deposit + fee + gas)`;
    }
    return null;
  }, [accountId, loadingState, poolState, tickLower, tickUpper, feeTier, amount0Input, amount1Input, mintResult, insufficientBalance0, insufficientBalance1, displaySymbol0, displaySymbol1, activeInput, decimals0, decimals1, hbarTotalShortfall]);

  // ── Execute (stub — will call liquidity-engine.ts in Step 5) ─────
  // ── [LP-05] Step progress state for UI feedback ──────────────────
  const [mintStep, setMintStep] = useState<{ step: number; total: number; desc: string } | null>(null);

  const handleExecute = async () => {
    if (validationError || !mintResult || !poolState) return;

    setModalState("confirming");
    setErrorMsg("");
    setMintStep(null);

    try {
      log.info("LP-Mint", `Mint starting: ${displaySymbol0}/${displaySymbol1} fee=${feeTier}`, {
        amount0: mintResult.amount0.toString(),
        amount1: mintResult.amount1.toString(),
        tickLower,
        tickUpper,
      });

      // [LP-05] Call the real V2 liquidity engine — no simulation
      const result = await mintPosition({
        accountId,
        network: (hederaNetwork || "mainnet") as any,
        poolContractId: pool.contractId,
        token0HtsId: pool.tokenA.htsId,
        token1HtsId: pool.tokenB.htsId,
        isToken0Hbar,
        isToken1Hbar,
        feeTier,
        tickLower,
        tickUpper,
        amount0Desired: mintResult.amount0,
        amount1Desired: mintResult.amount1,
        slippageBps,
        mintFee,
        onStep: (step, total, desc) => {
          setMintStep({ step, total, desc });
          log.debug("LP-Mint", `Step ${step}/${total}: ${desc}`);
        },
      });

      if (result.userCancelled) {
        // User rejected in wallet — return to idle, no error screen
        setModalState("idle");
        setMintStep(null);
        toast.info("Transaction cancelled in wallet");
        return;
      }

      if (!result.success) {
        setModalState("error");
        const classified = classifyContractError(result.error || "Mint failed");
        setErrorMsg(classified.message);
        console.error("[LP-05] Mint failed:", result.error);
        return;
      }

      // ── SUCCESS ─────────────────────────────────────────────────
      setModalState("success");
      setTxId(result.transactionId || "");
      setMintStep(null);

      toast.success("Liquidity position created!", {
        description: result.transactionId
          ? `TX: ${result.transactionId.slice(0, 20)}...`
          : undefined,
      });

      // Refresh balances + invalidate position cache after successful mint
      refreshHederaBalance().catch(() => {});
      // Force V2PositionTracker to re-fetch from API on next render
      try {
        const { invalidatePositionCacheForAccount } = await import("../utils/saucerswap/positions");
        invalidatePositionCacheForAccount(accountId, (hederaNetwork || "mainnet") as any);
        log.debug("LP-Mint", "Position cache invalidated post-mint", accountId);
      } catch {}

      // [LP-15] Log the operation for history tracking
      if (accountId) {
        logLpOperation(accountId, {
          action: "mint",
          tokenSN: 0, // Parsed from Mirror Node post-hoc
          pool: `${displaySymbol0}/${displaySymbol1}`,
          amount0: mintResult.amount0.toString(),
          amount1: mintResult.amount1.toString(),
          token0Symbol: displaySymbol0,
          token1Symbol: displaySymbol1,
          network: hederaNetwork || "mainnet",
          status: "success",
          txHash: result.transactionId,
        }).catch(() => {}); // Non-blocking
      }

      // Notify parent to refresh position list
      onSuccess?.();

    } catch (err: any) {
      console.error("[LP-05] Unexpected mint error:", err);
      setModalState("error");
      const classified = classifyContractError(err);
      setErrorMsg(classified.message);
      if (classified.code === "USER_REJECTED") {
        setModalState("idle"); // Don't show error for user rejections
        toast.info("Transaction cancelled");
      }
    }
  };

  // ── [LP-UX-04] Full range detection ────────────────────────────────
  const isFullRangeActive = useMemo(
    () => isFullRange(priceLower, priceUpper),
    [priceLower, priceUpper]
  );

  // ── Styling ───────────────────────────────────────────────────────
  // [LP-UX-05] Mobile: full-screen bottom sheet; Desktop: centered dialog
  const overlayClass = "fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm";
  const modalClass = isDark
    ? "bg-slate-900 border-t sm:border border-pink-500/20 text-white"
    : "bg-white border-t sm:border border-gray-200 text-gray-900";
  const inputClass = isDark
    ? "bg-slate-800/50 border border-pink-500/10 text-white placeholder-slate-500"
    : "bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400";
  const labelClass = isDark ? "text-slate-400" : "text-gray-500";

  // Range bar position
  const rangeWidth = priceUpper - priceLower;
  const currentPosInRange = rangeWidth > 0
    ? Math.max(0, Math.min(100, ((currentPrice - priceLower) / rangeWidth) * 100))
    : 50;

  return (
    <div className={overlayClass} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className={`${modalClass} rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]`}
      >
        {/* [LP-UX-05] Mobile drag handle */}
        <div className="flex justify-center pt-2 pb-0 sm:hidden">
          <div className={`w-10 h-1 rounded-full ${isDark ? "bg-slate-700" : "bg-gray-300"}`} />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-pink-500/10">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <TokenIcon src={token0.logo} symbol={token0.symbol} size="w-7 h-7" className="ring-2 ring-slate-900/50 z-10" />
              <TokenIcon src={token1.logo} symbol={token1.symbol} size="w-7 h-7" className="ring-2 ring-slate-900/50" />
            </div>
            <div>
              <div className="font-bold text-sm">{token0.symbol}/{token1.symbol}</div>
              <div className={`text-xs flex items-center gap-1.5 ${labelClass}`}>
                <span className={`px-1.5 py-0.5 rounded ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>{pool.fee}%</span>
                <span className={`px-1.5 py-0.5 rounded font-medium ${isDark ? "bg-purple-500/10 text-purple-400" : "bg-purple-50 text-purple-600"}`}>V2</span>
                {currentPrice > 0 && (
                  <span>Price: {formatPrice(currentPrice)}</span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className={`p-2.5 sm:p-1.5 rounded-lg transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${isDark ? "hover:bg-slate-800 active:bg-slate-700" : "hover:bg-gray-100 active:bg-gray-200"}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Loading State */}
        {loadingState && (
          <div className="p-8 text-center">
            <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin text-pink-400" />
            <div className={`text-xs ${labelClass}`}>Loading pool data...</div>
          </div>
        )}

        {/* Main Content */}
        {!loadingState && modalState === "idle" && (
          <div className="p-4 space-y-4">
            {/* ═══ [LP-UX-04] Price Range Selection — Redesigned ═══ */}
            <div>
              <div className={`text-xs font-bold mb-2 ${labelClass}`}>Select Price Range</div>

              {/* [LP-UX-05] Preset Buttons — grid on mobile, flex on desktop */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-1">
                {RANGE_PRESETS.map((preset, i) => {
                  const isActive = selectedPreset === i;
                  // "Full" gets special styling with ħ–Ħ symbol pair
                  const isFull = preset.factor === -1;
                  const isCustom = preset.factor === -2;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => {
                        setSelectedPreset(i);
                        if (!isCustom) {
                          setCustomPriceLower("");
                          setCustomPriceUpper("");
                        }
                      }}
                      className={`py-2.5 sm:py-1.5 rounded-lg text-xs sm:text-[11px] font-bold transition-all min-h-[44px] sm:min-h-0 ${
                        isActive
                          ? isFull
                            ? "bg-gradient-to-r from-cyan-600 to-purple-600 text-white shadow-lg shadow-cyan-500/20"
                            : "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
                          : isDark
                          ? "bg-slate-800/80 hover:bg-slate-700 text-slate-400 border border-slate-700/50"
                          : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                      }`}
                    >
                      {isFull ? (
                        <span className="flex items-center justify-center gap-1">
                          <span className="text-[13px] opacity-90">ħ</span>
                          <span className="text-[9px] opacity-60">—</span>
                          <span className="text-[13px] opacity-90">Ħ</span>
                        </span>
                      ) : (
                        preset.label
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Custom % Input — shown when Custom preset is active */}
              {selectedPreset === PRESET_CUSTOM_IDX && (
                <div className={`mt-2 rounded-lg p-2.5 ${isDark ? "bg-slate-800/60 border border-slate-700/50" : "bg-gray-50 border border-gray-200"}`}>
                  <div className="flex items-center gap-2">
                    <label className={`text-[11px] font-bold shrink-0 ${labelClass}`}>±</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="15"
                      value={customPct}
                      onChange={(e) => setCustomPct(e.target.value)}
                      className={`w-20 sm:w-16 px-2.5 sm:px-2 py-2 sm:py-1 rounded text-sm font-mono text-right min-h-[40px] sm:min-h-0 ${inputClass}`}
                      min="1"
                      max="99"
                    />
                    <span className={`text-[11px] font-bold ${labelClass}`}>% around current price</span>
                  </div>
                  {/* Advanced: direct min/max price override */}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <label className={`text-[10px] ${labelClass}`}>or Min Price</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder={priceLower > 0 ? formatPrice(priceLower) : "0.00"}
                        value={customPriceLower}
                        onChange={(e) => { setCustomPriceLower(e.target.value); setCustomPct(""); }}
                        className={`w-full px-2.5 sm:px-2 py-2 sm:py-1 rounded text-xs font-mono min-h-[40px] sm:min-h-0 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label className={`text-[10px] ${labelClass}`}>or Max Price</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder={priceUpper > 0 ? formatPrice(priceUpper) : "∞"}
                        value={customPriceUpper}
                        onChange={(e) => { setCustomPriceUpper(e.target.value); setCustomPct(""); }}
                        className={`w-full px-2.5 sm:px-2 py-2 sm:py-1 rounded text-xs font-mono min-h-[40px] sm:min-h-0 ${inputClass}`}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Range Visualization */}
              {priceLower > 0 && priceUpper > 0 && (
                <div className="mt-2">
                  <div className="relative h-1.5 rounded-full overflow-hidden bg-slate-700/30">
                    <div
                      className={`absolute h-full rounded-full ${
                        isFullRangeActive
                          ? "bg-gradient-to-r from-cyan-500/40 via-purple-500/40 to-pink-500/40"
                          : "bg-gradient-to-r from-pink-500/30 to-purple-500/30"
                      }`}
                      style={isFullRangeActive ? { left: "0%", right: "0%" } : { left: "10%", right: "10%" }}
                    />
                    {currentPrice > 0 && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white border-2 border-pink-500 shadow-lg shadow-pink-500/30"
                        style={{
                          left: isFullRangeActive ? "50%" : `${Math.max(5, Math.min(95, currentPosInRange * 0.8 + 10))}%`,
                          transform: "translateX(-50%) translateY(-50%)"
                        }}
                      />
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] mt-1">
                    {isFullRangeActive ? (
                      <>
                        <span className="font-mono text-cyan-400/70">0 <span className="text-[9px]">ħ</span></span>
                        <span className="font-mono text-pink-400">{formatPrice(currentPrice)}</span>
                        <span className="font-mono text-purple-400/70">∞ <span className="text-[9px]">Ħ</span></span>
                      </>
                    ) : (
                      <>
                        <span className={`font-mono ${labelClass}`}>{formatPrice(priceLower)}</span>
                        <span className="font-mono text-pink-400">{formatPrice(currentPrice)}</span>
                        <span className={`font-mono ${labelClass}`}>{formatPrice(priceUpper)}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ═══ [LP-UX-04] Compact Deposit Cards ═══ */}
            <div className="space-y-1.5">
              <div className={`text-xs font-bold ${labelClass}`}>Deposit Amounts</div>

              {/* ── Token 0 Card ── */}
              <div className={`rounded-lg p-3 transition-all ${
                insufficientBalance0 && activeInput === 0
                  ? isDark ? "bg-red-500/5 border border-red-500/20" : "bg-red-50 border border-red-200"
                  : pairedExceedsBalance === 0
                  ? isDark ? "bg-amber-500/5 border border-amber-500/15" : "bg-amber-50 border border-amber-200"
                  : isDark ? "bg-slate-800/60 border border-slate-700/50" : "bg-gray-50 border border-gray-200"
              }`}>
                {/* Row 1: Icon + Symbol + Balance */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <TokenIcon src={token0.logo} symbol={token0.symbol} size="w-5 h-5" />
                    <span className="font-bold text-sm">{displaySymbol0}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Wallet className={`w-3 h-3 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                    <span className={`text-xs font-mono ${labelClass}`}>
                      {balance0.loaded ? formatBalance(balance0.available) : "--"}
                    </span>
                    {balance0.loaded && balance0.usd > 0 && (
                      <span className={`text-[10px] font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                        (~{formatUsd(balance0.usd)})
                      </span>
                    )}
                    {balanceRefreshing && <RefreshCw className="w-2.5 h-2.5 animate-spin text-pink-400" />}
                  </div>
                </div>
                {/* Row 2: Input + Quick-fill pills inline */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.0"
                      value={amount0Input}
                      onChange={(e) => {
                        setAmount0Input(e.target.value);
                        setActiveInput(0);
                        setSelectedPct0(null);
                      }}
                      className={`w-full bg-transparent text-right text-lg sm:text-base font-mono font-bold outline-none pr-0.5 ${
                        isDark ? "placeholder-slate-600" : "placeholder-gray-300"
                      }`}
                    />
                    {/* [LP-UX-03] Inline USD value under input */}
                    {inputUsd0 > 0 && (
                      <div className={`text-[10px] font-mono text-right ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                        ~{formatUsd(inputUsd0)}
                      </div>
                    )}
                  </div>
                  {balance0.loaded && balance0.available > 0 && (
                    <div className="flex items-center gap-1.5 sm:gap-1 shrink-0 flex-wrap justify-end">
                      {QUICK_FILL_PCTS.map((pct) => {
                        const isActive = selectedPct0 === pct.value;
                        return (
                          <button
                            key={pct.label}
                            onClick={() => handleQuickFill0(pct.value)}
                            className={`px-3 sm:px-2 py-1.5 sm:py-1 rounded text-xs sm:text-[10px] font-bold transition-all duration-150 min-h-[36px] sm:min-h-0 ${
                              isActive
                                ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm shadow-pink-500/20"
                                : isDark
                                ? "bg-slate-700/60 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                            }`}
                          >
                            {pct.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* Warnings row */}
                {insufficientBalance0 && activeInput === 0 && (
                  <div className="flex items-center gap-1 text-xs text-red-400 mt-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    Insufficient {displaySymbol0} balance
                  </div>
                )}
                {pairedExceedsBalance === 0 && (
                  <div className={`flex items-center gap-1 text-xs mt-1.5 ${isDark ? "text-amber-400/80" : "text-amber-600"}`}>
                    <Info className="w-3 h-3 shrink-0" />
                    Auto-fill exceeds {displaySymbol0} balance
                  </div>
                )}
              </div>

              {/* ── Slim + Divider ── */}
              <div className="flex items-center justify-center py-0.5">
                <div className={`flex items-center gap-2 ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                  <div className={`h-px w-8 ${isDark ? "bg-slate-700/50" : "bg-gray-200"}`} />
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    isDark ? "bg-slate-800 border border-slate-700/50" : "bg-gray-100 border border-gray-200"
                  }`}>
                    <Plus className="w-3 h-3 text-pink-400" />
                  </div>
                  <div className={`h-px w-8 ${isDark ? "bg-slate-700/50" : "bg-gray-200"}`} />
                </div>
              </div>

              {/* ── Token 1 Card ── */}
              <div className={`rounded-lg p-3 transition-all ${
                insufficientBalance1 && activeInput === 1
                  ? isDark ? "bg-red-500/5 border border-red-500/20" : "bg-red-50 border border-red-200"
                  : pairedExceedsBalance === 1
                  ? isDark ? "bg-amber-500/5 border border-amber-500/15" : "bg-amber-50 border border-amber-200"
                  : isDark ? "bg-slate-800/60 border border-slate-700/50" : "bg-gray-50 border border-gray-200"
              }`}>
                {/* Row 1: Icon + Symbol + Balance */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <TokenIcon src={token1.logo} symbol={token1.symbol} size="w-5 h-5" />
                    <span className="font-bold text-sm">{displaySymbol1}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Wallet className={`w-3 h-3 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                    <span className={`text-xs font-mono ${labelClass}`}>
                      {balance1.loaded ? formatBalance(balance1.available) : "--"}
                    </span>
                    {balance1.loaded && balance1.usd > 0 && (
                      <span className={`text-[10px] font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                        (~{formatUsd(balance1.usd)})
                      </span>
                    )}
                    {balanceRefreshing && <RefreshCw className="w-2.5 h-2.5 animate-spin text-pink-400" />}
                  </div>
                </div>
                {/* Row 2: Input + Quick-fill pills inline */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.0"
                      value={amount1Input}
                      onChange={(e) => {
                        setAmount1Input(e.target.value);
                        setActiveInput(1);
                        setSelectedPct1(null);
                      }}
                      className={`w-full bg-transparent text-right text-lg sm:text-base font-mono font-bold outline-none pr-0.5 ${
                        isDark ? "placeholder-slate-600" : "placeholder-gray-300"
                      }`}
                    />
                    {/* [LP-UX-03] Inline USD value under input */}
                    {inputUsd1 > 0 && (
                      <div className={`text-[10px] font-mono text-right ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                        ~{formatUsd(inputUsd1)}
                      </div>
                    )}
                  </div>
                  {balance1.loaded && balance1.available > 0 && (
                    <div className="flex items-center gap-1.5 sm:gap-1 shrink-0 flex-wrap justify-end">
                      {QUICK_FILL_PCTS.map((pct) => {
                        const isActive = selectedPct1 === pct.value;
                        return (
                          <button
                            key={pct.label}
                            onClick={() => handleQuickFill1(pct.value)}
                            className={`px-3 sm:px-2 py-1.5 sm:py-1 rounded text-xs sm:text-[10px] font-bold transition-all duration-150 min-h-[36px] sm:min-h-0 ${
                              isActive
                                ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm shadow-pink-500/20"
                                : isDark
                                ? "bg-slate-700/60 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                            }`}
                          >
                            {pct.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* Warnings row */}
                {insufficientBalance1 && activeInput === 1 && (
                  <div className="flex items-center gap-1 text-xs text-red-400 mt-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    Insufficient {displaySymbol1} balance
                  </div>
                )}
                {pairedExceedsBalance === 1 && (
                  <div className={`flex items-center gap-1 text-xs mt-1.5 ${isDark ? "text-amber-400/80" : "text-amber-600"}`}>
                    <Info className="w-3 h-3 shrink-0" />
                    Auto-fill exceeds {displaySymbol1} balance
                  </div>
                )}
              </div>
            </div>

            {/* Slippage */}
            <div className="flex items-center justify-between">
              <span className={`text-xs ${labelClass}`}>Slippage Tolerance</span>
              <div className="flex gap-1">
                {[50, 100, 300].map((bps) => (
                  <button
                    key={bps}
                    onClick={() => setSlippageBps(bps)}
                    className={`px-3.5 sm:px-2.5 py-2 sm:py-1 rounded text-xs font-bold transition-all min-h-[40px] sm:min-h-0 ${
                      slippageBps === bps
                        ? "bg-pink-600 text-white"
                        : isDark ? "bg-slate-800 text-slate-400 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {bps / 100}%
                  </button>
                ))}
              </div>
            </div>

            {/* ═══ [LP-13] Safety Warnings ═══ */}
            {(() => {
              const rangeWidthPct = currentPrice > 0 && priceLower > 0 && priceUpper > 0
                ? ((priceUpper - priceLower) / currentPrice) * 100
                : 0;
              const warnings = computeSafetyWarnings({
                currentPrice,
                priceLower,
                priceUpper,
                poolTvl: pool.tvl,
                rangeWidthPct,
                token0Symbol: displaySymbol0,
                token1Symbol: displaySymbol1,
              });
              if (warnings.length === 0) return null;
              return (
                <div className="space-y-1.5">
                  {warnings.map((w) => (
                    <div
                      key={w.id}
                      className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${
                        w.severity === "critical"
                          ? isDark ? "bg-red-500/10 border border-red-500/20 text-red-300" : "bg-red-50 border border-red-200 text-red-700"
                          : w.severity === "warn"
                          ? isDark ? "bg-amber-500/10 border border-amber-500/20 text-amber-300" : "bg-amber-50 border border-amber-200 text-amber-700"
                          : isDark ? "bg-blue-500/10 border border-blue-500/20 text-blue-300" : "bg-blue-50 border border-blue-200 text-blue-700"
                      }`}
                    >
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">{w.title}</div>
                        <div className="opacity-80">{w.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ═══ [LP-13] Impermanent Loss Estimation ═══ */}
            {currentPrice > 0 && priceLower > 0 && priceUpper > 0 && !isFullRangeActive && (
              <div className={`rounded-lg p-3 text-xs ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}>
                <div className={`font-bold mb-2 flex items-center gap-1.5 ${labelClass}`}>
                  <Info className="w-3 h-3" />
                  Estimated Impermanent Loss
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {IL_SCENARIOS.map((scenario) => {
                    const rangeWidthPct = ((priceUpper - priceLower) / currentPrice);
                    const il = estimateImpermanentLoss(scenario.move, rangeWidthPct);
                    return (
                      <div key={scenario.label} className={`text-center p-2 rounded ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                        <div className={labelClass}>Price {scenario.label}</div>
                        <div className={`font-bold font-mono ${il > 5 ? "text-red-400" : il > 1 ? "text-amber-400" : "text-emerald-400"}`}>
                          {il > 0.01 ? `-${il.toFixed(2)}%` : "~0%"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══ [LP-13] Gas Cost Estimation ═══ */}
            <div className={`flex items-center justify-between text-xs ${labelClass}`}>
              <span className="flex items-center gap-1">
                <Fuel className="w-3 h-3" />
                Est. Gas Cost
              </span>
              <span className="font-mono">{formatGasCost(V2_GAS_LIMITS.MINT)} (900K gas)</span>
            </div>

            {/* ═══ [LP-14] Token Association Guard ═══ */}
            {accountId && (
              <V2TokenAssociationGuard
                operation="mint"
                tokens={[
                  ...(isToken0Hbar ? [] : [{ tokenId: pool.tokenA.htsId, symbol: displaySymbol0, logo: token0.logo }]),
                  ...(isToken1Hbar ? [] : [{ tokenId: pool.tokenB.htsId, symbol: displaySymbol1, logo: token1.logo }]),
                ]}
                includeNFT
                onGuardResult={setGuardResult}
                compact
              />
            )}

            {/* Summary */}
            {mintResult && (
              <div className={`rounded-lg p-3 space-y-1.5 text-xs ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                <div className="flex justify-between">
                  <span className={labelClass}>Estimated {displaySymbol0}</span>
                  <span className="font-mono">{(Number(mintResult.amount0) / Math.pow(10, decimals0)).toFixed(6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className={labelClass}>Estimated {displaySymbol1}</span>
                  <span className="font-mono">{(Number(mintResult.amount1) / Math.pow(10, decimals1)).toFixed(6)}</span>
                </div>
                {mintFee && (
                  <div className="flex justify-between">
                    <span className={labelClass}>Mint Fee</span>
                    <span className="font-mono">{mintFee.hbarAmount.toFixed(4)} HBAR</span>
                  </div>
                )}
                {/* [LP-12] Total HBAR payable for HBAR pools */}
                {poolInvolvesHbar && mintFee && (
                  <div className={`flex justify-between font-bold pt-1 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <span className={labelClass}>Total HBAR to Send</span>
                    <span className="font-mono">
                      {(
                        mintFee.hbarAmount +
                        (isToken0Hbar
                          ? Number(mintResult.amount0) / 1e8
                          : Number(mintResult.amount1) / 1e8)
                      ).toFixed(4)} HBAR
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className={labelClass}>Price Range</span>
                  {isFullRangeActive ? (
                    <span className="font-mono flex items-center gap-1">
                      <span className="text-cyan-400">0</span>
                      <span className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>—</span>
                      <span className="text-purple-400">∞</span>
                      <span className={`text-[9px] ml-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>(Full)</span>
                    </span>
                  ) : (
                    <span className="font-mono">{formatPrice(priceLower)} — {formatPrice(priceUpper)}</span>
                  )}
                </div>
                {/* [LP-UX-03] Total deposit value in USD */}
                {totalDepositUsd > 0 && (
                  <div className={`flex justify-between font-bold pt-1.5 mt-1 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                    <span className={isDark ? "text-slate-300" : "text-gray-700"}>Total Deposit</span>
                    <span className={`font-mono ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                      {formatUsd(totalDepositUsd)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* [LP-UX-03] HBAR shortfall warning — comprehensive check */}
            {hbarTotalShortfall > 0 && (
              <div className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${
                isDark ? "bg-red-500/10 border border-red-500/20 text-red-300" : "bg-red-50 border border-red-200 text-red-700"
              }`}>
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Insufficient HBAR for Full Transaction</div>
                  <div className="opacity-80">
                    Your deposit ({isToken0Hbar ? amount0Input : amount1Input} HBAR) plus mint fee ({mintFee?.hbarAmount.toFixed(4) || "0"} HBAR) plus gas reserve ({HBAR_GAS_RESERVE} HBAR) exceeds your balance.
                    You need {hbarTotalShortfall.toFixed(2)} more HBAR.
                  </div>
                </div>
              </div>
            )}

            {/* Validation Error */}
            {validationError && (
              <div className={`flex items-center gap-2 text-xs ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                <Info className="w-3.5 h-3.5 shrink-0" />
                {validationError}
              </div>
            )}

            {/* [LP-UX-03] Execute Button — contextual states */}
            {(() => {
              const isInsufficient = validationError?.includes("Insufficient") || hbarTotalShortfall > 0;
              const isDisabled = !!validationError || guardResult !== "ready";
              const ctaClass = isInsufficient && validationError
                ? isDark
                  ? "bg-red-500/10 border border-red-500/30 text-red-400 cursor-not-allowed"
                  : "bg-red-50 border border-red-200 text-red-600 cursor-not-allowed"
                : isDisabled
                ? isDark
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/20";
              const ctaText = validationError
                ? validationError
                : guardResult === "pending"
                ? "Checking token associations..."
                : guardResult === "blocked"
                ? "Associate tokens first"
                : totalDepositUsd > 0
                ? `Add Liquidity · ${formatUsd(totalDepositUsd)}`
                : "Add Liquidity";
              return (
                <button
                  onClick={handleExecute}
                  disabled={isDisabled}
                  className={`w-full py-4 sm:py-3.5 rounded-xl text-sm font-bold transition-all min-h-[52px] sm:min-h-0 ${ctaClass}`}
                >
                  {ctaText}
                </button>
              );
            })()}
          </div>
        )}

        {/* Confirming State — with live step progress */}
        {modalState === "confirming" && (
          <div className="p-8 text-center">
            <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-pink-400" />
            <div className="font-bold text-lg mb-1">Confirm in Wallet</div>
            <div className={`text-xs ${labelClass}`}>
              {mintStep
                ? `Step ${mintStep.step}/${mintStep.total}: ${mintStep.desc}`
                : "Preparing transaction..."}
            </div>
            {mintStep && mintStep.total > 1 && (
              <div className="mt-3 mx-auto max-w-[200px]">
                <div className="h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-500"
                    style={{ width: `${(mintStep.step / mintStep.total) * 100}%` }}
                  />
                </div>
                <div className={`text-[10px] mt-1 ${labelClass}`}>
                  {mintStep.step < mintStep.total ? "Approve in HashPack..." : "Minting position..."}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Success State */}
        {modalState === "success" && (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-400" />
            <div className="font-bold text-lg mb-1">Position Created!</div>
            <div className={`text-xs mb-4 ${labelClass}`}>
              Your V2 liquidity position has been minted successfully.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { onSuccess?.(); onClose(); }}
                className="flex-1 py-3 sm:py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 text-white rounded-lg text-sm font-bold min-h-[48px] sm:min-h-0"
              >
                Done
              </button>
              {txId && (
                <a
                  href={`https://hashscan.io/${hederaNetwork || "mainnet"}/transaction/${txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-1.5 px-4 py-3 sm:py-2.5 rounded-lg text-sm font-bold min-h-[48px] sm:min-h-0 ${isDark ? "bg-slate-800 text-slate-300" : "bg-gray-200 text-gray-700"}`}
                >
                  HashScan <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Error State */}
        {modalState === "error" && (
          <div className="p-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <div className="font-bold text-lg mb-1">Transaction Failed</div>
            <div className={`text-xs mb-4 ${isDark ? "text-red-300" : "text-red-600"}`}>
              {errorMsg}
            </div>
            <button
              onClick={() => setModalState("idle")}
              className="px-6 py-3 sm:py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 text-white rounded-lg text-sm font-bold min-h-[48px] sm:min-h-0"
            >
              Try Again
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
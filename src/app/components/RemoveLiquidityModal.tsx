/**
 * RemoveLiquidityModal — Atomic Pool Liquidity Withdrawal
 *
 * Full-featured modal for removing liquidity from WRAPpDEX atomic pools.
 * Reads the user's LP token balance from Mirror Node, previews output
 * amounts via constant-product burn math, handles token associations,
 * and executes the atomic CryptoTransfer (3-leg: user->pool LP tokens,
 * pool->user tokenA, pool->user tokenB).
 *
 * SENIOR DEV NOTE [C6-01]:
 *   Removal mirrors addition — same atomic settlement layer, same
 *   server co-sign validation. The key difference is that the server
 *   validates the burn math (shares * reserveX / totalSupply) matches
 *   its own independent computation from Mirror Node. Slippage
 *   protection is client-enforced via minAmountARaw / minAmountBRaw.
 *
 * SENIOR DEV NOTE [C6-02]:
 *   LP share amounts are in raw integer units (typically 8 decimals
 *   for HTS). The percentage slider maps [0, 100] -> [0, userBalance]
 *   in raw units. We always floor the result to prevent rounding errors
 *   from exceeding the user's actual balance.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  X,
  Droplets,
  Minus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Shield,
  Info,
  ArrowDown,
  RefreshCw,
  Percent,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useWallet } from "../contexts/WalletContext";
import { authenticate, hasValidSession } from "../utils/auth";
import {
  playVipButtonChime,
  playVipCashRegister,
  playVipConfirm,
} from "../utils/sounds";
import {
  removeLiquidity,
  fetchUserLPPosition,
  type LPPosition,
} from "../utils/atomic-swap-client";
import {
  TOKEN_BY_SYMBOL,
  POOL_REGISTRY,
  POOL_BY_ID,
  fetchPoolReserves,
  fetchOraclePrices,
  bigIntToDecimal,
  computeLPSharesBurn,
} from "../utils/atomic-swap-engine";
import type { PoolReserves } from "../utils/atomic-swap-types";
import { TokenAssociationCheck, type AssociationStatus } from "./TokenAssociationCheck";
import { displaySymbol } from "../utils/display-symbol";

// ── Token Logo Map ──────────────────────────────────────────────────

const TOKEN_LOGOS: Record<string, string> = {
  HBAR:  "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  WHBAR: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  USDC:  "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  USDT:  "https://assets.coingecko.com/coins/images/325/large/Tether.png",
  DAI:   "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
  WBTC:  "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  WETH:  "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  LINK:  "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  AAVE:  "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png",
  WBNB:  "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
  WAVAX: "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
};

function getTokenLogo(symbol: string): string {
  return TOKEN_LOGOS[symbol] || TOKEN_LOGOS[displaySymbol(symbol)] || "";
}

// [C66] displaySymbol() centralized — canonical copy in ../utils/display-symbol.ts

// ── Formatters ──────────────────────────────────────────────────────

function formatCompact(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

function formatUsd(n: number): string {
  return `$${formatCompact(n)}`;
}

// ── Preset Percentages ──────────────────────────────────────────────

const PRESETS = [25, 50, 75, 100] as const;

// ── Props ───────────────────────────────────────────────────────────

interface RemoveLiquidityModalProps {
  isDark: boolean;
  /** Pre-select a specific pool by ID (e.g., "ap-usdc-whbar") */
  initialPoolId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

// ── Status Types ────────────────────────────────────────────────────

type ModalStep = "input" | "executing" | "success" | "error";

// ── Main Component ──────────────────────────────────────────────────

export function RemoveLiquidityModal({
  isDark,
  initialPoolId,
  onClose,
  onSuccess,
}: RemoveLiquidityModalProps) {
  const { hashPackSession } = useWallet();
  const accountId = hashPackSession?.accountId || null;

  // ── Pool selection ──
  const availablePools = useMemo(() => POOL_REGISTRY, []);
  const [selectedPoolId, setSelectedPoolId] = useState<string>(
    initialPoolId || availablePools[0]?.poolId || "",
  );

  const pool = useMemo(
    () => POOL_BY_ID.get(selectedPoolId) || null,
    [selectedPoolId],
  );

  const tokenA = useMemo(
    () => (pool ? TOKEN_BY_SYMBOL.get(pool.tokenA) : null),
    [pool],
  );
  const tokenB = useMemo(
    () => (pool ? TOKEN_BY_SYMBOL.get(pool.tokenB) : null),
    [pool],
  );

  // ── LP Position ──
  const [lpPosition, setLpPosition] = useState<LPPosition | null>(null);
  const [loadingPosition, setLoadingPosition] = useState(false);

  // ── Share input (percentage 0–100) ──
  const [percentage, setPercentage] = useState<number>(0);
  const [customInput, setCustomInput] = useState("");

  // ── Pool data ──
  const [reserves, setReserves] = useState<PoolReserves | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loadingReserves, setLoadingReserves] = useState(false);

  // ── Association status ──
  const [assocStatusA, setAssocStatusA] = useState<AssociationStatus>("unknown");
  const [assocStatusB, setAssocStatusB] = useState<AssociationStatus>("unknown");

  // ── Execution state ──
  const [step, setStep] = useState<ModalStep>("input");
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [resultAmountA, setResultAmountA] = useState<string | null>(null);
  const [resultAmountB, setResultAmountB] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch LP position + reserves when pool changes ────────────────
  useEffect(() => {
    if (!pool) return;

    let cancelled = false;
    setLoadingReserves(true);
    setLoadingPosition(true);
    setReserves(null);
    setLpPosition(null);
    setPercentage(0);
    setCustomInput("");

    (async () => {
      try {
        const [r, p] = await Promise.all([
          fetchPoolReserves(pool),
          fetchOraclePrices(),
        ]);
        if (cancelled) return;
        setReserves(r);
        setPrices(p);
      } catch { /* non-critical */ }
      if (!cancelled) setLoadingReserves(false);

      // Fetch user LP position
      if (accountId && pool.lpTokenId !== "PENDING" && pool.accountId !== "PENDING") {
        try {
          const pos = await fetchUserLPPosition(accountId, pool.poolId);
          if (!cancelled) setLpPosition(pos);
        } catch { /* non-critical */ }
      }
      if (!cancelled) setLoadingPosition(false);
    })();

    return () => { cancelled = true; };
  }, [pool, accountId]);

  // ── Derived: shares to burn (from percentage) ─────────────────────
  const sharesToBurn = useMemo(() => {
    if (!lpPosition || lpPosition.lpBalanceRaw === "0" || percentage === 0) return 0n;
    const balance = BigInt(lpPosition.lpBalanceRaw);
    if (percentage >= 100) return balance;
    // Floor to prevent rounding above balance
    return balance * BigInt(Math.floor(percentage * 100)) / 10000n;
  }, [lpPosition, percentage]);

  // ── Derived: output preview ───────────────────────────────────────
  const outputPreview = useMemo(() => {
    if (!reserves || !tokenA || !tokenB || sharesToBurn === 0n) {
      return { amountA: 0n, amountB: 0n, displayA: "0", displayB: "0", usdA: 0, usdB: 0 };
    }
    const { amountA, amountB } = computeLPSharesBurn(
      sharesToBurn,
      reserves.reserveA, reserves.reserveB,
      reserves.lpTotalSupply,
    );
    const displayA = bigIntToDecimal(amountA, tokenA.decimals);
    const displayB = bigIntToDecimal(amountB, tokenB.decimals);
    const pA = prices[tokenA.tokenId] || tokenA.fallbackPriceUsd;
    const pB = prices[tokenB.tokenId] || tokenB.fallbackPriceUsd;
    return {
      amountA, amountB,
      displayA, displayB,
      usdA: parseFloat(displayA) * pA,
      usdB: parseFloat(displayB) * pB,
    };
  }, [sharesToBurn, reserves, tokenA, tokenB, prices]);

  // ── User's total position value ───────────────────────────────────
  const positionValueUsd = useMemo(() => {
    if (!lpPosition || !tokenA || !tokenB || !prices) return 0;
    const pA = prices[tokenA.tokenId] || tokenA.fallbackPriceUsd;
    const pB = prices[tokenB.tokenId] || tokenB.fallbackPriceUsd;
    return parseFloat(lpPosition.estimatedAmountA) * pA + parseFloat(lpPosition.estimatedAmountB) * pB;
  }, [lpPosition, tokenA, tokenB, prices]);

  // ── Validation ─────────────────────────────────────────────────────
  const canExecute = useMemo(() => {
    if (!accountId || !pool || !tokenA || !tokenB) return false;
    if (pool.accountId === "PENDING") return false;
    if (step !== "input") return false;
    if (sharesToBurn === 0n) return false;
    if (outputPreview.amountA <= 0n || outputPreview.amountB <= 0n) return false;
    // Block if output tokens not associated
    if (assocStatusA === "needed" || assocStatusB === "needed") return false;
    if (assocStatusA === "associating" || assocStatusB === "associating") return false;
    return true;
  }, [accountId, pool, tokenA, tokenB, step, sharesToBurn, outputPreview, assocStatusA, assocStatusB]);

  const isPoolPending = pool?.accountId === "PENDING";
  const hasPosition = lpPosition && lpPosition.lpBalanceRaw !== "0";

  // ── Handle percentage presets ──────────────────────────────────────
  const handlePreset = useCallback((pct: number) => {
    setPercentage(pct);
    setCustomInput(pct === 100 ? "MAX" : `${pct}`);
    playVipButtonChime();
  }, []);

  // ── Handle slider change ──────────────────────────────────────────
  const handleSlider = useCallback((value: number) => {
    setPercentage(value);
    setCustomInput(value === 100 ? "MAX" : value > 0 ? `${value}` : "");
  }, []);

  // ── Handle custom input ───────────────────────────────────────────
  const handleCustomInput = useCallback((val: string) => {
    if (val.toUpperCase() === "MAX") {
      setPercentage(100);
      setCustomInput("MAX");
      return;
    }
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) {
      setPercentage(0);
      setCustomInput(val);
      return;
    }
    setPercentage(Math.min(num, 100));
    setCustomInput(val);
  }, []);

  // ── Execute Remove Liquidity ──────────────────────────────────────
  const handleExecute = useCallback(async () => {
    if (!canExecute || !accountId || !pool || !tokenA || !tokenB) return;

    setStep("executing");
    setExecutionError(null);
    playVipCashRegister();

    try {
      if (!hasValidSession(accountId)) {
        await authenticate(accountId);
      }

      // Apply 0.5% slippage on minimum amounts
      const minA = (outputPreview.amountA * 995n / 1000n).toString();
      const minB = (outputPreview.amountB * 995n / 1000n).toString();

      const result = await removeLiquidity({
        userAccountId: accountId,
        poolId: pool.poolId,
        sharesRaw: sharesToBurn.toString(),
        minAmountARaw: minA,
        minAmountBRaw: minB,
      });

      if (!mountedRef.current) return;

      if (result.success) {
        setStep("success");
        setTxHash(result.transactionId || null);
        setResultAmountA(result.amountAOutRaw ? bigIntToDecimal(BigInt(result.amountAOutRaw), tokenA.decimals) : outputPreview.displayA);
        setResultAmountB(result.amountBOutRaw ? bigIntToDecimal(BigInt(result.amountBOutRaw), tokenB.decimals) : outputPreview.displayB);
        playVipConfirm();
        toast.success("Liquidity removed successfully");
        onSuccess?.();
      } else {
        setStep("error");
        setExecutionError(result.error || "Remove liquidity failed");
        toast.error(result.error || "Remove liquidity failed");
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setStep("error");
      const msg = err?.message || "Unexpected error";
      setExecutionError(msg);
      toast.error(msg);
    }
  }, [canExecute, accountId, pool, tokenA, tokenB, sharesToBurn, outputPreview, onSuccess]);

  // ── Refresh ────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    if (!pool) return;
    setLoadingReserves(true);
    setLoadingPosition(true);
    try {
      const [r, pos] = await Promise.all([
        fetchPoolReserves(pool),
        accountId ? fetchUserLPPosition(accountId, pool.poolId) : null,
      ]);
      if (mountedRef.current) {
        setReserves(r);
        if (pos !== undefined) setLpPosition(pos);
      }
    } catch { /* non-critical */ }
    if (mountedRef.current) {
      setLoadingReserves(false);
      setLoadingPosition(false);
    }
  }, [pool, accountId]);

  // ── Reset ─────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStep("input");
    setExecutionError(null);
    setPercentage(0);
    setCustomInput("");
    handleRefresh();
  }, [handleRefresh]);

  // ── Style helpers ──────────────────────────────────────────────────
  const cardClass = isDark
    ? "bg-[#12121a] border border-pink-500/30"
    : "bg-white border border-gray-200 shadow-2xl";

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className={`relative w-full max-w-md rounded-2xl overflow-hidden ${cardClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className={`px-5 py-4 border-b ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center shadow-lg">
                <Minus className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h2 className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Remove Liquidity
                </h2>
                <p className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Withdraw tokens from pool
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                isDark ? "hover:bg-slate-800 text-slate-500 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <AnimatePresence mode="wait">
            {/* ──────────── Input Step ──────────── */}
            {step === "input" && (
              <motion.div
                key="input"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-3"
              >
                {/* Pool Selector */}
                <div>
                  <label className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 block ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Select Pool
                  </label>
                  <div className={`rounded-xl transition-all ${isDark ? "bg-slate-800/60 border border-pink-500/10" : "bg-gray-50 border border-gray-200"}`}>
                    <select
                      value={selectedPoolId}
                      onChange={(e) => { setSelectedPoolId(e.target.value); playVipButtonChime(); }}
                      className={`w-full px-3 py-2.5 rounded-xl text-sm font-bold outline-none cursor-pointer bg-transparent ${isDark ? "text-white" : "text-gray-900"}`}
                    >
                      {availablePools.map((p) => (
                        <option key={p.poolId} value={p.poolId}>
                          {displaySymbol(p.tokenA)}/{displaySymbol(p.tokenB)}
                          {p.accountId === "PENDING" ? " (Coming Soon)" : p.status === "paused" ? " (Paused)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Pool Pending Notice */}
                {isPoolPending && (
                  <div className={`rounded-xl p-3 flex items-start gap-2.5 ${isDark ? "bg-slate-800/40 border border-slate-700/30" : "bg-blue-50 border border-blue-100"}`}>
                    <Info className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? "text-blue-400/60" : "text-blue-400"}`} />
                    <p className={`text-xs ${isDark ? "text-blue-400/80" : "text-blue-500"}`}>
                      Pool not yet deployed. Withdrawals will be available after launch.
                    </p>
                  </div>
                )}

                {/* LP Position Card */}
                {pool && !isPoolPending && tokenA && tokenB && (
                  <>
                    {loadingPosition ? (
                      <div className="flex items-center justify-center gap-2 py-4">
                        <Loader2 className={`w-4 h-4 animate-spin ${isDark ? "text-pink-400" : "text-pink-500"}`} />
                        <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading position...</span>
                      </div>
                    ) : !accountId ? (
                      <div className={`rounded-xl p-4 text-center ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-100"}`}>
                        <Shield className={`w-6 h-6 mx-auto mb-2 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                        <p className={`text-xs font-semibold mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Connect Wallet</p>
                        <p className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                          Connect your wallet to view your LP positions
                        </p>
                      </div>
                    ) : !hasPosition ? (
                      <div className={`rounded-xl p-4 text-center ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-100"}`}>
                        <Droplets className={`w-6 h-6 mx-auto mb-2 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                        <p className={`text-xs font-semibold mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>No Position</p>
                        <p className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                          You don't hold LP tokens for this pool
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Position Summary */}
                        <div className={`rounded-xl p-3 ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-100"}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              Your Position
                            </span>
                            <span className={`text-xs font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                              {formatUsd(positionValueUsd)}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <div className="flex items-center gap-1 mb-0.5">
                                <img src={getTokenLogo(pool.tokenA)} alt={pool.tokenA} className="w-3.5 h-3.5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                <span className={isDark ? "text-slate-500" : "text-gray-400"}>{displaySymbol(pool.tokenA)}</span>
                              </div>
                              <span className="font-bold font-mono">{parseFloat(lpPosition!.estimatedAmountA).toFixed(4)}</span>
                            </div>
                            <div>
                              <div className="flex items-center gap-1 mb-0.5">
                                <img src={getTokenLogo(pool.tokenB)} alt={pool.tokenB} className="w-3.5 h-3.5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                <span className={isDark ? "text-slate-500" : "text-gray-400"}>{displaySymbol(pool.tokenB)}</span>
                              </div>
                              <span className="font-bold font-mono">{parseFloat(lpPosition!.estimatedAmountB).toFixed(4)}</span>
                            </div>
                          </div>
                          <div className={`flex items-center justify-between mt-2 pt-2 border-t text-[10px] ${isDark ? "border-slate-700/30 text-slate-500" : "border-gray-200 text-gray-400"}`}>
                            <span>LP Tokens</span>
                            <span className="font-mono font-bold">{parseFloat(lpPosition!.lpBalanceDisplay).toFixed(6)}</span>
                          </div>
                          <div className={`flex items-center justify-between text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            <span>Pool Share</span>
                            <span className="font-mono font-bold">{lpPosition!.shareOfPool < 0.01 ? "<0.01" : lpPosition!.shareOfPool.toFixed(2)}%</span>
                          </div>
                        </div>

                        {/* Percentage Slider */}
                        <div className={`rounded-xl p-3 ${isDark ? "bg-slate-800/60 border border-pink-500/10" : "bg-gray-50 border border-gray-200"}`}>
                          <div className="flex items-center justify-between mb-3">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              Amount to Remove
                            </span>
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={customInput}
                                onChange={(e) => handleCustomInput(e.target.value)}
                                placeholder="0"
                                className={`w-14 text-right text-lg font-bold bg-transparent outline-none tabular-nums ${isDark ? "text-white placeholder:text-slate-600" : "text-gray-900 placeholder:text-gray-300"}`}
                              />
                              <Percent className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                            </div>
                          </div>

                          {/* Slider Track */}
                          <div className="relative mb-3">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={percentage}
                              onChange={(e) => handleSlider(Number(e.target.value))}
                              className="w-full h-2 rounded-full appearance-none cursor-pointer"
                              style={{
                                background: isDark
                                  ? `linear-gradient(to right, #f43f5e ${percentage}%, #1e293b ${percentage}%)`
                                  : `linear-gradient(to right, #f43f5e ${percentage}%, #e5e7eb ${percentage}%)`,
                              }}
                            />
                          </div>

                          {/* Preset Buttons */}
                          <div className="flex gap-1.5">
                            {PRESETS.map((pct) => (
                              <button
                                key={pct}
                                onClick={() => handlePreset(pct)}
                                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                  percentage === pct
                                    ? isDark
                                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                      : "bg-rose-50 text-rose-600 border border-rose-200"
                                    : isDark
                                    ? "bg-slate-700/30 text-slate-400 border border-slate-700/30 hover:border-rose-500/20"
                                    : "bg-gray-100 text-gray-500 border border-gray-200 hover:border-rose-200"
                                }`}
                              >
                                {pct === 100 ? "MAX" : `${pct}%`}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Output Preview */}
                        {sharesToBurn > 0n && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="overflow-hidden"
                          >
                            {/* Arrow separator */}
                            <div className="flex justify-center -mb-0.5 relative z-10">
                              <div className={`p-1.5 rounded-full border-2 ${
                                isDark
                                  ? "bg-[#12121a] border-rose-500/30 text-rose-400"
                                  : "bg-white border-gray-200 text-rose-500 shadow-sm"
                              }`}>
                                <ArrowDown className="w-3 h-3" />
                              </div>
                            </div>

                            <div className={`rounded-xl p-3 text-xs space-y-2 ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-100"}`}>
                              <div className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                                You Will Receive
                              </div>

                              {/* Token A output */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <img src={getTokenLogo(pool.tokenA)} alt={pool.tokenA} className="w-5 h-5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                  <span className="font-bold">{displaySymbol(pool.tokenA)}</span>
                                </div>
                                <div className="text-right">
                                  <span className="font-mono font-bold text-emerald-400">
                                    {parseFloat(outputPreview.displayA).toFixed(parseFloat(outputPreview.displayA) >= 1 ? 4 : 8)}
                                  </span>
                                  <div className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                                    ~{formatUsd(outputPreview.usdA)}
                                  </div>
                                </div>
                              </div>

                              {/* Token B output */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <img src={getTokenLogo(pool.tokenB)} alt={pool.tokenB} className="w-5 h-5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                  <span className="font-bold">{displaySymbol(pool.tokenB)}</span>
                                </div>
                                <div className="text-right">
                                  <span className="font-mono font-bold text-emerald-400">
                                    {parseFloat(outputPreview.displayB).toFixed(parseFloat(outputPreview.displayB) >= 1 ? 4 : 8)}
                                  </span>
                                  <div className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                                    ~{formatUsd(outputPreview.usdB)}
                                  </div>
                                </div>
                              </div>

                              <div className={`border-t pt-1.5 ${isDark ? "border-slate-700/30" : "border-gray-200"}`}>
                                <div className="flex items-center justify-between">
                                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>LP Burned</span>
                                  <span className="font-mono">
                                    {parseFloat(bigIntToDecimal(sharesToBurn, pool.lpDecimals)).toFixed(6)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>Total Value</span>
                                  <span className="font-mono font-bold text-emerald-400">
                                    {formatUsd(outputPreview.usdA + outputPreview.usdB)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className={isDark ? "text-slate-500" : "text-gray-400"}>Slippage</span>
                                  <span className="font-mono">0.5%</span>
                                </div>
                              </div>

                              {/* Refresh */}
                              <div className="flex justify-end pt-0.5">
                                <button
                                  onClick={handleRefresh}
                                  disabled={loadingReserves}
                                  className={`flex items-center gap-1 text-[10px] cursor-pointer ${isDark ? "text-slate-600 hover:text-slate-400" : "text-gray-400 hover:text-gray-600"}`}
                                >
                                  <RefreshCw className={`w-2.5 h-2.5 ${loadingReserves ? "animate-spin" : ""}`} />
                                  {loadingReserves ? "Refreshing..." : "Refresh"}
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}

                        {/* Token Association Checks */}
                        {accountId && (
                          <div className="space-y-2">
                            <TokenAssociationCheck
                              accountId={accountId}
                              tokenId={tokenA.tokenId}
                              tokenSymbol={displaySymbol(pool.tokenA)}
                              tokenLogo={getTokenLogo(pool.tokenA)}
                              isDark={isDark}
                              onStatusChange={setAssocStatusA}
                              compact
                            />
                            <TokenAssociationCheck
                              accountId={accountId}
                              tokenId={tokenB.tokenId}
                              tokenSymbol={displaySymbol(pool.tokenB)}
                              tokenLogo={getTokenLogo(pool.tokenB)}
                              isDark={isDark}
                              onStatusChange={setAssocStatusB}
                              compact
                            />
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {/* ──────────── Executing Step ──────────── */}
            {step === "executing" && (
              <motion.div
                key="executing"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-10"
              >
                <motion.div
                  animate={{
                    boxShadow: [
                      "0 0 0px rgba(244,63,94,0)",
                      "0 0 30px rgba(244,63,94,0.4)",
                      "0 0 0px rgba(244,63,94,0)",
                    ],
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center mb-5"
                >
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </motion.div>
                <h3 className={`text-sm font-bold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Removing Liquidity...
                </h3>
                <p className={`text-xs text-center max-w-[240px] ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  Authenticating, building transaction, and waiting for wallet confirmation.
                </p>
              </motion.div>
            )}

            {/* ──────────── Success Step ──────────── */}
            {step === "success" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-8"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", damping: 10, stiffness: 200, delay: 0.1 }}
                  className="w-16 h-16 rounded-2xl bg-emerald-500 flex items-center justify-center mb-5 shadow-[0_0_30px_rgba(34,197,94,0.3)]"
                >
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </motion.div>
                <h3 className={`text-sm font-bold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Liquidity Removed
                </h3>
                {resultAmountA && resultAmountB && pool && (
                  <p className={`text-xs mb-4 text-center ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                    +{parseFloat(resultAmountA).toFixed(4)} {displaySymbol(pool.tokenA)} &middot; +{parseFloat(resultAmountB).toFixed(4)} {displaySymbol(pool.tokenB)}
                  </p>
                )}
                {txHash && (
                  <a
                    href={`https://hashscan.io/mainnet/transaction/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors mb-4 ${
                      isDark
                        ? "text-slate-400 bg-slate-800/60 hover:bg-slate-800 hover:text-white"
                        : "text-gray-500 bg-gray-100 hover:bg-gray-200 hover:text-gray-900"
                    }`}
                  >
                    <ExternalLink className="w-3 h-3" />
                    View on HashScan
                  </a>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleReset}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                      isDark
                        ? "text-slate-400 bg-slate-800/60 hover:bg-slate-800"
                        : "text-gray-500 bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    Remove More
                  </button>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-rose-500 to-orange-500 cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </motion.div>
            )}

            {/* ──────────── Error Step ──────────── */}
            {step === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-8"
              >
                <div className="w-16 h-16 rounded-2xl bg-red-500/20 flex items-center justify-center mb-5 border border-red-500/30">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <h3 className={`text-sm font-bold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Withdrawal Failed
                </h3>
                {executionError && (
                  <p className={`text-xs text-center max-w-[260px] mb-4 ${isDark ? "text-red-400/70" : "text-red-500/70"}`}>
                    {executionError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleReset}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                      isDark
                        ? "text-slate-400 bg-slate-800/60 hover:bg-slate-800"
                        : "text-gray-500 bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    Try Again
                  </button>
                  <button
                    onClick={onClose}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                      isDark
                        ? "text-slate-400 bg-slate-800/60 hover:bg-slate-800"
                        : "text-gray-500 bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Footer / Execute Button ────────────────────────────── */}
        {step === "input" && pool && !isPoolPending && hasPosition && (
          <div className="px-5 pb-5 pt-1">
            <motion.button
              onClick={handleExecute}
              disabled={!canExecute}
              whileTap={canExecute ? { scale: 0.97 } : undefined}
              className={`w-full py-3 rounded-xl font-bold text-white text-sm transition-all relative overflow-hidden cursor-pointer ${
                !canExecute
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-gradient-to-r from-rose-500 via-orange-500 to-rose-500 bg-[length:200%_100%] hover:shadow-[0_0_30px_rgba(244,63,94,0.4)]"
              }`}
              animate={
                canExecute
                  ? { backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }
                  : undefined
              }
              transition={canExecute ? { duration: 3, repeat: Infinity, ease: "linear" } : undefined}
            >
              {/* Shimmer */}
              {canExecute && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
                />
              )}

              <span className="relative z-10 flex items-center justify-center gap-2">
                {!accountId ? (
                  <>
                    <Shield className="w-4 h-4" />
                    Connect Wallet
                  </>
                ) : assocStatusA === "needed" || assocStatusB === "needed" ? (
                  <>
                    <Shield className="w-4 h-4" />
                    Associate Tokens First
                  </>
                ) : sharesToBurn === 0n ? (
                  "Select Amount"
                ) : (
                  <>
                    <Minus className="w-4 h-4" />
                    Remove {percentage}% Liquidity
                  </>
                )}
              </span>
            </motion.button>

            {/* Auth status */}
            {accountId && (
              <div className={`text-center mt-2 text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                {hasValidSession(accountId) ? (
                  <span className="flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Session active
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-1">
                    <Shield className="w-2.5 h-2.5" />
                    Will authenticate on withdrawal
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
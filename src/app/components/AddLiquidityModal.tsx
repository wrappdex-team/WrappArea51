/**
 * AddLiquidityModal — Atomic Pool Liquidity Provision
 *
 * Full-featured modal for adding liquidity to WRAPpDEX atomic pools.
 * Reads reserves from Mirror Node, computes proportional deposits
 * via constant-product math, handles token associations, and executes
 * the atomic CryptoTransfer (3-leg: user→pool tokenA, user→pool tokenB,
 * pool→user LP tokens).
 *
 * SENIOR DEV NOTE [C5-01]:
 *   This modal interacts with the same atomic settlement layer as
 *   TradingSwapPanel. The server co-signs the liquidity transaction
 *   after validating LP share math matches its own computation.
 *   All reserves are read from Mirror Node (on-chain ground truth).
 *
 * SENIOR DEV NOTE [C5-02]:
 *   LP share calculation uses min(amountA/reserveA, amountB/reserveB)
 *   to prevent donation attacks. The "optimal deposit" helper ensures
 *   both token amounts are proportional to current reserves, so users
 *   don't lose value to the min() truncation. First deposits use
 *   sqrt(A * B) - MINIMUM_LIQUIDITY (Uniswap V2 pattern).
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  X,
  Droplets,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Shield,
  Info,
  ArrowRight,
  RefreshCw,
  Coins,
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
  addLiquidity,
} from "../utils/atomic-swap-client";
import {
  TOKEN_BY_SYMBOL,
  POOL_REGISTRY,
  POOL_BY_ID,
  fetchPoolReserves,
  fetchOraclePrices,
  bigIntToDecimal,
  decimalToBigInt,
  computeLPSharesMint,
} from "../utils/atomic-swap-engine";
import type { PoolReserves } from "../utils/atomic-swap-types";
import { TokenAssociationCheck, type AssociationStatus } from "./TokenAssociationCheck";
import { displaySymbol } from "../utils/display-symbol";

// ── Token Logo Map (CoinGecko URLs matching smart-liquidity.ts) ─────

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

// ── Props ───────────────────────────────────────────────────────────

interface AddLiquidityModalProps {
  isDark: boolean;
  /** Pre-select a specific pool by ID (e.g., "ap-usdc-whbar") */
  initialPoolId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

// ── Status Types ────────────────────────────────────────────────────

type ModalStep = "input" | "executing" | "success" | "error";

// ── Main Component ──────────────────────────────────────────────────

export function AddLiquidityModal({
  isDark,
  initialPoolId,
  onClose,
  onSuccess,
}: AddLiquidityModalProps) {
  const { hashPackSession } = useWallet();
  const accountId = hashPackSession?.accountId || null;

  // ── Pool selection ──
  const availablePools = useMemo(() => POOL_REGISTRY, []);
  const [selectedPoolId, setSelectedPoolId] = useState<string>(
    initialPoolId || availablePools[0]?.poolId || ""
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

  // ── Inputs ──
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [activeInput, setActiveInput] = useState<"A" | "B">("A");

  // ── Pool data ──
  const [reserves, setReserves] = useState<PoolReserves | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loadingReserves, setLoadingReserves] = useState(false);

  // ── LP share preview ──
  const [lpSharesPreview, setLpSharesPreview] = useState<string>("0");
  const [shareOfPool, setShareOfPool] = useState<number>(0);
  const [isFirstDeposit, setIsFirstDeposit] = useState(false);

  // ── Association status ──
  const [assocStatusA, setAssocStatusA] = useState<AssociationStatus>("unknown");
  const [assocStatusB, setAssocStatusB] = useState<AssociationStatus>("unknown");
  const [assocStatusLP, setAssocStatusLP] = useState<AssociationStatus>("unknown");

  // ── Execution state ──
  const [step, setStep] = useState<ModalStep>("input");
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sharesMinted, setSharesMinted] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch reserves + prices when pool changes ──────────────────
  useEffect(() => {
    if (!pool) return;

    let cancelled = false;
    setLoadingReserves(true);
    setReserves(null);
    setAmountA("");
    setAmountB("");
    setLpSharesPreview("0");
    setShareOfPool(0);

    (async () => {
      try {
        const [r, p] = await Promise.all([
          fetchPoolReserves(pool),
          fetchOraclePrices(),
        ]);
        if (cancelled) return;
        setReserves(r);
        setPrices(p);
      } catch {
        // Non-critical — UI will show "unable to load"
      }
      if (!cancelled) setLoadingReserves(false);
    })();

    return () => { cancelled = true; };
  }, [pool]);

  // ── Compute optimal counterpart when user types ────────────────
  useEffect(() => {
    if (!pool || !reserves || !tokenA || !tokenB) return;
    if (!reserves.isLive && reserves.reserveA > 0n) return;

    const isEmptyPool = reserves.reserveA === 0n && reserves.reserveB === 0n;

    if (activeInput === "A" && amountA) {
      const parsedA = parseFloat(amountA);
      if (isNaN(parsedA) || parsedA <= 0) {
        setAmountB("");
        setLpSharesPreview("0");
        setShareOfPool(0);
        return;
      }

      if (isEmptyPool) {
        // First deposit — both amounts are free-form
        // LP shares = sqrt(A * B) - 1000
        if (amountB) {
          const rawA = decimalToBigInt(amountA, tokenA.decimals);
          const rawB = decimalToBigInt(amountB, tokenB.decimals);
          const { shares, isFirstDeposit: first } = computeLPSharesMint(
            rawA, rawB, 0n, 0n, 0n,
          );
          setLpSharesPreview(bigIntToDecimal(shares, pool.lpDecimals));
          setIsFirstDeposit(first);
          setShareOfPool(100);
        }
        return;
      }

      // Non-empty pool: compute optimal B from A
      const rawA = decimalToBigInt(amountA, tokenA.decimals);
      const optimalB = rawA * reserves.reserveB / reserves.reserveA;
      const displayB = bigIntToDecimal(optimalB, tokenB.decimals);
      setAmountB(displayB);

      // Compute LP shares preview
      const { shares, isFirstDeposit: first } = computeLPSharesMint(
        rawA, optimalB,
        reserves.reserveA, reserves.reserveB,
        reserves.lpTotalSupply,
      );
      setLpSharesPreview(bigIntToDecimal(shares, pool.lpDecimals));
      setIsFirstDeposit(first);

      // Share of pool after deposit
      const newSupply = reserves.lpTotalSupply + shares;
      setShareOfPool(newSupply > 0n ? Number(shares * 10000n / newSupply) / 100 : 0);
    } else if (activeInput === "B" && amountB) {
      const parsedB = parseFloat(amountB);
      if (isNaN(parsedB) || parsedB <= 0) {
        setAmountA("");
        setLpSharesPreview("0");
        setShareOfPool(0);
        return;
      }

      if (isEmptyPool) {
        if (amountA) {
          const rawA = decimalToBigInt(amountA, tokenA.decimals);
          const rawB = decimalToBigInt(amountB, tokenB.decimals);
          const { shares, isFirstDeposit: first } = computeLPSharesMint(
            rawA, rawB, 0n, 0n, 0n,
          );
          setLpSharesPreview(bigIntToDecimal(shares, pool.lpDecimals));
          setIsFirstDeposit(first);
          setShareOfPool(100);
        }
        return;
      }

      const rawB = decimalToBigInt(amountB, tokenB.decimals);
      const optimalA = rawB * reserves.reserveA / reserves.reserveB;
      const displayA = bigIntToDecimal(optimalA, tokenA.decimals);
      setAmountA(displayA);

      const { shares, isFirstDeposit: first } = computeLPSharesMint(
        optimalA, rawB,
        reserves.reserveA, reserves.reserveB,
        reserves.lpTotalSupply,
      );
      setLpSharesPreview(bigIntToDecimal(shares, pool.lpDecimals));
      setIsFirstDeposit(first);

      const newSupply = reserves.lpTotalSupply + shares;
      setShareOfPool(newSupply > 0n ? Number(shares * 10000n / newSupply) / 100 : 0);
    }
  }, [amountA, amountB, activeInput, pool, reserves, tokenA, tokenB]);

  // ── TVL calculation ────────────────────────────────────────────
  const tvlUsd = useMemo(() => {
    if (!reserves || !tokenA || !tokenB || !prices) return 0;
    const pA = prices[tokenA.tokenId] || tokenA.fallbackPriceUsd;
    const pB = prices[tokenB.tokenId] || tokenB.fallbackPriceUsd;
    const displayA = Number(reserves.reserveA) / 10 ** tokenA.decimals;
    const displayB = Number(reserves.reserveB) / 10 ** tokenB.decimals;
    return displayA * pA + displayB * pB;
  }, [reserves, tokenA, tokenB, prices]);

  // ── Spot price ─────────────────────────────────────────────────
  const spotPrice = useMemo(() => {
    if (!reserves || !tokenA || !tokenB) return null;
    if (reserves.reserveA === 0n || reserves.reserveB === 0n) return null;
    const a = Number(reserves.reserveA) / 10 ** tokenA.decimals;
    const b = Number(reserves.reserveB) / 10 ** tokenB.decimals;
    return { aPerB: a / b, bPerA: b / a };
  }, [reserves, tokenA, tokenB]);

  // ── Validation ─────────────────────────────────────────────────
  const canExecute = useMemo(() => {
    if (!accountId || !pool || !tokenA || !tokenB) return false;
    if (pool.accountId === "PENDING") return false;
    if (pool.status !== "active") return false;
    if (step !== "input") return false;

    const parsedA = parseFloat(amountA);
    const parsedB = parseFloat(amountB);
    if (isNaN(parsedA) || parsedA <= 0 || isNaN(parsedB) || parsedB <= 0) return false;

    // Block if any required token is not associated
    if (assocStatusA === "needed" || assocStatusB === "needed" || assocStatusLP === "needed") return false;
    if (assocStatusA === "associating" || assocStatusB === "associating" || assocStatusLP === "associating") return false;

    return true;
  }, [accountId, pool, tokenA, tokenB, amountA, amountB, step, assocStatusA, assocStatusB, assocStatusLP]);

  const isPoolPending = pool?.accountId === "PENDING";
  const isPoolPaused = pool?.status === "paused" && !isPoolPending;

  // ── Execute Add Liquidity ──────────────────────────────────────
  const handleExecute = useCallback(async () => {
    if (!canExecute || !accountId || !pool || !tokenA || !tokenB) return;

    setStep("executing");
    setExecutionError(null);
    playVipCashRegister();

    try {
      // Ensure authenticated session
      if (!hasValidSession(accountId)) {
        await authenticate(accountId);
      }

      const amountARaw = decimalToBigInt(amountA, tokenA.decimals).toString();
      const amountBRaw = decimalToBigInt(amountB, tokenB.decimals).toString();

      const result = await addLiquidity({
        userAccountId: accountId,
        poolId: pool.poolId,
        amountARaw,
        amountBRaw,
        slippageBps: 50, // 0.5% slippage tolerance
      });

      if (!mountedRef.current) return;

      if (result.success) {
        setStep("success");
        setTxHash(result.transactionId || null);
        setSharesMinted(result.sharesMinted || null);
        playVipConfirm();
        toast.success("Liquidity added successfully");
        onSuccess?.();
      } else {
        setStep("error");
        setExecutionError(result.error || "Add liquidity failed");
        toast.error(result.error || "Add liquidity failed");
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setStep("error");
      const msg = err?.message || "Unexpected error";
      setExecutionError(msg);
      toast.error(msg);
    }
  }, [canExecute, accountId, pool, tokenA, tokenB, amountA, amountB, onSuccess]);

  // ── Refresh reserves ───────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    if (!pool) return;
    setLoadingReserves(true);
    try {
      const r = await fetchPoolReserves(pool);
      if (mountedRef.current) setReserves(r);
    } catch { /* non-critical */ }
    if (mountedRef.current) setLoadingReserves(false);
  }, [pool]);

  // ── Reset to input ─────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStep("input");
    setExecutionError(null);
    setAmountA("");
    setAmountB("");
    setLpSharesPreview("0");
    setShareOfPool(0);
    handleRefresh();
  }, [handleRefresh]);

  // ── Style helpers ─────────────────────────────────────────────
  const inputClass = isDark
    ? "bg-slate-800/60 border border-pink-500/10 focus-within:border-pink-500/40"
    : "bg-gray-50 border border-gray-200 focus-within:border-pink-300";

  const cardClass = isDark
    ? "bg-[#12121a] border border-pink-500/30"
    : "bg-white border border-gray-200 shadow-2xl";

  // ── Render ─────────────────────────────────────────────────────
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
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                <Droplets className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h2 className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Add Liquidity
                </h2>
                <p className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Deposit tokens to earn swap fees
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
                  <div className={`rounded-xl ${inputClass} transition-all`}>
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

                {/* Pool Status Badges */}
                {isPoolPending && (
                  <div className={`rounded-xl p-3 flex items-start gap-2.5 ${isDark ? "bg-slate-800/40 border border-slate-700/30" : "bg-blue-50 border border-blue-100"}`}>
                    <Info className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? "text-blue-400/60" : "text-blue-400"}`} />
                    <div>
                      <p className={`text-xs font-semibold ${isDark ? "text-blue-400/80" : "text-blue-500"}`}>Pool Not Yet Deployed</p>
                      <p className={`text-[10px] mt-0.5 leading-relaxed ${isDark ? "text-slate-500" : "text-blue-400/70"}`}>
                        This pool's Hedera account has not been created yet. Liquidity provision will be available after deployment.
                      </p>
                    </div>
                  </div>
                )}

                {isPoolPaused && (
                  <div className={`rounded-xl p-3 flex items-start gap-2.5 ${isDark ? "bg-amber-500/[0.06] border border-amber-500/15" : "bg-amber-50 border border-amber-200"}`}>
                    <AlertCircle className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? "text-amber-400/80" : "text-amber-500"}`} />
                    <p className={`text-xs ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>
                      This pool is currently paused. Deposits are temporarily disabled.
                    </p>
                  </div>
                )}

                {/* Token A Input */}
                {pool && tokenA && !isPoolPending && (
                  <>
                    <div className={`rounded-xl p-3 transition-all ${inputClass}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          {displaySymbol(pool.tokenA)} Deposit
                        </span>
                        <div className="flex items-center gap-1.5">
                          <img
                            src={getTokenLogo(pool.tokenA)}
                            alt={pool.tokenA}
                            className="w-4 h-4 rounded-full"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                          <span className={`text-xs font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                            {displaySymbol(pool.tokenA)}
                          </span>
                        </div>
                      </div>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={amountA}
                        onChange={(e) => {
                          setActiveInput("A");
                          setAmountA(e.target.value);
                        }}
                        onFocus={() => setActiveInput("A")}
                        className={`w-full bg-transparent outline-none text-xl font-bold tabular-nums ${isDark ? "text-white placeholder:text-slate-600" : "text-gray-900 placeholder:text-gray-300"}`}
                      />
                      {prices[tokenA.tokenId] && amountA && parseFloat(amountA) > 0 && (
                        <div className={`text-[10px] mt-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                          ~{formatUsd(parseFloat(amountA) * (prices[tokenA.tokenId] || 0))}
                        </div>
                      )}
                    </div>

                    {/* Plus Connector */}
                    <div className="flex justify-center -my-0.5 relative z-10">
                      <div className={`p-2 rounded-full border-2 ${
                        isDark
                          ? "bg-[#12121a] border-purple-500/30 text-purple-400"
                          : "bg-white border-gray-200 text-purple-500 shadow-sm"
                      }`}>
                        <Plus className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    {/* Token B Input */}
                    <div className={`rounded-xl p-3 transition-all ${inputClass}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          {displaySymbol(pool.tokenB)} Deposit
                        </span>
                        <div className="flex items-center gap-1.5">
                          <img
                            src={getTokenLogo(pool.tokenB)}
                            alt={pool.tokenB}
                            className="w-4 h-4 rounded-full"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                          <span className={`text-xs font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                            {displaySymbol(pool.tokenB)}
                          </span>
                        </div>
                      </div>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={amountB}
                        onChange={(e) => {
                          setActiveInput("B");
                          setAmountB(e.target.value);
                        }}
                        onFocus={() => setActiveInput("B")}
                        className={`w-full bg-transparent outline-none text-xl font-bold tabular-nums ${isDark ? "text-white placeholder:text-slate-600" : "text-gray-900 placeholder:text-gray-300"}`}
                      />
                      {prices[tokenB.tokenId] && amountB && parseFloat(amountB) > 0 && (
                        <div className={`text-[10px] mt-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                          ~{formatUsd(parseFloat(amountB) * (prices[tokenB.tokenId] || 0))}
                        </div>
                      )}
                    </div>

                    {/* Pool Info Card */}
                    {reserves && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="overflow-hidden"
                      >
                        <div className={`rounded-xl p-3 text-xs space-y-1.5 ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-100"}`}>
                          {/* Spot Price */}
                          {spotPrice && (
                            <div className="flex items-center justify-between">
                              <span className={isDark ? "text-slate-500" : "text-gray-400"}>Pool Ratio</span>
                              <span className="font-mono">
                                1 {displaySymbol(pool.tokenA)} = {spotPrice.bPerA >= 0.01 ? spotPrice.bPerA.toFixed(4) : spotPrice.bPerA.toFixed(8)} {displaySymbol(pool.tokenB)}
                              </span>
                            </div>
                          )}

                          {/* Reserves */}
                          <div className="flex items-center justify-between">
                            <span className={isDark ? "text-slate-500" : "text-gray-400"}>Reserves</span>
                            <span className="font-mono">
                              {formatCompact(Number(reserves.reserveA) / 10 ** (tokenA?.decimals || 0))} / {formatCompact(Number(reserves.reserveB) / 10 ** (tokenB?.decimals || 0))}
                            </span>
                          </div>

                          {/* TVL */}
                          <div className="flex items-center justify-between">
                            <span className={isDark ? "text-slate-500" : "text-gray-400"}>Pool TVL</span>
                            <span className="font-mono">{formatUsd(tvlUsd)}</span>
                          </div>

                          {/* Fee */}
                          <div className="flex items-center justify-between">
                            <span className={isDark ? "text-slate-500" : "text-gray-400"}>Swap Fee</span>
                            <span className="font-mono">{(pool.swapFeeBps / 100).toFixed(2)}%</span>
                          </div>

                          {/* LP Share Preview */}
                          {parseFloat(lpSharesPreview) > 0 && (
                            <>
                              <div className={`border-t my-1 ${isDark ? "border-slate-700/30" : "border-gray-200"}`} />
                              <div className="flex items-center justify-between">
                                <span className={isDark ? "text-slate-500" : "text-gray-400"}>LP Tokens</span>
                                <span className="font-mono text-emerald-400 font-bold">
                                  ~{parseFloat(lpSharesPreview).toFixed(6)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={isDark ? "text-slate-500" : "text-gray-400"}>Share of Pool</span>
                                <span className="font-mono text-emerald-400 font-bold">
                                  {shareOfPool < 0.01 ? "<0.01" : shareOfPool.toFixed(2)}%
                                </span>
                              </div>
                              {isFirstDeposit && (
                                <div className={`flex items-center gap-1.5 mt-1 ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>
                                  <Info className="w-3 h-3" />
                                  <span className="text-[10px]">First deposit — 1,000 units burned as minimum liquidity</span>
                                </div>
                              )}
                            </>
                          )}

                          {/* Refresh */}
                          <div className="flex justify-end pt-1">
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

                    {/* Loading reserves */}
                    {loadingReserves && !reserves && (
                      <div className="flex items-center justify-center gap-2 py-4">
                        <Loader2 className={`w-4 h-4 animate-spin ${isDark ? "text-pink-400" : "text-pink-500"}`} />
                        <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading pool data...</span>
                      </div>
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
                        {pool.lpTokenId !== "PENDING" && (
                          <TokenAssociationCheck
                            accountId={accountId}
                            tokenId={pool.lpTokenId}
                            tokenSymbol={`${displaySymbol(pool.tokenA)}/${displaySymbol(pool.tokenB)} LP`}
                            isDark={isDark}
                            onStatusChange={setAssocStatusLP}
                            compact
                          />
                        )}
                      </div>
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
                      "0 0 0px rgba(168,85,247,0)",
                      "0 0 30px rgba(168,85,247,0.4)",
                      "0 0 0px rgba(168,85,247,0)",
                    ],
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-5"
                >
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </motion.div>
                <h3 className={`text-sm font-bold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Adding Liquidity...
                </h3>
                <p className={`text-xs text-center max-w-[240px] ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  Authenticating, building transaction, and waiting for wallet confirmation.
                </p>
                <div className="flex items-center gap-2 mt-5">
                  <motion.div
                    className="flex items-center gap-1"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    {[pool?.tokenA, pool?.tokenB].map((sym, i) => (
                      <img
                        key={sym || i}
                        src={getTokenLogo(sym || "")}
                        alt={sym}
                        className="w-5 h-5 rounded-full border border-slate-700"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ))}
                  </motion.div>
                  <ArrowRight className={`w-3 h-3 ${isDark ? "text-slate-600" : "text-gray-400"}`} />
                  <Coins className={`w-5 h-5 ${isDark ? "text-purple-400" : "text-purple-500"}`} />
                </div>
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
                  Liquidity Added
                </h3>
                {sharesMinted && (
                  <p className={`text-xs mb-4 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                    +{parseFloat(bigIntToDecimal(BigInt(sharesMinted), pool?.lpDecimals || 8)).toFixed(6)} LP tokens minted
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
                    Add More
                  </button>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-500 to-pink-500 cursor-pointer"
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
                  Transaction Failed
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
        {step === "input" && pool && !isPoolPending && (
          <div className="px-5 pb-5 pt-1">
            <motion.button
              onClick={handleExecute}
              disabled={!canExecute}
              whileTap={canExecute ? { scale: 0.97 } : undefined}
              className={`w-full py-3 rounded-xl font-bold text-white text-sm transition-all relative overflow-hidden cursor-pointer ${
                !accountId
                  ? "bg-gray-600 cursor-not-allowed"
                  : !canExecute
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 bg-[length:200%_100%] hover:shadow-[0_0_30px_rgba(168,85,247,0.4)]"
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
                ) : isPoolPaused ? (
                  "Pool Paused"
                ) : assocStatusA === "needed" || assocStatusB === "needed" || assocStatusLP === "needed" ? (
                  <>
                    <Shield className="w-4 h-4" />
                    Associate Tokens First
                  </>
                ) : !parseFloat(amountA) || !parseFloat(amountB) ? (
                  "Enter Amounts"
                ) : (
                  <>
                    <Droplets className="w-4 h-4" />
                    Add Liquidity
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
                    Will authenticate on deposit
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
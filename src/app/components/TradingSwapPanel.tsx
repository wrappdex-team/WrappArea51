/**
 * TradingSwapPanel — Premium AMM Swap with Glow, Sound & Motion
 *
 * Uses the atomic CryptoTransfer AMM engine (constant-product math).
 * Features: animated borders, neon glow, sound effects, particle bursts.
 *
 * SENIOR DEV NOTE [C4-02]:
 *   Token association pre-check is integrated inline. When the user selects
 *   an output token, we query Mirror Node to verify the token is associated
 *   with their account. If not, an inline association prompt appears between
 *   the quote details and the swap button. The swap button is disabled until
 *   association completes. This prevents the confusing TOKEN_NOT_ASSOCIATED
 *   error that would otherwise surface during the atomic CryptoTransfer.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowDownUp,
  AlertCircle,
  Shield,
  Zap,
  CheckCircle2,
  Loader2,
  Lock,
  Droplets,
  PowerOff,
  WifiOff,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useWallet } from "../contexts/WalletContext";
import { authenticate, hasValidSession, clearSession } from "../utils/auth";
import { playVipCashRegister, playVipConfirm, playVipButtonChime } from "../utils/sounds";
import {
  getSwapQuote,
  executeSwap,
  formatFeeBps,
  WRAPPED_TOKENS,
  type SwapQuote,
} from "../utils/smart-liquidity";
import { useTheme } from "../contexts/ThemeContext";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { HBARH_BRANDING_DARK, HBARH_BRANDING_LIGHT } from "../assets/brand";
import { AmmPrelaunchBanner } from "./AmmPrelaunchBanner";
import { TokenAssociationCheck, type AssociationStatus } from "./TokenAssociationCheck";
import { AddLiquidityModal } from "./AddLiquidityModal";
import { RemoveLiquidityModal } from "./RemoveLiquidityModal";

// ── AMM kill switch status polling ──────────────────────────────────
const AMM_STATUS_URL = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/amm/kill-switch`;
// ── Atomic signer oracle status (richer than kill-switch) ───────────
const ORACLE_STATUS_URL = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/atomic/status`;

// ── Animated Glow Border ────────────────────────────────────────────

function GlowBorder({ children, className = "", active = false }: { children: React.ReactNode; className?: string; active?: boolean }) {
  const { isSky } = useTheme();
  const activeGrad = isSky
    ? "conic-gradient(from 0deg, #0ea5e9, #3b82f6, #06b6d4, #f43f5e, #0ea5e9)"
    : "conic-gradient(from 0deg, #ec4899, #8b5cf6, #06b6d4, #ec4899)";
  const idleGrad = isSky
    ? "conic-gradient(from 0deg, rgba(14,165,233,0.4), rgba(59,130,246,0.2), rgba(6,182,212,0.1), rgba(14,165,233,0.4))"
    : "conic-gradient(from 0deg, rgba(236,72,153,0.4), rgba(139,92,246,0.2), rgba(6,182,212,0.1), rgba(236,72,153,0.4))";
  return (
    <div className={`relative ${className}`}>
      {/* Animated gradient border */}
      <div className="absolute -inset-[1px] rounded-2xl overflow-hidden pointer-events-none z-0">
        <motion.div
          className="absolute inset-0"
          style={{ background: active ? activeGrad : idleGrad }}
          animate={{ rotate: 360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        />
      </div>
      {/* Inner content with background */}
      <div className="relative z-10 rounded-2xl">{children}</div>
    </div>
  );
}

// ── Particle Burst on Success ───────────────────────────────────────

function ParticleBurst({ show }: { show: boolean }) {
  if (!show) return null;
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * 200,
    y: (Math.random() - 0.5) * 200,
    scale: Math.random() * 0.6 + 0.4,
    color: ["#ec4899", "#8b5cf6", "#06b6d4", "#22c55e", "#f59e0b"][i % 5],
  }));

  return (
    <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute left-1/2 top-1/2 w-2 h-2 rounded-full"
          style={{ backgroundColor: p.color }}
          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
          animate={{ x: p.x, y: p.y, scale: p.scale, opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

interface TradingSwapPanelProps {
  isDark: boolean;
  /** Fired when the user changes either the "pay" or "receive" token */
  onTokenChange?: (symbol: string) => void;
}

export function TradingSwapPanel({ isDark, onTokenChange }: TradingSwapPanelProps) {
  const { hashPackSession } = useWallet();
  const accountId = hashPackSession?.accountId || null;

  const tokens = WRAPPED_TOKENS;
  const [tokenInIdx, setTokenInIdx] = useState(0);
  const [tokenOutIdx, setTokenOutIdx] = useState(2);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [status, setStatus] = useState<"idle" | "quoting" | "swapping" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showParticles, setShowParticles] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [hoverSwap, setHoverSwap] = useState(false);

  // ── Token Association Gate (C4) ─────────────────────────────────
  // Tracks whether the OUTPUT token is associated with the user's account.
  // When "needed", the swap button is disabled and an inline prompt appears.
  const [outTokenAssocStatus, setOutTokenAssocStatus] = useState<AssociationStatus>("unknown");
  // ── Add Liquidity Modal ─────────────────────────────────────────
  const [showLiquidityModal, setShowLiquidityModal] = useState(false);
  // ── Remove Liquidity Modal ──────────────────────────────────────
  const [showRemoveLiquidityModal, setShowRemoveLiquidityModal] = useState(false);

  // ── AMM Kill Switch Status ──────────────────────────────────────
  const [ammHalted, setAmmHalted] = useState(false);
  // ┌─────────────────────────────────────────────────────────────────────┐
  // │  SENIOR DEV NOTE — PRE-LAUNCH LOCK                                │
  // │  ammPrelaunch is set from the kill-switch endpoint's               │
  // │  prelaunchLocked field. When true, the entire swap body is         │
  // │  replaced with AmmPrelaunchBanner. Remove this state +             │
  // │  conditional when AMM_PRELAUNCH_LOCKED = false in atomic-signer.   │
  // └─────────────────────────────────────────────────────────────────────┘
  const [ammPrelaunch, setAmmPrelaunch] = useState(true);

  // ── Oracle / Signing Oracle Status ─────────────────────────────────
  // oracleStale: true when the /atomic/status endpoint is unreachable or
  //   returns data indicating the signing oracle is unhealthy. Swaps are
  //   blocked because the server can't co-sign without a live oracle.
  // executeSupported: true when at least one pool is active and the oracle
  //   is live and not killed. Derived from /atomic/status.isLive.
  const [oracleStale, setOracleStale] = useState(false);
  const [executeSupported, setExecuteSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        // Fetch both endpoints in parallel — kill-switch for halt/prelaunch,
        // atomic/status for oracle health + pool liveness
        const [killRes, oracleRes] = await Promise.all([
          fetch(AMM_STATUS_URL, {
            headers: { Authorization: `Bearer ${publicAnonKey}` },
            signal: AbortSignal.timeout(6000),
          }),
          fetch(ORACLE_STATUS_URL, {
            headers: { Authorization: `Bearer ${publicAnonKey}` },
            signal: AbortSignal.timeout(6000),
          }).catch(() => null),
        ]);

        if (cancelled) return;

        // Kill-switch endpoint
        if (killRes.ok) {
          const killData = await killRes.json();
          setAmmHalted(!!killData.active);
          setAmmPrelaunch(!!killData.prelaunchLocked);
        }

        // Oracle status endpoint
        if (oracleRes && oracleRes.ok) {
          const oracleData = await oracleRes.json();
          setOracleStale(false);
          setExecuteSupported(!!oracleData.isLive);
        } else {
          // Oracle unreachable — mark stale but don't block UI entirely
          setOracleStale(true);
          setExecuteSupported(false);
        }
      } catch {
        // Fail-closed: if we can't verify AMM status, show halted state
        // to prevent swaps against a potentially halted AMM.
        if (!cancelled) {
          console.log("[TradingSwap] Status check failed — failing closed");
          setAmmHalted(true);
          setOracleStale(true);
        }
      }
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const tokenIn = tokens[tokenInIdx];
  const tokenOut = tokens[tokenOutIdx];
  const prevAccountRef = useRef<string | null>(null);

  // Clear session on wallet change
  useEffect(() => {
    if (prevAccountRef.current && prevAccountRef.current !== accountId) {
      clearSession();
    }
    prevAccountRef.current = accountId;
  }, [accountId]);

  // Debounced quoting
  useEffect(() => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || tokenIn.symbol === tokenOut.symbol) {
      setQuote(null);
      setStatus("idle");
      return;
    }
    setStatus("quoting");
    setError(null);
    const timer = setTimeout(async () => {
      const q = await getSwapQuote(tokenIn.symbol, tokenOut.symbol, amt);
      setQuote(q);
      if (!q) {
        setStatus("error");
        setError("No route available — pools may need liquidity");
      } else {
        setStatus("idle");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [amount, tokenIn.symbol, tokenOut.symbol]);

  const handleSwap = useCallback(async () => {
    if (!quote || !accountId) return;
    setStatus("swapping");
    setError(null);
    playVipCashRegister();

    try {
      await authenticate(accountId);
      const minOut = (BigInt(quote.amountOutRaw) * 995n / 1000n).toString();
      const result = await executeSwap(accountId, quote.poolId, quote.tokenIn, quote.tokenOut, quote.amountInRaw, minOut);
      if (result.success) {
        setStatus("success");
        setShowParticles(true);
        playVipConfirm();
        toast.success(`Swapped ${parseFloat(amount).toFixed(4)} ${tokenIn.symbol} for ${quote.amountOut.toFixed(4)} ${tokenOut.symbol}`);
        setTimeout(() => { setShowParticles(false); }, 1200);
        setAmount("");
        setQuote(null);
        setTimeout(() => setStatus("idle"), 2500);
      } else {
        setError(result.error || "Swap failed");
        setStatus("error");
        toast.error(result.error || "Swap failed");
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
      setStatus("error");
      toast.error(err.message || "Swap error");
    }
  }, [quote, accountId, amount, tokenIn.symbol, tokenOut.symbol]);

  const flipTokens = () => {
    setIsFlipping(true);
    playVipButtonChime();
    setTimeout(() => {
      setTokenInIdx(tokenOutIdx);
      setTokenOutIdx(tokenInIdx);
      setAmount("");
      setQuote(null);
      setIsFlipping(false);
      // After flip, the "You Pay" token is what was previously "You Receive"
      if (onTokenChange) onTokenChange(tokens[tokenOutIdx].symbol);
    }, 200);
  };

  const inputClass = isDark
    ? "bg-slate-800/60 border border-pink-500/10 focus-within:border-pink-500/40"
    : "bg-gray-50 border border-gray-200 focus-within:border-pink-300";

  const isSwapDisabled = !quote || !accountId || status === "swapping" || status === "success" || ammHalted || oracleStale || !executeSupported || outTokenAssocStatus === "needed" || outTokenAssocStatus === "associating" || outTokenAssocStatus === "checking";

  return (
    <div className="h-full flex flex-col">
      <GlowBorder active={status === "swapping" || hoverSwap} className="h-full">
        <div className={`h-full flex flex-col rounded-2xl overflow-hidden ${isDark ? "bg-[#0a0a12]/95" : "bg-white/95"}`}>
          {/* Header */}
          <div className={`px-4 py-3 border-b ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <motion.div
                  animate={{ boxShadow: status === "swapping" ? "0 0 16px rgba(236,72,153,0.4)" : "0 0 0px rgba(236,72,153,0)" }}
                  transition={{ duration: 0.5, repeat: status === "swapping" ? Infinity : 0, repeatType: "reverse" }}
                  className="flex-shrink-0"
                >
                  <img
                    src={isDark ? HBARH_BRANDING_DARK : HBARH_BRANDING_LIGHT}
                    alt="WRAPpDEX"
                    className="h-5 w-auto"
                  />
                </motion.div>
                <div>
                  <span className={`text-sm font-bold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Swap</span>
                  <div className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      oracleStale
                        ? "bg-amber-400 animate-pulse"
                        : ammHalted
                        ? "bg-red-400"
                        : quote
                        ? "bg-emerald-400 animate-pulse"
                        : isDark ? "bg-slate-600" : "bg-gray-300"
                    }`} />
                    <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {oracleStale ? "Stale" : ammHalted ? "Halted" : quote ? "Live" : "Ready"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Shield className={`w-3 h-3 ${isDark ? "text-emerald-500/50" : "text-emerald-600/50"}`} />
                <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>x*y=k</span>
              </div>
            </div>
          </div>

          {/* Swap Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 relative">
            <ParticleBurst show={showParticles} />

            {/* AMM Pre-launch Lock — replaces entire swap body */}
            {ammPrelaunch ? (
              <AmmPrelaunchBanner isDark={isDark} />
            ) : (
            <>
            {/* AMM Kill Switch Banner */}
            {ammHalted && (
              <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/20 flex items-start gap-2.5">
                <PowerOff className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-400">AMM Trading Halted</p>
                  <p className="text-[10px] text-red-400/70 mt-0.5 leading-relaxed">
                    The protocol owner has temporarily suspended all swaps. Existing liquidity can still be withdrawn.
                  </p>
                </div>
              </div>
            )}

            {/* Oracle Stale Warning — signing oracle unreachable */}
            {oracleStale && !ammHalted && (
              <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
                <WifiOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-400">Oracle Unreachable</p>
                  <p className="text-[10px] text-amber-400/70 mt-0.5 leading-relaxed">
                    The signing oracle is not responding. Swaps are paused until connectivity is restored. Retrying automatically.
                  </p>
                </div>
              </div>
            )}

            {/* Pools Not Yet Live — oracle healthy but no active pools */}
            {!executeSupported && !oracleStale && !ammHalted && (
              <div className={`rounded-xl p-3 flex items-start gap-2.5 ${isDark ? "bg-slate-800/40 border border-slate-700/30" : "bg-blue-50 border border-blue-100"}`}>
                <Droplets className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? "text-blue-400/60" : "text-blue-400"}`} />
                <div>
                  <p className={`text-xs font-semibold ${isDark ? "text-blue-400/80" : "text-blue-500"}`}>Pools Deploying</p>
                  <p className={`text-[10px] mt-0.5 leading-relaxed ${isDark ? "text-slate-500" : "text-blue-400/70"}`}>
                    Pool accounts are being deployed on Hedera. Swaps will activate once at least one pool is live.
                  </p>
                </div>
              </div>
            )}

            {/* Token In */}
            <div className={`rounded-xl p-3 transition-all ${inputClass}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>You Pay</span>
                <div className="flex items-center gap-1.5">
                  <img src={tokenIn.logo} alt={tokenIn.symbol} className="w-4 h-4 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <select
                    value={tokenInIdx}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setTokenInIdx(idx);
                      if (idx === tokenOutIdx) setTokenOutIdx(tokenInIdx);
                      if (onTokenChange) onTokenChange(tokens[idx].symbol);
                    }}
                    className={`text-xs font-bold px-1.5 py-0.5 rounded-lg outline-none cursor-pointer ${isDark ? "bg-slate-700/50 text-white" : "bg-white text-gray-900 border border-gray-200"}`}
                  >
                    {tokens.map((t, i) => <option key={t.tokenId} value={i}>{t.symbol}</option>)}
                  </select>
                </div>
              </div>
              <input
                type="number"
                placeholder="0.00"
                className="w-full bg-transparent outline-none text-xl font-bold tabular-nums"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {/* Flip Button */}
            <div className="flex justify-center -my-0.5 relative z-10">
              <motion.button
                onClick={flipTokens}
                animate={{ rotate: isFlipping ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className={`p-2 rounded-full border-2 transition-all ${
                  isDark
                    ? "bg-[#0a0a12] border-pink-500/30 hover:border-pink-500/60 text-pink-400 hover:shadow-[0_0_15px_rgba(236,72,153,0.3)]"
                    : "bg-white border-gray-200 hover:border-pink-300 text-pink-500 shadow-sm hover:shadow-pink-200"
                }`}
              >
                <ArrowDownUp className="w-3.5 h-3.5" />
              </motion.button>
            </div>

            {/* Token Out */}
            <div className={`rounded-xl p-3 transition-all ${inputClass}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>You Receive</span>
                <div className="flex items-center gap-1.5">
                  <img src={tokenOut.logo} alt={tokenOut.symbol} className="w-4 h-4 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <select
                    value={tokenOutIdx}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setTokenOutIdx(idx);
                      if (idx === tokenInIdx) setTokenInIdx(tokenOutIdx);
                      if (onTokenChange) onTokenChange(tokens[idx].symbol);
                    }}
                    className={`text-xs font-bold px-1.5 py-0.5 rounded-lg outline-none cursor-pointer ${isDark ? "bg-slate-700/50 text-white" : "bg-white text-gray-900 border border-gray-200"}`}
                  >
                    {tokens.map((t, i) => <option key={t.tokenId} value={i}>{t.symbol}</option>)}
                  </select>
                </div>
              </div>
              <div className="text-xl font-bold tabular-nums">
                <AnimatePresence mode="wait">
                  {status === "quoting" ? (
                    <motion.span
                      key="quoting"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`flex items-center gap-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}
                    >
                      <Loader2 className="w-4 h-4 animate-spin" /> Quoting...
                    </motion.span>
                  ) : quote ? (
                    <motion.span
                      key={`quote-${quote.amountOut}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="text-emerald-400"
                    >
                      {quote.amountOut.toFixed(quote.amountOut >= 1 ? 4 : 8)}
                    </motion.span>
                  ) : (
                    <motion.span key="zero" className={isDark ? "text-slate-600" : "text-gray-300"}>0.00</motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Quote Details */}
            <AnimatePresence>
              {quote && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className={`rounded-xl p-3 text-xs space-y-1.5 ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-100"}`}>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>Route</span>
                      <span className="text-pink-400 font-mono">{quote.route}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>Rate</span>
                      <span className="font-mono">1 {tokenIn.symbol} = {quote.effectiveRate.toFixed(quote.effectiveRate < 0.01 ? 6 : 4)} {tokenOut.symbol}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>Impact</span>
                      <span className={`font-mono ${quote.priceImpactBps > 100 ? "text-amber-400" : quote.priceImpactBps > 300 ? "text-red-400" : isDark ? "text-slate-300" : "text-gray-600"}`}>
                        {(quote.priceImpactBps / 100).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>Fee</span>
                      <span className="font-mono">{formatFeeBps(quote.feeBps)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>Min Received</span>
                      <span className="font-mono text-emerald-400">{quote.minAmountOut.toFixed(4)} {tokenOut.symbol}</span>
                    </div>
                    {(quote as any).protocolFee && (
                      <>
                        <div className={`border-t my-1 ${isDark ? "border-slate-700/30" : "border-gray-200"}`} />
                        <div className="flex items-center justify-between">
                          <span className={isDark ? "text-slate-500" : "text-gray-400"}>Protocol Fee</span>
                          <span className="font-mono">{((quote as any).protocolFee.totalHbar).toFixed(6)} HBAR</span>
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Token Association Check */}
            <TokenAssociationCheck
              accountId={accountId}
              tokenId={tokenOut.tokenId}
              tokenSymbol={tokenOut.symbol}
              tokenLogo={tokenOut.logo}
              isDark={isDark}
              onStatusChange={setOutTokenAssocStatus}
              compact
            />

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="rounded-xl p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2"
                >
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{error}</span>
                </motion.div>
              )}
            </AnimatePresence>
            </>
            )}
          </div>

          {/* Swap Button — hidden during prelaunch */}
          {!ammPrelaunch && (
          <div className="px-4 pb-4 pt-2">
            <motion.button
              onClick={handleSwap}
              disabled={isSwapDisabled}
              onMouseEnter={() => { setHoverSwap(true); if (!isSwapDisabled) playVipButtonChime(); }}
              onMouseLeave={() => setHoverSwap(false)}
              whileTap={!isSwapDisabled ? { scale: 0.97 } : undefined}
              className={`w-full py-3 rounded-xl font-bold text-white text-sm transition-all relative overflow-hidden ${
                status === "success"
                  ? "bg-emerald-500 shadow-[0_0_25px_rgba(34,197,94,0.4)]"
                  : status === "swapping"
                  ? "bg-gradient-to-r from-pink-500 to-purple-500"
                  : !accountId
                  ? "bg-gray-600 cursor-not-allowed"
                  : !quote
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-gradient-to-r from-pink-500 via-purple-500 to-pink-500 bg-[length:200%_100%] hover:shadow-[0_0_30px_rgba(236,72,153,0.4)]"
              }`}
              animate={
                !isSwapDisabled && status === "idle"
                  ? { backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }
                  : undefined
              }
              transition={!isSwapDisabled ? { duration: 3, repeat: Infinity, ease: "linear" } : undefined}
            >
              {/* Shimmer overlay */}
              {!isSwapDisabled && status !== "swapping" && status !== "success" && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
                />
              )}

              <span className="relative z-10 flex items-center justify-center gap-2">
                {status === "swapping" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Executing Swap...</>
                ) : status === "success" ? (
                  <><CheckCircle2 className="w-4 h-4" /> Swap Complete!</>
                ) : ammHalted ? (
                  <><PowerOff className="w-4 h-4" /> Trading Halted</>
                ) : oracleStale ? (
                  <><WifiOff className="w-4 h-4" /> Oracle Stale</>
                ) : !executeSupported ? (
                  <><Droplets className="w-4 h-4" /> Pools Deploying</>
                ) : !accountId ? (
                  <><Lock className="w-4 h-4" /> Connect Wallet</>
                ) : outTokenAssocStatus === "needed" ? (
                  <><Shield className="w-4 h-4" /> Associate Token First</>
                ) : outTokenAssocStatus === "associating" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Associating...</>
                ) : outTokenAssocStatus === "checking" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Checking...</>
                ) : !quote ? (
                  "Enter Amount"
                ) : (
                  <><Zap className="w-4 h-4" /> Swap</>
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
                    <Lock className="w-2.5 h-2.5" />
                    Will sign on first swap
                  </span>
                )}
              </div>
            )}

            {/* Liquidity shortcuts */}
            <div className="flex gap-1.5 mt-1.5">
              <button
                onClick={() => { setShowLiquidityModal(true); playVipButtonChime(); }}
                className={`flex-1 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  isDark
                    ? "text-purple-400/70 bg-purple-500/[0.06] border border-purple-500/10 hover:border-purple-500/30 hover:text-purple-400"
                    : "text-purple-500/70 bg-purple-50 border border-purple-100 hover:border-purple-200 hover:text-purple-600"
                }`}
              >
                <Droplets className="w-3 h-3" />
                Add
              </button>
              <button
                onClick={() => { setShowRemoveLiquidityModal(true); playVipButtonChime(); }}
                className={`flex-1 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  isDark
                    ? "text-red-400/70 bg-red-500/[0.06] border border-red-500/10 hover:border-red-500/30 hover:text-red-400"
                    : "text-red-500/70 bg-red-50 border border-red-100 hover:border-red-200 hover:text-red-600"
                }`}
              >
                <Droplets className="w-3 h-3" />
                Remove
              </button>
            </div>
          </div>
          )}
        </div>
      </GlowBorder>

      {/* Add Liquidity Modal */}
      <AnimatePresence>
        {showLiquidityModal && (
          <AddLiquidityModal
            isDark={isDark}
            onClose={() => setShowLiquidityModal(false)}
          />
        )}
      </AnimatePresence>

      {/* Remove Liquidity Modal */}
      <AnimatePresence>
        {showRemoveLiquidityModal && (
          <RemoveLiquidityModal
            isDark={isDark}
            onClose={() => setShowRemoveLiquidityModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
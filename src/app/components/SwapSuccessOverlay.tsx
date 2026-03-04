/**
 * SwapSuccessOverlay — WRAPpDEX premium success celebration.
 *
 * IMPLEMENTATION NOTE — Session 10, Step 1 of 5: Foundation rewrite.
 * - Brand gradient palette (pink -> purple -> cyan) replaces plain emerald
 * - Multi-ring pulsing checkmark with SVG path draw-on
 * - Premium glassmorphic backdrop matching SwapCardPro
 * - 40-particle confetti burst in brand colors
 * - Animated gradient auto-dismiss progress bar
 * - WRAPpDEX branded header with inline wordmark
 * - Restructured token flow with larger, bolder layout
 * - Auto-dismiss 8s (up from 6s) for more celebration time
 *
 * IMPLEMENTATION NOTE — Session 10, Step 2 of 5: Dopamine pulse.
 * - playSwapSuccess() triumphant 4-layer chime (sub-bass + chord + shimmer + bell)
 * - Screen flash: brief brand-gradient flash on overlay entrance
 * - Checkmark "pop" bounce after SVG draw-on completes
 * - Haptic vibration via navigator.vibrate for mobile
 * - Token pill "materialize" spring-in with staggered delay
 * - Output amount animated counter (rolls up from 0)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ExternalLink,
  ArrowRight,
  X,
  Copy,
  CheckCircle2,
  Zap,
  Shield,
} from "lucide-react";
import { playSwapSuccess } from "../utils/sounds";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface SwapSuccessOverlayProps {
  show: boolean;
  inputSymbol: string;
  outputSymbol: string;
  inputAmount: string;
  outputAmount: string;
  inputLogo: string;
  outputLogo: string;
  inputUsd?: number;
  outputUsd?: number;
  transactionId: string | null;
  txUrl: string | null;
  slippage: number;
  venue: string;
  isWrapUnwrap?: boolean;
  onClose: () => void;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const AUTO_DISMISS_MS = 8000;

// WRAPpDEX brand confetti palette
const CONFETTI_COLORS = [
  "#ec4899", // pink-500
  "#a855f7", // purple-500
  "#06b6d4", // cyan-500
  "#1D63ED", // brand blue (the "p")
  "#f472b6", // pink-400
  "#818cf8", // indigo-400
  "#22d3ee", // cyan-400
  "#c084fc", // purple-400
  "#3b82f6", // blue-500
  "#fbbf24", // amber-400 (accent pop)
];

/* ─── Haptic helper ─────────────────────────────────────────────────── */

function triggerHaptic() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([30, 40, 60]); // short-gap-long pattern
    }
  } catch { /* no-op on unsupported devices */ }
}

/* ─── Animated Counter Hook ─────────────────────────────────────────── */

function useAnimatedCounter(
  target: number,
  duration: number = 800,
  delay: number = 700,
  decimals: number = 6,
) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const startTime = performance.now() + delay;
    const animate = (now: number) => {
      const elapsed = now - startTime;
      if (elapsed < 0) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic for satisfying deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, delay]);

  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/* ─── Confetti Particle Burst ───────────────────────────────────────── */

function BrandConfetti() {
  const particles = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    angle: (i / 40) * Math.PI * 2 + (Math.random() - 0.5) * 0.6,
    distance: 50 + Math.random() * 120,
    size: 2.5 + Math.random() * 5,
    delay: Math.random() * 0.4,
    shape: i % 3 === 0 ? "circle" : i % 3 === 1 ? "rect" : "diamond",
    rotation: Math.random() * 720 - 360,
  }));

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute"
          style={{
            left: "50%",
            top: "35%",
            width: p.size,
            height: p.shape === "rect" ? p.size * 2 : p.size,
            borderRadius:
              p.shape === "circle"
                ? "50%"
                : p.shape === "diamond"
                  ? "2px"
                  : "1px",
            backgroundColor: p.color,
            transform: p.shape === "diamond" ? "rotate(45deg)" : undefined,
          }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0 }}
          animate={{
            x: Math.cos(p.angle) * p.distance,
            y: Math.sin(p.angle) * p.distance + 30,
            opacity: [0, 1, 1, 0],
            scale: [0, 1.8, 1.2, 0],
            rotate: p.rotation,
          }}
          transition={{
            duration: 1.4 + Math.random() * 0.5,
            delay: p.delay,
            ease: [0.22, 0.68, 0.36, 1],
          }}
        />
      ))}
    </div>
  );
}

/* ─── Screen Flash — brief brand-gradient flash on entrance ─────────── */

function ScreenFlash() {
  return (
    <motion.div
      className="absolute inset-0 z-50 pointer-events-none"
      style={{
        background:
          "radial-gradient(circle at 50% 40%, rgba(29,99,237,0.35), rgba(168,85,247,0.2), transparent 70%)",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: 0.5, ease: "easeOut", times: [0, 0.15, 1] }}
    />
  );
}

/* ─── Animated Checkmark — multi-ring glow + SVG draw-on + pop bounce ── */

function EpicCheckmark() {
  return (
    <motion.div
      className="relative w-20 h-20 sm:w-24 sm:h-24"
      // Pop bounce after checkmark draw-on completes (~1.1s)
      animate={{
        scale: [1, 1, 1, 1.15, 0.95, 1.05, 1],
      }}
      transition={{
        duration: 1.6,
        times: [0, 0.65, 0.68, 0.75, 0.82, 0.9, 1],
        ease: "easeOut",
      }}
    >
      {/* Outer pulse ring 1 — slow, large */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, rgba(236,72,153,0.2), rgba(168,85,247,0.2), rgba(6,182,212,0.2), rgba(236,72,153,0.2))",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.8, 2.2],
          opacity: [0, 0.6, 0],
        }}
        transition={{ duration: 1.6, ease: "easeOut" }}
      />
      {/* Outer pulse ring 2 — faster, medium */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(29,99,237,0.3), transparent 70%)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.5, 1.8],
          opacity: [0, 0.5, 0],
        }}
        transition={{ duration: 1.2, delay: 0.15, ease: "easeOut" }}
      />
      {/* Inner glow */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(29,99,237,0.25), transparent 60%)",
          filter: "blur(8px)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1.3, opacity: [0, 0.8, 0.5] }}
        transition={{ duration: 0.8, delay: 0.3 }}
      />
      {/* Secondary delayed ring — dopamine double-tap */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          border: "1.5px solid rgba(29,99,237,0.25)",
        }}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{
          scale: [0.6, 1.6, 2.0],
          opacity: [0, 0.4, 0],
        }}
        transition={{ duration: 1.0, delay: 0.8, ease: "easeOut" }}
      />

      {/* SVG checkmark */}
      <svg
        viewBox="0 0 96 96"
        fill="none"
        className="relative w-full h-full z-10"
      >
        {/* Gradient defs */}
        <defs>
          <linearGradient id="successRingGrad" x1="0" y1="0" x2="96" y2="96">
            <stop offset="0%" stopColor="#ec4899" />
            <stop offset="50%" stopColor="#1D63ED" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="successFillGrad" x1="0" y1="0" x2="96" y2="96">
            <stop offset="0%" stopColor="rgba(236,72,153,0.12)" />
            <stop offset="50%" stopColor="rgba(29,99,237,0.15)" />
            <stop offset="100%" stopColor="rgba(6,182,212,0.1)" />
          </linearGradient>
          <linearGradient id="checkStrokeGrad" x1="28" y1="48" x2="68" y2="38">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e0f2fe" />
          </linearGradient>
          {/* Glow filter for the checkmark */}
          <filter id="checkGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Circle stroke draw-on */}
        <motion.circle
          cx="48"
          cy="48"
          r="40"
          stroke="url(#successRingGrad)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
        />
        {/* Filled circle bg */}
        <motion.circle
          cx="48"
          cy="48"
          r="40"
          fill="url(#successFillGrad)"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.35, type: "spring", stiffness: 200 }}
          style={{ transformOrigin: "center" }}
        />
        {/* Checkmark path */}
        <motion.path
          d="M30 50 L42 62 L66 38"
          stroke="url(#checkStrokeGrad)"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          filter="url(#checkGlow)"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.45, ease: "easeOut" }}
        />
      </svg>
    </motion.div>
  );
}

/* ─── WRAPpDEX Inline Wordmark ──────────────────────────────────────── */

function BrandWordmark() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3, duration: 0.4 }}
      className="flex items-center gap-1 mb-1"
    >
      <span className="text-[10px] sm:text-[11px] font-extrabold tracking-widest uppercase text-slate-500">
        Powered by
      </span>
      <span className="text-[10px] sm:text-[11px] font-extrabold tracking-widest uppercase">
        <span className="text-white">WRAP</span>
        <span style={{ color: "#1D63ED" }}>p</span>
        <span className="text-slate-400">DEX</span>
      </span>
    </motion.div>
  );
}

/* ─── Token Pill with spring-in ─────────────────────────────────────── */

function TokenPill({
  logo,
  symbol,
  amount,
  isOutput,
  delay,
}: {
  logo: string;
  symbol: string;
  amount: string;
  isOutput?: boolean;
  delay: number;
}) {
  // For output pill, use animated counter for dopamine roll-up
  const parsedAmount = parseFloat(amount);
  const animatedAmount = useAnimatedCounter(
    isOutput ? parsedAmount : 0,
    900,
    delay * 1000 + 200,
    6,
  );

  const displayValue = isOutput
    ? animatedAmount
    : parsedAmount.toLocaleString(undefined, { maximumFractionDigits: 6 });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        delay,
        type: "spring",
        stiffness: 350,
        damping: 18,
      }}
      className="flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm"
    >
      <motion.img
        src={logo}
        alt={symbol}
        className="w-6 h-6 rounded-full ring-1 ring-white/10"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
        // Micro-bounce on the icon after pill lands
        animate={{ scale: [1, 1, 1.15, 1] }}
        transition={{ delay: delay + 0.3, duration: 0.3 }}
      />
      <div className="text-right">
        <div
          className={`text-sm sm:text-base font-bold tabular-nums ${
            isOutput ? "bg-clip-text text-transparent" : "text-white"
          }`}
          style={
            isOutput
              ? {
                  backgroundImage:
                    "linear-gradient(135deg, #c084fc, #60a5fa, #22d3ee)",
                }
              : undefined
          }
        >
          {displayValue}
        </div>
        <div className="text-[10px] text-slate-500 font-medium">{symbol}</div>
      </div>
    </motion.div>
  );
}

/* ─── Main Overlay ──────────────────────────────────────────────────── */

export function SwapSuccessOverlay({
  show,
  inputSymbol,
  outputSymbol,
  inputAmount,
  outputAmount,
  inputLogo,
  outputLogo,
  inputUsd,
  outputUsd,
  transactionId,
  txUrl,
  slippage,
  venue,
  isWrapUnwrap = false,
  onClose,
}: SwapSuccessOverlayProps) {
  const [copied, setCopied] = useState(false);
  const soundPlayed = useRef(false);

  // ── Sound + Haptic on mount ──
  useEffect(() => {
    if (!show) {
      soundPlayed.current = false;
      return;
    }
    if (!soundPlayed.current) {
      soundPlayed.current = true;
      playSwapSuccess();
      triggerHaptic();
    }
  }, [show]);

  // Auto-dismiss
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [show, onClose]);

  const copyTxId = useCallback(() => {
    if (!transactionId) return;
    try {
      const ta = document.createElement("textarea");
      ta.value = transactionId;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      navigator.clipboard
        ?.writeText(transactionId)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {});
    }
  }, [transactionId]);

  const displayTxId = transactionId
    ? transactionId.length > 28
      ? transactionId.slice(0, 14) + "..." + transactionId.slice(-10)
      : transactionId
    : null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.94 }}
          transition={{ type: "spring", damping: 24, stiffness: 280 }}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center overflow-hidden"
          role="alert"
          aria-live="assertive"
          aria-label="Swap completed successfully"
          style={{
            borderRadius: "inherit",
          }}
        >
          {/* ── Screen Flash — dopamine burst on entrance ── */}
          <ScreenFlash />

          {/* Premium glassmorphic background */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, rgba(12,15,26,0.97) 0%, rgba(15,10,30,0.98) 50%, rgba(10,15,25,0.97) 100%)",
              backdropFilter: "blur(40px) saturate(150%)",
            }}
          />

          {/* Ambient brand gradient orbs */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <motion.div
              className="absolute -top-12 -left-12 w-48 h-48 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(236,72,153,0.12), transparent 70%)",
                filter: "blur(40px)",
              }}
              animate={{
                scale: [1, 1.15, 1],
                opacity: [0.4, 0.7, 0.4],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute -bottom-8 -right-8 w-40 h-40 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(6,182,212,0.1), transparent 70%)",
                filter: "blur(40px)",
              }}
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.3, 0.6, 0.3],
              }}
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 1,
              }}
            />
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(29,99,237,0.06), transparent 60%)",
                filter: "blur(50px)",
              }}
              animate={{
                scale: [1, 1.1, 1],
                opacity: [0.3, 0.5, 0.3],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.5,
              }}
            />
          </div>

          {/* Animated gradient border frame */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{
              borderRadius: "inherit",
              padding: "1px",
              background:
                "linear-gradient(135deg, rgba(236,72,153,0.3), rgba(139,92,246,0.2), rgba(6,182,212,0.25), rgba(29,99,237,0.3))",
              backgroundSize: "300% 300%",
              WebkitMask:
                "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
              WebkitMaskComposite: "xor",
              maskComposite: "exclude",
            }}
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
            }}
            transition={{
              opacity: { duration: 0.5 },
              backgroundPosition: { duration: 4, repeat: Infinity, ease: "linear" },
            }}
          />

          {/* Confetti burst */}
          <BrandConfetti />

          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Dismiss success overlay"
            className="absolute top-3 right-3 z-30 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
          >
            <X className="w-4 h-4" />
          </button>

          {/* ═══ Content ═══ */}
          <div className="relative z-10 flex flex-col items-center px-5 sm:px-6 py-5 w-full max-w-sm">
            {/* Brand wordmark */}
            <BrandWordmark />

            {/* Epic checkmark with pop bounce */}
            <EpicCheckmark />

            {/* Title */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, type: "spring", stiffness: 200 }}
              className="mt-3 text-center"
            >
              <h4
                className="text-lg sm:text-xl font-bold bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, #f472b6, #818cf8, #22d3ee)",
                }}
              >
                {isWrapUnwrap ? "Wrap Complete!" : "Swap Successful!"}
              </h4>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-[11px] text-slate-500 mt-0.5"
              >
                Transaction confirmed on Hedera
              </motion.p>
            </motion.div>

            {/* ═══ Token Flow: Input -> Output ═══ */}
            <div className="mt-5 w-full">
              <div className="flex items-center justify-center gap-2.5 sm:gap-3">
                {/* Input token pill — spring in first */}
                <TokenPill
                  logo={inputLogo}
                  symbol={inputSymbol}
                  amount={inputAmount}
                  delay={0.55}
                />

                {/* Animated arrow */}
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{
                    delay: 0.75,
                    type: "spring",
                    stiffness: 300,
                    damping: 15,
                  }}
                  className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full border border-white/[0.08]"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(236,72,153,0.1), rgba(29,99,237,0.15), rgba(6,182,212,0.1))",
                  }}
                >
                  <ArrowRight className="w-4 h-4 text-blue-400" />
                </motion.div>

                {/* Output token pill — spring in second, with animated counter */}
                <TokenPill
                  logo={outputLogo}
                  symbol={outputSymbol}
                  amount={outputAmount}
                  isOutput
                  delay={0.7}
                />
              </div>

              {/* USD values */}
              {(inputUsd || outputUsd) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="flex items-center justify-center gap-12 mt-1.5"
                >
                  <span className="text-[10px] text-slate-600 tabular-nums">
                    {inputUsd ? `~$${inputUsd.toFixed(2)}` : ""}
                  </span>
                  <span className="text-[10px] text-slate-600 tabular-nums">
                    {outputUsd ? `~$${outputUsd.toFixed(2)}` : ""}
                  </span>
                </motion.div>
              )}
            </div>

            {/* ═══ Transaction Receipt ═══ */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.85 }}
              className="mt-4 w-full rounded-xl border border-white/[0.06] overflow-hidden"
              style={{
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
              }}
            >
              <div className="p-3 space-y-2">
                {/* Tx Hash */}
                {displayTxId && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">
                      Tx Hash
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-slate-300">
                        {displayTxId}
                      </span>
                      <button
                        onClick={copyTxId}
                        aria-label="Copy transaction ID"
                        className="p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {copied ? (
                          <CheckCircle2 className="w-3 h-3 text-cyan-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Slippage */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">
                    Slippage
                  </span>
                  <span className="text-[11px] text-slate-300 tabular-nums">
                    {slippage}%
                  </span>
                </div>

                {/* Venue */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">
                    Venue
                  </span>
                  <span className="text-[11px] text-slate-300 flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5 text-purple-400" />
                    {venue}
                  </span>
                </div>

                {/* Network fee */}
                <div className="pt-1.5 border-t border-white/[0.04] flex items-center justify-center gap-1">
                  <Shield className="w-2.5 h-2.5 text-slate-600" />
                  <span className="text-[9px] text-slate-600">
                    Network fee: ~$0.001 (Hedera)
                  </span>
                </div>
              </div>
            </motion.div>

            {/* ═══ HashScan Link ═══ */}
            {txUrl && (
              <motion.a
                href={txUrl}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.0 }}
                className="mt-3 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04]"
                style={{
                  color: "#818cf8",
                }}
              >
                <ExternalLink className="w-3 h-3" />
                View on HashScan
              </motion.a>
            )}

            {/* ═══ Auto-dismiss gradient progress bar ═══ */}
            <motion.div
              className="absolute bottom-0 left-0 h-[2px] rounded-full"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, #ec4899, #a855f7, #1D63ED, #06b6d4)",
                backgroundSize: "200% 100%",
              }}
              initial={{ width: "100%" }}
              animate={{
                width: "0%",
                backgroundPosition: ["0% 50%", "100% 50%"],
              }}
              transition={{
                width: { duration: AUTO_DISMISS_MS / 1000, ease: "linear" },
                backgroundPosition: {
                  duration: 2,
                  repeat: Infinity,
                  ease: "linear",
                },
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

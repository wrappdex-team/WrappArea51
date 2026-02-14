/**
 * SwapSuccessOverlay — Animated success celebration shown after a completed swap.
 *
 * Features:
 * - Animated checkmark (SVG path draw-on)
 * - Mini confetti particles
 * - Transaction receipt summary: input -> output, tx hash link, fees/slippage
 * - Auto-dismiss after 6 seconds or manual close
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ExternalLink,
  ArrowRight,
  X,
  Copy,
  CheckCircle2,
  Zap,
} from "lucide-react";

interface SwapSuccessOverlayProps {
  /** Whether the overlay is visible */
  show: boolean;
  /** Input token symbol */
  inputSymbol: string;
  /** Output token symbol */
  outputSymbol: string;
  /** Input amount string */
  inputAmount: string;
  /** Output amount string */
  outputAmount: string;
  /** Input token logo URL */
  inputLogo: string;
  /** Output token logo URL */
  outputLogo: string;
  /** Input amount in USD */
  inputUsd?: number;
  /** Output amount in USD */
  outputUsd?: number;
  /** Transaction ID (Hedera format) */
  transactionId: string | null;
  /** HashScan transaction URL */
  txUrl: string | null;
  /** Slippage used */
  slippage: number;
  /** Execution venue label */
  venue: string;
  /** Whether this was a wrap/unwrap operation */
  isWrapUnwrap?: boolean;
  /** Close / dismiss handler */
  onClose: () => void;
}

// Confetti colors matching the pink/purple dark theme
const CONFETTI_COLORS = [
  "#ec4899", "#a855f7", "#22c55e", "#3b82f6", "#fbbf24",
  "#f472b6", "#818cf8", "#34d399", "#60a5fa", "#facc15",
];

function MiniConfetti() {
  // Generate 24 particles with random positions and trajectories
  const particles = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    // Random angle in radians
    angle: (i / 24) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
    distance: 60 + Math.random() * 80,
    size: 3 + Math.random() * 4,
    delay: Math.random() * 0.3,
    shape: Math.random() > 0.5 ? "circle" : "rect",
  }));

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute"
          style={{
            left: "50%",
            top: "40%",
            width: p.size,
            height: p.shape === "rect" ? p.size * 1.5 : p.size,
            borderRadius: p.shape === "circle" ? "50%" : "1px",
            backgroundColor: p.color,
          }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
          animate={{
            x: Math.cos(p.angle) * p.distance,
            y: Math.sin(p.angle) * p.distance + 40,
            opacity: 0,
            scale: [1, 1.5, 0.5],
            rotate: Math.random() * 720 - 360,
          }}
          transition={{
            duration: 1.2 + Math.random() * 0.6,
            delay: p.delay,
            ease: [0.2, 0.8, 0.3, 1],
          }}
        />
      ))}
    </div>
  );
}

/** Animated SVG checkmark that draws on */
function AnimatedCheckmark() {
  return (
    <div className="relative w-16 h-16">
      {/* Glow ring */}
      <motion.div
        className="absolute inset-0 rounded-full bg-emerald-500/20"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.4, 1], opacity: [0, 0.6, 0.3] }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
      {/* Circle + Check */}
      <svg
        viewBox="0 0 64 64"
        fill="none"
        className="relative w-16 h-16 z-10"
      >
        {/* Background circle */}
        <motion.circle
          cx="32"
          cy="32"
          r="28"
          stroke="url(#checkGrad)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        />
        {/* Filled circle background */}
        <motion.circle
          cx="32"
          cy="32"
          r="28"
          fill="url(#checkFill)"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          style={{ transformOrigin: "center" }}
        />
        {/* Checkmark path */}
        <motion.path
          d="M20 33 L28 41 L44 25"
          stroke="white"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.5, duration: 0.4, ease: "easeOut" }}
        />
        <defs>
          <linearGradient id="checkGrad" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id="checkFill" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stopColor="rgba(34,197,94,0.15)" />
            <stop offset="100%" stopColor="rgba(16,185,129,0.1)" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

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

  // Auto-dismiss after 6 seconds
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(onClose, 6000);
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
      navigator.clipboard?.writeText(transactionId).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => { /* silent */ });
    }
  }, [transactionId]);

  // Format transaction ID for display (truncated)
  const displayTxId = transactionId
    ? transactionId.length > 28
      ? transactionId.slice(0, 14) + "..." + transactionId.slice(-10)
      : transactionId
    : null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          transition={{ type: "spring", damping: 22, stiffness: 300 }}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-emerald-500/20 overflow-hidden"
          role="alert"
          aria-live="assertive"
          aria-label="Swap completed successfully"
        >
          {/* Confetti burst */}
          <MiniConfetti />

          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Dismiss success overlay"
            className="absolute top-3 right-3 z-20 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center px-5 py-4 w-full max-w-sm">
            {/* Animated checkmark */}
            <AnimatedCheckmark />

            {/* Title */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mt-3 text-center"
            >
              <h4 className="text-lg font-bold text-emerald-400">
                {isWrapUnwrap ? "Wrap Complete!" : "Swap Successful!"}
              </h4>
            </motion.div>

            {/* Token flow: Input -> Output */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="mt-4 w-full"
            >
              <div className="flex items-center justify-center gap-3">
                {/* Input side */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/30">
                  <img
                    src={inputLogo}
                    alt={inputSymbol}
                    className="w-5 h-5 rounded-full"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="text-right">
                    <div className="text-sm font-bold text-white">
                      {parseFloat(inputAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </div>
                    <div className="text-[10px] text-slate-500">{inputSymbol}</div>
                  </div>
                </div>

                {/* Arrow */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.7, type: "spring", stiffness: 300 }}
                  className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20"
                >
                  <ArrowRight className="w-4 h-4 text-emerald-400" />
                </motion.div>

                {/* Output side */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-emerald-500/15">
                  <img
                    src={outputLogo}
                    alt={outputSymbol}
                    className="w-5 h-5 rounded-full"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="text-right">
                    <div className="text-sm font-bold text-emerald-400">
                      {parseFloat(outputAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </div>
                    <div className="text-[10px] text-slate-500">{outputSymbol}</div>
                  </div>
                </div>
              </div>

              {/* USD values if available */}
              {(inputUsd || outputUsd) ? (
                <div className="flex items-center justify-center gap-6 mt-1.5 text-[10px] text-slate-500">
                  {inputUsd ? <span>~${inputUsd.toFixed(2)}</span> : null}
                  <span />
                  {outputUsd ? <span>~${outputUsd.toFixed(2)}</span> : null}
                </div>
              ) : null}
            </motion.div>

            {/* Transaction Receipt Details */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="mt-4 w-full rounded-xl bg-slate-800/40 border border-slate-700/20 p-3 space-y-2"
            >
              {/* Tx Hash */}
              {displayTxId && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Tx Hash</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-slate-300">{displayTxId}</span>
                    <button
                      onClick={copyTxId}
                      aria-label="Copy transaction ID"
                      className="p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {copied ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Slippage + Venue */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Slippage</span>
                <span className="text-[11px] text-slate-300">{slippage}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Venue</span>
                <span className="text-[11px] text-slate-300 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5 text-emerald-400" />
                  {venue}
                </span>
              </div>

              {/* Network fee note */}
              <div className="pt-1.5 border-t border-slate-700/20 text-center">
                <span className="text-[9px] text-slate-600">
                  Network fee: ~$0.001 (Hedera)
                </span>
              </div>
            </motion.div>

            {/* HashScan Link */}
            {txUrl && (
              <motion.a
                href={txUrl}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85 }}
                className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                View on HashScan
              </motion.a>
            )}

            {/* Auto-dismiss progress */}
            <motion.div
              className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-emerald-500 to-green-400 rounded-full"
              initial={{ width: "100%" }}
              animate={{ width: "0%" }}
              transition={{ duration: 6, ease: "linear" }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

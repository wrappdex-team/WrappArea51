/**
 * QuickPairGrid — Premium "Quick Select" pair cards for the swap panel.
 *
 * SESSION 8 overhaul — glassmorphic container matching SwapCardPro's
 * aesthetic, staggered card entrance animations, compact TVL summary bar,
 * animated gradient border on hover, and a cleaner card design with
 * colored accent bars and version/fee micro-badges.
 *
 * 20 blue-chip pairs (no meme coins). Click any card to set the pair
 * in the swap panel. Click-only interaction — no hover auto-select.
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ExternalLink, RefreshCw, Zap, TrendingUp, ChevronDown } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { TokenIcon } from "./TokenIcon";
import { SAUCERSWAP_LARRY_LOGO } from "../assets/brand";
import type { AllowedToken, PoolRoute } from "../utils/saucerswap";
import { formatUsdCompact } from "../utils/saucerswap";

/* ═══════════════════════════════════════════════════════════════════════
   CURATED BLUE-CHIP PAIRS — No meme coins. Institutional quality only.
   Ordered by expected TVL/popularity.
   ═══════════════════════════════════════════════════════════════════════ */

const CURATED_PAIR_KEYS = [
  "HBAR/USDC",
  "HBAR/USDT",
  "HBAR/SAUCE",
  "HBAR/HBARX",
  "HBAR/WBTC",
  "HBAR/WETH",
  "HBAR/LINK",
  "USDC/USDT",
  "SAUCE/USDC",
  "WBTC/USDC",
  "WETH/USDC",
  "HBAR/PACK",
  "HBAR/HBAR.\u0127",
  "HBAR/DAI",
  "HBAR/AAVE",
  "HBAR/KARATE",
  "HBAR/DOVU",
  "HBAR/HST",
  "HBAR/WPOL",
  "HBAR/WBNB",
] as const;

/* ── Helper: normalise pair key for matching ── */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("/");
}

/* ═══ CSS keyframes (injected once) ═══ */
const STYLE_ID = "quickpair-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes qp-gradient { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
    @keyframes qp-shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
  `;
  document.head.appendChild(style);
}

/* ═══ MAIN COMPONENT ═══ */

interface QuickPairGridProps {
  allPools: PoolRoute[];
  poolsLoading: boolean;
  inputToken: AllowedToken;
  outputToken: AllowedToken;
  activePoolId: string | null;
  route: { pools: PoolRoute[] } | null;
  onSelectPair: (pool: PoolRoute) => void;
}

export function QuickPairGrid({
  allPools,
  poolsLoading,
  inputToken,
  outputToken,
  activePoolId,
  route,
  onSelectPair,
}: QuickPairGridProps) {
  const { isDark } = useTheme();
  const [showAll, setShowAll] = useState(false);

  /* ── Build the curated display list from live pool data ── */
  const curatedPools = useMemo(() => {
    const poolMap = new Map<string, PoolRoute>();
    for (const pool of allPools) {
      const key = pairKey(pool.tokenA.symbol, pool.tokenB.symbol);
      const existing = poolMap.get(key);
      if (!existing || pool.tvlUsd > existing.tvlUsd) {
        poolMap.set(key, pool);
      }
    }

    const result: PoolRoute[] = [];
    for (const pairStr of CURATED_PAIR_KEYS) {
      const [a, b] = pairStr.split("/");
      const key = pairKey(a, b);
      const pool = poolMap.get(key);
      if (pool) result.push(pool);
    }
    return result;
  }, [allPools]);

  /* ── Total TVL across displayed pairs ── */
  const totalTvl = useMemo(
    () => curatedPools.reduce((sum, p) => sum + p.tvlUsd, 0),
    [curatedPools]
  );

  /* ── Show 8 by default, expand to all ── */
  const INITIAL_COUNT =
    typeof window !== "undefined" && window.innerWidth < 640 ? 4 : 8;
  const visiblePools = showAll ? curatedPools : curatedPools.slice(0, INITIAL_COUNT);
  const hasMore = curatedPools.length > INITIAL_COUNT;

  return (
    <div className="relative">
      {/* Ambient glow — matches SwapCardPro */}
      <div
        className="absolute -inset-3 rounded-3xl opacity-20 blur-2xl pointer-events-none"
        style={{
          background: isDark
            ? "radial-gradient(ellipse at 40% 30%, rgba(29,99,237,0.12), transparent 60%), radial-gradient(ellipse at 60% 70%, rgba(6,182,212,0.08), transparent 60%)"
            : "radial-gradient(ellipse at 40% 30%, rgba(29,99,237,0.06), transparent 60%), radial-gradient(ellipse at 60% 70%, rgba(6,182,212,0.04), transparent 60%)",
        }}
      />

      {/* Animated gradient border */}
      <div className="relative rounded-2xl p-[1px] overflow-hidden">
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            backgroundImage: isDark
              ? "linear-gradient(135deg, rgba(29,99,237,0.25), rgba(6,182,212,0.15), rgba(16,185,129,0.1), rgba(29,99,237,0.25))"
              : "linear-gradient(135deg, rgba(29,99,237,0.12), rgba(6,182,212,0.08), rgba(16,185,129,0.06), rgba(29,99,237,0.12))",
            backgroundSize: "300% 300%",
            animation: "qp-gradient 8s ease-in-out infinite",
          }}
        />

        {/* Card body */}
        <div
          className={`relative rounded-2xl ${
            isDark
              ? "bg-[#0c0f1a]/95 backdrop-blur-2xl"
              : "bg-white/95 backdrop-blur-2xl shadow-xl"
          }`}
        >
          {/* ── Header ── */}
          <div
            className={`px-3 sm:px-5 pt-3 sm:pt-4 pb-2 sm:pb-3 flex items-center justify-between ${
              isDark ? "border-b border-white/[0.04]" : "border-b border-gray-100"
            }`}
          >
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div className="relative">
                <Zap
                  className={`w-5 h-5 ${isDark ? "text-blue-400" : "text-blue-600"}`}
                />
                {/* Pulse dot on the icon */}
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <h3
                className={`text-base sm:text-lg font-extrabold tracking-tight ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                Quick Select
              </h3>
              {poolsLoading && (
                <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
              )}
            </div>
            <a
              href="https://www.saucerswap.finance/swap"
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                isDark
                  ? "text-slate-400 hover:text-white hover:bg-white/[0.04]"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              <img
                src={SAUCERSWAP_LARRY_LOGO}
                alt=""
                className="w-4 h-4 rounded-full"
                width={16}
                height={16}
              />
              SaucerSwap
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          </div>

          {/* ── TVL Summary Bar ── */}
          <div
            className={`px-3 sm:px-5 py-2 sm:py-2.5 flex items-center justify-between ${
              isDark ? "border-b border-white/[0.03]" : "border-b border-gray-50"
            }`}
          >
            <p
              className={`text-[11px] font-medium ${
                isDark ? "text-slate-500" : "text-gray-400"
              }`}
            >
              Top institutional-grade pairs · Click to swap
            </p>
            {totalTvl > 0 && (
              <div className="flex items-center gap-1.5">
                <TrendingUp
                  className={`w-3 h-3 ${
                    isDark ? "text-emerald-400/60" : "text-emerald-500/60"
                  }`}
                />
                <span
                  className={`text-[11px] font-bold tabular-nums ${
                    isDark ? "text-emerald-400/80" : "text-emerald-600"
                  }`}
                >
                  {formatUsdCompact(totalTvl)} TVL
                </span>
              </div>
            )}
          </div>

          {/* ── Grid ── */}
          <div className="px-3 sm:px-4 pt-3 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AnimatePresence mode="popLayout">
              {visiblePools.map((pool, i) => (
                <motion.div
                  key={pool.id}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 30,
                    delay: i * 0.03,
                  }}
                  layout
                >
                  <PairCard
                    pool={pool}
                    isDark={isDark}
                    isActive={
                      pool.id === activePoolId ||
                      (pool.tokenA.symbol === inputToken.symbol &&
                        pool.tokenB.symbol === outputToken.symbol) ||
                      (pool.tokenB.symbol === inputToken.symbol &&
                        pool.tokenA.symbol === outputToken.symbol) ||
                      (route?.pools?.some((p) => p.id === pool.id) ?? false)
                    }
                    onSelect={onSelectPair}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* ── Show More / Less ── */}
          {hasMore && (
            <div className="px-3 sm:px-4 pb-3">
              <button
                onClick={() => setShowAll(!showAll)}
                className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isDark
                    ? "text-slate-400 hover:text-white hover:bg-white/[0.04] border border-white/[0.04] hover:border-white/[0.08]"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50 border border-gray-100 hover:border-gray-200"
                }`}
              >
                <motion.div
                  animate={{ rotate: showAll ? 180 : 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </motion.div>
                {showAll
                  ? "Show less"
                  : `Show all ${curatedPools.length} pairs`}
              </button>
            </div>
          )}

          {/* ── Footer ── */}
          <div
            className={`px-3 sm:px-5 py-2 sm:py-2.5 border-t flex items-center justify-between text-[10px] ${
              isDark
                ? "border-white/[0.03] text-slate-600"
                : "border-gray-100 text-gray-400"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  poolsLoading
                    ? "bg-amber-400 animate-pulse"
                    : "bg-emerald-400"
                }`}
              />
              {poolsLoading ? "Refreshing..." : "Live"}
            </span>
            <span className="font-semibold">
              {curatedPools.length} pairs
            </span>
            <span>Powered by SaucerSwap</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ PAIR CARD ═══ */

function PairCard({
  pool,
  isDark,
  isActive,
  onSelect,
}: {
  pool: PoolRoute;
  isDark: boolean;
  isActive: boolean;
  onSelect: (pool: PoolRoute) => void;
}) {
  /* Accent color per token pair category */
  const accent = useMemo(() => {
    const syms = [pool.tokenA.symbol, pool.tokenB.symbol];
    if (syms.includes("SAUCE")) return { color: "#f97316", label: "Ecosystem" };
    if (syms.includes("WBTC") || syms.includes("BTC.\u210F"))
      return { color: "#f59e0b", label: "Bitcoin" };
    if (syms.includes("WETH")) return { color: "#8b5cf6", label: "Ethereum" };
    if (syms.includes("USDC") && syms.includes("USDT"))
      return { color: "#06b6d4", label: "Stableswap" };
    if (syms.includes("HBARX"))
      return { color: "#10b981", label: "Staking" };
    if (syms.includes("LINK")) return { color: "#2563eb", label: "Oracle" };
    if (syms.includes("AAVE")) return { color: "#9333ea", label: "DeFi" };
    if (syms.includes("WPOL") || syms.includes("WBNB"))
      return { color: "#0ea5e9", label: "Cross-chain" };
    return { color: "#1D63ED", label: "" };
  }, [pool.tokenA.symbol, pool.tokenB.symbol]);

  const hasWrapped = pool.tokenA.isWrapped || pool.tokenB.isWrapped;
  const bridgeLabel = pool.tokenA.bridge || pool.tokenB.bridge;

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(pool)}
      whileTap={{ scale: 0.97 }}
      className={`relative w-full text-left rounded-xl px-3.5 py-3 transition-all duration-200 cursor-pointer group overflow-hidden ${
        isActive
          ? isDark
            ? "bg-blue-500/[0.08] border border-blue-500/25 ring-1 ring-blue-500/10 shadow-[0_0_20px_rgba(29,99,237,0.08)]"
            : "bg-blue-50/80 border border-blue-200 ring-1 ring-blue-100 shadow-sm"
          : isDark
          ? "bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.05] hover:border-white/[0.10]"
          : "bg-gray-50/50 border border-gray-100 hover:bg-gray-50 hover:border-gray-200"
      }`}
    >
      {/* Top accent bar — slides in on active / hover */}
      <div
        className="absolute top-0 left-0 h-[2px] transition-all duration-500 group-hover:w-full"
        style={{
          width: isActive ? "100%" : "0%",
          backgroundColor: accent.color,
        }}
      />

      {/* Shimmer overlay on active */}
      {isActive && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-xl">
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              background: `linear-gradient(90deg, transparent, ${accent.color}, transparent)`,
              animation: "qp-shimmer 3s ease-in-out infinite",
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className="relative flex items-center gap-3">
        {/* Token icons — overlapping pair */}
        <div className="flex -space-x-2 shrink-0">
          <TokenIcon
            src={pool.tokenA.logo}
            symbol={pool.tokenA.symbol}
            htsId={pool.tokenA.htsId}
            size="w-8 h-8"
            className={`ring-2 relative z-10 ${
              isDark ? "ring-[#0c0f1a]" : "ring-white"
            }`}
          />
          <TokenIcon
            src={pool.tokenB.logo}
            symbol={pool.tokenB.symbol}
            htsId={pool.tokenB.htsId}
            size="w-8 h-8"
            className={`ring-2 ${isDark ? "ring-[#0c0f1a]" : "ring-white"}`}
          />
        </div>

        {/* Pair info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`font-bold text-sm truncate ${
                isDark ? "text-white" : "text-slate-800"
              }`}
            >
              {pool.tokenA.symbol}
              <span className={isDark ? "text-slate-600" : "text-gray-300"}>
                {" / "}
              </span>
              {pool.tokenB.symbol}
            </span>
            {isActive && (
              <span
                className="text-[8px] px-1.5 py-0.5 rounded-full font-bold shrink-0"
                style={{
                  backgroundColor: `${accent.color}15`,
                  color: accent.color,
                  border: `1px solid ${accent.color}30`,
                }}
              >
                ACTIVE
              </span>
            )}
          </div>

          {/* Micro-badges row */}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {pool.source && (
              <span
                className={`text-[9px] font-bold px-1.5 py-px rounded ${
                  pool.source === "v2"
                    ? isDark
                      ? "bg-emerald-500/10 text-emerald-400/80 ring-1 ring-emerald-500/20"
                      : "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200"
                    : isDark
                    ? "bg-slate-700/40 text-slate-500"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {pool.source.toUpperCase()}
              </span>
            )}
            {hasWrapped && bridgeLabel && (
              <span
                className={`text-[9px] font-semibold px-1.5 py-px rounded ${
                  isDark
                    ? "bg-purple-500/10 text-purple-400/70 ring-1 ring-purple-500/15"
                    : "bg-purple-50 text-purple-500 ring-1 ring-purple-200"
                }`}
              >
                {bridgeLabel}
              </span>
            )}
            {pool.fee > 0 && (
              <span
                className={`text-[9px] tabular-nums ${
                  isDark ? "text-slate-600" : "text-gray-400"
                }`}
              >
                {pool.fee}%
              </span>
            )}
          </div>
        </div>

        {/* Stats column */}
        <div className="text-right shrink-0 hidden sm:flex flex-col items-end gap-0.5">
          {pool.tvlUsd > 0 && (
            <div className="flex items-center gap-1">
              <span
                className={`text-[9px] uppercase tracking-wider font-semibold ${
                  isDark ? "text-slate-600" : "text-gray-400"
                }`}
              >
                TVL
              </span>
              <span
                className={`text-xs font-bold tabular-nums ${
                  isDark ? "text-slate-300" : "text-gray-600"
                }`}
              >
                {formatUsdCompact(pool.tvlUsd)}
              </span>
            </div>
          )}
          {pool.apr > 0 && (
            <span
              className={`text-[10px] font-bold tabular-nums ${
                pool.apr > 50
                  ? "text-emerald-400"
                  : pool.apr > 10
                  ? isDark
                    ? "text-emerald-400/80"
                    : "text-emerald-600"
                  : isDark
                  ? "text-slate-500"
                  : "text-gray-500"
              }`}
            >
              {pool.apr.toFixed(1)}% APR
            </span>
          )}
        </div>
      </div>

      {/* Mobile stats row */}
      <div className="flex items-center gap-3 mt-1.5 sm:hidden">
        {pool.tvlUsd > 0 && (
          <span
            className={`text-[10px] font-semibold tabular-nums ${
              isDark ? "text-slate-500" : "text-gray-400"
            }`}
          >
            TVL {formatUsdCompact(pool.tvlUsd)}
          </span>
        )}
        {pool.apr > 0 && (
          <span className="text-[10px] text-emerald-400 font-semibold tabular-nums">
            {pool.apr.toFixed(1)}% APR
          </span>
        )}
      </div>
    </motion.button>
  );
}
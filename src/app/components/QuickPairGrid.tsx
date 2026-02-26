/**
 * QuickPairGrid — Curated "Quick Select" pair cards for the swap panel.
 *
 * 20 blue-chip pairs (no meme coins). Click any card to set the pair
 * in the swap panel. Click-only interaction — no hover auto-select,
 * so an in-progress swap session is never accidentally disrupted.
 *
 * Replaces the old Pool Routes table with a premium VIP card grid.
 */

import { useMemo } from "react";
import { motion } from "motion/react";
import { ExternalLink, RefreshCw, Zap } from "lucide-react";
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

const BLUE = "#1D63ED";

/* ── Helper: normalise pair key for matching ── */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("/");
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

  /* ── Build the curated display list from live pool data ── */
  const curatedPools = useMemo(() => {
    const poolMap = new Map<string, PoolRoute>();
    for (const pool of allPools) {
      const key = pairKey(pool.tokenA.symbol, pool.tokenB.symbol);
      const existing = poolMap.get(key);
      // Keep the one with higher TVL (prefer V2 over V1 when available)
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

  return (
    <div
      className={`rounded-2xl overflow-hidden ${
        isDark
          ? "bg-[#0c0f1a]/95 backdrop-blur-xl border border-white/[0.04]"
          : "bg-white/95 backdrop-blur-xl border border-gray-200 shadow-xl"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <Zap
            className={`w-4.5 h-4.5 ${isDark ? "text-blue-400" : "text-blue-600"}`}
          />
          <h3
            className={`font-extrabold tracking-tight ${
              isDark ? "text-white" : "text-slate-900"
            }`}
          >
            Quick Select
          </h3>
          {poolsLoading ? (
            <RefreshCw className="w-3 h-3 text-blue-400 animate-spin" />
          ) : (
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                isDark
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <a
          href="https://www.saucerswap.finance/swap"
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
            isDark
              ? "text-blue-400 hover:text-blue-300"
              : "text-blue-600 hover:text-blue-500"
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
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Subtitle */}
      <div className="px-5 pb-3">
        <p
          className={`text-[11px] leading-relaxed ${
            isDark ? "text-slate-500" : "text-gray-400"
          }`}
        >
          Top institutional-grade pairs. Click to swap.
        </p>
      </div>

      {/* Grid */}
      <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {curatedPools.map((pool) => (
          <PairCard
            key={pool.id}
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
        ))}
      </div>

      {/* Footer */}
      <div
        className={`px-5 py-3 border-t flex items-center justify-between text-[11px] flex-wrap gap-2 ${
          isDark
            ? "border-white/[0.03] text-slate-600"
            : "border-gray-100 text-gray-400"
        }`}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              isDark ? "bg-blue-500/30" : "bg-blue-200"
            }`}
          />
          Blue-chip pairs only
        </span>
        <span className="font-medium">
          {curatedPools.length} pairs
        </span>
        <span>Powered by SaucerSwap</span>
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
  /* accent color per token pair category */
  const accent = useMemo(() => {
    const syms = [pool.tokenA.symbol, pool.tokenB.symbol];
    if (syms.includes("SAUCE")) return "#f97316"; // orange
    if (syms.includes("WBTC") || syms.includes("BTC.\u210F")) return "#f59e0b"; // amber
    if (syms.includes("WETH")) return "#8b5cf6"; // violet
    if (syms.includes("USDC") && syms.includes("USDT")) return "#06b6d4"; // cyan (stableswap)
    if (syms.includes("HBARX")) return "#10b981"; // emerald (staking)
    if (syms.includes("LINK")) return "#2563eb"; // blue
    return BLUE;
  }, [pool.tokenA.symbol, pool.tokenB.symbol]);

  const hasWrapped = pool.tokenA.isWrapped || pool.tokenB.isWrapped;
  const bridgeLabel = pool.tokenA.bridge || pool.tokenB.bridge;

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(pool)}
      whileTap={{ scale: 0.97 }}
      className={`relative w-full text-left rounded-xl px-3.5 py-3 transition-all duration-300 cursor-pointer group overflow-hidden ${
        isActive
          ? isDark
            ? "bg-blue-500/[0.08] border border-blue-500/20 ring-1 ring-blue-500/10"
            : "bg-blue-50 border border-blue-200 ring-1 ring-blue-100"
          : isDark
          ? "bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] hover:border-white/[0.08]"
          : "bg-gray-50/50 border border-gray-100 hover:bg-gray-50 hover:border-gray-200"
      }`}
    >
      {/* Top accent bar — shown on active card */}
      <div
        className="absolute top-0 left-0 h-[2px] transition-all duration-500"
        style={{
          width: isActive ? "100%" : "0%",
          backgroundColor: accent,
        }}
      />

      {/* Content */}
      <div className="flex items-center gap-3">
        {/* Token icons */}
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
          <div className="flex items-center gap-2">
            <span
              className={`font-bold text-sm truncate ${
                isDark ? "text-white" : "text-slate-800"
              }`}
            >
              {pool.tokenA.symbol}
              <span className={isDark ? "text-slate-500" : "text-gray-400"}>
                {" / "}
              </span>
              {pool.tokenB.symbol}
            </span>
            {isActive && (
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${
                  isDark
                    ? "bg-blue-500/15 text-blue-400 border border-blue-500/20"
                    : "bg-blue-50 text-blue-600 border border-blue-200"
                }`}
              >
                Active
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {hasWrapped && bridgeLabel && (
              <span
                className={`text-[9px] font-semibold ${
                  isDark ? "text-purple-400/60" : "text-purple-400"
                }`}
              >
                {bridgeLabel}
              </span>
            )}
            {pool.source && (
              <span
                className={`text-[9px] font-bold px-1 py-px rounded ${
                  pool.source === "v2"
                    ? isDark
                      ? "bg-emerald-500/10 text-emerald-400/70"
                      : "bg-emerald-50 text-emerald-600"
                    : isDark
                    ? "bg-slate-700/30 text-slate-500"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {pool.source.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="text-right shrink-0 hidden sm:block">
          <div className="flex items-center gap-3">
            {pool.tvlUsd > 0 && (
              <div>
                <div
                  className={`text-[9px] uppercase tracking-wider font-semibold ${
                    isDark ? "text-slate-600" : "text-gray-400"
                  }`}
                >
                  TVL
                </div>
                <div
                  className={`text-xs font-bold tabular-nums ${
                    isDark ? "text-slate-300" : "text-gray-600"
                  }`}
                >
                  {formatUsdCompact(pool.tvlUsd)}
                </div>
              </div>
            )}
            <div>
              <div
                className={`text-[9px] uppercase tracking-wider font-semibold ${
                  isDark ? "text-slate-600" : "text-gray-400"
                }`}
              >
                Fee
              </div>
              <div
                className={`text-xs font-bold tabular-nums ${
                  isDark ? "text-slate-400" : "text-gray-500"
                }`}
              >
                {pool.fee}%
              </div>
            </div>
            {pool.apr > 0 && (
              <div>
                <div
                  className={`text-[9px] uppercase tracking-wider font-semibold ${
                    isDark ? "text-slate-600" : "text-gray-400"
                  }`}
                >
                  APR
                </div>
                <div
                  className={`text-xs font-bold tabular-nums ${
                    pool.apr > 50
                      ? "text-emerald-400"
                      : pool.apr > 10
                      ? isDark
                        ? "text-emerald-400/80"
                        : "text-emerald-600"
                      : isDark
                      ? "text-slate-400"
                      : "text-gray-500"
                  }`}
                >
                  {pool.apr.toFixed(1)}%
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile stats row */}
      <div className="flex items-center gap-3 mt-2 sm:hidden">
        {pool.tvlUsd > 0 && (
          <span
            className={`text-[10px] font-semibold ${
              isDark ? "text-slate-500" : "text-gray-400"
            }`}
          >
            TVL {formatUsdCompact(pool.tvlUsd)}
          </span>
        )}
        <span
          className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}
        >
          Fee {pool.fee}%
        </span>
        {pool.apr > 0 && (
          <span className="text-[10px] text-emerald-400 font-semibold">
            APR {pool.apr.toFixed(1)}%
          </span>
        )}
      </div>
    </motion.button>
  );
}
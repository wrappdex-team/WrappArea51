/**
 * SwapRouteViz — Compact pill-based route visualization.
 *
 * SESSION 5 redesign:
 * - Single-line horizontal flow: token → fee → token → fee → token
 * - Tiny token pills (16px icons, tight padding)
 * - Micro fee/version badges between arrows
 * - Animated gradient flow line connecting all tokens
 * - "Route" label as inline prefix with hop badge
 * - On-chain detected badge inline
 * - Minimal vertical footprint
 */

import { memo } from "react";
import { motion } from "motion/react";
import { ChevronRight, Globe, Zap } from "lucide-react";
import { TokenIcon } from "./TokenIcon";
import type { AllowedToken, PoolRoute } from "../utils/saucerswap";

interface SwapRouteVizProps {
  route: {
    path: AllowedToken[];
    pools: PoolRoute[];
    totalFee: number;
    onChain?: boolean;
  };
  isDark: boolean;
}

export const SwapRouteViz = memo(function SwapRouteViz({ route, isDark }: SwapRouteVizProps) {
  const hopCount = route.pools.length;
  const isDirect = hopCount === 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`mt-3 px-3 py-2.5 rounded-xl relative overflow-hidden ${
        isDark
          ? "bg-slate-800/30 border border-white/[0.04]"
          : "bg-gray-50/80 border border-gray-100"
      }`}
    >
      {/* Animated flow gradient — subtle left-to-right sweep */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: isDark
            ? "linear-gradient(90deg, transparent 0%, rgba(236,72,153,0.08) 30%, rgba(139,92,246,0.06) 70%, transparent 100%)"
            : "linear-gradient(90deg, transparent 0%, rgba(236,72,153,0.04) 30%, rgba(139,92,246,0.03) 70%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "routeFlow 4s ease-in-out infinite",
        }}
      />

      {/* Route content — single line */}
      <div className="relative flex items-center gap-1.5 flex-wrap overflow-x-auto scrollbar-none">
        {/* Route label pill */}
        <div className={`flex items-center gap-1 shrink-0 mr-0.5`}>
          <Zap className={`w-2.5 h-2.5 ${
            isDirect
              ? isDark ? "text-emerald-400" : "text-emerald-500"
              : isDark ? "text-purple-400" : "text-purple-500"
          }`} />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${
            isDark ? "text-slate-500" : "text-gray-400"
          }`}>
            {isDirect ? "Direct" : `${hopCount}-hop`}
          </span>
          {route.onChain && (
            <span className={`inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded font-semibold ${
              isDark
                ? "bg-cyan-500/10 text-cyan-400"
                : "bg-cyan-50 text-cyan-600"
            }`}>
              <Globe className="w-2 h-2" />
              live
            </span>
          )}
        </div>

        {/* Token path pills */}
        {route.path.map((token, idx) => (
          <div key={token.symbol + idx} className="flex items-center gap-1">
            {/* Token pill */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.06, duration: 0.15 }}
              className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-lg ${
                isDark ? "bg-slate-700/50" : "bg-white/80"
              }`}
            >
              <TokenIcon
                src={token.logo}
                symbol={token.symbol}
                htsId={token.htsId}
                size="w-4 h-4"
              />
              <span className={`text-[11px] font-bold leading-none ${
                isDark ? "text-white" : "text-slate-800"
              }`}>
                {token.symbol}
              </span>
            </motion.div>

            {/* Fee connector between tokens */}
            {idx < route.path.length - 1 && (
              <motion.div
                initial={{ opacity: 0, x: -3 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.06 + 0.03, duration: 0.15 }}
                className="flex items-center gap-px"
              >
                {/* Version + fee micro badge */}
                <span className={`text-[9px] font-bold leading-none ${
                  route.pools[idx]?.source === "v2"
                    ? isDark ? "text-purple-400/70" : "text-purple-500/70"
                    : isDark ? "text-emerald-400/60" : "text-emerald-500/60"
                }`}>
                  {route.pools[idx]?.source?.toUpperCase()}
                </span>
                <span className={`text-[9px] font-medium leading-none mx-px ${
                  isDark ? "text-slate-600" : "text-gray-300"
                }`}>
                  {route.pools[idx]?.fee !== undefined ? `${route.pools[idx].fee}%` : ""}
                </span>
                <ChevronRight className={`w-3 h-3 -mx-0.5 ${
                  isDark ? "text-pink-400/40" : "text-pink-400/50"
                }`} />
              </motion.div>
            )}
          </div>
        ))}

        {/* Total fee — only show for multi-hop */}
        {!isDirect && (
          <span className={`ml-auto text-[9px] font-medium shrink-0 ${
            isDark ? "text-slate-600" : "text-gray-300"
          }`}>
            {route.totalFee}% total
          </span>
        )}
      </div>

      {/* Keyframe for route flow animation */}
      <style>{`
        @keyframes routeFlow {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </motion.div>
  );
});
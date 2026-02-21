/**
 * SwapRouteViz — Premium animated swap route visualization.
 *
 * Shows the token-to-token swap path with:
 * - Animated connecting lines between hops
 * - Pool version badges (V1 / V2)
 * - Fee tier at each hop
 * - On-chain detected badge for dynamic routes
 * - Smooth entrance animation
 */

import { memo } from "react";
import { motion } from "motion/react";
import { ArrowRight, Zap, Globe } from "lucide-react";
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`mt-4 rounded-xl overflow-hidden ${
        isDark
          ? "bg-gradient-to-r from-slate-800/40 via-slate-800/20 to-slate-800/40 border border-white/[0.04]"
          : "bg-gradient-to-r from-gray-50 via-white to-gray-50 border border-gray-100"
      }`}
    >
      {/* Route header */}
      <div className={`flex items-center justify-between px-3.5 pt-3 pb-2`}>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${
            isDark ? "bg-emerald-400" : "bg-emerald-500"
          } animate-pulse`} />
          <span className={`text-[11px] font-semibold tracking-wide uppercase ${
            isDark ? "text-slate-400" : "text-gray-500"
          }`}>
            Route
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {route.onChain && (
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              isDark
                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                : "bg-cyan-50 text-cyan-700 border border-cyan-200"
            }`}>
              <Globe className="w-2.5 h-2.5" />
              On-chain
            </span>
          )}
          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            isDirect
              ? isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : isDark ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" : "bg-purple-50 text-purple-700 border border-purple-200"
          }`}>
            <Zap className="w-2.5 h-2.5" />
            {isDirect ? "Direct" : `${hopCount}-hop`}
          </span>
        </div>
      </div>

      {/* Route path */}
      <div className="px-3.5 pb-3">
        <div className="flex items-center gap-1 flex-wrap">
          {route.path.map((token, idx) => (
            <div key={token.symbol + idx} className="flex items-center gap-1">
              {/* Token node */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1, duration: 0.2 }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${
                  isDark ? "bg-slate-700/50" : "bg-gray-100/80"
                }`}
              >
                <TokenIcon src={token.logo} symbol={token.symbol} size="w-5 h-5" />
                <span className={`text-xs font-bold ${
                  isDark ? "text-white" : "text-slate-800"
                }`}>
                  {token.symbol}
                </span>
              </motion.div>

              {/* Arrow + fee between nodes */}
              {idx < route.path.length - 1 && (
                <motion.div
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 + 0.05, duration: 0.2 }}
                  className="flex items-center gap-0.5"
                >
                  <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md ${
                    isDark ? "bg-slate-700/30" : "bg-gray-50"
                  }`}>
                    {route.pools[idx]?.source && (
                      <span className={`text-[9px] font-bold uppercase ${
                        route.pools[idx]?.source === "v2"
                          ? isDark ? "text-purple-400" : "text-purple-600"
                          : isDark ? "text-emerald-400" : "text-emerald-600"
                      }`}>
                        {route.pools[idx]?.source}
                      </span>
                    )}
                    <span className={`text-[10px] font-medium ${
                      isDark ? "text-slate-500" : "text-gray-400"
                    }`}>
                      {route.pools[idx]?.fee}%
                    </span>
                  </div>
                  <ArrowRight className={`w-3 h-3 ${
                    isDark ? "text-pink-400/60" : "text-pink-500/60"
                  }`} />
                </motion.div>
              )}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
});

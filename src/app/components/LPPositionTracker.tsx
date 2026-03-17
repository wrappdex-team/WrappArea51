/**
 * LPPositionTracker — Atomic Pool LP Position Dashboard
 *
 * SECURITY AUDIT PEN-06/07/08 (2026-03-17): READ-ONLY display.
 * Reads LP balances from Mirror Node (public chain data). Add/Remove
 * modals use atomic-swap-client.ts (authenticated). SAFE.
 *
 * Displays the user's LP token holdings across all deployed atomic pools.
 * Reads positions directly from Mirror Node via fetchAllUserLPPositions()
 * — no server dependency, no KV. Share-of-pool and estimated token amounts
 * are derived from on-chain reserves (ground truth).
 *
 * NOTE [C7-02]:
 *   Each LP "position" is simply the user's HTS balance of the pool's LP
 *   token. The share-of-pool percentage and estimated token amounts are
 *   computed from current reserves using the same burn math as the Remove
 *   Liquidity flow. Positions update on a 30s polling interval — fast
 *   enough for a dashboard, slow enough to avoid Mirror Node rate limits.
 *
 * NOTE [C7-03]:
 *   This component is intentionally read-only. All mutation actions
 *   (add/remove liquidity) are handled by their respective modals.
 *   The tracker only provides navigation entry points to those modals.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Wallet,
  Droplets,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Minus,
  ExternalLink,
  TrendingUp,
  PieChart,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useWallet } from "../contexts/WalletContext";
import { playVipButtonChime } from "../utils/sounds";
import {
  fetchAllUserLPPositions,
  type LPPosition,
} from "../utils/atomic-swap-client";
import {
  POOL_BY_ID,
  TOKEN_BY_SYMBOL,
  fetchOraclePrices,
} from "../utils/atomic-swap-engine";
import { AddLiquidityModal } from "./AddLiquidityModal";
import { RemoveLiquidityModal } from "./RemoveLiquidityModal";
import { displaySymbol } from "../utils/display-symbol";

// [C66] displaySymbol() centralized — canonical copy in ../utils/display-symbol.ts

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

// ── Formatters ──────────────────────────────────────────────────────

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function formatTokenAmount(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toFixed(8);
}

// ── Position Card ───────────────────────────────────────────────────

function PositionCard({
  position,
  isDark,
  prices,
  onAddLiquidity,
  onRemoveLiquidity,
}: {
  position: LPPosition;
  isDark: boolean;
  prices: Record<string, number>;
  onAddLiquidity: (poolId: string) => void;
  onRemoveLiquidity: (poolId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pool = POOL_BY_ID.get(position.poolId);
  const tokenA = pool ? TOKEN_BY_SYMBOL.get(pool.tokenA) : null;
  const tokenB = pool ? TOKEN_BY_SYMBOL.get(pool.tokenB) : null;

  const valueUsd = (() => {
    if (!tokenA || !tokenB) return 0;
    const pA = prices[tokenA.tokenId] || tokenA.fallbackPriceUsd;
    const pB = prices[tokenB.tokenId] || tokenB.fallbackPriceUsd;
    return parseFloat(position.estimatedAmountA) * pA + parseFloat(position.estimatedAmountB) * pB;
  })();

  if (!pool) return null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl overflow-hidden transition-colors ${
        isDark
          ? "bg-slate-900/40 border border-emerald-500/10 hover:border-emerald-500/25"
          : "bg-white border border-gray-100 shadow-sm hover:border-emerald-200"
      }`}
    >
      {/* Card header — always visible */}
      <div
        className="p-3 cursor-pointer"
        onClick={() => { setExpanded(!expanded); playVipButtonChime(); }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* Token pair logos */}
            <div className="flex -space-x-1.5">
              <img
                src={TOKEN_LOGOS[position.tokenA] || ""}
                alt={position.tokenA}
                className="w-7 h-7 rounded-full border-2 border-slate-900 relative z-10"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <img
                src={TOKEN_LOGOS[position.tokenB] || ""}
                alt={position.tokenB}
                className="w-7 h-7 rounded-full border-2 border-slate-900"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <div>
              <div className="font-bold text-sm">{displaySymbol(position.tokenA)}/{displaySymbol(position.tokenB)}</div>
              <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {position.shareOfPool < 0.01 ? "<0.01" : position.shareOfPool.toFixed(2)}% of pool
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className={`text-sm font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                {formatUsd(valueUsd)}
              </div>
              <div className={`text-[10px] font-mono ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {parseFloat(position.lpBalanceDisplay).toFixed(4)} LP
              </div>
            </div>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className={`px-3 pb-3 border-t ${isDark ? "border-emerald-500/10" : "border-gray-100"}`}>
              {/* Token breakdown */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className={`rounded-lg p-2 ${isDark ? "bg-slate-800/40" : "bg-gray-50"}`}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <img src={TOKEN_LOGOS[position.tokenA] || ""} alt={position.tokenA} className="w-3.5 h-3.5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{displaySymbol(position.tokenA)}</span>
                  </div>
                  <div className="text-xs font-bold font-mono">{formatTokenAmount(position.estimatedAmountA)}</div>
                  {tokenA && (
                    <div className={`text-[10px] font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                      ~{formatUsd(parseFloat(position.estimatedAmountA) * (prices[tokenA.tokenId] || tokenA.fallbackPriceUsd))}
                    </div>
                  )}
                </div>
                <div className={`rounded-lg p-2 ${isDark ? "bg-slate-800/40" : "bg-gray-50"}`}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <img src={TOKEN_LOGOS[position.tokenB] || ""} alt={position.tokenB} className="w-3.5 h-3.5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{displaySymbol(position.tokenB)}</span>
                  </div>
                  <div className="text-xs font-bold font-mono">{formatTokenAmount(position.estimatedAmountB)}</div>
                  {tokenB && (
                    <div className={`text-[10px] font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                      ~{formatUsd(parseFloat(position.estimatedAmountB) * (prices[tokenB.tokenId] || tokenB.fallbackPriceUsd))}
                    </div>
                  )}
                </div>
              </div>

              {/* Metadata row */}
              <div className={`mt-2 grid grid-cols-3 gap-1 text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                <div className={`rounded-lg p-1.5 text-center ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}>
                  <div>Pool Share</div>
                  <div className="font-bold font-mono">{position.shareOfPool < 0.01 ? "<0.01" : position.shareOfPool.toFixed(2)}%</div>
                </div>
                <div className={`rounded-lg p-1.5 text-center ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}>
                  <div>LP Tokens</div>
                  <div className="font-bold font-mono">{parseFloat(position.lpBalanceDisplay).toFixed(4)}</div>
                </div>
                <div className={`rounded-lg p-1.5 text-center ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}>
                  <div>Pool Fee</div>
                  <div className="font-bold font-mono">{pool.swapFeeBps ? `${(pool.swapFeeBps / 100).toFixed(2)}%` : "—"}</div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onAddLiquidity(position.poolId); }}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    isDark
                      ? "text-purple-400 bg-purple-500/[0.08] border border-purple-500/20 hover:border-purple-500/40"
                      : "text-purple-600 bg-purple-50 border border-purple-200 hover:border-purple-300"
                  }`}
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveLiquidity(position.poolId); }}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    isDark
                      ? "text-rose-400 bg-rose-500/[0.08] border border-rose-500/20 hover:border-rose-500/40"
                      : "text-rose-600 bg-rose-50 border border-rose-200 hover:border-rose-300"
                  }`}
                >
                  <Minus className="w-3 h-3" /> Remove
                </button>
                {pool.lpTokenId !== "PENDING" && (
                  <a
                    href={`https://hashscan.io/mainnet/token/${pool.lpTokenId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={`flex items-center justify-center px-2 py-1.5 rounded-lg text-[10px] border cursor-pointer transition-all ${
                      isDark ? "border-pink-500/10 text-slate-400 hover:text-white" : "border-gray-200 text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

interface LPPositionTrackerProps {
  isDark: boolean;
  /** Force a re-fetch (e.g., after add/remove liquidity) */
  refreshSignal?: number;
}

export function LPPositionTracker({ isDark, refreshSignal }: LPPositionTrackerProps) {
  const { hashPackSession } = useWallet();
  const accountId = hashPackSession?.accountId || null;

  const [positions, setPositions] = useState<LPPosition[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  // Modal state
  const [addModalPoolId, setAddModalPoolId] = useState<string | null>(null);
  const [removeModalPoolId, setRemoveModalPoolId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch positions ────────────────────────────────────────────────
  const fetchPositions = useCallback(async () => {
    if (!accountId) {
      setPositions([]);
      return;
    }

    setLoading(true);
    try {
      const [pos, p] = await Promise.all([
        fetchAllUserLPPositions(accountId),
        fetchOraclePrices(),
      ]);
      if (!mountedRef.current) return;
      setPositions(pos);
      setPrices(p);
      setLastFetchedAt(Date.now());
    } catch {
      // Non-critical — positions will show empty
    }
    if (mountedRef.current) setLoading(false);
  }, [accountId]);

  // Initial fetch + polling
  useEffect(() => {
    fetchPositions();
    const iv = setInterval(fetchPositions, 30_000);
    return () => clearInterval(iv);
  }, [fetchPositions]);

  // Re-fetch on external signal (e.g., after liquidity action)
  useEffect(() => {
    if (refreshSignal) fetchPositions();
  }, [refreshSignal, fetchPositions]);

  // ── Total portfolio value ──────────────────────────────────────────
  const totalValueUsd = positions.reduce((sum, pos) => {
    const tokenA = TOKEN_BY_SYMBOL.get(pos.tokenA);
    const tokenB = TOKEN_BY_SYMBOL.get(pos.tokenB);
    if (!tokenA || !tokenB) return sum;
    const pA = prices[tokenA.tokenId] || tokenA.fallbackPriceUsd;
    const pB = prices[tokenB.tokenId] || tokenB.fallbackPriceUsd;
    return sum + parseFloat(pos.estimatedAmountA) * pA + parseFloat(pos.estimatedAmountB) * pB;
  }, 0);

  // ── Modal handlers ─────────────────────────────────────────────────
  const handleModalSuccess = useCallback(() => {
    // Re-fetch positions after successful add/remove
    setTimeout(fetchPositions, 2000);
  }, [fetchPositions]);

  // Don't render section if wallet not connected
  if (!accountId) return null;

  return (
    <>
      <div className={`rounded-xl overflow-hidden ${
        isDark
          ? "bg-slate-900/20 border border-emerald-500/10"
          : "bg-white border border-gray-200"
      }`}>
        {/* Section header */}
        <div
          className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${
            isDark ? "hover:bg-slate-800/20" : "hover:bg-gray-50"
          }`}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2.5">
            <motion.div
              className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center"
              animate={{ boxShadow: expanded ? "0 0 15px rgba(16,185,129,0.3)" : "0 0 0px rgba(16,185,129,0)" }}
            >
              <Wallet className="w-4 h-4 text-white" />
            </motion.div>
            <div>
              <span className="font-bold text-sm">My LP Positions</span>
              <span className={`ml-2 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {positions.length} position{positions.length !== 1 ? "s" : ""}
                {totalValueUsd > 0 ? ` · ${formatUsd(totalValueUsd)}` : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); fetchPositions(); }}
              disabled={loading}
              className={`p-1.5 rounded-lg transition-colors ${
                isDark ? "hover:bg-slate-800/50 text-slate-500" : "hover:bg-gray-100 text-gray-400"
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3">
                {/* Portfolio summary bar */}
                {positions.length > 0 && (
                  <div className={`rounded-xl p-3 flex items-center justify-between ${
                    isDark
                      ? "bg-gradient-to-r from-emerald-500/[0.06] to-teal-500/[0.06] border border-emerald-500/10"
                      : "bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100"
                  }`}>
                    <div className="flex items-center gap-2">
                      <PieChart className={`w-4 h-4 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
                      <div>
                        <div className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-emerald-400/60" : "text-emerald-700/60"}`}>
                          Total LP Value
                        </div>
                        <div className={`text-lg font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                          {formatUsd(totalValueUsd)}
                        </div>
                      </div>
                    </div>
                    <div className={`text-right text-[10px] ${isDark ? "text-emerald-400/50" : "text-emerald-600/50"}`}>
                      <div>{positions.length} pool{positions.length !== 1 ? "s" : ""}</div>
                      {lastFetchedAt && (
                        <div>Updated {Math.round((Date.now() - lastFetchedAt) / 1000)}s ago</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Loading state */}
                {loading && positions.length === 0 && (
                  <div className="text-center py-8">
                    <Loader2 className={`w-5 h-5 mx-auto animate-spin ${isDark ? "text-emerald-400" : "text-emerald-500"}`} />
                    <p className={`mt-2 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Scanning LP positions...
                    </p>
                  </div>
                )}

                {/* Empty state */}
                {!loading && positions.length === 0 && (
                  <div className={`text-center py-8 rounded-xl ${isDark ? "bg-slate-900/30" : "bg-gray-50"}`}>
                    <Droplets className={`w-8 h-8 mx-auto mb-2 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                    <p className="font-bold text-sm mb-1">No LP Positions</p>
                    <p className={`text-xs mb-3 max-w-[260px] mx-auto ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      You don't hold LP tokens in any atomic pool. Add liquidity to start earning swap fees.
                    </p>
                    <button
                      onClick={() => setAddModalPoolId("ap-usdc-whbar")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:shadow-[0_0_15px_rgba(168,85,247,0.3)] cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Add Liquidity
                    </button>
                  </div>
                )}

                {/* Position cards */}
                {positions.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {positions.map((pos) => (
                      <PositionCard
                        key={pos.poolId}
                        position={pos}
                        isDark={isDark}
                        prices={prices}
                        onAddLiquidity={setAddModalPoolId}
                        onRemoveLiquidity={setRemoveModalPoolId}
                      />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {addModalPoolId && (
          <AddLiquidityModal
            isDark={isDark}
            initialPoolId={addModalPoolId}
            onClose={() => setAddModalPoolId(null)}
            onSuccess={handleModalSuccess}
          />
        )}
        {removeModalPoolId && (
          <RemoveLiquidityModal
            isDark={isDark}
            initialPoolId={removeModalPoolId}
            onClose={() => setRemoveModalPoolId(null)}
            onSuccess={handleModalSuccess}
          />
        )}
      </AnimatePresence>
    </>
  );
}
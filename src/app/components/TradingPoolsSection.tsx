/**
 * TradingPoolsSection — Pool Management below the chart
 *
 * SECURITY AUDIT PEN-06/07/08 (2026-03-17): UI DISPLAY ONLY.
 * Imports from smart-liquidity.ts (read-only pool data) and
 * atomic-swap-engine.ts (client-side math). No direct mutation calls.
 * Add/Remove liquidity modals delegate to atomic-swap-client.ts which
 * is fully authenticated (requireAuth + SEC-13/14/15). SAFE.
 *
 * Shows pool stats, pool cards, and pool creation — all integrated
 * into the unified Trading terminal with animations and glow effects.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  Droplets,
  Plus,
  RefreshCw,
  Search,
  ExternalLink,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useWallet } from "../contexts/WalletContext";
import { playVipButtonChime } from "../utils/sounds";
import {
  fetchPools,
  getPoolStats,
  refreshOracles,
  getLPPosition,
  formatUsd,
  formatFeeBps,
  displayReserve,
  WRAPPED_TOKENS,
  type PoolState,
  type PoolStats,
  type LPPosition,
} from "../utils/smart-liquidity";
import { log } from "../utils/logger";
import { AmmPrelaunchBanner } from "./AmmPrelaunchBanner";
import { AddLiquidityModal as AtomicLiquidityModal } from "./AddLiquidityModal";
import { findPoolForPair } from "../utils/atomic-swap-engine";
import { TokenIcon } from "./TokenIcon";
import { displaySymbol } from "../utils/display-symbol";
import { SAUCERSWAP_TOKENS, type AllowedToken } from "../utils/saucerswap";

// [C66] displaySymbol() centralized — canonical copy in ../utils/display-symbol.ts

// ── Token icon resolver: WRAPPED_TOKENS first, then SAUCERSWAP_TOKENS fallback ──
const _ssTokenBySymbol = new Map<string, AllowedToken>(
  SAUCERSWAP_TOKENS.map(t => [t.symbol, t])
);

function resolvePoolTokenIcon(symbol: string): { logo: string; htsId: string } | null {
  // Try WRAPPED_TOKENS first (has tokenId field)
  const wt = WRAPPED_TOKENS.find(t => t.symbol === symbol);
  if (wt) return { logo: wt.logo, htsId: wt.tokenId };
  // Fall back to main SAUCERSWAP_TOKENS registry
  const st = _ssTokenBySymbol.get(symbol);
  if (st) return { logo: st.logo, htsId: st.htsId };
  return null;
}

// ── Stat Card ───────────────────────────────────────────────────────

function StatCard({ label, value, isDark, accent }: { label: string; value: string; isDark: boolean; accent?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl p-3 text-center relative overflow-hidden ${
        isDark ? "bg-slate-900/40 border border-white/[0.06]" : "bg-white border border-gray-100 shadow-sm"
      }`}
    >
      {accent && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(to bottom right, var(--accent-stat-from, rgba(236,72,153,0.05)), var(--accent-stat-to, rgba(168,85,247,0.05)))" }}
        />
      )}
      <div className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>{label}</div>
      <div className={`text-lg font-bold mt-0.5 relative ${isDark ? "text-white" : "text-gray-900"}`}>{value}</div>
    </motion.div>
  );
}

// ── Create Pool Modal ───────────────────────────────────────────────

// ┌─────────────────────────────────────────────────────────────────────┐
// │  IMPLEMENTATION NOTE — PRE-LAUNCH LOCK                             │
// │  The CreatePoolModal currently shows only AmmPrelaunchBanner.      │
// │  When AMM_PRELAUNCH_LOCKED is flipped to false in atomic-signer,  │
// │  restore the original form body and remove the banner import.      │
// └─────────────────────────────────────────────────────────────────────┘
function CreatePoolModal({ isDark, accountId, onClose, onCreated }: {
  isDark: boolean; accountId: string; onClose: () => void; onCreated: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`relative w-full max-w-md mx-4 rounded-2xl p-6 ${isDark ? "bg-[#12121a] border border-pink-500/30" : "bg-white border border-gray-200 shadow-2xl"}`}
      >
        <AmmPrelaunchBanner isDark={isDark} onClose={onClose} />
      </motion.div>
    </div>
  );
}

// ── Add Liquidity Modal ─────────────────────────────────────────────

// ┌─────────────────────────────────────────────────────────────────────┐
// │  IMPLEMENTATION NOTE — ATOMIC LIQUIDITY INTEGRATION                │
// │  When a user clicks "Add Liquidity" on a legacy KV pool card,     │
// │  we attempt to resolve the matching atomic pool by token pair.     │
// │  If found, we open the full AtomicLiquidityModal. If no matching  │
// │  atomic pool exists, we fall back to AmmPrelaunchBanner.          │
// └─────────────────────────────────────────────────────────────────────┘
function AddLiquidityModal({ pool, isDark, accountId, onClose, onDone }: {
  pool: PoolState; isDark: boolean; accountId: string; onClose: () => void; onDone: () => void;
}) {
  // Resolve legacy KV pool → atomic pool by token pair
  const atomicPool = findPoolForPair(pool.tokenA, pool.tokenB);

  if (atomicPool) {
    return (
      <AtomicLiquidityModal
        isDark={isDark}
        initialPoolId={atomicPool.poolId}
        onClose={onClose}
        onSuccess={onDone}
      />
    );
  }

  // Fallback: no matching atomic pool
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`relative w-full max-w-md mx-4 rounded-2xl p-6 ${isDark ? "bg-[#12121a] border border-pink-500/30" : "bg-white border border-gray-200 shadow-2xl"}`}
      >
        <AmmPrelaunchBanner isDark={isDark} onClose={onClose} />
      </motion.div>
    </div>
  );
}

// ── Pool Card ───────────────────────────────────────────────────────

function PoolCard({ pool, isDark, accountId, onAddLiquidity }: {
  pool: PoolState; isDark: boolean; accountId: string | null; onAddLiquidity: (p: PoolState) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<LPPosition | null>(null);

  useEffect(() => {
    if (accountId && expanded) {
      getLPPosition(pool.id, accountId).then(setPosition);
    }
  }, [accountId, expanded, pool.id]);

  const isEmpty = pool.reserveA === "0" && pool.reserveB === "0";
  const seedA = resolvePoolTokenIcon(pool.tokenA);
  const seedB = resolvePoolTokenIcon(pool.tokenB);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl overflow-hidden ${isDark ? "bg-slate-900/40 border border-pink-500/10 hover:border-pink-500/25" : "bg-white border border-gray-100 shadow-sm hover:border-pink-200"} transition-colors`}
    >
      <div className="p-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex -space-x-1.5">
              {seedA
                ? <TokenIcon src={seedA.logo} symbol={pool.tokenA} htsId={seedA.htsId} size="w-7 h-7" className="border-2 border-slate-900 relative z-10" />
                : <TokenIcon src="" symbol={pool.tokenA} size="w-7 h-7" className="border-2 border-slate-900 relative z-10" />
              }
              {seedB
                ? <TokenIcon src={seedB.logo} symbol={pool.tokenB} htsId={seedB.htsId} size="w-7 h-7" className="border-2 border-slate-900" />
                : <TokenIcon src="" symbol={pool.tokenB} size="w-7 h-7" className="border-2 border-slate-900" />
              }
            </div>
            <div>
              <div className="font-bold text-sm">{displaySymbol(pool.tokenA)}/{displaySymbol(pool.tokenB)}</div>
              <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Fee: {formatFeeBps(pool.swapFeeBps)} &middot; {pool.swapCount} swaps
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-sm font-bold">{formatUsd(pool.tvlUsd || 0)}</div>
              <div className={`text-[10px] ${isEmpty ? (isDark ? "text-amber-400" : "text-amber-600") : (isDark ? "text-emerald-400" : "text-emerald-600")}`}>
                {isEmpty ? "Empty" : "Active"}
              </div>
            </div>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className={`px-3 pb-3 border-t ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className={`rounded-lg p-2 ${isDark ? "bg-slate-800/40" : "bg-gray-50"}`}>
                  <div className={`text-[10px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{displaySymbol(pool.tokenA)}</div>
                  <div className="text-xs font-bold">{displayReserve(pool.reserveA, pool.decimalsA)}</div>
                </div>
                <div className={`rounded-lg p-2 ${isDark ? "bg-slate-800/40" : "bg-gray-50"}`}>
                  <div className={`text-[10px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{displaySymbol(pool.tokenB)}</div>
                  <div className="text-xs font-bold">{displayReserve(pool.reserveB, pool.decimalsB)}</div>
                </div>
              </div>

              {position && BigInt(position.shares) > 0n && (
                <div className={`mt-2 rounded-lg p-2 ${isDark ? "bg-emerald-900/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"}`}>
                  <div className={`text-[10px] font-bold ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>Your LP: {position.shares} shares</div>
                </div>
              )}

              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => onAddLiquidity(pool)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-pink-500 to-purple-500 hover:shadow-[0_0_15px_rgba(236,72,153,0.3)]"
                >
                  <Droplets className="w-3 h-3" /> Add Liquidity
                </button>
                <a
                  href={`https://hashscan.io/mainnet/token/${pool.tokenIdA}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] border ${isDark ? "border-pink-500/10 text-slate-400 hover:text-white" : "border-gray-200 text-gray-500 hover:text-gray-900"}`}
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Pools Section ─────────────────────────────────────────────

interface TradingPoolsSectionProps {
  isDark: boolean;
}

export function TradingPoolsSection({ isDark }: TradingPoolsSectionProps) {
  const { hashPackSession } = useWallet();
  const accountId = hashPackSession?.accountId || null;

  const [pools, setPools] = useState<PoolState[]>([]);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [oracleRefreshing, setOracleRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [liquidityPool, setLiquidityPool] = useState<PoolState | null>(null);
  const [expanded, setExpanded] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [poolData, statsData] = await Promise.all([fetchPools(), getPoolStats()]);
      setPools(poolData);
      setStats(statsData);
    } catch (err) {
      log.debug("Pools", "Load failed", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); const iv = setInterval(loadData, 30000); return () => clearInterval(iv); }, [loadData]);

  const handleOracleRefresh = useCallback(async () => {
    setOracleRefreshing(true);
    await refreshOracles();
    await loadData();
    setOracleRefreshing(false);
  }, [loadData]);

  const filteredPools = useMemo(() => {
    if (!search) return pools;
    const q = search.toLowerCase();
    return pools.filter(p => p.name.toLowerCase().includes(q) || p.tokenA.toLowerCase().includes(q) || p.tokenB.toLowerCase().includes(q));
  }, [pools, search]);

  const inputClass = isDark ? "bg-slate-800/50 border border-pink-500/10" : "bg-gray-50 border border-gray-200";

  return (
    <div className={`rounded-b-xl overflow-hidden ${isDark ? "bg-slate-900/20 border border-t-0 border-pink-500/20" : "bg-white border border-t-0 border-gray-200"}`}>
      {/* Section header */}
      <div
        className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${isDark ? "hover:bg-slate-800/20" : "hover:bg-gray-50"}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <motion.div
            className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"
            animate={{ boxShadow: expanded ? "0 0 15px rgba(168,85,247,0.3)" : "0 0 0px rgba(168,85,247,0)" }}
          >
            <Layers className="w-4 h-4 text-white" />
          </motion.div>
          <div>
            <span className="font-bold text-sm">Liquidity Pools</span>
            <span className={`ml-2 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {pools.length} pools &middot; {stats ? formatUsd(stats.totalTvlUsd) : "..."} TVL
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {accountId && (
            <motion.button
              onClick={(e) => { e.stopPropagation(); setShowCreateModal(true); playVipButtonChime(); }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]"
            >
              <Plus className="w-3 h-3" /> Create Pool
            </motion.button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleOracleRefresh(); }}
            disabled={oracleRefreshing}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800/50 text-slate-500" : "hover:bg-gray-100 text-gray-400"}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${oracleRefreshing ? "animate-spin" : ""}`} />
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
              {/* Stats row */}
              {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatCard label="Pools" value={stats.totalPools.toString()} isDark={isDark} />
                  <StatCard label="Total TVL" value={formatUsd(stats.totalTvlUsd)} isDark={isDark} accent />
                  <StatCard label="Volume" value={formatUsd(stats.totalVolumeUsd)} isDark={isDark} />
                  <StatCard label="Avg Fee" value={formatFeeBps(stats.avgFeeBps)} isDark={isDark} />
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                <input
                  type="text"
                  placeholder="Search pools..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className={`w-full pl-9 pr-4 py-2 rounded-xl text-xs outline-none ${inputClass}`}
                />
              </div>

              {/* Pool cards */}
              {loading ? (
                <div className="text-center py-8">
                  <RefreshCw className={`w-5 h-5 mx-auto animate-spin ${isDark ? "text-pink-400" : "text-pink-500"}`} />
                  <p className={`mt-2 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading pools...</p>
                </div>
              ) : filteredPools.length === 0 ? (
                <div className={`text-center py-8 rounded-xl ${isDark ? "bg-slate-900/30" : "bg-gray-50"}`}>
                  <Droplets className={`w-8 h-8 mx-auto mb-2 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                  <p className="font-bold text-sm mb-1">No Pools Yet</p>
                  <p className={`text-xs mb-3 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Create the first pool to start trading
                  </p>
                  {accountId && (
                    <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-pink-500 to-purple-500">
                      <Plus className="w-3 h-3" /> Create Pool
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {filteredPools.map(pool => (
                    <PoolCard
                      key={pool.id}
                      pool={pool}
                      isDark={isDark}
                      accountId={accountId}
                      onAddLiquidity={setLiquidityPool}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      {showCreateModal && accountId && (
        <CreatePoolModal isDark={isDark} accountId={accountId} onClose={() => setShowCreateModal(false)} onCreated={loadData} />
      )}
      {liquidityPool && accountId && (
        <AddLiquidityModal pool={liquidityPool} isDark={isDark} accountId={accountId} onClose={() => setLiquidityPool(null)} onDone={loadData} />
      )}
    </div>
  );
}
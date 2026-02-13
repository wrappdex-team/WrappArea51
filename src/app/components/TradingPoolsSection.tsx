/**
 * TradingPoolsSection — Pool Management below the chart
 *
 * Shows pool stats, pool cards, and pool creation — all integrated
 * into the unified Trading terminal with animations and glow effects.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  Droplets,
  Plus,
  RefreshCw,
  Search,
  X,
  AlertCircle,
  ExternalLink,
  Info,
  Zap,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useWallet } from "../contexts/WalletContext";
import { authenticate, clearSession } from "../utils/auth";
import { playVipConfirm, playVipButtonChime } from "../utils/sounds";
import {
  fetchPools,
  getPoolStats,
  refreshOracles,
  createPool,
  addLiquidity,
  getLPPosition,
  formatUsd,
  formatFeeBps,
  displayReserve,
  WRAPPED_TOKENS,
  type PoolState,
  type PoolStats,
  type LPPosition,
} from "../utils/smart-liquidity";

// ── Stat Card ───────────────────────────────────────────────────────

function StatCard({ label, value, isDark, accent }: { label: string; value: string; isDark: boolean; accent?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl p-3 text-center relative overflow-hidden ${
        isDark ? "bg-slate-900/40 border border-pink-500/10" : "bg-white border border-gray-100 shadow-sm"
      }`}
    >
      {accent && (
        <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-purple-500/5 pointer-events-none" />
      )}
      <div className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </motion.div>
  );
}

// ── Create Pool Modal ───────────────────────────────────────────────

function CreatePoolModal({ isDark, accountId, onClose, onCreated }: {
  isDark: boolean; accountId: string; onClose: () => void; onCreated: () => void;
}) {
  const tokens = WRAPPED_TOKENS;
  const [tokenAIdx, setTokenAIdx] = useState(0);
  const [tokenBIdx, setTokenBIdx] = useState(2);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (tokenAIdx === tokenBIdx) { setError("Select different tokens"); return; }
    setStatus("creating");
    setError("");
    try {
      await authenticate(accountId);
      const result = await createPool(tokens[tokenAIdx].symbol, tokens[tokenBIdx].symbol, 10, accountId, name || undefined);
      if (result.success) {
        setStatus("done");
        playVipConfirm();
        toast.success("Pool created successfully!");
        onCreated();
        setTimeout(onClose, 1500);
      } else {
        setError(result.error || "Failed");
        setStatus("error");
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
      setStatus("error");
    }
  };

  const inputClass = isDark ? "bg-slate-800/50 border border-pink-500/10" : "bg-gray-50 border border-gray-200";

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
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
              <Plus className="w-4 h-4 text-white" />
            </div>
            <h3 className="font-bold text-lg">Create Pool</h3>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className={`rounded-xl p-3 mb-4 text-xs ${isDark ? "bg-blue-900/10 border border-blue-500/20 text-blue-300" : "bg-blue-50 border border-blue-200 text-blue-700"}`}>
          <Info className="w-3.5 h-3.5 inline mr-1" />
          Pool starts with 0 reserves. Add liquidity after creating.
        </div>

        <label className={`text-xs font-bold mb-1 block ${isDark ? "text-slate-300" : "text-gray-700"}`}>Pool Name (optional)</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. WBTC/USDC Core" className={`w-full rounded-lg px-3 py-2 text-sm mb-3 outline-none ${inputClass}`} />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={`text-xs font-bold mb-1 block ${isDark ? "text-slate-300" : "text-gray-700"}`}>Token A</label>
            <select value={tokenAIdx} onChange={e => setTokenAIdx(Number(e.target.value))} className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${inputClass}`}>
              {tokens.map((t, i) => <option key={t.tokenId} value={i}>{t.symbol}</option>)}
            </select>
          </div>
          <div>
            <label className={`text-xs font-bold mb-1 block ${isDark ? "text-slate-300" : "text-gray-700"}`}>Token B</label>
            <select value={tokenBIdx} onChange={e => setTokenBIdx(Number(e.target.value))} className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${inputClass}`}>
              {tokens.map((t, i) => <option key={t.tokenId} value={i}>{t.symbol}</option>)}
            </select>
          </div>
        </div>

        <div className={`flex items-center justify-between rounded-lg px-3 py-2.5 mb-4 ${inputClass}`}>
          <span className={`text-xs font-bold ${isDark ? "text-slate-300" : "text-gray-700"}`}>Swap Fee</span>
          <span className={`text-xs font-mono font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>0.1% <span className={`font-normal ${isDark ? "text-slate-500" : "text-gray-400"}`}>(fixed)</span></span>
        </div>

        {error && <div className="text-red-400 text-xs mb-3"><AlertCircle className="w-3 h-3 inline mr-1" />{error}</div>}

        <motion.button
          onClick={handleCreate}
          disabled={status === "creating" || status === "done"}
          whileTap={{ scale: 0.97 }}
          className={`w-full py-3 rounded-xl font-bold text-white transition-all ${status === "done" ? "bg-emerald-500" : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"}`}
        >
          {status === "creating" ? "Creating..." : status === "done" ? "Pool Created!" : "Create Pool"}
        </motion.button>
      </motion.div>
    </div>
  );
}

// ── Add Liquidity Modal ─────────────────────────────────────────────

function AddLiquidityModal({ pool, isDark, accountId, onClose, onDone }: {
  pool: PoolState; isDark: boolean; accountId: string; onClose: () => void; onDone: () => void;
}) {
  const [amtA, setAmtA] = useState("");
  const [amtB, setAmtB] = useState("");
  const [status, setStatus] = useState<"idle" | "adding" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const seedA = WRAPPED_TOKENS.find(t => t.symbol === pool.tokenA);
  const seedB = WRAPPED_TOKENS.find(t => t.symbol === pool.tokenB);

  const handleAdd = async () => {
    const a = parseFloat(amtA);
    const b = parseFloat(amtB);
    if (!a || !b || a <= 0 || b <= 0) { setError("Both amounts required"); return; }
    const rawA = BigInt(Math.floor(a * (10 ** (seedA?.decimals || 8)))).toString();
    const rawB = BigInt(Math.floor(b * (10 ** (seedB?.decimals || 8)))).toString();
    setStatus("adding");
    setError("");
    try {
      await authenticate(accountId);
      const result = await addLiquidity(pool.id, rawA, rawB, accountId);
      if (result.success) {
        setStatus("done");
        playVipConfirm();
        toast.success("Liquidity added!");
        onDone();
        setTimeout(onClose, 1500);
      } else {
        setError(result.error || "Failed");
        setStatus("error");
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
      setStatus("error");
    }
  };

  const inputClass = isDark ? "bg-slate-800/50 border border-pink-500/10" : "bg-gray-50 border border-gray-200";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`relative w-full max-w-md mx-4 rounded-2xl p-6 ${isDark ? "bg-[#12121a] border border-pink-500/30" : "bg-white border border-gray-200 shadow-2xl"}`}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold">Add Liquidity</h3>
            <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{pool.name}</p>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}><X className="w-5 h-5" /></button>
        </div>

        {pool.lpTotalSupply === "0" && (
          <div className={`rounded-xl p-3 mb-4 text-xs ${isDark ? "bg-amber-900/10 border border-amber-500/20 text-amber-300" : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
            <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
            First deposit — you set the initial price ratio. Choose carefully.
          </div>
        )}

        <div className="space-y-3 mb-4">
          <div>
            <label className={`text-xs font-bold mb-1 block ${isDark ? "text-slate-300" : "text-gray-700"}`}>{pool.tokenA} Amount</label>
            <input type="number" placeholder="0.00" value={amtA} onChange={e => setAmtA(e.target.value)} className={`w-full rounded-lg px-3 py-2 outline-none ${inputClass}`} />
          </div>
          <div>
            <label className={`text-xs font-bold mb-1 block ${isDark ? "text-slate-300" : "text-gray-700"}`}>{pool.tokenB} Amount</label>
            <input type="number" placeholder="0.00" value={amtB} onChange={e => setAmtB(e.target.value)} className={`w-full rounded-lg px-3 py-2 outline-none ${inputClass}`} />
          </div>
        </div>

        {error && <div className="text-red-400 text-xs mb-3"><AlertCircle className="w-3 h-3 inline mr-1" />{error}</div>}

        <motion.button onClick={handleAdd} disabled={status === "adding" || status === "done"} whileTap={{ scale: 0.97 }}
          className={`w-full py-3 rounded-xl font-bold text-white transition-all ${status === "done" ? "bg-emerald-500" : "bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 hover:shadow-[0_0_20px_rgba(236,72,153,0.3)]"}`}
        >
          {status === "adding" ? "Adding..." : status === "done" ? "Liquidity Added!" : "Add Liquidity"}
        </motion.button>
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
  const seedA = WRAPPED_TOKENS.find(t => t.symbol === pool.tokenA);
  const seedB = WRAPPED_TOKENS.find(t => t.symbol === pool.tokenB);

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
              {seedA && <img src={seedA.logo} alt={seedA.symbol} className="w-7 h-7 rounded-full border-2 border-slate-900 relative z-10" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
              {seedB && <img src={seedB.logo} alt={seedB.symbol} className="w-7 h-7 rounded-full border-2 border-slate-900" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
            </div>
            <div>
              <div className="font-bold text-sm">{pool.tokenA}/{pool.tokenB}</div>
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
                  <div className={`text-[10px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{pool.tokenA}</div>
                  <div className="text-xs font-bold">{displayReserve(pool.reserveA, pool.decimalsA)}</div>
                </div>
                <div className={`rounded-lg p-2 ${isDark ? "bg-slate-800/40" : "bg-gray-50"}`}>
                  <div className={`text-[10px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{pool.tokenB}</div>
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

// ── Main Pools Section ──────────────────────────────────────────────

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
      console.debug("[Pools] Load failed:", err);
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

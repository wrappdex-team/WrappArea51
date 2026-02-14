import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Plus,
  Minus,
  X,
  ChevronUp,
  Search,
  Shield,
  AlertCircle,
  CheckCircle2,
  Crown,
  Coins,
  Layers,
  Zap,
  RefreshCw,
  Info,
  Trash2,
  ArrowRight,
  Wallet,
  ExternalLink,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { formatTokenCount } from "../utils/dao";
import { toast } from "sonner";
import { fetchHbarhTokenPrice } from "../utils/saucerswap";
import { Tip } from "./Tip";

// ── Weight Colors ────────────────────────────────────────────────────

const WEIGHT_COLORS = [
  { bg: "bg-pink-500", text: "text-pink-400", ring: "ring-pink-500/30" },
  { bg: "bg-blue-500", text: "text-blue-400", ring: "ring-blue-500/30" },
  { bg: "bg-emerald-500", text: "text-emerald-400", ring: "ring-emerald-500/30" },
  { bg: "bg-amber-500", text: "text-amber-400", ring: "ring-amber-500/30" },
  { bg: "bg-purple-500", text: "text-purple-400", ring: "ring-purple-500/30" },
  { bg: "bg-cyan-500", text: "text-cyan-400", ring: "ring-cyan-500/30" },
  { bg: "bg-rose-500", text: "text-rose-400", ring: "ring-rose-500/30" },
  { bg: "bg-teal-500", text: "text-teal-400", ring: "ring-teal-500/30" },
  { bg: "bg-indigo-500", text: "text-indigo-400", ring: "ring-indigo-500/30" },
  { bg: "bg-orange-500", text: "text-orange-400", ring: "ring-orange-500/30" },
];

// ── Category Labels ──────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  stable: "Stablecoins",
  major: "Major Assets",
  defi: "DeFi Tokens",
  ecosystem: "Ecosystem",
  protocol: "Protocol",
};

const CATEGORY_ORDER = ["major", "stable", "defi", "protocol", "ecosystem"];

// ── Main Component ──────────────────────────────────────────────────

export function PoolCreator() {
  const { isDark } = useTheme();
  const { hederaAccount, hederaNetwork, hashPackSession } = useWallet();

  // ── Step state ──
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // ── Pool config ──
  const [poolName, setPoolName] = useState("");
  const [poolDescription, setPoolDescription] = useState("");
  const [selectedTokens, setSelectedTokens] = useState<PoolTokenConfig[]>([]);
  const [swapFeeBps, setSwapFeeBps] = useState(30);

  // ── UI state ──
  const [tokenSearch, setTokenSearch] = useState("");
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ success: boolean; poolId: string | null; txId: string | null } | null>(null);
  const [myPools, setMyPools] = useState<CreatedPool[]>(() => loadCustomPools());
  const [showMyPools, setShowMyPools] = useState(false);

  const accountId = hashPackSession?.accountId || null;

  // ── Live HBAR.ħ price for fee calculation ──
  const [hbarhPrice, setHbarhPrice] = useState(0.008); // fallback default
  useEffect(() => {
    fetchHbarhTokenPrice().then((r) => {
      if (r.price > 0) setHbarhPrice(r.price);
    });
  }, []);

  // ── Eligibility check ──
  const eligibility: CreationEligibility | null = useMemo(() => {
    if (!hederaAccount?.tokens) return null;
    return checkCreationEligibility(hederaAccount.tokens, hederaNetwork, hbarhPrice);
  }, [hederaAccount?.tokens, hederaNetwork, hbarhPrice]);

  // ── Validation ──
  const config: CustomPoolConfig = useMemo(() => ({
    name: poolName,
    description: poolDescription,
    tokens: selectedTokens,
    swapFeeBps,
  }), [poolName, poolDescription, selectedTokens, swapFeeBps]);

  const validation = useMemo(() => validatePoolConfig(config), [config]);
  const weightSum = useMemo(() => selectedTokens.reduce((s, t) => s + t.weightBps, 0), [selectedTokens]);

  // ── Token picker ──
  const availableTokens = useMemo(() => {
    const selectedIds = new Set(selectedTokens.map((t) => t.token.tokenId));
    let tokens = POOLABLE_TOKENS.filter((t) => !selectedIds.has(t.tokenId));
    if (tokenSearch) {
      const q = tokenSearch.toLowerCase();
      tokens = tokens.filter(
        (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
      );
    }
    return tokens;
  }, [selectedTokens, tokenSearch]);

  const groupedTokens = useMemo(() => {
    const groups: Record<string, PoolableToken[]> = {};
    for (const token of availableTokens) {
      const cat = token.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(token);
    }
    return groups;
  }, [availableTokens]);

  // ── Actions ──
  const addToken = useCallback((token: PoolableToken) => {
    if (selectedTokens.length >= MAX_POOL_TOKENS) {
      toast.error(`Maximum ${MAX_POOL_TOKENS} tokens per pool`);
      return;
    }
    // Auto-distribute remaining weight equally
    const remaining = WEIGHT_SUM_BPS - weightSum;
    const defaultWeight = Math.max(MIN_WEIGHT_BPS, Math.min(remaining, 2000));
    setSelectedTokens((prev) => [...prev, { token, weightBps: defaultWeight }]);
    setShowTokenPicker(false);
    setTokenSearch("");
  }, [selectedTokens.length, weightSum]);

  const removeToken = useCallback((tokenId: string) => {
    setSelectedTokens((prev) => prev.filter((t) => t.token.tokenId !== tokenId));
  }, []);

  const updateWeight = useCallback((tokenId: string, newWeight: number) => {
    setSelectedTokens((prev) =>
      prev.map((t) =>
        t.token.tokenId === tokenId ? { ...t, weightBps: Math.max(MIN_WEIGHT_BPS, Math.min(MAX_WEIGHT_BPS, newWeight)) } : t
      )
    );
  }, []);

  const autoBalance = useCallback(() => {
    if (selectedTokens.length === 0) return;
    const perToken = Math.floor(WEIGHT_SUM_BPS / selectedTokens.length);
    const remainder = WEIGHT_SUM_BPS - perToken * selectedTokens.length;
    setSelectedTokens((prev) =>
      prev.map((t, i) => ({ ...t, weightBps: perToken + (i === 0 ? remainder : 0) }))
    );
  }, [selectedTokens.length]);

  const handleCreate = useCallback(async () => {
    if (!accountId || !eligibility) {
      toast.error("Connect your wallet first");
      return;
    }

    const v = validatePoolConfig(config);
    if (!v.valid) {
      toast.error(v.errors[0]);
      return;
    }

    setCreating(true);
    try {
      const result = await createCustomPool(config, accountId, eligibility, hederaNetwork, false);
      if (result.success) {
        setCreateResult({ success: true, poolId: result.poolId, txId: result.transactionId });
        setMyPools(loadCustomPools());
        toast.success("Pool created successfully!");
        setStep(4);
      } else {
        toast.error(result.error || "Pool creation failed");
      }
    } catch (err: any) {
      toast.error(err?.message || "Unexpected error");
    } finally {
      setCreating(false);
    }
  }, [accountId, eligibility, config, hederaNetwork]);

  const handleDeletePool = useCallback((poolId: string) => {
    deleteCustomPool(poolId);
    setMyPools(loadCustomPools());
    toast.success("Pool deleted");
  }, []);

  const resetForm = useCallback(() => {
    setStep(1);
    setPoolName("");
    setPoolDescription("");
    setSelectedTokens([]);
    setSwapFeeBps(30);
    setCreateResult(null);
  }, []);

  // ── Styles ──
  const cardClass = isDark
    ? "bg-gradient-to-br from-slate-900/60 to-slate-800/30 border border-pink-500/15 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  const inputClass = isDark
    ? "bg-slate-800/60 border border-pink-500/10 text-white"
    : "bg-gray-50 border border-gray-200 text-gray-900";

  const stepIndicatorClass = (s: number) =>
    step >= s
      ? "bg-gradient-to-r from-pink-500 to-purple-500 text-white"
      : isDark
      ? "bg-slate-800/50 text-slate-500 border border-pink-500/10"
      : "bg-gray-100 text-gray-400 border border-gray-200";

  // ── Render ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Plus className="w-5 h-5 text-pink-400" />
            Create Custom Pool
          </h2>
          <p className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Build your own multi-token weighted index pool from the approved token list
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowMyPools(!showMyPools); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              isDark
                ? "bg-slate-800/50 border-pink-500/10 text-slate-300 hover:text-white"
                : "bg-gray-100 border-gray-200 text-gray-600 hover:text-gray-900"
            }`}
          >
            <Layers className="w-3 h-3" />
            My Pools ({myPools.length})
          </button>
        </div>
      </div>

      {/* Eligibility Banner */}
      <div className={`rounded-xl p-4 border ${
        eligibility?.feeExempt
          ? isDark
            ? "bg-gradient-to-r from-emerald-900/15 to-teal-900/15 border-emerald-500/20"
            : "bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200"
          : isDark
          ? "bg-gradient-to-r from-amber-900/10 to-orange-900/10 border-amber-500/20"
          : "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200"
      }`}>
        <div className="flex items-start gap-3">
          {eligibility?.feeExempt ? (
            <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Crown className="w-5 h-5 text-emerald-400" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Coins className="w-5 h-5 text-amber-400" />
            </div>
          )}
          <div className="flex-1">
            <div className="text-sm font-bold mb-1">
              {eligibility?.feeExempt ? (
                <span className={isDark ? "text-emerald-400" : "text-emerald-700"}>
                  Free Pool Creation {eligibility.isVip ? "(VIP)" : "(100M+ Holder)"}
                </span>
              ) : !accountId ? (
                <span className={isDark ? "text-amber-400" : "text-amber-700"}>
                  Connect Wallet to Check Eligibility
                </span>
              ) : (
                <span className={isDark ? "text-amber-400" : "text-amber-700"}>
                  Pool Creation Fee: ${CREATION_FEE_USD} in HBAR.ħ
                </span>
              )}
            </div>
            <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              {eligibility?.feeExempt ? (
                "You qualify for unlimited free pool creation. No fees will be charged."
              ) : !accountId ? (
                "VIP members and 100M+ HBAR.ħ holders create pools for free. Others pay $50 in HBAR.ħ tokens."
              ) : (
                <>
                  Hold {formatTokenCount(FREE_CREATION_THRESHOLD)} HBAR.ħ tokens or VIP status for free creation. Fee goes to treasury{" "}
                  <span className="font-mono text-pink-400">{TREASURY_ACCOUNT_ID}</span>.
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* My Pools Panel */}
      {showMyPools && (
        <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
          <div className={`px-4 py-3 border-b ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                My Custom Pools
              </span>
              <button onClick={() => setShowMyPools(false)} className={`p-1 rounded-lg ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          {myPools.length === 0 ? (
            <div className={`px-4 py-8 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No custom pools yet — create your first one below</p>
            </div>
          ) : (
            <div className="divide-y divide-pink-500/10">
              {myPools.map((pool) => (
                <div key={pool.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold">{pool.config.name}</div>
                    <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {pool.config.tokens.map((t) => t.token.symbol).join(" / ")}
                    </div>
                    <div className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      Created {new Date(pool.createdAt).toLocaleDateString()} &middot;{" "}
                      {pool.feePaid ? `Paid ${pool.feeAmount.toLocaleString()} HBAR.ħ` : "Free (VIP/Holder)"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      pool.status === "active"
                        ? isDark ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-emerald-700 bg-emerald-50 border-emerald-200"
                        : isDark ? "text-slate-400 bg-slate-800/50 border-slate-700" : "text-gray-500 bg-gray-100 border-gray-200"
                    }`}>
                      {pool.status}
                    </span>
                    <button
                      onClick={() => handleDeletePool(pool.id)}
                      className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-red-500/10 text-slate-500 hover:text-red-400" : "hover:bg-red-50 text-gray-400 hover:text-red-500"}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {[
          { num: 1, label: "Tokens" },
          { num: 2, label: "Weights" },
          { num: 3, label: "Review" },
          { num: 4, label: "Done" },
        ].map((s, i) => (
          <div key={s.num} className="flex items-center gap-2 flex-1">
            <button
              onClick={() => { if (s.num < step || (s.num === 1)) setStep(s.num as 1 | 2 | 3 | 4); }}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${stepIndicatorClass(s.num)}`}
            >
              {step > s.num && s.num < 4 ? <CheckCircle2 className="w-4 h-4" /> : s.num}
            </button>
            <span className={`text-xs hidden sm:inline ${step >= s.num ? (isDark ? "text-white" : "text-gray-900") : isDark ? "text-slate-500" : "text-gray-400"}`}>
              {s.label}
            </span>
            {i < 3 && (
              <div className={`flex-1 h-px ${step > s.num ? "bg-gradient-to-r from-pink-500 to-purple-500" : isDark ? "bg-slate-800" : "bg-gray-200"}`} />
            )}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Select Tokens ── */}
      {step === 1 && (
        <div className={`rounded-2xl p-6 ${cardClass}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold mb-1">Select Pool Tokens</h3>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Choose {MIN_POOL_TOKENS}-{MAX_POOL_TOKENS} tokens from the approved list ({POOLABLE_TOKENS.length} available)
              </p>
            </div>
            <div className={`text-xs px-2 py-1 rounded-lg ${
              selectedTokens.length >= MIN_POOL_TOKENS
                ? isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : isDark ? "bg-slate-800/50 text-slate-400 border border-pink-500/10" : "bg-gray-100 text-gray-500 border border-gray-200"
            }`}>
              {selectedTokens.length}/{MAX_POOL_TOKENS} tokens
            </div>
          </div>

          {/* Pool Name */}
          <div className="mb-4">
            <label className={`text-xs font-bold block mb-1.5 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
              Pool Name
            </label>
            <input
              type="text"
              placeholder="e.g. Blue Chip Hedera Index"
              value={poolName}
              onChange={(e) => setPoolName(e.target.value)}
              maxLength={64}
              className={`w-full px-3 py-2.5 rounded-xl outline-none text-sm ${inputClass}`}
            />
          </div>

          {/* Selected Tokens */}
          {selectedTokens.length > 0 && (
            <div className="mb-4">
              <div className={`text-xs font-bold mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                Selected ({selectedTokens.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedTokens.map((tc, i) => (
                  <div
                    key={tc.token.tokenId}
                    className={`flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg text-xs transition-all ${
                      isDark ? "bg-slate-800/60 border border-pink-500/15" : "bg-gray-50 border border-gray-200"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${WEIGHT_COLORS[i % WEIGHT_COLORS.length].bg}`} />
                    <img
                      src={tc.token.logo}
                      alt={tc.token.symbol}
                      className="w-4 h-4 rounded-full"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                    <span className="font-bold">{tc.token.symbol}</span>
                    <button
                      onClick={() => removeToken(tc.token.tokenId)}
                      className={`p-0.5 rounded transition-colors ${isDark ? "hover:bg-red-500/20 text-slate-500 hover:text-red-400" : "hover:bg-red-50 text-gray-400 hover:text-red-500"}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Token Button */}
          {selectedTokens.length < MAX_POOL_TOKENS && (
            <button
              onClick={() => setShowTokenPicker(!showTokenPicker)}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all border-2 border-dashed ${
                isDark
                  ? "border-pink-500/20 text-slate-400 hover:text-pink-400 hover:border-pink-500/40 hover:bg-pink-500/5"
                  : "border-gray-300 text-gray-500 hover:text-pink-600 hover:border-pink-300 hover:bg-pink-50"
              }`}
            >
              {showTokenPicker ? <ChevronUp className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showTokenPicker ? "Close Token Picker" : "Add Token"}
            </button>
          )}

          {/* Token Picker Dropdown */}
          {showTokenPicker && (
            <div className={`mt-3 rounded-xl border overflow-hidden ${
              isDark ? "bg-slate-900/80 border-pink-500/20" : "bg-white border-gray-200 shadow-lg"
            }`}>
              <div className={`px-3 py-2 border-b ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${inputClass}`}>
                  <Search className={`w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                  <input
                    type="text"
                    placeholder="Search tokens..."
                    value={tokenSearch}
                    onChange={(e) => setTokenSearch(e.target.value)}
                    className="bg-transparent outline-none text-xs flex-1"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {CATEGORY_ORDER.filter((cat) => groupedTokens[cat]?.length > 0).map((cat) => (
                  <div key={cat}>
                    <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${
                      isDark ? "text-slate-500 bg-slate-900/50" : "text-gray-400 bg-gray-50"
                    }`}>
                      {CATEGORY_LABELS[cat]}
                    </div>
                    {groupedTokens[cat].map((token) => (
                      <button
                        key={token.tokenId}
                        onClick={() => addToken(token)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                          isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50"
                        }`}
                      >
                        <img
                          src={token.logo}
                          alt={token.symbol}
                          className="w-6 h-6 rounded-full"
                          onError={(e) => {
                            const el = e.currentTarget;
                            el.style.display = "none";
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold">{token.symbol}</div>
                          <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            {token.name}
                          </div>
                        </div>
                        <div className={`text-[10px] px-1.5 py-0.5 rounded ${
                          isDark ? "bg-slate-800/50 text-slate-500" : "bg-gray-100 text-gray-400"
                        }`}>
                          {token.tokenId}
                        </div>
                        <Plus className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
                      </button>
                    ))}
                  </div>
                ))}
                {availableTokens.length === 0 && (
                  <div className={`px-4 py-6 text-center text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    No matching tokens
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Next Button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={selectedTokens.length < MIN_POOL_TOKENS || !poolName.trim()}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                selectedTokens.length >= MIN_POOL_TOKENS && poolName.trim()
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/20"
                  : "bg-slate-600 opacity-50 cursor-not-allowed text-white"
              }`}
            >
              Set Weights
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Set Weights ── */}
      {step === 2 && (
        <div className={`rounded-2xl p-6 ${cardClass}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold mb-1">Configure Weights</h3>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Set the target weight for each token (must sum to 100%)
              </p>
            </div>
            <button
              onClick={autoBalance}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                isDark
                  ? "bg-slate-800/50 border-pink-500/10 text-slate-300 hover:text-white"
                  : "bg-gray-100 border-gray-200 text-gray-600 hover:text-gray-900"
              }`}
            >
              <RefreshCw className="w-3 h-3" />
              Auto Balance
            </button>
          </div>

          {/* Weight Visualization Bar */}
          <div className="mb-5">
            <div className="flex rounded-full h-3 overflow-hidden">
              {selectedTokens.map((tc, i) => (
                <Tip key={tc.token.tokenId} content={`${tc.token.symbol}: ${(tc.weightBps / 100).toFixed(1)}%`} side="top">
                <div
                  className={`${WEIGHT_COLORS[i % WEIGHT_COLORS.length].bg} transition-all duration-300`}
                  style={{ width: `${tc.weightBps / 100}%` }}
                />
                </Tip>
              ))}
              {weightSum < WEIGHT_SUM_BPS && (
                <Tip content={`Unallocated: ${((WEIGHT_SUM_BPS - weightSum) / 100).toFixed(1)}%`} side="top">
                <div
                  className={`${isDark ? "bg-slate-700/50" : "bg-gray-200"} transition-all duration-300`}
                  style={{ width: `${(WEIGHT_SUM_BPS - weightSum) / 100}%` }}
                />
                </Tip>
              )}
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {selectedTokens.map((tc, i) => (
                  <div key={tc.token.tokenId} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${WEIGHT_COLORS[i % WEIGHT_COLORS.length].bg}`} />
                    <span className={`text-[10px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {tc.token.symbol} {(tc.weightBps / 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
              <span className={`text-xs font-bold ${
                weightSum === WEIGHT_SUM_BPS
                  ? "text-emerald-400"
                  : weightSum > WEIGHT_SUM_BPS
                  ? "text-red-400"
                  : isDark ? "text-amber-400" : "text-amber-600"
              }`}>
                {(weightSum / 100).toFixed(1)}% / 100%
              </span>
            </div>
          </div>

          {/* Weight Sliders */}
          <div className="space-y-3 mb-6">
            {selectedTokens.map((tc, i) => (
              <div key={tc.token.tokenId} className={`rounded-xl p-3 ${
                isDark ? "bg-slate-800/40 border border-pink-500/10" : "bg-gray-50 border border-gray-200"
              }`}>
                <div className="flex items-center gap-3">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${WEIGHT_COLORS[i % WEIGHT_COLORS.length].bg}`} />
                  <img
                    src={tc.token.logo}
                    alt={tc.token.symbol}
                    className="w-5 h-5 rounded-full flex-shrink-0"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                  <span className="text-sm font-bold flex-shrink-0 w-16">{tc.token.symbol}</span>
                  <div className="flex-1">
                    <input
                      type="range"
                      min={MIN_WEIGHT_BPS}
                      max={MAX_WEIGHT_BPS}
                      step={100}
                      value={tc.weightBps}
                      onChange={(e) => updateWeight(tc.token.tokenId, parseInt(e.target.value))}
                      className="w-full accent-pink-500"
                    />
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => updateWeight(tc.token.tokenId, tc.weightBps - 100)}
                      className={`p-1 rounded transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className={`text-sm font-bold w-12 text-center ${WEIGHT_COLORS[i % WEIGHT_COLORS.length].text}`}>
                      {(tc.weightBps / 100).toFixed(0)}%
                    </span>
                    <button
                      onClick={() => updateWeight(tc.token.tokenId, tc.weightBps + 100)}
                      className={`p-1 rounded transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    onClick={() => removeToken(tc.token.tokenId)}
                    className={`p-1 rounded transition-colors ${isDark ? "hover:bg-red-500/10 text-slate-500 hover:text-red-400" : "hover:bg-red-50 text-gray-400 hover:text-red-500"}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(1)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-colors ${
                isDark ? "text-slate-400 hover:text-white hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={weightSum !== WEIGHT_SUM_BPS}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                weightSum === WEIGHT_SUM_BPS
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/20"
                  : "bg-slate-600 opacity-50 cursor-not-allowed text-white"
              }`}
            >
              Review Pool
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Review & Create ── */}
      {step === 3 && (
        <div className={`rounded-2xl p-6 ${cardClass}`}>
          <h3 className="font-bold mb-4 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
            Review Pool Configuration
          </h3>

          {/* Pool Info */}
          <div className={`rounded-xl p-4 mb-4 ${isDark ? "bg-slate-800/40 border border-pink-500/10" : "bg-gray-50 border border-gray-200"}`}>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className={`text-[10px] uppercase ${isDark ? "text-slate-500" : "text-gray-400"}`}>Pool Name</div>
                <div className="font-bold">{poolName}</div>
              </div>
              <div>
                <div className={`text-[10px] uppercase ${isDark ? "text-slate-500" : "text-gray-400"}`}>Tokens</div>
                <div className="font-bold">{selectedTokens.length}</div>
              </div>
              <div>
                <div className={`text-[10px] uppercase ${isDark ? "text-slate-500" : "text-gray-400"}`}>Creator</div>
                <div className="font-bold font-mono text-xs">{accountId || "Not connected"}</div>
              </div>
            </div>
          </div>

          {/* Token Composition */}
          <div className={`rounded-xl p-4 mb-4 ${isDark ? "bg-slate-800/40 border border-pink-500/10" : "bg-gray-50 border border-gray-200"}`}>
            <div className={`text-xs font-bold mb-3 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
              Token Composition
            </div>
            {/* Weight Bar */}
            <div className="flex rounded-full h-3 overflow-hidden mb-3">
              {selectedTokens.map((tc, i) => (
                <div
                  key={tc.token.tokenId}
                  className={`${WEIGHT_COLORS[i % WEIGHT_COLORS.length].bg} transition-all`}
                  style={{ width: `${tc.weightBps / 100}%` }}
                />
              ))}
            </div>
            <div className="space-y-1.5">
              {selectedTokens.map((tc, i) => (
                <div key={tc.token.tokenId} className={`flex items-center justify-between text-xs py-1 border-b last:border-0 ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${WEIGHT_COLORS[i % WEIGHT_COLORS.length].bg}`} />
                    <img src={tc.token.logo} alt="" className="w-4 h-4 rounded-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    <span className="font-bold">{tc.token.symbol}</span>
                    <span className={isDark ? "text-slate-500" : "text-gray-400"}>{tc.token.name}</span>
                  </div>
                  <div className={`font-bold ${WEIGHT_COLORS[i % WEIGHT_COLORS.length].text}`}>
                    {(tc.weightBps / 100).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fee Info */}
          <div className={`rounded-xl p-4 mb-4 ${
            eligibility?.feeExempt
              ? isDark ? "bg-emerald-900/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"
              : isDark ? "bg-amber-900/10 border border-amber-500/20" : "bg-amber-50 border border-amber-200"
          }`}>
            <div className="flex items-center gap-3">
              {eligibility?.feeExempt ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <Coins className="w-5 h-5 text-amber-400" />
              )}
              <div>
                <div className="text-sm font-bold">
                  {eligibility?.feeExempt
                    ? "No Fee — Free Creation"
                    : `Creation Fee: $${CREATION_FEE_USD} in HBAR.ħ`
                  }
                </div>
                <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  {eligibility?.feeExempt
                    ? `You qualify as ${eligibility.isVip ? "VIP" : "100M+ holder"}`
                    : `~${eligibility?.feeAmountTokens.toLocaleString() || "N/A"} HBAR.ħ sent to treasury ${TREASURY_ACCOUNT_ID}`
                  }
                </div>
              </div>
            </div>
          </div>

          {/* Validation Errors/Warnings */}
          {validation.errors.length > 0 && (
            <div className={`rounded-xl p-3 mb-4 ${isDark ? "bg-red-500/10 border border-red-500/20" : "bg-red-50 border border-red-200"}`}>
              {validation.errors.map((err, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-red-400 py-0.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className={`rounded-xl p-3 mb-4 ${isDark ? "bg-amber-500/10 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
              {validation.warnings.map((warn, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-amber-400 py-0.5">
                  <Info className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{warn}</span>
                </div>
              ))}
            </div>
          )}

          {/* Smart Contract Info */}
          <div className={`rounded-xl p-3 mb-6 ${isDark ? "bg-slate-800/40 border border-pink-500/10" : "bg-gray-50 border border-gray-200"}`}>
            <div className={`flex items-center gap-2 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              <Shield className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />
              <span>
                Pool created via <span className="font-bold text-pink-400">HBARhWeightedPoolFactory</span> smart contract.
                Audited for reentrancy, overflow, access control, and fee manipulation.
                Treasury: <span className="font-mono">{TREASURY_ACCOUNT_ID}</span>
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(2)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-colors ${
                isDark ? "text-slate-400 hover:text-white hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={!validation.valid || creating || !accountId}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                !validation.valid || creating || !accountId
                  ? "bg-slate-600 opacity-50 cursor-not-allowed text-white"
                  : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/20"
              }`}
            >
              {creating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Creating Pool...
                </>
              ) : !accountId ? (
                <>
                  <Wallet className="w-4 h-4" />
                  Connect Wallet
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Create Pool
                  {!eligibility?.feeExempt && ` ($${CREATION_FEE_USD})`}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Success ── */}
      {step === 4 && createResult?.success && (
        <div className={`rounded-2xl p-8 text-center ${cardClass}`}>
          <div className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center ${
            isDark ? "bg-emerald-500/20 border border-emerald-500/30" : "bg-emerald-50 border border-emerald-200"
          }`}>
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>

          <h3 className="text-xl font-bold mb-2 bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Pool Created Successfully!
          </h3>

          <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Your custom weighted pool <span className="font-bold">{poolName}</span> is now live.
          </p>

          <div className={`inline-block rounded-xl p-4 mb-6 text-left ${isDark ? "bg-slate-800/40 border border-pink-500/10" : "bg-gray-50 border border-gray-200"}`}>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-4">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Pool ID</span>
                <span className="font-mono font-bold">{createResult.poolId?.slice(0, 20)}...</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Tokens</span>
                <span className="font-bold">{selectedTokens.map((t) => t.token.symbol).join(" / ")}</span>
              </div>
              {createResult.txId && (
                <div className="flex items-center justify-between gap-4">
                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>Transaction</span>
                  <a
                    href={`https://hashscan.io/${hederaNetwork}/transaction/${createResult.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-pink-400 hover:underline"
                  >
                    HashScan <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={resetForm}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white transition-all shadow-lg shadow-pink-500/20"
            >
              <Plus className="w-4 h-4" />
              Create Another
            </button>
            <button
              onClick={() => setShowMyPools(true)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm transition-colors ${
                isDark ? "bg-slate-800/50 border border-pink-500/10 text-slate-300 hover:text-white" : "bg-gray-100 border border-gray-200 text-gray-600 hover:text-gray-900"
              }`}
            >
              <Layers className="w-4 h-4" />
              View My Pools
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
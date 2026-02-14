import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ArrowDownUp,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  Droplets,
  Info,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Shield,
  X,
  Zap,
  Crown,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { isVipEligible } from "../utils/vip";
import { authenticate, hasValidSession, clearSession } from "../utils/auth";
import { GATE_THRESHOLD, formatTokenCount } from "../utils/dao";
import { VIPAccessGate } from "./VIPAccessGate";
import {
  fetchPools,
  getPoolStats,
  refreshOracles,
  getSwapQuote,
  executeSwap,
  createPool,
  addLiquidity,
  removeLiquidity,
  getLPPosition,
  formatUsd,
  formatFeeBps,
  displayReserve,
  WRAPPED_TOKENS,
  type PoolState,
  type PoolStats,
  type SwapQuote,
  type LPPosition,
} from "../utils/smart-liquidity";

// ── Swap Panel ──────────────────────────────────────────────────────

function SwapPanel({ pools, isDark, accountId }: { pools: PoolState[]; isDark: boolean; accountId: string | null }) {
  const tokens = WRAPPED_TOKENS;
  const [tokenInIdx, setTokenInIdx] = useState(0);
  const [tokenOutIdx, setTokenOutIdx] = useState(2); // default USDC
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [status, setStatus] = useState<"idle" | "quoting" | "swapping" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const tokenIn = tokens[tokenInIdx];
  const tokenOut = tokens[tokenOutIdx];

  const inputClass = isDark ? "bg-slate-800/50 border border-pink-500/10" : "bg-gray-50 border border-gray-200";

  // Debounced quoting
  useEffect(() => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || tokenIn.symbol === tokenOut.symbol) { setQuote(null); setStatus("idle"); return; }

    setStatus("quoting");
    setError(null);
    const timer = setTimeout(async () => {
      const q = await getSwapQuote(tokenIn.symbol, tokenOut.symbol, amt);
      setQuote(q);
      if (!q) { setStatus("error"); setError("No route available — pools may need liquidity"); }
      else setStatus("idle");
    }, 300);
    return () => clearTimeout(timer);
  }, [amount, tokenIn.symbol, tokenOut.symbol]);

  const handleSwap = async () => {
    if (!quote || !accountId) return;
    setStatus("swapping");
    setError(null);
    try {
      await authenticate(accountId);
      // Slippage protection: 0.5% default
      const minOut = (BigInt(quote.amountOutRaw) * 995n / 1000n).toString();
      const result = await executeSwap(accountId, quote.poolId, quote.tokenIn, quote.tokenOut, quote.amountInRaw, minOut);
      if (result.success) {
        setStatus("success");
        setAmount("");
        setQuote(null);
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        setError(result.error || "Swap failed");
        setStatus("error");
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
      setStatus("error");
    }
  };

  const flipTokens = () => {
    setTokenInIdx(tokenOutIdx);
    setTokenOutIdx(tokenInIdx);
    setAmount("");
    setQuote(null);
  };

  return (
    <div className={`rounded-2xl p-6 ${isDark ? "bg-[#12121a] border border-pink-500/30" : "bg-white border border-gray-200 shadow-lg"}`}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center">
          <ArrowRightLeft className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="font-bold">Swap</h3>
          <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Constant-product AMM — real pool reserves
          </p>
        </div>
      </div>

      {/* Token In */}
      <div className={`rounded-xl p-4 mb-2 ${inputClass}`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>You Pay</span>
          <div className="flex items-center gap-1.5">
            <img src={tokenIn.logo} alt={tokenIn.symbol} className="w-4 h-4 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <select
              value={tokenInIdx}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setTokenInIdx(idx);
                if (idx === tokenOutIdx) setTokenOutIdx(tokenInIdx);
              }}
              className={`text-xs px-2 py-1 rounded-lg outline-none ${isDark ? "bg-slate-700/50 text-white" : "bg-white text-gray-900 border border-gray-200"}`}
            >
              {tokens.map((t, i) => <option key={t.tokenId} value={i}>{t.symbol}</option>)}
            </select>
          </div>
        </div>
        <input
          type="number"
          placeholder="0.00"
          className="w-full bg-transparent outline-none text-2xl"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {/* Flip */}
      <div className="flex justify-center -my-1 relative z-10">
        <button onClick={flipTokens} className={`p-2 rounded-full border transition-colors ${isDark ? "bg-slate-800 border-pink-500/20 hover:border-pink-500/50 text-pink-400" : "bg-white border-gray-200 hover:border-pink-300 text-pink-500 shadow-sm"}`}>
          <ArrowDownUp className="w-4 h-4" />
        </button>
      </div>

      {/* Token Out */}
      <div className={`rounded-xl p-4 mt-2 mb-4 ${inputClass}`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>You Receive</span>
          <div className="flex items-center gap-1.5">
            <img src={tokenOut.logo} alt={tokenOut.symbol} className="w-4 h-4 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <select
              value={tokenOutIdx}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setTokenOutIdx(idx);
                if (idx === tokenInIdx) setTokenInIdx(tokenOutIdx);
              }}
              className={`text-xs px-2 py-1 rounded-lg outline-none ${isDark ? "bg-slate-700/50 text-white" : "bg-white text-gray-900 border border-gray-200"}`}
            >
              {tokens.map((t, i) => <option key={t.tokenId} value={i}>{t.symbol}</option>)}
            </select>
          </div>
        </div>
        <div className="text-2xl">
          {status === "quoting" ? (
            <span className={`animate-pulse ${isDark ? "text-slate-500" : "text-gray-400"}`}>...</span>
          ) : quote ? (
            quote.amountOut.toFixed(quote.amountOut >= 1 ? 4 : 8)
          ) : "0.00"}
        </div>
        {quote && (
          <div className={`text-xs mt-1 flex items-center gap-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            <span>Impact: {(quote.priceImpactBps / 100).toFixed(2)}%</span>
            <span>Fee: {formatFeeBps(quote.feeBps)}</span>
            {quote.routeCount > 1 && <span className="text-blue-400">{quote.routeCount} routes found</span>}
          </div>
        )}
      </div>

      {/* Quote Details */}
      {quote && (
        <div className={`rounded-xl p-3 mb-4 text-xs space-y-1.5 ${inputClass}`}>
          <div className="flex items-center justify-between">
            <span className={isDark ? "text-slate-400" : "text-gray-500"}>Route</span>
            <span className="text-pink-400">{quote.route}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className={isDark ? "text-slate-400" : "text-gray-500"}>Rate</span>
            <span>1 {tokenIn.symbol} = {quote.effectiveRate.toFixed(quote.effectiveRate < 0.01 ? 6 : 4)} {tokenOut.symbol}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className={isDark ? "text-slate-400" : "text-gray-500"}>Min Received</span>
            <span>{quote.minAmountOut.toFixed(4)} {tokenOut.symbol}</span>
          </div>
          {(quote as any).protocolFee && (
            <>
              <div className={`border-t my-1 ${isDark ? "border-slate-700/50" : "border-gray-200"}`} />
              <div className="flex items-center justify-between">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Protocol Fee</span>
                <span>{((quote as any).protocolFee.totalHbar).toFixed(6)} HBAR <span className={isDark ? "text-slate-500" : "text-gray-400"}>($0.0007)</span></span>
              </div>
              <div className="flex items-center justify-between">
                <span className={isDark ? "text-slate-500" : "text-gray-400"}>  LP Reward (50%)</span>
                <span className={isDark ? "text-emerald-400/70" : "text-emerald-600"}>+{((quote as any).protocolFee.totalHbar / 2).toFixed(6)} HBAR</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={isDark ? "text-slate-500" : "text-gray-400"}>  Treasury (50%)</span>
                <span className={isDark ? "text-slate-500" : "text-gray-400"}>{((quote as any).protocolFee.totalHbar / 2).toFixed(6)} HBAR</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl p-3 mb-4 bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Swap Button */}
      <button
        onClick={handleSwap}
        disabled={!quote || !accountId || status === "swapping" || status === "success"}
        className={`w-full py-3 rounded-xl font-bold text-white transition-all ${
          status === "success"
            ? "bg-emerald-500"
            : !quote || !accountId
            ? "bg-gray-600 cursor-not-allowed"
            : "bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
        }`}
      >
        {status === "swapping" ? "Executing..." : status === "success" ? "Swap Complete!" : !accountId ? "Connect Wallet" : !quote ? "Enter Amount" : "Swap"}
      </button>
    </div>
  );
}

// ── Create Pool Modal ────────────────────────────────────────────────

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
      if (result.success) { setStatus("done"); onCreated(); setTimeout(onClose, 1500); }
      else { setError(result.error || "Failed"); setStatus("error"); }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
      setStatus("error");
    }
  };

  const inputClass = isDark ? "bg-slate-800/50 border border-pink-500/10" : "bg-gray-50 border border-gray-200";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-md mx-4 rounded-2xl p-6 ${isDark ? "bg-[#12121a] border border-pink-500/30" : "bg-white border border-gray-200 shadow-2xl"}`}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg">Create Pool</h3>
          <button onClick={onClose} className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}><X className="w-5 h-5" /></button>
        </div>

        <div className={`rounded-xl p-3 mb-4 text-xs ${isDark ? "bg-blue-900/10 border border-blue-500/20 text-blue-300" : "bg-blue-50 border border-blue-200 text-blue-700"}`}>
          <Info className="w-3.5 h-3.5 inline mr-1" />
          Pool starts with 0 reserves. You&apos;ll need to add liquidity after creating.
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

        <button onClick={handleCreate} disabled={status === "creating" || status === "done"} className={`w-full py-3 rounded-xl font-bold text-white transition-all ${status === "done" ? "bg-emerald-500" : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"}`}>
          {status === "creating" ? "Creating..." : status === "done" ? "Pool Created!" : "Create Pool"}
        </button>
      </div>
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

    // Convert to raw units
    const rawA = BigInt(Math.floor(a * (10 ** (seedA?.decimals || 8)))).toString();
    const rawB = BigInt(Math.floor(b * (10 ** (seedB?.decimals || 8)))).toString();

    setStatus("adding");
    setError("");
    try {
      await authenticate(accountId);
      const result = await addLiquidity(pool.id, rawA, rawB, accountId);
      if (result.success) {
        setStatus("done");
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-md mx-4 rounded-2xl p-6 ${isDark ? "bg-[#12121a] border border-pink-500/30" : "bg-white border border-gray-200 shadow-2xl"}`}>
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

        <button onClick={handleAdd} disabled={status === "adding" || status === "done"} className={`w-full py-3 rounded-xl font-bold text-white transition-all ${status === "done" ? "bg-emerald-500" : "bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"}`}>
          {status === "adding" ? "Adding..." : status === "done" ? "Liquidity Added!" : "Add Liquidity"}
        </button>
      </div>
    </div>
  );
}

// ── Pool Card ────────────────────────────────────────────────────────

function PoolCard({ pool, isDark, accountId, onAddLiquidity, onRefresh }: {
  pool: PoolState; isDark: boolean; accountId: string | null; onAddLiquidity: (p: PoolState) => void; onRefresh: () => void;
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

  const cardClass = isDark
    ? "bg-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  return (
    <div className={`rounded-2xl overflow-hidden ${cardClass}`}>
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {seedA && <img src={seedA.logo} alt={seedA.symbol} className="w-8 h-8 rounded-full border-2 border-slate-900 relative z-10" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
              {seedB && <img src={seedB.logo} alt={seedB.symbol} className="w-8 h-8 rounded-full border-2 border-slate-900" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
            </div>
            <div>
              <div className="font-bold text-sm">{pool.tokenA} / {pool.tokenB}</div>
              <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Fee: {formatFeeBps(pool.swapFeeBps)} &middot; {pool.swapCount} swaps
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-bold">{formatUsd(pool.tvlUsd || 0)}</div>
              <div className={`text-xs ${isEmpty ? (isDark ? "text-amber-400" : "text-amber-600") : (isDark ? "text-emerald-400" : "text-emerald-600")}`}>
                {isEmpty ? "Needs Liquidity" : "Active"}
              </div>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className={`px-4 pb-4 border-t ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className={`rounded-lg p-3 ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
              <div className={`text-xs mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{pool.tokenA} Reserve</div>
              <div className="text-sm font-bold">{displayReserve(pool.reserveA, pool.decimalsA)}</div>
            </div>
            <div className={`rounded-lg p-3 ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
              <div className={`text-xs mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{pool.tokenB} Reserve</div>
              <div className="text-sm font-bold">{displayReserve(pool.reserveB, pool.decimalsB)}</div>
            </div>
          </div>

          {pool.priceA !== undefined && pool.priceB !== undefined && !isEmpty && (
            <div className={`mt-2 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Pool rate: 1 {pool.tokenA} = {((Number(BigInt(pool.reserveB)) / (10 ** pool.decimalsB)) / (Number(BigInt(pool.reserveA)) / (10 ** pool.decimalsA))).toFixed(4)} {pool.tokenB}
            </div>
          )}

          {position && BigInt(position.shares) > 0n && (
            <div className={`mt-3 rounded-lg p-3 ${isDark ? "bg-emerald-900/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"}`}>
              <div className={`text-xs font-bold mb-1 ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>Your LP Position</div>
              <div className="text-sm font-bold">{position.shares} shares</div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onAddLiquidity(pool)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
            >
              <Droplets className="w-3.5 h-3.5" /> Add Liquidity
            </button>
            <a
              href={`https://hashscan.io/mainnet/token/${pool.tokenIdA}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs border ${isDark ? "border-pink-500/10 text-slate-400 hover:text-white" : "border-gray-200 text-gray-500 hover:text-gray-900"}`}
            >
              <ExternalLink className="w-3 h-3" /> HashScan
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function SmartLiquidity() {
  const { isDark } = useTheme();
  const { hederaAccount, hederaNetwork, hashPackSession } = useWallet();

  const [pools, setPools] = useState<PoolState[]>([]);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"swap" | "pools">("swap");
  const [oracleRefreshing, setOracleRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [liquidityPool, setLiquidityPool] = useState<PoolState | null>(null);

  const accountId = hashPackSession?.accountId || null;

  // Clear auth session when wallet disconnects or account changes
  const prevAccountRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevAccountRef.current && prevAccountRef.current !== accountId) {
      clearSession();
    }
    prevAccountRef.current = accountId;
  }, [accountId]);

  const isVip = useMemo(() => {
    if (!hederaAccount?.tokens) return false;
    return isVipEligible(hederaAccount.tokens, hederaNetwork);
  }, [hederaAccount?.tokens, hederaNetwork]);

  const loadData = useCallback(async () => {
    try {
      const [poolData, statsData] = await Promise.all([fetchPools(), getPoolStats()]);
      setPools(poolData);
      setStats(statsData);
    } catch (err) {
      console.debug("[SmartLiquidity] Load failed:", err);
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

  const cardClass = isDark ? "bg-slate-900/30 border border-pink-500/20 backdrop-blur-sm" : "bg-white border border-gray-200 shadow-sm";
  const inputClass = isDark ? "bg-slate-800/50 border border-pink-500/10" : "bg-gray-50 border border-gray-200";

  // VIP Gate
  if (!isVip) {
    return <VIPAccessGate featureName="Smart Liquidity" />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Layers className="w-6 h-6 text-pink-400" /> Smart Liquidity
          </h1>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Real AMM pools — constant-product swaps with zero mock data
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {accountId && (
            <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600">
              <Plus className="w-3 h-3" /> Create Pool
            </button>
          )}
          <button onClick={handleOracleRefresh} disabled={oracleRefreshing} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${isDark ? "bg-slate-800/50 border-pink-500/10 text-slate-300 hover:text-white" : "bg-gray-100 border-gray-200 text-gray-600 hover:text-gray-900"}`}>
            <RefreshCw className={`w-3 h-3 ${oracleRefreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3`}>
          {[
            { label: "Pools", value: stats.totalPools.toString() },
            { label: "Total TVL", value: formatUsd(stats.totalTvlUsd) },
            { label: "Volume", value: formatUsd(stats.totalVolumeUsd) },
            { label: "Avg Fee", value: formatFeeBps(stats.avgFeeBps) },
          ].map(s => (
            <div key={s.label} className={`rounded-xl p-3 text-center ${cardClass}`}>
              <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{s.label}</div>
              <div className="text-lg font-bold">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Info Banner */}
      <div className={`rounded-xl p-4 border ${isDark ? "bg-gradient-to-r from-blue-900/10 to-purple-900/10 border-blue-500/20" : "bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200"}`}>
        <div className="flex items-start gap-3">
          <Shield className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
          <div>
            <div className="text-sm font-bold mb-1">Real AMM Pools — No Mock Data</div>
            <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Pools start at zero reserves. Users provide all liquidity. Swaps use constant-product math (x &times; y = k)
              on real reserves — oracle prices are display-only. Rate limits scale with pool depth.
              Top 5 tokens: <strong>WBTC, WETH, USDC, USDT, LINK</strong>.
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {(["swap", "pools"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              activeTab === tab
                ? isDark ? "bg-pink-500/20 text-pink-400 border border-pink-500/30" : "bg-pink-50 text-pink-600 border border-pink-200"
                : isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
            }`}
          >
            {tab === "swap" ? "Swap" : `Pools (${pools.length})`}
          </button>
        ))}
      </div>

      {/* Swap Tab */}
      {activeTab === "swap" && (
        <div className="max-w-md mx-auto">
          <SwapPanel pools={pools} isDark={isDark} accountId={accountId} />
        </div>
      )}

      {/* Pools Tab */}
      {activeTab === "pools" && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
            <input
              type="text"
              placeholder="Search pools..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none ${inputClass}`}
            />
          </div>

          {loading ? (
            <div className="text-center py-12">
              <RefreshCw className={`w-6 h-6 mx-auto animate-spin ${isDark ? "text-pink-400" : "text-pink-500"}`} />
              <p className={`mt-2 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading pools...</p>
            </div>
          ) : filteredPools.length === 0 ? (
            <div className={`text-center py-12 rounded-2xl ${cardClass}`}>
              <Droplets className={`w-10 h-10 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
              <p className="font-bold mb-1">No Pools Yet</p>
              <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Create the first pool to start trading
              </p>
              {accountId && (
                <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white bg-gradient-to-r from-pink-500 to-purple-500">
                  <Plus className="w-4 h-4" /> Create Pool
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPools.map(pool => (
                <PoolCard
                  key={pool.id}
                  pool={pool}
                  isDark={isDark}
                  accountId={accountId}
                  onAddLiquidity={setLiquidityPool}
                  onRefresh={loadData}
                />
              ))}
            </div>
          )}
        </div>
      )}

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
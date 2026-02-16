/**
 * BonzoLendBorrow — Functional Lend & Borrow widget for Bonzo Finance (Aave V2 on Hedera)
 *
 * Replaces the static mockup in the DeFi "Lend & Borrow" tab with:
 *  - Live market data from Bonzo Data API + Mirror Node fallback
 *  - Sub-tabs: Supply Markets / Borrow Markets / My Positions
 *  - Action modals: Supply, Withdraw, Borrow, Repay
 *  - Health factor & borrow power display
 *  - Toast notifications for success/error
 *
 * Focused tokens: HBAR, USDC, WBTC, WETH, LINK, BONZO
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { log } from "../utils/logger";
import {
  Zap,
  Shield,
  Percent,
  Info,
  ExternalLink,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
  Heart,
  Wallet,
  TrendingUp,
  TrendingDown,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import {
  fetchBonzoMarkets,
  fetchBonzoUserPositions,
  invalidateBonzoCache,
  getBonzoLendUrl,
  getBonzoDashboardUrl,
  isBonzoConfigured,
  isBonzoLendingPoolConfigured,
  accountIdToEvmAddress,
  encodeDeposit,
  encodeWithdraw,
  encodeBorrow,
  encodeRepay,
  getBonzoLendingPoolAddress,
  type BonzoMarket,
  type BonzoProtocolStats,
  type BonzoUserSummary,
  type BonzoUserPosition,
} from "../utils/bonzo";
import { sendHederaTransaction } from "../utils/hashpack";

// ── Sub-tab definitions ──

type LendSubTab = "supply" | "borrow" | "positions";

// ── Action modal types ──

type ActionType = "supply" | "withdraw" | "borrow" | "repay";

interface ActionModalState {
  open: boolean;
  type: ActionType;
  market: BonzoMarket | null;
  position?: BonzoUserPosition;
}

// ── Formatters ──

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatTokenAmount(n: number, decimals: number = 4): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(Math.min(decimals, 8));
}

function healthFactorColor(hf: number): string {
  if (hf >= 3) return "text-emerald-400";
  if (hf >= 1.5) return "text-amber-400";
  if (hf >= 1.0) return "text-orange-400";
  return "text-red-400";
}

function healthFactorBg(hf: number, isDark: boolean): string {
  if (hf >= 3) return isDark ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200";
  if (hf >= 1.5) return isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200";
  if (hf >= 1.0) return isDark ? "bg-orange-500/10 border-orange-500/20" : "bg-orange-50 border-orange-200";
  return isDark ? "bg-red-500/10 border-red-500/20" : "bg-red-50 border-red-200";
}

// ── Action Modal ──

function ActionModal({
  state,
  onClose,
  isDark,
  accountId,
  walletBalance,
}: {
  state: ActionModalState;
  onClose: () => void;
  isDark: boolean;
  accountId: string | null;
  walletBalance: number;
}) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [txResult, setTxResult] = useState<{ success: boolean; txId: string | null; error: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { market, type, position } = state;

  useEffect(() => {
    setAmount("");
    setTxResult(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [state.open, type]);

  if (!market) return null;

  // Sanitize: type="number" can still receive "-" or "e" via paste/keyboard.
  const rawParsed = parseFloat(amount);
  const numAmount = (!isFinite(rawParsed) || rawParsed < 0) ? 0 : rawParsed;
  const hasLendingPool = isBonzoLendingPoolConfigured();

  // Determine max amount based on action type
  let maxAmount = 0;
  let maxLabel = "";
  if (type === "supply") {
    maxAmount = walletBalance;
    maxLabel = "Wallet Balance";
  } else if (type === "withdraw") {
    maxAmount = position?.supplied ?? 0;
    maxLabel = "Supplied Balance";
  } else if (type === "borrow") {
    maxAmount = market.availableLiquidityNative ?? 0;
    maxLabel = "Available Liquidity";
  } else if (type === "repay") {
    maxAmount = Math.min(position?.borrowed ?? 0, walletBalance);
    maxLabel = "Debt / Balance";
  }

  const isValidAmount = numAmount > 0 && numAmount <= maxAmount;

  // Projected annual earnings/cost
  const apy = type === "supply" || type === "withdraw"
    ? (market.supplyAPY ?? 0)
    : (market.variableBorrowAPY ?? 0);
  const annualAmount = numAmount * (apy / 100);
  const priceUSD = market.priceUSD ?? 0;
  const valueUSD = numAmount * priceUSD;
  const annualUSD = annualAmount * priceUSD;

  const handleMaxClick = () => {
    if (maxAmount > 0) {
      setAmount(maxAmount.toString());
    }
  };

  const handleExecute = async () => {
    if (!accountId || !isValidAmount) return;

    // If LendingPool not configured, redirect to Bonzo app
    if (!hasLendingPool) {
      const url = type === "supply" || type === "withdraw" ? market.supplyUrl : market.borrowUrl;
      window.open(url, "_blank", "noopener,noreferrer");
      toast.info(`Opening Bonzo Finance to ${type}...`, { description: "Complete the transaction in the Bonzo app." });
      onClose();
      return;
    }

    setLoading(true);
    setTxResult(null);

    try {
      const assetAddr = market.evmAddress;
      const userAddr = accountIdToEvmAddress(accountId);

      // String-based decimal conversion avoids Number precision loss for 18-decimal tokens.
      const amountStr = numAmount.toFixed(market.decimals); // "1.234567890000000000"
      const [intPart, fracPart = ""] = amountStr.split(".");
      const paddedFrac = fracPart.padEnd(market.decimals, "0").slice(0, market.decimals);
      const rawAmount = BigInt(intPart + paddedFrac);

      // Guard: rawAmount must be > 0 after conversion
      if (rawAmount <= 0n) {
        setTxResult({ success: false, txId: null, error: "Amount too small after conversion" });
        setLoading(false);
        return;
      }

      const lendingPoolAddr = getBonzoLendingPoolAddress();

      let calldata = "";
      switch (type) {
        case "supply":
          calldata = encodeDeposit(assetAddr, rawAmount, userAddr);
          break;
        case "withdraw":
          calldata = encodeWithdraw(assetAddr, rawAmount, userAddr);
          break;
        case "borrow":
          calldata = encodeBorrow(assetAddr, rawAmount, BigInt(2), userAddr); // 2 = variable rate
          break;
        case "repay":
          calldata = encodeRepay(assetAddr, rawAmount, BigInt(2), userAddr);
          break;
      }

      // Build ContractExecuteTransaction using @hashgraph/sdk
      const { ContractExecuteTransaction, ContractId, Hbar } = await import("@hashgraph/sdk");
      const tx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromEvmAddress(0, 0, lendingPoolAddr))
        .setFunctionParameters(Buffer.from(calldata.replace("0x", ""), "hex"))
        .setGas(500_000);

      if (type === "supply" && market.symbol === "HBAR") {
        tx.setPayableAmount(Hbar.fromTinybars(rawAmount));
      }

      const txBytes = tx.toBytes();
      const result = await sendHederaTransaction(accountId, txBytes);

      setTxResult(result);

      if (result.success) {
        toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} successful!`, {
          description: `${numAmount.toFixed(4)} ${market.symbol} — TX: ${result.transactionId}`,
        });
        invalidateBonzoCache();
      } else {
        toast.error(`${type.charAt(0).toUpperCase() + type.slice(1)} failed`, {
          description: result.error || "Transaction was not successful",
        });
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setTxResult({ success: false, txId: null, error: errMsg });
      toast.error("Transaction Error", { description: errMsg });
      log.error("Bonzo", `${type} error`, err);
    } finally {
      setLoading(false);
    }
  };

  const actionColors: Record<ActionType, { gradient: string; shadow: string }> = {
    supply: { gradient: "from-teal-600 to-emerald-600", shadow: "shadow-teal-500/20" },
    withdraw: { gradient: "from-amber-600 to-orange-600", shadow: "shadow-amber-500/20" },
    borrow: { gradient: "from-blue-600 to-indigo-600", shadow: "shadow-blue-500/20" },
    repay: { gradient: "from-purple-600 to-pink-600", shadow: "shadow-purple-500/20" },
  };

  const colors = actionColors[type];
  const actionLabel = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !loading && onClose()}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className={`relative w-full max-w-md rounded-2xl overflow-hidden border ${isDark ? "bg-[#0f0f1a] border-slate-700/50" : "bg-white border-gray-200"}`}
      >
        {/* Header */}
        <div className={`px-5 py-4 flex items-center gap-3 border-b ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
          <img src={market.logo} alt={market.symbol} className="w-9 h-9 rounded-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <div className="flex-1">
            <div className="font-bold text-lg">{actionLabel} {market.symbol}</div>
            <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              {market.name} on Bonzo Finance
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Amount Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-bold ${isDark ? "text-slate-400" : "text-gray-500"}`}>Amount</label>
              <button
                onClick={handleMaxClick}
                className={`text-xs px-2 py-0.5 rounded-full font-bold transition-colors ${isDark ? "bg-slate-800 text-teal-400 hover:bg-slate-700" : "bg-gray-100 text-teal-600 hover:bg-gray-200"}`}
              >
                {maxLabel}: {formatTokenAmount(maxAmount)}
              </button>
            </div>
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border transition-all focus-within:ring-2 ${isDark ? "bg-slate-800/50 border-slate-700 focus-within:ring-teal-500/30" : "bg-gray-50 border-gray-200 focus-within:ring-teal-500/20"}`}>
              <input
                ref={inputRef}
                type="number"
                step="any"
                min="0"
                max={maxAmount}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading}
                className="flex-1 bg-transparent outline-none text-xl font-bold tabular-nums"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <img src={market.logo} alt="" className="w-5 h-5 rounded-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <span className="text-sm font-bold">{market.symbol}</span>
              </div>
            </div>
            {priceUSD > 0 && numAmount > 0 && (
              <div className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                ~{formatUsd(valueUSD)}
              </div>
            )}
            {numAmount > maxAmount && maxAmount > 0 && (
              <div className="text-xs mt-1 text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Exceeds available {maxLabel.toLowerCase()}
              </div>
            )}
          </div>

          {/* Info Cards */}
          <div className={`rounded-xl p-3 space-y-2 ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-100"}`}>
            <div className="flex items-center justify-between text-sm">
              <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                {type === "supply" || type === "withdraw" ? "Supply APY" : "Borrow APY"}
              </span>
              <span className={`font-bold flex items-center gap-0.5 ${type === "supply" || type === "withdraw" ? "text-emerald-400" : "text-amber-400"}`}>
                {type === "supply" || type === "withdraw" ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                {apy.toFixed(2)}%
              </span>
            </div>
            {numAmount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                  {type === "supply" ? "Annual Earnings" : type === "borrow" ? "Annual Cost" : "Impact"}
                </span>
                <span className="font-bold">
                  ~{formatTokenAmount(annualAmount)} {market.symbol}
                  {priceUSD > 0 && <span className={`ml-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>({formatUsd(annualUSD)})</span>}
                </span>
              </div>
            )}
            {market.utilization != null && (
              <div className="flex items-center justify-between text-sm">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Pool Utilization</span>
                <span>{market.utilization}%</span>
              </div>
            )}
            {type === "borrow" && market.maxLTV != null && market.maxLTV > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Max LTV</span>
                <span>{market.maxLTV}%</span>
              </div>
            )}
          </div>

          {/* Health Factor Warning for borrows */}
          {type === "borrow" && (
            <div className={`rounded-xl p-3 flex items-start gap-2 text-xs ${isDark ? "bg-amber-500/5 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className={isDark ? "text-slate-300" : "text-gray-600"}>
                Keep your health factor above <strong>1.0</strong> to avoid liquidation. Higher collateral or lower borrows improve your health factor.
              </div>
            </div>
          )}

          {/* Transaction Result */}
          {txResult && (
            <div className={`rounded-xl p-3 flex items-start gap-2 text-xs ${txResult.success ? (isDark ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200") : (isDark ? "bg-red-500/10 border border-red-500/20" : "bg-red-50 border border-red-200")}`}>
              {txResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-bold">{txResult.success ? "Transaction Confirmed" : "Transaction Failed"}</div>
                {txResult.txId && (
                  <a
                    href={`https://hashscan.io/mainnet/transaction/${txResult.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal-400 hover:underline flex items-center gap-0.5 mt-0.5"
                  >
                    View on HashScan <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
                {txResult.error && <div className="text-red-400 mt-0.5">{txResult.error}</div>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
          {!accountId ? (
            <div className={`text-center text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Connect your wallet to {type}
            </div>
          ) : (
            <button
              onClick={handleExecute}
              disabled={!isValidAmount || loading}
              className={`w-full py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                isValidAmount && !loading
                  ? `bg-gradient-to-r ${colors.gradient} hover:opacity-90 text-white shadow-lg ${colors.shadow}`
                  : isDark
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {hasLendingPool ? "Confirming in Wallet..." : "Opening Bonzo..."}
                </span>
              ) : !hasLendingPool ? (
                <span className="flex items-center justify-center gap-2">
                  {actionLabel} on Bonzo <ExternalLink className="w-3.5 h-3.5" />
                </span>
              ) : (
                `${actionLabel} ${numAmount > 0 ? formatTokenAmount(numAmount) : ""} ${market.symbol}`
              )}
            </button>
          )}
          {!hasLendingPool && accountId && (
            <div className={`text-xs text-center mt-2 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
              On-chain execution will activate when LendingPool contract is configured
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main BonzoLendBorrow Component ──

export function BonzoLendBorrow() {
  const { isDark } = useTheme();
  const { primaryWallet, hederaAccount } = useWallet();

  // ── State ──
  const [markets, setMarkets] = useState<BonzoMarket[]>([]);
  const [stats, setStats] = useState<BonzoProtocolStats | null>(null);
  const [userSummary, setUserSummary] = useState<BonzoUserSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<LendSubTab>("supply");
  const [actionModal, setActionModal] = useState<ActionModalState>({ open: false, type: "supply", market: null });
  const [expandedMarket, setExpandedMarket] = useState<string | null>(null);
  const refreshRef = useRef(0);

  const accountId = hederaAccount?.accountId ?? primaryWallet?.address ?? null;
  const isHederaWallet = !!hederaAccount?.accountId;

  const cardClass = isDark
    ? "bg-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  // ── Fetch market data ──
  const loadMarkets = useCallback(async () => {
    const id = ++refreshRef.current;
    setLoading(true);
    setError(null);
    try {
      const { markets: m, stats: s } = await fetchBonzoMarkets();
      if (refreshRef.current !== id) return;
      setMarkets(m);
      setStats(s);
    } catch (err: any) {
      if (refreshRef.current !== id) return;
      setError(err.message || "Failed to load markets");
    } finally {
      if (refreshRef.current === id) setLoading(false);
    }
  }, []);

  // ── Fetch user positions ──
  const loadUserPositions = useCallback(async () => {
    if (!accountId) {
      setUserSummary(null);
      return;
    }
    try {
      const summary = await fetchBonzoUserPositions(accountId);
      setUserSummary(summary);
    } catch (err) {
      log.warn("Bonzo", "Error loading user positions", err);
    }
  }, [accountId]);

  useEffect(() => { loadMarkets(); }, [loadMarkets]);
  useEffect(() => { loadUserPositions(); }, [loadUserPositions]);

  const handleRefresh = () => {
    invalidateBonzoCache();
    loadMarkets();
    loadUserPositions();
  };

  const openAction = (type: ActionType, market: BonzoMarket, position?: BonzoUserPosition) => {
    setActionModal({ open: true, type, market, position });
  };

  // ── Compute display data ──
  const supplyMarkets = markets.filter((m) => m.canBeCollateral || m.supplyAPY != null);
  const borrowMarkets = markets.filter((m) => m.borrowEnabled !== false);
  const hasLiveData = stats?.dataSource === "live";

  // ── Sub-tabs ──
  const subTabs: { key: LendSubTab; label: string; count?: number }[] = [
    { key: "supply", label: "Supply", count: supplyMarkets.length },
    { key: "borrow", label: "Borrow", count: borrowMarkets.length },
    { key: "positions", label: "My Positions", count: userSummary?.positions.length ?? 0 },
  ];

  return (
    <div className="space-y-4">
      {/* Bonzo Finance Header */}
      <div className={`rounded-xl p-4 md:p-5 flex flex-col sm:flex-row items-start gap-4 ${isDark ? "bg-gradient-to-br from-teal-900/20 to-emerald-900/10 border border-teal-500/20" : "bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-200"}`}>
        <div className="flex items-center gap-3 shrink-0">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${isDark ? "bg-teal-500/20" : "bg-teal-100"}`}>
            <Zap className="w-6 h-6 text-teal-500" />
          </div>
          <div>
            <div className="font-bold text-sm flex items-center gap-2">
              Powered by Bonzo Finance
              <a
                href={getBonzoLendUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full transition-colors ${isDark ? "bg-teal-500/10 text-teal-400 hover:bg-teal-500/20" : "bg-teal-100 text-teal-700 hover:bg-teal-200"}`}
              >
                app.bonzo.finance/lend <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <div className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Aave V2 lending protocol on Hedera — supply assets to earn interest, borrow against collateral
            </div>
          </div>
        </div>
        <div className="flex gap-2 sm:ml-auto shrink-0">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 border border-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200"}`}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <a
            href={getBonzoLendUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20" : "bg-teal-100 text-teal-700 hover:bg-teal-200 border border-teal-200"}`}
          >
            Open Bonzo <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Protocol Stats Row */}
      {(hasLiveData || userSummary) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats?.totalSupplyUSD != null && (
            <div className={`rounded-xl p-3 ${cardClass}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total Supply</span>
              </div>
              <div className="text-lg font-bold">{formatUsd(stats.totalSupplyUSD)}</div>
            </div>
          )}
          {stats?.totalBorrowUSD != null && (
            <div className={`rounded-xl p-3 ${cardClass}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total Borrowed</span>
              </div>
              <div className="text-lg font-bold">{formatUsd(stats.totalBorrowUSD)}</div>
            </div>
          )}
          {userSummary && userSummary.totalSuppliedUSD > 0 && (
            <div className={`rounded-xl p-3 ${cardClass}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <Wallet className="w-3.5 h-3.5 text-teal-400" />
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Your Supply</span>
              </div>
              <div className="text-lg font-bold">{formatUsd(userSummary.totalSuppliedUSD)}</div>
            </div>
          )}
          {userSummary && userSummary.totalBorrowedUSD > 0 && (
            <div className={`rounded-xl p-3 border ${healthFactorBg(userSummary.healthFactor, isDark)}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <Heart className="w-3.5 h-3.5 text-pink-400" />
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Health Factor</span>
              </div>
              <div className={`text-lg font-bold ${healthFactorColor(userSummary.healthFactor)}`}>
                {userSummary.healthFactor >= 100 ? "Safe" : userSummary.healthFactor.toFixed(2)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Data Status */}
      {stats && stats.dataSource === "pending" && !loading && (
        <div className={`rounded-xl p-4 flex items-start gap-3 ${isDark ? "bg-amber-500/5 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
          <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-sm mb-0.5">Awaiting Live Data</div>
            <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Rates will populate when the Bonzo Data API or ProtocolDataProvider contract responds.
              Supply and Borrow buttons link directly to{" "}
              <a href={getBonzoLendUrl()} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">app.bonzo.finance/lend</a>{" "}
              where you can interact with pools now.
            </div>
          </div>
        </div>
      )}

      {/* Loading State — Skeleton shimmer */}
      {loading && markets.length === 0 && (
        <div className={`rounded-xl overflow-hidden ${cardClass}`} role="status" aria-label="Loading Bonzo markets">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`flex items-center gap-4 px-4 py-3.5 ${
                isDark ? "border-b border-white/[0.04]" : "border-b border-gray-100"
              }`}
            >
              <div className={`w-8 h-8 rounded-full ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`} aria-hidden="true">
                <div className="absolute inset-0 skeleton-shimmer" />
              </div>
              <div className="flex-1 space-y-2">
                <div className={`h-3.5 w-20 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                <div className={`h-2.5 w-32 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
              </div>
              <div className={`h-4 w-14 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
              <div className={`h-4 w-14 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
            </div>
          ))}
          <span className="sr-only">Loading Bonzo markets...</span>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className={`rounded-xl p-4 flex items-start gap-3 ${isDark ? "bg-red-500/5 border border-red-500/20" : "bg-red-50 border border-red-200"}`}>
          <Info className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-bold">Connection issue: </span>
            <span className={isDark ? "text-slate-400" : "text-gray-500"}>{error}</span>
          </div>
        </div>
      )}

      {/* Markets Content */}
      {markets.length > 0 && (
        <>
          {/* Sub-tab Navigation */}
          <div className={`rounded-lg p-0.5 flex gap-0.5 ${isDark ? "bg-slate-800/50" : "bg-gray-100"}`}>
            {subTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSubTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-bold transition-all ${
                  subTab === tab.key
                    ? "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md"
                    : isDark
                    ? "text-slate-400 hover:text-white hover:bg-slate-700/50"
                    : "text-gray-500 hover:text-gray-900 hover:bg-white"
                }`}
              >
                {tab.label}
                {tab.count != null && tab.count > 0 && (
                  <span className={`text-xs px-1 py-0.5 rounded-full ${subTab === tab.key ? "bg-white/20" : isDark ? "bg-slate-700" : "bg-gray-200"}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ═══ SUPPLY MARKETS ═══ */}
          {subTab === "supply" && (
            <div className={`rounded-xl overflow-hidden ${cardClass}`}>
              {/* Header */}
              <div className={`hidden md:grid grid-cols-12 gap-3 px-4 py-3 text-xs uppercase tracking-wider ${isDark ? "text-slate-500 border-b border-teal-500/10" : "text-gray-400 border-b border-gray-100"}`}>
                <div className="col-span-3">Asset</div>
                <div className="col-span-2 text-right">Supply APY</div>
                <div className="col-span-2 text-right">Total Supplied</div>
                <div className="col-span-2 text-right">Collateral</div>
                <div className="col-span-3 text-center">Actions</div>
              </div>

              {supplyMarkets.map((market) => {
                const expanded = expandedMarket === market.id + "-supply";
                return (
                  <div key={market.id}>
                    <div
                      onClick={() => setExpandedMarket(expanded ? null : market.id + "-supply")}
                      className={`grid grid-cols-1 md:grid-cols-12 gap-3 px-4 py-4 cursor-pointer transition-all ${
                        expanded
                          ? isDark ? "bg-teal-500/5" : "bg-teal-50/50"
                          : isDark ? "hover:bg-slate-800/30" : "hover:bg-gray-50"
                      } ${isDark ? "border-b border-teal-500/5" : "border-b border-gray-50"}`}
                    >
                      {/* Asset */}
                      <div className="md:col-span-3 flex items-center gap-3">
                        <img src={market.logo} alt={market.symbol} className="w-9 h-9 rounded-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        <div>
                          <div className="font-bold text-sm flex items-center gap-1.5">
                            {market.symbol}
                            {market.canBeCollateral && <Shield className={`w-3 h-3 ${isDark ? "text-teal-500" : "text-teal-600"}`} />}
                          </div>
                          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            {market.name}
                          </div>
                        </div>
                      </div>

                      {/* Mobile Stats */}
                      <div className="grid grid-cols-3 gap-3 md:hidden">
                        <div>
                          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Supply APY</div>
                          <div className="text-sm font-bold">
                            {market.supplyAPY != null ? (
                              <span className="text-emerald-400 flex items-center gap-0.5">
                                <ArrowUpRight className="w-3 h-3" />
                                {market.supplyAPY.toFixed(2)}%
                              </span>
                            ) : (
                              <span className={isDark ? "text-slate-600" : "text-gray-300"}>--</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Supplied</div>
                          <div className="text-sm font-bold">
                            {market.totalSupplyUSD != null ? formatUsd(market.totalSupplyUSD) : "--"}
                          </div>
                        </div>
                        <div>
                          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Collateral</div>
                          <div className="text-sm font-bold">
                            {market.canBeCollateral ? (
                              <span className="text-emerald-400">{market.maxLTV}% LTV</span>
                            ) : (
                              <span className={isDark ? "text-slate-600" : "text-gray-300"}>No</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Desktop: Supply APY */}
                      <div className="hidden md:flex col-span-2 items-center justify-end">
                        {market.supplyAPY != null ? (
                          <span className="font-bold text-sm text-emerald-400 flex items-center gap-0.5">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            {market.supplyAPY.toFixed(2)}%
                          </span>
                        ) : (
                          <span className={`text-sm ${isDark ? "text-slate-600" : "text-gray-300"}`}>--</span>
                        )}
                      </div>

                      {/* Desktop: Total Supplied */}
                      <div className="hidden md:flex col-span-2 items-center justify-end">
                        {market.totalSupplyUSD != null ? (
                          <span className="text-sm font-bold">{formatUsd(market.totalSupplyUSD)}</span>
                        ) : market.totalSupplyNative != null ? (
                          <span className="text-sm">{formatTokenAmount(market.totalSupplyNative)} {market.symbol}</span>
                        ) : (
                          <span className={`text-sm ${isDark ? "text-slate-600" : "text-gray-300"}`}>--</span>
                        )}
                      </div>

                      {/* Desktop: Collateral */}
                      <div className="hidden md:flex col-span-2 items-center justify-end">
                        {market.canBeCollateral ? (
                          <span className={`text-xs px-2 py-1 rounded-full font-bold ${isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-700"}`}>
                            {market.maxLTV}% LTV
                          </span>
                        ) : (
                          <span className={`text-xs ${isDark ? "text-slate-600" : "text-gray-300"}`}>--</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="md:col-span-3 flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openAction("supply", market)}
                          className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-teal-500/20"
                        >
                          Supply
                        </button>
                        <button
                          onClick={() => openAction("withdraw", market)}
                          className={`flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700" : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"}`}
                        >
                          Withdraw
                        </button>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {expanded && (
                      <div className={`px-4 py-3 ${isDark ? "bg-teal-500/5 border-b border-teal-500/10" : "bg-teal-50/30 border-b border-gray-100"}`}>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className={`text-xs mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Utilization</div>
                            <div className="font-bold">{market.utilization != null ? `${market.utilization}%` : "--"}</div>
                          </div>
                          <div>
                            <div className={`text-xs mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Liquidation Threshold</div>
                            <div className="font-bold">{market.liquidationThreshold != null ? `${market.liquidationThreshold}%` : "--"}</div>
                          </div>
                          <div>
                            <div className={`text-xs mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Available Liquidity</div>
                            <div className="font-bold">{market.availableLiquidityUSD != null ? formatUsd(market.availableLiquidityUSD) : market.availableLiquidityNative != null ? `${formatTokenAmount(market.availableLiquidityNative)} ${market.symbol}` : "--"}</div>
                          </div>
                          <div>
                            <div className={`text-xs mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Token ID</div>
                            <div className={`font-mono text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{market.hederaTokenId}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ BORROW MARKETS ═══ */}
          {subTab === "borrow" && (
            <div className={`rounded-xl overflow-hidden ${cardClass}`}>
              {/* Header */}
              <div className={`hidden md:grid grid-cols-12 gap-3 px-4 py-3 text-xs uppercase tracking-wider ${isDark ? "text-slate-500 border-b border-teal-500/10" : "text-gray-400 border-b border-gray-100"}`}>
                <div className="col-span-3">Asset</div>
                <div className="col-span-2 text-right">Borrow APY</div>
                <div className="col-span-2 text-right">Available</div>
                <div className="col-span-2 text-right">Utilization</div>
                <div className="col-span-3 text-center">Actions</div>
              </div>

              {borrowMarkets.map((market) => {
                const expanded = expandedMarket === market.id + "-borrow";
                return (
                  <div key={market.id}>
                    <div
                      onClick={() => setExpandedMarket(expanded ? null : market.id + "-borrow")}
                      className={`grid grid-cols-1 md:grid-cols-12 gap-3 px-4 py-4 cursor-pointer transition-all ${
                        expanded
                          ? isDark ? "bg-blue-500/5" : "bg-blue-50/50"
                          : isDark ? "hover:bg-slate-800/30" : "hover:bg-gray-50"
                      } ${isDark ? "border-b border-teal-500/5" : "border-b border-gray-50"}`}
                    >
                      {/* Asset */}
                      <div className="md:col-span-3 flex items-center gap-3">
                        <img src={market.logo} alt={market.symbol} className="w-9 h-9 rounded-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        <div>
                          <div className="font-bold text-sm">{market.symbol}</div>
                          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{market.name}</div>
                        </div>
                      </div>

                      {/* Mobile Stats */}
                      <div className="grid grid-cols-3 gap-3 md:hidden">
                        <div>
                          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Borrow APY</div>
                          <div className="text-sm font-bold">
                            {market.variableBorrowAPY != null ? (
                              <span className="text-amber-400 flex items-center gap-0.5">
                                <ArrowDownRight className="w-3 h-3" />
                                {market.variableBorrowAPY.toFixed(2)}%
                              </span>
                            ) : (
                              <span className={isDark ? "text-slate-600" : "text-gray-300"}>--</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Available</div>
                          <div className="text-sm font-bold">
                            {market.availableLiquidityUSD != null ? formatUsd(market.availableLiquidityUSD) : "--"}
                          </div>
                        </div>
                        <div>
                          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Util</div>
                          <div className="text-sm font-bold">
                            {market.utilization != null ? `${market.utilization}%` : "--"}
                          </div>
                        </div>
                      </div>

                      {/* Desktop: Borrow APY */}
                      <div className="hidden md:flex col-span-2 items-center justify-end">
                        {market.variableBorrowAPY != null ? (
                          <span className="font-bold text-sm text-amber-400 flex items-center gap-0.5">
                            <ArrowDownRight className="w-3.5 h-3.5" />
                            {market.variableBorrowAPY.toFixed(2)}%
                          </span>
                        ) : (
                          <span className={`text-sm ${isDark ? "text-slate-600" : "text-gray-300"}`}>--</span>
                        )}
                      </div>

                      {/* Desktop: Available Liquidity */}
                      <div className="hidden md:flex col-span-2 items-center justify-end">
                        {market.availableLiquidityUSD != null ? (
                          <span className="text-sm font-bold">{formatUsd(market.availableLiquidityUSD)}</span>
                        ) : market.availableLiquidityNative != null ? (
                          <span className="text-sm">{formatTokenAmount(market.availableLiquidityNative)} {market.symbol}</span>
                        ) : (
                          <span className={`text-sm ${isDark ? "text-slate-600" : "text-gray-300"}`}>--</span>
                        )}
                      </div>

                      {/* Desktop: Utilization */}
                      <div className="hidden md:flex col-span-2 items-center justify-end gap-2">
                        {market.utilization != null ? (
                          <>
                            <div className={`w-16 h-1.5 rounded-full overflow-hidden ${isDark ? "bg-slate-800" : "bg-gray-200"}`}>
                              <div
                                className={`h-full rounded-full ${
                                  market.utilization > 80 ? "bg-red-500" : market.utilization > 50 ? "bg-amber-500" : "bg-teal-500"
                                }`}
                                style={{ width: `${market.utilization}%` }}
                              />
                            </div>
                            <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{market.utilization}%</span>
                          </>
                        ) : (
                          <span className={`text-sm ${isDark ? "text-slate-600" : "text-gray-300"}`}>--</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="md:col-span-3 flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openAction("borrow", market)}
                          className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-500/20"
                        >
                          Borrow
                        </button>
                        <button
                          onClick={() => openAction("repay", market)}
                          className={`flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700" : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"}`}
                        >
                          Repay
                        </button>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {expanded && (
                      <div className={`px-4 py-3 ${isDark ? "bg-blue-500/5 border-b border-blue-500/10" : "bg-blue-50/30 border-b border-gray-100"}`}>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className={`text-xs mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Total Borrowed</div>
                            <div className="font-bold">{market.totalBorrowUSD != null ? formatUsd(market.totalBorrowUSD) : "--"}</div>
                          </div>
                          <div>
                            <div className={`text-xs mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Liquidation Bonus</div>
                            <div className="font-bold">{market.liquidationBonus != null ? `${market.liquidationBonus}%` : "--"}</div>
                          </div>
                          <div>
                            <div className={`text-xs mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Max LTV</div>
                            <div className="font-bold">{market.maxLTV != null ? `${market.maxLTV}%` : "--"}</div>
                          </div>
                          <div>
                            <div className={`text-xs mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Rate Mode</div>
                            <div className="font-bold">Variable</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ MY POSITIONS ═══ */}
          {subTab === "positions" && (
            <div className="space-y-4">
              {!accountId ? (
                <div className={`rounded-xl p-8 text-center ${cardClass}`}>
                  <Wallet className={`w-10 h-10 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                  <div className={`font-bold mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Connect Wallet</div>
                  <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Connect your Hedera wallet to view your Bonzo positions
                  </div>
                </div>
              ) : !userSummary || userSummary.positions.length === 0 ? (
                <div className={`rounded-xl p-8 text-center ${cardClass}`}>
                  <DollarSign className={`w-10 h-10 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                  <div className={`font-bold mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>No Active Positions</div>
                  <div className={`text-xs mb-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Supply assets to start earning yield, or borrow against your collateral
                  </div>
                  <div className="flex justify-center gap-2">
                    <button
                      onClick={() => setSubTab("supply")}
                      className="px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-lg text-xs font-bold"
                    >
                      Supply Assets
                    </button>
                    <a
                      href={getBonzoDashboardUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1 ${isDark ? "bg-slate-800 text-slate-300" : "bg-gray-100 text-gray-700"}`}
                    >
                      Bonzo Dashboard <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ) : (
                <>
                  {/* Position Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className={`rounded-xl p-3 ${cardClass}`}>
                      <div className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Total Supplied</div>
                      <div className="text-lg font-bold text-emerald-400">{formatUsd(userSummary.totalSuppliedUSD)}</div>
                    </div>
                    <div className={`rounded-xl p-3 ${cardClass}`}>
                      <div className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Total Borrowed</div>
                      <div className="text-lg font-bold text-amber-400">{formatUsd(userSummary.totalBorrowedUSD)}</div>
                    </div>
                    <div className={`rounded-xl p-3 border ${healthFactorBg(userSummary.healthFactor, isDark)}`}>
                      <div className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Health Factor</div>
                      <div className={`text-lg font-bold ${healthFactorColor(userSummary.healthFactor)}`}>
                        {userSummary.healthFactor >= 100 ? "Safe" : userSummary.healthFactor.toFixed(2)}
                      </div>
                    </div>
                    <div className={`rounded-xl p-3 ${cardClass}`}>
                      <div className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Net APY</div>
                      <div className={`text-lg font-bold ${userSummary.netAPY >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {userSummary.netAPY >= 0 ? "+" : ""}{userSummary.netAPY.toFixed(2)}%
                      </div>
                    </div>
                  </div>

                  {/* Borrow Power Bar */}
                  {userSummary.borrowPowerUsed > 0 && (
                    <div className={`rounded-xl p-3 ${cardClass}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Borrow Power Used</span>
                        <span className="text-xs font-bold">{userSummary.borrowPowerUsed.toFixed(1)}%</span>
                      </div>
                      <div className={`h-2 rounded-full overflow-hidden ${isDark ? "bg-slate-800" : "bg-gray-200"}`}>
                        <div
                          className={`h-full rounded-full transition-all ${
                            userSummary.borrowPowerUsed > 80 ? "bg-red-500" : userSummary.borrowPowerUsed > 50 ? "bg-amber-500" : "bg-teal-500"
                          }`}
                          style={{ width: `${Math.min(userSummary.borrowPowerUsed, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Position Rows */}
                  <div className={`rounded-xl overflow-hidden ${cardClass}`}>
                    <div className={`hidden md:grid grid-cols-12 gap-3 px-4 py-3 text-xs uppercase tracking-wider ${isDark ? "text-slate-500 border-b border-teal-500/10" : "text-gray-400 border-b border-gray-100"}`}>
                      <div className="col-span-3">Asset</div>
                      <div className="col-span-2 text-right">Supplied</div>
                      <div className="col-span-2 text-right">Borrowed</div>
                      <div className="col-span-2 text-right">APY</div>
                      <div className="col-span-3 text-center">Actions</div>
                    </div>

                    {userSummary.positions.map((pos) => {
                      const market = markets.find((m) => m.symbol === pos.symbol);
                      return (
                        <div
                          key={pos.symbol}
                          className={`grid grid-cols-1 md:grid-cols-12 gap-3 px-4 py-4 ${isDark ? "border-b border-teal-500/5" : "border-b border-gray-50"}`}
                        >
                          {/* Asset */}
                          <div className="md:col-span-3 flex items-center gap-3">
                            <img src={pos.logo} alt={pos.symbol} className="w-9 h-9 rounded-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            <div>
                              <div className="font-bold text-sm">{pos.symbol}</div>
                              <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                                {pos.usedAsCollateral ? "Collateral active" : "No collateral"}
                              </div>
                            </div>
                          </div>

                          {/* Mobile Stats */}
                          <div className="grid grid-cols-3 gap-2 md:hidden">
                            <div>
                              <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Supplied</div>
                              <div className="text-sm font-bold text-emerald-400">{formatTokenAmount(pos.supplied)}</div>
                              <div className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>{formatUsd(pos.suppliedUSD)}</div>
                            </div>
                            <div>
                              <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Borrowed</div>
                              <div className="text-sm font-bold text-amber-400">{pos.borrowed > 0 ? formatTokenAmount(pos.borrowed) : "--"}</div>
                              {pos.borrowed > 0 && <div className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>{formatUsd(pos.borrowedUSD)}</div>}
                            </div>
                            <div>
                              <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>APY</div>
                              <div className="text-sm font-bold text-emerald-400">+{pos.supplyAPY.toFixed(2)}%</div>
                            </div>
                          </div>

                          {/* Desktop: Supplied */}
                          <div className="hidden md:flex col-span-2 items-center justify-end flex-col">
                            <span className="text-sm font-bold text-emerald-400">{formatTokenAmount(pos.supplied)}</span>
                            <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{formatUsd(pos.suppliedUSD)}</span>
                          </div>

                          {/* Desktop: Borrowed */}
                          <div className="hidden md:flex col-span-2 items-center justify-end flex-col">
                            {pos.borrowed > 0 ? (
                              <>
                                <span className="text-sm font-bold text-amber-400">{formatTokenAmount(pos.borrowed)}</span>
                                <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{formatUsd(pos.borrowedUSD)}</span>
                              </>
                            ) : (
                              <span className={`text-sm ${isDark ? "text-slate-600" : "text-gray-300"}`}>--</span>
                            )}
                          </div>

                          {/* Desktop: APY */}
                          <div className="hidden md:flex col-span-2 items-center justify-end flex-col">
                            <span className="text-sm font-bold text-emerald-400">+{pos.supplyAPY.toFixed(2)}%</span>
                            {pos.borrowed > 0 && (
                              <span className="text-xs text-amber-400">-{pos.borrowAPY.toFixed(2)}%</span>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="md:col-span-3 flex items-center justify-center gap-1.5 flex-wrap">
                            {market && (
                              <>
                                {pos.supplied > 0 && (
                                  <button
                                    onClick={() => openAction("withdraw", market, pos)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20" : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"}`}
                                  >
                                    Withdraw
                                  </button>
                                )}
                                <button
                                  onClick={() => openAction("supply", market)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20" : "bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200"}`}
                                >
                                  Supply More
                                </button>
                                {pos.borrowed > 0 && (
                                  <button
                                    onClick={() => openAction("repay", market, pos)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isDark ? "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20" : "bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"}`}
                                  >
                                    Repay
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Info Footer */}
          <div className={`rounded-xl p-4 ${isDark ? "bg-slate-900/20 border border-slate-800" : "bg-gray-50 border border-gray-200"}`}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className={`p-3 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                <div className="font-bold mb-1 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-teal-400" />
                  How Supply Works
                </div>
                <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                  Deposit assets into Bonzo lending pools to earn interest. Supply APY adjusts with pool utilization. Withdraw anytime.
                </div>
              </div>
              <div className={`p-3 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                <div className="font-bold mb-1 flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-amber-400" />
                  How Borrow Works
                </div>
                <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                  Supply collateral on Bonzo, then borrow other assets. Variable interest accrues per block. Keep your health factor above 1.0.
                </div>
              </div>
              <div className={`p-3 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                <div className="font-bold mb-1 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-400" />
                  Data Pipeline
                </div>
                <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                  {hasLiveData
                    ? "Live rates fetched from Bonzo Data API."
                    : isBonzoConfigured()
                    ? "Rates from on-chain ProtocolDataProvider."
                    : "Rates will activate when the Bonzo Data API or contract addresses are configured."
                  }{" "}
                  <a href="https://github.com/Bonzo-Labs/bonzo-finance-contracts" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">
                    View contracts
                  </a>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Action Modal */}
      <AnimatePresence>
        {actionModal.open && actionModal.market && (
          <ActionModal
            state={actionModal}
            onClose={() => setActionModal({ open: false, type: "supply", market: null })}
            isDark={isDark}
            accountId={accountId}
            walletBalance={0} // Actual balance would come from wallet context / HTS query
          />
        )}
      </AnimatePresence>
    </div>
  );
}

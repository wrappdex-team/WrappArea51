/**
 * RemoveLiquidityV2Modal — SaucerSwap V2 Concentrated Liquidity Removal
 *
 * Features:
 *   - Percentage slider with presets (25%, 50%, 75%, 100%)
 *   - Preview of token amounts to receive
 *   - Unclaimed fees breakdown
 *   - Burn NFT toggle (only at 100%)
 *   - "Collect Fees Only" secondary action
 *   - Live step-progress during execution
 *   - HashScan link on success
 *   - WHBAR auto-unwrap for HBAR pools
 *
 * [LP-08] Step 8 of the V2 Liquidity Master Plan.
 * [LP-08-ENGINE] Wired to v2-remove-engine.ts for real on-chain execution.
 */

import { useState, useMemo } from "react";
import {
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Trash2,
  Gift,
  Info,
  Fuel,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import { TokenIcon } from "./TokenIcon";
import type { V2PositionEnriched } from "../utils/saucerswap/positions";
import { invalidatePositionCacheForAccount } from "../utils/saucerswap/positions";
import {
  computeBurnAmounts,
  burnAmountsWithSlippage,
} from "../utils/saucerswap/tick-math";
import {
  V2_GAS_LIMITS,
  formatGasCost,
  classifyContractError,
} from "../utils/saucerswap/v2-liquidity-constants";
import { V2TokenAssociationGuard, type GuardResult } from "./V2TokenAssociationGuard";
import { logLpOperation } from "../utils/saucerswap/v2-lp-history";
import { removeLiquidity, collectFees } from "../utils/saucerswap/v2-remove-engine";

type ModalState = "idle" | "confirming" | "success" | "error";

interface RemoveLiquidityV2ModalProps {
  position: V2PositionEnriched;
  onClose: () => void;
  onSuccess?: () => void;
  /** If true, opens in "Collect Fees Only" mode */
  collectOnly?: boolean;
}

const PERCENT_PRESETS = [25, 50, 75, 100];

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  if (n > 0) return n.toExponential(2);
  return "0";
}

function formatUsd(n: number): string {
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  if (n > 0) return "<$0.01";
  return "$0.00";
}

export function RemoveLiquidityV2Modal({
  position: pos,
  onClose,
  onSuccess,
  collectOnly = false,
}: RemoveLiquidityV2ModalProps) {
  const { isDark } = useTheme();
  const { hederaNetwork, primaryWallet, hederaAccount, refreshHederaBalance } = useWallet();
  const accountId = hederaAccount?.accountId || primaryWallet?.accountId || "";

  const [percent, setPercent] = useState(collectOnly ? 0 : 100);
  const [burnNFT, setBurnNFT] = useState(false);
  const [slippageBps, setSlippageBps] = useState(100);
  const [modalState, setModalState] = useState<ModalState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txId, setTxId] = useState("");
  const [isCollectMode, setIsCollectMode] = useState(collectOnly);
  const [guardResult, setGuardResult] = useState<GuardResult>("pending");
  const [execStep, setExecStep] = useState<{ step: number; total: number; desc: string } | null>(null);

  // ── WHBAR Detection ───────────────────────────────────────────────
  const WHBAR_HTS_IDS = ["0.0.1456986", "0.0.1456985"];
  const isToken0Hbar = pos.token0.symbol === "HBAR" || WHBAR_HTS_IDS.includes(pos.token0.htsId);
  const isToken1Hbar = pos.token1.symbol === "HBAR" || WHBAR_HTS_IDS.includes(pos.token1.htsId);
  const poolInvolvesHbar = isToken0Hbar || isToken1Hbar;

  // ── Compute removal amounts ───────────────────────────────────────
  const burnResult = useMemo(() => {
    if (percent <= 0 || pos.liquidity <= 0n || isCollectMode) return null;
    try {
      return computeBurnAmounts(
        pos.sqrtPriceX96,
        pos.tickLower,
        pos.tickUpper,
        pos.liquidity,
        percent * 100, // Convert to basis points (100% = 10000 bps)
      );
    } catch {
      return null;
    }
  }, [pos, percent, isCollectMode]);

  const slippageResult = useMemo(() => {
    if (!burnResult) return null;
    return burnAmountsWithSlippage(burnResult, slippageBps);
  }, [burnResult, slippageBps]);

  // Token amounts to receive
  const receive0 = burnResult
    ? Number(burnResult.amount0) / Math.pow(10, pos.token0.decimals)
    : 0;
  const receive1 = burnResult
    ? Number(burnResult.amount1) / Math.pow(10, pos.token1.decimals)
    : 0;
  const receiveUsd = receive0 * pos.token0.priceUsd + receive1 * pos.token1.priceUsd;

  // ── [LP-08-ENGINE] Execute — real on-chain flow ───────────────────
  const handleExecute = async () => {
    setModalState("confirming");
    setErrorMsg("");
    setExecStep(null);

    try {
      if (isCollectMode) {
        // ── COLLECT FEES ONLY ─────────────────────────────────────
        console.log("[LP-08] ═══ COLLECT FEES EXECUTION STARTING ═══");
        console.log(`[LP-08] NFT #${pos.tokenSN} — ${pos.token0.symbol}/${pos.token1.symbol}`);

        const result = await collectFees({
          accountId,
          network: (hederaNetwork || "mainnet") as any,
          tokenSN: pos.tokenSN,
          poolInvolvesHbar,
          token0Symbol: pos.token0.symbol,
          token1Symbol: pos.token1.symbol,
          onStep: (step, total, desc) => {
            setExecStep({ step, total, desc });
          },
        });

        if (result.userCancelled) {
          setModalState("idle");
          setExecStep(null);
          toast.info("Transaction cancelled in wallet");
          return;
        }

        if (!result.success) {
          setModalState("error");
          const classified = classifyContractError(result.error || "Collect failed");
          setErrorMsg(classified.message);
          console.error("[LP-08] Collect failed:", result.error);
          return;
        }

        // SUCCESS
        setModalState("success");
        setTxId(result.transactionId || "");
        setExecStep(null);
        toast.success("Fees collected!", {
          description: result.transactionId
            ? `TX: ${result.transactionId.slice(0, 20)}...`
            : undefined,
        });

        // Refresh balances + invalidate position cache
        refreshHederaBalance().catch(() => {});
        invalidatePositionCacheForAccount(accountId, (hederaNetwork || "mainnet") as any);

        if (accountId) {
          logLpOperation(accountId, {
            action: "collect",
            tokenSN: pos.tokenSN,
            pool: `${pos.token0.symbol}/${pos.token1.symbol}`,
            amount0: pos.tokensOwed0.toString(),
            amount1: pos.tokensOwed1.toString(),
            token0Symbol: pos.token0.symbol,
            token1Symbol: pos.token1.symbol,
            valueUsd: pos.totalFeesUsd,
            txHash: result.transactionId,
            network: hederaNetwork || "mainnet",
            status: "success",
          }).catch(() => {});
        }

        onSuccess?.();

      } else {
        // ── REMOVE LIQUIDITY ──────────────────────────────────────
        if (!burnResult || !slippageResult) {
          setModalState("error");
          setErrorMsg("Cannot compute removal amounts. Please try again.");
          return;
        }

        console.log("[LP-08] ═══ REMOVE LIQUIDITY EXECUTION STARTING ═══");
        console.log(`[LP-08] NFT #${pos.tokenSN} — ${pos.token0.symbol}/${pos.token1.symbol}`);
        console.log(`[LP-08] Percent: ${percent}% | Burn: ${burnNFT && percent === 100}`);
        console.log(`[LP-08] Liquidity: ${burnResult.liquidityToRemove.toString()}`);

        const result = await removeLiquidity({
          accountId,
          network: (hederaNetwork || "mainnet") as any,
          tokenSN: pos.tokenSN,
          liquidityToRemove: burnResult.liquidityToRemove,
          amount0Min: slippageResult.amount0Min,
          amount1Min: slippageResult.amount1Min,
          poolInvolvesHbar,
          burnNFT: burnNFT && percent === 100,
          token0Symbol: pos.token0.symbol,
          token1Symbol: pos.token1.symbol,
          onStep: (step, total, desc) => {
            setExecStep({ step, total, desc });
          },
        });

        if (result.userCancelled) {
          setModalState("idle");
          setExecStep(null);
          toast.info("Transaction cancelled in wallet");
          return;
        }

        if (!result.success) {
          setModalState("error");
          const classified = classifyContractError(result.error || "Remove failed");
          setErrorMsg(classified.message);
          console.error("[LP-08] Remove failed:", result.error);
          return;
        }

        // SUCCESS
        setModalState("success");
        setTxId(result.transactionId || "");
        setExecStep(null);
        toast.success(
          burnNFT && percent === 100
            ? "Position closed & NFT burned!"
            : `${percent}% liquidity removed!`,
          {
            description: result.transactionId
              ? `TX: ${result.transactionId.slice(0, 20)}...`
              : undefined,
          },
        );

        // Refresh balances + invalidate position cache
        refreshHederaBalance().catch(() => {});
        invalidatePositionCacheForAccount(accountId, (hederaNetwork || "mainnet") as any);

        if (accountId) {
          logLpOperation(accountId, {
            action: "decrease",
            tokenSN: pos.tokenSN,
            pool: `${pos.token0.symbol}/${pos.token1.symbol}`,
            amount0: burnResult.amount0.toString(),
            amount1: burnResult.amount1.toString(),
            token0Symbol: pos.token0.symbol,
            token1Symbol: pos.token1.symbol,
            valueUsd: receiveUsd,
            txHash: result.transactionId,
            network: hederaNetwork || "mainnet",
            status: "success",
          }).catch(() => {});
        }

        onSuccess?.();
      }
    } catch (err: any) {
      console.error("[LP-08] Unexpected execution error:", err);
      const classified = classifyContractError(err);
      setErrorMsg(classified.message);
      if (classified.code === "USER_REJECTED") {
        setModalState("idle");
        toast.info("Transaction cancelled");
      } else {
        setModalState("error");
      }
    }
  };

  // ── Styling ───────────────────────────────────────────────────────
  const overlayClass = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm";
  const modalClass = isDark
    ? "bg-slate-900 border border-pink-500/20 text-white"
    : "bg-white border border-gray-200 text-gray-900";
  const labelClass = isDark ? "text-slate-400" : "text-gray-500";

  return (
    <div className={overlayClass} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className={`${modalClass} rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-pink-500/10">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <TokenIcon src={pos.token0.logo} symbol={pos.token0.symbol} className="w-7 h-7 ring-2 ring-slate-900/50 z-10" />
              <TokenIcon src={pos.token1.logo} symbol={pos.token1.symbol} className="w-7 h-7 ring-2 ring-slate-900/50" />
            </div>
            <div>
              <div className="font-bold text-sm">
                {isCollectMode ? "Collect Fees" : "Remove Liquidity"}
              </div>
              <div className={`text-xs ${labelClass}`}>
                {pos.token0.symbol}/{pos.token1.symbol} · {pos.feePercent}% · NFT #{pos.tokenSN}
              </div>
            </div>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Content */}
        {modalState === "idle" && (
          <div className="p-4 space-y-4">
            {/* Mode Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => { setIsCollectMode(false); setPercent(100); }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  !isCollectMode
                    ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
                    : isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-500"
                }`}
              >
                Remove Liquidity
              </button>
              <button
                onClick={() => { setIsCollectMode(true); setPercent(0); }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  isCollectMode
                    ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/20"
                    : isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-500"
                }`}
              >
                <Gift className="w-3.5 h-3.5 inline mr-1" />
                Collect Fees Only
              </button>
            </div>

            {/* Removal Amount (not shown in collect mode) */}
            {!isCollectMode && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-bold ${labelClass}`}>Amount to Remove</span>
                  <span className="text-2xl font-bold">{percent}%</span>
                </div>

                {/* Slider */}
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={percent}
                  onChange={(e) => setPercent(parseInt(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer bg-slate-700/30
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r
                    [&::-webkit-slider-thumb]:from-pink-500 [&::-webkit-slider-thumb]:to-purple-500
                    [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-pink-500/30"
                />

                {/* Preset Buttons */}
                <div className="flex gap-1.5 mt-2">
                  {PERCENT_PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPercent(p)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        percent === p
                          ? "bg-pink-600 text-white"
                          : isDark ? "bg-slate-800 text-slate-400 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Preview: Tokens to Receive */}
            {!isCollectMode && burnResult && (
              <div className={`rounded-lg p-3 ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                <div className={`text-xs font-bold mb-2 ${labelClass}`}>You Will Receive</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TokenIcon src={pos.token0.logo} symbol={pos.token0.symbol} className="w-5 h-5" />
                      <span className="text-sm font-bold">{pos.token0.symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm">{formatAmount(receive0)}</div>
                      <div className={`text-xs ${labelClass}`}>{formatUsd(receive0 * pos.token0.priceUsd)}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TokenIcon src={pos.token1.logo} symbol={pos.token1.symbol} className="w-5 h-5" />
                      <span className="text-sm font-bold">{pos.token1.symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm">{formatAmount(receive1)}</div>
                      <div className={`text-xs ${labelClass}`}>{formatUsd(receive1 * pos.token1.priceUsd)}</div>
                    </div>
                  </div>
                  <div className={`flex justify-between pt-2 border-t text-sm font-bold ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <span>Total Value</span>
                    <span>{formatUsd(receiveUsd)}</span>
                  </div>
                  {/* WHBAR auto-unwrap note */}
                  {poolInvolvesHbar && (
                    <div className={`flex items-center gap-1.5 pt-1 text-xs ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>
                      <Info className="w-3 h-3 shrink-0" />
                      You will receive WHBAR — use Wrap/Unwrap to convert to native HBAR
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Unclaimed Fees */}
            {pos.totalFeesUsd > 0 && (
              <div className={`rounded-lg p-3 ${isDark ? "bg-emerald-500/5 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"}`}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Gift className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400">
                    {isCollectMode ? "Fees to Collect" : "Accrued Fees (included)"}
                  </span>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span>{pos.token0.symbol}</span>
                    <span className="font-mono">{formatAmount(pos.feesOwed0Human)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{pos.token1.symbol}</span>
                    <span className="font-mono">{formatAmount(pos.feesOwed1Human)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-emerald-500/20">
                    <span>Total</span>
                    <span>{formatUsd(pos.totalFeesUsd)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Burn NFT Toggle (only at 100%) */}
            {!isCollectMode && percent === 100 && (
              <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                isDark ? "bg-slate-800/50 hover:bg-slate-800" : "bg-gray-50 hover:bg-gray-100"
              }`}>
                <input
                  type="checkbox"
                  checked={burnNFT}
                  onChange={(e) => setBurnNFT(e.target.checked)}
                  className="w-4 h-4 rounded border-pink-500 text-pink-600 focus:ring-pink-500"
                />
                <div>
                  <div className="text-sm font-bold flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" /> Burn NFT Position
                  </div>
                  <div className={`text-xs ${labelClass}`}>
                    Permanently destroy the LP NFT after full withdrawal
                  </div>
                </div>
              </label>
            )}

            {/* Slippage (only for removal) */}
            {!isCollectMode && (
              <div className="flex items-center justify-between">
                <span className={`text-xs ${labelClass}`}>Slippage Tolerance</span>
                <div className="flex gap-1">
                  {[50, 100, 300].map((bps) => (
                    <button
                      key={bps}
                      onClick={() => setSlippageBps(bps)}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                        slippageBps === bps
                          ? "bg-pink-600 text-white"
                          : isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {bps / 100}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Gas Cost Estimation */}
            <div className={`flex items-center justify-between text-xs ${labelClass}`}>
              <span className="flex items-center gap-1">
                <Fuel className="w-3 h-3" />
                Est. Gas Cost
              </span>
              <span className="font-mono">
                {isCollectMode
                  ? formatGasCost(V2_GAS_LIMITS.COLLECT) + " (300K gas)"
                  : burnNFT && percent === 100
                  ? formatGasCost(V2_GAS_LIMITS.FULL_REMOVAL_WITH_BURN) + " (700K gas)"
                  : formatGasCost(V2_GAS_LIMITS.DECREASE_AND_COLLECT) + " (600K gas)"
                }
              </span>
            </div>

            {/* Token Association Guard */}
            <V2TokenAssociationGuard
              operation={isCollectMode ? "collect" : "remove"}
              tokens={[
                // [LP-REM-FIX] For HBAR pools, user receives WHBAR (not native HBAR),
                // so they MUST be associated with the WHBAR token.
                ...(isToken0Hbar
                  ? [{ tokenId: "0.0.1456986", symbol: "WHBAR", logo: pos.token0.logo }]
                  : [{ tokenId: pos.token0.htsId, symbol: pos.token0.symbol, logo: pos.token0.logo }]),
                ...(isToken1Hbar
                  ? [{ tokenId: "0.0.1456986", symbol: "WHBAR", logo: pos.token1.logo }]
                  : [{ tokenId: pos.token1.htsId, symbol: pos.token1.symbol, logo: pos.token1.logo }]),
              ]}
              compact
              onGuardResult={setGuardResult}
            />

            {/* Execute Button */}
            <button
              onClick={handleExecute}
              disabled={(!isCollectMode && percent <= 0) || guardResult !== "ready"}
              className={`w-full py-3.5 rounded-xl text-sm font-bold transition-all ${
                isCollectMode
                  ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/20"
                  : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/20"
              }`}
            >
              {isCollectMode
                ? "Collect Fees"
                : `Remove ${percent}% Liquidity${burnNFT && percent === 100 ? " & Burn NFT" : ""}`
              }
            </button>
          </div>
        )}

        {/* Confirming State — with live step progress */}
        {modalState === "confirming" && (
          <div className="p-8 text-center">
            <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-pink-400" />
            <div className="font-bold text-lg mb-1">Confirm in Wallet</div>
            <div className={`text-xs ${labelClass}`}>
              {execStep
                ? `Step ${execStep.step}/${execStep.total}: ${execStep.desc}`
                : "Preparing transaction..."}
            </div>
            {execStep && execStep.total > 1 && (
              <div className="mt-3 mx-auto max-w-[200px]">
                <div className="h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-500"
                    style={{ width: `${(execStep.step / execStep.total) * 100}%` }}
                  />
                </div>
                <div className={`text-[10px] mt-1 ${labelClass}`}>
                  {execStep.step < execStep.total ? "Approve in HashPack..." : isCollectMode ? "Collecting fees..." : "Removing liquidity..."}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Success State — with HashScan link */}
        {modalState === "success" && (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-400" />
            <div className="font-bold text-lg mb-1">
              {isCollectMode ? "Fees Collected!" : burnNFT ? "Position Closed!" : "Liquidity Removed!"}
            </div>
            <div className={`text-xs mb-4 ${labelClass}`}>
              {isCollectMode
                ? "Your earned fees have been sent to your wallet."
                : burnNFT
                ? "All liquidity withdrawn and NFT burned."
                : `${percent}% of your liquidity has been withdrawn.`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { onSuccess?.(); onClose(); }}
                className="flex-1 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 text-white rounded-lg text-sm font-bold"
              >
                Done
              </button>
              {txId && (
                <a
                  href={`https://hashscan.io/${hederaNetwork || "mainnet"}/transaction/${txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold ${isDark ? "bg-slate-800 text-slate-300" : "bg-gray-200 text-gray-700"}`}
                >
                  HashScan <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Error State */}
        {modalState === "error" && (
          <div className="p-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <div className="font-bold text-lg mb-1">Transaction Failed</div>
            <div className={`text-xs mb-4 ${isDark ? "text-red-300" : "text-red-600"}`}>{errorMsg}</div>
            <div className="flex gap-2">
              <button
                onClick={() => setModalState("idle")}
                className="flex-1 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 text-white rounded-lg text-sm font-bold"
              >
                Try Again
              </button>
              {txId && (
                <a
                  href={`https://hashscan.io/${hederaNetwork || "mainnet"}/transaction/${txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold ${isDark ? "bg-slate-800 text-slate-300" : "bg-gray-200 text-gray-700"}`}
                >
                  HashScan <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
  ArrowDown,
  Stethoscope,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Lightbulb,
  RotateCcw,
} from "lucide-react";
import { Tip } from "./Tip";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { toast } from "sonner";
import { copyToClipboard } from "../utils/clipboard";
import {
  diagnoseTransaction,
  getHashScanTxUrl,
  formatTxIdForMirrorNode,
  type TransactionDiagnosis,
} from "../utils/saucerswap";

interface TransactionDiagnoserProps {
  /** Pre-fill the transaction input field (e.g., from a failed swap) */
  prefillTxId?: string;
  /** Callback when the pre-fill value is consumed */
  onPrefillConsumed?: () => void;
  /** Auto-run diagnosis when prefilled (default: true) */
  autoRunOnPrefill?: boolean;
}

/** Classify the root cause from a TransactionDiagnosis and return actionable remediation steps */
function classifyRootCause(diag: TransactionDiagnosis, userAccountId: string): {
  rootCause: string;
  severity: "critical" | "warning" | "info";
  actions: string[];
} {
  if (!diag.found) {
    return {
      rootCause: "Transaction not indexed yet",
      severity: "info",
      actions: ["Wait 30-60 seconds and try diagnosing again", "Verify you're on the correct network (mainnet vs testnet)", "Check the transaction ID format"],
    };
  }

  const result = diag.result || "";
  const errorMsg = (diag.contractCallResult?.errorMessage || "").toLowerCase();
  const gasUsed = diag.contractCallResult?.gasUsed || 0;
  const feeHbar = diag.chargedFeeHbar || 0;

  if (result === "CONTRACT_REVERT_EXECUTED") {
    // Check for specific revert reasons
    if (errorMsg.includes("transferfrom failed") || errorMsg.includes("transfer failed")) {
      return {
        rootCause: "Token transfer failed — likely the output token is not associated with your account",
        severity: "critical",
        actions: [
          "Associate the output token with your account in HashPack before retrying",
          "Go to HashPack → Settings → Token Associations and add the output token HTS ID",
          "Try the swap again after association is confirmed",
        ],
      };
    }
    if (errorMsg.includes("insufficient") || errorMsg.includes("k")) {
      return {
        rootCause: "Insufficient pool liquidity or invalid reserve state",
        severity: "critical",
        actions: [
          "Try a smaller swap amount (e.g., 5 HBAR instead of the current amount)",
          "Check the pool's TVL on SaucerSwap — low-liquidity pools may not support large swaps",
          "Try a different token pair with deeper liquidity (e.g., HBAR→USDC)",
        ],
      };
    }
    if (errorMsg.includes("expired") || errorMsg.includes("deadline")) {
      return {
        rootCause: "Transaction deadline expired — the swap took too long",
        severity: "warning",
        actions: [
          "Retry the swap immediately (deadline is set 20 minutes from now)",
          "Ensure HashPack responds quickly when prompted for signature",
        ],
      };
    }
    if (errorMsg.includes("slippage") || errorMsg.includes("output amount")) {
      return {
        rootCause: "Slippage tolerance exceeded — price moved too much during execution",
        severity: "warning",
        actions: [
          "Increase slippage tolerance (try 3% for volatile tokens)",
          "Use a smaller swap amount to reduce price impact",
          "Retry quickly — prices change continuously",
        ],
      };
    }
    // Generic revert
    const hasTokenTransfers = diag.transfers.tokens.some(t => t.account === userAccountId);
    const inputDebited = diag.transfers.tokens.some(t => t.account === userAccountId && t.amount < 0);
    return {
      rootCause: inputDebited
        ? "Swap reverted AFTER input was debited — router rejected the output transfer"
        : "Swap reverted at the contract level — the router rejected the call",
      severity: "critical",
      actions: [
        "Ensure ALL tokens in the swap path are associated with your account",
        "Verify the output token HTS ID is correct and the pool exists on SaucerSwap",
        "Try a smaller amount (5 HBAR → USDC is the safest first test)",
        "Check the pool's current liquidity on SaucerSwap's website",
        `Gas consumed: ${gasUsed.toLocaleString()} units (~${feeHbar.toFixed(2)} HBAR) — this was the cost of the failed transaction`,
      ],
    };
  }

  if (result === "SUCCESS") {
    // Check if user actually received output
    const userCredits = diag.transfers.tokens.filter(t => t.account === userAccountId && t.amount > 0);
    const userHbarCredits = diag.transfers.hbar.filter(t => t.account === userAccountId && t.amount > 0);
    if (userCredits.length === 0 && userHbarCredits.length === 0) {
      return {
        rootCause: "Transaction succeeded but no output tokens credited to your account",
        severity: "warning",
        actions: [
          "Check if tokens were sent to a different address (EVM vs Hedera account mismatch)",
          "Verify your EVM address mapping on HashScan",
          "The router may have used a synthetic long-zero address instead of your real EVM address",
        ],
      };
    }
    return {
      rootCause: "Swap completed successfully",
      severity: "info",
      actions: [
        "Output tokens should be visible in your HashPack wallet",
        "Refresh your wallet balance if tokens don't appear immediately",
      ],
    };
  }

  return {
    rootCause: `Unexpected status: ${result}`,
    severity: "warning",
    actions: ["Check HashScan for the full transaction details", "Try again or contact support"],
  };
}

export function TransactionDiagnoser({ prefillTxId, onPrefillConsumed, autoRunOnPrefill = true }: TransactionDiagnoserProps = {}) {
  const { isDark } = useTheme();
  const { hashPackSession, hederaNetwork } = useWallet();

  const [txInput, setTxInput] = useState("");
  const [accountOverride, setAccountOverride] = useState("");
  const [expectedOutputToken, setExpectedOutputToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState<TransactionDiagnosis | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTransfers, setShowTransfers] = useState(false);
  const [showRemediation, setShowRemediation] = useState(true);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoRunRef = useRef(false);

  const accountId = accountOverride || hashPackSession?.accountId || "";

  // Use useCallback to avoid stale closures when called from useEffect auto-run
  const handleDiagnose = useCallback(async () => {
    if (!txInput.trim()) {
      toast.error("Enter a transaction ID or consensus timestamp");
      return;
    }
    const resolvedAccountId = accountOverride || hashPackSession?.accountId || "";
    if (!resolvedAccountId) {
      toast.error("Enter your account ID or connect HashPack");
      return;
    }

    setLoading(true);
    setDiagnosis(null);
    try {
      const diag = await diagnoseTransaction(
        txInput.trim(),
        resolvedAccountId,
        expectedOutputToken.trim() || undefined,
        hederaNetwork
      );
      setDiagnosis(diag);
      if (diag.found) {
        if (diag.result === "CONTRACT_REVERT_EXECUTED") {
          toast.error("Transaction REVERTED", { id: "diag", duration: 6000 });
        } else if (diag.result === "SUCCESS") {
          toast.success("Transaction succeeded", { id: "diag", duration: 4000 });
        } else {
          toast.warning(`Status: ${diag.result}`, { id: "diag", duration: 4000 });
        }
      } else {
        toast.warning("Transaction not found yet", { id: "diag" });
      }
    } catch (err: any) {
      toast.error("Diagnosis failed: " + (err?.message || "unknown"), { id: "diag" });
    } finally {
      setLoading(false);
    }
  }, [txInput, accountOverride, hashPackSession?.accountId, expectedOutputToken, hederaNetwork]);

  // Handle pre-fill from parent (e.g., failed swap "Diagnose in Tool" button)
  useEffect(() => {
    if (prefillTxId && prefillTxId !== txInput) {
      setTxInput(prefillTxId);
      setDiagnosis(null);
      onPrefillConsumed?.();
      // Mark for auto-run
      if (autoRunOnPrefill) {
        autoRunRef.current = true;
      }
      // Scroll into view after a short delay for DOM update
      setTimeout(() => {
        containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [prefillTxId]);

  // Auto-run diagnosis when prefilled (runs after txInput is set)
  useEffect(() => {
    const resolvedAccountId = accountOverride || hashPackSession?.accountId || "";
    if (autoRunRef.current && txInput && resolvedAccountId && !loading) {
      autoRunRef.current = false;
      // Small delay to let the UI update first
      setTimeout(() => {
        handleDiagnose();
      }, 200);
    }
  }, [txInput, handleDiagnose, accountOverride, hashPackSession?.accountId, loading]);

  const handleCopyDiagnosis = () => {
    if (!diagnosis) return;
    const text = [
      `Transaction: ${txInput}`,
      `Status: ${diagnosis.result || "Unknown"}`,
      `Consensus: ${diagnosis.consensusTimestamp || "N/A"}`,
      `Fee: ${diagnosis.chargedFeeHbar?.toFixed(4) || "0"} HBAR`,
      diagnosis.contractCallResult
        ? `Gas Used: ${diagnosis.contractCallResult.gasUsed.toLocaleString()} | Error: ${diagnosis.contractCallResult.errorMessage || "none"}`
        : "",
      `Diagnosis: ${diagnosis.diagnosis}`,
      "",
      `HBAR Transfers (${diagnosis.transfers.hbar.length}):`,
      ...diagnosis.transfers.hbar.map(
        t => `  ${t.amountHbar >= 0 ? "+" : ""}${t.amountHbar.toFixed(4)} HBAR -> ${t.account}`
      ),
      "",
      `Token Transfers (${diagnosis.transfers.tokens.length}):`,
      ...diagnosis.transfers.tokens.map(
        t => `  ${t.amountHuman >= 0 ? "+" : ""}${t.amountHuman.toFixed(6)} ${t.tokenSymbol} -> ${t.account}`
      ),
    ]
      .filter(Boolean)
      .join("\n");
    copyToClipboard(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Diagnosis copied to clipboard", { duration: 2000 });
    });
  };

  const cardClass = isDark
    ? "bg-slate-900/30 border border-blue-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  const inputClass = isDark
    ? "bg-slate-800/50 border border-blue-500/10"
    : "bg-gray-50 border border-gray-200";

  return (
    <div ref={containerRef} className={`rounded-2xl p-5 ${cardClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Stethoscope className={`w-4 h-4 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
          <h3 className="font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            Transaction Diagnoser
          </h3>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-600 border border-blue-200"}`}>
          Mirror Node
        </span>
      </div>

      {/* TX Input */}
      <div className="space-y-3">
        <div>
          <label className={`block text-xs mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Transaction ID or Consensus Timestamp
          </label>
          <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${inputClass}`}>
            <Search className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
            <input
              type="text"
              placeholder="e.g. 1770515132.278486502 or 0.0.12345@1234567890.123456789"
              className="bg-transparent outline-none flex-1 text-sm"
              value={txInput}
              onChange={e => setTxInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleDiagnose(); }}
            />
          </div>
        </div>

        {/* Advanced options toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`flex items-center gap-1.5 text-xs transition-colors ${isDark ? "text-slate-500 hover:text-slate-400" : "text-gray-400 hover:text-gray-600"}`}
        >
          {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Advanced Options
        </button>

        {showAdvanced && (
          <div className="space-y-2">
            <div>
              <label className={`block text-[10px] mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Account ID {hashPackSession?.accountId ? `(default: ${hashPackSession.accountId})` : "(required)"}
              </label>
              <input
                type="text"
                placeholder={hashPackSession?.accountId || "0.0.xxxxx"}
                className={`w-full px-3 py-2 rounded-lg text-xs outline-none ${inputClass}`}
                value={accountOverride}
                onChange={e => setAccountOverride(e.target.value)}
              />
            </div>
            <div>
              <label className={`block text-[10px] mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Expected Output Token HTS ID (optional, for targeted analysis)
              </label>
              <input
                type="text"
                placeholder="e.g. 0.0.456858 for USDC"
                className={`w-full px-3 py-2 rounded-lg text-xs outline-none ${inputClass}`}
                value={expectedOutputToken}
                onChange={e => setExpectedOutputToken(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Diagnose Button */}
        <button
          onClick={handleDiagnose}
          disabled={loading || !txInput.trim() || !accountId}
          className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
            loading || !txInput.trim() || !accountId
              ? isDark ? "bg-slate-700 text-slate-500 cursor-not-allowed" : "bg-gray-300 text-gray-500 cursor-not-allowed"
              : "bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-lg shadow-blue-500/20"
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Fetching transaction from Mirror Node...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Stethoscope className="w-4 h-4" />
              Diagnose Transaction
            </span>
          )}
        </button>
      </div>

      {/* ── Diagnosis Results ── */}
      {diagnosis && (
        <div className="mt-4 space-y-3">
          {/* Status Banner */}
          <div className={`p-3 rounded-xl ${
            diagnosis.result === "CONTRACT_REVERT_EXECUTED"
              ? isDark ? "bg-red-900/20 border border-red-500/30" : "bg-red-50 border border-red-200"
              : diagnosis.result === "SUCCESS"
                ? isDark ? "bg-emerald-900/20 border border-emerald-500/30" : "bg-emerald-50 border border-emerald-200"
                : isDark ? "bg-amber-900/20 border border-amber-500/30" : "bg-amber-50 border border-amber-200"
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {diagnosis.result === "CONTRACT_REVERT_EXECUTED" ? (
                  <AlertCircle className="w-4 h-4 text-red-400" />
                ) : diagnosis.result === "SUCCESS" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                )}
                <span className={`font-bold text-sm ${
                  diagnosis.result === "CONTRACT_REVERT_EXECUTED" ? "text-red-400"
                    : diagnosis.result === "SUCCESS" ? "text-emerald-400"
                      : "text-amber-400"
                }`}>
                  {diagnosis.result || "Unknown Status"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Tip content="Copy diagnosis to clipboard">
                <button
                  onClick={handleCopyDiagnosis}
                  className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700/50 text-slate-500" : "hover:bg-gray-200 text-gray-400"}`}
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
                </Tip>
                <Tip content="View on HashScan">
                <a
                  href={getHashScanTxUrl(formatTxIdForMirrorNode(txInput.trim()), hederaNetwork)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700/50 text-slate-500" : "hover:bg-gray-200 text-gray-400"}`}
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
                </Tip>
              </div>
            </div>

            {/* Diagnosis text */}
            <p className={`text-xs leading-relaxed ${isDark ? "text-slate-300" : "text-gray-600"}`}>
              {diagnosis.diagnosis}
            </p>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className={`p-2.5 rounded-lg ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-200"}`}>
              <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Gas Fee</div>
              <div className={`text-sm font-bold ${
                (diagnosis.chargedFeeHbar || 0) > 1 ? "text-red-400" : isDark ? "text-slate-200" : "text-gray-700"
              }`}>
                {diagnosis.chargedFeeHbar?.toFixed(4) || "0"} HBAR
              </div>
            </div>

            {diagnosis.contractCallResult && (
              <div className={`p-2.5 rounded-lg ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-200"}`}>
                <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Gas Used</div>
                <div className={`text-sm font-bold ${isDark ? "text-slate-200" : "text-gray-700"}`}>
                  {diagnosis.contractCallResult.gasUsed.toLocaleString()}
                </div>
              </div>
            )}

            <div className={`p-2.5 rounded-lg ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-200"}`}>
              <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Consensus</div>
              <div className={`text-[11px] font-bold font-mono truncate ${isDark ? "text-slate-200" : "text-gray-700"}`}>
                {diagnosis.consensusTimestamp || "N/A"}
              </div>
            </div>

            {diagnosis.contractCallResult?.contractId && (
              <div className={`p-2.5 rounded-lg ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-200"}`}>
                <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Contract</div>
                <div className={`text-[11px] font-bold font-mono truncate ${isDark ? "text-slate-200" : "text-gray-700"}`}>
                  {diagnosis.contractCallResult.contractId}
                </div>
              </div>
            )}
          </div>

          {/* Revert Error */}
          {diagnosis.contractCallResult?.errorMessage && (
            <div className={`p-2.5 rounded-lg ${isDark ? "bg-red-900/10 border border-red-500/20" : "bg-red-50 border border-red-200"}`}>
              <div className={`text-[10px] font-bold mb-1 ${isDark ? "text-red-400" : "text-red-600"}`}>
                Revert Reason
              </div>
              <code className={`text-[11px] font-mono break-all ${isDark ? "text-red-300" : "text-red-500"}`}>
                {diagnosis.contractCallResult.errorMessage}
              </code>
            </div>
          )}

          {/* Transfer Details Toggle */}
          {(diagnosis.transfers.tokens.length > 0 || diagnosis.transfers.hbar.length > 0) && (
            <div>
              <button
                onClick={() => setShowTransfers(!showTransfers)}
                className={`flex items-center gap-1.5 text-xs transition-colors ${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"}`}
              >
                {showTransfers ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Transfer Details ({diagnosis.transfers.tokens.length} token, {diagnosis.transfers.hbar.length} HBAR)
              </button>

              {showTransfers && (
                <div className="mt-2 space-y-2">
                  {/* Token Transfers */}
                  {diagnosis.transfers.tokens.length > 0 && (
                    <div className={`p-2.5 rounded-lg ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}>
                      <div className={`text-[10px] font-bold mb-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Token Transfers
                      </div>
                      <div className="space-y-1">
                        {diagnosis.transfers.tokens.map((t, i) => (
                          <div key={i} className={`flex items-center gap-2 text-[10px] font-mono ${
                            t.amountHuman > 0 ? "text-emerald-400" : t.amountHuman < 0 ? "text-red-400" : isDark ? "text-slate-400" : "text-gray-500"
                          }`}>
                            <span className="shrink-0 w-24 text-right">
                              {t.amountHuman >= 0 ? "+" : ""}{t.amountHuman.toFixed(6)}
                            </span>
                            <span className={`shrink-0 w-14 text-right font-bold ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                              {t.tokenSymbol}
                            </span>
                            <ArrowDown className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{t.account}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* HBAR Transfers */}
                  {diagnosis.transfers.hbar.length > 0 && (
                    <div className={`p-2.5 rounded-lg ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}>
                      <div className={`text-[10px] font-bold mb-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        HBAR Transfers
                      </div>
                      <div className="space-y-1">
                        {diagnosis.transfers.hbar.slice(0, 15).map((t, i) => (
                          <div key={i} className={`flex items-center gap-2 text-[10px] font-mono ${
                            t.amountHbar > 0 ? "text-emerald-400" : t.amountHbar < 0 ? "text-red-400" : isDark ? "text-slate-400" : "text-gray-500"
                          }`}>
                            <span className="shrink-0 w-24 text-right">
                              {t.amountHbar >= 0 ? "+" : ""}{t.amountHbar.toFixed(4)}
                            </span>
                            <span className={`shrink-0 w-14 text-right font-bold ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                              HBAR
                            </span>
                            <ArrowDown className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{t.account}</span>
                          </div>
                        ))}
                        {diagnosis.transfers.hbar.length > 15 && (
                          <div className={`text-[10px] italic ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            ...and {diagnosis.transfers.hbar.length - 15} more transfers
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Not Found State */}
          {!diagnosis.found && (
            <div className={`p-3 rounded-xl ${isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-200"}`}>
              <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                The transaction was not found on Mirror Node. This can happen if:
              </div>
              <ul className={`mt-1.5 text-[10px] space-y-0.5 list-disc list-inside ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                <li>The transaction is still being indexed (wait 30-60 seconds)</li>
                <li>The timestamp or transaction ID format is incorrect</li>
                <li>The transaction is on a different network (mainnet vs testnet)</li>
              </ul>
            </div>
          )}

          {/* ── Root Cause & Remediation ── */}
          {diagnosis.found && (() => {
            const { rootCause, severity, actions } = classifyRootCause(diagnosis, accountId);
            return (
              <div className={`p-3 rounded-xl ${
                severity === "critical"
                  ? isDark ? "bg-red-900/10 border border-red-500/20" : "bg-red-50 border border-red-200"
                  : severity === "warning"
                    ? isDark ? "bg-amber-900/10 border border-amber-500/20" : "bg-amber-50 border border-amber-200"
                    : isDark ? "bg-emerald-900/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"
              }`}>
                <button
                  onClick={() => setShowRemediation(!showRemediation)}
                  className="w-full flex items-center justify-between mb-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <Lightbulb className={`w-3.5 h-3.5 ${
                      severity === "critical" ? "text-red-400"
                        : severity === "warning" ? "text-amber-400"
                          : "text-emerald-400"
                    }`} />
                    <span className={`text-xs font-bold ${
                      severity === "critical" ? isDark ? "text-red-300" : "text-red-700"
                        : severity === "warning" ? isDark ? "text-amber-300" : "text-amber-700"
                          : isDark ? "text-emerald-300" : "text-emerald-700"
                    }`}>
                      Root Cause Analysis
                    </span>
                  </div>
                  {showRemediation ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <div className={`text-xs mb-2 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                  {rootCause}
                </div>
                {showRemediation && (
                  <div className="space-y-1.5">
                    <div className={`text-[10px] font-bold flex items-center gap-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      <RotateCcw className="w-2.5 h-2.5" />
                      Recommended Actions
                    </div>
                    {actions.map((action, i) => (
                      <div key={i} className={`flex items-start gap-2 text-[10px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold mt-0.5 ${
                          isDark ? "bg-slate-700/60 text-slate-300" : "bg-gray-200 text-gray-600"
                        }`}>{i + 1}</span>
                        <span>{action}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Helper Text */}
      {!diagnosis && (
        <div className={`mt-3 text-[10px] space-y-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          <div>Paste a Hedera transaction ID or consensus timestamp to get a full breakdown of what happened.</div>
          <div>Supports formats: <code className={`px-1 py-0.5 rounded ${isDark ? "bg-slate-800/50" : "bg-gray-100"}`}>1770515132.278486502</code> or <code className={`px-1 py-0.5 rounded ${isDark ? "bg-slate-800/50" : "bg-gray-100"}`}>0.0.12345@1234567890.123456789</code></div>
        </div>
      )}
    </div>
  );
}
import { useState } from "react";
import {
  Clock,
  ExternalLink,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Trash2,
  ChevronDown,
  FlaskConical,
  Zap,
  Stethoscope,
  AlertTriangle,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  ArrowDown,
  Lightbulb,
  RotateCcw,
  ChevronUp,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { toast } from "sonner";
import { copyToClipboard } from "../utils/clipboard";
import {
  getHashScanTxUrl,
  diagnoseTransaction,
  formatTxIdForMirrorNode,
  type TransactionDiagnosis,
} from "../utils/saucerswap";

export interface SwapHistoryEntry {
  id: string;
  timestamp: number;
  inputSymbol: string;
  outputSymbol: string;
  inputAmount: string;
  outputAmount: string;
  route: string[];
  priceImpact: number;
  slippage: number;
  transactionId: string | null;
  executionVenue: string;
  success: boolean;
  isSimulated: boolean;
  network: "mainnet" | "testnet";
  inputUsd?: number;
  outputUsd?: number;
  /** Error message for failed swaps */
  errorMessage?: string;
}

const STORAGE_KEY = "hbarh-swap-history";

export function loadSwapHistory(): SwapHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSwapToHistory(entry: SwapHistoryEntry): void {
  try {
    const history = loadSwapHistory();
    history.unshift(entry);
    // Keep last 50 entries
    const trimmed = history.slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

export function clearSwapHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
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
      actions: ["Wait 30-60 seconds and try again", "Verify the correct network (mainnet vs testnet)", "Check the transaction ID format"],
    };
  }

  const result = diag.result || "";
  const errorMsg = (diag.contractCallResult?.errorMessage || "").toLowerCase();
  const gasUsed = diag.contractCallResult?.gasUsed || 0;
  const feeHbar = diag.chargedFeeHbar || 0;

  if (result === "CONTRACT_REVERT_EXECUTED") {
    if (errorMsg.includes("transferfrom failed") || errorMsg.includes("transfer failed")) {
      return {
        rootCause: "Token transfer failed — likely the output token is not associated with your account",
        severity: "critical",
        actions: [
          "Associate the output token in HashPack → Settings → Token Associations",
          "Add the output token HTS ID manually",
          "Retry the swap after association is confirmed",
        ],
      };
    }
    if (errorMsg.includes("insufficient") || errorMsg.includes("k")) {
      return {
        rootCause: "Insufficient pool liquidity or invalid reserve state",
        severity: "critical",
        actions: [
          "Try a smaller swap amount (e.g., 5 HBAR)",
          "Check pool TVL on SaucerSwap",
          "Try a different token pair with deeper liquidity",
        ],
      };
    }
    if (errorMsg.includes("expired") || errorMsg.includes("deadline")) {
      return {
        rootCause: "Transaction deadline expired",
        severity: "warning",
        actions: ["Retry the swap immediately", "Respond to HashPack signature quickly"],
      };
    }
    if (errorMsg.includes("slippage") || errorMsg.includes("output amount")) {
      return {
        rootCause: "Slippage tolerance exceeded — price moved during execution",
        severity: "warning",
        actions: ["Increase slippage tolerance (try 3%)", "Use a smaller amount", "Retry quickly"],
      };
    }
    const inputDebited = diag.transfers.tokens.some(t => t.account === userAccountId && t.amount < 0);
    return {
      rootCause: inputDebited
        ? "Swap reverted AFTER input debited — router rejected output transfer"
        : "Swap reverted at contract level — router rejected the call",
      severity: "critical",
      actions: [
        "Ensure all tokens in the path are associated",
        "Verify the output token HTS ID and pool exist",
        "Try a smaller amount (5 HBAR → USDC is safest)",
        `Gas consumed: ${gasUsed.toLocaleString()} units (~${feeHbar.toFixed(2)} HBAR)`,
      ],
    };
  }

  if (result === "SUCCESS") {
    const userCredits = diag.transfers.tokens.filter(t => t.account === userAccountId && t.amount > 0);
    const userHbarCredits = diag.transfers.hbar.filter(t => t.account === userAccountId && t.amount > 0);
    if (userCredits.length === 0 && userHbarCredits.length === 0) {
      return {
        rootCause: "Transaction succeeded but no output tokens credited to your account",
        severity: "warning",
        actions: [
          "Check if tokens were sent to a different address",
          "Verify your EVM address mapping on HashScan",
        ],
      };
    }
    return {
      rootCause: "Swap completed successfully",
      severity: "info",
      actions: ["Output tokens should be visible in HashPack", "Refresh wallet balance if not visible"],
    };
  }

  return {
    rootCause: `Unexpected status: ${result}`,
    severity: "warning",
    actions: ["Check HashScan for full details", "Try again or contact support"],
  };
}

interface SwapHistoryPanelProps {
  history: SwapHistoryEntry[];
  onClear: () => void;
}

export function SwapHistoryPanel({ history, onClear }: SwapHistoryPanelProps) {
  const { isDark } = useTheme();
  const { hashPackSession, hederaNetwork } = useWallet();
  const [expanded, setExpanded] = useState(true);

  // Inline diagnoser state — keyed by entry id
  const [diagnosingId, setDiagnosingId] = useState<string | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<{ entryId: string; diag: TransactionDiagnosis } | null>(null);
  const [showTransfers, setShowTransfers] = useState(false);
  const [copiedDiag, setCopiedDiag] = useState(false);

  const accountId = hashPackSession?.accountId || "";

  if (history.length === 0) return null;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const fmtAmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return "0";
    return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 })
      : n >= 0.001 ? n.toFixed(6) : n.toFixed(8);
  };

  const handleDiagnose = async (entry: SwapHistoryEntry) => {
    if (!entry.transactionId || !accountId) {
      toast.error("No transaction ID or wallet not connected");
      return;
    }

    // Toggle off if already showing this entry's diagnosis
    if (diagnosingId === entry.id && diagnosisResult?.entryId === entry.id) {
      setDiagnosingId(null);
      setDiagnosisResult(null);
      return;
    }

    setDiagnosingId(entry.id);
    setDiagnosisLoading(true);
    setDiagnosisResult(null);
    setShowTransfers(false);

    try {
      const diag = await diagnoseTransaction(
        entry.transactionId,
        accountId,
        undefined,
        entry.network || hederaNetwork
      );
      setDiagnosisResult({ entryId: entry.id, diag });
      if (diag.found) {
        if (diag.result === "CONTRACT_REVERT_EXECUTED") {
          toast.error("Transaction REVERTED", { id: "hist-diag", duration: 4000 });
        } else if (diag.result === "SUCCESS") {
          toast.success("Transaction succeeded", { id: "hist-diag", duration: 3000 });
        } else {
          toast.warning(`Status: ${diag.result}`, { id: "hist-diag", duration: 3000 });
        }
      } else {
        toast.warning("Transaction not found yet — try again in 30s", { id: "hist-diag" });
      }
    } catch (err: any) {
      toast.error("Diagnosis failed: " + (err?.message || "unknown"), { id: "hist-diag" });
    } finally {
      setDiagnosisLoading(false);
    }
  };

  const handleCopyDiagnosis = () => {
    if (!diagnosisResult) return;
    const diag = diagnosisResult.diag;
    const text = [
      `Transaction Diagnosis`,
      `Status: ${diag.result || "Unknown"}`,
      `Consensus: ${diag.consensusTimestamp || "N/A"}`,
      `Fee: ${diag.chargedFeeHbar?.toFixed(4) || "0"} HBAR`,
      diag.contractCallResult
        ? `Gas Used: ${diag.contractCallResult.gasUsed.toLocaleString()} | Error: ${diag.contractCallResult.errorMessage || "none"}`
        : "",
      `Diagnosis: ${diag.diagnosis}`,
      "",
      `HBAR Transfers (${diag.transfers.hbar.length}):`,
      ...diag.transfers.hbar.map(
        t => `  ${t.amountHbar >= 0 ? "+" : ""}${t.amountHbar.toFixed(4)} HBAR -> ${t.account}`
      ),
      "",
      `Token Transfers (${diag.transfers.tokens.length}):`,
      ...diag.transfers.tokens.map(
        t => `  ${t.amountHuman >= 0 ? "+" : ""}${t.amountHuman.toFixed(6)} ${t.tokenSymbol} -> ${t.account}`
      ),
    ]
      .filter(Boolean)
      .join("\n");
    copyToClipboard(text).then((ok) => {
      setCopiedDiag(true);
      setTimeout(() => setCopiedDiag(false), 2000);
      toast.success(ok ? "Diagnosis copied" : "Could not copy — check browser permissions", { duration: 2000 });
    });
  };

  return (
    <div className={`rounded-2xl overflow-hidden ${
      isDark
        ? "bg-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
        : "bg-white border border-gray-200 shadow-sm"
    }`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}
        className={`w-full flex items-center justify-between px-5 py-3 cursor-pointer transition-colors ${
          isDark ? "hover:bg-slate-800/30" : "hover:bg-gray-50"
        }`}
      >
        <div className="flex items-center gap-2">
          <Clock className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
          <span className="font-bold text-sm bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
            Swap History
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            isDark ? "bg-slate-700/50 text-slate-400" : "bg-gray-200 text-gray-500"
          }`}>
            {history.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className={`p-1 rounded transition-colors ${
                isDark ? "hover:bg-slate-700 text-slate-500" : "hover:bg-gray-200 text-gray-400"
              }`}
              title="Clear history"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""} ${
            isDark ? "text-slate-400" : "text-gray-500"
          }`} />
        </div>
      </div>

      {expanded && (
        <div className={`border-t ${isDark ? "border-slate-800/30" : "border-gray-100"}`}>
          <div className="max-h-[480px] overflow-y-auto">
            {history.map((entry) => {
              const isShowingDiagnosis = diagnosingId === entry.id && (diagnosisLoading || diagnosisResult?.entryId === entry.id);
              const diag = diagnosisResult?.entryId === entry.id ? diagnosisResult.diag : null;

              return (
                <div
                  key={entry.id}
                  className={`px-5 py-3 border-b last:border-b-0 ${
                    isDark ? "border-slate-800/20" : "border-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {entry.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      )}
                      <span className="text-sm font-bold">
                        {fmtAmt(entry.inputAmount)} {entry.inputSymbol}
                      </span>
                      <ArrowRight className={`w-3 h-3 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
                      <span className="text-sm font-bold">
                        {fmtAmt(entry.outputAmount)} {entry.outputSymbol}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        {formatTime(entry.timestamp)}
                      </span>
                      {entry.isSimulated ? (
                        <FlaskConical className={`w-3 h-3 ${isDark ? "text-amber-400/60" : "text-amber-500"}`} />
                      ) : (
                        <Zap className={`w-3 h-3 ${isDark ? "text-emerald-400/60" : "text-emerald-500"}`} />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>
                        {entry.route.join(" > ")}
                      </span>
                      <span className={isDark ? "text-slate-600" : "text-gray-300"}>|</span>
                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>
                        Impact: {entry.priceImpact.toFixed(3)}%
                      </span>
                      <span className={`px-1 py-0.5 rounded ${
                        isDark ? "bg-slate-700/40 text-slate-500" : "bg-gray-100 text-gray-400"
                      }`}>
                        {entry.executionVenue}
                      </span>
                    </div>
                    {entry.transactionId && !entry.isSimulated && (
                      <div className="flex items-center gap-1.5">
                        {/* Diagnose link — available for all real transactions */}
                        {accountId && (
                          <button
                            onClick={() => handleDiagnose(entry)}
                            disabled={diagnosisLoading && diagnosingId === entry.id}
                            className={`flex items-center gap-0.5 text-[10px] transition-colors ${
                              isShowingDiagnosis
                                ? isDark ? "text-blue-400" : "text-blue-600"
                                : isDark ? "text-slate-500 hover:text-blue-400" : "text-gray-400 hover:text-blue-600"
                            }`}
                            title="Diagnose this transaction"
                          >
                            {diagnosisLoading && diagnosingId === entry.id ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <Stethoscope className="w-2.5 h-2.5" />
                            )}
                            Diagnose
                          </button>
                        )}
                        <span className={`${isDark ? "text-slate-700" : "text-gray-300"}`}>·</span>
                        <a
                          href={getHashScanTxUrl(entry.transactionId, entry.network)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-0.5 text-[10px] transition-colors ${
                            isDark ? "text-pink-400/60 hover:text-pink-400" : "text-pink-500 hover:text-pink-600"
                          }`}
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          HashScan
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Inline error reason for failed swaps */}
                  {!entry.success && entry.errorMessage && (
                    <div className={`mt-1.5 flex items-start gap-1.5 text-[10px] p-1.5 rounded-lg ${
                      isDark ? "bg-red-900/10 border border-red-500/10 text-red-400/80" : "bg-red-50 border border-red-100 text-red-500"
                    }`}>
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="break-all leading-relaxed">{entry.errorMessage.length > 200 ? entry.errorMessage.substring(0, 200) + "..." : entry.errorMessage}</span>
                    </div>
                  )}

                  {/* ── Inline Diagnosis Panel ── */}
                  {isShowingDiagnosis && (
                    <div className={`mt-2 rounded-xl overflow-hidden transition-all ${
                      isDark ? "bg-slate-800/20 border border-slate-700/20" : "bg-gray-50/80 border border-gray-100"
                    }`}>
                      {diagnosisLoading && !diag && (
                        <div className={`flex items-center justify-center gap-2 py-4 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Fetching from Mirror Node...
                        </div>
                      )}

                      {diag && (
                        <div className="p-3 space-y-2.5">
                          {/* Status + actions bar */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {diag.result === "CONTRACT_REVERT_EXECUTED" ? (
                                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                              ) : diag.result === "SUCCESS" ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                              )}
                              <span className={`text-xs font-bold ${
                                diag.result === "CONTRACT_REVERT_EXECUTED" ? "text-red-400"
                                  : diag.result === "SUCCESS" ? "text-emerald-400"
                                    : "text-amber-400"
                              }`}>
                                {diag.result || "Unknown"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={handleCopyDiagnosis}
                                className={`p-1 rounded transition-colors ${isDark ? "hover:bg-slate-700/50 text-slate-500" : "hover:bg-gray-200 text-gray-400"}`}
                                title="Copy diagnosis"
                              >
                                {copiedDiag ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                              </button>
                              <button
                                onClick={() => { setDiagnosingId(null); setDiagnosisResult(null); }}
                                className={`p-1 rounded transition-colors ${isDark ? "hover:bg-slate-700/50 text-slate-500" : "hover:bg-gray-200 text-gray-400"}`}
                                title="Close diagnosis"
                              >
                                <XCircle className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          </div>

                          {/* Diagnosis text */}
                          <p className={`text-[10px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                            {diag.diagnosis}
                          </p>

                          {/* Key metrics */}
                          <div className="grid grid-cols-3 gap-1.5">
                            <div className={`p-1.5 rounded-lg ${isDark ? "bg-slate-800/40" : "bg-gray-100"}`}>
                              <div className={`text-[9px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Gas Fee</div>
                              <div className={`text-[11px] font-bold ${
                                (diag.chargedFeeHbar || 0) > 5 ? "text-red-400" : isDark ? "text-slate-200" : "text-gray-700"
                              }`}>
                                {diag.chargedFeeHbar?.toFixed(4) || "0"} ℏ
                              </div>
                            </div>
                            {diag.contractCallResult && (
                              <div className={`p-1.5 rounded-lg ${isDark ? "bg-slate-800/40" : "bg-gray-100"}`}>
                                <div className={`text-[9px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Gas Used</div>
                                <div className={`text-[11px] font-bold ${isDark ? "text-slate-200" : "text-gray-700"}`}>
                                  {diag.contractCallResult.gasUsed.toLocaleString()}
                                </div>
                              </div>
                            )}
                            <div className={`p-1.5 rounded-lg ${isDark ? "bg-slate-800/40" : "bg-gray-100"}`}>
                              <div className={`text-[9px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Consensus</div>
                              <div className={`text-[10px] font-bold font-mono truncate ${isDark ? "text-slate-200" : "text-gray-700"}`}>
                                {diag.consensusTimestamp || "N/A"}
                              </div>
                            </div>
                          </div>

                          {/* Revert reason */}
                          {diag.contractCallResult?.errorMessage && (
                            <div className={`p-2 rounded-lg ${isDark ? "bg-red-900/10 border border-red-500/15" : "bg-red-50 border border-red-200"}`}>
                              <div className={`text-[9px] font-bold mb-0.5 ${isDark ? "text-red-400" : "text-red-600"}`}>Revert Reason</div>
                              <code className={`text-[10px] font-mono break-all ${isDark ? "text-red-300" : "text-red-500"}`}>
                                {diag.contractCallResult.errorMessage}
                              </code>
                            </div>
                          )}

                          {/* Transfer details toggle */}
                          {(diag.transfers.tokens.length > 0 || diag.transfers.hbar.length > 0) && (
                            <div>
                              <button
                                onClick={() => setShowTransfers(!showTransfers)}
                                className={`flex items-center gap-1 text-[10px] transition-colors ${isDark ? "text-slate-500 hover:text-slate-400" : "text-gray-400 hover:text-gray-600"}`}
                              >
                                {showTransfers ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                                Transfers ({diag.transfers.tokens.length} token, {diag.transfers.hbar.length} HBAR)
                              </button>

                              {showTransfers && (
                                <div className="mt-1.5 space-y-1.5">
                                  {diag.transfers.tokens.length > 0 && (
                                    <div className={`p-2 rounded-lg ${isDark ? "bg-slate-800/30" : "bg-gray-100/80"}`}>
                                      <div className={`text-[9px] font-bold mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Token Transfers</div>
                                      <div className="space-y-0.5">
                                        {diag.transfers.tokens.map((t, i) => (
                                          <div key={i} className={`flex items-center gap-1.5 text-[9px] font-mono ${
                                            t.amountHuman > 0 ? "text-emerald-400" : t.amountHuman < 0 ? "text-red-400" : isDark ? "text-slate-400" : "text-gray-500"
                                          }`}>
                                            <span className="shrink-0 w-20 text-right">
                                              {t.amountHuman >= 0 ? "+" : ""}{t.amountHuman.toFixed(6)}
                                            </span>
                                            <span className={`shrink-0 w-12 font-bold ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                                              {t.tokenSymbol}
                                            </span>
                                            <ArrowDown className="w-2 h-2 shrink-0" />
                                            <span className="truncate">{t.account}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {diag.transfers.hbar.length > 0 && (
                                    <div className={`p-2 rounded-lg ${isDark ? "bg-slate-800/30" : "bg-gray-100/80"}`}>
                                      <div className={`text-[9px] font-bold mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>HBAR Transfers</div>
                                      <div className="space-y-0.5">
                                        {diag.transfers.hbar.slice(0, 10).map((t, i) => (
                                          <div key={i} className={`flex items-center gap-1.5 text-[9px] font-mono ${
                                            t.amountHbar > 0 ? "text-emerald-400" : t.amountHbar < 0 ? "text-red-400" : isDark ? "text-slate-400" : "text-gray-500"
                                          }`}>
                                            <span className="shrink-0 w-20 text-right">
                                              {t.amountHbar >= 0 ? "+" : ""}{t.amountHbar.toFixed(4)}
                                            </span>
                                            <span className={`shrink-0 w-12 font-bold ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                                              HBAR
                                            </span>
                                            <ArrowDown className="w-2 h-2 shrink-0" />
                                            <span className="truncate">{t.account}</span>
                                          </div>
                                        ))}
                                        {diag.transfers.hbar.length > 10 && (
                                          <div className={`text-[9px] italic ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                                            ...and {diag.transfers.hbar.length - 10} more
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Root Cause & Remediation */}
                          {diag.found && (() => {
                            const { rootCause, severity, actions } = classifyRootCause(diag, accountId);
                            const colors = severity === "critical"
                              ? isDark ? "bg-red-900/10 border border-red-500/15" : "bg-red-50 border border-red-200"
                              : severity === "warning"
                                ? isDark ? "bg-amber-900/10 border border-amber-500/15" : "bg-amber-50 border border-amber-200"
                                : isDark ? "bg-emerald-900/10 border border-emerald-500/15" : "bg-emerald-50 border border-emerald-200";
                            const iconColor = severity === "critical" ? "text-red-400"
                              : severity === "warning" ? "text-amber-400" : "text-emerald-400";
                            return (
                              <div className={`p-2 rounded-lg ${colors}`}>
                                <div className="flex items-center gap-1 mb-1">
                                  <Lightbulb className={`w-3 h-3 ${iconColor}`} />
                                  <span className={`text-[10px] font-bold ${iconColor}`}>Root Cause</span>
                                </div>
                                <div className={`text-[10px] mb-1.5 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                                  {rootCause}
                                </div>
                                <div className="space-y-1">
                                  {actions.map((action, i) => (
                                    <div key={i} className={`flex items-start gap-1.5 text-[9px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                      <span className={`shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold mt-0.5 ${
                                        isDark ? "bg-slate-700/60 text-slate-300" : "bg-gray-200 text-gray-600"
                                      }`}>{i + 1}</span>
                                      <span>{action}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Not found state */}
                          {!diag.found && (
                            <div className={`p-2 rounded-lg text-[10px] ${isDark ? "bg-slate-800/30 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
                              Transaction not found on Mirror Node — wait 30-60s and try again.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
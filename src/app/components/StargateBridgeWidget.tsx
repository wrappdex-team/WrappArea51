/**
 * Stargate Bridge Widget — Cross-chain bridge powered by LayerZero VT API.
 *
 * IMPLEMENTATION NOTE: Stargate Rebuild Steps 8-17.
 * Step 8:  Full rewrite using VT API (stargate-vt.ts + stargate-chains.ts).
 * Step 9:  Enhanced quote panel with fee parity, multi-route selector,
 *          30s auto-refresh with countdown, pre-bridge confirmation summary.
 * Step 10: Step-by-step execution progress (wallet→pending→confirmed),
 *          CSS confetti success, approval-aware error recovery, close lock.
 * Step 11: Chain switching UX — mismatch banner with one-click "Switch Network",
 *          current chain indicator, MetaMask event handling during bridge
 *          (account/chain/disconnect abort), improved chain swap button.
 * Step 12: Mobile MetaMask deep-linking, touch event support, responsive
 *          layout (padding, text, dropdowns), iOS input zoom prevention,
 *          overscroll-contain on scrollable lists, mobile-aware connect flow.
 * Step 13: Error handling hardening — classifyError() for user-friendly
 *          messages, auto-refresh on 404 (quote expired), rate-limit
 *          countdown on 429, 5-min receipt timeout, "Report Issue" button
 *          with clipboard debug report, VTErrorKind for display logic.
 * Step 14: Safety guards — runSafetyChecks() for fee/slippage/balance/expiry
 *          warnings, estimateGasCost() with USD display, checkQuoteExpiry()
 *          auto-refresh, blocking warnings disable bridge button, gas sanity.
 * Step 15: Bridge Receipt card — structured post-bridge summary with source →
 *          destination visual, fee/route/time details, prominent "View on LZ
 *          Scan" button, tx hash copy, "Recent Bridges" collapsible history
 *          (last 5 in localStorage), clear history support.
 * Step 16: Token logos with onError fallback (TokenLogo component),
 *          chain badges with color + emoji, locale-aware amount formatting
 *          (formatDisplayAmount, formatUsd), smart decimals by token type,
 *          USD price in token dropdown items.
 * Step 17: Admin debug panel (isAdmin prop) with raw quote/steps JSON,
 *          API health check (testApiConnection), request timing, wallet
 *          state, "Test Quote Only" button, collapsible sections.
 *
 * Flow: Connect MetaMask → Pick route → Switch chain → Fetch quotes → Review → Confirm → Execute → Track
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  X,
  ExternalLink,
  ChevronDown,
  Loader2,
  ArrowUpDown,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  RefreshCw,
  Search,
  Clock,
  Shield,
  Zap,
  ArrowRight,
  Smartphone,
  History,
  Trash2,
  Bug,
  Activity,
  ChevronRight,
} from "lucide-react";
import {
  isMetaMaskInstalled,
  requestAccounts,
  getChainId,
  switchChain,
  formatAddress,
  isMobileBrowser,
  getMetaMaskDeepLink,
  getEthereumProvider,
} from "../utils/metamask";
import {
  fetchSupportedTokens,
  getTransferrableTokens,
  fetchQuotes,
  fetchUserSteps,
  executeUserSteps,
  getTokenBalance,
  formatTokenAmount,
  parseTokenAmount,
  formatFeeDisplay,
  classifyError,
  isUserRejection,
  buildDebugReport,
  runSafetyChecks,
  estimateGasCost,
  checkQuoteExpiry,
  saveBridgeReceipt,
  loadBridgeReceipts,
  clearBridgeReceipts,
  formatDisplayAmount,
  formatUsd,
  testApiConnection,
  type VTToken,
  type ApiHealthResult,
  type VTQuote,
  type QuoteWithSteps,
  type FeeDisplayInfo,
  type TokenBalance,
  type ClassifiedError,
  type SafetyWarning,
  type BridgeReceipt,
} from "../utils/stargate-vt";
import {
  buildAvailableChains,
  buildAvailableTokens,
  getTxTrackingUrls,
  getChainByChainId,
  type ChainInfo,
  type TokenInfo,
} from "../utils/stargate-chains";
import { log } from "../utils/logger";

/* ══════════════════════════════════════════════════════════════
 * Props & types
 * ══════════════════════════════════════════════════════════════ */

interface StargateBridgeWidgetProps {
  onClose: () => void;
  isDark: boolean;
  /** Show admin debug panel (Step 17) */
  isAdmin?: boolean;
}

/** Execution phase for progress display */
type BridgePhase =
  | "idle"
  | "loading-data"
  | "fetching-quote"
  | "executing"
  | "success"
  | "error";

/** Per-step status during execution */
type StepStatus = "waiting" | "wallet" | "pending" | "complete" | "error";

interface StepState {
  status: StepStatus;
  description: string;
  txHash?: string;
  error?: string;
}

/** Progress info during step execution */
interface ExecutionProgress {
  currentStep: number;
  totalSteps: number;
  description: string;
}

/* ══════════════════════════════════════════════════════════════
 * Component
 * ══════════════════════════════════════════════════════════════ */

export function StargateBridgeWidget({ onClose, isDark, isAdmin = false }: StargateBridgeWidgetProps) {
  /* ── Wallet state ── */
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number>(0);

  /* ── Dynamic data from VT API ── */
  const [allTokens, setAllTokens] = useState<VTToken[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  /* ── Route selection ── */
  const [srcChain, setSrcChain] = useState<ChainInfo | null>(null);
  const [dstChain, setDstChain] = useState<ChainInfo | null>(null);
  const [srcToken, setSrcToken] = useState<TokenInfo | null>(null);
  const [dstToken, setDstToken] = useState<TokenInfo | null>(null);
  const [amount, setAmount] = useState("");

  /* ── Destination options (filtered by transferrability) ── */
  const [dstChains, setDstChains] = useState<ChainInfo[]>([]);
  const [dstTokenOptions, setDstTokenOptions] = useState<TokenInfo[]>([]);
  const [loadingDstOptions, setLoadingDstOptions] = useState(false);

  /* ── Quote state ── */
  const [allQuotes, setAllQuotes] = useState<VTQuote[]>([]);
  const [selectedQuoteIdx, setSelectedQuoteIdx] = useState(0);
  const [quoteResult, setQuoteResult] = useState<QuoteWithSteps | null>(null);
  const [feeDisplay, setFeeDisplay] = useState<FeeDisplayInfo | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteErrorKind, setQuoteErrorKind] = useState<ClassifiedError | null>(null);
  const [quoteCountdown, setQuoteCountdown] = useState(0);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);

  /* ── Balance ── */
  const [userBalance, setUserBalance] = useState<TokenBalance | null>(null);

  /* ── Execution state ── */
  const [phase, setPhase] = useState<BridgePhase>("idle");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [execProgress, setExecProgress] = useState<ExecutionProgress | null>(null);
  const [stepStates, setStepStates] = useState<StepState[]>([]);
  const [failedStepIndex, setFailedStepIndex] = useState<number | null>(null);
  const [txHashes, setTxHashes] = useState<string[]>([]);
  const [bridgeError, setBridgeError] = useState("");

  /* ── Dropdown visibility ── */
  const [showSrcChains, setShowSrcChains] = useState(false);
  const [showDstChains, setShowDstChains] = useState(false);
  const [showSrcTokens, setShowSrcTokens] = useState(false);
  const [showDstTokens, setShowDstTokens] = useState(false);

  /* ── Search filters for dropdowns ── */
  const [srcChainSearch, setSrcChainSearch] = useState("");
  const [dstChainSearch, setDstChainSearch] = useState("");
  const [srcTokenSearch, setSrcTokenSearch] = useState("");
  const [dstTokenSearch, setDstTokenSearch] = useState("");

  /* ── Copy state ── */
  const [copied, setCopied] = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);

  /* ── Recent bridges (Step 15) ── */
  const [recentBridges, setRecentBridges] = useState<BridgeReceipt[]>(() => loadBridgeReceipts());
  const [showRecentBridges, setShowRecentBridges] = useState(false);

  /* ── Admin debug panel (Step 17) ── */
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showRawQuote, setShowRawQuote] = useState(false);
  const [showRawSteps, setShowRawSteps] = useState(false);
  const [apiHealth, setApiHealth] = useState<ApiHealthResult | null>(null);
  const [apiHealthChecking, setApiHealthChecking] = useState(false);
  const [debugQuoteTiming, setDebugQuoteTiming] = useState<{ startMs: number; endMs: number; durationMs: number } | null>(null);
  const [testQuoteLoading, setTestQuoteLoading] = useState(false);

  /* ── Inline connect error (shown above Connect button, auto-clears) ── */
  const [connectError, setConnectError] = useState("");

  /* ── Chain switching ── */
  const [switchingChain, setSwitchingChain] = useState(false);
  const [bridgeAborted, setBridgeAborted] = useState("");

  /* ── Refs ── */
  const containerRef = useRef<HTMLDivElement>(null);
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Derived ── */
  const availableChains = useMemo(
    () => buildAvailableChains(allTokens),
    [allTokens]
  );
  const srcTokenOptions = useMemo(
    () => (srcChain ? buildAvailableTokens(allTokens, srcChain.chainKey) : []),
    [allTokens, srcChain]
  );

  const hasValidAmount = !!amount && parseFloat(amount) > 0;
  const isSameChain = srcChain && dstChain && srcChain.chainId === dstChain.chainId;
  const needsChainSwitch = walletAddress && srcChain && walletChainId !== srcChain.chainId;
  const isExecuting = phase === "executing" || phase === "fetching-quote";
  const bridgeTxHash = txHashes.length > 0 ? txHashes[txHashes.length - 1] : null;
  const walletChainMeta = walletChainId ? getChainByChainId(walletChainId) : null;
  const isMobile = isMobileBrowser();

  // ── Safety warnings (Step 14) ──
  const selectedQuote = allQuotes[selectedQuoteIdx] ?? null;
  const safetyWarnings: SafetyWarning[] = useMemo(() => {
    if (!selectedQuote || !srcToken || !amount || !hasValidAmount) return [];
    return runSafetyChecks({
      srcAmount: amount,
      dstAmount: selectedQuote.dstAmount,
      srcAmountUsd: selectedQuote.srcAmountUsd,
      dstAmountUsd: selectedQuote.dstAmountUsd,
      feePercent: selectedQuote.feePercent,
      expiresAt: selectedQuote.expiresAt,
      userBalanceRaw: userBalance?.raw,
      srcDecimals: srcToken.decimals,
      srcSymbol: srcToken.symbol,
      balanceFormatted: userBalance?.formatted,
      steps: selectedQuote.userSteps,
    });
  }, [selectedQuote, srcToken, amount, hasValidAmount, userBalance]);

  const hasBlockingWarning = safetyWarnings.some((w) => w.severity === "block");

  // ── Gas cost estimate (Step 14) — only when steps are available ──
  const gasEstimate = useMemo(() => {
    if (!selectedQuote?.userSteps?.length || !srcToken) return null;
    // Find native token price on the source chain
    const nativeToken = srcTokenOptions.find((t) => t.isNative);
    const nativePrice = nativeToken?.priceUsd ?? 0;
    if (nativePrice <= 0) return null;
    return estimateGasCost(selectedQuote.userSteps, nativePrice);
  }, [selectedQuote, srcToken, srcTokenOptions]);

  // IMPLEMENTATION NOTE: Quote expiry auto-refresh effect is placed after doFetchQuotes declaration (see below).

  // ──────────────────────────────────────────────────────────
  // Close dropdowns on outside click
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeAllDropdowns();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, []);

  function closeAllDropdowns() {
    setShowSrcChains(false);
    setShowDstChains(false);
    setShowSrcTokens(false);
    setShowDstTokens(false);
    setSrcChainSearch("");
    setDstChainSearch("");
    setSrcTokenSearch("");
    setDstTokenSearch("");
  }

  // ──────────────────────────────────────────────────────────
  // MetaMask event listeners
  // ──────────────────────────────────────────────────────────
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const eth = getEthereumProvider();
    if (!eth) return;

    const handleAccounts = (accs: string[]) => {
      if (accs.length === 0) {
        setWalletAddress(null);
        if (phaseRef.current === "executing" || phaseRef.current === "fetching-quote") {
          setBridgeAborted("Wallet disconnected during bridge. Transaction may still be pending on-chain.");
          setBridgeError("Wallet disconnected during bridge");
          setPhase("error");
        }
      } else {
        const newAddr = accs[0];
        setWalletAddress((prev) => {
          if (prev && prev.toLowerCase() !== newAddr.toLowerCase() &&
              (phaseRef.current === "executing" || phaseRef.current === "fetching-quote")) {
            setBridgeAborted("Wallet account changed during bridge. Transaction may still be pending on-chain.");
            setBridgeError("Wallet account changed during bridge");
            setPhase("error");
          }
          return newAddr;
        });
      }
    };

    const handleChain = (hexId: string) => {
      setWalletChainId(parseInt(hexId, 16));
    };

    const handleDisconnect = () => {
      setWalletAddress(null);
      setWalletChainId(0);
      if (phaseRef.current === "executing" || phaseRef.current === "fetching-quote") {
        setBridgeAborted("Wallet disconnected during bridge.");
        setBridgeError("Wallet disconnected during bridge");
        setPhase("error");
      }
    };

    eth.on("accountsChanged", handleAccounts);
    eth.on("chainChanged", handleChain);
    eth.on("disconnect", handleDisconnect);
    return () => {
      eth.removeListener("accountsChanged", handleAccounts);
      eth.removeListener("chainChanged", handleChain);
      eth.removeListener("disconnect", handleDisconnect);
    };
  }, []);

  // ──────────────────────────────────────────────────────────
  // Check existing MetaMask connection on mount
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!isMetaMaskInstalled()) return;
      try {
        const eth = getEthereumProvider();
        if (!eth) return;
        const accs = await eth.request({ method: "eth_accounts" });
        if (accs?.length) {
          setWalletAddress(accs[0]);
          const chainHex = await eth.request({ method: "eth_chainId" });
          setWalletChainId(parseInt(chainHex, 16));
        }
      } catch { /* silent */ }
    })();
  }, []);

  // ──────────────────────────────────────────────────────────
  // Load supported tokens from VT API on mount
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setDataLoading(true);
        setDataError("");
        const tokens = await fetchSupportedTokens();
        if (cancelled) return;

        setAllTokens(tokens);

        // Set initial selections: first two chains, first token on src
        const chains = buildAvailableChains(tokens);
        if (chains.length >= 2) {
          // Default to Ethereum → Arbitrum if available, else first two
          const eth = chains.find((c) => c.chainId === 1);
          const arb = chains.find((c) => c.chainId === 42161);
          const initialSrc = eth ?? chains[0];
          const initialDst = arb ?? chains.find((c) => c.chainId !== initialSrc.chainId) ?? chains[1];
          setSrcChain(initialSrc);
          setDstChain(initialDst);

          // Pick first token on src chain
          const srcTokens = buildAvailableTokens(tokens, initialSrc.chainKey);
          if (srcTokens.length > 0) {
            // Prefer USDC if available
            const usdc = srcTokens.find((t) => t.symbol === "USDC");
            setSrcToken(usdc ?? srcTokens[0]);
          }
        }

        log.info("StargateBridge", `Loaded ${tokens.length} tokens across ${chains.length} chains`);
      } catch (err: any) {
        if (!cancelled) {
          setDataError(err?.message || "Failed to load bridge data");
          log.error("StargateBridge", `Data load error: ${err?.message}`);
        }
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ──────────────────────────────────────────────────────────
  // When srcChain + srcToken change → load transferrable destinations
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!srcChain || !srcToken) {
      setDstChains([]);
      setDstTokenOptions([]);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingDstOptions(true);
      try {
        const transferrable = await getTransferrableTokens(srcChain.chainKey, srcToken.address);
        if (cancelled) return;

        // Build destination chain list from transferrable tokens
        const chains = buildAvailableChains(transferrable)
          .filter((c) => c.chainId !== srcChain.chainId);
        setDstChains(chains);

        // If current dstChain is still valid, keep it; otherwise pick first
        if (dstChain && chains.some((c) => c.chainId === dstChain.chainId)) {
          // Keep current dstChain, update token options
          const dstToks = buildAvailableTokens(transferrable, dstChain.chainKey);
          setDstTokenOptions(dstToks);

          // If current dstToken is still valid, keep it; otherwise pick first
          if (dstToken && dstToks.some((t) => t.address.toLowerCase() === dstToken.address.toLowerCase())) {
            // Keep
          } else if (dstToks.length > 0) {
            // Pick token with same symbol if possible
            const match = dstToks.find((t) => t.symbol === srcToken.symbol);
            setDstToken(match ?? dstToks[0]);
          } else {
            setDstToken(null);
          }
        } else if (chains.length > 0) {
          const newDst = chains[0];
          setDstChain(newDst);
          const dstToks = buildAvailableTokens(transferrable, newDst.chainKey);
          setDstTokenOptions(dstToks);
          const match = dstToks.find((t) => t.symbol === srcToken.symbol);
          setDstToken(match ?? dstToks[0] ?? null);
        } else {
          setDstChain(null);
          setDstToken(null);
          setDstTokenOptions([]);
        }
      } catch (err: any) {
        log.error("StargateBridge", `Transferrable tokens error: ${err?.message}`);
        if (!cancelled) {
          setDstChains([]);
          setDstTokenOptions([]);
        }
      } finally {
        if (!cancelled) setLoadingDstOptions(false);
      }
    })();
    return () => { cancelled = true; };
    // IMPLEMENTATION NOTE: we intentionally exclude dstChain/dstToken from deps
    // to avoid infinite loop. Those are only read, not triggering re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcChain?.chainKey, srcToken?.address]);

  // ──────────────────────────────────────────────────────────
  // When dstChain changes → update dstToken options
  // (uses the already-fetched transferrable tokens)
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!srcChain || !srcToken || !dstChain) return;
    let cancelled = false;
    (async () => {
      try {
        const transferrable = await getTransferrableTokens(srcChain.chainKey, srcToken.address);
        if (cancelled) return;
        const dstToks = buildAvailableTokens(transferrable, dstChain.chainKey);
        setDstTokenOptions(dstToks);
        if (!dstToken || !dstToks.some((t) => t.address.toLowerCase() === dstToken.address.toLowerCase())) {
          const match = dstToks.find((t) => t.symbol === srcToken.symbol);
          setDstToken(match ?? dstToks[0] ?? null);
        }
      } catch { /* already logged */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dstChain?.chainKey]);

  // ──────────────────────────────────────────────────────────
  // Fetch balance when wallet / srcChain / srcToken change
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!walletAddress || !srcChain || !srcToken) {
      setUserBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const bal = await getTokenBalance(walletAddress, srcChain.chainId, srcToken.address, srcToken.decimals);
        if (!cancelled) setUserBalance(bal);
      } catch {
        if (!cancelled) setUserBalance(null);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress, srcChain?.chainId, srcToken?.address, srcToken?.decimals]);

  // ──────────────────────────────────────────────────────────
  // Debounced multi-quote fetching + 30s auto-refresh
  // ──────────────────────────────────────────────────────────
  const doFetchQuotes = useCallback(async () => {
    if (!srcChain || !dstChain || !srcToken || !dstToken || !walletAddress || !amount) return;
    if (srcChain.chainId === dstChain.chainId) return;
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;

    setQuoteLoading(true);
    const _quoteStart = performance.now();
    try {
      const rawAmount = parseTokenAmount(amount, srcToken.decimals);
      const quotes = await fetchQuotes({
        amount: rawAmount,
        srcChainKey: srcChain.chainKey,
        srcTokenAddress: srcToken.address,
        srcWalletAddress: walletAddress,
        dstChainKey: dstChain.chainKey,
        dstTokenAddress: dstToken.address,
        dstWalletAddress: walletAddress,
      });
      if (quotes.length === 0) throw new Error("No quotes available for this route");
      setAllQuotes(quotes);
      const idx = 0; // Best price is always first (sorted in fetchQuotes)
      setSelectedQuoteIdx(idx);
      const picked = quotes[idx];
      setFeeDisplay(formatFeeDisplay(picked, dstToken.decimals, srcToken.decimals, dstToken.symbol, srcToken.symbol));
      setQuoteResult({ quote: picked, steps: [] });
      setQuoteError("");
      setQuoteErrorKind(null);
      setQuoteCountdown(30);
      // Step 17: capture timing for admin debug panel
      if (isAdmin) {
        const _quoteEnd = performance.now();
        setDebugQuoteTiming({ startMs: Math.round(_quoteStart), endMs: Math.round(_quoteEnd), durationMs: Math.round(_quoteEnd - _quoteStart) });
      }
    } catch (err: any) {
      const classified = classifyError(err);
      log.error("StargateBridge", `Quote error [${classified.kind}]: ${classified.technicalMessage}`);
      setQuoteErrorKind(classified);

      // Auto-recovery: quote expired → auto-refresh after delay
      if (classified.kind === "quote-expired") {
        setQuoteError(classified.userMessage);
        setTimeout(() => doFetchQuotes(), classified.retryAfterSec * 1000);
      }
      // Rate limited → show countdown, then auto-retry
      else if (classified.kind === "rate-limited") {
        setQuoteError(classified.userMessage);
        setRateLimitCountdown(classified.retryAfterSec);
        const rlTimer = setInterval(() => {
          setRateLimitCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(rlTimer);
              doFetchQuotes();
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
      // All other errors → show user-friendly message
      else {
        setQuoteError(classified.userMessage);
      }

      setAllQuotes([]);
      setQuoteResult(null);
      setFeeDisplay(null);
    }
    setQuoteLoading(false);
  }, [srcChain, dstChain, srcToken, dstToken, walletAddress, amount, isAdmin]);

  // Debounce on input change — 500ms
  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setQuoteResult(null);
    setFeeDisplay(null);
    setQuoteError("");
    setQuoteErrorKind(null);
    setRateLimitCountdown(0);
    setAllQuotes([]);
    setSelectedQuoteIdx(0);
    setQuoteCountdown(0);
    setShowConfirmation(false);

    if (!hasValidAmount || !srcChain || !dstChain || !srcToken || !dstToken || !walletAddress) return;
    if (srcChain.chainId === dstChain.chainId) return;

    setQuoteLoading(true);
    quoteTimerRef.current = setTimeout(() => { doFetchQuotes(); }, 500);

    return () => {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, srcChain?.chainKey, dstChain?.chainKey, srcToken?.address, dstToken?.address, walletAddress]);

  // Auto-refresh every 30s when a quote exists
  useEffect(() => {
    if (!feeDisplay || !hasValidAmount || showConfirmation || isExecuting) return;
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setQuoteCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    refreshIntervalRef.current = setInterval(() => { doFetchQuotes(); }, 30_000);
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeDisplay, hasValidAmount, showConfirmation, isExecuting]);

  // ── Quote expiry auto-refresh (Step 14) ──
  // If the VT API provides an expiresAt, watch it and auto-refresh before expiry.
  useEffect(() => {
    if (!selectedQuote?.expiresAt || phase !== "idle") return;
    const check = () => {
      const { isExpired, shouldRefresh } = checkQuoteExpiry(selectedQuote.expiresAt);
      if (isExpired || shouldRefresh) {
        log.info("StargateBridge", `Quote expiring/expired (${selectedQuote.expiresAt}), auto-refreshing`);
        doFetchQuotes();
      }
    };
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [selectedQuote?.expiresAt, phase, doFetchQuotes]);

  // When user picks a different route option
  const handleSelectQuote = useCallback((idx: number) => {
    if (idx >= allQuotes.length) return;
    setSelectedQuoteIdx(idx);
    const picked = allQuotes[idx];
    if (picked && dstToken && srcToken) {
      setFeeDisplay(formatFeeDisplay(picked, dstToken.decimals, srcToken.decimals, dstToken.symbol, srcToken.symbol));
      setQuoteResult({ quote: picked, steps: [] });
    }
  }, [allQuotes, dstToken, srcToken]);

  // ──────────────────────────────────────────────────────────
  // Handlers
  // ──────────────────────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    if (!isMetaMaskInstalled()) {
      if (isMobileBrowser()) {
        window.location.href = getMetaMaskDeepLink();
      } else {
        window.open("https://metamask.io/download/", "_blank", "noopener,noreferrer");
      }
      return;
    }
    try {
      const accounts = await requestAccounts();
      if (accounts.length) {
        setWalletAddress(accounts[0]);
        const cid = await getChainId();
        setWalletChainId(cid);
      }
    } catch (err: any) {
      setConnectError(err.message || "Failed to connect wallet");
      setTimeout(() => setConnectError(""), 5000);
    }
  }, []);

  const handleSwapChains = useCallback(() => {
    if (!srcChain || !dstChain) return;
    const prevSrcSymbol = srcToken?.symbol;
    const prevDstSymbol = dstToken?.symbol;
    const newSrc = dstChain;
    const newDst = srcChain;
    setSrcChain(newSrc);
    setDstChain(newDst);
    // Clear current quote — new direction needs fresh pricing
    setQuoteResult(null);
    setFeeDisplay(null);
    setAllQuotes([]);
    setQuoteError("");
    setQuoteErrorKind(null);
    setRateLimitCountdown(0);
    setShowConfirmation(false);
    // Pick src token on new src chain — prefer the token that was in dst
    const newSrcTokens = buildAvailableTokens(allTokens, newSrc.chainKey);
    if (newSrcTokens.length > 0) {
      const matchDst = prevDstSymbol ? newSrcTokens.find((t) => t.symbol === prevDstSymbol) : null;
      const matchSrc = prevSrcSymbol ? newSrcTokens.find((t) => t.symbol === prevSrcSymbol) : null;
      setSrcToken(matchDst ?? matchSrc ?? newSrcTokens[0]);
    } else {
      setSrcToken(null);
    }
    // dstToken will update via the transferrable effect
  }, [srcChain, dstChain, allTokens, srcToken?.symbol, dstToken?.symbol]);

  const handleSwitchChain = useCallback(async () => {
    if (!srcChain || switchingChain) return;
    setSwitchingChain(true);
    try {
      const ok = await switchChain(srcChain.chainId);
      if (ok) {
        const cid = await getChainId();
        setWalletChainId(cid);
      }
    } catch (err: any) {
      log.warn("StargateBridge", `Chain switch rejected: ${err?.message}`);
    } finally {
      setSwitchingChain(false);
    }
  }, [srcChain, switchingChain]);

  const selectSrcChain = useCallback((chain: ChainInfo) => {
    setSrcChain(chain);
    setShowSrcChains(false);
    setSrcChainSearch("");
    // Pick first token on new chain
    const tokens = buildAvailableTokens(allTokens, chain.chainKey);
    const match = tokens.find((t) => t.symbol === srcToken?.symbol);
    setSrcToken(match ?? tokens[0] ?? null);
  }, [allTokens, srcToken?.symbol]);

  const selectDstChain = useCallback((chain: ChainInfo) => {
    setDstChain(chain);
    setShowDstChains(false);
    setDstChainSearch("");
  }, []);

  const selectSrcToken = useCallback((token: TokenInfo) => {
    setSrcToken(token);
    setShowSrcTokens(false);
    setSrcTokenSearch("");
  }, []);

  const selectDstToken = useCallback((token: TokenInfo) => {
    setDstToken(token);
    setShowDstTokens(false);
    setDstTokenSearch("");
  }, []);

  const handleCopyTx = useCallback(() => {
    if (!bridgeTxHash) return;
    navigator.clipboard.writeText(bridgeTxHash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [bridgeTxHash]);

  const handleMaxBalance = useCallback(() => {
    if (userBalance) {
      setAmount(userBalance.formatted);
    }
  }, [userBalance]);

  // ──────────────────────────────────────────────────────────
  // Bridge execution — two-phase: click Bridge → Confirmation → Execute
  // ──────────────────────────────────────────────────────────
  const handleBridgeClick = useCallback(() => {
    if (!quoteResult || !feeDisplay) return;
    setShowConfirmation(true);
  }, [quoteResult, feeDisplay]);

  const handleConfirmBridge = useCallback(async () => {
    if (!walletAddress || !srcChain || !dstChain || !srcToken || !dstToken || !amount) return;
    const amountNum = parseFloat(amount);
    if (amountNum <= 0) return;

    // ── Step 14: Pre-bridge safety validation ──
    if (hasBlockingWarning) {
      setBridgeError(safetyWarnings.find((w) => w.severity === "block")?.message ?? "Cannot proceed — safety check failed");
      return;
    }

    // Check quote expiry right before execution
    const curQuote = allQuotes[selectedQuoteIdx];
    if (curQuote?.expiresAt) {
      const { isExpired } = checkQuoteExpiry(curQuote.expiresAt);
      if (isExpired) {
        setBridgeError("Quote expired. Refreshing...");
        doFetchQuotes();
        return;
      }
    }

    setShowConfirmation(false);
    setBridgeError("");
    setTxHashes([]);
    setExecProgress(null);
    setStepStates([]);
    setFailedStepIndex(null);

    try {
      const rawAmount = parseTokenAmount(amount, srcToken.decimals);
      if (userBalance && userBalance.raw < BigInt(rawAmount)) {
        throw new Error(
          `Insufficient ${srcToken.symbol} balance. You have ${userBalance.formatted} ${srcToken.symbol}`
        );
      }

      // Get fresh quote + build executable steps
      setPhase("fetching-quote");
      const selectedQuote = allQuotes[selectedQuoteIdx];
      let steps;
      if (selectedQuote?.userSteps && selectedQuote.userSteps.length > 0) {
        steps = selectedQuote.userSteps;
      } else if (selectedQuote?.id) {
        try {
          steps = await fetchUserSteps(selectedQuote.id);
        } catch (err: any) {
          log.warn("StargateBridge", `Build steps failed (${err?.message}), fetching fresh quote`);
          const freshQuotes = await fetchQuotes({
            amount: rawAmount,
            srcChainKey: srcChain.chainKey,
            srcTokenAddress: srcToken.address,
            srcWalletAddress: walletAddress,
            dstChainKey: dstChain.chainKey,
            dstTokenAddress: dstToken.address,
            dstWalletAddress: walletAddress,
          });
          if (freshQuotes.length === 0) throw new Error("No quotes available");
          const fresh = freshQuotes[0];
          setFeeDisplay(formatFeeDisplay(fresh, dstToken.decimals, srcToken.decimals, dstToken.symbol, srcToken.symbol));
          steps = fresh.userSteps?.length ? fresh.userSteps : await fetchUserSteps(fresh.id);
        }
      } else {
        throw new Error("No valid quote selected");
      }

      // Initialize per-step states
      const initialStepStates: StepState[] = steps.map((s) => ({
        status: "waiting" as StepStatus,
        description: s.description,
      }));
      setStepStates(initialStepStates);
      setPhase("executing");

      const hashes = await executeUserSteps(steps, {
        onStepStart: (index, total, description) => {
          setExecProgress({ currentStep: index + 1, totalSteps: total, description });
          setStepStates((prev) => prev.map((s, i) =>
            i === index ? { ...s, status: "wallet", description } : s
          ));
          log.info("StargateBridge", `Step ${index + 1}/${total}: ${description}`);
        },
        onStepSubmitted: (index, txHash, description) => {
          setStepStates((prev) => prev.map((s, i) =>
            i === index ? { ...s, status: "pending", txHash, description } : s
          ));
          log.info("StargateBridge", `Step ${index + 1} submitted: ${txHash}`);
        },
        onStepComplete: (index, txHash, description) => {
          setTxHashes((prev) => [...prev, txHash]);
          setStepStates((prev) => prev.map((s, i) =>
            i === index ? { ...s, status: "complete", txHash, description } : s
          ));
          log.info("StargateBridge", `Step ${index + 1} confirmed: ${txHash}`);
        },
        onStepError: (index, error, description) => {
          setStepStates((prev) => prev.map((s, i) =>
            i === index ? { ...s, status: "error", error: error.message, description } : s
          ));
          setFailedStepIndex(index);
          log.error("StargateBridge", `Step ${index + 1} failed (${description}): ${error.message}`);
        },
      });

      setTxHashes(hashes);
      setPhase("success");

      // ── Step 15: Save bridge receipt to localStorage ──
      try {
        const lastHash = hashes.length > 0 ? hashes[hashes.length - 1] : "";
        const receipt: BridgeReceipt = {
          id: `br-${Date.now()}`,
          timestamp: new Date().toISOString(),
          srcChainName: srcChain.name,
          srcChainId: srcChain.chainId,
          srcTokenSymbol: srcToken.symbol,
          srcAmount: amount,
          dstChainName: dstChain.name,
          dstChainId: dstChain.chainId,
          dstTokenSymbol: dstToken.symbol,
          dstAmount: feeDisplay?.youReceive ?? "?",
          feeUsd: feeDisplay?.totalFeeUsd ?? "—",
          feePercent: feeDisplay?.feePercent ?? "—",
          routeType: feeDisplay?.routeTypeLabel ?? "—",
          estimatedDuration: feeDisplay?.estimatedDuration ?? "—",
          txHash: lastHash,
          stepTxHashes: hashes,
        };
        saveBridgeReceipt(receipt);
        setRecentBridges(loadBridgeReceipts());
      } catch (e) {
        log.warn("StargateBridge", `Failed to save bridge receipt: ${e}`);
      }
    } catch (err: any) {
      const classified = classifyError(err);
      log.error("StargateBridge", `Bridge error [${classified.kind}]: ${classified.technicalMessage}`);

      if (classified.isSoft) {
        // User rejected — not a real error, go back to idle with a brief message
        setBridgeError(classified.userMessage);
        setPhase("idle");
      } else {
        setBridgeError(classified.userMessage);
        setPhase("error");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, srcChain, dstChain, srcToken, dstToken, amount, userBalance, allQuotes, selectedQuoteIdx, hasBlockingWarning, safetyWarnings, doFetchQuotes]);

  const handleReset = useCallback(() => {
    setPhase("idle");
    setShowConfirmation(false);
    setBridgeError("");
    setBridgeAborted("");
    setTxHashes([]);
    setExecProgress(null);
    setStepStates([]);
    setFailedStepIndex(null);
  }, []);

  // ──────────────────────────────────────────────────────────
  // Step 17: API health check on mount (admin only)
  // ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setApiHealthChecking(true);
    testApiConnection().then((result) => {
      if (!cancelled) {
        setApiHealth(result);
        setApiHealthChecking(false);
      }
    });
    return () => { cancelled = true; };
  }, [isAdmin]);

  /** "Test Quote Only" handler — fetches a quote without executing */
  const handleTestQuoteOnly = useCallback(async () => {
    if (!srcChain || !dstChain || !srcToken || !dstToken || !walletAddress || !amount) return;
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;
    setTestQuoteLoading(true);
    const start = performance.now();
    try {
      const rawAmount = parseTokenAmount(amount, srcToken.decimals);
      const quotes = await fetchQuotes({
        amount: rawAmount,
        srcChainKey: srcChain.chainKey,
        srcTokenAddress: srcToken.address,
        srcWalletAddress: walletAddress,
        dstChainKey: dstChain.chainKey,
        dstTokenAddress: dstToken.address,
        dstWalletAddress: walletAddress,
      });
      const end = performance.now();
      setDebugQuoteTiming({ startMs: Math.round(start), endMs: Math.round(end), durationMs: Math.round(end - start) });
      if (quotes.length > 0) {
        setAllQuotes(quotes);
        setSelectedQuoteIdx(0);
        setFeeDisplay(formatFeeDisplay(quotes[0], dstToken.decimals, srcToken.decimals, dstToken.symbol, srcToken.symbol));
        setQuoteResult({ quote: quotes[0], steps: [] });
        setQuoteError("");
        setQuoteErrorKind(null);
      } else {
        setQuoteError("No quotes returned (test)");
      }
    } catch (err: any) {
      const end = performance.now();
      setDebugQuoteTiming({ startMs: Math.round(start), endMs: Math.round(end), durationMs: Math.round(end - start) });
      setQuoteError(`Test quote error: ${err.message}`);
    } finally {
      setTestQuoteLoading(false);
    }
  }, [srcChain, dstChain, srcToken, dstToken, walletAddress, amount]);

  // ──────────────────────────────────────────────────────────
  // Render helpers
  // ──────────────────────────────────────────────────────────

  /** Human-readable route type label */
  function routeLabel(type: string): string {
    const MAP: Record<string, string> = {
      STARGATE_V2_TAXI: "Stargate V2 (Taxi)",
      STARGATE_V2_BUS: "Stargate V2 (Bus)",
      STARGATE_V1: "Stargate V1",
      OFT_V1: "OFT V1",
      OFT_V2: "OFT V2",
      CCTP_V1: "Circle CCTP V1",
      CCTP_V2: "Circle CCTP V2",
      AORI_V1: "Aori V1",
    };
    return MAP[type] ?? type.replace(/_/g, " ");
  }

  /** Short duration parse from ISO-style or raw seconds */
  function shortDuration(est: string | null | undefined): string {
    if (!est) return "—";
    const secs = parseInt(est, 10);
    if (isNaN(secs)) return est;
    if (secs < 60) return `~${secs}s`;
    return `~${Math.ceil(secs / 60)} min`;
  }

  const cls = {
    muted: isDark ? "text-slate-500" : "text-gray-400",
    label: `text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`,
    card: isDark
      ? "bg-white/[0.04] border border-white/[0.08]"
      : "bg-gray-50 border border-gray-200",
    cardHover: isDark ? "hover:bg-white/[0.07]" : "hover:bg-gray-100",
    dropdown: isDark
      ? "bg-[#1a1a24] border border-white/[0.08]"
      : "bg-white border border-gray-200",
    selected: isDark ? "bg-cyan-500/10" : "bg-cyan-50",
    hoverRow: isDark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50",
    value: isDark ? "text-slate-300" : "text-gray-700",
    heading: isDark ? "text-white" : "text-gray-900",
  };

  /** Render a chain icon badge with color background + emoji */
  const ChainBadge = ({ chain, size = "md" }: { chain: ChainInfo; size?: "sm" | "md" }) => {
    const s = size === "sm" ? "w-5 h-5 text-[9px]" : "w-6 h-6 text-[10px]";
    return (
      <div
        className={`${s} rounded-full flex items-center justify-center text-white font-bold shadow-sm`}
        style={{ backgroundColor: chain.color }}
        title={chain.name}
      >
        {chain.icon}
      </div>
    );
  };

  /**
   * Render a token logo with onError fallback (Step 16).
   * Shows the VT API logo if available, falls back to a colored circle
   * with the first letter of the symbol.
   */
  const TokenLogo = ({ token, size = "md" }: { token: TokenInfo | { symbol: string; logoUrl?: string }; size?: "sm" | "md" | "lg" }) => {
    const [imgError, setImgError] = useState(false);
    const px = size === "sm" ? "w-4 h-4 text-[7px]" : size === "lg" ? "w-7 h-7 text-[11px]" : "w-5 h-5 text-[8px]";
    const sym = token.symbol || "?";
    // Deterministic color from symbol hash
    const hue = sym.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
    const bgColor = `hsl(${hue}, 55%, 45%)`;

    if (token.logoUrl && !imgError) {
      return (
        <img
          src={token.logoUrl}
          alt={sym}
          className={`${px} rounded-full object-cover`}
          onError={() => setImgError(true)}
          loading="lazy"
        />
      );
    }

    return (
      <div
        className={`${px} rounded-full flex items-center justify-center text-white font-bold shrink-0`}
        style={{ backgroundColor: bgColor }}
      >
        {sym[0]}
      </div>
    );
  };

  /** Render a search input inside dropdown */
  const SearchInput = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
    <div className={`sticky top-0 p-1.5 ${isDark ? "bg-[#1a1a24]" : "bg-white"}`}>
      <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
        <Search className={`w-3 h-3 ${cls.muted}`} />
        <input
          type="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`text-[16px] sm:text-xs bg-transparent outline-none w-full ${isDark ? "text-white placeholder:text-slate-600" : "text-gray-900 placeholder:text-gray-400"}`}
          autoFocus={!isMobile}
        />
      </div>
    </div>
  );

  // ──────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────

  return (
    <div className="w-full" ref={containerRef}>
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            walletAddress
              ? "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]"
              : "bg-slate-500"
          }`} />
          {walletAddress && walletChainMeta && !isExecuting && (
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: walletChainMeta.color }}
              title={walletChainMeta.name}
            />
          )}
          <span className={`text-xs truncate ${cls.muted}`}>
            {isExecuting
              ? "Bridge in progress..."
              : walletAddress
              ? isMobile
                ? `${formatAddress(walletAddress)}${walletChainMeta ? ` · ${walletChainMeta.name}` : ""}`
                : `Stargate V2 — ${formatAddress(walletAddress)}${walletChainMeta ? ` (${walletChainMeta.name})` : ""}`
              : "Stargate V2 — Not Connected"}
          </span>
        </div>
        <button
          onClick={onClose}
          disabled={isExecuting}
          className={`p-1.5 rounded-lg transition-colors ${
            isExecuting
              ? "opacity-30 cursor-not-allowed text-slate-600"
              : isDark
              ? "hover:bg-white/[0.06] text-slate-500 hover:text-slate-300"
              : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          }`}
          title={isExecuting ? "Bridge in progress — please wait" : "Close"}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── API service status (Step 17) ── */}
      {isAdmin && apiHealth && (
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] mt-1 ${
          apiHealth.connected
            ? isDark ? "bg-green-500/10 text-green-400" : "bg-green-50 text-green-700"
            : isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"
        }`}>
          <Activity className="w-3 h-3" />
          {apiHealth.connected
            ? `Bridge service: Connected ✓  (${apiHealth.latencyMs}ms)`
            : `Bridge service: Unavailable ✗  ${apiHealth.error ?? ""}`}
        </div>
      )}
      {isAdmin && apiHealthChecking && !apiHealth && (
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] mt-1 ${
          isDark ? "bg-white/[0.03] text-slate-500" : "bg-gray-50 text-gray-400"
        }`}>
          <Loader2 className="w-3 h-3 animate-spin" />
          Checking bridge service…
        </div>
      )}

      {/* ── Main card ── */}
      <div className={`rounded-2xl overflow-visible ${
        isDark
          ? "bg-[#0D0D12] border border-white/[0.06]"
          : "bg-white border border-gray-200 shadow-lg"
      }`}>
        <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">

          {/* ══ LOADING STATE (initial data fetch) ══ */}
          {dataLoading && (
            <div className="text-center py-10 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mx-auto" />
              <p className={`text-sm ${cls.muted}`}>Loading bridge routes...</p>
            </div>
          )}

          {/* ══ DATA ERROR STATE ══ */}
          {!dataLoading && dataError && (
            <div className="text-center py-8 space-y-4">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
              <div>
                <h4 className={`font-bold mb-1 ${cls.heading}`}>Failed to Load</h4>
                <p className={`text-xs ${cls.muted} max-w-xs mx-auto`}>{dataError}</p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className={`flex items-center justify-center gap-2 mx-auto px-4 py-2 rounded-xl text-sm font-medium ${
                  isDark ? "bg-white/[0.06] hover:bg-white/[0.1] text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          )}

          {/* ══ SUCCESS STATE — Bridge Receipt (Step 15) ══ */}
          {phase === "success" && bridgeTxHash && srcChain && (
            <div className="relative py-6 space-y-4 overflow-hidden">
              {/* CSS confetti particles */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-1.5 h-1.5 rounded-full animate-[confetti-fall_2.5s_ease-out_forwards]"
                    style={{
                      left: `${4 + (i * 4) % 92}%`,
                      top: "-8px",
                      backgroundColor: [
                        "#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f472b6",
                        "#60a5fa", "#818cf8", "#2dd4bf", "#fb923c", "#e879f9",
                        "#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f472b6",
                        "#60a5fa", "#818cf8", "#2dd4bf", "#fb923c", "#e879f9",
                        "#22d3ee", "#a78bfa", "#34d399", "#fbbf24",
                      ][i],
                      animationDelay: `${i * 0.08}s`,
                      opacity: 0,
                    }}
                  />
                ))}
              </div>
              <style>{`
                @keyframes confetti-fall {
                  0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
                  25% { opacity: 1; }
                  100% { transform: translateY(260px) rotate(${Math.random() > 0.5 ? '' : '-'}720deg) scale(0.3); opacity: 0; }
                }
              `}</style>

              {/* ── Header ── */}
              <div className="text-center space-y-2 relative z-10">
                <div className="w-14 h-14 rounded-full bg-cyan-500/20 flex items-center justify-center mx-auto animate-[pulse_1.5s_ease-in-out_1]">
                  <CheckCircle2 className="w-7 h-7 text-cyan-400" />
                </div>
                <h4 className={`text-lg font-bold ${cls.heading}`}>Bridge Initiated!</h4>
              </div>

              {/* ── Receipt Card ── */}
              <div className={`relative z-10 rounded-xl overflow-hidden ${
                isDark ? "bg-white/[0.03] border border-white/[0.06]" : "bg-gray-50 border border-gray-100"
              }`}>
                {/* Receipt header */}
                <div className={`px-3 py-2 flex items-center justify-between ${
                  isDark ? "bg-cyan-500/5 border-b border-white/[0.04]" : "bg-cyan-50 border-b border-gray-100"
                }`}>
                  <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? "text-cyan-400/70" : "text-cyan-700"}`}>
                    Bridge Receipt
                  </span>
                  <span className={`text-[10px] tabular-nums ${cls.muted}`}>
                    {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                <div className="p-3 space-y-3">
                  {/* Source → Destination visual (Step 16: with logos) */}
                  <div className="flex items-center gap-2 text-sm">
                    <div className="flex-1 text-left space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        {srcToken && <TokenLogo token={srcToken} size="sm" />}
                        <span className={`font-bold ${cls.heading}`}>{amount} {srcToken?.symbol}</span>
                      </div>
                      <div className="flex items-center gap-1 ml-0.5">
                        <ChainBadge chain={srcChain} size="sm" />
                        <span className={`text-[10px] ${cls.muted}`}>{srcChain.name}</span>
                      </div>
                    </div>
                    <ArrowRight className={`w-4 h-4 shrink-0 ${isDark ? "text-cyan-500/50" : "text-cyan-400"}`} />
                    <div className="flex-1 text-right space-y-0.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`font-bold ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>~{feeDisplay?.youReceive ?? "?"} {dstToken?.symbol}</span>
                        {dstToken && <TokenLogo token={dstToken} size="sm" />}
                      </div>
                      <div className="flex items-center justify-end gap-1 mr-0.5">
                        <span className={`text-[10px] ${cls.muted}`}>{dstChain?.name}</span>
                        {dstChain && <ChainBadge chain={dstChain} size="sm" />}
                      </div>
                    </div>
                  </div>

                  {/* Details grid */}
                  <div className={`rounded-lg p-2.5 space-y-1.5 text-xs ${
                    isDark ? "bg-white/[0.02]" : "bg-white"
                  }`}>
                    {feeDisplay && (
                      <>
                        <div className="flex justify-between">
                          <span className={cls.muted}>Fee</span>
                          <span className={cls.value}>{feeDisplay.totalFeeUsd} ({feeDisplay.feePercent})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={cls.muted}>Route</span>
                          <span className={cls.value}>{feeDisplay.routeTypeLabel}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={cls.muted}>Est. Arrival</span>
                          <span className={cls.value}>{feeDisplay.estimatedDuration}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between items-center">
                      <span className={cls.muted}>TX Hash</span>
                      <div className="flex items-center gap-1">
                        <span className={`font-mono text-[11px] ${cls.value}`}>
                          {bridgeTxHash.slice(0, 8)}...{bridgeTxHash.slice(-5)}
                        </span>
                        <button
                          onClick={handleCopyTx}
                          className={`p-0.5 rounded transition-colors ${isDark ? "hover:bg-white/[0.06]" : "hover:bg-gray-100"}`}
                          title="Copy tx hash"
                        >
                          {copied ? <Check className="w-3 h-3 text-cyan-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Completed steps accordion */}
                  {stepStates.length > 0 && (
                    <div className={`rounded-lg overflow-hidden ${isDark ? "bg-white/[0.02]" : "bg-white"}`}>
                      <div className={`px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-medium ${cls.muted}`}>
                        Steps ({stepStates.length})
                      </div>
                      <div className="px-2.5 pb-2 space-y-1">
                        {stepStates.map((s, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-[11px]">
                            <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                            <span className={isDark ? "text-slate-300" : "text-gray-600"}>{s.description}</span>
                            {s.txHash && (
                              <span className={`ml-auto font-mono text-[9px] ${cls.muted}`}>
                                {s.txHash.slice(0, 6)}...
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Prominent "View on LayerZero Scan" button ── */}
              {(() => {
                const urls = getTxTrackingUrls(bridgeTxHash, srcChain.chainId);
                return (
                  <div className="relative z-10 space-y-2">
                    <a
                      href={urls.lzScan}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm transition-all ${
                        isDark
                          ? "bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/20 hover:border-purple-500/30"
                          : "bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200"
                      }`}
                    >
                      <ExternalLink className="w-4 h-4" />
                      View on LayerZero Scan
                    </a>
                    <div className="flex gap-2">
                      {urls.explorer && (
                        <a href={urls.explorer} target="_blank" rel="noopener noreferrer"
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-colors ${
                            isDark ? "bg-cyan-600/15 text-cyan-400 hover:bg-cyan-600/25" : "bg-cyan-50 text-cyan-600 hover:bg-cyan-100"
                          }`}>
                          <ExternalLink className="w-3 h-3" /> Explorer
                        </a>
                      )}
                      <a href={urls.stargateScan} target="_blank" rel="noopener noreferrer"
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-colors ${
                          isDark ? "bg-blue-600/15 text-blue-400 hover:bg-blue-600/25" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                        }`}>
                        <ExternalLink className="w-3 h-3" /> Stargate
                      </a>
                    </div>
                  </div>
                );
              })()}

              <button onClick={handleReset}
                className="relative z-10 w-full py-3 rounded-xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white transition-all">
                Bridge More
              </button>
            </div>
          )}

          {/* ══ ERROR STATE ══ */}
          {phase === "error" && (
            <div className="py-6 space-y-4">
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle className="w-7 h-7 text-red-400" />
                </div>
                <h4 className={`text-lg font-bold mb-1 ${cls.heading}`}>Bridge Failed</h4>
                {/* Determine which step failed for contextual messaging */}
                {failedStepIndex !== null && stepStates.length > 0 ? (
                  <p className={`text-xs max-w-xs mx-auto ${cls.muted}`}>
                    Failed at Step {failedStepIndex + 1} of {stepStates.length}: {stepStates[failedStepIndex]?.description}
                  </p>
                ) : (
                  <p className={`text-sm max-w-xs mx-auto ${cls.muted}`}>
                    {bridgeError}
                  </p>
                )}
              </div>

              {/* Step-by-step breakdown showing what succeeded/failed */}
              {stepStates.length > 0 && (
                <div className={`rounded-xl p-3 space-y-1.5 ${isDark ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                  {stepStates.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {s.status === "complete" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                      ) : s.status === "error" ? (
                        <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <div className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 mt-0.5 ${isDark ? "border-white/[0.15]" : "border-gray-300"}`} />
                      )}
                      <div className="flex-1">
                        <span className={s.status === "error" ? (isDark ? "text-red-400" : "text-red-600") : s.status === "complete" ? (isDark ? "text-slate-300" : "text-gray-600") : cls.muted}>
                          {s.description}
                        </span>
                        {s.status === "error" && s.error && (
                          <p className={`text-[10px] mt-0.5 ${isDark ? "text-red-400/70" : "text-red-500"}`}>{s.error.slice(0, 120)}</p>
                        )}
                        {s.status === "complete" && s.txHash && (
                          <span className={`font-mono text-[10px] ml-1 ${cls.muted}`}>({s.txHash.slice(0, 8)}...)</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Approval-aware hint */}
              {failedStepIndex !== null && failedStepIndex > 0 && stepStates.some((s) => s.status === "complete" && s.description.toLowerCase().includes("approv")) && (
                <div className={`text-xs text-center px-3 py-2 rounded-lg ${
                  isDark ? "bg-green-500/10 text-green-400/80" : "bg-green-50 text-green-700"
                }`}>
                  Token approval was successful. You can retry the bridge without re-approving.
                </div>
              )}

              {/* Abort warning (wallet changed/disconnected) */}
              {bridgeAborted && (
                <div className={`text-center text-xs px-3 py-2.5 rounded-lg ${
                  isDark ? "bg-amber-500/10 text-amber-400/80 border border-amber-500/20" : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}>
                  {bridgeAborted}
                </div>
              )}

              {/* Error detail */}
              {bridgeError && !bridgeAborted && (
                <div className={`text-center text-xs px-3 py-2 rounded-lg ${
                  isDark ? "bg-red-500/10 text-red-400/70" : "bg-red-50 text-red-600"
                }`}>
                  {bridgeError}
                </div>
              )}

              {/* Report Issue — copies debug info to clipboard */}
              {bridgeError && !bridgeAborted && (
                <button
                  onClick={() => {
                    const report = buildDebugReport({
                      quoteId: allQuotes[selectedQuoteIdx]?.id,
                      routeType: feeDisplay?.routeType,
                      srcChain: srcChain?.name,
                      dstChain: dstChain?.name,
                      srcToken: srcToken?.symbol,
                      dstToken: dstToken?.symbol,
                      amount,
                      walletAddress: walletAddress ?? undefined,
                      walletChainId: walletChainId || undefined,
                      error: bridgeError,
                      txHashes,
                      phase,
                    });
                    navigator.clipboard.writeText(report).then(() => {
                      setDebugCopied(true);
                      setTimeout(() => setDebugCopied(false), 3000);
                    }).catch(() => log.warn("StargateBridge", "Clipboard write failed"));
                  }}
                  className={`flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[10px] transition-colors ${
                    isDark ? "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {debugCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {debugCopied ? "Debug info copied!" : "Report Issue — copy debug info"}
                </button>
              )}

              <div className="flex gap-2">
                <button onClick={handleReset}
                  className={`flex-1 py-3 rounded-xl font-bold transition-all ${
                    isDark ? "bg-white/[0.06] hover:bg-white/[0.1] text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                  }`}>
                  {bridgeAborted ? "Dismiss" : "Cancel"}
                </button>
                {!bridgeAborted && (
                  <button onClick={handleConfirmBridge}
                    className="flex-[2] py-3 rounded-xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white transition-all">
                    <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
                    Retry Bridge
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ══ EXECUTING STATE — step-by-step progress ══ */}
          {isExecuting && (
            <div className="py-5 space-y-4">
              {/* Header */}
              <div className="text-center space-y-1">
                {phase === "fetching-quote" ? (
                  <>
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mx-auto mb-2" />
                    <h4 className={`font-bold ${cls.heading}`}>Preparing Transaction...</h4>
                    <p className={`text-xs ${cls.muted}`}>Fetching a fresh quote and building steps</p>
                  </>
                ) : (
                  <>
                    <h4 className={`font-bold text-sm ${cls.heading}`}>
                      Bridge in Progress
                    </h4>
                    <p className={`text-xs ${cls.muted}`}>
                      {amount} {srcToken?.symbol} ({srcChain?.name}) → {dstToken?.symbol} ({dstChain?.name})
                    </p>
                  </>
                )}
              </div>

              {/* Step-by-step progress */}
              {stepStates.length > 0 && (
                <div className={`rounded-xl overflow-hidden ${isDark ? "bg-white/[0.02] border border-white/[0.06]" : "bg-gray-50 border border-gray-200"}`}>
                  {stepStates.map((s, i) => {
                    const isActive = s.status === "wallet" || s.status === "pending";
                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-3 px-3.5 py-3 ${
                          i > 0 ? `border-t ${isDark ? "border-white/[0.04]" : "border-gray-200"}` : ""
                        } ${isActive ? (isDark ? "bg-cyan-500/5" : "bg-cyan-50/50") : ""}`}
                      >
                        {/* Step icon */}
                        <div className="flex-shrink-0">
                          {s.status === "complete" ? (
                            <div className="w-7 h-7 rounded-full bg-green-500/15 flex items-center justify-center">
                              <CheckCircle2 className="w-4 h-4 text-green-400" />
                            </div>
                          ) : s.status === "error" ? (
                            <div className="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center">
                              <X className="w-4 h-4 text-red-400" />
                            </div>
                          ) : isActive ? (
                            <div className="w-7 h-7 rounded-full bg-cyan-500/15 flex items-center justify-center">
                              <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                            </div>
                          ) : (
                            <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${
                              isDark ? "border-white/[0.1] text-white/20" : "border-gray-300 text-gray-300"
                            }`}>
                              {i + 1}
                            </div>
                          )}
                        </div>

                        {/* Step info */}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${
                            s.status === "complete" ? (isDark ? "text-slate-300" : "text-gray-600")
                            : isActive ? (isDark ? "text-white" : "text-gray-900")
                            : cls.muted
                          }`}>
                            {s.description}
                          </div>
                          <div className={`text-[10px] ${cls.muted}`}>
                            {s.status === "wallet" && "Confirm in your wallet..."}
                            {s.status === "pending" && "Transaction submitted — waiting for confirmation..."}
                            {s.status === "complete" && s.txHash && (
                              <span className="font-mono">{s.txHash.slice(0, 12)}...{s.txHash.slice(-6)}</span>
                            )}
                            {s.status === "waiting" && "Waiting..."}
                            {s.status === "error" && (
                              <span className={isDark ? "text-red-400/70" : "text-red-500"}>{s.error?.slice(0, 80) ?? "Failed"}</span>
                            )}
                          </div>
                        </div>

                        {/* Status badge */}
                        <div className="flex-shrink-0">
                          {s.status === "wallet" && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-100 text-amber-700"}`}>
                              SIGN
                            </span>
                          )}
                          {s.status === "pending" && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${isDark ? "bg-cyan-500/15 text-cyan-400" : "bg-cyan-100 text-cyan-700"}`}>
                              PENDING
                            </span>
                          )}
                          {s.status === "complete" && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${isDark ? "bg-green-500/15 text-green-400" : "bg-green-100 text-green-700"}`}>
                              DONE
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Overall progress bar */}
              {execProgress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] ${cls.muted}`}>
                      Step {execProgress.currentStep} of {execProgress.totalSteps}
                    </span>
                    <span className={`text-[10px] ${cls.muted}`}>
                      {Math.round((stepStates.filter((s) => s.status === "complete").length / stepStates.length) * 100)}%
                    </span>
                  </div>
                  <div className={`w-full h-1.5 rounded-full overflow-hidden ${isDark ? "bg-white/[0.06]" : "bg-gray-200"}`}>
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
                      style={{ width: `${(stepStates.filter((s) => s.status === "complete").length / stepStates.length) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ MAIN FORM (idle state, data loaded) ══ */}
          {!dataLoading && !dataError && phase === "idle" && srcChain && (
            <>
              {/* ── Chain mismatch warning ── */}
              {needsChainSwitch && walletChainMeta && (
                <div className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs ${
                  isDark ? "bg-amber-500/10 border border-amber-500/20" : "bg-amber-50 border border-amber-200"
                }`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? "text-amber-400" : "text-amber-500"}`} />
                    <span className={isDark ? "text-amber-300/90" : "text-amber-700"}>
                      You're on <b>{walletChainMeta.name}</b>. Switch to <b>{srcChain.name}</b> to bridge.
                    </span>
                  </div>
                  <button
                    onClick={handleSwitchChain}
                    disabled={switchingChain}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                      isDark
                        ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-300"
                        : "bg-amber-100 hover:bg-amber-200 text-amber-800"
                    }`}
                  >
                    {switchingChain ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Switching...</>
                    ) : (
                      "Switch Network"
                    )}
                  </button>
                </div>
              )}

              {/* ── Wallet disconnected reconnect prompt ── */}
              {bridgeAborted && phase !== "error" && (
                <div className={`text-center text-xs px-3 py-2.5 rounded-xl ${
                  isDark ? "bg-red-500/10 text-red-400/80 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"
                }`}>
                  {bridgeAborted}
                </div>
              )}

              {/* ── Source chain + Token ── */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={cls.label}>From</label>
                  {userBalance && srcToken && (
                    <button
                      onClick={handleMaxBalance}
                      className={`text-[10px] ${isDark ? "text-cyan-400/70 hover:text-cyan-400" : "text-cyan-600 hover:text-cyan-700"} transition-colors`}
                    >
                      Balance: {formatDisplayAmount(userBalance.formatted, srcToken.symbol, srcToken.decimals)} {srcToken.symbol}
                    </button>
                  )}
                </div>
                <div className={`rounded-xl overflow-visible ${cls.card}`}>
                  {/* Chain selector */}
                  <div className="relative">
                    <button
                      onClick={() => { closeAllDropdowns(); setShowSrcChains(!showSrcChains); }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 transition-colors ${cls.cardHover}`}
                    >
                      <div className="flex items-center gap-2">
                        <ChainBadge chain={srcChain} />
                        <span className={`text-sm font-medium ${cls.heading}`}>{srcChain.name}</span>
                        {needsChainSwitch && (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700"}`}>
                            Switch needed
                          </span>
                        )}
                      </div>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSrcChains ? "rotate-180" : ""} ${cls.muted}`} />
                    </button>
                    {showSrcChains && (
                      <div className={`absolute left-0 right-0 top-full mt-0.5 rounded-xl z-30 max-h-56 overflow-y-auto overscroll-contain shadow-xl ${cls.dropdown}`}>
                        <SearchInput value={srcChainSearch} onChange={setSrcChainSearch} placeholder="Search chains..." />
                        {availableChains
                          .filter((c) => c.name.toLowerCase().includes(srcChainSearch.toLowerCase()))
                          .map((c) => (
                            <button
                              key={c.chainId}
                              onClick={() => selectSrcChain(c)}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                                c.chainId === srcChain.chainId ? cls.selected : cls.hoverRow
                              }`}
                            >
                              <ChainBadge chain={c} size="sm" />
                              {c.name}
                              <span className={`text-[9px] ml-auto ${cls.muted}`}>{c.tokenCount} tokens</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Token selector row */}
                  <div className={`border-t ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}>
                    <div className="relative">
                      <button
                        onClick={() => { closeAllDropdowns(); setShowSrcTokens(!showSrcTokens); }}
                        className={`w-full flex items-center justify-between px-3 py-2 transition-colors ${cls.cardHover}`}
                      >
                        {srcToken ? (
                          <div className="flex items-center gap-2">
                            <TokenLogo token={srcToken} />
                            <span className={`text-sm font-medium ${cls.heading}`}>{srcToken.symbol}</span>
                            <span className={`text-[10px] ${cls.muted}`}>{srcToken.name}</span>
                          </div>
                        ) : (
                          <span className={`text-sm ${cls.muted}`}>Select token</span>
                        )}
                        <ChevronDown className={`w-3 h-3 transition-transform ${showSrcTokens ? "rotate-180" : ""} ${cls.muted}`} />
                      </button>
                      {showSrcTokens && (
                        <div className={`absolute left-0 right-0 top-full mt-0.5 rounded-xl z-30 max-h-48 overflow-y-auto overscroll-contain shadow-xl ${cls.dropdown}`}>
                          {srcTokenOptions.length > 5 && (
                            <SearchInput value={srcTokenSearch} onChange={setSrcTokenSearch} placeholder="Search tokens..." />
                          )}
                          {srcTokenOptions
                            .filter((t) => t.symbol.toLowerCase().includes(srcTokenSearch.toLowerCase()) || t.name.toLowerCase().includes(srcTokenSearch.toLowerCase()))
                            .map((t) => (
                              <button
                                key={t.address}
                                onClick={() => selectSrcToken(t)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                                  srcToken?.address === t.address ? cls.selected : cls.hoverRow
                                }`}
                              >
                                <TokenLogo token={t} />
                                <span className="font-medium">{t.symbol}</span>
                                <span className={`text-xs ${cls.muted} truncate`}>{t.name}</span>
                                {t.priceUsd != null && t.priceUsd > 0 && (
                                  <span className={`text-[10px] ml-auto tabular-nums ${cls.muted}`}>{formatUsd(t.priceUsd)}</span>
                                )}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Amount input */}
                  <div className={`border-t ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}>
                    <input
                      type="number"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      min="0"
                      step="any"
                      disabled={isExecuting}
                      className={`w-full px-3 py-3 text-lg bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                        isDark ? "text-white placeholder:text-slate-600" : "text-gray-900 placeholder:text-gray-300"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* ── Swap button ── */}
              <div className="flex justify-center -my-1">
                <button
                  onClick={handleSwapChains}
                  className={`p-2 rounded-full transition-all duration-200 ${
                    isDark
                      ? "bg-white/[0.06] hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-400 border border-white/[0.08]"
                      : "bg-gray-100 hover:bg-cyan-50 text-gray-400 hover:text-cyan-600 border border-gray-200"
                  }`}
                >
                  <ArrowUpDown className="w-4 h-4" />
                </button>
              </div>

              {/* ── Destination chain + Token ── */}
              <div>
                <label className={`${cls.label} mb-1.5 block`}>To</label>
                <div className={`rounded-xl overflow-visible ${cls.card}`}>
                  {/* Destination chain selector */}
                  <div className="relative">
                    <button
                      onClick={() => { closeAllDropdowns(); setShowDstChains(!showDstChains); }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 transition-colors ${cls.cardHover}`}
                    >
                      {dstChain ? (
                        <div className="flex items-center gap-2">
                          <ChainBadge chain={dstChain} />
                          <span className={`text-sm font-medium ${cls.heading}`}>{dstChain.name}</span>
                        </div>
                      ) : (
                        <span className={`text-sm ${cls.muted}`}>
                          {loadingDstOptions ? "Loading destinations..." : "Select destination"}
                        </span>
                      )}
                      {loadingDstOptions ? (
                        <Loader2 className={`w-3.5 h-3.5 animate-spin ${cls.muted}`} />
                      ) : (
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDstChains ? "rotate-180" : ""} ${cls.muted}`} />
                      )}
                    </button>
                    {showDstChains && (
                      <div className={`absolute left-0 right-0 top-full mt-0.5 rounded-xl z-30 max-h-56 overflow-y-auto overscroll-contain shadow-xl ${cls.dropdown}`}>
                        <SearchInput value={dstChainSearch} onChange={setDstChainSearch} placeholder="Search chains..." />
                        {dstChains.length === 0 ? (
                          <div className={`px-3 py-4 text-center text-xs ${cls.muted}`}>
                            No available destinations for {srcToken?.symbol ?? "this token"}
                          </div>
                        ) : (
                          dstChains
                            .filter((c) => c.name.toLowerCase().includes(dstChainSearch.toLowerCase()))
                            .map((c) => (
                              <button
                                key={c.chainId}
                                onClick={() => selectDstChain(c)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                                  dstChain?.chainId === c.chainId ? cls.selected : cls.hoverRow
                                }`}
                              >
                                <ChainBadge chain={c} size="sm" />
                                {c.name}
                              </button>
                            ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Destination token selector */}
                  <div className={`border-t ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}>
                    <div className="relative">
                      <button
                        onClick={() => { closeAllDropdowns(); setShowDstTokens(!showDstTokens); }}
                        className={`w-full flex items-center justify-between px-3 py-2 transition-colors ${cls.cardHover}`}
                      >
                        {dstToken ? (
                          <div className="flex items-center gap-2">
                            <TokenLogo token={dstToken} />
                            <span className={`text-sm font-medium ${cls.heading}`}>{dstToken.symbol}</span>
                            <span className={`text-[10px] ${cls.muted}`}>{dstToken.name}</span>
                          </div>
                        ) : (
                          <span className={`text-sm ${cls.muted}`}>Select token</span>
                        )}
                        <ChevronDown className={`w-3 h-3 transition-transform ${showDstTokens ? "rotate-180" : ""} ${cls.muted}`} />
                      </button>
                      {showDstTokens && (
                        <div className={`absolute left-0 right-0 top-full mt-0.5 rounded-xl z-30 max-h-48 overflow-y-auto overscroll-contain shadow-xl ${cls.dropdown}`}>
                          {dstTokenOptions.length > 5 && (
                            <SearchInput value={dstTokenSearch} onChange={setDstTokenSearch} placeholder="Search tokens..." />
                          )}
                          {dstTokenOptions.length === 0 ? (
                            <div className={`px-3 py-4 text-center text-xs ${cls.muted}`}>
                              No tokens available
                            </div>
                          ) : (
                            dstTokenOptions
                              .filter((t) => t.symbol.toLowerCase().includes(dstTokenSearch.toLowerCase()) || t.name.toLowerCase().includes(dstTokenSearch.toLowerCase()))
                              .map((t) => (
                                <button
                                  key={t.address}
                                  onClick={() => selectDstToken(t)}
                                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                                    dstToken?.address === t.address ? cls.selected : cls.hoverRow
                                  }`}
                                >
                                  <TokenLogo token={t} />
                                  <span className="font-medium">{t.symbol}</span>
                                  <span className={`text-xs ${cls.muted} truncate`}>{t.name}</span>
                                  {t.priceUsd != null && t.priceUsd > 0 && (
                                    <span className={`text-[10px] ml-auto tabular-nums ${cls.muted}`}>{formatUsd(t.priceUsd)}</span>
                                  )}
                                </button>
                              ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Receive amount display */}
                  <div className={`border-t px-3 py-3 ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}>
                    {quoteLoading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                        <span className={`text-sm ${cls.muted}`}>Fetching quote...</span>
                      </div>
                    ) : feeDisplay ? (
                      <div className={`text-lg ${cls.heading}`}>
                        {feeDisplay.youReceive}
                        <span className={`text-sm ml-1.5 ${cls.muted}`}>{dstToken?.symbol}</span>
                        {feeDisplay.youReceiveUsd && feeDisplay.youReceiveUsd !== "—" && (
                          <span className={`text-xs ml-2 ${cls.muted}`}>~{feeDisplay.youReceiveUsd}</span>
                        )}
                      </div>
                    ) : hasValidAmount && !isSameChain ? (
                      <div className={`text-sm ${cls.muted}`}>
                        {quoteError || (walletAddress ? "Enter amount for quote" : "Connect wallet for quote")}
                      </div>
                    ) : (
                      <div className={`text-lg ${isDark ? "text-slate-600" : "text-gray-300"}`}>0.00</div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Quote details panel ── */}
              {feeDisplay && hasValidAmount && !isSameChain && !showConfirmation && (
                <div className={`rounded-xl overflow-hidden ${
                  isDark ? "bg-white/[0.02] border border-white/[0.04]" : "bg-gray-50 border border-gray-100"
                }`}>
                  {/* Quote refresh header */}
                  <div className={`flex items-center justify-between px-3 py-2 ${
                    isDark ? "bg-white/[0.02]" : "bg-gray-100/60"
                  }`}>
                    <span className={`text-[10px] uppercase tracking-wider font-medium ${cls.muted}`}>
                      Quote Details
                    </span>
                    <div className="flex items-center gap-2">
                      {quoteCountdown > 0 && (
                        <span className={`text-[10px] tabular-nums ${cls.muted}`}>
                          {quoteCountdown}s
                        </span>
                      )}
                      <button
                        onClick={doFetchQuotes}
                        disabled={quoteLoading}
                        className={`p-1 rounded transition-colors ${
                          isDark ? "hover:bg-white/[0.06] text-slate-500 hover:text-cyan-400" : "hover:bg-gray-200 text-gray-400 hover:text-cyan-600"
                        }`}
                      >
                        <RefreshCw className={`w-3 h-3 ${quoteLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </div>

                  <div className="p-3 space-y-2">
                    {/* You Send */}
                    <div className="flex items-center justify-between text-xs">
                      <span className={cls.muted}>You Send</span>
                      <span className={isDark ? "text-slate-300" : "text-gray-600"}>
                        {feeDisplay.youSend !== "—" ? feeDisplay.youSend : amount} {srcToken?.symbol}
                        {feeDisplay.youSendUsd !== "—" && (
                          <span className={`ml-1.5 ${cls.muted}`}>{feeDisplay.youSendUsd}</span>
                        )}
                      </span>
                    </div>
                    {/* You Receive */}
                    <div className="flex items-center justify-between text-xs">
                      <span className={cls.muted}>You Receive</span>
                      <span className={`font-medium ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>
                        ~{feeDisplay.youReceive} {dstToken?.symbol}
                        {feeDisplay.youReceiveUsd !== "—" && (
                          <span className={`ml-1.5 font-normal ${cls.muted}`}>{feeDisplay.youReceiveUsd}</span>
                        )}
                      </span>
                    </div>
                    {/* Min Received */}
                    {feeDisplay.minReceived !== "—" && (
                      <div className="flex items-center justify-between text-xs">
                        <span className={`flex items-center gap-1 ${cls.muted}`}>
                          <Shield className="w-3 h-3" /> Min Received
                        </span>
                        <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                          {feeDisplay.minReceived} {dstToken?.symbol}
                        </span>
                      </div>
                    )}
                    {/* Divider */}
                    <div className={`border-t ${isDark ? "border-white/[0.04]" : "border-gray-200"}`} />
                    {/* Network Fee */}
                    <div className="flex items-center justify-between text-xs">
                      <span className={cls.muted}>Network Fee</span>
                      <span className={isDark ? "text-slate-300" : "text-gray-600"}>
                        {feeDisplay.totalFeeUsd}
                        <span className={`ml-1 ${cls.muted}`}>({feeDisplay.feePercent})</span>
                      </span>
                    </div>
                    {/* Route */}
                    <div className="flex items-center justify-between text-xs">
                      <span className={cls.muted}>Route</span>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        feeDisplay.routeType.includes("TAXI")
                          ? isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-cyan-50 text-cyan-700"
                          : feeDisplay.routeType.includes("BUS")
                          ? isDark ? "bg-purple-500/10 text-purple-400" : "bg-purple-50 text-purple-700"
                          : isDark ? "bg-white/[0.06] text-slate-300" : "bg-gray-200 text-gray-600"
                      }`}>
                        {feeDisplay.routeType.includes("TAXI") ? <Zap className="w-2.5 h-2.5" /> : null}
                        {feeDisplay.routeTypeLabel}
                      </span>
                    </div>
                    {/* Est. Time */}
                    <div className="flex items-center justify-between text-xs">
                      <span className={`flex items-center gap-1 ${cls.muted}`}>
                        <Clock className="w-3 h-3" /> Est. Time
                      </span>
                      <span className={isDark ? "text-slate-300" : "text-gray-600"}>
                        {feeDisplay.estimatedDuration}
                      </span>
                    </div>
                  </div>

                  {/* Route options (when multiple quotes) */}
                  {allQuotes.length > 1 && (
                    <div className={`border-t px-3 py-2 space-y-1.5 ${
                      isDark ? "border-white/[0.04]" : "border-gray-200"
                    }`}>
                      <span className={`text-[10px] uppercase tracking-wider ${cls.muted}`}>
                        Route Options ({allQuotes.length})
                      </span>
                      {allQuotes.map((q, i) => {
                        const rType = q.routeSteps[0]?.type ?? "UNKNOWN";
                        const isBest = i === 0;
                        const isFastest = allQuotes.every((oq, oi) => {
                          if (oi === i) return true;
                          const aDur = parseInt(q.duration?.estimated ?? "9999", 10);
                          const bDur = parseInt(oq.duration?.estimated ?? "9999", 10);
                          return aDur <= bDur;
                        });
                        const isSelected = i === selectedQuoteIdx;
                        return (
                          <button
                            key={q.id}
                            onClick={() => handleSelectQuote(i)}
                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors ${
                              isSelected
                                ? isDark ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-cyan-50 border border-cyan-200"
                                : isDark ? "hover:bg-white/[0.04] border border-transparent" : "hover:bg-gray-100 border border-transparent"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`font-medium ${isSelected ? (isDark ? "text-cyan-400" : "text-cyan-600") : ""}`}>
                                {routeLabel(rType)}
                              </span>
                              {isBest && (
                                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${isDark ? "bg-green-500/15 text-green-400" : "bg-green-100 text-green-700"}`}>
                                  Best
                                </span>
                              )}
                              {isFastest && !isBest && (
                                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-700"}`}>
                                  Fastest
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={cls.muted}>
                                ~{formatDisplayAmount(formatTokenAmount(q.dstAmount, dstToken?.decimals ?? 6), dstToken?.symbol ?? "", dstToken?.decimals ?? 6)} {dstToken?.symbol}
                              </span>
                              <span className={cls.muted}>
                                {shortDuration(q.duration?.estimated)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Safety warnings inline (Step 14) — shown below quote, above action ── */}
              {safetyWarnings.length > 0 && hasValidAmount && !isSameChain && !showConfirmation && feeDisplay && (
                <div className="space-y-1.5">
                  {safetyWarnings.filter((w) => w.severity !== "info").map((w) => (
                    <div key={w.id} className={`flex items-start gap-1.5 px-3 py-2 rounded-lg text-xs ${
                      w.severity === "block"
                        ? isDark ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"
                        : isDark ? "bg-amber-500/10 text-amber-400/80 border border-amber-500/15" : "bg-amber-50 text-amber-600 border border-amber-200"
                    }`}>
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Pre-bridge confirmation panel ── */}
              {showConfirmation && feeDisplay && srcChain && dstChain && srcToken && dstToken && (
                <div className={`rounded-xl overflow-hidden ${
                  isDark ? "bg-white/[0.03] border border-cyan-500/20" : "bg-cyan-50/50 border border-cyan-200"
                }`}>
                  <div className={`px-3 py-2.5 ${isDark ? "bg-cyan-500/5" : "bg-cyan-100/50"}`}>
                    <span className={`text-xs font-bold ${isDark ? "text-cyan-400" : "text-cyan-700"}`}>
                      Confirm Bridge
                    </span>
                  </div>
                  <div className="p-3 space-y-3">
                    {/* Transfer summary — with token/chain logos (Step 16) */}
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col items-center flex-1 gap-1">
                        <div className="flex items-center gap-1.5">
                          <TokenLogo token={srcToken} size="sm" />
                          <span className={`text-sm font-bold ${cls.heading}`}>{amount} {srcToken.symbol}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ChainBadge chain={srcChain} size="sm" />
                          <span className={`text-[10px] ${cls.muted}`}>{srcChain.name}</span>
                        </div>
                        {feeDisplay.youSendUsd !== "—" && (
                          <div className={`text-[10px] ${cls.muted}`}>{feeDisplay.youSendUsd}</div>
                        )}
                      </div>
                      <ArrowRight className={`w-4 h-4 mx-2 shrink-0 ${isDark ? "text-cyan-500/50" : "text-cyan-400"}`} />
                      <div className="flex flex-col items-center flex-1 gap-1">
                        <div className="flex items-center gap-1.5">
                          <TokenLogo token={dstToken} size="sm" />
                          <span className={`text-sm font-bold ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>~{feeDisplay.youReceive} {dstToken.symbol}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ChainBadge chain={dstChain} size="sm" />
                          <span className={`text-[10px] ${cls.muted}`}>{dstChain.name}</span>
                        </div>
                        {feeDisplay.youReceiveUsd !== "—" && (
                          <div className={`text-[10px] ${cls.muted}`}>{feeDisplay.youReceiveUsd}</div>
                        )}
                      </div>
                    </div>
                    {/* Details grid */}
                    <div className={`rounded-lg p-2.5 space-y-1.5 text-xs ${
                      isDark ? "bg-white/[0.02]" : "bg-white"
                    }`}>
                      <div className="flex justify-between">
                        <span className={cls.muted}>Fee</span>
                        <span className={cls.value}>{feeDisplay.totalFeeUsd} ({feeDisplay.feePercent})</span>
                      </div>
                      {feeDisplay.minReceived !== "—" && (
                        <div className="flex justify-between">
                          <span className={cls.muted}>Min Received</span>
                          <span className={cls.value}>{feeDisplay.minReceived} {dstToken.symbol}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className={cls.muted}>Route</span>
                        <span className={cls.value}>{feeDisplay.routeTypeLabel}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={cls.muted}>Est. Time</span>
                        <span className={cls.value}>{feeDisplay.estimatedDuration}</span>
                      </div>
                      {gasEstimate && gasEstimate.totalGasUsd !== "$0.00" && (
                        <div className="flex justify-between">
                          <span className={cls.muted}>Est. Gas</span>
                          <span className={cls.value}>{gasEstimate.totalGasUsd}</span>
                        </div>
                      )}
                    </div>

                    {/* Safety warnings (Step 14) */}
                    {safetyWarnings.length > 0 && (
                      <div className="space-y-1.5">
                        {safetyWarnings.map((w) => (
                          <div key={w.id} className={`flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] ${
                            w.severity === "block"
                              ? isDark ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"
                              : w.severity === "warn"
                              ? isDark ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-600 border border-amber-200"
                              : isDark ? "bg-blue-500/10 text-blue-400/70" : "bg-blue-50 text-blue-600"
                          }`}>
                            {w.severity === "block" ? (
                              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            ) : w.severity === "warn" ? (
                              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            ) : (
                              <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            )}
                            <span>{w.message}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowConfirmation(false)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                          isDark ? "bg-white/[0.06] hover:bg-white/[0.1] text-slate-300" : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                        }`}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConfirmBridge}
                        disabled={hasBlockingWarning}
                        className={`flex-[2] py-2.5 rounded-xl text-sm font-bold transition-all ${
                          hasBlockingWarning
                            ? isDark ? "bg-white/[0.06] text-slate-500 cursor-not-allowed" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                            : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20"
                        }`}
                      >
                        {hasBlockingWarning ? "Cannot Proceed" : needsChainSwitch ? `Switch & Confirm` : "Confirm Bridge"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Warnings ── */}
              {isSameChain && (
                <div className={`text-center text-xs py-2 rounded-lg ${
                  isDark ? "bg-amber-500/10 text-amber-400/70" : "bg-amber-50 text-amber-600"
                }`}>
                  Source and destination must be different chains
                </div>
              )}
              {quoteError && hasValidAmount && !isSameChain && !quoteLoading && (
                <div className={`text-center text-xs py-2 px-3 rounded-lg ${
                  quoteErrorKind?.kind === "quote-expired"
                    ? isDark ? "bg-blue-500/10 text-blue-400/70" : "bg-blue-50 text-blue-600"
                    : isDark ? "bg-amber-500/10 text-amber-400/70" : "bg-amber-50 text-amber-600"
                }`}>
                  {quoteError}{rateLimitCountdown > 0 ? ` (${rateLimitCountdown}s)` : ""}
                </div>
              )}

              {/* ── Action Button ── */}
              {!walletAddress ? (
                <>
                  {connectError && (
                    <div className={`text-center text-xs py-2 px-3 rounded-lg ${
                      isDark ? "bg-red-500/10 text-red-400/80" : "bg-red-50 text-red-600"
                    }`}>
                      {connectError}
                    </div>
                  )}
                  {/* Mobile hint when MetaMask not detected */}
                  {isMobile && !isMetaMaskInstalled() && (
                    <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-xs ${
                      isDark ? "bg-blue-500/10 border border-blue-500/15" : "bg-blue-50 border border-blue-100"
                    }`}>
                      <Smartphone className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDark ? "text-blue-400" : "text-blue-500"}`} />
                      <div className={isDark ? "text-blue-300/80" : "text-blue-700"}>
                        <p className="font-medium mb-0.5">Open in MetaMask Browser</p>
                        <p className={isDark ? "text-blue-400/60" : "text-blue-600/70"}>
                          Tap the button below to open this page inside MetaMask's built-in browser, where your wallet is available.
                        </p>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={handleConnect}
                    className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white transition-all shadow-lg shadow-cyan-500/20 active:scale-[0.98]"
                  >
                    {isMetaMaskInstalled() ? (
                      <><Wallet className="w-4 h-4" /> Connect Wallet</>
                    ) : isMobile ? (
                      <><Smartphone className="w-4 h-4" /> Open in MetaMask</>
                    ) : (
                      <><Wallet className="w-4 h-4" /> Install MetaMask</>
                    )}
                  </button>
                  {/* Desktop install hint */}
                  {!isMobile && !isMetaMaskInstalled() && (
                    <p className={`text-center text-[10px] ${cls.muted}`}>
                      MetaMask extension is required to bridge tokens.{" "}
                      <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" className="underline">
                        Download here
                      </a>
                    </p>
                  )}
                </>
              ) : !showConfirmation ? (
                <button
                  onClick={handleBridgeClick}
                  disabled={!hasValidAmount || !!isSameChain || !quoteResult || !srcToken || !dstToken || hasBlockingWarning}
                  className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-bold transition-all duration-300 active:scale-[0.98] ${
                    hasValidAmount && !isSameChain && quoteResult && srcToken && dstToken && !hasBlockingWarning
                      ? needsChainSwitch
                        ? "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-lg shadow-amber-500/20"
                        : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20"
                      : isDark
                      ? "bg-white/[0.06] text-slate-500 cursor-not-allowed"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  {hasBlockingWarning
                    ? safetyWarnings.find((w) => w.severity === "block")?.message ?? "Cannot Proceed"
                    : hasValidAmount && !isSameChain && srcToken && dstToken
                    ? quoteResult
                      ? needsChainSwitch
                        ? `Switch to ${srcChain.name} & Bridge`
                        : `Bridge ${amount} ${srcToken.symbol}`
                      : quoteLoading
                      ? "Getting quote..."
                      : "Enter amount to bridge"
                    : "Enter amount to bridge"
                  }
                </button>
              ) : null}


            </>
          )}
        </div>
      </div>

      {/* ── Recent Bridges (Step 15) ── */}
      {recentBridges.length > 0 && phase !== "success" && (
        <div className="mt-3">
          <button
            onClick={() => setShowRecentBridges((v) => !v)}
            className={`flex items-center gap-1.5 w-full text-left px-1 py-1 text-[11px] font-medium transition-colors ${
              isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Recent Bridges ({recentBridges.length})
            <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showRecentBridges ? "rotate-180" : ""}`} />
          </button>

          {showRecentBridges && (
            <div className={`mt-1 rounded-xl overflow-hidden ${
              isDark ? "bg-white/[0.02] border border-white/[0.04]" : "bg-gray-50 border border-gray-100"
            }`}>
              <div className={`divide-y ${isDark ? "divide-white/[0.04]" : "divide-gray-100"}`}>
                {recentBridges.map((r) => {
                  const urls = getTxTrackingUrls(r.txHash, r.srcChainId);
                  const ts = new Date(r.timestamp);
                  const timeStr = ts.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={r.id} className={`px-3 py-2.5 ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-100/50"} transition-colors`}>
                      <div className="flex items-center gap-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-medium truncate ${cls.heading}`}>{r.srcAmount} {r.srcTokenSymbol}</span>
                            <ArrowRight className={`w-3 h-3 shrink-0 ${isDark ? "text-cyan-500/50" : "text-cyan-400"}`} />
                            <span className={`font-medium truncate ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>~{r.dstAmount} {r.dstTokenSymbol}</span>
                          </div>
                          <div className={`text-[10px] ${cls.muted} mt-0.5`}>
                            {r.srcChainName} → {r.dstChainName} · {r.feeUsd} fee · {timeStr}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <a
                            href={urls.lzScan}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`p-1 rounded transition-colors ${isDark ? "hover:bg-purple-500/15 text-purple-400/60 hover:text-purple-400" : "hover:bg-purple-50 text-purple-400 hover:text-purple-600"}`}
                            title="View on LZ Scan"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={`px-3 py-1.5 text-center border-t ${isDark ? "border-white/[0.04]" : "border-gray-100"}`}>
                <button
                  onClick={() => { clearBridgeReceipts(); setRecentBridges([]); setShowRecentBridges(false); }}
                  className={`flex items-center gap-1 mx-auto text-[10px] transition-colors ${
                    isDark ? "text-slate-500 hover:text-red-400" : "text-gray-400 hover:text-red-500"
                  }`}
                >
                  <Trash2 className="w-2.5 h-2.5" /> Clear History
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Admin Debug Panel (Step 17) ── */}
      {isAdmin && (
        <div className="mt-3">
          <button
            onClick={() => setShowDebugPanel((v) => !v)}
            className={`flex items-center gap-1.5 w-full text-left px-1 py-1 text-[11px] font-medium transition-colors ${
              isDark ? "text-amber-400/60 hover:text-amber-400" : "text-amber-600/60 hover:text-amber-700"
            }`}
          >
            <Bug className="w-3.5 h-3.5" />
            Debug Panel
            <ChevronRight className={`w-3 h-3 ml-auto transition-transform ${showDebugPanel ? "rotate-90" : ""}`} />
          </button>

          {showDebugPanel && (
            <div className={`mt-1 rounded-xl overflow-hidden text-[11px] ${
              isDark ? "bg-amber-500/[0.03] border border-amber-500/10" : "bg-amber-50/50 border border-amber-200/50"
            }`}>
              <div className="p-3 space-y-3">

                {/* ── Connection / Wallet info ── */}
                <div>
                  <div className={`text-[9px] uppercase tracking-wider font-bold mb-1.5 ${isDark ? "text-amber-400/80" : "text-amber-700"}`}>
                    Connection
                  </div>
                  <div className={`rounded-lg p-2 space-y-1 text-[10px] font-mono ${isDark ? "bg-black/30" : "bg-white"}`}>
                    <div>MetaMask address: <span className={isDark ? "text-white" : "text-gray-900"}>{walletAddress ?? "—"}</span></div>
                    <div>MetaMask chainId: <span className={isDark ? "text-white" : "text-gray-900"}>{walletChainId || "—"}{walletChainMeta ? ` (${walletChainMeta.name})` : ""}</span></div>
                    <div>API health: <span className={apiHealth?.connected ? (isDark ? "text-green-400" : "text-green-600") : (isDark ? "text-red-400" : "text-red-600")}>
                      {apiHealth ? (apiHealth.connected ? `OK (${apiHealth.latencyMs}ms)` : `FAIL: ${apiHealth.error}`) : "not checked"}
                    </span></div>
                    <div>Widget phase: <span className={isDark ? "text-white" : "text-gray-900"}>{phase}</span></div>
                    <div>Loaded tokens: <span className={isDark ? "text-white" : "text-gray-900"}>{allTokens.length}</span></div>
                    <div>Available chains: <span className={isDark ? "text-white" : "text-gray-900"}>{availableChains.length}</span></div>
                  </div>
                </div>

                {/* ── Current selection ── */}
                <div>
                  <div className={`text-[9px] uppercase tracking-wider font-bold mb-1.5 ${isDark ? "text-amber-400/80" : "text-amber-700"}`}>
                    Selection
                  </div>
                  <div className={`rounded-lg p-2 space-y-1 text-[10px] font-mono ${isDark ? "bg-black/30" : "bg-white"}`}>
                    <div>Src: <span className={isDark ? "text-white" : "text-gray-900"}>{srcChain?.name ?? "—"} / {srcToken?.symbol ?? "—"} ({srcToken?.address?.slice(0, 10) ?? "—"}…)</span></div>
                    <div>Dst: <span className={isDark ? "text-white" : "text-gray-900"}>{dstChain?.name ?? "—"} / {dstToken?.symbol ?? "—"} ({dstToken?.address?.slice(0, 10) ?? "—"}…)</span></div>
                    <div>Amount: <span className={isDark ? "text-white" : "text-gray-900"}>{amount || "—"}</span></div>
                    <div>Balance: <span className={isDark ? "text-white" : "text-gray-900"}>{userBalance ? `${userBalance.formatted} (raw: ${userBalance.raw.toString()})` : "—"}</span></div>
                    <div>needsChainSwitch: <span className={isDark ? "text-white" : "text-gray-900"}>{String(!!needsChainSwitch)}</span></div>
                  </div>
                </div>

                {/* ── Test Quote Only ── */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestQuoteOnly}
                    disabled={testQuoteLoading || !srcChain || !dstChain || !srcToken || !dstToken || !walletAddress || !amount || parseFloat(amount) <= 0}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                      isDark
                        ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-30"
                        : "bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-30"
                    }`}
                  >
                    {testQuoteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    Test Quote Only
                  </button>
                  {debugQuoteTiming && (
                    <span className={`text-[10px] tabular-nums ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {debugQuoteTiming.durationMs}ms
                    </span>
                  )}
                </div>

                {/* ── Quote timing ── */}
                {debugQuoteTiming && (
                  <div className={`rounded-lg p-2 text-[10px] font-mono ${isDark ? "bg-black/30" : "bg-white"}`}>
                    Quote timing: {debugQuoteTiming.durationMs}ms
                  </div>
                )}

                {/* ── Raw Quote JSON ── */}
                <div>
                  <button
                    onClick={() => setShowRawQuote((v) => !v)}
                    className={`flex items-center gap-1 text-[10px] font-bold ${isDark ? "text-amber-400/80 hover:text-amber-400" : "text-amber-700 hover:text-amber-900"}`}
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform ${showRawQuote ? "rotate-90" : ""}`} />
                    Raw Quote JSON ({allQuotes.length} quote{allQuotes.length !== 1 ? "s" : ""})
                  </button>
                  {showRawQuote && (
                    <pre className={`mt-1 rounded-lg p-2 text-[9px] font-mono overflow-x-auto max-h-48 overflow-y-auto ${
                      isDark ? "bg-black/40 text-slate-400" : "bg-white text-gray-600"
                    }`}>
                      {allQuotes.length > 0 ? JSON.stringify(allQuotes[selectedQuoteIdx], null, 2) : "No quote data"}
                    </pre>
                  )}
                </div>

                {/* ── Raw Steps JSON ── */}
                <div>
                  <button
                    onClick={() => setShowRawSteps((v) => !v)}
                    className={`flex items-center gap-1 text-[10px] font-bold ${isDark ? "text-amber-400/80 hover:text-amber-400" : "text-amber-700 hover:text-amber-900"}`}
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform ${showRawSteps ? "rotate-90" : ""}`} />
                    Raw Steps JSON ({stepStates.length} step{stepStates.length !== 1 ? "s" : ""})
                  </button>
                  {showRawSteps && (
                    <pre className={`mt-1 rounded-lg p-2 text-[9px] font-mono overflow-x-auto max-h-48 overflow-y-auto ${
                      isDark ? "bg-black/40 text-slate-400" : "bg-white text-gray-600"
                    }`}>
                      {quoteResult?.steps && quoteResult.steps.length > 0
                        ? JSON.stringify(quoteResult.steps, null, 2)
                        : stepStates.length > 0
                        ? JSON.stringify(stepStates, null, 2)
                        : "No step data"}
                    </pre>
                  )}
                </div>

                {/* ── TX hashes ── */}
                {txHashes.length > 0 && (
                  <div>
                    <div className={`text-[9px] uppercase tracking-wider font-bold mb-1 ${isDark ? "text-amber-400/80" : "text-amber-700"}`}>
                      TX Hashes
                    </div>
                    <div className={`rounded-lg p-2 space-y-0.5 text-[10px] font-mono ${isDark ? "bg-black/30" : "bg-white"}`}>
                      {txHashes.map((h, i) => (
                        <div key={i} className="break-all">{h}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Re-check API button ── */}
                <button
                  onClick={() => {
                    setApiHealthChecking(true);
                    setApiHealth(null);
                    testApiConnection().then((r) => { setApiHealth(r); setApiHealthChecking(false); });
                  }}
                  disabled={apiHealthChecking}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                    isDark
                      ? "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] disabled:opacity-30"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                  }`}
                >
                  {apiHealthChecking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Re-check API
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div className={`mt-2 flex items-center justify-center gap-3 text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
        <span>Powered by Stargate V2 & LayerZero</span>
        <a href="https://stargate.finance/bridge" target="_blank" rel="noopener noreferrer"
          className={`flex items-center gap-0.5 transition-colors ${isDark ? "hover:text-slate-400" : "hover:text-gray-600"}`}>
          Stargate <ExternalLink className="w-2.5 h-2.5" />
        </a>
        <a href="https://layerzeroscan.com" target="_blank" rel="noopener noreferrer"
          className={`flex items-center gap-0.5 transition-colors ${isDark ? "hover:text-slate-400" : "hover:text-gray-600"}`}>
          LZ Scan <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
    </div>
  );
}
/**
 * SwapPanel — Native SaucerSwap swap widget + Pool Routes table.
 *
 * Left panel:  Compact native swap interface using SaucerSwap's public
 *              APIs and on-chain routing. Token selection, quotes,
 *              slippage, route visualization, and execution via HashPack.
 *
 * Right panel: SaucerSwap pool routes table with TVL, volume, fee, APR.
 *              Clicking a pool's swap button updates the left panel's
 *              token pair.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Settings2,
  ArrowRight,
  ExternalLink,
  Shield,
  Droplets,
  Wallet,
  RefreshCw,
  Infinity as InfinityIcon,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { toast } from "sonner";
import { playVipCashRegister } from "../utils/sounds";
import { loadVipPrefs, isVipEligible } from "../utils/vip";
import { motion } from "motion/react";
import { SAUCERSWAP_LARRY_LOGO } from "../assets/brand";
import { TokenIcon } from "./TokenIcon";
import {
  SAUCERSWAP_TOKENS,
  estimateSwapQuote,
  fetchServerQuote,
  findSwapRoute,
  findSwapRouteAsync,
  getPoolRoutes,
  fetchPoolRoutes,
  executeSaucerSwap,
  formatUsdCompact,
  getHashScanTxUrl,
  isHbarWhbarPair,
  wrapHbar,
  unwrapHbar,
  getNativeHbarBalance,
  getTokenBalance,
  fetchLiveTokenPrices,
  fetchAndApplyTokenIcons,
  type AllowedToken,
  type SwapQuote,
  type QuoteConfidence,
  type ScoredRouteInfo,
  type PoolRoute,
  type SwapResult,
  type SwapOptions,
} from "../utils/saucerswap";
import {
  SwapHistoryPanel,
  loadSwapHistory,
  saveSwapToHistory,
  clearSwapHistory,
  type SwapHistoryEntry,
} from "./SwapHistory";
import { OneInchWidget } from "./OneInchWidget";
import { TokenSelectorDropdown, type WalletTokenInfo } from "./TokenSelectorDropdown";
import { Tip } from "./Tip";
import { SwapSuccessOverlay } from "./SwapSuccessOverlay";

const SLIPPAGE_OPTIONS = [0.1, 0.5, 1.0, 3.0];
const GAS_RESERVE = 1; // HBAR reserved for gas — Hedera fees are sub-cent, 1 HBAR covers dozens of txns
const QUOTE_REFRESH_INTERVAL = 30; // seconds

function isUserCancelled(r: SwapResult | null): boolean {
  if (!r) return false;
  if (r.userCancelled) return true;
  const e = (r.error || "").toLowerCase();
  return e.includes("cancelled by user") || e.includes("canceled by user") || e.includes("user_reject") || e.includes("user denied") || e.includes("user rejected");
}

// ── [C56] Token Selector is now in TokenSelectorDropdown.tsx ──

export function SwapPanel() {
  const { isDark } = useTheme();
  const { primaryWallet, hashPackSession, hederaNetwork, hbarPrice: ctxHbarPrice, hederaAccount } = useWallet();
  const isWalletConnected = !!hashPackSession?.accountId;

  // ── Token state ──
  const [inputToken, setInputToken] = useState<AllowedToken>(SAUCERSWAP_TOKENS[0]);
  const [outputToken, setOutputToken] = useState<AllowedToken>(SAUCERSWAP_TOKENS.find(t => t.symbol === "USDC") || SAUCERSWAP_TOKENS[1]);
  const [inputAmount, setInputAmount] = useState("");
  const [outputAmount, setOutputAmount] = useState("");

  // ── Quote / Route ──
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [route, setRoute] = useState<{ path: AllowedToken[]; pools: PoolRoute[]; totalFee: number; onChain?: boolean } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  // [C52] Scored alternative routes from server for route comparison
  const [scoredRoutes, setScoredRoutes] = useState<ScoredRouteInfo[]>([]);
  const [showRouteComparison, setShowRouteComparison] = useState(false);

  // ── Prices ──
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [priceLoading, setPriceLoading] = useState(false);

  // ── Balances ──
  const [inputBalance, setInputBalance] = useState<number | null>(null);
  const [outputBalance, setOutputBalance] = useState<number | null>(null);

  // ── Swap execution ──
  const [swapStatus, setSwapStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [lastTxId, setLastTxId] = useState<string | null>(null);

  // ── Swap step tracking [C27-04] ──
  // Listens for "swap-step" CustomEvents from saucerswap.ts to show
  // which step (approve vs swap) the user is signing in their wallet.
  const [swapStep, setSwapStep] = useState<{ step: number; total: number; description: string } | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setSwapStep(detail);
    };
    window.addEventListener("swap-step", handler);
    return () => window.removeEventListener("swap-step", handler);
  }, []);

  // ── Success overlay state ──
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [successDetails, setSuccessDetails] = useState<{
    inputSymbol: string; outputSymbol: string;
    inputAmount: string; outputAmount: string;
    inputLogo: string; outputLogo: string;
    inputUsd: number; outputUsd: number;
    transactionId: string | null;
    txUrl: string | null;
    slippage: number; venue: string;
    isWrapUnwrap: boolean;
  } | null>(null);

  // ── [C53] Infinite approval preference (persisted in localStorage) ──
  const [infiniteApproval, setInfiniteApproval] = useState(() => {
    try { return localStorage.getItem("wrappdex_infinite_approval") === "true"; } catch { return false; }
  });
  const toggleInfiniteApproval = useCallback(() => {
    setInfiniteApproval(prev => {
      const next = !prev;
      try { localStorage.setItem("wrappdex_infinite_approval", String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  // ── UI state ──
  const [slippage, setSlippage] = useState(0.5);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showSlippage, setShowSlippage] = useState(false);
  const [showInputSelector, setShowInputSelector] = useState(false);
  const [showOutputSelector, setShowOutputSelector] = useState(false);
  const [activePoolId, setActivePoolId] = useState<string | null>(null);

  // ── Swap history ──
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);
  useEffect(() => { setSwapHistory(loadSwapHistory()); }, []);

  // ── Quote refresh countdown ──
  const [quoteCountdown, setQuoteCountdown] = useState(QUOTE_REFRESH_INTERVAL);
  useEffect(() => {
    // Reset countdown when prices refresh
    setQuoteCountdown(QUOTE_REFRESH_INTERVAL);
    const iv = setInterval(() => {
      setQuoteCountdown(prev => (prev <= 1 ? QUOTE_REFRESH_INTERVAL : prev - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [livePrices]);

  // ── Live pool data ──
  // [C22-01] Fetches live pool data from SaucerSwap via backend proxy.
  // Shows HBAR (native) instead of WHBAR in pool displays.
  const [allPools, setAllPools] = useState<PoolRoute[]>(() => getPoolRoutes());
  const [poolsLoading, setPoolsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPoolsLoading(true);
    fetchPoolRoutes()
      .then(pools => { if (!cancelled) setAllPools(pools); })
      .catch(() => { /* keep static fallback */ })
      .finally(() => { if (!cancelled) setPoolsLoading(false); });

    // Refresh every 60s
    const iv = setInterval(() => {
      fetchPoolRoutes()
        .then(pools => { if (!cancelled) setAllPools(pools); })
        .catch(() => { /* keep existing data */ });
    }, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);
  const effectiveSlippage = customSlippage ? parseFloat(customSlippage) || 0.5 : slippage;
  const isWrapUnwrap = isHbarWhbarPair(inputToken.symbol, outputToken.symbol);
  const isWrapping = isWrapUnwrap && inputToken.symbol === "HBAR";

  const inputPrice = livePrices[inputToken.symbol] || (inputToken.symbol === "HBAR" ? ctxHbarPrice : 0);
  const outputPrice = livePrices[outputToken.symbol] || (outputToken.symbol === "HBAR" ? ctxHbarPrice : 0);
  const inputUsd = inputAmount ? parseFloat(inputAmount) * inputPrice : 0;
  const outputUsd = outputAmount ? parseFloat(outputAmount) * outputPrice : 0;

  // [C53] Pre-flight balance check — shows "Insufficient balance" on button
  const insufficientBalance = useMemo(() => {
    if (!isWalletConnected || !inputAmount || !parseFloat(inputAmount)) return false;
    if (inputBalance === null) return false; // Still loading
    const amt = parseFloat(inputAmount);
    if (amt <= 0) return false;
    if (inputToken.isNative) return inputBalance < (amt + GAS_RESERVE);
    return inputBalance < amt;
  }, [isWalletConnected, inputAmount, inputBalance, inputToken.isNative]);

  const canSwap = isWalletConnected && inputAmount && parseFloat(inputAmount) > 0 &&
    (isWrapUnwrap || route) && swapStatus === "idle" && !insufficientBalance;

  // ── Fetch prices ──
  const fetchPrices = useCallback(async () => {
    setPriceLoading(true);
    try {
      const prices = await fetchLiveTokenPrices();
      setLivePrices(prices);
    } catch { /* fallback to ctx price */ }
    setPriceLoading(false);
  }, []);

  useEffect(() => {
    fetchPrices();
    // [C36-04] Fetch official token icons from SaucerSwap API on mount
    fetchAndApplyTokenIcons();
    const iv = setInterval(fetchPrices, 30000);
    return () => clearInterval(iv);
  }, [fetchPrices]);

  // Pull-to-refresh support — re-fetch swap prices on mobile swipe-down
  useEffect(() => {
    const handlePullRefresh = () => { fetchPrices(); };
    window.addEventListener("wrappdex:pull-refresh", handlePullRefresh);
    return () => window.removeEventListener("wrappdex:pull-refresh", handlePullRefresh);
  }, [fetchPrices]);

  // ── Fetch balances ──
  const fetchBalances = useCallback(async () => {
    if (!hashPackSession?.accountId) return;
    const acct = hashPackSession.accountId;
    try {
      const [ib, ob] = await Promise.all([
        inputToken.isNative
          ? getNativeHbarBalance(acct, hederaNetwork).then(t => t / 1e8)
          : getTokenBalance(acct, inputToken.htsId, hederaNetwork).then(b => b / Math.pow(10, inputToken.decimals)),
        outputToken.isNative
          ? getNativeHbarBalance(acct, hederaNetwork).then(t => t / 1e8)
          : getTokenBalance(acct, outputToken.htsId, hederaNetwork).then(b => b / Math.pow(10, outputToken.decimals)),
      ]);
      setInputBalance(ib);
      setOutputBalance(ob);
    } catch { /* silent */ }
  }, [hashPackSession?.accountId, inputToken, outputToken, hederaNetwork]);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  // ── Find route when tokens change ──
  // [C56] Try instant sync route first, then async on-chain detection fallback.
  // This ensures any token pair with a real pool on SaucerSwap (V1 or V2) will
  // show as routable, even if not in the static hardcoded pool list.
  const [routeSearching, setRouteSearching] = useState(false);
  useEffect(() => {
    if (isWrapUnwrap) { setRoute(null); setRouteSearching(false); return; }
    const syncRoute = findSwapRoute(inputToken.symbol, outputToken.symbol);
    if (syncRoute) { setRoute(syncRoute); setRouteSearching(false); return; }
    // No sync route — try async on-chain detection
    setRoute(null);
    setRouteSearching(true);
    let cancelled = false;
    findSwapRouteAsync(inputToken.symbol, outputToken.symbol, hederaNetwork)
      .then(asyncRoute => {
        if (!cancelled) {
          setRoute(asyncRoute);
          setRouteSearching(false);
          if (asyncRoute?.onChain) {
            console.log(`[C56] On-chain route found: ${asyncRoute.path.map(t => t.symbol).join(" → ")}`);
          }
        }
      })
      .catch(() => { if (!cancelled) { setRoute(null); setRouteSearching(false); } });
    return () => { cancelled = true; };
  }, [inputToken.symbol, outputToken.symbol, isWrapUnwrap, hederaNetwork]);

  // ── Calculate quote ──
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverQuoteAbortRef = useRef<AbortController | null>(null);

  // [C51] Phase 1: Instant client-side estimate (confidence: "low")
  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    // Cancel any in-flight server quote
    if (serverQuoteAbortRef.current) {
      serverQuoteAbortRef.current.abort();
      serverQuoteAbortRef.current = null;
    }
    const amt = parseFloat(inputAmount);
    if (!amt || amt <= 0) { setQuote(null); setScoredRoutes([]); setOutputAmount(""); return; }

    if (isWrapUnwrap) {
      setOutputAmount(inputAmount);
      setQuote({
        inputToken: inputToken.symbol, outputToken: outputToken.symbol,
        inputAmount: amt, outputAmount: amt, priceImpact: 0,
        route: [inputToken.symbol, outputToken.symbol],
        fee: 0, minimumOutput: amt, executionPrice: 1,
        confidence: "high",
      });
      return;
    }

    setQuoteLoading(true);
    quoteTimerRef.current = setTimeout(() => {
      const q = estimateSwapQuote(inputToken.symbol, outputToken.symbol, amt, inputPrice, outputPrice, effectiveSlippage);
      setQuote(q);
      setOutputAmount(q.outputAmount >= 1 ? q.outputAmount.toFixed(4) : q.outputAmount.toFixed(8));
      setQuoteLoading(false);
    }, 300);

    return () => { if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current); };
  }, [inputAmount, inputToken.symbol, outputToken.symbol, inputPrice, outputPrice, effectiveSlippage, isWrapUnwrap]);

  // [C51] Phase 2: Async server-side quote upgrade (confidence: "high"/"medium")
  // Fires after the client estimate is displayed, upgrades the quote in-place.
  // Debounced by 600ms to avoid hammering the server on rapid typing.
  useEffect(() => {
    if (isWrapUnwrap) return;
    const amt = parseFloat(inputAmount);
    if (!amt || amt <= 0) return;
    if (inputPrice <= 0 && outputPrice <= 0) return; // No prices yet

    const abortCtrl = new AbortController();
    serverQuoteAbortRef.current = abortCtrl;

    const timer = setTimeout(async () => {
      if (abortCtrl.signal.aborted) return;
      try {
        const result = await fetchServerQuote(
          inputToken, outputToken, amt, effectiveSlippage, hederaNetwork,
        );
        if (abortCtrl.signal.aborted) return;
        if (result && result.quote && result.quote.outputAmount > 0) {
          setQuote(result.quote);
          setOutputAmount(
            result.quote.outputAmount >= 1
              ? result.quote.outputAmount.toFixed(4)
              : result.quote.outputAmount.toFixed(8)
          );
          // [C52] Update scored routes for comparison UI
          if (result.scoredRoutes && result.scoredRoutes.length > 1) {
            setScoredRoutes(result.scoredRoutes);
          } else {
            setScoredRoutes([]);
          }
          console.log(
            `[C51] Quote upgraded: ${result.quote.confidence} (${result.quote.quoteSource}, ${result.quote.serverDurationMs}ms)` +
            (result.scoredRoutes.length > 1 ? ` [C52] ${result.scoredRoutes.length} routes scored` : "")
          );
        }
      } catch (err: any) {
        if (!abortCtrl.signal.aborted) {
          console.warn("[C51] Server quote upgrade failed:", err?.message || err);
        }
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      abortCtrl.abort();
    };
  }, [inputAmount, inputToken, outputToken, effectiveSlippage, hederaNetwork, isWrapUnwrap, inputPrice, outputPrice]);

  // [C51] Auto-widen slippage for low confidence quotes
  const autoSlippageWarning = useMemo(() => {
    if (!quote || isWrapUnwrap) return null;
    if (quote.confidence === "low" && effectiveSlippage < 5) {
      return {
        recommended: 5,
        message: "Quote is a price estimate — consider widening slippage to 5% for safer execution.",
      };
    }
    return null;
  }, [quote, isWrapUnwrap, effectiveSlippage]);

  // ── Token flip ──
  const [flipCount, setFlipCount] = useState(0);
  const flipTokens = useCallback(() => {
    setFlipCount(c => c + 1);
    setInputToken(outputToken);
    setOutputToken(inputToken);
    setInputAmount(outputAmount);
    setOutputAmount(inputAmount);
    setInputBalance(outputBalance);
    setOutputBalance(inputBalance);
    setQuote(null);
    setScoredRoutes([]);
    setShowRouteComparison(false);
  }, [inputToken, outputToken, inputAmount, outputAmount, inputBalance, outputBalance]);

  // ── Token selection handler ──
  const handleSelectToken = useCallback((token: AllowedToken, isInput: boolean) => {
    if (isInput) {
      if (token.symbol === outputToken.symbol) setOutputToken(inputToken);
      setInputToken(token);
    } else {
      if (token.symbol === inputToken.symbol) setInputToken(outputToken);
      setOutputToken(token);
    }
    setShowInputSelector(false);
    setShowOutputSelector(false);
  }, [inputToken, outputToken]);

  // ── Execute swap ──
  const handleSwap = useCallback(async () => {
    if (!canSwap || !hashPackSession?.accountId) return;
    setSwapStatus("processing");
    setSwapStep(null); // [C27-04] Reset step tracker
    setSwapError(null);
    setLastTxId(null);

    try {
      let result: SwapResult;
      const acct = hashPackSession.accountId;

      if (isWrapUnwrap) {
        try {
          // [C27-03] wrapHbar/unwrapHbar return {success, transactionId, error, userCancelled}
          // — NOT a plain txId string. Must destructure and check success.
          const wrapResult = isWrapping
            ? await wrapHbar(inputAmount, acct, hederaNetwork)
            : await unwrapHbar(inputAmount, acct, hederaNetwork);
          if (wrapResult.success) {
            result = { success: true, transactionId: wrapResult.transactionId, outputAmount: parseFloat(inputAmount), executionVenue: "saucerswap-v1", route: [inputToken.symbol, outputToken.symbol] };
          } else {
            result = { success: false, error: wrapResult.error || "Wrap/unwrap failed", executionVenue: "saucerswap-v1", userCancelled: wrapResult.userCancelled };
          }
        } catch (err: any) {
          const msg = err?.message || "Wrap/unwrap failed";
          result = { success: false, error: msg, executionVenue: "saucerswap-v1", userCancelled: msg.toLowerCase().includes("cancelled") || msg.toLowerCase().includes("user_reject") };
        }
      } else {
        // [C53] Pass infinite approval preference — skips approve popup if allowance sufficient
        const swapOpts: SwapOptions = { infiniteApproval };
        result = await executeSaucerSwap(inputToken.symbol, outputToken.symbol, inputAmount, effectiveSlippage, acct, hederaNetwork, swapOpts);
      }

      setSwapStep(null); // [C27-04] Clear step tracker after execution completes

      if (result.success) {
        setSwapStatus("success");
        // C25: Coerce transactionId to string — SDK may return TransactionId object
        setLastTxId(result.transactionId ? String(result.transactionId) : null);
        toast.success(`Swapped ${inputAmount} ${inputToken.symbol} → ${outputToken.symbol}`);

        // VIP sound
        const prefs = loadVipPrefs();
        if (prefs.active && prefs.features.vip_sounds && isVipEligible(hederaAccount?.tokens || [], hederaNetwork)) {
          playVipCashRegister();
        }

        // Save to history
        const entry: SwapHistoryEntry = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          timestamp: Date.now(),
          inputSymbol: inputToken.symbol, outputSymbol: outputToken.symbol,
          inputAmount, outputAmount: result.outputAmount?.toString() || outputAmount,
          route: result.route || [inputToken.symbol, outputToken.symbol],
          priceImpact: quote?.priceImpact || 0, slippage: effectiveSlippage,
          // C25: Coerce transactionId to string — SDK may return TransactionId object
          transactionId: result.transactionId ? String(result.transactionId) : null,
          executionVenue: result.executionVenue, success: true,
          isSimulated: false, network: hederaNetwork,
          inputUsd: inputUsd || undefined, outputUsd: outputUsd || undefined,
        };
        saveSwapToHistory(entry);
        setSwapHistory(loadSwapHistory());
        fetchBalances();

        // Show success overlay
        setSuccessDetails({
          inputSymbol: inputToken.symbol, outputSymbol: outputToken.symbol,
          inputAmount, outputAmount: result.outputAmount?.toString() || outputAmount,
          inputLogo: inputToken.logo, outputLogo: outputToken.logo,
          inputUsd, outputUsd,
          transactionId: result.transactionId ? String(result.transactionId) : null,
          txUrl: result.transactionId ? getHashScanTxUrl(String(result.transactionId), hederaNetwork) : null,
          slippage: effectiveSlippage,
          venue: result.executionVenue,
          isWrapUnwrap,
        });
        setShowSuccessOverlay(true);
      } else if (isUserCancelled(result)) {
        setSwapStatus("idle");
        toast.info("Transaction cancelled");
      } else {
        setSwapStatus("error");
        setSwapError(result.error || "Swap failed");
        toast.error(result.error || "Swap failed");

        // Save failed swap to history
        const entry: SwapHistoryEntry = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          timestamp: Date.now(),
          inputSymbol: inputToken.symbol, outputSymbol: outputToken.symbol,
          inputAmount, outputAmount: "0",
          route: result.route || [inputToken.symbol, outputToken.symbol],
          priceImpact: 0, slippage: effectiveSlippage,
          // C25: Coerce transactionId to string — SDK may return TransactionId object
          transactionId: result.transactionId ? String(result.transactionId) : null,
          executionVenue: result.executionVenue, success: false,
          isSimulated: false, network: hederaNetwork,
          errorMessage: result.error,
        };
        saveSwapToHistory(entry);
        setSwapHistory(loadSwapHistory());
      }
    } catch (err: any) {
      setSwapStatus("error");
      setSwapError(err?.message || "Unknown error");
      toast.error(err?.message || "Swap failed");
    }
  }, [canSwap, hashPackSession?.accountId, isWrapUnwrap, isWrapping, inputToken, outputToken, inputAmount, outputAmount, effectiveSlippage, hederaNetwork, quote, inputUsd, outputUsd, hederaAccount, fetchBalances, infiniteApproval]);

  // ── [C28-04] Auto-close success/error states after 5 seconds ──
  // Prevents stale status from blocking the UI. The user can still
  // click "New Swap" or "Try Again" to dismiss immediately.
  useEffect(() => {
    if (swapStatus === "success") {
      const timer = setTimeout(() => {
        setSwapStatus("idle");
        setInputAmount("");
        setOutputAmount("");
        setQuote(null);
        setScoredRoutes([]);
        setShowSuccessOverlay(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [swapStatus]);

  useEffect(() => {
    if (swapStatus === "error") {
      const timer = setTimeout(() => {
        setSwapStatus("idle");
        setSwapError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [swapStatus]);

  // ── Pool table handler ──
  const handlePoolSwap = useCallback((pool: PoolRoute) => {
    setInputToken(pool.tokenA);
    setOutputToken(pool.tokenB);
    setInputAmount("");
    setOutputAmount("");
    setQuote(null);
    setScoredRoutes([]);
    setActivePoolId(pool.id);
    setSwapStatus("idle");
    setSwapError(null);
  }, []);

  // ── Style tokens ──
  const cardClass = isDark
    ? "bg-slate-900/60 border border-pink-500/10 backdrop-blur-xl"
    : "bg-white border border-gray-200 shadow-sm";
  const inputClass = isDark
    ? "bg-slate-800/60 border border-slate-700/30"
    : "bg-gray-50 border border-gray-200";

  // ── [C56] Wallet tokens for "Yours" tab ──
  const walletTokens: WalletTokenInfo[] = useMemo(() => {
    if (!hederaAccount?.tokens) return [];
    return hederaAccount.tokens.map(t => ({
      tokenId: t.tokenId,
      balance: t.rawBalance,
      decimals: t.decimals,
      symbol: t.symbol,
      name: t.name,
    }));
  }, [hederaAccount?.tokens]);

  // ── Shared props for TokenSelectorDropdown ──
  const tokenSelectorShared = useMemo(() => ({
    isDark, inputClass, livePrices, walletTokens, isWalletConnected,
  }), [isDark, inputClass, livePrices, walletTokens, isWalletConnected]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ═══ SWAP INTERFACE ═══ */}
        <div className="lg:col-span-5">
          <div className={`rounded-2xl p-5 relative ${cardClass}`} role="form" aria-label="Token swap">
            {/* Input Token */}
            <div className={`rounded-xl p-4 mb-2 ${inputClass}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`} id="swap-input-label">You Pay</span>
                  {isWalletConnected && (
                    <button onClick={fetchBalances} aria-label="Refresh balances" className={`p-0.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${isDark ? "hover:bg-slate-700 text-slate-600" : "hover:bg-gray-200 text-gray-400"}`}>
                      <RefreshCw className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
                {inputUsd > 0 && (
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    ~${inputUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <input type="number" placeholder="0.0"
                  aria-labelledby="swap-input-label"
                  aria-describedby="swap-input-usd"
                  className="bg-transparent flex-1 outline-none text-2xl min-w-0"
                  value={inputAmount} onChange={e => { setInputAmount(e.target.value); setSwapStatus("idle"); setSwapError(null); }} />
                <div className="relative shrink-0">
                  <button onClick={() => { setShowInputSelector(!showInputSelector); setShowOutputSelector(false); }}
                    aria-label={`Select input token, currently ${inputToken.symbol}`}
                    aria-haspopup="listbox"
                    aria-expanded={showInputSelector}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"}`}>
                    <TokenIcon src={inputToken.logo} symbol={inputToken.symbol} size="w-6 h-6" />
                    <span className="font-bold text-sm">{inputToken.symbol}</span>
                    <ChevronDown className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
                  </button>
                  {showInputSelector && (
                    <TokenSelectorDropdown isOpen={showInputSelector} onClose={() => setShowInputSelector(false)}
                      onSelect={t => handleSelectToken(t, true)} excludeSymbol={outputToken.symbol} {...tokenSelectorShared} />
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                  {inputToken.isNative ? "Native" : `HTS: ${inputToken.htsId}`}
                </div>
                {isWalletConnected && inputBalance !== null && (
                  <Tip content="Use max balance" side="top">
                  <button onClick={() => {
                    const max = inputToken.isNative ? Math.max(0, inputBalance - GAS_RESERVE) : inputBalance;
                    if (max > 0) setInputAmount(max.toString());
                  }}
                    className={`text-xs flex items-center gap-1 transition-colors ${isDark ? "text-slate-500 hover:text-pink-400" : "text-gray-400 hover:text-pink-600"}`}>
                    <Wallet className="w-2.5 h-2.5" />
                    {inputBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} {inputToken.symbol}
                  </button>
                  </Tip>
                )}
              </div>
            </div>

            {/* Flip Button */}
            <div className="flex justify-center -my-3 relative z-10">
              <motion.button onClick={flipTokens}
                aria-label="Swap input and output tokens"
                animate={{ rotate: flipCount * 180 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                whileTap={{ scale: 0.85 }}
                className={`p-2.5 rounded-xl border-4 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                  isDark ? "bg-slate-800 border-slate-900/80 hover:bg-slate-700 text-pink-400"
                    : "bg-white border-gray-100 hover:bg-gray-50 text-pink-600 shadow-sm"
                }`}>
                <ArrowDownUp className="w-5 h-5" />
              </motion.button>
            </div>

            {/* Output Token */}
            <div className={`rounded-xl p-4 mt-2 ${inputClass}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`} id="swap-output-label">You Receive</span>
                {outputUsd > 0 && (
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    ~${outputUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <input type="number" placeholder="0.0" readOnly
                  aria-labelledby="swap-output-label"
                  aria-live="polite"
                  className={`bg-transparent flex-1 outline-none text-2xl min-w-0 ${quoteLoading ? "animate-pulse" : ""}`}
                  value={outputAmount} />
                <div className="relative shrink-0">
                  <button onClick={() => { setShowOutputSelector(!showOutputSelector); setShowInputSelector(false); }}
                    aria-label={`Select output token, currently ${outputToken.symbol}`}
                    aria-haspopup="listbox"
                    aria-expanded={showOutputSelector}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"}`}>
                    <TokenIcon src={outputToken.logo} symbol={outputToken.symbol} size="w-6 h-6" />
                    <span className="font-bold text-sm">{outputToken.symbol}</span>
                    <ChevronDown className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
                  </button>
                  {showOutputSelector && (
                    <TokenSelectorDropdown isOpen={showOutputSelector} onClose={() => setShowOutputSelector(false)}
                      onSelect={t => handleSelectToken(t, false)} excludeSymbol={inputToken.symbol} {...tokenSelectorShared} />
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                  {outputToken.isNative ? "Native" : `HTS: ${outputToken.htsId}`}
                </div>
                {isWalletConnected && outputBalance !== null && (
                  <span className={`text-xs flex items-center gap-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    <Wallet className="w-2.5 h-2.5" />
                    {outputBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} {outputToken.symbol}
                  </span>
                )}
              </div>
            </div>

            {/* Route Visualization */}
            {route && !isWrapUnwrap && inputAmount && parseFloat(inputAmount) > 0 && (
              <div className={`mt-4 p-3 rounded-xl ${isDark ? "bg-slate-800/30 border border-pink-500/10" : "bg-gray-50 border border-gray-100"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Droplets className={`w-3.5 h-3.5 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
                    <span className={`text-xs font-bold ${isDark ? "text-slate-300" : "text-gray-700"}`}>Swap Route</span>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-pink-500/10 text-pink-400" : "bg-pink-50 text-pink-600"}`}>
                    {route.pools.length === 1 ? "Direct" : `${route.pools.length}-hop`}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {route.path.map((token, idx) => (
                    <div key={token.symbol + idx} className="flex items-center gap-1">
                      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${isDark ? "bg-slate-700/60" : "bg-gray-200"}`}>
                        <TokenIcon src={token.logo} symbol={token.symbol} size="w-4 h-4" />
                        <span className="text-xs font-bold">{token.symbol}</span>
                      </div>
                      {idx < route.path.length - 1 && (
                        <div className="flex items-center">
                          <ArrowRight className={`w-3 h-3 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
                          <span className={`text-xs px-1 rounded ${isDark ? "bg-slate-700/40 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
                            {route.pools[idx]?.fee}%
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quote Summary */}
            {quote && inputAmount && parseFloat(inputAmount) > 0 && (
              <div className={`mt-3 p-3 rounded-xl text-sm space-y-1.5 ${inputClass}`}>
                <div className="flex justify-between">
                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>Rate</span>
                  <span>1 {inputToken.symbol} = {quote.executionPrice >= 1 ? quote.executionPrice.toFixed(4) : quote.executionPrice.toFixed(8)} {outputToken.symbol}</span>
                </div>
                {!isWrapUnwrap && (
                  <>
                    <div className="flex justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Price Impact</span>
                      <span className={quote.priceImpact > 5 ? "text-red-400" : quote.priceImpact > 1 ? "text-amber-400" : "text-emerald-400"}>
                        {quote.priceImpact.toFixed(3)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Min. Received</span>
                      <span>{quote.minimumOutput >= 1 ? quote.minimumOutput.toFixed(4) : quote.minimumOutput.toFixed(8)} {outputToken.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Slippage</span>
                      <span>{effectiveSlippage}%</span>
                    </div>
                    {/* [C51] Quote Confidence Badge */}
                    <div className="flex justify-between items-center">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Quote</span>
                      <Tip content={
                        quote.confidence === "high"
                          ? `On-chain quote via ${quote.quoteSource || "router"}${quote.serverDurationMs ? ` (${quote.serverDurationMs}ms)` : ""}`
                          : quote.confidence === "medium"
                          ? `API quote via ${quote.quoteSource || "SaucerSwap"}${quote.serverDurationMs ? ` (${quote.serverDurationMs}ms)` : ""}`
                          : "Price-based estimate — actual output may differ"
                      } side="top">
                        <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          quote.confidence === "high"
                            ? isDark ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : quote.confidence === "medium"
                            ? isDark ? "bg-blue-500/15 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-700 border border-blue-200"
                            : isDark ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}>
                          <Shield className="w-2.5 h-2.5" />
                          {quote.confidence === "high" ? "On-chain" : quote.confidence === "medium" ? "API" : "Estimate"}
                        </span>
                      </Tip>
                    </div>
                    {/* [C51] Low Confidence Slippage Warning */}
                    {autoSlippageWarning && (
                      <div className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
                        isDark ? "bg-amber-500/10 border border-amber-500/20 text-amber-300" : "bg-amber-50 border border-amber-200 text-amber-700"
                      }`}>
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                        <div className="flex-1">
                          <span>{autoSlippageWarning.message}</span>
                          <button
                            onClick={() => { setSlippage(autoSlippageWarning.recommended); setCustomSlippage(""); }}
                            className={`ml-1.5 font-bold underline underline-offset-2 transition-colors ${
                              isDark ? "text-amber-300 hover:text-amber-200" : "text-amber-800 hover:text-amber-900"
                            }`}
                          >
                            Set to {autoSlippageWarning.recommended}%
                          </button>
                        </div>
                      </div>
                    )}
                    {/* [C52] Compare Routes — expandable multi-route comparison */}
                    {scoredRoutes.length > 1 && (
                      <div className={`mt-1 pt-1.5 border-t ${isDark ? "border-slate-700/20" : "border-gray-100"}`}>
                        <button
                          onClick={() => setShowRouteComparison(prev => !prev)}
                          className={`flex items-center gap-1.5 text-xs w-full transition-colors ${
                            isDark ? "text-purple-400 hover:text-purple-300" : "text-purple-600 hover:text-purple-700"
                          }`}
                        >
                          <Droplets className="w-3 h-3" />
                          <span>Compare {scoredRoutes.length} routes</span>
                          <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showRouteComparison ? "rotate-180" : ""}`} />
                        </button>
                        {showRouteComparison && (
                          <div className="mt-2 space-y-1.5">
                            {scoredRoutes.slice(0, 3).map((sr, idx) => {
                              const isBest = idx === 0;
                              const outputLabel = sr.humanOutput >= 1
                                ? sr.humanOutput.toFixed(4)
                                : sr.humanOutput.toFixed(8);
                              return (
                                <div
                                  key={`${sr.source}-${idx}`}
                                  className={`p-2 rounded-lg text-xs ${
                                    isBest
                                      ? isDark ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"
                                      : isDark ? "bg-slate-800/50 border border-slate-700/30" : "bg-gray-50 border border-gray-100"
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                      {isBest && (
                                        <span className={`text-[10px] px-1 py-0.5 rounded font-bold ${
                                          isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                                        }`}>BEST</span>
                                      )}
                                      <span className={isDark ? "text-slate-300 font-medium" : "text-gray-700 font-medium"}>
                                        {sr.label}
                                      </span>
                                    </div>
                                    <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[10px] font-medium ${
                                      sr.confidence === "high"
                                        ? isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-700"
                                        : sr.confidence === "medium"
                                        ? isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-50 text-blue-700"
                                        : isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-700"
                                    }`}>
                                      <Shield className="w-2 h-2" />
                                      {sr.confidence === "high" ? "On-chain" : sr.confidence === "medium" ? "API" : "Est."}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                                      {outputLabel} {outputToken.symbol}
                                    </span>
                                    <span className={`${
                                      sr.priceImpact > 2 ? "text-red-400" : sr.priceImpact > 0.5 ? "text-amber-400" : isDark ? "text-slate-500" : "text-gray-400"
                                    }`}>
                                      {sr.priceImpact > 0 ? `${sr.priceImpact.toFixed(2)}% impact` : `${sr.hops} hop${sr.hops !== 1 ? "s" : ""}`}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                {/* Quote Refresh Countdown */}
                <div className={`pt-1.5 mt-1.5 border-t ${isDark ? "border-slate-700/30" : "border-gray-200"}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs flex items-center gap-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      <RefreshCw className={`w-2.5 h-2.5 ${quoteCountdown <= 5 ? "animate-spin" : ""}`} />
                      Quote refreshes in {quoteCountdown}s
                    </span>
                    <Tip content="Refresh quote now" side="top">
                    <button
                      onClick={fetchPrices}
                      className={`text-xs px-1.5 py-0.5 rounded transition-colors ${isDark ? "text-pink-400 hover:bg-pink-500/10" : "text-pink-600 hover:bg-pink-50"}`}
                    >
                      Refresh
                    </button>
                    </Tip>
                  </div>
                  <div className={`mt-1 h-[2px] rounded-full overflow-hidden ${isDark ? "bg-slate-700/30" : "bg-gray-200"}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                        quoteCountdown <= 5
                          ? "bg-gradient-to-r from-amber-500 to-red-500"
                          : "bg-gradient-to-r from-pink-500 to-purple-500"
                      }`}
                      style={{ width: `${(quoteCountdown / QUOTE_REFRESH_INTERVAL) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Slippage Settings */}
            <div className="mt-3">
              <button onClick={() => setShowSlippage(!showSlippage)}
                className={`flex items-center gap-2 text-sm w-full ${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"}`}>
                <Settings2 className="w-4 h-4" />
                <span>Slippage: {effectiveSlippage}%</span>
                <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${showSlippage ? "rotate-180" : ""}`} />
              </button>
              {showSlippage && (
                <div className={`mt-2 p-3 rounded-xl space-y-3 ${inputClass}`}>
                  <div className="flex items-center gap-2">
                    {SLIPPAGE_OPTIONS.map(opt => (
                      <button key={opt} onClick={() => { setSlippage(opt); setCustomSlippage(""); }}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                          slippage === opt && !customSlippage
                            ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                            : isDark ? "bg-slate-700/50 text-slate-300 hover:bg-slate-600" : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                        }`}>
                        {opt}%
                      </button>
                    ))}
                    <input type="number" placeholder="Custom"
                      className={`w-20 px-2 py-1.5 rounded-lg text-sm outline-none ${inputClass}`}
                      value={customSlippage} onChange={e => setCustomSlippage(e.target.value)} />
                  </div>
                  {/* [C53] Infinite Approval Toggle */}
                  <div className={`flex items-center justify-between pt-2 border-t ${isDark ? "border-slate-700/30" : "border-gray-200"}`}>
                    <Tip content={infiniteApproval
                      ? "Approves unlimited spending for this token+router pair. Fewer popups but less granular control."
                      : "Approves only the exact swap amount each time. More secure but requires approval for every swap."
                    } side="top">
                      <div className="flex items-center gap-1.5 cursor-help">
                        <InfinityIcon className={`w-3.5 h-3.5 ${infiniteApproval ? isDark ? "text-purple-400" : "text-purple-600" : isDark ? "text-slate-500" : "text-gray-400"}`} />
                        <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                          Infinite approval
                        </span>
                      </div>
                    </Tip>
                    <button
                      onClick={toggleInfiniteApproval}
                      aria-pressed={infiniteApproval}
                      aria-label="Toggle infinite approval"
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                        infiniteApproval
                          ? "bg-gradient-to-r from-purple-600 to-pink-600"
                          : isDark ? "bg-slate-700" : "bg-gray-300"
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform duration-200 ${
                        infiniteApproval ? "translate-x-[18px]" : "translate-x-[3px]"
                      }`} />
                    </button>
                  </div>
                  <p className={`text-[10px] leading-tight ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                    {infiniteApproval
                      ? "Token approvals are set to unlimited — fewer wallet popups per swap."
                      : "Token approvals are set to exact amounts — more secure, may require approval each swap."}
                  </p>
                </div>
              )}
            </div>

            {/* ── Swap Button ── */}
            <div className="mt-4">
              {swapStatus === "processing" ? (
                <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-amber-600 to-yellow-500 text-white cursor-wait">
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {/* [C27-04] Show which step the user is signing */}
                      {swapStep
                        ? `Step ${swapStep.step}/${swapStep.total}: Sign in wallet...`
                        : "Awaiting wallet signature..."}
                    </div>
                    {swapStep && (
                      <span className="text-xs text-amber-200/80 font-normal">
                        {swapStep.description}
                      </span>
                    )}
                  </div>
                </button>
              ) : swapStatus === "success" ? (
                <div>
                  <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-green-500 text-white relative overflow-hidden">
                    {/* [C28-04] Auto-close progress bar */}
                    <div className="absolute bottom-0 left-0 h-[3px] bg-white/30 animate-[shrink_5s_linear_forwards]" style={{ width: "100%" }} />
                    <div className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {isWrapUnwrap ? `${isWrapping ? "Wrap" : "Unwrap"} Complete!` : "Swap Complete!"}
                    </div>
                  </button>
                  {lastTxId && (
                    <a href={getHashScanTxUrl(lastTxId, hederaNetwork)} target="_blank" rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-1.5 mt-2 text-xs transition-colors ${isDark ? "text-pink-400 hover:text-pink-300" : "text-pink-600 hover:text-pink-500"}`}>
                      <ExternalLink className="w-3 h-3" />
                      View on HashScan
                    </a>
                  )}
                  <button onClick={() => { setSwapStatus("idle"); setInputAmount(""); setOutputAmount(""); setQuote(null); setScoredRoutes([]); setShowSuccessOverlay(false); }}
                    className={`w-full mt-2 py-2 rounded-lg text-xs transition-colors ${isDark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
                    New Swap
                  </button>
                </div>
              ) : swapStatus === "error" ? (
                <div>
                  <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-red-600 to-orange-500 text-white relative overflow-hidden">
                    {/* [C28-04] Auto-close progress bar */}
                    <div className="absolute bottom-0 left-0 h-[3px] bg-white/30 animate-[shrink_5s_linear_forwards]" style={{ width: "100%" }} />
                    <div className="flex items-center justify-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Swap Failed
                    </div>
                  </button>
                  {swapError && (
                    <div className="flex items-start gap-1.5 mt-2 text-xs text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="break-all">{swapError}</span>
                    </div>
                  )}
                  <button onClick={() => { setSwapStatus("idle"); setSwapError(null); }}
                    className={`w-full mt-2 py-2 rounded-lg text-xs transition-colors ${isDark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
                    Try Again
                  </button>
                </div>
              ) : !isWalletConnected ? (
                <button disabled
                  className={`w-full py-3.5 rounded-xl font-bold ${isDark ? "bg-slate-700 text-slate-500" : "bg-gray-300 text-gray-500"} cursor-not-allowed`}>
                  <div className="flex items-center justify-center gap-2">
                    <Wallet className="w-4 h-4" />
                    Connect HashPack to Swap
                  </div>
                </button>
              ) : !route && !isWrapUnwrap ? (
                <button disabled
                  className={`w-full py-3.5 rounded-xl font-bold ${isDark ? "bg-slate-700 text-slate-500" : "bg-gray-300 text-gray-500"} cursor-not-allowed`}>
                  <div className="flex items-center justify-center gap-2">
                    {routeSearching ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Checking Route...</>
                    ) : (
                      <><AlertCircle className="w-4 h-4" /> No Route Available</>
                    )}
                  </div>
                </button>
              ) : insufficientBalance ? (
                <button disabled
                  className={`w-full py-3.5 rounded-xl font-bold ${isDark ? "bg-red-900/40 text-red-400 border border-red-500/20" : "bg-red-50 text-red-500 border border-red-200"} cursor-not-allowed`}>
                  <div className="flex items-center justify-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Insufficient {inputToken.symbol} Balance
                  </div>
                </button>
              ) : (
                <button onClick={handleSwap} disabled={!canSwap}
                  className={`w-full py-3.5 rounded-xl font-bold transition-all duration-300 shadow-lg text-white ${
                    !canSwap
                      ? isDark ? "bg-slate-700 text-slate-500 shadow-none cursor-not-allowed" : "bg-gray-300 text-gray-500 shadow-none cursor-not-allowed"
                      : isWrapUnwrap
                        ? "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-purple-500/30"
                        : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-pink-500/30"
                  }`}>
                  {isWrapUnwrap
                    ? `${isWrapping ? "Wrap" : "Unwrap"} ${inputToken.symbol} → ${outputToken.symbol}`
                    : `Swap ${inputToken.symbol} → ${outputToken.symbol}`
                  }
                </button>
              )}
            </div>

            {/* Mode/Venue Info */}
            <div className={`flex items-center justify-center gap-2 mt-3 text-xs flex-wrap ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {isWalletConnected ? (
                <>
                  <a
                    href="https://www.saucerswap.finance"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all ${isDark ? "bg-emerald-900/20 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-900/30 hover:border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"}`}
                  >
                    <img
                      src={SAUCERSWAP_LARRY_LOGO}
                      alt="SaucerSwap Larry"
                      className="w-4 h-4 rounded-full object-cover"
                      loading="eager"
                      decoding="async"
                      width={16}
                      height={16}
                    />
                    {isWrapUnwrap ? (isWrapping ? "Wrap HBAR" : "Unwrap WHBAR") : "SaucerSwap V1"}
                  </a>
                  <span>Live execution via HashPack</span>
                </>
              ) : (
                <>
                  <Shield className="w-3 h-3" />
                  <span>Connect HashPack wallet to swap</span>
                </>
              )}
            </div>

            {/* Success Celebration Overlay */}
            {successDetails && (
              <SwapSuccessOverlay
                show={showSuccessOverlay}
                inputSymbol={successDetails.inputSymbol}
                outputSymbol={successDetails.outputSymbol}
                inputAmount={successDetails.inputAmount}
                outputAmount={successDetails.outputAmount}
                inputLogo={successDetails.inputLogo}
                outputLogo={successDetails.outputLogo}
                inputUsd={successDetails.inputUsd}
                outputUsd={successDetails.outputUsd}
                transactionId={successDetails.transactionId}
                txUrl={successDetails.txUrl}
                slippage={successDetails.slippage}
                venue={successDetails.venue}
                isWrapUnwrap={successDetails.isWrapUnwrap}
                onClose={() => setShowSuccessOverlay(false)}
              />
            )}
          </div>

          {/* ═══ 1INCH AGGREGATOR (under SaucerSwap box) ═══ */}
          <OneInchWidget />
        </div>

        {/* ═══ POOL ROUTES TABLE ═══ */}
        <div className="lg:col-span-7">
          <div className={`rounded-2xl overflow-hidden ${cardClass}`}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Droplets className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
                <h3 className="font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                  SaucerSwap Pool Routes
                </h3>
                {poolsLoading ? (
                  <RefreshCw className="w-3 h-3 text-pink-400 animate-spin" />
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
                    Live
                  </span>
                )}
              </div>
              <a href="https://www.saucerswap.finance/swap" target="_blank" rel="noopener noreferrer"
                className={`flex items-center gap-1 text-xs transition-colors ${isDark ? "text-pink-400 hover:text-pink-300" : "text-pink-600 hover:text-pink-500"}`}>
                <ExternalLink className="w-3 h-3" />
                SaucerSwap
              </a>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-xs uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    <th className="text-left px-5 py-2">Pool</th>
                    <th className="text-right px-3 py-2">TVL</th>
                    <th className="text-right px-3 py-2">24h Vol</th>
                    <th className="text-right px-3 py-2">Fee</th>
                    <th className="text-right px-3 py-2">APR</th>
                    <th className="text-center px-3 py-2">Swap</th>
                  </tr>
                </thead>
                <tbody>
                  {allPools.map(pool => {
                    const isActive =
                      pool.id === activePoolId ||
                      (pool.tokenA.symbol === inputToken.symbol && pool.tokenB.symbol === outputToken.symbol) ||
                      (pool.tokenB.symbol === inputToken.symbol && pool.tokenA.symbol === outputToken.symbol) ||
                      (route && route.pools.some(p => p.id === pool.id));
                    return (
                      <tr key={pool.id}
                        className={`transition-colors ${
                          isActive
                            ? isDark ? "bg-pink-500/5" : "bg-pink-50"
                            : isDark ? "hover:bg-slate-800/30" : "hover:bg-gray-50"
                        } ${isDark ? "border-t border-slate-800/30" : "border-t border-gray-100"}`}>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-1.5">
                              <TokenIcon src={pool.tokenA.logo} symbol={pool.tokenA.symbol} size="w-5 h-5" className="ring-2 ring-slate-900/80 relative z-10" />
                              <TokenIcon src={pool.tokenB.logo} symbol={pool.tokenB.symbol} size="w-5 h-5" className="ring-2 ring-slate-900/80" />
                            </div>
                            <div>
                              <div className="font-bold text-xs">{pool.tokenA.symbol}/{pool.tokenB.symbol}</div>
                              {pool.tokenA.isWrapped || pool.tokenB.isWrapped ? (
                                <span className={`text-xs ${isDark ? "text-purple-400" : "text-purple-600"}`}>
                                  {pool.tokenA.bridge || pool.tokenB.bridge || "Wrapped"}
                                </span>
                              ) : null}
                            </div>
                            {isActive && (
                              <span className={`text-xs px-1 py-0.5 rounded ${isDark ? "bg-pink-500/15 text-pink-400" : "bg-pink-100 text-pink-600"}`}>
                                Active
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`text-right px-3 py-2.5 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                          {formatUsdCompact(pool.tvlUsd)}
                        </td>
                        <td className={`text-right px-3 py-2.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {formatUsdCompact(pool.volume24hUsd)}
                        </td>
                        <td className={`text-right px-3 py-2.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {pool.fee}%
                        </td>
                        <td className="text-right px-3 py-2.5 text-emerald-400">
                          {pool.apr}%
                        </td>
                        <td className="text-center px-3 py-2.5">
                          <Tip content={`Swap ${pool.tokenA.symbol}/${pool.tokenB.symbol}`}>
                          <button onClick={() => handlePoolSwap(pool)}
                            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-pink-500/15 text-pink-400" : "hover:bg-pink-50 text-pink-600"}`}>
                            <ArrowDownUp className="w-3.5 h-3.5" />
                          </button>
                          </Tip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pool legend */}
            <div className={`px-5 py-3 border-t flex items-center gap-4 text-xs flex-wrap ${isDark ? "border-slate-800/30 text-slate-500" : "border-gray-100 text-gray-400"}`}>
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${isDark ? "bg-pink-500/30" : "bg-pink-100"}`} />
                Active in current route
              </span>
              <span>{allPools.length} pools</span>
              <span>Live data from SaucerSwap API</span>
            </div>
          </div>

          {/* ── Swap History ── */}
          <div className="mt-4">
            <SwapHistoryPanel
              history={swapHistory}
              onClear={() => {
                clearSwapHistory();
                setSwapHistory([]);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
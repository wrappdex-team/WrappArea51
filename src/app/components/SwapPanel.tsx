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
  Droplets,
  ExternalLink,
  RefreshCw,
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
  checkSwapPrerequisites,
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
  type ScoredRouteInfo,
  type PoolRoute,
  type SwapResult,
  type SwapOptions,
  type SwapPrerequisites,
} from "../utils/saucerswap";
import { prewarmRelay, startRelayKeepalive } from "../utils/hashpack";
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
import { SwapCardPro } from "./SwapCardPro";
import { TokenInputPro } from "./TokenInputPro";
import { SwapRouteViz } from "./SwapRouteViz";
import { QuoteDetailsPro } from "./QuoteDetailsPro";
import { SwapButtonPro } from "./SwapButtonPro";
import { SlippageSettingsPro } from "./SlippageSettingsPro";

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

  // ── [C100-S11] Pre-flight swap prerequisites ──
  // Runs in parallel with quote fetching to probe allowance + association
  // status BEFORE the user clicks "Swap". Tells the UI exactly how many
  // wallet popups to expect: 1 (swap only) or 2 (approve + swap).
  const [swapPrereqs, setSwapPrereqs] = useState<SwapPrerequisites | null>(null);
  useEffect(() => {
    if (!isWalletConnected || !hashPackSession?.accountId || isWrapUnwrap) {
      setSwapPrereqs(null);
      return;
    }
    const amt = parseFloat(inputAmount);
    if (!amt || amt <= 0) { setSwapPrereqs(null); return; }

    let cancelled = false;
    const maxAutoAssoc = hederaAccount?.maxAutoAssociations;

    // Debounce: 400ms after user stops typing
    const timer = setTimeout(() => {
      checkSwapPrerequisites(
        inputToken.symbol, outputToken.symbol, inputAmount,
        hashPackSession.accountId, hederaNetwork, maxAutoAssoc,
      ).then(prereqs => {
        if (!cancelled) setSwapPrereqs(prereqs);
      }).catch(() => {
        if (!cancelled) setSwapPrereqs(null);
      });
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [inputToken.symbol, outputToken.symbol, inputAmount, hashPackSession?.accountId, hederaNetwork, isWalletConnected, isWrapUnwrap, hederaAccount?.maxAutoAssociations]);

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
  // [C78-01] Default to TRUE — matches SaucerSwap behavior. After the first
  // approval per token+router pair, all subsequent swaps are single-signing.
  // Users can still toggle OFF in Slippage Settings for granular control.
  const [infiniteApproval, setInfiniteApproval] = useState(() => {
    try {
      const stored = localStorage.getItem("wrappdex_infinite_approval");
      // Default to true if never set (null); respect explicit "false"
      return stored === null ? true : stored === "true";
    } catch { return true; }
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

  // [C93] Block swap when quote output is 0 — prevents CONTRACT_REVERT_EXECUTED
  // from attempting swaps where the on-chain quote failed and minOutput would be 1.
  const hasValidOutput = isWrapUnwrap || (outputAmount && parseFloat(outputAmount) > 0);
  const canSwap = isWalletConnected && inputAmount && parseFloat(inputAmount) > 0 &&
    (isWrapUnwrap || route) && swapStatus === "idle" && !insufficientBalance && hasValidOutput;

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

  // [C81-01] Start relay keepalive when wallet is connected.
  // Keeps WC WebSocket alive so wallet auto-pops on signing requests.
  useEffect(() => {
    if (isWalletConnected) {
      startRelayKeepalive();
      // Also do an immediate prewarm in case relay dropped
      prewarmRelay();
    }
  }, [isWalletConnected]);

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

    // [C81-01] Pre-warm WC relay IMMEDIATELY — don't block on it.
    // The pre-flight checks (balance, pool detection, quote) take 5-15s;
    // by the time the wallet signing request fires, the relay will be warm.
    prewarmRelay();

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
        // [C100-S11] Pass maxAutoAssociations — skips association popups if account has auto-association
        const swapOpts: SwapOptions = {
          infiniteApproval,
          maxAutoAssociations: hederaAccount?.maxAutoAssociations,
        };
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
  }, [canSwap, hashPackSession?.accountId, isWrapUnwrap, isWrapping, inputToken, outputToken, inputAmount, outputAmount, effectiveSlippage, hederaNetwork, quote, inputUsd, outputUsd, hederaAccount, fetchBalances, infiniteApproval, hederaAccount?.maxAutoAssociations]);

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

  // ── Handlers for pro components ──
  const handleSetSlippageFromWarning = useCallback((val: number) => {
    setSlippage(val);
    setCustomSlippage("");
  }, []);

  const handleResetSwap = useCallback(() => {
    setSwapStatus("idle");
    setInputAmount("");
    setOutputAmount("");
    setQuote(null);
    setScoredRoutes([]);
    setShowSuccessOverlay(false);
    setSwapError(null);
  }, []);

  const handleMaxInput = useCallback(() => {
    if (inputBalance === null || inputBalance <= 0) return;
    const max = inputToken.isNative ? Math.max(0, inputBalance - GAS_RESERVE) : inputBalance;
    if (max > 0) setInputAmount(max.toString());
  }, [inputBalance, inputToken.isNative]);

  const inputTokenContainerRef = useRef<HTMLDivElement>(null);
  const outputTokenContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* ═══ SWAP INTERFACE ═══ */}
        <div className="lg:col-span-5">
          <SwapCardPro isDark={isDark} title="Swap">
            {/* Input Token */}
            <div className="relative" ref={inputTokenContainerRef}>
              <TokenInputPro
                label="You Pay"
                token={inputToken}
                amount={inputAmount}
                usdValue={inputUsd}
                balance={inputBalance}
                isWalletConnected={isWalletConnected}
                isDark={isDark}
                onAmountChange={(v) => { setInputAmount(v); setSwapStatus("idle"); setSwapError(null); }}
                onTokenClick={() => { setShowInputSelector(!showInputSelector); setShowOutputSelector(false); }}
                onMaxClick={handleMaxInput}
                onRefreshBalance={fetchBalances}
              />
              {showInputSelector && (
                <TokenSelectorDropdown isOpen={showInputSelector} onClose={() => setShowInputSelector(false)}
                  onSelect={t => handleSelectToken(t, true)} excludeSymbol={outputToken.symbol}
                  anchorRef={inputTokenContainerRef} {...tokenSelectorShared} />
              )}
            </div>

            {/* Flip Button */}
            <div className="flex justify-center -my-3 relative z-10">
              <motion.button onClick={flipTokens}
                aria-label="Swap input and output tokens"
                animate={{ rotate: flipCount * 180 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.85 }}
                className={`p-2.5 rounded-2xl border-4 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                  isDark
                    ? "bg-[#0c0f1a] border-[#0c0f1a] hover:bg-slate-800 text-pink-400 shadow-lg shadow-pink-500/5"
                    : "bg-white border-white hover:bg-gray-50 text-pink-600 shadow-md"
                }`}>
                <ArrowDownUp className="w-5 h-5" />
              </motion.button>
            </div>

            {/* Output Token */}
            <div className="relative" ref={outputTokenContainerRef}>
              <TokenInputPro
                label="You Receive"
                token={outputToken}
                amount={outputAmount}
                usdValue={outputUsd}
                balance={outputBalance}
                isWalletConnected={isWalletConnected}
                readOnly
                loading={quoteLoading}
                isDark={isDark}
                onTokenClick={() => { setShowOutputSelector(!showOutputSelector); setShowInputSelector(false); }}
              />
              {showOutputSelector && (
                <TokenSelectorDropdown isOpen={showOutputSelector} onClose={() => setShowOutputSelector(false)}
                  onSelect={t => handleSelectToken(t, false)} excludeSymbol={inputToken.symbol}
                  anchorRef={outputTokenContainerRef} {...tokenSelectorShared} />
              )}
            </div>

            {/* Route Visualization */}
            {route && !isWrapUnwrap && inputAmount && parseFloat(inputAmount) > 0 && (
              <SwapRouteViz route={route} isDark={isDark} />
            )}

            {/* Quote Details */}
            {quote && inputAmount && parseFloat(inputAmount) > 0 && (
              <QuoteDetailsPro
                quote={quote}
                inputToken={inputToken}
                outputToken={outputToken}
                effectiveSlippage={effectiveSlippage}
                isWrapUnwrap={isWrapUnwrap}
                isDark={isDark}
                quoteCountdown={quoteCountdown}
                maxCountdown={QUOTE_REFRESH_INTERVAL}
                onRefresh={fetchPrices}
                autoSlippageWarning={autoSlippageWarning}
                onSetSlippage={handleSetSlippageFromWarning}
                scoredRoutes={scoredRoutes}
                showRouteComparison={showRouteComparison}
                onToggleRouteComparison={() => setShowRouteComparison(prev => !prev)}
              />
            )}

            {/* Slippage Settings */}
            <SlippageSettingsPro
              slippage={slippage}
              customSlippage={customSlippage}
              effectiveSlippage={effectiveSlippage}
              showSlippage={showSlippage}
              onToggle={() => setShowSlippage(!showSlippage)}
              onSetSlippage={setSlippage}
              onSetCustomSlippage={setCustomSlippage}
              infiniteApproval={infiniteApproval}
              onToggleInfiniteApproval={toggleInfiniteApproval}
              isDark={isDark}
            />

            {/* Swap Button */}
            <SwapButtonPro
              status={swapStatus}
              canSwap={!!canSwap}
              isWalletConnected={isWalletConnected}
              isWrapUnwrap={isWrapUnwrap}
              isWrapping={isWrapping}
              inputToken={inputToken}
              outputToken={outputToken}
              hasRoute={!!route}
              routeSearching={routeSearching}
              insufficientBalance={insufficientBalance}
              hasValidOutput={!!hasValidOutput}
              swapStep={swapStep}
              swapError={swapError}
              lastTxId={lastTxId}
              txUrl={lastTxId ? getHashScanTxUrl(lastTxId, hederaNetwork) : null}
              onSwap={handleSwap}
              onReset={handleResetSwap}
              onHover={prewarmRelay}
              isDark={isDark}
              approvalNeeded={swapPrereqs?.approvalNeeded ?? null}
            />

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
          </SwapCardPro>

          {/* ═══ 1INCH AGGREGATOR ═══ */}
          <div className="mt-4">
            <OneInchWidget />
          </div>
        </div>

        {/* ═══ POOL ROUTES TABLE ═══ */}
        <div className="lg:col-span-7">
          <div className={`rounded-2xl overflow-hidden ${
            isDark
              ? "bg-[#0c0f1a]/95 backdrop-blur-xl border border-white/[0.04]"
              : "bg-white/95 backdrop-blur-xl border border-gray-200 shadow-xl"
          }`}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <Droplets className={`w-5 h-5 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
                <h3 className={`font-extrabold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
                  Pool Routes
                </h3>
                {poolsLoading ? (
                  <RefreshCw className="w-3 h-3 text-pink-400 animate-spin" />
                ) : (
                  <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              <a href="https://www.saucerswap.finance/swap" target="_blank" rel="noopener noreferrer"
                className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  isDark ? "text-pink-400 hover:text-pink-300" : "text-pink-600 hover:text-pink-500"
                }`}>
                <img src={SAUCERSWAP_LARRY_LOGO} alt="" className="w-4 h-4 rounded-full" width={16} height={16} />
                SaucerSwap
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-[11px] uppercase tracking-wider font-semibold ${
                    isDark ? "text-slate-500" : "text-gray-400"
                  }`}>
                    <th className="text-left px-5 py-2.5">Pool</th>
                    <th className="text-right px-3 py-2.5">TVL</th>
                    <th className="text-right px-3 py-2.5 hidden sm:table-cell">24h Vol</th>
                    <th className="text-right px-3 py-2.5">Fee</th>
                    <th className="text-right px-3 py-2.5">APR</th>
                    <th className="text-center px-3 py-2.5">Swap</th>
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
                            ? isDark ? "bg-pink-500/[0.04]" : "bg-pink-50/50"
                            : isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50/50"
                        } ${isDark ? "border-t border-white/[0.03]" : "border-t border-gray-100"}`}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex -space-x-2">
                              <TokenIcon src={pool.tokenA.logo} symbol={pool.tokenA.symbol} htsId={pool.tokenA.htsId} size="w-6 h-6" className={`ring-2 relative z-10 ${isDark ? "ring-[#0c0f1a]" : "ring-white"}`} />
                              <TokenIcon src={pool.tokenB.logo} symbol={pool.tokenB.symbol} htsId={pool.tokenB.htsId} size="w-6 h-6" className={`ring-2 ${isDark ? "ring-[#0c0f1a]" : "ring-white"}`} />
                            </div>
                            <div>
                              <div className={`font-bold text-xs ${isDark ? "text-white" : "text-slate-800"}`}>
                                {pool.tokenA.symbol}/{pool.tokenB.symbol}
                              </div>
                              {(pool.tokenA.isWrapped || pool.tokenB.isWrapped) && (
                                <span className={`text-[10px] ${isDark ? "text-purple-400/70" : "text-purple-500"}`}>
                                  {pool.tokenA.bridge || pool.tokenB.bridge || "Wrapped"}
                                </span>
                              )}
                            </div>
                            {isActive && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                                isDark ? "bg-pink-500/10 text-pink-400 border border-pink-500/20" : "bg-pink-50 text-pink-600 border border-pink-200"
                              }`}>
                                Active
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`text-right px-3 py-3 font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                          {formatUsdCompact(pool.tvlUsd)}
                        </td>
                        <td className={`text-right px-3 py-3 hidden sm:table-cell ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {formatUsdCompact(pool.volume24hUsd)}
                        </td>
                        <td className={`text-right px-3 py-3 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {pool.fee}%
                        </td>
                        <td className="text-right px-3 py-3">
                          <span className={`font-semibold ${
                            pool.apr > 50
                              ? "text-emerald-400"
                              : pool.apr > 10
                              ? isDark ? "text-emerald-400/80" : "text-emerald-600"
                              : isDark ? "text-slate-400" : "text-gray-500"
                          }`}>
                            {pool.apr}%
                          </span>
                        </td>
                        <td className="text-center px-3 py-3">
                          <Tip content={`Swap ${pool.tokenA.symbol}/${pool.tokenB.symbol}`}>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => handlePoolSwap(pool)}
                              className={`p-2 rounded-xl transition-colors ${
                                isDark ? "hover:bg-pink-500/10 text-pink-400" : "hover:bg-pink-50 text-pink-600"
                              }`}
                            >
                              <ArrowDownUp className="w-3.5 h-3.5" />
                            </motion.button>
                          </Tip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pool legend */}
            <div className={`px-5 py-3 border-t flex items-center gap-4 text-[11px] flex-wrap ${
              isDark ? "border-white/[0.03] text-slate-600" : "border-gray-100 text-gray-400"
            }`}>
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${isDark ? "bg-pink-500/30" : "bg-pink-200"}`} />
                Active in current route
              </span>
              <span className="font-medium">{allPools.length} pools</span>
              <span>Powered by SaucerSwap</span>
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
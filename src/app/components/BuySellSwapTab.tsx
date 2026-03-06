/**
 * BuySellSwapTab — Premium swap interface for Buy/Sell page.
 *
 * Mirrors SwapPanel's full architecture (SwapCardPro, TokenInputPro,
 * SwapButtonPro, QuoteDetailsPro, SwapRouteViz, SettingsDrawer,
 * SwapSuccessOverlay) but restricted to HBAR and stablecoins only:
 * HBAR, USDC, USDT, and USDCh.
 *
 * IMPLEMENTATION NOTE — This component is intentionally a focused
 * subset of SwapPanel so the same 20-step hardening plan can be
 * applied independently. Server-side quotes, validated routes,
 * pre-flight checks, and the full execution pipeline are wired
 * identically to SwapPanel.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ArrowDownUp, RefreshCw } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { toast } from "sonner";
import { playVipCashRegister } from "../utils/sounds";
import { loadVipPrefs, isVipEligible } from "../utils/vip";
import { motion, AnimatePresence } from "motion/react";
import { TokenIcon } from "./TokenIcon";
import {
  SAUCERSWAP_TOKENS,
  estimateSwapQuote,
  fetchServerQuote,
  findSwapRoute,
  findSwapRouteAsync,
  executeSaucerSwap,
  checkSwapPrerequisites,
  getHashScanTxUrl,
  isHbarWhbarPair,
  wrapHbar,
  unwrapHbar,
  getNativeHbarBalance,
  getTokenBalance,
  fetchLiveTokenPrices,
  fetchAndApplyTokenIcons,
  getTokenPriceUsd,
  type AllowedToken,
  type SwapQuote,
  type ScoredRouteInfo,
  type PoolRoute,
  type SwapResult,
  type SwapOptions,
  type SwapPrerequisites,
  type ValidatedRoute,
  type ServerQuoteResult,
  resolveAccountEvmAddress,
} from "../utils/saucerswap";
import { classifySwapError } from "../utils/saucerswap/diagnostics";
import { prewarmRelay, startRelayKeepalive, tryOpenWalletExtension } from "../utils/hashpack";
import {
  SwapHistoryPanel,
  loadSwapHistory,
  saveSwapToHistory,
  clearSwapHistory,
  type SwapHistoryEntry,
} from "./SwapHistory";
import { TokenSelectorDropdown, type WalletTokenInfo } from "./TokenSelectorDropdown";
import { Tip } from "./Tip";
import { SwapSuccessOverlay } from "./SwapSuccessOverlay";
import { SwapCardPro } from "./SwapCardPro";
import { TokenInputPro } from "./TokenInputPro";
import { SwapRouteViz } from "./SwapRouteViz";
import { QuoteDetailsPro } from "./QuoteDetailsPro";
import { SwapButtonPro } from "./SwapButtonPro";
import { SettingsDrawer } from "./SettingsDrawer";
import { recordTrade } from "../utils/orderbook";

// ── Allowed tokens for Buy/Sell — HBAR + stablecoins only ───────────
// IMPLEMENTATION NOTE — Only HBAR, USDC, USDT, and USDCh are permitted
// in the Buy/Sell on/off-ramp tab. All other tokens (WBTC, LINK, WETH,
// DAI, etc.) are blocked to keep this page focused on fiat-adjacent
// stablecoin swaps and ChangeNOW on-ramp/off-ramp flows.
const BUYSELL_SYMBOLS = new Set(["HBAR", "USDC", "USDT", "USDCh"]);
const BUYSELL_TOKENS = SAUCERSWAP_TOKENS.filter(t => BUYSELL_SYMBOLS.has(t.symbol));

const HBAR_GAS_RESERVE = 3;
const QUOTE_REFRESH_INTERVAL = 30; // seconds

function isUserCancelled(r: SwapResult | null): boolean {
  if (!r) return false;
  if (r.userCancelled) return true;
  const e = (r.error || "").toLowerCase();
  return e.includes("cancelled by user") || e.includes("canceled by user") || e.includes("user_reject") || e.includes("user denied") || e.includes("user rejected");
}

export function BuySellSwapTab() {
  const { isDark } = useTheme();
  const { primaryWallet, hashPackSession, hederaNetwork, hbarPrice: ctxHbarPrice, hederaAccount } = useWallet();
  const isWalletConnected = !!hashPackSession?.accountId;

  // ── Token state ──
  const defaultInput = BUYSELL_TOKENS.find(t => t.symbol === "HBAR") || BUYSELL_TOKENS[0];
  const defaultOutput = BUYSELL_TOKENS.find(t => t.symbol === "USDC") || BUYSELL_TOKENS[1];
  const [inputToken, setInputToken] = useState<AllowedToken>(defaultInput);
  const [outputToken, setOutputToken] = useState<AllowedToken>(defaultOutput);
  const [inputAmount, setInputAmount] = useState("");
  const [outputAmount, setOutputAmount] = useState("");

  // ── Quote / Route ──
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [route, setRoute] = useState<{ path: AllowedToken[]; pools: PoolRoute[]; totalFee: number; onChain?: boolean } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [scoredRoutes, setScoredRoutes] = useState<ScoredRouteInfo[]>([]);
  const [showRouteComparison, setShowRouteComparison] = useState(false);

  // ── Prices ──
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  // ── Balances ──
  const [inputBalance, setInputBalance] = useState<number | null>(null);
  const [outputBalance, setOutputBalance] = useState<number | null>(null);

  // ── Swap execution ──
  const [swapStatus, setSwapStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [lastTxId, setLastTxId] = useState<string | null>(null);

  // ── Swap step tracking ──
  const [swapStep, setSwapStep] = useState<{ step: number; total: number; description: string } | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setSwapStep(detail);
    };
    window.addEventListener("swap-step", handler);
    return () => window.removeEventListener("swap-step", handler);
  }, []);

  // ── Route degradation ──
  const [routeDegradation, setRouteDegradation] = useState<{
    v2Amount: number; v1Amount: number; outputSymbol: string; outputDecimals: number;
  } | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setRouteDegradation(detail);
    };
    window.addEventListener("swap-quote-degraded", handler);
    return () => window.removeEventListener("swap-quote-degraded", handler);
  }, []);
  useEffect(() => { setRouteDegradation(null); }, [inputToken.symbol, outputToken.symbol, inputAmount]);

  const isWrapUnwrap = isHbarWhbarPair(inputToken.symbol, outputToken.symbol);
  const isWrapping = isWrapUnwrap && inputToken.symbol === "HBAR";

  // ── Pre-flight swap prerequisites ──
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

  // ── Success overlay ──
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

  // ── UI state ──
  const [slippage, setSlippage] = useState(3);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showInputSelector, setShowInputSelector] = useState(false);
  const [showOutputSelector, setShowOutputSelector] = useState(false);

  // ── Swap history ──
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);
  useEffect(() => { setSwapHistory(loadSwapHistory()); }, []);

  // ── Fetch prices ──
  const fetchPrices = useCallback(async () => {
    try {
      const prices = await fetchLiveTokenPrices();
      setLivePrices(prices);
    } catch { /* fallback to ctx price */ }
  }, []);

  useEffect(() => {
    fetchPrices();
    fetchAndApplyTokenIcons();
  }, [fetchPrices]);

  // ── Relay keepalive ──
  useEffect(() => {
    if (isWalletConnected) { startRelayKeepalive(); prewarmRelay(); }
  }, [isWalletConnected]);

  // ── Pre-resolve EVM address ──
  useEffect(() => {
    if (!hashPackSession?.accountId || !hederaNetwork) return;
    resolveAccountEvmAddress(hashPackSession.accountId, hederaNetwork).catch(() => {});
  }, [hashPackSession?.accountId, hederaNetwork]);

  // ── Quote countdown ──
  const [quoteCountdown, setQuoteCountdown] = useState(QUOTE_REFRESH_INTERVAL);
  const [quoteStale, setQuoteStale] = useState(false);
  const quoteRefreshInFlightRef = useRef(false);

  useEffect(() => {
    setQuoteCountdown(QUOTE_REFRESH_INTERVAL);
    setQuoteStale(false);
  }, [livePrices]);

  useEffect(() => {
    const iv = setInterval(() => {
      setQuoteCountdown(prev => {
        if (prev <= 1) {
          setQuoteStale(true);
          if (!quoteRefreshInFlightRef.current) {
            quoteRefreshInFlightRef.current = true;
            fetchPrices().finally(() => { quoteRefreshInFlightRef.current = false; });
          }
          return QUOTE_REFRESH_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [fetchPrices]);

  const effectiveSlippage = customSlippage ? parseFloat(customSlippage) || 3 : slippage;
  const inputPrice = livePrices[inputToken.symbol] || getTokenPriceUsd(inputToken.symbol) || (inputToken.symbol === "HBAR" ? ctxHbarPrice : 0);
  const outputPrice = livePrices[outputToken.symbol] || getTokenPriceUsd(outputToken.symbol) || (outputToken.symbol === "HBAR" ? ctxHbarPrice : 0);
  const inputUsd = inputAmount ? parseFloat(inputAmount) * inputPrice : 0;
  const outputUsd = outputAmount ? parseFloat(outputAmount) * outputPrice : 0;

  // ── Insufficient balance ──
  const BALANCE_TOLERANCE = 0.001;
  const insufficientBalance = useMemo(() => {
    if (!isWalletConnected || !inputAmount || !parseFloat(inputAmount)) return false;
    if (inputBalance === null) return false;
    const amt = parseFloat(inputAmount);
    if (amt <= 0) return false;
    if (inputToken.isNative) return inputBalance + BALANCE_TOLERANCE < (amt + HBAR_GAS_RESERVE);
    return inputBalance + BALANCE_TOLERANCE < amt;
  }, [isWalletConnected, inputAmount, inputBalance, inputToken.isNative]);

  const gasReserveShortfall = useMemo(() => {
    if (!inputToken.isNative || insufficientBalance) return false;
    if (inputBalance === null || !inputAmount) return false;
    const amt = parseFloat(inputAmount);
    if (amt <= 0) return false;
    return inputBalance + BALANCE_TOLERANCE >= amt && inputBalance + BALANCE_TOLERANCE < amt + HBAR_GAS_RESERVE;
  }, [insufficientBalance, inputToken.isNative, inputBalance, inputAmount]);

  const hasValidOutput = isWrapUnwrap || (outputAmount && parseFloat(outputAmount) > 0);
  const canSwap = isWalletConnected && inputAmount && parseFloat(inputAmount) > 0 &&
    (isWrapUnwrap || route) && swapStatus === "idle" && !insufficientBalance && hasValidOutput;

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

  // ── Route finding ──
  const [routeSearching, setRouteSearching] = useState(false);
  useEffect(() => {
    if (isWrapUnwrap) { setRoute(null); setRouteSearching(false); return; }
    const syncRoute = findSwapRoute(inputToken.symbol, outputToken.symbol);
    if (syncRoute) { setRoute(syncRoute); setRouteSearching(false); return; }
    setRoute(null);
    setRouteSearching(true);
    let cancelled = false;
    findSwapRouteAsync(inputToken.symbol, outputToken.symbol, hederaNetwork)
      .then(asyncRoute => {
        if (!cancelled) {
          setRoute(asyncRoute);
          setRouteSearching(false);
        }
      })
      .catch(() => { if (!cancelled) { setRoute(null); setRouteSearching(false); } });
    return () => { cancelled = true; };
  }, [inputToken.symbol, outputToken.symbol, isWrapUnwrap, hederaNetwork]);

  // ── Quote engine — Phase 1: instant client-side estimate ──
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverQuoteAbortRef = useRef<AbortController | null>(null);
  const serverQuoteActiveRef = useRef(false);
  const quoteKeyRef = useRef("");
  const validatedRouteRef = useRef<ValidatedRoute | null>(null);
  const approvalStatusRef = useRef<ServerQuoteResult["approvalStatus"]>(null);

  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    if (serverQuoteAbortRef.current) {
      serverQuoteAbortRef.current.abort();
      serverQuoteAbortRef.current = null;
    }
    validatedRouteRef.current = null;
    approvalStatusRef.current = null;
    const amt = parseFloat(inputAmount);
    if (!amt || amt <= 0) { setQuote(null); setScoredRoutes([]); setOutputAmount(""); return; }

    if (isWrapUnwrap) {
      setOutputAmount(inputAmount);
      setQuote({
        inputToken: inputToken.symbol, outputToken: outputToken.symbol,
        inputAmount: amt, outputAmount: amt, priceImpact: 0,
        route: [inputToken.symbol, outputToken.symbol],
        fee: 0, minimumOutput: amt, executionPrice: 1, confidence: "high",
      });
      return;
    }

    const newKey = `${inputToken.symbol}:${outputToken.symbol}:${amt}`;
    if (quoteKeyRef.current !== newKey) {
      serverQuoteActiveRef.current = false;
      quoteKeyRef.current = newKey;
    }

    if (serverQuoteActiveRef.current) { setQuoteLoading(false); return; }

    setQuoteLoading(true);
    quoteTimerRef.current = setTimeout(() => {
      if (serverQuoteActiveRef.current) { setQuoteLoading(false); return; }
      const q = estimateSwapQuote(inputToken.symbol, outputToken.symbol, amt, inputPrice, outputPrice, effectiveSlippage);
      setQuote(q);
      setOutputAmount(q.outputAmount >= 1 ? q.outputAmount.toFixed(4) : q.outputAmount.toFixed(8));
      setQuoteLoading(false);
    }, 300);

    return () => { if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current); };
  }, [inputAmount, inputToken.symbol, outputToken.symbol, inputPrice, outputPrice, effectiveSlippage, isWrapUnwrap]);

  // ── Phase 2: server-side quote upgrade ──
  useEffect(() => {
    if (isWrapUnwrap) return;
    const amt = parseFloat(inputAmount);
    if (!amt || amt <= 0) return;

    const abortCtrl = new AbortController();
    serverQuoteAbortRef.current = abortCtrl;
    serverQuoteActiveRef.current = false;

    const timer = setTimeout(async () => {
      if (abortCtrl.signal.aborted) return;
      try {
        const result = await fetchServerQuote(
          inputToken, outputToken, amt, effectiveSlippage, hederaNetwork,
          hashPackSession?.accountId,
        );
        if (abortCtrl.signal.aborted) return;
        if (result && result.quote && result.quote.outputAmount > 0) {
          setQuote(result.quote);
          setOutputAmount(
            result.quote.outputAmount >= 1
              ? result.quote.outputAmount.toFixed(4)
              : result.quote.outputAmount.toFixed(8)
          );
          if (result.scoredRoutes && result.scoredRoutes.length > 1) {
            setScoredRoutes(result.scoredRoutes);
          } else {
            setScoredRoutes([]);
          }
          if (result.validatedRoute) {
            validatedRouteRef.current = result.validatedRoute;
          }
          if (result.approvalStatus) {
            approvalStatusRef.current = result.approvalStatus;
          }
          serverQuoteActiveRef.current = true;
          quoteKeyRef.current = `${inputToken.symbol}:${outputToken.symbol}:${amt}`;
        }
      } catch (err: any) {
        if (!abortCtrl.signal.aborted) {
          console.warn("[BuySell] Server quote upgrade failed:", err?.message || err);
        }
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      abortCtrl.abort();
    };
  }, [inputAmount, inputToken, outputToken, effectiveSlippage, hederaNetwork, isWrapUnwrap, hashPackSession?.accountId]);

  // ── Auto-slippage warning ──
  const autoSlippageWarning = useMemo(() => {
    if (!quote || isWrapUnwrap) return null;
    if (quote.confidence === "low" && effectiveSlippage < 5) {
      return { recommended: 5, message: "Quote is a price estimate \u2014 consider widening slippage to 5% for safer execution." };
    }
    return null;
  }, [quote, isWrapUnwrap, effectiveSlippage]);

  const handleSetSlippageFromWarning = useCallback((val: number) => {
    setSlippage(val);
    setCustomSlippage("");
  }, []);

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

  // ── MAX input handler ──
  const handleMaxInput = useCallback(() => {
    if (inputBalance === null) return;
    let max = inputBalance;
    if (inputToken.isNative) max = Math.max(0, max - HBAR_GAS_RESERVE);
    const formatted = max >= 1 ? max.toFixed(4) : max.toFixed(8);
    setInputAmount(formatted);
    setSwapStatus("idle");
    setSwapError(null);
  }, [inputBalance, inputToken.isNative]);

  // ── Execute swap ──
  const handleSwap = useCallback(async () => {
    if (!canSwap || !hashPackSession?.accountId) return;
    setSwapStatus("processing");
    setSwapStep(null);
    setSwapError(null);
    setLastTxId(null);

    (window as any).__swapClickedAt = Date.now();
    prewarmRelay();
    tryOpenWalletExtension().catch(() => {});

    try {
      let result: SwapResult;
      const acct = hashPackSession.accountId;

      if (isWrapUnwrap) {
        try {
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
        const swapOpts: SwapOptions = {
          maxAutoAssociations: hederaAccount?.maxAutoAssociations,
          skipBalanceCheck: true,
        };
        if (validatedRouteRef.current) swapOpts.validatedRoute = validatedRouteRef.current;
        if (approvalStatusRef.current) swapOpts.approvalStatus = approvalStatusRef.current;
        result = await executeSaucerSwap(inputToken.symbol, outputToken.symbol, inputAmount, effectiveSlippage, acct, hederaNetwork, swapOpts);
      }

      setSwapStep(null);

      if (result.success) {
        setSwapStatus("success");
        setLastTxId(result.transactionId ? String(result.transactionId) : null);
        toast.success(`Swapped ${inputAmount} ${inputToken.symbol} \u2192 ${outputToken.symbol}`);

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
          transactionId: result.transactionId ? String(result.transactionId) : null,
          executionVenue: result.executionVenue, success: true,
          isSimulated: false, network: hederaNetwork,
          inputUsd: inputUsd || undefined, outputUsd: outputUsd || undefined,
        };
        saveSwapToHistory(entry);
        setSwapHistory(loadSwapHistory());
        fetchBalances();

        // Record in orderbook
        try {
          recordTrade({
            wallet: acct,
            side: inputToken.symbol === "HBAR" ? "sell" : "buy",
            tokenIn: inputToken.symbol,
            tokenOut: outputToken.symbol,
            amountIn: parseFloat(inputAmount),
            amountOut: result.outputAmount || parseFloat(outputAmount),
            priceUsd: inputPrice,
            route: `${inputToken.symbol} \u2192 ${outputToken.symbol}`,
            router: "saucerswap",
            transactionId: result.transactionId ? String(result.transactionId) : null,
            status: "confirmed",
            slippageBps: Math.floor(effectiveSlippage * 100),
          });
        } catch { /* non-critical */ }

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
        const rawError = result.error || "Swap failed";
        const isDryRunError = rawError.toLowerCase().includes("pre-swap simulation") || rawError.toLowerCase().includes("dry run");
        const isFotError = !isDryRunError && (
          rawError.toLowerCase().includes("insufficient_output_amount") ||
          rawError.toLowerCase().includes("insufficient output")
        );
        const isWcTimeout = rawError.toLowerCase().includes("timed out");
        const classified = classifySwapError(rawError, {
          inputSymbol: inputToken.symbol,
          outputSymbol: outputToken.symbol,
          venue: result.executionVenue,
          slippagePct: effectiveSlippage,
          isV2Fallback: rawError.toLowerCase().includes("v2") && rawError.toLowerCase().includes("v1"),
        });

        if (isWcTimeout) {
          setSwapError("Wallet response timed out \u2014 your swap may have succeeded. Check your wallet balance and HashScan.");
          toast.warning("Swap may have succeeded \u2014 check your wallet", { duration: 8000 });
          fetchBalances();
        } else {
          const displayError = isFotError
            ? `${classified.userMessage}\n\nThis token may have a custom transfer fee. Please try again.`
            : `${classified.userMessage}${classified.category !== "unknown" ? `\n\n\ud83d\udca1 ${classified.suggestion}` : ""}`;
          setSwapError(displayError);
          toast.error(classified.category !== "unknown" ? classified.userMessage : rawError);
        }
      }
    } catch (err: any) {
      setSwapStatus("error");
      setSwapError(err?.message || "Unexpected error");
      setSwapStep(null);
    }
  }, [canSwap, hashPackSession?.accountId, inputToken, outputToken, inputAmount, outputAmount,
      effectiveSlippage, hederaNetwork, isWrapUnwrap, isWrapping, hederaAccount,
      quote, inputPrice, inputUsd, outputUsd, fetchBalances]);

  const handleResetSwap = useCallback(() => {
    setSwapStatus("idle");
    setSwapError(null);
    setLastTxId(null);
    setSwapStep(null);
  }, []);

  // ── Wallet token info for selector ──
  const walletTokens = useMemo<WalletTokenInfo[]>(() => {
    if (!hederaAccount) return [];
    const result: WalletTokenInfo[] = [];
    if (hederaAccount.hbarBalance != null) {
      result.push({ symbol: "HBAR", balance: hederaAccount.hbarBalance, usdValue: hederaAccount.hbarBalance * (livePrices["HBAR"] || ctxHbarPrice) });
    }
    for (const tok of (hederaAccount.tokens || [])) {
      if (BUYSELL_SYMBOLS.has(tok.symbol)) {
        result.push({ symbol: tok.symbol, balance: tok.balance, usdValue: tok.balance * (livePrices[tok.symbol] || 0) });
      }
    }
    return result;
  }, [hederaAccount, livePrices, ctxHbarPrice]);

  const tokenSelectorShared = {
    tokens: BUYSELL_TOKENS,
    walletTokens,
    livePrices,
    isDark,
    isWalletConnected,
  };

  const inputTokenContainerRef = useRef<HTMLDivElement>(null);
  const outputTokenContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-5">
      {/* ═══ SWAP INTERFACE ═══ */}
      <div className="lg:col-span-7">
        <SwapCardPro
          isDark={isDark}
          title="Buy & Sell"
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings(s => !s)}
          settingsContent={
            <SettingsDrawer
              isDark={isDark}
              slippage={slippage}
              customSlippage={customSlippage}
              effectiveSlippage={effectiveSlippage}
              onSetSlippage={handleSetSlippageFromWarning}
              onSetCustomSlippage={setCustomSlippage}
              autoSlippageWarning={autoSlippageWarning}
            />
          }
        >
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

          {/* Progressive disclosure — elements animate in after user enters amount */}
          <AnimatePresence>
            {/* Swap Button */}
            {(inputAmount && parseFloat(inputAmount) > 0) || swapStatus !== "idle" ? (
              <motion.div
                key="swap-btn-area"
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: "auto", marginTop: 4 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              >
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
                  gasReserveShortfall={gasReserveShortfall}
                  hasValidOutput={!!hasValidOutput}
                  swapStep={swapStep}
                  swapError={swapError}
                  lastTxId={lastTxId}
                  txUrl={lastTxId ? getHashScanTxUrl(lastTxId, hederaNetwork) : null}
                  onSwap={handleSwap}
                  onReset={handleResetSwap}
                  onHover={prewarmRelay}
                  onOpenWallet={() => tryOpenWalletExtension({ userInitiated: true })}
                  isDark={isDark}
                  approvalNeeded={
                    approvalStatusRef.current != null
                      ? approvalStatusRef.current.approvalNeeded
                      : (swapPrereqs?.approvalNeeded ?? null)
                  }
                />
              </motion.div>
            ) : null}

            {/* Route Visualization */}
            {route && !isWrapUnwrap && inputAmount && parseFloat(inputAmount) > 0 && (
              <motion.div
                key="route-viz"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: "spring", stiffness: 350, damping: 28, delay: 0.05 }}
              >
                <SwapRouteViz route={route} isDark={isDark} />
              </motion.div>
            )}

            {/* Quote Details */}
            {quote && inputAmount && parseFloat(inputAmount) > 0 && (
              <motion.div
                key="quote-details"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: "spring", stiffness: 350, damping: 28, delay: 0.1 }}
              >
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
                  slippage={slippage}
                  customSlippage={customSlippage}
                  onSetCustomSlippage={setCustomSlippage}
                  feeOnTransfer={swapPrereqs?.feeOnTransfer ? {
                    detected: swapPrereqs.feeOnTransfer.detected,
                    totalFeePercent: swapPrereqs.feeOnTransfer.totalFeePercent,
                    summary: swapPrereqs.feeOnTransfer.summary,
                  } : undefined}
                  quoteStale={quoteStale}
                  routeDegradation={routeDegradation}
                />
              </motion.div>
            )}
          </AnimatePresence>

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
      </div>

      {/* ═══ RIGHT COLUMN — Balances + Info ═══ */}
      <div className="lg:col-span-5 space-y-4">
        {/* Wallet Balances */}
        {isWalletConnected && (
          <div className={`rounded-2xl p-5 ${isDark
            ? "bg-gradient-to-br from-slate-900/60 to-slate-800/30 border border-pink-500/15 backdrop-blur-sm"
            : "bg-white border border-gray-200 shadow-sm"
          }`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                Your Balance
              </h3>
              <Tip content="Refresh balances">
                <button onClick={fetchBalances} className={`p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${isDark ? "hover:bg-slate-700/50 text-slate-400" : "hover:bg-gray-100 text-gray-400"}`}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </Tip>
            </div>
            <div className="space-y-3">
              {BUYSELL_TOKENS.map(token => {
                let bal = 0;
                if (token.isNative) {
                  bal = hederaAccount?.hbarBalance ?? 0;
                } else {
                  const walletTok = hederaAccount?.tokens?.find(t => t.symbol === token.symbol);
                  bal = walletTok?.balance ?? 0;
                }
                const usdVal = bal * (livePrices[token.symbol] || getTokenPriceUsd(token.symbol) || 0);
                return (
                  <div key={token.symbol} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TokenIcon src={token.logo} symbol={token.symbol} htsId={token.htsId} size="w-7 h-7" />
                      <div>
                        <div className="font-bold text-sm">{token.symbol}</div>
                        <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{token.name}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-sm">
                        {bal >= 0.01 ? bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : bal.toFixed(6)}
                      </div>
                      <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        ~${usdVal.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Swap History */}
        {swapHistory.length > 0 && (
          <div className={`rounded-2xl overflow-hidden ${isDark
            ? "bg-gradient-to-br from-slate-900/60 to-slate-800/30 border border-pink-500/15 backdrop-blur-sm"
            : "bg-white border border-gray-200 shadow-sm"
          }`}>
            <SwapHistoryPanel
              history={swapHistory.filter(h => BUYSELL_SYMBOLS.has(h.inputSymbol) && BUYSELL_SYMBOLS.has(h.outputSymbol)).slice(0, 5)}
              isDark={isDark}
              network={hederaNetwork}
              onClear={() => { clearSwapHistory(); setSwapHistory([]); }}
            />
          </div>
        )}

        {/* Quick Trade Pairs */}
        <div className={`rounded-2xl p-5 ${isDark
          ? "bg-gradient-to-br from-slate-900/60 to-slate-800/30 border border-pink-500/15 backdrop-blur-sm"
          : "bg-white border border-gray-200 shadow-sm"
        }`}>
          <h3 className="font-bold mb-3 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
            Quick Trade
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { in: "HBAR", out: "USDC", label: "HBAR \u2192 USDC" },
              { in: "USDC", out: "HBAR", label: "USDC \u2192 HBAR" },
              { in: "HBAR", out: "USDT", label: "HBAR \u2192 USDT" },
              { in: "USDT", out: "HBAR", label: "USDT \u2192 HBAR" },
              { in: "USDC", out: "USDT", label: "USDC \u2192 USDT" },
              { in: "USDT", out: "USDC", label: "USDT \u2192 USDC" },
              { in: "HBAR", out: "USDCh", label: "HBAR \u2192 USDCh" },
              { in: "USDCh", out: "HBAR", label: "USDCh \u2192 HBAR" },
            ].map(pair => (
              <button
                key={pair.label}
                onClick={() => {
                  const inTok = BUYSELL_TOKENS.find(t => t.symbol === pair.in);
                  const outTok = BUYSELL_TOKENS.find(t => t.symbol === pair.out);
                  if (inTok && outTok) {
                    setInputToken(inTok);
                    setOutputToken(outTok);
                    setInputAmount("");
                    setOutputAmount("");
                    setQuote(null);
                    setScoredRoutes([]);
                  }
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                  inputToken.symbol === pair.in && outputToken.symbol === pair.out
                    ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
                    : isDark
                    ? "bg-slate-800/50 border border-pink-500/10 text-slate-300 hover:text-white hover:border-pink-500/30"
                    : "bg-gray-50 border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-pink-200"
                }`}
              >
                {pair.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
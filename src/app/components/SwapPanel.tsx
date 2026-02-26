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
  fetchRouterQuote,
  fetchV2MultiHopQuote,
  encodeSwapPath,
  getSaucerSwapRouter,
  getSaucerswapRoutingId,
  getWhbarToken,
  getTokenPriceUsd,
  htsIdToEvmAddress,
  SAUCERSWAP_WHBAR_CONTRACT,
  type AllowedToken,
  type SwapQuote,
  type ScoredRouteInfo,
  type PoolRoute,
  type SwapResult,
  type SwapOptions,
  type SwapPrerequisites,
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
import { QuickPairGrid } from "./QuickPairGrid";

const SLIPPAGE_OPTIONS = [1.0, 3.0];
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

  // ── [V1-DEGRADE] Route degradation state ──
  // When a multi-hop route has V2 legs but execution is forced to V1
  // by [V2-SKIP], the V2 quote overestimates the actual V1 output.
  // This state holds both amounts so the UI can warn the user BEFORE
  // they confirm: "V1 routing: ~1.89 GRELF (V2 would give ~4.75)"
  const [routeDegradation, setRouteDegradation] = useState<{
    v2Amount: number;
    v1Amount: number;
    outputSymbol: string;
    outputDecimals: number;
  } | null>(null);

  // Listen for execution-time degradation events (safety net)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setRouteDegradation(detail);
    };
    window.addEventListener("swap-quote-degraded", handler);
    return () => window.removeEventListener("swap-quote-degraded", handler);
  }, []);

  // Clear degradation when tokens/amount change
  useEffect(() => {
    setRouteDegradation(null);
  }, [inputToken.symbol, outputToken.symbol, inputAmount]);

  // ── Derived: wrap/unwrap detection (must precede useEffects that reference it) ──
  const isWrapUnwrap = isHbarWhbarPair(inputToken.symbol, outputToken.symbol);
  const isWrapping = isWrapUnwrap && inputToken.symbol === "HBAR";

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

  // [STEP-15] Infinite approval REMOVED — always approves exact swap amount.
  // This prevents AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY errors on low-supply tokens.

  // ── UI state ──
  const [slippage, setSlippage] = useState(3);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showSlippage, setShowSlippage] = useState(false);
  const [showInputSelector, setShowInputSelector] = useState(false);
  const [showOutputSelector, setShowOutputSelector] = useState(false);
  const [activePoolId, setActivePoolId] = useState<string | null>(null);

  // ── Swap history ──
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);
  useEffect(() => { setSwapHistory(loadSwapHistory()); }, []);

  // ── Fetch prices (hoisted before countdown for dependency) ──
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
  }, [fetchPrices]);

  // [C81-01] Start relay keepalive when wallet is connected.
  // Keeps WC WebSocket alive so wallet auto-pops on signing requests.
  useEffect(() => {
    if (isWalletConnected) {
      startRelayKeepalive();
      prewarmRelay();
    }
  }, [isWalletConnected]);

  // Pull-to-refresh support — re-fetch swap prices on mobile swipe-down
  useEffect(() => {
    const handlePullRefresh = () => { fetchPrices(); };
    window.addEventListener("wrappdex:pull-refresh", handlePullRefresh);
    return () => window.removeEventListener("wrappdex:pull-refresh", handlePullRefresh);
  }, [fetchPrices]);

  // ── Quote refresh countdown + freshness TTL [Step 16] ──
  // When countdown reaches 0, auto-refresh both prices AND server quote.
  // This ensures users don't swap on stale quotes — critical for volatile pairs.
  const [quoteCountdown, setQuoteCountdown] = useState(QUOTE_REFRESH_INTERVAL);
  const [quoteStale, setQuoteStale] = useState(false);
  const quoteRefreshInFlightRef = useRef(false);

  useEffect(() => {
    // Reset countdown + mark fresh when prices actually refresh
    setQuoteCountdown(QUOTE_REFRESH_INTERVAL);
    setQuoteStale(false);
  }, [livePrices]);

  useEffect(() => {
    const iv = setInterval(() => {
      setQuoteCountdown(prev => {
        if (prev <= 1) {
          // [Step 16] TTL expired — mark stale and trigger refresh
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
  const effectiveSlippage = customSlippage ? parseFloat(customSlippage) || 3 : slippage;
  // [V2-EVM-FIX] Fall back to getTokenPriceUsd() which checks live cache → fallback
  // prices. livePrices alone may be missing tokens whose SaucerSwap API ID differs
  // from our registry (e.g., WETH), causing "Quote Unavailable" for valid pairs.
  const inputPrice = livePrices[inputToken.symbol] || getTokenPriceUsd(inputToken.symbol) || (inputToken.symbol === "HBAR" ? ctxHbarPrice : 0);
  const outputPrice = livePrices[outputToken.symbol] || getTokenPriceUsd(outputToken.symbol) || (outputToken.symbol === "HBAR" ? ctxHbarPrice : 0);
  const inputUsd = inputAmount ? parseFloat(inputAmount) * inputPrice : 0;
  const outputUsd = outputAmount ? parseFloat(outputAmount) * outputPrice : 0;

  // [C53] Pre-flight balance check — shows "Insufficient balance" on button
  // [PRECISION-FIX] 0.001 tolerance buffer prevents false alerts due to rounding
  const BALANCE_TOLERANCE = 0.001;
  const insufficientBalance = useMemo(() => {
    if (!isWalletConnected || !inputAmount || !parseFloat(inputAmount)) return false;
    if (inputBalance === null) return false; // Still loading
    const amt = parseFloat(inputAmount);
    if (amt <= 0) return false;
    // Allow 0.001 tolerance for rounding precision
    if (inputToken.isNative) return inputBalance + BALANCE_TOLERANCE < (amt + GAS_RESERVE);
    return inputBalance + BALANCE_TOLERANCE < amt;
  }, [isWalletConnected, inputAmount, inputBalance, inputToken.isNative]);

  // [C93] Block swap when quote output is 0 — prevents CONTRACT_REVERT_EXECUTED
  // from attempting swaps where the on-chain quote failed and minOutput would be 1.
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

  // ── [STEP-5/6] Phase 3: V2 pre-validation + V1 cross-check for multi-hop ──
  // When the route is multi-hop with V2 legs:
  //   1. Try V2 QuoterV2 validation — if it succeeds, V2 will execute and the
  //      server quote is accurate → no degradation warning needed.
  //   2. If V2 validation fails, V1 will execute — cross-check with V1
  //      getAmountsOut and correct the displayed output if divergent.
  useEffect(() => {
    if (isWrapUnwrap || !quote || !route) return;
    const isMultiHop = route.pools.length > 1;
    if (!isMultiHop) { setRouteDegradation(null); return; }
    const hasV2Leg = route.pools.some(p => p.source === "v2");
    if (!hasV2Leg) { setRouteDegradation(null); return; }

    const amt = parseFloat(inputAmount);
    if (!amt || amt <= 0) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const whbar = getWhbarToken();
        const pathTokens = route.path.map(t => t.isNative ? whbar : t);
        const pathEvm = pathTokens.map(t => htsIdToEvmAddress(t.htsId));
        const inDecimals = inputToken.isNative ? 8 : inputToken.decimals;
        const rawInput = BigInt(Math.round(amt * Math.pow(10, inDecimals)));
        const outDecimals = outputToken.isNative ? 8 : outputToken.decimals;

        // ── [STEP-5] V2 QuoterV2 pre-validation (all-V2 multi-hop only) ──
        const allV2 = route.pools.every(p => p.source === "v2");
        if (allV2) {
          try {
            // Build V2 packed path: resolve aliases + WHBAR contract fix
            const whbarTokenEvm = htsIdToEvmAddress("0.0.1456986").toLowerCase();
            const whbarContractEvm = htsIdToEvmAddress(
              SAUCERSWAP_WHBAR_CONTRACT[hederaNetwork] || SAUCERSWAP_WHBAR_CONTRACT.mainnet
            );
            const v2PathEvm = route.path.map(t => {
              if (t.isNative) return whbarContractEvm;
              const routingId = getSaucerswapRoutingId(t);
              const evm = htsIdToEvmAddress(routingId);
              return evm.toLowerCase() === whbarTokenEvm ? whbarContractEvm : evm;
            });

            // Convert pool fees to V2 fee tiers (pool.fee is %, fee tier is hundredths of bip)
            const pathHops = v2PathEvm.map((addr, i) => ({
              tokenEvm: addr,
              fee: i < route.pools.length ? (Math.round(route.pools[i].fee * 10000) || 3000) : 0,
            }));
            const packedPath = encodeSwapPath(pathHops);

            const v2QuoteOut = await fetchV2MultiHopQuote(packedPath, rawInput, hederaNetwork);
            if (cancelled) return;

            if (v2QuoteOut && v2QuoteOut > 0n) {
              // V2 validated ✓ — execution will use V2, server quote is accurate
              const v2Human = Number(v2QuoteOut) / Math.pow(10, outDecimals);
              console.log(`[STEP-5] V2 multi-hop validated in UI: ${v2Human.toFixed(6)} ${outputToken.symbol}`);
              setRouteDegradation(null);
              // If QuoterV2 amount diverges significantly from server quote, use QuoterV2
              // (on-chain source of truth, more accurate than server estimate)
              if (Math.abs(v2Human - quote.outputAmount) / Math.max(quote.outputAmount, 0.0001) > 0.05) {
                console.log(`[STEP-5] Correcting output: server=${quote.outputAmount.toFixed(6)} → QuoterV2=${v2Human.toFixed(6)}`);
                setOutputAmount(v2Human >= 1 ? v2Human.toFixed(4) : v2Human.toFixed(8));
              }
              return; // V2 viable — skip V1 cross-check
            }
          } catch (v2Err: any) {
            console.log("[STEP-5] V2 UI validation failed (non-blocking):", v2Err?.message);
          }
        }
        if (cancelled) return;

        // ── V1 cross-check (V2 validation failed or mixed legs) ──
        const v1Router = getSaucerSwapRouter(hederaNetwork, "v1");
        const v1Quote = await fetchRouterQuote(rawInput, pathEvm, v1Router, hederaNetwork);
        if (cancelled) return;

        if (v1Quote && v1Quote > 0n) {
          const v1Human = Number(v1Quote) / Math.pow(10, outDecimals);
          const serverHuman = quote.outputAmount;

          if (serverHuman > v1Human * 1.1) {
            console.log(`[V1-DEGRADE] V2 quote ${serverHuman.toFixed(6)} > V1 ${v1Human.toFixed(6)} — correcting output`);
            setRouteDegradation({
              v2Amount: serverHuman,
              v1Amount: v1Human,
              outputSymbol: outputToken.symbol,
              outputDecimals: outDecimals,
            });
            setOutputAmount(v1Human >= 1 ? v1Human.toFixed(4) : v1Human.toFixed(8));
          } else {
            setRouteDegradation(null);
          }
        }
      } catch (err: any) {
        console.warn("[V1-DEGRADE] Phase 3 cross-check failed (non-blocking):", err?.message);
      }
    }, 900);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [quote, route, inputAmount, inputToken, outputToken, hederaNetwork, isWrapUnwrap]);

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

    // [C108-S13] Auto-open wallet at swap start — helps HashPack extension
    // activate its service worker so the signing popup appears automatically.
    // Non-blocking fire-and-forget; if it fails, the "Open Wallet" timer
    // in SwapButtonPro will show a manual button after 3 seconds.
    tryOpenWalletExtension().catch(() => {});

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
        // [STEP-15] infiniteApproval removed — always exact-amount approval
        // [WALLET-PERF] skipBalanceCheck: UI already validated via insufficientBalance flag
        const swapOpts: SwapOptions = {
          maxAutoAssociations: hederaAccount?.maxAutoAssociations,
          skipBalanceCheck: true,
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
        // [FOT] Enhance error message for fee-on-transfer token failures
        // [V1-DRYRUN-FIX] Don't trigger FOT marking for dry-run errors —
        // those are simulation artifacts, not fee-on-transfer indicators.
        // [DIAG-02] Use error classifier for user-friendly messages.
        const rawError = result.error || "Swap failed";
        const isDryRunError = rawError.toLowerCase().includes("pre-swap simulation") || rawError.toLowerCase().includes("dry run");
        const isFotError = !isDryRunError && (
          rawError.toLowerCase().includes("insufficient_output_amount") ||
          rawError.toLowerCase().includes("insufficient output")
        );

        // [DIAG-02] Classify error for user-friendly display
        const classified = classifySwapError(rawError, {
          inputSymbol: inputToken.symbol,
          outputSymbol: outputToken.symbol,
          venue: result.executionVenue,
          slippagePct: effectiveSlippage,
          isV2Fallback: rawError.toLowerCase().includes("v2") && rawError.toLowerCase().includes("v1"),
        });
        console.log(`[DIAG-02] Error classified: category=${classified.category}, suggestion=${classified.suggestion}`);

        const displayError = isFotError
          ? `${classified.userMessage}\n\nThis token may have a custom transfer fee. The swap has been marked for automatic fee-tolerant routing — please try again.`
          : `${classified.userMessage}${classified.category !== "unknown" ? `\n\n💡 ${classified.suggestion}` : ""}`;
        setSwapError(displayError);
        toast.error(isFotError
          ? "Token has a transfer fee — retry will use fee-tolerant router automatically"
          : classified.category !== "unknown" ? classified.userMessage : rawError
        );

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
  }, [canSwap, hashPackSession?.accountId, isWrapUnwrap, isWrapping, inputToken, outputToken, inputAmount, outputAmount, effectiveSlippage, hederaNetwork, quote, inputUsd, outputUsd, hederaAccount, fetchBalances, hederaAccount?.maxAutoAssociations]);

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
      }, 12000); // [DIAG-02] Extended from 5s — error messages now include actionable suggestions
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
    // [STEP-11] Preserve input amount on error reset — user just wants to retry,
    // not re-enter the amount. The quote will auto-refresh from the debounced
    // effect since inputAmount is still set.
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

            {/* Quote Details + Settings (unified) */}
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
            )}

            {/* Slippage Settings — standalone fallback when no quote active */}
            {!(quote && inputAmount && parseFloat(inputAmount) > 0) && (
              <SlippageSettingsPro
                slippage={slippage}
                customSlippage={customSlippage}
                effectiveSlippage={effectiveSlippage}
                showSlippage={showSlippage}
                onToggle={() => setShowSlippage(!showSlippage)}
                onSetSlippage={setSlippage}
                onSetCustomSlippage={setCustomSlippage}
                isDark={isDark}
              />
            )}

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
              onOpenWallet={tryOpenWalletExtension}
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
          <QuickPairGrid
            allPools={allPools}
            poolsLoading={poolsLoading}
            inputToken={inputToken}
            outputToken={outputToken}
            activePoolId={activePoolId}
            route={route}
            onSelectPair={handlePoolSwap}
          />

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
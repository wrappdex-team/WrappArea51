import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Search,
  Zap,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Settings2,
  ArrowRight,
  ExternalLink,
  Shield,
  Info,
  Droplets,
  Wallet,
  RefreshCw,
  Link2,
  CircleDot,
  Activity,
  Copy,
  Check,
  X,
  RotateCcw,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { toast } from "sonner";
import { playVipCashRegister } from "../utils/sounds";
import { loadVipPrefs, isVipEligible } from "../utils/vip";
import { recordTrade } from "../utils/orderbook";
import {
  SAUCERSWAP_TOKENS,
  SAUCERSWAP_TO_ORACLE_SYMBOL,
  estimateSwapQuote,
  findSwapRoute,
  getPoolRoutes,
  executeSaucerSwap,
  ensureTokenAssociated,
  validateSwapPrerequisites,
  formatUsdCompact,
  getHashScanTxUrl,
  isHbarWhbarPair,
  isNativeHbar,
  wrapHbar,
  unwrapHbar,
  getNativeHbarBalance,
  getTokenBalance,
  fetchLiveTokenPrices,
  getLivePriceCount,
  verifySwapTransaction,
  diagnoseTransaction,
  fetchSaucerSwapQuote,
  getSaucerSwapRouter,
  discoverSaucerSwapRouter,
  getWhbarToken,
  buildSwapPath,
  resolveToken,
  parseTokenAmount,
  type AllowedToken,
  type SwapQuote,
  type PoolRoute,
  type SwapResult,
  type SwapVerification,
  type TransactionDiagnosis,
  type RawQuote,
  checkNetworkHealth,
  fetchHbarhTokenPrice,
  detectPoolVersion,
  type NetworkHealth,
} from "../utils/saucerswap";
import { fetchCoinPrices } from "../utils/coingecko";
import { copyToClipboard } from "../utils/clipboard";
import {
  SwapHistoryPanel,
  loadSwapHistory,
  saveSwapToHistory,
  clearSwapHistory,
  type SwapHistoryEntry,
} from "./SwapHistory";


const SLIPPAGE_OPTIONS = [0.1, 0.5, 1.0, 3.0];

/**
 * Detect whether a swap failure was caused by the user cancelling /
 * rejecting the transaction in their wallet.  This is a normal user
 * action and should be treated as a soft cancellation — not a hard error.
 *
 * The canonical message from hashpack.ts is "Transaction cancelled by user",
 * but saucerswap.ts may wrap it with additional context like
 * "V2 ERC-20 approve failed: Transaction cancelled by user".
 */
function isUserCancellation(result: SwapResult | null | undefined): boolean {
  if (!result) return false;
  if (result.userCancelled) return true;
  const err = (result.error || "").toLowerCase();
  return (
    err.includes("cancelled by user") ||
    err.includes("canceled by user") ||
    err.includes("user_reject") ||
    err.includes("rejected in hashpack") ||
    err.includes("user denied") ||
    err.includes("user rejected")
  );
}

// Fallback prices used when oracle is unavailable
const FALLBACK_PRICES: Record<string, number> = {
  HBAR: 0, WHBAR: 0, USDC: 1.0, USDT: 1.0, WBTC: 97000, WETH: 3600,
  LINK: 19.0, SAUCE: 0.045, HBARX: 0.30, KARATE: 0.0003,
  PACK: 0.015, DOVU: 0.002, HST: 0.018, "HBAR.ħ": 0.008,
};

// Symbols to fetch from oracle pipeline
const ORACLE_SYMBOLS = ["HBAR", "BTC", "ETH", "USDC", "USDT", "LINK"];

export function SwapPanel() {
  const { isDark } = useTheme();
  const { primaryWallet, hashPackSession, hederaNetwork, hederaAccount, hbarPrice: ctxHbarPrice } = useWallet();

  // ── Gas reserve constants ──
  // Hedera charges ~852 tinybar per gas unit. On CONTRACT_REVERT, the FULL
  // gas limit is charged, so reserves must cover worst-case.
  // HBAR→Token: only swap gas needed (no approve tx)
  // Token→Token/HBAR: swap gas + approve gas needed
  const SWAP_GAS_LIMIT = 1_500_000;
  const APPROVE_GAS_LIMIT = 800_000;
  const GAS_RATE_HBAR = 0.00000852;
  const BASE_GAS_RESERVE = Math.ceil(SWAP_GAS_LIMIT * GAS_RATE_HBAR) + 2; // ~15 HBAR
  const FULL_GAS_RESERVE = Math.ceil((SWAP_GAS_LIMIT + APPROVE_GAS_LIMIT) * GAS_RATE_HBAR) + 2; // ~22 HBAR

  // Swap state
  const [inputToken, setInputToken] = useState<AllowedToken>(SAUCERSWAP_TOKENS[0]); // HBAR (native)
  const [outputToken, setOutputToken] = useState<AllowedToken>(SAUCERSWAP_TOKENS[2]); // USDC
  const [inputAmount, setInputAmount] = useState("");
  const [outputAmount, setOutputAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [route, setRoute] = useState<{ path: AllowedToken[]; pools: PoolRoute[]; totalFee: number } | null>(null);

  // UI state
  const [showInputSelector, setShowInputSelector] = useState(false);
  const [showOutputSelector, setShowOutputSelector] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");
  const [slippage, setSlippage] = useState(0.5);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);

  // Execution state
  const [swapStatus, setSwapStatus] = useState<"idle" | "validating" | "quoting" | "confirming" | "associating" | "executing" | "success" | "error">("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<(SwapResult & { quote?: SwapQuote | null; routeDetail?: PoolRoute[] }) | null>(null);

  // Live prices from oracle pipeline
  const [livePrices, setLivePrices] = useState<Record<string, number>>(FALLBACK_PRICES);
  const [priceSource, setPriceSource] = useState<"fallback" | "live">("fallback");
  const [priceLoading, setPriceLoading] = useState(false);
  const priceRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Swap history
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);

  // Wallet balances for selected tokens
  const [inputBalance, setInputBalance] = useState<number | null>(null);
  const [outputBalance, setOutputBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Post-swap verification
  const [swapVerification, setSwapVerification] = useState<SwapVerification | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(false);

  // Transaction diagnosis
  const [txDiagnosis, setTxDiagnosis] = useState<TransactionDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);

  // SaucerSwap live token prices (for quote fallback)
  const [ssLivePriceCount, setSsLivePriceCount] = useState(0);

  // Ref for swap status — used by setTimeout closures that need the current value
  const swapStatusRef = useRef(swapStatus);
  swapStatusRef.current = swapStatus;



  // Copy error details to clipboard
  const [copiedError, setCopiedError] = useState(false);

  // Execution progress timeline steps
  const [execSteps, setExecSteps] = useState<{
    label: string;
    status: "pending" | "running" | "done" | "failed" | "skipped";
  }[]>([]);

  // Network health check
  const [networkHealth, setNetworkHealth] = useState<NetworkHealth | null>(null);
  const [networkHealthLoading, setNetworkHealthLoading] = useState(false);

  // Router discovery state — shows verified router address in pre-flight
  const [discoveredRouter, setDiscoveredRouter] = useState<string | null>(null);
  const [routerDiscoveryDone, setRouterDiscoveryDone] = useState(false);
  const [routerDiscoveryError, setRouterDiscoveryError] = useState<string | null>(null);

  // V2 pool detection state — tracks whether the current pair routes via V2
  const [v2PoolDetected, setV2PoolDetected] = useState<{ version: "v1" | "v2"; feeTier?: number; poolAddress?: string } | null>(null);
  const [v2PoolCheckDone, setV2PoolCheckDone] = useState(false);

  // Reserved for future on-chain quote display (getAmountsOut pre-fetch)

  const effectiveSlippage = customSlippage ? parseFloat(customSlippage) : slippage;
  const isWalletConnected = !!primaryWallet && !!hashPackSession?.accountId;

  // Detect HBAR↔WHBAR wrap/unwrap pair
  const isWrapUnwrap = useMemo(
    () => isHbarWhbarPair(inputToken.symbol, outputToken.symbol),
    [inputToken.symbol, outputToken.symbol]
  );
  const isWrapping = isWrapUnwrap && isNativeHbar(inputToken.symbol); // HBAR→WHBAR

  // All pool routes
  const allPools = useMemo(() => getPoolRoutes(), []);

  // ── Load swap history on mount ──
  useEffect(() => {
    setSwapHistory(loadSwapHistory());
  }, []);

  // ── Fetch wallet balances for selected tokens ──
  const fetchBalances = useCallback(async () => {
    if (!isWalletConnected || !hashPackSession?.accountId) {
      setInputBalance(null);
      setOutputBalance(null);
      return;
    }
    setBalanceLoading(true);
    const accountId = hashPackSession.accountId;
    try {
      // Input token balance
      let inBal: number | null = null;
      if (inputToken.isNative) {
        const tinybars = await getNativeHbarBalance(accountId, hederaNetwork);
        inBal = tinybars / Math.pow(10, 8);
      } else {
        const raw = await getTokenBalance(accountId, inputToken.htsId, hederaNetwork);
        inBal = raw / Math.pow(10, inputToken.decimals);
      }
      setInputBalance(inBal);

      // Output token balance
      let outBal: number | null = null;
      if (outputToken.isNative) {
        const tinybars = await getNativeHbarBalance(accountId, hederaNetwork);
        outBal = tinybars / Math.pow(10, 8);
      } else {
        const raw = await getTokenBalance(accountId, outputToken.htsId, hederaNetwork);
        outBal = raw / Math.pow(10, outputToken.decimals);
      }
      setOutputBalance(outBal);
    } catch {
      // Non-critical
    } finally {
      setBalanceLoading(false);
    }
  }, [isWalletConnected, hashPackSession?.accountId, inputToken.symbol, outputToken.symbol, hederaNetwork]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // ── Check network health (Mirror Node + SaucerSwap API) ──
  // Also triggers router discovery as a pre-flight check
  const runNetworkHealthCheck = useCallback(async () => {
    setNetworkHealthLoading(true);
    try {
      const [health, router] = await Promise.all([
        checkNetworkHealth(hederaNetwork),
        // Pre-discover the router in the background (result is cached)
        discoverSaucerSwapRouter(hederaNetwork).catch((e) => {
          setRouterDiscoveryError(e?.message || "Discovery failed");
          return null;
        }),
      ]);
      setNetworkHealth(health);
      if (router) {
        setDiscoveredRouter(router);
        setRouterDiscoveryError(null);
      }
      setRouterDiscoveryDone(true);
    } catch {
      // Non-critical
    } finally {
      setNetworkHealthLoading(false);
    }
  }, [hederaNetwork]);

  // ── Fetch live prices from oracle pipeline + SaucerSwap ──
  const fetchPrices = useCallback(async () => {
    setPriceLoading(true);
    try {
      // Fetch all price sources in parallel:
      // 1. Oracle pipeline (Chainlink/CoinCap/CoinGecko) for major tokens
      // 2. SaucerSwap token prices for Hedera-native tokens
      // 3. DexScreener for HBAR.ħ (not on CoinGecko, SaucerSwap API CORS-blocked)
      const [prices, ssLivePrices, hbarhPrice] = await Promise.all([
        fetchCoinPrices(ORACLE_SYMBOLS),
        fetchLiveTokenPrices(),
        fetchHbarhTokenPrice().catch(() => ({ price: 0, source: "error" })),
      ]);

      const priceMap: Record<string, number> = { ...FALLBACK_PRICES };
      let liveCount = 0;

      // Layer 1: SaucerSwap live token prices (covers SAUCE, KARATE, PACK, etc.)
      for (const [sym, price] of Object.entries(ssLivePrices)) {
        if (price > 0) {
          priceMap[sym] = price;
          liveCount++;
        }
      }

      // Layer 2: Oracle pipeline prices (higher accuracy for major tokens)
      for (const [ssSymbol, oracleSymbol] of Object.entries(SAUCERSWAP_TO_ORACLE_SYMBOL)) {
        const coinPrice = prices[oracleSymbol];
        if (coinPrice && coinPrice.current_price > 0) {
          priceMap[ssSymbol] = coinPrice.current_price;
          liveCount++;
        }
      }

      // Layer 2.5: Inject WalletContext HBAR price if oracle pipeline missed it
      if ((!priceMap["HBAR"] || priceMap["HBAR"] === 0) && ctxHbarPrice > 0) {
        priceMap["HBAR"] = ctxHbarPrice;
        priceMap["WHBAR"] = ctxHbarPrice;
        liveCount++;
      }

      // Layer 3: DexScreener price for HBAR.ħ — this is the authoritative source
      // for the HBAR.ħ protocol token (NOT the same as HBAR).
      if (hbarhPrice.price > 0) {
        priceMap["HBAR.ħ"] = hbarhPrice.price;
        liveCount++;
      }

      setLivePrices(priceMap);
      setPriceSource(liveCount > 0 ? "live" : "fallback");
      setSsLivePriceCount(getLivePriceCount());
    } catch {
      setPriceSource("fallback");
    } finally {
      setPriceLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    runNetworkHealthCheck();
    priceRefreshRef.current = setInterval(() => {
      fetchPrices();
      runNetworkHealthCheck();
    }, 30000);
    return () => {
      if (priceRefreshRef.current) clearInterval(priceRefreshRef.current);
    };
  }, [fetchPrices, runNetworkHealthCheck]);

  // Calculate route when tokens change
  useEffect(() => {
    const r = findSwapRoute(inputToken.symbol, outputToken.symbol);
    setRoute(r);
  }, [inputToken.symbol, outputToken.symbol]);

  // V2 pool detection — probe on-chain when tokens change
  // This runs async in the background to detect V1 vs V2 pool for the current pair
  useEffect(() => {
    if (isWrapUnwrap) {
      setV2PoolDetected(null);
      setV2PoolCheckDone(true);
      return;
    }

    let cancelled = false;
    setV2PoolCheckDone(false);
    setV2PoolDetected(null);

    const whbar = getWhbarToken();
    const tokenA_evm = (inputToken.isNative ? whbar : inputToken).evmAddress;
    const tokenB_evm = (outputToken.isNative ? whbar : outputToken).evmAddress;

    detectPoolVersion(tokenA_evm, tokenB_evm, hederaNetwork)
      .then((info) => {
        if (!cancelled) {
          setV2PoolDetected(info);
          setV2PoolCheckDone(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setV2PoolCheckDone(true);
        }
      });

    return () => { cancelled = true; };
  }, [inputToken.symbol, outputToken.symbol, hederaNetwork, isWrapUnwrap]);

  // Calculate quote when input changes
  useEffect(() => {
    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      setOutputAmount("");
      setQuote(null);
      return;
    }

    // Wrap/unwrap is always 1:1 with no fee
    if (isWrapUnwrap) {
      const amt = parseFloat(inputAmount);
      const q: SwapQuote = {
        inputToken: inputToken.symbol,
        outputToken: outputToken.symbol,
        inputAmount: amt,
        outputAmount: amt,
        priceImpact: 0,
        route: [inputToken.symbol, outputToken.symbol],
        fee: 0,
        minimumOutput: amt,
        executionPrice: 1,
      };
      setQuote(q);
      setOutputAmount(amt >= 1 ? amt.toFixed(4) : amt.toFixed(8));
      return;
    }

    const inputPriceUsd = livePrices[inputToken.symbol] || 0.01;
    const outputPriceUsd = livePrices[outputToken.symbol] || 0.01;

    const q = estimateSwapQuote(
      inputToken.symbol,
      outputToken.symbol,
      parseFloat(inputAmount),
      inputPriceUsd,
      outputPriceUsd,
      effectiveSlippage
    );

    setQuote(q);
    setOutputAmount(q.outputAmount >= 1 ? q.outputAmount.toFixed(4) : q.outputAmount.toFixed(8));
  }, [inputAmount, inputToken.symbol, outputToken.symbol, effectiveSlippage, livePrices, isWrapUnwrap]);

  const flipTokens = useCallback(() => {
    const temp = inputToken;
    setInputToken(outputToken);
    setOutputToken(temp);
    setInputAmount("");
    setOutputAmount("");
    setQuote(null);
  }, [inputToken, outputToken]);

  const handleSelectToken = (token: AllowedToken, isInput: boolean) => {
    if (isInput) {
      if (token.symbol === outputToken.symbol) {
        flipTokens();
      } else {
        setInputToken(token);
      }
      setShowInputSelector(false);
    } else {
      if (token.symbol === inputToken.symbol) {
        flipTokens();
      } else {
        setOutputToken(token);
      }
      setShowOutputSelector(false);
    }
    setTokenSearch("");
    setInputAmount("");
    setOutputAmount("");
    setQuote(null);
  };

  const filteredTokens = useMemo(() => {
    if (!tokenSearch) return SAUCERSWAP_TOKENS;
    const q = tokenSearch.toLowerCase();
    return SAUCERSWAP_TOKENS.filter(
      t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
    );
  }, [tokenSearch]);

  // ── Initiate swap → validation → execute directly (no modal) ──
  const handleSwapClick = async () => {
    // Clear previous results when starting a new swap
    setLastResult(null);
    setLastTxId(null);
    setSwapVerification(null);
    setSwapError(null);
    setExecSteps([]);
    setTxDiagnosis(null);

    if (!inputAmount || parseFloat(inputAmount) <= 0) return;
    // Allow swap if either static route exists OR V2 pool was detected on-chain
    if (!route && !isWrapUnwrap && !(v2PoolCheckDone && v2PoolDetected)) {
      toast.error("No route found for this token pair");
      return;
    }
    if (!quote) {
      toast.error("Quote not available");
      return;
    }

    const inputPriceUsd = livePrices[inputToken.symbol] || 0;
    const outputPriceUsd = livePrices[outputToken.symbol] || 0;
    const swapInputUsdValue = parseFloat(inputAmount) * inputPriceUsd;
    const swapOutputUsdValue = parseFloat(outputAmount || "0") * outputPriceUsd;

    // For live mode, validate prerequisites AND pre-fetch on-chain quote
    let outputTokenAssociated: boolean | undefined = undefined;

    if (isWalletConnected) {
      setSwapStatus("validating");
      toast.loading(isWrapUnwrap ? "Validating..." : "Validating swap...", { id: "swap-validate" });

      try {
        const validation = await validateSwapPrerequisites(
          inputToken.symbol,
          outputToken.symbol,
          inputAmount,
          hashPackSession!.accountId,
          hederaNetwork
        );

        outputTokenAssociated = validation.outputTokenAssociated;

        toast.dismiss("swap-validate");
      } catch {
        toast.dismiss("swap-validate");
        // Non-blocking — proceed anyway
      }
    }

    // Build route: use static route, wrap/unwrap synthetic route, or V2-detected route
    const effectiveRoute = route || (isWrapUnwrap ? {
      path: [inputToken, outputToken],
      pools: [] as PoolRoute[],
      totalFee: 0,
    } : (v2PoolDetected ? {
      // V2 pool detected on-chain but no static pool route — build synthetic
      path: [inputToken, outputToken],
      pools: [{
        id: `v2-${inputToken.symbol}-${outputToken.symbol}`,
        tokenA: inputToken,
        tokenB: outputToken,
        fee: (v2PoolDetected.feeTier || 3000) / 10000,
        tvlUsd: 0,
        volume24hUsd: 0,
        apr: 0,
        poolAddress: v2PoolDetected.poolAddress || "v2-detected",
      }] as PoolRoute[],
      totalFee: (v2PoolDetected.feeTier || 3000) / 10000,
    } : null));

    if (!effectiveRoute) {
      toast.error("No route found for this token pair (checked V1 and V2 pools)");
      return;
    }

    // Execute swap directly — no confirmation modal needed
    await executeSwap({
      route: effectiveRoute,
      inputUsdValue: swapInputUsdValue,
      outputUsdValue: swapOutputUsdValue,
      outputTokenAssociated,
    });
  };

  // ── Execute swap directly ──
  interface SwapExecContext {
    route: { path: AllowedToken[]; pools: PoolRoute[]; totalFee: number };
    inputUsdValue: number;
    outputUsdValue: number;
    outputTokenAssociated?: boolean;
  }

  const executeSwap = async (ctx: SwapExecContext) => {
    // For wrap/unwrap, route may be null — that's OK
    // Also allow V2-detected pools where static route is null
    if (!route && !isWrapUnwrap && !(v2PoolCheckDone && v2PoolDetected)) return;

    setSwapStatus("quoting");
    setSwapError(null);
    setLastTxId(null);
    setLastResult(null);
    setSwapVerification(null);

    const effectiveRoute = ctx.route;
    const routeStr = effectiveRoute.path.map(t => t.symbol).join(" > ");

    // ── Live Execution ──
    try {
      const accountId = hashPackSession!.accountId;

      // ── HBAR ↔ WHBAR Wrap/Unwrap ──
      if (isWrapUnwrap) {
        setSwapStatus("executing");
        const actionLabel = isWrapping ? "Wrapping" : "Unwrapping";
        toast.loading(`${actionLabel} — awaiting HashPack signature...`, { id: "swap-exec" });

        // Ensure WHBAR token is associated (needed for wrapping)
        if (isWrapping && ctx.outputTokenAssociated === false) {
          setSwapStatus("associating");
          toast.loading("Associating WHBAR with your account...", { id: "swap-exec" });
          const assocResult = await ensureTokenAssociated(accountId, outputToken.htsId, hederaNetwork);
          if (!assocResult.associated) {
            // Use the propagated userCancelled flag (primary), with string matching as fallback
            const wrapAssocCancelled = assocResult.userCancelled || (() => {
              const e = (assocResult.error || "").toLowerCase();
              return e.includes("cancelled by user") || e.includes("canceled by user") || e.includes("user_reject") || e.includes("rejected in hashpack") || e.includes("user denied") || e.includes("user rejected");
            })();
            if (wrapAssocCancelled) {
              setSwapStatus("idle");
              toast.info("Association cancelled", { id: "swap-exec", description: "You declined the WHBAR association in your wallet.", duration: 3000 });
            } else {
              setSwapStatus("error");
              setSwapError("WHBAR association failed: " + (assocResult.error || "unknown"));
              toast.error("Token association failed", { id: "swap-exec", description: assocResult.error });
              setTimeout(() => setSwapStatus("idle"), 4000);
            }
            return;
          }
          setSwapStatus("executing");
        }

        const wrapResult = isWrapping
          ? await wrapHbar(inputAmount, accountId, hederaNetwork)
          : await unwrapHbar(inputAmount, accountId, hederaNetwork);

        const result: SwapResult = {
          success: wrapResult.success,
          transactionId: wrapResult.transactionId,
          outputAmount: parseFloat(inputAmount),
          route: [inputToken.symbol, outputToken.symbol],
          priceImpact: 0,
          error: wrapResult.error,
          executionVenue: "saucerswap-v1",
        };

        setLastResult(result);

        if (result.success) {
          setSwapStatus("success");
          setLastTxId(result.transactionId || null);
          const outFmt = parseFloat(inputAmount).toFixed(4);

          const entry: SwapHistoryEntry = {
            id: `wrap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            inputSymbol: inputToken.symbol,
            outputSymbol: outputToken.symbol,
            inputAmount,
            outputAmount: outFmt,
            route: [inputToken.symbol, outputToken.symbol],
            priceImpact: 0,
            slippage: 0,
            transactionId: result.transactionId || null,
            executionVenue: isWrapping ? "wrap-hbar" : "unwrap-hbar",
            success: true,
            isSimulated: false,
            network: hederaNetwork,
            inputUsd: ctx.inputUsdValue,
            outputUsd: ctx.outputUsdValue,
          };
          saveSwapToHistory(entry);
          setSwapHistory(loadSwapHistory());

          toast.success(
            `${isWrapping ? "Wrapped" : "Unwrapped"} ${parseFloat(inputAmount).toLocaleString()} ${inputToken.symbol} > ${outFmt} ${outputToken.symbol}`,
            { id: "swap-exec", duration: 8000 }
          );
          setTimeout(() => {
            setSwapStatus("idle");
            setInputAmount("");
            setOutputAmount("");
            setQuote(null);
            setLastResult(null);
            fetchBalances();
          }, 5000);
        } else if (isUserCancellation(result)) {
          // Soft cancellation — not a real error
          setSwapStatus("idle");
          toast.info("Transaction cancelled", { id: "swap-exec", description: "You declined the transaction in your wallet. No gas was charged.", duration: 3000 });
        } else {
          setSwapStatus("error");
          setSwapError(result.error || `${actionLabel} failed`);
          toast.error(`${actionLabel} failed`, { id: "swap-exec", description: result.error, duration: 5000 });
          setTimeout(() => setSwapStatus("idle"), 4000);
        }
        return;
      }

      // ── Standard Swap via SaucerSwap ──

      // Step 1: Token association — ALWAYS ensure output token is associated.
      // The old check (=== false) would skip this when validation didn't run
      // or returned undefined. Now we check unless confirmed true.
      if (!outputToken.isNative) {
        const needsAssocCheck = ctx.outputTokenAssociated !== true;
        if (needsAssocCheck) {
          setSwapStatus("associating");
          toast.loading(`Ensuring ${outputToken.symbol} is associated...`, { id: "swap-exec" });

          const assocResult = await ensureTokenAssociated(accountId, outputToken.htsId, hederaNetwork);
          if (!assocResult.associated) {
            // Use the propagated userCancelled flag (primary), with string matching as fallback
            const assocCancelled = assocResult.userCancelled || (() => {
              const e = (assocResult.error || "").toLowerCase();
              return e.includes("cancelled by user") || e.includes("canceled by user") || e.includes("user_reject") || e.includes("rejected in hashpack") || e.includes("user denied") || e.includes("user rejected");
            })();
            if (assocCancelled) {
              setSwapStatus("idle");
              toast.info("Token association cancelled", { id: "swap-exec", description: "You declined the association in your wallet.", duration: 3000 });
            } else {
              setSwapStatus("error");
              setSwapError("Token association failed: " + (assocResult.error || "unknown"));
              toast.error("Token association failed", { id: "swap-exec", description: assocResult.error });
              setTimeout(() => setSwapStatus("idle"), 4000);
            }
            return;
          }
          if (!assocResult.alreadyAssociated) {
            toast.success(`${outputToken.symbol} associated successfully`, { id: "swap-assoc", duration: 3000 });
          }
        }
      }

      // Step 2: Handle intermediate token associations for multi-hop
      if (effectiveRoute.path.length > 2) {
        for (let i = 1; i < effectiveRoute.path.length - 1; i++) {
          const midToken = effectiveRoute.path[i];
          if (!midToken.isNative) {
            const midAssoc = await ensureTokenAssociated(accountId, midToken.htsId, hederaNetwork);
            if (!midAssoc.associated) {
              // If user cancelled the intermediate association, bail early
              if (midAssoc.userCancelled) {
                setSwapStatus("idle");
                toast.info("Token association cancelled", {
                  id: "swap-exec",
                  description: `You declined the ${midToken.symbol} association. Swap aborted.`,
                  duration: 3000,
                });
                return;
              }
              console.warn(`[HBAR.ħ] Could not associate intermediate token ${midToken.symbol}:`, midAssoc.error);
            }
          }
        }
      }

      // Step 3: Execute swap
      // The executeSaucerSwap function runs gas check + dry run + association checks
      // internally before submitting to HashPack for signing.
      setSwapStatus("executing");

      const needsApprove = !inputToken.isNative;
      const totalSteps = needsApprove ? 5 : 4;
      const stepLabel = (n: number, desc: string) => `Step ${n}/${totalSteps}: ${desc}`;

      // Initialize execution progress timeline
      const steps = [
        { label: "Gas sufficiency & token association check", status: "running" as const },
        { label: "Pre-swap dry run (Mirror Node simulation)", status: "pending" as const },
        ...(needsApprove ? [{ label: `ERC-20 approve ${inputToken.symbol} → Router`, status: "pending" as const }] : []),
        { label: inputToken.isNative ? "swapExactETHForTokens via HashPack" : outputToken.isNative ? "swapExactTokensForETH via HashPack" : "swapExactTokensForTokens via HashPack", status: "pending" as const },
        { label: "Waiting for consensus", status: "pending" as const },
      ];
      setExecSteps([...steps]);
      toast.loading(stepLabel(1, "Checking gas sufficiency & token associations..."), { id: "swap-exec" });

      // Transition toast and timeline through execution stages.
      // Uses swapStatusRef (not state) to avoid stale closure capturing
      // the old state value from the render where setTimeout was created.
      setTimeout(() => {
        if (swapStatusRef.current === "executing") {
          steps[0].status = "done";
          steps[1].status = "running";
          setExecSteps([...steps]);
          toast.loading(stepLabel(2, "Running pre-swap dry run (free Mirror Node simulation)..."), { id: "swap-exec" });
        }
      }, 2500);
      setTimeout(() => {
        if (swapStatusRef.current === "executing") {
          steps[1].status = "done";
          steps[2].status = "running";
          setExecSteps([...steps]);
          toast.loading(stepLabel(3, needsApprove ? `ERC-20 approve ${inputToken.symbol} → Router...` : "Awaiting HashPack signature..."), { id: "swap-exec" });
        }
      }, 7000);
      if (needsApprove) {
        setTimeout(() => {
          if (swapStatusRef.current === "executing") {
            steps[2].status = "done";
            steps[3].status = "running";
            setExecSteps([...steps]);
            toast.loading(stepLabel(4, "Executing swap — awaiting HashPack signature..."), { id: "swap-exec" });
          }
        }, 12000);
      }
      setTimeout(() => {
        if (swapStatusRef.current === "executing") {
          const lastIdx = steps.length - 1;
          if (lastIdx > 0) steps[lastIdx - 1].status = "done";
          steps[lastIdx].status = "running";
          setExecSteps([...steps]);
          toast.loading(stepLabel(totalSteps, "Waiting for consensus..."), { id: "swap-exec" });
        }
      }, needsApprove ? 18000 : 14000);

      const result: SwapResult = await executeSaucerSwap(
        inputToken.symbol,
        outputToken.symbol,
        inputAmount,
        effectiveSlippage,
        accountId,
        hederaNetwork
      );

      setLastResult(result);

      // Mark all execution steps as done/failed based on result
      if (result.success) {
        setExecSteps(prev => prev.map(s => ({ ...s, status: "done" as const })));
      } else {
        setExecSteps(prev => prev.map(s => ({
          ...s,
          status: s.status === "running" ? "failed" as const : s.status === "pending" ? "skipped" as const : s.status,
        })));
      }

      if (result.success) {
        setSwapStatus("success");
        setLastTxId(result.transactionId || null);

        // VIP: Play cash register sound on successful trade
        try {
          const vPrefs = loadVipPrefs();
          const toks = hederaAccount?.tokens ?? [];
          if (vPrefs.active && vPrefs.features.vip_sounds && isVipEligible(toks, hederaNetwork)) {
            playVipCashRegister();
          }
        } catch { /* non-critical */ }

        const outFmt = result.outputAmount != null
          ? (result.outputAmount >= 1 ? result.outputAmount.toFixed(4) : result.outputAmount.toFixed(8))
          : outputAmount;

        // Save to history
        const entry: SwapHistoryEntry = {
          id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          inputSymbol: inputToken.symbol,
          outputSymbol: outputToken.symbol,
          inputAmount,
          outputAmount: outFmt,
          route: result.route || [],
          priceImpact: result.priceImpact || 0,
          slippage: effectiveSlippage,
          transactionId: result.transactionId || null,
          executionVenue: result.executionVenue,
          success: true,
          isSimulated: false,
          network: hederaNetwork,
          inputUsd: ctx.inputUsdValue,
          outputUsd: ctx.outputUsdValue,
        };
        saveSwapToHistory(entry);
        setSwapHistory(loadSwapHistory());

        // Record in site orderbook
        try {
          recordTrade({
            wallet: accountId,
            side: "buy",
            tokenIn: inputToken.symbol,
            tokenOut: outputToken.symbol,
            amountIn: parseFloat(inputAmount),
            amountOut: parseFloat(outFmt),
            priceUsd: ctx.outputUsdValue ? ctx.outputUsdValue / parseFloat(outFmt) : 0,
            route: (result.route || []).join(" → ") || "direct",
            router: "saucerswap",
            transactionId: result.transactionId || null,
            status: "confirmed",
            slippageBps: Math.round((result.priceImpact || 0) * 100),
          });
        } catch { /* non-critical */ }

        toast.success(
          `Swapped ${parseFloat(inputAmount).toLocaleString()} ${inputToken.symbol} > ${outFmt} ${outputToken.symbol}`,
          {
            id: "swap-exec",
            description: `Via ${result.executionVenue} | Route: ${(result.route || []).join(" > ")}`,
            duration: 8000,
          }
        );

        // Auto-verify the swap in the background — confirms output tokens received.
        // Verification includes automatic retries (up to ~16s total) since
        // Mirror Node needs time to index the transaction.
        if (result.transactionId) {
          setVerificationLoading(true);
          toast.loading("Verifying on-chain (auto-retries for Mirror Node indexing)...", { id: "swap-verify" });
          const outputTokenId = outputToken.isNative ? "native" : outputToken.htsId;
          verifySwapTransaction(result.transactionId, accountId, outputTokenId, hederaNetwork)
            .then(v => {
              setSwapVerification(v);
              if (v.verified && v.actualOutputAmount != null) {
                const slippageDelta = result.outputAmount && result.outputAmount > 0
                  ? ((v.actualOutputAmount - result.outputAmount) / result.outputAmount * 100).toFixed(2)
                  : null;
                toast.success(
                  `Verified: received ${v.actualOutputAmount >= 1 ? v.actualOutputAmount.toFixed(4) : v.actualOutputAmount.toFixed(8)} ${v.actualOutputSymbol || outputToken.symbol}${slippageDelta ? ` (${parseFloat(slippageDelta) >= 0 ? "+" : ""}${slippageDelta}% vs quote)` : ""}`,
                  { id: "swap-verify", duration: 8000 }
                );
                // Auto-refresh balances after verified swap
                fetchBalances();
              } else if (!v.verified && v.transactionStatus === "SUCCESS") {
                toast.warning(
                  "Transaction succeeded but output token transfer not confirmed. Check HashScan for details.",
                  { id: "swap-verify", duration: 10000 }
                );
              } else if (!v.verified) {
                toast.warning(
                  `Verification: ${v.error || "Could not confirm output receipt"}`,
                  { id: "swap-verify", duration: 10000 }
                );
              }
            })
            .catch(() => {
              toast.dismiss("swap-verify");
            })
            .finally(() => setVerificationLoading(false));
        }

        // Don't auto-clear the UI too quickly — verification with retries
        // can take up to ~16–20 seconds. Wait long enough to show results.
        // Auto-clear only resets swap status and input form — the result card,
        // verification data, and exec steps remain visible until the user
        // starts a new swap (cleared in handleSwapClick).
        setTimeout(() => {
          if (swapStatusRef.current === "success") {
            setSwapStatus("idle");
            setInputAmount("");
            setOutputAmount("");
            setQuote(null);
            fetchBalances();
          }
        }, 25000);
      } else if (isUserCancellation(result)) {
        // ── Soft cancellation — user declined in wallet ──
        // Don't treat as an error: no error state, no history entry, no diagnosis.
        setSwapStatus("idle");
        setLastResult(null);
        setExecSteps([]);
        toast.info("Transaction cancelled", {
          id: "swap-exec",
          description: "You declined the transaction in your wallet. No gas was charged.",
          duration: 3000,
        });
      } else {
        setSwapStatus("error");
        setSwapError(result.error || "Swap failed");

        // Save failed swap to history (include error message for inline diagnosis)
        const entry: SwapHistoryEntry = {
          id: `fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          inputSymbol: inputToken.symbol,
          outputSymbol: outputToken.symbol,
          inputAmount,
          outputAmount: "0",
          route: result.route || [],
          priceImpact: 0,
          slippage: effectiveSlippage,
          transactionId: result.transactionId || null,
          executionVenue: result.executionVenue,
          success: false,
          isSimulated: false,
          network: hederaNetwork,
          errorMessage: result.error || "Swap failed",
        };
        saveSwapToHistory(entry);
        setSwapHistory(loadSwapHistory());

        toast.error("Swap failed", {
          id: "swap-exec",
          description: result.error,
          duration: 5000,
        });

        // Auto-verify failed swaps too — critical for detecting partial execution
        // (tokens debited but output not received). Retry logic handles Mirror Node
        // indexing delays, which is especially important for failed txs.
        if (result.transactionId) {
          // Run verification and diagnosis in parallel for failed swaps
          setVerificationLoading(true);
          setDiagnosisLoading(true);
          const outputTokenId = outputToken.isNative ? "native" : outputToken.htsId;

          // Verification: check for partial execution
          verifySwapTransaction(result.transactionId, accountId, outputTokenId, hederaNetwork)
            .then(v => {
              setSwapVerification(v);
              if (v.inputDebited && v.inputDebited > 0 && (!v.actualOutputAmount || v.actualOutputAmount <= 0)) {
                toast.error(
                  `WARNING: ${v.inputDebitedSymbol || inputToken.symbol} was debited but no ${outputToken.symbol} received! Check HashScan.`,
                  { id: "swap-verify-warn", duration: 15000 }
                );
              } else if (v.verified && v.actualOutputAmount && v.actualOutputAmount > 0) {
                // The swap actually succeeded despite the error report!
                // This can happen when receipt check throws but the tx went through.
                toast.success(
                  `Swap actually succeeded! Received ${v.actualOutputAmount >= 1 ? v.actualOutputAmount.toFixed(4) : v.actualOutputAmount.toFixed(8)} ${v.actualOutputSymbol || outputToken.symbol}`,
                  { id: "swap-verify-success", duration: 10000 }
                );
              }
            })
            .catch(() => {})
            .finally(() => setVerificationLoading(false));

          // Auto-diagnosis: get detailed breakdown of what went wrong
          diagnoseTransaction(result.transactionId, accountId, outputTokenId, hederaNetwork)
            .then(diag => {
              setTxDiagnosis(diag);
              if (diag.found && diag.result === "CONTRACT_REVERT_EXECUTED") {
                toast.info(
                  `Diagnosis: ${diag.contractCallResult?.errorMessage || "swap reverted"} — gas fee: ${diag.chargedFeeHbar?.toFixed(4) || "?"} HBAR`,
                  { id: "swap-auto-diag", duration: 12000 }
                );
              }
            })
            .catch(() => {})
            .finally(() => setDiagnosisLoading(false));
        }

        // Auto-refresh balances on failure to show if tokens were debited
        fetchBalances();

        // Don't auto-clear — let user see the error and verification results
        setTimeout(() => setSwapStatus("idle"), 20000);
      }
    } catch (err: any) {
      // Check if the thrown error is actually a user cancellation
      // (e.g., hashconnect throws USER_REJECT that wasn't caught internally)
      const thrownMsg = (err?.message || "").toLowerCase();
      const isThrownCancel =
        thrownMsg.includes("user_reject") ||
        thrownMsg.includes("cancelled by user") ||
        thrownMsg.includes("canceled by user") ||
        thrownMsg.includes("rejected in hashpack") ||
        thrownMsg.includes("user denied") ||
        thrownMsg.includes("user rejected");
      if (isThrownCancel) {
        setSwapStatus("idle");
        setLastResult(null);
        setExecSteps([]);
        toast.info("Transaction cancelled", {
          id: "swap-exec",
          description: "You declined the transaction in your wallet. No gas was charged.",
          duration: 3000,
        });
      } else {
        setSwapStatus("error");
        setSwapError(err?.message || "Unknown error");
        toast.error("Swap error", { id: "swap-exec", description: err?.message });
        setTimeout(() => setSwapStatus("idle"), 4000);
      }
    }
  };

  // ── Manual verification handler ──
  const handleVerifySwap = async () => {
    if (!lastResult?.transactionId || !hashPackSession?.accountId) return;
    setVerificationLoading(true);
    setSwapVerification(null);
    try {
      const outputTokenId = outputToken.isNative ? "native" : outputToken.htsId;
      const v = await verifySwapTransaction(
        lastResult.transactionId,
        hashPackSession.accountId,
        outputTokenId,
        hederaNetwork
      );
      setSwapVerification(v);
      if (v.verified) {
        toast.success("Swap verified on-chain!", { id: "manual-verify" });
      } else {
        toast.warning("Verification inconclusive — check HashScan for details.", { id: "manual-verify" });
      }
    } catch (err: any) {
      toast.error("Verification failed: " + (err?.message || "unknown"), { id: "manual-verify" });
    } finally {
      setVerificationLoading(false);
    }
  };

  // ── Transaction diagnostic handler ──
  const handleDiagnoseTransaction = async (txId?: string) => {
    const transactionId = txId || lastResult?.transactionId || lastTxId;
    if (!transactionId || !hashPackSession?.accountId) {
      toast.error("No transaction ID available to diagnose");
      return;
    }
    setDiagnosisLoading(true);
    setTxDiagnosis(null);
    try {
      const outputTokenId = outputToken.isNative ? "native" : outputToken.htsId;
      const diag = await diagnoseTransaction(
        transactionId,
        hashPackSession.accountId,
        outputTokenId,
        hederaNetwork
      );
      setTxDiagnosis(diag);
      if (diag.found) {
        if (diag.result === "CONTRACT_REVERT_EXECUTED") {
          toast.error("Transaction REVERTED — see diagnosis below", { id: "tx-diag", duration: 10000 });
        } else if (diag.result === "SUCCESS") {
          toast.info("Diagnosis complete — see details below", { id: "tx-diag", duration: 6000 });
        } else {
          toast.warning(`Transaction status: ${diag.result}`, { id: "tx-diag", duration: 8000 });
        }
      } else {
        toast.warning("Transaction not found yet — try again in 30 seconds", { id: "tx-diag" });
      }
    } catch (err: any) {
      toast.error("Diagnosis failed: " + (err?.message || "unknown"), { id: "tx-diag" });
    } finally {
      setDiagnosisLoading(false);
    }
  };

  // Formatting helpers
  const fmtPrice = (p: number) => p >= 1
    ? `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : p >= 0.001
      ? `$${p.toFixed(6)}`
      : `$${p.toFixed(8)}`;

  const inputUsdValue = inputAmount && !isNaN(parseFloat(inputAmount))
    ? parseFloat(inputAmount) * (livePrices[inputToken.symbol] || 0)
    : 0;
  const outputUsdValue = outputAmount && !isNaN(parseFloat(outputAmount))
    ? parseFloat(outputAmount) * (livePrices[outputToken.symbol] || 0)
    : 0;

  const canSwap =
    !!inputAmount &&
    parseFloat(inputAmount) > 0 &&
    (!!route || isWrapUnwrap || (v2PoolCheckDone && !!v2PoolDetected)) &&
    swapStatus === "idle";

  const isProcessing = ["validating", "quoting", "confirming", "associating", "executing"].includes(swapStatus);

  const cardClass = isDark
    ? "bg-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  const inputClass = isDark
    ? "bg-slate-800/50 border border-pink-500/10"
    : "bg-gray-50 border border-gray-200";

  // Token selector dropdown

  // ── Retry same swap (reset status but keep parameters) ──
  const retrySameSwap = useCallback(() => {
    setSwapStatus("idle");
    setSwapError(null);
    setLastResult(null);
    setSwapVerification(null);
    setTxDiagnosis(null);
    setExecSteps([]);
    setCopiedError(false);
    // Keep inputToken, outputToken, inputAmount, outputAmount intact
    // so the user can just click "Swap" again
    toast.info("Ready to retry — click Swap when ready.", { duration: 3000 });
  }, []);

  // ── Dismiss success card ──
  const dismissResult = useCallback(() => {
    setSwapStatus("idle");
    setLastResult(null);
    setSwapVerification(null);
    setLastTxId(null);
    setExecSteps([]);
    setInputAmount("");
    setOutputAmount("");
    setQuote(null);
  }, []);

  // ── Copy full error/swap details to clipboard for support/debugging ──
  const copySwapDetails = useCallback(() => {
    const lines: string[] = [
      `=== HBAR.ħ Swap Report ===`,
      `Time: ${new Date().toISOString()}`,
      `Mode: Live`,
      `Network: ${hederaNetwork}`,
      `Account: ${hashPackSession?.accountId || "not connected"}`,
      ``,
      `Swap: ${inputToken.symbol} → ${outputToken.symbol}`,
      `Input: ${inputAmount} ${inputToken.symbol}`,
      `Expected Output: ${outputAmount} ${outputToken.symbol}`,
      `Slippage: ${effectiveSlippage}%`,
    ];
    if (lastResult) {
      lines.push(``, `--- Result ---`);
      lines.push(`Success: ${lastResult.success}`);
      lines.push(`Tx ID: ${lastResult.transactionId || "N/A"}`);
      lines.push(`Venue: ${lastResult.executionVenue}`);
      lines.push(`Quote Source: ${lastResult.quoteSource || "N/A"}`);
      lines.push(`Dry Run: ${lastResult.dryRunPassed === undefined ? "N/A" : lastResult.dryRunPassed ? "Passed" : "Failed"}`);
      if (lastResult.outputAmount != null) lines.push(`Output Amount: ${lastResult.outputAmount}`);
      if (lastResult.route) lines.push(`Route: ${lastResult.route.join(" > ")}`);
      if (lastResult.error) lines.push(`Error: ${lastResult.error}`);
    }
    if (swapError) {
      lines.push(``, `--- Error ---`);
      lines.push(swapError);
    }
    if (swapVerification) {
      lines.push(``, `--- Verification ---`);
      lines.push(`Verified: ${swapVerification.verified}`);
      lines.push(`Tx Status: ${swapVerification.transactionStatus || "N/A"}`);
      if (swapVerification.actualOutputAmount != null)
        lines.push(`Received: ${swapVerification.actualOutputAmount} ${swapVerification.actualOutputSymbol}`);
      if (swapVerification.inputDebited != null)
        lines.push(`Debited: ${swapVerification.inputDebited} ${swapVerification.inputDebitedSymbol}`);
      lines.push(`Token Transfers: ${swapVerification.tokenTransfers.length}`);
      lines.push(`HBAR Transfers: ${swapVerification.hbarTransfers.length}`);
    }
    if (txDiagnosis) {
      lines.push(``, `--- Diagnosis ---`);
      lines.push(`Status: ${txDiagnosis.result || "N/A"}`);
      lines.push(`Fee: ${txDiagnosis.chargedFeeHbar?.toFixed(4) || "0"} HBAR`);
      lines.push(`Diagnosis: ${txDiagnosis.diagnosis}`);
      if (txDiagnosis.contractCallResult?.errorMessage)
        lines.push(`Revert: ${txDiagnosis.contractCallResult.errorMessage}`);
    }

    copyToClipboard(lines.join("\n")).then((ok) => {
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
      toast.success(ok ? "Swap details copied to clipboard" : "Could not copy — check browser permissions", { duration: 2000 });
    });
  }, [hederaNetwork, hashPackSession?.accountId, inputToken.symbol, outputToken.symbol,
      inputAmount, outputAmount, effectiveSlippage, lastResult, swapError, swapVerification, txDiagnosis]);

  // ── Parse common revert errors into actionable advice ──
  // Returns structured { title, advice, actions[], severity } for rich error display
  type ErrorAdvice = { title: string; advice: string; actions: string[]; severity: "info" | "warning" | "critical" };
  const getErrorAdvice = (error: string): ErrorAdvice | null => {
    const err = error.toLowerCase();
    if (err.includes("contract_revert_executed") || err.includes("contract revert")) {
      if (err.includes("transferfrom failed") || err.includes("transfer failed"))
        return {
          title: "Token Transfer Failed",
          advice: "The output token may not be associated with your account, causing the router's transferFrom to revert.",
          actions: [
            "Open HashPack → Settings → Token Associations",
            "Add the output token's HTS ID manually",
            "Retry the swap after association is confirmed on HashScan",
          ],
          severity: "critical",
        };
      if (err.includes("insufficient"))
        return {
          title: "Insufficient Pool Liquidity",
          advice: "The pool may lack liquidity for this amount, or reserves are in an invalid state.",
          actions: [
            "Try a smaller amount (e.g., 5 HBAR → USDC)",
            "Check pool TVL on SaucerSwap — low-liquidity pools can't support large swaps",
            "Try a different token pair with deeper liquidity",
          ],
          severity: "critical",
        };
      if (err.includes("expired") || err.includes("deadline"))
        return {
          title: "Transaction Deadline Expired",
          advice: "The swap transaction took too long and exceeded the 20-minute deadline.",
          actions: [
            "Retry the swap immediately",
            "Respond to the HashPack signature prompt quickly",
          ],
          severity: "warning",
        };
      if (err.includes("uniswapv2: k") || err.includes("invariant"))
        return {
          title: "Pool Invariant Violation",
          advice: "The swap amount is too large relative to pool reserves, violating the constant product formula.",
          actions: [
            "Reduce the swap amount significantly",
            "Check the pool's reserves on SaucerSwap",
            "Split into multiple smaller swaps",
          ],
          severity: "critical",
        };
      if (err.includes("approve") || err.includes("allowance"))
        return {
          title: "ERC-20 Approve Failed",
          advice: "The token approval transaction was rejected or failed.",
          actions: [
            "Retry — approve the transaction when HashPack prompts",
            "Ensure you have enough HBAR for gas fees (~8 HBAR)",
            "Try the swap from the beginning",
          ],
          severity: "warning",
        };
      return {
        title: "Router Rejected Swap",
        advice: "The SauceSwap V1 router reverted the transaction. Common causes: unassociated output token, insufficient liquidity, or stale swap path.",
        actions: [
          "Ensure the output token is associated in HashPack",
          "Use the Diagnose link in Swap History for the exact revert reason",
          "Try 5 HBAR → USDC as a safe first test swap",
          "Check the pool's current liquidity on SaucerSwap",
        ],
        severity: "critical",
      };
    }
    if (err.includes("pre-swap simulation failed"))
      return {
        title: "Pre-Swap Dry Run Caught Failure",
        advice: "The free Mirror Node simulation detected this swap would revert on-chain. No gas was spent.",
        actions: [
          "Review the revert reason in the error message above",
          "Fix the underlying issue (association, liquidity, path) and retry",
          "This safety check saved you ~5-15 HBAR in wasted gas",
        ],
        severity: "info",
      };
    if (err.includes("insufficient hbar"))
      return {
        title: "Insufficient HBAR Balance",
        advice: "Not enough HBAR to cover the swap amount plus gas fees.",
        actions: [
          "Ensure you have at least 15-22 HBAR beyond the swap amount",
          "For HBAR→Token swaps, use the MAX button which auto-deducts gas reserve",
          "Deposit more HBAR to your account before retrying",
        ],
        severity: "critical",
      };
    if (err.includes("association") || err.includes("token_not_associated"))
      return {
        title: "Token Not Associated",
        advice: "The output token needs to be associated with your account before it can receive transfers.",
        actions: [
          "Open HashPack → Settings → Token Associations",
          "Add the output token HTS ID",
          "Retry the swap after association",
        ],
        severity: "warning",
      };
    if (err.includes("precheck") || err.includes("payer_account"))
      return {
        title: "Transaction Pre-Check Failed",
        advice: "Hedera rejected the transaction before execution — typically an insufficient fee issue.",
        actions: [
          "Ensure you have sufficient HBAR for gas fees",
          "Try again — transient network issues can cause pre-check failures",
        ],
        severity: "warning",
      };
    if (err.includes("cancelled by user") || err.includes("canceled by user") || err.includes("user rejected") || err.includes("user denied") || err.includes("rejected by user") || err.includes("user_reject") || err.includes("rejected in hashpack"))
      return {
        title: "Transaction Cancelled",
        advice: "You declined the transaction in your wallet. No gas was charged.",
        actions: [
          "Retry when you're ready to approve the transaction",
        ],
        severity: "info",
      };
    if (err.includes("timeout") || err.includes("timed out"))
      return {
        title: "Request Timed Out",
        advice: "The request timed out waiting for a response.",
        actions: [
          "Check your internet connection",
          "Verify the HashPack extension is responsive",
          "Retry the swap",
        ],
        severity: "warning",
      };
    return null;
  };

  const TokenSelector = ({
    isOpen,
    onClose,
    onSelect,
    excludeSymbol,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (token: AllowedToken) => void;
    excludeSymbol: string;
  }) => {
    if (!isOpen) return null;
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={onClose} />
        <div className={`absolute top-full right-0 mt-2 w-80 rounded-xl shadow-2xl overflow-hidden z-50 ${isDark ? "bg-slate-900 border border-pink-500/30" : "bg-white border border-gray-200"}`}>
          <div className={`p-3 border-b ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${inputClass}`}>
              <Search className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-400"}`} />
              <input
                type="text"
                placeholder="Search tokens..."
                className="bg-transparent outline-none flex-1 text-sm min-w-0"
                value={tokenSearch}
                onChange={e => setTokenSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filteredTokens.filter(t => t.symbol !== excludeSymbol).map(token => (
              <button
                key={token.symbol}
                onClick={() => onSelect(token)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 transition-colors ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50"}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={token.logo}
                    alt={token.symbol}
                    className="w-7 h-7 rounded-full shrink-0"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="text-left min-w-0">
                    <div className="font-bold text-sm truncate">{token.symbol}</div>
                    <div className={`text-xs truncate ${isDark ? "text-slate-400" : "text-gray-500"}`}>{token.name}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm">{fmtPrice(livePrices[token.symbol] || 0)}</div>
                  <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {token.htsId}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent font-bold">
            Swap
          </h2>
          <div className="flex items-center gap-2">
            <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Trade tokens via SaucerSwap pool routes
            </p>
            {/* Price source indicator */}
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
              priceSource === "live"
                ? isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                : isDark ? "bg-slate-700/50 text-slate-400 border border-slate-600" : "bg-gray-100 text-gray-400 border border-gray-200"
            }`}>
              {priceLoading ? (
                <Loader2 className="w-2 h-2 animate-spin" />
              ) : priceSource === "live" ? (
                <CheckCircle2 className="w-2 h-2" />
              ) : null}
              {priceSource === "live" ? `Oracle${ssLivePriceCount > 0 ? ` + ${ssLivePriceCount} SS` : ""}` : "Fallback"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Price refresh */}
          <button
            onClick={fetchPrices}
            disabled={priceLoading}
            className={`p-1.5 rounded-lg transition-colors ${
              isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-gray-100 text-gray-400"
            }`}
            title="Refresh prices"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${priceLoading ? "animate-spin" : ""}`} />
          </button>
          {/* Live mode indicator */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${
            isDark
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}>
            <Zap className="w-3 h-3" />
            Live
          </div>
          {/* Connection indicator */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${
            isWalletConnected
              ? isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
              : isDark ? "bg-slate-800/50 text-slate-500 border border-slate-700/50" : "bg-gray-100 text-gray-400 border border-gray-200"
          }`}>
            <Wallet className="w-3 h-3" />
            {isWalletConnected ? "HashPack" : "Not connected"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ═══ SWAP INTERFACE ═══ */}
        <div className="lg:col-span-5">
          <div className={`rounded-2xl p-5 ${cardClass}`}>
            {/* Input Token */}
            <div className={`rounded-xl p-4 mb-2 ${inputClass}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>You Pay</span>
                  {isWalletConnected && (
                    <button
                      onClick={fetchBalances}
                      disabled={balanceLoading}
                      className={`p-0.5 rounded transition-colors ${isDark ? "hover:bg-slate-700 text-slate-600" : "hover:bg-gray-200 text-gray-400"}`}
                      title="Refresh balances"
                    >
                      <RefreshCw className={`w-2.5 h-2.5 ${balanceLoading ? "animate-spin" : ""}`} />
                    </button>
                  )}
                </div>
                {inputUsdValue > 0 && (
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    ~${inputUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  placeholder="0.0"
                  className="bg-transparent flex-1 outline-none text-2xl min-w-0"
                  value={inputAmount}
                  onChange={e => setInputAmount(e.target.value)}
                />
                <div className="relative shrink-0">
                  <button
                    onClick={() => { setShowInputSelector(!showInputSelector); setShowOutputSelector(false); setTokenSearch(""); }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all ${isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"}`}
                  >
                    <img src={inputToken.logo} alt={inputToken.symbol} className="w-6 h-6 rounded-full shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="font-bold text-sm">{inputToken.symbol}</span>
                    <ChevronDown className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
                  </button>
                  <TokenSelector
                    isOpen={showInputSelector}
                    onClose={() => { setShowInputSelector(false); setTokenSearch(""); }}
                    onSelect={t => handleSelectToken(t, true)}
                    excludeSymbol={outputToken.symbol}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                  HTS: {inputToken.htsId}
                </div>
                {isWalletConnected && inputBalance !== null && (
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      // Smart gas reserve: HBAR→Token needs less reserve than Token→Token
                      // because native HBAR swaps don't require an approve tx
                      const gasReserve = inputToken.isNative
                        ? BASE_GAS_RESERVE
                        : 0;
                      const swappableAmount = inputBalance !== null ? Math.max(0, inputBalance - gasReserve) : 0;
                      return (
                        <>
                          <button
                            onClick={() => {
                              if (inputBalance !== null && inputBalance > 0) {
                                setInputAmount(swappableAmount > 0 ? swappableAmount.toString() : "");
                              }
                            }}
                            className={`text-[10px] flex items-center gap-1 transition-colors ${
                              isDark ? "text-slate-500 hover:text-pink-400" : "text-gray-400 hover:text-pink-600"
                            }`}
                            title={`Click to use max balance${inputToken.isNative ? ` (minus ~${gasReserve} HBAR gas reserve)` : ""}`}
                          >
                            <Wallet className="w-2.5 h-2.5" />
                            {inputBalance !== null && (inputBalance >= 1 ? inputBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })
                              : inputBalance >= 0.001 ? inputBalance.toFixed(6) : inputBalance.toFixed(8)
                            )} {inputToken.symbol}
                          </button>
                          {/* Gas reserve indicator for live mode HBAR */}
                          {inputToken.isNative && inputBalance !== null && inputBalance > 0 && (
                            <span className={`text-[9px] px-1 py-0.5 rounded ${
                              swappableAmount > 0
                                ? isDark ? "bg-emerald-500/10 text-emerald-400/60" : "bg-emerald-50 text-emerald-500"
                                : isDark ? "bg-red-500/10 text-red-400/60" : "bg-red-50 text-red-500"
                            }`} title={`~${gasReserve} HBAR reserved for gas fees`}>
                              {swappableAmount > 0 ? `${Math.floor(swappableAmount)} swappable` : "low gas!"}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Flip Button */}
            <div className="flex justify-center -my-3 relative z-10">
              <button
                onClick={flipTokens}
                className={`p-2.5 rounded-xl border-4 transition-all duration-300 hover:rotate-180 ${
                  isDark
                    ? "bg-slate-800 border-slate-900/80 hover:bg-slate-700 text-pink-400"
                    : "bg-white border-gray-100 hover:bg-gray-50 text-pink-600 shadow-sm"
                }`}
              >
                <ArrowDownUp className="w-5 h-5" />
              </button>
            </div>

            {/* Output Token */}
            <div className={`rounded-xl p-4 mt-2 ${inputClass}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>You Receive</span>
                {outputUsdValue > 0 && (
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    ~${outputUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  placeholder="0.0"
                  className="bg-transparent flex-1 outline-none text-2xl min-w-0"
                  value={outputAmount}
                  readOnly
                />
                <div className="relative shrink-0">
                  <button
                    onClick={() => { setShowOutputSelector(!showOutputSelector); setShowInputSelector(false); setTokenSearch(""); }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all ${isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"}`}
                  >
                    <img src={outputToken.logo} alt={outputToken.symbol} className="w-6 h-6 rounded-full shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="font-bold text-sm">{outputToken.symbol}</span>
                    <ChevronDown className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
                  </button>
                  <TokenSelector
                    isOpen={showOutputSelector}
                    onClose={() => { setShowOutputSelector(false); setTokenSearch(""); }}
                    onSelect={t => handleSelectToken(t, false)}
                    excludeSymbol={inputToken.symbol}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                  HTS: {outputToken.htsId}
                </div>
                {isWalletConnected && outputBalance !== null && (
                  <span
                    className={`text-[10px] flex items-center gap-1 ${
                      isDark ? "text-slate-500" : "text-gray-400"
                    }`}
                  >
                    <Wallet className="w-2.5 h-2.5" />
                    {outputBalance >= 1 ? outputBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })
                      : outputBalance >= 0.001 ? outputBalance.toFixed(6) : outputBalance.toFixed(8)
                    } {outputToken.symbol}
                  </span>
                )}
              </div>
            </div>

            {/* ── Route Visualization ── */}
            {route && !isWrapUnwrap && inputAmount && parseFloat(inputAmount) > 0 && (
              <div className={`mt-4 p-3 rounded-xl ${isDark ? "bg-slate-800/30 border border-pink-500/10" : "bg-gray-50 border border-gray-100"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Droplets className={`w-3.5 h-3.5 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
                    <span className={`text-xs font-bold ${isDark ? "text-slate-300" : "text-gray-700"}`}>Swap Route</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-pink-500/10 text-pink-400" : "bg-pink-50 text-pink-600"}`}>
                    {route.pools.length === 1 ? "Direct" : `${route.pools.length}-hop`}
                  </span>
                </div>

                {/* Route path visualization */}
                <div className="flex items-center gap-1 flex-wrap">
                  {route.path.map((token, idx) => (
                    <div key={token.symbol + idx} className="flex items-center gap-1">
                      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${isDark ? "bg-slate-700/60" : "bg-gray-200"}`}>
                        <img src={token.logo} alt={token.symbol} className="w-4 h-4 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <span className="text-xs font-bold">{token.symbol}</span>
                      </div>
                      {idx < route.path.length - 1 && (
                        <div className="flex items-center">
                          <ArrowRight className={`w-3 h-3 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
                          <span className={`text-[9px] px-1 rounded ${isDark ? "bg-slate-700/40 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
                            {route.pools[idx]?.fee}%
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Pool details */}
                <div className={`mt-2 pt-2 border-t grid grid-cols-2 gap-2 text-[10px] ${isDark ? "border-slate-700/30" : "border-gray-200"}`}>
                  {route.pools.map(pool => (
                    <div key={pool.id} className={`p-1.5 rounded ${isDark ? "bg-slate-700/30" : "bg-gray-100"}`}>
                      <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                        {pool.tokenA.symbol}/{pool.tokenB.symbol}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={isDark ? "text-slate-300" : "text-gray-600"}>
                          TVL: {formatUsdCompact(pool.tvlUsd)}
                        </span>
                        <span className="text-emerald-400">{pool.apr}% APR</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Wrap/Unwrap Route Visualization ── */}
            {isWrapUnwrap && inputAmount && parseFloat(inputAmount) > 0 && (
              <div className={`mt-4 p-3 rounded-xl ${isDark ? "bg-slate-800/30 border border-purple-500/10" : "bg-gray-50 border border-purple-100"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Link2 className={`w-3.5 h-3.5 ${isDark ? "text-purple-400" : "text-purple-600"}`} />
                    <span className={`text-xs font-bold ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      {isWrapping ? "Wrap" : "Unwrap"} Path
                    </span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-purple-500/10 text-purple-400" : "bg-purple-50 text-purple-600"}`}>
                    1:1 Direct
                  </span>
                </div>

                {/* Wrap/Unwrap path visualization */}
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${isDark ? "bg-slate-700/60" : "bg-gray-200"}`}>
                    <img src={inputToken.logo} alt={inputToken.symbol} className="w-4 h-4 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="text-xs font-bold">{inputToken.symbol}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowRight className={`w-3.5 h-3.5 ${isDark ? "text-purple-400" : "text-purple-600"}`} />
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${isDark ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" : "bg-purple-50 text-purple-600 border border-purple-200"}`}>
                      {isWrapping ? "WRAP" : "UNWRAP"}
                    </span>
                    <ArrowRight className={`w-3.5 h-3.5 ${isDark ? "text-purple-400" : "text-purple-600"}`} />
                  </div>
                  <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${isDark ? "bg-slate-700/60" : "bg-gray-200"}`}>
                    <img src={outputToken.logo} alt={outputToken.symbol} className="w-4 h-4 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="text-xs font-bold">{outputToken.symbol}</span>
                  </div>
                </div>

                {/* Wrap/Unwrap details */}
                <div className={`mt-2 pt-2 border-t text-[10px] space-y-1 ${isDark ? "border-slate-700/30" : "border-gray-200"}`}>
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-slate-400" : "text-gray-500"}>Rate</span>
                    <span className={isDark ? "text-slate-300" : "text-gray-600"}>1 {inputToken.symbol} = 1 {outputToken.symbol}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-slate-400" : "text-gray-500"}>Fee</span>
                    <span className="text-emerald-400">0% (no LP fee)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-slate-400" : "text-gray-500"}>Slippage</span>
                    <span className="text-emerald-400">None</span>
                  </div>
                  <div className={`flex items-center gap-1 pt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    <Info className="w-2.5 h-2.5" />
                    {isWrapping
                      ? "Deposits native HBAR into the WHBAR contract (HTS token 0.0.1456986)"
                      : "Withdraws native HBAR from the WHBAR contract"
                    }
                  </div>
                </div>
              </div>
            )}

            {/* ── Quote Summary ── */}
            {quote && inputAmount && parseFloat(inputAmount) > 0 && (
              <div className={`mt-3 p-3 rounded-xl text-sm space-y-1.5 ${inputClass}`}>
                <div className="flex justify-between">
                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>Rate</span>
                  <span>
                    1 {inputToken.symbol} = {quote.executionPrice >= 1 ? quote.executionPrice.toFixed(4) : quote.executionPrice.toFixed(8)} {outputToken.symbol}
                  </span>
                </div>
                {!isWrapUnwrap && (
                  <>
                    <div className="flex justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Price Impact</span>
                      <span className={quote.priceImpact > 1 ? "text-amber-400" : quote.priceImpact > 5 ? "text-red-400" : "text-emerald-400"}>
                        {quote.priceImpact.toFixed(3)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>LP Fee ({route?.totalFee || 0.3}%)</span>
                      <span>${quote.fee.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Min. Received</span>
                      <span>{quote.minimumOutput >= 1 ? quote.minimumOutput.toFixed(4) : quote.minimumOutput.toFixed(8)} {outputToken.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Slippage</span>
                      <span>{effectiveSlippage}%</span>
                    </div>
                  </>
                )}
                {isWrapUnwrap && (
                  <div className="flex justify-between">
                    <span className={isDark ? "text-slate-400" : "text-gray-500"}>Type</span>
                    <span className={`flex items-center gap-1 ${isDark ? "text-purple-400" : "text-purple-600"}`}>
                      <Link2 className="w-3 h-3" />
                      {isWrapping ? "Native HBAR → WHBAR" : "WHBAR → Native HBAR"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── Slippage Settings ── */}
            <div className="mt-3">
              <button
                onClick={() => setShowSlippageSettings(!showSlippageSettings)}
                className={`flex items-center gap-2 text-sm w-full ${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"}`}
              >
                <Settings2 className="w-4 h-4" />
                <span>Slippage: {effectiveSlippage}%</span>
                <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${showSlippageSettings ? "rotate-180" : ""}`} />
              </button>
              {showSlippageSettings && (
                <div className={`mt-2 p-3 rounded-xl ${inputClass}`}>
                  <div className="flex items-center gap-2">
                    {SLIPPAGE_OPTIONS.map(opt => (
                      <button
                        key={opt}
                        onClick={() => { setSlippage(opt); setCustomSlippage(""); }}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                          slippage === opt && !customSlippage
                            ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                            : isDark ? "bg-slate-700/50 text-slate-300 hover:bg-slate-600" : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                        }`}
                      >
                        {opt}%
                      </button>
                    ))}
                    <input
                      type="number"
                      placeholder="Custom"
                      className={`w-20 px-2 py-1.5 rounded-lg text-sm outline-none ${inputClass}`}
                      value={customSlippage}
                      onChange={e => setCustomSlippage(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── Pre-Swap Readiness Checklist (Live mode only) ── */}
            {isWalletConnected && !isWrapUnwrap && inputAmount && parseFloat(inputAmount) > 0 && swapStatus === "idle" && (() => {
              const checks: { label: string; ok: boolean | null; detail?: string }[] = [];
              // Network health check
              if (networkHealth) {
                checks.push({
                  label: "Mirror Node reachable",
                  ok: networkHealth.mirrorNode.ok,
                  detail: networkHealth.mirrorNode.ok ? `${networkHealth.mirrorNode.latencyMs}ms` : (networkHealth.mirrorNode.error || "offline"),
                });
                checks.push({
                  label: "DexScreener API",
                  ok: networkHealth.dexScreener?.ok ?? null,
                  detail: networkHealth.dexScreener?.ok ? `${networkHealth.dexScreener.latencyMs}ms` : (networkHealth.dexScreener?.error || "offline"),
                });
                checks.push({
                  label: "SaucerSwap API",
                  ok: networkHealth.saucerSwapApi.ok ? true : null,
                  detail: networkHealth.saucerSwapApi.ok ? `${networkHealth.saucerSwapApi.latencyMs}ms` : (networkHealth.saucerSwapApi.error || "offline"),
                });
              }
              // Router discovery check
              checks.push({
                label: "SaucerSwap V1 Router",
                ok: routerDiscoveryDone ? !!discoveredRouter : null,
                detail: discoveredRouter
                  ? `${discoveredRouter} verified`
                  : routerDiscoveryDone
                    ? (routerDiscoveryError || "Not found")
                    : "Discovering...",
              });
              // V2 Router & Factory checks
              if (networkHealth) {
                checks.push({
                  label: "SaucerSwap V2 Router",
                  ok: networkHealth.v2Router?.ok ?? null,
                  detail: networkHealth.v2Router?.ok
                    ? `${networkHealth.v2Router.contractId} verified`
                    : (networkHealth.v2Router?.error || "Checking..."),
                });
                checks.push({
                  label: "V2 Factory discovered",
                  ok: networkHealth.v2Factory?.ok ?? null,
                  detail: networkHealth.v2Factory?.ok
                    ? `${networkHealth.v2Factory.address?.slice(0, 12)}…`
                    : (networkHealth.v2Factory?.error || "Checking..."),
                });
              }
              // Wallet check
              checks.push({ label: "Wallet connected", ok: isWalletConnected, detail: hashPackSession?.accountId });
              // Route check — now V2-aware: show V2 pool detection even if static route exists
              const routeOk = !!route || (v2PoolCheckDone && !!v2PoolDetected);
              const routeDetail = (() => {
                if (route && v2PoolDetected?.version === "v2") {
                  return `V2 pool (fee: ${(v2PoolDetected.feeTier || 3000) / 10000}%) via ${route.path.map(t => t.symbol).join("→")}`;
                }
                if (v2PoolCheckDone && v2PoolDetected?.version === "v2") {
                  return `V2 pool detected (fee: ${(v2PoolDetected.feeTier || 3000) / 10000}%)`;
                }
                if (route) {
                  return `${route.pools.length}-hop V1 via ${route.path.map(t => t.symbol).join("→")}`;
                }
                if (!v2PoolCheckDone) return "Detecting pool version…";
                return "No V1 or V2 pool found";
              })();
              checks.push({ label: "Swap route found", ok: routeOk, detail: routeDetail });
              // Balance check
              const inputAmt = parseFloat(inputAmount);
              const hasBalance = inputBalance !== null && inputBalance >= inputAmt;
              checks.push({
                label: `${inputToken.symbol} balance sufficient`,
                ok: inputBalance !== null ? hasBalance : null,
                detail: inputBalance !== null ? `${inputBalance.toFixed(4)} available` : "Loading...",
              });
              // Gas reserve check (only for HBAR input) — now with USD estimate
              if (inputToken.isNative && inputBalance !== null) {
                const needed = inputAmt + BASE_GAS_RESERVE;
                const gasCostUsd = BASE_GAS_RESERVE * (livePrices["HBAR"] || ctxHbarPrice);
                const gasLabel = `Gas reserve (~${BASE_GAS_RESERVE} HBAR ≈ $${gasCostUsd.toFixed(2)})`;
                checks.push({
                  label: gasLabel,
                  ok: inputBalance >= needed,
                  detail: inputBalance >= needed ? `${(inputBalance - inputAmt).toFixed(1)} HBAR remaining after swap` : `Need ${needed.toFixed(1)}, have ${inputBalance.toFixed(1)}`,
                });
              }
              // Gas reserve check for Token→Token/HBAR (gas only, no input deduction)
              if (!inputToken.isNative && inputBalance !== null) {
                const gasCostUsd = FULL_GAS_RESERVE * (livePrices["HBAR"] || ctxHbarPrice);
                checks.push({
                  label: `HBAR for gas (~${FULL_GAS_RESERVE} HBAR ≈ $${gasCostUsd.toFixed(2)})`,
                  ok: null, // Checked during execution's gas sufficiency step
                  detail: "Checked during validation",
                });
              }
              // Token association (null = unknown)
              if (!outputToken.isNative) {
                checks.push({
                  label: `${outputToken.symbol} associated`,
                  ok: null, // We don't check in realtime — validation does this
                  detail: "Checked during validation",
                });
              }

              const allOk = checks.every(c => c.ok !== false);
              const hasUnknown = checks.some(c => c.ok === null);

              return (
                <div className={`mt-3 p-3 rounded-xl ${isDark ? "bg-slate-800/20 border border-slate-700/20" : "bg-gray-50/80 border border-gray-100"}`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Activity className={`w-3.5 h-3.5 ${allOk ? "text-emerald-400" : "text-amber-400"}`} />
                    <span className={`text-[10px] font-bold ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                      Pre-Flight Check
                    </span>
                    <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded ${
                      allOk
                        ? hasUnknown
                          ? isDark ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-600 border border-blue-200"
                          : isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                        : isDark ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"
                    }`}>
                      {allOk ? (hasUnknown ? "Mostly Ready" : "Ready") : "Issues Found"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {checks.map((check, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        {check.ok === true ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        ) : check.ok === false ? (
                          <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                        ) : (
                          <CircleDot className={`w-3 h-3 shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                        )}
                        <span className={`${check.ok === false ? "text-red-400" : isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {check.label}
                        </span>
                        {check.detail && (
                          <span className={`ml-auto text-[9px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                            {check.detail}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Execution Progress Timeline (shown during & after live execution) ── */}
            {(isProcessing || (execSteps.length > 0 && (swapStatus === "success" || swapStatus === "error"))) && execSteps.length > 0 && (
              <div className={`mt-3 p-3 rounded-xl ${isDark ? "bg-slate-800/30 border border-pink-500/10" : "bg-gray-50 border border-gray-100"}`}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Activity className={`w-3.5 h-3.5 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
                  <span className={`text-[10px] font-bold ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                    Execution Progress
                  </span>
                  <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded ${isDark ? "bg-pink-500/10 text-pink-400 border border-pink-500/20" : "bg-pink-50 text-pink-600 border border-pink-200"}`}>
                    {execSteps.filter(s => s.status === "done").length}/{execSteps.length}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {execSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      {step.status === "done" ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      ) : step.status === "running" ? (
                        <Loader2 className="w-3 h-3 text-pink-400 animate-spin shrink-0" />
                      ) : step.status === "failed" ? (
                        <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                      ) : step.status === "skipped" ? (
                        <CircleDot className={`w-3 h-3 shrink-0 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                      ) : (
                        <CircleDot className={`w-3 h-3 shrink-0 ${isDark ? "text-slate-600" : "text-gray-400"}`} />
                      )}
                      <span className={
                        step.status === "running" ? (isDark ? "text-pink-400" : "text-pink-600") :
                        step.status === "done" ? (isDark ? "text-emerald-400" : "text-emerald-600") :
                        step.status === "failed" ? "text-red-400" :
                        isDark ? "text-slate-500" : "text-gray-400"
                      }>
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Swap Button ── */}
            <div className="mt-4">
              {isProcessing ? (
                <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-amber-600 to-yellow-500 text-white cursor-wait">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {swapStatus === "validating" ? "Validating..." :
                     swapStatus === "quoting" ? "Finding route..." :
                     swapStatus === "associating" ? "Associating token..." :
                     swapStatus === "executing" ? "Awaiting signature..." :
                     "Processing..."}
                  </div>
                </button>
              ) : swapStatus === "success" ? (
                <div>
                  <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-green-500 text-white">
                    <div className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {isWrapUnwrap
                        ? `${isWrapping ? "Wrap" : "Unwrap"} Complete!`
                        : "Swap Complete!"
                      }
                    </div>
                  </button>
                  {lastTxId && (
                    <a
                      href={getHashScanTxUrl(lastTxId, hederaNetwork)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-1.5 mt-2 text-xs transition-colors ${isDark ? "text-pink-400 hover:text-pink-300" : "text-pink-600 hover:text-pink-500"}`}
                    >
                      <ExternalLink className="w-3 h-3" />
                      View on HashScan: {lastTxId.substring(0, 24)}...
                    </a>
                  )}
                  {/* Verification status */}
                  {(
                    <div className="mt-2">
                      {verificationLoading ? (
                        <div className={`flex items-center justify-center gap-1.5 text-[10px] p-2 rounded-lg ${isDark ? "text-slate-400 bg-slate-800/20" : "text-gray-500 bg-gray-50"}`}>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Verifying on Mirror Node — up to 4 retries over ~16s...</span>
                        </div>
                      ) : swapVerification ? (
                        <div className={`p-2 rounded-lg text-[10px] ${
                          swapVerification.verified
                            ? isDark ? "bg-emerald-900/20 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"
                            : isDark ? "bg-amber-900/20 border border-amber-500/20" : "bg-amber-50 border border-amber-200"
                        }`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            {swapVerification.verified ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <AlertCircle className="w-3 h-3 text-amber-400" />
                            )}
                            <span className={swapVerification.verified ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                              {swapVerification.verified ? "Verified on-chain" : "Verification inconclusive"}
                            </span>
                          </div>
                          {swapVerification.actualOutputAmount != null && (
                            <div className={isDark ? "text-slate-300" : "text-gray-600"}>
                              Received: {swapVerification.actualOutputAmount >= 1
                                ? swapVerification.actualOutputAmount.toFixed(4)
                                : swapVerification.actualOutputAmount.toFixed(8)
                              } {swapVerification.actualOutputSymbol}
                            </div>
                          )}
                          {swapVerification.inputDebited != null && (
                            <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                              Debited: {swapVerification.inputDebited >= 1
                                ? swapVerification.inputDebited.toFixed(4)
                                : swapVerification.inputDebited.toFixed(8)
                              } {swapVerification.inputDebitedSymbol}
                            </div>
                          )}
                        </div>
                      ) : lastResult?.transactionId && isWalletConnected ? (
                        <button
                          onClick={handleVerifySwap}
                          className={`w-full flex items-center justify-center gap-1.5 text-[10px] py-1.5 rounded-lg transition-colors ${
                            isDark ? "text-slate-400 hover:text-pink-400 hover:bg-slate-800/50" : "text-gray-500 hover:text-pink-600 hover:bg-gray-50"
                          }`}
                        >
                          <Shield className="w-3 h-3" />
                          Verify on-chain
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : swapStatus === "error" ? (
                <div>
                  <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-red-600 to-orange-500 text-white">
                    <div className="flex items-center justify-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Swap Failed
                    </div>
                  </button>
                  {swapError && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-start gap-1.5 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span className="break-all">{swapError}</span>
                      </div>
                      {(() => {
                        const advice = getErrorAdvice(swapError);
                        if (!advice) return null;
                        const adviceColors = advice.severity === "critical"
                          ? isDark ? "bg-red-900/15 border border-red-500/15" : "bg-red-50 border border-red-200"
                          : advice.severity === "warning"
                            ? isDark ? "bg-amber-900/15 border border-amber-500/15" : "bg-amber-50 border border-amber-200"
                            : isDark ? "bg-blue-900/15 border border-blue-500/15" : "bg-blue-50 border border-blue-200";
                        const titleColor = advice.severity === "critical"
                          ? isDark ? "text-red-400" : "text-red-600"
                          : advice.severity === "warning"
                            ? isDark ? "text-amber-400" : "text-amber-600"
                            : isDark ? "text-blue-400" : "text-blue-600";
                        return (
                          <div className={`p-2.5 rounded-lg ${adviceColors}`}>
                            <div className={`flex items-center gap-1.5 text-[11px] font-bold mb-1 ${titleColor}`}>
                              <Info className="w-3 h-3 shrink-0" />
                              {advice.title}
                            </div>
                            <div className={`text-[10px] mb-1.5 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                              {advice.advice}
                            </div>
                            {advice.actions.length > 0 && (
                              <div className="space-y-1">
                                {advice.actions.map((action, i) => (
                                  <div key={i} className={`flex items-start gap-1.5 text-[10px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                    <span className={`shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold mt-0.5 ${
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
                  {/* Quote/DryRun badges on failed swaps — helps diagnose what went wrong */}
                  {lastResult && (lastResult.quoteSource || lastResult.dryRunPassed !== undefined) && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {lastResult.quoteSource && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          lastResult.quoteSource === "router" ? isDark ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600"
                          : lastResult.quoteSource === "price-estimate" ? isDark ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-600"
                          : lastResult.quoteSource === "none" ? isDark ? "bg-red-500/15 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600"
                          : isDark ? "bg-blue-500/15 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-600"
                        }`}>
                          Quote: {lastResult.quoteSource}
                        </span>
                      )}
                      {lastResult.dryRunPassed !== undefined && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                          lastResult.dryRunPassed
                            ? isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600"
                            : isDark ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600"
                        }`}>
                          Dry Run: {lastResult.dryRunPassed ? "Passed" : "Failed"}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {lastResult?.transactionId && (
                      <a
                        href={getHashScanTxUrl(lastResult.transactionId, hederaNetwork)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition-colors ${isDark ? "text-amber-400 hover:text-amber-300 bg-amber-900/10 hover:bg-amber-900/20" : "text-amber-600 hover:text-amber-500 bg-amber-50 hover:bg-amber-100"}`}
                      >
                        <ExternalLink className="w-3 h-3" />
                        Debug on HashScan
                      </a>
                    )}
                    {lastResult?.transactionId && isWalletConnected && (
                      <button
                        onClick={handleVerifySwap}
                        disabled={verificationLoading}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition-colors ${
                          isDark ? "text-pink-400 hover:text-pink-300 bg-pink-900/10 hover:bg-pink-900/20" : "text-pink-600 hover:text-pink-500 bg-pink-50 hover:bg-pink-100"
                        }`}
                      >
                        {verificationLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                        Verify Transfers
                      </button>
                    )}
                    <button
                      onClick={retrySameSwap}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition-colors ${
                        isDark ? "text-emerald-400 hover:text-emerald-300 bg-emerald-900/10 hover:bg-emerald-900/20" : "text-emerald-600 hover:text-emerald-500 bg-emerald-50 hover:bg-emerald-100"
                      }`}
                    >
                      <RotateCcw className="w-3 h-3" />
                      Retry Same
                    </button>
                    <button
                      onClick={copySwapDetails}
                      className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                        isDark ? "text-slate-500 hover:text-slate-300 bg-slate-800/20 hover:bg-slate-800/40" : "text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100"
                      }`}
                      title="Copy full error details for debugging"
                    >
                      {copiedError ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  {/* Verification results for failed swaps */}
                  {swapVerification && (
                    <div className={`mt-2 p-2 rounded-lg text-[10px] ${
                      isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-200"
                    }`}>
                      <div className={`font-bold mb-1 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                        Transaction Record (Mirror Node)
                      </div>
                      <div className={`space-y-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        <div>Status: <span className={
                          swapVerification.transactionStatus === "SUCCESS" ? "text-emerald-400" : "text-red-400"
                        }>{swapVerification.transactionStatus || "Unknown"}</span></div>
                        {swapVerification.inputDebited != null && (
                          <div>Input debited: {swapVerification.inputDebited.toFixed(6)} {swapVerification.inputDebitedSymbol}</div>
                        )}
                        {swapVerification.actualOutputAmount != null && swapVerification.actualOutputAmount > 0 ? (
                          <div className="text-emerald-400">Output received: {swapVerification.actualOutputAmount.toFixed(6)} {swapVerification.actualOutputSymbol}</div>
                        ) : (
                          <div className="text-red-400">No output token received</div>
                        )}
                        <div>Token transfers: {swapVerification.tokenTransfers.length} | HBAR transfers: {swapVerification.hbarTransfers.length}</div>
                        {swapVerification.error && (
                          <div className="text-red-400">{swapVerification.error}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Diagnose Transaction button */}
                  {(lastResult?.transactionId || lastTxId) && (
                    <button
                      onClick={() => handleDiagnoseTransaction()}
                      disabled={diagnosisLoading}
                      className={`mt-2 w-full py-2 rounded-lg text-xs transition-colors ${
                        isDark
                          ? "bg-blue-900/30 border border-blue-500/30 text-blue-400 hover:bg-blue-900/50"
                          : "bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100"
                      } ${diagnosisLoading ? "opacity-50" : ""}`}
                    >
                      {diagnosisLoading ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Diagnosing transaction...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-1.5">
                          <Search className="w-3 h-3" />
                          Diagnose Transaction
                        </span>
                      )}
                    </button>
                  )}
                  {/* Diagnosis results */}
                  {txDiagnosis && (
                    <div className={`mt-2 p-2.5 rounded-lg text-[10px] ${
                      txDiagnosis.result === "CONTRACT_REVERT_EXECUTED"
                        ? isDark ? "bg-red-900/20 border border-red-500/30" : "bg-red-50 border border-red-200"
                        : txDiagnosis.result === "SUCCESS"
                          ? isDark ? "bg-emerald-900/20 border border-emerald-500/30" : "bg-emerald-50 border border-emerald-200"
                          : isDark ? "bg-slate-800/30 border border-slate-700/30" : "bg-gray-50 border border-gray-200"
                    }`}>
                      <div className={`font-bold mb-1.5 ${isDark ? "text-slate-200" : "text-gray-700"}`}>
                        Full Transaction Diagnosis
                      </div>
                      <div className={`mb-2 ${
                        txDiagnosis.result === "CONTRACT_REVERT_EXECUTED" ? "text-red-400" :
                        txDiagnosis.result === "SUCCESS" ? "text-emerald-400" :
                        isDark ? "text-amber-400" : "text-amber-600"
                      }`}>
                        {txDiagnosis.diagnosis}
                      </div>
                      {txDiagnosis.chargedFeeHbar != null && (
                        <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                          Gas fee charged: {txDiagnosis.chargedFeeHbar.toFixed(4)} HBAR
                        </div>
                      )}
                      {txDiagnosis.contractCallResult && (
                        <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                          Gas used: {txDiagnosis.contractCallResult.gasUsed.toLocaleString()}
                          {txDiagnosis.contractCallResult.errorMessage && (
                            <span className="text-red-400"> | Error: {txDiagnosis.contractCallResult.errorMessage}</span>
                          )}
                        </div>
                      )}
                      {txDiagnosis.transfers.tokens.length > 0 && (
                        <div className={`mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          <span className="font-bold">Token transfers:</span>
                          {txDiagnosis.transfers.tokens.map((t, i) => (
                            <div key={i} className="pl-2">
                              {t.amountHuman >= 0 ? "+" : ""}{t.amountHuman.toFixed(6)} {t.tokenSymbol} → {t.account}
                            </div>
                          ))}
                        </div>
                      )}
                      {txDiagnosis.transfers.hbar.length > 0 && (
                        <div className={`mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          <span className="font-bold">HBAR transfers:</span>
                          {txDiagnosis.transfers.hbar.slice(0, 8).map((t, i) => (
                            <div key={i} className="pl-2">
                              {t.amountHbar >= 0 ? "+" : ""}{t.amountHbar.toFixed(4)} HBAR → {t.account}
                            </div>
                          ))}
                          {txDiagnosis.transfers.hbar.length > 8 && (
                            <div className="pl-2 italic">...and {txDiagnosis.transfers.hbar.length - 8} more</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              ) : !route && !isWrapUnwrap && !(v2PoolCheckDone && v2PoolDetected) ? (
                <button disabled className={`w-full py-3.5 rounded-xl font-bold ${isDark ? "bg-slate-700 text-slate-500" : "bg-gray-300 text-gray-500"} cursor-not-allowed`}>
                  <div className="flex items-center justify-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {!v2PoolCheckDone ? "Detecting Pool…" : "No Route Available"}
                  </div>
                </button>
              ) : (
                <button
                  onClick={handleSwapClick}
                  disabled={!canSwap}
                  className={`w-full py-3.5 rounded-xl font-bold transition-all duration-300 shadow-lg text-white ${
                    !canSwap
                      ? isDark ? "bg-slate-700 text-slate-500 shadow-none cursor-not-allowed" : "bg-gray-300 text-gray-500 shadow-none cursor-not-allowed"
                      : isWrapUnwrap
                        ? "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-purple-500/30"
                        : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-pink-500/30"
                  }`}
                >
                  {isWrapUnwrap
                    ? `${isWrapping ? "Wrap" : "Unwrap"} ${inputToken.symbol} → ${outputToken.symbol}`
                    : `Swap ${inputToken.symbol} → ${outputToken.symbol}`
                  }
                </button>
              )}
            </div>

            {/* ── Mode/Venue Info ── */}
            <div className={`flex items-center justify-center gap-2 mt-3 text-xs flex-wrap ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {isWalletConnected ? (
                <>
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${isDark ? "bg-emerald-900/20 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                    <Zap className="w-2.5 h-2.5" />
                    {isWrapUnwrap ? (isWrapping ? "Wrap HBAR" : "Unwrap WHBAR") : "SauceSwap V1"}
                  </span>
                  <span>{isWrapUnwrap ? "Direct contract call via HashPack" : "Live execution via HashPack"}</span>
                </>
              ) : (
                <>
                  <Shield className="w-3 h-3" />
                  <span>Connect HashPack wallet to {isWrapUnwrap ? (isWrapping ? "wrap" : "unwrap") : "swap"}</span>
                </>
              )}
            </div>
          </div>
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
              </div>
              <a
                href="https://www.saucerswap.finance/swap"
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1 text-xs transition-colors ${isDark ? "text-pink-400 hover:text-pink-300" : "text-pink-600 hover:text-pink-500"}`}
              >
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
                      (pool.tokenA.symbol === inputToken.symbol && pool.tokenB.symbol === outputToken.symbol) ||
                      (pool.tokenB.symbol === inputToken.symbol && pool.tokenA.symbol === outputToken.symbol) ||
                      (route && route.pools.some(p => p.id === pool.id));
                    return (
                      <tr
                        key={pool.id}
                        className={`transition-colors ${
                          isActive
                            ? isDark ? "bg-pink-500/5" : "bg-pink-50"
                            : isDark ? "hover:bg-slate-800/30" : "hover:bg-gray-50"
                        } ${isDark ? "border-t border-slate-800/30" : "border-t border-gray-100"}`}
                      >
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-1.5">
                              <img src={pool.tokenA.logo} alt={pool.tokenA.symbol} className="w-5 h-5 rounded-full ring-2 ring-slate-900/80 relative z-10" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              <img src={pool.tokenB.logo} alt={pool.tokenB.symbol} className="w-5 h-5 rounded-full ring-2 ring-slate-900/80" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            </div>
                            <div>
                              <div className="font-bold text-xs">
                                {pool.tokenA.symbol}/{pool.tokenB.symbol}
                              </div>
                              {pool.tokenA.isWrapped || pool.tokenB.isWrapped ? (
                                <span className={`text-[9px] ${isDark ? "text-purple-400" : "text-purple-600"}`}>
                                  {pool.tokenA.bridge || pool.tokenB.bridge || "Wrapped"}
                                </span>
                              ) : null}
                            </div>
                            {isActive && (
                              <span className={`text-[9px] px-1 py-0.5 rounded ${isDark ? "bg-pink-500/15 text-pink-400" : "bg-pink-100 text-pink-600"}`}>
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
                          <button
                            onClick={() => {
                              setInputToken(pool.tokenA);
                              setOutputToken(pool.tokenB);
                              setInputAmount("");
                              setOutputAmount("");
                              setQuote(null);
                            }}
                            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-pink-500/15 text-pink-400" : "hover:bg-pink-50 text-pink-600"}`}
                            title={`Swap ${pool.tokenA.symbol}/${pool.tokenB.symbol}`}
                          >
                            <ArrowDownUp className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pool legend */}
            <div className={`px-5 py-3 border-t flex items-center gap-4 text-[10px] flex-wrap ${isDark ? "border-slate-800/30 text-slate-500" : "border-gray-100 text-gray-400"}`}>
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${isDark ? "bg-pink-500/30" : "bg-pink-100"}`} />
                Active in current route
              </span>
              <span>{allPools.length} pools available</span>
              <span>Data from SaucerSwap</span>
            </div>
          </div>

          {/* ── Last Result ── */}
          {lastResult && lastResult.success && (
            <div className={`mt-4 rounded-2xl p-4 ${isDark ? "bg-emerald-900/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"}`}>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-emerald-400 text-sm">
                  Swap Result
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-slate-700/50 text-slate-400" : "bg-gray-200 text-gray-500"}`}>
                  {lastResult.executionVenue}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={copySwapDetails}
                    className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700/50 text-slate-500" : "hover:bg-gray-200 text-gray-400"}`}
                    title="Copy swap details"
                  >
                    {copiedError ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={dismissResult}
                    className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700/50 text-slate-500" : "hover:bg-gray-200 text-gray-400"}`}
                    title="Dismiss"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {/* Verification badge */}
                {swapVerification && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                    swapVerification.verified
                      ? isDark ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                      : isDark ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-600 border border-amber-200"
                  }`}>
                    {verificationLoading ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : swapVerification.verified ? (
                      <Shield className="w-2.5 h-2.5" />
                    ) : (
                      <AlertCircle className="w-2.5 h-2.5" />
                    )}
                    {verificationLoading ? "Verifying" : swapVerification.verified ? "Verified" : "Unverified"}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className={isDark ? "text-slate-400" : "text-gray-500"}>
                    {swapVerification?.verified ? "Actual Output" : "Expected Output"}
                  </div>
                  <div className="font-bold">
                    {swapVerification?.verified && swapVerification.actualOutputAmount != null
                      ? (swapVerification.actualOutputAmount >= 1 ? swapVerification.actualOutputAmount.toFixed(4) : swapVerification.actualOutputAmount.toFixed(8))
                      : lastResult.outputAmount != null
                        ? (lastResult.outputAmount >= 1 ? lastResult.outputAmount.toFixed(4) : lastResult.outputAmount.toFixed(8))
                        : "N/A"
                    } {swapVerification?.actualOutputSymbol || outputToken.symbol}
                  </div>
                </div>
                <div>
                  <div className={isDark ? "text-slate-400" : "text-gray-500"}>Route</div>
                  <div className="font-bold">{(lastResult.route || []).join(" > ")}</div>
                </div>
                <div>
                  <div className={isDark ? "text-slate-400" : "text-gray-500"}>Price Impact</div>
                  <div className="font-bold">{(lastResult.priceImpact || 0).toFixed(3)}%</div>
                </div>
                <div>
                  <div className={isDark ? "text-slate-400" : "text-gray-500"}>Tx ID</div>
                  <div className="font-bold font-mono text-[10px] truncate">
                    {lastResult.transactionId || "N/A"}
                  </div>
                </div>
              </div>
              {/* Quote source & dry run badges */}
              {(lastResult.quoteSource || lastResult.dryRunPassed !== undefined) && (
                <div className={`mt-2 pt-2 border-t flex items-center gap-2 flex-wrap ${isDark ? "border-emerald-500/10" : "border-emerald-200"}`}>
                  {lastResult.quoteSource && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                      lastResult.quoteSource === "router"
                        ? isDark ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                        : lastResult.quoteSource === "api"
                          ? isDark ? "bg-blue-500/15 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-600 border border-blue-200"
                          : lastResult.quoteSource === "price-estimate"
                            ? isDark ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-600 border border-amber-200"
                            : isDark ? "bg-red-500/15 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"
                    }`}>
                      Quote: {lastResult.quoteSource === "router" ? "On-chain" : lastResult.quoteSource === "api" ? "API" : lastResult.quoteSource === "price-estimate" ? "Price Est." : "None"}
                    </span>
                  )}
                  {lastResult.dryRunPassed !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                      lastResult.dryRunPassed
                        ? isDark ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                        : isDark ? "bg-red-500/15 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"
                    }`}>
                      {lastResult.dryRunPassed ? <CheckCircle2 className="w-2.5 h-2.5" /> : <AlertCircle className="w-2.5 h-2.5" />}
                      Dry Run: {lastResult.dryRunPassed ? "Passed" : "Failed"}
                    </span>
                  )}
                </div>
              )}
              {!swapVerification && lastResult.transactionId && isWalletConnected && (
                <div className={`mt-2 pt-2 border-t ${isDark ? "border-emerald-500/10" : "border-emerald-200"}`}>
                  <button
                    onClick={handleVerifySwap}
                    disabled={verificationLoading}
                    className={`flex items-center gap-1.5 text-[10px] transition-colors ${
                      isDark ? "text-slate-400 hover:text-emerald-400" : "text-gray-500 hover:text-emerald-600"
                    }`}
                  >
                    {verificationLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                    Verify swap on-chain via Mirror Node
                  </button>
                </div>
              )}
            </div>
          )}

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
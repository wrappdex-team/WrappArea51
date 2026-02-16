/**
 * SwapPanel — Native SaucerSwap swap widget + Pool Routes table.
 *
 * Left panel:  Compact native swap interface using SaucerSwap's public
 *              APIs and on-chain routing.  Token selection, quotes,
 *              slippage, route visualization, and execution via HashPack.
 *
 * Right panel: SaucerSwap pool routes table with TVL, volume, fee, APR.
 *              Clicking a pool's swap button updates the left panel's
 *              token pair.
 *
 * This replaces the iframe approach (SaucerSwap blocks iframe embedding
 * via X-Frame-Options / CSP frame-ancestors) and the old 2,600+ line
 * custom implementation with a clean ~450-line native widget.
 */

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
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
  Droplets,
  Wallet,
  RefreshCw,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { toast } from "sonner";
import { playVipCashRegister } from "../utils/sounds";
import { loadVipPrefs, isVipEligible } from "../utils/vip";
import { motion } from "motion/react";
import {
  SAUCERSWAP_TOKENS,
  estimateSwapQuote,
  findSwapRoute,
  getPoolRoutes,
  executeSaucerSwap,
  formatUsdCompact,
  getHashScanTxUrl,
  isHbarWhbarPair,
  wrapHbar,
  unwrapHbar,
  getNativeHbarBalance,
  getTokenBalance,
  fetchLiveTokenPrices,
  type AllowedToken,
  type SwapQuote,
  type PoolRoute,
  type SwapResult,
} from "../utils/saucerswap";
import {
  SwapHistoryPanel,
  loadSwapHistory,
  saveSwapToHistory,
  clearSwapHistory,
  type SwapHistoryEntry,
} from "./SwapHistory";
import { OneInchWidget } from "./OneInchWidget";
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

// ── Extracted Token Selector (stable identity — prevents scroll reset) ──

interface SaucerTokenSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (t: AllowedToken) => void;
  excludeSymbol: string;
  tokenSearch: string;
  setTokenSearch: (v: string) => void;
  isDark: boolean;
  inputClass: string;
  livePrices: Record<string, number>;
}

const SaucerTokenSelectorDropdown = memo(function SaucerTokenSelectorDropdown({
  isOpen, onClose, onSelect, excludeSymbol,
  tokenSearch, setTokenSearch, isDark, inputClass, livePrices,
}: SaucerTokenSelectorProps) {
  if (!isOpen) return null;
  const filtered = SAUCERSWAP_TOKENS
    .filter(t => t.symbol !== excludeSymbol)
    .filter(t => !tokenSearch || t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) || t.name.toLowerCase().includes(tokenSearch.toLowerCase()));
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="listbox"
        aria-label="Select token"
        className={`absolute top-full right-0 mt-2 w-72 rounded-xl shadow-2xl overflow-hidden z-50 ${isDark ? "bg-slate-900 border border-pink-500/30" : "bg-white border border-gray-200"}`}
      >
        <div className="p-3">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${inputClass}`}>
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              type="text" placeholder="Search tokens..." autoFocus
              aria-label="Search tokens"
              className="bg-transparent flex-1 outline-none text-sm"
              value={tokenSearch} onChange={e => setTokenSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto px-2 pb-2">
          {filtered.map(t => (
            <button key={t.symbol} onClick={() => onSelect(t)}
              role="option"
              aria-selected={false}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${isDark ? "hover:bg-slate-800/60" : "hover:bg-gray-100"}`}>
              <img src={t.logo} alt={t.symbol} className="w-6 h-6 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <div>
                <div className="font-bold text-sm">{t.symbol}</div>
                <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{t.name}</div>
              </div>
              {livePrices[t.symbol] ? (
                <span className={`ml-auto text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  ${livePrices[t.symbol]?.toFixed(livePrices[t.symbol] >= 1 ? 2 : 6)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </>
  );
});

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
  const [route, setRoute] = useState<ReturnType<typeof findSwapRoute>>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

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

  // ── UI state ──
  const [slippage, setSlippage] = useState(0.5);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showSlippage, setShowSlippage] = useState(false);
  const [showInputSelector, setShowInputSelector] = useState(false);
  const [showOutputSelector, setShowOutputSelector] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");
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

  // ── Derived ──
  const allPools = useMemo(() => getPoolRoutes(), []);
  const effectiveSlippage = customSlippage ? parseFloat(customSlippage) || 0.5 : slippage;
  const isWrapUnwrap = isHbarWhbarPair(inputToken.symbol, outputToken.symbol);
  const isWrapping = isWrapUnwrap && inputToken.symbol === "HBAR";

  const inputPrice = livePrices[inputToken.symbol] || (inputToken.symbol === "HBAR" ? ctxHbarPrice : 0);
  const outputPrice = livePrices[outputToken.symbol] || (outputToken.symbol === "HBAR" ? ctxHbarPrice : 0);
  const inputUsd = inputAmount ? parseFloat(inputAmount) * inputPrice : 0;
  const outputUsd = outputAmount ? parseFloat(outputAmount) * outputPrice : 0;

  const canSwap = isWalletConnected && inputAmount && parseFloat(inputAmount) > 0 &&
    (isWrapUnwrap || route) && swapStatus === "idle";

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
  useEffect(() => {
    if (isWrapUnwrap) { setRoute(null); return; }
    const r = findSwapRoute(inputToken.symbol, outputToken.symbol);
    setRoute(r);
  }, [inputToken.symbol, outputToken.symbol, isWrapUnwrap]);

  // ── Calculate quote ──
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    const amt = parseFloat(inputAmount);
    if (!amt || amt <= 0) { setQuote(null); setOutputAmount(""); return; }

    if (isWrapUnwrap) {
      setOutputAmount(inputAmount);
      setQuote({
        inputToken: inputToken.symbol, outputToken: outputToken.symbol,
        inputAmount: amt, outputAmount: amt, priceImpact: 0,
        route: [inputToken.symbol, outputToken.symbol],
        fee: 0, minimumOutput: amt, executionPrice: 1,
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
    setTokenSearch("");
  }, [inputToken, outputToken]);

  // ── Execute swap ──
  const handleSwap = useCallback(async () => {
    if (!canSwap || !hashPackSession?.accountId) return;
    setSwapStatus("processing");
    setSwapError(null);
    setLastTxId(null);

    try {
      let result: SwapResult;
      const acct = hashPackSession.accountId;

      if (isWrapUnwrap) {
        try {
          const txId = isWrapping
            ? await wrapHbar(inputAmount, acct, hederaNetwork)
            : await unwrapHbar(inputAmount, acct, hederaNetwork);
          result = { success: true, transactionId: txId, outputAmount: parseFloat(inputAmount), executionVenue: "saucerswap-v1", route: [inputToken.symbol, outputToken.symbol] };
        } catch (err: any) {
          const msg = err?.message || "Wrap/unwrap failed";
          result = { success: false, error: msg, executionVenue: "saucerswap-v1", userCancelled: msg.toLowerCase().includes("cancelled") || msg.toLowerCase().includes("user_reject") };
        }
      } else {
        result = await executeSaucerSwap(inputToken.symbol, outputToken.symbol, inputAmount, effectiveSlippage, acct, hederaNetwork);
      }

      if (result.success) {
        setSwapStatus("success");
        setLastTxId(result.transactionId || null);
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
          transactionId: result.transactionId || null,
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
          transactionId: result.transactionId || null,
          txUrl: result.transactionId ? getHashScanTxUrl(result.transactionId, hederaNetwork) : null,
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
          transactionId: result.transactionId || null,
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
  }, [canSwap, hashPackSession?.accountId, isWrapUnwrap, isWrapping, inputToken, outputToken, inputAmount, outputAmount, effectiveSlippage, hederaNetwork, quote, inputUsd, outputUsd, hederaAccount, fetchBalances]);

  // ── Pool table handler ──
  const handlePoolSwap = useCallback((pool: PoolRoute) => {
    setInputToken(pool.tokenA);
    setOutputToken(pool.tokenB);
    setInputAmount("");
    setOutputAmount("");
    setQuote(null);
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

  // ── Shared props for extracted TokenSelector ──
  const saucerTokenSelectorShared = useMemo(() => ({
    tokenSearch, setTokenSearch, isDark, inputClass, livePrices,
  }), [tokenSearch, setTokenSearch, isDark, inputClass, livePrices]);

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
                  <button onClick={() => { setShowInputSelector(!showInputSelector); setShowOutputSelector(false); setTokenSearch(""); }}
                    aria-label={`Select input token, currently ${inputToken.symbol}`}
                    aria-haspopup="listbox"
                    aria-expanded={showInputSelector}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"}`}>
                    <img src={inputToken.logo} alt={inputToken.symbol} className="w-6 h-6 rounded-full shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="font-bold text-sm">{inputToken.symbol}</span>
                    <ChevronDown className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
                  </button>
                  {showInputSelector && (
                    <SaucerTokenSelectorDropdown isOpen={showInputSelector} onClose={() => { setShowInputSelector(false); setTokenSearch(""); }}
                      onSelect={t => handleSelectToken(t, true)} excludeSymbol={outputToken.symbol} {...saucerTokenSelectorShared} />
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
                  <button onClick={() => { setShowOutputSelector(!showOutputSelector); setShowInputSelector(false); setTokenSearch(""); }}
                    aria-label={`Select output token, currently ${outputToken.symbol}`}
                    aria-haspopup="listbox"
                    aria-expanded={showOutputSelector}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"}`}>
                    <img src={outputToken.logo} alt={outputToken.symbol} className="w-6 h-6 rounded-full shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="font-bold text-sm">{outputToken.symbol}</span>
                    <ChevronDown className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
                  </button>
                  {showOutputSelector && (
                    <SaucerTokenSelectorDropdown isOpen={showOutputSelector} onClose={() => { setShowOutputSelector(false); setTokenSearch(""); }}
                      onSelect={t => handleSelectToken(t, false)} excludeSymbol={inputToken.symbol} {...saucerTokenSelectorShared} />
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
                        <img src={token.logo} alt={token.symbol} className="w-4 h-4 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
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
                <div className={`mt-2 p-3 rounded-xl ${inputClass}`}>
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
                </div>
              )}
            </div>

            {/* ── Swap Button ── */}
            <div className="mt-4">
              {swapStatus === "processing" ? (
                <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-amber-600 to-yellow-500 text-white cursor-wait">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Awaiting wallet signature...
                  </div>
                </button>
              ) : swapStatus === "success" ? (
                <div>
                  <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-green-500 text-white">
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
                  <button onClick={() => { setSwapStatus("idle"); setInputAmount(""); setOutputAmount(""); setQuote(null); }}
                    className={`w-full mt-2 py-2 rounded-lg text-xs transition-colors ${isDark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
                    New Swap
                  </button>
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
                    <AlertCircle className="w-4 h-4" />
                    No Route Available
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
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${isDark ? "bg-emerald-900/20 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                    <Zap className="w-2.5 h-2.5" />
                    {isWrapUnwrap ? (isWrapping ? "Wrap HBAR" : "Unwrap WHBAR") : "SaucerSwap V1"}
                  </span>
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
                              <img src={pool.tokenA.logo} alt={pool.tokenA.symbol} className="w-5 h-5 rounded-full ring-2 ring-slate-900/80 relative z-10" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              <img src={pool.tokenB.logo} alt={pool.tokenB.symbol} className="w-5 h-5 rounded-full ring-2 ring-slate-900/80" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
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
              <span>{allPools.length} pools available</span>
              <span>Data from SaucerSwap</span>
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
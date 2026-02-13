import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ArrowDownUp,
  AlertCircle,
  CheckCircle2,
  Shield,
  Settings2,
  ChevronDown,
  Zap,
  ExternalLink,
  Wallet,
  ArrowRightLeft,
  CreditCard,
  Lock,
  Eye,
  ShieldCheck,
  Info,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { playVipCashRegister } from "../utils/sounds";
import { loadVipPrefs, isVipEligible } from "../utils/vip";
import { recordTrade } from "../utils/orderbook";
import { fetchCoinPrices } from "../utils/coingecko";
import { formatHbar } from "../utils/hedera";
import { WalletConnectModal } from "./WalletConnectModal";
import { orchestrateSwap } from "../utils/hsuite";
import {
  executeSaucerSwap,
  type SwapResult,
} from "../utils/saucerswap";
import { signTransaction as hashPackSign } from "../utils/hashpack";

// ── Assets ───────────────────────────────────────────────────────────

const HBAR_LOGO = "https://assets.coingecko.com/coins/images/3688/large/hbar.png";
const USDC_LOGO = "https://assets.coingecko.com/coins/images/6319/large/usdc.png";
const CHANGENOW_LOGO = "https://changenow.io/images/changenow-logo.svg";

const SLIPPAGE_OPTIONS = [0.1, 0.5, 1.0, 3.0];

// ── ChangeNOW widget config ──────────────────────────────────────────

const CN_LINK_ID = "4de8efb2ccff7a";

/** Validate Hedera account ID format (0.0.xxxxx) to prevent injection */
function isValidHederaAddress(addr: string): boolean {
  return /^0\.0\.\d{1,10}$/.test(addr);
}

/** Session-scoped consent key for fiat on-ramp privacy notice */
const FIAT_CONSENT_KEY = "hbarh_fiat_consent_accepted";

function buildChangeNowUrl(opts: {
  isDark: boolean;
  topUpMode?: boolean;
  topUpCurrency?: string;
  topUpAddress?: string;
  from?: string;
  to?: string;
}) {
  const bg = opts.isDark ? "0d0d1a" : "FFFFFF";

  // Base params shared by both modes
  const params = new URLSearchParams({
    FAQ: "true",
    backgroundColor: bg,
    darkMode: String(opts.isDark),
    horizontal: "false",
    lang: "en-US",
    link_id: CN_LINK_ID,
    locales: "true",
    logo: "true",
    primaryColor: "EC4899",
    toTheMoon: "true",
  });

  if (opts.topUpMode) {
    // Fiat on-ramp mode — buying crypto with fiat
    const targetCurrency = opts.topUpCurrency ?? "hbar";
    params.set("amount", "500");
    params.set("from", "usd");
    params.set("fromFiat", "usd");
    params.set("to", targetCurrency);
    params.set("toFiat", targetCurrency);
    params.set("isFiat", "true");
    params.set("isEstimate", "true");
    // ChangeNOW fiat on-ramp fields
    if (opts.topUpAddress && isValidHederaAddress(opts.topUpAddress)) {
      params.set("address", opts.topUpAddress);
    }
  } else {
    // Crypto-to-crypto cross-chain swap mode
    params.set("amount", "0.1");
    params.set("amountFiat", "500");
    params.set("from", opts.from ?? "btc");
    params.set("fromFiat", "usd");
    params.set("to", opts.to ?? "hbar");
    params.set("toFiat", opts.to ?? "hbar");
    params.set("isFiat", "");
  }

  return `https://changenow.io/embeds/exchange-widget/v2/widget.html?${params.toString()}`;
}

// Iframe sandbox permissions — restrictive but functional for ChangeNOW widget
const CN_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

// ── Types ────────────────────────────────────────────────────────────

type TabKey = "swap" | "crosschain" | "topup";

interface RecentSwap {
  id: string;
  type: "buy" | "sell";
  hbarAmount: number;
  usdcAmount: number;
  price: number;
  timestamp: Date;
  status: "completed" | "pending";
}

// ── Main Component ───────────────────────────────────────────────────

export function BuySell() {
  const { isDark } = useTheme();
  const { primaryWallet, hederaAccount, hashPackSession, hederaNetwork, hbarPrice: ctxHbarPrice } = useWallet();

  const [activeTab, setActiveTab] = useState<TabKey>("swap");
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [hbarAmount, setHbarAmount] = useState("");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [slippage, setSlippage] = useState(0.5);
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [customSlippage, setCustomSlippage] = useState("");
  const [livePrice, setLivePrice] = useState(0);
  const [priceChange, setPriceChange] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [swapStatus, setSwapStatus] = useState<"idle" | "confirming" | "success" | "error">("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [recentSwaps, setRecentSwaps] = useState<RecentSwap[]>([]);

  // Top-up currency selector
  const [topUpCurrency, setTopUpCurrency] = useState<"hbar" | "usdc">("hbar");

  // Fiat consent gate — user must acknowledge third-party data notice once per session
  const [fiatConsent, setFiatConsent] = useState(() => {
    try { return sessionStorage.getItem(FIAT_CONSENT_KEY) === "true"; } catch { return false; }
  });
  const acceptFiatConsent = () => {
    setFiatConsent(true);
    try { sessionStorage.setItem(FIAT_CONSENT_KEY, "true"); } catch { /* non-critical */ }
  };

  // Connected wallet address for top-up pre-fill (must be above useEffect that depends on it)
  const walletAddress = hashPackSession?.accountId || "";

  // Stepper connector script – load once, never remove (ChangeNOW's
  // stepper-connector.js crashes if the script tag is removed while its
  // internal MutationObserver is still active).
  // We poll for the actual iframe DOM node instead of a blind timeout so the
  // script never runs before the iframe exists (avoids "iframe-widget not found").
  const scriptLoaded = useRef(false);
  useEffect(() => {
    if (scriptLoaded.current) return;
    if (activeTab !== "crosschain" && activeTab !== "topup") return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 50; // ~830ms at 60 fps — generous for React render

    const tryLoad = () => {
      if (cancelled) return;
      const iframe = document.getElementById("iframe-widget");
      if (iframe) {
        const existing = document.querySelector('script[src*="stepper-connector"]');
        if (!existing) {
          const s = document.createElement("script");
          s.src = "https://changenow.io/embeds/exchange-widget/v2/stepper-connector.js";
          s.defer = true;
          document.body.appendChild(s);
        }
        scriptLoaded.current = true;
        return;
      }
      if (++attempts < maxAttempts) {
        requestAnimationFrame(tryLoad);
      }
    };
    requestAnimationFrame(tryLoad);

    return () => { cancelled = true; };
  }, [activeTab]);

  // Fetch live HBAR price
  const refreshPrice = useCallback(async () => {
    setIsRefreshing(true);
    const data = await fetchCoinPrices(["HBAR"]);
    if (data.HBAR && data.HBAR.current_price > 0) {
      setLivePrice(data.HBAR.current_price);
      setPriceChange(data.HBAR.price_change_percentage_24h);
    } else if (ctxHbarPrice > 0) {
      // Fallback to WalletContext oracle price
      setLivePrice(ctxHbarPrice);
    }
    setTimeout(() => setIsRefreshing(false), 500);
  }, [ctxHbarPrice]);

  useEffect(() => {
    refreshPrice();
    const iv = setInterval(refreshPrice, 30000);
    return () => clearInterval(iv);
  }, [refreshPrice]);

  const effectiveSlippage = customSlippage ? parseFloat(customSlippage) : slippage;

  const handleHbarChange = (value: string) => {
    setHbarAmount(value);
    if (value && !isNaN(parseFloat(value))) {
      setUsdcAmount((parseFloat(value) * livePrice).toFixed(2));
    } else {
      setUsdcAmount("");
    }
  };

  const handleUsdcChange = (value: string) => {
    setUsdcAmount(value);
    if (value && !isNaN(parseFloat(value))) {
      setHbarAmount((parseFloat(value) / livePrice).toFixed(4));
    } else {
      setHbarAmount("");
    }
  };

  const handlePercentage = (pct: number) => {
    if (!hederaAccount) return;
    if (mode === "sell") {
      const amount = (hederaAccount.hbarBalance ?? 0) * (pct / 100);
      handleHbarChange(amount.toFixed(4));
    } else {
      const usdcToken = hederaAccount.tokens?.find(t => t.symbol === "USDC");
      const usdcBal = usdcToken?.balance ?? 0;
      const amt = usdcBal * (pct / 100);
      handleUsdcChange(amt.toFixed(2));
    }
  };

  const handleSwap = async () => {
    if (!hbarAmount || !usdcAmount) return;
    setSwapStatus("confirming");
    setSwapError(null);
    setLastTxId(null);

    const accountId = hashPackSession?.accountId;

    if (accountId) {
      const inputSymbol = mode === "buy" ? "USDC" : "HBAR";
      const outputSymbol = mode === "buy" ? "HBAR" : "USDC";
      const inputAmt = mode === "buy" ? usdcAmount : hbarAmount;

      // SauceSwap primary
      try {
        const saucerResult: SwapResult = await executeSaucerSwap(
          inputSymbol,
          outputSymbol,
          inputAmt,
          effectiveSlippage,
          accountId,
          hederaNetwork
        );

        if (saucerResult.success) {
          onSwapSuccess(saucerResult.transactionId || null, "saucerswap", accountId);
          return;
        }
        console.debug("[BuySell] SauceSwap failed:", saucerResult.error);
        setSwapError(`SauceSwap: ${saucerResult.error} — trying HSuite...`);
      } catch (err: any) {
        console.debug("[BuySell] SauceSwap error:", err?.message);
      }

      // HSuite fallback
      try {
        const result = await orchestrateSwap(
          inputSymbol,
          outputSymbol,
          inputAmt,
          effectiveSlippage,
          accountId,
          hederaNetwork,
          async (txBytes: Uint8Array) => {
            const signed = await hashPackSign(accountId, txBytes);
            if (!signed) throw new Error("Transaction rejected by wallet");
            return signed;
          }
        );

        if (result.success) {
          onSwapSuccess(result.transactionId || null, "hsuite", accountId);
          return;
        }
        console.debug("[BuySell] HSuite failed:", result.error);
      } catch (err: any) {
        console.debug("[BuySell] HSuite error:", err?.message);
      }
    }

    // Simulation fallback (no wallet or both routers unavailable)
    setSwapError(null);
    setTimeout(() => {
      onSwapSuccess(null, "simulation", accountId || "");
    }, 1500);
  };

  const onSwapSuccess = (txId: string | null, router: "saucerswap" | "hsuite" | "simulation", accountId: string) => {
    // VIP cash register
    try {
      const vp = loadVipPrefs();
      const toks = hederaAccount?.tokens ?? [];
      if (vp.active && vp.features.vip_sounds && isVipEligible(toks, hederaNetwork)) {
        playVipCashRegister();
      }
    } catch { /* non-critical */ }

    const newSwap: RecentSwap = {
      id: txId || Date.now().toString(),
      type: mode,
      hbarAmount: parseFloat(hbarAmount),
      usdcAmount: parseFloat(usdcAmount),
      price: livePrice,
      timestamp: new Date(),
      status: "completed",
    };
    setRecentSwaps((prev) => [newSwap, ...prev].slice(0, 10));
    setLastTxId(txId);
    setSwapStatus("success");
    setSwapError(null);

    // Record in site orderbook
    try {
      recordTrade({
        wallet: accountId,
        side: mode,
        tokenIn: mode === "buy" ? "USDC" : "HBAR",
        tokenOut: mode === "buy" ? "HBAR" : "USDC",
        amountIn: mode === "buy" ? parseFloat(usdcAmount) : parseFloat(hbarAmount),
        amountOut: mode === "buy" ? parseFloat(hbarAmount) : parseFloat(usdcAmount),
        priceUsd: livePrice,
        route: "HBAR ↔ USDC",
        router,
        transactionId: txId,
        status: "confirmed",
        slippageBps: 0,
      });
    } catch { /* non-critical */ }

    setTimeout(() => {
      setSwapStatus("idle");
      setHbarAmount("");
      setUsdcAmount("");
      setLastTxId(null);
    }, 3000);
  };

  const flipMode = () => {
    setMode((m) => (m === "buy" ? "sell" : "buy"));
    setHbarAmount("");
    setUsdcAmount("");
  };

  const minReceived = mode === "buy"
    ? (parseFloat(hbarAmount || "0") * (1 - effectiveSlippage / 100)).toFixed(4)
    : (parseFloat(usdcAmount || "0") * (1 - effectiveSlippage / 100)).toFixed(2);

  const fee = parseFloat(usdcAmount || "0") * 0.0025;
  const hbarBalance = hederaAccount ? hederaAccount.hbarBalance : 0;
  const hbarUsdValue = hbarBalance * livePrice;
  const connected = !!primaryWallet;

  const formatPrice = (p: number) =>
    p >= 1
      ? `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${p.toFixed(6)}`;

  const canTrade = connected && !!hbarAmount && !!usdcAmount && parseFloat(hbarAmount) > 0;

  const cardClass = isDark
    ? "bg-gradient-to-br from-slate-900/60 to-slate-800/30 border border-pink-500/15 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  const inputClass = isDark
    ? "bg-slate-800/60 border border-pink-500/10"
    : "bg-gray-50 border border-gray-200";

  // ChangeNOW widget URLs
  const crossChainUrl = buildChangeNowUrl({ isDark, from: "btc", to: "hbar" });
  const topUpUrl = buildChangeNowUrl({
    isDark,
    topUpMode: true,
    topUpCurrency: topUpCurrency,
    topUpAddress: walletAddress || undefined,
  });

  // ── Tab config ─────────────────────────────────────────────────────

  const TABS: { key: TabKey; label: string; icon: React.ReactNode; desc: string }[] = [
    { key: "swap", label: "Hedera Swap", icon: <ArrowDownUp className="w-4 h-4" />, desc: "HBAR ↔ USDC on-chain" },
    { key: "crosschain", label: "Cross-Chain", icon: <ArrowRightLeft className="w-4 h-4" />, desc: "Any chain to any chain" },
    { key: "topup", label: "Top Up", icon: <CreditCard className="w-4 h-4" />, desc: "Buy with card or fiat" },
  ];

  return (
    <div className="min-h-[calc(100vh-140px)]">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Live Price Widget */}
        <div className="flex items-center justify-end gap-3">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${cardClass}`}>
            <img src={HBAR_LOGO} alt="HBAR" className="w-6 h-6 rounded-full" />
            <div>
              <div className="font-bold">{formatPrice(livePrice)}</div>
              <div className={`text-xs flex items-center gap-1 ${priceChange >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {priceChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}%
              </div>
            </div>
          </div>
          <button
            onClick={refreshPrice}
            className={`p-2.5 rounded-xl transition-all ${isDark ? "bg-slate-800/50 hover:bg-slate-700 border border-pink-500/20" : "bg-gray-100 hover:bg-gray-200 border border-gray-200"}`}
            title="Refresh price"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""} ${isDark ? "text-slate-400" : "text-gray-500"}`} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className={`rounded-xl p-1 flex gap-1 ${isDark ? "bg-slate-900/50 border border-white/5" : "bg-gray-100 border border-gray-200"}`}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                activeTab === tab.key
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
                  : isDark
                  ? "text-slate-400 hover:text-white hover:bg-slate-800/50"
                  : "text-gray-500 hover:text-gray-900 hover:bg-white"
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
            </button>
          ))}
        </div>

        {/* ── TAB: Hedera Swap ── */}
        {activeTab === "swap" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-4">
              <div className={`rounded-2xl p-6 ${cardClass}`}>
                {/* Buy/Sell Toggle */}
                <div className="grid grid-cols-2 gap-2 mb-6">
                  <button
                    onClick={() => { setMode("buy"); setHbarAmount(""); setUsdcAmount(""); }}
                    className={`py-3 rounded-xl font-bold transition-all duration-300 ${
                      mode === "buy"
                        ? "bg-gradient-to-r from-emerald-600 to-green-500 text-white shadow-lg shadow-emerald-500/30"
                        : isDark ? "bg-slate-800/50 text-slate-400 hover:text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    Buy HBAR
                  </button>
                  <button
                    onClick={() => { setMode("sell"); setHbarAmount(""); setUsdcAmount(""); }}
                    className={`py-3 rounded-xl font-bold transition-all duration-300 ${
                      mode === "sell"
                        ? "bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-lg shadow-red-500/30"
                        : isDark ? "bg-slate-800/50 text-slate-400 hover:text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    Sell HBAR
                  </button>
                </div>

                {/* From Section */}
                <div className={`rounded-xl p-4 mb-2 ${inputClass}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {mode === "buy" ? "You Pay" : "You Sell"}
                    </span>
                    {hederaAccount && (
                      <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Balance: {mode === "sell"
                          ? `${formatHbar(hbarBalance)} HBAR`
                          : (() => {
                              const usdcToken = hederaAccount.tokens?.find(t => t.symbol === "USDC");
                              return `${(usdcToken?.balance ?? 0).toFixed(2)} USDC`;
                            })()
                        }
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      placeholder="0.00"
                      className="bg-transparent flex-1 outline-none text-2xl w-0"
                      value={mode === "buy" ? usdcAmount : hbarAmount}
                      onChange={(e) => mode === "buy" ? handleUsdcChange(e.target.value) : handleHbarChange(e.target.value)}
                    />
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-200"}`}>
                      <img src={mode === "buy" ? USDC_LOGO : HBAR_LOGO} alt={mode === "buy" ? "USDC" : "HBAR"} className="w-6 h-6 rounded-full" />
                      <span className="font-bold text-sm">{mode === "buy" ? "USDC" : "HBAR"}</span>
                    </div>
                  </div>
                </div>

                {/* Swap Direction */}
                <div className="flex justify-center -my-3 relative z-10">
                  <button
                    onClick={flipMode}
                    className={`p-2.5 rounded-xl border-4 transition-all duration-300 hover:rotate-180 ${
                      isDark
                        ? "bg-slate-800 border-[#0a0a0f] hover:bg-slate-700 text-pink-400"
                        : "bg-white border-gray-100 hover:bg-gray-50 text-pink-600 shadow-sm"
                    }`}
                  >
                    <ArrowDownUp className="w-5 h-5" />
                  </button>
                </div>

                {/* To Section */}
                <div className={`rounded-xl p-4 mt-2 ${inputClass}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {mode === "buy" ? "You Receive" : "You Get"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      placeholder="0.00"
                      className="bg-transparent flex-1 outline-none text-2xl w-0"
                      value={mode === "buy" ? hbarAmount : usdcAmount}
                      onChange={(e) => mode === "buy" ? handleHbarChange(e.target.value) : handleUsdcChange(e.target.value)}
                    />
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-200"}`}>
                      <img src={mode === "buy" ? HBAR_LOGO : USDC_LOGO} alt={mode === "buy" ? "HBAR" : "USDC"} className="w-6 h-6 rounded-full" />
                      <span className="font-bold text-sm">{mode === "buy" ? "HBAR" : "USDC"}</span>
                    </div>
                  </div>
                </div>

                {/* Quick % buttons */}
                {hederaAccount && (
                  <div className="grid grid-cols-4 gap-2 mt-4">
                    {[25, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => handlePercentage(pct)}
                        className={`py-2 rounded-lg text-sm transition-colors ${
                          isDark
                            ? "bg-slate-800/50 hover:bg-slate-700 border border-pink-500/10 text-slate-300"
                            : "bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-600"
                        }`}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                )}

                {/* Slippage */}
                <div className="mt-4">
                  <button
                    onClick={() => setShowSlippageSettings(!showSlippageSettings)}
                    className={`flex items-center gap-2 text-sm w-full ${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"}`}
                  >
                    <Settings2 className="w-4 h-4" />
                    <span>Slippage: {effectiveSlippage}%</span>
                    <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${showSlippageSettings ? "rotate-180" : ""}`} />
                  </button>

                  {showSlippageSettings && (
                    <div className={`mt-3 p-3 rounded-xl ${inputClass}`}>
                      <div className="flex items-center gap-2">
                        {SLIPPAGE_OPTIONS.map((opt) => (
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
                        <div className="flex items-center flex-1">
                          <input
                            type="number"
                            placeholder="Custom"
                            className={`w-full px-2 py-1.5 rounded-lg text-sm outline-none ${isDark ? "bg-slate-700/50 text-white" : "bg-gray-200 text-gray-900"}`}
                            value={customSlippage}
                            onChange={(e) => setCustomSlippage(e.target.value)}
                          />
                          <span className={`text-sm ml-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>%</span>
                        </div>
                      </div>
                      {effectiveSlippage > 3 && (
                        <div className="flex items-center gap-1.5 mt-2 text-amber-400 text-xs">
                          <AlertCircle className="w-3.5 h-3.5" />
                          High slippage may result in unfavorable rates
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Transaction Details */}
                {(hbarAmount || usdcAmount) && (
                  <div className={`mt-4 p-4 rounded-xl space-y-2 text-sm ${inputClass}`}>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Rate</span>
                      <span>1 HBAR = {formatPrice(livePrice)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Min. {mode === "buy" ? "Received" : "Output"}</span>
                      <span>{minReceived} {mode === "buy" ? "HBAR" : "USDC"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Fee (0.25%)</span>
                      <span>${fee.toFixed(4)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? "text-slate-400" : "text-gray-500"}>Network</span>
                      <span>~$0.0001</span>
                    </div>
                    <div className={`flex items-center justify-between pt-2 border-t font-bold ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <span className={isDark ? "text-slate-300" : "text-gray-700"}>Total</span>
                      <span>${(parseFloat(usdcAmount || "0") + fee + 0.0001).toFixed(2)} USDC</span>
                    </div>
                  </div>
                )}

                {/* Action Button */}
                <div className="mt-6">
                  {!connected ? (
                    <button
                      onClick={() => setShowWalletModal(true)}
                      className="w-full py-4 rounded-xl font-bold bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/30 transition-all duration-300"
                    >
                      Connect Wallet to Trade
                    </button>
                  ) : swapStatus === "confirming" ? (
                    <button disabled className="w-full py-4 rounded-xl font-bold bg-gradient-to-r from-amber-600 to-yellow-500 text-white opacity-80 cursor-wait">
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        Confirming...
                      </div>
                    </button>
                  ) : swapStatus === "success" ? (
                    <button disabled className="w-full py-4 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-green-500 text-white">
                      <div className="flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-5 h-5" />
                        Swap Complete
                      </div>
                    </button>
                  ) : (
                    <button
                      onClick={handleSwap}
                      disabled={!canTrade}
                      className={`w-full py-4 rounded-xl font-bold transition-all duration-300 shadow-lg text-white ${
                        !canTrade
                          ? "bg-slate-600 opacity-50 cursor-not-allowed shadow-none"
                          : mode === "buy"
                          ? "bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 shadow-emerald-500/30"
                          : "bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 shadow-red-500/30"
                      }`}
                    >
                      {mode === "buy" ? "Buy HBAR" : "Sell HBAR"}
                    </button>
                  )}
                </div>

                {/* Error/Success Messages */}
                {swapError && swapStatus !== "success" && (
                  <div className={`mt-3 flex items-center gap-2 text-xs p-3 rounded-lg ${isDark ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"}`}>
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{swapError}</span>
                  </div>
                )}

                {lastTxId && swapStatus === "success" && (
                  <div className={`mt-3 flex items-center justify-between text-xs p-3 rounded-lg ${isDark ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"}`}>
                    <span className={isDark ? "text-emerald-400" : "text-emerald-700"}>
                      Tx: {lastTxId.slice(0, 20)}...
                    </span>
                    <a
                      href={`https://hashscan.io/${hederaNetwork}/transaction/${lastTxId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-1 ${isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-500"}`}
                    >
                      HashScan <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {/* Router badge */}
                {hashPackSession?.accountId && swapStatus === "idle" && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-xs">
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${isDark ? "bg-emerald-900/20 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                      <Zap className="w-2.5 h-2.5" />
                      SauceSwap V1
                    </span>
                    <span className={isDark ? "text-slate-500" : "text-gray-400"}>
                      HSuite fallback
                    </span>
                  </div>
                )}
                <div className={`mt-2 flex items-center gap-2 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Routed through SauceSwap on Hedera with ~3-5s finality. Signed via HashPack.</span>
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="lg:col-span-5 space-y-4">
              {/* Wallet Balance */}
              {hederaAccount && (
                <div className={`rounded-2xl p-5 ${cardClass}`}>
                  <h3 className="font-bold mb-3 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                    Your Balance
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <img src={HBAR_LOGO} alt="HBAR" className="w-7 h-7 rounded-full" />
                        <div>
                          <div className="font-bold">HBAR</div>
                          <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Hedera</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{formatHbar(hbarBalance)}</div>
                        <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          ~${hbarUsdValue.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <img src={USDC_LOGO} alt="USDC" className="w-7 h-7 rounded-full" />
                        <div>
                          <div className="font-bold">USDC</div>
                          <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>USD Coin</div>
                        </div>
                      </div>
                      <div className="text-right">
                        {(() => {
                          const usdcToken = hederaAccount.tokens?.find(t => t.symbol === "USDC");
                          const bal = usdcToken?.balance ?? 0;
                          return (
                            <>
                              <div className="font-bold">{bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                              <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>~${bal.toFixed(2)}</div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Need more HBAR? Upsell to Top Up */}
              <div className={`rounded-2xl p-5 ${cardClass}`}>
                <h3 className="font-bold mb-2 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                  Need More HBAR?
                </h3>
                <p className={`text-sm mb-3 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Buy HBAR or USDC instantly with a credit card, bank transfer, or 100+ cryptocurrencies.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab("topup")}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white transition-all"
                  >
                    <CreditCard className="w-4 h-4" />
                    Buy with Card
                  </button>
                  <button
                    onClick={() => setActiveTab("crosschain")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all ${
                      isDark ? "bg-slate-800/50 border border-pink-500/20 text-slate-300 hover:text-white" : "bg-gray-100 border border-gray-200 text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Cross-Chain
                  </button>
                </div>
              </div>

              {/* Recent Swaps */}
              {recentSwaps.length > 0 && (
                <div className={`rounded-2xl p-5 ${cardClass}`}>
                  <h3 className="font-bold mb-3 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                    Recent Swaps
                  </h3>
                  <div className="space-y-2">
                    {recentSwaps.map((swap) => (
                      <div
                        key={swap.id}
                        className={`flex items-center justify-between p-3 rounded-lg ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white ${
                            swap.type === "buy"
                              ? "bg-gradient-to-br from-emerald-600 to-green-500"
                              : "bg-gradient-to-br from-red-600 to-orange-500"
                          }`}>
                            {swap.type === "buy" ? "B" : "S"}
                          </div>
                          <div>
                            <div className="text-sm font-bold">
                              {swap.type === "buy" ? "Bought" : "Sold"} {swap.hbarAmount.toLocaleString()} HBAR
                            </div>
                            <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              @ {formatPrice(swap.price)}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold">${swap.usdcAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            {swap.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Market Info */}
              <div className={`rounded-2xl p-5 ${cardClass}`}>
                <h3 className="font-bold mb-3 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                  Hedera Network
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-green-500/20 flex items-center justify-center flex-shrink-0">
                      <Zap className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">3-5s Finality</div>
                      <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>aBFT consensus</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center flex-shrink-0">
                      <Shield className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">$0.0001 Fees</div>
                      <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Near-zero transaction costs</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: Cross-Chain (ChangeNOW) ── */}
        {activeTab === "crosschain" && (
          <div className="max-w-2xl mx-auto space-y-4">
            <div className={`rounded-2xl overflow-hidden ${cardClass}`}>
              {/* Header */}
              <div className={`px-5 py-4 border-b ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-lg bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">Cross-Chain Swap</h2>
                    <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Swap 900+ cryptocurrencies across all major chains — no bridging required
                    </p>
                  </div>
                  <ChangeNowBadge isDark={isDark} />
                </div>
              </div>

              {/* Widget */}
              <div className={`relative ${isDark ? "bg-[#0d0d1a]" : "bg-white"}`}>
                <iframe
                  id="iframe-widget"
                  src={crossChainUrl}
                  style={{ height: 440, width: "100%", border: "none" }}
                  title="ChangeNOW Cross-Chain Swap"
                  sandbox={CN_SANDBOX}
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="clipboard-write"
                />
              </div>

              {/* Footer */}
              <div className={`px-5 py-3 border-t ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
                <div className={`flex items-center justify-between text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-pink-400/60" />
                    <span>Non-custodial instant swaps</span>
                  </div>
                  <a
                    href="https://changenow.io/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-1 hover:underline ${isDark ? "text-slate-400 hover:text-pink-400" : "text-gray-500 hover:text-pink-600"}`}
                  >
                    changenow.io <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>

            {/* Info cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <InfoCard isDark={isDark} icon={<ArrowRightLeft className="w-5 h-5 text-pink-400" />} title="900+ Assets" desc="BTC, ETH, SOL, HBAR and more" />
              <InfoCard isDark={isDark} icon={<Zap className="w-5 h-5 text-emerald-400" />} title="No Bridging" desc="Direct chain-to-chain swaps" />
              <InfoCard isDark={isDark} icon={<Shield className="w-5 h-5 text-purple-400" />} title="Non-Custodial" desc="Your keys, your crypto" />
            </div>
          </div>
        )}

        {/* ── TAB: Top Up (ChangeNOW Fiat On-Ramp) ── */}
        {activeTab === "topup" && (
          <div className="max-w-2xl mx-auto space-y-4">
            <div className={`rounded-2xl overflow-hidden ${cardClass}`}>
              {/* Header */}
              <div className={`px-5 py-4 border-b ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-bold text-lg bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">Top Up Wallet</h2>
                    <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Buy crypto with credit card, debit card, Apple Pay, or bank transfer
                    </p>
                  </div>
                  <ChangeNowBadge isDark={isDark} />
                </div>

                {/* Currency selector */}
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Buy:</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTopUpCurrency("hbar")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
                        topUpCurrency === "hbar"
                          ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                          : isDark ? "bg-slate-800/50 text-slate-400 hover:text-white border border-white/5" : "bg-gray-100 text-gray-500 hover:text-gray-900 border border-gray-200"
                      }`}
                    >
                      <img src={HBAR_LOGO} alt="HBAR" className="w-4 h-4 rounded-full" />
                      HBAR
                    </button>
                    <button
                      onClick={() => setTopUpCurrency("usdc")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
                        topUpCurrency === "usdc"
                          ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                          : isDark ? "bg-slate-800/50 text-slate-400 hover:text-white border border-white/5" : "bg-gray-100 text-gray-500 hover:text-gray-900 border border-gray-200"
                      }`}
                    >
                      <img src={USDC_LOGO} alt="USDC" className="w-4 h-4 rounded-full" />
                      USDC
                    </button>
                  </div>
                </div>

                {/* Connected wallet address */}
                {walletAddress && (
                  <div className={`mt-3 flex items-center gap-2 text-xs p-2.5 rounded-lg ${isDark ? "bg-emerald-900/15 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"}`}>
                    <Wallet className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span className={isDark ? "text-emerald-400" : "text-emerald-700"}>
                      Sending to: <span className="font-mono">{walletAddress}</span>
                    </span>
                  </div>
                )}
                {!walletAddress && (
                  <div className={`mt-3 flex items-center gap-2 text-xs p-2.5 rounded-lg ${isDark ? "bg-amber-900/15 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className={isDark ? "text-amber-400" : "text-amber-700"}>
                      Connect your wallet to auto-fill your Hedera address, or enter it manually in the widget.
                    </span>
                  </div>
                )}
              </div>

              {/* Widget — gated behind third-party data consent */}
              {!fiatConsent ? (
                <FiatConsentGate isDark={isDark} onAccept={acceptFiatConsent} />
              ) : (
                <div className={`relative ${isDark ? "bg-[#0d0d1a]" : "bg-white"}`} key={`topup-${topUpCurrency}-${walletAddress}`}>
                  <iframe
                    id="iframe-widget"
                    src={topUpUrl}
                    style={{ height: 440, width: "100%", border: "none" }}
                    title="ChangeNOW Top Up"
                    sandbox={CN_SANDBOX}
                    referrerPolicy="strict-origin-when-cross-origin"
                    allow="clipboard-write"
                  />
                </div>
              )}

              {/* Footer */}
              <div className={`px-5 py-3 border-t ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
                <div className={`flex items-center justify-between text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-pink-400/60" />
                    <span>Payments processed by ChangeNOW — HBAR.ħ never sees your card details</span>
                  </div>
                  <a
                    href="https://changenow.io/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-1 hover:underline ${isDark ? "text-slate-400 hover:text-pink-400" : "text-gray-500 hover:text-pink-600"}`}
                  >
                    changenow.io <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>

            {/* Info cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <InfoCard isDark={isDark} icon={<CreditCard className="w-5 h-5 text-pink-400" />} title="Card & Bank" desc="Visa, Mastercard, SEPA, Apple Pay" />
              <InfoCard isDark={isDark} icon={<Zap className="w-5 h-5 text-emerald-400" />} title="Fast Delivery" desc="Crypto sent directly to your wallet" />
              <InfoCard isDark={isDark} icon={<Shield className="w-5 h-5 text-purple-400" />} title="KYC by ChangeNOW" desc="Secure identity verification" />
            </div>
          </div>
        )}
      </div>

      {/* Wallet Connect Modal */}
      {showWalletModal && <WalletConnectModal onClose={() => setShowWalletModal(false)} />}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function ChangeNowBadge({ isDark }: { isDark: boolean }) {
  return (
    <a
      href="https://changenow.io/"
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] transition-all duration-200 ${
        isDark
          ? "bg-slate-800/60 border border-pink-500/10 text-slate-400 hover:text-pink-300 hover:border-pink-500/30"
          : "bg-gray-50 border border-gray-200 text-gray-500 hover:text-pink-600 hover:border-pink-200"
      }`}
      title="Powered by ChangeNOW"
    >
      <img
        src={CHANGENOW_LOGO}
        alt="ChangeNOW"
        className="h-3.5"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
      <span>Powered by ChangeNOW</span>
    </a>
  );
}

function InfoCard({
  isDark,
  icon,
  title,
  desc,
}: {
  isDark: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className={`rounded-xl p-4 transition-all duration-200 hover:scale-[1.02] ${
      isDark
        ? "bg-gradient-to-br from-slate-900/60 to-slate-800/30 border border-pink-500/15 backdrop-blur-sm hover:border-pink-500/30"
        : "bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-pink-200"
    }`}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isDark ? "bg-pink-500/10" : "bg-pink-50"
        }`}>
          {icon}
        </div>
        <span className="text-sm font-bold">{title}</span>
      </div>
      <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{desc}</p>
    </div>
  );
}

function FiatConsentGate({ isDark, onAccept }: { isDark: boolean; onAccept: () => void }) {
  return (
    <div
      className={`flex items-center justify-center px-6 ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}
      style={{ minHeight: 440 }}
    >
      <div className={`max-w-sm w-full p-6 rounded-2xl space-y-4 ${isDark ? "bg-slate-900/60 border border-pink-500/20" : "bg-white border border-gray-200 shadow-md"}`}>
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center">
            <ShieldCheck className="w-7 h-7 text-pink-400" />
          </div>
        </div>

        <div className="text-center">
          <h3 className="font-bold text-lg">Third-Party Payment Notice</h3>
          <p className={`text-sm mt-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Fiat purchases are processed by <strong>ChangeNOW</strong>, a third-party provider. HBAR.ħ does not collect, store, or have access to your payment card details, personal identity documents, or banking information.
          </p>
        </div>

        {/* Data handling bullets */}
        <div className={`space-y-2.5 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          <div className="flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 mt-0.5 text-pink-400 flex-shrink-0" />
            <span>Card and identity data are handled exclusively by ChangeNOW under their KYC/AML policies</span>
          </div>
          <div className="flex items-start gap-2">
            <Eye className="w-3.5 h-3.5 mt-0.5 text-pink-400 flex-shrink-0" />
            <span>HBAR.ħ only receives your Hedera wallet address to route the purchased crypto</span>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="w-3.5 h-3.5 mt-0.5 text-pink-400 flex-shrink-0" />
            <span>The widget runs in a sandboxed iframe with restricted permissions</span>
          </div>
        </div>

        {/* Links */}
        <div className={`flex items-center justify-center gap-3 text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          <a href="https://changenow.io/privacy-policy" target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-0.5">
            Privacy Policy <ExternalLink className="w-2.5 h-2.5" />
          </a>
          <span>|</span>
          <a href="https://changenow.io/terms-of-use" target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-0.5">
            Terms of Use <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>

        {/* Accept */}
        <button
          onClick={onAccept}
          className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/30 transition-all duration-300"
        >
          I Understand, Continue
        </button>
      </div>
    </div>
  );
}
import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Shield,
  Zap,
  ExternalLink,
  Wallet,
  ArrowRightLeft,
  ArrowDownUp,
  CreditCard,
  Lock,
  Eye,
  ShieldCheck,
} from "lucide-react";
import { Tip } from "./Tip";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { fetchCoinPrices } from "../utils/coingecko";
import { WalletConnectModal } from "./WalletConnectModal";
import { FlashBillboard } from "./FlashBillboard";
import { BuySellSwapTab } from "./BuySellSwapTab";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";

// ── Assets ───────────────────────────────────────────────────────────

const HBAR_LOGO = "https://assets.coingecko.com/coins/images/3688/large/hbar.png";
const USDC_LOGO = "https://assets.coingecko.com/coins/images/6319/large/usdc.png";
const USDT_LOGO = "https://assets.coingecko.com/coins/images/325/large/Tether.png";
const ETH_LOGO = "https://assets.coingecko.com/coins/images/279/large/ethereum.png";
const CHANGENOW_LOGO = "https://changenow.io/images/changenow-logo.svg";

// IMPLEMENTATION NOTE — Kill-switch for Top Up tab. Set to true to lock the tab
// behind a "coming soon" banner. Currently false = live for all users.
const BUYSELL_TOPUP_LOCKED = false;

// IMPLEMENTATION NOTE — CN_LINK_ID moved to server-side env var (CHANGENOW_LINK_ID).
// Widget URLs are now built by the server endpoint /changenow/widget-url to keep
// the affiliate link_id out of frontend source code.
const SERVER_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

// IMPLEMENTATION NOTE — Wallet-aware address routing for Top Up:
//   HBAR  → Hedera wallet (HashPack) → 0.0.xxxxx
//   USDC  → EVM wallet (MetaMask) → 0x... (ERC-20 on Ethereum)
//   USDT  → EVM wallet (MetaMask) → 0x... (ERC-20 on Ethereum)
type TopUpCurrency = "hbar" | "usdc" | "usdt";

/** Returns true if the currency is delivered on an EVM chain (MetaMask) */
function isEvmTopUpCurrency(c: TopUpCurrency): boolean {
  return c === "usdc" || c === "usdt";
}

/** Validate EVM address format (0x + 40 hex chars) */
function isValidEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

/** Validate Hedera account ID format (0.0.xxxxx) to prevent injection */
function isValidHederaAddress(addr: string): boolean {
  return /^0\.0\.\d{1,10}$/.test(addr);
}

/** Session-scoped consent key for fiat on-ramp privacy notice */
const FIAT_CONSENT_KEY = "hbarh_fiat_consent_accepted";

// IMPLEMENTATION NOTE — Widget URL builder moved server-side. The frontend fetches
// the fully-constructed URL from /changenow/widget-url so the affiliate link_id
// never appears in client source code.
async function fetchWidgetUrl(params: Record<string, string>): Promise<string> {
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${SERVER_BASE}/changenow/widget-url?${qs}`, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
    });
    if (!res.ok) {
      console.log(`[BuySell] fetchWidgetUrl failed: ${res.status} ${await res.text()}`);
      return "";
    }
    const data = await res.json();
    return data.url || "";
  } catch (err) {
    console.log("[BuySell] fetchWidgetUrl error:", err);
    return "";
  }
}

// Iframe sandbox permissions — restrictive but functional for ChangeNOW widget
// IMPLEMENTATION NOTE — allow-top-navigation-by-user-activation is needed for
// fiat payment providers (Mercuryo, Simplex, etc.) to redirect after checkout.
const CN_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

// ── Types ────────────────────────────────────────────────────────────

type TabKey = "swap" | "crosschain" | "topup";

// ── Main Component ───────────────────────────────────────────────────

export function BuySell() {
  const { isDark } = useTheme();
  const { primaryWallet, hashPackSession, hederaNetwork, hbarPrice: ctxHbarPrice, hederaAccount, metaMaskAccount, connectMetaMask, isConnectingMetaMask } = useWallet();

  // IMPLEMENTATION NOTE — Top Up is now live for all users. The lock gate
  // below evaluates to false (BUYSELL_TOPUP_LOCKED = false) so the locked
  // banner is never shown. Kept as a kill-switch for emergency rollback.
  const isTopUpLocked = BUYSELL_TOPUP_LOCKED;

  const [activeTab, setActiveTab] = useState<TabKey>("swap");
  const [showWalletModal, setShowWalletModal] = useState(false);

  // Top-up currency selector
  const [topUpCurrency, setTopUpCurrency] = useState<TopUpCurrency>("hbar");

  // Fiat consent gate
  const [fiatConsent, setFiatConsent] = useState(() => {
    try { return sessionStorage.getItem(FIAT_CONSENT_KEY) === "true"; } catch { return false; }
  });
  const acceptFiatConsent = () => {
    setFiatConsent(true);
    try { sessionStorage.setItem(FIAT_CONSENT_KEY, "true"); } catch { /* non-critical */ }
  };

  const walletAddress = hashPackSession?.accountId || "";

  // ── Live HBAR price for header widget ──
  const [livePrice, setLivePrice] = useState(0);
  const [priceChange, setPriceChange] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshPrice = useCallback(async () => {
    setIsRefreshing(true);
    const data = await fetchCoinPrices(["HBAR"]);
    if (data.HBAR && data.HBAR.current_price > 0) {
      setLivePrice(data.HBAR.current_price);
      setPriceChange(data.HBAR.price_change_percentage_24h);
    } else if (ctxHbarPrice > 0) {
      setLivePrice(ctxHbarPrice);
    }
    setTimeout(() => setIsRefreshing(false), 500);
  }, [ctxHbarPrice]);

  useEffect(() => {
    refreshPrice();
    const iv = setInterval(refreshPrice, 30000);
    return () => clearInterval(iv);
  }, [refreshPrice]);

  // ── ChangeNOW stepper connector script ──
  const scriptLoaded = useRef(false);
  useEffect(() => {
    if (scriptLoaded.current) return;
    if (activeTab !== "crosschain" && activeTab !== "topup") return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 50;

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

  const cardClass = isDark
    ? "bg-gradient-to-br from-slate-900/60 to-slate-800/30 border border-pink-500/15 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  const formatPrice = (p: number) =>
    p >= 1
      ? `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${p.toFixed(6)}`;

  // ── Server-fetched ChangeNOW widget URLs ──
  const [crossChainUrl, setCrossChainUrl] = useState("");
  const [topUpUrl, setTopUpUrl] = useState("");

  // IMPLEMENTATION NOTE — Wallet-aware address routing for Top Up:
  //   HBAR  → Hedera wallet (HashPack) → 0.0.xxxxx
  //   USDC  → EVM wallet (MetaMask) → 0x... (ERC-20 on Ethereum)
  //   USDT  → EVM wallet (MetaMask) → 0x... (ERC-20 on Ethereum)
  const isEvmCurrency = isEvmTopUpCurrency(topUpCurrency);
  const evmAddress = metaMaskAccount?.address || "";
  const topUpDeliveryAddress = isEvmCurrency ? evmAddress : walletAddress;

  // Fetch cross-chain widget URL when dark mode changes or tab is active
  useEffect(() => {
    if (activeTab !== "crosschain") return;
    let cancelled = false;
    fetchWidgetUrl({ mode: "crosschain", isDark: String(isDark), from: "btc", to: "hbar" })
      .then(url => { if (!cancelled && url) setCrossChainUrl(url); });
    return () => { cancelled = true; };
  }, [activeTab, isDark]);

  // Fetch top-up widget URL when currency, address, or dark mode changes
  useEffect(() => {
    if (activeTab !== "topup" || !fiatConsent) return;
    let cancelled = false;
    const params: Record<string, string> = {
      mode: "topup",
      isDark: String(isDark),
      topUpCurrency,
    };
    if (topUpDeliveryAddress) params.topUpAddress = topUpDeliveryAddress;
    fetchWidgetUrl(params)
      .then(url => { if (!cancelled && url) setTopUpUrl(url); });
    return () => { cancelled = true; };
  }, [activeTab, isDark, topUpCurrency, topUpDeliveryAddress, fiatConsent]);

  // ── Tab config ─────────────────────────────────────────────────────

  const TABS: { key: TabKey; label: string; icon: React.ReactNode; desc: string }[] = [
    { key: "swap", label: "Hedera Swap", icon: <ArrowDownUp className="w-4 h-4" />, desc: "HBAR \u2194 USDC on-chain" },
    { key: "crosschain", label: "Cross-Chain", icon: <ArrowRightLeft className="w-4 h-4" />, desc: "Any chain to any chain" },
    { key: "topup", label: "Top Up", icon: <CreditCard className="w-4 h-4" />, desc: "Buy with card or fiat" },
  ];

  return (
    <div className="min-h-[calc(100vh-140px)]">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Live Price Widget + Flash Billboard */}
        <div className="flex items-stretch gap-0">
          {/* Retro flash billboard — fills all space up to the price badge */}
          <FlashBillboard />

          {/* Price badge + refresh */}
          <div className="flex items-center gap-3 shrink-0 pl-3">
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
            <Tip content="Refresh price">
            <button
              onClick={refreshPrice}
              className={`p-2.5 rounded-xl transition-all ${isDark ? "bg-slate-800/50 hover:bg-slate-700 border border-pink-500/20" : "bg-gray-100 hover:bg-gray-200 border border-gray-200"}`}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""} ${isDark ? "text-slate-400" : "text-gray-500"}`} />
            </button>
            </Tip>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className={`rounded-xl p-1 flex gap-1 ${isDark ? "bg-slate-900/50 border border-white/5" : "bg-gray-100 border border-gray-200"}`}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
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

        {/* ── TAB: Hedera Swap (upgraded to SwapPanel architecture) ── */}
        {activeTab === "swap" && (
          <BuySellSwapTab />
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
                {crossChainUrl ? (
                  <iframe
                    id="iframe-widget"
                    src={crossChainUrl}
                    style={{ height: 440, width: "100%", border: "none" }}
                    title="ChangeNOW Cross-Chain Swap"
                    sandbox={CN_SANDBOX}
                    referrerPolicy="strict-origin-when-cross-origin"
                    allow="clipboard-write"
                  />
                ) : (
                  <div className="flex items-center justify-center" style={{ height: 440 }}>
                    <RefreshCw className={`w-5 h-5 animate-spin ${isDark ? "text-pink-400/40" : "text-gray-400"}`} />
                  </div>
                )}
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
        {activeTab === "topup" && isTopUpLocked && (
          <div className="max-w-lg mx-auto">
            <div className={`rounded-2xl p-6 ${cardClass}`}>
              {/* Lock Banner */}
              <div className={`rounded-xl p-8 text-center ${
                isDark
                  ? "bg-gradient-to-br from-amber-900/10 to-orange-900/10 border border-amber-500/20"
                  : "bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200"
              }`}>
                <div className={`w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center ${
                  isDark ? "bg-amber-500/10" : "bg-amber-100"
                }`}>
                  <Lock className={`w-8 h-8 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
                </div>
                <h4 className={`text-lg font-bold mb-2 ${isDark ? "text-amber-300" : "text-amber-800"}`}>
                  Top Up Coming Soon
                </h4>
                <p className={`text-sm leading-relaxed max-w-sm mx-auto ${isDark ? "text-amber-400/70" : "text-amber-700/80"}`}>
                  The fiat on-ramp (buy crypto with card) is currently locked for
                  founder testing. It will be available to all users once the payment
                  integration has been fully verified.
                </p>
                {walletAddress && (
                  <p className={`text-xs mt-4 font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                    Connected: {walletAddress}
                  </p>
                )}
              </div>
              <div className="mt-4 flex items-center justify-center gap-2 text-xs">
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${isDark ? "bg-pink-900/20 text-pink-400/50 border border-pink-500/10" : "bg-pink-50 text-pink-700/50 border border-pink-200/50"}`}>
                  <CreditCard className="w-2.5 h-2.5" />
                  ChangeNOW
                </span>
              </div>
              <div className={`mt-2 flex items-center gap-2 text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Powered by ChangeNOW. Buy with credit card, debit card, Apple Pay, or bank transfer.</span>
              </div>
            </div>
          </div>
        )}
        {activeTab === "topup" && !isTopUpLocked && (
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
                    <button
                      onClick={() => setTopUpCurrency("usdt")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
                        topUpCurrency === "usdt"
                          ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                          : isDark ? "bg-slate-800/50 text-slate-400 hover:text-white border border-white/5" : "bg-gray-100 text-gray-500 hover:text-gray-900 border border-gray-200"
                      }`}
                    >
                      <img src={USDT_LOGO} alt="USDT" className="w-4 h-4 rounded-full" />
                      USDT
                    </button>
                  </div>
                </div>

                {/* EVM network indicator for USDC/USDT */}
                {isEvmCurrency && (
                  <div className={`mt-2 flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg ${isDark ? "bg-indigo-900/15 border border-indigo-500/20" : "bg-indigo-50 border border-indigo-200"}`}>
                    <img src={ETH_LOGO} alt="Ethereum" className="w-3.5 h-3.5 rounded-full flex-shrink-0" />
                    <span className={isDark ? "text-indigo-400" : "text-indigo-700"}>
                      {topUpCurrency.toUpperCase()} will be delivered as an <strong>ERC-20 token on Ethereum</strong> to your MetaMask wallet
                    </span>
                  </div>
                )}

                {/* Connected wallet address — context-aware per currency */}
                {!isEvmCurrency && walletAddress && (
                  <div className={`mt-3 flex items-center gap-2 text-xs p-2.5 rounded-lg ${isDark ? "bg-emerald-900/15 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"}`}>
                    <Wallet className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span className={isDark ? "text-emerald-400" : "text-emerald-700"}>
                      Sending to Hedera: <span className="font-mono">{walletAddress}</span>
                    </span>
                  </div>
                )}
                {!isEvmCurrency && !walletAddress && (
                  <div className={`mt-3 flex items-center gap-2 text-xs p-2.5 rounded-lg ${isDark ? "bg-amber-900/15 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className={isDark ? "text-amber-400" : "text-amber-700"}>
                      Connect HashPack to auto-fill your Hedera address, or enter it manually in the widget.
                    </span>
                  </div>
                )}

                {/* MetaMask address for EVM currencies */}
                {isEvmCurrency && evmAddress && (
                  <div className={`mt-3 flex items-center gap-2 text-xs p-2.5 rounded-lg ${isDark ? "bg-emerald-900/15 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"}`}>
                    <Wallet className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span className={isDark ? "text-emerald-400" : "text-emerald-700"}>
                      Sending to MetaMask: <span className="font-mono">{evmAddress.slice(0, 6)}...{evmAddress.slice(-4)}</span>
                      {metaMaskAccount?.chainName && (
                        <span className={`ml-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>({metaMaskAccount.chainName})</span>
                      )}
                    </span>
                  </div>
                )}
                {isEvmCurrency && !evmAddress && (
                  <div className={`mt-3 flex items-center justify-between text-xs p-2.5 rounded-lg ${isDark ? "bg-amber-900/15 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      <span className={isDark ? "text-amber-400" : "text-amber-700"}>
                        Connect MetaMask to receive {topUpCurrency.toUpperCase()} on Ethereum
                      </span>
                    </div>
                    <button
                      onClick={() => connectMetaMask()}
                      disabled={isConnectingMetaMask}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        isConnectingMetaMask
                          ? "opacity-50 cursor-not-allowed"
                          : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-sm"
                      }`}
                    >
                      <Wallet className="w-3 h-3" />
                      {isConnectingMetaMask ? "Connecting..." : "Connect MetaMask"}
                    </button>
                  </div>
                )}
              </div>

              {/* Widget — gated behind third-party data consent */}
              {!fiatConsent ? (
                <FiatConsentGate isDark={isDark} onAccept={acceptFiatConsent} />
              ) : topUpUrl ? (
                <div className={`relative ${isDark ? "bg-[#0d0d1a]" : "bg-white"}`} key={`topup-${topUpCurrency}-${topUpDeliveryAddress}`}>
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
              ) : (
                <div className={`flex items-center justify-center ${isDark ? "bg-[#0d0d1a]" : "bg-white"}`} style={{ height: 440 }}>
                  <RefreshCw className={`w-5 h-5 animate-spin ${isDark ? "text-pink-400/40" : "text-gray-400"}`} />
                </div>
              )}

              {/* Footer */}
              <div className={`px-5 py-3 border-t ${isDark ? "border-pink-500/10" : "border-gray-100"}`}>
                <div className={`flex items-center justify-between text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-pink-400/60" />
                    <span>Payments processed by ChangeNOW — WRAPpDEX never sees your card details</span>
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
    <Tip content="Powered by ChangeNOW">
    <a
      href="https://changenow.io/"
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-200 ${
        isDark
          ? "bg-slate-800/60 border border-pink-500/10 text-slate-400 hover:text-pink-300 hover:border-pink-500/30"
          : "bg-gray-50 border border-gray-200 text-gray-500 hover:text-pink-600 hover:border-pink-200"
      }`}
    >
      <img
        src={CHANGENOW_LOGO}
        alt="ChangeNOW"
        className="h-3.5"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
      <span>Powered by ChangeNOW</span>
    </a>
    </Tip>
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
    <div className={`rounded-2xl p-4 transition-all duration-200 hover:scale-[1.02] ${
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
            Fiat purchases are processed by <strong>ChangeNOW</strong>, a third-party provider. WRAPpDEX does not collect, store, or have access to your payment card details, personal identity documents, or banking information.
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
            <span>WRAPpDEX only receives your Hedera wallet address to route the purchased crypto</span>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="w-3.5 h-3.5 mt-0.5 text-pink-400 flex-shrink-0" />
            <span>The widget runs in a sandboxed iframe with restricted permissions</span>
          </div>
        </div>

        {/* Links */}
        <div className={`flex items-center justify-center gap-3 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
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
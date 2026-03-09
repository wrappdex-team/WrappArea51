/**
 * CrossChainExchange — Native cross-chain swap UI (glass-morphism).
 *
 * Redirects to ChangeNOW with pre-filled parameters via partner link;
 * no API key required for the basic flow. Exchange rates estimated
 * from Binance/CoinGecko.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Search,
  ExternalLink,
  ArrowRight,
  Shield,
  Zap,
  ArrowRightLeft,
  Clock,
  RefreshCw,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { fetchCoinPrices, type CoinPrice } from "../utils/coingecko";
import { Tip } from "./Tip";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { getSessionToken } from "../utils/auth";

// ── ChangeNOW Partner Config ─────────────────────────────────────────

// IMPLEMENTATION NOTE — CN_LINK_ID moved to server-side env var (CHANGENOW_LINK_ID).
// Redirect URLs are now built by the server endpoint /changenow/redirect-url to keep
// the affiliate link_id out of frontend source code.
const SERVER_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

async function fetchRedirectUrl(params: Record<string, string>): Promise<string | null> {
  try {
    const qs = new URLSearchParams(params).toString();
    const headers: Record<string, string> = { Authorization: `Bearer ${publicAnonKey}` };
    const sessionToken = getSessionToken();
    if (sessionToken) headers["X-Session-Token"] = sessionToken;
    const res = await fetch(`${SERVER_BASE}/changenow/redirect-url?${qs}`, { headers });
    if (!res.ok) {
      console.error(`[CrossChainExchange] redirect-url fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    return data.url || null;
  } catch (err) {
    console.error("[CrossChainExchange] redirect-url fetch error:", err);
    return null;
  }
}

// ── Token definitions (cross-chain) ──────────────────────────────────

interface CrossChainToken {
  symbol: string;
  name: string;
  network: string;
  logo: string;
  coingeckoId: string;
}

const CROSS_CHAIN_TOKENS: CrossChainToken[] = [
  { symbol: "BTC", name: "Bitcoin", network: "Bitcoin", logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png", coingeckoId: "bitcoin" },
  { symbol: "ETH", name: "Ethereum", network: "Ethereum", logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png", coingeckoId: "ethereum" },
  { symbol: "SOL", name: "Solana", network: "Solana", logo: "https://assets.coingecko.com/coins/images/4128/large/solana.png", coingeckoId: "solana" },
  { symbol: "HBAR", name: "Hedera", network: "Hedera", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png", coingeckoId: "hedera-hashgraph" },
  { symbol: "XRP", name: "Ripple", network: "Ripple", logo: "https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png", coingeckoId: "ripple" },
  { symbol: "USDT", name: "Tether", network: "Ethereum", logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png", coingeckoId: "tether" },
  { symbol: "USDC", name: "USD Coin", network: "Ethereum", logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png", coingeckoId: "usd-coin" },
  { symbol: "BNB", name: "BNB", network: "BSC", logo: "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png", coingeckoId: "binancecoin" },
  { symbol: "DOGE", name: "Dogecoin", network: "Dogecoin", logo: "https://assets.coingecko.com/coins/images/5/large/dogecoin.png", coingeckoId: "dogecoin" },
  { symbol: "ADA", name: "Cardano", network: "Cardano", logo: "https://assets.coingecko.com/coins/images/975/large/cardano.png", coingeckoId: "cardano" },
  { symbol: "AVAX", name: "Avalanche", network: "Avalanche", logo: "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png", coingeckoId: "avalanche-2" },
  { symbol: "DOT", name: "Polkadot", network: "Polkadot", logo: "https://assets.coingecko.com/coins/images/12171/large/polkadot.png", coingeckoId: "polkadot" },
  { symbol: "MATIC", name: "Polygon", network: "Polygon", logo: "https://assets.coingecko.com/coins/images/4713/large/polygon.png", coingeckoId: "matic-network" },
  { symbol: "LTC", name: "Litecoin", network: "Litecoin", logo: "https://assets.coingecko.com/coins/images/2/large/litecoin.png", coingeckoId: "litecoin" },
];

// ── Component ────────────────────────────────────────────────────────

export function CrossChainExchange() {
  const { isDark } = useTheme();
  const { hashPackSession } = useWallet();
  const walletAddress = hashPackSession?.accountId || "";

  // Token state — default BTC → HBAR
  const [fromToken, setFromToken] = useState<CrossChainToken>(CROSS_CHAIN_TOKENS[0]); // BTC
  const [toToken, setToToken] = useState<CrossChainToken>(CROSS_CHAIN_TOKENS[3]); // HBAR
  const [amount, setAmount] = useState("0.1");
  const [recipientAddress, setRecipientAddress] = useState("");

  // Prices & rates
  const [prices, setPrices] = useState<Record<string, CoinPrice>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  // UI
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showToSelector, setShowToSelector] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");

  // Auto-fill wallet address for HBAR destination
  useEffect(() => {
    if (toToken.symbol === "HBAR" && walletAddress && !recipientAddress) {
      setRecipientAddress(walletAddress);
    }
  }, [toToken.symbol, walletAddress, recipientAddress]);

  // Fetch prices for all tokens
  const fetchPrices = useCallback(async () => {
    setPriceLoading(true);
    try {
      const symbols = CROSS_CHAIN_TOKENS.map(t => t.symbol);
      const data = await fetchCoinPrices(symbols);
      setPrices(data);
    } catch { /* silent */ }
    setPriceLoading(false);
  }, []);

  useEffect(() => {
    fetchPrices();
    const iv = setInterval(fetchPrices, 45000);
    return () => clearInterval(iv);
  }, [fetchPrices]);

  // Calculate estimated output
  const estimatedOutput = useMemo(() => {
    const fromPrice = prices[fromToken.symbol]?.current_price || 0;
    const toPrice = prices[toToken.symbol]?.current_price || 0;
    const amt = parseFloat(amount) || 0;
    if (!fromPrice || !toPrice || !amt) return null;
    const raw = (amt * fromPrice) / toPrice;
    // Apply ~0.5% fee estimate (ChangeNOW typical spread)
    return raw * 0.995;
  }, [amount, fromToken.symbol, toToken.symbol, prices]);

  const exchangeRate = useMemo(() => {
    const fromPrice = prices[fromToken.symbol]?.current_price || 0;
    const toPrice = prices[toToken.symbol]?.current_price || 0;
    if (!fromPrice || !toPrice) return null;
    return (fromPrice / toPrice) * 0.995;
  }, [fromToken.symbol, toToken.symbol, prices]);

  const inputUsd = useMemo(() => {
    const fromPrice = prices[fromToken.symbol]?.current_price || 0;
    return (parseFloat(amount) || 0) * fromPrice;
  }, [amount, fromToken.symbol, prices]);

  // Flip tokens
  const flipTokens = useCallback(() => {
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
    setRecipientAddress("");
  }, [fromToken, toToken]);

  // Token select handler
  const handleSelectToken = useCallback((token: CrossChainToken, isFrom: boolean) => {
    if (isFrom) {
      if (token.symbol === toToken.symbol) setToToken(fromToken);
      setFromToken(token);
    } else {
      if (token.symbol === fromToken.symbol) setFromToken(toToken);
      setToToken(token);
      if (token.symbol === "HBAR" && walletAddress) setRecipientAddress(walletAddress);
      else setRecipientAddress("");
    }
    setShowFromSelector(false);
    setShowToSelector(false);
    setTokenSearch("");
  }, [fromToken, toToken, walletAddress]);

  // Copy address
  const handleCopyAddress = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  }, [walletAddress]);

  // Open ChangeNOW exchange
  const handleExchange = useCallback(async () => {
    const params: Record<string, string> = {
      mode: "exchange",
      from: fromToken.symbol,
      to: toToken.symbol,
      amount: amount || "0.1",
    };
    const addr = toToken.symbol === "HBAR" ? (recipientAddress || walletAddress) : "";
    if (addr) params.address = addr;

    const url = await fetchRedirectUrl(params);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      // IMPLEMENTATION NOTE — Surface error to user instead of silent failure
      alert("Unable to connect to ChangeNOW. Please try again in a moment.");
    }
  }, [fromToken.symbol, toToken.symbol, amount, recipientAddress, walletAddress]);

  const canExchange = parseFloat(amount) > 0;

  // ── Style tokens ──
  const cardClass = isDark
    ? "bg-gradient-to-br from-slate-900/60 to-slate-800/30 border border-pink-500/15 backdrop-blur-xl"
    : "bg-white border border-gray-200 shadow-sm";
  const inputClass = isDark
    ? "bg-slate-800/60 border border-slate-700/30"
    : "bg-gray-50 border border-gray-200";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const mutedFaint = isDark ? "text-slate-500" : "text-gray-400";

  // ── Token Selector ──
  const TokenSelector = ({ isOpen, onClose, onSelect, excludeSymbol }: {
    isOpen: boolean; onClose: () => void; onSelect: (t: CrossChainToken) => void; excludeSymbol: string;
  }) => {
    if (!isOpen) return null;
    const filtered = CROSS_CHAIN_TOKENS
      .filter(t => t.symbol !== excludeSymbol)
      .filter(t =>
        !tokenSearch ||
        t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
        t.name.toLowerCase().includes(tokenSearch.toLowerCase()) ||
        t.network.toLowerCase().includes(tokenSearch.toLowerCase())
      );
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
        <div
          role="listbox"
          aria-label="Select token"
          className={`absolute top-full right-0 mt-2 w-72 rounded-xl shadow-2xl overflow-hidden z-50 ${
            isDark ? "bg-slate-900 border border-pink-500/20" : "bg-white border border-gray-200"
          }`}
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
          <div className="max-h-64 overflow-y-auto px-2 pb-2">
            {filtered.map(t => (
              <button key={t.symbol} onClick={() => onSelect(t)}
                role="option" aria-selected={false}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                  isDark ? "hover:bg-slate-800/60" : "hover:bg-gray-100"
                }`}>
                <img src={t.logo} alt={t.symbol} className="w-7 h-7 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{t.symbol}</div>
                  <div className={`text-xs truncate ${mutedFaint}`}>{t.name} &middot; {t.network}</div>
                </div>
                {prices[t.symbol]?.current_price ? (
                  <span className={`text-xs font-mono ${muted}`}>
                    ${prices[t.symbol].current_price >= 1
                      ? prices[t.symbol].current_price.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : prices[t.symbol].current_price.toFixed(6)
                    }
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </>
    );
  };

  // ── Format helpers ──
  const fmtOutput = (n: number) => n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toFixed(8);
  const fmtRate = (n: number) => n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toFixed(8);

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl overflow-hidden ${cardClass}`}>
        {/* ── Header ── */}
        <div className={`px-5 py-4 border-b ${isDark ? "border-white/5" : "border-gray-100"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-lg bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                Cross-Chain Exchange
              </h2>
              <p className={`text-xs mt-0.5 ${muted}`}>
                Swap 900+ cryptocurrencies &mdash; no bridging required
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Tip content="Refresh rates">
                <button
                  onClick={fetchPrices}
                  className={`p-2 rounded-lg transition-all ${isDark ? "hover:bg-slate-800/60 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${priceLoading ? "animate-spin" : ""}`} />
                </button>
              </Tip>
              <a
                href="https://changenow.io/"
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium tracking-wide uppercase transition-all ${
                  isDark
                    ? "bg-slate-800/40 border border-white/5 text-slate-500 hover:text-pink-400 hover:border-pink-500/20"
                    : "bg-gray-50 border border-gray-200 text-gray-400 hover:text-pink-600 hover:border-pink-200"
                }`}
              >
                <span>via ChangeNOW</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>
        </div>

        {/* ── Exchange Form ── */}
        <div className="p-5 space-y-3">
          {/* You Send */}
          <div className={`rounded-xl p-4 ${inputClass}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-medium ${muted}`}>You Send</span>
              {inputUsd > 0 && (
                <span className={`text-xs ${mutedFaint}`}>
                  ~${inputUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                placeholder="0.0"
                aria-label="Amount to send"
                className="bg-transparent flex-1 outline-none text-2xl font-semibold min-w-0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
              <div className="relative shrink-0">
                <button
                  onClick={() => { setShowFromSelector(!showFromSelector); setShowToSelector(false); setTokenSearch(""); }}
                  aria-label={`Select source token, currently ${fromToken.symbol}`}
                  aria-haspopup="listbox"
                  aria-expanded={showFromSelector}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                    isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"
                  }`}
                >
                  <img src={fromToken.logo} alt={fromToken.symbol} className="w-6 h-6 rounded-full shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <span className="font-bold text-sm">{fromToken.symbol}</span>
                  <ChevronDown className={`w-4 h-4 shrink-0 ${muted}`} />
                </button>
                <TokenSelector
                  isOpen={showFromSelector}
                  onClose={() => { setShowFromSelector(false); setTokenSearch(""); }}
                  onSelect={t => handleSelectToken(t, true)}
                  excludeSymbol={toToken.symbol}
                />
              </div>
            </div>
            <div className={`text-xs mt-1 ${mutedFaint}`}>{fromToken.network} network</div>
          </div>

          {/* Swap direction + rate pill */}
          <div className="flex items-center justify-center gap-3 -my-1">
            <div className={`flex-1 h-px ${isDark ? "bg-white/5" : "bg-gray-100"}`} />
            <button
              onClick={flipTokens}
              aria-label="Swap input and output tokens"
              className={`p-2.5 rounded-xl border-4 transition-all duration-300 hover:rotate-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                isDark
                  ? "bg-slate-800 border-slate-900/80 hover:bg-slate-700 text-pink-400"
                  : "bg-white border-gray-100 hover:bg-gray-50 text-pink-600 shadow-sm"
              }`}
            >
              <ArrowDownUp className="w-5 h-5" />
            </button>
            {exchangeRate && (
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                isDark ? "bg-slate-800/40 border border-white/5 text-slate-400" : "bg-gray-50 border border-gray-200 text-gray-500"
              }`}>
                <span>1 {fromToken.symbol}</span>
                <ArrowRight className="w-2.5 h-2.5" />
                <span>~{fmtRate(exchangeRate)} {toToken.symbol}</span>
              </div>
            )}
            <div className={`flex-1 h-px ${isDark ? "bg-white/5" : "bg-gray-100"}`} />
          </div>

          {/* You Receive */}
          <div className={`rounded-xl p-4 ${inputClass}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-medium ${muted}`}>You Receive (estimated)</span>
              {estimatedOutput && (
                <span className={`text-xs ${mutedFaint}`}>
                  ~${((estimatedOutput || 0) * (prices[toToken.symbol]?.current_price || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className={`flex-1 text-2xl font-semibold min-w-0 truncate ${estimatedOutput ? "" : mutedFaint}`}>
                {estimatedOutput ? fmtOutput(estimatedOutput) : "0.0"}
              </div>
              <div className="relative shrink-0">
                <button
                  onClick={() => { setShowToSelector(!showToSelector); setShowFromSelector(false); setTokenSearch(""); }}
                  aria-label={`Select destination token, currently ${toToken.symbol}`}
                  aria-haspopup="listbox"
                  aria-expanded={showToSelector}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                    isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"
                  }`}
                >
                  <img src={toToken.logo} alt={toToken.symbol} className="w-6 h-6 rounded-full shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <span className="font-bold text-sm">{toToken.symbol}</span>
                  <ChevronDown className={`w-4 h-4 shrink-0 ${muted}`} />
                </button>
                <TokenSelector
                  isOpen={showToSelector}
                  onClose={() => { setShowToSelector(false); setTokenSearch(""); }}
                  onSelect={t => handleSelectToken(t, false)}
                  excludeSymbol={fromToken.symbol}
                />
              </div>
            </div>
            <div className={`text-xs mt-1 ${mutedFaint}`}>{toToken.network} network</div>
          </div>

          {/* Recipient address (for HBAR destination) */}
          {toToken.symbol === "HBAR" && (
            <div className={`rounded-xl p-3 ${inputClass}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs font-medium ${muted}`}>Recipient HBAR Address</span>
                {walletAddress && (
                  <Tip content={copiedAddress ? "Copied!" : "Copy wallet address"}>
                    <button
                      onClick={handleCopyAddress}
                      className={`p-1 rounded transition-colors ${isDark ? "hover:bg-slate-700 text-slate-500" : "hover:bg-gray-200 text-gray-400"}`}
                    >
                      {copiedAddress ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </Tip>
                )}
              </div>
              <input
                type="text"
                placeholder="0.0.xxxxx"
                aria-label="Recipient HBAR address"
                className={`bg-transparent w-full outline-none text-sm font-mono ${recipientAddress ? "" : mutedFaint}`}
                value={recipientAddress}
                onChange={e => setRecipientAddress(e.target.value)}
              />
              {walletAddress && recipientAddress === walletAddress && (
                <div className={`flex items-center gap-1.5 mt-1.5 text-xs ${isDark ? "text-emerald-400/80" : "text-emerald-600"}`}>
                  <Shield className="w-2.5 h-2.5" />
                  <span>Connected wallet auto-filled</span>
                </div>
              )}
            </div>
          )}

          {/* Exchange details */}
          {estimatedOutput && parseFloat(amount) > 0 && (
            <div className={`rounded-xl p-3 space-y-2 text-sm ${inputClass}`}>
              <div className="flex items-center justify-between">
                <span className={muted}>Estimated Rate</span>
                <span className="font-mono text-xs">
                  1 {fromToken.symbol} &asymp; {fmtRate(exchangeRate || 0)} {toToken.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className={muted}>Network Fee</span>
                <span className={`text-xs ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                  Included in rate
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className={muted}>Estimated Time</span>
                <span className={`text-xs flex items-center gap-1 ${mutedFaint}`}>
                  <Clock className="w-3 h-3" />
                  5-30 min
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className={muted}>Service</span>
                <span className={`text-xs ${mutedFaint}`}>ChangeNOW (non-custodial)</span>
              </div>
            </div>
          )}

          {/* Exchange button */}
          <button
            onClick={handleExchange}
            disabled={!canExchange}
            className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-300 shadow-lg ${
              canExchange
                ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-pink-500/25 active:scale-[0.98]"
                : isDark
                ? "bg-slate-700 text-slate-500 shadow-none cursor-not-allowed"
                : "bg-gray-300 text-gray-500 shadow-none cursor-not-allowed"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              {canExchange
                ? `Exchange ${fromToken.symbol} to ${toToken.symbol}`
                : "Enter an amount"
              }
            </div>
          </button>

          {/* Info line */}
          <div className={`flex items-center justify-center gap-2 text-xs ${mutedFaint}`}>
            <Shield className="w-3 h-3" />
            <span>Non-custodial exchange &middot; No registration required</span>
          </div>

          {/* Rate disclaimer */}
          {estimatedOutput && (
            <div className={`flex items-start gap-2 text-xs p-2.5 rounded-lg ${
              isDark ? "bg-amber-900/10 border border-amber-500/10 text-amber-400/70" : "bg-amber-50 border border-amber-100 text-amber-600/70"
            }`}>
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                Rate is approximate and may vary slightly at time of exchange. Final rate is determined by ChangeNOW at execution.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Feature Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FeatureCard
          isDark={isDark}
          icon={<ArrowRightLeft className="w-5 h-5 text-pink-400" />}
          title="900+ Assets"
          desc="BTC, ETH, SOL, HBAR and more"
        />
        <FeatureCard
          isDark={isDark}
          icon={<Zap className="w-5 h-5 text-emerald-400" />}
          title="No Bridging"
          desc="Direct chain-to-chain swaps"
        />
        <FeatureCard
          isDark={isDark}
          icon={<Shield className="w-5 h-5 text-purple-400" />}
          title="Non-Custodial"
          desc="Your keys, your crypto"
        />
      </div>
    </div>
  );
}

// ── Sub-component ────────────────────────────────────────────────────

function FeatureCard({ isDark, icon, title, desc }: {
  isDark: boolean; icon: React.ReactNode; title: string; desc: string;
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
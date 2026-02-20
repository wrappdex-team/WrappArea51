/**
 * FiatTopUp — Native fiat on-ramp UI (glass-morphism).
 *
 * User selects currency + amount, clicks "Buy" → opens ChangeNOW's fiat
 * purchase flow in a new tab with pre-filled partner redirect parameters.
 * No API key required.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  CreditCard,
  Shield,
  Zap,
  ExternalLink,
  Wallet,
  AlertCircle,
  DollarSign,
  ChevronDown,
  Check,
  Copy,
  Lock,
  Smartphone,
  Landmark,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { fetchCoinPrices, type CoinPrice } from "../utils/coingecko";
import { Tip } from "./Tip";

// ── ChangeNOW Partner Config ─────────────────────────────────────────

const CN_LINK_ID = "4de8efb2ccff7a";

function buildFiatRedirectUrl(opts: {
  fiatCurrency: string;
  cryptoCurrency: string;
  amount: string;
  address?: string;
}) {
  const params = new URLSearchParams({
    from: opts.fiatCurrency.toLowerCase(),
    to: opts.cryptoCurrency.toLowerCase(),
    amount: opts.amount || "100",
    link_id: CN_LINK_ID,
    fiatMode: "true",
  });
  if (opts.address) params.set("address", opts.address);
  return `https://changenow.io/exchange?${params.toString()}`;
}

// ── Supported fiat currencies ────────────────────────────────────────

interface FiatCurrency {
  code: string;
  name: string;
  symbol: string;
  flag: string;
}

const FIAT_CURRENCIES: FiatCurrency[] = [
  { code: "USD", name: "US Dollar", symbol: "$", flag: "US" },
  { code: "EUR", name: "Euro", symbol: "\u20AC", flag: "EU" },
  { code: "GBP", name: "British Pound", symbol: "\u00A3", flag: "GB" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", flag: "CA" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", flag: "AU" },
  { code: "CHF", name: "Swiss Franc", symbol: "Fr", flag: "CH" },
];

// ── Crypto targets ───────────────────────────────────────────────────

interface CryptoTarget {
  symbol: string;
  name: string;
  logo: string;
  network: string;
}

const CRYPTO_TARGETS: CryptoTarget[] = [
  { symbol: "HBAR", name: "Hedera", logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png", network: "Hedera" },
  { symbol: "USDC", name: "USD Coin", logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png", network: "Hedera" },
  { symbol: "BTC", name: "Bitcoin", logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png", network: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum", logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png", network: "Ethereum" },
];

// ── Quick amount presets ─────────────────────────────────────────────

const AMOUNT_PRESETS = [50, 100, 250, 500, 1000];

// ── Component ────────────────────────────────────────────────────────

export function FiatTopUp() {
  const { isDark } = useTheme();
  const { hashPackSession } = useWallet();
  const walletAddress = hashPackSession?.accountId || "";

  // State
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrency>(FIAT_CURRENCIES[0]);
  const [cryptoTarget, setCryptoTarget] = useState<CryptoTarget>(CRYPTO_TARGETS[0]);
  const [amount, setAmount] = useState("100");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [copiedAddress, setCopiedAddress] = useState(false);

  // UI
  const [showFiatSelector, setShowFiatSelector] = useState(false);
  const [showCryptoSelector, setShowCryptoSelector] = useState(false);

  // Prices
  const [prices, setPrices] = useState<Record<string, CoinPrice>>({});

  // Auto-fill wallet address for HBAR
  useEffect(() => {
    if ((cryptoTarget.symbol === "HBAR" || cryptoTarget.symbol === "USDC") && walletAddress && !recipientAddress) {
      setRecipientAddress(walletAddress);
    }
  }, [cryptoTarget.symbol, walletAddress, recipientAddress]);

  // Fetch prices
  const fetchPrices = useCallback(async () => {
    try {
      const symbols = CRYPTO_TARGETS.map(t => t.symbol);
      const data = await fetchCoinPrices(symbols);
      setPrices(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchPrices();
    const iv = setInterval(fetchPrices, 45000);
    return () => clearInterval(iv);
  }, [fetchPrices]);

  // Estimate crypto amount
  const estimatedCrypto = useMemo(() => {
    const price = prices[cryptoTarget.symbol]?.current_price || 0;
    const amt = parseFloat(amount) || 0;
    if (!price || !amt) return null;
    // ~3% fee for fiat on-ramp (typical for card purchases)
    return (amt * 0.97) / price;
  }, [amount, cryptoTarget.symbol, prices]);

  // Copy address
  const handleCopyAddress = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  }, [walletAddress]);

  // Open ChangeNOW fiat purchase
  const handleBuy = useCallback(() => {
    const url = buildFiatRedirectUrl({
      fiatCurrency: fiatCurrency.code,
      cryptoCurrency: cryptoTarget.symbol,
      amount: amount || "100",
      address: (cryptoTarget.symbol === "HBAR" || cryptoTarget.symbol === "USDC")
        ? (recipientAddress || walletAddress || undefined)
        : undefined,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  }, [fiatCurrency.code, cryptoTarget.symbol, amount, recipientAddress, walletAddress]);

  const canBuy = parseFloat(amount) > 0;

  // ── Style tokens ──
  const cardClass = isDark
    ? "bg-gradient-to-br from-slate-900/60 to-slate-800/30 border border-pink-500/15 backdrop-blur-xl"
    : "bg-white border border-gray-200 shadow-sm";
  const inputClass = isDark
    ? "bg-slate-800/60 border border-slate-700/30"
    : "bg-gray-50 border border-gray-200";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const mutedFaint = isDark ? "text-slate-500" : "text-gray-400";

  const fmtCrypto = (n: number) => n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toFixed(8);

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl overflow-hidden ${cardClass}`}>
        {/* ── Header ── */}
        <div className={`px-5 py-4 border-b ${isDark ? "border-white/5" : "border-gray-100"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-lg bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                Buy Crypto
              </h2>
              <p className={`text-xs mt-0.5 ${muted}`}>
                Purchase with credit card, bank transfer, or Apple Pay
              </p>
            </div>
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

          {/* Connected wallet address */}
          {walletAddress && (cryptoTarget.symbol === "HBAR" || cryptoTarget.symbol === "USDC") && (
            <div className={`mt-3 flex items-center gap-2 text-xs p-2.5 rounded-lg ${
              isDark ? "bg-emerald-900/15 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"
            }`}>
              <Wallet className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              <span className={isDark ? "text-emerald-400" : "text-emerald-700"}>
                Sending to: <span className="font-mono">{walletAddress}</span>
              </span>
              <Tip content={copiedAddress ? "Copied!" : "Copy"}>
                <button onClick={handleCopyAddress} className="ml-auto p-0.5">
                  {copiedAddress ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-emerald-400/50" />}
                </button>
              </Tip>
            </div>
          )}
          {!walletAddress && (cryptoTarget.symbol === "HBAR" || cryptoTarget.symbol === "USDC") && (
            <div className={`mt-3 flex items-center gap-2 text-xs p-2.5 rounded-lg ${
              isDark ? "bg-amber-900/15 border border-amber-500/20" : "bg-amber-50 border border-amber-200"
            }`}>
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span className={isDark ? "text-amber-400" : "text-amber-700"}>
                Connect your wallet to auto-fill your Hedera address
              </span>
            </div>
          )}
        </div>

        {/* ── Purchase Form ── */}
        <div className="p-5 space-y-3">
          {/* You Pay (fiat) */}
          <div className={`rounded-xl p-4 ${inputClass}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-medium ${muted}`}>You Pay</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className={`text-2xl font-semibold ${muted}`}>{fiatCurrency.symbol}</span>
              </div>
              <input
                type="number"
                placeholder="100"
                aria-label="Amount to pay in fiat"
                className="bg-transparent flex-1 outline-none text-2xl font-semibold min-w-0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
              <div className="relative shrink-0">
                <button
                  onClick={() => { setShowFiatSelector(!showFiatSelector); setShowCryptoSelector(false); }}
                  aria-label={`Select fiat currency, currently ${fiatCurrency.code}`}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                    isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"
                  }`}
                >
                  <span className="font-bold text-sm">{fiatCurrency.code}</span>
                  <ChevronDown className={`w-4 h-4 shrink-0 ${muted}`} />
                </button>
                {showFiatSelector && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowFiatSelector(false)} aria-hidden="true" />
                    <div className={`absolute top-full right-0 mt-2 w-56 rounded-xl shadow-2xl overflow-hidden z-50 ${
                      isDark ? "bg-slate-900 border border-pink-500/20" : "bg-white border border-gray-200"
                    }`}>
                      <div className="py-1">
                        {FIAT_CURRENCIES.map(fc => (
                          <button key={fc.code}
                            onClick={() => { setFiatCurrency(fc); setShowFiatSelector(false); }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              fc.code === fiatCurrency.code
                                ? isDark ? "bg-pink-500/10 text-pink-400" : "bg-pink-50 text-pink-600"
                                : isDark ? "hover:bg-slate-800/60" : "hover:bg-gray-100"
                            }`}
                          >
                            <span className="text-sm font-bold w-10">{fc.symbol}</span>
                            <div className="flex-1">
                              <div className="text-sm font-semibold">{fc.code}</div>
                              <div className={`text-xs ${mutedFaint}`}>{fc.name}</div>
                            </div>
                            {fc.code === fiatCurrency.code && <Check className="w-3.5 h-3.5 text-pink-400" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick amount presets */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {AMOUNT_PRESETS.map(preset => (
              <button
                key={preset}
                onClick={() => setAmount(preset.toString())}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  amount === preset.toString()
                    ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                    : isDark
                    ? "bg-slate-800/40 border border-white/5 text-slate-400 hover:text-white hover:border-pink-500/20"
                    : "bg-gray-100 border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-pink-200"
                }`}
              >
                {fiatCurrency.symbol}{preset}
              </button>
            ))}
          </div>

          {/* You Receive (crypto) */}
          <div className={`rounded-xl p-4 ${inputClass}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-medium ${muted}`}>You Receive (estimated)</span>
            </div>
            <div className="flex items-center gap-3">
              <div className={`flex-1 text-2xl font-semibold min-w-0 truncate ${estimatedCrypto ? "" : mutedFaint}`}>
                {estimatedCrypto ? fmtCrypto(estimatedCrypto) : "0.0"}
              </div>
              <div className="relative shrink-0">
                <button
                  onClick={() => { setShowCryptoSelector(!showCryptoSelector); setShowFiatSelector(false); }}
                  aria-label={`Select crypto to buy, currently ${cryptoTarget.symbol}`}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                    isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"
                  }`}
                >
                  <img src={cryptoTarget.logo} alt={cryptoTarget.symbol} className="w-6 h-6 rounded-full shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <span className="font-bold text-sm">{cryptoTarget.symbol}</span>
                  <ChevronDown className={`w-4 h-4 shrink-0 ${muted}`} />
                </button>
                {showCryptoSelector && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowCryptoSelector(false)} aria-hidden="true" />
                    <div className={`absolute top-full right-0 mt-2 w-60 rounded-xl shadow-2xl overflow-hidden z-50 ${
                      isDark ? "bg-slate-900 border border-pink-500/20" : "bg-white border border-gray-200"
                    }`}>
                      <div className="py-1">
                        {CRYPTO_TARGETS.map(ct => (
                          <button key={ct.symbol}
                            onClick={() => {
                              setCryptoTarget(ct);
                              setShowCryptoSelector(false);
                              if ((ct.symbol === "HBAR" || ct.symbol === "USDC") && walletAddress) setRecipientAddress(walletAddress);
                              else setRecipientAddress("");
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              ct.symbol === cryptoTarget.symbol
                                ? isDark ? "bg-pink-500/10 text-pink-400" : "bg-pink-50 text-pink-600"
                                : isDark ? "hover:bg-slate-800/60" : "hover:bg-gray-100"
                            }`}
                          >
                            <img src={ct.logo} alt={ct.symbol} className="w-6 h-6 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            <div className="flex-1">
                              <div className="text-sm font-semibold">{ct.symbol}</div>
                              <div className={`text-xs ${mutedFaint}`}>{ct.name} &middot; {ct.network}</div>
                            </div>
                            {prices[ct.symbol]?.current_price ? (
                              <span className={`text-xs font-mono ${mutedFaint}`}>
                                ${prices[ct.symbol].current_price >= 1
                                  ? prices[ct.symbol].current_price.toLocaleString(undefined, { maximumFractionDigits: 2 })
                                  : prices[ct.symbol].current_price.toFixed(6)
                                }
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className={`text-xs mt-1 ${mutedFaint}`}>{cryptoTarget.network} network</div>
          </div>

          {/* Recipient address */}
          {(cryptoTarget.symbol === "HBAR" || cryptoTarget.symbol === "USDC") && (
            <div className={`rounded-xl p-3 ${inputClass}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs font-medium ${muted}`}>Delivery Address</span>
              </div>
              <input
                type="text"
                placeholder="0.0.xxxxx"
                aria-label="Delivery address"
                className={`bg-transparent w-full outline-none text-sm font-mono ${recipientAddress ? "" : mutedFaint}`}
                value={recipientAddress}
                onChange={e => setRecipientAddress(e.target.value)}
              />
            </div>
          )}

          {/* Buy button */}
          <button
            onClick={handleBuy}
            disabled={!canBuy}
            className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-300 shadow-lg ${
              canBuy
                ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-pink-500/25 active:scale-[0.98]"
                : isDark
                ? "bg-slate-700 text-slate-500 shadow-none cursor-not-allowed"
                : "bg-gray-300 text-gray-500 shadow-none cursor-not-allowed"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <CreditCard className="w-4 h-4" />
              {canBuy
                ? `Buy ${cryptoTarget.symbol} with ${fiatCurrency.code}`
                : "Enter an amount"
              }
            </div>
          </button>

          {/* Payment methods */}
          <div className={`flex items-center justify-center gap-4 py-1 text-xs ${mutedFaint}`}>
            <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> Visa / Mastercard</span>
            <span className="flex items-center gap-1"><Smartphone className="w-3 h-3" /> Apple Pay</span>
            <span className="flex items-center gap-1"><Landmark className="w-3 h-3" /> SEPA / Bank</span>
          </div>

          {/* Privacy notice */}
          <div className={`flex items-start gap-2 text-xs p-2.5 rounded-lg ${
            isDark ? "bg-slate-800/30 border border-white/5 text-slate-500" : "bg-gray-50 border border-gray-100 text-gray-400"
          }`}>
            <Lock className="w-3 h-3 mt-0.5 shrink-0 text-pink-400/60" />
            <span>
              Payments processed by ChangeNOW. Wrappdex never sees your card details or personal information. KYC verification handled by ChangeNOW.
            </span>
          </div>
        </div>
      </div>

      {/* ── Feature Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FeatureCard
          isDark={isDark}
          icon={<CreditCard className="w-5 h-5 text-pink-400" />}
          title="Card & Bank"
          desc="Visa, Mastercard, SEPA, Apple Pay"
        />
        <FeatureCard
          isDark={isDark}
          icon={<Zap className="w-5 h-5 text-emerald-400" />}
          title="Fast Delivery"
          desc="Crypto sent directly to your wallet"
        />
        <FeatureCard
          isDark={isDark}
          icon={<Shield className="w-5 h-5 text-purple-400" />}
          title="Secure KYC"
          desc="Identity verification by ChangeNOW"
        />
      </div>
    </div>
  );
}

// ── Sub-component ───────���────────────────────────────────────────────

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
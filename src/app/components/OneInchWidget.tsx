/**
 * OneInchWidget — Full native 1inch DEX Aggregator swap interface.
 *
 * Uses the 1inch Swap API v6.0 via server-side proxy (avoids CORS +
 * keeps API key secure). Connects EVM wallets via window.ethereum
 * (MetaMask, Rabby, etc.) with zero ethers/web3 static imports.
 *
 * ⚠️ DEVELOPER NOTE — API Key Required:
 *   Set ONEINCH_API_KEY in Supabase Edge Function secrets.
 *   Get a free key at: https://portal.1inch.dev/
 *
 * Features:
 *   - 6-chain support (Ethereum, Polygon, BSC, Arbitrum, Optimism, Base)
 *   - Live quotes from 1inch aggregation engine (400+ DEX sources)
 *   - Token approval + swap execution via MetaMask/EVM wallet
 *   - Auto-refresh quotes, gas estimates, rate display
 *   - VIP sound effects, Motion animations, glass-morphism styling
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import { log } from "../utils/logger";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowDownUp,
  ChevronDown,
  Search,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Shield,
  Zap,
  Wallet,
  RefreshCw,
  Settings2,
  ArrowRight,
  Key,
  Sparkles,
  Globe,
  Lock,
} from "lucide-react";
import { Tip } from "./Tip";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import {
  playVipCashRegister,
  playVipConfirm,
  playVipButtonChime,
  playConnectionSuccess,
} from "../utils/sounds";
import { METAMASK_LOGO, ONEINCH_LOGO } from "../assets/brand";
import { usePartneredLogos } from "../contexts/PartneredLogosContext";
import { projectId, publicAnonKey } from "/utils/supabase/info";

// ── Types ────────────────────────────────────────────────────────────

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on?: (event: string, handler: (...args: any[]) => void) => void;
      removeListener?: (event: string, handler: (...args: any[]) => void) => void;
    };
  }
}

interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  isNative?: boolean;
}

interface QuoteResult {
  dstAmount: string;
  srcToken: { address: string; symbol: string; decimals: number };
  dstToken: { address: string; symbol: string; decimals: number };
  gas?: number;
  cached?: boolean;
}

// ┌─────────────────────────────────────────────────────────────────────┐
// │  IMPLEMENTATION NOTE — 1INCH TESTING LOCK                          │
// │  The 1inch swap widget is locked to ONLY the founder's Hedera      │
// │  account (0.0.518487) until end-to-end swap flow has been          │
// │  smoke-tested on a live deployment. Non-matching users see a       │
// │  locked banner.                                                    │
// │                                                                    │
// │  TO GO LIVE: set ONEINCH_TEST_LOCKED = false                       │
// └─────────────────────────────────────────────────────────────────────┘
const ONEINCH_TEST_LOCKED = true;
const ONEINCH_ALLOWED_ACCOUNT = "0.0.518487";

// ── Chain configuration ──────────────────────────────────────────────

interface ChainConfig {
  id: number;
  name: string;
  icon: string;
  hexId: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  explorerUrl: string;
  gradient: string;
}

const CHAINS: ChainConfig[] = [
  {
    id: 1, name: "Ethereum", icon: "⟠", hexId: "0x1",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://eth.llamarpc.com", explorerUrl: "https://etherscan.io",
    gradient: "from-blue-500/20 to-indigo-500/20",
  },
  {
    id: 137, name: "Polygon", icon: "⬡", hexId: "0x89",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrl: "https://polygon-rpc.com", explorerUrl: "https://polygonscan.com",
    gradient: "from-purple-500/20 to-violet-500/20",
  },
  {
    id: 56, name: "BSC", icon: "◆", hexId: "0x38",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrl: "https://bsc-dataseed1.binance.org", explorerUrl: "https://bscscan.com",
    gradient: "from-yellow-500/20 to-amber-500/20",
  },
  {
    id: 42161, name: "Arbitrum", icon: "◈", hexId: "0xa4b1",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://arb1.arbitrum.io/rpc", explorerUrl: "https://arbiscan.io",
    gradient: "from-blue-400/20 to-cyan-400/20",
  },
  {
    id: 10, name: "Optimism", icon: "⊕", hexId: "0xa",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://mainnet.optimism.io", explorerUrl: "https://optimistic.etherscan.io",
    gradient: "from-red-500/20 to-rose-500/20",
  },
  {
    id: 8453, name: "Base", icon: "◉", hexId: "0x2105",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://mainnet.base.org", explorerUrl: "https://basescan.org",
    gradient: "from-blue-500/20 to-sky-400/20",
  },
];

// ── Popular tokens per chain ─────────────────────────────────────────

const NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const POPULAR_TOKENS: Record<number, TokenInfo[]> = {
  1: [
    { address: NATIVE_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, isNative: true, logoURI: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png" },
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png" },
    { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png" },
    { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", name: "Dai", decimals: 18, logoURI: "https://tokens.1inch.io/0x6b175474e89094c44da98b954eedeac495271d0f.png" },
    { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, logoURI: "https://tokens.1inch.io/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.png" },
    { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png" },
    { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", symbol: "LINK", name: "Chainlink", decimals: 18, logoURI: "https://tokens.1inch.io/0x514910771af9ca656af840dff83e8264ecf986ca.png" },
    { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", symbol: "UNI", name: "Uniswap", decimals: 18, logoURI: "https://tokens.1inch.io/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984.png" },
    { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", symbol: "AAVE", name: "Aave", decimals: 18, logoURI: "https://tokens.1inch.io/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9.png" },
  ],
  137: [
    { address: NATIVE_ADDRESS, symbol: "POL", name: "POL", decimals: 18, isNative: true, logoURI: "https://tokens.1inch.io/0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0.png" },
    { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png" },
    { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png" },
    { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", symbol: "WETH", name: "Wrapped Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png" },
    { address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, logoURI: "https://tokens.1inch.io/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.png" },
  ],
  56: [
    { address: NATIVE_ADDRESS, symbol: "BNB", name: "BNB", decimals: 18, isNative: true, logoURI: "https://tokens.1inch.io/0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c.png" },
    { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", name: "USD Coin", decimals: 18, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png" },
    { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "Tether USD", decimals: 18, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png" },
    { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", symbol: "ETH", name: "Ethereum", decimals: 18, logoURI: "https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png" },
  ],
  42161: [
    { address: NATIVE_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, isNative: true, logoURI: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png" },
    { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png" },
    { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png" },
    { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, logoURI: "https://tokens.1inch.io/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.png" },
    { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", symbol: "ARB", name: "Arbitrum", decimals: 18, logoURI: "https://tokens.1inch.io/0x912ce59144191c1204e64559fe8253a0e49e6548.png" },
  ],
  10: [
    { address: NATIVE_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, isNative: true, logoURI: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png" },
    { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png" },
    { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://tokens.1inch.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png" },
    { address: "0x4200000000000000000000000000000000000042", symbol: "OP", name: "Optimism", decimals: 18, logoURI: "https://tokens.1inch.io/0x4200000000000000000000000000000000000042_1.png" },
  ],
  8453: [
    { address: NATIVE_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, isNative: true, logoURI: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png" },
    { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png" },
    { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI", name: "Dai", decimals: 18, logoURI: "https://tokens.1inch.io/0x6b175474e89094c44da98b954eedeac495271d0f.png" },
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18, logoURI: "https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png" },
  ],
};

// ── API helpers ──────────────────────────────────────────────────────

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${publicAnonKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `API error ${res.status}`);
  return data;
}

function formatTokenAmount(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const str = raw.padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals);
  const trimmed = frac.replace(/0+$/, "");
  const display = trimmed ? `${whole}.${trimmed.slice(0, 8)}` : whole;
  return parseFloat(display).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

function toWei(amount: string, decimals: number): string {
  if (!amount || parseFloat(amount) === 0) return "0";
  const [whole = "0", frac = ""] = amount.split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  const raw = whole + paddedFrac;
  return raw.replace(/^0+/, "") || "0";
}

// ── Component ────────────────────────────────────────────────────────

// ── Extracted Token Selector (stable identity — prevents scroll reset) ──

interface TokenSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (t: TokenInfo) => void;
  excludeAddr: string;
  tokenSearch: string;
  setTokenSearch: (v: string) => void;
  tokens: TokenInfo[];
  mergedTokens: TokenInfo[];
  allTokensCount: number;
  tokensLoading: boolean;
  isDark: boolean;
  inputClass: string;
}

const TokenSelectorDropdown = memo(function TokenSelectorDropdown({
  isOpen, onClose, onSelect, excludeAddr,
  tokenSearch, setTokenSearch, tokens, mergedTokens,
  allTokensCount, tokensLoading, isDark, inputClass,
}: TokenSelectorProps) {
  if (!isOpen) return null;
  const search = tokenSearch.toLowerCase().trim();
  const isAddrSearch = search.startsWith("0x") && search.length > 6;
  const source = search ? mergedTokens : tokens;
  const filtered = source
    .filter(t => t.address !== excludeAddr)
    .filter(t => !search ||
      t.symbol.toLowerCase().includes(search) ||
      t.name.toLowerCase().includes(search) ||
      (isAddrSearch && t.address.toLowerCase().includes(search))
    )
    .slice(0, 50);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className={`absolute top-full right-0 mt-2 w-72 rounded-2xl shadow-2xl overflow-hidden z-50 ${
          isDark
            ? "bg-slate-900 border border-pink-500/20 shadow-pink-500/5"
            : "bg-white border border-gray-200 shadow-lg"
        }`}
      >
        <div className="p-3">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${inputClass}`}>
            <Search className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
            <input type="text" placeholder={allTokensCount ? `Search ${allTokensCount.toLocaleString()} tokens...` : "Search tokens..."} autoFocus
              className="bg-transparent flex-1 outline-none text-sm"
              value={tokenSearch} onChange={e => setTokenSearch(e.target.value)} />
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto px-2 pb-2">
          {filtered.map(t => (
            <button key={t.address} onClick={() => onSelect(t)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left group ${
                isDark ? "hover:bg-pink-500/10" : "hover:bg-pink-50"
              }`}>
              {t.logoURI ? (
                <img src={t.logoURI} alt={t.symbol} className="w-7 h-7 rounded-full ring-2 ring-transparent group-hover:ring-pink-500/30 transition-all"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-xs text-white font-bold">
                  {t.symbol[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">{t.symbol}</div>
                <div className={`text-xs truncate ${isDark ? "text-slate-500" : "text-gray-400"}`}>{t.name}</div>
              </div>
              {t.isNative && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  isDark ? "bg-pink-500/10 text-pink-400 border border-pink-500/20" : "bg-pink-50 text-pink-600 border border-pink-200"
                }`}>
                  Native
                </span>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className={`text-center py-6 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {tokensLoading ? "Loading tokens..." : search ? "No tokens found" : "Type to search all tokens"}
            </div>
          )}
        </div>
      </div>
    </>
  );
});

export function OneInchWidget() {
  const { isDark } = useTheme();
  const partnerLogos = usePartneredLogos();
  const { hashPackSession } = useWallet();

  // ── Test Lock Gate (derived — evaluated after all hooks below) ──
  const connectedHederaAccount = hashPackSession?.accountId ?? "";
  const isAllowedTester = connectedHederaAccount === ONEINCH_ALLOWED_ACCOUNT;
  const isLocked = ONEINCH_TEST_LOCKED && !isAllowedTester;

  // ── Wallet state ──
  const [evmAccount, setEvmAccount] = useState<string | null>(null);
  const [evmChainId, setEvmChainId] = useState<number | null>(null);
  const [walletConnecting, setWalletConnecting] = useState(false);

  // ── Chain/token state ──
  const [selectedChainId, setSelectedChainId] = useState(1);
  const [showChainMenu, setShowChainMenu] = useState(false);
  const [fromToken, setFromToken] = useState<TokenInfo>(POPULAR_TOKENS[1][0]);
  const [toToken, setToToken] = useState<TokenInfo>(POPULAR_TOKENS[1][1]);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");

  // ── Token selector ──
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showToSelector, setShowToSelector] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");
  const [allTokens, setAllTokens] = useState<TokenInfo[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);

  // ── Quote state ──
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [lastQuote, setLastQuote] = useState<QuoteResult | null>(null);
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);

  // ── Swap state ──
  const [swapStatus, setSwapStatus] = useState<"idle" | "approving" | "swapping" | "success" | "error">("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  // ── Settings ──
  const [slippage, setSlippage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);

  // ── Balance state ──
  const [fromBalance, setFromBalance] = useState<string | null>(null);

  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useMemo(() => CHAINS.find(c => c.id === selectedChainId) || CHAINS[0], [selectedChainId]);
  const tokens = useMemo(() => POPULAR_TOKENS[selectedChainId] || POPULAR_TOKENS[1], [selectedChainId]);

  // Merged token list: popular first, then all fetched tokens (de-duped)
  const mergedTokens = useMemo(() => {
    const popularAddrs = new Set(tokens.map(t => t.address.toLowerCase()));
    const extra = allTokens.filter(t => !popularAddrs.has(t.address.toLowerCase()));
    return [...tokens, ...extra];
  }, [tokens, allTokens]);

  // ── Style tokens (matching SaucerSwap section) ──
  const cardClass = isDark
    ? "bg-[#0c0f1a]/95 backdrop-blur-2xl border border-white/[0.04]"
    : "bg-white/95 backdrop-blur-2xl border border-gray-200 shadow-xl";
  const inputClass = isDark
    ? "bg-slate-800/60 border border-slate-700/30"
    : "bg-gray-50 border border-gray-200";

  // ── Wallet connection (window.ethereum — no ethers/web3) ──────────

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setSwapError("No EVM wallet detected. Install MetaMask or Rabby.");
      return;
    }
    setWalletConnecting(true);
    playVipButtonChime();
    try {
      const accounts: string[] = await Promise.race([
        window.ethereum.request({ method: "eth_requestAccounts" }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Wallet did not respond in time. Close any pending popups and try again.")), 90_000)
        ),
      ]);
      if (accounts[0]) {
        setEvmAccount(accounts[0]);
        playConnectionSuccess();
      }
      const chainHex: string = await window.ethereum.request({ method: "eth_chainId" });
      setEvmChainId(parseInt(chainHex, 16));
    } catch (err: any) {
      log.error("1inch", "Wallet connect error", err);
      if (!err?.message?.includes("User rejected")) {
        setSwapError(err?.message || "Failed to connect wallet");
      }
    }
    setWalletConnecting(false);
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;
    const handleAccounts = (accounts: string[]) => {
      setEvmAccount(accounts[0] || null);
      setFromBalance(null);
    };
    const handleChain = (chainHex: string) => {
      setEvmChainId(parseInt(chainHex, 16));
      setFromBalance(null);
    };
    eth.on("accountsChanged", handleAccounts);
    eth.on("chainChanged", handleChain);
    return () => {
      eth.removeListener?.("accountsChanged", handleAccounts);
      eth.removeListener?.("chainChanged", handleChain);
    };
  }, []);

  // Auto-detect existing connection
  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.request({ method: "eth_accounts" }).then((accounts: string[]) => {
      if (accounts[0]) {
        setEvmAccount(accounts[0]);
        window.ethereum!.request({ method: "eth_chainId" }).then((hex: string) => {
          setEvmChainId(parseInt(hex, 16));
        });
      }
    }).catch(() => {});
  }, []);

  // Switch chain
  const switchChain = useCallback(async (targetChain: ChainConfig) => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChain.hexId }],
      });
    } catch (err: any) {
      if (err?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: targetChain.hexId,
              chainName: targetChain.name,
              nativeCurrency: targetChain.nativeCurrency,
              rpcUrls: [targetChain.rpcUrl],
              blockExplorerUrls: [targetChain.explorerUrl],
            }],
          });
        } catch { /* user rejected */ }
      }
    }
  }, []);

  // ── Fetch balance ──────────────────────────────────────────────────

  const fetchBalance = useCallback(async () => {
    if (!evmAccount || !window.ethereum) return;
    try {
      if (fromToken.isNative) {
        const balHex: string = await window.ethereum.request({
          method: "eth_getBalance",
          params: [evmAccount, "latest"],
        });
        const balWei = BigInt(balHex);
        const whole = balWei / BigInt(10 ** 18);
        const frac = balWei % BigInt(10 ** 18);
        const fracStr = frac.toString().padStart(18, "0").slice(0, 6);
        setFromBalance(`${whole}.${fracStr}`);
      } else {
        const data = "0x70a08231" + evmAccount.slice(2).padStart(64, "0");
        const result: string = await window.ethereum.request({
          method: "eth_call",
          params: [{ to: fromToken.address, data }, "latest"],
        });
        if (result && result !== "0x") {
          setFromBalance(formatTokenAmount(BigInt(result).toString(), fromToken.decimals));
        } else {
          setFromBalance("0");
        }
      }
    } catch {
      setFromBalance(null);
    }
  }, [evmAccount, fromToken]);

  useEffect(() => {
    if (evmAccount && evmChainId === selectedChainId) fetchBalance();
    else setFromBalance(null);
  }, [evmAccount, evmChainId, selectedChainId, fromToken, fetchBalance]);

  // ── Fetch full token list for current chain ─────────────────────────

  useEffect(() => {
    let cancelled = false;
    setAllTokens([]);
    setTokensLoading(true);
    apiGet(`/1inch/tokens/${selectedChainId}`)
      .then((data) => {
        if (cancelled || !data?.tokens) return;
        const list: TokenInfo[] = Object.values(data.tokens).map((t: any) => ({
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          logoURI: t.logoURI,
          isNative: t.address?.toLowerCase() === NATIVE_ADDRESS.toLowerCase(),
        }));
        // Sort alphabetically by symbol
        list.sort((a, b) => a.symbol.localeCompare(b.symbol));
        setAllTokens(list);
      })
      .catch((err) => {
        log.warn("1inch", "Token list fetch failed", err);
      })
      .finally(() => {
        if (!cancelled) setTokensLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedChainId]);

  // ── Chain selection ────────────────────────────────────────────────

  const handleChainSelect = useCallback((c: ChainConfig) => {
    setSelectedChainId(c.id);
    setShowChainMenu(false);
    const chainTokens = POPULAR_TOKENS[c.id] || POPULAR_TOKENS[1];
    setFromToken(chainTokens[0]);
    setToToken(chainTokens[1] || chainTokens[0]);
    setFromAmount("");
    setToAmount("");
    setLastQuote(null);
    setQuoteError(null);
    setSwapStatus("idle");
    setSwapError(null);
    playVipButtonChime();
    if (evmAccount) switchChain(c);
  }, [evmAccount, switchChain]);

  // ── Token selection ────────────────────────────────────────────────

  const handleSelectToken = useCallback((token: TokenInfo, isFrom: boolean) => {
    if (isFrom) {
      if (token.address === toToken.address) setToToken(fromToken);
      setFromToken(token);
    } else {
      if (token.address === fromToken.address) setFromToken(toToken);
      setToToken(token);
    }
    setShowFromSelector(false);
    setShowToSelector(false);
    setTokenSearch("");
    setToAmount("");
    setLastQuote(null);
    playVipButtonChime();
  }, [fromToken, toToken]);

  const flipTokens = useCallback(() => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
    setLastQuote(null);
    setFromBalance(null);
    playVipButtonChime();
  }, [fromToken, toToken, fromAmount, toAmount]);

  // ── Fetch quote ────────────────────────────────────────────────────

  const fetchQuote = useCallback(async (amount: string) => {
    if (!amount || parseFloat(amount) <= 0) {
      setToAmount("");
      setLastQuote(null);
      setQuoteError(null);
      return;
    }
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const amountWei = toWei(amount, fromToken.decimals);
      if (amountWei === "0") { setToAmount(""); setQuoteLoading(false); return; }

      const params = new URLSearchParams({
        src: fromToken.address, dst: toToken.address,
        amount: amountWei, includeGas: "true",
      });

      const data = await apiGet(`/1inch/quote/${selectedChainId}?${params.toString()}`);

      if (data.configured === false) {
        setApiConfigured(false);
        setQuoteError(null);
        setQuoteLoading(false);
        return;
      }
      setApiConfigured(true);
      if (data.dstAmount) {
        setToAmount(formatTokenAmount(data.dstAmount, toToken.decimals));
        setLastQuote(data);
      } else if (data.error) {
        setQuoteError(data.details || data.error);
      }
    } catch (err: any) {
      const msg = err?.message || "Quote failed";
      if (msg.includes("not configured")) setApiConfigured(false);
      else setQuoteError(msg);
    }
    setQuoteLoading(false);
  }, [fromToken, toToken, selectedChainId]);

  // Debounced quote
  useEffect(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount(""); setLastQuote(null); return;
    }
    quoteTimer.current = setTimeout(() => fetchQuote(fromAmount), 500);
    return () => { if (quoteTimer.current) clearTimeout(quoteTimer.current); };
  }, [fromAmount, fromToken.address, toToken.address, selectedChainId, fetchQuote]);

  // ── Execute swap ───────────────────────────────────────────────────

  const handleSwap = useCallback(async () => {
    if (!evmAccount || !window.ethereum || !fromAmount || parseFloat(fromAmount) <= 0) return;
    if (evmChainId !== selectedChainId) { await switchChain(chain); return; }

    playVipCashRegister();
    setSwapStatus("swapping");
    setSwapError(null);
    setLastTxHash(null);

    try {
      const amountWei = toWei(fromAmount, fromToken.decimals);

      // For non-native tokens, check approval first
      if (!fromToken.isNative) {
        setSwapStatus("approving");
        const allowanceData = await apiGet(
          `/1inch/allowance/${selectedChainId}?tokenAddress=${fromToken.address}&walletAddress=${evmAccount}`
        );
        if (allowanceData.configured === false) throw new Error("1inch API key not configured");
        if (allowanceData.allowance === "0" || BigInt(allowanceData.allowance || "0") < BigInt(amountWei)) {
          const approveData = await apiGet(
            `/1inch/approve/${selectedChainId}?tokenAddress=${fromToken.address}&amount=${amountWei}`
          );
          if (approveData.configured === false) throw new Error("1inch API key not configured");
          if (!approveData.to || !approveData.data) throw new Error("Invalid approval response from 1inch");
          const approveTxHash = await window.ethereum.request({
            method: "eth_sendTransaction",
            params: [{ from: evmAccount, to: approveData.to, data: approveData.data, value: approveData.value || "0x0" }],
          });
          // Wait for approval tx to be mined (poll receipt, up to 30 s)
          log.info("1inch", "Waiting for approval tx", approveTxHash);
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
              const receipt = await window.ethereum!.request({
                method: "eth_getTransactionReceipt",
                params: [approveTxHash],
              });
              if (receipt) break;
            } catch { /* retry */ }
          }
        }
        setSwapStatus("swapping");
      }

      const params = new URLSearchParams({
        src: fromToken.address, dst: toToken.address,
        amount: amountWei, from: evmAccount,
        slippage: slippage.toString(), disableEstimate: "true",
      });

      const swapData = await apiGet(`/1inch/swap/${selectedChainId}?${params.toString()}`);
      if (swapData.configured === false) throw new Error("1inch API key not configured");
      if (swapData.error) throw new Error(swapData.details || swapData.error);
      if (!swapData.tx?.to || !swapData.tx?.data) throw new Error("Invalid swap response from 1inch");

      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: evmAccount, to: swapData.tx.to,
          data: swapData.tx.data, value: swapData.tx.value || "0x0",
          gas: swapData.tx.gas ? "0x" + parseInt(swapData.tx.gas).toString(16) : undefined,
        }],
      });

      setLastTxHash(txHash);
      setSwapStatus("success");
      playVipConfirm();
      fetchBalance();
    } catch (err: any) {
      const msg = err?.message || "Swap failed";
      if (msg.includes("User rejected") || msg.includes("user rejected") || msg.includes("denied")) {
        setSwapStatus("idle");
      } else {
        setSwapStatus("error");
        setSwapError(msg);
      }
    }
  }, [evmAccount, evmChainId, selectedChainId, fromAmount, fromToken, toToken, slippage, chain, switchChain, fetchBalance]);

  // ── Rate calculation ───────────────────────────────────────────────

  const rate = useMemo(() => {
    if (!lastQuote || !fromAmount || parseFloat(fromAmount) <= 0) return null;
    const outNum = parseFloat(formatTokenAmount(lastQuote.dstAmount, toToken.decimals).replace(/,/g, ""));
    const inNum = parseFloat(fromAmount);
    if (!outNum || !inNum) return null;
    return outNum / inNum;
  }, [lastQuote, fromAmount, toToken.decimals]);

  const isCorrectChain = evmChainId === selectedChainId;
  const canSwap = evmAccount && fromAmount && parseFloat(fromAmount) > 0 && lastQuote && apiConfigured && swapStatus === "idle";

  // ── Shared props for extracted TokenSelector ────────────────────────
  const tokenSelectorShared = useMemo(() => ({
    tokenSearch, setTokenSearch, tokens, mergedTokens,
    allTokensCount: allTokens.length, tokensLoading, isDark, inputClass,
  }), [tokenSearch, setTokenSearch, tokens, mergedTokens, allTokens.length, tokensLoading, isDark, inputClass]);

  // ── Render ─────────────────────────────────────────────────────────

  // Lock gate — all hooks have been called above, so this early return
  // is safe under React's Rules of Hooks (hook call order is stable).
  if (isLocked) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className={`rounded-2xl p-5 mt-4 ${cardClass}`}
      >
        {/* Header — same as live widget */}
        <div className="flex items-center gap-2.5 mb-4">
          <div className="relative">
            <img src={ONEINCH_LOGO} alt="1inch" className="w-9 h-9 rounded-xl shadow-lg" width={36} height={36} />
          </div>
          <div>
            <h3 className={`text-lg font-extrabold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
              1inch Swap
            </h3>
            <p className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Cross-chain EVM aggregator
            </p>
          </div>
        </div>

        {/* Lock Banner */}
        <div className={`rounded-xl p-6 text-center ${
          isDark
            ? "bg-gradient-to-br from-amber-900/10 to-orange-900/10 border border-amber-500/20"
            : "bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200"
        }`}>
          <div className={`w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center ${
            isDark ? "bg-amber-500/10" : "bg-amber-100"
          }`}>
            <Lock className={`w-7 h-7 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
          </div>
          <h4 className={`text-base font-bold mb-2 ${isDark ? "text-amber-300" : "text-amber-800"}`}>
            Testing in Progress
          </h4>
          <p className={`text-sm leading-relaxed max-w-xs mx-auto ${isDark ? "text-amber-400/70" : "text-amber-700/80"}`}>
            The 1inch swap aggregator is currently locked for founder testing.
            It will be available to all users once the swap flow has been fully verified.
          </p>
          {connectedHederaAccount && (
            <p className={`text-xs mt-3 font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>
              Connected: {connectedHederaAccount}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-center gap-2 mt-4 text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
          <Shield className="w-3 h-3" />
          <span>Non-custodial · MEV-protected · Powered by</span>
          <a href="https://1inch.io" target="_blank" rel="noopener noreferrer"
            className={`font-bold flex items-center gap-0.5 transition-colors ${
              isDark ? "text-pink-400/40 hover:text-pink-400" : "text-pink-500/40 hover:text-pink-600"
            }`}>
            1inch <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className={`rounded-2xl p-5 mt-4 ${cardClass}`}
    >
      {/* ── Header (matches SaucerSwap header) ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2.5">
            {/* 1inch Logo */}
            <div className="relative">
              <img src={ONEINCH_LOGO} alt="1inch" className="w-9 h-9 rounded-xl shadow-lg" width={36} height={36} />
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-[#0c0f1a] animate-pulse" />
            </div>
            <div>
              <h3 className={`text-lg font-extrabold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
                1inch Swap
              </h3>
              <div className="flex items-center gap-2">
                <p className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Cross-chain EVM aggregator
                </p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
                  isDark
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                }`}>
                  <Sparkles className="w-2 h-2" />
                  400+ DEXs
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Settings gear */}
          <button onClick={() => { setShowSettings(!showSettings); playVipButtonChime(); }}
            className={`p-2 rounded-lg transition-all ${
              isDark
                ? "hover:bg-slate-800 text-slate-500 hover:text-pink-400"
                : "hover:bg-gray-100 text-gray-400 hover:text-pink-600"
            }`}>
            <Settings2 className="w-4 h-4" />
          </button>

          {/* Chain Selector */}
          <div className="relative">
            <button onClick={() => setShowChainMenu(!showChainMenu)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                isDark
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:border-emerald-400/50"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:border-emerald-300"
              }`}>
              <Globe className="w-3 h-3" />
              <span className="font-bold">{chain.name}</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showChainMenu ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence>
              {showChainMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowChainMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className={`absolute right-0 top-full mt-2 w-44 rounded-2xl shadow-2xl overflow-hidden z-50 ${
                      isDark
                        ? "bg-slate-900 border border-pink-500/20 shadow-pink-500/5"
                        : "bg-white border border-gray-200 shadow-lg"
                    }`}
                  >
                    <div className="p-1.5">
                      {CHAINS.map(c => (
                        <button key={c.id} onClick={() => handleChainSelect(c)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs transition-all group ${
                            c.id === selectedChainId
                              ? isDark
                                ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-pink-400"
                                : "bg-gradient-to-r from-pink-50 to-purple-50 text-pink-600"
                              : isDark
                                ? "text-slate-300 hover:bg-slate-800/60"
                                : "text-gray-600 hover:bg-gray-50"
                          }`}>
                          <span className="text-base group-hover:scale-110 transition-transform">{c.icon}</span>
                          <span className="font-bold">{c.name}</span>
                          {c.id === selectedChainId && (
                            <motion.div
                              layoutId="chain-indicator"
                              className="ml-auto w-2 h-2 rounded-full bg-gradient-to-r from-pink-500 to-purple-500"
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Slippage Settings ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={`p-3 rounded-xl mb-3 ${inputClass}`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${isDark ? "text-slate-400" : "text-gray-500"}`}>Slippage:</span>
                {[0.5, 1, 2, 3].map(s => (
                  <button key={s} onClick={() => { setSlippage(s); playVipButtonChime(); }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                      slippage === s
                        ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
                        : isDark
                          ? "bg-slate-700/50 text-slate-300 hover:bg-slate-600"
                          : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                    }`}>
                    {s}%
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── API Key Warning ── */}
      <AnimatePresence>
        {apiConfigured === false && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`p-4 rounded-xl border mb-3 ${
              isDark
                ? "bg-amber-900/10 border-amber-500/20"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${isDark ? "bg-amber-500/10" : "bg-amber-100"}`}>
                <Key className={`w-4 h-4 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
              </div>
              <div>
                <p className={`text-sm font-bold ${isDark ? "text-amber-400" : "text-amber-700"}`}>
                  API Key Required
                </p>
                <p className={`text-xs mt-1 leading-relaxed ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>
                  Set <code className={`px-1.5 py-0.5 rounded font-mono text-xs ${isDark ? "bg-amber-500/10" : "bg-amber-100"}`}>ONEINCH_API_KEY</code> in
                  Supabase Edge Function secrets.{" "}
                  <a href="https://portal.1inch.dev/" target="_blank" rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:no-underline font-bold">
                    Get a free key &rarr;
                  </a>
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ INPUT TOKEN ═══ */}
      <div className={`rounded-xl p-4 mb-2 ${inputClass}`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>You Pay</span>
          {evmAccount && fromBalance !== null && (
            <Tip content="Use max balance">
            <button
              onClick={() => {
                const bal = parseFloat(fromBalance.replace(/,/g, ""));
                if (bal > 0) {
                  setFromAmount(fromToken.isNative ? Math.max(0, bal - 0.005).toString() : fromBalance.replace(/,/g, ""));
                  playVipButtonChime();
                }
              }}
              className={`text-xs flex items-center gap-1 transition-colors ${
                isDark ? "text-slate-500 hover:text-pink-400" : "text-gray-400 hover:text-pink-600"
              }`}
            >
              <Wallet className="w-2.5 h-2.5" />
              {fromBalance} {fromToken.symbol}
            </button>
            </Tip>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input type="number" placeholder="0.0"
            className="bg-transparent flex-1 outline-none text-2xl min-w-0"
            value={fromAmount}
            onChange={e => { setFromAmount(e.target.value); setSwapStatus("idle"); setSwapError(null); }}
          />
          <div className="relative shrink-0">
            <button onClick={() => { setShowFromSelector(!showFromSelector); setShowToSelector(false); setTokenSearch(""); }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all ${
                isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"
              }`}>
              {fromToken.logoURI ? (
                <img src={fromToken.logoURI} alt={fromToken.symbol} className="w-6 h-6 rounded-full shrink-0"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 shrink-0" />
              )}
              <span className="font-bold text-sm">{fromToken.symbol}</span>
              <ChevronDown className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
            </button>
            {showFromSelector && (
              <TokenSelectorDropdown isOpen={showFromSelector} onClose={() => { setShowFromSelector(false); setTokenSearch(""); }}
                onSelect={t => handleSelectToken(t, true)} excludeAddr={toToken.address} {...tokenSelectorShared} />
            )}
          </div>
        </div>
        <div className={`text-xs mt-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
          {chain.name} network
        </div>
      </div>

      {/* ═══ FLIP BUTTON ═══ */}
      <div className="flex justify-center -my-3 relative z-10">
        <motion.button
          onClick={flipTokens}
          whileTap={{ scale: 0.9, rotate: 180 }}
          whileHover={{ scale: 1.08 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className={`p-2.5 rounded-xl border-4 transition-colors ${
            isDark
              ? "bg-slate-800 border-slate-900/80 hover:bg-slate-700 text-pink-400"
              : "bg-white border-gray-100 hover:bg-gray-50 text-pink-600 shadow-sm"
          }`}
        >
          <ArrowDownUp className="w-5 h-5" />
        </motion.button>
      </div>

      {/* ═══ OUTPUT TOKEN ═══ */}
      <div className={`rounded-xl p-4 mt-2 ${inputClass}`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>You Receive</span>
          {rate && (
            <span className={`text-xs flex items-center gap-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              1 {fromToken.symbol} = {rate >= 1 ? rate.toFixed(4) : rate.toFixed(8)} {toToken.symbol}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex-1 text-2xl min-w-0 ${quoteLoading ? "animate-pulse" : ""} ${!toAmount ? (isDark ? "text-slate-600" : "text-gray-300") : ""}`}>
            {quoteLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
                <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-400"}`}>Routing...</span>
              </span>
            ) : toAmount || "0.0"}
          </div>
          <div className="relative shrink-0">
            <button onClick={() => { setShowToSelector(!showToSelector); setShowFromSelector(false); setTokenSearch(""); }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all ${
                isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"
              }`}>
              {toToken.logoURI ? (
                <img src={toToken.logoURI} alt={toToken.symbol} className="w-6 h-6 rounded-full shrink-0"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 shrink-0" />
              )}
              <span className="font-bold text-sm">{toToken.symbol}</span>
              <ChevronDown className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
            </button>
            {showToSelector && (
              <TokenSelectorDropdown isOpen={showToSelector} onClose={() => { setShowToSelector(false); setTokenSearch(""); }}
                onSelect={t => handleSelectToken(t, false)} excludeAddr={fromToken.address} {...tokenSelectorShared} />
            )}
          </div>
        </div>
        <div className={`text-xs mt-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
          {chain.name} network
        </div>
      </div>

      {/* Quote Error */}
      <AnimatePresence>
        {quoteError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={`flex items-start gap-2 p-3 rounded-xl text-xs mt-3 ${
              isDark ? "bg-red-900/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-all">{quoteError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ ROUTE + QUOTE DETAILS ═══ */}
      <AnimatePresence>
        {lastQuote && !quoteLoading && fromAmount && parseFloat(fromAmount) > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className={`mt-4 p-3 rounded-xl ${isDark ? "bg-slate-800/30 border border-pink-500/10" : "bg-gray-50 border border-gray-100"}`}
          >
            {/* Route visualization */}
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <Zap className={`w-3.5 h-3.5 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
                <span className={`text-xs font-bold ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Best Route
                </span>
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                isDark ? "bg-pink-500/10 text-pink-400 border border-pink-500/20" : "bg-pink-50 text-pink-600 border border-pink-200"
              }`}>
                Aggregated
              </span>
            </div>

            <div className="flex items-center gap-1.5 mb-3">
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${isDark ? "bg-slate-700/60" : "bg-gray-200"}`}>
                {fromToken.logoURI && <img src={fromToken.logoURI} alt="" className="w-4 h-4 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                <span className="text-xs font-bold">{fromToken.symbol}</span>
              </div>
              <ArrowRight className={`w-3 h-3 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
              <span className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-slate-700/40 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
                1inch
              </span>
              <ArrowRight className={`w-3 h-3 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${isDark ? "bg-slate-700/60" : "bg-gray-200"}`}>
                {toToken.logoURI && <img src={toToken.logoURI} alt="" className="w-4 h-4 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                <span className="text-xs font-bold">{toToken.symbol}</span>
              </div>
            </div>

            {/* Quote summary (matches SaucerSwap style) */}
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Rate</span>
                <span>1 {fromToken.symbol} = {rate ? (rate >= 1 ? rate.toFixed(6) : rate.toFixed(8)) : "—"} {toToken.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Slippage</span>
                <span>{slippage}%</span>
              </div>
              {lastQuote.gas && (
                <div className="flex justify-between">
                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>Est. Gas</span>
                  <span>{lastQuote.gas.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Source</span>
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-emerald-400" />
                  1inch Aggregation
                  {lastQuote.cached && <span className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>(cached)</span>}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ ACTION BUTTON ═══ */}
      <div className="mt-4">
        {!evmAccount ? (
          <motion.button
            onClick={connectWallet}
            disabled={walletConnecting}
            whileHover={walletConnecting ? {} : { scale: 1.01 }}
            whileTap={walletConnecting ? {} : { scale: 0.98 }}
            className={`w-full py-3.5 rounded-xl font-bold transition-all duration-300 ${
              walletConnecting
                ? isDark ? "bg-slate-700 text-slate-400 cursor-wait" : "bg-gray-300 text-gray-500 cursor-wait"
                : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/30"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              {walletConnecting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
              ) : (
                <>
                  {partnerLogos.metamask ? (
                    <img src={partnerLogos.metamask} alt="" className="w-5 h-5 rounded" />
                  ) : (
                    <Wallet className="w-4 h-4" />
                  )}
                  Connect EVM Wallet
                </>
              )}
            </div>
          </motion.button>
        ) : !isCorrectChain ? (
          <motion.button
            onClick={() => { switchChain(chain); playVipButtonChime(); }}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-amber-600 to-yellow-500 hover:from-amber-500 hover:to-yellow-400 text-white shadow-lg shadow-amber-500/20"
          >
            <div className="flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Switch to {chain.name}
            </div>
          </motion.button>
        ) : swapStatus === "approving" ? (
          <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-amber-600 to-yellow-500 text-white cursor-wait">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Approving {fromToken.symbol}...
            </div>
          </button>
        ) : swapStatus === "swapping" ? (
          <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-amber-600 to-yellow-500 text-white cursor-wait">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Awaiting wallet signature...
            </div>
          </button>
        ) : swapStatus === "success" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-green-500 text-white">
              <div className="flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Swap Complete!
              </div>
            </button>
            {lastTxHash && (
              <a href={`${chain.explorerUrl}/tx/${lastTxHash}`} target="_blank" rel="noopener noreferrer"
                className={`flex items-center justify-center gap-1.5 mt-2 text-xs transition-colors ${
                  isDark ? "text-pink-400 hover:text-pink-300" : "text-pink-600 hover:text-pink-500"
                }`}>
                <ExternalLink className="w-3 h-3" />
                View on {chain.name} Explorer
              </a>
            )}
            <button onClick={() => { setSwapStatus("idle"); setFromAmount(""); setToAmount(""); setLastQuote(null); }}
              className={`w-full mt-2 py-2 rounded-lg text-xs transition-colors ${
                isDark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}>
              New Swap
            </button>
          </motion.div>
        ) : swapStatus === "error" ? (
          <div>
            <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-red-600 to-orange-500 text-white">
              <div className="flex items-center justify-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Swap Failed
              </div>
            </button>
            {swapError && (
              <div className={`flex items-start gap-1.5 mt-2 text-xs ${isDark ? "text-red-400" : "text-red-600"}`}>
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="break-all">{swapError}</span>
              </div>
            )}
            <button onClick={() => { setSwapStatus("idle"); setSwapError(null); }}
              className={`w-full mt-2 py-2 rounded-lg text-xs transition-colors ${
                isDark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}>
              Try Again
            </button>
          </div>
        ) : (
          <motion.button
            onClick={handleSwap}
            disabled={!canSwap}
            whileHover={canSwap ? { scale: 1.01 } : {}}
            whileTap={canSwap ? { scale: 0.98 } : {}}
            className={`w-full py-3.5 rounded-xl font-bold transition-all duration-300 shadow-lg text-white ${
              !canSwap
                ? isDark ? "bg-slate-700 text-slate-500 shadow-none cursor-not-allowed" : "bg-gray-300 text-gray-500 shadow-none cursor-not-allowed"
                : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-pink-500/30"
            }`}
          >
            {!fromAmount || parseFloat(fromAmount) <= 0
              ? "Enter an amount"
              : !lastQuote
                ? "Fetching quote..."
                : `Swap ${fromToken.symbol} → ${toToken.symbol}`
            }
          </motion.button>
        )}
      </div>

      {/* ═══ MODE / VENUE INFO (matches SaucerSwap footer) ═══ */}
      <div className={`flex items-center justify-center gap-2 mt-3 text-xs flex-wrap ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        {evmAccount ? (
          <>
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${
              isDark
                ? "bg-emerald-900/20 text-emerald-400 border border-emerald-500/20"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            }`}>
              <Zap className="w-2.5 h-2.5" />
              1inch Fusion · {chain.name}
            </span>
            <span className="flex items-center gap-1">
              <span className={`font-mono text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                {evmAccount.slice(0, 6)}...{evmAccount.slice(-4)}
              </span>
              {isCorrectChain && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </span>
          </>
        ) : (
          <>
            <Shield className="w-3 h-3" />
            <span>Non-custodial · MEV-protected · Powered by</span>
            <a href="https://1inch.io" target="_blank" rel="noopener noreferrer"
              className={`font-bold flex items-center gap-0.5 transition-colors ${
                isDark ? "text-pink-400/60 hover:text-pink-400" : "text-pink-500/60 hover:text-pink-600"
              }`}>
              1inch <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </>
        )}
      </div>
    </motion.div>
  );
}

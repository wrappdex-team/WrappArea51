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

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { log } from "../utils/logger";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowDownUp,
  ChevronDown,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Shield,
  Zap,
  Wallet,
  Settings2,
  ArrowRight,
  Key,
  Sparkles,
  Globe,
  Lock,
  Timer,
  Fuel,
  Clock,
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
import { ONEINCH_LOGO } from "../assets/brand";
import { usePartneredLogos } from "../contexts/PartneredLogosContext";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { OneInchTokenSelector } from "./OneInchTokenSelector";
import { OneInchOrderTracker } from "./OneInchOrderTracker";
import {
  POPULAR_TOKENS as MODULE_POPULAR_TOKENS,
  fetchTokenList,
  mergeTokenLists,
  enrichTokens,
  getDefaultPair,
  recordRecentToken,
  loadCustomTokens,
  formatBalance as formatTokenAmountNew,
  toSmallestUnit,
  formatUsd,
} from "../utils/oneinch/tokens";
import type { EnrichedToken, FusionPreset } from "../utils/oneinch/types";
import { friendlyErrorMessage } from "../utils/oneinch/api-client";
import {
  getFusionQuote,
  buildAndSignFusionOrder,
  submitFusionOrder,
  pollFusionStatus,
  ensureFusionApproval,
  isFusionSupported,
  isFusionTerminalStatus,
  isFusionSuccessStatus,
  formatFusionAmount,
  estimateGasSavingsUsd,
  formatCountdown,
  getFusionProxyStatus,
  FUSION_QUOTE_REFRESH_INTERVAL_MS,
  FUSION_POLL_INTERVAL_MS,
  FUSION_POLL_MAX_DURATION_MS,
  PRESET_LABELS,
  PRESET_ICONS,
  PRESET_DESCRIPTIONS,
  FUSION_STATUS_LABELS,
  FUSION_STATUS_ICONS,
  FUSION_STATUS_PROGRESS,
  persistOrderHash,
} from "../utils/oneinch/fusion";
import type { ParsedFusionQuote, ParsedPreset, FusionSignedOrder } from "../utils/oneinch/fusion";
import type { FusionOrderStatus, FusionOrderStatusResponse } from "../utils/oneinch/types";
import {
  getCrossChainQuote,
  getCrossChainOrderStatus,
  buildCrossChainOrder,
  submitCrossChainOrder,
  pollCrossChainOrder,
  submitSecret,
  getReadyFills,
  isFusionPlusSupported,
  isCrossChainTerminalStatus,
  isCrossChainSuccessStatus,
  getDestinationChains,
  formatCrossChainRoute,
  formatEstimatedTime,
  formatCrossChainAmount,
  persistCrossChainOrderHash,
  CROSS_CHAIN_QUOTE_REFRESH_INTERVAL_MS,
  CROSS_CHAIN_POLL_INTERVAL_MS,
  CROSS_CHAIN_POLL_MAX_DURATION_MS,
  CROSS_CHAIN_STATUS_LABELS,
} from "../utils/oneinch/fusion-plus";
import type { ParsedCrossChainQuote, FusionPlusBuildResponse, FusionPlusOrderStatusResponse } from "../utils/oneinch/fusion-plus";
import {
  getChainById as getModuleChainById,
} from "../utils/oneinch/chains";

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
  logoURI?: string | null;
  isNative?: boolean;
  tags?: readonly string[];
  isVerified?: boolean;
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

// ── Popular tokens per chain (from oneinch/tokens module) ────────────

const NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const POPULAR_TOKENS = MODULE_POPULAR_TOKENS as Record<number, TokenInfo[]>;

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

// ── Token Selector is now in OneInchTokenSelector.tsx ──

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
  // Classic:  idle → approving → swapping → success/error
  // Fusion:   idle → approving → building → signing → submitting → polling → success/error
  const [swapStatus, setSwapStatus] = useState<
    "idle" | "approving" | "swapping" | "building" | "signing" | "submitting" | "polling" | "success" | "error"
  >("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [lastSignedOrder, setLastSignedOrder] = useState<FusionSignedOrder | null>(null);
  // Fusion Step 7: order lifecycle tracking
  const [fusionOrderStatus, setFusionOrderStatus] = useState<FusionOrderStatus | null>(null);
  const [fusionFillTxHash, setFusionFillTxHash] = useState<string | null>(null);
  const fusionPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fusion+ Step 11: cross-chain order lifecycle tracking
  const [crossChainOrderHash, setCrossChainOrderHash] = useState<string | null>(null);
  const [crossChainBuildData, setCrossChainBuildData] = useState<FusionPlusBuildResponse | null>(null);
  const crossChainPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopCrossChainPolling = useCallback(() => {
    if (crossChainPollTimer.current) {
      clearInterval(crossChainPollTimer.current);
      crossChainPollTimer.current = null;
    }
  }, []);

  // ── Settings ──
  const [slippage, setSlippage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);

  // ── Balance state ──
  const [fromBalance, setFromBalance] = useState<string | null>(null);

  // ── Enriched token state (balances + prices from module) ──
  const [enrichedTokens, setEnrichedTokens] = useState<EnrichedToken[] | null>(null);
  const [fromPriceUsd, setFromPriceUsd] = useState<number | null>(null);
  const [toPriceUsd, setToPriceUsd] = useState<number | null>(null);

  // ── Swap mode: "classic" | "fusion" | "limit" | "crossChain" ──
  type WidgetSwapMode = "classic" | "fusion" | "limit" | "crossChain";
  const [swapMode, setSwapMode] = useState<WidgetSwapMode>(() => {
    try {
      const saved = localStorage.getItem("wrappdex:1inch:swap-mode");
      if (saved === "classic" || saved === "fusion" || saved === "crossChain") return saved;
    } catch {}
    return "fusion";
  });
  const chainSupportsFusion = isFusionSupported(selectedChainId);

  // Persist swap mode to localStorage (Step 9)
  const updateSwapMode = useCallback((mode: WidgetSwapMode) => {
    setSwapMode(mode);
    try { localStorage.setItem("wrappdex:1inch:swap-mode", mode); } catch {}
  }, []);

  // ── Fusion quote state ──
  const [fusionQuote, setFusionQuote] = useState<ParsedFusionQuote | null>(null);
  const [fusionQuoteLoading, setFusionQuoteLoading] = useState(false);
  const [fusionQuoteError, setFusionQuoteError] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<FusionPreset>("medium");
  const [fusionCountdown, setFusionCountdown] = useState(FUSION_QUOTE_REFRESH_INTERVAL_MS);
  const fusionRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fusionCountdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cross-chain (Fusion+) state (Step 10) ──
  const [dstChainId, setDstChainId] = useState<number>(42161); // Arbitrum default
  const [showDstChainMenu, setShowDstChainMenu] = useState(false);
  const [crossChainQuote, setCrossChainQuote] = useState<ParsedCrossChainQuote | null>(null);
  const [crossChainQuoteLoading, setCrossChainQuoteLoading] = useState(false);
  const [crossChainQuoteError, setCrossChainQuoteError] = useState<string | null>(null);
  const [crossChainCountdown, setCrossChainCountdown] = useState(CROSS_CHAIN_QUOTE_REFRESH_INTERVAL_MS);
  const crossChainRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useMemo(() => CHAINS.find(c => c.id === selectedChainId) || CHAINS[0], [selectedChainId]);
  const tokens = useMemo(() => POPULAR_TOKENS[selectedChainId] || POPULAR_TOKENS[1], [selectedChainId]);

  // ── Cross-chain derived state (Step 10) ──
  const chainSupportsFusionPlus = isFusionPlusSupported(selectedChainId);
  const dstChain = useMemo(() => getModuleChainById(dstChainId), [dstChainId]);
  const availableDstChains = useMemo(() => getDestinationChains(selectedChainId), [selectedChainId]);
  const dstTokens = useMemo(() => POPULAR_TOKENS[dstChainId] || POPULAR_TOKENS[1], [dstChainId]);
  // In cross-chain mode, destination token is from the destination chain
  const [crossChainDstToken, setCrossChainDstToken] = useState<TokenInfo>(() => {
    const dstPop = POPULAR_TOKENS[42161] || POPULAR_TOKENS[1];
    return dstPop[1] || dstPop[0]; // Default to USDC on Arbitrum
  });

  // Merged token list: popular first, then all fetched tokens (de-duped)
  const mergedTokens = useMemo(() => {
    const customTokens = loadCustomTokens()[selectedChainId] || [];
    return mergeTokenLists(selectedChainId, allTokens, customTokens);
  }, [selectedChainId, allTokens]);

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

  // ── Fetch full token list for current chain (via module) ────────────

  useEffect(() => {
    const controller = new AbortController();
    setAllTokens([]);
    setTokensLoading(true);
    setEnrichedTokens(null);
    fetchTokenList(selectedChainId, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setAllTokens(list);
      })
      .catch((err) => {
        if (!controller.signal.aborted) log.warn("1inch", "Token list fetch failed", err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setTokensLoading(false);
      });
    return () => controller.abort();
  }, [selectedChainId]);

  // ── Enrich tokens with balances + prices ──────────────────────────

  useEffect(() => {
    if (mergedTokens.length === 0) return;
    const controller = new AbortController();
    const wallet = evmAccount && evmChainId === selectedChainId ? evmAccount : null;
    enrichTokens(mergedTokens, selectedChainId, wallet, controller.signal)
      .then((enriched) => {
        if (controller.signal.aborted) return;
        setEnrichedTokens(enriched);
        // Extract prices for selected tokens
        const fromE = enriched.find(e => e.address.toLowerCase() === fromToken.address.toLowerCase());
        const toE = enriched.find(e => e.address.toLowerCase() === toToken.address.toLowerCase());
        setFromPriceUsd(fromE?.priceUsd ?? null);
        setToPriceUsd(toE?.priceUsd ?? null);
      })
      .catch(() => {}); // Non-critical — UI works without enrichment
    return () => controller.abort();
  }, [mergedTokens, selectedChainId, evmAccount, evmChainId, fromToken.address, toToken.address]);

  // ── Chain selection ────────────────────────────────────────────────

  const handleChainSelect = useCallback((c: ChainConfig) => {
    setSelectedChainId(c.id);
    setShowChainMenu(false);
    const [defaultFrom, defaultTo] = getDefaultPair(c.id);
    setFromToken(defaultFrom);
    setToToken(defaultTo);
    setFromAmount("");
    setToAmount("");
    setLastQuote(null);
    setQuoteError(null);
    setFusionQuote(null);
    setFusionQuoteError(null);
    setFusionCountdown(FUSION_QUOTE_REFRESH_INTERVAL_MS);
    setCrossChainQuote(null);
    setCrossChainQuoteError(null);
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
    setFusionQuote(null);
    setFusionQuoteError(null);
    // Record as recently used for the token selector
    recordRecentToken(selectedChainId, token.address, token.symbol);
    playVipButtonChime();
  }, [fromToken, toToken, selectedChainId]);

  const flipTokens = useCallback(() => {
    if (swapMode === "crossChain") {
      // In cross-chain mode: swap source ↔ destination chains + tokens
      const oldSrcChainId = selectedChainId;
      const oldDstChainId = dstChainId;
      const oldFromToken = fromToken;
      const oldDstToken = crossChainDstToken;
      setSelectedChainId(oldDstChainId);
      setDstChainId(oldSrcChainId);
      setFromToken(oldDstToken);
      setCrossChainDstToken(oldFromToken);
      setFromAmount(toAmount);
      setToAmount(fromAmount);
      setCrossChainQuote(null);
    } else {
      setFromToken(toToken);
      setToToken(fromToken);
      setFromAmount(toAmount);
      setToAmount(fromAmount);
    }
    setLastQuote(null);
    setFusionQuote(null);
    setFromBalance(null);
    playVipButtonChime();
  }, [fromToken, toToken, fromAmount, toAmount, swapMode, selectedChainId, dstChainId, crossChainDstToken]);

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
      const msg = friendlyErrorMessage(err);
      if (msg.includes("not configured") || msg.includes("API key")) setApiConfigured(false);
      else setQuoteError(msg);
    }
    setQuoteLoading(false);
  }, [fromToken, toToken, selectedChainId]);

  // Debounced classic quote (only when in classic mode)
  useEffect(() => {
    if (swapMode !== "classic") return;
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount(""); setLastQuote(null); return;
    }
    quoteTimer.current = setTimeout(() => fetchQuote(fromAmount), 500);
    return () => { if (quoteTimer.current) clearTimeout(quoteTimer.current); };
  }, [swapMode, fromAmount, fromToken.address, toToken.address, selectedChainId, fetchQuote]);

  // ── Fusion quote fetching + auto-refresh ────────────────────────────

  const fetchFusionQuote = useCallback(async (amount: string, signal?: AbortSignal) => {
    if (!amount || parseFloat(amount) <= 0 || !evmAccount) {
      setFusionQuote(null);
      setFusionQuoteError(null);
      return;
    }
    setFusionQuoteLoading(true);
    setFusionQuoteError(null);
    try {
      const amountWei = toWei(amount, fromToken.decimals);
      if (amountWei === "0") { setFusionQuote(null); setFusionQuoteLoading(false); return; }

      const parsed = await getFusionQuote(
        selectedChainId,
        fromToken.address,
        toToken.address,
        amountWei,
        evmAccount,
        signal,
      );
      setFusionQuote(parsed);
      setApiConfigured(true);

      // Update toAmount display from the selected preset
      const activePreset = parsed.presets.find(p => p.preset === selectedPreset) ?? parsed.presets[0];
      if (activePreset) {
        setToAmount(formatFusionAmount(activePreset.dstAmount, toToken.decimals));
      }

      // Reset countdown
      setFusionCountdown(FUSION_QUOTE_REFRESH_INTERVAL_MS);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      // Use friendlyErrorMessage for better user-facing error descriptions
      const msg = friendlyErrorMessage(err);
      const errDetail = (err?.error?.details ?? err?.details ?? "") as string;

      if (msg.includes("not configured") || msg.includes("API key")) {
        setApiConfigured(false);
      } else {
        // IMPLEMENTATION NOTE — Deployment detection for "invalid address" errors:
        // When the deployed server still has old field names (srcTokenAddress/dstTokenAddress
        // instead of fromTokenAddress/toTokenAddress for 1inch Fusion Quoter v2.0),
        // 1inch returns 400 "invalid address" because fromTokenAddress is missing.
        // The ping result tells us exactly whether this is a deployment issue.
        const isAddressError =
          errDetail.toLowerCase().includes("invalid address") ||
          msg.toLowerCase().includes("invalid address");
        const proxyStatus = getFusionProxyStatus();
        const isDeploymentIssue = isAddressError && proxyStatus === "old-server";
        const isDeploymentUnknown = isAddressError && proxyStatus === "unknown";

        if (isDeploymentIssue) {
          setFusionQuoteError(
            "Server deployment required — the Fusion proxy has the old field mapping bug. " +
            "Run: supabase functions deploy make-server-54299934"
          );
        } else if (isDeploymentUnknown) {
          setFusionQuoteError(
            "invalid address — server deployment may be required. " +
            "Run: supabase functions deploy make-server-54299934 (then retry)"
          );
        } else {
          setFusionQuoteError(msg);
        }
      }

      // Log full error details for debugging "invalid address" etc.
      const proxyStatus = getFusionProxyStatus();
      const fullErrorBody = err?.error ? JSON.stringify(err.error) : "n/a";
      log.warn("1inch",
        `Fusion quote error: ${msg} | detail=${errDetail} | proxyStatus=${proxyStatus}` +
        ` | fullError=${fullErrorBody}` +
        ` | Run diagnostic: GET /1inch/fusion/diag?wallet=${evmAccount || ""}`,
        err,
      );
    }
    setFusionQuoteLoading(false);
  }, [evmAccount, fromToken, toToken, selectedChainId, selectedPreset]);

  // Debounced fusion quote (when in fusion mode)
  useEffect(() => {
    if (swapMode !== "fusion" || !chainSupportsFusion) return;
    if (!fromAmount || parseFloat(fromAmount) <= 0 || !evmAccount) {
      setFusionQuote(null);
      setFusionQuoteError(null);
      setToAmount("");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => fetchFusionQuote(fromAmount, controller.signal), 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [swapMode, chainSupportsFusion, fromAmount, fromToken.address, toToken.address, selectedChainId, evmAccount, fetchFusionQuote]);

  // Auto-refresh fusion quote every 15 seconds
  useEffect(() => {
    if (fusionRefreshTimer.current) clearInterval(fusionRefreshTimer.current);
    if (fusionCountdownTimer.current) clearInterval(fusionCountdownTimer.current);

    if (swapMode !== "fusion" || !fusionQuote || !fromAmount || !evmAccount || swapStatus !== "idle") return;

    // Countdown ticker (every second)
    fusionCountdownTimer.current = setInterval(() => {
      setFusionCountdown(prev => {
        if (prev <= 1000) return 0;
        return prev - 1000;
      });
    }, 1000);

    // Actual refresh
    fusionRefreshTimer.current = setInterval(() => {
      fetchFusionQuote(fromAmount);
      setFusionCountdown(FUSION_QUOTE_REFRESH_INTERVAL_MS);
    }, FUSION_QUOTE_REFRESH_INTERVAL_MS);

    return () => {
      if (fusionRefreshTimer.current) clearInterval(fusionRefreshTimer.current);
      if (fusionCountdownTimer.current) clearInterval(fusionCountdownTimer.current);
    };
  }, [swapMode, fusionQuote, fromAmount, evmAccount, swapStatus, fetchFusionQuote]);

  // When preset changes, update the displayed toAmount from the current fusion quote
  useEffect(() => {
    if (swapMode !== "fusion" || !fusionQuote) return;
    const activePreset = fusionQuote.presets.find(p => p.preset === selectedPreset) ?? fusionQuote.presets[0];
    if (activePreset) {
      setToAmount(formatFusionAmount(activePreset.dstAmount, toToken.decimals));
    }
  }, [selectedPreset, fusionQuote, toToken.decimals, swapMode]);

  // ── Cross-chain (Fusion+) quote fetching (Step 10) ──────────────────

  const fetchCrossChainQuote = useCallback(async (amount: string, signal?: AbortSignal) => {
    if (!amount || parseFloat(amount) <= 0 || !evmAccount) {
      setCrossChainQuote(null);
      setCrossChainQuoteError(null);
      return;
    }
    setCrossChainQuoteLoading(true);
    setCrossChainQuoteError(null);
    try {
      const amountWei = toWei(amount, fromToken.decimals);
      if (amountWei === "0") { setCrossChainQuote(null); setCrossChainQuoteLoading(false); return; }

      const parsed = await getCrossChainQuote(
        selectedChainId,
        dstChainId,
        fromToken.address,
        crossChainDstToken.address,
        amountWei,
        evmAccount,
        signal,
      );
      setCrossChainQuote(parsed);
      setApiConfigured(true);

      // Update toAmount from recommended preset
      const activePreset = parsed.presets.find(p => p.preset === selectedPreset) ?? parsed.presets[0];
      if (activePreset) {
        setToAmount(formatCrossChainAmount(activePreset.dstAmount, crossChainDstToken.decimals));
      }
      setCrossChainCountdown(CROSS_CHAIN_QUOTE_REFRESH_INTERVAL_MS);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const msg = friendlyErrorMessage(err);
      if (msg.includes("not configured") || msg.includes("API key")) {
        setApiConfigured(false);
      } else {
        setCrossChainQuoteError(msg);
      }
      log.warn("1inch", `Cross-chain quote error: ${msg}`, err);
    }
    setCrossChainQuoteLoading(false);
  }, [evmAccount, fromToken, crossChainDstToken, selectedChainId, dstChainId, selectedPreset]);

  // Debounced cross-chain quote
  useEffect(() => {
    if (swapMode !== "crossChain" || !chainSupportsFusionPlus) return;
    if (!fromAmount || parseFloat(fromAmount) <= 0 || !evmAccount) {
      setCrossChainQuote(null);
      setCrossChainQuoteError(null);
      setToAmount("");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => fetchCrossChainQuote(fromAmount, controller.signal), 800);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [swapMode, chainSupportsFusionPlus, fromAmount, fromToken.address, crossChainDstToken.address, selectedChainId, dstChainId, evmAccount, fetchCrossChainQuote]);

  // Auto-refresh cross-chain quote
  useEffect(() => {
    if (crossChainRefreshTimer.current) clearInterval(crossChainRefreshTimer.current);
    if (swapMode !== "crossChain" || !crossChainQuote || !fromAmount || !evmAccount || swapStatus !== "idle") return;
    crossChainRefreshTimer.current = setInterval(() => {
      fetchCrossChainQuote(fromAmount);
      setCrossChainCountdown(CROSS_CHAIN_QUOTE_REFRESH_INTERVAL_MS);
    }, CROSS_CHAIN_QUOTE_REFRESH_INTERVAL_MS);
    return () => { if (crossChainRefreshTimer.current) clearInterval(crossChainRefreshTimer.current); };
  }, [swapMode, crossChainQuote, fromAmount, evmAccount, swapStatus, fetchCrossChainQuote]);

  // Reset state when switching modes
  useEffect(() => {
    if (swapMode === "classic") {
      setFusionQuote(null);
      setFusionQuoteError(null);
      setFusionCountdown(FUSION_QUOTE_REFRESH_INTERVAL_MS);
      setCrossChainQuote(null);
      setCrossChainQuoteError(null);
    } else if (swapMode === "fusion") {
      setLastQuote(null);
      setQuoteError(null);
      setCrossChainQuote(null);
      setCrossChainQuoteError(null);
    } else if (swapMode === "crossChain") {
      setLastQuote(null);
      setQuoteError(null);
      setFusionQuote(null);
      setFusionQuoteError(null);
    } else {
      setLastQuote(null);
      setQuoteError(null);
    }
    setToAmount("");
  }, [swapMode]);

  // Auto-fallback to classic if chain doesn't support Fusion
  useEffect(() => {
    if (!chainSupportsFusion && swapMode === "fusion") {
      setSwapMode("classic");
    }
    if (!chainSupportsFusionPlus && swapMode === "crossChain") {
      setSwapMode(chainSupportsFusion ? "fusion" : "classic");
    }
  }, [chainSupportsFusion, chainSupportsFusionPlus, swapMode]);

  // When src chain changes in cross-chain mode, ensure dst chain is different
  useEffect(() => {
    if (swapMode === "crossChain" && selectedChainId === dstChainId) {
      const alt = availableDstChains[0];
      if (alt) {
        setDstChainId(alt.id);
        const dstPop = POPULAR_TOKENS[alt.id] || POPULAR_TOKENS[1];
        setCrossChainDstToken(dstPop[1] || dstPop[0]);
      }
    }
  }, [swapMode, selectedChainId, dstChainId, availableDstChains]);

  // ── Execute CLASSIC swap ────────────────────────────────────────────
  const handleClassicSwap = useCallback(async () => {
    if (!evmAccount || !window.ethereum || !fromAmount || parseFloat(fromAmount) <= 0) return;

    // Safety-net balance check — prevent sending a tx the wallet can't cover
    if (fromBalance) {
      const walletBal = parseFloat(fromBalance.replace(/,/g, ""));
      if (!isNaN(walletBal) && parseFloat(fromAmount) > walletBal) {
        setSwapError(`Insufficient ${fromToken.symbol} balance. You have ${fromBalance} but tried to swap ${fromAmount}.`);
        setSwapStatus("error");
        return;
      }
    }

    playVipCashRegister();
    setSwapStatus("swapping");
    setSwapError(null);
    setLastTxHash(null);

    try {
      const amountWei = toWei(fromAmount, fromToken.decimals);

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
          const approveValue = approveData.value && approveData.value !== "0"
            ? "0x" + BigInt(approveData.value).toString(16)
            : "0x0";
          const approveTxHash = await window.ethereum.request({
            method: "eth_sendTransaction",
            params: [{ from: evmAccount, to: approveData.to, data: approveData.data, value: approveValue }],
          });
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

      // IMPLEMENTATION NOTE: 1inch API returns value/gas as DECIMAL strings
      // (e.g., "43605000000000000" for 0.043 ETH). MetaMask's eth_sendTransaction
      // requires hex-encoded values with "0x" prefix per EIP-1193. Passing the raw
      // decimal string causes MetaMask to interpret it as a much larger number,
      // resulting in "Amount: 77,679,494 ETH" instead of "0.043 ETH".
      const txValue = swapData.tx.value && swapData.tx.value !== "0"
        ? "0x" + BigInt(swapData.tx.value).toString(16)
        : "0x0";
      const txGas = swapData.tx.gas
        ? "0x" + BigInt(String(swapData.tx.gas)).toString(16)
        : undefined;

      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: evmAccount, to: swapData.tx.to,
          data: swapData.tx.data, value: txValue, gas: txGas,
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
  }, [evmAccount, selectedChainId, fromAmount, fromToken, toToken, slippage, fromBalance, fetchBalance]);

  // ── Fusion polling cleanup ──────────────────────────────────────────
  const stopFusionPolling = useCallback(() => {
    if (fusionPollTimer.current) {
      clearInterval(fusionPollTimer.current);
      fusionPollTimer.current = null;
    }
  }, []);

  // Clean up polling on unmount
  useEffect(() => {
    return () => { stopFusionPolling(); stopCrossChainPolling(); };
  }, [stopFusionPolling, stopCrossChainPolling]);

  // ── Execute FUSION swap (gasless — full lifecycle) ─────────────────
  const handleFusionSwap = useCallback(async () => {
    if (!evmAccount || !window.ethereum || !fromAmount || parseFloat(fromAmount) <= 0 || !fusionQuote) return;

    // Safety-net balance check — prevent spending gas on approval for a swap that can't complete
    if (fromBalance) {
      const walletBal = parseFloat(fromBalance.replace(/,/g, ""));
      if (!isNaN(walletBal) && parseFloat(fromAmount) > walletBal) {
        setSwapError(`Insufficient ${fromToken.symbol} balance. You have ${fromBalance} but tried to swap ${fromAmount}.`);
        setSwapStatus("error");
        return;
      }
    }

    playVipCashRegister();
    setSwapError(null);
    setLastTxHash(null);
    setLastSignedOrder(null);
    setFusionOrderStatus(null);
    setFusionFillTxHash(null);
    stopFusionPolling();

    try {
      const amountWei = toWei(fromAmount, fromToken.decimals);

      // Step A: For non-native ERC-20 tokens, ensure 1inch router approval.
      // This is the ONLY place in Fusion where gas is paid — a one-time approve().
      if (!fromToken.isNative) {
        setSwapStatus("approving");
        await ensureFusionApproval(
          selectedChainId, fromToken.address, evmAccount, amountWei,
          (status) => {
            if (status === "checking" || status === "approving" || status === "waiting")
              setSwapStatus("approving");
          },
        );
      }

      // IMPLEMENTATION NOTE — Two-Phase Quote Strategy (matches 1inch.io behavior):
      //
      // Phase 1 (display): enableEstimate=false → fast price display (already done above)
      //   The initial quote shown in the UI uses enableEstimate=false for speed.
      //   This returns preset pricing but quoteId=null because the quoter doesn't
      //   validate the wallet's balance/approval.
      //
      // Phase 2 (execution): enableEstimate=true → gets real quoteId
      //   After approval is confirmed, we re-fetch with enableEstimate=true.
      //   The quoter validates the wallet has tokens + approval, and IF valid,
      //   assigns a real quoteId that can be used for order/build.
      //
      // This is exactly how 1inch.io works — they show a fast quote first,
      // then re-fetch with estimation when the user clicks "Swap".

      setSwapStatus("building");
      log.info("1inch", `[STEP-B] Phase 1 quoteId=${fusionQuote.quoteId || "(EMPTY)"} — will ${fusionQuote.quoteId ? "SKIP" : "ATTEMPT"} Phase 2 (enableEstimate=true)`);

      let execQuoteId = fusionQuote.quoteId;

      if (!execQuoteId) {
        // Phase 2: Re-fetch quote with enableEstimate=true to get a real quoteId
        try {
          const execQuote = await getFusionQuote(
            selectedChainId,
            fromToken.address,
            toToken.address,
            amountWei,
            evmAccount,
            undefined, // no AbortSignal
            true,       // enableEstimate=true — validates balance+approval, returns quoteId
          );
          execQuoteId = execQuote.quoteId;
          log.info("1inch", `Execution quote received: quoteId=${execQuoteId || "(STILL EMPTY)"}`);
        } catch (execErr: any) {
          log.warn("1inch", `Execution quote (enableEstimate=true) failed: ${execErr?.message}. Trying without estimate...`);
          // If enableEstimate=true fails (e.g., insufficient balance), try one more time
          // with enableEstimate=false — some API versions may still return quoteId
        }
      }

      if (!execQuoteId) {
        log.error("1inch", `Fusion quoteId is empty even after enableEstimate=true. Raw quote keys: ${Object.keys(fusionQuote.raw as any).join(", ")}`);
        setSwapError(
          "Unable to get a Fusion quote ID. This typically means the trade amount is too small " +
          "for Fusion resolvers on Ethereum mainnet (resolver gas costs exceed the spread). " +
          "Try a larger amount (>$50) or switch to Classic mode."
        );
        setSwapStatus("error");
        return;
      }

      log.info("1inch", `[STEP-C] Building Fusion order: quoteId=${execQuoteId} wallet=${evmAccount} preset=${selectedPreset} chain=${selectedChainId}`);

      // Step C: Sign the typed data — eth_signTypedData_v4 (NO gas!)
      setSwapStatus("signing");

      const signedOrder = await buildAndSignFusionOrder(
        selectedChainId, execQuoteId, evmAccount, selectedPreset,
      );

      log.info("1inch", `Fusion order signed: orderHash=${signedOrder.orderHash} sig=${signedOrder.signature.slice(0, 12)}...`);
      setLastSignedOrder(signedOrder);

      // Step D: Submit the signed order to resolvers
      setSwapStatus("submitting");
      log.info("1inch", `Submitting Fusion order: orderHash=${signedOrder.orderHash}`);

      const submitRes = await submitFusionOrder(
        selectedChainId,
        signedOrder.orderHash,
        signedOrder.signature,
        signedOrder.quoteId,
      );

      log.info("1inch", `Fusion order submitted: status=${submitRes.status}`);
      setFusionOrderStatus(submitRes.status);

      // Step 8: Persist order hash to localStorage for tracker history
      persistOrderHash({
        orderHash: signedOrder.orderHash,
        chainId: selectedChainId,
        createdAt: new Date().toISOString(),
        srcSymbol: fromToken.symbol,
        dstSymbol: toToken.symbol,
      });

      // Step E: Poll for status until terminal (filled/expired/failed)
      setSwapStatus("polling");
      const pollDeadline = Date.now() + FUSION_POLL_MAX_DURATION_MS;

      // Start interval-based polling
      fusionPollTimer.current = setInterval(async () => {
        try {
          if (Date.now() > pollDeadline) {
            stopFusionPolling();
            setSwapStatus("error");
            setSwapError("Fusion order timed out after 10 minutes. Check your active orders.");
            return;
          }

          const statusRes = await pollFusionStatus(selectedChainId, signedOrder.orderHash);
          setFusionOrderStatus(statusRes.status);

          if (statusRes.txHash) {
            setFusionFillTxHash(statusRes.txHash);
          }

          if (isFusionTerminalStatus(statusRes.status)) {
            stopFusionPolling();

            if (isFusionSuccessStatus(statusRes.status)) {
              setLastTxHash(statusRes.txHash || null);
              setSwapStatus("success");
              playVipConfirm();
              fetchBalance();
            } else {
              setSwapStatus("error");
              setSwapError(FUSION_STATUS_LABELS[statusRes.status]);
            }
          }
        } catch (pollErr: any) {
          // Don't kill polling on transient errors — just log and retry
          log.warn("1inch", "Fusion poll error (will retry)", pollErr?.message);
        }
      }, FUSION_POLL_INTERVAL_MS);

    } catch (err: any) {
      const msg = friendlyErrorMessage(err);
      // Surface additional detail from OneInchApiError.details when available
      const detail = (err?.error?.details ?? err?.details ?? "") as string;
      const fullMsg = detail && !msg.includes(detail) ? `${msg} — ${detail}` : msg;
      if (msg.includes("User rejected") || msg.includes("user rejected") || msg.includes("denied")) {
        setSwapStatus("idle");
      } else {
        setSwapStatus("error");
        setSwapError(fullMsg);
      }
      // IMPLEMENTATION NOTE: Log full error including _debug from server for tracing build failures
      const errBody = err?.error ?? err;
      log.warn("1inch", `[STEP-FAIL] Fusion swap error at swapStatus="${swapStatus}": ${fullMsg}`);
      log.warn("1inch", `[STEP-FAIL] Full error object:`, JSON.stringify({
        kind: errBody?.kind, status: errBody?.status, details: errBody?.details,
        message: errBody?.message, meta: errBody?.meta, _debug: errBody?._debug,
      }, null, 2));
      stopFusionPolling();
    }
  }, [evmAccount, selectedChainId, fromAmount, fromToken, toToken, fromBalance, fusionQuote, selectedPreset, stopFusionPolling, fetchBalance]);

  // ── Execute FUSION+ cross-chain swap (full lifecycle) ───────────────
  const handleCrossChainSwap = useCallback(async () => {
    if (!evmAccount || !window.ethereum || !fromAmount || parseFloat(fromAmount) <= 0 || !crossChainQuote) return;

    // Safety-net balance check
    if (fromBalance) {
      const walletBal = parseFloat(fromBalance.replace(/,/g, ""));
      if (!isNaN(walletBal) && parseFloat(fromAmount) > walletBal) {
        setSwapError(`Insufficient ${fromToken.symbol} balance. You have ${fromBalance} but tried to swap ${fromAmount}.`);
        setSwapStatus("error");
        return;
      }
    }

    playVipCashRegister();
    setSwapError(null);
    setLastTxHash(null);
    setLastSignedOrder(null);
    setFusionOrderStatus(null);
    setFusionFillTxHash(null);
    setCrossChainOrderHash(null);
    setCrossChainBuildData(null);
    stopCrossChainPolling();

    try {
      // Step A: Get a fresh quote with enableEstimate=true for a valid quoteId
      setSwapStatus("building");
      log.info("1inch", `[FUSION+] Step A: Requesting Fusion+ quote with enableEstimate=true`);

      let execQuoteId = crossChainQuote.quoteId;

      if (!execQuoteId) {
        const amountWei = toWei(fromAmount, fromToken.decimals);
        const freshQuote = await getCrossChainQuote(
          selectedChainId,
          dstChainId,
          fromToken.address,
          crossChainDstToken.address,
          amountWei,
          evmAccount,
        );
        execQuoteId = freshQuote.quoteId;
        log.info("1inch", `[FUSION+] Fresh quote received: quoteId=${execQuoteId || "(EMPTY)"}`);
      }

      if (!execQuoteId) {
        setSwapError(
          "Unable to get a Fusion+ cross-chain quote ID. The trade amount may be too small " +
          "for cross-chain resolvers, or there is insufficient liquidity on the route."
        );
        setSwapStatus("error");
        return;
      }

      // Step B: Build the order — returns EIP-712 typed data for signing
      log.info("1inch", `[FUSION+] Step B: Building cross-chain order: quoteId=${execQuoteId}`);

      const buildResult = await buildCrossChainOrder(
        execQuoteId,
        evmAccount,
        1, // secretsCount — 1 for simple swaps
      );

      log.info("1inch", `[FUSION+] Build success: orderHash=${buildResult.orderHash} hasTypedData=${!!buildResult.typedData}`);
      setCrossChainBuildData(buildResult);

      if (!buildResult.typedData || !buildResult.orderHash) {
        setSwapError(`Fusion+ build returned incomplete data. orderHash=${buildResult.orderHash ?? "missing"}, typedData=${buildResult.typedData ? "present" : "missing"}`);
        setSwapStatus("error");
        return;
      }

      // Step C: Sign the EIP-712 typed data — gasless signature
      setSwapStatus("signing");
      log.info("1inch", `[FUSION+] Step C: Requesting EIP-712 signature for orderHash=${buildResult.orderHash}`);

      const signature = await window.ethereum!.request({
        method: "eth_signTypedData_v4",
        params: [evmAccount, typeof buildResult.typedData === "string" ? buildResult.typedData : JSON.stringify(buildResult.typedData)],
      });

      log.info("1inch", `[FUSION+] Signature obtained: ${(signature as string).slice(0, 16)}...`);

      // Step D: Submit the signed order to the Fusion+ relayer
      setSwapStatus("submitting");
      log.info("1inch", `[FUSION+] Step D: Submitting signed order to relayer`);

      const submitRes = await submitCrossChainOrder({
        quoteId: execQuoteId,
        orderHash: buildResult.orderHash,
        signature: signature as string,
        order: buildResult.order,
        extension: buildResult.extension,
        srcSecrets: buildResult.srcSecrets,
        secretHashes: buildResult.secretHashes,
      });

      log.info("1inch", `[FUSION+] Order submitted: ${JSON.stringify(submitRes).slice(0, 200)}`);
      setCrossChainOrderHash(buildResult.orderHash);

      // Persist for order history tracking
      persistCrossChainOrderHash(
        buildResult.orderHash,
        selectedChainId,
        dstChainId,
        fromToken.symbol,
        crossChainDstToken.symbol,
        fromAmount,
      );

      // Step E: Poll for status until terminal
      setSwapStatus("polling");
      setFusionOrderStatus("SrcPending" as any);
      const pollDeadline = Date.now() + CROSS_CHAIN_POLL_MAX_DURATION_MS;

      crossChainPollTimer.current = setInterval(async () => {
        try {
          if (Date.now() > pollDeadline) {
            stopCrossChainPolling();
            setSwapStatus("error");
            setSwapError("Cross-chain order timed out after 10 minutes. Check your active orders.");
            return;
          }

          // Poll order status via the orders API
          const orderStatus = await getCrossChainOrderStatus(buildResult.orderHash);
          
          log.info("1inch", `[FUSION+] Poll: status=${orderStatus.status}`);
          setFusionOrderStatus(orderStatus.status as any);

          if (isCrossChainTerminalStatus(orderStatus.status)) {
            stopCrossChainPolling();

            if (isCrossChainSuccessStatus(orderStatus.status)) {
              setSwapStatus("success");
              playVipConfirm();
              fetchBalance();
            } else {
              setSwapStatus("error");
              setSwapError(CROSS_CHAIN_STATUS_LABELS[orderStatus.status] || orderStatus.status);
            }
          }

          // IMPLEMENTATION NOTE: When SrcFilled, check if we need to submit secrets
          // for HTLC resolution. This is the atomic swap mechanism.
          if (orderStatus.status === "SrcFilled" && buildResult.srcSecrets?.length) {
            try {
              const readyRes = await getReadyFills(buildResult.orderHash);
              log.info("1inch", `[FUSION+] Ready fills check: ${JSON.stringify(readyRes).slice(0, 200)}`);
              
              // If fills are ready, submit the secret
              if (readyRes && buildResult.srcSecrets[0]) {
                log.info("1inch", `[FUSION+] Submitting HTLC secret for orderHash=${buildResult.orderHash}`);
                await submitSecret(buildResult.orderHash, buildResult.srcSecrets[0]);
                log.info("1inch", `[FUSION+] Secret submitted successfully`);
              }
            } catch (secretErr: any) {
              log.warn("1inch", `[FUSION+] Secret submission failed (will retry): ${secretErr?.message}`);
            }
          }
        } catch (pollErr: any) {
          log.warn("1inch", `[FUSION+] Poll error (will retry): ${pollErr?.message}`);
        }
      }, CROSS_CHAIN_POLL_INTERVAL_MS);

    } catch (err: any) {
      const msg = friendlyErrorMessage(err);
      const detail = (err?.error?.details ?? err?.details ?? "") as string;
      const fullMsg = detail && !msg.includes(detail) ? `${msg} — ${detail}` : msg;
      if (msg.includes("User rejected") || msg.includes("user rejected") || msg.includes("denied")) {
        setSwapStatus("idle");
      } else {
        setSwapStatus("error");
        setSwapError(fullMsg);
      }
      const errBody = err?.error ?? err;
      log.warn("1inch", `[FUSION+] Swap error: ${fullMsg}`);
      log.warn("1inch", `[FUSION+] Full error:`, JSON.stringify({
        kind: errBody?.kind, status: errBody?.status, details: errBody?.details,
        message: errBody?.message, meta: errBody?.meta, _debug: errBody?._debug,
      }, null, 2));
      stopCrossChainPolling();
    }
  }, [evmAccount, selectedChainId, dstChainId, fromAmount, fromToken, toToken, crossChainDstToken, fromBalance, crossChainQuote, selectedPreset, stopCrossChainPolling, fetchBalance]);

  // ── Unified swap handler — dispatches to Classic, Fusion, or Fusion+ ──
  const handleSwap = useCallback(async () => {
    if (!evmAccount || !window.ethereum || !fromAmount || parseFloat(fromAmount) <= 0) return;
    if (evmChainId !== selectedChainId) { await switchChain(chain); return; }

    if (swapMode === "crossChain") {
      await handleCrossChainSwap();
      return;
    }
    if (swapMode === "fusion" && fusionQuote) {
      await handleFusionSwap();
    } else {
      await handleClassicSwap();
    }
  }, [evmAccount, evmChainId, selectedChainId, fromAmount, swapMode, fusionQuote, chain, switchChain, handleClassicSwap, handleFusionSwap, handleCrossChainSwap]);

  // ── Rate calculation ───────────────────────────────────────────────

  const rate = useMemo(() => {
    if (!lastQuote || !fromAmount || parseFloat(fromAmount) <= 0) return null;
    const outNum = parseFloat(formatTokenAmount(lastQuote.dstAmount, toToken.decimals).replace(/,/g, ""));
    const inNum = parseFloat(fromAmount);
    if (!outNum || !inNum) return null;
    return outNum / inNum;
  }, [lastQuote, fromAmount, toToken.decimals]);

  // Fusion rate calculation
  const fusionRate = useMemo(() => {
    if (!fusionQuote || !fromAmount || parseFloat(fromAmount) <= 0) return null;
    const activePreset = fusionQuote.presets.find(p => p.preset === selectedPreset) ?? fusionQuote.presets[0];
    if (!activePreset) return null;
    const outStr = formatFusionAmount(activePreset.dstAmount, toToken.decimals).replace(/,/g, "");
    const outNum = parseFloat(outStr);
    const inNum = parseFloat(fromAmount);
    if (!outNum || !inNum) return null;
    return outNum / inNum;
  }, [fusionQuote, fromAmount, toToken.decimals, selectedPreset]);

  const isCorrectChain = evmChainId === selectedChainId;
  // Cross-chain rate calculation (Step 10)
  const crossChainRate = useMemo(() => {
    if (!crossChainQuote || !fromAmount) return null;
    const activePreset = crossChainQuote.presets.find(p => p.preset === selectedPreset) ?? crossChainQuote.presets[0];
    if (!activePreset) return null;
    const outStr = formatCrossChainAmount(activePreset.dstAmount, crossChainDstToken.decimals).replace(/,/g, "");
    const outNum = parseFloat(outStr);
    const inNum = parseFloat(fromAmount);
    if (!outNum || !inNum) return null;
    return outNum / inNum;
  }, [crossChainQuote, fromAmount, crossChainDstToken.decimals, selectedPreset]);

  const activeRate = swapMode === "fusion" ? fusionRate : swapMode === "crossChain" ? crossChainRate : rate;
  // Effective output token — in cross-chain mode, use the destination chain token
  const effectiveToToken = swapMode === "crossChain" ? crossChainDstToken : toToken;
  // ── Insufficient balance detection ──
  // Compare the user's entered amount against the on-chain balance fetched from the wallet.
  // fromBalance is a formatted string like "8.370000" — strip commas for comparison.
  const insufficientBalance = useMemo(() => {
    if (!fromAmount || !fromBalance || !evmAccount) return false;
    const enteredAmt = parseFloat(fromAmount);
    const walletBal = parseFloat(fromBalance.replace(/,/g, ""));
    if (isNaN(enteredAmt) || isNaN(walletBal) || enteredAmt <= 0) return false;
    return enteredAmt > walletBal;
  }, [fromAmount, fromBalance, evmAccount]);

  const canSwap = evmAccount && fromAmount && parseFloat(fromAmount) > 0
    && !insufficientBalance
    && ((swapMode === "classic" && lastQuote) || (swapMode === "fusion" && fusionQuote) || (swapMode === "crossChain" && crossChainQuote))
    && apiConfigured !== false && swapStatus === "idle";

  // ── Shared props for new OneInchTokenSelector ───────────────────────
  // (tokenSearch state is still used as a flag to clear on close)

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
    <>
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

      {/* ═══ SWAP MODE TOGGLE — Fusion / Classic / Cross-Chain / Limit (Step 10) ═══ */}
      {chainSupportsFusion && (
        <div className="mb-3">
          <div className={`flex items-center gap-1 p-1 rounded-xl ${inputClass}`}>
            <button
              onClick={() => { updateSwapMode("fusion"); playVipButtonChime(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
                swapMode === "fusion"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-lg shadow-emerald-500/20"
                  : isDark
                    ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Zap className="w-3 h-3" />
              Fusion
              <span className={`text-[9px] px-1 py-0.5 rounded-full font-extrabold ${
                swapMode === "fusion"
                  ? "bg-white/20 text-white"
                  : isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
              }`}>
                GASLESS
              </span>
            </button>
            <button
              onClick={() => { updateSwapMode("classic"); playVipButtonChime(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
                swapMode === "classic"
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
                  : isDark
                    ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Fuel className="w-3 h-3" />
              Classic
            </button>
            {chainSupportsFusionPlus && (
              <button
                onClick={() => { updateSwapMode("crossChain"); playVipButtonChime(); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
                  swapMode === "crossChain"
                    ? "bg-gradient-to-r from-cyan-600 to-blue-500 text-white shadow-lg shadow-cyan-500/20"
                    : isDark
                      ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                      : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                <Globe className="w-3 h-3" />
                Cross
                <span className={`text-[9px] px-1 py-0.5 rounded-full font-extrabold ${
                  swapMode === "crossChain"
                    ? "bg-white/20 text-white"
                    : isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-cyan-50 text-cyan-600"
                }`}>
                  F+
                </span>
              </button>
            )}
            <button
              disabled
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all cursor-not-allowed ${
                isDark
                  ? "text-slate-600 hover:text-slate-500"
                  : "text-gray-300 hover:text-gray-400"
              }`}
              title="Limit orders — coming soon"
            >
              <Timer className="w-3 h-3" />
              Limit
              <span className={`text-[9px] px-1 py-0.5 rounded-full font-extrabold ${
                isDark ? "bg-slate-700/50 text-slate-500" : "bg-gray-100 text-gray-400"
              }`}>
                SOON
              </span>
            </button>
          </div>

          {/* Gas savings comparison (Fusion vs Classic) */}
          <AnimatePresence>
            {swapMode === "fusion" && fusionQuote?.estimatedGasSaved && fusionQuote.estimatedGasSaved > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className={`flex items-center justify-center gap-1.5 mt-2 py-1.5 rounded-lg text-[10px] font-bold ${
                  isDark
                    ? "bg-emerald-900/15 text-emerald-400 border border-emerald-500/15"
                    : "bg-emerald-50 text-emerald-600 border border-emerald-200/50"
                }`}
              >
                <Fuel className="w-3 h-3" />
                Fusion saves you {estimateGasSavingsUsd(fusionQuote.estimatedGasSaved, selectedChainId)} in gas
                <span className={`text-[9px] ${isDark ? "text-emerald-500/60" : "text-emerald-500/50"}`}>
                  vs Classic mode
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Classic mode gas indicator */}
          <AnimatePresence>
            {swapMode === "classic" && lastQuote?.gas && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className={`flex items-center justify-center gap-1.5 mt-2 py-1.5 rounded-lg text-[10px] font-bold ${
                  isDark
                    ? "bg-pink-900/15 text-pink-400 border border-pink-500/15"
                    : "bg-pink-50 text-pink-600 border border-pink-200/50"
                }`}
              >
                <Fuel className="w-3 h-3" />
                Est. gas: {estimateGasSavingsUsd(lastQuote.gas, selectedChainId)}
                <span className={`text-[9px] ${isDark ? "text-pink-500/60" : "text-pink-500/50"}`}>
                  · You pay gas
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ═══ CROSS-CHAIN: DESTINATION CHAIN SELECTOR + ROUTE (Step 10) ═══ */}
      <AnimatePresence>
        {swapMode === "crossChain" && chainSupportsFusionPlus && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-3"
          >
            {/* Source → Destination chain selectors */}
            <div className={`rounded-xl p-3 ${inputClass}`}>
              <div className="flex items-center gap-2 mb-2">
                <Globe className={`w-3.5 h-3.5 ${isDark ? "text-cyan-400" : "text-cyan-600"}`} />
                <span className={`text-xs font-bold ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>
                  Cross-Chain Route
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Source chain (read-only — same as main chain selector) */}
                <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg ${
                  isDark ? "bg-slate-700/40 border border-slate-600/30" : "bg-gray-100 border border-gray-200"
                }`}>
                  <span className="text-sm">{chain.icon}</span>
                  <span className={`text-xs font-bold ${isDark ? "text-slate-200" : "text-gray-700"}`}>
                    {chain.name}
                  </span>
                </div>

                {/* Arrow */}
                <div className={`flex items-center justify-center ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>
                  <ArrowRight className="w-4 h-4" />
                </div>

                {/* Destination chain selector */}
                <div className="flex-1 relative">
                  <button
                    onClick={() => setShowDstChainMenu(!showDstChainMenu)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                      isDark
                        ? "bg-cyan-900/20 border border-cyan-500/20 hover:border-cyan-500/40 text-slate-200"
                        : "bg-cyan-50 border border-cyan-200 hover:border-cyan-300 text-gray-700"
                    }`}
                  >
                    <span className="text-sm">{dstChain?.icon ?? "?"}</span>
                    <span className="text-xs font-bold flex-1 text-left">{dstChain?.name ?? "Select"}</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>

                  {/* Destination chain dropdown */}
                  <AnimatePresence>
                    {showDstChainMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className={`absolute top-full left-0 right-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden ${
                          isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200"
                        }`}
                      >
                        {availableDstChains.map(c => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setDstChainId(c.id);
                              setShowDstChainMenu(false);
                              const dstPop = POPULAR_TOKENS[c.id] || POPULAR_TOKENS[1];
                              setCrossChainDstToken(dstPop[1] || dstPop[0]);
                              setToAmount("");
                              setCrossChainQuote(null);
                              playVipButtonChime();
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-bold transition-all ${
                              c.id === dstChainId
                                ? isDark
                                  ? "bg-cyan-900/30 text-cyan-300"
                                  : "bg-cyan-50 text-cyan-700"
                                : isDark
                                  ? "text-slate-300 hover:bg-slate-700/50"
                                  : "text-gray-600 hover:bg-gray-50"
                            }`}
                          >
                            <span className="text-sm">{c.icon}</span>
                            {c.name}
                            {c.id === dstChainId && <CheckCircle2 className="w-3 h-3 ml-auto" />}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Route description */}
              <div className={`flex items-center justify-center gap-1.5 mt-2 py-1.5 rounded-lg text-[10px] font-bold ${
                isDark
                  ? "bg-cyan-900/10 text-cyan-400/80 border border-cyan-500/10"
                  : "bg-cyan-50/60 text-cyan-600/80 border border-cyan-200/40"
              }`}>
                <Sparkles className="w-3 h-3" />
                {formatCrossChainRoute(
                  fromToken.symbol,
                  chain.name,
                  crossChainDstToken.symbol,
                  dstChain?.name ?? "?"
                )}
              </div>

              {/* Cross-chain quote status */}
              {crossChainQuote && (
                <div className={`flex items-center justify-between mt-2 text-[10px] ${
                  isDark ? "text-slate-400" : "text-gray-500"
                }`}>
                  <span className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    Est. time: {formatEstimatedTime(crossChainQuote.estimatedTimeSeconds)}
                  </span>
                  {crossChainQuote.fees.protocolFee && (
                    <span>Protocol fee: {crossChainQuote.fees.protocolFee}</span>
                  )}
                </div>
              )}
              {crossChainQuoteError && (
                <div className={`flex items-center gap-1.5 mt-2 text-[10px] ${
                  isDark ? "text-red-400" : "text-red-600"
                }`}>
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>{crossChainQuoteError}</span>
                </div>
              )}
              {crossChainQuoteLoading && (
                <div className={`flex items-center justify-center gap-1.5 mt-2 text-[10px] ${
                  isDark ? "text-cyan-400" : "text-cyan-600"
                }`}>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Finding cross-chain resolvers...
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ INPUT TOKEN ═══ */}
      <div className={`rounded-xl p-4 mb-2 transition-all ${inputClass} ${
        insufficientBalance
          ? isDark ? "ring-1 ring-red-500/50" : "ring-1 ring-red-400/60"
          : ""
      }`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>You Pay</span>
          {evmAccount && fromBalance !== null && (
            <Tip content="Use max balance">
            <button
              onClick={() => {
                const balStr = fromBalance.replace(/,/g, "");
                const bal = parseFloat(balStr);
                if (bal > 0) {
                  // IMPLEMENTATION NOTE: For native tokens, reserve 0.005 for gas.
                  // Use toFixed to avoid JS floating-point artifacts (e.g., 0.048605 - 0.005 → 0.043605000000000005)
                  const maxDecimals = Math.min(fromToken.decimals, 8);
                  const amt = fromToken.isNative ? Math.max(0, bal - 0.005).toFixed(maxDecimals).replace(/\.?0+$/, "") : balStr;
                  setFromAmount(amt);
                  playVipButtonChime();
                }
              }}
              className={`text-xs flex items-center gap-1 transition-colors ${
                insufficientBalance
                  ? isDark ? "text-red-400 hover:text-red-300" : "text-red-500 hover:text-red-600"
                  : isDark ? "text-slate-500 hover:text-pink-400" : "text-gray-400 hover:text-pink-600"
              }`}
            >
              <Wallet className="w-2.5 h-2.5" />
              {insufficientBalance && <AlertCircle className="w-2.5 h-2.5" />}
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
              <OneInchTokenSelector
                isOpen={showFromSelector}
                onClose={() => { setShowFromSelector(false); setTokenSearch(""); }}
                onSelect={t => handleSelectToken(t, true)}
                excludeAddress={toToken.address}
                chainId={selectedChainId}
                allTokens={mergedTokens}
                enrichedTokens={enrichedTokens}
                isLoading={tokensLoading}
              />
            )}
          </div>
        </div>
        <div className={`flex items-center justify-between mt-1`}>
          <span className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            {chain.name} network
          </span>
          {fromAmount && parseFloat(fromAmount) > 0 && fromPriceUsd !== null && fromPriceUsd > 0 && (
            <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {formatUsd(parseFloat(fromAmount) * fromPriceUsd)}
            </span>
          )}
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
          <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            You Receive{swapMode === "crossChain" && dstChain ? ` (on ${dstChain.name})` : ""}
          </span>
          {activeRate && (
            <span className={`text-xs flex items-center gap-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              1 {fromToken.symbol} = {activeRate >= 1 ? activeRate.toFixed(4) : activeRate.toFixed(8)} {effectiveToToken.symbol}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex-1 text-2xl min-w-0 ${(quoteLoading || fusionQuoteLoading || crossChainQuoteLoading) ? "animate-pulse" : ""} ${!toAmount ? (isDark ? "text-slate-600" : "text-gray-300") : ""}`}>
            {(quoteLoading || fusionQuoteLoading || crossChainQuoteLoading) ? (
              <span className="flex items-center gap-2">
                <Loader2 className={`w-5 h-5 animate-spin ${swapMode === "crossChain" ? "text-cyan-400" : "text-pink-400"}`} />
                <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-400"}`}>
                  {swapMode === "crossChain" ? "Cross-chain routing..." : swapMode === "fusion" ? "Finding resolvers..." : "Routing..."}
                </span>
              </span>
            ) : toAmount || "0.0"}
          </div>
          <div className="relative shrink-0">
            <button onClick={() => { setShowToSelector(!showToSelector); setShowFromSelector(false); setTokenSearch(""); }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all ${
                isDark ? "bg-slate-700/60 hover:bg-slate-600/80" : "bg-gray-200 hover:bg-gray-300"
              }`}>
              {effectiveToToken.logoURI ? (
                <img src={effectiveToToken.logoURI} alt={effectiveToToken.symbol} className="w-6 h-6 rounded-full shrink-0"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className={`w-6 h-6 rounded-full shrink-0 ${swapMode === "crossChain" ? "bg-gradient-to-br from-cyan-500 to-blue-500" : "bg-gradient-to-br from-pink-500 to-purple-500"}`} />
              )}
              <span className="font-bold text-sm">{effectiveToToken.symbol}</span>
              {swapMode === "crossChain" && dstChain && (
                <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${isDark ? "bg-cyan-900/30 text-cyan-400" : "bg-cyan-50 text-cyan-600"}`}>{dstChain?.name ?? "?"}</span>
              )}
              <ChevronDown className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`} />
            </button>
            {showToSelector && (
              <OneInchTokenSelector
                isOpen={showToSelector}
                onClose={() => { setShowToSelector(false); setTokenSearch(""); }}
                onSelect={t => {
                  if (swapMode === "crossChain") {
                    setCrossChainDstToken(t);
                    setShowToSelector(false);
                    setTokenSearch("");
                    setCrossChainQuote(null);
                    setToAmount("");
                    playVipButtonChime();
                  } else {
                    handleSelectToken(t, false);
                  }
                }}
                excludeAddress={swapMode === "crossChain" ? "" : fromToken.address}
                chainId={swapMode === "crossChain" ? dstChainId : selectedChainId}
                allTokens={swapMode === "crossChain" ? dstTokens : mergedTokens}
                enrichedTokens={swapMode === "crossChain" ? [] : enrichedTokens}
                isLoading={false}
              />
            )}
          </div>
        </div>
        <div className={`flex items-center justify-between mt-1`}>
          <span className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            {swapMode === "crossChain" ? `${dstChain?.name ?? "?"} network` : `${chain.name} network`}
          </span>
          {toAmount && parseFloat(toAmount.replace(/,/g, "")) > 0 && toPriceUsd !== null && toPriceUsd > 0 && (
            <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {formatUsd(parseFloat(toAmount.replace(/,/g, "")) * toPriceUsd)}
            </span>
          )}
        </div>
      </div>

      {/* Quote Error (classic or fusion) */}
      <AnimatePresence>
        {(quoteError || fusionQuoteError || crossChainQuoteError) && (() => {
          const errMsg = quoteError || fusionQuoteError || crossChainQuoteError || "";
          const isDeploymentError = errMsg.includes("deployment required") || errMsg.includes("make-server-54299934");
          return (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className={`flex items-start gap-2 p-3 rounded-xl text-xs mt-3 ${
                isDeploymentError
                  ? isDark
                    ? "bg-amber-900/20 text-amber-300 border border-amber-500/30"
                    : "bg-amber-50 text-amber-700 border border-amber-300"
                  : isDark
                    ? "bg-red-900/10 text-red-400 border border-red-500/20"
                    : "bg-red-50 text-red-600 border border-red-200"
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1 min-w-0">
                <span className="break-all leading-relaxed">{errMsg}</span>
                {isDeploymentError && (
                  <code className={`mt-1 px-2 py-1 rounded text-[10px] font-mono select-all ${
                    isDark ? "bg-black/30 text-amber-200" : "bg-amber-100 text-amber-800"
                  }`}>
                    supabase functions deploy make-server-54299934
                  </code>
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ═══ FUSION QUOTE DETAILS — Preset Selector + Gasless Badge ═══ */}
      <AnimatePresence>
        {swapMode === "fusion" && fusionQuote && !fusionQuoteLoading && fromAmount && parseFloat(fromAmount) > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className={`mt-4 p-3 rounded-xl ${isDark ? "bg-slate-800/30 border border-emerald-500/10" : "bg-gray-50 border border-emerald-100"}`}
          >
            {/* Header: Gasless badge + countdown */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <Zap className={`w-3.5 h-3.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
                <span className={`text-xs font-bold ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Fusion Swap
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-extrabold ${
                  isDark
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                    : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                }`}>
                  GASLESS
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Tip content="Quote auto-refreshes">
                  <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                    isDark ? "bg-slate-700/50 text-slate-400" : "bg-gray-100 text-gray-500"
                  }`}>
                    <Timer className="w-2.5 h-2.5" />
                    <span className="font-mono tabular-nums">{formatCountdown(fusionCountdown)}</span>
                  </div>
                </Tip>
              </div>
            </div>

            {/* Preset selector (fast / medium / slow) */}
            <div className="flex gap-1.5 mb-3">
              {fusionQuote.presets.map((preset) => (
                <button
                  key={preset.preset}
                  onClick={() => { setSelectedPreset(preset.preset); playVipButtonChime(); }}
                  className={`flex-1 p-2 rounded-lg text-center transition-all border ${
                    selectedPreset === preset.preset
                      ? isDark
                        ? "bg-gradient-to-b from-emerald-500/15 to-teal-500/10 border-emerald-500/30 shadow-lg shadow-emerald-500/5"
                        : "bg-gradient-to-b from-emerald-50 to-teal-50 border-emerald-300 shadow-sm"
                      : isDark
                        ? "bg-slate-800/30 border-slate-700/30 hover:border-slate-600/50"
                        : "bg-white border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-sm mb-0.5">{PRESET_ICONS[preset.preset]}</div>
                  <div className={`text-[10px] font-bold ${
                    selectedPreset === preset.preset
                      ? isDark ? "text-emerald-400" : "text-emerald-700"
                      : isDark ? "text-slate-300" : "text-gray-600"
                  }`}>
                    {PRESET_LABELS[preset.preset]}
                  </div>
                  <div className={`text-[9px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {preset.timeLabel}
                  </div>
                  <div className={`text-[10px] font-mono mt-0.5 ${
                    selectedPreset === preset.preset
                      ? isDark ? "text-white" : "text-gray-900"
                      : isDark ? "text-slate-400" : "text-gray-500"
                  }`}>
                    {formatFusionAmount(preset.dstAmount, toToken.decimals)}
                  </div>
                  {preset.isRecommended && (
                    <div className={`text-[8px] mt-0.5 font-bold ${
                      isDark ? "text-emerald-500" : "text-emerald-600"
                    }`}>
                      BEST
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Quote summary details */}
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Rate</span>
                <span>1 {fromToken.symbol} = {fusionRate ? (fusionRate >= 1 ? fusionRate.toFixed(6) : fusionRate.toFixed(8)) : "—"} {toToken.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Gas Cost</span>
                <span className={`flex items-center gap-1 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                  <Zap className="w-3 h-3" />
                  FREE — Resolver pays
                </span>
              </div>
              {fusionQuote.estimatedGasSaved && (
                <div className="flex justify-between">
                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>You Save</span>
                  <span className={isDark ? "text-emerald-400" : "text-emerald-600"}>
                    {estimateGasSavingsUsd(fusionQuote.estimatedGasSaved, selectedChainId)} in gas
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Fill Time</span>
                <span>{fusionQuote.presets.find(p => p.preset === selectedPreset)?.timeLabel ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Mode</span>
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-emerald-400" />
                  Intent-based (EIP-712 signature)
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ CLASSIC ROUTE + QUOTE DETAILS ═══ */}
      <AnimatePresence>
        {swapMode === "classic" && lastQuote && !quoteLoading && fromAmount && parseFloat(fromAmount) > 0 && (
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
        ) : swapStatus === "building" ? (
          <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-500 text-white cursor-wait">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Building Fusion order...
            </div>
          </button>
        ) : swapStatus === "signing" ? (
          <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-500 text-white cursor-wait">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Sign in wallet (no gas!)...
            </div>
          </button>
        ) : swapStatus === "submitting" ? (
          <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-500 text-white cursor-wait">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting to resolvers...
            </div>
          </button>
        ) : swapStatus === "polling" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            {/* Progress bar */}
            <div className={`w-full h-1.5 rounded-full overflow-hidden mb-3 ${
              isDark ? "bg-slate-700" : "bg-gray-200"
            }`}>
              <motion.div
                className={`h-full rounded-full ${
                  fusionOrderStatus === "assigned" || fusionOrderStatus === "executing"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                    : "bg-gradient-to-r from-emerald-600 to-teal-500"
                }`}
                initial={{ width: "10%" }}
                animate={{ width: `${(FUSION_STATUS_PROGRESS[fusionOrderStatus || "pending"] ?? 0.2) * 100}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>

            <button disabled className="w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-500 text-white cursor-wait">
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {FUSION_STATUS_ICONS[fusionOrderStatus || "pending"]}{" "}
                {FUSION_STATUS_LABELS[fusionOrderStatus || "pending"]}
              </div>
            </button>

            {/* Order details panel */}
            {lastSignedOrder && (
              <div className={`mt-2 p-2.5 rounded-lg text-xs space-y-1.5 ${
                isDark ? "bg-emerald-900/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"
              }`}>
                <div className="flex justify-between">
                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>Order Hash</span>
                  <span className="font-mono">{lastSignedOrder.orderHash.slice(0, 10)}...{lastSignedOrder.orderHash.slice(-6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>Status</span>
                  <span className={`font-medium ${
                    fusionOrderStatus === "assigned" || fusionOrderStatus === "executing"
                      ? isDark ? "text-emerald-400" : "text-emerald-600"
                      : isDark ? "text-slate-300" : "text-gray-600"
                  }`}>
                    {fusionOrderStatus ? fusionOrderStatus.charAt(0).toUpperCase() + fusionOrderStatus.slice(1) : "Pending"}
                  </span>
                </div>
                {fusionFillTxHash && (
                  <div className="flex justify-between">
                    <span className={isDark ? "text-slate-400" : "text-gray-500"}>Fill Tx</span>
                    <a href={`${chain.explorerUrl}/tx/${fusionFillTxHash}`} target="_blank" rel="noopener noreferrer"
                      className={`flex items-center gap-1 font-mono ${isDark ? "text-pink-400 hover:text-pink-300" : "text-pink-600 hover:text-pink-500"}`}>
                      {fusionFillTxHash.slice(0, 10)}...
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                )}
                <div className={`flex items-center gap-1.5 mt-1 pt-1.5 border-t ${
                  isDark ? "border-emerald-500/10 text-emerald-400" : "border-emerald-200 text-emerald-600"
                }`}>
                  <Zap className="w-3 h-3" />
                  <span className="text-[10px]">Gasless — resolvers pay all gas fees</span>
                </div>
              </div>
            )}
          </motion.div>
        ) : swapStatus === "success" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <button disabled className={`w-full py-3.5 rounded-xl font-bold text-white ${
              fusionOrderStatus === "filled"
                ? "bg-gradient-to-r from-emerald-600 to-teal-500"
                : "bg-gradient-to-r from-emerald-600 to-green-500"
            }`}>
              <div className="flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                {fusionOrderStatus === "filled" ? (
                  <><Zap className="w-3.5 h-3.5" /> Gasless Swap Complete!</>
                ) : (
                  "Swap Complete!"
                )}
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
            {fusionOrderStatus === "filled" && (
              <div className={`flex items-center justify-center gap-1.5 mt-1.5 text-[10px] ${
                isDark ? "text-emerald-400/70" : "text-emerald-600/70"
              }`}>
                <Zap className="w-2.5 h-2.5" />
                You paid zero gas — resolver covered all fees
              </div>
            )}
            <button onClick={() => { setSwapStatus("idle"); setFromAmount(""); setToAmount(""); setLastQuote(null); setLastSignedOrder(null); setFusionQuote(null); setFusionOrderStatus(null); setFusionFillTxHash(null); stopFusionPolling(); }}
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
            <button onClick={() => { setSwapStatus("idle"); setSwapError(null); setLastSignedOrder(null); setFusionOrderStatus(null); setFusionFillTxHash(null); setCrossChainOrderHash(null); setCrossChainBuildData(null); stopFusionPolling(); stopCrossChainPolling(); }}
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
              insufficientBalance
                ? isDark ? "bg-red-900/60 text-red-300 shadow-none cursor-not-allowed border border-red-500/30" : "bg-red-100 text-red-600 shadow-none cursor-not-allowed border border-red-300"
                : !canSwap
                ? isDark ? "bg-slate-700 text-slate-500 shadow-none cursor-not-allowed" : "bg-gray-300 text-gray-500 shadow-none cursor-not-allowed"
                : swapMode === "crossChain"
                  ? "bg-gradient-to-r from-cyan-600 to-blue-500 hover:from-cyan-500 hover:to-blue-400 shadow-cyan-500/30"
                  : swapMode === "fusion"
                    ? "bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-emerald-500/30"
                    : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-pink-500/30"
            }`}
          >
            {!fromAmount || parseFloat(fromAmount) <= 0
              ? "Enter an amount"
              : insufficientBalance
                ? `Insufficient ${fromToken.symbol} Balance`
              : swapMode === "crossChain" && !evmAccount
                ? "Connect wallet for Cross-Chain"
                : swapMode === "crossChain" && !crossChainQuote
                  ? crossChainQuoteLoading ? "Finding cross-chain resolvers..." : "Enter amount for quote"
                  : swapMode === "fusion" && !evmAccount
                    ? "Connect wallet for Fusion"
                    : swapMode === "fusion" && !fusionQuote
                      ? fusionQuoteLoading ? "Finding resolvers..." : "Enter amount for quote"
                      : swapMode === "classic" && !lastQuote
                        ? "Fetching quote..."
                        : swapMode === "crossChain"
                          ? `🌐 Cross-Chain ${fromToken.symbol} → ${effectiveToToken.symbol}`
                          : swapMode === "fusion"
                            ? `⚡ Gasless Swap ${fromToken.symbol} → ${toToken.symbol}`
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
              1inch {swapMode === "crossChain" ? "Fusion+" : swapMode === "fusion" ? "Fusion" : swapMode === "limit" ? "Limit" : "Classic"} · {swapMode === "crossChain" ? `${chain.name} → ${dstChain?.name ?? "?"}` : chain.name}
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

    {/* ═══ FUSION ORDER TRACKER (Step 8) — separate card below widget ═══ */}
    <OneInchOrderTracker evmAccount={evmAccount} chainId={selectedChainId} isDark={isDark} />
    </>
  );
}
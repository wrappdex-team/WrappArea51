/**
 * Stargate Bridge Widget — Full on-site cross-chain bridge via LayerZero.
 *
 * Connects the user's EVM wallet (MetaMask) and executes Stargate V2
 * bridge transactions directly on this site — no redirect to stargate.finance.
 *
 * Flow: Connect Wallet → Select Route → Quote → Approve → Bridge → Track
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  ExternalLink,
  ChevronDown,
  Loader2,
  ArrowUpDown,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
} from "lucide-react";
import {
  isMetaMaskInstalled,
  requestAccounts,
  getChainId,
  switchChain,
  formatAddress,
  isMobileBrowser,
  getMetaMaskDeepLink,
} from "../utils/metamask";
import {
  LZ_ENDPOINT_IDS,
  STARGATE_POOLS,
  isRouteSupported,
  getTokenBalance,
  checkAllowance,
  approveToken,
  quoteBridge,
  executeBridge,
  getExplorerTxUrl,
  getLzScanUrl,
  getSupportedTokens,
  type StargateQuote,
  type BridgeStep,
} from "../utils/stargate";
import { Tip } from "./Tip";

interface StargateBridgeWidgetProps {
  onClose: () => void;
  isDark: boolean;
}

/* ── Chain definitions ─────────────────────────────────── */

interface Chain {
  id: number;
  name: string;
  icon: string;
  color: string;
  nativeSymbol: string;
}

const ALL_CHAINS: Chain[] = [
  { id: 1, name: "Ethereum", icon: "\u039E", color: "#627EEA", nativeSymbol: "ETH" },
  { id: 42161, name: "Arbitrum", icon: "A", color: "#28A0F0", nativeSymbol: "ETH" },
  { id: 10, name: "Optimism", icon: "O", color: "#FF0420", nativeSymbol: "ETH" },
  { id: 137, name: "Polygon", icon: "P", color: "#8247E5", nativeSymbol: "POL" },
  { id: 56, name: "BNB Chain", icon: "B", color: "#F3BA2F", nativeSymbol: "BNB" },
  { id: 43114, name: "Avalanche", icon: "A", color: "#E84142", nativeSymbol: "AVAX" },
  { id: 8453, name: "Base", icon: "B", color: "#0052FF", nativeSymbol: "ETH" },
  { id: 59144, name: "Linea", icon: "L", color: "#61DFFF", nativeSymbol: "ETH" },
  { id: 5000, name: "Mantle", icon: "M", color: "#000000", nativeSymbol: "MNT" },
  { id: 534352, name: "Scroll", icon: "S", color: "#FFEEDA", nativeSymbol: "ETH" },
  { id: 250, name: "Fantom", icon: "F", color: "#1969FF", nativeSymbol: "FTM" },
  { id: 1088, name: "Metis", icon: "M", color: "#00DACC", nativeSymbol: "METIS" },
  { id: 324, name: "zkSync Era", icon: "Z", color: "#8C8DFC", nativeSymbol: "ETH" },
  { id: 2222, name: "Kava", icon: "K", color: "#FF564F", nativeSymbol: "KAVA" },
  { id: 204, name: "opBNB", icon: "O", color: "#F3BA2F", nativeSymbol: "BNB" },
  { id: 1116, name: "Core", icon: "C", color: "#FF9211", nativeSymbol: "CORE" },
  { id: 1329, name: "Sei", icon: "S", color: "#9B1C2E", nativeSymbol: "SEI" },
  { id: 196, name: "X Layer", icon: "X", color: "#000000", nativeSymbol: "OKB" },
];

/* ── Token definitions ─────────────────────────────────── */

interface Token {
  symbol: string;
  name: string;
  decimals: number;
  color: string;
}

const ALL_TOKENS: Token[] = [
  { symbol: "USDC", name: "USD Coin", decimals: 6, color: "#2775CA" },
  { symbol: "USDT", name: "Tether", decimals: 6, color: "#26A17B" },
  { symbol: "ETH", name: "Ethereum", decimals: 18, color: "#627EEA" },
  { symbol: "mETH", name: "Mantle Staked ETH", decimals: 18, color: "#C35BFF" },
  { symbol: "METIS", name: "Metis", decimals: 18, color: "#00DACC" },
];

/* ── Step labels for UI ───────────────────────────────── */

const STEP_LABELS: Record<BridgeStep, string> = {
  idle: "",
  "switching-chain": "Switching chain...",
  "checking-balance": "Checking balance...",
  approving: "Approve token in wallet...",
  "approval-pending": "Waiting for approval...",
  quoting: "Fetching bridge quote...",
  sending: "Confirm bridge in wallet...",
  "tx-pending": "Transaction pending...",
  success: "Bridge successful!",
  error: "Transaction failed",
};

/* ── Component ─────────────────────────────────────────── */

export function StargateBridgeWidget({ onClose, isDark }: StargateBridgeWidgetProps) {
  // Wallet state
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number>(0);

  // Route state
  const [srcChain, setSrcChain] = useState<Chain>(ALL_CHAINS[0]);
  const [dstChain, setDstChain] = useState<Chain>(ALL_CHAINS[1]);
  const [token, setToken] = useState<Token>(ALL_TOKENS[0]);
  const [amount, setAmount] = useState("");

  // Quote state
  const [quote, setQuote] = useState<StargateQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  // Bridge execution state
  const [bridgeStep, setBridgeStep] = useState<BridgeStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState("");
  const [userBalance, setUserBalance] = useState<string | null>(null);

  // Dropdowns
  const [showSrcChains, setShowSrcChains] = useState(false);
  const [showDstChains, setShowDstChains] = useState(false);
  const [showTokens, setShowTokens] = useState(false);

  // Copy state
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Close dropdowns on outside click ──
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSrcChains(false);
        setShowDstChains(false);
        setShowTokens(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Listen for wallet events ──
  useEffect(() => {
    if (!window.ethereum) return;
    const eth = window.ethereum as any;

    const handleAccounts = (accs: string[]) => {
      if (accs.length === 0) setWalletAddress(null);
      else setWalletAddress(accs[0]);
    };
    const handleChain = (hexId: string) => {
      setWalletChainId(parseInt(hexId, 16));
    };

    eth.on("accountsChanged", handleAccounts);
    eth.on("chainChanged", handleChain);
    return () => {
      eth.removeListener("accountsChanged", handleAccounts);
      eth.removeListener("chainChanged", handleChain);
    };
  }, []);

  // ── Check if already connected on mount ──
  useEffect(() => {
    (async () => {
      if (!isMetaMaskInstalled()) return;
      try {
        const accs = await (window.ethereum as any).request({ method: "eth_accounts" });
        if (accs?.length) {
          setWalletAddress(accs[0]);
          const chainHex = await (window.ethereum as any).request({ method: "eth_chainId" });
          setWalletChainId(parseInt(chainHex, 16));
        }
      } catch { /* silent */ }
    })();
  }, []);

  // ── Fetch balance when wallet/chain/token changes ──
  useEffect(() => {
    if (!walletAddress || walletChainId !== srcChain.id) {
      setUserBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const bal = await getTokenBalance(walletAddress, srcChain.id, token.symbol, token.decimals);
        if (!cancelled) setUserBalance(parseFloat(bal.formatted).toFixed(token.decimals === 18 ? 6 : 2));
      } catch {
        if (!cancelled) setUserBalance(null);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress, walletChainId, srcChain.id, token.symbol, token.decimals]);

  // ── Debounced quote fetching ──
  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    setQuote(null);
    setQuoteError("");

    const amountNum = parseFloat(amount);
    if (!amount || amountNum <= 0 || srcChain.id === dstChain.id) return;
    if (!walletAddress) return;
    if (!isRouteSupported(srcChain.id, dstChain.id, token.symbol)) {
      setQuoteError(`${token.symbol} bridge not available on this route`);
      return;
    }

    setQuoteLoading(true);
    quoteTimerRef.current = setTimeout(async () => {
      try {
        // Make sure we're on the right chain before quoting
        if (walletChainId !== srcChain.id) {
          setQuoteLoading(false);
          setQuoteError("Switch to source chain to get a quote");
          return;
        }
        const amountRaw = BigInt(Math.floor(amountNum * 10 ** token.decimals));
        const result = await quoteBridge(srcChain.id, dstChain.id, token.symbol, amountRaw, walletAddress, token.decimals);
        setQuote(result);
        setQuoteError("");
      } catch (err: any) {
        setQuoteError(err?.message?.slice(0, 80) || "Failed to get quote");
      }
      setQuoteLoading(false);
    }, 800);

    return () => {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    };
  }, [amount, srcChain.id, dstChain.id, token.symbol, token.decimals, walletAddress, walletChainId]);

  // ── Connect wallet ──
  // On mobile, MetaMask's browser extension isn't available — the user must
  // open this dApp inside MetaMask Mobile's in-app browser, where
  // window.ethereum IS injected. We use metamask.app.link deep link to
  // trigger this. On desktop, fallback to the download page.
  const handleConnect = useCallback(async () => {
    if (!isMetaMaskInstalled()) {
      if (isMobileBrowser()) {
        // Deep-link into MetaMask Mobile's in-app browser.
        // window.location.href (not window.open) is required to reliably
        // trigger app-scheme handling on iOS/Android and avoid popup blockers.
        window.location.href = getMetaMaskDeepLink();
      } else {
        window.open("https://metamask.io/download/", "_blank", "noopener,noreferrer");
      }
      return;
    }
    try {
      const accounts = await requestAccounts();
      if (accounts.length) {
        setWalletAddress(accounts[0]);
        const cid = await getChainId();
        setWalletChainId(cid);
      }
    } catch (err: any) {
      setBridgeError(err.message || "Failed to connect wallet");
    }
  }, []);

  // ── Swap chains ──
  const handleSwapChains = useCallback(() => {
    setSrcChain(dstChain);
    setDstChain(srcChain);
  }, [srcChain, dstChain]);

  // ── Chain selection ──
  const selectSrcChain = useCallback((chain: Chain) => {
    if (chain.id === dstChain.id) setDstChain(srcChain);
    setSrcChain(chain);
    setShowSrcChains(false);
  }, [dstChain, srcChain]);

  const selectDstChain = useCallback((chain: Chain) => {
    if (chain.id === srcChain.id) setSrcChain(dstChain);
    setDstChain(chain);
    setShowDstChains(false);
  }, [srcChain, dstChain]);

  // ── Copy tx hash ──
  const handleCopyTx = useCallback(() => {
    if (!txHash) return;
    navigator.clipboard.writeText(txHash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [txHash]);

  // ── Full bridge execution ──
  const handleBridge = useCallback(async () => {
    if (!walletAddress || !amount) return;
    const amountNum = parseFloat(amount);
    if (amountNum <= 0) return;

    setBridgeError("");
    setTxHash(null);

    try {
      // 1. Switch chain if needed
      if (walletChainId !== srcChain.id) {
        setBridgeStep("switching-chain");
        const switched = await switchChain(srcChain.id);
        if (!switched) throw new Error("Failed to switch chain. Please switch manually in your wallet.");
        setWalletChainId(srcChain.id);
        // Small delay for chain switch to propagate
        await new Promise(r => setTimeout(r, 1500));
      }

      // 2. Check balance
      setBridgeStep("checking-balance");
      const amountRaw = BigInt(Math.floor(amountNum * 10 ** token.decimals));
      const balance = await getTokenBalance(walletAddress, srcChain.id, token.symbol, token.decimals);
      if (balance.raw < amountRaw) {
        throw new Error(`Insufficient ${token.symbol} balance. You have ${parseFloat(balance.formatted).toFixed(4)} ${token.symbol}`);
      }

      // 3. Check & approve token (skip for native ETH)
      if (token.symbol !== "ETH") {
        setBridgeStep("checking-balance");
        const allowance = await checkAllowance(walletAddress, srcChain.id, token.symbol);
        if (allowance < amountRaw) {
          setBridgeStep("approving");
          await approveToken(srcChain.id, token.symbol, walletAddress);
          setBridgeStep("approval-pending");
          // Small delay for state update
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // 4. Get fresh quote
      setBridgeStep("quoting");
      const freshQuote = await quoteBridge(srcChain.id, dstChain.id, token.symbol, amountRaw, walletAddress, token.decimals);
      setQuote(freshQuote);

      // 5. Execute bridge
      setBridgeStep("sending");
      const result = await executeBridge(
        srcChain.id,
        dstChain.id,
        token.symbol,
        amountRaw,
        walletAddress,
        freshQuote.nativeFee,
        freshQuote.minAmountOut,
      );

      setTxHash(result.txHash);
      setBridgeStep("success");
    } catch (err: any) {
      const msg = err?.reason || err?.message || "Bridge transaction failed";
      // Clean up ethers error messages
      const cleanMsg = msg.includes("user rejected")
        ? "Transaction rejected by user"
        : msg.includes("insufficient funds")
        ? "Insufficient funds for gas + bridge amount"
        : msg.length > 120
        ? msg.slice(0, 120) + "..."
        : msg;
      setBridgeError(cleanMsg);
      setBridgeStep("error");
    }
  }, [walletAddress, walletChainId, srcChain, dstChain, token, amount]);

  // ── Reset after error or success ──
  const handleReset = useCallback(() => {
    setBridgeStep("idle");
    setBridgeError("");
    setTxHash(null);
  }, []);

  // ── Derived state ──
  const hasValidAmount = !!amount && parseFloat(amount) > 0;
  const isSameChain = srcChain.id === dstChain.id;
  const routeSupported = isRouteSupported(srcChain.id, dstChain.id, token.symbol);
  const needsChainSwitch = walletAddress && walletChainId !== srcChain.id;
  const isExecuting = !["idle", "success", "error"].includes(bridgeStep);

  return (
    <div className="w-full" ref={containerRef}>
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            walletAddress
              ? "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]"
              : "bg-slate-500"
          }`} />
          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {walletAddress ? `Stargate V2 — ${formatAddress(walletAddress)}` : "Stargate V2 — Not Connected"}
          </span>
        </div>
        <button
          onClick={onClose}
          className={`p-1.5 rounded-lg transition-colors ${
            isDark
              ? "hover:bg-white/[0.06] text-slate-500 hover:text-slate-300"
              : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          }`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Main card ── */}
      <div className={`rounded-2xl overflow-visible ${
        isDark
          ? "bg-[#0D0D12] border border-white/[0.06]"
          : "bg-white border border-gray-200 shadow-lg"
      }`}>
        <div className="p-5 space-y-4">

          {/* ══ SUCCESS STATE ══ */}
          {bridgeStep === "success" && txHash && (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-cyan-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-cyan-400" />
              </div>
              <div>
                <h4 className="text-lg font-bold mb-1">Bridge Initiated!</h4>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  {amount} {token.symbol}: {srcChain.name} → {dstChain.name}
                </p>
              </div>
              <div className={`rounded-xl p-3 text-left space-y-2 ${isDark ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Tx Hash</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono">{txHash.slice(0, 10)}...{txHash.slice(-6)}</span>
                    <button onClick={handleCopyTx} className="p-0.5">
                      {copied ? <Check className="w-3 h-3 text-cyan-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <a href={getExplorerTxUrl(txHash, srcChain.id)} target="_blank" rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 transition-colors">
                    <ExternalLink className="w-3 h-3" /> Explorer
                  </a>
                  <a href={getLzScanUrl(txHash)} target="_blank" rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 transition-colors">
                    <ExternalLink className="w-3 h-3" /> LayerZero Scan
                  </a>
                </div>
              </div>
              <button onClick={handleReset}
                className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white transition-all">
                New Bridge
              </button>
            </div>
          )}

          {/* ══ ERROR STATE ══ */}
          {bridgeStep === "error" && (
            <div className="text-center py-6 space-y-4">
              <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7 text-red-400" />
              </div>
              <div>
                <h4 className="text-lg font-bold mb-1">Bridge Failed</h4>
                <p className={`text-sm max-w-xs mx-auto ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  {bridgeError}
                </p>
              </div>
              <button onClick={handleReset}
                className={`w-full py-3 rounded-xl font-bold transition-all ${
                  isDark ? "bg-white/[0.06] hover:bg-white/[0.1] text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}>
                Try Again
              </button>
            </div>
          )}

          {/* ══ EXECUTING STATE ══ */}
          {isExecuting && (
            <div className="text-center py-8 space-y-4">
              <Loader2 className="w-10 h-10 animate-spin text-cyan-400 mx-auto" />
              <div>
                <h4 className="font-bold mb-1">{STEP_LABELS[bridgeStep]}</h4>
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {bridgeStep === "approving" || bridgeStep === "sending"
                    ? "Please confirm in your wallet"
                    : "Please wait..."
                  }
                </p>
              </div>
              {/* Step progress */}
              <div className="flex items-center justify-center gap-1.5">
                {["switching-chain", "checking-balance", "approving", "quoting", "sending"].map((step, i) => (
                  <div
                    key={step}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      step === bridgeStep
                        ? "w-6 bg-cyan-400"
                        : ["switching-chain", "checking-balance", "approving", "approval-pending", "quoting", "sending"]
                            .indexOf(bridgeStep) > i
                          ? "w-3 bg-cyan-600"
                          : `w-3 ${isDark ? "bg-white/[0.08]" : "bg-gray-200"}`
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ══ MAIN FORM (idle state) ══ */}
          {bridgeStep === "idle" && (
            <>
              {/* ── Token selector ── */}
              <div className="relative">
                <label className={`text-[10px] uppercase tracking-wider mb-1.5 block ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Token
                </label>
                <button
                  onClick={() => { setShowTokens(!showTokens); setShowSrcChains(false); setShowDstChains(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors ${
                    isDark
                      ? "bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08]"
                      : "bg-gray-50 hover:bg-gray-100 border border-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                      style={{ backgroundColor: token.color }}>
                      {token.symbol[0]}
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-bold">{token.symbol}</div>
                      <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{token.name}</div>
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showTokens ? "rotate-180" : ""} ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                </button>
                {showTokens && (
                  <div className={`absolute left-0 right-0 top-full mt-1 rounded-xl z-30 overflow-hidden shadow-xl ${
                    isDark ? "bg-[#1a1a24] border border-white/[0.08]" : "bg-white border border-gray-200"
                  }`}>
                    {ALL_TOKENS.map((t) => {
                      const supported = getSupportedTokens(srcChain.id).includes(t.symbol);
                      return (
                        <button
                          key={t.symbol}
                          disabled={!supported}
                          onClick={() => { if (supported) { setToken(t); setShowTokens(false); } }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors ${
                            !supported
                              ? "opacity-30 cursor-not-allowed"
                              : t.symbol === token.symbol
                              ? isDark ? "bg-cyan-500/10" : "bg-cyan-50"
                              : isDark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50"
                          }`}
                        >
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                            style={{ backgroundColor: t.color }}>
                            {t.symbol[0]}
                          </div>
                          <span className="text-sm">{t.symbol}</span>
                          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{t.name}</span>
                          {!supported && <span className="text-[9px] text-red-400 ml-auto">N/A</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Source chain + Amount ── */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    From
                  </label>
                  {userBalance !== null && (
                    <button
                      onClick={() => setAmount(userBalance)}
                      className={`text-[10px] ${isDark ? "text-cyan-400/70 hover:text-cyan-400" : "text-cyan-600 hover:text-cyan-700"} transition-colors`}
                    >
                      Balance: {userBalance} {token.symbol}
                    </button>
                  )}
                </div>
                <div className={`rounded-xl overflow-visible ${
                  isDark ? "bg-white/[0.04] border border-white/[0.08]" : "bg-gray-50 border border-gray-200"
                }`}>
                  <div className="relative">
                    <button
                      onClick={() => { setShowSrcChains(!showSrcChains); setShowDstChains(false); setShowTokens(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 transition-colors ${
                        isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-100"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ backgroundColor: srcChain.color }}>
                          {srcChain.icon}
                        </div>
                        <span className="text-sm">{srcChain.name}</span>
                        {needsChainSwitch && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-400">
                            Switch needed
                          </span>
                        )}
                      </div>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSrcChains ? "rotate-180" : ""} ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                    </button>
                    {showSrcChains && (
                      <div className={`absolute left-0 right-0 top-full mt-0.5 rounded-xl z-30 max-h-48 overflow-y-auto shadow-xl ${
                        isDark ? "bg-[#1a1a24] border border-white/[0.08]" : "bg-white border border-gray-200"
                      }`}>
                        {ALL_CHAINS.map((c) => {
                          const hasToken = getSupportedTokens(c.id).includes(token.symbol);
                          return (
                            <button
                              key={c.id}
                              disabled={!hasToken}
                              onClick={() => { if (hasToken) selectSrcChain(c); }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                                !hasToken
                                  ? "opacity-30 cursor-not-allowed"
                                  : c.id === srcChain.id
                                  ? isDark ? "bg-cyan-500/10" : "bg-cyan-50"
                                  : isDark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50"
                              }`}
                            >
                              <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                                style={{ backgroundColor: c.color }}>
                                {c.icon}
                              </div>
                              {c.name}
                              {!hasToken && <span className="text-[9px] text-slate-500 ml-auto">No {token.symbol}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className={`border-t ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      min="0"
                      step="any"
                      disabled={isExecuting}
                      className={`w-full px-3 py-3 text-lg bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                        isDark ? "text-white placeholder:text-slate-600" : "text-gray-900 placeholder:text-gray-300"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* ── Swap button ── */}
              <div className="flex justify-center -my-1">
                <button
                  onClick={handleSwapChains}
                  className={`p-2 rounded-full transition-all duration-200 ${
                    isDark
                      ? "bg-white/[0.06] hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-400 border border-white/[0.08]"
                      : "bg-gray-100 hover:bg-cyan-50 text-gray-400 hover:text-cyan-600 border border-gray-200"
                  }`}
                >
                  <ArrowUpDown className="w-4 h-4" />
                </button>
              </div>

              {/* ── Destination chain ── */}
              <div>
                <label className={`text-[10px] uppercase tracking-wider mb-1.5 block ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  To
                </label>
                <div className={`rounded-xl overflow-visible ${
                  isDark ? "bg-white/[0.04] border border-white/[0.08]" : "bg-gray-50 border border-gray-200"
                }`}>
                  <div className="relative">
                    <button
                      onClick={() => { setShowDstChains(!showDstChains); setShowSrcChains(false); setShowTokens(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 transition-colors ${
                        isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-100"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ backgroundColor: dstChain.color }}>
                          {dstChain.icon}
                        </div>
                        <span className="text-sm">{dstChain.name}</span>
                      </div>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDstChains ? "rotate-180" : ""} ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                    </button>
                    {showDstChains && (
                      <div className={`absolute left-0 right-0 top-full mt-0.5 rounded-xl z-30 max-h-48 overflow-y-auto shadow-xl ${
                        isDark ? "bg-[#1a1a24] border border-white/[0.08]" : "bg-white border border-gray-200"
                      }`}>
                        {ALL_CHAINS.filter(c => c.id !== srcChain.id).map((c) => {
                          const hasPool = !!STARGATE_POOLS[c.id]?.[token.symbol];
                          return (
                            <button
                              key={c.id}
                              disabled={!hasPool}
                              onClick={() => { if (hasPool) selectDstChain(c); }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                                !hasPool
                                  ? "opacity-30 cursor-not-allowed"
                                  : c.id === dstChain.id
                                  ? isDark ? "bg-cyan-500/10" : "bg-cyan-50"
                                  : isDark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50"
                              }`}
                            >
                              <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                                style={{ backgroundColor: c.color }}>
                                {c.icon}
                              </div>
                              {c.name}
                              {!hasPool && <span className="text-[9px] text-slate-500 ml-auto">No {token.symbol}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className={`border-t px-3 py-3 ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}>
                    {quoteLoading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                        <span className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>Fetching quote...</span>
                      </div>
                    ) : quote ? (
                      <div className="text-lg">
                        {parseFloat(quote.amountOutFormatted).toFixed(token.decimals === 18 ? 6 : 2)}
                        <span className={`text-sm ml-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{token.symbol}</span>
                      </div>
                    ) : hasValidAmount && !isSameChain ? (
                      <div className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        {quoteError || (walletAddress ? "Enter amount for quote" : "Connect wallet for quote")}
                      </div>
                    ) : (
                      <div className={`text-lg ${isDark ? "text-slate-600" : "text-gray-300"}`}>0.00</div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Quote details ── */}
              {quote && hasValidAmount && !isSameChain && (
                <div className={`rounded-xl p-3 space-y-2 ${
                  isDark ? "bg-white/[0.02] border border-white/[0.04]" : "bg-gray-50 border border-gray-100"
                }`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className={isDark ? "text-slate-500" : "text-gray-400"}>Messaging Fee</span>
                    <span className={isDark ? "text-slate-300" : "text-gray-600"}>
                      {parseFloat(quote.nativeFeeFormatted).toFixed(6)} {srcChain.nativeSymbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={isDark ? "text-slate-500" : "text-gray-400"}>You Receive</span>
                    <span className="text-cyan-400">
                      {parseFloat(quote.amountOutFormatted).toFixed(token.decimals === 18 ? 6 : 2)} {token.symbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={isDark ? "text-slate-500" : "text-gray-400"}>Slippage</span>
                    <span className={isDark ? "text-slate-300" : "text-gray-600"}>0.5%</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={isDark ? "text-slate-500" : "text-gray-400"}>Protocol</span>
                    <span className="text-cyan-400">Stargate V2 (LayerZero)</span>
                  </div>
                </div>
              )}

              {/* ── Warnings ── */}
              {isSameChain && (
                <div className={`text-center text-xs py-2 rounded-lg ${
                  isDark ? "bg-amber-500/10 text-amber-400/70" : "bg-amber-50 text-amber-600"
                }`}>
                  Source and destination must be different chains
                </div>
              )}
              {!routeSupported && hasValidAmount && !isSameChain && (
                <div className={`text-center text-xs py-2 rounded-lg ${
                  isDark ? "bg-amber-500/10 text-amber-400/70" : "bg-amber-50 text-amber-600"
                }`}>
                  {token.symbol} is not available for this chain pair on Stargate V2
                </div>
              )}

              {/* ── Action Button ── */}
              {!walletAddress ? (
                <button
                  onClick={handleConnect}
                  className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white transition-all shadow-lg shadow-cyan-500/20"
                >
                  <Wallet className="w-4 h-4" />
                  {isMetaMaskInstalled()
                    ? "Connect Wallet"
                    : isMobileBrowser()
                      ? "Open in MetaMask"
                      : "Install MetaMask"}
                </button>
              ) : needsChainSwitch && hasValidAmount && routeSupported ? (
                <button
                  onClick={handleBridge}
                  className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white transition-all shadow-lg shadow-amber-500/20"
                >
                  Switch to {srcChain.name} & Bridge
                </button>
              ) : (
                <button
                  onClick={handleBridge}
                  disabled={!hasValidAmount || isSameChain || !routeSupported || !quote}
                  className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-bold transition-all duration-300 ${
                    hasValidAmount && !isSameChain && routeSupported && quote
                      ? "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20"
                      : isDark
                      ? "bg-white/[0.06] text-slate-500 cursor-not-allowed"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  {hasValidAmount && !isSameChain && routeSupported
                    ? quote
                      ? `Bridge ${amount} ${token.symbol}`
                      : "Getting quote..."
                    : "Enter amount to bridge"
                  }
                </button>
              )}

              {/* ── Supported chains row ── */}
              <div className="pt-1">
                <div className={`text-[10px] uppercase tracking-wider text-center mb-1.5 ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                  {ALL_CHAINS.length} Supported Chains
                </div>
                <div className="flex flex-wrap justify-center gap-1">
                  {ALL_CHAINS.map((c) => (
                    <Tip key={c.id} content={c.name} side="top">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                      style={{ backgroundColor: c.color, opacity: 0.7 }}
                    >
                      {c.icon}
                    </div>
                    </Tip>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className={`mt-2 flex items-center justify-center gap-3 text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
        <span>Powered by Stargate V2 & LayerZero</span>
        <a href="https://stargate.finance/bridge" target="_blank" rel="noopener noreferrer"
          className={`flex items-center gap-0.5 transition-colors ${isDark ? "hover:text-slate-400" : "hover:text-gray-600"}`}>
          Stargate <ExternalLink className="w-2.5 h-2.5" />
        </a>
        <a href="https://layerzeroscan.com" target="_blank" rel="noopener noreferrer"
          className={`flex items-center gap-0.5 transition-colors ${isDark ? "hover:text-slate-400" : "hover:text-gray-600"}`}>
          LZ Scan <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
    </div>
  );
}
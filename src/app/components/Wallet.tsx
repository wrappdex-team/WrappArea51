import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  ExternalLink,
  X,
  RefreshCw,
  Loader2,
  Wallet as WalletIcon,
  Clock,
  ChevronDown,
  ChevronUp,
  Search,
  Unplug,
  Vote,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { copyToClipboard as copyText } from "../utils/clipboard";
import {
  formatAddress,
  getExplorerAddressUrl,
  fetchERC20Balances,
  type ERC20Balance,
  fetchEvmTransactions,
  type EvmTransaction,
  getExplorerTxUrl,
  CHAIN_INFO,
  enrichEvmTransactions,
} from "../utils/metamask";
import {
  HBARH_LOGO_DARK,
  HBARH_LOGO_LIGHT,
  HBARH_BRANDING_DARK,
  HBARH_BRANDING_LIGHT,
  HASHPACK_LOGO,
  METAMASK_LOGO,
} from "../assets/brand";
import {
  formatHbar,
  getHashScanAccountUrl,
  fetchRecentTransactions,
  fetchHbarhBalance,
  type HbarhDirectBalance,
  fetchTokenDirectBalance,
  type TokenDirectBalance,
} from "../utils/hedera";
import type { HederaTransaction } from "../utils/hedera";
import {
  fetchHbarhTokenPrice as fetchHbarhPriceSaucer,
  fetchLPTokenPrice,
  LP_TOKEN_WHBAR_HBARH,
} from "../utils/saucerswap";
import { maxVotesForBalance } from "../utils/dao";

const HBARH_TOKEN_ID = "0.0.9356476";
const WBTC_TOKEN_ID = "0.0.1055483";
const SS_LP_TOKEN_ID = LP_TOKEN_WHBAR_HBARH.tokenId; // "0.0.9356724"

const TOKEN_LOGOS: Record<string, string> = {
  HBAR: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  WBTC: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
};

function getTokenLogo(symbol: string, tokenId?: string, isDark = true): string | null {
  if (tokenId === HBARH_TOKEN_ID || symbol === "HBAR.ħ" || symbol === "HBARh") return isDark ? HBARH_LOGO_DARK : HBARH_LOGO_LIGHT;
  if (tokenId === WBTC_TOKEN_ID || symbol === "WBTC") return TOKEN_LOGOS.WBTC;
  return TOKEN_LOGOS[symbol] || null;
}

const CONNECTOR_LOGOS: Record<string, string> = {
  MetaMask: METAMASK_LOGO,
};

// Donut chart colors
const CHART_COLORS = [
  "#ec4899", "#a855f7", "#3b82f6", "#f59e0b", "#10b981",
  "#f43f5e", "#8b5cf6", "#06b6d4", "#f97316", "#14b8a6",
];

// ── Donut Chart Component ──────────────────────────────────────────────
function AllocationDonut({
  data,
  isDark,
}: {
  data: Array<{ name: string; value: number; color: string }>;
  isDark: boolean;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
          No priced assets
        </span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
          dataKey="value"
          stroke="none"
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: isDark ? "#0f0f1a" : "#fff",
            border: isDark ? "1px solid rgba(236,72,153,0.2)" : "1px solid #e5e7eb",
            borderRadius: 8,
            fontSize: 12,
            padding: "6px 10px",
          }}
          formatter={(value: number) => [`$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, ""]}
          labelStyle={{ fontWeight: 700 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Chart Legend ──────────────────────────────────────────────────────
function ChartLegend({
  data,
  isDark,
}: {
  data: Array<{ name: string; value: number; color: string }>;
  isDark: boolean;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {data.map((d) => (
        <div key={d.name} className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
          <span className={`text-[10px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            {d.name} {total > 0 ? `${((d.value / total) * 100).toFixed(0)}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Wallet() {
  const [copied, setCopied] = useState<string | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingMM, setIsRefreshingMM] = useState(false);
  const [recentTxns, setRecentTxns] = useState<HederaTransaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [tokenFilter, setTokenFilter] = useState("");
  const [showAllTokens, setShowAllTokens] = useState(false);
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [erc20Balances, setErc20Balances] = useState<ERC20Balance[]>([]);
  const [loadingErc20, setLoadingErc20] = useState(false);
  const [hbarhPrice, setHbarhPrice] = useState<number>(0);
  const [lpTokenPrice, setLpTokenPrice] = useState<number>(0);
  const [lpTokenPriceSource, setLpTokenPriceSource] = useState<string>("");

  // Direct LP token balance from Mirror Node
  const [lpDirect, setLpDirect] = useState<TokenDirectBalance | null>(null);

  // EVM transaction history
  const [evmTxns, setEvmTxns] = useState<EvmTransaction[]>([]);
  const [loadingEvmTxns, setLoadingEvmTxns] = useState(false);
  const [showAllEvmTxns, setShowAllEvmTxns] = useState(false);

  // Direct HBAR.ħ balance from Mirror Node (guaranteed source of truth)
  const [hbarhDirect, setHbarhDirect] = useState<HbarhDirectBalance | null>(null);
  const [hbarhPriceSource, setHbarhPriceSource] = useState<string>("");

  const { isDark } = useTheme();
  const {
    hederaAccount,
    hbarPrice,
    refreshHederaBalance,
    metaMaskAccount,
    ethPrice,
    refreshMetaMaskBalance,
    disconnectMetaMask,
    hashPackSession,
    hashPackProfile,
    hederaNetwork,
  } = useWallet();

  // DAO voting power (computed from on-chain token balances)
  const daoVotingPower = useMemo(() => {
    if (!hederaAccount) return 0;
    return maxVotesForBalance(hederaAccount.tokens, hederaNetwork);
  }, [hederaAccount, hederaNetwork]);

  // Fetch HBAR.ħ price from SaucerSwap on mount + every 60s
  useEffect(() => {
    const load = async () => {
      try {
        const result = await fetchHbarhPriceSaucer();
        if (result.price > 0) {
          setHbarhPrice(result.price);
          setHbarhPriceSource(result.source);
          console.log(`[Wallet] HBAR.ħ price: $${result.price} (via ${result.source})`);
        }
      } catch { /* non-critical */ }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  // Fetch LP token price from SaucerSwap on mount + every 60s
  useEffect(() => {
    const load = async () => {
      try {
        const result = await fetchLPTokenPrice(SS_LP_TOKEN_ID);
        if (result.price > 0) {
          setLpTokenPrice(result.price);
          setLpTokenPriceSource(result.source);
          console.log(`[Wallet] LP token price: $${result.price} (via ${result.source})`);
        }
      } catch { /* non-critical */ }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  // Direct HBAR.ħ balance fetch from Mirror Node when Hedera account connects
  useEffect(() => {
    if (hederaAccount) {
      fetchHbarhBalance(hederaAccount.accountId, hederaAccount.network)
        .then((result) => {
          setHbarhDirect(result);
          console.log(`[Wallet] HBAR.ħ direct balance:`, result);
        })
        .catch(() => setHbarhDirect(null));

      // Also fetch LP token balance directly
      fetchTokenDirectBalance(hederaAccount.accountId, SS_LP_TOKEN_ID)
        .then((result) => {
          setLpDirect(result);
          console.log(`[Wallet] LP token direct balance:`, result);
        })
        .catch(() => setLpDirect(null));
    } else {
      setHbarhDirect(null);
      setLpDirect(null);
    }
  }, [hederaAccount?.accountId, hederaAccount?.network]);

  // Fetch ERC-20 balances when MetaMask account or chain changes
  useEffect(() => {
    if (metaMaskAccount) {
      setLoadingErc20(true);
      fetchERC20Balances(metaMaskAccount.address, metaMaskAccount.chainId)
        .then(setErc20Balances)
        .catch(() => setErc20Balances([]))
        .finally(() => setLoadingErc20(false));
    } else {
      setErc20Balances([]);
    }
  }, [metaMaskAccount?.address, metaMaskAccount?.chainId]);

  // Fetch recent transactions when Hedera account is connected
  useEffect(() => {
    if (hederaAccount) {
      setLoadingTxns(true);
      fetchRecentTransactions(hederaAccount.accountId, hederaAccount.network).then((txns) => {
        setRecentTxns(txns);
        setLoadingTxns(false);
      });
    } else {
      setRecentTxns([]);
    }
  }, [hederaAccount?.accountId, hederaAccount?.network]);

  // Fetch EVM transactions when MetaMask account is connected
  useEffect(() => {
    if (metaMaskAccount) {
      setLoadingEvmTxns(true);
      fetchEvmTransactions(metaMaskAccount.address, metaMaskAccount.chainId)
        .then((txns) => setEvmTxns(enrichEvmTransactions(txns, metaMaskAccount.address, metaMaskAccount.chainId)))
        .catch(() => setEvmTxns([]))
        .finally(() => setLoadingEvmTxns(false));
    } else {
      setEvmTxns([]);
    }
  }, [metaMaskAccount?.address, metaMaskAccount?.chainId]);

  // Build real holdings list from mirror node data
  const holdings = useMemo(() => {
    if (!hederaAccount) return [];
    const list: Array<{
      symbol: string; name: string; balance: number; value: number;
      price: number; tokenId?: string; isHbarh: boolean; isWbtc: boolean;
      isPrimary: boolean; isNative: boolean; decimals: number;
      isLp?: boolean;
    }> = [];

    list.push({
      symbol: "HBAR", name: "Hedera", balance: hederaAccount.hbarBalance,
      value: hederaAccount.hbarBalance * hbarPrice, price: hbarPrice,
      isHbarh: false, isWbtc: false, isPrimary: true, isNative: true, decimals: 8,
    });

    let foundHbarh = false;
    let foundLp = false;

    // Process all tokens from the paginated list
    hederaAccount.tokens.forEach((token) => {
      const isHbarh = token.tokenId === HBARH_TOKEN_ID;
      const isWbtc = token.tokenId === WBTC_TOKEN_ID;
      const isLp = token.tokenId === SS_LP_TOKEN_ID;

      // For non-special tokens, skip zero balances
      if (!isHbarh && !isLp && token.balance <= 0) return;

      if (isHbarh) foundHbarh = true;
      if (isLp) foundLp = true;

      // Use direct balance from Mirror Node if available (more reliable)
      const displayBalance = isHbarh && hbarhDirect
        ? hbarhDirect.balance
        : isLp && lpDirect
          ? lpDirect.balance
          : token.balance;

      const tokenPrice = isHbarh && hbarhPrice > 0
        ? hbarhPrice
        : isLp && lpTokenPrice > 0
          ? lpTokenPrice
          : 0;

      list.push({
        symbol: isHbarh ? "HBAR.ħ" : isWbtc ? "WBTC" : isLp ? LP_TOKEN_WHBAR_HBARH.symbol : token.symbol,
        name: isHbarh ? "HBAR.ħ Governance" : isWbtc ? "Wrapped Bitcoin" : isLp ? LP_TOKEN_WHBAR_HBARH.name : token.name,
        balance: displayBalance,
        value: tokenPrice > 0 ? displayBalance * tokenPrice : 0,
        price: tokenPrice, tokenId: token.tokenId, isHbarh, isWbtc,
        isPrimary: isHbarh || isWbtc || isLp, isNative: false,
        decimals: isHbarh && hbarhDirect ? hbarhDirect.decimals : isLp && lpDirect ? lpDirect.decimals : token.decimals,
        isLp,
      });
    });

    // ── Inject HBAR.ħ from direct Mirror Node query if not found in paginated list ──
    if (!foundHbarh && hbarhDirect) {
      const displayBalance = hbarhDirect.balance;
      const tokenPrice = hbarhPrice > 0 ? hbarhPrice : 0;
      list.push({
        symbol: "HBAR.ħ", name: "HBAR.ħ Governance",
        balance: displayBalance,
        value: tokenPrice > 0 ? displayBalance * tokenPrice : 0,
        price: tokenPrice, tokenId: HBARH_TOKEN_ID, isHbarh: true, isWbtc: false,
        isPrimary: true, isNative: false, decimals: hbarhDirect.decimals,
      });
    }

    // ── Inject LP token from direct Mirror Node query if not found in paginated list ──
    if (!foundLp && lpDirect && lpDirect.associated && lpDirect.balance > 0) {
      const tokenPrice = lpTokenPrice > 0 ? lpTokenPrice : 0;
      list.push({
        symbol: LP_TOKEN_WHBAR_HBARH.symbol, name: LP_TOKEN_WHBAR_HBARH.name,
        balance: lpDirect.balance,
        value: tokenPrice > 0 ? lpDirect.balance * tokenPrice : 0,
        price: tokenPrice, tokenId: SS_LP_TOKEN_ID, isHbarh: false, isWbtc: false,
        isPrimary: true, isNative: false, decimals: lpDirect.decimals,
        isLp: true,
      });
    }

    list.sort((a, b) => {
      if (a.isNative) return -1;
      if (b.isNative) return 1;
      if (a.isHbarh) return -1;
      if (b.isHbarh) return 1;
      if (a.isLp) return -1;
      if (b.isLp) return 1;
      if (a.isWbtc) return -1;
      if (b.isWbtc) return 1;
      return b.balance - a.balance;
    });
    return list;
  }, [hederaAccount, hbarPrice, hbarhPrice, hbarhDirect, lpTokenPrice, lpDirect]);

  const primaryHoldings = useMemo(() => holdings.filter((h) => h.isPrimary), [holdings]);
  const hiddenHoldings = useMemo(() => {
    const others = holdings.filter((h) => !h.isPrimary);
    if (!tokenFilter.trim()) return others;
    const q = tokenFilter.toLowerCase();
    return others.filter((h) =>
      h.symbol.toLowerCase().includes(q) || h.name.toLowerCase().includes(q) || (h.tokenId?.includes(q))
    );
  }, [holdings, tokenFilter]);

  // Hedera donut data — include LP tokens even if price is unavailable (balance > 0)
  const hederaDonutData = useMemo(() => {
    const items = holdings.filter((h) => h.value > 0 || (h.isLp && h.balance > 0));
    return items.map((h, i) => ({
      name: h.symbol,
      value: h.value > 0 ? h.value : 0.01, // minimal sentinel for unpriced LP tokens so they appear
      color: h.isNative ? "#a855f7" : h.isHbarh ? "#ec4899" : h.isLp ? "#06b6d4" : CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [holdings]);

  // EVM donut data
  const STABLECOINS = useMemo(() => new Set(["USDC", "USDT", "DAI"]), []);
  const evmDonutData = useMemo(() => {
    const items: Array<{ name: string; value: number; color: string }> = [];
    const nativeVal = metaMaskAccount ? parseFloat(metaMaskAccount.balanceEth) * ethPrice : 0;
    if (nativeVal > 0) {
      items.push({ name: metaMaskAccount?.nativeSymbol || "ETH", value: nativeVal, color: "#3b82f6" });
    }
    erc20Balances.forEach((t, i) => {
      const val = STABLECOINS.has(t.symbol) ? t.balance : 0; // only stablecoins priced
      if (val > 0) items.push({ name: t.symbol, value: val, color: CHART_COLORS[(i + 3) % CHART_COLORS.length] });
    });
    return items;
  }, [metaMaskAccount, ethPrice, erc20Balances, STABLECOINS]);

  // Totals
  const hederaTotalUsd = useMemo(() => holdings.reduce((s, h) => s + h.value, 0), [holdings]);
  const evmTotalUsd = useMemo(() => {
    const nativeVal = metaMaskAccount ? parseFloat(metaMaskAccount.balanceEth) * ethPrice : 0;
    const erc20Val = erc20Balances.reduce((s, t) => s + (STABLECOINS.has(t.symbol) ? t.balance : 0), 0);
    return nativeVal + erc20Val;
  }, [metaMaskAccount, ethPrice, erc20Balances, STABLECOINS]);
  const totalPortfolioUsd = hederaTotalUsd + evmTotalUsd;

  const hbarhToken = holdings.find((h) => h.isHbarh);

  const copyToClipboard = useCallback((text: string, label: string) => {
    copyText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refreshHederaBalance();
    if (hederaAccount) {
      const [txns, hbarhBal, lpBal] = await Promise.all([
        fetchRecentTransactions(hederaAccount.accountId, hederaAccount.network),
        fetchHbarhBalance(hederaAccount.accountId, hederaAccount.network),
        fetchTokenDirectBalance(hederaAccount.accountId, SS_LP_TOKEN_ID),
      ]);
      setRecentTxns(txns);
      setHbarhDirect(hbarhBal);
      setLpDirect(lpBal);
    }
    setIsRefreshing(false);
  }, [refreshHederaBalance, hederaAccount]);

  const handleRefreshMM = useCallback(async () => {
    setIsRefreshingMM(true);
    await refreshMetaMaskBalance();
    if (metaMaskAccount) {
      try {
        const tokens = await fetchERC20Balances(metaMaskAccount.address, metaMaskAccount.chainId);
        setErc20Balances(tokens);
      } catch { /* non-critical */ }
      try {
        const txns = await fetchEvmTransactions(metaMaskAccount.address, metaMaskAccount.chainId);
        setEvmTxns(enrichEvmTransactions(txns, metaMaskAccount.address, metaMaskAccount.chainId));
      } catch { /* non-critical */ }
    }
    setIsRefreshingMM(false);
  }, [refreshMetaMaskBalance, metaMaskAccount]);

  // Format unix timestamp (seconds) to relative time
  const formatUnixTs = useCallback((unixSeconds: number) => {
    const diff = Date.now() - unixSeconds * 1000;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(unixSeconds * 1000).toLocaleDateString();
  }, []);

  const formatTimestamp = (ts: string) => {
    try {
      const seconds = parseFloat(ts.split(".")[0]);
      const date = new Date(seconds * 1000);
      const diff = Date.now() - date.getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "Just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      if (days < 7) return `${days}d ago`;
      return date.toLocaleDateString();
    } catch { return ts; }
  };

  const formatFullTimestamp = (ts: string) => {
    try {
      return new Date(parseFloat(ts.split(".")[0]) * 1000).toLocaleString();
    } catch { return ts; }
  };

  const hasAnyWallet = !!hederaAccount || !!metaMaskAccount;

  // ─── Not Connected ───────────────────────────────────────────────
  if (!hasAnyWallet) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-2xl flex items-center justify-center mb-5">
          <WalletIcon className={`w-8 h-8 ${isDark ? "text-purple-400" : "text-purple-500"}`} />
        </div>
        <h3 className="text-xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent mb-2">
          Connect a Wallet
        </h3>
        <p className={`text-sm max-w-sm text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Use the Connect button to link your HashPack or MetaMask wallet and view live balances.
        </p>
      </div>
    );
  }

  // ─── Connected ───────────────────────────────────────────────────
  const formatBal = (n: number) =>
    n === 0 ? "0" : n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n >= 0.0001 ? n.toFixed(6) : n.toFixed(8);

  const formatUsd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      {/* ═══ TOP SUMMARY BAR ═══ */}
      <div className={`rounded-xl p-4 ${isDark ? "bg-gradient-to-r from-purple-900/30 via-pink-900/20 to-slate-900/30 border border-pink-500/20" : "bg-gradient-to-r from-purple-50 via-pink-50 to-white border border-pink-200"}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Total Portfolio */}
          <div>
            <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Portfolio</div>
            <div className="text-2xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
              {formatUsd(totalPortfolioUsd)}
            </div>
          </div>
          <div className={`w-px h-10 ${isDark ? "bg-pink-500/15" : "bg-gray-200"} hidden sm:block`} />
          {/* HBAR Price */}
          <div>
            <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>HBAR</div>
            <div className="font-bold">${hbarPrice.toFixed(4)}</div>
          </div>
          {/* HBAR.ħ Price */}
          <div>
            <div className="flex items-center gap-1">
              <img src={isDark ? HBARH_LOGO_DARK : HBARH_LOGO_LIGHT} alt="" className="w-3 h-3 rounded-full object-cover" />
              <span className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>HBAR.ħ</span>
            </div>
            <div className="font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              {hbarhPrice > 0 ? `$${hbarhPrice < 0.01 ? hbarhPrice.toFixed(6) : hbarhPrice.toFixed(4)}` : "..."}
            </div>
          </div>
          {/* HBAR.ħ Balance if connected to Hedera */}
          {hbarhToken && (
            <>
              <div className={`w-px h-10 ${isDark ? "bg-pink-500/15" : "bg-gray-200"} hidden sm:block`} />
              <div>
                <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>HBAR.ħ Bal</div>
                <div className="font-bold">{formatBal(hbarhToken.balance)}</div>
              </div>
            </>
          )}
          {/* DAO Voting Power */}
          {daoVotingPower > 0 && (
            <>
              <div className={`w-px h-10 ${isDark ? "bg-pink-500/15" : "bg-gray-200"} hidden sm:block`} />
              <div>
                <div className="flex items-center gap-1">
                  <Vote className={`w-3 h-3 ${isDark ? "text-purple-400" : "text-purple-500"}`} />
                  <span className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>DAO Power</span>
                </div>
                <div className="font-bold text-purple-400">{daoVotingPower}x</div>
              </div>
            </>
          )}
          {/* Auto-refresh indicator */}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>Live</span>
          </div>
        </div>
      </div>

      {/* ═══ HEDERA WALLET ═══ */}
      {hederaAccount && (
        <div className={isDark ? "bg-slate-900/40 border border-pink-500/20 rounded-xl" : "bg-white border border-gray-200 rounded-xl shadow-sm"}>
          <div className="p-5">
            <div className="flex flex-col lg:flex-row gap-5">
              {/* LEFT: Account + Token list */}
              <div className="flex-1 min-w-0">
                {/* Account header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <img src={HASHPACK_LOGO} alt="HashPack" className="w-10 h-10 rounded-xl flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">HashPack</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold capitalize ${hederaAccount.network === "testnet" ? "bg-yellow-500/20 text-yellow-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                          {hederaAccount.network}
                        </span>
                        {hashPackSession && hashPackSession.connectionMethod === "mirror-node" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 font-bold">READ-ONLY</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {hashPackProfile?.username && (
                          <span className={`text-xs ${isDark ? "text-purple-400" : "text-purple-600"}`}>{hashPackProfile.username}</span>
                        )}
                        <code className={`font-mono text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          {hederaAccount.accountId}
                        </code>
                        <button onClick={() => copyToClipboard(hederaAccount.accountId, "account")} className="p-0.5 hover:bg-white/10 rounded">
                          {copied === "account" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-40" />}
                        </button>
                        <a href={getHashScanAccountUrl(hederaAccount.accountId, hederaAccount.network)} target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => setShowDeposit(true)} className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${isDark ? "bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 border border-pink-500/20" : "bg-pink-50 text-pink-600 hover:bg-pink-100 border border-pink-200"}`}>
                      Deposit
                    </button>
                    <button onClick={handleRefresh} disabled={isRefreshing} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-100"}`} title="Refresh">
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-pink-400" : ""}`} />
                    </button>
                  </div>
                </div>

                {/* Balance summary */}
                <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4`}>
                  <div className={`p-3 rounded-lg ${isDark ? "bg-black/20" : "bg-gray-50"}`}>
                    <div className={`text-[10px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>HBAR</div>
                    <div className="font-bold">{formatHbar(hederaAccount.hbarBalance)}</div>
                    <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {formatUsd(hederaAccount.hbarBalance * hbarPrice)}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg ${isDark ? "bg-black/20" : "bg-gray-50"}`}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <img src={isDark ? HBARH_LOGO_DARK : HBARH_LOGO_LIGHT} alt="" className="w-3 h-3 rounded-full object-cover" />
                      <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>HBAR.ħ</span>
                    </div>
                    <div className="font-bold">
                      {hbarhToken
                        ? formatBal(hbarhToken.balance)
                        : hbarhDirect
                          ? formatBal(hbarhDirect.balance)
                          : "\u2014"}
                    </div>
                    <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {hbarhToken && hbarhPrice > 0
                        ? formatUsd(hbarhToken.balance * hbarhPrice)
                        : hbarhDirect && hbarhDirect.balance > 0 && hbarhPrice > 0
                          ? formatUsd(hbarhDirect.balance * hbarhPrice)
                          : hbarhDirect && !hbarhDirect.associated
                            ? "Not associated"
                            : hbarhDirect
                              ? HBARH_TOKEN_ID
                              : "Loading..."}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg ${isDark ? "bg-black/20" : "bg-gray-50"}`}>
                    <div className={`text-[10px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Staking</div>
                    <div className="font-bold text-sm">
                      {hederaAccount.stakingInfo.stakedNodeId !== null
                        ? `Node ${hederaAccount.stakingInfo.stakedNodeId}`
                        : hederaAccount.stakingInfo.stakedAccountId ? "Active" : "None"}
                    </div>
                    <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {hederaAccount.stakingInfo.pendingReward > 0 ? `${formatHbar(hederaAccount.stakingInfo.pendingReward)} pending` : "No rewards"}
                    </div>
                  </div>
                </div>

                {/* Token list */}
                <div className="space-y-1.5">
                  {primaryHoldings.map((h) => {
                    const logo = getTokenLogo(h.symbol, h.tokenId, isDark);
                    return (
                      <div key={h.tokenId || h.symbol} className={`flex items-center justify-between p-2.5 rounded-lg transition-colors ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50"}`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          {logo ? (
                            <img src={logo} alt={h.symbol} className="w-8 h-8 rounded-full flex-shrink-0 object-cover" />
                          ) : (
                            <div className="w-8 h-8 bg-gradient-to-br from-pink-500/20 to-purple-500/20 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">{h.symbol.slice(0, 2)}</div>
                          )}
                          <div className="min-w-0">
                            <span className="font-bold text-sm">{h.symbol}</span>
                            {h.tokenId && (
                              <div className="flex items-center gap-1">
                                <span className={`text-[10px] font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>{h.tokenId}</span>
                                <a href={`https://hashscan.io/${hederaAccount.network}/token/${h.tokenId}`} target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300">
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2">
                          <div className="font-bold text-sm">{formatBal(h.balance)}</div>
                          {h.value > 0 && (
                            <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{formatUsd(h.value)}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Other tokens expandable */}
                {hiddenHoldings.length > 0 && (
                  <div className="mt-2">
                    <button onClick={() => setShowAllTokens(!showAllTokens)} className={`w-full py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors ${isDark ? "text-slate-500 hover:text-slate-400 hover:bg-white/[0.03]" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"}`}>
                      {showAllTokens ? <>Hide {hiddenHoldings.length} tokens <ChevronUp className="w-3 h-3" /></> : <>{hiddenHoldings.length} more tokens <ChevronDown className="w-3 h-3" /></>}
                    </button>
                    {showAllTokens && (
                      <div className="mt-1.5 space-y-1">
                        {hiddenHoldings.length > 5 && (
                          <div className="relative mb-2">
                            <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 ${isDark ? "text-slate-600" : "text-gray-400"}`} />
                            <input type="text" value={tokenFilter} onChange={(e) => setTokenFilter(e.target.value)} placeholder="Filter..." className={`w-full pl-7 pr-3 py-1.5 rounded-lg text-xs outline-none ${isDark ? "bg-black/20 border border-pink-500/10 placeholder:text-slate-700" : "bg-gray-50 border border-gray-200 placeholder:text-gray-400"}`} />
                          </div>
                        )}
                        {hiddenHoldings.map((h) => (
                          <div key={h.tokenId || h.symbol} className={`flex items-center justify-between p-2 rounded-lg ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50"}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 bg-gradient-to-br from-pink-500/15 to-purple-500/15 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">{h.symbol.slice(0, 2)}</div>
                              <div className="min-w-0">
                                <span className="font-bold text-xs">{h.symbol}</span>
                                <span className={`text-[10px] ml-1.5 font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>{h.tokenId}</span>
                              </div>
                            </div>
                            <span className="font-bold text-xs flex-shrink-0 ml-2">{formatBal(h.balance)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* RIGHT: Donut Chart */}
              <div className="lg:w-52 flex-shrink-0 flex flex-col items-center justify-center">
                <div className={`text-[10px] uppercase tracking-wider mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Allocation</div>
                <div className="w-36 h-36 lg:w-44 lg:h-44">
                  <AllocationDonut data={hederaDonutData} isDark={isDark} />
                </div>
                <div className="text-center mt-1">
                  <div className="font-bold text-lg bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                    {formatUsd(hederaTotalUsd)}
                  </div>
                </div>
                <ChartLegend data={hederaDonutData} isDark={isDark} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ METAMASK / EVM WALLET ═══ */}
      {metaMaskAccount && (
        <div className={isDark ? "bg-slate-900/40 border border-orange-500/20 rounded-xl" : "bg-white border border-gray-200 rounded-xl shadow-sm"}>
          <div className="p-5">
            <div className="flex flex-col lg:flex-row gap-5">
              {/* LEFT: Account + Tokens */}
              <div className="flex-1 min-w-0">
                {/* Account header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <img src={CONNECTOR_LOGOS.MetaMask} alt="MetaMask" className="w-10 h-10 rounded-xl flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">MetaMask</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-600"}`}>
                          {metaMaskAccount.chainName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <code className={`font-mono text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          {formatAddress(metaMaskAccount.address)}
                        </code>
                        <button onClick={() => copyToClipboard(metaMaskAccount.address, "mm")} className="p-0.5 hover:bg-white/10 rounded">
                          {copied === "mm" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-40" />}
                        </button>
                        {metaMaskAccount.explorerUrl && (
                          <a href={getExplorerAddressUrl(metaMaskAccount.address, metaMaskAccount.chainId)} target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={handleRefreshMM} disabled={isRefreshingMM} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-100"}`} title="Refresh">
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingMM ? "animate-spin text-orange-400" : ""}`} />
                    </button>
                    <button onClick={disconnectMetaMask} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-red-900/30 text-red-400" : "hover:bg-red-50 text-red-500"}`} title="Disconnect">
                      <Unplug className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Native balance */}
                <div className={`grid grid-cols-2 gap-2 mb-4`}>
                  <div className={`p-3 rounded-lg ${isDark ? "bg-black/20" : "bg-gray-50"}`}>
                    <div className={`text-[10px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{metaMaskAccount.nativeSymbol}</div>
                    <div className="font-bold">
                      {parseFloat(metaMaskAccount.balanceEth) >= 0.01
                        ? parseFloat(metaMaskAccount.balanceEth).toLocaleString(undefined, { maximumFractionDigits: 4 })
                        : parseFloat(metaMaskAccount.balanceEth).toFixed(6)}
                    </div>
                    <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {formatUsd(parseFloat(metaMaskAccount.balanceEth) * ethPrice)}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg ${isDark ? "bg-black/20" : "bg-gray-50"}`}>
                    <div className={`text-[10px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{metaMaskAccount.nativeSymbol} Price</div>
                    <div className="font-bold">{formatUsd(ethPrice)}</div>
                    <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>CoinGecko</div>
                  </div>
                </div>

                {/* ERC-20 tokens */}
                {loadingErc20 ? (
                  <div className="flex items-center gap-2 py-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                    <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Fetching ERC-20 balances...</span>
                  </div>
                ) : erc20Balances.length > 0 ? (
                  <div className="space-y-1.5">
                    {erc20Balances.map((token) => (
                      <div key={token.address} className={`flex items-center justify-between p-2.5 rounded-lg transition-colors ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50"}`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img src={token.logo} alt={token.symbol} className="w-7 h-7 rounded-full flex-shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          <div className="min-w-0">
                            <div className="font-bold text-sm">{token.symbol}</div>
                            <div className={`text-[10px] font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                              {token.address.slice(0, 6)}...{token.address.slice(-4)}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2">
                          <div className="font-bold text-sm">{formatBal(token.balance)}</div>
                          {STABLECOINS.has(token.symbol) && (
                            <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{formatUsd(token.balance)}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* RIGHT: Donut Chart */}
              <div className="lg:w-52 flex-shrink-0 flex flex-col items-center justify-center">
                <div className={`text-[10px] uppercase tracking-wider mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Allocation</div>
                <div className="w-36 h-36 lg:w-44 lg:h-44">
                  <AllocationDonut data={evmDonutData} isDark={isDark} />
                </div>
                <div className="text-center mt-1">
                  <div className="font-bold text-lg bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
                    {formatUsd(evmTotalUsd)}
                  </div>
                </div>
                <ChartLegend data={evmDonutData} isDark={isDark} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TRANSACTION HISTORY (unified, below all wallets) ═══ */}
      {(hederaAccount || metaMaskAccount) && (
        <div className={`${isDark ? "bg-slate-900/40 border border-pink-500/15 rounded-xl" : "bg-white border border-gray-200 rounded-xl shadow-sm"}`}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
                <h3 className="font-bold">Transaction History</h3>
              </div>
              {hederaAccount && (
                <a href={getHashScanAccountUrl(hederaAccount.accountId, hederaAccount.network)} target="_blank" rel="noopener noreferrer" className="text-xs text-pink-400 flex items-center gap-1 hover:underline">
                  HashScan <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* ── Hedera Transactions ── */}
            {hederaAccount && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <img src={HASHPACK_LOGO} alt="" className="w-4 h-4 rounded" />
                  <span className={`text-xs font-bold ${isDark ? "text-slate-400" : "text-gray-600"}`}>Hedera</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isDark ? "bg-purple-500/15 text-purple-400" : "bg-purple-100 text-purple-600"}`}>
                    Mirror Node
                  </span>
                </div>
                {loadingTxns ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-4 h-4 animate-spin text-pink-400" />
                    <span className={`ml-2 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>Loading...</span>
                  </div>
                ) : recentTxns.length === 0 ? (
                  <div className={`text-center py-6 text-sm ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                    No recent Hedera transactions
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {(showAllTxns ? recentTxns : recentTxns.slice(0, 8)).map((tx, i) => {
                      const myTransfer = tx.transfers.find((t) => t.account === hederaAccount.accountId);
                      const isIncoming = myTransfer && myTransfer.amount > 0;
                      return (
                        <div key={`h-${tx.transactionId}-${i}`} className={`flex items-center justify-between p-2.5 rounded-lg transition-colors ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50"}`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isIncoming ? "bg-emerald-500/15" : "bg-pink-500/15"}`}>
                              {isIncoming ? <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" /> : <ArrowUpRight className="w-3.5 h-3.5 text-pink-400" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-bold truncate">{tx.name}</div>
                              <div className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`} title={formatFullTimestamp(tx.consensusTimestamp)}>
                                {formatTimestamp(tx.consensusTimestamp)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            {myTransfer && (
                              <span className={`text-sm font-bold ${isIncoming ? "text-emerald-400" : "text-pink-400"}`}>
                                {isIncoming ? "+" : ""}{Math.abs(myTransfer.amount) >= 0.01 ? myTransfer.amount.toFixed(4) : myTransfer.amount.toFixed(8)} <span className="hidden sm:inline text-xs">HBAR</span>
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${tx.result === "SUCCESS" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                              {tx.result === "SUCCESS" ? "OK" : tx.result}
                            </span>
                            <a href={`https://hashscan.io/${hederaAccount.network}/transaction/${tx.transactionId}`} target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {recentTxns.length > 8 && (
                  <button onClick={() => setShowAllTxns(!showAllTxns)} className={`w-full mt-2 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors ${isDark ? "text-pink-400/70 hover:text-pink-400 hover:bg-white/[0.03]" : "text-pink-500 hover:bg-gray-50"}`}>
                    {showAllTxns ? <>Show less <ChevronUp className="w-3 h-3" /></> : <>All {recentTxns.length} <ChevronDown className="w-3 h-3" /></>}
                  </button>
                )}
              </>
            )}

            {/* ── Divider between chains ── */}
            {hederaAccount && metaMaskAccount && (
              <div className={`my-4 border-t ${isDark ? "border-pink-500/10" : "border-gray-100"}`} />
            )}

            {/* ── MetaMask / EVM Transactions ── */}
            {metaMaskAccount && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <img src={CONNECTOR_LOGOS.MetaMask} alt="" className="w-4 h-4 rounded" />
                    <span className={`text-xs font-bold ${isDark ? "text-slate-400" : "text-gray-600"}`}>{metaMaskAccount.chainName}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-600"}`}>
                      {CHAIN_INFO[metaMaskAccount.chainId] ? "Explorer API" : `Chain ${metaMaskAccount.chainId}`}
                    </span>
                  </div>
                  {metaMaskAccount.explorerUrl && (
                    <a href={getExplorerAddressUrl(metaMaskAccount.address, metaMaskAccount.chainId)} target="_blank" rel="noopener noreferrer" className="text-xs text-orange-400 flex items-center gap-1 hover:underline">
                      Explorer <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                {loadingEvmTxns ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                    <span className={`ml-2 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>Loading...</span>
                  </div>
                ) : evmTxns.length === 0 ? (
                  <div className={`text-center py-6 text-sm ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                    {CHAIN_INFO[metaMaskAccount.chainId] ? "No recent transactions" : "Explorer API not available for this chain"}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {(showAllEvmTxns ? evmTxns : evmTxns.slice(0, 8)).map((tx, i) => {
                      const txLabel = tx.functionName
                        ? tx.functionName.split("(")[0]
                        : tx.to
                          ? tx.isIncoming ? "Receive" : "Send"
                          : "Contract Create";
                      return (
                        <div key={`e-${tx.hash}-${i}`} className={`flex items-center justify-between p-2.5 rounded-lg transition-colors ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50"}`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${tx.isIncoming ? "bg-emerald-500/15" : "bg-orange-500/15"}`}>
                              {tx.isIncoming ? <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" /> : <ArrowUpRight className="w-3.5 h-3.5 text-orange-400" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-bold truncate">{txLabel}</div>
                              <div className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`} title={new Date(tx.timestamp * 1000).toLocaleString()}>
                                {formatUnixTs(tx.timestamp)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            {tx.valueEth > 0 && (
                              <span className={`text-sm font-bold ${tx.isIncoming ? "text-emerald-400" : "text-orange-400"}`}>
                                {tx.isIncoming ? "+" : "-"}{tx.valueEth >= 0.01 ? tx.valueEth.toFixed(4) : tx.valueEth.toFixed(8)} <span className="hidden sm:inline text-xs">{tx.nativeSymbol}</span>
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${tx.isError ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                              {tx.isError ? "FAIL" : "OK"}
                            </span>
                            <a href={getExplorerTxUrl(tx.hash, tx.chainId)} target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {evmTxns.length > 8 && (
                  <button onClick={() => setShowAllEvmTxns(!showAllEvmTxns)} className={`w-full mt-2 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors ${isDark ? "text-orange-400/70 hover:text-orange-400 hover:bg-white/[0.03]" : "text-orange-500 hover:bg-gray-50"}`}>
                    {showAllEvmTxns ? <>Show less <ChevronUp className="w-3 h-3" /></> : <>All {evmTxns.length} <ChevronDown className="w-3 h-3" /></>}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ DEPOSIT MODAL ═══ */}
      {showDeposit && hederaAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowDeposit(false)}>
          <div className={`rounded-xl p-6 max-w-sm w-full ${isDark ? "bg-slate-900 border border-pink-500/30" : "bg-white border border-gray-200 shadow-2xl"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Deposit</h3>
              <button onClick={() => setShowDeposit(false)} className={`p-1 rounded-lg ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={`rounded-lg px-4 py-3 font-mono text-center ${isDark ? "bg-black/30 border border-pink-500/15" : "bg-gray-50 border border-gray-200"}`}>
              {hederaAccount.accountId}
            </div>
            <p className={`text-xs mt-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Send HBAR or HTS tokens to this Account ID. Hedera confirms in 3-5 seconds.
            </p>
            <button onClick={() => copyToClipboard(hederaAccount.accountId, "deposit")} className="w-full mt-4 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 rounded-lg text-white flex items-center justify-center gap-2 text-sm">
              {copied === "deposit" ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy Account ID</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
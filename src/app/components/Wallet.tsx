import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { log } from "../utils/logger";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  ExternalLink,
  X,
  RefreshCw,
  Wallet as WalletIcon,
  Clock,
  ChevronDown,
  ChevronUp,
  Search,
  Unplug,
  Vote,
  Crown,
  Sparkles,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { motion } from "motion/react";
import { useTheme } from "../contexts/ThemeContext";
import { Tip } from "./Tip";
import { useWallet } from "../contexts/WalletContext";
import { copyToClipboard as copyText } from "../utils/clipboard";
import { isVipEligible, loadVipPrefs } from "../utils/vip";
import { playPortfolioReveal, playTokenHover, playRefreshWhoosh } from "../utils/sounds";
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
  fetchAllTokenPricesById,
  SAUCERSWAP_TOKENS,
  type SaucerTokenPriceEntry,
} from "../utils/saucerswap";
import { maxVotesForBalance } from "../utils/dao";
import { usePartneredLogos } from "../contexts/PartneredLogosContext";

const HBARH_TOKEN_ID = "0.0.9356476";
const WBTC_TOKEN_ID = "0.0.1055483";
const AAVE_TOKEN_ID = "0.0.1055498";
const DAI_TOKEN_ID = "0.0.1055477";
const WETH_TOKEN_ID = "0.0.541564";
const LINK_TOKEN_ID = "0.0.1055495";
const WBNB_TOKEN_ID = "0.0.1157005";
const WAVAX_TOKEN_ID = "0.0.1157020";
const WMATIC_TOKEN_ID = "0.0.540318";
const USDC_BRIDGE_TOKEN_ID = "0.0.1055459";
const USDT_BRIDGE_TOKEN_ID = "0.0.1055472";
const USDC_NATIVE_TOKEN_ID = "0.0.456858";
const USDT_NATIVE_TOKEN_ID = "0.0.4291336";
const WHBAR_TOKEN_ID = "0.0.1456986";
const SAUCE_TOKEN_ID = "0.0.731861";
const HBARX_TOKEN_ID = "0.0.834116";
const KARATE_TOKEN_ID = "0.0.2283230";
// [C85] Updated from 0.0.4589822 → 0.0.4794920 (current active PACK on SaucerSwap mainnet)
const PACK_TOKEN_ID = "0.0.4794920";
const DOVU_TOKEN_ID = "0.0.3716059";
// [C85] Updated from 0.0.786931 → 0.0.968069 (SaucerSwap API reconciliation)
const HST_TOKEN_ID = "0.0.968069";
const WPOL_TOKEN_ID = "0.0.3306241";
const SS_LP_TOKEN_ID = LP_TOKEN_WHBAR_HBARH.tokenId; // "0.0.9356724"

// ── Comprehensive logo registry (CoinGecko + inline SVG) ────────────
const TOKEN_LOGOS: Record<string, string> = {
  HBAR: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  WHBAR: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  WBTC: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  WETH: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  AAVE: "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png",
  DAI: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
  LINK: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  USDC: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  USDT: "https://assets.coingecko.com/coins/images/325/large/Tether.png",
  WBNB: "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
  WAVAX: "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
  WMATIC: "https://assets.coingecko.com/coins/images/4713/large/polygon.png",
  WPOL: "https://assets.coingecko.com/coins/images/4713/large/polygon.png",
  SAUCE: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#7C3AED"/><text x="50" y="55" text-anchor="middle" fill="white" font-size="24" font-weight="800" font-family="Arial,sans-serif" letter-spacing="-1">S</text><circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/></svg>')}`,
  HBARX: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="hx" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3B82F6"/><stop offset="100%" stop-color="#1D4ED8"/></linearGradient></defs><circle cx="50" cy="50" r="50" fill="url(#hx)"/><text x="50" y="55" text-anchor="middle" fill="white" font-size="20" font-weight="800" font-family="Arial,sans-serif">ℏX</text></svg>')}`,
  KARATE: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#DC2626"/><text x="50" y="55" text-anchor="middle" fill="white" font-size="24" font-weight="800" font-family="Arial,sans-serif" letter-spacing="-1">K</text><circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/></svg>')}`,
  PACK: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="pk" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#059669"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><circle cx="50" cy="50" r="50" fill="url(#pk)"/><text x="50" y="55" text-anchor="middle" fill="white" font-size="24" font-weight="800" font-family="Arial,sans-serif" letter-spacing="-1">P</text><circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/></svg>')}`,
  DOVU: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="dv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#10B981"/><stop offset="100%" stop-color="#059669"/></linearGradient></defs><circle cx="50" cy="50" r="50" fill="url(#dv)"/><text x="50" y="55" text-anchor="middle" fill="white" font-size="24" font-weight="800" font-family="Arial,sans-serif" letter-spacing="-1">D</text><circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/></svg>')}`,
  HST: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="hs" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#06B6D4"/><stop offset="100%" stop-color="#0891B2"/></linearGradient></defs><circle cx="50" cy="50" r="50" fill="url(#hs)"/><text x="50" y="55" text-anchor="middle" fill="white" font-size="22" font-weight="800" font-family="Arial,sans-serif" letter-spacing="-1">H</text><circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/></svg>')}`,
  USDCh: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  USDTh: "https://assets.coingecko.com/coins/images/325/large/Tether.png",
};

// ── HTS token ID → logo key (covers all allowlisted tokens) ────────
// [C85] Also includes SaucerSwap alias IDs for bridge tokens so wallet
// tokens matched via alias also resolve to the correct logo.
const TOKEN_ID_TO_LOGO: Record<string, string> = {
  [WHBAR_TOKEN_ID]: "WHBAR",
  [WBTC_TOKEN_ID]: "WBTC",
  "0.0.1969769": "WBTC",  // SaucerSwap old alias
  "0.0.10104132": "WBTC", // SaucerSwap current alias [C85]
  [AAVE_TOKEN_ID]: "AAVE",
  [DAI_TOKEN_ID]: "DAI",
  [WETH_TOKEN_ID]: "WETH",
  "0.0.1969708": "WETH",  // SaucerSwap alias
  [LINK_TOKEN_ID]: "LINK",
  "0.0.1970030": "LINK",  // SaucerSwap old alias
  "0.0.10152778": "LINK", // SaucerSwap current alias [C85]
  [WBNB_TOKEN_ID]: "WBNB",
  [WAVAX_TOKEN_ID]: "WAVAX",
  [WMATIC_TOKEN_ID]: "WMATIC",
  [WPOL_TOKEN_ID]: "WPOL",
  [USDC_BRIDGE_TOKEN_ID]: "USDCh",
  [USDT_BRIDGE_TOKEN_ID]: "USDT", // [C36-04] Was "USDTh" — merged into USDT
  [USDC_NATIVE_TOKEN_ID]: "USDC",
  [USDT_NATIVE_TOKEN_ID]: "USDT (Native)", // [C36-04] Distinguish from HashPort USDT
  [SAUCE_TOKEN_ID]: "SAUCE",
  [HBARX_TOKEN_ID]: "HBARX",
  [KARATE_TOKEN_ID]: "KARATE",
  [PACK_TOKEN_ID]: "PACK",
  [DOVU_TOKEN_ID]: "DOVU",
  [HST_TOKEN_ID]: "HST",
};

// Build a reverse lookup: HTS ID → logo URL (populated from SAUCERSWAP_TOKENS)
// [C85] Also indexes saucerswapAliasId so alias-matched tokens get correct logos
const HTS_ID_TO_LOGO_URL: Record<string, string> = {};
for (const t of SAUCERSWAP_TOKENS) {
  if (t.htsId !== "native" && t.logo) {
    HTS_ID_TO_LOGO_URL[t.htsId] = t.logo;
    if (t.saucerswapAliasId) {
      HTS_ID_TO_LOGO_URL[t.saucerswapAliasId] = t.logo;
    }
  }
}

function getTokenLogo(
  symbol: string,
  tokenId?: string,
  isDark = true,
  hbarDark = HBARH_LOGO_DARK,
  hbarLight = HBARH_LOGO_LIGHT,
  saucerPriceMap?: Map<string, SaucerTokenPriceEntry>,
): string | null {
  // HBAR.ħ and LP token → protocol branding
  if (tokenId === HBARH_TOKEN_ID || tokenId === SS_LP_TOKEN_ID || symbol === "HBAR.ħ" || symbol === "HBARh") return isDark ? hbarDark : hbarLight;
  // Match by token ID first (handles bridge tokens with non-standard symbols)
  if (tokenId) {
    const logoKey = TOKEN_ID_TO_LOGO[tokenId];
    if (logoKey && TOKEN_LOGOS[logoKey]) return TOKEN_LOGOS[logoKey];
    // Direct HTS ID → logo URL from SAUCERSWAP_TOKENS registry
    if (HTS_ID_TO_LOGO_URL[tokenId]) return HTS_ID_TO_LOGO_URL[tokenId];
    // SaucerSwap API sometimes includes icon URLs
    if (saucerPriceMap) {
      const entry = saucerPriceMap.get(tokenId);
      if (entry?.icon) return entry.icon;
    }
  }
  // Then by symbol
  return TOKEN_LOGOS[symbol] || null;
}

// Donut chart colors
const CHART_COLORS = [
  "#06b6d4", "#a855f7", "#3b82f6", "#f59e0b", "#10b981",
  "#f43f5e", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6",
];

// ── Donut Chart Component (VIP-enhanced) ──────────────────────────────
function AllocationDonut({
  data,
  isDark,
  isVip = false,
}: {
  data: Array<{ name: string; value: number; color: string }>;
  isDark: boolean;
  isVip?: boolean;
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

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative w-full h-full">
      {/* VIP: emerald glow pulse behind donut */}
      {isVip && (
        <motion.div
          className="absolute inset-2 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(16,185,129,0.12), transparent 70%)" }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {/* VIP: slowly rotating donut */}
      <motion.div
        className="w-full h-full"
        animate={isVip ? { rotate: 360 } : undefined}
        transition={isVip ? { duration: 60, repeat: Infinity, ease: "linear" } : undefined}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={isVip ? 3 : 2}
              dataKey="value"
              stroke="none"
              animationBegin={0}
              animationDuration={isVip ? 1200 : 800}
            >
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: isDark ? "rgba(15,15,26,0.95)" : "#fff",
                border: isDark ? `1px solid ${isVip ? "rgba(16,185,129,0.25)" : "rgba(6,182,212,0.25)"}` : "1px solid #e5e7eb",
                borderRadius: 10,
                fontSize: 12,
                padding: "8px 12px",
                backdropFilter: "blur(8px)",
              }}
              formatter={(value: number) => {
                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
                return isVip
                  ? [`$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} · ${pct}%`, ""]
                  : [`$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, ""];
              }}
              labelStyle={{ fontWeight: 700 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </motion.div>
      {/* VIP: center VIP badge */}
      {isVip && total > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <motion.div
            className="text-center"
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Sparkles className="w-3 h-3 text-emerald-400/60 mx-auto mb-0.5" />
            <div className="text-[9px] uppercase tracking-widest text-emerald-400/50 font-bold">VIP</div>
          </motion.div>
        </div>
      )}
    </div>
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

  // Direct LP token balance from Mirror Node
  const [lpDirect, setLpDirect] = useState<TokenDirectBalance | null>(null);

  // All-token price map from SaucerSwap oracle (keyed by HTS ID)
  const [allTokenPrices, setAllTokenPrices] = useState<Map<string, SaucerTokenPriceEntry>>(new Map());

  // EVM transaction history
  const [evmTxns, setEvmTxns] = useState<EvmTransaction[]>([]);
  const [loadingEvmTxns, setLoadingEvmTxns] = useState(false);
  const [showAllEvmTxns, setShowAllEvmTxns] = useState(false);

  // Direct HBAR.ħ balance from Mirror Node (guaranteed source of truth)
  const [hbarhDirect, setHbarhDirect] = useState<HbarhDirectBalance | null>(null);

  const { isDark } = useTheme();
  const partnerLogos = usePartneredLogos();
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

  // ── VIP State (100M HBAR.ħ threshold) ──────────────────────────────
  const [vipPrefs, setVipPrefs] = useState(() => loadVipPrefs());

  // Listen for VIP prefs changes (toggled from VIPPanel via custom event)
  useEffect(() => {
    const handler = (e: Event) => {
      const prefs = (e as CustomEvent).detail;
      if (prefs) setVipPrefs(prefs);
    };
    window.addEventListener("vip-prefs-changed", handler);
    return () => window.removeEventListener("vip-prefs-changed", handler);
  }, []);

  // Re-verify VIP prefs integrity once the wallet account is known
  useEffect(() => {
    if (hederaAccount?.accountId) setVipPrefs(loadVipPrefs(hederaAccount.accountId));
  }, [hederaAccount?.accountId]);

  const isVip = useMemo(() => {
    if (!hederaAccount) return false;
    return isVipEligible(hederaAccount.tokens, hederaNetwork) && vipPrefs.active;
  }, [hederaAccount, hederaNetwork, vipPrefs]);
  const hoverThrottleRef = useRef(0);
  const revealPlayedRef = useRef(false);

  // VIP: play portfolio reveal chime once on load
  useEffect(() => {
    if (isVip && !revealPlayedRef.current && hederaAccount) {
      revealPlayedRef.current = true;
      const timer = setTimeout(() => playPortfolioReveal(), 400);
      return () => clearTimeout(timer);
    }
  }, [isVip, hederaAccount]);

  const handleVipTokenHover = useCallback(() => {
    if (!isVip) return;
    const now = Date.now();
    if (now - hoverThrottleRef.current > 180) {
      hoverThrottleRef.current = now;
      playTokenHover();
    }
  }, [isVip]);

  // Fetch HBAR.ħ price from SaucerSwap on mount + every 60s
  useEffect(() => {
    const load = async () => {
      try {
        const result = await fetchHbarhPriceSaucer();
        if (result.price > 0) {
          setHbarhPrice(result.price);
          log.info("Wallet", `HBAR.ħ price: $${result.price} (via ${result.source})`);
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
          log.info("Wallet", `LP token price: $${result.price} (via ${result.source})`);
        }
      } catch { /* non-critical */ }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  // ── All-token price oracle (SaucerSwap) ──────────────────────────
  // Fetches prices for ALL SaucerSwap-listed tokens, keyed by HTS ID.
  // This powers USD valuation for every token in the wallet, not just
  // HBAR/HBAR.ħ/LP. Refreshes every 60s alongside the other price feeds.
  useEffect(() => {
    const load = async () => {
      try {
        const priceMap = await fetchAllTokenPricesById();
        if (priceMap.size > 0) {
          setAllTokenPrices(priceMap);
          log.info("Wallet", `All-token prices loaded: ${priceMap.size} tokens`);
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
          log.info("Wallet", "HBAR.ħ direct balance", result);
        })
        .catch(() => setHbarhDirect(null));

      // Also fetch LP token balance directly
      fetchTokenDirectBalance(hederaAccount.accountId, SS_LP_TOKEN_ID)
        .then((result) => {
          setLpDirect(result);
          log.info("Wallet", "LP token direct balance", result);
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

  // ── Build holdings list from mirror node data + SaucerSwap oracle prices ──
  // Every token the user holds is priced via:
  //   1. Dedicated oracle (HBAR → 5-tier pipeline, HBAR.ħ → DexScreener/SaucerSwap, LP → pool TVL)
  //   2. SaucerSwap all-token price map (keyed by HTS ID — covers ALL listed tokens)
  //   3. Falls back to 0 for truly unpriced tokens (shown without USD value)
  const holdings = useMemo(() => {
    if (!hederaAccount) return [];
    const list: Array<{
      symbol: string; name: string; balance: number; value: number;
      price: number; tokenId?: string; isHbarh: boolean; isWbtc: boolean;
      isPrimary: boolean; isNative: boolean; decimals: number;
      isLp?: boolean; isAllowlisted?: boolean;
    }> = [];

    // ── HBAR (native) — always primary ──
    list.push({
      symbol: "HBAR", name: "Hedera", balance: hederaAccount.hbarBalance,
      value: hederaAccount.hbarBalance * hbarPrice, price: hbarPrice,
      isHbarh: false, isWbtc: false, isPrimary: true, isNative: true, decimals: 8,
    });

    let foundHbarh = false;
    let foundLp = false;

    // ── Curated allowlist lookup by HTS ID (membership + trusted symbol/name) ──
    // [C85] Also index by saucerswapAliasId and build a symbol→token map
    // for fallback matching when Mirror Node returns a different ID than
    // our static registry (e.g., token migrations, bridge alias IDs).
    const allowlistByHtsId = new Map<string, typeof SAUCERSWAP_TOKENS[0]>();
    const allowlistBySymbol = new Map<string, typeof SAUCERSWAP_TOKENS[0]>();
    for (const t of SAUCERSWAP_TOKENS) {
      if (t.htsId === "native") continue;
      allowlistByHtsId.set(t.htsId, t);
      if (t.saucerswapAliasId) allowlistByHtsId.set(t.saucerswapAliasId, t);
      allowlistBySymbol.set(t.symbol.toUpperCase(), t);
    }

    // Process all tokens from the paginated mirror node list
    hederaAccount.tokens.forEach((token) => {
      const isHbarh = token.tokenId === HBARH_TOKEN_ID;
      const isWbtc = token.tokenId === WBTC_TOKEN_ID;
      const isLp = token.tokenId === SS_LP_TOKEN_ID;
      // [C85] Check allowlist by HTS ID first, then fall back to symbol match.
      // This catches tokens whose on-chain ID (from Mirror Node) differs from
      // our registry — e.g., after token migrations or bridge alias mismatches.
      const isAllowlisted = allowlistByHtsId.has(token.tokenId)
        || (token.symbol && allowlistBySymbol.has(token.symbol.toUpperCase()));

      // Skip zero-balance tokens unless they are special (HBAR.ħ, LP)
      if (!isHbarh && !isLp && token.balance <= 0) return;

      if (isHbarh) foundHbarh = true;
      if (isLp) foundLp = true;

      // Use direct balance from Mirror Node if available (more reliable)
      const displayBalance = isHbarh && hbarhDirect
        ? hbarhDirect.balance
        : isLp && lpDirect
          ? lpDirect.balance
          : token.balance;

      // ── Price resolution (priority order) ──
      let tokenPrice = 0;
      if (isHbarh && hbarhPrice > 0) {
        tokenPrice = hbarhPrice;
      } else if (isLp && lpTokenPrice > 0) {
        tokenPrice = lpTokenPrice;
      } else if (allTokenPrices.has(token.tokenId)) {
        // SaucerSwap oracle price by HTS ID
        tokenPrice = allTokenPrices.get(token.tokenId)!.priceUsd;
      }

      // ── Symbol / name override (priority: hardcoded → allowlist → API with guard) ──
      let displaySymbol = token.symbol;
      let displayName = token.name;
      if (isHbarh) { displaySymbol = "HBAR.ħ"; displayName = "HBAR.ħ Governance"; }
      else if (isWbtc) { displaySymbol = "WBTC"; displayName = "Wrapped Bitcoin"; }
      else if (isLp) { displaySymbol = LP_TOKEN_WHBAR_HBARH.symbol; displayName = LP_TOKEN_WHBAR_HBARH.name; }
      else {
        // Priority 1: Our curated allowlist — human-reviewed, always trusted
        // [C85] Try by HTS ID first, then fall back to symbol match for
        // tokens whose on-chain ID differs from our registry.
        const curated = allowlistByHtsId.get(token.tokenId)
          || (token.symbol ? allowlistBySymbol.get(token.symbol.toUpperCase()) : undefined);
        if (curated) {
          displaySymbol = curated.symbol;
          displayName = curated.name;
        } else if (allTokenPrices.has(token.tokenId)) {
          // Priority 2: SaucerSwap API — only for non-allowlisted tokens
          // Guard: reject nonsensical symbols (numeric-only, single char, or empty)
          const saucerEntry = allTokenPrices.get(token.tokenId)!;
          const apiSym = saucerEntry.symbol?.trim() || "";
          const apiName = saucerEntry.name?.trim() || "";
          if (apiSym.length >= 2 && !/^\d+$/.test(apiSym)) displaySymbol = apiSym;
          if (apiName.length >= 2) displayName = apiName;
        }
      }

      // Promote to primary if: special token, allowlisted, OR has a known price with balance
      const hasPricedValue = tokenPrice > 0 && displayBalance > 0;
      const shouldBePrimary = isHbarh || isWbtc || isLp || isAllowlisted || hasPricedValue;

      list.push({
        symbol: displaySymbol,
        name: displayName,
        balance: displayBalance,
        value: tokenPrice > 0 ? displayBalance * tokenPrice : 0,
        price: tokenPrice,
        tokenId: token.tokenId,
        isHbarh, isWbtc,
        isPrimary: shouldBePrimary,
        isNative: false,
        decimals: isHbarh && hbarhDirect ? hbarhDirect.decimals : isLp && lpDirect ? lpDirect.decimals : token.decimals,
        isLp,
        isAllowlisted,
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

    // ── Sort: native first, then HBAR.ħ, LP, WBTC, then by USD value desc, then balance desc ──
    list.sort((a, b) => {
      if (a.isNative) return -1;
      if (b.isNative) return 1;
      if (a.isHbarh) return -1;
      if (b.isHbarh) return 1;
      if (a.isLp) return -1;
      if (b.isLp) return 1;
      if (a.isWbtc) return -1;
      if (b.isWbtc) return 1;
      // Sort remaining by USD value (priced tokens first), then by raw balance
      if (a.value !== b.value) return b.value - a.value;
      return b.balance - a.balance;
    });
    return list;
  }, [hederaAccount, hbarPrice, hbarhPrice, hbarhDirect, lpTokenPrice, lpDirect, allTokenPrices]);

  const primaryHoldings = useMemo(() => holdings.filter((h) => h.isPrimary), [holdings]);
  const hiddenHoldings = useMemo(() => {
    const others = holdings.filter((h) => !h.isPrimary);
    if (!tokenFilter.trim()) return others;
    const q = tokenFilter.toLowerCase();
    return others.filter((h) =>
      h.symbol.toLowerCase().includes(q) || h.name.toLowerCase().includes(q) || (h.tokenId?.includes(q))
    );
  }, [holdings, tokenFilter]);

  // Hedera donut data — top 8 by value + "Other" bucket for readability
  const hederaDonutData = useMemo(() => {
    // Only include tokens with a real USD value — avoids phantom slivers
    // for LP or other tokens that have a balance but no oracle price yet
    const pricedItems = holdings
      .filter((h) => h.value > 0)
      .sort((a, b) => b.value - a.value);

    const MAX_SLICES = 8;
    const topItems = pricedItems.slice(0, MAX_SLICES);
    const otherItems = pricedItems.slice(MAX_SLICES);
    const otherValue = otherItems.reduce((s, h) => s + h.value, 0);

    const colorForItem = (h: typeof pricedItems[0], i: number) =>
      isVip
        ? (h.isNative ? "#10b981" : h.isHbarh ? "#34d399" : h.isLp ? "#06b6d4" : CHART_COLORS[i % CHART_COLORS.length])
        : (h.isNative ? "#a855f7" : h.isHbarh ? "#ec4899" : h.isLp ? "#06b6d4" : CHART_COLORS[i % CHART_COLORS.length]);

    const result = topItems.map((h, i) => ({
      name: h.symbol,
      value: h.value,
      color: colorForItem(h, i),
    }));

    if (otherValue > 0) {
      result.push({
        name: `Other (${otherItems.length})`,
        value: otherValue,
        color: isDark ? "#475569" : "#94a3b8",
      });
    }

    return result;
  }, [holdings, isVip, isDark]);

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
    if (isVip) playRefreshWhoosh();
    setIsRefreshing(true);
    await refreshHederaBalance();
    if (hederaAccount) {
      const [txns, hbarhBal, lpBal, freshPrices] = await Promise.all([
        fetchRecentTransactions(hederaAccount.accountId, hederaAccount.network),
        fetchHbarhBalance(hederaAccount.accountId, hederaAccount.network),
        fetchTokenDirectBalance(hederaAccount.accountId, SS_LP_TOKEN_ID),
        fetchAllTokenPricesById(),
      ]);
      setRecentTxns(txns);
      setHbarhDirect(hbarhBal);
      setLpDirect(lpBal);
      if (freshPrices.size > 0) setAllTokenPrices(freshPrices);
    }
    setIsRefreshing(false);
  }, [refreshHederaBalance, hederaAccount, isVip]);

  const handleRefreshMM = useCallback(async () => {
    if (isVip) playRefreshWhoosh();
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
  }, [refreshMetaMaskBalance, metaMaskAccount, isVip]);

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
      <div className="flex flex-col items-center justify-center min-h-[60vh] py-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex flex-col items-center"
        >
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 ${
            isDark
              ? "bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/20"
              : "bg-gradient-to-br from-purple-100 to-blue-100 border border-purple-200"
          }`}>
            <WalletIcon className={`w-10 h-10 ${isDark ? "text-purple-400" : "text-purple-500"}`} />
          </div>
          <h3 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent mb-3">
            Connect a Wallet
          </h3>
          <p className={`text-sm max-w-sm text-center leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Use the Connect button to link your HashPack or MetaMask wallet and view live balances.
          </p>
        </motion.div>
      </div>
    );
  }

  // ─── Connected ───────────────────────────────────────────────────
  const formatBal = (n: number) =>
    n === 0 ? "0" : n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n >= 0.0001 ? n.toFixed(6) : n.toFixed(8);

  const formatUsd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      {/* ═══ TOP SUMMARY BAR (VIP-enhanced) ═══ */}
      <div className={`relative rounded-xl overflow-hidden ${isVip ? "" : ""}`}>
        {/* VIP: animated emerald border glow */}
        {isVip && isDark && (
          <>
            <motion.div
              className="absolute -inset-[1px] rounded-xl pointer-events-none"
              style={{ background: "linear-gradient(90deg, rgba(16,185,129,0.25), rgba(6,182,212,0.15), rgba(16,185,129,0.25))", backgroundSize: "200% 100%" }}
              animate={{ backgroundPosition: ["0% 0%", "200% 0%"] }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute -inset-[1px] rounded-xl pointer-events-none blur-md"
              style={{ background: "linear-gradient(90deg, rgba(16,185,129,0.08), rgba(6,182,212,0.04), rgba(16,185,129,0.08))", backgroundSize: "200% 100%" }}
              animate={{ backgroundPosition: ["200% 0%", "0% 0%"] }}
              transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
            />
          </>
        )}
        <div className={`relative rounded-xl p-4 ${isDark
          ? isVip
            ? "bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-teal-950/40 border border-emerald-500/20"
            : "bg-gradient-to-r from-blue-900/30 via-cyan-900/20 to-slate-900/30 border border-cyan-500/20"
          : isVip
            ? "bg-gradient-to-r from-emerald-50 via-teal-50/50 to-white border border-emerald-200"
            : "bg-gradient-to-r from-blue-50 via-cyan-50 to-white border border-cyan-200"
        }`}>
          {/* VIP: shimmer pass */}
          {isVip && isDark && (
            <motion.div
              className="absolute inset-0 pointer-events-none -skew-x-12 overflow-hidden rounded-xl"
            >
              <motion.div
                className="h-full"
                style={{ width: "15%", background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.06), transparent)" }}
                animate={{ x: ["-20%", "800%"] }}
                transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 5, ease: "easeInOut" }}
              />
            </motion.div>
          )}
          <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2">
            {/* VIP badge */}
            {isVip && (
              <motion.div
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
                animate={{ borderColor: ["rgba(16,185,129,0.2)", "rgba(16,185,129,0.5)", "rgba(16,185,129,0.2)"] }}
                transition={{ duration: 2.5, repeat: Infinity }}
              >
                <Crown className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">VIP</span>
              </motion.div>
            )}
            {/* Total Portfolio */}
            <div>
              <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Portfolio</div>
              <div className={`text-2xl font-bold bg-gradient-to-r bg-clip-text text-transparent ${isVip ? "from-emerald-400 to-teal-400" : "from-cyan-400 to-blue-400"}`}>
                {formatUsd(totalPortfolioUsd)}
              </div>
            </div>
            {/* VIP: % dominance of HBAR.ħ in portfolio */}
            {isVip && hbarhToken && hbarhToken.value > 0 && totalPortfolioUsd > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-500/60">HBAR.ħ Dom.</div>
                <div className="font-bold text-emerald-400">{((hbarhToken.value / totalPortfolioUsd) * 100).toFixed(1)}%</div>
              </div>
            )}
            <div className={`w-px h-10 ${isDark ? (isVip ? "bg-emerald-500/15" : "bg-cyan-500/15") : "bg-gray-200"} hidden sm:block`} />
            {/* HBAR Price */}
            <div>
              <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>HBAR</div>
              <div className="font-bold">${hbarPrice.toFixed(4)}</div>
            </div>
            {/* HBAR.ħ Price */}
            <div>
              <div className="flex items-center gap-1">
                <img src={isDark ? partnerLogos.hbarDark : partnerLogos.hbarLight} alt="" className="w-3 h-3 rounded-full object-cover" />
                <span className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>HBAR.ħ</span>
              </div>
              <div className={`font-bold bg-gradient-to-r bg-clip-text text-transparent ${isVip ? "from-emerald-400 to-teal-400" : "from-blue-400 to-cyan-400"}`}>
                {hbarhPrice > 0 ? `$${hbarhPrice < 0.01 ? hbarhPrice.toFixed(6) : hbarhPrice.toFixed(4)}` : "..."}
              </div>
            </div>
            {/* HBAR.ħ Balance if connected to Hedera */}
            {hbarhToken && (
              <>
                <div className={`w-px h-10 ${isDark ? (isVip ? "bg-emerald-500/15" : "bg-cyan-500/15") : "bg-gray-200"} hidden sm:block`} />
                <div>
                  <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>HBAR.ħ Bal</div>
                  <div className="font-bold">{formatBal(hbarhToken.balance)}</div>
                  {/* VIP: show USD value inline */}
                  {isVip && hbarhToken.value > 0 && (
                    <div className="text-[10px] text-emerald-400/60">{formatUsd(hbarhToken.value)}</div>
                  )}
                </div>
              </>
            )}
            {/* DAO Voting Power */}
            {daoVotingPower > 0 && (
              <>
                <div className={`w-px h-10 ${isDark ? (isVip ? "bg-emerald-500/15" : "bg-cyan-500/15") : "bg-gray-200"} hidden sm:block`} />
                <div>
                  <div className="flex items-center gap-1">
                    <Vote className={`w-3 h-3 ${isDark ? (isVip ? "text-emerald-400" : "text-purple-400") : "text-purple-500"}`} />
                    <span className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>DAO Power</span>
                  </div>
                  <div className={`font-bold ${isVip ? "text-emerald-400" : "text-purple-400"}`}>{daoVotingPower}x</div>
                </div>
              </>
            )}
            {/* VIP: token count */}
            {isVip && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-500/60">Assets</div>
                <div className="font-bold text-emerald-400/80">{holdings.length}</div>
              </div>
            )}
            {/* Oracle price coverage indicator */}
            {!isVip && allTokenPrices.size > 0 && (
              <div>
                <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Oracle</div>
                <div className={`font-bold text-xs ${isDark ? "text-cyan-400/70" : "text-cyan-600"}`}>{allTokenPrices.size} feeds</div>
              </div>
            )}
            {/* Auto-refresh indicator */}
            <div className="ml-auto flex items-center gap-1.5">
              {isVip ? (
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 1.6, 1], opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              <span className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>Live</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ HEDERA WALLET ═══ */}
      {hederaAccount && (
        <div className={`relative rounded-xl overflow-hidden ${isVip && isDark ? "" : ""}`}>
          {/* VIP: emerald glow border */}
          {isVip && isDark && (
            <motion.div
              className="absolute -inset-[1px] rounded-xl pointer-events-none opacity-30"
              style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.3), rgba(6,182,212,0.15), rgba(16,185,129,0.3))", backgroundSize: "200% 200%" }}
              animate={{ backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"] }}
              transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
            />
          )}
        <div className={isDark
          ? isVip
            ? "relative bg-slate-900/50 border border-emerald-500/15 rounded-xl backdrop-blur-sm"
            : "relative bg-slate-900/40 border border-cyan-500/20 rounded-xl"
          : "relative bg-white border border-gray-200 rounded-xl shadow-sm"
        }>
          <div className="p-5">
            <div className="flex flex-col lg:flex-row gap-5">
              {/* LEFT: Account + Token list */}
              <div className="flex-1 min-w-0">
                {/* Account header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <img src={partnerLogos.hashpack} alt="HashPack" className="w-10 h-10 rounded-xl flex-shrink-0" />
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
                        <a href={getHashScanAccountUrl(hederaAccount.accountId, hederaAccount.network)} target="_blank" rel="noopener noreferrer" className={isVip ? "text-emerald-400 hover:text-emerald-300" : "text-cyan-400 hover:text-cyan-300"}>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => setShowDeposit(true)} className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${isDark
                      ? isVip
                        ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20"
                        : "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20"
                      : "bg-cyan-50 text-cyan-600 hover:bg-cyan-100 border border-cyan-200"
                    }`}>
                      Deposit
                    </button>
                    <button onClick={handleRefresh} disabled={isRefreshing} aria-label="Refresh wallet balances" className={`p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-100"}`}>
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? (isVip ? "animate-spin text-emerald-400" : "animate-spin text-cyan-400") : ""}`} />
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
                      <img src={isDark ? partnerLogos.hbarDark : partnerLogos.hbarLight} alt="" className="w-3 h-3 rounded-full object-cover" />
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
                              : "Fetching..."}
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

                {/* Token list (VIP-enhanced) */}
                <div className="space-y-1.5">
                  {primaryHoldings.map((h) => {
                    const logo = getTokenLogo(h.symbol, h.tokenId, isDark, partnerLogos.hbarDark, partnerLogos.hbarLight, allTokenPrices);
                    const pctOfPortfolio = hederaTotalUsd > 0 && h.value > 0 ? ((h.value / hederaTotalUsd) * 100) : 0;
                    return (
                      <div
                        key={h.tokenId || h.symbol}
                        onMouseEnter={handleVipTokenHover}
                        className={`flex items-center justify-between p-2.5 rounded-lg transition-all duration-200 ${isDark
                          ? isVip
                            ? "hover:bg-emerald-500/[0.04] hover:shadow-[0_0_12px_rgba(16,185,129,0.04)]"
                            : "hover:bg-white/[0.03]"
                          : "hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="relative">
                            {logo ? (
                              <img src={logo} alt={h.symbol} className="w-8 h-8 rounded-full flex-shrink-0 object-cover" />
                            ) : (
                              <div className={`w-8 h-8 bg-gradient-to-br rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isVip ? "from-emerald-500/20 to-teal-500/20" : "from-cyan-500/20 to-blue-500/20"}`}>{h.symbol.slice(0, 2)}</div>
                            )}
                            {/* VIP: emerald ring on primary tokens */}
                            {isVip && h.isPrimary && isDark && (
                              <motion.div
                                className="absolute -inset-0.5 rounded-full border border-emerald-500/20 pointer-events-none"
                                animate={{ borderColor: ["rgba(16,185,129,0.15)", "rgba(16,185,129,0.35)", "rgba(16,185,129,0.15)"] }}
                                transition={{ duration: 3, repeat: Infinity }}
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-sm">{h.symbol}</span>
                            {h.tokenId && (
                              <div className="flex items-center gap-1">
                                <span className={`text-[10px] font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>{h.tokenId}</span>
                                <a href={`https://hashscan.io/${hederaAccount.network}/token/${h.tokenId}`} target="_blank" rel="noopener noreferrer" className={`${isVip ? "text-emerald-400 hover:text-emerald-300" : "text-cyan-400 hover:text-cyan-300"}`}>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                          {/* VIP: % allocation bar */}
                          {isVip && pctOfPortfolio > 0 && (
                            <div className="hidden sm:flex items-center gap-1.5 min-w-[60px]">
                              <div className={`h-1 flex-1 rounded-full overflow-hidden ${isDark ? "bg-white/[0.04]" : "bg-gray-100"}`}>
                                <motion.div
                                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.min(pctOfPortfolio, 100)}%` }}
                                  transition={{ duration: 1, delay: 0.3 }}
                                />
                              </div>
                              <span className="text-[10px] text-emerald-400/60 font-mono w-8 text-right">{pctOfPortfolio.toFixed(0)}%</span>
                            </div>
                          )}
                          <div className="text-right">
                            <div className="font-bold text-sm">{formatBal(h.balance)}</div>
                            {h.value > 0 && (
                              <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{formatUsd(h.value)}</div>
                            )}
                          </div>
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
                            <input type="text" value={tokenFilter} onChange={(e) => setTokenFilter(e.target.value)} placeholder="Filter..." className={`w-full pl-7 pr-3 py-1.5 rounded-lg text-xs outline-none ${isDark ? "bg-black/20 border border-cyan-500/10 placeholder:text-slate-700" : "bg-gray-50 border border-gray-200 placeholder:text-gray-400"}`} />
                          </div>
                        )}
                        {hiddenHoldings.map((h) => {
                          const logo = getTokenLogo(h.symbol, h.tokenId, isDark, partnerLogos.hbarDark, partnerLogos.hbarLight, allTokenPrices);
                          return (
                            <div key={h.tokenId || h.symbol} className={`flex items-center justify-between p-2 rounded-lg ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50"}`}>
                              <div className="flex items-center gap-2 min-w-0">
                                {logo ? (
                                  <img src={logo} alt={h.symbol} className="w-6 h-6 rounded-full flex-shrink-0 object-cover" />
                                ) : (
                                  <div className="w-6 h-6 bg-gradient-to-br from-cyan-500/15 to-blue-500/15 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">{h.symbol.slice(0, 2)}</div>
                                )}
                                <div className="min-w-0">
                                  <span className="font-bold text-xs">{h.symbol}</span>
                                  {h.tokenId && (
                                    <div className="flex items-center gap-1">
                                      <span className={`text-[10px] font-mono ${isDark ? "text-slate-600" : "text-gray-400"}`}>{h.tokenId}</span>
                                      <a href={`https://hashscan.io/${hederaAccount?.network || "mainnet"}/token/${h.tokenId}`} target="_blank" rel="noopener noreferrer" className={`${isVip ? "text-emerald-400 hover:text-emerald-300" : "text-cyan-400 hover:text-cyan-300"}`}>
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0 ml-2">
                                <div className="font-bold text-xs">{formatBal(h.balance)}</div>
                                {h.value > 0 && (
                                  <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{formatUsd(h.value)}</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* RIGHT: Donut Chart (VIP-enhanced) */}
              <div className={`flex-shrink-0 flex flex-col items-center justify-center ${isVip ? "lg:w-56" : "lg:w-52"}`}>
                <div className={`text-[10px] uppercase tracking-wider mb-1 ${isDark ? (isVip ? "text-emerald-500/50 font-bold tracking-widest" : "text-slate-500") : "text-gray-400"}`}>
                  {isVip ? "VIP Allocation" : "Allocation"}
                </div>
                <div className={isVip ? "w-40 h-40 lg:w-48 lg:h-48" : "w-36 h-36 lg:w-44 lg:h-44"}>
                  <AllocationDonut data={hederaDonutData} isDark={isDark} isVip={isVip} />
                </div>
                <div className="text-center mt-1">
                  <div className={`font-bold text-lg bg-gradient-to-r bg-clip-text text-transparent ${isVip ? "from-emerald-400 to-teal-400" : "from-cyan-400 to-blue-400"}`}>
                    {formatUsd(hederaTotalUsd)}
                  </div>
                  {/* VIP: priced vs unpriced count */}
                  {isVip && (
                    <div className="text-[10px] text-emerald-400/40 mt-0.5">
                      {holdings.filter(h => h.value > 0).length} priced · {holdings.filter(h => h.value <= 0).length} unpriced
                    </div>
                  )}
                </div>
                <ChartLegend data={hederaDonutData} isDark={isDark} />
              </div>
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
                    <img src={partnerLogos.metamask} alt="MetaMask" className="w-10 h-10 rounded-xl flex-shrink-0" />
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
                    <Tip content="Refresh">
                    <button onClick={handleRefreshMM} disabled={isRefreshingMM} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-100"}`}>
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingMM ? "animate-spin text-orange-400" : ""}`} />
                    </button>
                    </Tip>
                    <Tip content="Disconnect">
                    <button onClick={disconnectMetaMask} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-red-900/30 text-red-400" : "hover:bg-red-50 text-red-500"}`}>
                      <Unplug className="w-3.5 h-3.5" />
                    </button>
                    </Tip>
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
                  <div className="space-y-2 py-2" role="status" aria-label="Loading ERC-20 balances">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-full ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                          <div>
                            <div className={`h-3.5 w-14 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden mb-1`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                            <div className={`h-2.5 w-10 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                          </div>
                        </div>
                        <div className={`h-3.5 w-16 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                      </div>
                    ))}
                    <span className="sr-only">Loading ERC-20 balances...</span>
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
                  <AllocationDonut data={evmDonutData} isDark={isDark} isVip={isVip} />
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

      {/* ═══ TRANSACTION HISTORY (unified, VIP-enhanced) ═══ */}
      {(hederaAccount || metaMaskAccount) && (
        <div className={`${isDark
          ? isVip
            ? "bg-slate-900/50 border border-emerald-500/10 rounded-xl"
            : "bg-slate-900/40 border border-cyan-500/15 rounded-xl"
          : "bg-white border border-gray-200 rounded-xl shadow-sm"
        }`}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className={`w-4 h-4 ${isDark ? (isVip ? "text-emerald-400" : "text-cyan-400") : "text-cyan-500"}`} />
                <h3 className="font-bold">Transaction History</h3>
                {/* VIP: tx count badge */}
                {isVip && (recentTxns.length + evmTxns.length) > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400/70 font-bold">
                    {recentTxns.length + evmTxns.length}
                  </span>
                )}
              </div>
              {hederaAccount && (
                <a href={getHashScanAccountUrl(hederaAccount.accountId, hederaAccount.network)} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 flex items-center gap-1 hover:underline">
                  HashScan <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* ── Hedera Transactions ── */}
            {hederaAccount && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <img src={partnerLogos.hashpack} alt="" className="w-4 h-4 rounded" />
                  <span className={`text-xs font-bold ${isDark ? "text-slate-400" : "text-gray-600"}`}>Hedera</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isDark ? "bg-purple-500/15 text-purple-400" : "bg-purple-100 text-purple-600"}`}>
                    Mirror Node
                  </span>
                </div>
                {loadingTxns ? (
                  <div className="space-y-2 py-2" role="status" aria-label="Loading transactions">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className={`flex items-center justify-between py-2 ${isDark ? "border-b border-white/[0.04]" : "border-b border-gray-100"}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                          <div>
                            <div className={`h-3 w-20 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden mb-1`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                            <div className={`h-2.5 w-28 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                          </div>
                        </div>
                        <div className={`h-3 w-16 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                      </div>
                    ))}
                    <span className="sr-only">Loading transactions...</span>
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
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isIncoming ? "bg-emerald-500/15" : "bg-cyan-500/15"}`}>
                              {isIncoming ? <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" /> : <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-bold truncate">{tx.name}</div>
                              <Tip content={formatFullTimestamp(tx.consensusTimestamp)} side="right">
                              <div className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                                {formatTimestamp(tx.consensusTimestamp)}
                              </div>
                              </Tip>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            {myTransfer && (
                              <span className={`text-sm font-bold ${isIncoming ? "text-emerald-400" : "text-cyan-400"}`}>
                                {isIncoming ? "+" : ""}{Math.abs(myTransfer.amount) >= 0.01 ? myTransfer.amount.toFixed(4) : myTransfer.amount.toFixed(8)} <span className="hidden sm:inline text-xs">HBAR</span>
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${tx.result === "SUCCESS" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                              {tx.result === "SUCCESS" ? "OK" : tx.result}
                            </span>
                            <a href={`https://hashscan.io/${hederaAccount.network}/transaction/${tx.transactionId}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {recentTxns.length > 8 && (
                  <button onClick={() => setShowAllTxns(!showAllTxns)} className={`w-full mt-2 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors ${isDark ? "text-cyan-400/70 hover:text-cyan-400 hover:bg-white/[0.03]" : "text-cyan-500 hover:bg-gray-50"}`}>
                    {showAllTxns ? <>Show less <ChevronUp className="w-3 h-3" /></> : <>All {recentTxns.length} <ChevronDown className="w-3 h-3" /></>}
                  </button>
                )}
              </>
            )}

            {/* ── Divider between chains ── */}
            {hederaAccount && metaMaskAccount && (
              <div className={`my-4 border-t ${isDark ? "border-cyan-500/10" : "border-gray-100"}`} />
            )}

            {/* ── MetaMask / EVM Transactions ── */}
            {metaMaskAccount && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <img src={partnerLogos.metamask} alt="" className="w-4 h-4 rounded" />
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
                  <div className="space-y-2 py-2" role="status" aria-label="Loading EVM transactions">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className={`flex items-center justify-between py-2 ${isDark ? "border-b border-white/[0.04]" : "border-b border-gray-100"}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                          <div>
                            <div className={`h-3 w-20 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden mb-1`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                            <div className={`h-2.5 w-28 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                          </div>
                        </div>
                        <div className={`h-3 w-16 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-200/60"} relative overflow-hidden`}><div className="absolute inset-0 skeleton-shimmer" /></div>
                      </div>
                    ))}
                    <span className="sr-only">Loading EVM transactions...</span>
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
                              <Tip content={new Date(tx.timestamp * 1000).toLocaleString()} side="right">
                              <div className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                                {formatUnixTs(tx.timestamp)}
                              </div>
                              </Tip>
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

      {/* ═══ DEPOSIT MODAL (VIP-enhanced) ═══ */}
      {showDeposit && hederaAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowDeposit(false)}>
          <div className={`rounded-xl p-6 max-w-sm w-full ${isDark
            ? isVip ? "bg-slate-900 border border-emerald-500/30" : "bg-slate-900 border border-cyan-500/30"
            : "bg-white border border-gray-200 shadow-2xl"
          }`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Deposit</h3>
              <button onClick={() => setShowDeposit(false)} className={`p-1 rounded-lg ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={`rounded-lg px-4 py-3 font-mono text-center ${isDark
              ? isVip ? "bg-black/30 border border-emerald-500/15" : "bg-black/30 border border-cyan-500/15"
              : "bg-gray-50 border border-gray-200"
            }`}>
              {hederaAccount.accountId}
            </div>
            <p className={`text-xs mt-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Send HBAR or HTS tokens to this Account ID. Hedera confirms in ~2 seconds.
            </p>
            <button onClick={() => copyToClipboard(hederaAccount.accountId, "deposit")} className={`w-full mt-4 py-2.5 rounded-lg text-white flex items-center justify-center gap-2 text-sm ${isVip
              ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500"
              : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
            }`}>
              {copied === "deposit" ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy Account ID</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
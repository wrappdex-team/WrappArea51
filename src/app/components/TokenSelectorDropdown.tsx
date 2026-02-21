/**
 * [C56] TokenSelectorDropdown — Tabbed token selector with dynamic discovery.
 *
 * Tabs:
 *   Popular  — Top tokens by volume (HBAR, USDC, USDT, SAUCE, HBARX, etc.)
 *   Yours    — Tokens the connected wallet actually holds (from hederaAccount.tokens)
 *   All      — Full searchable list (300+ SaucerSwap tokens via dynamic fetch)
 *
 * Each token row shows: icon, symbol, name, price, and optional balance.
 * Lazy-loads icons from SaucerSwap CDN via `<img loading="lazy">`.
 */

import { useState, useEffect, useMemo, memo, useCallback, useRef } from "react";
import { Search, Star, Wallet, Globe, Loader2, AlertTriangle } from "lucide-react";
import { TokenIcon } from "./TokenIcon";
import {
  SAUCERSWAP_TOKENS,
  fetchDynamicTokens,
  clearAsyncRouteCache,
  type AllowedToken,
  type DynamicTokenInfo,
} from "../utils/saucerswap";

type TabId = "popular" | "yours" | "all";

/** Symbols for the "Popular" tab — top tokens by volume/usage */
const POPULAR_SYMBOLS = new Set([
  "HBAR", "USDC", "USDT", "SAUCE", "HBARX", "KARATE", "PACK",
  "WHBAR", "WBTC", "WETH", "LINK", "DOVU", "HST",
]);

interface WalletTokenInfo {
  tokenId: string;
  balance: number;
  decimals: number;
  symbol: string;
  name: string;
}

export interface TokenSelectorDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (t: AllowedToken) => void;
  excludeSymbol: string;
  isDark: boolean;
  inputClass: string;
  livePrices: Record<string, number>;
  /** Wallet token balances from hederaAccount.tokens */
  walletTokens?: WalletTokenInfo[];
  /** Is wallet connected? */
  isWalletConnected: boolean;
  /** Dynamic price map from server (htsId -> priceUsd) */
  dynamicPrices?: Map<string, number>;
}

const TokenSelectorDropdown = memo(function TokenSelectorDropdown({
  isOpen, onClose, onSelect, excludeSymbol,
  isDark, inputClass, livePrices,
  walletTokens, isWalletConnected, dynamicPrices,
}: TokenSelectorDropdownProps) {
  const [tab, setTab] = useState<TabId>("popular");
  const [search, setSearch] = useState("");
  const [allTokens, setAllTokens] = useState<AllowedToken[]>([...SAUCERSWAP_TOKENS]);
  const [dynamicRaw, setDynamicRaw] = useState<DynamicTokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const fetchedRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-focus search on open
  useEffect(() => {
    if (isOpen && searchRef.current) {
      // Small delay to let the dropdown render
      setTimeout(() => searchRef.current?.focus(), 50);
    }
    if (!isOpen) {
      setSearch("");
    }
  }, [isOpen]);

  // [C56] Fetch dynamic tokens when "All" tab is activated (or on first open)
  useEffect(() => {
    if (!isOpen) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setFetchError(false);
    fetchDynamicTokens()
      .then(({ allTokens: merged, dynamicRaw: raw }) => {
        setAllTokens(merged);
        setDynamicRaw(raw);
        // [C56] Clear the async route cache so newly discovered tokens
        // get fresh on-chain pool detection instead of stale "no route" results
        clearAsyncRouteCache();
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Dynamic prices map: htsId -> priceUsd (from server response)
  const priceByHtsId = useMemo(() => {
    if (dynamicPrices) return dynamicPrices;
    const m = new Map<string, number>();
    for (const dt of dynamicRaw) {
      if (dt.priceUsd != null) m.set(dt.id, dt.priceUsd);
    }
    return m;
  }, [dynamicRaw, dynamicPrices]);

  // Build wallet token set for "Yours" tab
  const walletHtsIds = useMemo(() => {
    if (!walletTokens) return new Set<string>();
    return new Set(walletTokens.filter(wt => wt.balance > 0).map(wt => wt.tokenId));
  }, [walletTokens]);

  const walletBalanceMap = useMemo(() => {
    const m = new Map<string, { balance: number; decimals: number }>();
    if (!walletTokens) return m;
    for (const wt of walletTokens) {
      if (wt.balance > 0) m.set(wt.tokenId, { balance: wt.balance, decimals: wt.decimals });
    }
    return m;
  }, [walletTokens]);

  // Get price for a token (prefer livePrices by symbol, fall back to dynamic by htsId)
  const getPrice = useCallback((t: AllowedToken): number | null => {
    const lp = livePrices[t.symbol];
    if (lp && lp > 0) return lp;
    const dp = priceByHtsId.get(t.htsId);
    if (dp != null && dp > 0) return dp;
    return null;
  }, [livePrices, priceByHtsId]);

  // Filter tokens based on search + exclude
  const filterTokens = useCallback((tokens: AllowedToken[]) => {
    return tokens
      .filter(t => t.symbol !== excludeSymbol)
      .filter(t => {
        if (!search) return true;
        const q = search.toLowerCase();
        return t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.htsId.includes(q);
      });
  }, [excludeSymbol, search]);

  // Popular tokens
  const popularTokens = useMemo(() => {
    const popular = allTokens.filter(t => POPULAR_SYMBOLS.has(t.symbol));
    return filterTokens(popular);
  }, [allTokens, filterTokens]);

  // Wallet-held tokens
  const yourTokens = useMemo(() => {
    if (!isWalletConnected || walletHtsIds.size === 0) return [];
    // Always include HBAR (native) if wallet is connected
    const yours = allTokens.filter(t =>
      t.isNative || walletHtsIds.has(t.htsId)
    );
    return filterTokens(yours);
  }, [allTokens, walletHtsIds, isWalletConnected, filterTokens]);

  // All tokens (with search)
  const filteredAll = useMemo(() => filterTokens(allTokens), [allTokens, filterTokens]);

  // Current list based on tab
  const currentList = tab === "popular" ? popularTokens
    : tab === "yours" ? yourTokens
    : filteredAll;

  if (!isOpen) return null;

  const tabStyle = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
      active
        ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
        : isDark
        ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
        : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
    }`;

  const formatPrice = (price: number) => {
    if (price >= 1) return `$${price.toFixed(2)}`;
    if (price >= 0.001) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(6)}`;
  };

  const formatBalance = (bal: number, decimals: number) => {
    const human = bal / Math.pow(10, decimals);
    if (human >= 1000) return human.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (human >= 1) return human.toFixed(4);
    return human.toFixed(6);
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="listbox"
        aria-label="Select token"
        className={`absolute top-full right-0 mt-2 w-80 rounded-xl shadow-2xl overflow-hidden z-50 ${
          isDark
            ? "bg-[#0c0f1a] border border-white/[0.06]"
            : "bg-white border border-gray-200 shadow-xl"
        }`}
      >
        {/* Search */}
        <div className="p-3 pb-2">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${inputClass}`}>
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search name, symbol, or HTS ID..."
              aria-label="Search tokens"
              className="bg-transparent flex-1 outline-none text-sm min-w-0"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {loading && <Loader2 className="w-3 h-3 animate-spin text-pink-400 shrink-0" />}
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex items-center gap-1 px-3 pb-2 border-b ${isDark ? "border-slate-800" : "border-gray-100"}`}>
          <button onClick={() => setTab("popular")} className={tabStyle(tab === "popular")}>
            <span className="flex items-center gap-1"><Star className="w-3 h-3" /> Popular</span>
          </button>
          {isWalletConnected && (
            <button onClick={() => setTab("yours")} className={tabStyle(tab === "yours")}>
              <span className="flex items-center gap-1">
                <Wallet className="w-3 h-3" />
                Yours
                {yourTokens.length > 0 && (
                  <span className={`text-[10px] px-1 rounded-full ${
                    tab === "yours"
                      ? "bg-white/20 text-white"
                      : isDark ? "bg-slate-700 text-slate-400" : "bg-gray-200 text-gray-500"
                  }`}>
                    {yourTokens.length}
                  </span>
                )}
              </span>
            </button>
          )}
          <button onClick={() => setTab("all")} className={tabStyle(tab === "all")}>
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3" />
              All
              {allTokens.length > SAUCERSWAP_TOKENS.length && (
                <span className={`text-[10px] px-1 rounded-full ${
                  tab === "all"
                    ? "bg-white/20 text-white"
                    : isDark ? "bg-slate-700 text-slate-400" : "bg-gray-200 text-gray-500"
                }`}>
                  {allTokens.length}
                </span>
              )}
            </span>
          </button>
        </div>

        {/* Token List */}
        <div className="max-h-72 overflow-y-auto px-2 py-1">
          {loading && currentList.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="w-4 h-4 animate-spin text-pink-400" />
              <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Loading tokens...
              </span>
            </div>
          ) : fetchError && tab === "all" && currentList.length <= SAUCERSWAP_TOKENS.length ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <AlertTriangle className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-500"}`} />
              <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Couldn't load full token list
              </span>
            </div>
          ) : currentList.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <span className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {tab === "yours" ? "No tokens found in wallet" : "No matching tokens"}
              </span>
              {tab === "yours" && !isWalletConnected && (
                <span className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                  Connect wallet to see your tokens
                </span>
              )}
            </div>
          ) : (
            currentList.map(t => {
              const price = getPrice(t);
              const walletBal = walletBalanceMap.get(t.htsId);
              const isStatic = t.rank < 1000;

              return (
                <button
                  key={`${t.htsId}-${t.symbol}`}
                  onClick={() => onSelect(t)}
                  role="option"
                  aria-selected={false}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                    isDark ? "hover:bg-slate-800/60" : "hover:bg-gray-50"
                  }`}
                >
                  {/* Icon — lazy loaded */}
                  <TokenIcon src={t.logo} symbol={t.symbol} size="w-7 h-7" />

                  {/* Symbol + Name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-sm">{t.symbol}</span>
                      {!isStatic && (
                        <span className={`text-[9px] px-1 py-0.5 rounded ${
                          isDark ? "bg-slate-800 text-slate-500" : "bg-gray-100 text-gray-400"
                        }`}>
                          NEW
                        </span>
                      )}
                    </div>
                    <div className={`text-xs truncate ${
                      isDark ? "text-slate-500" : "text-gray-400"
                    }`}>
                      {t.name}
                    </div>
                  </div>

                  {/* Price + Balance */}
                  <div className="text-right shrink-0">
                    {price != null ? (
                      <div className={`text-xs font-medium ${
                        isDark ? "text-slate-300" : "text-gray-600"
                      }`}>
                        {formatPrice(price)}
                      </div>
                    ) : null}
                    {walletBal && (
                      <div className={`text-[10px] ${
                        isDark ? "text-slate-500" : "text-gray-400"
                      }`}>
                        {formatBalance(walletBal.balance, walletBal.decimals)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer — token count */}
        <div className={`px-3 py-2 text-[10px] text-center border-t ${
          isDark ? "border-slate-800 text-slate-600" : "border-gray-100 text-gray-400"
        }`}>
          {tab === "all"
            ? `${filteredAll.length} of ${allTokens.length} tokens`
            : tab === "yours"
            ? `${yourTokens.length} held token${yourTokens.length !== 1 ? "s" : ""}`
            : `${popularTokens.length} popular tokens`
          }
          {allTokens.length > SAUCERSWAP_TOKENS.length && (
            <span> &middot; via SaucerSwap API</span>
          )}
        </div>
      </div>
    </>
  );
});

export { TokenSelectorDropdown };
export type { WalletTokenInfo };
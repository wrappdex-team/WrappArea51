/**
 * [C56] TokenSelectorDropdown — Professional token selector.
 *
 * SESSION 7 redesign — two tabs:
 *   Held  — Only tokens the connected wallet holds (balance > 0).
 *           Priority tokens (HBAR, USDC, WBTC, WETH, etc. — the core
 *           wrapped/bridged assets from the QuickPairGrid) float to the
 *           top in their canonical order. Remaining held tokens sorted
 *           by USD portfolio value descending.
 *           Shows "Connect wallet" prompt when disconnected.
 *   All   — Full searchable list. Same priority tokens pinned at the top,
 *           then all remaining tokens sorted by popularity rank.
 *           Includes all static + dynamic SaucerSwap tokens.
 *
 * Priority token order mirrors the right-panel quick-select pairs:
 *   HBAR → WHBAR → USDC → USDT → DAI → USDCh → WBTC → WETH → LINK →
 *   AAVE → SAUCE → HBARX → WPOL → WBNB → WAVAX → WMATIC
 *
 * Security: No user data stored. Wallet balances come from Hedera Mirror
 * Node via hederaAccount.tokens — purely client-side, read-only.
 *
 * Each token row shows: icon, symbol, name, HTS ID, price, and optional balance.
 * Icons use the multi-source TokenIcon fallback chain for Vercel compatibility.
 */

import { useState, useEffect, useMemo, memo, useCallback, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Search, Globe, Loader2, AlertTriangle, Wallet, X } from "lucide-react";
import { TokenIcon } from "./TokenIcon";
import {
  SAUCERSWAP_TOKENS,
  fetchDynamicTokens,
  clearAsyncRouteCache,
  type AllowedToken,
  type DynamicTokenInfo,
} from "../utils/saucerswap";

type TabId = "held" | "all";

/**
 * IMPLEMENTATION NOTE: Priority tokens — the core exchange tokens from the
 * QuickPairGrid right-panel quick-select. These always float to the top of
 * both tabs because they are the primary wrapped/bridged assets and routing
 * tokens that the DEX is built around. Order here = display priority.
 */
const PRIORITY_SYMBOLS: string[] = [
  // Native + wrapped native
  "HBAR", "WHBAR",
  // Core stablecoins
  "USDC", "USDT", "DAI", "USDCh",
  // Wrapped blue-chip cross-chain
  "WBTC", "WETH", "LINK", "AAVE",
  // Ecosystem core
  "SAUCE", "HBARX",
  // Bridged L1 tokens
  "WPOL", "WBNB", "WAVAX", "WMATIC",
];
const PRIORITY_SET = new Set(PRIORITY_SYMBOLS);
/** Map symbol → sort rank within the priority group (lower = higher) */
const PRIORITY_RANK = new Map(PRIORITY_SYMBOLS.map((s, i) => [s, i]));

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
  /** Wallet token balances from hederaAccount.tokens (mirror node read-only) */
  walletTokens?: WalletTokenInfo[];
  /** Is wallet connected? */
  isWalletConnected: boolean;
  /** Dynamic price map from server (htsId -> priceUsd) */
  dynamicPrices?: Map<string, number>;
  /** Ref to the container element that the dropdown should anchor to */
  anchorRef?: RefObject<HTMLDivElement | null>;
}

const TokenSelectorDropdown = memo(function TokenSelectorDropdown({
  isOpen, onClose, onSelect, excludeSymbol,
  isDark, inputClass, livePrices,
  walletTokens, isWalletConnected, dynamicPrices,
  anchorRef,
}: TokenSelectorDropdownProps) {
  const [tab, setTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [allTokens, setAllTokens] = useState<AllowedToken[]>([...SAUCERSWAP_TOKENS]);
  const [dynamicRaw, setDynamicRaw] = useState<DynamicTokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const fetchedRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Mobile detection — full-screen sheet on small viewports ──
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ── Portal positioning: calculate fixed position from anchor ref ──
  const [portalPos, setPortalPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);

  useEffect(() => {
    // Skip portal positioning on mobile — uses full-screen overlay
    if (isMobile) { setPortalPos(null); return; }
    if (!isOpen || !anchorRef?.current) {
      setPortalPos(null);
      return;
    }
    const updatePos = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dropdownH = 480; // approximate max height
      const viewportH = window.innerHeight;
      const spaceBelow = viewportH - rect.bottom;
      const spaceAbove = rect.top;
      const openUp = spaceBelow < dropdownH && spaceAbove > spaceBelow;
      const dropdownW = 360;
      // Align right edge to anchor right, but keep within viewport
      let left = rect.right - dropdownW;
      if (left < 8) left = 8;
      if (left + dropdownW > window.innerWidth - 8) left = window.innerWidth - dropdownW - 8;
      setPortalPos({
        top: openUp ? rect.top : rect.bottom + 8,
        left,
        openUp,
      });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [isOpen, anchorRef, isMobile]);

  // Auto-focus search on open
  useEffect(() => {
    if (isOpen && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
    if (!isOpen) {
      setSearch("");
    }
  }, [isOpen]);

  // Fetch dynamic tokens on first open
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
        clearAsyncRouteCache();
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Dynamic prices map: htsId -> priceUsd
  const priceByHtsId = useMemo(() => {
    if (dynamicPrices) return dynamicPrices;
    const m = new Map<string, number>();
    for (const dt of dynamicRaw) {
      if (dt.priceUsd != null) m.set(dt.id, dt.priceUsd);
    }
    return m;
  }, [dynamicRaw, dynamicPrices]);

  // Build wallet token set for balance display
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

  // Count of user-held tokens (for tab badge)
  const heldCount = walletHtsIds.size;

  // Get price for a token
  const getPrice = useCallback((t: AllowedToken): number | null => {
    const lp = livePrices[t.symbol];
    if (lp && lp > 0) return lp;
    const dp = priceByHtsId.get(t.htsId);
    if (dp != null && dp > 0) return dp;
    return null;
  }, [livePrices, priceByHtsId]);

  // ── Helper: get USD value of a held token for sort ordering ──
  const getHeldUsdValue = useCallback((t: AllowedToken): number => {
    const price = (() => {
      const lp = livePrices[t.symbol];
      if (lp && lp > 0) return lp;
      const dp = priceByHtsId.get(t.htsId);
      if (dp != null && dp > 0) return dp;
      return 0;
    })();
    if (t.isNative) return 0; // Native HBAR handled by priority sort
    const wb = walletBalanceMap.get(t.htsId);
    if (!wb) return 0;
    const humanBal = wb.balance / Math.pow(10, wb.decimals);
    return humanBal * price;
  }, [livePrices, priceByHtsId, walletBalanceMap]);

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

  // ── Held tokens: only tokens the connected wallet holds (balance > 0) ──
  const heldTokens = useMemo(() => {
    if (!isWalletConnected) return [];
    const combined = allTokens.filter(t =>
      t.isNative || walletHtsIds.has(t.htsId)
    );
    // Deduplicate by htsId
    const seen = new Set<string>();
    const deduped = combined.filter(t => {
      const key = t.htsId || t.symbol;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Sort: priority tokens first (in PRIORITY_SYMBOLS order), then rest by USD value desc
    return filterTokens(deduped).sort((a, b) => {
      const aPri = PRIORITY_SET.has(a.symbol);
      const bPri = PRIORITY_SET.has(b.symbol);
      if (aPri && !bPri) return -1;
      if (!aPri && bPri) return 1;
      if (aPri && bPri) return (PRIORITY_RANK.get(a.symbol) ?? 99) - (PRIORITY_RANK.get(b.symbol) ?? 99);
      // Non-priority: sort by USD value descending
      const aVal = getHeldUsdValue(a);
      const bVal = getHeldUsdValue(b);
      if (bVal !== aVal) return bVal - aVal;
      return a.rank - b.rank;
    });
  }, [allTokens, filterTokens, isWalletConnected, walletHtsIds, getHeldUsdValue]);

  // ── All tokens: priority/wrapped at top, then by rank (popularity) ──
  const filteredAll = useMemo(() => {
    const filtered = filterTokens(allTokens);
    return filtered.sort((a, b) => {
      const aPri = PRIORITY_SET.has(a.symbol);
      const bPri = PRIORITY_SET.has(b.symbol);
      if (aPri && !bPri) return -1;
      if (!aPri && bPri) return 1;
      if (aPri && bPri) return (PRIORITY_RANK.get(a.symbol) ?? 99) - (PRIORITY_RANK.get(b.symbol) ?? 99);
      // Non-priority: sort by rank (lower = more popular)
      return a.rank - b.rank;
    });
  }, [allTokens, filterTokens]);

  // Current list based on tab
  const currentList = tab === "held" ? heldTokens : filteredAll;

  if (!isOpen) return null;

  const tabStyle = (active: boolean, accent?: "green") =>
    `px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
      active
        ? accent === "green"
          ? isDark
            ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
            : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
        : isDark
        ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
        : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
    }`;

  const formatPrice = (price: number) => {
    if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    if (price >= 0.001) return `$${price.toFixed(4)}`;
    if (price >= 0.0001) return `$${price.toFixed(5)}`;
    return `$${price.toFixed(6)}`;
  };

  const formatBalance = (bal: number, decimals: number) => {
    const human = bal / Math.pow(10, decimals);
    if (human >= 1000) return human.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (human >= 1) return human.toFixed(4);
    return human.toFixed(6);
  };

  const dropdownContent = (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label="Select token"
      className={`${isMobile ? "w-full h-full" : "w-[360px]"} rounded-2xl shadow-2xl overflow-hidden ${
        portalPos ? "fixed z-[9999]" : isMobile ? "fixed inset-0 z-[9999] rounded-none" : "absolute top-full right-0 mt-2 z-50"
      } ${
        isDark
          ? "bg-[#0c0f1a]/95 backdrop-blur-xl border border-white/[0.08]"
          : "bg-white/95 backdrop-blur-xl border border-gray-200 shadow-xl"
      }`}
      style={portalPos ? {
        top: portalPos.openUp ? undefined : portalPos.top,
        bottom: portalPos.openUp ? (window.innerHeight - portalPos.top + 8) : undefined,
        left: portalPos.left,
        maxHeight: portalPos.openUp
          ? Math.min(portalPos.top - 16, 480)
          : Math.min(window.innerHeight - portalPos.top - 16, 480),
      } : undefined}
    >
      {/* Mobile header with close button */}
      {isMobile && (
        <div className={`flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2 border-b ${
          isDark ? "border-white/[0.06]" : "border-gray-100"
        }`}>
          <h3 className={`text-base font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
            Select Token
          </h3>
          <button
            onClick={onClose}
            aria-label="Close token selector"
            className={`p-2 -mr-1 rounded-xl transition-colors ${
              isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-100 text-gray-500"
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="p-3 pb-2">
        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl transition-all ${
          isDark
            ? "bg-slate-800/60 border border-white/[0.06] focus-within:border-pink-500/30 focus-within:bg-slate-800/80"
            : "bg-gray-50 border border-gray-200 focus-within:border-pink-300 focus-within:bg-white"
        }`}>
          <Search className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search name, symbol, or HTS ID..."
            aria-label="Search tokens"
            className="bg-transparent flex-1 outline-none text-sm min-w-0 placeholder:text-slate-500"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-pink-400 shrink-0" />}
        </div>
      </div>

      {/* Tabs */}
      <div className={`flex items-center gap-1.5 px-3 pb-2.5 border-b ${isDark ? "border-white/[0.06]" : "border-gray-100"}`}>
        <button onClick={() => setTab("held")} className={tabStyle(tab === "held", "green")}>
          <Wallet className="w-3.5 h-3.5" />
          Held
          {isWalletConnected && heldCount > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              tab === "held"
                ? isDark ? "bg-emerald-400/20 text-emerald-300" : "bg-emerald-100 text-emerald-700"
                : isDark ? "bg-slate-700/60 text-slate-400" : "bg-gray-200 text-gray-500"
            }`}>
              {heldCount}
            </span>
          )}
        </button>
        <button onClick={() => setTab("all")} className={tabStyle(tab === "all")}>
          <Globe className="w-3.5 h-3.5" />
          All
          {allTokens.length > SAUCERSWAP_TOKENS.length && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              tab === "all"
                ? "bg-white/20 text-white"
                : isDark ? "bg-slate-700/60 text-slate-400" : "bg-gray-200 text-gray-500"
            }`}>
              {allTokens.length}
            </span>
          )}
        </button>
      </div>

      {/* Token List */}
      <div className={`${isMobile ? "flex-1 overflow-y-auto" : "max-h-80 overflow-y-auto"} overscroll-contain`}
        style={isMobile ? { maxHeight: "calc(100vh - 200px)" } : undefined}
      >
        {loading && currentList.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10">
            <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
            <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Loading tokens...
            </span>
          </div>
        ) : fetchError && tab === "all" && currentList.length <= SAUCERSWAP_TOKENS.length ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <AlertTriangle className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-500"}`} />
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Couldn't load full token list
            </span>
          </div>
        ) : currentList.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            {tab === "held" && !isWalletConnected ? (
              <>
                <Wallet className={`w-6 h-6 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                <span className={`text-sm font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Connect wallet to see held tokens
                </span>
                <span className={`text-[11px] ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                  Or browse the All tab for popular tokens
                </span>
              </>
            ) : tab === "held" ? (
              <>
                <Wallet className={`w-6 h-6 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                <span className={`text-sm font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {search ? "No held tokens match your search" : "No tokens held"}
                </span>
              </>
            ) : (
              <span className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                No matching tokens
              </span>
            )}
          </div>
        ) : (
          <div className="py-1">
            {currentList.map(t => {
              const price = getPrice(t);
              const walletBal = t.isNative ? undefined : walletBalanceMap.get(t.htsId);
              const isHeld = isWalletConnected && (walletHtsIds.has(t.htsId) || t.isNative);

              return (
                <button
                  key={`${t.htsId}-${t.symbol}`}
                  onClick={() => onSelect(t)}
                  role="option"
                  aria-selected={false}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                    isDark
                      ? "hover:bg-slate-800/50 active:bg-slate-800/70"
                      : "hover:bg-gray-50 active:bg-gray-100"
                  }`}
                >
                  {/* Icon */}
                  <div className="relative">
                    <TokenIcon
                      src={t.logo}
                      symbol={t.symbol}
                      htsId={t.htsId}
                      size="w-9 h-9"
                    />
                    {/* Held indicator dot */}
                    {isHeld && (
                      <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${
                        isDark ? "bg-emerald-400 border-[#0c0f1a]" : "bg-emerald-500 border-white"
                      }`} />
                    )}
                  </div>

                  {/* Symbol + Name + HTS ID */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-sm">{t.symbol}</span>
                      {t.bridge && (
                        <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                          isDark ? "bg-slate-800/80 text-slate-500" : "bg-gray-100 text-gray-400"
                        }`}>
                          {t.bridge}
                        </span>
                      )}
                    </div>
                    <div className={`text-[11px] truncate leading-tight mt-0.5 ${
                      isDark ? "text-slate-500" : "text-gray-400"
                    }`}>
                      {t.name}
                      {t.htsId && t.htsId !== "native" && (
                        <span className="ml-1 opacity-60 font-mono text-[10px]">{t.htsId}</span>
                      )}
                    </div>
                  </div>

                  {/* Price + Balance */}
                  <div className="text-right shrink-0 ml-2">
                    {price != null ? (
                      <div className={`text-sm font-semibold tabular-nums ${
                        isDark ? "text-slate-200" : "text-gray-700"
                      }`}>
                        {formatPrice(price)}
                      </div>
                    ) : null}
                    {walletBal && (
                      <div className={`text-[10px] tabular-nums mt-0.5 ${
                        isDark ? "text-emerald-400/70" : "text-emerald-600/70"
                      }`}>
                        {formatBalance(walletBal.balance, walletBal.decimals)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`px-3 py-2 ${isMobile ? "pb-[max(env(safe-area-inset-bottom),8px)]" : ""} text-[10px] text-center border-t font-medium ${
        isDark ? "border-white/[0.06] text-slate-600" : "border-gray-100 text-gray-400"
      }`}>
        {tab === "held"
          ? `${heldTokens.length} held token${heldTokens.length !== 1 ? "s" : ""}`
          : `${filteredAll.length} of ${allTokens.length} tokens`
        }
        {allTokens.length > SAUCERSWAP_TOKENS.length && (
          <span> &middot; via SaucerSwap API</span>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Click-away overlay */}
      {createPortal(
        <div
          className={`fixed inset-0 z-[9998] ${isMobile ? (isDark ? "bg-black/60" : "bg-black/40") : ""}`}
          onClick={onClose}
          aria-hidden="true"
        />,
        document.body
      )}
      {/* Dropdown — full-screen portal on mobile, positioned portal on desktop */}
      {(isMobile || portalPos) ? createPortal(dropdownContent, document.body) : dropdownContent}
    </>
  );
});

export { TokenSelectorDropdown };
export type { WalletTokenInfo };
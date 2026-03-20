/**
 * OneInchTokenSelector — Production-grade EVM token selector.
 *
 * Features:
 *   - Quick-access favorites row (star toggle, persisted)
 *   - Recently used tokens section
 *   - Full-text search via Token Search API with debounce
 *   - Custom token import by pasting contract address
 *   - USD prices next to each token
 *   - Wallet balances sorted to top when connected
 *   - Glass-morphism dark/light theme styling
 *
 * IMPLEMENTATION NOTE: This component is extracted from OneInchWidget
 * to keep the main widget file manageable and to allow the token
 * selector to maintain its own scroll state without resetting on
 * parent re-renders.
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Star,
  Clock,
  Download,
  Loader2,
  AlertCircle,
  X,
  CheckCircle2,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { playVipButtonChime } from "../utils/sounds";
import type { TokenInfo, EnrichedToken } from "../utils/oneinch/types";
import {
  searchTokens,
  isFavorite,
  toggleFavorite,
  getFavoriteTokens,
  getRecentTokens,
  saveCustomToken,
  formatUsd,
  formatBalance,
  normaliseToken,
} from "../utils/oneinch/tokens";
import { oneInchApi } from "../utils/oneinch/api-client";
import type { RawTokenFromAPI } from "../utils/oneinch/types";

/* ======================================================================
 * Types
 * ====================================================================== */

export interface TokenSelectorProps {
  /** Whether the selector dropdown is visible */
  isOpen: boolean;
  /** Close the selector */
  onClose: () => void;
  /** Callback when a token is selected */
  onSelect: (token: TokenInfo) => void;
  /** Address to exclude from the list (the other side of the pair) */
  excludeAddress: string;
  /** Current chain ID */
  chainId: number;
  /** Full merged token list for local search */
  allTokens: TokenInfo[];
  /** Enriched tokens with balances + prices (null if not available) */
  enrichedTokens: EnrichedToken[] | null;
  /** Whether the full token list is still loading */
  isLoading: boolean;
}

/* ======================================================================
 * Token Row — Memoised for performance with large lists
 * ====================================================================== */

interface TokenRowProps {
  token: TokenInfo;
  enriched: EnrichedToken | null;
  isFav: boolean;
  onSelect: () => void;
  onToggleFav: (e: React.MouseEvent) => void;
  isDark: boolean;
}

const TokenRow = memo(function TokenRow({
  token, enriched, isFav, onSelect, onToggleFav, isDark,
}: TokenRowProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left group ${
        isDark ? "hover:bg-pink-500/10" : "hover:bg-pink-50"
      }`}
    >
      {/* Token logo */}
      {token.logoURI ? (
        <img
          src={token.logoURI}
          alt={token.symbol}
          className="w-8 h-8 rounded-full ring-2 ring-transparent group-hover:ring-pink-500/30 transition-all"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-xs text-white font-bold shrink-0">
          {token.symbol[0]}
        </div>
      )}

      {/* Token info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-sm">{token.symbol}</span>
          {token.isNative && (
            <span className={`text-[10px] px-1 py-0.5 rounded-full font-bold leading-none ${
              isDark ? "bg-pink-500/10 text-pink-400 border border-pink-500/20" : "bg-pink-50 text-pink-600 border border-pink-200"
            }`}>
              Native
            </span>
          )}
        </div>
        <div className={`text-xs truncate ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          {token.name}
        </div>
      </div>

      {/* Balance + Price column */}
      <div className="text-right shrink-0 min-w-[4rem]">
        {enriched?.formattedBalance && enriched.formattedBalance !== "0" ? (
          <>
            <div className="text-xs font-semibold truncate max-w-[6rem]">
              {enriched.formattedBalance}
            </div>
            {enriched.balanceUsd !== null && enriched.balanceUsd > 0 && (
              <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {formatUsd(enriched.balanceUsd)}
              </div>
            )}
          </>
        ) : enriched?.priceUsd !== null && enriched?.priceUsd !== undefined && enriched.priceUsd > 0 ? (
          <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {formatUsd(enriched.priceUsd)}
          </div>
        ) : null}
      </div>

      {/* Favorite star */}
      <button
        onClick={onToggleFav}
        className={`p-1 rounded-lg transition-all opacity-0 group-hover:opacity-100 ${
          isFav ? "opacity-100" : ""
        } ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-200"}`}
      >
        <Star
          className={`w-3.5 h-3.5 transition-colors ${
            isFav
              ? "text-amber-400 fill-amber-400"
              : isDark ? "text-slate-600" : "text-gray-300"
          }`}
        />
      </button>
    </button>
  );
});

/* ======================================================================
 * Main Component
 * ====================================================================== */

export const OneInchTokenSelector = memo(function OneInchTokenSelector({
  isOpen,
  onClose,
  onSelect,
  excludeAddress,
  chainId,
  allTokens,
  enrichedTokens,
  isLoading,
}: TokenSelectorProps) {
  const { isDark } = useTheme();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TokenInfo[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, forceUpdate] = useState(0); // For favorite toggles

  // Focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSearchResults(null);
      setImportStatus("idle");
      setImportError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Build enriched token lookup for O(1) access
  const enrichedMap = useMemo(() => {
    if (!enrichedTokens) return new Map<string, EnrichedToken>();
    return new Map(enrichedTokens.map((t) => [t.address.toLowerCase(), t]));
  }, [enrichedTokens]);

  // Favorites for quick-access row
  const favorites = useMemo(
    () => getFavoriteTokens(chainId, allTokens),
    [chainId, allTokens],
  );

  // Recent tokens
  const recents = useMemo(
    () => getRecentTokens(chainId, allTokens, 6),
    [chainId, allTokens],
  );

  // Handle search with debounce
  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
    setImportStatus("idle");
    setImportError(null);

    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (!value.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await searchTokens(value, chainId, allTokens);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, [chainId, allTokens]);

  // Handle custom token import
  const handleImportToken = useCallback(async (address: string) => {
    setImportStatus("loading");
    setImportError(null);

    try {
      const data = await oneInchApi.get<Record<string, unknown>>(
        `/token/custom/${chainId}?address=${address}`,
        { retries: 1, timeout: 8_000 },
      );

      const values = Object.values(data || {});
      if (values.length > 0 && typeof values[0] === "object" && values[0] !== null) {
        const token = normaliseToken(values[0] as RawTokenFromAPI);
        saveCustomToken(chainId, token);
        setImportStatus("success");

        // Auto-select after brief success indicator
        setTimeout(() => {
          onSelect(token);
        }, 500);
      } else {
        setImportStatus("error");
        setImportError("Token not found at this address");
      }
    } catch (err: any) {
      setImportStatus("error");
      setImportError(err?.message || "Failed to resolve token address");
    }
  }, [chainId, onSelect]);

  // Handle favorite toggle
  const handleToggleFav = useCallback((token: TokenInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(chainId, token.address);
    playVipButtonChime();
    forceUpdate((n) => n + 1);
  }, [chainId]);

  // Handle token selection
  const handleSelect = useCallback((token: TokenInfo) => {
    playVipButtonChime();
    onSelect(token);
  }, [onSelect]);

  // Determine which tokens to display
  const displayTokens = useMemo(() => {
    const source = searchResults !== null ? searchResults : allTokens;
    const filtered = source.filter(
      (t) => t.address.toLowerCase() !== excludeAddress.toLowerCase(),
    );

    // If enriched data is available and no search query, sort by USD balance
    if (!query && enrichedTokens) {
      return filtered.sort((a, b) => {
        const ea = enrichedMap.get(a.address.toLowerCase());
        const eb = enrichedMap.get(b.address.toLowerCase());
        const balA = ea?.balanceUsd ?? 0;
        const balB = eb?.balanceUsd ?? 0;
        if (balA !== balB) return balB - balA; // Highest balance first
        // Tokens with any balance (but no USD) come next
        const hasBalA = ea?.balance && ea.balance !== "0" ? 1 : 0;
        const hasBalB = eb?.balance && eb.balance !== "0" ? 1 : 0;
        if (hasBalA !== hasBalB) return hasBalB - hasBalA;
        return 0;
      });
    }

    return filtered;
  }, [searchResults, allTokens, excludeAddress, query, enrichedTokens, enrichedMap]);

  // Check if query looks like a contract address
  const isAddressQuery = query.startsWith("0x") && query.length === 42;
  const tokenNotInList = isAddressQuery && displayTokens.length === 0;

  if (!isOpen) return null;

  const inputClass = isDark
    ? "bg-slate-800/60 border border-slate-700/30"
    : "bg-gray-50 border border-gray-200";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Dropdown */}
      <motion.div
        initial={{ opacity: 0, y: -6, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.96 }}
        transition={{ duration: 0.15 }}
        className={`absolute top-full right-0 mt-2 w-80 rounded-2xl shadow-2xl overflow-hidden z-50 ${
          isDark
            ? "bg-slate-900 border border-pink-500/20 shadow-pink-500/5"
            : "bg-white border border-gray-200 shadow-lg"
        }`}
      >
        {/* Search bar */}
        <div className="p-3 pb-2">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${inputClass}`}>
            <Search className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
            <input
              ref={inputRef}
              type="text"
              placeholder={allTokens.length ? `Search ${allTokens.length.toLocaleString()} tokens...` : "Search tokens..."}
              className="bg-transparent flex-1 outline-none text-sm"
              value={query}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            {query && (
              <button
                onClick={() => handleSearchChange("")}
                className={`p-0.5 rounded ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-200"}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {isSearching && <Loader2 className="w-3.5 h-3.5 animate-spin text-pink-400" />}
          </div>
        </div>

        {/* Favorites quick-access row */}
        {!query && favorites.length > 0 && (
          <div className="px-3 pb-2">
            <div className={`flex items-center gap-1 mb-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              <Star className="w-3 h-3 fill-current" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Favorites</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {favorites
                .filter((t) => t.address.toLowerCase() !== excludeAddress.toLowerCase())
                .slice(0, 8)
                .map((t) => (
                  <button
                    key={`fav-${t.address}`}
                    onClick={() => handleSelect(t)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                      isDark
                        ? "bg-slate-800/60 hover:bg-pink-500/10 border border-slate-700/30"
                        : "bg-gray-100 hover:bg-pink-50 border border-gray-200"
                    }`}
                  >
                    {t.logoURI ? (
                      <img src={t.logoURI} alt={t.symbol} className="w-4 h-4 rounded-full"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-gradient-to-br from-pink-500 to-purple-500" />
                    )}
                    {t.symbol}
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Recent tokens */}
        {!query && recents.length > 0 && (
          <div className="px-3 pb-2">
            <div className={`flex items-center gap-1 mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              <Clock className="w-3 h-3" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Recent</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recents
                .filter((t) => t.address.toLowerCase() !== excludeAddress.toLowerCase())
                .slice(0, 6)
                .map((t) => (
                  <button
                    key={`recent-${t.address}`}
                    onClick={() => handleSelect(t)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-all ${
                      isDark
                        ? "bg-slate-800/40 hover:bg-pink-500/10 text-slate-300"
                        : "bg-gray-50 hover:bg-pink-50 text-gray-600"
                    }`}
                  >
                    {t.logoURI ? (
                      <img src={t.logoURI} alt={t.symbol} className="w-3.5 h-3.5 rounded-full"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : null}
                    {t.symbol}
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Divider */}
        {!query && (favorites.length > 0 || recents.length > 0) && (
          <div className={`mx-3 border-t ${isDark ? "border-slate-800" : "border-gray-100"}`} />
        )}

        {/* Token list */}
        <div className="max-h-64 overflow-y-auto px-2 pb-2 pt-1">
          {displayTokens.slice(0, 50).map((t) => (
            <TokenRow
              key={t.address}
              token={t}
              enriched={enrichedMap.get(t.address.toLowerCase()) || null}
              isFav={isFavorite(chainId, t.address)}
              onSelect={() => handleSelect(t)}
              onToggleFav={(e) => handleToggleFav(t, e)}
              isDark={isDark}
            />
          ))}

          {/* Custom import prompt */}
          {tokenNotInList && importStatus === "idle" && (
            <div className="p-4 text-center">
              <Download className={`w-6 h-6 mx-auto mb-2 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
              <p className={`text-sm font-semibold mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                Import Custom Token
              </p>
              <p className={`text-xs mb-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Token not in our list. Import it by address?
              </p>
              <button
                onClick={() => handleImportToken(query)}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-pink-600 to-purple-600 text-white hover:from-pink-500 hover:to-purple-500 transition-all"
              >
                Import Token
              </button>
            </div>
          )}

          {/* Import loading */}
          {importStatus === "loading" && (
            <div className="p-4 text-center">
              <Loader2 className="w-6 h-6 mx-auto animate-spin text-pink-400 mb-2" />
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Resolving token...
              </p>
            </div>
          )}

          {/* Import success */}
          {importStatus === "success" && (
            <div className="p-4 text-center">
              <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-400 mb-2" />
              <p className={`text-sm font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                Token imported!
              </p>
            </div>
          )}

          {/* Import error */}
          {importStatus === "error" && (
            <div className="p-4 text-center">
              <AlertCircle className="w-6 h-6 mx-auto text-red-400 mb-2" />
              <p className={`text-sm ${isDark ? "text-red-400" : "text-red-600"}`}>
                {importError || "Failed to import token"}
              </p>
              <button
                onClick={() => setImportStatus("idle")}
                className={`mt-2 text-xs ${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"}`}
              >
                Try Again
              </button>
            </div>
          )}

          {/* Empty states */}
          {!tokenNotInList && displayTokens.length === 0 && (
            <div className={`text-center py-6 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {isLoading || isSearching
                ? "Loading tokens..."
                : query
                  ? "No tokens found"
                  : "Type to search all tokens"}
            </div>
          )}

          {/* Token count footer */}
          {displayTokens.length > 50 && (
            <div className={`text-center py-2 text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
              Showing 50 of {displayTokens.length.toLocaleString()} tokens · Refine your search
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
});

/**
 * TokenIcon — Production-ready token icon with multi-source fallback.
 *
 * Builds a deduplicated URL chain on each render, indexed by failCount:
 *   [0] Primary `src` prop (from token.logo — static or API-patched)
 *   [1] Icon registry URL (populated from SaucerSwap API via server proxy)
 *   [2] SaucerSwap CDN by symbol:  /images/tokens/{symbol_lower}.svg
 *   [3] SaucerSwap CDN by symbol:  /images/tokens/{symbol_lower}.png
 *   [4] SaucerSwap CDN by HTS ID:  /images/tokens/{htsId}.png
 *   [5] SaucerSwap CDN by HTS ID:  /images/tokens/{htsId}.svg
 *   [∞] Letter avatar (deterministic color)
 *
 * Duplicates are stripped so the chain never re-tries a URL that
 * already failed. The icon registry is a global Map populated once
 * from our server proxy (no CORS issues). Components subscribe to
 * updates via a lightweight listener set.
 *
 * [C79-01] Production icon system — replaces single-source + letter fallback.
 */
import { useState, useEffect, useMemo, memo, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════
// ── ICON REGISTRY ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

/** Global icon URL map: htsId -> best known icon URL */
const _iconRegistry = new Map<string, string>();

/** Listeners that want to know when registry updates */
const _registryListeners = new Set<() => void>();

function _notifyRegistryListeners() {
  for (const fn of _registryListeners) fn();
}

/** Register a batch of icon URLs (called after API fetch). */
export function registerTokenIcons(entries: Array<{ htsId: string; iconUrl: string }>) {
  let added = 0;
  for (const { htsId, iconUrl } of entries) {
    if (htsId && iconUrl && !_iconRegistry.has(htsId)) {
      _iconRegistry.set(htsId, iconUrl);
      added++;
    }
  }
  if (added > 0) _notifyRegistryListeners();
  return added;
}

/** Get icon URL from registry. */
export function getRegisteredIcon(htsId: string): string | undefined {
  return _iconRegistry.get(htsId);
}

// ═══════════════════════════════════════════════════════════════════════
// ── DETERMINISTIC LETTER AVATAR ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

const AVATAR_COLORS = [
  "#7C3AED", "#EC4899", "#3B82F6", "#10B981", "#F59E0B",
  "#EF4444", "#06B6D4", "#8B5CF6", "#F97316", "#14B8A6",
  "#E11D48", "#6366F1", "#84CC16", "#D946EF", "#0EA5E9",
];

function symbolToColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ═══════════════════════════════════════════════════════════════════════
// ── URL CHAIN BUILDER ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

const SS_CDN = "https://www.saucerswap.finance";

/**
 * Build a deduplicated array of URLs to try, in priority order.
 * No URL appears twice — if src === registryUrl, it's only tried once.
 */
function buildUrlChain(src: string, symbol: string, htsId?: string): string[] {
  const seen = new Set<string>();
  const chain: string[] = [];

  const add = (url: string | undefined) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      chain.push(url);
    }
  };

  // 1. Primary src
  add(src);

  // 2. Icon registry (populated from SaucerSwap API via server proxy)
  if (htsId) add(_iconRegistry.get(htsId));

  // 3. SaucerSwap CDN by symbol (svg then png)
  if (symbol) {
    const sym = symbol.toLowerCase();
    add(`${SS_CDN}/images/tokens/${sym}.svg`);
    add(`${SS_CDN}/images/tokens/${sym}.png`);
  }

  // 4. SaucerSwap CDN by HTS ID (png then svg)
  if (htsId && htsId !== "native") {
    add(`${SS_CDN}/images/tokens/${htsId}.png`);
    add(`${SS_CDN}/images/tokens/${htsId}.svg`);
  }

  return chain;
}

// ═══════════════════════════════════════════════════════════════════════
// ── COMPONENT ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

interface TokenIconProps {
  src: string;
  symbol: string;
  /** HTS token ID (e.g. "0.0.731861") — enables registry + CDN fallbacks */
  htsId?: string;
  className?: string;
  /** Size in Tailwind class format (e.g. "w-6 h-6"). Defaults to "w-6 h-6" */
  size?: string;
}

export const TokenIcon = memo(function TokenIcon({
  src,
  symbol,
  htsId,
  className = "",
  size = "w-6 h-6",
}: TokenIconProps) {
  // Track which URL in the chain we're on
  const [failCount, setFailCount] = useState(0);

  // Subscribe to icon registry updates — when new icons are registered,
  // the URL chain may gain new entries to try.
  const [regVer, setRegVer] = useState(0);
  useEffect(() => {
    const handler = () => setRegVer(v => v + 1);
    _registryListeners.add(handler);
    return () => { _registryListeners.delete(handler); };
  }, []);

  // Reset fail state when src or htsId changes (user switched token)
  useEffect(() => {
    setFailCount(0);
  }, [src, htsId]);

  const handleError = useCallback(() => {
    setFailCount(c => c + 1);
  }, []);

  // Build the deduplicated URL chain — recalculated when inputs change
  // or when the icon registry gets new entries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const urlChain = useMemo(
    () => buildUrlChain(src, symbol, htsId),
    [src, symbol, htsId, regVer],
  );

  const currentUrl = failCount < urlChain.length ? urlChain[failCount] : null;

  // If no URL to try → render letter avatar
  if (!currentUrl) {
    const bg = symbolToColor(symbol);
    const letter = (symbol || "?").charAt(0).toUpperCase();
    const sizeMatch = size.match(/w-(\d+)/);
    const px = sizeMatch ? parseInt(sizeMatch[1]) * 4 : 24;
    const fontSize = Math.max(10, Math.round(px * 0.45));

    return (
      <span
        className={`${size} rounded-full inline-flex items-center justify-center shrink-0 ${className}`}
        style={{ backgroundColor: bg }}
        aria-label={symbol}
      >
        <span
          className="text-white font-bold leading-none"
          style={{ fontSize: `${fontSize}px` }}
        >
          {letter}
        </span>
      </span>
    );
  }

  return (
    <img
      src={currentUrl}
      alt={symbol}
      className={`${size} rounded-full shrink-0 object-cover ${className}`}
      onError={handleError}
      loading="lazy"
    />
  );
});

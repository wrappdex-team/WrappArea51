/**
 * TokenIcon — Reusable token icon with fallback letter-avatar.
 *
 * When an icon URL fails to load (CORS, 404, CDN change), this component
 * gracefully falls back to a colored circle with the token's first letter.
 * The circle color is deterministic (based on the symbol string) so each
 * token always gets the same color.
 *
 * [C36-04] Created to replace bare <img> tags with onError={hide} pattern.
 */
import { useState, memo } from "react";

// Deterministic color palette for fallback avatars
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

interface TokenIconProps {
  src: string;
  symbol: string;
  className?: string;
  /** Size in Tailwind class format (e.g. "w-6 h-6"). Defaults to "w-6 h-6" */
  size?: string;
}

export const TokenIcon = memo(function TokenIcon({
  src,
  symbol,
  className = "",
  size = "w-6 h-6",
}: TokenIconProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    const bg = symbolToColor(symbol);
    const letter = (symbol || "?").charAt(0).toUpperCase();
    // Extract numeric size from Tailwind class for inline font-size
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
      src={src}
      alt={symbol}
      className={`${size} rounded-full shrink-0 ${className}`}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
});

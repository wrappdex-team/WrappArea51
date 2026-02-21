/**
 * Display Symbol Normalization — WHBAR -> HBAR
 *
 * [C24-01] Centralized helper for the WHBAR -> HBAR display convention.
 *
 * SaucerSwap pools use WHBAR (Wrapped HBAR) on-chain because Hedera's
 * HTS DEX contracts require an ERC-20 compatible token, not native hbar.
 * WRAPpDEX auto-wraps/unwraps HBAR transparently, so all user-facing
 * text shows "HBAR" instead of "WHBAR". Internal identifiers, token IDs,
 * and contract addresses remain unchanged.
 *
 * This module is the single source of truth for the display mapping.
 * All components that show pool token symbols should import from here
 * instead of defining their own local `displaySymbol()` functions.
 *
 * See also:
 *   - saucerswap-pools.ts :: normalizeTokenDisplay()  (server-side)
 *   - defi-stats.ts :: normalizeSymbolForDisplay()     (frontend DeFi stats)
 *   - saucerswap.ts :: resolvePoolToken()              (swap routing)
 */

const WHBAR_TOKEN_ID = "0.0.1456986";

/**
 * Normalize a token symbol for user-facing display.
 * "WHBAR" -> "HBAR" (auto-wrap transparency).
 * All other symbols pass through unchanged.
 */
export function displaySymbol(sym: string): string {
  return sym === "WHBAR" ? "HBAR" : sym;
}

/**
 * Normalize a token name for user-facing display.
 * "Wrapped HBAR" -> "HBAR".
 */
export function displayName(name: string, symbol: string): string {
  if (symbol === "WHBAR") return "HBAR";
  return name;
}

/**
 * Check if a token ID is the WHBAR token.
 */
export function isWhbarTokenId(tokenId: string): boolean {
  return tokenId === WHBAR_TOKEN_ID;
}

/**
 * Normalize both symbol and htsId for display.
 * Handles the case where the symbol is not "WHBAR" but the token ID matches.
 */
export function displaySymbolFromId(symbol: string, htsId?: string): string {
  if (symbol === "WHBAR" || htsId === WHBAR_TOKEN_ID) return "HBAR";
  return symbol;
}

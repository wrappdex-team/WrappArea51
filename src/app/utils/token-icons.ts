/**
 * Token Icon Registry — Bulletproof icon URLs for all known tokens.
 *
 * IMPLEMENTATION NOTE:
 *   This is the single source of truth for token icon URLs across the app.
 *   All URLs use CDNs that do NOT block hotlinking from Vercel/production
 *   domains. CoinGecko's CDN (assets.coingecko.com) is the primary source
 *   for major tokens — it has an open referrer policy unlike CoinMarketCap
 *   (s2.coinmarketcap.com) which aggressively blocks hotlinking.
 *
 *   For Hedera-native tokens not listed on CoinGecko, we use the
 *   SaucerSwap CDN as primary with our icon-proxy as fallback (handled
 *   by the TokenIcon component's fallback chain).
 *
 * Lookup order in the app:
 *   1. This map (by HTS ID) — guaranteed reliable URLs
 *   2. Icon registry (populated from SaucerSwap API at runtime)
 *   3. SaucerSwap CDN by symbol/HTS ID
 *   4. Server-side icon proxy (bypasses CDN blocks)
 *   5. Deterministic letter avatar (last resort)
 */

// ── CoinGecko CDN (open referrer policy, works everywhere) ──────────
// URL pattern: https://assets.coingecko.com/coins/images/{cg_id}/standard/{filename}
// These URLs are stable and do NOT require API keys.

const CG = "https://assets.coingecko.com/coins/images";

/**
 * Definitive HTS-ID → icon URL map for all known tokens.
 * Keyed by Hedera Token Service ID (e.g. "0.0.456858") or "native" for HBAR.
 */
export const RELIABLE_TOKEN_ICONS: Record<string, string> = {
  // ── Major Tokens (CoinGecko CDN — works on all deployments) ───────
  "native":      `${CG}/3688/standard/hbar.png`,             // HBAR
  "0.0.1456986": `${CG}/3688/standard/hbar.png`,             // WHBAR
  "0.0.456858":  `${CG}/6319/standard/usdc.png`,             // USDC
  "0.0.1055472": `${CG}/325/standard/Tether.png`,            // USDT (HashPort)
  "0.0.1055483": `${CG}/7598/standard/wrapped_bitcoin_wbtc.png`, // WBTC (HashPort)
  "0.0.1055495": `${CG}/877/standard/chainlink-new-logo.png`,    // LINK (HashPort)
  "0.0.541564":  `${CG}/279/standard/ethereum.png`,          // WETH canonical (HashPort)
  "0.0.9770617": `${CG}/279/standard/ethereum.png`,          // WETH alternate / V2 wrapper
  "0.0.1055498": `${CG}/12645/standard/aave-token-round.png`,// AAVE (HashPort)
  "0.0.1055477": `${CG}/9956/standard/Badge_Dai.png`,        // DAI (HashPort)
  "0.0.1055459": `${CG}/6319/standard/usdc.png`,             // USDCh (HashPort USDC)
  "0.0.1157005": `${CG}/825/standard/bnb-icon2_2x.png`,      // WBNB (LayerZero)
  "0.0.1157020": `${CG}/12559/standard/Avalanche_Circle_RedWhite_Trans.png`, // WAVAX
  "0.0.3306241": `${CG}/4713/standard/polygon.png`,          // WPOL
  "0.0.540318":  `${CG}/4713/standard/polygon.png`,          // WMATIC

  // ── Hedera-Native Tokens (CoinGecko where available) ──────────────
  "0.0.731861":  `${CG}/28255/standard/SAUCE.png`,           // SAUCE
  "0.0.834116":  `${CG}/28362/standard/Hbarx.png`,           // HBARX
  "0.0.2283230": `${CG}/30375/standard/karate_200x200.png`,  // KARATE
  "0.0.4794920": `${CG}/28506/standard/hashpack-logo.png`,   // PACK
  "0.0.3716059": `${CG}/3455/standard/dovu.png`,             // DOVU
  "0.0.968069":  `${CG}/14336/standard/headstarter.png`,     // HST
  "0.0.127877":  `${CG}/2969/standard/JAM_logo200x200.png`,  // JAM
  "0.0.859814":  `${CG}/18507/standard/calaxy.png`,          // CLXY

  // ── HBAR.ħ Protocol (our own token — inline SVG data URI) ─────────
  "0.0.9356476": `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<circle cx="50" cy="50" r="48" fill="#0a0e1a" stroke="#1D63ED" stroke-width="3"/>' +
    '<text x="50" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="58" font-weight="700" fill="#1D63ED">\u0127</text>' +
    '</svg>'
  )}`,
};

/**
 * Look up a reliable icon URL by HTS ID.
 * Returns undefined if no known-good URL exists for this token
 * (caller should fall through to SaucerSwap CDN / icon proxy).
 */
export function getReliableIconUrl(htsId: string): string | undefined {
  return RELIABLE_TOKEN_ICONS[htsId];
}

/**
 * Look up a reliable icon URL by symbol (slower — iterates the map).
 * Used as a fallback when HTS ID isn't available.
 */
const _symbolIndex = new Map<string, string>();
let _symbolIndexBuilt = false;

export function getReliableIconBySymbol(symbol: string): string | undefined {
  // Build symbol index lazily (only once)
  if (!_symbolIndexBuilt) {
    _symbolIndexBuilt = true;
    const symbolMap: Record<string, string> = {
      "HBAR": "native",
      "WHBAR": "0.0.1456986",
      "USDC": "0.0.456858",
      "USDT": "0.0.1055472",
      "WBTC": "0.0.1055483",
      "LINK": "0.0.1055495",
      "WETH": "0.0.9770617",
      "AAVE": "0.0.1055498",
      "DAI": "0.0.1055477",
      "SAUCE": "0.0.731861",
      "HBARX": "0.0.834116",
      "KARATE": "0.0.2283230",
      "PACK": "0.0.4794920",
      "DOVU": "0.0.3716059",
      "HST": "0.0.968069",
      "JAM": "0.0.127877",
      "CLXY": "0.0.859814",
      "WBNB": "0.0.1157005",
      "WAVAX": "0.0.1157020",
      "WPOL": "0.0.3306241",
      "WMATIC": "0.0.540318",
      "USDCh": "0.0.1055459",
      "HBAR.\u0127": "0.0.9356476",
      "HBAR.h": "0.0.9356476",
    };
    for (const [sym, htsId] of Object.entries(symbolMap)) {
      const url = RELIABLE_TOKEN_ICONS[htsId];
      if (url) _symbolIndex.set(sym, url);
    }
  }
  return _symbolIndex.get(symbol) ?? _symbolIndex.get(symbol.replace("[hts]", "").replace("[HTS]", ""));
}
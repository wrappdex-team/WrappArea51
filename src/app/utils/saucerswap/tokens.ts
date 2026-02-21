/**
 * [C48] SaucerSwap Token Registry & Pure Helpers
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: AllowedToken type, token list, lookup helpers, conversion utilities.
 * Zero side effects — safe to import anywhere.
 */

import { log } from "../logger";

// ── Shared Types ────────────────────────────────────────────────────

export type HederaNetwork = "mainnet" | "testnet";

export const HBARH_TOKEN_ID = "0.0.9356476";

// ── Allowed Token Registry ──────────────────────────────────────────

export interface AllowedToken {
  symbol: string;
  name: string;
  htsId: string;
  evmAddress: string;
  decimals: number;
  logo: string;
  rank: number;
  isWrapped: boolean;
  bridge?: string;
  isNative?: boolean;
  /** SaucerSwap-listed HTS ID when different from htsId (for oracle price lookup) */
  saucerswapAliasId?: string;
}

// ── Address Converters ──────────────────────────────────────────────

export function htsIdToEvmAddress(htsId: string): string {
  const parts = htsId.split(".");
  const tokenNum = parseInt(parts[2], 10);
  return "0x" + tokenNum.toString(16).padStart(40, "0");
}

export function evmAddressToHtsId(evmAddr: string): string {
  const hex = evmAddr.replace("0x", "");
  const tokenNum = parseInt(hex, 16);
  return "0.0." + tokenNum;
}

// ── Token List ──────────────────────────────────────────────────────

export const SAUCERSWAP_TOKENS: AllowedToken[] = [
  {
    symbol: "HBAR", name: "HBAR", htsId: "native",
    evmAddress: "0x0000000000000000000000000000000000000000", decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
    rank: 0, isWrapped: false, isNative: true,
  },
  {
    symbol: "WHBAR", name: "Wrapped HBAR", htsId: "0.0.1456986",
    evmAddress: htsIdToEvmAddress("0.0.1456986"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
    rank: 1, isWrapped: false,
  },
  {
    symbol: "USDC", name: "USD Coin", htsId: "0.0.456858",
    evmAddress: htsIdToEvmAddress("0.0.456858"), decimals: 6,
    logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    rank: 2, isWrapped: false,
  },
  {
    // [C36-04] Changed from native USDT 0.0.4291336 (no SaucerSwap pools) to
    // HashPort USDT 0.0.1055472 (the USDT that SaucerSwap actually trades).
    // SaucerSwap.finance lists this as their primary USDT.
    symbol: "USDT", name: "Tether USD", htsId: "0.0.1055472",
    evmAddress: htsIdToEvmAddress("0.0.1055472"), decimals: 6,
    logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png",
    rank: 3, isWrapped: true, bridge: "HashPort",
  },
  {
    // [C36-04] Removed saucerswapAliasId "0.0.1969769"
    symbol: "WBTC", name: "Wrapped Bitcoin", htsId: "0.0.1055483",
    evmAddress: htsIdToEvmAddress("0.0.1055483"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
    rank: 4, isWrapped: true, bridge: "HashPort",
  },
  {
    // [C36-04] Removed saucerswapAliasId "0.0.1970030"
    symbol: "LINK", name: "Chainlink", htsId: "0.0.1055495",
    evmAddress: htsIdToEvmAddress("0.0.1055495"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
    rank: 5, isWrapped: true, bridge: "HashPort",
  },
  {
    symbol: "SAUCE", name: "SaucerSwap", htsId: "0.0.731861",
    evmAddress: htsIdToEvmAddress("0.0.731861"), decimals: 6,
    logo: "https://www.saucerswap.finance/images/tokens/sauce.svg",
    rank: 6, isWrapped: false,
  },
  {
    symbol: "HBARX", name: "Stader HBAR", htsId: "0.0.834116",
    evmAddress: htsIdToEvmAddress("0.0.834116"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/hbarx.svg",
    rank: 7, isWrapped: false,
  },
  {
    symbol: "KARATE", name: "Karate Combat", htsId: "0.0.2283230",
    evmAddress: htsIdToEvmAddress("0.0.2283230"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/karate.svg",
    rank: 8, isWrapped: false,
  },
  {
    symbol: "PACK", name: "HashPack", htsId: "0.0.4589822",
    evmAddress: htsIdToEvmAddress("0.0.4589822"), decimals: 6,
    logo: "https://www.saucerswap.finance/images/tokens/pack.svg",
    rank: 9, isWrapped: false,
  },
  {
    symbol: "DOVU", name: "DOVU", htsId: "0.0.3716059",
    evmAddress: htsIdToEvmAddress("0.0.3716059"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/dovu.svg",
    rank: 10, isWrapped: false,
  },
  {
    symbol: "HST", name: "HSuite Token", htsId: "0.0.786931",
    evmAddress: htsIdToEvmAddress("0.0.786931"), decimals: 8,
    logo: "https://www.saucerswap.finance/images/tokens/hst.svg",
    rank: 11, isWrapped: false,
  },
  {
    // [C36-04] WETH decimals: 18 is correct (verified via HashScan).
    symbol: "WETH", name: "Wrapped Ether", htsId: "0.0.541564",
    evmAddress: htsIdToEvmAddress("0.0.541564"), decimals: 18,
    logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
    rank: 12, isWrapped: true, bridge: "HashPort",
  },
  {
    symbol: "AAVE", name: "Aave", htsId: "0.0.1055498",
    evmAddress: htsIdToEvmAddress("0.0.1055498"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png",
    rank: 13, isWrapped: true, bridge: "HashPort",
  },
  {
    symbol: "DAI", name: "Dai Stablecoin", htsId: "0.0.1055477",
    evmAddress: htsIdToEvmAddress("0.0.1055477"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
    rank: 14, isWrapped: true, bridge: "HashPort",
  },
  {
    symbol: "HBAR.\u0127", name: "HBAR.\u0127 Protocol", htsId: HBARH_TOKEN_ID,
    evmAddress: htsIdToEvmAddress(HBARH_TOKEN_ID), decimals: 8,
    // [C36-04] SaucerSwap icon via HTS ID-based CDN path
    logo: `https://www.saucerswap.finance/images/tokens/${HBARH_TOKEN_ID}.svg`,
    rank: 15, isWrapped: false,
  },
  {
    symbol: "WPOL", name: "Wrapped POL (Polygon)", htsId: "0.0.3306241",
    evmAddress: htsIdToEvmAddress("0.0.3306241"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/4713/large/polygon.png",
    rank: 16, isWrapped: true, bridge: "HashPort",
  },
  // ── HashPort / LayerZero Bridge Stablecoins ──
  {
    symbol: "USDCh", name: "USDC (HashPort)", htsId: "0.0.1055459",
    evmAddress: htsIdToEvmAddress("0.0.1055459"), decimals: 6,
    logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    rank: 20, isWrapped: true, bridge: "HashPort",
  },
  // [C36-04] USDTh (0.0.1055472) removed — merged into USDT above.
  {
    symbol: "WBNB", name: "Wrapped BNB", htsId: "0.0.1157005",
    evmAddress: htsIdToEvmAddress("0.0.1157005"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
    rank: 22, isWrapped: true, bridge: "LayerZero",
  },
  {
    symbol: "WAVAX", name: "Wrapped AVAX", htsId: "0.0.1157020",
    evmAddress: htsIdToEvmAddress("0.0.1157020"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
    rank: 23, isWrapped: true, bridge: "LayerZero",
  },
  {
    symbol: "WMATIC", name: "Wrapped MATIC", htsId: "0.0.540318",
    evmAddress: htsIdToEvmAddress("0.0.540318"), decimals: 8,
    logo: "https://assets.coingecko.com/coins/images/4713/large/polygon.png",
    rank: 24, isWrapped: true, bridge: "HashPort",
  },
];

export const TOKEN_BY_SYMBOL = new Map(SAUCERSWAP_TOKENS.map((t) => [t.symbol, t]));
export const TOKEN_BY_HTS_ID = new Map(SAUCERSWAP_TOKENS.map((t) => [t.htsId, t]));

// ── Routing Helpers ─────────────────────────────────────────────────

/**
 * Get the HTS ID to use when calling SaucerSwap APIs / on-chain router.
 * For bridge tokens whose canonical HTS ID differs from the SaucerSwap-listed
 * pool token, returns the saucerswapAliasId. For all others, returns htsId.
 *
 * Use this for quote fetching and router path building -- NOT for token
 * association, balance checks, or approval transactions (those need the
 * real bridge token htsId the user actually holds).
 */
export function getSaucerswapRoutingId(token: AllowedToken): string {
  return token.saucerswapAliasId || token.htsId;
}

/**
 * Get the EVM address for SaucerSwap routing (uses alias if available).
 */
export function getSaucerswapRoutingEvmAddress(token: AllowedToken): string {
  const routingId = getSaucerswapRoutingId(token);
  return routingId === "native"
    ? "0x0000000000000000000000000000000000000000"
    : htsIdToEvmAddress(routingId);
}

export function resolveToken(symbol: string): AllowedToken | undefined {
  // Check exact match first -- critical for symbols with non-ASCII characters
  // like "HBAR.\u0127" where toUpperCase() produces "HBAR.\u0126" (wrong Map key).
  const exact = TOKEN_BY_SYMBOL.get(symbol);
  if (exact) return exact;

  // HBAR (native) is its own token now -- not aliased to WHBAR
  const aliases: Record<string, string> = {
    ETH: "WETH", BTC: "WBTC", MATIC: "WMATIC", POL: "WPOL", POLY: "WPOL",
    BNB: "WBNB", AVAX: "WAVAX",
    // Legacy "h" suffixed symbols (removed from registry, kept for backward compat)
    WBTCH: "WBTC", WETHH: "WETH", LINKH: "LINK",
  };
  const upper = symbol.toUpperCase();
  const resolved = aliases[upper] || upper;
  return TOKEN_BY_SYMBOL.get(resolved);
}

/**
 * Check if a symbol represents native HBAR.
 */
export function isNativeHbar(symbol: string): boolean {
  return symbol.toUpperCase() === "HBAR";
}

/**
 * Check if a token pair is an HBAR <-> WHBAR wrap/unwrap operation.
 * These bypass pool routing and use wrapHbar()/unwrapHbar() directly.
 */
export function isHbarWhbarPair(symbolA: string, symbolB: string): boolean {
  const a = symbolA.toUpperCase();
  const b = symbolB.toUpperCase();
  return (a === "HBAR" && b === "WHBAR") || (a === "WHBAR" && b === "HBAR");
}

/**
 * Get the WHBAR AllowedToken. Used internally for routing native HBAR
 * through WHBAR pools and for building contract call paths.
 */
export function getWhbarToken(): AllowedToken {
  return TOKEN_BY_SYMBOL.get("WHBAR")!;
}

// ── [C66] Dynamic Icon Resolution from SaucerSwap API ───────────────
// Fetches official token icons from the SaucerSwap /tokens endpoint on
// first load and patches SAUCERSWAP_TOKENS in-place. This ensures we
// always show the correct project-uploaded icons, even if our static
// CDN URLs change or a new token is added.
let _iconFetchDone = false;
export async function fetchAndApplyTokenIcons(): Promise<void> {
  if (_iconFetchDone) return;
  _iconFetchDone = true; // Only try once per session
  try {
    const res = await fetch("https://api.saucerswap.finance/tokens", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const data = await res.json();
    // API returns array of token objects with { id, symbol, icon, ... }
    const tokens: any[] = Array.isArray(data) ? data : Object.values(data);
    const iconByHtsId = new Map<string, string>();
    for (const t of tokens) {
      const id = t.id || t.tokenId || "";
      const icon = t.icon || t.image || "";
      if (id && icon) {
        // SaucerSwap returns relative paths like "/images/tokens/sauce.svg"
        const fullUrl = icon.startsWith("http")
          ? icon
          : `https://www.saucerswap.finance${icon}`;
        iconByHtsId.set(id, fullUrl);
      }
    }
    // Patch token logos in-place
    let updated = 0;
    for (const token of SAUCERSWAP_TOKENS) {
      if (token.htsId === "native") continue; // HBAR uses CoinGecko
      const apiIcon = iconByHtsId.get(token.htsId);
      if (apiIcon && apiIcon !== token.logo) {
        token.logo = apiIcon;
        updated++;
      }
    }
    if (updated > 0) {
      log.info("TokenIcons", `Updated ${updated} token icons from SaucerSwap API`);
    }
  } catch (e: any) {
    // Non-critical — static icons remain as fallback
    log.warn("TokenIcons", `Icon fetch failed (non-blocking): ${e?.message || e}`);
  }
}
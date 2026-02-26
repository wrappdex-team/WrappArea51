/**
 * [C48] SaucerSwap Token Registry & Pure Helpers
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: AllowedToken type, token list, lookup helpers, conversion utilities.
 * Zero side effects — safe to import anywhere.
 */

import { log } from "../logger";
import { getReliableIconUrl } from "../token-icons";

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

// IMPLEMENTATION NOTE: Icon URLs use getReliableIconUrl() which returns
// CoinGecko CDN URLs for known tokens. CoinGecko's CDN does NOT block
// hotlinking from Vercel/production domains, unlike CoinMarketCap's
// s2.coinmarketcap.com which aggressively blocks external referrers.
// Tokens without a CoinGecko entry fall back to SaucerSwap CDN, with
// the TokenIcon component's multi-source chain (including our icon proxy)
// providing further fallbacks.

export const SAUCERSWAP_TOKENS: AllowedToken[] = [
  {
    symbol: "HBAR", name: "HBAR", htsId: "native",
    evmAddress: "0x0000000000000000000000000000000000000000", decimals: 8,
    logo: getReliableIconUrl("native") || "https://assets.coingecko.com/coins/images/3688/standard/hbar.png",
    rank: 0, isWrapped: false, isNative: true,
  },
  {
    symbol: "WHBAR", name: "Wrapped HBAR", htsId: "0.0.1456986",
    evmAddress: htsIdToEvmAddress("0.0.1456986"), decimals: 8,
    logo: getReliableIconUrl("0.0.1456986") || "https://assets.coingecko.com/coins/images/3688/standard/hbar.png",
    rank: 1, isWrapped: false,
  },
  {
    symbol: "USDC", name: "USD Coin", htsId: "0.0.456858",
    evmAddress: htsIdToEvmAddress("0.0.456858"), decimals: 6,
    logo: getReliableIconUrl("0.0.456858") || "https://assets.coingecko.com/coins/images/6319/standard/usdc.png",
    rank: 2, isWrapped: false,
  },
  {
    // [C36-04] Changed from native USDT 0.0.4291336 (no SaucerSwap pools) to
    // HashPort USDT 0.0.1055472 (the USDT that SaucerSwap actually trades).
    // SaucerSwap.finance lists this as their primary USDT.
    symbol: "USDT", name: "Tether USD", htsId: "0.0.1055472",
    evmAddress: htsIdToEvmAddress("0.0.1055472"), decimals: 6,
    logo: getReliableIconUrl("0.0.1055472") || "https://assets.coingecko.com/coins/images/325/standard/Tether.png",
    rank: 3, isWrapped: true, bridge: "HashPort",
  },
  {
    // [SECURITY-FIX-2] REMOVED saucerswapAliasId: 0.0.10104132 was routing to FAKE/SCAM WBTC
    // with astronomical fake balances and near-zero price ($0.000004). The CORRECT WBTC is
    // the canonical HashPort bridge token 0.0.1055483 at proper BTC price (~$65k-$104k).
    // Previous comment claiming "SaucerSwap API lists 0.0.10104132 as primary" was INCORRECT
    // and caused users to receive worthless scam tokens instead of real WBTC.
    symbol: "WBTC", name: "Wrapped Bitcoin", htsId: "0.0.1055483",
    evmAddress: htsIdToEvmAddress("0.0.1055483"), decimals: 8,
    logo: getReliableIconUrl("0.0.1055483") || "https://assets.coingecko.com/coins/images/7598/standard/wrapped_bitcoin_wbtc.png",
    rank: 4, isWrapped: true, bridge: "HashPort",
    // saucerswapAliasId removed — use canonical ID for routing
  },
  {
    // [SECURITY-FIX] REMOVED saucerswapAliasId: 0.0.10152778 was routing to FAKE/SCAM token
    // with very low liquidity. The CORRECT LINK token is the canonical HashPort bridge
    // token 0.0.1055495. NO ALIAS NEEDED — SaucerSwap pools use the canonical ID.
    // Previous comments claiming "SaucerSwap API now lists 0.0.10152778 as primary" were
    // INCORRECT and caused users to receive worthless scam tokens instead of real LINK.
    symbol: "LINK", name: "Chainlink", htsId: "0.0.1055495",
    evmAddress: htsIdToEvmAddress("0.0.1055495"), decimals: 8,
    logo: getReliableIconUrl("0.0.1055495") || "https://assets.coingecko.com/coins/images/877/standard/chainlink-new-logo.png",
    rank: 5, isWrapped: true, bridge: "HashPort",
    // saucerswapAliasId removed — use canonical ID for routing
  },
  {
    symbol: "SAUCE", name: "SaucerSwap", htsId: "0.0.731861",
    evmAddress: htsIdToEvmAddress("0.0.731861"), decimals: 6,
    logo: getReliableIconUrl("0.0.731861") || "https://www.saucerswap.finance/images/tokens/sauce.svg",
    rank: 6, isWrapped: false,
  },
  {
    symbol: "HBARX", name: "Stader HBAR", htsId: "0.0.834116",
    evmAddress: htsIdToEvmAddress("0.0.834116"), decimals: 8,
    logo: getReliableIconUrl("0.0.834116") || "https://www.saucerswap.finance/images/tokens/hbarx.svg",
    rank: 7, isWrapped: false,
  },
  {
    symbol: "KARATE", name: "Karate Combat", htsId: "0.0.2283230",
    evmAddress: htsIdToEvmAddress("0.0.2283230"), decimals: 8,
    logo: getReliableIconUrl("0.0.2283230") || "https://www.saucerswap.finance/images/tokens/karate.svg",
    rank: 8, isWrapped: false,
  },
  {
    // [C85] Updated from 0.0.4589822 (old/deprecated) → 0.0.4794920 (current active
    // PACK token on SaucerSwap & Hedera mainnet). The old ID was never in any active
    // SaucerSwap pool — caused wallet token ID mismatch (Mirror Node returned the
    // real ID, our registry had the wrong one).
    symbol: "PACK", name: "HashPack", htsId: "0.0.4794920",
    evmAddress: htsIdToEvmAddress("0.0.4794920"), decimals: 6,
    logo: getReliableIconUrl("0.0.4794920") || "https://www.saucerswap.finance/images/tokens/pack.svg",
    rank: 9, isWrapped: false,
  },
  {
    symbol: "DOVU", name: "DOVU", htsId: "0.0.3716059",
    evmAddress: htsIdToEvmAddress("0.0.3716059"), decimals: 8,
    logo: getReliableIconUrl("0.0.3716059") || "https://www.saucerswap.finance/images/tokens/dovu.svg",
    rank: 10, isWrapped: false,
  },
  {
    // [C85] Updated from 0.0.786931 → 0.0.968069 (reconciliation detected mismatch
    // with SaucerSwap API — the old ID was a deprecated HST token).
    symbol: "HST", name: "HeadStarter", htsId: "0.0.968069",
    evmAddress: htsIdToEvmAddress("0.0.968069"), decimals: 8,
    logo: getReliableIconUrl("0.0.968069") || "https://www.saucerswap.finance/images/tokens/hst.svg",
    rank: 11, isWrapped: false,
  },
  {
    // [WETH-FIX] Reverted to canonical HashPort bridge token 0.0.541564.
    // 0.0.9770617 was NOT a canonical WETH — it may be a V2 ERC20Wrapper or
    // alternate token. V1 pools use the canonical ID. Same pattern as WBTC
    // (0.0.1055483) and LINK (0.0.1055495) — canonical IDs, no aliases.
    // If V2 pools need 0.0.9770617, the dynamic alias discovery on the server
    // will handle it automatically (WETH is in BRIDGE_TOKEN_SYMBOLS).
    symbol: "WETH", name: "Wrapped Ether", htsId: "0.0.541564",
    evmAddress: htsIdToEvmAddress("0.0.541564"), decimals: 8,
    logo: getReliableIconUrl("0.0.541564") || getReliableIconUrl("0.0.9770617") || "https://assets.coingecko.com/coins/images/279/standard/ethereum.png",
    rank: 12, isWrapped: true, bridge: "HashPort",
  },
  {
    symbol: "AAVE", name: "Aave", htsId: "0.0.1055498",
    evmAddress: htsIdToEvmAddress("0.0.1055498"), decimals: 8,
    logo: getReliableIconUrl("0.0.1055498") || "https://assets.coingecko.com/coins/images/12645/standard/aave-token-round.png",
    rank: 13, isWrapped: true, bridge: "HashPort",
  },
  {
    symbol: "DAI", name: "Dai Stablecoin", htsId: "0.0.1055477",
    evmAddress: htsIdToEvmAddress("0.0.1055477"), decimals: 8,
    logo: getReliableIconUrl("0.0.1055477") || "https://assets.coingecko.com/coins/images/9956/standard/Badge_Dai.png",
    rank: 14, isWrapped: true, bridge: "HashPort",
  },
  {
    symbol: "HBAR.\u0127", name: "HBAR.\u0127 Protocol", htsId: HBARH_TOKEN_ID,
    evmAddress: htsIdToEvmAddress(HBARH_TOKEN_ID), decimals: 8,
    logo: getReliableIconUrl(HBARH_TOKEN_ID) || `https://www.saucerswap.finance/images/tokens/${HBARH_TOKEN_ID}.svg`,
    rank: 15, isWrapped: false,
  },
  {
    symbol: "WPOL", name: "Wrapped POL (Polygon)", htsId: "0.0.3306241",
    evmAddress: htsIdToEvmAddress("0.0.3306241"), decimals: 8,
    logo: getReliableIconUrl("0.0.3306241") || "https://assets.coingecko.com/coins/images/4713/standard/polygon.png",
    rank: 16, isWrapped: true, bridge: "HashPort",
  },
  // ── HashPort / LayerZero Bridge Stablecoins ─
  {
    symbol: "USDCh", name: "USDC (HashPort)", htsId: "0.0.1055459",
    evmAddress: htsIdToEvmAddress("0.0.1055459"), decimals: 6,
    logo: getReliableIconUrl("0.0.1055459") || "https://assets.coingecko.com/coins/images/6319/standard/usdc.png",
    rank: 20, isWrapped: true, bridge: "HashPort",
  },
  // [C36-04] USDTh (0.0.1055472) removed — merged into USDT above.
  {
    symbol: "WBNB", name: "Wrapped BNB", htsId: "0.0.1157005",
    evmAddress: htsIdToEvmAddress("0.0.1157005"), decimals: 8,
    logo: getReliableIconUrl("0.0.1157005") || "https://assets.coingecko.com/coins/images/825/standard/bnb-icon2_2x.png",
    rank: 22, isWrapped: true, bridge: "LayerZero",
  },
  {
    symbol: "WAVAX", name: "Wrapped AVAX", htsId: "0.0.1157020",
    evmAddress: htsIdToEvmAddress("0.0.1157020"), decimals: 8,
    logo: getReliableIconUrl("0.0.1157020") || "https://assets.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png",
    rank: 23, isWrapped: true, bridge: "LayerZero",
  },
  {
    symbol: "WMATIC", name: "Wrapped MATIC", htsId: "0.0.540318",
    evmAddress: htsIdToEvmAddress("0.0.540318"), decimals: 8,
    logo: getReliableIconUrl("0.0.540318") || "https://assets.coingecko.com/coins/images/4713/standard/polygon.png",
    rank: 24, isWrapped: true, bridge: "HashPort",
  },
  // ── Whitelisted Top Tokens by Market Cap ──────────────────────────
  {
    symbol: "XSGD", name: "XSGD", htsId: "0.0.1985922",
    evmAddress: htsIdToEvmAddress("0.0.1985922"), decimals: 6,
    logo: getReliableIconUrl("0.0.1985922") || "https://www.saucerswap.finance/images/tokens/0.0.1985922.svg",
    rank: 30, isWrapped: false,
  },
  {
    symbol: "AUDD", name: "Australian Digital Dollar", htsId: "0.0.8317071",
    evmAddress: htsIdToEvmAddress("0.0.8317071"), decimals: 6,
    logo: getReliableIconUrl("0.0.8317071") || "https://www.saucerswap.finance/images/tokens/0.0.8317071.svg",
    rank: 31, isWrapped: false,
  },
  {
    // [C-RECONCILE] Updated from 0.0.7245006 → 0.0.7243470 (SaucerSwap API canonical ID)
    symbol: "XPACK", name: "xPACK", htsId: "0.0.7243470",
    evmAddress: htsIdToEvmAddress("0.0.7243470"), decimals: 6,
    logo: getReliableIconUrl("0.0.7243470") || "https://www.saucerswap.finance/images/tokens/0.0.7243470.svg",
    rank: 32, isWrapped: false,
  },
  {
    symbol: "HSUITE", name: "HubSuite", htsId: "0.0.786931",
    evmAddress: htsIdToEvmAddress("0.0.786931"), decimals: 8,
    logo: getReliableIconUrl("0.0.786931") || "https://www.saucerswap.finance/images/tokens/hsuite.svg",
    rank: 33, isWrapped: false,
  },
  {
    // [C-RECONCILE] Updated from 0.0.4873177 → 0.0.9370957 (SaucerSwap API canonical ID)
    symbol: "BTC.\u210F", name: "Bitcoin.\u210F", htsId: "0.0.9370957",
    evmAddress: htsIdToEvmAddress("0.0.9370957"), decimals: 8,
    logo: getReliableIconUrl("0.0.9370957") || "https://www.saucerswap.finance/images/tokens/0.0.9370957.svg",
    rank: 34, isWrapped: false,
  },
  {
    symbol: "GIB", name: "\u0F3C \u3064 \u25D5_\u25D5 \u0F3D\u3064 GIB", htsId: "0.0.7893707",
    evmAddress: htsIdToEvmAddress("0.0.7893707"), decimals: 8,
    logo: getReliableIconUrl("0.0.7893707") || "https://www.saucerswap.finance/images/tokens/0.0.7893707.svg",
    rank: 35, isWrapped: false,
  },
  {
    symbol: "JAM", name: "Tune.Fm", htsId: "0.0.127877",
    evmAddress: htsIdToEvmAddress("0.0.127877"), decimals: 8,
    logo: getReliableIconUrl("0.0.127877") || "https://www.saucerswap.finance/images/tokens/jam.svg",
    rank: 36, isWrapped: false,
  },
  {
    // [C-RECONCILE] Updated from 0.0.5733578 → 0.0.3210123 (SaucerSwap API canonical ID)
    symbol: "STEAM", name: "STEAM", htsId: "0.0.3210123",
    evmAddress: htsIdToEvmAddress("0.0.3210123"), decimals: 8,
    logo: getReliableIconUrl("0.0.3210123") || "https://www.saucerswap.finance/images/tokens/0.0.3210123.svg",
    rank: 37, isWrapped: false,
  },
  {
    symbol: "GRELF", name: "GRELF", htsId: "0.0.1159074",
    evmAddress: htsIdToEvmAddress("0.0.1159074"), decimals: 8,
    logo: getReliableIconUrl("0.0.1159074") || "https://www.saucerswap.finance/images/tokens/grelf.svg",
    rank: 38, isWrapped: false,
  },
  {
    symbol: "KBL", name: "Kabila", htsId: "0.0.5989978",
    evmAddress: htsIdToEvmAddress("0.0.5989978"), decimals: 8,
    logo: getReliableIconUrl("0.0.5989978") || "https://www.saucerswap.finance/images/tokens/0.0.5989978.svg",
    rank: 39, isWrapped: false,
  },
  {
    // [C-RECONCILE] Updated from 0.0.3241481 → 0.0.5185941 (SaucerSwap API canonical ID)
    symbol: "GC", name: "GCoin", htsId: "0.0.5185941",
    evmAddress: htsIdToEvmAddress("0.0.5185941"), decimals: 8,
    logo: getReliableIconUrl("0.0.5185941") || "https://www.saucerswap.finance/images/tokens/0.0.5185941.svg",
    rank: 40, isWrapped: false,
  },
  {
    // [C-RECONCILE] Updated from 0.0.6070123 → 0.0.5892321 (SaucerSwap API canonical ID)
    symbol: "HCHF", name: "Hedera Swiss Franc", htsId: "0.0.5892321",
    evmAddress: htsIdToEvmAddress("0.0.5892321"), decimals: 6,
    logo: getReliableIconUrl("0.0.5892321") || "https://www.saucerswap.finance/images/tokens/0.0.5892321.svg",
    rank: 41, isWrapped: false,
  },
  {
    // [C-RECONCILE] Updated from 0.0.7892591 → 0.0.7894159 (SaucerSwap API canonical ID)
    symbol: "DOSA", name: "Dosa the Demon", htsId: "0.0.7894159",
    evmAddress: htsIdToEvmAddress("0.0.7894159"), decimals: 8,
    logo: getReliableIconUrl("0.0.7894159") || "https://www.saucerswap.finance/images/tokens/0.0.7894159.svg",
    rank: 42, isWrapped: false,
  },
  {
    symbol: "MFM", name: "Meme Millionaires", htsId: "0.0.4599983",
    evmAddress: htsIdToEvmAddress("0.0.4599983"), decimals: 8,
    logo: getReliableIconUrl("0.0.4599983") || "https://www.saucerswap.finance/images/tokens/0.0.4599983.svg",
    rank: 43, isWrapped: false,
  },
  {
    // [C-RECONCILE] Updated from 0.0.8041571 → 0.0.10096415 (SaucerSwap API canonical ID)
    symbol: "SMACKM", name: "SMACKM", htsId: "0.0.10096415",
    evmAddress: htsIdToEvmAddress("0.0.10096415"), decimals: 8,
    logo: getReliableIconUrl("0.0.10096415") || "https://www.saucerswap.finance/images/tokens/0.0.10096415.svg",
    rank: 44, isWrapped: false,
  },
  {
    symbol: "CLXY", name: "Calaxy", htsId: "0.0.859814",
    evmAddress: htsIdToEvmAddress("0.0.859814"), decimals: 8,
    logo: getReliableIconUrl("0.0.859814") || "https://www.saucerswap.finance/images/tokens/clxy.svg",
    rank: 45, isWrapped: false,
  },
  {
    // [C-RECONCILE] Updated from 0.0.7907968 → 0.0.7570117 (SaucerSwap API canonical ID)
    symbol: "DINO", name: "DINO", htsId: "0.0.7570117",
    evmAddress: htsIdToEvmAddress("0.0.7570117"), decimals: 8,
    logo: getReliableIconUrl("0.0.7570117") || "https://www.saucerswap.finance/images/tokens/0.0.7570117.svg",
    rank: 46, isWrapped: false,
  },
  {
    // [C-RECONCILE] Updated from 0.0.7974354 → 0.0.4381245 (SaucerSwap API canonical ID)
    symbol: "LEEMON", name: "LeemonHead", htsId: "0.0.4381245",
    evmAddress: htsIdToEvmAddress("0.0.4381245"), decimals: 8,
    logo: getReliableIconUrl("0.0.4381245") || "https://www.saucerswap.finance/images/tokens/0.0.4381245.svg",
    rank: 47, isWrapped: false,
  },
  {
    symbol: "HBARBARIAN", name: "HBARbarian", htsId: "0.0.4816828",
    evmAddress: htsIdToEvmAddress("0.0.4816828"), decimals: 8,
    logo: getReliableIconUrl("0.0.4816828") || "https://www.saucerswap.finance/images/tokens/0.0.4816828.svg",
    rank: 48, isWrapped: false,
  },
  {
    symbol: "JEET", name: "Jeeteroo", htsId: "0.0.9632905",
    evmAddress: htsIdToEvmAddress("0.0.9632905"), decimals: 8,
    logo: getReliableIconUrl("0.0.9632905") || "https://www.saucerswap.finance/images/tokens/0.0.9632905.svg",
    rank: 49, isWrapped: false,
  },
];

export const TOKEN_BY_SYMBOL = new Map(SAUCERSWAP_TOKENS.map((t) => [t.symbol, t]));
export const TOKEN_BY_HTS_ID = new Map(SAUCERSWAP_TOKENS.map((t) => [t.htsId, t]));

// [WETH-FIX] Register old WETH IDs as aliases pointing to canonical WETH.
// The pool graph or SaucerSwap API may reference WETH under these alternate IDs.
// By registering them here, resolveTokenByHtsId() and graph edge resolution
// correctly map them back to our canonical WETH entry (0.0.541564).
const _wethToken = TOKEN_BY_SYMBOL.get("WETH");
if (_wethToken) {
  TOKEN_BY_HTS_ID.set("0.0.9770617", _wethToken);  // V2 ERC20Wrapper / alternate
  TOKEN_BY_HTS_ID.set("0.0.1969708", _wethToken);   // Old WETH variant
}

// ── [C56] Dynamic Token Registry ─────────────────────────────────────
// Mutable map populated by fetchDynamicTokens(). Allows resolveToken()
// and the execution engine to work with 300+ SaucerSwap tokens beyond
// the hardcoded SAUCERSWAP_TOKENS list. Static entries always win.
const _dynamicTokenBySymbol = new Map<string, AllowedToken>();
const _dynamicTokenByHtsId = new Map<string, AllowedToken>();

/**
 * Register dynamically fetched tokens so resolveToken(), TOKEN_BY_HTS_ID
 * lookups, and the swap engine can find them. Static tokens take priority.
 * [SECURITY] Filters out scam tokens from the blocklist.
 */
export function registerDynamicTokens(tokens: AllowedToken[]): void {
  // [SECURITY] Import blocklist lazily to avoid circular deps
  import("./scam-blocklist").then(({ isTokenBlocked }) => {
    let blockedCount = 0;
    for (const t of tokens) {
      // [SECURITY] Never register blocked scam tokens
      if (isTokenBlocked(t.htsId)) {
        blockedCount++;
        continue;
      }
      
      // Never overwrite static tokens
      if (!TOKEN_BY_SYMBOL.has(t.symbol)) {
        _dynamicTokenBySymbol.set(t.symbol, t);
      }
      if (!TOKEN_BY_HTS_ID.has(t.htsId)) {
        _dynamicTokenByHtsId.set(t.htsId, t);
      }
    }
    console.log(`[C56] Registered ${tokens.length - blockedCount} dynamic tokens (blocked ${blockedCount} scam tokens, total dynamic: ${_dynamicTokenBySymbol.size})`);
  }).catch(() => {
    // Fallback if blocklist fails to load — proceed without filtering
    for (const t of tokens) {
      if (!TOKEN_BY_SYMBOL.has(t.symbol)) {
        _dynamicTokenBySymbol.set(t.symbol, t);
      }
      if (!TOKEN_BY_HTS_ID.has(t.htsId)) {
        _dynamicTokenByHtsId.set(t.htsId, t);
      }
    }
    console.log(`[C56] Registered ${tokens.length} dynamic tokens (blocklist unavailable, total dynamic: ${_dynamicTokenBySymbol.size})`);
  });
}

/**
 * Look up any token (static or dynamic) by HTS ID.
 */
export function resolveTokenByHtsId(htsId: string): AllowedToken | undefined {
  return TOKEN_BY_HTS_ID.get(htsId) || _dynamicTokenByHtsId.get(htsId);
}

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

  // [C56] Check dynamic tokens (fetched from SaucerSwap API)
  const dynamic = _dynamicTokenBySymbol.get(symbol);
  if (dynamic) return dynamic;

  // HBAR (native) is its own token now -- not aliased to WHBAR
  const aliases: Record<string, string> = {
    ETH: "WETH", BTC: "WBTC", MATIC: "WMATIC", POL: "WPOL", POLY: "WPOL",
    BNB: "WBNB", AVAX: "WAVAX",
    // Legacy "h" suffixed symbols (removed from registry, kept for backward compat)
    WBTCH: "WBTC", WETHH: "WETH", LINKH: "LINK",
  };
  const upper = symbol.toUpperCase();
  const resolved = aliases[upper] || upper;
  return TOKEN_BY_SYMBOL.get(resolved)
    || _dynamicTokenBySymbol.get(resolved)
    || resolveTokenByHtsId(resolved);
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

// ── [C66 / C79-01] Dynamic Icon Resolution from SaucerSwap API ──────
// Fetches official token icons from our server proxy (which proxies
// SaucerSwap /tokens endpoint with 5-min cache, no CORS issues).
// 
// Two-pronged approach:
//   1. Patches SAUCERSWAP_TOKENS[].logo in-place (for existing references)
//   2. Populates the global icon registry (for TokenIcon fallback chain)
//
// The icon registry allows TokenIcon to resolve icons even when the
// React state hasn't re-rendered (e.g., stale token references).
let _iconFetchDone = false;
export async function fetchAndApplyTokenIcons(): Promise<void> {
  if (_iconFetchDone) return;
  _iconFetchDone = true; // Only try once per session

  // Import lazily to avoid circular deps
  const { registerTokenIcons } = await import("../../components/TokenIcon");

  try {
    // [C79-01] Use our server proxy instead of direct SaucerSwap API.
    // Direct browser → api.saucerswap.finance often fails in iframes
    // due to CORS, CSP, or ad-blocker restrictions. Our Supabase edge
    // function proxies the same data with guaranteed CORS headers.
    const { ssProxy } = await import("./pools");
    const data = await ssProxy<{ tokens: Array<{ id: string; symbol: string; icon: string }> }>("/tokens", {});
    
    if (!data?.tokens || !Array.isArray(data.tokens)) {
      log.warn("TokenIcons", "Server proxy returned no token data — trying direct API fallback");
      await _fetchIconsDirect();
      return;
    }

    const iconByHtsId = new Map<string, string>();
    const registryEntries: Array<{ htsId: string; iconUrl: string }> = [];

    for (const t of data.tokens) {
      const id = t.id || "";
      const icon = t.icon || "";
      if (id && icon) {
        const fullUrl = icon.startsWith("http") ? icon : `https://www.saucerswap.finance${icon}`;
        iconByHtsId.set(id, fullUrl);
        registryEntries.push({ htsId: id, iconUrl: fullUrl });
      }
    }

    // 1. Patch static token logos in-place
    let updated = 0;
    for (const token of SAUCERSWAP_TOKENS) {
      if (token.htsId === "native") continue;
      const apiIcon = iconByHtsId.get(token.htsId);
      if (apiIcon) {
        token.logo = apiIcon;
        updated++;
      }
    }

    // 2. Populate icon registry for TokenIcon fallback chain
    const registered = registerTokenIcons(registryEntries);

    // 3. Also register HBAR native with a known-good icon (CoinGecko — no hotlink blocking)
    const hbarIcon = "https://assets.coingecko.com/coins/images/3688/standard/hbar.png";
    registerTokenIcons([{ htsId: "native", iconUrl: hbarIcon }]);

    log.info("TokenIcons", `Patched ${updated} static logos, registered ${registered} in icon registry (${registryEntries.length} total from API)`);
  } catch (e: any) {
    log.warn("TokenIcons", `Server proxy icon fetch failed: ${e?.message || e} — trying direct API`);
    await _fetchIconsDirect();
  }
}

/** Direct API fallback — only used if our server proxy is down. */
async function _fetchIconsDirect(): Promise<void> {
  try {
    const { registerTokenIcons } = await import("../../components/TokenIcon");
    const res = await fetch("https://api.saucerswap.finance/tokens", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const data = await res.json();
    const tokens: any[] = Array.isArray(data) ? data : Object.values(data);
    const registryEntries: Array<{ htsId: string; iconUrl: string }> = [];

    for (const t of tokens) {
      const id = t.id || t.tokenId || "";
      const icon = t.icon || t.image || "";
      if (id && icon) {
        const fullUrl = icon.startsWith("http") ? icon : `https://www.saucerswap.finance${icon}`;
        registryEntries.push({ htsId: id, iconUrl: fullUrl });
        // Also patch in-place
        const token = SAUCERSWAP_TOKENS.find(tok => tok.htsId === id);
        if (token) token.logo = fullUrl;
      }
    }
    registerTokenIcons(registryEntries);
    log.info("TokenIcons", `Direct API fallback: registered ${registryEntries.length} icons`);
  } catch (e: any) {
    log.warn("TokenIcons", `Direct API also failed: ${e?.message || e}`);
  }
}

// ── [C56] Dynamic Token Discovery ───────────────────────────────────
// Fetches the full SaucerSwap token list (300+ tokens) from our server
// proxy (5-min cache). Merges with SAUCERSWAP_TOKENS — static entries
// always take priority. Returns AllowedToken[] compatible with the
// token selector.

/** Shape returned by server proxy /saucerswap/tokens */
export interface DynamicTokenInfo {
  id: string;        // HTS ID e.g. "0.0.731861"
  symbol: string;
  name: string;
  decimals: number;
  icon: string;      // Full URL
  priceUsd: number | null;
  dueDiligenceComplete: boolean;
  isFeeOnTransfer: boolean;
}

let _dynamicTokenCache: { tokens: AllowedToken[]; raw: DynamicTokenInfo[]; ts: number } | null = null;
const DYNAMIC_TOKEN_CACHE_TTL_MS = 300_000; // 5 minutes (matches server cache)

/**
 * [C56] Fetch full SaucerSwap token list, merge with static registry.
 *
 * Returns an array of AllowedToken compatible with all existing swap logic.
 * Static SAUCERSWAP_TOKENS entries always take priority (correct decimals,
 * bridge info, routing aliases). Dynamic tokens fill the "All" tab.
 *
 * Also returns raw DynamicTokenInfo[] for price display.
 */
export async function fetchDynamicTokens(): Promise<{
  allTokens: AllowedToken[];
  dynamicRaw: DynamicTokenInfo[];
}> {
  // Return cache if fresh
  if (_dynamicTokenCache && (Date.now() - _dynamicTokenCache.ts) < DYNAMIC_TOKEN_CACHE_TTL_MS) {
    return { allTokens: _dynamicTokenCache.tokens, dynamicRaw: _dynamicTokenCache.raw };
  }

  // Import ssProxy lazily to avoid circular deps
  const { ssProxy } = await import("./pools");

  try {
    const data = await ssProxy<{ tokens: DynamicTokenInfo[]; count: number }>("/tokens", {});
    if (!data || !Array.isArray(data.tokens) || data.tokens.length === 0) {
      log.warn("DynamicTokens", "Server returned empty token list — using static only");
      return { allTokens: [...SAUCERSWAP_TOKENS], dynamicRaw: [] };
    }

    const dynamicRaw = data.tokens;
    const staticHtsIds = new Set(SAUCERSWAP_TOKENS.map(t => t.htsId));
    const staticSymbols = new Set(SAUCERSWAP_TOKENS.map(t => t.symbol.toUpperCase()));

    // ── [C85] TOKEN ID RECONCILIATION ────────────────────────────────
    // Detect when the SaucerSwap API returns a token with the same symbol
    // as our static registry but a DIFFERENT HTS ID. This catches cases
    // where tokens migrate to new IDs (like PACK 0.0.4589822 → 0.0.4794920)
    // and prevents the UI from showing two different IDs in different places.
    //
    // When a mismatch is detected:
    //   1. Log a loud [RECONCILE] warning with both IDs
    //   2. Register the API's ID in dynamic lookup maps so wallet matching works
    //   3. Also register the API's ID in TOKEN_BY_HTS_ID for reverse lookups
    // ─────────────────────────────────────────────────────────────────
    const staticBySymbol = new Map(SAUCERSWAP_TOKENS.map(t => [t.symbol.toUpperCase(), t]));
    for (const dt of dynamicRaw) {
      const upperSym = dt.symbol.toUpperCase();
      const staticEntry = staticBySymbol.get(upperSym);
      if (staticEntry && staticEntry.htsId !== "native" && staticEntry.htsId !== dt.id) {
        // Check if this is already a known alias
        if (staticEntry.saucerswapAliasId === dt.id) continue;

        console.warn(
          `[RECONCILE] Token ID mismatch for ${dt.symbol}: ` +
          `static registry has ${staticEntry.htsId}, ` +
          `SaucerSwap API returns ${dt.id}. ` +
          `The static registry should be updated to match the API. ` +
          `Registering API ID ${dt.id} as additional lookup key.`
        );

        // Register the API's ID so wallet token matching works
        // (wallet has the real on-chain ID from Mirror Node)
        if (!TOKEN_BY_HTS_ID.has(dt.id)) {
          TOKEN_BY_HTS_ID.set(dt.id, staticEntry);
        }
        if (!_dynamicTokenByHtsId.has(dt.id)) {
          _dynamicTokenByHtsId.set(dt.id, staticEntry);
        }
      }
    }

    // Convert dynamic tokens to AllowedToken, excluding those already in static list
    const dynamicConverted: AllowedToken[] = dynamicRaw
      .filter(dt => !staticHtsIds.has(dt.id) && !staticSymbols.has(dt.symbol.toUpperCase()))
      .map((dt, idx) => ({
        symbol: dt.symbol,
        name: dt.name,
        htsId: dt.id,
        evmAddress: htsIdToEvmAddress(dt.id),
        decimals: dt.decimals,
        logo: dt.icon || `https://www.saucerswap.finance/images/tokens/${dt.id}.svg`,
        rank: 1000 + idx, // After all static tokens
        isWrapped: false,
        isNative: false,
      }));

    // Merge: static first, then dynamic (sorted by rank)
    const merged = [...SAUCERSWAP_TOKENS, ...dynamicConverted];

    // [C56] Register in dynamic lookup maps so resolveToken() and swap engine find them
    registerDynamicTokens(dynamicConverted);

    // [C79-01] Register ALL dynamic token icons in the icon registry.
    // This ensures TokenIcon's fallback chain can resolve icons for
    // any of the 300+ SaucerSwap tokens, not just the static list.
    try {
      const { registerTokenIcons } = await import("../../components/TokenIcon");
      const iconEntries = dynamicRaw
        .filter(dt => dt.id && dt.icon)
        .map(dt => ({
          htsId: dt.id,
          iconUrl: dt.icon.startsWith("http") ? dt.icon : `https://www.saucerswap.finance${dt.icon}`,
        }));
      registerTokenIcons(iconEntries);
    } catch { /* non-critical */ }

    _dynamicTokenCache = { tokens: merged, raw: dynamicRaw, ts: Date.now() };
    log.info("DynamicTokens", `Merged ${SAUCERSWAP_TOKENS.length} static + ${dynamicConverted.length} dynamic = ${merged.length} total`);
    return { allTokens: merged, dynamicRaw };
  } catch (err: any) {
    log.warn("DynamicTokens", `Fetch failed: ${err?.message || err}`);
    return { allTokens: [...SAUCERSWAP_TOKENS], dynamicRaw: [] };
  }
}
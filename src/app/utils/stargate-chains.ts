/**
 * Stargate V2 — Dynamic Chain & Token Registry
 *
 * Replaces the hardcoded ALL_CHAINS (16 chains) and ALL_TOKENS (5 tokens) arrays
 * from the legacy StargateBridgeWidget.tsx with a dynamic registry populated from
 * the VT API's /v1/tokens response.
 *
 * IMPLEMENTATION NOTE: Chain metadata (chainId, name, icon, color) is defined once
 * here. The actual list of available chains/tokens is built dynamically from the
 * VT API response — if the API stops supporting a chain, it disappears from the UI
 * automatically. No more hardcoded pool addresses or endpoint IDs.
 */

import type { VTToken } from "./stargate-vt";

/* ══════════════════════════════════════════════════════════════
 * Constants
 * ══════════════════════════════════════════════════════════════ */

/**
 * The VT API uses this address to represent a chain's native token
 * (ETH on Ethereum, BNB on BSC, MATIC on Polygon, etc.)
 */
export const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/* ══════════════════════════════════════════════════════════════
 * Types
 * ══════════════════════════════════════════════════════════════ */

/** Static metadata for an EVM chain */
export interface ChainMeta {
  /** VT API chain key (e.g., "ethereum", "arbitrum") */
  chainKey: string;
  /** EVM chain ID (e.g., 1, 42161) */
  chainId: number;
  /** Human-readable chain name */
  name: string;
  /** Emoji icon for compact display */
  icon: string;
  /** Brand color hex for UI accents */
  color: string;
  /** Native token symbol (e.g., "ETH", "BNB", "MATIC") */
  nativeSymbol: string;
  /** Block explorer base URL for transactions (e.g., "https://etherscan.io/tx/") */
  explorerTxUrl: string;
  /** Block explorer base URL for addresses (e.g., "https://etherscan.io/address/") */
  explorerAddressUrl: string;
}

/** Chain info enriched with available token count — used by the widget */
export interface ChainInfo extends ChainMeta {
  /** Number of supported tokens on this chain */
  tokenCount: number;
}

/** Token info for the widget dropdowns */
export interface TokenInfo {
  /** VT API chain key */
  chainKey: string;
  /** Token contract address (or NATIVE_TOKEN_ADDRESS for native) */
  address: string;
  /** Token symbol (e.g., "USDC", "ETH") */
  symbol: string;
  /** Human-readable token name */
  name: string;
  /** Token decimals */
  decimals: number;
  /** Logo URL from the VT API (optional) */
  logoUrl?: string;
  /** Current USD price (optional) */
  priceUsd?: number;
  /** Whether this is the chain's native token */
  isNative: boolean;
}

/* ══════════════════════════════════════════════════════════════
 * Chain Key → Metadata Map
 *
 * IMPLEMENTATION NOTE: This is the only "hardcoded" data in the new
 * Stargate integration. Unlike the old approach (hardcoded pool addresses,
 * LZ endpoint IDs, token lists), this is purely cosmetic metadata that
 * only affects display — the actual routing, fees, and transactions are
 * entirely driven by the VT API.
 * ══════════════════════════════════════════════════════════════ */

const CHAIN_KEY_MAP: Record<string, ChainMeta> = {
  ethereum: {
    chainKey: "ethereum",
    chainId: 1,
    name: "Ethereum",
    icon: "⟠",
    color: "#627EEA",
    nativeSymbol: "ETH",
    explorerTxUrl: "https://etherscan.io/tx/",
    explorerAddressUrl: "https://etherscan.io/address/",
  },
  arbitrum: {
    chainKey: "arbitrum",
    chainId: 42161,
    name: "Arbitrum",
    icon: "🔵",
    color: "#28A0F0",
    nativeSymbol: "ETH",
    explorerTxUrl: "https://arbiscan.io/tx/",
    explorerAddressUrl: "https://arbiscan.io/address/",
  },
  optimism: {
    chainKey: "optimism",
    chainId: 10,
    name: "Optimism",
    icon: "🔴",
    color: "#FF0420",
    nativeSymbol: "ETH",
    explorerTxUrl: "https://optimistic.etherscan.io/tx/",
    explorerAddressUrl: "https://optimistic.etherscan.io/address/",
  },
  polygon: {
    chainKey: "polygon",
    chainId: 137,
    name: "Polygon",
    icon: "🟣",
    color: "#8247E5",
    nativeSymbol: "POL",
    explorerTxUrl: "https://polygonscan.com/tx/",
    explorerAddressUrl: "https://polygonscan.com/address/",
  },
  bsc: {
    chainKey: "bsc",
    chainId: 56,
    name: "BNB Chain",
    icon: "🟡",
    color: "#F0B90B",
    nativeSymbol: "BNB",
    explorerTxUrl: "https://bscscan.com/tx/",
    explorerAddressUrl: "https://bscscan.com/address/",
  },
  avalanche: {
    chainKey: "avalanche",
    chainId: 43114,
    name: "Avalanche",
    icon: "🔺",
    color: "#E84142",
    nativeSymbol: "AVAX",
    explorerTxUrl: "https://snowtrace.io/tx/",
    explorerAddressUrl: "https://snowtrace.io/address/",
  },
  base: {
    chainKey: "base",
    chainId: 8453,
    name: "Base",
    icon: "🔷",
    color: "#0052FF",
    nativeSymbol: "ETH",
    explorerTxUrl: "https://basescan.org/tx/",
    explorerAddressUrl: "https://basescan.org/address/",
  },
  linea: {
    chainKey: "linea",
    chainId: 59144,
    name: "Linea",
    icon: "⬡",
    color: "#121212",
    nativeSymbol: "ETH",
    explorerTxUrl: "https://lineascan.build/tx/",
    explorerAddressUrl: "https://lineascan.build/address/",
  },
  mantle: {
    chainKey: "mantle",
    chainId: 5000,
    name: "Mantle",
    icon: "🟢",
    color: "#000000",
    nativeSymbol: "MNT",
    explorerTxUrl: "https://explorer.mantle.xyz/tx/",
    explorerAddressUrl: "https://explorer.mantle.xyz/address/",
  },
  scroll: {
    chainKey: "scroll",
    chainId: 534352,
    name: "Scroll",
    icon: "📜",
    color: "#FFEEDA",
    nativeSymbol: "ETH",
    explorerTxUrl: "https://scrollscan.com/tx/",
    explorerAddressUrl: "https://scrollscan.com/address/",
  },
  fantom: {
    chainKey: "fantom",
    chainId: 250,
    name: "Fantom",
    icon: "👻",
    color: "#1969FF",
    nativeSymbol: "FTM",
    explorerTxUrl: "https://ftmscan.com/tx/",
    explorerAddressUrl: "https://ftmscan.com/address/",
  },
  metis: {
    chainKey: "metis",
    chainId: 1088,
    name: "Metis",
    icon: "🌀",
    color: "#00DACC",
    nativeSymbol: "METIS",
    explorerTxUrl: "https://andromeda-explorer.metis.io/tx/",
    explorerAddressUrl: "https://andromeda-explorer.metis.io/address/",
  },
  zksync: {
    chainKey: "zksync",
    chainId: 324,
    name: "zkSync Era",
    icon: "💠",
    color: "#8C8DFC",
    nativeSymbol: "ETH",
    explorerTxUrl: "https://explorer.zksync.io/tx/",
    explorerAddressUrl: "https://explorer.zksync.io/address/",
  },
  kava: {
    chainKey: "kava",
    chainId: 2222,
    name: "Kava",
    icon: "🌋",
    color: "#FF564F",
    nativeSymbol: "KAVA",
    explorerTxUrl: "https://kavascan.com/tx/",
    explorerAddressUrl: "https://kavascan.com/address/",
  },
  opbnb: {
    chainKey: "opbnb",
    chainId: 204,
    name: "opBNB",
    icon: "⚡",
    color: "#F0B90B",
    nativeSymbol: "BNB",
    explorerTxUrl: "https://opbnbscan.com/tx/",
    explorerAddressUrl: "https://opbnbscan.com/address/",
  },
  coredao: {
    chainKey: "coredao",
    chainId: 1116,
    name: "Core",
    icon: "🟠",
    color: "#FF9211",
    nativeSymbol: "CORE",
    explorerTxUrl: "https://scan.coredao.org/tx/",
    explorerAddressUrl: "https://scan.coredao.org/address/",
  },
  sei: {
    chainKey: "sei",
    chainId: 1329,
    name: "Sei",
    icon: "🌊",
    color: "#9B1C2E",
    nativeSymbol: "SEI",
    explorerTxUrl: "https://seitrace.com/tx/",
    explorerAddressUrl: "https://seitrace.com/address/",
  },
  xlayer: {
    chainKey: "xlayer",
    chainId: 196,
    name: "X Layer",
    icon: "✖️",
    color: "#000000",
    nativeSymbol: "OKB",
    explorerTxUrl: "https://www.oklink.com/xlayer/tx/",
    explorerAddressUrl: "https://www.oklink.com/xlayer/address/",
  },
  // IMPLEMENTATION NOTE: Additional chains can be added here as the VT API
  // expands. Unknown chains still work (see FALLBACK_CHAIN_META below) —
  // they just won't have a branded icon/color.
};

/**
 * Fallback metadata for chains returned by the VT API that aren't in our map.
 * This ensures the widget never crashes on an unknown chain — it just shows
 * a generic icon until we add proper metadata.
 */
function buildFallbackMeta(chainKey: string): ChainMeta {
  return {
    chainKey,
    chainId: 0, // Unknown — MetaMask won't be able to switch, but display is safe
    name: chainKey.charAt(0).toUpperCase() + chainKey.slice(1),
    icon: "🔗",
    color: "#888888",
    nativeSymbol: "???",
    explorerTxUrl: "",
    explorerAddressUrl: "",
  };
}

/* ══════════════════════════════════════════════════════════════
 * Lookups
 * ══════════════════════════════════════════════════════════════ */

/** Reverse map: chainId → chainKey for quick lookups */
const CHAIN_ID_TO_KEY = new Map<number, string>();
for (const [key, meta] of Object.entries(CHAIN_KEY_MAP)) {
  CHAIN_ID_TO_KEY.set(meta.chainId, key);
}

/**
 * Get chain metadata by VT API chain key.
 * Returns fallback metadata for unknown chains.
 */
export function getChainByKey(chainKey: string): ChainMeta {
  return CHAIN_KEY_MAP[chainKey] ?? buildFallbackMeta(chainKey);
}

/**
 * Get chain metadata by EVM chain ID.
 * Returns undefined if no chain matches the given ID.
 */
export function getChainByChainId(chainId: number): ChainMeta | undefined {
  const key = CHAIN_ID_TO_KEY.get(chainId);
  return key ? CHAIN_KEY_MAP[key] : undefined;
}

/**
 * Get all known chain keys (useful for iteration/debugging).
 */
export function getAllKnownChainKeys(): string[] {
  return Object.keys(CHAIN_KEY_MAP);
}

/* ══════════════════════════════════════════════════════════════
 * Dynamic chain/token list builders
 *
 * These functions take the VT API token list (from fetchSupportedTokens)
 * and produce the chain/token arrays the widget needs for its dropdowns.
 * Unlike the old hardcoded approach, chains/tokens that the API no longer
 * supports simply disappear from the UI.
 * ══════════════════════════════════════════════════════════════ */

/**
 * Build the list of available chains from VT API tokens.
 *
 * Only chains that have at least one supported token are included.
 * Sorted alphabetically by name for consistent dropdown ordering.
 *
 * @param tokens  Array of VTToken from fetchSupportedTokens()
 * @returns       Sorted array of ChainInfo with token counts
 */
export function buildAvailableChains(tokens: VTToken[]): ChainInfo[] {
  // Count tokens per chain
  const chainTokenCounts = new Map<string, number>();
  for (const token of tokens) {
    const count = chainTokenCounts.get(token.chainKey) ?? 0;
    chainTokenCounts.set(token.chainKey, count + 1);
  }

  // Build ChainInfo for each chain that has tokens
  const chains: ChainInfo[] = [];
  for (const [chainKey, tokenCount] of chainTokenCounts) {
    const meta = getChainByKey(chainKey);
    chains.push({ ...meta, tokenCount });
  }

  // Sort alphabetically by name
  chains.sort((a, b) => a.name.localeCompare(b.name));

  return chains;
}

/**
 * Build the list of available tokens on a specific chain.
 *
 * Native tokens are sorted first, then alphabetically by symbol.
 * Each token gets an `isNative` flag for display purposes
 * (e.g., show "ETH" instead of "Wrapped Ether").
 *
 * @param tokens    Array of VTToken from fetchSupportedTokens()
 * @param chainKey  Chain to filter by (e.g., "ethereum")
 * @returns         Sorted array of TokenInfo for the dropdown
 */
export function buildAvailableTokens(
  tokens: VTToken[],
  chainKey: string
): TokenInfo[] {
  const filtered = tokens.filter((t) => t.chainKey === chainKey);

  const tokenInfos: TokenInfo[] = filtered.map((t) => ({
    chainKey: t.chainKey,
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logoUrl: t.logoUrl,
    priceUsd: t.price?.usd,
    isNative: isNativeToken(t.address),
  }));

  // Sort: native tokens first, then alphabetically by symbol
  tokenInfos.sort((a, b) => {
    if (a.isNative && !b.isNative) return -1;
    if (!a.isNative && b.isNative) return 1;
    return a.symbol.localeCompare(b.symbol);
  });

  return tokenInfos;
}

/* ══════════════════════════════════════════════════════════════
 * Utility helpers
 * ══════════════════════════════════════════════════════════════ */

/**
 * Check if an address represents a native token.
 * The VT API uses the EIP-7528 convention:
 * 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
 */
export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

/**
 * Get a block explorer URL for a transaction on a given chain.
 * Uses the explorerTxUrl from the chain registry.
 * Returns undefined for unknown chains with no explorer configured.
 */
export function getExplorerTxUrl(chainKey: string, txHash: string): string | undefined {
  const meta = getChainByKey(chainKey);
  if (!meta.explorerTxUrl) return undefined;
  return `${meta.explorerTxUrl}${txHash}`;
}

/**
 * Get a block explorer URL for a transaction using chainId instead of chainKey.
 * Convenience overload for cases where only chainId is available (e.g., from MetaMask).
 * Returns undefined for unknown chains.
 */
export function getExplorerTxUrlByChainId(chainId: number, txHash: string): string | undefined {
  const meta = getChainByChainId(chainId);
  if (!meta?.explorerTxUrl) return undefined;
  return `${meta.explorerTxUrl}${txHash}`;
}

/**
 * Get a block explorer URL for an address on a given chain.
 * Uses the explorerAddressUrl from the chain registry.
 */
export function getExplorerAddressUrl(chainKey: string, address: string): string | undefined {
  const meta = getChainByKey(chainKey);
  if (!meta.explorerAddressUrl) return undefined;
  return `${meta.explorerAddressUrl}${address}`;
}

/* ══════════════════════════════════════════════════════════════
 * Cross-chain tracking URLs
 *
 * IMPLEMENTATION NOTE: Bridge transactions can be tracked on multiple
 * services. The source chain explorer shows the initial tx, while
 * LayerZero Scan and Stargate Scan track the cross-chain message
 * delivery to the destination chain.
 * ══════════════════════════════════════════════════════════════ */

/** LayerZero Scan — tracks cross-chain message status */
const LZ_SCAN_BASE = "https://layerzeroscan.com/tx/";

/** Stargate Scan — alternative tracker for Stargate bridge txs */
const STARGATE_SCAN_BASE = "https://stargatescan.io/tx/";

/**
 * Get the LayerZero Scan URL for a bridge transaction.
 * Shows cross-chain message status (sent → inflight → delivered).
 */
export function getLzScanUrl(txHash: string): string {
  return `${LZ_SCAN_BASE}${txHash}`;
}

/**
 * Get the Stargate Scan URL for a bridge transaction.
 * Backup tracker — useful when LayerZero Scan is slow or down.
 */
export function getStargateScanUrl(txHash: string): string {
  return `${STARGATE_SCAN_BASE}${txHash}`;
}

/** All available tracking URLs for a bridge transaction */
export interface TxTrackingUrls {
  /** Source chain block explorer (e.g., Etherscan, Arbiscan) */
  explorer?: string;
  /** LayerZero Scan — cross-chain message tracker */
  lzScan: string;
  /** Stargate Scan — backup cross-chain tracker */
  stargateScan: string;
  /** Human-readable source chain name (for UI labels) */
  chainName?: string;
}

/**
 * Get all available tracking URLs for a bridge transaction.
 *
 * Returns explorer link (if chain is known), LayerZero Scan, and Stargate Scan.
 * The widget renders these as clickable links in the receipt/status panel.
 *
 * Accepts either chainKey or chainId — use whichever is available.
 *
 * @param txHash    Transaction hash (0x...)
 * @param chainRef  Chain key (e.g., "ethereum") or chain ID (e.g., 1)
 * @returns         Object with all tracking URLs
 */
export function getTxTrackingUrls(
  txHash: string,
  chainRef: string | number
): TxTrackingUrls {
  // Resolve chain metadata from either key or ID
  let meta: ChainMeta | undefined;
  if (typeof chainRef === "string") {
    meta = CHAIN_KEY_MAP[chainRef];
  } else {
    meta = getChainByChainId(chainRef);
  }

  return {
    explorer: meta?.explorerTxUrl ? `${meta.explorerTxUrl}${txHash}` : undefined,
    lzScan: getLzScanUrl(txHash),
    stargateScan: getStargateScanUrl(txHash),
    chainName: meta?.name,
  };
}
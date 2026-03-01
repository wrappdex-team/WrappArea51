/**
 * 1inch DEX Aggregator — Chain Registry
 *
 * Defines the complete set of EVM chains supported by the 1inch
 * Developer Portal APIs. Each chain entry carries:
 *   - EVM chain ID + hex ID (for wallet_switchEthereumChain)
 *   - Human-readable name + emoji icon
 *   - Native gas token metadata
 *   - Public RPC endpoint (fallback — wallet usually has its own)
 *   - Block explorer URL (for transaction links)
 *   - Brand gradient (for UI accent backgrounds)
 *   - Feature flags (Fusion support, Fusion+ support)
 *
 * IMPLEMENTATION NOTE: Only chains that the 1inch Swap API v6.0
 * actively supports are included. The Fusion and Fusion+ APIs
 * support a subset — the `supportsFusion` and `supportsFusionPlus`
 * flags indicate availability. The UI should grey out or hide modes
 * that are not supported on the currently selected chain.
 *
 * Source of truth for chain IDs:
 *   https://portal.1inch.dev/documentation/apis/swap/chains
 *
 * @module oneinch/chains
 */

/* ══════════════════════════════════════════════════════════════════════
 * Types
 * ══════════════════════════════════════════════════════════════════════ */

/** Native gas token metadata for wallet_addEthereumChain */
export interface NativeCurrency {
  /** Human-readable name (e.g., "Ether") */
  readonly name: string;
  /** Ticker symbol (e.g., "ETH") */
  readonly symbol: string;
  /** Always 18 for EVM native tokens */
  readonly decimals: 18;
}

/** Complete chain configuration */
export interface ChainConfig {
  /** EVM chain ID (e.g., 1, 137, 42161) */
  readonly id: number;
  /** Hex-encoded chain ID for MetaMask (e.g., "0x1", "0x89") */
  readonly hexId: string;
  /** Human-readable chain name (e.g., "Ethereum") */
  readonly name: string;
  /** Short display name for compact UI (e.g., "ETH", "ARB") */
  readonly shortName: string;
  /** Emoji icon for inline display */
  readonly icon: string;
  /** Native gas token */
  readonly nativeCurrency: NativeCurrency;
  /** Fallback public RPC URL */
  readonly rpcUrl: string;
  /** Block explorer base URL (no trailing slash) */
  readonly explorerUrl: string;
  /** Tailwind gradient classes for UI accent backgrounds */
  readonly gradient: string;
  /** Brand color hex for chart/badge accents */
  readonly color: string;
  /** Whether 1inch Fusion v2.0 (gasless swaps) is supported */
  readonly supportsFusion: boolean;
  /** Whether 1inch Fusion+ (cross-chain) is supported */
  readonly supportsFusionPlus: boolean;
}

/* ══════════════════════════════════════════════════════════════════════
 * Chain Registry
 *
 * IMPLEMENTATION NOTE: Ordered by market cap / usage frequency.
 * Ethereum is first because it is the default selection.
 * ══════════════════════════════════════════════════════════════════════ */

export const CHAINS: readonly ChainConfig[] = Object.freeze([
  {
    id: 1,
    hexId: "0x1",
    name: "Ethereum",
    shortName: "ETH",
    icon: "\u27E0",      // ⟠
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    gradient: "from-blue-500/20 to-indigo-500/20",
    color: "#627EEA",
    supportsFusion: true,
    supportsFusionPlus: true,
  },
  {
    id: 56,
    hexId: "0x38",
    name: "BNB Chain",
    shortName: "BSC",
    icon: "\u25C6",      // ◆
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrl: "https://bsc-dataseed1.binance.org",
    explorerUrl: "https://bscscan.com",
    gradient: "from-yellow-500/20 to-amber-500/20",
    color: "#F3BA2F",
    supportsFusion: true,
    supportsFusionPlus: true,
  },
  {
    id: 137,
    hexId: "0x89",
    name: "Polygon",
    shortName: "POL",
    icon: "\u2B21",      // ⬡
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrl: "https://polygon-rpc.com",
    explorerUrl: "https://polygonscan.com",
    gradient: "from-purple-500/20 to-violet-500/20",
    color: "#8247E5",
    supportsFusion: true,
    supportsFusionPlus: true,
  },
  {
    id: 42161,
    hexId: "0xa4b1",
    name: "Arbitrum",
    shortName: "ARB",
    icon: "\u25C8",      // ◈
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    gradient: "from-blue-400/20 to-cyan-400/20",
    color: "#28A0F0",
    supportsFusion: true,
    supportsFusionPlus: true,
  },
  {
    id: 10,
    hexId: "0xa",
    name: "Optimism",
    shortName: "OP",
    icon: "\u2295",      // ⊕
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://mainnet.optimism.io",
    explorerUrl: "https://optimistic.etherscan.io",
    gradient: "from-red-500/20 to-rose-500/20",
    color: "#FF0420",
    supportsFusion: true,
    supportsFusionPlus: true,
  },
  {
    id: 8453,
    hexId: "0x2105",
    name: "Base",
    shortName: "BASE",
    icon: "\u25C9",      // ◉
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    gradient: "from-blue-500/20 to-sky-400/20",
    color: "#0052FF",
    supportsFusion: true,
    supportsFusionPlus: true,
  },
  {
    id: 43114,
    hexId: "0xa86a",
    name: "Avalanche",
    shortName: "AVAX",
    icon: "\u25B2",      // ▲
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    explorerUrl: "https://snowtrace.io",
    gradient: "from-red-600/20 to-red-400/20",
    color: "#E84142",
    supportsFusion: true,
    supportsFusionPlus: true,
  },
  {
    id: 100,
    hexId: "0x64",
    name: "Gnosis",
    shortName: "GNO",
    icon: "\u26C1",      // ⛁
    nativeCurrency: { name: "xDAI", symbol: "xDAI", decimals: 18 },
    rpcUrl: "https://rpc.gnosischain.com",
    explorerUrl: "https://gnosisscan.io",
    gradient: "from-emerald-500/20 to-teal-500/20",
    color: "#04795B",
    supportsFusion: true,
    supportsFusionPlus: false,
  },
  {
    id: 324,
    hexId: "0x144",
    name: "zkSync Era",
    shortName: "ZK",
    icon: "\u25CA",      // ◊
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://mainnet.era.zksync.io",
    explorerUrl: "https://explorer.zksync.io",
    gradient: "from-indigo-500/20 to-purple-400/20",
    color: "#4E529A",
    supportsFusion: false,
    supportsFusionPlus: false,
  },
  {
    id: 250,
    hexId: "0xfa",
    name: "Fantom",
    shortName: "FTM",
    icon: "\u25CF",      // ●
    nativeCurrency: { name: "Fantom", symbol: "FTM", decimals: 18 },
    rpcUrl: "https://rpc.ftm.tools",
    explorerUrl: "https://ftmscan.com",
    gradient: "from-blue-600/20 to-blue-400/20",
    color: "#1969FF",
    supportsFusion: false,
    supportsFusionPlus: false,
  },
  {
    id: 1313161554,
    hexId: "0x4e454152",
    name: "Aurora",
    shortName: "AURORA",
    icon: "\u2604",      // ☄
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://mainnet.aurora.dev",
    explorerUrl: "https://explorer.aurora.dev",
    gradient: "from-green-500/20 to-emerald-400/20",
    color: "#70D44B",
    supportsFusion: false,
    supportsFusionPlus: false,
  },
  {
    id: 8217,
    hexId: "0x2019",
    name: "Klaytn",
    shortName: "KLAY",
    icon: "\u25A0",      // ■
    nativeCurrency: { name: "KLAY", symbol: "KLAY", decimals: 18 },
    rpcUrl: "https://public-en-cypress.klaytn.net",
    explorerUrl: "https://scope.klaytn.com",
    gradient: "from-orange-500/20 to-red-400/20",
    color: "#FF3B00",
    supportsFusion: false,
    supportsFusionPlus: false,
  },
]);

/* ══════════════════════════════════════════════════════════════════════
 * Lookup Utilities
 *
 * IMPLEMENTATION NOTE: These are O(1) lookups via pre-built Maps.
 * The CHAINS array is small (~12 entries) so the memory overhead
 * of the Maps is negligible.
 * ══════════════════════════════════════════════════════════════════════ */

/** Chain ID → ChainConfig lookup */
const chainById = new Map<number, ChainConfig>(
  CHAINS.map((c) => [c.id, c]),
);

/** Hex chain ID → ChainConfig lookup (lowercase keys) */
const chainByHex = new Map<string, ChainConfig>(
  CHAINS.map((c) => [c.hexId.toLowerCase(), c]),
);

/**
 * Look up a chain by its numeric EVM chain ID.
 * Returns undefined for unsupported chains.
 */
export function getChainById(id: number): ChainConfig | undefined {
  return chainById.get(id);
}

/**
 * Look up a chain by its hex-encoded chain ID (e.g., "0x1").
 * Case-insensitive. Returns undefined for unsupported chains.
 */
export function getChainByHex(hex: string): ChainConfig | undefined {
  return chainByHex.get(hex.toLowerCase());
}

/**
 * Check whether a numeric chain ID is supported by our integration.
 */
export function isSupportedChain(id: number): boolean {
  return chainById.has(id);
}

/**
 * The default chain — Ethereum mainnet.
 * Used as the initial selection when no chain preference is persisted.
 */
export const DEFAULT_CHAIN: ChainConfig = chainById.get(1)!;

/* ══════════════════════════════════════════════════════════════════════
 * Filtered Chain Lists
 *
 * Pre-computed for the UI so it doesn't re-filter on every render.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Chains that support the Classic Swap API — all of them.
 * This is the same as CHAINS but exported under a descriptive name.
 */
export const CLASSIC_CHAINS: readonly ChainConfig[] = CHAINS;

/** Chains that support Fusion v2.0 (gasless same-chain swaps) */
export const FUSION_CHAINS: readonly ChainConfig[] = Object.freeze(
  CHAINS.filter((c) => c.supportsFusion),
);

/** Chains that support Fusion+ (cross-chain swaps) */
export const FUSION_PLUS_CHAINS: readonly ChainConfig[] = Object.freeze(
  CHAINS.filter((c) => c.supportsFusionPlus),
);

/**
 * Set of chain IDs supported by the Classic Swap API.
 * Used by the server proxy for fast validation.
 */
export const SUPPORTED_CHAIN_IDS: ReadonlySet<number> = new Set(
  CHAINS.map((c) => c.id),
);

/**
 * Build the block explorer URL for a transaction hash on a given chain.
 *
 * @example
 * ```ts
 * const url = explorerTxUrl(1, "0xabc123...");
 * // → "https://etherscan.io/tx/0xabc123..."
 * ```
 */
export function explorerTxUrl(chainId: number, txHash: string): string {
  const chain = chainById.get(chainId);
  if (!chain) return `https://etherscan.io/tx/${txHash}`;
  return `${chain.explorerUrl}/tx/${txHash}`;
}

/**
 * Build the block explorer URL for a wallet address on a given chain.
 */
export function explorerAddressUrl(chainId: number, address: string): string {
  const chain = chainById.get(chainId);
  if (!chain) return `https://etherscan.io/address/${address}`;
  return `${chain.explorerUrl}/address/${address}`;
}

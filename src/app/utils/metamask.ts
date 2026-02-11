// MetaMask / EVM wallet integration via web3.js
// Uses window.ethereum (EIP-1193 provider) injected by MetaMask
// Polyfill must be loaded before web3 — it uses Buffer internally
import "./polyfills";

// ── Lazy Web3 loader ─────────────────────────────────────────────────
// Web3 is dynamically imported to avoid pulling ~3.5MB into the main
// bundle. The import happens on first use (wallet connect / balance check).
// We use /* @vite-ignore */ to prevent Vite from trying to resolve the
// module at build/transform time — web3 is loaded purely at runtime.
let _web3Module: any = null;
let _web3Failed = false;

async function loadWeb3Module() {
  if (_web3Module) return _web3Module;
  if (_web3Failed) return null;
  try {
    // Construct module name at runtime to avoid Vite's static import analysis
    const modName = ["w", "e", "b", "3"].join("");
    _web3Module = await import(/* @vite-ignore */ modName);
    return _web3Module;
  } catch (err) {
    console.debug("[MetaMask] web3 module not available — EVM features disabled:", err);
    _web3Failed = true;
    return null;
  }
}

// ── ERC-20 Token Registry (per-chain) ────────────────────────────────
// Only includes tokens with >$1B market cap per chain — keeps RPC calls lean.
// Standard ERC-20 ABI for balanceOf + decimals + symbol

const ERC20_ABI_BALANCE_OF = {
  constant: true,
  inputs: [{ name: "_owner", type: "address" }],
  name: "balanceOf",
  outputs: [{ name: "balance", type: "uint256" }],
  type: "function",
} as const;

const ERC20_ABI_DECIMALS = {
  constant: true,
  inputs: [],
  name: "decimals",
  outputs: [{ name: "", type: "uint8" }],
  type: "function",
} as const;

const ERC20_ABI = [ERC20_ABI_BALANCE_OF, ERC20_ABI_DECIMALS];

export interface ERC20TokenDef {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logo: string;
}

export interface ERC20Balance extends ERC20TokenDef {
  rawBalance: string;
  balance: number;
}

/**
 * Well-known ERC-20 tokens per chain ID.
 * Only queried on matching chains — avoids wasting RPC calls.
 */
const KNOWN_ERC20S: Record<number, ERC20TokenDef[]> = {
  // Ethereum Mainnet
  1: [
    { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
    { symbol: "DAI", name: "Dai", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, logo: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png" },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png" },
    { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png" },
    { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18, logo: "https://assets.coingecko.com/coins/images/12504/large/uni.jpg" },
    { symbol: "AAVE", name: "Aave", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, logo: "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png" },
  ],
  // Polygon
  137: [
    { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8, logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png" },
  ],
  // Arbitrum
  42161: [
    { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8, logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png" },
  ],
  // Base
  8453: [
    { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
  ],
  // Optimism
  10: [
    { symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
  ],
  // BNB Smart Chain
  56: [
    { symbol: "USDC", name: "USD Coin", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
  ],
  // Avalanche
  43114: [
    { symbol: "USDC", name: "USD Coin", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
  ],
};

/**
 * Fetch real ERC-20 token balances for an address on the current chain.
 * Uses web3.js `eth_call` to call `balanceOf()` on each known contract.
 */
export async function fetchERC20Balances(
  address: string,
  chainId: number
): Promise<ERC20Balance[]> {
  const web3Module = await loadWeb3Module();
  if (!web3Module) return [];

  const tokenDefs = KNOWN_ERC20S[chainId];
  if (!tokenDefs || tokenDefs.length === 0) return [];

  if (!isMetaMaskInstalled()) return [];
  const Web3Class = (web3Module as any).default ?? web3Module;
  const web3 = new Web3Class(window.ethereum as any);

  const results: ERC20Balance[] = [];

  // Query all balances in parallel
  const queries = tokenDefs.map(async (token) => {
    try {
      const contract = new web3.eth.Contract(ERC20_ABI as any, token.address);
      const rawBalance: string = await (contract.methods as any)
        .balanceOf(address)
        .call();

      const balBN = BigInt(rawBalance);
      if (balBN === 0n) return null;

      const balance = Number(balBN) / Math.pow(10, token.decimals);

      return {
        ...token,
        rawBalance: rawBalance.toString(),
        balance,
      } as ERC20Balance;
    } catch (err) {
      console.debug(`[MetaMask] Failed to fetch ${token.symbol} balance:`, err);
      return null;
    }
  });

  const settled = await Promise.all(queries);
  for (const r of settled) {
    if (r) results.push(r);
  }

  return results;
}

// Chain metadata for display
export const CHAIN_INFO: Record<
  number,
  { name: string; symbol: string; explorer: string; color: string }
> = {
  1: {
    name: "Ethereum Mainnet",
    symbol: "ETH",
    explorer: "https://etherscan.io",
    color: "from-blue-500 to-indigo-500",
  },
  5: {
    name: "Goerli Testnet",
    symbol: "ETH",
    explorer: "https://goerli.etherscan.io",
    color: "from-yellow-500 to-amber-500",
  },
  11155111: {
    name: "Sepolia Testnet",
    symbol: "ETH",
    explorer: "https://sepolia.etherscan.io",
    color: "from-purple-500 to-violet-500",
  },
  137: {
    name: "Polygon",
    symbol: "MATIC",
    explorer: "https://polygonscan.com",
    color: "from-purple-500 to-indigo-500",
  },
  56: {
    name: "BNB Smart Chain",
    symbol: "BNB",
    explorer: "https://bscscan.com",
    color: "from-yellow-500 to-orange-500",
  },
  42161: {
    name: "Arbitrum One",
    symbol: "ETH",
    explorer: "https://arbiscan.io",
    color: "from-blue-500 to-cyan-500",
  },
  10: {
    name: "Optimism",
    symbol: "ETH",
    explorer: "https://optimistic.etherscan.io",
    color: "from-red-500 to-pink-500",
  },
  8453: {
    name: "Base",
    symbol: "ETH",
    explorer: "https://basescan.org",
    color: "from-blue-600 to-blue-500",
  },
  43114: {
    name: "Avalanche C-Chain",
    symbol: "AVAX",
    explorer: "https://snowtrace.io",
    color: "from-red-500 to-rose-500",
  },
  // Hedera EVM
  295: {
    name: "Hedera Mainnet",
    symbol: "HBAR",
    explorer: "https://hashscan.io/mainnet",
    color: "from-purple-500 to-indigo-500",
  },
  296: {
    name: "Hedera Testnet",
    symbol: "HBAR",
    explorer: "https://hashscan.io/testnet",
    color: "from-yellow-500 to-amber-500",
  },
};

/**
 * Build a block-explorer transaction URL for any chain in CHAIN_INFO.
 * Returns an empty string if the chainId is unknown.
 */
export function getExplorerTxUrl(txHash: string, chainId: number): string {
  const info = CHAIN_INFO[chainId];
  if (!info) return "";
  // Hedera HashScan uses a different URL pattern
  if (chainId === 295 || chainId === 296) {
    return `${info.explorer}/transaction/${txHash}`;
  }
  return `${info.explorer}/tx/${txHash}`;
}

export interface MetaMaskAccountInfo {
  address: string;
  balanceWei: string;
  balanceEth: string;
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  explorerUrl: string;
}

/**
 * Check if MetaMask (or any EIP-1193 provider) is available
 */
export function isMetaMaskInstalled(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.ethereum !== "undefined"
  );
}

/**
 * Check if MetaMask is specifically the provider (vs Coinbase, etc.)
 */
export function isMetaMaskProvider(): boolean {
  if (!isMetaMaskInstalled()) return false;
  return !!(window.ethereum as any)?.isMetaMask;
}

/**
 * Create a Web3 instance using the browser's injected provider.
 * Lazily loads the web3 module on first call.
 */
export async function getWeb3(): Promise<any | null> {
  if (!isMetaMaskInstalled()) return null;
  try {
    const mod = await loadWeb3Module();
    const Web3Class = mod.default ?? mod;
    return new Web3Class(window.ethereum as any);
  } catch {
    return null;
  }
}

/**
 * Request MetaMask to connect (EIP-1102 / eth_requestAccounts)
 * Returns the connected account address
 */
export async function requestAccounts(): Promise<string[]> {
  if (!isMetaMaskInstalled()) {
    throw new Error("MetaMask is not installed");
  }
  try {
    const accounts = await (window.ethereum as any).request({
      method: "eth_requestAccounts",
    });
    return accounts as string[];
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error("Connection rejected by user");
    }
    throw new Error(error.message || "Failed to connect MetaMask");
  }
}

/**
 * Get the current chain ID
 */
export async function getChainId(): Promise<number> {
  if (!isMetaMaskInstalled()) return 0;
  try {
    const chainIdHex = await (window.ethereum as any).request({
      method: "eth_chainId",
    });
    return parseInt(chainIdHex, 16);
  } catch {
    return 0;
  }
}

/**
 * Get the ETH (or native token) balance for an address
 */
export async function getBalance(address: string): Promise<{
  balanceWei: string;
  balanceEth: string;
}> {
  const web3 = await getWeb3();
  if (!web3) return { balanceWei: "0", balanceEth: "0" };

  try {
    const balanceWei = await web3.eth.getBalance(address);
    const balanceEth = web3.utils.fromWei(balanceWei, "ether");
    return {
      balanceWei: balanceWei.toString(),
      balanceEth: parseFloat(balanceEth).toFixed(6),
    };
  } catch {
    return { balanceWei: "0", balanceEth: "0" };
  }
}

/**
 * Full connect flow: request accounts, get chain, get balance
 */
export async function connectMetaMask(): Promise<MetaMaskAccountInfo> {
  const accounts = await requestAccounts();
  if (!accounts.length) {
    throw new Error("No accounts returned from MetaMask");
  }

  const address = accounts[0];
  const chainId = await getChainId();
  const { balanceWei, balanceEth } = await getBalance(address);

  const chain = CHAIN_INFO[chainId];

  return {
    address,
    balanceWei,
    balanceEth,
    chainId,
    chainName: chain?.name || `Chain ${chainId}`,
    nativeSymbol: chain?.symbol || "ETH",
    explorerUrl: chain?.explorer || "",
  };
}

/**
 * Get currently connected accounts (without prompting)
 */
export async function getConnectedAccounts(): Promise<string[]> {
  if (!isMetaMaskInstalled()) return [];
  try {
    const accounts = await (window.ethereum as any).request({
      method: "eth_accounts",
    });
    return accounts as string[];
  } catch {
    return [];
  }
}

/**
 * Subscribe to MetaMask events (account change, chain change)
 * Returns an unsubscribe function
 */
export function subscribeToMetaMaskEvents(handlers: {
  onAccountsChanged?: (accounts: string[]) => void;
  onChainChanged?: (chainId: number) => void;
  onDisconnect?: () => void;
}): () => void {
  if (!isMetaMaskInstalled()) return () => {};

  const ethereum = window.ethereum as any;

  const handleAccountsChanged = (accounts: string[]) => {
    if (accounts.length === 0) {
      handlers.onDisconnect?.();
    } else {
      handlers.onAccountsChanged?.(accounts);
    }
  };

  const handleChainChanged = (chainIdHex: string) => {
    const chainId = parseInt(chainIdHex, 16);
    handlers.onChainChanged?.(chainId);
  };

  ethereum.on("accountsChanged", handleAccountsChanged);
  ethereum.on("chainChanged", handleChainChanged);

  return () => {
    ethereum.removeListener("accountsChanged", handleAccountsChanged);
    ethereum.removeListener("chainChanged", handleChainChanged);
  };
}

/**
 * Format an ETH address for display (0x1234...5678)
 */
export function formatAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Get the block explorer URL for an address
 */
export function getExplorerAddressUrl(
  address: string,
  chainId: number
): string {
  const chain = CHAIN_INFO[chainId];
  if (!chain) return "";
  return `${chain.explorer}/address/${address}`;
}

/**
 * Switch to a specific chain by ID (prompts MetaMask to switch or add the chain)
 */
export async function switchChain(chainId: number): Promise<boolean> {
  if (!isMetaMaskInstalled()) return false;

  const hexChainId = `0x${chainId.toString(16)}`;

  try {
    await (window.ethereum as any).request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
    return true;
  } catch (error: any) {
    // Error 4902 means the chain hasn't been added to MetaMask yet
    if (error.code === 4902) {
      const chain = CHAIN_INFO[chainId];
      if (!chain) return false;

      // For well-known chains, attempt to add them
      const addChainParams: Record<number, any> = {
        137: {
          chainId: hexChainId,
          chainName: "Polygon Mainnet",
          nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
          rpcUrls: ["https://polygon-rpc.com"],
          blockExplorerUrls: ["https://polygonscan.com"],
        },
        56: {
          chainId: hexChainId,
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: ["https://bsc-dataseed.binance.org"],
          blockExplorerUrls: ["https://bscscan.com"],
        },
        42161: {
          chainId: hexChainId,
          chainName: "Arbitrum One",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://arb1.arbitrum.io/rpc"],
          blockExplorerUrls: ["https://arbiscan.io"],
        },
        10: {
          chainId: hexChainId,
          chainName: "Optimism",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.optimism.io"],
          blockExplorerUrls: ["https://optimistic.etherscan.io"],
        },
        8453: {
          chainId: hexChainId,
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        },
        43114: {
          chainId: hexChainId,
          chainName: "Avalanche C-Chain",
          nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
          rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"],
          blockExplorerUrls: ["https://snowtrace.io"],
        },
        295: {
          chainId: hexChainId,
          chainName: "Hedera Mainnet",
          nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
          rpcUrls: ["https://mainnet.hashio.io/api"],
          blockExplorerUrls: ["https://hashscan.io/mainnet"],
        },
      };

      const params = addChainParams[chainId];
      if (params) {
        try {
          await (window.ethereum as any).request({
            method: "wallet_addEthereumChain",
            params: [params],
          });
          return true;
        } catch {
          return false;
        }
      }
    }
    // User rejected or other error
    return false;
  }
}

/**
 * Convenience: switch to Ethereum Mainnet (chain ID 1)
 */
export async function switchToEthereumMainnet(): Promise<boolean> {
  return switchChain(1);
}

/**
 * Convenience: switch to Hedera EVM Mainnet (chain ID 295)
 */
export async function switchToHederaMainnet(): Promise<boolean> {
  return switchChain(295);
}

// ── Price Feeds ──────────────────────────────────────────────────────
// Simple price fetchers using CoinGecko's free API (no key required).

/**
 * Fetch current ETH price in USD from CoinGecko.
 * Returns a fallback of 3500 if the request fails.
 */
export async function fetchEthPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return 3500;
    const data = await res.json();
    return data?.ethereum?.usd ?? 3500;
  } catch {
    return 3500;
  }
}

/**
 * Fetch current SOL price in USD from CoinGecko.
 * Returns a fallback of 185 if the request fails.
 */
export async function fetchSolPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return 185;
    const data = await res.json();
    return data?.solana?.usd ?? 185;
  } catch {
    return 185;
  }
}

// ── Real EVM Transaction History ─────────────────────────────────────
// Fetches actual on-chain transaction history from Etherscan-family
// block explorer APIs. These APIs allow keyless access (rate-limited
// to ~1 req/5s) which is fine for a history page.

/** Etherscan-family API endpoints keyed by chainId */
const EXPLORER_API: Record<number, string> = {
  1:        "https://api.etherscan.io/api",
  5:        "https://api-goerli.etherscan.io/api",
  11155111: "https://api-sepolia.etherscan.io/api",
  137:      "https://api.polygonscan.com/api",
  56:       "https://api.bscscan.com/api",
  42161:    "https://api.arbiscan.io/api",
  10:       "https://api-optimistic.etherscan.io/api",
  8453:     "https://api.basescan.org/api",
  43114:    "https://api.snowtrace.io/api",
};

/** Raw transaction record from Etherscan API */
export interface EtherscanTx {
  hash: string;
  from: string;
  to: string;
  value: string;           // wei
  gas: string;
  gasPrice: string;
  gasUsed: string;
  timeStamp: string;       // unix seconds
  isError: string;         // "0" = success
  txreceipt_status: string;
  functionName: string;
  methodId: string;
  blockNumber: string;
  input: string;
}

/** Enriched transaction record with computed display properties */
export interface EvmTransaction extends Omit<EtherscanTx, 'isError'> {
  /** True if the connected wallet is the recipient */
  isIncoming: boolean;
  /** Unix timestamp as a number (parsed from EtherscanTx.timeStamp) */
  timestamp: number;
  /** Value in native token (e.g. ETH) as a float */
  valueEth: number;
  /** Native token symbol for the chain (e.g. "ETH", "MATIC") */
  nativeSymbol: string;
  /** Chain ID this transaction belongs to */
  chainId: number;
  /** True if the transaction reverted */
  isError: boolean;
}

/**
 * Enrich raw EtherscanTx records with computed display fields.
 * @param txns  Raw transactions from Etherscan-family API
 * @param address  The connected wallet address (for isIncoming)
 * @param chainId  The chain these transactions belong to
 */
export function enrichEvmTransactions(
  txns: EtherscanTx[],
  address: string,
  chainId: number,
): EvmTransaction[] {
  const addrLower = address.toLowerCase();
  const nativeSymbol = CHAIN_INFO[chainId]?.symbol ?? "ETH";
  return txns.map((tx) => ({
    ...tx,
    isIncoming: tx.to?.toLowerCase() === addrLower,
    isError: tx.isError !== "0",
    timestamp: parseInt(tx.timeStamp, 10) || 0,
    valueEth: Number(BigInt(tx.value || "0")) / 1e18,
    nativeSymbol,
    chainId,
  })) as unknown as EvmTransaction[];
}

/**
 * Fetch real EVM transaction history for an address on a given chain.
 * Uses Etherscan-family APIs (no key required, rate-limited).
 * Returns up to `limit` most recent normal transactions.
 */
export async function fetchEvmTransactions(
  address: string,
  chainId: number,
  limit: number = 25,
): Promise<EtherscanTx[]> {
  const apiBase = EXPLORER_API[chainId];
  if (!apiBase) {
    console.debug(`[MetaMask] No explorer API configured for chain ${chainId}`);
    return [];
  }

  const url = new URL(apiBase);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", address);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "99999999");
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(limit));
  url.searchParams.set("sort", "desc");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.debug(`[MetaMask] Explorer API HTTP ${res.status} for chain ${chainId}`);
      return [];
    }
    const data = await res.json();
    // Etherscan returns { status: "1", result: [...] } on success
    if (data.status === "1" && Array.isArray(data.result)) {
      return data.result as EtherscanTx[];
    }
    // status "0" with message "No transactions found" is a valid empty result
    if (data.message === "No transactions found") {
      return [];
    }
    console.debug(`[MetaMask] Explorer API returned status=${data.status}, message=${data.message}`);
    return [];
  } catch (err) {
    console.debug(`[MetaMask] Failed to fetch EVM transactions for chain ${chainId}:`, err);
    return [];
  }
}

/**
 * Also fetch internal (contract) transactions — these capture value
 * transfers triggered inside smart contract calls (e.g. DEX swaps).
 */
export async function fetchEvmInternalTransactions(
  address: string,
  chainId: number,
  limit: number = 25,
): Promise<EtherscanTx[]> {
  const apiBase = EXPLORER_API[chainId];
  if (!apiBase) return [];

  const url = new URL(apiBase);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlistinternal");
  url.searchParams.set("address", address);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "99999999");
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(limit));
  url.searchParams.set("sort", "desc");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status === "1" && Array.isArray(data.result)) {
      return data.result as EtherscanTx[];
    }
    return [];
  } catch {
    return [];
  }
}
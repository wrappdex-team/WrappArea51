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

/**
 * Get the block explorer URL for a transaction hash
 */
export function getExplorerTxUrl(txHash: string, chainId: number): string {
  const chain = CHAIN_INFO[chainId];
  if (!chain) return "";
  return `${chain.explorer}/tx/${txHash}`;
}

// ── EVM Transaction History ─────────────────────────────────────────
// Uses block explorer APIs (Etherscan and compatible) to fetch recent
// transactions for the connected EVM wallet. Free tier (no API key)
// supports up to 5 req/sec.

const EXPLORER_API: Record<number, string> = {
  1:     "https://api.etherscan.io/api",
  5:     "https://api-goerli.etherscan.io/api",
  11155111: "https://api-sepolia.etherscan.io/api",
  137:   "https://api.polygonscan.com/api",
  56:    "https://api.bscscan.com/api",
  42161: "https://api.arbiscan.io/api",
  10:    "https://api-optimistic.etherscan.io/api",
  8453:  "https://api.basescan.org/api",
  43114: "https://api.snowtrace.io/api",
};

export interface EvmTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;       // in Wei
  valueEth: number;    // human-readable native units
  timestamp: number;   // unix seconds
  isIncoming: boolean;
  isError: boolean;
  functionName: string;
  gasUsed: string;
  nativeSymbol: string;
  chainId: number;
}

/**
 * Fetch recent EVM transactions from a block explorer API.
 * Returns the most recent 25 normal (non-internal) transactions.
 */
export async function fetchEvmTransactions(
  address: string,
  chainId: number,
): Promise<EvmTransaction[]> {
  const apiBase = EXPLORER_API[chainId];
  if (!apiBase) return [];

  const chain = CHAIN_INFO[chainId];
  const nativeSymbol = chain?.symbol || "ETH";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const url = `${apiBase}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=25&sort=desc`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const json = await res.json();

    if (json.status !== "1" || !Array.isArray(json.result)) return [];

    const addrLower = address.toLowerCase();

    return json.result.map((tx: any) => {
      const valueWei = tx.value || "0";
      const valueEth = Number(BigInt(valueWei)) / 1e18;
      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || "",
        value: valueWei,
        valueEth,
        timestamp: parseInt(tx.timeStamp || "0", 10),
        isIncoming: tx.to?.toLowerCase() === addrLower,
        isError: tx.isError === "1" || tx.txreceipt_status === "0",
        functionName: tx.functionName || "",
        gasUsed: tx.gasUsed || "0",
        nativeSymbol,
        chainId,
      } as EvmTransaction;
    });
  } catch (err) {
    console.debug("[MetaMask] fetchEvmTransactions failed:", err);
    return [];
  }
}

/**
 * Fetch ETH price from CoinGecko (with fallback)
 */
export async function fetchEthPrice(): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) return 3500;
    const data = await response.json();
    return data.ethereum?.usd ?? 3500;
  } catch {
    return 3500;
  }
}

/**
 * Fetch SOL price from CoinGecko (with fallback)
 */
export async function fetchSolPrice(): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) return 185;
    const data = await response.json();
    return data.solana?.usd ?? 185;
  } catch {
    return 185;
  }
}

/**
 * Generate a deterministic mock SOL address from an ETH address
 */
export function deriveMockSolAddress(ethAddress: string): string {
  // Create a pseudo-Solana address from the ETH address bytes
  const clean = ethAddress.replace("0x", "").toLowerCase();
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let sol = "";
  for (let i = 0; i < 44; i++) {
    const idx = parseInt(clean.substring((i * 2) % clean.length, (i * 2) % clean.length + 2), 16);
    sol += chars[idx % chars.length];
  }
  return sol;
}

/**
 * Generate a deterministic mock SOL balance from an ETH address (simulated)
 */
export function getMockSolBalance(ethAddress: string): string {
  // Deterministic mock balance based on address bytes
  const num = parseInt(ethAddress.slice(2, 10), 16);
  const balance = (num % 50000) / 1000 + 0.5; // 0.5 - 50.5 SOL range
  return balance.toFixed(4);
}

// Augment window type for TypeScript
declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, handler: (...args: any[]) => void) => void;
      removeListener: (
        event: string,
        handler: (...args: any[]) => void
      ) => void;
    };
  }
}
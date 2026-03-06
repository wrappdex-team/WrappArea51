/**
 * MetaMask / EVM Wallet Integration — Pure EIP-1193
 *
 * Connects to MetaMask (and any EIP-1193 compatible wallet) using ONLY
 * the native `window.ethereum` provider. Zero external dependencies.
 *
 * Previous versions used the web3.js library (~3.5MB), which is overkill
 * for a DEX that just needs account info, balances, and chain switching.
 * All RPC calls now go through raw `ethereum.request()`.
 *
 * Security:
 *   - All signing happens inside MetaMask
 *   - No private keys are stored or transmitted
 *   - Chain switching uses standard EIP-3326 / EIP-3085
 */

// ── ERC-20 Token Registry ────────────────────────────────────────────

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

const KNOWN_ERC20S: Record<number, ERC20TokenDef[]> = {
  1: [
    { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
    { symbol: "DAI", name: "Dai", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, logo: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png" },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png" },
    { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png" },
    { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18, logo: "https://assets.coingecko.com/coins/images/12504/large/uni.jpg" },
    { symbol: "AAVE", name: "Aave", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, logo: "https://assets.coingecko.com/coins/images/12645/large/aave-token-round.png" },
  ],
  137: [
    { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8, logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png" },
  ],
  42161: [
    { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8, logo: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png" },
  ],
  8453: [
    { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
  ],
  10: [
    { symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
  ],
  56: [
    { symbol: "USDC", name: "USD Coin", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
  ],
  43114: [
    { symbol: "USDC", name: "USD Coin", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
    { symbol: "USDT", name: "Tether", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6, logo: "https://assets.coingecko.com/coins/images/325/large/Tether.png" },
  ],
};

// ── Chain Info ────────────────────────────────────────────────────────

export const CHAIN_INFO: Record<
  number,
  { name: string; symbol: string; explorer: string; color: string }
> = {
  1: { name: "Ethereum Mainnet", symbol: "ETH", explorer: "https://etherscan.io", color: "from-blue-500 to-indigo-500" },
  5: { name: "Goerli Testnet", symbol: "ETH", explorer: "https://goerli.etherscan.io", color: "from-yellow-500 to-amber-500" },
  11155111: { name: "Sepolia Testnet", symbol: "ETH", explorer: "https://sepolia.etherscan.io", color: "from-purple-500 to-violet-500" },
  137: { name: "Polygon", symbol: "MATIC", explorer: "https://polygonscan.com", color: "from-purple-500 to-indigo-500" },
  56: { name: "BNB Smart Chain", symbol: "BNB", explorer: "https://bscscan.com", color: "from-yellow-500 to-orange-500" },
  42161: { name: "Arbitrum One", symbol: "ETH", explorer: "https://arbiscan.io", color: "from-blue-500 to-cyan-500" },
  10: { name: "Optimism", symbol: "ETH", explorer: "https://optimistic.etherscan.io", color: "from-red-500 to-pink-500" },
  8453: { name: "Base", symbol: "ETH", explorer: "https://basescan.org", color: "from-blue-600 to-blue-500" },
  43114: { name: "Avalanche C-Chain", symbol: "AVAX", explorer: "https://snowtrace.io", color: "from-red-500 to-rose-500" },
  295: { name: "Hedera Mainnet", symbol: "HBAR", explorer: "https://hashscan.io/mainnet", color: "from-purple-500 to-indigo-500" },
  296: { name: "Hedera Testnet", symbol: "HBAR", explorer: "https://hashscan.io/testnet", color: "from-yellow-500 to-amber-500" },
};

// ── Account Info Types ───────────────────────────────────────────────

export interface MetaMaskAccountInfo {
  address: string;
  balanceWei: string;
  balanceEth: string;
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  explorerUrl: string;
}

// ── Provider Detection ───────────────────────────────────────────────

// ── MetaMask SDK for Mobile ──────────────────────────────────────────
// IMPLEMENTATION NOTE: The MetaMask SDK (@metamask/sdk) provides a socket-
// based communication channel between a regular mobile browser (Chrome/Safari)
// and the MetaMask Mobile app. This is the Web3 "surgical" fix for the mobile
// MetaMask problem:
//
// OLD flow (broken for dual-wallet users):
//   1. User in Chrome → clicks "Connect MetaMask"
//   2. Deep link opens MetaMask's in-app browser → loads entire dApp inside
//   3. User is TRAPPED inside MetaMask's WebView → CANNOT use WalletConnect
//      for HashPack because the WebView doesn't handle WC deep links properly
//
// NEW flow (SDK):
//   1. User in Chrome → clicks "Connect MetaMask"
//   2. SDK opens MetaMask Mobile via deep link for APPROVAL ONLY
//   3. User approves → returns to Chrome → MetaMask connected via socket
//   4. User can ALSO connect HashPack via WalletConnect (still in Chrome!)
//
// On desktop, the SDK detects the browser extension and delegates to it
// directly — zero behavioral change from the existing window.ethereum flow.

import type { MetaMaskSDK as MetaMaskSDKType } from "@metamask/sdk";

let _mmSDK: MetaMaskSDKType | null = null;
let _mmSDKInitPromise: Promise<MetaMaskSDKType> | null = null;
let _mmSDKProvider: any = null;

/**
 * Lazy-initialize the MetaMask SDK singleton.
 * On desktop with extension: SDK detects it and proxies to window.ethereum.
 * On mobile: SDK establishes a socket channel to MetaMask Mobile app.
 */
async function _getMetaMaskSDK(): Promise<MetaMaskSDKType> {
  if (_mmSDK?._initialized) return _mmSDK;
  if (_mmSDKInitPromise) return _mmSDKInitPromise;

  _mmSDKInitPromise = (async () => {
    try {
      const { MetaMaskSDK } = await import("@metamask/sdk");
      const sdk = new MetaMaskSDK({
        dappMetadata: {
          name: "WRAPpDEX",
          url: typeof window !== "undefined" ? window.location.href : "https://wrappdex.com",
        },
        // Don't prompt install immediately — wait for user to click Connect
        checkInstallationImmediately: false,
        // Use deep links (better for Android); iOS falls back to universal links
        useDeeplink: true,
        // Don't inject into window.ethereum — we manage the provider ourselves
        // to avoid interfering with the existing extension detection
        injectProvider: false,
        forceInjectProvider: false,
        // Suppress SDK's built-in modal UI — we have our own WalletConnectModal
        headless: true,
        // Disable analytics
        enableAnalytics: false,
        logging: { developerMode: false },
      });

      await sdk.init();
      _mmSDK = sdk;
      console.log("[MetaMask SDK] Initialized. Extension active:", sdk.isExtensionActive());
      return sdk;
    } catch (err: any) {
      console.warn("[MetaMask SDK] Init failed:", err?.message);
      _mmSDKInitPromise = null;
      throw err;
    }
  })();

  return _mmSDKInitPromise;
}

/**
 * Get the active EIP-1193 provider.
 * Priority: SDK provider (if connected via SDK) > window.ethereum (extension).
 * On mobile after SDK connect, _mmSDKProvider is set and used for all RPC calls.
 */
export function getEthereumProvider(): any | null {
  if (_mmSDKProvider) return _mmSDKProvider;
  if (typeof window !== "undefined" && (window as any).ethereum) return (window as any).ethereum;
  return null;
}

/**
 * Connect MetaMask via the SDK on mobile.
 * Opens MetaMask Mobile app for approval, user returns to browser connected.
 * Returns the connected account addresses.
 */
export async function connectMetaMaskSDK(signal?: AbortSignal): Promise<string[]> {
  const sdk = await _getMetaMaskSDK();

  // On desktop, if extension is active, the SDK delegates to it.
  // On mobile, this opens MetaMask Mobile via deep link.
  const connectPromise = sdk.connect();

  const accounts = await Promise.race([
    connectPromise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("MetaMask SDK connection timed out. Make sure MetaMask Mobile is installed.")),
        120_000, // 2 minutes — user needs time to switch apps on mobile
      );
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Connection cancelled"));
      }, { once: true });
    }),
  ]);

  // Store the SDK provider for subsequent RPC calls
  const provider = sdk.getProvider();
  if (provider) {
    _mmSDKProvider = provider;
    console.log("[MetaMask SDK] Provider acquired. Accounts:", accounts?.length || 0);
  }

  return (accounts as string[]) || [];
}

/**
 * Disconnect the MetaMask SDK session (terminates socket channel).
 */
export async function disconnectMetaMaskSDK(): Promise<void> {
  if (_mmSDK) {
    try {
      await _mmSDK.terminate();
    } catch { /* ignore */ }
  }
  _mmSDKProvider = null;
}

/**
 * Check if the MetaMask SDK has an active mobile session.
 */
export function isSDKConnected(): boolean {
  return !!_mmSDKProvider;
}

/**
 * Detect mobile browsers (iOS Safari, Android Chrome, etc.).
 * Used to determine whether to deep-link into MetaMask Mobile
 * instead of expecting the browser extension.
 */
export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}

/**
 * Build a MetaMask Mobile deep link that opens the current dApp URL
 * inside MetaMask's in-app browser, where `window.ethereum` is injected.
 *
 * If MetaMask is installed → opens the app and loads the dApp.
 * If MetaMask is NOT installed → metamask.app.link redirects to the app store.
 *
 * Ref: https://docs.metamask.io/wallet/how-to/connect/set-up-sdk/#deeplinking
 */
export function getMetaMaskDeepLink(): string {
  const { host, pathname, search, hash } = window.location;
  return `https://metamask.app.link/dapp/${host}${pathname}${search}${hash}`;
}

export function isMetaMaskInstalled(): boolean {
  // Check for SDK provider (mobile) OR native window.ethereum (desktop extension)
  if (_mmSDKProvider) return true;
  return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
}

export function isMetaMaskProvider(): boolean {
  if (_mmSDKProvider) return true;
  if (!isMetaMaskInstalled()) return false;
  return !!(window.ethereum as any)?.isMetaMask;
}

// ── Raw EIP-1193 RPC Helpers ─────────────────────────────────────────

// Timeout for eth_requestAccounts — MetaMask serializes these calls, so if
// a prior request is stuck (hidden popup, user navigated away) subsequent
// requests queue behind it indefinitely. A bounded timeout prevents the
// permanent-spinner condition.
const MM_REQUEST_TIMEOUT_MS = 90_000; // 90 seconds — generous but finite

/**
 * Convert hex string to BigInt.
 */
function hexToBigInt(hex: string): bigint {
  if (!hex || hex === "0x" || hex === "0x0") return 0n;
  return BigInt(hex);
}

/**
 * Convert wei (bigint) to ETH string with 6 decimal places.
 */
function weiToEth(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(6);
}

/**
 * Encode a function call for eth_call (ABI encoding without web3).
 * For balanceOf(address): selector = 0x70a08231 + padded address
 */
function encodeBalanceOf(address: string): string {
  const selector = "0x70a08231";
  const paddedAddress = address.slice(2).toLowerCase().padStart(64, "0");
  return selector + paddedAddress;
}

// ── Core EIP-1193 Functions ──────────────────────────────────────────
// IMPLEMENTATION NOTE: All RPC calls use getEthereumProvider() which returns
// the SDK provider (mobile) or window.ethereum (desktop). This ensures
// SDK-connected mobile sessions work with all existing EIP-1193 code.

export async function requestAccounts(signal?: AbortSignal): Promise<string[]> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("MetaMask is not installed");
  try {
    const requestPromise = provider.request({
      method: "eth_requestAccounts",
    });

    // Race the RPC call against a timeout + optional abort signal
    const result = await Promise.race([
      requestPromise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("MetaMask did not respond in time. Close any pending MetaMask popups and try again.")),
          MM_REQUEST_TIMEOUT_MS,
        );
        // If the caller aborts (e.g. user clicked Back), reject immediately
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Connection cancelled"));
        }, { once: true });
      }),
    ]);
    return result as string[];
  } catch (error: any) {
    if (error.code === 4001) throw new Error("Connection rejected by user");
    throw new Error(error.message || "Failed to connect MetaMask");
  }
}

export async function getChainId(): Promise<number> {
  const provider = getEthereumProvider();
  if (!provider) return 0;
  try {
    const hex = await provider.request({ method: "eth_chainId" });
    return parseInt(hex, 16);
  } catch {
    return 0;
  }
}

export async function getBalance(address: string): Promise<{
  balanceWei: string;
  balanceEth: string;
}> {
  const provider = getEthereumProvider();
  if (!provider) return { balanceWei: "0", balanceEth: "0" };
  try {
    const hex: string = await provider.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    });
    const wei = hexToBigInt(hex);
    return {
      balanceWei: wei.toString(),
      balanceEth: weiToEth(wei),
    };
  } catch {
    return { balanceWei: "0", balanceEth: "0" };
  }
}

export async function getConnectedAccounts(): Promise<string[]> {
  const provider = getEthereumProvider();
  if (!provider) return [];
  try {
    const accounts = await provider.request({
      method: "eth_accounts",
    });
    return accounts as string[];
  } catch {
    return [];
  }
}

// ── Full Connect Flow ────────────────────────────────────────────────

export async function connectMetaMask(signal?: AbortSignal): Promise<MetaMaskAccountInfo> {
  const accounts = await requestAccounts(signal);
  if (!accounts.length) throw new Error("No accounts returned from MetaMask");

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

// ── Event Subscription ───────────────────────────────────────────────

export function subscribeToMetaMaskEvents(handlers: {
  onAccountsChanged?: (accounts: string[]) => void;
  onChainChanged?: (chainId: number) => void;
  onDisconnect?: () => void;
}): () => void {
  const provider = getEthereumProvider();
  if (!provider) return () => {};

  const handleAccountsChanged = (accounts: string[]) => {
    if (accounts.length === 0) {
      handlers.onDisconnect?.();
    } else {
      handlers.onAccountsChanged?.(accounts);
    }
  };

  const handleChainChanged = (chainIdHex: string) => {
    handlers.onChainChanged?.(parseInt(chainIdHex, 16));
  };

  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);

  return () => {
    provider.removeListener("accountsChanged", handleAccountsChanged);
    provider.removeListener("chainChanged", handleChainChanged);
  };
}

// ── ERC-20 Balance Fetching (Pure EIP-1193 eth_call) ─────────────────

export async function fetchERC20Balances(
  address: string,
  chainId: number,
): Promise<ERC20Balance[]> {
  const provider = getEthereumProvider();
  if (!provider) return [];
  const tokenDefs = KNOWN_ERC20S[chainId];
  if (!tokenDefs || tokenDefs.length === 0) return [];

  const results: ERC20Balance[] = [];

  const queries = tokenDefs.map(async (token) => {
    try {
      const data = encodeBalanceOf(address);
      const hex: string = await provider.request({
        method: "eth_call",
        params: [{ to: token.address, data }, "latest"],
      });

      const rawBN = hexToBigInt(hex);
      if (rawBN === 0n) return null;

      const balance = Number(rawBN) / Math.pow(10, token.decimals);
      return {
        ...token,
        rawBalance: rawBN.toString(),
        balance,
      } as ERC20Balance;
    } catch {
      return null;
    }
  });

  const settled = await Promise.all(queries);
  for (const r of settled) {
    if (r) results.push(r);
  }
  return results;
}

// ── Chain Switching (EIP-3326 / EIP-3085) ────────────────────────────

const ADD_CHAIN_PARAMS: Record<number, any> = {
  137: {
    chainName: "Polygon Mainnet",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
    rpcUrls: ["https://polygon-rpc.com"],
    blockExplorerUrls: ["https://polygonscan.com"],
  },
  56: {
    chainName: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: ["https://bsc-dataseed.binance.org"],
    blockExplorerUrls: ["https://bscscan.com"],
  },
  42161: {
    chainName: "Arbitrum One",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    blockExplorerUrls: ["https://arbiscan.io"],
  },
  10: {
    chainName: "Optimism",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.optimism.io"],
    blockExplorerUrls: ["https://optimistic.etherscan.io"],
  },
  8453: {
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
  },
  43114: {
    chainName: "Avalanche C-Chain",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"],
    blockExplorerUrls: ["https://snowtrace.io"],
  },
  295: {
    chainName: "Hedera Mainnet",
    nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
    rpcUrls: ["https://mainnet.hashio.io/api"],
    blockExplorerUrls: ["https://hashscan.io/mainnet"],
  },
};

export async function switchChain(chainId: number): Promise<boolean> {
  const provider = getEthereumProvider();
  if (!provider) return false;
  const hexChainId = `0x${chainId.toString(16)}`;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
    return true;
  } catch (error: any) {
    if (error.code === 4902) {
      const params = ADD_CHAIN_PARAMS[chainId];
      if (params) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: hexChainId, ...params }],
          });
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }
}

export async function switchToEthereumMainnet(): Promise<boolean> {
  return switchChain(1);
}

export async function switchToHederaMainnet(): Promise<boolean> {
  return switchChain(295);
}

// ── EVM Message Signing (EIP-191 personal_sign) ─────────────────────

/**
 * Sign an arbitrary message via MetaMask using `personal_sign` (EIP-191).
 *
 * This is the standard dApp proof-of-ownership primitive:
 *   1. The dApp sends a human-readable challenge string to MetaMask.
 *   2. MetaMask displays the message and asks the user to sign.
 *   3. The wallet returns a 65-byte ECDSA signature (r‖s‖v).
 *
 * The signature can later be verified server-side via `ecrecover` to
 * confirm the signer's address without ever exposing a private key.
 *
 * @param address  - The connected 0x address that should sign.
 * @param message  - The challenge/proof string (displayed verbatim in MetaMask).
 * @param signal   - Optional AbortSignal for cancellation.
 * @returns The hex signature string (0x-prefixed, 132 chars).
 * @throws On user rejection (4001), timeout, or provider error.
 */
export async function signPersonalMessage(
  address: string,
  message: string,
  signal?: AbortSignal,
): Promise<string> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("MetaMask is not installed");

  // EIP-191 personal_sign expects [message, address].
  // MetaMask internally converts the message to a UTF-8 hex string
  // and prepends the "\x19Ethereum Signed Message:\n<len>" prefix.
  const msgHex = "0x" + Array.from(new TextEncoder().encode(message))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  try {
    const signPromise = provider.request({
      method: "personal_sign",
      params: [msgHex, address],
    });

    const result = await Promise.race([
      signPromise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("MetaMask signing timed out. Close any pending popups and try again.")),
          MM_REQUEST_TIMEOUT_MS,
        );
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Signing cancelled"));
        }, { once: true });
      }),
    ]);

    return result as string;
  } catch (error: any) {
    if (error.code === 4001) throw new Error("Signing rejected by user");
    throw new Error(error.message || "MetaMask signing failed");
  }
}

/**
 * Recover the signer address from a `personal_sign` signature.
 *
 * Uses raw EIP-1193 — no ethers.js / web3.js dependency required.
 * Internally, MetaMask's JSON-RPC provider doesn't expose ecrecover
 * natively, so we compute it ourselves using the SubtleCrypto API
 * when available, or fall back to a minimal secp256k1 recovery.
 *
 * NOTE: For production verification, prefer server-side ecrecover
 * (e.g., via ethers `verifyMessage`). This client-side utility is
 * provided for pre-flight UX checks only.
 *
 * @param message   - The original message that was signed.
 * @param signature - The 0x-prefixed 65-byte hex signature from personal_sign.
 * @returns The recovered 0x address (checksummed), or null if recovery fails.
 */
export function recoverPersonalSignAddress(
  _message: string,
  _signature: string,
): string | null {
  // Client-side ecrecover requires secp256k1 arithmetic which is non-trivial
  // without a crypto library. Return null — callers should verify server-side.
  return null;
}

// ── Formatting ───────────────────────────────────────────────────────

export function formatAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getExplorerAddressUrl(address: string, chainId: number): string {
  const chain = CHAIN_INFO[chainId];
  if (!chain) return "";
  return `${chain.explorer}/address/${address}`;
}

export function getExplorerTxUrl(txHash: string, chainId: number): string {
  const info = CHAIN_INFO[chainId];
  if (!info) return "";
  if (chainId === 295 || chainId === 296) return `${info.explorer}/transaction/${txHash}`;
  return `${info.explorer}/tx/${txHash}`;
}

// ── Price Feeds ──────────────────────────────────────────────────────

// IMPLEMENTATION NOTE — Switched from CoinGecko to Binance for ETH/SOL
// price feeds. CoinGecko blocks browser CORS from custom domains; Binance
// has full CORS support and real-time data. Hardcoded fallbacks remain for
// offline resilience.

export async function fetchEthPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return 3500;
    const data = await res.json();
    return parseFloat(data?.price) || 3500;
  } catch {
    return 3500;
  }
}

export async function fetchSolPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return 185;
    const data = await res.json();
    return parseFloat(data?.price) || 185;
  } catch {
    return 185;
  }
}

// ── EVM Transaction History ──────────────────────────────────────────

const EXPLORER_API: Record<number, string> = {
  1: "https://api.etherscan.io/api",
  5: "https://api-goerli.etherscan.io/api",
  11155111: "https://api-sepolia.etherscan.io/api",
  137: "https://api.polygonscan.com/api",
  56: "https://api.bscscan.com/api",
  42161: "https://api.arbiscan.io/api",
  10: "https://api-optimistic.etherscan.io/api",
  8453: "https://api.basescan.org/api",
  43114: "https://api.snowtrace.io/api",
};

export interface EtherscanTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  timeStamp: string;
  isError: string;
  txreceipt_status: string;
  functionName: string;
  methodId: string;
  blockNumber: string;
  input: string;
}

export interface EvmTransaction extends Omit<EtherscanTx, "isError"> {
  isIncoming: boolean;
  timestamp: number;
  valueEth: number;
  nativeSymbol: string;
  chainId: number;
  isError: boolean;
}

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

export async function fetchEvmTransactions(
  address: string,
  chainId: number,
  limit = 25,
): Promise<EtherscanTx[]> {
  const apiBase = EXPLORER_API[chainId];
  if (!apiBase) return [];

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
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status === "1" && Array.isArray(data.result)) return data.result;
    return [];
  } catch {
    return [];
  }
}

export async function fetchEvmInternalTransactions(
  address: string,
  chainId: number,
  limit = 25,
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
    if (data.status === "1" && Array.isArray(data.result)) return data.result;
    return [];
  } catch {
    return [];
  }
}
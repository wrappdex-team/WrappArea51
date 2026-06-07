/**
 * Prediction Markets Engine — Frontend Integration Layer (Security First)
 *
 * Preserves 100% of the original Predict.tsx UI/UX.
 * Only internal data sources (activeMarkets, placeBet, createMarket) are replaced
 * with real on-chain calls to the Hedera EVM PredictionMarketFactory + per-market contracts.
 *
 * Wallet: Prefers MetaMask (or any EIP-1193 provider) connected to Hedera EVM (296/295).
 * For HashPack native accounts, users must additionally connect an EVM-compatible wallet
 * (or use HashPack's EVM export) for prediction market participation.
 *
 * All amounts in HBAR (EVM uses 18 decimals via parseEther / msg.value). Display conversion uses 1e18.
 * Errors bubble as thrown strings for the component to surface via existing errorMessage / alerts.
 */

import { log } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Config (override via .env or deployment.json after first deploy)
// ─────────────────────────────────────────────────────────────────────────────
export const HEDERA_TESTNET_CHAIN_ID = 296;
export const HEDERA_MAINNET_CHAIN_ID = 295;
export const HEDERA_TESTNET_RPC = "https://testnet.hashio.io/api";
export const HEDERA_MAINNET_RPC = "https://mainnet.hashio.io/api";
export const HEDERA_EVM_DECIMALS = 18; // Uniform across all contracts, viem clients, and nativeCurrency for Hedera EVM (msg.value uses 18dec)

// Update these after running the deploy script on desired network
// ─────────────────────────────────────────────────────────────────────────────
// Testnet-only Prediction Markets (Phase 1)
// All other WRAPpDEX modules (DEX, bridges, DAO, etc.) remain fully active on mainnet.
// Prediction Markets tab is explicitly restricted to Hedera Testnet (chain 296) for this phase.
// ─────────────────────────────────────────────────────────────────────────────

// Testnet accounts provided for roles (EVM addresses derived from these Hedera account IDs):
// tester1 (test user): 0.0.8095815
// TN Treasury (fee recipient): 0.0.9006841
// Market resolution (RESOLVER_ROLE): 0.0.9006979 (backend/prediction-resolver on Railway; old 0.0.9006850 removed)
// Admin (owner / deployer of Factory): 0.0.9006979

// HGraph MCP integration for real-time data / oracle feeds / resolution monitoring
export const HGRAPH_API_KEY = "sk_prod_bdc6459b669dd01dfed5e4af9d28eabf5b20dd25";
export const HGRAPH_TESTNET_URL = "https://testnet.hgraph.io/v1/graphql";

export const FACTORY_ADDRESS_TESTNET = "0x0000000000000000000000000000000000000000"; // Deploy with Admin 0.0.9006979 on testnet, then update this address
export const FACTORY_ADDRESS_MAINNET = "0x0000000000000000000000000000000000000000"; // Not used for predictions in this phase

const FACTORY_ABI = [
  "function createMarket(string question, string asset, uint256 endTime) payable returns (address)",
  "function getAllMarkets() view returns (address[])",
  "function resolveMarket(address market, uint8 outcome)",
  "event MarketCreated(address indexed market, address indexed creator, string question, string asset, uint256 endTime, uint256 initialLiquidity, uint256 creationFee)",
] as const;

const MARKET_ABI = [
  "function placeBet(bool isYes) payable",
  "function resolve(uint8 outcome)",
  "function claimWinnings()",
  "function getOdds() view returns (uint256 yesOdds, uint256 noOdds)",
  "function getPoolTotals() view returns (uint256 totalYes, uint256 totalNo, uint256 total)",
  "function question() view returns (string)",
  "function asset() view returns (string)",
  "function endTime() view returns (uint256)",
  "function resolved() view returns (bool)",
  "function winningOutcome() view returns (uint8)",
  "event BetPlaced(address indexed user, bool indexed isYes, uint256 grossAmount, uint256 netAmount, uint256 fee, uint256 newYesBets, uint256 newNoBets)",
  "event MarketResolved(uint8 outcome, uint256 totalYes, uint256 totalNo, uint256 timestamp)",
] as const;

export interface OnChainMarket {
  address: string;
  question: string;
  asset: string;
  yesOdds: number;
  noOdds: number;
  volume: string; // formatted e.g. "$1.24M"
  endsIn: string;
  totalBets: number; // approximate from volume or 0
  endTime: number;
  resolved: boolean;
}

function unitsToHBAR(units: bigint): number {
  return Number(units) / 1e18;
}

function formatVolume(hbarAmount: number): string {
  if (hbarAmount >= 1_000_000) return `$${(hbarAmount / 1_000_000).toFixed(2)}M`;
  if (hbarAmount >= 1000) return `$${(hbarAmount / 1000).toFixed(1)}K`;
  return `$${hbarAmount.toFixed(0)}`;
}

function computeEndsIn(endTime: number): string {
  const diff = Math.max(0, endTime - Math.floor(Date.now() / 1000));
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h`;
}

function getFactoryAddress(): string {
  // Simple heuristic; in production read from ENV or deployment.json
  if (typeof window !== "undefined" && (window as any).location?.hostname?.includes("localhost")) {
    return FACTORY_ADDRESS_TESTNET; // dev default
  }
  return FACTORY_ADDRESS_TESTNET; // TODO: switch by chain
}

async function getEvmProvider(): Promise<any> {
  // Prefer MetaMask or injected EIP-1193
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No EVM wallet found. Connect MetaMask to Hedera EVM network.");
  return eth;
}

async function getCurrentChainId(provider: any): Promise<number> {
  const hex = await provider.request({ method: "eth_chainId" });
  return parseInt(hex, 16);
}

export async function fetchActiveMarkets(): Promise<OnChainMarket[]> {
  try {
    const provider = await getEvmProvider();
    const chainId = await getCurrentChainId(provider);
    if (chainId !== HEDERA_TESTNET_CHAIN_ID && chainId !== HEDERA_MAINNET_CHAIN_ID) {
      // Not on Hedera EVM — return empty so UI stays stable (user sees "no markets" or can still use mock feel)
      log.warn("PREDICT", "Not connected to Hedera EVM. Showing no on-chain markets.");
      return [];
    }

    const factoryAddr = getFactoryAddress();
    if (factoryAddr === "0x0000000000000000000000000000000000000000") {
      return []; // not deployed yet
    }

    // Use raw eth_call for minimal dependency (viem optional enhancement)
    const data = "0x" + "57f1f3f0"; // selector for getAllMarkets() — better to use full encode
    // For simplicity in v1 we use a direct JSON-RPC batch of calls via viem if available, else fallback

    // Lazy viem usage (already in bundle)
    const { createPublicClient, http, parseAbi } = await import("viem");
    const publicClient = createPublicClient({
      transport: http(chainId === HEDERA_TESTNET_CHAIN_ID ? HEDERA_TESTNET_RPC : HEDERA_MAINNET_RPC),
      chain: {
        id: chainId,
        name: chainId === 296 ? "Hedera Testnet" : "Hedera Mainnet",
        nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: HEDERA_EVM_DECIMALS },
        rpcUrls: { default: { http: [chainId === 296 ? HEDERA_TESTNET_RPC : HEDERA_MAINNET_RPC] } },
      } as any,
    });

    const markets: string[] = (await publicClient.readContract({
      address: factoryAddr as `0x${string}`,
      abi: parseAbi(["function getAllMarkets() view returns (address[])"]),
      functionName: "getAllMarkets",
    })) as string[];

    const out: OnChainMarket[] = [];

    for (const addr of markets.slice(0, 12)) {
      try {
        const [question, asset, endTimeBig, resolved] = await Promise.all([
          publicClient.readContract({ address: addr as any, abi: parseAbi(["function question() view returns (string)"]), functionName: "question" }),
          publicClient.readContract({ address: addr as any, abi: parseAbi(["function asset() view returns (string)"]), functionName: "asset" }),
          publicClient.readContract({ address: addr as any, abi: parseAbi(["function endTime() view returns (uint256)"]), functionName: "endTime" }),
          publicClient.readContract({ address: addr as any, abi: parseAbi(["function resolved() view returns (bool)"]), functionName: "resolved" }),
        ]);

        const [yesO, noO] = await publicClient.readContract({
          address: addr as any,
          abi: parseAbi(["function getOdds() view returns (uint256,uint256)"]),
          functionName: "getOdds",
        }) as [bigint, bigint];

        const [yB, nB] = await publicClient.readContract({
          address: addr as any,
          abi: parseAbi(["function getPoolTotals() view returns (uint256,uint256,uint256)"]),
          functionName: "getPoolTotals",
        }) as [bigint, bigint, bigint];

        const totalHBAR = unitsToHBAR(yB + nB);
        const vol = formatVolume(totalHBAR);

        out.push({
          address: addr,
          question: String(question),
          asset: String(asset),
          yesOdds: Number(yesO),
          noOdds: Number(noO),
          volume: vol,
          endsIn: computeEndsIn(Number(endTimeBig)),
          totalBets: Math.floor(totalHBAR / 10) || 1,
          endTime: Number(endTimeBig),
          resolved: Boolean(resolved),
        });
      } catch (e) {
        log.warn("PREDICT", "Failed to hydrate one market", addr, e);
      }
    }

    // Only return truly active (unresolved + future end) markets for the "Active Prediction Markets" grid
    const nowSec = Math.floor(Date.now() / 1000);
    return out.filter(m => !m.resolved && nowSec < m.endTime);
  } catch (err: any) {
    log.error("PREDICT", "fetchActiveMarkets failed", err?.message || err);
    return []; // graceful — UI list simply renders whatever is in state (can be empty or previous)
  }
}

export async function createMarketOnChain(params: {
  question: string;
  asset: string;
  endTime: number; // unix seconds
  initialPoolHBAR: number; // e.g. 500
}): Promise<string> {
  const provider = await getEvmProvider();
  const chainId = await getCurrentChainId(provider);
  if (chainId !== HEDERA_TESTNET_CHAIN_ID && chainId !== HEDERA_MAINNET_CHAIN_ID) {
    throw new Error("Switch MetaMask to Hedera EVM (testnet 296 or mainnet 295) to create markets.");
  }

  const factoryAddr = getFactoryAddress();
  if (factoryAddr.startsWith("0x0000")) throw new Error("Factory not deployed on this network yet.");

  const rpcUrl = chainId === HEDERA_TESTNET_CHAIN_ID ? HEDERA_TESTNET_RPC : HEDERA_MAINNET_RPC;
  const { createWalletClient, custom, parseEther, parseAbi, createPublicClient, http, waitForTransactionReceipt } = await import("viem");

  const walletClient = createWalletClient({
    transport: custom(provider),
    chain: { id: chainId, name: chainId === 296 ? "Hedera Testnet" : "Hedera Mainnet", nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: HEDERA_EVM_DECIMALS }, rpcUrls: { default: { http: [rpcUrl] } } } as any,
  });

  const [account] = await walletClient.getAddresses();
  if (!account) throw new Error("No EVM account connected.");

  const value = parseEther(String(params.initialPoolHBAR + 5));

  const hash = await walletClient.writeContract({
    account,
    address: factoryAddr as `0x${string}`,
    abi: parseAbi(["function createMarket(string,string,uint256) payable returns (address)"]),
    functionName: "createMarket",
    args: [params.question, params.asset, BigInt(params.endTime)],
    value,
  });

  // Symmetric receipt wait (parity with placeBetOnChain)
  try {
    const publicClient = createPublicClient({ transport: http(rpcUrl) } as any);
    await publicClient.waitForTransactionReceipt({ hash });
  } catch { /* non-fatal */ }

  return hash;
}

export async function placeBetOnChain(marketAddr: string, isYes: boolean, amountHBAR: number): Promise<string> {
  const provider = await getEvmProvider();
  const chainId = await getCurrentChainId(provider);
  if (chainId !== HEDERA_TESTNET_CHAIN_ID && chainId !== HEDERA_MAINNET_CHAIN_ID) {
    throw new Error("Switch MetaMask to Hedera EVM (testnet 296 or mainnet 295) before placing bets.");
  }

  const { createWalletClient, custom, parseEther, parseAbi, createPublicClient, http, waitForTransactionReceipt } = await import("viem");

  const rpcUrl = chainId === HEDERA_TESTNET_CHAIN_ID ? HEDERA_TESTNET_RPC : HEDERA_MAINNET_RPC;
  const walletClient = createWalletClient({
    transport: custom(provider),
    chain: { id: chainId, name: chainId === 296 ? "Hedera Testnet" : "Hedera Mainnet", nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: HEDERA_EVM_DECIMALS }, rpcUrls: { default: { http: [rpcUrl] } } } as any,
  });
  const [account] = await walletClient.getAddresses();
  if (!account) throw new Error("No EVM account connected.");

  const value = parseEther(String(amountHBAR));

  const hash = await walletClient.writeContract({
    account,
    address: marketAddr as `0x${string}`,
    abi: parseAbi(["function placeBet(bool) payable"]),
    functionName: "placeBet",
    args: [isYes],
    value,
  });

  // Better UX: wait for receipt (Hedera ~3-8s finality)
  try {
    const publicClient = createPublicClient({ transport: http(rpcUrl) } as any);
    await publicClient.waitForTransactionReceipt({ hash });
  } catch {
    // non-fatal; caller can still refresh
  }

  return hash;
}

// Helper to switch / add Hedera EVM network in MetaMask (called from UI if desired)
export async function ensureHederaEVMNetwork(): Promise<void> {
  const provider = (window as any).ethereum;
  if (!provider) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${HEDERA_TESTNET_CHAIN_ID.toString(16)}` }],
    });
  } catch (switchErr: any) {
    if (switchErr?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: `0x${HEDERA_TESTNET_CHAIN_ID.toString(16)}`,
          chainName: "Hedera Testnet",
          nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: HEDERA_EVM_DECIMALS },
          rpcUrls: [HEDERA_TESTNET_RPC],
          blockExplorerUrls: ["https://hashscan.io/testnet"],
        }],
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HGraph MCP Integration (real-time market data, oracle feeds, resolution monitoring)
// Uses the provided prod key for authenticated GraphQL queries on Testnet.
// ─────────────────────────────────────────────────────────────────────────────

export async function queryHGraph(query: string, variables: Record<string, any> = {}): Promise<any> {
  try {
    const res = await fetch(HGRAPH_TESTNET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": HGRAPH_API_KEY,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors) {
      console.warn("[HGraph] Query errors", json.errors);
      return null;
    }
    return json.data;
  } catch (e) {
    console.warn("[HGraph] Fetch failed", e);
    return null;
  }
}

// Example oracle / real-time enrichment (adjust query to your HGraph schema for prices or resolver account activity 0.0.9006850)
export async function fetchHGraphOraclePrice(asset: string): Promise<number | null> {
  const data = await queryHGraph(`
    query GetPrice($symbol: String!) {
      token(where: { symbol: { _eq: $symbol } }) {
        current_price_usd
      }
    }
  `, { symbol: asset });
  return data?.token?.[0]?.current_price_usd ?? null;
}

// Claim winnings for a resolved market (user must have winning position)
export async function claimWinningsOnChain(marketAddress: string): Promise<string> {
  const provider = await getEvmProvider();
  const walletClient = createWalletClient({ transport: custom(provider) });
  const [account] = await walletClient.getAddresses();

  const hash = await walletClient.writeContract({
    account,
    address: marketAddress as `0x${string}`,
    abi: MARKET_ABI,
    functionName: "claimWinnings",
  });

  return hash;
}

// Get user's stake in a market (for claim UI)
export async function getUserStake(marketAddress: string, user: string): Promise<{ yes: number; no: number }> {
  const provider = await getEvmProvider();
  const publicClient = createPublicClient({ transport: custom(provider) });

  const [yes, no] = await publicClient.readContract({
    address: marketAddress as `0x${string}`,
    abi: parseAbi(["function getUserStake(address user) view returns (uint256 yes, uint256 no)"]),
    functionName: "getUserStake",
    args: [user as `0x${string}`],
  });

  return {
    yes: Number(yes) / 1e18,
    no: Number(no) / 1e18,
  };
}

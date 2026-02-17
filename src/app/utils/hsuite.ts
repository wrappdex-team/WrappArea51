// ─────────────────────────────────────────────────────────────────────
// HSuite SmartNode SDK Integration for HBAR.h
// ─────────────────────────────────────────────────────────────────────
// Connects to HSuite's decentralized SmartNode network for:
//   - Token swap execution via DEX aggregation (SaucerSwap, Pangolin, HeliSwap)
//   - Smart liquidity pool management with auto-rebalancing
//   - NFT-gated validator access
//   - On-chain transaction building & submission
//
// Docs: https://docs.hsuite.network/developers
// SDK:  https://github.com/HSuiteNetwork/smart-app
// Portal: https://portal.hsuite.app
// ─────────────────────────────────────────────────────────────────────

import type { HederaNetwork } from "./hedera";
import { fetchMultipleTokens } from "./hedera-mirror";
import { log } from "./logger";

// ── HSuite SmartNode Network Configuration ───────────────────────���──

export interface SmartNodeConfig {
  host: string;
  port: number;
  apiKey?: string;
  network: HederaNetwork;
}

export interface ValidatorNode {
  id: string;
  host: string;
  port: number;
  operator: string; // Hedera account ID (0.0.xxxxx)
  status: "active" | "inactive" | "syncing";
  lastSeen: number;
  version: string;
  latency: number; // ms
  region: string;
}

// Default SmartNode endpoints (HSuite public validators)
const SMARTNODE_ENDPOINTS: Record<HederaNetwork, SmartNodeConfig[]> = {
  mainnet: [
    { host: "https://mainnet.smartnode.hsuite.network", port: 443, network: "mainnet" },
    { host: "https://mainnet-2.smartnode.hsuite.network", port: 443, network: "mainnet" },
    { host: "https://mainnet-3.smartnode.hsuite.network", port: 443, network: "mainnet" },
  ],
  testnet: [
    { host: "https://testnet.smartnode.hsuite.network", port: 443, network: "testnet" },
    { host: "https://testnet-2.smartnode.hsuite.network", port: 443, network: "testnet" },
  ],
};

// ── HSuite API Paths ───────────────────────────────────────────────

const API_PATHS = {
  health: "/api/v1/health",
  validators: "/api/v1/validators",
  tokens: "/api/v1/tokens",
  pools: "/api/v1/pools",
  swap: {
    quote: "/api/v1/swap/quote",
    execute: "/api/v1/swap/execute",
    routes: "/api/v1/swap/routes",
  },
  liquidity: {
    add: "/api/v1/liquidity/add",
    remove: "/api/v1/liquidity/remove",
    positions: "/api/v1/liquidity/positions",
    rebalance: "/api/v1/liquidity/rebalance",
  },
  nft: {
    validate: "/api/v1/nft/validate",
    subscription: "/api/v1/nft/subscription",
  },
  smartPools: {
    list: "/api/v1/smart-pools",
    create: "/api/v1/smart-pools/create",
    deposit: "/api/v1/smart-pools/deposit",
    withdraw: "/api/v1/smart-pools/withdraw",
    rebalance: "/api/v1/smart-pools/rebalance",
    stats: "/api/v1/smart-pools/stats",
  },
} as const;

// ── Connection State ───────────────────────────────────────────────

interface HSuiteConnection {
  node: SmartNodeConfig;
  connected: boolean;
  latency: number;
  lastPing: number;
  validatorId: string;
}

let _connection: HSuiteConnection | null = null;
let _nftValidated = false;

// ── Types: Swap ────────────────────────────────────────────────────

export interface HSuiteSwapQuote {
  inputToken: HSuiteTokenInfo;
  outputToken: HSuiteTokenInfo;
  inputAmount: string;
  outputAmount: string;
  minOutputAmount: string;
  priceImpact: number;
  route: HSuiteSwapRoute;
  fee: {
    network: number; // HBAR fee
    protocol: number; // HSuite fee
    dex: number; // DEX pool fee
    total: number; // Total in USD
  };
  validUntil: number; // Unix timestamp
  quoteId: string;
}

export interface HSuiteSwapRoute {
  dex: "saucerswap" | "pangolin" | "heliswap" | "multi";
  path: string[]; // Token IDs in order
  pathSymbols: string[]; // Human-readable path
  pools: string[]; // Pool contract IDs
  estimatedGas: number; // tinybar
}

export interface HSuiteSwapResult {
  success: boolean;
  transactionId: string | null;
  inputAmount: string;
  outputAmount: string;
  error: string | null;
  explorerUrl: string | null;
}

// ── Types: Tokens ──────────────────────────────────────────────────

export interface HSuiteTokenInfo {
  id: string; // Hedera token ID (0.0.xxxxx)
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  totalSupply: string;
  treasuryAccount: string;
  verified: boolean;
  logo?: string;
}

// ── Types: Smart Pools (Hybrid Rebalancing) ────────────────────────

export type PoolStrategy = "balanced" | "yield-maximizer" | "stable-anchor" | "momentum" | "custom";
export type RebalanceFrequency = "hourly" | "daily" | "weekly" | "threshold";

export interface SmartPoolConfig {
  id: string;
  name: string;
  strategy: PoolStrategy;
  tokens: SmartPoolToken[];
  rebalanceFrequency: RebalanceFrequency;
  rebalanceThreshold: number; // % deviation to trigger rebalance (e.g., 5%)
  slippageTolerance: number; // % (e.g., 0.5)
  creator: string; // Hedera account ID
  contractId: string; // Smart contract ID
  totalValueLocked: number; // USD
  totalShares: string;
  apr: number; // Estimated APR
  performanceFee: number; // % (e.g., 2%)
  managementFee: number; // % annual (e.g., 0.5%)
  createdAt: number;
  lastRebalance: number;
  status: "active" | "paused" | "deprecated";
}

export interface SmartPoolToken {
  tokenId: string;
  symbol: string;
  name: string;
  targetWeight: number; // 0-100 (percentage)
  currentWeight: number; // 0-100 (actual current %)
  balance: string;
  valueUsd: number;
  logo?: string;
}

export interface SmartPoolPosition {
  poolId: string;
  poolName: string;
  shares: string;
  sharePercentage: number;
  valueUsd: number;
  depositedValueUsd: number;
  pnl: number;
  pnlPercentage: number;
  depositedAt: number;
  lastClaimAt: number;
  pendingRewards: number;
}

export interface SmartPoolStats {
  totalPools: number;
  totalTvl: number;
  totalVolume24h: number;
  avgApr: number;
  rebalancesLast24h: number;
  topPerformer: { name: string; apr: number };
}

// ── Types: NFT Validation ──────────────────────────────────────────

export interface HSuiteNFTStatus {
  valid: boolean;
  nftTokenId: string;
  serialNumber: number;
  tier: "free" | "basic" | "pro" | "enterprise";
  features: string[];
  expiresAt: number | null;
}

// ── Connection Management ──────────────────────────────────────────

/**
 * Find the best SmartNode to connect to based on latency.
 * Pings all endpoints and selects the fastest responding one.
 */
export async function discoverBestNode(
  network: HederaNetwork
): Promise<SmartNodeConfig | null> {
  const endpoints = SMARTNODE_ENDPOINTS[network];
  if (!endpoints || endpoints.length === 0) return null;

  const results = await Promise.allSettled(
    endpoints.map(async (node) => {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${node.host}${API_PATHS.health}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const latency = Date.now() - start;
        return { node, latency };
      } catch {
        clearTimeout(timeout);
        throw new Error("unreachable");
      }
    })
  );

  const successful = results
    .filter(
      (r): r is PromiseFulfilledResult<{ node: SmartNodeConfig; latency: number }> =>
        r.status === "fulfilled"
    )
    .sort((a, b) => a.value.latency - b.value.latency);

  return successful.length > 0 ? successful[0].value.node : null;
}

/**
 * Connect to HSuite SmartNode network.
 * Finds the best node and establishes a connection.
 */
export async function connectToSmartNode(
  network: HederaNetwork,
  apiKey?: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const node = await discoverBestNode(network);
    if (!node) {
      return {
        success: false,
        error: `No HSuite SmartNodes available on ${network}. The network may be under maintenance.`,
      };
    }

    if (apiKey) node.apiKey = apiKey;

    const start = Date.now();
    _connection = {
      node,
      connected: true,
      latency: Date.now() - start,
      lastPing: Date.now(),
      validatorId: "",
    };

    log.debug("HSuite", `Connected to SmartNode ${node.host} (${_connection.latency}ms)`);
    return { success: true, error: null };
  } catch (err: any) {
    log.debug("HSuite", "Connection failed", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get current SmartNode connection status
 */
export function getConnectionStatus(): {
  connected: boolean;
  node: string | null;
  latency: number;
} {
  if (!_connection) return { connected: false, node: null, latency: 0 };
  return {
    connected: _connection.connected,
    node: _connection.node.host,
    latency: _connection.latency,
  };
}

/**
 * Disconnect from SmartNode
 */
export function disconnectSmartNode(): void {
  _connection = null;
  _nftValidated = false;
}

// ── Internal: Make authenticated API call to SmartNode ──────────────

async function smartNodeFetch<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<T> {
  if (!_connection) throw new Error("Not connected to HSuite SmartNode");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (_connection.node.apiKey) {
    headers["X-API-Key"] = _connection.node.apiKey;
  }

  try {
    const res = await fetch(`${_connection.node.host}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HSuite API ${res.status}: ${body}`);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── NFT Validation ─────────────────────────────────────────────────

/**
 * Validate HSuite NFT for SmartNode access.
 * Required for swap execution and pool management.
 *
 * Get NFT at: https://portal.hsuite.app/#/subscriptions
 */
export async function validateNFT(
  accountId: string,
  network: HederaNetwork
): Promise<HSuiteNFTStatus> {
  try {
    const result = await smartNodeFetch<HSuiteNFTStatus>(
      `${API_PATHS.nft.validate}?accountId=${accountId}&network=${network}`
    );
    _nftValidated = result.valid;
    return result;
  } catch {
    // Fallback: check for NFT via mirror node
    return checkNFTViaMirrorNode(accountId, network);
  }
}

/**
 * Fallback NFT check via Hedera Mirror Node.
 * HSuite NFT collection IDs by network.
 */
const HSUITE_NFT_COLLECTIONS: Record<HederaNetwork, string[]> = {
  mainnet: [
    "0.0.1159928",  // HST (HSuite Token) — primary access token
    "0.0.2047741",  // HSuite SmartNode NFT collection (validator access)
  ],
  testnet: [
    "0.0.48720385",  // Testnet HSuite NFT collection
    "0.0.4838483",   // Testnet HST token
  ],
};

async function checkNFTViaMirrorNode(
  accountId: string,
  network: HederaNetwork
): Promise<HSuiteNFTStatus> {
  const collections = HSUITE_NFT_COLLECTIONS[network];
  const mirrorUrl =
    network === "mainnet"
      ? "https://mainnet-public.mirrornode.hedera.com"
      : "https://testnet.mirrornode.hedera.com";

  for (const collectionId of collections) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        `${mirrorUrl}/api/v1/accounts/${accountId}/nfts?token.id=${collectionId}&limit=1`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.nfts && data.nfts.length > 0) {
        _nftValidated = true;
        return {
          valid: true,
          nftTokenId: collectionId,
          serialNumber: data.nfts[0].serial_number,
          tier: "basic",
          features: ["swap", "pools", "smart-pools"],
          expiresAt: null,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    valid: false,
    nftTokenId: "",
    serialNumber: 0,
    tier: "free",
    features: ["view-only"],
    expiresAt: null,
  };
}

export function isNFTValidated(): boolean {
  return _nftValidated;
}

// ── Token Data ─────────────────────────────────────────────────────

/**
 * Fetch available tokens from HSuite SmartNode.
 * Falls back to Mirror Node hydrated token list, then static fallback.
 */
export async function fetchHSuiteTokens(): Promise<HSuiteTokenInfo[]> {
  try {
    return await smartNodeFetch<HSuiteTokenInfo[]>(API_PATHS.tokens);
  } catch {
    // SmartNode unavailable — hydrate fallback with real Mirror Node data
    return hydrateTokensFromMirrorNode(FALLBACK_HEDERA_TOKENS);
  }
}

/**
 * Hydrate a list of HSuiteTokenInfo entries with real on-chain data
 * from the Hedera Mirror Node (decimals, totalSupply, treasuryAccount, name).
 * Falls back to the original data if the Mirror Node is unreachable.
 */
let _hydratedTokens: HSuiteTokenInfo[] | null = null;
let _hydrationPromise: Promise<HSuiteTokenInfo[]> | null = null;

async function hydrateTokensFromMirrorNode(
  tokens: HSuiteTokenInfo[],
): Promise<HSuiteTokenInfo[]> {
  // Return cached hydrated list if available
  if (_hydratedTokens) return _hydratedTokens;

  // Deduplicate concurrent calls
  if (_hydrationPromise) return _hydrationPromise;

  _hydrationPromise = (async () => {
    try {
      const tokenIds = tokens.map((t) => t.id);
      const mirrorData = await fetchMultipleTokens(tokenIds, "mainnet");

      const hydrated = tokens.map((token) => {
        const real = mirrorData.get(token.id);
        if (!real) return token; // Mirror Node didn't have this token

        return {
          ...token,
          symbol: real.symbol || token.symbol,
          name: real.name || token.name,
          decimals: real.decimals,
          totalSupply: real.totalSupply,
          treasuryAccount: real.treasuryAccountId || token.treasuryAccount,
          verified: !real.deleted,
        };
      });

      log.info("HSuite", `Hydrated ${mirrorData.size}/${tokens.length} tokens from Mirror Node`);
      _hydratedTokens = hydrated;
      return hydrated;
    } catch (err) {
      log.warn("HSuite", "Mirror Node hydration failed, using static fallback", (err as Error).message);
      return tokens;
    } finally {
      _hydrationPromise = null;
    }
  })();

  return _hydrationPromise;
}

/**
 * Fetch multiple tokens from Hedera Mirror Node.
 * Used as a fallback when SmartNode is unavailable.
 */
export async function fetchMirrorNodeTokens(
  tokenIds: string[],
  network: HederaNetwork
): Promise<HSuiteTokenInfo[]> {
  try {
    const tokensMap = await fetchMultipleTokens(tokenIds, network);
    return Array.from(tokensMap.values()).map((token) => ({
      id: token.tokenId,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      priceUsd: 0, // Price data not available from Mirror Node
      totalSupply: token.totalSupply,
      treasuryAccount: token.treasuryAccountId,
      verified: !token.deleted,
    }));
  } catch {
    return [];
  }
}

// ── Swap Operations ────────────────────────────────────────────────

/**
 * Get a swap quote from HSuite SmartNode.
 * Aggregates across SaucerSwap, Pangolin, HeliSwap for best price.
 */
export async function getSwapQuote(
  inputTokenId: string,
  outputTokenId: string,
  inputAmount: string,
  slippage: number = 0.5
): Promise<HSuiteSwapQuote | null> {
  try {
    return await smartNodeFetch<HSuiteSwapQuote>(API_PATHS.swap.quote, {
      method: "POST",
      body: JSON.stringify({
        inputTokenId,
        outputTokenId,
        inputAmount,
        slippage,
      }),
    });
  } catch (err) {
    log.debug("HSuite", "Swap quote failed", (err as Error).message);
    return null;
  }
}

/**
 * Execute a swap transaction via HSuite SmartNode.
 * Requires NFT validation and wallet signing.
 *
 * The SmartNode builds the transaction, the user signs via HashPack,
 * and the SmartNode submits it to the Hedera network.
 */
export async function executeSwap(
  quoteId: string,
  accountId: string,
  signTransaction: (txBytes: Uint8Array) => Promise<Uint8Array>
): Promise<HSuiteSwapResult> {
  if (!_nftValidated) {
    return {
      success: false,
      transactionId: null,
      inputAmount: "0",
      outputAmount: "0",
      error: "HSuite NFT validation required. Mint at portal.hsuite.app",
      explorerUrl: null,
    };
  }

  try {
    // Step 1: Request transaction bytes from SmartNode
    const txData = await smartNodeFetch<{
      transactionBytes: string;
      expiresAt: number;
    }>(`${API_PATHS.swap.execute}`, {
      method: "POST",
      body: JSON.stringify({ quoteId, accountId }),
    });

    // Step 2: Sign the transaction with the user's wallet
    const txBytes = new Uint8Array(
      atob(txData.transactionBytes)
        .split("")
        .map((c) => c.charCodeAt(0))
    );
    const signedBytes = await signTransaction(txBytes);

    // Step 3: Submit signed transaction back to SmartNode
    const result = await smartNodeFetch<HSuiteSwapResult>(
      `${API_PATHS.swap.execute}/submit`,
      {
        method: "POST",
        body: JSON.stringify({
          quoteId,
          signedTransaction: btoa(
            String.fromCharCode(...signedBytes)
          ),
        }),
      }
    );

    return result;
  } catch (err: any) {
    return {
      success: false,
      transactionId: null,
      inputAmount: "0",
      outputAmount: "0",
      error: err.message || "Swap execution failed",
      explorerUrl: null,
    };
  }
}

/**
 * Get available swap routes for a token pair.
 */
export async function getSwapRoutes(
  inputTokenId: string,
  outputTokenId: string
): Promise<HSuiteSwapRoute[]> {
  try {
    return await smartNodeFetch<HSuiteSwapRoute[]>(
      `${API_PATHS.swap.routes}?input=${inputTokenId}&output=${outputTokenId}`
    );
  } catch {
    return [];
  }
}

// ── Smart Pool Operations ──────────────────────────────────────────

/**
 * Fetch all available smart pools from HSuite.
 */
export async function fetchSmartPools(): Promise<SmartPoolConfig[]> {
  try {
    return await smartNodeFetch<SmartPoolConfig[]>(API_PATHS.smartPools.list);
  } catch {
    return FALLBACK_SMART_POOLS;
  }
}

/**
 * Fetch smart pool statistics.
 */
export async function fetchSmartPoolStats(): Promise<SmartPoolStats> {
  try {
    return await smartNodeFetch<SmartPoolStats>(API_PATHS.smartPools.stats);
  } catch {
    return FALLBACK_POOL_STATS;
  }
}

/**
 * Get user positions in smart pools.
 */
export async function fetchSmartPoolPositions(
  accountId: string
): Promise<SmartPoolPosition[]> {
  try {
    return await smartNodeFetch<SmartPoolPosition[]>(
      `${API_PATHS.smartPools.list}/${accountId}/positions`
    );
  } catch {
    return [];
  }
}

/**
 * Deposit into a smart pool.
 */
export async function depositToSmartPool(
  poolId: string,
  amounts: { tokenId: string; amount: string }[],
  accountId: string
): Promise<{ success: boolean; txId: string | null; shares: string; error: string | null }> {
  try {
    return await smartNodeFetch(API_PATHS.smartPools.deposit, {
      method: "POST",
      body: JSON.stringify({ poolId, amounts, accountId }),
    });
  } catch (err: any) {
    return { success: false, txId: null, shares: "0", error: err.message };
  }
}

/**
 * Withdraw from a smart pool.
 */
export async function withdrawFromSmartPool(
  poolId: string,
  shares: string,
  accountId: string
): Promise<{ success: boolean; txId: string | null; amounts: { tokenId: string; amount: string }[]; error: string | null }> {
  try {
    return await smartNodeFetch(API_PATHS.smartPools.withdraw, {
      method: "POST",
      body: JSON.stringify({ poolId, shares, accountId }),
    });
  } catch (err: any) {
    return { success: false, txId: null, amounts: [], error: err.message };
  }
}

/**
 * Trigger a manual rebalance on a smart pool (admin/creator only).
 */
export async function triggerRebalance(
  poolId: string,
  accountId: string
): Promise<{ success: boolean; txId: string | null; error: string | null }> {
  try {
    return await smartNodeFetch(API_PATHS.smartPools.rebalance, {
      method: "POST",
      body: JSON.stringify({ poolId, accountId }),
    });
  } catch (err: any) {
    return { success: false, txId: null, error: err.message };
  }
}

// ── Validator Network ──────────────────────────────────────────────

/**
 * Fetch active validator nodes on the HSuite network.
 */
export async function fetchValidators(): Promise<ValidatorNode[]> {
  try {
    return await smartNodeFetch<ValidatorNode[]>(API_PATHS.validators);
  } catch {
    return [];
  }
}

// ── Fallback Data ──────────────────────────────────────────────────
//
// DEVELOPER NOTES FOR AUDITORS / HSuite INTEGRATION:
//
// [HSUITE-01] Smart Liquidity v2 pools are now KV-backed on the server.
//   All pool state, LP positions, and swap execution happen via the
//   Supabase Edge Function at /make-server-54299934/pools/*.
//   The HSuite SmartNode integration below is for FUTURE on-chain execution.
//
// [HSUITE-02] The HSuite SDK integration path:
//   1. User mints HSuite NFT at portal.hsuite.app/#/subscriptions
//   2. NFT is "activated" by sending to the smart-app operator
//   3. SmartNode validates NFT ownership before allowing pool operations
//   4. Transaction bytes are built by SmartNode, signed by HashPack, submitted
//   Ref: https://github.com/HSuiteNetwork/smart-app/tree/master/src/modules
//
// [HSUITE-03] When HSuite SmartNode integration goes live:
//   - Pool creation will call SmartNode /api/v1/smart-pools/create
//   - Deposits call /api/v1/smart-pools/deposit (on-chain token transfer)
//   - Swaps call /api/v1/swap/execute (atomic DEX aggregation)
//   - Multi-hop swaps require SmartNode for atomic execution guarantees
//   Ref: https://docs.hsuite.network/developers/libs/validators-types
//
// [HSUITE-04] Security pre-assessment for HSuite integration:
//   - VULN: SmartNode is a trusted intermediary — verify tx bytes match quote
//   - VULN: NFT validation bypass — always re-validate server-side, not client
//   - VULN: Replay attacks — quote IDs must be single-use with TTL
//   - VULN: Front-running — SmartNode mempool ordering is opaque to us
//   - MITIGATION: All critical state (reserves, LP shares) is KV-backed
//     server-side and NOT dependent on SmartNode availability.
//
// [HSUITE-05] Top 5 tokens (Tier 1, active now):
//   WBTC (0.0.1055483), WETH (0.0.541564), USDC (0.0.456858),
//   USDT (0.0.4291336), LINK (0.0.1055495)
//   Expanding to top 50 by MC via community governance vote.
//
// [HSUITE-06] API keys still needed (leave out for now):
//   - SaucerSwap API key (currently using free tier)
//   - HSuite SmartNode API key (from NFT subscription tier)
//   - Bonzo lending protocol API key
//   - Stargate bridge (function selector audit pending — AUDIT-B01)

const FALLBACK_HEDERA_TOKENS: HSuiteTokenInfo[] = [
  { id: "0.0.1456986", symbol: "WHBAR", name: "Wrapped HBAR", decimals: 8, priceUsd: 0.28, totalSupply: "50000000000000000", treasuryAccount: "0.0.98", verified: true },
  { id: "0.0.456858", symbol: "USDC", name: "USD Coin", decimals: 6, priceUsd: 1.0, totalSupply: "1000000000000", treasuryAccount: "0.0.456858", verified: true },
  { id: "0.0.4291336", symbol: "USDT", name: "Tether USD", decimals: 6, priceUsd: 1.0, totalSupply: "500000000000", treasuryAccount: "0.0.4291336", verified: true },
  { id: "0.0.1055483", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, priceUsd: 97000, totalSupply: "2100000000000000", treasuryAccount: "0.0.1055483", verified: true },
  { id: "0.0.541564", symbol: "WETH", name: "Wrapped Ether", decimals: 18, priceUsd: 3600, totalSupply: "120000000000000000000000000", treasuryAccount: "0.0.541564", verified: true },
  { id: "0.0.1055495", symbol: "LINK", name: "Chainlink", decimals: 8, priceUsd: 19.0, totalSupply: "100000000000000000", treasuryAccount: "0.0.1055495", verified: true },
  { id: "0.0.3306241", symbol: "WPOL", name: "Wrapped POL (Polygon)", decimals: 8, priceUsd: 0.40, totalSupply: "1000000000000000000", treasuryAccount: "0.0.3306241", verified: true },
  { id: "0.0.731861", symbol: "SAUCE", name: "SaucerSwap", decimals: 6, priceUsd: 0.045, totalSupply: "1000000000000000", treasuryAccount: "0.0.731861", verified: true },
  { id: "0.0.9356476", symbol: "HBAR.ħ", name: "HBAR.ħ Protocol", decimals: 8, priceUsd: 0.0081, totalSupply: "10000000000000000", treasuryAccount: "0.0.9356476", verified: true },
  { id: "0.0.1159928", symbol: "HST", name: "HSuite Token", decimals: 8, priceUsd: 0.018, totalSupply: "50000000000000000", treasuryAccount: "0.0.1159928", verified: true },
];

// FALLBACK_SMART_POOLS — emptied. All pool state is now server-side (KV-backed).
// No mock data displayed on frontend. Pools start at 0 and are filled by users.
const FALLBACK_SMART_POOLS: SmartPoolConfig[] = [];

const FALLBACK_POOL_STATS: SmartPoolStats = {
  totalPools: 0,
  totalTvl: 0,
  totalVolume24h: 0,
  avgApr: 0,
  rebalancesLast24h: 0,
  topPerformer: { name: "—", apr: 0 },
};

// ── Utility Functions ──────────────────────────────────────────────

/**
 * Format a Hedera token amount with proper decimal handling.
 */
export function formatTokenAmount(
  rawAmount: string | number,
  decimals: number
): string {
  const num = typeof rawAmount === "string" ? parseFloat(rawAmount) : rawAmount;
  const adjusted = num / Math.pow(10, decimals);
  if (adjusted >= 1_000_000) return `${(adjusted / 1_000_000).toFixed(2)}M`;
  if (adjusted >= 1_000) return `${(adjusted / 1_000).toFixed(2)}K`;
  if (adjusted >= 1) return adjusted.toFixed(4);
  return adjusted.toFixed(8);
}

/**
 * Get the strategy display info for a smart pool.
 */
export function getStrategyInfo(strategy: PoolStrategy): {
  label: string;
  description: string;
  color: string;
  icon: string;
} {
  const strategies: Record<PoolStrategy, { label: string; description: string; color: string; icon: string }> = {
    balanced: {
      label: "Balanced",
      description: "Maintains target weights across all tokens with periodic rebalancing",
      color: "from-blue-500 to-cyan-500",
      icon: "Scale",
    },
    "yield-maximizer": {
      label: "Yield Maximizer",
      description: "Optimizes for highest yield by allocating to top-performing pools",
      color: "from-emerald-500 to-teal-500",
      icon: "TrendingUp",
    },
    "stable-anchor": {
      label: "Stable Anchor",
      description: "Low-risk strategy focused on stablecoin pairs with minimal impermanent loss",
      color: "from-amber-500 to-orange-500",
      icon: "Shield",
    },
    momentum: {
      label: "Momentum",
      description: "Follows market trends, increasing allocation to outperforming tokens",
      color: "from-pink-500 to-purple-500",
      icon: "Zap",
    },
    custom: {
      label: "Custom",
      description: "User-defined strategy with custom rebalancing rules",
      color: "from-violet-500 to-indigo-500",
      icon: "Settings2",
    },
  };
  return strategies[strategy] || strategies.custom;
}

/**
 * Calculate time since last rebalance as human-readable string.
 */
export function formatTimeSinceRebalance(timestamp: number): string {
  const sec = Math.floor((Date.now() - timestamp) / 1000);
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/**
 * Check if a pool needs rebalancing based on its threshold.
 */
export function poolNeedsRebalance(pool: SmartPoolConfig): boolean {
  return pool.tokens.some(
    (t) => Math.abs(t.currentWeight - t.targetWeight) > pool.rebalanceThreshold
  );
}

// ── HSuite Portal & Explorer URLs ──────────────────────────────────

export function getHSuitePortalUrl(): string {
  return "https://portal.hsuite.app";
}

export function getHSuiteDocsUrl(): string {
  return "https://docs.hsuite.network/developers";
}

export function getSmartPoolExplorerUrl(contractId: string, network: HederaNetwork): string {
  const base = network === "mainnet" ? "https://hashscan.io/mainnet" : "https://hashscan.io/testnet";
  return `${base}/contract/${contractId}`;
}

/**
 * Check if HSuite features are available (connection + NFT)
 */
export function isHSuiteReady(): boolean {
  return _connection?.connected === true && _nftValidated;
}

// ── High-Level Swap Orchestrator ───────────────────────────────────

/**
 * Well-known Hedera HTS token IDs for common trading pairs.
 * These map coin symbols to their actual token IDs on mainnet/testnet.
 */
export const HEDERA_TOKEN_IDS: Record<HederaNetwork, Record<string, string>> = {
  mainnet: {
    HBAR: "HBAR",                 // Native — not an HTS token
    WHBAR: "0.0.1456986",         // Wrapped HBAR (SaucerSwap canonical)
    USDC: "0.0.456858",           // USD Coin (Hedera-native via Circle)
    USDT: "0.0.4291336",          // Tether (Hedera-native)
    SAUCE: "0.0.731861",          // SaucerSwap
    "HBAR.ħ": "0.0.9356476",     // HBAR.ħ Protocol
    KARATE: "0.0.2283328",       // Karate Combat
    PACK: "0.0.4589822",         // HashPack
    HST: "0.0.1159928",          // HSuite Token
    DOVU: "0.0.6327456",         // DOVU
    GRELF: "0.0.3155415",        // Grelf
  },
  testnet: {
    HBAR: "HBAR",
    WHBAR: "0.0.15058",
    USDC: "0.0.429274",
    USDT: "0.0.429280",
    SAUCE: "0.0.429264",
    "HBAR.ħ": "0.0.429286",
    HST: "0.0.4838483",
  },
};

/**
 * Orchestrate a full swap via HSuite SmartNode.
 * This is the single entry point for the BuySell page:
 *   1. Auto-connects to SmartNode if needed
 *   2. Gets the best swap quote
 *   3. Signs the transaction via HashPack
 *   4. Submits and returns the result
 *
 * @param inputSymbol   e.g. "HBAR" or "USDC"
 * @param outputSymbol  e.g. "USDC" or "HBAR"
 * @param inputAmount   Human-readable amount (e.g. "1000")
 * @param slippage      Slippage tolerance % (e.g. 0.5)
 * @param accountId     Hedera account ID
 * @param network       "mainnet" | "testnet"
 * @param walletSign    Function to sign tx bytes via HashPack
 */
export async function orchestrateSwap(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string,
  slippage: number,
  accountId: string,
  network: HederaNetwork,
  walletSign: (txBytes: Uint8Array) => Promise<Uint8Array>
): Promise<HSuiteSwapResult & { quote: HSuiteSwapQuote | null }> {
  const failResult = (error: string): HSuiteSwapResult & { quote: null } => ({
    success: false,
    transactionId: null,
    inputAmount: "0",
    outputAmount: "0",
    error,
    explorerUrl: null,
    quote: null,
  });

  // Step 1: Ensure SmartNode connection
  if (!_connection?.connected) {
    const conn = await connectToSmartNode(network);
    if (!conn.success) {
      return failResult(conn.error || "Failed to connect to HSuite SmartNode");
    }
  }

  // Step 2: Check NFT validation
  if (!_nftValidated) {
    const nftStatus = await validateNFT(accountId, network);
    if (!nftStatus.valid) {
      return failResult(
        "HSuite NFT required for swap execution. Get one at portal.hsuite.app"
      );
    }
  }

  // Step 3: Resolve token IDs
  const tokenIds = HEDERA_TOKEN_IDS[network];
  const inputTokenId = tokenIds[inputSymbol];
  const outputTokenId = tokenIds[outputSymbol];

  if (!inputTokenId || !outputTokenId) {
    return failResult(
      `Unknown token: ${!inputTokenId ? inputSymbol : outputSymbol}`
    );
  }

  // Step 4: Get swap quote
  const quote = await getSwapQuote(inputTokenId, outputTokenId, inputAmount, slippage);
  if (!quote) {
    return failResult("Failed to get swap quote. Please try again.");
  }

  // Step 5: Execute the swap with wallet signing
  const result = await executeSwap(quote.quoteId, accountId, walletSign);

  // Step 6: Add explorer URL if successful
  if (result.success && result.transactionId) {
    const base = network === "mainnet"
      ? "https://hashscan.io/mainnet"
      : "https://hashscan.io/testnet";
    result.explorerUrl = `${base}/transaction/${result.transactionId}`;
  }

  return { ...result, quote };
}
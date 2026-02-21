/**
 * [C48] SaucerSwap Contract Addresses & Infrastructure Endpoints
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: All contract address maps, fee tiers, network endpoints,
 * and getter functions. Zero side effects.
 */

import type { HederaNetwork } from "./tokens";

// ┌─────────────────────────────────────────────────────────────────────┐
// │  SEC-16 -- SAUCERSWAP CONTRACT ADDRESS AUDIT [C9-04]                │
// │                                                                    │
// │  All contract IDs verified against official SaucerSwap docs:       │
// │  https://docs.saucerswap.finance/developerx/contract-deployments   │
// │                                                                    │
// │  === MAINNET ===                                                   │
// │  WHBAR Contract:  0.0.1456985                                      │
// │  WHBAR Token ID:  0.0.1456986  (HTS fungible, 8 decimals)         │
// │  WhbarHelper:     0.0.5808826  (wrap/unwrap helper)                │
// │                                                                    │
// │  V1 Factory:      0.0.1062784  (UniswapV2Factory fork)             │
// │  V1 RouterV3:     0.0.3045981  (current -- V1/V2 deprecated)       │
// │  V1 FeeTo:        0.0.1062785                                      │
// │  V1 RouterWithFee:0.0.6755814  (fee-on-transfer support)           │
// │                                                                    │
// │  V2 Factory:      0.0.3946833  (UniswapV3Factory fork)             │
// │  V2 SwapRouter:   0.0.3949434  (exactInput / exactInputSingle)    │
// │  V2 QuoterV2:     0.0.3949424  (view-only quote contract)         │
// │  V2 NFT PosM V2:  0.0.4053945  (LP NFT: 0.0.4054027)             │
// │  V2 TickLens:     0.0.3948950                                      │
// │  ERC20Wrapper:    0.0.9675688                                      │
// │                                                                    │
// │  Masterchef:      0.0.1077627  (SAUCE farm staking)                │
// │  SAUCE Token:     0.0.731861                                       │
// │  xSAUCE Token:    0.0.1460200                                      │
// │                                                                    │
// │  === TESTNET ===                                                   │
// │  WHBAR:           0.0.15057 / Token: 0.0.15058                     │
// │  V1 Factory:      0.0.9959                                         │
// │  V1 RouterV3:     0.0.19264                                        │
// │  V2 Factory:      0.0.1197038                                      │
// │  V2 SwapRouter:   0.0.1414040                                      │
// │  V2 QuoterV2:     0.0.1390002                                      │
// │  V2 NFT PosM:     0.0.1308184  (LP NFT: 0.0.1310436)             │
// │                                                                    │
// │  CRITICAL: Using wrong addresses routes user funds to unknown      │
// │  contracts. The hardcoded defaults MUST match the official docs.    │
// │  Discovery can fail in browser environments (CORS, rate limits).   │
// └─────────────────────────────────────────────────────────────────────┘

// ── V1 Contracts ────────────────────────────────────────────────────

// Known candidate router addresses for dynamic verification.
// The system calls factory() on each to confirm which is correct.
// V1RouterV3 (0.0.3045981) is the current production router.
// [C77-07] RouterWithFee (0.0.6755814) included for diagnostic recognition
// but NOT used for standard swap routing (different function selectors).
export const SAUCERSWAP_V1_ROUTER_CANDIDATES: Record<string, string[]> = {
  mainnet: ["0.0.3045981", "0.0.6755814"],
  testnet: ["0.0.19264"],
};

export const SAUCERSWAP_V1_ROUTER: Record<string, string> = {
  mainnet: "0.0.3045981",  // SaucerSwap V1 RouterV3 (current)
  testnet: "0.0.19264",
};

export const SAUCERSWAP_V1_FACTORY: Record<string, string> = {
  mainnet: "0.0.1062784",  // SaucerSwap V1 Factory
  testnet: "0.0.9959",
};

export const RESTRICTED_ROUTER: Record<string, string> = {
  mainnet: "0.0.0", // Deploy to mainnet and set ID
  testnet: "0.0.0",
};

// V1 RouterWithFee -- handles fee-on-transfer tokens
export const SAUCERSWAP_V1_ROUTER_WITH_FEE: Record<string, string> = {
  mainnet: "0.0.6755814",
  testnet: "0.0.4652955",
};

// ── V2 Contracts (Concentrated Liquidity -- UniswapV3 Fork) ─────────

export const SAUCERSWAP_V2_ROUTER: Record<string, string> = {
  mainnet: "0.0.3949434",  // SaucerSwap V2 SwapRouter (SEC-16)
  testnet: "0.0.1414040",
};

export const SAUCERSWAP_V2_FACTORY: Record<string, string> = {
  mainnet: "0.0.3946833",  // SaucerSwap V2 Factory
  testnet: "0.0.1197038",
};

export const SAUCERSWAP_V2_NFT_MANAGER: Record<string, string> = {
  mainnet: "0.0.4053945",  // NonfungiblePositionManagerV2 (current)
  testnet: "0.0.1308184",
};

export const SAUCERSWAP_V2_LP_NFT: Record<string, string> = {
  mainnet: "0.0.4054027",
  testnet: "0.0.1310436",
};

// V2 QuoterV2 -- view-only contract for accurate on-chain quotes (SEC-16)
export const SAUCERSWAP_V2_QUOTER: Record<string, string> = {
  mainnet: "0.0.3949424",
  testnet: "0.0.1390002",
};

// ── WHBAR ────────────────────────────────────────────────────────────

// WhbarHelper -- wrap/unwrap HBAR without direct WHBAR contract interaction
export const SAUCERSWAP_WHBAR_HELPER: Record<string, string> = {
  mainnet: "0.0.5808826",
  testnet: "0.0.5286055",
};

// WHBAR contract address (not the token ID -- the contract that manages wrapping)
export const SAUCERSWAP_WHBAR_CONTRACT: Record<string, string> = {
  mainnet: "0.0.1456985",
  testnet: "0.0.15057",
};

// ── Staking ──────────────────────────────────────────────────────────

export const SAUCERSWAP_MASTERCHEF: Record<string, string> = {
  mainnet: "0.0.1077627",
  testnet: "0.0.1179171",
};

export const SAUCE_TOKEN_ID: Record<string, string> = {
  mainnet: "0.0.731861",
  testnet: "0.0.1183558",
};

export const XSAUCE_TOKEN_ID: Record<string, string> = {
  mainnet: "0.0.1460200",
  testnet: "0.0.1418651",
};

// ── Fee Tiers ────────────────────────────────────────────────────────

// Common V2 fee tiers to probe when discovering pools (hundredths of a bip).
// Ordered by most common first for faster discovery.
// [C27-02] Added 1500 (0.15%) -- SaucerSwap V2 supports this custom tier
// not present in standard UniswapV3. Many WHBAR pairs use it.
export const V2_FEE_TIERS = [3000, 1500, 10000, 500, 100] as const;

// ── Infrastructure Endpoints ────────────────────────────────────────

export const MIRROR_NODES: Record<string, string> = {
  mainnet: "https://mainnet-public.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
};

// Hedera JSON-RPC Relay (HashIO) -- Standard Ethereum JSON-RPC interface.
// Supports eth_call which handles cross-contract calls reliably --
// unlike Mirror Node /api/v1/contracts/call simulation endpoint
// which often returns empty results for multi-hop view functions.
export const JSON_RPC_RELAY: Record<string, string> = {
  mainnet: "https://mainnet.hashio.io/api",
  testnet: "https://testnet.hashio.io/api",
};

// ── Getter Functions ────────────────────────────────────────────────

export function getSaucerSwapRouter(network: HederaNetwork, version: "v1" | "v2" = "v1"): string {
  if (version === "v2") return SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
  return SAUCERSWAP_V1_ROUTER[network] || SAUCERSWAP_V1_ROUTER.mainnet;
}

export function getSaucerSwapFactory(network: HederaNetwork, version: "v1" | "v2" = "v1"): string {
  if (version === "v2") return SAUCERSWAP_V2_FACTORY[network] || SAUCERSWAP_V2_FACTORY.mainnet;
  return SAUCERSWAP_V1_FACTORY[network] || SAUCERSWAP_V1_FACTORY.mainnet;
}

export function getRestrictedRouter(network: HederaNetwork): string {
  return RESTRICTED_ROUTER[network] || "0.0.0";
}

export function getV2NftManager(network: HederaNetwork): string {
  return SAUCERSWAP_V2_NFT_MANAGER[network] || SAUCERSWAP_V2_NFT_MANAGER.mainnet;
}

export function getWhbarHelper(network: HederaNetwork): string {
  return SAUCERSWAP_WHBAR_HELPER[network] || SAUCERSWAP_WHBAR_HELPER.mainnet;
}

// V1 RouterWithFee -- for fee-on-transfer tokens (not yet used in routing,
// but defined for future support when FOT tokens are added to the registry)
export function getRouterWithFee(network: HederaNetwork): string {
  return SAUCERSWAP_V1_ROUTER_WITH_FEE[network] || SAUCERSWAP_V1_ROUTER_WITH_FEE.mainnet;
}
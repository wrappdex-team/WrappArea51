/**
 * HTS System Contract Integration (0x167 / 0.0.359)
 *
 * Hedera Token Service precompile for EVM-based interaction with HTS tokens.
 * This module provides:
 *   - Batch token association for new users (single tx, all whitelisted tokens)
 *   - Token info queries via the precompile
 *   - EVM address <-> HTS ID conversion utilities
 *
 * Reference: https://docs.hedera.com/hedera/core-concepts/smart-contracts/supported-evm-tools
 * System contract address: 0x0000000000000000000000000000000000000167
 *
 * For WRAPpDEX AMM, all pool tokens are HTS fungible tokens. The precompile
 * allows Solidity-compatible interaction with token transfers, approvals,
 * and association without using Hedera's native SDK transaction types.
 */

import { log } from "./logger";

// ── HTS System Contract Address ─────────────────────────────────────
// Fixed precompile address on Hedera EVM (all networks).
export const HTS_PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000167";

// ── WHBAR Contract Address ──────────────────────────────────────────
// The canonical ERC-20 WHBAR wrapper contract on Hedera.
// Used for wrapping native HBAR into an ERC-20 compatible token for
// smart contract interactions (pool routing, approvals, etc.).
export const WHBAR_CONTRACT_ADDRESS = "0x000000000000000000000000000000000011F6bF";

// ── HTS ID <-> EVM Address Conversion ───────────────────────────────

export function htsIdToEvmAddress(htsId: string): string {
  if (htsId === "native") return "0x0000000000000000000000000000000000000000";
  const parts = htsId.split(".");
  const tokenNum = parseInt(parts[2], 10);
  return "0x" + tokenNum.toString(16).padStart(40, "0");
}

export function evmAddressToHtsId(evmAddr: string): string {
  const hex = evmAddr.replace("0x", "");
  const tokenNum = parseInt(hex, 16);
  return "0.0." + tokenNum;
}

export function accountIdToEvmAddress(accountId: string): string {
  const parts = accountId.split(".");
  const num = parseInt(parts[2], 10);
  return "0x" + num.toString(16).padStart(40, "0");
}

// ── Bridge Token Registry (Canonical HTS IDs) ──────────────────────
// Single source of truth for all bridge token HTS IDs, decimals, and
// EVM addresses used by the WRAPpDEX AMM.
//
// IMPORTANT: All decimals MUST be confirmed on HashScan mainnet before
// live trading. HashPort typically bridges ERC-20 tokens to 8 decimals
// but some tokens may preserve original decimals (e.g. 18 for WETH).

export interface BridgeToken {
  symbol: string;
  name: string;
  htsId: string;
  evmAddress: string;
  decimals: number;
  bridge: "HashPort" | "LayerZero" | "Circle" | "Tether" | "native";
  originalChain: string;
  /** SaucerSwap-listed token ID if different (for oracle price lookup) */
  saucerswapId?: string;
  /** CoinGecko ID for price feed */
  coingeckoId?: string;
}

export const BRIDGE_TOKEN_REGISTRY: BridgeToken[] = [
  // ── Routing Hub ───────────────────────────────────────────────────
  {
    symbol: "WHBAR", name: "Wrapped HBAR",
    htsId: "0.0.1456986", evmAddress: WHBAR_CONTRACT_ADDRESS,
    decimals: 8, bridge: "native", originalChain: "Hedera",
    coingeckoId: "hedera-hashgraph",
  },

  // ── Stablecoins ───────────────────────────────────────────────────
  {
    symbol: "USDC", name: "USD Coin (Native)",
    htsId: "0.0.456858", evmAddress: htsIdToEvmAddress("0.0.456858"),
    decimals: 6, bridge: "Circle", originalChain: "Hedera",
    coingeckoId: "usd-coin",
  },
  {
    symbol: "USDT", name: "Tether USD (Native)",
    htsId: "0.0.4291336", evmAddress: htsIdToEvmAddress("0.0.4291336"),
    decimals: 6, bridge: "Tether", originalChain: "Hedera",
    coingeckoId: "tether",
  },
  {
    symbol: "DAI", name: "Dai Stablecoin",
    htsId: "0.0.1055477", evmAddress: htsIdToEvmAddress("0.0.1055477"),
    decimals: 8, bridge: "HashPort", originalChain: "Ethereum",
    coingeckoId: "dai",
  },
  {
    symbol: "USDCh", name: "USDC (HashPort Bridge)",
    htsId: "0.0.1055459", evmAddress: htsIdToEvmAddress("0.0.1055459"),
    decimals: 6, bridge: "HashPort", originalChain: "Ethereum",
    coingeckoId: "usd-coin",
  },
  {
    symbol: "USDTh", name: "USDT (HashPort Bridge)",
    htsId: "0.0.1055472", evmAddress: htsIdToEvmAddress("0.0.1055472"),
    decimals: 6, bridge: "HashPort", originalChain: "Ethereum",
    coingeckoId: "tether",
  },

  // ── Major Wrapped Assets ──────────────────────────────────────────
  {
    symbol: "WBTC", name: "Wrapped Bitcoin",
    htsId: "0.0.1055483", evmAddress: htsIdToEvmAddress("0.0.1055483"),
    decimals: 8, bridge: "HashPort", originalChain: "Bitcoin",
    saucerswapId: "0.0.1969769", coingeckoId: "wrapped-bitcoin",
  },
  {
    symbol: "WETH", name: "Wrapped Ether",
    htsId: "0.0.541564", evmAddress: htsIdToEvmAddress("0.0.541564"),
    decimals: 18, bridge: "HashPort", originalChain: "Ethereum",
    saucerswapId: "0.0.1969757", coingeckoId: "weth",
  },
  {
    symbol: "LINK", name: "Chainlink",
    htsId: "0.0.1055495", evmAddress: htsIdToEvmAddress("0.0.1055495"),
    decimals: 8, bridge: "HashPort", originalChain: "Ethereum",
    saucerswapId: "0.0.1970030", coingeckoId: "chainlink",
  },
  {
    symbol: "AAVE", name: "Aave",
    htsId: "0.0.1055498", evmAddress: htsIdToEvmAddress("0.0.1055498"),
    decimals: 8, bridge: "HashPort", originalChain: "Ethereum",
    coingeckoId: "aave",
  },

  // ── Cross-Chain (LayerZero / BiT Global) ──────────────────────────
  {
    symbol: "WBNB", name: "Wrapped BNB",
    htsId: "0.0.1157005", evmAddress: htsIdToEvmAddress("0.0.1157005"),
    decimals: 8, bridge: "LayerZero", originalChain: "BNB Chain",
    coingeckoId: "binancecoin",
  },
  {
    symbol: "WAVAX", name: "Wrapped AVAX",
    htsId: "0.0.1157020", evmAddress: htsIdToEvmAddress("0.0.1157020"),
    decimals: 8, bridge: "LayerZero", originalChain: "Avalanche",
    coingeckoId: "avalanche-2",
  },
  {
    symbol: "WMATIC", name: "Wrapped MATIC",
    htsId: "0.0.540318", evmAddress: htsIdToEvmAddress("0.0.540318"),
    decimals: 8, bridge: "HashPort", originalChain: "Polygon",
    coingeckoId: "matic-network",
  },
];

// Lookup maps
export const BRIDGE_TOKEN_BY_SYMBOL = new Map(BRIDGE_TOKEN_REGISTRY.map(t => [t.symbol, t]));
export const BRIDGE_TOKEN_BY_HTS_ID = new Map(BRIDGE_TOKEN_REGISTRY.map(t => [t.htsId, t]));
export const BRIDGE_TOKEN_BY_EVM = new Map(BRIDGE_TOKEN_REGISTRY.map(t => [t.evmAddress.toLowerCase(), t]));

// ── AMM Pair Generation ─────────────────────────────────────────────
// Generate all valid trading pairs from the bridge token registry.
// Every token can pair with WHBAR (routing hub) and USDC (stablecoin anchor).
// Direct pairs between major assets are also supported.

export interface TradingPair {
  tokenA: BridgeToken;
  tokenB: BridgeToken;
  poolId: string; // Deterministic: sl-{lower}-{higher}
}

export function generateTradingPairs(): TradingPair[] {
  const pairs: TradingPair[] = [];
  const seen = new Set<string>();
  const tier1 = BRIDGE_TOKEN_REGISTRY.filter(t =>
    !["USDCh", "USDTh", "WMATIC"].includes(t.symbol)
  );

  for (let i = 0; i < tier1.length; i++) {
    for (let j = i + 1; j < tier1.length; j++) {
      const a = tier1[i];
      const b = tier1[j];
      const [lo, hi] = [a.symbol, b.symbol].sort();
      const key = `${lo}-${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        tokenA: a, tokenB: b,
        poolId: `sl-${lo.toLowerCase()}-${hi.toLowerCase()}`,
      });
    }
  }
  return pairs;
}

// ── HTS Precompile Function Selectors ───────────────────────────────
// These are the Solidity function selectors for the HTS system contract.
// Used for encoding EVM calls to the precompile.

export const HTS_SELECTORS = {
  // Token association
  associateToken:       "0x49146bde", // associateToken(address account, address token)
  associateTokens:      "0x2e63879b", // associateTokens(address account, address[] tokens)
  dissociateToken:      "0x78b63918", // dissociateToken(address account, address token)
  dissociateTokens:     "0x78b63918", // dissociateTokens(address account, address[] tokens)

  // Token transfer
  transferToken:        "0xeca36917", // transferToken(address token, address from, address to, int64 amount)
  transferTokens:       "0x82bba493", // transferTokens(address token, address[] from, int64[] fromAmounts, address[] to, int64[] toAmounts)
  transferNFT:          "0x5cfc9011", // transferNFT(address token, address from, address to, int64 serialNumber)

  // Token info
  getTokenInfo:         "0x1f69565f", // getTokenInfo(address token)
  getFungibleTokenInfo: "0x3f28a19b", // getFungibleTokenInfo(address token)
  isToken:              "0x19f37361", // isToken(address token)

  // Token create (for LP tokens — future)
  createFungibleToken:  "0x7812a04b", // createFungibleToken(...)
  mintToken:            "0x278c0e71", // mintToken(address token, int64 amount, bytes[] metadata)
  burnToken:            "0xacb9cff9", // burnToken(address token, int64 amount, int64[] serialNumbers)

  // Approval
  approve:              "0xe1f21c67", // approve(address token, address spender, uint256 amount)
  allowance:            "0x927da105", // allowance(address token, address owner, address spender)
} as const;

// ── ABI Encoding Helpers ────────────────────────────────────────────

function encodeAddress(addr: string): string {
  return addr.replace("0x", "").padStart(64, "0");
}

function encodeUint256(val: bigint | number): string {
  return BigInt(val).toString(16).padStart(64, "0");
}

/**
 * Encode an associateTokens(address, address[]) call for the HTS precompile.
 * This allows a user to associate with multiple HTS tokens in a single
 * EVM transaction, eliminating the per-token association friction.
 */
export function encodeBatchAssociate(accountEvmAddress: string, tokenEvmAddresses: string[]): string {
  const selector = HTS_SELECTORS.associateTokens;
  // ABI: associateTokens(address account, address[] memory tokens)
  // Head: account (32 bytes) + offset to tokens array (32 bytes)
  // Tokens array: length (32 bytes) + N addresses (32 bytes each)
  const account = encodeAddress(accountEvmAddress);
  const offset = encodeUint256(64n); // offset to dynamic array = 2 * 32
  const length = encodeUint256(BigInt(tokenEvmAddresses.length));
  const addresses = tokenEvmAddresses.map(a => encodeAddress(a)).join("");

  return selector + account + offset + length + addresses;
}

/**
 * Encode a transferToken(address, address, address, int64) call.
 * Used for HTS token transfers via the precompile.
 */
export function encodeTransferToken(
  tokenEvmAddress: string,
  fromEvmAddress: string,
  toEvmAddress: string,
  amount: bigint,
): string {
  const selector = HTS_SELECTORS.transferToken;
  const token = encodeAddress(tokenEvmAddress);
  const from = encodeAddress(fromEvmAddress);
  const to = encodeAddress(toEvmAddress);
  // int64 amount — encode as uint256 (positive values are the same)
  const amountHex = encodeUint256(amount);

  return selector + token + from + to + amountHex;
}

/**
 * Encode an approve(address, address, uint256) call for the HTS precompile.
 * Grants a spender approval to transfer tokens on behalf of the owner.
 */
export function encodeApprove(
  tokenEvmAddress: string,
  spenderEvmAddress: string,
  amount: bigint,
): string {
  const selector = HTS_SELECTORS.approve;
  const token = encodeAddress(tokenEvmAddress);
  const spender = encodeAddress(spenderEvmAddress);
  const amountHex = encodeUint256(amount);

  return selector + token + spender + amountHex;
}

// ── Token Association Status Check (batch) ──────────────────────────

const MIRROR_NODE = "https://mainnet-public.mirrornode.hedera.com";

/**
 * Check which of the given token IDs are NOT yet associated with an account.
 * Returns the list of unassociated token IDs.
 */
export async function getUnassociatedTokens(
  accountId: string,
  tokenIds: string[],
): Promise<string[]> {
  try {
    // Fetch all token associations for the account
    const response = await fetch(
      `${MIRROR_NODE}/api/v1/accounts/${accountId}/tokens?limit=100`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) {
      log.info("HTS", `Mirror Node HTTP ${response.status} checking associations`);
      return tokenIds; // Assume all unassociated on error
    }

    const data = await response.json();
    const associatedIds = new Set<string>();
    if (Array.isArray(data.tokens)) {
      for (const t of data.tokens) {
        associatedIds.add(t.token_id);
      }
    }

    return tokenIds.filter(id => !associatedIds.has(id));
  } catch (err) {
    log.info("HTS", `Association check failed: ${(err as Error).message}`);
    return tokenIds; // Assume all unassociated on error
  }
}

/**
 * Get the list of all AMM-whitelisted token IDs that a user needs to
 * associate with before trading. Returns only unassociated tokens.
 */
export async function getRequiredAssociations(accountId: string): Promise<BridgeToken[]> {
  const allIds = BRIDGE_TOKEN_REGISTRY.map(t => t.htsId);
  const unassociated = await getUnassociatedTokens(accountId, allIds);
  return unassociated.map(id => BRIDGE_TOKEN_BY_HTS_ID.get(id)!).filter(Boolean);
}

// ── Token Decimal Verification ──────────────────────────────────────
// Query Mirror Node to verify on-chain decimals match our registry.
// Critical safety check: wrong decimals = wrong swap amounts.

export interface DecimalVerification {
  tokenId: string;
  symbol: string;
  registryDecimals: number;
  onChainDecimals: number | null;
  match: boolean;
  error?: string;
}

export async function verifyTokenDecimals(): Promise<DecimalVerification[]> {
  const results: DecimalVerification[] = [];

  for (const token of BRIDGE_TOKEN_REGISTRY) {
    try {
      const response = await fetch(
        `${MIRROR_NODE}/api/v1/tokens/${token.htsId}`,
        { signal: AbortSignal.timeout(8000) },
      );

      if (!response.ok) {
        results.push({
          tokenId: token.htsId, symbol: token.symbol,
          registryDecimals: token.decimals, onChainDecimals: null,
          match: false, error: `HTTP ${response.status}`,
        });
        continue;
      }

      const data = await response.json();
      const onChainDecimals = parseInt(data.decimals, 10);

      results.push({
        tokenId: token.htsId, symbol: token.symbol,
        registryDecimals: token.decimals, onChainDecimals,
        match: token.decimals === onChainDecimals,
      });

      if (token.decimals !== onChainDecimals) {
        log.info("HTS",
          `DECIMAL MISMATCH: ${token.symbol} (${token.htsId}) — ` +
          `registry=${token.decimals}, on-chain=${onChainDecimals}. ` +
          `UPDATE amm.ts, saucerswap.ts, smart-liquidity.ts, Wallet.tsx!`
        );
      }
    } catch (err) {
      results.push({
        tokenId: token.htsId, symbol: token.symbol,
        registryDecimals: token.decimals, onChainDecimals: null,
        match: false, error: (err as Error).message,
      });
    }
  }

  return results;
}

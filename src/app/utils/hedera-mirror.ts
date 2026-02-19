/**
 * Hedera Mirror Node Token Data Fetcher
 *
 * Fetches real on-chain token metadata (decimals, total supply, treasury
 * account, name, symbol) from the Hedera mainnet/testnet Mirror Node REST API.
 *
 * This is used to hydrate fallback/hardcoded token data across the app
 * (smart-liquidity.ts, saucerswap.ts) with verified on-chain
 * data so we never show fabricated token IDs or supply numbers.
 *
 * Mirror Node API docs: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 */

import type { HederaNetwork } from "./hedera";
import { log } from "./logger";

// ── Mirror Node Endpoints ──────────────────────────────────────────

const MIRROR_NODES: Record<HederaNetwork, string> = {
  mainnet: "https://mainnet-public.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
};

// ── Types ──────────────────────────────────────────────────────────

export interface MirrorNodeTokenInfo {
  tokenId: string;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: string;       // raw units (no decimal adjustment)
  maxSupply: string;
  treasuryAccountId: string;
  type: "FUNGIBLE_COMMON" | "NON_FUNGIBLE_UNIQUE";
  deleted: boolean;
  paused: boolean;
  createdTimestamp: string;
  supplyType: string;        // "INFINITE" or "FINITE"
}

// ── Cache ──────────────────────────────────────────────────────────

const _tokenCache = new Map<string, { data: MirrorNodeTokenInfo; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Single Token Fetch ─────────────────────────────────────────────

/**
 * Fetch a single token's on-chain data from the Hedera Mirror Node.
 * Returns null if the token doesn't exist or the API is unreachable.
 */
export async function fetchTokenFromMirrorNode(
  tokenId: string,
  network: HederaNetwork = "mainnet",
): Promise<MirrorNodeTokenInfo | null> {
  // Check cache
  const cached = _tokenCache.get(`${network}:${tokenId}`);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const baseUrl = MIRROR_NODES[network];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${baseUrl}/api/v1/tokens/${tokenId}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn("MirrorNode", `Token ${tokenId} fetch failed: HTTP ${res.status}`);
      return null;
    }

    const raw = await res.json();

    const info: MirrorNodeTokenInfo = {
      tokenId: raw.token_id ?? tokenId,
      symbol: raw.symbol ?? "",
      name: raw.name ?? "",
      decimals: parseInt(raw.decimals ?? "0", 10),
      totalSupply: raw.total_supply ?? "0",
      maxSupply: raw.max_supply ?? "0",
      treasuryAccountId: raw.treasury_account_id ?? "",
      type: raw.type ?? "FUNGIBLE_COMMON",
      deleted: raw.deleted ?? false,
      paused: raw.pause_status === "PAUSED",
      createdTimestamp: raw.created_timestamp ?? "",
      supplyType: raw.supply_type ?? "INFINITE",
    };

    _tokenCache.set(`${network}:${tokenId}`, { data: info, fetchedAt: Date.now() });
    return info;
  } catch (err) {
    log.warn("MirrorNode", `Token ${tokenId} fetch error`, (err as Error).message);
    return null;
  }
}

// ── Batch Token Fetch ──────────────────────────────────────────────

/**
 * Fetch multiple tokens in parallel from the Mirror Node.
 * Returns a map of tokenId → MirrorNodeTokenInfo.
 * Tokens that fail to fetch are omitted from the result.
 */
export async function fetchMultipleTokens(
  tokenIds: string[],
  network: HederaNetwork = "mainnet",
): Promise<Map<string, MirrorNodeTokenInfo>> {
  const results = new Map<string, MirrorNodeTokenInfo>();

  const fetches = tokenIds.map(async (id) => {
    const info = await fetchTokenFromMirrorNode(id, network);
    if (info) results.set(id, info);
  });

  await Promise.allSettled(fetches);

  log.info("MirrorNode", `Fetched ${results.size}/${tokenIds.length} tokens from ${network} Mirror Node`);

  return results;
}

// ── Cache Management ───────────────────────────────────────────────

/** Clear the token info cache (e.g., on network switch) */
export function clearTokenCache(): void {
  _tokenCache.clear();
}
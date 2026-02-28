// ═══════════════════════════════════════════════════════════════════════
// SAUCERSWAP QUOTE ENGINE  [C46]
// ═══════════════════════════════════════════════════════════════════════
//
// Server-side quote fetching with parallel multi-strategy racing.
// All strategies run concurrently via Promise.allSettled() and the
// best quote is selected by confidence ranking.
//
//   Strategies (all run in parallel):
//     1. V1 Router getAmountsOut() via JSON-RPC (+ Mirror Node fallback)
//     1b. V1 Router multi-hop via WHBAR
//     2. V2 QuoterV2 quoteExactInputSingle() via JSON-RPC (+ Mirror fallback)
//     3. V2 QuoterV2 quoteExactInput() 2-hop via JSON-RPC
//     3b. [STEP11] V2 QuoterV2 quoteExactInput() 3-hop (dynamic pairs)
//     4. SaucerSwap REST API /swap/quote
//     5. Price-based estimation fallback
//   Plus: parallel multi-route probing (2-hop + 3-hop) via intermediaries
//   [STEP12] Intermediaries are now discovered dynamically from pool graph
//   connectivity, with hardcoded lists as fallback.
//
//   Confidence ranking:  router > quoter > api > estimate
//
//   Quote cache: 10s TTL for same pair+amount combo.
//
// NOTE: This module imports core utilities from
// saucerswap-engine.ts.  It is registered separately in index.tsx.
// ════════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import {
  getClientIp,
  isRateLimited,
  ROUTE_PREFIX,
} from "./shared.ts";
import {
  htsIdToEvmAddress,
  ssFetchJsonRpc,
  ssMirrorContractCall,
  ssFetchSaucerSwapApi,
  ssResolveEvmAddress,
  ssDetectPoolVersion,
  ensureV2PoolList,
  ensureV1PoolList,
  type PoolVersionInfo,
} from "./saucerswap-engine.ts";

// ═════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════

/** V1 Router — for getAmountsOut() view function. */
const V1_ROUTER_IDS: Record<string, string> = {
  mainnet: "0.0.3045981",  // SaucerSwap V1 RouterV3
  testnet: "0.0.19264",
};

/** V2 QuoterV2 — for quoteExactInputSingle/quoteExactInput. */
const V2_QUOTER_IDS: Record<string, string> = {
  mainnet: "0.0.3949424",  // SaucerSwap V2 QuoterV2 (SEC-16)
  testnet: "0.0.1390002",
};

/** WHBAR Token HTS ID — used as intermediary for multi-hop. */
const WHBAR_HTS_ID = "0.0.1456986";

// ════════════════════════════════════════════════════════════════════
// [C99] TOKEN ALIAS MAP — V2 ERC20Wrapper Resolution
// ═════════════════════════════════════════════════════════════════════
//
// SaucerSwap V2 pools use ERC20Wrapper versions of HashPort bridge tokens.
// These wrapper tokens have DIFFERENT HTS IDs (and therefore different EVM
// addresses) than the canonical bridge tokens users hold in their wallets.
//
// Example: LINK
//   Canonical (user holds):  0.0.1055495  → EVM 0x...101917
//   V2 Wrapper (pool uses):  0.0.10152778 → EVM 0x...9af70a
//
// When calling V2 QuoterV2 or V2 SwapRouter, we MUST use the wrapper EVM
// address. V1 Router uses canonical addresses (V1 Factory pairs are
// registered with canonical HTS IDs).
//
// This map is the server-side equivalent of client-side `saucerswapAliasId`.
// ═════════════════════════════════════════════════════════════════════

const TOKEN_ALIAS_MAP: Record<string, string> = {
  // [LIQUIDITY-FIX] WETH aliases REMOVED — 0.0.9770617 is the canonical high-liquidity token
  // Old aliases (0.0.541564, 0.0.1969708) were low-liquidity and risked loss of pair value
};

/**
 * [C99] Request-scoped alias overlay from client hints.
 *
 * When the client sends `inputAliasId` / `outputAliasId` query params,
 * these are registered here BEFORE strategy execution and cleared AFTER.
 * This lets the client's dynamic token registry (which includes aliases
 * discovered via the SaucerSwap /tokens API reconciliation) extend the
 * server's hardcoded TOKEN_ALIAS_MAP without mutating it.
 *
 * Safe for single-threaded Deno — ssQuote() is awaited sequentially.
 */
let _requestAliases: Map<string, string> | null = null;

/**
 * [C99] Resolve a token HTS ID to its V2 alias if one exists.
 * [C100 Step 4] Updated: checks dynamic API-discovered aliases between
 * client hints and the hardcoded fallback. This makes the server
 * self-healing — new V2 ERC20Wrappers are discovered automatically.
 *
 * Resolution priority:
 *   1. Request-scoped client hints     (per-request, highest fidelity)
 *   2. Dynamic API-discovered aliases  (self-healing, refreshed 5 min)
 *   3. Hardcoded TOKEN_ALIAS_MAP       (fallback when API unavailable)
 *   4. Original HTS ID                 (no alias known)
 */
function resolveV2AliasId(htsId: string): string {
  // 1. Request-scoped client hints (per-request from client token registry)
  if (_requestAliases?.has(htsId)) return _requestAliases.get(htsId)!;
  // 2. Dynamic API-discovered aliases (self-healing, refreshed every 5 min)
  if (_dynamicAliasMap?.has(htsId)) return _dynamicAliasMap.get(htsId)!;
  // 3. Hardcoded server-side map (fallback when SaucerSwap API is unavailable)
  return TOKEN_ALIAS_MAP[htsId] || htsId;
}

/**
 * [C99] Convert an HTS ID to EVM address, using V2 alias if available.
 * Use this for ALL V2 QuoterV2 / SwapRouter calls.
 * V1 Router calls should use plain htsIdToEvmAddress() (canonical).
 */
function resolveV2Evm(htsId: string): string {
  return htsIdToEvmAddress(resolveV2AliasId(htsId));
}

// [C52] Full intermediary candidate list — tested in parallel for Token→Token
// pairs with no direct pool. Ordered by typical liquidity depth.
// [C90] Expanded: added common bridge tokens (WBNB, WETH, WBTC, DAI) that
// serve as secondary liquidity hubs for exotic pairs.
// [C99] Fixed: corrected HTS IDs to match client token registry, added
// v2AliasId for bridge tokens whose V2 pools use wrapper addresses.
// [STEP7] Expanded from 10 → 17 tokens: added PACK, DOVU, KARATE, GIB,
// GRELF, HST, DAI — all have >$25k TVL pools on SaucerSwap. More
// intermediaries = more routing paths discovered = better output amounts.
// Server runs all probes in parallel so latency is unchanged.
const INTERMEDIARY_TOKENS: { htsId: string; symbol: string; v2AliasId?: string }[] = [
  // ── Primary liquidity hubs ──
  { htsId: "0.0.1456986", symbol: "WHBAR" },
  { htsId: "0.0.456858",  symbol: "USDC" },
  { htsId: "0.0.1055472", symbol: "USDT" },
  { htsId: "0.0.731861",  symbol: "SAUCE" },
  { htsId: "0.0.834116",  symbol: "HBARX" },
  { htsId: "0.0.1055459", symbol: "USDCh" },
  // ── Cross-chain bridge tokens ──
  // [LIQUIDITY-FIX] Updated to high-liquidity WETH 0.0.9770617 ($1.8M TVL, SaucerSwap's largest pool)
  { htsId: "0.0.9770617", symbol: "WETH" },
  // [C99] Fixed WBTC: was 0.0.1055482 (wrong ID), correct is 0.0.1055483
  { htsId: "0.0.1055483", symbol: "WBTC" },
  { htsId: "0.0.1157005", symbol: "WBNB" },
  // [C99] Fixed LINK: was 0.0.1055480 (wrong ID), correct is 0.0.1055495
  { htsId: "0.0.1055495", symbol: "LINK",   v2AliasId: "0.0.10152778" },
  { htsId: "0.0.1055477", symbol: "DAI" },
  // ── [STEP7] Ecosystem tokens with >$25k TVL pools ──
  { htsId: "0.0.4794920", symbol: "PACK" },    // HashPack — V2-only, 6 decimals
  { htsId: "0.0.3716059", symbol: "DOVU" },    // DOVU — V2-only, 8 decimals
  { htsId: "0.0.2283230", symbol: "KARATE" },  // Karate Combat — V2-only, 8 decimals
  { htsId: "0.0.7893707", symbol: "GIB" },     // GIB — 8 decimals
  { htsId: "0.0.1159074", symbol: "GRELF" },   // GRELF — 8 decimals
  { htsId: "0.0.968069",  symbol: "HST" },     // HeadStarter — 8 decimals
];

// ═════════════════════════════════════════════════════════════════════
// [STEP11] 3-HOP V2 INTERMEDIARY PAIRS
// ═════════════════════════════════════════════════════════════════════
//
// Top intermediary PAIRS for 3-hop V2 routing: Token → midA → midB → Token
// This is how SaucerSwap.finance discovers routes "from a multitude of pools"
// — by testing 2-hop AND 3-hop paths through major liquidity hubs.
//
// 3-hop catches routes where no direct or 2-hop path exists, e.g.:
//   KARATE → SAUCE → WHBAR → USDC  (KARATE has V2 pool with SAUCE only)
//   DOVU → WHBAR → USDC → WBTC     (cross-chain via stablecoin bridge)
//
// Each pair generates probes across multiple fee combos, validated by
// QuoterV2.quoteExactInput() with a 4-token packed path.
//
// Ordered by expected liquidity depth. 15 pairs × 5 fee combos = 75 probes,
// all run in parallel with existing 2-hop probes — latency unchanged.
// ═════════════════════════════════════════════════════════════════════

const THREE_HOP_PAIRS: { midA: string; midB: string; symbolA: string; symbolB: string }[] = [
  // ── Primary: WHBAR ↔ stablecoin hub (most common 3-hop pattern) ──
  { midA: "0.0.456858",  midB: "0.0.1456986", symbolA: "USDC",  symbolB: "WHBAR" },
  { midA: "0.0.1456986", midB: "0.0.456858",  symbolA: "WHBAR", symbolB: "USDC" },
  // ── SAUCE ↔ WHBAR hub ──
  { midA: "0.0.731861",  midB: "0.0.1456986", symbolA: "SAUCE", symbolB: "WHBAR" },
  { midA: "0.0.1456986", midB: "0.0.731861",  symbolA: "WHBAR", symbolB: "SAUCE" },
  // ── USDT ↔ WHBAR hub ──
  { midA: "0.0.1055472", midB: "0.0.1456986", symbolA: "USDT",  symbolB: "WHBAR" },
  { midA: "0.0.1456986", midB: "0.0.1055472", symbolA: "WHBAR", symbolB: "USDT" },
  // ── HBARX ↔ WHBAR ──
  { midA: "0.0.834116",  midB: "0.0.1456986", symbolA: "HBARX", symbolB: "WHBAR" },
  { midA: "0.0.1456986", midB: "0.0.834116",  symbolA: "WHBAR", symbolB: "HBARX" },
  // ── USDC ↔ SAUCE cross-hub ──
  { midA: "0.0.456858",  midB: "0.0.731861",  symbolA: "USDC",  symbolB: "SAUCE" },
  { midA: "0.0.731861",  midB: "0.0.456858",  symbolA: "SAUCE", symbolB: "USDC" },
  // ── WETH ↔ WHBAR (cross-chain) ──
  { midA: "0.0.9770617", midB: "0.0.1456986", symbolA: "WETH",  symbolB: "WHBAR" },
  { midA: "0.0.1456986", midB: "0.0.9770617", symbolA: "WHBAR", symbolB: "WETH" },
  // ── Stablecoin bridge: USDC ↔ USDT ──
  { midA: "0.0.456858",  midB: "0.0.1055472", symbolA: "USDC",  symbolB: "USDT" },
  { midA: "0.0.1055472", midB: "0.0.456858",  symbolA: "USDT",  symbolB: "USDC" },
  // ── USDCh ↔ WHBAR ──
  { midA: "0.0.1055459", midB: "0.0.1456986", symbolA: "USDCh", symbolB: "WHBAR" },
];

/**
 * [STEP11] Fee tier combos for 3-hop paths: [fee1, fee2, fee3].
 * fee1 = input→midA, fee2 = midA→midB, fee3 = midB→output.
 * Kept to 5 combos per pair (vs 13 for 2-hop) since each 3-hop probe
 * is more expensive on-chain. Covers all common SaucerSwap pairings.
 */
const THREE_HOP_FEE_COMBOS: [number, number, number][] = [
  [3000, 3000, 3000],   // Standard fee across all hops
  [3000, 1500, 3000],   // Tight middle hop (major pair)
  [1500, 3000, 1500],   // Tight edges (exotic middle)
  [3000, 3000, 1500],   // Tight output hop
  [1500, 1500, 1500],   // All tight (blue-chip path)
];

/**
 * [STEP11] Higher gas for 3-hop QuoterV2 calls.
 * Each hop involves a cross-contract Pool.swap simulation (~1.5M gas each).
 * 3 hops = ~4.5M gas minimum. Use 5M for safety margin.
 */
const GAS_HEX_3HOP = "0x" + (5_000_000).toString(16);

// ═════════════════════════════════════════════════════════════════════
// [C100 Step 3] V2-ONLY TOKEN REGISTRY
// ═════════════════════════════════════════════════════════════════════
//
// Tokens known to exist EXCLUSIVELY on SaucerSwap V2 (no V1 AMM pairs).
// V1 Router getAmountsOut() will always revert for these tokens, but each
// reverted RPC call still takes 2–12s on Hedera's relay. By maintaining
// this set, V1 strategies bail instantly (O(1) lookup) instead of burning
// network round-trips that are guaranteed to fail.
//
// How to verify: call V1 Factory.getPair(tokenA, WHBAR) — if it returns
// address(0), the token has no V1 pair with the primary liquidity hub.
// If it also has no V1 pair with USDC/SAUCE, it's V2-only.
//
// Extend this set when new V2-only tokens are added to the platform.
// ═════════════════════════════════════════════════════════════════════

const V2_ONLY_TOKENS: Set<string> = new Set([
  "0.0.4794920",   // PACK  — HashPack utility token, V2-only pools
  "0.0.2283230",   // KARATE — V2-only pools
  "0.0.3716059",   // DOVU  — V2-only pools
]);

/**
 * [C100 Step 3] Check if a token has NO V1 liquidity (V2-only).
 * V1 strategies (Router getAmountsOut) should bail immediately for these tokens
 * to avoid wasting 2–12s per RPC call on guaranteed reverts.
 */
function isV2OnlyToken(htsId: string): boolean {
  return V2_ONLY_TOKENS.has(htsId);
}

/**
 * [C100 Step 3] V1-specific RPC timeout.
 * V1 reverts are fast on Hedera (~2-3s), but the relay can delay up to 12s.
 * This tighter ceiling prevents V1 probes from dominating overall quote latency
 * for tokens that DO have V1 pairs but the pair lookup is slow.
 */
const V1_RPC_TIMEOUT_MS = 5_000;

// ═════════════════════════════════════════════════════════════════════
// [C100 Step 4] DYNAMIC ALIAS DISCOVERY FROM SAUCERSWAP /tokens API
// ═════════════════════════════════════════════════════════════════════
//
// Makes the server self-healing: when SaucerSwap adds a new V2
// ERC20Wrapper for any bridge token, the next /tokens fetch discovers
// it automatically. No code changes needed.
//
// Discovery logic:
//   1. Fetch /tokens from SaucerSwap API (shared cache with prices)
//   2. Group tokens by normalized symbol (case-insensitive)
//   3. For BRIDGE_TOKEN_SYMBOLS with 2+ entries per symbol:
//      • Lowest entity number = canonical (original bridge token)
//      • Highest entity number = V2 ERC20Wrapper (created later)
//      • Map: canonical → alias
//   4. Cache for 5 minutes (same TTL as prices/token list)
//
// Resolution priority for resolveV2AliasId():
//   1. Request-scoped client hints     (per-request, highest fidelity)
//   2. Dynamic API-discovered aliases  (self-healing, refreshed 5 min)
//   3. Hardcoded TOKEN_ALIAS_MAP       (fallback when API unavailable)
//   4. Original HTS ID                 (no alias known)
// ═════════════════════════════════════════════════════════════════════

/**
 * Bridge token symbols known to potentially have V2 ERC20Wrapper aliases.
 * The /tokens API is scanned for symbols in this set — when multiple HTS IDs
 * share the same symbol, the lowest entity number is canonical (original
 * bridge token from HashPort/Axelar) and the highest is the V2 wrapper.
 *
 * Intentionally broad: including a symbol that doesn't yet have a wrapper
 * costs nothing (API scan skips it). Not including a symbol that DOES have
 * a wrapper means it won't be auto-discovered until added here.
 */
const BRIDGE_TOKEN_SYMBOLS: Set<string> = new Set([
  "WBTC", "WETH", "LINK", "AAVE", "UNI", "USDT", "USDC",
  "WBNB", "DAI", "MATIC", "WFTM", "WAVAX", "CRV", "SUSHI",
  "YFI", "COMP", "MKR", "SNX", "GRT", "FXS",
]);

/** Dynamic alias map: canonical HTS ID → V2 wrapper HTS ID. */
let _dynamicAliasMap: Map<string, string> | null = null;
let _dynamicAliasMapTs = 0;

/** Shared raw token data from SaucerSwap /tokens API. */
let _rawTokenData: any[] | null = null;
let _rawTokenDataTs = 0;

/** Cache TTL for dynamic alias map and raw token data: 5 minutes. */
const DYNAMIC_ALIAS_TTL_MS = 300_000;

/** Parse entity number from HTS ID: "0.0.1055483" → 1055483 */
function parseEntityNum(htsId: string): number {
  const parts = htsId.split(".");
  return parseInt(parts[parts.length - 1] || "0", 10);
}

/**
 * [C100 Step 4] Shared raw token data cache.
 *
 * Both `ensureTokenPrices()` and `ensureDynamicAliasMap()` need the
 * same /tokens API response. This shared cache ensures we make at most
 * ONE API call per 5-minute window, not two.
 */
async function ensureRawTokenData(): Promise<any[]> {
  if (_rawTokenData && Date.now() - _rawTokenDataTs < DYNAMIC_ALIAS_TTL_MS) {
    return _rawTokenData;
  }
  const data = await ssFetchSaucerSwapApi("/tokens");
  if (!data) return _rawTokenData || [];
  const tokens: any[] = Array.isArray(data) ? data : Object.values(data);
  _rawTokenData = tokens;
  _rawTokenDataTs = Date.now();
  return tokens;
}

/**
 * [C100 Step 4] Build canonical → V2 alias map from live SaucerSwap API.
 *
 * Scans the /tokens response for bridge token symbols with multiple HTS IDs.
 * For each such group, maps the lowest entity number (canonical bridge token)
 * to the highest (V2 ERC20Wrapper).
 *
 * Also logs non-bridge symbols with multiple IDs for diagnostic review
 * (potential new bridge tokens to add to BRIDGE_TOKEN_SYMBOLS).
 */
async function ensureDynamicAliasMap(): Promise<Map<string, string>> {
  if (_dynamicAliasMap && Date.now() - _dynamicAliasMapTs < DYNAMIC_ALIAS_TTL_MS) {
    return _dynamicAliasMap;
  }

  try {
    const tokens = await ensureRawTokenData();
    if (tokens.length === 0) {
      console.log("[SS-Quote] [C100-S4] Dynamic alias: no token data, using hardcoded fallback");
      return _dynamicAliasMap || new Map();
    }

    // Group tokens by normalized symbol
    const bySymbol = new Map<string, { id: string; entityNum: number }[]>();
    for (const t of tokens) {
      const sym = (t.symbol || "").toUpperCase().trim();
      const id = t.id || t.tokenId || t.token_id || "";
      if (!sym || !id || !id.startsWith("0.0.")) continue;

      if (!bySymbol.has(sym)) bySymbol.set(sym, []);
      bySymbol.get(sym)!.push({ id, entityNum: parseEntityNum(id) });
    }

    const aliasMap = new Map<string, string>();

    for (const [symbol, entries] of bySymbol) {
      if (entries.length < 2) continue;

      // Sort by entity number ascending — lowest = canonical (created first)
      entries.sort((a, b) => a.entityNum - b.entityNum);

      const canonical = entries[0];
      const alias = entries[entries.length - 1];
      if (canonical.id === alias.id) continue;

      if (BRIDGE_TOKEN_SYMBOLS.has(symbol)) {
        // Known bridge symbol — auto-discover V2 wrapper
        aliasMap.set(canonical.id, alias.id);
        // Only log when the discovered alias differs from the hardcoded one
        if (TOKEN_ALIAS_MAP[canonical.id] !== alias.id) {
          console.log(`[SS-Quote] [C100-S4] NEW dynamic alias: ${symbol} ${canonical.id} → ${alias.id}`);
        }
      } else if (entries.length >= 2) {
        // Non-bridge symbol with multiple IDs — log for diagnostics.
        // This helps operators discover new bridge tokens that need
        // adding to BRIDGE_TOKEN_SYMBOLS.
        console.log(`[SS-Quote] [C100-S4] Multi-ID symbol (not bridge): ${symbol} → ` +
          entries.map(e => e.id).join(", "));
      }
    }

    _dynamicAliasMap = aliasMap;
    _dynamicAliasMapTs = Date.now();
    console.log(`[SS-Quote] [C100-S4] Dynamic alias map: ${aliasMap.size} pairs from ${tokens.length} API tokens`);
    return aliasMap;
  } catch (err: any) {
    console.log(`[SS-Quote] [C100-S4] Dynamic alias error: ${err?.message || err}`);
    return _dynamicAliasMap || new Map();
  }
}

// ═════════════════════════════════════════════════════════════════════
// [STEP12] SERVER-SIDE POOL GRAPH — Dynamic Intermediary Discovery
// ═════════════════════════════════════════════════════════════════════
//
// Builds a lightweight connectivity graph from SaucerSwap V2+V1 pool
// APIs (shared caches from saucerswap-engine.ts). Ranks tokens by
// pool edge count to auto-discover the best intermediary candidates.
//
// Advantages over the hardcoded INTERMEDIARY_TOKENS list:
//   - Auto-discovers new liquidity hubs when SaucerSwap adds pools
//   - Adapts to liquidity migration (e.g., token X loses all pools)
//   - No code changes needed when pool landscape changes
//
// The hardcoded list is retained as a fallback when the API is
// unavailable. Refresh every 5 minutes (same as pool list cache).
// ═════════════════════════════════════════════════════════════════════

interface ServerPoolGraph {
  /** Total edges (v1+v2) per token HTS ID */
  connectivity: Map<string, number>;
  /** Number of V1 edges per token (0 = V2-only) */
  v1Edges: Map<string, number>;
  /** Number of V2 edges per token */
  v2Edges: Map<string, number>;
  /** Token symbol lookup: HTS ID → symbol */
  symbols: Map<string, string>;
  /** Ordered list: top tokens by connectivity, descending */
  ranked: { htsId: string; symbol: string; edges: number; v2Only: boolean }[];
  /** Timestamp of last build */
  ts: number;
}

let _serverGraph: ServerPoolGraph | null = null;
const SERVER_GRAPH_TTL_MS = 300_000; // 5 min

/**
 * [STEP12] Build or return cached server-side pool graph.
 *
 * Parses V2+V1 pool lists from saucerswap-engine.ts (shared cache)
 * and counts edges per token. Also integrates symbol data from the
 * /tokens API (shared via ensureRawTokenData).
 *
 * The graph is intentionally lightweight — we only need edge counts
 * and V1/V2 split, not full adjacency lists. This keeps memory low
 * and build time negligible.
 */
async function ensureServerPoolGraph(): Promise<ServerPoolGraph> {
  if (_serverGraph && Date.now() - _serverGraph.ts < SERVER_GRAPH_TTL_MS) {
    return _serverGraph;
  }

  const connectivity = new Map<string, number>();
  const v1Edges = new Map<string, number>();
  const v2Edges = new Map<string, number>();

  const addEdge = (idA: string, idB: string, version: "v1" | "v2") => {
    if (!idA || !idB || idA === idB) return;
    connectivity.set(idA, (connectivity.get(idA) ?? 0) + 1);
    connectivity.set(idB, (connectivity.get(idB) ?? 0) + 1);
    if (version === "v1") {
      v1Edges.set(idA, (v1Edges.get(idA) ?? 0) + 1);
      v1Edges.set(idB, (v1Edges.get(idB) ?? 0) + 1);
    } else {
      v2Edges.set(idA, (v2Edges.get(idA) ?? 0) + 1);
      v2Edges.set(idB, (v2Edges.get(idB) ?? 0) + 1);
    }
  };

  // ── Parse V2 pools ──
  try {
    const v2Pools = await ensureV2PoolList();
    for (const pool of v2Pools) {
      const tA = pool.tokenA || pool.token0 || {};
      const tB = pool.tokenB || pool.token1 || {};
      const idA = tA.id || pool.token0Id || "";
      const idB = tB.id || pool.token1Id || "";
      if (idA && idB) addEdge(idA, idB, "v2");
    }
  } catch { /* non-fatal */ }

  // ── Parse V1 pools ──
  try {
    const v1Pools = await ensureV1PoolList();
    for (const pool of v1Pools) {
      const rawA = pool.tokenA;
      const rawB = pool.tokenB;
      const idA = typeof rawA === "string" ? rawA
        : (rawA?.id || rawA?.tokenId || pool.token0?.id || pool.token0Id || "");
      const idB = typeof rawB === "string" ? rawB
        : (rawB?.id || rawB?.tokenId || pool.token1?.id || pool.token1Id || "");
      if (idA && idB) addEdge(idA, idB, "v1");
    }
  } catch { /* non-fatal */ }

  // ── Build symbol map from /tokens API ──
  const symbols = new Map<string, string>();
  try {
    const tokens = await ensureRawTokenData();
    for (const t of tokens) {
      const id = t.id || t.tokenId || t.token_id || "";
      const sym = t.symbol || "";
      if (id && sym) symbols.set(id, sym);
    }
  } catch { /* non-fatal — symbols are nice-to-have */ }

  // Also seed symbols from hardcoded INTERMEDIARY_TOKENS for fallback
  for (const t of INTERMEDIARY_TOKENS) {
    if (!symbols.has(t.htsId)) symbols.set(t.htsId, t.symbol);
  }

  // ── Rank tokens by connectivity (descending) ──
  const ranked = Array.from(connectivity.entries())
    .map(([htsId, edges]) => ({
      htsId,
      symbol: symbols.get(htsId) || htsId,
      edges,
      v2Only: (v1Edges.get(htsId) ?? 0) === 0 && (v2Edges.get(htsId) ?? 0) > 0,
    }))
    .sort((a, b) => b.edges - a.edges);

  _serverGraph = { connectivity, v1Edges, v2Edges, symbols, ranked, ts: Date.now() };

  const topSymbols = ranked.slice(0, 10).map(r => `${r.symbol}(${r.edges})`).join(", ");
  console.log(
    `[STEP12] Pool graph built: ${connectivity.size} tokens, ` +
    `${v1Edges.size} V1-connected, ${v2Edges.size} V2-connected. ` +
    `Top 10: ${topSymbols}`
  );

  return _serverGraph;
}

/**
 * [STEP12] Get dynamic intermediary token list based on pool connectivity.
 *
 * Returns the top N most-connected tokens (excluding input/output),
 * enriched with V2 alias IDs from the hardcoded INTERMEDIARY_TOKENS
 * list when available.
 *
 * Falls back to hardcoded INTERMEDIARY_TOKENS when the pool graph
 * is unavailable (API failure, cold start).
 */
async function getDynamicIntermediaries(
  inputHtsId: string, outputHtsId: string, maxCount: number = 20,
): Promise<{ htsId: string; symbol: string; v2AliasId?: string; v2Only: boolean }[]> {
  let graph: ServerPoolGraph | null = null;
  try {
    graph = await ensureServerPoolGraph();
  } catch { /* fall through to hardcoded fallback */ }

  if (!graph || graph.ranked.length === 0) {
    // Fallback: use hardcoded list
    return INTERMEDIARY_TOKENS
      .filter(t => t.htsId !== inputHtsId && t.htsId !== outputHtsId)
      .map(t => ({ ...t, v2Only: V2_ONLY_TOKENS.has(t.htsId) }));
  }

  // Build a lookup for hardcoded v2AliasId values
  const aliasLookup = new Map<string, string>();
  for (const t of INTERMEDIARY_TOKENS) {
    if (t.v2AliasId) aliasLookup.set(t.htsId, t.v2AliasId);
  }

  return graph.ranked
    .filter(r => r.htsId !== inputHtsId && r.htsId !== outputHtsId)
    .slice(0, maxCount)
    .map(r => ({
      htsId: r.htsId,
      symbol: r.symbol,
      v2AliasId: aliasLookup.get(r.htsId),
      v2Only: r.v2Only,
    }));
}

/**
 * [STEP12] Generate dynamic 3-hop intermediary pairs from top-connected tokens.
 *
 * Takes the top 8 intermediaries by connectivity and generates all
 * ordered pairs (A, B) where A ≠ B. Filters to max 20 pairs.
 * This covers the most likely 3-hop routing paths dynamically.
 *
 * Falls back to hardcoded THREE_HOP_PAIRS when the pool graph is unavailable.
 */
async function getDynamicThreeHopPairs(
  inputHtsId: string, outputHtsId: string, maxPairs: number = 20,
): Promise<{ midA: string; midB: string; symbolA: string; symbolB: string }[]> {
  let graph: ServerPoolGraph | null = null;
  try {
    graph = await ensureServerPoolGraph();
  } catch { /* fall through to hardcoded fallback */ }

  if (!graph || graph.ranked.length < 3) {
    // Fallback: use hardcoded pairs
    return THREE_HOP_PAIRS.filter(p =>
      p.midA !== inputHtsId && p.midA !== outputHtsId &&
      p.midB !== inputHtsId && p.midB !== outputHtsId &&
      p.midA !== p.midB
    );
  }

  // Take top 8 intermediaries (excluding input/output)
  const topTokens = graph.ranked
    .filter(r => r.htsId !== inputHtsId && r.htsId !== outputHtsId)
    .slice(0, 8);

  if (topTokens.length < 2) {
    return THREE_HOP_PAIRS.filter(p =>
      p.midA !== inputHtsId && p.midA !== outputHtsId &&
      p.midB !== inputHtsId && p.midB !== outputHtsId &&
      p.midA !== p.midB
    );
  }

  // Generate ordered pairs (A, B) sorted by combined connectivity
  const pairs: { midA: string; midB: string; symbolA: string; symbolB: string; score: number }[] = [];
  for (const a of topTokens) {
    for (const b of topTokens) {
      if (a.htsId === b.htsId) continue;
      pairs.push({
        midA: a.htsId,
        midB: b.htsId,
        symbolA: a.symbol,
        symbolB: b.symbol,
        score: a.edges + b.edges,
      });
    }
  }

  // Sort by combined connectivity, take top N
  pairs.sort((a, b) => b.score - a.score);
  return pairs.slice(0, maxPairs);
}

/**
 * [STEP12] Dynamic V2-only detection from pool graph.
 *
 * A token is V2-only if it has V2 pool edges but zero V1 pool edges.
 * Falls back to the hardcoded V2_ONLY_TOKENS set when the graph is unavailable.
 *
 * Used by V1 strategy fast-bail logic: tokens with no V1 pools should
 * skip V1 Router getAmountsOut() to avoid 2–12s of wasted RPC calls.
 */
function isDynamicV2Only(htsId: string): boolean {
  if (_serverGraph && _serverGraph.ranked.length > 0) {
    return (_serverGraph.v1Edges.get(htsId) ?? 0) === 0 &&
           (_serverGraph.v2Edges.get(htsId) ?? 0) > 0;
  }
  return V2_ONLY_TOKENS.has(htsId);
}

/** Quote cache TTL: 10 seconds. */
const QUOTE_CACHE_TTL_MS = 10_000;

/** Gas hex for Hedera EVM calls (1,500,000 — Hedera needs more gas than Ethereum). */
const GAS_HEX = "0x16e360";

/**
 * Overall quote timeout: 15 seconds hard ceiling.
 * Individual strategies have their own timeouts (RPC 12s, Mirror 10s),
 * but this protects the endpoint from hanging on edge cases.
 */
const QUOTE_OVERALL_TIMEOUT_MS = 15_000;

/**
 * V2 fee tiers in hundredths of a bip — ALL known SaucerSwap V2 tiers.
 * Ordered by most common first for early success in Promise.any races.
 */
const V2_FEE_TIERS = [3000, 1500, 10000, 500, 100] as const;

// ═════════════════════════════════════════════════════════════════════
// PARALLEL RPC + MIRROR RACE  [C92]
// ═════════════════════════════════════════════════════════════════════
// Runs BOTH JSON-RPC (HashIO) and Mirror Node contract call simultaneously.
// Returns the first non-empty hex result. Cuts worst-case latency in half
// compared to sequential fallback.

async function raceRpcAndMirror(
  toEvm: string, calldata: string, network: string, gasLimit: number = 1_500_000,
): Promise<string | null> {
  const validate = (r: any): r is string =>
    r != null && typeof r === "string" && r !== "0x" && r.length > 2;

  const rpcP = ssFetchJsonRpc(
    "eth_call", [{ to: toEvm, data: calldata, gas: GAS_HEX }, "latest"], network,
  ).then(r => { if (validate(r)) return r as string; throw new Error("rpc-empty"); });

  const mirrorP = ssMirrorContractCall(toEvm, calldata, network, gasLimit)
    .then(r => { if (validate(r)) return r as string; throw new Error("mirror-empty"); });

  try {
    return await Promise.any([rpcP, mirrorP]);
  } catch {
    return null; // Both failed or returned empty
  }
}

/**
 * [C100 Step 3] Variant of raceRpcAndMirror with an explicit hard timeout.
 *
 * Used by V1 strategies to enforce a tighter ceiling (V1_RPC_TIMEOUT_MS = 5s)
 * than the default RPC/Mirror timeouts (12s/10s). V1 Router reverts are fast
 * on Hedera (~2-3s for a non-existent pair), so 5s is generous for success
 * and tight enough to prevent V1 failures from dominating quote latency.
 *
 * Returns null if neither RPC nor Mirror produces a valid result within the
 * given timeout — the same contract as raceRpcAndMirror.
 */
async function raceRpcAndMirrorWithTimeout(
  toEvm: string, calldata: string, network: string, timeoutMs: number,
  gasLimit: number = 1_500_000,
): Promise<string | null> {
  const validate = (r: any): r is string =>
    r != null && typeof r === "string" && r !== "0x" && r.length > 2;

  const rpcP = ssFetchJsonRpc(
    "eth_call", [{ to: toEvm, data: calldata, gas: GAS_HEX }, "latest"], network,
  ).then(r => { if (validate(r)) return r as string; throw new Error("rpc-empty"); });

  const mirrorP = ssMirrorContractCall(toEvm, calldata, network, gasLimit)
    .then(r => { if (validate(r)) return r as string; throw new Error("mirror-empty"); });

  const timeoutP = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("v1-fast-timeout")), timeoutMs)
  );

  try {
    return await Promise.race([Promise.any([rpcP, mirrorP]), timeoutP]);
  } catch {
    return null; // Both failed, returned empty, or timed out
  }
}

/**
 * Fallback token prices in USD.
 * [C33-01] Updated to current market values.
 * Used when SaucerSwap /tokens API is unavailable.
 */
const FALLBACK_PRICES_USD: Record<string, number> = {
  "0.0.1456986": 0.10,   // WHBAR
  "0.0.731861": 0.045,   // SAUCE
  "0.0.456858": 1.0,     // USDC
  "0.0.1055472": 1.0,    // USDT
  "0.0.1055483": 104000, // WBTC (canonical)
  "0.0.9770617": 2650,   // WETH (high-liquidity, $1.8M TVL)
  "0.0.1055495": 16.50,  // LINK (canonical)
  "0.0.834116": 0.11,    // HBARX
  "0.0.7374029": 0.000001, // HBAR.h
  "0.0.968069": 0.018,   // HST
  "0.0.1157005": 660,    // WBNB
  "0.0.1055459": 1.0,    // USDCh
  "0.0.4794920": 0.015,  // PACK (correct ID)
  "0.0.3716059": 0.002,  // DOVU (correct ID)
  "0.0.2283230": 0.0003, // KARATE (correct ID)
};

const VALID_NETWORKS = new Set(["mainnet", "testnet"]);

// ════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════

export interface QuoteResult {
  amountOut: string;         // Raw output amount (string for BigInt safety)
  source: string;            // "v1-router" | "v2-quoter" | "v2-multihop" | "api" | "price-estimate"
  confidence: "high" | "medium" | "low";
  priceImpact: number;       // 0 for router/quoter (baked in), estimated for others
  route: string[];           // HTS IDs in the route
  poolVersion?: "v1" | "v2";
  feeTier?: number;
  // [STEP2] Per-hop fee tiers (replaces single feeTier for multi-hop)
  feeTiers?: number[];
  // [STEP2] Hex-encoded V2 packed path — the EXACT bytes that exactInput() needs
  packedPathHex?: string;
}

// ═════════════════════════════════════════════════════════════════════
// CACHES
// ═════════════════════════════════════════════════════════════════════

interface CacheEntry<T> { value: T; ts: number; }
const _quoteCache = new Map<string, CacheEntry<QuoteResult>>();
const _contractEvmCache: Record<string, string> = {};

/** Token price cache from /tokens API (5 min TTL). */
let _tokenPrices: Map<string, number> | null = null;
let _tokenPricesTs = 0;
const TOKEN_PRICE_TTL_MS = 300_000;

// ═════════════════════════════════════════════════════════════════════
// ABI ENCODING / DECODING  [C46]
// ═════════════════════════════════════════════════════════════════════

function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function encodeUint256(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) { bytes[i] = Number(v & 0xffn); v >>= 8n; }
  return bytes;
}

function encodeAddress(addr: string): Uint8Array {
  const hex = addr.replace("0x", "").padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

function decodeBigUint(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 32; i++) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value;
}

/**
 * Encode getAmountsOut(uint256 amountIn, address[] path)
 * Selector: 0xd06ca61f
 */
function encodeGetAmountsOut(amountIn: bigint, path: string[]): string {
  const selector = new Uint8Array([0xd0, 0x6c, 0xa6, 0x1f]);
  const parts: Uint8Array[] = [selector, encodeUint256(amountIn), encodeUint256(64n), encodeUint256(BigInt(path.length))];
  for (const addr of path) parts.push(encodeAddress(addr));
  return bytesToHex(concatBytes(...parts));
}

/**
 * Decode getAmountsOut return → uint256[] amounts.
 * Returns the last element (output amount) or null.
 */
function decodeAmountsOut(hexData: string): bigint | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 96) return null;
    const arrLen = Number(decodeBigUint(bytes, 32));
    if (arrLen <= 0 || bytes.length < 64 + arrLen * 32) return null;
    return decodeBigUint(bytes, 64 + (arrLen - 1) * 32);
  } catch { return null; }
}

/**
 * Encode quoteExactInputSingle((address,address,uint256,uint24,uint160))
 * Selector: 0xc6a5026a
 */
function encodeQuoteExactInputSingle(
  tokenIn: string, tokenOut: string, amountIn: bigint, fee: number,
): string {
  const selector = new Uint8Array([0xc6, 0xa5, 0x02, 0x6a]);
  return bytesToHex(concatBytes(
    selector, encodeAddress(tokenIn), encodeAddress(tokenOut),
    encodeUint256(amountIn), encodeUint256(BigInt(fee)), encodeUint256(0n),
  ));
}

/**
 * Encode a packed V2 swap path: abi.encodePacked(token0, fee0, token1, ...)
 * Each address is 20 bytes, each fee is 3 bytes (uint24 big-endian).
 */
function encodePackedPath(hops: { tokenEvm: string; fee: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < hops.length; i++) {
    const addrHex = hops[i].tokenEvm.replace("0x", "").padStart(40, "0");
    const addrBytes = new Uint8Array(20);
    for (let j = 0; j < 20; j++) addrBytes[j] = parseInt(addrHex.slice(j * 2, j * 2 + 2), 16);
    parts.push(addrBytes);
    if (i < hops.length - 1) {
      const fee = hops[i].fee;
      const feeBytes = new Uint8Array(3);
      feeBytes[0] = (fee >> 16) & 0xff; feeBytes[1] = (fee >> 8) & 0xff; feeBytes[2] = fee & 0xff;
      parts.push(feeBytes);
    }
  }
  return concatBytes(...parts);
}

/**
 * Encode quoteExactInput(bytes path, uint256 amountIn)
 * Selector: 0xcdca1753
 */
function encodeQuoteExactInput(packedPath: Uint8Array, amountIn: bigint): string {
  const selector = new Uint8Array([0xcd, 0xca, 0x17, 0x53]);
  const pathLen = encodeUint256(BigInt(packedPath.length));
  const paddedLen = Math.ceil(packedPath.length / 32) * 32;
  const pathPadded = new Uint8Array(paddedLen);
  pathPadded.set(packedPath);
  return bytesToHex(concatBytes(selector, encodeUint256(64n), encodeUint256(amountIn), pathLen, pathPadded));
}

// ═════════════════════════════════════════════════════════════════════
// CONTRACT EVM ADDRESS RESOLUTION (cached)
// ═════════════════════════════════════════════════════════════════════

async function resolveContract(contractId: string, network: string): Promise<string> {
  const key = `${network}:${contractId}`;
  if (_contractEvmCache[key]) return _contractEvmCache[key];
  const evm = await ssResolveEvmAddress(contractId, "contract", network);
  _contractEvmCache[key] = evm;
  return evm;
}

// ═════════════════════════════════════════════════════════════════════
// TOKEN PRICE FETCHING
// ═════════════════════════════════════════════════════════════════════

async function ensureTokenPrices(): Promise<Map<string, number>> {
  if (_tokenPrices && Date.now() - _tokenPricesTs < TOKEN_PRICE_TTL_MS) return _tokenPrices;

  // [C100 Step 4] Use shared raw token data cache to avoid redundant
  // /tokens API calls (ensureDynamicAliasMap uses the same data).
  const tokens = await ensureRawTokenData();
  const prices = new Map<string, number>();

  // Seed with fallbacks
  for (const [id, price] of Object.entries(FALLBACK_PRICES_USD)) {
    prices.set(id, price);
  }

  if (tokens.length > 0) {
    for (const t of tokens as any[]) {
      const priceUsd = parseFloat(t.priceUsd || t.price || "0");
      const htsId = t.id || t.tokenId || t.token_id || "";
      if (htsId && priceUsd > 0) prices.set(htsId, priceUsd);
    }
    console.log(`[SS-Quote] Token prices refreshed: ${prices.size} tokens`);
  }

  _tokenPrices = prices;
  _tokenPricesTs = Date.now();
  return prices;
}

// ═════════════════════════════════════════════════════════════════════
// QUOTE STRATEGIES  [C46]
// ═════════════════════════════════════════════════════════════════════

/** Strategy 1: V1 Router getAmountsOut() — [C92] parallel RPC + Mirror race.
 * [C100 Step 3] Fast-bails for V2-only tokens + V1-specific 5s timeout. */
async function strategyV1Router(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  // [C100 Step 3] Fast bail — V2-only tokens have zero V1 liquidity,
  // so getAmountsOut will always revert. Skip to save 2–12s of RPC latency.
  // [STEP12] Dynamic V2-only detection from pool graph (falls back to hardcoded set)
  if (isDynamicV2Only(inputHtsId) || isDynamicV2Only(outputHtsId)) {
    console.log(`[SS-Quote] [STEP12] V1 direct skipped — ${isDynamicV2Only(inputHtsId) ? inputHtsId : outputHtsId} is V2-only`);
    return null;
  }

  const routerId = V1_ROUTER_IDS[network] || V1_ROUTER_IDS.mainnet;
  const routerEvm = await resolveContract(routerId, network);
  const calldata = encodeGetAmountsOut(amountIn, [tokenInEvm, tokenOutEvm]);

  // [C92] Race RPC + Mirror in parallel — whichever succeeds first wins
  // [C100 Step 3] V1-specific 5s timeout — reverts are fast on Hedera,
  // so 5s is generous for success and tight enough to avoid dominating latency.
  const result = await raceRpcAndMirrorWithTimeout(routerEvm, calldata, network, V1_RPC_TIMEOUT_MS);
  if (result) {
    const out = decodeAmountsOut(result);
    if (out !== null && out > 0n) {
      console.log(`[SS-Quote] V1 router (race): amountOut=${out}`);
      return { amountOut: out.toString(), source: "v1-router", confidence: "high", priceImpact: 0, route: [inputHtsId, outputHtsId], poolVersion: "v1" };
    }
  }

  return null;
}

/** [C90] Strategy 1b: V1 Router multi-hop via WHBAR.
 * getAmountsOut with 3-token path: tokenIn → WHBAR → tokenOut.
 * Catches exotic pairs that have V1 AMM liquidity through WHBAR hub.
 * [C92] Uses parallel RPC + Mirror race.
 * [C100 Step 3] Fast-bails for V2-only tokens + V1-specific 5s timeout. */
async function strategyV1RouterMultiHop(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  // [C100 Step 3] Fast bail — if either token is V2-only, the V1 leg
  // involving it (tokenIn→WHBAR or WHBAR→tokenOut) will always revert.
  // [STEP12] Dynamic V2-only detection from pool graph
  if (isDynamicV2Only(inputHtsId) || isDynamicV2Only(outputHtsId)) {
    console.log(`[SS-Quote] [STEP12] V1 multi-hop skipped — ${isDynamicV2Only(inputHtsId) ? inputHtsId : outputHtsId} is V2-only`);
    return null;
  }

  const whbarEvm = htsIdToEvmAddress(WHBAR_HTS_ID);
  // Skip if either token is already WHBAR
  if (tokenInEvm.toLowerCase() === whbarEvm.toLowerCase() ||
      tokenOutEvm.toLowerCase() === whbarEvm.toLowerCase()) return null;

  const routerId = V1_ROUTER_IDS[network] || V1_ROUTER_IDS.mainnet;
  const routerEvm = await resolveContract(routerId, network);
  const calldata = encodeGetAmountsOut(amountIn, [tokenInEvm, whbarEvm, tokenOutEvm]);

  // [C92] Race RPC + Mirror in parallel
  // [C100 Step 3] V1-specific 5s timeout
  const result = await raceRpcAndMirrorWithTimeout(routerEvm, calldata, network, V1_RPC_TIMEOUT_MS);
  if (result) {
    const out = decodeAmountsOut(result);
    if (out !== null && out > 0n) {
      console.log(`[SS-Quote] V1 multi-hop via WHBAR (race): amountOut=${out}`);
      return {
        amountOut: out.toString(), source: "v1-multihop-whbar", confidence: "high",
        priceImpact: 0, route: [inputHtsId, WHBAR_HTS_ID, outputHtsId], poolVersion: "v1",
      };
    }
  }
  return null;
}

/** Strategy 2: V2 QuoterV2 quoteExactInputSingle() — [C92] ALL fee tiers + parallel race.
 * This is the #1 fix for missing quotes: instead of trying ONE fee tier,
 * we probe ALL 5 SaucerSwap V2 tiers in parallel and pick the best output.
 * Each tier races RPC + Mirror simultaneously.
 * [C99] Uses V2 alias EVM addresses for bridge tokens. */
async function strategyV2Quoter(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  _fee: number, inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  const quoterId = V2_QUOTER_IDS[network] || V2_QUOTER_IDS.mainnet;
  const quoterEvm = await resolveContract(quoterId, network);

  // [C99] V2 pools use wrapper addresses for bridge tokens — resolve aliases
  const v2InEvm = resolveV2Evm(inputHtsId);
  const v2OutEvm = resolveV2Evm(outputHtsId);
  const usedAlias = v2InEvm !== tokenInEvm || v2OutEvm !== tokenOutEvm;
  if (usedAlias) {
    console.log(`[SS-Quote] [C99] V2 quoter using alias addresses: in=${inputHtsId}→${resolveV2AliasId(inputHtsId)}, out=${outputHtsId}→${resolveV2AliasId(outputHtsId)}`);
  }

  // [C92] Try ALL V2 fee tiers in parallel — pick the one with highest output.
  // Previously only tried the detected fee (or default 3000), missing pools
  // at other tiers entirely. This is the root cause of many "no quote" failures.
  const feeProbes = V2_FEE_TIERS.map(async (fee): Promise<QuoteResult | null> => {
    const calldata = encodeQuoteExactInputSingle(v2InEvm, v2OutEvm, amountIn, fee);
    const result = await raceRpcAndMirror(quoterEvm, calldata, network);
    if (result && result.length >= 66) {
      const cleanHex = result.startsWith("0x") ? result.slice(2) : result;
      const out = BigInt("0x" + cleanHex.slice(0, 64));
      if (out > 0n) {
        // [STEP2] Build single-hop packed path for execution passthrough
        const singleHopPath = encodePackedPath([
          { tokenEvm: v2InEvm, fee },
          { tokenEvm: v2OutEvm, fee: 0 },
        ]);
        return {
          amountOut: out.toString(), source: "v2-quoter", confidence: "high",
          priceImpact: 0, route: [inputHtsId, outputHtsId], poolVersion: "v2", feeTier: fee,
          feeTiers: [fee], packedPathHex: bytesToHex(singleHopPath),
        };
      }
    }
    return null;
  });

  // [C99] If alias addresses differ from canonical, also probe with canonical
  // addresses. Some V2 pools may use canonical IDs (non-bridge tokens paired
  // with bridge tokens where only one side has an alias).
  if (usedAlias) {
    for (const fee of V2_FEE_TIERS) {
      feeProbes.push((async (): Promise<QuoteResult | null> => {
        const calldata = encodeQuoteExactInputSingle(tokenInEvm, tokenOutEvm, amountIn, fee);
        const result = await raceRpcAndMirror(quoterEvm, calldata, network);
        if (result && result.length >= 66) {
          const cleanHex = result.startsWith("0x") ? result.slice(2) : result;
          const out = BigInt("0x" + cleanHex.slice(0, 64));
          if (out > 0n) {
            // [STEP2] Build single-hop packed path (canonical addresses)
            const canonPath = encodePackedPath([
              { tokenEvm: tokenInEvm, fee },
              { tokenEvm: tokenOutEvm, fee: 0 },
            ]);
            return {
              amountOut: out.toString(), source: "v2-quoter", confidence: "high",
              priceImpact: 0, route: [inputHtsId, outputHtsId], poolVersion: "v2", feeTier: fee,
              feeTiers: [fee], packedPathHex: bytesToHex(canonPath),
            };
          }
        }
        return null;
      })());
    }
  }

  // Wait for all tiers to complete (failed tiers return null quickly on revert)
  const results = await Promise.allSettled(feeProbes);

  // Pick the result with the highest output amount
  let best: QuoteResult | null = null;
  let bestOut = 0n;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      const out = BigInt(r.value.amountOut);
      if (out > bestOut) {
        best = r.value;
        bestOut = out;
      }
    }
  }

  if (best) {
    console.log(`[SS-Quote] V2 quoter (all-tier race): amountOut=${best.amountOut} fee=${best.feeTier}`);
  }
  return best;
}

/** Strategy 3: V2 QuoterV2 quoteExactInput() multi-hop through WHBAR.
 * [C99] Uses V2 alias EVM addresses for bridge tokens in packed path. */
async function strategyV2MultiHop(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult | null> {
  const whbarEvm = htsIdToEvmAddress(WHBAR_HTS_ID);

  // Skip if either token is already WHBAR
  if (tokenInEvm.toLowerCase() === whbarEvm.toLowerCase() ||
      tokenOutEvm.toLowerCase() === whbarEvm.toLowerCase()) return null;

  const quoterId = V2_QUOTER_IDS[network] || V2_QUOTER_IDS.mainnet;
  const quoterEvm = await resolveContract(quoterId, network);

  // [C99] V2 pools use wrapper addresses for bridge tokens
  const v2InEvm = resolveV2Evm(inputHtsId);
  const v2OutEvm = resolveV2Evm(outputHtsId);
  const usedAlias = v2InEvm !== tokenInEvm || v2OutEvm !== tokenOutEvm;
  if (usedAlias) {
    console.log(`[SS-Quote] [C99] V2 multi-hop using alias: in=${inputHtsId}→${resolveV2AliasId(inputHtsId)}, out=${outputHtsId}→${resolveV2AliasId(outputHtsId)}`);
  }

  // Try common fee combos for the 2-hop path: tokenIn → WHBAR → tokenOut
  // [C90] Expanded to cover ALL SaucerSwap V2 fee tiers (100, 500, 1500, 3000, 10000).
  // [STEP7] Expanded from 7 → 13 combos: added symmetric pairs and cross-tier combos.
  // Promise.any returns the FIRST successful result — we get speed AND coverage.
  const feeCombos: [number, number][] = [
    [3000, 3000], [1500, 3000], [3000, 1500], [10000, 3000],
    [3000, 10000], [500, 3000], [3000, 500],
    // [STEP7] Additional combos — symmetric and cross-tier
    [1500, 1500], [500, 500], [100, 3000], [10000, 10000],
    [500, 1500], [1500, 500],
  ];

  const probes = feeCombos.map(async ([fee1, fee2]) => {
    // [C99] Use alias EVM addresses in packed path for V2 pools
    const packedPath = encodePackedPath([
      { tokenEvm: v2InEvm, fee: fee1 },
      { tokenEvm: whbarEvm, fee: fee2 },
      { tokenEvm: v2OutEvm, fee: 0 },
    ]);
    const calldata = encodeQuoteExactInput(packedPath, amountIn);

    const rpcResult = await ssFetchJsonRpc("eth_call", [{ to: quoterEvm, data: calldata, gas: GAS_HEX }, "latest"], network);
    if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length >= 66) {
      const amountOutHex = rpcResult.slice(2, 66);
      const out = BigInt("0x" + amountOutHex);
      if (out > 0n) {
        console.log(`[SS-Quote] V2 multi-hop (RPC): amountOut=${out} fees=${fee1}/${fee2}${usedAlias ? " [C99-alias]" : ""}`);
        return {
          amountOut: out.toString(), source: "v2-multihop", confidence: "high" as const, priceImpact: 0,
          route: [inputHtsId, WHBAR_HTS_ID, outputHtsId], poolVersion: "v2" as const, feeTier: fee1,
          feeTiers: [fee1, fee2], packedPathHex: bytesToHex(packedPath),
        };
      }
    }
    throw new Error("no-result"); // Signal Promise.any to try next
  });

  // [C99] If alias addresses are different, also try canonical addresses as fallback
  if (usedAlias) {
    for (const [fee1, fee2] of feeCombos.slice(0, 4)) { // Top 4 fee combos for canonical fallback
      probes.push((async () => {
        const packedPath = encodePackedPath([
          { tokenEvm: tokenInEvm, fee: fee1 },
          { tokenEvm: whbarEvm, fee: fee2 },
          { tokenEvm: tokenOutEvm, fee: 0 },
        ]);
        const calldata = encodeQuoteExactInput(packedPath, amountIn);
        const rpcResult = await ssFetchJsonRpc("eth_call", [{ to: quoterEvm, data: calldata, gas: GAS_HEX }, "latest"], network);
        if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length >= 66) {
          const out = BigInt("0x" + rpcResult.slice(2, 66));
          if (out > 0n) {
            console.log(`[SS-Quote] V2 multi-hop (RPC, canonical fallback): amountOut=${out} fees=${fee1}/${fee2}`);
            return {
              amountOut: out.toString(), source: "v2-multihop", confidence: "high" as const, priceImpact: 0,
              route: [inputHtsId, WHBAR_HTS_ID, outputHtsId], poolVersion: "v2" as const, feeTier: fee1,
              feeTiers: [fee1, fee2], packedPathHex: bytesToHex(packedPath),
            };
          }
        }
        throw new Error("no-result");
      })());
    }
  }

  try {
    return await Promise.any(probes);
  } catch {
    // All combos failed — AggregateError
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════
// [STEP11] STRATEGY 3b: V2 3-HOP ROUTE PROBING
// ═════════════════════════════════════════════════════════════════════
//
// Probes 3-hop V2 paths: Token → midA → midB → Token
// for all 15 intermediary pairs × 5 fee combos = 75 probes.
// Uses QuoterV2.quoteExactInput() with 4-token packed paths.
//
// Returns ALL successful 3-hop routes (caller picks the best).
// Runs in parallel alongside 2-hop probes — no added latency.
// ═════════════════════════════════════════════════════════════════════

/**
 * [STEP11] Probe 3-hop V2 routes through intermediary pairs.
 *
 * For each pair (midA, midB) in THREE_HOP_PAIRS, builds a packed path:
 *   input → midA → midB → output
 * and validates via QuoterV2.quoteExactInput().
 *
 * Filters out pairs where midA or midB equals input or output token.
 * Uses V2 alias resolution for bridge tokens in all path positions.
 *
 * Returns an array of successful QuoteResults. The calling orchestrator
 * merges these with 2-hop results and picks the overall best.
 */
async function probeThreeHopRoutes(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
): Promise<QuoteResult[]> {
  const quoterId = V2_QUOTER_IDS[network] || V2_QUOTER_IDS.mainnet;
  const quoterEvm = await resolveContract(quoterId, network);

  // [STEP11] Resolve V2 alias EVM addresses for input/output tokens
  const v2InEvm = resolveV2Evm(inputHtsId);
  const v2OutEvm = resolveV2Evm(outputHtsId);

  // [STEP12] Dynamic 3-hop pair discovery from pool graph (falls back to hardcoded pairs)
  const validPairs = await getDynamicThreeHopPairs(inputHtsId, outputHtsId);

  if (validPairs.length === 0) return [];

  const probes: Promise<QuoteResult | null>[] = [];

  for (const pair of validPairs) {
    // Resolve V2 alias EVM for intermediary tokens
    const midAV2Evm = resolveV2Evm(pair.midA);
    const midBV2Evm = resolveV2Evm(pair.midB);

    for (const [fee1, fee2, fee3] of THREE_HOP_FEE_COMBOS) {
      probes.push((async (): Promise<QuoteResult | null> => {
        try {
          const packedPath = encodePackedPath([
            { tokenEvm: v2InEvm, fee: fee1 },
            { tokenEvm: midAV2Evm, fee: fee2 },
            { tokenEvm: midBV2Evm, fee: fee3 },
            { tokenEvm: v2OutEvm, fee: 0 },
          ]);
          const calldata = encodeQuoteExactInput(packedPath, amountIn);

          // [STEP11] Use higher gas for 3-hop (5M vs 1.5M default)
          const rpcResult = await ssFetchJsonRpc(
            "eth_call",
            [{ to: quoterEvm, data: calldata, gas: GAS_HEX_3HOP }, "latest"],
            network,
          );

          if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length >= 66) {
            const out = BigInt("0x" + rpcResult.slice(2, 66));
            if (out > 0n) {
              return {
                amountOut: out.toString(),
                source: `v2-3hop-via-${pair.symbolA}-${pair.symbolB}`,
                confidence: "high" as const,
                priceImpact: 0,
                route: [inputHtsId, pair.midA, pair.midB, outputHtsId],
                poolVersion: "v2" as const,
                feeTier: fee1,
                feeTiers: [fee1, fee2, fee3],
                packedPathHex: bytesToHex(packedPath),
              };
            }
          }
        } catch { /* non-fatal — failed probe */ }
        return null;
      })());
    }
  }

  // Race all probes with a 12s sub-timeout (same as 2-hop probes)
  const timeout = new Promise<PromiseSettledResult<QuoteResult | null>[]>((resolve) =>
    setTimeout(() => resolve([]), 12_000)
  );
  const results = await Promise.race([Promise.allSettled(probes), timeout]);

  const routes: QuoteResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) routes.push(r.value);
  }

  if (routes.length > 0) {
    // [STEP11] Deduplicate: keep only the best output per intermediary pair
    const bestByPair = new Map<string, QuoteResult>();
    for (const route of routes) {
      const pairKey = route.route.slice(1, -1).join("-"); // "midA-midB"
      const existing = bestByPair.get(pairKey);
      if (!existing || BigInt(route.amountOut) > BigInt(existing.amountOut)) {
        bestByPair.set(pairKey, route);
      }
    }
    const dedupedRoutes = Array.from(bestByPair.values());
    console.log(`[STEP11] 3-hop probed ${probes.length} combos → ${routes.length} valid → ${dedupedRoutes.length} unique pairs`);
    return dedupedRoutes;
  }

  return [];
}

/** Strategy 4: SaucerSwap REST API /swap/quote */
async function strategyApiQuote(
  amountIn: string, inputHtsId: string, outputHtsId: string,
): Promise<QuoteResult | null> {
  const endpoints = [
    `/swap/quote?inputToken=${inputHtsId}&outputToken=${outputHtsId}&amountIn=${amountIn}`,
    `/swap/quote?tokenA=${inputHtsId}&tokenB=${outputHtsId}&amountIn=${amountIn}`,
  ];

  for (const ep of endpoints) {
    const data = await ssFetchSaucerSwapApi(ep);
    if (data) {
      const rawOut = data.amountOut ?? data.outputAmount ?? data.amount_out ?? data.quote;
      if (rawOut !== undefined && rawOut !== null) {
        const out = BigInt(String(rawOut).replace(/[^0-9]/g, ""));
        if (out > 0n) {
          console.log(`[SS-Quote] API quote: amountOut=${out}`);
          return {
            amountOut: out.toString(), source: "api", confidence: "medium",
            priceImpact: parseFloat(data.priceImpact || "0"),
            route: data.route || [inputHtsId, outputHtsId],
          };
        }
      }
    }
  }

  return null;
}

/** Strategy 5: Price-based estimation fallback. */
async function strategyPriceEstimate(
  amountIn: bigint, inputHtsId: string, outputHtsId: string,
  inputDecimals: number, outputDecimals: number,
): Promise<QuoteResult | null> {
  const prices = await ensureTokenPrices();

  // For native HBAR, look up WHBAR price.
  // [ALIAS-FIX] Also try V2 alias IDs when canonical price is missing — SaucerSwap
  // API may list prices under the ERC20Wrapper ID instead of the canonical ID.
  const inPrice = prices.get(inputHtsId) ?? prices.get(WHBAR_HTS_ID) ?? prices.get(resolveV2AliasId(inputHtsId)) ?? 0;
  const outPrice = prices.get(outputHtsId) ?? prices.get(resolveV2AliasId(outputHtsId)) ?? 0;

  if (inPrice <= 0 || outPrice <= 0) {
    console.log(`[SS-Quote] Price estimate failed: inPrice=${inPrice} outPrice=${outPrice} for ${inputHtsId}/${outputHtsId}`);
    return null;
  }

  const humanInput = Number(amountIn) / Math.pow(10, inputDecimals);
  const valueUsd = humanInput * inPrice;
  const feeMultiplier = 0.997; // 0.3% fee
  const outputHuman = (valueUsd * feeMultiplier) / outPrice;
  const rawOutput = Math.floor(outputHuman * Math.pow(10, outputDecimals));

  if (rawOutput <= 0) return null;

  console.log(`[SS-Quote] Price estimate: ${humanInput} × $${inPrice} × ${feeMultiplier} / $${outPrice} = ${outputHuman} (raw: ${rawOutput})`);
  return {
    amountOut: rawOutput.toString(), source: "price-estimate", confidence: "low",
    priceImpact: 0.05, route: [inputHtsId, outputHtsId],
  };
}

// ═════════════════════════════════════════════════════════════════════
// [C52] SMART MULTI-ROUTE SCORING
// ════════════════════════════════════════════════════════════════════
//
// For Token→Token pairs with no direct pool, tests ALL intermediary
// candidates in parallel and returns scored routes.
//
// Score formula (normalized 0-1):
//   score = (outputNorm × 0.7) + (confidenceNorm × 0.2) + (hopPenalty × -0.1)
//
// where:
//   outputNorm     = thisOutput / maxOutput across all routes
//   confidenceNorm = { high: 1.0, medium: 0.6, low: 0.3 }
//   hopPenalty     = (numHops - 1) / maxPossibleHops  (1-hop = 0, 2-hop = 1)

export interface ScoredRoute {
  quote: QuoteResult;
  score: number;
  label: string;       // e.g. "USDC → WHBAR → SAUCE"
  intermediary: string; // HTS ID of intermediary token
  hops: number;
}

/**
 * [C52] Test all intermediary candidates for a Token→Token pair.
 * Each intermediary is tested with BOTH V1 and V2 routing in parallel.
 * Returns all successful routes, unsorted (scoring happens in orchestrator).
 *
 * [C100 Step 3] V1 probes are SKIPPED entirely when input or output is a
 * V2-only token (PACK, KARATE, DOVU). This eliminates 10+ RPC calls that
 * would all revert, saving 2–12s of accumulated latency per intermediary.
 * Remaining V1 probes (for tokens with V1 liquidity) use the tighter
 * V1_RPC_TIMEOUT_MS (5s) via raceRpcAndMirrorWithTimeout.
 */
async function probeAllIntermediaries(
  amountIn: bigint, tokenInEvm: string, tokenOutEvm: string,
  inputHtsId: string, outputHtsId: string, network: string,
  inputDecimals: number, outputDecimals: number,
): Promise<QuoteResult[]> {
  const routerId = V1_ROUTER_IDS[network] || V1_ROUTER_IDS.mainnet;
  const quoterId = V2_QUOTER_IDS[network] || V2_QUOTER_IDS.mainnet;

  // [STEP12] Dynamic intermediary discovery from pool graph (falls back to hardcoded list)
  const candidates = await getDynamicIntermediaries(inputHtsId, outputHtsId);

  if (candidates.length === 0) return [];

  // [STEP12] Dynamic V2-only detection from pool graph
  const skipV1 = isDynamicV2Only(inputHtsId) || isDynamicV2Only(outputHtsId);
  if (skipV1) {
    console.log(`[SS-Quote] [STEP12] Skipping ALL V1 intermediary probes — ` +
      `${isDynamicV2Only(inputHtsId) ? inputHtsId : outputHtsId} is V2-only ` +
      `(${candidates.length} intermediaries × V1 probes eliminated)`);
  }

  const [routerEvm, quoterEvm] = await Promise.all([
    // [C100 Step 3] Only resolve V1 router if we'll actually use it
    skipV1 ? Promise.resolve("") : resolveContract(routerId, network),
    resolveContract(quoterId, network),
  ]);

  const probes: Promise<QuoteResult | null>[] = [];

  // [C99] Resolve V2 alias EVM addresses for input/output tokens
  const v2InEvm = resolveV2Evm(inputHtsId);
  const v2OutEvm = resolveV2Evm(outputHtsId);

  for (const mid of candidates) {
    const midEvm = htsIdToEvmAddress(mid.htsId);
    // [C99] V2 alias EVM for intermediary token (uses v2AliasId if present)
    const midV2Evm = mid.v2AliasId ? htsIdToEvmAddress(mid.v2AliasId) : midEvm;

    // V1 multi-hop: tokenIn → mid → tokenOut via getAmountsOut
    // [C99] V1 uses CANONICAL addresses (V1 Factory pairs registered with canonical IDs)
    // [C100 Step 3] Skipped entirely for V2-only tokens; uses 5s timeout otherwise
    // [STEP12] Also skip V1 probe if the intermediary itself is V2-only (dynamic detection)
    if (!skipV1 && !mid.v2Only) {
      probes.push((async (): Promise<QuoteResult | null> => {
        try {
          const calldata = encodeGetAmountsOut(amountIn, [tokenInEvm, midEvm, tokenOutEvm]);
          // [C100 Step 3] Use V1-specific 5s timeout instead of default 12s
          const rpcResult = await raceRpcAndMirrorWithTimeout(routerEvm, calldata, network, V1_RPC_TIMEOUT_MS);
          if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length > 2) {
            const out = decodeAmountsOut(rpcResult);
            if (out !== null && out > 0n) {
              return {
                amountOut: out.toString(), source: `v1-via-${mid.symbol}`, confidence: "high",
                priceImpact: 0, route: [inputHtsId, mid.htsId, outputHtsId], poolVersion: "v1",
              };
            }
          }
        } catch { /* non-fatal */ }
        return null;
      })());
    }

    // V2 multi-hop: tokenIn → mid → tokenOut via quoteExactInput
    // [C90] Expanded fee combos to cover ALL SaucerSwap V2 tiers.
    // [STEP7] Expanded from 7 → 13 combos: symmetric and cross-tier.
    // [C99] Uses V2 ALIAS addresses for bridge tokens in packed path.
    const feeCombos: [number, number][] = [
      [3000, 3000], [1500, 3000], [3000, 1500], [10000, 3000],
      [3000, 10000], [500, 3000], [3000, 500],
      // [STEP7] Additional combos — symmetric and cross-tier
      [1500, 1500], [500, 500], [100, 3000], [10000, 10000],
      [500, 1500], [1500, 500],
    ];
    for (const [fee1, fee2] of feeCombos) {
      probes.push((async (): Promise<QuoteResult | null> => {
        try {
          // [C99] Use V2 alias addresses in packed path
          const packedPath = encodePackedPath([
            { tokenEvm: v2InEvm, fee: fee1 },
            { tokenEvm: midV2Evm, fee: fee2 },
            { tokenEvm: v2OutEvm, fee: 0 },
          ]);
          const calldata = encodeQuoteExactInput(packedPath, amountIn);
          const rpcResult = await ssFetchJsonRpc("eth_call", [{ to: quoterEvm, data: calldata, gas: GAS_HEX }, "latest"], network);
          if (rpcResult && typeof rpcResult === "string" && rpcResult !== "0x" && rpcResult.length >= 66) {
            const out = BigInt("0x" + rpcResult.slice(2, 66));
            if (out > 0n) {
              return {
                amountOut: out.toString(), source: `v2-via-${mid.symbol}`, confidence: "high",
                priceImpact: 0, route: [inputHtsId, mid.htsId, outputHtsId], poolVersion: "v2", feeTier: fee1,
                feeTiers: [fee1, fee2], packedPathHex: bytesToHex(packedPath),
              };
            }
          }
        } catch { /* non-fatal */ }
        return null;
      })());
    }
  }

  // Race all probes with a 12s sub-timeout (some will be slow)
  const timeout = new Promise<PromiseSettledResult<QuoteResult | null>[]>((resolve) =>
    setTimeout(() => resolve([]), 12_000)
  );
  const results = await Promise.race([Promise.allSettled(probes), timeout]);

  const routes: QuoteResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) routes.push(r.value);
  }

  // [C100 Step 3] Enhanced logging — shows V1/V2 split for diagnostics
  const v1Count = routes.filter(r => r.poolVersion === "v1").length;
  const v2Count = routes.filter(r => r.poolVersion === "v2").length;
  console.log(`[STEP12] 2-hop probed ${probes.length} combos (${candidates.length} intermediaries) → ${routes.length} valid routes (V1=${v1Count}, V2=${v2Count}${skipV1 ? ", V1-skipped" : ""})`);
  return routes;
}

/**
 * [C52] Score and rank routes using the composite formula.
 * [STEP11] Returns top 5 (was top 3) to surface 3-hop routes alongside
 * 1-hop and 2-hop. Hop penalty is proportional: 1-hop=0, 2-hop=1, 3-hop=2.
 */
function scoreRoutes(allQuotes: QuoteResult[]): ScoredRoute[] {
  if (allQuotes.length === 0) return [];

  const CONF_NORM: Record<string, number> = { high: 1.0, medium: 0.6, low: 0.3 };

  // Find max output for normalization
  let maxOutput = 0n;
  for (const q of allQuotes) {
    const out = BigInt(q.amountOut);
    if (out > maxOutput) maxOutput = out;
  }
  if (maxOutput === 0n) return [];

  const scored: ScoredRoute[] = allQuotes.map(q => {
    const output = BigInt(q.amountOut);
    const outputNorm = Number(output * 10000n / maxOutput) / 10000;
    const confNorm = CONF_NORM[q.confidence] || 0.3;
    const hops = q.route.length - 1; // 2 tokens = 1 hop, 3 tokens = 2 hops
    const hopPenalty = Math.max(0, hops - 1); // 1-hop = 0 penalty, 2-hop = 1

    const score = (outputNorm * 0.7) + (confNorm * 0.2) + (hopPenalty * -0.1);

    // Build label from route
    const label = q.route.map(id => {
      const entry = INTERMEDIARY_TOKENS.find(t => t.htsId === id);
      return entry?.symbol || id;
    }).join(" → ");

    // [STEP11] For 3-hop routes, show both intermediaries joined with "→"
    const intermediary = q.route.length === 3
      ? q.route[1]
      : q.route.length >= 4
        ? q.route.slice(1, -1).join("→")
        : "";

    return { quote: q, score, label, intermediary, hops };
  });

  // Sort by score descending, take top 5
  // [STEP11] Increased from 3 to 5 to surface 3-hop routes alongside 1-hop and 2-hop
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}

// ═════════════════════════════════════════════════════════════════════
// QUOTE ORCHESTRATOR  [C46] + [C52]
// ═════════════════════════════════════════════════════════════════════

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export async function ssQuote(params: {
  inputToken: string;
  outputToken: string;
  amountIn: string;
  slippage: number;
  inputDecimals: number;
  outputDecimals: number;
  network: string;
  inputAliasId?: string;
  outputAliasId?: string;
}): Promise<{ best: QuoteResult | null; allQuotes: QuoteResult[]; scoredRoutes: ScoredRoute[]; poolInfo: PoolVersionInfo | null }> {
  const { inputToken, outputToken, amountIn, slippage, inputDecimals, outputDecimals, network, inputAliasId, outputAliasId } = params;
  const amountInBigInt = BigInt(amountIn);

  // Resolve tokens to EVM addresses (HBAR → WHBAR for routing)
  const inputHtsId = inputToken === "HBAR" ? WHBAR_HTS_ID : inputToken;
  const outputHtsId = outputToken === "HBAR" ? WHBAR_HTS_ID : outputToken;
  const tokenInEvm = htsIdToEvmAddress(inputHtsId);
  const tokenOutEvm = htsIdToEvmAddress(outputHtsId);

  // [C100 Step 4] Pre-warm dynamic alias map from SaucerSwap /tokens API.
  // Must run BEFORE registering request aliases so that resolveV2AliasId()
  // has all three layers available. The call is instant on cache hit (5-min TTL).
  // [STEP12] Also pre-warm the pool graph — needed for dynamic intermediary
  // discovery and V2-only detection. Runs in parallel for zero added latency.
  await Promise.all([
    ensureDynamicAliasMap(),
    ensureServerPoolGraph(),
  ]);

  // [C99] Register request-scoped alias hints from client
  if (inputAliasId) {
    _requestAliases = new Map();
    _requestAliases.set(inputHtsId, inputAliasId);
  }
  if (outputAliasId) {
    if (!_requestAliases) _requestAliases = new Map();
    _requestAliases.set(outputHtsId, outputAliasId);
  }

  // Check quote cache
  const cacheKey = `${network}:${inputHtsId}:${outputHtsId}:${amountIn}`;
  const cachedEntry = _quoteCache.get(cacheKey);
  if (cachedEntry && Date.now() - cachedEntry.ts < QUOTE_CACHE_TTL_MS) {
    _requestAliases = null; // [C99] Clean up before early return
    return { best: cachedEntry.value, allQuotes: [cachedEntry.value], scoredRoutes: [], poolInfo: null };
  }

  // [C99] Wrap strategy execution in try/finally to guarantee alias cleanup
  try {

  // Detect pool (uses C45 cache internally)
  const poolInfo = await ssDetectPoolVersion(tokenInEvm, tokenOutEvm, network);
  // [C99] If no pool found with canonical addresses and token has V2 alias,
  // retry pool detection with V2 alias EVM addresses
  let effectivePoolInfo = poolInfo;
  if (!poolInfo) {
    const v2InEvm = resolveV2Evm(inputHtsId);
    const v2OutEvm = resolveV2Evm(outputHtsId);
    if (v2InEvm !== tokenInEvm || v2OutEvm !== tokenOutEvm) {
      console.log(`[SS-Quote] [C99] Retrying pool detection with V2 alias addresses`);
      effectivePoolInfo = await ssDetectPoolVersion(v2InEvm, v2OutEvm, network);
      if (effectivePoolInfo) {
        console.log(`[SS-Quote] [C99] Pool found via V2 alias: ${effectivePoolInfo.version} fee=${effectivePoolInfo.feeTier}`);
      }
    }
  }
  const fee = effectivePoolInfo?.feeTier || 3000;

  // [C52] Determine if multi-route probing is needed:
  // If there's no direct pool detected, probe ALL intermediaries in parallel
  const needsMultiRoute = !poolInfo && inputHtsId !== outputHtsId;

  // Launch ALL strategies in parallel
  // [C46] Wrapped with overall timeout to prevent hangs
  const timeoutPromise = new Promise<PromiseSettledResult<QuoteResult | null>[]>((resolve) =>
    setTimeout(() => resolve([]), QUOTE_OVERALL_TIMEOUT_MS)
  );
  const strategiesPromise = Promise.allSettled([
    strategyV1Router(amountInBigInt, tokenInEvm, tokenOutEvm, inputHtsId, outputHtsId, network),
    // [C90] V1 multi-hop via WHBAR — catches pairs where V1 has both legs but no direct pair
    strategyV1RouterMultiHop(amountInBigInt, tokenInEvm, tokenOutEvm, inputHtsId, outputHtsId, network),
    // [C92] ALWAYS run V2 quoter across ALL fee tiers — no pool version gate.
    // Previously gated by `poolInfo?.version === "v2" || !poolInfo` which skipped
    // V2 when pool was detected as V1. But pairs can have BOTH V1 and V2 pools.
    strategyV2Quoter(amountInBigInt, tokenInEvm, tokenOutEvm, fee, inputHtsId, outputHtsId, network),
    strategyV2MultiHop(amountInBigInt, tokenInEvm, tokenOutEvm, inputHtsId, outputHtsId, network),
    strategyApiQuote(amountIn, inputToken === "HBAR" ? WHBAR_HTS_ID : inputToken, outputToken === "HBAR" ? WHBAR_HTS_ID : outputToken),
    strategyPriceEstimate(amountInBigInt, inputHtsId, outputHtsId, inputDecimals, outputDecimals),
  ]);

  // [C52] Run multi-route probing in parallel with main strategies
  // [C92] Also probe intermediaries when pool IS detected — catches better multi-hop routes
  const multiRoutePromise = (inputHtsId !== outputHtsId)
    ? probeAllIntermediaries(amountInBigInt, tokenInEvm, tokenOutEvm, inputHtsId, outputHtsId, network, inputDecimals, outputDecimals)
    : Promise.resolve([] as QuoteResult[]);

  // [STEP11] Run 3-hop probing in parallel with 2-hop probes.
  // Discovers routes through TWO intermediary tokens: Token → A → B → Token.
  // 15 pairs × 5 fee combos = 75 probes, all concurrent — zero added latency.
  const threeHopPromise = (inputHtsId !== outputHtsId)
    ? probeThreeHopRoutes(amountInBigInt, tokenInEvm, tokenOutEvm, inputHtsId, outputHtsId, network)
    : Promise.resolve([] as QuoteResult[]);

  const [strategies, multiRouteResults, threeHopResults] = await Promise.all([
    Promise.race([strategiesPromise, timeoutPromise]),
    multiRoutePromise,
    threeHopPromise,
  ]);

  // Collect successful results from main strategies
  const allQuotes: QuoteResult[] = [];
  for (const result of strategies) {
    if (result.status === "fulfilled" && result.value) {
      allQuotes.push(result.value);
    }
  }

  // [C52] Merge multi-route results, dedup by source
  const seenSources = new Set(allQuotes.map(q => q.source));
  for (const mq of multiRouteResults) {
    if (!seenSources.has(mq.source)) {
      allQuotes.push(mq);
      seenSources.add(mq.source);
    }
  }

  // [STEP11] Merge 3-hop results, dedup by source
  for (const tq of threeHopResults) {
    if (!seenSources.has(tq.source)) {
      allQuotes.push(tq);
      seenSources.add(tq.source);
    }
  }

  console.log(`[SS-Quote] ${allQuotes.length} total quotes for ${inputHtsId}→${outputHtsId} (${multiRouteResults.length} from 2-hop, ${threeHopResults.length} from 3-hop)`);

  if (allQuotes.length === 0) return { best: null, allQuotes: [], scoredRoutes: [], poolInfo };

  // [C92] Rank by HIGHEST OUTPUT among high-confidence quotes first,
  // then by confidence for lower tiers. This ensures the user always gets
  // the best output amount, not just the first high-confidence result.
  // [STEP8] Enhanced: when two high-confidence routes have outputs within
  // 0.5%, tiebreak by (a) fewer hops, (b) V2 over V1, (c) lower total fees.
  // This ensures the theoretical best route is ALSO the safest to execute.
  allQuotes.sort((a, b) => {
    const aConf = CONFIDENCE_RANK[a.confidence] || 0;
    const bConf = CONFIDENCE_RANK[b.confidence] || 0;
    // Both high confidence → check if outputs are close enough for tiebreaking
    if (aConf === 3 && bConf === 3) {
      const aOut = BigInt(a.amountOut);
      const bOut = BigInt(b.amountOut);
      const maxOut = aOut > bOut ? aOut : bOut;
      // [STEP8] If outputs are within 0.5% of each other, apply tiebreaking
      // instead of blindly picking the higher output (which may be riskier).
      // 0.5% threshold: |diff| / max < 0.005 → |diff| * 200 < max
      const diff = aOut > bOut ? aOut - bOut : bOut - aOut;
      if (maxOut > 0n && diff * 200n <= maxOut) {
        // (a) Prefer fewer hops — 1-hop is safer than 2-hop (less slippage risk)
        const aHops = a.route.length - 1;
        const bHops = b.route.length - 1;
        if (aHops !== bHops) return aHops - bHops;
        // (b) Prefer V2 over V1 — tighter spreads, concentrated liquidity
        const aV2 = a.poolVersion === "v2" ? 1 : 0;
        const bV2 = b.poolVersion === "v2" ? 1 : 0;
        if (aV2 !== bV2) return bV2 - aV2;
        // (c) Prefer lower total fees
        const aFees = (a.feeTiers || [a.feeTier || 3000]).reduce((s: number, f: number) => s + f, 0);
        const bFees = (b.feeTiers || [b.feeTier || 3000]).reduce((s: number, f: number) => s + f, 0);
        if (aFees !== bFees) return aFees - bFees;
        // All tiebreakers equal → fall through to raw output comparison
      }
      return bOut > aOut ? 1 : bOut < aOut ? -1 : 0;
    }
    // Different confidence → prefer higher confidence
    if (aConf !== bConf) return bConf - aConf;
    // Same non-high confidence → pick highest output
    return BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : -1;
  });

  const best = allQuotes[0];

  // [STEP8] Log tiebreaking details when the winning route was NOT the highest-output route
  if (allQuotes.length > 1) {
    const bestOut = BigInt(best.amountOut);
    const secondOut = BigInt(allQuotes[1].amountOut);
    if (secondOut > bestOut) {
      const diff = secondOut - bestOut;
      const pctDiff = Number(diff * 10000n / secondOut) / 100;
      console.log(
        `[STEP8] Tiebreak selected: ${best.source} (${best.amountOut}, ${best.route.length - 1}-hop, ` +
        `${best.poolVersion || "v1"}, fees=${(best.feeTiers || [best.feeTier || 3000]).join("+")}) ` +
        `over ${allQuotes[1].source} (${allQuotes[1].amountOut}, ${allQuotes[1].route.length - 1}-hop, ` +
        `${allQuotes[1].poolVersion || "v1"}) — ${pctDiff.toFixed(2)}% less output but safer execution`
      );
    }
  }

  // [C52] Score routes for frontend comparison
  const scoredRoutes = scoreRoutes(allQuotes);

  // Cache the best result
  _quoteCache.set(cacheKey, { value: best, ts: Date.now() });
  // Evict old cache entries
  if (_quoteCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of _quoteCache) {
      if (now - v.ts > QUOTE_CACHE_TTL_MS) _quoteCache.delete(k);
    }
  }

  return { best, allQuotes, scoredRoutes, poolInfo };

  } finally {
    // [C99] Guarantee alias cleanup — prevents leaking across requests on error
    _requestAliases = null;
  }
}

// ═════════════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═════════════════════════════════════════════════════════════════════

function normalizeNetwork(raw: string | undefined | null): string {
  const n = (raw || "mainnet").toLowerCase().trim();
  return VALID_NETWORKS.has(n) ? n : "mainnet";
}

export function registerSaucerswapQuoteRoutes(app: Hono): void {

  // ────────────────────────────────────────────────────────────────────
  // GET /saucerswap/quote
  //
  // [C46] Server-side parallel multi-strategy quote fetching.
  //
  // Runs ALL 5 quote strategies concurrently and returns the best.
  // Resolves in ~1-2s vs 23+s from browser.
  //
  // Query params:
  //   inputToken    (required) HTS ID (e.g. "0.0.731861") or "HBAR"
  //   outputToken   (required) HTS ID or "HBAR"
  //   amountIn      (required) Raw amount in smallest units
  //   slippage      (optional) Percentage, default 0.5
  //   inputDecimals (optional) Defaults to 8
  //   outputDecimals(optional) Defaults to 8
  //   network       (optional) "mainnet" (default) | "testnet"
  //
  // Response (200):
  //   {
  //     amountOut: string,
  //     amountOutMin: string,       // After slippage
  //     source: string,
  //     confidence: "high"|"medium"|"low",
  //     priceImpact: number,
  //     route: string[],
  //     poolVersion?: "v1"|"v2",
  //     feeTier?: number,
  //     allQuotes: QuoteResult[],
  //     scoredRoutes: ScoredRoute[],
  //     fromCache: boolean,
  //     durationMs: number
  //   }
  //
  // Response (404):
  //   { error: "No quotes available" }
  // ────────────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/saucerswap/quote`, async (c) => {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const inputToken    = c.req.query("inputToken") || "";
    const outputToken   = c.req.query("outputToken") || "";
    const amountIn      = c.req.query("amountIn") || "";
    const slippage      = parseFloat(c.req.query("slippage") || "3");
    const inputDecimals = parseInt(c.req.query("inputDecimals") || "8", 10);
    const outputDecimals = parseInt(c.req.query("outputDecimals") || "8", 10);
    const network       = normalizeNetwork(c.req.query("network"));
    const inputAliasId  = c.req.query("inputAliasId");
    const outputAliasId = c.req.query("outputAliasId");

    // Validate inputs
    if (!inputToken || (!inputToken.startsWith("0.0.") && inputToken !== "HBAR")) {
      return c.json({ error: "Invalid inputToken", detail: 'Expected "0.0.xxxxx" or "HBAR"' }, 400);
    }
    if (!outputToken || (!outputToken.startsWith("0.0.") && outputToken !== "HBAR")) {
      return c.json({ error: "Invalid outputToken", detail: 'Expected "0.0.xxxxx" or "HBAR"' }, 400);
    }
    if (!amountIn || !/^\d+$/.test(amountIn) || amountIn === "0") {
      return c.json({ error: "Invalid amountIn", detail: "Expected positive integer string" }, 400);
    }
    if (inputToken === outputToken) {
      return c.json({ error: "inputToken and outputToken must be different" }, 400);
    }

    const startMs = Date.now();

    try {
      // Check cache for fromCache flag
      const inputHtsId = inputToken === "HBAR" ? WHBAR_HTS_ID : inputToken;
      const outputHtsId = outputToken === "HBAR" ? WHBAR_HTS_ID : outputToken;
      const cacheKey = `${network}:${inputHtsId}:${outputHtsId}:${amountIn}`;
      const wasCached = _quoteCache.has(cacheKey) && Date.now() - (_quoteCache.get(cacheKey)?.ts ?? 0) < QUOTE_CACHE_TTL_MS;

      const { best, allQuotes, scoredRoutes, poolInfo } = await ssQuote({
        inputToken, outputToken, amountIn, slippage, inputDecimals, outputDecimals, network,
        inputAliasId, outputAliasId,
      });

      const durationMs = Date.now() - startMs;

      if (!best) {
        return c.json({
          error: "No quotes available",
          inputToken, outputToken, amountIn, durationMs,
          poolInfo,
        }, 404);
      }

      // Calculate amountOutMin with slippage
      const amountOutBig = BigInt(best.amountOut);
      const slippageBps = Math.floor(slippage * 100); // 0.5% → 50 bps
      const amountOutMin = amountOutBig - (amountOutBig * BigInt(slippageBps)) / 10000n;

      // ── [STEP1] Build routeDetails for execution passthrough ──────────
      // Carries the server's winning route metadata to the client so
      // executeSaucerSwap() can skip ALL route re-discovery (4-15s saved).
      const bestVersion = (best.poolVersion || poolInfo?.version || "v1") as "v1" | "v2";
      const bestFeeTier = best.feeTier || poolInfo?.feeTier || 3000;
      const bestRoute = best.route || [inputHtsId, outputHtsId];
      const routeEvmAddresses = bestRoute.map((id: string) => {
        return bestVersion === "v2"
          ? htsIdToEvmAddress(resolveV2AliasId(id))
          : htsIdToEvmAddress(id);
      });
      const routeDetails = {
        version: bestVersion,
        // [STEP2] Use per-hop fee tiers from winning quote when available
        // [STEP11] Fallback handles 1/2/3-hop dynamically
        feeTiers: best.feeTiers || Array(bestRoute.length - 1).fill(bestFeeTier),
        routeHtsIds: bestRoute,
        pathEvmAddresses: routeEvmAddresses,
        // [STEP2] Packed path from QuoterV2 — the EXACT bytes for exactInput()
        packedPathHex: best.packedPathHex || null,
        poolAddress: poolInfo?.poolAddress,
        source: best.source,
        rawAmountOut: best.amountOut,
        validatedAt: Date.now(),
      };

      return c.json({
        amountOut: best.amountOut,
        amountOutMin: amountOutMin.toString(),
        source: best.source,
        confidence: best.confidence,
        priceImpact: best.priceImpact,
        route: best.route,
        poolVersion: best.poolVersion || poolInfo?.version,
        feeTier: best.feeTier || poolInfo?.feeTier,
        allQuotes,
        scoredRoutes,
        poolInfo,
        fromCache: wasCached,
        durationMs,
        // [C100 Step 4] Diagnostics: how many dynamic aliases are active
        dynamicAliases: _dynamicAliasMap?.size ?? 0,
        // [STEP1] Validated route for client execution passthrough
        routeDetails,
      });
    } catch (err: any) {
      console.log(`[SS-Quote] /quote error: ${err?.message || err}`);
      return c.json({
        error: "Quote failed",
        detail: err?.message || "Unknown error",
        durationMs: Date.now() - startMs,
      }, 502);
    }
  });
}
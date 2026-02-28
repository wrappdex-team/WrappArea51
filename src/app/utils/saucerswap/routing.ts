/**
 * [C48] SaucerSwap Routing & Pool Route Definitions
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: Swap path building, multi-hop route finding,
 * intermediary token selection, pool route definitions (static & live),
 * and the client-facing findSwapRoute() function.
 *
 * buildSwapPath()           -- Build the on-chain token path for a swap
 * findSwapRoute()           -- Find the best route between two tokens
 * getIntermediaryTokens()   -- Get candidate intermediary tokens for multi-hop
 * findBestMultiHopRoute()   -- [DEPRECATED] Try multi-hop via intermediary tokens (behind feature flag)
 * getPoolRoutes()           -- Static fallback pool routes
 * fetchPoolRoutes()         -- Live pool routes from backend proxy
 */

import { log } from "../logger";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import type { AllowedToken, HederaNetwork } from "./tokens";
import {
  TOKEN_BY_SYMBOL,
  TOKEN_BY_HTS_ID,
  resolveToken,
  resolveTokenByHtsId,
  getSaucerswapRoutingEvmAddress,
  getSaucerswapRoutingId,
  evmAddressToHtsId,
  htsIdToEvmAddress,
} from "./tokens";
import type { PoolVersionInfo } from "./pools";
import { detectPoolVersion } from "./pools";
// SAUCERSWAP_WHBAR_CONTRACT is no longer used here — V2 WHBAR correction
// is applied at V2 execution time in swap-engine.ts (ensureWhbarContractForV2)

// ═════════════════════════════════════════════════════════════════════
// ── [C82] API-BASED POOL GRAPH ROUTING ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
//
// Instead of making N individual detectPoolVersion() calls per swap
// (each making 4-6 network requests), we build a routing graph from the
// cached SaucerSwap API pool lists (V2 + V1). Route finding is then a
// simple BFS through the in-memory graph — instant, reliable, no
// transient network failures causing wrong routing.
//
// This matches how SaucerSwap.finance routes: they build a local graph
// from their own pool data and find optimal paths locally.
// ═══════════════════════════════════════════════════════════════════════

interface PoolEdge {
  otherToken: string;  // HTS ID of the other token in the pool
  version: "v1" | "v2";
  fee: number;         // Fee tier (e.g. 3000 = 0.3%)
  poolAddress?: string;
}

/** Pool graph: tokenHtsId → array of edges to other tokens */
type PoolGraph = Map<string, PoolEdge[]>;

let _poolGraph: PoolGraph | null = null;
let _poolGraphTs = 0;
const POOL_GRAPH_TTL_MS = 300_000; // 5 min (matches API cache TTL)

/**
 * [C82] Build a routing graph from SaucerSwap V2 + V1 pool API caches.
 * The graph maps each token HTS ID to its connected pools.
 * Returns a cached graph if fresh (5-min TTL).
 * [STEP4] forceRefresh: invalidate cache and rebuild from API.
 */
async function buildPoolGraph(network: HederaNetwork, forceRefresh = false): Promise<PoolGraph> {
  if (!forceRefresh && _poolGraph && Date.now() - _poolGraphTs < POOL_GRAPH_TTL_MS) {
    return _poolGraph;
  }

  const graph: PoolGraph = new Map();

  const addEdge = (tokenA: string, tokenB: string, version: "v1" | "v2", fee: number, poolAddr?: string) => {
    if (!tokenA || !tokenB || tokenA === tokenB) return;
    if (!graph.has(tokenA)) graph.set(tokenA, []);
    if (!graph.has(tokenB)) graph.set(tokenB, []);
    graph.get(tokenA)!.push({ otherToken: tokenB, version, fee, poolAddress: poolAddr });
    graph.get(tokenB)!.push({ otherToken: tokenA, version, fee, poolAddress: poolAddr });
  };

  // Lazy import to avoid circular deps
  const { fetchSaucerSwapV2PoolList } = await import("./pools");

  // ── Add V2 pools ──
  try {
    const v2Pools = await fetchSaucerSwapV2PoolList();
    if (v2Pools && v2Pools.length > 0) {
      for (const pool of v2Pools) {
        const tA = (pool as any).tokenA || (pool as any).token0 || {};
        const tB = (pool as any).tokenB || (pool as any).token1 || {};
        const idA = tA.id || (pool as any).token0Id || "";
        const idB = tB.id || (pool as any).token1Id || "";
        const fee = (pool as any).fee ?? (pool as any).feeTier ?? (pool as any).feeRate ?? 3000;
        const poolAddr = (pool as any).contractId || undefined;
        if (idA && idB) {
          addEdge(idA, idB, "v2", fee, poolAddr);
        }
      }
      log.info("PoolGraph", `Added ${v2Pools.length} V2 pools to graph`);
    }
  } catch (e: any) {
    log.warn("PoolGraph", `V2 pool fetch failed: ${e?.message}`);
  }

  // ── Add V1 pools ──
  try {
    const { saucerFetch } = await import("./prices");
    // V1 pools may already be cached
    const v1Res = await saucerFetch("/v1/pools", 10000);
    if (v1Res) {
      const v1Data = await v1Res.json();
      const v1Pools: any[] = Array.isArray(v1Data) ? v1Data : Object.values(v1Data);
      for (const pool of v1Pools) {
        const rawA = pool.tokenA;
        const rawB = pool.tokenB;
        const idA = typeof rawA === "string" ? rawA
          : (rawA?.id || rawA?.tokenId || pool.token0?.id || pool.token0Id || "");
        const idB = typeof rawB === "string" ? rawB
          : (rawB?.id || rawB?.tokenId || pool.token1?.id || pool.token1Id || "");
        const poolAddr = pool.contractId || undefined;
        if (idA && idB) {
          addEdge(idA, idB, "v1", 3000, poolAddr); // V1 AMM has fixed 0.3% fee
        }
      }
      log.info("PoolGraph", `Added ${v1Pools.length} V1 pools to graph (total nodes: ${graph.size})`);
    }
  } catch (e: any) {
    log.warn("PoolGraph", `V1 pool fetch failed: ${e?.message}`);
  }

  // ── [ROUTING-FIX] Bidirectional alias resolution ──────────────────────
  // V2 pools may register tokens under their ALIAS IDs (e.g. SMACKM 0.0.10152778)
  // while our token registry uses the CANONICAL IDs (0.0.1055495). These
  // differ by exactly 1 and represent the same asset. Mirror all edges
  // from one to the other so BFS finds V2 pools regardless of which
  // ID the lookup starts from.
  for (const [htsId, token] of TOKEN_BY_HTS_ID.entries()) {
    // Only process entries where the map key IS the canonical htsId
    // (skip alias entries like 0.0.10096415 → SMACKM which are just lookup aliases)
    if (htsId !== token.htsId) continue;
    if (!token.saucerswapAliasId || !graph.has(token.saucerswapAliasId)) continue;
    // Skip if canonical is same as alias (shouldn't happen but safety check)
    if (token.htsId === token.saucerswapAliasId) continue;

    const aliasEdges = graph.get(token.saucerswapAliasId)!;
    // Check what the CANONICAL node already has (destination dedup)
    const canonicalEdges = graph.get(token.htsId) || [];
    const existingOnCanonical = new Set(canonicalEdges.map(e => `${e.otherToken}:${e.version}:${e.fee}`));
    let mirrored = 0;
    for (const edge of aliasEdges) {
      const key = `${edge.otherToken}:${edge.version}:${edge.fee}`;
      if (!existingOnCanonical.has(key)) {
        addEdge(token.htsId, edge.otherToken, edge.version, edge.fee, edge.poolAddress);
        existingOnCanonical.add(key);
        mirrored++;
      }
    }
    if (mirrored > 0) {
      log.info("PoolGraph", `[ROUTING-FIX] Mirrored ${mirrored} edges from alias ${token.saucerswapAliasId} → canonical ${token.htsId} (${token.symbol})`);
    }
  }

  // ── [SWAP-FIX-2] WHBAR ID normalization ──────────────────────────────
  // V2 pools may register WHBAR under its CONTRACT ID (0.0.1456985)
  // while our token registry uses the TOKEN ID (0.0.1456986). These
  // differ by exactly 1 and represent the same asset. Mirror all edges
  // from one to the other so BFS finds V2 pools regardless of which
  // WHBAR ID the lookup starts from.
  const WHBAR_TOKEN = "0.0.1456986";
  const WHBAR_CONTRACT = "0.0.1456985";
  const whbarIds = [WHBAR_TOKEN, WHBAR_CONTRACT];
  for (const srcId of whbarIds) {
    const dstId = srcId === WHBAR_TOKEN ? WHBAR_CONTRACT : WHBAR_TOKEN;
    const srcEdges = graph.get(srcId);
    if (srcEdges && srcEdges.length > 0) {
      if (!graph.has(dstId)) graph.set(dstId, []);
      const dstEdges = graph.get(dstId)!;
      const existingPairs = new Set(dstEdges.map(e => `${e.otherToken}:${e.version}:${e.fee}`));
      let mirrored = 0;
      for (const edge of srcEdges) {
        const key = `${edge.otherToken}:${edge.version}:${edge.fee}`;
        if (!existingPairs.has(key)) {
          dstEdges.push({ ...edge });
          existingPairs.add(key);
          mirrored++;
        }
      }
      if (mirrored > 0) {
        log.info("PoolGraph", `[SWAP-FIX-2] Mirrored ${mirrored} edges from WHBAR ${srcId} → ${dstId}`);
      }
    }
  }

  _poolGraph = graph;
  _poolGraphTs = Date.now();
  return graph;
}

/**
 * [STEP5] Pre-warm the pool routing graph at connect time.
 * Exported wrapper around the private buildPoolGraph() so that
 * WalletContext can kick off the graph build in the background
 * before the user initiates their first swap.
 * Returns the node count for diagnostic logging.
 */
export async function prewarmPoolGraph(network: HederaNetwork): Promise<number> {
  const graph = await buildPoolGraph(network);
  return graph.size;
}

/**
 * [C82] Resolve a token HTS ID to its graph key.
 *
 * SaucerSwap pools may use alias IDs (e.g. WBTC 0.0.1969769) while our
 * token registry uses canonical IDs (0.0.1055483). This function checks
 * if the canonical ID is in the graph; if not, tries the saucerswapAliasId.
 */
function resolveGraphKey(htsId: string, graph: PoolGraph): string {
  if (graph.has(htsId)) return htsId;
  // Check if this token has an alias that IS in the graph
  const token = TOKEN_BY_HTS_ID.get(htsId);
  if (token?.saucerswapAliasId && graph.has(token.saucerswapAliasId)) {
    return token.saucerswapAliasId;
  }
  // [ROUTING-FIX] Bidirectional: if we were given the ALIAS ID, check the
  // CANONICAL htsId in the graph. This handles tokens like SMACKM where
  // V1 pools use the canonical ID but routing passes the alias.
  if (token && token.htsId !== htsId && graph.has(token.htsId)) {
    return token.htsId;
  }
  // [SWAP-FIX-2] Also handle WHBAR contract ↔ token ID mapping.
  // V2 pools may register under 0.0.1456985 (contract) while routing
  // uses 0.0.1456986 (token), or vice versa.
  if (htsId === "0.0.1456986" && graph.has("0.0.1456985")) return "0.0.1456985";
  if (htsId === "0.0.1456985" && graph.has("0.0.1456986")) return "0.0.1456986";
  return htsId;
}

// ═══════════════════════════════════════════════════════════════════════
// ── [C100-S6] ALIAS-AWARE GRAPH HELPERS ─────────────────────────────
//
// Bridge tokens exist in the graph under TWO different HTS IDs:
//   • V1 pools use the CANONICAL ID  (e.g. LINK 0.0.1055495)
//   • V2 pools use the ALIAS ID      (e.g. LINK 0.0.10152778)
//
// These are separate nodes in the graph. Without alias-awareness,
// BFS starting from one node misses edges on the other, causing:
//   • V2 routes invisible when starting from canonical ID
//   • V1 routes invisible when starting from alias ID
//
// These helpers merge edges from both nodes for comprehensive routing
// and resolve EVM addresses correctly per pool version.
// ═══════════════════════════════════════════════════════════════════════

/**
 * [C100-S6] Get ALL edges for a token, merging canonical and alias nodes.
 *
 * For a bridge token like LINK:
 *   • Canonical node (0.0.1055495) has V1 edges
 *   • Alias node (0.0.10152778) has V2 edges
 * This function returns edges from BOTH, enabling BFS to find routes
 * through either pool version from any starting point.
 */
function getAllEdges(htsId: string, graph: PoolGraph): PoolEdge[] {
  const edges: PoolEdge[] = [];
  const seen = new Set<string>(); // Dedup edges by otherToken+version+fee

  const addEdges = (nodeId: string) => {
    const nodeEdges = graph.get(nodeId);
    if (!nodeEdges) return;
    for (const e of nodeEdges) {
      const key = `${e.otherToken}:${e.version}:${e.fee}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(e);
      }
    }
  };

  // 1. Direct lookup
  addEdges(htsId);

  // 2. Cross-reference via token registry
  const token = resolveTokenByHtsId(htsId);
  if (token) {
    // If we were given the alias, also check canonical
    if (token.htsId !== htsId) addEdges(token.htsId);
    // If we were given the canonical, also check alias
    const aliasId = getSaucerswapRoutingId(token);
    if (aliasId !== htsId) addEdges(aliasId);
  }

  // 3. [SWAP-FIX-2] WHBAR contract ↔ token ID cross-reference
  if (htsId === "0.0.1456986") addEdges("0.0.1456985");
  if (htsId === "0.0.1456985") addEdges("0.0.1456986");

  return edges;
}

/**
 * [C100-S6] Get ALL known graph keys (canonical + alias) for a token.
 * Used for matching: when checking "does this edge connect to the output?",
 * we need to check against both the canonical and alias output keys.
 */
function getAllGraphKeys(htsId: string, graph: PoolGraph): Set<string> {
  const keys = new Set<string>();
  keys.add(htsId);

  const token = resolveTokenByHtsId(htsId);
  if (token) {
    if (graph.has(token.htsId)) keys.add(token.htsId);
    const aliasId = getSaucerswapRoutingId(token);
    if (graph.has(aliasId)) keys.add(aliasId);
  }

  // Also check reverse: if htsId is canonical, check if alias exists in graph
  const directToken = TOKEN_BY_HTS_ID.get(htsId);
  if (directToken?.saucerswapAliasId && graph.has(directToken.saucerswapAliasId)) {
    keys.add(directToken.saucerswapAliasId);
  }

  // [SWAP-FIX-2] WHBAR contract ↔ token ID
  if (htsId === "0.0.1456986" && graph.has("0.0.1456985")) keys.add("0.0.1456985");
  if (htsId === "0.0.1456985" && graph.has("0.0.1456986")) keys.add("0.0.1456986");

  return keys;
}

/**
 * [C100-S6] Resolve a graph key to the correct EVM address for a given pool version.
 *
 * V2 pools use ERC20Wrapper (alias) addresses — the packed path for exactInput
 * MUST encode these addresses, not canonical bridge token addresses.
 * V1 pools use canonical bridge token addresses.
 *
 * Priority:
 *   1. Look up token in registry (static + dynamic)
 *   2. If found, use getSaucerswapRoutingId for V2, token.htsId for V1
 *   3. If not found, use graphKey as-is (likely already correct from API data)
 */
function resolveEvmForVersion(graphKey: string, version: "v1" | "v2"): string {
  const token = resolveTokenByHtsId(graphKey);
  if (token) {
    if (version === "v2") {
      // V2: use alias EVM address (ERC20Wrapper that V2 pools are paired with)
      // NOTE: WHBAR CONTRACT correction (0.0.1456986→0.0.1456985) is intentionally
      // NOT applied here. The V2 WHBAR fix is applied at the point of V2 execution
      // in swap-engine.ts (ensureWhbarContractForV2). Applying it here would
      // contaminate pathAddresses that flow to V1 fallback code — V1 Factory
      // pairs use the WHBAR TOKEN (0.0.1456986), not the CONTRACT (0.0.1456985).
      // The V2 execution paths (executeSaucerSwapV2Direct line 351-356 and
      // executeSaucerSwapV2MultiHop line 1153) both call ensureWhbarContractForV2()
      // on every token address before encoding the V2 calldata.
      return htsIdToEvmAddress(getSaucerswapRoutingId(token));
    } else {
      // V1: use canonical EVM address (original bridge token)
      return htsIdToEvmAddress(token.htsId);
    }
  }
  // Not in registry — graphKey came from pool API, should already be correct
  return htsIdToEvmAddress(graphKey);
}

/**
 * [C82] Find the optimal route through the pool graph using BFS.
 *
 * Returns the best 1-hop or 2-hop route, preferring:
 *   1. Direct V2 pool (single hop, tightest spread)
 *   2. Direct V1 pool (single hop)
 *   3. All-V2 2-hop route (through any intermediary in the graph)
 *   4. All-V1 2-hop route
 *   5. Mixed 2-hop route (last resort)
 *
 * The graph already contains ALL pools from SaucerSwap API — no
 * on-chain calls needed. This replaces sequential detectPoolVersion().
 */
export async function findRouteViaGraph(
  inputHtsId: string,
  outputHtsId: string,
  network: HederaNetwork,
  forceRefresh = false,
): Promise<{
  direct: PoolVersionInfo | null;
  multiHop: { hops: PoolVersionInfo[]; tokens: string[] } | null;
} | null> {
  const graph = await buildPoolGraph(network, forceRefresh);
  if (graph.size === 0) return null;

  const inKey = resolveGraphKey(inputHtsId, graph);
  const outKey = resolveGraphKey(outputHtsId, graph);

  log.info("PoolGraph", `Finding route: ${inputHtsId} (graph key: ${inKey}) → ${outputHtsId} (graph key: ${outKey})`);

  // ── Step 1: Check for direct pool ──
  const inEdges = getAllEdges(inKey, graph);
  let bestDirect: PoolEdge | null = null;

  for (const edge of inEdges) {
    if (getAllGraphKeys(edge.otherToken, graph).has(outKey)) {
      if (!bestDirect || (edge.version === "v2" && bestDirect.version !== "v2")) {
        bestDirect = edge;
      }
    }
  }

  if (bestDirect) {
    log.info("PoolGraph", `Direct pool found: ${bestDirect.version} fee=${bestDirect.fee}`);
    return {
      direct: { version: bestDirect.version, feeTier: bestDirect.fee, poolAddress: bestDirect.poolAddress },
      multiHop: null,
    };
  }

  // ── Step 2: BFS for 2-hop routes ──
  type TwoHopRoute = {
    mid: string;
    hop1: PoolEdge;
    hop2: PoolEdge;
    score: number; // lower is better
  };
  const candidates: TwoHopRoute[] = [];

  // [C100-S6] Pre-compute all known keys for input/output to avoid
  // self-loops when intermediary is a canonical/alias twin of input/output.
  const inKeys = getAllGraphKeys(inKey, graph);
  const outKeys = getAllGraphKeys(outKey, graph);

  for (const hop1 of inEdges) {
    const midKey = hop1.otherToken;
    if (inKeys.has(midKey) || outKeys.has(midKey)) continue;

    const midEdges = getAllEdges(midKey, graph);
    for (const hop2 of midEdges) {
      if (outKeys.has(hop2.otherToken)) {
        // Score: V2+V2=0, V2+V1=1, V1+V2=1, V1+V1=2
        const score = (hop1.version === "v1" ? 1 : 0) + (hop2.version === "v1" ? 1 : 0);
        candidates.push({ mid: midKey, hop1, hop2, score });
      }
    }
  }

  if (candidates.length === 0) {
    log.info("PoolGraph", `No route found in graph (${graph.size} nodes)`);
    return null;
  }

  // Sort by score (prefer all-V2), then by lowest total fees
  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return (a.hop1.fee + a.hop2.fee) - (b.hop1.fee + b.hop2.fee);
  });

  const best = candidates[0];
  const category = best.score === 0 ? "all-V2" : best.score === 2 ? "all-V1" : "mixed";
  log.info("PoolGraph", `Best 2-hop route via ${best.mid}: ${best.hop1.version}(fee=${best.hop1.fee}) → ${best.hop2.version}(fee=${best.hop2.fee}) [${category}] (${candidates.length} total candidates)`);

  // [C100-S6] Convert graph HTS IDs to version-appropriate EVM addresses.
  // V2 hops MUST use alias (ERC20Wrapper) addresses in the packed path.
  // V1 hops MUST use canonical (original bridge token) addresses.
  // For all-V2 routes (score=0): all tokens resolve to alias EVM.
  // For all-V1 routes (score=2): all tokens resolve to canonical EVM.
  // For mixed routes: each token resolves based on the hop version it
  // participates in. Since mixed routes go to V1 execution anyway,
  // canonical is used for safety.
  const routeVersion: "v1" | "v2" = best.score === 0 ? "v2" : "v1";
  const inEvm = resolveEvmForVersion(inKey, best.hop1.version);
  const midEvm = resolveEvmForVersion(best.mid, routeVersion);
  const outEvm = resolveEvmForVersion(outKey, best.hop2.version);

  if (routeVersion === "v2") {
    log.info("PoolGraph", `[C100-S6] V2 alias resolution: in=${inKey}→${evmAddressToHtsId(inEvm)}, mid=${best.mid}→${evmAddressToHtsId(midEvm)}, out=${outKey}→${evmAddressToHtsId(outEvm)}`);
  }

  // Convert graph HTS IDs to EVM addresses for swap-engine compatibility
  return {
    direct: null,
    multiHop: {
      hops: [
        { version: best.hop1.version, feeTier: best.hop1.fee, poolAddress: best.hop1.poolAddress },
        { version: best.hop2.version, feeTier: best.hop2.fee, poolAddress: best.hop2.poolAddress },
      ],
      tokens: [inEvm, midEvm, outEvm],
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// ── SWAP PATH BUILDING ───────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * Build the on-chain token path for a V1 router swap.
 * If input/output are both non-WHBAR non-stable, routes through WHBAR.
 * Stable-to-stable (USDC<->USDT) is direct.
 */
export function buildSwapPath(input: AllowedToken, output: AllowedToken): AllowedToken[] {
  const whbar = TOKEN_BY_SYMBOL.get("WHBAR");
  if (!whbar) return [input, output];

  // Treat native HBAR as WHBAR for path routing decisions
  const effectiveInputSym = input.isNative ? "WHBAR" : input.symbol;
  const effectiveOutputSym = output.isNative ? "WHBAR" : output.symbol;

  if (effectiveInputSym === "WHBAR" || effectiveOutputSym === "WHBAR") {
    return [input, output];
  }

  const stables = ["USDC", "USDT"];
  if (stables.includes(effectiveInputSym) && stables.includes(effectiveOutputSym)) {
    return [input, output];
  }

  return [input, whbar, output];
}

// ════════════════════════════════════════════════════════════════════════
// ── INTERMEDIARY TOKEN SELECTION ─────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * Get intermediary tokens for multi-hop routing.
 *
 * [C78-02] Aligned with SaucerSwap's production routing strategy.
 * SaucerSwap routes through the deepest liquidity hubs, ordered by
 * total pool TVL. WHBAR is the primary hub (paired with nearly all
 * tokens), followed by USDC/USDT stablecoin corridors, then SAUCE
 * (governance token with deep incentivized pools), HBARX, DAI, WETH.
 *
 * Excludes the input and output tokens to avoid circular routes.
 * [C26-01] Also excludes WHBAR when input/output is native HBAR
 * to prevent the self-loop bug (WHBAR->WHBAR pool check).
 */
export function getIntermediaryTokens(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
): string[] {
  const whbar = TOKEN_BY_SYMBOL.get("WHBAR");
  const usdc = TOKEN_BY_SYMBOL.get("USDC");
  const sauce = TOKEN_BY_SYMBOL.get("SAUCE");
  const usdch = TOKEN_BY_SYMBOL.get("USDCh");
  // [C36-04] Changed from "USDTh" to "USDT" after merging USDTh into USDT.
  const usdth = TOKEN_BY_SYMBOL.get("USDT");
  const hbarx = TOKEN_BY_SYMBOL.get("HBARX");
  // [C78-02] Added DAI and WETH as intermediary candidates — these have
  // significant V1/V2 pools on SaucerSwap (DAI/WHBAR, WETH/WHBAR, etc.)
  const dai = TOKEN_BY_SYMBOL.get("DAI");
  const weth = TOKEN_BY_SYMBOL.get("WETH");

  // Ordered by liquidity depth — WHBAR first (highest TVL hub)
  const candidates: AllowedToken[] = [];
  if (whbar) candidates.push(whbar);
  if (usdc) candidates.push(usdc);
  if (usdth) candidates.push(usdth);
  if (sauce) candidates.push(sauce);
  if (usdch) candidates.push(usdch);
  if (hbarx) candidates.push(hbarx);
  if (dai) candidates.push(dai);
  if (weth) candidates.push(weth);

  // Exclude tokens that are the input or output themselves.
  // [C26-01] For native HBAR, also exclude WHBAR since HBAR is internally
  // routed as WHBAR -- including it as intermediary creates a self-loop
  // (e.g., WHBAR->WHBAR pool check) that always fails.
  const inputEvm = getSaucerswapRoutingEvmAddress(inputToken).toLowerCase();
  const outputEvm = getSaucerswapRoutingEvmAddress(outputToken).toLowerCase();

  // Also get WHBAR EVM for native HBAR exclusion
  const whbarEvm = whbar ? getSaucerswapRoutingEvmAddress(whbar).toLowerCase() : "";
  const isInputEffectivelyWhbar = inputToken.isNative || inputEvm === whbarEvm;
  const isOutputEffectivelyWhbar = outputToken.isNative || outputEvm === whbarEvm;

  return candidates
    .map(t => getSaucerswapRoutingEvmAddress(t))
    .filter(addr => {
      const low = addr.toLowerCase();
      if (low === inputEvm || low === outputEvm) return false;
      // [C26-01] Exclude WHBAR when native HBAR is input/output
      if (low === whbarEvm && (isInputEffectivelyWhbar || isOutputEffectivelyWhbar)) return false;
      return true;
    });
}

// ═══════════════════════════════════════════════════════════════════════
// [STEP4] FEATURE FLAG: Legacy multi-hop routing via sequential RPC calls.
// Set to true ONLY if graph-based routing (findRouteViaGraph) produces
// incorrect results for a specific pair. This flag re-enables the old
// detectPoolVersion()-per-intermediary approach (32-48 RPC calls).
// SCHEDULED FOR REMOVAL: 2 weeks after Step 4 deployment (≈ March 13, 2026).
// ═══════════════════════════════════════════════════════════════════════
const LEGACY_MULTIHOP_ENABLED = false;

/**
 * @deprecated [STEP4] Replaced by findRouteViaGraph() which uses the
 * in-memory pool graph (BFS, zero network calls) instead of sequential
 * detectPoolVersion() calls (32-48 RPCs, 8-16s latency).
 * Retained behind LEGACY_MULTIHOP_ENABLED feature flag for safety.
 * Delete after March 13, 2026 if no issues reported.
 *
 * Find the best multi-hop route through intermediary tokens.
 * Tries each intermediary and returns the first valid route (V2 preferred).
 *
 * [C26-01] Adds safety check: skips intermediaries whose EVM address matches
 * the input or output token to prevent self-loop pool checks (e.g., WHBAR->WHBAR).
 *
 * Returns null if no valid route exists through any intermediary.
 */
export async function findBestMultiHopRoute(
  tokenInEvm: string,
  tokenOutEvm: string,
  intermediaries: string[],
  network: HederaNetwork,
): Promise<{ hops: PoolVersionInfo[]; tokens: string[] } | null> {
  const inLow = tokenInEvm.toLowerCase();
  const outLow = tokenOutEvm.toLowerCase();

  // [C77-01] Collect ALL valid routes, then pick the best one.
  // [C77-08] Priority: all-V2 > all-V1 > mixed.
  //   - V2 concentrated liquidity has tighter spreads and better execution
  //     for major pairs (the exactInput ABI encoding is now fixed by C77-06).
  //   - V1 has broadest pair coverage as fallback.
  //   - Mixed routes are last resort — handled as V1 fallback by swap-engine.
  // Previously returned the FIRST valid route regardless of version mix,
  // causing mixed routes to revert on V2 exactInput.
  type RouteCandidate = { hops: PoolVersionInfo[]; tokens: string[]; mid: string };
  const allV1Routes: RouteCandidate[] = [];
  const allV2Routes: RouteCandidate[] = [];
  const mixedRoutes: RouteCandidate[] = [];

  for (const mid of intermediaries) {
    const midLow = mid.toLowerCase();
    const midId = evmAddressToHtsId(mid);

    // [C26-01] Skip intermediaries that are the same as input or output --
    // prevents self-loop (e.g., WHBAR->WHBAR) when HBAR->Token uses WHBAR as both
    // the effective input (via buildSwapPath) and an intermediary candidate.
    if (midLow === inLow || midLow === outLow) {
      log.debug("Route", `Multi-hop: skipping ${midId} -- same as input or output`);
      continue;
    }

    log.debug("Route", `Multi-hop: trying intermediary ${midId} (${mid.slice(0, 14)}...)`);

    // Check both legs concurrently
    const [hop1, hop2] = await Promise.all([
      detectPoolVersion(tokenInEvm, mid, network),
      detectPoolVersion(mid, tokenOutEvm, network),
    ]);

    if (hop1 && hop2) {
      const route: RouteCandidate = {
        hops: [hop1, hop2],
        tokens: [tokenInEvm, mid, tokenOutEvm],
        mid: midId,
      };
      const isAllV1 = hop1.version === "v1" && hop2.version === "v1";
      const isAllV2 = hop1.version === "v2" && hop2.version === "v2";

      log.debug("Route", `Multi-hop: route found via ${midId} -- hop1=${hop1.version}(fee=${hop1.feeTier}) hop2=${hop2.version}(fee=${hop2.feeTier}) [${isAllV1 ? "all-V1" : isAllV2 ? "all-V2" : "mixed"}]`);

      if (isAllV1) allV1Routes.push(route);
      else if (isAllV2) allV2Routes.push(route);
      else mixedRoutes.push(route);

      // [C77-08] Early exit if we found BOTH an all-V2 and all-V1 route
      // through the first intermediary (WHBAR). No need to check further.
      if (allV2Routes.length > 0 && allV1Routes.length > 0) break;
      // Also early exit if we found an all-V2 route (preferred).
      if (isAllV2) break;
    } else {
      log.debug("Route", `Multi-hop: ${midId} -- hop1=${hop1 ? "ok" : "no"} hop2=${hop2 ? "ok" : "no"}`);
    }
  }

  // [C77-08] Pick the best route: prefer all-V2, then all-V1, then mixed.
  // V2 concentrated liquidity offers tighter spreads and better execution.
  // V1 has broadest pair coverage as fallback.
  // Mixed routes are last resort (swap-engine treats them as V1 path arrays).
  const best = allV2Routes[0] || allV1Routes[0] || mixedRoutes[0] || null;
  if (best) {
    const category = allV1Routes.includes(best) ? "all-V1" : allV2Routes.includes(best) ? "all-V2" : "mixed";
    log.debug("Route", `Multi-hop: SELECTED route via ${best.mid} [${category}] (${allV1Routes.length} V1, ${allV2Routes.length} V2, ${mixedRoutes.length} mixed candidates)`);
    return { hops: best.hops, tokens: best.tokens };
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// ── POOL ROUTE TYPES & DATA ───────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

export interface PoolRoute {
  id: string;
  tokenA: AllowedToken;
  tokenB: AllowedToken;
  fee: number;
  tvlUsd: number;
  volume24hUsd: number;
  apr: number;
  poolAddress: string; // SaucerSwap V1/V2 pool contract on Hedera
  source?: "v1" | "v2";
}

// -- Live pool data cache (populated by fetchPoolRoutes) --
let _livePoolRouteCache: PoolRoute[] | null = null;
let _livePoolCacheTs = 0;
const POOL_ROUTE_CACHE_TTL = 60_000; // 60s

/**
 * Resolve a pool token symbol to the correct AllowedToken.
 * Maps "HBAR" display label (from [C22-01] normalization) back to the
 * native HBAR AllowedToken for swap execution compatibility.
 */
function resolvePoolToken(symbol: string): AllowedToken | undefined {
  // "HBAR" from backend normalization -> native HBAR token
  if (symbol === "HBAR") return TOKEN_BY_SYMBOL.get("HBAR");
  // Direct match
  const direct = TOKEN_BY_SYMBOL.get(symbol);
  if (direct) return direct;
  // [C24-01] Strip [hts]/[HTS] suffix for resilience
  const cleaned = symbol.replace("[hts]", "").replace("[HTS]", "");
  if (cleaned !== symbol) return TOKEN_BY_SYMBOL.get(cleaned);
  // [C36-04] HBAR.h aliases
  const upper = symbol.toUpperCase();
  if (upper === "HBAR.H" || upper === "HBARH" || upper === "HBAR.\u0126") {
    return TOKEN_BY_SYMBOL.get("HBAR.\u0127");
  }
  // [C36-04] Try HTS ID-based fallback
  const byId = TOKEN_BY_HTS_ID.get(symbol);
  if (byId) return byId;
  return undefined;
}

/**
 * Fetch live pool routes from the WRAPpDEX backend proxy.
 * Backend fetches from SaucerSwap V1+V2 APIs, merges + sorts by TVL,
 * and normalizes WHBAR -> HBAR display names ([C22-01]).
 *
 * Returns PoolRoute[] for the swap panel pool table.
 * Caches 60s client-side to avoid redundant network calls.
 */
export async function fetchPoolRoutes(): Promise<PoolRoute[]> {
  // Return cache if fresh
  if (_livePoolRouteCache && Date.now() - _livePoolCacheTs < POOL_ROUTE_CACHE_TTL) {
    return _livePoolRouteCache;
  }

  try {
    const url = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/saucerswap/pools`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${publicAnonKey}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      log.warn("PoolRoutes", `Backend proxy -> HTTP ${res.status}`);
      return getPoolRoutes(); // Fallback to static
    }

    const data = await res.json();
    if (!data?.pools || !Array.isArray(data.pools)) {
      log.warn("PoolRoutes", "Invalid response structure");
      return getPoolRoutes();
    }

    const routes: PoolRoute[] = data.pools
      .map((p: any) => {
        const tA = resolvePoolToken(p.tokenA?.symbol || "");
        const tB = resolvePoolToken(p.tokenB?.symbol || "");
        if (!tA || !tB) return null;
        return {
          id: p.id || p.contractId || `${tA.symbol}-${tB.symbol}`,
          tokenA: tA,
          tokenB: tB,
          fee: typeof p.fee === "number" ? p.fee : 0.3,
          tvlUsd: typeof p.tvl === "number" ? p.tvl : 0,
          volume24hUsd: typeof p.volume24h === "number" ? p.volume24h : 0,
          apr: typeof p.totalAPR === "number" ? p.totalAPR : (typeof p.apr === "number" ? p.apr : 0),
          poolAddress: p.contractId || "factory-resolved",
          source: (p.source || "v1") as "v1" | "v2",
        };
      })
      .filter((r: PoolRoute | null): r is PoolRoute => r !== null && r.tvlUsd >= 100);

    if (routes.length > 0) {
      _livePoolRouteCache = routes;
      _livePoolCacheTs = Date.now();
      log.info("PoolRoutes", `Loaded ${routes.length} live pools from backend`);
      return routes;
    }
  } catch (err: any) {
    log.warn("PoolRoutes", `fetchPoolRoutes failed: ${err?.message || err}`);
  }

  return getPoolRoutes(); // Fallback
}

/**
 * Static pool route fallback -- used when the backend is unreachable.
 * [C22-01] Displays HBAR (native) instead of WHBAR.
 * Returns cached live data if available.
 */
export function getPoolRoutes(): PoolRoute[] {
  const tok = (sym: string) => TOKEN_BY_SYMBOL.get(sym)!;
  // Pool addresses are resolved on-chain by the SaucerSwap V1 Factory (0.0.1062784).
  // The router's swap functions call Factory.getPair() internally.
  const FR = "factory-resolved";
  // [C22-01] tokenA uses HBAR (native) instead of WHBAR for user-facing display.
  // The swap engine handles HBAR -> WHBAR wrapping transparently.
  const hardcoded: PoolRoute[] = [
    { id: "ss-hbar-usdc",   tokenA: tok("HBAR"),  tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-usdt",   tokenA: tok("HBAR"),  tokenB: tok("USDT"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-usdc-usdt",   tokenA: tok("USDC"),  tokenB: tok("USDT"),   fee: 0.01, tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-wbtc",   tokenA: tok("HBAR"),  tokenB: tok("WBTC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-weth",   tokenA: tok("HBAR"),  tokenB: tok("WETH"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-link",   tokenA: tok("HBAR"),  tokenB: tok("LINK"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-sauce",  tokenA: tok("HBAR"),  tokenB: tok("SAUCE"),  fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-hbarx",  tokenA: tok("HBAR"),  tokenB: tok("HBARX"),  fee: 0.05, tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-karate", tokenA: tok("HBAR"),  tokenB: tok("KARATE"), fee: 1.0,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-pack",   tokenA: tok("HBAR"),  tokenB: tok("PACK"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-dovu",   tokenA: tok("HBAR"),  tokenB: tok("DOVU"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-hst",    tokenA: tok("HBAR"),  tokenB: tok("HST"),    fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    // [C36-04] HBAR.h is a V1 AMM pool, not V2. Pool address resolved by V1 Factory.
    { id: "ss-hbar-hbarh",  tokenA: tok("HBAR"),  tokenB: tok("HBAR.\u0127"), fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-sauce-usdc",  tokenA: tok("SAUCE"), tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-wbtc-usdc",   tokenA: tok("WBTC"),  tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-weth-usdc",   tokenA: tok("WETH"),  tokenB: tok("USDC"),   fee: 0.3,  tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    // [ROUTING-FIX] Community tokens that need multi-hop via HBAR. Without
    // these static entries, multi-hop only works if the pool graph API returns
    // their pools — which may use ERC20Wrapper IDs not in our registry.
    { id: "ss-hbar-smackm", tokenA: tok("HBAR"),  tokenB: tok("SMACKM"), fee: 0.3, tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-grelf",  tokenA: tok("HBAR"),  tokenB: tok("GRELF"),  fee: 0.3, tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
    { id: "ss-hbar-clxy",   tokenA: tok("HBAR"),  tokenB: tok("CLXY"),   fee: 0.3, tvlUsd: 0, volume24hUsd: 0, apr: 0, poolAddress: FR },
  ].filter(r => r.tokenA && r.tokenB); // Safety filter

  // [C36-04] Merge live API data with hardcoded fallbacks.
  // Previously, live data REPLACED hardcoded routes entirely, which caused
  // "No Route Available" for tokens not returned by the SaucerSwap API.
  // Now: live data takes priority, but hardcoded routes fill any gaps.
  if (_livePoolRouteCache && Date.now() - _livePoolCacheTs < POOL_ROUTE_CACHE_TTL * 5) {
    const pairKey = (a: string, b: string) => [a, b].sort().join("/");
    const livePairs = new Set(
      _livePoolRouteCache.map(r => pairKey(r.tokenA.symbol, r.tokenB.symbol))
    );
    const merged = [..._livePoolRouteCache];
    for (const hc of hardcoded) {
      const key = pairKey(hc.tokenA.symbol, hc.tokenB.symbol);
      if (!livePairs.has(key)) {
        merged.push(hc);
      }
    }
    return merged;
  }

  return hardcoded;
}

// ════════════════════════════════════════════════════════════════════════
// ── FIND SWAP ROUTE ───────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

/**
 * Find the best route between two tokens.
 * Returns the ordered list of pools to traverse.
 */
export function findSwapRoute(
  inputSymbol: string,
  outputSymbol: string
): { path: AllowedToken[]; pools: PoolRoute[]; totalFee: number } | null {
  const input = resolveToken(inputSymbol);
  const output = resolveToken(outputSymbol);
  if (!input || !output || input.symbol === output.symbol) return null;

  // Native HBAR <-> WHBAR is just wrap/unwrap, not a pool swap
  if (
    (input.isNative && output.symbol === "WHBAR") ||
    (input.symbol === "WHBAR" && output.isNative)
  ) {
    return null; // Handled by wrapHbar/unwrapHbar directly
  }

  const routes = getPoolRoutes();

  // [C22-01] Pool routes now display "HBAR" instead of "WHBAR".
  // Normalize both HBAR (native) and WHBAR to "HBAR" for pool lookup,
  // since pool tokens use the native HBAR AllowedToken.
  const lookupInput = (input.isNative || input.symbol === "WHBAR") ? "HBAR" : input.symbol;
  const lookupOutput = (output.isNative || output.symbol === "WHBAR") ? "HBAR" : output.symbol;

  if (lookupInput === lookupOutput) return null;

  // Try direct route first
  const directPool = routes.find(
    r => (r.tokenA.symbol === lookupInput && r.tokenB.symbol === lookupOutput) ||
         (r.tokenB.symbol === lookupInput && r.tokenA.symbol === lookupOutput)
  );
  if (directPool) {
    return { path: [input, output], pools: [directPool], totalFee: directPool.fee };
  }

  // Try 2-hop route through HBAR (pools display HBAR, on-chain wraps to WHBAR)
  const hbar = TOKEN_BY_SYMBOL.get("HBAR");
  if (hbar && lookupInput !== "HBAR" && lookupOutput !== "HBAR") {
    const pool1 = routes.find(
      r => (r.tokenA.symbol === lookupInput && r.tokenB.symbol === "HBAR") ||
           (r.tokenB.symbol === lookupInput && r.tokenA.symbol === "HBAR")
    );
    const pool2 = routes.find(
      r => (r.tokenA.symbol === "HBAR" && r.tokenB.symbol === lookupOutput) ||
           (r.tokenB.symbol === "HBAR" && r.tokenA.symbol === lookupOutput)
    );
    if (pool1 && pool2) {
      return {
        path: [input, hbar, output],
        pools: [pool1, pool2],
        totalFee: pool1.fee + pool2.fee,
      };
    }
  }

  // Try 2-hop through USDC
  const usdc = TOKEN_BY_SYMBOL.get("USDC");
  if (usdc && lookupInput !== "USDC" && lookupOutput !== "USDC") {
    const pool1 = routes.find(
      r => (r.tokenA.symbol === lookupInput && r.tokenB.symbol === "USDC") ||
           (r.tokenB.symbol === lookupInput && r.tokenA.symbol === "USDC")
    );
    const pool2 = routes.find(
      r => (r.tokenA.symbol === "USDC" && r.tokenB.symbol === lookupOutput) ||
           (r.tokenB.symbol === "USDC" && r.tokenA.symbol === lookupOutput)
    );
    if (pool1 && pool2) {
      return {
        path: [input, usdc, output],
        pools: [pool1, pool2],
        totalFee: pool1.fee + pool2.fee,
      };
    }
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// ── ASYNC ROUTE FINDING (ON-CHAIN FALLBACK) ─────────────────────────
// ════════════════════════════════════════════════════════════════════════

// ── Route cache for on-chain detection results ──
// Caches both positive (route found) and negative (no route) results
// to avoid redundant JSON-RPC calls when the user toggles tokens back.

type AsyncRouteResult = { path: AllowedToken[]; pools: PoolRoute[]; totalFee: number; onChain: boolean } | null;

interface RouteCacheEntry {
  result: AsyncRouteResult;
  ts: number;
}

const _asyncRouteCache = new Map<string, RouteCacheEntry>();
const ASYNC_ROUTE_CACHE_TTL = 120_000; // 2 minutes — on-chain pool topology changes slowly
const ASYNC_ROUTE_CACHE_MAX = 200; // cap to prevent unbounded growth with dynamic tokens

function _routeCacheKey(inputSymbol: string, outputSymbol: string, network: HederaNetwork): string {
  return `${inputSymbol}:${outputSymbol}:${network}`;
}

/**
 * Evict stale entries and enforce max cache size.
 * Called on every cache write — cheap when cache is small.
 */
function _routeCacheEvict(): void {
  const now = Date.now();
  for (const [key, entry] of _asyncRouteCache) {
    if (now - entry.ts > ASYNC_ROUTE_CACHE_TTL) {
      _asyncRouteCache.delete(key);
    }
  }
  // If still over max, drop oldest entries
  if (_asyncRouteCache.size > ASYNC_ROUTE_CACHE_MAX) {
    const sorted = [..._asyncRouteCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toRemove = sorted.slice(0, sorted.length - ASYNC_ROUTE_CACHE_MAX);
    for (const [key] of toRemove) {
      _asyncRouteCache.delete(key);
    }
  }
}

/** Clear the async route cache (useful after dynamic token refresh). */
export function clearAsyncRouteCache(): void {
  _asyncRouteCache.clear();
  log.debug("Route", "Async route cache cleared");
}

/**
 * [C56] Async route finding with on-chain pool detection fallback.
 *
 * When `findSwapRoute()` (static pool list) returns null, this function
 * uses graph-based routing with forced refresh, falling back to direct
 * on-chain pool detection via `detectPoolVersion()`. [STEP4] The legacy
 * `findBestMultiHopRoute()` (32-48 RPCs) has been replaced by graph retry.
 *
 * Results (including negative "no route" results) are cached for 2 minutes
 * to avoid redundant JSON-RPC calls when the user toggles token pairs.
 *
 * Returns a simplified route descriptor for the UI, NOT the full execution
 * parameters (those are computed inside executeSaucerSwapDirect).
 */
export async function findSwapRouteAsync(
  inputSymbol: string,
  outputSymbol: string,
  network: HederaNetwork = "mainnet",
): Promise<{ path: AllowedToken[]; pools: PoolRoute[]; totalFee: number; onChain: boolean } | null> {
  // Try sync route first (instant, no network calls)
  const syncRoute = findSwapRoute(inputSymbol, outputSymbol);
  if (syncRoute) return { ...syncRoute, onChain: false };

  const input = resolveToken(inputSymbol);
  const output = resolveToken(outputSymbol);
  if (!input || !output || input.symbol === output.symbol) return null;

  // Skip wrap/unwrap pairs
  if (
    (input.isNative && output.symbol === "WHBAR") ||
    (input.symbol === "WHBAR" && output.isNative)
  ) return null;

  // ── Check route cache before expensive on-chain calls ──
  const cacheKey = _routeCacheKey(inputSymbol, outputSymbol, network);
  const cached = _asyncRouteCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ASYNC_ROUTE_CACHE_TTL) {
    log.debug("Route", `Route cache hit for ${inputSymbol} → ${outputSymbol} (${cached.result ? "route" : "no-route"})`);
    return cached.result;
  }

  const whbar = TOKEN_BY_SYMBOL.get("WHBAR");
  if (!whbar) return null;

  // Use routing-aware EVM addresses
  const directInEvm = getSaucerswapRoutingEvmAddress(input.isNative ? whbar : input);
  const directOutEvm = getSaucerswapRoutingEvmAddress(output.isNative ? whbar : output);

  log.info("Route", `Async route search: ${inputSymbol} → ${outputSymbol}`);

  // [C82] Step 0: Try graph-first routing (instant, no network calls)
  try {
    const inputRoutingId = getSaucerswapRoutingId(input.isNative ? whbar : input);
    const outputRoutingId = getSaucerswapRoutingId(output.isNative ? whbar : output);
    const graphRoute = await findRouteViaGraph(inputRoutingId, outputRoutingId, network);
    if (graphRoute) {
      if (graphRoute.direct) {
        const syntheticPool: PoolRoute = {
          id: `graph-${input.symbol}-${output.symbol}`,
          tokenA: input, tokenB: output,
          fee: graphRoute.direct.feeTier ? graphRoute.direct.feeTier / 10000 : 0.3,
          tvlUsd: 0, volume24hUsd: 0, apr: 0,
          poolAddress: graphRoute.direct.poolAddress || "graph-detected",
          source: graphRoute.direct.version,
        };
        const result: AsyncRouteResult = {
          path: [input, output], pools: [syntheticPool],
          totalFee: syntheticPool.fee, onChain: true,
        };
        _routeCacheEvict();
        _asyncRouteCache.set(cacheKey, { result, ts: Date.now() });
        log.info("Route", `[C82] Graph: direct ${graphRoute.direct.version} fee=${graphRoute.direct.feeTier}`);
        return result;
      } else if (graphRoute.multiHop) {
        const midEvm = graphRoute.multiHop.tokens[1];
        const midHtsId = evmAddressToHtsId(midEvm);
        // Resolve intermediary: check WHBAR special case, then canonical ID, then alias ID
        let midToken: AllowedToken;
        if (midEvm.toLowerCase() === getSaucerswapRoutingEvmAddress(whbar).toLowerCase()) {
          midToken = TOKEN_BY_SYMBOL.get("HBAR")!;
        } else {
          midToken = TOKEN_BY_HTS_ID.get(midHtsId)
            || Array.from(TOKEN_BY_HTS_ID.values()).find(t => t.saucerswapAliasId === midHtsId)
            || { symbol: midHtsId, name: midHtsId, htsId: midHtsId, evmAddress: midEvm, decimals: 8, logo: "", rank: 999, isWrapped: false } as AllowedToken;
        }
        const pool1: PoolRoute = {
          id: `graph-hop1-${input.symbol}-${midToken.symbol}`,
          tokenA: input, tokenB: midToken,
          fee: graphRoute.multiHop.hops[0].feeTier ? graphRoute.multiHop.hops[0].feeTier / 10000 : 0.3,
          tvlUsd: 0, volume24hUsd: 0, apr: 0,
          poolAddress: graphRoute.multiHop.hops[0].poolAddress || "graph-detected",
          source: graphRoute.multiHop.hops[0].version,
        };
        const pool2: PoolRoute = {
          id: `graph-hop2-${midToken.symbol}-${output.symbol}`,
          tokenA: midToken, tokenB: output,
          fee: graphRoute.multiHop.hops[1].feeTier ? graphRoute.multiHop.hops[1].feeTier / 10000 : 0.3,
          tvlUsd: 0, volume24hUsd: 0, apr: 0,
          poolAddress: graphRoute.multiHop.hops[1].poolAddress || "graph-detected",
          source: graphRoute.multiHop.hops[1].version,
        };
        const result: AsyncRouteResult = {
          path: [input, midToken, output], pools: [pool1, pool2],
          totalFee: pool1.fee + pool2.fee, onChain: true,
        };
        _routeCacheEvict();
        _asyncRouteCache.set(cacheKey, { result, ts: Date.now() });
        log.info("Route", `[C82] Graph: multi-hop ${input.symbol} → ${midToken.symbol} → ${output.symbol}`);
        return result;
      }
    }
  } catch (graphErr: any) {
    log.warn("Route", `[C82] Graph routing failed in UI route finder: ${graphErr?.message}`);
  }

  // Step 1: Check for direct on-chain pool
  const directPool = await detectPoolVersion(directInEvm, directOutEvm, network);
  if (directPool) {
    log.info("Route", `Direct on-chain pool found: ${directPool.version} (fee=${directPool.feeTier || "N/A"})`);
    const syntheticPool: PoolRoute = {
      id: `onchain-${input.symbol}-${output.symbol}`,
      tokenA: input,
      tokenB: output,
      fee: directPool.feeTier ? directPool.feeTier / 10000 : 0.3,
      tvlUsd: 0,
      volume24hUsd: 0,
      apr: 0,
      poolAddress: directPool.poolAddress || "on-chain-detected",
      source: directPool.version,
    };
    const result: AsyncRouteResult = {
      path: [input, output],
      pools: [syntheticPool],
      totalFee: syntheticPool.fee,
      onChain: true,
    };
    // Cache the positive result
    _routeCacheEvict();
    _asyncRouteCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  }

  // [STEP4] Step 2: Multi-hop via graph retry with forced refresh.
  // Replaces legacy findBestMultiHopRoute() (32-48 sequential RPCs).
  // Force-refresh rebuilds the graph from SaucerSwap API in case the
  // initial graph call (Step 0) used stale/empty cached data.
  try {
    const inputRoutingId = getSaucerswapRoutingId(input.isNative ? whbar : input);
    const outputRoutingId = getSaucerswapRoutingId(output.isNative ? whbar : output);
    const graphRetry = await findRouteViaGraph(inputRoutingId, outputRoutingId, network, true);
    if (graphRetry?.multiHop) {
      const multiHop = graphRetry.multiHop;
      const midEvm = multiHop.tokens[1];
      const midHtsId = evmAddressToHtsId(midEvm);
      const midToken = TOKEN_BY_SYMBOL.get("HBAR")?.htsId === "native" && midEvm.toLowerCase() === getSaucerswapRoutingEvmAddress(whbar).toLowerCase()
        ? TOKEN_BY_SYMBOL.get("HBAR")!
        : (TOKEN_BY_HTS_ID.get(midHtsId) || Array.from(TOKEN_BY_HTS_ID.values()).find(t => t.saucerswapAliasId === midHtsId)
          || { symbol: midHtsId, name: midHtsId, htsId: midHtsId, evmAddress: midEvm, decimals: 8, logo: "", rank: 999, isWrapped: false } as AllowedToken);

      log.info("Route", `[STEP4] Graph retry multi-hop: ${input.symbol} → ${midToken.symbol} → ${output.symbol}`);

      const pool1: PoolRoute = {
        id: `graph-retry-hop1-${input.symbol}-${midToken.symbol}`,
        tokenA: input,
        tokenB: midToken,
        fee: multiHop.hops[0].feeTier ? multiHop.hops[0].feeTier / 10000 : 0.3,
        tvlUsd: 0, volume24hUsd: 0, apr: 0,
        poolAddress: multiHop.hops[0].poolAddress || "graph-retry-detected",
        source: multiHop.hops[0].version,
      };
      const pool2: PoolRoute = {
        id: `graph-retry-hop2-${midToken.symbol}-${output.symbol}`,
        tokenA: midToken,
        tokenB: output,
        fee: multiHop.hops[1].feeTier ? multiHop.hops[1].feeTier / 10000 : 0.3,
        tvlUsd: 0, volume24hUsd: 0, apr: 0,
        poolAddress: multiHop.hops[1].poolAddress || "graph-retry-detected",
        source: multiHop.hops[1].version,
      };

      const result: AsyncRouteResult = {
        path: [input, midToken, output],
        pools: [pool1, pool2],
        totalFee: pool1.fee + pool2.fee,
        onChain: true,
      };
      _routeCacheEvict();
      _asyncRouteCache.set(cacheKey, { result, ts: Date.now() });
      return result;
    } else if (graphRetry?.direct) {
      // Graph retry found a direct pool missed on first pass
      const syntheticPool: PoolRoute = {
        id: `graph-retry-${input.symbol}-${output.symbol}`,
        tokenA: input, tokenB: output,
        fee: graphRetry.direct.feeTier ? graphRetry.direct.feeTier / 10000 : 0.3,
        tvlUsd: 0, volume24hUsd: 0, apr: 0,
        poolAddress: graphRetry.direct.poolAddress || "graph-retry-detected",
        source: graphRetry.direct.version,
      };
      const result: AsyncRouteResult = {
        path: [input, output], pools: [syntheticPool],
        totalFee: syntheticPool.fee, onChain: true,
      };
      _routeCacheEvict();
      _asyncRouteCache.set(cacheKey, { result, ts: Date.now() });
      log.info("Route", `[STEP4] Graph retry found direct pool: ${graphRetry.direct.version} fee=${graphRetry.direct.feeTier}`);
      return result;
    }
  } catch (graphRetryErr: any) {
    log.warn("Route", `[STEP4] Graph retry failed: ${graphRetryErr?.message}`);
  }

  // Cache negative result (no route) to avoid re-checking
  log.info("Route", `No route found for ${inputSymbol} → ${outputSymbol} (sync + on-chain)`);
  _routeCacheEvict();
  _asyncRouteCache.set(cacheKey, { result: null, ts: Date.now() });
  return null;
}
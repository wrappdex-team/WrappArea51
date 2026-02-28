/**
 * [STEP5] Pre-warm Swap Infrastructure at Wallet Connect Time
 *
 * Fires background tasks immediately when a Hedera wallet connects
 * (or a session restores) so that the user's first swap feels instant.
 *
 * Tasks:
 *   (a) Build pool routing graph — fills the 5-min cached graph from
 *       SaucerSwap V1+V2 pool APIs. Without this, the first swap pays
 *       a cold-start penalty of 1-3s fetching pool lists.
 *   (b) Pre-fetch token allowances for V1/V2 routers — the approval
 *       check during swap execution reads from Mirror Node. By pre-caching
 *       the user's allowances for commonly-swapped tokens, we eliminate
 *       a serial Mirror Node call from the critical path.
 *   (c) Pre-resolve V1/V2 router EVM addresses — these are fetched via
 *       the server proxy on first use. Pre-resolving ensures the address
 *       cache is warm before any swap TX is constructed.
 *
 * All tasks are fire-and-forget with individual error handling.
 * Failures are logged but never surface to the user.
 */

import { log } from "../logger";
import type { HederaNetwork } from "./tokens";
import type { HederaTokenBalance } from "../hedera";

// ═══════════════════════════════════════════════════════════════════════
// ── Guard: prevent duplicate concurrent prewarm runs ────────────────
// ═══════════════════════════════════════════════════════════════════════
let _prewarmInFlight = false;
let _lastPrewarmTs = 0;
const PREWARM_COOLDOWN_MS = 30_000; // don't re-run within 30s

/**
 * [STEP5] Pre-warm all swap infrastructure caches.
 *
 * Called from WalletContext after wallet connect or session restore.
 * Safe to call multiple times — includes debounce + dedup guards.
 *
 * @param accountId  Hedera account ID (e.g. "0.0.12345")
 * @param network    "mainnet" | "testnet"
 * @param tokens     User's token balances from account info (optional — if
 *                   provided, pre-fetches allowances for held tokens)
 */
export async function prewarmSwapInfrastructure(
  accountId: string,
  network: HederaNetwork,
  tokens?: HederaTokenBalance[],
): Promise<void> {
  // Debounce: skip if already running or recently completed
  if (_prewarmInFlight) {
    log.debug("Prewarm", "Skipped — already in flight");
    return;
  }
  if (Date.now() - _lastPrewarmTs < PREWARM_COOLDOWN_MS) {
    log.debug("Prewarm", `Skipped — cooldown (${Math.round((Date.now() - _lastPrewarmTs) / 1000)}s ago)`);
    return;
  }

  _prewarmInFlight = true;
  const t0 = performance.now();
  log.info("Prewarm", `[STEP5] Starting swap infrastructure pre-warm for ${accountId} on ${network}`);

  try {
    // Fire all three tasks in parallel — each has its own error handling
    await Promise.allSettled([
      prewarmPoolGraph(network),
      prewarmRouterEvmAddresses(network),
      prewarmTokenAllowances(accountId, network, tokens),
    ]);

    _lastPrewarmTs = Date.now();
    const elapsed = Math.round(performance.now() - t0);
    log.info("Prewarm", `[STEP5] Pre-warm complete in ${elapsed}ms`);
  } catch (err: any) {
    // Should never reach here (allSettled doesn't reject), but safety net
    log.warn("Prewarm", `[STEP5] Unexpected error: ${err?.message}`);
  } finally {
    _prewarmInFlight = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── (a) Pool Graph ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

async function prewarmPoolGraph(network: HederaNetwork): Promise<void> {
  try {
    const { prewarmPoolGraph: buildGraph } = await import("./routing");
    const t0 = performance.now();
    const nodeCount = await buildGraph(network);
    const elapsed = Math.round(performance.now() - t0);
    log.info("Prewarm", `[STEP5] (a) Pool graph ready: ${nodeCount} nodes in ${elapsed}ms`);
  } catch (err: any) {
    log.warn("Prewarm", `[STEP5] (a) Pool graph failed: ${err?.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── (b) Token Allowances ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

/**
 * Pre-fetch allowances for the user's held tokens against both V1 and V2
 * routers. The fetchTokenAllowance function caches results internally,
 * so subsequent calls from the swap engine are instant cache hits.
 *
 * Strategy: only check tokens the user actually holds (non-zero balance)
 * since those are the ones they're likely to swap. Cap at 8 tokens to
 * keep Mirror Node calls reasonable (~16 total: 8 tokens x 2 routers).
 */
async function prewarmTokenAllowances(
  accountId: string,
  network: HederaNetwork,
  tokens?: HederaTokenBalance[],
): Promise<void> {
  if (!tokens || tokens.length === 0) {
    log.debug("Prewarm", "[STEP5] (b) No token list — skipping allowance prewarm");
    return;
  }

  try {
    const { fetchTokenAllowance } = await import("./balances");
    const { SAUCERSWAP_V1_ROUTER, SAUCERSWAP_V2_ROUTER } = await import("./contracts");

    const v1Router = SAUCERSWAP_V1_ROUTER[network] || SAUCERSWAP_V1_ROUTER.mainnet;
    const v2Router = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;

    // Filter to tokens with non-zero balance, cap at 8
    const heldTokens = tokens
      .filter(t => t.balance > 0 && t.tokenId)
      .slice(0, 8);

    if (heldTokens.length === 0) {
      log.debug("Prewarm", "[STEP5] (b) No held tokens with balance — skipping");
      return;
    }

    const t0 = performance.now();

    // Fire all allowance checks in parallel
    const tasks: Promise<void>[] = [];
    for (const token of heldTokens) {
      // V1 router allowance
      tasks.push(
        fetchTokenAllowance(accountId, token.tokenId, v1Router, network)
          .then(() => {})
          .catch(() => {})
      );
      // V2 router allowance
      tasks.push(
        fetchTokenAllowance(accountId, token.tokenId, v2Router, network)
          .then(() => {})
          .catch(() => {})
      );
    }

    await Promise.allSettled(tasks);
    const elapsed = Math.round(performance.now() - t0);
    log.info("Prewarm", `[STEP5] (b) Allowances cached: ${heldTokens.length} tokens x 2 routers in ${elapsed}ms`);
  } catch (err: any) {
    log.warn("Prewarm", `[STEP5] (b) Allowance prewarm failed: ${err?.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── (c) Router EVM Addresses ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

/**
 * Pre-resolve V1 and V2 router contract EVM addresses.
 * resolveContractEvmAddress calls the server proxy on first use and
 * caches the result. Pre-resolving ensures the cache is warm before
 * the first swap TX needs the router's EVM address.
 */
async function prewarmRouterEvmAddresses(network: HederaNetwork): Promise<void> {
  try {
    const { resolveContractEvmAddress } = await import("./pools");
    const { SAUCERSWAP_V1_ROUTER, SAUCERSWAP_V2_ROUTER } = await import("./contracts");

    const v1Router = SAUCERSWAP_V1_ROUTER[network] || SAUCERSWAP_V1_ROUTER.mainnet;
    const v2Router = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;

    const t0 = performance.now();

    const [v1Evm, v2Evm] = await Promise.allSettled([
      resolveContractEvmAddress(v1Router, network),
      resolveContractEvmAddress(v2Router, network),
    ]);

    const elapsed = Math.round(performance.now() - t0);
    const v1Result = v1Evm.status === "fulfilled" ? v1Evm.value.slice(0, 10) + "..." : "failed";
    const v2Result = v2Evm.status === "fulfilled" ? v2Evm.value.slice(0, 10) + "..." : "failed";
    log.info("Prewarm", `[STEP5] (c) Router EVM: V1=${v1Result} V2=${v2Result} in ${elapsed}ms`);
  } catch (err: any) {
    log.warn("Prewarm", `[STEP5] (c) Router EVM prewarm failed: ${err?.message}`);
  }
}

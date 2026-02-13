/**
 * Site Orderbook — Tracks real trades placed by connected users on HBAR.ħ.
 *
 * Persists to localStorage so trade history survives page refreshes.
 * Each trade records: wallet, pair, side, amount, price, timestamp, tx status.
 * This is NOT a limit-order book — it's an execution log for swaps routed
 * through SaucerSwap / HSuite that were initiated on this site.
 */

// ── Types ───────────────────────────────────────────────────────────

export type OrderbookRouter =
  | "saucerswap"
  | "hsuite"
  | "smart-liquidity"
  | "changenow";

export interface OrderbookEntry {
  id: string;
  timestamp: number;
  wallet: string;           // Hedera account ID (0.0.xxxxx)
  side: "buy" | "sell";
  tokenIn: string;          // symbol
  tokenOut: string;         // symbol
  amountIn: number;         // human-readable
  amountOut: number;        // human-readable
  priceUsd: number;         // effective price of tokenOut in USD
  route: string;            // e.g. "HBAR → USDC → SAUCE" or "direct"
  router: OrderbookRouter;
  transactionId: string | null;
  status: "pending" | "confirmed" | "failed";
  slippageBps: number;
  network?: "mainnet" | "testnet"; // stamped at recording time
}

export interface OrderbookStats {
  totalTrades: number;
  trades24h: number;
  volume24hUsd: number;
  uniqueWallets: number;
  avgSlippageBps: number;
  topPair: string;
  topPairVolume: number;
  confirmedCount: number;
  failedCount: number;
  pendingCount: number;
  routerBreakdown: Record<string, number>;
}

export type NetworkMode = "mainnet" | "testnet";

// ── Network-Aware Storage ───────────────────────────────────────────

const STORAGE_PREFIX = "hbarh-orderbook";
// [AUDIT-AMM-04] Reduced from 500 — only keep recent trades, data minimization
const MAX_ENTRIES = 50;
let _activeNetwork: NetworkMode = "mainnet";

/** Anonymize a wallet address — keep realm.shard prefix + last 3 digits only. */
function anonymizeWallet(wallet: string): string {
  // "0.0.518487" → "0.0.•••487"
  if (/^0\.0\.\d+$/.test(wallet)) {
    const num = wallet.split(".")[2];
    if (num.length <= 3) return wallet; // Short IDs stay readable
    return `0.0.${"•".repeat(Math.min(num.length - 3, 4))}${num.slice(-3)}`;
  }
  // EVM addresses: "0xAbC...dEf" → "0x••••dEf"
  if (wallet.startsWith("0x") && wallet.length > 8) {
    return `0x${"•".repeat(4)}${wallet.slice(-4)}`;
  }
  return "•••";
}

/** Set the active Hedera network for orderbook operations. */
export function setActiveNetwork(network: NetworkMode): void {
  _activeNetwork = network;
}

/** Get the current active network. */
export function getActiveNetwork(): NetworkMode {
  return _activeNetwork;
}

function storageKey(network?: NetworkMode): string {
  const net = network || _activeNetwork;
  return net === "mainnet" ? STORAGE_PREFIX : `${STORAGE_PREFIX}-${net}`;
}

function loadEntries(network?: NetworkMode): OrderbookEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(network));
    if (!raw) return [];
    return JSON.parse(raw) as OrderbookEntry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: OrderbookEntry[], network?: NetworkMode): void {
  try {
    // Keep only the most recent MAX_ENTRIES
    const trimmed = entries.slice(-MAX_ENTRIES);
    localStorage.setItem(storageKey(network), JSON.stringify(trimmed));
  } catch {
    // Storage full — drop oldest half
    try {
      const trimmed = entries.slice(-Math.floor(MAX_ENTRIES / 2));
      localStorage.setItem(storageKey(network), JSON.stringify(trimmed));
    } catch { /* give up */ }
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Record a new trade in the site orderbook.
 * Called from SwapPanel, BuySell, CEXTradePanel, SmartLiquidity after execution.
 */
export function recordTrade(trade: Omit<OrderbookEntry, "id" | "timestamp" | "network">): OrderbookEntry {
  const entry: OrderbookEntry = {
    ...trade,
    // [AUDIT-AMM-04] Anonymize wallet — don't store full account IDs in localStorage
    wallet: anonymizeWallet(trade.wallet),
    // [AUDIT-AMM-04] Strip transaction ID from localStorage — view on HashScan only during session
    transactionId: null,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    network: _activeNetwork,
  };
  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  return entry;
}

/**
 * Update a trade's status (e.g. pending → confirmed after Mirror Node verification).
 */
export function updateTradeStatus(
  id: string,
  status: OrderbookEntry["status"],
  transactionId?: string
): void {
  const entries = loadEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx >= 0) {
    entries[idx].status = status;
    if (transactionId) entries[idx].transactionId = transactionId;
    saveEntries(entries);
  }
}

/**
 * Get all trades, newest first.
 */
export function getOrderbook(limit: number = 100): OrderbookEntry[] {
  return loadEntries().reverse().slice(0, limit);
}

/**
 * Get trades for a specific wallet (matches against anonymized wallet pattern).
 * [AUDIT-AMM-04] Since wallets are now anonymized, this matches against the
 * anonymized form. For exact per-user history, use the SwapHistory localStorage.
 */
export function getWalletTrades(wallet: string, limit: number = 50): OrderbookEntry[] {
  const anon = anonymizeWallet(wallet);
  return loadEntries()
    .filter((e) => e.wallet === anon || e.wallet === wallet)
    .reverse()
    .slice(0, limit);
}

/**
 * Get trades for a specific token pair.
 */
export function getPairTrades(tokenA: string, tokenB: string, limit: number = 50): OrderbookEntry[] {
  return loadEntries()
    .filter((e) =>
      (e.tokenIn === tokenA && e.tokenOut === tokenB) ||
      (e.tokenIn === tokenB && e.tokenOut === tokenA)
    )
    .reverse()
    .slice(0, limit);
}

/**
 * Compute orderbook statistics — extended with router breakdown and status counts.
 */
export function getOrderbookStats(): OrderbookStats {
  const entries = loadEntries();
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const recent = entries.filter((e) => e.timestamp > dayAgo);

  // Count unique wallets (anonymized — approximate count only)
  const wallets = new Set(entries.map((e) => e.wallet));

  // Compute 24h volume
  const volume24h = recent.reduce((sum, e) => sum + e.amountOut * e.priceUsd, 0);

  // Avg slippage
  const avgSlippage = recent.length > 0
    ? Math.round(recent.reduce((sum, e) => sum + e.slippageBps, 0) / recent.length)
    : 0;

  // Top pair
  const pairCounts: Record<string, number> = {};
  for (const e of recent) {
    const pair = [e.tokenIn, e.tokenOut].sort().join("/");
    pairCounts[pair] = (pairCounts[pair] || 0) + e.amountOut * e.priceUsd;
  }
  const topPairEntry = Object.entries(pairCounts).sort((a, b) => b[1] - a[1])[0];

  // Status counts
  let confirmed = 0, failed = 0, pending = 0;
  for (const e of entries) {
    if (e.status === "confirmed") confirmed++;
    else if (e.status === "failed") failed++;
    else pending++;
  }

  // Router breakdown
  const routerBreakdown: Record<string, number> = {};
  for (const e of entries) {
    routerBreakdown[e.router] = (routerBreakdown[e.router] || 0) + 1;
  }

  return {
    totalTrades: entries.length,
    trades24h: recent.length,
    volume24hUsd: volume24h,
    uniqueWallets: wallets.size,
    avgSlippageBps: avgSlippage,
    topPair: topPairEntry ? topPairEntry[0] : "—",
    topPairVolume: topPairEntry ? topPairEntry[1] : 0,
    confirmedCount: confirmed,
    failedCount: failed,
    pendingCount: pending,
    routerBreakdown,
  };
}

// ── Admin Functions ─────────────────────────────────────────────────

/**
 * Clear the orderbook for a specific network (admin tool).
 * Returns the count of entries that were cleared.
 */
export function clearOrderbook(network?: NetworkMode): number {
  const net = network || _activeNetwork;
  const entries = loadEntries(net);
  const count = entries.length;
  localStorage.removeItem(storageKey(net));
  return count;
}

/**
 * Clear ALL orderbook data across all networks (full admin reset).
 */
export function clearAllOrderbooks(): { mainnet: number; testnet: number } {
  const mainCount = loadEntries("mainnet").length;
  const testCount = loadEntries("testnet").length;
  localStorage.removeItem(storageKey("mainnet"));
  localStorage.removeItem(storageKey("testnet"));
  return { mainnet: mainCount, testnet: testCount };
}

/**
 * Export orderbook data as a JSON string (for backup/analysis).
 */
export function exportOrderbook(network?: NetworkMode): string {
  return JSON.stringify(loadEntries(network || _activeNetwork), null, 2);
}

/**
 * Get the storage key for current network (for debugging).
 */
export function getStorageInfo(): { key: string; network: NetworkMode; entryCount: number; sizeBytes: number } {
  const key = storageKey();
  const raw = localStorage.getItem(key) || "[]";
  return {
    key,
    network: _activeNetwork,
    entryCount: loadEntries().length,
    sizeBytes: new Blob([raw]).size,
  };
}
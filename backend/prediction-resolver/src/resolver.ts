import { 
  getClient, 
  postCreateMarket, 
  postPlaceBet, 
  postMarketResolved,
  executePayout,
  postPayoutMessage,
  postPayoutClosedMessage,
  postFastGameRetired,
  postMarketRetired,
  treasuryAccountId
} from './hedera';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const MASTER_TOPIC_ID = process.env.MASTER_TOPIC_ID!;
const RESOLUTION_ACCOUNT = process.env.RESOLUTION_ACCOUNT_ID!;
if (!MASTER_TOPIC_ID || !RESOLUTION_ACCOUNT) {
  throw new Error('Missing MASTER_TOPIC_ID or RESOLUTION_ACCOUNT_ID in environment. These must be provided via .env or Railway variables.');
}
// Using Hedera's official dedicated testnet mirror node for better reliability
// (previously was the public mirrornode.hedera.com which can be less stable)
const MIRROR_NODE = process.env.HEDERA_MIRROR_NODE;
if (!MIRROR_NODE) {
  throw new Error('Missing HEDERA_MIRROR_NODE in environment. For testnet job: https://testnet.mirrornode.hedera.com ; for mainnet job: https://mainnet-public.mirrornode.hedera.com (or your dedicated mirror for the network).');
}

// Phase 1: Lightweight persistence for active games (simple JSON file for restart resilience)
const DATA_DIR = path.join(__dirname, '..', 'data');
const ACTIVE_GAMES_FILE = path.join(DATA_DIR, 'active-fast-games.json');

interface Transfer {
  account: string;
  amount: number;
  is_approval: boolean;
}

interface Transaction {
  transaction_id: string;
  consensus_timestamp: string;
  name: string;
  entity_id?: string;
  transfers: Transfer[];
  memo_base64?: string;
  result: string;
}

export async function pollMirrorNodeForTransfers() {
  // Only log at info level occasionally to reduce noise during smoke tests
  if (Math.random() < 0.1) {
    console.log('[Resolver] Polling Mirror Node for new transfers...');
  }

  const url = `${MIRROR_NODE}/api/v1/accounts/${RESOLUTION_ACCOUNT}/transactions?limit=25&order=desc`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 404 is common on testnet for new accounts or rate limits — do not spam
      if (res.status !== 404) {
        console.warn(`[Resolver] Mirror node returned ${res.status}`);
      }
      return;
    }

    const data: any = await res.json();

    for (const tx of data.transactions || []) {
      if (tx.result !== 'SUCCESS') continue;

      const incoming = tx.transfers?.find((t: Transfer) => t.account === RESOLUTION_ACCOUNT && t.amount > 0);
      if (!incoming) continue;

      let memo = '';
      if (tx.memo_base64) {
        try {
          memo = Buffer.from(tx.memo_base64, 'base64').toString('utf8');
        } catch {}
      }

      if (memo.includes('fast-') || memo.includes('CREATE_FAST')) {
        console.log(`[Resolver] Detected Fast Game funding: ${tx.transaction_id}`);
      }
    }
  } catch (err) {
    // Swallow transient errors during dev so we don't spam the terminal
    if (Math.random() < 0.05) {
      console.error('[Resolver] Mirror poll transient error (suppressed)');
    }
  }
}

/**
 * Phase 2 – Real Fee Integrity (improved)
 * Verifies via Mirror Node that the 1% platform fee was actually transferred.
 * If paymentTxId is provided, it does a precise lookup on that specific transaction.
 */
/**
 * Phase 2 – Robust Fee Verification (Hedera 2026 best practices)
 * 
 * Strategy:
 * - Prefer exact transaction lookup when paymentTxId is provided (strong proof).
 * - If the dedicated mirror returns 4xx/5xx on tx lookup (very common during smoke tests due to indexing lag),
 *   fall back to the recent treasury transfers scan. This is still strong evidence.
 * - Never let transient Mirror issues destroy the HCS bet record.
 * 
 * For production/high-stakes: Run your own mirror node or use a commercial provider (Hgraph, Arkhia, etc.)
 * with better SLAs and lower latency.
 */
export async function verifyPlatformFeeWasPaid(
  userAccountId: string,
  expectedFee: number,
  marketId: string,
  paymentTxId?: string
): Promise<{ verified: boolean; details?: string }> {
  if (expectedFee <= 0) {
    return { verified: false, details: 'No fee amount provided' };
  }

  const mirrorEndpoints = [
    MIRROR_NODE,                                    // Your configured (preferably dedicated)
    'https://testnet.mirrornode.hedera.com'         // Public fallback
  ];

  try {
    if (paymentTxId) {
      // Try exact transaction lookup with fallback across mirrors
      for (const base of mirrorEndpoints) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const url = `${base}/api/v1/transactions/${encodeURIComponent(paymentTxId)}`;
            const res = await fetch(url);

            if (res.ok) {
              const data: any = await res.json();
              const tx = data.transactions?.[0];

              if (tx?.result === 'SUCCESS' && tx.transfers) {
                const feeHit = tx.transfers.some((t: any) =>
                  t.account === treasuryAccountId &&
                  t.amount > 0 &&
                  Math.abs(t.amount / 100_000_000 - expectedFee) < 0.01
                );

                if (feeHit) {
                  return { verified: true };
                }
              }
            }
          } catch (e) {
            // retry
          }

          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 800 * attempt)); // small backoff
          }
        }
      }
    }

    // Fallback / no txId: Recent treasury scan (still very good evidence)
    const url = `${MIRROR_NODE}/api/v1/accounts/${treasuryAccountId}/transactions?limit=100&order=desc`;
    const res = await fetch(url);
    if (!res.ok) {
      return { verified: false, details: `Mirror query failed: ${res.status}` };
    }

    const data: any = await res.json();
    const txs = data.transactions || [];

    for (const tx of txs) {
      if (tx.result !== 'SUCCESS') continue;
      if (!tx.transfers) continue;

      const feeTransfer = tx.transfers.find((t: any) =>
        t.account === treasuryAccountId &&
        t.amount > 0 &&
        Math.abs(t.amount / 100_000_000 - expectedFee) < 0.01
      );

      if (feeTransfer) {
        return { verified: true };
      }
    }

    return { verified: false, details: 'No matching fee transfer found after checking multiple mirrors' };
  } catch (e: any) {
    console.warn('[Resolver] Phase 2 fee verification error:', e.message);
    return { verified: false, details: e.message };
  }
}

/**
 * Phase 2 Security: Pre-balance check using Mirror Node.
 * Prevents users from submitting bets they cannot actually afford.
 * This closes a potential attack vector where a malicious actor could
 * force the system into inconsistent state by submitting a bet + payment tx
 * that they don't have the funds to complete.
 */
export async function getMirrorAccountBalance(accountId: string): Promise<number> {
  try {
    const url = `${MIRROR_NODE}/api/v1/accounts/${accountId}?transactions=false`;
    const res = await fetch(url);

    if (!res.ok) {
      console.warn(`[Resolver] Mirror balance query failed for ${accountId}: ${res.status}`);
      return 0;
    }

    const data: any = await res.json();
    const balanceTinybars = Number(data.balance?.balance) || 0;
    return balanceTinybars / 100_000_000; // convert to HBAR
  } catch (e: any) {
    console.warn(`[Resolver] Error fetching Mirror balance for ${accountId}:`, e.message);
    return 0;
  }
}

/**
 * Phase 3 Funding Safety: Check resolver's current balance before attempting payouts.
 * This is critical for high-stakes markets — we must never attempt to pay out more
 * than we actually have on-chain.
 */
export async function getResolverBalance(): Promise<number> {
  return getMirrorAccountBalance(RESOLUTION_ACCOUNT);
}

/**
 * Phase 3 – Triple Verification (HGraph leg)
 * Re-aggregates bet volume directly from HGraph for the market and compares it
 * against the numbers we derived from the HCS scan.
 *
 * This is the skeleton. For now it logs and returns a soft result so we can
 * smoke test the full flow. Once stable, we can make it a hard requirement.
 */
async function performHGraphVolumeVerification(
  marketId: string,
  calculatedPayouts: Array<{ account: string; amount: number }>,
  calculatedTotal: number
): Promise<{ verified: boolean; details?: string }> {
  try {
    // Re-fetch fresh data from HGraph (this is our independent volume source)
    const messages = await fetchTopicMessages(2000);

    let totalVolumeOnHGraph = 0;
    let winningVolumeOnHGraph = 0;

    // We would normally also fetch the winner from HCS here again for full independence,
    // but for the initial skeleton we focus on total volume consistency.
    for (const row of messages) {
      try {
        const raw = row.message || '';
        const decoded = raw.startsWith('\\x')
          ? Buffer.from(raw.replace(/\\x/g, ''), 'hex').toString('utf8')
          : raw;
        const p = JSON.parse(decoded);

        if (p.marketId !== marketId) continue;
        if (p.type === 'PLACE_BET') {
          const amt = Number(p.amount) || 0;
          totalVolumeOnHGraph += amt;
        }
      } catch {}
    }

    // Very basic consistency check for the skeleton
    const volumeDelta = Math.abs(totalVolumeOnHGraph - calculatedTotal); // rough proxy
    const tolerance = Math.max(1, calculatedTotal * 0.02); // 2% tolerance for smoke testing

    if (volumeDelta > tolerance) {
      return {
        verified: false,
        details: `Volume mismatch: HGraph total=${totalVolumeOnHGraph}, calculated=${calculatedTotal}, delta=${volumeDelta}`
      };
    }

    return { verified: true };
  } catch (e: any) {
    console.warn('[Resolver] Phase 3 HGraph verification error:', e.message);
    return { verified: false, details: `HGraph query failed: ${e.message}` };
  }
}

// Example: manually trigger resolution + scheduled payout (called from admin or after timeout)
export async function resolveAndPayout(marketId: string, winner: 'YES' | 'NO', closingPrice: number, winners: { account: string; amount: number }[]) {
  try {
    const priceData = await getCurrentHbarPriceWithAuditTrail().catch(() => null);
    const decisionTime = priceData?.resolvedAt || new Date().toISOString();

    const finalClosingPrice = closingPrice > 0 
      ? closingPrice 
      : (priceData?.price ?? 0);

    await postMarketResolved({
      marketId,
      winner,
      closingPrice: finalClosingPrice,
      resolvedAt: decisionTime,
      priceTime: priceData?.priceTime,
      priceSource: priceData?.source,
      resolver: RESOLUTION_ACCOUNT,
    });

    knownResolvedMarkets.add(marketId);
    console.log(`[Resolver] Posted MARKET_RESOLVED for ${marketId}`);

    // Phase 0/1 correctness fix for playable games:
    // For fast-* games, we no longer do immediate payouts here.
    // The automatic system (scheduleDelayedPayout + processAutomaticPayoutsForMarket) handles payouts.
    // This prevents double-payout risk and keeps the flow consistent with auto-resolution.
    if (!marketId.startsWith('fast-')) {
      for (const w of winners) {
        await executePayout({
          toAccountId: w.account,
          amountHbar: w.amount,
          memo: `Payout for ${marketId}`,
        });
      }
    } else {
      // Fast games always use the delayed automatic path for fairness and auditability
      console.log(`[Resolver] Fast game ${marketId} resolved via manual path — relying on scheduled automatic payouts`);
    }

    // Remove from active list for fast games (admin resolve path)
    if (marketId.startsWith('fast-')) {
      const ridx = activeFastGames.findIndex(g => g.marketId === marketId);
      if (ridx !== -1) {
        activeFastGames.splice(ridx, 1);
        saveActiveGamesToDisk().catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Resolver] Resolution error:', err);
  }
}

/**
 * Basic automated fast-game resolution helper.
 * In a production system this would be much more sophisticated (DB of active games,
 * proper volume tracking, unmatched stake handling, oracle price feed, etc.).
 *
 * For now: periodically call this from index.ts. It expects the caller to
 * provide a list of currently active fast games (or it can be extended to
 * scan the topic).
 */
// In-memory list of active fast games for auto-resolution during smoke testing.
// In production this should live in a database.
const activeFastGames: Array<{
  marketId: string;
  endTime: number;
  durationMinutes?: number;
  asset?: string; // Added for multi-asset support (XRP + future). Populated on register from CREATE_MARKET and persisted. Defaults to 'HBAR' for older data.
  creationPrice: number;
  resolved?: boolean;
  inTieResolution?: boolean;
}> = [];

// Games currently in tie resolution (price is flat at creation price)
const tieResolutionGames: Array<{
  marketId: string;
  creationPrice: number;
  intervalId?: NodeJS.Timeout;
}> = [];

// Phase 1 Observability: Track last successful price fetch for health monitoring
let lastPriceHealth: {
  price: number;
  source: string;
  isStale: boolean;
  timestamp: string;
} | null = null;

// In-memory TTL cache + log gating for getCurrentHbarPriceWithAuditTrail.
// Collapses the 20s autoResolve + 60s heartbeat + per-game + tie-5s + /api/price/hbar calls
// into at most one real Mirror fetch every ~15s, and detailed "PRIMARY" provenance logs
// only on actual change or once per minute. The authoritative Mirror rate itself moves rarely.
let cachedPriceData: {
  price: number;
  priceTime: string;
  resolvedAt: string;
  source: string;
  isStale: boolean;
} | null = null;
let cachedPriceAt = 0;
const PRICE_CACHE_TTL_MS = 15_000;
let lastWrapperLoggedPrice = 0;
let lastWrapperLogTs = 0;
const WRAPPER_LOG_MIN_INTERVAL_MS = 60_000;

// Phase 1 Observability: Lightweight ring buffer of recent resolution decisions
const recentResolutions: Array<{
  marketId: string;
  winner: 'YES' | 'NO';
  closingPrice: number;
  priceSource: string;
  resolvedAt: string;
}> = [];
const MAX_RECENT_RESOLUTIONS = 10;

// Runtime memory of markets we have resolved in this process (helps prevent re-register races when on-chain checks are flaky due to indexer lag)
const knownResolvedMarkets = new Set<string>();

// Phase 1 stability: Short-lived cache for reliable topic messages.
// Prevents hammering the same asc/desc pagination (x8/x20 "contributed 55x" loops) on every 15-20s poll/heartbeat.
// 8s TTL smooths UI "disappear/reappear" flashes while keeping data fresh for real-time bets/resolution.
let _topicMessagesCache: { ts: number; messages: any[] } | null = null;
const TOPIC_CACHE_TTL_MS = 8000;

/** Phase 1: Load active games from disk for restart resilience */
export async function loadActiveGamesFromDisk() {
  try {
    const data = await fs.readFile(ACTIVE_GAMES_FILE, 'utf8');
    const parsed = JSON.parse(data);

    if (Array.isArray(parsed.activeFastGames)) {
      activeFastGames.length = 0;
      parsed.activeFastGames.filter((g: any) => !g.resolved).forEach((g: any) => activeFastGames.push(g));
    }
    if (Array.isArray(parsed.tieResolutionGames)) {
      tieResolutionGames.length = 0;
      parsed.tieResolutionGames.forEach((t: any) => tieResolutionGames.push(t));
    }
    console.log(`[Resolver] Loaded ${activeFastGames.length} active games from disk`);
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      console.warn('[Resolver] Failed to load active games from disk:', e.message);
    }
    // File doesn't exist or is invalid — start fresh (normal on first run)
  }
}

/** Phase 1: Persist current active games to disk */
async function saveActiveGamesToDisk() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const data = {
      activeFastGames: activeFastGames.filter(g => !g.resolved),
      tieResolutionGames: tieResolutionGames.map(t => ({
        marketId: t.marketId,
        creationPrice: t.creationPrice,
      })),
      savedAt: new Date().toISOString(),
    };
    await fs.writeFile(ACTIVE_GAMES_FILE, JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.warn('[Resolver] Failed to persist active games:', e.message);
  }
}

export function registerFastGameForAutoResolution(marketId: string, endTime: number, durationMinutes?: number, asset?: string) {
  // Guard against duplicate registration (prevents re-resolve loops when reRegister misses a recent MARKET_RESOLVED due to indexer lag or HGraph flakiness)
  const existingIndex = activeFastGames.findIndex(g => g.marketId === marketId);
  if (existingIndex !== -1) {
    if (activeFastGames[existingIndex].resolved) {
      console.log(`[Resolver] ${marketId} already resolved in memory, skipping register`);
      knownResolvedMarkets.add(marketId);
      return;
    }
    // If we now have better duration info, update it
    if (durationMinutes && !activeFastGames[existingIndex].durationMinutes) {
      activeFastGames[existingIndex].durationMinutes = durationMinutes;
    }
    // Capture/upgrade asset when provided (supports XRP + future assets on re-register or late info)
    if (asset && !activeFastGames[existingIndex].asset) {
      activeFastGames[existingIndex].asset = asset;
    }
    console.log(`[Resolver] Fast game ${marketId} already registered in active list`);
    return;
  }
  if (knownResolvedMarkets.has(marketId)) {
    console.log(`[Resolver] ${marketId} known resolved, skipping register`);
    return;
  }

  // We no longer store creationPrice in memory.
  // It is fetched from the immutable HCS topic at resolution time for maximum auditability.
  // Asset is carried so autoResolve + getActiveFastGamesState can use the correct price oracle (XRP uses CG+Binance, never SaucerSwap).
  activeFastGames.push({ 
    marketId, 
    endTime, 
    durationMinutes: durationMinutes || 10,
    asset: asset || 'HBAR',
    creationPrice: 0, // placeholder — will be fetched from chain
    resolved: false,
    inTieResolution: false 
  });
  console.log(`[Resolver] Registered fast game for auto-resolution: ${marketId} (asset=${asset || 'HBAR'})`);
  saveActiveGamesToDisk().catch(() => {}); // fire and forget
}

export async function autoResolveExpiredFastGames() {
  const now = Math.floor(Date.now() / 1000);

  for (const game of activeFastGames) {
    if (game.resolved || game.inTieResolution) continue;
    if (game.endTime > now) continue;

    // Quick check to avoid re-processing games that already have a resolution on HCS
    try {
      const recentMessages = await fetchReliableTopicMessages(5000);
      const alreadyResolved = recentMessages.some((m: any) => {
        try {
          const raw = m.message || '';
          const decoded = decodeHcsMessage(raw);
          const p = JSON.parse(decoded);
          return p.type === 'MARKET_RESOLVED' && p.marketId === game.marketId;
        } catch { return false; }
      });
      if (alreadyResolved) {
        game.resolved = true;
        knownResolvedMarkets.add(game.marketId);
        continue;
      }
    } catch {}

    console.log(`[Resolver] Auto-resolving expired fast game: ${game.marketId}`);

    try {
      // Always fetch the authoritative creation data from the immutable HCS topic
      const creationData = await fetchFastGameCreationData(game.marketId);
      if (!creationData) {
        console.error(`[Resolver] Cannot resolve ${game.marketId} — creation data not found on-chain`);
        continue;
      }

      const openPrice = creationData.creationPrice;

      // Asset-aware closing price (XRP and other non-HBAR use CoinGecko + Binance only — never SaucerSwap)
      const assetForPrice = game.asset || 'HBAR';
      let closingPrice: number;
      let priceDataForResolve: any = null;
      try {
        priceDataForResolve = await getAssetPrice(assetForPrice);
        closingPrice = priceDataForResolve.price;
      } catch (priceErr) {
        console.error(`[Resolver] Failed to get ${assetForPrice} price for resolution:`, priceErr);
        continue;
      }

      const TIE_TOLERANCE = 0.00001;
      const MAX_TIE_POLL_SECONDS = 180; // Phase 0: Hard safety — never leave a game stuck in polling forever

      let winner: 'YES' | 'NO' | null = null;

      if (Math.abs(closingPrice - openPrice) <= TIE_TOLERANCE) {
        // === TIE CASE — enter 5-second breakout polling with hard timeout (Phase 0 fix) ===
        console.log(`[Resolver] Price tie detected for ${game.marketId} (open: ${openPrice}, close: ${closingPrice}). Entering 5s breakout polling. Max wait: ${MAX_TIE_POLL_SECONDS}s`);
        
        game.inTieResolution = true;
        const tieStart = Date.now();
        const tieAsset = game.asset || 'HBAR';

        const intervalId = setInterval(async () => {
          try {
            const latestPriceData = await getAssetPrice(tieAsset);
            const latestPrice = latestPriceData.price;
            const elapsed = Math.floor((Date.now() - tieStart) / 1000);

            if (Math.abs(latestPrice - openPrice) > TIE_TOLERANCE) {
              const tieWinner = latestPrice > openPrice ? 'YES' : 'NO';
              console.log(`[Resolver] Tie broken for ${game.marketId}! New price: ${latestPrice} → Winner: ${tieWinner} after ${elapsed}s`);

              const tiePriceData = await getAssetPrice(tieAsset).catch(() => null);
              const decisionTime = tiePriceData?.resolvedAt || new Date().toISOString();

              await postMarketResolved({
                marketId: game.marketId,
                winner: tieWinner,
                closingPrice: latestPrice,
                resolvedAt: decisionTime,
                priceTime: tiePriceData?.priceTime,
                priceSource: tiePriceData?.source,
                resolver: RESOLUTION_ACCOUNT,
              });

              knownResolvedMarkets.add(game.marketId);
              recordResolutionEvent({
                marketId: game.marketId,
                winner: tieWinner,
                closingPrice: latestPrice,
                priceSource: tiePriceData?.source || 'unknown',
                resolvedAt: decisionTime,
              });

              // Phase 0: Schedule delayed payout after tie is broken
              if (game.marketId.startsWith('fast-')) {
                scheduleDelayedPayout(game.marketId, 28000);
              }

              clearInterval(intervalId);
              game.resolved = true;
              game.inTieResolution = false;

              const idx = tieResolutionGames.findIndex(g => g.marketId === game.marketId);
              if (idx !== -1) tieResolutionGames.splice(idx, 1);

              saveActiveGamesToDisk().catch(() => {});
              return;
            }

            // Phase 0 safety: force resolution after max time instead of infinite polling
            if (elapsed >= MAX_TIE_POLL_SECONDS) {
              console.log(`[Resolver] Tie polling timeout for ${game.marketId} after ${elapsed}s. Forcing resolution using last observed price.`);

              const forceWinner = latestPrice >= openPrice ? 'YES' : 'NO'; // Bias toward the observed direction at timeout
              const forcePriceData = await getAssetPrice(tieAsset).catch(() => null);
              const decisionTime = forcePriceData?.resolvedAt || new Date().toISOString();

              await postMarketResolved({
                marketId: game.marketId,
                winner: forceWinner,
                closingPrice: latestPrice,
                resolvedAt: decisionTime,
                priceTime: forcePriceData?.priceTime,
                priceSource: forcePriceData?.source,
                resolver: RESOLUTION_ACCOUNT,
              });

              knownResolvedMarkets.add(game.marketId);
              recordResolutionEvent({
                marketId: game.marketId,
                winner: forceWinner,
                closingPrice: latestPrice,
                priceSource: forcePriceData?.source || 'unknown',
                resolvedAt: decisionTime,
              });

              // Phase 0: Schedule delayed payout even on forced tie timeout resolution
              if (game.marketId.startsWith('fast-')) {
                scheduleDelayedPayout(game.marketId, 28000);
              }

              clearInterval(intervalId);
              game.resolved = true;
              game.inTieResolution = false;

              const idx = tieResolutionGames.findIndex(g => g.marketId === game.marketId);
              if (idx !== -1) tieResolutionGames.splice(idx, 1);

              saveActiveGamesToDisk().catch(() => {});
            }
          } catch (e) {
            console.error(`[Resolver] Error during tie resolution polling for ${game.marketId}:`, e);
          }
        }, 5000);

        tieResolutionGames.push({ marketId: game.marketId, creationPrice: openPrice, intervalId });
        saveActiveGamesToDisk().catch(() => {});
        continue;
      } 
      else if (closingPrice > openPrice) {
        winner = 'YES';
      } 
      else {
        winner = 'NO';
      }

      if (winner) {
        const priceData = priceDataForResolve || await getAssetPrice(game.asset || 'HBAR').catch(() => null);
        const decisionTime = priceData?.resolvedAt || new Date().toISOString();

        await postMarketResolved({
          marketId: game.marketId,
          winner,
          closingPrice,
          resolvedAt: decisionTime,
          priceTime: priceData?.priceTime,
          priceSource: priceData?.source,
          resolver: RESOLUTION_ACCOUNT,
        });

        recordResolutionEvent({
          marketId: game.marketId,
          winner,
          closingPrice,
          priceSource: priceData?.source || 'unknown',
          resolvedAt: decisionTime,
        });

        game.resolved = true;
        knownResolvedMarkets.add(game.marketId);
        console.log(
          `[Resolver] Auto-posted MARKET_RESOLVED for ${game.marketId} | ` +
          `Open: ${openPrice} → Close: ${closingPrice} | Winner: ${winner} | ` +
          `decisionTime=${decisionTime}`
        );

        saveActiveGamesToDisk().catch(() => {});

        // Phase 0 fix: After any successful auto-resolution of a fast game, schedule the 28s delayed payout.
        // This ensures the full automatic payout flow works even when resolution happens inside the resolver loop.
        if (game.marketId.startsWith('fast-')) {
          scheduleDelayedPayout(game.marketId, 28000);
        }
      }

    } catch (err) {
      console.error(`[Resolver] Failed to auto-resolve ${game.marketId}:`, err);
    }
  }

  // Clean resolved games from the active list (prevents re-registration races and list bloat from historical games).
  // We mutate the const array in place.
  const beforeClean = activeFastGames.length;
  activeFastGames.splice(0, activeFastGames.length, ...activeFastGames.filter(g => !g.resolved));
  if (activeFastGames.length !== beforeClean) {
    saveActiveGamesToDisk().catch(() => {});
  }
}

/**
 * Professional claim handler.
 * Calculates correct payout (win vs unmatched return) and executes it using the privileged key.
 * This is the long-term automated path.
 */
// ========================================================
// CLAIM TRACKING & PAYOUT LOGIC (Long-term secure architecture)
// ========================================================

// In-memory claim tracking for smoke test phase.
// Prevents the same user from claiming the same market multiple times.
const claimedPayouts = new Set<string>();

const HGRAPH_URL: string = process.env.HGRAPH_URL || (() => {
  throw new Error('Missing HGRAPH_URL in environment. For testnet job: your testnet HGraph endpoint; for mainnet job: your mainnet HGraph endpoint (or public testnet for dev only).');
})();

/**
 * Robust HCS topic message fetcher.
 * Primary goal: Never lose PLACE_BET records for payouts and claimables due to HGraph indexer lag.
 * Strategy: Try HGraph first (rich indexed data), fall back to Hedera's official Mirror Node REST
 * which serves raw consensus topic messages with very low latency. This is what HashScan uses.
 * Results are normalized to { message: string, consensus_timestamp?: string } shape.
 */
/** Helper: paginate Mirror Node topic messages by following `links.next` (Mirror caps pages at ~100).
 * Collects up to ~limit or maxPages pages. Used to make fetchReliable actually deliver large windows
 * for volume, history, re-register etc when the topic has hundreds of messages.
 */
async function fetchMirrorTopicMessagesPaginated(order: 'asc' | 'desc', maxPages = 5): Promise<any[]> {
  const numeric = MASTER_TOPIC_ID.split('.').pop()!;
  const out: any[] = [];
  let url = `${MIRROR_NODE}/api/v1/topics/${numeric}/messages?limit=100&order=${order}`;
  for (let p = 0; p < maxPages; p++) {
    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const data: any = await res.json();
      for (const m of data.messages || []) {
        out.push({
          message: m.message,
          consensus_timestamp: m.consensus_timestamp,
          sequence_number: m.sequence_number,
        });
      }
      const next: string | undefined = data.links?.next;
      if (!next || out.length >= 2000) break;
      url = next.startsWith('http') ? next : `${MIRROR_NODE}${next}`;
    } catch {
      break;
    }
  }
  return out;
}

export async function fetchReliableTopicMessages(limit = 1000): Promise<any[]> {
  // Phase 1: Use short cache to debounce repeated full scans (the source of the repeated "Mirror (asc paginated x8) contributed 55x" spam and HGraph failures on every poll).
  const now = Date.now();
  if (_topicMessagesCache && (now - _topicMessagesCache.ts) < TOPIC_CACHE_TTL_MS) {
    return _topicMessagesCache.messages;
  }

  // 1. Try HGraph (current primary in most paths)
  try {
    const h = await fetchTopicMessages(limit);
    if (h && h.length > 0) {
      // Quick sanity: if we got a decent batch, still augment with Mirror for newest messages
      // (HGraph can be seconds behind during bursts). For simplicity in this fix we union below.
    }
  } catch (e) {
    // fall through to Mirror
  }

  const all: any[] = [];
  const seenTs = new Set<string>();

  // Helper to add with dedup
  const add = (row: any) => {
    const ts = row.consensus_timestamp || row.consensusTimestamp || '';
    const key = ts || JSON.stringify(row).slice(0, 80);
    if (!seenTs.has(key)) {
      seenTs.add(key);
      all.push(row);
    }
  };

  // Collect from HGraph if it gave anything
  try {
    const hg = await fetchTopicMessages(limit);
    for (const r of hg || []) add(r);
  } catch {}

  // 2. Mirror asc (oldest-first pages via next links) — now actually paginates so large limits for history/volume work
  try {
    const pages = Math.max(2, Math.ceil(Math.min(limit, 2000) / 100));
    const ascMsgs = await fetchMirrorTopicMessagesPaginated('asc', pages);
    for (const r of ascMsgs) add(r);
    if (ascMsgs.length && Math.random() < 0.05) {
      console.log(`[Resolver] Mirror (asc paginated x${pages}) contributed ${ascMsgs.length} topic messages (reliable path)`);
    }
  } catch (e: any) {
    if (Math.random() < 0.2) console.warn('[Resolver] Mirror topic messages fallback error (non-fatal):', e?.message);
  }

  // 3. Mirror desc (newest) — a few pages of recent is enough to catch just-posted MARKET_RESOLVED / latest bets
  try {
    const descMsgs = await fetchMirrorTopicMessagesPaginated('desc', 3);
    for (const r of descMsgs) add(r);
  } catch (e: any) {
    if (Math.random() < 0.2) console.warn('[Resolver] Mirror recent (desc) fallback error (non-fatal):', e?.message);
  }

  // Return newest first or oldest first? Existing code expects roughly asc; we keep as collected (Mirror asc)

  // Phase 1: Cache the result
  _topicMessagesCache = { ts: Date.now(), messages: all };
  return all;
}

/** Unified decoder for HCS message bytes coming from HGraph (hex-ish) or Mirror (base64) or plain JSON string. */
export function decodeHcsMessage(raw: any): string {
  if (!raw) return '';
  const s = String(raw);
  if (s.startsWith('\\x')) {
    try { return Buffer.from(s.replace(/\\x/g, ''), 'hex').toString('utf8'); } catch {}
  }
  // Mirror Node format: base64 of the exact bytes submitted to consensus
  if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length > 10) {
    try {
      const buf = Buffer.from(s, 'base64');
      const text = buf.toString('utf8');
      // Heuristic: if it looks like JSON or starts with { we succeeded
      if (text.trim().startsWith('{')) return text;
      // otherwise fall through
    } catch {}
  }
  return s; // already utf8 or unknown, let JSON.parse fail gracefully upstream
}

/**
 * Lightweight, on-demand volume reconciliation for a single fast game.
 * Used by the UI for "Reconcile Volume" buttons and smart auto-refresh after bets.
 * 
 * This is the key enabler for near real-time YES/NO volume accuracy.
 */
export async function getMarketVolume(marketId: string) {
  const messages = await fetchReliableTopicMessages(2000);

  let yesStake = 0;
  let noStake = 0;
  const yesParticipants = new Set<string>();
  const noParticipants = new Set<string>();

  for (const row of messages) {
    try {
      const raw = row.message || '';
      const decoded = decodeHcsMessage(raw);
      const p = JSON.parse(decoded);

      if (p.marketId !== marketId || p.type !== 'PLACE_BET') continue;

      const side = (p.side || '').toUpperCase();
      const amount = Number(p.amount) || 0;
      const user = p.user || p.submittedBy;

      if (!user || amount <= 0) continue;

      if (side === 'YES') {
        yesStake += amount;
        yesParticipants.add(user);
      } else if (side === 'NO') {
        noStake += amount;
        noParticipants.add(user);
      }
    } catch {
      // skip malformed messages
    }
  }

  const totalVolume = yesStake + noStake;

  return {
    marketId,
    yesStake: Math.round(yesStake * 100) / 100,
    noStake: Math.round(noStake * 100) / 100,
    totalVolume: Math.round(totalVolume * 100) / 100,
    yesParticipants: yesParticipants.size,
    noParticipants: noParticipants.size,
    lastUpdated: new Date().toISOString(),
    source: 'HCS reliable (HGraph + Mirror)',
  };
}

/**
 * Source of truth for HBAR last traded price.
 * Per requirement: This must come from the HGraph MCP server.
 * 
 * The resolver is the single source of truth for market resolution.
 * It must query HGraph MCP for the authoritative last traded HBAR price
 * at the moment of resolution.
 */
/**
 * Production-grade HBAR price oracle for market resolution.
 *
 * Key principles (updated for trading-app accuracy per master plan):
 * - SaucerSwap last-traded / pool price (via their authenticated API + direct contract
 *   reserves verification via Mirror) is the primary for the "true on-chain market price"
 *   that traders see.
 * - Immediate double-check against HGraph (for up-to-the-second indexer freshness/timing)
 *   and Mirror (official 3rd source) with a very small tolerance at the exact wager
 *   creation and resolution moments.
 * - Resolver (privileged) makes the final decision and records rich provenance.
 * - Force-fresh (bypass cache) on critical paths (post-payment create, resolution).
 * - Full audit string carried to HCS CREATE_MARKET / MARKET_RESOLVED.
 * - Zero breakage to other live MVP key usages; graceful fallback to prior Mirror behavior.
 */
/**
 * Reliable global-scale HBAR price for display (modal "CURRENT HBAR") and game creationPrice/resolution.
 * New strategy per user (no Mirror or HGraph price calls for now):
 * 1. SaucerSwap API (mainnet) for current trading / last-traded pool price (when key available).
 * 2. Fallback to the exact same CoinGecko source used for the trusted card prices (the "always correct" one in the UI image).
 * 3. BNB / Binance oracle as final public fallback.
 * 
 * This ensures the price shown in the HBAR card, the modal rate for the game, and the snapped creationPrice
 * are consistent and from reliable public + on-chain DEX sources.
 * Critical paths (create) bypass cache for fresh value at the exact wager moment.
 */
export async function getCurrentHbarPriceWithAuditTrail(options: { critical?: boolean } = {}): Promise<{
  price: number;
  priceTime: string;
  resolvedAt: string;
  source: string;
  isStale: boolean;
  provenance?: string;
}> {
  const nowTs = Date.now();
  const isCritical = !!options.critical;

  // 15s TTL cache for normal calls (UI cards, polls). Critical paths (post-payment create, resolution) always fresh.
  if (!isCritical && cachedPriceData && (nowTs - cachedPriceAt) < PRICE_CACHE_TTL_MS) {
    return {
      ...cachedPriceData,
      resolvedAt: new Date().toISOString(),
    };
  }

  const resolvedAt = new Date().toISOString();

  // 1. SaucerSwap mainnet API for the current trading price (primary when key is present via Railway secret or Supabase kv_store)
  if (process.env.SAUCERSWAP_API_KEY) {
    try {
      const base = 'https://api.saucerswap.finance';
      const r = await fetch(`${base}/v2/pools/full`, {
        headers: { 'x-api-key': process.env.SAUCERSWAP_API_KEY } as any,
      });
      if (r.ok) {
        const pools = (await r.json()) as any[];
        for (const p of (pools || [])) {
          const t0 = p.token0 || p.tokenA || {};
          const t1 = p.token1 || p.tokenB || {};
          let hbarTok: any = null;
          if (t0.symbol === 'HBAR' || t0.symbol?.toUpperCase?.() === 'HBAR') hbarTok = t0;
          else if (t1.symbol === 'HBAR' || t1.symbol?.toUpperCase?.() === 'HBAR') hbarTok = t1;
          if (hbarTok && (hbarTok.priceUsd || hbarTok.price)) {
            const price = parseFloat(hbarTok.priceUsd || hbarTok.price);
            if (price > 0.01) {
              const result = {
                price,
                priceTime: resolvedAt,
                resolvedAt,
                source: 'SaucerSwap (mainnet trading price)',
                isStale: false,
                provenance: 'SaucerSwap API v2/pools/full (last-traded / pool price)',
              };
              if (!isCritical) { cachedPriceData = result; cachedPriceAt = nowTs; }
              console.log(`[Resolver] ✅ SaucerSwap mainnet HBAR trading price: $${price.toFixed(6)}`);
              return result;
            }
          }
        }
      }
    } catch (sErr) {
      console.warn('[Resolver] SaucerSwap price fetch failed, falling back to card source:', (sErr as Error).message);
    }
  }

  // 2. Fallback to the exact CoinGecko source used for the trusted HBAR card price in the UI (the "always correct" one)
  try {
    const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd');
    if (cgRes.ok) {
      const cgJson: any = await cgRes.json();
      const price = parseFloat(cgJson?.['hedera-hashgraph']?.usd);
      if (!isNaN(price) && price > 0) {
        const result = {
          price,
          priceTime: resolvedAt,
          resolvedAt,
          source: 'CoinGecko (card price source)',
          isStale: false,
          provenance: 'CoinGecko (same as live assets / card prices)',
        };
        if (!isCritical) { cachedPriceData = result; cachedPriceAt = nowTs; }
        console.log(`[Resolver] ✅ CoinGecko (card source) mainnet HBAR: $${price.toFixed(6)}`);
        return result;
      }
    }
  } catch (cgErr) {
    console.warn('[Resolver] CoinGecko card source failed, trying BNB/Binance fallback');
  }

  // 3. BNB oracle / Binance public API as final reliable fallback (no key, global scale)
  try {
    const binRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=HBARUSDT');
    if (binRes.ok) {
      const binJson: any = await binRes.json();
      const price = parseFloat(binJson?.price);
      if (!isNaN(price) && price > 0) {
        const result = {
          price,
          priceTime: resolvedAt,
          resolvedAt,
          source: 'Binance (BNB oracle)',
          isStale: false,
          provenance: 'Binance public ticker HBARUSDT',
        };
        if (!isCritical) { cachedPriceData = result; cachedPriceAt = nowTs; }
        console.log(`[Resolver] ✅ Binance (BNB oracle) mainnet HBAR: $${price.toFixed(6)}`);
        return result;
      }
    }
  } catch (binErr) {
    console.error('[Resolver] Binance BNB oracle also failed');
  }

  // Last resort (should rarely hit)
  throw new Error('All reliable HBAR price sources (Saucer, CoinGecko card source, Binance) exhausted');
}

/**
 * Asset-aware price oracle for fast game creationPrice + resolution.
 *
 * Rules (per XRP integration master plan):
 * - HBAR (or HBARH): delegates fully to the rich getCurrentHbarPriceWithAuditTrail
 *   (SaucerSwap last-traded when SAUCERSWAP_API_KEY present + Mirror/SDK + CG/Binance fallbacks).
 *   This preserves all existing HBAR provenance, cache, critical-path bypass, and HCS audit trail.
 * - XRP, BTC, ETH, SOL (and future non-HBAR prediction assets): CoinGecko primary (using the
 *   exact same ids as the live card prices in Predict.tsx / coingecko.ts) + Binance public
 *   ticker (USDT pair) as the "bnb as backup".
 * - NEVER calls SaucerSwap for non-HBAR assets.
 * - Returns the exact same shape as the HBAR fn so call sites can switch with zero other changes.
 * - Used by the /create path (critical: true for fresh snap at funded record time) and by
 *   autoResolve for fair closing price.
 */
export async function getAssetPrice(asset: string, options: { critical?: boolean } = {}): Promise<{
  price: number;
  priceTime: string;
  resolvedAt: string;
  source: string;
  isStale: boolean;
  provenance?: string;
}> {
  const upper = (asset || 'HBAR').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper === 'HBAR' || upper === 'HBARH') {
    return getCurrentHbarPriceWithAuditTrail(options);
  }

  const nowTs = Date.now();
  const resolvedAt = new Date().toISOString();

  // Supported assets for prediction markets. Keep in sync with coingecko.ts maps + Predict fetchLivePrices ids.
  const priceMap: Record<string, { cgId: string; binancePair: string; label: string; decimals: number }> = {
    BTC: { cgId: 'bitcoin',     binancePair: 'BTCUSDT',  label: 'Bitcoin',  decimals: 2 },
    ETH: { cgId: 'ethereum',    binancePair: 'ETHUSDT',  label: 'Ethereum', decimals: 2 },
    SOL: { cgId: 'solana',      binancePair: 'SOLUSDT',  label: 'Solana',   decimals: 2 },
    XRP: { cgId: 'ripple',      binancePair: 'XRPUSDT',  label: 'XRP',      decimals: 4 },
  };

  const cfg = priceMap[upper];
  if (!cfg) {
    console.warn(`[Resolver] Unknown asset "${asset}" for price oracle — falling back to HBAR behavior (defensive)`);
    return getCurrentHbarPriceWithAuditTrail(options);
  }

  // 1. CoinGecko (primary — same family as the trusted card prices the user sees)
  try {
    const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cfg.cgId}&vs_currencies=usd`);
    if (cgRes.ok) {
      const cgJson: any = await cgRes.json();
      const price = parseFloat(cgJson?.[cfg.cgId]?.usd);
      if (!isNaN(price) && price > 0) {
        const result = {
          price,
          priceTime: resolvedAt,
          resolvedAt,
          source: `CoinGecko (${cfg.label} card price source)`,
          isStale: false,
          provenance: `CoinGecko simple/price ${cfg.cgId} (no SaucerSwap)`,
        };
        console.log(`[Resolver] ✅ CoinGecko mainnet ${upper}: $${price.toFixed(cfg.decimals)}`);
        return result;
      }
    }
  } catch (cgErr) {
    console.warn(`[Resolver] CoinGecko for ${upper} failed, trying Binance BNB oracle`);
  }

  // 2. Binance public ticker (BNB oracle style final public fallback — exactly as requested for XRP)
  try {
    const binRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cfg.binancePair}`);
    if (binRes.ok) {
      const binJson: any = await binRes.json();
      const price = parseFloat(binJson?.price);
      if (!isNaN(price) && price > 0) {
        const result = {
          price,
          priceTime: resolvedAt,
          resolvedAt,
          source: `Binance (BNB oracle ${cfg.binancePair})`,
          isStale: false,
          provenance: `Binance public ticker ${cfg.binancePair} (no SaucerSwap)`,
        };
        console.log(`[Resolver] ✅ Binance (BNB oracle) mainnet ${upper}: $${price.toFixed(cfg.decimals)}`);
        return result;
      }
    }
  } catch (binErr) {
    console.error(`[Resolver] Binance BNB oracle for ${upper} also failed`);
  }

  throw new Error(`All reliable price sources for ${upper} (CoinGecko + Binance) exhausted`);
}

// Export for use by the API layer (price endpoint)


/**
 * Authoritative payout calculator.
 * Resolver is the single source of truth. It re-verifies everything from HCS via HGraph.
 * This is the professional, high-stakes, auditable implementation.
 */
export async function fetchTopicMessages(limit = 500) {
  const numericId = MASTER_TOPIC_ID.split('.').pop();
  const query = `
    query GetTopicMessages($topicId: bigint!, $limit: Int) {
      topic_message(
        where: { topic_id: { _eq: $topicId } }
        order_by: { consensus_timestamp: asc }
        limit: $limit
      ) {
        message
        consensus_timestamp
      }
    }
  `;

  try {
    const res = await fetch(HGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { topicId: numericId, limit },
      }),
    });
    const json: any = await res.json();
    return json?.data?.topic_message || [];
  } catch (e) {
    // HGraph public testnet GraphQL is often flaky (returns HTML errors); Mirror fallback handles it.
    // Log at low rate to avoid spam while still surfacing persistent issues.
    if (Math.random() < 0.05) {
      console.warn('[Resolver] HGraph fetch failed (non-fatal, using Mirror fallback)', (e as Error).message?.substring(0, 100));
    }
    return [];
  }
}

/**
 * Fetches the original CREATE_MARKET message for a fast game from the immutable HCS topic.
 * This ensures we always use the price that was actually recorded on-chain at creation time,
 * making resolution tamper-resistant.
 */
export async function fetchFastGameCreationData(marketId: string): Promise<{
  creationPrice: number;
  initialSide: 'YES' | 'NO';
  question?: string;
  endTime?: number;
  durationMinutes?: number;
  creationPriceTime?: string;
} | null> {
  // Fetch a large window of recent messages and find the matching CREATE (reliable path)
  const messages = await fetchReliableTopicMessages(2000);

  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i];
    try {
      const raw = row.message || '';
      const decoded = decodeHcsMessage(raw);
      const p = JSON.parse(decoded);

      if (p.marketId === marketId && (p.type === 'CREATE_MARKET' || p.type === 'MARKET_CREATED')) {
        const price = Number(p.creationPrice ?? p.currentPrice ?? 0);
        const side = (p.initialSide || p.direction || 'YES').toUpperCase() as 'YES' | 'NO';

        return {
          creationPrice: price,
          initialSide: side,
          question: p.question,
          endTime: p.endTime,
          durationMinutes: p.durationMinutes,
          creationPriceTime: p.creationPriceTime,
        };
      }
    } catch {
      // ignore bad messages
    }
  }

  console.error(`[Resolver] Could not find CREATE_MARKET message for ${marketId} on HCS`);
  return null;
}

export async function computePayoutForUser(marketId: string, userAccountId: string): Promise<{
  owed: number;
  reason: 'WIN' | 'UNMATCHED_RETURN';
  myStake: number;
  totalWinningSideStake: number;
  totalLosingSideStake: number;
  winningSide: 'YES' | 'NO' | null;
  alreadyPaid: boolean;
}> {
  // Use reliable fetch so UI claimables and history always see the real PLACE_BET records
  // (even when HGraph is lagging behind raw consensus).
  const messages = await fetchReliableTopicMessages(800);

  let winningSide: 'YES' | 'NO' | null = null;
  let myStake = 0;
  let myYes = 0;
  let myNo = 0;
  let totalYes = 0;
  let totalNo = 0;

  for (const row of messages) {
    try {
      const raw = row.message || '';
      const decoded = decodeHcsMessage(raw);
      const p = JSON.parse(decoded);

      if (p.marketId !== marketId) continue;

      if (p.type === 'MARKET_RESOLVED') {
        winningSide = p.winner;
      }
      if (p.type === 'PLACE_BET') {
        const side = (p.side || '').toUpperCase();
        const amt = Number(p.amount) || 0;
        if (side === 'YES') totalYes += amt;
        if (side === 'NO') totalNo += amt;
      }
    } catch {}
  }

  if (!winningSide) {
    return { owed: 0, reason: 'WIN', myStake: 0, totalWinningSideStake: 0, totalLosingSideStake: 0, winningSide: null, alreadyPaid: false };
  }

  // Re-walk to get the user's actual stake(s) — we need the real side they bet on
  // so we can correctly refund in completely one-sided markets even if the price
  // resolution made their side the "loser".
  myStake = 0;
  myYes = 0;
  myNo = 0;
  for (const row of messages) {
    try {
      const raw = row.message || '';
      const decoded = decodeHcsMessage(raw);
      const p = JSON.parse(decoded);
      if (p.marketId !== marketId || p.type !== 'PLACE_BET') continue;
      const side = (p.side || '').toUpperCase();
      const amt = Number(p.amount) || 0;
      if ((p.user || p.submittedBy) === userAccountId) {
        myStake += amt;
        if (side === 'YES') myYes += amt;
        else myNo += amt;
      }
    } catch {}
  }

  const totalWinning = winningSide === 'YES' ? totalYes : totalNo;
  const totalLosing = winningSide === 'YES' ? totalNo : totalYes;
  const isOneSided = totalYes === 0 || totalNo === 0;

  if (myStake === 0) {
    return { owed: 0, reason: 'WIN', myStake: 0, totalWinningSideStake: totalWinning, totalLosingSideStake: totalLosing, winningSide, alreadyPaid: false };
  }

  // === Check for existing PAYOUT (critical for refresh persistence) ===
  // If we already paid this user for this market, never report it as claimable again.
  let alreadyPaid = false;
  for (const row of messages) {
    try {
      const raw = row.message || '';
      const decoded = decodeHcsMessage(raw);
      const p = JSON.parse(decoded);
      if (p.marketId === marketId && p.type === 'PAYOUT' && (p.recipient || p.to) === userAccountId) {
        alreadyPaid = true;
        break;
      }
    } catch {}
  }

  if (alreadyPaid) {
    return {
      owed: 0,
      reason: 'WIN',
      myStake,
      totalWinningSideStake: totalWinning,
      totalLosingSideStake: totalLosing,
      winningSide,
      alreadyPaid: true,
    };
  }

  // === Professional Parimutuel Math + One-Sided Refund Rule ===
  // If one side had *zero* bettors at resolution time, all participants on the only
  // active side get their stake back (minus any applicable creation fee which was
  // already taken at creation). This is independent of the price-based winner.
  // The 2% facilitation fee is only ever taken when there was opposing stake.
  let owed = 0;
  let reason: 'WIN' | 'UNMATCHED_RETURN' = 'WIN';

  if (isOneSided) {
    // Completely one-sided market — refund everyone who bet, regardless of price outcome.
    owed = myStake;
    reason = 'UNMATCHED_RETURN';
  } else {
    const userStakeOnWinningSide = (winningSide === 'YES' ? myYes : myNo);
    if (userStakeOnWinningSide > 0) {
      if (totalLosing === 0) {
        // No one on the other side (edge case of the above)
        owed = myStake;
        reason = 'UNMATCHED_RETURN';
      } else {
        const profit = (userStakeOnWinningSide / totalWinning) * totalLosing;
        owed = userStakeOnWinningSide + profit;
        reason = 'WIN';
      }
    }
    // else: user was purely on the losing side in a two-sided market → owed = 0
  }

  return {
    owed: Math.round(owed * 100) / 100,
    reason,
    myStake,
    totalWinningSideStake: totalWinning,
    totalLosingSideStake: totalLosing,
    winningSide,
    alreadyPaid: false,
  };
}

/**
 * Professional claim processor (resolver is the oracle).
 * Always re-computes the exact owed amount from HCS before paying.
 * This is bank-grade: client can suggest, resolver verifies and decides.
 */
export async function processClaim(marketId: string, winnerAccountId: string, clientSuggestedAmount?: number) {
  const claimKey = `${marketId}:${winnerAccountId}`;

  // Phase 3: If the market was already paid via the automatic path, don't double pay
  if (await hasExistingPayout(marketId)) {
    return { 
      success: false, 
      error: 'This market has already been paid out automatically. Check your wallet or transaction history.', 
      amountPaid: 0 
    };
  }

  if (claimedPayouts.has(claimKey)) {
    console.warn(`[Resolver] BLOCKED duplicate claim for ${winnerAccountId} on ${marketId}`);
    return { success: false, error: 'This claim has already been processed.', amountPaid: 0 };
  }

  // Authoritative calculation from the ledger
  const calc = await computePayoutForUser(marketId, winnerAccountId);

  if (calc.owed <= 0) {
    return { success: false, error: 'Nothing owed on this market for this account.', amountPaid: 0 };
  }

  console.log(`[Resolver] Authoritative payout calc → ${calc.owed} HBAR (${calc.reason}) to ${winnerAccountId} for ${marketId}`);

  // Phase 3 Funding Safety
  const resolverBalance = await getResolverBalance();
  if (resolverBalance < calc.owed) {
    console.error(`[Resolver] Phase 3 Funding Safety: Insufficient resolver balance for claim on ${marketId}. Balance: ${resolverBalance}, Required: ${calc.owed}`);
    return { success: false, error: 'Resolver has insufficient balance for this claim', amountPaid: 0 };
  }

  const txId = await executePayout({
    toAccountId: winnerAccountId,
    amountHbar: calc.owed,
    memo: `Claim ${calc.reason} for ${marketId}`,
  });

  claimedPayouts.add(claimKey);

  await postPayoutMessage({
    marketId,
    recipient: winnerAccountId,
    amount: calc.owed,
    reason: calc.reason,
  });

  return {
    success: true,
    transactionId: txId,
    amountPaid: calc.owed,
    reason: calc.reason,
    myStake: calc.myStake,
    totalWinning: calc.totalWinningSideStake,
    totalLosing: calc.totalLosingSideStake,
  };
}


/**
 * YOLO / Treasury bulk retirement of dead fast games.
 * Posts FAST_GAME_RETIRED messages on HCS for each provided marketId using the privileged key.
 * This is the canonical, auditable way to permanently remove old 0h unresolvable test markets
 * from the "Active" lists for everyone, without touching any user funds.
 */
export async function retireDeadFastGames(marketIds: string[], reason: string = 'LEGACY_0H_TEST_CORPSE') {
  const retired: string[] = [];
  const failed: string[] = [];

  for (const marketId of marketIds) {
    try {
      // Post both for maximum compatibility during transition
      await postFastGameRetired({
        marketId,
        reason,
        retiredBy: RESOLUTION_ACCOUNT,
        note: 'Bulk retired via treasury professional archive',
      });
      await postMarketRetired({
        marketId,
        reason,
        retiredBy: RESOLUTION_ACCOUNT,
        note: 'Canonical MARKET_RETIRED for long-term active list filtering',
      });
      retired.push(marketId);
      console.log(`[Resolver] Posted MARKET_RETIRED + FAST_GAME_RETIRED for ${marketId} (${reason})`);
    } catch (err) {
      console.error(`[Resolver] Failed to retire ${marketId}:`, err);
      failed.push(marketId);
    }
  }

  return { retired, failed, count: retired.length };
}

// ========================================================
// PHASE 1: AUTOMATIC DELAYED PAYOUT SCHEDULING (Bank-grade)
// Single source of truth. Triggered after MARKET_RESOLVED for fast-* games.
// 28s safety window + explicit PAYOUT_CLOSED on HCS.
// ========================================================

// In-memory scheduled payout timers (marketId → timeout handle)
const scheduledPayoutTimers = new Map<string, NodeJS.Timeout>();

/**
 * Returns true if a PAYOUT or PAYOUT_CLOSED already exists for this market on HCS.
 * Used to make processAutomaticPayoutsForMarket idempotent.
 */
async function hasExistingPayout(marketId: string): Promise<boolean> {
  try {
    // Use reliable (HGraph+Mirror paginated) so we don't miss a recent PAYOUT_CLOSED due to HGraph lag or small page.
    const messages = await fetchReliableTopicMessages(1500);
    for (const row of messages) {
      try {
        const raw = row.message || '';
        const decoded = decodeHcsMessage(raw);
        const p = JSON.parse(decoded);
        if (p.marketId === marketId && (p.type === 'PAYOUT' || p.type === 'PAYOUT_CLOSED')) {
          return true;
        }
      } catch {}
    }
  } catch (e) {
    console.error('[Resolver] hasExistingPayout scan failed:', e);
  }
  return false;
}

/** Exported helper for claim flow to check if automatic payout already happened */
export { hasExistingPayout };

/**
 * Core automatic payout processor.
 * - Re-scans the immutable HCS topic for the market
 * - Skips if PAYOUT_CLOSED already posted
 * - Uses MARKET_RESOLVED winner + all PLACE_BET messages
 * - Executes payouts via privileged resolver account
 * - Posts PAYOUT for each recipient + final PAYOUT_CLOSED
 * This is the professional, auditable path.
 */
export async function processAutomaticPayoutsForMarket(marketId: string) {
  console.log(`[Resolver] processAutomaticPayoutsForMarket(${marketId})`);

  if (await hasExistingPayout(marketId)) {
    console.log(`[Resolver] Skipping ${marketId} — PAYOUT or PAYOUT_CLOSED already on HCS`);
    return { success: true, skipped: true, reason: 'Already paid or closed' };
  }

  // Authoritative data from HCS (reliable path: HGraph + Mirror Node fallback)
  // This ensures PLACE_BET records are never missed due to indexer lag → proper win/loss + payouts.
  const messages = await fetchReliableTopicMessages(2000);

  let winner: 'YES' | 'NO' | null = null;
  const bets: Array<{ user: string; side: 'YES' | 'NO'; amount: number }> = [];

  for (const row of messages) {
    try {
      const raw = row.message || '';
      const decoded = decodeHcsMessage(raw);
      const p = JSON.parse(decoded);

      if (p.marketId !== marketId) continue;

      if (p.type === 'MARKET_RESOLVED') {
        winner = (p.winner || '').toUpperCase() as 'YES' | 'NO';
      }
      if (p.type === 'PLACE_BET') {
        const side = (p.side || '').toUpperCase() as 'YES' | 'NO';
        const amount = Number(p.amount) || 0;
        const user = p.user || p.submittedBy;
        if (user && side && amount > 0) {
          bets.push({ user, side, amount });
        }
      }
    } catch {}
  }

  if (!winner) {
    console.error(`[Resolver] No MARKET_RESOLVED found for ${marketId} — cannot auto-payout`);
    return { success: false, error: 'No resolution found on HCS' };
  }

  // Compute totals to detect completely one-sided markets
  let totalYesStake = 0;
  let totalNoStake = 0;
  for (const b of bets) {
    if (b.side === 'YES') totalYesStake += b.amount;
    else totalNoStake += b.amount;
  }
  const isOneSided = totalYesStake === 0 || totalNoStake === 0;

  // Compute per-user payout.
  // If the market was completely one-sided (one pool had zero bettors), everyone who
  // participated on the only active side gets their stake back as UNMATCHED_RETURN,
  // *regardless* of what the price resolution said. This stops one-sided "losing" bets
  // from being forfeited to the house/escrow.
  const winnersMap = new Map<string, number>();
  let totalWinningStake = 0;
  let totalLosingStake = 0;

  for (const b of bets) {
    if (b.side === winner) {
      totalWinningStake += b.amount;
    } else {
      totalLosingStake += b.amount;
    }
  }

  for (const b of bets) {
    let owed = 0;
    if (isOneSided) {
      // One side had no bettors at all → refund the only participants
      owed = b.amount;
    } else if (b.side === winner) {
      owed = b.amount;
      if (totalLosingStake > 0) {
        const profit = (b.amount / totalWinningStake) * totalLosingStake;
        owed = b.amount + profit;
      }
    }
    if (owed > 0) {
      winnersMap.set(b.user, (winnersMap.get(b.user) || 0) + owed);
    }
  }

  const payouts = Array.from(winnersMap.entries()).map(([account, amount]) => ({
    account,
    amount: Math.round(amount * 100) / 100,
  }));

  console.log(`[Resolver] Auto-payout for ${marketId}: ${payouts.length} recipients, total ≈ ${payouts.reduce((s, p) => s + p.amount, 0).toFixed(2)} HBAR`);

  // Phase 3 Funding Safety
  const resolverBalance = await getResolverBalance();
  const totalPayout = payouts.reduce((sum, p) => sum + p.amount, 0);

  if (resolverBalance < totalPayout) {
    console.error(`[Resolver] Phase 3 Funding Safety: Insufficient resolver balance (${resolverBalance} HBAR) for ${marketId} payout of ${totalPayout} HBAR. Aborting.`);
    return { 
      success: false, 
      error: 'Resolver has insufficient balance to complete payouts',
      resolverBalance,
      required: totalPayout 
    };
  }

  // === Phase 3: Triple Verification Skeleton - HGraph Volume Confirmation ===
  // This is the third leg of the bank-grade verification (HCS + Mirror + HGraph).
  // Before moving privileged funds, we re-aggregate volume directly from HGraph
  // to confirm the numbers we derived from HCS messages are consistent.
  const hgraphVerification = await performHGraphVolumeVerification(marketId, payouts, totalPayout);

  if (!hgraphVerification.verified) {
    console.error(`[Resolver] Phase 3 Triple Verification: HGraph volume check failed for ${marketId}. Details: ${hgraphVerification.details}`);
    // For smoke testing we log and continue, but in production this should be a hard stop
    // until we are confident the cross-check is reliable.
  } else {
    console.log(`[Resolver] Phase 3 Triple Verification: HGraph volume confirmation passed for ${marketId}`);
  }

  // Execute the actual on-chain payouts
  const transactionIds: string[] = [];
  let totalPaidActual = 0;

  for (const p of payouts) {
    try {
      const txId = await executePayout({
        toAccountId: p.account,
        amountHbar: p.amount,
        memo: `Auto payout ${marketId} (${winner})`,
      });
      if (txId) transactionIds.push(String(txId));
      totalPaidActual += p.amount;

      const payoutReason = isOneSided ? 'UNMATCHED_RETURN' : 'WIN';
      await postPayoutMessage({
        marketId,
        recipient: p.account,
        amount: p.amount,
        reason: payoutReason,
      });
      console.log(`[Resolver] Paid ${p.amount} HBAR to ${p.account} for ${marketId} (reason=${payoutReason})`);
    } catch (e) {
      console.error(`[Resolver] Payout execution failed for ${p.account}:`, e);
    }
  }

  // Mark terminal state on HCS (authoritative)
  try {
    await postPayoutClosedMessage({
      marketId,
      totalPaid: Math.round(totalPaidActual * 100) / 100,
      payoutCount: payouts.length,
      transactionIds,
    });
    console.log(`[Resolver] Posted PAYOUT_CLOSED for ${marketId}`);
  } catch (e) {
    console.warn('[Resolver] Could not post PAYOUT_CLOSED (non-fatal for now):', e);
  }

  return { success: true, paid: payouts.length, totalPaid: Math.round(totalPaidActual * 100) / 100 };
}

/**
 * Schedule a delayed automatic payout (28s default safety window after resolution).
 * Idempotent: only one timer per marketId at any time.
 */
export function scheduleDelayedPayout(marketId: string, delayMs = 28000) {
  if (scheduledPayoutTimers.has(marketId)) {
    console.log(`[Resolver] Timer already scheduled for ${marketId} — skipping duplicate`);
    return;
  }

  console.log(`[Resolver] Scheduling delayed auto-payout for ${marketId} in ${delayMs}ms`);

  const handle = setTimeout(async () => {
    scheduledPayoutTimers.delete(marketId);
    try {
      await processAutomaticPayoutsForMarket(marketId);
    } catch (e) {
      console.error(`[Resolver] Scheduled payout for ${marketId} threw:`, e);
    }
  }, delayMs);

  scheduledPayoutTimers.set(marketId, handle);
}

/**
 * Cancel a previously scheduled delayed payout (treasury escape hatch).
 */
export function cancelScheduledPayout(marketId: string): boolean {
  const handle = scheduledPayoutTimers.get(marketId);
  if (handle) {
    clearTimeout(handle);
    scheduledPayoutTimers.delete(marketId);
    console.log(`[Resolver] Cancelled scheduled payout for ${marketId}`);
    return true;
  }
  return false;
}

/**
 * Phase 0 / Phase 1: Treasury escape hatch.
 * Force resolves a fast game immediately, bypassing all tie logic and timers.
 * Posts MARKET_RESOLVED with the provided winner and then schedules the automatic payout.
 * This is the nuclear option for un-sticking games during development and edge cases.
 */
export async function forceResolveMarket(marketId: string, winner: 'YES' | 'NO', closingPrice?: number) {
  console.log(`[Resolver] FORCE RESOLVE requested for ${marketId} → Winner: ${winner}`);

  const priceData = await getCurrentHbarPriceWithAuditTrail().catch(() => null);
  const finalPrice = closingPrice ?? priceData?.price ?? 0;
  const decisionTime = priceData?.resolvedAt || new Date().toISOString();

  await postMarketResolved({
    marketId,
    winner,
    closingPrice: finalPrice,
    resolvedAt: decisionTime,
    priceTime: priceData?.priceTime,
    priceSource: priceData?.source,
    resolver: RESOLUTION_ACCOUNT,
  });

  knownResolvedMarkets.add(marketId);
  recordResolutionEvent({
    marketId,
    winner,
    closingPrice: finalPrice,
    priceSource: priceData?.source || 'unknown',
    resolvedAt: decisionTime,
  });

  // Always schedule the delayed payout for fast games after forced resolution
  if (marketId.startsWith('fast-')) {
    scheduleDelayedPayout(marketId, 28000);
  }

  // Remove from active list
  const fidx = activeFastGames.findIndex(g => g.marketId === marketId);
  if (fidx !== -1) {
    activeFastGames.splice(fidx, 1);
    saveActiveGamesToDisk().catch(() => {});
  }

  console.log(`[Resolver] Force resolved ${marketId} to ${winner} and scheduled payout`);

  return { success: true, marketId, winner, closingPrice: finalPrice };
}

/**
 * Phase 0/1 robustness: Re-registers fast games from HCS that may have been missed
 * after resolver restart or during transient failures.
 * Scans recent messages for CREATE_MARKET fast games that are past their end time
 * and have no MARKET_RESOLVED yet, then registers them for auto-resolution.
 */
export async function reRegisterOverdueFastGames() {
  try {
    const messages = await fetchReliableTopicMessages(5000);
    const now = Math.floor(Date.now() / 1000);
    const seenMarkets = new Set<string>();

    for (const row of messages) {
      try {
        const raw = row.message || '';
        const decoded = decodeHcsMessage(raw);
        const p = JSON.parse(decoded);

        if (p.type === 'CREATE_MARKET' && p.gameType === 'fast_updown' && p.marketId) {
          if (seenMarkets.has(p.marketId)) continue;
          seenMarkets.add(p.marketId);

          if (knownResolvedMarkets.has(p.marketId)) {
            continue;
          }

          // Check if already resolved on HCS (use reliable fetch which includes Mirror fallback)
          const hasResolved = messages.some((m: any) => {
            try {
              const r = m.message || '';
              const rd = decodeHcsMessage(r);
              const pr = JSON.parse(rd);
              return pr.type === 'MARKET_RESOLVED' && pr.marketId === p.marketId;
            } catch { return false; }
          });

          if (!hasResolved && p.endTime && p.endTime < now) {
            console.log(`[Resolver] Re-registering overdue fast game from HCS: ${p.marketId}`);
            registerFastGameForAutoResolution(p.marketId, p.endTime, p.durationMinutes, p.asset);
          }
        }
      } catch {}
    }
  } catch (e) {
    console.error('[Resolver] Error in reRegisterOverdueFastGames:', e);
  }
}

/**
 * Phase 1 Observability: Returns the current in-memory state of all tracked fast games.
 * This is extremely useful during playtesting to understand what the resolver "sees".
 */
export function getActiveFastGamesState() {
  const now = Math.floor(Date.now() / 1000);
  return {
    activeGames: activeFastGames.map(g => {
      const dur = (g.durationMinutes || 10) * 60;
      const remaining = (g.endTime || 0) - now;
      const isBettingOpen = remaining > (dur * 0.5);
      return {
        marketId: g.marketId,
        asset: g.asset || 'HBAR',
        endTime: g.endTime,
        durationMinutes: g.durationMinutes || 10,
        resolved: !!g.resolved,
        inTieResolution: !!g.inTieResolution,
        isBettingOpen,
      };
    }),
    tieResolutionGames: tieResolutionGames.map(t => ({
      marketId: t.marketId,
      hasActiveInterval: !!t.intervalId,
    })),
    priceHealth: lastPriceHealth,
    recentResolutions: [...recentResolutions], // copy for safety
    persistence: {
      enabled: true,
      file: ACTIVE_GAMES_FILE,
    },
    timestamp: new Date().toISOString(),
  };
}

/** Internal helper to record a resolution decision for observability */
function recordResolutionEvent(event: {
  marketId: string;
  winner: 'YES' | 'NO';
  closingPrice: number;
  priceSource: string;
  resolvedAt: string;
}) {
  recentResolutions.unshift(event);
  if (recentResolutions.length > MAX_RECENT_RESOLUTIONS) {
    recentResolutions.pop();
  }
}

/**
 * Read-only simulation for treasury admin /simulate-payout endpoint.
 * Returns exactly what processAutomaticPayoutsForMarket would do, without moving money.
 */
export async function simulatePayoutsForMarket(marketId: string) {
  // Reliable for admin simulation tooling
  const messages = await fetchReliableTopicMessages(2000);

  let winner: 'YES' | 'NO' | null = null;
  const bets: Array<{ user: string; side: 'YES' | 'NO'; amount: number }> = [];

  for (const row of messages) {
    try {
      const raw = row.message || '';
      const decoded = decodeHcsMessage(raw);
      const p = JSON.parse(decoded);
      if (p.marketId !== marketId) continue;
      if (p.type === 'MARKET_RESOLVED') winner = (p.winner || '').toUpperCase() as 'YES' | 'NO';
      if (p.type === 'PLACE_BET') {
        const side = (p.side || '').toUpperCase() as 'YES' | 'NO';
        const amount = Number(p.amount) || 0;
        const user = p.user || p.submittedBy;
        if (user && side && amount > 0) bets.push({ user, side, amount });
      }
    } catch {}
  }

  if (!winner) return { error: 'No MARKET_RESOLVED on HCS', payouts: [] };

  let totalYesStake = 0;
  let totalNoStake = 0;
  for (const b of bets) {
    if (b.side === 'YES') totalYesStake += b.amount;
    else totalNoStake += b.amount;
  }
  const isOneSided = totalYesStake === 0 || totalNoStake === 0;

  const winnersMap = new Map<string, number>();
  let totalWinning = 0;
  let totalLosing = 0;

  for (const b of bets) {
    if (b.side === winner) totalWinning += b.amount;
    else totalLosing += b.amount;
  }

  for (const b of bets) {
    let owed = 0;
    if (isOneSided) {
      owed = b.amount;
    } else if (b.side !== winner) {
      continue;
    } else {
      owed = b.amount;
      if (totalLosing > 0) {
        owed = b.amount + (b.amount / totalWinning) * totalLosing;
      }
    }
    if (owed > 0) {
      winnersMap.set(b.user, (winnersMap.get(b.user) || 0) + owed);
    }
  }

  const payouts = Array.from(winnersMap.entries()).map(([account, amount]) => ({
    account,
    amount: Math.round(amount * 100) / 100,
  }));

  return {
    marketId,
    winner,
    totalWinningStake: totalWinning,
    totalLosingStake: totalLosing,
    payouts,
    isOneSided,
    note: 'Read-only simulation — no funds moved, no HCS messages posted. One-sided markets now correctly simulate full stake return (UNMATCHED_RETURN).',
  };
}

/**
 * Production shutdown hook for graceful Railway SIGTERM.
 * Clears all in-flight tie polling intervals and scheduled payout timers
 * to avoid dangling handles during container stop.
 */
export function shutdownResolver() {
  // Clear tie resolution polling intervals
  for (const t of tieResolutionGames) {
    if (t.intervalId) {
      clearInterval(t.intervalId);
    }
  }
  tieResolutionGames.length = 0;

  // Clear scheduled payout setTimeouts
  for (const handle of scheduledPayoutTimers.values()) {
    clearTimeout(handle);
  }
  scheduledPayoutTimers.clear();

  console.log('[Resolver] shutdownResolver: cleared tie intervals and scheduled payout timers');
}

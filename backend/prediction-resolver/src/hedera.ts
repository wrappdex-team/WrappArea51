import { Client, AccountId, PrivateKey, TopicMessageSubmitTransaction, TransferTransaction, Hbar, ScheduleCreateTransaction, Timestamp, ExchangeRate } from '@hashgraph/sdk';
import dotenv from 'dotenv';

dotenv.config({ override: false });

const {
  RESOLUTION_ACCOUNT_ID,
  MASTER_TOPIC_ID,
  TREASURY_ACCOUNT_ID,
} = process.env;

if (!RESOLUTION_ACCOUNT_ID) {
  throw new Error('Missing RESOLUTION_ACCOUNT_ID in .env (or Railway env vars). This is the privileged resolution/escrow account ID.');
}
if (!MASTER_TOPIC_ID) {
  throw new Error('Missing MASTER_TOPIC_ID in environment. This must be provided via .env or Railway variables (e.g. 0.0.9017517).');
}

export const resolutionAccountId = AccountId.fromString(RESOLUTION_ACCOUNT_ID);
export const masterTopicId = MASTER_TOPIC_ID;
if (!TREASURY_ACCOUNT_ID) {
  throw new Error('Missing TREASURY_ACCOUNT_ID in environment. This must be provided via .env or Railway variables.');
}
export const treasuryAccountId = TREASURY_ACCOUNT_ID;

// Lazy private key loading. On Railway we do NOT set RESOLUTION_PRIVATE_KEY in env vars.
// Instead loadSecretsFromSupabase() (called early in index.ts listen) will populate process.env.RESOLUTION_PRIVATE_KEY
// from the Supabase kv_store before any payout or HCS post happens.
// This prevents top-level throw at import time.
let _resolutionPrivateKey: PrivateKey | null = null;
function getResolutionPrivateKey(): PrivateKey {
  if (!_resolutionPrivateKey) {
    const keyStr = process.env.RESOLUTION_PRIVATE_KEY;
    if (!keyStr) {
      throw new Error('Missing RESOLUTION_PRIVATE_KEY in environment. For Railway: ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (as secrets) so loadSecretsFromSupabase can fetch it from kv_store at startup.');
    }
    // Support both DER-encoded (starts with 302e...) and raw 64-char hex ED25519 keys
    _resolutionPrivateKey = keyStr.startsWith('302e')
      ? PrivateKey.fromString(keyStr)
      : PrivateKey.fromStringED25519(keyStr);
  }
  return _resolutionPrivateKey;
}

let client: Client | null = null;

export function getClient(): Client {
  if (!client) {
    client = Client.forTestnet();
    client.setOperator(resolutionAccountId, getResolutionPrivateKey());
  }
  return client;
}

// --- Price log gating (prevents 5s identical spam from 20s/60s loops + tie 5s polling + /price hits) ---
// The official Mirror rate (cent/hbar_equiv) changes infrequently; we still fetch on TTL in wrapper
// but only emit the noisy detailed calc + SDK warning at most once per minute or on actual change.
let lastSdkWarnTs = 0;
let lastMirrorLogPrice = 0;
let lastMirrorLogTs = 0;
const MIRROR_LOG_MIN_INTERVAL_MS = 60_000;

/**
 * Gets the official Hedera network exchange rate for HBAR.
 * This is the most authoritative "on-network" source for HBAR price.
 * The network publishes this rate as part of consensus.
 */
export async function getCurrentHbarExchangeRateFromNetwork(): Promise<{
  price: number;
  resolvedAt: string;
  source: string;
}> {
  const hederaClient = getClient();
  const resolvedAt = new Date().toISOString();

  // Layer 1: Preferred — Hedera SDK ExchangeRate (official network-published rate)
  // We use safe `any` casts because many published @hashgraph/sdk versions have incomplete types
  // for ExchangeRate.getCurrentRate even though the runtime method exists on the client.
  try {
    const exchangeRate = await (ExchangeRate as any).getCurrentRate?.(hederaClient);
    const rateString = exchangeRate?.currentRate?.hbarToUsd ?? exchangeRate?.current_rate?.hbar_equivalent;
    const price = parseFloat(String(rateString));

    if (!isNaN(price) && price > 0) {
      console.log(`[Resolver] ✅ Hedera SDK ExchangeRate (PRIMARY - official): $${price.toFixed(6)} | resolvedAt=${resolvedAt}`);
      return { price, resolvedAt, source: "Hedera SDK Exchange Rate (official network)" };
    }
    throw new Error("SDK returned invalid or unparsable rate");
  } catch (e1) {
    const now = Date.now();
    if (now - lastSdkWarnTs > MIRROR_LOG_MIN_INTERVAL_MS) {
      console.warn("[Resolver] ExchangeRate.getCurrentRate unavailable on this SDK build (expected on some versions):", (e1 as Error).message);
      lastSdkWarnTs = now;
    }
  }

  // Layer 2: Fallback cast (some SDK builds attach it directly on the Client)
  try {
    const exchangeRate = await (hederaClient as any).getExchangeRate?.();
    const rateString = exchangeRate?.currentRate?.hbarToUsd;
    const price = parseFloat(String(rateString));

    if (!isNaN(price) && price > 0) {
      console.log(`[Resolver] ✅ Hedera Network Exchange Rate (client cast): $${price.toFixed(6)} | resolvedAt=${resolvedAt}`);
      return { price, resolvedAt, source: "Hedera Network Exchange Rate (official)" };
    }
  } catch (e2) {
    console.warn("[Resolver] Client.getExchangeRate() cast failed");
  }

  // Layer 3: Strong Hedera-native fallback — Mirror Node exchange rate (official network rate)
  // This is the most reliable "on-chain" source for HBAR/USD used by Hedera itself for fees.
  try {
    // Using Hedera's official dedicated testnet mirror node for better reliability
    const mirrorBase = process.env.HEDERA_MIRROR_NODE;
    if (!mirrorBase) {
      throw new Error('Missing HEDERA_MIRROR_NODE in environment for price source.');
    }
    const mirrorUrl = `${mirrorBase}/api/v1/network/exchangerate`;
    const res = await fetch(mirrorUrl);
    if (!res.ok) throw new Error(`Mirror Node HTTP ${res.status}`);

    const data: any = await res.json();
    const current = data.current_rate || data.next_rate || data;

    // Official Hedera formula (confirmed via Mirror Node docs + production behavior):
    // cent_equivalent = USD cents
    // hbar_equivalent = scaling factor (commonly 30000)
    // price = cent_equivalent / (hbar_equivalent * 100)
    const cent = current.cent_equivalent ?? current.usd_equivalent ?? current.centEquivalent;
    const hbar = current.hbar_equivalent ?? current.hbarEquivalent ?? 30000;

    if (!cent || !hbar) {
      console.error("[Resolver] Mirror Node unexpected shape:", current);
      throw new Error("Mirror Node response missing cent/hbar equivalents");
    }

    const rawPrice = cent / (hbar * 100);
    const price = parseFloat(rawPrice.toFixed(8));

    // Sanity check — HBAR should be in a realistic range
    if (isNaN(price) || price < 0.01 || price > 2.0) {
      console.error("[Resolver] Mirror Node produced out-of-range price:", price, "raw:", current);
      throw new Error(`Mirror Node produced invalid price: ${price}`);
    }

    // Gate the detailed calc log: ONLY on actual price change or the very first fetch after startup.
    // Periodic health pings (heartbeat, auto-resolve) will no longer spam the long "calculation" line
    // when the official network rate is stable (which it is for long periods).
    // The fetch still happens (via cache TTL) so /api/price/hbar and decisions get accurate recent values.
    const priceChanged = Math.abs(price - lastMirrorLogPrice) > 1e-8;
    if (priceChanged || lastMirrorLogPrice === 0) {
      console.log(
        `[Resolver] ✅ Mirror Node Exchange Rate (PRIMARY - official Hedera network rate): $${price} | ` +
        `calculation: ${cent} cent_equiv / (${hbar} hbar_equiv * 100) | resolvedAt=${resolvedAt}`
      );
      lastMirrorLogPrice = price;
      lastMirrorLogTs = Date.now();
    }

    return {
      price,
      resolvedAt,
      source: "Hedera Mirror Node Exchange Rate (official network)",
    };
  } catch (e3) {
    console.error("[Resolver] Mirror Node exchange rate failed:", (e3 as Error).message);
  }

  // Layer 4: Last-resort public API (CoinGecko). Logged loudly as NON-authoritative.
  // Only used so the system doesn't hard-crash during development.
  // Real production resolution should never silently accept this for payouts.
  try {
    const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd');
    if (!cgRes.ok) throw new Error(`CoinGecko ${cgRes.status}`);

    const cgJson: any = await cgRes.json();
    const price = parseFloat(cgJson['hedera-hashgraph']?.usd);

    if (!isNaN(price) && price > 0) {
      console.warn(
        `[Resolver] ⚠️ FALLBACK CoinGecko price used: $${price} | ` +
        `This is NOT the Hedera network rate. Only acceptable for UI display during resolver dev.`
      );
      return {
        price,
        resolvedAt,
        source: "CoinGecko (last-resort public API — not Hedera network)",
      };
    }
  } catch (e4) {
    console.error("[Resolver] CoinGecko last resort also failed");
  }

  throw new Error("All HBAR price sources exhausted (SDK, Mirror, CoinGecko)");
}

export async function submitHcsMessage(message: object) {
  const client = getClient();
  const tx = new TopicMessageSubmitTransaction()
    .setTopicId(masterTopicId)
    .setMessage(JSON.stringify(message));

  const receipt = await tx.execute(client);
  const record = await receipt.getRecord(client);

  console.log(`[Resolver] HCS message submitted. TxId: ${record.transactionId}`);
  return record.transactionId.toString();
}

// Example: post a CREATE_MARKET message from the backend using the resolution key
export async function postCreateMarket(params: {
  marketId: string;
  question: string;
  asset: string;
  endTime: number;
  gameType: string;
  durationMinutes?: number;
  initialSide?: 'YES' | 'NO';
  initialStake?: number;
  creationPrice?: number;
  creationPriceTime?: string;
  submittedBy: string;
}) {
  // Phase 0: Detailed clean text memo for market creation (cryptographic proof + human audit)
  // Essentials only: market id, direction, stake, duration, price
  const sideText = params.initialSide ? (params.initialSide === 'YES' ? 'YES (up)' : 'NO (down)') : 'direction not specified';
  const stakeText = params.initialStake ? `${params.initialStake} HBAR initial stake on ${sideText}` : '';
  const durationText = params.durationMinutes ? `${params.durationMinutes} minute duration` : '';
  const priceText = params.creationPrice ? `Creation price ${params.creationPrice}` : '';

  const memo = `Create ${params.marketId}: ${params.question}. ${stakeText}. ${durationText}. ${priceText}. Created by ${params.submittedBy}. All activity recorded on HCS topic for full audit trail and user proof.`;

  const message: any = {
    type: 'CREATE_MARKET',
    ...params,
    createdAt: new Date().toISOString(),
    feeBps: 250,
    treasury: treasuryAccountId,
    submittedBy: params.submittedBy,
    gameType: 'fast_updown',   // Phase 0: Consistent organization across the entire topic for reliable queries
    memo,   // Phase 0: Clean detailed memo (plain text only, no special characters)
  };

  if (params.creationPriceTime) {
    message.creationPriceTime = params.creationPriceTime;
  }

  return submitHcsMessage(message);
}

// Single source of truth for platform fee on every bet
export const PLATFORM_FEE_BPS = 100; // 1% — charged on every single PLACE_BET with zero exceptions

export async function postPlaceBet(params: {
  marketId: string;
  side: 'YES' | 'NO';
  amount: number;
  user: string;
  platformFeeCollected?: number; // actual on-chain 1% tax that left the bettor's wallet
}) {
  // === Step 1: World-Class Audit Memo + Sequencing (Hashgraph Architect Standard) ===
  // Every PLACE_BET (technical type) must produce a human-readable memo using "predict" language
  // for forward-facing auditability and legal clarity on HashScan and all explorers.
  // We compute the prediction sequence for this specific market using reliable HCS scan.
  // This gives us "Prediction #1 (Initial)", "Prediction #2", etc.

  // Dynamically import the reliable scanner (already battle-tested in resolver)
  const { fetchReliableTopicMessages, decodeHcsMessage } = await import('./resolver');

  let betSequence = 1;
  try {
    const messages = await fetchReliableTopicMessages(2000);
    let count = 0;
    for (const row of messages) {
      try {
        const raw = row.message || '';
        const decoded = decodeHcsMessage(raw);
        const p = JSON.parse(decoded);
        if (p.type === 'PLACE_BET' && p.marketId === params.marketId) {
          count++;
        }
      } catch {}
    }
    betSequence = count + 1;
  } catch (e) {
    console.warn('[Resolver] Could not compute betSequence, defaulting to 1. Memo will still be excellent.');
  }

  const sideText = params.side === 'YES' ? 'YES (up)' : 'NO (down)';
  const feeText = (typeof params.platformFeeCollected === 'number' && params.platformFeeCollected > 0)
    ? `${params.platformFeeCollected} HBAR 1% platform fee collected.`
    : '1% platform fee declared.';

  const isInitial = betSequence === 1;
  const sequenceLabel = isInitial
    ? 'Initial Market Maker Prediction #1'
    : `Prediction #${betSequence} for this game`;

  // The perfect human + machine memo (uses "predict" language for all forward-facing / legal / HashScan visibility).
  const memo =
    `PREDICTION | Master Topic: ${masterTopicId} | Market: ${params.marketId} | ` +
    `Side: ${sideText} | Amount: ${params.amount} HBAR | ${sequenceLabel} | ` +
    `User: ${params.user} | ${feeText} ` +
    `Recorded on HCS for cryptographic audit and user proof.`;

  const message: any = {
    type: 'PLACE_BET',
    marketId: params.marketId,
    side: params.side,
    amount: params.amount,
    user: params.user,
    timestamp: new Date().toISOString(),
    feeBps: PLATFORM_FEE_BPS,
    treasury: treasuryAccountId,
    submittedBy: params.user,
    gameType: 'fast_updown',
    betSequence,                    // Machine-readable sequence number (internal)
    masterTopicId: masterTopicId,   // Explicit reference for easy filtering across all tools
    memo,                           // The gold-standard human-readable receipt (uses "predict" language for all forward-facing / legal visibility)
  };

  if (typeof params.platformFeeCollected === 'number' && params.platformFeeCollected > 0) {
    message.platformFeeCollected = params.platformFeeCollected;
  }

  console.log(
    `[Resolver] PREDICTION recorded (Hashgraph-grade): market=${params.marketId} | ` +
    `predictionSequence=#${betSequence} | side=${params.side} | amount=${params.amount} HBAR | ` +
    `fee=${params.platformFeeCollected ?? 0} HBAR → Treasury`
  );

  return submitHcsMessage(message);
}

export async function postMarketResolved(params: {
  marketId: string;
  winner: 'YES' | 'NO';
  closingPrice: number;
  resolver: string;
  resolvedAt?: string;
  priceTime?: string;
  priceSource?: string;
}) {
  const decisionTime = params.resolvedAt || new Date().toISOString();

  // Phase 0 (Dr. Leemon Baird - Hashgraph prediction markets): Every resolution must be fully provable.
  // Clean plain-text memo with the exact decision, prices, and source.
  const memo = `MARKET_RESOLVED ${params.marketId}: Winner ${params.winner}. Closing price ${params.closingPrice}. Decision time ${decisionTime}. Source: ${params.priceSource || 'Hedera network'}. Resolver ${params.resolver}. Authoritative outcome for the fast game on Hedera.`;

  const message: any = {
    type: 'MARKET_RESOLVED',
    marketId: params.marketId,
    winner: params.winner,
    closingPrice: params.closingPrice,
    resolvedAt: decisionTime,
    gameType: 'fast_updown',
    resolver: params.resolver,
    memo,   // Detailed plain text proof of the exact price decision and outcome
  };

  // Optional but recommended audit fields
  if (params.priceTime) message.priceTime = params.priceTime;
  if (params.priceSource) message.priceSource = params.priceSource;

  console.log(`[Resolver] Posting MARKET_RESOLVED with decisionTime=${decisionTime}`);

  return submitHcsMessage(message);
}

/**
 * Direct payout execution using the privileged resolver key.
 * This is the production-grade path for automated claims.
 */
export async function executePayout(params: {
  toAccountId: string;
  amountHbar: number;
  memo?: string;
}) {
  const client = getClient();

  const tx = new TransferTransaction()
    .addHbarTransfer(resolutionAccountId, new Hbar(-params.amountHbar))
    .addHbarTransfer(params.toAccountId, new Hbar(params.amountHbar))
    .setTransactionMemo(params.memo || 'Fast Game Payout');

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);

  console.log(`[Resolver] Executed direct payout of ${params.amountHbar} HBAR to ${params.toAccountId}. Status: ${receipt.status}`);
  return response.transactionId.toString();
}

/**
 * Posts a clean PAYOUT audit message on HCS.
 * This is critical for on-chain tracking, oracle scoring, and gamification.
 */
export async function postPayoutMessage(params: {
  marketId: string;
  recipient: string;
  amount: number;
  reason: 'WIN' | 'UNMATCHED_RETURN';
  relatedBets?: number; // optional metadata
}) {
  const message = {
    type: 'PAYOUT',
    marketId: params.marketId,
    recipient: params.recipient,
    amount: params.amount,
    reason: params.reason,
    timestamp: new Date().toISOString(),
    relatedBets: params.relatedBets || 0,
  };

  return submitHcsMessage(message);
}

/**
 * Posts a terminal PAYOUT_CLOSED message on HCS.
 * This is the authoritative signal that a market's payouts are fully complete.
 * The safety-net and future systems should treat any market with this message as done.
 */
export async function postPayoutClosedMessage(params: {
  marketId: string;
  totalPaid: number;
  payoutCount: number;
  transactionIds: string[];
  verification?: {
    hcs: boolean;
    mirror: boolean;
    hgraph: boolean;
  };
}) {
  // Phase 0: Full audit trail - every terminal state must be provable
  const memo = `PAYOUT_CLOSED ${params.marketId}: ${params.payoutCount} payouts totaling ${params.totalPaid} HBAR. Transactions: ${params.transactionIds.join(', ')}. All stakes settled on Hedera Hashgraph.`;

  const message: any = {
    type: 'PAYOUT_CLOSED',
    marketId: params.marketId,
    totalPaid: params.totalPaid,
    payoutCount: params.payoutCount,
    transactionIds: params.transactionIds,
    timestamp: new Date().toISOString(),
    verification: params.verification || { hcs: true, mirror: false, hgraph: false },
    memo,   // Clean detailed closing memo for complete cryptographic proof of the game outcome
  };

  return submitHcsMessage(message);
}

/**
 * Privileged retirement of dead / unresolvable fast games.
 * This is the secure, auditable way to stop the active list from growing forever
 * with old test corpses that will never resolve.
 * Only the resolver key can post these. The record lives forever on the master topic.
 */
export async function postFastGameRetired(params: {
  marketId: string;
  reason: string;           // e.g. "TEST_CORPSE", "EXPIRED_NO_RESOLUTION", "NO_BETS", "LEGACY_0H"
  retiredBy: string;        // the resolution / treasury account
  note?: string;
}) {
  const message = {
    type: 'FAST_GAME_RETIRED',
    marketId: params.marketId,
    reason: params.reason,
    retiredBy: params.retiredBy,
    retiredAt: new Date().toISOString(),
    note: params.note || '',
    gameType: 'fast_updown',
  };

  return submitHcsMessage(message);
}

/**
 * Canonical professional retirement message for ANY market type (fast or standard).
 * This is the Hashgraph best-practice terminal state.
 * Posted only by the privileged resolution key.
 * Once a MARKET_RETIRED appears after a CREATE_MARKET for the same marketId,
 * all well-behaved clients and the resolver's active view must treat the market as non-active.
 */
export async function postMarketRetired(params: {
  marketId: string;
  reason: string;
  retiredBy: string;
  note?: string;
}) {
  const message = {
    type: 'MARKET_RETIRED',
    marketId: params.marketId,
    reason: params.reason,
    retiredBy: params.retiredBy,
    retiredAt: new Date().toISOString(),
    note: params.note || 'Professional admin cleanup - no user funds affected',
  };

  return submitHcsMessage(message);
}

/**
 * Legacy scheduled payout (kept for very large or delayed distributions).
 * Prefer executePayout for normal fast game claims.
 */
export async function schedulePayout(params: {
  toAccountId: string;
  amountHbar: number;
  memo?: string;
}) {
  const client = getClient();

  const transferTx = new TransferTransaction()
    .addHbarTransfer(resolutionAccountId, new Hbar(-params.amountHbar))
    .addHbarTransfer(params.toAccountId, new Hbar(params.amountHbar))
    .setTransactionMemo(params.memo || 'Fast Game Payout');

  const scheduleTx = new ScheduleCreateTransaction()
    .setScheduledTransaction(transferTx)
    .setScheduleMemo(`Payout for ${params.toAccountId}`)
    .setExpirationTime(new Timestamp(Math.floor(Date.now() / 1000) + 3600, 0));

  const txResponse = await scheduleTx.execute(client);
  const receipt = await txResponse.getReceipt(client);

  console.log(`[Resolver] Scheduled payout created. ScheduleId: ${receipt.scheduleId}`);
  return receipt.scheduleId?.toString();
}

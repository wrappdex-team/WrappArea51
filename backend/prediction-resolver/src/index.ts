import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

dotenv.config({ override: false });

// Early diagnostics (visible in Railway runtime logs immediately on `node dist/index.js`)
console.log('[Resolver] === STARTUP DIAGNOSTICS ===');
console.log(`[Resolver] Node ${process.version} | platform=${process.platform} | Railway PORT raw="${process.env.PORT}" | cwd=${process.cwd()}`);

// Global safety nets: log anything that could crash the process after the "running" message (visible in Railway logs).
// Node by default may terminate on uncaught/unhandled; these ensure we see the root cause instead of silent death + restart loop.
process.on('uncaughtException', (err) => {
  console.error('[Resolver] !!! UNCAUGHT EXCEPTION (this often explains "starts logging running but health never responds" or sudden death):', err);
});
process.on('unhandledRejection', (reason, _promise) => {
  console.error('[Resolver] !!! UNHANDLED PROMISE REJECTION (check for missing .catch on async in loops or recovery):', reason);
});

// Local modules imported AFTER dotenv so .env (and future early supabase loads) are populated for any top-level checks in hedera/resolver
import { 
  pollMirrorNodeForTransfers, 
  resolveAndPayout, 
  autoResolveExpiredFastGames,
  registerFastGameForAutoResolution,
  registerLongGameForAutoResolution,
  processClaim,
  retireDeadFastGames,
  computePayoutForUser,
  shutdownResolver,
  getActiveLongGamesState
} from './resolver';
import { postCreateMarket, postPlaceBet } from './hedera';

const app = express();

// CORS: configurable for dev (localhost:5173) + production (wrappdex.io on Vercel) + any previews.
// Set ALLOWED_ORIGINS=https://wrappdex.io,http://localhost:5173 in Railway / Vercel env when ready.
// Comma-separated, trimmed. *.vercel.app previews are auto-allowed for convenience during smoke testing.
const rawOrigins = process.env.ALLOWED_ORIGINS || 'http://localhost:5173,https://wrappdex.io';
const allowedOrigins = rawOrigins.split(',').map(o => o.trim().toLowerCase());

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser / same-origin / server-to-server
  const o = origin.toLowerCase();
  if (allowedOrigins.some(a => a === o)) return true;
  if (allowedOrigins.some(a => a.includes('*') && new RegExp('^' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$').test(o))) return true;
  if (o.endsWith('.vercel.app') || o.includes('localhost') || o.includes('127.0.0.1') || o.includes('wrapparea51')) return true;
  return false;
}

app.use(cors({
  origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
  credentials: true
}));

app.use(express.json());

const rawPort = process.env.PORT;
console.log(`[Resolver] Raw PORT from env: "${rawPort}" (typeof=${typeof rawPort})`);
let PORT = parseInt(rawPort || '4000', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.warn(`[Resolver] Computed PORT=${PORT} invalid, falling back to 4000`);
  PORT = 4000;
}
console.log(`[Resolver] Final computed PORT=${PORT} (this is what we will bind to; must match Railway service Networking port + $PORT for proxy to reach us)`);
if (!process.env.PORT) {
  console.log(`[Resolver] (Local dev note) No PORT env — using fallback ${PORT}. If you get EADDRINUSE on Windows, try: PORT=4001 npm run dev  (or kill the process using port ${PORT})`);
}

// Payout delay for Fast Games (configurable for different environments)
const PAYOUT_DELAY_MS = Number(process.env.PAYOUT_DELAY_MS) || 28000;

// Store interval IDs for graceful shutdown
let mirrorInterval, autoResolveInterval, heartbeatInterval;

// Secure secret loading from Supabase kv_store (for secret coverage in Supabase)
async function loadSecretsFromSupabase() {
  let supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Trim and basic normalization to avoid "Invalid path specified" PostgREST errors
  supabaseUrl = supabaseUrl.trim().replace(/\/$/, ''); // remove trailing slash

  if (supabaseServiceKey && supabaseUrl) {
    // Log redacted host for debugging (helps catch wrong URL like Edge Function URL instead of project URL)
    try {
      const host = new URL(supabaseUrl).host;
      console.log(`[Resolver] Attempting Supabase kv load using host: ${host}`);
    } catch {}

    if (process.env.RESOLUTION_PRIVATE_KEY) {
      console.log('[Resolver] RESOLUTION_PRIVATE_KEY already present from local .env (or Railway) — skipping Supabase kv_store fetch for it (local override takes precedence for dev).');
    } else {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data, error } = await supabase
          .from('kv_store_54299934')
          .select('value')
          .eq('key', 'resolution_private_key')
          .single();
        if (!error && data && data.value) {
          process.env.RESOLUTION_PRIVATE_KEY = data.value;
          const v = String(data.value);
          console.log(`[Resolver] Loaded resolution private key from Supabase kv_store (redacted: ${v.substring(0, 4)}...${v.slice(-4)}, len=${v.length})`);
        } else {
          const errInfo = error ? `error=${error.message} code=${error.code || 'n/a'}` : 'no matching row or empty value';
          console.warn(`[Resolver] Could not load resolution private key from Supabase kv_store (${errInfo}), falling back to env`);
        }
      } catch (e) {
        console.warn('[Resolver] Error loading secrets from Supabase:', (e as Error).message);
      }
    }
  } else {
    console.log('[Resolver] No SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env — not attempting kv_store load.');
  }
  const pkNow = process.env.RESOLUTION_PRIVATE_KEY;
  console.log(`[Resolver] PK ready for HCS posts (create/bet/resolve/payout): ${pkNow ? 'YES (len=' + pkNow.length + ')' : 'NO — HCS writes will fail until provided via .env or Supabase load'}`);

  // === Surgical addition for HBAR price (SaucerSwap last-traded primary) ===
  // This key is already stored in the same kv_store_54299934 and used by other live MVP parts
  // (Supabase Edge Functions for swaps/pools). We load it additively only, never touching the PK path.
  // Local .env takes precedence. If missing we gracefully fall back to current Mirror behavior.
  if (!process.env.SAUCERSWAP_API_KEY && supabaseServiceKey && supabaseUrl) {
    try {
      const supabaseSaucer = createClient(supabaseUrl, supabaseServiceKey);
      const saucerKeyRow = await supabaseSaucer
        .from('kv_store_54299934')
        .select('value')
        .eq('key', 'saucerswap_api_key')
        .single();
      if (!saucerKeyRow.error && saucerKeyRow.data && saucerKeyRow.data.value) {
        process.env.SAUCERSWAP_API_KEY = saucerKeyRow.data.value;
        const v = String(saucerKeyRow.data.value);
        console.log(`[Resolver] Loaded SaucerSwap API key from Supabase kv_store (redacted: ${v.substring(0, 4)}...${v.slice(-4)}, len=${v.length}) — for verified last-traded HBAR price`);
      } else {
        console.log('[Resolver] No saucerswap_api_key row in kv_store (or error) — SaucerSwap price path will be unavailable, falling back to Mirror for all games.');
      }
    } catch (e) {
      console.warn('[Resolver] Error loading SaucerSwap key from Supabase (non-fatal):', (e as Error).message);
    }
  } else if (process.env.SAUCERSWAP_API_KEY) {
    console.log('[Resolver] SAUCERSWAP_API_KEY already present (local .env or prior load) — using for verified HBAR last-traded price.');
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Authoritative HBAR price endpoint (HGraph as source of truth).
 * Used by both the frontend (when creating markets) and the resolver (when resolving markets).
 */
app.get('/api/price/hbar', async (req, res) => {
  // Bank-grade price endpoint with explicit provenance and resilience
  try {
    const { getCurrentHbarPriceWithAuditTrail } = await import('./resolver');
    const priceData = await getCurrentHbarPriceWithAuditTrail();

    res.json({
      symbol: 'HBAR',
      price: Number(priceData.price.toFixed(8)),
      priceTime: priceData.priceTime,
      resolvedAt: priceData.resolvedAt,
      source: priceData.source,
      isStale: priceData.isStale,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.warn('[Resolver] Hedera-native price sources failed — emergency CoinGecko fallback (marked stale)');

    // One retry with small delay for transient network issues
    try {
      await new Promise(r => setTimeout(r, 400));
      const cg = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd', { timeout: 5000 } as any);
      const j: any = await cg.json();
      const price = j['hedera-hashgraph']?.usd;
      if (price) {
        const now = new Date().toISOString();
        return res.json({
          symbol: 'HBAR',
          price: Number(parseFloat(price).toFixed(8)),
          priceTime: now,
          resolvedAt: now,
          source: 'CoinGecko (emergency public fallback — NOT Hedera network)',
          isStale: true,
          timestamp: now,
          warning: 'Hedera SDK + Mirror Node unavailable. UI display only. Real resolutions must wait for native price recovery.',
        });
      }
    } catch (cgErr) {
      console.error('[Resolver] Emergency CoinGecko also failed after retry');
    }

    res.status(503).json({
      error: 'Failed to fetch HBAR price from Hedera network sources',
      details: err.message || 'Unknown error',
      hint: 'Check resolver connectivity to Hedera SDK / Mirror Node.',
    });
  }
});

/**
 * General asset price endpoint (for XRP + other non-HBAR prediction assets).
 * Uses CoinGecko primary + Binance (BNB oracle) backup exactly as specified for XRP.
 * HBAR still uses the dedicated /api/price/hbar (rich Saucer/Mirror provenance).
 * FE cards continue to use the coingecko batch proxy for the grid; this is useful for
 * modal "current price for this game" consistency on non-HBAR fast games.
 */
app.get('/api/price/:symbol', async (req, res) => {
  try {
    const symbol = (req.params.symbol || 'HBAR').toUpperCase();
    const { getAssetPrice } = await import('./resolver');
    const priceData = await getAssetPrice(symbol);

    res.json({
      symbol,
      price: Number(priceData.price.toFixed(symbol === 'XRP' ? 4 : 2)),
      priceTime: priceData.priceTime,
      resolvedAt: priceData.resolvedAt,
      source: priceData.source,
      isStale: priceData.isStale,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.warn(`[Resolver] /api/price/${req.params.symbol} failed:`, err?.message);
    res.status(503).json({
      error: `Failed to fetch price for ${req.params.symbol}`,
      details: err.message || 'Unknown error',
    });
  }
});

/**
 * Frontend calls this after the user has paid the creation fee + initial stake via HBAR transfer.
 * Backend verifies the transfer (in production) and posts the clean HCS messages using the resolution key.
 */
app.post('/api/prediction/fast-game/create', async (req, res) => {
  console.log('[Resolver] Received create request from frontend:', req.body);

  try {
    const {
      marketId,
      question,
      asset = 'HBAR',
      endTime,
      durationMinutes,
      initialSide,
      initialStake,
      creationPrice: clientCreationPrice,
      creationPriceTime: clientCreationPriceTime,
      submittedBy,
    } = req.body;

    if (!marketId || !question || !endTime || !submittedBy) {
      console.warn('[Resolver] Missing required fields in request');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Phase 1 stability: Server-side 50% betting close enforcement.
    // Compute from endTime + durationMinutes to prevent refresh races allowing bets after cutoff.
    const now = Math.floor(Date.now() / 1000);
    const durationSec = (durationMinutes || 10) * 60;
    const remaining = endTime - now;
    const isBettingOpen = remaining > (durationSec * 0.5);
    if (!isBettingOpen) {
      console.warn(`[Resolver] Create rejected for ${marketId}: betting window closed (remaining=${remaining}s)`);
      return res.status(400).json({ error: 'Betting window has closed for this game' });
    }

    // Resolver-authoritative fresh price at the moment the funded create record arrives.
    // Now asset-aware:
    // - HBAR: rich SaucerSwap (if key) + Mirror + public fallbacks (unchanged behavior)
    // - XRP / BTC / ETH / SOL: CoinGecko primary + Binance public (BNB oracle) backup per master plan.
    // Always { critical: true } for the exact post-payment snap (no cache). Full provenance goes to HCS.
    const { getAssetPrice } = await import('./resolver');
    const priceData = await getAssetPrice(asset, { critical: true }).catch(() => null);
    const creationPrice = priceData?.price ?? clientCreationPrice ?? 0;
    const creationPriceTime = priceData?.priceTime ?? priceData?.resolvedAt ?? clientCreationPriceTime ?? new Date().toISOString();

    // Phase: HCS CREATE_MARKET (with full provenance for audit/fairness)
    let createTxId: string | undefined;
    try {
      createTxId = await postCreateMarket({
        marketId,
        question,
        asset,
        endTime,
        gameType: 'fast_updown',
        durationMinutes,
        initialSide,
        initialStake,
        creationPrice,
        creationPriceTime,
        submittedBy,
      });
      console.log(`[Resolver] Successfully posted CREATE_MARKET for ${marketId} tx=${createTxId}`);
    } catch (hcsCreateErr: any) {
      console.error(`[Resolver] HCS CREATE_MARKET failed for ${marketId}:`, hcsCreateErr);
      throw new Error(`hcs_create_failed: ${hcsCreateErr.message || hcsCreateErr}`);
    }

    // Phase: initial PLACE_BET for creator stake (so MM is in the parimutuel pools)
    let betTxId: string | undefined;
    try {
      betTxId = await postPlaceBet({
        marketId,
        side: initialSide,
        amount: initialStake,
        user: submittedBy,
      });
      console.log(`[Resolver] Posted Initial Market Maker Bet #1 (creator stake) for ${marketId} tx=${betTxId}`);
    } catch (hcsBetErr: any) {
      console.error(`[Resolver] HCS initial PLACE_BET failed for ${marketId}:`, hcsBetErr);
      // We already posted CREATE; don't leave orphan. But for now surface the stage.
      throw new Error(`hcs_initial_bet_failed: ${hcsBetErr.message || hcsBetErr} (CREATE tx may exist: ${createTxId})`);
    }

    // Register for automatic resolution when time expires.
    // Creation price will be read from the immutable HCS topic at resolution time.
    // Pass durationMinutes so the active list (and client isBettingOpen calc) has the correct 50% cutoff for all durations (10/20/60/240).
    registerFastGameForAutoResolution(marketId, endTime, durationMinutes, asset);

    res.json({ success: true, marketId, createTxId, betTxId });
  } catch (err: any) {
    console.error('[Resolver] Create market error:', err);
    // Return stage so frontend can show precise "record failed at X" for recovery/support.
    res.status(500).json({ error: err.message || 'Internal error', stage: err.message?.startsWith('hcs_') ? err.message.split(':')[0] : 'unknown' });
  }
});

/**
 * Long Game (Predictions) create — identical flow and safety as fast-game/create.
 * Durations are expressed in days by the caller (1/2/3/5/7/14/21/30/60/90) and converted to durationMinutes = days * 1440 upstream.
 * All stakes remain in HBAR. 50% "Predictions closing" window enforcement (buyouts + new bets only before half).
 * Uses the generic asset price oracle (HBAR rich path preserved; others CG+Binance).
 */
app.post('/api/prediction/long-game/create', async (req, res) => {
  console.log('[Resolver] Received LONG game create request from frontend:', req.body);

  try {
    const {
      marketId,
      question,
      asset = 'HBAR',
      endTime,
      durationMinutes,
      initialSide,
      initialStake,
      creationPrice: clientCreationPrice,
      creationPriceTime: clientCreationPriceTime,
      submittedBy,
    } = req.body;

    if (!marketId || !question || !endTime || !submittedBy) {
      console.warn('[Resolver] Missing required fields in long-game create');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Server-side 50% betting/buyout close enforcement (works for day-scale durations too).
    const now = Math.floor(Date.now() / 1000);
    const durationSec = (durationMinutes || (1 * 1440)) * 60;
    const remaining = endTime - now;
    const isBettingOpen = remaining > (durationSec * 0.5);
    if (!isBettingOpen) {
      console.warn(`[Resolver] Long create rejected for ${marketId}: betting/buyout window closed`);
      return res.status(400).json({ error: 'Betting window has closed for this prediction' });
    }

    const { getAssetPrice } = await import('./resolver');
    const priceData = await getAssetPrice(asset, { critical: true }).catch(() => null);
    const creationPrice = priceData?.price ?? clientCreationPrice ?? 0;
    const creationPriceTime = priceData?.priceTime ?? priceData?.resolvedAt ?? clientCreationPriceTime ?? new Date().toISOString();

    let createTxId: string | undefined;
    try {
      createTxId = await postCreateMarket({
        marketId,
        question,
        asset,
        endTime,
        gameType: 'long_updown',
        durationMinutes,
        initialSide,
        initialStake,
        creationPrice,
        creationPriceTime,
        submittedBy,
      });
      console.log(`[Resolver] Successfully posted CREATE_MARKET (long) for ${marketId} tx=${createTxId}`);
    } catch (hcsCreateErr: any) {
      console.error(`[Resolver] HCS CREATE_MARKET (long) failed for ${marketId}:`, hcsCreateErr);
      throw new Error(`hcs_create_failed: ${hcsCreateErr.message || hcsCreateErr}`);
    }

    let betTxId: string | undefined;
    try {
      betTxId = await postPlaceBet({
        marketId,
        side: initialSide,
        amount: initialStake,
        user: submittedBy,
        // gameType passed via the any-cast inside postPlaceBet for long_updown
      } as any);
      console.log(`[Resolver] Posted Initial Market Maker Bet #1 (long) for ${marketId} tx=${betTxId}`);
    } catch (hcsBetErr: any) {
      console.error(`[Resolver] HCS initial PLACE_BET (long) failed for ${marketId}:`, hcsBetErr);
      throw new Error(`hcs_initial_bet_failed: ${hcsBetErr.message || hcsBetErr} (CREATE tx may exist: ${createTxId})`);
    }

    registerLongGameForAutoResolution(marketId, endTime, durationMinutes, asset);

    res.json({ success: true, marketId, createTxId, betTxId });
  } catch (err: any) {
    console.error('[Resolver] Long game create error:', err);
    res.status(500).json({ error: err.message || 'Internal error', stage: err.message?.startsWith('hcs_') ? err.message.split(':')[0] : 'unknown' });
  }
});

/**
 * Endpoint for placing a bet on an existing market (after user has sent stake).
 */
app.post('/api/prediction/bet', async (req, res) => {
  // IMPORTANT: Destructure at the top level so these variables are available in both try and catch
  const { marketId, side, amount, user, platformFeeCollected, paymentTxId } = req.body;

  try {
    if (!marketId || !side || !amount || !user) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Phase 1 stability: Server-side 50% close enforcement (fast + long/prediction games; prevents refresh races).
    // Look up the CREATE to get endTime + duration and reject if betting/buyout window closed.
    try {
      const { fetchFastGameCreationData } = await import('./resolver');
      const creation = await fetchFastGameCreationData(marketId).catch(() => null);
      if (creation && creation.endTime) {
        const now = Math.floor(Date.now() / 1000);
        const dur = (creation.durationMinutes || 10) * 60;
        const remaining = creation.endTime - now;
        if (remaining <= (dur * 0.5)) {
          console.warn(`[Resolver] Bet rejected for ${marketId}: betting window closed`);
          return res.status(400).json({ error: 'Betting window has closed for this game' });
        }
      }
    } catch {}

    const fee = typeof platformFeeCollected === 'number' ? platformFeeCollected : 0;
    const totalNeeded = amount + fee;

    // Phase 2 Security: Pre-balance check via Mirror Node
    const { getMirrorAccountBalance } = await import('./resolver');
    const userBalance = await getMirrorAccountBalance(user);

    if (userBalance < totalNeeded) {
      console.warn(`[Resolver] Phase 2: Insufficient balance for bet on ${marketId}. User ${user} has ${userBalance} HBAR but needs ${totalNeeded} HBAR.`);
      return res.status(400).json({
        error: 'Insufficient balance to place this bet',
        available: userBalance,
        required: totalNeeded,
      });
    }

    // Record the bet (we always try to record if balance check passes)
    await postPlaceBet({
      marketId,
      side,
      amount,
      user,
      platformFeeCollected: fee > 0 ? fee : undefined
    });

    console.log(`[Resolver] Phase 2: Bet recorded on HCS for ${marketId} | stake=${amount} | fee=${fee} | user=${user}`);

    // Fee verification (non-blocking)
    if (paymentTxId) {
      const { verifyPlatformFeeWasPaid } = await import('./resolver');
      const feeCheck = await verifyPlatformFeeWasPaid(user, fee, marketId, paymentTxId);

      if (!feeCheck.verified) {
        console.warn(`[Resolver] Phase 2 AUDIT WARNING: Fee verification failed for recorded bet ${marketId}. Details: ${feeCheck.details}`);
      } else {
        console.log(`[Resolver] Phase 2: Fee verified for ${marketId} (tx: ${paymentTxId})`);
      }
    }

    res.json({ success: true, recorded: true });
  } catch (err: any) {
    console.error('[Resolver] Place bet error:', err);

    // Automatic refund
    if (user && amount && typeof amount === 'number' && amount > 0) {
      try {
        const { executePayout } = await import('./hedera');
        await executePayout({
          toAccountId: user,
          amountHbar: amount,
          memo: `Auto-refund: bet recording failed for ${marketId || 'unknown'}`,
        });
        console.log(`[Resolver] AUTO-REFUND: Sent ${amount} HBAR back to ${user}`);
      } catch (refundErr) {
        console.error('[Resolver] Auto-refund also failed:', refundErr);
      }
    }

    res.status(500).json({
      error: 'Bet recording failed. An automatic refund has been attempted.',
      details: err.message
    });
  }
});

/**
 * Long Game (Predictions) buyout / early exit.
 * Records the BUYOUT on HCS (no HBAR movement at this step — settlement only at payout time).
 * Must be called while the 50% window is still open (server-enforced).
 * User receives exactly 50% of their stake back at payout; the other 50% is forfeited to winners.
 */
app.post('/api/prediction/buyout', async (req, res) => {
  const { marketId, side, amount, user } = req.body;

  try {
    if (!marketId || !side || !amount || !user) {
      return res.status(400).json({ error: 'Missing fields (marketId, side, amount, user)' });
    }

    // Server-side window check (re-uses the same creation data + duration logic)
    try {
      const { fetchFastGameCreationData } = await import('./resolver');
      const creation = await fetchFastGameCreationData(marketId).catch(() => null);
      if (creation && creation.endTime) {
        const now = Math.floor(Date.now() / 1000);
        const dur = (creation.durationMinutes || (1 * 1440)) * 60;
        const remaining = creation.endTime - now;
        if (remaining <= (dur * 0.5)) {
          console.warn(`[Resolver] Buyout rejected for ${marketId}: window closed`);
          return res.status(400).json({ error: 'Buyout window has closed for this prediction' });
        }
      }
    } catch {}

    const returnedHalf = Math.round((Number(amount) * 0.5) * 100) / 100;
    const forfeitedHalf = Math.round((Number(amount) * 0.5) * 100) / 100;

    // Record on HCS (the postBuyout function lives in hedera.ts)
    const { postBuyout } = await import('./hedera');
    await postBuyout({
      marketId,
      user,
      side: side as 'YES' | 'NO',
      amount: Number(amount),
      returnedHalf,
      forfeitedHalf,
      gameType: 'long_updown',
    });

    console.log(`[Resolver] BUYOUT recorded for ${marketId} | user=${user} | original=${amount} | returned=${returnedHalf} | forfeited=${forfeitedHalf}`);

    res.json({ success: true, recorded: true, returnedHalf, forfeitedHalf });
  } catch (err: any) {
    console.error('[Resolver] Buyout error:', err);
    res.status(500).json({ error: 'Buyout recording failed', details: err.message });
  }
});

/**
 * Winner requests a claim.
 * The resolver verifies, calculates the correct payout (win vs unmatched return),
 * executes the transfer using the privileged key, and records everything on HCS.
 * This is the long-term automated claim architecture.
 */
app.post('/api/prediction/claim', async (req, res) => {
  try {
    const { marketId, winner } = req.body;

    if (!marketId || !winner) {
      return res.status(400).json({ error: 'Missing marketId or winner' });
    }

    // Resolver is the oracle — it always recomputes the exact amount from HCS
    const result = await processClaim(marketId, winner);

    if (!result.success) {
      return res.status(409).json(result);
    }

    res.json(result);
  } catch (err: any) {
    console.error('[Resolver] Claim error:', err);
    res.status(500).json({ error: err.message || 'Claim processing failed' });
  }
});

/**
 * Professional endpoint — UI calls this for real, resolver-verified claimable amounts.
 * Double-verified against HGraph/HCS. This kills all mock numbers.
 */
app.get('/api/prediction/claimable', async (req, res) => {
  try {
    const { marketId, account } = req.query;
    if (!marketId || !account) {
      return res.status(400).json({ error: 'marketId and account required' });
    }

    const calc = await computePayoutForUser(marketId as string, account as string);
    res.json(calc);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Calculation failed' });
  }
});

/**
 * New robust endpoint for personal prediction history (Portfolio & Claim Center).
 * Runs the wide topic scan server-side (where Mirror works reliably) and returns
 * the enriched history + claimables for the given account.
 * This bypasses all browser CSP / DNS issues for the user history view.
 */
app.get('/api/prediction/user-history', async (req, res) => {
  try {
    const { account } = req.query;
    if (!account) {
      return res.status(400).json({ error: 'account required' });
    }

    // Use the same reliable wide scan the resolver already trusts
    const { fetchReliableTopicMessages } = await import('./resolver');
    const messages = await fetchReliableTopicMessages(8000); // wide scan for history

    const userId = (account as string).trim();

    const userBets: Record<string, { myStake: number; side: string }> = {};
    const marketResolutions: Record<string, { winner: string; closingPrice: number }> = {};
    const userPayouts: Record<string, { amount: number; txId?: string }> = {};
    const marketMeta: Record<string, { asset?: string; question?: string; gameType?: string }> = {};
    const userBuyouts: Record<string, boolean> = {};  // per marketId: did this user buyout?

    for (const row of messages) {
      try {
        const raw = row.message || '';
        // Reuse the existing decode if exported, otherwise basic
        let decoded = raw;
        if (raw.startsWith('\\x')) {
          try {
            const clean = raw.replace(/\\x/g, '');
            const bytes = new Uint8Array(clean.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
            decoded = new TextDecoder().decode(bytes);
          } catch {}
        } else if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length > 16) {
          try { decoded = Buffer.from(raw, 'base64').toString('utf8'); } catch {}
        }

        const p = JSON.parse(decoded || '{}');
        const mid = p.marketId;

        if (p.type === 'CREATE_MARKET' || p.type === 'MARKET_CREATED') {
          if (mid && !marketMeta[mid]) {
            marketMeta[mid] = {
              asset: p.asset || 'HBAR',
              question: p.question,
              gameType: p.gameType,
            };
          }
        }

        if (p.type === 'PLACE_BET') {
          const msgUser = (p.user || p.submittedBy || '').toString().trim();
          if (msgUser !== userId) continue;

          if (!userBets[mid]) userBets[mid] = { myStake: 0, side: p.side };
          userBets[mid].myStake += Number(p.amount) || 0;
        }

        if (p.type === 'BUYOUT') {
          const msgUser = (p.user || p.submittedBy || '').toString().trim();
          if (msgUser === userId) {
            userBuyouts[mid] = true;
          }
        }

        if (p.type === 'MARKET_RESOLVED') {
          if (mid && !marketResolutions[mid]) {
            marketResolutions[mid] = {
              winner: (p.winner || '').toUpperCase(),
              closingPrice: p.closingPrice || 0,
            };
          }
        }

        if (p.type === 'PAYOUT') {
          const recipient = (p.recipient || p.to || '').toString().trim();
          if (recipient !== userId) continue;

          const amt = Number(p.amount) || 0;
          if (!userPayouts[mid] || amt > userPayouts[mid].amount) {
            userPayouts[mid] = { amount: amt, txId: p.transactionId || p.txId };
          }
        }
      } catch {}
    }

    // Build the same shape the frontend expects
    const history: any[] = [];
    const claimables: any[] = [];

    for (const mid of Object.keys(userBets)) {
      const betInfo = userBets[mid];
      const resolution = marketResolutions[mid];
      const paidInfo = userPayouts[mid];
      const meta = marketMeta[mid] || {};
      const asset = meta.asset || 'HBAR';
      const isLong = mid.startsWith('long-') || meta.gameType === 'long_updown';
      const hasForfeited = !!userBuyouts[mid];

      // Use the existing claimable calculator for owed logic (now supports FORFEIT_RETURN for buyouts)
      const payoutCalc = await (await import('./resolver')).computePayoutForUser(mid, userId);

      const userWon = resolution ? (resolution.winner === betInfo.side) : false;
      const actualPaid = paidInfo?.amount || payoutCalc.owed || 0;

      const profitMultiple = (betInfo.myStake > 0 && actualPaid > betInfo.myStake)
        ? (actualPaid / betInfo.myStake).toFixed(2)
        : null;

      // Dynamic question: prefer original from CREATE, fall back to asset-aware label.
      // Long games get clear "Long Prediction" labeling for Portfolio/Claim Center.
      let question = meta.question;
      if (!question) {
        const label = isLong ? 'Long Prediction' : 'Fast Game';
        question = `Will ${asset} be ${betInfo.side} the price at resolution? (${label})`;
      }

      const item = {
        marketId: mid,
        question,
        asset,
        gameType: meta.gameType || (isLong ? 'long_updown' : 'fast_updown'),
        isLongPrediction: isLong,
        hasForfeited,
        myStake: betInfo.myStake,
        userSide: betInfo.side,
        totalWinningPool: payoutCalc.totalWinningSideStake || 0,
        claimable: payoutCalc.owed || 0,
        claimReason: payoutCalc.reason || null,
        alreadyPaid: payoutCalc.alreadyPaid || !!paidInfo,
        resolved: !!resolution,
        userWon,
        sharePercent: (payoutCalc.totalWinningSideStake || 0) > 0
          ? ((betInfo.myStake / (payoutCalc.totalWinningSideStake || 1)) * 100).toFixed(1)
          : "0.0",
        creationPrice: null,
        closingPrice: resolution?.closingPrice || null,
        resolutionWinner: resolution?.winner || null,
        betSequence: null,
        actualPaid,
        payoutTxId: paidInfo?.txId || null,
        profitMultiple,
        claimedAmount: actualPaid || undefined,
      };

      if (betInfo.myStake > 0 || hasForfeited) {
        history.push(item);
      }
      if ((payoutCalc.owed || 0) > 0 && !item.alreadyPaid) {
        claimables.push({ ...item });
      }
    }

    res.json({
      myHistory: history.slice(0, 25),
      myClaimables: claimables,
    });
  } catch (err: any) {
    console.error('[Resolver] user-history error:', err);
    res.status(500).json({ error: err.message || 'History calculation failed' });
  }
});

/**
 * Lightweight volume reconciliation endpoint.
 * Used by the frontend for real-time volume accuracy ("Reconcile Volume" + smart auto-refresh).
 * Returns current YES/NO stakes + participant counts (+ forfeitCount for Long Games/Predictions).
 */
app.get('/api/prediction/market-volume', async (req, res) => {
  try {
    const { marketId } = req.query;
    if (!marketId) {
      return res.status(400).json({ error: 'marketId is required' });
    }

    const { getMarketVolume } = await import('./resolver');
    const volume = await getMarketVolume(marketId as string);
    res.json(volume);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Volume reconciliation failed' });
  }
});

/**
 * Public read-only balance endpoint (for premium UX: dynamic max on stake sliders).
 * Proxies Mirror Node (public data) so deployed FE (Vercel) can fetch without CORS/DNS issues.
 * SECURITY: This is READ-ONLY public Hedera data (no keys, no privileged actions).
 * Always re-verify on sensitive paths (e.g. /bet already calls getMirrorAccountBalance before recording).
 * Basic in-memory throttle to protect free-tier resolver.
 */
let balanceThrottle = new Map<string, number>();
app.get('/api/prediction/balance', async (req, res) => {
  try {
    const { account } = req.query;
    if (!account || typeof account !== 'string' || !account.startsWith('0.0.')) {
      return res.status(400).json({ error: 'account (0.0.xxxx) required' });
    }

    // Very lightweight per-account throttle (1 req / 2s) — sufficient for slider UX.
    const now = Date.now();
    const last = balanceThrottle.get(account) || 0;
    if (now - last < 2000) {
      return res.status(429).json({ error: 'rate limited', retryAfterMs: 2000 - (now - last) });
    }
    balanceThrottle.set(account, now);

    // Cleanup old entries occasionally
    if (balanceThrottle.size > 1000) {
      const cutoff = now - 60_000;
      for (const [k, v] of balanceThrottle) if (v < cutoff) balanceThrottle.delete(k);
    }

    const { getMirrorAccountBalance } = await import('./resolver');
    const balance = await getMirrorAccountBalance(account);
    res.json({
      account,
      balance,
      note: 'Sourced from Hedera Mirror (public). Client slider max only — resolver always re-verifies on /bet and create paths.',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Balance lookup failed' });
  }
});

/**
 * Admin/Resolver can call this to resolve a market and trigger payouts.
 */
app.post('/api/prediction/resolve', async (req, res) => {
  try {
    const { marketId, winner, closingPrice, winners } = req.body; // winners = [{account, amount}]

    // The resolver will use HGraph MCP as the source of truth for HBAR price when possible.
    await resolveAndPayout(marketId, winner, closingPrice || 0, winners || []);

    // Schedule delayed automatic payout for fast games and long predictions (bank-grade 28s safety + audit window)
    if (marketId.startsWith('fast-') || marketId.startsWith('long-')) {
      const { scheduleDelayedPayout } = await import('./resolver');
      scheduleDelayedPayout(marketId, PAYOUT_DELAY_MS);
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Treasury-only admin endpoints for manual intervention and edge case recovery.
 * Hidden from normal users. Only callable when the treasury wallet is connected.
 */
app.post('/api/admin/force-payout', async (req, res) => {
  try {
    const { marketId, caller } = req.body;

    if (caller !== process.env.TREASURY_ACCOUNT_ID) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { processAutomaticPayoutsForMarket } = await import('./resolver');
    await processAutomaticPayoutsForMarket(marketId);

    res.json({ success: true, message: `Force payout triggered for ${marketId}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Treasury-only: Force resolve a fast game immediately (Phase 0/1 escape hatch).
 * Bypasses tie logic, price tolerance, and all automatic timers.
 * Posts MARKET_RESOLVED + schedules the 28s delayed payout.
 */
app.post('/api/admin/force-resolve', async (req, res) => {
  try {
    const { marketId, winner, closingPrice, caller } = req.body;

    if (caller !== process.env.TREASURY_ACCOUNT_ID) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!marketId || !winner || (winner !== 'YES' && winner !== 'NO')) {
      return res.status(400).json({ error: 'marketId and winner (YES or NO) are required' });
    }

    const { forceResolveMarket } = await import('./resolver');
    const result = await forceResolveMarket(marketId, winner, closingPrice);

    res.json({
      success: true,
      message: `Force resolved ${marketId} to ${winner}`,
      result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Treasury-only: Re-record a PLACE_BET on HCS (simple recovery tool).
 * Use this when a user payment succeeded but the bet never made it to the topic.
 * This is a development / support safety net during heavy smoke testing.
 */
app.post('/api/admin/re-record-bet', async (req, res) => {
  try {
    const { marketId, side, amount, user, platformFeeCollected, caller } = req.body;

    if (caller !== process.env.TREASURY_ACCOUNT_ID) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!marketId || !side || !amount || !user) {
      return res.status(400).json({ error: 'marketId, side, amount, and user are required' });
    }

    await postPlaceBet({
      marketId,
      side,
      amount,
      user,
      platformFeeCollected,
    });

    res.json({
      success: true,
      message: `Re-recorded PLACE_BET (with full sequencing + Master Topic reference) for market ${marketId} on behalf of ${user}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin endpoint: Returns current resolver state for active fast games.
 * Extremely useful for debugging during playtesting ("what does the resolver actually see?").
 */
app.get('/api/admin/active-games', async (req, res) => {
  try {
    const { getActiveFastGamesState } = await import('./resolver');
    const state = getActiveFastGamesState();
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Public endpoint for the frontend to get current active fast games from the resolver's state.
 * This avoids direct browser CORS issues with HGraph/Mirror when deployed on Vercel.
 * The resolver keeps the authoritative in-memory list (populated from HCS on startup + creates).
 */
app.get('/api/prediction/active-fast-games', async (req, res) => {
  try {
    const { getActiveFastGamesState, getMarketVolume, reRegisterOverdueFastGames } = await import('./resolver');

    // Global visibility fix: before serving the list, run a HCS discovery pass.
    // This ensures that fast games created against *any* resolver instance (local dev or prod)
    // that successfully posted their CREATE_MARKET to the shared HCS topic 0.0.9017517
    // will be registered in *this* resolver's active list (so everyone polling the canonical
    // Railway resolver sees the full multiplayer set, not just what was created against this instance).
    // reRegisterOverdueFastGames scans recent messages and calls register for any fast-* CREATEs.
    try { await reRegisterOverdueFastGames(); } catch {}

    const state = getActiveFastGamesState();
    const baseGames = state.activeGames || [];

    // Enrich every active game with live volume/participant data from reliable HCS scan.
    // This is critical so that when the deployed FE (Vercel) uses the resolver path for the list
    // (to avoid browser CORS to HGraph/Mirror), the prediction cards still get correct
    // yesStake/noStake/currentVolume for pool weights, odds bars, and "X HBAR" total.
    // Without this, fetchFastGames takes the resolver branch, gets minimal {marketId, endTime...},
    // defaults stakes to 0, and the volume ratio block + bars are hidden or show 0 even when
    // bets are correctly recorded on-chain by the resolver. The direct-scan fallback only runs
    // if resolver returns empty or errors.
    const enriched = await Promise.all(baseGames.map(async (g: any) => {
      try {
        const vol = await getMarketVolume(g.marketId);
        // Phase 1: Always re-enrich creationPrice + creationPriceTime from immutable HCS.
        // Prevents "lost HBAR price at time of market placement" after refresh or list updates.
        let creationPrice = g.creationPrice;
        let creationPriceTime = g.creationPriceTime;
        try {
          const { fetchFastGameCreationData } = await import('./resolver');
          const cdata = await fetchFastGameCreationData(g.marketId).catch(() => null);
          if (cdata) {
            creationPrice = cdata.creationPrice ?? creationPrice;
            creationPriceTime = cdata.creationPriceTime ?? creationPriceTime;
          }
        } catch {}
        return {
          ...g,
          yesStake: vol.yesStake ?? 0,
          noStake: vol.noStake ?? 0,
          totalVolume: vol.totalVolume ?? 0,
          currentVolume: vol.totalVolume ?? 0,
          yesParticipants: vol.yesParticipants ?? 0,
          noParticipants: vol.noParticipants ?? 0,
          totalParticipants: (vol.yesParticipants ?? 0) + (vol.noParticipants ?? 0),
          creationPrice,
          creationPriceTime,
        };
      } catch {
        return { ...g, yesStake: 0, noStake: 0, currentVolume: 0, totalVolume: 0 };
      }
    }));

    res.json({ success: true, games: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Public endpoint for the frontend to get current active LONG games (Predictions).
 * Same enrichment, re-register, creationPrice, and volume (now including forfeitCount) as fast.
 * This will power the "Prediction Markets" toggle / long cards.
 */
app.get('/api/prediction/active-long-games', async (req, res) => {
  try {
    const { getActiveLongGamesState, getMarketVolume, reRegisterOverdueFastGames } = await import('./resolver');

    // Run the (now extended) re-register so long games created on any resolver instance are visible.
    try { await reRegisterOverdueFastGames(); } catch {}

    const state = getActiveLongGamesState();
    const baseGames = state.activeGames || [];

    const enriched = await Promise.all(baseGames.map(async (g: any) => {
      try {
        const vol = await getMarketVolume(g.marketId);
        let creationPrice = g.creationPrice;
        let creationPriceTime: string | undefined;
        try {
          const { fetchFastGameCreationData } = await import('./resolver');
          const cdata = await fetchFastGameCreationData(g.marketId).catch(() => null);
          if (cdata) {
            creationPrice = cdata.creationPrice ?? creationPrice;
            creationPriceTime = cdata.creationPriceTime ?? creationPriceTime;
          }
        } catch {}

        return {
          ...g,
          yesStake: vol.yesStake ?? 0,
          noStake: vol.noStake ?? 0,
          totalVolume: vol.totalVolume ?? 0,
          currentVolume: vol.totalVolume ?? 0,
          yesParticipants: vol.yesParticipants ?? 0,
          noParticipants: vol.noParticipants ?? 0,
          totalParticipants: (vol.yesParticipants ?? 0) + (vol.noParticipants ?? 0),
          forfeitCount: vol.forfeitCount ?? 0,
          forfeitTotal: vol.forfeitTotal ?? 0,
          creationPrice,
          creationPriceTime,
        };
      } catch {
        return { ...g, yesStake: 0, noStake: 0, currentVolume: 0, totalVolume: 0, forfeitCount: 0, forfeitTotal: 0 };
      }
    }));

    res.json({ success: true, games: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Simple server-side proxy for CoinGecko (and potentially other public APIs).
 * This lets the FE on Vercel fetch market data without hitting CORS blocks
 * from the browser (vercel.app origin is not allowed by CoinGecko etc.).
 * All external data goes through the resolver, which we control CORS for.
 */
app.get('/api/proxy/coingecko/*', async (req, res) => {
  try {
    const subpath = (req.params as any)[0] || '';
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const url = `https://api.coingecko.com/api/v3/${subpath}${query}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'WrappDEX/1.0',
        'Accept': 'application/json',
      },
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `CoinGecko ${r.status}` });
    }
    const data = await r.json();
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ error: 'coingecko proxy error', details: e.message });
  }
});

/**
 * Treasury-only: Manually schedule a delayed automatic payout for a fast game.
 * Useful for testing or recovery.
 */
app.post('/api/admin/schedule-payout', async (req, res) => {
  try {
    const { marketId, caller, delayMs = 28000 } = req.body;

    if (caller !== process.env.TREASURY_ACCOUNT_ID) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!marketId || !marketId.startsWith('fast-')) {
      return res.status(400).json({ error: 'Valid fast game marketId required' });
    }

    const { scheduleDelayedPayout } = await import('./resolver');
    scheduleDelayedPayout(marketId, Number(delayMs) || PAYOUT_DELAY_MS);

    res.json({
      success: true,
      message: `Scheduled delayed payout for ${marketId} in ${delayMs}ms`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Treasury-only: Cancel a previously scheduled automatic payout.
 */
app.post('/api/admin/cancel-scheduled-payout', async (req, res) => {
  try {
    const { marketId, caller } = req.body;

    if (caller !== process.env.TREASURY_ACCOUNT_ID) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!marketId) {
      return res.status(400).json({ error: 'marketId is required' });
    }

    const { cancelScheduledPayout } = await import('./resolver');
    const cancelled = cancelScheduledPayout(marketId);

    res.json({
      success: true,
      cancelled,
      message: cancelled
        ? `Cancelled scheduled payout for ${marketId}`
        : `No scheduled payout found for ${marketId}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/unresolved-games', async (req, res) => {
  try {
    const caller = req.query.caller as string;

    if (caller !== process.env.TREASURY_ACCOUNT_ID) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json({ 
      message: "Admin unresolved games endpoint ready.",
      note: "Use /api/admin/force-payout for manual recovery of edge cases."
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Stage 8 - Read-only Simulation Endpoint (for analysis & future AI tooling)
 * Treasury-only. Never moves HBAR. Returns clean structured data.
 */
app.post('/api/admin/simulate-payout', async (req, res) => {
  try {
    const { marketId, caller } = req.body;

    if (caller !== process.env.TREASURY_ACCOUNT_ID) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!marketId) {
      return res.status(400).json({ error: 'marketId is required' });
    }

    const { simulatePayoutsForMarket } = await import('./resolver');
    const simulation = await simulatePayoutsForMarket(marketId);

    res.json({
      success: true,
      simulation,
      note: "This is a read-only simulation. No funds were moved."
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Simulation failed' });
  }
});

/**
 * Treasury / privileged YOLO cleanup.
 * Accepts a list of dead fast game marketIds and posts FAST_GAME_RETIRED messages on HCS.
 * This is the secure, permanent, on-chain way to stop the active list from accumulating
 * old unresolvable 0h test corpses forever.
 * Only intended to be called from the UI when the connected wallet is the treasury account
 * (the resolver itself does not enforce wallet signature here — the frontend withSigning gate does).
 */
app.post('/api/prediction/retire-dead-fast-games', async (req, res) => {
  try {
    const { marketIds, reason } = req.body;

    if (!Array.isArray(marketIds) || marketIds.length === 0) {
      return res.status(400).json({ error: 'marketIds array required' });
    }

    const result = await retireDeadFastGames(marketIds, reason || 'LEGACY_0H_TEST_CORPSE');

    res.json({
      success: true,
      retired: result.retired,
      failed: result.failed,
      count: result.count,
    });
  } catch (err: any) {
    console.error('[Resolver] retire-dead-fast-games error:', err);
    res.status(500).json({ error: err.message || 'Retirement failed' });
  }
});
// ──────────────────────────────────────────────────────────────
// SCHEDULED RESCUE — Option 2 (Multi-sig safe method)
// Creates a schedule that both of your signer wallets can approve
// ──────────────────────────────────────────────────────────────
app.post('/api/emergency/schedule-rescue', async (req, res) => {
  try {
    const { testAmount = 5 } = req.body;   // default 5 HBAR test

    console.log(`🚨 Creating SCHEDULED RESCUE → ${testAmount} HBAR from multi-sig 0.0.9695738`);

    const { client } = await import('./hedera');   // reuse existing client

    const scheduleTx = await new ScheduleCreateTransaction()
      .setScheduledTransaction(
        new TransferTransaction()
          .addHbarTransfer("0.0.9695738", new Hbar(-testAmount))
          .addHbarTransfer("0.0.518487", new Hbar(testAmount))
          .setTransactionMemo(`WRAPpDEX Multi-sig rescue test ${testAmount} HBAR - ${Date.now()}`)
      )
      .setAdminKey(/* optional */) 
      .freezeWith(client);

    const txResponse = await scheduleTx.execute(client);
    const receipt = await txResponse.getReceipt(client);
    const scheduleId = receipt.scheduleId.toString();

    console.log(`✅ Schedule created! Schedule ID: ${scheduleId}`);

    res.json({
      success: true,
      message: "Schedule created successfully. Now sign it from BOTH signer wallets.",
      scheduleId: scheduleId,
      testAmount,
      nextStep: "Open HashPack or HSuite, search for this Schedule ID, and sign with both keys."
    });

  } catch (err: any) {
    console.error("❌ Failed to create schedule:", err.message);
    res.status(500).json({ error: err.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// Periodic background tasks
// ─────────────────────────────────────────────────────────────────────────────

// 1. Mirror Node polling (fallback / funding detection)
mirrorInterval = setInterval(() => {
  pollMirrorNodeForTransfers().catch(() => {});
}, 30_000); // Reduced noise

// 2. Auto-resolution loop (Fast Games + Long Games / Predictions)
// Uses the shared implementation from resolver.ts (autoResolveExpiredFastGames now handles both)
autoResolveInterval = setInterval(async () => {
  try {
    await autoResolveExpiredFastGames();
  } catch (e) {
    console.error('[Resolver] autoResolve loop error:', e);
  }
}, 20_000);

// Phase 0/1 Heartbeat: Additional safety net scan every 60s.
// Catches games that may have been missed due to restarts, timing, or transient price fetch issues.
// This makes the resolver significantly more reliable without being aggressive.
heartbeatInterval = setInterval(async () => {
  try {
    await autoResolveExpiredFastGames();

    // Re-register any games (fast or long/predictions) that were created while this resolver instance was down
    const { reRegisterOverdueFastGames } = await import('./resolver');
    await reRegisterOverdueFastGames();

    // Light heartbeat log (only occasionally to avoid noise)
    if (Math.random() < 0.2) {
      const { getActiveFastGamesState, getActiveLongGamesState } = await import('./resolver');
      const fastState = getActiveFastGamesState();
      const longState = getActiveLongGamesState();
      const ph = fastState.priceHealth || longState.priceHealth;
      const priceInfo = ph 
        ? `price=$${ph.price.toFixed(6)} source=${ph.source.substring(0, 40)}${ph.isStale ? ' (stale)' : ''}`
        : 'no recent price';
      console.log(`[Resolver] Heartbeat: auto-resolve + re-registration safety scan completed | ${priceInfo} (fast=${(fastState.activeGames||[]).length}, long=${(longState.activeGames||[]).length})`);
    }
  } catch (e) {
    console.error('[Resolver] Heartbeat autoResolve error:', e);
  }
}, 60_000);

// Use options object form for unambiguous host binding in containers (Railway, Docker, Fly, etc.)
// Combined with top-level PORT log + post-bind address() confirmation to diagnose proxy reachability.
const server = app.listen({ port: PORT, host: '0.0.0.0' }, async () => {
  await loadSecretsFromSupabase();
  console.log(`[Resolver] Prediction Market Resolver running on port ${PORT}`);
  console.log(`[Resolver] Fast Game payout delay configured to: ${PAYOUT_DELAY_MS}ms`);
  console.log('[Resolver] Mirror polling + Fast Game auto-resolution loops active');

  // Confirm actual bound address for Railway container diagnostics.
  // If this shows 127.0.0.1 instead of 0.0.0.0, proxy from outside container will fail.
  const boundAddr = server.address();
  console.log(`[Resolver] CONFIRMED BOUND ADDRESS (from inside cb): ${JSON.stringify(boundAddr)}`);

  // Warm the price health immediately so heartbeat logs show a real price even before first game auto-resolve,
  // and /api/price/hbar is useful right away.
  setTimeout(async () => {
    try {
      const { getCurrentHbarPriceWithAuditTrail } = await import('./resolver');
      await getCurrentHbarPriceWithAuditTrail();
    } catch (e: any) {
      console.warn('[Resolver] Initial price warm failed (will retry on first resolution or /price call):', e.message);
    }
  }, 4000);

  // Phase 1: Load persisted active games for restart resilience
  try {
    const { loadActiveGamesFromDisk } = await import('./resolver');
    await loadActiveGamesFromDisk();
  } catch (e) {
    console.warn('[Resolver] Could not load persisted games on startup');
  }

  // === Phase 1: One-time Startup Recovery Scan (polite, non-aggressive) ===
  // Only runs once on startup. All normal payouts are now triggered directly
  // from resolution detection via scheduleDelayedPayout (see autoResolveExpiredFastGames).
  // We deliberately removed the recurring 90s "pesky" safety-net scan that was
  // causing repeated retry spam and noisy behavior.
  setTimeout(async () => {
    console.log('[Resolver] Running one-time startup automatic payout recovery scan...');
    try {
      const { fetchReliableTopicMessages, processAutomaticPayoutsForMarket } = await import('./resolver');

      const messages = await fetchReliableTopicMessages(1500);

      const resolvedMarkets = new Set<string>();
      const closedMarkets = new Set<string>();

      for (const row of messages) {
        try {
          const raw = row.message || '';
          const decoded = raw.startsWith('\\x')
            ? Buffer.from(raw.replace(/\\x/g, ''), 'hex').toString('utf8')
            : raw;
          const p = JSON.parse(decoded);

          if (p.type === 'MARKET_RESOLVED' && p.gameType === 'fast_updown' && p.marketId) {
            resolvedMarkets.add(p.marketId);
          }
          if (p.type === 'PAYOUT_CLOSED' && p.marketId) {
            closedMarkets.add(p.marketId);
          }
        } catch {}
      }

      let processed = 0;
      for (const marketId of resolvedMarkets) {
        if (!closedMarkets.has(marketId)) {
          console.log(`[Resolver] Startup recovery: Found resolved market without PAYOUT_CLOSED: ${marketId}`);
          await processAutomaticPayoutsForMarket(marketId).catch(() => {});
          await new Promise(r => setTimeout(r, 1200));
          processed++;
        }
      }

      console.log(`[Resolver] Startup recovery scan complete. Processed ${processed} markets.`);
    } catch (e) {
      console.error('[Resolver] Error during startup payout recovery scan:', e);
    }
  }, 12000); // Give resolver time to fully initialize
});

// Attach listeners immediately after listen() returns (before or concurrent with 'listening' event + cb).
// This guarantees we capture the real bound address for container proxy debugging.
server.on('listening', () => {
  const addr = server.address();
  console.log(`[Resolver] LISTENING EVENT FIRED: bound=${JSON.stringify(addr)} | If host != '0.0.0.0'/'::' then Railway ingress proxy (external to container) cannot connect.`);
});
server.on('error', (err: any) => {
  console.error('[Resolver] SERVER ERROR (e.g. EADDRINUSE, permission):', err && err.code ? err.code : err);
});

// Production readiness: graceful shutdown for Railway / SIGTERM
process.on('SIGTERM', () => {
  console.log('[Resolver] SIGTERM received, starting graceful shutdown...');
  clearInterval(mirrorInterval);
  clearInterval(autoResolveInterval);
  clearInterval(heartbeatInterval);
  try { shutdownResolver(); } catch (e) { console.warn('[Resolver] shutdownResolver error (non-fatal):', (e as Error).message); }
  server.close(() => {
    console.log('[Resolver] HTTP server closed cleanly. Intervals and timers cleared.');
    process.exit(0);
  });
  // Force exit after 10s if close hangs
  setTimeout(() => {
    console.error('[Resolver] Forced exit after graceful shutdown timeout.');
    process.exit(1);
  }, 10000).unref();
});

process.on('SIGINT', () => {
  console.log('[Resolver] SIGINT received, shutting down...');
  clearInterval(mirrorInterval);
  clearInterval(autoResolveInterval);
  clearInterval(heartbeatInterval);
  try { shutdownResolver(); } catch (e) { console.warn('[Resolver] shutdownResolver error (non-fatal):', (e as Error).message); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});

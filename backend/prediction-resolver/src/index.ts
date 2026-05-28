import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { 
  pollMirrorNodeForTransfers, 
  resolveAndPayout, 
  autoResolveExpiredFastGames,
  registerFastGameForAutoResolution,
  processClaim,
  retireDeadFastGames,
  computePayoutForUser
} from './resolver';
import { postCreateMarket, postPlaceBet } from './hedera';

dotenv.config();

const app = express();

// Allow requests from the Vite frontend (localhost:5173)
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

const PORT = process.env.PORT || 4000;

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
      creationPrice,
      submittedBy,
    } = req.body;

    if (!marketId || !question || !endTime || !submittedBy) {
      console.warn('[Resolver] Missing required fields in request');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await postCreateMarket({
      marketId,
      question,
      asset,
      endTime,
      gameType: 'fast_updown',
      durationMinutes,
      initialSide,
      initialStake,
      creationPrice,
      submittedBy,
    });

    console.log(`[Resolver] Successfully posted CREATE_MARKET for ${marketId}`);

    // CRITICAL: Also post a PLACE_BET for the market maker's initial stake.
    // This ensures the creator's stake is included in the volume pools and they get
    // their fair share of winnings (or unmatched return) during payout calculation.
    // Without this, the market maker was being excluded from the parimutuel math.
    await postPlaceBet({
      marketId,
      side: initialSide,
      amount: initialStake,
      user: submittedBy,
    });
    console.log(`[Resolver] Posted Initial Market Maker Bet #1 (creator stake) for ${marketId}`);

    // Register for automatic resolution when time expires.
    // Creation price will be read from the immutable HCS topic at resolution time.
    registerFastGameForAutoResolution(marketId, endTime);

    res.json({ success: true, marketId });
  } catch (err: any) {
    console.error('[Resolver] Create market error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
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
 * Lightweight volume reconciliation endpoint.
 * Used by the frontend for real-time volume accuracy ("Reconcile Volume" + smart auto-refresh).
 * Returns current YES/NO stakes + participant counts for a specific fast game.
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
 * Admin/Resolver can call this to resolve a market and trigger payouts.
 */
app.post('/api/prediction/resolve', async (req, res) => {
  try {
    const { marketId, winner, closingPrice, winners } = req.body; // winners = [{account, amount}]

    // The resolver will use HGraph MCP as the source of truth for HBAR price when possible.
    await resolveAndPayout(marketId, winner, closingPrice || 0, winners || []);

    // Phase 1: Schedule delayed automatic payout (25-30s window) for fast games
    if (marketId.startsWith('fast-')) {
      const { scheduleDelayedPayout } = await import('./resolver');
      scheduleDelayedPayout(marketId, 28000);
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

    if (caller !== process.env.TREASURY_ACCOUNT_ID && caller !== '0.0.9006841') {
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

    if (caller !== process.env.TREASURY_ACCOUNT_ID && caller !== '0.0.9006841') {
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

    if (caller !== process.env.TREASURY_ACCOUNT_ID && caller !== '0.0.9006841') {
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
 * Treasury-only: Manually schedule a delayed automatic payout for a fast game.
 * Useful for testing or recovery.
 */
app.post('/api/admin/schedule-payout', async (req, res) => {
  try {
    const { marketId, caller, delayMs = 28000 } = req.body;

    if (caller !== process.env.TREASURY_ACCOUNT_ID && caller !== '0.0.9006841') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!marketId || !marketId.startsWith('fast-')) {
      return res.status(400).json({ error: 'Valid fast game marketId required' });
    }

    const { scheduleDelayedPayout } = await import('./resolver');
    scheduleDelayedPayout(marketId, Number(delayMs));

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

    if (caller !== process.env.TREASURY_ACCOUNT_ID && caller !== '0.0.9006841') {
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

    if (caller !== process.env.TREASURY_ACCOUNT_ID && caller !== '0.0.9006841') {
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

    if (caller !== process.env.TREASURY_ACCOUNT_ID && caller !== '0.0.9006841') {
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

// ─────────────────────────────────────────────────────────────────────────────
// Periodic background tasks
// ─────────────────────────────────────────────────────────────────────────────

// 1. Mirror Node polling (fallback / funding detection)
setInterval(() => {
  pollMirrorNodeForTransfers().catch(() => {});
}, 30_000); // Reduced noise

// 2. Fast Game auto-resolution loop
// Uses the shared implementation from resolver.ts
setInterval(async () => {
  try {
    await autoResolveExpiredFastGames();
  } catch (e) {
    console.error('[Resolver] autoResolve loop error:', e);
  }
}, 20_000);

// Phase 0/1 Heartbeat: Additional safety net scan every 60s.
// Catches games that may have been missed due to restarts, timing, or transient price fetch issues.
// This makes the resolver significantly more reliable without being aggressive.
setInterval(async () => {
  try {
    await autoResolveExpiredFastGames();

    // Re-register any fast games that were created while this resolver instance was down
    const { reRegisterOverdueFastGames } = await import('./resolver');
    await reRegisterOverdueFastGames();

    // Light heartbeat log (only occasionally to avoid noise)
    if (Math.random() < 0.2) {
      const { getActiveFastGamesState } = await import('./resolver');
      const state = getActiveFastGamesState();
      const ph = state.priceHealth;
      const priceInfo = ph 
        ? `price=$${ph.price.toFixed(6)} source=${ph.source.substring(0, 40)}${ph.isStale ? ' (stale)' : ''}`
        : 'no recent price';
      console.log(`[Resolver] Heartbeat: auto-resolve + re-registration safety scan completed | ${priceInfo}`);
    }
  } catch (e) {
    console.error('[Resolver] Heartbeat autoResolve error:', e);
  }
}, 60_000);

app.listen(PORT, async () => {
  console.log(`[Resolver] Prediction Market Resolver running on port ${PORT}`);
  console.log('[Resolver] Mirror polling + Fast Game auto-resolution loops active');

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
      const { fetchTopicMessages, processAutomaticPayoutsForMarket } = await import('./resolver');

      const messages = await fetchTopicMessages(1500);

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

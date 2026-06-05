# BUILD BACK BETTER — Resolver Behavior Mapping Document

**Date:** 2026-05 (post May 25-29 smoke test archive)  
**Purpose:** Side-by-side comparison of the proven working resolver behavior (captured in the May 25-29 smoke test screenshots) versus the current codebase after the professional polish refactoring.  
**Goal:** Identify exact matches, improvements, gaps, and risks before any code changes. This document serves as the authoritative map for restoring bank-grade prediction market resolver capability on Hedera.

**Key Accounts (Authoritative):**
- Resolution / Escrow (privileged payout + HCS posting): **0.0.9006979**
- Treasury (platform fees 1%): **0.0.9006841**
- Master HCS Topic: **0.0.9017517**

---

## Executive Summary

The original resolver (visible in the screenshot archive) was a functional "Ford Model T":
- It successfully created markets, recorded bets via structured HCS memos, resolved using the official Hedera Network Exchange Rate, and executed real HBAR payouts.
- It was crude (limited error handling, tighter loops, less audit depth) but it **moved money atomically** and produced verifiable on-chain outcomes during extensive smoke testing.

The current codebase (post-refactoring) is **structurally more professional** in most areas:
- Stronger price provenance and multi-layer fetching.
- Much richer human + machine-readable HCS audit memos.
- Better safety (balance checks, fee verification, funding pre-checks, HGraph volume reconciliation skeleton).
- More reliable auto-resolution with proper tie handling and hard timeouts.
- 28-second delayed payout scheduling for fast games (reliability improvement).

**Overall Assessment:**  
The core architecture ("Resolver as single source of truth → posts authoritative HCS messages from privileged account → executes direct payouts") is intact and improved. However, some behavioral details (especially payout timing aggressiveness, exact claim math edge cases, and account ID defaults) have drifted and must be calibrated against the proven smoke test runs before we declare the system bank-grade.

**Match Level:** ~75-80% behavioral fidelity to the successful May 25-29 runs. The gaps are addressable with targeted adjustments rather than a full rewrite.

---

## 1. Price Source & Resolution Oracle

### Observed in Screenshots (Old Working Behavior)
- Resolver repeatedly logged use of **Hedera Network Exchange Rate (PRIMARY)** via Mirror Node.
- Exact calculation pattern visible: `cent_equiv / (hbar_equiv * 100)` (e.g., 265208 cent_equiv / 30000 hbar_equiv).
- CoinGecko was explicitly treated as **non-authoritative fallback** ("This is NOT the Hedera network rate. Only acceptable for UI display").
- Price was "backed" / captured at key moments (creation and especially resolution) with timestamps.
- Resolver treated the price as the single source of truth for winner determination.

### Current Code Implementation
- `getCurrentHbarExchangeRateFromNetwork()` in `hedera.ts` implements a 4-layer strategy:
  1. Hedera SDK `ExchangeRate.getCurrentRate()` (PRIMARY official attempt).
  2. Client cast fallback.
  3. Direct Mirror Node `/api/v1/network/exchangerate` (cent_equiv / hbar_equiv math) — **exact match** to old logs.
  4. Loud CoinGecko warning as last resort.
- `getCurrentHbarPriceWithAuditTrail()` adds provenance (`priceTime`, `resolvedAt`, `source`, `isStale`).
- Used in `autoResolveExpiredFastGames()`, `resolveAndPayout()`, and the `/api/price/hbar` endpoint.

### Match Level
**High** (very close, with improvements).

### Risks / Gaps
- Old version sometimes fell back more noisily during smoke tests. Current code is stricter on out-of-range prices.
- No evidence in current code of the exact "back the price before all predictions came in" pre-resolution snapshotting that some screenshots imply.

### Recommended Actions
- Keep the current Mirror Node layer as the authoritative path.
- Add explicit logging of the exact `cent_equiv` / `hbar_equiv` values at resolution time (for audit parity with old logs).
- Ensure `creationPrice` is always pulled from the immutable HCS `CREATE_MARKET` message at resolution time (already partially implemented).

---

## 2. HCS Message Formats & Audit Trail

### Observed in Screenshots (Old Working Behavior)
- `PLACE_BET` memos contained: `marketId`, `side`, `amount`, `user`, `timestamp`, `feeBps:100`, `treasury:"0.0.9006841"`, `submittedBy`.
- Clear platform fee collection visible (`platformFeeCollected`).
- `MARKET_RESOLVED` and `PAYOUT_CLOSED` messages were posted.
- Messages were human-readable enough for HashScan review during testing.

### Current Code Implementation
- `postPlaceBet()` produces high-quality dual memos:
  - Machine fields (`type`, `marketId`, `side`, `amount`, `feeBps`, `treasury`, `betSequence`, `masterTopicId`).
  - Excellent human-readable `memo` field using "PREDICTION" language for legal/HashScan visibility.
- `postMarketResolved()` and `postPayoutClosedMessage()` include rich `memo` fields with decision details, prices, sources, and transaction lists.
- `postPayoutMessage()` for individual payouts.

### Match Level
**High + Significant Improvement**.

### Risks / Gaps
- Old memos were simpler. Current ones are more professional but slightly different in shape. This is acceptable if we maintain backward compatibility for historical queries.

### Recommended Actions
- Freeze the current memo format as the new standard.
- Ensure all historical smoke test markets can still be queried using the old simpler shapes (the `fetchReliableTopicMessages` + `decodeHcsMessage` already handle mixed formats reasonably well).

---

## 3. Payout Execution Model

### Observed in Screenshots (Old Working Behavior)
- Resolver executed **direct HBAR transfers** from the privileged resolution account (`0.0.9006979`).
- Many "Auto-Executed direct payout of X HBAR to 0.0.90..." logs in relatively quick succession during successful resolutions.
- Payouts felt "atomic" from the user's perspective (resolution message + money movement close together).
- Platform fees visibly landed in treasury.

### Current Code Implementation
- `executePayout()` performs direct `TransferTransaction` from `resolutionAccountId`.
- For fast games: `scheduleDelayedPayout(marketId, 28000)` → `processAutomaticPayoutsForMarket()`.
- Inside `processAutomaticPayoutsForMarket()`:
  - Re-scans HCS for `MARKET_RESOLVED` + all `PLACE_BET`.
  - Computes parimutuel-style payouts (`owed = stake + (stake / totalWinning) * totalLosing`).
  - Balance pre-check on resolver account.
  - Soft HGraph volume verification.
  - Executes payouts + posts individual `PAYOUT` + final `PAYOUT_CLOSED`.
- 28-second safety window is explicit and configurable.

### Match Level
**Medium-High** (philosophically aligned, tactically more conservative).

### Risks / Gaps
- The 28s delay + scheduling is **safer** than the old tight-loop direct execution but changes the "feel" from the smoke tests.
- Old version appeared to do more immediate batch payouts. Current code has stronger duplicate guards (`hasExistingPayout`).
- `computePayoutForUser` and the auto processor use very similar logic — good.

### Recommended Actions
- Keep the 28s delayed model (it is a professional upgrade for reliability and auditability).
- Add a configuration flag or admin override for "immediate mode" during future smoke testing if needed.
- Ensure the payout math in `processAutomaticPayoutsForMarket` and `computePayoutForUser` is identical (currently very close — verify edge cases around unmatched returns and alreadyPaid detection).

---

## 4. Auto-Resolution & Fast Game Loops

### Observed in Screenshots (Old Working Behavior)
- Explicit "Fast Game auto-resolution loops active" in startup logs.
- Resolver periodically scanned and resolved expired games.
- Tie situations were handled (price flat at creation price).

### Current Code Implementation
- `autoResolveExpiredFastGames()` runs every 20s + 60s heartbeat.
- Sophisticated tie detection + 5-second breakout polling with hard `MAX_TIE_POLL_SECONDS` (180s) timeout.
- `registerFastGameForAutoResolution()` + persistence.
- Startup recovery scan for resolved-but-unpaid markets.
- `scheduleDelayedPayout` after any resolution (manual or auto).

### Match Level
**High + Major Improvement** (tie handling and recovery are clearly superior).

### Risks / Gaps
- Old version may have had simpler (or buggier) tie logic. Current version is more robust.

### Recommended Actions
- This area is in good shape. Document the tie logic clearly in the MASTER_PLAN.

---

## 5. Account Usage & Privileged Operations

### Observed in Screenshots (Old Working Behavior)
- Resolution account (`0.0.9006979`) was the operator for HCS submissions and payouts.
- Treasury (`0.0.9006841`) received all platform fees.
- Clear separation visible in every transaction.

### Current Code Implementation
- `hedera.ts` correctly loads `RESOLUTION_ACCOUNT_ID` / `RESOLUTION_PRIVATE_KEY` as the operator.
- `treasuryAccountId` defaults to `0.0.9006841`.
- **Problem:** `resolver.ts:19` still has a hardcoded fallback `const RESOLUTION_ACCOUNT = ... || '0.0.9006850'`.

### Match Level
**Medium** (code intent is correct; one dangerous hardcoded default remains).

### Risks / Gaps
- If `.env` is missing or incomplete, the resolver will silently (or loudly) use the wrong account (`0.0.9006850`).

### Recommended Actions (High Priority)
1. Remove or deprecate the `0.0.9006850` fallback in `resolver.ts`.
2. Make `RESOLUTION_ACCOUNT_ID` required with no fallback (or default only to the real `0.0.9006979`).
3. Add a startup assertion that logs the exact accounts being used.

---

## 6. Volume Calculation, Claims & Idempotency

### Observed in Screenshots (Old Working Behavior)
- Resolver calculated winner stakes and paid out proportionally.
- "alreadyPaid" / duplicate protection existed (users couldn't double-claim).
- Clear separation between resolution and payout events on HCS.

### Current Code Implementation
- `computePayoutForUser()` and `processAutomaticPayoutsForMarket()` both scan HCS for bets + resolution.
- Strong `alreadyPaid` detection via existing `PAYOUT` messages.
- `hasExistingPayout()` guard in auto processor.
- Good support for "WIN" vs "UNMATCHED_RETURN" reasoning.

### Match Level
**High**.

### Risks / Gaps
- The exact parimutuel math (how unmatched stakes are handled) needs verification against the specific successful payouts in the screenshots.

### Recommended Actions
- During the mapping phase, pick 2-3 specific successful smoke test markets from the screenshots and manually simulate the payout math using current `computePayoutForUser` against the historical HCS messages.

---

## 7. Overall Assessment & Risk Matrix

| Area                        | Match Level | Risk to Restoration | Recommended Priority |
|-----------------------------|-------------|---------------------|----------------------|
| Price Source (Mirror Node)  | High        | Low                 | Document + enhance logging |
| HCS Message Quality         | High+       | Low                 | Freeze current format |
| Payout Execution (Direct)   | Medium-High | Medium              | Keep 28s delay; add test override |
| Auto-Resolution Loops       | High+       | Low                 | Strong — document tie logic |
| Account Defaults            | Medium      | **High**            | Fix 0.0.9006850 fallback immediately |
| Payout Math + Idempotency   | High        | Medium              | Cross-check against 2-3 historical markets |
| Audit Trail / Memos         | High+       | Low                 | Improvement — good |
| Recovery & Resilience       | High+       | Low                 | Major improvement |

**Top 3 Immediate Risks Before Mapping/Code Changes:**
1. Wrong resolution account fallback (`0.0.9006850`).
2. Slight behavioral drift in payout timing and aggressiveness.
3. Need to validate exact payout math against real historical data from the screenshots.

---

## Recommended Next Steps (Mapping Phase)

1. **Fix the account fallback** (quick win, low risk).
2. Generate or manually extract 3-5 "golden" successful smoke test markets from the screenshot archive (with full HCS message history if possible).
3. Run the current `computePayoutForUser` + `processAutomaticPayoutsForMarket` logic against those historical messages and compare dollar amounts / recipients to what actually paid out.
4. Decide on any calibration (e.g., keep 28s delay? Adjust tolerances?).
5. Update this document with the empirical results.
6. Only then begin targeted code adjustments.

---

**Document Owner:** Grok (as Web3/Hedera payment infrastructure lead)  
**Status:** Living document — update after each empirical validation pass.

This mapping is now the foundation for the rest of the 10-step Build Back Better plan. We will not make changes to the resolver until we have validated against the real historical behavior captured in your screenshots.

Ready to proceed to empirical validation on specific historical markets when you are.
// ═══════════════════════════════════════════════════════════════════════
// SPIN WHEEL — CSPRNG-determined outcomes, KV-backed cooldowns
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import {
  getClientIp, isRateLimited, sanitizeString, isValidHederaAccountId,
  secureRandomFloat, secureRandomInt, generateTicketId, ROUTE_PREFIX,
} from "./shared.ts";
import { validateSession, requireAuth } from "./auth.ts";
import { requireOwner, logAdminAction } from "./auth.ts";
import { verifyVipEligibilityFull } from "./vip.ts";

// ── Constants ────────────────────────────────────────────────────────

const WINNERS_KEY = "spin_winners_log";
const COOLDOWN_PREFIX = "spin_cd_";   // KV key per account for cooldown
const MAX_WINNERS = 10;
const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const SPIN_ODDS = 0.02;    // 1:50 = 2% — uniform for ALL wallets
const SEGMENT_COUNT = 12;
const WINNER_SEGMENT_INDEX = 5; // index of the "HBAR.ħ" segment on the wheel

interface WinnerRecord {
  accountId: string;
  ticketId: string;
  timestamp: number;
}

// ── Route Registration ──────────────────────────────────────────────

export function registerSpinRoutes(app: Hono): void {

  // GET /winners — public read-only, returns last 10 winners
  app.get(`${ROUTE_PREFIX}/winners`, async (c) => {
    try {
      const winners: WinnerRecord[] = (await kv.get(WINNERS_KEY)) ?? [];
      return c.json({ winners });
    } catch (err) {
      console.error("[SPIN] Error fetching winners:", err);
      return c.json({ error: "Failed to fetch winners" }, 500);
    }
  });

  // POST /spin — Server-determined outcome via CSPRNG.
  //
  // IMPLEMENTATION NOTE — Security Audit 2026-03-16: Changed from optional
  // body.accountId fallback to MANDATORY ED25519 session auth. Previously,
  // unauthenticated callers could spin as any VIP wallet by spoofing
  // body.accountId. While VIP status was verified, IDENTITY was not —
  // enabling grief attacks (consuming another wallet's cooldown) and
  // prize theft. This was HIGH-02.
  //
  // Now requires a cryptographically verified ED25519 session.

  app.post(`${ROUTE_PREFIX}/spin`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) {
        return c.json({ error: "Rate limited — try again in a minute" }, 429);
      }

      // ── ED25519 session required — no body.accountId fallback ──
      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const accountId = auth.accountId;
      console.log(`[Spin] Authenticated via ED25519 session: ${accountId}`);

      // ── VIP gate — verify eligibility even with valid session ──
      const vipStatus = await verifyVipEligibilityFull(accountId);
      if (!vipStatus.eligible) {
        console.log(`[Spin] VIP FAILED: ${accountId} balance=${vipStatus.tokenBalance} nfts=${vipStatus.nftCount} lp=${vipStatus.lpBalance ?? 0}`);
        return c.json({
          error: "VIP access required — hold 100M+ HBAR.ħ tokens, a VIP NFT, or 156,250+ LP tokens to spin",
          code: "VIP_REQUIRED",
          tokenBalance: vipStatus.tokenBalance,
          nftCount: vipStatus.nftCount,
        }, 403);
      }
      console.log(`[Spin] VIP verified: ${accountId} balance=${vipStatus.tokenBalance} nfts=${vipStatus.nftCount} lp=${vipStatus.lpBalance ?? 0}`);

      const now = Date.now();

      // ── Server-side cooldown (KV-backed, not localStorage) ──
      const cdKey = COOLDOWN_PREFIX + accountId;
      const lastSpin: number | null = await kv.get(cdKey);
      if (lastSpin && (now - lastSpin) < SPIN_COOLDOWN_MS) {
        const remaining = SPIN_COOLDOWN_MS - (now - lastSpin);
        return c.json({
          canSpin: false,
          cooldownMs: remaining,
          error: "Cooldown active — try again later",
        }, 429);
      }

      // ── Determine outcome with crypto RNG ──
      const odds = SPIN_ODDS;
      const roll = secureRandomFloat();
      const isWin = roll < odds;

      // ── Calculate wheel segment and rotation ──
      let targetSegmentIndex: number;
      if (isWin) {
        targetSegmentIndex = WINNER_SEGMENT_INDEX;
      } else {
        // Pick a random non-winning segment
        let idx: number;
        do {
          idx = secureRandomInt(SEGMENT_COUNT);
        } while (idx === WINNER_SEGMENT_INDEX);
        targetSegmentIndex = idx;
      }

      const segmentAngle = 360 / SEGMENT_COUNT;
      const segCenterAngle = targetSegmentIndex * segmentAngle + segmentAngle / 2;
      const jitter = (secureRandomFloat() - 0.5) * segmentAngle * 0.6;
      const targetAngle = 360 - segCenterAngle + jitter;
      const fullRotations = (5 + secureRandomInt(4)) * 360;
      // Client adds this to their current rotation state
      const spinDelta = fullRotations + ((targetAngle % 360) + 360) % 360;

      // ── Set cooldown ──
      await kv.set(cdKey, now);

      // ── If win, generate ticket and record ──
      let ticketId: string | null = null;
      let winners: WinnerRecord[] | null = null;

      if (isWin) {
        ticketId = generateTicketId();
        const record: WinnerRecord = {
          accountId: sanitizeString(accountId, 20),
          ticketId,
          timestamp: now,
        };
        const existing: WinnerRecord[] = (await kv.get(WINNERS_KEY)) ?? [];
        winners = [record, ...existing].slice(0, MAX_WINNERS);
        await kv.set(WINNERS_KEY, winners);
        console.log(`[Spin] WIN: ${accountId} / ${ticketId} (roll=${roll.toFixed(4)}, odds=${odds})`);
      } else {
        console.log(`[Spin] LOSE: ${accountId} (roll=${roll.toFixed(4)}, odds=${odds})`);
      }

      return c.json({
        win: isWin,
        ticketId,
        segmentIndex: targetSegmentIndex,
        spinDelta: Math.round(spinDelta),
        timestamp: now,
        winners: winners ?? undefined,
      });
    } catch (err) {
      console.error("[SPIN] Error in /spin:", err);
      return c.json({ error: "Spin failed" }, 500);
    }
  });

  // POST /winners — Disabled. All recording happens inside POST /spin.
  app.post(`${ROUTE_PREFIX}/winners`, (c) => {
    return c.json(
      { error: "Direct winner recording is disabled. Use POST /spin instead." },
      405,
    );
  });

  // DELETE /winners — Owner-only reset. Requires ED25519 session for 0.0.518487.
  app.delete(`${ROUTE_PREFIX}/winners`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) {
        return c.json({ error: "Rate limited" }, 429);
      }

      const ownerAuth = await requireOwner(c);
      if (ownerAuth instanceof Response) return ownerAuth;

      await kv.set(WINNERS_KEY, []);
      console.log(`[SECURITY] Winner history cleared by owner ${ownerAuth.accountId} from IP: ${ip}`);
      logAdminAction("spin_clear_winners", ownerAuth.accountId, ip);
      return c.json({ success: true, winners: [] });
    } catch (err) {
      console.error("[SPIN] Error clearing winners:", err);
      return c.json({ error: "Failed to clear winners" }, 500);
    }
  });

  // ── GET /spin/cooldown/:accountId — check remaining cooldown ────────
  app.get(`${ROUTE_PREFIX}/spin/cooldown/:accountId`, async (c) => {
    try {
      const accountId = c.req.param("accountId");
      if (!accountId || !isValidHederaAccountId(accountId)) {
        return c.json({ error: "Invalid accountId" }, 400);
      }
      const cdKey = COOLDOWN_PREFIX + accountId;
      const lastSpin: number | null = await kv.get(cdKey);
      const now = Date.now();
      if (!lastSpin || (now - lastSpin) >= SPIN_COOLDOWN_MS) {
        return c.json({ canSpin: true, cooldownMs: 0 });
      }
      return c.json({ canSpin: false, cooldownMs: SPIN_COOLDOWN_MS - (now - lastSpin) });
    } catch (err) {
      console.error("[SPIN] Error checking cooldown:", err);
      // Fail closed — if KV is down, deny spins to prevent cooldown bypass
      return c.json({ canSpin: false, cooldownMs: SPIN_COOLDOWN_MS, error: "Service temporarily unavailable" }, 503);
    }
  });

  // DELETE /spin/cooldown — Owner-only: clears spin cooldown for a specific account.
  // Requires ED25519 session for 0.0.518487.
  app.delete(`${ROUTE_PREFIX}/spin/cooldown`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) {
        return c.json({ error: "Rate limited" }, 429);
      }

      const ownerAuth = await requireOwner(c);
      if (ownerAuth instanceof Response) return ownerAuth;

      const accountId = c.req.query("accountId") || "";
      if (!accountId || !isValidHederaAccountId(accountId)) {
        return c.json({ error: "Valid accountId query param required (e.g. ?accountId=0.0.12345)" }, 400);
      }

      const cdKey = COOLDOWN_PREFIX + accountId;
      await kv.del(cdKey);
      console.log(`[SECURITY] Spin cooldown reset by owner for ${accountId} (IP: ${ip})`);
      logAdminAction("spin_reset_cooldown", ownerAuth.accountId, ip, `target=${accountId}`);
      return c.json({ success: true, accountId, message: "Spin cooldown cleared (owner)" });
    } catch (err) {
      console.error("[SPIN] Error resetting spin cooldown:", err);
      return c.json({ error: "Failed to reset cooldown" }, 500);
    }
  });
}
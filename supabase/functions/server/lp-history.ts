/**
 * LP History — V2 Liquidity Transaction Logging
 *
 * [LP-15] Step 15 of the V2 Liquidity Master Plan.
 *
 * Stores liquidity operation history in KV store for display in
 * V2PositionTracker's "Recent Activity" section. Each entry is keyed:
 *   lp:v2:{accountId}:{timestamp}
 *
 * Routes:
 *   POST /make-server-54299934/lp-history   → log a new operation
 *   GET  /make-server-54299934/lp-history   → fetch user's history
 */

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";

// ── Types ────────────────────────────────────────────────────────────

interface LpHistoryEntry {
  /** Operation type */
  action: "mint" | "increase" | "decrease" | "collect" | "burn";
  /** NFT serial number */
  tokenSN: number;
  /** Pool pair description */
  pool: string;
  /** Token amounts involved */
  amount0: string;
  amount1: string;
  token0Symbol: string;
  token1Symbol: string;
  /** USD value at time of operation */
  valueUsd?: number;
  /** Transaction hash from Hedera */
  txHash?: string;
  /** Hedera network */
  network: string;
  /** Timestamp (ISO) */
  timestamp: string;
  /** Operation status */
  status: "success" | "failed" | "pending";
  /** Error message if failed */
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const PREFIX = "/make-server-54299934";
const KV_PREFIX = "lp:v2:";
const MAX_HISTORY_PER_USER = 50;

// ── Route Registration ───────────────────────────────────────────────

export function registerLpHistoryRoutes(app: Hono) {

  // ── POST: Log a new LP operation ──────────────────────────────────
  app.post(`${PREFIX}/lp-history`, async (c) => {
    try {
      const body = await c.req.json() as {
        accountId: string;
        entry: LpHistoryEntry;
      };

      if (!body.accountId || !body.entry) {
        return c.json({ error: "Missing accountId or entry" }, 400);
      }

      const { accountId, entry } = body;

      // Validate required fields
      if (!entry.action || !entry.pool || entry.tokenSN == null) {
        return c.json({ error: "Entry missing required fields: action, pool, tokenSN" }, 400);
      }

      // Ensure timestamp
      if (!entry.timestamp) {
        entry.timestamp = new Date().toISOString();
      }

      // Build KV key: lp:v2:{accountId}:{timestamp_ms}
      const ts = Date.now();
      const key = `${KV_PREFIX}${accountId}:${ts}`;

      await kv.set(key, entry);

      console.log(`[LP-15] Logged LP operation: ${entry.action} for ${accountId}, pool=${entry.pool}, tokenSN=${entry.tokenSN}`);

      return c.json({ success: true, key });
    } catch (err: any) {
      console.log(`[LP-15] Error logging LP history: ${err?.message || err}`);
      return c.json({ error: `Failed to log LP operation: ${err?.message}` }, 500);
    }
  });

  // ── GET: Fetch user's LP history ──────────────────────────────────
  app.get(`${PREFIX}/lp-history`, async (c) => {
    try {
      const accountId = c.req.query("accountId");
      if (!accountId) {
        return c.json({ error: "Missing accountId query parameter" }, 400);
      }

      const prefix = `${KV_PREFIX}${accountId}:`;
      const entries = await kv.getByPrefix(prefix);

      // getByPrefix returns raw values directly (not {key, value} objects)
      // Sort by timestamp descending (most recent first)
      const sorted = (entries || [])
        .filter((e: any) => e && typeof e === "object" && e.timestamp)
        .sort((a: any, b: any) => {
          const tA = new Date(a.timestamp).getTime();
          const tB = new Date(b.timestamp).getTime();
          return tB - tA;
        })
        .slice(0, MAX_HISTORY_PER_USER);

      return c.json({ entries: sorted, count: sorted.length });
    } catch (err: any) {
      console.log(`[LP-15] Error fetching LP history: ${err?.message || err}`);
      return c.json({ error: `Failed to fetch LP history: ${err?.message}` }, 500);
    }
  });
}
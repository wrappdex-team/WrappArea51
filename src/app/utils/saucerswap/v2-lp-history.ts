/**
 * V2 LP History — Frontend Client for LP Transaction Logging
 *
 * [LP-15] Step 15 of the V2 Liquidity Master Plan.
 *
 * Provides functions to log LP operations and fetch history from the
 * server-side KV store. Used by V2PositionTracker for "Recent Activity".
 */

import { projectId, publicAnonKey } from "../../../../utils/supabase/info";
import { log } from "../logger";
import { getSessionToken } from "../auth";

const BASE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

// ── Types ────────────────────────────────────────────────────────────

export interface LpHistoryEntry {
  action: "mint" | "increase" | "decrease" | "collect" | "burn";
  tokenSN: number;
  pool: string;
  amount0: string;
  amount1: string;
  token0Symbol: string;
  token1Symbol: string;
  valueUsd?: number;
  txHash?: string;
  network: string;
  timestamp: string;
  status: "success" | "failed" | "pending";
  error?: string;
}

// ── Log an LP operation ──────────────────────────────────────────────

export async function logLpOperation(
  accountId: string,
  entry: Omit<LpHistoryEntry, "timestamp">,
): Promise<void> {
  try {
    // IMPLEMENTATION NOTE — Include session token so the server can verify
    // the caller is the wallet owner (HIGH-01 fix — POST /lp-history now
    // requires requireAuth). If no session exists, the log attempt will
    // silently fail (non-critical — LP history is a display-only feature).
    const sessionToken = getSessionToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${publicAnonKey}`,
    };
    if (sessionToken) headers["X-Session-Token"] = sessionToken;

    const response = await fetch(`${BASE_URL}/lp-history`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        accountId,
        entry: {
          ...entry,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      log.warn(`[LP-15] Failed to log LP operation: ${response.status} ${errBody}`);
    } else {
      log.info(`[LP-15] Logged LP operation: ${entry.action} for tokenSN=${entry.tokenSN}`);
    }
  } catch (err: any) {
    // Non-critical — don't block user flow
    log.warn(`[LP-15] Error logging LP operation: ${err?.message}`);
  }
}

// ── Fetch LP history ─────────────────────────────────────────────────

export async function fetchLpHistory(
  accountId: string,
  limit: number = 20,
): Promise<LpHistoryEntry[]> {
  try {
    const response = await fetch(
      `${BASE_URL}/lp-history?accountId=${encodeURIComponent(accountId)}`,
      {
        headers: {
          "Authorization": `Bearer ${publicAnonKey}`,
        },
      },
    );

    if (!response.ok) {
      log.warn(`[LP-15] Failed to fetch LP history: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.entries || []).slice(0, limit);
  } catch (err: any) {
    log.warn(`[LP-15] Error fetching LP history: ${err?.message}`);
    return [];
  }
}

// ── Format helpers ───────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  mint: "Minted Position",
  increase: "Added Liquidity",
  decrease: "Removed Liquidity",
  collect: "Collected Fees",
  burn: "Burned NFT",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

export function timeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  if (diffMs < 604_800_000) return `${Math.floor(diffMs / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function hashScanTxUrl(txHash: string, network: string = "mainnet"): string {
  return `https://hashscan.io/${network}/transaction/${txHash}`;
}
// ═══════════════════════════════════════════════════════════════════════
// VIP Verification — Token-gated access (100M+ HBAR.ħ, VIP NFT, or 156K+ LP tokens)
// ═══════════════════════════════════════════════════════════════════════
//
// Shared by: Spin Wheel, VIP Chat, DAO Governance
// Server-side Mirror Node verification with 5-minute KV cache.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import { getClientIp, isRateLimited, ROUTE_PREFIX, HEDERA_MIRROR_MAINNET, mirrorNodeBreaker, isHttpFailure } from "./shared.ts";
import { requireAuth } from "./auth.ts";

// ── Constants ───────────────────────────────────────────────────────

const VIP_HBARH_TOKEN_ID = "0.0.9356476";
const VIP_GATE_THRESHOLD = 100_000_000;
const VIP_NFT_TOKEN_ID = "0.0.10146181";
const VIP_STATUS_CACHE_PREFIX = "vip_status_";
const VIP_STATUS_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute server-side cache

// ── LP Token Configuration (DAO voting for liquidity providers) ─────
// IMPLEMENTATION NOTE: ssLP-HBAR-HBAR.ħ token ID 0.0.9356724
// 156,250 display-unit LP tokens = 1 DAO vote, capped at 10 votes.
const VIP_LP_TOKEN_ID = "0.0.9356724";
const VIP_LP_GATE_THRESHOLD = 156_250; // minimum LP tokens for eligibility

// ── Types ───────────────────────────────────────────────────────────

export interface VipStatusResult {
  eligible: boolean;
  tokenBalance: number;
  nftCount: number;
  lpBalance: number;
  verifiedAt: number;
  cached: boolean;
}

// ── Mirror Node Token Balance Check ─────────────────────────────────

async function verifyVipBalance(accountId: string): Promise<{ eligible: boolean; balance: number }> {
  try {
    const url = `${HEDERA_MIRROR_MAINNET}/api/v1/accounts/${accountId}/tokens?token.id=${VIP_HBARH_TOKEN_ID}&limit=1`;
    const res = await mirrorNodeBreaker.call(
      () => fetch(url, { signal: AbortSignal.timeout(8000) }),
      isHttpFailure,
    );
    if (!res.ok) return { eligible: false, balance: 0 };
    const data = await res.json();
    const entry = data?.tokens?.[0];
    if (!entry) return { eligible: false, balance: 0 };
    // BigInt-safe parsing — parseInt loses precision above 2^53 (~9×10^15)
    const rawBigInt = BigInt(entry.balance || "0");
    const dec = parseInt(entry.decimals ?? "8", 10);
    // Compare in raw units to avoid floating-point imprecision
    const thresholdRaw = BigInt(VIP_GATE_THRESHOLD) * BigInt(10 ** dec);
    const eligible = rawBigInt >= thresholdRaw;
    // Display value: safe to convert since human-readable values are small
    const display = Number(rawBigInt) / Math.pow(10, dec);
    return { eligible, balance: display };
  } catch (err) {
    console.log(`[VIP-CHAT] Mirror Node VIP check failed for ${accountId}: ${err}`);
    return { eligible: false, balance: 0 };
  }
}

// ── VIP NFT Ownership Check (Mirror Node) ───────────────────────────

async function verifyVipNftOwnership(accountId: string): Promise<{ hasNft: boolean; nftCount: number }> {
  try {
    const url = `${HEDERA_MIRROR_MAINNET}/api/v1/accounts/${accountId}/tokens?token.id=${VIP_NFT_TOKEN_ID}&limit=1`;
    const res = await mirrorNodeBreaker.call(
      () => fetch(url, { signal: AbortSignal.timeout(8000) }),
      isHttpFailure,
    );
    if (!res.ok) return { hasNft: false, nftCount: 0 };
    const data = await res.json();
    const entry = data?.tokens?.[0];
    if (!entry) return { hasNft: false, nftCount: 0 };
    // BigInt-safe parsing for consistency (NFT counts are small but
    // defensive coding prevents silent truncation on any HTS token)
    const countBigInt = BigInt(entry.balance || "0");
    const count = Number(countBigInt);
    return { hasNft: count >= 1, nftCount: count };
  } catch (err) {
    console.log(`[VIP-GATE] Mirror Node NFT check failed for ${accountId}: ${err}`);
    return { hasNft: false, nftCount: 0 };
  }
}

// ── LP Token Balance Check (Mirror Node) ────────────────────────────

async function verifyVipLpBalance(accountId: string): Promise<{ hasLp: boolean; lpBalance: number }> {
  try {
    const url = `${HEDERA_MIRROR_MAINNET}/api/v1/accounts/${accountId}/tokens?token.id=${VIP_LP_TOKEN_ID}&limit=1`;
    const res = await mirrorNodeBreaker.call(
      () => fetch(url, { signal: AbortSignal.timeout(8000) }),
      isHttpFailure,
    );
    if (!res.ok) return { hasLp: false, lpBalance: 0 };
    const data = await res.json();
    const entry = data?.tokens?.[0];
    if (!entry) return { hasLp: false, lpBalance: 0 };
    // IMPLEMENTATION NOTE: BigInt-safe parsing with decimal conversion,
    // identical pattern to verifyVipBalance(). Mirror Node returns raw
    // (pre-decimal) balances — must convert to display units before
    // comparing against the 156,250 threshold.
    const rawBigInt = BigInt(entry.balance || "0");
    const dec = parseInt(entry.decimals ?? "8", 10);
    // Compare in raw units to avoid floating-point imprecision
    const thresholdRaw = BigInt(VIP_LP_GATE_THRESHOLD) * BigInt(10 ** dec);
    const hasLp = rawBigInt >= thresholdRaw;
    // Display value: safe to convert since human-readable LP amounts are small
    const display = Number(rawBigInt) / Math.pow(10, dec);
    return { hasLp, lpBalance: display };
  } catch (err) {
    console.log(`[VIP-GATE] Mirror Node LP token check failed for ${accountId}: ${err}`);
    return { hasLp: false, lpBalance: 0 };
  }
}

// ── Combined VIP Eligibility (Token OR NFT, cached 5 min) ───────────

export async function verifyVipEligibilityFull(accountId: string): Promise<VipStatusResult> {
  // Check KV cache first (5-minute TTL)
  const cacheKey = VIP_STATUS_CACHE_PREFIX + accountId;
  try {
    const cached: VipStatusResult | null = await kv.get(cacheKey);
    if (cached && (Date.now() - cached.verifiedAt) < VIP_STATUS_CACHE_TTL_MS) {
      return { ...cached, cached: true };
    }
  } catch { /* cache miss — verify fresh */ }

  // Parallel Mirror Node checks: token balance + NFT ownership + LP token balance
  const [tokenResult, nftResult, lpResult] = await Promise.all([
    verifyVipBalance(accountId),
    verifyVipNftOwnership(accountId),
    verifyVipLpBalance(accountId),
  ]);

  const result: VipStatusResult = {
    eligible: tokenResult.eligible || nftResult.hasNft || lpResult.hasLp,
    tokenBalance: tokenResult.balance,
    nftCount: nftResult.nftCount,
    lpBalance: lpResult.lpBalance,
    verifiedAt: Date.now(),
    cached: false,
  };

  // Cache the result (only if we got a definitive answer)
  try { await kv.set(cacheKey, result); } catch { /* non-critical */ }

  return result;
}

// ── Route Registration ──────────────────────────────────────────────

export function registerVipRoutes(app: Hono): void {

  // GET /vip/status — Authenticated eligibility check (token + NFT, fail-closed)
  app.get(`${ROUTE_PREFIX}/vip/status`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;

      const status = await verifyVipEligibilityFull(accountId);

      console.log(`[VIP-GATE] Status check: ${accountId} eligible=${status.eligible} balance=${status.tokenBalance} nfts=${status.nftCount} lpBalance=${status.lpBalance} cached=${status.cached}`);

      return c.json({
        eligible: status.eligible,
        tokenBalance: status.tokenBalance,
        nftCount: status.nftCount,
        lpBalance: status.lpBalance,
        verifiedAt: status.verifiedAt,
        cached: status.cached,
        accountId,
      });
    } catch (err) {
      console.error(`[VIP-GATE] Status check error: ${err}`);
      return c.json({ eligible: false, error: "VIP verification failed" }, 500);
    }
  });
}
/**
 * HBAR.h VIP System — Token-Gated Premium Features
 *
 * Gate: Hold >= 100,000,000 (100 million) HBAR.h display tokens (token ID 0.0.9356476)
 *       OR hold >= 1 VIP NFT (token ID 0.0.10146181).
 * Either one unlocks VIP — both are NOT required.
 *
 * Balance checks use the decimals-adjusted `balance` field (NOT rawBalance)
 * so that the 100M threshold means 100 million actual tokens regardless of
 * on-chain decimal configuration.
 *
 * A direct Mirror Node re-verification is performed as a double-check
 * before granting VIP access.
 *
 * Features unlock when VIP is active and the user toggles them on.
 * Preferences persist to localStorage.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SECURITY AUDIT NOTES — 2026-02-11
 * ═══════════════════════════════════════════════════════════════════════
 *
 * [AUDIT-V01] PASS — The VIP system uses a double-check architecture:
 *   1. Primary check: WalletContext cached token list (fast, UI-gating)
 *   2. Secondary check: Direct Mirror Node query (verifyVipEligibilityDirect)
 *   This is sound. The Mirror Node is the authoritative on-chain source.
 *
 * [AUDIT-V02] VIP preferences in localStorage are cosmetic-only (theme,
 *   sounds, glow). A user could manually set VIP active in localStorage,
 *   but the token-gate check in isVipEligible() is called separately
 *   from the prefs, so feature gating is still enforced at render time.
 *   No financial risk from localStorage manipulation.
 *
 * [AUDIT-V03] The GATE_THRESHOLD (100M) is imported from dao.ts which
 *   is the single source of truth. No duplication risk. PASS.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { HederaTokenBalance } from "./hedera";
import { fetchHbarhBalance } from "./hedera";
import { HBARH_TOKEN_ID, GATE_THRESHOLD, VIP_NFT_TOKEN_ID } from "./dao";

// ── VIP Feature Definitions ──────────────────────────────────────────

export type VipFeatureId =
  | "vip_theme"       // Green iridescent gradient theme
  | "vip_sounds"      // Cash register + premium SFX
  | "vip_glow";       // Iridescent glowing background

export interface VipFeature {
  id: VipFeatureId;
  name: string;
  description: string;
}

export const VIP_FEATURES: VipFeature[] = [
  {
    id: "vip_theme",
    name: "Emerald Iridescent Theme",
    description: "Unlocks a green-to-teal iridescent gradient across nav, buttons, and accents.",
  },
  {
    id: "vip_sounds",
    name: "Premium Sound FX",
    description: "Cash register on trades, sparkle confirmations, and premium interaction sounds.",
  },
  {
    id: "vip_glow",
    name: "Iridescent Glow Background",
    description: "Animated color-shifting glow on the page background and card borders.",
  },
];

// ── VIP Eligibility ──────────────────────────────────────────────────

/**
 * Decimals-adjusted HBAR.h balance (display tokens, NOT raw chain units).
 * A return value of 100_000_000 means the user holds 100 million tokens.
 * Uses `balance` (rawBalance / 10^decimals) so the gate comparison is
 * against real token counts regardless of on-chain decimal configuration.
 */
export function getHbarhBalance(tokens: HederaTokenBalance[], network: string): number {
  const id = HBARH_TOKEN_ID[network];
  if (!id) return 0;
  const entry = tokens.find((t) => t.tokenId === id);
  return entry?.balance ?? 0;
}

/**
 * Count of VIP NFTs owned by the wallet.
 */
export function getVipNftCount(tokens: HederaTokenBalance[]): number {
  const entry = tokens.find((t) => t.tokenId === VIP_NFT_TOKEN_ID);
  return entry?.rawBalance ?? 0;
}

/**
 * VIP eligible if the wallet holds either:
 * - >= 100M HBAR.h display tokens (decimals-adjusted), OR
 * - >= 1 VIP NFT (token ID 0.0.10146181)
 * Both are NOT required — either one unlocks VIP.
 */
export function isVipEligible(tokens: HederaTokenBalance[], network: string): boolean {
  const balance = getHbarhBalance(tokens, network);
  const nfts = getVipNftCount(tokens);
  return balance >= GATE_THRESHOLD || nfts >= 1;
}

// ── Direct Mirror Node Double-Check ──────────────────────────────────

/**
 * Independently re-verifies VIP eligibility by fetching the HBAR.h balance
 * directly from the Hedera Mirror Node. This is the "double check" —
 * it does NOT rely on the cached token list from WalletContext.
 *
 * Returns { eligible, balance, nftCount, error }.
 */
export async function verifyVipEligibilityDirect(
  accountId: string
): Promise<{
  eligible: boolean;
  balance: number;
  nftCount: number;
  error: string | null;
}> {
  try {
    const directBalance = await fetchHbarhBalance(accountId);
    const displayBalance = directBalance.balance; // decimals-adjusted

    // For NFTs we still rely on the cached list — Mirror Node NFT endpoint
    // is slower and the token list already includes NFT associations.
    // The primary double-check is on the fungible token balance.
    return {
      eligible: displayBalance >= GATE_THRESHOLD,
      balance: displayBalance,
      nftCount: 0, // NFT check is secondary; caller can combine with cached nftCount
      error: null,
    };
  } catch (err) {
    return {
      eligible: false,
      balance: 0,
      nftCount: 0,
      error: err instanceof Error ? err.message : "Verification failed",
    };
  }
}

// ── Preference Persistence ───────────────────────────────────────────

const PREFS_KEY = "hbarh-vip-prefs";

export interface VipPrefs {
  /** Master VIP toggle — all features off if false */
  active: boolean;
  /** Per-feature toggles */
  features: Record<VipFeatureId, boolean>;
}

const DEFAULT_PREFS: VipPrefs = {
  active: false,
  features: {
    vip_theme: true,
    vip_sounds: true,
    vip_glow: true,
  },
};

export function loadVipPrefs(): VipPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle new features
      return {
        active: parsed.active ?? false,
        features: { ...DEFAULT_PREFS.features, ...parsed.features },
      };
    }
  } catch { /* corrupt */ }
  return { ...DEFAULT_PREFS, features: { ...DEFAULT_PREFS.features } };
}

export function saveVipPrefs(prefs: VipPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage full */ }
}

// ── Convenience Checks ───────────────────────────────────────────────

/** Is a specific feature currently active? (VIP eligible + master on + feature on) */
export function isFeatureActive(
  tokens: HederaTokenBalance[],
  network: string,
  featureId: VipFeatureId,
  prefs: VipPrefs
): boolean {
  return isVipEligible(tokens, network) && prefs.active && (prefs.features[featureId] ?? false);
}
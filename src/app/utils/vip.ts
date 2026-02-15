/**
 * HBAR.h VIP System — Token-Gated Premium Features
 *
 * Gate: Hold >= 100M HBAR.h display tokens (0.0.9356476) OR >= 1 VIP NFT (0.0.10146181).
 * Either one unlocks VIP — both are NOT required.
 *
 * Architecture: Double-check — WalletContext cached list (fast) + direct Mirror Node
 * re-verification (authoritative). VIP prefs in localStorage are cosmetic-only.
 * GATE_THRESHOLD imported from dao.ts (single source of truth).
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

/**
 * Lightweight keyed integrity hash (FNV-1a 64-bit, split into two 32-bit lanes).
 * Not a cryptographic HMAC — purely tamper-detection for casual localStorage edits.
 * The account ID binds the signature to the specific wallet, so prefs copied from
 * another session or manually crafted in devtools will fail verification.
 */
const VIP_SIG_PEPPER = "hbarh:9356476:vip-integrity";

function computeVipSig(payload: string, accountId: string): string {
  const input = `${VIP_SIG_PEPPER}:${accountId}:${payload}`;
  let h1 = 0x811c9dc5; // FNV offset basis
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193); // FNV prime
    h2 ^= c ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

export interface VipPrefs {
  /** Master VIP toggle — all features off if false */
  active: boolean;
  /** Per-feature toggles */
  features: Record<VipFeatureId, boolean>;
}

/** Stored shape — extends VipPrefs with integrity fields (stripped on read) */
interface StoredVipPrefs extends VipPrefs {
  _acct?: string;
  _sig?: string;
}

const DEFAULT_PREFS: VipPrefs = {
  active: false,
  features: {
    vip_theme: true,
    vip_sounds: true,
    vip_glow: true,
  },
};

/**
 * Load VIP preferences from localStorage.
 * When `accountId` is provided and stored data carries a signature, verifies
 * integrity — a mismatch (manual edit / cross-session copy) returns defaults
 * with `active: false`, silently neutralising the tampered data.
 */
export function loadVipPrefs(accountId?: string): VipPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed: StoredVipPrefs = JSON.parse(raw);

      // ── Integrity gate ────────────────────────────────────────
      if (accountId && parsed._sig) {
        // Re-derive payload (prefs-only, no meta fields) and verify
        const canonical: VipPrefs = {
          active: parsed.active ?? false,
          features: { ...DEFAULT_PREFS.features, ...parsed.features },
        };
        const expected = computeVipSig(JSON.stringify(canonical), accountId);
        if (parsed._acct !== accountId || parsed._sig !== expected) {
          // Tampered or copied from another wallet — silently reset
          return { ...DEFAULT_PREFS, features: { ...DEFAULT_PREFS.features } };
        }
      }

      // Merge with defaults to handle new features added post-save
      return {
        active: parsed.active ?? false,
        features: { ...DEFAULT_PREFS.features, ...parsed.features },
      };
    }
  } catch { /* corrupt */ }
  return { ...DEFAULT_PREFS, features: { ...DEFAULT_PREFS.features } };
}

/**
 * Persist VIP preferences to localStorage.
 * When `accountId` is provided, a keyed integrity signature is embedded so
 * `loadVipPrefs(accountId)` can detect casual tampering on next read.
 */
export function saveVipPrefs(prefs: VipPrefs, accountId?: string): void {
  try {
    const canonical: VipPrefs = {
      active: prefs.active,
      features: { ...prefs.features },
    };
    const stored: StoredVipPrefs = { ...canonical };
    if (accountId) {
      stored._acct = accountId;
      stored._sig = computeVipSig(JSON.stringify(canonical), accountId);
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify(stored));
    // Defer the custom event so it never fires inside a React state updater
    // (synchronous dispatch inside setPrefs() would violate the
    //  "don't setState in another component during render" rule).
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("vip-prefs-changed", { detail: prefs }));
    });
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
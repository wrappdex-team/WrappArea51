/**
 * HBAR.ħ DAO — Server-Authoritative Governance Client
 *
 * [AUDIT-D01] REMEDIATED — All proposals, votes, and comments are now
 * stored server-side in KV with ED25519 session authentication.
 *
 * Eligibility: >= 100M HBAR.ħ tokens OR 1+ VIP NFT (Mirror Node verified SERVER-SIDE).
 * Power:       1 vote per 100M tokens (max 10) + 1 per 3 NFTs (max 1) = max 11.
 * Admin:       0.0.518487 — full proposal CRUD (verified server-side via session).
 *
 * Security Properties:
 *   [DAO-01] Proposals stored in server KV — cannot be manipulated via DevTools
 *   [DAO-02] Admin-only proposal CRUD verified server-side (session accountId)
 *   [DAO-03] Vote weight calculated SERVER-SIDE from Mirror Node balance
 *   [DAO-04] Vote deduplication enforced SERVER-SIDE via voterLog
 *   [DAO-05] Comments require authenticated session + eligibility check
 */

import type { HederaTokenBalance } from "./hedera";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { getSessionToken, authHeaders, authenticate, clearSession } from "./auth";

// ── API Base ────────────────────────────────────────────────────────

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

const publicHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${publicAnonKey}`,
};

// ── DAO Admin Configuration ──────────────────────────────────────────

export const DAO_FOUNDER_ACCOUNT = "0.0.518487";

/**
 * Client-side admin check. Uses the cached admin list when available,
 * falls back to founder-only check. Authoritative check is always server-side.
 */
let _adminListCache: string[] = [DAO_FOUNDER_ACCOUNT];

export function isDAOAdmin(accountId: string): boolean {
  return _adminListCache.includes(accountId);
}

/** Update the client-side admin cache (called after fetchDaoAdmins) */
export function setAdminListCache(admins: string[]): void {
  _adminListCache = admins.length > 0 ? admins : [DAO_FOUNDER_ACCOUNT];
}

// ── HBAR.ħ Protocol Token Configuration ──────────────────────────────

export const HBARH_TOKEN_ID: Record<string, string> = {
  testnet: "0.0.9356476",
  mainnet: "0.0.9356476",
};

export const HBARH_DECIMALS = 8;
export const GATE_THRESHOLD = 100_000_000;
export const TOKENS_PER_VOTE = 100_000_000;

// ── VIP NFT Configuration ────────────────────────────────────────────

export const VIP_NFT_TOKEN_ID = "0.0.10146181";
export const NFTS_PER_VOTE = 3;
export const MAX_TOKEN_VOTES = 10;
export const MAX_NFT_VOTES = 1;

// ── Balance & Voting Power (client-side for UI display) ─────────────
// NOTE: These are used for fast UI rendering. Authoritative voting power
// is ALWAYS calculated server-side from Mirror Node data.

export function findWrappBalance(
  tokens: HederaTokenBalance[],
  network: string
): HederaTokenBalance | null {
  const id = HBARH_TOKEN_ID[network];
  if (!id) return null;
  return tokens.find((t) => t.tokenId === id) ?? null;
}

export function getWrappBalance(
  tokens: HederaTokenBalance[],
  network: string
): number {
  const entry = findWrappBalance(tokens, network);
  if (!entry) return 0;
  return entry.balance;
}

export function getNftCount(tokens: HederaTokenBalance[]): number {
  const entry = tokens.find((t) => t.tokenId === VIP_NFT_TOKEN_ID);
  return entry?.rawBalance ?? 0;
}

export function isEligible(tokens: HederaTokenBalance[], network: string): boolean {
  return getWrappBalance(tokens, network) >= GATE_THRESHOLD || getNftCount(tokens) >= 1;
}

export function maxVotesForBalance(tokens: HederaTokenBalance[], network: string): number {
  const balance = getWrappBalance(tokens, network);
  const tokenVotes = Math.min(Math.floor(balance / TOKENS_PER_VOTE), MAX_TOKEN_VOTES);
  const nftVotes = Math.min(Math.floor(getNftCount(tokens) / NFTS_PER_VOTE), MAX_NFT_VOTES);
  return tokenVotes + nftVotes;
}

// ── Comment Type ─────────────────────────────────────────────────────

export interface ProposalComment {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

// ── Proposal Types ───────────────────────────────────────────────────

export type ProposalStatus = "active" | "passed" | "rejected" | "pending";
export type ProposalCategory =
  | "Fees"
  | "Staking"
  | "Listing"
  | "Tokenomics"
  | "Features"
  | "Partnership"
  | "Governance"
  | "Other";

export interface Proposal {
  id: string;
  title: string;
  description: string;
  category: ProposalCategory;
  proposer: string;
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  quorum: number;
  createdAt: number;
  endsAt: number;
  voterLog: Record<string, { direction: "for" | "against"; weight: number }>;
  comments: ProposalComment[];
}

// ── Helper: ensure session for mutating operations ──────────────────

async function ensureAuth(accountId: string): Promise<string> {
  const existing = getSessionToken();
  if (existing) return existing;
  return await authenticate(accountId);
}

// ── Server API Functions ────────────────────────────────────────────
// All CRUD operations go through the server. No localStorage.

/**
 * Load all proposals from the server.
 * Public endpoint — no auth required.
 */
export async function loadProposals(): Promise<Proposal[]> {
  try {
    const res = await fetch(`${API_BASE}/dao/proposals`, {
      headers: publicHeaders,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[DAO] Failed to load proposals: ${data.error || res.status}`);
      return [];
    }
    return (data.proposals ?? []) as Proposal[];
  } catch (err) {
    console.error("[DAO] Error loading proposals:", err);
    return [];
  }
}

/**
 * Create a new proposal. Admin-only (server-enforced).
 * Returns the updated proposals list from the server.
 */
export async function createProposal(
  accountId: string,
  title: string,
  description: string,
  category: ProposalCategory,
  durationDays: number,
  quorum: number
): Promise<{ proposals: Proposal[]; error?: string }> {
  try {
    const token = await ensureAuth(accountId);
    const res = await fetch(`${API_BASE}/dao/proposals`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ title, description, category, durationDays, quorum }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[DAO] Create proposal failed: ${data.error}`);
      return { proposals: [], error: data.error || "Failed to create proposal" };
    }
    return { proposals: data.proposals as Proposal[] };
  } catch (err: any) {
    console.error("[DAO] Error creating proposal:", err);
    return { proposals: [], error: err?.message || "Network error" };
  }
}

/**
 * Edit a proposal. Admin or proposer (server-enforced).
 */
export async function editProposal(
  accountId: string,
  proposalId: string,
  updates: { title?: string; description?: string; category?: ProposalCategory }
): Promise<{ proposals: Proposal[]; error?: string }> {
  try {
    const token = await ensureAuth(accountId);
    const res = await fetch(`${API_BASE}/dao/proposals/${proposalId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(updates),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[DAO] Edit proposal failed: ${data.error}`);
      return { proposals: [], error: data.error || "Failed to edit proposal" };
    }
    return { proposals: data.proposals as Proposal[] };
  } catch (err: any) {
    console.error("[DAO] Error editing proposal:", err);
    return { proposals: [], error: err?.message || "Network error" };
  }
}

/**
 * Delete a proposal. Admin or proposer (server-enforced).
 */
export async function deleteProposal(
  accountId: string,
  proposalId: string
): Promise<{ proposals: Proposal[]; error?: string }> {
  try {
    const token = await ensureAuth(accountId);
    const res = await fetch(`${API_BASE}/dao/proposals/${proposalId}`, {
      method: "DELETE",
      headers: authHeaders(token),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[DAO] Delete proposal failed: ${data.error}`);
      return { proposals: [], error: data.error || "Failed to delete proposal" };
    }
    return { proposals: data.proposals as Proposal[] };
  } catch (err: any) {
    console.error("[DAO] Error deleting proposal:", err);
    return { proposals: [], error: err?.message || "Network error" };
  }
}

/**
 * Cast a vote on a proposal. Authenticated + eligible (server-enforced).
 * Vote weight is calculated SERVER-SIDE from Mirror Node balance.
 */
export async function castVote(
  accountId: string,
  proposalId: string,
  direction: "for" | "against"
): Promise<{ success: boolean; proposal?: Proposal; votingPower?: number; error?: string }> {
  try {
    const token = await ensureAuth(accountId);
    const res = await fetch(`${API_BASE}/dao/proposals/${proposalId}/vote`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ direction }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[DAO] Vote failed: ${data.error}`);
      return { success: false, error: data.error || "Failed to cast vote" };
    }
    return {
      success: true,
      proposal: data.proposal as Proposal,
      votingPower: data.votingPower,
    };
  } catch (err: any) {
    console.error("[DAO] Error casting vote:", err);
    return { success: false, error: err?.message || "Network error" };
  }
}

/**
 * Add a comment to a proposal. Authenticated + eligible (server-enforced).
 */
export async function addComment(
  accountId: string,
  proposalId: string,
  text: string
): Promise<{ success: boolean; proposal?: Proposal; error?: string }> {
  try {
    const token = await ensureAuth(accountId);
    const res = await fetch(`${API_BASE}/dao/proposals/${proposalId}/comment`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[DAO] Comment failed: ${data.error}`);
      return { success: false, error: data.error || "Failed to add comment" };
    }
    return { success: true, proposal: data.proposal as Proposal };
  } catch (err: any) {
    console.error("[DAO] Error adding comment:", err);
    return { success: false, error: err?.message || "Network error" };
  }
}

/**
 * Check if a proposal can be modified by the given account.
 * Client-side helper for UI rendering — server enforces the real check.
 */
export function canModifyProposal(proposal: Proposal, accountId: string): boolean {
  if (proposal.status !== "active" && proposal.status !== "pending") return false;
  if (isDAOAdmin(accountId)) return true;
  if (proposal.proposer === accountId && Object.keys(proposal.voterLog).length === 0) return true;
  return false;
}

// ── Formatting Helpers ───────────────────────────────────────────────

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function timeRemaining(endsAt: number): string {
  const diff = endsAt - Date.now();
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h remaining`;
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m remaining`;
}

export function formatCommentTime(createdAt: number): string {
  const diff = Date.now() - createdAt;
  const mins = Math.floor(diff / 60_000);
  const hrs = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(createdAt).toLocaleDateString();
}

// ── Admin Management API ────────────────────────────────────────────
// [DAO-08] Dynamic admin list — only existing admins can add/remove.
// [DAO-10] Add/remove require a FRESH wallet signature (re-sign flow).

/**
 * Fetch the current admin list from the server.
 * PASSIVE: Only uses an existing session — never triggers a wallet signing prompt.
 * If no session exists, returns the client-side cache (founder-only by default).
 * Admin status is fully discovered once the user authenticates for their first
 * mutating action (vote, create proposal, etc.), which is the correct UX flow.
 * Also updates the client-side admin cache when a valid session is available.
 */
export async function fetchDaoAdmins(
  accountId: string
): Promise<{ admins: string[]; founder: string; maxAdmins: number; error?: string }> {
  const defaultResult = { admins: [..._adminListCache], founder: DAO_FOUNDER_ACCOUNT, maxAdmins: 10 };
  try {
    // Passive check — only use existing session, never trigger wallet signing
    const token = getSessionToken();
    if (!token) {
      // No active session — skip server call, rely on client cache.
      // User will authenticate naturally on their first action.
      return { ...defaultResult, error: "no_session" };
    }
    const res = await fetch(`${API_BASE}/dao/admins`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ...defaultResult, error: data.error };
    }
    // Update client-side cache
    setAdminListCache(data.admins);
    return { admins: data.admins, founder: data.founder, maxAdmins: data.maxAdmins };
  } catch (err: any) {
    console.error("[DAO] Error fetching admin list:", err);
    return { ...defaultResult, error: err?.message };
  }
}

/**
 * Add a new DAO admin. Requires:
 * 1. Caller is already an admin (server-verified from session)
 * 2. A FRESH wallet signature (session <2 min old)
 *
 * The caller must use forceReauthenticate() first to get a fresh session,
 * which triggers a new HashPack signing prompt as confirmation.
 */
export async function addDaoAdmin(
  accountId: string,
  newAdminAccountId: string
): Promise<{ admins: string[]; error?: string }> {
  try {
    const token = getSessionToken();
    if (!token) {
      return { admins: [], error: "No session — please re-sign in wallet first" };
    }
    const res = await fetch(`${API_BASE}/dao/admins`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ newAdminAccountId }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      return { admins: data.admins || [], error: data.error || "Failed to add admin" };
    }
    setAdminListCache(data.admins);
    return { admins: data.admins };
  } catch (err: any) {
    console.error("[DAO] Error adding admin:", err);
    return { admins: [], error: err?.message || "Network error" };
  }
}

/**
 * Remove a DAO admin. Same fresh-session requirement as add.
 * Founder (0.0.518487) can never be removed (server-enforced).
 */
export async function removeDaoAdmin(
  accountId: string,
  targetAccountId: string
): Promise<{ admins: string[]; error?: string }> {
  try {
    const token = getSessionToken();
    if (!token) {
      return { admins: [], error: "No session — please re-sign in wallet first" };
    }
    const res = await fetch(`${API_BASE}/dao/admins/${targetAccountId}`, {
      method: "DELETE",
      headers: authHeaders(token),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      return { admins: data.admins || [], error: data.error || "Failed to remove admin" };
    }
    setAdminListCache(data.admins);
    return { admins: data.admins };
  } catch (err: any) {
    console.error("[DAO] Error removing admin:", err);
    return { admins: [], error: err?.message || "Network error" };
  }
}

/**
 * Force a fresh wallet re-authentication.
 * Clears the existing session, then triggers a new ED25519 challenge-response
 * cycle requiring the user to sign in their HashPack wallet.
 * Returns the fresh session token (< 2 min old, satisfying server freshness check).
 */
export async function forceReauthenticate(accountId: string): Promise<string> {
  clearSession();
  return await authenticate(accountId);
}
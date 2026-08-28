/**
 * HBAR.ħ DAO — Server-Authoritative Governance Client
 *
 * All state in server KV. Auth via ED25519 challenge-response sessions
 * (security review SEC-02 — spoofable X-Account-Id header fallback removed from
 * server's requireAuth). Users must sign a wallet challenge before
 * performing any authenticated action (vote, comment, create proposal).
 * OWNER-ONLY operations (admin add/remove) require ED25519 session tokens
 * (security review SEC-01 — X-Account-Id fallback removed from requireOwner).
 * Eligibility: ≥100M HBAR.ħ tokens OR 1+ VIP NFT OR ≥156,250 ssLP-HBAR-HBAR.ħ
 *              (Mirror Node verified server-side).
 * Vote weight: 1 per 100M HBAR.ħ (max 10) + 1 per 3 NFTs (max 1)
 *            + 1 per 156,250 LP tokens (max 10) = max 21.
 * Admin CRUD restricted to 0.0.518487 + dynamic admin list.
 */

import type { HederaTokenBalance } from "./hedera";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { log } from "./logger";
import { ENV } from "./env";
import { getSessionToken, authHeaders } from "./auth";

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
  testnet: ENV.DAO_HBARH_TOKEN_ID,
  mainnet: ENV.DAO_HBARH_TOKEN_ID,
};

export const HBARH_DECIMALS = 8;
export const GATE_THRESHOLD = 100_000_000;
export const TOKENS_PER_VOTE = 100_000_000;

// ── VIP NFT Configuration ────────────────────────────────────────────

export const VIP_NFT_TOKEN_ID = ENV.DAO_NFT_TOKEN_ID;
export const NFTS_PER_VOTE = 3;
export const MAX_TOKEN_VOTES = 10;
export const MAX_NFT_VOTES = 1;

// ── LP Token Configuration ────────────────────────────────────────────
// IMPLEMENTATION NOTE: ssLP-HBAR-HBAR.ħ liquidity pool token.
// Provides DAO voting rights to liquidity providers.
// 156,250 LP tokens (display units) = 1 vote, capped at 10 votes (1,562,500).

export const LP_TOKEN_ID = "0.0.9356724";
export const LP_TOKENS_PER_VOTE = 156_250;
export const MAX_LP_VOTES = 10;

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

export function getLpTokenCount(tokens: HederaTokenBalance[]): number {
  const entry = tokens.find((t) => t.tokenId === LP_TOKEN_ID);
  // IMPLEMENTATION NOTE: Uses display-unit balance (post-decimal adjustment),
  // consistent with how HBAR.ħ thresholds use getWrappBalance().
  // 156,250 display units = 1 vote.
  return entry?.balance ?? 0;
}

export function isEligible(tokens: HederaTokenBalance[], network: string): boolean {
  return getWrappBalance(tokens, network) >= GATE_THRESHOLD || getNftCount(tokens) >= 1 || getLpTokenCount(tokens) >= LP_TOKENS_PER_VOTE;
}

export function maxVotesForBalance(tokens: HederaTokenBalance[], network: string): number {
  const balance = getWrappBalance(tokens, network);
  const tokenVotes = Math.min(Math.floor(balance / TOKENS_PER_VOTE), MAX_TOKEN_VOTES);
  const nftVotes = Math.min(Math.floor(getNftCount(tokens) / NFTS_PER_VOTE), MAX_NFT_VOTES);
  const lpVotes = Math.min(Math.floor(getLpTokenCount(tokens) / LP_TOKENS_PER_VOTE), MAX_LP_VOTES);
  return tokenVotes + nftVotes + lpVotes;
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

export type IdeaStatus = "open" | "promoted";
export interface DaoIdea {
  id: string;
  title: string;
  description: string;
  category: ProposalCategory;
  author: string;
  createdAt: number;
  status: IdeaStatus;
  proposalId?: string;
}

// ── Helper: build authenticated headers for DAO endpoints ────────────
// SEC-02: All authenticated endpoints require ED25519 session token
// (X-Session-Token). No header-based identity fallback.
//
// Without an active session, base headers are returned — the server
// responds 401 AUTH_REQUIRED, surfaced as an actionable user error.
//
// The accountId parameter is retained for call-site compatibility.
// Identity is bound to the KV-backed session token, not a client header.

function walletHeaders(_accountId: string): Record<string, string> {
  const sessionToken = getSessionToken();
  if (sessionToken) {
    return authHeaders(sessionToken);
  }
  // No active session — server will reject with 401 AUTH_REQUIRED.
  // Callers surface the server error to the user (e.g., "Sign in first").
  log.warn("DAO", "No active ED25519 session — server will reject this request. User must authenticate() first.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${publicAnonKey}`,
  };
}

// ── Server API Functions ────────────────────────────────────────────
// All CRUD operations go through the server. No localStorage.

// Dedup/throttle layer: prevents duplicate network requests from React
// strict-mode double-mount and rapid re-renders. Returns cached result
// if a request was fulfilled within the last 5 seconds.
let _proposalsCache: { data: Proposal[]; ts: number } | null = null;
let _proposalsInflight: Promise<Proposal[]> | null = null;
const PROPOSALS_CACHE_TTL_MS = 5_000;

/**
 * Load all proposals from the server.
 * Public endpoint — no auth required.
 * Deduped: concurrent/rapid calls share a single fetch + 5s cache.
 */
export async function loadProposals(): Promise<Proposal[]> {
  // Return cached if fresh
  if (_proposalsCache && Date.now() - _proposalsCache.ts < PROPOSALS_CACHE_TTL_MS) {
    return _proposalsCache.data;
  }
  // Coalesce concurrent calls into one in-flight request
  if (_proposalsInflight) return _proposalsInflight;

  _proposalsInflight = _fetchProposals();
  try {
    const result = await _proposalsInflight;
    _proposalsCache = { data: result, ts: Date.now() };
    return result;
  } finally {
    _proposalsInflight = null;
  }
}

/** Invalidate the proposals cache (call after create/edit/delete). */
export function invalidateProposalsCache(): void {
  _proposalsCache = null;
}

async function _fetchProposals(): Promise<Proposal[]> {
  try {
    const res = await fetch(`${API_BASE}/dao/proposals`, {
      headers: publicHeaders,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `Failed to load proposals: ${data.error || res.status}`);
      return _proposalsCache?.data ?? [];
    }
    return (data.proposals ?? []) as Proposal[];
  } catch (err) {
    log.error("DAO", "Error loading proposals", err);
    return _proposalsCache?.data ?? [];
  }
}

/**
 * Create a new proposal. Admin-only (server-enforced). Eligible members post ideas instead.
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
    const res = await fetch(`${API_BASE}/dao/proposals`, {
      method: "POST",
      headers: walletHeaders(accountId),
      body: JSON.stringify({ title, description, category, durationDays, quorum }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `Create proposal failed: ${data.error}`);
      return { proposals: [], error: data.error || "Failed to create proposal" };
    }
    invalidateProposalsCache();
    return { proposals: data.proposals as Proposal[] };
  } catch (err: any) {
    log.error("DAO", "Error creating proposal", err);
    return { proposals: [], error: err?.message || "Network error" };
  }
}

/**
 * Edit a proposal. Admin or proposer (server-enforced).
 */

export async function loadIdeas(): Promise<DaoIdea[]> {
  try {
    const res = await fetch(`${API_BASE}/dao/ideas`, {
      headers: publicHeaders,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `Failed to load ideas: ${data.error || res.status}`);
      return [];
    }
    return (data.ideas ?? []) as DaoIdea[];
  } catch (err) {
    log.error("DAO", "Error loading ideas", err);
    return [];
  }
}

export async function postIdea(
  accountId: string,
  title: string,
  description: string,
  category: ProposalCategory,
): Promise<{ ideas: DaoIdea[]; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/dao/ideas`, {
      method: "POST",
      headers: walletHeaders(accountId),
      body: JSON.stringify({ title, description, category }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `Post idea failed: ${data.error}`);
      return { ideas: [], error: data.error || "Failed to post idea" };
    }
    return { ideas: data.ideas as DaoIdea[] };
  } catch (err: any) {
    log.error("DAO", "Error posting idea", err);
    return { ideas: [], error: err?.message || "Network error" };
  }
}

export async function promoteIdea(
  accountId: string,
  ideaId: string,
  durationDays = 7,
  quorum = 10,
): Promise<{ proposals: Proposal[]; ideas: DaoIdea[]; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/dao/ideas/${ideaId}/promote`, {
      method: "POST",
      headers: walletHeaders(accountId),
      body: JSON.stringify({ durationDays, quorum }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `Promote idea failed: ${data.error}`);
      return { proposals: [], ideas: [], error: data.error || "Failed to promote idea" };
    }
    invalidateProposalsCache();
    return { proposals: data.proposals as Proposal[], ideas: data.ideas as DaoIdea[] };
  } catch (err: any) {
    log.error("DAO", "Error promoting idea", err);
    return { proposals: [], ideas: [], error: err?.message || "Network error" };
  }
}

export async function editProposal(
  accountId: string,
  proposalId: string,
  updates: { title?: string; description?: string; category?: ProposalCategory }
): Promise<{ proposals: Proposal[]; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/dao/proposals/${proposalId}`, {
      method: "PUT",
      headers: walletHeaders(accountId),
      body: JSON.stringify(updates),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `Edit proposal failed: ${data.error}`);
      return { proposals: [], error: data.error || "Failed to edit proposal" };
    }
    invalidateProposalsCache();
    return { proposals: data.proposals as Proposal[] };
  } catch (err: any) {
    log.error("DAO", "Error editing proposal", err);
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
    const res = await fetch(`${API_BASE}/dao/proposals/${proposalId}`, {
      method: "DELETE",
      headers: walletHeaders(accountId),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `Delete proposal failed: ${data.error}`);
      return { proposals: [], error: data.error || "Failed to delete proposal" };
    }
    invalidateProposalsCache();
    return { proposals: data.proposals as Proposal[] };
  } catch (err: any) {
    log.error("DAO", "Error deleting proposal", err);
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
    const res = await fetch(`${API_BASE}/dao/proposals/${proposalId}/vote`, {
      method: "POST",
      headers: walletHeaders(accountId),
      body: JSON.stringify({ direction }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `Vote failed: ${data.error}`);
      return { success: false, error: data.error || "Failed to cast vote" };
    }
    return {
      success: true,
      proposal: data.proposal as Proposal,
      votingPower: data.votingPower,
    };
  } catch (err: any) {
    log.error("DAO", "Error casting vote", err);
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
    const res = await fetch(`${API_BASE}/dao/proposals/${proposalId}/comment`, {
      method: "POST",
      headers: walletHeaders(accountId),
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `Comment failed: ${data.error}`);
      return { success: false, error: data.error || "Failed to add comment" };
    }
    return { success: true, proposal: data.proposal as Proposal };
  } catch (err: any) {
    log.error("DAO", "Error adding comment", err);
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

/**
 * Fetch the current admin list from the server.
 * Requires ED25519 session token (security review SEC-02 — X-Account-Id removed).
 * If no session exists, falls back to client-side cache silently.
 * Server checks if the requesting account is itself an admin before returning the list.
 * Also updates the client-side admin cache on success.
 */
export async function fetchDaoAdmins(
  accountId: string
): Promise<{ admins: string[]; founder: string; maxAdmins: number; error?: string }> {
  const defaultResult = { admins: [..._adminListCache], founder: DAO_FOUNDER_ACCOUNT, maxAdmins: 10 };
  if (!accountId) {
    return { ...defaultResult, error: "no_account" };
  }
  try {
    const res = await fetch(`${API_BASE}/dao/admins`, {
      headers: walletHeaders(accountId),
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
    log.error("DAO", "Error fetching admin list", err);
    return { ...defaultResult, error: err?.message };
  }
}

/**
 * Add a new DAO admin. OWNER-ONLY (0.0.518487).
 * Requires an active ED25519 session — the owner must have signed a
 * challenge message in their wallet before calling this. The server's
 * requireOwner() ONLY accepts cryptographic session tokens (security review SEC-01).
 */
export async function addDaoAdmin(
  accountId: string,
  newAdminAccountId: string,
): Promise<{ admins: string[]; error?: string; code?: string }> {
  try {
    const sessionToken = getSessionToken();
    if (!sessionToken) {
      return { admins: [], error: "ED25519 session required — sign in as owner first", code: "AUTH_REQUIRED" };
    }
    log.info("DAO", `addDaoAdmin: POST /dao/admins for ${newAdminAccountId} (owner=${accountId})`);
    const res = await fetch(`${API_BASE}/dao/admins`, {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify({ newAdminAccountId }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `addDaoAdmin failed: HTTP ${res.status} code=${data.code} error=${data.error}`);
      return { admins: data.admins || [], error: data.error || "Failed to add admin", code: data.code };
    }
    log.info("DAO", `addDaoAdmin success: ${data.admins?.length} admins`);
    setAdminListCache(data.admins);
    return { admins: data.admins };
  } catch (err: any) {
    log.error("DAO", "Error adding admin", err);
    return { admins: [], error: err?.message || "Network error", code: "NETWORK_ERROR" };
  }
}

/**
 * Remove a DAO admin. OWNER-ONLY (0.0.518487).
 * Requires an active ED25519 session — the owner must have signed a
 * challenge message in their wallet before calling this. The server's
 * requireOwner() ONLY accepts cryptographic session tokens (security review SEC-01).
 * Founder (0.0.518487) can never be removed (server-enforced).
 */
export async function removeDaoAdmin(
  accountId: string,
  targetAccountId: string,
): Promise<{ admins: string[]; error?: string; code?: string }> {
  try {
    const sessionToken = getSessionToken();
    if (!sessionToken) {
      return { admins: [], error: "ED25519 session required — sign in as owner first", code: "AUTH_REQUIRED" };
    }
    log.info("DAO", `removeDaoAdmin: DELETE /dao/admins/${targetAccountId} (owner=${accountId})`);
    const res = await fetch(`${API_BASE}/dao/admins/${targetAccountId}`, {
      method: "DELETE",
      headers: authHeaders(sessionToken),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      log.error("DAO", `removeDaoAdmin failed: HTTP ${res.status} code=${data.code} error=${data.error}`);
      return { admins: data.admins || [], error: data.error || "Failed to remove admin", code: data.code };
    }
    log.info("DAO", `removeDaoAdmin success: ${data.admins?.length} admins remaining`);
    setAdminListCache(data.admins);
    return { admins: data.admins };
  } catch (err: any) {
    log.error("DAO", "Error removing admin", err);
    return { admins: [], error: err?.message || "Network error", code: "NETWORK_ERROR" };
  }
}
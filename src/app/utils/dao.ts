/**
 * HBAR.ħ DAO — Token-Gated Governance Utilities
 *
 * Voting eligibility: Hold >= 100M HBAR.ħ display tokens OR 1+ VIP NFT (verified on-chain via Mirror Node).
 * Voting power:       1 vote per 100M display tokens (max 10) + 1 vote per 3 VIP NFTs (max 1), per governance session.
 * Max total power:    11 votes (10 from tokens at 1B cap + 1 from NFTs at 3 NFTs).
 * Session scope:      Browser session (sessionStorage). Closing the tab resets vote tracking.
 *
 * Admin control:      Wallet 0.0.518487 has full edit/delete on any active/pending proposal (even after votes).
 * Proposer control:   Proposal creators can edit/delete their own proposals, but only before the first vote.
 *
 * All balance comparisons use the decimals-adjusted `balance` field (NOT rawBalance)
 * so thresholds represent real token counts regardless of on-chain decimal configuration.
 * The HBAR.ħ token ID is configured per-network below.
 * All balance reads come from the WalletContext's `hederaAccount.tokens[]`,
 * which is populated via Mirror Node `/api/v1/accounts/{id}/tokens`.
 */

import type { HederaTokenBalance } from "./hedera";

// ── DAO Admin Configuration ──────────────────────────────────────────

/**
 * The sole wallet authorized to create, edit, and delete DAO proposals.
 * All other eligible wallets can vote and comment only.
 */
export const DAO_ADMIN_ACCOUNT = "0.0.518487";

/**
 * Check whether the given account ID is the DAO admin.
 */
export function isDAOAdmin(accountId: string): boolean {
  return accountId === DAO_ADMIN_ACCOUNT;
}

// ── HBAR.ħ Protocol Token Configuration ──────────────────────────────

/** Hedera token IDs for the HBAR.ħ protocol token per network. */
export const HBARH_TOKEN_ID: Record<string, string> = {
  testnet: "0.0.9356476",
  mainnet: "0.0.9356476",
};

export const HBARH_DECIMALS = 8;

/** Minimum decimals-adjusted token balance required to participate (100 million tokens). */
export const GATE_THRESHOLD = 100_000_000;

/** Tokens per vote. Every 100M display tokens = 1 vote. */
export const TOKENS_PER_VOTE = 100_000_000;

// ── VIP NFT Configuration ────────────────────────────────────────────

/** NFT collection token ID that gates VIP features and grants voting power. */
export const VIP_NFT_TOKEN_ID = "0.0.10146181";

/** Number of VIP NFTs required per 1 governance vote. */
export const NFTS_PER_VOTE = 3;

/** Maximum votes from tokens (10 × 100M = 1B token cap). */
export const MAX_TOKEN_VOTES = 10;

/** Maximum votes from NFTs (3 NFTs = 1 vote, hard cap). */
export const MAX_NFT_VOTES = 1;

// ── Balance & Voting Power ───────────────────────────────────────────

/**
 * Locate the HBAR.ħ token in a user's on-chain token list.
 * Returns the HederaTokenBalance entry or null if the user has no association.
 */
export function findWrappBalance(
  tokens: HederaTokenBalance[],
  network: string
): HederaTokenBalance | null {
  const id = HBARH_TOKEN_ID[network];
  if (!id) return null;
  return tokens.find((t) => t.tokenId === id) ?? null;
}

/**
 * Decimals-adjusted HBAR.ħ balance (display tokens, NOT raw chain units).
 *
 * A return value of 100_000_000 means the user holds 100 million tokens.
 * Uses `balance` (rawBalance / 10^decimals) so every gate comparison
 * and voting-power calculation works against real token counts,
 * regardless of the on-chain decimal configuration.
 */
export function getWrappBalance(
  tokens: HederaTokenBalance[],
  network: string
): number {
  const entry = findWrappBalance(tokens, network);
  if (!entry) return 0;
  return entry.balance;
}

/**
 * Count of VIP NFTs (token ID 0.0.10146181) owned by the wallet.
 * NFTs on Hedera show up in the token balance list with rawBalance = serial count.
 */
export function getNftCount(tokens: HederaTokenBalance[]): number {
  const entry = tokens.find((t) => t.tokenId === VIP_NFT_TOKEN_ID);
  return entry?.rawBalance ?? 0;
}

/**
 * Whether the user meets the minimum threshold to participate in governance.
 * Either: 100M HBAR.ħ tokens OR 1+ VIP NFT.
 */
export function isEligible(tokens: HederaTokenBalance[], network: string): boolean {
  return getWrappBalance(tokens, network) >= GATE_THRESHOLD || getNftCount(tokens) >= 1;
}

/**
 * Maximum votes this wallet is entitled to per session.
 * Token votes: min(floor(rawBalance / 100M), 10)  — capped at 1B tokens
 * NFT votes:   min(floor(nftCount / 3), 1)        — capped at 1 vote from NFTs
 * Total = capped token votes + capped NFT votes    — max possible: 11
 */
export function maxVotesForBalance(tokens: HederaTokenBalance[], network: string): number {
  const balance = getWrappBalance(tokens, network);
  const tokenVotes = Math.min(Math.floor(balance / TOKENS_PER_VOTE), MAX_TOKEN_VOTES);
  const nftVotes = Math.min(Math.floor(getNftCount(tokens) / NFTS_PER_VOTE), MAX_NFT_VOTES);
  return tokenVotes + nftVotes;
}

// ── Comment Type ─────────────────────────────────────────────────────

export interface ProposalComment {
  id: string;
  author: string;           // Hedera account ID
  text: string;
  createdAt: number;         // epoch ms
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
  proposer: string;          // Hedera account ID of creator
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  quorum: number;
  createdAt: number;         // epoch ms
  endsAt: number;            // epoch ms
  voterLog: Record<string, { direction: "for" | "against"; weight: number }>;
  comments: ProposalComment[];
}

// ── Session Vote Tracking ────────────────────────────────────────────

const SESSION_KEY = "hbarh-dao-session-votes";

interface SessionVoteMap {
  /** proposalId -> number of votes the user has already cast on this proposal */
  [proposalId: string]: number;
}

function loadSessionVotes(): SessionVoteMap {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSessionVotes(map: SessionVoteMap): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(map));
  } catch {
    // sessionStorage full — non-critical
  }
}

/**
 * How many votes the user has already cast on a specific proposal this session.
 */
export function votesSpentOnProposal(proposalId: string): number {
  return loadSessionVotes()[proposalId] ?? 0;
}

/**
 * Total number of proposals the user has voted on this session.
 */
export function totalProposalsVotedThisSession(): number {
  return Object.keys(loadSessionVotes()).length;
}

/**
 * Whether the user has voted on a specific proposal this session.
 * (Used as a quick client-side check; authoritative check is voterLog in the proposal.)
 */
export function hasVotedOnProposalThisSession(proposalId: string): boolean {
  return (loadSessionVotes()[proposalId] ?? 0) > 0;
}

/**
 * Record that the user cast `weight` votes on `proposalId`.
 */
export function recordVote(proposalId: string, weight: number): void {
  const map = loadSessionVotes();
  map[proposalId] = (map[proposalId] ?? 0) + weight;
  saveSessionVotes(map);
}

// ── Proposal Persistence (localStorage) ─────────────────────────────

const PROPOSALS_KEY = "hbarh-dao-proposals";

/** Seed proposals — shown when localStorage is empty. */
const SEED_PROPOSALS: Proposal[] = [];

export function loadProposals(): Proposal[] {
  try {
    const raw = localStorage.getItem(PROPOSALS_KEY);
    if (raw) {
      const parsed: Proposal[] = JSON.parse(raw);
      // Purge legacy mock proposals seeded with fake wallet addresses
      const cleaned = parsed.filter(
        (p) => !p.id.startsWith("prop-00")
      );
      // Migrate old proposals that don't have comments array
      const migrated = cleaned.map((p) => ({
        ...p,
        comments: p.comments ?? [],
      }));
      // Auto-resolve expired proposals
      const resolved = migrated.map(resolveIfExpired);
      // If we purged any mocks, persist the cleaned list
      if (cleaned.length !== parsed.length) {
        saveProposals(resolved);
      }
      return resolved;
    }
  } catch {
    // corrupt — fall through to seed
  }
  // First visit: seed (now empty)
  const seeded = SEED_PROPOSALS.map(resolveIfExpired);
  saveProposals(seeded);
  return seeded;
}

export function saveProposals(proposals: Proposal[]): void {
  try {
    localStorage.setItem(PROPOSALS_KEY, JSON.stringify(proposals));
  } catch {
    // localStorage full — non-critical
  }
}

/**
 * If a proposal is past its `endsAt` and still "active" or "pending",
 * resolve it to "passed" or "rejected" based on votes & quorum.
 */
function resolveIfExpired(p: Proposal): Proposal {
  if (p.status !== "active" && p.status !== "pending") return p;
  if (Date.now() < p.endsAt) return p;

  const totalVotes = p.votesFor + p.votesAgainst;
  const quorumMet = totalVotes >= p.quorum;
  const passed = quorumMet && p.votesFor > p.votesAgainst;

  return { ...p, status: passed ? "passed" : "rejected" };
}

/**
 * Create a new proposal. Returns the updated list.
 * Only the DAO admin (0.0.518487) can create proposals.
 */
export function createProposal(
  proposals: Proposal[],
  title: string,
  description: string,
  category: ProposalCategory,
  proposer: string,
  durationDays: number,
  quorum: number
): Proposal[] | null {
  if (!isDAOAdmin(proposer)) return null;

  const newProp: Proposal = {
    id: `prop-${Date.now().toString(36)}`,
    title,
    description,
    category,
    proposer,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    quorum,
    createdAt: Date.now(),
    endsAt: Date.now() + durationDays * 86_400_000,
    voterLog: {},
    comments: [],
  };

  const updated = [newProp, ...proposals];
  saveProposals(updated);
  return updated;
}

/**
 * Whether a proposal can be edited/deleted by the given account.
 *
 * Admin (0.0.518487): full control on any active/pending proposal, even after votes.
 * Proposer (original creator): can edit/delete only before any votes have been cast.
 */
export function canModifyProposal(proposal: Proposal, accountId: string): boolean {
  // Must be active or pending
  if (proposal.status !== "active" && proposal.status !== "pending") return false;

  // Admin has unconditional control over active/pending proposals
  if (isDAOAdmin(accountId)) return true;

  // Proposer can modify only before the first vote is cast
  if (proposal.proposer === accountId && Object.keys(proposal.voterLog).length === 0) return true;

  return false;
}

/**
 * Edit a proposal's title, description, and category.
 * Admin can edit at any time while active/pending.
 * Proposer can edit only before the first vote is cast.
 */
export function editProposal(
  proposals: Proposal[],
  proposalId: string,
  accountId: string,
  updates: { title?: string; description?: string; category?: ProposalCategory }
): Proposal[] | null {
  const idx = proposals.findIndex((p) => p.id === proposalId);
  if (idx === -1) return null;

  const proposal = proposals[idx];
  if (!canModifyProposal(proposal, accountId)) return null;

  const updated = [...proposals];
  updated[idx] = {
    ...proposal,
    title: updates.title?.trim() || proposal.title,
    description: updates.description?.trim() || proposal.description,
    category: updates.category || proposal.category,
  };
  saveProposals(updated);
  return updated;
}

/**
 * Delete a proposal.
 * Admin can delete at any time while active/pending.
 * Proposer can delete only before the first vote is cast.
 */
export function deleteProposal(
  proposals: Proposal[],
  proposalId: string,
  accountId: string
): Proposal[] | null {
  const idx = proposals.findIndex((p) => p.id === proposalId);
  if (idx === -1) return null;

  const proposal = proposals[idx];
  if (!canModifyProposal(proposal, accountId)) return null;

  const updated = proposals.filter((p) => p.id !== proposalId);
  saveProposals(updated);
  return updated;
}

/**
 * Add a comment to a proposal. Any eligible wallet can comment.
 */
export function addComment(
  proposals: Proposal[],
  proposalId: string,
  author: string,
  text: string
): Proposal[] | null {
  const idx = proposals.findIndex((p) => p.id === proposalId);
  if (idx === -1) return null;
  if (!text.trim()) return null;

  const comment: ProposalComment = {
    id: `cmt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    author,
    text: text.trim(),
    createdAt: Date.now(),
  };

  const updated = [...proposals];
  updated[idx] = {
    ...proposals[idx],
    comments: [...(proposals[idx].comments ?? []), comment],
  };
  saveProposals(updated);
  return updated;
}

/**
 * Cast a vote on a proposal. Mutates proposal in the list and persists.
 * Returns updated proposals list, or null if the vote was invalid.
 */
export function castVote(
  proposals: Proposal[],
  proposalId: string,
  voter: string,
  direction: "for" | "against",
  weight: number
): Proposal[] | null {
  const idx = proposals.findIndex((p) => p.id === proposalId);
  if (idx === -1) return null;

  const proposal = proposals[idx];

  // Can't vote on resolved proposals
  if (proposal.status !== "active" && proposal.status !== "pending") return null;

  // Can't vote if expired
  if (Date.now() >= proposal.endsAt) return null;

  // Check if already voted on this proposal (on-chain style: one direction per proposal)
  if (proposal.voterLog[voter]) return null;

  const updated = [...proposals];
  const updatedProposal = { ...proposal, voterLog: { ...proposal.voterLog } };

  updatedProposal.voterLog[voter] = { direction, weight };

  if (direction === "for") {
    updatedProposal.votesFor += weight;
  } else {
    updatedProposal.votesAgainst += weight;
  }

  updated[idx] = updatedProposal;
  saveProposals(updated);
  recordVote(proposalId, weight);
  return updated;
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
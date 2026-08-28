// ═══════════════════════════════════════════════════════════════════════
// DAO GOVERNANCE — Server-Authoritative Proposals, Votes & Comments
// ═══════════════════════════════════════════════════════════════════════
//
// Sharded KV storage: index + per-proposal + per-proposal-comments keys.
// Auto-migrates from legacy single-blob (dao_proposals) on first read.
// Admin CRUD restricted to 0.0.518487 (owner only for admin management).
// All admins can create/edit/delete proposals. Vote weight from Mirror Node.
// Per-proposal locks for vote/edit/comment — global lock only for create/delete.
// Deduplication via voterLog. Inputs sanitized, rate-limited, fail-closed.
// Caps: 100 proposals, 200 comments per proposal.
//
// KZN-20260828-04: canonical ledger is one Hedera TESTNET HCS topic
// (DAO_HCS_TOPIC_ID). KV is indexer only. Create/vote fail closed if the
// topic ID is missing. HCS submit lands in a follow-up once CEO sets env.
//
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import * as kv from "./kv_store.tsx";
import {
  getClientIp, isRateLimited, sanitizeString, isValidHederaAccountId,
  withKvLock, POOL_LOCK_RETRY_INTERVAL_MS, ROUTE_PREFIX,
} from "./shared.ts";
import type { KvLockConfig } from "./shared.ts";
import { requireAuth, requireOwner, logAdminAction, OWNER_ACCOUNT } from "./auth.ts";
import { verifyVipEligibilityFull } from "./vip.ts";

// ── Sharded KV Storage ─────────────────────────────────────────────
// Each proposal and its comments are stored in separate KV keys to avoid
// hitting the ~1MB per-value size limit that a single "dao_proposals" blob
// would reach with many proposals, comments, and voter logs.
//
// Key schema:
//   dao_v2_idx              → string[]           (ordered list of proposal IDs)
//   dao_v2_p:{id}           → DAOProposal        (proposal data + voterLog, no comments)
//   dao_v2_c:{id}           → DAOComment[]        (comments for a single proposal)
//   dao_proposals           → (legacy) DAOProposal[]  — auto-migrated on first read
//
const DAO_LEGACY_KEY = "dao_proposals";
const DAO_V2_INDEX_KEY = "dao_v2_idx";
const DAO_V2_PROP_PREFIX = "dao_v2_p:";
const DAO_V2_CMT_PREFIX = "dao_v2_c:";
const DAO_MAX_PROPOSALS = 100;
const DAO_MAX_COMMENTS_PER_PROPOSAL = 200;

/**
 * Validate proposalId format — must be a safe alphanumeric+dash+underscore string.
 * Prevents KV key injection via crafted proposal IDs (security review).
 * Max 80 chars prevents DoS via oversized keys.
 */
function isValidProposalId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 80 && /^[a-zA-Z0-9_-]+$/.test(id);
}

// ── Testnet HCS topic (env) ────────────────────────────────────────
// Topic IDs are public. Operator keys are NOT read here.
const DAO_HCS_TOPIC_RE = /^0\.0\.\d+$/;

export type DaoHcsConfig = { topicId: string; network: "testnet" };

export function getDaoHcsConfig(): DaoHcsConfig | { error: "DAO_HCS_UNCONFIGURED" | "DAO_HCS_TESTNET_ONLY" } {
  const topicId = (Deno.env.get("DAO_HCS_TOPIC_ID") || "").trim();
  const network = (Deno.env.get("DAO_HCS_NETWORK") || "testnet").trim().toLowerCase();
  if (network !== "testnet") {
    return { error: "DAO_HCS_TESTNET_ONLY" };
  }
  if (!topicId || !DAO_HCS_TOPIC_RE.test(topicId)) {
    return { error: "DAO_HCS_UNCONFIGURED" };
  }
  return { topicId, network: "testnet" };
}

function daoHcsGuard(c: { json: (body: unknown, status: number) => Response }): Response | DaoHcsConfig {
  const cfg = getDaoHcsConfig();
  if ("error" in cfg) {
    const msg = cfg.error === "DAO_HCS_TESTNET_ONLY"
      ? "DAO HCS is testnet-only for this slice. Set DAO_HCS_NETWORK=testnet."
      : "DAO HCS topic is not configured. Set DAO_HCS_TOPIC_ID (testnet 0.0.x) in Area 51 env.";
    return c.json({ error: msg, code: cfg.error }, 503);
  }
  return cfg;
}

// Global lock for INDEX-mutating operations (create/delete proposals).
const DAO_INDEX_LOCK_CONFIG: KvLockConfig = {
  key: "dao_proposals_lock",
  ttlMs: 8_000,
  waitMs: 5_000,
  retryMs: POOL_LOCK_RETRY_INTERVAL_MS,
};

// Per-proposal lock factory for vote/edit/comment (much better concurrency).
function daoProposalLock(proposalId: string): KvLockConfig {
  return {
    key: `dao_plock:${proposalId}`,
    ttlMs: 6_000,
    waitMs: 4_000,
    retryMs: POOL_LOCK_RETRY_INTERVAL_MS,
  };
}

// ── Dynamic Admin List (KV-backed) ─────────────────────────────────
// Founder permanently protected. Add/remove requires fresh session (<2 min).
const DAO_ADMINS_KEY = "dao_admin_accounts";
const DAO_FOUNDER_ACCOUNT = "0.0.518487";
const DAO_MAX_ADMINS = 10;

async function loadDaoAdmins(): Promise<string[]> {
  try {
    const stored: string[] | null = await kv.get(DAO_ADMINS_KEY);
    if (!stored || !Array.isArray(stored)) return [DAO_FOUNDER_ACCOUNT];
    if (!stored.includes(DAO_FOUNDER_ACCOUNT)) stored.unshift(DAO_FOUNDER_ACCOUNT);
    return stored;
  } catch { return [DAO_FOUNDER_ACCOUNT]; }
}

let _adminCache: { list: string[]; ts: number } | null = null;
const ADMIN_CACHE_TTL_MS = 30_000;

async function saveDaoAdminList(admins: string[]): Promise<void> {
  if (!admins.includes(DAO_FOUNDER_ACCOUNT)) admins.unshift(DAO_FOUNDER_ACCOUNT);
  await kv.set(DAO_ADMINS_KEY, admins);
  _adminCache = null; // bust cache
}

async function getDaoAdminsCached(): Promise<string[]> {
  if (_adminCache && Date.now() - _adminCache.ts < ADMIN_CACHE_TTL_MS) return _adminCache.list;
  const admins = await loadDaoAdmins();
  _adminCache = { list: admins, ts: Date.now() };
  return admins;
}

async function isDaoAdminAsync(accountId: string): Promise<boolean> {
  return (await getDaoAdminsCached()).includes(accountId);
}

// ── Voting Power ────────────────────────────────────────────────────

const DAO_TOKENS_PER_VOTE = 100_000_000;
const DAO_MAX_TOKEN_VOTES = 10;
const DAO_NFTS_PER_VOTE = 3;
const DAO_MAX_NFT_VOTES = 1;
// LP token voting: ssLP-HBAR-HBAR.ħ (0.0.9356724)
// IMPLEMENTATION NOTE: 156,250 LP tokens (display units) = 1 vote, max 10.
const DAO_LP_TOKENS_PER_VOTE = 156_250;
const DAO_MAX_LP_VOTES = 10;

function calculateVotingPower(tokenBalance: number, nftCount: number, lpBalance: number = 0): number {
  return Math.min(Math.floor(tokenBalance / DAO_TOKENS_PER_VOTE), DAO_MAX_TOKEN_VOTES)
       + Math.min(Math.floor(nftCount / DAO_NFTS_PER_VOTE), DAO_MAX_NFT_VOTES)
       + Math.min(Math.floor(lpBalance / DAO_LP_TOKENS_PER_VOTE), DAO_MAX_LP_VOTES);
}

// ── Proposal Types ──────────────────────────────────────────────────

type DAOProposalStatus = "active" | "passed" | "rejected" | "pending";
type DAOProposalCategory = "Fees" | "Staking" | "Listing" | "Tokenomics" | "Features" | "Partnership" | "Governance" | "Other";
const DAO_VALID_CATEGORIES: DAOProposalCategory[] = ["Fees", "Staking", "Listing", "Tokenomics", "Features", "Partnership", "Governance", "Other"];

interface DAOComment { id: string; author: string; text: string; createdAt: number; }

interface DAOProposal {
  id: string; title: string; description: string; category: DAOProposalCategory;
  proposer: string; status: DAOProposalStatus; votesFor: number; votesAgainst: number;
  quorum: number; createdAt: number; endsAt: number;
  voterLog: Record<string, { direction: "for" | "against"; weight: number }>;
  comments: DAOComment[];
}

function canModifyDaoProposal(p: DAOProposal, acct: string, adminList: string[]): boolean {
  if (p.status !== "active" && p.status !== "pending") return false;
  if (adminList.includes(acct)) return true;
  if (p.proposer === acct && Object.keys(p.voterLog).length === 0) return true;
  return false;
}

function resolveExpiredProposal(p: DAOProposal): DAOProposal {
  if (p.status !== "active" && p.status !== "pending") return p;
  if (Date.now() < p.endsAt) return p;
  const total = p.votesFor + p.votesAgainst;
  return { ...p, status: (total >= p.quorum && p.votesFor > p.votesAgainst) ? "passed" : "rejected" };
}

// ── Sharded load/save helpers ──────────────────────────────────────

/** Load all proposals (assembled from sharded keys). Falls back to legacy blob. */
async function loadDaoProposals(): Promise<DAOProposal[]> {
  try {
    const index: string[] | null = await kv.get(DAO_V2_INDEX_KEY);
    if (index && Array.isArray(index) && index.length > 0) {
      // Parallel load individual proposals + comments
      const results = await Promise.all(
        index.map(async (id): Promise<DAOProposal | null> => {
          try {
            const [data, comments] = await Promise.all([
              kv.get(`${DAO_V2_PROP_PREFIX}${id}`),
              kv.get(`${DAO_V2_CMT_PREFIX}${id}`).catch(() => null),
            ]);
            if (!data || !data.id) return null;
            return resolveExpiredProposal({ ...data, comments: Array.isArray(comments) ? comments : [] });
          } catch { return null; }
        }),
      );
      return results.filter(Boolean) as DAOProposal[];
    }

    // Fallback: try legacy single-blob format
    const legacy: DAOProposal[] | null = await kv.get(DAO_LEGACY_KEY);
    if (legacy && Array.isArray(legacy) && legacy.length > 0) {
      // Auto-migrate to sharded format (fire-and-forget)
      migrateLegacyDaoProposals(legacy).catch((err) =>
        console.log(`[DAO] Migration warning (non-fatal): ${err}`),
      );
      return legacy.map(resolveExpiredProposal);
    }
    return [];
  } catch { return []; }
}

/** Load a single proposal by ID (no index scan). */
async function loadDaoProposal(proposalId: string): Promise<DAOProposal | null> {
  try {
    const [data, comments] = await Promise.all([
      kv.get(`${DAO_V2_PROP_PREFIX}${proposalId}`),
      kv.get(`${DAO_V2_CMT_PREFIX}${proposalId}`).catch(() => null),
    ]);
    if (!data || !data.id) return null;
    return resolveExpiredProposal({ ...data, comments: Array.isArray(comments) ? comments : [] });
  } catch { return null; }
}

/** Save a single proposal (core data without comments). */
async function saveDaoProposal(proposal: DAOProposal): Promise<void> {
  const { comments, ...coreData } = proposal;
  await kv.set(`${DAO_V2_PROP_PREFIX}${proposal.id}`, coreData);
}

/** Save comments for a single proposal. */
async function saveDaoComments(proposalId: string, comments: DAOComment[]): Promise<void> {
  await kv.set(`${DAO_V2_CMT_PREFIX}${proposalId}`, comments);
}

/** Add a proposal ID to the index (prepend for newest-first order). */
async function addToIndex(proposalId: string): Promise<string[]> {
  const index: string[] = (await kv.get(DAO_V2_INDEX_KEY)) ?? [];
  const updated = [proposalId, ...index.filter(id => id !== proposalId)];
  await kv.set(DAO_V2_INDEX_KEY, updated);
  return updated;
}

/** Remove a proposal ID from the index and clean up its KV keys. */
async function removeFromIndex(proposalId: string): Promise<string[]> {
  const index: string[] = (await kv.get(DAO_V2_INDEX_KEY)) ?? [];
  const updated = index.filter(id => id !== proposalId);
  await Promise.all([
    kv.set(DAO_V2_INDEX_KEY, updated),
    kv.del(`${DAO_V2_PROP_PREFIX}${proposalId}`).catch(() => {}),
    kv.del(`${DAO_V2_CMT_PREFIX}${proposalId}`).catch(() => {}),
  ]);
  return updated;
}

/** Get current index length (for capacity check). */
async function getIndexLength(): Promise<number> {
  const index: string[] | null = await kv.get(DAO_V2_INDEX_KEY);
  return index ? index.length : 0;
}

/** One-time migration from legacy single blob to sharded keys. */
async function migrateLegacyDaoProposals(proposals: DAOProposal[]): Promise<void> {
  const index = proposals.map(p => p.id);
  const keys: string[] = [DAO_V2_INDEX_KEY];
  const values: any[] = [index];

  for (const p of proposals) {
    const { comments, ...coreData } = p;
    keys.push(`${DAO_V2_PROP_PREFIX}${p.id}`);
    values.push(coreData);
    if (comments && comments.length > 0) {
      keys.push(`${DAO_V2_CMT_PREFIX}${p.id}`);
      values.push(comments);
    }
  }

  await kv.mset(keys, values);
  await kv.del(DAO_LEGACY_KEY).catch(() => {});
  console.log(`[DAO] Migrated ${proposals.length} proposals from legacy blob to sharded keys`);
}

// ── Route Registration ──────────────────────────────────────────────

export function registerDaoRoutes(app: Hono): void {

  // GET /dao/hcs — Public: whether the testnet topic is configured (ID is not a secret)
  app.get(`${ROUTE_PREFIX}/dao/hcs`, (c) => {
    const cfg = getDaoHcsConfig();
    if ("error" in cfg) {
      return c.json({ configured: false, code: cfg.error, network: "testnet" });
    }
    return c.json({ configured: true, topicId: cfg.topicId, network: cfg.network });
  });

  // GET /dao/proposals — Public read
  app.get(`${ROUTE_PREFIX}/dao/proposals`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      return c.json({ proposals: await loadDaoProposals() });
    } catch (err) {
      console.error(`[DAO] Error loading proposals: ${err}`);
      return c.json({ proposals: [], error: "Failed to load proposals" }, 500);
    }
  });

  // POST /dao/proposals — Admin-only create
  app.post(`${ROUTE_PREFIX}/dao/proposals`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;
      if (!(await isDaoAdminAsync(accountId))) {
        console.log(`[DAO] Non-admin proposal creation attempt: ${accountId}`);
        return c.json({ error: "Only DAO admins can create proposals", code: "DAO_NOT_ADMIN" }, 403);
      }

      const hcs = daoHcsGuard(c);
      if (hcs instanceof Response) return hcs;

      // Input validation (outside lock — no state mutations)
      const body = await c.req.json();
      const { title, description, category, durationDays, quorum } = body;
      if (!title || typeof title !== "string" || title.trim().length < 5) return c.json({ error: "Title must be at least 5 characters" }, 400);
      if (!description || typeof description !== "string" || description.trim().length < 20) return c.json({ error: "Description must be at least 20 characters" }, 400);
      if (!category || !DAO_VALID_CATEGORIES.includes(category)) return c.json({ error: "Invalid category" }, 400);
      const days = Number(durationDays);
      if (!days || days < 1 || days > 30) return c.json({ error: "Duration must be 1-30 days" }, 400);
      const q = Number(quorum);
      if (!q || q < 1 || q > 10000) return c.json({ error: "Quorum must be 1-10000" }, 400);

      // Lock the INDEX to add a new proposal (prevents duplicate IDs / capacity races)
      const result = await withKvLock(DAO_INDEX_LOCK_CONFIG, async () => {
        const currentLen = await getIndexLength();
        if (currentLen >= DAO_MAX_PROPOSALS) return c.json({ error: `Maximum ${DAO_MAX_PROPOSALS} proposals reached` }, 400);
        const idBuf = new Uint8Array(4);
        crypto.getRandomValues(idBuf);
        const idHex = Array.from(idBuf).map(b => b.toString(16).padStart(2, "0")).join("");
        const now = Date.now();
        const newP: DAOProposal = {
          id: `prop-${idHex}`, title: sanitizeString(title.trim(), 120), description: sanitizeString(description.trim(), 2000),
          category, proposer: accountId, status: "active", votesFor: 0, votesAgainst: 0, quorum: q,
          createdAt: now, endsAt: now + days * 86_400_000, voterLog: {}, comments: [],
        };
        // Write proposal to its own key + add to index
        await Promise.all([saveDaoProposal(newP), addToIndex(newP.id)]);
        console.log(`[DAO] Proposal created by admin ${accountId}: ${newP.id} "${newP.title}"`);
        // Return full list for frontend compatibility
        const allProposals = await loadDaoProposals();
        return c.json({ proposal: newP, proposals: allProposals });
      });
      return result;
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") return c.json({ error: "DAO service is busy — please retry", code: "DAO_BUSY" }, 503);
      console.error(`[DAO] Error creating proposal: ${err}`);
      return c.json({ error: "Failed to create proposal" }, 500);
    }
  });

  // PUT /dao/proposals/:id — Admin/proposer edit
  app.put(`${ROUTE_PREFIX}/dao/proposals/:id`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;
      const proposalId = c.req.param("id");
      if (!proposalId || !isValidProposalId(proposalId)) return c.json({ error: "Invalid proposal ID format" }, 400);
      const body = await c.req.json();
      const { title, description, category } = body;

      // Per-proposal lock — other proposals remain unblocked
      const result = await withKvLock(daoProposalLock(proposalId), async () => {
        const [proposal, adminList] = await Promise.all([loadDaoProposal(proposalId), getDaoAdminsCached()]);
        if (!proposal) return c.json({ error: "Proposal not found" }, 404);
        if (!canModifyDaoProposal(proposal, accountId, adminList)) {
          console.log(`[DAO] Unauthorized edit attempt: ${accountId} on ${proposalId}`);
          return c.json({ error: "Not authorized to edit this proposal" }, 403);
        }
        const edited: DAOProposal = {
          ...proposal,
          title: (title && typeof title === "string" && title.trim().length >= 5) ? sanitizeString(title.trim(), 120) : proposal.title,
          description: (description && typeof description === "string" && description.trim().length >= 20) ? sanitizeString(description.trim(), 2000) : proposal.description,
          category: (category && DAO_VALID_CATEGORIES.includes(category)) ? category : proposal.category,
        };
        await saveDaoProposal(edited);
        console.log(`[DAO] Proposal edited by ${accountId}: ${proposalId}`);
        const allProposals = await loadDaoProposals();
        return c.json({ proposal: edited, proposals: allProposals });
      });
      return result;
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") return c.json({ error: "DAO service is busy — please retry", code: "DAO_BUSY" }, 503);
      console.error(`[DAO] Error editing proposal: ${err}`);
      return c.json({ error: "Failed to edit proposal" }, 500);
    }
  });

  // DELETE /dao/proposals/:id — Admin/proposer delete
  app.delete(`${ROUTE_PREFIX}/dao/proposals/:id`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;
      const proposalId = c.req.param("id");
      if (!proposalId || !isValidProposalId(proposalId)) return c.json({ error: "Invalid proposal ID format" }, 400);

      // Index lock — modifies the proposal list
      const result = await withKvLock(DAO_INDEX_LOCK_CONFIG, async () => {
        const [proposal, adminList] = await Promise.all([loadDaoProposal(proposalId), getDaoAdminsCached()]);
        if (!proposal) return c.json({ error: "Proposal not found" }, 404);
        if (!canModifyDaoProposal(proposal, accountId, adminList)) {
          console.log(`[DAO] Unauthorized delete attempt: ${accountId} on ${proposalId}`);
          return c.json({ error: "Not authorized to delete this proposal" }, 403);
        }
        await removeFromIndex(proposalId);
        console.log(`[DAO] Proposal deleted by ${accountId}: ${proposalId}`);
        const allProposals = await loadDaoProposals();
        return c.json({ success: true, proposals: allProposals });
      });
      return result;
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") return c.json({ error: "DAO service is busy — please retry", code: "DAO_BUSY" }, 503);
      console.error(`[DAO] Error deleting proposal: ${err}`);
      return c.json({ error: "Failed to delete proposal" }, 500);
    }
  });

  // POST /dao/proposals/:id/vote — Authenticated + eligible, weight from Mirror Node
  app.post(`${ROUTE_PREFIX}/dao/proposals/:id/vote`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;
      const proposalId = c.req.param("id");
      if (!proposalId || !isValidProposalId(proposalId)) return c.json({ error: "Invalid proposal ID format" }, 400);
      const body = await c.req.json();
      const { direction } = body;
      if (direction !== "for" && direction !== "against") return c.json({ error: "Direction must be 'for' or 'against'" }, 400);

      const hcs = daoHcsGuard(c);
      if (hcs instanceof Response) return hcs;

      // Pre-lock: VIP eligibility check (Mirror Node call — keep outside lock to minimize hold time)
      const vipStatus = await verifyVipEligibilityFull(accountId);
      if (!vipStatus.eligible) {
        console.log(`[DAO] Ineligible vote attempt: ${accountId} balance=${vipStatus.tokenBalance} nfts=${vipStatus.nftCount} lp=${vipStatus.lpBalance}`);
        return c.json({ error: "Insufficient holdings. Need 100M HBAR.ħ, 1 VIP NFT, or 156,250 LP tokens to vote.", code: "DAO_INELIGIBLE" }, 403);
      }
      const weight = calculateVotingPower(vipStatus.tokenBalance, vipStatus.nftCount, vipStatus.lpBalance);
      if (weight <= 0) return c.json({ error: "Insufficient balance for any voting power" }, 403);

      // Per-proposal lock — votes on different proposals don't block each other
      const result = await withKvLock(daoProposalLock(proposalId), async () => {
        const proposal = await loadDaoProposal(proposalId);
        if (!proposal) return c.json({ error: "Proposal not found" }, 404);
        if (proposal.status !== "active" && proposal.status !== "pending") return c.json({ error: "Voting is closed on this proposal" }, 400);
        if (Date.now() >= proposal.endsAt) return c.json({ error: "Voting period has ended" }, 400);
        if (proposal.voterLog[accountId]) {
          return c.json({ error: "You have already voted on this proposal", code: "DAO_ALREADY_VOTED", existingVote: proposal.voterLog[accountId] }, 409);
        }
        const voted: DAOProposal = {
          ...proposal,
          voterLog: { ...proposal.voterLog, [accountId]: { direction, weight } },
          votesFor: direction === "for" ? proposal.votesFor + weight : proposal.votesFor,
          votesAgainst: direction === "against" ? proposal.votesAgainst + weight : proposal.votesAgainst,
        };
        await saveDaoProposal(voted);
        console.log(`[DAO] Vote: ${accountId} voted ${direction} (weight=${weight}) on ${proposalId}`);
        return c.json({ success: true, proposal: voted, votingPower: weight, tokenBalance: vipStatus.tokenBalance, nftCount: vipStatus.nftCount, lpBalance: vipStatus.lpBalance });
      });
      return result;
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") return c.json({ error: "DAO service is busy — please retry", code: "DAO_BUSY" }, 503);
      console.error(`[DAO] Error casting vote: ${err}`);
      return c.json({ error: "Failed to cast vote" }, 500);
    }
  });

  // POST /dao/proposals/:id/comment — Authenticated + eligible comment
  app.post(`${ROUTE_PREFIX}/dao/proposals/:id/comment`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;
      const proposalId = c.req.param("id");
      if (!proposalId || !isValidProposalId(proposalId)) return c.json({ error: "Invalid proposal ID format" }, 400);

      // Pre-lock: VIP eligibility + input validation
      const vipStatus = await verifyVipEligibilityFull(accountId);
      if (!vipStatus.eligible) return c.json({ error: "Hold HBAR.ħ tokens, VIP NFTs, or LP tokens to comment", code: "DAO_INELIGIBLE" }, 403);
      const body = await c.req.json();
      const { text } = body;
      if (!text || typeof text !== "string" || !text.trim()) return c.json({ error: "Comment text is required" }, 400);

      // Per-proposal lock on comment key — doesn't block votes or other proposals
      const result = await withKvLock(daoProposalLock(proposalId), async () => {
        const proposal = await loadDaoProposal(proposalId);
        if (!proposal) return c.json({ error: "Proposal not found" }, 404);
        const existingComments = proposal.comments ?? [];
        if (existingComments.length >= DAO_MAX_COMMENTS_PER_PROPOSAL) {
          return c.json({ error: `Maximum ${DAO_MAX_COMMENTS_PER_PROPOSAL} comments per proposal` }, 400);
        }
        const cmtBuf = new Uint8Array(3);
        crypto.getRandomValues(cmtBuf);
        const cmtHex = Array.from(cmtBuf).map(b => b.toString(16).padStart(2, "0")).join("");
        const comment: DAOComment = { id: `cmt-${Date.now().toString(36)}-${cmtHex}`, author: accountId, text: sanitizeString(text.trim(), 500), createdAt: Date.now() };
        const updatedComments = [...existingComments, comment];
        await saveDaoComments(proposalId, updatedComments);
        console.log(`[DAO] Comment by ${accountId} on ${proposalId}: "${comment.text.slice(0, 50)}"`);
        return c.json({ success: true, comment, proposal: { ...proposal, comments: updatedComments } });
      });
      return result;
    } catch (err: any) {
      if (err?.code === "LOCK_TIMEOUT") return c.json({ error: "DAO service is busy — please retry", code: "DAO_BUSY" }, 503);
      console.error(`[DAO] Error adding comment: ${err}`);
      return c.json({ error: "Failed to add comment" }, 500);
    }
  });

  // GET /dao/voting-power — Authenticated: server-verified voting power
  app.get(`${ROUTE_PREFIX}/dao/voting-power`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;
      const vipStatus = await verifyVipEligibilityFull(accountId);
      const votingPower = calculateVotingPower(vipStatus.tokenBalance, vipStatus.nftCount, vipStatus.lpBalance);
      const isAdmin = await isDaoAdminAsync(accountId);
      return c.json({ accountId, eligible: vipStatus.eligible, tokenBalance: vipStatus.tokenBalance, nftCount: vipStatus.nftCount, lpBalance: vipStatus.lpBalance, votingPower, isAdmin, verifiedAt: vipStatus.verifiedAt, cached: vipStatus.cached });
    } catch (err) {
      console.error(`[DAO] Error fetching voting power: ${err}`);
      return c.json({ error: "Failed to fetch voting power" }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DAO ADMIN MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════
  //
  // OWNER-ONLY add/remove. Only 0.0.518487 can modify the admin list.
  // This prevents admin chain escalation (compromised admin adding hostile
  // accounts). Fresh session (<2 min) still required for extra safety.
  // Founder (0.0.518487) permanently protected from removal. Max 10 admins.
  // ═══════════════════════════════════════════════════════════════════════

  // GET /dao/admins — Admin-only: list current admins
  app.get(`${ROUTE_PREFIX}/dao/admins`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const auth = await requireAuth(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;
      if (!(await isDaoAdminAsync(accountId))) {
        return c.json({ error: "Only DAO admins can view admin list", code: "DAO_NOT_ADMIN" }, 403);
      }
      const admins = await loadDaoAdmins();
      return c.json({ admins, founder: DAO_FOUNDER_ACCOUNT, maxAdmins: DAO_MAX_ADMINS });
    } catch (err) {
      console.error(`[DAO-ADMIN] Error listing admins: ${err}`);
      return c.json({ error: "Failed to load admin list" }, 500);
    }
  });

  // POST /dao/admins — OWNER-ONLY: add a new admin
  // Auth: requireOwner (ED25519 session token ONLY — security review SEC-01)
  app.post(`${ROUTE_PREFIX}/dao/admins`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const auth = await requireOwner(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;

      // ── OWNER-ONLY: prevent admin chain escalation ──
      if (accountId !== OWNER_ACCOUNT) {
        console.log(`[SECURITY] Non-owner admin-add attempt by ${accountId} from IP ${ip}`);
        return c.json({ error: "Only the protocol owner can add admins", code: "OWNER_REQUIRED" }, 403);
      }

      const body = await c.req.json();
      const { newAdminAccountId } = body;
      if (!newAdminAccountId || typeof newAdminAccountId !== "string") {
        return c.json({ error: "Missing newAdminAccountId" }, 400);
      }
      if (!isValidHederaAccountId(newAdminAccountId)) {
        return c.json({ error: "Invalid Hedera account ID format (expected 0.0.xxxxx)" }, 400);
      }
      const admins = await loadDaoAdmins();
      if (admins.includes(newAdminAccountId)) {
        return c.json({ error: "Account is already an admin" }, 409);
      }
      if (admins.length >= DAO_MAX_ADMINS) {
        return c.json({ error: `Maximum ${DAO_MAX_ADMINS} admins allowed` }, 400);
      }
      admins.push(newAdminAccountId);
      await saveDaoAdminList(admins);
      console.log(`[DAO-ADMIN] Admin added by OWNER ${accountId}: ${newAdminAccountId} (total: ${admins.length})`);
      logAdminAction("dao_admin_add", accountId, ip, `target=${newAdminAccountId} total=${admins.length}`);
      return c.json({ success: true, admins, addedBy: accountId });
    } catch (err) {
      console.error(`[DAO-ADMIN] Error adding admin: ${err}`);
      return c.json({ error: "Failed to add admin" }, 500);
    }
  });

  // DELETE /dao/admins/:accountId — OWNER-ONLY: remove an admin
  // Auth: requireOwner (ED25519 session token ONLY — security review SEC-01)
  app.delete(`${ROUTE_PREFIX}/dao/admins/:accountId`, async (c) => {
    try {
      const ip = getClientIp(c);
      if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
      const auth = await requireOwner(c);
      if (auth instanceof Response) return auth;
      const { accountId } = auth;

      // ── OWNER-ONLY: prevent admin chain escalation ──
      if (accountId !== OWNER_ACCOUNT) {
        console.log(`[SECURITY] Non-owner admin-remove attempt by ${accountId} from IP ${ip}`);
        return c.json({ error: "Only the protocol owner can remove admins", code: "OWNER_REQUIRED" }, 403);
      }

      const targetAccountId = c.req.param("accountId");
      if (!targetAccountId || !isValidHederaAccountId(targetAccountId)) {
        return c.json({ error: "Invalid target account ID" }, 400);
      }
      if (targetAccountId === DAO_FOUNDER_ACCOUNT) {
        console.log(`[DAO-ADMIN] Attempted removal of founder by ${accountId} — DENIED`);
        return c.json({ error: "The founder admin (0.0.518487) cannot be removed", code: "FOUNDER_PROTECTED" }, 403);
      }
      const admins = await loadDaoAdmins();
      if (!admins.includes(targetAccountId)) {
        return c.json({ error: "Account is not an admin" }, 404);
      }
      const updated = admins.filter(a => a !== targetAccountId);
      await saveDaoAdminList(updated);
      console.log(`[DAO-ADMIN] Admin removed by OWNER ${accountId}: ${targetAccountId} (remaining: ${updated.length})`);
      logAdminAction("dao_admin_remove", accountId, ip, `target=${targetAccountId} remaining=${updated.length}`);
      return c.json({ success: true, admins: updated, removedBy: accountId });
    } catch (err) {
      console.error(`[DAO-ADMIN] Error removing admin: ${err}`);
      return c.json({ error: "Failed to remove admin" }, 500);
    }
  });
}
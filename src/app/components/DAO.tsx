import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Vote,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  Plus,
  Wallet,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Info,
  Pencil,
  Trash2,
  MessageSquare,
  Send,
  ImageIcon,
  Crown,
  Gift,
  Loader2,
  Settings,
  UserPlus,
  Shield,
  X,
  KeyRound,
  LogIn,
} from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import { toast } from "sonner";
import { Tip } from "./Tip";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { log } from "../utils/logger";
import { motion } from "motion/react";
import {
  HBARH_TOKEN_ID,
  GATE_THRESHOLD,
  TOKENS_PER_VOTE,
  VIP_NFT_TOKEN_ID,
  NFTS_PER_VOTE,
  MAX_TOKEN_VOTES,
  MAX_NFT_VOTES,
  LP_TOKEN_ID,
  LP_TOKENS_PER_VOTE,
  MAX_LP_VOTES,
  getWrappBalance,
  getNftCount,
  getLpTokenCount,
  isEligible,
  maxVotesForBalance,
  loadProposals,
  createProposal,
  castVote,
  editProposal,
  deleteProposal,
  addComment,
  canModifyProposal,
  isDAOAdmin,
  setAdminListCache,
  DAO_FOUNDER_ACCOUNT,
  fetchDaoAdmins,
  addDaoAdmin,
  removeDaoAdmin,
  formatTokenCount,
  formatCommentTime,
  timeRemaining,
  type Proposal,
  type ProposalCategory,
  type ProposalStatus,
} from "../utils/dao";
import { authenticate, hasValidSession } from "../utils/auth";
import { SpinWheel } from "./SpinWheel";
import { OwnerControlPanel } from "./OwnerControlPanel";
import { DAOProposalListSkeleton } from "./Skeletons";

// ── Filter Tabs ──────────────────────────────────────────────────────

type FilterKey = "all" | "active" | "passed" | "rejected";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "passed", label: "Passed" },
  { key: "rejected", label: "Rejected" },
];

const CATEGORIES: ProposalCategory[] = [
  "Fees",
  "Staking",
  "Listing",
  "Tokenomics",
  "Features",
  "Partnership",
  "Governance",
  "Other",
];

const DURATIONS = [
  { days: 3, label: "3 days" },
  { days: 5, label: "5 days" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
];

// ── Status Helpers ───────────────────────────────────────────────────

function statusBadgeClasses(s: ProposalStatus): string {
  switch (s) {
    case "active":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "passed":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "rejected":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "pending":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  }
}

function StatusIcon({ status }: { status: ProposalStatus }) {
  switch (status) {
    case "active":
      return <Vote className="w-3.5 h-3.5" />;
    case "passed":
      return <CheckCircle className="w-3.5 h-3.5" />;
    case "rejected":
      return <XCircle className="w-3.5 h-3.5" />;
    case "pending":
      return <Clock className="w-3.5 h-3.5" />;
  }
}

// ── Main Component ───────────────────────────────────────────────────

export function DAO() {
  const {
    hederaAccount,
    hederaNetwork,
    hashPackSession,
    connectHashPack,
    isConnectingHedera,
    refreshHederaBalance,
  } = useWallet();
  const { isDark, isSky } = useTheme();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [daoTab, setDaoTab] = useState<"governance" | "spin">("governance");
  const [voteConfirm, setVoteConfirm] = useState<{
    id: string;
    direction: "for" | "against";
  } | null>(null);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminList, setAdminList] = useState<string[]>([DAO_FOUNDER_ACCOUNT]);

  // ── Derived state (must be above useEffects that reference them) ───

  const tokens = hederaAccount?.tokens ?? [];
  const wrappBalance = getWrappBalance(tokens, hederaNetwork);
  const nftCount = getNftCount(tokens);
  const lpBalance = getLpTokenCount(tokens);
  const eligible = isEligible(tokens, hederaNetwork);
  const maxVotes = maxVotesForBalance(tokens, hederaNetwork);
  const connected = !!hashPackSession?.accountId;
  const accountId = hashPackSession?.accountId ?? "";
  // isAdmin derived from server-populated admin cache (updated via fetchDaoAdmins)
  const [isAdmin, setIsAdmin] = useState(() => isDAOAdmin(accountId));
  // Owner (0.0.518487) has elevated privileges — admin management is owner-only
  const isOwner = accountId === DAO_FOUNDER_ACCOUNT;

  // ── ED25519 Session State (security review SEC-02) ────────────────────────
  // All mutating DAO actions (vote, comment, create, edit, delete) require
  // an ED25519 session (SEC-01). Session status is tracked for UI indicators
  // and auto-authenticated before the first mutating action.

  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    accountId ? hasValidSession(accountId) : false
  );
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Sync session status when accountId changes or after actions
  const refreshSessionStatus = useCallback(() => {
    setIsAuthenticated(accountId ? hasValidSession(accountId) : false);
  }, [accountId]);

  // Check session status periodically (catches expiry within the 30-min window)
  useEffect(() => {
    refreshSessionStatus();
    const iv = setInterval(refreshSessionStatus, 30_000);
    return () => clearInterval(iv);
  }, [refreshSessionStatus]);

  /**
   * Ensure an active ED25519 session before performing a mutating action.
   * If no session exists, triggers the wallet signing prompt (one-time per
   * 30-min window). Returns true if a valid session exists after the call.
   *
   * UX flow:
   *   1. hasValidSession? → proceed immediately (no wallet prompt)
   *   2. No session → toast "Signing in..." → authenticate() → HashPack prompt
   *   3. User signs → session created → return true
   *   4. User rejects → error toast → return false
   */
  const ensureSession = useCallback(async (): Promise<boolean> => {
    // Fast path: session already active
    if (hasValidSession(accountId)) {
      setIsAuthenticated(true);
      return true;
    }

    // Trigger wallet signing
    setIsAuthenticating(true);
    const signingToast = toast.loading(
      "Sign the message in HashPack to authenticate...",
      { duration: 30_000 }
    );

    try {
      await authenticate(accountId);
      toast.dismiss(signingToast);
      toast.success("Signed in — session active for 30 minutes", { duration: 3000 });
      setIsAuthenticated(true);
      return true;
    } catch (err: any) {
      toast.dismiss(signingToast);
      const msg = err?.message || "Authentication failed";
      
      // ── AUTH-FIX-2026-02: User-friendly error messages ──
      if (msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("cancel")) {
        toast.error("Signing cancelled — you need to sign to participate", { duration: 5000 });
      } else if (msg.toLowerCase().includes("key length") || msg.toLowerCase().includes("key type") || msg.toLowerCase().includes("key format")) {
        // Key format/validation errors
        toast.error(
          "Wallet authentication failed. Your wallet may be using an unsupported key type. " +
          "Please try reconnecting your wallet or contact support.",
          { duration: 8000 }
        );
        console.error("[DAO] Key validation error:", msg);
      } else if (msg.toLowerCase().includes("signature verification failed") || msg.toLowerCase().includes("signature_invalid")) {
        // Signature verification failed — all server-side strategies exhausted
        toast.error(
          "Signature verification failed. Please disconnect and reconnect your wallet, then try again.",
          { duration: 8000 }
        );
        console.error("[DAO] Signature verification error:", msg);
      } else if (msg.toLowerCase().includes("mirror node") || msg.toLowerCase().includes("unavailable")) {
        // Hedera Mirror Node connectivity issues
        toast.error(
          "Hedera network temporarily unavailable. Please wait a moment and try again.",
          { duration: 6000 }
        );
      } else if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("404")) {
        // Account not found on Mirror Node
        toast.error(
          "Account not found on Hedera. Make sure you're connected to mainnet.",
          { duration: 6000 }
        );
      } else {
        // Generic error with original message
        toast.error(`Sign-in failed: ${msg}`, { duration: 5000 });
      }
      return false;
    } finally {
      setIsAuthenticating(false);
      refreshSessionStatus();
    }
  }, [accountId, refreshSessionStatus]);

  /**
   * Proactive sign-in handler for the EligibilityCard button.
   * Same flow as ensureSession but exposed as a standalone action.
   */
  const handleSignIn = useCallback(async () => {
    if (isAuthenticating) return;
    await ensureSession();
  }, [ensureSession, isAuthenticating]);

  // Load proposals from server on mount
  useEffect(() => {
    loadProposals().then((p) => {
      setProposals(p);
      setLoading(false);
    });
  }, []);

  // Discover admin status from server on wallet connect
  // PASSIVE: Uses existing session only — never triggers a signing prompt.
  // Admin status discovered either from client cache (covers founder) or
  // from server when a session already exists (covers dynamically added admins).
  // If no session, admin status will be discovered after the user's first action.
  useEffect(() => {
    if (!accountId) { setIsAdmin(false); return; }
    // Quick client-side check first (covers founder instantly)
    if (isDAOAdmin(accountId)) {
      setIsAdmin(true);
    }
    // Server check — fetchDaoAdmins uses ED25519 session token (if available)
    fetchDaoAdmins(accountId).then((result) => {
      if (result.error === "no_account") {
        // No account connected — rely on client cache only.
        return;
      }
      if (!result.error && result.admins.includes(accountId)) {
        setIsAdmin(true);
        setAdminList(result.admins);
      } else if (!result.error) {
        // Server responded but user not in admin list
        setIsAdmin(false);
        setAdminList(result.admins);
      }
      // On error (e.g. network), keep current isAdmin state from cache
    });
  }, [accountId]);

  // Re-fetch proposals every 60s (catch expired ones, new votes, etc.)
  useEffect(() => {
    const iv = setInterval(async () => {
      const p = await loadProposals();
      setProposals(p);
    }, 60_000);
    return () => clearInterval(iv);
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return proposals;
    return proposals.filter((p) => p.status === filter);
  }, [proposals, filter]);

  const stats = useMemo(() => {
    const active = proposals.filter((p) => p.status === "active").length;
    const passed = proposals.filter((p) => p.status === "passed").length;
    const totalVoters = new Set(
      proposals.flatMap((p) => Object.keys(p.voterLog))
    ).size;
    return { active, passed, totalVoters, total: proposals.length };
  }, [proposals]);

  // ── Helpers ─────────────────────────────────────────────────────────

  // After any successful authenticated action, try to discover admin status
  // since we now have a valid session. This is fire-and-forget.
  const refreshAdminStatus = useCallback(() => {
    if (!accountId) return;
    fetchDaoAdmins(accountId).then((result) => {
      if (!result.error) {
        setAdminList(result.admins);
        setIsAdmin(result.admins.includes(accountId));
      }
    });
  }, [accountId]);

  // ── Handlers (all async — server-authoritative) ───────────────────

  const handleConnect = useCallback(async () => {
    await connectHashPack(hederaNetwork);
  }, [connectHashPack, hederaNetwork]);

  const handleRefreshBalance = useCallback(async () => {
    setRefreshing(true);
    await refreshHederaBalance();
    // Also refresh proposals from server
    const p = await loadProposals();
    setProposals(p);
    setRefreshing(false);
  }, [refreshHederaBalance]);

  const handleVote = useCallback(
    async (proposalId: string, direction: "for" | "against") => {
      if (!connected || !eligible || maxVotes <= 0 || actionLoading) return;

      // Ensure ED25519 session before server call (security review SEC-02)
      if (!(await ensureSession())) return;

      setActionLoading(true);
      try {
        const result = await castVote(accountId, proposalId, direction);
        if (result.success && result.proposal) {
          // Update the specific proposal in state
          setProposals((prev) =>
            prev.map((p) => (p.id === proposalId ? result.proposal! : p))
          );
          setVoteConfirm(null);
          toast.success(
            `Vote cast ${direction} with ${result.votingPower}x power`,
            { duration: 4000 }
          );
          // Session now exists — discover admin status if not yet known
          refreshAdminStatus();
        } else {
          toast.error(result.error || "Vote failed", { duration: 5000 });
        }
      } catch (err: any) {
        toast.error(err?.message || "Vote failed", { duration: 5000 });
      } finally {
        setActionLoading(false);
      }
    },
    [connected, eligible, maxVotes, accountId, actionLoading, refreshAdminStatus, ensureSession]
  );

  const hasVotedOn = useCallback(
    (p: Proposal): { direction: "for" | "against"; weight: number } | null => {
      return p.voterLog[accountId] ?? null;
    },
    [accountId]
  );

  const handleDelete = useCallback(
    async (proposalId: string) => {
      if (actionLoading) return;
      if (!(await ensureSession())) return;
      setActionLoading(true);
      try {
        const result = await deleteProposal(accountId, proposalId);
        if (result.error) {
          toast.error(result.error, { duration: 5000 });
        } else {
          setProposals(result.proposals);
          setDeleteConfirmId(null);
          if (expandedId === proposalId) setExpandedId(null);
          toast.success("Proposal deleted", { duration: 3000 });
          refreshAdminStatus();
        }
      } catch (err: any) {
        toast.error(err?.message || "Delete failed", { duration: 5000 });
      } finally {
        setActionLoading(false);
      }
    },
    [accountId, expandedId, actionLoading, refreshAdminStatus, ensureSession]
  );

  const handleEdit = useCallback(
    async (proposalId: string, updates: { title?: string; description?: string; category?: ProposalCategory }) => {
      if (actionLoading) return;
      if (!(await ensureSession())) return;
      setActionLoading(true);
      try {
        const result = await editProposal(accountId, proposalId, updates);
        if (result.error) {
          toast.error(result.error, { duration: 5000 });
        } else {
          setProposals(result.proposals);
          setEditingProposal(null);
          toast.success("Proposal updated", { duration: 3000 });
          refreshAdminStatus();
        }
      } catch (err: any) {
        toast.error(err?.message || "Edit failed", { duration: 5000 });
      } finally {
        setActionLoading(false);
      }
    },
    [accountId, actionLoading, refreshAdminStatus, ensureSession]
  );

  const handleAddComment = useCallback(
    async (proposalId: string, text: string) => {
      if (actionLoading) return;
      if (!(await ensureSession())) return;
      setActionLoading(true);
      try {
        const result = await addComment(accountId, proposalId, text);
        if (result.success && result.proposal) {
          setProposals((prev) =>
            prev.map((p) => (p.id === proposalId ? result.proposal! : p))
          );
          toast.success("Comment added", { duration: 2000 });
          refreshAdminStatus();
        } else {
          toast.error(result.error || "Comment failed", { duration: 5000 });
        }
      } catch (err: any) {
        toast.error(err?.message || "Comment failed", { duration: 5000 });
      } finally {
        setActionLoading(false);
      }
    },
    [accountId, actionLoading, refreshAdminStatus, ensureSession]
  );

  const handleCreate = useCallback(
    async (title: string, desc: string, cat: ProposalCategory, days: number, quorum: number) => {
      if (actionLoading) return;
      if (!(await ensureSession())) return;
      setActionLoading(true);
      try {
        const result = await createProposal(accountId, title, desc, cat, days, quorum);
        if (result.error) {
          toast.error(result.error, { duration: 5000 });
        } else {
          setProposals(result.proposals);
          toast.success("Proposal created", { duration: 3000 });
          refreshAdminStatus();
        }
      } catch (err: any) {
        toast.error(err?.message || "Create failed", { duration: 5000 });
      } finally {
        setActionLoading(false);
        setShowCreate(false);
      }
    },
    [accountId, actionLoading, refreshAdminStatus, ensureSession]
  );

  // ── Render: Not connected ──────────────────────────────────────────

  if (!connected) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center min-h-[60vh] py-20">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col items-center"
          >
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 ${
              isDark
                ? "bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/20"
                : "bg-gradient-to-br from-purple-100 to-blue-100 border border-purple-200"
            }`}>
              <Wallet className={`w-10 h-10 ${isDark ? "text-purple-400" : "text-purple-500"}`} />
            </div>
            <h3 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent mb-3">
              Connect a Wallet
            </h3>
            <p className={`text-sm max-w-sm text-center leading-relaxed mb-6 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Connect your HashPack wallet to participate in HBAR.ħ governance.
              You need at least{" "}
              <span className={`font-semibold ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>{formatTokenCount(GATE_THRESHOLD)} HBAR.ħ</span>{" "}
              tokens or <span className={`font-semibold ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>1 VIP NFT</span> to vote or create proposals.
            </p>
            <button
              onClick={handleConnect}
              disabled={isConnectingHedera}
              className="px-8 py-3 rounded-xl transition-all duration-300 disabled:opacity-50 flex items-center gap-2 text-white shadow-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 shadow-purple-500/25"
            >
              <Wallet className="w-5 h-5" />
              {isConnectingHedera ? "Connecting..." : "Connect HashPack"}
            </button>
          </motion.div>
        </div>
        {/* Show proposals read-only even when not connected */}
        {!loading && proposals.length > 0 && (
          <ProposalList
            proposals={proposals}
            filter={filter}
            filtered={filtered}
            stats={stats}
            setFilter={setFilter}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            canVote={false}
            onVote={async () => {}}
            hasVotedOn={() => null}
            voteConfirm={voteConfirm}
            setVoteConfirm={setVoteConfirm}
            votingPower={0}
            accountId=""
            onDelete={async () => {}}
            onEdit={() => {}}
            deleteConfirmId={null}
            setDeleteConfirmId={() => {}}
            onAddComment={async () => {}}
            canComment={false}
            actionLoading={false}
          />
        )}
      </div>
    );
  }

  // ── Render: Connected but not eligible ─────────────────────────────

  if (!eligible) {
    return (
      <div className="space-y-6">
        <EligibilityCard
          wrappBalance={wrappBalance}
          nftCount={nftCount}
          lpBalance={lpBalance}
          network={hederaNetwork}
          accountId={accountId}
          onRefresh={handleRefreshBalance}
          refreshing={refreshing}
        />
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h3 className={`text-lg mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>Insufficient Holdings</h3>
          <p className={`text-center max-w-md ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            You hold{" "}
            <span className={isDark ? "text-white" : "text-gray-900"}>{formatTokenCount(wrappBalance)}</span>{" "}
            HBAR.ħ and <span className={isDark ? "text-white" : "text-gray-900"}>{nftCount}</span> VIP NFTs. You need at least{" "}
            <span className={isSky ? "text-sky-400" : "text-pink-400"}>{formatTokenCount(GATE_THRESHOLD)} HBAR.ħ</span>,{" "}
            <span className={isSky ? "text-sky-400" : "text-pink-400"}>1 VIP NFT</span>, or{" "}
            <span className={isSky ? "text-sky-400" : "text-pink-400"}>{formatTokenCount(LP_TOKENS_PER_VOTE)} LP tokens</span>.
            Acquire more on the{" "}
            <a href="/swap" className={`underline underline-offset-2 ${isSky ? "text-sky-400 hover:text-sky-300" : "text-pink-400 hover:text-pink-300"}`}>
              Swap
            </a>{" "}
            page.
          </p>
        </div>
        {/* Still show proposals read-only */}
        <ProposalList
          proposals={proposals}
          filter={filter}
          filtered={filtered}
          stats={stats}
          setFilter={setFilter}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          canVote={false}
          onVote={async () => {}}
          hasVotedOn={() => null}
          voteConfirm={voteConfirm}
          setVoteConfirm={setVoteConfirm}
          votingPower={0}
          accountId=""
          onDelete={async () => {}}
          onEdit={() => {}}
          deleteConfirmId={null}
          setDeleteConfirmId={() => {}}
          onAddComment={async () => {}}
          canComment={false}
          actionLoading={false}
        />
      </div>
    );
  }

  // ── Render: Eligible ───────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {isAdmin && daoTab === "governance" && (
        <div className="flex justify-end gap-2">
          {/* Admin management — OWNER ONLY (0.0.518487) */}
          {isOwner && <button
            onClick={() => setShowAdminPanel((v) => !v)}
            className={`px-3 py-2.5 rounded-lg transition-all duration-200 flex items-center gap-2 text-xs border disabled:opacity-50 ${
              showAdminPanel
                ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                : isDark
                  ? "bg-slate-800/50 border-white/5 text-slate-400 hover:text-white hover:border-white/10"
                  : "bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-900"
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            Admin
          </button>}
          <button
            onClick={() => setShowCreate(true)}
            disabled={actionLoading}
            className={`px-5 py-2.5 rounded-lg transition-all duration-200 flex items-center gap-2 text-white disabled:opacity-50 ${
              isSky
                ? "bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 shadow-lg shadow-sky-500/25"
                : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500"
            }`}
          >
            <Plus className="w-4 h-4" />
            New Proposal
          </button>
        </div>
      )}

      {/* ── Admin Management Panel (toggle-hidden) — OWNER ONLY ── */}
      {isOwner && showAdminPanel && (
        <div className="space-y-4">
          <AdminManagementPanel
            accountId={accountId}
            adminList={adminList}
            setAdminList={setAdminList}
            actionLoading={actionLoading}
            setActionLoading={setActionLoading}
          />
          <OwnerControlPanel />
        </div>
      )}

      <EligibilityCard
        wrappBalance={wrappBalance}
        nftCount={nftCount}
        lpBalance={lpBalance}
        network={hederaNetwork}
        accountId={accountId}
        onRefresh={handleRefreshBalance}
        refreshing={refreshing}
        maxVotes={maxVotes}
        isAdmin={isAdmin}
        isAuthenticated={isAuthenticated}
        isAuthenticating={isAuthenticating}
        onSignIn={handleSignIn}
      />

      {/* ── DAO Section Tabs ── */}
      <div className={`rounded-xl p-1 flex gap-1 border ${isDark ? "bg-slate-900/50 border-white/5" : "bg-gray-100/80 border-gray-200"}`}>
        <button
          onClick={() => setDaoTab("governance")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            daoTab === "governance"
              ? isSky
                ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/25"
                : "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
              : isDark
                ? "text-slate-400 hover:text-white hover:bg-slate-800/50"
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-200/60"
          }`}
        >
          <Vote className="w-4 h-4" />
          Governance
        </button>
        <button
          onClick={() => setDaoTab("spin")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            daoTab === "spin"
              ? isSky
                ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/25"
                : "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
              : isDark
                ? "text-slate-400 hover:text-white hover:bg-slate-800/50"
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-200/60"
          }`}
        >
          <Gift className="w-4 h-4" />
          Free Spin
        </button>
      </div>

      {/* ── Tab Content ── */}
      {daoTab === "governance" && (
        <>
          {loading ? (
            <DAOProposalListSkeleton rows={4} />
          ) : (
            <ProposalList
              proposals={proposals}
              filter={filter}
              filtered={filtered}
              stats={stats}
              setFilter={setFilter}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              canVote={maxVotes > 0}
              onVote={handleVote}
              hasVotedOn={hasVotedOn}
              voteConfirm={voteConfirm}
              setVoteConfirm={setVoteConfirm}
              votingPower={maxVotes}
              accountId={accountId}
              onDelete={handleDelete}
              onEdit={(p) => setEditingProposal(p)}
              deleteConfirmId={deleteConfirmId}
              setDeleteConfirmId={setDeleteConfirmId}
              onAddComment={handleAddComment}
              canComment={true}
              actionLoading={actionLoading}
            />
          )}
        </>
      )}

      {daoTab === "spin" && (
        <SpinWheel accountId={accountId} />
      )}

      {showCreate && isAdmin && (
        <CreateProposalModal
          accountId={accountId}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          actionLoading={actionLoading}
        />
      )}

      {editingProposal && (
        <EditProposalModal
          proposal={editingProposal}
          onClose={() => setEditingProposal(null)}
          onSave={(updates) => handleEdit(editingProposal.id, updates)}
          actionLoading={actionLoading}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function EligibilityCard({
  wrappBalance,
  nftCount,
  lpBalance = 0,
  network,
  accountId,
  onRefresh,
  refreshing,
  maxVotes,
  isAdmin,
  isAuthenticated,
  isAuthenticating,
  onSignIn,
}: {
  wrappBalance: number;
  nftCount: number;
  lpBalance?: number;
  network: string;
  accountId: string;
  onRefresh: () => void;
  refreshing: boolean;
  maxVotes?: number;
  isAdmin?: boolean;
  isAuthenticated?: boolean;
  isAuthenticating?: boolean;
  onSignIn?: () => void;
}) {
  const { isDark, isSky } = useTheme();
  const eligible = wrappBalance >= GATE_THRESHOLD || nftCount >= 1 || lpBalance >= LP_TOKENS_PER_VOTE;
  const tokenId = HBARH_TOKEN_ID[network] ?? "\u2014";
  const tokenVotes = Math.floor(wrappBalance / TOKENS_PER_VOTE);
  const nftVotes = Math.floor(nftCount / NFTS_PER_VOTE);
  const lpVotes = Math.floor(lpBalance / LP_TOKENS_PER_VOTE);

  return (
    <div
      className={`rounded-xl p-4 md:p-5 border backdrop-blur-sm ${
        eligible
          ? isDark
            ? "bg-gradient-to-br from-pink-900/20 to-purple-900/20 border-pink-500/25"
            : "bg-gradient-to-br from-pink-50 to-purple-50 border-pink-200"
          : isDark
            ? "bg-gradient-to-br from-amber-900/10 to-orange-900/10 border-amber-500/20"
            : "bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {eligible ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          ) : (
            <ShieldX className="w-5 h-5 text-amber-400" />
          )}
          <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
            {eligible ? "Governance Eligible" : "Not Eligible"}
          </span>
          {isAdmin && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gradient-to-r from-pink-500/15 to-purple-500/15 border ${isDark ? "border-pink-500/30 text-pink-300" : "border-pink-400/40 text-pink-600"}`}>
              <Crown className="w-3 h-3" />
              DAO Admin
            </span>
          )}
        </div>
        <Tip content="Refresh balance from Mirror Node">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className={`transition-colors p-1 ${isDark ? "text-slate-400 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
        </Tip>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <div className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-slate-600"}`}>HBAR.ħ Balance</div>
          <div className={`text-lg ${isDark ? "text-white" : "text-gray-900"}`}>{formatTokenCount(wrappBalance)}</div>
          <div className={`text-xs ${isDark ? "text-slate-500" : "text-slate-600"}`}>{Math.min(tokenVotes, MAX_TOKEN_VOTES)} vote{Math.min(tokenVotes, MAX_TOKEN_VOTES) !== 1 ? "s" : ""} from tokens{tokenVotes > MAX_TOKEN_VOTES ? ` (capped from ${tokenVotes})` : ""}</div>
        </div>
        <div>
          <div className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-slate-600"}`}>VIP NFTs Held</div>
          <div className={`text-lg flex items-center gap-1.5 ${isDark ? "text-white" : "text-gray-900"}`}>
            <ImageIcon className="w-4 h-4 text-purple-400" />
            {nftCount}
          </div>
          <div className={`text-xs ${isDark ? "text-slate-500" : "text-slate-600"}`}>{Math.min(nftVotes, MAX_NFT_VOTES)} vote{Math.min(nftVotes, MAX_NFT_VOTES) !== 1 ? "s" : ""} from NFTs{nftVotes > MAX_NFT_VOTES ? ` (capped from ${nftVotes})` : ""}</div>
        </div>
        <div>
          <div className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-slate-600"}`}>LP Tokens</div>
          <div className={`text-lg ${isDark ? "text-white" : "text-gray-900"}`}>{formatTokenCount(lpBalance)}</div>
          <div className={`text-xs ${isDark ? "text-slate-500" : "text-slate-600"}`}>{Math.min(lpVotes, MAX_LP_VOTES)} vote{Math.min(lpVotes, MAX_LP_VOTES) !== 1 ? "s" : ""} from LP{lpVotes > MAX_LP_VOTES ? ` (capped from ${lpVotes})` : ""}</div>
        </div>
        {maxVotes !== undefined && (
          <div>
            <div className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-slate-600"}`}>Voting Power</div>
            <div className={`text-lg ${isSky ? "text-sky-400" : "text-pink-400"}`}>{maxVotes}x</div>
            <div className={`text-xs ${isDark ? "text-slate-500" : "text-slate-600"}`}>per proposal</div>
          </div>
        )}
        <div>
          <div className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-slate-600"}`}>Security</div>
          <div className="text-xs text-emerald-400 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            Server-verified
          </div>
          <div className={`text-xs ${isDark ? "text-slate-500" : "text-slate-600"}`}>Votes verified on-chain</div>
        </div>
      </div>

      {/* ── LP Token Benefits Banner ── */}
      {lpBalance >= LP_TOKENS_PER_VOTE && (
        <div className={`mt-4 rounded-lg p-3 border ${isDark ? "bg-blue-500/5 border-blue-500/20" : "bg-blue-50 border-blue-200"}`}>
          <div className="flex items-start gap-2">
            <Gift className={`w-4 h-4 mt-0.5 shrink-0 ${isSky ? "text-sky-400" : "text-blue-400"}`} />
            <div>
              <div className={`text-xs font-semibold mb-0.5 ${isDark ? "text-blue-300" : "text-blue-700"}`}>
                Liquidity Provider Benefits Active
              </div>
              <div className={`text-[10px] leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Your ssLP-HBAR-HBAR.ħ position grants full VIP/DAO membership: governance voting ({Math.min(lpVotes, MAX_LP_VOTES)} LP vote{Math.min(lpVotes, MAX_LP_VOTES) !== 1 ? "s" : ""}), proposal commenting, VIP chat access, and spin wheel eligibility &mdash; identical to HBAR.ħ token holders.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Session Status Indicator (security review SEC-02) ── */}
      {eligible && onSignIn && (
        <div className={`mt-3 pt-3 border-t ${isDark ? "border-white/5" : "border-gray-200"}`}>
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className={`text-xs ${isDark ? "text-emerald-400/80" : "text-emerald-600"}`}>
                  Session active
                </span>
              </div>
              <KeyRound className={`w-3 h-3 ${isDark ? "text-emerald-400/50" : "text-emerald-500/50"}`} />
              <span className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                ED25519 verified &middot; votes, comments & proposals authorized
              </span>
            </div>
          ) : isAuthenticating ? (
            <div className="flex items-center gap-2">
              <Loader2 className={`w-3.5 h-3.5 animate-spin ${isDark ? "text-amber-400" : "text-amber-500"}`} />
              <span className={`text-xs ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                Waiting for wallet signature...
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onSignIn}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                  isDark
                    ? "bg-amber-500/10 border-amber-500/25 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/40"
                    : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                }`}
              >
                <LogIn className="w-3 h-3" />
                Sign In to Participate
              </button>
              <span className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                One wallet signature &middot; 30-min session &middot; no fees
              </span>
            </div>
          )}
        </div>
      )}

      <div className={`mt-3 pt-3 border-t flex items-center gap-2 text-xs ${isDark ? "border-white/5 text-slate-500" : "border-gray-200 text-slate-600"}`}>
        <Info className="w-3 h-3 shrink-0" />
        <span>
          Account: <span className={`font-mono ${isDark ? "text-slate-400" : "text-slate-700"}`}>{accountId}</span> |{" "}
          Token: <span className={`font-mono ${isDark ? "text-slate-400" : "text-slate-700"}`}>{tokenId}</span> |{" "}
          NFT: <span className={`font-mono ${isDark ? "text-slate-400" : "text-slate-700"}`}>{VIP_NFT_TOKEN_ID}</span> |{" "}
          Gate: {formatTokenCount(GATE_THRESHOLD)} HBAR.ħ or 1 NFT |{" "}
          Max: {MAX_TOKEN_VOTES} token votes + {MAX_NFT_VOTES} NFT vote |{" "}
          {NFTS_PER_VOTE} NFTs = 1 vote
        </span>
      </div>
    </div>
  );
}

function ProposalList({
  proposals,
  filter,
  filtered,
  stats,
  setFilter,
  expandedId,
  setExpandedId,
  canVote,
  onVote,
  hasVotedOn,
  voteConfirm,
  setVoteConfirm,
  votingPower,
  accountId,
  onDelete,
  onEdit,
  deleteConfirmId,
  setDeleteConfirmId,
  onAddComment,
  canComment,
  actionLoading,
}: {
  proposals: Proposal[];
  filter: FilterKey;
  filtered: Proposal[];
  stats: { active: number; passed: number; totalVoters: number; total: number };
  setFilter: (f: FilterKey) => void;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  canVote: boolean;
  onVote: (id: string, dir: "for" | "against") => void;
  hasVotedOn: (p: Proposal) => { direction: "for" | "against"; weight: number } | null;
  voteConfirm: { id: string; direction: "for" | "against" } | null;
  setVoteConfirm: (v: { id: string; direction: "for" | "against" } | null) => void;
  votingPower: number;
  accountId: string;
  onDelete: (id: string) => void;
  onEdit: (p: Proposal) => void;
  deleteConfirmId: string | null;
  setDeleteConfirmId: (id: string | null) => void;
  onAddComment: (proposalId: string, text: string) => void;
  canComment: boolean;
  actionLoading: boolean;
}) {
  const { isDark } = useTheme();
  return (
    <>
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<Vote className="w-4 h-4 text-blue-400" />}
          label="Active"
          value={stats.active}
          accent="blue"
        />
        <StatCard
          icon={<CheckCircle className="w-4 h-4 text-emerald-400" />}
          label="Passed"
          value={stats.passed}
          accent="emerald"
        />
        <StatCard
          icon={<Users className="w-4 h-4 text-purple-400" />}
          label="Unique Voters"
          value={stats.totalVoters}
          accent="purple"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm transition-all duration-200 whitespace-nowrap ${
              filter === f.key
                ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                : "bg-slate-800/40 text-slate-400 hover:text-white border border-white/5"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 && proposals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-xl bg-slate-800/40 border border-white/5 flex items-center justify-center mb-4">
              <Vote className="w-7 h-7 text-slate-600" />
            </div>
            <h3 className="text-slate-400 mb-1">No Proposals Yet</h3>
            <p className="text-xs text-slate-600 max-w-xs">
              Governance proposals will appear here once the DAO admin publishes them. Check back soon.
            </p>
          </div>
        )}
        {filtered.length === 0 && proposals.length > 0 && (
          <div className="text-center py-12 text-slate-500">
            No proposals match this filter.
          </div>
        )}
        {filtered.map((p) => {
          const total = p.votesFor + p.votesAgainst;
          const forPct = total > 0 ? (p.votesFor / total) * 100 : 50;
          const quorumMet = total >= p.quorum;
          const voted = hasVotedOn(p);
          const isActive = p.status === "active" || p.status === "pending";
          const expanded = expandedId === p.id;
          const confirming = voteConfirm?.id === p.id;
          const canModify = accountId && canModifyProposal(p, accountId);
          const isDeleting = deleteConfirmId === p.id;
          const commentCount = (p.comments ?? []).length;
          const modifyIsAdmin = isDAOAdmin(accountId);

          return (
            <div
              key={p.id}
              className="bg-slate-900/30 border border-white/5 rounded-xl overflow-hidden hover:border-pink-500/20 transition-colors"
            >
              {/* Header */}
              <div
                role="button"
                tabIndex={0}
                className="w-full text-left px-5 py-4 flex items-start gap-3 cursor-pointer"
                onClick={() => setExpandedId(expanded ? null : p.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedId(expanded ? null : p.id); } }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${statusBadgeClasses(
                        p.status
                      )}`}
                    >
                      <StatusIcon status={p.status} />
                      {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                    </span>
                    <span className="text-xs text-slate-500 bg-slate-800/40 px-2 py-0.5 rounded">
                      {p.category}
                    </span>
                    {voted && (
                      <span className="text-xs text-pink-400 bg-pink-500/10 px-2 py-0.5 rounded">
                        Voted {voted.direction}
                      </span>
                    )}
                    {canModify && (
                      <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                        Editable
                      </span>
                    )}
                    {commentCount > 0 && (
                      <span className="text-xs text-slate-400 bg-slate-700/40 px-2 py-0.5 rounded flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        {commentCount}
                      </span>
                    )}
                  </div>
                  <h3 className="text-white truncate">{p.title}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span className="font-mono">{p.proposer}</span>
                    <span>{timeRemaining(p.endsAt)}</span>
                  </div>
                </div>

                {/* Mini vote bar */}
                <div className="shrink-0 w-24 pt-1">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>{p.votesFor}</span>
                    <span>{p.votesAgainst}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-slate-800 flex">
                    <div
                      className="bg-pink-500 transition-all"
                      style={{ width: `${forPct}%` }}
                    />
                    <div
                      className="bg-red-500 transition-all"
                      style={{ width: `${100 - forPct}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 text-center mt-1">
                    {quorumMet ? (
                      <span className="text-emerald-400">Quorum met</span>
                    ) : (
                      `${total}/${p.quorum}`
                    )}
                  </div>
                </div>

                <div className="shrink-0 pt-2 text-slate-500">
                  {expanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {expanded && (
                <div className="px-5 pb-5 border-t border-white/5">
                  {/* Edit / Delete buttons for proposer (before first vote) */}
                  {canModify && (
                    <div className="flex items-center gap-2 mt-4 mb-3">
                      <button
                        onClick={() => onEdit(p)}
                        disabled={actionLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit Proposal
                      </button>
                      {isDeleting ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-400">Delete permanently?</span>
                          <button
                            onClick={() => onDelete(p.id)}
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-lg text-xs bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center gap-1"
                          >
                            {actionLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-3 py-1.5 rounded-lg text-xs bg-slate-700 text-slate-300 hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(p.id)}
                          disabled={actionLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      )}
                      <span className={`text-xs ml-auto ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                        {modifyIsAdmin ? "Admin: full edit control" : "Editable until first vote is cast"}
                      </span>
                    </div>
                  )}

                  <p className="text-slate-400 text-sm mt-4 mb-4 whitespace-pre-wrap">
                    {p.description}
                  </p>

                  {/* Full vote bar */}
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span>
                        <span className="text-pink-400">{p.votesFor}</span>{" "}
                        <span className="text-slate-500">For</span>
                      </span>
                      <span>
                        <span className="text-slate-500">Against</span>{" "}
                        <span className="text-red-400">{p.votesAgainst}</span>
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full overflow-hidden bg-slate-800 flex" role="meter" aria-label="Vote progress" aria-valuenow={Math.round(forPct)} aria-valuemin={0} aria-valuemax={100}>
                      <div
                        className="bg-gradient-to-r from-pink-500 to-pink-400 transition-all"
                        style={{ width: `${forPct}%` }}
                      />
                      <div
                        className="bg-gradient-to-r from-red-500 to-red-400 transition-all"
                        style={{ width: `${100 - forPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-slate-500 mt-1">
                      <span>{forPct.toFixed(1)}%</span>
                      <span>
                        Quorum: {total}/{p.quorum}{" "}
                        {quorumMet && (
                          <CheckCircle className="w-3 h-3 inline text-emerald-400" />
                        )}
                      </span>
                      <span>{(100 - forPct).toFixed(1)}%</span>
                    </div>
                  </div>

                  {/* Vote actions */}
                  {isActive && !voted && canVote && (
                    <>
                      {confirming ? (
                        <div className="bg-slate-800/50 border border-pink-500/20 rounded-lg p-4">
                          <p className="text-sm text-slate-300 mb-3">
                            Cast{" "}
                            <span className="text-white">{votingPower} vote{votingPower > 1 ? "s" : ""}</span>{" "}
                            <span
                              className={
                                voteConfirm.direction === "for"
                                  ? "text-pink-400"
                                  : "text-red-400"
                              }
                            >
                              {voteConfirm.direction}
                            </span>{" "}
                            this proposal?
                            <span className="text-slate-500 text-xs ml-1">
                              (weight verified server-side via Mirror Node)
                            </span>
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                onVote(voteConfirm.id, voteConfirm.direction)
                              }
                              disabled={actionLoading}
                              className="px-4 py-2 bg-gradient-to-r from-pink-600 to-purple-600 rounded-lg text-sm transition-all hover:from-pink-500 hover:to-purple-500 disabled:opacity-50 flex items-center gap-2"
                            >
                              {actionLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                              Confirm Vote ({votingPower}x)
                            </button>
                            <button
                              onClick={() => setVoteConfirm(null)}
                              className="px-4 py-2 bg-slate-800 border border-white/5 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              setVoteConfirm({ id: p.id, direction: "for" })
                            }
                            disabled={actionLoading}
                            aria-label={`Vote for proposal: ${p.title}`}
                            className="flex-1 py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Vote For
                          </button>
                          <button
                            onClick={() =>
                              setVoteConfirm({ id: p.id, direction: "against" })
                            }
                            disabled={actionLoading}
                            aria-label={`Vote against proposal: ${p.title}`}
                            className="flex-1 py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-500/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                          >
                            <XCircle className="w-4 h-4" />
                            Vote Against
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {isActive && !voted && !canVote && votingPower <= 0 && (
                    <div className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                      Insufficient balance to vote. Hold at least {formatTokenCount(GATE_THRESHOLD)} HBAR.ħ or 1 VIP NFT.
                    </div>
                  )}

                  {voted && (
                    <div className="text-sm text-pink-300 bg-pink-500/10 border border-pink-500/20 rounded-lg p-3">
                      You voted{" "}
                      <span className="text-white">{voted.direction}</span> with{" "}
                      {voted.weight} vote{voted.weight > 1 ? "s" : ""}.
                    </div>
                  )}

                  {!isActive && (
                    <div className="text-sm text-slate-500">
                      Voting has ended. Final result:{" "}
                      <span
                        className={
                          p.status === "passed"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                      </span>
                    </div>
                  )}

                  {/* ── Comments Section ── */}
                  <CommentsSection
                    proposal={p}
                    accountId={accountId}
                    canComment={canComment}
                    onAddComment={onAddComment}
                    actionLoading={actionLoading}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Comments Section ─────────────────────────────────────────────────

function CommentsSection({
  proposal,
  accountId,
  canComment,
  onAddComment,
  actionLoading,
}: {
  proposal: Proposal;
  accountId: string;
  canComment: boolean;
  onAddComment: (proposalId: string, text: string) => void;
  actionLoading: boolean;
}) {
  const { isDark } = useTheme();
  const [commentText, setCommentText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const comments = proposal.comments ?? [];
  const displayComments = showAll ? comments : comments.slice(-5);

  const handleSubmit = () => {
    if (!commentText.trim() || !accountId || actionLoading) return;
    onAddComment(proposal.id, commentText);
    setCommentText("");
  };

  return (
    <div className="mt-5 pt-4 border-t border-white/5">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="w-4 h-4 text-purple-400" />
        <span className="text-sm text-slate-300">
          Community Discussion
        </span>
        <span className="text-xs text-slate-600">
          ({comments.length} comment{comments.length !== 1 ? "s" : ""})
        </span>
      </div>

      {/* Comment list */}
      {comments.length > 0 && (
        <div className="space-y-2 mb-3">
          {comments.length > 5 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs text-pink-400 hover:text-pink-300 transition-colors"
            >
              Show {comments.length - 5} older comments...
            </button>
          )}
          {displayComments.map((c) => (
            <div
              key={c.id}
              className="bg-slate-800/30 border border-white/5 rounded-lg px-3 py-2"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-pink-400">
                  {c.author}
                </span>
                {c.author === proposal.proposer && (
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${isDark ? "bg-purple-500/15 text-purple-400 border-purple-500/20" : "bg-purple-50 text-purple-600 border-purple-200"}`}>
                    Proposer
                  </span>
                )}
                <span className={`text-xs ml-auto ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                  {formatCommentTime(c.createdAt)}
                </span>
              </div>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{c.text}</p>
            </div>
          ))}
          {showAll && comments.length > 5 && (
            <button
              onClick={() => setShowAll(false)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Show less
            </button>
          )}
        </div>
      )}

      {comments.length === 0 && (
        <div className="text-xs text-slate-600 mb-3 py-3 text-center bg-slate-800/20 rounded-lg">
          No comments yet. Be the first to share your thoughts.
        </div>
      )}

      {/* Add comment form */}
      {canComment && accountId ? (
        <div className="flex gap-2">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Add a comment or remark..."
            maxLength={500}
            className="flex-1 bg-slate-800/50 border border-white/5 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-pink-500/50 placeholder:text-slate-600"
          />
          <button
            onClick={handleSubmit}
            disabled={!commentText.trim() || actionLoading}
            className={`px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-1.5 ${
              commentText.trim() && !actionLoading
                ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white"
                : "bg-slate-800 text-slate-600 cursor-not-allowed"
            }`}
          >
            {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      ) : !canComment ? (
        <div className="text-xs text-slate-600 italic">
          Hold HBAR.ħ tokens or VIP NFTs to comment.
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: "blue" | "emerald" | "purple";
}) {
  const { isDark } = useTheme();

  const darkStyles: Record<string, string> = {
    blue: "bg-blue-500/10 border-blue-500/20",
    emerald: "bg-emerald-500/10 border-emerald-500/20",
    purple: "bg-purple-500/10 border-purple-500/20",
  };

  const lightStyles: Record<string, string> = {
    blue: "bg-blue-50 border-blue-200",
    emerald: "bg-emerald-50 border-emerald-200",
    purple: "bg-purple-50 border-purple-200",
  };

  const styles = isDark ? darkStyles : lightStyles;

  return (
    <div
      className={`border rounded-xl p-4 backdrop-blur-sm ${styles[accent] ?? styles.blue}`}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{label}</span>
      </div>
      <div className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}

// ── Create Proposal Modal ────────────────────────────────────────────

function CreateProposalModal({
  accountId,
  onClose,
  onCreate,
  actionLoading,
}: {
  accountId: string;
  onClose: () => void;
  onCreate: (

    title: string,
    desc: string,
    cat: ProposalCategory,
    days: number,
    quorum: number
  ) => void;
  actionLoading: boolean;
}) {
  useEscapeKey(onClose);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ProposalCategory>("Features");
  const [duration, setDuration] = useState(7);
  const [quorum, setQuorum] = useState(10);

  const valid = title.trim().length >= 5 && description.trim().length >= 20;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create proposal"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-900 border border-pink-500/20 rounded-xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto">
        <h3 className="text-xl bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent mb-4">
          New Proposal
        </h3>

        <div className="space-y-4">
          <Field label="Title" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Clear, concise title (min 5 chars)"
              className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-pink-500/50"
              maxLength={120}
            />
          </Field>

          <Field label="Category" required>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ProposalCategory)}
              className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-pink-500/50"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Description" required>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed rationale, expected benefits, implementation plan (min 20 chars)"
              rows={4}
              className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-pink-500/50 resize-none"
              maxLength={2000}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration">
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-pink-500/50"
              >
                {DURATIONS.map((d) => (
                  <option key={d.days} value={d.days}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Quorum">
              <input
                type="number"
                value={quorum}
                onChange={(e) => setQuorum(Math.max(1, Number(e.target.value)))}
                min={1}
                max={1000}
                className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-pink-500/50"
              />
            </Field>
          </div>

          <div className="text-xs text-slate-500 bg-slate-800/30 rounded-lg p-3 space-y-1">
            <div>Proposer: <span className="font-mono text-slate-400">{accountId}</span></div>
            <div>Voting opens immediately and closes after {duration} days.</div>
            <div>Quorum: {quorum} total votes required for result to be valid.</div>
            <div className="text-emerald-400/70 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Server-authoritative: proposal stored securely on server, not in browser.
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-slate-800 border border-white/5 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (valid) onCreate(title.trim(), description.trim(), category, duration, quorum);
            }}
            disabled={!valid || actionLoading}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 ${
              valid && !actionLoading
                ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500"
                : "bg-slate-700 text-slate-500 cursor-not-allowed"
            }`}
          >
            {actionLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            Submit Proposal
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Proposal Modal ──────────────────────────────────────────────

function EditProposalModal({
  proposal,
  onClose,
  onSave,
  actionLoading,
}: {
  proposal: Proposal;
  onClose: () => void;
  onSave: (updates: { title?: string; description?: string; category?: ProposalCategory }) => void;
  actionLoading: boolean;
}) {
  useEscapeKey(onClose);

  const { hashPackSession } = useWallet();
  const editAccountId = hashPackSession?.accountId ?? "";
  const editIsAdmin = isDAOAdmin(editAccountId);
  const hasAnyVotes = Object.keys(proposal.voterLog).length > 0;

  const [title, setTitle] = useState(proposal.title);
  const [description, setDescription] = useState(proposal.description);
  const [category, setCategory] = useState<ProposalCategory>(proposal.category);

  const valid = title.trim().length >= 5 && description.trim().length >= 20;
  const hasChanges =
    title.trim() !== proposal.title ||
    description.trim() !== proposal.description ||
    category !== proposal.category;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit proposal"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-900 border border-amber-500/20 rounded-xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto">
        <h3 className="text-xl bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent mb-4 flex items-center gap-2">
          <Pencil className="w-5 h-5 text-amber-400" />
          Edit Proposal
        </h3>

        <div className="text-xs text-amber-400/70 bg-amber-500/10 border border-amber-500/15 rounded-lg p-3 mb-4">
          {editIsAdmin
            ? hasAnyVotes
              ? "Admin override: editing after votes have been cast. Voter tallies are preserved."
              : "You can edit this proposal. As admin, you retain full edit control even after voting begins."
            : "You can edit this proposal because no votes have been cast yet. Once someone votes, the proposal becomes locked."
          }
        </div>

        <div className="space-y-4">
          <Field label="Title" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-amber-500/50"
              maxLength={120}
            />
          </Field>

          <Field label="Category" required>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ProposalCategory)}
              className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-amber-500/50"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Description" required>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-amber-500/50 resize-none"
              maxLength={2000}
            />
          </Field>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-slate-800 border border-white/5 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (valid && hasChanges)
                onSave({ title: title.trim(), description: description.trim(), category });
            }}
            disabled={!valid || !hasChanges || actionLoading}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 ${
              valid && hasChanges && !actionLoading
                ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white"
                : "bg-slate-700 text-slate-500 cursor-not-allowed"
            }`}
          >
            {actionLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1.5">
        {label}
        {required && <span className="text-pink-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ── Admin Management Panel ──────────────────────────────────────────

function AdminManagementPanel({
  accountId,
  adminList,
  setAdminList,
  actionLoading,
  setActionLoading,
}: {
  accountId: string;
  adminList: string[];
  setAdminList: (a: string[]) => void;
  actionLoading: boolean;
  setActionLoading: (v: boolean) => void;
}) {
  const { isDark } = useTheme();
  const [newAdminId, setNewAdminId] = useState("");
  const [step, setStep] = useState<"idle" | "confirm-add" | "confirm-remove">("idle");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isValidFormat = /^0\.0\.\d{1,10}$/.test(newAdminId.trim());
  const alreadyAdmin = adminList.includes(newAdminId.trim());
  const isAtLimit = adminList.length >= 10;

  // ── Add Admin: idle → confirm-add → API call (no wallet signing needed)
  const handleStartAdd = () => {
    if (!isValidFormat || alreadyAdmin || isAtLimit) return;
    setError(null);
    setStep("confirm-add");
  };

  const handleConfirmAdd = async () => {
    setError(null);
    setActionLoading(true);
    try {
      log.info("DAO-Admin", `Adding admin ${newAdminId.trim()} via owner ${accountId}`);
      const result = await addDaoAdmin(accountId, newAdminId.trim());
      if (result.error) {
        console.error(`[DAO-Admin] addDaoAdmin error: code=${result.code} msg=${result.error}`);
        setError(`${result.error}${result.code ? ` [${result.code}]` : ""}`);
      } else {
        setAdminList(result.admins);
        setNewAdminId("");
        toast.success(`Admin added: ${newAdminId.trim()}`, { duration: 4000 });
      }
    } catch (err: any) {
      console.error("[DAO-Admin] handleConfirmAdd exception:", err);
      setError(err?.message || "Failed to add admin");
    } finally {
      setStep("idle");
      setActionLoading(false);
    }
  };

  // ── Remove Admin: confirm-remove → API call (no wallet signing needed)
  const handleStartRemove = (target: string) => {
    setError(null);
    setRemoveTarget(target);
    setStep("confirm-remove");
  };

  const handleConfirmRemove = async () => {
    if (!removeTarget) return;
    setError(null);
    setActionLoading(true);
    try {
      log.info("DAO-Admin", `Removing admin ${removeTarget} via owner ${accountId}`);
      const result = await removeDaoAdmin(accountId, removeTarget);
      if (result.error) {
        console.error(`[DAO-Admin] removeDaoAdmin error: code=${result.code} msg=${result.error}`);
        setError(`${result.error}${result.code ? ` [${result.code}]` : ""}`);
      } else {
        setAdminList(result.admins);
        setRemoveTarget(null);
        toast.success(`Admin removed: ${removeTarget}`, { duration: 4000 });
      }
    } catch (err: any) {
      console.error("[DAO-Admin] handleConfirmRemove exception:", err);
      setError(err?.message || "Failed to remove admin");
    } finally {
      setStep("idle");
      setActionLoading(false);
    }
  };

  const handleCancel = () => {
    setStep("idle");
    setRemoveTarget(null);
    setError(null);
  };

  return (
    <div className={`rounded-xl border p-5 space-y-4 ${
      isDark
        ? "bg-gradient-to-br from-amber-900/10 to-orange-900/10 border-amber-500/20"
        : "bg-amber-50/50 border-amber-200"
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
          <Shield className="w-4.5 h-4.5 text-amber-400" />
        </div>
        <div>
          <h4 className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
            DAO Admin Management
          </h4>
          <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
            {adminList.length}/10 admins &middot; Founder 0.0.518487 is permanent
          </p>
        </div>
      </div>

      {/* Current admin list */}
      <div className="space-y-1.5">
        <div className="text-xs text-slate-500 mb-2">Current Admins</div>
        {adminList.map((admin) => {
          const isFounder = admin === DAO_FOUNDER_ACCOUNT;
          const isSelf = admin === accountId;
          const isRemoving = step === "confirm-remove" && removeTarget === admin;

          return (
            <div
              key={admin}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                isRemoving
                  ? "bg-red-500/10 border-red-500/25"
                  : isDark
                    ? "bg-slate-800/40 border-white/5"
                    : "bg-white border-gray-200"
              }`}
            >
              <span className={`font-mono text-xs flex-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                {admin}
              </span>
              {isFounder && (
                <span className={`text-xs px-1.5 py-0.5 rounded border ${isDark ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-emerald-50 text-emerald-600 border-emerald-200"}`}>
                  Founder
                </span>
              )}
              {isSelf && !isFounder && (
                <span className={`text-xs px-1.5 py-0.5 rounded border ${isDark ? "bg-blue-500/15 text-blue-400 border-blue-500/20" : "bg-blue-50 text-blue-600 border-blue-200"}`}>
                  You
                </span>
              )}
              {!isFounder && !isRemoving && step === "idle" && (
                <Tip content="Remove admin" side="left">
                <button
                  onClick={() => handleStartRemove(admin)}
                  disabled={actionLoading}
                  className="text-slate-500 hover:text-red-400 transition-colors disabled:opacity-30 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                </Tip>
              )}
              {isRemoving && step === "confirm-remove" && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleConfirmRemove}
                    disabled={actionLoading}
                    className="px-2 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {actionLoading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Trash2 className="w-2.5 h-2.5" />}
                    Remove
                  </button>
                  <button
                    onClick={handleCancel}
                    className={`px-2 py-1 rounded text-xs transition-colors ${isDark ? "bg-slate-700 text-slate-300 hover:text-white" : "bg-gray-200 text-gray-600 hover:text-gray-900"}`}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add new admin */}
      {step === "idle" && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Add New Admin</div>
          <div className="flex gap-2">
            <input
              value={newAdminId}
              onChange={(e) => { setNewAdminId(e.target.value); setError(null); }}
              placeholder="0.0.xxxxxx"
              className={`flex-1 bg-slate-800/50 border rounded-lg px-3 py-2 text-sm font-mono outline-none transition-colors ${
                newAdminId && !isValidFormat
                  ? "border-red-500/40 focus:ring-1 focus:ring-red-500/50"
                  : "border-white/5 focus:ring-1 focus:ring-amber-500/50"
              } placeholder:text-slate-600`}
              maxLength={20}
            />
            <button
              onClick={handleStartAdd}
              disabled={!isValidFormat || alreadyAdmin || isAtLimit || actionLoading}
              className={`px-4 py-2 rounded-lg text-sm transition-all flex items-center gap-1.5 ${
                isValidFormat && !alreadyAdmin && !isAtLimit
                  ? "bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed border border-white/5"
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
          {newAdminId && !isValidFormat && (
            <p className={`text-xs ${isDark ? "text-red-400" : "text-red-500"}`}>Enter a valid Hedera account ID (0.0.xxxxx)</p>
          )}
          {alreadyAdmin && isValidFormat && (
            <p className={`text-xs ${isDark ? "text-amber-400" : "text-amber-600"}`}>This account is already an admin</p>
          )}
          {isAtLimit && (
            <p className={`text-xs ${isDark ? "text-amber-400" : "text-amber-600"}`}>Maximum 10 admins reached</p>
          )}
        </div>
      )}

      {/* Confirm add dialog */}
      {step === "confirm-add" && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-white">Confirm Admin Addition</span>
          </div>
          <p className="text-xs text-slate-400">
            You are about to grant DAO admin privileges to:
          </p>
          <div className="font-mono text-sm text-amber-300 bg-slate-900/50 rounded px-3 py-2 border border-amber-500/15">
            {newAdminId.trim()}
          </div>
          <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
            This will give them proposal create/edit/delete rights. Only the owner (0.0.518487) can add or remove admins.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleConfirmAdd}
              disabled={actionLoading}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Confirm Add
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-2.5 bg-slate-800 border border-white/5 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

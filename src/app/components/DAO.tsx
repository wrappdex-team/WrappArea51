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
} from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import {
  HBARH_TOKEN_ID,
  GATE_THRESHOLD,
  TOKENS_PER_VOTE,
  VIP_NFT_TOKEN_ID,
  NFTS_PER_VOTE,
  MAX_TOKEN_VOTES,
  MAX_NFT_VOTES,
  getWrappBalance,
  getNftCount,
  isEligible,
  maxVotesForBalance,
  totalProposalsVotedThisSession,
  loadProposals,
  createProposal,
  castVote,
  editProposal,
  deleteProposal,
  addComment,
  canModifyProposal,
  isDAOAdmin,
  formatTokenCount,
  formatCommentTime,
  timeRemaining,
  type Proposal,
  type ProposalCategory,
  type ProposalStatus,
} from "../utils/dao";
import { SpinWheel } from "./SpinWheel";

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
    connectHashPackModal,
    isConnectingHedera,
    refreshHederaBalance,
  } = useWallet();

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

  // Load proposals on mount
  useEffect(() => {
    setProposals(loadProposals());
  }, []);

  // Re-resolve proposals every 60s (catch expired ones)
  useEffect(() => {
    const iv = setInterval(() => setProposals(loadProposals()), 60_000);
    return () => clearInterval(iv);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────

  const tokens = hederaAccount?.tokens ?? [];
  const wrappBalance = getWrappBalance(tokens, hederaNetwork);
  const nftCount = getNftCount(tokens);
  const eligible = isEligible(tokens, hederaNetwork);
  const maxVotes = maxVotesForBalance(tokens, hederaNetwork);
  const spent = totalProposalsVotedThisSession();
  const connected = !!hashPackSession?.accountId;
  const accountId = hashPackSession?.accountId ?? "";
  const isAdmin = isDAOAdmin(accountId);

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

  // ── Handlers ───────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    await connectHashPackModal(hederaNetwork);
  }, [connectHashPackModal, hederaNetwork]);

  const handleRefreshBalance = useCallback(async () => {
    setRefreshing(true);
    await refreshHederaBalance();
    setRefreshing(false);
  }, [refreshHederaBalance]);

  const handleVote = useCallback(
    (proposalId: string, direction: "for" | "against") => {
      if (!connected || !eligible || maxVotes <= 0) return;

      // Weight = user's full voting power from on-chain balance check
      // 1 vote per 100M HBAR.ħ (max 10) + 1 vote per 3 NFTs (max 1)
      const weight = maxVotes;
      const updated = castVote(proposals, proposalId, accountId, direction, weight);
      if (updated) {
        setProposals(updated);
        setVoteConfirm(null);
      }
    },
    [proposals, connected, eligible, maxVotes, accountId]
  );

  const hasVotedOn = useCallback(
    (p: Proposal): { direction: "for" | "against"; weight: number } | null => {
      return p.voterLog[accountId] ?? null;
    },
    [accountId]
  );

  const handleDelete = useCallback(
    (proposalId: string) => {
      const updated = deleteProposal(proposals, proposalId, accountId);
      if (updated) {
        setProposals(updated);
        setDeleteConfirmId(null);
        if (expandedId === proposalId) setExpandedId(null);
      }
    },
    [proposals, accountId, expandedId]
  );

  const handleEdit = useCallback(
    (proposalId: string, updates: { title?: string; description?: string; category?: ProposalCategory }) => {
      const updated = editProposal(proposals, proposalId, accountId, updates);
      if (updated) {
        setProposals(updated);
        setEditingProposal(null);
      }
    },
    [proposals, accountId]
  );

  const handleAddComment = useCallback(
    (proposalId: string, text: string) => {
      const updated = addComment(proposals, proposalId, accountId, text);
      if (updated) {
        setProposals(updated);
      }
    },
    [proposals, accountId]
  );

  // ── Render: Not connected ──────────────────────────────────────────

  if (!connected) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-600/20 to-purple-600/20 border border-pink-500/30 flex items-center justify-center mb-6">
            <ShieldX className="w-10 h-10 text-pink-400" />
          </div>
          <h3 className="text-xl mb-2">Wallet Required</h3>
          <p className="text-slate-400 text-center max-w-md mb-6">
            Connect your HashPack wallet to participate in HBAR.ħ governance.
            You need at least{" "}
            <span className="text-pink-400">{formatTokenCount(GATE_THRESHOLD)} HBAR.ħ</span>{" "}
            tokens or <span className="text-pink-400">1 VIP NFT</span> to vote or create proposals.
          </p>
          <button
            onClick={handleConnect}
            disabled={isConnectingHedera}
            className="px-8 py-3 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 rounded-lg transition-all duration-200 disabled:opacity-50 flex items-center gap-2"
          >
            <Wallet className="w-5 h-5" />
            {isConnectingHedera ? "Connecting..." : "Connect HashPack"}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Connected but not eligible ─────────────────────────────

  if (!eligible) {
    return (
      <div className="space-y-6">
        <Header />
        <EligibilityCard
          wrappBalance={wrappBalance}
          nftCount={nftCount}
          network={hederaNetwork}
          accountId={accountId}
          onRefresh={handleRefreshBalance}
          refreshing={refreshing}
        />
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h3 className="text-lg mb-2">Insufficient Holdings</h3>
          <p className="text-slate-400 text-center max-w-md">
            You hold{" "}
            <span className="text-white">{formatTokenCount(wrappBalance)}</span>{" "}
            HBAR.ħ and <span className="text-white">{nftCount}</span> VIP NFTs. You need at least{" "}
            <span className="text-pink-400">{formatTokenCount(GATE_THRESHOLD)} HBAR.ħ</span>{" "}
            or <span className="text-pink-400">1 VIP NFT</span>.
            Acquire more on the{" "}
            <a href="/swap" className="text-pink-400 underline underline-offset-2 hover:text-pink-300">
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
          onVote={() => {}}
          hasVotedOn={() => null}
          voteConfirm={voteConfirm}
          setVoteConfirm={setVoteConfirm}
          votingPower={0}
          accountId=""
          onDelete={() => {}}
          onEdit={() => {}}
          deleteConfirmId={null}
          setDeleteConfirmId={() => {}}
          onAddComment={() => {}}
          canComment={false}
        />
      </div>
    );
  }

  // ── Render: Eligible ───────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
        <Header />
        <div className="flex items-center gap-2">
          {isAdmin && daoTab === "governance" && (
            <button
              onClick={() => setShowCreate(true)}
              className="px-5 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 rounded-lg transition-all duration-200 flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              <Plus className="w-4 h-4" />
              New Proposal
            </button>
          )}
        </div>
      </div>

      <EligibilityCard
        wrappBalance={wrappBalance}
        nftCount={nftCount}
        network={hederaNetwork}
        accountId={accountId}
        onRefresh={handleRefreshBalance}
        refreshing={refreshing}
        maxVotes={maxVotes}
        spent={spent}
        isAdmin={isAdmin}
      />

      {/* ── DAO Section Tabs ── */}
      <div className="rounded-xl p-1 flex gap-1 bg-slate-900/50 border border-white/5">
        <button
          onClick={() => setDaoTab("governance")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm transition-all duration-200 ${
            daoTab === "governance"
              ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <Vote className="w-4 h-4" />
          Governance
        </button>
        <button
          onClick={() => setDaoTab("spin")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm transition-all duration-200 ${
            daoTab === "spin"
              ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/20"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <Gift className="w-4 h-4" />
          Free Spin
        </button>
      </div>

      {/* ── Tab Content ── */}
      {daoTab === "governance" && (
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
        />
      )}

      {daoTab === "spin" && (
        <SpinWheel accountId={accountId} />
      )}

      {showCreate && isAdmin && (
        <CreateProposalModal
          accountId={accountId}
          onClose={() => setShowCreate(false)}
          onCreate={(title, desc, cat, days, quorum) => {
            const updated = createProposal(
              proposals,
              title,
              desc,
              cat,
              accountId,
              days,
              quorum
            );
            if (updated) {
              setProposals(updated);
            }
            setShowCreate(false);
          }}
        />
      )}

      {editingProposal && (
        <EditProposalModal
          proposal={editingProposal}
          onClose={() => setEditingProposal(null)}
          onSave={(updates) => handleEdit(editingProposal.id, updates)}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function Header() {
  return (
    <div>
      <h2 className="text-2xl bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent mb-1">
        HBAR.ħ DAO
      </h2>
      <p className="text-slate-400 text-sm">
        Token-gated governance. 100M HBAR.ħ = 1 vote (max {MAX_TOKEN_VOTES}) | 3 VIP NFTs = 1 vote (max {MAX_NFT_VOTES}).
      </p>
    </div>
  );
}

function EligibilityCard({
  wrappBalance,
  nftCount,
  network,
  accountId,
  onRefresh,
  refreshing,
  maxVotes,
  spent,
  isAdmin,
}: {
  wrappBalance: number;
  nftCount: number;
  network: string;
  accountId: string;
  onRefresh: () => void;
  refreshing: boolean;
  maxVotes?: number;
  spent?: number;
  isAdmin?: boolean;
}) {
  const eligible = wrappBalance >= GATE_THRESHOLD || nftCount >= 1;
  const tokenId = HBARH_TOKEN_ID[network] ?? "\u2014";
  const tokenVotes = Math.floor(wrappBalance / TOKENS_PER_VOTE);
  const nftVotes = Math.floor(nftCount / NFTS_PER_VOTE);

  return (
    <div
      className={`rounded-xl p-4 md:p-5 border backdrop-blur-sm ${
        eligible
          ? "bg-gradient-to-br from-pink-900/20 to-purple-900/20 border-pink-500/25"
          : "bg-gradient-to-br from-amber-900/10 to-orange-900/10 border-amber-500/20"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {eligible ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          ) : (
            <ShieldX className="w-5 h-5 text-amber-400" />
          )}
          <span className="text-sm text-slate-300">
            {eligible ? "Governance Eligible" : "Not Eligible"}
          </span>
          {isAdmin && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-gradient-to-r from-pink-500/15 to-purple-500/15 border border-pink-500/30 text-pink-300">
              <Crown className="w-3 h-3" />
              DAO Admin
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-slate-400 hover:text-white transition-colors p-1"
          title="Refresh balance from Mirror Node"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-slate-500 mb-1">HBAR.ħ Balance</div>
          <div className="text-lg text-white">{formatTokenCount(wrappBalance)}</div>
          <div className="text-[10px] text-slate-500">{Math.min(tokenVotes, MAX_TOKEN_VOTES)} vote{Math.min(tokenVotes, MAX_TOKEN_VOTES) !== 1 ? "s" : ""} from tokens{tokenVotes > MAX_TOKEN_VOTES ? ` (capped from ${tokenVotes})` : ""}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">VIP NFTs Held</div>
          <div className="text-lg text-white flex items-center gap-1.5">
            <ImageIcon className="w-4 h-4 text-purple-400" />
            {nftCount}
          </div>
          <div className="text-[10px] text-slate-500">{Math.min(nftVotes, MAX_NFT_VOTES)} vote{Math.min(nftVotes, MAX_NFT_VOTES) !== 1 ? "s" : ""} from NFTs{nftVotes > MAX_NFT_VOTES ? ` (capped from ${nftVotes})` : ""}</div>
        </div>
        {maxVotes !== undefined && (
          <div>
            <div className="text-xs text-slate-500 mb-1">Voting Power</div>
            <div className="text-lg text-pink-400">{maxVotes}x</div>
            <div className="text-[10px] text-slate-500">per proposal</div>
          </div>
        )}
        {spent !== undefined && spent > 0 && (
          <div>
            <div className="text-xs text-slate-500 mb-1">Proposals Voted</div>
            <div className="text-lg text-emerald-400">{spent}</div>
            <div className="text-[10px] text-slate-500">this session</div>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2 text-xs text-slate-500">
        <Info className="w-3 h-3 shrink-0" />
        <span>
          Account: <span className="font-mono text-slate-400">{accountId}</span> |{" "}
          Token: <span className="font-mono text-slate-400">{tokenId}</span> |{" "}
          NFT: <span className="font-mono text-slate-400">{VIP_NFT_TOKEN_ID}</span> |{" "}
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
}) {
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
          const hasVotes = Object.keys(p.voterLog).length > 0;
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
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit Proposal
                      </button>
                      {isDeleting ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-400">Delete permanently?</span>
                          <button
                            onClick={() => onDelete(p.id)}
                            className="px-3 py-1.5 rounded-lg text-xs bg-red-600 text-white hover:bg-red-500 transition-colors"
                          >
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
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      )}
                      <span className="text-[10px] text-slate-600 ml-auto">
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
                    <div className="h-2.5 rounded-full overflow-hidden bg-slate-800 flex">
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
                              (power from {formatTokenCount(votingPower * TOKENS_PER_VOTE)} HBAR.ħ balance)
                            </span>
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                onVote(voteConfirm.id, voteConfirm.direction)
                              }
                              className="px-4 py-2 bg-gradient-to-r from-pink-600 to-purple-600 rounded-lg text-sm transition-all hover:from-pink-500 hover:to-purple-500"
                            >
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
                            className="flex-1 py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Vote For
                          </button>
                          <button
                            onClick={() =>
                              setVoteConfirm({ id: p.id, direction: "against" })
                            }
                            className="flex-1 py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-500/80"
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
}: {
  proposal: Proposal;
  accountId: string;
  canComment: boolean;
  onAddComment: (proposalId: string, text: string) => void;
}) {
  const [commentText, setCommentText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const comments = proposal.comments ?? [];
  const displayComments = showAll ? comments : comments.slice(-5);

  const handleSubmit = () => {
    if (!commentText.trim() || !accountId) return;
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
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">
                    Proposer
                  </span>
                )}
                <span className="text-[10px] text-slate-600 ml-auto">
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
            disabled={!commentText.trim()}
            className={`px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-1.5 ${
              commentText.trim()
                ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white"
                : "bg-slate-800 text-slate-600 cursor-not-allowed"
            }`}
          >
            <Send className="w-3.5 h-3.5" />
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
  const styles: Record<string, string> = {
    blue: "bg-blue-500/5 border-blue-500/15",
    emerald: "bg-emerald-500/5 border-emerald-500/15",
    purple: "bg-purple-500/5 border-purple-500/15",
  };

  return (
    <div
      className={`border rounded-xl p-4 backdrop-blur-sm ${styles[accent] ?? styles.blue}`}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <div className="text-xl text-white">{value}</div>
    </div>
  );
}

// ── Create Proposal Modal ────────────────────────────────────────────

function CreateProposalModal({
  accountId,
  onClose,
  onCreate,
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
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ProposalCategory>("Features");
  const [duration, setDuration] = useState(7);
  const [quorum, setQuorum] = useState(10);

  const valid = title.trim().length >= 5 && description.trim().length >= 20;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
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
            <div className="text-amber-400/70">You can edit or delete this proposal before the first vote is cast.</div>
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
            disabled={!valid}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm transition-all ${
              valid
                ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500"
                : "bg-slate-700 text-slate-500 cursor-not-allowed"
            }`}
          >
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
}: {
  proposal: Proposal;
  onClose: () => void;
  onSave: (updates: { title?: string; description?: string; category?: ProposalCategory }) => void;
}) {
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
            disabled={!valid || !hasChanges}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm transition-all ${
              valid && hasChanges
                ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white"
                : "bg-slate-700 text-slate-500 cursor-not-allowed"
            }`}
          >
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
// ═══════════════════════════════════════════════════════════════════════
// OWNER CONTROL PANEL — Elevated Administration for 0.0.518487
// ═══════════════════════════════════════════════════════════════════════
//
// All operations authenticated via ED25519 challenge-response session.
// The owner must sign a message in their HashPack wallet to prove they
// control 0.0.518487's private key. The resulting session token (30-min
// TTL) is sent as X-Session-Token on every admin request. The server's
// requireOwner() ONLY accepts ED25519 sessions — the spoofable
// X-Account-Id header fallback has been removed (security review SEC-01).
//
// Sections:
//   1. AMM Kill Switch — halt/resume all swaps + new liquidity
//   2. VIP Chat Admin — delete messages, clear chat
//   3. Spin Wheel Admin — reset winners, clear cooldown
//   4. Admin Audit Log — review all owner/admin actions
//
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from "react";
import {
  Power,
  PowerOff,
  Trash2,
  RotateCcw,
  ScrollText,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Shield,
  Loader2,
  MessageSquareX,
  Dices,
  Activity,
  Zap,
  Clock,
  User,
  KeyRound,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { toast } from "sonner";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { log } from "../utils/logger";
import { authenticate, getSessionToken, hasValidSession, authHeaders, clearSession as clearAuthSession } from "../utils/auth";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

// Public headers for unauthenticated reads (e.g. kill-switch status)
const publicHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${publicAnonKey}`,
};

const OWNER_ACCOUNT = "0.0.518487";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Get session-authenticated headers for owner operations.
 * Requires a valid ED25519 session — will throw if not authenticated.
 */
function ownerSessionHeaders(): Record<string, string> {
  const token = getSessionToken();
  if (!token) {
    throw new Error("ED25519 session required — sign in first");
  }
  return authHeaders(token);
}

async function ownerFetch(
  path: string,
  opts: RequestInit = {},
): Promise<{ ok: boolean; data: any; status: number }> {
  let headers: Record<string, string>;
  try {
    headers = ownerSessionHeaders();
  } catch (err: any) {
    return { ok: false, data: { error: err?.message || "Not authenticated", code: "AUTH_REQUIRED" }, status: 401 };
  }
  try {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { ...headers, ...(opts.headers as Record<string, string> || {}) },
      signal: opts.signal ?? AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return { ok: res.ok, data, status: res.status };
  } catch (err: any) {
    log.error("OwnerPanel", `Fetch ${path} failed`, err);
    return { ok: false, data: { error: err?.message || "Network error" }, status: 0 };
  }
}

async function publicFetch(
  path: string,
  opts: RequestInit = {},
): Promise<{ ok: boolean; data: any; status: number }> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { ...publicHeaders, ...(opts.headers as Record<string, string> || {}) },
      signal: opts.signal ?? AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return { ok: res.ok, data, status: res.status };
  } catch (err: any) {
    log.error("OwnerPanel", `Fetch ${path} failed`, err);
    return { ok: false, data: { error: err?.message || "Network error" }, status: 0 };
  }
}

// ── Types ───────────────────────────────────────────────────────────

interface AuditEntry {
  action: string;
  accountId: string;
  ip: string;
  ts: number;
  iso: string;
  details: string | null;
}

// ── Section Wrapper ─────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  iconColor,
  open,
  onToggle,
  children,
  badge,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const { isDark } = useTheme();
  return (
    <div
      className={`rounded-lg border transition-colors ${
        isDark ? "border-white/5 bg-slate-900/30" : "border-gray-200 bg-white/50"
      }`}
    >
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors rounded-lg ${
          isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50"
        }`}
      >
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <span className={`text-sm font-medium flex-1 ${isDark ? "text-white" : "text-gray-900"}`}>
          {title}
        </span>
        {badge}
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function OwnerControlPanel() {
  const { isDark } = useTheme();

  // ── ED25519 Session Auth State ─────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(() => hasValidSession(OWNER_ACCOUNT));
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Re-check session validity periodically (handles 30-min TTL expiry)
  useEffect(() => {
    const interval = setInterval(() => {
      setIsAuthenticated(hasValidSession(OWNER_ACCOUNT));
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await authenticate(OWNER_ACCOUNT);
      setIsAuthenticated(true);
      toast.success("Owner session authenticated via ED25519 signature", { duration: 3000 });
      log.info("OwnerPanel", "ED25519 session established for owner");
    } catch (err: any) {
      const msg = err?.message || "Authentication failed";
      setAuthError(msg);
      toast.error(`Authentication failed: ${msg}`);
      log.error("OwnerPanel", "ED25519 auth failed", msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await clearAuthSession();
    setIsAuthenticated(false);
    toast.info("Owner session revoked");
  };

  // Section toggle states
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    amm: true,
    chat: false,
    spin: false,
    audit: false,
  });
  const toggle = (key: string) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));

  // ── AMM Kill Switch ─────────────────────────────────────────────
  const [ammKilled, setAmmKilled] = useState<boolean | null>(null);
  const [ammKillReason, setAmmKillReason] = useState("");
  const [ammActivatedAt, setAmmActivatedAt] = useState<number | null>(null);
  const [ammLoading, setAmmLoading] = useState(false);
  const [ammConfirm, setAmmConfirm] = useState(false);

  const fetchAmmStatus = useCallback(async () => {
    const { ok, data } = await publicFetch("/amm/kill-switch");
    if (ok) {
      setAmmKilled(data.active);
      setAmmActivatedAt(data.activatedAt || null);
    }
  }, []);

  useEffect(() => {
    fetchAmmStatus();
  }, [fetchAmmStatus]);

  const handleAmmToggle = async () => {
    if (!ammConfirm) {
      setAmmConfirm(true);
      return;
    }
    setAmmLoading(true);
    try {
      const endpoint = ammKilled ? "/amm/resume" : "/amm/kill";
      const body = ammKilled ? {} : { reason: ammKillReason || "Emergency halt" };
      const { ok, data } = await ownerFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (ok) {
        setAmmKilled(!ammKilled);
        setAmmActivatedAt(data.activatedAt || Date.now());
        setAmmConfirm(false);
        setAmmKillReason("");
        toast.success(ammKilled ? "AMM trading resumed" : "AMM trading HALTED", {
          duration: 5000,
        });
      } else {
        toast.error(data?.error || "Failed to toggle kill switch");
      }
    } catch (err: any) {
      toast.error(err?.message || "Network error");
    } finally {
      setAmmLoading(false);
    }
  };

  // ── VIP Chat Admin ──────────────────────────────────────────────
  const [chatLoading, setChatLoading] = useState(false);
  const [chatConfirmClear, setChatConfirmClear] = useState(false);

  const handleClearChat = async () => {
    if (!chatConfirmClear) {
      setChatConfirmClear(true);
      return;
    }
    setChatLoading(true);
    try {
      const { ok, data } = await ownerFetch("/vip-chat/messages", {
        method: "DELETE",
      });
      if (ok) {
        toast.success("VIP chat cleared");
        setChatConfirmClear(false);
      } else {
        toast.error(data?.error || "Failed to clear chat");
      }
    } catch (err: any) {
      toast.error(err?.message || "Network error");
    } finally {
      setChatLoading(false);
    }
  };

  // ── Spin Wheel Admin ────────────────────────────────────────────
  const [spinLoading, setSpinLoading] = useState(false);
  const [winnersConfirm, setWinnersConfirm] = useState(false);
  const [cooldownAccountId, setCooldownAccountId] = useState("");
  const [cooldownLoading, setCooldownLoading] = useState(false);

  const handleResetWinners = async () => {
    if (!winnersConfirm) {
      setWinnersConfirm(true);
      return;
    }
    setSpinLoading(true);
    try {
      const { ok, data } = await ownerFetch("/winners", { method: "DELETE" });
      if (ok) {
        toast.success("Winner history cleared");
        setWinnersConfirm(false);
      } else {
        toast.error(data?.error || "Failed to reset winners");
      }
    } catch (err: any) {
      toast.error(err?.message || "Network error");
    } finally {
      setSpinLoading(false);
    }
  };

  const handleResetCooldown = async () => {
    if (!cooldownAccountId.trim() || !/^0\.0\.\d+$/.test(cooldownAccountId.trim())) {
      toast.error("Enter a valid Hedera account ID");
      return;
    }
    setCooldownLoading(true);
    try {
      const { ok, data } = await ownerFetch(
        `/spin/cooldown?accountId=${encodeURIComponent(cooldownAccountId.trim())}`,
        { method: "DELETE" },
      );
      if (ok) {
        toast.success(`Cooldown cleared for ${cooldownAccountId.trim()}`);
        setCooldownAccountId("");
      } else {
        toast.error(data?.error || "Failed to reset cooldown");
      }
    } catch (err: any) {
      toast.error(err?.message || "Network error");
    } finally {
      setCooldownLoading(false);
    }
  };

  // ── Audit Log ───────────────────────────────────────────────────
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const { ok, data } = await ownerFetch("/auth/admin-audit");
      if (ok) {
        setAuditEntries((data.entries || []).reverse()); // newest first
        setAuditLoaded(true);
      } else {
        toast.error(data?.error || "Failed to load audit log");
      }
    } catch (err: any) {
      toast.error(err?.message || "Network error");
    } finally {
      setAuditLoading(false);
    }
  }, []);

  // Auto-fetch audit when section opens
  useEffect(() => {
    if (openSections.audit && !auditLoaded) {
      fetchAudit();
    }
  }, [openSections.audit, auditLoaded, fetchAudit]);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div
      className={`rounded-xl border p-5 space-y-3 ${
        isDark
          ? "bg-gradient-to-br from-red-950/10 via-slate-900/50 to-amber-950/10 border-red-500/15"
          : "bg-red-50/30 border-red-200"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-red-500/15 border border-red-500/25 flex items-center justify-center">
          <Zap className="w-4.5 h-4.5 text-red-400" />
        </div>
        <div className="flex-1">
          <h4 className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
            Owner Control Panel
          </h4>
          <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
            Owner Administration &middot; 0.0.518487 only &middot; ED25519 session-verified
          </p>
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/12 rounded-lg p-2.5">
        <Shield className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
        <p className={`text-xs leading-relaxed ${isDark ? "text-red-400/80" : "text-red-600/80"}`}>
          All actions require an ED25519 challenge-response signature from the owner wallet.
          Session tokens are cryptographically bound to your account. The service role key is never transmitted.
        </p>
      </div>

      {/* Authentication controls */}
      {!isAuthenticated && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/15 rounded-lg p-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className={`text-xs leading-relaxed ${isDark ? "text-amber-400/90" : "text-amber-600/90"}`}>
            {authError ? (
              <><span className="font-bold">Error:</span> {authError}</>
            ) : (
              <>
                <span className="font-bold">Not authenticated.</span> Sign in to proceed.
              </>
            )}
          </p>
          <button
            onClick={handleSignIn}
            disabled={authLoading}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 ${isDark ? "bg-amber-500/15 border border-amber-500/20 text-amber-400 hover:bg-amber-500/25" : "bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"}`}
          >
            {authLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <KeyRound className="w-3 h-3" />
            )}
            {authError ? "Retry" : "Sign In"}
          </button>
        </div>
      )}
      {isAuthenticated && (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/15 rounded-lg p-2.5">
          <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <p className={`text-xs leading-relaxed ${isDark ? "text-emerald-400/90" : "text-emerald-600/90"}`}>
            <span className="font-bold">Authenticated.</span> Owner session active.
          </p>
          <button
            onClick={handleSignOut}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 ${isDark ? "bg-red-500/15 border border-red-500/20 text-red-400 hover:bg-red-500/25" : "bg-red-50 border border-red-200 text-red-700 hover:bg-red-100"}`}
          >
            <KeyRound className="w-3 h-3" />
            Sign Out
          </button>
        </div>
      )}

      {/* ═══ AMM Kill Switch ═══ */}
      <Section
        title="AMM Kill Switch"
        icon={Power}
        iconColor={ammKilled ? "text-red-400" : "text-emerald-400"}
        open={openSections.amm}
        onToggle={() => toggle("amm")}
        badge={
          ammKilled !== null && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                ammKilled
                  ? "bg-red-500/20 text-red-400 border border-red-500/25"
                  : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
              }`}
            >
              {ammKilled ? "HALTED" : "ACTIVE"}
            </span>
          )
        }
      >
        <div className="space-y-3">
          {/* Status */}
          <div
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border ${
              ammKilled
                ? "bg-red-500/10 border-red-500/20"
                : "bg-emerald-500/8 border-emerald-500/15"
            }`}
          >
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                ammKilled ? "bg-red-500 animate-pulse" : "bg-emerald-500"
              }`}
            />
            <span className={`text-xs font-medium ${ammKilled ? "text-red-300" : "text-emerald-300"}`}>
              {ammKilled
                ? "AMM is HALTED — all swaps and new liquidity blocked"
                : "AMM is active — trading normally"}
            </span>
          </div>

          {ammActivatedAt && (
            <p className={`text-xs flex items-center gap-1 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
              <Clock className="w-3 h-3" />
              Last changed: {new Date(ammActivatedAt).toLocaleString()}
            </p>
          )}

          {/* Kill reason input (only when activating) */}
          {!ammKilled && ammConfirm && (
            <input
              value={ammKillReason}
              onChange={(e) => setAmmKillReason(e.target.value)}
              placeholder="Reason for halt (optional)"
              maxLength={200}
              className={`w-full bg-slate-800/50 border rounded-lg px-3 py-2 text-xs font-mono outline-none transition-colors ${
                isDark ? "border-red-500/20 focus:ring-1 focus:ring-red-500/40" : "border-gray-300"
              } placeholder:text-slate-600`}
            />
          )}

          {/* Confirm banner */}
          {ammConfirm && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/15 rounded-lg p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className={`text-xs leading-relaxed ${isDark ? "text-amber-400/90" : "text-amber-600/90"}`}>
                {ammKilled
                  ? "This will resume all AMM swaps and new liquidity. Confirm?"
                  : "This will immediately HALT all swaps, pool creation, and new liquidity. LP removals remain open. Confirm?"}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleAmmToggle}
              disabled={ammLoading || ammKilled === null}
              className={`flex-1 px-4 py-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                ammConfirm
                  ? ammKilled
                    ? "bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white"
                    : "bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white"
                  : ammKilled
                    ? "bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/25"
                    : "bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25"
              }`}
            >
              {ammLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : ammKilled ? (
                <Power className="w-3.5 h-3.5" />
              ) : (
                <PowerOff className="w-3.5 h-3.5" />
              )}
              {ammConfirm
                ? ammKilled
                  ? "Confirm Resume"
                  : "Confirm HALT"
                : ammKilled
                  ? "Resume Trading"
                  : "Halt Trading"}
            </button>
            {ammConfirm && (
              <button
                onClick={() => {
                  setAmmConfirm(false);
                  setAmmKillReason("");
                }}
                className="px-3 py-2.5 rounded-lg text-xs bg-slate-800 border border-white/5 text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* ═══ VIP Chat Admin ═══ */}
      <Section
        title="VIP Chat"
        icon={MessageSquareX}
        iconColor="text-purple-400"
        open={openSections.chat}
        onToggle={() => toggle("chat")}
      >
        <div className="space-y-3">
          <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
            Clear the entire VIP chat history. Individual message deletion and user bans
            can be done from the chat interface.
          </p>

          {chatConfirmClear && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/15 rounded-lg p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className={`text-xs leading-relaxed ${isDark ? "text-amber-400/90" : "text-amber-600/90"}`}>
                This will permanently delete ALL VIP chat messages. This cannot be undone.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleClearChat}
              disabled={chatLoading}
              className={`px-4 py-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-2 disabled:opacity-50 ${
                chatConfirmClear
                  ? "bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white"
                  : "bg-purple-500/15 border border-purple-500/25 text-purple-400 hover:bg-purple-500/25"
              }`}
            >
              {chatLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              {chatConfirmClear ? "Confirm Delete All" : "Clear All Messages"}
            </button>
            {chatConfirmClear && (
              <button
                onClick={() => setChatConfirmClear(false)}
                className="px-3 py-2.5 rounded-lg text-xs bg-slate-800 border border-white/5 text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* ═══ Spin Wheel Admin ═══ */}
      <Section
        title="Spin Wheel"
        icon={Dices}
        iconColor="text-sky-400"
        open={openSections.spin}
        onToggle={() => toggle("spin")}
      >
        <div className="space-y-4">
          {/* Reset winners */}
          <div className="space-y-2">
            <div className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-600"}`}>Winner History</div>

            {winnersConfirm && (
              <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/15 rounded-lg p-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className={`text-xs leading-relaxed ${isDark ? "text-amber-400/90" : "text-amber-600/90"}`}>
                  This will permanently clear the entire spin wheel winner history.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleResetWinners}
                disabled={spinLoading}
                className={`px-4 py-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-2 disabled:opacity-50 ${
                  winnersConfirm
                    ? "bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white"
                    : "bg-sky-500/15 border border-sky-500/25 text-sky-400 hover:bg-sky-500/25"
                }`}
              >
                {spinLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                {winnersConfirm ? "Confirm Reset" : "Reset Winners"}
              </button>
              {winnersConfirm && (
                <button
                  onClick={() => setWinnersConfirm(false)}
                  className="px-3 py-2.5 rounded-lg text-xs bg-slate-800 border border-white/5 text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Reset cooldown */}
          <div className="space-y-2">
            <div className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-600"}`}>Spin Cooldown Reset</div>
            <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
              Clear the spin cooldown for a specific account, allowing them to spin immediately.
            </p>
            <div className="flex gap-2">
              <input
                value={cooldownAccountId}
                onChange={(e) => setCooldownAccountId(e.target.value)}
                placeholder="0.0.xxxxxx"
                maxLength={20}
                className={`flex-1 bg-slate-800/50 border rounded-lg px-3 py-2 text-xs font-mono outline-none transition-colors ${
                  isDark ? "border-white/5 focus:ring-1 focus:ring-sky-500/50" : "border-gray-300"
                } placeholder:text-slate-600`}
              />
              <button
                onClick={handleResetCooldown}
                disabled={cooldownLoading || !cooldownAccountId.trim()}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-sky-500/15 border border-sky-500/25 text-sky-400 hover:bg-sky-500/25 transition-all flex items-center gap-1.5 disabled:opacity-40"
              >
                {cooldownLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                Clear
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* ═══ Admin Audit Log ═══ */}
      <Section
        title="Audit Log"
        icon={ScrollText}
        iconColor="text-amber-400"
        open={openSections.audit}
        onToggle={() => toggle("audit")}
        badge={
          auditLoaded && (
            <span className={`text-xs px-1.5 py-0.5 rounded border ${isDark ? "bg-slate-800 text-slate-500 border-white/5" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
              {auditEntries.length}
            </span>
          )
        }
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={fetchAudit}
              disabled={auditLoading}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 ${isDark ? "bg-amber-500/15 border border-amber-500/20 text-amber-400 hover:bg-amber-500/25" : "bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"}`}
            >
              {auditLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3" />
              )}
              Refresh
            </button>
            <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
              {auditEntries.length} entries (max 500, newest first)
            </span>
          </div>

          {auditEntries.length === 0 && auditLoaded && (
            <p className="text-xs text-slate-500 text-center py-4">No audit entries yet</p>
          )}

          {auditEntries.length > 0 && (
            <div
              className={`rounded-lg border overflow-hidden ${
                isDark ? "border-white/5" : "border-gray-200"
              }`}
            >
              <div className="max-h-64 overflow-y-auto">
                {auditEntries.slice(0, 50).map((entry, i) => (
                  <div
                    key={`${entry.ts}-${i}`}
                    className={`flex items-start gap-2 px-3 py-2 text-xs border-b last:border-b-0 ${
                      isDark
                        ? "border-white/[0.03] hover:bg-white/[0.02]"
                        : "border-gray-100 hover:bg-gray-50"
                    }`}
                  >
                    <Activity className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`font-mono font-medium px-1.5 py-0.5 rounded ${
                            entry.action.includes("kill")
                              ? "bg-red-500/15 text-red-400"
                              : entry.action.includes("resume")
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-slate-700/50 text-slate-300"
                          }`}
                        >
                          {entry.action}
                        </span>
                        <span className="text-slate-600">
                          {new Date(entry.ts).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-500">
                        <span className="flex items-center gap-0.5">
                          <User className="w-2.5 h-2.5" />
                          {entry.accountId}
                        </span>
                        {entry.details && (
                          <span className="text-slate-600 truncate">{entry.details}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {auditEntries.length > 50 && (
                <div className={`px-3 py-2 text-xs text-center border-t ${isDark ? "text-slate-500 bg-slate-900/30 border-white/5" : "text-gray-500 bg-gray-50 border-gray-200"}`}>
                  Showing 50 of {auditEntries.length} entries
                </div>
              )}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
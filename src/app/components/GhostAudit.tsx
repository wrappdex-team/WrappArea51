/**
 * SecurityAudit — Internal Security Audit Report
 *
 * Comprehensive codebase audit with severity-rated findings, remediation
 * status, and user-facing risk assessment. DAO-admin gated.
 *
 * SENIOR DEV NOTE — This component is for internal use only.
 * It documents every finding from the security audit sweep performed
 * 2026-02-19 and tracks remediation status in real time.
 */

import { useState, useMemo } from "react";
import {
  Shield, ShieldAlert, ShieldCheck, ShieldX,
  AlertTriangle, CheckCircle2, Clock, FileWarning,
  ChevronDown, ChevronRight, Lock,
  Bug, Eye, Zap, Code2,
  Users, KeyRound,
  Info, XCircle, AlertCircle,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { isDAOAdmin } from "../utils/dao";

// ── Types ──────────────────────────────────────────────────────────

type Severity = "critical" | "high" | "medium" | "low" | "info";
type Status = "fixed" | "mitigated" | "open" | "accepted" | "wont-fix";

interface AuditFinding {
  id: string;
  title: string;
  severity: Severity;
  status: Status;
  category: string;
  files: string[];
  description: string;
  userRisk: string;
  remediation: string;
  seniorNote?: string;
}

// ── Findings Database ──────────────────────────────────────────────

const FINDINGS: AuditFinding[] = [
  // ═══════════════════════════════════════════════════════════════════
  // CRITICAL
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "C1",
    title: "AMM Kill Switch Failed Open on KV Outage",
    severity: "critical",
    status: "fixed",
    category: "Safety Mechanism",
    files: ["/supabase/functions/server/amm.ts:168-183"],
    description:
      "When the KV store was unreachable, isAmmKilled() returned false (fail-open), allowing trading to continue even if the kill switch had been activated before the outage. A 5-second cache TTL meant any KV disruption would silently un-halt the AMM within seconds.",
    userRisk:
      "During an active exploit where the kill switch had been activated, a KV outage could re-enable trading, allowing the attacker to continue draining pool reserves. Users providing liquidity could lose funds.",
    remediation:
      "FIXED: isAmmKilled() now fail-CLOSED. On KV failure it preserves the last known state (extending cache TTL). With no cached state at all (fresh deploy + immediate outage), it returns true (halted). False-positive halt is safer than false-negative.",
  },
  {
    id: "C2",
    title: "VIP Chat Identity Spoofing — No Wallet Proof",
    severity: "critical",
    status: "mitigated",
    category: "Authentication",
    files: [
      "/supabase/functions/server/vip-chat.ts:75-81",
      "/supabase/functions/server/vip-chat.ts:88",
    ],
    description:
      "The VIP chat accepts accountId from the request body without cryptographic wallet proof. The server verifies VIP eligibility via Mirror Node (correct), but cannot verify the caller actually controls the claimed wallet. Any user who knows a VIP's account ID can post messages as that VIP.",
    userRisk:
      "Identity spoofing in VIP chat. An attacker can impersonate any VIP member by submitting their public account ID. Messages would appear attributed to the victim. Social engineering or market manipulation via impersonated 'whale' messages is possible.",
    remediation:
      "MITIGATED: Mirror Node verification prevents non-VIP accounts from posting (limits who CAN be impersonated to actual VIPs). IP rate limiting + per-account cooldowns + ban list limit spam. Full fix requires migrating to ED25519 session auth (like DAO). Tracked for next sprint.",
    seniorNote:
      "SENIOR DEV NOTE: Migrate VIP chat auth to ED25519 sessions (same pattern as DAO requireAuth). This is the only remaining endpoint that accepts a body-supplied accountId. The server comment 'An attacker who spoofs an accountId gains nothing' is INCORRECT — they gain impersonation capability.",
  },
  {
    id: "C3",
    title: "TradingSwapPanel Kill Switch Status Silently Failed Open",
    severity: "critical",
    status: "fixed",
    category: "Safety Mechanism",
    files: ["/src/app/components/TradingSwapPanel.tsx:143"],
    description:
      "The frontend kill-switch status check had a bare catch clause with comment 'fail-open for status check'. If the /amm/kill-switch endpoint was unreachable, the swap UI remained active — users could initiate swaps against a halted AMM, resulting in confusing server-side rejections.",
    userRisk:
      "Users could attempt swaps that would fail server-side with cryptic errors. No funds at risk (server enforces halt), but poor UX and potential for users to think the platform is broken.",
    remediation:
      "FIXED: The catch block now sets ammHalted=true (fail-closed). If the status endpoint is unreachable, the UI shows the halt banner. Swaps are re-enabled automatically when the next 30s polling cycle succeeds.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // HIGH
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "H1",
    title: "SPA _redirects Was a Directory, Not a File",
    severity: "high",
    status: "fixed",
    category: "Deployment",
    files: ["/public/_redirects"],
    description:
      "The Netlify SPA fallback rule was stored as /public/_redirects/main.tsx (a directory containing a .tsx file) instead of a flat /public/_redirects text file. Netlify ignores directories at this path, causing all deep links (e.g., /trading/BTC, /dao, /wallet) to return 404 in production.",
    userRisk:
      "Users sharing direct links, bookmarking pages, or refreshing on any non-root route would see a 404 error. Browser back/forward navigation after a hard reload would break. This affects every route except the homepage.",
    remediation:
      "FIXED: Deleted the directory, created a flat /public/_redirects file with the correct Netlify SPA rewrite rule: /* /index.html 200",
  },
  {
    id: "H2",
    title: "Animation repeat: 9999 Instead of Infinity (19 Instances)",
    severity: "high",
    status: "fixed",
    category: "UI / UX",
    files: [
      "/src/app/components/SpinWheel.tsx (6 instances)",
      "/src/app/components/VipChatBox.tsx (3 instances)",
      "/src/app/components/Wallet.tsx (10 instances)",
    ],
    description:
      "Motion (Framer Motion) animations used repeat: 9999 instead of repeat: Infinity. After 9999 animation cycles complete, the animation stops permanently. For fast animations (0.8s-2s duration), this is ~2-5.5 hours before visual elements freeze — well within a typical user session for a trading/wallet tab left open.",
    userRisk:
      "VIP badge glows, wallet donut rotation, chat status indicators, and spin wheel effects would freeze after hours of use. Users may interpret frozen VIP indicators as lost VIP status, or frozen spin wheel elements as a bug.",
    remediation:
      "FIXED: All 19 instances across 3 files changed to repeat: Infinity. Verified no remaining 9999 values in the codebase.",
  },
  {
    id: "H3",
    title: "SaucerSwap Partner ID Placeholder (SENIOR DEV NOTE #12)",
    severity: "high",
    status: "accepted",
    category: "External Integration",
    files: ["/src/app/utils/saucerswap.ts:34"],
    description:
      "SAUCERSWAP_PARTNER_ID is exported as an empty string. All SaucerSwap API requests go unauthenticated, hitting lower default rate limits. The partner key is pending from the SaucerSwap team.",
    userRisk:
      "Under high load, SaucerSwap API requests may be rate-limited, causing swap quote failures, stale pool data, or swap routing errors. Users may see 'Quote unavailable' more frequently during peak trading.",
    remediation:
      "ACCEPTED (blocked on external party): The SENIOR DEV NOTE #12 documents this. When the key arrives, set it in saucerswap.ts. The resilientFetch helper already attaches it when non-empty. No code changes needed — just the key value.",
    seniorNote:
      "SENIOR DEV NOTE #12: SaucerSwap Partner/API key is being generated by the SaucerSwap team. When received, replace the empty string at SAUCERSWAP_PARTNER_ID. It auto-attaches to all API calls for better rate limits and revenue sharing.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // MEDIUM
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "M1",
    title: "Stargate V2 Pool Addresses Unverified for Newer Chains",
    severity: "medium",
    status: "open",
    category: "Bridge Security",
    files: [
      "/src/app/utils/stargate.ts",
      "/src/app/components/StargateBridgeWidget.tsx",
    ],
    description:
      "Pool addresses for Sei, Core, and X Layer were added during the 18-chain expansion but have not been verified against the official Stargate V2 deployment registry. Incorrect pool addresses would cause quoteSend to fail at the contract level.",
    userRisk:
      "Bridge transactions to unverified chains would fail with a contract revert. No funds at risk (Stargate contracts reject invalid pool addresses gracefully), but users may experience failed bridge attempts and gas costs on the source chain.",
    remediation:
      "OPEN: Verify Sei, Core, and X Layer pool addresses against https://stargateprotocol.gitbook.io/stargate/v2/deployments before production. The existing try/catch in quoteSend handles failures gracefully — users see an error toast, not a lost transaction.",
    seniorNote:
      "SENIOR DEV NOTE: Cross-reference pool addresses for Sei (0x...), Core (0x...), and X Layer (0x...) with the Stargate V2 official registry. The isRouteSupported() check now validates pools on both source and dest chains, so incorrect addresses are caught before quoteSend.",
  },
  {
    id: "M2",
    title: "dangerouslySetInnerHTML Usage (2 Files)",
    severity: "medium",
    status: "accepted",
    category: "XSS Surface",
    files: [
      "/src/app/components/ui/chart.tsx:83",
      "/src/main.tsx:41",
    ],
    description:
      "chart.tsx uses dangerouslySetInnerHTML for CSS variable injection from a hardcoded THEMES object. main.tsx uses innerHTML for the fatal error fallback screen. Neither accepts user-supplied content.",
    userRisk:
      "No direct user risk. Both inputs are developer-controlled string templates with no user input interpolation. The CSP blocks inline script execution even if content were somehow injected.",
    remediation:
      "ACCEPTED: Inputs are compile-time constants. Adding a comment documenting the safety invariant for each usage site.",
  },
  {
    id: "M3",
    title: "CSP Requires unsafe-inline for Scripts and Styles",
    severity: "medium",
    status: "accepted",
    category: "Content Security",
    files: ["/index.html:63"],
    description:
      "The Content-Security-Policy meta tag includes 'unsafe-inline' for both script-src and style-src. This is required by Vite's modulepreload polyfill, Tailwind CSS utilities, Dynamic SDK injected CSS, and inline onclick handlers in the error fallback.",
    userRisk:
      "Weakens XSS protection. If an attacker finds an injection point, they can execute inline scripts. Mitigated by the comprehensive connect-src, img-src, and frame-src directives that limit what injected code could actually do.",
    remediation:
      "ACCEPTED: Cannot remove without breaking Vite + Tailwind + Dynamic SDK. The CSP comment block in index.html documents each required domain and directive. For production, consider migrating to nonce-based CSP via server headers (Vercel/Netlify config).",
  },
  {
    id: "M4",
    title: "Open CORS (origin: '*') on Server",
    severity: "medium",
    status: "accepted",
    category: "Access Control",
    files: ["/supabase/functions/server/index.tsx:35-38"],
    description:
      "The Hono server uses cors({ origin: '*' }). All endpoints are accessible from any origin. Authentication is enforced per-endpoint via ED25519 session tokens.",
    userRisk:
      "Read-only endpoints (price data, pool info, kill switch status) are accessible from any website. No mutating operation is possible without a valid ED25519 session. A malicious site cannot perform actions on behalf of a connected user.",
    remediation:
      "ACCEPTED: Documented in server comment. All mutating endpoints require cryptographic sessions (requireAuth / requireOwner). Tightening CORS to specific origins would break the dApp when hosted on multiple domains (Vercel preview deploys, custom domains).",
  },
  {
    id: "M5",
    title: "window.open Monkey-Patch During WC Signing",
    severity: "medium",
    status: "mitigated",
    category: "Mobile Compatibility",
    files: ["/src/app/utils/wallet-core.ts:330-401"],
    description:
      "The _safeRequest function temporarily overrides window.open during WalletConnect v2 signing requests to suppress malformed wc: pairing URIs and prevent iframe navigation. The override is restored in a try/finally block.",
    userRisk:
      "If the WC request throws before reaching the finally block (e.g., a synchronous error in the setup code), window.open could remain patched for the rest of the session. Any subsequent window.open calls (external links, MetaMask deep links) would be intercepted. The try/finally pattern makes this unlikely but not impossible.",
    remediation:
      "MITIGATED: try/finally ensures restoration on normal throw paths. The override only activates for iframe or mobile contexts. Still needs smoke-testing on a real phone to verify the HashPack mobile signing flow.",
    seniorNote:
      "SENIOR DEV NOTE: Smoke-test mobile signing on a real iOS/Android device with HashPack mobile. Verify that: (1) wc: pairing URIs are suppressed, (2) hashpack:// deep links fire correctly, (3) window.open is restored after signing completes or fails.",
  },
  {
    id: "M6",
    title: "localStorage Data Stored in Plaintext",
    severity: "medium",
    status: "accepted",
    category: "Data Privacy",
    files: [
      "Multiple: Trading.tsx, Wallet.tsx, hashpack.ts, ThemeContext.tsx, etc.",
    ],
    description:
      "User preferences (theme, favorites, network selection), WC session data, swap history, chart drawings, and spin wheel timestamps are stored in plaintext localStorage. No secrets or private keys are stored.",
    userRisk:
      "An attacker with physical access to the device or a browser extension with storage permissions could read: favorite tokens, trading history, theme preferences, and WC session metadata. No funds at risk — WC sessions cannot sign transactions without the wallet app.",
    remediation:
      "ACCEPTED: localStorage is appropriate for non-sensitive preferences. WC session data is already ephemeral (24h expiry). Encrypting localStorage would add complexity without meaningful security benefit for a non-custodial dApp.",
  },

  // ═══════════════════════════════════════════════════════════════════
  // LOW / INFORMATIONAL
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "L1",
    title: "Math.random() Used for Server Lock Retry Jitter",
    severity: "low",
    status: "accepted",
    category: "Cryptographic Hygiene",
    files: ["/supabase/functions/server/shared.ts:260"],
    description:
      "The KV lock retry mechanism uses Math.random() for backoff jitter timing. All other server randomness uses crypto.getRandomValues(). Math.random() is adequate for timing jitter (not security-sensitive).",
    userRisk: "None. Jitter timing is not security-sensitive. Predictable jitter could theoretically allow lock-timing attacks, but the KV lock system is already protected by TTL-based expiry.",
    remediation: "ACCEPTED: Would be trivial to switch to secureRandomFloat() from shared.ts, but the risk does not justify the change at this time.",
  },
  {
    id: "L2",
    title: "Hardcoded Owner Account ID (0.0.518487)",
    severity: "low",
    status: "accepted",
    category: "Configurability",
    files: [
      "/src/app/components/BuySell.tsx:65",
      "/src/app/components/OwnerControlPanel.tsx",
      "/src/app/components/OneInchWidget.tsx",
    ],
    description:
      "The owner/founder account ID is hardcoded in multiple frontend files for test-gate checks. The server-side requireOwner() also checks against this account.",
    userRisk: "None for users. Limits platform transferability — changing ownership requires code changes and redeployment rather than a config update.",
    remediation: "ACCEPTED: Single-owner DEX at pre-launch stage. Consider env-var VITE_OWNER_ACCOUNT_ID for production flexibility.",
  },
  {
    id: "L3",
    title: "13 SENIOR DEV NOTEs Retained (All Intentional)",
    severity: "info",
    status: "accepted",
    category: "Code Documentation",
    files: [
      "BuySell.tsx (#11 — SaucerSwap swap production lock)",
      "OneInchWidget.tsx (1inch testing lock)",
      "PoolCreator.tsx (Pre-launch lock)",
      "SmartLiquidity.tsx x3 (Pre-launch locks)",
      "TradingPoolsSection.tsx x2 (Pre-launch locks)",
      "TradingSwapPanel.tsx (Pre-launch lock)",
      "AmmPrelaunchBanner.tsx (Delete after go-live)",
      "saucerswap.ts (#12 — Partner ID)",
      "amm.ts (Server-side pre-launch lock)",
    ],
    description:
      "All 13 SENIOR DEV NOTE annotations document intentional pre-launch locks, pending external integrations, or cleanup-after-go-live instructions. Every note follows the boxed format with clear action items and conditions for removal.",
    userRisk: "None. These are developer documentation, not user-facing.",
    remediation: "ACCEPTED: All notes are appropriate and should remain until their documented conditions are met (AMM launch, partner key receipt, etc.).",
  },
  {
    id: "L4",
    title: "ED25519 Auth Fully Deployed — X-Account-Id Header Ignored",
    severity: "info",
    status: "fixed",
    category: "Authentication",
    files: [
      "/supabase/functions/server/auth.ts (requireOwner, requireAuth)",
      "/src/app/components/OwnerControlPanel.tsx",
      "/src/app/components/DAO.tsx",
      "/src/app/utils/dao.ts",
    ],
    description:
      "Security review SEC-01 (owner) and SEC-02 (DAO) have been fully remediated. The spoofable X-Account-Id header is no longer accepted by requireOwner() or requireAuth(). Both functions log spoofing attempts for forensics. All authenticated endpoints now require cryptographic ED25519 session tokens.",
    userRisk: "None (remediated). Previously, any attacker could execute admin operations or stuff DAO votes with a single curl command.",
    remediation: "FIXED: ED25519 challenge-response sessions with 30-min TTL, single-use nonces, and per-account revocation. Spoofing attempts are logged with IP and timestamp.",
  },
];

// ── Helpers ────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<Severity, { color: string; darkColor: string; icon: typeof ShieldAlert; label: string; order: number }> = {
  critical: { color: "text-red-600 bg-red-50 border-red-200", darkColor: "text-red-400 bg-red-500/10 border-red-500/20", icon: ShieldX, label: "CRITICAL", order: 0 },
  high:     { color: "text-orange-600 bg-orange-50 border-orange-200", darkColor: "text-orange-400 bg-orange-500/10 border-orange-500/20", icon: ShieldAlert, label: "HIGH", order: 1 },
  medium:   { color: "text-yellow-600 bg-yellow-50 border-yellow-200", darkColor: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: AlertTriangle, label: "MEDIUM", order: 2 },
  low:      { color: "text-blue-600 bg-blue-50 border-blue-200", darkColor: "text-blue-400 bg-blue-500/10 border-blue-500/20", icon: Info, label: "LOW", order: 3 },
  info:     { color: "text-slate-600 bg-slate-50 border-slate-200", darkColor: "text-slate-400 bg-slate-500/10 border-slate-500/20", icon: Eye, label: "INFO", order: 4 },
};

const STATUS_CONFIG: Record<Status, { color: string; darkColor: string; icon: typeof CheckCircle2; label: string }> = {
  fixed:     { color: "text-emerald-600 bg-emerald-50", darkColor: "text-emerald-400 bg-emerald-500/15", icon: CheckCircle2, label: "Fixed" },
  mitigated: { color: "text-blue-600 bg-blue-50", darkColor: "text-blue-400 bg-blue-500/15", icon: ShieldCheck, label: "Mitigated" },
  open:      { color: "text-red-600 bg-red-50", darkColor: "text-red-400 bg-red-500/15", icon: XCircle, label: "Open" },
  accepted:  { color: "text-amber-600 bg-amber-50", darkColor: "text-amber-400 bg-amber-500/15", icon: AlertCircle, label: "Accepted Risk" },
  "wont-fix": { color: "text-slate-600 bg-slate-50", darkColor: "text-slate-400 bg-slate-500/15", icon: Clock, label: "Won't Fix" },
};

// ── Component ──────────────────────────────────────────────────────

export function GhostAudit() {
  const { isDark } = useTheme();
  const { hederaAccount } = useWallet();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterSeverity, setFilterSeverity] = useState<Severity | "all">("all");
  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");

  // ── Admin gate ──
  const isAdmin = useMemo(() => {
    if (!hederaAccount?.accountId) return false;
    return isDAOAdmin(hederaAccount.accountId);
  }, [hederaAccount?.accountId]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedIds(new Set(FINDINGS.map(f => f.id)));
  const collapseAll = () => setExpandedIds(new Set());

  // ── Filter + sort ──
  const filtered = useMemo(() => {
    return FINDINGS
      .filter(f => filterSeverity === "all" || f.severity === filterSeverity)
      .filter(f => filterStatus === "all" || f.status === filterStatus)
      .sort((a, b) => SEVERITY_CONFIG[a.severity].order - SEVERITY_CONFIG[b.severity].order);
  }, [filterSeverity, filterStatus]);

  // ── Stats ──
  const stats = useMemo(() => {
    const total = FINDINGS.length;
    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const byStatus: Record<Status, number> = { fixed: 0, mitigated: 0, open: 0, accepted: 0, "wont-fix": 0 };
    for (const f of FINDINGS) {
      bySeverity[f.severity]++;
      byStatus[f.status]++;
    }
    return { total, bySeverity, byStatus };
  }, []);

  // ── Styles ──
  const cardClass = isDark
    ? "bg-[#0b0e17]/80 border border-pink-500/10 backdrop-blur-xl rounded-xl"
    : "bg-white/90 border border-gray-200 backdrop-blur-xl rounded-xl";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const mutedFaint = isDark ? "text-slate-500" : "text-gray-400";

  // ── Admin gate UI ──
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className={`${cardClass} p-8 max-w-md text-center`}>
          <Lock className={`w-12 h-12 mx-auto mb-4 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
          <h2 className="text-xl font-bold mb-2">Security Audit Report</h2>
          <p className={`text-sm ${muted}`}>
            This internal security audit report is restricted to DAO administrators.
            Connect an admin wallet to access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* ── Header ── */}
      <div className={cardClass + " p-6"}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Shield className={`w-7 h-7 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
              <h1 className="text-2xl font-black tracking-tight">Security Audit Report</h1>
            </div>
            <p className={`text-sm ${muted}`}>
              Full codebase security sweep &mdash; February 19, 2026
            </p>
            <p className={`text-xs mt-1 ${mutedFaint}`}>
              WRAPpDEX Internal &bull; DAO-Admin Only &bull; {stats.total} findings
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={expandAll} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}>
              Expand All
            </button>
            <button onClick={collapseAll} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}>
              Collapse All
            </button>
          </div>
        </div>
      </div>

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* By severity */}
        {(Object.entries(SEVERITY_CONFIG) as [Severity, typeof SEVERITY_CONFIG[Severity]][]).map(([sev, cfg]) => (
          <button
            key={sev}
            onClick={() => setFilterSeverity(filterSeverity === sev ? "all" : sev)}
            className={`${cardClass} p-3 text-center transition-all cursor-pointer ${
              filterSeverity === sev ? "ring-2 ring-pink-500" : ""
            }`}
          >
            <cfg.icon className={`w-5 h-5 mx-auto mb-1 ${isDark ? cfg.darkColor.split(" ")[0] : cfg.color.split(" ")[0]}`} />
            <div className="text-2xl font-black">{stats.bySeverity[sev]}</div>
            <div className={`text-[10px] uppercase tracking-wider font-bold ${isDark ? cfg.darkColor.split(" ")[0] : cfg.color.split(" ")[0]}`}>
              {cfg.label}
            </div>
          </button>
        ))}

        {/* Fixed count */}
        <button
          onClick={() => setFilterStatus(filterStatus === "fixed" ? "all" : "fixed")}
          className={`${cardClass} p-3 text-center transition-all cursor-pointer ${
            filterStatus === "fixed" ? "ring-2 ring-emerald-500" : ""
          }`}
        >
          <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-emerald-400" />
          <div className="text-2xl font-black text-emerald-400">{stats.byStatus.fixed}</div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-400">FIXED</div>
        </button>
      </div>

      {/* ── Status Filter Bar ── */}
      <div className={`${cardClass} p-3 flex flex-wrap items-center gap-2`}>
        <span className={`text-xs font-bold ${muted}`}>Status:</span>
        {(["all", "fixed", "mitigated", "open", "accepted"] as const).map(st => (
          <button
            key={st}
            onClick={() => setFilterStatus(st === "all" ? "all" : (filterStatus === st ? "all" : st))}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              filterStatus === st
                ? isDark ? "bg-pink-500/20 text-pink-400" : "bg-pink-100 text-pink-700"
                : isDark ? "bg-slate-800 text-slate-400 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {st === "all" ? `All (${stats.total})` : `${STATUS_CONFIG[st].label} (${stats.byStatus[st]})`}
          </button>
        ))}
        {(filterSeverity !== "all" || filterStatus !== "all") && (
          <button
            onClick={() => { setFilterSeverity("all"); setFilterStatus("all"); }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium ${isDark ? "text-red-400 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50"}`}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* ── Findings List ── */}
      <div className="space-y-3">
        {filtered.map(finding => {
          const sevCfg = SEVERITY_CONFIG[finding.severity];
          const stCfg = STATUS_CONFIG[finding.status];
          const isExpanded = expandedIds.has(finding.id);
          const SevIcon = sevCfg.icon;
          const StIcon = stCfg.icon;

          return (
            <div key={finding.id} className={`${cardClass} overflow-hidden`}>
              {/* Finding Header */}
              <button
                onClick={() => toggleExpand(finding.id)}
                className="w-full text-left p-4 flex items-start gap-3 group"
              >
                <SevIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isDark ? sevCfg.darkColor.split(" ")[0] : sevCfg.color.split(" ")[0]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${isDark ? sevCfg.darkColor : sevCfg.color}`}>
                      {finding.id}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isDark ? stCfg.darkColor : stCfg.color}`}>
                      <StIcon className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                      {stCfg.label}
                    </span>
                    <span className={`text-[10px] ${mutedFaint}`}>{finding.category}</span>
                  </div>
                  <h3 className="font-bold text-sm leading-snug">{finding.title}</h3>
                </div>
                {isExpanded
                  ? <ChevronDown className={`w-4 h-4 mt-1 flex-shrink-0 ${mutedFaint}`} />
                  : <ChevronRight className={`w-4 h-4 mt-1 flex-shrink-0 ${mutedFaint}`} />
                }
              </button>

              {/* Finding Details */}
              {isExpanded && (
                <div className={`px-4 pb-4 space-y-4 border-t ${isDark ? "border-white/5" : "border-gray-100"}`}>
                  {/* Description */}
                  <div className="pt-4">
                    <h4 className={`text-[10px] uppercase tracking-wider font-bold mb-1.5 ${mutedFaint}`}>
                      <Bug className="w-3 h-3 inline -mt-0.5 mr-1" />Description
                    </h4>
                    <p className={`text-sm leading-relaxed ${muted}`}>{finding.description}</p>
                  </div>

                  {/* User Risk */}
                  <div className={`rounded-lg p-3 ${isDark ? "bg-red-500/5 border border-red-500/10" : "bg-red-50 border border-red-100"}`}>
                    <h4 className={`text-[10px] uppercase tracking-wider font-bold mb-1.5 ${isDark ? "text-red-400" : "text-red-600"}`}>
                      <Users className="w-3 h-3 inline -mt-0.5 mr-1" />User Risk Assessment
                    </h4>
                    <p className={`text-sm leading-relaxed ${isDark ? "text-red-300/80" : "text-red-700"}`}>{finding.userRisk}</p>
                  </div>

                  {/* Remediation */}
                  <div className={`rounded-lg p-3 ${isDark ? "bg-emerald-500/5 border border-emerald-500/10" : "bg-emerald-50 border border-emerald-100"}`}>
                    <h4 className={`text-[10px] uppercase tracking-wider font-bold mb-1.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                      <Zap className="w-3 h-3 inline -mt-0.5 mr-1" />Remediation
                    </h4>
                    <p className={`text-sm leading-relaxed ${isDark ? "text-emerald-300/80" : "text-emerald-700"}`}>{finding.remediation}</p>
                  </div>

                  {/* Senior Dev Note */}
                  {finding.seniorNote && (
                    <div className={`rounded-lg p-3 ${isDark ? "bg-amber-500/5 border border-amber-500/10" : "bg-amber-50 border border-amber-100"}`}>
                      <h4 className={`text-[10px] uppercase tracking-wider font-bold mb-1.5 ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                        <KeyRound className="w-3 h-3 inline -mt-0.5 mr-1" />Senior Dev Note
                      </h4>
                      <p className={`text-xs font-mono leading-relaxed ${isDark ? "text-amber-300/70" : "text-amber-700"}`}>{finding.seniorNote}</p>
                    </div>
                  )}

                  {/* Affected Files */}
                  <div>
                    <h4 className={`text-[10px] uppercase tracking-wider font-bold mb-1.5 ${mutedFaint}`}>
                      <Code2 className="w-3 h-3 inline -mt-0.5 mr-1" />Affected Files
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {finding.files.map((f, i) => (
                        <span key={i} className={`px-2 py-0.5 rounded text-[10px] font-mono ${isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-600"}`}>
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className={`${cardClass} p-8 text-center`}>
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
          <p className={`text-sm font-medium ${muted}`}>No findings match the current filters.</p>
        </div>
      )}

      {/* ── Executive Summary ── */}
      <div className={cardClass + " p-6"}>
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
          <FileWarning className={`w-5 h-5 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
          Executive Summary
        </h2>
        <div className={`text-sm leading-relaxed space-y-3 ${muted}`}>
          <p>
            <strong className={isDark ? "text-white" : "text-gray-900"}>Audit scope:</strong> Full
            frontend (/src) + server (/supabase/functions/server) + static assets (/public).
            Searched for: TODO/FIXME/HACK/XXX tags, hardcoded secrets, fail-open patterns, XSS
            vectors, authentication gaps, CORS misconfigurations, animation artifacts, deployment
            misconfigurations, and rate-limiting gaps.
          </p>
          <p>
            <strong className={isDark ? "text-white" : "text-gray-900"}>Key remediations this session:</strong> AMM
            kill switch changed from fail-open to fail-closed (preserves last known state on KV
            outage). All 19 animation <code className="font-mono text-xs">repeat: 9999</code> values
            fixed to <code className="font-mono text-xs">Infinity</code>. SPA _redirects file
            reconstructed from broken directory to flat file. Frontend kill-switch polling changed
            from fail-open to fail-closed.
          </p>
          <p>
            <strong className={isDark ? "text-white" : "text-gray-900"}>Remaining open items:</strong> VIP
            chat identity spoofing (mitigated but not fully resolved &mdash; needs ED25519 session
            migration). Stargate V2 pool addresses for Sei/Core/X Layer need registry verification.
            SaucerSwap Partner ID pending from external team.
          </p>
          <p>
            <strong className={isDark ? "text-white" : "text-gray-900"}>Authentication posture:</strong> ED25519
            challenge-response sessions are fully deployed. The spoofable X-Account-Id header is
            ignored by all server endpoints. The only exception is VIP chat, which uses Mirror Node
            verification instead of wallet-signed sessions.
          </p>
          <p>
            <strong className={isDark ? "text-white" : "text-gray-900"}>SENIOR DEV NOTEs retained:</strong> 13
            notes across 9 files. All document pre-launch locks (AMM, BuySell, 1inch, SmartLiquidity)
            or pending external integrations (SaucerSwap Partner ID). Every note includes clear
            conditions for removal.
          </p>
          <p>
            <strong className={isDark ? "text-white" : "text-gray-900"}>Non-senior tags removed:</strong> All
            TODO/FIXME/HACK markers have been resolved or elevated to SENIOR DEV NOTEs. No dangling
            audit tags remain in the codebase.
          </p>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className={`text-center text-xs ${mutedFaint} pb-8`}>
        Security Audit Report v1.0 &mdash; Generated 2026-02-19 &mdash; {stats.byStatus.fixed} fixed, {stats.byStatus.mitigated} mitigated, {stats.byStatus.open} open, {stats.byStatus.accepted} accepted
      </div>
    </div>
  );
}
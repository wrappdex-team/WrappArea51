/**
 * Security Audit Page — Wrappdex
 *
 * Centralized security dashboard with the WalletConnect Health Report
 * and infrastructure diagnostics. Available at /audit route.
 */

import { Shield, ExternalLink, Lock, FileWarning, CheckCircle2, AlertTriangle } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { WalletHealthReport } from "./WalletHealthReport";

export function Audit() {
  const { isDark } = useTheme();

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Page Header */}
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
          isDark
            ? "bg-gradient-to-br from-red-500/20 to-purple-500/20 border border-red-500/20"
            : "bg-gradient-to-br from-red-100 to-purple-100 border border-red-200"
        }`}>
          <Shield className={`w-6 h-6 ${isDark ? "text-red-400" : "text-red-600"}`} />
        </div>
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${isDark ? "text-white" : "text-gray-900"}`}>
            Security Audit
          </h1>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
            Wrappdex infrastructure health, signing flow diagnostics, and security posture assessment.
          </p>
        </div>
      </div>

      {/* Quick Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatusCard
          isDark={isDark}
          icon={<Lock className="w-4 h-4" />}
          label="Auth Protocol"
          value="ED25519 Challenge-Response"
          sublabel="CSPRNG nonces, 30-min sessions, KV-backed"
          status="secure"
        />
        <StatusCard
          isDark={isDark}
          icon={<Shield className="w-4 h-4" />}
          label="Server Auth"
          value="All mutations protected"
          sublabel="requireAuth() on every mutating endpoint"
          status="secure"
        />
        <StatusCard
          isDark={isDark}
          icon={<FileWarning className="w-4 h-4" />}
          label="WC Signing Flow"
          value="Needs hardening"
          sublabel="Session validation gap before client.request()"
          status="warning"
        />
      </div>

      {/* Architecture Overview */}
      <div className={`rounded-2xl border p-6 ${
        isDark ? "bg-[#0a0a14]/90 border-white/[0.06]" : "bg-white/90 border-gray-200"
      }`}>
        <h2 className={`text-sm font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
          Wallet Signing Architecture
        </h2>
        <div className={`rounded-xl p-4 font-mono text-[11px] leading-relaxed whitespace-pre overflow-x-auto ${
          isDark ? "bg-black/30 text-slate-400" : "bg-gray-50 text-gray-600"
        }`}>
{`WALLET CONNECTION FLOW (Hedera/HashPack):
  User clicks "HashPack" in WalletConnectModal
    -> WalletContext.connectHashPack()
      -> hashpack.connectViaHashConnect()
        -> wallet-core.proposeSession() [creates WC session proposal]
        -> wallet-core.openWCModal(uri) [shows @walletconnect/modal]
        -> User approves in wallet
        -> Session established (topic, accounts, namespaces)
        -> hashpack._buildSession() [persist to localStorage]
        -> WalletContext updates state

AUTH SIGNING FLOW (for DAO/mutations):
  DAO action calls dao.ensureAuth(accountId)
    -> auth.authenticate(accountId)
      -> auth.requestChallenge() [GET /auth/challenge/:id]
      -> auth.signChallengeMessage()
        -> hashpack.signMessage(accountId, message)
          -> wallet-core.signMessageViaWC(topic, network, id, msg)
            -> client.request({ method: "hedera_signMessage" })
            -> [!] NO session validation before request  <-- BUG
            -> [!] If session stale, WC may redirect     <-- BUG
      -> auth.submitSession() [POST /auth/session]
      -> Server verifies ED25519 sig -> issues 30-min token

METMASK FLOW (EVM):
  User clicks "MetaMask"
    -> WalletContext.connectMetaMask()
      -> metamask.connectMetaMask()
        -> window.ethereum.request({ method: "eth_requestAccounts" })
        -> Pure EIP-1193, no WC involved [CLEAN]

DYNAMIC LABS FLOW:
  User clicks "Dynamic"
    -> Opens Dynamic SDK auth modal
    -> DynamicWalletBridge syncs -> WalletContext
    -> [!] Dynamic may create separate WC instance  <-- RISK`}
        </div>
      </div>

      {/* WalletConnect Health Report */}
      <WalletHealthReport />

      {/* Footer */}
      <div className={`text-center py-4 ${isDark ? "text-slate-700" : "text-gray-300"}`}>
        <p className="text-[10px]">
          This report is for internal development use. Not a formal security audit.
          For production deployment, engage a professional auditor (CertiK, Halborn, Trail of Bits).
        </p>
      </div>
    </div>
  );
}

// ── Status Card ─────────────────────────────────────────────────────

function StatusCard({
  isDark,
  icon,
  label,
  value,
  sublabel,
  status,
}: {
  isDark: boolean;
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
  status: "secure" | "warning" | "critical";
}) {
  const borderColor = status === "secure"
    ? "border-emerald-500/20"
    : status === "warning"
      ? "border-amber-500/20"
      : "border-red-500/20";

  const iconBg = status === "secure"
    ? "bg-emerald-500/15 text-emerald-400"
    : status === "warning"
      ? "bg-amber-500/15 text-amber-400"
      : "bg-red-500/15 text-red-400";

  return (
    <div className={`rounded-xl border p-4 ${
      isDark ? `bg-white/[0.02] ${borderColor}` : `bg-gray-50 ${borderColor}`
    }`}>
      <div className="flex items-center gap-2.5 mb-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        <span className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-500"}`}>
          {label}
        </span>
      </div>
      <p className={`text-sm font-medium ${isDark ? "text-white/90" : "text-gray-900"}`}>{value}</p>
      <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-600" : "text-gray-400"}`}>{sublabel}</p>
    </div>
  );
}

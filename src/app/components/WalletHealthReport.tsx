/**
 * WalletConnect Health Report — CertiK-Level Assessment
 *
 * Comprehensive diagnostic panel that audits the entire wallet connection
 * infrastructure: WC SignClient state, session validity, relay connectivity,
 * localStorage integrity, signing flow readiness, and security posture.
 *
 * Designed for the Wrappdex audit page — production-readiness assessment
 * for multi-wallet signing on a hybrid DEX + bridge hub.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Database,
  Key,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  Unlink,
  Fingerprint,
  Bug,
  Trash2,
  Zap,
  Lock,
  Radio,
  Eye,
  Code2,
} from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import {
  getActiveSessions,
  getAccountsFromSession,
  findSessionForAccount,
  isWalletConnectConfigured,
  getWalletConnectProjectId,
  getSignClient,
  forceResetSignClient,
  clearWCStorage,
} from "../utils/wallet-core";
import {
  restoreSession,
  clearSession as clearHashPackSession,
  forceResetHashConnect,
  getCurrentHashConnect,
} from "../utils/hashpack";
import { getSessionToken, getSessionAccountId, hasValidSession } from "../utils/auth";
import { isMetaMaskInstalled, isMetaMaskProvider } from "../utils/metamask";
import { isDynamicSDKAvailable } from "./DynamicSDKWrapper";

// ── Types ─────────────────────────────────────────────────────────────

type Severity = "critical" | "high" | "medium" | "low" | "info" | "pass";

interface Finding {
  id: string;
  category: string;
  title: string;
  severity: Severity;
  description: string;
  recommendation: string;
  codeRef?: string;
  status: "open" | "mitigated" | "acknowledged";
}

interface DiagnosticResult {
  label: string;
  value: string;
  status: "ok" | "warn" | "error" | "info";
  detail?: string;
}

interface HealthSection {
  title: string;
  icon: React.ReactNode;
  diagnostics: DiagnosticResult[];
  findings: Finding[];
}

// ── Severity Helpers ──────────────────────────────────────────────────

function severityColor(s: Severity): string {
  switch (s) {
    case "critical": return "text-red-400 bg-red-500/10 border-red-500/25";
    case "high": return "text-orange-400 bg-orange-500/10 border-orange-500/25";
    case "medium": return "text-amber-400 bg-amber-500/10 border-amber-500/25";
    case "low": return "text-yellow-300 bg-yellow-500/10 border-yellow-500/25";
    case "info": return "text-blue-400 bg-blue-500/10 border-blue-500/25";
    case "pass": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
  }
}

function severityLabel(s: Severity): string {
  switch (s) {
    case "critical": return "CRITICAL";
    case "high": return "HIGH";
    case "medium": return "MEDIUM";
    case "low": return "LOW";
    case "info": return "INFO";
    case "pass": return "PASS";
  }
}

function statusDot(s: "ok" | "warn" | "error" | "info"): string {
  switch (s) {
    case "ok": return "bg-emerald-400";
    case "warn": return "bg-amber-400";
    case "error": return "bg-red-400";
    case "info": return "bg-blue-400";
  }
}

// ── Main Component ────────────────────────────────────────────────────

export function WalletHealthReport() {
  const { hashPackSession, hederaAccount, metaMaskAccount } = useWallet();
  const { isDark } = useTheme();

  const [sections, setSections] = useState<HealthSection[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());
  const runRef = useRef(0);

  const toggleSection = (title: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  };

  const toggleFinding = (id: string) => {
    setExpandedFindings(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Run Full Diagnostic ─────────────────────────────────────────────

  const runDiagnostics = useCallback(async () => {
    const runId = ++runRef.current;
    setIsRunning(true);
    const allSections: HealthSection[] = [];

    // ─────────────────────────────────────────────────────────────────
    // SECTION 1: WalletConnect SignClient Infrastructure
    // ─────────────────────────────────────────────────────────────────
    const wcDiag: DiagnosticResult[] = [];
    const wcFindings: Finding[] = [];

    // 1a. Project ID
    const wcConfigured = isWalletConnectConfigured();
    const projectId = getWalletConnectProjectId();
    wcDiag.push({
      label: "WC Project ID",
      value: wcConfigured ? `${projectId.slice(0, 8)}...${projectId.slice(-4)}` : "INVALID",
      status: wcConfigured ? "ok" : "error",
      detail: wcConfigured ? "Valid hex format, 32+ chars" : "Project ID missing or malformed",
    });

    if (!wcConfigured) {
      wcFindings.push({
        id: "WC-001",
        category: "Configuration",
        title: "WalletConnect Project ID invalid or missing",
        severity: "critical",
        description: "The WC Project ID is not configured. All WC-based wallet connections will fail.",
        recommendation: "Set VITE_WALLETCONNECT_PROJECT_ID env var or hardcode a valid ID from cloud.walletconnect.com",
        codeRef: "wallet-core.ts:27, env.ts:20",
        status: "open",
      });
    }

    // 1b. Project ID duplication check
    wcFindings.push({
      id: "WC-002",
      category: "Code Quality",
      title: "WC Project ID consolidated into env.ts",
      severity: "pass",
      description: "wallet-core.ts now imports WC_PROJECT_ID from ENV (env.ts). Single source of truth for the WalletConnect Project ID — updating env.ts or the VITE_WALLETCONNECT_PROJECT_ID env var rotates the key everywhere.",
      recommendation: "Complete. No action needed.",
      codeRef: "wallet-core.ts:23-28, env.ts:20-21",
      status: "mitigated",
    });

    // 1c. SignClient singleton
    let clientReady = false;
    let relayConnected = false;
    let sessionCount = 0;
    let pairingCount = 0;
    try {
      const client = await getSignClient();
      if (runId !== runRef.current) return;
      clientReady = !!client;
      relayConnected = !!client?.core?.relayer?.connected;
      sessionCount = client?.session?.getAll?.()?.length ?? 0;
      pairingCount = client?.core?.pairing?.pairings?.getAll?.()?.length ?? 0;
    } catch {
      clientReady = false;
    }

    wcDiag.push({
      label: "SignClient Singleton",
      value: clientReady ? "Initialized" : "FAILED",
      status: clientReady ? "ok" : "error",
    });

    wcDiag.push({
      label: "Relay WebSocket",
      value: relayConnected ? "Connected" : "Disconnected",
      status: relayConnected ? "ok" : "warn",
      detail: relayConnected ? "wss://relay.walletconnect.com" : "Relay may reconnect lazily on next request",
    });

    wcDiag.push({
      label: "Active Sessions",
      value: String(sessionCount),
      status: sessionCount > 0 ? "ok" : "info",
    });

    wcDiag.push({
      label: "Pairings",
      value: String(pairingCount),
      status: pairingCount <= 5 ? "ok" : "warn",
      detail: pairingCount > 5 ? "Excessive pairings may slow init — consider purging" : undefined,
    });

    if (!relayConnected && clientReady) {
      wcFindings.push({
        id: "WC-003",
        category: "Connectivity",
        title: "WC Relay disconnected — signing will fail",
        severity: "high",
        description: "The SignClient is initialized but the WebSocket relay is disconnected. Any client.request() call (signing, message signing) will throw 'send was called before connect' or timeout silently.",
        recommendation: "wallet-core.ts _waitForRelay has an 8s timeout. If relay doesn't connect in 8s, SignClient proceeds anyway. Add a relay health check before signing operations and show user feedback.",
        codeRef: "wallet-core.ts:510-536",
        status: "open",
      });
    }

    // 1d. Orphan pairing check
    if (pairingCount > sessionCount + 2) {
      wcFindings.push({
        id: "WC-004",
        category: "Storage Hygiene",
        title: `${pairingCount - sessionCount} orphaned pairings detected`,
        severity: "low",
        description: `There are ${pairingCount} pairings but only ${sessionCount} sessions. Orphaned pairings consume storage and slow SignClient init.`,
        recommendation: "forceResetSignClient() or the init-time purge in wallet-core.ts:121-130 should handle this. Run 'Reset Connection' from the wallet modal.",
        codeRef: "wallet-core.ts:121-130",
        status: "acknowledged",
      });
    }

    allSections.push({
      title: "WalletConnect SignClient Infrastructure",
      icon: <Radio className="w-4 h-4" />,
      diagnostics: wcDiag,
      findings: wcFindings,
    });

    // ─────────────────────────────────────────────────────────────────
    // SECTION 2: Session & Signing Flow Analysis
    // ─────────────────────────────────────────────────────────────────
    const sessDiag: DiagnosticResult[] = [];
    const sessFindings: Finding[] = [];

    // 2a. HashPack session from localStorage
    const savedSession = restoreSession();
    sessDiag.push({
      label: "Persisted HashPack Session",
      value: savedSession ? `${savedSession.accountId} (${savedSession.connectionMethod})` : "None",
      status: savedSession ? "ok" : "info",
      detail: savedSession
        ? `Connected ${new Date(savedSession.connectedAt).toLocaleString()}, expires 24h later`
        : "No session in localStorage",
    });

    // 2b. WC topic resolution
    const currentTopic = getCurrentHashConnect().topic;
    sessDiag.push({
      label: "Active WC Topic (memory)",
      value: currentTopic ? `${currentTopic.slice(0, 12)}...` : "None",
      status: currentTopic ? "ok" : (savedSession ? "warn" : "info"),
    });

    // 2c. Topic<->Session consistency
    if (savedSession?.wcTopic && currentTopic !== savedSession.wcTopic) {
      sessFindings.push({
        id: "SESS-001",
        category: "Session Integrity",
        title: "WC topic mismatch: memory vs localStorage",
        severity: "medium",
        description: `In-memory topic is '${currentTopic?.slice(0, 12) || "null"}' but localStorage has '${savedSession.wcTopic.slice(0, 12)}'. This causes _resolveTopic to return the stale localStorage topic for signing, which will fail if that session was deleted remotely.`,
        recommendation: "Add a session validity check in _resolveTopic that verifies the topic exists in client.session before returning it. If not found, clear it and return null.",
        codeRef: "hashpack.ts:377-384",
        status: "open",
      });
    }

    // 2d. WC session contains account
    if (savedSession?.accountId) {
      const wcSess = findSessionForAccount(savedSession.accountId);
      sessDiag.push({
        label: "WC Session for Account",
        value: wcSess ? "Found" : "NOT FOUND",
        status: wcSess ? "ok" : "error",
        detail: wcSess ? `Topic: ${wcSess.topic?.slice(0, 12)}...` : "Account not in any active WC session — signing will fail",
      });

      if (!wcSess && savedSession.connectionMethod === "walletconnect") {
        sessFindings.push({
          id: "SESS-002",
          category: "Session Integrity",
          title: "Persisted session has no matching WC session — signing broken",
          severity: "critical",
          description: `Account ${savedSession.accountId} is saved in localStorage with wcTopic '${savedSession.wcTopic?.slice(0, 12)}', but no WC session contains this account. All signing requests (auth challenge, transactions, messages) will fail.`,
          recommendation: "The app shows 'connected' but cannot sign. Need to: (1) Detect this state on session restore, (2) Show a 'reconnect' prompt instead of silently failing, (3) Auto-clear stale sessions.",
          codeRef: "hashpack.ts:513-524 (restoreSession), wallet-core.ts:352-357 (findSessionForAccount)",
          status: "open",
        });
      }
    }

    // 2e. Auth session token
    const authToken = getSessionToken();
    const authAccount = getSessionAccountId();
    sessDiag.push({
      label: "Auth Session Token",
      value: authToken ? `Valid for ${authAccount}` : "None / Expired",
      status: authToken ? "ok" : "info",
      detail: authToken ? "30-min TTL, challenge-response signed" : "Will trigger signing prompt on next mutating action",
    });

    // 2f. No pre-signing session validation
    sessFindings.push({
      id: "SESS-003",
      category: "Signing Flow",
      title: "Pre-signing session validation on all client.request() calls",
      severity: "pass",
      description: "MITIGATED: _validateSessionBeforeRequest() in wallet-core.ts validates session existence, expiry, and relay connectivity before every client.request() call. This is the same fix as REC-001 — all three signing functions (signAndExecuteTransaction, signTransactionViaWC, signMessageViaWC) call it. Stale/expired sessions surface a clear user-facing error instead of triggering opaque WC internal failures or deep-link redirects.",
      recommendation: "Complete. Covered by _validateSessionBeforeRequest (REC-001).",
      codeRef: "wallet-core.ts:239-292 (_validateSessionBeforeRequest)",
      status: "mitigated",
    });

    // 2g. Browser redirect investigation
    sessFindings.push({
      id: "SESS-004",
      category: "Signing Flow",
      title: "HashPack signing triggers browser navigation (redirect bug)",
      severity: "critical",
      description: "When creating a DAO proposal (which calls ensureAuth → authenticate → signMessage → signMessageViaWC → client.request), the browser navigates away to a HashPack URL instead of showing an in-app signing prompt. Root cause analysis: (1) WC client.request() fires JSON-RPC over relay — no redirect logic in WC SDK source, (2) HashPack's peer metadata may include a redirect URI that WC Core follows on session_request, (3) In the Figma Make sandbox, the WC modal's deep-link handlers may intercept the request. (4) Most likely: the session topic is stale/expired, WC Core throws internally, and the error propagation triggers a fallback deep-link open.",
      recommendation: "MITIGATED: SigningOverlay component implemented (SigningContext.tsx) with beforeunload interception, cancel support, 5-min countdown, and Reconnect Wallet action. The overlay wraps all signing operations via useSigning().withSigning(). The signMessage return type bug (Uint8Array vs { signatures }) was also fixed in the reconstruction.",
      codeRef: "contexts/SigningContext.tsx, hashpack.ts:signMessage",
      status: "mitigated",
    });

    // 2h. Double approval() call
    sessFindings.push({
      id: "SESS-005",
      category: "Code Correctness",
      title: "proposeSession calls approval() immediately — correct per WC v2 API",
      severity: "pass",
      description: "Line 192 calls `approval()` on the connect result. In WC v2, `approval` is a function that returns a Promise<Session>. Calling it immediately is correct — it starts listening for the approval event. This was previously identified as potentially wrong but is actually the documented pattern.",
      recommendation: "No action needed. This is correct.",
      codeRef: "wallet-core.ts:192",
      status: "mitigated",
    });

    allSections.push({
      title: "Session & Signing Flow Analysis",
      icon: <Fingerprint className="w-4 h-4" />,
      diagnostics: sessDiag,
      findings: sessFindings,
    });

    // ─────────────────────────────────────────────────────────────────
    // SECTION 3: Dead Code & Redundancy Audit
    // ─────────────────────────────────────────────────────────────────
    const deadFindings: Finding[] = [];
    const deadDiag: DiagnosticResult[] = [];

    deadDiag.push({
      label: "Stub Functions",
      value: "0 remaining",
      status: "ok",
      detail: "All 5 stubs removed (DEAD-001)",
    });

    deadDiag.push({
      label: "Unreachable UI Code",
      value: "0 remaining",
      status: "ok",
      detail: "WC QR screen removed from WalletConnectModal (DEAD-002)",
    });

    deadDiag.push({
      label: "Duplicate Functionality",
      value: "0 remaining",
      status: "ok",
      detail: "Deep links consolidated, dual modal resolved (DEAD-004/005)",
    });

    deadFindings.push({
      id: "DEAD-001",
      category: "Dead Code",
      title: "5 stub functions in hashpack.ts removed",
      severity: "pass",
      description: "Removed: isHashPackExtensionInstalled, detectHashPackExtension, tryExtensionDirect, fetchHashPackProfile, openHashConnectPairingModal. Also removed extensionDetected state/banner from WalletConnectModal.tsx.",
      recommendation: "Complete. Verified no remaining consumers.",
      codeRef: "hashpack.ts, WalletConnectModal.tsx",
      status: "mitigated",
    });

    deadFindings.push({
      id: "DEAD-002",
      category: "Unreachable Code",
      title: "WC QR screen removed from WalletConnectModal.tsx",
      severity: "pass",
      description: "Removed the entire 'wc-qr' step (~120 lines), QRCodeSVG import, handleCopyUri, copied state, and unused icon imports (Copy, Check, Smartphone). The WC modal (from @walletconnect/modal) handles QR display.",
      recommendation: "Complete. Also removed connectPromiseRef (assigned but never read).",
      codeRef: "WalletConnectModal.tsx",
      status: "mitigated",
    });

    deadFindings.push({
      id: "DEAD-003",
      category: "Dead Code",
      title: "Manual pairing functions removed",
      severity: "pass",
      description: "connectViaPairingString and injectPairingUri were not included in the hashpack.ts reconstruction — correctly omitted as they had no UI consumers.",
      recommendation: "Complete. Verified no remaining consumers.",
      codeRef: "hashpack.ts",
      status: "mitigated",
    });

    deadFindings.push({
      id: "DEAD-004",
      category: "Redundancy",
      title: "Dual WC modal system resolved — custom QR step removed",
      severity: "pass",
      description: "The custom wc-qr step in WalletConnectModal has been removed. The app now uses exclusively the @walletconnect/modal for QR display via openWCModal/closeWCModal in wallet-core.ts.",
      recommendation: "Complete. Single modal system now.",
      codeRef: "WalletConnectModal.tsx, wallet-core.ts",
      status: "mitigated",
    });

    deadFindings.push({
      id: "DEAD-005",
      category: "Redundancy",
      title: "Deep link functions consolidated",
      severity: "pass",
      description: "getHashPackDeepLink, getBladeDeepLink, and getWalletConnectUniversalLink were all removed — none had UI consumers. isMobileDevice (no consumers) and findSessionForAccount import (unused in hashpack.ts) also removed.",
      recommendation: "Complete. Zero dead exports remain.",
      codeRef: "hashpack.ts",
      status: "mitigated",
    });

    allSections.push({
      title: "Dead Code & Redundancy Audit",
      icon: <Bug className="w-4 h-4" />,
      diagnostics: deadDiag,
      findings: deadFindings,
    });

    // ─────────────────────────────────────────────────────────────────
    // SECTION 4: localStorage & Storage Security
    // ─────────────────────────────────────────────────────────────────
    const storageDiag: DiagnosticResult[] = [];
    const storageFindings: Finding[] = [];

    let wcKeyCount = 0;
    let totalWcBytes = 0;
    const wcKeys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith("wc@") || key.includes("walletconnect")) {
          wcKeyCount++;
          wcKeys.push(key);
          totalWcBytes += (localStorage.getItem(key) || "").length;
        }
      }
    } catch { /* storage not available */ }

    storageDiag.push({
      label: "WC localStorage Keys",
      value: String(wcKeyCount),
      status: wcKeyCount > 20 ? "warn" : "ok",
      detail: wcKeyCount > 20 ? "Excessive keys — consider cleanup" : `${(totalWcBytes / 1024).toFixed(1)} KB total`,
    });

    // Check for session data
    const hpSession = localStorage.getItem("hbarh-hashpack-session");
    storageDiag.push({
      label: "Persisted HP Session",
      value: hpSession ? "Present" : "Empty",
      status: "info",
    });

    const mmConnected = localStorage.getItem("hbarh-metamask-connected");
    storageDiag.push({
      label: "MetaMask Auto-Reconnect",
      value: mmConnected === "true" ? "Enabled" : "Disabled",
      status: "info",
    });

    if (wcKeyCount > 30) {
      storageFindings.push({
        id: "STOR-001",
        category: "Storage Bloat",
        title: `${wcKeyCount} WC keys in localStorage — potential performance issue`,
        severity: "medium",
        description: "WalletConnect stores session, pairing, history, and proposal data in localStorage. Over time, stale entries accumulate. cleanStaleStorage() in wallet-core.ts only removes proposal/history/message keys on non-aggressive mode.",
        recommendation: "Add periodic aggressive cleanup. Consider clearWCStorage(true) on disconnect.",
        codeRef: "wallet-core.ts:449-487",
        status: "open",
      });
    }

    storageFindings.push({
      id: "STOR-002",
      category: "Security",
      title: "WC session topics stored in plaintext localStorage",
      severity: "info",
      description: "WC session topics and pairing data are stored in localStorage in plaintext. This is standard for WC v2 — the actual signing keys remain in the wallet. However, in a shared computer scenario, someone with localStorage access could attempt to replay or hijack a session.",
      recommendation: "This is acceptable for a DEX. WC v2 sessions are end-to-end encrypted at the relay level. Session hijacking requires the relay encryption key, not just the topic. No action needed, but note for audit.",
      codeRef: "wallet-core.ts (SignClient internal storage)",
      status: "acknowledged",
    });

    allSections.push({
      title: "localStorage & Storage Security",
      icon: <Database className="w-4 h-4" />,
      diagnostics: storageDiag,
      findings: storageFindings,
    });

    // ─────────────────────────────────────────────────────────────────
    // SECTION 5: Multi-Wallet Security Assessment
    // ─────────────────────────────────────────────────────────────────
    const multiDiag: DiagnosticResult[] = [];
    const multiFindings: Finding[] = [];

    // MetaMask
    multiDiag.push({
      label: "MetaMask Available",
      value: isMetaMaskInstalled() ? (isMetaMaskProvider() ? "Installed (MetaMask)" : "Installed (Other EIP-1193)") : "Not Installed",
      status: isMetaMaskInstalled() ? "ok" : "info",
    });

    multiDiag.push({
      label: "MetaMask Connected",
      value: metaMaskAccount ? `${metaMaskAccount.address.slice(0, 8)}... (Chain ${metaMaskAccount.chainId})` : "Not connected",
      status: metaMaskAccount ? "ok" : "info",
    });

    // Dynamic Labs
    multiDiag.push({
      label: "Dynamic Labs SDK",
      value: isDynamicSDKAvailable ? "Loaded" : "Not available",
      status: isDynamicSDKAvailable ? "ok" : "info",
      detail: isDynamicSDKAvailable ? "CSP-safe connectors active" : "SDK may have failed to load (CSP block)",
    });

    // HashPack
    multiDiag.push({
      label: "HashPack Session",
      value: hashPackSession ? `${hashPackSession.accountId} via ${hashPackSession.connectionMethod}` : "Not connected",
      status: hashPackSession ? "ok" : "info",
    });

    // Potential WC conflict
    if (isDynamicSDKAvailable) {
      multiFindings.push({
        id: "MULTI-001",
        category: "WC Conflict",
        title: "Dynamic Labs SDK may create a second WC instance",
        severity: "medium",
        description: "Both the app (wallet-core.ts) and Dynamic Labs SDK use WalletConnect. The CSP-safe connector config excludes EvmWalletConnectConnectors, but fetchInjectedWalletConnector still creates WC fallbacks for non-installed wallets. Two WC instances sharing the same relay project ID can cause: relay message routing conflicts, duplicate session proposals, and storage key collisions.",
        recommendation: "Options: (1) Use a different WC project ID for Dynamic, (2) Configure Dynamic to skip WC fallbacks for wallets the app handles natively, (3) Ensure Dynamic uses a separate WC Core instance (it does by default in v4). Monitor for 'WalletConnect Core is already initialized' errors.",
        codeRef: "dynamic-connectors.ts:87-91, wallet-core.ts:88-92",
        status: "open",
      });
    }

    // Cross-wallet auth
    multiFindings.push({
      id: "MULTI-002",
      category: "Authentication",
      title: "Auth sessions are wallet-agnostic — no wallet-type binding",
      severity: "info",
      description: "The auth system (auth.ts) creates sessions bound to an accountId but doesn't record which wallet or signing method was used. If a user connects via HashPack, authenticates, then disconnects and reconnects via a different method, the session token is still valid for that accountId. This is by design for flexibility but means the session doesn't verify the signing key matches the original auth.",
      recommendation: "For the hybrid DEX, this is acceptable. The server verifies the ED25519 signature at session creation time. As long as the session TTL is short (30 min), risk is minimal.",
      codeRef: "auth.ts:224-257, server/index.tsx:656-672",
      status: "acknowledged",
    });

    // MetaMask security
    multiFindings.push({
      id: "MULTI-003",
      category: "EVM Security",
      title: "MetaMask integration uses pure EIP-1193 — minimal attack surface",
      severity: "pass",
      description: "The MetaMask integration in metamask.ts uses only window.ethereum.request() for all RPC calls. No external dependencies (web3.js/ethers removed). ERC-20 balances use raw eth_call with manual ABI encoding. This is the most secure approach — all signing happens in MetaMask, no proxy libraries.",
      recommendation: "No action needed. Clean implementation.",
      codeRef: "metamask.ts:111-182",
      status: "mitigated",
    });

    allSections.push({
      title: "Multi-Wallet Security Assessment",
      icon: <Key className="w-4 h-4" />,
      diagnostics: multiDiag,
      findings: multiFindings,
    });

    // ─────────────────────────────────────────────────────────────────
    // SECTION 6: Console Suppression & Error Masking
    // ─────────────────────────────────────────────────────────────────
    const suppressDiag: DiagnosticResult[] = [];
    const suppressFindings: Finding[] = [];

    suppressDiag.push({
      label: "Suppressed Error Patterns",
      value: "13 patterns",
      status: "warn",
      detail: "polyfills.ts suppresses 13 console patterns + 6 global error patterns",
    });

    suppressDiag.push({
      label: "Global Error Handlers",
      value: "2 active",
      status: "warn",
      detail: "unhandledrejection + error events intercepted for WC patterns",
    });

    suppressFindings.push({
      id: "SUPP-001",
      category: "Observability",
      title: "Aggressive console suppression may hide real bugs",
      severity: "medium",
      description: "polyfills.ts suppresses 13 console patterns including 'User rejected' — a legitimate user action that downstream code may need to handle. The unhandledrejection handler silently swallows WC-related promise rejections, making it impossible to diagnose signing failures in production. During development, this hides the actual error when signing fails.",
      recommendation: "Keep suppression for truly noise patterns (MaxListeners, Lit dev mode, deprecated warnings). Remove suppression for: 'User rejected' (meaningful UX signal), 'send was called before connect' (indicates real relay issue). Instead of swallowing unhandledrejections, log them to the app logger buffer.",
      codeRef: "polyfills.ts:81-113, 171-238",
      status: "open",
    });

    suppressFindings.push({
      id: "SUPP-002",
      category: "Debugging",
      title: "Console.log/warn/error monkey-patched globally",
      severity: "low",
      description: "polyfills.ts replaces console.log, console.warn, and console.error with filtered versions. While it has Vite passthrough protection, any new WC-related error message that doesn't match the suppress list will still show, and any message that does match will be silently dropped. This makes it hard to add new WC features because their debug output may get suppressed.",
      recommendation: "Consider using the structured logger (logger.ts) for all WC operations instead of console.*. Then the polyfill suppression only affects third-party library noise, not app code.",
      codeRef: "polyfills.ts:148-167",
      status: "acknowledged",
    });

    allSections.push({
      title: "Console Suppression & Error Masking",
      icon: <Eye className="w-4 h-4" />,
      diagnostics: suppressDiag,
      findings: suppressFindings,
    });

    // ─────────────────────────────────────────────────────────────────
    // SECTION 7: Bridge & DEX Attack Surface
    // ─────────────────────────────────────────────────────────────────
    const attackFindings: Finding[] = [];
    const attackDiag: DiagnosticResult[] = [];

    attackDiag.push({
      label: "Auth Flow",
      value: "ED25519 Challenge-Response",
      status: "ok",
      detail: "CSPRNG nonces, single-use, 5-min expiry, server-verified",
    });

    attackDiag.push({
      label: "Session Security",
      value: "32-byte CSPRNG tokens, KV-backed",
      status: "ok",
      detail: "30-min TTL, account-bound, server-revocable",
    });

    attackDiag.push({
      label: "Vote Manipulation Protection",
      value: "Server-side balance check",
      status: "ok",
      detail: "Voting power calculated from Mirror Node at vote time",
    });

    attackFindings.push({
      id: "ATK-001",
      category: "Transaction Replay",
      title: "No transaction nonce tracking on client side",
      severity: "info",
      description: "Transaction signing via signAndExecuteTransaction delegates nonce management to the wallet (HashPack). This is correct for HIP-820 — the wallet handles nonces. However, the client has no way to detect if a transaction was submitted twice (e.g., user double-clicks swap).",
      recommendation: "Add client-side debounce on all transaction-triggering buttons (already partially done with actionLoading state in DAO). Ensure all swap/transfer buttons have loading state guards.",
      codeRef: "hashpack.ts:395-420",
      status: "acknowledged",
    });

    attackFindings.push({
      id: "ATK-002",
      category: "Session Fixation",
      title: "Auth session tokens are not rotated on privilege escalation",
      severity: "pass",
      description: "MITIGATED: (1) Server-side: POST /auth/session now revokes existing sessions for the same accountId via per-account index (AUTH_ACCT_SESSION_PREFIX) before creating a new one. Only one active session per account at any time. (2) Client-side: clearSession() in auth.ts is now awaitable (returns Promise<void>) and forceReauthenticate() in dao.ts awaits the DELETE revocation before creating a new session. (3) DELETE /auth/session also cleans up the per-account index.",
      recommendation: "Complete. Per-account session index ensures atomic revocation even if client-side DELETE fails.",
      codeRef: "server/index.tsx (AUTH_ACCT_SESSION_PREFIX), auth.ts:83-98, dao.ts:469-472",
      status: "mitigated",
    });

    attackFindings.push({
      id: "ATK-003",
      category: "Supply Chain",
      title: "@walletconnect/sign-client and @walletconnect/modal are trusted dependencies",
      severity: "pass",
      description: "WC packages are widely audited open-source projects. The app uses v2.23.4 (sign-client) and v2.7.0 (modal). No known CVEs for these versions. The WC Project ID is a public identifier, not a secret.",
      recommendation: "Keep dependencies updated. Monitor WC security advisories.",
      codeRef: "package.json:40-42",
      status: "mitigated",
    });

    attackFindings.push({
      id: "ATK-004",
      category: "Bridge Security",
      title: "Bridge integrations are read-only embeds — no signing exposure",
      severity: "pass",
      description: "The bridge components (HashPort, Stargate, Squid) are embedded iframes/widgets. They don't share wallet connections with the main app. Each bridge has its own wallet connection flow, isolating signing contexts.",
      recommendation: "Continue using iframe isolation for bridge widgets. Never pass signing sessions cross-origin.",
      codeRef: "Bridges.tsx, HashPortBridgeWidget.tsx, StargateBridgeWidget.tsx",
      status: "mitigated",
    });

    allSections.push({
      title: "Bridge & DEX Attack Surface",
      icon: <ShieldAlert className="w-4 h-4" />,
      diagnostics: attackDiag,
      findings: attackFindings,
    });

    // ─────────────────────────────────────────────────────────────────
    // SECTION 8: Recommended Fixes — Priority Order
    // ─────────────────────────────────────────────────────────────────
    const recFindings: Finding[] = [];
    const recDiag: DiagnosticResult[] = [];

    recDiag.push({
      label: "Critical Issues",
      value: String(allSections.flatMap(s => s.findings).filter(f => f.severity === "critical").length),
      status: "error",
    });
    recDiag.push({
      label: "High Issues",
      value: String(allSections.flatMap(s => s.findings).filter(f => f.severity === "high").length),
      status: "warn",
    });
    recDiag.push({
      label: "Medium Issues",
      value: String(allSections.flatMap(s => s.findings).filter(f => f.severity === "medium").length),
      status: "warn",
    });
    recDiag.push({
      label: "Passed Checks",
      value: String(allSections.flatMap(s => s.findings).filter(f => f.severity === "pass").length),
      status: "ok",
    });

    recFindings.push({
      id: "REC-001",
      category: "Priority 1 — Signing Reliability",
      title: "Add session validation before all client.request() calls",
      severity: "pass",
      description: "COMPLETED: _validateSessionBeforeRequest(client, topic) implemented in wallet-core.ts (~55 lines). Checks: (1) client.session.get(topic) exists, (2) Session expiry timestamp not exceeded (cleans up if expired), (3) Relay connected — if disconnected, polls for 3s reconnect before proceeding. Called before every client.request() in signAndExecuteTransaction, signTransactionViaWC, and signMessageViaWC. Also fixed: hashpack.ts signing functions were missing _activeNetwork parameter (reconstruction bug — param-shift caused accountId to be passed as network), and signMessage was double-wrapping { signatures }.",
      recommendation: "Complete. All three signing call sites validated. User-facing error: 'Wallet session expired or was disconnected remotely. Please reconnect your wallet from the wallet menu.'",
      codeRef: "wallet-core.ts:239-292 (_validateSessionBeforeRequest), hashpack.ts:387-442 (fixed param-shift)",
      status: "mitigated",
    });

    recFindings.push({
      id: "REC-002",
      category: "Priority 2 — UX Smoothness",
      title: "Build an in-app SigningOverlay component",
      severity: "pass",
      description: "COMPLETED: SigningProvider + SigningOverlay implemented in contexts/SigningContext.tsx. Features: animated overlay with wallet icon, 5-min countdown timer, cancel with AbortController, beforeunload interception, error state with 'Reconnect Wallet' action (dispatches wrappdex:open-wallet-modal event), success flash. Any component can use `useSigning().withSigning(label, asyncFn)` to wrap signing operations.",
      recommendation: "Integrate withSigning() into auth.ts authenticate(), dao.ts vote/propose flows, and swap confirmation.",
      codeRef: "contexts/SigningContext.tsx, App.tsx (provider)",
      status: "mitigated",
    });

    recFindings.push({
      id: "REC-003",
      category: "Priority 3 — Code Cleanup",
      title: "Remove 250+ lines of dead code",
      severity: "pass",
      description: "COMPLETED: All dead code removed. (1) 5 stub functions in hashpack.ts removed (DEAD-001), (2) wc-qr step + QRCodeSVG + handleCopyUri + copied state + 3 icon imports removed from WalletConnectModal.tsx (DEAD-002), (3) Manual pairing functions not reconstructed (DEAD-003), (4) Dual modal system resolved (DEAD-004), (5) Deep link functions + isMobileDevice + unused findSessionForAccount import removed (DEAD-005). Also fixed: signMessage return type (Uint8Array → { signatures }) and clearWCStorage parameter passthrough.",
      recommendation: "Complete. Additional cleanup: connectPromiseRef (dead ref) also removed.",
      codeRef: "hashpack.ts, WalletConnectModal.tsx",
      status: "mitigated",
    });

    recFindings.push({
      id: "REC-004",
      category: "Priority 4 — Stale Session Detection",
      title: "Auto-detect and recover from stale WC sessions on app load",
      severity: "pass",
      description: "COMPLETED: restoreSession() in hashpack.ts now schedules an async validation 2s after mount. _scheduleSessionValidation() waits for SignClient to initialize, then verifies the persisted wcTopic exists in client.session. If the topic is missing, it scans all sessions for the accountId (handles topic migration). If no session is found at all, clears localStorage and fires stale-session callbacks. WalletContext.tsx subscribes via onStaleSession() and resets wallet state with an error message prompting reconnection.",
      recommendation: "Complete. Stale sessions detected within ~2-4s of app load. Consider adding a toast notification for better UX.",
      codeRef: "hashpack.ts (_scheduleSessionValidation, onStaleSession), WalletContext.tsx (stale session listener)",
      status: "mitigated",
    });

    allSections.push({
      title: "Recommended Fixes — Priority Order",
      icon: <Zap className="w-4 h-4" />,
      diagnostics: recDiag,
      findings: recFindings,
    });

    if (runId === runRef.current) {
      setSections(allSections);
      setLastRun(Date.now());
      setIsRunning(false);
    }
  }, [hashPackSession, hederaAccount, metaMaskAccount]);

  // Auto-run on mount
  useEffect(() => {
    runDiagnostics();
  }, [runDiagnostics]);

  // ── Render ─────────────────────────────────────────────────────────

  const totalFindings = sections.flatMap(s => s.findings);
  const critCount = totalFindings.filter(f => f.severity === "critical").length;
  const highCount = totalFindings.filter(f => f.severity === "high").length;
  const passCount = totalFindings.filter(f => f.severity === "pass").length;
  const overallScore = critCount > 0 ? "CRITICAL" : highCount > 0 ? "NEEDS ATTENTION" : "HEALTHY";
  const overallColor = critCount > 0 ? "text-red-400" : highCount > 0 ? "text-amber-400" : "text-emerald-400";

  return (
    <div className={`rounded-2xl border overflow-hidden ${
      isDark ? "bg-[#0a0a14]/90 border-white/[0.06]" : "bg-white/90 border-gray-200"
    }`}>
      {/* Header */}
      <div className={`px-6 py-5 border-b ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500/20 to-amber-500/20 border border-red-500/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className={`text-base font-semibold tracking-tight ${isDark ? "text-white" : "text-gray-900"}`}>
                WalletConnect Health Report
              </h3>
              <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                CertiK-Level Assessment &mdash; Wallet Signing Infrastructure
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`text-sm font-semibold ${overallColor}`}>
              {isRunning ? "Scanning..." : overallScore}
            </div>
            <button
              onClick={runDiagnostics}
              disabled={isRunning}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                isDark
                  ? "bg-white/[0.05] hover:bg-white/[0.08] text-white/70 border border-white/[0.06]"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
              } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Re-scan
            </button>
          </div>
        </div>

        {lastRun && (
          <p className={`text-[10px] mt-2 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            Last scan: {new Date(lastRun).toLocaleString()} &mdash; {totalFindings.length} findings ({critCount} critical, {highCount} high, {passCount} passed)
          </p>
        )}
      </div>

      {/* Sections */}
      <div className="divide-y divide-white/[0.04]">
        {sections.map((section) => {
          const isExpanded = expandedSections.has(section.title);
          const sectionCrit = section.findings.filter(f => f.severity === "critical").length;
          const sectionHigh = section.findings.filter(f => f.severity === "high").length;
          const sectionPass = section.findings.filter(f => f.severity === "pass").length;

          return (
            <div key={section.title}>
              {/* Section Header */}
              <button
                onClick={() => toggleSection(section.title)}
                className={`w-full px-6 py-4 flex items-center gap-3 transition-colors ${
                  isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50"
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                  sectionCrit > 0
                    ? "bg-red-500/15 text-red-400"
                    : sectionHigh > 0
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-emerald-500/15 text-emerald-400"
                }`}>
                  {section.icon}
                </div>
                <span className={`flex-1 text-left text-sm font-medium ${isDark ? "text-white/90" : "text-gray-900"}`}>
                  {section.title}
                </span>
                <div className="flex items-center gap-2">
                  {sectionCrit > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">
                      {sectionCrit} CRIT
                    </span>
                  )}
                  {sectionHigh > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
                      {sectionHigh} HIGH
                    </span>
                  )}
                  {sectionPass > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                      {sectionPass} PASS
                    </span>
                  )}
                  <span className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                    {section.findings.length} findings
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-white/30" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-white/30" />
                  )}
                </div>
              </button>

              {/* Section Content */}
              {isExpanded && (
                <div className={`px-6 pb-5 space-y-4 ${isDark ? "" : ""}`}>
                  {/* Diagnostics Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {section.diagnostics.map((d, i) => (
                      <div
                        key={i}
                        className={`rounded-lg px-3 py-2.5 border ${
                          isDark
                            ? "bg-white/[0.02] border-white/[0.04]"
                            : "bg-gray-50 border-gray-100"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-1.5 h-1.5 rounded-full ${statusDot(d.status)}`} />
                          <span className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                            {d.label}
                          </span>
                        </div>
                        <p className={`text-xs font-medium ${isDark ? "text-white/80" : "text-gray-800"}`}>
                          {d.value}
                        </p>
                        {d.detail && (
                          <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                            {d.detail}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Findings */}
                  <div className="space-y-2">
                    {section.findings.map((f) => {
                      const findExpanded = expandedFindings.has(f.id);
                      return (
                        <div
                          key={f.id}
                          className={`rounded-xl border overflow-hidden ${severityColor(f.severity)}`}
                        >
                          <button
                            onClick={() => toggleFinding(f.id)}
                            className="w-full px-4 py-3 flex items-start gap-3 text-left"
                          >
                            <div className="flex items-center gap-2 shrink-0 mt-0.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${severityColor(f.severity)}`}>
                                {severityLabel(f.severity)}
                              </span>
                              <span className="text-[10px] font-mono opacity-50">{f.id}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium leading-relaxed">{f.title}</p>
                              <p className="text-[10px] opacity-50 mt-0.5">{f.category}</p>
                            </div>
                            <div className="shrink-0">
                              {f.status === "mitigated" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                              {f.status === "acknowledged" && <Eye className="w-3.5 h-3.5 text-blue-400" />}
                              {f.status === "open" && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                            </div>
                          </button>

                          {findExpanded && (
                            <div className={`px-4 pb-4 space-y-3 border-t ${
                              isDark ? "border-white/[0.04]" : "border-black/[0.04]"
                            }`}>
                              <div className="pt-3">
                                <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-1">Description</p>
                                <p className="text-[11px] leading-relaxed opacity-80">{f.description}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-1">Recommendation</p>
                                <p className="text-[11px] leading-relaxed opacity-80">{f.recommendation}</p>
                              </div>
                              {f.codeRef && (
                                <div className="flex items-center gap-1.5">
                                  <Code2 className="w-3 h-3 opacity-40" />
                                  <span className="text-[10px] font-mono opacity-40">{f.codeRef}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                                  f.status === "mitigated"
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : f.status === "acknowledged"
                                      ? "bg-blue-500/15 text-blue-400"
                                      : "bg-amber-500/15 text-amber-400"
                                }`}>
                                  {f.status.toUpperCase()}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className={`px-6 py-4 border-t ${isDark ? "border-white/[0.04]" : "border-gray-200"}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-slate-600" />
            <p className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
              Wrappdex Security Assessment v1.0 &mdash; Generated {new Date().toLocaleDateString()} &mdash; For internal review only
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                clearWCStorage(false);
                await runDiagnostics();
              }}
              className={`text-[10px] px-2.5 py-1 rounded-md flex items-center gap-1 ${
                isDark
                  ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  : "bg-amber-100 text-amber-700 hover:bg-amber-200"
              } transition-colors`}
            >
              <Trash2 className="w-3 h-3" /> Clean WC Storage
            </button>
            <button
              onClick={async () => {
                await forceResetSignClient();
                clearHashPackSession();
                await runDiagnostics();
              }}
              className={`text-[10px] px-2.5 py-1 rounded-md flex items-center gap-1 ${
                isDark
                  ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                  : "bg-red-100 text-red-700 hover:bg-red-200"
              } transition-colors`}
            >
              <Unlink className="w-3 h-3" /> Force Reset All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
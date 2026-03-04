/**
 * Security & System Health — Wrappdex
 *
 * Production-grade status dashboard. All data is live — zero mock entries.
 *
 * Architecture:
 *   Server checks  → GET /health  (KV-cached 24 h, parallel probes)
 *   Wallet checks  → Client-side  (instant, no network calls)
 *
 * Performance: server results load from cache on repeat visits (<50 ms).
 * Client diagnostics run synchronously on mount — no perceptible delay.
 */

import { useWallet } from "../contexts/WalletContext";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import {
  isWalletConnectConfigured,
  getSignClient,
} from "../utils/wallet-core";
import { restoreSession, getCurrentHashConnect } from "../utils/hashpack";
import { getSessionToken, getSessionAccountId } from "../utils/auth";
import { isMetaMaskInstalled } from "../utils/metamask";
import { isDynamicSDKAvailable } from "./DynamicSDKWrapper";

// ── Constants ──────────────────────────────────────────────────────

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

type Status = "ok" | "degraded" | "error" | "loading";

interface CheckItem {
  label: string;
  status: Status;
  value: string;
  detail?: string;
  latencyMs?: number;
}

interface ServerHealth {
  timestamp: number;
  totalMs: number;
  fromCache: boolean;
  checks: Record<string, { status: Status; latencyMs: number; detail?: string }>;
}

// ── Status Helpers ───────────────────────────────────────────────────

function StatusDot({ status }: { status: Status }) {
  const color =
    status === "ok"
      ? "bg-emerald-400"
      : status === "degraded"
        ? "bg-amber-400"
        : status === "error"
          ? "bg-red-400"
          : "bg-slate-500";
  return (
    <span className="relative flex h-2 w-2">
      {status === "ok" && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 animate-ping" />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

function statusLabel(s: Status): string {
  return s === "ok" ? "Operational" : s === "degraded" ? "Degraded" : s === "error" ? "Down" : "Checking";
}

function overallStatus(items: CheckItem[]): Status {
  if (items.some((i) => i.status === "loading")) return "loading";
  if (items.some((i) => i.status === "error")) return "error";
  if (items.some((i) => i.status === "degraded")) return "degraded";
  return "ok";
}

function overallLabel(s: Status): string {
  return s === "ok"
    ? "All Systems Operational"
    : s === "degraded"
      ? "Partial Degradation"
      : s === "error"
        ? "Service Disruption"
        : "Running Checks\u2026";
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const SERVER_CHECK_META: Record<string, { label: string; icon: React.ReactNode }> = {
  kvStore:      { label: "KV Store",          icon: <Database className="w-3.5 h-3.5" /> },
  storage:      { label: "Object Storage",    icon: <HardDrive className="w-3.5 h-3.5" /> },
  binance:      { label: "Binance API",       icon: <Activity className="w-3.5 h-3.5" /> },
  coingecko:    { label: "CoinGecko API",     icon: <Activity className="w-3.5 h-3.5" /> },
  coincap:      { label: "CoinCap v3",        icon: <Activity className="w-3.5 h-3.5" /> },
  fearGreed:    { label: "Fear & Greed",      icon: <Activity className="w-3.5 h-3.5" /> },
  dexscreener:  { label: "DexScreener",       icon: <Activity className="w-3.5 h-3.5" /> },
};

// ── Main Component ───────────────────────────────────────────────────

export function Audit() {
  const { hashPackSession, metaMaskAccount } = useWallet();

  // Server-side checks
  const [serverChecks, setServerChecks] = useState<CheckItem[]>([]);
  const [serverTimestamp, setServerTimestamp] = useState<number | null>(null);
  const [serverFromCache, setServerFromCache] = useState(false);
  const [serverLoading, setServerLoading] = useState(true);

  // Client-side wallet checks
  const [walletChecks, setWalletChecks] = useState<CheckItem[]>([]);
  const [walletTimestamp, setWalletTimestamp] = useState<number | null>(null);

  const refreshCountRef = useRef(0);

  // ── Fetch server health ──────────────────────────────────────────

  const fetchServerHealth = useCallback(async (forceRefresh = false) => {
    const runId = ++refreshCountRef.current;
    setServerLoading(true);

    // Skeleton placeholders while loading
    setServerChecks(
      Object.entries(SERVER_CHECK_META).map(([, meta]) => ({
        label: meta.label,
        status: "loading" as Status,
        value: "Checking\u2026",
      })),
    );

    try {
      const url = `${API_BASE}/health${forceRefresh ? "?refresh=1" : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${publicAnonKey}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data: ServerHealth = await res.json();
      if (runId !== refreshCountRef.current) return; // stale response

      const items: CheckItem[] = Object.entries(data.checks).map(([key, check]) => {
        const meta = SERVER_CHECK_META[key] || { label: key, icon: null };
        return {
          label: meta.label,
          status: check.status as Status,
          value: check.status === "ok" ? `${check.latencyMs}ms` : statusLabel(check.status as Status),
          detail: check.detail,
          latencyMs: check.latencyMs,
        };
      });

      setServerChecks(items);
      setServerTimestamp(data.timestamp);
      setServerFromCache(!!data.fromCache);
    } catch (err) {
      log.warn("Audit", "Server health fetch failed", err);
      if (runId !== refreshCountRef.current) return;
      setServerChecks(
        Object.entries(SERVER_CHECK_META).map(([, meta]) => ({
          label: meta.label,
          status: "error" as Status,
          value: "Unreachable",
          detail: "Edge function did not respond",
        })),
      );
      setServerTimestamp(null);
      setServerFromCache(false);
    } finally {
      if (runId === refreshCountRef.current) setServerLoading(false);
    }
  }, []);

  // ── Run client-side wallet diagnostics ───────────────────────────

  const runWalletChecks = useCallback(async () => {
    const items: CheckItem[] = [];

    // WalletConnect configuration
    const wcConfigured = isWalletConnectConfigured();
    items.push({
      label: "WC Project ID",
      status: wcConfigured ? "ok" : "error",
      value: wcConfigured ? "Configured" : "Missing / Invalid",
    });

    // SignClient & Relay
    let clientReady = false;
    let relayConnected = false;
    let sessionCount = 0;
    try {
      const client = await getSignClient();
      clientReady = !!client;
      relayConnected = !!client?.core?.relayer?.connected;
      sessionCount = client?.session?.getAll?.()?.length ?? 0;
    } catch {
      clientReady = false;
    }

    items.push({
      label: "SignClient",
      status: clientReady ? "ok" : "error",
      value: clientReady ? "Initialized" : "Failed",
    });

    items.push({
      label: "WC Relay",
      status: relayConnected ? "ok" : clientReady ? "degraded" : "error",
      value: relayConnected ? "Connected" : "Disconnected",
      detail: relayConnected ? "wss://relay.walletconnect.com" : undefined,
    });

    items.push({
      label: "WC Sessions",
      status: sessionCount > 0 ? "ok" : "degraded",
      value: `${sessionCount} active`,
    });

    // HashPack session
    const hpSession = restoreSession();
    const hcState = getCurrentHashConnect();
    items.push({
      label: "HashPack",
      status: hpSession ? "ok" : "degraded",
      value: hpSession ? `${hpSession.accountId}` : "No session",
      detail: hpSession && hcState.topic ? `Topic: ${hcState.topic.slice(0, 10)}\u2026` : undefined,
    });

    // Auth session
    const authToken = getSessionToken();
    const authAcct = getSessionAccountId();
    items.push({
      label: "Auth Session",
      status: authToken ? "ok" : "degraded",
      value: authToken ? `Active (${authAcct})` : "None",
      detail: authToken ? "ED25519 challenge-response, 30-min TTL" : "Will prompt on next mutation",
    });

    // MetaMask
    const mmInstalled = isMetaMaskInstalled();
    items.push({
      label: "MetaMask",
      status: metaMaskAccount ? "ok" : mmInstalled ? "degraded" : "degraded",
      value: metaMaskAccount
        ? `${metaMaskAccount.address.slice(0, 8)}\u2026`
        : mmInstalled
          ? "Installed, not connected"
          : "Not detected",
    });

    // Dynamic Labs SDK
    items.push({
      label: "Dynamic SDK",
      status: isDynamicSDKAvailable ? "ok" : "degraded",
      value: isDynamicSDKAvailable ? "Loaded" : "Unavailable",
    });

    setWalletChecks(items);
    setWalletTimestamp(Date.now());
  }, [hashPackSession, metaMaskAccount]);

  // ── Auto-run on mount ────────────────────────────────────────────

  useEffect(() => {
    fetchServerHealth(false);
  }, [fetchServerHealth]);

  useEffect(() => {
    runWalletChecks();
  }, [runWalletChecks]);

  // ── Derived state ────────────────────────────────────────────────

  const infraStatus = overallStatus(serverChecks);
  const walletStatus = overallStatus(walletChecks);
  const globalStatus: Status =
    infraStatus === "error" || walletStatus === "error"
      ? "error"
      : infraStatus === "degraded" || walletStatus === "degraded" || infraStatus === "loading"
        ? "degraded"
        : "ok";

  // ── Styles ───────────────────────────────────────────────────────

  const card = isDark
    ? "rounded-2xl border border-white/[0.06] bg-[#0a0a14]/80 backdrop-blur-sm"
    : "rounded-2xl border border-gray-200 bg-white";

  const subcard = isDark
    ? "rounded-xl border border-white/[0.04] bg-white/[0.02]"
    : "rounded-xl border border-gray-100 bg-gray-50/50";

  const muted = isDark ? "text-slate-500" : "text-gray-400";
  const subtle = isDark ? "text-slate-400" : "text-gray-600";
  const heading = isDark ? "text-white" : "text-gray-900";

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className={`${card} p-6`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                globalStatus === "ok"
                  ? isDark
                    ? "bg-emerald-500/10 border border-emerald-500/20"
                    : "bg-emerald-50 border border-emerald-200"
                  : globalStatus === "error"
                    ? isDark
                      ? "bg-red-500/10 border border-red-500/20"
                      : "bg-red-50 border border-red-200"
                    : isDark
                      ? "bg-amber-500/10 border border-amber-500/20"
                      : "bg-amber-50 border border-amber-200"
              }`}
            >
              {globalStatus === "ok" ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              ) : globalStatus === "error" ? (
                <XCircle className="w-6 h-6 text-red-400" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-amber-400" />
              )}
            </div>
            <div>
              <h1 className={`text-xl font-bold tracking-tight ${heading}`}>
                {overallLabel(globalStatus)}
              </h1>
              <p className={`text-xs mt-0.5 ${muted}`}>
                Wrappdex infrastructure &amp; wallet diagnostics
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              fetchServerHealth(true);
              runWalletChecks();
            }}
            disabled={serverLoading}
            className={`px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-all ${
              isDark
                ? "bg-white/[0.05] hover:bg-white/[0.08] text-white/70 border border-white/[0.08]"
                : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
            } ${serverLoading ? "opacity-50 cursor-not-allowed" : ""}`}
            aria-label="Re-run all health checks"
          >
            {serverLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {serverLoading ? "Checking\u2026" : "Run Check"}
          </button>
        </div>

        {/* Timestamp strip */}
        {(serverTimestamp || walletTimestamp) && (
          <div className={`flex items-center gap-4 mt-4 pt-3 border-t ${isDark ? "border-white/[0.04]" : "border-gray-100"}`}>
            <Clock className={`w-3 h-3 ${muted}`} />
            {serverTimestamp && (
              <span className={`text-xs ${muted}`}>
                Infrastructure: {formatAge(serverTimestamp)}
                {serverFromCache && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded text-xs ${isDark ? "bg-blue-500/10 text-blue-400" : "bg-blue-50 text-blue-600"}`}>
                    cached
                  </span>
                )}
              </span>
            )}
            {walletTimestamp && (
              <span className={`text-xs ${muted}`}>
                Wallet: {formatAge(walletTimestamp)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Infrastructure Status ───────────────────────────────────── */}
      <div className={card}>
        <div className={`px-6 py-4 border-b ${isDark ? "border-white/[0.04]" : "border-gray-100"} flex items-center gap-3`}>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
            infraStatus === "ok"
              ? "bg-emerald-500/10 text-emerald-400"
              : infraStatus === "error"
                ? "bg-red-500/10 text-red-400"
                : "bg-amber-500/10 text-amber-400"
          }`}>
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h2 className={`text-sm font-semibold ${heading}`}>Infrastructure</h2>
            <p className={`text-xs ${muted}`}>Edge function, database, storage, external APIs</p>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {serverChecks.map((check) => {
            const meta = Object.values(SERVER_CHECK_META).find((m) => m.label === check.label);
            return (
              <div key={check.label} className={`${subcard} px-4 py-3`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={subtle}>{meta?.icon}</span>
                    <span className={`text-xs font-medium ${heading}`}>{check.label}</span>
                  </div>
                  <StatusDot status={check.status} />
                </div>
                <div className="flex items-baseline justify-between">
                  <span className={`text-sm font-semibold tabular-nums ${
                    check.status === "ok"
                      ? "text-emerald-400"
                      : check.status === "degraded"
                        ? "text-amber-400"
                        : check.status === "error"
                          ? "text-red-400"
                          : muted
                  }`}>
                    {check.value}
                  </span>
                  {check.latencyMs !== undefined && check.status === "ok" && (
                    <span className={`text-xs ${muted}`}>{check.latencyMs}ms</span>
                  )}
                </div>
                {check.detail && (
                  <p className={`text-xs mt-1 ${muted} truncate`}>{check.detail}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Wallet & Connection Status ──────────────────────────────── */}
      <div className={card}>
        <div className={`px-6 py-4 border-b ${isDark ? "border-white/[0.04]" : "border-gray-100"} flex items-center gap-3`}>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
            walletStatus === "ok"
              ? "bg-emerald-500/10 text-emerald-400"
              : walletStatus === "error"
                ? "bg-red-500/10 text-red-400"
                : "bg-amber-500/10 text-amber-400"
          }`}>
            <Wallet className="w-4 h-4" />
          </div>
          <div>
            <h2 className={`text-sm font-semibold ${heading}`}>Wallet &amp; Auth</h2>
            <p className={`text-xs ${muted}`}>WalletConnect, HashPack, MetaMask, Dynamic Labs, session tokens</p>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {walletChecks.map((check) => (
            <div key={check.label} className={`${subcard} px-4 py-3`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs uppercase tracking-wider font-medium ${muted}`}>
                  {check.label}
                </span>
                <StatusDot status={check.status} />
              </div>
              <p className={`text-xs font-medium ${heading} truncate`}>{check.value}</p>
              {check.detail && (
                <p className={`text-xs mt-0.5 ${muted} truncate`}>{check.detail}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <p className={`text-center text-xs py-2 ${isDark ? "text-slate-700" : "text-gray-300"}`}>
        Server checks are cached for 24 hours. Click "Run Check" to force a live re-scan.
      </p>
    </div>
  );
}
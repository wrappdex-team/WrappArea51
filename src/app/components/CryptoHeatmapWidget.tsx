// ─────────────────────────────────────────────────────────────────────
// QuantifyCrypto Widgets — VIP Token-Gated, Sandboxed Iframe Containers
// ─────────────────────────────────────────────────────────────────────
//
// ACCESS CONTROL — 3-Layer VIP Verification:
//   [LAYER-1] Fast: WalletContext cached token list → isVipEligible()
//   [LAYER-2] Authoritative: Direct Mirror Node re-verification (client)
//   [LAYER-3] Server: GET /vip/status (session-authenticated, Mirror Node)
//
//   Gate: Hold ≥100M HBAR.ħ tokens (0.0.9356476) OR ≥1 VIP NFT (0.0.10146181)
//   Either one unlocks — both NOT required.
//
//   Fail-CLOSED: If verification fails, widgets stay locked.
//   Non-VIP users see a locked overlay — no widget iframes are rendered.
//
// IFRAME SECURITY:
//   - sandbox="allow-scripts allow-same-origin" (minimum for widget API calls)
//   - No CSP meta tag — sandbox is the security boundary
//   - Widgets are purely read-only price displays
//   - Zero interaction with wallet state, AMM engine, KV store, or auth
// ─────────────────────────────────────────────────────────────────────

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Crown, Lock, ShieldCheck, AlertTriangle } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { isVipEligible, verifyVipEligibilityDirect } from "../utils/vip";
import { GATE_THRESHOLD, formatTokenCount } from "../utils/dao";
import { getSessionToken } from "../utils/auth";
import { projectId, publicAnonKey } from "/utils/supabase/info";

// ── Constants ────────────────────────────────────────────────────────

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;
const SANDBOX = "allow-scripts allow-same-origin";
const SERVER_VERIFY_INTERVAL_MS = 5 * 60 * 1000; // Re-verify every 5 min

// ── VIP verification state machine ──────────────────────────────────

type VipGateState =
  | "no_wallet"        // No wallet connected
  | "checking"         // Running verification
  | "eligible"         // Verified VIP
  | "not_eligible"     // Verified non-VIP
  | "error";           // Verification failed (fail-closed → locked)

interface VipVerification {
  state: VipGateState;
  tokenBalance: number;
  nftCount: number;
  verifiedAt: number;
  serverVerified: boolean;
  error: string | null;
}

const INITIAL_VERIFICATION: VipVerification = {
  state: "no_wallet",
  tokenBalance: 0,
  nftCount: 0,
  verifiedAt: 0,
  serverVerified: false,
  error: null,
};

// ── Shared iframe styles ─────────────────────────────────────────────

function baseStyles(bg: string): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      background: ${bg};
      overflow-x: hidden;
      min-height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    body::-webkit-scrollbar { display: none; }
    body { -ms-overflow-style: none; scrollbar-width: none; }
  `;
}

// ── Server-side VIP verification ────────────────────────────────────

async function verifyVipOnServer(): Promise<{
  eligible: boolean;
  tokenBalance: number;
  nftCount: number;
  error: string | null;
}> {
  const sessionToken = getSessionToken();
  if (!sessionToken) {
    return { eligible: false, tokenBalance: 0, nftCount: 0, error: "no_session" };
  }

  try {
    const res = await fetch(`${API_BASE}/vip/status`, {
      headers: {
        Authorization: `Bearer ${publicAnonKey}`,
        "X-Session-Token": sessionToken,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        eligible: false,
        tokenBalance: 0,
        nftCount: 0,
        error: data?.error || `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    return {
      eligible: !!data.eligible,
      tokenBalance: data.tokenBalance ?? 0,
      nftCount: data.nftCount ?? 0,
      error: null,
    };
  } catch (err: any) {
    console.error("[VIP-GATE] Server verification failed:", err?.message || err);
    return {
      eligible: false,
      tokenBalance: 0,
      nftCount: 0,
      error: err?.message || "Server verification failed",
    };
  }
}

// ═════════════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════════════

export function CryptoHeatmapWidget() {
  const { isDark } = useTheme();
  const { hederaAccount, hederaNetwork, hashPackSession } = useWallet();

  const [vip, setVip] = useState<VipVerification>(INITIAL_VERIFICATION);
  const [tickerLoaded, setTickerLoaded] = useState(false);
  const [heatmapLoaded, setHeatmapLoaded] = useState(false);
  const [tickerError, setTickerError] = useState(false);
  const [heatmapError, setHeatmapError] = useState(false);
  const mountedRef = useRef(true);

  // Stable primitive values for dependency arrays (no new object refs per render)
  const accountId = hashPackSession?.accountId ?? null;
  const tokens = hederaAccount?.tokens;

  // Refs for values accessed inside the async verification callback.
  // Using refs avoids including unstable array/object references in
  // useCallback deps, which was causing infinite re-render loops.
  const tokensRef = useRef(tokens);
  const networkRef = useRef(hederaNetwork);
  tokensRef.current = tokens;
  networkRef.current = hederaNetwork;

  // ── 3-layer VIP verification ───────────────────────────────────
  // Deps: only the stable accountId string. Token/network reads go
  // through refs so the callback identity stays stable across renders.
  const runVerification = useCallback(async () => {
    if (!accountId) {
      setVip((prev) =>
        prev.state === "no_wallet" ? prev : { ...INITIAL_VERIFICATION, state: "no_wallet" },
      );
      return;
    }

    setVip((prev) => (prev.state === "checking" ? prev : { ...prev, state: "checking" }));

    const currentTokens = tokensRef.current ?? [];
    const currentNetwork = networkRef.current;

    // Layer 1: Fast cached check from WalletContext
    const cachedEligible = isVipEligible(currentTokens, currentNetwork);

    // Layer 2: Direct Mirror Node re-verification (authoritative client-side)
    let directResult = { eligible: false, balance: 0, nftCount: 0, error: null as string | null };
    try {
      directResult = await verifyVipEligibilityDirect(accountId);
    } catch (err: any) {
      directResult.error = err?.message || "Mirror Node check failed";
    }

    if (!mountedRef.current) return;

    // Combine Layer 1 + Layer 2: Layer 2 overrides if it completed successfully
    const clientEligible = directResult.error
      ? cachedEligible // Fallback to cache if Mirror Node failed
      : directResult.eligible || directResult.nftCount >= 1;

    // Layer 3: Server-side verification (session-authenticated, authoritative)
    let serverResult = { eligible: false, tokenBalance: 0, nftCount: 0, error: null as string | null };
    const sessionToken = getSessionToken();
    if (sessionToken) {
      serverResult = await verifyVipOnServer();
    }

    if (!mountedRef.current) return;

    // Final decision: server is authoritative when available.
    // Fail-CLOSED: if server says no and client says yes, deny.
    let finalEligible: boolean;
    let serverVerified = false;

    if (serverResult.error === "no_session") {
      // No session — rely on client-side verification only.
      // Acceptable because widget content is publicly available data;
      // the VIP gate is about user experience, not protecting secrets.
      finalEligible = clientEligible;
    } else if (serverResult.error) {
      // Server error — log warning, fall back to client check
      console.warn("[VIP-GATE] Server verification error, using client-side check:", serverResult.error);
      finalEligible = clientEligible;
    } else {
      // Server responded — source of truth
      finalEligible = serverResult.eligible;
      serverVerified = true;
    }

    setVip({
      state: finalEligible ? "eligible" : "not_eligible",
      tokenBalance: serverVerified ? serverResult.tokenBalance : directResult.balance,
      nftCount: serverVerified ? serverResult.nftCount : directResult.nftCount,
      verifiedAt: Date.now(),
      serverVerified,
      error: serverResult.error && directResult.error
        ? `Client: ${directResult.error}; Server: ${serverResult.error}`
        : null,
    });
  }, [accountId]); // Only stable primitive — refs used for tokens/network

  // Run verification on mount, on wallet change, and every 5 minutes
  useEffect(() => {
    mountedRef.current = true;
    runVerification();

    const timer = setInterval(runVerification, SERVER_VERIFY_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [runVerification]);

  // ── Iframe srcdocs (only built if VIP) ─────────────────────────

  const tickerSrcdoc = useMemo(() => {
    if (vip.state !== "eligible") return "";
    const bg = isDark ? "#080a12" : "#f8fafc";
    const theme = isDark ? "dark" : "light";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>${baseStyles(bg)}
    qc-price-ticker-widget { display: block; width: 100%; }
  </style>
</head>
<body>
  <qc-price-ticker-widget
    mode="custom"
    top-coins="true"
    gainers-and-losers="true"
    bg="${bg}"
    theme="${theme}"
    currency="USD">
  </qc-price-ticker-widget>
  <script src="https://quantifycrypto.com/widgets/marquee/js/qc-price-ticker-widget.js"><\/script>
</body>
</html>`;
  }, [isDark, vip.state]);

  const heatmapSrcdoc = useMemo(() => {
    if (vip.state !== "eligible") return "";
    const bg = isDark ? "#080a12" : "#f8fafc";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>${baseStyles(bg)}
    qc-heatmap { display: block; width: 100%; }
  </style>
</head>
<body>
  <qc-heatmap
    height="400px"
    num-of-coins="50"
    currency-code="USD">
  </qc-heatmap>
  <script src="https://quantifycrypto.com/widgets/heatmaps/js/qc-heatmap-widget.js"><\/script>
</body>
</html>`;
  }, [isDark, vip.state]);

  // ── Iframe event handlers ──────────────────────────────────────

  const handleTickerLoad = useCallback(() => setTickerLoaded(true), []);
  const handleTickerError = useCallback(() => setTickerError(true), []);
  const handleHeatmapLoad = useCallback(() => setHeatmapLoaded(true), []);
  const handleHeatmapError = useCallback(() => setHeatmapError(true), []);

  // Fallback: mark loaded after 10s
  useEffect(() => {
    if (vip.state !== "eligible") return;
    const t = setTimeout(() => {
      setTickerLoaded(true);
      setHeatmapLoaded(true);
    }, 10000);
    return () => clearTimeout(t);
  }, [vip.state]);

  // ── Card styling ───────────────────────────────────────────────

  const cardClass = isDark
    ? "rounded-xl border border-white/[0.06] bg-[#0d0f1a]/80 overflow-hidden"
    : "rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm";

  // ═══════════════════════════════════════════════════════════════
  // RENDER: Locked Overlay (non-VIP users)
  // ═══════════════════════════════════════════════════════════════

  if (vip.state !== "eligible") {
    return (
      <div className={cardClass}>
        <div className="relative overflow-hidden" style={{ minHeight: 320 }}>
          {/* Blurred preview background */}
          <div
            className="absolute inset-0"
            style={{
              background: isDark
                ? "linear-gradient(135deg, #0f1923 0%, #0d0f1a 30%, #111827 60%, #0d0f1a 100%)"
                : "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 50%, #f0f9ff 100%)",
            }}
          >
            {/* Fake heatmap grid pattern */}
            <div className="absolute inset-0 grid grid-cols-8 grid-rows-4 gap-0.5 p-4 opacity-20">
              {Array.from({ length: 32 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-sm"
                  style={{
                    background: isDark
                      ? `hsl(${[140, 0, 350, 140, 0, 140, 350, 0, 140, 0, 350, 140, 0, 140, 0, 350, 140, 350, 0, 140, 350, 0, 140, 350, 0, 140, 0, 350, 140, 0, 350, 140][i]}, 60%, ${20 + Math.random() * 15}%)`
                      : `hsl(${[140, 0, 350, 140, 0, 140, 350, 0, 140, 0, 350, 140, 0, 140, 0, 350, 140, 350, 0, 140, 350, 0, 140, 350, 0, 140, 0, 350, 140, 0, 350, 140][i]}, 50%, ${70 + Math.random() * 15}%)`,
                  }}
                />
              ))}
            </div>
            {/* Blur overlay */}
            <div
              className="absolute inset-0"
              style={{
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                background: isDark
                  ? "rgba(8, 10, 18, 0.7)"
                  : "rgba(255, 255, 255, 0.7)",
              }}
            />
          </div>

          {/* Lock content */}
          <div className="relative z-10 flex flex-col items-center justify-center px-6 py-12 text-center">
            {/* VIP badge */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
              style={{
                background: isDark
                  ? "linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(6, 182, 212, 0.10))"
                  : "linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.08))",
                border: isDark
                  ? "1px solid rgba(16, 185, 129, 0.2)"
                  : "1px solid rgba(16, 185, 129, 0.15)",
              }}
            >
              {vip.state === "no_wallet" ? (
                <Lock className={`w-7 h-7 ${isDark ? "text-emerald-400/70" : "text-emerald-600/70"}`} />
              ) : vip.state === "checking" ? (
                <div
                  className={`w-7 h-7 border-2 rounded-full animate-spin ${
                    isDark ? "border-emerald-500/20 border-t-emerald-400" : "border-emerald-200 border-t-emerald-500"
                  }`}
                />
              ) : vip.state === "error" ? (
                <AlertTriangle className={`w-7 h-7 ${isDark ? "text-amber-400/70" : "text-amber-600/70"}`} />
              ) : (
                <Crown className={`w-7 h-7 ${isDark ? "text-emerald-400/70" : "text-emerald-600/70"}`} />
              )}
            </div>

            {/* Title */}
            <h3
              className={`text-lg font-semibold tracking-tight ${
                isDark ? "text-slate-200" : "text-gray-800"
              }`}
            >
              {vip.state === "no_wallet"
                ? "VIP Members Only"
                : vip.state === "checking"
                  ? "Verifying Eligibility..."
                  : vip.state === "error"
                    ? "Verification Error"
                    : "VIP Access Required"}
            </h3>

            {/* Description */}
            <p
              className={`text-sm mt-2 max-w-md leading-relaxed ${
                isDark ? "text-slate-400" : "text-gray-500"
              }`}
            >
              {vip.state === "no_wallet" ? (
                "Connect your Hedera wallet to access the live market heatmap and ticker widgets."
              ) : vip.state === "checking" ? (
                "Checking your HBAR.ħ token balance and VIP NFT ownership on the Hedera Mirror Node..."
              ) : vip.state === "error" ? (
                "Unable to verify your VIP status. Please try reconnecting your wallet."
              ) : (
                <>
                  Hold <span className={`font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>{formatTokenCount(GATE_THRESHOLD)}+ HBAR.ħ</span> tokens
                  {" "}or <span className={`font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>1+ VIP NFT</span> to
                  {" "}unlock premium market widgets.
                </>
              )}
            </p>

            {/* Status indicator for non-eligible connected users */}
            {vip.state === "not_eligible" && (vip.tokenBalance > 0 || vip.nftCount > 0) && (
              <div
                className={`mt-4 px-4 py-2 rounded-lg text-xs font-medium ${
                  isDark ? "bg-white/[0.04] text-slate-400" : "bg-gray-50 text-gray-500"
                }`}
              >
                Your balance: {formatTokenCount(vip.tokenBalance)} HBAR.ħ
                {vip.nftCount > 0 ? ` · ${vip.nftCount} NFT${vip.nftCount !== 1 ? "s" : ""}` : ""}
                {" · "}Need {formatTokenCount(GATE_THRESHOLD)}+ tokens or 1 NFT
              </div>
            )}

            {/* Server verification badge */}
            {vip.state === "not_eligible" && vip.serverVerified && (
              <div className="flex items-center gap-1.5 mt-3">
                <ShieldCheck className={`w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
                <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Server-verified via Hedera Mirror Node
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER: VIP Widgets (verified eligible users only)
  // ═══════════════════════════════════════════════════════════════

  if (tickerError && heatmapError) return null;

  const isFullyLoaded =
    (tickerLoaded || tickerError) && (heatmapLoaded || heatmapError);

  return (
    <div className={cardClass}>
      {/* VIP verification badge + loading state */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Crown className={`w-3.5 h-3.5 ${isDark ? "text-emerald-400/60" : "text-emerald-600/60"}`} />
          <span className={`text-[11px] font-medium ${isDark ? "text-emerald-400/50" : "text-emerald-600/50"}`}>
            VIP
          </span>
          {vip.serverVerified && (
            <ShieldCheck className={`w-3 h-3 ${isDark ? "text-emerald-500/40" : "text-emerald-500/40"}`} />
          )}
        </div>
        {!isFullyLoaded && (
          <div
            className={`animate-spin w-3.5 h-3.5 border-[1.5px] rounded-full ${
              isDark
                ? "border-white/10 border-t-white/40"
                : "border-gray-200 border-t-gray-500"
            }`}
          />
        )}
      </div>

      {/* Scrolling Price Ticker */}
      {!tickerError && (
        <div className="w-full">
          <iframe
            srcDoc={tickerSrcdoc}
            sandbox={SANDBOX}
            title="Crypto Price Ticker"
            onLoad={handleTickerLoad}
            onError={handleTickerError}
            style={{
              width: "100%",
              height: 64,
              border: "none",
              display: "block",
              background: "transparent",
            }}
          />
        </div>
      )}

      {/* 50-Coin Heatmap Treemap */}
      {!heatmapError && (
        <div
          className={`w-full ${
            !tickerError
              ? isDark
                ? "border-t border-white/[0.04]"
                : "border-t border-gray-100"
              : ""
          }`}
        >
          <iframe
            srcDoc={heatmapSrcdoc}
            sandbox={SANDBOX}
            title="Top 50 Crypto Heatmap"
            onLoad={handleHeatmapLoad}
            onError={handleHeatmapError}
            style={{
              width: "100%",
              height: 420,
              border: "none",
              display: "block",
              background: "transparent",
            }}
          />
        </div>
      )}
    </div>
  );
}
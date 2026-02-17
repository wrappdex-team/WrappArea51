import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Crown, Lock, ShieldCheck, AlertTriangle } from "lucide-react";
import { log } from "../utils/logger";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { isVipEligible, verifyVipEligibilityDirect, getVipNftCount } from "../utils/vip";
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

// ── Stable heatmap grid lightness values (pre-computed, no Math.random per render) ──
const GRID_LIGHTNESS_DARK = [27, 31, 24, 29, 33, 26, 22, 30, 28, 25, 32, 23, 34, 27, 31, 29, 26, 33, 24, 28, 30, 22, 35, 27, 25, 31, 29, 23, 34, 28, 26, 32];
const GRID_LIGHTNESS_LIGHT = [78, 82, 73, 80, 85, 75, 71, 81, 77, 74, 83, 72, 84, 78, 82, 79, 75, 83, 73, 77, 80, 71, 85, 76, 74, 81, 79, 72, 84, 77, 75, 82];
const GRID_HUES = [140, 0, 350, 140, 0, 140, 350, 0, 140, 0, 350, 140, 0, 140, 0, 350, 140, 350, 0, 140, 350, 0, 140, 350, 0, 140, 0, 350, 140, 0, 350, 140];

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
    log.error("VIP-GATE", "Server verification failed", err?.message || err);
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

  // Extract stable primitive for the effect dependency.
  // hashPackSession?.accountId is a string | undefined — coerce to string | null.
  const accountId: string | null = hashPackSession?.accountId ?? null;

  // Refs for values that the async verification reads but should NOT
  // appear in any dependency array (they are objects/arrays whose
  // identity changes on every WalletProvider re-render).
  const tokensRef = useRef(hederaAccount?.tokens);
  const networkRef = useRef(hederaNetwork);
  tokensRef.current = hederaAccount?.tokens;
  networkRef.current = hederaNetwork;

  // ── Single effect: 3-layer VIP verification ────────────────────
  // Depends ONLY on `accountId` (a primitive string or null).
  // Reads tokens/network from refs → no unstable deps → no loop.
  useEffect(() => {
    // When no wallet is connected, do NOTHING.
    // The initial state is already "no_wallet" — calling setState here
    // (even with bail-out) can trigger re-render cascades in some
    // React environments (strict mode / Figma preview).
    if (!accountId) return;

    let cancelled = false;

    async function verify() {
      if (!cancelled) {
        setVip((prev) => (prev.state === "checking" ? prev : { ...prev, state: "checking" }));
      }

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

      if (cancelled) return;

      // Combine Layer 1 + Layer 2: Layer 2 overrides if it completed successfully.
      // verifyVipEligibilityDirect only checks fungible token balance (nftCount is
      // always 0), so we also check the cached NFT count from the WalletContext
      // token list to preserve NFT-based VIP eligibility.
      const cachedNftCount = getVipNftCount(currentTokens);
      const clientEligible = directResult.error
        ? cachedEligible
        : directResult.eligible || cachedNftCount >= 1;

      // Layer 3: Server-side verification (session-authenticated, authoritative)
      let serverResult = { eligible: false, tokenBalance: 0, nftCount: 0, error: null as string | null };
      const sessionToken = getSessionToken();
      if (sessionToken) {
        serverResult = await verifyVipOnServer();
      } else {
        // No session token → mark as "no_session" so the decision logic
        // correctly falls back to client-side checks instead of treating
        // the initial { eligible: false } as an authoritative server response.
        serverResult.error = "no_session";
      }

      if (cancelled) return;

      // Final decision: server is authoritative when available.
      // Fail-CLOSED: if server says no and client says yes, deny.
      let finalEligible: boolean;
      let serverVerified = false;

      if (serverResult.error === "no_session") {
        finalEligible = clientEligible;
      } else if (serverResult.error) {
        log.warn("VIP-GATE", "Server verification error, using client-side check", serverResult.error);
        finalEligible = clientEligible;
      } else {
        finalEligible = serverResult.eligible;
        serverVerified = true;
      }

      if (!cancelled) {
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
      }
    }

    verify();
    const timer = setInterval(verify, SERVER_VERIFY_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // accountId is the ONLY dependency — a primitive string or null.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // ── Iframe URLs (only built if VIP) ────────────────────────────
  // Served from the edge function with their own permissive CSP headers
  // so QuantifyCrypto coin logos load regardless of upstream CDN changes.
  // (srcdoc iframes inherit the parent's restrictive CSP — this doesn't.)

  const tickerUrl = useMemo(() => {
    if (vip.state !== "eligible") return "";
    const theme = isDark ? "dark" : "light";
    return `${API_BASE}/widget/ticker?theme=${theme}`;
  }, [isDark, vip.state]);

  const heatmapUrl = useMemo(() => {
    if (vip.state !== "eligible") return "";
    const theme = isDark ? "dark" : "light";
    return `${API_BASE}/widget/heatmap?theme=${theme}`;
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
            {/* Decorative shimmer grid pattern */}
            <div className="absolute inset-0 grid grid-cols-8 grid-rows-4 gap-0.5 p-4 opacity-20">
              {Array.from({ length: 32 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-sm"
                  style={{
                    background: isDark
                      ? `hsl(${GRID_HUES[i]}, 60%, ${GRID_LIGHTNESS_DARK[i]}%)`
                      : `hsl(${GRID_HUES[i]}, 50%, ${GRID_LIGHTNESS_LIGHT[i]}%)`,
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
        <div className="w-full overflow-hidden">
          <iframe
            src={tickerUrl}
            sandbox={SANDBOX}
            scrolling="no"
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
          className={`w-full overflow-hidden ${
            !tickerError
              ? isDark
                ? "border-t border-white/[0.04]"
                : "border-t border-gray-100"
              : ""
          }`}
        >
          <iframe
            src={heatmapUrl}
            sandbox={SANDBOX}
            scrolling="no"
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
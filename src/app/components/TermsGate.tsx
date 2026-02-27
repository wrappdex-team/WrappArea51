/**
 * TermsGate — Institutional-grade Beta Testing Terms & Conditions gate.
 *
 * IMPLEMENTATION NOTE: This gate blocks all app access (except the landing page)
 * until the user explicitly acknowledges the Beta Testing Agreement. It enforces:
 *   - Mandatory scroll-to-bottom before the acceptance toggle activates
 *   - Explicit "I have read and agree" toggle switch (not just a button click)
 *   - Versioned localStorage key — bumping TERMS_VERSION forces re-acceptance
 *   - Full audit trail via server-side acceptance logging (Step 4)
 *
 * Legal content is a condensed Beta Tester Agreement referencing the full
 * Terms of Service and Privacy Policy, with explicit risk acknowledgments,
 * liability waiver, no-warranty clause, and VIP tester obligations.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield,
  AlertTriangle,
  ScrollText,
  ChevronDown,
  ExternalLink,
  FlaskConical,
} from "lucide-react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { log } from "../utils/logger";

// IMPLEMENTATION NOTE: Bump this version to force all users to re-accept.
// Format: YYYY.MM.DD.revision
const TERMS_VERSION = "2026.02.25.1";
const STORAGE_KEY = `wrappdex_beta_tos_v_${TERMS_VERSION}`;

// ── Brand constants ───────────────────────────────────────────────────
const BLUE = "#1D63ED";
const DARK_BG = "#060810";
const GLASS_BG = "rgba(255,255,255,0.02)";
const GLASS_BORDER = "rgba(255,255,255,0.06)";

// ── Server audit trail endpoint (module-level, not per-render) ─────────
const SERVER_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

// ── Beta Agreement Sections ────────────────────────────────────────────
const BETA_SECTIONS = [
  {
    title: "1. Beta Program Acknowledgment",
    content: `You acknowledge that WRAPpDEX is currently in a CLOSED BETA testing phase. The Platform, including all smart contracts, automated market maker ("AMM") functions, liquidity pool operations, swap execution engines, bridge integrations, and governance modules, is provided in a pre-production state for evaluation, testing, and development purposes only. Beta access is limited to authorized VIP token holders who have been granted early access for the purpose of identifying defects, providing feedback, and stress-testing platform functionality under real-world conditions on the Hedera mainnet.`,
  },
  {
    title: "2. No Warranty; As-Is Condition",
    content: `THE PLATFORM IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE. WRAPpDEX EXPRESSLY DISCLAIMS ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. No representation or warranty is made regarding the accuracy, reliability, completeness, or timeliness of any data, price feeds, oracle responses, swap quotes, liquidity calculations, or transaction confirmations provided through the Platform.`,
  },
  {
    title: "3. Assumption of Risk",
    content: `You expressly acknowledge and assume all risks associated with using the Platform during the Beta period, including but not limited to: (a) smart contract vulnerabilities, bugs, or exploits that may result in partial or total loss of Digital Assets; (b) incorrect swap execution, slippage beyond expected parameters, or failed transaction settlement; (c) liquidity pool impermanent loss, including total loss of deposited assets; (d) oracle manipulation, stale price data, or price feed failures; (e) bridge failures, delayed cross-chain transfers, or permanent loss of bridged assets; (f) wallet integration failures, transaction signing errors, or session interruptions; (g) regulatory changes that may affect the legality of your participation; and (h) Hedera network congestion, node failures, or consensus disruptions.`,
  },
  {
    title: "4. Limitation of Liability",
    content: `TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL WRAPpDEX, ITS MEMBERS, ADMINISTRATORS, CONTRIBUTORS, DEVELOPERS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, LOSS OF DATA, LOSS OF DIGITAL ASSETS, BUSINESS INTERRUPTION, OR LOSS OF GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF OR INABILITY TO USE THE PLATFORM, REGARDLESS OF THE THEORY OF LIABILITY (CONTRACT, TORT, STRICT LIABILITY, OR OTHERWISE), EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. THE AGGREGATE LIABILITY OF WRAPpDEX FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THESE TERMS OR THE PLATFORM SHALL NOT EXCEED THE AMOUNT OF TRANSACTION FEES ACTUALLY PAID BY YOU TO THE PROTOCOL DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM.`,
  },
  {
    title: "5. Beta Tester Obligations",
    content: `As a Beta participant, you agree to: (a) report any bugs, vulnerabilities, security issues, or unexpected behavior discovered during testing through designated channels in a timely manner; (b) not exploit any discovered vulnerability for personal gain or to the detriment of other users or the Platform; (c) not publicly disclose specific security vulnerabilities prior to coordinated resolution; (d) understand that features, interfaces, and functionality may change, be deprecated, or be removed without prior notice; (e) maintain the confidentiality of any non-public technical information, internal documentation, or pre-release features shared during the Beta period; and (f) use the Platform in compliance with all applicable laws and regulations in your jurisdiction.`,
  },
  {
    title: "6. Digital Asset Risk Disclosure",
    content: `Digital Assets, including HBAR, HBAR.h, WRAPpDEX governance tokens, and all tokens traded or held through the Platform, are volatile, speculative, and carry significant risk of loss. Past performance is not indicative of future results. You should not participate in Digital Asset transactions with funds you cannot afford to lose entirely. The Platform does not provide investment advice, tax advice, legal advice, or any form of fiduciary guidance. You are solely responsible for evaluating the merits and risks of any transaction. Price data displayed on the Platform is sourced from third-party oracles and aggregators and may be inaccurate, delayed, or manipulated.`,
  },
  {
    title: "7. Indemnification",
    content: `You agree to indemnify, defend, and hold harmless WRAPpDEX, its DUNA members, administrators, developers, contributors, agents, and affiliates from and against any and all claims, damages, obligations, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from: (a) your use of the Platform; (b) your violation of these Terms; (c) your violation of any applicable law or regulation; (d) your violation of any third-party right, including intellectual property rights; or (e) any Digital Asset transaction you initiate, authorize, or execute through the Platform.`,
  },
  {
    title: "8. Governing Law & Dispute Resolution",
    content: `These Terms shall be governed by and construed in accordance with the laws of the State of Wyoming, without regard to its conflict of laws principles. Any dispute arising out of or relating to these Terms or the Platform shall be resolved exclusively through binding arbitration administered in the State of Wyoming, in accordance with the applicable rules of the American Arbitration Association. You expressly waive any right to participate in a class action lawsuit or class-wide arbitration. The WRAPpDEX DUNA is organized under the Wyoming Decentralized Unincorporated Nonprofit Association Act, W.S. \u00a7 17-32-101 et seq., and all organizational matters are governed thereby.`,
  },
  {
    title: "9. Modification & Termination",
    content: `WRAPpDEX reserves the right to modify, suspend, or discontinue the Platform or any feature thereof, temporarily or permanently, at any time and without prior notice. WRAPpDEX may revoke Beta access at its sole discretion. Upon termination of Beta access, you must immediately cease all use of the Platform. Provisions of these Terms that by their nature should survive termination shall survive, including but not limited to Sections 2, 3, 4, 6, 7, and 8.`,
  },
];

// ── Scroll progress indicator ──────────────────────────────────────────
function ScrollProgress({ progress }: { progress: number }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.04]">
      <motion.div
        className="h-full"
        style={{ background: BLUE }}
        initial={{ width: 0 }}
        animate={{ width: `${progress}%` }}
        transition={{ duration: 0.15 }}
      />
    </div>
  );
}

// ── Toggle switch ──────────────────────────────────────────────────────
function ToggleSwitch({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label="Accept beta testing agreement"
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500
        ${disabled ? "cursor-not-allowed opacity-30" : "cursor-pointer"}
        ${checked ? "border-transparent" : "border-white/10 bg-white/[0.06]"}
      `}
      style={checked ? { background: BLUE } : undefined}
    >
      <span
        className={`
          pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200
          ${checked ? "translate-x-5" : "translate-x-0"}
        `}
      />
    </button>
  );
}

// ── Fire-and-forget server-side acceptance log (module-level) ──────────
// IMPLEMENTATION NOTE: Defined outside the component to avoid recreating
// on every render. Non-blocking — if the server call fails, the user
// still enters the app (localStorage is the primary gate).
async function logAcceptanceToServer(version: string): Promise<void> {
  try {
    const res = await fetch(`${SERVER_BASE}/beta-terms/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${publicAnonKey}`,
      },
      body: JSON.stringify({
        version,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      log.info("BetaTerms", `Acceptance logged to server — total: ${data.totalAcceptances}`);
    } else {
      const err = await res.text().catch(() => "unknown");
      log.warn("BetaTerms", `Server log failed (${res.status}): ${err}`);
    }
  } catch (err) {
    log.warn("BetaTerms", "Server audit log unavailable", err);
  }
}

// ── Cleanup old storage keys (module-level) ────────────────────────────
// IMPLEMENTATION NOTE: When the terms version changes, stale localStorage
// keys from previous versions accumulate. This function scans for any
// wrappdex_beta_tos_v_* keys that don't match the current STORAGE_KEY
// and removes them. Uses exact match, not prefix, to avoid false positives
// (e.g., v_2026.02.25.1 incorrectly matching v_2026.02.25.10).
function cleanupOldStorageKeys() {
  try {
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Remove any old versioned beta TOS keys that aren't the current one
      if (key.startsWith("wrappdex_beta_tos_v_") && key !== STORAGE_KEY) {
        keysToRemove.push(key);
      }
      // Clean up the original v1 key from the pre-overhaul gate
      if (key === "wrappdex_tos_v1") {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((k) => localStorage.removeItem(k));

    if (keysToRemove.length > 0) {
      log.debug("BetaTerms", `Cleaned up ${keysToRemove.length} stale storage key(s)`);
    }
  } catch {
    // localStorage access can throw in private/restricted contexts
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════

export function TermsGate({ children }: { children: React.ReactNode }) {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [toggleChecked, setToggleChecked] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [entering, setEntering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Mount: check localStorage, then validate against server version ──
  useEffect(() => {
    cleanupOldStorageKeys();

    let localAccepted = false;
    try {
      localAccepted = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // localStorage unavailable (e.g., some private browsing modes)
      setAccepted(false);
      return;
    }

    if (!localAccepted) {
      setAccepted(false);
      return;
    }

    // Verify the server hasn't bumped the required version.
    // 4s timeout — fail open if server is unreachable.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    fetch(`${SERVER_BASE}/beta-terms/required-version`, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        clearTimeout(timeout);
        if (data?.requiredVersion && data.requiredVersion !== TERMS_VERSION) {
          log.info("BetaTerms", `Server requires v${data.requiredVersion}, client has v${TERMS_VERSION} — forcing re-acceptance`);
          try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem("wrappdex_beta_tos_meta");
          } catch { /* ignore */ }
          cleanupOldStorageKeys();
          setAccepted(false);
        } else {
          setAccepted(true);
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        log.warn("BetaTerms", "Version check unavailable — trusting localStorage");
        setAccepted(true);
      });

    // Cleanup: abort fetch if component unmounts during version check
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  // ── Cross-tab sync: detect acceptance in another tab ───────────────
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        if (e.newValue === "1") {
          setAccepted(true);
        } else if (e.newValue === null) {
          // Key was removed (version bump in another tab)
          setAccepted(false);
          setToggleChecked(false);
          setHasScrolledToBottom(false);
          setScrollProgress(0);
        }
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // IMPLEMENTATION NOTE: Landing page bypass is no longer needed here —
  // TermsGate now lives inside the router tree and only wraps DEX routes.
  // The landing page route is outside this component's subtree entirely.

  // Scroll handler — tracks progress and detects bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 0) {
      // Content fits without scrolling
      setHasScrolledToBottom(true);
      setScrollProgress(100);
      return;
    }

    const pct = Math.min((scrollTop / maxScroll) * 100, 100);
    setScrollProgress(pct);

    // 20px tolerance — user doesn't need to hit the exact pixel
    if (scrollTop >= maxScroll - 20) {
      setHasScrolledToBottom(true);
    }
  }, []);

  // Check on mount if content fits without scrolling
  useEffect(() => {
    if (accepted) return;
    const el = scrollRef.current;
    if (!el) return;
    // Small delay to let content render
    const timer = setTimeout(() => {
      if (el.scrollHeight <= el.clientHeight + 20) {
        setHasScrolledToBottom(true);
        setScrollProgress(100);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [accepted]);

  // Accept handler ��� with double-click protection via `entering` guard
  const handleAccept = useCallback(() => {
    if (!toggleChecked || entering) return;
    setEntering(true);

    // Record acceptance locally
    try {
      localStorage.setItem(STORAGE_KEY, "1");
      localStorage.setItem(
        `wrappdex_beta_tos_meta`,
        JSON.stringify({
          version: TERMS_VERSION,
          acceptedAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
        })
      );
    } catch {
      // localStorage write failed — still allow entry for this session
    }

    // Fire-and-forget server-side audit trail
    logAcceptanceToServer(TERMS_VERSION);

    // Animated transition out
    setTimeout(() => setAccepted(true), 600);
  }, [toggleChecked, entering]);

  // Loading state
  if (accepted === null) return null;

  // Accepted — render children
  if (accepted) return <>{children}</>;

  // ── Gate UI ────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {!entering ? (
        <motion.div
          key="terms-gate"
          className="fixed inset-0 z-[99999] flex flex-col items-center justify-center"
          style={{ background: DARK_BG }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Subtle background gradient */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at 50% 0%, ${BLUE}08 0%, transparent 60%)`,
            }}
          />

          {/* Content container */}
          <div className="relative z-10 w-full max-w-2xl mx-auto px-4 sm:px-6 flex flex-col items-center max-h-[100dvh] py-4 sm:py-8">
            {/* ── Header — compact on mobile, expanded on desktop ── */}
            <motion.div
              className="flex flex-col items-center mb-4 sm:mb-8 shrink-0"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6 }}
            >
              {/* Logo */}
              <h1 className="text-[20px] sm:text-[26px] font-extrabold tracking-tight text-white mb-2 sm:mb-3 select-none">
                WRAP<span style={{ color: BLUE }}>p</span>
                <span className="text-slate-500">DEX</span>
              </h1>

              {/* Beta badge */}
              <div
                className="flex items-center gap-2 px-3 py-1 sm:px-3.5 sm:py-1.5 rounded-full mb-3 sm:mb-4"
                style={{
                  background: "rgba(245, 158, 11, 0.08)",
                  border: "1px solid rgba(245, 158, 11, 0.20)",
                }}
              >
                <FlaskConical className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400" />
                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-amber-400">
                  Closed Beta
                </span>
              </div>

              {/* Shield icon — hidden on very small screens to save vertical space */}
              <div
                className="hidden sm:flex w-12 h-12 rounded-full items-center justify-center mb-4"
                aria-hidden="true"
                style={{
                  background: `${BLUE}12`,
                  border: `1px solid ${BLUE}30`,
                }}
              >
                <Shield className="w-5 h-5" style={{ color: BLUE }} />
              </div>

              <h2 className="text-sm sm:text-lg font-bold text-white text-center">
                Beta Testing Agreement
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-500 mt-1 sm:mt-1.5 text-center">
                Version {TERMS_VERSION} &middot; Please read carefully before
                proceeding
              </p>
            </motion.div>

            {/* ── Scrollable Terms Panel ── */}
            <motion.div
              className="w-full rounded-xl overflow-hidden relative flex-1 min-h-0 mb-5 sm:mb-6"
              style={{
                background: GLASS_BG,
                border: `1px solid ${GLASS_BORDER}`,
                boxShadow: "0 24px 48px -12px rgba(0,0,0,0.4)",
              }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
            >
              {/* Warning banner */}
              <div
                className="px-4 py-3 flex items-center gap-2.5 shrink-0"
                style={{
                  background: "rgba(245, 158, 11, 0.06)",
                  borderBottom: "1px solid rgba(245, 158, 11, 0.12)",
                }}
              >
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-[10px] sm:text-[11px] text-amber-300/90 font-medium leading-relaxed">
                  This software is in active development. Interacting with
                  unaudited smart contracts on Hedera mainnet carries inherent
                  risk of financial loss.
                </p>
              </div>

              {/* Scrollable content */}
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                role="region"
                aria-label="Beta Testing Agreement terms content"
                tabIndex={0}
                className="overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 sm:py-5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 focus-visible:ring-inset"
                style={{ maxHeight: "calc(100dvh - 360px)", minHeight: "180px" }}
              >
                {BETA_SECTIONS.map((section, i) => (
                  <div key={section.title} className={i > 0 ? "mt-5" : ""}>
                    <h3 className="text-[11px] sm:text-xs font-bold text-white/90 mb-2 flex items-center gap-2">
                      <ScrollText className="w-3 h-3 text-slate-500 shrink-0" />
                      {section.title}
                    </h3>
                    <p className="text-[10px] sm:text-[11px] text-slate-400 leading-[1.7]">
                      {section.content}
                    </p>
                  </div>
                ))}

                {/* End marker */}
                <div className="mt-6 pt-4" style={{ borderTop: `1px solid ${GLASS_BORDER}` }}>
                  <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                    By accepting, you also agree to the full{" "}
                    <a
                      href="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-300 underline underline-offset-2 hover:text-white transition-colors inline-flex items-center gap-0.5"
                    >
                      Terms of Service
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>{" "}
                    and{" "}
                    <a
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-300 underline underline-offset-2 hover:text-white transition-colors inline-flex items-center gap-0.5"
                    >
                      Privacy Policy
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    .
                  </p>
                </div>
              </div>

              {/* Scroll indicator (when not yet scrolled to bottom) */}
              {!hasScrolledToBottom && (
                <motion.div
                  className="absolute bottom-[2px] left-0 right-0 flex items-center justify-center py-3 pointer-events-none"
                  aria-hidden="true"
                  style={{
                    background:
                      "linear-gradient(transparent, rgba(6,8,16,0.95) 60%)",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1 }}
                >
                  <motion.div
                    className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium"
                    animate={{ y: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  >
                    <ChevronDown className="w-3 h-3" />
                    Scroll to continue
                  </motion.div>
                </motion.div>
              )}

              {/* Scroll progress bar */}
              <ScrollProgress progress={scrollProgress} />

              {/* Screen reader announcement when scroll-to-bottom is reached */}
              {hasScrolledToBottom && (
                <div className="sr-only" role="status" aria-live="polite">
                  You have read the complete agreement. The acceptance toggle is now enabled.
                </div>
              )}
            </motion.div>

            {/* ── Acceptance Controls ── */}
            <motion.div
              className="w-full shrink-0 space-y-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              {/* Toggle row */}
              <div
                className="flex items-center gap-3 sm:gap-4 rounded-xl px-3 sm:px-4 py-3 sm:py-3.5"
                style={{
                  background: hasScrolledToBottom
                    ? "rgba(255,255,255,0.03)"
                    : "rgba(255,255,255,0.01)",
                  border: `1px solid ${
                    hasScrolledToBottom
                      ? toggleChecked
                        ? `${BLUE}40`
                        : "rgba(255,255,255,0.08)"
                      : "rgba(255,255,255,0.03)"
                  }`,
                  transition: "all 0.3s ease",
                }}
              >
                <ToggleSwitch
                  checked={toggleChecked}
                  onChange={setToggleChecked}
                  disabled={!hasScrolledToBottom}
                  id="accept-beta-testing-agreement"
                />
                <label
                  htmlFor="accept-beta-testing-agreement"
                  className={`text-[10px] sm:text-xs leading-relaxed select-none ${
                    hasScrolledToBottom
                      ? "text-slate-300 cursor-pointer"
                      : "text-slate-600 cursor-not-allowed"
                  }`}
                >
                  I have read, understood, and agree to the Beta Testing
                  Agreement, Terms of Service, and Privacy Policy. I acknowledge
                  the risks of using unaudited software on mainnet.
                </label>
              </div>

              {/* Not-scrolled hint */}
              {!hasScrolledToBottom && (
                <p className="text-[10px] text-slate-600 text-center">
                  Please read the complete agreement above to enable acceptance.
                </p>
              )}

              {/* Accept button */}
              <button
                onClick={handleAccept}
                disabled={!toggleChecked}
                className={`
                  w-full rounded-xl py-3.5 text-[13px] font-semibold tracking-wide text-white transition-all duration-200
                  ${
                    toggleChecked
                      ? "cursor-pointer hover:brightness-110 active:scale-[0.99]"
                      : "cursor-not-allowed opacity-30"
                  }
                `}
                style={{
                  background: toggleChecked
                    ? `linear-gradient(135deg, ${BLUE}, #1552c7)`
                    : "rgba(255,255,255,0.05)",
                  boxShadow: toggleChecked
                    ? `0 8px 24px -4px ${BLUE}40`
                    : "none",
                }}
              >
                Accept &amp; Enter Beta
              </button>

              {/* Jurisdiction footer */}
              <p className="text-[9px] text-slate-600 text-center leading-relaxed pb-2">
                WRAPpDEX DUNA &middot; Wyoming Decentralized Unincorporated
                Nonprofit Association &middot; W.S. &sect; 17-32-101{" "}
                <em>et seq.</em>
              </p>
            </motion.div>
          </div>
        </motion.div>
      ) : (
        // ── Transition overlay (acceptance animation) ──
        <motion.div
          key="terms-gate-exit"
          className="fixed inset-0 z-[99999] flex items-center justify-center"
          style={{ background: DARK_BG }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <motion.div
            className="flex flex-col items-center gap-3"
            initial={{ scale: 1 }}
            animate={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Shield className="w-8 h-8" style={{ color: BLUE }} />
            <p className="text-sm text-slate-400 font-medium">
              Access granted
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
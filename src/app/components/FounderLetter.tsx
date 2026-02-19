import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Feather, Shield, KeyRound } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

/* ═══════════════════════════════════════════════════════════════════════
   FOUNDER LETTER — "A Letter to the Sovereign"
   ═══════════════════════════════════════════════════════════════════════ */

interface FounderLetterProps {
  open: boolean;
  onClose: () => void;
}

export function FounderLetter({ open, onClose }: FounderLetterProps) {
  const { isDark } = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      scrollRef.current?.scrollTo(0, 0);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Letter container */}
          <motion.div
            className={`relative w-full max-w-2xl max-h-[90vh] rounded-2xl border overflow-hidden ${
              isDark
                ? "bg-[#0b0e1a]/95 border-white/[0.08]"
                : "bg-white/95 border-gray-200"
            }`}
            style={{
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              boxShadow: isDark
                ? "0 0 80px rgba(29, 99, 237, 0.08), 0 32px 64px rgba(0,0,0,0.5)"
                : "0 32px 64px rgba(0,0,0,0.15)",
            }}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className={`absolute top-4 right-4 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                isDark
                  ? "bg-white/[0.06] hover:bg-white/[0.12] text-slate-400 hover:text-white"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800"
              }`}
              aria-label="Close letter"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Scrollable content */}
            <div ref={scrollRef} className="overflow-y-auto max-h-[90vh] overscroll-contain">
              {/* Header */}
              <div
                className="relative px-6 sm:px-10 pt-10 pb-6"
                style={{
                  background: isDark
                    ? "linear-gradient(180deg, rgba(29,99,237,0.06) 0%, transparent 100%)"
                    : "linear-gradient(180deg, rgba(29,99,237,0.04) 0%, transparent 100%)",
                }}
              >
                {/* Seal */}
                <div className="flex justify-center mb-6">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{
                      background: isDark
                        ? "linear-gradient(135deg, rgba(29,99,237,0.15), rgba(56,189,248,0.10))"
                        : "linear-gradient(135deg, rgba(29,99,237,0.10), rgba(56,189,248,0.06))",
                      border: isDark
                        ? "1px solid rgba(29,99,237,0.20)"
                        : "1px solid rgba(29,99,237,0.15)",
                    }}
                  >
                    <Feather className={`w-7 h-7 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
                  </div>
                </div>

                <h2
                  className={`text-center text-xl sm:text-2xl font-bold tracking-tight leading-tight ${
                    isDark ? "text-white" : "text-slate-900"
                  }`}
                >
                  A Letter to the Sovereign
                </h2>
                <p
                  className={`text-center text-sm mt-2 ${
                    isDark ? "text-slate-500" : "text-gray-400"
                  }`}
                >
                  From the Founder &mdash; To every WRAPpDEX community member, DAO participant, and self-sovereign individual worldwide
                </p>
              </div>

              {/* Divider */}
              <div className="px-6 sm:px-10">
                <div
                  className={`w-full h-px ${
                    isDark ? "bg-white/[0.06]" : "bg-gray-200"
                  }`}
                />
              </div>

              {/* Letter body */}
              <div className="px-6 sm:px-10 py-8 space-y-5">
                {/* Opening — the call */}
                <p className={`text-sm sm:text-[15px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  To the traders, the builders, and the quietly defiant,
                </p>

                <p className={`text-sm sm:text-[15px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Fifteen years ago, a pseudonymous engineer published nine pages that
                  rewrote the rules of money. No permission was asked. No boardroom approved it.
                  No government signed off. A white paper and a genesis block were enough to
                  prove that trust could be earned through mathematics instead of institutions.
                  That idea lit a fire that no regulation, no market crash, and no incumbent has been
                  able to extinguish.
                </p>

                <p className={`text-sm sm:text-[15px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  WRAPpDEX was born from the same conviction: <strong className={isDark ? "text-white" : "text-slate-900"}>your keys, your coins,
                  your future.</strong> Not as a slogan on a landing page &mdash; as an architectural
                  guarantee. Every swap, every vote, every liquidity position on this platform
                  settles to <em>your</em> wallet. There is no omnibus account holding your funds.
                  There is no withdrawal queue gated by someone else's solvency. The moment a
                  trade confirms, it is yours &mdash; irrevocably, cryptographically, and in roughly
                  two seconds on the Hedera network.
                </p>

                {/* The political thesis */}
                <div
                  className={`rounded-xl p-5 my-6 ${
                    isDark
                      ? "bg-white/[0.02] border border-white/[0.06]"
                      : "bg-gray-50 border border-gray-100"
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <Shield className={`w-4 h-4 flex-shrink-0 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
                    <span className={`text-xs font-semibold uppercase tracking-wider ${isDark ? "text-blue-400/80" : "text-blue-600/80"}`}>
                      The Sovereignty Thesis
                    </span>
                  </div>
                  <p className={`text-sm sm:text-[15px] leading-relaxed italic ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Self-custody is not a feature. It is a political act. Every time you hold your
                    own keys you vote against a financial system that privatizes gains and
                    socializes losses. You reject the premise that ordinary people need
                    intermediaries to be trusted with their own wealth. You declare, in the
                    quietest and most powerful way possible, that sovereignty begins with
                    the individual.
                  </p>
                </div>

                <p className={`text-sm sm:text-[15px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  We chose Hedera because conviction demands infrastructure that matches it.
                  Not the loudest chain &mdash; the most capable one. Hashgraph consensus
                  delivers deterministic finality in roughly two seconds with mathematically proven
                  asynchronous Byzantine fault tolerance. No forks. No reorgs. No mempool
                  frontrunning. Fixed, predictable fees paid in fractions of a cent. A network
                  governed by the world's largest organizations yet permissionless at the
                  application layer. This is not a test network for idealists &mdash; it is production
                  infrastructure for sovereign finance.
                </p>

                <p className={`text-sm sm:text-[15px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  The Smart Liquidity Engine at the heart of WRAPpDEX exists because we are
                  traders ourselves, and we were tired of being the product. Hedera-native
                  atomic CryptoTransfer settlement means every swap is a single transaction
                  with both token legs &mdash; no public mempool for bots to exploit. No
                  sandwich attacks. No MEV extraction. The 0.25% swap fee is transparent and
                  protocol-fixed &mdash; the full 0.25% stays in pool reserves for
                  LPs, with the protocol&rsquo;s 0.05% share tracked and extractable by
                  DAO governance. Nobody can manipulate it. We built the exchange
                  we wanted to trade on, then open-sourced the thesis so you could verify
                  every claim.
                </p>

                {/* The institutional quality paragraph */}
                <div
                  className={`rounded-xl p-5 my-6 ${
                    isDark
                      ? "bg-white/[0.02] border border-white/[0.06]"
                      : "bg-gray-50 border border-gray-100"
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <KeyRound className={`w-4 h-4 flex-shrink-0 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
                    <span className={`text-xs font-semibold uppercase tracking-wider ${isDark ? "text-emerald-400/80" : "text-emerald-600/80"}`}>
                      Institutional Quality, Individual Sovereignty
                    </span>
                  </div>
                  <p className={`text-sm sm:text-[15px] leading-relaxed italic ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    The industry drew a false line: retail-grade tools with self-custody on one
                    side, institutional-grade execution behind custodial walls on the other.
                    WRAPpDEX erases that line. Sovereign-quality infrastructure &mdash; real-time
                    oracle pricing, MEV-resistant execution, on-chain governance, and Hedera's
                    enterprise-grade finality &mdash; all delivered directly to a wallet you control.
                    No compromises. No fine print. No custodians.
                  </p>
                </div>

                <p className={`text-sm sm:text-[15px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  WRAPpDEX is structured as a Wyoming DUNA &mdash; a Decentralized Unincorporated
                  Nonprofit Association &mdash; because legal sovereignty matters as much as
                  cryptographic sovereignty. The DAO is not a marketing wrapper around a
                  multisig controlled by insiders. It is the legal entity. Token holders govern
                  protocol parameters, treasury allocation, and the future direction of the
                  platform. One token, one voice. Proposals are public. Votes are on-chain.
                  Transparency is not a promise &mdash; it is a constraint enforced by the ledger
                  itself.
                </p>

                <p className={`text-sm sm:text-[15px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  To every community member reading this from Lagos to London,
                  from Jakarta to Johannesburg, from Wyoming to the world &mdash; this platform
                  is yours. Not metaphorically. Structurally. The code is auditable.
                  The governance is participatory. The treasury is transparent. We did not build
                  WRAPpDEX to extract value from you. We built it to return the value that
                  centralized finance has been quietly siphoning from people like us for
                  generations.
                </p>

                {/* Closing */}
                <p className={`text-sm sm:text-[15px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  The revolution is not loud. It is a wallet that only you can open. It is a
                  swap that settles before you finish reading this sentence. It is a vote that
                  no board of directors can override. It is the quiet, compounding power of
                  individuals choosing sovereignty &mdash; one block at a time.
                </p>

                <p className={`text-sm sm:text-[15px] leading-relaxed font-medium ${isDark ? "text-white" : "text-slate-900"}`}>
                  Hold your keys. Govern your protocol. Trade on your terms.
                </p>

                <p className={`text-sm sm:text-[15px] leading-relaxed ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  The future of finance is not permission-based. It is self-sovereign.
                  And it is already running &mdash; on the best network on Earth.
                </p>

                {/* Signature */}
                <div className="pt-6 mt-6 border-t border-dashed" style={{ borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)" }}>
                  <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                    Kyle
                  </p>
                  <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Founder, WRAPpDEX
                  </p>
                  <p className={`text-xs mt-0.5 ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                    Built by traders, for traders.
                  </p>
                </div>
              </div>

              {/* Bottom pad for mobile */}
              <div className="h-4" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

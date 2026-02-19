import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Briefcase,
  Shield,
  Compass,
  Anchor,
  Flame,
  Gem,
  TreePine,
  Mountain,
  Crown,
  KeyRound,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

/* =======================================================================
   EXECUTIVE BRIEFCASE — "The Steward's Codex"
   
   Admin-only strategic guidance for the inner circle of WRAPpDEX.
   This component is gated by isAdmin in the WhitePaper parent —
   it never renders for non-admin users.
   ======================================================================= */

interface ExecutiveBriefcaseProps {
  open: boolean;
  onClose: () => void;
}

/* ── Section Divider ──────────────────────────────────────────────── */

function Divider({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex items-center gap-4 my-8">
      <div className={`flex-1 h-px ${isDark ? "bg-amber-500/10" : "bg-amber-200/60"}`} />
      <Gem className={`w-3 h-3 ${isDark ? "text-amber-500/30" : "text-amber-400/50"}`} />
      <div className={`flex-1 h-px ${isDark ? "bg-amber-500/10" : "bg-amber-200/60"}`} />
    </div>
  );
}

/* ── Chapter Heading ──────────────────────────────────────────────── */

function Chapter({
  icon: Icon,
  number,
  title,
  isDark,
}: {
  icon: React.ElementType;
  number: string;
  title: string;
  isDark: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background: isDark
            ? "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(217,119,6,0.08))"
            : "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(217,119,6,0.04))",
          border: isDark
            ? "1px solid rgba(245,158,11,0.18)"
            : "1px solid rgba(245,158,11,0.20)",
        }}
      >
        <Icon className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
      </div>
      <div>
        <p
          className={`text-[10px] font-bold uppercase tracking-[0.2em] ${
            isDark ? "text-amber-500/50" : "text-amber-400/70"
          }`}
        >
          Chapter {number}
        </p>
        <h3
          className={`text-base sm:text-lg font-bold tracking-tight ${
            isDark ? "text-amber-100" : "text-amber-900"
          }`}
        >
          {title}
        </h3>
      </div>
    </div>
  );
}

export function ExecutiveBriefcase({ open, onClose }: ExecutiveBriefcaseProps) {
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

  const p = `text-sm sm:text-[15px] leading-[1.85] ${
    isDark ? "text-slate-300/90" : "text-gray-700"
  }`;

  const em = `font-semibold ${isDark ? "text-amber-300" : "text-amber-700"}`;
  const hl = `font-semibold ${isDark ? "text-white" : "text-slate-900"}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Backdrop — deep, prestigious */}
          <motion.div
            className="absolute inset-0"
            style={{
              background: isDark
                ? "radial-gradient(ellipse at center, rgba(15,10,5,0.92) 0%, rgba(0,0,0,0.96) 100%)"
                : "radial-gradient(ellipse at center, rgba(255,251,235,0.95) 0%, rgba(245,240,225,0.98) 100%)",
              backdropFilter: "blur(12px)",
            }}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Letter container */}
          <motion.div
            className={`relative w-full max-w-2xl max-h-[92vh] rounded-2xl border overflow-hidden ${
              isDark
                ? "bg-[#0d0a06]/95 border-amber-500/[0.12]"
                : "bg-[#fffdf7]/95 border-amber-300/40"
            }`}
            style={{
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              boxShadow: isDark
                ? "0 0 120px rgba(245,158,11,0.04), 0 0 60px rgba(217,119,6,0.03), 0 32px 64px rgba(0,0,0,0.6)"
                : "0 0 60px rgba(245,158,11,0.08), 0 32px 64px rgba(0,0,0,0.08)",
            }}
            initial={{ opacity: 0, y: 50, scale: 0.93 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.93 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className={`absolute top-4 right-4 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                isDark
                  ? "bg-amber-500/[0.06] hover:bg-amber-500/[0.12] text-amber-400/60 hover:text-amber-300"
                  : "bg-amber-100/60 hover:bg-amber-200/80 text-amber-600/60 hover:text-amber-800"
              }`}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Scrollable content */}
            <div ref={scrollRef} className="overflow-y-auto max-h-[92vh] overscroll-contain">
              {/* ── Header ── */}
              <div
                className="relative px-6 sm:px-10 pt-10 pb-6"
                style={{
                  background: isDark
                    ? "linear-gradient(180deg, rgba(245,158,11,0.04) 0%, transparent 100%)"
                    : "linear-gradient(180deg, rgba(245,158,11,0.04) 0%, transparent 100%)",
                }}
              >
                {/* Seal */}
                <div className="flex justify-center mb-6">
                  <motion.div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{
                      background: isDark
                        ? "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(217,119,6,0.06))"
                        : "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(217,119,6,0.06))",
                      border: isDark
                        ? "1px solid rgba(245,158,11,0.20)"
                        : "1px solid rgba(217,119,6,0.25)",
                    }}
                    animate={{
                      boxShadow: [
                        "0 0 20px rgba(245,158,11,0.06)",
                        "0 0 40px rgba(245,158,11,0.10)",
                        "0 0 20px rgba(245,158,11,0.06)",
                      ],
                    }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <Briefcase
                      className={`w-7 h-7 ${isDark ? "text-amber-400" : "text-amber-600"}`}
                    />
                  </motion.div>
                </div>

                <h2
                  className={`text-center text-xl sm:text-2xl font-bold tracking-tight ${
                    isDark ? "text-amber-100" : "text-amber-900"
                  }`}
                >
                  The Steward's Codex
                </h2>
                <p
                  className={`text-center text-xs mt-2 tracking-wide ${
                    isDark ? "text-amber-500/40" : "text-amber-600/50"
                  }`}
                >
                  For the Eyes of Protocol Stewards Only
                </p>
                <p
                  className={`text-center text-[11px] mt-1 font-mono ${
                    isDark ? "text-amber-500/20" : "text-amber-400/40"
                  }`}
                >
                  Admin-Gated &middot; Not for Public Distribution
                </p>
              </div>

              {/* Divider */}
              <div className="px-6 sm:px-10">
                <div
                  className={`w-full h-px ${
                    isDark ? "bg-amber-500/10" : "bg-amber-300/30"
                  }`}
                />
              </div>

              {/* ── Letter Body ── */}
              <div className="px-6 sm:px-10 py-8 space-y-0">
                {/* Salutation */}
                <p className={`${p} italic mb-6`}>
                  To those who hold the keys,
                </p>

                <p className={p}>
                  If you are reading this, you are not merely an administrator of
                  software. You are a <span className={em}>steward of trust</span>.
                  Every line of code beneath your hands is a promise &mdash;
                  a promise that ordinary people can trade, save, and build
                  wealth without asking anyone's permission. That is not a small
                  thing. That is the kind of promise civilizations are built upon.
                </p>

                <p className={`${p} mt-4`}>
                  This codex exists because the distance between a protocol that
                  endures for a generation and one that collapses in a quarter
                  is not the technology. It is the{" "}
                  <span className={em}>quality of the people who tend it</span>.
                  What follows is everything I wish someone had told me on day one.
                </p>

                <Divider isDark={isDark} />

                {/* ═══ CHAPTER 1: THE GARDEN ═══ */}
                <Chapter icon={TreePine} number="I" title="The Garden &mdash; Maintaining the Protocol" isDark={isDark} />

                <p className={p}>
                  Think of this codebase not as a machine, but as a{" "}
                  <span className={em}>living garden</span>. A machine runs
                  until it breaks. A garden runs forever &mdash; if you prune
                  it, water it, and never let the weeds grow taller than the
                  flowers.
                </p>

                <p className={`${p} mt-3`}>
                  <span className={hl}>The Rule of Roots:</span> Every system
                  has roots (auth, KV store, wallet-core, AMM engine) and
                  leaves (UI components, animations, badges). When you must
                  choose between refactoring a root and adding a leaf,{" "}
                  <span className={em}>always choose the root</span>. A protocol
                  with strong roots can grow infinite leaves. A protocol with
                  weak roots and beautiful leaves is a tree waiting for the
                  first storm.
                </p>

                <p className={`${p} mt-3`}>
                  <span className={hl}>Practical guidance:</span>
                </p>
                <ul className={`${p} list-disc list-inside space-y-2 mt-2 pl-1`}>
                  <li>
                    <span className={hl}>Never deploy on Fridays.</span> This is
                    not superstition. It is respect for the humans who would have
                    to debug a production issue across a weekend. Your community
                    trusts their funds to this protocol 24/7 &mdash; deploy when
                    your team is at full strength.
                  </li>
                  <li>
                    <span className={hl}>The audit trail is sacred.</span> The
                    500-entry append-only admin audit trail is not bureaucracy.
                    It is your <span className={em}>institutional memory</span>.
                    When a regulator, an investor, or a future team member asks
                    "who changed this and why," the audit trail is the
                    difference between a confident answer and a terrified silence.
                  </li>
                  <li>
                    <span className={hl}>Circuit breakers are your night watch.</span>{" "}
                    Every external dependency (SaucerSwap, Chainlink, Mirror Node,
                    1inch, CoinGecko) will go down at some point. Your circuit
                    breakers are not error handlers &mdash; they are{" "}
                    <span className={em}>sentinels standing guard while you sleep</span>.
                    Test them. Deliberately trip them in staging. Know exactly what
                    your users see when Tier 1 oracles go dark.
                  </li>
                  <li>
                    <span className={hl}>The KV store is your heartbeat.</span>{" "}
                    Pool state, sessions, admin lists, proposals, votes &mdash;
                    everything lives in the KV layer. Treat it like a database
                    that never got a DBA: monitor key count growth, watch for
                    orphaned entries, and periodically audit that every pool key
                    has a matching metadata key. The{" "}
                    <span className={em}>CAS versioning and k-invariant checks
                    </span> are your last line of defense, but they should never
                    have to fire in normal operation.
                  </li>
                  <li>
                    <span className={hl}>Wallet-core is the most delicate code
                    in the entire system.</span> The WalletConnect lifecycle
                    (SignClient singleton, relay handshake, session validation,
                    deep-link interception) is fragile by nature &mdash; you are
                    coordinating between a browser, a WebSocket relay, and a
                    mobile wallet that you do not control. Every change here
                    should be{" "}
                    <span className={em}>surgical, tested on both desktop and
                    mobile, and paired with rollback confidence</span>. When in
                    doubt, add a log line and ship a diagnostic build before
                    touching the happy path.
                  </li>
                </ul>

                <Divider isDark={isDark} />

                {/* ═══ CHAPTER 2: THE FIRE ═══ */}
                <Chapter icon={Flame} number="II" title="The Fire &mdash; Growing a Community" isDark={isDark} />

                <p className={p}>
                  A community is not an audience. An audience watches. A
                  community <span className={em}>builds</span>. The difference
                  is ownership.
                </p>

                <p className={`${p} mt-3`}>
                  The most powerful force in Web3 is not tokenomics, not
                  marketing budgets, not influencer partnerships. It is the
                  moment when someone who was a <span className={em}>user</span>{" "}
                  becomes a <span className={em}>defender</span>. When they
                  answer a question in Discord not because they're paid to, but
                  because they feel the protocol is <span className={em}>theirs</span>.
                </p>

                <p className={`${p} mt-3`}>
                  <span className={hl}>How you cultivate that:</span>
                </p>
                <ul className={`${p} list-disc list-inside space-y-2 mt-2 pl-1`}>
                  <li>
                    <span className={hl}>Radical transparency.</span> Publish
                    your treasury balance monthly. Show swap volume, LP returns,
                    and protocol revenue openly on the dashboard. The DUNA
                    structure gives you legal protection &mdash; use it to be
                    more transparent than your competitors, not less. When the
                    market drops, the protocols that survive are the ones whose
                    communities <span className={em}>already know the numbers</span>.
                  </li>
                  <li>
                    <span className={hl}>DAO proposals are your town square.</span>{" "}
                    Every proposal &mdash; even ones that fail &mdash; is a
                    signal that someone cares enough to participate. Celebrate
                    voter turnout as much as passed proposals. A "rejected"
                    proposal with 40 votes is healthier than a "passed" proposal
                    with 3. The <span className={em}>8 proposal categories</span>{" "}
                    (Fees, Staking, Listing, Tokenomics, Features, Partnership,
                    Governance, Other) are not decoration &mdash; they tell your
                    community "we are listening across every dimension of this
                    protocol."
                  </li>
                  <li>
                    <span className={hl}>The VIP system is a loyalty architecture,
                    not a paywall.</span> 100M HBAR.ħ tokens or a VIP NFT is a
                    commitment signal. The emerald theme, the chat room, the
                    spin wheel, the premium sound FX &mdash; these are not
                    features. They are <span className={em}>rituals of belonging</span>.
                    People do not leave tribes. Make your VIP tier feel like
                    joining an order, not buying a subscription.
                  </li>
                  <li>
                    <span className={hl}>Educate before you market.</span> A
                    single well-written thread explaining how the constant-product
                    AMM protects against MEV will earn you more lasting users
                    than a hundred paid tweets. The Hedera ecosystem is still
                    young enough that <span className={em}>the educator becomes
                    the authority</span>. Be the protocol that teaches people
                    how DeFi actually works &mdash; and they will trade on the
                    platform where they learned it.
                  </li>
                  <li>
                    <span className={hl}>Honor the small holders.</span> The
                    anti-whale design (10-vote cap, depth-proportional swap
                    limits, first-depositor attack mitigation) exists for a
                    reason. Your protocol is designed so that{" "}
                    <span className={em}>no single actor can dominate</span>.
                    That is your competitive moat. In a market full of whale
                    games, be the protocol where the quiet accumulator feels
                    safe.
                  </li>
                </ul>

                <Divider isDark={isDark} />

                {/* ═══ CHAPTER 3: THE COMPASS ═══ */}
                <Chapter icon={Compass} number="III" title="The Compass &mdash; Web3's Trajectory &amp; Your Place In It" isDark={isDark} />

                <p className={p}>
                  We are in the{" "}
                  <span className={em}>infrastructure consolidation phase</span>{" "}
                  of Web3. The era of "launch a token and hope" is over. What
                  remains will be the protocols that solved real problems with
                  real architecture &mdash; and WRAPpDEX is positioned exactly
                  where the current is flowing.
                </p>

                <p className={`${p} mt-3`}>
                  <span className={hl}>Three macro trends to navigate:</span>
                </p>

                <div className={`mt-3 space-y-4`}>
                  <div
                    className={`rounded-xl p-4 ${
                      isDark
                        ? "bg-amber-500/[0.03] border border-amber-500/[0.08]"
                        : "bg-amber-50/50 border border-amber-200/40"
                    }`}
                  >
                    <p className={`text-xs font-bold uppercase tracking-wider mb-1.5 ${isDark ? "text-amber-400/60" : "text-amber-600/70"}`}>
                      Trend 1: Regulatory Clarity Becomes a Moat
                    </p>
                    <p className={`text-sm leading-relaxed ${isDark ? "text-slate-300/80" : "text-gray-600"}`}>
                      The Wyoming DUNA is not a compliance checkbox &mdash; it
                      is a <span className={em}>strategic weapon</span>. As
                      MiCA rolls out in Europe and the SEC sharpens its stance
                      in the US, the protocols that can say "we are a recognized
                      legal entity with limited liability protections and binding
                      governance" will attract the capital that flees from
                      anonymous teams. You already have this. Do not take it
                      for granted. Update your legal filings annually. Engage
                      Wyoming counsel proactively, not reactively.
                    </p>
                  </div>

                  <div
                    className={`rounded-xl p-4 ${
                      isDark
                        ? "bg-amber-500/[0.03] border border-amber-500/[0.08]"
                        : "bg-amber-50/50 border border-amber-200/40"
                    }`}
                  >
                    <p className={`text-xs font-bold uppercase tracking-wider mb-1.5 ${isDark ? "text-amber-400/60" : "text-amber-600/70"}`}>
                      Trend 2: Institutional DeFi Is Not Coming &mdash; It Is Here
                    </p>
                    <p className={`text-sm leading-relaxed ${isDark ? "text-slate-300/80" : "text-gray-600"}`}>
                      BlackRock, Fidelity, and sovereign wealth funds are already
                      on-chain. They do not trade on protocols with anonymous
                      Telegram groups and no legal structure. Hedera's governing
                      council (Google, IBM, Boeing, Dell, Deutsche Telekom) is
                      the institutional stamp of approval that no other L1 can
                      match. Your{" "}
                      <span className={em}>Q3/Q4 roadmap</span> &mdash;
                      institutional API, multi-sig treasury, custody
                      integrations &mdash; is precisely the bridge these players
                      need. Build it before they ask for it.
                    </p>
                  </div>

                  <div
                    className={`rounded-xl p-4 ${
                      isDark
                        ? "bg-amber-500/[0.03] border border-amber-500/[0.08]"
                        : "bg-amber-50/50 border border-amber-200/40"
                    }`}
                  >
                    <p className={`text-xs font-bold uppercase tracking-wider mb-1.5 ${isDark ? "text-amber-400/60" : "text-amber-600/70"}`}>
                      Trend 3: The Multi-Chain Convergence
                    </p>
                    <p className={`text-sm leading-relaxed ${isDark ? "text-slate-300/80" : "text-gray-600"}`}>
                      The future is not one chain. It is every chain, bridged
                      seamlessly. Your three-bridge architecture (Squid/60+
                      chains, HashPort/official Hedera, Stargate/LayerZero) plus
                      1inch cross-chain aggregation already makes WRAPpDEX the
                      widest on-ramp to Hedera DeFi. When Hedera's EVM
                      equivalence matures and cross-chain messaging (Chainlink
                      CCIP, LayerZero V2) becomes standard, your{" "}
                      <span className={em}>Weighted Pool Factory</span> becomes
                      a launchpad for any project on any chain that wants Hedera
                      liquidity. Think of bridges not as features but as{" "}
                      <span className={em}>arteries connecting the body of Web3
                      to the heart of Hedera</span>.
                    </p>
                  </div>
                </div>

                <Divider isDark={isDark} />

                {/* ═══ CHAPTER 4: THE ANCHOR ═══ */}
                <Chapter icon={Anchor} number="IV" title="The Anchor &mdash; Caring for Investor Wealth" isDark={isDark} />

                <p className={p}>
                  There is a metaphor I want you to carry with you every single
                  day you manage this protocol:
                </p>

                <div
                  className={`my-5 px-5 py-4 rounded-xl border-l-2 ${
                    isDark
                      ? "border-l-amber-500/40 bg-amber-500/[0.02]"
                      : "border-l-amber-400 bg-amber-50/30"
                  }`}
                >
                  <p className={`text-sm sm:text-[15px] leading-[1.85] italic ${
                    isDark ? "text-amber-200/80" : "text-amber-800/80"
                  }`}>
                    "You are the captain of a ship that carries the savings
                    of people you will never meet. Some of them put in their
                    first $50 of crypto. Some are funding their children's
                    future. Some are in countries where this protocol is their
                    only access to a fair financial system. You do not owe them
                    perfection. You owe them your best judgment, your honest
                    communication, and the discipline to never gamble with
                    what is not yours to gamble."
                  </p>
                </div>

                <p className={`${p} mt-3`}>
                  <span className={hl}>What this means in practice:</span>
                </p>
                <ul className={`${p} list-disc list-inside space-y-2 mt-2 pl-1`}>
                  <li>
                    <span className={hl}>The kill switch is not optional.</span>{" "}
                    If you detect an exploit, an oracle manipulation, or any
                    anomalous drain on pool reserves &mdash; hit it. Immediately.
                    You can explain a 4-hour trading halt. You cannot explain
                    lost funds. LP withdrawals always remain available during
                    a halt &mdash; that is by design. Users can always exit.
                    That single design decision is worth more trust than any
                    marketing campaign.
                  </li>
                  <li>
                    <span className={hl}>Slippage caps protect the distracted.</span>{" "}
                    The depth-proportional swap caps (2% small, 5% mid, 10%
                    large) exist because the biggest losses in DeFi do not
                    happen to sophisticated traders. They happen to someone
                    who types an extra zero at 2 AM. Your protocol should be{" "}
                    <span className={em}>structurally incapable of letting
                    someone accidentally destroy themselves</span>.
                  </li>
                  <li>
                    <span className={hl}>Extracting protocol fees is a governance
                    act, not an operational one.</span> The 0.05% protocol share
                    sits in pool accumulators until the DAO votes to extract.
                    This is deliberate. The treasury should grow with intention,
                    not on autopilot. Every extraction should come with a public
                    rationale: "We are extracting X to fund Y." The community
                    has a right to know where every dollar goes.
                  </li>
                  <li>
                    <span className={hl}>Never list a token to pump your own bags.</span>{" "}
                    The whitelist exists (WBTC, WETH, USDC, USDT, LINK, AAVE,
                    DAI) because every token you add to the AMM is an implicit
                    endorsement. When the community sees a new pool, they trust
                    that you have verified the token's contract, its bridge
                    path, and its decimal precision. The{" "}
                    <span className={em}>DAO "Listing" proposal category</span>{" "}
                    exists so that token additions are community-ratified, not
                    unilateral.
                  </li>
                </ul>

                <Divider isDark={isDark} />

                {/* ═══ CHAPTER 5: THE MOUNTAIN ═══ */}
                <Chapter icon={Mountain} number="V" title="The Mountain &mdash; Managing Your Own Position" isDark={isDark} />

                <p className={p}>
                  This is the hardest chapter to write, because it requires me
                  to trust you with uncomfortable honesty. As a protocol
                  steward, your personal financial relationship to the protocol
                  is both your strength and your greatest risk.
                </p>

                <p className={`${p} mt-3`}>
                  <span className={hl}>The principle is simple:</span> your
                  incentives must always be <span className={em}>structurally
                  aligned</span> with your users' incentives. When you win, they
                  win. When the protocol grows, everyone grows. The moment those
                  incentives diverge, the protocol is already dying &mdash; you
                  just haven't noticed the symptoms yet.
                </p>

                <p className={`${p} mt-3`}>
                  <span className={hl}>Rules I would give my own family:</span>
                </p>
                <ul className={`${p} list-disc list-inside space-y-2 mt-2 pl-1`}>
                  <li>
                    <span className={hl}>Be the biggest LP, not the biggest
                    trader.</span> Your wealth should grow from the protocol's
                    success (LP fees, rising token value, treasury growth),
                    not from trading against your own users. Providing deep
                    liquidity to your own pools is the most honest way to
                    profit &mdash; you earn when volume flows, and you lose
                    when it doesn't. That alignment is{" "}
                    <span className={em}>priceless</span>.
                  </li>
                  <li>
                    <span className={hl}>Never sell into your own community
                    during fear.</span> When the market drops 40% and your
                    Discord is panicking, that is the moment your community is
                    watching what you do. If they see you providing liquidity,
                    answering questions, and staying calm &mdash; they stay. If
                    they see the treasury dumping tokens, they leave. And they
                    will be right to leave.
                  </li>
                  <li>
                    <span className={hl}>Diversify outside the protocol.</span>{" "}
                    It is not disloyal to hold BTC, ETH, stablecoins, and
                    traditional assets alongside your HBAR.ħ position. In fact,
                    it is prudent. A steward who is personally over-leveraged
                    makes desperate decisions. A steward with a stable personal
                    foundation makes{" "}
                    <span className={em}>patient, long-term decisions</span>.
                    And patience is the single most undervalued asset in crypto.
                  </li>
                  <li>
                    <span className={hl}>Use your own protocol daily.</span>{" "}
                    Swap on it. Provide liquidity. Vote on proposals. Use
                    the charting tools. Bridge an asset. If something annoys
                    you, it is annoying ten thousand users who never told you.
                    The best product decisions do not come from analytics
                    dashboards. They come from{" "}
                    <span className={em}>the lived experience of being your
                    own customer</span>.
                  </li>
                </ul>

                <Divider isDark={isDark} />

                {/* ═══ CHAPTER 6: THE CROWN ═══ */}
                <Chapter icon={Crown} number="VI" title="The Crown &mdash; The Weight &amp; The Privilege" isDark={isDark} />

                <p className={p}>
                  You hold admin keys. That means you can halt trading, manage
                  the DAO admin list, and influence the trajectory of every
                  dollar flowing through this protocol. That is not power.
                  That is <span className={em}>weight</span>.
                </p>

                <p className={`${p} mt-3`}>
                  Power is what you take. Weight is what you carry. The best
                  protocol stewards I have ever studied &mdash; across Bitcoin,
                  Ethereum, Hedera, and the protocols that quietly became
                  institutions &mdash; all understood the same thing:
                </p>

                <div
                  className={`my-5 px-5 py-4 rounded-xl border-l-2 ${
                    isDark
                      ? "border-l-amber-500/40 bg-amber-500/[0.02]"
                      : "border-l-amber-400 bg-amber-50/30"
                  }`}
                >
                  <p className={`text-sm sm:text-[15px] leading-[1.85] italic ${
                    isDark ? "text-amber-200/80" : "text-amber-800/80"
                  }`}>
                    "The goal is not to be irreplaceable. The goal is to build
                    something so well-architected, so transparent, and so
                    community-owned that it would thrive even if you stepped
                    away tomorrow. That is the real measure of a steward: not
                    how much the protocol needs you, but how little."
                  </p>
                </div>

                <p className={`${p} mt-3`}>
                  The DUNA structure, the DAO governance, the anti-whale caps,
                  the binding legal framework, the multi-admin system with
                  fresh-session verification &mdash; all of it was designed
                  so that WRAPpDEX is <span className={em}>not a personality
                  </span>. It is an <span className={em}>institution</span>.
                  Personalities fail. Institutions endure.
                </p>

                <p className={`${p} mt-3`}>
                  Your job is to keep building the institution until, one day,
                  the community governs it more capably than you ever could.
                  That is not a loss. That is the{" "}
                  <span className={em}>victory condition</span>.
                </p>

                <Divider isDark={isDark} />

                {/* ═══ CLOSING ═══ */}
                <div className="mt-4">
                  <p className={p}>
                    I want to close with something personal.
                  </p>

                  <p className={`${p} mt-3`}>
                    You chose to build on Hedera when it was easy to build on
                    Ethereum. You chose a DUNA when it was cheaper to stay
                    anonymous. You chose a server-side AMM when it was simpler
                    to fork Uniswap. You chose ED25519 challenge-response
                    auth when it was easier to just check a wallet address.
                  </p>

                  <p className={`${p} mt-3`}>
                    Every one of those choices was the harder path. And every
                    one of them was <span className={em}>right</span>.
                  </p>

                  <p className={`${p} mt-3`}>
                    The market will test you. There will be weeks when volume
                    is low and your Discord is quiet and you wonder if anyone
                    cares. Let me tell you something that took me a long time
                    to learn: <span className={em}>the quiet periods are when
                    the real work happens</span>. The protocols that ship
                    features during bear markets are the ones that dominate
                    the next bull run. The people who leave during the quiet
                    were never your community. The ones who stay are the
                    foundation you build a movement on.
                  </p>

                  <p className={`${p} mt-3`}>
                    So keep building. Keep shipping. Keep the garden growing.
                    And never, ever forget that behind every wallet address
                    is a human being who trusted you with something precious.
                  </p>

                  <p className={`${p} mt-6`}>
                    With deep respect and high expectations,
                  </p>

                  <p
                    className={`text-sm font-semibold mt-3 ${
                      isDark ? "text-amber-300/80" : "text-amber-700"
                    }`}
                  >
                    The Architect
                  </p>

                  <p className={`text-xs mt-1 ${isDark ? "text-amber-500/30" : "text-amber-400/50"}`}>
                    Written for the founding stewards of WRAPpDEX &middot;
                    February 2026
                  </p>
                </div>

                {/* ── Final Seal ── */}
                <div className="flex justify-center mt-10 mb-4">
                  <div className="flex items-center gap-2">
                    <KeyRound
                      className={`w-3.5 h-3.5 ${
                        isDark ? "text-amber-500/20" : "text-amber-400/30"
                      }`}
                    />
                    <p
                      className={`text-[10px] font-mono tracking-widest uppercase ${
                        isDark ? "text-amber-500/15" : "text-amber-400/25"
                      }`}
                    >
                      Steward Access Only &middot; Do Not Distribute
                    </p>
                    <Shield
                      className={`w-3.5 h-3.5 ${
                        isDark ? "text-amber-500/20" : "text-amber-400/30"
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   BRIEFCASE TRIGGER — Glowing admin-only icon for the whitepaper footer
   ═══════════════════════════════════════════════════════════════════════ */

export function BriefcaseTrigger({ onClick }: { onClick: () => void }) {
  const { isDark } = useTheme();

  return (
    <motion.button
      onClick={onClick}
      className={`group relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 ${
        isDark
          ? "bg-amber-500/[0.06] border border-amber-500/[0.12] hover:bg-amber-500/[0.12] hover:border-amber-500/[0.25]"
          : "bg-amber-50/60 border border-amber-200/40 hover:bg-amber-100/80 hover:border-amber-300/60"
      }`}
      aria-label="Open Steward's Codex"
      title="The Steward's Codex"
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
    >
      {/* Ambient glow */}
      <motion.div
        className="absolute inset-0 rounded-xl pointer-events-none"
        animate={{
          boxShadow: [
            `0 0 8px ${isDark ? "rgba(245,158,11,0.06)" : "rgba(217,119,6,0.06)"}`,
            `0 0 20px ${isDark ? "rgba(245,158,11,0.14)" : "rgba(217,119,6,0.12)"}`,
            `0 0 8px ${isDark ? "rgba(245,158,11,0.06)" : "rgba(217,119,6,0.06)"}`,
          ],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />
      <Briefcase
        className={`w-4 h-4 ${
          isDark
            ? "text-amber-400/60 group-hover:text-amber-300"
            : "text-amber-500/60 group-hover:text-amber-600"
        } transition-colors`}
      />
    </motion.button>
  );
}

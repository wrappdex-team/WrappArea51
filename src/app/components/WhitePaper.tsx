import { useEffect, useState, useRef } from "react";
import { Link } from "react-router";
import { motion, useInView } from "motion/react";
import {
  ArrowLeft,
  TrendingUp,
  BarChart3,
  ArrowRightLeft,
  Shield,
  Vote,
  Crown,
  Globe,
  Zap,
  DollarSign,
  Lock,
  Eye,
  Layers,
  Activity,
  Target,
  Users,
  ChevronRight,
  ExternalLink,
  BookOpen,
  CheckCircle2,
  Clock,
  Rocket,
  Building2,
  Coins,
  LayoutGrid,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { FounderLetter } from "./FounderLetter";
import { CommunityMessage } from "./CommunityMessage";
import { EmrakDiagrams } from "./EmrakDiagrams";

/* ─── Animated Section Wrapper ─────────────────────────────────────── */

function Section({
  children,
  id,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  id?: string;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ─── Glass Card ───────────────────────────────────────────────────── */

function GlassCard({
  children,
  className = "",
  hover = true,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  const { isDark } = useTheme();
  return (
    <div
      className={`rounded-2xl border backdrop-blur-xl transition-all duration-300 ${
        isDark
          ? "bg-white/[0.03] border-white/[0.06]"
          : "bg-white/80 border-gray-200"
      } ${hover ? (isDark ? "hover:border-white/[0.12] hover:bg-white/[0.05]" : "hover:border-gray-300 hover:shadow-lg") : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── Stat Badge ───────────────────────────────────────────────────── */

function StatBadge({ value, label }: { value: string; label: string }) {
  const { isDark } = useTheme();
  return (
    <div className="text-center">
      <div
        className={`text-2xl md:text-3xl font-bold bg-gradient-to-r bg-clip-text text-transparent ${
          isDark
            ? "from-pink-400 to-purple-400"
            : "from-pink-600 to-purple-600"
        }`}
      >
        {value}
      </div>
      <div
        className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}
      >
        {label}
      </div>
    </div>
  );
}

/* ─── Flow Step (for diagrams) ─────────────────────────────────────── */

function FlowStep({
  icon: Icon,
  label,
  color,
  last = false,
}: {
  icon: React.ElementType;
  label: string;
  color: string;
  last?: boolean;
}) {
  const { isDark } = useTheme();
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}
      >
        <Icon className="w-4 h-4 md:w-5 md:h-5 text-white" />
      </div>
      <span
        className={`text-xs md:text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}
      >
        {label}
      </span>
      {!last && (
        <ChevronRight
          className={`w-4 h-4 flex-shrink-0 ${isDark ? "text-slate-600" : "text-gray-300"}`}
        />
      )}
    </div>
  );
}

/* ─── Oracle Tier Badge ────────────────────────────────────────────── */

function OracleTier({
  tier,
  name,
  desc,
  color,
  dotColor,
}: {
  tier: string;
  name: string;
  desc: string;
  color: string;
  dotColor: string;
}) {
  const { isDark } = useTheme();
  return (
    <GlassCard className="p-4 md:p-5 flex items-start gap-3">
      <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
        <div className={`w-3 h-3 rounded-full ${dotColor}`} />
        <span
          className={`text-xs font-bold ${isDark ? "text-slate-500" : "text-gray-400"}`}
        >
          {tier}
        </span>
      </div>
      <div>
        <h4
          className={`font-bold text-sm md:text-base ${isDark ? "text-white" : "text-slate-900"} ${color}`}
        >
          {name}
        </h4>
        <p
          className={`text-xs md:text-sm mt-1 leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
        >
          {desc}
        </p>
      </div>
    </GlassCard>
  );
}

/* ─── Roadmap Quarter ──────────────────────────────────────────────── */

function RoadmapQ({
  quarter,
  title,
  items,
  current = false,
  icon: Icon,
}: {
  quarter: string;
  title: string;
  items: string[];
  current?: boolean;
  icon: React.ElementType;
}) {
  const { isDark } = useTheme();
  return (
    <GlassCard
      className={`p-5 md:p-6 relative overflow-hidden ${current ? (isDark ? "border-pink-500/30" : "border-pink-300") : ""}`}
    >
      {current && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-500 to-purple-500" />
      )}
      <div className="flex items-center gap-3 mb-4">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            current
              ? "bg-gradient-to-br from-pink-500 to-purple-500"
              : isDark
                ? "bg-slate-800"
                : "bg-gray-100"
          }`}
        >
          <Icon
            className={`w-5 h-5 ${current ? "text-white" : isDark ? "text-slate-400" : "text-gray-500"}`}
          />
        </div>
        <div>
          <div
            className={`text-xs font-bold uppercase tracking-wider ${
              current
                ? isDark
                  ? "text-pink-400"
                  : "text-pink-600"
                : isDark
                  ? "text-slate-500"
                  : "text-gray-400"
            }`}
          >
            {quarter}
            {current && " — NOW"}
          </div>
          <div
            className={`font-bold ${isDark ? "text-white" : "text-slate-900"}`}
          >
            {title}
          </div>
        </div>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <CheckCircle2
              className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                current
                  ? "text-emerald-400"
                  : isDark
                    ? "text-slate-600"
                    : "text-gray-300"
              }`}
            />
            <span
              className={`text-xs md:text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}
            >
              {item}
            </span>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

/* ─── Team Card ────────────────────────────────────────────────────── */

function TeamCard({
  name,
  role,
  desc,
  accent,
  href,
  onClick,
}: {
  name: string;
  role: string;
  desc: string;
  accent: string;
  href?: string;
  onClick?: () => void;
}) {
  const { isDark } = useTheme();
  const interactive = !!href || !!onClick;
  const card = (
    <GlassCard className={`p-5 md:p-6 text-center${interactive ? " cursor-pointer" : ""}`}>
      <div
        className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-white ${accent}`}
      >
        {name.charAt(0)}
      </div>
      <h4
        className={`font-bold text-base md:text-lg ${isDark ? "text-white" : "text-slate-900"}`}
      >
        {name}
      </h4>
      <p
        className={`text-xs font-semibold mt-1 bg-gradient-to-r bg-clip-text text-transparent ${
          isDark
            ? "from-pink-400 to-purple-400"
            : "from-pink-600 to-purple-600"
        }`}
      >
        {role}
      </p>
      <p
        className={`text-xs md:text-sm mt-3 leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
      >
        {desc}
      </p>
    </GlassCard>
  );
  if (href) return <Link to={href} className="no-underline">{card}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className="text-left w-full">{card}</button>;
  return card;
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export function WhitePaper() {
  const { isDark } = useTheme();
  const [activeSection, setActiveSection] = useState("");
  const [founderLetterOpen, setFounderLetterOpen] = useState(false);
  const [communityMessageOpen, setCommunityMessageOpen] = useState(false);
  const [emrakDiagramsOpen, setEmrakDiagramsOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  /* ── Intersection observer for TOC highlighting ── */
  useEffect(() => {
    const ids = [
      "intro",
      "why-hedera",
      "features",
      "swap-flow",
      "oracles",
      "amm",
      "bridges",
      "dao",
      "vip",
      "token",
      "security",
      "roadmap",
      "team",
      "partners",
    ];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const tocItems = [
    { id: "intro", label: "Overview" },
    { id: "why-hedera", label: "Why Hedera" },
    { id: "features", label: "Features" },
    { id: "swap-flow", label: "How Swaps Work" },
    { id: "oracles", label: "Price Oracles" },
    { id: "amm", label: "AMM Engine" },
    { id: "bridges", label: "Bridges" },
    { id: "dao", label: "Governance" },
    { id: "vip", label: "VIP System" },
    { id: "token", label: "HBAR.ħ Token" },
    { id: "security", label: "Security" },
    { id: "roadmap", label: "Roadmap" },
    { id: "team", label: "Team" },
    { id: "partners", label: "Partners" },
  ];

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const h2 = `text-2xl md:text-3xl font-bold mb-2 ${isDark ? "text-white" : "text-slate-900"}`;
  const subtitle = `text-sm md:text-base mb-8 ${isDark ? "text-slate-400" : "text-gray-500"}`;
  const prose = `text-sm md:text-base leading-relaxed ${isDark ? "text-slate-300" : "text-slate-600"}`;

  return (
    <div className="relative">
      {/* ── Sticky TOC (desktop sidebar) ── */}
      <nav
        className={`hidden xl:block fixed top-28 left-6 2xl:left-10 w-44 z-40`}
        aria-label="White paper table of contents"
      >
        <div
          className={`rounded-xl border backdrop-blur-xl p-3 ${
            isDark
              ? "bg-[#080a12]/80 border-white/[0.06]"
              : "bg-white/90 border-gray-200"
          }`}
        >
          <p
            className={`text-xs font-bold uppercase tracking-wider mb-3 px-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}
          >
            Contents
          </p>
          <ul className="space-y-0.5">
            {tocItems.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => scrollTo(t.id)}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded-lg transition-all duration-200 ${
                    activeSection === t.id
                      ? isDark
                        ? "text-pink-400 bg-pink-500/10 font-semibold"
                        : "text-pink-600 bg-pink-50 font-semibold"
                      : isDark
                        ? "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"
                        : "text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 md:py-12">
        {/* Back nav */}
        <Link
          to="/"
          className={`inline-flex items-center gap-2 text-sm mb-8 transition-colors ${
            isDark
              ? "text-slate-400 hover:text-white"
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to WRAPpDEX
        </Link>

        {/* ═══ HERO ═══ */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <p
                className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-pink-400" : "text-pink-600"}`}
              >
                Wrapp Paper
              </p>
              <p
                className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
              >
                Version 2.0 &middot; February 2026
              </p>
            </div>
          </div>

          <h1
            className={`text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6 ${isDark ? "text-white" : "text-slate-900"}`}
          >
            The Institutional-Grade{" "}
            <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
              DEX on Hedera
            </span>
          </h1>

          <p
            className={`text-lg md:text-xl leading-relaxed max-w-2xl ${isDark ? "text-slate-300" : "text-slate-600"}`}
          >
            Trade smarter. Not harder. One platform for swaps, pro charting,
            lending, bridging, and governance &mdash; built on the fastest
            enterprise-grade public ledger.
          </p>

          {/* Hero stats */}
          <div className="flex flex-wrap gap-8 md:gap-12 mt-10">
            <StatBadge value="10,000+" label="Transactions / sec" />
            <StatBadge value="~2s" label="Finality" />
            <StatBadge value="~$0.0001" label="Per transaction" />
            <StatBadge value="0" label="MEV / Front-running" />
          </div>
        </motion.div>

        {/* ═══ INTRO ═══ */}
        <Section id="intro" className="mb-16">
          <h2 className={h2}>What is WRAPpDEX?</h2>
          <p className={subtitle}>
            Everything you need for DeFi, in one place.
          </p>

          <GlassCard className="p-6 md:p-8 mb-6" hover={false}>
            <p className={`${prose} mb-4`}>
              WRAPpDEX is a decentralized exchange built natively on Hedera. It
              combines token swapping, professional-grade trading charts,
              liquidity pools, lending &amp; borrowing, cross-chain bridges, a
              fiat on-ramp, and community governance into a single platform.
            </p>
            <p className={prose}>
              No account registration. No custody of your assets. Connect your
              wallet, and you're in. Every transaction settles on Hedera's
              hashgraph with sub-cent fees and provable finality in seconds
              &mdash; not minutes, not hours.
            </p>
          </GlassCard>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { v: "16", l: "Price Feeds" },
              { v: "16", l: "Liquidity Pools" },
              { v: "60+", l: "Bridge Chains" },
              { v: "6", l: "Lending Markets" },
            ].map((s) => (
              <GlassCard key={s.l} className="p-4 text-center">
                <div
                  className={`text-xl md:text-2xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}
                >
                  {s.v}
                </div>
                <div
                  className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}
                >
                  {s.l}
                </div>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* ═══ WHY HEDERA ═══ */}
        <Section id="why-hedera" className="mb-16">
          <h2 className={h2}>Why Hedera?</h2>
          <p className={subtitle}>
            The only public ledger with enterprise governance and
            mathematically provable finality.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            {[
              {
                icon: Zap,
                title: "10,000+ TPS",
                desc: "Process thousands of swaps per second without congestion.",
              },
              {
                icon: Clock,
                title: "~2-Second Finality",
                desc: "Asynchronous Byzantine Fault Tolerant hashgraph consensus. Not \"eventually\" \u2014 mathematically provable, immutable finality.",
              },
              {
                icon: Coins,
                title: "Sub-Cent Fees",
                desc: "~$0.0001 per transaction. No gas wars, no fee spikes.",
              },
              {
                icon: Shield,
                title: "No MEV, No Front-Running",
                desc: "Fair consensus-timestamped ordering. Validators can't reorder your trades.",
              },
              {
                icon: Building2,
                title: "Governing Council",
                desc: "Google, IBM, Boeing, and 30+ enterprise members govern the network.",
              },
              {
                icon: Layers,
                title: "Full EVM Equivalence",
                desc: "Deploy Solidity smart contracts natively alongside Hedera Token Service.",
              },
              {
                icon: LayoutGrid,
                title: "Native Token Standard",
                desc: "HTS tokens are faster and cheaper than ERC-20. No smart contract overhead.",
              },
              {
                icon: Target,
                title: "Native Staking",
                desc: "HBAR staking with network reward distribution built into the protocol.",
              },
            ].map((item) => (
              <GlassCard key={item.title} className="p-5 flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <item.icon
                    className={`w-5 h-5 ${isDark ? "text-pink-400" : "text-pink-600"}`}
                  />
                </div>
                <div>
                  <h4
                    className={`font-bold text-sm md:text-base ${isDark ? "text-white" : "text-slate-900"}`}
                  >
                    {item.title}
                  </h4>
                  <p
                    className={`text-xs md:text-sm mt-1 leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
                  >
                    {item.desc}
                  </p>
                </div>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* ═══ FEATURES ═══ */}
        <Section id="features" className="mb-16">
          <h2 className={h2}>Platform Features</h2>
          <p className={subtitle}>Eight modules. One interface. Zero compromise.</p>

          <div className="grid sm:grid-cols-2 gap-3">
            {[
              {
                icon: TrendingUp,
                title: "Markets",
                desc: "Live dashboards with market caps, Fear & Greed Index, RSI gauges, BTC dominance, sparkline charts, and 20+ asset tickers.",
                color: "from-blue-500 to-cyan-500",
              },
              {
                icon: BarChart3,
                title: "Trading Terminal",
                desc: "Pro-grade candlestick charts with 9 timeframes, 6 technical indicators, persistent drawing tools, and a watchlist.",
                color: "from-purple-500 to-pink-500",
              },
              {
                icon: ArrowRightLeft,
                title: "Swap",
                desc: "SaucerSwap-powered token swaps with route visualization, configurable slippage, and auto-refreshing quotes.",
                color: "from-pink-500 to-rose-500",
              },
              {
                icon: DollarSign,
                title: "Buy / Sell",
                desc: "Fiat on-ramp via ChangeNOW. Buy HBAR directly with a credit card from 100+ supported currencies.",
                color: "from-emerald-500 to-teal-500",
              },
              {
                icon: Layers,
                title: "DeFi Suite",
                desc: "16 liquidity pools, Bonzo Finance lending/borrowing (Aave V2 on Hedera), and staking infrastructure.",
                color: "from-amber-500 to-orange-500",
              },
              {
                icon: Vote,
                title: "DAO Governance",
                desc: "Create and vote on proposals. Voting power is token-weighted and verified on-chain via Mirror Node.",
                color: "from-violet-500 to-indigo-500",
              },
              {
                icon: Globe,
                title: "Cross-Chain Bridges",
                desc: "Three bridge protocols: Squid (60+ chains), HashPort (Hedera official), and Stargate (LayerZero).",
                color: "from-cyan-500 to-blue-500",
              },
              {
                icon: Shield,
                title: "Security Audit",
                desc: "WalletConnect health reports, authentication status, and infrastructure monitoring in one view.",
                color: "from-slate-500 to-slate-600",
              },
            ].map((item) => (
              <GlassCard key={item.title} className="p-5 md:p-6">
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center mb-4`}
                >
                  <item.icon className="w-5 h-5 text-white" />
                </div>
                <h4
                  className={`font-bold text-base ${isDark ? "text-white" : "text-slate-900"}`}
                >
                  {item.title}
                </h4>
                <p
                  className={`text-xs md:text-sm mt-2 leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  {item.desc}
                </p>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* ═══ SWAP FLOW ═══ */}
        <Section id="swap-flow" className="mb-16">
          <h2 className={h2}>How a Swap Works</h2>
          <p className={subtitle}>
            From token selection to on-chain confirmation in seconds.
          </p>

          <GlassCard className="p-6 md:p-8" hover={false}>
            <div className="flex flex-wrap items-center gap-3 md:gap-2">
              <FlowStep
                icon={ArrowRightLeft}
                label="Select Tokens"
                color="bg-pink-500"
              />
              <FlowStep
                icon={DollarSign}
                label="Enter Amount"
                color="bg-purple-500"
              />
              <FlowStep
                icon={Activity}
                label="Route Discovery"
                color="bg-blue-500"
              />
              <FlowStep
                icon={Eye}
                label="Review Quote"
                color="bg-cyan-500"
              />
              <FlowStep
                icon={Lock}
                label="Wallet Sign"
                color="bg-amber-500"
              />
              <FlowStep
                icon={Zap}
                label="On-Chain Execute"
                color="bg-emerald-500"
              />
              <FlowStep
                icon={CheckCircle2}
                label="Confirmed"
                color="bg-green-500"
                last
              />
            </div>

            <div
              className={`mt-6 pt-6 border-t ${isDark ? "border-white/[0.06]" : "border-gray-100"}`}
            >
              <h4
                className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Route Example: HBAR &rarr; USDC
              </h4>
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className={`px-4 py-2 rounded-xl text-sm font-bold ${isDark ? "bg-slate-800 text-white" : "bg-gray-100 text-slate-900"}`}
                >
                  HBAR
                </div>
                <div className="flex flex-col items-center">
                  <ChevronRight
                    className={`w-5 h-5 ${isDark ? "text-pink-400" : "text-pink-500"}`}
                  />
                  <span
                    className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
                  >
                    wrap
                  </span>
                </div>
                <div
                  className={`px-4 py-2 rounded-xl text-sm font-bold ${isDark ? "bg-slate-800 text-white" : "bg-gray-100 text-slate-900"}`}
                >
                  WHBAR
                </div>
                <div className="flex flex-col items-center">
                  <ChevronRight
                    className={`w-5 h-5 ${isDark ? "text-purple-400" : "text-purple-500"}`}
                  />
                  <span
                    className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
                  >
                    0.10% fee
                  </span>
                </div>
                <div
                  className={`px-4 py-2 rounded-xl text-sm font-bold ${isDark ? "bg-slate-800 text-white" : "bg-gray-100 text-slate-900"}`}
                >
                  USDC
                </div>
              </div>
              <p
                className={`text-xs mt-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}
              >
                The router finds optimal multi-hop paths through SaucerSwap V1
                liquidity pools. HBAR/WHBAR wraps are always 1:1, zero fee.
              </p>
            </div>
          </GlassCard>
        </Section>

        {/* ═══ ORACLE PIPELINE ═══ */}
        <Section id="oracles" className="mb-16">
          <h2 className={h2}>Price Oracle Pipeline</h2>
          <p className={subtitle}>
            Three tiers of redundancy. Every price shows its source.
          </p>

          <div className="grid gap-3">
            <OracleTier
              tier="T1"
              name="Chainlink"
              desc="Decentralized oracle feeds from Ethereum. 16 price feeds, batched for efficiency. The gold standard for on-chain price data."
              color=""
              dotColor="bg-blue-500"
            />
            <OracleTier
              tier="T2"
              name="CoinCap"
              desc="Activates when Chainlink is unreachable. Real-time prices, 24h changes, and 7-day sparkline history."
              color=""
              dotColor="bg-amber-500"
            />
            <OracleTier
              tier="T3"
              name="CoinGecko"
              desc="Final fallback. Market cap, volume, and 24h change data with comprehensive token coverage."
              color=""
              dotColor="bg-green-500"
            />
          </div>

          <GlassCard className="p-5 mt-3" hover={false}>
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`text-xs font-bold ${isDark ? "text-slate-500" : "text-gray-400"}`}
              >
                UI Badges:
              </span>
              {[
                { c: "bg-blue-500", l: "Chainlink" },
                { c: "bg-amber-500", l: "CoinCap" },
                { c: "bg-green-500", l: "CoinGecko" },
                { c: "bg-slate-500", l: "Cached" },
              ].map((b) => (
                <span key={b.l} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${b.c}`} />
                  <span
                    className={`text-xs ${isDark ? "text-slate-300" : "text-slate-600"}`}
                  >
                    {b.l}
                  </span>
                </span>
              ))}
            </div>
            <p
              className={`text-xs mt-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}
            >
              Every price on the platform carries a colored dot showing exactly
              where the data came from. No black boxes.
            </p>
          </GlassCard>
        </Section>

        {/* ═══ AMM ENGINE ═══ */}
        <Section id="amm" className="mb-16">
          <h2 className={h2}>Smart Liquidity Engine</h2>
          <p className={subtitle}>
            A custom AMM built for Hedera &mdash; front-running eliminated by design.
          </p>
          <p
            className={`text-xs md:text-sm leading-relaxed mb-6 max-w-3xl ${isDark ? "text-slate-400" : "text-gray-500"}`}
          >
            Most decentralized exchanges settle trades on-chain, which means
            every pending swap sits in a public mempool before it executes.
            Bots exploit that transparency to front-run ordinary users,
            extracting value on every trade. WRAPpDEX takes a fundamentally
            different approach: all pool state is maintained server-side
            inside a private KV store, so swap execution is deterministic and
            atomic. There is no mempool to snipe, no block producer who can
            reorder your transaction, and no MEV leakage. Every mutation is
            protected by a per-pool pessimistic lock plus optimistic
            compare-and-swap versioning, and a post-swap k-invariant
            assertion guarantees that reserves can never decrease.
          </p>

          {/* How It Works + Slippage */}
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                How It Works
              </h4>
              <p
                className={`text-xs md:text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
              >
                Every pool follows the constant-product formula:{" "}
                <span
                  className={`font-mono font-bold ${isDark ? "text-pink-400" : "text-pink-600"}`}
                >
                  x &times; y = k
                </span>
                . When you submit a swap the engine calculates your exact
                output amount, deducts a{" "}
                <span className={`font-semibold ${isDark ? "text-pink-400" : "text-pink-600"}`}>0.10&nbsp;%</span>{" "}
                in-pool fee (which stays in the pool and increases{" "}
                <span className="font-mono">k</span>, benefiting all LP
                holders), and settles instantly &mdash; all in a single
                atomic step. Because the entire process happens server-side,
                no third party can see or interfere with your trade.
              </p>
            </GlassCard>

            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Slippage Protection
              </h4>
              <p
                className={`text-xs md:text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
              >
                You set your maximum slippage (0.1&nbsp;% to 3&nbsp;%+). If
                the execution price moves beyond your tolerance the swap is
                rejected and your tokens stay safe. No partial fills, no
                surprises. For example, if you swap{" "}
                <span className={`font-semibold ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>100 HBAR</span>{" "}
                into USDC with 0.5&nbsp;% slippage, you are guaranteed to
                receive at least 99.5&nbsp;% of the quoted amount or the
                trade will not execute at all.
              </p>
            </GlassCard>
          </div>

          {/* Smart Routing */}
          <GlassCard className="p-5 md:p-6 mb-4" hover={false}>
            <h4
              className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
            >
              Smart Routing: Direct &amp; USDC-Hop
            </h4>
            <p
              className={`text-xs md:text-sm leading-relaxed mb-3 ${isDark ? "text-slate-400" : "text-gray-500"}`}
            >
              Not every token pair has a dedicated pool. WRAPpDEX&#39;s
              smart router automatically evaluates two route strategies for
              every quote and picks the one that delivers the best output:
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className={`rounded-lg p-3 ${isDark ? "bg-white/[0.03] border border-white/[0.06]" : "bg-gray-50 border border-gray-200"}`}>
                <p className={`text-xs font-bold mb-1 ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>
                  Direct Route
                </p>
                <p className={`text-xs leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  A &rarr; B &mdash; single-pool swap when a direct pair
                  exists. Lowest fees, one hop.
                </p>
              </div>
              <div className={`rounded-lg p-3 ${isDark ? "bg-white/[0.03] border border-white/[0.06]" : "bg-gray-50 border border-gray-200"}`}>
                <p className={`text-xs font-bold mb-1 ${isDark ? "text-pink-400" : "text-pink-600"}`}>
                  USDC-Hop Route
                </p>
                <p className={`text-xs leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  A &rarr; USDC &rarr; B &mdash; two-pool hop through the
                  deepest stablecoin liquidity. Unlocks every pair even
                  when no direct pool exists.
                </p>
              </div>
            </div>
            <p className={`text-xs mt-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              The router scores every candidate by output amount, price
              impact, and pool depth. Low-TVL pools (under $100) are excluded
              from routing to prevent manipulation, and depth-proportional
              caps limit individual swaps to 2&ndash;10&nbsp;% of pool TVL
              depending on pool size.
            </p>
          </GlassCard>

          {/* Swap Example */}
          <GlassCard className="p-5 md:p-6 mb-4" hover={false}>
            <h4
              className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
            >
              Example Swap: HBAR &rarr; USDC
            </h4>
            <div className={`text-xs md:text-sm leading-relaxed space-y-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              <p>
                Suppose a pool holds{" "}
                <span className={`font-semibold ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>500,000 HBAR</span>{" "}
                and{" "}
                <span className={`font-semibold ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>50,000 USDC</span>{" "}
                (implied price: $0.10/HBAR). You want to swap{" "}
                <span className={`font-semibold ${isDark ? "text-pink-400" : "text-pink-600"}`}>1,000 HBAR</span>.
              </p>
              <ol className={`list-decimal list-inside space-y-1.5 pl-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                <li>
                  The 0.10&nbsp;% in-pool fee is applied first: 1,000 &times;
                  0.999 ={" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>999 HBAR</span>{" "}
                  enters the pricing formula.
                </li>
                <li>
                  The engine applies{" "}
                  <span className={`font-mono font-bold ${isDark ? "text-pink-400" : "text-pink-600"}`}>x &times; y = k</span>:{" "}
                  (999 &times; 50,000) / (500,000 + 999) ={" "}
                  <span className={`font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>~99.70 USDC</span>.
                </li>
                <li>
                  Your slippage tolerance is checked. At 0.5&nbsp;%, you
                  need at least 99.20 USDC &mdash; the quote passes.
                </li>
                <li>
                  A flat protocol fee of{" "}
                  <span className={`font-semibold ${isDark ? "text-amber-400" : "text-amber-600"}`}>$0.0007</span>{" "}
                  (~2.5 tinybar) is assessed separately in HBAR &mdash;
                  split 50/50 between LP rewards and the protocol treasury.
                </li>
                <li>
                  The swap settles atomically. Pool balances update to
                  501,000 HBAR / 49,900.30 USDC. A post-swap k-invariant
                  check confirms reserves never decreased. No front-running
                  window ever existed.
                </li>
              </ol>
              <p className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Larger trades move the price curve more (price impact). The
                UI shows your estimated impact before you confirm so there
                are never any hidden costs.
              </p>
            </div>
          </GlassCard>

          {/* Dual-Fee Structure */}
          <h4
            className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
          >
            Dual-Fee Structure
          </h4>
          <p
            className={`text-xs md:text-sm leading-relaxed mb-4 max-w-3xl ${isDark ? "text-slate-400" : "text-gray-500"}`}
          >
            WRAPpDEX uses a two-layer fee model designed to keep trading
            costs near zero while sustaining the protocol and rewarding
            liquidity providers:
          </p>
          <div className="grid md:grid-cols-3 gap-3 mb-4">
            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-2 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                In-Pool Fee
              </h4>
              <p className="text-2xl font-bold mb-1 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                0.10%
              </p>
              <p
                className={`text-xs leading-relaxed ${isDark ? "text-slate-500" : "text-gray-400"}`}
              >
                Applied per trade (10 bps). The fee stays inside the pool,
                increasing <span className="font-mono">k</span> and
                benefiting all LP holders proportional to their share. This
                rate is protocol-fixed and cannot be changed by pool
                creators.
              </p>
            </GlassCard>
            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-2 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Protocol Fee
              </h4>
              <p className="text-2xl font-bold mb-1 bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                $0.0007
              </p>
              <p
                className={`text-xs leading-relaxed ${isDark ? "text-slate-500" : "text-gray-400"}`}
              >
                A flat micro-fee per swap (~0.07 cents), paid in HBAR.
                Split 50/50: half goes to LP providers as a bonus reward,
                half accrues to the protocol treasury (0.0.9695738). Flat
                fees prevent manipulation via trade splitting.
              </p>
            </GlassCard>
            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-2 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Settlement
              </h4>
              <p className="text-2xl font-bold mb-1 bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                ~2 Seconds
              </p>
              <p
                className={`text-xs leading-relaxed ${isDark ? "text-slate-500" : "text-gray-400"}`}
              >
                Pool state updates server-side in milliseconds, while
                on-chain token settlement follows Hedera&#39;s aBFT
                consensus finality of ~2&nbsp;seconds. No pending
                transactions in a public mempool. The AMM includes an
                owner-only kill switch for emergency halts &mdash; LP
                withdrawals always remain open.
              </p>
            </GlassCard>
          </div>

          {/* Security */}
          <GlassCard className="p-5 md:p-6 mb-4" hover={false}>
            <h4
              className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
            >
              Security by Design
            </h4>
            <div className={`text-xs md:text-sm leading-relaxed space-y-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              <p>
                The AMM is hardened against the most common DeFi attack
                vectors:
              </p>
              <ul className={`list-disc list-inside pl-1 space-y-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                <li>
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>Private mempool</span>{" "}
                  &mdash; pool state lives in a KV store accessible only by
                  the server. No public transaction queue exists.
                </li>
                <li>
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>First-depositor attack mitigation</span>{" "}
                  &mdash; the first 1,000 LP shares of every pool are
                  permanently locked (MINIMUM_LIQUIDITY), preventing
                  share-price manipulation.
                </li>
                <li>
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>Depth-proportional caps</span>{" "}
                  &mdash; individual swaps are limited to 2&nbsp;% of TVL
                  for small pools (&lt;$10K), 5&nbsp;% for mid-size, and
                  10&nbsp;% for large pools (&gt;$100K).
                </li>
                <li>
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>K-invariant assertion</span>{" "}
                  &mdash; every swap is followed by a mathematical proof
                  that reserves never decreased. Any violation aborts the
                  trade.
                </li>
                <li>
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>Circuit breaker</span>{" "}
                  &mdash; an owner-only kill switch can halt all swaps
                  instantly. LP withdrawals always remain available so users
                  can exit at any time.
                </li>
              </ul>
            </div>
          </GlassCard>

          {/* Weighted Pool Factory */}
          <GlassCard className="p-5 md:p-6" hover={false}>
            <h4
              className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
            >
              Weighted Pool Factory
            </h4>
            <p
              className={`text-xs md:text-sm leading-relaxed mb-3 ${isDark ? "text-slate-400" : "text-gray-500"}`}
            >
              Beyond standard 50/50 pools, WRAPpDEX supports custom weighted
              multi-token pools (2&ndash;10 tokens per pool) deployed via a
              Solidity smart contract on Hedera&#39;s EVM equivalence layer.
              Think portfolio-style pools like 80/20 HBAR/USDC &mdash; ideal
              for projects that want to maintain heavy exposure to one asset
              while still offering deep, tradable liquidity. Token weights
              must sum to exactly 100&nbsp;% (validated on-chain), and each
              token must carry at least a 1&nbsp;% weight to prevent
              degenerate configurations. The fixed 0.10&nbsp;% swap fee
              applies uniformly across all pools.
            </p>
            <div className="flex items-center gap-4 flex-wrap mb-3">
              <span
                className={`text-xs px-3 py-1 rounded-full ${isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}
              >
                VIP or 100M+ HBAR.ħ holders = Free
              </span>
              <span
                className={`text-xs px-3 py-1 rounded-full ${isDark ? "bg-slate-800 text-slate-300 border border-white/[0.06]" : "bg-gray-50 text-gray-600 border border-gray-200"}`}
              >
                Non-VIP = $50 in HBAR.ħ
              </span>
            </div>
            <p
              className={`text-xs leading-relaxed ${isDark ? "text-slate-500" : "text-gray-400"}`}
            >
              <span className="font-semibold">Example:</span> A new Hedera
              token project creates an 80/20 PROJECT/HBAR pool to bootstrap
              liquidity while keeping 80&nbsp;% of the pool&#39;s value in their
              native token. Traders get access to a liquid market, and the
              project earns passive income from every swap. The factory
              contract is audited against reentrancy, overflow, access
              control, and front-running vectors, with all state changes
              emitted as events for full off-chain indexing via Mirror Node.
            </p>
          </GlassCard>
        </Section>

        {/* ═══ BRIDGES ═══ */}
        <Section id="bridges" className="mb-16">
          <h2 className={h2}>Cross-Chain Bridges</h2>
          <p className={subtitle}>
            Three protocols. 60+ chains. Move assets anywhere.
          </p>

          <div className="grid sm:grid-cols-3 gap-3">
            {[
              {
                name: "Squid",
                sub: "Axelar",
                chains: "60+ chains",
                desc: "Multi-chain swaps and EVM-to-EVM transfers via General Message Passing.",
                color: "from-blue-600 to-indigo-600",
              },
              {
                name: "HashPort",
                sub: "Official",
                chains: "Hedera + EVM",
                desc: "The official, audited Hedera bridge. Lock & mint to Ethereum and back.",
                color: "from-cyan-500 to-blue-500",
              },
              {
                name: "Stargate",
                sub: "LayerZero",
                chains: "15+ chains",
                desc: "Omnichain bridge with unified liquidity pools and instant finality.",
                color: "from-purple-600 to-violet-600",
              },
            ].map((b) => (
              <GlassCard key={b.name} className="p-5 md:p-6">
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${b.color} flex items-center justify-center mb-4`}
                >
                  <Globe className="w-5 h-5 text-white" />
                </div>
                <h4
                  className={`font-bold ${isDark ? "text-white" : "text-slate-900"}`}
                >
                  {b.name}
                </h4>
                <p
                  className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}
                >
                  {b.sub} &middot; {b.chains}
                </p>
                <p
                  className={`text-xs md:text-sm mt-3 leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  {b.desc}
                </p>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* ═══ DAO ═══ */}
        <Section id="dao" className="mb-16">
          <h2 className={h2}>DAO Governance</h2>
          <p className={subtitle}>
            Your tokens. Your vote. Verified on-chain.
          </p>

          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Voting Power
              </h4>
              <div className="space-y-3">
                <div
                  className={`flex items-center justify-between text-xs md:text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}
                >
                  <span>100M HBAR.ħ = 1 vote</span>
                  <span
                    className={`font-bold ${isDark ? "text-slate-500" : "text-gray-400"}`}
                  >
                    max 10
                  </span>
                </div>
                <div
                  className={`flex items-center justify-between text-xs md:text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}
                >
                  <span>3 VIP NFTs = 1 vote</span>
                  <span
                    className={`font-bold ${isDark ? "text-slate-500" : "text-gray-400"}`}
                  >
                    max 1
                  </span>
                </div>
                <div
                  className={`pt-3 border-t flex items-center justify-between text-sm font-bold ${isDark ? "border-white/[0.06] text-white" : "border-gray-100 text-slate-900"}`}
                >
                  <span>Maximum per wallet</span>
                  <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                    11 votes
                  </span>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Proposal Flow
              </h4>
              <div className="space-y-3">
                {[
                  {
                    step: "1",
                    label: "Submit proposal with title, description, and category",
                  },
                  {
                    step: "2",
                    label: "Community votes For or Against during the 3\u201314 day window",
                  },
                  {
                    step: "3",
                    label: "Auto-resolves as Passed or Rejected when time expires",
                  },
                ].map((s) => (
                  <div key={s.step} className="flex items-start gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        isDark
                          ? "bg-pink-500/20 text-pink-400"
                          : "bg-pink-50 text-pink-600"
                      }`}
                    >
                      {s.step}
                    </div>
                    <span
                      className={`text-xs md:text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>

          <GlassCard className="p-4 md:p-5" hover={false}>
            <p
              className={`text-xs md:text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
            >
              <span className="font-bold">Anti-whale design:</span> The 10-vote
              cap per wallet prevents any single holder from dominating
              governance, no matter how many tokens they own.
            </p>
          </GlassCard>
        </Section>

        {/* ═══ VIP ═══ */}
        <Section id="vip" className="mb-16">
          <h2 className={h2}>VIP System</h2>
          <p className={subtitle}>
            Premium features for committed community members.
          </p>

          <GlassCard
            className={`p-6 md:p-8 mb-4 border ${isDark ? "border-emerald-500/20" : "border-emerald-200"}`}
            hover={false}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                <Crown className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4
                  className={`font-bold ${isDark ? "text-white" : "text-slate-900"}`}
                >
                  Two paths to VIP
                </h4>
                <p
                  className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
                >
                  Either qualifies &mdash; you don't need both
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mb-6">
              <div
                className={`p-4 rounded-xl ${isDark ? "bg-white/[0.03] border border-white/[0.06]" : "bg-gray-50 border border-gray-100"}`}
              >
                <div className="text-xs font-bold text-emerald-400 mb-1">
                  Path A
                </div>
                <div
                  className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}
                >
                  Hold 100M+ HBAR.ħ
                </div>
              </div>
              <div
                className={`p-4 rounded-xl ${isDark ? "bg-white/[0.03] border border-white/[0.06]" : "bg-gray-50 border border-gray-100"}`}
              >
                <div className="text-xs font-bold text-emerald-400 mb-1">
                  Path B
                </div>
                <div
                  className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}
                >
                  Hold 1+ VIP NFT
                </div>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
              {[
                "Emerald theme",
                "Trading terminal",
                "VIP chat room",
                "Premium sound FX",
                "Prize spin wheel",
                "Iridescent glow",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span
                    className={`text-xs md:text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}
                  >
                    {f}
                  </span>
                </div>
              ))}
            </div>
          </GlassCard>
        </Section>

        {/* ═══ HBAR.ħ TOKEN ═══ */}
        <Section id="token" className="mb-16">
          <h2 className={h2}>HBAR.ħ Protocol Token</h2>
          <p className={subtitle}>
            The key to governance, VIP access, and pool creation.
          </p>

          <GlassCard className="p-6 md:p-8 mb-4" hover={false}>
            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              {[
                { l: "Token Standard", v: "Hedera Token Service (HTS)" },
                { l: "Token ID", v: "0.0.9356476" },
                { l: "Decimals", v: "8" },
                { l: "Network", v: "Hedera Mainnet" },
              ].map((row) => (
                <div key={row.l}>
                  <div
                    className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
                  >
                    {row.l}
                  </div>
                  <div
                    className={`text-sm font-bold font-mono ${isDark ? "text-white" : "text-slate-900"}`}
                  >
                    {row.v}
                  </div>
                </div>
              ))}
            </div>

            <div
              className={`border-t pt-5 ${isDark ? "border-white/[0.06]" : "border-gray-100"}`}
            >
              <h4
                className={`font-bold text-sm mb-4 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Token Utility
              </h4>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  {
                    t: "Governance Voting",
                    d: "100M tokens = 1 DAO vote, verified on-chain",
                  },
                  {
                    t: "VIP Access Gate",
                    d: "100M+ tokens unlock the premium feature suite",
                  },
                  {
                    t: "Pool Creation",
                    d: "Pay $50 in HBAR.ħ to create weighted pools (free for VIPs)",
                  },
                  {
                    t: "Protocol Fee Sink",
                    d: "Creation fees flow to the treasury",
                  },
                  {
                    t: "Liquidity Pairing",
                    d: "WHBAR/HBAR.ħ pool on SaucerSwap V1",
                  },
                  {
                    t: "NFT Alternative",
                    d: "VIP NFT holders get equivalent access",
                  },
                ].map((u) => (
                  <div key={u.t} className="flex items-start gap-2">
                    <Coins
                      className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isDark ? "text-pink-400" : "text-pink-500"}`}
                    />
                    <div>
                      <span
                        className={`text-xs md:text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}
                      >
                        {u.t}
                      </span>
                      <p
                        className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
                      >
                        {u.d}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        </Section>

        {/* ═══ SECURITY ═══ */}
        <Section id="security" className="mb-16">
          <h2 className={h2}>Security</h2>
          <p className={subtitle}>
            Institutional-grade protection. Your keys never leave your wallet.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            {[
              {
                icon: Lock,
                title: "Cryptographic Auth",
                desc: "Challenge-response protocol: the server proves you own your wallet without ever seeing your private key.",
              },
              {
                icon: Shield,
                title: "Rate Limiting",
                desc: "Multi-layer rate limiting on every endpoint to prevent abuse and DDoS attacks.",
              },
              {
                icon: Eye,
                title: "Input Hardening",
                desc: "Comprehensive validation and sanitization of all user inputs before processing.",
              },
              {
                icon: Layers,
                title: "Transport Security",
                desc: "CSP headers, HSTS, anti-clickjacking, restrictive permissions. No cookies \u2014 token-based auth only.",
              },
            ].map((s) => (
              <GlassCard key={s.title} className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <s.icon
                    className={`w-5 h-5 ${isDark ? "text-pink-400" : "text-pink-600"}`}
                  />
                  <h4
                    className={`font-bold text-sm ${isDark ? "text-white" : "text-slate-900"}`}
                  >
                    {s.title}
                  </h4>
                </div>
                <p
                  className={`text-xs md:text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  {s.desc}
                </p>
              </GlassCard>
            ))}
          </div>

          <GlassCard className="p-4 md:p-5 mt-3" hover={false}>
            <p
              className={`text-xs md:text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
            >
              <span className="font-bold">Non-custodial by design.</span>{" "}
              WRAPpDEX never holds, controls, or has access to your assets,
              private keys, or seed phrases. All transactions are signed by you
              in your own wallet.
            </p>
          </GlassCard>
        </Section>

        {/* ═══ ROADMAP ═══ */}
        <Section id="roadmap" className="mb-16">
          <h2 className={h2}>Roadmap</h2>
          <p className={subtitle}>Where we are and where we're heading.</p>

          <div className="grid sm:grid-cols-2 gap-3">
            <RoadmapQ
              quarter="Q1 2026"
              title="Foundation"
              icon={Rocket}
              current
              items={[
                "Production AMM with persistent state",
                "Multi-source oracle pipeline",
                "SaucerSwap swap integration",
                "Cryptographic authentication",
                "DAO governance with weighted voting",
                "VIP token-gated system",
                "Cross-chain bridges (3 protocols)",
                "Bonzo Finance lending integration",
                "Pro charting with 6 indicators",
                "Mobile-optimized responsive design",
              ]}
            />
            <RoadmapQ
              quarter="Q2 2026"
              title="Expansion"
              icon={Target}
              items={[
                "Formal smart contract audit",
                "HSuite SmartNode integration",
                "Native staking contracts",
                "HBAR.ħ lending market on Bonzo",
                "Limit order types",
                "Portfolio P&L analytics",
              ]}
            />
            <RoadmapQ
              quarter="Q3 2026"
              title="Scale"
              icon={Activity}
              items={[
                "Institutional API with WebSocket feeds",
                "Multi-sig treasury management",
                "Additional bridge integrations",
                "Automated yield strategies",
                "Mobile app",
              ]}
            />
            <RoadmapQ
              quarter="Q4 2026"
              title="Institutional"
              icon={Building2}
              items={[
                "Regulatory compliance framework",
                "Enterprise partnerships",
                "Cross-chain liquidity aggregation",
              ]}
            />
          </div>
        </Section>

        {/* ═══ TEAM ═══ */}
        <Section id="team" className="mb-16">
          <h2 className={h2}>Team</h2>
          <p className={subtitle}>
            The people building the future of DeFi on Hedera.
          </p>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <TeamCard
              name="Kyle"
              role="Founder"
              desc="Visionary leader in blockchain development and the architect behind the WRAPpDEX platform. Driving the future of decentralized finance on Hedera."
              accent="bg-gradient-to-br from-pink-500 to-purple-500"
              onClick={() => setFounderLetterOpen(true)}
            />
            <TeamCard
              name="Natalie"
              role="Chief Marketing Officer"
              desc="Leads brand strategy, growth marketing, and market positioning for WRAPpDEX and the HBAR.ħ ecosystem."
              accent="bg-gradient-to-br from-violet-500 to-pink-500"
              href="/branding"
            />
            <TeamCard
              name="Carlos"
              role="Community & Brand Ambassador"
              desc="Drives community engagement, moderates governance channels, and represents the HBAR.ħ brand across the Hedera ecosystem."
              accent="bg-gradient-to-br from-blue-500 to-cyan-500"
              onClick={() => setCommunityMessageOpen(true)}
            />
          </div>

          <button type="button" onClick={() => setEmrakDiagramsOpen(true)} className="text-left w-full">
            <GlassCard className="p-5 md:p-6 cursor-pointer">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold">
                  E
                </div>
                <div>
                  <h4
                    className={`font-bold ${isDark ? "text-white" : "text-slate-900"}`}
                  >
                    Emrak
                  </h4>
                  <p
                    className={`text-xs bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent font-semibold`}
                  >
                    Team Advisor
                  </p>
                </div>
              </div>
              <p
                className={`text-xs md:text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
              >
                Provides strategic advisory on protocol direction, ecosystem
                development, and partnership opportunities.
              </p>
            </GlassCard>
          </button>
        </Section>

        {/* ═══ PARTNERS ═══ */}
        <Section id="partners" className="mb-16">
          <h2 className={h2}>Technology Partners</h2>
          <p className={subtitle}>
            Live production integrations &mdash; not "partnerships in
            negotiation."
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {[
              { name: "SaucerSwap", desc: "Primary DEX", color: "from-green-500 to-emerald-500" },
              { name: "Chainlink", desc: "Oracle feeds", color: "from-blue-600 to-blue-500" },
              { name: "HSuite", desc: "DEX aggregation", color: "from-yellow-500 to-amber-500" },
              { name: "Bonzo Finance", desc: "Lending/borrowing", color: "from-purple-500 to-violet-500" },
              { name: "HashPort", desc: "Hedera bridge", color: "from-cyan-500 to-blue-500" },
              { name: "Squid", desc: "60+ chains", color: "from-indigo-600 to-blue-600" },
              { name: "Stargate", desc: "LayerZero bridge", color: "from-purple-600 to-indigo-600" },
              { name: "ChangeNOW", desc: "Fiat on-ramp", color: "from-lime-500 to-green-500" },
              { name: "WalletConnect", desc: "Wallet comms", color: "from-blue-500 to-sky-500" },
              { name: "Dynamic", desc: "Multi-wallet SDK", color: "from-violet-500 to-purple-500" },
              { name: "Hedera", desc: "Mainnet", color: "from-slate-600 to-slate-500" },
              { name: "Supabase", desc: "Edge infrastructure", color: "from-emerald-600 to-green-600" },
            ].map((p) => (
              <GlassCard key={p.name} className="p-4 text-center">
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center mx-auto mb-3 text-white font-bold text-sm`}
                >
                  {p.name.charAt(0)}
                </div>
                <div
                  className={`text-xs md:text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}
                >
                  {p.name}
                </div>
                <div
                  className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
                >
                  {p.desc}
                </div>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* ═══ REVENUE MODEL ═══ */}
        <Section className="mb-16">
          <h2 className={h2}>Revenue Model</h2>
          <p className={subtitle}>
            Multiple streams. Sustainable growth.
          </p>

          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            {[
              {
                title: "AMM Swap Fees",
                desc: "0.10% (10 bps) per swap, fixed across all pools. Stays in the pool and accrues to liquidity providers.",
              },
              {
                title: "Protocol Micro-Fee",
                desc: "$0.0007 flat per swap in HBAR. Split 50/50 between LP rewards and the protocol treasury.",
              },
              {
                title: "Pool Creation Fees",
                desc: "$50 in HBAR.ħ per weighted pool for non-VIP users.",
              },
              {
                title: "Fiat On-Ramp Affiliate",
                desc: "Partner referral revenue from ChangeNOW fiat transactions.",
              },
            ].map((r) => (
              <GlassCard key={r.title} className="p-5">
                <h4
                  className={`font-bold text-sm mb-2 ${isDark ? "text-white" : "text-slate-900"}`}
                >
                  {r.title}
                </h4>
                <p
                  className={`text-xs md:text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  {r.desc}
                </p>
              </GlassCard>
            ))}
          </div>

          <GlassCard className="p-5 md:p-6" hover={false}>
            <p
              className={`text-xs md:text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
            >
              <span className="font-bold">Conservative projection:</span> At
              $5M daily volume across all pools, the 0.10% in-pool fee
              generates $5,000/day for LPs. The flat $0.0007 protocol
              micro-fee at 50,000 daily swaps yields ~$35/day for the
              treasury. Pool creation fees and fiat affiliate revenue
              layer on top as the user base scales.
            </p>
          </GlassCard>
        </Section>

        {/* ═══ CTA ═══ */}
        <Section className="mb-16">
          <GlassCard
            className="p-8 md:p-12 text-center relative overflow-hidden"
            hover={false}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-pink-500/5 to-purple-500/5" />
            <div className="relative">
              <h2
                className={`text-2xl md:text-3xl font-bold mb-4 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Ready to trade smarter?
              </h2>
              <p
                className={`text-sm md:text-base mb-8 max-w-lg mx-auto ${isDark ? "text-slate-400" : "text-gray-500"}`}
              >
                Connect your wallet and experience DeFi the way it should be
                &mdash; fast, fair, and transparent.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link
                  to="/"
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold text-sm hover:opacity-90 transition-opacity"
                >
                  Launch App
                </Link>
                <a
                  href="https://discord.gg/ZFnfRFxQZ"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`px-6 py-3 rounded-xl font-bold text-sm border transition-colors inline-flex items-center gap-2 ${
                    isDark
                      ? "border-white/[0.12] text-white hover:bg-white/[0.05]"
                      : "border-gray-200 text-slate-900 hover:bg-gray-50"
                  }`}
                >
                  Join Discord
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </GlassCard>
        </Section>

        {/* ═══ FOOTER ═══ */}
        <div
          className={`text-center py-8 border-t ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}
        >
          <p
            className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}
          >
            &copy; 2026 HBAR.ħ Protocol. All rights reserved.
          </p>
          <p
            className={`text-xs mt-2 ${isDark ? "text-slate-600" : "text-gray-400"}`}
          >
            WRAPpDEX is a Wyoming DUNA &middot;{" "}
            <Link
              to="/terms"
              className={`underline underline-offset-2 ${isDark ? "hover:text-slate-400" : "hover:text-gray-600"}`}
            >
              Terms
            </Link>{" "}
            &middot;{" "}
            <Link
              to="/privacy"
              className={`underline underline-offset-2 ${isDark ? "hover:text-slate-400" : "hover:text-gray-600"}`}
            >
              Privacy
            </Link>
          </p>
        </div>
      </div>

      {/* Founder Letter Modal — triggered by clicking Kyle's TeamCard */}
      <FounderLetter open={founderLetterOpen} onClose={() => setFounderLetterOpen(false)} />

      {/* Community Message Modal — triggered by clicking Carlos's TeamCard */}
      <CommunityMessage open={communityMessageOpen} onClose={() => setCommunityMessageOpen(false)} />

      {/* Emrak Architecture Diagrams — triggered by clicking Emrak's card */}
      <EmrakDiagrams open={emrakDiagramsOpen} onClose={() => setEmrakDiagramsOpen(false)} />
    </div>
  );
}

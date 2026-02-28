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
  AlertCircle,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { FounderLetter } from "./FounderLetter";
import { CommunityMessage } from "./CommunityMessage";
import { EmrakDiagrams } from "./EmrakDiagrams";
import { ExecutiveBriefcase, BriefcaseTrigger } from "./ExecutiveBriefcase";
import { useWallet } from "../contexts/WalletContext";
import { isVipEligible } from "../utils/vip";

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
        className={`text-2xl md:text-3xl font-bold ${
          isDark
            ? "bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent"
            : "text-purple-700"
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
  items: (string | { text: string; status?: "processing" })[];
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
        {items.map((raw) => {
          const item = typeof raw === "string" ? { text: raw } : raw;
          const isProcessing = item.status === "processing";
          return (
            <li key={item.text} className="flex items-start gap-2">
              {isProcessing ? (
                <Clock
                  className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400"
                />
              ) : (
                <CheckCircle2
                  className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                    current
                      ? "text-emerald-400"
                      : isDark
                        ? "text-slate-600"
                        : "text-gray-300"
                  }`}
                />
              )}
              <span
                className={`text-xs md:text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}
              >
                {item.text}
                {isProcessing && (
                  <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-500 border border-amber-400/25">
                    Processing
                  </span>
                )}
              </span>
            </li>
          );
        })}
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
  const [briefcaseOpen, setBriefcaseOpen] = useState(false);
  const { hashPackSession, hederaAccount, hederaNetwork } = useWallet();
  const isVip = isVipEligible(hederaAccount?.tokens ?? [], hederaNetwork);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  /* ── Intersection observer for TOC highlighting ── */
  useEffect(() => {
    const ids = [
      "intro",
      "why-hedera",
      "legal",
      "features",
      "swap-flow",
      "oracles",
      "amm",
      "v2-liquidity",
      "bridges",
      "dao",
      "vip",
      "token",
      "security",
      "revenue",
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
    { id: "legal", label: "Legal Structure" },
    { id: "features", label: "Features" },
    { id: "swap-flow", label: "How Swaps Work" },
    { id: "oracles", label: "Price Oracles" },
    { id: "amm", label: "AMM Engine" },
    { id: "v2-liquidity", label: "V2 Concentrated Liquidity" },
    { id: "bridges", label: "Bridges" },
    { id: "dao", label: "Governance" },
    { id: "vip", label: "VIP System" },
    { id: "token", label: "HBAR.ħ Token" },
    { id: "security", label: "Security" },
    { id: "revenue", label: "Revenue Model" },
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
          to="/markets"
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
                Version 2.1 &middot; February 2026
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
            V2 concentrated liquidity, lending, bridging, and governance &mdash; built on the fastest
            enterprise-grade public ledger with scam token protection. Structured as a Wyoming DUNA for
            regulatory clarity from day one.
          </p>

          {/* Hero stats */}
          <div className="flex flex-wrap gap-8 md:gap-12 mt-10">
            <StatBadge value="10,000+" label="Transactions / sec" />
            <StatBadge value="~2s" label="Finality" />
            <StatBadge value="~$0.0001" label="Per transaction" />
            <StatBadge value="0" label="MEV / Front-running" />
            <StatBadge value="DUNA" label="Wyoming Legal Entity" />
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
              WRAPpDEX is a decentralized exchange built natively on Hedera
              and structured as a Wyoming DUNA (Decentralized Unincorporated
              Nonprofit Association). It combines token swapping,
              professional-grade trading charts, SaucerSwap V2 concentrated liquidity pools, lending
              &amp; borrowing, cross-chain bridges, a fiat on-ramp, DEX
              aggregation, and community governance into a single platform with 
              active scam token protection.
            </p>
            <p className={`${prose} mb-4`}>
              No account registration. No custody of your assets. Connect your
              wallet, and you're in. Every transaction settles on Hedera's
              hashgraph with sub-cent fees and provable finality in seconds
              &mdash; not minutes, not hours.
            </p>
            <p className={prose}>
              The protocol features both V1 constant-product AMM and full 
              SaucerSwap V2 integration for concentrated liquidity with 
              custom price ranges, Hedera-native atomic CryptoTransfer settlement (zero MEV,
              zero front-running), a 4-tier oracle pipeline backed by
              Chainlink decentralized feeds, a dual-layer fee model 17%
              cheaper than competitors, active scam token blocklist (2 fake tokens blocked),
              and full DAO governance where every proposal vote carries real legal weight under Wyoming law.
            </p>
          </GlassCard>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { v: "18", l: "Price Feeds" },
              { v: "13", l: "V1 AMM Tokens" },
              { v: "V2", l: "Concentrated Liquidity" },
              { v: "60+", l: "Bridge Chains" },
              { v: "10", l: "Chart Timeframes" },
              { v: "2", l: "Scam Tokens Blocked" },
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

        {/* ═══ LEGAL STRUCTURE ═══ */}
        <Section id="legal" className="mb-16">
          <h2 className={h2}>
            Wyoming DUNA
            <span className="ml-3 inline-flex items-center gap-1.5 align-middle px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-500 border border-amber-400/25">
              <Clock className="w-3 h-3" />
              Processing
            </span>
          </h2>
          <p className={subtitle}>
            The first DEX structured as a Decentralized Unincorporated
            Nonprofit Association under Wyoming law.
          </p>

          <GlassCard className="p-6 md:p-8 mb-4" hover={false}>
            <p className={`${prose} mb-4`}>
              WRAPpDEX operates as a Wyoming DUNA &mdash; a legal entity class
              created by Wyoming statute (W.S. 17-32) specifically for DAOs
              and decentralized protocols. This structure provides
              limited-liability protection for DAO members and token holders
              while preserving the permissionless, non-custodial nature of the
              protocol.
            </p>
            <p className={prose}>
              Unlike offshore foundations or anonymous teams, the DUNA
              structure anchors WRAPpDEX in a clear legal jurisdiction with
              established corporate law, giving investors, liquidity providers,
              and institutional partners confidence that the protocol operates
              within a recognized regulatory framework. DAO proposals can bind
              the entity &mdash; governance votes have real legal weight.
            </p>
          </GlassCard>

          <div className="grid sm:grid-cols-3 gap-3">
            {[
              {
                icon: Shield,
                title: "Limited Liability",
                desc: "DAO members and token holders are shielded from personal liability for protocol operations under Wyoming statute.",
              },
              {
                icon: Vote,
                title: "Binding Governance",
                desc: "DAO proposals adopted through on-chain voting carry legal authority over the entity's operations and treasury.",
              },
              {
                icon: Building2,
                title: "Institutional Ready",
                desc: "A U.S.-domiciled legal entity with established banking and compliance pathways for enterprise partnerships.",
              },
            ].map((item) => (
              <GlassCard key={item.title} className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <item.icon
                    className={`w-5 h-5 ${isDark ? "text-pink-400" : "text-pink-600"}`}
                  />
                  <h4
                    className={`font-bold text-sm ${isDark ? "text-white" : "text-slate-900"}`}
                  >
                    {item.title}
                  </h4>
                </div>
                <p
                  className={`text-xs md:text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  {item.desc}
                </p>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* ═══ FEATURES ═══ */}
        <Section id="features" className="mb-16">
          <h2 className={h2}>Platform Features</h2>
          <p className={subtitle}>Ten modules. One interface. Zero compromise.</p>

          <div className="grid sm:grid-cols-2 gap-3">
            {[
              {
                icon: TrendingUp,
                title: "Markets",
                desc: "Live dashboards with 18 asset tickers, Fear & Greed Index, RSI gauges, BTC dominance, crypto heatmap, news ticker, sparkline charts, and real-time site activity feed.",
                color: "from-blue-500 to-cyan-500",
              },
              {
                icon: BarChart3,
                title: "Trading Terminal",
                desc: "Pro-grade candlestick and line charts with 10 timeframes (1m to All), 6 technical indicators (SMA, EMA, Bollinger Bands, RSI, MACD), sub-cent price granularity, persistent drawing tools, and a live watchlist.",
                color: "from-purple-500 to-pink-500",
              },
              {
                icon: ArrowRightLeft,
                title: "Swap",
                desc: "Hedera-native atomic CryptoTransfer swaps with client-side AMM math, direct + USDC-hop smart routing, and SaucerSwap integration. Configurable slippage, route visualization, and auto-refreshing quotes.",
                color: "from-pink-500 to-rose-500",
              },
              {
                icon: DollarSign,
                title: "Buy / Sell",
                desc: "Fiat on-ramp via ChangeNOW with 100+ supported currencies, plus a CEX-style trade panel for familiar order-book-style interactions.",
                color: "from-emerald-500 to-teal-500",
              },
              {
                icon: Layers,
                title: "DeFi Suite",
                desc: "V1 constant-product AMM with 13 whitelisted tokens including WBTC, WETH, USDC, USDT, LINK, AAVE, DAI, WBNB, and WAVAX. Full SaucerSwap V2 concentrated liquidity integration (add/remove positions, custom price ranges, fee collection). Bonzo Finance lending/borrowing (Aave V2 on Hedera), and smart routing with USDC-hop discovery.",
                color: "from-amber-500 to-orange-500",
              },
              {
                icon: Vote,
                title: "DAO Governance",
                desc: "Create and vote on proposals. Voting power from HBAR.ħ tokens, VIP NFTs, and LP positions — verified on-chain via Mirror Node.",
                color: "from-violet-500 to-indigo-500",
              },
              {
                icon: Globe,
                title: "Cross-Chain Bridges",
                desc: "Three bridge protocols: Squid (60+ chains), HashPort (Hedera official), and Stargate (LayerZero).",
                color: "from-cyan-500 to-blue-500",
              },
              {
                icon: Activity,
                title: "1inch Aggregation",
                desc: "Cross-chain DEX aggregation via 1inch API with circuit-breaker protection. Access deep EVM liquidity from inside the Hedera interface.",
                color: "from-red-500 to-orange-500",
              },
              {
                icon: Users,
                title: "Live Activity Feed",
                desc: "Anonymized real-time swap feed, swap history per wallet, site-wide health monitoring, and infrastructure circuit-breaker dashboards.",
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
                    0.25% fee
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
                The client-side smart router evaluates direct and USDC-hop paths
                across all active pools. HBAR/WHBAR wraps are always 1:1, zero fee.
              </p>
            </div>
          </GlassCard>
        </Section>

        {/* ═══ ORACLE PIPELINE ═══ */}
        <Section id="oracles" className="mb-16">
          <h2 className={h2}>Price Oracle Pipeline</h2>
          <p className={subtitle}>
            Four tiers of price data with circuit-breaker protection. Every price shows its source.
          </p>

          <div className="grid gap-3">
            <OracleTier
              tier="T1"
              name="Chainlink Decentralized Oracles"
              desc="On-chain price feeds from Ethereum via batch JSON-RPC. 19 feeds (including AAVE and DAI) read in a single HTTP request across 5 redundant RPC endpoints. The gold standard for tamper-proof price data."
              color=""
              dotColor="bg-blue-500"
            />
            <OracleTier
              tier="T2"
              name="Binance Market Data"
              desc="Primary market data from the world's most liquid exchange. Bulk ticker API returns price, 24h change, and volume for 18 tokens in a single request (~200ms). Also powers the 4-source chart kline waterfall."
              color=""
              dotColor="bg-yellow-500"
            />
            <OracleTier
              tier="T3"
              name="CoinCap + CoinGecko"
              desc="CoinCap provides extended chart history (up to 5 years for the All timeframe) with adaptive interval selection. CoinGecko enriches market cap data and covers tokens not on Binance (EURC, PAXG). Global market stats and Top 20 composite index data."
              color=""
              dotColor="bg-green-500"
            />
            <OracleTier
              tier="T4"
              name="SaucerSwap Oracle (Server-Side)"
              desc="The AMM server fetches live token prices from SaucerSwap's API with auto-path discovery (/tokens, /v1/tokens, /v2/tokens). Used for pool TVL calculations, depth caps, and volume tracking. Protected by a dedicated circuit breaker with 30s cooldown."
              color=""
              dotColor="bg-purple-500"
            />
          </div>

          <GlassCard className="p-5 mt-3" hover={false}>
            <h4
              className={`font-bold text-xs mb-2 ${isDark ? "text-white" : "text-slate-900"}`}
            >
              Chart Data Pipeline (4-Source Waterfall)
            </h4>
            <p
              className={`text-xs leading-relaxed mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}
            >
              Every trading chart is powered by a cascading 4-source waterfall: Binance
              klines (primary) &rarr; CoinGecko OHLC &rarr; CoinCap history &rarr;
              deterministic synthetic fallback. Each source has per-timeframe
              configs (interval, limit, days) and adaptive cache TTL (30s for 1m
              charts, 5 min for 1Y). The synthetic fallback uses a seeded PRNG
              for reproducible candles across page reloads.
            </p>
          </GlassCard>

          <GlassCard className="p-5 mt-3" hover={false}>
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`text-xs font-bold ${isDark ? "text-slate-500" : "text-gray-400"}`}
              >
                UI Badges:
              </span>
              {[
                { c: "bg-blue-500", l: "Chainlink" },
                { c: "bg-yellow-500", l: "Binance" },
                { c: "bg-green-500", l: "CoinGecko" },
                { c: "bg-purple-500", l: "SaucerSwap" },
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
            Dual AMM architecture: V1 constant-product + V2 concentrated liquidity &mdash; front-running eliminated by design.
          </p>
          <p
            className={`text-xs md:text-sm leading-relaxed mb-6 max-w-3xl ${isDark ? "text-slate-400" : "text-gray-500"}`}
          >
            WRAPpDEX offers two complementary liquidity strategies. <strong>V1 pools</strong> use
            the battle-tested constant-product formula (x × y = k) for passive liquidity across
            all price ranges &mdash; ideal for blue-chip pairs and long-term LPs. <strong>V2 pools</strong>{" "}
            leverage SaucerSwap's concentrated liquidity engine, allowing LPs to provide capital
            within custom price ranges for dramatically higher capital efficiency and fee earnings
            (up to 4000x vs. V1 for narrow ranges). Every swap on both systems settles as a single
            atomic CryptoTransfer containing both token legs. AMM math runs client-side in BigInt,
            and the server acts as a signing oracle that independently validates the math and
            co-signs the pool side. There is no mempool to snipe, no block producer who can reorder
            your transaction, and no MEV leakage. The server re-reads reserves from Mirror Node and
            recomputes the expected output before co-signing &mdash; if client and server disagree
            by more than 1 raw unit, the transaction is rejected. A post-swap k-invariant assertion
            guarantees that reserves can never decrease.
          </p>

          {/* Token Whitelist Callout */}
          <GlassCard className="p-5 mb-6" hover={false}>
            <h4
              className={`font-bold text-xs mb-2 ${isDark ? "text-white" : "text-slate-900"}`}
            >
              Whitelisted AMM Tokens (13 Total)
            </h4>
            <div className="flex flex-wrap gap-2 mb-2">
              {[
                { s: "WHBAR", d: "8 dec", b: "Native" },
                { s: "USDC", d: "6 dec", b: "Circle" },
                { s: "USDT", d: "6 dec", b: "Tether" },
                { s: "DAI", d: "8 dec", b: "HashPort" },
                { s: "USDCh", d: "6 dec", b: "HashPort" },
                { s: "USDTh", d: "6 dec", b: "HashPort" },
                { s: "WBTC", d: "8 dec", b: "HashPort" },
                { s: "WETH", d: "18 dec", b: "HashPort" },
                { s: "LINK", d: "8 dec", b: "HashPort" },
                { s: "AAVE", d: "8 dec", b: "HashPort" },
                { s: "WBNB", d: "8 dec", b: "LayerZero" },
                { s: "WAVAX", d: "8 dec", b: "LayerZero" },
                { s: "WMATIC", d: "8 dec", b: "HashPort" },
              ].map((t) => (
                <span
                  key={t.s}
                  className={`text-xs px-2.5 py-1 rounded-lg font-mono font-semibold ${isDark ? "bg-white/[0.05] text-slate-300 border border-white/[0.08]" : "bg-gray-50 text-slate-700 border border-gray-200"}`}
                >
                  {t.s}{" "}
                  <span className={`font-normal ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {t.d} &middot; {t.b}
                  </span>
                </span>
              ))}
            </div>
            <p
              className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
            >
              Pool reserves are the actual on-chain token balances of dedicated
              Hedera accounts, read via Mirror Node REST API. All AMM math uses
              BigInt arithmetic to prevent IEEE 754 floating-point drift. Only
              whitelisted assets can be used in pools &mdash; pool creation is
              restricted to vetted tokens for security.
            </p>
          </GlassCard>

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
                . When you submit a swap, the client reads pool reserves
                from Mirror Node and calculates your exact output using
                BigInt math. A{" "}
                <span className={`font-semibold ${isDark ? "text-pink-400" : "text-pink-600"}`}>0.25&nbsp;%</span>{" "}
                swap fee stays entirely in pool reserves (increasing{" "}
                <span className="font-mono">k</span> for LP holders).
                The protocol&rsquo;s{" "}
                <span className={`font-semibold ${isDark ? "text-amber-400" : "text-amber-600"}`}>0.05&nbsp;%</span>{" "}
                share is tracked per pool and extractable by DAO
                governance. The server validates the math independently
                and co-signs the pool side. Your wallet signs and submits
                the atomic CryptoTransfer &mdash; both token legs settle
                together at Hedera consensus.
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
                  The 0.25&nbsp;% swap fee is applied first: 1,000 &times;
                  0.9975 ={" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>997.5 HBAR</span>{" "}
                  enters the pricing formula. All 2.5 HBAR of fee value stays
                  in pool reserves (increasing{" "}
                  <span className="font-mono">k</span> for LPs). The protocol&rsquo;s
                  0.05&nbsp;% share ({" "}
                  <span className={`font-semibold ${isDark ? "text-amber-400" : "text-amber-600"}`}>0.5 HBAR</span>
                  ) is tracked in a per-pool accumulator and extractable by the
                  DAO &mdash; until extraction, LPs earn the full 0.25&nbsp;%.
                </li>
                <li>
                  The engine applies{" "}
                  <span className={`font-mono font-bold ${isDark ? "text-pink-400" : "text-pink-600"}`}>x &times; y = k</span>:{" "}
                  (997.5 &times; 50,000) / (500,000 + 997.5) ={" "}
                  <span className={`font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>~99.50 USDC</span>.
                </li>
                <li>
                  Your slippage tolerance is checked. At 0.5&nbsp;%, you
                  need at least 99.00 USDC &mdash; the quote passes.
                </li>
                <li>
                  A flat micro-fee of{" "}
                  <span className={`font-semibold ${isDark ? "text-amber-400" : "text-amber-600"}`}>$0.0007</span>{" "}
                  (~2.5 tinybar) is assessed separately in HBAR &mdash;
                  split 50/50 between LP rewards and the protocol treasury.
                </li>
                <li>
                  The swap settles atomically. Pool balances update to
                  501,000 HBAR / 49,900.50 USDC. A post-swap k-invariant
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

          {/* Fee Structure */}
          <h4
            className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
          >
            Fee Structure
          </h4>
          <p
            className={`text-xs md:text-sm leading-relaxed mb-4 max-w-3xl ${isDark ? "text-slate-400" : "text-gray-500"}`}
          >
            WRAPpDEX uses a dual-layer fee model: a 0.25&nbsp;% swap fee
            that stays entirely in pool reserves (benefiting LPs), plus a flat
            $0.0007 micro-fee that prevents trade-splitting manipulation.
            The protocol&rsquo;s 0.05&nbsp;% share is tracked per pool and
            extractable by DAO governance. Total cost to the trader:
            0.25&nbsp;% + $0.0007 &mdash; 17&nbsp;% cheaper than
            SaucerSwap&rsquo;s 0.30&nbsp;%.
          </p>
          <div className="grid md:grid-cols-3 gap-3 mb-4">
            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-2 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Swap Fee (All to Pool)
              </h4>
              <p className="text-2xl font-bold mb-1 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                0.25%
              </p>
              <p
                className={`text-xs leading-relaxed ${isDark ? "text-slate-500" : "text-gray-400"}`}
              >
                The full 25 bps stays in pool reserves, increasing{" "}
                <span className="font-mono">k</span> and benefiting all LP
                holders. The protocol&rsquo;s 5 bps share is tracked
                separately and extractable &mdash; until then, LPs earn
                the full 0.25&nbsp;%.
              </p>
            </GlassCard>
            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-2 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Protocol Fee
              </h4>
              <p className="text-2xl font-bold mb-1 bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                0.05%
              </p>
              <p
                className={`text-xs leading-relaxed ${isDark ? "text-slate-500" : "text-gray-400"}`}
              >
                5 bps of the 25 bps total is the protocol&rsquo;s share,
                tracked per pool in a dedicated accumulator. Extraction
                deducts from reserves and credits treasury (0.0.9695738).
                Plus a flat $0.0007 micro-fee per swap in HBAR (50/50
                LP / treasury). DAO-adjustable.
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
                Every swap is a single Hedera CryptoTransfer containing
                both token legs. Settlement is atomic &mdash; both sides
                execute at consensus or neither does, with aBFT finality
                in ~2&nbsp;seconds. No pending transactions in a public
                mempool. The AMM includes an owner-only kill switch for
                emergency halts &mdash; LP withdrawals always remain open.
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
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>Atomic settlement</span>{" "}
                  &mdash; every swap is a single CryptoTransfer. Both token
                  legs settle at Hedera consensus or neither does. No public
                  transaction queue exists.
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
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>Server-side reserve validation</span>{" "}
                  &mdash; the signing oracle independently re-reads pool
                  account balances from Mirror Node and recomputes the
                  expected output. If client and server math disagree by
                  more than 1 raw unit (rounding), co-signing is refused.
                </li>
                <li>
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>Circuit breaker &amp; kill switch</span>{" "}
                  &mdash; an owner-only kill switch can halt all swaps and new
                  deposits instantly. LP withdrawals always remain available
                  so users can exit at any time. Service-level circuit
                  breakers (SaucerSwap, Mirror Node, CoinGecko, 1inch)
                  prevent cascading failures during outages.
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
              degenerate configurations. The fixed 0.25&nbsp;% swap fee
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

        {/* ═══ V2 CONCENTRATED LIQUIDITY ═══ */}
        <Section id="v2-liquidity" className="mb-16">
          <h2 className={h2}>V2 Concentrated Liquidity</h2>
          <p className={subtitle}>
            SaucerSwap V2 integration — up to 4000x capital efficiency vs. V1.
          </p>

          <GlassCard className="p-6 md:p-8 mb-6" hover={false}>
            <p className={`${prose} mb-4`}>
              Unlike V1 pools that spread liquidity across all prices (0 to ∞), V2 concentrated 
              liquidity lets you deploy capital within a custom price range. If you believe 
              HBAR/USDC will trade between $0.08 and $0.12, you can concentrate 100% of your 
              capital in that zone — earning potentially 10-40x more fees than a V1 LP providing 
              the same liquidity across all prices. The tradeoff: if price exits your range, 
              you earn zero fees until it returns (but you never lose your principal).
            </p>
            <p className={prose}>
              WRAPpDEX provides a full V2 management suite: add liquidity with preset ranges 
              (Narrow ±5%, Medium ±10%, Wide ±25%) or custom percentages, remove liquidity 
              (partial or full), collect accumulated fees, and view all positions with real-time 
              in-range status indicators. Token association is handled automatically. V2 operations 
              are restricted to blue-chip whitelisted tokens (WHBAR, USDC, USDT, WETH, WBTC, LINK, AAVE)
              for security.
            </p>
          </GlassCard>

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
                V2 pools use Uniswap V3-style tick-based math. Each position is an NFT 
                representing your custom price range (tickLower to tickUpper). As swaps occur, 
                you earn a proportional share of the 0.30% fee <strong>only when price is inside 
                your range</strong>. Capital efficiency formula: 1 / (tickUpper - tickLower). A 
                ±5% range around current price provides ~20x the capital efficiency of V1's 
                infinite range. Narrower = higher multiplier, but also higher risk of going 
                out-of-range.
              </p>
            </GlassCard>

            <GlassCard className="p-5 md:p-6">
              <h4
                className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Position Management
              </h4>
              <p
                className={`text-xs md:text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}
              >
                The DeFi page shows all your V2 positions with current price, your range bounds, 
                in-range status (green dot = earning fees, amber = out-of-range), and claimable 
                fees. "Add Liquidity" opens the V2 modal with balance resolution, quick-fill 
                buttons (25%/50%/Max), and real-time validation. "Remove Liquidity" lets you 
                withdraw partial (25%/50%/75%) or full amounts. "Collect Fees" claims accumulated 
                earnings without closing the position. All operations require HashPack signature 
                via ContractExecuteTransaction.
              </p>
            </GlassCard>
          </div>

          {/* Security Callout */}
          <GlassCard className="p-5" hover={false}>
            <div className="flex items-start gap-3">
              <Shield className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
              <div>
                <h4 className={`font-bold text-sm mb-1 ${isDark ? "text-white" : "text-slate-900"}`}>
                  Blue-Chip Token Restriction
                </h4>
                <p className={`text-xs leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  V2 liquidity operations are restricted to 7 whitelisted tokens (WHBAR, USDC, USDT, 
                  WETH, WBTC, LINK, AAVE) to prevent scam token exposure. Only verified bridge tokens 
                  from HashPort are permitted. This whitelist is independent of V1's 13-token AMM list.
                </p>
              </div>
            </div>
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
                    label: "Community votes For or Against during the 1\u201330 day window (8 categories: Fees, Staking, Listing, Tokenomics, Features, Partnership, Governance, Other)",
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
              <span className="font-bold">Anti-whale &amp; anti-escalation design:</span> The 10-vote
              cap per wallet prevents any single holder from dominating
              governance. Admin list management is restricted to the protocol
              owner (0.0.518487) with fresh-session verification (&lt;2 min),
              preventing compromised admins from adding hostile accounts.
              The founder account is permanently protected from removal.
              Per-proposal locks ensure votes on one proposal never block
              activity on another.
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
                "DAO governance voting",
                "Proposal commenting",
                "VIP chat room",
                "Prize spin wheel",
                "Emerald theme",
                "Trading terminal",
                "Premium sound FX",
                "Iridescent glow",
                "Free pool creation",
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
                title: "ED25519 Challenge-Response Auth",
                desc: "CSPRNG nonce challenge with 5-min TTL, delete-before-verify replay protection, 4-strategy signature extraction (hex, base64, protobuf, sliding window), and single-session-per-account enforcement.",
              },
              {
                icon: Shield,
                title: "Circuit Breakers",
                desc: "3-state circuit breakers (Closed/Open/Half-Open) protect every external service: SaucerSwap, Mirror Node, CoinGecko, 1inch. Prevents cascading failures and connection pool saturation during outages.",
              },
              {
                icon: Activity,
                title: "Distributed Locking",
                desc: "Server-side signing lock with double-verify pattern. The signing oracle re-reads reserves from Mirror Node inside the lock window, ensuring concurrent swap requests are validated against fresh on-chain state.",
              },
              {
                icon: Eye,
                title: "Input Hardening",
                desc: "BigInt-safe amount parsing via string manipulation (no IEEE 754 loss), zero-width character stripping, bidi-override filtering, combining diacritical defense, and 512KB body size limits.",
              },
              {
                icon: Layers,
                title: "Transport Security",
                desc: "CSP default-src 'none', HSTS with includeSubDomains, X-Frame-Options DENY, Permissions-Policy, and no cookies. Token-based auth only.",
              },
              {
                icon: Target,
                title: "Rate Limiting & Depth Caps",
                desc: "In-memory rate limiting with depth-proportional swap caps: 2% for small pools (<$10K TVL), 5% mid-size, 10% large. The server re-reads on-chain reserves before co-signing. Low-TVL pools excluded from routing.",
              },
              {
                icon: AlertCircle,
                title: "Scam Token Blocklist",
                desc: "Active blocklist protects users from fake tokens with similar names to legitimate assets. Currently blocking 2 scam tokens (fake WBTC 0.0.10104132, fake LINK 0.0.10152778). Validated via low liquidity (<$10K) and astronomical fake balances. Hard-blocked at all swap/liquidity layers.",
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
              in your own wallet. Every administrative action is written to a
              500-entry append-only audit trail. The AMM includes an owner-only
              kill switch for emergency halts &mdash; LP withdrawals always
              remain available so users can exit at any time, even during a
              protocol-wide pause.
            </p>
          </GlassCard>
        </Section>

        {/* ═══ REVENUE MODEL ═══ */}
        <Section id="revenue" className="mb-16">
          <h2 className={h2}>Revenue Model</h2>
          <p className={subtitle}>
            Five revenue streams. Fully DAO-governed. Sustainable from day one.
          </p>

          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            {[
              {
                title: "1. LP Swap Fee (0.25% — all to pool)",
                desc: "The full 25 bps stays in pool reserves on every swap, compounding k for LP holders. This is the primary incentive for liquidity providers — competitive with Uniswap V2 (0.30%) while being 17% cheaper for traders.",
              },
              {
                title: "2. Protocol Share (0.05% extractable)",
                desc: "5 bps of every swap is tracked per pool in a dedicated accumulator. The DAO votes on extraction timing. Until extracted, LPs earn the full 0.25%. Extraction deducts from reserves and credits the treasury (0.0.9695738).",
              },
              {
                title: "3. Flat Micro-Fee ($0.0007 per swap)",
                desc: "A flat $0.0007 fee in HBAR assessed on every swap, split 50/50 between LP rewards and protocol treasury. Flat (not proportional) to prevent trade-splitting manipulation. Clamped to a safety ceiling of 500K tinybar.",
              },
              {
                title: "4. Pool Creation Fees",
                desc: "$50 in HBAR.ħ per weighted pool for non-VIP users. VIP holders (100M+ HBAR.ħ or VIP NFT) create pools free. Creation fees flow to the protocol treasury as a deflationary token sink.",
              },
              {
                title: "5. Affiliate & Bridge Revenue",
                desc: "ChangeNOW fiat on-ramp referral commissions, plus potential cross-chain bridge affiliate revenue from Squid (Axelar) and Stargate (LayerZero) integrations as volume scales.",
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
              <span className="font-bold">Revenue projections at scale:</span>
            </p>
            <div className={`grid sm:grid-cols-3 gap-3 mt-3 mb-3`}>
              {[
                { vol: "$100K/day", lp: "$250/day", protocol: "$50/day", annual: "~$18K" },
                { vol: "$1M/day", lp: "$2,500/day", protocol: "$500/day", annual: "~$182K" },
                { vol: "$10M/day", lp: "$25,000/day", protocol: "$5,000/day", annual: "~$1.8M" },
              ].map((tier) => (
                <div
                  key={tier.vol}
                  className={`p-3 rounded-xl text-center ${isDark ? "bg-white/[0.03] border border-white/[0.06]" : "bg-gray-50 border border-gray-100"}`}
                >
                  <div className={`text-xs font-bold mb-1 ${isDark ? "text-pink-400" : "text-pink-600"}`}>
                    {tier.vol} volume
                  </div>
                  <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    LP: {tier.lp}
                  </div>
                  <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Protocol: {tier.protocol}
                  </div>
                  <div className={`text-xs font-semibold mt-1 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                    {tier.annual}/yr treasury
                  </div>
                </div>
              ))}
            </div>
            <p
              className={`text-xs md:text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
            >
              The flat $0.0007 micro-fee adds ~$2.50/day at 3,500 daily
              swaps. Pool creation fees and fiat affiliate revenue layer
              on top as the user base scales. All protocol revenue
              parameters are DAO-adjustable via governance vote.
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
              title="Foundation — Shipped"
              icon={Rocket}
              current
              items={[
                "Constant-product AMM with Hedera-native atomic CryptoTransfer settlement",
                "4-tier oracle pipeline (Chainlink, Binance, CoinCap, CoinGecko)",
                "SaucerSwap swap integration with auto-path discovery",
                "ED25519 challenge-response authentication",
                "DAO governance with weighted voting & 8 categories",
                "VIP token-gated system (token + NFT dual-path)",
                "Cross-chain bridges (Squid, HashPort, Stargate)",
                "Bonzo Finance lending (Aave V2 on Hedera)",
                "Pro charting: 10 timeframes, 6 indicators, adaptive price format",
                "AAVE & DAI token onboarding (HashPort-bridged)",
                "Circuit breakers for all external services",
                "1inch DEX aggregator integration",
                { text: "Wyoming DUNA legal entity formation", status: "processing" as const },
                { text: "Anonymized site-wide activity feed", status: "processing" as const },
              ]}
            />
            <RoadmapQ
              quarter="Q2 2026"
              title="Expansion"
              icon={Target}
              items={[
                "Back-end infrastructure hardening & security review",
                "Community growth & membership acquisition initiatives",
                "Ivyfy native staking integration for HBAR.ħ",
                "AMM engine development, stress testing & hardening",
                "Multi-hop swap execution (USDC-hop routes)",
                "Portfolio P&L analytics & reporting dashboard",
                "Formal smart contract audit (Weighted Pool Factory)",
              ]}
            />
            <RoadmapQ
              quarter="Q3 2026"
              title="Scale"
              icon={Activity}
              items={[
                "Institutional API with WebSocket feeds",
                "Multi-sig treasury management (DAO-controlled extraction)",
                "Additional bridge integrations",
                "Automated yield strategies",
                "Mobile app (React Native)",
              ]}
            />
            <RoadmapQ
              quarter="Q4 2026"
              title="Institutional"
              icon={Building2}
              items={[
                "Regulatory compliance framework (DUNA + FinCEN guidance)",
                "Enterprise partnerships & API licensing",
                "Cross-chain liquidity aggregation",
                "Institutional custody integrations",
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
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
                </div>
                <div>
                  <h4
                    className={`font-bold ${isDark ? "text-white" : "text-slate-900"}`}
                  >
                    Technical Schematics
                  </h4>
                  <p
                    className={`text-xs bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent font-semibold`}
                  >
                    Protocol Architecture
                  </p>
                </div>
              </div>
              <p
                className={`text-xs md:text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
              >
                Detailed architecture diagrams covering the swap pipeline,
                smart router, security model, oracle system, and fee structure.
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
              { name: "HSuite", desc: "Ecosystem partner", color: "from-yellow-500 to-amber-500" },
              { name: "Bonzo Finance", desc: "Lending/borrowing", color: "from-purple-500 to-violet-500" },
              { name: "HashPort", desc: "Hedera bridge", color: "from-cyan-500 to-blue-500" },
              { name: "Squid", desc: "60+ chains", color: "from-indigo-600 to-blue-600" },
              { name: "Stargate", desc: "LayerZero bridge", color: "from-purple-600 to-indigo-600" },
              { name: "ChangeNOW", desc: "Fiat on-ramp", color: "from-lime-500 to-green-500" },
              { name: "WalletConnect", desc: "Wallet comms", color: "from-blue-500 to-sky-500" },
              { name: "1inch", desc: "DEX aggregation", color: "from-red-500 to-orange-500" },
              { name: "CoinCap", desc: "Chart history", color: "from-teal-500 to-cyan-500" },
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
                  to="/markets"
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

          {/* ── VIP-only Steward's Codex trigger ── */}
          {isVip && (
            <div className="flex justify-center mt-6">
              <BriefcaseTrigger onClick={() => setBriefcaseOpen(true)} />
            </div>
          )}
        </div>
      </div>

      {/* Founder Letter Modal — triggered by clicking Kyle's TeamCard */}
      <FounderLetter open={founderLetterOpen} onClose={() => setFounderLetterOpen(false)} />

      {/* Community Message Modal — triggered by clicking Carlos's TeamCard */}
      <CommunityMessage open={communityMessageOpen} onClose={() => setCommunityMessageOpen(false)} />

      {/* Technical Schematics — triggered by clicking the architecture card */}
      <EmrakDiagrams open={emrakDiagramsOpen} onClose={() => setEmrakDiagramsOpen(false)} />

      {/* Executive Briefcase — VIP-only strategic guidance */}
      {isVip && (
        <ExecutiveBriefcase open={briefcaseOpen} onClose={() => setBriefcaseOpen(false)} />
      )}
    </div>
  );
}

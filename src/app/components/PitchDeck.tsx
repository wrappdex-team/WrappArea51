import { useState, useCallback, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Shield,
  Zap,
  DollarSign,
  Globe,
  BarChart3,
  ArrowRightLeft,
  Layers,
  Vote,
  Activity,
  Users,
  Lock,
  Target,
  Building2,
  Coins,
  Clock,
  Rocket,
  CheckCircle2,
  ExternalLink,
  Eye,
  Crown,
} from "lucide-react";

/* =========================================================================
   WRAPpDEX  Investor Pitch Deck
   =========================================================================
   Internal document. Not routed in the application.
   Designed for investor presentations & fundraising conversations.
   ========================================================================= */

/* ── Slide wrapper ─────────────────────────────────────────────────────── */

function Slide({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-h-screen w-full flex flex-col justify-center px-6 sm:px-12 md:px-20 lg:px-32 py-16 md:py-20 relative overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

/* ── Glass card (consistent with WhitePaper.tsx) ───────────────────────── */

function Glass({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

/* ── Metric pill ───────────────────────────────────────────────────────── */

function Metric({
  value,
  label,
  accent = "from-pink-400 to-purple-400",
}: {
  value: string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="text-center">
      <div
        className={`text-2xl md:text-4xl font-bold bg-gradient-to-r ${accent} bg-clip-text text-transparent`}
      >
        {value}
      </div>
      <div className="text-xs md:text-sm text-slate-400 mt-1">{label}</div>
    </div>
  );
}

/* ── Feature row ───────────────────────────────────────────────────────── */

function Feature({
  icon: Icon,
  title,
  desc,
  gradient,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  gradient: string;
}) {
  return (
    <Glass className="p-4 md:p-5 flex items-start gap-4">
      <div
        className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0`}
      >
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <h4 className="font-bold text-sm md:text-base text-white">{title}</h4>
        <p className="text-xs md:text-sm text-slate-400 mt-1 leading-relaxed">
          {desc}
        </p>
      </div>
    </Glass>
  );
}

/* ── Oracle tier ───────────────────────────────────────────────────────── */

function OracleTierRow({
  tier,
  name,
  desc,
  dot,
}: {
  tier: string;
  name: string;
  desc: string;
  dot: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-1">
        <div className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        <span className="text-[10px] font-bold text-slate-600">{tier}</span>
      </div>
      <div>
        <span className="text-sm font-bold text-white">{name}</span>
        <span className="text-xs text-slate-400 ml-2">{desc}</span>
      </div>
    </div>
  );
}

/* ── Revenue row ───────────────────────────────────────────────────────── */

function RevenueRow({
  num,
  title,
  desc,
}: {
  num: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-pink-400">
        {num}
      </div>
      <div>
        <span className="text-sm font-bold text-white">{title}</span>
        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

/* ── Tokenomics segment ────────────────────────────────────────────────── */

function TokenSegment({
  pct,
  amount,
  label,
  color,
}: {
  pct: string;
  amount: string;
  label: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-4 h-4 rounded-sm ${color}`} />
      <div>
        <span className="text-sm font-bold text-white">
          {pct} &middot; {amount}
        </span>
        <p className="text-xs text-slate-400">{label}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export function PitchDeck() {
  const [slide, setSlide] = useState(0);

  const TOTAL_SLIDES = 16;

  const next = useCallback(
    () => setSlide((s) => Math.min(s + 1, TOTAL_SLIDES - 1)),
    []
  );
  const prev = useCallback(() => setSlide((s) => Math.max(s - 1, 0)), []);

  /* Keyboard nav */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [next, prev]);

  /* ── Slide titles for progress bar ── */
  const slideTitles = [
    "Cover",
    "The Problem",
    "The Solution",
    "Why Hedera",
    "Platform",
    "Architecture",
    "Oracles",
    "AMM Engine",
    "Revenue",
    "Projections",
    "Tokenomics",
    "Market",
    "Legal",
    "Roadmap",
    "Team",
    "Contact",
  ];

  return (
    <div className="bg-[#080a12] text-white min-h-screen relative select-none">
      {/* ── Top progress bar ── */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-white/[0.06]">
        <div
          className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-500 ease-out"
          style={{ width: `${((slide + 1) / TOTAL_SLIDES) * 100}%` }}
        />
      </div>

      {/* ── Slide counter ── */}
      <div className="fixed top-4 right-6 z-50 flex items-center gap-3">
        <span className="text-xs text-slate-500 font-mono">
          {String(slide + 1).padStart(2, "0")} / {TOTAL_SLIDES}
        </span>
        <span className="text-xs text-slate-600 hidden md:inline">
          {slideTitles[slide]}
        </span>
      </div>

      {/* ── Navigation buttons ── */}
      <div className="fixed bottom-8 right-8 z-50 flex items-center gap-2">
        <button
          onClick={prev}
          disabled={slide === 0}
          className="w-10 h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl flex items-center justify-center text-slate-400 hover:text-white hover:border-white/[0.15] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={next}
          disabled={slide === TOTAL_SLIDES - 1}
          className="w-10 h-10 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 flex items-center justify-center text-white hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* ── Dot navigation (left side) ── */}
      <nav className="fixed left-4 top-1/2 -translate-y-1/2 z-50 hidden lg:flex flex-col gap-2">
        {slideTitles.map((title, i) => (
          <button
            key={title}
            onClick={() => setSlide(i)}
            title={title}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i === slide
                ? "bg-pink-500 scale-125"
                : i < slide
                  ? "bg-purple-500/50"
                  : "bg-white/[0.12] hover:bg-white/[0.25]"
            }`}
          />
        ))}
      </nav>

      {/* ═══════════════════════════════════════════════════════════════════
         SLIDES
         ═══════════════════════════════════════════════════════════════════ */}

      <div
        className="transition-transform duration-700 ease-out"
        style={{ transform: `translateY(-${slide * 100}vh)` }}
      >
        {/* ── SLIDE 0: COVER ── */}
        <Slide>
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/[0.04] via-transparent to-purple-500/[0.04]" />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-pink-500/[0.06] rounded-full blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/[0.06] rounded-full blur-[120px]" />

          <div className="relative z-10 max-w-4xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center">
                <ArrowRightLeft className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-pink-400">
                  Investor Presentation
                </p>
                <p className="text-xs text-slate-500">
                  Confidential &middot; February 2026
                </p>
              </div>
            </div>

            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold leading-[0.95] mb-6">
              WRAP
              <span className="text-[#1D63ED]">p</span>
              <span className="text-slate-400">DEX</span>
            </h1>

            <p className="text-xl md:text-2xl text-slate-300 max-w-2xl leading-relaxed mb-8">
              The institutional-grade decentralized exchange built on Hedera.
              Structured as a Wyoming DUNA for regulatory clarity from day one.
            </p>

            <div className="flex flex-wrap gap-8 md:gap-12">
              <Metric value="10,000+" label="TPS on Hedera" />
              <Metric value="~2s" label="Finality" />
              <Metric value="$0.0001" label="Per transaction" />
              <Metric value="0" label="MEV / Front-running" />
            </div>
          </div>

          <p className="absolute bottom-8 left-6 sm:left-12 md:left-20 lg:left-32 text-xs text-slate-600">
            www.wrappdex.com &middot; info@wrappdex.io
          </p>
        </Slide>

        {/* ── SLIDE 1: THE PROBLEM ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              The Problem
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-8">
              DeFi is{" "}
              <span className="bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
                broken
              </span>{" "}
              for everyday users.
            </h2>

            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              <Glass className="p-6">
                <div className="text-3xl font-bold text-red-400 mb-2">
                  $1.2B+
                </div>
                <p className="text-sm text-slate-400">
                  Extracted from users via MEV and front-running in 2024 alone.
                  Validators and bots profit at traders' expense.
                </p>
              </Glass>
              <Glass className="p-6">
                <div className="text-3xl font-bold text-orange-400 mb-2">
                  60+ sec
                </div>
                <p className="text-sm text-slate-400">
                  Average Ethereum finality. Transactions sit in public mempools
                  where anyone can see and exploit them.
                </p>
              </Glass>
              <Glass className="p-6">
                <div className="text-3xl font-bold text-amber-400 mb-2">
                  $5-50+
                </div>
                <p className="text-sm text-slate-400">
                  Gas fees per swap on Ethereum during peak congestion.
                  Prohibitive for retail-size trades.
                </p>
              </Glass>
              <Glass className="p-6">
                <div className="text-3xl font-bold text-yellow-400 mb-2">
                  5-7 apps
                </div>
                <p className="text-sm text-slate-400">
                  Average number of separate tools a DeFi user needs: DEX,
                  charts, bridges, lending, governance, portfolio tracking.
                </p>
              </Glass>
            </div>

            <Glass className="p-5 border-red-500/20">
              <p className="text-sm text-slate-300 leading-relaxed">
                <span className="font-bold text-white">The core issue:</span>{" "}
                Existing DEXs are fragmented, expensive, slow, and structurally
                designed to extract value from users. There is no
                institutional-grade, all-in-one DeFi platform with legal clarity
                and zero MEV exposure.
              </p>
            </Glass>
          </div>
        </Slide>

        {/* ── SLIDE 2: THE SOLUTION ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              The Solution
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              One platform.{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                Everything DeFi.
              </span>
            </h2>
            <p className="text-lg text-slate-300 mb-8 max-w-2xl">
              WRAPpDEX unifies swapping, pro charting, lending, bridging, fiat
              on-ramp, DEX aggregation, and DAO governance into a single
              non-custodial platform on Hedera.
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  icon: ArrowRightLeft,
                  title: "Dual-Engine Swaps",
                  desc: "Custom AMM + SaucerSwap integration with smart routing",
                  g: "from-pink-500 to-rose-500",
                },
                {
                  icon: BarChart3,
                  title: "Pro Trading Terminal",
                  desc: "10 timeframes, 6 indicators, drawing tools, watchlists",
                  g: "from-purple-500 to-pink-500",
                },
                {
                  icon: Layers,
                  title: "DeFi Suite",
                  desc: "AMM liquidity pools + Bonzo Finance lending (Aave V2)",
                  g: "from-amber-500 to-orange-500",
                },
                {
                  icon: Globe,
                  title: "Cross-Chain Bridges",
                  desc: "Squid (60+ chains), HashPort, Stargate (LayerZero)",
                  g: "from-cyan-500 to-blue-500",
                },
                {
                  icon: DollarSign,
                  title: "Fiat On-Ramp",
                  desc: "ChangeNOW integration with 100+ supported currencies",
                  g: "from-emerald-500 to-teal-500",
                },
                {
                  icon: Vote,
                  title: "DAO Governance",
                  desc: "Legally binding proposals under Wyoming DUNA statute",
                  g: "from-violet-500 to-indigo-500",
                },
                {
                  icon: Activity,
                  title: "1inch Aggregation",
                  desc: "Deep EVM liquidity via cross-chain DEX aggregation",
                  g: "from-red-500 to-orange-500",
                },
                {
                  icon: TrendingUp,
                  title: "Live Markets",
                  desc: "22 assets, Fear & Greed, RSI, heatmap, news ticker",
                  g: "from-blue-500 to-cyan-500",
                },
                {
                  icon: Crown,
                  title: "VIP System",
                  desc: "Token-gated access: 100M+ HBAR.h or VIP NFT",
                  g: "from-yellow-500 to-amber-500",
                },
              ].map((item) => (
                <Glass
                  key={item.title}
                  className="p-4 flex items-start gap-3"
                >
                  <div
                    className={`w-9 h-9 rounded-xl bg-gradient-to-br ${item.g} flex items-center justify-center flex-shrink-0`}
                  >
                    <item.icon className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-white">
                      {item.title}
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                  </div>
                </Glass>
              ))}
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 3: WHY HEDERA ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Why Hedera
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              The enterprise-grade{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                public ledger.
              </span>
            </h2>
            <p className="text-lg text-slate-300 mb-8 max-w-2xl">
              Mathematically provable finality. Enterprise governance council.
              The only L1 designed for institutional DeFi.
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              <Feature
                icon={Zap}
                title="10,000+ TPS"
                desc="Process thousands of swaps per second without network congestion or gas wars."
                gradient="from-yellow-500 to-amber-500"
              />
              <Feature
                icon={Clock}
                title="~2-Second Finality"
                desc="Asynchronous Byzantine Fault Tolerant hashgraph consensus. Provable, immutable finality."
                gradient="from-blue-500 to-cyan-500"
              />
              <Feature
                icon={Coins}
                title="Sub-Cent Fees (~$0.0001)"
                desc="No gas spikes, no fee auctions. Predictable costs for every transaction."
                gradient="from-emerald-500 to-green-500"
              />
              <Feature
                icon={Shield}
                title="Zero MEV / Front-Running"
                desc="Fair consensus-timestamped ordering. No validator can reorder your trades."
                gradient="from-red-500 to-pink-500"
              />
              <Feature
                icon={Building2}
                title="Enterprise Governing Council"
                desc="Google, IBM, Boeing, Dell, and 30+ enterprise members govern the network."
                gradient="from-purple-500 to-violet-500"
              />
              <Feature
                icon={Layers}
                title="Native HTS Token Standard"
                desc="HTS tokens are faster and cheaper than ERC-20 with zero smart contract overhead."
                gradient="from-indigo-500 to-blue-500"
              />
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 4: PLATFORM OVERVIEW ── */}
        <Slide>
          <div className="relative z-10 max-w-5xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Platform Overview
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-8">
              Ten modules.{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                One interface.
              </span>
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {[
                { n: "22", l: "Price Feeds", icon: TrendingUp },
                { n: "7", l: "AMM Tokens", icon: Coins },
                { n: "60+", l: "Bridge Chains", icon: Globe },
                { n: "10", l: "Chart Timeframes", icon: BarChart3 },
                { n: "6", l: "Tech Indicators", icon: Activity },
                { n: "5", l: "Oracle Tiers", icon: Eye },
                { n: "3", l: "Bridge Protocols", icon: Layers },
                { n: "8", l: "DAO Categories", icon: Vote },
                { n: "100+", l: "Fiat Currencies", icon: DollarSign },
                { n: "2", l: "Swap Engines", icon: ArrowRightLeft },
              ].map((s) => (
                <Glass key={s.l} className="p-4 text-center">
                  <s.icon className="w-5 h-5 text-pink-400 mx-auto mb-2" />
                  <div className="text-xl md:text-2xl font-bold text-white">
                    {s.n}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{s.l}</div>
                </Glass>
              ))}
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 5: ARCHITECTURE ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Architecture
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              How a{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                swap
              </span>{" "}
              works.
            </h2>
            <p className="text-sm text-slate-400 mb-8 max-w-2xl">
              Every swap follows a deterministic 8-step flow with zero mempool
              exposure and atomic execution.
            </p>

            <div className="grid gap-2">
              {[
                {
                  step: "01",
                  title: "Wallet Connection",
                  desc: "ED25519 challenge-response auth via HashPack, MetaMask, or Dynamic SDK.",
                },
                {
                  step: "02",
                  title: "Token Selection & Quote",
                  desc: "User selects pair. 5-tier oracle pipeline resolves real-time price with confidence scoring.",
                },
                {
                  step: "03",
                  title: "Route Discovery",
                  desc: "Smart router checks direct pool, then USDC-hop path. Best route auto-selected.",
                },
                {
                  step: "04",
                  title: "Slippage Check",
                  desc: "Pre-execution validation: price impact, slippage tolerance, minimum output guarantee.",
                },
                {
                  step: "05",
                  title: "Server-Side Execution",
                  desc: "Pessimistic pool lock + optimistic CAS versioning. No public mempool = no MEV.",
                },
                {
                  step: "06",
                  title: "Fee Distribution",
                  desc: "0.25% LP fee compounds in reserves. $0.0007 flat micro-fee split 50/50 LP/protocol.",
                },
                {
                  step: "07",
                  title: "k-Invariant Assertion",
                  desc: "Post-swap mathematical proof that reserves never decreased. Revert on violation.",
                },
                {
                  step: "08",
                  title: "Settlement & Confirmation",
                  desc: "HTS token transfer via Hedera consensus. ~2s finality. Immutable record.",
                },
              ].map((s) => (
                <div key={s.step} className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-pink-400">
                      {s.step}
                    </span>
                  </div>
                  <div className="border-b border-white/[0.04] pb-2 flex-1">
                    <span className="text-sm font-bold text-white">
                      {s.title}
                    </span>
                    <p className="text-xs text-slate-400 mt-0.5">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 6: ORACLE PIPELINE ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Price Infrastructure
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              5-Tier{" "}
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                Oracle Pipeline
              </span>
            </h2>
            <p className="text-sm text-slate-400 mb-8 max-w-2xl">
              Cascading fallback architecture. If one source fails, the next
              tier activates automatically. Every price carries a confidence
              score and staleness check.
            </p>

            <div className="grid gap-3">
              <Glass className="p-5">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold text-slate-500">T0</span>
                  <span className="text-sm font-bold text-white">
                    Hedera Network Exchange Rate (0x168)
                  </span>
                </div>
                <p className="text-xs text-slate-400 ml-6">
                  On-chain system contract. The canonical HBAR/USD rate from
                  Hedera's consensus nodes. Zero latency, zero external
                  dependency.
                </p>
              </Glass>
              <Glass className="p-5">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-xs font-bold text-slate-500">T1</span>
                  <span className="text-sm font-bold text-white">
                    Chainlink Decentralized Feeds
                  </span>
                </div>
                <p className="text-xs text-slate-400 ml-6">
                  Industry-standard decentralized oracle network. Aggregated
                  from multiple independent node operators with on-chain
                  heartbeat.
                </p>
              </Glass>
              <Glass className="p-5">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="text-xs font-bold text-slate-500">T2</span>
                  <span className="text-sm font-bold text-white">
                    Binance Spot Prices
                  </span>
                </div>
                <p className="text-xs text-slate-400 ml-6">
                  Real-time spot prices from the world's largest exchange by
                  volume. Sub-second updates.
                </p>
              </Glass>
              <Glass className="p-5">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-3 h-3 rounded-full bg-orange-500" />
                  <span className="text-xs font-bold text-slate-500">T3</span>
                  <span className="text-sm font-bold text-white">
                    CoinCap / CoinGecko Aggregated
                  </span>
                </div>
                <p className="text-xs text-slate-400 ml-6">
                  Multi-exchange aggregated pricing. Volume-weighted averages
                  across hundreds of venues.
                </p>
              </Glass>
              <Glass className="p-5">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-3 h-3 rounded-full bg-purple-500" />
                  <span className="text-xs font-bold text-slate-500">T4</span>
                  <span className="text-sm font-bold text-white">
                    SaucerSwap On-Chain Reserves
                  </span>
                </div>
                <p className="text-xs text-slate-400 ml-6">
                  Hedera-native DEX reserve ratios as final fallback. Always
                  available as long as pools exist.
                </p>
              </Glass>
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 7: AMM ENGINE ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              AMM Engine
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Custom{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                constant-product
              </span>{" "}
              AMM
            </h2>
            <p className="text-sm text-slate-400 mb-8 max-w-2xl">
              Server-side execution eliminates MEV by design. No mempool, no
              front-running, no sandwich attacks. Pool state lives in a private
              KV store with atomic swap guarantees.
            </p>

            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              <Glass className="p-5">
                <h4 className="font-bold text-sm text-white mb-2">
                  Security Model
                </h4>
                <ul className="space-y-2">
                  {[
                    "Per-pool pessimistic locking",
                    "Optimistic compare-and-swap versioning",
                    "Post-swap k-invariant assertion",
                    "Owner kill switch (LP exit always open)",
                    "500-entry append-only audit trail",
                  ].map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-xs text-slate-400"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </Glass>
              <Glass className="p-5">
                <h4 className="font-bold text-sm text-white mb-2">
                  Whitelisted Tokens (Tier 1)
                </h4>
                <div className="flex flex-wrap gap-2">
                  {[
                    { s: "WBTC", d: "8 dec", b: "HashPort" },
                    { s: "WETH", d: "18 dec", b: "HashPort" },
                    { s: "USDC", d: "6 dec", b: "Native" },
                    { s: "USDT", d: "6 dec", b: "Native" },
                    { s: "LINK", d: "8 dec", b: "HashPort" },
                    { s: "AAVE", d: "8 dec", b: "HashPort" },
                    { s: "DAI", d: "8 dec", b: "HashPort" },
                  ].map((t) => (
                    <span
                      key={t.s}
                      className="text-xs px-2.5 py-1 rounded-lg font-mono font-semibold bg-white/[0.05] text-slate-300 border border-white/[0.08]"
                    >
                      {t.s}{" "}
                      <span className="font-normal text-slate-500">
                        {t.d}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  Canonical bridge tokens via HashPort/LayerZero. SaucerSwap
                  alias IDs retained for oracle price resolution.
                </p>
              </Glass>
            </div>

            <Glass className="p-4 border-pink-500/20">
              <p className="text-xs text-slate-300">
                <span className="font-bold text-white">Smart Routing:</span>{" "}
                Direct pool match first, then automatic USDC-hop path discovery.
                Best-price route selected with configurable slippage tolerance
                and real-time quote refresh.
              </p>
            </Glass>
          </div>
        </Slide>

        {/* ── SLIDE 8: REVENUE MODEL ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Revenue Model
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Five streams.{" "}
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                Sustainable from day one.
              </span>
            </h2>
            <p className="text-sm text-slate-400 mb-8">
              All revenue parameters are DAO-adjustable via governance vote.
              Protocol treasury: 0.0.9695738.
            </p>

            <div className="grid gap-3">
              <RevenueRow
                num="1"
                title="LP Swap Fee (0.25%)"
                desc="Full 25 bps stays in pool reserves on every swap, compounding k for LP holders. 17% cheaper than Uniswap V2 (0.30%)."
              />
              <RevenueRow
                num="2"
                title="Protocol Share (0.05% extractable)"
                desc="5 bps tracked per pool in a dedicated accumulator. DAO votes on extraction timing. Until extracted, LPs earn the full 0.25%."
              />
              <RevenueRow
                num="3"
                title="Flat Micro-Fee ($0.0007/swap)"
                desc="Flat fee in HBAR assessed per swap, split 50/50 between LP rewards and protocol treasury. Non-proportional to prevent trade-splitting."
              />
              <RevenueRow
                num="4"
                title="Pool Creation Fees ($50 HBAR.h)"
                desc="$50 in HBAR.h per weighted pool for non-VIP users. VIP holders (100M+ tokens or VIP NFT) create pools free. Deflationary token sink."
              />
              <RevenueRow
                num="5"
                title="Affiliate & Bridge Revenue"
                desc="ChangeNOW fiat on-ramp referral commissions, plus cross-chain bridge affiliate revenue from Squid and Stargate integrations."
              />
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 9: REVENUE PROJECTIONS ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Revenue Projections
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-8">
              Scaling{" "}
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                economics.
              </span>
            </h2>

            <div className="grid sm:grid-cols-3 gap-4 mb-8">
              {[
                {
                  vol: "$100K/day",
                  lp: "$250/day",
                  protocol: "$50/day",
                  annual: "~$18K",
                  label: "Early Stage",
                },
                {
                  vol: "$1M/day",
                  lp: "$2,500/day",
                  protocol: "$500/day",
                  annual: "~$182K",
                  label: "Growth",
                },
                {
                  vol: "$10M/day",
                  lp: "$25,000/day",
                  protocol: "$5,000/day",
                  annual: "~$1.8M",
                  label: "At Scale",
                },
              ].map((tier) => (
                <Glass key={tier.vol} className="p-6 text-center">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                    {tier.label}
                  </p>
                  <div className="text-xl font-bold text-pink-400 mb-3">
                    {tier.vol}
                  </div>
                  <div className="space-y-1 text-xs text-slate-400 mb-4">
                    <p>LP Revenue: {tier.lp}</p>
                    <p>Protocol Revenue: {tier.protocol}</p>
                  </div>
                  <div className="text-lg font-bold text-emerald-400">
                    {tier.annual}
                    <span className="text-xs text-slate-500"> /yr treasury</span>
                  </div>
                </Glass>
              ))}
            </div>

            <Glass className="p-5">
              <p className="text-xs text-slate-400">
                <span className="font-bold text-white">Additional revenue:</span>{" "}
                Flat $0.0007 micro-fee adds ~$2.50/day at 3,500 daily swaps.
                Pool creation fees ($50 HBAR.h each) and fiat affiliate revenue
                layer on top as the user base grows. All parameters
                DAO-adjustable.
              </p>
            </Glass>
          </div>
        </Slide>

        {/* ── SLIDE 10: TOKENOMICS ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Tokenomics
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              HBAR.
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                h
              </span>{" "}
              Token
            </h2>
            <p className="text-sm text-slate-400 mb-8">
              Token ID: 0.0.9356476 &middot; Total Supply: 50,000,000,000
              (50B)
            </p>

            <div className="grid sm:grid-cols-2 gap-6">
              {/* Allocation */}
              <div>
                <h4 className="font-bold text-sm text-white mb-4">
                  Token Allocation
                </h4>
                <div className="space-y-4">
                  <TokenSegment
                    pct="60%"
                    amount="30B"
                    label="Locked in Liquidity (LP lock initiated)"
                    color="bg-pink-500"
                  />
                  <TokenSegment
                    pct="20%"
                    amount="10B"
                    label="Treasury / DAO / DeFi / Community"
                    color="bg-purple-500"
                  />
                  <TokenSegment
                    pct="20%"
                    amount="10B"
                    label="Locked for 1.5 years (protocol stability)"
                    color="bg-blue-500"
                  />
                </div>

                {/* Visual bar */}
                <div className="flex h-4 rounded-full overflow-hidden mt-6">
                  <div className="w-[60%] bg-gradient-to-r from-pink-500 to-pink-600" />
                  <div className="w-[20%] bg-gradient-to-r from-purple-500 to-purple-600" />
                  <div className="w-[20%] bg-gradient-to-r from-blue-500 to-blue-600" />
                </div>
                <div className="flex justify-between mt-2 text-[10px] text-slate-500">
                  <span>Liquidity 60%</span>
                  <span>Treasury 20%</span>
                  <span>Locked 20%</span>
                </div>
              </div>

              {/* Utility */}
              <div>
                <h4 className="font-bold text-sm text-white mb-4">
                  Token Utility
                </h4>
                <div className="space-y-3">
                  {[
                    {
                      icon: Vote,
                      title: "DAO Governance",
                      desc: "100,000,000 tokens = 1 DAO vote. Legally binding under DUNA.",
                    },
                    {
                      icon: Crown,
                      title: "VIP Access",
                      desc: "100M+ tokens or VIP NFT unlocks priority features and zero pool creation fees.",
                    },
                    {
                      icon: TrendingUp,
                      title: "DeFi Boosters",
                      desc: "Eligible for DeFi yield boosters and enhanced LP reward multipliers.",
                    },
                    {
                      icon: Lock,
                      title: "Single-Sided Staking",
                      desc: "Stake HBAR.h without impermanent loss for protocol-distributed rewards.",
                    },
                    {
                      icon: Layers,
                      title: "LP Rewards",
                      desc: "Wrapped-asset LP rewards distributed proportionally to liquidity providers.",
                    },
                  ].map((u) => (
                    <div key={u.title} className="flex items-start gap-3">
                      <u.icon className="w-4 h-4 text-pink-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-xs font-bold text-white">
                          {u.title}
                        </span>
                        <p className="text-xs text-slate-400">{u.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 11: MARKET OPPORTUNITY ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Market Opportunity
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-8">
              The DEX market is{" "}
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                $180B+ annually.
              </span>
            </h2>

            <div className="grid sm:grid-cols-3 gap-4 mb-8">
              <Glass className="p-6 text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                  TAM
                </p>
                <div className="text-3xl font-bold text-white mb-1">$180B+</div>
                <p className="text-xs text-slate-400">
                  Annual DEX trading volume across all chains
                </p>
              </Glass>
              <Glass className="p-6 text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                  SAM
                </p>
                <div className="text-3xl font-bold text-white mb-1">$5B+</div>
                <p className="text-xs text-slate-400">
                  Hedera ecosystem + cross-chain Hedera-adjacent volume
                </p>
              </Glass>
              <Glass className="p-6 text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                  SOM (Y1)
                </p>
                <div className="text-3xl font-bold text-white mb-1">$50M</div>
                <p className="text-xs text-slate-400">
                  Target Year 1 cumulative volume on WRAPpDEX
                </p>
              </Glass>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Glass className="p-5">
                <h4 className="font-bold text-sm text-white mb-3">
                  Competitive Advantages
                </h4>
                <ul className="space-y-2">
                  {[
                    "Zero MEV extraction (server-side execution)",
                    "17% cheaper fees than Uniswap V2",
                    "All-in-one platform (no app-hopping)",
                    "Wyoming DUNA legal clarity",
                    "5-tier oracle redundancy",
                    "Sub-cent transaction costs",
                  ].map((a) => (
                    <li
                      key={a}
                      className="flex items-start gap-2 text-xs text-slate-400"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      {a}
                    </li>
                  ))}
                </ul>
              </Glass>
              <Glass className="p-5">
                <h4 className="font-bold text-sm text-white mb-3">
                  vs. Competitors
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-slate-400 border-b border-white/[0.04] pb-1.5">
                    <span />
                    <div className="flex gap-6">
                      <span className="w-16 text-center font-bold text-pink-400">
                        WRAPp
                      </span>
                      <span className="w-16 text-center">Uni V2</span>
                      <span className="w-16 text-center">Saucer</span>
                    </div>
                  </div>
                  {[
                    { label: "Swap Fee", w: "0.25%", u: "0.30%", s: "0.30%" },
                    { label: "MEV", w: "None", u: "High", s: "Low" },
                    { label: "Finality", w: "~2s", u: "~60s", s: "~2s" },
                    { label: "Gas Cost", w: "$0.0001", u: "$5-50", s: "$0.01" },
                    { label: "Charting", w: "Built-in", u: "None", s: "None" },
                    { label: "Legal Entity", w: "DUNA", u: "None", s: "None" },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex justify-between text-slate-400 border-b border-white/[0.02] pb-1"
                    >
                      <span className="text-slate-500">{row.label}</span>
                      <div className="flex gap-6">
                        <span className="w-16 text-center font-semibold text-emerald-400">
                          {row.w}
                        </span>
                        <span className="w-16 text-center">{row.u}</span>
                        <span className="w-16 text-center">{row.s}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Glass>
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 12: LEGAL STRUCTURE ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <div className="absolute top-1/4 right-0 w-72 h-72 bg-purple-500/[0.05] rounded-full blur-[100px]" />

            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Legal Structure
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Wyoming{" "}
              <span className="bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
                DUNA
              </span>
            </h2>
            <p className="text-lg text-slate-300 mb-8 max-w-2xl">
              Decentralized Unincorporated Nonprofit Association under Wyoming
              statute W.S. 17-32. The first DEX with this legal structure.
            </p>

            <div className="grid sm:grid-cols-3 gap-4 mb-6">
              <Glass className="p-5">
                <Shield className="w-6 h-6 text-purple-400 mb-3" />
                <h4 className="font-bold text-sm text-white mb-2">
                  Limited Liability
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  DAO members and token holders are shielded from personal
                  liability for protocol operations under Wyoming statute.
                </p>
              </Glass>
              <Glass className="p-5">
                <Vote className="w-6 h-6 text-purple-400 mb-3" />
                <h4 className="font-bold text-sm text-white mb-2">
                  Binding Governance
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  DAO proposals carry legal authority. On-chain governance votes
                  have real legal weight over entity operations and treasury.
                </p>
              </Glass>
              <Glass className="p-5">
                <Building2 className="w-6 h-6 text-purple-400 mb-3" />
                <h4 className="font-bold text-sm text-white mb-2">
                  Institutional Ready
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  U.S.-domiciled legal entity with established banking and
                  compliance pathways for enterprise partnerships and investors.
                </p>
              </Glass>
            </div>

            <Glass className="p-5 border-purple-500/20">
              <p className="text-sm text-slate-300">
                <span className="font-bold text-white">Why this matters:</span>{" "}
                Unlike offshore foundations or anonymous teams, the DUNA structure
                anchors WRAPpDEX in a clear legal jurisdiction. Investors,
                liquidity providers, and institutional partners get confidence
                that the protocol operates within a recognized regulatory
                framework.
              </p>
            </Glass>
          </div>
        </Slide>

        {/* ── SLIDE 13: ROADMAP ── */}
        <Slide>
          <div className="relative z-10 max-w-5xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Roadmap
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-8">
              Execution{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                timeline.
              </span>
            </h2>

            <div className="grid sm:grid-cols-2 gap-4">
              {[
                {
                  q: "Q1 2026",
                  t: "Foundation",
                  status: "SHIPPED",
                  color: "border-emerald-500/30",
                  bar: "bg-emerald-500",
                  items: [
                    "Constant-product AMM with KV-backed state",
                    "5-tier oracle pipeline",
                    "SaucerSwap + smart routing integration",
                    "ED25519 challenge-response auth",
                    "DAO governance (8 categories, weighted voting)",
                    "Cross-chain bridges (Squid, HashPort, Stargate)",
                    "Bonzo Finance lending integration",
                    "Pro charting: 10 TFs, 6 indicators, drawing tools",
                    "1inch DEX aggregator",
                    "Wyoming DUNA formation",
                  ],
                },
                {
                  q: "Q2 2026",
                  t: "Expansion",
                  status: "IN PROGRESS",
                  color: "border-pink-500/30",
                  bar: "bg-gradient-to-r from-pink-500 to-purple-500",
                  items: [
                    "Formal smart contract audit",
                    "HSuite SmartNode on-chain execution",
                    "Native staking contracts",
                    "HBAR.h lending market on Bonzo",
                    "Limit order types (0x16b)",
                    "Multi-hop USDC routing",
                    "Portfolio P&L analytics",
                  ],
                },
                {
                  q: "Q3 2026",
                  t: "Scale",
                  status: "PLANNED",
                  color: "border-white/[0.06]",
                  bar: "bg-slate-700",
                  items: [
                    "Institutional API + WebSocket feeds",
                    "Multi-sig treasury (DAO-controlled, 0x16b)",
                    "Gasless swaps via meta-transactions",
                    "Automated yield strategies",
                    "Mobile app (React Native)",
                  ],
                },
                {
                  q: "Q4 2026",
                  t: "Institutional",
                  status: "PLANNED",
                  color: "border-white/[0.06]",
                  bar: "bg-slate-700",
                  items: [
                    "Regulatory compliance framework",
                    "Enterprise partnerships & API licensing",
                    "On-chain HTS LP tokens (0x167)",
                    "Institutional custody integrations",
                    "Cross-chain liquidity aggregation",
                  ],
                },
              ].map((phase) => (
                <Glass
                  key={phase.q}
                  className={`p-5 relative overflow-hidden ${phase.color}`}
                >
                  <div
                    className={`absolute top-0 left-0 right-0 h-1 ${phase.bar}`}
                  />
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-xs font-bold text-pink-400">
                        {phase.q}
                      </span>
                      <h4 className="font-bold text-white">{phase.t}</h4>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        phase.status === "SHIPPED"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : phase.status === "IN PROGRESS"
                            ? "bg-pink-500/20 text-pink-400"
                            : "bg-white/[0.05] text-slate-500"
                      }`}
                    >
                      {phase.status}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {phase.items.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2 text-xs text-slate-400"
                      >
                        <CheckCircle2
                          className={`w-3 h-3 flex-shrink-0 mt-0.5 ${
                            phase.status === "SHIPPED"
                              ? "text-emerald-400"
                              : "text-slate-600"
                          }`}
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </Glass>
              ))}
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 14: TEAM ── */}
        <Slide>
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
              Team
            </p>
            <h2 className="text-3xl md:text-5xl font-bold mb-8">
              Built by{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                Hedera natives.
              </span>
            </h2>

            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                {
                  name: "Kyle",
                  role: "Founder & CEO",
                  desc: "Architect of the WRAPpDEX platform. Deep expertise in blockchain development and DeFi protocol design on Hedera.",
                  accent: "from-pink-500 to-purple-500",
                },
                {
                  name: "Natalie",
                  role: "Chief Marketing Officer",
                  desc: "Leads brand strategy, growth marketing, and institutional positioning for WRAPpDEX and the HBAR.h ecosystem.",
                  accent: "from-violet-500 to-pink-500",
                },
                {
                  name: "Carlos",
                  role: "Community Lead",
                  desc: "Drives community engagement, moderates governance channels, and represents the brand across the ecosystem.",
                  accent: "from-blue-500 to-cyan-500",
                },
                {
                  name: "Emrak",
                  role: "Strategic Advisor",
                  desc: "Provides advisory on protocol direction, ecosystem development, and institutional partnership opportunities.",
                  accent: "from-amber-500 to-orange-500",
                },
              ].map((m) => (
                <Glass key={m.name} className="p-5 text-center">
                  <div
                    className={`w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center text-xl font-bold text-white bg-gradient-to-br ${m.accent}`}
                  >
                    {m.name.charAt(0)}
                  </div>
                  <h4 className="font-bold text-sm text-white">{m.name}</h4>
                  <p className="text-xs font-semibold text-pink-400 mt-0.5">
                    {m.role}
                  </p>
                  <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                    {m.desc}
                  </p>
                </Glass>
              ))}
            </div>

            {/* Partners grid */}
            <h4 className="font-bold text-sm text-white mb-3">
              Live Production Integrations
            </h4>
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-2">
              {[
                { name: "SaucerSwap", c: "from-green-500 to-emerald-500" },
                { name: "Chainlink", c: "from-blue-600 to-blue-500" },
                { name: "HSuite", c: "from-yellow-500 to-amber-500" },
                { name: "Bonzo", c: "from-purple-500 to-violet-500" },
                { name: "HashPort", c: "from-cyan-500 to-blue-500" },
                { name: "Squid", c: "from-indigo-600 to-blue-600" },
                { name: "Stargate", c: "from-purple-600 to-indigo-600" },
                { name: "ChangeNOW", c: "from-lime-500 to-green-500" },
                { name: "WalletConnect", c: "from-blue-500 to-sky-500" },
                { name: "1inch", c: "from-red-500 to-orange-500" },
                { name: "CoinCap", c: "from-teal-500 to-cyan-500" },
                { name: "Dynamic", c: "from-violet-500 to-purple-500" },
                { name: "Hedera", c: "from-slate-600 to-slate-500" },
                { name: "Supabase", c: "from-emerald-600 to-green-600" },
              ].map((p) => (
                <Glass key={p.name} className="p-3 text-center">
                  <div
                    className={`w-8 h-8 rounded-lg bg-gradient-to-br ${p.c} flex items-center justify-center mx-auto mb-1.5 text-white font-bold text-xs`}
                  >
                    {p.name.charAt(0)}
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {p.name}
                  </span>
                </Glass>
              ))}
            </div>
          </div>
        </Slide>

        {/* ── SLIDE 15: CONTACT / THE ASK ── */}
        <Slide>
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/[0.04] via-transparent to-purple-500/[0.04]" />
          <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-pink-500/[0.06] rounded-full blur-[120px]" />
          <div className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-purple-500/[0.06] rounded-full blur-[120px]" />

          <div className="relative z-10 max-w-3xl mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center mx-auto mb-6">
              <Rocket className="w-8 h-8 text-white" />
            </div>

            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Join the{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                future of DeFi.
              </span>
            </h2>

            <p className="text-lg text-slate-300 mb-10 max-w-xl mx-auto">
              We are building the institutional-grade DEX that Hedera deserves.
              Legally structured, technically sound, and ready to scale.
            </p>

            <div className="grid sm:grid-cols-3 gap-4 mb-10">
              <Glass className="p-5">
                <Globe className="w-5 h-5 text-pink-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-white">Website</p>
                <p className="text-xs text-slate-400">www.wrappdex.com</p>
              </Glass>
              <Glass className="p-5">
                <ExternalLink className="w-5 h-5 text-pink-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-white">Social</p>
                <p className="text-xs text-slate-400">x.com/wrappdex</p>
              </Glass>
              <Glass className="p-5">
                <Users className="w-5 h-5 text-pink-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-white">Contact</p>
                <p className="text-xs text-slate-400">info@wrappdex.io</p>
              </Glass>
            </div>

            <Glass className="p-6 text-left max-w-md mx-auto">
              <h4 className="font-bold text-sm text-white mb-3">
                Key Highlights
              </h4>
              <ul className="space-y-2">
                {[
                  "Wyoming DUNA legal entity (W.S. 17-32)",
                  "Custom AMM with zero MEV exposure",
                  "14 live production integrations",
                  "5-tier oracle pipeline (Chainlink primary)",
                  "0.25% swap fee (17% cheaper than Uni V2)",
                  "50B token supply, 60% locked in liquidity",
                  "Full DAO governance with legal weight",
                  "Sub-cent transactions on 10,000+ TPS network",
                ].map((h) => (
                  <li
                    key={h}
                    className="flex items-start gap-2 text-xs text-slate-400"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    {h}
                  </li>
                ))}
              </ul>
            </Glass>

            <p className="text-xs text-slate-600 mt-10">
              This presentation contains forward-looking statements and is for
              informational purposes only. Not financial advice.
              <br />
              WRAPpDEX &middot; Wyoming DUNA &middot; Confidential &middot;
              February 2026
            </p>
          </div>
        </Slide>
      </div>
    </div>
  );
}

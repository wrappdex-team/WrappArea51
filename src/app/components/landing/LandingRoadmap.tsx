import { motion } from "motion/react";
import { CheckCircle2, Clock, Circle, ChevronRight } from "lucide-react";
import { Link } from "react-router";

const BLUE = "#1D63ED";
const AMBER = "#f59e0b";

type ItemStatus = "shipped" | "processing" | "planned";

interface RoadmapItem {
  text: string;
  status: ItemStatus;
}

interface Quarter {
  quarter: string;
  title: string;
  phase: "current" | "next" | "future";
  items: RoadmapItem[];
}

const roadmap: Quarter[] = [
  {
    quarter: "Q1 2026",
    title: "Foundation — Shipped",
    phase: "current",
    items: [
      { text: "Constant-product AMM with Hedera-native atomic settlement", status: "shipped" },
      { text: "4-tier oracle pipeline (Chainlink, Binance, CoinCap, CoinGecko)", status: "shipped" },
      { text: "SaucerSwap integration with auto-path discovery", status: "shipped" },
      { text: "ED25519 challenge-response authentication", status: "shipped" },
      { text: "DAO governance with weighted voting & 8 categories", status: "shipped" },
      { text: "VIP token-gated system (token + NFT dual-path)", status: "shipped" },
      { text: "Cross-chain bridges (Squid, HashPort, Stargate)", status: "shipped" },
      { text: "Bonzo Finance lending (Aave V2 on Hedera)", status: "processing" },
      { text: "Pro charting: 10 timeframes, 6 technical indicators", status: "shipped" },
      { text: "AAVE & DAI onboarding (HashPort-bridged)", status: "shipped" },
      { text: "Circuit breakers for all external services", status: "shipped" },
      { text: "1inch DEX aggregator integration", status: "shipped" },
      { text: "Wyoming DUNA legal entity formation", status: "processing" },
      { text: "Anonymized site-wide activity feed", status: "processing" },
    ],
  },
  {
    quarter: "Q2 2026",
    title: "Expansion",
    phase: "next",
    items: [
      { text: "Back-end infrastructure hardening & security review", status: "planned" },
      { text: "Community growth & membership acquisition initiatives", status: "planned" },
      { text: "Ivyfy native staking integration for WRAPpDEX", status: "processing" },
      { text: "AMM engine development, stress testing & hardening", status: "planned" },
      { text: "Multi-hop swap execution (USDC-hop routes)", status: "planned" },
      { text: "Portfolio P&L analytics & reporting dashboard", status: "planned" },
      { text: "Formal smart contract audit (Weighted Pool Factory)", status: "planned" },
    ],
  },
  {
    quarter: "Q3 2026",
    title: "Scale",
    phase: "future",
    items: [
      { text: "Institutional API with WebSocket feeds", status: "planned" },
      { text: "Multi-sig treasury management (DAO-controlled)", status: "planned" },
      { text: "Additional bridge integrations", status: "planned" },
      { text: "Automated yield strategies", status: "planned" },
      { text: "Mobile app (React Native)", status: "planned" },
    ],
  },
  {
    quarter: "Q4 2026",
    title: "Institutional",
    phase: "future",
    items: [
      { text: "Regulatory compliance framework (DUNA + FinCEN)", status: "planned" },
      { text: "Enterprise partnerships & API licensing", status: "planned" },
      { text: "Cross-chain liquidity aggregation", status: "planned" },
      { text: "Institutional custody integrations", status: "planned" },
    ],
  },
];

function StatusIcon({ status, phase }: { status: ItemStatus; phase: string }) {
  if (status === "shipped") {
    return <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" />;
  }
  if (status === "processing") {
    return <Clock className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />;
  }
  return (
    <Circle
      className={`w-3.5 h-3.5 flex-shrink-0 ${
        phase === "next" ? "text-slate-300" : "text-slate-200"
      }`}
    />
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  if (status === "shipped") return null;
  if (status === "processing") {
    return (
      <span
        className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border whitespace-nowrap"
        style={{
          backgroundColor: `${AMBER}15`,
          color: AMBER,
          borderColor: `${AMBER}30`,
        }}
      >
        Processing
      </span>
    );
  }
  return null;
}

export function LandingRoadmap() {
  /* Count shipped + processing + total items for the summary bar */
  const shipped = roadmap.flatMap((q) => q.items).filter((i) => i.status === "shipped").length;
  const processing = roadmap.flatMap((q) => q.items).filter((i) => i.status === "processing").length;
  const total = roadmap.flatMap((q) => q.items).length;

  return (
    <section
      id="roadmap"
      className="py-20 sm:py-32 md:py-48 bg-slate-50"
      style={{
        borderTop: "1px solid #e2e8f0",
        borderBottom: "1px solid #e2e8f0",
      }}
    >
      <div className="container mx-auto px-4">
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1 }}
          className="text-center mb-16 md:mb-24"
        >
          <span
            className="text-[10px] font-black uppercase tracking-[0.5em] block mb-8"
            style={{ color: BLUE }}
          >
            Transparent Execution
          </span>
          <h2
            className="text-5xl sm:text-6xl md:text-8xl text-black tracking-tight leading-[0.95] mb-6"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Development Roadmap
          </h2>
          <p
            className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed font-light"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Real milestones. No vaporware. Every item below is either shipped,
            in progress, or scheduled — and we'll tell you which.
          </p>
        </motion.div>

        {/* ── Live Progress Summary ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="flex flex-wrap items-center justify-center gap-6 md:gap-12 mb-16 md:mb-20"
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-black text-slate-700">
              {shipped}{" "}
              <span className="font-medium text-slate-400">Shipped</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-black text-slate-700">
              {processing}{" "}
              <span className="font-medium text-slate-400">Processing</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Circle className="w-4 h-4 text-slate-300" />
            <span className="text-sm font-black text-slate-700">
              {total - shipped - processing}{" "}
              <span className="font-medium text-slate-400">Planned</span>
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full max-w-xs h-2 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full flex">
              <div
                className="h-full bg-emerald-500 transition-all duration-1000"
                style={{ width: `${(shipped / total) * 100}%` }}
              />
              <div
                className="h-full transition-all duration-1000"
                style={{
                  width: `${(processing / total) * 100}%`,
                  backgroundColor: AMBER,
                }}
              />
            </div>
          </div>
        </motion.div>

        {/* ── Quarter Grid ── */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 overflow-hidden"
          style={{ boxShadow: "0 32px 64px -16px rgba(0,0,0,0.08)" }}
        >
          {roadmap.map((q, qi) => (
            <motion.div
              key={q.quarter}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: qi * 0.1, duration: 0.8 }}
              className={`p-10 md:p-12 lg:p-14 bg-white hover:bg-slate-50/60 transition-all group flex flex-col relative ${
                q.phase === "current" ? "ring-1 ring-inset ring-emerald-200/60" : ""
              }`}
              style={{
                borderRight: qi < 3 ? "1px solid #f1f5f9" : "none",
              }}
            >
              {/* Current quarter accent bar */}
              {q.phase === "current" && (
                <div
                  className="absolute top-0 left-0 right-0 h-1"
                  style={{
                    background: `linear-gradient(90deg, #10b981, ${BLUE})`,
                  }}
                />
              )}

              {/* Phase ghost number */}
              <div
                className="absolute top-0 right-0 p-5 text-[36px] italic text-slate-50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                0{qi + 1}
              </div>

              {/* Quarter + Title */}
              <div className="mb-10">
                <div
                  className="font-black text-[10px] tracking-[0.4em] uppercase mb-3 flex items-center gap-3"
                  style={{
                    color: q.phase === "current" ? "#10b981" : BLUE,
                  }}
                >
                  {q.quarter}
                  {q.phase === "current" && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-200">
                      Now
                    </span>
                  )}
                </div>
                <h4
                  className="text-2xl md:text-3xl group-hover:italic transition-all text-black"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {q.title}
                </h4>
              </div>

              {/* Items */}
              <ul className="space-y-4 flex-1">
                {q.items.map((item) => (
                  <li
                    key={item.text}
                    className="flex items-start gap-3"
                  >
                    <span className="mt-[3px]">
                      <StatusIcon status={item.status} phase={q.phase} />
                    </span>
                    <span
                      className={`text-[11px] leading-relaxed font-medium ${
                        item.status === "shipped"
                          ? "text-slate-700"
                          : item.status === "processing"
                            ? "text-slate-600"
                            : "text-slate-400"
                      }`}
                    >
                      {item.text}
                      <StatusBadge status={item.status} />
                    </span>
                  </li>
                ))}
              </ul>

              {/* Item count footer */}
              <div className="mt-10 pt-6" style={{ borderTop: "1px solid #f1f5f9" }}>
                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-300">
                  {q.items.filter((i) => i.status === "shipped").length > 0 && (
                    <span className="text-emerald-500">
                      {q.items.filter((i) => i.status === "shipped").length} shipped
                    </span>
                  )}
                  {q.items.filter((i) => i.status === "processing").length > 0 && (
                    <>
                      {q.items.filter((i) => i.status === "shipped").length > 0 && (
                        <span className="text-slate-200"> &middot; </span>
                      )}
                      <span style={{ color: AMBER }}>
                        {q.items.filter((i) => i.status === "processing").length} processing
                      </span>
                    </>
                  )}
                  {q.items.filter((i) => i.status === "planned").length > 0 && (
                    <>
                      {(q.items.filter((i) => i.status === "shipped").length > 0 ||
                        q.items.filter((i) => i.status === "processing").length > 0) && (
                        <span className="text-slate-200"> &middot; </span>
                      )}
                      <span className="text-slate-300">
                        {q.items.filter((i) => i.status === "planned").length} planned
                      </span>
                    </>
                  )}
                </span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── Bottom Link ── */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="mt-16 md:mt-20 text-center"
        >
          <Link
            to="/white-paper#roadmap"
            className="inline-flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] transition-all group hover:gap-5"
            style={{ color: BLUE }}
          >
            Full technical roadmap in the Wrapp Paper
            <ChevronRight
              size={14}
              className="group-hover:translate-x-1 transition-transform"
            />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
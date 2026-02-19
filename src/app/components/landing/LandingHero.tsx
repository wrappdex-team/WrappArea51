import { Link } from "react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  TrendingUp,
  ArrowRightLeft,
  ShieldCheck,
  Zap,
  BarChart3,
  Landmark,
} from "lucide-react";
import { useScreenshotUrls } from "./useScreenshotUrls";

const BLUE = "#1D63ED";
const CYAN = "#06b6d4";

/* ── simple animation presets ── */
const fade = {
  hidden: { opacity: 0, y: 30 },
  visible: (d: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, delay: d, ease: [0.22, 1, 0.36, 1] },
  }),
};

const letterUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

/* ── animated title word ── */
function Word({
  text,
  gradient,
  italic,
}: {
  text: string;
  gradient?: boolean;
  italic?: boolean;
}) {
  return (
    <motion.span
      className="inline-block whitespace-nowrap"
      variants={{ visible: { transition: { staggerChildren: 0.025 } } }}
    >
      {text.split("").map((ch, i) => (
        <motion.span
          key={i}
          variants={letterUp}
          className={`inline-block cursor-default select-none ${italic ? "italic" : ""}`}
          style={
            gradient
              ? {
                  background: `linear-gradient(135deg, ${BLUE}, #06b6d4)`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  paddingLeft: "0.06em",
                  paddingRight: "0.06em",
                  marginLeft: "-0.03em",
                  marginRight: "-0.03em",
                  ...(ch === "g" && { paddingBottom: "0.15em", marginBottom: "-0.15em" }),
                }
              : undefined
          }
        >
          {ch === " " ? "\u00A0" : ch}
        </motion.span>
      ))}
    </motion.span>
  );
}

/* ── floating teaser badge ── */
function TeaserBadge({
  icon: Icon,
  label,
  value,
  accent,
  className,
  delay,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: string;
  className?: string;
  delay: number;
}) {
  return (
    <motion.div
      custom={delay}
      variants={fade}
      initial="hidden"
      animate="visible"
      className={`absolute z-30 hidden lg:block ${className}`}
    >
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4 + delay, repeat: Infinity, ease: "easeInOut" }}
        className="flex items-center gap-3 bg-white/95 backdrop-blur-xl rounded-2xl pl-3 pr-5 py-2.5 border border-slate-100"
        style={{
          boxShadow:
            "0 8px 32px -8px rgba(0,0,0,0.08), 0 2px 8px -2px rgba(0,0,0,0.04)",
        }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${accent ?? BLUE}15` }}
        >
          <Icon size={16} style={{ color: accent ?? BLUE }} />
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 leading-none mb-1">
            {label}
          </div>
          <div className="text-[13px] font-extrabold text-slate-900 leading-none tabular-nums">
            {value}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ════════════════════════════════════════════════
   HERO
   ════════════════════════════════════════════════ */
export function LandingHero() {
  const [hovered, setHovered] = useState(false);
  const { marketingshots } = useScreenshotUrls();

  const desktopDark = marketingshots["screendark.png"] || "";
  const desktopLight = marketingshots["screenlight.png"] || "";
  const mobileDark = marketingshots["mobildark.png"] || "";
  const mobileLight = marketingshots["mobilelight.png"] || "";

  /* animated volume counter */
  const [fee, setFee] = useState("$0.0000");
  useEffect(() => {
    const target = 0.0001;
    const dur = 1800;
    const t0 = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      setFee(`$${(eased * target).toFixed(4)}`);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="relative overflow-x-hidden bg-white">
      {/* ── BG: dot grid ── */}
      <div
        className="absolute inset-0 z-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle, #94a3b8 0.8px, transparent 0.8px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* ── BG: gradient orbs ── */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-60 right-0 w-[800px] h-[800px] rounded-full opacity-[0.18]"
          style={{
            background: `radial-gradient(circle, ${BLUE}40, transparent 70%)`,
          }}
        />
        <div
          className="absolute top-[60%] -left-60 w-[600px] h-[600px] rounded-full opacity-[0.12]"
          style={{
            background: `radial-gradient(circle, #06b6d440, transparent 70%)`,
          }}
        />
      </div>

      {/* fade-in top edge */}
      <div className="absolute top-0 inset-x-0 h-24 bg-gradient-to-b from-white to-transparent z-[1]" />

      {/* ══════════════════════════════════════════
          TEXT BLOCK  — centred
         ══════════════════════════════════════════ */}
      <div className="relative z-10 container mx-auto px-6 pt-12 sm:pt-16 text-center">
        <motion.div
          variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
          initial="hidden"
          animate="visible"
        >
          {/* eyebrow */}
          <motion.div
            custom={0}
            variants={fade}
            className="inline-flex items-center gap-3 mb-6"
          >
            <span
              className="w-10 h-px inline-block"
              style={{ backgroundColor: BLUE }}
            />
            <span
              className="text-[10px] font-black uppercase tracking-[0.45em]"
              style={{ color: BLUE }}
            >
              Sovereign Digital Asset Infrastructure
            </span>
            <span
              className="w-10 h-px inline-block"
              style={{ backgroundColor: BLUE }}
            />
          </motion.div>

          {/* headline */}
          <motion.h1
            className="text-[2.8rem] sm:text-[4rem] md:text-[5.5rem] lg:text-[6.5rem] leading-[1.1] tracking-[-0.04em] text-black mx-auto max-w-5xl mb-6 overflow-visible py-2"
            style={{ fontFamily: "'Playfair Display', serif" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.06 } },
            }}
            initial="hidden"
            animate="visible"
          >
            <div className="flex flex-wrap justify-center gap-x-[0.2em]">
              <Word text="The" />
              <Word text="Future" />
              <Word text="of" />
            </div>
            <div className="flex flex-wrap justify-center gap-x-[0.2em]">
              <Word text="Digital" gradient italic />
              <Word text="Assets" gradient italic />
              <Word text="today." />
            </div>
          </motion.h1>

          {/* subhead */}
          <motion.p
            custom={0.35}
            variants={fade}
            className="text-base sm:text-lg md:text-xl text-slate-500 max-w-2xl mx-auto mb-10 leading-relaxed font-light"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            High-performance decentralized custody & liquidity settlement on{" "}
            <span className="font-semibold text-slate-700">Hedera</span> —
            institutional-grade security with sub-3-second finality.
          </motion.p>

          {/* CTAs */}
          <motion.div
            custom={0.5}
            variants={fade}
            className="flex flex-wrap justify-center gap-4 mb-14"
          >
            <Link to="/markets">
              <button
                className="relative h-14 px-10 text-white font-black uppercase tracking-[0.2em] text-[11px] cursor-pointer overflow-hidden group transition-transform hover:-translate-y-0.5 active:translate-y-0"
                style={{
                  background: `linear-gradient(135deg, ${BLUE}, #3b82f6)`,
                  boxShadow: `0 16px 40px -10px ${BLUE}55`,
                }}
              >
                <span className="relative z-10 flex items-center gap-3">
                  Launch App
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-transform group-hover:translate-x-1"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </span>
                {/* shimmer */}
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              </button>
            </Link>
            <a href="mailto:Info@Wrappdex.io">
              <button className="h-14 px-10 border-2 border-slate-200 text-slate-700 font-black uppercase tracking-[0.2em] text-[11px] cursor-pointer bg-white/60 backdrop-blur-sm hover:border-slate-900 hover:bg-white transition-all duration-300">
                Partner With Us
              </button>
            </a>
          </motion.div>

          {/* trust metrics */}
          <motion.div
            custom={0.65}
            variants={fade}
            className="flex justify-center gap-8 sm:gap-14 mb-16 sm:mb-20"
          >
            {[
              { label: "Avg Transaction Fee", value: fee },
              { label: "Finality", value: "< 3 sec" },
              { label: "Hedera-native", value: "100%" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums">
                  {s.value}
                </div>
                <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1">
                  {s.label}
                </div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>

      {/* ══════════════════════════════════════════
          DEVICE SHOWCASE  — full-width, centred
         ══════════════════════════════════════════ */}
      <div className="relative z-10 container mx-auto px-6 pb-20 sm:pb-28">
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative max-w-5xl mx-auto"
        >
          {/* Ambient glow */}
          <div
            className="absolute -inset-20 z-0 rounded-full pointer-events-none transition-opacity duration-700"
            style={{
              opacity: hovered ? 0.35 : 0.15,
              background: `radial-gradient(ellipse at center, ${BLUE}22 0%, transparent 70%)`,
            }}
          />

          {/* Floating teaser badges */}
          <TeaserBadge
            icon={TrendingUp}
            label="Markets"
            value="Top 50 Tokens"
            accent="#10b981"
            className="-top-6 left-0 xl:-left-16"
            delay={0.9}
          />
          <TeaserBadge
            icon={ArrowRightLeft}
            label="Swap"
            value="Instant Trades"
            accent={BLUE}
            className="top-1/4 -left-4 xl:-left-20"
            delay={1.1}
          />
          <TeaserBadge
            icon={BarChart3}
            label="HBAR"
            value="$0.097"
            accent="#06b6d4"
            className="-top-6 right-0 xl:-right-12"
            delay={1.0}
          />
          <TeaserBadge
            icon={Zap}
            label="Finality"
            value="< 3 seconds"
            accent="#f59e0b"
            className="top-[38%] -right-4 xl:-right-20"
            delay={1.2}
          />
          <TeaserBadge
            icon={ShieldCheck}
            label="Custody"
            value="Non-Custodial"
            accent="#8b5cf6"
            className="bottom-28 -left-4 xl:-left-16"
            delay={1.3}
          />
          <TeaserBadge
            icon={Landmark}
            label="DAO"
            value="Governance"
            accent="#ec4899"
            className="bottom-28 -right-4 xl:-right-12"
            delay={1.4}
          />

          {/* ── Clickable device area ── */}
          <Link
            to="/markets"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="block relative group cursor-pointer"
          >
            {/* ── DESKTOP ── */}
            <div
              className="relative z-10 rounded-2xl overflow-hidden transition-shadow duration-700"
              style={{
                boxShadow: hovered
                  ? `0 60px 120px -30px rgba(0,0,0,0.35), 0 0 80px -20px ${BLUE}20`
                  : "0 40px 80px -20px rgba(0,0,0,0.20), 0 0 0 1px rgba(0,0,0,0.04)",
              }}
            >
              {/* browser chrome */}
              <div className="h-10 sm:h-11 bg-[#0f172a] flex items-center px-3 sm:px-5 gap-2 border-b border-slate-700/40">
                <div className="flex gap-[6px]">
                  <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                  <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
                  <span className="w-3 h-3 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="hidden sm:flex bg-slate-800/60 rounded-lg px-4 py-1.5 items-center gap-2 max-w-sm w-full">
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#64748b"
                      strokeWidth="2.5"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <span className="text-[11px] text-slate-400 font-medium">
                      wrapp.finance/markets
                    </span>
                  </div>
                </div>
                <div className="w-14 hidden sm:block" />
              </div>

              {/* screen */}
              <div className="relative aspect-[16/9.5] bg-[#0b1120]">
                <img
                  src={desktopDark}
                  alt="Wrappdex PC Dashboard Dark"
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
                  style={{ opacity: hovered ? 0 : 1 }}
                />
                <img
                  src={desktopLight}
                  alt="Wrappdex PC Dashboard Light"
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
                  style={{ opacity: hovered ? 1 : 0 }}
                />

                {/* scan line */}
                <div
                  className="absolute left-0 right-0 h-[1px] z-20 pointer-events-none animate-scan"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, ${BLUE}30 30%, ${CYAN}30 70%, transparent 100%)`,
                    boxShadow: `0 0 12px 3px ${BLUE}10`,
                  }}
                />

                {/* subtle glare */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
              </div>
            </div>

            {/* desktop stand */}
            <div className="relative z-10 flex flex-col items-center">
              <div
                className="w-24 h-10 bg-gradient-to-b from-slate-200 to-slate-300"
                style={{
                  clipPath: "polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)",
                }}
              />
              <div className="w-48 h-[6px] bg-gradient-to-b from-slate-300 to-slate-200 rounded-full shadow-sm -mt-px" />
            </div>

            {/* ── MOBILE ── */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="absolute z-20 w-[110px] sm:w-[140px] md:w-[160px] lg:w-[180px] top-4 sm:top-0 right-2 sm:-right-4 md:-right-8 lg:-right-12"
            >
              <div
                className="bg-black rounded-[1.6rem] sm:rounded-[2rem] p-[4px] sm:p-[5px] overflow-hidden transition-shadow duration-700"
                style={{
                  boxShadow: hovered
                    ? `0 40px 80px -10px rgba(0,0,0,0.50), 0 0 60px -10px ${BLUE}15`
                    : "0 25px 50px -10px rgba(0,0,0,0.40)",
                  border: "3px solid #1e293b",
                }}
              >
                {/* notch */}
                <div className="absolute top-[3px] sm:top-[5px] left-1/2 -translate-x-1/2 w-10 sm:w-14 h-3 sm:h-4 bg-black rounded-b-xl z-30" />

                {/* screen */}
                <div className="relative aspect-[9/19.5] rounded-[1.3rem] sm:rounded-[1.7rem] overflow-hidden bg-black">
                  <img
                    src={mobileDark}
                    alt="Wrappdex Mobile App Dark"
                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
                    style={{ opacity: hovered ? 0 : 1 }}
                  />
                  <img
                    src={mobileLight}
                    alt="Wrappdex Mobile App Light"
                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
                    style={{ opacity: hovered ? 1 : 0 }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] via-transparent to-transparent pointer-events-none" />
                </div>

                {/* home indicator */}
                <div className="absolute bottom-1.5 sm:bottom-2 left-1/2 -translate-x-1/2 w-8 sm:w-10 h-[3px] bg-white/20 rounded-full z-30" />
              </div>
            </motion.div>

            {/* ── ENTER PLATFORM overlay ── */}
            <AnimatePresence>
              {hovered && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
                >
                  <div
                    className="rounded-2xl px-10 py-5 pointer-events-auto"
                    style={{
                      background: "rgba(255,255,255,0.93)",
                      backdropFilter: "blur(24px)",
                      border: "1px solid rgba(255,255,255,0.7)",
                      boxShadow: `0 30px 80px -15px rgba(0,0,0,0.25), 0 0 40px -10px ${BLUE}15`,
                    }}
                  >
                    <span className="flex items-center gap-3 text-[12px] font-black uppercase tracking-[0.4em] text-slate-900">
                      <span
                        className="w-2.5 h-2.5 rounded-full animate-pulse"
                        style={{ backgroundColor: BLUE }}
                      />
                      Enter Platform
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Link>
        </motion.div>
      </div>

      {/* bottom fade */}
      <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-white to-transparent z-[5]" />

      {/* scan-line keyframes */}
      <style>{`
        @keyframes scan {
          0% { top: -5%; }
          100% { top: 105%; }
        }
        .animate-scan {
          animation: scan 5s linear infinite;
          animation-delay: 2s;
        }
      `}</style>
    </section>
  );
}
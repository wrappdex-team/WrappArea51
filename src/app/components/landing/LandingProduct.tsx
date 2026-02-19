import { useState } from "react";
import { motion, useMotionValue, useTransform } from "motion/react";
import { Link } from "react-router";
import {
  TrendingUp,
  BarChart3,
  ArrowRightLeft,
  DollarSign,
  Layers,
  Vote,
  Globe,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { useScreenshotUrls } from "./useScreenshotUrls";

const BLUE = "#1D63ED";
const CYAN = "#06b6d4";
const VIOLET = "#7C3AED";
const EMERALD = "#10B981";
const AMBER = "#F59E0B";

// Screenshot filenames — resolved to signed URLs at runtime via useScreenshotUrls
const SCREENSHOT_FILES = {
  tradeamm: "tradeamm.png",
  swap: "swap.png",
  wallet: "wallet.png",
  dao: "DAO.png",
  vip: "vip.png",
  bridges: "bridges.png",
};

/* ── screenshot cards with bento sizing ── */
const makeFeatured = (urls: Record<string, string>) => [
  {
    icon: BarChart3,
    title: "Trading Terminal",
    desc: "Pro-grade candlestick charts with 10 timeframes, 6 technical indicators, persistent drawing tools, and sub-cent price granularity.",
    route: "/trading",
    screenshot: urls[SCREENSHOT_FILES.tradeamm] || "",
    accent: BLUE,
    span: "md:col-span-2 md:row-span-2", // hero card
    badge: "Most Popular",
    badgeColor: BLUE,
  },
  {
    icon: ArrowRightLeft,
    title: "Swap",
    desc: "Dual-engine swaps via our native AMM and SaucerSwap routing. Configurable slippage and route visualization.",
    route: "/swap",
    screenshot: urls[SCREENSHOT_FILES.swap] || "",
    accent: CYAN,
    span: "md:col-span-1 md:row-span-1",
    badge: "Lightning Fast",
    badgeColor: CYAN,
  },
  {
    icon: DollarSign,
    title: "Buy / Sell",
    desc: "Fiat on-ramp via ChangeNOW with 100+ supported currencies. CEX-style trade panel.",
    route: "/buy-sell",
    screenshot: urls[SCREENSHOT_FILES.wallet] || "",
    accent: EMERALD,
    span: "md:col-span-1 md:row-span-1",
    badge: "100+ Currencies",
    badgeColor: EMERALD,
  },
  {
    icon: Vote,
    title: "DAO Governance",
    desc: "Create and vote on proposals across 8 categories. Token-weighted, verified on-chain via Mirror Node.",
    route: "/dao",
    screenshot: urls[SCREENSHOT_FILES.dao] || "",
    accent: VIOLET,
    span: "md:col-span-1 md:row-span-1",
    badge: "Community First",
    badgeColor: VIOLET,
  },
  {
    icon: Layers,
    title: "DeFi Suite",
    desc: "Constant-product AMM with 13 whitelisted tokens, Bonzo Finance lending, and USDC-hop smart routing.",
    route: "/defi",
    screenshot: urls[SCREENSHOT_FILES.vip] || "",
    accent: AMBER,
    span: "md:col-span-1 md:row-span-1",
    badge: "Yield Farming",
    badgeColor: AMBER,
  },
  {
    icon: Globe,
    title: "Cross-Chain Bridges",
    desc: "Squid Router (60+ chains), HashPort (Hedera official), and Stargate (LayerZero) — one unified interface.",
    route: "/bridges",
    screenshot: urls[SCREENSHOT_FILES.bridges] || "",
    accent: CYAN,
    span: "md:col-span-1 md:row-span-1",
    badge: "60+ Chains",
    badgeColor: CYAN,
  },
];

const stats = [
  { value: "38", label: "Supported Tokens", icon: Sparkles },
  { value: "8", label: "Platform Modules", icon: Layers },
  { value: "3", label: "Bridge Protocols", icon: Globe },
  { value: "6", label: "Chart Indicators", icon: BarChart3 },
  { value: "10", label: "Timeframes", icon: TrendingUp },
  { value: "100+", label: "Fiat Currencies", icon: DollarSign },
];

/* ── Tilt card wrapper ── */
function TiltCard({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rotateX = useTransform(y, [0, 1], [4, -4]);
  const rotateY = useTransform(x, [0, 1], [-4, 4]);

  function handleMouse(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width);
    y.set((e.clientY - rect.top) / rect.height);
  }
  function handleLeave() {
    x.set(0.5);
    y.set(0.5);
  }

  return (
    <motion.div
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", ...style }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ── Animated counter ── */
function AnimatedStat({ value, label, icon: Icon }: (typeof stats)[0]) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="relative flex flex-col items-center gap-1.5 px-4 py-3 cursor-default"
    >
      <motion.div
        animate={{ scale: hovered ? 1.15 : 1, y: hovered ? -2 : 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
      >
        <Icon
          size={14}
          style={{ color: hovered ? BLUE : "#94a3b8" }}
          className="transition-colors duration-300"
        />
      </motion.div>
      <div
        className="text-xl md:text-2xl font-black tracking-tight transition-colors duration-300"
        style={{ color: hovered ? BLUE : "#0f172a" }}
      >
        {value}
      </div>
      <div className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400">
        {label}
      </div>
      {hovered && (
        <motion.div
          layoutId="stat-glow"
          className="absolute inset-0 rounded-xl -z-10"
          style={{ background: `${BLUE}08` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}
    </motion.div>
  );
}

export function LandingProduct() {
  const { sampleshots, loading: urlsLoading } = useScreenshotUrls();
  const featured = makeFeatured(sampleshots);

  return (
    <section
      className="py-12 sm:py-16 md:py-24 bg-white relative overflow-hidden"
      id="platform"
      style={{ borderBottom: "1px solid #e2e8f0" }}
    >
      {/* Animated gradient background blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ x: [0, 60, 0], y: [0, -40, 0], scale: [1, 1.2, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full blur-[120px] opacity-[0.06]"
          style={{ background: `linear-gradient(135deg, ${BLUE}, ${CYAN})` }}
        />
        <motion.div
          animate={{ x: [0, -50, 0], y: [0, 50, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -bottom-32 -left-32 w-[600px] h-[600px] rounded-full blur-[120px] opacity-[0.05]"
          style={{ background: `linear-gradient(135deg, ${VIOLET}, ${BLUE})` }}
        />
        <motion.div
          animate={{ x: [0, 30, 0], y: [0, -30, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full blur-[100px] opacity-[0.03]"
          style={{ background: `linear-gradient(135deg, ${EMERALD}, ${CYAN})` }}
        />
      </div>

      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, #1D63ED 0.6px, transparent 0.6px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="text-center mb-10 md:mb-14"
        >
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.35em] px-4 py-2 mb-6 rounded-full"
            style={{
              color: BLUE,
              background: `linear-gradient(135deg, ${BLUE}0a, ${CYAN}0a)`,
              border: `1px solid ${BLUE}15`,
            }}
          >
            <Sparkles size={11} />
            The Platform
          </motion.span>

          <h2
            className="text-3xl sm:text-4xl md:text-6xl text-black tracking-tight leading-[0.95] mb-5"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Trade smarter. <br />
            <span
              className="italic bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(135deg, ${BLUE}, ${CYAN})`,
                WebkitBackgroundClip: "text",
              }}
            >
              Not harder.
            </span>
          </h2>

          <p
            className="text-base md:text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed font-light"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Eight modules. One interface. Zero compromise. Swap, chart, bridge,
            lend, and vote — all on{" "}
            <span
              className="font-semibold bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(90deg, ${BLUE}, ${VIOLET})`,
                WebkitBackgroundClip: "text",
              }}
            >
              Hedera
            </span>
            .
          </p>
        </motion.div>

        {/* ── Bento Grid ── */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4"
          style={{ perspective: "1200px" }}
        >
          {featured.map((mod, i) => (
            <TiltCard
              key={mod.title}
              className={`${mod.span} group`}
              style={{ transformStyle: "preserve-3d" }}
            >
              <Link
                to={mod.route}
                className="relative block h-full rounded-2xl overflow-hidden no-underline transition-all duration-500"
                style={{
                  background: "#f8fafc",
                  border: "1px solid #f1f5f9",
                }}
              >
                {/* Hover glow ring */}
                <div
                  className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 -z-0 pointer-events-none"
                  style={{
                    boxShadow: `inset 0 0 0 1px ${mod.accent}30, 0 0 40px ${mod.accent}10`,
                  }}
                />

                {/* Screenshot */}
                <div
                  className={`relative overflow-hidden ${
                    mod.span.includes("row-span-2")
                      ? "aspect-auto h-[220px] sm:h-[280px] md:h-full md:min-h-[400px]"
                      : "aspect-[16/10]"
                  }`}
                >
                  <img
                    src={mod.screenshot}
                    alt={`${mod.title} screenshot`}
                    className="w-full h-full object-cover object-top transition-all duration-700 group-hover:scale-[1.04]"
                    loading="lazy"
                  />
                  {/* Gradient overlay — always visible for text legibility */}
                  <div
                    className="absolute inset-0 transition-opacity duration-500"
                    style={{
                      background: `linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 40%, transparent 70%)`,
                    }}
                  />
                  {/* Extra top fade on hover for immersion */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700"
                    style={{
                      background: `linear-gradient(135deg, ${mod.accent}15 0%, transparent 60%)`,
                    }}
                  />
                </div>

                {/* Content overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 md:p-6 z-10">
                  {/* Badge */}
                  <span
                    className="inline-flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[0.18em] px-2.5 py-1 rounded-full mb-3 backdrop-blur-sm"
                    style={{
                      color: mod.badgeColor,
                      background: `${mod.badgeColor}20`,
                      border: `1px solid ${mod.badgeColor}30`,
                    }}
                  >
                    <mod.icon size={10} />
                    {mod.badge}
                  </span>

                  <h3
                    className="text-lg sm:text-xl md:text-2xl text-white mb-1.5 group-hover:italic transition-all duration-500"
                    style={{ fontFamily: "'Playfair Display', serif" }}
                  >
                    {mod.title}
                  </h3>

                  <p
                    className="text-white/60 text-[11px] leading-relaxed font-light max-w-md mb-3 line-clamp-2"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  >
                    {mod.desc}
                  </p>

                  <span
                    className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em] transition-all duration-300 group-hover:gap-2.5"
                    style={{ color: mod.accent }}
                  >
                    Launch Module
                    <ArrowUpRight
                      size={13}
                      className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
                    />
                  </span>
                </div>
              </Link>
            </TiltCard>
          ))}
        </motion.div>

        {/* ── Stats Bar ── */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="mt-10 md:mt-14 rounded-xl py-6 md:py-8 px-4"
          style={{
            background: "linear-gradient(135deg, #fafbff 0%, #f8fafc 100%)",
            border: "1px solid #f1f5f9",
          }}
        >
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 md:gap-x-5">
            {stats.map((stat) => (
              <AnimatedStat key={stat.label} {...stat} />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
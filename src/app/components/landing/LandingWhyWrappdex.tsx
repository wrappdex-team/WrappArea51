import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Coins,
  ShieldOff,
  Monitor,
  TrendingUp,
  Ban,
} from "lucide-react";

const BLUE = "#1D63ED";
const CYAN = "#06b6d4";
const RED = "#ef4444";
const EMERALD = "#10B981";

interface HotWord {
  text: string;
  accent: string;
  icon: React.ElementType;
  hint: string;
  italic?: boolean;
  strikeOnHover?: boolean;
}

const words: HotWord[] = [
  {
    text: "50 curated tokens.",
    accent: BLUE,
    icon: Coins,
    hint: "Hand-picked. Audited. No rugs.",
  },
  {
    text: "Zero meme coins.",
    accent: RED,
    icon: ShieldOff,
    hint: "We filter the noise so you don't have to.",
    strikeOnHover: true,
  },
  {
    text: "One pro-grade interface",
    accent: CYAN,
    icon: Monitor,
    hint: "Charts, swaps, bridges, governance — unified.",
    italic: true,
  },
  {
    text: " — built for traders who",
    accent: "#94a3b8",
    icon: TrendingUp,
    hint: "",
  },
  {
    text: "move markets,",
    accent: EMERALD,
    icon: TrendingUp,
    hint: "Real volume. Real liquidity. Real edge.",
  },
  {
    text: "not chase pumps.",
    accent: RED,
    icon: Ban,
    hint: "Leave the casino. Enter the exchange.",
    strikeOnHover: true,
  },
];

function InteractivePhrase({ word }: { word: HotWord }) {
  const [hovered, setHovered] = useState(false);
  const isPassive = !word.hint;

  return (
    <motion.span
      className="relative inline cursor-default"
      onMouseEnter={() => !isPassive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* The text */}
      <motion.span
        className="relative z-10 transition-colors duration-500"
        animate={{
          color: hovered ? word.accent : isPassive ? "#94a3b8" : "#e2e8f0",
        }}
        style={{
          fontStyle: word.italic ? "italic" : undefined,
          textDecoration:
            word.strikeOnHover && hovered ? "line-through" : "none",
          textDecorationColor: word.strikeOnHover ? word.accent : undefined,
          textDecorationThickness: "3px",
        }}
      >
        {word.text}
      </motion.span>

      {/* Glow underline */}
      {!isPassive && (
        <motion.span
          className="absolute -bottom-1 left-0 right-0 h-[3px] rounded-full origin-left"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{
            scaleX: hovered ? 1 : 0,
            opacity: hovered ? 1 : 0,
          }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          style={{
            background: `linear-gradient(90deg, ${word.accent}, ${word.accent}60)`,
            boxShadow: hovered
              ? `0 0 16px ${word.accent}50, 0 0 40px ${word.accent}20`
              : "none",
          }}
        />
      )}

      {/* Floating hint pill */}
      <AnimatePresence>
        {hovered && word.hint && (
          <motion.span
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute left-1/2 -translate-x-1/2 -bottom-14 z-30 whitespace-nowrap flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] pointer-events-none"
            style={{
              background: `${word.accent}18`,
              border: `1px solid ${word.accent}30`,
              color: word.accent,
              backdropFilter: "blur(12px)",
              boxShadow: `0 8px 32px ${word.accent}15`,
            }}
          >
            <word.icon size={11} />
            {word.hint}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.span>
  );
}

export function LandingWhyWrappdex() {
  return (
    <section
      className="relative py-14 sm:py-20 md:py-28 overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #080b14 0%, #0c1021 50%, #080b14 100%)",
      }}
    >
      {/* Animated gradient orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ x: [0, 50, 0], y: [0, -30, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-0 left-1/4 w-[400px] h-[400px] rounded-full blur-[160px] opacity-[0.07]"
          style={{ background: `linear-gradient(135deg, ${BLUE}, ${CYAN})` }}
        />
        <motion.div
          animate={{ x: [0, -40, 0], y: [0, 40, 0] }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-0 right-1/4 w-[350px] h-[350px] rounded-full blur-[140px] opacity-[0.05]"
          style={{ background: `linear-gradient(135deg, ${RED}80, ${BLUE})` }}
        />
      </div>

      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, #ffffff 0.4px, transparent 0.4px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="container mx-auto px-4 relative z-10">
        {/* Eyebrow */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-6 sm:mb-8 md:mb-10"
        >
          <span
            className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.4em] px-4 py-2 rounded-full"
            style={{
              color: BLUE,
              background: `${BLUE}10`,
              border: `1px solid ${BLUE}20`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: BLUE }}
            />
            Why WRAPpDEX
          </span>
        </motion.div>

        {/* ── The Power Statement ── */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="max-w-4xl mx-auto text-center"
        >
          <h2
            className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl leading-[1.2] sm:leading-[1.2] md:leading-[1.25] tracking-tight font-semibold"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {words.map((w, i) => (
              <InteractivePhrase key={i} word={w} />
            ))}
          </h2>
        </motion.div>

        {/* Instruction hint */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="text-center mt-6 md:mt-8 text-[9px] font-bold uppercase tracking-[0.35em] text-white/15 hidden sm:block"
        >
          Hover each phrase ↑
        </motion.p>

        {/* Divider stats strip */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="flex flex-wrap justify-center gap-6 sm:gap-8 md:gap-12 mt-8 sm:mt-12 md:mt-14 pt-8 sm:pt-10"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          {[
            { val: "50", label: "Curated Tokens", color: BLUE },
            { val: "0", label: "Meme Coins Listed", color: RED },
            { val: "8", label: "Pro Modules", color: CYAN },
            { val: "3s", label: "Avg Finality", color: EMERALD },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1.5">
              <span
                className="text-2xl md:text-3xl font-black tracking-tight"
                style={{ color: s.color }}
              >
                {s.val}
              </span>
              <span className="text-[8px] font-bold uppercase tracking-[0.25em] text-white/25">
                {s.label}
              </span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
/**
 * SwapCardPro — Premium glassmorphic swap card shell with animated gradient border.
 *
 * Wraps the swap interface in a visually stunning container with:
 * - Animated gradient border (pink -> purple -> cyan rotation)
 * - Deep glassmorphism backdrop
 * - Subtle ambient glow behind the card
 * - Header with SaucerSwap + 1inch branding
 * - Responsive design
 */

import { memo, type ReactNode } from "react";
import { motion } from "motion/react";
import { SAUCERSWAP_LARRY_LOGO, ONEINCH_LOGO, HEDERA_LOGO } from "../assets/brand";

interface SwapCardProProps {
  children: ReactNode;
  isDark: boolean;
  /** Optional title override */
  title?: string;
  /** Show the venue logos header */
  showVenues?: boolean;
}

export const SwapCardPro = memo(function SwapCardPro({
  children,
  isDark,
  title = "Swap",
  showVenues = true,
}: SwapCardProProps) {
  return (
    <div className="relative">
      {/* Ambient glow */}
      <div
        className="absolute -inset-3 rounded-3xl opacity-30 blur-2xl pointer-events-none"
        style={{
          background: isDark
            ? "radial-gradient(ellipse at 30% 20%, rgba(236,72,153,0.15), transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(139,92,246,0.12), transparent 60%)"
            : "radial-gradient(ellipse at 30% 20%, rgba(236,72,153,0.08), transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(139,92,246,0.06), transparent 60%)",
        }}
      />

      {/* Animated gradient border */}
      <div className="relative rounded-2xl p-[1px] overflow-hidden">
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            backgroundImage: isDark
              ? "linear-gradient(135deg, rgba(236,72,153,0.3), rgba(139,92,246,0.2), rgba(6,182,212,0.15), rgba(236,72,153,0.3))"
              : "linear-gradient(135deg, rgba(236,72,153,0.15), rgba(139,92,246,0.1), rgba(6,182,212,0.08), rgba(236,72,153,0.15))",
            backgroundSize: "300% 300%",
            animation: "gradientShift 8s ease-in-out infinite",
          }}
        />

        {/* Card body */}
        <div
          className={`relative rounded-2xl ${
            isDark
              ? "bg-[#0c0f1a]/95 backdrop-blur-2xl"
              : "bg-white/95 backdrop-blur-2xl shadow-xl"
          }`}
        >
          {/* Header */}
          <div className={`px-5 pt-4 pb-2 flex items-center justify-between ${
            isDark ? "border-b border-white/[0.04]" : "border-b border-gray-100"
          }`}>
            <div className="flex items-center gap-2.5">
              <img
                src={SAUCERSWAP_LARRY_LOGO}
                alt=""
                className="w-7 h-7 rounded-lg"
                width={28}
                height={28}
              />
              <h2 className={`text-lg font-extrabold tracking-tight ${
                isDark ? "text-white" : "text-slate-900"
              }`}>
                {title}
              </h2>
            </div>

            {showVenues && (
              <div className="flex items-center gap-1">
                <VenuePill
                  logo={SAUCERSWAP_LARRY_LOGO}
                  label="SaucerSwap"
                  href="https://www.saucerswap.finance"
                  isDark={isDark}
                  color="emerald"
                />
                <VenuePill
                  logo={ONEINCH_LOGO}
                  label="1inch"
                  href="https://1inch.io"
                  isDark={isDark}
                  color="red"
                />
                <VenuePill
                  logo={HEDERA_LOGO}
                  label="Hedera"
                  href="https://hedera.com"
                  isDark={isDark}
                  color="slate"
                />
              </div>
            )}
          </div>

          {/* Content */}
          <div className="px-5 pt-4 pb-5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
});

// ── Venue Pill ────────────────────────────────────────────────────────

interface VenuePillProps {
  logo: string;
  label: string;
  href: string;
  isDark: boolean;
  color: "emerald" | "red" | "slate" | "blue";
}

const colorMap = {
  emerald: {
    dark: "bg-emerald-500/8 border-emerald-500/15 hover:bg-emerald-500/15 hover:border-emerald-500/25",
    light: "bg-emerald-50/80 border-emerald-200/60 hover:bg-emerald-100 hover:border-emerald-300",
  },
  red: {
    dark: "bg-red-500/8 border-red-500/15 hover:bg-red-500/15 hover:border-red-500/25",
    light: "bg-red-50/80 border-red-200/60 hover:bg-red-100 hover:border-red-300",
  },
  slate: {
    dark: "bg-slate-500/8 border-slate-500/15 hover:bg-slate-500/15 hover:border-slate-500/25",
    light: "bg-slate-50/80 border-slate-200/60 hover:bg-slate-100 hover:border-slate-300",
  },
  blue: {
    dark: "bg-blue-500/8 border-blue-500/15 hover:bg-blue-500/15 hover:border-blue-500/25",
    light: "bg-blue-50/80 border-blue-200/60 hover:bg-blue-100 hover:border-blue-300",
  },
};

function VenuePill({ logo, label, href, isDark, color }: VenuePillProps) {
  const colors = colorMap[color];
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-semibold transition-all cursor-pointer ${
        isDark ? colors.dark : colors.light
      } ${isDark ? "text-slate-400" : "text-slate-500"}`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <img
        src={logo}
        alt={label}
        className="w-3.5 h-3.5 rounded-full"
        loading="eager"
        width={14}
        height={14}
      />
      <span className="hidden sm:inline">{label}</span>
    </motion.a>
  );
}
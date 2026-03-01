import { useTheme } from "../contexts/ThemeContext";

/**
 * IMPLEMENTATION NOTE: Premium "Beta" badge — brand-themed (pink/purple)
 * with institutional styling. Theme-aware for dark and light modes.
 */
export function BetaBadge() {
  const { isDark, isSky } = useTheme();

  const brand = isSky
    ? {
        dark: "bg-sky-500/[0.08] border-sky-400/25 text-sky-300/90",
        light: "bg-sky-600/[0.07] border-sky-500/25 text-sky-700/80",
        glow: isDark
          ? "from-transparent via-sky-400/20 to-transparent"
          : "from-transparent via-sky-400/12 to-transparent",
        dot: isDark
          ? "bg-sky-400/70 shadow-[0_0_3px_rgba(14,165,233,0.2)]"
          : "bg-sky-500/50",
      }
    : {
        dark: "bg-pink-500/[0.08] border-pink-400/25 text-pink-300/90",
        light: "bg-pink-600/[0.07] border-pink-500/20 text-pink-700/80",
        glow: isDark
          ? "from-transparent via-pink-400/20 to-transparent"
          : "from-transparent via-pink-400/12 to-transparent",
        dot: isDark
          ? "bg-pink-400/70 shadow-[0_0_3px_rgba(236,72,153,0.2)]"
          : "bg-pink-500/50",
      };

  return (
    <span
      className={`
        relative inline-flex items-center gap-[2px] select-none
        px-[5px] py-[1.5px] rounded-[3px]
        text-[8px] sm:text-[9px] font-semibold tracking-[0.1em] uppercase leading-none
        border backdrop-blur-sm
        transition-all duration-500 ease-out
        ${isDark ? brand.dark : brand.light}
      `}
      aria-label="Beta version"
    >
      {/* Top-edge highlight */}
      <span
        className={`absolute inset-x-[1px] top-[0.5px] h-px rounded-full bg-gradient-to-r ${brand.glow}`}
      />

      {/* Dot accent */}
      <span
        className={`inline-block w-[4px] h-[4px] rounded-full flex-shrink-0 ${brand.dot}`}
      />

      <span className="relative">Beta</span>
    </span>
  );
}

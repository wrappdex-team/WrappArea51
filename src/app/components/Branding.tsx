import { useRef, useState, useEffect } from "react";
import { Link } from "react-router";
import { motion, useInView } from "motion/react";
import { log } from "../utils/logger";
import {
  ArrowLeft,
  Copy,
  Check,
  Palette,
  Type,
  Image,
  Layers,
  Shield,
  XCircle,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import {
  HBARH_LOGO_DARK,
  HBARH_LOGO_LIGHT,
  HBARH_BRANDING_DARK,
  HBARH_BRANDING_LIGHT,
  HBAR_LOGO,
} from "../assets/brand";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";

/* ─── Real Logo Assets ─────────────────────────────────────────────── */
// On mount the Branding page fetches real logos from the "WRAPP LOGOS"
// Supabase storage bucket via the /brand-logos server endpoint.
// The data-URI SVGs from brand.ts are used as instant placeholders while
// the fetch resolves (or as permanent fallbacks if the fetch fails).
const fallbackDark = HBARH_BRANDING_DARK;
const fallbackLight = HBARH_BRANDING_LIGHT;

/* ─── Helpers ──────────────────────────────────────────────────────── */

function Section({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

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

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { isDark } = useTheme();
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-all ${
        copied
          ? isDark
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-emerald-50 text-emerald-600"
          : isDark
            ? "bg-white/[0.05] text-slate-400 hover:text-white hover:bg-white/[0.1]"
            : "bg-gray-100 text-gray-500 hover:text-gray-900 hover:bg-gray-200"
      }`}
      title={`Copy ${label}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

/* ─── Brand Color Card (Premium tall-swatch style) ─────────────────── */

/**
 * Determines if a given color string represents a "light" color where dark
 * overlay text would be more legible than white text.
 */
function isLightColor(hex: string): boolean {
  if (hex.startsWith("rgba")) return true; // transparent = light against card bg
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return false;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  // Perceived luminance formula
  return (r * 299 + g * 587 + b * 114) / 1000 > 180;
}

function BrandColorCard({
  name,
  hex,
  category,
  usage,
  featured = false,
}: {
  name: string;
  hex: string;
  category: string;
  usage: string;
  featured?: boolean;
}) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(hex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col">
      {featured && (
        <div className="h-1 rounded-t-full bg-[#1D63ED]" />
      )}
      <GlassCard
        className={`p-4 flex flex-col flex-1${featured ? " rounded-t-none border-t-0" : ""}`}
        hover={false}
      >
        {/* Tall color swatch */}
        <div className="relative group mb-5">
          <div
            className={`w-full aspect-[4/3] rounded-xl flex items-center justify-center ${
              featured
                ? "border-2 border-dashed border-[#1D63ED]/40"
                : isDark
                  ? "border border-white/[0.06]"
                  : "border border-gray-200"
            }`}
            style={{ backgroundColor: hex }}
          >
            <button
              onClick={handleCopy}
              className={`flex flex-col items-center gap-1.5 px-4 py-2.5 rounded-xl transition-all duration-200 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
                copied
                  ? isLightColor(hex)
                    ? "bg-emerald-600/30 text-emerald-800"
                    : "bg-emerald-500/30 text-emerald-300"
                  : isLightColor(hex)
                    ? "bg-white/20 backdrop-blur-sm text-slate-800 opacity-0 group-hover:opacity-100 hover:bg-white/30 hover:text-slate-900"
                    : "bg-black/20 backdrop-blur-sm text-white/80 opacity-0 group-hover:opacity-100 hover:bg-black/30 hover:text-white"
              }`}
            >
              {copied ? (
                <Check className="w-5 h-5" />
              ) : (
                <Copy className="w-5 h-5" />
              )}
              <span className="text-xs font-bold uppercase tracking-wider">
                {copied ? "Copied" : "Copy Hex"}
              </span>
            </button>
          </div>
        </div>

        <h4
          className={`text-base font-bold italic mb-1 ${
            isDark ? "text-white" : "text-slate-900"
          }`}
        >
          {name}
        </h4>

        <p className="text-xs font-bold uppercase tracking-wider mb-2 bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
          {category}
        </p>

        <p
          className={`text-xs leading-relaxed mb-4 flex-1 ${
            isDark ? "text-slate-400" : "text-gray-500"
          }`}
        >
          {usage}
        </p>

        <div
          className={`flex items-center justify-between pt-3 mt-auto border-t ${
            isDark ? "border-white/[0.06]" : "border-gray-200"
          }`}
        >
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${
              isDark ? "text-slate-500" : "text-gray-400"
            }`}
          >
            Hex
          </span>
          <span
            className={`text-sm font-mono font-bold ${
              isDark ? "text-slate-300" : "text-slate-700"
            }`}
          >
            {hex}
          </span>
        </div>
      </GlassCard>
    </div>
  );
}

/* ─── Logo Preview Card ────────────────────────────────────────────── */

function LogoPreview({
  src,
  title,
  bg,
  width = "w-48",
}: {
  src: string;
  title: string;
  bg: string;
  width?: string;
}) {
  const { isDark } = useTheme();
  return (
    <GlassCard className="p-5 text-center">
      <div className={`${bg} rounded-xl p-6 mb-3 flex items-center justify-center min-h-[80px]`}>
        <img src={src} alt={title} className={`${width} h-auto`} />
      </div>
      <p className={`text-xs font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>
        {title}
      </p>
    </GlassCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export function Branding() {
  const { isDark } = useTheme();

  // ── Fetch real logos from Supabase "WRAPP LOGOS" bucket ──
  const [logoDark, setLogoDark] = useState(fallbackDark);
  const [logoLight, setLogoLight] = useState(fallbackLight);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const base = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;
    fetch(`${base}/brand-logos`, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const logos: { name: string; publicUrl: string }[] = data?.logos ?? [];
        if (logos.length === 0) return;

        // Match filenames: anything containing "dark" goes to dark slot,
        // anything containing "light" (or "white") goes to light slot.
        // If only 2 files and neither matches, assign alphabetically (first=dark, second=light).
        const darkMatch = logos.find((l) => /dark/i.test(l.name));
        const lightMatch = logos.find((l) => /light|white/i.test(l.name));

        if (darkMatch && lightMatch) {
          setLogoDark(darkMatch.publicUrl);
          setLogoLight(lightMatch.publicUrl);
        } else if (logos.length >= 2) {
          // Alphabetical fallback
          const sorted = [...logos].sort((a, b) => a.name.localeCompare(b.name));
          setLogoDark(sorted[0].publicUrl);
          setLogoLight(sorted[1].publicUrl);
        } else if (logos.length === 1) {
          // Single image — use for both
          setLogoDark(logos[0].publicUrl);
          setLogoLight(logos[0].publicUrl);
        }
      })
      .catch((err) => {
        log.warn("Branding", "Brand logo fetch failed, using SVG fallbacks", err);
      });
  }, []);

  const h2 = `text-2xl md:text-3xl font-bold mb-2 bg-gradient-to-r bg-clip-text text-transparent ${
    isDark ? "from-white to-slate-400" : "from-slate-900 to-slate-600"
  }`;
  const subtitle = `text-xs md:text-sm mb-8 max-w-2xl ${isDark ? "text-slate-400" : "text-gray-500"}`;

  return (
    <div
      className={`min-h-screen ${
        isDark ? "bg-[#0F172A] text-white" : "bg-gray-50 text-slate-900"
      }`}
    >
      <div className="container mx-auto px-3 md:px-4 py-8 md:py-12 max-w-5xl">
        {/* Back to White Paper */}
        <Link
          to="/white-paper"
          className={`inline-flex items-center gap-2 text-xs mb-8 transition-colors ${
            isDark
              ? "text-slate-500 hover:text-white"
              : "text-gray-400 hover:text-gray-900"
          }`}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to White Paper
        </Link>

        {/* ═══ HERO ═══ */}
        <Section className="mb-16">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-6 bg-gradient-to-r from-violet-500/20 to-pink-500/20 text-pink-400 border border-pink-500/20">
              <Palette className="w-3.5 h-3.5" />
              Brand Assets
            </div>
            <h1 className="text-3xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              WRAPpDEX Brand Kit
            </h1>
            <p className={`text-sm md:text-base max-w-2xl mx-auto leading-relaxed ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Official branding guidelines, logos, colors, and typography for the
              WRAPpDEX platform and the HBAR.ħ Protocol ecosystem. Use these
              assets to maintain visual consistency across all communications.
            </p>
          </div>
        </Section>

        {/* ═══ LOGOS ═══ */}
        <Section className="mb-16" delay={0.1}>
          <div className="flex items-center gap-3 mb-2">
            <Image className={`w-5 h-5 ${isDark ? "text-pink-400" : "text-pink-600"}`} />
            <h2 className={h2}>Logos</h2>
          </div>
          <p className={subtitle}>
            Always use the correct variant for your background. Never stretch, rotate,
            or recolor the logos. Right-click &rarr; Save Image for high-res screenshots.
          </p>

          {/* ── Primary: Real Logos (large, screenshot-friendly) ── */}
          <h3 className={`text-sm font-bold mb-3 flex items-center gap-2 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-600 border border-emerald-200"}`}>
              Primary
            </span>
            Official WRAPpDEX Wordmark
          </h3>

          {/* Large dark-background logo */}
          <GlassCard className="p-6 md:p-10 mb-3" hover={false}>
            <div className="bg-[#0F172A] rounded-2xl p-8 md:p-14 flex items-center justify-center border border-white/[0.06]">
              <img
                src={logoDark}
                alt="WRAPpDEX Logo — Dark Background"
                className="w-full max-w-xl h-auto"
              />
            </div>
            <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
              <div>
                <p className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                  Dark Background Variant
                </p>
                <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  White WRAPP &middot; Blue p &middot; Silver DEX &mdash; use on dark backgrounds, glass cards, hero sections
                </p>
              </div>
              <CopyButton text="WRAPpDEX Logo (Dark)" label="Copy Name" />
            </div>
          </GlassCard>

          {/* Large light-background logo */}
          <GlassCard className="p-6 md:p-10 mb-6" hover={false}>
            <div className="bg-white rounded-2xl p-8 md:p-14 flex items-center justify-center border border-gray-200">
              <img
                src={logoLight}
                alt="WRAPpDEX Logo — Light Background"
                className="w-full max-w-xl h-auto"
              />
            </div>
            <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
              <div>
                <p className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                  Light Background Variant
                </p>
                <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Black WRAPP &middot; Blue p &middot; Gray DEX &mdash; use on white/light backgrounds, print, docs
                </p>
              </div>
              <CopyButton text="WRAPpDEX Logo (Light)" label="Copy Name" />
            </div>
          </GlassCard>

          {/* ── Logo Color Breakdown ── */}
          <h3 className={`text-sm font-bold mb-3 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            Wordmark Color Breakdown
          </h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <BrandColorCard
              name="Institutional Blue"
              hex="#1D63ED"
              category="Primary Identity"
              usage="Core brand color for wordmark and primary UI elements."
              featured
            />
            <BrandColorCard
              name="Sovereign Navy"
              hex="#0F172A"
              category="Background Foundation"
              usage="Primary dark mode background and high-contrast typography."
            />
            <BrandColorCard
              name="Clean White"
              hex="#FFFFFF"
              category="Surface Foundation"
              usage="Primary light mode background and inverted text elements."
            />
            <BrandColorCard
              name="Slate Silver"
              hex="#94A3B8"
              category="Functional Accents"
              usage="Secondary text, UI borders, and metadata visualization."
            />
          </div>

          {/* ── Side-by-side thumbs for quick comparison ── */}
          <h3 className={`text-sm font-bold mb-3 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            Side-by-Side Preview
          </h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            <GlassCard className="p-5 text-center">
              <div className="bg-[#0F172A] rounded-xl p-6 mb-3 flex items-center justify-center min-h-[80px] border border-white/[0.06]">
                <img src={logoDark} alt="WRAPpDEX Dark" className="w-48 h-auto" />
              </div>
              <p className={`text-xs font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                Dark Background
              </p>
            </GlassCard>
            <GlassCard className="p-5 text-center">
              <div className="bg-white rounded-xl p-6 mb-3 flex items-center justify-center min-h-[80px] border border-gray-200">
                <img src={logoLight} alt="WRAPpDEX Light" className="w-48 h-auto" />
              </div>
              <p className={`text-xs font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                Light Background
              </p>
            </GlassCard>
          </div>

          {/* ── Token Icons ── */}
          <h3 className={`text-sm font-bold mb-3 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            HBAR.ħ Protocol Token
          </h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <LogoPreview
              src={HBARH_LOGO_DARK}
              title="Token Icon (Dark)"
              bg="bg-[#0F172A] border border-white/[0.06]"
              width="w-16"
            />
            <LogoPreview
              src={HBARH_LOGO_LIGHT}
              title="Token Icon (Light)"
              bg="bg-white border border-gray-200"
              width="w-16"
            />
            <LogoPreview
              src={HBAR_LOGO}
              title="Hedera HBAR (not ours)"
              bg={isDark ? "bg-slate-800" : "bg-gray-100"}
              width="w-16"
            />
            <GlassCard className="p-5 text-center">
              <div className={`rounded-xl p-6 mb-3 flex items-center justify-center min-h-[80px] border ${isDark ? "bg-red-500/5 border-red-500/20" : "bg-red-50 border-red-200"}`}>
                <div className={`text-xs font-bold ${isDark ? "text-red-400" : "text-red-600"}`}>
                  HBAR ≠ HBAR.ħ
                </div>
              </div>
              <p className={`text-xs font-semibold ${isDark ? "text-red-400" : "text-red-600"}`}>
                Never mix these brands
              </p>
            </GlassCard>
          </div>

          <GlassCard className="p-4 md:p-5" hover={false}>
            <h4 className={`text-xs font-bold mb-2 ${isDark ? "text-amber-400" : "text-amber-600"}`}>
              Usage Rules
            </h4>
            <ul className={`text-xs leading-relaxed space-y-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              <li>Minimum clear space around the logo: equal to the height of the "W" in WRAPp.</li>
              <li>Minimum display size: 120px wide for the wordmark, 24px for the token icon.</li>
              <li>Never place the logo on busy backgrounds without a backing card or tint.</li>
              <li>The "p" must always be <strong>Institutional Blue #1D63ED</strong> — it is the brand signature.</li>
              <li>HBAR.ħ Protocol and Hedera HBAR are <strong>legally distinct brands</strong> and must never be interchanged.</li>
            </ul>
          </GlassCard>
        </Section>

        {/* ═══ COLORS ═══ */}
        <Section className="mb-16" delay={0.15}>
          <div className="flex items-center gap-3 mb-2">
            <Palette className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-cyan-600"}`} />
            <h2 className={h2}>Color System</h2>
          </div>
          <p className={subtitle}>
            Our palette is built for glass-morphism dark UI with light mode compatibility.
            Every color has a defined role.
          </p>

          <h3 className={`text-sm font-bold mb-3 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            Primary Brand
          </h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            <BrandColorCard
              name="Institutional Blue"
              hex="#1D63ED"
              category="Primary Identity"
              usage="Core brand color — the signature 'p' in the logo, primary identity across all materials"
              featured={true}
            />
            <BrandColorCard
              name="Slate Silver"
              hex="#94A3B8"
              category="UI Foundation"
              usage="'DEX' in the logo, secondary text, UI borders, metadata visualization"
            />
            <BrandColorCard
              name="WRAPp Pink"
              hex="#EC4899"
              category="Action Accent"
              usage="Primary UI accent, CTA buttons, active states, 'For Her' sub-brand"
            />
            <BrandColorCard
              name="Protocol Purple"
              hex="#A855F7"
              category="Secondary Accent"
              usage="Secondary accent, gradients, highlights, card borders"
            />
            <BrandColorCard
              name="Cyan Accent"
              hex="#22D3EE"
              category="Data Highlight"
              usage="Data highlights, token amounts, link hover, informational"
            />
            <BrandColorCard
              name="Emerald VIP"
              hex="#34D399"
              category="Success States"
              usage="VIP theme, success states, positive values, growth indicators"
            />
          </div>

          <h3 className={`text-sm font-bold mb-3 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            Backgrounds &amp; Surfaces
          </h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            <BrandColorCard
              name="Sovereign Navy"
              hex="#0F172A"
              category="Background Foundation"
              usage="Primary dark mode background, high-contrast typography foundation"
            />
            <BrandColorCard
              name="Glass Surface"
              hex="rgba(255,255,255,0.03)"
              category="Glass Base"
              usage="Card backgrounds (dark mode), glass-morphism base"
            />
            <BrandColorCard
              name="Glass Border"
              hex="rgba(255,255,255,0.06)"
              category="Divider Layer"
              usage="Card borders (dark mode), subtle dividers"
            />
            <BrandColorCard
              name="Light Surface"
              hex="#F9FAFB"
              category="Light Mode Base"
              usage="Primary light-mode background"
            />
          </div>

          <h3 className={`text-sm font-bold mb-3 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            Text Hierarchy
          </h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <BrandColorCard name="Heading" hex="#FFFFFF" category="Primary Text" usage="Dark mode headings" />
            <BrandColorCard name="Body" hex="#94A3B8" category="Body Text" usage="Dark mode body text" />
            <BrandColorCard name="Muted" hex="#64748B" category="Caption Text" usage="Dark mode captions" />
            <BrandColorCard name="Subtle" hex="#475569" category="Tertiary Text" usage="Disabled / tertiary" />
          </div>

          <h3 className={`text-sm font-bold mb-3 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            Gradient Presets
          </h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <GlassCard className="p-4 text-center">
              <div className="h-12 rounded-xl mb-2 bg-gradient-to-r from-pink-400 to-purple-400" />
              <p className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                pink-400 &rarr; purple-400
              </p>
              <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Primary gradient (headings, accents)
              </p>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <div className="h-12 rounded-xl mb-2 bg-gradient-to-r from-cyan-400 to-blue-400" />
              <p className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                cyan-400 &rarr; blue-400
              </p>
              <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Secondary gradient (stats, links)
              </p>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <div className="h-12 rounded-xl mb-2 bg-gradient-to-r from-emerald-400 to-teal-400" />
              <p className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                emerald-400 &rarr; teal-400
              </p>
              <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Success / VIP gradient
              </p>
            </GlassCard>
          </div>
        </Section>

        {/* ═══ TYPOGRAPHY ═══ */}
        <Section className="mb-16" delay={0.2}>
          <div className="flex items-center gap-3 mb-2">
            <Type className={`w-5 h-5 ${isDark ? "text-purple-400" : "text-purple-600"}`} />
            <h2 className={h2}>Typography</h2>
          </div>
          <p className={subtitle}>
            Two font families cover all use cases. Never substitute with
            alternative typefaces.
          </p>

          <div className="grid md:grid-cols-2 gap-3 mb-6">
            <GlassCard className="p-5 md:p-6" hover={false}>
              <div className="flex items-center justify-between mb-4">
                <h4 className={`font-bold text-sm ${isDark ? "text-white" : "text-slate-900"}`}>
                  Inter
                </h4>
                <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? "bg-pink-500/10 text-pink-400 border border-pink-500/20" : "bg-pink-50 text-pink-600 border border-pink-200"}`}>
                  Primary
                </span>
              </div>
              <p className="text-3xl font-bold mb-1">Aa Bb Cc 123</p>
              <p className={`text-xs mb-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                font-family: 'Inter', ui-sans-serif, system-ui, sans-serif
              </p>
              <div className="space-y-2">
                <p className="text-2xl font-bold">Bold 700 &mdash; Headings</p>
                <p className="text-base font-semibold">Semibold 600 &mdash; Subheadings</p>
                <p className="text-sm font-medium">Medium 500 &mdash; Labels</p>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Regular 400 &mdash; Body text
                </p>
              </div>
            </GlassCard>

            <GlassCard className="p-5 md:p-6" hover={false}>
              <div className="flex items-center justify-between mb-4">
                <h4 className={`font-bold text-sm ${isDark ? "text-white" : "text-slate-900"}`}>
                  JetBrains Mono
                </h4>
                <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "bg-cyan-50 text-cyan-600 border border-cyan-200"}`}>
                  Code
                </span>
              </div>
              <p className="text-3xl font-bold font-mono mb-1">Aa Bb Cc 123</p>
              <p className={`text-xs mb-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                font-family: 'JetBrains Mono', ui-monospace, monospace
              </p>
              <div className="space-y-2 font-mono">
                <p className={`text-sm ${isDark ? "text-pink-400" : "text-pink-600"}`}>
                  x &times; y = k
                </p>
                <p className={`text-sm ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>
                  0.0.9356476
                </p>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  TOTAL_SWAP_FEE_BPS = 25
                </p>
              </div>
              <p className={`text-xs mt-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Used for token IDs, formulas, code snippets, and numeric data.
              </p>
            </GlassCard>
          </div>
        </Section>

        {/* ═══ GLASS-MORPHISM ═══ */}
        <Section className="mb-16" delay={0.25}>
          <div className="flex items-center gap-3 mb-2">
            <Layers className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
            <h2 className={h2}>Glass-Morphism System</h2>
          </div>
          <p className={subtitle}>
            Our signature visual language. Every surface is a translucent glass card
            with subtle backdrop blur and luminous borders.
          </p>

          <div className="grid md:grid-cols-2 gap-3 mb-6">
            <GlassCard className="p-5 md:p-6" hover={false}>
              <h4 className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}>
                Card Recipe (Dark)
              </h4>
              <div className="space-y-2 font-mono text-xs">
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <span className={isDark ? "text-pink-400" : "text-pink-600"}>background:</span>{" "}
                  rgba(255, 255, 255, 0.03)
                </p>
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <span className={isDark ? "text-pink-400" : "text-pink-600"}>border:</span>{" "}
                  1px solid rgba(255, 255, 255, 0.06)
                </p>
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <span className={isDark ? "text-pink-400" : "text-pink-600"}>backdrop-filter:</span>{" "}
                  blur(24px)
                </p>
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <span className={isDark ? "text-pink-400" : "text-pink-600"}>border-radius:</span>{" "}
                  16px (rounded-2xl)
                </p>
              </div>
            </GlassCard>

            <GlassCard className="p-5 md:p-6" hover={false}>
              <h4 className={`font-bold text-sm mb-3 ${isDark ? "text-white" : "text-slate-900"}`}>
                Hover State
              </h4>
              <div className="space-y-2 font-mono text-xs">
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <span className={isDark ? "text-cyan-400" : "text-cyan-600"}>background:</span>{" "}
                  rgba(255, 255, 255, 0.05)
                </p>
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <span className={isDark ? "text-cyan-400" : "text-cyan-600"}>border:</span>{" "}
                  1px solid rgba(255, 255, 255, 0.12)
                </p>
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <span className={isDark ? "text-cyan-400" : "text-cyan-600"}>transition:</span>{" "}
                  all 300ms ease
                </p>
              </div>
            </GlassCard>
          </div>
        </Section>

        {/* ═══ KEY DATA ═══ */}
        <Section className="mb-16" delay={0.3}>
          <div className="flex items-center gap-3 mb-2">
            <Shield className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
            <h2 className={h2}>Protocol Quick Reference</h2>
          </div>
          <p className={subtitle}>
            Official on-chain identifiers and data points for press, partners,
            and technical documentation.
          </p>

          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            {[
              { label: "Protocol Token", value: "HBAR.ħ", mono: false },
              { label: "HTS Token ID", value: "0.0.9356476", mono: true },
              { label: "Token Decimals", value: "8", mono: true },
              { label: "VIP NFT Collection", value: "0.0.10146181", mono: true },
              { label: "Treasury Account", value: "0.0.9695738", mono: true },
              { label: "Founder Account", value: "0.0.518487", mono: true },
              { label: "Network", value: "Hedera Mainnet", mono: false },
              { label: "Token Standard", value: "HTS (Hedera Token Service)", mono: false },
              { label: "LP Pool (SaucerSwap V1)", value: "HBAR / HBAR.ħ", mono: false },
              { label: "LP Token ID", value: "0.0.9356724", mono: true },
              { label: "Total Swap Fee", value: "0.25% (25 bps) — all to pool; 0.05% tracked for DAO extraction", mono: false },
              { label: "Flat Micro-Fee", value: "$0.0007 per swap (additive, anti-splitting)", mono: false },
              { label: "VIP Gate", value: "100M+ HBAR.ħ or 1+ VIP NFT", mono: false },
              { label: "Max DAO Votes / Wallet", value: "11 (10 token + 1 NFT)", mono: false },
              { label: "Network Finality", value: "~2 seconds (aBFT)", mono: false },
              { label: "Structure", value: "Wyoming DUNA", mono: false },
            ].map((item) => (
              <GlassCard key={item.label} className="p-3.5 flex items-center justify-between gap-3">
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  {item.label}
                </span>
                <span className={`text-xs font-bold text-right ${item.mono ? "font-mono" : ""} ${isDark ? "text-white" : "text-slate-900"}`}>
                  {item.value}
                </span>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* ═══ DO's and DON'Ts ═══ */}
        <Section className="mb-16" delay={0.35}>
          <h2 className={h2}>Brand Guidelines</h2>
          <p className={subtitle}>
            Protect the brand by following these rules in every piece of
            marketing collateral, social post, and partner integration.
          </p>

          <div className="grid md:grid-cols-2 gap-3">
            <GlassCard className="p-5 md:p-6" hover={false}>
              <h4 className={`font-bold text-sm mb-3 flex items-center gap-2 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                <Check className="w-4 h-4" /> Do
              </h4>
              <ul className={`text-xs leading-relaxed space-y-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                <li>Use the official wordmark and token icons from this kit.</li>
                <li>Maintain clear space around all logos.</li>
                <li>Use "WRAPpDEX" with capital W-R-A-P-p-D-E-X (lowercase "p").</li>
                <li>Write "HBAR.ħ" with the Maltese cross character (ħ).</li>
                <li>Credit Hedera as the underlying network, not as our brand.</li>
                <li>Use dark mode glass-morphism for presentation decks.</li>
                <li>Include the disclaimer: "HBAR.ħ Protocol is not affiliated with the Hedera Foundation."</li>
              </ul>
            </GlassCard>

            <GlassCard className="p-5 md:p-6" hover={false}>
              <h4 className={`font-bold text-sm mb-3 flex items-center gap-2 ${isDark ? "text-red-400" : "text-red-600"}`}>
                <XCircle className="w-4 h-4" /> Don't
              </h4>
              <ul className={`text-xs leading-relaxed space-y-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                <li>Never use Hedera's HBAR logo in place of the HBAR.ħ token icon.</li>
                <li>Never stretch, skew, rotate, or apply effects to the logos.</li>
                <li>Never place logos on overly complex or clashing backgrounds.</li>
                <li>Never write "Wrappdex," "wrappDEX," "WRAPPDEX," or other case variants.</li>
                <li>Never represent the project as affiliated with or endorsed by the Hedera Governing Council.</li>
                <li>Never use brand colors outside the defined palette.</li>
                <li>Never make unverifiable claims about returns, APY, or token price.</li>
              </ul>
            </GlassCard>
          </div>
        </Section>

        {/* ═══ LETTER FROM NATALIE ═══ */}
        <Section className="mb-12" delay={0.4}>
          <GlassCard className="p-6 md:p-10" hover={false}>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-xl font-bold text-white flex-shrink-0">
                N
              </div>
              <div>
                <h3 className={`font-bold text-lg ${isDark ? "text-white" : "text-slate-900"}`}>
                  A Letter from Natalie
                </h3>
                <p className={`text-xs bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent font-semibold`}>
                  Chief Marketing Officer, WRAPpDEX
                </p>
              </div>
            </div>

            <div className={`text-xs md:text-sm leading-relaxed space-y-4 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
              <p>
                To our partners, investors, and community champions,
              </p>

              <p>
                If you are reading this page, you are one of the people shaping
                how the world discovers WRAPpDEX. That is a responsibility I do
                not take lightly, and neither should you. Every slide you build,
                every tweet you send, and every pitch you deliver carries the
                weight of what we are building together. So let me give you the
                ammunition.
              </p>

              <p className={`font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                The Numbers That Matter
              </p>

              <ul className={`space-y-2 pl-4 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                <li>
                  <strong className={isDark ? "text-cyan-400" : "text-cyan-600"}>Hedera processes 10,000+ TPS</strong>{" "}
                  with mathematically provable finality in ~2 seconds. Ethereum
                  does ~15 TPS with 12+ minute finality. That is not an
                   incremental improvement. That is an entirely different class of
                   infrastructure.
                </li>
                <li>
                  <strong className={isDark ? "text-cyan-400" : "text-cyan-600"}>Transaction cost: ~$0.0001.</strong>{" "}
                  One hundred thousand transactions on Hedera cost what a single
                  Ethereum swap costs in gas. Our users feel that difference on
                  every trade.
                </li>
                <li>
                  <strong className={isDark ? "text-cyan-400" : "text-cyan-600"}>Zero MEV. Zero front-running.</strong>{" "}
                  Every swap settles as a single atomic Hedera CryptoTransfer —
                  both token legs or neither. Pool reserves are real on-chain
                  account balances, not a database. Bots cannot see your trade
                  before it executes. This is not a feature we bolted on. It
                  is the architecture.
                </li>
                <li>
                  <strong className={isDark ? "text-cyan-400" : "text-cyan-600"}>Dual-fee model at near-zero cost.</strong>{" "}
                  A 0.25% swap fee that stays entirely in pool reserves for LPs,
                  plus a flat $0.0007 micro-fee per swap — 17% cheaper than
                  SaucerSwap. The protocol's 0.05% share is tracked per pool and
                   extractable by DAO governance. No hidden spreads, no variable
                   gas. Users see exactly what they pay before they confirm.
                </li>
                <li>
                  <strong className={isDark ? "text-cyan-400" : "text-cyan-600"}>Smart routing finds the best path automatically.</strong>{" "}
                  Direct swaps when a pool pair exists. USDC-hop routing when it
                  does not. The engine evaluates every route and picks the one
                  that gives the user the most tokens back. Period.
                </li>
                <li>
                  <strong className={isDark ? "text-cyan-400" : "text-cyan-600"}>Wyoming DUNA structure.</strong>{" "}
                  We are not hiding offshore. WRAPpDEX operates under a Wyoming
                  Decentralized Unincorporated Nonprofit Association, one of the
                  most forward-thinking legal frameworks for DAOs in the United
                  States. Real governance. Real accountability.
                </li>
                <li>
                  <strong className={isDark ? "text-cyan-400" : "text-cyan-600"}>Hedera's Governing Council</strong>{" "}
                  includes Google, IBM, Boeing, Deutsche Telekom, and Standard
                   Bank. When someone asks "who runs the network?", the answer is
                   Fortune 500 companies with reputations they cannot afford to
                   lose. That is the infrastructure WRAPpDEX is built on.
                </li>
                <li>
                  <strong className={isDark ? "text-cyan-400" : "text-cyan-600"}>Full production integrations, not roadmap promises.</strong>{" "}
                  SaucerSwap, Chainlink oracles, Bonzo Finance
                  lending, three cross-chain bridges (Squid, HashPort, Stargate),
                  fiat on-ramp, and WalletConnect v2. All live. All in the
                  codebase today.
                </li>
              </ul>

              <p className={`font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                How to Pitch This
              </p>

              <p>
                Do not lead with the technology. Lead with the problem. Every
                trader has been front-run. Every DeFi user has overpaid for gas.
                Every investor has looked at a "partnership announcement" that
                was nothing more than a logo swap. WRAPpDEX solves those
                problems with production code, not promises.
              </p>

              <p>
                When someone asks why Hedera instead of Ethereum or Solana, the
                answer is simple: Hedera is the only network where transactions
                are ordered fairly by consensus timestamp, not by who pays the
                highest priority fee. That single property eliminates MEV at the
                protocol level. We did not have to invent a workaround. We chose
                the right foundation.
              </p>

              <p>
                When someone asks what makes WRAPpDEX different from every other
                DEX, the answer is that we built a custom AMM from scratch that
                holds its state off-chain to prevent sandwich attacks, wrote a
                Solidity-audited weighted pool factory for custom portfolio
                pools, wired three separate cross-chain bridges, integrated
                real Chainlink oracle feeds with multi-source fallback, and
                deployed cryptographic wallet authentication with no passwords
                and no cookies. We did not fork Uniswap and add a gradient.
              </p>

              <p className={`font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                A Note on Integrity
              </p>

              <p>
                Never promise returns. Never guarantee token prices. Never
                overstate traction. The fastest way to destroy trust is to
                inflate a number. Our strength is transparency: the code is
                auditable, the fees are visible, the governance is
                token-weighted and verifiable against Mirror Node balances.
                Let the product speak.
              </p>

              <p>
                If you represent this brand, represent it honestly. The people
                who will build the largest positions in HBAR.ħ are not looking
                for hype. They are looking for substance. Give them substance.
              </p>

              <p className={`italic ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Build the story around the truth, and the truth will do the
                selling for you.
              </p>

              <div className={`mt-6 pt-6 border-t ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}>
                <p className={`font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                  Natalie
                </p>
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Chief Marketing Officer
                </p>
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  WRAPpDEX &middot; HBAR.ħ Protocol
                </p>
              </div>
            </div>
          </GlassCard>
        </Section>

        {/* Footer */}
        <div className={`text-center py-8 border-t ${isDark ? "border-white/[0.06]" : "border-gray-200"}`}>
          <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            WRAPpDEX Brand Kit &middot; Confidential &middot; For authorized partners and team members only
          </p>
          <p className={`text-xs mt-1 ${isDark ? "text-slate-700" : "text-gray-300"}`}>
            HBAR.ħ Protocol is not affiliated with the Hedera Foundation or Hedera Governing Council.
          </p>
        </div>
      </div>
    </div>
  );
}
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Heart,
  Globe,
  Sparkles,
  MessageCircleHeart,
  PartyPopper,
  Shield,
  Flame,
  Crown,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

/* ═══════════════════════════════════════════════════════════════════════
   COMMUNITY MESSAGE — "From the Trenches, With Love"
   Carlos — Community & Brand Ambassador
   ═══════════════════════════════════════════════════════════════════════ */

type Lang = "en" | "fr" | "es";

const LANG_LABELS: Record<Lang, { flag: string; label: string }> = {
  en: { flag: "EN", label: "English" },
  fr: { flag: "FR", label: "Francais" },
  es: { flag: "ES", label: "Espanol" },
};

const MESSAGES: Record<Lang, string> = {
  en:
    `To every diamond-handed holder, every late-night chart watcher, every DAO voter who showed up when it mattered, every NFT collector who believed in art before the floor price, every community member who typed "gm" when the market was bleeding red and meant it — this one is for you. ` +
    `My name is Carlos and I am not behind a desk somewhere pretending to care about "community engagement metrics" — I am in the trenches with you, every single day, answering your tickets at 2 AM, jumping into Discord voice channels when FUD hits, translating announcements so nobody gets left behind, and celebrating every milestone like it is my own because it genuinely is. ` +
    `WRAPpDEX is not a corporation that hired a community manager to keep you quiet between product launches — this project was built by people who lost money on centralized exchanges, who watched custodians freeze their funds, who got sandwich-attacked on other DEXes, and who decided that enough was enough. ` +
    `When you hold HBAR.h tokens you are not just holding a speculative asset — you are holding a seat at the table, a vote in the DAO, a voice that actually gets heard, and a stake in a protocol that was designed from day one to put you first. ` +
    `When you hold our NFTs you are carrying proof that you were here before the world caught on, that you believed in sovereign finance on Hedera when the rest of crypto was chasing the next memecoin pump, and that badge of honor is something no market crash can ever take from you. ` +
    `I will be the first face you see when you open a support ticket, the last voice in the Discord channel at night, the person who fights for your feature requests in team meetings, and the friend who tells you the truth even when the truth is hard — because real community is not hype, it is trust, it is showing up, it is staying when others leave. ` +
    `So whether you are reading this from Lagos or Los Angeles, from Paris or Panama City, from Tokyo or Toronto — know that you are not alone, you are not just a wallet address, you are family, and this community will always have your back.`,

  fr:
    `A chaque holder aux mains de diamant, a chaque veilleur de graphiques nocturne, a chaque votant du DAO qui s'est presente quand ca comptait, a chaque collectionneur de NFT qui a cru en l'art avant le prix plancher, a chaque membre de la communaute qui a tape "gm" quand le marche saignait rouge et qui le pensait vraiment — ce message est pour vous. ` +
    `Je m'appelle Carlos et je ne suis pas assis derriere un bureau a faire semblant de me soucier des "indicateurs d'engagement communautaire" — je suis dans les tranchees avec vous, chaque jour, a repondre a vos tickets a 2 heures du matin, a sauter dans les salons vocaux Discord quand le FUD frappe, a traduire les annonces pour que personne ne soit laisse de cote, et a celebrer chaque etape comme si c'etait la mienne parce que c'est veritablement le cas. ` +
    `WRAPpDEX n'est pas une entreprise qui a embauche un community manager pour vous faire taire entre deux lancements — ce projet a ete construit par des gens qui ont perdu de l'argent sur des exchanges centralises, qui ont vu des custodians geler leurs fonds, qui se sont fait attaquer en sandwich sur d'autres DEX, et qui ont decide que trop c'etait trop. ` +
    `Quand vous detenez des tokens HBAR.h, vous ne detenez pas simplement un actif speculatif — vous detenez une place a la table, un vote dans le DAO, une voix qui est reellement entendue, et une participation dans un protocole concu des le premier jour pour vous placer en premier. ` +
    `Quand vous detenez nos NFTs, vous portez la preuve que vous etiez la avant que le monde ne comprenne, que vous avez cru en la finance souveraine sur Hedera quand le reste de la crypto courait apres le prochain pump de memecoin, et ce badge d'honneur est quelque chose qu'aucun crash ne pourra jamais vous enlever. ` +
    `Je serai le premier visage que vous verrez en ouvrant un ticket, la derniere voix dans le canal Discord le soir, la personne qui se bat pour vos demandes de fonctionnalites en reunion d'equipe, et l'ami qui vous dit la verite meme quand la verite est difficile — parce que la vraie communaute ce n'est pas du battage mediatique, c'est la confiance, c'est etre present, c'est rester quand les autres partent. ` +
    `Alors que vous lisiez ceci depuis Lagos ou Los Angeles, depuis Paris ou Panama, depuis Tokyo ou Toronto — sachez que vous n'etes pas seul, vous n'etes pas juste une adresse de portefeuille, vous etes une famille, et cette communaute sera toujours la pour vous.`,

  es:
    `Para cada holder de manos de diamante, cada vigilante nocturno de graficos, cada votante del DAO que se presento cuando importaba, cada coleccionista de NFT que creyo en el arte antes del precio minimo, cada miembro de la comunidad que escribio "gm" cuando el mercado sangraba en rojo y lo dijo en serio — este mensaje es para ustedes. ` +
    `Mi nombre es Carlos y no estoy detras de un escritorio fingiendo que me importan las "metricas de engagement comunitario" — estoy en las trincheras con ustedes, cada dia, respondiendo sus tickets a las 2 de la manana, saltando a los canales de voz de Discord cuando llega el FUD, traduciendo anuncios para que nadie se quede atras, y celebrando cada logro como si fuera mio porque genuinamente lo es. ` +
    `WRAPpDEX no es una corporacion que contrato a un community manager para mantenerlos callados entre lanzamientos — este proyecto fue construido por personas que perdieron dinero en exchanges centralizados, que vieron custodios congelar sus fondos, que fueron victimas de ataques sandwich en otros DEX, y que decidieron que ya era suficiente. ` +
    `Cuando tienen tokens HBAR.h no estan simplemente sosteniendo un activo especulativo — tienen un asiento en la mesa, un voto en el DAO, una voz que realmente se escucha, y una participacion en un protocolo disenado desde el primer dia para ponerlos a ustedes primero. ` +
    `Cuando tienen nuestros NFTs llevan la prueba de que estuvieron aqui antes de que el mundo se diera cuenta, de que creyeron en las finanzas soberanas en Hedera cuando el resto de crypto perseguia el proximo pump de memecoin, y esa insignia de honor es algo que ningun crash del mercado podra jamas quitarles. ` +
    `Sere la primera cara que vean al abrir un ticket de soporte, la ultima voz en el canal de Discord por la noche, la persona que lucha por sus solicitudes de funcionalidades en las reuniones de equipo, y el amigo que les dice la verdad incluso cuando la verdad es dificil — porque la verdadera comunidad no es hype, es confianza, es presentarse, es quedarse cuando otros se van. ` +
    `Asi que ya sea que lean esto desde Lagos o Los Angeles, desde Paris o Ciudad de Panama, desde Tokio o Toronto — sepan que no estan solos, no son solo una direccion de wallet, son familia, y esta comunidad siempre los respaldara.`,
};

/* ── Floating particle effect ────────────────────────────────────────── */

function VipParticles({ isDark }: { isDark: boolean }) {
  const particles = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 2 + Math.random() * 3,
    delay: Math.random() * 4,
    duration: 3 + Math.random() * 4,
    color: [
      "bg-amber-400",
      "bg-cyan-400",
      "bg-pink-400",
      "bg-purple-400",
      "bg-emerald-400",
      "bg-blue-400",
    ][i % 6],
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className={`absolute rounded-full ${p.color}`}
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            top: `${p.y}%`,
            opacity: isDark ? 0.35 : 0.25,
            filter: "blur(0.5px)",
          }}
          animate={{
            y: [0, -20, 0],
            opacity: isDark ? [0.15, 0.4, 0.15] : [0.1, 0.3, 0.1],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/* ── Animated border glow ring ───────────────────────────────────────── */

function GlowBorder() {
  return (
    <motion.div
      className="absolute inset-0 rounded-2xl pointer-events-none"
      style={{
        background:
          "linear-gradient(135deg, rgba(251,191,36,0.12), rgba(236,72,153,0.12), rgba(139,92,246,0.12), rgba(56,189,248,0.12))",
        padding: "1px",
        WebkitMask:
          "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
      }}
      animate={{
        background: [
          "linear-gradient(0deg, rgba(251,191,36,0.20), rgba(236,72,153,0.15), rgba(139,92,246,0.15), rgba(56,189,248,0.20))",
          "linear-gradient(120deg, rgba(56,189,248,0.20), rgba(251,191,36,0.15), rgba(236,72,153,0.15), rgba(139,92,246,0.20))",
          "linear-gradient(240deg, rgba(139,92,246,0.20), rgba(56,189,248,0.15), rgba(251,191,36,0.15), rgba(236,72,153,0.20))",
          "linear-gradient(360deg, rgba(251,191,36,0.20), rgba(236,72,153,0.15), rgba(139,92,246,0.15), rgba(56,189,248,0.20))",
        ],
      }}
      transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
    />
  );
}

interface CommunityMessageProps {
  open: boolean;
  onClose: () => void;
}

export function CommunityMessage({ open, onClose }: CommunityMessageProps) {
  const { isDark } = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lang, setLang] = useState<Lang>("en");

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      scrollRef.current?.scrollTo(0, 0);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* Backdrop with extra warmth */}
          <motion.div
            className="absolute inset-0"
            style={{
              background: isDark
                ? "radial-gradient(ellipse at 50% 30%, rgba(139,92,246,0.08), rgba(0,0,0,0.75))"
                : "radial-gradient(ellipse at 50% 30%, rgba(139,92,246,0.06), rgba(0,0,0,0.5))",
              backdropFilter: "blur(6px)",
            }}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Message container */}
          <motion.div
            className={`relative w-full max-w-2xl max-h-[90vh] rounded-2xl overflow-hidden ${
              isDark
                ? "bg-[#0a0d1a]/95"
                : "bg-white/95"
            }`}
            style={{
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              boxShadow: isDark
                ? "0 0 120px rgba(139,92,246,0.08), 0 0 60px rgba(251,191,36,0.04), 0 32px 64px rgba(0,0,0,0.6)"
                : "0 32px 64px rgba(0,0,0,0.18)",
            }}
            initial={{ opacity: 0, y: 50, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.92 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Animated border glow */}
            <GlowBorder />

            {/* Floating particles */}
            <VipParticles isDark={isDark} />

            {/* Close button */}
            <button
              onClick={onClose}
              className={`absolute top-4 right-4 z-20 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                isDark
                  ? "bg-white/[0.06] hover:bg-white/[0.12] text-slate-400 hover:text-white"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800"
              }`}
              aria-label="Close message"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Scrollable content */}
            <div ref={scrollRef} className="relative z-10 overflow-y-auto max-h-[90vh] overscroll-contain">
              {/* ── Header ── */}
              <div
                className="relative px-6 sm:px-10 pt-10 pb-6"
                style={{
                  background: isDark
                    ? "linear-gradient(180deg, rgba(139,92,246,0.06) 0%, rgba(251,191,36,0.02) 50%, transparent 100%)"
                    : "linear-gradient(180deg, rgba(139,92,246,0.04) 0%, transparent 100%)",
                }}
              >
                {/* Animated avatar */}
                <div className="flex justify-center mb-5">
                  <motion.div
                    className="relative"
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  >
                    {/* Outer glow ring */}
                    <motion.div
                      className="absolute -inset-1.5 rounded-2xl"
                      style={{
                        background: "linear-gradient(135deg, #f59e0b, #ec4899, #8b5cf6, #38bdf8)",
                        opacity: 0.5,
                        filter: "blur(6px)",
                      }}
                      animate={{ rotate: [0, 360] }}
                      transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                    />
                    <div
                      className="relative w-18 h-18 rounded-2xl flex items-center justify-center text-2xl font-bold text-white"
                      style={{
                        width: 72,
                        height: 72,
                        background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
                      }}
                    >
                      C
                    </div>
                    {/* VIP crown */}
                    <motion.div
                      className="absolute -top-3 -right-3"
                      animate={{ rotate: [-5, 5, -5], scale: [1, 1.1, 1] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Crown className="w-5 h-5 text-amber-400 drop-shadow-lg" fill="currentColor" />
                    </motion.div>
                  </motion.div>
                </div>

                {/* Title with VIP badge */}
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-1.5">
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                    >
                      <Sparkles className="w-4 h-4 text-amber-400" />
                    </motion.div>
                    <h2
                      className={`text-xl sm:text-2xl font-bold tracking-tight ${
                        isDark ? "text-white" : "text-slate-900"
                      }`}
                    >
                      From the Trenches, With Love
                    </h2>
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                    >
                      <Sparkles className="w-4 h-4 text-amber-400" />
                    </motion.div>
                  </div>
                  <p
                    className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}
                  >
                    <span className="font-semibold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                      Carlos
                    </span>{" "}
                    &mdash; Community & Brand Ambassador
                  </p>
                </div>
              </div>

              {/* ── Language Tabs ── */}
              <div className="px-6 sm:px-10">
                <div className="flex items-center gap-1 mb-1">
                  <Globe className={`w-3.5 h-3.5 ${isDark ? "text-slate-600" : "text-gray-300"}`} />
                  <span className={`text-[11px] uppercase tracking-wider font-semibold ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                    Language
                  </span>
                </div>
                <div className={`inline-flex rounded-xl p-1 gap-0.5 ${isDark ? "bg-white/[0.04]" : "bg-gray-100"}`}>
                  {(Object.keys(LANG_LABELS) as Lang[]).map((l) => {
                    const active = lang === l;
                    return (
                      <button
                        key={l}
                        onClick={() => setLang(l)}
                        className={`relative px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                          active
                            ? isDark
                              ? "text-white"
                              : "text-slate-900"
                            : isDark
                              ? "text-slate-500 hover:text-slate-300"
                              : "text-gray-400 hover:text-gray-600"
                        }`}
                      >
                        {active && (
                          <motion.div
                            layoutId="carlos-lang-tab"
                            className={`absolute inset-0 rounded-lg ${
                              isDark
                                ? "bg-gradient-to-r from-purple-500/20 to-cyan-500/20 border border-white/[0.08]"
                                : "bg-white border border-gray-200 shadow-sm"
                            }`}
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                          />
                        )}
                        <span className="relative flex items-center gap-1.5">
                          <span>{LANG_LABELS[l].flag}</span>
                          <span className="hidden sm:inline">{LANG_LABELS[l].label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Divider ── */}
              <div className="px-6 sm:px-10 mt-4">
                <div
                  className="w-full h-px"
                  style={{
                    background: isDark
                      ? "linear-gradient(90deg, transparent, rgba(139,92,246,0.2), rgba(251,191,36,0.15), rgba(56,189,248,0.2), transparent)"
                      : "linear-gradient(90deg, transparent, rgba(139,92,246,0.15), transparent)",
                  }}
                />
              </div>

              {/* ── Message Body ── */}
              <div className="px-6 sm:px-10 py-8">
                {/* VIP callout strip */}
                <motion.div
                  className={`flex items-center gap-2.5 rounded-xl px-4 py-3 mb-6 ${
                    isDark
                      ? "bg-gradient-to-r from-amber-500/[0.06] via-pink-500/[0.04] to-purple-500/[0.06] border border-amber-500/[0.10]"
                      : "bg-gradient-to-r from-amber-50 via-pink-50 to-purple-50 border border-amber-200/40"
                  }`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3, duration: 0.4 }}
                >
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Heart className="w-4 h-4 text-pink-400" fill="currentColor" />
                    <Flame className="w-4 h-4 text-amber-400" />
                    <Shield className="w-4 h-4 text-purple-400" />
                  </div>
                  <p className={`text-xs font-medium leading-snug ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {lang === "en" && "A personal message to every token holder, NFT collector, and community member worldwide"}
                    {lang === "fr" && "Un message personnel pour chaque detenteur de tokens, collectionneur de NFT et membre de la communaute dans le monde entier"}
                    {lang === "es" && "Un mensaje personal para cada poseedor de tokens, coleccionista de NFT y miembro de la comunidad en todo el mundo"}
                  </p>
                </motion.div>

                {/* The message — one long paragraph, animated entrance per language swap */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={lang}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.3 }}
                  >
                    <p
                      className={`text-sm sm:text-[15px] leading-[1.85] ${
                        isDark ? "text-slate-300" : "text-gray-700"
                      }`}
                    >
                      {MESSAGES[lang]}
                    </p>
                  </motion.div>
                </AnimatePresence>

                {/* Signature block */}
                <div
                  className="mt-8 pt-6 border-t border-dashed"
                  style={{
                    borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                      style={{
                        background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
                      }}
                    >
                      C
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                          Carlos
                        </p>
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                          style={{
                            background: isDark
                              ? "linear-gradient(135deg, rgba(251,191,36,0.15), rgba(236,72,153,0.10))"
                              : "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(236,72,153,0.1))",
                            color: isDark ? "#fbbf24" : "#d97706",
                            border: isDark ? "1px solid rgba(251,191,36,0.15)" : "1px solid rgba(251,191,36,0.3)",
                          }}
                        >
                          <PartyPopper className="w-3 h-3" />
                          VIP
                        </span>
                      </div>
                      <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        Community & Brand Ambassador, WRAPpDEX
                      </p>
                    </div>
                  </div>

                  {/* Community values strip */}
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    {[
                      { icon: MessageCircleHeart, label: "Always Here", color: "text-pink-400" },
                      { icon: Shield, label: "Your Advocate", color: "text-purple-400" },
                      { icon: Heart, label: "Community First", color: "text-amber-400" },
                    ].map(({ icon: Icon, label, color }) => (
                      <span
                        key={label}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                          isDark
                            ? "bg-white/[0.03] text-slate-400 border border-white/[0.05]"
                            : "bg-gray-50 text-gray-500 border border-gray-100"
                        }`}
                      >
                        <Icon className={`w-3 h-3 ${color}`} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom pad */}
              <div className="h-4" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

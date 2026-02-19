import { motion } from "motion/react";
import { ExternalLink, Shield, Users, Briefcase } from "lucide-react";

const BLUE = "#1D63ED";
const CYAN = "#06b6d4";
const VIOLET = "#7C3AED";

const TEAM_PHOTO =
  "https://images.unsplash.com/photo-1758520144667-3041caeff3c1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0aHJlZSUyMGNvd29ya2VycyUyMGZpbnRlY2glMjBzdGFydHVwJTIwY29sbGFib3JhdGluZyUyMHNjcmVlbnMlMjBkYXJrJTIwb2ZmaWNlfGVufDF8fHx8MTc3MTUyNzcwMHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral";

const roles = [
  {
    name: "Kyle Post",
    role: "CEO & Lead Architect",
    handle: "@KylePost17",
    link: "https://x.com/KylePost17",
    accent: BLUE,
    icon: Shield,
  },
  {
    name: "Natalie",
    role: "Chief Marketing Officer",
    handle: "@Natnatx007",
    link: "https://x.com/Natnatx007",
    accent: CYAN,
    icon: Users,
  },
  {
    name: "Carlos",
    role: "Strategic Relations",
    handle: "@carlosrevilla_",
    link: "https://x.com/carlosrevilla_",
    accent: VIOLET,
    icon: Briefcase,
  },
];

export function LandingTeam() {
  return (
    <section
      className="py-20 sm:py-32 md:py-48 bg-slate-50 relative overflow-hidden"
      id="about"
      style={{ borderTop: "1px solid #e2e8f0" }}
    >
      {/* Subtle animated background blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-40 right-0 w-[500px] h-[500px] rounded-full blur-[140px] opacity-[0.04]"
          style={{ background: `linear-gradient(135deg, ${BLUE}, ${CYAN})` }}
        />
        <motion.div
          animate={{ x: [0, -30, 0], y: [0, 40, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -bottom-40 -left-20 w-[400px] h-[400px] rounded-full blur-[120px] opacity-[0.04]"
          style={{ background: `linear-gradient(135deg, ${VIOLET}, ${BLUE})` }}
        />
      </div>

      <div className="container relative mx-auto px-4 z-10">
        {/* Header */}
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
            The People Behind the Protocol
          </span>
          <h2
            className="text-5xl sm:text-6xl md:text-8xl text-black tracking-tight leading-[0.95] mb-6"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Real Humans. <br />
            <span
              className="italic bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(135deg, ${BLUE}, ${CYAN})`,
                WebkitBackgroundClip: "text",
              }}
            >
              Real Accountability.
            </span>
          </h2>
          <p
            className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed font-light"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            WRAPpDEX is a Wyoming DUNA — a legally registered, non-anonymous
            entity. You know who we are and where to find us.
          </p>
        </motion.div>

        {/* ── Hero Photo ── */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1, delay: 0.15 }}
          className="relative group overflow-hidden rounded-3xl"
          style={{
            boxShadow:
              "0 32px 80px -16px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)",
          }}
        >
          <div className="relative aspect-[21/9] sm:aspect-[2.2/1] overflow-hidden bg-slate-900">
            <img
              src={TEAM_PHOTO}
              alt="WRAPpDEX founding team collaborating on the trading platform"
              className="w-full h-full object-cover transition-all duration-[2s] group-hover:scale-105"
            />

            {/* Dark overlay for text legibility */}
            <div
              className="absolute inset-0 transition-opacity duration-[2s]"
              style={{
                background:
                  "linear-gradient(to right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.4) 100%)",
              }}
            />

            {/* Colored accent flare on hover */}
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-[1.5s]"
              style={{
                background: `linear-gradient(135deg, ${BLUE}15 0%, transparent 40%, ${VIOLET}10 100%)`,
              }}
            />

            {/* Left side content */}
            <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-10 md:p-14 z-10">
              {/* Tagline */}
              <motion.span
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4, duration: 0.6 }}
                className="text-[9px] font-black uppercase tracking-[0.4em] text-white/50 mb-3"
              >
                Founding Team &middot; Building in Public
              </motion.span>

              <motion.h3
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5, duration: 0.6 }}
                className="text-2xl sm:text-3xl md:text-5xl text-white leading-tight mb-4 max-w-lg"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Three builders.
                <br />
                <span className="italic" style={{ color: CYAN }}>
                  One mission.
                </span>
              </motion.h3>

              <motion.p
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6, duration: 0.6 }}
                className="text-white/50 text-xs sm:text-sm font-light max-w-md leading-relaxed hidden sm:block"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                A CEO-engineer who shipped the entire stack, a brand strategist
                rooted in the Hedera community, and a partnerships lead
                connecting protocols ecosystem-wide.
              </motion.p>
            </div>

            {/* Bottom-right: floating role tags (visible on md+) */}
            <div className="absolute bottom-6 right-6 md:bottom-10 md:right-10 z-10 hidden md:flex flex-col items-end gap-2.5">
              {roles.map((r, i) => (
                <motion.a
                  key={r.name}
                  href={r.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, x: 30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5 + i * 0.12, duration: 0.6 }}
                  className="flex items-center gap-3 px-4 py-2.5 backdrop-blur-xl rounded-full no-underline group/tag transition-all duration-500"
                  style={{
                    background: "rgba(0,0,0,0.45)",
                    border: `1px solid ${r.accent}30`,
                  }}
                >
                  <r.icon size={13} style={{ color: r.accent }} />
                  <div className="flex flex-col">
                    <span className="text-white text-[11px] font-bold leading-tight">
                      {r.name}
                    </span>
                    <span className="text-white/40 text-[9px] font-medium">
                      {r.role}
                    </span>
                  </div>
                  <ExternalLink
                    size={10}
                    className="text-white/30 group-hover/tag:text-white/70 transition-colors ml-1"
                  />
                </motion.a>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Mobile role cards (visible below md) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 md:hidden">
          {roles.map((r, i) => (
            <motion.a
              key={r.name}
              href={r.link}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.6 }}
              className="flex items-center gap-3 px-5 py-4 rounded-2xl no-underline transition-all duration-500"
              style={{
                background: "#fff",
                border: "1px solid #f1f5f9",
              }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: `${r.accent}0a`,
                  border: `1px solid ${r.accent}15`,
                }}
              >
                <r.icon size={15} style={{ color: r.accent }} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-bold text-slate-900 leading-tight truncate">
                  {r.name}
                </span>
                <span className="text-[10px] text-slate-400 font-medium truncate">
                  {r.role}
                </span>
              </div>
              <ExternalLink size={12} className="text-slate-300 ml-auto shrink-0" />
            </motion.a>
          ))}
        </div>

        {/* Entity disclosure */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="mt-12 md:mt-16 text-center"
        >
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">
            WRAPpDEX DAO LLC &middot; Wyoming Decentralized Unincorporated
            Nonprofit Association &middot; Est. 2026
          </p>
        </motion.div>
      </div>
    </section>
  );
}
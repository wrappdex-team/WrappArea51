import { motion } from "motion/react";
import { Shield, Award, Star, Lock } from "lucide-react";

const BLUE = "#1D63ED";

export function LandingAwardRibbon() {
  return (
    <div className="relative w-full max-w-lg mx-auto aspect-square flex items-center justify-center p-4">
      {/* SVG Defs for 24k Gold Gradient */}
      <svg className="absolute w-0 h-0">
        <defs>
          <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFF4D1" />
            <stop offset="25%" stopColor="#F59E0B" />
            <stop offset="50%" stopColor="#D97706" />
            <stop offset="75%" stopColor="#92400E" />
            <stop offset="100%" stopColor="#451A03" />
          </linearGradient>
        </defs>
      </svg>

      {/* Background Rays */}
      <div className="absolute inset-0 flex items-center justify-center opacity-10">
        {[...Array(24)].map((_, i) => (
          <div
            key={i}
            className="absolute w-0.5 h-[140%]"
            style={{
              transform: `rotate(${i * 15}deg)`,
              background: `linear-gradient(to top, transparent, ${BLUE}, transparent)`,
            }}
          />
        ))}
      </div>

      {/* Hanging Ribbons */}
      <div className="absolute top-[55%] left-1/2 -translate-x-1/2 w-full h-full flex justify-center gap-16 pointer-events-none">
        <motion.div
          initial={{ y: -40, opacity: 0, rotate: 10 }}
          animate={{ y: 0, opacity: 1, rotate: 15 }}
          transition={{ duration: 1.2, delay: 0.4, ease: "easeOut" }}
          className="w-20 h-56 relative origin-top shadow-2xl"
          style={{
            backgroundColor: BLUE,
            clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 50% 88%, 0% 100%)",
          }}
        >
          <div className="absolute inset-y-0 left-0 w-4 bg-black/20" />
          <div className="absolute inset-y-0 right-0 w-4 bg-black/20" />
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-white/10" />
        </motion.div>

        <motion.div
          initial={{ y: -40, opacity: 0, rotate: -10 }}
          animate={{ y: 0, opacity: 1, rotate: -15 }}
          transition={{ duration: 1.2, delay: 0.5, ease: "easeOut" }}
          className="w-20 h-56 bg-[#F59E0B] relative origin-top shadow-2xl"
          style={{ clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 50% 88%, 0% 100%)" }}
        >
          <div className="absolute inset-y-0 left-0 w-4 bg-black/10" />
          <div className="absolute inset-y-0 right-0 w-4 bg-black/10" />
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-white/20" />
        </motion.div>
      </div>

      {/* Main Seal */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 80, damping: 20, delay: 0.1 }}
        className="relative z-10 w-full aspect-square bg-[#0F172A] rounded-full p-2 flex flex-col items-center justify-center text-center overflow-hidden"
        style={{ boxShadow: "0 40px 100px rgba(0,0,0,0.3)" }}
      >
        {/* Gold Border */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none -rotate-90">
          <circle cx="50%" cy="50%" r="48%" fill="none" stroke="url(#goldGradient)" strokeWidth="20" />
        </svg>

        {/* Metallic Reflection */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/40 pointer-events-none" />

        {/* Inner Borders */}
        <div className="absolute inset-4 rounded-full" style={{ border: "1px solid rgba(252,211,77,0.2)" }} />
        <div className="absolute inset-6 rounded-full" style={{ border: "4px solid rgba(251,191,36,0.05)" }} />
        <div className="absolute inset-[2.5rem] rounded-full" style={{ border: "1px solid rgba(252,211,77,0.1)" }} />

        {/* Laurel SVG */}
        <div className="absolute inset-10 pointer-events-none opacity-20">
          <svg viewBox="0 0 100 100" className="w-full h-full fill-[#FCD34D]">
            <path
              d="M30,75 C20,70 15,60 15,45 C15,30 25,20 40,20 M70,75 C80,70 85,60 85,45 C85,30 75,20 60,20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" />
          </svg>
        </div>

        {/* Content */}
        <div className="relative z-20 space-y-6 pt-6">
          <div className="flex justify-center gap-2">
            <Star size={14} style={{ fill: "url(#goldGradient)", color: "transparent" }} />
            <Star size={24} style={{ fill: "url(#goldGradient)", color: "transparent" }} className="-translate-y-2" />
            <Star size={14} style={{ fill: "url(#goldGradient)", color: "transparent" }} />
          </div>

          <div className="space-y-2">
            <span className="text-[10px] font-black uppercase tracking-[0.5em] block" style={{ color: BLUE }}>
              Global Standard
            </span>
            <h3
              className="text-6xl md:text-7xl text-white leading-none tracking-tighter"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              ABFT
            </h3>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#FCD34D] italic">
              Vetted Consensus Architecture
            </p>
          </div>

          <div className="w-16 h-px bg-white/10 mx-auto" />

          <div className="space-y-2">
            <h4
              className="text-2xl md:text-3xl italic text-slate-300 leading-tight"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Sustainability Leader
            </h4>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] block" style={{ color: BLUE }}>
              Best in Class &bull; Green Energy
            </span>
          </div>

          <div className="flex justify-center gap-6 pt-4 opacity-90">
            <Lock size={32} style={{ color: "url(#goldGradient)" }} strokeWidth={2.5} />
            <Award size={28} className="text-white" />
            <Shield size={24} style={{ color: "url(#goldGradient)" }} />
          </div>
        </div>

        {/* Rotating Text */}
        <div className="absolute inset-0 pointer-events-none">
          <svg
            viewBox="0 0 100 100"
            className="w-full h-full opacity-40"
            style={{ animation: "spin 40s linear infinite" }}
          >
            <path id="royal-curve" d="M 50, 50 m -44, 0 a 44,44 0 1,1 88,0 a 44,44 0 1,1 -88,0" fill="none" />
            <text className="text-[4px] font-black uppercase tracking-[0.5em] fill-white">
              <textPath href="#royal-curve">
                INSTITUTIONAL INFRASTRUCTURE &bull; HEDERA NETWORK &bull; &nbsp; &nbsp; WRAPPDEX &nbsp; &nbsp; &bull; SOVEREIGN ASSET CUSTODY &bull;
              </textPath>
            </text>
          </svg>
        </div>
      </motion.div>

      {/* Shine Sweep */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full">
        <motion.div
          animate={{ x: ["-150%", "150%"] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", repeatDelay: 3 }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent skew-x-[35deg] translate-x-[-150%]"
        />
      </div>

      {/* Outer Glow */}
      <div className="absolute inset-[-20%] blur-[120px] rounded-full pointer-events-none -z-10" style={{ backgroundColor: `${BLUE}0d` }} />

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

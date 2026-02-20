import { motion } from "motion/react";

const BLUE = "#1D63ED";

export function LandingCTA() {
  return (
    <section className="py-20 sm:py-32 md:py-48 bg-black text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-20">
        <div
          className="absolute top-0 left-0 w-full h-full"
          style={{ background: `radial-gradient(circle at 20% 30%, ${BLUE}, transparent 70%)` }}
        />
      </div>
      <div className="container relative mx-auto px-4 text-center z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1 }}
        >
          <h2
            className="text-6xl md:text-[120px] mb-16 leading-[0.85] tracking-tighter"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Lead the <br />
            <span className="italic" style={{ color: BLUE }}>
              Decentralized Future.
            </span>
          </h2>
          <p
            className="text-xl md:text-2xl text-slate-400 mb-20 max-w-4xl mx-auto font-light leading-relaxed"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Connect with the world's most sophisticated institutional network for decentralized custody and liquidity
            operations.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-10">
            <a href="mailto:Info@Wrappdex.io">
              <button
                type="button"
                className="text-white font-black uppercase tracking-[0.3em] text-[11px] h-20 px-16 hover:bg-white hover:text-black transition-all shadow-2xl cursor-pointer"
                style={{ backgroundColor: BLUE }}
              >
                Contact Wrappdex
              </button>
            </a>
            <a href="https://hbar.guide/" target="_blank" rel="noopener noreferrer">
              <button
                type="button"
                className="h-20 px-16 bg-white text-black font-black uppercase tracking-[0.3em] text-[11px] transition-all cursor-pointer"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = BLUE;
                  e.currentTarget.style.color = "white";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "white";
                  e.currentTarget.style.color = "black";
                }}
              >
                Network Intelligence
              </button>
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
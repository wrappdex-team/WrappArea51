import { motion } from "motion/react";
import { Shield, Lock, Database, Fingerprint } from "lucide-react";
import { LandingAwardRibbon } from "./LandingAwardRibbon";

const BLUE = "#1D63ED";

const features = [
  { icon: Shield, title: "Secure Custody", text: "Multi-layered encryption with high-fidelity cryptographic signatures." },
  { icon: Lock, title: "Distributed Trust", text: "Eliminating single points of failure via multi-signature node protocols." },
  { icon: Database, title: "Asset Integrity", text: "Immutable real-time auditing and instantaneous transaction settlement." },
  { icon: Fingerprint, title: "Compliance Ready", text: "Integrated identity frameworks for seamless institutional adoption." },
];

export function LandingNetwork() {
  return (
    <section className="py-20 sm:py-32 md:py-48 bg-white" id="network">
      <div className="container mx-auto px-4">
        <div className="flex flex-col lg:flex-row gap-32 items-center">
          <div className="flex-1">
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 1 }}
            >
              <span className="text-[10px] font-black uppercase tracking-[0.5em] block mb-8" style={{ color: BLUE }}>
                Consensus Protocol
              </span>
              <h2
                className="text-6xl md:text-8xl mb-12 leading-tight text-black tracking-tight"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                A Trusted Core for <br />
                <span className="italic">Global Institutions.</span>
              </h2>
              <p className="text-xl text-slate-500 mb-16 leading-relaxed font-light max-w-2xl" style={{ fontFamily: "'Inter', sans-serif" }}>
                Wrappdex leverages enterprise-grade public consensus to provide efficient settlement and asset custody.
                Engineered for high-performance operational resilience.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
                {features.map((item, i) => (
                  <div key={i} className="flex gap-8 group">
                    <div
                      className="shrink-0 w-14 h-14 flex items-center justify-center transition-all duration-500 shadow-sm"
                      style={{ border: "1px solid #f1f5f9" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = BLUE;
                        e.currentTarget.style.backgroundColor = `${BLUE}0d`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "#f1f5f9";
                        e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <item.icon size={20} className="text-black group-hover:text-[#1D63ED] transition-colors" />
                    </div>
                    <div>
                      <h4 className="font-black text-[11px] uppercase tracking-[0.2em] mb-3 group-hover:text-[#1D63ED] transition-colors">
                        {item.title}
                      </h4>
                      <p className="text-xs text-slate-400 leading-relaxed font-light">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
          <div className="flex-1 w-full relative">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.2 }}
              className="relative aspect-square md:aspect-[4/5] bg-transparent"
            >
              <LandingAwardRibbon />
            </motion.div>
            <div className="absolute -bottom-10 -right-10 w-48 h-48 -z-10" style={{ border: `1px solid ${BLUE}1a` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
import { motion } from "motion/react";

const BLUE = "#1D63ED";

const roadmap = [
  { phase: "Phase 01", title: "Infrastructure", items: ["Secure Node Deployment", "Multi-Sig Custody Protocol", "Compliance Integration"] },
  { phase: "Phase 02", title: "Strategic Onboarding", items: ["Institutional API Suite", "Asset Tokenization", "Governance Implementation"] },
  { phase: "Phase 03", title: "Network Liquidity", items: ["Institutional Bridging", "Settlement Optimization", "Global Expansion"] },
  { phase: "Phase 04", title: "Full Scale Operations", items: ["Interbank Settlement", "Sovereign Asset Custody", "Market Maturity"] },
];

export function LandingRoadmap() {
  return (
    <section id="roadmap" className="py-48 bg-slate-50" style={{ borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
      <div className="container mx-auto px-4">
        <div className="text-center mb-32">
          <span className="text-[10px] font-black uppercase tracking-[0.5em] block mb-8" style={{ color: BLUE }}>
            Strategic Execution
          </span>
          <h2
            className="text-6xl md:text-8xl text-black tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Development Roadmap
          </h2>
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 overflow-hidden"
          style={{ boxShadow: "0 32px 64px -16px rgba(0,0,0,0.08)" }}
        >
          {roadmap.map((stage, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.8 }}
              className="p-16 bg-white hover:bg-slate-50 transition-all group flex flex-col justify-between h-full relative"
              style={{ borderRight: i < 3 ? "1px solid #f1f5f9" : "none" }}
            >
              <div
                className="absolute top-0 right-0 p-6 text-[40px] italic text-slate-50 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                0{i + 1}
              </div>
              <div>
                <div className="font-black text-[10px] tracking-[0.4em] uppercase mb-12" style={{ color: BLUE }}>
                  {stage.phase}
                </div>
                <h4
                  className="text-3xl mb-10 group-hover:italic transition-all"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {stage.title}
                </h4>
                <ul className="space-y-6">
                  {stage.items.map((item, j) => (
                    <li
                      key={j}
                      className="text-[11px] text-slate-400 flex items-center gap-4 uppercase tracking-[0.2em] font-black group-hover:text-slate-600 transition-colors"
                    >
                      <div className="w-1 h-1 transform rotate-45" style={{ backgroundColor: BLUE }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

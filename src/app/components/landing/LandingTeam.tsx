import { motion } from "motion/react";
import { Users, ExternalLink } from "lucide-react";

const BLUE = "#1D63ED";

const team = [
  {
    name: "Kyle Post",
    role: "Chief Executive Officer",
    link: "https://x.com/KylePost17",
    desc: "Driving the global strategic direction of Wrappdex with extensive experience in cryptographic settlement and institutional fintech.",
  },
  {
    name: "Natalie",
    role: "Chief Marketing Officer",
    link: "https://x.com/Natnatx007",
    desc: "Orchestrating global adoption through sophisticated growth strategies and institutional ecosystem engagement.",
  },
  {
    name: "Carlos",
    role: "Strategic Relations",
    link: "https://x.com/carlosrevilla_",
    desc: "Cultivating institutional partnerships and fostering transparent governance for the next generation of decentralized finance.",
  },
];

export function LandingTeam() {
  return (
    <section className="py-48 bg-slate-50" id="about" style={{ borderTop: "1px solid #e2e8f0" }}>
      <div className="container relative mx-auto px-4 z-10">
        <div className="flex flex-col lg:flex-row items-center gap-32">
          <div className="flex-1">
            <a
              href="https://discord.gg/ZFnfRFxQZ"
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
            >
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 1 }}
                className="relative p-6 md:p-12 bg-white mb-8 transition-all duration-700 group-hover:translate-y-[-8px] group-hover:shadow-2xl"
                style={{
                  border: "1px solid #f1f5f9",
                  boxShadow: "0 32px 64px -16px rgba(0,0,0,0.08)",
                }}
              >
                {/* Frame Accents */}
                <div
                  className="absolute top-0 left-0 w-20 h-20 z-20 transition-all group-hover:w-full group-hover:h-full group-hover:opacity-10"
                  style={{ borderTop: `1px solid ${BLUE}4d`, borderLeft: `1px solid ${BLUE}4d` }}
                />
                <div
                  className="absolute bottom-0 right-0 w-20 h-20 z-20 transition-all group-hover:w-full group-hover:h-full group-hover:opacity-10"
                  style={{ borderBottom: `1px solid ${BLUE}4d`, borderRight: `1px solid ${BLUE}4d` }}
                />

                <div className="relative aspect-[4/3] overflow-hidden bg-slate-50">
                  <img
                    src="https://cdn.builder.io/api/v1/image/assets%2F40d47a8a19594e8684b17f309e3be30d%2Fa2d90583d2174bb7bba8a402388aee72?format=webp&width=800&height=1200"
                    alt="Wrappdex Boardroom"
                    className="w-full h-full object-cover grayscale brightness-95 group-hover:brightness-100 transition-all duration-[2s] group-hover:scale-110"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors duration-500">
                    <Users className="text-white opacity-0 group-hover:opacity-100 transition-all transform scale-50 group-hover:scale-100" size={48} />
                  </div>
                </div>
              </motion.div>
            </a>
          </div>
          <div className="flex-1">
            <div className="mb-20">
              <span className="text-[10px] font-black uppercase tracking-[0.5em] block mb-8" style={{ color: BLUE }}>
                Board of Directors
              </span>
              <h2
                className="text-6xl md:text-8xl text-black leading-[0.9] tracking-tighter"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Strategic <br />
                <span className="italic">Leadership.</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-16">
              {team.map((member, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.2, duration: 0.8 }}
                  className="pb-12 last:border-0 group"
                  style={{ borderBottom: i < team.length - 1 ? "1px solid #f1f5f9" : "none" }}
                >
                  <div className="flex items-baseline justify-between mb-6">
                    <h3
                      className="text-4xl text-black group-hover:italic transition-all duration-500"
                      style={{ fontFamily: "'Playfair Display', serif" }}
                    >
                      <a href={member.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4">
                        {member.name}{" "}
                        <ExternalLink
                          size={16}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: BLUE }}
                        />
                      </a>
                    </h3>
                    <span
                      className="text-[9px] font-black uppercase tracking-[0.3em] px-3 py-1"
                      style={{ color: BLUE, backgroundColor: `${BLUE}0d` }}
                    >
                      {member.role}
                    </span>
                  </div>
                  <p className="text-slate-500 text-base leading-relaxed font-light">{member.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

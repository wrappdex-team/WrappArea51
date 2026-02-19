import { motion } from "motion/react";
import { Shield, ChevronRight } from "lucide-react";

const BLUE = "#1D63ED";

const cards = [
  {
    title: "Decentralized Custody",
    desc: "Utilizing distributed infrastructure designed for absolute asset sovereignty and secure operations in a modern economy.",
    link: "CUSTODY PROTOCOLS",
    url: "https://www.curvegrid.com/blog/2023-05-23-decentralized-vs-centralized-custody",
  },
  {
    title: "Network Resilience",
    desc: "Wrappdex operates on the Hedera network, leveraging advanced consensus for decentralized management that remains secure and scalable.",
    link: "TECHNICAL SPECIFICATIONS",
    url: "https://hedera.com/service/consensus-service/",
    highlight: true,
  },
  {
    title: "Global Liquidity",
    desc: "Access international asset management with a focus on institutional transparency and 24/7 strategic support.",
    link: "INSTITUTIONAL ACCESS",
    url: "https://coinmarketcap.com/currencies/hedera/",
  },
];

const wallets = [
  { name: "HashPack", url: "https://www.hashpack.app/" },
  { name: "Kabila", url: "https://kabila.app/" },
  { name: "MetaMask", url: "https://metamask.io/" },
  { name: "Phantom", url: "https://phantom.app/" },
  { name: "Dynamic", url: "https://www.dynamic.xyz/" },
  { name: "WalletConnect", url: "https://walletconnect.com/" },
];

export function LandingCards() {
  return (
    <section className="py-48 bg-white relative overflow-hidden" id="custody" style={{ borderBottom: "1px solid #e2e8f0" }}>
      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-100"
          style={{ border: "1px solid #f1f5f9", boxShadow: "0 32px 64px -16px rgba(0,0,0,0.08)" }}
        >
          {cards.map((card, i) => (
            <div
              key={i}
              className="bg-white p-16 flex flex-col justify-between hover:bg-slate-50 transition-all duration-500 group h-full relative overflow-hidden"
            >
              <div
                className="absolute top-0 left-0 w-full h-1 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-700 origin-left"
                style={{ backgroundColor: BLUE }}
              />
              <div>
                <span className="text-[10px] font-black mb-10 block tracking-[0.3em]" style={{ color: `${BLUE}40` }}>
                  0{i + 1}
                </span>
                <h3
                  className={`text-4xl mb-8 transition-all duration-500 group-hover:italic ${
                    card.highlight ? "italic" : "text-black"
                  }`}
                  style={{
                    fontFamily: "'Playfair Display', serif",
                    color: card.highlight ? BLUE : "black",
                  }}
                >
                  {card.title}
                </h3>
                <p className="text-slate-500 leading-relaxed mb-12 text-sm font-light" style={{ fontFamily: "'Inter', sans-serif" }}>
                  {card.desc}
                </p>
              </div>
              <a
                href={card.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] hover:text-black transition-all"
                style={{ color: BLUE }}
              >
                {card.link}{" "}
                <ChevronRight size={14} className="group-hover:translate-x-2 transition-transform" />
              </a>
            </div>
          ))}
        </motion.div>

        {/* Supported Wallets */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5, duration: 1 }}
          className="mt-32 pt-20"
          style={{ borderTop: "1px solid #f1f5f9" }}
        >
          <div className="flex flex-col lg:flex-row items-center justify-between gap-16">
            <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">
              <Shield size={14} style={{ color: BLUE }} /> Supported Wallets
            </div>
            <div className="flex flex-wrap justify-center gap-x-16 gap-y-8">
              {wallets.map((wallet) => (
                <a
                  key={wallet.name}
                  href={wallet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-black tracking-[0.3em] uppercase text-slate-400 transition-all hover:translate-y-[-2px]"
                  onMouseEnter={(e) => (e.currentTarget.style.color = BLUE)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "")}
                >
                  {wallet.name}
                </a>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

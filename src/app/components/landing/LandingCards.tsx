import { motion } from "motion/react";
import { Shield, ChevronRight } from "lucide-react";
import { walletIconMap } from "./WalletIcons";

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
    <section className="py-12 sm:py-16 md:py-20 bg-white relative overflow-hidden" id="custody" style={{ borderBottom: "1px solid #e2e8f0" }}>
      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-100"
          style={{ border: "1px solid #f1f5f9", boxShadow: "0 16px 48px -12px rgba(0,0,0,0.06)" }}
        >
          {cards.map((card, i) => (
            <div
              key={i}
              className="bg-white px-6 py-8 sm:px-8 sm:py-10 md:px-10 md:py-12 flex flex-col justify-between hover:bg-slate-50 transition-all duration-500 group relative overflow-hidden"
            >
              <div
                className="absolute top-0 left-0 w-full h-[2px] transform scale-x-0 group-hover:scale-x-100 transition-transform duration-700 origin-left"
                style={{ backgroundColor: BLUE }}
              />
              <div>
                <span className="text-[9px] font-black mb-4 block tracking-[0.3em]" style={{ color: `${BLUE}40` }}>
                  0{i + 1}
                </span>
                <h3
                  className={`text-xl sm:text-2xl mb-3 transition-all duration-500 group-hover:italic ${
                    card.highlight ? "italic" : "text-black"
                  }`}
                  style={{
                    fontFamily: "'Playfair Display', serif",
                    color: card.highlight ? BLUE : "black",
                  }}
                >
                  {card.title}
                </h3>
                <p className="text-slate-500 leading-relaxed mb-6 text-xs font-light line-clamp-3" style={{ fontFamily: "'Inter', sans-serif" }}>
                  {card.desc}
                </p>
              </div>
              <a
                href={card.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] hover:text-black transition-all"
                style={{ color: BLUE }}
              >
                {card.link}{" "}
                <ChevronRight size={12} className="group-hover:translate-x-1 transition-transform" />
              </a>
            </div>
          ))}
        </motion.div>

        {/* Supported Wallets — compact strip */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="mt-10 sm:mt-14 pt-8 sm:pt-10"
          style={{ borderTop: "1px solid #f1f5f9" }}
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-[0.35em] text-slate-400 shrink-0">
              <Shield size={12} style={{ color: BLUE }} /> Supported Wallets
            </div>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-3">
              {wallets.map((wallet) => {
                const Icon = walletIconMap[wallet.name];
                return (
                  <a
                    key={wallet.name}
                    href={wallet.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[10px] font-bold tracking-[0.15em] uppercase text-slate-400 hover:text-[#1D63ED] transition-all hover:translate-y-[-1px] group/wallet"
                  >
                    {Icon && (
                      <span className="grayscale opacity-50 group-hover/wallet:grayscale-0 group-hover/wallet:opacity-100 transition-all duration-300">
                        <Icon size={16} />
                      </span>
                    )}
                    {wallet.name}
                  </a>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
const BLUE = "#1D63ED";

const partners = [
  { name: "HashPack", url: "https://www.hashpack.app/", logo: "https://avatars.githubusercontent.com/u/87255978?v=4&s=200" },
  { name: "AltLantis", url: "https://altlantis.io/", logo: "https://altlantis.io/img/logo.svg" },
  { name: "HSuite", url: "https://hsuite.network/", logo: "https://www.google.com/s2/favicons?domain=hsuite.network&sz=128" },
  { name: "Hashport", url: "https://www.hashport.network/", logo: "https://www.google.com/s2/favicons?domain=hashport.network&sz=128" },
  { name: "IvyFi", url: "https://www.ivyfi.io/", logo: "https://avatars.githubusercontent.com/u/192332449?v=4&s=200" },
  { name: "Impart Global", url: "https://www.impart.global/", logo: "https://www.google.com/s2/favicons?domain=impart.global&sz=128" },
  { name: "SaucerSwap", url: "https://www.saucerswap.finance/", logo: "https://avatars.githubusercontent.com/u/112772558?v=4&s=200" },
  { name: "Bonzo Finance", url: "https://bonzo.finance/", logo: "https://avatars.githubusercontent.com/u/158205956?v=4&s=200" },
  { name: "Squid Router", url: "https://www.squidrouter.com/", logo: "https://avatars.githubusercontent.com/u/89154910?v=4&s=200" },
  { name: "Stargate", url: "https://stargate.finance/", logo: "https://avatars.githubusercontent.com/u/101737707?v=4&s=200" },
];

export function LandingPartners() {
  return (
    <section className="py-20 sm:py-32 md:py-48 bg-white relative overflow-hidden" id="ecosystem">
      <div className="container relative mx-auto px-4 z-10">
        <div className="text-center mb-32">
          <span className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-400 block mb-8">
            The Global Network
          </span>
          <h2
            className="text-5xl md:text-7xl text-black"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Strategic Partners
          </h2>
        </div>

        <div
          className="grid grid-cols-2 md:grid-cols-5 gap-px bg-slate-100 overflow-hidden"
          style={{ border: "1px solid #f1f5f9", boxShadow: "0 32px 64px -16px rgba(0,0,0,0.08)" }}
        >
          {partners.map((partner, i) => (
            <a
              key={i}
              href={partner.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center p-16 bg-white hover:bg-slate-50 transition-all duration-500 group grayscale hover:grayscale-0 relative overflow-hidden"
            >
              <div
                className="absolute inset-0 transform translate-y-full group-hover:translate-y-[98%] transition-transform duration-500"
                style={{ backgroundColor: BLUE }}
              />
              <img
                src={partner.logo}
                alt={partner.name}
                className="w-14 h-14 object-contain mb-6 opacity-30 group-hover:opacity-100 transition-all duration-500 relative z-10 scale-95 group-hover:scale-110"
              />
              <span className="text-[9px] font-black text-slate-400 group-hover:text-black uppercase tracking-[0.3em] whitespace-nowrap transition-colors relative z-10">
                {partner.name}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
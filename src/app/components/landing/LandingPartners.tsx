import { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";

const BLUE = "#1D63ED";
const API = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

/* ── Static partner data with fallback external URLs ── */
const partners = [
  { name: "HashPack", url: "https://www.hashpack.app/", fallbackLogo: "https://avatars.githubusercontent.com/u/87255978?v=4&s=200" },
  { name: "AltLantis", url: "https://altlantis.io/", fallbackLogo: "https://altlantis.io/img/logo.svg" },
  { name: "HSuite", url: "https://hsuite.network/", fallbackLogo: "https://www.google.com/s2/favicons?domain=hsuite.network&sz=128" },
  { name: "Hashport", url: "https://www.hashport.network/", fallbackLogo: "https://www.google.com/s2/favicons?domain=hashport.network&sz=128" },
  { name: "IvyFi", url: "https://www.ivyfi.io/", fallbackLogo: "https://avatars.githubusercontent.com/u/192332449?v=4&s=200" },
  { name: "Impart Global", url: "https://www.impart.global/", fallbackLogo: "https://www.google.com/s2/favicons?domain=impart.global&sz=128" },
  { name: "SaucerSwap", url: "https://www.saucerswap.finance/", fallbackLogo: "https://avatars.githubusercontent.com/u/112772558?v=4&s=200" },
  { name: "Bonzo Finance", url: "https://bonzo.finance/", fallbackLogo: "https://avatars.githubusercontent.com/u/158205956?v=4&s=200" },
  { name: "Squid Router", url: "https://www.squidrouter.com/", fallbackLogo: "https://avatars.githubusercontent.com/u/89154910?v=4&s=200" },
  { name: "Stargate", url: "https://stargate.finance/", fallbackLogo: "https://avatars.githubusercontent.com/u/101737707?v=4&s=200" },
];

/**
 * Logo component with three-tier fallback:
 *   1. Supabase bucket signed URL (if available from /partnered-logos)
 *   2. Hardcoded external fallback URL
 *   3. Styled initial letter (zero external dependencies)
 */
function PartnerLogo({
  name,
  bucketUrl,
  fallbackUrl,
}: {
  name: string;
  bucketUrl?: string;
  fallbackUrl: string;
}) {
  const [src, setSrc] = useState(bucketUrl || fallbackUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (bucketUrl) setSrc(bucketUrl);
  }, [bucketUrl]);

  const handleError = useCallback(() => {
    if (src === bucketUrl && fallbackUrl) {
      // Bucket URL failed → try external fallback
      setSrc(fallbackUrl);
    } else {
      // All image sources failed → show styled initial
      setFailed(true);
    }
  }, [src, bucketUrl, fallbackUrl]);

  if (failed) {
    return (
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 opacity-30 group-hover:opacity-100 transition-all duration-500 scale-95 group-hover:scale-110 relative z-10"
        style={{
          background: `${BLUE}08`,
          border: `1px solid ${BLUE}12`,
        }}
      >
        <span
          className="text-xl font-black"
          style={{ color: BLUE }}
        >
          {name.charAt(0)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      className="w-14 h-14 object-contain mb-6 opacity-30 group-hover:opacity-100 transition-all duration-500 relative z-10 scale-95 group-hover:scale-110"
      onError={handleError}
      loading="lazy"
    />
  );
}

export function LandingPartners() {
  const [bucketLogos, setBucketLogos] = useState<Record<string, string>>({});

  /* Try to fetch logos from Supabase "Partnered logos" bucket via server endpoint */
  useEffect(() => {
    fetch(`${API}/partnered-logos`, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.logos?.length) return;
        const map: Record<string, string> = {};
        for (const logo of data.logos) {
          // Match bucket filename to partner name (case-insensitive, strip extension)
          const baseName = (logo.name || "")
            .replace(/\.(png|jpg|jpeg|webp|svg|avif|gif)$/i, "")
            .toLowerCase()
            .trim();
          const url = logo.publicUrl || logo.url;
          if (baseName && url) map[baseName] = url;
        }
        setBucketLogos(map);
      })
      .catch(() => {
        /* Silent — fallback to external URLs */
      });
  }, []);

  /** Resolve bucket logo by trying common filename variants */
  const getBucketUrl = (name: string): string | undefined => {
    const key = name.toLowerCase().replace(/\s+/g, "");
    // Try: "hashpack", "hash-pack", "hash_pack", exact name
    return (
      bucketLogos[key] ||
      bucketLogos[name.toLowerCase().replace(/\s+/g, "-")] ||
      bucketLogos[name.toLowerCase().replace(/\s+/g, "_")] ||
      bucketLogos[name.toLowerCase()] ||
      undefined
    );
  };

  return (
    <section className="py-12 sm:py-16 md:py-20 bg-white relative overflow-hidden" id="ecosystem">
      <div className="container relative mx-auto px-4 z-10">
        <div className="text-center mb-12 md:mb-16">
          <span className="text-[9px] font-black uppercase tracking-[0.4em] text-slate-400 block mb-4">
            The Global Network
          </span>
          <h2
            className="text-3xl sm:text-4xl md:text-6xl text-black"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Strategic Partners
          </h2>
        </div>

        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-px bg-slate-100 overflow-hidden"
          style={{ border: "1px solid #f1f5f9", boxShadow: "0 16px 48px -12px rgba(0,0,0,0.06)" }}
        >
          {partners.map((partner, i) => (
            <a
              key={i}
              href={partner.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center px-6 py-10 sm:px-8 sm:py-12 bg-white hover:bg-slate-50 transition-all duration-500 group grayscale hover:grayscale-0 relative overflow-hidden"
            >
              <div
                className="absolute inset-0 transform translate-y-full group-hover:translate-y-[98%] transition-transform duration-500"
                style={{ backgroundColor: BLUE }}
              />
              <PartnerLogo
                name={partner.name}
                bucketUrl={getBucketUrl(partner.name)}
                fallbackUrl={partner.fallbackLogo}
              />
              <span className="text-[8px] sm:text-[9px] font-black text-slate-400 group-hover:text-black uppercase tracking-[0.25em] whitespace-nowrap transition-colors relative z-10">
                {partner.name}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
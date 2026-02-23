import { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { BUCKET_LOGOS } from "../../assets/brand";

const BLUE = "#1D63ED";
const API = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;
const ICON_PROXY = `${API}/icon-proxy`;

/** Wrap an external URL through our icon proxy (bypasses CDN hotlink blocks on Vercel). */
function proxy(url: string): string {
  return `${ICON_PROXY}?url=${encodeURIComponent(url)}`;
}

/* ── Static partner data ─────────────────────────────────────────────
 *
 * Each partner has:
 *   - bucketLogo:   Direct public URL from "Partnered logos" Supabase bucket
 *                   (works everywhere — our own infra, no hotlink blocks)
 *   - fallbackLogo: External GitHub avatar / data-URI SVG as emergency backup
 *
 * Resolution order per logo:
 *   1. Server-fetched bucket URL (if /partnered-logos returns match)
 *   2. Hardcoded bucket public URL (BUCKET_LOGOS.*)
 *   3. External fallback (GitHub avatar etc.)
 *   4. Proxied external fallback (via /icon-proxy)
 *   5. Letter initial (CSS-only, zero dependencies)
 */
const partners = [
  {
    name: "HashPack",
    url: "https://www.hashpack.app/",
    bucketLogo: BUCKET_LOGOS.hashpack,
    fallbackLogo: "https://avatars.githubusercontent.com/u/87255978?v=4&s=200",
  },
  {
    name: "AltLantis",
    url: "https://altlantis.io/",
    bucketLogo: BUCKET_LOGOS.altlantis,
    fallbackLogo: "https://avatars.githubusercontent.com/u/149635268?v=4&s=200",
  },
  {
    name: "HSuite",
    url: "https://hsuite.network/",
    bucketLogo: BUCKET_LOGOS.hsuite,
    fallbackLogo: "https://avatars.githubusercontent.com/u/114540559?v=4&s=200",
  },
  {
    name: "Hashport",
    url: "https://www.hashport.network/",
    bucketLogo: BUCKET_LOGOS.hashport,
    fallbackLogo: "https://avatars.githubusercontent.com/u/97393726?v=4&s=200",
  },
  {
    name: "IvyFi",
    url: "https://www.ivyfi.io/",
    bucketLogo: BUCKET_LOGOS.ivyfi,
    fallbackLogo: "https://avatars.githubusercontent.com/u/192332449?v=4&s=200",
  },
  {
    name: "Impart Global",
    url: "https://www.impart.global/",
    bucketLogo: BUCKET_LOGOS.impartglobal,
    fallbackLogo: "https://avatars.githubusercontent.com/u/148897649?v=4&s=200",
  },
  {
    name: "SaucerSwap",
    url: "https://www.saucerswap.finance/",
    bucketLogo: BUCKET_LOGOS.saucerswap,
    fallbackLogo: "https://avatars.githubusercontent.com/u/112772558?v=4&s=200",
  },
  {
    name: "Bonzo Finance",
    url: "https://bonzo.finance/",
    bucketLogo: BUCKET_LOGOS.bonzo,
    fallbackLogo: "https://avatars.githubusercontent.com/u/158205956?v=4&s=200",
  },
  {
    name: "Squid Router",
    url: "https://www.squidrouter.com/",
    bucketLogo: BUCKET_LOGOS.squid,
    fallbackLogo: "https://avatars.githubusercontent.com/u/89154910?v=4&s=200",
  },
  {
    name: "Stargate",
    url: "https://stargate.finance/",
    bucketLogo: BUCKET_LOGOS.stargate,
    fallbackLogo: "https://avatars.githubusercontent.com/u/101737707?v=4&s=200",
  },
];

/**
 * Logo component with five-tier fallback:
 *   1. Server-fetched bucket URL (freshest — picks up new uploads)
 *   2. Hardcoded bucket public URL (stable, no server call)
 *   3. External fallback URL (GitHub avatar etc.)
 *   4. Proxied external fallback (bypasses CDN blocks)
 *   5. Styled initial letter (CSS-only, zero external dependencies)
 */
function PartnerLogo({
  name,
  serverBucketUrl,
  hardcodedBucketUrl,
  fallbackUrl,
}: {
  name: string;
  serverBucketUrl?: string;
  hardcodedBucketUrl?: string;
  fallbackUrl: string;
}) {
  // Build URL list — deduplicated, ordered by preference
  const urls = [
    serverBucketUrl,
    hardcodedBucketUrl,
    fallbackUrl,
    // Don't proxy data URIs or bucket URLs (they're already on our infra)
    fallbackUrl.startsWith("data:") || fallbackUrl.includes("supabase.co")
      ? undefined
      : proxy(fallbackUrl),
  ].filter((u): u is string => !!u);

  // Deduplicate
  const uniqueUrls = [...new Set(urls)];

  const [urlIdx, setUrlIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  // Reset when server bucket URL arrives
  useEffect(() => {
    if (serverBucketUrl) {
      setUrlIdx(0);
      setFailed(false);
    }
  }, [serverBucketUrl]);

  const handleError = useCallback(() => {
    setUrlIdx((prev) => {
      const next = prev + 1;
      if (next >= uniqueUrls.length) {
        setFailed(true);
        return prev;
      }
      return next;
    });
  }, [uniqueUrls.length]);

  if (failed) {
    return (
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 opacity-30 group-hover:opacity-100 transition-all duration-500 scale-95 group-hover:scale-110 relative z-10"
        style={{
          background: `${BLUE}08`,
          border: `1px solid ${BLUE}12`,
        }}
      >
        <span className="text-xl font-black" style={{ color: BLUE }}>
          {name.charAt(0)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={uniqueUrls[urlIdx]}
      alt={name}
      className="w-14 h-14 object-contain mb-6 opacity-30 group-hover:opacity-100 transition-all duration-500 relative z-10 scale-95 group-hover:scale-110"
      onError={handleError}
      loading="lazy"
    />
  );
}

export function LandingPartners() {
  const [serverLogos, setServerLogos] = useState<Record<string, string>>({});

  /* Fetch logos from server endpoint — enriches hardcoded bucket URLs
     with any new files uploaded after deployment. */
  useEffect(() => {
    fetch(`${API}/partnered-logos`, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.logos?.length) return;
        const map: Record<string, string> = {};
        for (const logo of data.logos) {
          // Strip extension, strip _logo suffix, strip dots/underscores/hyphens
          const baseName = (logo.name || "")
            .replace(/\.(png|jpg|jpeg|webp|svg|avif|gif)$/i, "")
            .replace(/_?logo$/i, "")
            .toLowerCase()
            .replace(/[\s_\-.]+/g, "")
            .trim();
          const url = logo.publicUrl || logo.url;
          if (baseName && url) map[baseName] = url;
        }
        setServerLogos(map);
      })
      .catch(() => {
        /* Silent — hardcoded bucket URLs are already loaded */
      });
  }, []);

  /** Resolve server-fetched bucket logo by trying common filename variants */
  const getServerUrl = (name: string): string | undefined => {
    const key = name.toLowerCase().replace(/[\s_\-.]+/g, "");
    return (
      serverLogos[key] ||
      serverLogos[name.toLowerCase().replace(/\s+/g, "")] ||
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
          {partners.map((partner) => (
            <a
              key={partner.name}
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
                serverBucketUrl={getServerUrl(partner.name)}
                hardcodedBucketUrl={partner.bucketLogo}
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
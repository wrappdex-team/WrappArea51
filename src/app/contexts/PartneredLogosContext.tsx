/**
 * PartneredLogosContext
 *
 * Provides partner/wallet logos app-wide. Three-tier resolution:
 *
 *   1. BUCKET_LOGOS (direct public URLs from "Partnered logos" bucket)
 *      → instant, no server call, works on all deployments
 *
 *   2. Server /partnered-logos endpoint (enrichment — only used to
 *      detect NEW files uploaded after this code was deployed)
 *
 *   3. brand.ts data-URI SVGs (emergency fallback — zero network)
 *
 * The bucket is PUBLIC, so public URLs are stable and permanent.
 * The server endpoint is a nice-to-have, not a dependency.
 *
 * Bucket files (known):
 *   - altlantis_logo.png       → (landing page only)
 *   - bonzo_logo.png           → (landing page only)
 *   - dynamiclogin_logo.png    → dynamic
 *   - habr.h.light_logo.png    → hbarLight (legacy "habr" spelling)
 *   - hashpack_logo.png        → hashpack
 *   - hashport_logo.png        → hashport
 *   - hbar.h.dark_logo.png     → hbarDark (renamed from habr)
 *   - hsuite_logo.png          → (landing page only)
 *   - impartglobal_logo.png    → (landing page only)
 *   - ivyfi_logo.png           → (landing page only)
 *   - metamask_logo.png        → metamask
 *   - saucerswap_logo.png      → (landing page only)
 *   - squid_logo.png           → (landing page only)
 *   - stargate_logo.png        → (landing page only)
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { log } from "../utils/logger";
import {
  BUCKET_LOGOS,
  HASHPACK_LOGO,
  METAMASK_LOGO,
  DYNAMIC_LOGO,
  HASHPORT_LOGO,
  HBARH_LOGO_DARK,
  HBARH_LOGO_LIGHT,
} from "../assets/brand";

// ── Types ────────────────────────────────────────────────────────────

export interface PartneredLogos {
  metamask: string;
  hashpack: string;
  dynamic: string;
  hashport: string;
  hbarDark: string;
  hbarLight: string;
  loaded: boolean;
}

// Defaults use the BUCKET public URLs (instant, no server call needed).
// Data-URI SVGs from brand.ts are the emergency fallback only.
const DEFAULTS: PartneredLogos = {
  metamask: BUCKET_LOGOS.metamask,
  hashpack: BUCKET_LOGOS.hashpack,
  dynamic: BUCKET_LOGOS.dynamic,
  hashport: BUCKET_LOGOS.hashport,
  hbarDark: BUCKET_LOGOS.hbarDark,
  hbarLight: BUCKET_LOGOS.hbarLight,
  loaded: false,
};

// Emergency fallback (data URIs — if bucket URLs somehow fail)
const SVG_FALLBACKS: PartneredLogos = {
  metamask: METAMASK_LOGO,
  hashpack: HASHPACK_LOGO,
  dynamic: DYNAMIC_LOGO,
  hashport: HASHPORT_LOGO,
  hbarDark: HBARH_LOGO_DARK,
  hbarLight: HBARH_LOGO_LIGHT,
  loaded: false,
};

// ── Module-level cache ───────────────────────────────────────────────

let _cache: PartneredLogos | null = null;
let _fetchPromise: Promise<PartneredLogos> | null = null;

const ENDPOINT = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/partnered-logos`;
const IMG_EXT = /\.(png|jpg|jpeg|webp|svg|avif|gif)$/i;

interface BucketFile {
  name: string;
  publicUrl: string;
}

function matchLogos(files: BucketFile[]): PartneredLogos {
  const images = files.filter((f) => IMG_EXT.test(f.name));
  if (images.length === 0) {
    log.info("PartneredLogos", "No image files found in bucket response");
    return { ...DEFAULTS };
  }

  const result: PartneredLogos = { ...DEFAULTS };
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const file of images) {
    // Normalize: lowercase, strip whitespace/underscores/hyphens AND dots
    // e.g. "hbar.h.dark_logo.png" → strip ext → "hbar.h.dark_logo" → normalize → "hbarhdarklogo"
    // Also handles legacy "habr.h.light_logo.png" → "habrhlightlogo"
    const nameNoExt = file.name.replace(/\.(png|jpg|jpeg|webp|svg|avif|gif)$/i, "");
    const n = nameNoExt.toLowerCase().replace(/[\s_\-.]+/g, "");
    let key: string | null = null;

    if (n.includes("metamask") || n.includes("metam") || n.includes("fox")) {
      result.metamask = file.publicUrl;
      key = "metamask";
    } else if (n.includes("hashpack")) {
      result.hashpack = file.publicUrl;
      key = "hashpack";
    } else if (n.includes("dynamic")) {
      result.dynamic = file.publicUrl;
      key = "dynamic";
    } else if (n.includes("hashport")) {
      result.hashport = file.publicUrl;
      key = "hashport";
    } else if (n.includes("hbar") || n.includes("habr")) {
      // HBAR.ħ token icon — check for dark/light variants
      // Bucket uses "habr.h" (legacy naming) — match both "hbar" and "habr"
      if (n.includes("dark")) {
        result.hbarDark = file.publicUrl;
        key = "hbarDark";
      } else if (n.includes("light") || n.includes("white")) {
        result.hbarLight = file.publicUrl;
        key = "hbarLight";
      } else {
        // Generic HBAR — use for both
        result.hbarDark = file.publicUrl;
        result.hbarLight = file.publicUrl;
        key = "hbarDark+hbarLight";
      }
    }

    if (key) {
      matched.push(`${file.name} → ${key}`);
    } else {
      unmatched.push(file.name);
    }
  }

  log.debug("PartneredLogos", `Matched: [${matched.join(", ")}]`);
  if (unmatched.length > 0) {
    log.debug("PartneredLogos", `Unmatched: [${unmatched.join(", ")}]`);
  }

  result.loaded = true;
  return result;
}

function preloadImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Don't preload data URIs — they're always available
    if (src.startsWith("data:")) { resolve(true); return; }
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

async function fetchPartneredLogos(): Promise<PartneredLogos> {
  // Start with bucket public URLs as baseline (already in DEFAULTS)
  // The server call enriches/overrides if there are new files.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    const res = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn("PartneredLogos", `Server returned ${res.status}: ${body}`);
      // Server failed — but bucket URLs in DEFAULTS are already good!
      return { ...DEFAULTS, loaded: true };
    }

    const data = await res.json();
    const logos: BucketFile[] = data.logos ?? [];

    log.debug(
      "PartneredLogos",
      `Server response — urlType=${data.urlType}, isPublic=${data.isPublic}, files=${logos.length}`,
      logos.map((f: BucketFile) => f.name),
    );
    if (data.hint) log.debug("PartneredLogos", `Hint: ${data.hint}`);

    if (logos.length === 0) {
      log.info("PartneredLogos", "No logos returned from server — using bucket defaults");
      return { ...DEFAULTS, loaded: true };
    }

    const matched = matchLogos(logos);

    // Log final resolved URLs (truncated for readability)
    const truncUrl = (u: string) => u.length > 80 ? `...${u.slice(-60)}` : u;
    log.debug("PartneredLogos", "Final resolved", {
      metamask: truncUrl(matched.metamask),
      hashpack: truncUrl(matched.hashpack),
      dynamic: truncUrl(matched.dynamic),
      hashport: truncUrl(matched.hashport),
      hbarDark: truncUrl(matched.hbarDark),
      hbarLight: truncUrl(matched.hbarLight),
    });

    // Preload all resolved images (log failures but don't block)
    const urls = new Set([
      matched.metamask,
      matched.hashpack,
      matched.dynamic,
      matched.hashport,
      matched.hbarDark,
      matched.hbarLight,
    ]);
    const preloadResults = await Promise.all([...urls].map(async (src) => {
      const ok = await preloadImage(src);
      return { src: src.length > 80 ? `...${src.slice(-50)}` : src, ok };
    }));
    const failed = preloadResults.filter((r) => !r.ok);
    if (failed.length > 0) {
      log.warn("PartneredLogos", `Preload failed for: ${failed.map((r) => r.src).join(", ")}`);
      // Replace failed URLs with SVG fallbacks
      for (const key of Object.keys(matched) as (keyof PartneredLogos)[]) {
        if (key === "loaded") continue;
        const url = matched[key] as string;
        const didFail = !await preloadImage(url);
        if (didFail && SVG_FALLBACKS[key]) {
          log.debug("PartneredLogos", `Replacing failed ${key} with SVG fallback`);
          (matched as any)[key] = SVG_FALLBACKS[key];
        }
      }
    } else {
      log.debug("PartneredLogos", "All partner logos preloaded successfully");
    }

    return matched;
  } catch (err) {
    log.warn("PartneredLogos", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    // Server is down — bucket URLs in DEFAULTS still work
    return { ...DEFAULTS, loaded: true };
  }
}

// ── React Context ────────────────────────────────────────────────────

const PartneredLogosCtx = createContext<PartneredLogos>(DEFAULTS);

export function PartneredLogosProvider({ children }: { children: ReactNode }) {
  const [logos, setLogos] = useState<PartneredLogos>(_cache ?? DEFAULTS);

  useEffect(() => {
    if (_cache && _cache.loaded) {
      setLogos(_cache);
      return;
    }

    // Reset stale promise if previous fetch returned unloaded defaults
    if (_cache && !_cache.loaded) {
      _cache = null;
      _fetchPromise = null;
    }

    if (!_fetchPromise) {
      _fetchPromise = fetchPartneredLogos().then((result) => {
        _cache = result;
        return result;
      });
    }

    let cancelled = false;
    _fetchPromise.then((result) => {
      if (!cancelled) setLogos(result);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PartneredLogosCtx.Provider value={logos}>{children}</PartneredLogosCtx.Provider>
  );
}

export function usePartneredLogos(): PartneredLogos {
  return useContext(PartneredLogosCtx);
}
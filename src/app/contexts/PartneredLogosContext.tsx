/**
 * PartneredLogosContext
 *
 * Fetches partner/wallet logos from the "Partnered logos" Supabase Storage
 * bucket via the /partnered-logos server endpoint. Matches filenames to
 * known partner keys and distributes resolved URLs app-wide.
 *
 * Filename matching rules (case-insensitive):
 *   - Contains "metamask"              -> metamask
 *   - Contains "hashpack"              -> hashpack
 *   - Contains "dynamic"               -> dynamic
 *   - Contains "hashport"              -> hashport
 *   - Contains "hbar" + "dark"         -> hbarDark
 *   - Contains "hbar" + "light"        -> hbarLight
 *   - Contains "hbar" (no dark/light)  -> hbarDark + hbarLight (both)
 *
 * Falls back to the static brand.ts values until the fetch resolves.
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { log } from "../utils/logger";
import {
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

const DEFAULTS: PartneredLogos = {
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
    const n = file.name.toLowerCase().replace(/[\s_-]+/g, "");
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
    } else if (n.includes("hbar")) {
      // HBAR.ħ token icon — check for dark/light variants
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
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

async function fetchPartneredLogos(): Promise<PartneredLogos> {
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
      return { ...DEFAULTS };
    }

    const data = await res.json();
    const logos: BucketFile[] = data.logos ?? [];

    // Log full server diagnostic data
    log.debug(
      "PartneredLogos",
      `Server response — urlType=${data.urlType}, isPublic=${data.isPublic}, files=${logos.length}`,
      logos.map((f: BucketFile) => f.name),
    );
    if (data.hint) log.debug("PartneredLogos", `Hint: ${data.hint}`);
    if (data.availableBuckets) log.debug("PartneredLogos", "Available buckets", data.availableBuckets);

    if (logos.length === 0) {
      log.info("PartneredLogos", "No logos returned from server — using defaults");
      return { ...DEFAULTS };
    }

    const matched = matchLogos(logos);

    // Log final resolved URLs (truncated for readability)
    const truncUrl = (u: string) => u.length > 80 ? `...${u.slice(-60)}` : u;
    log.debug("PartneredLogos", "Final resolved", {
      metamask: matched.metamask === DEFAULTS.metamask ? "DEFAULT" : truncUrl(matched.metamask),
      hashpack: matched.hashpack === DEFAULTS.hashpack ? "DEFAULT" : truncUrl(matched.hashpack),
      dynamic: matched.dynamic === DEFAULTS.dynamic ? "DEFAULT" : truncUrl(matched.dynamic),
      hashport: matched.hashport === DEFAULTS.hashport ? "DEFAULT" : truncUrl(matched.hashport),
      hbarDark: matched.hbarDark === DEFAULTS.hbarDark ? "DEFAULT" : truncUrl(matched.hbarDark),
      hbarLight: matched.hbarLight === DEFAULTS.hbarLight ? "DEFAULT" : truncUrl(matched.hbarLight),
    });

    // Preload all resolved images (log failures)
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
    } else {
      log.debug("PartneredLogos", "All partner logos preloaded successfully");
    }

    return matched;
  } catch (err) {
    log.warn("PartneredLogos", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ...DEFAULTS };
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
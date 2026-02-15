/**
 * useBrandLogos
 *
 * Fetches the official Wrappdex brand logos from the "WRAPP LOGOS"
 * Supabase Storage bucket via the /brand-logos server endpoint.
 *
 * Returns resolved dark/light URLs immediately (from cache or
 * placeholder SVGs), and silently upgrades to the real assets
 * once the fetch completes. Results are cached for the session.
 *
 * Naming convention for files in the bucket:
 *   - A file whose name contains "dark" (case-insensitive) is the dark-mode logo.
 *   - A file whose name contains "light" or "white" is the light-mode logo.
 *   - If only one image file exists, it is used for both modes.
 */

import { useState, useEffect } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { HBARH_BRANDING_DARK, HBARH_BRANDING_LIGHT } from "../assets/brand";
import { log } from "../utils/logger";

interface BrandLogos {
  dark: string;
  light: string;
  loaded: boolean;
}

// ── Session-level cache ──────────────────────────────────────────────
let _cache: BrandLogos | null = null;
let _fetchPromise: Promise<BrandLogos> | null = null;

const ENDPOINT = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/brand-logos`;

/** Image extensions we care about. */
const IMG_EXT = /\.(png|jpg|jpeg|webp|svg|avif|gif)$/i;

async function fetchBrandLogos(): Promise<BrandLogos> {
  const fallback: BrandLogos = {
    dark: HBARH_BRANDING_DARK,
    light: HBARH_BRANDING_LIGHT,
    loaded: false,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);

    const res = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn("BrandLogos", `Server returned ${res.status}`);
      return fallback;
    }

    const data = await res.json();
    const logos: Array<{ name: string; publicUrl: string }> = data.logos ?? [];

    // Filter to image files only
    const images = logos.filter((f) => IMG_EXT.test(f.name));

    if (images.length === 0) {
      log.warn("BrandLogos", "No image files found in WRAPP LOGOS bucket");
      return fallback;
    }

    log.info(
      "BrandLogos",
      `Found ${images.length} image(s): [${images.map((f) => f.name).join(", ")}]`,
    );

    // Match by filename keywords
    const darkFile = images.find((f) => /dark/i.test(f.name));
    const lightFile = images.find((f) => /light|white/i.test(f.name));

    // If neither keyword matches, check for generic names and use the first image for both
    const darkUrl = darkFile?.publicUrl ?? images[0]?.publicUrl ?? fallback.dark;
    const lightUrl = lightFile?.publicUrl ?? darkFile?.publicUrl ?? images[0]?.publicUrl ?? fallback.light;

    // Preload both images to avoid a flash
    await Promise.all([preloadImage(darkUrl), preloadImage(lightUrl)]);

    const result: BrandLogos = { dark: darkUrl, light: lightUrl, loaded: true };
    log.info("BrandLogos", "Brand logos resolved", {
      dark: darkFile?.name ?? "(fallback)",
      light: lightFile?.name ?? "(fallback)",
    });
    return result;
  } catch (err) {
    log.error("BrandLogos", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // Don't block on error
    img.src = src;
  });
}

/**
 * Returns brand logo URLs — placeholder SVGs synchronously on first
 * call, then upgrades to real bucket assets once fetched + preloaded.
 */
export function useBrandLogos(): BrandLogos {
  const [logos, setLogos] = useState<BrandLogos>(
    _cache ?? { dark: HBARH_BRANDING_DARK, light: HBARH_BRANDING_LIGHT, loaded: false },
  );

  useEffect(() => {
    if (_cache) {
      setLogos(_cache);
      return;
    }

    if (!_fetchPromise) {
      _fetchPromise = fetchBrandLogos().then((result) => {
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

  return logos;
}

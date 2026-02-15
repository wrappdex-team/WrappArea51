/**
 * HolidayLogo
 *
 * Checks the holiday calendar on mount (and every 30 min for midnight
 * transitions), fetches matching logos from the Supabase bucket, and
 * renders the holiday logo inside a frosted blue/pink glass container.
 *
 * When no holiday is active (or no matching file exists) the component
 * renders the standard Wrappdex logo with zero visual difference from
 * the original <img> tag it replaces.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  getActiveHoliday,
  fetchHolidayLogos,
  matchLogoToHoliday,
  type ResolvedHolidayLogo,
} from "../utils/holiday-theme";
import { log } from "../utils/logger";

interface HolidayLogoProps {
  /** Standard dark-mode logo (used when no holiday is active + dark theme) */
  defaultDarkSrc: string;
  /** Standard light-mode logo (used when no holiday is active + light theme) */
  defaultLightSrc: string;
  /** Current theme */
  isDark: boolean;
  /** Accessible alt text */
  alt: string;
  /** CSS classes for the <img> element (sizing, object-fit, etc.) */
  imgClassName?: string;
  /** CSS classes for the outer wrapper div */
  wrapperClassName?: string;
  /** Holiday-specific image classes — compact sizing for the holiday logo */
  holidayImgClassName?: string;
  /** Whether VIP pulse is active */
  vipPulse?: boolean;
}

export function HolidayLogo({
  defaultDarkSrc,
  defaultLightSrc,
  isDark,
  alt,
  imgClassName = "",
  wrapperClassName = "",
  holidayImgClassName,
  vipPulse = false,
}: HolidayLogoProps) {
  const [resolved, setResolved] = useState<ResolvedHolidayLogo | null>(null);
  const [holidayImgReady, setHolidayImgReady] = useState(false);
  const appliedCss = useRef<string | null>(null);

  // ── Resolve active holiday ──────────────────────────────────────────

  const resolve = useCallback(async () => {
    const holiday = getActiveHoliday();

    if (!holiday) {
      log.info("HolidayLogo", "No active holiday — showing default logo");
      // Clean up CSS + reset
      if (appliedCss.current) {
        document.documentElement.classList.remove(appliedCss.current);
        appliedCss.current = null;
      }
      setResolved(null);
      setHolidayImgReady(false);
      return;
    }

    log.info("HolidayLogo", `Active holiday detected: ${holiday.id} — fetching logos`);
    const files = await fetchHolidayLogos();
    const match = matchLogoToHoliday(files, holiday);

    if (!match) {
      log.warn("HolidayLogo", `No matching logo found for ${holiday.id} — falling back to default`);
      setResolved(null);
      setHolidayImgReady(false);
      return;
    }

    // Preload holiday image before showing it (prevents flash)
    log.info("HolidayLogo", `Preloading holiday image: ${match.logoUrl}`);
    const img = new Image();
    img.src = match.logoUrl;
    img.onload = () => {
      log.info("HolidayLogo", `Holiday image loaded successfully for ${holiday.id}`);
      setResolved(match);
      setHolidayImgReady(true);

      // Apply ambient CSS class
      if (match.holiday.cssClass) {
        if (appliedCss.current && appliedCss.current !== match.holiday.cssClass) {
          document.documentElement.classList.remove(appliedCss.current);
        }
        document.documentElement.classList.add(match.holiday.cssClass);
        appliedCss.current = match.holiday.cssClass;
      }
    };
    img.onerror = (e) => {
      log.error("HolidayLogo", `Holiday image FAILED to load: ${match.logoUrl}`, e);
      // Logo file unreachable — fall back silently
      setResolved(null);
      setHolidayImgReady(false);
    };
  }, []);

  useEffect(() => {
    resolve();

    // Re-check every 30 minutes so day-boundary transitions happen
    // automatically without a page reload.
    const interval = setInterval(resolve, 30 * 60 * 1000);

    return () => {
      clearInterval(interval);
      if (appliedCss.current) {
        document.documentElement.classList.remove(appliedCss.current);
        appliedCss.current = null;
      }
    };
  }, [resolve]);

  // ── Render paths ────────────────────────────────────────────────────

  const isHoliday = !!(resolved && holidayImgReady);
  const defaultSrc = isDark ? defaultDarkSrc : defaultLightSrc;
  const defaultGlow = isDark
    ? "drop-shadow(0 0 8px rgba(56,189,248,0.4))"
    : undefined;
  const isCompact = !!(holidayImgClassName && isHoliday);

  return (
    <div
      className={`relative ${wrapperClassName} ${vipPulse ? "animate-vip-pulse" : ""}`}
    >
      <AnimatePresence mode="wait">
        {isHoliday ? (
          /* ── Holiday Mode: glass container + single logo ────────── */
          <motion.div
            key={`holiday-${resolved!.holiday.id}`}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className={`holiday-glass flex items-center justify-center h-full ${isCompact ? "holiday-glass-compact" : ""}`}
          >
            <img
              src={resolved!.logoUrl}
              alt={`${alt} — ${resolved!.holiday.name}`}
              className={holidayImgClassName || imgClassName}
              style={{
                filter: isCompact
                  ? `drop-shadow(0 0 5px ${resolved!.holiday.glowColor}) drop-shadow(0 0 12px ${resolved!.holiday.glowColor})`
                  : `drop-shadow(0 0 10px ${resolved!.holiday.glowColor}) drop-shadow(0 0 24px ${resolved!.holiday.glowColor})`,
              }}
            />

            {/* Holiday name badge */}
            <span className={`holiday-glass-badge ${isCompact ? "holiday-glass-badge-compact" : ""}`}>
              {resolved!.holiday.name}
            </span>
          </motion.div>
        ) : (
          /* ── Default Mode: standard logo, zero extra markup ─────── */
          <motion.img
            key={`default-${isDark ? "dark" : "light"}`}
            src={defaultSrc}
            alt={alt}
            className={imgClassName}
            style={{ filter: defaultGlow }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
/**
 * Holiday Theme System
 *
 * Maps calendar dates to holiday logos stored in the
 * "Holiday Wrapp Logos" Supabase Storage bucket (public).
 *
 * Each holiday has ONE logo — the frosted glass container in
 * HolidayLogo.tsx makes it work on both light and dark themes.
 *
 * Filename convention (case-insensitive keyword match):
 *   The filename must contain at least one keyword from the
 *   holiday's `keywords` array. Extension doesn't matter.
 *
 *   Examples:  valentines.png, christmas-logo.png, halloween_wrapp.png
 *
 * Variable holidays (Easter, Thanksgiving) are computed with
 * standard algorithms so the calendar stays correct across years.
 */

import { projectId, publicAnonKey } from "/utils/supabase/info";
import { log } from "./logger";

// ── Holiday Configuration ────────────────────────────────────────────

export interface HolidayConfig {
  id: string;
  name: string;
  /** Computes the inclusive [start, end] dates for a given year. */
  dateRange: (year: number) => [start: Date, end: Date];
  /** Keywords to match against filenames (case-insensitive, any hit wins). */
  keywords: string[];
  /** CSS drop-shadow glow colour for the glass container. */
  glowColor: string;
  /** CSS class applied to <html> for ambient header effects. */
  cssClass: string;
}

// ── Date helpers ─────────────────────────────────────────────────────

/** Midnight-aligned Date (local time, start of day). */
function d(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/** End of day (23:59:59.999). */
function eod(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

// ── Variable-date algorithms ─────────────────────────────────────────

/** Western Easter — Anonymous Gregorian (computus) algorithm. */
function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const dd = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** US Thanksgiving — fourth Thursday of November. */
function computeThanksgiving(year: number): Date {
  const nov1 = new Date(year, 10, 1);
  const dow = nov1.getDay(); // 0=Sun … 4=Thu
  const firstThu = dow <= 4 ? 1 + (4 - dow) : 1 + (11 - dow);
  return new Date(year, 10, firstThu + 21);
}

// ── Holiday Calendar ─────────────────────────────────────────────────

export const HOLIDAY_CALENDAR: HolidayConfig[] = [
  {
    id: "new-year",
    name: "Happy New Year",
    dateRange: (y) => [d(y, 12, 31), eod(y + 1, 1, 1)],
    keywords: ["newyear", "new-year", "new_year", "nye", "newyears"],
    glowColor: "rgba(255, 215, 0, 0.45)",
    cssClass: "holiday-new-year",
  },
  {
    id: "valentines",
    name: "Happy Valentine's Day",
    dateRange: (y) => [d(y, 2, 14), eod(y, 2, 14)],
    keywords: ["valentine", "valentines", "vday", "val"],
    glowColor: "rgba(255, 50, 100, 0.45)",
    cssClass: "holiday-valentines",
  },
  {
    id: "st-patricks",
    name: "St. Patrick's Day",
    dateRange: (y) => [d(y, 3, 17), eod(y, 3, 17)],
    keywords: ["stpatrick", "st-patrick", "st_patrick", "patricks", "shamrock"],
    glowColor: "rgba(0, 200, 83, 0.45)",
    cssClass: "holiday-st-patricks",
  },
  {
    id: "easter",
    name: "Happy Easter",
    dateRange: (y) => {
      const sun = computeEasterSunday(y);
      return [d(y, sun.getMonth() + 1, sun.getDate()), eod(y, sun.getMonth() + 1, sun.getDate())];
    },
    keywords: ["easter"],
    glowColor: "rgba(186, 135, 255, 0.45)",
    cssClass: "holiday-easter",
  },
  {
    id: "independence-day",
    name: "Happy 4th of July",
    dateRange: (y) => [d(y, 7, 4), eod(y, 7, 4)],
    keywords: ["4thofjuly", "4th-of-july", "independence", "july4", "july-4"],
    glowColor: "rgba(50, 100, 255, 0.45)",
    cssClass: "holiday-july4",
  },
  {
    id: "halloween",
    name: "Happy Halloween",
    dateRange: (y) => [d(y, 10, 31), eod(y, 10, 31)],
    keywords: ["halloween", "spooky"],
    glowColor: "rgba(255, 140, 0, 0.45)",
    cssClass: "holiday-halloween",
  },
  {
    id: "thanksgiving",
    name: "Happy Thanksgiving",
    dateRange: (y) => {
      const thu = computeThanksgiving(y);
      return [d(y, 11, thu.getDate()), eod(y, 11, thu.getDate())];
    },
    keywords: ["thanksgiving", "turkey"],
    glowColor: "rgba(210, 150, 60, 0.45)",
    cssClass: "holiday-thanksgiving",
  },
  {
    id: "christmas",
    name: "Merry Christmas",
    dateRange: (y) => [d(y, 12, 24), eod(y, 12, 25)],
    keywords: ["christmas", "xmas", "santa"],
    glowColor: "rgba(220, 38, 38, 0.45)",
    cssClass: "holiday-christmas",
  },
  {
    id: "hedera-birthday",
    name: "Hedera Anniversary",
    dateRange: (y) => [d(y, 9, 16), eod(y, 9, 16)],
    keywords: ["hedera", "anniversary", "hederabirthday"],
    glowColor: "rgba(0, 229, 255, 0.45)",
    cssClass: "holiday-hedera",
  },
];

// ── Active Holiday Detection ─────────────────────────────────────────

/**
 * Returns the currently-active holiday, or null.
 *
 * For year-wrapping holidays (New Year spans Dec 31 → Jan 1)
 * we check the date range for both the current year and the
 * previous year so the Dec-31 start is captured when the
 * current date is Jan 1.
 */
export function getActiveHoliday(now: Date = new Date()): HolidayConfig | null {
  const year = now.getFullYear();

  log.info("HolidayTheme", `Checking active holiday for ${now.toISOString()} (year=${year})`);

  for (const h of HOLIDAY_CALENDAR) {
    // Check current year
    const [s, e] = h.dateRange(year);
    if (now >= s && now <= e) {
      log.info("HolidayTheme", `Active holiday: ${h.id} (${h.name})`, {
        start: s.toISOString(),
        end: e.toISOString(),
      });
      return h;
    }

    // Check previous year (handles New Year wrap: Dec 31 of last year)
    const [sp, ep] = h.dateRange(year - 1);
    if (now >= sp && now <= ep) {
      log.info("HolidayTheme", `Active holiday (prev-year wrap): ${h.id}`, {
        start: sp.toISOString(),
        end: ep.toISOString(),
      });
      return h;
    }
  }

  log.info("HolidayTheme", "No active holiday found for current date");
  return null;
}

// ── Logo File Matching ───────────────────────────────────────────────

export interface HolidayLogoFile {
  name: string;
  url: string;
}

export interface ResolvedHolidayLogo {
  holiday: HolidayConfig;
  logoUrl: string;
}

/**
 * Finds the first file whose name contains any of the holiday's keywords.
 * Returns the resolved logo, or null if no match exists.
 */
export function matchLogoToHoliday(
  files: HolidayLogoFile[],
  holiday: HolidayConfig,
): ResolvedHolidayLogo | null {
  log.info("HolidayTheme", `Matching ${files.length} file(s) against holiday "${holiday.id}" keywords: [${holiday.keywords.join(", ")}]`);

  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (holiday.keywords.some((kw) => lower.includes(kw))) {
      log.info("HolidayTheme", `Matched file "${f.name}" → ${f.url}`);
      return { holiday, logoUrl: f.url };
    }
  }

  log.warn("HolidayTheme", `No file matched holiday "${holiday.id}". Files in bucket: [${files.map(f => f.name).join(", ")}]`);
  return null;
}

// ── API Fetch (with client-side cache) ───────────────────────────────

let _cachedLogos: HolidayLogoFile[] | null = null;
let _cacheTs = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function fetchHolidayLogos(): Promise<HolidayLogoFile[]> {
  const now = Date.now();
  if (_cachedLogos && now - _cacheTs < CACHE_TTL) {
    log.debug("HolidayTheme", `Returning cached logos (${_cachedLogos.length} files, ${Math.round((now - _cacheTs) / 1000)}s old)`);
    return _cachedLogos;
  }

  const url = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/holiday-logos`;
  log.info("HolidayTheme", `Fetching holiday logos from: ${url}`);

  // Use AbortController with setTimeout for broad compatibility
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "(unreadable)");
      log.error("HolidayTheme", `Server returned HTTP ${res.status}: ${errBody}`);
      return _cachedLogos ?? [];
    }

    const data = await res.json();
    log.info("HolidayTheme", `Raw server response:`, data);

    if (data.bucket) {
      log.info("HolidayTheme", `Server bucket: "${data.bucket}", urlType: ${data.urlType ?? "n/a"}`);
    }
    if (data.hint) {
      log.warn("HolidayTheme", `Server hint: ${data.hint}`);
    }

    _cachedLogos = data.logos ?? [];
    _cacheTs = now;
    log.info("HolidayTheme", `Fetched ${_cachedLogos.length} logo file(s)`, _cachedLogos.map((f: HolidayLogoFile) => f.name));
    return _cachedLogos;
  } catch (err) {
    clearTimeout(timeoutId);
    log.error("HolidayTheme", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`, err);
    return _cachedLogos ?? [];
  }
}
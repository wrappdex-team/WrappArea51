/**
 * Centralized brand assets — URL constants for all logos and branding images.
 *
 * These replace the `figma:asset/...` imports that only work inside Figma Make.
 * Using string constants (URLs / data URIs) instead of Vite asset imports
 * ensures the build works on Railway, Vercel, Netlify, or any standard Vite host.
 */

// ── Wrappdex main logos (light & dark mode) ──────────────────────────
// Light mode logo (dark text, for light backgrounds)
import wrappdexLogoLight from "figma:asset/223816e04d625491d254d68760fc0c00ebfa9486.png";
// Dark mode logo (light text, for dark backgrounds)
import wrappdexLogoDark from "figma:asset/fe19cbf1f950c1e1b1b71e9484e67c0892845f47.png";

// Official HashPack wallet logo (provided asset)
import hashpackLogoAsset from "figma:asset/4a7cffb754ec2cfe15d1ebcf6d922e8a988f553a.png";

// Official MetaMask wallet logo (provided asset)
import metamaskLogoAsset from "figma:asset/20db0813b2385f49575fa259577f4b3ff220aeda.png";

// ── HBAR logo (coin icon) ─────────────────────────────────────────────
// The standard Hedera HBAR coin image from CoinGecko CDN.
export const HBAR_LOGO =
  "https://assets.coingecko.com/coins/images/3688/large/hbar.png";

// Alias used in some components — identical to HBAR_LOGO for now.
// If HBAR.ħ gets its own distinct token icon on CoinGecko, update here.
export const HBARH_LOGO_DARK = HBAR_LOGO;
export const HBARH_LOGO_LIGHT = HBAR_LOGO;

// ── HBAR.ħ branding wordmark (header / splash) ───────────────────────
// Now using the provided Wrappdex logo images instead of generated SVGs.
export const HBARH_BRANDING_DARK = wrappdexLogoDark;
export const HBARH_BRANDING_LIGHT = wrappdexLogoLight;

// ── Wallet logos ──────────────────────────────────────────────────────

// HashPack — Hedera's primary wallet (official logo asset)
export const HASHPACK_LOGO = hashpackLogoAsset;

// MetaMask — EVM wallet (official fox logo asset)
export const METAMASK_LOGO = metamaskLogoAsset;

// Blade Wallet — Hedera native wallet
export const BLADE_LOGO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#0A0E17"/><path d="M20 6l10 8-4 14H14L10 14z" fill="#00E5FF" opacity="0.9"/><path d="M20 6l6 8-6 16-6-16z" fill="#00B8D4"/><path d="M14 14h12l-2 7H16z" fill="#0A0E17" opacity="0.3"/></svg>`
)}`;

// Kabila — Hedera social wallet
export const KABILA_LOGO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#1a1a2e"/><circle cx="20" cy="20" r="10" fill="none" stroke="#FF6B35" stroke-width="2.5"/><path d="M16 15v10l4-3 4 3V15z" fill="#FF6B35"/></svg>`
)}`;

// Dynamic — multi-chain wallet infrastructure
// Using a simple branded SVG fallback since Dynamic doesn't have a stable public CDN logo.
export const DYNAMIC_LOGO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#4F46E5"/><path d="M12 28V12h5.5c5.8 0 9.5 3.2 9.5 8s-3.7 8-9.5 8H12zm4.2-3.4h1.3c3.4 0 5.3-1.8 5.3-4.6s-1.9-4.6-5.3-4.6h-1.3v9.2z" fill="#fff"/></svg>`
)}`;

// ── Bridge logos ──────────────────────────────────────────────────────

// Squid Router
export const SQUID_LOGO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#1B1464"/><circle cx="20" cy="18" r="8" fill="#00D4FF"/><ellipse cx="17" cy="16" rx="2" ry="2.5" fill="#1B1464"/><ellipse cx="23" cy="16" rx="2" ry="2.5" fill="#1B1464"/><path d="M14 26c0-1 2.7-2 6-2s6 1 6 2v2c0 1-2.7 2-6 2s-6-1-6-2v-2z" fill="#00D4FF" opacity="0.7"/><line x1="15" y1="10" x2="13" y2="6" stroke="#00D4FF" stroke-width="2" stroke-linecap="round"/><line x1="25" y1="10" x2="27" y2="6" stroke="#00D4FF" stroke-width="2" stroke-linecap="round"/><line x1="20" y1="9" x2="20" y2="5" stroke="#00D4FF" stroke-width="2" stroke-linecap="round"/></svg>`
)}`;

// HashPort
export const HASHPORT_LOGO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#1a1a2e"/><path d="M12 14h4v4h8v-4h4v12h-4v-4h-8v4h-4V14z" fill="#00b4d8"/><circle cx="20" cy="20" r="2" fill="#1a1a2e"/></svg>`
)}`;
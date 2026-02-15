/**
 * Centralized brand assets — URL constants for all logos and branding images.
 *
 * Using string constants (URLs / data URIs) instead of Vite asset imports
 * ensures the build works on Railway, Vercel, Netlify, or any standard Vite host.
 *
 * The `figma:asset/...` scheme only works inside Figma Make's dev server.
 * For production builds these must be plain strings.
 */

// ── Production logo imports (Figma asset scheme) ─────────────────────
// These are the official partner logos provided for rollout.
// HBAR.ħ Protocol — legally distinct from Hedera's HBAR. Two variants:
//   Dark  = black coin, white ħ glyph  → use on dark backgrounds
//   Light = white coin, black ħ glyph  → use on light backgrounds
import hbarhLogoDark from "figma:asset/aad67c07eab3fe55124f5880ab1f99b4ba343a04.png";
import hbarhLogoLight from "figma:asset/e519d0b3e9b99e29ac52b83f9288a29bac80e611.png";
// MetaMask — official fox logo on teal circle
import metamaskLogoOfficial from "figma:asset/7a180712979aa0489b40bc8e6089a93b24e066f7.png";

// ── Wrappdex main logos (light & dark mode) ──────────────────────────
// Data-URI SVG wordmarks — zero network requests, instant render.
// Swap for CDN-hosted brand kit assets (PNG / SVG) when available.
// Dark mode wordmark — light text on transparent, for dark backgrounds
const wrappdexLogoDark = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 60"><rect width="280" height="60" rx="8" fill="none"/><text x="140" y="40" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="32" font-weight="800" letter-spacing="-0.5" fill="#e2e8f0">WRAPP<tspan fill="#ec4899">DEX</tspan></text></svg>`
)}`;

// Light mode wordmark — dark text on transparent, for light backgrounds
const wrappdexLogoLight = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 60"><rect width="280" height="60" rx="8" fill="none"/><text x="140" y="40" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="32" font-weight="800" letter-spacing="-0.5" fill="#0f172a">WRAPP<tspan fill="#db2777">DEX</tspan></text></svg>`
)}`;

// HashPack — official logo from their public GitHub assets
const hashpackLogoAsset = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#0c0c14"/><g fill="#c4b5fd"><rect x="11" y="12" width="3" height="16" rx="1.5"/><rect x="26" y="12" width="3" height="16" rx="1.5"/><rect x="14" y="17" width="12" height="3" rx="1"/><rect x="14" y="22" width="12" height="3" rx="1"/></g></svg>`
)}`;

// MetaMask — production fox logo (imported above), SVG kept only as emergency fallback
const metamaskLogoAsset = metamaskLogoOfficial;

// ── HBAR logo (coin icon) ─────────────────────────────────────────────
// The standard Hedera HBAR coin image from CoinGecko CDN.
// This is HEDERA'S logo — NOT HBAR.ħ Protocol's logo. These are legally
// distinct brands and must never be mixed.
export const HBAR_LOGO =
  "https://assets.coingecko.com/coins/images/3688/large/hbar.png";

// ── HBAR.ħ Protocol token logo ────────────────────────────────────────
// Distinct from Hedera's HBAR logo. The HBAR.ħ Protocol is a separate
// entity with its own branding — official dark/light coin assets imported
// at module top. These render immediately without waiting for the bucket.
export const HBARH_LOGO_DARK = hbarhLogoDark;
export const HBARH_LOGO_LIGHT = hbarhLogoLight;

// ── HBAR.ħ branding wordmark (header / splash) ───────────────────────
// Maps to the Wrappdex wordmarks. Update these exports to point at
// dedicated HBAR.ħ branding assets if the brand kit diverges.
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
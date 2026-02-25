/**
 * Centralized brand assets — URL constants for all logos and branding images.
 *
 * Partner logos (1inch, SaucerSwap Larry) are hosted in Supabase Storage
 * bucket "SWAP LOGOS" — plain URL strings, no imports, works everywhere.
 * Other logos use inline SVG data URIs for zero-network-request rendering.
 */

// ── Supabase Storage base URL for the SWAP LOGOS bucket ──────────────
const LOGO_BUCKET = "https://ehmlclowiedoqncymegi.supabase.co/storage/v1/object/public/SWAP%20LOGOS";

// ── Supabase Storage: "Partnered logos" PUBLIC bucket ────────────────
// Direct public URLs for all partner/wallet logos. These are the canonical
// source of truth — no server roundtrip or filename matching required.
// Bucket URL: https://supabase.com/dashboard/project/ehmlclowiedoqncymegi/storage/files/buckets/Partnered%20logos
const PARTNER_BUCKET = "https://ehmlclowiedoqncymegi.supabase.co/storage/v1/object/public/Partnered%20logos";

export const BUCKET_LOGOS = {
  // ── Partners ──
  altlantis:    `${PARTNER_BUCKET}/altlantis_logo.png`,
  bonzo:        `${PARTNER_BUCKET}/bonzo_logo.png`,
  hsuite:       `${PARTNER_BUCKET}/hsuite_logo.png`,
  hashport:     `${PARTNER_BUCKET}/hashport_logo.png`,
  ivyfi:        `${PARTNER_BUCKET}/ivyfi_logo.png`,
  impartglobal: `${PARTNER_BUCKET}/impartglobal_logo.png`,
  saucerswap:   `${PARTNER_BUCKET}/saucerswap_logo.png`,
  squid:        `${PARTNER_BUCKET}/squid_logo.png`,
  stargate:     `${PARTNER_BUCKET}/stargate_logo.png`,
  // ── Wallets ──
  dynamic:      `${PARTNER_BUCKET}/dynamiclogin_logo.png`,
  hashpack:     `${PARTNER_BUCKET}/hashpack_logo.png`,
  metamask:     `${PARTNER_BUCKET}/metamask_logo.png`,
  // ── HBAR.ħ Protocol (dark renamed → hbar.h, light still habr.h legacy) ──
  hbarDark:     `${PARTNER_BUCKET}/hbar.h.dark_logo.png`,
  hbarLight:    `${PARTNER_BUCKET}/habr.h.light_logo.png`,
} as const;

// ── Production logo imports (data URIs for universal compatibility) ──
// These are the official partner logos provided for rollout.
// HBAR.ħ Protocol — legally distinct from Hedera's HBAR. Two variants:
//   Dark  = black coin, white ħ glyph  → use on dark backgrounds
//   Light = white coin, black ħ glyph  → use on light backgrounds
const hbarhLogoDark = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#000000" stroke="#333333" stroke-width="2"/><text x="50" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="60" font-weight="700" fill="#ffffff">ħ</text></svg>`
)}`;
const hbarhLogoLight = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#ffffff" stroke="#cccccc" stroke-width="2"/><text x="50" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="60" font-weight="700" fill="#000000">ħ</text></svg>`
)}`;
// MetaMask — official fox logo on teal circle
const metamaskLogoOfficial = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#037DD6"/><path d="M32 9.5l-9.8 7.3 1.8-4.3L32 9.5z" fill="#E2761B" stroke="#E2761B" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 9.5l9.7 7.4-1.7-4.4L8 9.5zm19.4 17.7l-2.5 3.8 5.3 1.5 1.5-5.2-4.3-.1zm-22.8.1l1.5 5.2 5.3-1.5-2.5-3.8h-4.3z" fill="#E4761B" stroke="#E4761B" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.3 19.2l-1.5 2.3 5.2.2-.2-5.6-3.5 3.1zm13.4 0l-3.6-3.2-.1 5.7 5.2-.2-1.5-2.3zm-12.8 11.6l3.2-1.6-2.8-2.2-.4 3.8zm9.8-1.6l3.2 1.6-.4-3.8-2.8 2.2z" fill="#E4761B" stroke="#E4761B" stroke-linecap="round" stroke-linejoin="round"/><path d="M26.9 30.8l-3.2-1.6.3 2.1v1l2.9-1.5zm-13.8 0l2.9 1.5v-1l.3-2.1-3.2 1.6z" fill="#D7C1B3" stroke="#D7C1B3" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.1 25.6l-2.7-.8 1.9-1 .8 1.8zm7.8 0l.8-1.8 1.9 1-2.7.8z" fill="#233447" stroke="#233447" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.1 30.8l.4-3.8-2.9.1 2.5 3.7zm13.4-3.8l.4 3.8 2.5-3.7-2.9-.1zm2.4-5.7l-5.2.2.5 2.7.8-1.8 1.9 1 2-.3zm-15.5.3l1.9-1 .8 1.8.5-2.7-5.2-.2 2 .3z" fill="#CD6116" stroke="#CD6116" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.8 21.5l2.1 4.2-.1-2-2-2.2zm15.5.3l-2 2.2-.1 2 2.1-4.2zm-7.8.4l-.5 2.7.6 3.2.1-3.8-.2-2.1zm3.5 0l-.1 2.1.1 3.8.6-3.2-.6-2.7z" fill="#E4751F" stroke="#E4751F" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.9 25.6l-.6 3.2.4.3 2.8-2.2.1-2-2.7.7zm-10.5.7l.1 2 2.8 2.2.4-.3-.6-3.2-2.7-.7z" fill="#F6851B" stroke="#F6851B" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 32.3v-1l-.3-.2h-3.4l-.3.2v1l-3.2-1.5 1.1.9 2.3 1.6h3.5l2.3-1.6 1.1-.9L24 32.3z" fill="#C0AD9E" stroke="#C0AD9E" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.7 29.2l-.4-.3h-2.6l-.4.3-.3 2.1.3-.2h3.4l.3.2-.3-2.1z" fill="#161616" stroke="#161616" stroke-linecap="round" stroke-linejoin="round"/><path d="M32.5 16.5l.8-3.8-1.3-3.7-9.3 6.8 3.6 3.1 5.1 1.5 1.1-1.3-.5-.4.8-.7-.6-.5.8-.6-.5-.4zm-25-.3l.8 3.8-.5.4.8.6-.6.5.8.7-.5.4 1.1 1.3 5.1-1.5 3.6-3.1L8.7 9l-1.2 3.7z" fill="#763D16" stroke="#763D16" stroke-linecap="round" stroke-linejoin="round"/><path d="M31.5 20.6l-5.1-1.5 1.5 2.3-2.1 4.2 2.8-.1h4.3l-1.4-4.9zm-16.4-1.5l-5.1 1.5-1.4 4.9h4.3l2.8.1-2.1-4.2 1.5-2.3zm8.4-1.4l.3-5.9 1.5-4.3h-6.6l1.5 4.3.3 5.9.1 2.1v3.8h2.6V22l.3-2.3z" fill="#F6851B" stroke="#F6851B" stroke-linecap="round" stroke-linejoin="round"/></svg>`
)}`;

// ── Wrappdex main logos (light & dark mode) ──────────────────────────
// Data-URI SVG wordmarks — zero network requests, instant render.
// Swap for CDN-hosted brand kit assets (PNG / SVG) when available.
// Dark mode wordmark — white WRAP, blue p (#1D63ED), silver DEX (#94A3B8)
const wrappdexLogoDark = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 60"><rect width="320" height="60" rx="8" fill="none"/><text x="160" y="42" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="800" letter-spacing="-0.5" fill="#ffffff">WRAP<tspan fill="#1D63ED">p</tspan><tspan fill="#94A3B8">DEX</tspan></text></svg>`
)}`;

// Light mode wordmark — dark WRAP, blue p (#1D63ED), gray DEX (#64748B)
const wrappdexLogoLight = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 60"><rect width="320" height="60" rx="8" fill="none"/><text x="160" y="42" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="800" letter-spacing="-0.5" fill="#0f172a">WRAP<tspan fill="#1D63ED">p</tspan><tspan fill="#64748B">DEX</tspan></text></svg>`
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

// SaucerSwap — "Larry" the alien mascot logo
// Hosted in Supabase Storage bucket "SWAP LOGOS".
// Used as the venue badge below the swap button and in pool route headers.
export const SAUCERSWAP_LARRY_LOGO = `${LOGO_BUCKET}/Saucerswap_larry.svg`;

// ── 1inch Official Logo ──────────────────────────────────────────────
// Hosted in Supabase Storage bucket "SWAP LOGOS".
// Used in venue badges and the 1inch cross-chain widget header.
export const ONEINCH_LOGO = `${LOGO_BUCKET}/1inch_logo.png`;

// ── SaucerSwap Official Logo (Full) ──────────────────────────────────
// Same Larry mascot — used for larger venue badges and route visualization.
export const SAUCERSWAP_LOGO = `${LOGO_BUCKET}/Saucerswap_larry.svg`;

// ── Hedera Logo ──────────────────────────────────────────────────────
// Official Hedera Hashgraph "H" bar logo.
export const HEDERA_LOGO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#000"/><g fill="#fff"><rect x="12" y="10" width="3" height="20" rx="1.5"/><rect x="25" y="10" width="3" height="20" rx="1.5"/><rect x="15" y="17" width="10" height="3" rx="1"/><rect x="15" y="22" width="10" height="3" rx="1"/></g></svg>`
)}`;
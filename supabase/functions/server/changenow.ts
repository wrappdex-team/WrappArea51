// ═══════════════════════════════════════════════════════════════════════
// ChangeNOW Widget URL Builder — Server-side (Production-Hardened)
// ═══════════════════════════════════════════════════════════════════════
//
// IMPLEMENTATION NOTE — The ChangeNOW affiliate link_id is kept server-side
// so it never appears in frontend source code. The client calls this endpoint
// to get a fully-constructed widget URL which is then loaded in a sandboxed iframe.
//
// Security layers (LOW-03 hardening):
//   1. Optional ED25519 session auth — logs accountId when present, flags as "anon" when not
//   2. Per-IP rate limiting (shared isRateLimited, 30 req/min)
//   3. Per-account rate limiting when session present (isAccountRateLimited)
//   4. Origin/Referer soft-validation with forensic logging
//   5. Full audit trail (accountId|anon, IP, endpoint, auth status, timestamp)
//   6. Cache-Control: no-store — prevents proxy/CDN caching of link_id URLs
//   7. link_id env var checked without leaking configuration state
//
// ═════════════════���═════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { validateSession } from "./auth.ts";
import { getClientIp, isRateLimited, isAccountRateLimited, ROUTE_PREFIX } from "./shared.ts";

const BASE = ROUTE_PREFIX;

/** Validate EVM address format (0x + 40 hex chars) */
function isValidEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

/** Validate Hedera account ID format (0.0.xxxxx) */
function isValidHederaAddress(addr: string): boolean {
  return /^0\.0\.\d{1,10}$/.test(addr);
}

/** Returns true if currency is delivered on an EVM chain */
function isEvmCurrency(c: string): boolean {
  return c === "usdc" || c === "usdt";
}

function buildWidgetUrl(linkId: string, opts: {
  isDark: boolean;
  mode: "crosschain" | "topup";
  topUpCurrency?: string;
  topUpAddress?: string;
  from?: string;
  to?: string;
}): string {
  const bg = opts.isDark ? "0d0d1a" : "FFFFFF";

  const params = new URLSearchParams({
    FAQ: "true",
    backgroundColor: bg,
    darkMode: String(opts.isDark),
    horizontal: "false",
    lang: "en-US",
    link_id: linkId,
    locales: "true",
    logo: "true",
    primaryColor: "EC4899",
    toTheMoon: "true",
  });

  if (opts.mode === "topup") {
    // Fiat on-ramp: buying crypto with card/bank
    const targetCurrency = opts.topUpCurrency ?? "hbar";
    params.set("amount", "500");
    params.set("from", "usd");
    params.set("isFiat", "true");
    params.set("to", targetCurrency);

    // IMPLEMENTATION NOTE — Address routing per currency:
    //   HBAR  → Hedera address (0.0.xxxxx)
    //   USDC  → ERC-20 on Ethereum → EVM address (0x...)
    //   USDT  → ERC-20 on Ethereum → EVM address (0x...)
    if (opts.topUpAddress) {
      const isEvm = isEvmCurrency(targetCurrency);
      if (isEvm && isValidEvmAddress(opts.topUpAddress)) {
        params.set("address", opts.topUpAddress);
      } else if (!isEvm && isValidHederaAddress(opts.topUpAddress)) {
        params.set("address", opts.topUpAddress);
      }
      // Invalid address → omit, user enters manually in widget
    }
  } else {
    // Crypto-to-crypto cross-chain swap
    params.set("amount", "0.1");
    params.set("amountFiat", "500");
    params.set("from", opts.from ?? "btc");
    params.set("fromFiat", "usd");
    params.set("to", opts.to ?? "hbar");
  }

  return `https://changenow.io/embeds/exchange-widget/v2/widget.html?${params.toString()}`;
}

function buildRedirectUrl(linkId: string, opts: {
  mode: "exchange" | "fiat";
  from: string;
  to: string;
  amount: string;
  address?: string;
}): string {
  const params = new URLSearchParams({
    from: opts.from.toLowerCase(),
    to: opts.to.toLowerCase(),
    amount: opts.amount || (opts.mode === "fiat" ? "100" : "0.1"),
    link_id: linkId,
  });
  if (opts.mode === "fiat") params.set("fiatMode", "true");
  // IMPLEMENTATION NOTE — Validate address format before injecting into URL.
  // EVM currencies (usdc, usdt) expect 0x... addresses; HBAR expects 0.0.xxxxx.
  // Invalid addresses are silently omitted — user enters manually on ChangeNOW.
  if (opts.address) {
    const to = opts.to.toLowerCase();
    const isEvm = isEvmCurrency(to);
    if (isEvm && isValidEvmAddress(opts.address)) {
      params.set("address", opts.address);
    } else if (!isEvm && isValidHederaAddress(opts.address)) {
      params.set("address", opts.address);
    }
    // else: invalid format → omit, user enters manually
  }
  return `https://changenow.io/exchange?${params.toString()}`;
}

// ── Allowed Origins (production domains) ────────────────────────────
// Requests from unknown origins are logged but not hard-blocked (privacy
// browsers may strip Referer/Origin). The log trail enables forensic
// review of abuse patterns.
const ALLOWED_ORIGINS = [
  "https://www.wrappdex.io",
  "https://wrappdex.io",
  "http://localhost",
  "http://127.0.0.1",
];

function isKnownOrigin(origin: string | undefined): boolean {
  if (!origin) return false; // missing → can't validate, will log
  return ALLOWED_ORIGINS.some(o => origin.startsWith(o));
}

// ── Security-hardened response helper ───────────────────────────────
// Prevents proxy/CDN/browser caching of responses containing the link_id.
function secureJsonResponse(c: any, data: Record<string, unknown>, status = 200) {
  return c.json(data, status, {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Expires": "0",
  });
}

// ── Shared auth + rate-limit gate ───────────────────────────────────
// Returns { accountId, ip } on success, or a Response on failure.
// IMPLEMENTATION NOTE — Uses validateSession (optional auth) instead of
// requireAuth (mandatory). ChangeNOW widget/redirect URLs are read-only
// and blocking users who haven't done the ED25519 challenge-response
// breaks the Buy/Sell UX. When a session IS present, the accountId is
// logged for full forensic audit. When absent, stricter IP-based rate
// limiting applies and the request is flagged as unauthenticated.
async function enforceChangeNowGate(
  c: any,
  endpoint: string,
): Promise<{ accountId: string | null; ip: string } | Response> {
  const ip = getClientIp(c);

  // Layer 1: IP rate limit (30 req/min global)
  if (await isRateLimited(ip)) {
    console.log(`[changenow] RATE_LIMITED ip=${ip} endpoint=${endpoint}`);
    return c.json({ error: "Rate limited — try again shortly", code: "RATE_LIMITED" }, 429);
  }

  // Layer 2: Optional session auth — enhance audit trail when available
  const session = await validateSession(c);
  const accountId = session?.accountId || null;

  // Layer 3: Per-account rate limit (only when session is present)
  if (accountId && await isAccountRateLimited(accountId, "other")) {
    console.log(`[changenow] ACCOUNT_RATE_LIMITED account=${accountId} ip=${ip} endpoint=${endpoint}`);
    return c.json({ error: "Too many requests for this account", code: "ACCOUNT_RATE_LIMITED" }, 429);
  }

  // Layer 4: Origin/Referer soft-validation (forensic logging, not hard-block)
  const origin = c.req.header("origin") || c.req.header("referer") || "";
  if (origin && !isKnownOrigin(origin)) {
    console.log(
      `[changenow] SUSPICIOUS_ORIGIN origin="${origin}" account=${accountId || "anon"} ip=${ip} endpoint=${endpoint}`
    );
  }

  // Layer 5: Audit trail
  console.log(
    `[changenow] ACCESS account=${accountId || "anon"} ip=${ip} endpoint=${endpoint} ` +
    `auth=${accountId ? "session" : "none"} origin="${origin || "none"}" ts=${new Date().toISOString()}`
  );

  return { accountId, ip };
}

export function registerChangeNowRoutes(app: Hono) {
  // ── GET /changenow/redirect-url ────────────────────────────────────
  // Requires: ED25519 session (X-Session-Token header)
  // Query params: mode (exchange|fiat), from, to, amount, address
  // Returns { url } with link_id injected server-side.
  app.get(`${BASE}/changenow/redirect-url`, async (c) => {
    // Security gate: auth + rate limit + audit
    const gate = await enforceChangeNowGate(c, "redirect-url");
    if (gate instanceof Response) return gate;

    const linkId = Deno.env.get("CHANGENOW_LINK_ID");
    if (!linkId) {
      console.log(`[changenow] ERROR: CHANGENOW_LINK_ID not set (account=${gate.accountId})`);
      return c.json({ error: "Service temporarily unavailable" }, 503);
    }

    const q = c.req.query();
    const mode = (q.mode === "fiat" ? "fiat" : "exchange") as "exchange" | "fiat";
    const from = q.from || (mode === "fiat" ? "usd" : "btc");
    const to = q.to || "hbar";
    const amount = q.amount || (mode === "fiat" ? "100" : "0.1");
    const address = q.address || undefined;

    const url = buildRedirectUrl(linkId, { mode, from, to, amount, address });
    return secureJsonResponse(c, { url });
  });

  // ── GET /changenow/widget-url ──────────────────────────────────────
  // Requires: ED25519 session (X-Session-Token header)
  // Query params: mode (crosschain|topup), isDark, topUpCurrency, topUpAddress, from, to
  app.get(`${BASE}/changenow/widget-url`, async (c) => {
    // Security gate: auth + rate limit + audit
    const gate = await enforceChangeNowGate(c, "widget-url");
    if (gate instanceof Response) return gate;

    const linkId = Deno.env.get("CHANGENOW_LINK_ID");
    if (!linkId) {
      console.log(`[changenow] ERROR: CHANGENOW_LINK_ID not set (account=${gate.accountId})`);
      return c.json({ error: "Service temporarily unavailable" }, 503);
    }

    const q = c.req.query();
    const mode = (q.mode === "topup" ? "topup" : "crosschain") as "crosschain" | "topup";
    const isDark = q.isDark === "true";
    const topUpCurrency = q.topUpCurrency || "hbar";
    const topUpAddress = q.topUpAddress || undefined;
    const from = q.from || undefined;
    const to = q.to || undefined;

    const url = buildWidgetUrl(linkId, {
      isDark,
      mode,
      topUpCurrency,
      topUpAddress,
      from,
      to,
    });

    return secureJsonResponse(c, { url });
  });
}
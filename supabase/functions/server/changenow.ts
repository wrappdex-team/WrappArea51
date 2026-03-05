// ═══════════════════════════════════════════════════════════════════════
// ChangeNOW Widget URL Builder — Server-side
// ═══════════════════════════════════════════════════════════════════════
// IMPLEMENTATION NOTE — The ChangeNOW affiliate link_id is kept server-side
// so it never appears in frontend source code. The client calls this endpoint
// to get a fully-constructed widget URL which is then loaded in a sandboxed iframe.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";

const BASE = "/make-server-54299934";

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

export function registerChangeNowRoutes(app: Hono) {
  // ── GET /changenow/redirect-url ────────────────────────────────────
  // Query params: mode (exchange|fiat), from, to, amount, address
  // Returns { url } with link_id injected server-side.
  app.get(`${BASE}/changenow/redirect-url`, async (c) => {
    const linkId = Deno.env.get("CHANGENOW_LINK_ID");
    if (!linkId) {
      console.log("[changenow] ERROR: CHANGENOW_LINK_ID env var not set");
      return c.json({ error: "ChangeNOW integration not configured" }, 500);
    }

    const q = c.req.query();
    const mode = (q.mode === "fiat" ? "fiat" : "exchange") as "exchange" | "fiat";
    const from = q.from || (mode === "fiat" ? "usd" : "btc");
    const to = q.to || "hbar";
    const amount = q.amount || (mode === "fiat" ? "100" : "0.1");
    const address = q.address || undefined;

    const url = buildRedirectUrl(linkId, { mode, from, to, amount, address });
    return c.json({ url });
  });

  // ── GET /changenow/widget-url ──────────────────────────────────────
  // Query params: mode (crosschain|topup), isDark, topUpCurrency, topUpAddress, from, to
  app.get(`${BASE}/changenow/widget-url`, async (c) => {
    const linkId = Deno.env.get("CHANGENOW_LINK_ID");
    if (!linkId) {
      console.log("[changenow] ERROR: CHANGENOW_LINK_ID env var not set");
      return c.json({ error: "ChangeNOW integration not configured" }, 500);
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

    return c.json({ url });
  });
}
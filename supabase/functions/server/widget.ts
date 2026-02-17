// ═══════════════════════════════════════════════════════════════════════
// WIDGET — Serves QuantifyCrypto ticker & heatmap HTML with permissive
// CSP headers so coin logos load regardless of upstream CDN changes.
//
// Background: srcdoc iframes inherit the parent page's CSP, which
// blocks coin logo images from CDNs not in the parent's img-src.
// Serving the widget HTML from a real endpoint gives it its own CSP
// via response headers, decoupled from the parent page's policy.
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { ROUTE_PREFIX } from "./shared.ts";

// ── Shared iframe styles ─────────────────────────────────────────────

function baseStyles(bg: string): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      background: ${bg};
      overflow: hidden;
      min-height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    body::-webkit-scrollbar { display: none; }
    body { -ms-overflow-style: none; scrollbar-width: none; }
    *:not(html):not(body) {
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.10) transparent;
    }
    *:not(html):not(body)::-webkit-scrollbar { width: 4px; height: 4px; }
    *:not(html):not(body)::-webkit-scrollbar-track { background: transparent; }
    *:not(html):not(body)::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius: 2px; }
    *:not(html):not(body)::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.20); }
    *:not(html):not(body)::-webkit-scrollbar-corner { background: transparent; }
  `;
}

// ── Permissive CSP for widget iframes ────────────────────────────────
// Only images and styles need to be wide-open; scripts limited to QC.

const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://quantifycrypto.com",
  "style-src 'unsafe-inline'",
  "img-src * data: blob:",
  "connect-src https://quantifycrypto.com https://*.quantifycrypto.com",
  "font-src 'none'",
].join("; ");

// ── Route Registration ──────────────────────────────────────────────

export function registerWidgetRoutes(app: Hono): void {

  // ── Price Ticker Widget ────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/widget/ticker`, (c) => {
    const theme = c.req.query("theme") === "light" ? "light" : "dark";
    const bg = theme === "dark" ? "#080a12" : "#f8fafc";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>${baseStyles(bg)}
    qc-price-ticker-widget { display: block; width: 100%; }
  </style>
</head>
<body>
  <qc-price-ticker-widget
    mode="custom"
    top-coins="true"
    gainers-and-losers="true"
    bg="${bg}"
    theme="${theme}"
    currency="USD">
  </qc-price-ticker-widget>
  <script src="https://quantifycrypto.com/widgets/marquee/js/qc-price-ticker-widget.js"><\/script>
</body>
</html>`;

    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Content-Security-Policy", WIDGET_CSP);
    c.header("Cache-Control", "public, max-age=300, s-maxage=600");
    return c.body(html);
  });

  // ── Heatmap Widget ─────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/widget/heatmap`, (c) => {
    const theme = c.req.query("theme") === "light" ? "light" : "dark";
    const bg = theme === "dark" ? "#080a12" : "#f8fafc";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>${baseStyles(bg)}
    qc-heatmap { display: block; width: 100%; }
  </style>
</head>
<body>
  <qc-heatmap
    height="400px"
    num-of-coins="50"
    currency-code="USD">
  </qc-heatmap>
  <script src="https://quantifycrypto.com/widgets/heatmaps/js/qc-heatmap-widget.js"><\/script>
</body>
</html>`;

    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Content-Security-Policy", WIDGET_CSP);
    c.header("Cache-Control", "public, max-age=300, s-maxage=600");
    return c.body(html);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Wrappdex Edge Function Server — Route Orchestrator
// ═══════════════════════════════════════════════════════════════════════
//
// Modules: Auth, VIP, Spin Wheel, News, AMM, VIP Chat, DAO, Storage, Health, 1inch
// Auth:    ED25519 challenge-response sessions (30-min TTL, KV-backed)
// Storage: All state persisted in KV (survives cold starts, multi-instance safe)
// ═══════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono@4.6.3";
import { cors } from "npm:hono@4.6.3/cors";
import { logger } from "npm:hono@4.6.3/logger";

import { registerAuthRoutes } from "./auth.ts";
import { registerVipRoutes } from "./vip.ts";
import { registerSpinRoutes } from "./spin.ts";
import { registerNewsRoutes } from "./news.ts";
import { registerAmmRoutes } from "./amm.ts";
import { registerVipChatRoutes } from "./vip-chat.ts";
import { registerDaoRoutes } from "./dao.ts";
import { registerStorageRoutes } from "./storage.ts";
import { registerHealthRoutes } from "./health.ts";
import { registerOneInchRoutes } from "./oneinch.ts";
import { registerWidgetRoutes } from "./widget.ts";

const app = new Hono();

app.use("*", logger(console.log));

// Open CORS — browser-layer only. Access control is via ED25519 session tokens.
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "X-Session-Token"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// ── Security Response Headers ────────────────────────────────────────

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-XSS-Protection", "0");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");

  // Widget routes serve HTML that must be frameable and set their own CSP.
  // All other routes get the restrictive default policy.
  const isWidgetRoute = c.req.path.includes("/widget/");
  if (!isWidgetRoute) {
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  }
});

// ── Domain Module Registration ───────────────────────────────────────

registerAuthRoutes(app);
registerVipRoutes(app);
registerSpinRoutes(app);
registerNewsRoutes(app);
registerAmmRoutes(app);
registerVipChatRoutes(app);
registerDaoRoutes(app);
registerStorageRoutes(app);
registerHealthRoutes(app);
registerOneInchRoutes(app);
registerWidgetRoutes(app);

Deno.serve(app.fetch);
// ═══════════════════════════════════════════════════════════════════════
// Wrappdex Edge Function Server — Route Orchestrator
// ═══════════════════════════════════════════════════════════════════════
//
// Modules: Auth, VIP, Spin Wheel, News, Atomic Signer, VIP Chat, DAO, Storage, Health, 1inch, SaucerSwap
// Auth:    ED25519 challenge-response sessions (30-min TTL, KV-backed)
// AMM:     Hedera-native atomic CryptoTransfer co-signing oracle (atomic-signer.ts)
// Storage: All state persisted in KV (survives cold starts, multi-instance safe)
// ═══════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono@4.6.3";
import { cors } from "npm:hono@4.6.3/cors";
import { logger } from "npm:hono@4.6.3/logger";

import { registerAuthRoutes } from "./auth.ts";
import { registerVipRoutes } from "./vip.ts";
import { registerSpinRoutes } from "./spin.ts";
import { registerNewsRoutes } from "./news.ts";
import { registerAtomicSignerRoutes } from "./atomic-signer.ts";
import { registerVipChatRoutes } from "./vip-chat.ts";
import { registerDaoRoutes } from "./dao.ts";
import { registerStorageRoutes } from "./storage.ts";
import { registerHealthRoutes } from "./health.ts";
import { registerOneInchRoutes } from "./oneinch.ts";
import { registerSaucerswapPoolRoutes } from "./saucerswap-pools.ts";
import { registerSaucerswapEngineRoutes } from "./saucerswap-engine.ts";
import { registerSaucerswapQuoteRoutes } from "./saucerswap-quote.ts";

const app = new Hono();

app.use("*", logger(console.log));

// Open CORS — browser-layer only. Access control is via ED25519 session tokens.
// X-Account-Id is still listed in allowHeaders for backwards compatibility with
// stale browser tabs, but the server IGNORES it — requireAuth() and requireOwner()
// only accept cryptographic session tokens (security review SEC-01, SEC-02).
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "X-Session-Token", "X-Account-Id"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// ── Request Body Size Limit ──────────────────────────────────────────
// Reject oversized payloads before Hono parses them into memory.
// No legitimate endpoint needs >512 KB (largest is DAO proposal creation).
// Without this, any POST endpoint accepts 100 MB+ payloads — trivial DoS.
const MAX_BODY_BYTES = 524_288; // 512 KB

app.use("*", async (c, next) => {
  const cl = c.req.header("content-length");
  if (cl) {
    const size = parseInt(cl, 10);
    if (!Number.isNaN(size) && size > MAX_BODY_BYTES) {
      return c.json({ error: "Payload too large", maxBytes: MAX_BODY_BYTES }, 413);
    }
  }
  await next();
});

// ── Security Response Headers ────────────────────────────────────────

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-XSS-Protection", "0");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
});

// ── Domain Module Registration ───────────────────────────────────────

registerAuthRoutes(app);
registerVipRoutes(app);
registerSpinRoutes(app);
registerNewsRoutes(app);
registerAtomicSignerRoutes(app);
registerVipChatRoutes(app);
registerDaoRoutes(app);
registerStorageRoutes(app);
registerHealthRoutes(app);
registerOneInchRoutes(app);
registerSaucerswapPoolRoutes(app);
registerSaucerswapEngineRoutes(app);
registerSaucerswapQuoteRoutes(app);

Deno.serve(app.fetch);
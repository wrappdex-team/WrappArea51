import { Hono } from "npm:hono@4.6.3";
import { cors } from "npm:hono@4.6.3/cors";
import { logger } from "npm:hono@4.6.3/logger";
import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "./kv_store.tsx";
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
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-XSS-Protection", "0");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
});

// ═══════════════════════════════════════════════════════════════════════
// Wrappdex Edge Function Server
// ═══════════════════════════════════════════════════════════════════════
//
// Modules: Spin Wheel, Smart Liquidity (AMM), News Ticker, VIP Chat, DAO
// Auth:    ED25519 challenge-response sessions (30-min TTL, KV-backed)
// Storage: All state persisted in KV (survives cold starts, multi-instance safe)
// ═══════════════════════════════════════════════════════════════════════

// ── Constants ────────────────────────────────────────────────────────

const WINNERS_KEY = "spin_winners_log";
const COOLDOWN_PREFIX = "spin_cd_";   // KV key per account for cooldown
const MAX_WINNERS = 10;
const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const SPIN_ODDS = 0.02;    // 1:50 = 2% — uniform for ALL wallets
const SEGMENT_COUNT = 12;
const WINNER_SEGMENT_INDEX = 5; // index of the "HBAR.ħ" segment on the wheel

interface WinnerRecord {
  accountId: string;
  ticketId: string;
  timestamp: number;
}

// ── Rate Limiter (KV-backed, per-IP) ─────────────────────────────────
// L1: in-memory cache for hot-path speed. L2: KV for persistence.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_PREFIX = "rl_";
const _rateLimitL1 = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_L1_MAX_SIZE = 10_000; // Cap in-memory map to prevent unbounded growth

async function isRateLimited(ip: string): Promise<boolean> {
  const now = Date.now();
  const kvKey = RATE_LIMIT_PREFIX + ip.replace(/[^a-zA-Z0-9._:-]/g, "_");

  // Periodic L1 eviction — prune expired entries when map grows large
  if (_rateLimitL1.size > RATE_LIMIT_L1_MAX_SIZE) {
    for (const [k, v] of _rateLimitL1) {
      if (now > v.resetAt) _rateLimitL1.delete(k);
    }
  }

  // L1: fast in-memory check (covers warm instances)
  const l1 = _rateLimitL1.get(ip);
  if (l1 && now <= l1.resetAt) {
    l1.count++;
    if (l1.count > RATE_LIMIT_MAX_REQUESTS) return true;
    // Async write-through to KV (non-blocking)
    kv.set(kvKey, { count: l1.count, resetAt: l1.resetAt }).catch(() => {});
    return false;
  }

  // L2: KV check (covers cold starts / new instances)
  try {
    const l2: { count: number; resetAt: number } | null = await kv.get(kvKey);
    if (l2 && now <= l2.resetAt) {
      const updated = { count: l2.count + 1, resetAt: l2.resetAt };
      _rateLimitL1.set(ip, updated);
      kv.set(kvKey, updated).catch(() => {});
      return updated.count > RATE_LIMIT_MAX_REQUESTS;
    }
  } catch { /* KV miss or error — start fresh */ }

  // Fresh window
  const fresh = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  _rateLimitL1.set(ip, fresh);
  kv.set(kvKey, fresh).catch(() => {});
  return false;
}

function getClientIp(c: any): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("cf-connecting-ip")
    || "unknown";
}

// ── Input Sanitization ───────────────────────────────────────────────

function sanitizeString(input: string, maxLength: number): string {
  return input
    .normalize("NFC")
    .replace(/[<>"'&]/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    // Strip zero-width and invisible Unicode characters
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    // Strip bidirectional override/control characters (text direction spoofing)
    .replace(/[\u202A-\u202E\u2066-\u2069\u061C\u200E\u200F]/g, "")
    // Strip combining diacritical marks beyond the first per base char (homoglyph stacking)
    .replace(/([\u0300-\u036F]){2,}/g, "$1")
    .trim()
    .slice(0, maxLength);
}

function isValidHederaAccountId(id: string): boolean {
  return /^0\.0\.\d{1,10}$/.test(id);
}

// ── Crypto-safe helpers ──────────────────────────────────────────────

function secureRandomFloat(): number {
  // Generate a cryptographically secure float in [0, 1)
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / (0xFFFFFFFF + 1);
}

function secureRandomInt(max: number): number {
  return Math.floor(secureRandomFloat() * max);
}

function generateTicketId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `TKT-${hex}`;
}

// ── Routes ───────────────────────────────────────────────────────────

app.get("/make-server-54299934/health", (c) => {
  return c.json({ status: "ok" });
});

// GET /winners — public read-only, returns last 10 winners
app.get("/make-server-54299934/winners", async (c) => {
  try {
    const winners: WinnerRecord[] = (await kv.get(WINNERS_KEY)) ?? [];
    return c.json({ winners });
  } catch (err) {
    console.log("Error fetching winners:", err);
    return c.json({ error: "Failed to fetch winners" }, 500);
  }
});

// POST /spin — Server-determined outcome via CSPRNG.
// accountId from session token (preferred) OR from body with Mirror Node VIP gate.

app.post("/make-server-54299934/spin", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) {
      return c.json({ error: "Rate limited — try again in a minute" }, 429);
    }

    // ── Identify the account ──
    // Prefer authenticated session; fall back to body.accountId + Mirror Node VIP check.
    let accountId: string;

    const session = await validateSession(c);
    if (session) {
      accountId = session.accountId;
      console.log(`[Spin] Authenticated via session: ${accountId}`);
    } else {
      // No session — accept accountId from body and verify VIP via Mirror Node
      let body: any;
      try { body = await c.req.json(); } catch { body = {}; }
      const rawId = typeof body.accountId === "string" ? body.accountId.trim() : "";
      if (!rawId || !/^0\.0\.\d+$/.test(rawId)) {
        return c.json({ error: "Valid Hedera account ID required (e.g. 0.0.12345)", code: "INVALID_ACCOUNT" }, 400);
      }
      accountId = sanitizeString(rawId, 20);

      // ── Mirror Node VIP gate ──
      // Must hold >= 100M HBAR.ħ OR >= 1 VIP NFT to spin.
      console.log(`[Spin] No session — verifying VIP via Mirror Node for ${accountId}`);
      const vipStatus = await verifyVipEligibilityFull(accountId);
      if (!vipStatus.eligible) {
        console.log(`[Spin] VIP FAILED: ${accountId} balance=${vipStatus.tokenBalance} nfts=${vipStatus.nftCount}`);
        return c.json({
          error: "VIP access required — hold 100M+ HBAR.ħ tokens or a VIP NFT to spin",
          code: "VIP_REQUIRED",
          tokenBalance: vipStatus.tokenBalance,
          nftCount: vipStatus.nftCount,
        }, 403);
      }
      console.log(`[Spin] VIP verified: ${accountId} balance=${vipStatus.tokenBalance} nfts=${vipStatus.nftCount}`);
    }

    const now = Date.now();

    // ── Server-side cooldown (KV-backed, not localStorage) ──
    const cdKey = COOLDOWN_PREFIX + accountId;
    const lastSpin: number | null = await kv.get(cdKey);
    if (lastSpin && (now - lastSpin) < SPIN_COOLDOWN_MS) {
      const remaining = SPIN_COOLDOWN_MS - (now - lastSpin);
      return c.json({
        canSpin: false,
        cooldownMs: remaining,
        error: "Cooldown active — try again later",
      }, 429);
    }

    // ── Determine outcome with crypto RNG ──
    const odds = SPIN_ODDS;
    const roll = secureRandomFloat();
    const isWin = roll < odds;

    // ── Calculate wheel segment and rotation ──
    let targetSegmentIndex: number;
    if (isWin) {
      targetSegmentIndex = WINNER_SEGMENT_INDEX;
    } else {
      // Pick a random non-winning segment
      let idx: number;
      do {
        idx = secureRandomInt(SEGMENT_COUNT);
      } while (idx === WINNER_SEGMENT_INDEX);
      targetSegmentIndex = idx;
    }

    const segmentAngle = 360 / SEGMENT_COUNT;
    const segCenterAngle = targetSegmentIndex * segmentAngle + segmentAngle / 2;
    const jitter = (secureRandomFloat() - 0.5) * segmentAngle * 0.6;
    const targetAngle = 360 - segCenterAngle + jitter;
    const fullRotations = (5 + secureRandomInt(4)) * 360;
    // Client adds this to their current rotation state
    const spinDelta = fullRotations + ((targetAngle % 360) + 360) % 360;

    // ── Set cooldown ──
    await kv.set(cdKey, now);

    // ── If win, generate ticket and record ──
    let ticketId: string | null = null;
    let winners: WinnerRecord[] | null = null;

    if (isWin) {
      ticketId = generateTicketId();
      const record: WinnerRecord = {
        accountId: sanitizeString(accountId, 20),
        ticketId,
        timestamp: now,
      };
      const existing: WinnerRecord[] = (await kv.get(WINNERS_KEY)) ?? [];
      winners = [record, ...existing].slice(0, MAX_WINNERS);
      await kv.set(WINNERS_KEY, winners);
      console.log(`[Spin] WIN: ${accountId} / ${ticketId} (roll=${roll.toFixed(4)}, odds=${odds})`);
    } else {
      console.log(`[Spin] LOSE: ${accountId} (roll=${roll.toFixed(4)}, odds=${odds})`);
    }

    return c.json({
      win: isWin,
      ticketId,
      segmentIndex: targetSegmentIndex,
      spinDelta: Math.round(spinDelta),
      timestamp: now,
      winners: winners ?? undefined,
    });
  } catch (err) {
    console.log("Error in /spin:", err);
    return c.json({ error: "Spin failed" }, 500);
  }
});

// POST /winners — Disabled. All recording happens inside POST /spin.
app.post("/make-server-54299934/winners", (c) => {
  return c.json(
    { error: "Direct winner recording is disabled. Use POST /spin instead." },
    405,
  );
});

// DELETE /winners — Admin-only reset. Requires SUPABASE_SERVICE_ROLE_KEY.
app.delete("/make-server-54299934/winners", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) {
      return c.json({ error: "Rate limited" }, 429);
    }

    // Require admin wallet identification
    const adminToken = c.req.header("authorization") || "";
    const expectedToken = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!expectedToken || adminToken !== `Bearer ${expectedToken}`) {
      console.log(`[SECURITY] Unauthorized DELETE /winners attempt from IP: ${ip}`);
      return c.json({ error: "Unauthorized — service role key required" }, 403);
    }

    await kv.set(WINNERS_KEY, []);
    console.log(`[SECURITY] Winner history cleared by authorized admin from IP: ${ip}`);
    return c.json({ success: true, winners: [] });
  } catch (err) {
    console.log("Error clearing winners:", err);
    return c.json({ error: "Failed to clear winners" }, 500);
  }
});

// ── GET /spin/cooldown/:accountId — check remaining cooldown ─────────
app.get("/make-server-54299934/spin/cooldown/:accountId", async (c) => {
  try {
    const accountId = c.req.param("accountId");
    if (!accountId || !isValidHederaAccountId(accountId)) {
      return c.json({ error: "Invalid accountId" }, 400);
    }
    const cdKey = COOLDOWN_PREFIX + accountId;
    const lastSpin: number | null = await kv.get(cdKey);
    const now = Date.now();
    if (!lastSpin || (now - lastSpin) >= SPIN_COOLDOWN_MS) {
      return c.json({ canSpin: true, cooldownMs: 0 });
    }
    return c.json({ canSpin: false, cooldownMs: SPIN_COOLDOWN_MS - (now - lastSpin) });
  } catch (err) {
    console.log("Error checking cooldown:", err);
    // Fail closed — if KV is down, deny spins to prevent cooldown bypass
    return c.json({ canSpin: false, cooldownMs: SPIN_COOLDOWN_MS, error: "Service temporarily unavailable" }, 503);
  }
});

// DELETE /spin/cooldown — Dev reset: clears spin cooldown
app.delete("/make-server-54299934/spin/cooldown", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) {
      return c.json({ error: "Rate limited" }, 429);
    }
    // Session auth preferred; fall back to query param ?accountId=
    let accountId: string;
    const session = await validateSession(c);
    if (session) {
      accountId = session.accountId;
    } else {
      const qid = c.req.query("accountId") || "";
      if (!qid || !/^0\.0\.\d+$/.test(qid.trim())) {
        return c.json({ error: "Account ID required" }, 400);
      }
      accountId = sanitizeString(qid.trim(), 20);
    }
    const cdKey = COOLDOWN_PREFIX + accountId;
    await kv.del(cdKey);
    console.log(`[Spin] Cooldown reset for ${accountId} (dev reset from IP: ${ip})`);
    return c.json({ success: true, accountId, message: "Spin cooldown cleared" });
  } catch (err) {
    console.log("Error resetting spin cooldown:", err);
    return c.json({ error: "Failed to reset cooldown" }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════
// NEWS TICKER — Cached proxy to CoinGecko trending + search endpoints
// ══════════════════════════════════════════════════════════════════════

const NEWS_CACHE_KEY = "news_ticker_cache";
const NEWS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedNews {
  items: Array<{ token: string; headline: string; url: string; source: string }>;
  fetchedAt: number;
}

/**
 * Fetches real crypto news from CoinGecko's free /search/trending endpoint
 * and supplements with global market data + Hedera stats. Results are
 * KV-cached for 10 minutes.
 */
async function fetchCryptoNews(): Promise<CachedNews["items"]> {
  // Check cache first
  try {
    const cached: CachedNews | null = await kv.get(NEWS_CACHE_KEY);
    if (cached && (Date.now() - cached.fetchedAt) < NEWS_CACHE_TTL_MS && cached.items.length > 0) {
      return cached.items;
    }
  } catch { /* cache miss — fetch fresh */ }

  const items: CachedNews["items"] = [];

  // Source 1: CoinGecko trending coins (free, no API key)
  try {
    const trendResp = await fetch("https://api.coingecko.com/api/v3/search/trending", {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (trendResp.ok) {
      const data = await trendResp.json();
      const coins = data?.coins ?? [];
      for (const entry of coins.slice(0, 7)) {
        const coin = entry?.item;
        if (!coin) continue;
        const symbol = (coin.symbol || "").toUpperCase();
        const name = coin.name || symbol;
        const priceChange = coin.data?.price_change_percentage_24h?.usd;
        const priceBtc = coin.data?.price_btc;
        let headline = `${name} is trending`;
        if (typeof priceChange === "number") {
          const dir = priceChange >= 0 ? "up" : "down";
          headline = `${name} trending — ${dir} ${Math.abs(priceChange).toFixed(1)}% in 24h`;
        }
        if (priceBtc) {
          headline += ` (${Number(priceBtc).toExponential(2)} BTC)`;
        }
        const slug = coin.slug || coin.id || name.toLowerCase().replace(/\s+/g, "-");
        items.push({
          token: symbol,
          headline,
          url: `https://www.coingecko.com/en/coins/${slug}`,
          source: "CoinGecko",
        });
      }
    }
  } catch { /* non-critical */ }

  // Source 2: CoinGecko global market data
  try {
    const globalResp = await fetch("https://api.coingecko.com/api/v3/global", {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (globalResp.ok) {
      const gd = (await globalResp.json())?.data;
      if (gd) {
        const mcapChange = gd.market_cap_change_percentage_24h_usd;
        if (typeof mcapChange === "number") {
          const dir = mcapChange >= 0 ? "up" : "down";
          items.push({
            token: "GLOBAL",
            headline: `Total crypto market cap ${dir} ${Math.abs(mcapChange).toFixed(2)}% — $${(gd.total_market_cap?.usd / 1e12).toFixed(2)}T`,
            url: "https://www.coingecko.com/en/global-charts",
            source: "CoinGecko",
          });
        }
        const btcDom = gd.market_cap_percentage?.btc;
        if (typeof btcDom === "number") {
          items.push({
            token: "BTC",
            headline: `Bitcoin dominance at ${btcDom.toFixed(1)}% of total crypto market cap`,
            url: "https://www.coingecko.com/en/global-charts",
            source: "CoinGecko",
          });
        }
        const ethDom = gd.market_cap_percentage?.eth;
        if (typeof ethDom === "number") {
          items.push({
            token: "ETH",
            headline: `Ethereum market share at ${ethDom.toFixed(1)}% — ${gd.active_cryptocurrencies?.toLocaleString() || "many"} active coins tracked`,
            url: "https://www.coingecko.com/en/global-charts",
            source: "CoinGecko",
          });
        }
      }
    }
  } catch { /* non-critical */ }

  // Source 3: Hedera-specific data from Mirror Node
  try {
    const hbarResp = await fetch("https://mainnet-public.mirrornode.hedera.com/api/v1/network/supply", {
      signal: AbortSignal.timeout(5000),
    });
    if (hbarResp.ok) {
      const supply = await hbarResp.json();
      const totalHbar = Number(supply?.total_supply) / 1e8;
      if (totalHbar > 0) {
        items.push({
          token: "HBAR",
          headline: `Hedera total supply: ${(totalHbar / 1e9).toFixed(2)}B HBAR — network processing enterprise-grade transactions`,
          url: "https://hashscan.io/mainnet/dashboard",
          source: "HashScan",
        });
      }
    }
  } catch { /* non-critical */ }

  // If all fetches failed, return minimal fallback
  if (items.length === 0) {
    items.push(
      { token: "BTC", headline: "Bitcoin continues as the leading digital asset by market capitalization", url: "https://www.coingecko.com/en/coins/bitcoin", source: "CoinGecko" },
      { token: "HBAR", headline: "Hedera Hashgraph — enterprise-grade distributed ledger technology", url: "https://hedera.com", source: "Hedera" },
      { token: "ETH", headline: "Ethereum ecosystem powering DeFi, NFTs, and L2 scaling solutions", url: "https://www.coingecko.com/en/coins/ethereum", source: "CoinGecko" },
    );
  }

  // Cache results
  try {
    await kv.set(NEWS_CACHE_KEY, { items, fetchedAt: Date.now() });
  } catch { /* non-critical */ }

  return items;
}

// ══════════════════════════════════════════════════════════════════════
// SMART LIQUIDITY — Constant-Product AMM Engine (KV-Backed)
// ══════════════════════════════════════════════════════════════════════
//
// Architecture:
//   - Constant-product AMM (x * y = k) for 2-token pools
//   - All pool state in KV (multi-instance safe, cold-start resilient)
//   - LP share tracking per user per pool
//   - Smart routing: direct → USDC-hop, selects lowest price impact
//   - Oracle prices (SaucerSwap) for UI/TVL only — swaps use reserves
//
// Security design:
//   - First-depositor attack mitigated by MINIMUM_LIQUIDITY lock (1000 units)
//   - Reserves stored as raw integer strings (no floating-point loss)
//   - Depth-proportional max swap caps (<$10K: 2%, <$100K: 5%, >$100K: 10%)
//   - Pools below $100 TVL excluded from routing (manipulation resistance)
//   - Per-pool pessimistic lock + optimistic CAS versioning on all mutations
//   - Sandwich protection: KV mempool is private (server-side only)
//   - Fees stay in pool (increase k), benefiting all LP holders
//   - Pool creation restricted to whitelisted Tier 1 tokens
//
// ══════════════════════════════════════════════════════════════════════

const SAUCERSWAP_API_URL = "https://api.saucerswap.finance";
// Cache the SaucerSwap API path that last succeeded
let _saucerswapWorkingPath: string | null = null;
const POOL_PREFIX = "sl_pool_";
const LP_PREFIX = "sl_lp_";
const SWAP_LOG_PREFIX = "sl_swap_";
const USER_SWAPS_PREFIX = "sl_user_swaps_"; // Per-account swap history index
const USER_SWAPS_MAX = 10;                  // Cap per-account swap history
const GLOBAL_RECENT_SWAPS_KEY = "sl_recent_swaps"; // Anonymized site-wide activity feed
const GLOBAL_RECENT_SWAPS_MAX = 10;
const SWAP_HISTORY_RATE_PREFIX = "sl_shrl_";       // Per-account rate limit for history reads
const SWAP_HISTORY_RATE_TTL_MS = 5_000;            // 1 request per 5s per account
const POOL_INDEX_KEY = "sl_pool_index";
const ORACLE_CACHE_KEY = "sl_oracle_cache";
const ORACLE_CACHE_TTL_MS = 60_000;
const TREASURY_FEE_KEY = "sl_treasury_fees";

// Per-pool pessimistic lock (KV-backed)
const POOL_LOCK_PREFIX = "sl_plock_";
const POOL_LOCK_TTL_MS = 5_000;            // Max lock hold time (safety valve)
const POOL_LOCK_WAIT_MS = 3_000;           // Max wait for lock acquisition
const POOL_LOCK_RETRY_INTERVAL_MS = 40;    // Spin-wait interval

// ── Typed records for swap history and treasury fee accumulator ──────
interface SwapRecord {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  protocolFeeTinybar?: number;
  timestamp: number;
}

interface TreasuryFeeAccumulator {
  totalTinybar: number;
  swapCount: number;
  treasuryAccount: string;
  lastUpdated: number;
}

interface PoolApiResponse {
  tvlUsd: number;
  priceA: number;
  priceB: number;
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════
// AUTHENTICATION — ED25519 Challenge-Response Sessions
// ═══════════════════════════════════════════════════════════════════════
//
// Flow:
//   1. GET  /auth/challenge/:accountId → server issues CSPRNG nonce (5-min TTL)
//   2. Client signs nonce in HashPack wallet (ED25519)
//   3. POST /auth/session → server verifies sig against Mirror Node public key
//   4. Server returns 32-byte CSPRNG session token (30-min TTL, KV-stored)
//   5. All mutating requests carry X-Session-Token header
//
// Security: single-use nonces, replay protection, account-bound sessions,
// public key caching (10-min TTL), fail-closed on unsupported key types.
// ════════���══════════════════════════════════════════════════════════════

const AUTH_CHALLENGE_PREFIX = "auth_ch_";
const AUTH_SESSION_PREFIX = "auth_sess_";
const AUTH_PUBKEY_CACHE_PREFIX = "auth_pk_";
const AUTH_ACCT_SESSION_PREFIX = "auth_as_";  // Per-account session index
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 30 * 60 * 1000;
const AUTH_PUBKEY_CACHE_TTL_MS = 10 * 60 * 1000;
const AUTH_VERSION = "wrappdex:auth:v1";
const HEDERA_MIRROR_NODE = "https://mainnet-public.mirrornode.hedera.com";
const ED25519_DER_PREFIX = "302a300506032b6570032100";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateChallengeNonce(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

function generateSessionToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

// ── Mirror Node Public Key Fetch (cached 10 min) ────────────────────

interface PublicKeyResult { type: "ED25519"; rawKeyHex: string; error?: undefined; }
interface PublicKeyError { type?: undefined; rawKeyHex?: undefined; error: string; }

async function fetchAccountPublicKey(accountId: string): Promise<PublicKeyResult | PublicKeyError> {
  const cacheKey = AUTH_PUBKEY_CACHE_PREFIX + accountId;
  try {
    const cached: { key: PublicKeyResult; ts: number } | null = await kv.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < AUTH_PUBKEY_CACHE_TTL_MS) return cached.key;
  } catch { /* cache miss */ }

  try {
    const res = await fetch(`${HEDERA_MIRROR_NODE}/api/v1/accounts/${accountId}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      if (res.status === 404) return { error: `Account ${accountId} not found on Hedera mainnet` };
      return { error: `Mirror Node returned HTTP ${res.status}` };
    }
    const data = await res.json();
    const keyData = data?.key;
    if (!keyData || !keyData._type || !keyData.key) {
      return { error: "Account has no public key (possibly a smart contract account)" };
    }
    if (keyData._type !== "ED25519") {
      return { error: `Unsupported key type: ${keyData._type}. Only ED25519 accounts supported for authentication.` };
    }
    let rawKeyHex: string = keyData.key.toLowerCase();
    if (rawKeyHex.startsWith(ED25519_DER_PREFIX)) {
      rawKeyHex = rawKeyHex.substring(ED25519_DER_PREFIX.length);
    }
    if (rawKeyHex.length !== 64) {
      return { error: `Invalid ED25519 key length: expected 64 hex chars, got ${rawKeyHex.length}` };
    }
    const result: PublicKeyResult = { type: "ED25519", rawKeyHex };
    try { await kv.set(cacheKey, { key: result, ts: Date.now() }); } catch { /* non-critical */ }
    return result;
  } catch (err: any) {
    return { error: `Mirror Node fetch failed: ${err?.message || err}` };
  }
}

// ── ED25519 Signature Verification (Web Crypto API) ────────────────

async function verifyED25519Signature(
  publicKeyHex: string, messageBytes: Uint8Array, signatureHex: string,
): Promise<boolean> {
  try {
    const pubKeyBytes = hexToBytes(publicKeyHex);
    const sigBytes = hexToBytes(signatureHex);
    if (sigBytes.length !== 64) { console.log(`[AUTH] Sig length invalid: ${sigBytes.length}`); return false; }
    if (pubKeyBytes.length !== 32) { console.log(`[AUTH] PubKey length invalid: ${pubKeyBytes.length}`); return false; }

    const cryptoKey = await crypto.subtle.importKey("raw", pubKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", cryptoKey, sigBytes, messageBytes);
  } catch (err: any) {
    console.log(`[AUTH] ED25519 verification error: ${err?.message || err}`);
    return false;
  }
}

// ── Challenge & Session Types ───────────────────────────────────────

interface AuthChallenge {
  challengeId: string; accountId: string; nonce: string; message: string;
  createdAt: number; expiresAt: number; used: boolean;
}

function buildChallengeMessage(accountId: string, nonce: string, timestamp: number): string {
  return `${AUTH_VERSION}:${accountId}:${nonce}:${timestamp}`;
}

interface AuthSession { token: string; accountId: string; createdAt: number; expiresAt: number; }

/** Validate session token and return bound accountId. */
async function validateSession(c: any): Promise<{ accountId: string } | null> {
  const token = c.req.header("x-session-token") || "";
  if (!token || token.length < 32) return null;
  try {
    const session: AuthSession | null = await kv.get(AUTH_SESSION_PREFIX + token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      kv.del(AUTH_SESSION_PREFIX + token).catch(() => {});
      return null;
    }
    return { accountId: session.accountId };
  } catch { return null; }
}

/** Require authenticated session. Returns accountId from verified session. */
async function requireAuth(c: any): Promise<{ accountId: string } | Response> {
  const session = await validateSession(c);
  if (!session) {
    return c.json({
      error: "Authentication required. Sign a challenge via GET /auth/challenge/:accountId then POST /auth/session.",
      code: "AUTH_REQUIRED",
    }, 401);
  }
  return { accountId: session.accountId };
}

// ── AUTH ROUTES ─────────────────────────────────────────────────────

// GET /auth/challenge/:accountId — Issue a time-limited challenge nonce
app.get("/make-server-54299934/auth/challenge/:accountId", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const accountId = c.req.param("accountId");
    if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid Hedera account ID" }, 400);

    const keyResult = await fetchAccountPublicKey(accountId);
    if (keyResult.error) return c.json({ error: keyResult.error, code: "KEY_FETCH_FAILED" }, 400);

    const now = Date.now();
    const nonce = generateChallengeNonce();
    const challengeId = `ch_${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;
    const message = buildChallengeMessage(accountId, nonce, now);

    const challenge: AuthChallenge = { challengeId, accountId, nonce, message, createdAt: now, expiresAt: now + AUTH_CHALLENGE_TTL_MS, used: false };
    await kv.set(AUTH_CHALLENGE_PREFIX + challengeId, challenge);
    console.log(`[AUTH] Challenge issued: ${challengeId} for ${accountId}`);
    return c.json({ challengeId, message, expiresAt: challenge.expiresAt, keyType: keyResult.type });
  } catch (err) {
    console.log("Error in GET /auth/challenge:", err);
    return c.json({ error: "Challenge generation failed" }, 500);
  }
});

// POST /auth/session — Verify signature and create session token
//
// Nonce consumption strategy: DELETE-BEFORE-VERIFY
//   The challenge is deleted from KV immediately after reading, BEFORE
//   signature verification. This closes the race window that existed
//   when we used a mark-as-used (read → set used=true) pattern — two
//   concurrent requests could both read used=false in that window.
//
//   With delete-first, the second request gets null from kv.get and fails.
//   Trade-off: if verification fails (bad sig, Mirror Node down), the
//   challenge is already consumed — the user must request a new one.
//   This is the correct security posture: one attempt per nonce.
//
//   Residual race: KV read + delete is not atomic, so two requests
//   arriving within ~1ms could both read the challenge before either
//   deletes it. In a wallet-signing flow (user clicks "Sign"), this
//   is practically unreachable. Both sessions would bind to the same
//   accountId with no privilege escalation.

app.post("/make-server-54299934/auth/session", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const body = await c.req.json();
    const { challengeId, signature, accountId } = body;
    if (!challengeId || !signature || !accountId) return c.json({ error: "Missing: challengeId, signature, accountId" }, 400);
    if (!isValidHederaAccountId(accountId)) return c.json({ error: "Invalid Hedera account ID" }, 400);

    // ── Retrieve challenge ──
    const challengeKey = AUTH_CHALLENGE_PREFIX + challengeId;
    const challenge: AuthChallenge | null = await kv.get(challengeKey);
    if (!challenge) return c.json({ error: "Challenge not found or already consumed", code: "CHALLENGE_INVALID" }, 400);

    // ── Consume nonce immediately — delete from KV before any further work ──
    // A concurrent request arriving after this point will get null and fail.
    await kv.del(challengeKey);

    // ── Validate challenge fields (operating on in-memory copy) ──
    if (challenge.used) {
      // Belt-and-suspenders: should not occur with delete-first pattern,
      // but guards against legacy challenge objects still flagged as used.
      return c.json({ error: "Challenge already consumed (replay rejected)", code: "CHALLENGE_USED" }, 400);
    }
    if (Date.now() > challenge.expiresAt) {
      return c.json({ error: "Challenge expired. Request a new one.", code: "CHALLENGE_EXPIRED" }, 400);
    }
    if (challenge.accountId !== accountId) {
      return c.json({ error: "Challenge was issued for a different account", code: "CHALLENGE_ACCOUNT_MISMATCH" }, 403);
    }

    // ── Fetch public key and verify ED25519 signature ──
    const keyResult = await fetchAccountPublicKey(accountId);
    if (keyResult.error) return c.json({ error: `Cannot verify: ${keyResult.error}`, code: "KEY_FETCH_FAILED" }, 400);

    const messageBytes = new TextEncoder().encode(challenge.message);
    const cleanSig = signature.startsWith("0x") ? signature.slice(2) : signature;
    const isValid = await verifyED25519Signature(keyResult.rawKeyHex, messageBytes, cleanSig);

    if (!isValid) {
      console.log(`[AUTH] Signature FAILED for ${accountId} challenge=${challengeId}`);
      return c.json({ error: "Signature verification failed. Ensure you signed the exact challenge message.", code: "SIGNATURE_INVALID" }, 401);
    }

    // ── Revoke existing session for this account ──
    // Ensures only one active session per account. Prevents the scenario
    // where a privilege escalation (e.g., addAdmin) completes with a stale
    // token that wasn't properly revoked by the client-side DELETE.
    try {
      const oldToken: string | null = await kv.get(AUTH_ACCT_SESSION_PREFIX + accountId);
      if (oldToken) {
        await kv.del(AUTH_SESSION_PREFIX + oldToken);
        console.log(`[AUTH] Revoked previous session for ${accountId}`);
      }
    } catch { /* best-effort — new session is still safe to create */ }

    // ── Create session (challenge already consumed by kv.del above) ──
    const token = generateSessionToken();
    const now = Date.now();
    const session: AuthSession = { token, accountId, createdAt: now, expiresAt: now + AUTH_SESSION_TTL_MS };
    await kv.set(AUTH_SESSION_PREFIX + token, session);
    // Update per-account index so future logins can revoke this session
    await kv.set(AUTH_ACCT_SESSION_PREFIX + accountId, token);
    console.log(`[AUTH] Session created for ${accountId} (expires ${AUTH_SESSION_TTL_MS / 60000}min)`);
    return c.json({ sessionToken: token, accountId, expiresAt: session.expiresAt, ttlMs: AUTH_SESSION_TTL_MS });
  } catch (err) {
    console.log("Error in POST /auth/session:", err);
    return c.json({ error: "Session creation failed" }, 500);
  }
});

// GET /auth/session/validate — Check session validity
app.get("/make-server-54299934/auth/session/validate", async (c) => {
  const session = await validateSession(c);
  if (!session) return c.json({ valid: false }, 401);
  return c.json({ valid: true, accountId: session.accountId });
});

// DELETE /auth/session — Revoke session (logout)
app.delete("/make-server-54299934/auth/session", async (c) => {
  const token = c.req.header("x-session-token") || "";
  if (token) {
    // Read session to get accountId for per-account index cleanup
    try {
      const session: AuthSession | null = await kv.get(AUTH_SESSION_PREFIX + token);
      if (session?.accountId) {
        const indexed: string | null = await kv.get(AUTH_ACCT_SESSION_PREFIX + session.accountId);
        if (indexed === token) {
          kv.del(AUTH_ACCT_SESSION_PREFIX + session.accountId).catch(() => {});
        }
      }
    } catch { /* best-effort — token deletion below is the critical op */ }
    kv.del(AUTH_SESSION_PREFIX + token).catch(() => {});
  }
  return c.json({ success: true });
});

// ── Protocol Swap Fee ───────────────────────────────────────────────
// Flat $0.0007 USD per swap (paid in HBAR). Split 50/50:
//   50% → LP providers (added to reserves, increases k)
//   50% → Protocol treasury (0.0.9695738), accrued in KV for on-chain sweep
// Fee is flat (not proportional) to prevent manipulation via trade splitting.
// HBAR price resolved from oracle; fallback used if stale. Min 1 tinybar.

const PROTOCOL_FEE_USD = 0.0007;            // $0.0007 per swap = 0.07 cents
const PROTOCOL_TREASURY_ACCOUNT = "0.0.9695738";
// Fallback HBAR price — used ONLY when SaucerSwap oracle is unreachable.
// Updated: 2026-02-13. Must be refreshed if HBAR moves ±50% from this value.
// The fee clamp below ensures we never overcharge even if this goes stale.
const HBAR_FALLBACK_PRICE_USD = 0.28;
const HBAR_FALLBACK_UPDATED_AT = 1739404800000; // 2026-02-13T00:00:00Z
const HBAR_FALLBACK_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
// Max protocol fee in tinybar — safety ceiling if oracle + fallback are both stale
const MAX_PROTOCOL_FEE_TINYBAR = 500; // ~$0.0014 at $0.28/HBAR — 2× normal fee

// Swap fee: 0.1% (10 bps) — protocol-fixed, non-adjustable by pool creators.
const FIXED_SWAP_FEE_BPS = 10;

// ── Token Whitelist ─────────────────────────────────────────────────
// Only whitelisted tokens can be used in pools.

interface TokenDef {
  tokenId: string;
  symbol: string;
  name: string;
  decimals: number;
  fallbackPrice: number;
  bridge?: string;
  tier: 1 | 2;
}

const TOKEN_WHITELIST: TokenDef[] = [
  { tokenId: "0.0.1969769", symbol: "WBTC",  name: "Wrapped Bitcoin",        decimals: 8,  fallbackPrice: 97000, bridge: "HashPort", tier: 1 },
  { tokenId: "0.0.1969757", symbol: "WETH",  name: "Wrapped Ether",         decimals: 18, fallbackPrice: 3600,  bridge: "HashPort", tier: 1 },
  { tokenId: "0.0.456858",  symbol: "USDC",  name: "USD Coin",              decimals: 6,  fallbackPrice: 1.00,  tier: 1 },
  { tokenId: "0.0.4291336", symbol: "USDT",  name: "Tether USD",            decimals: 6,  fallbackPrice: 1.00,  tier: 1 },
  { tokenId: "0.0.1970030", symbol: "LINK",  name: "Chainlink",             decimals: 8,  fallbackPrice: 19.0,  bridge: "HashPort", tier: 1 },
  { tokenId: "0.0.3306241", symbol: "WPOL",  name: "Wrapped POL (Polygon)", decimals: 8,  fallbackPrice: 0.40,  bridge: "HashPort", tier: 2 },
];

const ACTIVE_TOKENS = TOKEN_WHITELIST.filter(t => t.tier === 1);
const TOKEN_BY_SYMBOL = new Map(TOKEN_WHITELIST.map(t => [t.symbol, t]));
const TOKEN_BY_ID = new Map(TOKEN_WHITELIST.map(t => [t.tokenId, t]));

// ── Pool State Types ────────────────────────────────────────────────

interface PoolState {
  id: string;
  name: string;
  description: string;
  tokenA: string;
  tokenB: string;
  tokenIdA: string;
  tokenIdB: string;
  decimalsA: number;
  decimalsB: number;
  reserveA: string;        // Raw integer string (no float precision loss)
  reserveB: string;
  lpTotalSupply: string;
  swapFeeBps: number;
  creator: string;
  createdAt: number;
  cumulativeVolumeUsd: string;  // Micro-USD string (1e6 = $1.00) — lossless integer accumulation
  swapCount: number;
  status: "active" | "paused";
  version: number;  // Optimistic lock counter — incremented on every mutating write
}

// Volume stored as micro-USD integer string to avoid IEEE 754 drift.
// Individual swap USD values are small (sub-cent precision fine), but the running
// total would lose precision after ~2^53 / value ≈ millions of additions as a float.
const VOLUME_MICRO_SCALE = 1_000_000;   // 1 micro-USD = $0.000001

/** Convert internal pool state to API-safe format (micro-USD string → USD float). */
function poolToApi(pool: PoolState): Record<string, unknown> {
  return {
    ...pool,
    cumulativeVolumeUsd: parseInt(pool.cumulativeVolumeUsd || "0", 10) / VOLUME_MICRO_SCALE,
  };
}

interface LPPosition {
  poolId: string;
  accountId: string;
  shares: string;
  depositedAt: number;
  lastActionAt: number;
}

// ── AMM Math (Constant Product: x * y = k) ─────────────────────────
// All swap math uses reserves, never oracle prices.

const MINIMUM_LIQUIDITY = 1000n;
const BPS_BASE = 10000n;

function bigIntSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

/** Constant-product swap output (Uniswap V2 formula). Fee stays in pool. */
function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const feeMultiplier = BPS_BASE - BigInt(feeBps);
  const amountInWithFee = amountIn * feeMultiplier;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BPS_BASE + amountInWithFee;
  return numerator / denominator;
}

/** Price impact in bps. */
function getPriceImpactBps(amountIn: bigint, reserveIn: bigint): number {
  if (reserveIn <= 0n) return 10000;
  return Math.min(Number(amountIn * 10000n / (reserveIn + amountIn)), 10000);
}

// ── Pool TVL & Swap Limits ──────────────────────────────────────────

function poolTvlUsd(pool: PoolState, prices: Record<string, number>): number {
  const priceA = prices[pool.tokenIdA] || 0;
  const priceB = prices[pool.tokenIdB] || 0;
  const reserveA = Number(BigInt(pool.reserveA)) / (10 ** pool.decimalsA);
  const reserveB = Number(BigInt(pool.reserveB)) / (10 ** pool.decimalsB);
  return reserveA * priceA + reserveB * priceB;
}

function maxSwapFraction(tvlUsd: number): number {
  if (tvlUsd < 10_000) return 0.02;
  if (tvlUsd < 100_000) return 0.05;
  return 0.10;
}

// ── Oracle Price Fetcher (display-only — swaps use reserves) ────────

async function fetchOraclePrices(): Promise<Record<string, number>> {
  try {
    const cached: { prices: Record<string, number>; ts: number } | null = await kv.get(ORACLE_CACHE_KEY);
    if (cached && (Date.now() - cached.ts) < ORACLE_CACHE_TTL_MS) return cached.prices;
  } catch { /* cache miss */ }

  const prices: Record<string, number> = {};
  prices["0.0.456858"] = 1.0;
  prices["0.0.4291336"] = 1.0;

  // Try cached working variant first, then fallback to all variants
  const allVariants = ["/tokens", "/v1/tokens", "/v2/tokens"];
  const variants = _saucerswapWorkingPath
    ? [_saucerswapWorkingPath, ...allVariants.filter(v => v !== _saucerswapWorkingPath)]
    : allVariants;
  for (const path of variants) {
    try {
      const res = await fetch(`${SAUCERSWAP_API_URL}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const token of data) {
          const id = token.id || token.tokenId;
          const price = parseFloat(token.priceUsd || token.price || "0");
          if (id && price > 0 && TOKEN_BY_ID.has(id)) {
            prices[id] = price;
          }
        }
      }
      if (Object.keys(prices).length >= 4) {
        _saucerswapWorkingPath = path; // Cache the variant that worked
        break;
      }
    } catch { continue; }
  }

  let usedFallback = false;
  for (const t of TOKEN_WHITELIST) {
    if (!prices[t.tokenId]) {
      prices[t.tokenId] = t.fallbackPrice;
      usedFallback = true;
    }
  }
  if (usedFallback && (Date.now() - HBAR_FALLBACK_UPDATED_AT) > HBAR_FALLBACK_MAX_AGE_MS) {
    console.log("[Oracle] WARNING: Fallback prices are stale (>90 days). Update HBAR_FALLBACK_PRICE_USD and TOKEN_WHITELIST fallbackPrice values.");
  }

  try { await kv.set(ORACLE_CACHE_KEY, { prices, ts: Date.now() }); } catch { /* non-critical */ }
  return prices;
}

// ── Pool Helpers ────────────────────────────────────────────────────

async function getPoolIndex(): Promise<string[]> {
  return (await kv.get(POOL_INDEX_KEY)) ?? [];
}

async function getPool(id: string): Promise<PoolState | null> {
  const pool: PoolState | null = await kv.get(POOL_PREFIX + id);
  if (pool) {
    // Backfill version for pools created before versioning was added
    if (typeof pool.version !== "number") pool.version = 0;
    // Backfill legacy float USD → micro-USD string
    if (typeof (pool as any).cumulativeVolumeUsd === "number") {
      pool.cumulativeVolumeUsd = Math.round((pool as any).cumulativeVolumeUsd * VOLUME_MICRO_SCALE).toString();
    }
  }
  return pool;
}

async function savePool(pool: PoolState): Promise<void> {
  await kv.set(POOL_PREFIX + pool.id, pool);
}

/**
 * Compare-and-swap pool write. Re-reads from KV, verifies version matches
 * expectedVersion, bumps, and writes. Returns false on conflict.
 * Second layer of defense after the pessimistic lock.
 */
async function compareAndSavePool(pool: PoolState, expectedVersion: number): Promise<boolean> {
  const current = await kv.get(POOL_PREFIX + pool.id) as PoolState | null;
  const currentVersion = current?.version ?? 0;
  if (currentVersion !== expectedVersion) {
    console.log(`[CAS] Conflict on pool ${pool.id}: expected v${expectedVersion}, found v${currentVersion}`);
    return false;
  }
  pool.version = expectedVersion + 1;
  await kv.set(POOL_PREFIX + pool.id, pool);
  return true;
}

// ── KV-Based Distributed Lock ───────────────────────────────────────
// Pessimistic lock using KV with write-verify-retry pattern + double-check.
// TTL safety valve ensures release even if holder crashes.
//
// Double-verify pattern: After the initial write-then-read confirms our
// holder, we wait a brief grace period and re-read. This catches the edge
// case where two concurrent writers both wrote within the same KV propagation
// window and both passed the first verify. The second verify (after the
// grace delay) sees the final settled state.
//
// Remaining limitation: KV does not support atomic SETNX, so a sub-millisecond
// race is still theoretically possible. The CAS layer on pool state
// (compareAndSavePool) is the authoritative guard — it will reject any
// write that arrives with a stale version. For production at scale,
// migrate to Redis SETNX or Postgres advisory locks.

interface KvLock {
  holder: string;      // Random UUID identifying the lock holder
  acquiredAt: number;
  expiresAt: number;
  epoch: number;       // Monotonic counter — tiebreaker for concurrent writes
}

/** Monotonic epoch counter for lock fencing */
let _lockEpoch = 0;

interface KvLockConfig {
  key: string;         // Full KV key for this lock
  ttlMs: number;       // Max hold time before TTL expiry (safety valve)
  waitMs: number;      // Max time to wait for acquisition
  retryMs: number;     // Base retry interval (jittered)
}

/** Grace period between first and second verify (double-check) */
const LOCK_GRACE_MS = 15;

/**
 * Acquire a KV-backed pessimistic lock with double-verify pattern.
 * 1. Write lock with unique holder + epoch
 * 2. First verify: read-after-write confirms our holder
 * 3. Grace wait: allows any concurrent writer's set to propagate
 * 4. Second verify: re-read confirms we still own it
 *
 * Returns the holder UUID on success, null on timeout.
 */
async function acquireKvLock(cfg: KvLockConfig): Promise<string | null> {
  const holderId = crypto.randomUUID();
  const deadline = Date.now() + cfg.waitMs;

  while (Date.now() < deadline) {
    const existing: KvLock | null = await kv.get(cfg.key);

    // Lock is free or expired → try to acquire
    if (!existing || Date.now() > existing.expiresAt) {
      const epoch = ++_lockEpoch;
      const lock: KvLock = {
        holder: holderId,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + cfg.ttlMs,
        epoch,
      };
      await kv.set(cfg.key, lock);

      // First verify: read-after-write
      const v1: KvLock | null = await kv.get(cfg.key);
      if (v1?.holder === holderId && v1?.epoch === epoch) {
        // Grace period — let any concurrent writer's set propagate
        await new Promise(r => setTimeout(r, LOCK_GRACE_MS));

        // Second verify: confirm we still own it after grace period
        const v2: KvLock | null = await kv.get(cfg.key);
        if (v2?.holder === holderId && v2?.epoch === epoch) {
          return holderId; // Lock acquired — double-verified
        }
        // Someone overwrote during grace period — fall through to retry
      }
      // Someone else won — fall through to retry
    }

    // Jittered backoff to prevent thundering herd
    const jitter = cfg.retryMs + Math.random() * cfg.retryMs;
    await new Promise(r => setTimeout(r, jitter));
  }

  console.log(`[Lock] Timeout on ${cfg.key} after ${cfg.waitMs}ms`);
  return null;
}

/** Release a KV lock. Only the holder can release it. */
async function releaseKvLock(key: string, holderId: string): Promise<void> {
  try {
    const existing: KvLock | null = await kv.get(key);
    // Only release if we still own it (could have expired and been re-acquired)
    if (existing?.holder === holderId) {
      await kv.del(key);
    }
  } catch {
    // Best-effort release — TTL will clean up regardless
  }
}

/**
 * Execute a function while holding a KV lock.
 * Throws `{ code: "LOCK_TIMEOUT" }` if acquisition fails.
 */
async function withKvLock<T>(cfg: KvLockConfig, fn: () => Promise<T>): Promise<T> {
  const holderId = await acquireKvLock(cfg);
  if (!holderId) {
    throw { code: "LOCK_TIMEOUT", message: `Lock acquisition timeout on ${cfg.key}` };
  }
  try {
    return await fn();
  } finally {
    await releaseKvLock(cfg.key, holderId);
  }
}

// ── Per-Pool Lock (swap, add/remove liquidity) ─────────────────────
// Tuned for fast in-flight mutations: 5s TTL, 3s wait.

function poolLockConfig(poolId: string): KvLockConfig {
  return {
    key: POOL_LOCK_PREFIX + poolId,
    ttlMs: POOL_LOCK_TTL_MS,
    waitMs: POOL_LOCK_WAIT_MS,
    retryMs: POOL_LOCK_RETRY_INTERVAL_MS,
  };
}

/**
 * Execute a function while holding a per-pool lock.
 * Throws `{ code: "POOL_BUSY" }` on timeout (callers return 503).
 *
 * Usage:
 *   const result = await withPoolLock(poolId, async () => {
 *     const pool = await getPool(poolId);
 *     // ...mutate pool...
 *     const ok = await compareAndSavePool(pool, pool.version);
 *     if (!ok) throw { code: "VERSION_CONFLICT" };
 *     return result;
 *   });
 */
async function withPoolLock<T>(poolId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withKvLock(poolLockConfig(poolId), fn);
  } catch (err: any) {
    if (err?.code === "LOCK_TIMEOUT") {
      throw { code: "POOL_BUSY", message: "Pool is busy — too many concurrent operations. Please retry." };
    }
    throw err;
  }
}

// ── Pool Creation Lock ──────────────────────────────────────────────
// Serializes all pool creation requests to prevent:
//   1. Duplicate-pair race (two requests for same pair both pass check)
//   2. Pool index corruption (concurrent read-modify-write on index key)
// Longer timeouts than pool locks — creation involves multiple KV ops.

const POOL_CREATION_LOCK_CONFIG: KvLockConfig = {
  key: "sl_create_lock",
  ttlMs: 10_000,       // 10s hold time — creation does index scan + write
  waitMs: 5_000,       // 5s wait — pool creation is rare, OK to queue
  retryMs: POOL_LOCK_RETRY_INTERVAL_MS,
};

async function getLPPosition(poolId: string, accountId: string): Promise<LPPosition | null> {
  return await kv.get(`${LP_PREFIX}${poolId}_${accountId}`);
}

async function saveLPPosition(pos: LPPosition): Promise<void> {
  await kv.set(`${LP_PREFIX}${pos.poolId}_${pos.accountId}`, pos);
}

// ── ROUTES: Smart Liquidity v2 ──────────────────────────────────────

/** Batch-read all pools in one KV round trip. */
async function getAllPools(poolIds: string[]): Promise<PoolState[]> {
  if (poolIds.length === 0) return [];
  const keys = poolIds.map(id => POOL_PREFIX + id);
  const values: (PoolState | null)[] = await kv.mget(keys);
  const pools: PoolState[] = [];
  for (const v of values) {
    if (!v) continue;
    if (typeof v.version !== "number") v.version = 0; // Backfill legacy pools
    // Backfill legacy float USD → micro-USD string
    if (typeof v.cumulativeVolumeUsd === "number") {
      v.cumulativeVolumeUsd = Math.round(v.cumulativeVolumeUsd * VOLUME_MICRO_SCALE).toString();
    }
    pools.push(v as PoolState);
  }
  return pools;
}

// GET /pools — List all active pools with real-time state + oracle prices
app.get("/make-server-54299934/pools", async (c) => {
  try {
    const poolIds = await getPoolIndex();
    const prices = await fetchOraclePrices();
    const allPools = await getAllPools(poolIds);
    const pools: PoolApiResponse[] = [];
    for (const pool of allPools) {
      if (pool.status !== "active") continue;
      pools.push({ ...poolToApi(pool), tvlUsd: poolTvlUsd(pool, prices), priceA: prices[pool.tokenIdA] || 0, priceB: prices[pool.tokenIdB] || 0 });
    }

    return c.json({ pools, tokens: ACTIVE_TOKENS, prices, updatedAt: Math.floor(Date.now() / 1000) });
  } catch (err) {
    console.log("Error in GET /pools:", err);
    return c.json({ error: "Failed to fetch pools" }, 500);
  }
});

// GET /pools/prices — Oracle prices for display
app.get("/make-server-54299934/pools/prices", async (c) => {
  try {
    const prices = await fetchOraclePrices();
    return c.json({ prices, updatedAt: Math.floor(Date.now() / 1000) });
  } catch (err) {
    console.log("Error in GET /pools/prices:", err);
    return c.json({ error: "Failed to fetch prices" }, 500);
  }
});

// POST /pools/create — Authenticated. Tier 1 tokens only. Fee is protocol-fixed.
// Protected by POOL_CREATION_LOCK to prevent duplicate-pair races and index corruption.
app.post("/make-server-54299934/pools/create", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    // ── Auth + input validation (outside lock — no state mutation) ──

    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const accountId = auth.accountId;

    const body = await c.req.json();
    const { tokenA, tokenB, name, description } = body;

    const defA = TOKEN_BY_SYMBOL.get(tokenA);
    const defB = TOKEN_BY_SYMBOL.get(tokenB);
    if (!defA || !defB) return c.json({ error: `Unknown token. Available: ${ACTIVE_TOKENS.map(t => t.symbol).join(", ")}` }, 400);
    if (defA.tier !== 1 || defB.tier !== 1) return c.json({ error: "Only Tier 1 tokens (top 5 by MC) are currently enabled" }, 400);
    if (tokenA === tokenB) return c.json({ error: "Cannot create pool with identical tokens" }, 400);

    // Fee is protocol-fixed. Any client-supplied feeBps is ignored.

    // Compute deterministic pool ID early (before lock) for logging
    const [sA, sB] = [defA, defB].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const poolId = `sl-${sA.symbol.toLowerCase()}-${sB.symbol.toLowerCase()}`;

    // ── Inside creation lock: duplicate check + create + index update ──
    // Lock serializes ALL pool creations, preventing:
    //   - Two requests for the same pair both passing the duplicate check
    //   - Two requests for different pairs corrupting the pool index

    const result = await withKvLock(POOL_CREATION_LOCK_CONFIG, async () => {
      // Primary guard: direct key lookup for the deterministic pool ID
      const existingPool = await getPool(poolId);
      if (existingPool) {
        return c.json({ error: `Pool ${sA.symbol}/${sB.symbol} already exists (${existingPool.id})` }, 409);
      }

      // Secondary guard: index scan catches any naming/key edge cases
      const poolIds = await getPoolIndex();
      const allPools = await getAllPools(poolIds);
      for (const p of allPools) {
        if (p.status !== "active") continue;
        if ((p.tokenA === sA.symbol && p.tokenB === sB.symbol) || (p.tokenA === sB.symbol && p.tokenB === sA.symbol)) {
          return c.json({ error: `Pool ${sA.symbol}/${sB.symbol} already exists (${p.id})` }, 409);
        }
      }

      const pool: PoolState = {
        id: poolId, name: sanitizeString(name || `${sA.symbol} / ${sB.symbol}`, 64),
        description: sanitizeString(description || `${sA.symbol}/${sB.symbol} liquidity pool`, 256),
        tokenA: sA.symbol, tokenB: sB.symbol, tokenIdA: sA.tokenId, tokenIdB: sB.tokenId,
        decimalsA: sA.decimals, decimalsB: sB.decimals,
        reserveA: "0", reserveB: "0", lpTotalSupply: "0",
        swapFeeBps: FIXED_SWAP_FEE_BPS, creator: sanitizeString(accountId, 20), createdAt: Date.now(),
        cumulativeVolumeUsd: "0", swapCount: 0, status: "active",
        version: 1,
      };

      await savePool(pool);
      poolIds.push(poolId);
      await kv.set(POOL_INDEX_KEY, poolIds);
      console.log(`[SmartLiquidity] Pool created: ${poolId} by ${accountId} (fee=${FIXED_SWAP_FEE_BPS}bps fixed)`);
      return c.json({ success: true, pool: poolToApi(pool) });
    });

    return result;
  } catch (err: any) {
    if (err?.code === "LOCK_TIMEOUT") {
      return c.json({ error: "Pool creation service is busy — please retry in a few seconds", code: "CREATION_BUSY" }, 503);
    }
    console.log("Error in POST /pools/create:", err);
    return c.json({ error: "Pool creation failed" }, 500);
  }
});

// POST /pools/liquidity/add — Authenticated. Lock + CAS protected.
// First deposit burns MINIMUM_LIQUIDITY. Subsequent deposits proportional.
app.post("/make-server-54299934/pools/liquidity/add", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const accountId = auth.accountId;

    const body = await c.req.json();
    const { poolId, amountA, amountB } = body;

    const addLiqResult = await (async () => {
      try {
        return await withPoolLock(poolId, async () => {
          const pool = await getPool(poolId);
          if (!pool) return c.json({ error: "Pool not found" }, 404);
          if (pool.status !== "active") return c.json({ error: "Pool is paused" }, 400);
          const expectedVersion = pool.version;

          const rawA = BigInt(amountA || "0");
          const rawB = BigInt(amountB || "0");
          if (rawA <= 0n || rawB <= 0n) return c.json({ error: "Both amounts must be positive" }, 400);

          const reserveA = BigInt(pool.reserveA);
          const reserveB = BigInt(pool.reserveB);
          const totalSupply = BigInt(pool.lpTotalSupply);
          let sharesMinted: bigint;

          if (totalSupply === 0n) {
            // First deposit: sqrt(A*B) - MINIMUM_LIQUIDITY
            const gm = bigIntSqrt(rawA * rawB);
            if (gm <= MINIMUM_LIQUIDITY) return c.json({ error: "Initial deposit too small" }, 400);
            sharesMinted = gm - MINIMUM_LIQUIDITY;
          } else {
            // Proportional mint
            const fromA = rawA * totalSupply / reserveA;
            const fromB = rawB * totalSupply / reserveB;
            sharesMinted = fromA < fromB ? fromA : fromB;
          }
          if (sharesMinted <= 0n) return c.json({ error: "Amounts too small to mint LP shares" }, 400);

          pool.reserveA = (reserveA + rawA).toString();
          pool.reserveB = (reserveB + rawB).toString();
          pool.lpTotalSupply = (totalSupply + sharesMinted + (totalSupply === 0n ? MINIMUM_LIQUIDITY : 0n)).toString();

          const casOk = await compareAndSavePool(pool, expectedVersion);
          if (!casOk) {
            console.log(`[CAS] AddLiq conflict: pool=${poolId} v=${expectedVersion} account=${accountId}`);
            return c.json({ error: "Pool state changed — please retry", code: "VERSION_CONFLICT" }, 409);
          }

          const existing = await getLPPosition(poolId, accountId);
          const newShares = (BigInt(existing?.shares || "0") + sharesMinted).toString();
          await saveLPPosition({ poolId, accountId, shares: newShares, depositedAt: existing?.depositedAt || Date.now(), lastActionAt: Date.now() });

          console.log(`[SmartLiquidity] +Liquidity v${expectedVersion}→v${expectedVersion + 1}: ${accountId} → ${poolId} (${rawA}/${rawB}, shares=${sharesMinted})`);
          return c.json({ success: true, sharesMinted: sharesMinted.toString(), totalShares: newShares, pool: { reserveA: pool.reserveA, reserveB: pool.reserveB, lpTotalSupply: pool.lpTotalSupply, version: pool.version } });
        });
      } catch (lockErr: any) {
        if (lockErr?.code === "POOL_BUSY") return c.json({ error: lockErr.message, code: "POOL_BUSY" }, 503);
        throw lockErr;
      }
    })();
    return addLiqResult;
  } catch (err) {
    console.log("Error in POST /pools/liquidity/add:", err);
    return c.json({ error: "Add liquidity failed" }, 500);
  }
});

// POST /pools/liquidity/remove — Authenticated. Lock + CAS protected.
app.post("/make-server-54299934/pools/liquidity/remove", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const accountId = auth.accountId;

    const body = await c.req.json();
    const { poolId, shares } = body;

    const removeLiqResult = await (async () => {
      try {
        return await withPoolLock(poolId, async () => {
          const pool = await getPool(poolId);
          if (!pool) return c.json({ error: "Pool not found" }, 404);
          const expectedVersion = pool.version;

          const sharesToBurn = BigInt(shares || "0");
          if (sharesToBurn <= 0n) return c.json({ error: "Shares must be positive" }, 400);

          const position = await getLPPosition(poolId, accountId);
          if (!position || BigInt(position.shares) < sharesToBurn) return c.json({ error: "Insufficient LP shares" }, 400);

          const resA = BigInt(pool.reserveA), resB = BigInt(pool.reserveB), ts = BigInt(pool.lpTotalSupply);
          const outA = sharesToBurn * resA / ts;
          const outB = sharesToBurn * resB / ts;

          pool.reserveA = (resA - outA).toString();
          pool.reserveB = (resB - outB).toString();
          pool.lpTotalSupply = (ts - sharesToBurn).toString();

          const casOk = await compareAndSavePool(pool, expectedVersion);
          if (!casOk) {
            console.log(`[CAS] RemoveLiq conflict: pool=${poolId} v=${expectedVersion} account=${accountId}`);
            return c.json({ error: "Pool state changed — please retry", code: "VERSION_CONFLICT" }, 409);
          }

          const remaining = (BigInt(position.shares) - sharesToBurn).toString();
          if (remaining === "0") { try { await kv.del(`${LP_PREFIX}${poolId}_${accountId}`); } catch { /* ok */ } }
          else { await saveLPPosition({ ...position, shares: remaining, lastActionAt: Date.now() }); }

          console.log(`[SmartLiquidity] -Liquidity v${expectedVersion}→v${expectedVersion + 1}: ${accountId} ← ${poolId} (${outA}/${outB})`);
          return c.json({ success: true, amountA: outA.toString(), amountB: outB.toString(), sharesRemaining: remaining, pool: { version: pool.version } });
        });
      } catch (lockErr: any) {
        if (lockErr?.code === "POOL_BUSY") return c.json({ error: lockErr.message, code: "POOL_BUSY" }, 503);
        throw lockErr;
      }
    })();
    return removeLiqResult;
  } catch (err) {
    console.log("Error in POST /pools/liquidity/remove:", err);
    return c.json({ error: "Remove liquidity failed" }, 500);
  }
});

// GET /pools/position/:poolId/:accountId — Get LP position
app.get("/make-server-54299934/pools/position/:poolId/:accountId", async (c) => {
  try {
    const poolId = c.req.param("poolId");
    const accountId = c.req.param("accountId");
    if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);
    const position = await getLPPosition(poolId, accountId);
    return c.json({ position: position || null });
  } catch (err) {
    console.log("Error fetching LP position:", err);
    return c.json({ position: null, error: "Failed to fetch LP position" }, 500);
  }
});

// POST /pools/quote — AMM quote with smart routing (direct + USDC-hop).
app.post("/make-server-54299934/pools/quote", async (c) => {
  try {
    const body = await c.req.json();
    const { tokenIn, tokenOut, amountIn } = body;
    if (!tokenIn || !tokenOut || !amountIn) return c.json({ error: "Missing: tokenIn, tokenOut, amountIn" }, 400);

    const defIn = TOKEN_BY_SYMBOL.get(tokenIn);
    const defOut = TOKEN_BY_SYMBOL.get(tokenOut);
    if (!defIn || !defOut) return c.json({ error: `Unknown token. Available: ${ACTIVE_TOKENS.map(t => t.symbol).join(", ")}` }, 400);

    // Single oracle fetch + batch pool read
    const [prices, poolIds] = await Promise.all([fetchOraclePrices(), getPoolIndex()]);
    const allPools = await getAllPools(poolIds);
    // Build a quick lookup map for routing
    const activePools = allPools.filter(p => p.status === "active" && BigInt(p.reserveA) > 0n && BigInt(p.reserveB) > 0n);

    interface RouteCandidate { path: string[]; amountOut: bigint; priceImpactBps: number; feeBps: number; poolId: string; }
    const routes: RouteCandidate[] = [];

    const rawIn = BigInt(Math.floor(parseFloat(amountIn) * (10 ** defIn.decimals)));
    if (rawIn <= 0n) return c.json({ error: "Amount must be positive" }, 400);

    // Direct routes — uses pre-fetched pool array (no individual KV reads)
    for (const pool of activePools) {
      let rIn: bigint, rOut: bigint;
      const fwd = pool.tokenA === tokenIn && pool.tokenB === tokenOut;
      const rev = pool.tokenA === tokenOut && pool.tokenB === tokenIn;
      if (fwd) { rIn = BigInt(pool.reserveA); rOut = BigInt(pool.reserveB); }
      else if (rev) { rIn = BigInt(pool.reserveB); rOut = BigInt(pool.reserveA); }
      else continue;

      const tvl = poolTvlUsd(pool, prices);
      if (tvl > 0 && tvl < 100) continue; // Exclude low-TVL pools
      const inputUsd = parseFloat(amountIn) * (prices[defIn.tokenId] || 0);
      if (tvl > 0 && inputUsd > tvl * maxSwapFraction(tvl)) continue; // Depth cap

      const out = getAmountOut(rawIn, rIn, rOut, pool.swapFeeBps);
      if (out <= 0n) continue;
      routes.push({ path: [tokenIn, tokenOut], amountOut: out, priceImpactBps: getPriceImpactBps(rawIn, rIn), feeBps: pool.swapFeeBps, poolId: pool.id });
    }

    // USDC-hop routes (A→USDC→B) — uses pre-fetched pool array
    if (tokenIn !== "USDC" && tokenOut !== "USDC") {
      for (const p1 of activePools) {
        let r1In: bigint, r1Out: bigint;
        const f1 = p1.tokenA === tokenIn && p1.tokenB === "USDC";
        const v1 = p1.tokenA === "USDC" && p1.tokenB === tokenIn;
        if (f1) { r1In = BigInt(p1.reserveA); r1Out = BigInt(p1.reserveB); }
        else if (v1) { r1In = BigInt(p1.reserveB); r1Out = BigInt(p1.reserveA); }
        else continue;
        const mid = getAmountOut(rawIn, r1In, r1Out, p1.swapFeeBps);
        if (mid <= 0n) continue;

        for (const p2 of activePools) {
          if (p2.id === p1.id) continue;
          let r2In: bigint, r2Out: bigint;
          const f2 = p2.tokenA === "USDC" && p2.tokenB === tokenOut;
          const v2 = p2.tokenA === tokenOut && p2.tokenB === "USDC";
          if (f2) { r2In = BigInt(p2.reserveA); r2Out = BigInt(p2.reserveB); }
          else if (v2) { r2In = BigInt(p2.reserveB); r2Out = BigInt(p2.reserveA); }
          else continue;
          const out = getAmountOut(mid, r2In, r2Out, p2.swapFeeBps);
          if (out <= 0n) continue;
          routes.push({ path: [tokenIn, "USDC", tokenOut], amountOut: out, priceImpactBps: getPriceImpactBps(rawIn, r1In) + getPriceImpactBps(mid, r2In), feeBps: p1.swapFeeBps + p2.swapFeeBps, poolId: `${p1.id}+${p2.id}` });
        }
      }
    }

    if (routes.length === 0) return c.json({ error: "No route available. Pools may be empty or pair not supported.", routes: [] }, 404);

    routes.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));
    const best = routes[0];
    const outDisplay = Number(best.amountOut) / (10 ** defOut.decimals);
    const inDisplay = parseFloat(amountIn);

    // Protocol fee in HBAR (WHBAR oracle price or fallback, clamped to safety ceiling)
    const hbarPrice = prices["0.0.1456986"] || HBAR_FALLBACK_PRICE_USD;
    const protocolFeeHbar = PROTOCOL_FEE_USD / hbarPrice;
    const protocolFeeTinybar = Math.min(MAX_PROTOCOL_FEE_TINYBAR, Math.max(1, Math.round(protocolFeeHbar * 1e8)));
    const lpRewardTinybar = Math.floor(protocolFeeTinybar / 2);
    const treasuryFeeTinybar = protocolFeeTinybar - lpRewardTinybar;

    return c.json({
      poolId: best.poolId, tokenIn, tokenOut, amountIn: inDisplay, amountOut: outDisplay,
      amountOutRaw: best.amountOut.toString(), amountInRaw: rawIn.toString(),
      route: best.path.join(" → "), priceImpactBps: best.priceImpactBps, feeBps: best.feeBps,
      feeUsd: inDisplay * (prices[defIn.tokenId] || 0) * best.feeBps / 10000,
      effectiveRate: outDisplay / inDisplay, minAmountOut: outDisplay * 0.995,
      routeCount: routes.length, inPrice: prices[defIn.tokenId] || 0, outPrice: prices[defOut.tokenId] || 0,
      // Protocol fee breakdown
      protocolFee: {
        totalTinybar: protocolFeeTinybar,
        totalHbar: protocolFeeTinybar / 1e8,
        totalUsd: PROTOCOL_FEE_USD,
        lpRewardTinybar,
        treasuryFeeTinybar,
        treasuryAccount: PROTOCOL_TREASURY_ACCOUNT,
        hbarPriceUsed: hbarPrice,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    console.log("Error in POST /pools/quote:", err);
    return c.json({ error: "Quote failed" }, 500);
  }
});

// POST /pools/swap — Authenticated. Lock + CAS protected. Private mempool.
app.post("/make-server-54299934/pools/swap", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const accountId = auth.accountId;

    const body = await c.req.json();
    const { poolId, tokenIn, tokenOut, amountInRaw, minAmountOutRaw } = body;

    // Multi-hop execution not yet supported
    if ((poolId || "").includes("+")) {
      return c.json({ error: "Multi-hop execution is not yet available. Use direct pools." }, 501);
    }

    const swapResult = await (async () => {
      try {
        return await withPoolLock(poolId, async () => {
          const pool = await getPool(poolId);
          if (!pool) return c.json({ error: "Pool not found" }, 404);
          if (pool.status !== "active") return c.json({ error: "Pool is paused" }, 400);
          const expectedVersion = pool.version;

          const fwd = pool.tokenA === tokenIn && pool.tokenB === tokenOut;
          const rev = pool.tokenA === tokenOut && pool.tokenB === tokenIn;
          if (!fwd && !rev) return c.json({ error: "Token pair mismatch" }, 400);

          const resA = BigInt(pool.reserveA), resB = BigInt(pool.reserveB);
          if (resA === 0n || resB === 0n) return c.json({ error: "Pool has no liquidity" }, 400);

          const rIn = fwd ? resA : resB;
          const rOut = fwd ? resB : resA;
          const rawIn = BigInt(amountInRaw || "0");
          if (rawIn <= 0n) return c.json({ error: "Invalid amount" }, 400);

          const rawOut = getAmountOut(rawIn, rIn, rOut, pool.swapFeeBps);
          if (rawOut <= 0n) return c.json({ error: "Output too small" }, 400);
          if (minAmountOutRaw && rawOut < BigInt(minAmountOutRaw)) return c.json({ error: "Slippage exceeded" }, 400);

          // Depth check
          const prices = await fetchOraclePrices();
          const tvl = poolTvlUsd(pool, prices);
          const defIn = TOKEN_BY_SYMBOL.get(tokenIn);
          if (defIn && tvl > 0) {
            const inputUsd = Number(rawIn) / (10 ** defIn.decimals) * (prices[defIn.tokenId] || 0);
            if (inputUsd > tvl * maxSwapFraction(tvl)) {
              return c.json({ error: `Swap too large. Max ~${(maxSwapFraction(tvl) * 100).toFixed(0)}% of $${tvl.toFixed(0)} TVL` }, 400);
            }
          }

          // Update reserves
          if (fwd) { pool.reserveA = (resA + rawIn).toString(); pool.reserveB = (resB - rawOut).toString(); }
          else { pool.reserveA = (resA - rawOut).toString(); pool.reserveB = (resB + rawIn).toString(); }

          // Post-swap k-invariant assertion
          const kNew = BigInt(pool.reserveA) * BigInt(pool.reserveB);
          const kOld = resA * resB;
          if (kNew < kOld) {
            console.log(`[CRITICAL] K-invariant violated! kOld=${kOld} kNew=${kNew} pool=${poolId}`);
            return c.json({ error: "K-invariant violated — swap aborted (report to developers)" }, 500);
          }

          pool.swapCount++;
          const defOut = TOKEN_BY_SYMBOL.get(tokenOut);
          if (defOut) {
            const swapUsd = Number(rawOut) / (10 ** defOut.decimals) * (prices[defOut.tokenId] || 0);
            const swapMicro = Math.round(swapUsd * VOLUME_MICRO_SCALE);
            const currentMicro = parseInt(pool.cumulativeVolumeUsd || "0", 10) || 0;
            pool.cumulativeVolumeUsd = (currentMicro + swapMicro).toString();
          }

          const casOk = await compareAndSavePool(pool, expectedVersion);
          if (!casOk) {
            console.log(`[CAS] Swap conflict: pool=${poolId} v=${expectedVersion} account=${accountId}`);
            return c.json({ error: "Pool state changed during swap — please retry", code: "VERSION_CONFLICT" }, 409);
          }

          // Protocol fee: $0.0007 per swap, split 50/50 LP rewards / treasury (clamped)
          const hbarPriceForFee = prices["0.0.1456986"] || HBAR_FALLBACK_PRICE_USD;
          const protocolFeeTinybar = Math.min(MAX_PROTOCOL_FEE_TINYBAR, Math.max(1, Math.round((PROTOCOL_FEE_USD / hbarPriceForFee) * 1e8)));
          const treasuryFeeTinybar = protocolFeeTinybar - Math.floor(protocolFeeTinybar / 2);
          // CAS retry loop: prevent concurrent swaps from losing fee data
          try {
            const FEE_CAS_MAX_RETRIES = 3;
            for (let feeAttempt = 0; feeAttempt < FEE_CAS_MAX_RETRIES; feeAttempt++) {
              const existingFees: TreasuryFeeAccumulator | null = await kv.get(TREASURY_FEE_KEY);
              const prevTotal = existingFees?.totalTinybar || 0;
              const prevCount = existingFees?.swapCount || 0;
              const updated = {
                totalTinybar: prevTotal + treasuryFeeTinybar,
                swapCount: prevCount + 1,
                treasuryAccount: PROTOCOL_TREASURY_ACCOUNT,
                lastUpdated: Date.now(),
              };
              await kv.set(TREASURY_FEE_KEY, updated);
              // Write-verify: re-read to confirm our write persisted
              const verify: TreasuryFeeAccumulator | null = await kv.get(TREASURY_FEE_KEY);
              if (verify && verify.totalTinybar >= updated.totalTinybar && verify.swapCount >= updated.swapCount) {
                break; // Our write stuck (or a later writer incremented further — both are correct)
              }
              // Another writer overwrote between set and verify — retry with fresh read
              if (feeAttempt < FEE_CAS_MAX_RETRIES - 1) {
                await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
              } else {
                console.log(`[Treasury] Fee CAS failed after ${FEE_CAS_MAX_RETRIES} attempts — ${treasuryFeeTinybar}tb may be lost`);
              }
            }
          } catch { /* fee accrual failure is non-critical — swap still succeeds */ }

          // Log swap — global log is anonymized (no accountId).
          const swapTs = Date.now();
          const swapKey = SWAP_LOG_PREFIX + `${swapTs}-${generateTicketId().slice(4, 10).toLowerCase()}`;
          // Global log: trade data only — no wallet identifiers
          const globalRecord = { poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), protocolFeeTinybar, timestamp: swapTs };
          await kv.set(swapKey, globalRecord);
          // Per-user index: capped FIFO for O(1) history reads (10 entries max)
          const userRecord = { poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), protocolFeeTinybar, timestamp: swapTs };
          try {
            const userSwapsKey = USER_SWAPS_PREFIX + accountId;
            const existing: SwapRecord[] = (await kv.get(userSwapsKey)) ?? [];
            existing.push(userRecord);
            while (existing.length > USER_SWAPS_MAX) existing.shift();
            await kv.set(userSwapsKey, existing);
          } catch { /* non-critical */ }
          // Global recent swaps: anonymized, capped, for site activity feed
          try {
            const recentSwaps: SwapRecord[] = (await kv.get(GLOBAL_RECENT_SWAPS_KEY)) ?? [];
            recentSwaps.push({ poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), timestamp: swapTs });
            while (recentSwaps.length > GLOBAL_RECENT_SWAPS_MAX) recentSwaps.shift();
            await kv.set(GLOBAL_RECENT_SWAPS_KEY, recentSwaps);
          } catch { /* non-critical — activity feed is best-effort */ }

          console.log(`[SmartLiquidity] Swap v${expectedVersion}→v${expectedVersion + 1}: ${accountId} ${tokenIn}→${tokenOut} in=${amountInRaw} out=${rawOut} fee=${protocolFeeTinybar}tb`);
          return c.json({
            success: true, amountOut: rawOut.toString(),
            pool: { reserveA: pool.reserveA, reserveB: pool.reserveB, version: pool.version },
            protocolFee: { totalTinybar: protocolFeeTinybar, treasuryTinybar: treasuryFeeTinybar, treasuryAccount: PROTOCOL_TREASURY_ACCOUNT },
          });
        });
      } catch (lockErr: any) {
        if (lockErr?.code === "POOL_BUSY") {
          return c.json({ error: lockErr.message, code: "POOL_BUSY" }, 503);
        }
        throw lockErr;
      }
    })();
    return swapResult;
  } catch (err) {
    console.log("Error in POST /pools/swap:", err);
    return c.json({ error: "Swap failed" }, 500);
  }
});

// GET /pools/swaps/:accountId — Per-user swap history (O(1) index read, rate-limited).
app.get("/make-server-54299934/pools/swaps/:accountId", async (c) => {
  try {
    const accountId = c.req.param("accountId");
    if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);

    // Rate limit: 1 read per 5s per account
    const rateKey = SWAP_HISTORY_RATE_PREFIX + accountId;
    const lastRead: number | null = await kv.get(rateKey);
    if (lastRead && Date.now() - lastRead < SWAP_HISTORY_RATE_TTL_MS) {
      return c.json({ error: "Rate limited — try again in a few seconds" }, 429);
    }
    await kv.set(rateKey, Date.now());

    // O(1) per-account index read — no prefix scan, no fallback
    const userSwapsKey = USER_SWAPS_PREFIX + accountId;
    const userSwaps: SwapRecord[] | null = await kv.get(userSwapsKey);
    if (userSwaps && Array.isArray(userSwaps)) {
      // Newest first, capped to USER_SWAPS_MAX
      const sorted = userSwaps
        .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0))
        .slice(0, USER_SWAPS_MAX);
      return c.json({ swaps: sorted });
    }
    // No history — user either hasn't swapped or swapped before indexing was deployed
    return c.json({ swaps: [] });
  } catch (err) {
    console.log("Error in GET /pools/swaps:", err);
    return c.json({ swaps: [], error: "Failed to fetch swap history" }, 500);
  }
});

// GET /pools/recent-swaps — Public anonymized activity feed (no wallet data).
app.get("/make-server-54299934/pools/recent-swaps", async (c) => {
  try {
    const recentSwaps: SwapRecord[] = (await kv.get(GLOBAL_RECENT_SWAPS_KEY)) ?? [];
    // Newest first
    recentSwaps.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
    return c.json({ swaps: recentSwaps });
  } catch (err) {
    console.log("Error in GET /pools/recent-swaps:", err);
    return c.json({ swaps: [] }, 500);
  }
});

app.get("/make-server-54299934/news", async (c) => {
  try {
    const items = await fetchCryptoNews();
    return c.json({ items });
  } catch (err) {
    console.log("Error fetching news:", err);
    return c.json({ items: [], error: "Failed to fetch news" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// VIP CHAT — Token-gated chat for 100M+ HBAR.ħ holders
// ═══════════════════════════════════════════════════════════════════════
//
// Authenticated via session token. VIP eligibility verified server-side
// against Mirror Node. 2-min cooldown, 25-word limit, 50-msg FIFO cap.
// Admin ops (delete/ban) require SUPABASE_SERVICE_ROLE_KEY.
// ═══════════════════════════════════════════════════════════════════════

const VIP_CHAT_MSGS_KEY = "vip_chat_messages";
const VIP_CHAT_CD_PREFIX = "vip_chat_cd_";
const VIP_CHAT_BANS_KEY = "vip_chat_bans";
const VIP_CHAT_COOLDOWN_MS = 2 * 60 * 1000;
const VIP_CHAT_MAX_MSGS = 50;
const VIP_CHAT_MAX_WORDS = 25;
const VIP_CHAT_MAX_CHARS = 200;
const VIP_HBARH_TOKEN_ID = "0.0.9356476";
const VIP_GATE_THRESHOLD = 100_000_000;
const VIP_NFT_TOKEN_ID = "0.0.10146181";
const VIP_STATUS_CACHE_PREFIX = "vip_status_";
const VIP_STATUS_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute server-side cache

interface VipChatMessage {
  id: string;
  accountId: string;
  text: string;
  timestamp: number;
}

async function verifyVipBalance(accountId: string): Promise<{ eligible: boolean; balance: number }> {
  try {
    const url = `https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/tokens?token.id=${VIP_HBARH_TOKEN_ID}&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { eligible: false, balance: 0 };
    const data = await res.json();
    const entry = data?.tokens?.[0];
    if (!entry) return { eligible: false, balance: 0 };
    const raw = parseInt(entry.balance || "0", 10);
    const dec = parseInt(entry.decimals ?? "8", 10);
    const display = raw / Math.pow(10, dec);
    return { eligible: display >= VIP_GATE_THRESHOLD, balance: display };
  } catch (err) {
    console.log(`[VIP-CHAT] Mirror Node VIP check failed for ${accountId}: ${err}`);
    return { eligible: false, balance: 0 };
  }
}

// ── VIP NFT Ownership Check (Mirror Node) ───────────────────────────

async function verifyVipNftOwnership(accountId: string): Promise<{ hasNft: boolean; nftCount: number }> {
  try {
    const url = `https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/tokens?token.id=${VIP_NFT_TOKEN_ID}&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { hasNft: false, nftCount: 0 };
    const data = await res.json();
    const entry = data?.tokens?.[0];
    if (!entry) return { hasNft: false, nftCount: 0 };
    const count = parseInt(entry.balance || "0", 10);
    return { hasNft: count >= 1, nftCount: count };
  } catch (err) {
    console.log(`[VIP-GATE] Mirror Node NFT check failed for ${accountId}: ${err}`);
    return { hasNft: false, nftCount: 0 };
  }
}

// ── Combined VIP Eligibility (Token OR NFT, cached 5 min) ───────────

interface VipStatusResult {
  eligible: boolean;
  tokenBalance: number;
  nftCount: number;
  verifiedAt: number;
  cached: boolean;
}

async function verifyVipEligibilityFull(accountId: string): Promise<VipStatusResult> {
  // Check KV cache first (5-minute TTL)
  const cacheKey = VIP_STATUS_CACHE_PREFIX + accountId;
  try {
    const cached: VipStatusResult | null = await kv.get(cacheKey);
    if (cached && (Date.now() - cached.verifiedAt) < VIP_STATUS_CACHE_TTL_MS) {
      return { ...cached, cached: true };
    }
  } catch { /* cache miss — verify fresh */ }

  // Parallel Mirror Node checks: token balance + NFT ownership
  const [tokenResult, nftResult] = await Promise.all([
    verifyVipBalance(accountId),
    verifyVipNftOwnership(accountId),
  ]);

  const result: VipStatusResult = {
    eligible: tokenResult.eligible || nftResult.hasNft,
    tokenBalance: tokenResult.balance,
    nftCount: nftResult.nftCount,
    verifiedAt: Date.now(),
    cached: false,
  };

  // Cache the result (only if we got a definitive answer)
  try { await kv.set(cacheKey, result); } catch { /* non-critical */ }

  return result;
}

function generateChatMsgId(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

app.get("/make-server-54299934/vip-chat/messages", async (c) => {
  try {
    const msgs: VipChatMessage[] = (await kv.get(VIP_CHAT_MSGS_KEY)) ?? [];
    return c.json({ messages: msgs });
  } catch (err) {
    console.log(`[VIP-CHAT] Error fetching messages: ${err}`);
    return c.json({ messages: [], error: "Failed to fetch messages" }, 500);
  }
});

app.post("/make-server-54299934/vip-chat/messages", async (c) => {
  try {
    const session = await validateSession(c);
    if (!session) return c.json({ error: "Authentication required — sign in with HashPack" }, 401);
    const { accountId } = session;
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Too many requests" }, 429);
    const bans: string[] = (await kv.get(VIP_CHAT_BANS_KEY)) ?? [];
    if (bans.includes(accountId)) return c.json({ error: "Account suspended" }, 403);
    const cdKey = VIP_CHAT_CD_PREFIX + accountId;
    const lastSent: number | null = await kv.get(cdKey);
    if (lastSent && (Date.now() - lastSent) < VIP_CHAT_COOLDOWN_MS) {
      return c.json({ error: "Cooldown active", cooldownMs: VIP_CHAT_COOLDOWN_MS - (Date.now() - lastSent) }, 429);
    }
    const vipCheck = await verifyVipEligibilityFull(accountId);
    if (!vipCheck.eligible) return c.json({ error: "VIP access requires 100M+ HBAR.ħ tokens or a VIP NFT" }, 403);
    const body = await c.req.json();
    const text = sanitizeString(typeof body.text === "string" ? body.text : "", VIP_CHAT_MAX_CHARS);
    if (!text) return c.json({ error: "Message cannot be empty" }, 400);
    const wc = text.split(/\s+/).filter(Boolean).length;
    if (wc > VIP_CHAT_MAX_WORDS) return c.json({ error: `Exceeds ${VIP_CHAT_MAX_WORDS} word limit` }, 400);
    const msg: VipChatMessage = { id: generateChatMsgId(), accountId, text, timestamp: Date.now() };
    const msgs: VipChatMessage[] = (await kv.get(VIP_CHAT_MSGS_KEY)) ?? [];
    msgs.push(msg);
    while (msgs.length > VIP_CHAT_MAX_MSGS) msgs.shift();
    await kv.set(VIP_CHAT_MSGS_KEY, msgs);
    await kv.set(cdKey, Date.now());
    console.log(`[VIP-CHAT] ${accountId}: "${text}" (${wc}w)`);
    return c.json({ message: msg });
  } catch (err) {
    console.log(`[VIP-CHAT] Send error: ${err}`);
    return c.json({ error: "Failed to send message" }, 500);
  }
});

/** Strict admin auth — requires exact Bearer match against service role key. */
function isAdminAuthorized(c: any): boolean {
  const auth = c.req.header("authorization") || "";
  const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!sk || auth !== `Bearer ${sk}`) {
    const ip = getClientIp(c);
    console.log(`[SECURITY] Unauthorized admin attempt from IP: ${ip}`);
    return false;
  }
  return true;
}

app.delete("/make-server-54299934/vip-chat/messages/:id", async (c) => {
  if (!isAdminAuthorized(c)) return c.json({ error: "Admin access required" }, 403);
  try {
    const id = c.req.param("id");
    const msgs: VipChatMessage[] = (await kv.get(VIP_CHAT_MSGS_KEY)) ?? [];
    const filtered = msgs.filter(m => m.id !== id);
    if (filtered.length === msgs.length) return c.json({ error: "Not found" }, 404);
    await kv.set(VIP_CHAT_MSGS_KEY, filtered);
    console.log(`[VIP-CHAT][ADMIN] Deleted ${id}`);
    return c.json({ ok: true });
  } catch { return c.json({ error: "Delete failed" }, 500); }
});

app.post("/make-server-54299934/vip-chat/ban", async (c) => {
  if (!isAdminAuthorized(c)) return c.json({ error: "Admin access required" }, 403);
  try {
    const { accountId, action } = await c.req.json();
    if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid account" }, 400);
    const bans: string[] = (await kv.get(VIP_CHAT_BANS_KEY)) ?? [];
    if (action === "ban" && !bans.includes(accountId)) {
      bans.push(accountId);
      const msgs: VipChatMessage[] = (await kv.get(VIP_CHAT_MSGS_KEY)) ?? [];
      await kv.set(VIP_CHAT_MSGS_KEY, msgs.filter(m => m.accountId !== accountId));
    } else if (action === "unban") {
      const idx = bans.indexOf(accountId);
      if (idx !== -1) bans.splice(idx, 1);
    }
    await kv.set(VIP_CHAT_BANS_KEY, bans);
    console.log(`[VIP-CHAT][ADMIN] ${action} ${accountId}`);
    return c.json({ ok: true, bans });
  } catch { return c.json({ error: "Ban operation failed" }, 500); }
});

app.delete("/make-server-54299934/vip-chat/messages", async (c) => {
  if (!isAdminAuthorized(c)) return c.json({ error: "Admin access required" }, 403);
  try {
    await kv.set(VIP_CHAT_MSGS_KEY, []);
    console.log("[VIP-CHAT][ADMIN] Cleared all messages");
    return c.json({ ok: true });
  } catch { return c.json({ error: "Clear failed" }, 500); }
});

// ═══════════════════════════════════════════════════════════════════════
// VIP STATUS — Authenticated eligibility check (token + NFT, fail-closed)
// ═══════════════════════════════════════════════════════════════════════

app.get("/make-server-54299934/vip/status", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;

    const status = await verifyVipEligibilityFull(accountId);

    console.log(`[VIP-GATE] Status check: ${accountId} eligible=${status.eligible} balance=${status.tokenBalance} nfts=${status.nftCount} cached=${status.cached}`);

    return c.json({
      eligible: status.eligible,
      tokenBalance: status.tokenBalance,
      nftCount: status.nftCount,
      verifiedAt: status.verifiedAt,
      cached: status.cached,
      accountId,
    });
  } catch (err) {
    console.log(`[VIP-GATE] Status check error: ${err}`);
    return c.json({ eligible: false, error: "VIP verification failed" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// DAO GOVERNANCE — Server-Authoritative Proposals, Votes & Comments
// ═══════════════════════════════════════════════════════════════════════
//
// All state in KV (dao_proposals). Admin CRUD restricted to 0.0.518487
// + dynamic admin list. Vote weight from Mirror Node balance (server-side).
// Deduplication via voterLog. Inputs sanitized, rate-limited, fail-closed.
// Caps: 100 proposals, 200 comments per proposal.
//
// ═══════════════════════════════════════════════════════════════════════

const DAO_PROPOSALS_KEY = "dao_proposals";
const DAO_MAX_PROPOSALS = 100;
const DAO_MAX_COMMENTS_PER_PROPOSAL = 200;

// ── Dynamic Admin List (KV-backed) ─────────────────────────────────
// Founder permanently protected. Add/remove requires fresh session (<2 min).
const DAO_ADMINS_KEY = "dao_admin_accounts";
const DAO_FOUNDER_ACCOUNT = "0.0.518487";
const DAO_MAX_ADMINS = 10;
const DAO_ADMIN_FRESH_SESSION_MS = 2 * 60 * 1000; // session must be <2 min old

async function loadDaoAdmins(): Promise<string[]> {
  try {
    const stored: string[] | null = await kv.get(DAO_ADMINS_KEY);
    if (!stored || !Array.isArray(stored)) return [DAO_FOUNDER_ACCOUNT];
    if (!stored.includes(DAO_FOUNDER_ACCOUNT)) stored.unshift(DAO_FOUNDER_ACCOUNT);
    return stored;
  } catch { return [DAO_FOUNDER_ACCOUNT]; }
}

async function saveDaoAdminList(admins: string[]): Promise<void> {
  if (!admins.includes(DAO_FOUNDER_ACCOUNT)) admins.unshift(DAO_FOUNDER_ACCOUNT);
  await kv.set(DAO_ADMINS_KEY, admins);
  _adminCache = null; // bust cache
}

let _adminCache: { list: string[]; ts: number } | null = null;
const ADMIN_CACHE_TTL_MS = 30_000;

async function getDaoAdminsCached(): Promise<string[]> {
  if (_adminCache && Date.now() - _adminCache.ts < ADMIN_CACHE_TTL_MS) return _adminCache.list;
  const admins = await loadDaoAdmins();
  _adminCache = { list: admins, ts: Date.now() };
  return admins;
}

async function isDaoAdminAsync(accountId: string): Promise<boolean> {
  return (await getDaoAdminsCached()).includes(accountId);
}

/** Require a "fresh" session (created <2 min ago) for admin management ops */
async function requireFreshAdminAuth(c: any): Promise<{ accountId: string } | Response> {
  const token = c.req.header("x-session-token") || "";
  if (!token || token.length < 32) return c.json({ error: "Authentication required — sign a fresh challenge", code: "AUTH_REQUIRED" }, 401);
  try {
    const session: AuthSession | null = await kv.get(AUTH_SESSION_PREFIX + token);
    if (!session) return c.json({ error: "Session expired — re-sign in wallet", code: "SESSION_EXPIRED" }, 401);
    if (Date.now() > session.expiresAt) { kv.del(AUTH_SESSION_PREFIX + token).catch(() => {}); return c.json({ error: "Session expired", code: "SESSION_EXPIRED" }, 401); }
    const age = Date.now() - session.createdAt;
    if (age > DAO_ADMIN_FRESH_SESSION_MS) {
      return c.json({ error: "Admin operations require a fresh wallet signature. Please re-sign to confirm.", code: "SESSION_NOT_FRESH", sessionAgeMs: age, maxAgeMs: DAO_ADMIN_FRESH_SESSION_MS }, 403);
    }
    return { accountId: session.accountId };
  } catch { return c.json({ error: "Authentication failed" }, 401); }
}

const DAO_TOKENS_PER_VOTE = 100_000_000;
const DAO_MAX_TOKEN_VOTES = 10;
const DAO_NFTS_PER_VOTE = 3;
const DAO_MAX_NFT_VOTES = 1;

type DAOProposalStatus = "active" | "passed" | "rejected" | "pending";
type DAOProposalCategory = "Fees" | "Staking" | "Listing" | "Tokenomics" | "Features" | "Partnership" | "Governance" | "Other";
const DAO_VALID_CATEGORIES: DAOProposalCategory[] = ["Fees", "Staking", "Listing", "Tokenomics", "Features", "Partnership", "Governance", "Other"];

interface DAOComment { id: string; author: string; text: string; createdAt: number; }

interface DAOProposal {
  id: string; title: string; description: string; category: DAOProposalCategory;
  proposer: string; status: DAOProposalStatus; votesFor: number; votesAgainst: number;
  quorum: number; createdAt: number; endsAt: number;
  voterLog: Record<string, { direction: "for" | "against"; weight: number }>;
  comments: DAOComment[];
}

function canModifyDaoProposal(p: DAOProposal, acct: string, adminList: string[]): boolean {
  if (p.status !== "active" && p.status !== "pending") return false;
  if (adminList.includes(acct)) return true;
  if (p.proposer === acct && Object.keys(p.voterLog).length === 0) return true;
  return false;
}

function resolveExpiredProposal(p: DAOProposal): DAOProposal {
  if (p.status !== "active" && p.status !== "pending") return p;
  if (Date.now() < p.endsAt) return p;
  const total = p.votesFor + p.votesAgainst;
  return { ...p, status: (total >= p.quorum && p.votesFor > p.votesAgainst) ? "passed" : "rejected" };
}

function calculateVotingPower(tokenBalance: number, nftCount: number): number {
  return Math.min(Math.floor(tokenBalance / DAO_TOKENS_PER_VOTE), DAO_MAX_TOKEN_VOTES)
       + Math.min(Math.floor(nftCount / DAO_NFTS_PER_VOTE), DAO_MAX_NFT_VOTES);
}

async function loadDaoProposals(): Promise<DAOProposal[]> {
  try {
    const p: DAOProposal[] | null = await kv.get(DAO_PROPOSALS_KEY);
    if (!p || !Array.isArray(p)) return [];
    return p.map(resolveExpiredProposal);
  } catch { return []; }
}
async function saveDaoProposals(proposals: DAOProposal[]): Promise<void> { await kv.set(DAO_PROPOSALS_KEY, proposals); }

// GET /dao/proposals — Public read
app.get("/make-server-54299934/dao/proposals", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    return c.json({ proposals: await loadDaoProposals() });
  } catch (err) {
    console.log(`[DAO] Error loading proposals: ${err}`);
    return c.json({ proposals: [], error: "Failed to load proposals" }, 500);
  }
});

// POST /dao/proposals — Admin-only create
app.post("/make-server-54299934/dao/proposals", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;
    if (!(await isDaoAdminAsync(accountId))) {
      console.log(`[DAO] Non-admin proposal creation attempt: ${accountId}`);
      return c.json({ error: "Only DAO admins can create proposals", code: "DAO_NOT_ADMIN" }, 403);
    }
    const body = await c.req.json();
    const { title, description, category, durationDays, quorum } = body;
    if (!title || typeof title !== "string" || title.trim().length < 5) return c.json({ error: "Title must be at least 5 characters" }, 400);
    if (!description || typeof description !== "string" || description.trim().length < 20) return c.json({ error: "Description must be at least 20 characters" }, 400);
    if (!category || !DAO_VALID_CATEGORIES.includes(category)) return c.json({ error: "Invalid category" }, 400);
    const days = Number(durationDays);
    if (!days || days < 1 || days > 30) return c.json({ error: "Duration must be 1-30 days" }, 400);
    const q = Number(quorum);
    if (!q || q < 1 || q > 10000) return c.json({ error: "Quorum must be 1-10000" }, 400);
    const proposals = await loadDaoProposals();
    if (proposals.length >= DAO_MAX_PROPOSALS) return c.json({ error: `Maximum ${DAO_MAX_PROPOSALS} proposals reached` }, 400);
    const idBuf = new Uint8Array(4);
    crypto.getRandomValues(idBuf);
    const idHex = Array.from(idBuf).map(b => b.toString(16).padStart(2, "0")).join("");
    const now = Date.now();
    const newP: DAOProposal = {
      id: `prop-${idHex}`, title: sanitizeString(title.trim(), 120), description: sanitizeString(description.trim(), 2000),
      category, proposer: accountId, status: "active", votesFor: 0, votesAgainst: 0, quorum: q,
      createdAt: now, endsAt: now + days * 86_400_000, voterLog: {}, comments: [],
    };
    const updated = [newP, ...proposals];
    await saveDaoProposals(updated);
    console.log(`[DAO] Proposal created by admin ${accountId}: ${newP.id} "${newP.title}"`);
    return c.json({ proposal: newP, proposals: updated });
  } catch (err) {
    console.log(`[DAO] Error creating proposal: ${err}`);
    return c.json({ error: "Failed to create proposal" }, 500);
  }
});

// PUT /dao/proposals/:id — Admin/proposer edit
app.put("/make-server-54299934/dao/proposals/:id", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;
    const proposalId = c.req.param("id");
    if (!proposalId) return c.json({ error: "Missing proposal ID" }, 400);
    const body = await c.req.json();
    const { title, description, category } = body;
    const [proposals, adminList] = await Promise.all([loadDaoProposals(), getDaoAdminsCached()]);
    const idx = proposals.findIndex(p => p.id === proposalId);
    if (idx === -1) return c.json({ error: "Proposal not found" }, 404);
    if (!canModifyDaoProposal(proposals[idx], accountId, adminList)) {
      console.log(`[DAO] Unauthorized edit attempt: ${accountId} on ${proposalId}`);
      return c.json({ error: "Not authorized to edit this proposal" }, 403);
    }
    const updated = [...proposals];
    updated[idx] = {
      ...proposals[idx],
      title: (title && typeof title === "string" && title.trim().length >= 5) ? sanitizeString(title.trim(), 120) : proposals[idx].title,
      description: (description && typeof description === "string" && description.trim().length >= 20) ? sanitizeString(description.trim(), 2000) : proposals[idx].description,
      category: (category && DAO_VALID_CATEGORIES.includes(category)) ? category : proposals[idx].category,
    };
    await saveDaoProposals(updated);
    console.log(`[DAO] Proposal edited by ${accountId}: ${proposalId}`);
    return c.json({ proposal: updated[idx], proposals: updated });
  } catch (err) {
    console.log(`[DAO] Error editing proposal: ${err}`);
    return c.json({ error: "Failed to edit proposal" }, 500);
  }
});

// DELETE /dao/proposals/:id — Admin/proposer delete
app.delete("/make-server-54299934/dao/proposals/:id", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;
    const proposalId = c.req.param("id");
    if (!proposalId) return c.json({ error: "Missing proposal ID" }, 400);
    const [proposals, adminList] = await Promise.all([loadDaoProposals(), getDaoAdminsCached()]);
    const idx = proposals.findIndex(p => p.id === proposalId);
    if (idx === -1) return c.json({ error: "Proposal not found" }, 404);
    if (!canModifyDaoProposal(proposals[idx], accountId, adminList)) {
      console.log(`[DAO] Unauthorized delete attempt: ${accountId} on ${proposalId}`);
      return c.json({ error: "Not authorized to delete this proposal" }, 403);
    }
    const updated = proposals.filter(p => p.id !== proposalId);
    await saveDaoProposals(updated);
    console.log(`[DAO] Proposal deleted by ${accountId}: ${proposalId}`);
    return c.json({ success: true, proposals: updated });
  } catch (err) {
    console.log(`[DAO] Error deleting proposal: ${err}`);
    return c.json({ error: "Failed to delete proposal" }, 500);
  }
});

// POST /dao/proposals/:id/vote — Authenticated + eligible, weight from Mirror Node
app.post("/make-server-54299934/dao/proposals/:id/vote", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;
    const proposalId = c.req.param("id");
    if (!proposalId) return c.json({ error: "Missing proposal ID" }, 400);
    const body = await c.req.json();
    const { direction } = body;
    if (direction !== "for" && direction !== "against") return c.json({ error: "Direction must be 'for' or 'against'" }, 400);
    const vipStatus = await verifyVipEligibilityFull(accountId);
    if (!vipStatus.eligible) {
      console.log(`[DAO] Ineligible vote attempt: ${accountId} balance=${vipStatus.tokenBalance} nfts=${vipStatus.nftCount}`);
      return c.json({ error: "Insufficient holdings. Need 100M HBAR.ħ or 1 VIP NFT to vote.", code: "DAO_INELIGIBLE" }, 403);
    }
    const weight = calculateVotingPower(vipStatus.tokenBalance, vipStatus.nftCount);
    if (weight <= 0) return c.json({ error: "Insufficient balance for any voting power" }, 403);
    const proposals = await loadDaoProposals();
    const idx = proposals.findIndex(p => p.id === proposalId);
    if (idx === -1) return c.json({ error: "Proposal not found" }, 404);
    const proposal = proposals[idx];
    if (proposal.status !== "active" && proposal.status !== "pending") return c.json({ error: "Voting is closed on this proposal" }, 400);
    if (Date.now() >= proposal.endsAt) return c.json({ error: "Voting period has ended" }, 400);
    if (proposal.voterLog[accountId]) {
      return c.json({ error: "You have already voted on this proposal", code: "DAO_ALREADY_VOTED", existingVote: proposal.voterLog[accountId] }, 409);
    }
    const updated = [...proposals];
    updated[idx] = {
      ...proposal,
      voterLog: { ...proposal.voterLog, [accountId]: { direction, weight } },
      votesFor: direction === "for" ? proposal.votesFor + weight : proposal.votesFor,
      votesAgainst: direction === "against" ? proposal.votesAgainst + weight : proposal.votesAgainst,
    };
    await saveDaoProposals(updated);
    console.log(`[DAO] Vote: ${accountId} voted ${direction} (weight=${weight}) on ${proposalId}`);
    return c.json({ success: true, proposal: updated[idx], votingPower: weight, tokenBalance: vipStatus.tokenBalance, nftCount: vipStatus.nftCount });
  } catch (err) {
    console.log(`[DAO] Error casting vote: ${err}`);
    return c.json({ error: "Failed to cast vote" }, 500);
  }
});

// POST /dao/proposals/:id/comment — Authenticated + eligible comment
app.post("/make-server-54299934/dao/proposals/:id/comment", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;
    const proposalId = c.req.param("id");
    if (!proposalId) return c.json({ error: "Missing proposal ID" }, 400);
    const vipStatus = await verifyVipEligibilityFull(accountId);
    if (!vipStatus.eligible) return c.json({ error: "Hold HBAR.ħ tokens or VIP NFTs to comment", code: "DAO_INELIGIBLE" }, 403);
    const body = await c.req.json();
    const { text } = body;
    if (!text || typeof text !== "string" || !text.trim()) return c.json({ error: "Comment text is required" }, 400);
    const proposals = await loadDaoProposals();
    const idx = proposals.findIndex(p => p.id === proposalId);
    if (idx === -1) return c.json({ error: "Proposal not found" }, 404);
    if ((proposals[idx].comments?.length ?? 0) >= DAO_MAX_COMMENTS_PER_PROPOSAL) {
      return c.json({ error: `Maximum ${DAO_MAX_COMMENTS_PER_PROPOSAL} comments per proposal` }, 400);
    }
    const cmtBuf = new Uint8Array(3);
    crypto.getRandomValues(cmtBuf);
    const cmtHex = Array.from(cmtBuf).map(b => b.toString(16).padStart(2, "0")).join("");
    const comment: DAOComment = { id: `cmt-${Date.now().toString(36)}-${cmtHex}`, author: accountId, text: sanitizeString(text.trim(), 500), createdAt: Date.now() };
    const updated = [...proposals];
    updated[idx] = { ...proposals[idx], comments: [...(proposals[idx].comments ?? []), comment] };
    await saveDaoProposals(updated);
    console.log(`[DAO] Comment by ${accountId} on ${proposalId}: "${comment.text.slice(0, 50)}"`);
    return c.json({ success: true, comment, proposal: updated[idx] });
  } catch (err) {
    console.log(`[DAO] Error adding comment: ${err}`);
    return c.json({ error: "Failed to add comment" }, 500);
  }
});

// GET /dao/voting-power — Authenticated: server-verified voting power
app.get("/make-server-54299934/dao/voting-power", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;
    const vipStatus = await verifyVipEligibilityFull(accountId);
    const votingPower = calculateVotingPower(vipStatus.tokenBalance, vipStatus.nftCount);
    const isAdmin = await isDaoAdminAsync(accountId);
    return c.json({ accountId, eligible: vipStatus.eligible, tokenBalance: vipStatus.tokenBalance, nftCount: vipStatus.nftCount, votingPower, isAdmin, verifiedAt: vipStatus.verifiedAt, cached: vipStatus.cached });
  } catch (err) {
    console.log(`[DAO] Error fetching voting power: ${err}`);
    return c.json({ error: "Failed to fetch voting power" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// DAO ADMIN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════
//
// Admin-only add/remove with fresh-session (<2 min) enforcement.
// Founder (0.0.518487) permanently protected. Max 10 admins.
// ═══════════════════════════════════════════════════════════════════════

// GET /dao/admins — Admin-only: list current admins
app.get("/make-server-54299934/dao/admins", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;
    if (!(await isDaoAdminAsync(accountId))) {
      return c.json({ error: "Only DAO admins can view admin list", code: "DAO_NOT_ADMIN" }, 403);
    }
    const admins = await loadDaoAdmins();
    return c.json({ admins, founder: DAO_FOUNDER_ACCOUNT, maxAdmins: DAO_MAX_ADMINS });
  } catch (err) {
    console.log(`[DAO-ADMIN] Error listing admins: ${err}`);
    return c.json({ error: "Failed to load admin list" }, 500);
  }
});

// POST /dao/admins — Admin-only: add a new admin (requires FRESH session)
app.post("/make-server-54299934/dao/admins", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const auth = await requireFreshAdminAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;
    if (!(await isDaoAdminAsync(accountId))) {
      console.log(`[DAO-ADMIN] Non-admin add attempt: ${accountId}`);
      return c.json({ error: "Only DAO admins can add admins", code: "DAO_NOT_ADMIN" }, 403);
    }
    const body = await c.req.json();
    const { newAdminAccountId } = body;
    if (!newAdminAccountId || typeof newAdminAccountId !== "string") {
      return c.json({ error: "Missing newAdminAccountId" }, 400);
    }
    if (!isValidHederaAccountId(newAdminAccountId)) {
      return c.json({ error: "Invalid Hedera account ID format (expected 0.0.xxxxx)" }, 400);
    }
    const admins = await loadDaoAdmins();
    if (admins.includes(newAdminAccountId)) {
      return c.json({ error: "Account is already an admin" }, 409);
    }
    if (admins.length >= DAO_MAX_ADMINS) {
      return c.json({ error: `Maximum ${DAO_MAX_ADMINS} admins allowed` }, 400);
    }
    admins.push(newAdminAccountId);
    await saveDaoAdminList(admins);
    console.log(`[DAO-ADMIN] Admin added by ${accountId}: ${newAdminAccountId} (total: ${admins.length})`);
    return c.json({ success: true, admins, addedBy: accountId });
  } catch (err) {
    console.log(`[DAO-ADMIN] Error adding admin: ${err}`);
    return c.json({ error: "Failed to add admin" }, 500);
  }
});

// DELETE /dao/admins/:accountId — Admin-only: remove an admin (requires FRESH session)
app.delete("/make-server-54299934/dao/admins/:accountId", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);
    const auth = await requireFreshAdminAuth(c);
    if (auth instanceof Response) return auth;
    const { accountId } = auth;
    if (!(await isDaoAdminAsync(accountId))) {
      return c.json({ error: "Only DAO admins can remove admins", code: "DAO_NOT_ADMIN" }, 403);
    }
    const targetAccountId = c.req.param("accountId");
    if (!targetAccountId || !isValidHederaAccountId(targetAccountId)) {
      return c.json({ error: "Invalid target account ID" }, 400);
    }
    if (targetAccountId === DAO_FOUNDER_ACCOUNT) {
      console.log(`[DAO-ADMIN] Attempted removal of founder by ${accountId} — DENIED`);
      return c.json({ error: "The founder admin (0.0.518487) cannot be removed", code: "FOUNDER_PROTECTED" }, 403);
    }
    const admins = await loadDaoAdmins();
    if (!admins.includes(targetAccountId)) {
      return c.json({ error: "Account is not an admin" }, 404);
    }
    const updated = admins.filter(a => a !== targetAccountId);
    await saveDaoAdminList(updated);
    console.log(`[DAO-ADMIN] Admin removed by ${accountId}: ${targetAccountId} (remaining: ${updated.length})`);
    return c.json({ success: true, admins: updated, removedBy: accountId });
  } catch (err) {
    console.log(`[DAO-ADMIN] Error removing admin: ${err}`);
    return c.json({ error: "Failed to remove admin" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Holiday Logos — lists files from Supabase Storage (auto-creates bucket)
// Checks: make-54299934-holiday-logos (preferred) → "Holiday Wrapp Logos" (legacy)
// ═══════════════════════════════════════════════════════════════════════

const HOLIDAY_BUCKET = "make-54299934-holiday-logos";
const HOLIDAY_BUCKET_LEGACY = "Holiday Wrapp Logos";
const HOLIDAY_SIGNED_URL_TTL = 3600; // 1 hour

app.get("/make-server-54299934/holiday-logos", async (c) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.log("[Holiday Logos] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return c.json({ error: "Server configuration error" }, 500);
    }

    const supabase = createSupabaseClient(supabaseUrl, serviceKey);

    // ── Idempotent bucket creation ─────────────────────────────────
    const { data: buckets, error: listBucketsErr } = await supabase.storage.listBuckets();
    if (listBucketsErr) {
      console.log(`[Holiday Logos] Failed to list buckets: ${listBucketsErr.message}`);
      return c.json({ error: `Failed to list buckets: ${listBucketsErr.message}` }, 502);
    }

    // Determine which bucket to use — prefer the prefixed one, fall back to legacy
    let activeBucket: string | null = null;
    const hasPrefixed = buckets?.some((b: any) => b.name === HOLIDAY_BUCKET);
    const hasLegacy = buckets?.some((b: any) => b.name === HOLIDAY_BUCKET_LEGACY);

    if (hasPrefixed) {
      activeBucket = HOLIDAY_BUCKET;
    } else if (hasLegacy) {
      activeBucket = HOLIDAY_BUCKET_LEGACY;
    } else {
      // Create the standard bucket (public so <img> tags can load directly)
      console.log(`[Holiday Logos] No bucket found — creating "${HOLIDAY_BUCKET}" (public)`);
      const { error: createErr } = await supabase.storage.createBucket(HOLIDAY_BUCKET, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024, // 5 MB
      });
      if (createErr) {
        console.log(`[Holiday Logos] Bucket creation failed: ${createErr.message}`);
        return c.json({
          error: `Bucket creation failed: ${createErr.message}`,
          hint: `Upload a valentine logo to the "${HOLIDAY_BUCKET}" bucket in your Supabase dashboard.`,
        }, 502);
      }
      activeBucket = HOLIDAY_BUCKET;
    }

    console.log(`[Holiday Logos] Using bucket: "${activeBucket}"`);

    // ── List files ─────────────────────────────────────────────────
    const { data: files, error: listErr } = await supabase.storage
      .from(activeBucket)
      .list("", { limit: 200, sortBy: { column: "name", order: "asc" } });

    if (listErr) {
      console.log(`[Holiday Logos] File list failed on "${activeBucket}": ${listErr.message}`);
      return c.json({ error: `File list failed: ${listErr.message}`, bucket: activeBucket }, 502);
    }

    const realFiles = (files || []).filter(
      (f: any) => f.name && !f.name.endsWith("/") && f.id,
    );

    console.log(`[Holiday Logos] Found ${realFiles.length} file(s) in "${activeBucket}": [${realFiles.map((f: any) => f.name).join(", ")}]`);

    if (realFiles.length === 0) {
      return c.json({ logos: [], bucket: activeBucket });
    }

    // ── Build signed URLs (works for both public & private buckets) ─
    const { data: signedUrls, error: signErr } = await supabase.storage
      .from(activeBucket)
      .createSignedUrls(
        realFiles.map((f: any) => f.name),
        HOLIDAY_SIGNED_URL_TTL,
      );

    if (signErr) {
      console.log(`[Holiday Logos] Signed URL generation failed: ${signErr.message}`);
      // Fallback: build public URLs directly
      const publicBase = `${supabaseUrl}/storage/v1/object/public/${activeBucket}`;
      const logos = realFiles.map((f: any) => ({
        name: f.name,
        url: `${publicBase}/${encodeURIComponent(f.name)}`,
      }));
      return c.json({ logos, bucket: activeBucket, urlType: "public-fallback" });
    }

    const logos = (signedUrls || [])
      .filter((s: any) => !s.error)
      .map((s: any) => ({
        name: realFiles.find((f: any) => f.name === s.path)?.name || s.path,
        url: s.signedUrl,
      }));

    return c.json({ logos, bucket: activeBucket, urlType: "signed" });
  } catch (err) {
    console.log(`[Holiday Logos] Unexpected error: ${err}`);
    return c.json({ error: `Unexpected error: ${String(err)}` }, 500);
  }
});

Deno.serve(app.fetch);
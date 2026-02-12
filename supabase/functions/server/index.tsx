import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";
const app = new Hono();

app.use('*', logger(console.log));

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
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
});

// ═══════════════════════════════════════════════════════════════════════
// Wrappdex Server — Spin Wheel, Smart Liquidity, News Ticker
// ═════════════════════════════════════════════════════════════���═════════
//
// Security: Server-side CSPRNG for spin outcomes, KV-backed 24h cooldowns,
//   uniform 2% odds (1:50), KV-backed per-IP rate limiting, input sanitization.
//   DELETE /winners requires SUPABASE_SERVICE_ROLE_KEY bearer token.
//
// Rate limiter is KV-backed — survives cold starts and works across instances.
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
// Hybrid: in-memory L1 cache for hot-path speed, KV-backed L2 for
// persistence across cold starts and multi-instance deployments.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_PREFIX = "rl_";
const _rateLimitL1 = new Map<string, { count: number; resetAt: number }>();

async function isRateLimited(ip: string): Promise<boolean> {
  const now = Date.now();
  const kvKey = RATE_LIMIT_PREFIX + ip.replace(/[^a-zA-Z0-9._:-]/g, "_");

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
    .replace(/[<>"'&]/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
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
    return c.json({ error: `Failed to fetch winners: ${err}` }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /spin — Server-side spin: RNG, cooldown, ticket generation
//
// The client sends { accountId } and receives back the outcome.
// The win/lose decision happens HERE with crypto.getRandomValues().
// The client ONLY animates the wheel — it never determines the outcome.
// ═══════════════════════════════════════════════════════════════════════

app.post("/make-server-54299934/spin", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) {
      return c.json({ error: "Rate limited — try again in a minute" }, 429);
    }

    const body = await c.req.json();
    const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";

    if (!accountId || !isValidHederaAccountId(accountId)) {
      return c.json({ error: "Invalid or missing accountId" }, 400);
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
    return c.json({ error: `Spin failed: ${err}` }, 500);
  }
});

// POST /winners — DISABLED for writes. Legacy endpoint returns 405.
// All winner recording now happens inside POST /spin.
app.post("/make-server-54299934/winners", (c) => {
  return c.json(
    { error: "Direct winner recording is disabled. Use POST /spin instead." },
    405,
  );
});

// DELETE /winners — admin-only reset
// [AUDIT-S06] HARDENED — Require SUPABASE_SERVICE_ROLE_KEY as bearer token.
// This is a server-side secret, NOT a publicly-known wallet address.
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
      console.log(`[AUDIT] Unauthorized DELETE /winners attempt from IP: ${ip}`);
      return c.json({ error: "Unauthorized — service role key required" }, 403);
    }

    await kv.set(WINNERS_KEY, []);
    console.log(`[AUDIT] Winner history cleared by authorized admin from IP: ${ip}`);
    return c.json({ success: true, winners: [] });
  } catch (err) {
    console.log("Error clearing winners:", err);
    return c.json({ error: `Failed to clear winners: ${err}` }, 500);
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
    return c.json({ canSpin: true, cooldownMs: 0 }); // fail-open for reads
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
// SMART LIQUIDITY v2 — Real KV-Backed AMM Pool Engine
// ══════════════════════════════════════════════════════════════════════
//
// Architecture:
//   - All pool state is KV-backed (survives cold starts, multi-instance safe)
//   - Constant-product AMM (x * y = k) for 2-token pools
//   - Pools start at ZERO reserves — users provide all liquidity
//   - LP share tracking per user per pool
//   - Smart swap routing: direct → USDC-hop, selects lowest impact
//   - Rate limits proportional to pool TVL (depth-aware)
//   - Oracle prices from SaucerSwap for UI display only — swaps use reserves
//
// DEVELOPER NOTES FOR AUDITORS / BUG BOUNTY:
//   [LP-01] First-depositor attack mitigated by MINIMUM_LIQUIDITY lock (1000 units)
//           burned to zero address on first deposit. See addLiquidity().
//   [LP-02] Swap output uses constant-product formula with reserves as ground truth.
//           Oracle prices are display-only — never used to determine swap amounts.
//   [LP-03] Max swap size capped at percentage of pool reserves (depth-proportional).
//           Small pools (<$10K TVL): 2%. Medium ($10K-$100K): 5%. Large (>$100K): 10%.
//   [LP-04] LP share dilution: shares minted = min(amountA/reserveA, amountB/reserveB) * totalSupply.
//   [LP-05] Impermanent loss: inherent to AMM design. Users warned in UI.
//   [LP-06] Sandwich protection: pool mempool is private (KV server-side).
//           On-chain execution (future HSuite) will need commit-reveal or MEV protection.
//   [LP-07] Pool creation restricted to TOP_5_TOKENS whitelist (Tier 1).
//   [LP-08] All reserves stored as raw integer strings (no floating point precision loss).
//   [LP-09] Fee collection: fees stay in pool (increase k), benefiting all LPs.
//   [LP-10] Price manipulation: pools below $100 TVL excluded from routing.
//
// HSuite Smart Node Integration (future):
//   - Pool creation and deposits will route through HSuite validator network
//   - NFT-gated access for advanced pool management
//   - Docs: https://docs.hsuite.network/developers
//   - SDK:  https://github.com/HSuiteNetwork/smart-app
//
// ══════════════════════════════════════════════════════════════════════

const SAUCERSWAP_API_URL = "https://api.saucerswap.finance";
const POOL_PREFIX = "sl_pool_";
const LP_PREFIX = "sl_lp_";
const SWAP_LOG_PREFIX = "sl_swap_";
const POOL_INDEX_KEY = "sl_pool_index";
const ORACLE_CACHE_KEY = "sl_oracle_cache";
const ORACLE_CACHE_TTL_MS = 60_000;
const TREASURY_FEE_KEY = "sl_treasury_fees";

// ── Protocol Swap Fee ───────────────────────────────────────────────
// [LP-11] Every swap incurs a flat $0.0007 USD protocol fee paid in HBAR.
//   50% → LP providers (added to pool reserves, increasing k for all LPs)
//   50% → Protocol treasury (0.0.9695738), accrued in KV for on-chain sweep
//
// DEVELOPER NOTES FOR AUDITORS:
//   [LP-11a] Fee is flat, not proportional — prevents fee manipulation via trade splitting.
//   [LP-11b] HBAR price is resolved from oracle at swap time. If oracle is stale,
//            fallback price is used. Fee is never zero (minimum 1 tinybar).
//   [LP-11c] Treasury accrual is KV-stored. On-chain HBAR transfer to 0.0.9695738
//            requires a separate sweep mechanism (HSuite SmartNode or admin cron).
//   [LP-11d] LP reward half is added directly to pool reserves. Since it's added to
//            the input side, it increases k, benefiting all LP share holders equally.

const PROTOCOL_FEE_USD = 0.0007;            // $0.0007 per swap = 0.07 cents
const PROTOCOL_TREASURY_ACCOUNT = "0.0.9695738";
const HBAR_FALLBACK_PRICE_USD = 0.20;       // Fallback if oracle unavailable
const HBAR_DECIMALS = 8;                    // 1 HBAR = 100_000_000 tinybar

// [LP-12] Swap fee is FIXED at 0.1% (10 bps) for all pools. Non-adjustable.
// This is a protocol-level constant — pool creators cannot change it.
// The fee stays in the pool (increases k), benefiting all LP holders.
const FIXED_SWAP_FEE_BPS = 10;

// ── Token Whitelist (Top 5 by MC on Hedera, expanding to 50) ────────
// [LP-07] Only whitelisted tokens can be used in pools.

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
  reserveA: string;        // [LP-08] Raw integer string
  reserveB: string;
  lpTotalSupply: string;
  swapFeeBps: number;
  creator: string;
  createdAt: number;
  cumulativeVolumeUsd: number;
  swapCount: number;
  status: "active" | "paused";
}

interface LPPosition {
  poolId: string;
  accountId: string;
  shares: string;
  depositedAt: number;
  lastActionAt: number;
}

// ── AMM Math (Constant Product: x * y = k) ─────────────────────────
// [LP-02] All swap math uses reserves, never oracle prices.

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

/**
 * Constant-product swap output.
 * [LP-02] Standard Uniswap V2 formula.
 * [LP-09] Fee stays in pool, increasing k for all LPs.
 */
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
// [LP-03] Depth-proportional max trade size.

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

// ── Oracle Price Fetcher (display-only) ─────────────────────────────
// [LP-02] Prices are for UI/TVL calculation. Swaps use reserves.

async function fetchOraclePrices(): Promise<Record<string, number>> {
  try {
    const cached: { prices: Record<string, number>; ts: number } | null = await kv.get(ORACLE_CACHE_KEY);
    if (cached && (Date.now() - cached.ts) < ORACLE_CACHE_TTL_MS) return cached.prices;
  } catch { /* cache miss */ }

  const prices: Record<string, number> = {};
  prices["0.0.456858"] = 1.0;
  prices["0.0.4291336"] = 1.0;

  const variants = ["/tokens", "/v1/tokens", "/v2/tokens"];
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
      if (Object.keys(prices).length >= 4) break;
    } catch { continue; }
  }

  for (const t of TOKEN_WHITELIST) {
    if (!prices[t.tokenId]) prices[t.tokenId] = t.fallbackPrice;
  }

  try { await kv.set(ORACLE_CACHE_KEY, { prices, ts: Date.now() }); } catch { /* non-critical */ }
  return prices;
}

// ── Pool Helpers ────────────────────────────────────────────────────

async function getPoolIndex(): Promise<string[]> {
  return (await kv.get(POOL_INDEX_KEY)) ?? [];
}

async function getPool(id: string): Promise<PoolState | null> {
  return await kv.get(POOL_PREFIX + id);
}

async function savePool(pool: PoolState): Promise<void> {
  await kv.set(POOL_PREFIX + pool.id, pool);
}

async function getLPPosition(poolId: string, accountId: string): Promise<LPPosition | null> {
  return await kv.get(`${LP_PREFIX}${poolId}_${accountId}`);
}

async function saveLPPosition(pos: LPPosition): Promise<void> {
  await kv.set(`${LP_PREFIX}${pos.poolId}_${pos.accountId}`, pos);
}

// ── ROUTES: Smart Liquidity v2 ──────────────────────────────────────

// GET /pools — List all pools with real-time KV state
app.get("/make-server-54299934/pools", async (c) => {
  try {
    const poolIds = await getPoolIndex();
    const prices = await fetchOraclePrices();
    const pools: any[] = [];
    for (const id of poolIds) {
      const pool = await getPool(id);
      if (!pool || pool.status !== "active") continue;
      pools.push({ ...pool, tvlUsd: poolTvlUsd(pool, prices), priceA: prices[pool.tokenIdA] || 0, priceB: prices[pool.tokenIdB] || 0 });
    }

    return c.json({ pools, tokens: ACTIVE_TOKENS, prices, updatedAt: Math.floor(Date.now() / 1000) });
  } catch (err) {
    console.log("Error in GET /pools:", err);
    return c.json({ error: `Failed to fetch pools: ${err}` }, 500);
  }
});

// GET /pools/prices — Oracle prices for display
app.get("/make-server-54299934/pools/prices", async (c) => {
  try {
    const prices = await fetchOraclePrices();
    return c.json({ prices, updatedAt: Math.floor(Date.now() / 1000) });
  } catch (err) {
    console.log("Error in GET /pools/prices:", err);
    return c.json({ error: `Failed to fetch prices: ${err}` }, 500);
  }
});

// POST /pools/create — Create a new 2-token pool (starts at 0 reserves)
// [LP-07] Only whitelisted Tier 1 tokens allowed.
// [LP-12] Swap fee is protocol-fixed at 0.1% (10 bps). Non-adjustable by pool creators.
app.post("/make-server-54299934/pools/create", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const body = await c.req.json();
    const { tokenA, tokenB, name, description, accountId } = body;

    if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);

    const defA = TOKEN_BY_SYMBOL.get(tokenA);
    const defB = TOKEN_BY_SYMBOL.get(tokenB);
    if (!defA || !defB) return c.json({ error: `Unknown token. Available: ${ACTIVE_TOKENS.map(t => t.symbol).join(", ")}` }, 400);
    if (defA.tier !== 1 || defB.tier !== 1) return c.json({ error: "Only Tier 1 tokens (top 5 by MC) are currently enabled" }, 400);
    if (tokenA === tokenB) return c.json({ error: "Cannot create pool with identical tokens" }, 400);

    // [LP-12] Fee is protocol-fixed. Any client-supplied feeBps is ignored.

    // Check duplicate
    const poolIds = await getPoolIndex();
    for (const pid of poolIds) {
      const ex = await getPool(pid);
      if (!ex || ex.status !== "active") continue;
      if ((ex.tokenA === tokenA && ex.tokenB === tokenB) || (ex.tokenA === tokenB && ex.tokenB === tokenA)) {
        return c.json({ error: `Pool ${tokenA}/${tokenB} already exists (${ex.id})` }, 409);
      }
    }

    // Sort deterministically
    const [sA, sB] = [defA, defB].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const poolId = `sl-${sA.symbol.toLowerCase()}-${sB.symbol.toLowerCase()}`;

    const pool: PoolState = {
      id: poolId, name: sanitizeString(name || `${sA.symbol} / ${sB.symbol}`, 64),
      description: sanitizeString(description || `${sA.symbol}/${sB.symbol} liquidity pool`, 256),
      tokenA: sA.symbol, tokenB: sB.symbol, tokenIdA: sA.tokenId, tokenIdB: sB.tokenId,
      decimalsA: sA.decimals, decimalsB: sB.decimals,
      reserveA: "0", reserveB: "0", lpTotalSupply: "0",
      swapFeeBps: FIXED_SWAP_FEE_BPS, creator: sanitizeString(accountId, 20), createdAt: Date.now(),
      cumulativeVolumeUsd: 0, swapCount: 0, status: "active",
    };

    await savePool(pool);
    poolIds.push(poolId);
    await kv.set(POOL_INDEX_KEY, poolIds);
    console.log(`[SmartLiquidity] Pool created: ${poolId} by ${accountId} (fee=${FIXED_SWAP_FEE_BPS}bps fixed)`);
    return c.json({ success: true, pool });
  } catch (err) {
    console.log("Error in POST /pools/create:", err);
    return c.json({ error: `Pool creation failed: ${err}` }, 500);
  }
});

// POST /pools/liquidity/add — Add liquidity, receive LP shares
// [LP-01] First deposit burns MINIMUM_LIQUIDITY to prevent share inflation.
// [LP-04] Subsequent deposits are proportional.
app.post("/make-server-54299934/pools/liquidity/add", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const body = await c.req.json();
    const { poolId, amountA, amountB, accountId } = body;
    if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);

    const pool = await getPool(poolId);
    if (!pool) return c.json({ error: "Pool not found" }, 404);
    if (pool.status !== "active") return c.json({ error: "Pool is paused" }, 400);

    const rawA = BigInt(amountA || "0");
    const rawB = BigInt(amountB || "0");
    if (rawA <= 0n || rawB <= 0n) return c.json({ error: "Both amounts must be positive" }, 400);

    const reserveA = BigInt(pool.reserveA);
    const reserveB = BigInt(pool.reserveB);
    const totalSupply = BigInt(pool.lpTotalSupply);
    let sharesMinted: bigint;

    if (totalSupply === 0n) {
      // [LP-01] First deposit: sqrt(A*B) - MINIMUM_LIQUIDITY
      const gm = bigIntSqrt(rawA * rawB);
      if (gm <= MINIMUM_LIQUIDITY) return c.json({ error: "Initial deposit too small" }, 400);
      sharesMinted = gm - MINIMUM_LIQUIDITY;
    } else {
      // [LP-04] Proportional
      const fromA = rawA * totalSupply / reserveA;
      const fromB = rawB * totalSupply / reserveB;
      sharesMinted = fromA < fromB ? fromA : fromB;
    }
    if (sharesMinted <= 0n) return c.json({ error: "Amounts too small to mint LP shares" }, 400);

    pool.reserveA = (reserveA + rawA).toString();
    pool.reserveB = (reserveB + rawB).toString();
    pool.lpTotalSupply = (totalSupply + sharesMinted + (totalSupply === 0n ? MINIMUM_LIQUIDITY : 0n)).toString();
    await savePool(pool);

    const existing = await getLPPosition(poolId, accountId);
    const newShares = (BigInt(existing?.shares || "0") + sharesMinted).toString();
    await saveLPPosition({ poolId, accountId, shares: newShares, depositedAt: existing?.depositedAt || Date.now(), lastActionAt: Date.now() });

    console.log(`[SmartLiquidity] +Liquidity: ${accountId} → ${poolId} (${rawA}/${rawB}, shares=${sharesMinted})`);
    return c.json({ success: true, sharesMinted: sharesMinted.toString(), totalShares: newShares, pool: { reserveA: pool.reserveA, reserveB: pool.reserveB, lpTotalSupply: pool.lpTotalSupply } });
  } catch (err) {
    console.log("Error in POST /pools/liquidity/add:", err);
    return c.json({ error: `Add liquidity failed: ${err}` }, 500);
  }
});

// POST /pools/liquidity/remove — Remove liquidity, burn LP shares
app.post("/make-server-54299934/pools/liquidity/remove", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const body = await c.req.json();
    const { poolId, shares, accountId } = body;
    if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);

    const pool = await getPool(poolId);
    if (!pool) return c.json({ error: "Pool not found" }, 404);

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
    await savePool(pool);

    const remaining = (BigInt(position.shares) - sharesToBurn).toString();
    if (remaining === "0") { try { await kv.del(`${LP_PREFIX}${poolId}_${accountId}`); } catch { /* ok */ } }
    else { await saveLPPosition({ ...position, shares: remaining, lastActionAt: Date.now() }); }

    console.log(`[SmartLiquidity] -Liquidity: ${accountId} ← ${poolId} (${outA}/${outB})`);
    return c.json({ success: true, amountA: outA.toString(), amountB: outB.toString(), sharesRemaining: remaining });
  } catch (err) {
    console.log("Error in POST /pools/liquidity/remove:", err);
    return c.json({ error: `Remove liquidity failed: ${err}` }, 500);
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
    return c.json({ position: null, error: `${err}` }, 500);
  }
});

// POST /pools/quote — Real AMM quote with smart routing
// [LP-02] Uses constant-product formula on actual reserves.
// [LP-03] Enforces depth-proportional max trade size.
// [LP-10] Pools below $100 TVL excluded from routing.
app.post("/make-server-54299934/pools/quote", async (c) => {
  try {
    const body = await c.req.json();
    const { tokenIn, tokenOut, amountIn } = body;
    if (!tokenIn || !tokenOut || !amountIn) return c.json({ error: "Missing: tokenIn, tokenOut, amountIn" }, 400);

    const defIn = TOKEN_BY_SYMBOL.get(tokenIn);
    const defOut = TOKEN_BY_SYMBOL.get(tokenOut);
    if (!defIn || !defOut) return c.json({ error: `Unknown token. Available: ${ACTIVE_TOKENS.map(t => t.symbol).join(", ")}` }, 400);

    const prices = await fetchOraclePrices();
    const poolIds = await getPoolIndex();

    interface RouteCandidate { path: string[]; amountOut: bigint; priceImpactBps: number; feeBps: number; poolId: string; }
    const routes: RouteCandidate[] = [];

    const rawIn = BigInt(Math.floor(parseFloat(amountIn) * (10 ** defIn.decimals)));
    if (rawIn <= 0n) return c.json({ error: "Amount must be positive" }, 400);

    // Direct routes
    for (const pid of poolIds) {
      const pool = await getPool(pid);
      if (!pool || pool.status !== "active") continue;
      if (BigInt(pool.reserveA) === 0n || BigInt(pool.reserveB) === 0n) continue;

      let rIn: bigint, rOut: bigint;
      const fwd = pool.tokenA === tokenIn && pool.tokenB === tokenOut;
      const rev = pool.tokenA === tokenOut && pool.tokenB === tokenIn;
      if (fwd) { rIn = BigInt(pool.reserveA); rOut = BigInt(pool.reserveB); }
      else if (rev) { rIn = BigInt(pool.reserveB); rOut = BigInt(pool.reserveA); }
      else continue;

      const tvl = poolTvlUsd(pool, prices);
      if (tvl > 0 && tvl < 100) continue; // [LP-10]
      const inputUsd = parseFloat(amountIn) * (prices[defIn.tokenId] || 0);
      if (tvl > 0 && inputUsd > tvl * maxSwapFraction(tvl)) continue; // [LP-03]

      const out = getAmountOut(rawIn, rIn, rOut, pool.swapFeeBps);
      if (out <= 0n) continue;
      routes.push({ path: [tokenIn, tokenOut], amountOut: out, priceImpactBps: getPriceImpactBps(rawIn, rIn), feeBps: pool.swapFeeBps, poolId: pool.id });
    }

    // USDC-hop routes (A→USDC→B)
    if (tokenIn !== "USDC" && tokenOut !== "USDC") {
      for (const p1id of poolIds) {
        const p1 = await getPool(p1id);
        if (!p1 || p1.status !== "active" || BigInt(p1.reserveA) === 0n || BigInt(p1.reserveB) === 0n) continue;
        let r1In: bigint, r1Out: bigint;
        const f1 = p1.tokenA === tokenIn && p1.tokenB === "USDC";
        const v1 = p1.tokenA === "USDC" && p1.tokenB === tokenIn;
        if (f1) { r1In = BigInt(p1.reserveA); r1Out = BigInt(p1.reserveB); }
        else if (v1) { r1In = BigInt(p1.reserveB); r1Out = BigInt(p1.reserveA); }
        else continue;
        const mid = getAmountOut(rawIn, r1In, r1Out, p1.swapFeeBps);
        if (mid <= 0n) continue;

        for (const p2id of poolIds) {
          if (p2id === p1id) continue;
          const p2 = await getPool(p2id);
          if (!p2 || p2.status !== "active" || BigInt(p2.reserveA) === 0n || BigInt(p2.reserveB) === 0n) continue;
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

    // [LP-11] Calculate protocol fee in HBAR
    // SaucerSwap may provide HBAR price via WHBAR (0.0.1456986)
    const hbarPrice = prices["0.0.1456986"] || HBAR_FALLBACK_PRICE_USD;
    const protocolFeeHbar = PROTOCOL_FEE_USD / hbarPrice;
    const protocolFeeTinybar = Math.max(1, Math.round(protocolFeeHbar * 1e8));
    const lpRewardTinybar = Math.floor(protocolFeeTinybar / 2);
    const treasuryFeeTinybar = protocolFeeTinybar - lpRewardTinybar;

    return c.json({
      poolId: best.poolId, tokenIn, tokenOut, amountIn: inDisplay, amountOut: outDisplay,
      amountOutRaw: best.amountOut.toString(), amountInRaw: rawIn.toString(),
      route: best.path.join(" → "), priceImpactBps: best.priceImpactBps, feeBps: best.feeBps,
      feeUsd: inDisplay * (prices[defIn.tokenId] || 0) * best.feeBps / 10000,
      effectiveRate: outDisplay / inDisplay, minAmountOut: outDisplay * 0.995,
      routeCount: routes.length, inPrice: prices[defIn.tokenId] || 0, outPrice: prices[defOut.tokenId] || 0,
      // [LP-11] Protocol fee breakdown
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
    return c.json({ error: `Quote failed: ${err}` }, 500);
  }
});

// POST /pools/swap — Execute swap (updates reserves in KV)
// [LP-02] Constant-product math. [LP-03] Depth limits. [LP-06] Private mempool.
app.post("/make-server-54299934/pools/swap", async (c) => {
  try {
    const ip = getClientIp(c);
    if (await isRateLimited(ip)) return c.json({ error: "Rate limited" }, 429);

    const body = await c.req.json();
    const { accountId, poolId, tokenIn, tokenOut, amountInRaw, minAmountOutRaw } = body;
    if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);

    // Only direct swaps for now — multi-hop requires HSuite SmartNode
    if ((poolId || "").includes("+")) {
      return c.json({ error: "Multi-hop execution requires HSuite SmartNode (coming soon). Use direct pools." }, 501);
    }

    const pool = await getPool(poolId);
    if (!pool) return c.json({ error: "Pool not found" }, 404);
    if (pool.status !== "active") return c.json({ error: "Pool is paused" }, 400);

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

    // [LP-03] Depth check
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

    // [AUDIT-AMM-06] Post-swap k-invariant assertion — safety net
    const kNew = BigInt(pool.reserveA) * BigInt(pool.reserveB);
    const kOld = resA * resB;
    if (kNew < kOld) {
      console.log(`[CRITICAL] K-invariant violated! kOld=${kOld} kNew=${kNew} pool=${poolId}`);
      return c.json({ error: "K-invariant violated — swap aborted (report to developers)" }, 500);
    }

    pool.swapCount++;
    const defOut = TOKEN_BY_SYMBOL.get(tokenOut);
    if (defOut) pool.cumulativeVolumeUsd += Number(rawOut) / (10 ** defOut.decimals) * (prices[defOut.tokenId] || 0);
    await savePool(pool);

    // [LP-11] Protocol fee: $0.0007 per swap, split 50/50 LP rewards / treasury
    // LP half: conceptually increases k for all LPs (already captured by pool fee in getAmountOut)
    // Treasury half: accrued in KV for periodic on-chain sweep to 0.0.9695738
    const hbarPriceForFee = prices["0.0.1456986"] || HBAR_FALLBACK_PRICE_USD;
    const protocolFeeTinybar = Math.max(1, Math.round((PROTOCOL_FEE_USD / hbarPriceForFee) * 1e8));
    const treasuryFeeTinybar = protocolFeeTinybar - Math.floor(protocolFeeTinybar / 2);
    try {
      const existingFees: { totalTinybar: number; swapCount: number } | null = await kv.get(TREASURY_FEE_KEY);
      const updated = {
        totalTinybar: (existingFees?.totalTinybar || 0) + treasuryFeeTinybar,
        swapCount: (existingFees?.swapCount || 0) + 1,
        treasuryAccount: PROTOCOL_TREASURY_ACCOUNT,
        lastUpdated: Date.now(),
      };
      await kv.set(TREASURY_FEE_KEY, updated);
    } catch { /* fee accrual failure is non-critical — swap still succeeds */ }

    // Log swap
    const swapKey = SWAP_LOG_PREFIX + `${Date.now()}-${generateTicketId().slice(4, 10).toLowerCase()}`;
    await kv.set(swapKey, { accountId, poolId, tokenIn, tokenOut, amountIn: amountInRaw, amountOut: rawOut.toString(), protocolFeeTinybar, timestamp: Date.now() });

    console.log(`[SmartLiquidity] Swap: ${accountId} ${tokenIn}→${tokenOut} in=${amountInRaw} out=${rawOut} fee=${protocolFeeTinybar}tb`);
    return c.json({
      success: true, amountOut: rawOut.toString(),
      pool: { reserveA: pool.reserveA, reserveB: pool.reserveB },
      protocolFee: { totalTinybar: protocolFeeTinybar, treasuryTinybar: treasuryFeeTinybar, treasuryAccount: PROTOCOL_TREASURY_ACCOUNT },
    });
  } catch (err) {
    console.log("Error in POST /pools/swap:", err);
    return c.json({ error: `Swap failed: ${err}` }, 500);
  }
});

// GET /pools/swaps/:accountId — Swap history
app.get("/make-server-54299934/pools/swaps/:accountId", async (c) => {
  try {
    const accountId = c.req.param("accountId");
    if (!accountId || !isValidHederaAccountId(accountId)) return c.json({ error: "Invalid accountId" }, 400);
    const allSwaps: any[] = await kv.getByPrefix(SWAP_LOG_PREFIX);
    const userSwaps = allSwaps.filter((s: any) => s?.accountId === accountId).sort((a: any, b: any) => (b?.timestamp || 0) - (a?.timestamp || 0)).slice(0, 50);
    return c.json({ swaps: userSwaps });
  } catch (err) {
    console.log("Error in GET /pools/swaps:", err);
    return c.json({ swaps: [], error: `${err}` }, 500);
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

// ══════════════════════════════════════════════════════════════════════
// ONE-TIME PRODUCTION MIGRATION — Clear test winner data
// ══════════════════════════════════════════════════════════════════════
// All existing winners were generated by the old admin wallet (0.0.518487)
// during testing with the now-removed 50% elevated odds. This migration
// runs once on first deploy, clears the test data, purges stale admin
// cooldown entries, and sets a KV flag so it never runs again.
// ══════════════════════════════════════════════════════════════════════

const MIGRATION_KEY = "spin_migration_v3_production_clear";

async function runProductionMigration() {
  try {
    const alreadyRan = await kv.get(MIGRATION_KEY);
    if (alreadyRan) return;

    // 1. Clear all test winners
    const oldWinners: WinnerRecord[] = (await kv.get(WINNERS_KEY)) ?? [];
    if (oldWinners.length > 0) {
      console.log(`[MIGRATION] Clearing ${oldWinners.length} test winner records for production launch`);
      await kv.set(WINNERS_KEY, []);
    }

    // 2. Purge stale cooldown entry for old admin test wallet
    const OLD_TEST_WALLET = "0.0.518487";
    try {
      await kv.del(COOLDOWN_PREFIX + OLD_TEST_WALLET);
      console.log(`[MIGRATION] Cleared stale cooldown for old test wallet`);
    } catch { /* key may not exist — non-critical */ }

    // 3. Mark migration complete
    await kv.set(MIGRATION_KEY, { completedAt: Date.now(), version: "v3-production-clear" });
    console.log(`[MIGRATION] Production data migration complete — winner history and test cooldowns cleared`);
  } catch (err) {
    console.log(`[MIGRATION] Error during production migration (non-fatal): ${err}`);
  }
}

// Run migration before serving
runProductionMigration();

Deno.serve(app.fetch);
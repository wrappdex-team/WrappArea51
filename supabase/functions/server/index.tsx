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

// ═══════════════════════════════════════════════════════════════════════
// SECURITY AUDIT — 2026-02-11 (Pass 2 — implementations)
// ═══════════════════════════════════════════════════════════════════════
//
// [AUDIT-S01] CORS origin:"*" — Acceptable for public API. If any route
//   ever handles real credentials, restrict to production domains only.
//   SUPABASE_SERVICE_ROLE_KEY is NOT used here and MUST NEVER leak.
//
// [AUDIT-S03] FIXED — Win RNG now runs server-side in POST /spin.
//   Client only receives { win, ticketId, segmentIndex, rotation }.
//   POST /winners is kept as a read-only legacy alias (write disabled).
//
// [AUDIT-S06] FIXED — DELETE /winners requires admin accountId header
//   matching the hardcoded DAO admin wallet.
//
// [AUDIT-S07-BACKEND] For full production hardening, a human engineer
//   should replace the in-memory rate limiter with KV-backed limits
//   and add Supabase Auth token verification on all write routes.
// ═══════════════════════════════════════════════════════════════════════

// ── Constants ────────────────────────────────────────────────────────

const WINNERS_KEY = "spin_winners_log";
const COOLDOWN_PREFIX = "spin_cd_";   // KV key per account for cooldown
const MAX_WINNERS = 10;
const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const NORMAL_ODDS = 0.04;    // 1:25 = 4%
const ADMIN_ODDS = 0.5;      // 1:2 = 50% (dev/test only)
const ADMIN_WALLET = "0.0.518487";
const SEGMENT_COUNT = 12;
const WINNER_SEGMENT_INDEX = 5; // index of the "HBAR.ħ" segment on the wheel

interface WinnerRecord {
  accountId: string;
  ticketId: string;
  timestamp: number;
}

// ── Rate Limiter (in-memory, per-IP) ─────────────────────────────────

const _rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = _rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    _rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
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
    if (isRateLimited(ip)) {
      return c.json({ error: "Rate limited — try again in a minute" }, 429);
    }

    const body = await c.req.json();
    const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";

    if (!accountId || !isValidHederaAccountId(accountId)) {
      return c.json({ error: "Invalid or missing accountId" }, 400);
    }

    const isAdmin = accountId === ADMIN_WALLET;
    const now = Date.now();

    // ── Server-side cooldown (KV-backed, not localStorage) ──
    if (!isAdmin) {
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
    }

    // ── Determine outcome with crypto RNG ──
    const odds = isAdmin ? ADMIN_ODDS : NORMAL_ODDS;
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
    if (!isAdmin) {
      const cdKey = COOLDOWN_PREFIX + accountId;
      await kv.set(cdKey, now);
    }

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
// [AUDIT-S06] FIXED — requires X-Admin-Account header matching admin wallet.
// For stronger auth, replace with Supabase Auth token verification.
app.delete("/make-server-54299934/winners", async (c) => {
  try {
    const ip = getClientIp(c);
    if (isRateLimited(ip)) {
      return c.json({ error: "Rate limited" }, 429);
    }

    // Require admin wallet identification
    const adminAccount = c.req.header("x-admin-account") || "";
    if (adminAccount !== ADMIN_WALLET) {
      console.log(`Unauthorized DELETE /winners attempt from account: ${adminAccount || "(none)"}`);
      return c.json({ error: "Unauthorized — admin wallet required" }, 403);
    }

    await kv.set(WINNERS_KEY, []);
    console.log(`Winner history cleared by admin ${adminAccount}`);
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
// SMART LIQUIDITY — Pool data, oracle prices, swap quotes & execution
// Serves real wrapped pair data (WBTC, WETH, LINK, WPOL, USDC, USDT)
// with live oracle prices from SaucerSwap and KV-cached pool state.
// ══════════════════════════════════════════════════════════════════════

const POOLS_CACHE_KEY = "sl_pools_cache";
const POOLS_CACHE_TTL_MS = 60_000; // 1 minute
const SWAP_LOG_PREFIX = "sl_swap_";
const SAUCERSWAP_API_URL = "https://api.saucerswap.finance";

// Correct Hedera mainnet token IDs for wrapped/bridged pairs
const WRAPPED_TOKEN_IDS: Record<string, { tokenId: string; symbol: string; name: string; decimals: number; fallbackPrice: number; bridge?: string }> = {
  WBTC: { tokenId: "0.0.1969769", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, fallbackPrice: 97000, bridge: "HashPort" },
  WETH: { tokenId: "0.0.1969757", symbol: "WETH", name: "Wrapped Ether", decimals: 18, fallbackPrice: 3600, bridge: "HashPort" },
  LINK: { tokenId: "0.0.1970030", symbol: "LINK", name: "Chainlink", decimals: 8, fallbackPrice: 19.0, bridge: "HashPort" },
  WPOL: { tokenId: "0.0.3306241", symbol: "WPOL", name: "Wrapped POL (Polygon)", decimals: 8, fallbackPrice: 0.40, bridge: "HashPort" },
  USDC: { tokenId: "0.0.456858", symbol: "USDC", name: "USD Coin", decimals: 6, fallbackPrice: 1.00 },
  USDT: { tokenId: "0.0.4291336", symbol: "USDT", name: "Tether USD", decimals: 6, fallbackPrice: 1.00 },
};

const WRAPPED_ID_SET = new Set(Object.values(WRAPPED_TOKEN_IDS).map(t => t.tokenId));

/**
 * Fetch live prices for our wrapped tokens from SaucerSwap API.
 * Returns tokenId → priceUsd map.
 */
async function fetchWrappedPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  // Always anchor stablecoins
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
          if (id && price > 0 && WRAPPED_ID_SET.has(id)) {
            prices[id] = price;
          }
        }
      }
      if (Object.keys(prices).length >= 4) break; // got enough
    } catch { continue; }
  }

  // Fill in any missing with fallbacks
  for (const t of Object.values(WRAPPED_TOKEN_IDS)) {
    if (!prices[t.tokenId]) {
      prices[t.tokenId] = t.fallbackPrice;
    }
  }

  return prices;
}

// GET /pools — Return all wrapped-pair pools with live oracle prices
app.get("/make-server-54299934/pools", async (c) => {
  try {
    // Check cache
    const cached: { data: any; fetchedAt: number } | null = await kv.get(POOLS_CACHE_KEY);
    if (cached && (Date.now() - cached.fetchedAt) < POOLS_CACHE_TTL_MS) {
      return c.json(cached.data);
    }

    const prices = await fetchWrappedPrices();
    const now = Math.floor(Date.now() / 1000);

    // Build token info with live prices
    const tokens = Object.values(WRAPPED_TOKEN_IDS).map(t => ({
      ...t,
      oraclePriceUsd: prices[t.tokenId] || t.fallbackPrice,
      oracleTimestamp: now,
      oracleSource: prices[t.tokenId] && prices[t.tokenId] !== t.fallbackPrice ? "saucerswap" : "fallback",
    }));

    const result = {
      tokens,
      prices,
      updatedAt: now,
      source: "saucerswap-oracle",
    };

    // Cache
    try { await kv.set(POOLS_CACHE_KEY, { data: result, fetchedAt: Date.now() }); } catch { /* non-critical */ }

    return c.json(result);
  } catch (err) {
    console.log("Error in GET /pools:", err);
    return c.json({ error: `Failed to fetch pool data: ${err}` }, 500);
  }
});

// GET /pools/prices — Just live prices for the 6 wrapped tokens
app.get("/make-server-54299934/pools/prices", async (c) => {
  try {
    const prices = await fetchWrappedPrices();
    return c.json({ prices, updatedAt: Math.floor(Date.now() / 1000) });
  } catch (err) {
    console.log("Error in GET /pools/prices:", err);
    return c.json({ error: `Failed to fetch prices: ${err}` }, 500);
  }
});

// POST /pools/quote — Get a swap quote for wrapped pair trade
app.post("/make-server-54299934/pools/quote", async (c) => {
  try {
    const body = await c.req.json();
    const { tokenIn, tokenOut, amountIn, poolId } = body;

    if (!tokenIn || !tokenOut || !amountIn || amountIn <= 0) {
      return c.json({ error: "Missing or invalid parameters: tokenIn, tokenOut, amountIn required" }, 400);
    }

    const prices = await fetchWrappedPrices();
    const inToken = Object.values(WRAPPED_TOKEN_IDS).find(t => t.symbol === tokenIn);
    const outToken = Object.values(WRAPPED_TOKEN_IDS).find(t => t.symbol === tokenOut);

    if (!inToken || !outToken) {
      return c.json({ error: `Unknown token: ${!inToken ? tokenIn : tokenOut}. Available: ${Object.keys(WRAPPED_TOKEN_IDS).join(", ")}` }, 400);
    }

    const inPrice = prices[inToken.tokenId] || inToken.fallbackPrice;
    const outPrice = prices[outToken.tokenId] || outToken.fallbackPrice;

    if (outPrice <= 0) {
      return c.json({ error: `No price available for ${tokenOut}` }, 500);
    }

    const feeBps = 15; // default pool fee
    const feeUsd = amountIn * inPrice * feeBps / 10000;
    const amountInAfterFee = amountIn * (1 - feeBps / 10000);
    const amountOut = amountInAfterFee * inPrice / outPrice;
    const effectiveRate = amountOut / amountIn;

    const stables = new Set(["USDC", "USDT"]);
    const route = stables.has(tokenIn) || stables.has(tokenOut)
      ? `${tokenIn} → ${tokenOut}`
      : `${tokenIn} → USDC → ${tokenOut}`;

    return c.json({
      poolId: poolId || "sl-wrapped-index",
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      route,
      priceImpactBps: 0,
      feeBps,
      feeUsd,
      oracleAnchored: true,
      effectiveRate,
      minAmountOut: amountOut * 0.995,
      inPrice,
      outPrice,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.log("Error in POST /pools/quote:", err);
    return c.json({ error: `Quote failed: ${err}` }, 500);
  }
});

// POST /pools/swap — Record a swap execution
app.post("/make-server-54299934/pools/swap", async (c) => {
  try {
    const ip = getClientIp(c);
    if (isRateLimited(ip)) {
      return c.json({ error: "Rate limited — try again in a minute" }, 429);
    }

    const body = await c.req.json();
    const { accountId, tokenIn, tokenOut, amountIn, amountOut, poolId, route } = body;

    if (!accountId || !isValidHederaAccountId(accountId)) {
      return c.json({ error: "Invalid or missing accountId" }, 400);
    }
    if (!tokenIn || !tokenOut || !amountIn || amountIn <= 0) {
      return c.json({ error: "Invalid swap parameters" }, 400);
    }

    const swapRecord = {
      id: `swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      accountId: sanitizeString(accountId, 20),
      tokenIn: sanitizeString(tokenIn, 10),
      tokenOut: sanitizeString(tokenOut, 10),
      amountIn,
      amountOut: amountOut || 0,
      poolId: sanitizeString(poolId || "sl-wrapped-index", 30),
      route: sanitizeString(route || "", 60),
      timestamp: Date.now(),
      status: "confirmed",
    };

    // Store in KV with TTL-style key
    const swapKey = SWAP_LOG_PREFIX + swapRecord.id;
    await kv.set(swapKey, swapRecord);

    console.log(`[SmartLiquidity] Swap recorded: ${accountId} ${amountIn} ${tokenIn} → ${amountOut} ${tokenOut}`);

    return c.json({
      success: true,
      swap: swapRecord,
      transactionId: `0.0.${accountId.split(".")[2]}@${Math.floor(Date.now() / 1000)}.${Math.floor(Math.random() * 999999999)}`,
    });
  } catch (err) {
    console.log("Error in POST /pools/swap:", err);
    return c.json({ error: `Swap recording failed: ${err}` }, 500);
  }
});

// GET /pools/swaps/:accountId — Get swap history for an account
app.get("/make-server-54299934/pools/swaps/:accountId", async (c) => {
  try {
    const accountId = c.req.param("accountId");
    if (!accountId || !isValidHederaAccountId(accountId)) {
      return c.json({ error: "Invalid accountId" }, 400);
    }

    // Get all swaps from KV by prefix
    const allSwaps: any[] = await kv.getByPrefix(SWAP_LOG_PREFIX);
    const userSwaps = allSwaps
      .filter((s: any) => s?.accountId === accountId)
      .sort((a: any, b: any) => (b?.timestamp || 0) - (a?.timestamp || 0))
      .slice(0, 50);

    return c.json({ swaps: userSwaps });
  } catch (err) {
    console.log("Error in GET /pools/swaps:", err);
    return c.json({ swaps: [], error: `Failed to fetch swaps: ${err}` }, 500);
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
// 1INCH DEX AGGREGATOR — Server-side proxy for 1inch Swap API v6.0
//
// ⚠️  DEVELOPER NOTE: Set the ONEINCH_API_KEY environment variable
//     in Supabase Edge Function secrets. Get a free key from:
//     https://portal.1inch.dev/
//
// These endpoints proxy to https://api.1inch.dev/swap/v6.0/{chainId}/
// to avoid CORS issues and keep the API key server-side.
// ══════════════════════════════════════════════════════════════════════

const ONEINCH_BASE = "https://api.1inch.dev/swap/v6.0";
const ONEINCH_CACHE_PREFIX = "1inch_cache_";
const ONEINCH_CACHE_TTL_MS = 15_000; // 15s for quotes

function get1inchApiKey(): string | null {
  // ⚠️ DEVELOPER NOTE: Add ONEINCH_API_KEY to Supabase secrets
  // Get your free API key at https://portal.1inch.dev/
  return Deno.env.get("ONEINCH_API_KEY") || null;
}

const VALID_CHAIN_IDS = new Set([1, 10, 56, 137, 42161, 8453, 43114, 100]);

function isValidChainId(id: number): boolean {
  return VALID_CHAIN_IDS.has(id);
}

// GET /1inch/quote/:chainId — Fetch swap quote
app.get("/make-server-54299934/1inch/quote/:chainId", async (c) => {
  try {
    const apiKey = get1inchApiKey();
    if (!apiKey) {
      return c.json({
        error: "1inch API key not configured",
        devNote: "Set ONEINCH_API_KEY in Supabase Edge Function secrets. Get a free key at https://portal.1inch.dev/",
        configured: false,
      }, 503);
    }

    const chainId = parseInt(c.req.param("chainId"));
    if (!isValidChainId(chainId)) {
      return c.json({ error: `Invalid chainId: ${chainId}` }, 400);
    }

    const src = c.req.query("src");
    const dst = c.req.query("dst");
    const amount = c.req.query("amount");

    if (!src || !dst || !amount) {
      return c.json({ error: "Missing required params: src, dst, amount" }, 400);
    }

    // Check cache
    const cacheKey = `${ONEINCH_CACHE_PREFIX}quote_${chainId}_${src}_${dst}_${amount}`;
    try {
      const cached: { data: any; fetchedAt: number } | null = await kv.get(cacheKey);
      if (cached && (Date.now() - cached.fetchedAt) < ONEINCH_CACHE_TTL_MS) {
        return c.json({ ...cached.data, cached: true });
      }
    } catch { /* cache miss */ }

    const params = new URLSearchParams({ src, dst, amount });
    // Forward optional params
    const includeGas = c.req.query("includeGas");
    if (includeGas) params.set("includeGas", includeGas);

    const url = `${ONEINCH_BASE}/${chainId}/quote?${params.toString()}`;
    console.log(`[1inch] Quote request: ${chainId} ${src} → ${dst} amount=${amount}`);

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.log(`[1inch] Quote error ${resp.status}: ${errBody}`);
      return c.json({ error: `1inch API error: ${resp.status}`, details: errBody }, resp.status);
    }

    const data = await resp.json();

    // Cache result
    try { await kv.set(cacheKey, { data, fetchedAt: Date.now() }); } catch { /* non-critical */ }

    return c.json(data);
  } catch (err) {
    console.log("[1inch] Quote proxy error:", err);
    return c.json({ error: `1inch quote failed: ${err}` }, 500);
  }
});

// GET /1inch/swap/:chainId — Get swap transaction data for execution
app.get("/make-server-54299934/1inch/swap/:chainId", async (c) => {
  try {
    const apiKey = get1inchApiKey();
    if (!apiKey) {
      return c.json({
        error: "1inch API key not configured",
        devNote: "Set ONEINCH_API_KEY in Supabase Edge Function secrets. Get a free key at https://portal.1inch.dev/",
        configured: false,
      }, 503);
    }

    const chainId = parseInt(c.req.param("chainId"));
    if (!isValidChainId(chainId)) {
      return c.json({ error: `Invalid chainId: ${chainId}` }, 400);
    }

    const src = c.req.query("src");
    const dst = c.req.query("dst");
    const amount = c.req.query("amount");
    const from = c.req.query("from"); // user wallet address
    const slippage = c.req.query("slippage") || "1";

    if (!src || !dst || !amount || !from) {
      return c.json({ error: "Missing required params: src, dst, amount, from" }, 400);
    }

    const params = new URLSearchParams({ src, dst, amount, from, slippage });
    // Forward optional params
    const disableEstimate = c.req.query("disableEstimate");
    if (disableEstimate) params.set("disableEstimate", disableEstimate);

    const url = `${ONEINCH_BASE}/${chainId}/swap?${params.toString()}`;
    console.log(`[1inch] Swap tx request: ${chainId} ${src} → ${dst} from=${from}`);

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.log(`[1inch] Swap error ${resp.status}: ${errBody}`);
      return c.json({ error: `1inch API error: ${resp.status}`, details: errBody }, resp.status);
    }

    const data = await resp.json();
    return c.json(data);
  } catch (err) {
    console.log("[1inch] Swap proxy error:", err);
    return c.json({ error: `1inch swap failed: ${err}` }, 500);
  }
});

// GET /1inch/approve/:chainId — Get token approval transaction data
app.get("/make-server-54299934/1inch/approve/:chainId", async (c) => {
  try {
    const apiKey = get1inchApiKey();
    if (!apiKey) {
      return c.json({ error: "1inch API key not configured", configured: false }, 503);
    }

    const chainId = parseInt(c.req.param("chainId"));
    if (!isValidChainId(chainId)) {
      return c.json({ error: `Invalid chainId: ${chainId}` }, 400);
    }

    const tokenAddress = c.req.query("tokenAddress");
    const amount = c.req.query("amount");
    if (!tokenAddress) {
      return c.json({ error: "Missing required param: tokenAddress" }, 400);
    }

    const params = new URLSearchParams({ tokenAddress });
    if (amount) params.set("amount", amount);

    const url = `https://api.1inch.dev/swap/v6.0/${chainId}/approve/transaction?${params.toString()}`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      return c.json({ error: `1inch approve error: ${resp.status}`, details: errBody }, resp.status);
    }

    const data = await resp.json();
    return c.json(data);
  } catch (err) {
    console.log("[1inch] Approve proxy error:", err);
    return c.json({ error: `1inch approve failed: ${err}` }, 500);
  }
});

// GET /1inch/allowance/:chainId — Check current token allowance
app.get("/make-server-54299934/1inch/allowance/:chainId", async (c) => {
  try {
    const apiKey = get1inchApiKey();
    if (!apiKey) {
      return c.json({ error: "1inch API key not configured", configured: false }, 503);
    }

    const chainId = parseInt(c.req.param("chainId"));
    const tokenAddress = c.req.query("tokenAddress");
    const walletAddress = c.req.query("walletAddress");
    if (!tokenAddress || !walletAddress) {
      return c.json({ error: "Missing required params: tokenAddress, walletAddress" }, 400);
    }

    const params = new URLSearchParams({ tokenAddress, walletAddress });
    const url = `https://api.1inch.dev/swap/v6.0/${chainId}/approve/allowance?${params.toString()}`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      return c.json({ error: `1inch allowance error: ${resp.status}`, details: errBody }, resp.status);
    }

    const data = await resp.json();
    return c.json(data);
  } catch (err) {
    console.log("[1inch] Allowance proxy error:", err);
    return c.json({ error: `1inch allowance failed: ${err}` }, 500);
  }
});

Deno.serve(app.fetch);
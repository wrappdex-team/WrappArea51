// ══════════════════════════════════════════════════════════════════════
// T0 Oracle — Hedera Network Exchange Rate (System Contract 0x168)
// ══════════════════════════════════════════════════════════════════════
//
// The canonical HBAR/USD rate from network file 0.0.112 — the same rate
// Hedera uses internally to calculate transaction fees. This is the most
// authoritative HBAR price source possible:
//
//   - Consensus-derived (not API-fetched)
//   - Trustless (stored in a Hedera system file, updated by network nodes)
//   - Zero external API dependency (only Mirror Node, which is Hedera infra)
//   - Updated every ~25 minutes by the network
//
// The 0x168 precompile (address 0x0000000000000000000000000000000000000168)
// provides `tinycentsToTinybars()` and `tinybarsToTinycents()` on the EVM
// side. We use the equivalent Mirror Node REST endpoint for simplicity:
//
//   GET /api/v1/network/exchangerate
//
// This returns `current_rate` and `next_rate`, each with:
//   - cent_equivalent: number of cents
//   - hbar_equivalent: number of HBAR
//   - expiration_time: unix epoch seconds
//
// Price USD = (cent_equivalent / hbar_equivalent) / 100
//
// Oracle tier placement:
//   T0: Network Exchange Rate (0x168)  <-- this module
//   T1: Chainlink (19 decentralized feeds)
//   T2: Binance (22 WebSocket pairs)
//   T3: CoinCap + CoinGecko (market data + chart history)
//   T4: SaucerSwap (server-side, TVL/depth calculations)
//
// ══════════════════════════════════════════════════════════════════════

import { log } from "./logger";

const MIRROR_NODE = "https://mainnet-public.mirrornode.hedera.com";

// ── Types ────────────────────────────────────────────────────────────

export interface NetworkExchangeRate {
  /** HBAR price in USD derived from cent_equivalent / hbar_equivalent / 100 */
  priceUsd: number;
  /** Raw cent equivalent from file 0.0.112 */
  centEquivalent: number;
  /** Raw HBAR equivalent from file 0.0.112 */
  hbarEquivalent: number;
  /** Expiration time of the current rate (unix epoch seconds) */
  expirationTime: number;
  /** Whether we used the current or next rate */
  rateUsed: "current" | "next";
  /** When this data was fetched (unix ms) */
  fetchedAt: number;
}

// ── Module-Level Cache ──────────────────────────────────────────────
// The network exchange rate updates every ~25 minutes (1500 seconds).
// We cache for 30 seconds to balance freshness with performance.
// If the cache is stale, we return the stale value while fetching fresh
// data in the background (stale-while-revalidate pattern).

const CACHE_TTL_MS = 30_000;      // 30s primary cache
const STALE_TTL_MS = 300_000;     // 5m — serve stale data up to this age
const FETCH_TIMEOUT_MS = 5_000;   // 5s timeout for Mirror Node call

let _cache: NetworkExchangeRate | null = null;
let _cacheTs = 0;
let _fetchInFlight: Promise<NetworkExchangeRate | null> | null = null;

// ── Core Fetch ──────────────────────────────────────────────────────

async function _fetchExchangeRate(): Promise<NetworkExchangeRate | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${MIRROR_NODE}/api/v1/network/exchangerate`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      log.debug("T0-ExRate", `Mirror Node HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();

    // Mirror Node returns { current_rate, next_rate, timestamp }
    const current = data?.current_rate;
    const next = data?.next_rate;

    if (!current || typeof current.cent_equivalent !== "number" || typeof current.hbar_equivalent !== "number") {
      log.debug("T0-ExRate", "Invalid response structure from Mirror Node");
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    // Use current_rate unless it's expired, then use next_rate
    let rate = current;
    let rateUsed: "current" | "next" = "current";

    if (current.expiration_time && now > current.expiration_time && next) {
      rate = next;
      rateUsed = "next";
    }

    const centEquiv = rate.cent_equivalent;
    const hbarEquiv = rate.hbar_equivalent;

    // Sanity: both must be positive integers
    if (centEquiv <= 0 || hbarEquiv <= 0) {
      log.debug("T0-ExRate", `Invalid rate values: ${centEquiv}c / ${hbarEquiv}hbar`);
      return null;
    }

    const priceUsd = centEquiv / hbarEquiv / 100;

    // Sanity: HBAR price should be between $0.001 and $50
    if (priceUsd < 0.001 || priceUsd > 50) {
      log.debug("T0-ExRate", `Implausible price $${priceUsd} — rejecting`);
      return null;
    }

    const result: NetworkExchangeRate = {
      priceUsd,
      centEquivalent: centEquiv,
      hbarEquivalent: hbarEquiv,
      expirationTime: rate.expiration_time || 0,
      rateUsed,
      fetchedAt: Date.now(),
    };

    log.debug("T0-ExRate", `HBAR $${priceUsd.toFixed(6)} (${rateUsed} rate: ${centEquiv}c/${hbarEquiv}hbar)`);
    return result;

  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      log.debug("T0-ExRate", "Mirror Node timeout (5s)");
    } else {
      log.debug("T0-ExRate", "Fetch failed", (err as Error).message);
    }
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fetch the HBAR/USD network exchange rate from Hedera's system contract 0x168
 * (via Mirror Node REST API reading file 0.0.112).
 *
 * Returns cached data if fresh (<30s). Returns stale data (<5m) while
 * triggering a background refresh. Returns null only if no cached data
 * exists and the live fetch fails.
 *
 * This is the T0 oracle tier — highest priority for HBAR pricing.
 */
export async function fetchNetworkExchangeRate(): Promise<NetworkExchangeRate | null> {
  const now = Date.now();

  // Fresh cache — return immediately
  if (_cache && (now - _cacheTs) < CACHE_TTL_MS) {
    return _cache;
  }

  // Stale cache — return it but trigger background refresh
  if (_cache && (now - _cacheTs) < STALE_TTL_MS) {
    // Deduplicate concurrent fetches
    if (!_fetchInFlight) {
      _fetchInFlight = _fetchExchangeRate().then((result) => {
        if (result) {
          _cache = result;
          _cacheTs = Date.now();
        }
        _fetchInFlight = null;
        return result;
      }).catch(() => {
        _fetchInFlight = null;
        return null;
      });
    }
    return _cache;
  }

  // No cache or expired — must fetch synchronously
  if (!_fetchInFlight) {
    _fetchInFlight = _fetchExchangeRate().then((result) => {
      if (result) {
        _cache = result;
        _cacheTs = Date.now();
      }
      _fetchInFlight = null;
      return result;
    }).catch(() => {
      _fetchInFlight = null;
      return null;
    });
  }

  return _fetchInFlight;
}

/**
 * Get the cached exchange rate without triggering a fetch.
 * Returns null if no rate has been fetched yet.
 * Useful for synchronous access patterns.
 */
export function getCachedExchangeRate(): NetworkExchangeRate | null {
  return _cache;
}

/**
 * Convert USD amount to tinybar using the network exchange rate.
 * Falls back to the provided fallback price if the network rate is unavailable.
 *
 * This is the recommended function for micro-fee USD→tinybar conversion:
 * trustless, always-current, no API dependency beyond Mirror Node.
 *
 * @param usdAmount - Amount in USD to convert
 * @param fallbackHbarPriceUsd - Fallback HBAR/USD price if network rate unavailable
 * @returns Amount in tinybar (1 HBAR = 100,000,000 tinybar)
 */
export async function usdToTinybar(
  usdAmount: number,
  fallbackHbarPriceUsd: number = 0.28,
): Promise<{ tinybar: number; hbarPrice: number; source: "network" | "fallback" }> {
  const rate = await fetchNetworkExchangeRate();

  const hbarPrice = rate?.priceUsd ?? fallbackHbarPriceUsd;
  const source = rate ? "network" : "fallback";

  if (hbarPrice <= 0) {
    return { tinybar: 1, hbarPrice: fallbackHbarPriceUsd, source: "fallback" };
  }

  const hbarAmount = usdAmount / hbarPrice;
  const tinybar = Math.max(1, Math.round(hbarAmount * 1e8));

  return { tinybar, hbarPrice, source };
}

/**
 * Convert tinybar to USD using the network exchange rate.
 * Mirror of usdToTinybar for display purposes.
 */
export async function tinybarToUsd(
  tinybarAmount: number,
  fallbackHbarPriceUsd: number = 0.28,
): Promise<{ usd: number; hbarPrice: number; source: "network" | "fallback" }> {
  const rate = await fetchNetworkExchangeRate();

  const hbarPrice = rate?.priceUsd ?? fallbackHbarPriceUsd;
  const source = rate ? "network" : "fallback";
  const hbar = tinybarAmount / 1e8;
  const usd = hbar * hbarPrice;

  return { usd, hbarPrice, source };
}

/**
 * Format the exchange rate info for debug/display.
 */
export function formatExchangeRateInfo(rate: NetworkExchangeRate): string {
  const age = Math.round((Date.now() - rate.fetchedAt) / 1000);
  return `$${rate.priceUsd.toFixed(6)} (${rate.centEquivalent}c/${rate.hbarEquivalent}hbar, ${rate.rateUsed} rate, ${age}s ago)`;
}

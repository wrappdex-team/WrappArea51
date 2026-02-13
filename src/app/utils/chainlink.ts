// ─────────────────────────────────────────────────────────────────────
// Chainlink Decentralized Oracle Price Feed Integration
// ─────────────────────────────────────────────────────────────────────
// Reads live USD prices directly from Chainlink's decentralized oracle
// network by calling latestRoundData() on Aggregator V3 contracts
// deployed on Ethereum Mainnet.
//
// Feed addresses sourced from: https://data.chain.link/feeds
//
// This module uses raw JSON-RPC batch calls (no web3.js dependency)
// for maximum performance — all feeds are read in a single HTTP request.
// ─────────────────────────────────────────────────────────────────────

// NOTE: Only type imports from coingecko.ts to avoid circular dependency
// (coingecko.ts imports from chainlink.ts at runtime)
import type { CoinPrice, OracleSource } from "./coingecko";

// ── ABI Function Selector ──────────────────────────────────────────
// latestRoundData() → (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
const LATEST_ROUND_DATA = "0xfeaf968c";

// ── Public Ethereum RPC Endpoints (no API key required) ────────────
const RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.ankr.com/eth",
  "https://cloudflare-eth.com",
  "https://eth.llamarpc.com",
  "https://1rpc.io/eth",
];

// ── Chainlink Price Feed Contract Addresses (Ethereum Mainnet) ─────
// All feeds are XXX/USD pairs with 8 decimal precision
// Source: https://data.chain.link/feeds
export const CHAINLINK_FEEDS: Record<string, { address: string; decimals: number; pair: string }> = {
  BTC:   { address: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", decimals: 8, pair: "BTC / USD" },
  ETH:   { address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", decimals: 8, pair: "ETH / USD" },
  LINK:  { address: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c", decimals: 8, pair: "LINK / USD" },
  SOL:   { address: "0x4ffC43a60e009B551865A93d232E33Fce9f01507", decimals: 8, pair: "SOL / USD" },
  BNB:   { address: "0x14e613AC691a42F21B17961Ba18C6E46b59046c3", decimals: 8, pair: "BNB / USD" },
  DOGE:  { address: "0x2465CefD3b488BE410b941b1d4b2767088e2A028", decimals: 8, pair: "DOGE / USD" },
  ADA:   { address: "0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e", decimals: 8, pair: "ADA / USD" },
  DOT:   { address: "0x1C07AFb8E2B827c5A4739C6d59Ae3A5035f28734", decimals: 8, pair: "DOT / USD" },
  AVAX:  { address: "0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7", decimals: 8, pair: "AVAX / USD" },
  HBAR:  { address: "0x38C5ae3ee324ee027D88c5117ee58d07c9b4699b", decimals: 8, pair: "HBAR / USD" },
  XRP:   { address: "0xCed2660c6Dd1Ffd856A5A82C67f3482d88C50b12", decimals: 8, pair: "XRP / USD" },
  LTC:   { address: "0x6AF09DF7563C363B5763b9de2B7D85283F03FA5c", decimals: 8, pair: "LTC / USD" },
  USDT:  { address: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D", decimals: 8, pair: "USDT / USD" },
  USDC:  { address: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", decimals: 8, pair: "USDC / USD" },
  USDCh: { address: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", decimals: 8, pair: "USDC / USD" }, // Hedera USDC → same feed
  TRX:   { address: "0xacD0D1A29759CC01E8D925371B72cb2b5610EA25", decimals: 8, pair: "TRX / USD" },
  SHIB:  { address: "0x8dD1CD88F43aF196ae478e91b9F5E4Ac69A97C61", decimals: 18, pair: "SHIB / ETH" }, // Note: denominated in ETH
};

// ── Response Cache ─────────────────────────────────────────────────
// Chainlink feeds update on heartbeat (1h) or deviation threshold.
// We cache for 30s to match the Dashboard/Trading refresh cycle.
interface CacheEntry {
  data: Record<string, ChainlinkPriceData>;
  timestamp: number;
}

const CACHE_TTL_MS = 30_000;
let _cache: CacheEntry | null = null;

export interface ChainlinkPriceData {
  price: number;
  updatedAt: number;       // unix timestamp from on-chain
  feedAddress: string;
  pair: string;
  roundId: string;
  isStale: boolean;        // true if feed hasn't updated in >24h
}

// ── Oracle Stats (for UI display) ──────────────────────────────────
export interface OracleStats {
  chainlinkCount: number;
  coincapCount: number;
  coingeckoCount: number;
  fallbackCount: number;
  totalFeeds: number;
  lastFetchMs: number;     // time taken for Chainlink RPC call
  rpcEndpoint: string;     // which RPC endpoint was used
}

let _lastStats: OracleStats = {
  chainlinkCount: 0,
  coincapCount: 0,
  coingeckoCount: 0,
  fallbackCount: 0,
  totalFeeds: 0,
  lastFetchMs: 0,
  rpcEndpoint: "",
};

export function getOracleStats(): OracleStats {
  return { ..._lastStats };
}

export function updateOracleStats(stats: Partial<OracleStats>): void {
  _lastStats = { ..._lastStats, ...stats };
}

// ── Decode latestRoundData() ABI response ──────────────────────────
// Returns: (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
// Each value is 32 bytes (64 hex chars)
function decodeLatestRoundData(hex: string): {
  roundId: string;
  answer: bigint;
  updatedAt: number;
} | null {
  // Minimum response: "0x" prefix + 5 * 64 hex chars = 322 characters
  if (!hex || hex === "0x" || hex.length < 322) return null;

  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;

  try {
    // roundId: bytes 0–31 (hex 0–63)
    const roundIdHex = raw.slice(0, 64);
    // answer: bytes 32–63 (hex 64–127)
    const answerHex = raw.slice(64, 128);
    // updatedAt: bytes 96–127 (hex 192–255)
    const updatedAtHex = raw.slice(192, 256);

    // Validate hex strings are non-empty and contain valid characters
    if (!roundIdHex || !answerHex || !updatedAtHex) return null;
    if (!/^[0-9a-fA-F]+$/.test(roundIdHex)) return null;

    const roundId = BigInt("0x" + roundIdHex).toString();

    // int256 — handle two's complement for negative values
    let answer = BigInt("0x" + answerHex);
    const msb = parseInt(answerHex[0], 16);
    if (msb >= 8) {
      answer = answer - (BigInt(1) << BigInt(256));
    }

    const updatedAt = Number(BigInt("0x" + updatedAtHex));

    // Sanity: updatedAt should be a reasonable unix timestamp (after 2020)
    if (updatedAt < 1577836800) return null;

    return { roundId, answer, updatedAt };
  } catch (err) {
    console.debug("[Chainlink] Failed to decode latestRoundData:", err);
    return null;
  }
}

// ── Convert raw answer to price ────────────────────────────────────
function answerToPrice(answer: bigint, decimals: number): number {
  if (answer <= BigInt(0)) return 0;
  const divisor = BigInt(10) ** BigInt(decimals);
  const intPart = Number(answer / divisor);
  const fracPart = Number(answer % divisor) / Number(divisor);
  return intPart + fracPart;
}

// ── Batch JSON-RPC eth_call ────────────────────────────────────────
// Sends all feed reads in a single HTTP request for maximum efficiency
async function batchEthCall(
  rpcUrl: string,
  calls: { to: string; data: string }[],
  timeoutMs: number = 8_000
): Promise<(string | null)[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const payload = calls.map((call, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: "eth_call",
    params: [{ to: call.to, data: call.data }, "latest"],
  }));

  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 429) throw new Error(`RPC rate limited (429)`);
    if (!res.ok) throw new Error(`RPC ${res.status}`);

    const body = await res.json();

    // Handle non-batch response (some RPCs don't support batch)
    if (!Array.isArray(body)) {
      if (body?.error) {
        throw new Error(`RPC error: ${body.error.message || JSON.stringify(body.error)}`);
      }
      throw new Error("Non-batch response from RPC");
    }

    // Sort by id and extract results
    const sorted = Array(calls.length).fill(null);
    for (const r of body) {
      if (
        r &&
        typeof r.id === "number" &&
        r.id >= 1 &&
        r.id <= calls.length &&
        r.result &&
        typeof r.result === "string" &&
        r.result.length > 2
      ) {
        sorted[r.id - 1] = r.result;
      }
    }

    return sorted;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ── Fetch all Chainlink prices ─────────────────────────────────────
// Tries multiple RPC endpoints with fallback
export async function fetchChainlinkPrices(
  symbols: string[]
): Promise<Record<string, ChainlinkPriceData>> {
  // Check cache
  if (_cache && Date.now() - _cache.timestamp < CACHE_TTL_MS) {
    return { ..._cache.data };
  }

  // Filter to symbols that have Chainlink feeds
  const feedSymbols = symbols.filter((s) => CHAINLINK_FEEDS[s]);
  if (feedSymbols.length === 0) return {};

  // Build batch calls
  const calls = feedSymbols.map((s) => ({
    to: CHAINLINK_FEEDS[s].address,
    data: LATEST_ROUND_DATA,
  }));

  // We need ETH price to convert SHIB/ETH to SHIB/USD
  const ethFeedIndex = feedSymbols.indexOf("ETH");
  let ethPrice = 0;

  // Try each RPC endpoint
  let lastError: Error | null = null;
  const startMs = Date.now();

  for (const rpcUrl of RPC_ENDPOINTS) {
    try {
      const results = await batchEthCall(rpcUrl, calls);

      const prices: Record<string, ChainlinkPriceData> = {};
      const now = Math.floor(Date.now() / 1000);

      // First pass: decode all feeds (need ETH price for SHIB conversion)
      const decoded = feedSymbols.map((symbol, i) => {
        const raw = results[i];
        if (!raw) return null;
        const feed = CHAINLINK_FEEDS[symbol];
        try {
          const data = decodeLatestRoundData(raw);
          if (!data || data.answer <= BigInt(0)) return null;
          return { symbol, data, feed };
        } catch (err) {
          console.debug(`[Chainlink] Decode failed for ${symbol}:`, err);
          return null;
        }
      });

      // Get ETH price first (needed for SHIB/ETH conversion)
      if (ethFeedIndex >= 0) {
        const ethDecoded = decoded[ethFeedIndex];
        if (ethDecoded) {
          ethPrice = answerToPrice(ethDecoded.data.answer, ethDecoded.feed.decimals);
        }
      }

      // Second pass: build price map
      for (const item of decoded) {
        if (!item) continue;
        const { symbol, data, feed } = item;

        let price = answerToPrice(data.answer, feed.decimals);

        // Convert SHIB/ETH to SHIB/USD
        if (symbol === "SHIB" && feed.pair.includes("ETH")) {
          if (ethPrice > 0) {
            price = price * ethPrice;
          } else {
            // Skip SHIB if we can't convert — CoinCap/CoinGecko will provide it
            continue;
          }
        }

        // Stale check: feed hasn't updated in >24 hours
        const staleSec = now - data.updatedAt;
        const isStale = staleSec > 86_400;

        if (price > 0) {
          prices[symbol] = {
            price,
            updatedAt: data.updatedAt,
            feedAddress: feed.address,
            pair: feed.pair,
            roundId: data.roundId,
            isStale,
          };
        }
      }

      const elapsedMs = Date.now() - startMs;

      // Update cache
      _cache = { data: prices, timestamp: Date.now() };

      // Update stats
      updateOracleStats({
        chainlinkCount: Object.keys(prices).length,
        lastFetchMs: elapsedMs,
        rpcEndpoint: rpcUrl,
      });

      console.debug(
        `[Chainlink] ✓ ${Object.keys(prices).length}/${feedSymbols.length} feeds via ${(() => { try { return new URL(rpcUrl).hostname; } catch { return rpcUrl; } })()} (${elapsedMs}ms)`
      );

      return prices;
    } catch (err) {
      lastError = err as Error;
      const host = (() => { try { return new URL(rpcUrl).hostname; } catch { return rpcUrl; } })();
      // Network errors are expected in sandboxed environments — use debug level
      if (lastError instanceof TypeError && lastError.message === "Failed to fetch") {
        console.debug(`[Chainlink] RPC unreachable (${host})`);
      } else {
        console.debug(`[Chainlink] RPC failed (${host}):`, lastError.message);
      }
      continue; // Try next RPC endpoint
    }
  }

  // All endpoints failed
  if (lastError instanceof TypeError && lastError.message === "Failed to fetch") {
    console.debug("[Chainlink] All RPC endpoints unreachable (network/CORS) — using fallback");
  } else {
    console.debug("[Chainlink] All RPC endpoints failed:", lastError?.message);
  }
  return {};
}

// ── Convert Chainlink data to CoinPrice format ─────────────────────
// Used by the merged oracle pipeline in coingecko.ts
// NOTE: image is left empty here — the merge logic in coingecko.ts fills it in
export function chainlinkToCoinPrices(
  chainlinkData: Record<string, ChainlinkPriceData>,
  symbols: string[]
): Record<string, CoinPrice> {
  const result: Record<string, CoinPrice> = {};

  for (const symbol of symbols) {
    const cl = chainlinkData[symbol];
    if (!cl) continue;

    result[symbol] = {
      id: symbol.toLowerCase(),
      symbol: symbol.toLowerCase(),
      name: symbol,
      current_price: cl.price,
      price_change_percentage_24h: 0, // Chainlink doesn't provide 24h change
      market_cap: 0,
      total_volume: 0,
      image: "",  // Populated by merge logic in coingecko.ts
      oracle_source: "chainlink" as OracleSource,
      oracle_updated_at: cl.updatedAt,
      chainlink_feed: cl.feedAddress,
    };
  }

  return result;
}

// ── Utility: Check if a symbol has a Chainlink feed ────────────────
export function hasChainlinkFeed(symbol: string): boolean {
  return symbol in CHAINLINK_FEEDS;
}

// ── Utility: Get feed info for display ─────────────────────────────
export function getFeedInfo(symbol: string): { address: string; pair: string } | null {
  const feed = CHAINLINK_FEEDS[symbol];
  return feed ? { address: feed.address, pair: feed.pair } : null;
}

// ── Utility: Format time since last oracle update ──────────────────
export function formatOracleAge(updatedAt: number): string {
  const sec = Math.floor(Date.now() / 1000) - updatedAt;
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
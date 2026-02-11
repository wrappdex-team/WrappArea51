const MIRROR_NODE = "https://mainnet-public.mirrornode.hedera.com";
const HASHSCAN_URL = "https://hashscan.io/mainnet";

export type HederaNetwork = "mainnet" | "testnet";

export interface HederaAccountInfo {
  accountId: string;
  network: HederaNetwork;
  hbarBalance: number;
  hbarBalanceTinybar: number;
  evmAddress: string;
  key: string;
  memo: string;
  createdTimestamp: string;
  expirationTimestamp: string;
  autoRenewPeriod: number;
  deleted: boolean;
  tokens: HederaTokenBalance[];
  nfts: number;
  stakingInfo: {
    stakedNodeId: number | null;
    stakedAccountId: string | null;
    stakePeriodStart: string | null;
    pendingReward: number;
    declineReward: boolean;
  };
}

export interface HederaTokenBalance {
  tokenId: string;
  balance: number;
  decimals: number;
  symbol: string;
  name: string;
  rawBalance: number;
}

export interface HederaTransaction {
  transactionId: string;
  type: string;
  consensusTimestamp: string;
  transfers: Array<{ account: string; amount: number }>;
  result: string;
  name: string;
}

export function isValidAccountId(accountId: string): boolean {
  return /^0\.0\.\d+$/.test(accountId.trim());
}

export function tinybarToHbar(tinybars: number): number {
  return tinybars / 100_000_000;
}

export function formatHbar(hbar: number): string {
  if (hbar >= 1_000_000) return `${(hbar / 1_000_000).toFixed(2)}M`;
  if (hbar >= 1_000) return `${(hbar / 1_000).toFixed(2)}K`;
  if (hbar >= 1) return hbar.toFixed(4);
  return hbar.toFixed(8);
}

export function getHashScanAccountUrl(accountId: string, _network?: HederaNetwork): string {
  return `${HASHSCAN_URL}/account/${accountId}`;
}

export function getHashScanTxUrl(txId: string, _network?: HederaNetwork): string {
  return `${HASHSCAN_URL}/transaction/${txId}`;
}

export async function fetchAccountInfo(
  accountId: string,
  _network?: HederaNetwork
): Promise<HederaAccountInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${MIRROR_NODE}/api/v1/accounts/${accountId.trim()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Mirror node returned ${response.status}`);
    }
    const data = await response.json();
    const tokens = await fetchTokenBalances(accountId);
    const hbarTinybar = data.balance?.balance ?? 0;

    return {
      accountId: data.account,
      network: "mainnet",
      hbarBalance: tinybarToHbar(hbarTinybar),
      hbarBalanceTinybar: hbarTinybar,
      evmAddress: data.evm_address || "",
      key: data.key?.key || "",
      memo: data.memo || "",
      createdTimestamp: data.created_timestamp || "",
      expirationTimestamp: data.expiry_timestamp || "",
      autoRenewPeriod: data.auto_renew_period || 0,
      deleted: data.deleted || false,
      tokens,
      nfts: data.balance?.tokens?.filter((t: { token_id: string }) => t.balance === 0).length ?? 0,
      stakingInfo: {
        stakedNodeId: data.staked_node_id ?? null,
        stakedAccountId: data.staked_account_id ?? null,
        stakePeriodStart: data.stake_period_start ?? null,
        pendingReward: tinybarToHbar(data.pending_reward ?? 0),
        declineReward: data.decline_reward ?? false,
      },
    };
  } catch {
    return null;
  }
}

async function fetchTokenBalances(accountId: string): Promise<HederaTokenBalance[]> {
  try {
    const allRawTokens: Array<{ token_id: string; balance: number }> = [];
    let nextUrl: string | null = `${MIRROR_NODE}/api/v1/accounts/${accountId.trim()}/tokens?limit=100`;
    let pages = 0;

    while (nextUrl && pages < 5) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(nextUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) break;
      const data = await response.json();
      allRawTokens.push(...(data.tokens || []));
      const rawNext: string | undefined = data.links?.next;
      nextUrl = rawNext ? (rawNext.startsWith("http") ? rawNext : `${MIRROR_NODE}${rawNext}`) : null;
      pages++;
    }

    if (allRawTokens.length === 0) return [];

    const BATCH = 15;
    const results: HederaTokenBalance[] = [];
    for (let i = 0; i < allRawTokens.length; i += BATCH) {
      const batch = allRawTokens.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map(async (t) => {
          try {
            const info = await fetchTokenInfo(t.token_id);
            const decimals = info?.decimals ?? 0;
            return {
              tokenId: t.token_id,
              balance: t.balance / Math.pow(10, decimals),
              decimals,
              symbol: info?.symbol || t.token_id,
              name: info?.name || "Unknown Token",
              rawBalance: t.balance,
            };
          } catch {
            return { tokenId: t.token_id, balance: t.balance, decimals: 0, symbol: t.token_id, name: "Unknown Token", rawBalance: t.balance };
          }
        })
      );
      results.push(...batchResults);
    }
    return results;
  } catch {
    return [];
  }
}

// ── Direct HBAR.ħ token balance fetch ────────────────────────────

export interface HbarhDirectBalance {
  rawBalance: number;
  balance: number;
  decimals: number;
  associated: boolean;
}

const HBARH_TOKEN_ID_HEDERA = "0.0.9356476";

export async function fetchHbarhBalance(accountId: string): Promise<HbarhDirectBalance> {
  const notAssociated: HbarhDirectBalance = { rawBalance: 0, balance: 0, decimals: 8, associated: false };
  try {
    const tokenInfo = await fetchTokenInfo(HBARH_TOKEN_ID_HEDERA);
    const decimals = tokenInfo?.decimals ?? 8;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const url = `${MIRROR_NODE}/api/v1/accounts/${accountId.trim()}/tokens?token.id=${HBARH_TOKEN_ID_HEDERA}&limit=1`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return notAssociated;
    const data = await res.json();
    const tokens: Array<{ token_id: string; balance: number }> = data.tokens || [];
    if (tokens.length === 0) return notAssociated;
    const raw = tokens[0].balance ?? 0;
    return { rawBalance: raw, balance: raw / Math.pow(10, decimals), decimals, associated: true };
  } catch {
    return notAssociated;
  }
}

// ── Token info cache (5 min TTL) ─────────────────────────────────

const tokenInfoCache = new Map<string, { data: { symbol: string; name: string; decimals: number }; ts: number }>();

async function fetchTokenInfo(
  tokenId: string
): Promise<{ symbol: string; name: string; decimals: number } | null> {
  const cached = tokenInfoCache.get(tokenId);
  if (cached && Date.now() - cached.ts < 300_000) return cached.data;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${MIRROR_NODE}/api/v1/tokens/${tokenId}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    const result = { symbol: data.symbol || tokenId, name: data.name || "Unknown", decimals: data.decimals ? parseInt(data.decimals) : 0 };
    tokenInfoCache.set(tokenId, { data: result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}

export async function fetchRecentTransactions(
  accountId: string,
  _network?: HederaNetwork,
  limit = 15
): Promise<HederaTransaction[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(
      `${MIRROR_NODE}/api/v1/transactions?account.id=${accountId.trim()}&limit=${limit}&order=desc`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.transactions || []).map((tx: any) => ({
      transactionId: tx.transaction_id,
      type: tx.name,
      consensusTimestamp: tx.consensus_timestamp,
      transfers: (tx.transfers || []).map((t: any) => ({ account: t.account, amount: tinybarToHbar(t.amount) })),
      result: tx.result,
      name: TX_NAME_MAP[tx.name] || tx.name.replace(/([A-Z])/g, " $1").trim(),
    }));
  } catch {
    return [];
  }
}

const TX_NAME_MAP: Record<string, string> = {
  CRYPTOTRANSFER: "Transfer",
  CRYPTOAPPROVEALLOWANCE: "Approve Allowance",
  CRYPTOCREATEACCOUNT: "Create Account",
  CRYPTOUPDATEACCOUNT: "Update Account",
  CRYPTODELETE: "Delete Account",
  TOKENASSOCIATE: "Token Associate",
  TOKENDISSOCIATE: "Token Dissociate",
  TOKENMINT: "Token Mint",
  TOKENBURN: "Token Burn",
  TOKENCREATION: "Token Create",
  CONTRACTCALL: "Contract Call",
  CONTRACTCREATEINSTANCE: "Contract Create",
  CONSENSUSSUBMITMESSAGE: "Submit Message",
  CONSENSUSCREATETOPIC: "Create Topic",
};

export async function fetchHbarPrice(): Promise<number> {
  // ── Short-circuit: return cached price if < 5 min old ──
  if (_lastKnownHbarPrice > 0 && Date.now() - _lastHbarPriceTs < 300_000) {
    return _lastKnownHbarPrice;
  }

  const LAST_RESORT_FALLBACK = 0.20;

  // ── Fire ALL oracles in parallel — first valid result wins ──
  const price = await _raceOracles(10_000);

  if (price > 0) {
    _lastKnownHbarPrice = price;
    _lastHbarPriceTs = Date.now();
    return price;
  }

  // ── Fallback: cached price from any previous successful fetch ──
  if (_lastKnownHbarPrice > 0) {
    console.debug(`[HBAR.h] Oracles slow — reusing cached price $${_lastKnownHbarPrice}`);
    return _lastKnownHbarPrice;
  }

  // ── Last resort hardcoded fallback ──
  console.debug(`[HBAR.h] No cached price — using fallback $${LAST_RESORT_FALLBACK}`);
  _lastKnownHbarPrice = LAST_RESORT_FALLBACK;
  _lastHbarPriceTs = Date.now();
  return LAST_RESORT_FALLBACK;
}

/**
 * Races multiple price oracles in parallel.
 * Returns the first valid price (> 0.001 and < 50) or 0 if all fail/timeout.
 */
async function _raceOracles(timeoutMs: number): Promise<number> {
  return new Promise<number>((resolve) => {
    let settled = false;
    let pending = 0;

    const tryResolve = (price: number) => {
      if (settled) return;
      if (typeof price === "number" && price > 0.001 && price < 50) {
        settled = true;
        resolve(price);
      }
    };

    const onDone = () => {
      pending--;
      if (pending <= 0 && !settled) {
        settled = true;
        resolve(0);
      }
    };

    const oracles = [
      _fetchPriceBinance,
      _fetchPriceCoinGecko,
      _fetchPriceCoinCap,
      _fetchPriceSaucerSwap,
      _fetchPriceDexScreener,
    ];

    pending = oracles.length;

    for (const fn of oracles) {
      fn(timeoutMs).then(tryResolve).catch(() => {}).finally(onDone);
    }

    // Global timeout — if nothing responds in time, resolve 0
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(0);
      }
    }, timeoutMs + 1000);
  });
}

/** Helper: fetch with timeout + AbortController */
async function _timedFetch(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    return res;
  } catch (err) {
    clearTimeout(tid);
    throw err;
  }
}

// ── Oracle: Binance (most reliable, great CORS support) ──
async function _fetchPriceBinance(ms: number): Promise<number> {
  const res = await _timedFetch("https://api.binance.com/api/v3/ticker/price?symbol=HBARUSDT", ms);
  if (!res.ok) return 0;
  const data = await res.json();
  return parseFloat(data?.price || "0");
}

// ── Oracle: CoinGecko ──
async function _fetchPriceCoinGecko(ms: number): Promise<number> {
  const res = await _timedFetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd",
    ms
  );
  if (!res.ok) return 0;
  const data = await res.json();
  return data?.["hedera-hashgraph"]?.usd ?? 0;
}

// ── Oracle: CoinCap ──
async function _fetchPriceCoinCap(ms: number): Promise<number> {
  const res = await _timedFetch("https://api.coincap.io/v2/assets/hedera-hashgraph", ms);
  if (!res.ok) return 0;
  const data = await res.json();
  return parseFloat(data?.data?.priceUsd || "0");
}

// ── Oracle: SaucerSwap (WHBAR price from /tokens list) ──
async function _fetchPriceSaucerSwap(ms: number): Promise<number> {
  // SaucerSwap V1 /tokens returns an array of all tokens
  const res = await _timedFetch("https://api.saucerswap.finance/tokens", ms);
  if (!res.ok) return 0;
  const tokens: Array<{ id?: string; priceUsd?: number | string }> = await res.json();
  if (!Array.isArray(tokens)) return 0;
  // WHBAR token ID on Hedera mainnet
  const whbar = tokens.find(
    (t) => t.id === "0.0.1456986" || t.id === "1456986"
  );
  if (!whbar) return 0;
  const p = typeof whbar.priceUsd === "number" ? whbar.priceUsd : parseFloat(String(whbar.priceUsd || "0"));
  return p > 0 ? p : 0;
}

// ── Oracle: DexScreener (HBAR pairs) ──
async function _fetchPriceDexScreener(ms: number): Promise<number> {
  // DexScreener uses the Hedera token ID format
  const res = await _timedFetch(
    "https://api.dexscreener.com/latest/dex/tokens/0.0.1456986",
    ms
  );
  if (!res.ok) return 0;
  const data = await res.json();
  const pairs: Array<{ priceUsd?: string; liquidity?: { usd?: number } }> = data?.pairs || [];
  // Pick the pair with highest liquidity for most accurate price
  let bestPrice = 0;
  let bestLiq = 0;
  for (const pair of pairs) {
    const p = parseFloat(pair?.priceUsd || "0");
    const liq = pair?.liquidity?.usd ?? 0;
    if (p > 0.001 && p < 50 && liq > bestLiq) {
      bestPrice = p;
      bestLiq = liq;
    }
  }
  return bestPrice;
}

// Module-level HBAR price cache — survives across calls to avoid
// repeatedly returning a stale hardcoded fallback when APIs are rate-limited.
let _lastKnownHbarPrice = 0;
let _lastHbarPriceTs = 0;

/**
 * Generic token balance fetcher from Mirror Node.
 * Returns { rawBalance, balance, decimals, associated }.
 */
export interface TokenDirectBalance {
  rawBalance: number;
  balance: number;
  decimals: number;
  associated: boolean;
}

export async function fetchTokenDirectBalance(
  accountId: string,
  tokenId: string,
  _network?: HederaNetwork
): Promise<TokenDirectBalance> {
  const notAssociated: TokenDirectBalance = { rawBalance: 0, balance: 0, decimals: 0, associated: false };
  try {
    const info = await fetchTokenInfo(tokenId);
    const decimals = info?.decimals ?? 0;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const url = `${MIRROR_NODE}/api/v1/accounts/${accountId.trim()}/tokens?token.id=${tokenId}&limit=1`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return notAssociated;
    const data = await res.json();
    const tokens: Array<{ token_id: string; balance: number }> = data.tokens || [];
    if (tokens.length === 0) return notAssociated;
    const raw = tokens[0].balance ?? 0;
    return { rawBalance: raw, balance: raw / Math.pow(10, decimals), decimals, associated: true };
  } catch {
    return notAssociated;
  }
}

export async function isTokenAssociated(
  accountId: string,
  tokenId: string,
  _network?: HederaNetwork
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(
      `${MIRROR_NODE}/api/v1/accounts/${accountId.trim()}/tokens?token.id=${tokenId}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data.tokens) && data.tokens.length > 0;
  } catch {
    return false;
  }
}

// ── NFTs ──

export interface HederaNFT {
  tokenId: string;
  serialNumber: number;
  metadata: string;
  createdTimestamp: string;
  collectionName: string;
  collectionSymbol: string;
}

export async function fetchAccountNFTs(
  accountId: string,
  _network?: HederaNetwork,
  limit = 25
): Promise<HederaNFT[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(
      `${MIRROR_NODE}/api/v1/accounts/${accountId.trim()}/nfts?limit=${limit}&order=desc`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) return [];
    const data = await response.json();
    const nfts: Array<{ token_id: string; serial_number: number; metadata: string; created_timestamp: string }> = data.nfts || [];
    const tokenIdSet = new Set(nfts.map((n) => n.token_id));
    const collectionMap = new Map<string, { name: string; symbol: string }>();
    await Promise.all(
      [...tokenIdSet].slice(0, 10).map(async (tid) => {
        try {
          const controller2 = new AbortController();
          const t2 = setTimeout(() => controller2.abort(), 6000);
          const r = await fetch(`${MIRROR_NODE}/api/v1/tokens/${tid}`, { signal: controller2.signal });
          clearTimeout(t2);
          if (r.ok) { const d = await r.json(); collectionMap.set(tid, { name: d.name || "Unknown", symbol: d.symbol || "NFT" }); }
        } catch { /* skip */ }
      })
    );
    return nfts.map((n) => {
      const col = collectionMap.get(n.token_id);
      return {
        tokenId: n.token_id, serialNumber: n.serial_number,
        metadata: n.metadata ? atob(n.metadata) : "",
        createdTimestamp: n.created_timestamp || "",
        collectionName: col?.name || n.token_id, collectionSymbol: col?.symbol || "NFT",
      };
    });
  } catch {
    return [];
  }
}

// ── Network Stats ──

export interface HederaNetworkStats {
  totalAccounts: number;
  totalTransactions: number;
  tps: number;
  avgFee: number;
}

export async function fetchNetworkStats(): Promise<HederaNetworkStats> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    await fetch(`${MIRROR_NODE}/api/v1/network/supply`, { signal: controller.signal });
    clearTimeout(timeout);
    const blocksRes = await fetch(`${MIRROR_NODE}/api/v1/blocks?limit=5&order=desc`);
    let avgTps = 150;
    if (blocksRes.ok) {
      const blocks = await blocksRes.json();
      if (blocks.blocks?.length > 0) {
        const txCounts = blocks.blocks.map((b: any) => b.count || 0);
        avgTps = Math.round(txCounts.reduce((s: number, c: number) => s + c, 0) / txCounts.length / 2);
      }
    }
    return { totalAccounts: 8_500_000, totalTransactions: 28_000_000_000, tps: avgTps || 150, avgFee: 0.0001 };
  } catch {
    return { totalAccounts: 8_500_000, totalTransactions: 28_000_000_000, tps: 150, avgFee: 0.0001 };
  }
}

export function getStakingRewardEstimate(
  hbarBalance: number,
  annualRate = 0.065
): { daily: number; monthly: number; annual: number } {
  const annual = hbarBalance * annualRate;
  return { daily: annual / 365, monthly: annual / 12, annual };
}

export interface ScheduledTransferParams {
  senderAccountId: string;
  recipientAccountId: string;
  amountHbar: number;
  amountTinybar: number;
  memo: string;
  expirationTime: Date;
}

export function prepareScheduledTransfer(
  sender: string, recipient: string, amountHbar: number, memo = "", expiresInDays = 30
): ScheduledTransferParams {
  const expirationTime = new Date();
  expirationTime.setDate(expirationTime.getDate() + expiresInDays);
  return {
    senderAccountId: sender.trim(), recipientAccountId: recipient.trim(),
    amountHbar, amountTinybar: Math.round(amountHbar * 100_000_000),
    memo: memo || "HBAR.ħ scheduled transfer", expirationTime,
  };
}

export function formatTimestamp(consensusTimestamp: string): string {
  if (!consensusTimestamp) return "Unknown";
  const [seconds] = consensusTimestamp.split(".");
  return new Date(parseInt(seconds) * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatTimestampRelative(consensusTimestamp: string): string {
  if (!consensusTimestamp) return "Unknown";
  const [seconds] = consensusTimestamp.split(".");
  const diffMs = Date.now() - parseInt(seconds) * 1000;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(diffMs / 3600000);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(diffMs / 86400000);
  if (day < 30) return `${day}d ago`;
  return new Date(parseInt(seconds) * 1000).toLocaleDateString();
}

export function getTokenExplorerUrl(tokenId: string): string {
  return `${HASHSCAN_URL}/token/${tokenId}`;
}

export function getNFTExplorerUrl(tokenId: string, serialNumber: number): string {
  return `${HASHSCAN_URL}/token/${tokenId}/${serialNumber}`;
}

export function truncateAccountId(accountId: string): string {
  if (accountId.length <= 12) return accountId;
  return `${accountId.slice(0, 6)}...${accountId.slice(-4)}`;
}
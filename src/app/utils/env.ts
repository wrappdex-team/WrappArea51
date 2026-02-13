/**
 * Environment Configuration
 * Centralizes API endpoints, feature flags, and app constants.
 *
 * Note: Public-facing keys (WalletConnect, ChangeNow) use hardcoded
 * fallbacks with a runtime production warning if env vars are missing.
 * No secrets or service role keys exist in any frontend file.
 */

const IS_PROD = import.meta.env.PROD ?? false;
const IS_DEV = import.meta.env.DEV ?? true;

const SAUCERSWAP_API = "https://api.saucerswap.finance";
const MIRROR_NODE = "https://mainnet-public.mirrornode.hedera.com";
const HASHSCAN_URL = "https://hashscan.io/mainnet";
const COINCAP_API = "https://api.coincap.io/v2";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const BONZO_APP_URL = "https://app.bonzo.finance/lend";

const WALLETCONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "44b5b74e402af9f8e3c14ce8e4d2d2a0";
const DYNAMIC_ENVIRONMENT_ID =
  import.meta.env.VITE_DYNAMIC_ENV_ID || "7e0e9ad0-5717-40f4-8aa4-5a2bdc7f062e";
const CHANGENOW_AFFILIATE_ID =
  import.meta.env.VITE_CHANGENOW_AFFILIATE_ID || "4de8efb2ccff7a";

// [AUDIT-E01] Runtime check — warn once in production if env vars are missing
if (IS_PROD) {
  const missing: string[] = [];
  if (!import.meta.env.VITE_WALLETCONNECT_PROJECT_ID) missing.push("VITE_WALLETCONNECT_PROJECT_ID");
  if (!import.meta.env.VITE_DYNAMIC_ENV_ID) missing.push("VITE_DYNAMIC_ENV_ID");
  if (!import.meta.env.VITE_CHANGENOW_AFFILIATE_ID) missing.push("VITE_CHANGENOW_AFFILIATE_ID");
  if (missing.length > 0) {
    console.warn(`[SECURITY] Production build using hardcoded fallback values for: ${missing.join(", ")}. Set these env vars to enable rotation without redeployment.`);
  }
}

const HBARH_TOKEN_ID = "0.0.9356476";
const VIP_NFT_TOKEN_ID = "0.0.10146181";
const VIP_TOKEN_THRESHOLD = 100_000_000;
const VIP_NFT_VOTE_RATIO = 3;

const FEATURES = {
  STAKING_LIVE: false,
  BONZO_LIVE_RATES: false,
  DEBUG_PANELS: IS_DEV,
  PERF_MONITORING: true,
} as const;

const RATE_LIMITS = {
  DEFI_STATS_CACHE_MS: 60_000,
  TOKEN_PRICE_CACHE_MS: 30_000,
  HBAR_PRICE_REFRESH_MS: 30_000,
  BALANCE_REFRESH_MS: 60_000,
} as const;

const TIMEOUTS = {
  API_DEFAULT_MS: 10_000,
  WALLETCONNECT_PAIRING_MS: 120_000,
  EXTENSION_DETECT_MS: 3_000,
  SWAP_TX_MS: 60_000,
  MIRROR_VERIFY_MS: 15_000,
} as const;

export const ENV = {
  IS_PROD,
  IS_DEV,
  SAUCERSWAP_API,
  MIRROR_NODE,
  HASHSCAN_URL,
  COINCAP_API,
  COINGECKO_API,
  BONZO_APP_URL,
  WALLETCONNECT_PROJECT_ID,
  DYNAMIC_ENVIRONMENT_ID,
  CHANGENOW_AFFILIATE_ID,
  HBARH_TOKEN_ID,
  VIP_NFT_TOKEN_ID,
  VIP_TOKEN_THRESHOLD,
  VIP_NFT_VOTE_RATIO,
  FEATURES,
  RATE_LIMITS,
  TIMEOUTS,
  APP_NAME: "HBAR.ħ",
  APP_VERSION: import.meta.env.VITE_APP_VERSION || "1.0.0",
  APP_URL: import.meta.env.VITE_APP_URL || "https://hbar.exchange",
} as const;
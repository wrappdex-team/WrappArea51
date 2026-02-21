import { TOKEN_LOGOS } from "./coingecko";

export type TokenCategory = "layer1" | "stablecoin" | "defi";

export interface TokenDef {
  symbol: string;
  name: string;
  category: TokenCategory;
  volatility: number;
  fallbackPrice: number;
  fallbackChange: number;
  logo: string;
}

// Single source of truth for all supported tokens.
// Dashboard, Trading, and other components derive their token lists from this.
export const TOKEN_REGISTRY: TokenDef[] = [
  { symbol: "BTC",   name: "Bitcoin",    category: "layer1",      volatility: 0.06,  fallbackPrice: 97845,      fallbackChange: 3.24,  logo: TOKEN_LOGOS.BTC },
  { symbol: "ETH",   name: "Ethereum",   category: "layer1",      volatility: 0.06,  fallbackPrice: 3678,       fallbackChange: 2.87,  logo: TOKEN_LOGOS.ETH },
  { symbol: "USDT",  name: "Tether",     category: "stablecoin",  volatility: 0.002, fallbackPrice: 1.0001,     fallbackChange: 0.01,  logo: TOKEN_LOGOS.USDT },
  { symbol: "BNB",   name: "BNB",        category: "layer1",      volatility: 0.04,  fallbackPrice: 634.21,     fallbackChange: 1.45,  logo: TOKEN_LOGOS.BNB },
  { symbol: "SOL",   name: "Solana",     category: "layer1",      volatility: 0.12,  fallbackPrice: 186.73,     fallbackChange: 5.67,  logo: TOKEN_LOGOS.SOL },
  { symbol: "USDC",  name: "USD Coin",   category: "stablecoin",  volatility: 0.002, fallbackPrice: 1.0002,     fallbackChange: 0.01,  logo: TOKEN_LOGOS.USDC },
  { symbol: "USDCh", name: "Hedera USD Coin", category: "stablecoin", volatility: 0.002, fallbackPrice: 1.0001, fallbackChange: 0.0,   logo: TOKEN_LOGOS.USDCh },
  { symbol: "EURC",  name: "EURC",       category: "stablecoin",  volatility: 0.003, fallbackPrice: 1.0856,     fallbackChange: 0.12,  logo: TOKEN_LOGOS.EURC },
  { symbol: "PAXG",  name: "PAX Gold",   category: "stablecoin",  volatility: 0.04,  fallbackPrice: 2678.45,    fallbackChange: 0.89,  logo: TOKEN_LOGOS.PAXG },
  { symbol: "XRP",   name: "XRP",        category: "layer1",      volatility: 0.04,  fallbackPrice: 2.43,       fallbackChange: -1.23, logo: TOKEN_LOGOS.XRP },
  { symbol: "HBAR",  name: "Hedera",     category: "layer1",      volatility: 0.16,  fallbackPrice: 0.10,       fallbackChange: 2.5,   logo: TOKEN_LOGOS.HBAR }, // [C33-01] Updated from 0.28
  { symbol: "DOGE",  name: "Dogecoin",   category: "layer1",      volatility: 0.08,  fallbackPrice: 0.3421,     fallbackChange: 4.23,  logo: TOKEN_LOGOS.DOGE },
  { symbol: "ADA",   name: "Cardano",    category: "layer1",      volatility: 0.04,  fallbackPrice: 0.9234,     fallbackChange: 2.34,  logo: TOKEN_LOGOS.ADA },
  { symbol: "AVAX",  name: "Avalanche",  category: "layer1",      volatility: 0.12,  fallbackPrice: 38.67,      fallbackChange: 6.78,  logo: TOKEN_LOGOS.AVAX },
  { symbol: "TRX",   name: "TRON",       category: "layer1",      volatility: 0.04,  fallbackPrice: 0.2456,     fallbackChange: 1.89,  logo: TOKEN_LOGOS.TRX },
  { symbol: "TON",   name: "Toncoin",    category: "layer1",      volatility: 0.08,  fallbackPrice: 5.82,       fallbackChange: 3.15,  logo: TOKEN_LOGOS.TON },
  { symbol: "LINK",  name: "Chainlink",  category: "defi",        volatility: 0.08,  fallbackPrice: 18.92,      fallbackChange: 5.34,  logo: TOKEN_LOGOS.LINK },
  { symbol: "AAVE",  name: "Aave",       category: "defi",        volatility: 0.08,  fallbackPrice: 180.0,      fallbackChange: 2.10,  logo: TOKEN_LOGOS.AAVE },
  { symbol: "DAI",   name: "Dai",        category: "stablecoin",  volatility: 0.002, fallbackPrice: 1.0000,     fallbackChange: 0.01,  logo: TOKEN_LOGOS.DAI },
  { symbol: "SHIB",  name: "Shiba Inu",  category: "layer1",      volatility: 0.15,  fallbackPrice: 0.00002234, fallbackChange: 6.12,  logo: TOKEN_LOGOS.SHIB },
  { symbol: "DOT",   name: "Polkadot",   category: "layer1",      volatility: 0.06,  fallbackPrice: 7.89,       fallbackChange: 4.12,  logo: TOKEN_LOGOS.DOT },
  { symbol: "LTC",   name: "Litecoin",   category: "layer1",      volatility: 0.05,  fallbackPrice: 95.43,      fallbackChange: 2.15,  logo: TOKEN_LOGOS.LTC },
  { symbol: "XMR",   name: "Monero",     category: "layer1",      volatility: 0.06,  fallbackPrice: 334,        fallbackChange: 1.20,  logo: TOKEN_LOGOS.XMR },
];

// Subsets for specific views
export const TRADING_TOKENS = TOKEN_REGISTRY.filter(
  (t) => !["USDT", "USDCh", "EURC"].includes(t.symbol)
);

export const ALL_SYMBOLS = TOKEN_REGISTRY.map((t) => t.symbol);

export function getTokenDef(symbol: string): TokenDef | undefined {
  return TOKEN_REGISTRY.find((t) => t.symbol === symbol);
}
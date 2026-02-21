/**
 * [C67] SaucerSwap Pure Helpers & URL Formatters
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: parseTokenAmount, formatTokenAmountRaw, formatUsdCompact,
 * formatTokenAmount, getSaucerSwapPoolUrl, getSaucerSwapSwapUrl,
 * getHashScanTxUrl, getHashScanTokenUrl, formatTxIdForMirrorNode.
 *
 * All functions are pure (no side effects, no network calls).
 */

import type { HederaNetwork } from "./tokens";

// ── Token Amount Parsing/Formatting ─────────────────────────────────

export function parseTokenAmount(amount: string, decimals: number): number {
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed * Math.pow(10, decimals));
}

export function formatTokenAmountRaw(rawAmount: number, decimals: number): string {
  return (rawAmount / Math.pow(10, decimals)).toFixed(decimals > 6 ? 8 : decimals);
}

// ── Compact Display Formatters ──────────────────────────────────────

export function formatUsdCompact(value: number): string {
  if (value >= 1000000000) return "$" + (value / 1000000000).toFixed(2) + "B";
  if (value >= 1000000) return "$" + (value / 1000000).toFixed(2) + "M";
  if (value >= 1000) return "$" + (value / 1000).toFixed(1) + "K";
  return "$" + value.toFixed(2);
}

export function formatTokenAmount(amount: number, decimals: number = 4): string {
  if (amount >= 1000000) return (amount / 1000000).toFixed(2) + "M";
  if (amount >= 1000) return (amount / 1000).toFixed(2) + "K";
  return amount.toFixed(decimals);
}

// ── SaucerSwap & HashScan URL Builders ──────────────────────────────

export function getSaucerSwapPoolUrl(poolId: string): string {
  return "https://www.saucerswap.finance/pool/" + poolId;
}

export function getSaucerSwapSwapUrl(tokenAId?: string, tokenBId?: string): string {
  if (tokenAId && tokenBId) {
    return "https://www.saucerswap.finance/swap?inputToken=" + tokenAId + "&outputToken=" + tokenBId;
  }
  return "https://www.saucerswap.finance/swap";
}

export function getHashScanTxUrl(txId: string, network: HederaNetwork = "mainnet"): string {
  // C25: Defensive guard -- txId may be null/undefined or a non-string SDK object
  if (!txId) return "#";
  const safeTxId = typeof txId === 'string' ? txId : String(txId);
  const base = network === "mainnet" ? "https://hashscan.io/mainnet" : "https://hashscan.io/testnet";
  // HashScan uses the same format as Mirror Node: account-seconds-nanos
  const normalized = formatTxIdForMirrorNode(safeTxId);
  return base + "/transaction/" + normalized;
}

export function getHashScanTokenUrl(tokenId: string, network: HederaNetwork = "mainnet"): string {
  const base = network === "mainnet" ? "https://hashscan.io/mainnet" : "https://hashscan.io/testnet";
  return base + "/token/" + tokenId;
}

// ── Transaction ID Formatting ───────────────────────────────────────

/**
 * Format a Hedera transaction ID for the Mirror Node REST API.
 *
 * Hedera SDK format:  "0.0.12345@1234567890.123456789"
 * Mirror Node format: "0.0.12345-1234567890-123456789"
 *
 * The @ separates the payer account from the valid-start timestamp,
 * and the . between seconds and nanos becomes a hyphen.
 * IMPORTANT: Dots within the account ID (0.0.xxxxx) must be PRESERVED.
 */
export function formatTxIdForMirrorNode(transactionId: string): string {
  // C25: Defensive guard -- transactionId may be a non-string (e.g. Hedera SDK TransactionId object)
  if (!transactionId || typeof transactionId !== 'string') {
    const asStr = transactionId ? String(transactionId) : '';
    if (!asStr) return asStr;
    return formatTxIdForMirrorNode(asStr);
  }
  // If already in Mirror Node format (contains no @), return as-is
  if (!transactionId.includes("@")) {
    return transactionId;
  }

  // Split on @ -> ["0.0.12345", "1234567890.123456789"]
  const atIdx = transactionId.indexOf("@");
  const accountPart = transactionId.substring(0, atIdx);
  const timestampPart = transactionId.substring(atIdx + 1);

  // Replace only the . between seconds and nanos in the timestamp part
  const normalizedTimestamp = timestampPart.replace(".", "-");
  return `${accountPart}-${normalizedTimestamp}`;
}

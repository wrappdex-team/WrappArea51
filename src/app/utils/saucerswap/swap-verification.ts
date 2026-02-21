/**
 * [C77] SaucerSwap Post-Swap Verification
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: SwapVerification, verifySwapTransaction, parseTransactionRecord,
 *           checkBalanceChange, ensureTokenAssociated, validateSwapPrerequisites
 *
 * Dependencies: tokens (HederaNetwork, resolveToken, isHbarWhbarPair, getWhbarToken, TOKEN_BY_HTS_ID),
 *               contracts (MIRROR_NODES), prices (makeAbort),
 *               balances (isTokenAssociated, getTokenBalance, getNativeHbarBalance),
 *               helpers (formatTxIdForMirrorNode), routing (findSwapRoute)
 */

import type { HederaNetwork } from "./tokens";
import { resolveToken, isHbarWhbarPair, getWhbarToken, TOKEN_BY_HTS_ID } from "./tokens";
import { MIRROR_NODES } from "./contracts";
import { makeAbort } from "./prices";
import { isTokenAssociated, getTokenBalance, getNativeHbarBalance } from "./balances";
import { formatTxIdForMirrorNode } from "./helpers";
import { findSwapRoute } from "./routing";

// ══════════════════════════════════════════════════════════════════════
// ── POST-SWAP VERIFICATION ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

export interface SwapVerification {
  verified: boolean;
  actualOutputAmount?: number;
  actualOutputSymbol?: string;
  inputDebited?: number;
  inputDebitedSymbol?: string;
  tokenTransfers: { token: string; account: string; amount: number }[];
  hbarTransfers: { account: string; amount: number }[];
  contractResults: string[];
  transactionStatus?: string;
  error?: string;
}

/**
 * Verify a completed swap by querying the Mirror Node transaction record.
 *
 * Fetches the actual token transfers from the transaction to confirm:
 * 1. Input tokens were debited from the user's account
 * 2. Output tokens were credited to the user's account
 *
 * This is critical for diagnosing the "tokens left wallet but output not received" issue.
 * The transaction record contains the definitive on-chain transfer list.
 *
 * Includes automatic retry logic since the Mirror Node may take several seconds
 * to index a new transaction after it reaches consensus.
 *
 * @param transactionId  Hedera transaction ID (e.g., "0.0.12345@1234567890.123456789")
 * @param accountId      User's Hedera account ID
 * @param outputTokenId  Expected output token HTS ID (or "native" for HBAR)
 * @param network        "mainnet" | "testnet"
 */
export async function verifySwapTransaction(
  transactionId: string,
  accountId: string,
  outputTokenId: string,
  network: HederaNetwork = "mainnet"
): Promise<SwapVerification> {
  const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
  const normalizedTxId = formatTxIdForMirrorNode(transactionId);

  console.log(`[HBAR.h] Verifying swap: ${transactionId} → normalized: ${normalizedTxId}`);

  // Retry loop — Mirror Node may need time to index the transaction.
  // 4 attempts × 4s delay = ~16s total wait, matching the UI auto-clear timeout.
  const MAX_RETRIES = 4;
  const RETRY_DELAY_MS = 4000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Wait before querying (Mirror Node indexing delay)
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));

    try {
      const res = await fetch(
        `${base}/api/v1/transactions/${normalizedTxId}`,
        { signal: makeAbort(15000) }
      );

      if (res.status === 404) {
        // Transaction not indexed yet — retry if we have attempts left
        if (attempt < MAX_RETRIES - 1) {
          console.log(`[HBAR.h] Tx not found yet (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
          continue;
        }
        return {
          verified: false,
          tokenTransfers: [],
          hbarTransfers: [],
          contractResults: [],
          error: `Transaction not found on Mirror Node after ${MAX_RETRIES} attempts. It may still be indexing — try manual verification in ~30 seconds.`,
        };
      }

      if (!res.ok) {
        // Non-404 error — don't retry, report immediately
        return {
          verified: false,
          tokenTransfers: [],
          hbarTransfers: [],
          contractResults: [],
          error: `Mirror Node returned HTTP ${res.status}. Try again later.`,
        };
      }

      const data = await res.json();
      return parseTransactionRecord(data, accountId, outputTokenId);
    } catch (err: any) {
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[HBAR.h] Verification attempt ${attempt + 1} failed:`, err?.message || err);
        continue;
      }
      return {
        verified: false,
        tokenTransfers: [],
        hbarTransfers: [],
        contractResults: [],
        error: `Verification failed after ${MAX_RETRIES} attempts: ${err?.message || "unknown error"}`,
      };
    }
  }

  // Should not reach here, but just in case
  return {
    verified: false,
    tokenTransfers: [],
    hbarTransfers: [],
    contractResults: [],
    error: "Verification exhausted all retries.",
  };
}

function parseTransactionRecord(
  data: any,
  accountId: string,
  outputTokenId: string
): SwapVerification {
  // The Mirror Node returns an object with `transactions` array.
  // For contract calls (swaps), there may be multiple transaction entries:
  // the parent (ContractExecuteTransaction) and child/inner transactions
  // generated by the router's internal EVM calls (token transfers, etc.).
  // We merge token_transfers and transfers from ALL entries to get the
  // complete picture.
  const txs = data.transactions || [data];
  if (!txs.length || !txs[0]) {
    return {
      verified: false,
      tokenTransfers: [],
      hbarTransfers: [],
      contractResults: [],
      error: "No transaction data in response",
    };
  }

  // Use the first entry for status (parent transaction)
  const tx = txs[0];
  const status = tx.result || tx.status || "UNKNOWN";

  // Merge token transfers from ALL transaction entries (parent + children)
  const tokenTransfers: { token: string; account: string; amount: number }[] = [];
  const seenTokenTransfers = new Set<string>();
  for (const entry of txs) {
    for (const tt of (entry.token_transfers || [])) {
      const key = `${tt.token_id}:${tt.account}:${tt.amount}`;
      if (!seenTokenTransfers.has(key)) {
        seenTokenTransfers.add(key);
        tokenTransfers.push({
          token: tt.token_id,
          account: tt.account,
          amount: tt.amount,
        });
      }
    }
  }

  // Merge HBAR transfers from ALL entries, filtering tiny fee transfers
  const hbarTransfers: { account: string; amount: number }[] = [];
  const seenHbarTransfers = new Set<string>();
  for (const entry of txs) {
    for (const ht of (entry.transfers || [])) {
      if (Math.abs(ht.amount) > 100000) { // Filter out tiny fee transfers (> 0.001 HBAR)
        const key = `${ht.account}:${ht.amount}`;
        if (!seenHbarTransfers.has(key)) {
          seenHbarTransfers.add(key);
          hbarTransfers.push({
            account: ht.account,
            amount: ht.amount,
          });
        }
      }
    }
  }

  // Find the output credited to the user
  let actualOutputAmount: number | undefined;
  let actualOutputSymbol: string | undefined;
  let inputDebited: number | undefined;
  let inputDebitedSymbol: string | undefined;

  if (outputTokenId === "native") {
    // Output is native HBAR — look for net HBAR credit to user.
    // Sum all HBAR transfers to the user's account to handle multi-transfer cases.
    const hbarToUser = hbarTransfers
      .filter(t => t.account === accountId && t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    if (hbarToUser > 0) {
      actualOutputAmount = hbarToUser / 1e8; // tinybars → HBAR
      actualOutputSymbol = "HBAR";
    }
  } else {
    // Output is an HTS token — look for token credit to user.
    // Sum positive transfers of the specific token.
    const tokenToUser = tokenTransfers
      .filter(t => t.token === outputTokenId && t.account === accountId && t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    if (tokenToUser > 0) {
      const outputMeta = TOKEN_BY_HTS_ID.get(outputTokenId);
      const decimals = outputMeta?.decimals || 8;
      actualOutputAmount = tokenToUser / Math.pow(10, decimals);
      actualOutputSymbol = outputMeta?.symbol || outputTokenId;
    }
  }

  // Find input debited from the user — sum negative transfers per token
  const debitsByToken = new Map<string, number>();
  for (const tt of tokenTransfers) {
    if (tt.account === accountId && tt.amount < 0) {
      const prev = debitsByToken.get(tt.token) || 0;
      debitsByToken.set(tt.token, prev + tt.amount);
    }
  }
  // Pick the largest debit (most value taken from user)
  let largestDebitToken: string | null = null;
  let largestDebitAmount = 0;
  for (const [token, amount] of debitsByToken) {
    if (Math.abs(amount) > Math.abs(largestDebitAmount)) {
      largestDebitAmount = amount;
      largestDebitToken = token;
    }
  }
  if (largestDebitToken) {
    const inputMeta = TOKEN_BY_HTS_ID.get(largestDebitToken);
    const decimals = inputMeta?.decimals || 8;
    inputDebited = Math.abs(largestDebitAmount) / Math.pow(10, decimals);
    inputDebitedSymbol = inputMeta?.symbol || largestDebitToken;
  } else {
    // Check HBAR debit (for native HBAR input)
    // Sum all negative HBAR transfers for the user
    const hbarFromUser = hbarTransfers
      .filter(t => t.account === accountId && t.amount < 0)
      .reduce((sum, t) => sum + t.amount, 0);
    if (Math.abs(hbarFromUser) > 1_000_000) { // > 0.01 HBAR (not just fees)
      inputDebited = Math.abs(hbarFromUser) / 1e8;
      inputDebitedSymbol = "HBAR";
    }
  }

  // Collect contract error messages from all entries
  const contractResults: string[] = [];
  for (const entry of txs) {
    if (entry.contract_results) {
      for (const cr of entry.contract_results) {
        const msg = cr.error_message || cr.result || "";
        if (msg) contractResults.push(msg);
      }
    }
  }

  const verified = status === "SUCCESS" && actualOutputAmount != null && actualOutputAmount > 0;

  console.log("[HBAR.h] Swap verification:", {
    status,
    verified,
    actualOutputAmount,
    actualOutputSymbol,
    inputDebited,
    inputDebitedSymbol,
    tokenTransfers: tokenTransfers.length,
    hbarTransfers: hbarTransfers.length,
    totalTxEntries: txs.length,
  });

  return {
    verified,
    actualOutputAmount,
    actualOutputSymbol,
    inputDebited,
    inputDebitedSymbol,
    tokenTransfers,
    hbarTransfers,
    contractResults,
    transactionStatus: status,
  };
}

/**
 * Check balance change for a specific token before and after a swap.
 * Returns the delta (positive = gained, negative = lost).
 *
 * @param accountId  Hedera account ID
 * @param tokenId    HTS token ID (or "native" for HBAR)
 * @param previousBalance  Balance before the swap (in raw units)
 * @param network    "mainnet" | "testnet"
 */
export async function checkBalanceChange(
  accountId: string,
  tokenId: string,
  previousBalance: number,
  network: HederaNetwork = "mainnet"
): Promise<{ currentBalance: number; delta: number; decimals: number }> {
  let currentBalance: number;
  let decimals: number;

  if (tokenId === "native") {
    currentBalance = await getNativeHbarBalance(accountId, network);
    decimals = 8;
  } else {
    currentBalance = await getTokenBalance(accountId, tokenId, network);
    const meta = TOKEN_BY_HTS_ID.get(tokenId);
    decimals = meta?.decimals || 8;
  }

  return {
    currentBalance,
    delta: currentBalance - previousBalance,
    decimals,
  };
}

// ══════════════════════════════════════════════════════════════════════
// ── TOKEN ASSOCIATION HANDLING ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Ensure the output token is associated with the user's account.
 * On Hedera, tokens must be explicitly associated before they can be received.
 * Returns { associated: true } if already associated or after successful association.
 */
export async function ensureTokenAssociated(
  accountId: string,
  tokenId: string,
  network: HederaNetwork = "mainnet"
): Promise<{ associated: boolean; error?: string; alreadyAssociated?: boolean; userCancelled?: boolean }> {
  // Check if already associated
  const alreadyAssociated = await isTokenAssociated(accountId, tokenId, network);
  if (alreadyAssociated) {
    return { associated: true, alreadyAssociated: true };
  }

  // Need to associate — use executeHederaTransaction from hashpack
  try {
    const { executeHederaTransaction } = await import("../hashpack");
    const sdk = await import("@hashgraph/sdk");
    const { TokenAssociateTransaction } = sdk;

    const associateTx = new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([tokenId]);

    const result = await executeHederaTransaction(accountId, associateTx);
    if (result.success) {
      return { associated: true, alreadyAssociated: false };
    } else {
      return { associated: false, error: result.error || "Association failed", userCancelled: result.userCancelled };
    }
  } catch (err: any) {
    const errMsg = err?.message || "Token association failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return { associated: false, error: errMsg, userCancelled: isCancellation || undefined };
  }
}

/**
 * Pre-swap validation: check all requirements before executing a swap.
 * Returns a list of issues that must be resolved.
 */
export async function validateSwapPrerequisites(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string,
  accountId: string,
  network: HederaNetwork
): Promise<{
  valid: boolean;
  issues: { type: "error" | "warning"; message: string }[];
  outputTokenAssociated: boolean;
}> {
  const issues: { type: "error" | "warning"; message: string }[] = [];
  let outputTokenAssociated = false;

  const inputToken = resolveToken(inputSymbol);
  const outputToken = resolveToken(outputSymbol);

  if (!inputToken) {
    issues.push({ type: "error", message: `Input token ${inputSymbol} not supported` });
    return { valid: false, issues, outputTokenAssociated };
  }
  if (!outputToken) {
    issues.push({ type: "error", message: `Output token ${outputSymbol} not supported` });
    return { valid: false, issues, outputTokenAssociated };
  }

  const amount = parseFloat(inputAmount);
  if (isNaN(amount) || amount <= 0) {
    issues.push({ type: "error", message: "Invalid input amount" });
    return { valid: false, issues, outputTokenAssociated };
  }

  // Check if this is a wrap/unwrap (HBAR<>WHBAR) — handled separately, not via pool routes
  const isWrapUnwrap = isHbarWhbarPair(inputSymbol, outputSymbol);

  // Check route exists (skip for wrap/unwrap which bypasses pool routing)
  const route = findSwapRoute(inputSymbol, outputSymbol);
  if (!route && !isWrapUnwrap) {
    issues.push({ type: "error", message: `No pool route found for ${inputSymbol} → ${outputSymbol}` });
    return { valid: false, issues, outputTokenAssociated };
  }

  // Check output token association
  // [C16-01] Native HBAR doesn't need association itself, but V2 pools
  // send WHBAR (HTS token) to the user — check WHBAR association too.
  try {
    if (outputToken.isNative) {
      outputTokenAssociated = true;
      // V2 swaps produce WHBAR even when user wants HBAR — pre-check association
      const whbarId = getWhbarToken().htsId;
      const whbarAssoc = await isTokenAssociated(accountId, whbarId, network);
      if (!whbarAssoc) {
        issues.push({
          type: "warning",
          message: `WHBAR (${whbarId}) is not associated — needed for V2 routing. It will be auto-associated before the swap.`,
        });
      }
    } else {
      outputTokenAssociated = await isTokenAssociated(accountId, outputToken.htsId, network);
      if (!outputTokenAssociated) {
        issues.push({
          type: "warning",
          message: `${outputToken.symbol} (${outputToken.htsId}) is not associated with your account. It will be associated before the swap.`,
        });
      }
    }
  } catch {
    issues.push({ type: "warning", message: "Could not verify token association status" });
  }

  // Check input token balance
  try {
    if (inputToken.isNative) {
      // Native HBAR: check account balance via Mirror Node
      const balanceTinybars = await getNativeHbarBalance(accountId, network);
      const rawNeeded = Math.floor(amount * Math.pow(10, 8)); // HBAR has 8 decimals
      if (balanceTinybars < rawNeeded) {
        const humanBalance = balanceTinybars / Math.pow(10, 8);
        issues.push({
          type: "error",
          message: `Insufficient HBAR balance: ${humanBalance.toFixed(4)} available, ${amount} needed`,
        });
      }
    } else {
      const balance = await getTokenBalance(accountId, inputToken.htsId, network);
      const rawNeeded = Math.floor(amount * Math.pow(10, inputToken.decimals));
      if (balance < rawNeeded) {
        const humanBalance = balance / Math.pow(10, inputToken.decimals);
        issues.push({
          type: "error",
          message: `Insufficient ${inputToken.symbol} balance: ${humanBalance.toFixed(4)} available, ${amount} needed`,
        });
      }
    }
  } catch {
    issues.push({ type: "warning", message: "Could not verify token balance" });
  }

  // Check for intermediate token associations in multi-hop routes
  if (route && route.path.length > 2) {
    for (let i = 1; i < route.path.length - 1; i++) {
      const midToken = route.path[i];
      try {
        const midAssociated = await isTokenAssociated(accountId, midToken.htsId, network);
        if (!midAssociated) {
          issues.push({
            type: "warning",
            message: `Intermediate token ${midToken.symbol} (${midToken.htsId}) is not associated. It will be associated before the swap.`,
          });
        }
      } catch { /* non-critical */ }
    }
  }

  return {
    valid: issues.filter(i => i.type === "error").length === 0,
    issues,
    outputTokenAssociated,
  };
}

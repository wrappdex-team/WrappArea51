/**
 * [C72] SaucerSwap Transaction Diagnostics & Network Health
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: TransactionDiagnosis, diagnoseTransaction, NetworkHealth, checkNetworkHealth
 *
 * Dependencies: tokens (HederaNetwork, TOKEN_BY_HTS_ID), contracts (MIRROR_NODES,
 *               SAUCERSWAP_V1_ROUTER, SAUCERSWAP_V1_ROUTER_CANDIDATES, SAUCERSWAP_V2_ROUTER),
 *               prices (makeAbort, saucerFetch), helpers (formatTxIdForMirrorNode),
 *               pools (discoverV2Factory), verification (verifyIsContract, getDiscoveredRouter)
 */

import type { HederaNetwork } from "./tokens";
import { TOKEN_BY_HTS_ID } from "./tokens";
import {
  MIRROR_NODES,
  SAUCERSWAP_V1_ROUTER, SAUCERSWAP_V1_ROUTER_CANDIDATES, SAUCERSWAP_V2_ROUTER,
} from "./contracts";
import { makeAbort, saucerFetch } from "./prices";
import { formatTxIdForMirrorNode } from "./helpers";
import { discoverV2Factory } from "./pools";
import { verifyIsContract, getDiscoveredRouter } from "./verification";

// ══════════════════════════════════════════════════════════════════════
// ── TRANSACTION DIAGNOSTICS ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Comprehensive post-mortem diagnostic for a Hedera transaction.
 * Fetches the full transaction record from Mirror Node and provides
 * a detailed breakdown of what happened — especially useful when a
 * swap "took money but didn't return tokens."
 *
 * Possible outcomes it detects:
 * - CONTRACT_REVERT_EXECUTED: swap reverted, user lost only gas fees
 * - SUCCESS with output: swap worked, tokens were received
 * - SUCCESS without output: swap claims success but no token transfer found
 * - Transaction not found: may still be indexing
 */
export interface TransactionDiagnosis {
  found: boolean;
  consensusTimestamp?: string;
  result?: string;
  chargedFee?: string;
  chargedFeeHbar?: number;
  transfers: {
    hbar: { account: string; amount: number; amountHbar: number }[];
    tokens: { token: string; tokenSymbol: string; account: string; amount: number; amountHuman: number }[];
  };
  contractCallResult?: {
    gasUsed: number;
    errorMessage: string;
    contractId: string;
  };
  diagnosis: string;
  error?: string;
}

export async function diagnoseTransaction(
  transactionIdOrTimestamp: string,
  userAccountId: string,
  expectedOutputTokenId?: string,
  network: HederaNetwork = "mainnet"
): Promise<TransactionDiagnosis> {
  const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;

  // Detect input format and build the correct API URL.
  //
  // Hedera transaction IDs contain "@" (SDK format: 0.0.12345@1234567890.123456789)
  // or "-" (Mirror Node format: 0.0.12345-1234567890-123456789) and always start
  // with an account ID like "0.0.".
  //
  // A bare consensus timestamp like "1770515132.278486502" contains only digits
  // and a single dot — it does NOT start with "0.0." and has no "@" or "-" after
  // the initial numbers. For this format we must use the ?timestamp= query param.
  const input = transactionIdOrTimestamp.trim();
  const isTimestamp = /^\d+\.\d+$/.test(input);
  const normalizedId = input.includes("@")
    ? formatTxIdForMirrorNode(input)
    : input;

  console.log(`[HBAR.h] Diagnosing: "${input}" (${isTimestamp ? "consensus timestamp" : "transaction ID"}) → "${normalizedId}"`);

  try {
    // Use the correct endpoint based on input format
    const url = isTimestamp
      ? `${base}/api/v1/transactions?timestamp=${normalizedId}&limit=1`
      : `${base}/api/v1/transactions/${normalizedId}`;
    const res = await fetch(url, { signal: makeAbort(15000) });

    if (!res.ok) {
      return {
        found: false,
        transfers: { hbar: [], tokens: [] },
        diagnosis: res.status === 404
          ? "Transaction not found. It may still be indexing on Mirror Node — try again in 30 seconds."
          : `Mirror Node returned HTTP ${res.status}.`,
        error: `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const txs = data.transactions || [data];
    if (!txs.length || !txs[0]) {
      return {
        found: false,
        transfers: { hbar: [], tokens: [] },
        diagnosis: "No transaction data in response.",
      };
    }

    const tx = txs[0];
    const result = tx.result || tx.status || "UNKNOWN";
    const chargedFee = tx.charged_tx_fee?.toString() || "0";
    const chargedFeeHbar = parseInt(chargedFee, 10) / 1e8;
    const consensusTimestamp = tx.consensus_timestamp;

    // Merge all transfers from parent + child transactions
    const hbarTransfers: { account: string; amount: number; amountHbar: number }[] = [];
    const tokenTransfers: { token: string; tokenSymbol: string; account: string; amount: number; amountHuman: number }[] = [];

    for (const entry of txs) {
      for (const ht of (entry.transfers || [])) {
        if (Math.abs(ht.amount) > 10000) { // > 0.0001 HBAR
          hbarTransfers.push({
            account: ht.account,
            amount: ht.amount,
            amountHbar: ht.amount / 1e8,
          });
        }
      }
      for (const tt of (entry.token_transfers || [])) {
        const meta = TOKEN_BY_HTS_ID.get(tt.token_id);
        const decimals = meta?.decimals || 8;
        tokenTransfers.push({
          token: tt.token_id,
          tokenSymbol: meta?.symbol || tt.token_id,
          account: tt.account,
          amount: tt.amount,
          amountHuman: tt.amount / Math.pow(10, decimals),
        });
      }
    }

    // Extract contract call result if available
    let contractCallResult: TransactionDiagnosis["contractCallResult"];
    for (const entry of txs) {
      if (entry.contract_results) {
        for (const cr of entry.contract_results) {
          contractCallResult = {
            gasUsed: parseInt(cr.gas_used || "0", 10),
            errorMessage: cr.error_message || "",
            contractId: cr.contract_id || "",
          };
        }
      }
    }

    // Build diagnosis string
    let diagnosis: string;

    // Check if the transaction was sent to the correct SaucerSwap router.
    // Uses the dynamically verified or configured router address.
    const calledContract = contractCallResult?.contractId || tx.entity_id || "";
    const expectedV1Router = getDiscoveredRouter("mainnet") || SAUCERSWAP_V1_ROUTER["mainnet"];
    const expectedV2Router = SAUCERSWAP_V2_ROUTER["mainnet"];
    const allCandidates = [
      ...(SAUCERSWAP_V1_ROUTER_CANDIDATES["mainnet"] || [expectedV1Router]),
      expectedV2Router,
    ];
    const isCorrectRouter = !calledContract || calledContract === expectedV1Router ||
      calledContract === expectedV2Router || allCandidates.includes(calledContract);
    const wrongRouterWarning = !isCorrectRouter
      ? ` WARNING: Transaction was sent to ${calledContract}, but the verified SaucerSwap routers are V1=${expectedV1Router}, V2=${expectedV2Router}. ` +
        `This is likely why the swap failed — funds were sent to the wrong contract/account. ` +
        `Known candidates: [${allCandidates.join(", ")}].`
      : "";

    if (result === "CONTRACT_REVERT_EXECUTED") {
      const gasUsed = contractCallResult?.gasUsed || 0;
      const errorMsg = contractCallResult?.errorMessage || "no revert reason";
      diagnosis = `SWAP REVERTED (CONTRACT_REVERT_EXECUTED). ` +
        `The SaucerSwap router rejected the swap. ` +
        `Gas charged: ${chargedFeeHbar.toFixed(4)} HBAR (${gasUsed.toLocaleString()} gas used). ` +
        `Your payable HBAR was refunded, but gas fees were consumed. ` +
        `Revert reason: ${errorMsg}. ` +
        `Common causes: output token not associated, insufficient pool liquidity, ` +
        `expired deadline, or the path/router address is incorrect.` +
        wrongRouterWarning;
    } else if (result === "SUCCESS") {
      // Check for output tokens received by user
      const userTokenCredits = tokenTransfers.filter(
        t => t.account === userAccountId && t.amount > 0
      );
      const userHbarCredits = hbarTransfers.filter(
        t => t.account === userAccountId && t.amount > 0
      );

      if (expectedOutputTokenId && expectedOutputTokenId !== "native") {
        const expectedCredits = userTokenCredits.filter(t => t.token === expectedOutputTokenId);
        if (expectedCredits.length > 0) {
          const total = expectedCredits.reduce((s, t) => s + t.amountHuman, 0);
          const sym = expectedCredits[0].tokenSymbol;
          diagnosis = `SWAP SUCCEEDED. You received ${total} ${sym}. Fee charged: ${chargedFeeHbar.toFixed(4)} HBAR.`;
        } else if (userTokenCredits.length > 0) {
          const received = userTokenCredits.map(t => `${t.amountHuman} ${t.tokenSymbol}`).join(", ");
          diagnosis = `SWAP SUCCEEDED but received different token(s) than expected. ` +
            `Received: ${received}. Expected output: ${expectedOutputTokenId}. Fee: ${chargedFeeHbar.toFixed(4)} HBAR.`;
        } else if (userHbarCredits.length > 0) {
          const totalHbar = userHbarCredits.reduce((s, t) => s + t.amountHbar, 0);
          diagnosis = `SWAP SUCCEEDED. You received ${totalHbar.toFixed(4)} HBAR. Fee: ${chargedFeeHbar.toFixed(4)} HBAR.`;
        } else {
          diagnosis = `Transaction shows SUCCESS but NO output tokens were credited to your account (${userAccountId}). ` +
            `This may indicate the tokens went to a different address or the transaction was sent to a non-router contract. ` +
            `Fee charged: ${chargedFeeHbar.toFixed(4)} HBAR. ` +
            `Check all token transfers on HashScan for the full picture.` +
            wrongRouterWarning;
        }
      } else {
        if (userTokenCredits.length > 0 || userHbarCredits.length > 0) {
          const parts: string[] = [];
          if (userTokenCredits.length) parts.push(userTokenCredits.map(t => `${t.amountHuman} ${t.tokenSymbol}`).join(", "));
          if (userHbarCredits.length) parts.push(userHbarCredits.reduce((s, t) => s + t.amountHbar, 0).toFixed(4) + " HBAR");
          diagnosis = `SWAP SUCCEEDED. Received: ${parts.join(" + ")}. Fee: ${chargedFeeHbar.toFixed(4)} HBAR.`;
        } else {
          diagnosis = `Transaction SUCCESS but no visible credits to ${userAccountId}. Fee: ${chargedFeeHbar.toFixed(4)} HBAR.` +
            wrongRouterWarning;
        }
      }
    } else {
      diagnosis = `Transaction status: ${result}. Fee charged: ${chargedFeeHbar.toFixed(4)} HBAR.` +
        wrongRouterWarning;
    }

    console.log("[HBAR.h] Transaction diagnosis:", {
      result, chargedFeeHbar, diagnosis,
      hbarTransfers: hbarTransfers.length,
      tokenTransfers: tokenTransfers.length,
    });

    return {
      found: true,
      consensusTimestamp,
      result,
      chargedFee,
      chargedFeeHbar,
      transfers: { hbar: hbarTransfers, tokens: tokenTransfers },
      contractCallResult,
      diagnosis,
    };
  } catch (err: any) {
    return {
      found: false,
      transfers: { hbar: [], tokens: [] },
      diagnosis: `Failed to fetch transaction: ${err?.message || "unknown error"}`,
      error: err?.message,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── NETWORK HEALTH CHECK ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

export interface NetworkHealth {
  mirrorNode: { ok: boolean; latencyMs: number; error?: string };
  saucerSwapApi: { ok: boolean; latencyMs: number; error?: string };
  dexScreener: { ok: boolean; latencyMs: number; error?: string };
  v2Router: { ok: boolean; contractId: string; error?: string };
  v2Factory: { ok: boolean; address?: string; error?: string };
  timestamp: number;
}

/**
 * Quick connectivity check for Mirror Node, SaucerSwap API, DexScreener,
 * and V2 infrastructure.
 * Useful as a pre-swap readiness indicator.
 */
export async function checkNetworkHealth(
  network: HederaNetwork = "mainnet"
): Promise<NetworkHealth> {
  const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
  const timestamp = Date.now();

  // Check Mirror Node
  let mirrorNode: NetworkHealth["mirrorNode"];
  try {
    const start = Date.now();
    const res = await fetch(`${base}/api/v1/network/supply`, {
      signal: makeAbort(8000),
    });
    const latencyMs = Date.now() - start;
    mirrorNode = { ok: res.ok, latencyMs };
    if (!res.ok) mirrorNode.error = `HTTP ${res.status}`;
  } catch (err: any) {
    mirrorNode = { ok: false, latencyMs: 0, error: err?.message || "unreachable" };
  }

  // Check SaucerSwap API (may be CORS-blocked from browser)
  let saucerSwapApi: NetworkHealth["saucerSwapApi"];
  try {
    const start = Date.now();
    const res = await saucerFetch("/tokens", 8000);
    const latencyMs = Date.now() - start;
    saucerSwapApi = { ok: !!res, latencyMs };
    if (!res) saucerSwapApi.error = "CORS restricted (non-critical)";
  } catch (err: any) {
    saucerSwapApi = { ok: false, latencyMs: 0, error: err?.message || "unreachable" };
  }

  // Check DexScreener API (CORS-friendly, used for HBAR.h pricing)
  let dexScreener: NetworkHealth["dexScreener"];
  try {
    const start = Date.now();
    const res = await fetch(
      "https://api.dexscreener.com/latest/dex/pairs/hedera/0x31d6b803a960b818cce3a85f0bef7c4c566b7919",
      { signal: makeAbort(8000) }
    );
    const latencyMs = Date.now() - start;
    dexScreener = { ok: res.ok, latencyMs };
    if (!res.ok) dexScreener.error = `HTTP ${res.status}`;
  } catch (err: any) {
    dexScreener = { ok: false, latencyMs: 0, error: err?.message || "unreachable" };
  }

  // Check V2 Router contract
  const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
  let v2Router: NetworkHealth["v2Router"];
  try {
    const info = await verifyIsContract(v2RouterId, network);
    v2Router = { ok: !!info, contractId: v2RouterId };
    if (!info) v2Router.error = "Not verified";
  } catch (err: any) {
    v2Router = { ok: false, contractId: v2RouterId, error: err?.message || "check failed" };
  }

  // Check V2 Factory discovery
  let v2Factory: NetworkHealth["v2Factory"];
  try {
    const factoryAddr = await discoverV2Factory(network);
    v2Factory = { ok: !!factoryAddr, address: factoryAddr || undefined };
    if (!factoryAddr) v2Factory.error = "Not discovered";
  } catch (err: any) {
    v2Factory = { ok: false, error: err?.message || "discovery failed" };
  }

  return { mirrorNode, saucerSwapApi, dexScreener, v2Router, v2Factory, timestamp };
}

// ══════════════════════════════════════════════════════════════════════
// ── [DIAG-02] SWAP ERROR CLASSIFIER ────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Parse a raw swap error message and return user-friendly guidance.
 *
 * Called by swap-engine.ts after a swap fails to enrich the error message
 * with actionable advice. The raw error may come from:
 *   - Mirror Node revert reason (DIAG-01)
 *   - Hedera consensus status codes
 *   - Solidity require() messages decoded from revert data
 *   - WalletConnect relay errors
 */
export function classifySwapError(
  rawError: string,
  context?: {
    inputSymbol?: string;
    outputSymbol?: string;
    venue?: string;
    slippagePct?: number;
    isV2Fallback?: boolean;
  }
): { category: string; userMessage: string; suggestion: string } {
  const lc = (rawError || "").toLowerCase();
  const inp = context?.inputSymbol || "input token";
  const out = context?.outputSymbol || "output token";
  const slip = context?.slippagePct || 0.5;

  // ── Slippage / insufficient output ──
  if (lc.includes("insufficient_output_amount") || lc.includes("insufficient output") || lc.includes("too little received")) {
    return {
      category: "slippage",
      userMessage: `Price moved too much during the swap. Your ${slip}% slippage tolerance was exceeded.`,
      suggestion: `Increase slippage to 2-5% in Settings, or try a smaller amount.`,
    };
  }

  // ── Deadline expired ──
  if (lc.includes("expired") || lc.includes("transaction too old") || lc.includes("deadline")) {
    return {
      category: "deadline",
      userMessage: `The swap deadline expired before the transaction reached consensus.`,
      suggestion: `Try again — Hedera consensus typically takes 3-5 seconds. If this persists, check your internet connection.`,
    };
  }

  // ── Safe Transfer Failed (token not associated) ──
  if (lc.includes("safe token transfer failed") || lc.includes("stf")) {
    return {
      category: "association",
      userMessage: `${out} is not associated with your account, or a token transfer failed.`,
      suggestion: `Associate ${out} in your wallet (HashPack → Tokens → Add), then retry.`,
    };
  }

  // ── Transfer failed (generic) ──
  if (lc.includes("transfer failed") || lc.includes("tf")) {
    return {
      category: "transfer",
      userMessage: `A token transfer failed during the swap — likely insufficient balance or missing approval.`,
      suggestion: `Verify your ${inp} balance and that the approval transaction succeeded.`,
    };
  }

  // ── Insufficient input amount ──
  if (lc.includes("insufficient_input_amount") || lc.includes("iia")) {
    return {
      category: "input",
      userMessage: `The swap router received less ${inp} than expected.`,
      suggestion: `Try again with a slightly lower amount to account for rounding.`,
    };
  }

  // ── Price slippage check (V2 concentrated liquidity) ──
  if (lc.includes("price slippage check") || lc.includes("spl")) {
    return {
      category: "v2-slippage",
      userMessage: `V2 concentrated liquidity price moved beyond the acceptable range.`,
      suggestion: `Increase slippage to 3-5%, or try the swap again (V2 pools are more volatile).`,
    };
  }

  // ── No pool / pair found ──
  if (lc.includes("no pool") || lc.includes("pair does not exist") || lc.includes("address(0)")) {
    return {
      category: "no-pool",
      userMessage: `No liquidity pool exists for ${inp} → ${out} at the attempted fee tier.`,
      suggestion: `Try swapping through HBAR as an intermediary: ${inp} → HBAR → ${out}.`,
    };
  }

  // ── Gas limit exceeded ──
  if (lc.includes("gas_limit") || lc.includes("out of gas") || lc.includes("gas_used")) {
    return {
      category: "gas",
      userMessage: `The transaction ran out of gas during execution.`,
      suggestion: `This is unusual on Hedera. Try the swap again — if it persists, report the issue.`,
    };
  }

  // ── Insufficient HBAR for gas / payer balance ──
  if (lc.includes("insufficient_payer_balance") || lc.includes("insufficient payer balance") || lc.includes("payer balance")) {
    return {
      category: "insufficient-hbar",
      userMessage: `Not enough HBAR to pay for transaction fees.`,
      suggestion: `You need HBAR for gas fees on Hedera (~0.5-2 HBAR for swaps). Add more HBAR to your account.`,
    };
  }

  // ── Relay / WalletConnect connectivity errors ──
  if (lc.includes("relay") || lc.includes("websocket") || lc.includes("send was called before connect")) {
    return {
      category: "relay",
      userMessage: `Lost connection to the WalletConnect relay. The swap was not submitted.`,
      suggestion: `Your wallet session may have dropped. Try the swap again — the relay will auto-reconnect.`,
    };
  }

  // ── Generic CONTRACT_REVERT with 0 gas ──
  if (lc.includes("contract_revert") && (lc.includes("0 gas") || lc.includes("gas_used: 0"))) {
    return {
      category: "selector-mismatch",
      userMessage: `The transaction was sent to a contract that doesn't recognize the function call (0 gas used).`,
      suggestion: `This usually means the wrong router was used. Try the swap again — the system will auto-detect the correct router.`,
    };
  }

  // ── Generic CONTRACT_REVERT ──
  if (lc.includes("contract_revert")) {
    return {
      category: "revert",
      userMessage: `The swap smart contract reverted: ${rawError.slice(0, 200)}`,
      suggestion: context?.isV2Fallback
        ? `Both V2 and V1 routes failed. Try swapping ${inp} → HBAR first, then HBAR → ${out}.`
        : `Try again with higher slippage (3-5%), or reduce the swap amount.`,
    };
  }

  // ── User rejection ──
  if (lc.includes("rejected") || lc.includes("user_reject") || lc.includes("cancelled") || lc.includes("canceled")) {
    return {
      category: "user-cancelled",
      userMessage: `Transaction was rejected in your wallet.`,
      suggestion: `Open your wallet and approve the transaction when prompted.`,
    };
  }

  // ── Timeout ──
  if (lc.includes("timeout") || lc.includes("timed out")) {
    return {
      category: "timeout",
      userMessage: `The wallet connection timed out before receiving a response.`,
      suggestion: `Check that your wallet app is open and connected. The transaction may have succeeded — check HashScan.`,
    };
  }

  // ── Fallback ──
  return {
    category: "unknown",
    userMessage: rawError.slice(0, 300),
    suggestion: `Check the browser console (F12) for detailed logs, or try the swap again.`,
  };
}
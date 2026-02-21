/**
 * [C77] SaucerSwap Swap Execution Engine
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: SwapResult, DryRunParams, DryRunResult,
 *           executeSaucerSwap, executeSaucerSwapDirect,
 *           executeSaucerSwapV2Direct, executeSaucerSwapV2MultiHop,
 *           preSwapDryRun
 *
 * Dependencies: tokens, contracts, abi, prices, pools, routing, quotes,
 *               balances, helpers, verification
 * Dynamic: @hashgraph/sdk, hashpack (executeHederaTransaction)
 */

import type { HederaNetwork, AllowedToken } from "./tokens";
import {
  resolveToken, getWhbarToken, evmAddressToHtsId,
  SAUCERSWAP_TOKENS, getSaucerswapRoutingId, getSaucerswapRoutingEvmAddress,
} from "./tokens";
import {
  SAUCERSWAP_V1_ROUTER_CANDIDATES, SAUCERSWAP_V2_ROUTER,
  getSaucerSwapRouter, getRouterWithFee,
  MIRROR_NODES, JSON_RPC_RELAY,
} from "./contracts";
import {
  bytesToHex,
  encodeExactInputSingle, encodeUnwrapWHBAR, encodeMulticall,
  encodeSaucerSwapETHForTokens, encodeSaucerSwapTokensForETH,
  encodeSaucerSwapCall, encodeSwapPath, encodeExactInput,
} from "./abi";
import { makeAbort, estimateOutputFromPrices } from "./prices";
import type { PoolVersionInfo } from "./pools";
import { detectPoolVersion, resolveAccountEvmAddress, resolveContractEvmAddress } from "./pools";
import { buildSwapPath, getIntermediaryTokens, findBestMultiHopRoute } from "./routing";
import type { RawQuote } from "./quotes";
import { fetchSaucerSwapQuote, fetchV2RouterQuote } from "./quotes";
import { isTokenAssociated, getNativeHbarBalance, getTokenBalance, fetchTokenAllowance } from "./balances";
import { parseTokenAmount } from "./helpers";
import { verifyIsContract, discoverSaucerSwapRouter } from "./verification";

// ══════════════════════════════════════════════════════════════════════
// ── [C53] PERSISTENT APPROVALS — "1 POPUP INSTEAD OF 2" ────────────
// ══════════════════════════════════════════════════════════════════════
//
// Before requesting a wallet approval popup, we query the Mirror Node
// for the existing HTS token allowance. If allowance >= swap amount,
// the approve step is SKIPPED entirely → user sees only 1 popup (swap).
//
// "Infinite approval" mode sets allowance to MAX_SAFE_ALLOWANCE
// (2^53 - 1 ≈ 9 quadrillion smallest units) so subsequent swaps of
// the same token→router pair never need re-approval.
//
// SENIOR DEV NOTE: Hedera HTS allowances are int64 on-chain, but the
// SDK's approveTokenAllowance() takes a JS number. We use
// Number.MAX_SAFE_INTEGER (2^53-1) which fits comfortably in int64.

/** Max allowance for "infinite approval" — Number.MAX_SAFE_INTEGER (2^53-1). */
const MAX_SAFE_ALLOWANCE = Number.MAX_SAFE_INTEGER; // 9007199254740991

export interface ApproveResult {
  needed: boolean;          // true if approve tx was sent
  skipped: boolean;         // true if existing allowance was sufficient
  success: boolean;
  transactionId?: string;
  error?: string;
  userCancelled?: boolean;
  existingAllowance: number; // raw units
  approvedAmount: number;   // 0 if skipped, rawInput or MAX if sent
}

/**
 * [C53] Check allowance and approve token spending if needed.
 *
 * - If existing allowance >= rawInput → skip (0 popups for this step)
 * - If infiniteApproval → approve MAX_SAFE_ALLOWANCE
 * - Otherwise → approve exact rawInput
 *
 * Dispatches swap-step events for UI feedback.
 */
async function approveIfNeeded(params: {
  tokenHtsId: string;
  ownerAccountId: string;
  spenderAccountId: string;  // Router HTS ID (e.g. "0.0.6755814")
  rawInput: number;
  infiniteApproval: boolean;
  network: HederaNetwork;
  tokenSymbol: string;
  stepNumber: number;
  totalSteps: number;
}): Promise<ApproveResult> {
  const {
    tokenHtsId, ownerAccountId, spenderAccountId,
    rawInput, infiniteApproval, network, tokenSymbol,
    stepNumber, totalSteps,
  } = params;

  // ── Check existing allowance via Mirror Node ──
  const existingAllowance = await fetchTokenAllowance(
    ownerAccountId, tokenHtsId, spenderAccountId, network,
  );

  if (existingAllowance >= rawInput) {
    console.log(
      `[C53] ✓ Existing allowance ${existingAllowance} >= ${rawInput} for ${tokenSymbol} → ${spenderAccountId} — SKIPPING approve (1-click swap!)`,
    );
    window.dispatchEvent(new CustomEvent("swap-step", { detail: {
      step: stepNumber, total: totalSteps,
      description: `${tokenSymbol} already approved ✓`,
    }}));
    return {
      needed: false, skipped: true, success: true,
      existingAllowance, approvedAmount: 0,
    };
  }

  // ── Approval needed — determine amount ──
  const approveAmount = infiniteApproval ? MAX_SAFE_ALLOWANCE : rawInput;
  const topUp = existingAllowance > 0;

  console.log(
    `[C53] ${topUp ? "Top-up" : "New"} approval: ${tokenSymbol} → ${spenderAccountId}, ` +
    `existing=${existingAllowance}, needed=${rawInput}, approving=${infiniteApproval ? "INFINITE" : approveAmount}`,
  );

  window.dispatchEvent(new CustomEvent("swap-step", { detail: {
    step: stepNumber, total: totalSteps,
    description: topUp
      ? `Top up ${tokenSymbol} allowance`
      : `Approve ${tokenSymbol} spending${infiniteApproval ? " (infinite)" : ""}`,
  }}));

  // ── Send native HTS approve transaction ──
  const { executeHederaTransaction } = await import("../hashpack");
  let sdk: any;
  try {
    sdk = await import("@hashgraph/sdk");
  } catch (e: any) {
    return {
      needed: true, skipped: false, success: false,
      error: "Hedera SDK not available: " + (e?.message || "unknown"),
      existingAllowance, approvedAmount: 0,
    };
  }

  const approveTx = new sdk.AccountAllowanceApproveTransaction()
    .approveTokenAllowance(tokenHtsId, ownerAccountId, spenderAccountId, approveAmount);

  const approveResult = await executeHederaTransaction(ownerAccountId, approveTx);
  console.log(`[C53] Approve result: ${JSON.stringify(approveResult)}`);

  if (!approveResult.success) {
    return {
      needed: true, skipped: false, success: false,
      transactionId: approveResult.transactionId || undefined,
      error: `${tokenSymbol} approval failed: ${approveResult.error || "unknown"}`,
      userCancelled: approveResult.userCancelled,
      existingAllowance, approvedAmount: 0,
    };
  }

  return {
    needed: true, skipped: false, success: true,
    transactionId: approveResult.transactionId || undefined,
    existingAllowance, approvedAmount: approveAmount,
  };
}

// ══════════════════════════════════════════════════════════════════════
// ── TYPES ───────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

export interface SwapResult {
  success: boolean;
  transactionId?: string;
  outputAmount?: number;
  error?: string;
  route?: string[];
  priceImpact?: number;
  executionVenue: "saucerswap-v1" | "saucerswap-v2" | "restricted-router" | "simulated";
  /** How the quote was obtained: "router" | "api" | "price-estimate" | "none" */
  quoteSource?: string;
  /** Whether the pre-swap dry run was executed and passed */
  dryRunPassed?: boolean;
  /** True when the user actively declined/cancelled the transaction in their wallet */
  userCancelled?: boolean;
}

interface DryRunParams {
  isInputNative: boolean;
  isOutputNative: boolean;
  rawInput: number;
  minOutput: number;
  pathAddresses: string[];
  recipientEvmAddress: string;
  routerHtsId: string;
  deadline: number;
  network: HederaNetwork;
}

export interface DryRunResult {
  ok: boolean;
  reason?: string;
  /** Whether the dry run actually executed (vs skipped due to endpoint issues) */
  simulated: boolean;
  /** The function selector used */
  functionName?: string;
  /** Response hex length (indicates valid return data) */
  resultHexLength?: number;
  /** Time taken in ms */
  durationMs?: number;
}

// ══════════════════════════════════════════════════════════════════════
// ── V2 SINGLE-HOP EXECUTION ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Execute a swap through SaucerSwap V2 (concentrated liquidity).
 *
 * Uses exactInputSingle for single-hop swaps.
 * - HBAR -> Token: payable exactInputSingle (no approve needed)
 * - Token -> Token: ERC-20 approve + exactInputSingle
 * - Token -> HBAR: ERC-20 approve + exactInputSingle (to WHBAR) + auto-note
 */
async function executeSaucerSwapV2Direct(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork,
  poolInfo: PoolVersionInfo,
  isInputNative: boolean,
  isOutputNative: boolean,
  whbar: AllowedToken,
  rawInput: number,
  recipientEvmAddress: string,
  options?: SwapOptions,
): Promise<SwapResult> {
  const { executeHederaTransaction } = await import("../hashpack");

  try {
    const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;
    const fee = poolInfo.feeTier || 3000;

    // Token EVM addresses for the V2 pool (use SaucerSwap alias for bridge tokens)
    const tokenInEvm = getSaucerswapRoutingEvmAddress(isInputNative ? whbar : inputToken);
    const tokenOutEvm = getSaucerswapRoutingEvmAddress(isOutputNative ? whbar : outputToken);

    // ── V2 Quote: try V2 QuoterV2 first, then fall back to price estimation ──
    // V1 getAmountsOut does NOT work for V2-only pools, so we use the V2 QuoterV2
    // contract's quoteExactInputSingle() which queries the actual concentrated
    // liquidity pool and returns accurate output amounts.
    let quote: RawQuote | null = null;

    // Strategy 1: V2 QuoterV2 contract (most accurate for V2 pools)
    try {
      const v2QuoteAmount = await fetchV2RouterQuote(
        tokenInEvm, tokenOutEvm, BigInt(rawInput), fee, network
      );
      if (v2QuoteAmount !== null && v2QuoteAmount > 0n) {
        quote = {
          amountOut: Number(v2QuoteAmount),
          priceImpact: 0, // Actual impact baked into on-chain result
          route: [inputToken.htsId, outputToken.htsId],
          source: "router",
        };
        console.log(`[HBAR.h] V2 Quote via QuoterV2: amountOut=${v2QuoteAmount}`);
      }
    } catch (err: any) {
      console.log("[HBAR.h] V2 QuoterV2 quote failed:", err?.message || err);
    }

    // Strategy 2: Price-based estimation fallback
    // Use SaucerSwap alias IDs for API/router calls (bridge tokens have different pool IDs)
    if (!quote) {
      const quoteInputId = isInputNative ? whbar.htsId : getSaucerswapRoutingId(inputToken);
      const quoteOutputId = isOutputNative ? whbar.htsId : getSaucerswapRoutingId(outputToken);
      quote = await fetchSaucerSwapQuote(quoteInputId, quoteOutputId, rawInput.toString(), {
        pathAddresses: [tokenInEvm, tokenOutEvm],
        routerHtsId: getSaucerSwapRouter(network, "v1"),
        network,
        inputToken: isInputNative ? whbar : inputToken,
        outputToken: isOutputNative ? whbar : outputToken,
      });
    }

    // ── minOutput calculation ──
    let minOutput: number;
    if (quote && quote.amountOut > 0) {
      const effectiveSlippage = quote.source === "price-estimate"
        ? Math.max(slippagePct, 5) // wider slippage for estimated quotes
        : slippagePct;
      minOutput = Math.max(1, Math.floor(quote.amountOut * (1 - effectiveSlippage / 100)));
      console.log(`[HBAR.h] V2 Quote: source=${quote.source}, amountOut=${quote.amountOut}, minOutput=${minOutput} (${effectiveSlippage}% slippage)`);
    } else {
      // Last-ditch inline estimate before surrendering to minOutput=1
      const inTok = isInputNative ? whbar : inputToken;
      const outTok = isOutputNative ? whbar : outputToken;
      const lastDitch = estimateOutputFromPrices(rawInput, inTok, outTok, 1);
      if (lastDitch && lastDitch > 0) {
        const safeSlippage = Math.max(slippagePct, 10); // very generous for emergency estimate
        minOutput = Math.max(1, Math.floor(lastDitch * (1 - safeSlippage / 100)));
        console.warn(`[HBAR.h] V2: All strategies failed but inline price estimate rescued quote: minOutput=${minOutput} (${safeSlippage}% slippage)`);
      } else {
        minOutput = 1;
        console.warn("[HBAR.h] V2: All quote strategies failed including inline rescue — using minOutput=1 (no slippage protection)");
      }
    }

    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min

    // Dynamic SDK import
    let sdk: any;
    try {
      sdk = await import("@hashgraph/sdk");
    } catch (e: any) {
      return { success: false, error: "Hedera SDK not available: " + (e?.message || "unknown"), executionVenue: "saucerswap-v2" };
    }
    const { ContractExecuteTransaction, ContractId, Hbar, AccountAllowanceApproveTransaction } = sdk;

    // ── Verify V2 Router is a contract ──
    const routerContractInfo = await verifyIsContract(v2RouterId, network);
    if (!routerContractInfo) {
      return {
        success: false,
        error: `V2 Router ${v2RouterId} failed contract verification on ${network}. Cannot execute V2 swap.`,
        executionVenue: "saucerswap-v2",
      };
    }
    const routerEvmAddress = routerContractInfo.evmAddress || await resolveContractEvmAddress(v2RouterId, network);

    // ── Log V2 swap parameters ──
    console.log("[HBAR.h] ═══════════════════════════════════════════");
    console.log("[HBAR.h] V2 SWAP EXECUTION START");
    console.log("[HBAR.h] Input:", inputToken.symbol, "→ Output:", outputToken.symbol);
    console.log("[HBAR.h] Amount:", inputAmount, `(raw: ${rawInput})`);
    console.log("[HBAR.h] V2 Fee Tier:", fee, `(${fee / 10000}%)`);
    console.log("[HBAR.h] Pool:", poolInfo.poolAddress || "detected");
    console.log("[HBAR.h] TokenIn EVM:", tokenInEvm);
    console.log("[HBAR.h] TokenOut EVM:", tokenOutEvm);
    console.log("[HBAR.h] Recipient EVM:", recipientEvmAddress);
    console.log("[HBAR.h] V2 Router:", v2RouterId, `(EVM: ${routerEvmAddress})`);
    const effectiveSlippageLog = quote?.source === "price-estimate" ? Math.max(slippagePct, 5) : slippagePct;
    console.log("[HBAR.h] MinOutput:", minOutput, `(quote: ${quote?.amountOut ?? "none"}, source: ${quote?.source ?? "none"})`);
    console.log("[HBAR.h] Slippage:", effectiveSlippageLog, `% (requested: ${slippagePct}%) | Deadline:`, deadline);
    console.log("[HBAR.h] Mode:", isInputNative ? "HBAR→Token(V2)" : isOutputNative ? "Token→HBAR(V2)" : "Token→Token(V2)");
    console.log("[HBAR.h] ═══════════════════════════════════════════");

    // ── Token association check ──
    // [C30-01] Token association check:
    // - Token→Token: user must be associated with the OUTPUT token.
    // - Token→HBAR: NOT needed. With multicall(swap + unwrapWETH9), WHBAR
    //   stays in the router's EVM balance and is unwrapped atomically.
    //   The user never receives WHBAR, so no association required.
    // - HBAR→Token: handled separately (isInputNative block).
    if (!isOutputNative) {
      const assocHtsId = outputToken.htsId;
      const assocSymbol = outputToken.symbol;

      const isAssoc = await isTokenAssociated(accountId, assocHtsId, network);
      if (!isAssoc) {
        console.warn(`[HBAR.h] V2: ${assocSymbol} (${assocHtsId}) NOT associated — auto-associating`);
        try {
          const assocSdk = await import("@hashgraph/sdk");
          const assocTx = new assocSdk.TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([assocHtsId]);
          const assocResult = await executeHederaTransaction(accountId, assocTx);
          if (!assocResult.success) {
            return {
              success: false,
              error: `${assocSymbol} association failed: ${assocResult.error || "unknown"}. Associate ${assocHtsId} manually in HashPack.`,
              executionVenue: "saucerswap-v2",
              userCancelled: assocResult.userCancelled,
            };
          }
          console.log(`[HBAR.h] V2: Successfully associated ${assocSymbol}`);
        } catch (assocErr: any) {
          const aMsg = (assocErr?.message || "").toLowerCase();
          const aCancel = aMsg.includes("user_reject") || aMsg.includes("cancelled by user") || aMsg.includes("canceled by user") || aMsg.includes("user denied") || aMsg.includes("user rejected");
          return {
            success: false,
            error: `Cannot associate ${assocSymbol}: ${assocErr?.message || "unknown"}`,
            executionVenue: "saucerswap-v2",
            userCancelled: aCancel || undefined,
          };
        }
      } else {
        console.log(`[HBAR.h] V2: ${assocSymbol} association confirmed ✓`);
      }
    }

    // ── Gas sufficiency check ──
    // Hedera gas fees are sub-cent for typical swaps. Reserve 1 HBAR total
    // to cover gas + network fees — good for dozens of transactions.
    // SWAP_GAS / APPROVE_GAS are gas LIMITS for the EVM call, NOT the HBAR cost.
    const SWAP_GAS = 1_500_000;
    const APPROVE_GAS = 800_000;
    const gasReserveNeeded = 1; // 1 HBAR covers gas + network fees with plenty of margin

    if (isInputNative) {
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      const inputHbar = parseFloat(inputAmount);
      const totalNeeded = inputHbar + gasReserveNeeded;
      if (hbarBalance < totalNeeded) {
        const shortfall = totalNeeded - hbarBalance;
        return {
          success: false,
          error: `Insufficient HBAR: you have ${hbarBalance.toFixed(2)} HBAR but need ${totalNeeded.toFixed(2)} HBAR (${inputHbar} for swap + ${gasReserveNeeded} for fees). Short by ${shortfall.toFixed(2)} HBAR.`,
          executionVenue: "saucerswap-v2",
        };
      }
    } else {
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      if (hbarBalance < gasReserveNeeded) {
        return {
          success: false,
          error: `Insufficient HBAR for fees: you have ${hbarBalance.toFixed(2)} HBAR but need at least ${gasReserveNeeded} HBAR. Deposit more HBAR first.`,
          executionVenue: "saucerswap-v2",
        };
      }
    }

    // ── Pre-swap dry run (V2-specific) ──
    // [C16-02] Only dry-run for HBAR-input swaps (payable calls).
    // For token-input swaps, the ERC-20 approve hasn't been sent yet,
    // so the dry run always reverts with "STF" / "execution reverted"
    // (insufficient allowance). This false-positive revert was blocking
    // all Token → HBAR and Token → Token swaps at the dry-run gate.
    if (isInputNative) {
    try {
      const dryCallData = encodeExactInputSingle(
        tokenInEvm, tokenOutEvm, fee,
        recipientEvmAddress,
        BigInt(deadline),
        BigInt(rawInput),
        BigInt(minOutput),
        0n
      );
      const dryDataHex = bytesToHex(dryCallData);
      const dryGasHex = "0x" + (1_500_000).toString(16);
      const dryValueHex = isInputNative ? "0x" + (BigInt(rawInput) * 10000000000n).toString(16) : "0x0";

      console.log(`[HBAR.h] V2 Dry run: exactInputSingle, value=${isInputNative ? rawInput : 0}`);

      const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
      const dryRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(15000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{
            from: recipientEvmAddress,
            to: routerEvmAddress,
            data: dryDataHex,
            gas: dryGasHex,
            value: dryValueHex,
          }, "latest"],
          id: 1,
        }),
      });

      if (dryRes.ok) {
        const dryData = await dryRes.json();
        if (dryData.error) {
          const revertMsg = dryData.error.message || JSON.stringify(dryData.error).slice(0, 200);
          // Only block on definitive reverts, not on generic RPC issues
          if (revertMsg.includes("REVERT") || revertMsg.includes("revert") || revertMsg.includes("execution reverted")) {
            console.error(`[HBAR.h] V2 Dry run REVERT: ${revertMsg}`);
            return {
              success: false,
              error: `V2 pre-swap simulation reverted: ${revertMsg}. The swap would fail on-chain.`,
              executionVenue: "saucerswap-v2",
            };
          }
          console.log(`[HBAR.h] V2 Dry run non-blocking RPC error: ${revertMsg.slice(0, 100)}`);
        } else if (dryData.result && dryData.result !== "0x" && dryData.result.length > 2) {
          console.log(`[HBAR.h] V2 Dry run PASSED ✓ (${dryData.result.length} chars)`);
        } else {
          // [C9-02] Log actual dry run response for diagnostics — Hashio may return
          // "0x" for payable calls since eth_call doesn't include real msg.value
          const dryPreview = dryData.result ? dryData.result.slice(0, 40) : "null";
          console.log(`[HBAR.h] V2 Dry run: empty result=${dryPreview} — non-blocking (payable calls may not simulate via eth_call)`);
        }
      } else {
        console.log(`[HBAR.h] V2 Dry run: HTTP ${dryRes.status} — non-blocking`);
      }
    } catch (dryErr: any) {
      console.log("[HBAR.h] V2 Dry run skipped:", dryErr?.message || dryErr);
      // Non-blocking — proceed with real swap
    }
    } else {
      console.log("[HBAR.h] V2 Dry run SKIPPED for token-input swap (approve not yet granted — would false-revert) [C16-02]");
    }

    // ── Execution branches ──

    if (isInputNative) {
      // ═══ HBAR → Token via V2 exactInputSingle (payable) ═══
      console.log("[HBAR.h] V2: Native HBAR input — payable exactInputSingle");
      // [C27-04] Emit step event — single step for HBAR→Token (no approve needed)
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: 1, total: 1,
        description: `Swap HBAR → ${outputToken.symbol} via V2 Router`,
      }}));

      const functionData = encodeExactInputSingle(
        tokenInEvm, tokenOutEvm, fee,
        recipientEvmAddress,
        BigInt(deadline),
        BigInt(rawInput),
        BigInt(minOutput),
        0n
      );

      // [C9-03] Use Hbar.fromTinybars for precision — avoids floating-point
      // rounding issues with large tinybar amounts. Also log calldata size
      // for serialization diagnostics.
      const hbarAmount = Hbar.fromTinybars(rawInput);

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData)
        .setPayableAmount(hbarAmount);

      console.log(`[HBAR.h] V2: Submitting exactInputSingle — HBAR: ${hbarAmount} (${rawInput} tinybar), calldata: ${functionData.length}B`);
      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2: Swap result:", JSON.stringify(swapResult));

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: ["HBAR", outputToken.symbol],
        priceImpact: quote?.priceImpact,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v2",
        quoteSource: quote?.source || "none",
        userCancelled: swapResult.userCancelled,
      };

    } else {
      // ═══ Token → Token or Token → HBAR via V2 [C35-01] ═══
      //
      // [C35-01] Two wallet popups maximum:
      //   Popup 1: Native HTS AccountAllowanceApproveTransaction
      //   Popup 2: Token→HBAR: atomic multicall(exactInputSingle(recipient=ROUTER) + unwrapWETH9(0, user)) [C34-01]
      //            Token→Token: single exactInputSingle(recipient=user)
      //
      // SENIOR DEV NOTE [C35-01]: Reverted from C33-01 ERC-20 approve() back to
      // native HTS AccountAllowanceApproveTransaction. The C33-01 comment that
      // "native HTS allowances do NOT reliably bridge to EVM-level allowances" was
      // INCORRECT — SaucerSwap's own production UI (saucerswap.finance) uses native
      // HTS approvals for ALL swaps (SAUCE→HBAR, USDC→HBAR, etc.) and they work
      // correctly. The HTS precompile properly bridges native allowances to ERC-20
      // allowance checks in Solidity contracts. The ERC-20 approve approach had a
      // subtle failure mode: the spender EVM address format (long-zero vs CREATE-
      // deployed) could mismatch the router's msg.sender in transferFrom() calls,
      // causing silent allowance check failures → CONTRACT_REVERT_EXECUTED.
      // Native HTS approve uses Hedera account IDs (0.0.xxxxx) which are always
      // resolved correctly regardless of EVM address format.
      //
      // Evidence: SaucerSwap.finance SAUCE→HBAR and USDC→HBAR both use
      // AccountAllowanceApproveTransaction targeting 0.0.6755814 (V1 RouterWithFee).
      //
      // ATOMIC: If multicall reverts, no tokens leave the user's wallet.

      // ── Step 1: [C53] Smart approve — skips if allowance sufficient ──
      const infiniteApproval = !!(options?.infiniteApproval);
      const v2ApproveResult = await approveIfNeeded({
        tokenHtsId: inputToken.htsId,
        ownerAccountId: accountId,
        spenderAccountId: v2RouterId,
        rawInput,
        infiniteApproval,
        network,
        tokenSymbol: inputToken.symbol,
        stepNumber: 1,
        totalSteps: 2,
      });

      if (!v2ApproveResult.success) {
        return {
          success: false,
          transactionId: v2ApproveResult.transactionId || undefined,
          error: "V2 token approval failed: " + (v2ApproveResult.error || "unknown") +
            (v2ApproveResult.transactionId ? ` (tx: ${v2ApproveResult.transactionId})` : ""),
          executionVenue: "saucerswap-v2",
          userCancelled: v2ApproveResult.userCancelled,
        };
      }

      // [C53] Update step count — if approve was skipped, swap is step 1/1
      const v2SwapStep = v2ApproveResult.skipped ? 1 : 2;
      const v2TotalSteps = v2ApproveResult.skipped ? 1 : 2;

      if (isOutputNative) {
        // ═══ Token → HBAR via V2 — atomic multicall [C30-01] ═══
        //
        // [C30-01] RESTORED multicall approach with CORRECT recipient.
        // Previous C28-01 broke this by using recipient=USER in a 3-step flow,
        // which caused WHBAR to go to user's HTS balance where the separate
        // withdraw() couldn't access it — resulting in lost tokens.
        //
        // The CORRECT flow (from SaucerSwap V2 docs):
        //   multicall([
        //     exactInputSingle(Token→WHBAR, recipient = ROUTER),  ← KEY FIX
        //     unwrapWETH9(0, userAddress)
        //   ])
        //
        // The swap sends WHBAR to the ROUTER's internal EVM balance,
        // then unwrapWETH9 converts it to native HBAR and sends to user.
        // This is ATOMIC — if anything fails, the whole tx reverts and
        // the user's input tokens are safe (no partial execution).
        //
        // SENIOR DEV NOTE: recipient MUST be the router's EVM address,
        // NOT the user's. The unwrapWETH9 function checks address(this).balance.
        console.log(`[HBAR.h] V2 Step ${v2SwapStep}: multicall(exactInputSingle + unwrapWETH9) — Token→HBAR [C34-01]`);
        window.dispatchEvent(new CustomEvent("swap-step", { detail: {
          step: v2SwapStep, total: v2TotalSteps,
          description: `Swap ${inputToken.symbol} → HBAR via V2 Router (atomic)`,
        }}));

        // Sub-call 1: exactInputSingle — swap Token→WHBAR, recipient = ROUTER
        // [C34-01] FIX: address(0) sentinel does NOT exist in the original Uniswap V3
        // SwapRouter (selector 0x414bf389). The sentinel pattern (address(0) →
        // address(this)) only exists in Uniswap's newer SwapRouter02 (selector
        // 0x04e45aaf). SaucerSwap V2 uses the original V3 SwapRouter, so
        // address(0) is passed through literally — the pool tries to transfer WHBAR
        // to the zero address, which reverts on Hedera. The correct approach is to
        // use the router's own EVM address so WHBAR lands in the router's balance
        // for unwrapWETH9 to access via IWETH9(WETH9).balanceOf(address(this)).
        //
        // The routerEvmAddress comes from verifyIsContract() which pre-seeds
        // using htsIdToEvmAddress() (long-zero form). On Hedera, address(this)
        // for ContractCreateTransaction-deployed contracts returns the long-zero
        // form, so these match. Even if the Mirror Node returns a CREATE-deployed
        // address, HTS precompile resolves both forms to the same entity.
        //
        // SENIOR DEV NOTE [C34-01]: The C33 address(0) sentinel was wrong for
        // the original V3 SwapRouter. This caused CONTRACT_REVERT_EXECUTED on
        // every Token→HBAR multicall. The C33 ERC-20 approve fix remains correct.
        const swapCalldata = encodeExactInputSingle(
          tokenInEvm, tokenOutEvm, fee,
          routerEvmAddress,      // [C34-01] router's own EVM addr — NOT address(0)
          BigInt(deadline),
          BigInt(rawInput),
          BigInt(minOutput),
          0n
        );

        // Sub-call 2: unwrapWETH9 — unwrap all WHBAR in router, send HBAR to user
        // amountMinimum=0 means "unwrap everything" — slippage is already
        // protected by amountOutMinimum in the swap above.
        const unwrapCalldata = encodeUnwrapWHBAR(0n, recipientEvmAddress);

        // Combine into single atomic multicall
        const multicallData = encodeMulticall([swapCalldata, unwrapCalldata]);

        console.log(`[HBAR.h] V2: multicall calldata ${multicallData.length}B ` +
          `(swap=${swapCalldata.length}B + unwrap=${unwrapCalldata.length}B) ` +
          `swapRecipient=${routerEvmAddress} unwrapRecipient=${recipientEvmAddress} [C34-01]`);

        // [C34-01] Diagnostic dump — essential for verifying correct addresses on-chain
        console.log(`[HBAR.h] V2 Token→HBAR multicall diagnostics [C34-01]:`);
        console.log(`  tokenIn EVM:       ${tokenInEvm}`);
        console.log(`  tokenOut EVM:      ${tokenOutEvm}`);
        console.log(`  fee:               ${fee}`);
        console.log(`  swap recipient:    ${routerEvmAddress} (router)`);
        console.log(`  unwrap recipient:  ${recipientEvmAddress} (user)`);
        console.log(`  router contract:   ${v2RouterId}`);
        console.log(`  amountIn:          ${rawInput}`);
        console.log(`  amountOutMin:      ${minOutput}`);
        console.log(`  gas:               ${SWAP_GAS}`);

        const multicallTx = new ContractExecuteTransaction()
          .setContractId(ContractId.fromString(v2RouterId))
          .setGas(SWAP_GAS)
          .setFunctionParameters(multicallData);

        const swapResult = await executeHederaTransaction(accountId, multicallTx);
        console.log("[HBAR.h] V2: Token→HBAR multicall result:", JSON.stringify(swapResult));

        return {
          success: swapResult.success,
          transactionId: swapResult.transactionId || undefined,
          outputAmount: quote ? quote.amountOut / Math.pow(10, 8) : undefined,
          route: [inputToken.symbol, "HBAR"],
          priceImpact: quote?.priceImpact,
          error: swapResult.error
            ? `Token→HBAR V2 swap failed: ${swapResult.error}` +
              (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
            : undefined,
          executionVenue: "saucerswap-v2",
          quoteSource: quote?.source || "none",
          userCancelled: swapResult.userCancelled,
        };
      }

      // ═══ Token → Token via V2 (non-HBAR output) ═══
      console.log(`[HBAR.h] V2 Step ${v2SwapStep}: exactInputSingle (Token→Token)`);
      // [C27-04][C53] Emit step event — step count adjusts based on approve skip
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: v2SwapStep, total: v2TotalSteps,
        description: `Swap ${inputToken.symbol} → ${outputToken.symbol} via V2 Router`,
      }}));
      const functionData = encodeExactInputSingle(
        tokenInEvm, tokenOutEvm, fee,
        recipientEvmAddress,
        BigInt(deadline),
        BigInt(rawInput),
        BigInt(minOutput),
        0n
      );

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2: Swap result:", JSON.stringify(swapResult));

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: [inputToken.symbol, outputToken.symbol],
        priceImpact: quote?.priceImpact,
        error: swapResult.error
          ? swapResult.error +
            (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
          : undefined,
        executionVenue: "saucerswap-v2",
        quoteSource: quote?.source || "none",
        userCancelled: swapResult.userCancelled,
      };
    }
  } catch (err: any) {
    console.error("[HBAR.h] V2 swap execution error:", err);
    const errMsg = err?.message || "V2 swap failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return {
      success: false,
      error: errMsg,
      executionVenue: "saucerswap-v2",
      userCancelled: isCancellation || undefined,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── PRE-SWAP DRY RUN ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

// Simulate the swap BEFORE spending real gas.  Tries the JSON-RPC
// relay first (more reliable for state-mutating call simulation),
// then falls back to Mirror Node /api/v1/contracts/call.  If the
// simulation reverts with an explicit error, we abort and save the
// user from losing HBAR on a guaranteed failure.

async function preSwapDryRun(params: DryRunParams): Promise<DryRunResult> {
  const {
    isInputNative, isOutputNative, rawInput, minOutput,
    pathAddresses, recipientEvmAddress, routerHtsId, deadline, network,
  } = params;

  const startTime = Date.now();

  const routerEvm = await resolveContractEvmAddress(routerHtsId, network);

  // [C36-05] Use minOutput=1 for dry-run simulation instead of the actual
  // slippage-protected value. The purpose of the dry run is to check whether
  // the swap is mechanically possible (pool exists, tokens valid, path works),
  // NOT to enforce price constraints. Using the real minOutput causes false
  // "INSUFFICIENT_OUTPUT_AMOUNT" rejections when the quote is slightly stale
  // or the pool price has moved between quote fetch and simulation.
  // The actual on-chain swap transaction still uses the real minOutput for
  // slippage protection — only the simulation is relaxed.
  const dryRunMinOutput = 1;

  let callData: Uint8Array;
  let value: number = 0;
  let functionName: string;

  if (isInputNative) {
    callData = encodeSaucerSwapETHForTokens(
      BigInt(dryRunMinOutput), pathAddresses, recipientEvmAddress, BigInt(deadline)
    );
    value = rawInput;
    functionName = "swapExactETHForTokens";
  } else if (isOutputNative) {
    callData = encodeSaucerSwapTokensForETH(
      BigInt(rawInput), BigInt(dryRunMinOutput), pathAddresses, recipientEvmAddress, BigInt(deadline)
    );
    functionName = "swapExactTokensForETH";
  } else {
    callData = encodeSaucerSwapCall(
      BigInt(rawInput), BigInt(dryRunMinOutput), pathAddresses, recipientEvmAddress, BigInt(deadline)
    );
    functionName = "swapExactTokensForTokens";
  }

  const callDataHex = bytesToHex(callData);
  const gasHex = "0x" + (1_500_000).toString(16);
  const valueHex = "0x" + value.toString(16);

  console.log(`[HBAR.h] Dry run: ${functionName} → router ${routerEvm}, value=${value}, minOutput=${dryRunMinOutput} (real: ${minOutput}) [C36-05]`);

  // ── Strategy A: JSON-RPC relay ──
  try {
    const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(15000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{
          from: recipientEvmAddress,
          to: routerEvm,
          data: callDataHex,
          gas: gasHex,
          value: valueHex,
        }, "latest"],
        id: 1,
      }),
    });

    const durationMs = Date.now() - startTime;
    if (rpcRes.ok) {
      const rpcData = await rpcRes.json();
      if (rpcData.error) {
        // Explicit revert from JSON-RPC — this is a real failure signal
        const revertMsg = rpcData.error.message || JSON.stringify(rpcData.error).slice(0, 200);
        console.error(`[HBAR.h] Dry run REVERT (JSON-RPC): ${revertMsg}`);
        return { ok: false, simulated: true, functionName, durationMs, reason: `Contract simulation reverted: ${revertMsg}`, resultHexLength: 0 };
      }
      if (rpcData.result && rpcData.result !== "0x" && rpcData.result.length > 2) {
        console.log(`[HBAR.h] Dry run PASSED (JSON-RPC): ${functionName}, ${rpcData.result.length} chars, ${durationMs}ms`);
        return { ok: true, simulated: true, functionName, durationMs, resultHexLength: rpcData.result.length };
      }
      // Empty result from RPC without error — non-blocking for payable calls
      console.log(`[HBAR.h] Dry run: JSON-RPC returned empty result for ${functionName} — non-blocking`);
      return { ok: true, simulated: true, functionName, durationMs, reason: "Empty result (non-blocking for payable calls)", resultHexLength: 0 };
    }
  } catch (err: any) {
    console.log("[HBAR.h] Dry run JSON-RPC attempt failed:", err?.message || err);
  }

  // ── Strategy B: Mirror Node /api/v1/contracts/call ──
  try {
    const base = MIRROR_NODES[network] || MIRROR_NODES.mainnet;
    const res = await fetch(`${base}/api/v1/contracts/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: makeAbort(15000),
      body: JSON.stringify({
        block: "latest",
        data: callDataHex,
        estimate: false,
        from: recipientEvmAddress,
        to: routerEvm,
        gas: 1_500_000,
        gasPrice: 0,
        value: value,
      }),
    });

    const durationMs = Date.now() - startTime;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.log(`[HBAR.h] Dry run Mirror Node HTTP ${res.status} — skipping (non-blocking)`);
      return { ok: true, simulated: false, functionName, durationMs, reason: `HTTP ${res.status} — simulation skipped` };
    }

    const data = await res.json();

    if (data.result === "0x" || !data.result) {
      const errMsg = data.error_message || data._status?.messages?.[0]?.message || "";
      if (errMsg) {
        console.error(`[HBAR.h] Dry run REVERT (Mirror Node): ${errMsg}`);
        return { ok: false, simulated: true, functionName, durationMs, reason: `Contract simulation reverted: ${errMsg}`, resultHexLength: 0 };
      }
      // Empty without error — non-blocking (Mirror Node often can't simulate payable/cross-contract calls)
      console.log(`[HBAR.h] Dry run: Mirror Node returned empty for ${functionName} — non-blocking`);
      return { ok: true, simulated: false, functionName, durationMs, reason: "Mirror Node simulation inconclusive — proceeding", resultHexLength: 0 };
    }

    const resultHexLength = data.result.length;
    console.log(`[HBAR.h] Dry run PASSED (Mirror Node): ${functionName}, ${resultHexLength} chars, ${durationMs}ms`);
    return { ok: true, simulated: true, functionName, durationMs, resultHexLength };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.log("[HBAR.h] Dry run Mirror Node attempt failed (non-blocking):", err?.message || err);
    return { ok: true, simulated: false, durationMs, reason: `Network error: ${err?.message || "unknown"}` };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── V2 MULTI-HOP EXECUTION ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Execute a V2 multi-hop swap using exactInput with packed path encoding.
 *
 * [C9-05] This handles swaps that require routing through intermediary
 * tokens (e.g., HBAR → WHBAR → USDC when no direct HBAR/USDC V2 pool
 * exists, or Token A → WHBAR → Token B).
 */
async function executeSaucerSwapV2MultiHop(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  // Note: `options` parameter added after `recipientEvmAddress` below
  network: HederaNetwork,
  route: { hops: PoolVersionInfo[]; tokens: string[] },
  isInputNative: boolean,
  isOutputNative: boolean,
  whbar: AllowedToken,
  rawInput: number,
  recipientEvmAddress: string,
): Promise<SwapResult> {
  const { executeHederaTransaction } = await import("../hashpack");

  try {
    const v2RouterId = SAUCERSWAP_V2_ROUTER[network] || SAUCERSWAP_V2_ROUTER.mainnet;

    // Build packed path: token0 + fee0 + token1 + fee1 + token2 + ...
    const pathHops: { tokenEvm: string; fee: number }[] = [];
    for (let i = 0; i < route.tokens.length; i++) {
      pathHops.push({
        tokenEvm: route.tokens[i],
        fee: i < route.hops.length ? (route.hops[i].feeTier || 3000) : 0,
      });
    }
    const packedPath = encodeSwapPath(pathHops);
    console.log(`[HBAR.h] V2 Multi-hop packed path: ${packedPath.length} bytes, ${route.tokens.length} tokens`);

    // ── Quote: price-based estimation for multi-hop ──
    // QuoterV2 doesn't easily support multi-hop simulation from browser,
    // so we estimate based on token prices and apply wider slippage.
    let estimatedOutput = 0;
    const inTok = isInputNative ? whbar : inputToken;
    const outTok = isOutputNative ? whbar : outputToken;
    const priceEstimate = estimateOutputFromPrices(rawInput, inTok, outTok, 1);
    if (priceEstimate && priceEstimate > 0) {
      estimatedOutput = priceEstimate;
      console.log(`[HBAR.h] V2 Multi-hop price estimate: ${estimatedOutput}`);
    }

    // Wider slippage for multi-hop (more hops = more slippage risk)
    const effectiveSlippage = Math.max(slippagePct, 5);
    const minOutput = estimatedOutput > 0
      ? Math.max(1, Math.floor(estimatedOutput * (1 - effectiveSlippage / 100)))
      : 1;

    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min

    // Dynamic SDK import
    let sdk: any;
    try {
      sdk = await import("@hashgraph/sdk");
    } catch (e: any) {
      return { success: false, error: "Hedera SDK not available: " + (e?.message || "unknown"), executionVenue: "saucerswap-v2" };
    }
    const { ContractExecuteTransaction, ContractId, Hbar, AccountAllowanceApproveTransaction } = sdk;

    // Verify V2 Router
    const routerContractInfo = await verifyIsContract(v2RouterId, network);
    if (!routerContractInfo) {
      return {
        success: false,
        error: `V2 Router ${v2RouterId} failed contract verification. Cannot execute V2 multi-hop swap.`,
        executionVenue: "saucerswap-v2",
      };
    }

    // ── Log multi-hop parameters ──
    console.log("[HBAR.h] ═══════════════════════════════════════════");
    console.log("[HBAR.h] V2 MULTI-HOP SWAP EXECUTION START");
    console.log("[HBAR.h] Input:", inputToken.symbol, "→ Output:", outputToken.symbol);
    console.log("[HBAR.h] Route:", route.tokens.map(t => evmAddressToHtsId(t)).join(" → "));
    console.log("[HBAR.h] Hops:", route.hops.map(h => `${h.version}(fee=${h.feeTier})`).join(" → "));
    console.log("[HBAR.h] Amount:", inputAmount, `(raw: ${rawInput})`);
    console.log("[HBAR.h] MinOutput:", minOutput, `(estimate: ${estimatedOutput}, slippage: ${effectiveSlippage}%)`);
    console.log("[HBAR.h] V2 Router:", v2RouterId);
    console.log("[HBAR.h] Mode:", isInputNative ? "HBAR→Multi→Token" : "Token→Multi→Token");
    console.log("[HBAR.h] ═══════════════════════════════════════════");

    // ── Token association check for output [C30-01] ──
    // Token→HBAR with multicall: WHBAR stays in router, no user association needed.
    // Token→Token: user must be associated with output token.
    if (!isOutputNative) {
      const assocHtsId = outputToken.htsId;
      const assocSymbol = outputToken.symbol;

      const isAssoc = await isTokenAssociated(accountId, assocHtsId, network);
      if (!isAssoc) {
        console.warn(`[HBAR.h] V2 Multi-hop: ${assocSymbol} (${assocHtsId}) NOT associated — auto-associating`);
        try {
          const assocSdk = await import("@hashgraph/sdk");
          const assocTx = new assocSdk.TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([assocHtsId]);
          const assocResult = await executeHederaTransaction(accountId, assocTx);
          if (!assocResult.success) {
            return {
              success: false,
              error: `${assocSymbol} association failed: ${assocResult.error || "unknown"}`,
              executionVenue: "saucerswap-v2",
              userCancelled: assocResult.userCancelled,
            };
          }
        } catch (assocErr: any) {
          return {
            success: false,
            error: `Cannot associate ${assocSymbol}: ${assocErr?.message || "unknown"}`,
            executionVenue: "saucerswap-v2",
          };
        }
      }
    }

    const SWAP_GAS = 2_000_000; // Higher gas for multi-hop (more contract calls)
    const APPROVE_GAS = 800_000;

    // [C26-02] Token → HBAR multi-hop: per SaucerSwap V2 docs, uses multicall
    // approach: exactInput(recipient=ROUTER) + unwrapWETH9(user).
    // Token → Token: direct exactInput(recipient=user).
    const routerEvmAddress = routerContractInfo.evmAddress || await resolveContractEvmAddress(v2RouterId, network);

    // Helper: build human-readable route from EVM token addresses,
    // replacing WHBAR with HBAR for native endpoints.
    const buildDisplayRoute = () => {
      const raw = route.tokens.map(t => {
        const id = evmAddressToHtsId(t);
        const tok = SAUCERSWAP_TOKENS.find(at => at.htsId === id || getSaucerswapRoutingId(at) === id);
        return tok?.symbol || id;
      });
      // Replace WHBAR at endpoints with HBAR for display
      if (isInputNative && raw[0] === "WHBAR") raw[0] = "HBAR";
      if (isOutputNative && raw[raw.length - 1] === "WHBAR") raw[raw.length - 1] = "HBAR";
      return raw;
    };

    // [C34-01] For Token→HBAR: recipient = ROUTER so WHBAR lands in router's
    // balance for unwrapWETH9 to access. For Token→Token: recipient = USER.
    // SENIOR DEV NOTE [C34-01]: C33 used address(0) as a "sentinel" but the
    // original V3 SwapRouter does NOT replace address(0) with address(this).
    // That sentinel only exists in SwapRouter02 (different selector). Using
    // address(0) caused CONTRACT_REVERT_EXECUTED on every Token→HBAR multicall.
    const swapRecipient = isOutputNative ? routerEvmAddress : recipientEvmAddress;

    const swapFunctionData = encodeExactInput(
      packedPath,
      swapRecipient,
      BigInt(deadline),
      BigInt(rawInput),
      BigInt(minOutput),
    );

    if (isInputNative) {
      // ═══ HBAR → Multi-hop → Token via V2 exactInput (payable) ═══
      const hbarAmount = Hbar.fromTinybars(rawInput);

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(swapFunctionData)
        .setPayableAmount(hbarAmount);

      console.log(`[HBAR.h] V2 Multi-hop: Submitting exactInput — HBAR: ${hbarAmount}, calldata: ${swapFunctionData.length}B`);
      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2 Multi-hop: Swap result:", JSON.stringify(swapResult));

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: estimatedOutput > 0 ? estimatedOutput / Math.pow(10, outputToken.decimals) : undefined,
        route: buildDisplayRoute(),
        priceImpact: 0,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v2",
        quoteSource: "price-estimate",
        userCancelled: swapResult.userCancelled,
      };
    } else {
      // ═══ Token → Multi-hop → Token or HBAR via V2 ═══

      // ── Step 1: [C53] Smart approve — skips if allowance sufficient ──
      const mhInfiniteApproval = !!(options?.infiniteApproval);
      const mhApproveResult = await approveIfNeeded({
        tokenHtsId: inputToken.htsId,
        ownerAccountId: accountId,
        spenderAccountId: v2RouterId,
        rawInput,
        infiniteApproval: mhInfiniteApproval,
        network,
        tokenSymbol: inputToken.symbol,
        stepNumber: 1,
        totalSteps: 2,
      });

      if (!mhApproveResult.success) {
        return {
          success: false,
          transactionId: mhApproveResult.transactionId || undefined,
          error: "V2 Multi-hop token approval failed: " + (mhApproveResult.error || "unknown"),
          executionVenue: "saucerswap-v2",
          userCancelled: mhApproveResult.userCancelled,
        };
      }

      const mhSwapStep = mhApproveResult.skipped ? 1 : 2;
      const mhTotalSteps = mhApproveResult.skipped ? 1 : 2;

      if (isOutputNative) {
        // ═══ Token → Multi-hop → HBAR via V2 — atomic multicall [C30-01] ═══
        //
        // [C34-01] Same multicall pattern as single-hop Token→HBAR:
        // multicall(exactInput(recipient=ROUTER) + unwrapWETH9(0, user))
        // swapFunctionData already has recipient=routerEvmAddress (set above via [C34-01]).
        console.log(`[HBAR.h] V2 Multi-hop Step ${mhSwapStep}: multicall(exactInput + unwrapWETH9) — Token→HBAR [C34-01]`);
        window.dispatchEvent(new CustomEvent("swap-step", { detail: {
          step: mhSwapStep, total: mhTotalSteps,
          description: `Swap ${inputToken.symbol} → HBAR via V2 Router (multi-hop, atomic)`,
        }}));

        const unwrapCalldata = encodeUnwrapWHBAR(0n, recipientEvmAddress);
        const multicallData = encodeMulticall([swapFunctionData, unwrapCalldata]);

        console.log(`[HBAR.h] V2 Multi-hop: multicall calldata ${multicallData.length}B ` +
          `(swap=${swapFunctionData.length}B + unwrap=${unwrapCalldata.length}B) ` +
          `swapRecipient=${routerEvmAddress} unwrapRecipient=${recipientEvmAddress} [C34-01]`);

        const multicallTx = new ContractExecuteTransaction()
          .setContractId(ContractId.fromString(v2RouterId))
          .setGas(SWAP_GAS)
          .setFunctionParameters(multicallData);

        const swapResult = await executeHederaTransaction(accountId, multicallTx);
        console.log("[HBAR.h] V2 Multi-hop: Token→HBAR multicall result:", JSON.stringify(swapResult));

        return {
          success: swapResult.success,
          transactionId: swapResult.transactionId || undefined,
          outputAmount: estimatedOutput > 0 ? estimatedOutput / Math.pow(10, 8) : undefined,
          route: buildDisplayRoute(),
          priceImpact: 0,
          error: swapResult.error
            ? `Token→HBAR V2 multi-hop failed: ${swapResult.error}` +
              (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
            : undefined,
          executionVenue: "saucerswap-v2",
          quoteSource: "price-estimate",
          userCancelled: swapResult.userCancelled,
        };
      }

      // ═══ Token → Multi-hop → Token (non-HBAR output) ═══
      console.log(`[HBAR.h] V2 Multi-hop Step ${mhSwapStep}: exactInput (Token→Token)`);
      // [C27-04][C53] Emit step event — step count adjusts based on approve skip
      window.dispatchEvent(new CustomEvent("swap-step", { detail: {
        step: mhSwapStep, total: mhTotalSteps,
        description: `Swap ${inputToken.symbol} → ${outputToken.symbol} via V2 Router (multi-hop)`,
      }}));
      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v2RouterId))
        .setGas(SWAP_GAS)
        .setFunctionParameters(swapFunctionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] V2 Multi-hop: Swap result:", JSON.stringify(swapResult));

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: estimatedOutput > 0 ? estimatedOutput / Math.pow(10, outputToken.decimals) : undefined,
        route: buildDisplayRoute(),
        priceImpact: 0,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v2",
        quoteSource: "price-estimate",
        userCancelled: swapResult.userCancelled,
      };
    }
  } catch (err: any) {
    console.error("[HBAR.h] V2 Multi-hop swap error:", err);
    const errMsg = err?.message || "V2 multi-hop swap failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected") ||
      errLower.includes("user denied");
    return {
      success: false,
      error: errMsg,
      executionVenue: "saucerswap-v2",
      userCancelled: isCancellation || undefined,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── V1 / UNIFIED DIRECT EXECUTION ──────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

async function executeSaucerSwapDirect(
  inputToken: AllowedToken,
  outputToken: AllowedToken,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork,
  options?: SwapOptions,
): Promise<SwapResult> {
  // Late import to avoid circular dependency at module load time
  const { executeHederaTransaction } = await import("../hashpack");

  try {
    const rawInput = parseTokenAmount(inputAmount, inputToken.decimals);

    if (rawInput <= 0) {
      return { success: false, error: "Invalid input amount", executionVenue: "saucerswap-v1" };
    }

    // Determine swap mode based on native HBAR involvement
    const isInputNative = !!inputToken.isNative;
    const isOutputNative = !!outputToken.isNative;
    const whbar = getWhbarToken();

    // Build the swap path — substituting WHBAR for native HBAR in the EVM path
    // since pools use WHBAR internally. The path must use EVM addresses.
    const logicalPath = buildSwapPath(
      isInputNative ? whbar : inputToken,
      isOutputNative ? whbar : outputToken
    );
    // Use SaucerSwap alias EVM addresses for routing (bridge tokens have different pool IDs)
    // [C27-01] Must be `let` — reassigned when direct pool or multi-hop route overrides the path
    let pathAddresses = logicalPath.map((t) => getSaucerswapRoutingEvmAddress(t));

    // ── Resolve the recipient's REAL EVM address via Mirror Node ──
    // Critical fix: htsIdToEvmAddress(accountId) creates a synthetic long-zero
    // address (0x0000...{num}) which may not match what the SaucerSwap router
    // expects when sending output tokens. We resolve the actual EVM address
    // from Mirror Node to ensure the router sends tokens to the right place.
    const recipientEvmAddress = await resolveAccountEvmAddress(accountId, network);

    // ══════════════════════════════════════════════════════════════════
    // ── POOL VERSION DETECTION + MULTI-HOP ROUTING [C9-05] [C26-01] ──
    //
    // [C26-01] Unified routing strategy: ALWAYS try direct pool first,
    // regardless of what buildSwapPath() returned. buildSwapPath forces
    // Token→Token through WHBAR, but many pairs have direct V2 pools
    // (e.g., USDC/SAUCE). Checking direct first avoids unnecessary
    // multi-hop routing and the associated slippage.
    //
    // Strategy:
    // 1. Check DIRECT pool (single-hop) between the two tokens
    // 2. If no direct pool, find a multi-hop route through intermediaries
    //    (WHBAR, USDC, SAUCE, USDCh, USDTh, HBARX)
    // 3. For V2 multi-hop: use exactInput with packed path bytes
    // 4. For V1 multi-hop: pass path array to swapExactTokensForTokens
    //
    // Pool detection checks V2 first (deeper liquidity) then V1.
    // ══════════════════════════════════════════════════════════════════
    let poolVersionInfo: PoolVersionInfo | null = null;
    let multiHopRoute: { hops: PoolVersionInfo[]; tokens: string[] } | null = null;

    // Use routing-aware EVM addresses for pool detection
    const directInEvm = getSaucerswapRoutingEvmAddress(isInputNative ? whbar : inputToken);
    const directOutEvm = getSaucerswapRoutingEvmAddress(isOutputNative ? whbar : outputToken);

    // ── Step 1: ALWAYS check for a DIRECT pool first (most efficient) ──
    poolVersionInfo = await detectPoolVersion(directInEvm, directOutEvm, network);

    if (poolVersionInfo) {
      // Direct pool found — use single-hop. Override pathAddresses for V1 fallback.
      console.log(`[HBAR.h] Direct pool found: ${poolVersionInfo.version} (fee=${poolVersionInfo.feeTier || "N/A"})`);
      pathAddresses = [directInEvm, directOutEvm];
    } else {
      // ── Step 2: No direct pool — search multi-hop routes through intermediaries ──
      console.log(`[HBAR.h] No direct pool — searching multi-hop routes`);
      const intermediaries = getIntermediaryTokens(inputToken, outputToken);
      multiHopRoute = await findBestMultiHopRoute(
        directInEvm, directOutEvm, intermediaries, network
      );
      if (multiHopRoute) {
        console.log(`[HBAR.h] ═══ MULTI-HOP ROUTE FOUND ═══ ${multiHopRoute.tokens.map(t => evmAddressToHtsId(t)).join(" → ")}`);
        multiHopRoute.hops.forEach((h, i) => {
          console.log(`[HBAR.h]   Hop ${i}: ${h.version} fee=${h.feeTier} pool=${h.poolAddress || "?"}`);
        });
        // Update pathAddresses for V1 fallback compatibility
        pathAddresses = multiHopRoute.tokens;
      }
    }

    // ┌─────────────────────────────────────────────────────────────────────┐
    // │  [C36-02] TOKEN→HBAR: FORCE V1 ROUTING                            │
    // │                                                                    │
    // │  SaucerSwap.finance routes ALL Token→HBAR swaps through V1         │
    // │  RouterWithFee (0.0.6755814) using swapExactTokensForETH, NOT      │
    // │  through V2 multicall(exactInputSingle + unwrapWETH9).             │
    // │                                                                    │
    // │  The V2 multicall approach causes CONTRACT_REVERT_EXECUTED on      │
    // │  Hedera — likely because SaucerSwap's WHBAR has a split            │
    // │  contract/token architecture (contract 0.0.1456985 vs HTS token    │
    // │  0.0.1456986) that differs from standard WETH9 assumed by the      │
    // │  Uniswap V3 SwapRouter's unwrapWETH9 function.                     │
    // │                                                                    │
    // │  Fix: When output is native HBAR, override any V2 pool detection   │
    // │  to V1. The V1 swapExactTokensForETH handles WHBAR→HBAR unwrap    │
    // │  internally and is proven working on SaucerSwap mainnet.           │
    // │                                                                    │
    // │  Evidence: USDC→HBAR via V2 multicall reverted (C36 smoke test),   │
    // │  while SaucerSwap.finance's identical swap succeeds via V1.         │
    // └─────────────────────────────────────────────────────────────────────┘
    if (isOutputNative && !isInputNative) {
      if (poolVersionInfo?.version === "v2") {
        console.log(`[HBAR.h] [C36-02] Token→HBAR: overriding V2 pool → V1 (matches SaucerSwap.finance production)`);
        console.log(`[HBAR.h]   V2 pool was: fee=${poolVersionInfo.feeTier}, addr=${poolVersionInfo.poolAddress}`);
        console.log(`[HBAR.h]   Reason: V2 multicall(exactInputSingle+unwrapWETH9) reverts on Hedera`);
        poolVersionInfo = { version: "v1", poolAddress: undefined };
        // pathAddresses stays [directInEvm, directOutEvm] — V1 router handles the path
      }
      if (multiHopRoute && multiHopRoute.hops.some(h => h.version === "v2")) {
        console.log(`[HBAR.h] [C36-02] Token→HBAR multi-hop: overriding V2 hops → V1 (matches SaucerSwap.finance production)`);
        // Force V1 multi-hop — V1 router natively supports path arrays
        poolVersionInfo = { version: "v1", poolAddress: undefined };
        multiHopRoute = null; // Clear V2 multi-hop; V1 will use pathAddresses directly
      }
    }

    // ── V2 single-hop execution ──
    // [C36-02] Token→HBAR was already redirected to V1 above, so this only
    // fires for HBAR→Token or Token→Token (no multicall needed — no revert risk).
    if (poolVersionInfo?.version === "v2" && !multiHopRoute) {
      console.log(`[HBAR.h] ═══ ROUTING VIA V2 (single-hop) ═══ fee=${poolVersionInfo.feeTier}, pool=${poolVersionInfo.poolAddress || "detected"}`);
      return executeSaucerSwapV2Direct(
        inputToken, outputToken, inputAmount, slippagePct,
        accountId, network, poolVersionInfo,
        isInputNative, isOutputNative, whbar,
        rawInput, recipientEvmAddress
      );
    }

    // ── V2 multi-hop execution ──
    // [C36-02] Token→HBAR multi-hop was already redirected to V1 above.
    if (multiHopRoute && multiHopRoute.hops.some(h => h.version === "v2")) {
      console.log(`[HBAR.h] ═══ ROUTING VIA V2 (multi-hop, ${multiHopRoute.hops.length} hops) ═══`);
      return executeSaucerSwapV2MultiHop(
        inputToken, outputToken, inputAmount, slippagePct,
        accountId, network, multiHopRoute,
        isInputNative, isOutputNative, whbar,
        rawInput, recipientEvmAddress
      );
    }

    // ── V1 multi-hop: handled by the V1 execution path below ──
    // (V1 router natively supports path arrays in swapExactTokensForTokens)
    if (multiHopRoute && multiHopRoute.hops.every(h => h.version === "v1")) {
      poolVersionInfo = multiHopRoute.hops[0]; // V1 uses the first hop's info
      // pathAddresses is already set from buildSwapPath — V1 handles multi-hop natively
    }

    // ┌─────────────────────────────────────────────────────────────────┐
    // │  SEC-17 — HARD GATE: Abort if no on-chain pool verified        │
    // │  Previously, null poolVersionInfo fell through to V1 execution │
    // │  which sent HBAR to the router with no valid pair, causing     │
    // │  reverts and potential fund loss. Now we ABORT immediately.    │
    // └─────────────────────────────────────────────────────────────────┘
    if (!poolVersionInfo) {
      const tokenAName = inputToken.symbol;
      const tokenBName = outputToken.symbol;
      console.error(`[HBAR.h] ═══ SAFETY ABORT: No pool found for ${tokenAName} ↔ ${tokenBName} on V1 or V2 ═══`);
      console.error(`[HBAR.h] Path addresses checked: ${pathAddresses.join(" → ")}`);
      return {
        success: false,
        error: `No SaucerSwap pool found for ${tokenAName} → ${tokenBName}. ` +
          `Tried: SaucerSwap API, V2 Factory getPool (fee tiers 3000/10000/500/100), ` +
          `V1 Factory getPair — all returned no pool. Check the browser console for detailed ` +
          `diagnostics. The token pair may not have liquidity on SaucerSwap, or the token HTS IDs ` +
          `may not match the SaucerSwap pool tokens. ` +
          `Check https://www.saucerswap.finance/ to verify the pair exists.`,
        executionVenue: "saucerswap-v1",
      };
    }

    console.log(`[HBAR.h] Pool verified: ${poolVersionInfo.version} (pool: ${poolVersionInfo.poolAddress || "detected"})`);

    // ── V1 execution continues below ──

    // Resolve router address early — needed for both quote and execution.
    // Dynamic discovery verifies candidates by calling factory() on-chain
    // and caches the result, so this only does network calls on first swap.
    //
    // [C36-02] For Token→HBAR: use V1 RouterWithFee (0.0.6755814) instead of
    // RouterV3 (0.0.3045981). SaucerSwap.finance routes ALL Token→HBAR through
    // RouterWithFee. The RouterWithFee supports the same swapExactTokensForETH
    // function and additionally handles fee-on-transfer tokens.
    let v1Router: string;
    if (isOutputNative && !isInputNative) {
      // Token→HBAR: use RouterWithFee (matches SaucerSwap.finance production)
      v1Router = getRouterWithFee(network);
      console.log(`[HBAR.h] [C36-02] Token→HBAR: using V1 RouterWithFee ${v1Router} (matches SaucerSwap.finance)`);
    } else {
      const discoveredRouter = await discoverSaucerSwapRouter(network);
      v1Router = discoveredRouter || getSaucerSwapRouter(network, "v1");
      if (discoveredRouter) {
        console.log(`[HBAR.h] Using dynamically verified router: ${v1Router}`);
      } else {
        console.warn(`[HBAR.h] Router discovery found no verified candidate — using configured default: ${v1Router}`);
      }
    }

    // For quote fetching, use WHBAR's htsId when input is native HBAR.
    // Use SaucerSwap alias IDs for bridge tokens (their pool IDs differ from canonical bridge IDs).
    const quoteInputId = isInputNative ? whbar.htsId : getSaucerswapRoutingId(inputToken);
    const quoteOutputId = isOutputNative ? whbar.htsId : getSaucerswapRoutingId(outputToken);

    // Multi-strategy quote: router view → API → price estimate → fallback
    const quote = await fetchSaucerSwapQuote(quoteInputId, quoteOutputId, rawInput.toString(), {
      pathAddresses,
      routerHtsId: v1Router,
      network,
      inputToken: isInputNative ? whbar : inputToken,
      outputToken: isOutputNative ? whbar : outputToken,
    });

    // ── minOutput calculation ──
    // When quote is available: use it with slippage tolerance.
    // When all strategies fail: try one more inline price estimate before surrendering.
    let minOutput: number;
    if (quote && quote.amountOut > 0) {
      // For price estimates, use wider slippage (prices may be stale)
      const effectiveSlippage = quote.source === "price-estimate"
        ? Math.max(slippagePct, 5)
        : slippagePct;
      minOutput = Math.max(1, Math.floor(quote.amountOut * (1 - effectiveSlippage / 100)));
      console.log(`[HBAR.h] Quote source: ${quote.source}, amountOut=${quote.amountOut}, minOutput=${minOutput} (${effectiveSlippage}% slippage)`);
    } else {
      // Last-ditch inline estimate before surrendering to minOutput=1
      const inTok = isInputNative ? whbar : inputToken;
      const outTok = isOutputNative ? whbar : outputToken;
      const lastDitch = estimateOutputFromPrices(rawInput, inTok, outTok, pathAddresses.length - 1);
      if (lastDitch && lastDitch > 0) {
        const safeSlippage = Math.max(slippagePct, 10); // very generous for emergency estimate
        minOutput = Math.max(1, Math.floor(lastDitch * (1 - safeSlippage / 100)));
        console.warn(`[HBAR.h] All strategies failed but inline price estimate rescued quote: minOutput=${minOutput} (${safeSlippage}% slippage)`);
      } else {
        minOutput = 1;
        console.warn("[HBAR.h] All quote strategies failed including inline rescue — using minOutput=1 (no slippage protection)");
      }
    }

    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min deadline

    // Dynamic import of Hedera SDK
    let sdk: any;
    try {
      sdk = await import("@hashgraph/sdk");
    } catch (e: any) {
      return {
        success: false,
        error: "Hedera SDK not available: " + (e?.message || "unknown"),
        executionVenue: "saucerswap-v1",
      };
    }

    const { ContractExecuteTransaction, ContractId, Hbar, AccountAllowanceApproveTransaction } = sdk;

    // ══════════════════════════════════════════════════════════════════
    // ── CRITICAL SAFETY: Verify the router is a real smart contract ──
    // Prevents sending HBAR/tokens to a random account that isn't the
    // SaucerSwap router. A wrong address silently sends funds to a
    // non-contract account with no swap executed and no revert.
    //
    // verifyIsContract uses multi-strategy verification:
    //   1. Mirror Node /api/v1/contracts/{id}
    //   2. JSON-RPC eth_getCode (with real EVM address from accounts endpoint)
    //   3. eth_call probe (if entity responds to a function call, it's a contract)
    //   4. Diagnostic logging
    // Note: discoverSaucerSwapRouter also caches verified results, so this
    // is typically a cache hit after the initial discovery.
    // ══════════════════════════════════════════════════════════════════
    const routerContractInfo = await verifyIsContract(v1Router, network);
    if (!routerContractInfo) {
      const candidates = (SAUCERSWAP_V1_ROUTER_CANDIDATES[network] || []).join(", ");
      console.error(`[HBAR.h] CRITICAL: Router ${v1Router} is NOT a valid smart contract on ${network}!`);
      console.error(`[HBAR.h] Candidates tried during discovery: ${candidates}`);
      return {
        success: false,
        error: `SAFETY ABORT: Router address ${v1Router} failed contract verification on ${network} ` +
          `(checked via Mirror Node AND JSON-RPC eth_getCode). ` +
          `This would send your funds to a non-contract account with no swap executed. ` +
          `Candidates tried: [${candidates}]. ` +
          `Please verify the correct SaucerSwap V1 Router address at https://docs.saucerswap.finance/.`,
        executionVenue: "saucerswap-v1",
      };
    }
    console.log(`[HBAR.h] Router ${v1Router} verified as contract ✓ (EVM: ${routerContractInfo.evmAddress})`);

    // ── Resolve the router's EVM address for approve calls ──
    // Use the verified contract EVM address (not the synthetic long-zero form)
    // so that ERC-20 approve() sets the allowance for the correct spender address.
    const routerEvmAddress = routerContractInfo.evmAddress || await resolveContractEvmAddress(v1Router, network);

    // ── Log full swap parameters for debugging ──
    console.log("[HBAR.h] ═══════════════════════════════════════════");
    console.log("[HBAR.h] SWAP EXECUTION START");
    console.log("[HBAR.h] Input:", inputToken.symbol, "→ Output:", outputToken.symbol);
    console.log("[HBAR.h] Amount:", inputAmount, `(raw: ${rawInput})`);
    console.log("[HBAR.h] Path:", pathAddresses.join(" → "));
    console.log("[HBAR.h] Recipient EVM:", recipientEvmAddress);
    console.log("[HBAR.h] Router:", v1Router, `(EVM: ${routerEvmAddress}, verified: ${routerContractInfo.contractId})`);
    console.log("[HBAR.h] MinOutput:", minOutput, `(quote: ${quote?.amountOut ?? "none"})`);
    console.log("[HBAR.h] Slippage:", slippagePct, "% | Deadline:", deadline);
    console.log("[HBAR.h] Mode:", isInputNative ? "HBAR→Token" : isOutputNative ? "Token→HBAR" : "Token→Token");
    console.log("[HBAR.h] ═══════════════════════════════════════════");

    // ══════════════════════════════════════════════════════════════════
    // ── SAFETY NET: Token association check inside execution ──
    // Even though SwapPanel should handle this, we check again here as
    // a final guard. Swapping to an unassociated token causes
    // CONTRACT_REVERT_EXECUTED, burning the entire gas limit with no output.
    // ══════════════════════════════════════════════════════════════════
    if (!isOutputNative) {
      const outputHtsId = outputToken.htsId;
      const isAssoc = await isTokenAssociated(accountId, outputHtsId, network);
      if (!isAssoc) {
        console.warn(`[HBAR.h] SAFETY NET: Output token ${outputToken.symbol} (${outputHtsId}) NOT associated — auto-associating`);
        try {
          const assocSdk = await import("@hashgraph/sdk");
          const assocTx = new assocSdk.TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([outputHtsId]);
          const assocResult = await executeHederaTransaction(accountId, assocTx);
          if (!assocResult.success) {
            return {
              success: false,
              error: `Output token ${outputToken.symbol} is not associated with your account and auto-association failed: ${assocResult.error || "unknown"}. Please associate token ${outputHtsId} manually in HashPack before swapping.`,
              executionVenue: "saucerswap-v1",
              userCancelled: assocResult.userCancelled,
            };
          }
          console.log(`[HBAR.h] SAFETY NET: Successfully associated ${outputToken.symbol}`);
        } catch (assocErr: any) {
          const aMsg = (assocErr?.message || "").toLowerCase();
          const aCancel = aMsg.includes("user_reject") || aMsg.includes("cancelled by user") || aMsg.includes("canceled by user") || aMsg.includes("user denied") || aMsg.includes("user rejected");
          return {
            success: false,
            error: `Cannot associate output token ${outputToken.symbol}: ${assocErr?.message || "unknown"}. Associate token ${outputHtsId} in HashPack first.`,
            executionVenue: "saucerswap-v1",
            userCancelled: aCancel || undefined,
          };
        }
      } else {
        console.log(`[HBAR.h] Output token ${outputToken.symbol} association confirmed ✓`);
      }
    }

    // Also verify intermediate tokens in multi-hop paths
    if (logicalPath.length > 2) {
      for (let i = 1; i < logicalPath.length - 1; i++) {
        const midToken = logicalPath[i];
        if (!midToken.isNative) {
          const midAssoc = await isTokenAssociated(accountId, midToken.htsId, network);
          if (!midAssoc) {
            console.warn(`[HBAR.h] SAFETY NET: Intermediate token ${midToken.symbol} NOT associated — auto-associating`);
            try {
              const assocSdk = await import("@hashgraph/sdk");
              const midAssocTx = new assocSdk.TokenAssociateTransaction()
                .setAccountId(accountId)
                .setTokenIds([midToken.htsId]);
              await executeHederaTransaction(accountId, midAssocTx);
            } catch {
              console.warn(`[HBAR.h] Could not auto-associate intermediate ${midToken.symbol} — swap may revert`);
            }
          }
        }
      }
    }

    // Gas limits for EVM calls — these are gas LIMITS passed to setGas(),
    // NOT the HBAR cost. Hedera gas fees are sub-cent for typical swaps.
    const SWAP_GAS = 1_500_000;
    // [C36-01] APPROVE_GAS no longer needed — V1 Token→HBAR and V1 Token→Token
    // both use native HTS AccountAllowanceApproveTransaction (no EVM gas required).
    // Retained as dead code; safe to remove in a future cleanup pass.
    const APPROVE_GAS = 800_000; // eslint-disable-line @typescript-eslint/no-unused-vars

    // ══════════════════════════════════════════════════════════════════
    // ── GAS SUFFICIENCY CHECK ──
    // Hedera gas fees are sub-cent. Reserve 1 HBAR total to cover gas +
    // network fees — good for dozens of transactions. The old 15 HBAR
    // reserve was overly conservative and blocked users unnecessarily.
    // ══════════════════════════════════════════════════════════════════
    const gasReserveNeeded = 1; // 1 HBAR covers gas + network fees with plenty of margin

    // For HBAR input, check that balance covers input + gas
    if (isInputNative) {
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      const inputHbar = parseFloat(inputAmount);
      const totalNeeded = inputHbar + gasReserveNeeded;
      if (hbarBalance < totalNeeded) {
        const shortfall = totalNeeded - hbarBalance;
        console.error(`[HBAR.h] Insufficient HBAR for swap + gas: balance=${hbarBalance.toFixed(2)}, needed=${totalNeeded.toFixed(2)} (input=${inputHbar}, gas reserve=${gasReserveNeeded})`);
        return {
          success: false,
          error: `Insufficient HBAR: you have ${hbarBalance.toFixed(2)} HBAR but need ${totalNeeded.toFixed(2)} HBAR (${inputHbar} for swap + ${gasReserveNeeded} for fees). Reduce the swap amount by at least ${shortfall.toFixed(2)} HBAR.`,
          executionVenue: "saucerswap-v1",
        };
      }
    } else {
      // For token input, check HBAR balance covers gas only
      const hbarBalanceTinybar = await getNativeHbarBalance(accountId, network);
      const hbarBalance = hbarBalanceTinybar / 1e8;
      if (hbarBalance < gasReserveNeeded) {
        console.error(`[HBAR.h] Insufficient HBAR for gas: balance=${hbarBalance.toFixed(2)}, needed=${gasReserveNeeded}`);
        return {
          success: false,
          error: `Insufficient HBAR for fees: you have ${hbarBalance.toFixed(2)} HBAR but need at least ${gasReserveNeeded} HBAR. Deposit more HBAR first.`,
          executionVenue: "saucerswap-v1",
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ── PRE-SWAP DRY RUN via Mirror Node ──
    // [C16-02] Only dry-run for HBAR-input swaps. For token-input swaps,
    // the ERC-20 approve hasn't been sent yet, so the dry run always
    // reverts with "STF" / "execution reverted" (insufficient allowance).
    // This false-positive revert was blocking Token → HBAR and Token →
    // Token V1 swaps at the dry-run gate.
    // ══════════════════════════════════════════════════════════════════
    // [C36-03] FIX: `dryRunResult` was previously `const` inside the `if (isInputNative)`
    // block, making it inaccessible to the Token→HBAR and Token→Token execution branches
    // that reference `dryRunResult.ok`. With C36-02 routing Token→HBAR through V1,
    // this would cause a ReferenceError. Now declared at function scope with a default.
    let dryRunResult: DryRunResult = { ok: true, simulated: false, reason: "Skipped for token-input swap [C16-02]" };
    if (isInputNative) {
    dryRunResult = await preSwapDryRun({
      isInputNative,
      isOutputNative,
      rawInput,
      minOutput,
      pathAddresses,
      recipientEvmAddress,
      routerHtsId: v1Router,
      deadline,
      network,
    });
    if (!dryRunResult.ok) {
      console.error("[HBAR.h] PRE-SWAP DRY RUN FAILED:", dryRunResult.reason);
      console.error("[HBAR.h] Dry run details:", JSON.stringify(dryRunResult));
      return {
        success: false,
        error: `Pre-swap simulation failed: ${dryRunResult.reason}. The swap would revert on-chain and waste gas fees. Fix the issue and try again.`,
        executionVenue: "saucerswap-v1",
      };
    }
    if (dryRunResult.simulated) {
      console.log(`[HBAR.h] Pre-swap dry run PASSED ✓ (${dryRunResult.functionName}, ${dryRunResult.resultHexLength} hex chars, ${dryRunResult.durationMs}ms)`);
    } else {
      console.log(`[HBAR.h] Pre-swap dry run SKIPPED (${dryRunResult.reason}) — proceeding with real swap`);
    }
    } else {
      console.log("[HBAR.h] V1 Dry run SKIPPED for token-input swap (approve not yet granted — would false-revert) [C16-02]");
    }

    // ── Execution branches based on native HBAR involvement ──

    if (isInputNative) {
      // ═══ HBAR (native) → Token: use swapExactETHForTokens ═══
      // No token approval needed — HBAR is sent as payable amount.
      // The router internally wraps HBAR → WHBAR and swaps through the pool.
      console.log("[HBAR.h] Native HBAR input — using swapExactETHForTokens");

      const functionData = encodeSaucerSwapETHForTokens(
        BigInt(minOutput),
        pathAddresses,
        recipientEvmAddress,
        BigInt(deadline)
      );

      const hbarAmount = rawInput / Math.pow(10, 8); // Convert tinybars to HBAR

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v1Router))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData)
        .setPayableAmount(new Hbar(hbarAmount));

      console.log("[HBAR.h] Submitting swapExactETHForTokens — HBAR:", hbarAmount);
      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] Swap result:", JSON.stringify(swapResult));

      // Build display route with HBAR instead of WHBAR
      const displayRoute = logicalPath.map(t => t.symbol);
      displayRoute[0] = "HBAR";

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: displayRoute,
        priceImpact: quote?.priceImpact,
        error: swapResult.error || undefined,
        executionVenue: "saucerswap-v1",
        quoteSource: quote?.source || "none",
        dryRunPassed: dryRunResult.ok,
        userCancelled: swapResult.userCancelled,
      };

    } else if (isOutputNative) {
      // ═══ Token → HBAR (native): use swapExactTokensForETH ═══
      console.log("[HBAR.h] Native HBAR output — using swapExactTokensForETH");

      // Step 1: [C53] Smart approve — skips if allowance sufficient
      const v1ApproveResult1 = await approveIfNeeded({
        tokenHtsId: inputToken.htsId,
        ownerAccountId: accountId,
        spenderAccountId: v1Router,
        rawInput,
        infiniteApproval: !!(options?.infiniteApproval),
        network,
        tokenSymbol: inputToken.symbol,
        stepNumber: 1,
        totalSteps: 2,
      });

      if (!v1ApproveResult1.success) {
        return {
          success: false,
          transactionId: v1ApproveResult1.transactionId || undefined,
          error: "Token approval failed: " + (v1ApproveResult1.error || "unknown"),
          executionVenue: "saucerswap-v1",
          userCancelled: v1ApproveResult1.userCancelled,
        };
      }

      const v1SwapStep1 = v1ApproveResult1.skipped ? 1 : 2;
      const v1TotalSteps1 = v1ApproveResult1.skipped ? 1 : 2;

      // Swap step: swapExactTokensForETH
      console.log(`[HBAR.h] Step ${v1SwapStep1}: swapExactTokensForETH`);
      const functionData = encodeSaucerSwapTokensForETH(
        BigInt(rawInput),
        BigInt(minOutput),
        pathAddresses,
        recipientEvmAddress,
        BigInt(deadline)
      );

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v1Router))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] Swap result:", JSON.stringify(swapResult));
      const displayRoute = logicalPath.map(t => t.symbol);
      displayRoute[displayRoute.length - 1] = "HBAR";

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, 8) : undefined,
        route: displayRoute,
        priceImpact: quote?.priceImpact,
        error: swapResult.error
          ? swapResult.error + (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
          : undefined,
        executionVenue: "saucerswap-v1",
        quoteSource: quote?.source || "none",
        dryRunPassed: dryRunResult.ok,
        userCancelled: swapResult.userCancelled,
      };

    } else {
      // ═══ Token → Token: standard swapExactTokensForTokens ═══

      // Step 1: [C53] Smart approve — skips if allowance sufficient
      const v1ApproveResult2 = await approveIfNeeded({
        tokenHtsId: inputToken.htsId,
        ownerAccountId: accountId,
        spenderAccountId: v1Router,
        rawInput,
        infiniteApproval: !!(options?.infiniteApproval),
        network,
        tokenSymbol: inputToken.symbol,
        stepNumber: 1,
        totalSteps: 2,
      });

      if (!v1ApproveResult2.success) {
        return {
          success: false,
          transactionId: v1ApproveResult2.transactionId || undefined,
          error: "Token approval failed: " + (v1ApproveResult2.error || "unknown"),
          executionVenue: "saucerswap-v1",
          userCancelled: v1ApproveResult2.userCancelled,
        };
      }

      const v1SwapStep2 = v1ApproveResult2.skipped ? 1 : 2;
      const v1TotalSteps2 = v1ApproveResult2.skipped ? 1 : 2;

      // Swap step: swapExactTokensForTokens
      console.log(`[HBAR.h] Step ${v1SwapStep2}: swapExactTokensForTokens`);
      const functionData = encodeSaucerSwapCall(
        BigInt(rawInput),
        BigInt(minOutput),
        pathAddresses,
        recipientEvmAddress,
        BigInt(deadline)
      );

      const swapTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(v1Router))
        .setGas(SWAP_GAS)
        .setFunctionParameters(functionData);

      const swapResult = await executeHederaTransaction(accountId, swapTx);
      console.log("[HBAR.h] Swap result:", JSON.stringify(swapResult));

      return {
        success: swapResult.success,
        transactionId: swapResult.transactionId || undefined,
        outputAmount: quote ? quote.amountOut / Math.pow(10, outputToken.decimals) : undefined,
        route: logicalPath.map((t) => t.symbol),
        priceImpact: quote?.priceImpact,
        error: swapResult.error
          ? swapResult.error + (swapResult.transactionId ? ` (tx: ${swapResult.transactionId})` : "")
          : undefined,
        executionVenue: "saucerswap-v1",
        quoteSource: quote?.source || "none",
        dryRunPassed: dryRunResult.ok,
        userCancelled: swapResult.userCancelled,
      };
    }
  } catch (err: any) {
    console.error("[HBAR.h] Swap execution error:", err);
    const errMsg = err?.message || "Direct swap failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return {
      success: false,
      error: errMsg,
      executionVenue: "saucerswap-v1",
      userCancelled: isCancellation || undefined,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── PUBLIC API ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Execute a swap through SauceSwap V1 router.
 *
 * Uses HashConnect v3's signer-based flow:
 * 1. Builds unfrozen Hedera SDK transactions
 * 2. Passes them to executeHederaTransaction() from hashpack.ts
 * 3. HashConnect signer freezes (sets nodeAccountIds + txId),
 *    sends to HashPack for signing, and submits to the network
 *
 * Uses HashConnect signer's executeTransaction() which handles freezing,
 * signing, and submission atomically. Unfrozen transactions cannot be
 * serialized/deserialized, so the signer must own the full lifecycle.
 */
/** [C53] Swap options — controls approval behavior and balance validation. */
export interface SwapOptions {
  /** If true, approve MAX_SAFE_INTEGER allowance instead of exact amount. */
  infiniteApproval?: boolean;
}

export async function executeSaucerSwap(
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: string,
  slippagePct: number,
  accountId: string,
  network: HederaNetwork,
  options?: SwapOptions,
): Promise<SwapResult> {
  const inputToken = resolveToken(inputSymbol);
  const outputToken = resolveToken(outputSymbol);

  if (!inputToken || !outputToken) {
    return {
      success: false,
      error: "Token not supported: " + (!inputToken ? inputSymbol : outputSymbol) + ". Only pre-approved wrapped assets on SauceSwap are supported.",
      executionVenue: "restricted-router",
    };
  }

  if (inputToken.symbol === outputToken.symbol) {
    return { success: false, error: "Cannot swap a token for itself", executionVenue: "restricted-router" };
  }

  // [C53] Pre-flight token balance validation — abort BEFORE any wallet popup
  // For non-native tokens, check that the user actually holds enough tokens.
  // HBAR balance is checked inside executeSaucerSwapDirect (needs gas calculation).
  if (!inputToken.isNative) {
    const rawNeeded = parseTokenAmount(inputAmount, inputToken.decimals);
    if (rawNeeded <= 0) {
      return { success: false, error: "Invalid input amount", executionVenue: "restricted-router" };
    }
    const rawBalance = await getTokenBalance(accountId, inputToken.htsId, network);
    if (rawBalance < rawNeeded) {
      const humanBalance = rawBalance / Math.pow(10, inputToken.decimals);
      const humanNeeded = parseFloat(inputAmount);
      console.error(`[C53] Insufficient ${inputToken.symbol}: balance=${rawBalance} (${humanBalance.toFixed(6)}) < needed=${rawNeeded} (${humanNeeded})`);
      return {
        success: false,
        error: `Insufficient ${inputToken.symbol}: you have ${humanBalance.toFixed(6)} but need ${humanNeeded}. ` +
          `Reduce the swap amount or acquire more ${inputToken.symbol}.`,
        executionVenue: "restricted-router",
      };
    }
    console.log(`[C53] Balance check passed: ${inputToken.symbol} ${rawBalance} >= ${rawNeeded} ✓`);
  }

  return executeSaucerSwapDirect(inputToken, outputToken, inputAmount, slippagePct, accountId, network, options);
}

/**
 * [C72] SaucerSwap HBAR Wrapping / Unwrapping
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: wrapHbar, unwrapHbar
 *
 * Dependencies: tokens (getWhbarToken), contracts (SAUCERSWAP_WHBAR_CONTRACT),
 *               abi (encodeUint256)
 * Dynamic: @hashgraph/sdk, hashpack (executeHederaTransaction)
 */

import type { HederaNetwork } from "./tokens";
import { getWhbarToken } from "./tokens";
import { SAUCERSWAP_WHBAR_CONTRACT } from "./contracts";
import { encodeUint256 } from "./abi";

// ══════════════════════════════════════════════════════════════════════
// ── HBAR WRAPPING / UNWRAPPING ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Wrap native HBAR into WHBAR (HTS token 0.0.1456986).
 *
 * Calls the WHBAR contract's deposit() function with native HBAR
 * as the payable value. The contract mints equivalent WHBAR tokens
 * to the caller's account.
 *
 * @param amount  Amount in HBAR (e.g., "10" for 10 HBAR)
 * @param accountId  Hedera account ID
 * @param network  "mainnet" | "testnet"
 */
export async function wrapHbar(
  amount: string,
  accountId: string,
  network: HederaNetwork
): Promise<{ success: boolean; transactionId?: string; error?: string; userCancelled?: boolean }> {
  try {
    const { executeHederaTransaction } = await import("../hashpack");
    const sdk = await import("@hashgraph/sdk");
    const { ContractExecuteTransaction, ContractId, Hbar } = sdk;

    const whbar = getWhbarToken();
    const hbarAmount = parseFloat(amount);
    if (isNaN(hbarAmount) || hbarAmount <= 0) {
      return { success: false, error: "Invalid HBAR amount" };
    }

    // deposit() function selector: keccak256("deposit()") = 0xd0e30db0
    const depositSelector = new Uint8Array([0xd0, 0xe3, 0x0d, 0xb0]);

    // [C16-01] Call the WHBAR contract (0.0.1456985), NOT the token ID
    // (0.0.1456986). deposit() is a custom function on the deploying
    // contract — the HTS system contract at the token ID only handles
    // standard ERC-20 operations.
    const whbarContractId = SAUCERSWAP_WHBAR_CONTRACT[network] || SAUCERSWAP_WHBAR_CONTRACT.mainnet;
    console.log(`[HBAR.h] Wrapping ${hbarAmount} HBAR → WHBAR via deposit() on ${whbarContractId}`);
    const tx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(whbarContractId))
      .setGas(800_000)
      .setFunctionParameters(depositSelector)
      .setPayableAmount(new Hbar(hbarAmount));

    const result = await executeHederaTransaction(accountId, tx);
    console.log("[HBAR.h] Wrap result:", JSON.stringify(result));
    return {
      success: result.success,
      transactionId: result.transactionId || undefined,
      error: result.error || undefined,
      userCancelled: result.userCancelled,
    };
  } catch (err: any) {
    console.error("[HBAR.h] Wrap error:", err);
    const errMsg = err?.message || "HBAR wrapping failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return { success: false, error: errMsg, userCancelled: isCancellation || undefined };
  }
}

/**
 * Unwrap WHBAR back to native HBAR.
 *
 * Uses the SaucerSwap WhbarHelper contract (0.0.5808826 on mainnet)
 * which handles the full unwrap flow:
 *   1. Transfers WHBAR from user to the helper contract
 *   2. Helper approves the WHBAR contract to burn the tokens
 *   3. Helper calls WHBAR.withdraw(this, user, amount) → sends native HBAR
 *
 * The user must first approve the WhbarHelper to spend their WHBAR.
 * This function handles both the approval and the unwrap in sequence.
 *
 * @param amount  Amount in HBAR units (e.g., "10" for 10 WHBAR → 10 HBAR)
 * @param accountId  Hedera account ID
 * @param network  "mainnet" | "testnet"
 */
export async function unwrapHbar(
  amount: string,
  accountId: string,
  network: HederaNetwork
): Promise<{ success: boolean; transactionId?: string; error?: string; userCancelled?: boolean }> {
  try {
    const { executeHederaTransaction } = await import("../hashpack");
    const sdk = await import("@hashgraph/sdk");
    const { ContractExecuteTransaction, ContractId, AccountId, TokenId, AccountAllowanceApproveTransaction } = sdk;

    const whbar = getWhbarToken();
    const hbarAmount = parseFloat(amount);
    if (isNaN(hbarAmount) || hbarAmount <= 0) {
      return { success: false, error: "Invalid WHBAR amount" };
    }

    const rawAmount = Math.floor(hbarAmount * Math.pow(10, 8)); // WHBAR has 8 decimals
    const WHBAR_TOKEN_ID = whbar.htsId; // 0.0.1456986

    // WhbarHelper contract handles the full unwrap sequence
    // (transfer WHBAR → approve → withdraw → send HBAR to user)
    const WHBAR_HELPER: Record<string, string> = {
      mainnet: "0.0.5808826",
      testnet: "0.0.15057",
    };
    const helperContractId = WHBAR_HELPER[network] || WHBAR_HELPER.mainnet;

    console.log(`[WHBAR] Unwrapping ${hbarAmount} WHBAR → HBAR via WhbarHelper ${helperContractId}`);

    // Step 1: Approve the WhbarHelper to spend our WHBAR tokens
    // The helper needs to transferFrom(user → helper) before it can call withdraw
    console.log(`[WHBAR] Step 1: Approving WhbarHelper ${helperContractId} to spend ${rawAmount} WHBAR (${WHBAR_TOKEN_ID})`);
    const approveTx = new AccountAllowanceApproveTransaction()
      .approveTokenAllowance(
        TokenId.fromString(WHBAR_TOKEN_ID),
        AccountId.fromString(accountId),
        AccountId.fromString(helperContractId),
        rawAmount
      );

    const approveResult = await executeHederaTransaction(accountId, approveTx);
    if (!approveResult.success) {
      console.warn("[WHBAR] Approval failed:", approveResult.error);
      return {
        success: false,
        error: approveResult.error || "WHBAR allowance approval failed",
        userCancelled: approveResult.userCancelled,
      };
    }
    console.log("[WHBAR] Approval succeeded:", approveResult.transactionId);

    // Step 2: Call WhbarHelper.unwrapWhbar(uint256 wad)
    // Use the SDK's setFunction which computes keccak256 selector automatically
    console.log(`[WHBAR] Step 2: Calling WhbarHelper.unwrapWhbar(${rawAmount}) on ${helperContractId}`);
    const { ContractFunctionParameters } = sdk;
    const tx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(helperContractId))
      .setGas(800_000)
      .setFunction(
        "unwrapWhbar",
        new ContractFunctionParameters().addUint256(rawAmount)
      );

    const result = await executeHederaTransaction(accountId, tx);
    console.log("[WHBAR] Unwrap result:", JSON.stringify(result));
    return {
      success: result.success,
      transactionId: result.transactionId || undefined,
      error: result.error || undefined,
      userCancelled: result.userCancelled,
    };
  } catch (err: any) {
    console.error("[WHBAR] Unwrap error:", err);
    const errMsg = err?.message || "WHBAR unwrapping failed";
    const errLower = errMsg.toLowerCase();
    const isCancellation =
      errLower.includes("user_reject") ||
      errLower.includes("cancelled by user") ||
      errLower.includes("canceled by user") ||
      errLower.includes("rejected in hashpack") ||
      errLower.includes("user denied") ||
      errLower.includes("user rejected");
    return { success: false, error: errMsg, userCancelled: isCancellation || undefined };
  }
}
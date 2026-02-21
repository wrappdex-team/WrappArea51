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
 * Calls the WHBAR contract's withdraw(uint256) function which burns
 * the specified WHBAR tokens and sends equivalent native HBAR back
 * to the caller.
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
    const { ContractExecuteTransaction, ContractId, Hbar } = sdk;

    const whbar = getWhbarToken();
    const hbarAmount = parseFloat(amount);
    if (isNaN(hbarAmount) || hbarAmount <= 0) {
      return { success: false, error: "Invalid WHBAR amount" };
    }

    const rawAmount = Math.floor(hbarAmount * Math.pow(10, 8)); // WHBAR has 8 decimals

    // withdraw(uint256) selector: keccak256("withdraw(uint256)") = 0x2e1a7d4d
    const selector = new Uint8Array([0x2e, 0x1a, 0x7d, 0x4d]);
    const amountBytes = encodeUint256(BigInt(rawAmount));
    const functionData = new Uint8Array(selector.length + amountBytes.length);
    functionData.set(selector, 0);
    functionData.set(amountBytes, selector.length);

    // [C16-01] Call the WHBAR contract (0.0.1456985), NOT the token ID
    // (0.0.1456986). withdraw() is a custom function on the deploying
    // contract — the HTS system contract at the token ID only handles
    // standard ERC-20 operations.
    const whbarContractId = SAUCERSWAP_WHBAR_CONTRACT[network] || SAUCERSWAP_WHBAR_CONTRACT.mainnet;
    console.log(`[HBAR.h] Unwrapping ${hbarAmount} WHBAR → HBAR via withdraw(${rawAmount}) on ${whbarContractId}`);
    const tx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(whbarContractId))
      .setGas(800_000)
      .setFunctionParameters(functionData);

    const result = await executeHederaTransaction(accountId, tx);
    console.log("[HBAR.h] Unwrap result:", JSON.stringify(result));
    return {
      success: result.success,
      transactionId: result.transactionId || undefined,
      error: result.error || undefined,
      userCancelled: result.userCancelled,
    };
  } catch (err: any) {
    console.error("[HBAR.h] Unwrap error:", err);
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

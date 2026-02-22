/**
 * [C72 → C89 → C97] SaucerSwap HBAR Wrapping / Unwrapping
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: wrapHbar, unwrapHbar
 *
 * [C89] Unwrap rewrite:
 *   - Uses fast-path approval (matches swap-engine.ts pattern)
 *   - 5s consensus wait between approval and contract call
 *   - Increased gas to 1,500,000 for the 3-nested-call unwrap
 *   - Fallback: direct WHBAR contract withdraw(address,address,uint256)
 *     if WhbarHelper reverts
 *
 * [C97] Static SDK import via hedera-sdk.ts (replaces dynamic imports)
 *
 * Dependencies: tokens (getWhbarToken), contracts (SAUCERSWAP_WHBAR_CONTRACT),
 *               abi (encodeUint256), hedera-sdk
 * Dynamic: hashpack (executeHederaTransaction[Fast])
 */

import type { HederaNetwork } from "./tokens";
import { getWhbarToken } from "./tokens";
import { SAUCERSWAP_WHBAR_CONTRACT } from "./contracts";
import { encodeUint256 } from "./abi";
import {
  ContractExecuteTransaction,
  ContractId,
  ContractFunctionParameters,
  Hbar,
  AccountAllowanceApproveTransaction,
  TokenId,
  AccountId,
} from "../hedera-sdk";

// ══════════════════════════════════════════════════════════════════════
// ── WHBAR Helper & Contract Addresses ───────────────────────────────
// ══════════════════════════════════════════════════════════════════════

const WHBAR_HELPER: Record<string, string> = {
  mainnet: "0.0.5808826",
  testnet: "0.0.15057",
};

// ══════════════════════════════════════════════════════════════════════
// ── HBAR WRAPPING ───────────────────────────────────────────────────
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
    const contractId = SAUCERSWAP_WHBAR_CONTRACT[network] || SAUCERSWAP_WHBAR_CONTRACT.mainnet;

    const tx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(contractId))
      .setGas(800_000)
      .setPayableAmount(new Hbar(hbarAmount))
      .setFunctionParameters(depositSelector);

    console.log(`[WHBAR] Wrapping ${hbarAmount} HBAR via contract ${contractId}`);
    const result = await executeHederaTransaction(accountId, tx);

    if (result.success) {
      console.log(`[WHBAR] Wrap success: ${result.transactionId}`);
    } else {
      console.warn(`[WHBAR] Wrap failed: ${result.error}`);
    }
    return {
      success: result.success,
      transactionId: result.transactionId || undefined,
      error: result.error || undefined,
      userCancelled: result.userCancelled,
    };
  } catch (err: any) {
    console.error("[WHBAR] Wrap error:", err);
    return { success: false, error: err?.message || "HBAR wrapping failed" };
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── HBAR UNWRAPPING ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Unwrap WHBAR back to native HBAR.
 *
 * Primary path: WhbarHelper.unwrapWhbar(uint256 wad)
 *   - Requires HTS allowance for the WhbarHelper contract
 *   - Fast-path approval + 2s consensus wait + contract call
 *
 * Fallback: If WhbarHelper reverts, try direct WHBAR contract
 *   withdraw(address src, address dst, uint wad) which only needs the user
 *   to call it directly (no allowance needed if src == msg.sender).
 */
export async function unwrapHbar(
  amount: string,
  accountId: string,
  network: HederaNetwork
): Promise<{ success: boolean; transactionId?: string; error?: string; userCancelled?: boolean }> {
  const { executeHederaTransactionFast, executeHederaTransaction } = await import("../hashpack");

  const whbar = getWhbarToken();
  const hbarAmount = parseFloat(amount);
  if (isNaN(hbarAmount) || hbarAmount <= 0) {
    return { success: false, error: "Invalid WHBAR amount" };
  }

  const rawAmount = Math.floor(hbarAmount * Math.pow(10, 8)); // WHBAR has 8 decimals
  const WHBAR_TOKEN_ID = whbar.htsId; // 0.0.1456986
  const helperContractId = WHBAR_HELPER[network] || WHBAR_HELPER.mainnet;
  const whbarContractId = SAUCERSWAP_WHBAR_CONTRACT[network] || SAUCERSWAP_WHBAR_CONTRACT.mainnet;

  console.log(`[WHBAR] Unwrapping ${hbarAmount} WHBAR (${rawAmount} raw) → HBAR`);

  // ── PRIMARY PATH: WhbarHelper ────────────────────────────────────
  try {
    const result = await _unwrapViaHelper(
      executeHederaTransactionFast, executeHederaTransaction,
      accountId, rawAmount, WHBAR_TOKEN_ID, helperContractId,
    );
    if (result.success) return result;

    // If helper reverted (not user cancel), try fallback
    if (result.userCancelled) return result;
    console.warn("[WHBAR] WhbarHelper failed:", result.error, "— trying direct WHBAR withdraw fallback");
  } catch (err: any) {
    console.warn("[WHBAR] WhbarHelper exception:", err?.message);
  }

  // ── FALLBACK: Direct WHBAR contract withdraw ─────────────────────
  try {
    console.log(`[WHBAR] Fallback: direct withdraw on ${whbarContractId}`);
    return await _unwrapDirect(
      executeHederaTransaction,
      accountId, rawAmount, whbarContractId, network,
    );
  } catch (err: any) {
    console.error("[WHBAR] Direct withdraw failed:", err);
    return {
      success: false,
      error: err?.message || "WHBAR unwrapping failed (both paths)",
      userCancelled: _isCancellation(err?.message || "") || undefined,
    };
  }
}

// ── WhbarHelper Path ──────────────────────────────────────────────────

async function _unwrapViaHelper(
  executeFast: typeof import("../hashpack")["executeHederaTransactionFast"],
  executeFull: typeof import("../hashpack")["executeHederaTransaction"],
  accountId: string,
  rawAmount: number,
  whbarTokenId: string,
  helperContractId: string,
): Promise<{ success: boolean; transactionId?: string; error?: string; userCancelled?: boolean }> {
  // ── Step 1: Fast-path HTS allowance approval ──────────────────────
  console.log(`[WHBAR] Step 1/2: Approving WhbarHelper ${helperContractId} for ${rawAmount} WHBAR (fast path)`);

  const approveTx = new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(
      TokenId.fromString(whbarTokenId),
      AccountId.fromString(accountId),
      AccountId.fromString(helperContractId),
      rawAmount
    );

  const approveResult = await executeFast(accountId, approveTx);
  if (!approveResult.success) {
    console.warn("[WHBAR] Approval failed:", approveResult.error);
    return {
      success: false,
      error: approveResult.error || "WHBAR allowance approval failed",
      userCancelled: approveResult.userCancelled,
    };
  }
  console.log("[WHBAR] Approval submitted:", approveResult.transactionId);

  // ── [SEC-14] Consensus wait ─────────────────────────────────────────
  // Fast-path approval skips receipt polling. Without this wait, the
  // subsequent contract call may see stale allowance → revert.
  // 3s floor matches swap-engine.ts CONSENSUS_WAIT_MS.
  console.log("[WHBAR] [SEC-14] Waiting 3s for approval consensus finality...");
  await new Promise(r => setTimeout(r, 3000));

  // ── Step 2: Call WhbarHelper.unwrapWhbar(uint256 wad) ──────────────
  console.log(`[WHBAR] Step 2/2: WhbarHelper.unwrapWhbar(${rawAmount}) on ${helperContractId}`);

  const params = new ContractFunctionParameters();
  params.addUint256(rawAmount);

  const tx = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(helperContractId))
    .setGas(1_500_000)
    .setFunction("unwrapWhbar", params);

  const result = await executeFull(accountId, tx);
  console.log("[WHBAR] WhbarHelper result:", JSON.stringify(result));
  return {
    success: result.success,
    transactionId: result.transactionId || undefined,
    error: result.error || undefined,
    userCancelled: result.userCancelled,
  };
}

// ── Direct WHBAR Withdraw Path ────────────────────────────────────────

async function _unwrapDirect(
  executeFull: typeof import("../hashpack")["executeHederaTransaction"],
  accountId: string,
  rawAmount: number,
  whbarContractId: string,
  network: HederaNetwork,
): Promise<{ success: boolean; transactionId?: string; error?: string; userCancelled?: boolean }> {
  // Get the user's EVM address for the withdraw(address,address,uint256) call.
  const accountNum = parseInt(accountId.split(".")[2], 10);
  const evmAddress = "0x" + accountNum.toString(16).padStart(40, "0");

  console.log(`[WHBAR] Direct withdraw(${evmAddress}, ${evmAddress}, ${rawAmount}) on ${whbarContractId}`);

  const params = new ContractFunctionParameters();
  params.addAddress(evmAddress);   // src: withdraw from user
  params.addAddress(evmAddress);   // dst: send HBAR to user
  params.addUint256(rawAmount);    // wad: amount in smallest units

  const tx = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(whbarContractId))
    .setGas(1_200_000)
    .setFunction("withdraw", params);

  const result = await executeFull(accountId, tx);
  console.log("[WHBAR] Direct withdraw result:", JSON.stringify(result));
  return {
    success: result.success,
    transactionId: result.transactionId || undefined,
    error: result.error || undefined,
    userCancelled: result.userCancelled,
  };
}

// ── Shared Helpers ────────────────────────────────────────────────────

function _isCancellation(msg: string): boolean {
  const lc = msg.toLowerCase();
  return (
    lc.includes("user_reject") ||
    lc.includes("cancelled by user") ||
    lc.includes("canceled by user") ||
    lc.includes("rejected in hashpack") ||
    lc.includes("user denied") ||
    lc.includes("user rejected") ||
    lc.includes("user cancelled") ||
    lc.includes("user canceled")
  );
}

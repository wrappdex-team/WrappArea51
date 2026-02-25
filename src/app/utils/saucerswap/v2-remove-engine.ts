/**
 * [LP-08-ENGINE] V2 Liquidity Removal & Fee Collection Engine
 *
 * Handles two on-chain flows for SaucerSwap V2 concentrated liquidity:
 *
 * A) REMOVE LIQUIDITY (partial or full):
 *    multicall([decreaseLiquidity, collect, burn?])
 *    - decreaseLiquidity: removes specified liquidity from position
 *    - collect: claims freed tokens + accrued fees (MAX_UINT128 for all)
 *    - burn: destroys the NFT (only at 100% + user opt-in + NFT approved)
 *
 * B) COLLECT FEES ONLY:
 *    multicall([collect])
 *    - collect: claims accrued fees (MAX_UINT128 for all available)
 *
 * ============================================================================
 * FUND SAFETY AUDIT NOTES:
 *
 * (1) Slippage protection on decreaseLiquidity:
 *     amount0Min/amount1Min prevent front-running. Transaction reverts
 *     if pool price moves beyond tolerance -- no token loss.
 *
 * (2) collect uses MAX_UINT128 for both amounts:
 *     This collects ALL available (freed liquidity + accrued fees).
 *     The contract caps at the actual balance -- cannot over-withdraw.
 *
 * (3) [LP-REM-FIX] Hedera HTS association:
 *     On Hedera, collect(recipient=address(0)) + unwrapWHBAR fails because
 *     the NFT Manager is not HTS-associated with underlying tokens.
 *     Fix: Always collect directly to user's EVM address.
 *     For HBAR pools, user receives WHBAR (can unwrap via UI).
 *
 * (4) 20-minute deadline on decreaseLiquidity.
 *
 * (5) NFT burn approval:
 *     Only granted when user explicitly opts in (100% removal + toggle).
 *     Uses approveTokenNftAllowance -- specific serial, not blanket.
 *
 * (6) Recipient = user's actual EVM address (resolveAccountEvmAddress).
 *     Tokens go directly to the user -- never held by intermediaries.
 *
 * (7) [LP-REM-FIX-2] On-chain liquidity verification:
 *     Before building the multicall, reads positions(tokenId) via eth_call
 *     to verify the ACTUAL on-chain liquidity. If the client's cached
 *     value exceeds on-chain reality (e.g., after a prior partial removal),
 *     the engine caps liquidityToRemove and scales slippage amounts
 *     proportionally. Prevents CONTRACT_REVERT_EXECUTED from stale data.
 *
 * (8) [LP-REM-FIX-3] NFT Existence Check via ownerOf:
 *     On Hedera, when an LP NFT is burned (after full removal), the HTS serial
 *     is destroyed. Calling ownerOf(tokenId) on the LP NFT token returns
 *     INVALID_TOKEN_NFT_SERIAL_NUMBER (error 225). The NonfungiblePositionManager's
 *     positions(tokenId) may also revert on Hedera because it internally checks
 *     ownerOf.
 *
 *     This function explicitly checks if an LP NFT serial still exists before
 *     attempting any on-chain operations. Prevents wasting gas and user popups
 *     on burned/ghost positions.
 * ============================================================================
 */

import {
  ContractExecuteTransaction,
  ContractId,
  AccountAllowanceApproveTransaction,
  NftId,
  TokenId,
} from "../hedera-sdk";
import type { HederaNetwork } from "./tokens";
import {
  SAUCERSWAP_V2_LP_NFT,
  getV2NftManager,
  JSON_RPC_RELAY,
} from "./contracts";
import {
  encodeDecreaseLiquidity,
  encodeCollect,
  encodeBurn,
  encodeMulticall,
  MAX_UINT128,
  encodeUint256,
  concatBytes,
  bytesToHex,
  type LPDecreaseLiquidityParams,
  type LPCollectParams,
} from "./abi";
import { resolveAccountEvmAddress, resolveContractEvmAddress } from "./pools";
import { V2_GAS_LIMITS } from "./v2-liquidity-constants";

// ==========================================================================
// SECTION 1: Types
// ==========================================================================

export interface RemoveLiquidityParams {
  accountId: string;
  network: HederaNetwork;
  /** NFT serial number of the LP position */
  tokenSN: number;
  /** Liquidity amount to remove (from computeBurnAmounts) */
  liquidityToRemove: bigint;
  /** Slippage-adjusted minimum token0 amount */
  amount0Min: bigint;
  /** Slippage-adjusted minimum token1 amount */
  amount1Min: bigint;
  /** Whether the pool involves HBAR (need unwrapWHBAR) */
  poolInvolvesHbar: boolean;
  /** Whether to burn the NFT after full removal */
  burnNFT: boolean;
  /** Token0 symbol for logging */
  token0Symbol: string;
  /** Token1 symbol for logging */
  token1Symbol: string;
  /** Progress callback */
  onStep?: (step: number, total: number, desc: string) => void;
}

export interface CollectFeesParams {
  accountId: string;
  network: HederaNetwork;
  tokenSN: number;
  poolInvolvesHbar: boolean;
  token0Symbol: string;
  token1Symbol: string;
  onStep?: (step: number, total: number, desc: string) => void;
}

export interface RemoveResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  userCancelled?: boolean;
  popupCount?: number;
}

// ==========================================================================
// SECTION 2: On-Chain Position Verification
// ==========================================================================
//
// [LP-REM-FIX-2] Read the ACTUAL on-chain liquidity from the NFT Manager's
// positions(uint256 tokenId) function via JSON-RPC eth_call.
//
// This prevents the critical bug where stale cached data causes the engine
// to send a liquidityToRemove value larger than what's actually on-chain,
// which causes CONTRACT_REVERT_EXECUTED.
//
// positions(uint256) returns a tuple of 12 values:
//   (uint96 nonce, address operator, address token0, address token1,
//    uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity,
//    uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
//    uint128 tokensOwed0, uint128 tokensOwed1)
//
// We extract the 8th value (index 7): liquidity (uint128).

/** positions(uint256) selector = keccak256("positions(uint256)")[:4] */
const POSITIONS_SELECTOR = new Uint8Array([0x99, 0xfb, 0xab, 0x88]);

/** ownerOf(uint256) selector = keccak256("ownerOf(uint256)")[:4] */
const OWNEROF_SELECTOR = new Uint8Array([0x63, 0x52, 0x21, 0x1e]);

export interface OnChainPositionData {
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

/**
 * Read position data directly from the NonfungiblePositionManager via eth_call.
 * This is the SOURCE OF TRUTH -- bypasses all caches and API indexing delays.
 */
async function readOnChainPosition(
  tokenSN: number,
  nftManagerId: string,
  network: HederaNetwork,
): Promise<OnChainPositionData | null> {
  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;

  let managerEvm: string;
  try {
    managerEvm = await resolveContractEvmAddress(nftManagerId, network);
  } catch {
    console.error("[LP-REM] Failed to resolve NFT Manager EVM address");
    return null;
  }

  // Encode: positions(uint256 tokenId)
  const callData = concatBytes(POSITIONS_SELECTOR, encodeUint256(BigInt(tokenSN)));
  const callDataHex = bytesToHex(callData);
  const gasHex = "0x" + (300_000).toString(16);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: managerEvm, data: callDataHex, gas: gasHex }, "latest"],
        id: 1,
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[LP-REM] positions() RPC HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data.result || data.result === "0x" || data.result.length < 10) {
      console.warn("[LP-REM] positions() returned empty -- token may not exist in NFT Manager");
      return null;
    }

    // Decode the 12-word tuple (each word = 64 hex chars = 32 bytes)
    const hex = data.result.replace("0x", "");
    // Minimum: 12 words * 64 chars = 768 hex chars
    if (hex.length < 768) {
      console.warn(`[LP-REM] positions() result too short: ${hex.length} hex chars (need 768)`);
      return null;
    }

    // Extract fields (word indices):
    // [5] tickLower (int24, stored as int256 -- sign-extend)
    // [6] tickUpper (int24, stored as int256)
    // [7] liquidity (uint128)
    // [10] tokensOwed0 (uint128)
    // [11] tokensOwed1 (uint128)
    const word = (idx: number) => hex.slice(idx * 64, (idx + 1) * 64);

    const tickLowerRaw = BigInt("0x" + word(5));
    const tickUpperRaw = BigInt("0x" + word(6));
    const liquidity = BigInt("0x" + word(7));
    const tokensOwed0 = BigInt("0x" + word(10));
    const tokensOwed1 = BigInt("0x" + word(11));

    // int24 sign extension: if bit 23 is set, the value is negative
    const toInt24 = (v: bigint): number => {
      const MAX_INT256 = (1n << 255n);
      const n = v >= MAX_INT256 ? v - (1n << 256n) : v;
      return Number(n);
    };

    const result: OnChainPositionData = {
      liquidity,
      tickLower: toInt24(tickLowerRaw),
      tickUpper: toInt24(tickUpperRaw),
      tokensOwed0,
      tokensOwed1,
    };

    console.log("[LP-REM] On-chain position data via eth_call:");
    console.log(`[LP-REM]   liquidity:   ${liquidity}`);
    console.log(`[LP-REM]   tickLower:   ${result.tickLower}`);
    console.log(`[LP-REM]   tickUpper:   ${result.tickUpper}`);
    console.log(`[LP-REM]   tokensOwed0: ${tokensOwed0}`);
    console.log(`[LP-REM]   tokensOwed1: ${tokensOwed1}`);

    return result;
  } catch (err: any) {
    console.warn(`[LP-REM] positions() eth_call failed: ${err?.message || err}`);
    return null;
  }
}

// ==========================================================================
// [LP-REM-FIX-3] NFT Existence Check via ownerOf
// ==========================================================================
//
// On Hedera, when an LP NFT is burned (after full removal), the HTS serial
// is destroyed. Calling ownerOf(tokenId) on the LP NFT token returns
// INVALID_TOKEN_NFT_SERIAL_NUMBER (error 225). The NonfungiblePositionManager's
// positions(tokenId) may also revert on Hedera because it internally checks
// ownerOf.
//
// This function explicitly checks if an LP NFT serial still exists before
// attempting any on-chain operations. Prevents wasting gas and user popups
// on burned/ghost positions.

/**
 * Check if an LP NFT serial number still exists on-chain via ownerOf.
 * Returns true if the NFT exists, false if burned/invalid.
 *
 * IMPORTANT: On Hedera, ownerOf must be called on the LP NFT HTS token
 * contract (0.0.4054027), NOT the NonfungiblePositionManager (0.0.4053945).
 * The Manager delegates to HTS internally, but calling ownerOf directly
 * on the Manager's EVM address will revert for ALL tokens (false positive).
 */
async function checkNftExists(
  tokenSN: number,
  lpNftTokenId: string,
  network: HederaNetwork,
): Promise<boolean> {
  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;

  // Compute the EVM address of the LP NFT HTS token directly from its ID.
  // On Hedera, HTS token EVM addresses are deterministic: 0x + padded account number.
  // e.g. 0.0.4054027 → 0x00000000000000000000000000000000003ddc0b
  let nftTokenEvm: string;
  try {
    const accountNum = parseInt(lpNftTokenId.split(".")[2], 10);
    if (isNaN(accountNum) || accountNum <= 0) throw new Error(`Invalid token ID: ${lpNftTokenId}`);
    nftTokenEvm = "0x" + accountNum.toString(16).padStart(40, "0");
    console.log(`[LP-REM-FIX-3] ownerOf target: LP NFT token ${lpNftTokenId} → ${nftTokenEvm}`);
  } catch (err) {
    console.warn(`[LP-REM-FIX-3] Failed to compute LP NFT EVM address from ${lpNftTokenId}`);
    return true; // Assume exists on resolution failure — let the main flow handle it
  }

  const callData = concatBytes(OWNEROF_SELECTOR, encodeUint256(BigInt(tokenSN)));
  const callDataHex = bytesToHex(callData);
  const gasHex = "0x" + (200_000).toString(16);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: nftTokenEvm, data: callDataHex, gas: gasHex }, "latest"],
        id: 1,
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[LP-REM-FIX-3] ownerOf() RPC HTTP ${res.status}`);
      return true; // Assume exists on HTTP failure
    }

    const data = await res.json();

    // If there's an error field, the call reverted — NFT doesn't exist
    if (data.error) {
      console.log(`[LP-REM-FIX-3] ownerOf(${tokenSN}) on ${lpNftTokenId} REVERTED: ${JSON.stringify(data.error).slice(0, 200)}`);
      console.log("[LP-REM-FIX-3] NFT serial does not exist — was likely burned");
      return false;
    }

    // Empty result or revert-like response
    if (!data.result || data.result === "0x" || data.result.length < 42) {
      console.log(`[LP-REM-FIX-3] ownerOf(${tokenSN}) returned empty/short result — NFT likely burned`);
      return false;
    }

    // Valid result — extract owner address
    const hex = data.result.replace("0x", "");
    const ownerHex = hex.slice(24, 64); // Last 20 bytes of the 32-byte word
    const isZeroAddress = ownerHex === "0".repeat(40);

    if (isZeroAddress) {
      console.log(`[LP-REM-FIX-3] ownerOf(${tokenSN}) returned zero address — NFT burned`);
      return false;
    }

    console.log(`[LP-REM-FIX-3] ownerOf(${tokenSN}) = 0x${ownerHex} — NFT EXISTS ✓`);
    return true;
  } catch (err: any) {
    console.warn(`[LP-REM-FIX-3] ownerOf() eth_call failed: ${err?.message || err}`);
    return true; // Assume exists on network failure — main flow will catch the real error
  }
}

// ==========================================================================
// SECTION 3: Remove Liquidity (partial or full)
// ==========================================================================

/**
 * Remove liquidity from a V2 position -- the complete on-chain flow.
 *
 * Pipeline:
 *   1. Resolve recipient EVM address
 *   1.5. [LP-REM-FIX-2] Verify on-chain liquidity via eth_call
 *   2. If burnNFT: approve NFT to NFT Manager (1 wallet popup)
 *   3. Build multicall([decreaseLiquidity, collect, burn?])
 *   4. Execute ContractExecuteTransaction
 *   5. Return transactionId
 */
export async function removeLiquidity(params: RemoveLiquidityParams): Promise<RemoveResult> {
  const {
    accountId, network, tokenSN,
    poolInvolvesHbar, burnNFT,
    token0Symbol, token1Symbol, onStep,
  } = params;

  // Mutable copies -- may be adjusted by on-chain verification
  let liquidityToRemove = params.liquidityToRemove;
  let amount0Min = params.amount0Min;
  let amount1Min = params.amount1Min;

  let popupCount = 0;
  const totalSteps = (burnNFT ? 1 : 0) + 1; // NFT approval + main TX
  let currentStep = 0;

  const emitStep = (desc: string) => {
    currentStep++;
    onStep?.(currentStep, totalSteps, desc);
    console.log(`[LP-REM] Step ${currentStep}/${totalSteps}: ${desc}`);
  };

  try {
    // -- 1. Resolve addresses --
    const nftManagerId = getV2NftManager(network);
    const recipientEvm = await resolveAccountEvmAddress(accountId, network);
    const lpNftTokenId = SAUCERSWAP_V2_LP_NFT[network] || SAUCERSWAP_V2_LP_NFT.mainnet;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min

    console.log("[LP-REM] ===================================================");
    console.log("[LP-REM] V2 REMOVE LIQUIDITY -- LIVE EXECUTION");
    console.log(`[LP-REM]   Account:     ${accountId}`);
    console.log(`[LP-REM]   NFT #:       ${tokenSN}`);
    console.log(`[LP-REM]   Pair:        ${token0Symbol}/${token1Symbol}`);
    console.log(`[LP-REM]   Liquidity:   ${liquidityToRemove.toString()}`);
    console.log(`[LP-REM]   Amount0Min:  ${amount0Min.toString()}`);
    console.log(`[LP-REM]   Amount1Min:  ${amount1Min.toString()}`);
    console.log(`[LP-REM]   HBAR Pool:   ${poolInvolvesHbar}`);
    console.log(`[LP-REM]   Burn NFT:    ${burnNFT}`);
    console.log(`[LP-REM]   Recipient:   ${recipientEvm}`);
    console.log(`[LP-REM]   NFT Manager: ${nftManagerId}`);
    console.log(`[LP-REM]   Steps:       ${totalSteps}`);
    console.log("[LP-REM] ===================================================");

    // -- 1.5 [LP-REM-FIX-2] Verify on-chain liquidity --
    // Prevents CONTRACT_REVERT_EXECUTED from stale cached position data.
    // If the API/cache shows more liquidity than on-chain (e.g., after a
    // prior partial removal), cap liquidityToRemove and scale slippage.
    const onChain = await readOnChainPosition(tokenSN, nftManagerId, network);
    if (onChain !== null) {
      if (onChain.liquidity === 0n) {
        console.error("[LP-REM] On-chain liquidity = 0 -- position is already empty!");
        return {
          success: false,
          error: "This position has no remaining liquidity. It may have already been fully withdrawn. Please refresh your positions.",
          popupCount: 0,
        };
      }

      if (liquidityToRemove > onChain.liquidity) {
        console.warn(`[LP-REM] STALE DATA DETECTED: client=${liquidityToRemove}, on-chain=${onChain.liquidity}`);
        console.warn("[LP-REM] Capping liquidityToRemove to on-chain value and scaling slippage...");

        // Scale factor: on-chain / requested (as a ratio with 18 decimal precision)
        const SCALE = 10n ** 18n;
        const ratio = (onChain.liquidity * SCALE) / liquidityToRemove;

        // Cap liquidity and scale min amounts proportionally
        liquidityToRemove = onChain.liquidity;
        amount0Min = (amount0Min * ratio) / SCALE;
        amount1Min = (amount1Min * ratio) / SCALE;

        console.log(`[LP-REM] Adjusted: liquidity=${liquidityToRemove}, amount0Min=${amount0Min}, amount1Min=${amount1Min}`);
      } else {
        console.log(`[LP-REM] On-chain liquidity OK: ${onChain.liquidity} >= requested ${liquidityToRemove}`);
      }
    } else {
      // [LP-REM-FIX-3] positions() returned null — likely means the NFT was burned
      // (on Hedera, positions() reverts when ownerOf fails for burned serials).
      // Do NOT proceed blindly — verify NFT existence first.
      console.warn("[LP-REM] positions() returned null — checking NFT existence via ownerOf...");
      const nftExists = await checkNftExists(tokenSN, lpNftTokenId, network);
      if (!nftExists) {
        console.error(`[LP-REM-FIX-3] NFT #${tokenSN} does NOT exist on-chain — it was burned or transferred`);
        return {
          success: false,
          error: `Position NFT #${tokenSN} no longer exists on-chain. It was likely burned after a previous full removal. Please refresh your positions to remove this ghost entry.`,
          popupCount: 0,
        };
      }
      // NFT exists but positions() failed for another reason (RPC timeout, etc.)
      // Proceed with caution using client data
      console.warn("[LP-REM] NFT exists but positions() failed — proceeding with client data (RPC issue)");
    }

    // -- 2. If burning NFT: approve NFT Manager to operate the specific NFT
    if (burnNFT) {
      emitStep("Approving NFT for burn...");
      popupCount++;

      try {
        const { executeHederaTransactionFast } = await import("../hashpack");

        const approveTx = new AccountAllowanceApproveTransaction()
          .approveTokenNftAllowance(
            new NftId(TokenId.fromString(lpNftTokenId), tokenSN),
            accountId,
            nftManagerId,
          );

        const approveResult = await executeHederaTransactionFast(accountId, approveTx);
        console.log("[LP-REM] NFT approve result:", JSON.stringify(approveResult));

        if (!approveResult.success) {
          return {
            success: false,
            error: `NFT approval failed: ${approveResult.error || "unknown"}`,
            userCancelled: approveResult.userCancelled,
            popupCount,
          };
        }
      } catch (err: any) {
        const msg = (err?.message || "").toLowerCase();
        const cancelled = msg.includes("user_reject") || msg.includes("cancelled") ||
                          msg.includes("canceled") || msg.includes("user denied") ||
                          msg.includes("user rejected");
        return {
          success: false,
          error: `NFT approval error: ${err?.message || "unknown"}`,
          userCancelled: cancelled || undefined,
          popupCount,
        };
      }
    }

    // -- 3. Build multicall calldata --
    emitStep("Removing liquidity...");

    const tokenSNBig = BigInt(tokenSN);

    // (a) decreaseLiquidity
    const decreaseParams: LPDecreaseLiquidityParams = {
      tokenSN: tokenSNBig,
      liquidity: liquidityToRemove,
      amount0Min,
      amount1Min,
      deadline,
    };
    const decreaseCalldata = encodeDecreaseLiquidity(decreaseParams);

    // (b) collect -- always MAX_UINT128 to get everything (freed tokens + fees)
    //
    // [LP-REM-FIX] HEDERA-SPECIFIC: Always collect directly to user's address.
    // On Hedera, collect(recipient=address(0)) + unwrapWHBAR fails because
    // the NFT Manager is not HTS-associated with underlying tokens.
    //
    const collectParams: LPCollectParams = {
      tokenSN: tokenSNBig,
      recipient: recipientEvm, // Always send directly to user
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    };
    const collectCalldata = encodeCollect(collectParams);

    // Build multicall array: [decreaseLiquidity, collect, burn?]
    const multicallParts: Uint8Array[] = [decreaseCalldata, collectCalldata];

    if (poolInvolvesHbar) {
      console.log("[LP-REM] HBAR pool detected -- user will receive WHBAR (can unwrap via UI)");
    }

    // (c) burn -- only if user opted in (100% removal)
    if (burnNFT) {
      const burnCalldata = encodeBurn(tokenSNBig);
      multicallParts.push(burnCalldata);
      console.log("[LP-REM] Including burn -- NFT will be destroyed");
    }

    const multicallData = encodeMulticall(multicallParts);

    const mcNames = ["decreaseLiquidity", "collect",
      ...(burnNFT ? ["burn"] : [])];
    console.log(`[LP-REM] Multicall: [${mcNames.join(", ")}]`);
    console.log(`[LP-REM] Calldata size: ${multicallData.length}B`);

    // -- 4. Determine gas limit --
    let gasLimit: number;
    if (burnNFT) {
      gasLimit = V2_GAS_LIMITS.FULL_REMOVAL_WITH_BURN;
    } else {
      gasLimit = V2_GAS_LIMITS.DECREASE_AND_COLLECT;
    }

    // -- 5. Execute ContractExecuteTransaction --
    const { executeHederaTransaction } = await import("../hashpack");
    popupCount++;

    const removeTx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(nftManagerId))
      .setGas(gasLimit)
      .setFunctionParameters(multicallData);

    console.log("[LP-REM] ==================================================");
    console.log("[LP-REM] EXECUTING REMOVE TRANSACTION");
    console.log(`[LP-REM]   Contract:   ${nftManagerId}`);
    console.log(`[LP-REM]   Gas:        ${gasLimit}`);
    console.log(`[LP-REM]   Multicall:  [${mcNames.join(", ")}]`);
    console.log("[LP-REM] ==================================================");

    const txResult = await executeHederaTransaction(accountId, removeTx);
    console.log("[LP-REM] Remove TX result:", JSON.stringify(txResult));

    if (!txResult.success) {
      return {
        success: false,
        transactionId: txResult.transactionId || undefined,
        error: txResult.error || "Remove transaction failed",
        userCancelled: txResult.userCancelled,
        popupCount,
      };
    }

    console.log("[LP-REM] ==================================================");
    console.log("[LP-REM] REMOVE SUCCESSFUL");
    console.log(`[LP-REM]   Transaction: ${txResult.transactionId}`);
    console.log(`[LP-REM]   HashScan:    https://hashscan.io/${network}/transaction/${txResult.transactionId}`);
    console.log("[LP-REM] ==================================================");

    return {
      success: true,
      transactionId: txResult.transactionId || undefined,
      popupCount,
    };

  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error("[LP-REM] Remove execution error:", errMsg);
    const lower = errMsg.toLowerCase();
    const userCancelled = lower.includes("user_reject") || lower.includes("cancelled") ||
                          lower.includes("canceled") || lower.includes("user denied") ||
                          lower.includes("user rejected");
    return {
      success: false,
      error: errMsg,
      userCancelled: userCancelled || undefined,
      popupCount,
    };
  }
}

// ==========================================================================
// SECTION 4: Collect Fees Only
// ==========================================================================

/**
 * Collect accrued fees from a V2 position without removing liquidity.
 *
 * Pipeline:
 *   1. Resolve recipient EVM address
 *   2. Build multicall([collect])
 *   3. Execute ContractExecuteTransaction
 *   4. Return transactionId
 */
export async function collectFees(params: CollectFeesParams): Promise<RemoveResult> {
  const {
    accountId, network, tokenSN,
    poolInvolvesHbar,
    token0Symbol, token1Symbol, onStep,
  } = params;

  let popupCount = 0;

  const emitStep = (desc: string) => {
    onStep?.(1, 1, desc);
    console.log(`[LP-COL] Step 1/1: ${desc}`);
  };

  try {
    const nftManagerId = getV2NftManager(network);
    const recipientEvm = await resolveAccountEvmAddress(accountId, network);
    const lpNftTokenId = SAUCERSWAP_V2_LP_NFT[network] || SAUCERSWAP_V2_LP_NFT.mainnet;

    console.log("[LP-COL] ===================================================");
    console.log("[LP-COL] V2 COLLECT FEES -- LIVE EXECUTION");
    console.log(`[LP-COL]   Account:     ${accountId}`);
    console.log(`[LP-COL]   NFT #:       ${tokenSN}`);
    console.log(`[LP-COL]   Pair:        ${token0Symbol}/${token1Symbol}`);
    console.log(`[LP-COL]   HBAR Pool:   ${poolInvolvesHbar}`);
    console.log(`[LP-COL]   Recipient:   ${recipientEvm}`);
    console.log("[LP-COL] ===================================================");

    // [LP-REM-FIX-3] Verify NFT exists before attempting collect
    const nftExists = await checkNftExists(tokenSN, lpNftTokenId, network);
    if (!nftExists) {
      console.error(`[LP-COL-FIX-3] NFT #${tokenSN} does NOT exist — burned or transferred`);
      return {
        success: false,
        error: `Position NFT #${tokenSN} no longer exists on-chain. It was likely burned after a previous full removal. Please refresh your positions.`,
        popupCount: 0,
      };
    }

    emitStep("Collecting fees...");

    const tokenSNBig = BigInt(tokenSN);

    // [LP-REM-FIX] HEDERA-SPECIFIC: Always collect directly to user's address.
    const collectCalldata = encodeCollect({
      tokenSN: tokenSNBig,
      recipient: recipientEvm, // Always send directly to user
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    });

    // Simple multicall with just [collect]
    const multicallParts: Uint8Array[] = [collectCalldata];

    if (poolInvolvesHbar) {
      console.log("[LP-COL] HBAR pool -- user will receive WHBAR (can unwrap via UI)");
    }

    const multicallData = encodeMulticall(multicallParts);

    const { executeHederaTransaction } = await import("../hashpack");
    popupCount++;

    const collectTx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(nftManagerId))
      .setGas(V2_GAS_LIMITS.COLLECT)
      .setFunctionParameters(multicallData);

    console.log("[LP-COL] EXECUTING COLLECT TRANSACTION");
    console.log(`[LP-COL]   Gas: ${V2_GAS_LIMITS.COLLECT}`);

    const txResult = await executeHederaTransaction(accountId, collectTx);
    console.log("[LP-COL] Collect TX result:", JSON.stringify(txResult));

    if (!txResult.success) {
      return {
        success: false,
        transactionId: txResult.transactionId || undefined,
        error: txResult.error || "Collect transaction failed",
        userCancelled: txResult.userCancelled,
        popupCount,
      };
    }

    console.log("[LP-COL] ==================================================");
    console.log("[LP-COL] COLLECT SUCCESSFUL");
    console.log(`[LP-COL]   Transaction: ${txResult.transactionId}`);
    console.log("[LP-COL] ==================================================");

    return {
      success: true,
      transactionId: txResult.transactionId || undefined,
      popupCount,
    };

  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error("[LP-COL] Collect execution error:", errMsg);
    const lower = errMsg.toLowerCase();
    const userCancelled = lower.includes("user_reject") || lower.includes("cancelled") ||
                          lower.includes("canceled") || lower.includes("user denied") ||
                          lower.includes("user rejected");
    return {
      success: false,
      error: errMsg,
      userCancelled: userCancelled || undefined,
      popupCount,
    };
  }
}
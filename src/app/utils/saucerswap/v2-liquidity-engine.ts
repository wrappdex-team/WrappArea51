/**
 * [LP-05] V2 Liquidity Engine — Live Mint Execution
 *
 * Handles the complete on-chain flow for minting a new SaucerSwap V2
 * concentrated liquidity position:
 *
 *   1. Read token0/token1 DIRECTLY from the pool contract (CREATE2-safe)
 *   2. Approve non-HBAR tokens to NonfungiblePositionManager
 *   3. Build multicall([mint, refundETH]) calldata
 *   4. Calculate payableAmount = mintFee + HBAR deposit (if pool involves HBAR)
 *   5. Execute ContractExecuteTransaction via HashPack/WalletConnect
 *   6. Return transactionId for HashScan tracking
 *
 * ════════════════════════════════════════════════════════════════════════
 * [LP-05-FIX] CREATE2 ADDRESS MISMATCH — ROOT CAUSE & FIX
 *
 * The NFT Manager's mint() internally computes the pool address via
 * CREATE2: keccak256(0xff, factory, keccak256(token0, token1, fee), INIT_CODE_HASH).
 *
 * On Hedera, EVM contracts have ACTUAL EVM addresses (e.g. 0xf89d...)
 * that differ from the "long-zero" synthetic addresses derived from
 * entity numbers (e.g. 0x000...0022D6de). Our previous approach used
 * htsIdToEvmAddress() which returns long-zero — but the V2 pools were
 * created with ACTUAL EVM addresses. This produced a different CREATE2
 * hash → wrong pool address → slot0() call to empty address → revert.
 *
 * FIX: Read pool.token0() and pool.token1() via JSON-RPC eth_call on
 * the pool contract itself. These return the EXACT addresses used in
 * CREATE2, guaranteeing the NFT Manager resolves the correct pool.
 *
 * ════════════════════════════════════════════════════════════════════════
 * FUND SAFETY AUDIT NOTES:
 *
 * (1) Slippage protection: amount0Min/amount1Min with bps tolerance
 * (2) 20-minute deadline
 * (3) refundETH() in every multicall — returns unused HBAR
 * (4) Exact approvals — no MAX_UINT256
 * (5) WHBAR auto-wrap — native HBAR sent as payable
 * (6) Mint fee with 1% buffer — refundETH handles overpayment
 * (7) Pre-flight pool verification — confirms pool exists before TX
 *
 * References:
 *   NonfungiblePositionManager: 0.0.4053945 (mainnet)
 *   LP NFT Token: 0.0.4054027 (mainnet)
 * ════════════════════════════════════════════════════════════════════════
 */

import {
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  AccountAllowanceApproveTransaction,
} from "../hedera-sdk";
import type { HederaNetwork } from "./tokens";
import {
  htsIdToEvmAddress,
  resolveTokenByHtsId,
} from "./tokens";
import {
  SAUCERSWAP_WHBAR_CONTRACT,
  JSON_RPC_RELAY,
  getV2NftManager,
} from "./contracts";
import {
  encodeMint,
  encodeRefundETH,
  encodeMulticall,
  type LPMintParams,
} from "./abi";
import { resolveAccountEvmAddress, resolveContractEvmAddress } from "./pools";
import { fetchTokenAllowance } from "./balances";
import { V2_GAS_LIMITS } from "./v2-liquidity-constants";
import { makeAbort } from "./prices";
import type { MintFeeInfo } from "./positions";

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Types
// ═══════════════════════════════════════════════════════════════════════

export interface MintPositionParams {
  /** User's Hedera account ID (0.0.xxxxx) */
  accountId: string;
  /** Hedera network */
  network: HederaNetwork;
  /** Pool contract ID (0.0.xxxxx) — used to read on-chain token addresses */
  poolContractId: string;
  /** Token A HTS ID from the pool (for approval transactions) */
  token0HtsId: string;
  /** Token B HTS ID from the pool (for approval transactions) */
  token1HtsId: string;
  /** Whether token0 is HBAR/WHBAR */
  isToken0Hbar: boolean;
  /** Whether token1 is HBAR/WHBAR */
  isToken1Hbar: boolean;
  /** Fee tier raw value (500, 1500, 3000, 10000) */
  feeTier: number;
  /** Lower tick (must be aligned to tick spacing) */
  tickLower: number;
  /** Upper tick (must be aligned to tick spacing) */
  tickUpper: number;
  /** Desired token0 amount in smallest unit (tinybar for HBAR, smallest for HTS) */
  amount0Desired: bigint;
  /** Desired token1 amount in smallest unit */
  amount1Desired: bigint;
  /** Slippage tolerance in basis points (100 = 1%) */
  slippageBps: number;
  /** Mint fee info (from fetchMintFeeInfo) — null if unavailable (0 fee fallback) */
  mintFee: MintFeeInfo | null;
  /** Progress callback for UI step indicator */
  onStep?: (step: number, total: number, description: string) => void;
}

export interface MintPositionResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  userCancelled?: boolean;
  /** Number of wallet popups the user saw */
  popupCount?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Pool On-Chain Token Address Resolution
// ═══════════════════════════════════════════════════════════════════════

/**
 * [LP-05-FIX] Read token0(), token1(), and fee() directly from the
 * pool contract via JSON-RPC eth_call.
 *
 * These return the EXACT EVM addresses used in the CREATE2 computation,
 * which is what the NFT Manager needs to find the pool internally.
 *
 * Function selectors (standard Uniswap V3 Pool):
 *   token0(): 0x0dfe1681
 *   token1(): 0xd21220a7
 *   fee():    0xddca3f43
 */
async function fetchPoolTokenAddresses(
  poolContractId: string,
  network: HederaNetwork,
): Promise<{ token0Evm: string; token1Evm: string; fee: number } | null> {
  const rpcUrl = JSON_RPC_RELAY[network] || JSON_RPC_RELAY.mainnet;
  const poolEvm = await resolveContractEvmAddress(poolContractId, network);
  const gasHex = "0x" + (300_000).toString(16);

  console.log(`[LP-05-FIX] Fetching on-chain token addresses from pool ${poolContractId} (${poolEvm})`);

  try {
    const [t0Res, t1Res, feeRes] = await Promise.all([
      fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(10_000),
        body: JSON.stringify({
          jsonrpc: "2.0", method: "eth_call",
          params: [{ to: poolEvm, data: "0x0dfe1681", gas: gasHex }, "latest"],
          id: 1,
        }),
      }),
      fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(10_000),
        body: JSON.stringify({
          jsonrpc: "2.0", method: "eth_call",
          params: [{ to: poolEvm, data: "0xd21220a7", gas: gasHex }, "latest"],
          id: 2,
        }),
      }),
      fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: makeAbort(10_000),
        body: JSON.stringify({
          jsonrpc: "2.0", method: "eth_call",
          params: [{ to: poolEvm, data: "0xddca3f43", gas: gasHex }, "latest"],
          id: 3,
        }),
      }),
    ]);

    if (!t0Res.ok || !t1Res.ok || !feeRes.ok) {
      console.error("[LP-05-FIX] One or more RPC calls failed:", {
        token0: t0Res.status, token1: t1Res.status, fee: feeRes.status,
      });
      return null;
    }

    const [t0Data, t1Data, feeData] = await Promise.all([
      t0Res.json(), t1Res.json(), feeRes.json(),
    ]);

    // Parse address results (32 bytes = 64 hex chars, last 40 are the address)
    if (!t0Data.result || t0Data.result.length < 42 ||
        !t1Data.result || t1Data.result.length < 42 ||
        !feeData.result || feeData.result.length < 10) {
      console.error("[LP-05-FIX] Invalid RPC results:", {
        token0: t0Data.result?.slice(0, 20),
        token1: t1Data.result?.slice(0, 20),
        fee: feeData.result?.slice(0, 20),
      });
      return null;
    }

    // Extract 20-byte addresses from 32-byte ABI-encoded responses
    const token0Evm = "0x" + t0Data.result.slice(-40);
    const token1Evm = "0x" + t1Data.result.slice(-40);
    const fee = parseInt(feeData.result, 16);

    console.log("[LP-05-FIX] On-chain pool token addresses:");
    console.log(`[LP-05-FIX]   token0: ${token0Evm}`);
    console.log(`[LP-05-FIX]   token1: ${token1Evm}`);
    console.log(`[LP-05-FIX]   fee:    ${fee}`);

    return { token0Evm, token1Evm, fee };
  } catch (err: any) {
    console.error("[LP-05-FIX] Failed to fetch pool token addresses:", err?.message || err);
    return null;
  }
}

/**
 * Check if an EVM address is a known WHBAR address (contract or token).
 * Used to detect HBAR involvement after reading addresses from pool.
 */
function isWhbarAddress(evmAddress: string, network: HederaNetwork): boolean {
  const addr = evmAddress.toLowerCase();
  // WHBAR contract: 0.0.1456985
  const contractId = SAUCERSWAP_WHBAR_CONTRACT[network] || SAUCERSWAP_WHBAR_CONTRACT.mainnet;
  const contractEvm = htsIdToEvmAddress(contractId).toLowerCase();
  // WHBAR token: 0.0.1456986
  const tokenEvm = htsIdToEvmAddress("0.0.1456986").toLowerCase();
  return addr === contractEvm || addr === tokenEvm;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Token Approval (mirrors swap-engine.ts approveIfNeeded)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check and approve a token to the NFT Manager if needed.
 *
 * Uses native HTS AccountAllowanceApproveTransaction (not ERC-20 approve)
 * for exact amounts. Returns true if approval succeeded or was already sufficient.
 */
async function approveTokenForMint(
  accountId: string,
  tokenHtsId: string,
  tokenSymbol: string,
  amount: bigint,
  nftManagerId: string,
  network: HederaNetwork,
  onStep?: (desc: string) => void,
): Promise<{ success: boolean; error?: string; userCancelled?: boolean }> {
  // Check existing allowance
  const rawAmount = Number(amount);
  const existing = await fetchTokenAllowance(accountId, tokenHtsId, nftManagerId, network);

  if (existing >= rawAmount) {
    console.log(`[LP-05] ${tokenSymbol} already approved: ${existing} >= ${rawAmount} → NFT Manager ${nftManagerId}`);
    onStep?.(`${tokenSymbol} approved ✓`);
    return { success: true };
  }

  console.log(`[LP-05] Approving ${tokenSymbol}: ${rawAmount} → NFT Manager ${nftManagerId} (existing: ${existing})`);
  onStep?.(`Approve ${tokenSymbol}...`);

  try {
    const { executeHederaTransactionFast } = await import("../hashpack");

    const approveTx = new AccountAllowanceApproveTransaction()
      .approveTokenAllowance(tokenHtsId, accountId, nftManagerId, rawAmount);

    const result = await executeHederaTransactionFast(accountId, approveTx);
    console.log(`[LP-05] ${tokenSymbol} approve result:`, JSON.stringify(result));

    if (!result.success) {
      return {
        success: false,
        error: `${tokenSymbol} approval failed: ${result.error || "unknown"}`,
        userCancelled: result.userCancelled,
      };
    }

    onStep?.(`${tokenSymbol} approved ✓`);
    return { success: true };
  } catch (err: any) {
    const msg = (err?.message || "").toLowerCase();
    const cancelled = msg.includes("user_reject") || msg.includes("cancelled") ||
                      msg.includes("canceled") || msg.includes("user denied") ||
                      msg.includes("user rejected");
    return {
      success: false,
      error: `${tokenSymbol} approval error: ${err?.message || "unknown"}`,
      userCancelled: cancelled || undefined,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: Mint Execution
// ═══════════════════════════════════════════════════════════════════════

/**
 * Execute a V2 liquidity position mint — the complete on-chain flow.
 *
 * Steps:
 *   1. Read token0/token1 from the pool contract (CREATE2-safe addresses)
 *   2. Resolve recipient EVM address
 *   3. Approve non-HBAR token(s) to NFT Manager (1-2 wallet popups)
 *   4. Build multicall([mint, refundETH]) calldata
 *   5. Execute ContractExecuteTransaction with payable amount
 *   6. Return transactionId for HashScan tracking
 *
 * @returns MintPositionResult with success/transactionId/error
 */
export async function mintPosition(params: MintPositionParams): Promise<MintPositionResult> {
  const {
    accountId, network, poolContractId, token0HtsId, token1HtsId,
    isToken0Hbar, isToken1Hbar, feeTier,
    tickLower, tickUpper,
    amount0Desired, amount1Desired,
    slippageBps, mintFee, onStep,
  } = params;

  let popupCount = 0;

  // ── Count total steps for UI ────────────────────────────────────
  const needApprove0 = !isToken0Hbar && amount0Desired > 0n;
  const needApprove1 = !isToken1Hbar && amount1Desired > 0n;
  const totalSteps = (needApprove0 ? 1 : 0) + (needApprove1 ? 1 : 0) + 1; // approvals + mint
  let currentStep = 0;

  const emitStep = (desc: string) => {
    currentStep++;
    onStep?.(currentStep, totalSteps, desc);
    console.log(`[LP-05] Step ${currentStep}/${totalSteps}: ${desc}`);
  };

  try {
    // ── 1. Read token addresses from pool contract ──────────────────
    // [LP-05-FIX] This is the critical fix. We read the EXACT EVM
    // addresses stored in the pool contract, which guarantees the
    // NFT Manager's CREATE2 resolves to the same pool.
    const poolTokens = await fetchPoolTokenAddresses(poolContractId, network);
    if (!poolTokens) {
      return {
        success: false,
        error: `Failed to read token addresses from pool contract ${poolContractId}. The pool may be unavailable. Please try again.`,
        popupCount: 0,
      };
    }

    const { token0Evm, token1Evm, fee: onChainFee } = poolTokens;

    // Validate on-chain fee matches expected fee tier
    if (onChainFee !== feeTier) {
      console.warn(`[LP-05-FIX] Fee tier mismatch! UI=${feeTier}, on-chain=${onChainFee}. Using on-chain value.`);
    }
    const effectiveFee = onChainFee || feeTier;

    // Detect HBAR involvement from on-chain addresses
    const onChainToken0IsWhbar = isWhbarAddress(token0Evm, network);
    const onChainToken1IsWhbar = isWhbarAddress(token1Evm, network);

    // Validate our HBAR detection matches on-chain reality
    if (isToken0Hbar !== onChainToken0IsWhbar || isToken1Hbar !== onChainToken1IsWhbar) {
      console.warn("[LP-05-FIX] HBAR detection mismatch:");
      console.warn(`[LP-05-FIX]   UI:       token0Hbar=${isToken0Hbar}, token1Hbar=${isToken1Hbar}`);
      console.warn(`[LP-05-FIX]   On-chain: token0Whbar=${onChainToken0IsWhbar}, token1Whbar=${onChainToken1IsWhbar}`);
      // Use on-chain detection as ground truth for payable calculation
    }

    // ── 2. Resolve other addresses ──────────────────────────────────
    const nftManagerId = getV2NftManager(network);
    const nftManagerEvm = await resolveContractEvmAddress(nftManagerId, network);
    const recipientEvm = await resolveAccountEvmAddress(accountId, network);

    // Compare old (long-zero) vs new (on-chain) addresses for diagnostics
    const oldToken0Evm = htsIdToEvmAddress(token0HtsId);
    const oldToken1Evm = htsIdToEvmAddress(token1HtsId);
    const addressesChanged = oldToken0Evm.toLowerCase() !== token0Evm.toLowerCase() ||
                             oldToken1Evm.toLowerCase() !== token1Evm.toLowerCase();

    console.log("[LP-05] ═══════════════════════════════════════════════");
    console.log("[LP-05] V2 MINT POSITION — LIVE EXECUTION");
    console.log(`[LP-05]   Account:       ${accountId}`);
    console.log(`[LP-05]   Pool:          ${poolContractId}`);
    console.log(`[LP-05]   NFT Manager:   ${nftManagerId} (${nftManagerEvm})`);
    console.log(`[LP-05]   Recipient:     ${recipientEvm}`);
    console.log(`[LP-05]   Token0 (pool): ${token0Evm} ${onChainToken0IsWhbar ? "(WHBAR)" : ""}`);
    console.log(`[LP-05]   Token1 (pool): ${token1Evm} ${onChainToken1IsWhbar ? "(WHBAR)" : ""}`);
    if (addressesChanged) {
      console.log(`[LP-05]   ⚠ Token0 (old): ${oldToken0Evm} → (on-chain): ${token0Evm}`);
      console.log(`[LP-05]   ⚠ Token1 (old): ${oldToken1Evm} → (on-chain): ${token1Evm}`);
      console.log(`[LP-05]   [LP-05-FIX] Using ON-CHAIN addresses — fixes CREATE2 mismatch`);
    }
    console.log(`[LP-05]   Fee Tier:      ${effectiveFee} (${effectiveFee / 10000}%) ${onChainFee !== feeTier ? `[corrected from ${feeTier}]` : ""}`);
    console.log(`[LP-05]   Tick Range:    [${tickLower}, ${tickUpper}]`);
    console.log(`[LP-05]   Amount0:       ${amount0Desired.toString()}`);
    console.log(`[LP-05]   Amount1:       ${amount1Desired.toString()}`);
    console.log(`[LP-05]   Slippage:      ${slippageBps}bps (${slippageBps / 100}%)`);
    console.log(`[LP-05]   Mint Fee:      ${mintFee?.hbarAmount || 0} HBAR (${mintFee?.tinybarAmount || 0} tinybar)`);
    console.log(`[LP-05]   Steps:         ${totalSteps} (${needApprove0 ? "approve0 " : ""}${needApprove1 ? "approve1 " : ""}mint)`);
    console.log("[LP-05] ═══════════════════════════════════════════════");

    // ── 3. Approve tokens ───────────────────────────────────────────
    // Only non-HBAR tokens need approval. HBAR is sent as payable amount.

    if (needApprove0) {
      emitStep("Approving token0...");
      popupCount++;
      const token0 = resolveTokenByHtsId(token0HtsId);
      const symbol0 = token0?.symbol || "Token0";
      const approve0 = await approveTokenForMint(
        accountId, token0HtsId, symbol0, amount0Desired, nftManagerId, network,
        (d) => onStep?.(currentStep, totalSteps, d),
      );
      if (!approve0.success) {
        return {
          success: false,
          error: approve0.error,
          userCancelled: approve0.userCancelled,
          popupCount,
        };
      }
    }

    if (needApprove1) {
      emitStep("Approving token1...");
      popupCount++;
      const token1 = resolveTokenByHtsId(token1HtsId);
      const symbol1 = token1?.symbol || "Token1";
      const approve1 = await approveTokenForMint(
        accountId, token1HtsId, symbol1, amount1Desired, nftManagerId, network,
        (d) => onStep?.(currentStep, totalSteps, d),
      );
      if (!approve1.success) {
        return {
          success: false,
          error: approve1.error,
          userCancelled: approve1.userCancelled,
          popupCount,
        };
      }
    }

    // ── 4. Build mint calldata ──────────────────────────────────────
    emitStep("Minting position...");

    // [FUND-SAFETY] Validate tick range
    if (tickLower >= tickUpper) {
      return { success: false, error: `Invalid tick range: tickLower (${tickLower}) >= tickUpper (${tickUpper})`, popupCount };
    }
    if (amount0Desired <= 0n && amount1Desired <= 0n) {
      return { success: false, error: "Both token amounts are zero. Cannot mint an empty position.", popupCount };
    }

    // Slippage-adjusted minimums
    const amount0Min = amount0Desired * BigInt(10000 - slippageBps) / 10000n;
    const amount1Min = amount1Desired * BigInt(10000 - slippageBps) / 10000n;

    // Deadline: 20 minutes from now
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

    // [LP-05-FIX] Use on-chain addresses and fee, NOT computed ones
    const mintParams: LPMintParams = {
      token0: token0Evm,
      token1: token1Evm,
      fee: effectiveFee,
      tickLower,
      tickUpper,
      amount0Desired,
      amount1Desired,
      amount0Min,
      amount1Min,
      recipient: recipientEvm,
      deadline,
    };

    console.log("[LP-05] Mint params:", {
      token0: mintParams.token0,
      token1: mintParams.token1,
      fee: mintParams.fee,
      tickLower: mintParams.tickLower,
      tickUpper: mintParams.tickUpper,
      amount0Desired: mintParams.amount0Desired.toString(),
      amount1Desired: mintParams.amount1Desired.toString(),
      amount0Min: mintParams.amount0Min.toString(),
      amount1Min: mintParams.amount1Min.toString(),
      recipient: mintParams.recipient,
      deadline: mintParams.deadline.toString(),
    });

    // Build multicall: [mint(...), refundETH()]
    const mintCalldata = encodeMint(mintParams);
    const refundCalldata = encodeRefundETH();
    const multicallData = encodeMulticall([mintCalldata, refundCalldata]);

    console.log(`[LP-05] Calldata sizes: mint=${mintCalldata.length}B, refund=${refundCalldata.length}B, multicall=${multicallData.length}B`);

    // ── 5. Calculate payable amount ─────────────────────────────────
    // payable = mintFee (tinybar) + HBAR deposit (tinybar, if applicable)
    //
    // [FUND-SAFETY] refundETH() returns any unused HBAR to sender.
    // We use on-chain WHBAR detection as ground truth for payable calc.

    let payableTinybar = 0n;

    // Mint fee (with 1% buffer for exchange rate drift)
    const mintFeeTinybar = mintFee?.tinybarAmount
      ? BigInt(Math.ceil(mintFee.tinybarAmount * 1.01))
      : 0n;
    payableTinybar += mintFeeTinybar;

    // HBAR deposit — use on-chain WHBAR detection as ground truth
    const token0IsHbar = isToken0Hbar || onChainToken0IsWhbar;
    const token1IsHbar = isToken1Hbar || onChainToken1IsWhbar;

    if (token0IsHbar && amount0Desired > 0n) {
      payableTinybar += amount0Desired;
      console.log(`[LP-05] HBAR deposit (token0): ${amount0Desired.toString()} tinybar`);
    } else if (token1IsHbar && amount1Desired > 0n) {
      payableTinybar += amount1Desired;
      console.log(`[LP-05] HBAR deposit (token1): ${amount1Desired.toString()} tinybar`);
    }

    console.log(`[LP-05] Total payable: ${payableTinybar.toString()} tinybar (${Number(payableTinybar) / 1e8} HBAR) [fee=${mintFeeTinybar} + deposit]`);

    // ── 6. Build and execute ContractExecuteTransaction ──────────────
    const { executeHederaTransaction } = await import("../hashpack");
    popupCount++;

    const mintTx = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(nftManagerId))
      .setGas(V2_GAS_LIMITS.MINT)
      .setFunctionParameters(multicallData)
      .setPayableAmount(Hbar.fromTinybars(Number(payableTinybar)));

    console.log("[LP-05] ══════════════════════════════════════════════");
    console.log("[LP-05] EXECUTING MINT TRANSACTION");
    console.log(`[LP-05]   Contract:   ${nftManagerId}`);
    console.log(`[LP-05]   Gas:        ${V2_GAS_LIMITS.MINT}`);
    console.log(`[LP-05]   Payable:    ${payableTinybar.toString()} tinybar (${Number(payableTinybar) / 1e8} HBAR)`);
    console.log(`[LP-05]   Multicall:  [mint, refundETH]`);
    console.log("[LP-05] ══════════════════════════════════════════════");

    const txResult = await executeHederaTransaction(accountId, mintTx);
    console.log("[LP-05] Mint TX result:", JSON.stringify(txResult));

    if (!txResult.success) {
      return {
        success: false,
        transactionId: txResult.transactionId || undefined,
        error: txResult.error || "Mint transaction failed",
        userCancelled: txResult.userCancelled,
        popupCount,
      };
    }

    console.log("[LP-05] ══════════════════════════════════════════════");
    console.log("[LP-05] MINT SUCCESSFUL ✓");
    console.log(`[LP-05]   Transaction: ${txResult.transactionId}`);
    console.log(`[LP-05]   HashScan:    https://hashscan.io/${network}/transaction/${txResult.transactionId}`);
    console.log("[LP-05] ══════════════════════════════════════════════");

    return {
      success: true,
      transactionId: txResult.transactionId || undefined,
      popupCount,
    };

  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error("[LP-05] Mint execution error:", errMsg);

    // Detect user cancellation
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
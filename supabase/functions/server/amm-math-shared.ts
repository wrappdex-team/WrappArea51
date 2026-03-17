// ══════════════════════════════════════════════════════════════════════
// AMM Math — Shared Pure Functions (Constant-Product x * y = k)
// ══════════════════════════════════════════════════════════════════════
//
// SECURITY AUDIT PEN-06/07/08 (2026-03-17): PURE MATH ONLY — zero routes,
// zero network calls. Imported by atomic-signer.ts (which validates all
// math server-side before co-signing). No attack surface. SAFE.
// ══════════════════════════════════════════════════════════════════════
//
// Single source of truth for all AMM math across the server.
// Imported by:
//   - amm.ts              (deprecated KV-backed AMM — reference only)
//   - atomic-signer.ts    (active signing oracle — server-side validation)
//   - amm-math.test.ts    (unit tests — 14 suites, ~120+ steps)
//
// The client-side engine (src/app/utils/atomic-swap-engine.ts) has an
// identical copy of these functions. Any change here MUST be mirrored
// there. The test file validates both copies produce identical outputs.
//
// All functions are PURE: no I/O, no state, no side effects. BigInt-only
// math avoids IEEE 754 precision loss for 18-decimal tokens (WETH).
//
// NOTE [SHARED-01]:
//   The Deno server cannot share a module with the Vite-bundled frontend
//   (different runtimes, different module resolution). This file covers
//   server-side dedup only. Client-side dedup would require a monorepo
//   package or build-time code generation — out of scope for Phase 1.
//
// References:
//   - Uniswap V2 Whitepaper: https://uniswap.org/whitepaper.pdf
//   - HIP-1249 (EVM throughput scaling): high-TPS networks need
//     deterministic math — BigInt eliminates float nondeterminism
// ══════════════════════════════════════════════════════════════════════

// ── Constants ────────────────────────────────────────────────────────

/** Basis point denominator (10,000 = 100%) */
export const BPS_BASE = 10_000n;

/** Minimum liquidity burned on first deposit (Uniswap V2 LP inflation attack mitigation) */
export const MINIMUM_LIQUIDITY = 1_000n;

// ── Fee Structure ────────────────────────────────────────────────────
// Total swap fee: 0.25% (25 bps) — applied in AMM formula.
// Full 25 bps stays in pool reserves (increases k for LP holders).
// Protocol's 5 bps share is TRACKED per pool and EXTRACTED via admin.
// This is the Uniswap V2 "fee switch" model.

export const TOTAL_SWAP_FEE_BPS = 25;       // 0.25% total
export const LP_FEE_BPS = 20;               // 0.20% LP effective share
export const PROTOCOL_FEE_BPS = 5;          // 0.05% protocol extractable

// ── Protocol Micro-Fee ──────────────────────────────────────────────
// Flat $0.0007 USD per swap (paid in HBAR), split 50/50 LP/treasury.
// Separate from the 0.25% AMM fee. Additive, not proportional.

export const PROTOCOL_FEE_USD = 0.0007;
export const MAX_PROTOCOL_FEE_TINYBAR = 500_000; // ~$0.0014 at $0.28/HBAR — 2x safety ceiling

// ── Pure Math Functions ─────────────────────────────────────────────

/**
 * Newton's method integer square root. O(log n) iterations.
 * Used for LP share minting on first deposit: shares = sqrt(A * B) - MINIMUM_LIQUIDITY.
 */
export function bigIntSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

/**
 * Parse a decimal string (e.g. "1.5") to raw integer BigInt at given decimal
 * precision. Uses string manipulation, not float math, to avoid IEEE 754
 * precision loss for tokens with >15 significant digits (WETH at 18 decimals).
 */
export function decimalToBigInt(amount: string, decimals: number): bigint {
  const clean = amount.replace(/,/g, "").trim();
  if (!/^\d+\.?\d*$/.test(clean)) return 0n;
  const [whole, frac = ""] = clean.split(".");
  const paddedFrac = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + paddedFrac);
}

/**
 * Constant-product swap output (Uniswap V2 formula).
 * Fee is deducted from input before computation — stays in pool (increases k).
 *
 * Formula: out = (amountIn * (BPS_BASE - feeBps) * reserveOut) /
 *               (reserveIn * BPS_BASE + amountIn * (BPS_BASE - feeBps))
 *
 * At HIP-1249 throughput (10k+ TPS), this function may be called 1k+/s
 * under load. BigInt arithmetic is O(1) for values < 2^256 — no bottleneck.
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const feeMultiplier = BPS_BASE - BigInt(feeBps);
  const amountInWithFee = amountIn * feeMultiplier;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BPS_BASE + amountInWithFee;
  return numerator / denominator;
}

/** Price impact in bps — (amountIn / (reserveIn + amountIn)) * 10000. */
export function getPriceImpactBps(amountIn: bigint, reserveIn: bigint): number {
  if (reserveIn <= 0n) return 10000;
  return Math.min(Number(amountIn * 10000n / (reserveIn + amountIn)), 10000);
}

/**
 * Inverse: compute required input for a desired output.
 * Used for "exact output" swaps (user specifies how much they want to receive).
 * Rounds up (+1n) to ensure the pool never loses value.
 */
export function getAmountIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  if (amountOut >= reserveOut) return 0n; // Cannot drain pool
  const feeMultiplier = BPS_BASE - BigInt(feeBps);
  const numerator = reserveIn * amountOut * BPS_BASE;
  const denominator = (reserveOut - amountOut) * feeMultiplier;
  return numerator / denominator + 1n;
}

/**
 * Convert raw BigInt to display string with correct decimal placement.
 * Lossless — returns string, not float. Trailing zeros stripped.
 */
export function bigIntToDecimal(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const str = raw.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Spot price: how many units of B per 1 unit of A (adjusted for decimals).
 * Display-only — swaps NEVER use this. Uses Number for UI rendering.
 */
export function getSpotPrice(
  reserveA: bigint, decimalsA: number,
  reserveB: bigint, decimalsB: number,
): number {
  if (reserveA <= 0n || reserveB <= 0n) return 0;
  const a = Number(reserveA) / 10 ** decimalsA;
  const b = Number(reserveB) / 10 ** decimalsB;
  return b / a;
}

/**
 * Compute LP shares to mint for a liquidity deposit.
 * First deposit: sqrt(A * B) - MINIMUM_LIQUIDITY (Uniswap V2 invariant).
 * Subsequent: min(A * supply / reserveA, B * supply / reserveB).
 */
export function computeLPSharesMint(
  amountA: bigint, amountB: bigint,
  reserveA: bigint, reserveB: bigint,
  totalSupply: bigint,
): { shares: bigint; isFirstDeposit: boolean } {
  if (totalSupply === 0n) {
    const gm = bigIntSqrt(amountA * amountB);
    if (gm <= MINIMUM_LIQUIDITY) {
      return { shares: 0n, isFirstDeposit: true };
    }
    return { shares: gm - MINIMUM_LIQUIDITY, isFirstDeposit: true };
  }
  const fromA = amountA * totalSupply / reserveA;
  const fromB = amountB * totalSupply / reserveB;
  return { shares: fromA < fromB ? fromA : fromB, isFirstDeposit: false };
}

/**
 * Compute token amounts returned for burning LP shares.
 * Pro-rata: amountX = shares * reserveX / totalSupply.
 */
export function computeLPSharesBurn(
  shares: bigint,
  reserveA: bigint, reserveB: bigint,
  totalSupply: bigint,
): { amountA: bigint; amountB: bigint } {
  if (totalSupply === 0n || shares === 0n) return { amountA: 0n, amountB: 0n };
  return {
    amountA: shares * reserveA / totalSupply,
    amountB: shares * reserveB / totalSupply,
  };
}

/**
 * Compute optimal amount of B for a given deposit of A (proportional to reserves).
 * Prevents users from depositing at the wrong ratio and losing value to arb.
 */
export function computeOptimalDeposit(
  desiredAmountA: bigint,
  reserveA: bigint, reserveB: bigint,
): bigint {
  if (reserveA === 0n || reserveB === 0n) return 0n;
  return desiredAmountA * reserveB / reserveA;
}

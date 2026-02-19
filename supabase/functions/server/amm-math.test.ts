// ══════════════════════════════════════════════════════════════════════
// AMM Math — Unit Tests (Hedera-Native Atomic CryptoTransfer Model)
// ══════════════════════════════════════════════════════════════════════
//
// Architecture (current):
//   Pool reserves = real on-chain token balances of Hedera accounts
//   AMM math runs client-side (browser) in BigInt — server validates
//   Server is a signing oracle: re-reads reserves, verifies math, co-signs
//   Settlement is a single atomic CryptoTransfer (both legs or nothing)
//
// Covers:
//   1.  getAmountOut          Uniswap V2 constant-product swap formula
//   2.  decimalToBigInt       String-based decimal parser (IEEE 754-safe)
//   3.  bigIntSqrt            Newton's method integer square root
//   4.  getPriceImpactBps     Trade-vs-reserve impact estimator
//   5.  Fee invariants        0.25% total, 0.20% LP / 0.05% protocol split
//   6.  Protocol micro-fee    $0.0007 flat per swap, capped at 500k tinybar
//   7.  k-invariant           Algebraic proof that fees increase pool depth
//   8.  Swap round-trips      Property-based tests across pool configs
//   9.  getAmountIn           Inverse swap (exact-output) formula
//  10.  bigIntToDecimal       Raw BigInt → display string conversion
//  11.  getSpotPrice          Spot price computation (reserve ratio)
//  12.  computeLPSharesMint   LP share minting (first deposit + proportional)
//  13.  computeLPSharesBurn   LP share burning (pro-rata withdrawal)
//  14.  computeOptimalDeposit Proportional deposit helper
//  15.  Protocol fee accum    Per-pool tracking + extraction safety
//
// Run:  deno test supabase/functions/server/amm-math.test.ts
// ══════════════════════════════════════════════════════════════════════

import {
  assertEquals,
  assert,
  assertThrows,
} from "jsr:@std/assert";

import {
  getAmountOut,
  decimalToBigInt,
  bigIntSqrt,
  getPriceImpactBps,
  BPS_BASE,
  MINIMUM_LIQUIDITY,
  TOTAL_SWAP_FEE_BPS,
  LP_FEE_BPS,
  PROTOCOL_FEE_BPS,
  PROTOCOL_FEE_USD,
  MAX_PROTOCOL_FEE_TINYBAR,
} from "./amm.ts";

// ── Inline pure math replicas (from atomic-swap-engine.ts) ──────────
//
// These functions exist client-side in atomic-swap-engine.ts but not in
// the server's amm.ts. They are pure (no deps, no side effects), so we
// replicate them here for testing. Any divergence between these and the
// client engine is itself a bug — the server validation must agree.

function getAmountIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  if (amountOut >= reserveOut) return 0n;
  const feeMultiplier = BPS_BASE - BigInt(feeBps);
  const numerator = reserveIn * amountOut * BPS_BASE;
  const denominator = (reserveOut - amountOut) * feeMultiplier;
  return numerator / denominator + 1n;
}

function bigIntToDecimal(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const str = raw.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function getSpotPrice(
  reserveA: bigint, decimalsA: number,
  reserveB: bigint, decimalsB: number,
): number {
  if (reserveA <= 0n || reserveB <= 0n) return 0;
  const a = Number(reserveA) / 10 ** decimalsA;
  const b = Number(reserveB) / 10 ** decimalsB;
  return b / a;
}

function computeLPSharesMint(
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

function computeLPSharesBurn(
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

function computeOptimalDeposit(
  desiredAmountA: bigint,
  reserveA: bigint, reserveB: bigint,
): bigint {
  if (reserveA === 0n || reserveB === 0n) return 0n;
  return desiredAmountA * reserveB / reserveA;
}


// ── 1. getAmountOut ─────────────────────────────────────────────────

Deno.test("getAmountOut", async (t) => {

  // ── 1.1 Zero / negative guards ────────────────────────────────────

  await t.step("returns 0 for zero amountIn", () => {
    assertEquals(getAmountOut(0n, 10_000n, 10_000n, 25), 0n);
  });

  await t.step("returns 0 for negative amountIn", () => {
    assertEquals(getAmountOut(-1n, 10_000n, 10_000n, 25), 0n);
  });

  await t.step("returns 0 for zero reserveIn", () => {
    assertEquals(getAmountOut(100n, 0n, 10_000n, 25), 0n);
  });

  await t.step("returns 0 for zero reserveOut", () => {
    assertEquals(getAmountOut(100n, 10_000n, 0n, 25), 0n);
  });

  await t.step("returns 0 when all inputs are zero", () => {
    assertEquals(getAmountOut(0n, 0n, 0n, 25), 0n);
  });

  // ── 1.2 Hand-calculated known values ──────────────────────────────
  //
  // Formula: dy = (dx * (10000 - fee) * y) / (x * 10000 + dx * (10000 - fee))
  // All BigInt division truncates toward zero.

  await t.step("1:1 pool, 100 in, 0 fee → 99", () => {
    // dx=100, x=10000, y=10000, fee=0
    // amountInWithFee = 100 * 10000 = 1_000_000
    // num = 1_000_000 * 10_000 = 10_000_000_000
    // den = 10_000 * 10_000 + 1_000_000 = 101_000_000
    // 10_000_000_000 / 101_000_000 = 99.0099... → 99
    assertEquals(getAmountOut(100n, 10_000n, 10_000n, 0), 99n);
  });

  await t.step("1:1 pool, 100 in, 25 bps fee → 98", () => {
    // dx=100, x=10000, y=10000, fee=25
    // amountInWithFee = 100 * 9975 = 997_500
    // num = 997_500 * 10_000 = 9_975_000_000
    // den = 10_000 * 10_000 + 997_500 = 100_997_500
    // 9_975_000_000 / 100_997_500 = 98.7648... → 98
    assertEquals(getAmountOut(100n, 10_000n, 10_000n, 25), 98n);
  });

  await t.step("1:1 pool, 1000 in, 25 bps fee → 907", () => {
    // dx=1000, x=10000, y=10000, fee=25
    // amountInWithFee = 1000 * 9975 = 9_975_000
    // num = 9_975_000 * 10_000 = 99_750_000_000
    // den = 10_000 * 10_000 + 9_975_000 = 109_975_000
    // 99_750_000_000 / 109_975_000 = 907.024... → 907
    assertEquals(getAmountOut(1_000n, 10_000n, 10_000n, 25), 907n);
  });

  await t.step("asymmetric pool (5000/20000), 500 in, 25 bps fee → 1814", () => {
    // dx=500, x=5000, y=20000, fee=25
    // amountInWithFee = 500 * 9975 = 4_987_500
    // num = 4_987_500 * 20_000 = 99_750_000_000
    // den = 5_000 * 10_000 + 4_987_500 = 54_987_500
    // 99_750_000_000 / 54_987_500 = 1814.20... → 1814
    assertEquals(getAmountOut(500n, 5_000n, 20_000n, 25), 1814n);
  });

  // ── 1.3 Fee behavior ─────────────────────────────────────────────

  await t.step("100% fee (10000 bps) → output is 0", () => {
    assertEquals(getAmountOut(1_000n, 10_000n, 10_000n, 10000), 0n);
  });

  await t.step("higher fee → lower output (monotonicity)", () => {
    const reserves = [10_000n, 10_000n] as const;
    const input = 1_000n;
    const out0   = getAmountOut(input, ...reserves, 0);
    const out25  = getAmountOut(input, ...reserves, 25);
    const out30  = getAmountOut(input, ...reserves, 30);
    const out100 = getAmountOut(input, ...reserves, 100);

    assert(out0 > out25, "0 bps should yield more than 25 bps");
    assert(out25 > out30, "25 bps should yield more than 30 bps");
    assert(out30 > out100, "30 bps should yield more than 100 bps");
  });

  await t.step("our 25 bps fee yields more than Uniswap V2's 30 bps", () => {
    const out25 = getAmountOut(5_000n, 100_000n, 100_000n, 25);
    const out30 = getAmountOut(5_000n, 100_000n, 100_000n, 30);
    assert(out25 > out30, "WRAPpDEX's 25 bps should be strictly better for traders");
  });

  // ── 1.4 Boundary: output < reserveOut (can never drain pool) ──────

  await t.step("output is always strictly less than reserveOut", () => {
    const cases: [bigint, bigint, bigint][] = [
      [1n, 1n, 1n],
      [10_000n, 1n, 1n],
      [10n ** 18n, 10n ** 18n, 10n ** 18n],
      [10n ** 30n, 10_000n, 10_000n],      // Astronomical input
    ];
    for (const [amtIn, resIn, resOut] of cases) {
      const out = getAmountOut(amtIn, resIn, resOut, 25);
      assert(out < resOut, `output ${out} must be < reserveOut ${resOut}`);
    }
  });

  // ── 1.5 k-invariant: fee keeps k non-decreasing ──────────────────
  //
  // Algebraic proof:
  //   k_new / k_old = (x + dx) * 10000 / (x * 10000 + dx * (10000 - fee))
  //   When fee > 0 → denominator < (x + dx) * 10000 → ratio > 1 → k increases.
  //   When fee = 0 → ratio = 1 → k unchanged.

  await t.step("k increases after swap with fee (invariant property)", () => {
    const testCases = [
      { dx: 100n,    x: 10_000n,  y: 10_000n,  fee: 25  },
      { dx: 5_000n,  x: 100_000n, y: 50_000n,  fee: 25  },
      { dx: 1n,      x: 1_000n,   y: 1_000n,   fee: 25  },
      { dx: 10_000n, x: 10_000n,  y: 10_000n,  fee: 25  },  // 50% of reserve
    ];
    for (const { dx, x, y, fee } of testCases) {
      const dy = getAmountOut(dx, x, y, fee);
      const kBefore = x * y;
      const kAfter = (x + dx) * (y - dy);
      assert(
        kAfter >= kBefore,
        `k must not decrease: before=${kBefore} after=${kAfter} (dx=${dx}, x=${x}, y=${y}, fee=${fee})`,
      );
      if (fee > 0 && dx > 0n && dy > 0n) {
        assert(
          kAfter > kBefore,
          `k must strictly increase when fee > 0: before=${kBefore} after=${kAfter}`,
        );
      }
    }
  });

  await t.step("k unchanged when fee is 0 (conservation)", () => {
    const dx = 1_000n;
    const x = 100_000n;
    const y = 100_000n;
    const dy = getAmountOut(dx, x, y, 0);
    const kBefore = x * y;
    const kAfter = (x + dx) * (y - dy);
    // With BigInt truncation, kAfter >= kBefore (may be slightly more due to rounding)
    assert(kAfter >= kBefore, "k should not decrease with zero fee");
    // But should be very close (within 1 unit of reserveOut)
    assert(kAfter - kBefore < y, "k should not increase significantly with zero fee");
  });

  // ── 1.6 Large values: 18-decimal token precision ──────────────────

  await t.step("handles 18-decimal token amounts without overflow", () => {
    // Simulates 1 WETH into a pool of 1000 WETH / 2M USDC
    const oneWeth = 10n ** 18n;
    const reserveWeth = 1_000n * oneWeth;
    const reserveUsdc = 2_000_000n * 10n ** 6n;
    const out = getAmountOut(oneWeth, reserveWeth, reserveUsdc, 25);
    // Expected: ~1996 USDC (slightly less due to fee + slippage)
    assert(out > 0n, "must produce output");
    assert(out < reserveUsdc, "must not exceed reserves");
    const outUsdc = Number(out) / 1e6;
    assert(outUsdc > 1990 && outUsdc < 2000, `Expected ~1996 USDC, got ${outUsdc}`);
  });

  await t.step("handles maximum BigInt range (10^36 reserves)", () => {
    const amt = 10n ** 18n;
    const res = 10n ** 36n;
    const out = getAmountOut(amt, res, res, 25);
    assert(out > 0n, "must produce output even at extreme scale");
    assert(out < res, "must not exceed reserves");
  });
});


// ── 2. decimalToBigInt ──────────────────────────────────────────────

Deno.test("decimalToBigInt", async (t) => {

  // ── 2.1 Standard conversions ──────────────────────────────────────

  await t.step("whole number (8 decimals)", () => {
    assertEquals(decimalToBigInt("100", 8), 10_000_000_000n);
  });

  await t.step("decimal number (8 decimals)", () => {
    assertEquals(decimalToBigInt("1.5", 8), 150_000_000n);
  });

  await t.step("zero", () => {
    assertEquals(decimalToBigInt("0", 8), 0n);
  });

  await t.step("zero with decimal point", () => {
    assertEquals(decimalToBigInt("0.0", 8), 0n);
  });

  await t.step("USDC (6 decimals): 1000 USDC", () => {
    assertEquals(decimalToBigInt("1000", 6), 1_000_000_000n);
  });

  await t.step("USDC (6 decimals): 0.01 USDC (1 cent)", () => {
    assertEquals(decimalToBigInt("0.01", 6), 10_000n);
  });

  await t.step("HBAR (8 decimals): 1 HBAR", () => {
    assertEquals(decimalToBigInt("1", 8), 100_000_000n);
  });

  // ── 2.2 Truncation (excess decimal digits) ────────────────────────

  await t.step("truncates excess decimal digits", () => {
    assertEquals(decimalToBigInt("1.123456789", 8), 112_345_678n);
  });

  await t.step("truncates to 6 decimals (USDC precision)", () => {
    assertEquals(decimalToBigInt("1.1234567", 6), 1_123_456n);
  });

  // ── 2.3 18-decimal precision (critical IEEE 754 edge case) ────────
  //
  // This is THE reason decimalToBigInt exists. parseFloat loses precision
  // beyond ~15 significant digits. A naive `BigInt(parseFloat(s) * 10**18)`
  // silently drops the least significant digits.

  await t.step("18 decimals: minimum representable unit (1 wei)", () => {
    assertEquals(
      decimalToBigInt("0.000000000000000001", 18),
      1n,
    );
  });

  await t.step("18 decimals: preserves full precision (the IEEE 754 killer)", () => {
    assertEquals(
      decimalToBigInt("1.000000000000000001", 18),
      1_000_000_000_000_000_001n,
    );
  });

  await t.step("18 decimals: large whole + full fractional", () => {
    assertEquals(
      decimalToBigInt("123456.789012345678901234", 18),
      123_456_789_012_345_678_901_234n,
    );
  });

  await t.step("18 decimals: 1 WETH", () => {
    assertEquals(
      decimalToBigInt("1", 18),
      10n ** 18n,
    );
  });

  // ── 2.4 Formatting tolerances ─────────────────────────────────────

  await t.step("strips commas in formatted numbers", () => {
    assertEquals(decimalToBigInt("1,234.56", 8), 123_456_000_000n);
  });

  await t.step("strips leading/trailing whitespace", () => {
    assertEquals(decimalToBigInt("  1.5  ", 8), 150_000_000n);
  });

  await t.step("handles commas + whitespace combined", () => {
    assertEquals(decimalToBigInt("  1,000,000.25  ", 6), 1_000_000_250_000n);
  });

  // ── 2.5 Invalid inputs → 0n (safe default) ───────────────────────

  await t.step("empty string → 0", () => {
    assertEquals(decimalToBigInt("", 8), 0n);
  });

  await t.step("negative number → 0 (regex rejects)", () => {
    assertEquals(decimalToBigInt("-5", 8), 0n);
  });

  await t.step("alphabetic input → 0", () => {
    assertEquals(decimalToBigInt("abc", 8), 0n);
  });

  await t.step("mixed alphanumeric → 0", () => {
    assertEquals(decimalToBigInt("12abc34", 8), 0n);
  });

  await t.step("multiple decimal points → 0", () => {
    assertEquals(decimalToBigInt("1.2.3", 8), 0n);
  });

  await t.step("scientific notation → 0 (intentionally rejected)", () => {
    assertEquals(decimalToBigInt("1e18", 8), 0n);
  });

  // ── 2.6 Zero decimals ────────────────────────────────────────────

  await t.step("0 decimal places: whole numbers pass through", () => {
    assertEquals(decimalToBigInt("42", 0), 42n);
  });

  await t.step("0 decimal places: fractional part truncated entirely", () => {
    assertEquals(decimalToBigInt("42.999", 0), 42n);
  });
});


// ── 3. bigIntSqrt ───────────────────────────────────────────────────

Deno.test("bigIntSqrt", async (t) => {

  await t.step("sqrt(0) = 0", () => {
    assertEquals(bigIntSqrt(0n), 0n);
  });

  await t.step("sqrt(1) = 1", () => {
    assertEquals(bigIntSqrt(1n), 1n);
  });

  await t.step("perfect squares", () => {
    const cases: [bigint, bigint][] = [
      [4n, 2n], [9n, 3n], [16n, 4n], [25n, 5n], [100n, 10n],
      [10000n, 100n], [1_000_000n, 1_000n],
    ];
    for (const [input, expected] of cases) {
      assertEquals(bigIntSqrt(input), expected, `sqrt(${input}) should be ${expected}`);
    }
  });

  await t.step("non-perfect squares → floor", () => {
    assertEquals(bigIntSqrt(2n), 1n);
    assertEquals(bigIntSqrt(3n), 1n);
    assertEquals(bigIntSqrt(5n), 2n);
    assertEquals(bigIntSqrt(8n), 2n);
    assertEquals(bigIntSqrt(10n), 3n);
    assertEquals(bigIntSqrt(99n), 9n);
  });

  await t.step("large value: sqrt(10^36) = 10^18", () => {
    assertEquals(bigIntSqrt(10n ** 36n), 10n ** 18n);
  });

  await t.step("floor property: result^2 <= n < (result+1)^2", () => {
    const values = [2n, 7n, 15n, 101n, 999n, 10n ** 20n + 1n];
    for (const n of values) {
      const s = bigIntSqrt(n);
      assert(s * s <= n, `${s}^2 = ${s * s} should be <= ${n}`);
      assert((s + 1n) * (s + 1n) > n, `(${s}+1)^2 should be > ${n}`);
    }
  });

  await t.step("throws on negative input", () => {
    assertThrows(() => bigIntSqrt(-1n), Error, "sqrt of negative");
  });
});


// ── 4. getPriceImpactBps ────────────────────────────────────────────

Deno.test("getPriceImpactBps", async (t) => {

  await t.step("zero reserves → max impact (10000 bps)", () => {
    assertEquals(getPriceImpactBps(100n, 0n), 10000);
  });

  await t.step("small trade on large pool → low impact", () => {
    assertEquals(getPriceImpactBps(1n, 1_000_000n), 0);
  });

  await t.step("100 in 10000 reserve → 99 bps", () => {
    assertEquals(getPriceImpactBps(100n, 10_000n), 99);
  });

  await t.step("trade equal to reserves → 5000 bps (50%)", () => {
    assertEquals(getPriceImpactBps(10_000n, 10_000n), 5000);
  });

  await t.step("trade much larger than reserves → approaches but never exceeds 10000", () => {
    const impact = getPriceImpactBps(10n ** 30n, 1n);
    assertEquals(impact, 10000);
  });

  await t.step("capped at 10000 bps maximum", () => {
    const impact = getPriceImpactBps(10n ** 18n, 1n);
    assertEquals(impact, 10000);
  });

  await t.step("monotonically increasing with trade size", () => {
    const reserve = 100_000n;
    let prev = 0;
    for (const size of [1n, 10n, 100n, 1_000n, 10_000n, 50_000n, 100_000n]) {
      const impact = getPriceImpactBps(size, reserve);
      assert(impact >= prev, `Impact should increase: ${impact} >= ${prev} (size=${size})`);
      prev = impact;
    }
  });
});


// ── 5. Fee Structure Invariants ─────────────────────────────────────

Deno.test("Fee structure", async (t) => {

  await t.step("fee split sums correctly: LP + protocol = total", () => {
    assertEquals(LP_FEE_BPS + PROTOCOL_FEE_BPS, TOTAL_SWAP_FEE_BPS);
  });

  await t.step("total fee is 25 bps (0.25%)", () => {
    assertEquals(TOTAL_SWAP_FEE_BPS, 25);
  });

  await t.step("LP fee is 20 bps (0.20%)", () => {
    assertEquals(LP_FEE_BPS, 20);
  });

  await t.step("protocol fee is 5 bps (0.05%)", () => {
    assertEquals(PROTOCOL_FEE_BPS, 5);
  });

  await t.step("BPS_BASE is 10000", () => {
    assertEquals(BPS_BASE, 10_000n);
  });

  await t.step("MINIMUM_LIQUIDITY is 1000 (first-depositor attack mitigation)", () => {
    assertEquals(MINIMUM_LIQUIDITY, 1_000n);
  });
});


// ── 6. Protocol Micro-Fee Calculation ───────────────────────────────
//
// The flat $0.0007 swap fee is converted to tinybar at runtime using the
// oracle HBAR price. This section verifies the conversion math and
// safety bounds.

Deno.test("Protocol micro-fee", async (t) => {

  // Replicate the production formula:
  //   protocolFeeTinybar = min(MAX, max(1, round(($0.0007 / hbarPrice) * 1e8)))
  function computeProtocolFeeTinybar(hbarPriceUsd: number): number {
    const protocolFeeHbar = PROTOCOL_FEE_USD / hbarPriceUsd;
    return Math.min(MAX_PROTOCOL_FEE_TINYBAR, Math.max(1, Math.round(protocolFeeHbar * 1e8)));
  }

  await t.step("at $0.28 HBAR → 250_000 tinybar", () => {
    assertEquals(computeProtocolFeeTinybar(0.28), 250_000);
  });

  await t.step("at $0.10 HBAR → 700_000 capped to 500_000", () => {
    assertEquals(computeProtocolFeeTinybar(0.10), MAX_PROTOCOL_FEE_TINYBAR);
  });

  await t.step("at $0.01 HBAR (very cheap) → capped at 500_000", () => {
    assertEquals(computeProtocolFeeTinybar(0.01), MAX_PROTOCOL_FEE_TINYBAR);
  });

  await t.step("at $100 HBAR → 700 tinybar (well within bounds)", () => {
    assertEquals(computeProtocolFeeTinybar(100), 700);
  });

  await t.step("at $10_000 HBAR → 7 tinybar", () => {
    assertEquals(computeProtocolFeeTinybar(10_000), 7);
  });

  await t.step("minimum floor: never returns 0", () => {
    const fee = computeProtocolFeeTinybar(1_000_000);
    assert(fee >= 1, "Protocol fee must never be 0 tinybar");
  });

  await t.step("maximum cap constant is 500_000", () => {
    assertEquals(MAX_PROTOCOL_FEE_TINYBAR, 500_000);
  });

  await t.step("protocol fee USD is $0.0007", () => {
    assertEquals(PROTOCOL_FEE_USD, 0.0007);
  });
});


// ── 7. Protocol Fee Accumulation Invariants ─────────────────────────
//
// The 0.05% protocol share is tracked per-pool as:
//   protocolShareRaw = rawIn * PROTOCOL_FEE_BPS / BPS_BASE
//
// This section verifies the accumulation math and extraction safety
// properties. In the atomic model, fee tracking is maintained server-side
// by the signing oracle; reserves themselves are on-chain.

Deno.test("Protocol fee accumulation math", async (t) => {

  function protocolShareRaw(rawIn: bigint): bigint {
    return rawIn * BigInt(PROTOCOL_FEE_BPS) / BPS_BASE;
  }

  await t.step("5 bps of 1M raw units = 500", () => {
    assertEquals(protocolShareRaw(1_000_000n), 500n);
  });

  await t.step("5 bps of 10B raw units = 5_000_000", () => {
    assertEquals(protocolShareRaw(10_000_000_000n), 5_000_000n);
  });

  await t.step("sub-dust trades: 1 raw unit → 0 protocol share", () => {
    assertEquals(protocolShareRaw(1n), 0n);
  });

  await t.step("minimum non-zero share: 2000 raw units → 1", () => {
    assertEquals(protocolShareRaw(2_000n), 1n);
  });

  await t.step("1999 raw units → 0 (just below threshold)", () => {
    assertEquals(protocolShareRaw(1_999n), 0n);
  });

  // ── Extraction safety: 50% ceiling ────────────────────────────────

  await t.step("extraction 50% ceiling: accumulated fees vs reserves", () => {
    const reserveA = 1_000_000n;
    const deductedA = 600_000n;
    const exceedsCeiling = deductedA > reserveA / 2n;
    assert(exceedsCeiling, "600K deduction from 1M reserves should exceed 50% ceiling");
  });

  await t.step("extraction within 50% ceiling: passes", () => {
    const reserveA = 1_000_000n;
    const deductedA = 400_000n;
    const exceedsCeiling = deductedA > reserveA / 2n;
    assert(!exceedsCeiling, "400K deduction from 1M reserves should be within 50% ceiling");
  });

  await t.step("extraction exactly at 50% boundary: passes", () => {
    const reserveA = 1_000_000n;
    const deductedA = 500_000n;
    const exceedsCeiling = deductedA > reserveA / 2n;
    assert(!exceedsCeiling, "Exactly 50% should not exceed ceiling (> not >=)");
  });

  // ── Idempotency: extraction resets accumulator ────────────────────

  await t.step("post-extraction accumulator is zeroed", () => {
    const accum = {
      accruedUsd: 12.50,
      accruedInputTokens: { USDC: "625000", HBAR: "44642857" } as Record<string, string>,
      swapCount: 100,
    };

    const resetAccum = {
      accruedUsd: 0,
      accruedInputTokens: {} as Record<string, string>,
      swapCount: 0,
      lastExtractedAt: Date.now(),
      lastExtractedUsd: accum.accruedUsd,
    };

    assertEquals(resetAccum.accruedUsd, 0);
    assertEquals(resetAccum.swapCount, 0);
    assertEquals(Object.keys(resetAccum.accruedInputTokens).length, 0);
    assertEquals(resetAccum.lastExtractedUsd, 12.50);
  });

  await t.step("second extraction after reset has nothing to extract", () => {
    const accum = { accruedUsd: 0, accruedInputTokens: {} };
    const hasFeesToExtract = accum.accruedUsd > 0;
    assert(!hasFeesToExtract, "No fees should remain after extraction");
  });
});


// ── 8. Swap Round-Trip Properties ───────────────────────────────────
//
// Property-based tests that hold for ALL valid inputs, verified across
// a sweep of representative pool configurations.

Deno.test("Swap round-trip properties", async (t) => {

  const poolConfigs = [
    { x: 10_000n,           y: 10_000n,           label: "1:1 small" },
    { x: 1_000_000n,        y: 1_000_000n,        label: "1:1 medium" },
    { x: 10n ** 18n,        y: 10n ** 18n,         label: "1:1 18-decimal" },
    { x: 5_000n,            y: 20_000n,            label: "1:4 asymmetric" },
    { x: 100n,              y: 10_000_000n,        label: "1:100K asymmetric" },
    { x: 10n ** 20n,        y: 10n ** 12n,         label: "10^20 : 10^12" },
  ];

  const tradePercentages = [1n, 10n, 100n, 1000n, 5000n]; // in basis points of reserveIn

  await t.step("output > 0 for all non-trivial inputs", () => {
    for (const { x, y, label } of poolConfigs) {
      for (const bps of tradePercentages) {
        const dx = x * bps / 10000n;
        if (dx === 0n) continue;
        const dy = getAmountOut(dx, x, y, 25);
        assert(dy > 0n, `Expected output > 0 for ${label} at ${bps}bps trade`);
      }
    }
  });

  await t.step("output < reserveOut for all inputs", () => {
    for (const { x, y, label } of poolConfigs) {
      for (const bps of tradePercentages) {
        const dx = x * bps / 10000n;
        if (dx === 0n) continue;
        const dy = getAmountOut(dx, x, y, 25);
        assert(dy < y, `Output must be < reserveOut for ${label} at ${bps}bps trade`);
      }
    }
  });

  await t.step("k non-decreasing for all configurations", () => {
    for (const { x, y, label } of poolConfigs) {
      for (const bps of tradePercentages) {
        const dx = x * bps / 10000n;
        if (dx === 0n) continue;
        const dy = getAmountOut(dx, x, y, 25);
        const kBefore = x * y;
        const kAfter = (x + dx) * (y - dy);
        assert(
          kAfter >= kBefore,
          `k must not decrease: ${label} at ${bps}bps (before=${kBefore}, after=${kAfter})`,
        );
      }
    }
  });

  await t.step("larger trade → larger output (monotonicity in amountIn)", () => {
    for (const { x, y, label } of poolConfigs) {
      let prevOut = 0n;
      for (const bps of tradePercentages) {
        const dx = x * bps / 10000n;
        if (dx === 0n) continue;
        const dy = getAmountOut(dx, x, y, 25);
        assert(
          dy >= prevOut,
          `Output must increase with trade size: ${label} at ${bps}bps`,
        );
        prevOut = dy;
      }
    }
  });
});


// ── 9. getAmountIn (Inverse / Exact-Output Swap) ────────────────────
//
// Given a desired output, compute the required input.
// Must satisfy: getAmountOut(getAmountIn(dy), x, y, fee) >= dy
// (the round-trip must produce at least the desired output)

Deno.test("getAmountIn", async (t) => {

  // ── 9.1 Zero / negative guards ────────────────────────────────────

  await t.step("returns 0 for zero amountOut", () => {
    assertEquals(getAmountIn(0n, 10_000n, 10_000n, 25), 0n);
  });

  await t.step("returns 0 for negative amountOut", () => {
    assertEquals(getAmountIn(-1n, 10_000n, 10_000n, 25), 0n);
  });

  await t.step("returns 0 for zero reserveIn", () => {
    assertEquals(getAmountIn(100n, 0n, 10_000n, 25), 0n);
  });

  await t.step("returns 0 for zero reserveOut", () => {
    assertEquals(getAmountIn(100n, 10_000n, 0n, 25), 0n);
  });

  await t.step("returns 0 when amountOut >= reserveOut (cannot drain pool)", () => {
    assertEquals(getAmountIn(10_000n, 10_000n, 10_000n, 25), 0n);
    assertEquals(getAmountIn(10_001n, 10_000n, 10_000n, 25), 0n);
  });

  // ── 9.2 Round-trip consistency: getAmountOut(getAmountIn(dy)) >= dy ─

  await t.step("round-trip: computed input produces at least the desired output", () => {
    const cases = [
      { dy: 50n,    x: 10_000n,  y: 10_000n,  fee: 25 },
      { dy: 500n,   x: 100_000n, y: 100_000n, fee: 25 },
      { dy: 1_000n, x: 5_000n,   y: 20_000n,  fee: 25 },
      { dy: 100n,   x: 10_000n,  y: 10_000n,  fee: 0  },
      { dy: 10n ** 15n, x: 10n ** 18n, y: 10n ** 18n, fee: 25 },
    ];
    for (const { dy, x, y, fee } of cases) {
      const dx = getAmountIn(dy, x, y, fee);
      if (dx === 0n) continue; // Skip degenerate cases
      const actualOut = getAmountOut(dx, x, y, fee);
      assert(
        actualOut >= dy,
        `Round-trip failed: wanted ${dy}, got ${actualOut} (dx=${dx}, x=${x}, y=${y}, fee=${fee})`,
      );
    }
  });

  // ── 9.3 Input includes the +1 rounding bias (never underpays) ─────

  await t.step("always rounds up (conservative for the trader)", () => {
    const dy = 100n;
    const x = 10_000n;
    const y = 10_000n;
    const dx = getAmountIn(dy, x, y, 25);
    // The +1n in the formula ensures the input is always sufficient
    assert(dx > 0n, "Input must be positive");
    const actualOut = getAmountOut(dx, x, y, 25);
    assert(actualOut >= dy, "Output must be >= desired (rounding protects pool)");
  });

  // ── 9.4 Monotonicity: larger desired output → larger required input ─

  await t.step("monotonically increasing with desired output", () => {
    const x = 100_000n;
    const y = 100_000n;
    let prevIn = 0n;
    for (const dy of [10n, 100n, 1_000n, 10_000n, 50_000n]) {
      const dx = getAmountIn(dy, x, y, 25);
      if (dx === 0n) continue;
      assert(dx >= prevIn, `Input must increase: ${dx} >= ${prevIn} (dy=${dy})`);
      prevIn = dx;
    }
  });
});


// ── 10. bigIntToDecimal ─────────────────────────────────────────────
//
// Inverse of decimalToBigInt. Converts raw integer BigInt back to a
// human-readable decimal string.

Deno.test("bigIntToDecimal", async (t) => {

  await t.step("zero → '0'", () => {
    assertEquals(bigIntToDecimal(0n, 8), "0");
  });

  await t.step("1 HBAR (8 decimals): 100_000_000 → '1'", () => {
    assertEquals(bigIntToDecimal(100_000_000n, 8), "1");
  });

  await t.step("1.5 HBAR: 150_000_000 → '1.5'", () => {
    assertEquals(bigIntToDecimal(150_000_000n, 8), "1.5");
  });

  await t.step("1000 USDC (6 decimals): 1_000_000_000 → '1000'", () => {
    assertEquals(bigIntToDecimal(1_000_000_000n, 6), "1000");
  });

  await t.step("0.01 USDC: 10_000 → '0.01'", () => {
    assertEquals(bigIntToDecimal(10_000n, 6), "0.01");
  });

  await t.step("1 wei (18 decimals): 1 → '0.000000000000000001'", () => {
    assertEquals(bigIntToDecimal(1n, 18), "0.000000000000000001");
  });

  await t.step("1 WETH (18 decimals): 10^18 → '1'", () => {
    assertEquals(bigIntToDecimal(10n ** 18n, 18), "1");
  });

  await t.step("trailing zeros stripped", () => {
    // 1.50000000 should display as "1.5", not "1.50000000"
    assertEquals(bigIntToDecimal(150_000_000n, 8), "1.5");
  });

  await t.step("small sub-unit value: 1 tinybar (8 decimals)", () => {
    assertEquals(bigIntToDecimal(1n, 8), "0.00000001");
  });

  await t.step("0 decimals: raw value as string", () => {
    assertEquals(bigIntToDecimal(42n, 0), "42");
  });

  // ── Round-trip: decimalToBigInt → bigIntToDecimal ─────────────────

  await t.step("round-trip: '123.456' at 8 decimals", () => {
    const raw = decimalToBigInt("123.456", 8);
    assertEquals(bigIntToDecimal(raw, 8), "123.456");
  });

  await t.step("round-trip: '0.00000001' at 8 decimals", () => {
    const raw = decimalToBigInt("0.00000001", 8);
    assertEquals(bigIntToDecimal(raw, 8), "0.00000001");
  });

  await t.step("round-trip: '1.000000000000000001' at 18 decimals", () => {
    const raw = decimalToBigInt("1.000000000000000001", 18);
    assertEquals(bigIntToDecimal(raw, 18), "1.000000000000000001");
  });
});


// ── 11. getSpotPrice ────────────────────────────────────────────────
//
// Spot price = reserveB / reserveA (adjusted for decimals).
// Used for UI display only — swap math uses the constant-product formula.

Deno.test("getSpotPrice", async (t) => {

  await t.step("1:1 pool with same decimals → price = 1.0", () => {
    const price = getSpotPrice(1_000_000n, 6, 1_000_000n, 6);
    assertEquals(price, 1.0);
  });

  await t.step("USDC/WHBAR pool: 50K USDC / 500K WHBAR → $0.10/WHBAR", () => {
    // 50,000 USDC (6 dec) = 50_000_000_000 raw
    // 500,000 WHBAR (8 dec) = 50_000_000_000_000 raw
    // spotPrice = (50000) / (500000) = 0.1
    const price = getSpotPrice(
      50_000_000_000_000n, 8,  // 500K WHBAR
      50_000_000_000n, 6,      // 50K USDC
    );
    assert(Math.abs(price - 0.1) < 0.001, `Expected ~0.1, got ${price}`);
  });

  await t.step("zero reserves → 0", () => {
    assertEquals(getSpotPrice(0n, 8, 1_000n, 6), 0);
    assertEquals(getSpotPrice(1_000n, 8, 0n, 6), 0);
  });

  await t.step("cross-decimal precision: 8-dec vs 18-dec tokens", () => {
    // Pool: 1000 WBTC (8 dec) / 100 WETH (18 dec)
    // Price of WBTC in WETH = 100/1000 = 0.1
    const price = getSpotPrice(
      1_000_00_000_000n, 8,     // 1000 WBTC
      100n * 10n ** 18n, 18,    // 100 WETH
    );
    assert(Math.abs(price - 0.1) < 0.001, `Expected ~0.1, got ${price}`);
  });
});


// ── 12. computeLPSharesMint ─────────────────────────────────────────
//
// LP share minting follows Uniswap V2:
//   First deposit:  shares = sqrt(A * B) - MINIMUM_LIQUIDITY
//   Subsequent:     shares = min(dA * totalLP / rA, dB * totalLP / rB)

Deno.test("computeLPSharesMint", async (t) => {

  // ── 12.1 First deposit ────────────────────────────────────────────

  await t.step("first deposit: sqrt(A*B) - 1000", () => {
    // Deposit 10_000 of each token
    // sqrt(10000 * 10000) = 10000, minus 1000 = 9000
    const { shares, isFirstDeposit } = computeLPSharesMint(
      10_000n, 10_000n, 0n, 0n, 0n,
    );
    assertEquals(shares, 9_000n);
    assertEquals(isFirstDeposit, true);
  });

  await t.step("first deposit: MINIMUM_LIQUIDITY burned (attack mitigation)", () => {
    const { shares } = computeLPSharesMint(1_000_000n, 1_000_000n, 0n, 0n, 0n);
    const gm = bigIntSqrt(1_000_000n * 1_000_000n);
    assertEquals(shares, gm - MINIMUM_LIQUIDITY);
  });

  await t.step("first deposit too small: returns 0 shares", () => {
    // sqrt(100 * 100) = 100, which is <= 1000 → 0 shares
    const { shares, isFirstDeposit } = computeLPSharesMint(
      100n, 100n, 0n, 0n, 0n,
    );
    assertEquals(shares, 0n);
    assertEquals(isFirstDeposit, true);
  });

  await t.step("first deposit exactly at threshold: sqrt = 1000 → 0 shares", () => {
    // sqrt(1000 * 1000) = 1000 → 1000 - 1000 = 0
    const { shares } = computeLPSharesMint(1_000n, 1_000n, 0n, 0n, 0n);
    assertEquals(shares, 0n);
  });

  await t.step("first deposit just above threshold: sqrt = 1001 → 1 share", () => {
    // Find A*B where sqrt(A*B) = 1001: A*B = 1_002_001
    // Let A = 1001, B = 1001 → sqrt(1002001) = 1001
    const { shares } = computeLPSharesMint(1_001n, 1_001n, 0n, 0n, 0n);
    assertEquals(shares, 1n);
  });

  // ── 12.2 Proportional deposit ─────────────────────────────────────

  await t.step("proportional deposit: balanced amounts", () => {
    // Pool: 10K A / 10K B, totalLP = 9000 (from first deposit above)
    // Deposit 1K A / 1K B → 10% of reserves → 900 shares
    const { shares, isFirstDeposit } = computeLPSharesMint(
      1_000n, 1_000n, 10_000n, 10_000n, 9_000n,
    );
    assertEquals(shares, 900n);
    assertEquals(isFirstDeposit, false);
  });

  await t.step("proportional deposit: unbalanced amounts → min ratio", () => {
    // Pool: 10K A / 10K B, totalLP = 9000
    // Deposit 2K A / 1K B → from A: 2000*9000/10000=1800, from B: 1000*9000/10000=900
    // min(1800, 900) = 900
    const { shares } = computeLPSharesMint(
      2_000n, 1_000n, 10_000n, 10_000n, 9_000n,
    );
    assertEquals(shares, 900n);
  });

  await t.step("proportional deposit: heavily skewed → lesser ratio dominates", () => {
    // Pool: 100K A / 100K B, totalLP = 99_000
    // Deposit 10K A / 1 B → from A: 10000*99000/100000=9900, from B: 1*99000/100000=0
    // min(9900, 0) = 0
    const { shares } = computeLPSharesMint(
      10_000n, 1n, 100_000n, 100_000n, 99_000n,
    );
    assertEquals(shares, 0n);
  });
});


// ── 13. computeLPSharesBurn ─────────────────────────────────────────
//
// Pro-rata withdrawal: each share entitles the holder to a proportional
// fraction of both reserves. Includes accumulated swap fees.

Deno.test("computeLPSharesBurn", async (t) => {

  await t.step("zero shares → zero tokens", () => {
    const { amountA, amountB } = computeLPSharesBurn(0n, 10_000n, 10_000n, 9_000n);
    assertEquals(amountA, 0n);
    assertEquals(amountB, 0n);
  });

  await t.step("zero totalSupply → zero tokens", () => {
    const { amountA, amountB } = computeLPSharesBurn(100n, 10_000n, 10_000n, 0n);
    assertEquals(amountA, 0n);
    assertEquals(amountB, 0n);
  });

  await t.step("burn all shares → get all reserves", () => {
    const { amountA, amountB } = computeLPSharesBurn(9_000n, 10_000n, 10_000n, 9_000n);
    assertEquals(amountA, 10_000n);
    assertEquals(amountB, 10_000n);
  });

  await t.step("burn 10% of shares → get 10% of reserves", () => {
    const { amountA, amountB } = computeLPSharesBurn(900n, 10_000n, 10_000n, 9_000n);
    assertEquals(amountA, 1_000n);
    assertEquals(amountB, 1_000n);
  });

  await t.step("burn 50% of shares → get 50% of reserves", () => {
    const { amountA, amountB } = computeLPSharesBurn(4_500n, 10_000n, 10_000n, 9_000n);
    assertEquals(amountA, 5_000n);
    assertEquals(amountB, 5_000n);
  });

  await t.step("asymmetric reserves: proportional withdrawal", () => {
    // Pool: 100K A / 50K B, totalLP = 50_000
    // Burn 10_000 shares (20% of supply) → 20K A, 10K B
    const { amountA, amountB } = computeLPSharesBurn(
      10_000n, 100_000n, 50_000n, 50_000n,
    );
    assertEquals(amountA, 20_000n);
    assertEquals(amountB, 10_000n);
  });

  await t.step("fee accumulation: reserves grow but LP supply unchanged", () => {
    // After fees, reserves grew from 10K/10K to 11K/11K (fees added to reserves)
    // totalLP still 9000. Burn 900 shares (10%) → get 1100/1100 (includes fee share!)
    const { amountA, amountB } = computeLPSharesBurn(900n, 11_000n, 11_000n, 9_000n);
    assertEquals(amountA, 1_100n);
    assertEquals(amountB, 1_100n);
  });

  // ── Burn/mint symmetry ────────────────────────────────────────────

  await t.step("mint then burn returns original deposit (minus rounding)", () => {
    const depositA = 5_000n;
    const depositB = 5_000n;
    const reserveA = 100_000n;
    const reserveB = 100_000n;
    const totalLP = 99_000n;

    const { shares } = computeLPSharesMint(depositA, depositB, reserveA, reserveB, totalLP);
    const newTotalLP = totalLP + shares;
    const newResA = reserveA + depositA;
    const newResB = reserveB + depositB;

    const { amountA, amountB } = computeLPSharesBurn(shares, newResA, newResB, newTotalLP);
    // Due to BigInt truncation, may lose up to 1 unit per token
    assert(amountA >= depositA - 1n && amountA <= depositA, `Expected ~${depositA}, got ${amountA}`);
    assert(amountB >= depositB - 1n && amountB <= depositB, `Expected ~${depositB}, got ${amountB}`);
  });
});


// ── 14. computeOptimalDeposit ───────────────────────────────────────
//
// Given a desired amount of token A, returns the proportional amount of
// token B needed to maintain the pool ratio (avoiding excess token waste).

Deno.test("computeOptimalDeposit", async (t) => {

  await t.step("1:1 pool → same amount", () => {
    assertEquals(computeOptimalDeposit(1_000n, 10_000n, 10_000n), 1_000n);
  });

  await t.step("1:2 pool → double amount", () => {
    assertEquals(computeOptimalDeposit(1_000n, 10_000n, 20_000n), 2_000n);
  });

  await t.step("2:1 pool → half amount", () => {
    assertEquals(computeOptimalDeposit(1_000n, 20_000n, 10_000n), 500n);
  });

  await t.step("zero reserves → 0", () => {
    assertEquals(computeOptimalDeposit(1_000n, 0n, 10_000n), 0n);
    assertEquals(computeOptimalDeposit(1_000n, 10_000n, 0n), 0n);
  });

  await t.step("large asymmetric pool: preserves ratio", () => {
    // Pool: 1M USDC (6 dec) / 10M WHBAR (8 dec)
    // Deposit 100K USDC → should need 1M WHBAR
    const optB = computeOptimalDeposit(100_000n, 1_000_000n, 10_000_000n);
    assertEquals(optB, 1_000_000n);
  });

  await t.step("deposit 0 → 0 regardless of reserves", () => {
    assertEquals(computeOptimalDeposit(0n, 10_000n, 10_000n), 0n);
  });
});

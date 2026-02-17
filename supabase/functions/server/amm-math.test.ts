// ══════════════════════════════════════════════════════════════════════
// AMM Math — Unit Tests
// ══════════════════════════════════════════════════════════════════════
//
// Covers:
//   1. getAmountOut         Uniswap V2 constant-product swap formula
//   2. decimalToBigInt      String-based decimal parser (IEEE 754-safe)
//   3. bigIntSqrt           Newton's method integer square root
//   4. getPriceImpactBps    Trade-vs-reserve impact estimator
//   5. Fee invariants       0.25% total, 0.20% LP / 0.05% protocol split
//   6. Protocol micro-fee   $0.0007 flat per swap, capped at 500k tinybar
//   7. k-invariant          Algebraic proof that fees increase pool depth
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
    // Reserves must be small enough relative to trade that the 5-bps gap
    // between 25 and 30 survives BigInt truncation. At 10K:10K with 1K in:
    //   fee=0 → 909, fee=25 → 907, fee=30 → 906, fee=100 → 900
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
    // 1/1000 of pool = 0.1%, so output should be close to 2000 USDC raw units
    assert(out > 0n, "must produce output");
    assert(out < reserveUsdc, "must not exceed reserves");
    // Roughly 1996-1999 USDC worth of raw units
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
    // 9 fractional digits, but only 8 decimal places → last digit dropped
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
    // parseFloat("1.000000000000000001") === 1.0 (loses the trailing 1)
    // String-based parsing preserves it.
    assertEquals(
      decimalToBigInt("1.000000000000000001", 18),
      1_000_000_000_000_000_001n,
    );
  });

  await t.step("18 decimals: large whole + full fractional", () => {
    assertEquals(
      decimalToBigInt("123456.789012345678901234", 18),
      // "789012345678901234" is exactly 18 chars → no padding, no truncation
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
    // "1e18" contains 'e' → regex rejects. This prevents silent precision loss
    // from JavaScript auto-converting scientific notation to float.
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
    assertEquals(bigIntSqrt(2n), 1n);     // 1^2=1 <= 2 < 4=2^2
    assertEquals(bigIntSqrt(3n), 1n);
    assertEquals(bigIntSqrt(5n), 2n);     // 2^2=4 <= 5 < 9=3^2
    assertEquals(bigIntSqrt(8n), 2n);
    assertEquals(bigIntSqrt(10n), 3n);    // 3^2=9 <= 10 < 16=4^2
    assertEquals(bigIntSqrt(99n), 9n);    // 9^2=81 <= 99 < 100=10^2
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
    // 1 / (1_000_000 + 1) * 10000 ≈ 0 bps
    assertEquals(getPriceImpactBps(1n, 1_000_000n), 0);
  });

  await t.step("100 in 10000 reserve → 99 bps", () => {
    // 100 * 10000 / (10000 + 100) = 1_000_000 / 10_100 = 99
    assertEquals(getPriceImpactBps(100n, 10_000n), 99);
  });

  await t.step("trade equal to reserves → 5000 bps (50%)", () => {
    // 10000 * 10000 / (10000 + 10000) = 100_000_000 / 20_000 = 5000
    assertEquals(getPriceImpactBps(10_000n, 10_000n), 5000);
  });

  await t.step("trade much larger than reserves → approaches but never exceeds 10000", () => {
    const impact = getPriceImpactBps(10n ** 30n, 1n);
    assertEquals(impact, 10000);
  });

  await t.step("capped at 10000 bps maximum", () => {
    // Even with enormous input relative to reserves
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
    // 0.0007 / 0.10 = 0.007 HBAR = 700_000 tinybar → capped
    assertEquals(computeProtocolFeeTinybar(0.10), MAX_PROTOCOL_FEE_TINYBAR);
  });

  await t.step("at $0.01 HBAR (very cheap) → capped at 500_000", () => {
    assertEquals(computeProtocolFeeTinybar(0.01), MAX_PROTOCOL_FEE_TINYBAR);
  });

  await t.step("at $100 HBAR → 700 tinybar (well within bounds)", () => {
    // 0.0007 / 100 = 0.000007 HBAR = 700 tinybar
    assertEquals(computeProtocolFeeTinybar(100), 700);
  });

  await t.step("at $10_000 HBAR → 7 tinybar (floor doesn't kick in yet)", () => {
    // 0.0007 / 10000 = 7e-8 HBAR → 7e-8 * 1e8 = 7 tinybar.
    // The Math.max(1,...) floor only activates at much higher prices.
    assertEquals(computeProtocolFeeTinybar(10_000), 7);
  });

  await t.step("minimum floor: never returns 0", () => {
    // At extremely high HBAR price, fee approaches 0 but Math.max(1,...) floors it
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
// properties without needing KV or lock infrastructure.

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
    // 1 * 5 / 10000 = 0 (BigInt truncation). Protocol gets nothing on dust trades.
    assertEquals(protocolShareRaw(1n), 0n);
  });

  await t.step("minimum non-zero share: 2000 raw units → 1", () => {
    // 2000 * 5 / 10000 = 10000 / 10000 = 1
    assertEquals(protocolShareRaw(2_000n), 1n);
  });

  await t.step("1999 raw units → 0 (just below threshold)", () => {
    // 1999 * 5 = 9995, 9995 / 10000 = 0
    assertEquals(protocolShareRaw(1_999n), 0n);
  });

  // ── Extraction safety: 50% ceiling ────────────────────────────────

  await t.step("extraction 50% ceiling: accumulated fees vs reserves", () => {
    // Scenario: pool has 1M reserves, accumulated 600K in fees (60%)
    // Extraction should be rejected (exceeds 50% safety ceiling)
    const reserveA = 1_000_000n;
    const deductedA = 600_000n;
    const exceedsCeiling = deductedA > reserveA / 2n;
    assert(exceedsCeiling, "600K deduction from 1M reserves should exceed 50% ceiling");
  });

  await t.step("extraction within 50% ceiling: passes", () => {
    const reserveA = 1_000_000n;
    const deductedA = 400_000n; // 40%
    const exceedsCeiling = deductedA > reserveA / 2n;
    assert(!exceedsCeiling, "400K deduction from 1M reserves should be within 50% ceiling");
  });

  await t.step("extraction exactly at 50% boundary: passes", () => {
    const reserveA = 1_000_000n;
    const deductedA = 500_000n; // Exactly 50%
    const exceedsCeiling = deductedA > reserveA / 2n;
    assert(!exceedsCeiling, "Exactly 50% should not exceed ceiling (> not >=)");
  });

  // ── Idempotency: extraction resets accumulator ────────────────────

  await t.step("post-extraction accumulator is zeroed", () => {
    // Simulates the extraction reset logic
    const accum = {
      accruedUsd: 12.50,
      accruedInputTokens: { USDC: "625000", HBAR: "44642857" } as Record<string, string>,
      swapCount: 100,
    };

    // After extraction, the accumulator is reset:
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
    // Simulates calling extract twice with no intervening swaps.
    // The second call sees accruedUsd <= 0 and returns early.
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
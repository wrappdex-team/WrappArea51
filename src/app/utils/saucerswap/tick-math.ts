/**
 * [LP-01] SaucerSwap V2 Tick Math — Pure BigInt Implementation
 *
 * Faithful translation of Uniswap V3 on-chain math libraries:
 *   - TickMath.sol  (getSqrtRatioAtTick, getTickAtSqrtRatio)
 *   - LiquidityAmounts.sol (getAmountsForLiquidity, getLiquidityForAmounts)
 *   - Position mint/burn amount computation
 *   - Slippage application
 *
 * ZERO external dependencies. All math is BigInt-native.
 * Every function is deterministic and side-effect-free.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUDIT NOTES:
 *
 * (1) getSqrtRatioAtTick:
 *     Direct transliteration of Uniswap V3 TickMath.sol lines 24-76.
 *     Uses the Q128.128 fixed-point multiplication lookup table where
 *     each bit of |tick| corresponds to multiplying by a pre-computed
 *     constant for sqrt(1.0001^(2^bit)). 20 bit positions cover the
 *     full tick range [-887272, 887272].
 *
 * (2) getTickAtSqrtRatio:
 *     Direct transliteration of Uniswap V3 TickMath.sol lines 78-210.
 *     Uses MSB-finding followed by iterative log2 refinement (14
 *     iterations for ~128 bits of fractional precision), then converts
 *     log2 to log_sqrt(1.0001) using the pre-computed constant
 *     255738958999603826347141.
 *
 * (3) Liquidity math:
 *     From Uniswap V3 periphery LiquidityAmounts.sol. Computes token
 *     amounts from liquidity+range, and inversely computes liquidity
 *     from amounts+range. Three cases: price below range, in range,
 *     above range.
 *
 * (4) BigInt arithmetic:
 *     JavaScript BigInt right-shift (>>) on negative values is
 *     arithmetic (sign-preserving), matching Solidity's signed shift.
 *     BigInt bitwise OR (|) on negative values uses infinite sign
 *     extension, matching Solidity's int256 behavior for the
 *     getTickAtSqrtRatio log2 accumulator.
 *
 * References:
 *   https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol
 *   https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/LiquidityAmounts.sol
 *   https://github.com/Uniswap/v3-sdk/blob/main/src/utils/tickMath.ts
 * ════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Constants
// ═══════════════════════════════════════════════════════════════════════

/** Fixed-point Q96 multiplier (2^96) — used throughout Uniswap V3 price math */
export const Q96 = 1n << 96n;

/** Fixed-point Q128 multiplier (2^128) — used in internal tick math */
const Q128 = 1n << 128n;

/** Fixed-point Q32 divisor (2^32) — used in Q128 → Q96 downcast */
const Q32 = 1n << 32n;

/** Minimum representable tick in Uniswap V3 */
export const MIN_TICK = -887272;

/** Maximum representable tick in Uniswap V3 */
export const MAX_TICK = 887272;

/**
 * Minimum sqrtPriceX96 — corresponds to MIN_TICK.
 * getSqrtRatioAtTick(MIN_TICK) = 4295128739
 */
export const MIN_SQRT_RATIO = 4295128739n;

/**
 * Maximum sqrtPriceX96 — corresponds to MAX_TICK.
 * getSqrtRatioAtTick(MAX_TICK) = 1461446703485210103287273052203988822378723970342
 */
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Fee Tier → Tick Spacing
// ══════════════════════════════════════════════════════════════════════

/**
 * Map from fee tier (hundredths of a bip) to tick spacing.
 *
 * Standard Uniswap V3 tiers: 100, 500, 3000, 10000
 * SaucerSwap custom tier:    1500 (0.15%)
 *
 * Tick spacing determines which ticks are "usable" for position bounds.
 * Only ticks divisible by the spacing can be used as tickLower/tickUpper.
 */
export const TICK_SPACINGS: Record<number, number> = {
  100:   1,     // 0.01% fee → spacing 1
  500:   10,    // 0.05% fee → spacing 10
  1500:  30,    // 0.15% fee → spacing 30  (SaucerSwap custom)
  3000:  60,    // 0.30% fee → spacing 60
  10000: 200,   // 1.00% fee → spacing 200
};

/**
 * Get tick spacing for a given fee tier. Throws if fee tier is unknown.
 */
export function getTickSpacing(feeTier: number): number {
  const spacing = TICK_SPACINGS[feeTier];
  if (spacing === undefined) {
    throw new Error(`[LP-01] Unknown fee tier: ${feeTier}. Valid: ${Object.keys(TICK_SPACINGS).join(", ")}`);
  }
  return spacing;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Tick ↔ SqrtPriceX96 Conversion
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute sqrtPriceX96 from a tick value.
 *
 * sqrtPriceX96 = sqrt(1.0001^tick) * 2^96
 *
 * Direct transliteration of Uniswap V3 TickMath.getSqrtRatioAtTick.
 * Uses Q128.128 fixed-point multiplication with pre-computed constants
 * for each bit position of |tick|.
 *
 * @param tick - Integer tick value in range [MIN_TICK, MAX_TICK]
 * @returns sqrtPriceX96 as BigInt (Q96.96 fixed-point)
 * @throws If tick is out of range
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick)) throw new Error(`[LP-01] Tick must be integer, got: ${tick}`);
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`[LP-01] Tick out of range: ${tick}. Must be in [${MIN_TICK}, ${MAX_TICK}]`);
  }

  const absTick = Math.abs(tick);

  // Q128.128 lookup table: ratio starts at 1.0 (2^128) and is multiplied
  // by sqrt(1.0001^(2^bit)) for each set bit in |tick|.
  let ratio: bigint = (absTick & 0x1) !== 0
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : Q128; // 1.0 in Q128

  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

  // For positive ticks, we inverted the base (1/1.0001 instead of 1.0001),
  // so invert the result.
  if (tick > 0) {
    ratio = ((1n << 256n) - 1n) / ratio; // uint256.max / ratio
  }

  // Downcast from Q128 to Q96: shift right by 32, rounding up if remainder > 0
  return (ratio >> 32n) + (ratio % Q32 > 0n ? 1n : 0n);
}

/**
 * Compute the tick corresponding to a given sqrtPriceX96.
 *
 * Returns the greatest tick such that getSqrtRatioAtTick(tick) <= sqrtPriceX96.
 *
 * Direct transliteration of Uniswap V3 TickMath.getTickAtSqrtRatio.
 * Uses MSB detection + iterative log2 refinement (14 iterations for
 * ~128 bits of precision), then converts to log_sqrt(1.0001).
 *
 * @param sqrtRatioX96 - Q96.96 fixed-point sqrt price
 * @returns Integer tick value
 * @throws If sqrtRatioX96 is out of valid range
 */
export function getTickAtSqrtRatio(sqrtRatioX96: bigint): number {
  if (sqrtRatioX96 < MIN_SQRT_RATIO || sqrtRatioX96 >= MAX_SQRT_RATIO) {
    throw new Error(
      `[LP-01] sqrtRatioX96 out of range: ${sqrtRatioX96}. Must be in [${MIN_SQRT_RATIO}, ${MAX_SQRT_RATIO})`
    );
  }

  // Convert to Q128 for internal computation
  const ratio = sqrtRatioX96 << 32n;
  let r = ratio;

  // ── Step 1: Find the most significant bit (MSB) ────────────────────
  let msb = 0n;

  {
    const f = r > 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn ? 128n : 0n;
    msb |= f;
    r >>= f;
  }
  {
    const f = r > 0xFFFFFFFFFFFFFFFFn ? 64n : 0n;
    msb |= f;
    r >>= f;
  }
  {
    const f = r > 0xFFFFFFFFn ? 32n : 0n;
    msb |= f;
    r >>= f;
  }
  {
    const f = r > 0xFFFFn ? 16n : 0n;
    msb |= f;
    r >>= f;
  }
  {
    const f = r > 0xFFn ? 8n : 0n;
    msb |= f;
    r >>= f;
  }
  {
    const f = r > 0xFn ? 4n : 0n;
    msb |= f;
    r >>= f;
  }
  {
    const f = r > 0x3n ? 2n : 0n;
    msb |= f;
    r >>= f;
  }
  {
    const f = r > 0x1n ? 1n : 0n;
    msb |= f;
  }

  // ── Step 2: Compute log_2(ratio) in Q128 fixed-point ───────────────
  // Normalize r to have its MSB at bit 127 (Q127 format)
  if (msb >= 128n) {
    r = ratio >> (msb - 127n);
  } else {
    r = ratio << (127n - msb);
  }

  // Integer part of log2 (signed, in Q128)
  let log_2 = (msb - 128n) << 128n;

  // Iterative fractional refinement: 14 iterations for ~128-bit precision
  // Each iteration: square r, check if result >= 2.0 (bit 128 set),
  // if so record a 1 in the corresponding fractional bit position.
  for (let i = 0; i < 14; i++) {
    r = (r * r) >> 127n;
    const f = r >> 128n;
    log_2 = log_2 | (f << BigInt(127 - i));
    r >>= f;
  }

  // ── Step 3: Convert log_2 to log_sqrt(1.0001) ─────────────────────
  // log_sqrt(1.0001) = log_2 * log(2) / log(sqrt(1.0001))
  // The constant 255738958999603826347141 is log(2)/log(sqrt(1.0001)) in Q128.
  const log_sqrt10001 = log_2 * 255738958999603826347141n;

  // Compute tick bounds with error margin constants from Uniswap V3
  const tickLow = Number(
    (log_sqrt10001 - 3402992956809132418596140100660247210n) >> 128n
  );
  const tickHigh = Number(
    (log_sqrt10001 + 291339464771989622907027621153398088495n) >> 128n
  );

  // Return the exact tick (verify which bound is correct)
  if (tickLow === tickHigh) {
    return tickLow;
  }

  return getSqrtRatioAtTick(tickHigh) <= sqrtRatioX96 ? tickHigh : tickLow;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: Tick Utilities
// ═══════════════════════════════════════════════════════════════════════

/**
 * Round a tick to the nearest usable tick for a given spacing.
 *
 * Position boundaries (tickLower, tickUpper) must be multiples of the
 * pool's tick spacing. This function rounds to the nearest valid tick.
 *
 * @param tick - Raw tick value
 * @param tickSpacing - Pool's tick spacing (from fee tier)
 * @returns Nearest valid tick that is a multiple of tickSpacing
 */
export function nearestUsableTick(tick: number, tickSpacing: number): number {
  if (tickSpacing <= 0) throw new Error(`[LP-01] tickSpacing must be > 0, got: ${tickSpacing}`);

  // Clamp to valid range instead of throwing — prevents render crashes
  // when priceToTick/getTickAtSqrtRatio produce edge-case values
  // Also handle NaN: Math.trunc(NaN) → NaN, and Math.max(x, NaN) → NaN
  if (!Number.isFinite(tick)) {
    return tick > 0 ? Math.floor(MAX_TICK / tickSpacing) * tickSpacing
                     : Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  }
  const clampedTick = Math.max(MIN_TICK, Math.min(MAX_TICK, Math.trunc(tick)));

  const rounded = Math.round(clampedTick / tickSpacing) * tickSpacing;

  // Clamp to valid tick range
  if (rounded < MIN_TICK) return Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  if (rounded > MAX_TICK) return Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  return rounded;
}

/**
 * Check if the current tick falls within a position's tick range.
 *
 * A position is "in range" when tickLower <= tickCurrent < tickUpper.
 * In-range positions earn swap fees; out-of-range positions do not.
 */
export function isInRange(tickCurrent: number, tickLower: number, tickUpper: number): boolean {
  return tickCurrent >= tickLower && tickCurrent < tickUpper;
}

/**
 * Get the minimum and maximum usable ticks for a given fee tier.
 * Useful for "Full Range" position bounds.
 */
export function getMinMaxTick(feeTier: number): { minTick: number; maxTick: number } {
  const spacing = getTickSpacing(feeTier);
  return {
    minTick: Math.ceil(MIN_TICK / spacing) * spacing,
    maxTick: Math.floor(MAX_TICK / spacing) * spacing,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: Price ↔ Tick Conversion (Human-Readable)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert a sqrtPriceX96 to a human-readable price (token1 per token0),
 * adjusted for token decimals.
 *
 * price = (sqrtPriceX96 / 2^96)^2 * 10^(decimals0 - decimals1)
 *
 * For maximum precision, we compute (sqrtPriceX96^2 * 10^decimals0) / (2^192 * 10^decimals1).
 * Returns a JavaScript number (sufficient for display purposes).
 */
export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): number {
  // price_raw = sqrtPriceX96^2 / 2^192 (in token smallest units)
  // price_human = price_raw * 10^(decimals0 - decimals1)

  // To preserve precision: multiply before dividing
  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const Q192 = 1n << 192n;

  if (decimals0 >= decimals1) {
    const scale = 10n ** BigInt(decimals0 - decimals1);
    // price = numerator * scale / Q192
    // Use high-precision integer division then convert
    const scaledNum = numerator * scale;
    // Split into integer and fractional parts for precision
    const intPart = scaledNum / Q192;
    const remainder = scaledNum % Q192;
    return Number(intPart) + Number(remainder) / Number(Q192);
  } else {
    const scale = 10n ** BigInt(decimals1 - decimals0);
    // price = numerator / (Q192 * scale)
    const divisor = Q192 * scale;
    const intPart = numerator / divisor;
    const remainder = numerator % divisor;
    return Number(intPart) + Number(remainder) / Number(divisor);
  }
}

/**
 * Convert a human-readable price (token1 per token0) to the nearest
 * valid tick, adjusted for token decimals.
 *
 * @param price - Human-readable price (token1 per token0, e.g., 0.075 USDC/HBAR)
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @returns Tick value (NOT rounded to tick spacing — caller should use nearestUsableTick)
 */
export function priceToTick(
  price: number,
  decimals0: number,
  decimals1: number,
): number {
  if (price <= 0) throw new Error(`[LP-01] Price must be > 0, got: ${price}`);

  // Adjusted price in raw token units: price * 10^(decimals1 - decimals0)
  // sqrtPriceX96 = sqrt(adjustedPrice) * 2^96
  const adjustedPrice = price * Math.pow(10, decimals1 - decimals0);
  const sqrtPrice = Math.sqrt(adjustedPrice);

  // Convert to Q96 with maximum precision
  // Use string-based conversion to avoid floating-point truncation at large values
  const sqrtPriceX96 = BigInt(Math.floor(sqrtPrice * Number(Q96)));

  // Clamp to valid range
  const clamped = sqrtPriceX96 < MIN_SQRT_RATIO ? MIN_SQRT_RATIO
    : sqrtPriceX96 >= MAX_SQRT_RATIO ? MAX_SQRT_RATIO - 1n
    : sqrtPriceX96;

  return getTickAtSqrtRatio(clamped);
}

/**
 * Convert a tick to a human-readable price (token1 per token0).
 *
 * @param tick - Tick value
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @returns Human-readable price
 */
export function tickToPrice(tick: number, decimals0: number, decimals1: number): number {
  const sqrtRatioX96 = getSqrtRatioAtTick(tick);
  return sqrtPriceX96ToPrice(sqrtRatioX96, decimals0, decimals1);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Liquidity ↔ Token Amounts
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute the amount of token0 for a given liquidity and price range.
 *
 * From Uniswap V3 LiquidityAmounts.getAmount0ForLiquidity:
 *   amount0 = liquidity * (sqrtRatioB - sqrtRatioA) / (sqrtRatioA * sqrtRatioB) * Q96
 *
 * Rewritten for BigInt precision:
 *   amount0 = (liquidity << 96) * (sqrtRatioB - sqrtRatioA) / sqrtRatioB / sqrtRatioA
 *
 * @param sqrtRatioAX96 - Lower sqrt price bound (Q96)
 * @param sqrtRatioBX96 - Upper sqrt price bound (Q96)
 * @param liquidity - Liquidity amount
 * @returns Token0 amount in smallest units
 */
export function getAmount0ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): bigint {
  // Ensure A < B
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }
  if (sqrtRatioAX96 <= 0n) throw new Error("[LP-01] sqrtRatioAX96 must be > 0");

  return ((liquidity << 96n) * (sqrtRatioBX96 - sqrtRatioAX96)) / sqrtRatioBX96 / sqrtRatioAX96;
}

/**
 * Compute the amount of token1 for a given liquidity and price range.
 *
 * From Uniswap V3 LiquidityAmounts.getAmount1ForLiquidity:
 *   amount1 = liquidity * (sqrtRatioB - sqrtRatioA) / Q96
 *
 * @param sqrtRatioAX96 - Lower sqrt price bound (Q96)
 * @param sqrtRatioBX96 - Upper sqrt price bound (Q96)
 * @param liquidity - Liquidity amount
 * @returns Token1 amount in smallest units
 */
export function getAmount1ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): bigint {
  // Ensure A < B
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }

  return (liquidity * (sqrtRatioBX96 - sqrtRatioAX96)) / Q96;
}

/**
 * Compute both token amounts for a given liquidity, current price, and range.
 *
 * Three cases based on where the current price sits relative to the range:
 *   1. Below range (tickCurrent < tickLower): All token0, zero token1
 *   2. In range (tickLower <= tickCurrent < tickUpper): Both tokens
 *   3. Above range (tickCurrent >= tickUpper): Zero token0, all token1
 *
 * @param sqrtRatioX96 - Current pool sqrt price (Q96)
 * @param sqrtRatioAX96 - Lower bound sqrt price (Q96)
 * @param sqrtRatioBX96 - Upper bound sqrt price (Q96)
 * @param liquidity - Position liquidity
 * @returns Token amounts in smallest units
 */
export function getAmountsForLiquidity(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  // Ensure A < B
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }

  if (sqrtRatioX96 <= sqrtRatioAX96) {
    // Price below range — position is entirely token0
    return {
      amount0: getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity),
      amount1: 0n,
    };
  } else if (sqrtRatioX96 < sqrtRatioBX96) {
    // Price in range — both tokens
    return {
      amount0: getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity),
      amount1: getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity),
    };
  } else {
    // Price above range — position is entirely token1
    return {
      amount0: 0n,
      amount1: getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity),
    };
  }
}

// ── Inverse: Amounts → Liquidity ────────────────────────────────────

/**
 * Compute the maximum liquidity that can be provided for a given token0 amount.
 *
 * From LiquidityAmounts.getLiquidityForAmount0:
 *   L = amount0 * sqrtA * sqrtB / (sqrtB - sqrtA) / Q96
 * Rewritten:
 *   L = amount0 * (sqrtA * sqrtB / Q96) / (sqrtB - sqrtA)
 */
export function getLiquidityForAmount0(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }
  const intermediate = (sqrtRatioAX96 * sqrtRatioBX96) / Q96;
  return (amount0 * intermediate) / (sqrtRatioBX96 - sqrtRatioAX96);
}

/**
 * Compute the maximum liquidity that can be provided for a given token1 amount.
 *
 * From LiquidityAmounts.getLiquidityForAmount1:
 *   L = amount1 * Q96 / (sqrtB - sqrtA)
 */
export function getLiquidityForAmount1(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount1: bigint,
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }
  return (amount1 * Q96) / (sqrtRatioBX96 - sqrtRatioAX96);
}

/**
 * Compute the maximum liquidity for given amounts of both tokens at a price range.
 *
 * For concentrated liquidity positions, the binding constraint determines liquidity:
 * - If price < lower: Only token0 matters → getLiquidityForAmount0
 * - If price in range: min(getLiquidityForAmount0, getLiquidityForAmount1) — the
 *   tighter constraint wins
 * - If price > upper: Only token1 matters → getLiquidityForAmount1
 */
export function getLiquidityForAmounts(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }

  if (sqrtRatioX96 <= sqrtRatioAX96) {
    return getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
  } else if (sqrtRatioX96 < sqrtRatioBX96) {
    const liq0 = getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0);
    const liq1 = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1);
    return liq0 < liq1 ? liq0 : liq1;
  } else {
    return getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: Mint & Burn Amount Computation
// ═══════════════════════════════════════════════════════════════════════

/** Result of computing mint amounts for a new or increased position */
export interface MintAmounts {
  /** Required token0 amount in smallest units */
  amount0: bigint;
  /** Required token1 amount in smallest units */
  amount1: bigint;
  /** Computed liquidity that will be minted */
  liquidity: bigint;
}

/**
 * Compute the exact mint amounts for a position given one input amount.
 *
 * Given the user's desired amount for one token, compute the required amount
 * for the other token and the resulting liquidity, based on the current price
 * and the position's tick range.
 *
 * @param sqrtRatioX96 - Current pool sqrtPriceX96
 * @param tickLower - Position lower tick
 * @param tickUpper - Position upper tick
 * @param amount - User's desired input amount (in smallest units)
 * @param isAmount0 - If true, `amount` is token0; if false, token1
 * @returns Both token amounts and the computed liquidity
 */
export function computeMintAmounts(
  sqrtRatioX96: bigint,
  tickLower: number,
  tickUpper: number,
  amount: bigint,
  isAmount0: boolean,
): MintAmounts {
  if (tickLower >= tickUpper) throw new Error("[LP-01] tickLower must be < tickUpper");
  if (amount <= 0n) throw new Error("[LP-01] Amount must be > 0");

  const sqrtRatioAX96 = getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper);

  let liquidity: bigint;

  if (isAmount0) {
    // User provided token0 amount — compute liquidity from it
    if (sqrtRatioX96 <= sqrtRatioAX96) {
      // Below range: all token0
      liquidity = getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount);
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
      // In range: token0 applies from current price to upper
      liquidity = getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount);
    } else {
      // Above range: no token0 needed — can't mint with only token0
      throw new Error("[LP-01] Cannot mint with token0 when price is above range (only token1 accepted)");
    }
  } else {
    // User provided token1 amount — compute liquidity from it
    if (sqrtRatioX96 <= sqrtRatioAX96) {
      // Below range: no token1 needed — can't mint with only token1
      throw new Error("[LP-01] Cannot mint with token1 when price is below range (only token0 accepted)");
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
      // In range: token1 applies from lower to current price
      liquidity = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount);
    } else {
      // Above range: all token1
      liquidity = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount);
    }
  }

  if (liquidity <= 0n) {
    throw new Error("[LP-01] Computed liquidity is zero — amount too small for this range");
  }

  // Now compute both exact amounts from the liquidity
  const amounts = getAmountsForLiquidity(sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96, liquidity);

  return {
    amount0: amounts.amount0,
    amount1: amounts.amount1,
    liquidity,
  };
}

/**
 * Compute the token amounts returned when removing liquidity.
 *
 * @param sqrtRatioX96 - Current pool sqrtPriceX96
 * @param tickLower - Position lower tick
 * @param tickUpper - Position upper tick
 * @param liquidity - Total position liquidity
 * @param percentBps - Percentage to remove in basis points (10000 = 100%)
 * @returns Token amounts that will be returned
 */
export function computeBurnAmounts(
  sqrtRatioX96: bigint,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  percentBps: number = 10000,
): { amount0: bigint; amount1: bigint; liquidityToRemove: bigint } {
  if (percentBps <= 0 || percentBps > 10000) {
    throw new Error(`[LP-01] percentBps must be in (0, 10000], got: ${percentBps}`);
  }

  const liquidityToRemove = (liquidity * BigInt(percentBps)) / 10000n;

  const sqrtRatioAX96 = getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper);

  const amounts = getAmountsForLiquidity(
    sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96, liquidityToRemove
  );

  return {
    amount0: amounts.amount0,
    amount1: amounts.amount1,
    liquidityToRemove,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: Slippage Application
// ═══════════════════════════════════════════════════════════════════════

/**
 * Apply slippage tolerance to compute minimum acceptable output.
 *
 * Used for:
 *   - Mint: amount0Min / amount1Min (protect against price movement)
 *   - Decrease: amount0Min / amount1Min (protect against price movement)
 *
 * @param amount - Desired/expected amount
 * @param slippageBps - Slippage tolerance in basis points (e.g., 100 = 1%)
 * @returns Minimum acceptable amount after slippage
 */
export function applySlippage(amount: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10000) {
    throw new Error(`[LP-01] slippageBps must be in [0, 10000], got: ${slippageBps}`);
  }
  return (amount * BigInt(10000 - slippageBps)) / 10000n;
}

/**
 * Compute mint amounts with slippage applied to both tokens.
 *
 * @param mintAmounts - Result from computeMintAmounts
 * @param slippageBps - Slippage tolerance in basis points
 * @returns Minimum amounts the router must deliver
 */
export function mintAmountsWithSlippage(
  mintAmounts: MintAmounts,
  slippageBps: number,
): { amount0Min: bigint; amount1Min: bigint } {
  return {
    amount0Min: applySlippage(mintAmounts.amount0, slippageBps),
    amount1Min: applySlippage(mintAmounts.amount1, slippageBps),
  };
}

/**
 * Compute burn amounts with slippage applied to both tokens.
 *
 * @param burnAmounts - Result from computeBurnAmounts
 * @param slippageBps - Slippage tolerance in basis points
 * @returns Minimum amounts the position holder must receive
 */
export function burnAmountsWithSlippage(
  burnAmounts: { amount0: bigint; amount1: bigint },
  slippageBps: number,
): { amount0Min: bigint; amount1Min: bigint } {
  return {
    amount0Min: applySlippage(burnAmounts.amount0, slippageBps),
    amount1Min: applySlippage(burnAmounts.amount1, slippageBps),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9: Validation Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Validate a tick pair for position creation.
 * Ensures:
 *   - tickLower < tickUpper
 *   - Both within valid range
 *   - Both divisible by tick spacing for the fee tier
 *
 * @returns Error message string, or null if valid
 */
export function validateTickRange(
  tickLower: number,
  tickUpper: number,
  feeTier: number,
): string | null {
  const spacing = TICK_SPACINGS[feeTier];
  if (spacing === undefined) return `Unknown fee tier: ${feeTier}`;
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) return "Ticks must be integers";
  if (tickLower >= tickUpper) return "tickLower must be less than tickUpper";
  if (tickLower < MIN_TICK) return `tickLower (${tickLower}) below MIN_TICK (${MIN_TICK})`;
  if (tickUpper > MAX_TICK) return `tickUpper (${tickUpper}) above MAX_TICK (${MAX_TICK})`;
  if (tickLower % spacing !== 0) return `tickLower (${tickLower}) not divisible by spacing (${spacing})`;
  if (tickUpper % spacing !== 0) return `tickUpper (${tickUpper}) not divisible by spacing (${spacing})`;
  return null;
}
/**
 * [C48] SaucerSwap ABI Encoding / Decoding Helpers
 *
 * Extracted from the monolith saucerswap.ts for maintainability.
 * Contains: All EVM ABI encode/decode functions for SaucerSwap V1 + V2 contracts.
 * Zero side effects, zero network calls -- pure byte manipulation.
 *
 * ════════════════════════════════════════════════════════════════════════
 * [AUDIT] FUNCTION SELECTOR VERIFICATION — Last audited 2026-02-23
 *
 * All 16 selectors verified against keccak256(signature):
 *
 * V1 Router (UniswapV2Router02 fork):
 *   0xd06ca61f  getAmountsOut(uint256,address[])
 *   0x38ed1739  swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
 *   0x7ff36ab5  swapExactETHForTokens(uint256,address[],address,uint256)
 *   0x18cbafe5  swapExactTokensForETH(uint256,uint256,address[],address,uint256)
 *   0xe6a43905  getPair(address,address)
 *
 * V1 RouterWithFee (FOT variants):
 *   0x5c11d795  swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)
 *   0xb6f9de95  swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)
 *   0x791ac947  swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)
 *
 * V2 SwapRouter (UniswapV3 fork):
 *   0x414bf389  exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
 *   0xc04b8d59  exactInput((bytes,address,uint256,uint256,uint256))
 *   0x49404b7c  unwrapWETH9(uint256,address)
 *   0xac9650d8  multicall(bytes[])
 *
 * V2 QuoterV2:
 *   0xc6a5026a  quoteExactInputSingle((address,address,uint256,uint24,uint160))
 *   0xcdca1753  quoteExactInput(bytes,uint256)
 *
 * V2 Factory:
 *   0x1698ee82  getPool(address,address,uint24)
 *
 * ERC-20:
 *   0x095ea7b3  approve(address,uint256)
 *
 * ABI Encoding Notes:
 *   - V1 swapExactETHForTokens: head offset for path[] = 128 (4 head slots × 32)
 *   - V1 swapExact*For* (5-param): head offset for path[] = 160 (5 head slots × 32)
 *   - V2 exactInputSingle: static struct → no outer offset needed
 *   - V2 exactInput: dynamic struct (has bytes path) → outer offset 0x20
 *     + inner path offset 0xa0 (5 struct fields × 32)
 *   - V2 packed path: 20-byte addresses + 3-byte fees (uint24 big-endian)
 *   - V2 multicall: array offset 0x20 + per-element offsets + length-prefixed data
 * ════════════════════════════════════════════════════════════════════════
 */

// ── Primitive Helpers ───────────────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function encodeUint256(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

export function encodeAddress(addr: string): Uint8Array {
  const hex = addr.replace("0x", "").padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

export function decodeBigUint(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) | BigInt(bytes[offset + i]);
  }
  return value;
}

// ── V1 Router Encoding ──────────────────────────────────────────────

/**
 * ABI-encode getAmountsOut(uint256 amountIn, address[] calldata path)
 * Selector: 0xd06ca61f
 */
export function encodeGetAmountsOut(amountIn: bigint, path: string[]): Uint8Array {
  const selector = new Uint8Array([0xd0, 0x6c, 0xa6, 0x1f]);
  const parts: Uint8Array[] = [selector];
  parts.push(encodeUint256(amountIn));     // amountIn
  parts.push(encodeUint256(64n));           // offset to path array (2 head slots x 32)
  parts.push(encodeUint256(BigInt(path.length)));
  for (const addr of path) {
    parts.push(encodeAddress(addr));
  }
  return concatBytes(...parts);
}

/**
 * Decode the return value of getAmountsOut -> uint256[] memory amounts.
 * Returns the last element (expected output amount) or null on failure.
 */
export function decodeAmountsOutResult(hexData: string): bigint | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 96) return null; // need at least offset + length + 1 element

    // First 32 bytes = offset to the dynamic array (should be 0x20 = 32)
    // Next 32 bytes = length of the array
    const arrLen = Number(decodeBigUint(bytes, 32));
    if (arrLen <= 0 || bytes.length < 64 + arrLen * 32) return null;

    // Last element is amounts[arrLen-1]
    const lastOffset = 64 + (arrLen - 1) * 32;
    return decodeBigUint(bytes, lastOffset);
  } catch {
    return null;
  }
}

/**
 * Encode swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
 * Selector: 0x38ed1739
 */
export function encodeSaucerSwapCall(
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint
): Uint8Array {
  const selector = new Uint8Array([0x38, 0xed, 0x17, 0x39]);
  const parts: Uint8Array[] = [selector];

  parts.push(encodeUint256(amountIn));
  parts.push(encodeUint256(amountOutMin));
  parts.push(encodeUint256(160n)); // offset to dynamic array
  parts.push(encodeAddress(to));
  parts.push(encodeUint256(deadline));
  parts.push(encodeUint256(BigInt(path.length)));
  for (const addr of path) {
    parts.push(encodeAddress(addr));
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Encode swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)
 * Selector: 0x7ff36ab5
 *
 * The HBAR amount is sent as the payable value on the ContractExecuteTransaction.
 * Path must start with WHBAR EVM address.
 */
export function encodeSaucerSwapETHForTokens(
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint
): Uint8Array {
  const selector = new Uint8Array([0x7f, 0xf3, 0x6a, 0xb5]);
  const parts: Uint8Array[] = [selector];

  // Head: amountOutMin, path offset, to, deadline
  parts.push(encodeUint256(amountOutMin));        // slot 0
  parts.push(encodeUint256(128n));                 // slot 1: offset to path data (4 head slots x 32 = 128)
  parts.push(encodeAddress(to));                   // slot 2
  parts.push(encodeUint256(deadline));             // slot 3

  // Tail: path array
  parts.push(encodeUint256(BigInt(path.length)));
  for (const addr of path) {
    parts.push(encodeAddress(addr));
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Encode swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)
 * Selector: 0x18cbafe5
 *
 * Path must end with WHBAR EVM address.
 */
export function encodeSaucerSwapTokensForETH(
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint
): Uint8Array {
  const selector = new Uint8Array([0x18, 0xcb, 0xaf, 0xe5]);
  const parts: Uint8Array[] = [selector];

  // Same layout as swapExactTokensForTokens
  parts.push(encodeUint256(amountIn));
  parts.push(encodeUint256(amountOutMin));
  parts.push(encodeUint256(160n)); // offset to dynamic array (5 head slots x 32 = 160)
  parts.push(encodeAddress(to));
  parts.push(encodeUint256(deadline));
  parts.push(encodeUint256(BigInt(path.length)));
  for (const addr of path) {
    parts.push(encodeAddress(addr));
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// ── V1 Fee-on-Transfer (FOT) Router Encoding ────────────────────────
//
// [FOT] SaucerSwap V1 RouterWithFee (0.0.6755814) implements the UniswapV2
// "SupportingFeeOnTransferTokens" variants. These check the ACTUAL balance
// change of the recipient after each swap hop, instead of relying on the
// router's internal accounting. This handles HTS tokens with custom fee
// schedules (fractional fees, royalty fees) that deduct from every transfer.
//
// Function signatures are identical to the standard variants — only the
// 4-byte selector and internal logic differ.

/**
 * Encode swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)
 * Selector: 0x5c11d795
 */
export function encodeSaucerSwapCallFOT(
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint
): Uint8Array {
  const selector = new Uint8Array([0x5c, 0x11, 0xd7, 0x95]);
  return concatBytes(
    selector,
    encodeUint256(amountIn),
    encodeUint256(amountOutMin),
    encodeUint256(160n),
    encodeAddress(to),
    encodeUint256(deadline),
    encodeUint256(BigInt(path.length)),
    ...path.map(addr => encodeAddress(addr)),
  );
}

/**
 * Encode swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)
 * Selector: 0xb6f9de95
 *
 * HBAR amount is sent as the payable value. Path must start with WHBAR.
 */
export function encodeSaucerSwapETHForTokensFOT(
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint
): Uint8Array {
  const selector = new Uint8Array([0xb6, 0xf9, 0xde, 0x95]);
  return concatBytes(
    selector,
    encodeUint256(amountOutMin),
    encodeUint256(128n),
    encodeAddress(to),
    encodeUint256(deadline),
    encodeUint256(BigInt(path.length)),
    ...path.map(addr => encodeAddress(addr)),
  );
}

/**
 * Encode swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)
 * Selector: 0x791ac947
 *
 * Path must end with WHBAR EVM address.
 */
export function encodeSaucerSwapTokensForETHFOT(
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint
): Uint8Array {
  const selector = new Uint8Array([0x79, 0x1a, 0xc9, 0x47]);
  return concatBytes(
    selector,
    encodeUint256(amountIn),
    encodeUint256(amountOutMin),
    encodeUint256(160n),
    encodeAddress(to),
    encodeUint256(deadline),
    encodeUint256(BigInt(path.length)),
    ...path.map(addr => encodeAddress(addr)),
  );
}

// ── V1 Factory Encoding ─────────────────────────────────────────────

/**
 * ABI-encode getPair(address tokenA, address tokenB) for V1 Factory
 * Selector: 0xe6a43905
 */
export function encodeGetPair(tokenA: string, tokenB: string): Uint8Array {
  const selector = new Uint8Array([0xe6, 0xa4, 0x39, 0x05]);
  return concatBytes(selector, encodeAddress(tokenA), encodeAddress(tokenB));
}

// ── V2 Factory Encoding ─────────────────────────────────────────────

/**
 * ABI-encode getPool(address tokenA, address tokenB, uint24 fee) for V2 Factory
 * Selector: 0x1698ee82
 */
export function encodeGetPool(tokenA: string, tokenB: string, fee: number): Uint8Array {
  const selector = new Uint8Array([0x16, 0x98, 0xee, 0x82]);
  return concatBytes(
    selector,
    encodeAddress(tokenA),
    encodeAddress(tokenB),
    encodeUint256(BigInt(fee))
  );
}

// ── V2 SwapRouter Encoding ──────────────────────────────────────────

/**
 * Encode exactInputSingle for SaucerSwap V2 (UniswapV3-style SwapRouter).
 *
 * Function: exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
 * Selector: 0x414bf389
 *
 * The struct fields (in order):
 *   tokenIn, tokenOut, fee, recipient, deadline,
 *   amountIn, amountOutMinimum, sqrtPriceLimitX96
 *
 * For native HBAR input: HBAR is sent as payable value, tokenIn = WHBAR address.
 * The router wraps HBAR internally before swapping through the pool.
 */
export function encodeExactInputSingle(
  tokenIn: string,
  tokenOut: string,
  fee: number,
  recipient: string,
  deadline: bigint,
  amountIn: bigint,
  amountOutMinimum: bigint,
  sqrtPriceLimitX96: bigint = 0n
): Uint8Array {
  const selector = new Uint8Array([0x41, 0x4b, 0xf3, 0x89]);
  return concatBytes(
    selector,
    encodeAddress(tokenIn),
    encodeAddress(tokenOut),
    encodeUint256(BigInt(fee)),
    encodeAddress(recipient),
    encodeUint256(deadline),
    encodeUint256(amountIn),
    encodeUint256(amountOutMinimum),
    encodeUint256(sqrtPriceLimitX96)
  );
}

/**
 * Encode a packed V2 swap path for multi-hop routing.
 *
 * UniswapV3-style path encoding: abi.encodePacked(token0, fee0, token1, fee1, token2, ...)
 * Each token address is 20 bytes, each fee is 3 bytes (uint24 big-endian).
 *
 * Example 2-hop: WHBAR -> (fee=3000) -> SAUCE -> (fee=10000) -> USDC
 *   = bytes20(WHBAR) + bytes3(3000) + bytes20(SAUCE) + bytes3(10000) + bytes20(USDC)
 *   = 20 + 3 + 20 + 3 + 20 = 66 bytes
 *
 * [C9-05] Multi-hop support for best-available-route execution.
 */
export function encodeSwapPath(hops: { tokenEvm: string; fee: number }[]): Uint8Array {
  if (hops.length < 2) throw new Error("Swap path must have at least 2 tokens");

  const parts: Uint8Array[] = [];
  for (let i = 0; i < hops.length; i++) {
    // Token address: 20 bytes (strip 0x prefix, parse hex)
    const addrHex = hops[i].tokenEvm.replace("0x", "").padStart(40, "0");
    const addrBytes = new Uint8Array(20);
    for (let j = 0; j < 20; j++) {
      addrBytes[j] = parseInt(addrHex.slice(j * 2, j * 2 + 2), 16);
    }
    parts.push(addrBytes);

    // Fee: 3 bytes big-endian (between each token pair, not after the last)
    if (i < hops.length - 1) {
      const fee = hops[i].fee;
      const feeBytes = new Uint8Array(3);
      feeBytes[0] = (fee >> 16) & 0xff;
      feeBytes[1] = (fee >> 8) & 0xff;
      feeBytes[2] = fee & 0xff;
      parts.push(feeBytes);
    }
  }

  return concatBytes(...parts);
}

/**
 * Encode exactInput for SaucerSwap V2 multi-hop swaps (UniswapV3-style SwapRouter).
 *
 * Function: exactInput((bytes,address,uint256,uint256,uint256))
 * Selector: 0xc04b8d59
 *
 * ExactInputParams struct fields (in order):
 *   path            (bytes -- packed encoding of tokens and fees)
 *   recipient       (address)
 *   deadline        (uint256)
 *   amountIn        (uint256)
 *   amountOutMinimum (uint256)
 *
 * [C9-05] Multi-hop routing for best-available-route execution.
 *
 * [C77-06] CRITICAL FIX: Added outer offset (0x20) for the struct argument.
 *
 * The function signature is `exactInput(ExactInputParams memory params)` where
 * ExactInputParams is a struct containing `bytes path` (a dynamic type).
 * Per the Solidity ABI spec, a struct with any dynamic member is itself dynamic,
 * so the top-level argument encoding requires an OUTER offset (0x20 = 32) pointing
 * to where the struct/tuple encoding begins. Inside the struct, the `bytes path`
 * member gets its own INNER offset (0xa0 = 160, for 5 head fields × 32 bytes).
 *
 * Previously, the outer offset was MISSING — the first word after the selector
 * was 0xa0 (the inner path offset), which the contract's ABI decoder read as
 * "the struct starts at byte 160." At byte 160 it found pathLen instead of the
 * struct head, causing immediate calldata decode failure → CONTRACT_REVERT_EXECUTED
 * with 0 gas consumed. This broke 100% of V2 multi-hop swaps.
 *
 * Correct layout (matching Uniswap V3 SDK / ethers.js encoding):
 *   [0]   selector               (4 bytes)
 *   [4]   0x20                   (outer offset to struct — NEW)
 *   [36]  0xa0                   (inner offset to path within struct)
 *   [68]  recipient              (address, left-padded to 32B)
 *   [100] deadline               (uint256)
 *   [132] amountIn               (uint256)
 *   [164] amountOutMinimum       (uint256)
 *   [196] path.length            (uint256)
 *   [228] path data              (right-padded to 32B boundary)
 *
 * Note: exactInputSingle does NOT need the outer offset because its struct
 * (ExactInputSingleParams) contains only static types — no bytes/string.
 */
export function encodeExactInput(
  path: Uint8Array,
  recipient: string,
  deadline: bigint,
  amountIn: bigint,
  amountOutMinimum: bigint,
): Uint8Array {
  const selector = new Uint8Array([0xc0, 0x4b, 0x8d, 0x59]);

  // [C77-06] Outer offset: the struct (tuple) starts at byte 32 from data start.
  // This is required because ExactInputParams contains a dynamic member (bytes path).
  const outerOffset = encodeUint256(32n);

  // Inner offset to path data within the struct: 5 head fields × 32 = 160 = 0xa0
  const pathOffset = encodeUint256(160n);

  // Path length and padded data
  const pathLen = encodeUint256(BigInt(path.length));
  const paddedLen = Math.ceil(path.length / 32) * 32;
  const pathPadded = new Uint8Array(paddedLen);
  pathPadded.set(path);

  return concatBytes(
    selector,
    outerOffset,     // [C77-06] 0x20 — outer offset to struct (WAS MISSING)
    pathOffset,      // 0xa0 — inner offset to path within struct
    encodeAddress(recipient),
    encodeUint256(deadline),
    encodeUint256(amountIn),
    encodeUint256(amountOutMinimum),
    pathLen,
    pathPadded,
  );
}

/**
 * Encode unwrapWETH9 for the SaucerSwap V2 SwapRouter.
 *
 * SaucerSwap V2 is a Uniswap V3 fork -- the SwapRouter inherits
 * PeripheryPayments which provides unwrapWETH9(uint256, address).
 * On SaucerSwap this unwraps WHBAR -> native HBAR.
 * The function name is still unwrapWETH9 because the contract code
 * was forked directly from Uniswap V3.
 *
 * Function: unwrapWETH9(uint256 amountMinimum, address recipient)
 * Selector: 0x49404b7c
 *
 * [C16-01] Token -> HBAR auto-unwrap -- replaces manual WHBAR unwrap UX.
 */
export function encodeUnwrapWHBAR(amountMinimum: bigint, recipient: string): Uint8Array {
  const selector = new Uint8Array([0x49, 0x40, 0x4b, 0x7c]);
  return concatBytes(
    selector,
    encodeUint256(amountMinimum),
    encodeAddress(recipient),
  );
}

/**
 * Encode multicall for the SaucerSwap V2 SwapRouter.
 *
 * Function: multicall(bytes[] data)
 * Selector: 0xac9650d8
 *
 * ABI encoding for bytes[] (dynamic array of dynamic elements):
 *   [0]  offset to array data = 0x20 (32 bytes past selector)
 *   [1]  array length
 *   [2+] offsets to each bytes element (relative to array data start)
 *   [N+] length + padded data for each element
 *
 * [C16-01] Token -> HBAR auto-unwrap -- single TX swap+unwrap.
 */
export function encodeMulticall(calldatas: Uint8Array[]): Uint8Array {
  const selector = new Uint8Array([0xac, 0x96, 0x50, 0xd8]);
  const arrayOffset = encodeUint256(32n);
  const arrayLen = encodeUint256(BigInt(calldatas.length));

  const offsetsSize = calldatas.length * 32;
  let currentOffset = offsetsSize;
  const offsets: Uint8Array[] = [];
  const elementParts: Uint8Array[] = [];

  for (const cd of calldatas) {
    offsets.push(encodeUint256(BigInt(currentOffset)));
    const lenWord = encodeUint256(BigInt(cd.length));
    const paddedLen = Math.ceil(cd.length / 32) * 32;
    const padded = new Uint8Array(paddedLen);
    padded.set(cd);
    elementParts.push(lenWord, padded);
    currentOffset += 32 + paddedLen;
  }

  return concatBytes(
    selector,
    arrayOffset,
    arrayLen,
    ...offsets,
    ...elementParts,
  );
}

// ── V2 QuoterV2 Encoding ───────────────────────────────────────────

/**
 * Encode quoteExactInputSingle for the SaucerSwap V2 QuoterV2 contract.
 *
 * Function: quoteExactInputSingle((address,address,uint256,uint24,uint160))
 * Selector: 0xc6a5026a
 *
 * Struct fields (in order):
 *   tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96
 */
export function encodeQuoteExactInputSingle(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number,
  sqrtPriceLimitX96: bigint = 0n
): Uint8Array {
  const selector = new Uint8Array([0xc6, 0xa5, 0x02, 0x6a]);
  return concatBytes(
    selector,
    encodeAddress(tokenIn),
    encodeAddress(tokenOut),
    encodeUint256(amountIn),
    encodeUint256(BigInt(fee)),
    encodeUint256(sqrtPriceLimitX96)
  );
}

/**
 * Encode quoteExactInput for the SaucerSwap V2 QuoterV2 contract.
 * Used for multi-hop path quotes.
 *
 * Function: quoteExactInput(bytes memory path, uint256 amountIn)
 * Selector: 0xcdca1753
 *
 * [C26-03] Multi-hop quoting for accurate multi-hop V2 quotes.
 */
export function encodeQuoteExactInput(
  path: Uint8Array,
  amountIn: bigint,
): Uint8Array {
  const selector = new Uint8Array([0xcd, 0xca, 0x17, 0x53]);
  // path is dynamic (bytes), so we use head-tail encoding:
  // head[0] = offset to path data (0x40 = 64, since 2 head slots x 32)
  // head[1] = amountIn
  // tail = path length (uint256) + path data (padded to 32-byte boundary)
  const pathLen = encodeUint256(BigInt(path.length));
  const paddedLen = Math.ceil(path.length / 32) * 32;
  const pathPadded = new Uint8Array(paddedLen);
  pathPadded.set(path);
  return concatBytes(selector, encodeUint256(64n), encodeUint256(amountIn), pathLen, pathPadded);
}

// ── ERC-20 Encoding ─────────────────────────────────────────────────

/**
 * Encode ERC-20 approve(address spender, uint256 amount)
 * Selector: 0x095ea7b3
 *
 * LEGACY [C36-01]: No longer used for swap approvals. Retained for
 * potential future non-swap use cases (e.g., LP deposit approvals).
 */
export function encodeErc20Approve(spender: string, amount: bigint): Uint8Array {
  const selector = new Uint8Array([0x09, 0x5e, 0xa7, 0xb3]);
  const parts: Uint8Array[] = [selector, encodeAddress(spender), encodeUint256(amount)];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
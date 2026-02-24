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
 *
 * ════════════════════════════════════════════════════════════════════════
 * [AUDIT] V2 MULTI-HOP ENCODING — Step 4 audit 2026-02-23
 *
 * (a) WHBAR address:    ✅ ensureWhbarContractForV2() converts HTS token
 *     0.0.1456986 → contract 0.0.1456985 for all V2 path tokens. V2 pools
 *     and SwapRouter WETH9 reference the contract, not the HTS token.
 *
 * (b) Fee tier encoding: ✅ 3 bytes big-endian uint24. 3000=0.30%,
 *     1500=0.15% (SaucerSwap custom), 500=0.05%, 10000=1.0%, 100=0.01%.
 *     SaucerSwap supports non-standard 1500 (0.15%) tier.
 *
 * (c) Address padding:  ✅ encodeSwapPath uses 20-byte addresses (packed),
 *     not 32-byte ABI-padded. Matches Uniswap V3 packed path format.
 *
 * (d) exactInput layout: ✅ C77-06 outer offset 0x20 present and correct.
 *     Inner path offset 0xa0 (5 fields × 32). Path right-padded to 32B.
 *
 * (e) Root cause of V2 multi-hop reverts: NOT in abi.ts encoding (all
 *     correct). Bug was in swap-engine.ts — per-hop fee tier validation
 *     was MISSING. Pool graph may report wrong fee tiers (API field
 *     missing → default 3000, or wrong tier for multi-pool pairs).
 *     Fixed in [SWAP-FIX-5]: per-hop QuoterV2 probing + full-path
 *     validation before execution.
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
 *
 * [AUDIT-S4] Verified: 20-byte addresses (not 32-byte ABI-padded).
 * Fee bytes are uint24 big-endian (3 bytes). Fee placed between token[i]
 * and token[i+1], not after the last token. Total path length for N
 * tokens = N*20 + (N-1)*3 bytes. Correct per Uniswap V3 spec.
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

// ═══════════════════════════════════════════════════════════════════════
// V2 NONFUNGIBLE POSITION MANAGER — LIQUIDITY OPERATIONS
// ═══════════════════════════════════════════════════════════════════════
//
// [LP-02] ABI encoders and decoders for SaucerSwap V2 concentrated
// liquidity operations. SaucerSwap V2 is a Uniswap V3 fork — all
// function signatures and struct layouts match the canonical Uniswap V3
// NonfungiblePositionManager contract.
//
// Contract: SaucerSwapV2NonfungiblePositionManager
//   Mainnet: 0.0.4053945
//   LP NFT:  0.0.4054027
//
// ════════════════════════════════════════════════════════════════════════
// [AUDIT] FUNCTION SELECTOR VERIFICATION — LP Operations
//
// All selectors verified against keccak256(canonical signature):
//
// NonfungiblePositionManager:
//   0x88316456  mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))
//   0x219f5d17  increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))
//   0x0c49ccbe  decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))
//   0xfc6f7865  collect((uint256,address,uint128,uint128))
//   0x42966c68  burn(uint256)
//   0x99fbab88  positions(uint256)
//
// PeripheryPayments (inherited by NFT Manager):
//   0x12210e8a  refundETH()
//   0x49404b7c  unwrapWETH9(uint256,address)  — already defined above as encodeUnwrapWHBAR
//
// UniswapV3Pool (read-only, used via JSON-RPC eth_call):
//   0x3850c7bd  slot0()
//   0x1a686502  liquidity()
//
// UniswapV3Factory (read-only):
//   0x1698ee82  getPool(address,address,uint24) — already defined above
//
// ABI Encoding Notes:
//   - int24 (ticks): sign-extended to 256 bits. Negative values use
//     two's complement: encoded as (2^256 + value) in the uint256 slot.
//   - uint128 (liquidity in decreaseLiquidity, max amounts in collect):
//     zero-extended to 256 bits (same as uint256 for positive values).
//   - MintParams is a static struct (no dynamic members) → no outer
//     offset needed (unlike exactInput's ExactInputParams).
//   - All functions that modify state use multicall() wrapping.
// ════════════════════════════════════════════════════════════════════════

// ── Signed Integer Encoding ─────────────────────────────────────────

/**
 * Encode a signed integer (e.g., int24 tick) as a 256-bit ABI word.
 *
 * Negative values use two's complement: value + 2^256.
 * This matches Solidity's ABI encoding for int24/int128/int256.
 */
export function encodeInt256(value: bigint): Uint8Array {
  if (value >= 0n) {
    return encodeUint256(value);
  }
  // Two's complement: 2^256 + value (value is negative)
  return encodeUint256((1n << 256n) + value);
}

/**
 * Decode a signed 256-bit integer from ABI-encoded bytes.
 *
 * Values with bit 255 set are interpreted as negative (two's complement).
 */
export function decodeInt256(bytes: Uint8Array, offset: number): bigint {
  const val = decodeBigUint(bytes, offset);
  if (val >= (1n << 255n)) {
    return val - (1n << 256n);
  }
  return val;
}

// ── Mint — Create New Liquidity Position ────────────────────────────

/**
 * MintParams struct for NonfungiblePositionManager.mint()
 */
export interface LPMintParams {
  token0: string;          // EVM address (0x...)
  token1: string;          // EVM address (0x...)
  fee: number;             // Fee tier: 500, 1500, 3000, 10000
  tickLower: number;       // int24
  tickUpper: number;       // int24
  amount0Desired: bigint;  // uint256, smallest unit
  amount1Desired: bigint;  // uint256, smallest unit
  amount0Min: bigint;      // uint256, smallest unit (slippage protection)
  amount1Min: bigint;      // uint256, smallest unit (slippage protection)
  recipient: string;       // EVM address to receive the NFT
  deadline: bigint;        // uint256, Unix timestamp seconds
}

/**
 * Encode NonfungiblePositionManager.mint(MintParams)
 *
 * Selector: 0x88316456
 *
 * MintParams is a static struct (all fixed-size fields), so NO outer
 * offset is needed — the struct fields are encoded directly after the
 * selector, each in a 32-byte slot.
 *
 * Field order (11 fields × 32 bytes = 352 bytes after selector):
 *   [0]  token0          (address)
 *   [1]  token1          (address)
 *   [2]  fee             (uint24)
 *   [3]  tickLower       (int24, sign-extended to 256 bits)
 *   [4]  tickUpper       (int24, sign-extended to 256 bits)
 *   [5]  amount0Desired  (uint256)
 *   [6]  amount1Desired  (uint256)
 *   [7]  amount0Min      (uint256)
 *   [8]  amount1Min      (uint256)
 *   [9]  recipient       (address)
 *   [10] deadline        (uint256)
 */
export function encodeMint(params: LPMintParams): Uint8Array {
  const selector = new Uint8Array([0x88, 0x31, 0x64, 0x56]);
  return concatBytes(
    selector,
    encodeAddress(params.token0),
    encodeAddress(params.token1),
    encodeUint256(BigInt(params.fee)),
    encodeInt256(BigInt(params.tickLower)),
    encodeInt256(BigInt(params.tickUpper)),
    encodeUint256(params.amount0Desired),
    encodeUint256(params.amount1Desired),
    encodeUint256(params.amount0Min),
    encodeUint256(params.amount1Min),
    encodeAddress(params.recipient),
    encodeUint256(params.deadline),
  );
}

/**
 * Decoded result from NonfungiblePositionManager.mint()
 */
export interface LPMintResult {
  tokenSN: bigint;     // NFT serial number
  liquidity: bigint;   // Liquidity minted
  amount0: bigint;     // Actual token0 deposited
  amount1: bigint;     // Actual token1 deposited
}

/**
 * Decode the return value of mint() → (uint256 tokenSN, uint128 liquidity, uint256 amount0, uint256 amount1)
 *
 * When called via multicall, the individual result bytes are extracted
 * from the multicall return first, then passed here.
 *
 * @param hexData - Hex-encoded return data (with or without 0x prefix)
 * @returns Decoded mint result, or null on failure
 */
export function decodeMintResult(hexData: string): LPMintResult | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 128) return null; // 4 words × 32 bytes

    return {
      tokenSN: decodeBigUint(bytes, 0),
      liquidity: decodeBigUint(bytes, 32),
      amount0: decodeBigUint(bytes, 64),
      amount1: decodeBigUint(bytes, 96),
    };
  } catch {
    return null;
  }
}

// ── Increase Liquidity — Add to Existing Position ───────────────────

/**
 * IncreaseLiquidityParams struct
 */
export interface LPIncreaseLiquidityParams {
  tokenSN: bigint;         // uint256, NFT serial number
  amount0Desired: bigint;  // uint256
  amount1Desired: bigint;  // uint256
  amount0Min: bigint;      // uint256
  amount1Min: bigint;      // uint256
  deadline: bigint;        // uint256, Unix timestamp seconds
}

/**
 * Encode NonfungiblePositionManager.increaseLiquidity(IncreaseLiquidityParams)
 *
 * Selector: 0x219f5d17
 *
 * Static struct, 6 fields × 32 = 192 bytes after selector.
 *   [0] tokenSN        (uint256)
 *   [1] amount0Desired (uint256)
 *   [2] amount1Desired (uint256)
 *   [3] amount0Min     (uint256)
 *   [4] amount1Min     (uint256)
 *   [5] deadline       (uint256)
 */
export function encodeIncreaseLiquidity(params: LPIncreaseLiquidityParams): Uint8Array {
  const selector = new Uint8Array([0x21, 0x9f, 0x5d, 0x17]);
  return concatBytes(
    selector,
    encodeUint256(params.tokenSN),
    encodeUint256(params.amount0Desired),
    encodeUint256(params.amount1Desired),
    encodeUint256(params.amount0Min),
    encodeUint256(params.amount1Min),
    encodeUint256(params.deadline),
  );
}

/**
 * Decoded result from increaseLiquidity()
 */
export interface LPIncreaseLiquidityResult {
  liquidity: bigint;  // New total liquidity
  amount0: bigint;    // Actual token0 added
  amount1: bigint;    // Actual token1 added
}

/**
 * Decode the return value of increaseLiquidity() → (uint128 liquidity, uint256 amount0, uint256 amount1)
 */
export function decodeIncreaseLiquidityResult(hexData: string): LPIncreaseLiquidityResult | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 96) return null;

    return {
      liquidity: decodeBigUint(bytes, 0),
      amount0: decodeBigUint(bytes, 32),
      amount1: decodeBigUint(bytes, 64),
    };
  } catch {
    return null;
  }
}

// ── Decrease Liquidity — Remove from Existing Position ──────────────

/**
 * DecreaseLiquidityParams struct
 */
export interface LPDecreaseLiquidityParams {
  tokenSN: bigint;      // uint256, NFT serial number
  liquidity: bigint;    // uint128, amount of liquidity to remove
  amount0Min: bigint;   // uint256
  amount1Min: bigint;   // uint256
  deadline: bigint;     // uint256, Unix timestamp seconds
}

/**
 * Encode NonfungiblePositionManager.decreaseLiquidity(DecreaseLiquidityParams)
 *
 * Selector: 0x0c49ccbe
 *
 * Static struct, 5 fields × 32 = 160 bytes after selector.
 *   [0] tokenSN    (uint256)
 *   [1] liquidity  (uint128, zero-extended to 256 bits)
 *   [2] amount0Min (uint256)
 *   [3] amount1Min (uint256)
 *   [4] deadline   (uint256)
 */
export function encodeDecreaseLiquidity(params: LPDecreaseLiquidityParams): Uint8Array {
  const selector = new Uint8Array([0x0c, 0x49, 0xcc, 0xbe]);
  return concatBytes(
    selector,
    encodeUint256(params.tokenSN),
    encodeUint256(params.liquidity),
    encodeUint256(params.amount0Min),
    encodeUint256(params.amount1Min),
    encodeUint256(params.deadline),
  );
}

/**
 * Decoded result from decreaseLiquidity()
 */
export interface LPDecreaseLiquidityResult {
  amount0: bigint;  // Token0 amount freed (held in contract until collect)
  amount1: bigint;  // Token1 amount freed (held in contract until collect)
}

/**
 * Decode the return value of decreaseLiquidity() → (uint256 amount0, uint256 amount1)
 */
export function decodeDecreaseLiquidityResult(hexData: string): LPDecreaseLiquidityResult | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 64) return null;

    return {
      amount0: decodeBigUint(bytes, 0),
      amount1: decodeBigUint(bytes, 32),
    };
  } catch {
    return null;
  }
}

// ── Collect — Claim Fees and/or Freed Liquidity ─────────────────────

/**
 * CollectParams struct
 */
export interface LPCollectParams {
  tokenSN: bigint;     // uint256, NFT serial number
  recipient: string;   // EVM address to receive collected tokens
  amount0Max: bigint;  // uint128, max token0 to collect (use MAX_UINT128 for all)
  amount1Max: bigint;  // uint128, max token1 to collect (use MAX_UINT128 for all)
}

/** Maximum uint128 value — used for collecting all available fees */
export const MAX_UINT128 = (1n << 128n) - 1n;

/**
 * Encode NonfungiblePositionManager.collect(CollectParams)
 *
 * Selector: 0xfc6f7865
 *
 * Static struct, 4 fields × 32 = 128 bytes after selector.
 *   [0] tokenSN    (uint256)
 *   [1] recipient  (address)
 *   [2] amount0Max (uint128, zero-extended)
 *   [3] amount1Max (uint128, zero-extended)
 */
export function encodeCollect(params: LPCollectParams): Uint8Array {
  const selector = new Uint8Array([0xfc, 0x6f, 0x78, 0x65]);
  return concatBytes(
    selector,
    encodeUint256(params.tokenSN),
    encodeAddress(params.recipient),
    encodeUint256(params.amount0Max),
    encodeUint256(params.amount1Max),
  );
}

/**
 * Decoded result from collect()
 */
export interface LPCollectResult {
  amount0: bigint;  // Token0 collected
  amount1: bigint;  // Token1 collected
}

/**
 * Decode the return value of collect() → (uint256 amount0, uint256 amount1)
 */
export function decodeCollectResult(hexData: string): LPCollectResult | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 64) return null;

    return {
      amount0: decodeBigUint(bytes, 0),
      amount1: decodeBigUint(bytes, 32),
    };
  } catch {
    return null;
  }
}

// ── Burn — Destroy Empty NFT Position ───────────────────────────────

/**
 * Encode NonfungiblePositionManager.burn(uint256 tokenSN)
 *
 * Selector: 0x42966c68
 *
 * Burns an NFT position. Can only be called after all liquidity has been
 * removed (liquidity = 0) and all fees/tokens have been collected
 * (tokensOwed0 = tokensOwed1 = 0).
 *
 * IMPORTANT: The NFT Manager must have NFT allowance to burn.
 * Use AccountAllowanceApproveTransaction.approveTokenNftAllowance()
 * before including burn in the multicall.
 */
export function encodeBurn(tokenSN: bigint): Uint8Array {
  const selector = new Uint8Array([0x42, 0x96, 0x6c, 0x68]);
  return concatBytes(selector, encodeUint256(tokenSN));
}

// ── RefundETH — Return Excess HBAR ──────────────────────────────────

/**
 * Encode PeripheryPayments.refundETH()
 *
 * Selector: 0x12210e8a
 *
 * Returns any excess HBAR (sent as payable value for mint fee + WHBAR
 * deposits) back to the caller. Should always be included as the LAST
 * call in a multicall when HBAR is involved.
 *
 * Note: Despite the name "refundETH", on SaucerSwap/Hedera this
 * refunds native HBAR. The name is inherited from the Uniswap V3 fork.
 */
export function encodeRefundETH(): Uint8Array {
  return new Uint8Array([0x12, 0x21, 0x0e, 0x8a]);
}

// ═══════════════════════════════════════════════════════════════════════
// V2 READ-ONLY — Pool State & Position Queries (for JSON-RPC eth_call)
// ═══════════════════════════════════════════════════════════════════════

// ── positions(uint256) — NFT Manager ────────────────────────────────

/**
 * Encode NonfungiblePositionManager.positions(uint256 tokenSN)
 *
 * Selector: 0x99fbab88
 *
 * Returns 12 fields about an LP position. Used for reading position
 * details when the SaucerSwap REST API is unavailable.
 */
export function encodePositions(tokenSN: bigint): Uint8Array {
  const selector = new Uint8Array([0x99, 0xfb, 0xab, 0x88]);
  return concatBytes(selector, encodeUint256(tokenSN));
}

/**
 * Decoded result from positions(uint256)
 *
 * Return signature:
 *   (uint96 nonce, address operator, address token0, address token1,
 *    uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity,
 *    uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
 *    uint256 tokensOwed0, uint256 tokensOwed1)
 *
 * = 12 fields × 32 bytes = 384 bytes
 */
export interface LPPositionData {
  nonce: bigint;
  operator: string;          // EVM address
  token0: string;            // EVM address
  token1: string;            // EVM address
  fee: number;               // Fee tier (500, 1500, 3000, 10000)
  tickLower: number;         // int24
  tickUpper: number;         // int24
  liquidity: bigint;         // uint128
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;       // Uncollected token0 (fees + freed liquidity)
  tokensOwed1: bigint;       // Uncollected token1 (fees + freed liquidity)
}

/**
 * Decode the return value of positions(uint256)
 *
 * @param hexData - Hex-encoded return data from eth_call
 * @returns Parsed position data, or null on failure
 */
export function decodePositionsResult(hexData: string): LPPositionData | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 384) return null; // 12 fields × 32 bytes

    // Extract EVM address from 32-byte ABI word (last 20 bytes)
    const extractAddress = (offset: number): string => {
      const word = bytes.slice(offset, offset + 32);
      const addr = word.slice(12, 32); // skip 12 leading zero bytes
      return "0x" + Array.from(addr).map(b => b.toString(16).padStart(2, "0")).join("");
    };

    return {
      nonce:                       decodeBigUint(bytes, 0),
      operator:                    extractAddress(32),
      token0:                      extractAddress(64),
      token1:                      extractAddress(96),
      fee:                         Number(decodeBigUint(bytes, 128)),
      tickLower:                   Number(decodeInt256(bytes, 160)),
      tickUpper:                   Number(decodeInt256(bytes, 192)),
      liquidity:                   decodeBigUint(bytes, 224),
      feeGrowthInside0LastX128:    decodeBigUint(bytes, 256),
      feeGrowthInside1LastX128:    decodeBigUint(bytes, 288),
      tokensOwed0:                 decodeBigUint(bytes, 320),
      tokensOwed1:                 decodeBigUint(bytes, 352),
    };
  } catch {
    return null;
  }
}

// ── slot0() — Pool Contract ─────────────────────────────────────────

/**
 * Encode UniswapV3Pool.slot0() — no arguments
 *
 * Selector: 0x3850c7bd
 *
 * Returns the pool's current state: price, tick, observation info.
 */
export function encodeSlot0(): Uint8Array {
  return new Uint8Array([0x38, 0x50, 0xc7, 0xbd]);
}

/**
 * Decoded result from slot0()
 *
 * Return signature:
 *   (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
 *    uint16 observationCardinality, uint16 observationCardinalityNext,
 *    uint8 feeProtocol, bool unlocked)
 *
 * = 7 fields × 32 bytes = 224 bytes
 */
export interface PoolSlot0 {
  sqrtPriceX96: bigint;               // Current sqrt price (Q96.96)
  tick: number;                        // Current tick (int24)
  observationIndex: number;            // Index of last oracle observation
  observationCardinality: number;      // Current max number of observations
  observationCardinalityNext: number;  // Next max number of observations
  feeProtocol: number;                 // Protocol fee config
  unlocked: boolean;                   // Pool reentrancy lock
}

/**
 * Decode the return value of slot0()
 */
export function decodeSlot0Result(hexData: string): PoolSlot0 | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 224) return null; // 7 fields × 32 bytes

    return {
      sqrtPriceX96:               decodeBigUint(bytes, 0),
      tick:                        Number(decodeInt256(bytes, 32)),
      observationIndex:            Number(decodeBigUint(bytes, 64)),
      observationCardinality:      Number(decodeBigUint(bytes, 96)),
      observationCardinalityNext:  Number(decodeBigUint(bytes, 128)),
      feeProtocol:                 Number(decodeBigUint(bytes, 160)),
      unlocked:                    decodeBigUint(bytes, 192) !== 0n,
    };
  } catch {
    return null;
  }
}

// ── liquidity() — Pool Contract ─────────────────────────────────────

/**
 * Encode UniswapV3Pool.liquidity() — no arguments
 *
 * Selector: 0x1a686502
 *
 * Returns the pool's current in-range liquidity (uint128).
 */
export function encodeLiquidity(): Uint8Array {
  return new Uint8Array([0x1a, 0x68, 0x65, 0x02]);
}

/**
 * Decode the return value of liquidity() → uint128
 */
export function decodeLiquidityResult(hexData: string): bigint | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 32) return null;
    return decodeBigUint(bytes, 0);
  } catch {
    return null;
  }
}

// ── mintFee() — V2 Factory Contract ─────────────────────────────────

/**
 * Encode SaucerSwapV2Factory.mintFee() — no arguments
 *
 * Selector: 0x13966db5
 *
 * SaucerSwap-specific function on the V2 Factory contract.
 * Returns the fee (in USD tinycents) for creating a new liquidity
 * position or adding to an existing one.
 *
 * NOTE: This selector is SaucerSwap-specific (not standard Uniswap V3).
 * Verified against the SaucerSwap V2 Factory contract ABI.
 */
export function encodeMintFee(): Uint8Array {
  return new Uint8Array([0x13, 0x96, 0x6d, 0xb5]);
}

/**
 * Decode the return value of mintFee() → uint256 (tinycent amount)
 */
export function decodeMintFeeResult(hexData: string): bigint | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 32) return null;
    return decodeBigUint(bytes, 0);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MULTICALL RESULT DECODING — Extract Individual Results
// ═══════════════════════════════════════════════════════════════════════

/**
 * Decode the return value of multicall(bytes[] data) → bytes[] results
 *
 * The multicall return is an array of bytes, one per input call.
 * Each element contains the raw ABI-encoded return data of that call.
 *
 * Layout (standard dynamic array of dynamic elements):
 *   [0]  offset to array data (0x20)
 *   [1]  array length
 *   [2+] offsets to each bytes element
 *   [N+] length + padded data for each element
 *
 * @param hexData - Raw hex return data from the multicall
 * @returns Array of hex strings (one per subcall result), or null on failure
 */
export function decodeMulticallResult(hexData: string): string[] | null {
  try {
    const bytes = hexToBytes(hexData);
    if (bytes.length < 64) return null;

    // First word: offset to array data (should be 0x20 = 32)
    const arrayDataOffset = Number(decodeBigUint(bytes, 0));

    // Read array length
    const arrayLen = Number(decodeBigUint(bytes, arrayDataOffset));
    if (arrayLen <= 0 || arrayLen > 20) return null; // Sanity: max 20 subcalls

    const results: string[] = [];
    const offsetsBase = arrayDataOffset + 32; // Where element offsets start

    for (let i = 0; i < arrayLen; i++) {
      // Read the offset for this element (relative to array data start)
      const elemOffset = Number(decodeBigUint(bytes, offsetsBase + i * 32));
      const elemAbsOffset = arrayDataOffset + 32 + elemOffset;

      // Read the bytes length
      const elemLen = Number(decodeBigUint(bytes, elemAbsOffset));

      // Extract the raw bytes
      const elemData = bytes.slice(elemAbsOffset + 32, elemAbsOffset + 32 + elemLen);
      results.push(bytesToHex(elemData));
    }

    return results;
  } catch {
    return null;
  }
}
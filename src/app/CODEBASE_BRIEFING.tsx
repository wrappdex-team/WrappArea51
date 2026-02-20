// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  WRAPpDEX — CODEBASE ARCHITECTURE BRIEFING                             ║
// ║  For external AI review (Grok / Claude / etc.)                         ║
// ║  Generated: 2026-02-20                                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// HOW TO USE THIS FILE:
//   Copy-paste this entire file into a Grok conversation. It contains
//   the critical architecture files concatenated with separators.
//   Ask Grok to review the security model, AMM math, signing flow, etc.
//
// ── PROJECT OVERVIEW ─────────────────────────────────────────────────────
//
// WRAPpDEX is a crypto DEX on Hedera using:
//   - Frontend: React + Vite + Tailwind CSS v4
//   - Backend: Supabase Edge Functions (Deno + Hono)
//   - Auth: ED25519 challenge-response via HashPack / WalletConnect
//   - AMM: Hedera-native atomic CryptoTransfer (constant-product x*y=k)
//
// Trust Model:
//   - Users trust MATH (constant product, open source, auditable)
//   - Users trust HEDERA (atomic CryptoTransfer, consensus-guaranteed)
//   - Users trust the SIGNING ORACLE to hold pool keys honestly (Phase 1)
//   - Users do NOT trust the server for computation or state
//
// Decentralization Roadmap:
//   Phase 1: Server holds pool account keys (signing oracle pattern) [CURRENT]
//   Phase 2: Threshold keys (2-of-3 DAO multisig on pool accounts)
//   Phase 3: Hedera account abstraction (HIP-206) — fully trustless
//
// Sign-Swap Flow (atomic-signer.ts):
//   auth -> rate limits -> validateSwap (SEC-07 math)
//   -> validateSwapTransactionContents (SEC-14 body check)
//   -> isTransactionReplay (SEC-15 dedup)
//   -> signTransactionWithPoolKey (SEC-13 type gate + sign)
//   -> recordSignedTransaction (SEC-15 mark)
//
// Audit Comment Index:
//   SEC-01..SEC-15  — Security annotations
//   PERF-01..PERF-06 — Performance notes
//   LEGACY-01..LEGACY-09 — Legacy compat markers
//   SHARED-01 — Shared math module note
//   ATOMIC-01..ATOMIC-10 — Atomic swap architecture notes
//
// Key Files (included below):
//   1. amm-math-shared.ts      — Single source of truth for AMM math (server)
//   2. atomic-swap-types.ts    — Shared type definitions (client)
//   3. atomic-swap-engine.ts   — Client-side AMM engine (math + tx building)
//   4. atomic-swap-client.ts   — Client<->server orchestration
//   5. atomic-signer.ts        — Server-side signing oracle (~1483 lines)
//   6. routes.tsx               — React Router route map
//   7. index.tsx (server)       — Hono server entry + middleware
//   8. amm-math.test.ts        — Test file header (14 suites, ~120+ steps)
//   9. TradingSwapPanel.tsx     — Swap UI (key state/status section)
//
// Files NOT included (too large, less critical for arch review):
//   - Landing page components (15 files in /src/app/components/landing/)
//   - Layout.tsx, Dashboard.tsx, DAO.tsx, WhitePaper.tsx, etc.
//   - auth.ts, shared.ts, vip.ts, spin.ts (server modules)
//   - hashpack.ts, hedera.ts (wallet integration utils)
//
// 4 Orphaned Components (flagged, NOT deleted pending owner confirmation):
//   - CrossChainExchange.tsx, FiatTopUp.tsx, TransactionDiagnoser.tsx, SmartLiquidity.tsx
//
// ═══════════════════════════════════════════════════════════════════════════
//
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  FILE 1/9: /supabase/functions/server/amm-math-shared.ts               │
// │  Single source of truth — 12 exported pure functions + 6 constants     │
// │  Zero deps. Imported by atomic-signer.ts, amm.ts, amm-math.test.ts    │
// └─────────────────────────────────────────────────────────────────────────┘

// ══════════════════════════════════════════════════════════════════════
// AMM Math — Shared Pure Functions (Constant-Product x * y = k)
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
// SENIOR DEV NOTE [SHARED-01]:
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


// ┌─────────────────────────────────────────────────────────────────────────┐
// │  FILE 2/9: /src/app/utils/atomic-swap-types.ts                         │
// │  Shared type definitions for the atomic swap system                    │
// │  ~332 lines — interfaces for tokens, pools, quotes, requests, fees     │
// └─────────────────────────────────────────────────────────────────────────┘

// [FULL FILE — see atomic-swap-types.ts in the codebase]
// Key types:
//   AtomicTokenDef       — HTS token definition (id, symbol, decimals, tier, bridge)
//   PoolAccountDef       — Pool = real Hedera account holding both tokens
//   PoolReserves         — On-chain reserve state from Mirror Node
//   AtomicSwapQuote      — Full swap quote with routing, fees, slippage
//   AtomicSwapRequest    — Swap request payload
//   AtomicSwapResult     — Swap result with txId, hashScan URL
//   SignSwapRequest      — Server co-sign request (frozen TX bytes + metadata)
//   SignSwapResponse     — Server response (pool-signed TX bytes)
//   SwapFeeBreakdown     — Detailed fee breakdown for UI
//   PoolMetrics          — TVL, reserves, health data
//   AddLiquidityRequest/Result, RemoveLiquidityRequest/Result
//   AtomicSwapErrorCode  — 13 granular error codes
//
// Key audit comments in types:
//   ATOMIC-01: Phase 1/2/3 decentralization roadmap
//   ATOMIC-02: Reserves NEVER cached for swap math
//   SEC-03: Server NEVER trusts client-supplied amounts
//   SEC-05: TX bytes built CLIENT-SIDE (user sees full TX in wallet)


// ┌─────────────────────────────────────────────────────────────────────────┐
// │  FILE 3/9: /src/app/utils/atomic-swap-engine.ts                        │
// │  Client-side AMM engine — math, Mirror Node reads, TX building         │
// │  ~1281 lines — 10 sections                                             │
// └─────────────────────────────────────────────────────────────────────────┘

// [KEY SECTIONS — see atomic-swap-engine.ts in the codebase]
//
// SECTION 1: Constants & Configuration
//   - TOTAL_SWAP_FEE_BPS = 25, LP_FEE_BPS = 20, PROTOCOL_FEE_BPS = 5
//   - PROTOCOL_FEE_USD = 0.0007, MAX_PROTOCOL_FEE_TINYBAR = 500_000
//   - maxSwapFraction(): depth-proportional caps (2%/5%/10% of TVL)
//   - DEFAULT_SLIPPAGE_BPS = 50 (0.5%)
//
// SECTION 2: Token Whitelist (13 tokens)
//   WHBAR, USDC, USDT, DAI, USDCh, USDTh, WBTC, WETH, LINK, AAVE, WBNB, WAVAX, WMATIC
//   - Tier 1 (routing hub eligible) vs Tier 2 (available but not hub)
//   - SaucerSwap alias map for oracle resolution
//
// SECTION 3: Pool Registry (8 pools, all PENDING deployment)
//   ap-usdc-whbar, ap-usdt-whbar, ap-usdc-usdt, ap-wbtc-whbar,
//   ap-weth-whbar, ap-weth-usdc, ap-link-whbar, ap-dai-usdc
//   ATOMIC-04: Deployment requires Hedera account + token assoc + LP token + initial liquidity
//
// SECTION 4: AMM Math (identical to amm-math-shared.ts)
//   bigIntSqrt, decimalToBigInt, bigIntToDecimal, getAmountOut, getAmountIn,
//   getPriceImpactBps, getSpotPrice, computeLPSharesMint, computeLPSharesBurn,
//   computeOptimalDeposit
//
// SECTION 5: Mirror Node Integration
//   fetchAccountTokenBalance() — raw HTS token balance from Mirror Node
//   fetchTokenTotalSupply() — LP token supply
//   fetchPoolReserves() — on-chain ground truth (ATOMIC-05: verifiable by anyone)
//   fetchAllPoolReserves() — parallel fetch for all active pools
//
// SECTION 6: Oracle Price Fetching (display only)
//   fetchOraclePrices() — SaucerSwap API -> Hedera Network Exchange Rate -> fallback
//   PERF-02: Oracle deviation defense (50% volatile, 10% stablecoins)
//
// SECTION 7: Swap Quoting
//   getSwapQuote() — direct routes + multi-hop (A -> HUB -> B)
//   Routing hubs: USDC, WHBAR
//   TVL-based depth caps via maxSwapFraction()
//
// SECTION 8: Transaction Building
//   ATOMIC-06: TX built CLIENT-SIDE, sent to server for pool-side co-sign
//   ATOMIC-10: Long.fromString() precision fix (was Number() — silent truncation)
//   buildSwapTransaction() — 2-leg CryptoTransfer (user->pool, pool->user)
//   buildAddLiquidityTransaction() — 3-leg (user->pool A, user->pool B, pool->user LP)
//   buildRemoveLiquidityTransaction() — 3-leg (user->pool LP, pool->user A, pool->user B)
//   All use `const toLong = (v: bigint) => Long.fromString(v.toString());`
//
// SECTION 9: Pool Metrics (TVL, health)
// SECTION 10: Utility / Helpers


// ┌─────────────────────────────────────────────────────────────────────────┐
// │  FILE 4/9: /src/app/utils/atomic-swap-client.ts                        │
// │  End-to-end swap orchestration — client<->server<->wallet              │
// │  ~585 lines — full lifecycle management                                │
// └─────────────────────────────────────────────────────────────────────────┘

// [KEY ARCHITECTURE — see atomic-swap-client.ts in the codebase]
//
// ATOMIC-07: Trust model
//   Users trust MATH (constant product), HEDERA (atomic CryptoTransfer),
//   and the SIGNING ORACLE (Phase 1 only).
//
// ATOMIC-08: Error handling — every step can fail independently
//   Build failure -> error before any signing
//   Server rejection -> error before wallet interaction
//   Wallet rejection -> user cancelled, no on-chain effect
//   Network failure -> transaction expired, no partial execution
//
// SEC-05: TX bytes built client-side — server cannot inject malicious transfers
// SEC-06: Server re-reads reserves independently, recomputes output
//
// executeAtomicSwap() lifecycle:
//   Step 0: Validate inputs (pool exists, tokens valid)
//   Step 1: buildSwapTransaction() -> frozen TX bytes
//   Step 2: requestServerCoSign() -> server validates + co-signs
//   Step 3: sendHederaTransaction() -> wallet signs + submits
//   Step 4: Poll receipt -> success/failure
//
// addLiquidity() / removeLiquidity() — same pattern with 3-leg TXs
//
// requestServerCoSign() — POST /atomic/sign-swap
//   Headers: Authorization (publicAnonKey), X-Session-Token (ED25519 session)
//   Body: SignSwapRequest (frozen TX bytes + metadata)
//   Timeout: 15s
//
// Re-exports: getSwapQuote, getSystemStatus, getAllPools, etc.


// ┌─────────────────────────────────────────────────────────────────────────┐
// │  FILE 5/9: /supabase/functions/server/atomic-signer.ts                 │
// │  Hedera-native CryptoTransfer co-signing oracle                        │
// │  ~1483 lines — the security-critical server module                     │
// └─────────────────────────────────────────────────────────────────────────┘

// ══════════════════════════════════════════════════════════════════════
// ATOMIC SIGNER — Hedera-Native CryptoTransfer Co-Signing Oracle
// ══════════════════════════════════════════════════════════════════════
//
// This module is the WRAPpDEX signing oracle:
//   - It does NOT hold pool state (reserves are on-chain token balances)
//   - It does NOT compute swap amounts for clients (clients compute locally)
//   - It VALIDATES swap math independently (re-reads reserves, recomputes)
//   - It CO-SIGNS the pool account's side of atomic CryptoTransfers
//
// Trust model:
//   Phase 1: Server holds pool account private keys (signing oracle)
//   Phase 2: Threshold keys (2-of-3 multisig on pool accounts)
//   Phase 3: Hedera account abstraction (HIP-206) for on-chain AMM rules
//
// SENIOR DEV NOTE [ATOMIC-09]:
//   The server's ONLY power is deciding whether to co-sign. It cannot:
//     - Steal user funds (user sees full TX in wallet before signing)
//     - Forge transactions (user must also sign; 2-of-2 requirement)
//     - Manipulate amounts (independent reserve read + math validation)
//   The server CAN refuse to sign (DoS), which is the Phase 1 trust
//   assumption. Phase 2 threshold keys eliminate this risk.
//
// SEC-07: Every co-sign request triggers an independent Mirror Node read.
//   The server NEVER trusts client-supplied reserve values or amounts.
//   Math tolerance: 1 raw unit (BigInt rounding). Anything larger = reject.
//
// SEC-08: Pool private keys are read from environment variables at startup.
//   They are NEVER logged, NEVER returned in API responses, NEVER included
//   in error messages. Key material exists only in memory. Key fingerprint
//   (SHA-256 prefix) is logged on first use for rotation audit trail.
//
// SEC-13: TX type gate — signTransactionWithPoolKey rejects non-CryptoTransfer
//   (TransferTransaction) TXs. Prevents the pool key from co-signing
//   unauthorized operations (CryptoUpdate, TokenUpdate, ContractCall, etc.).
//
// SEC-14: TX content validation — before co-signing, the server deserializes
//   the TX and verifies the token transfer list matches the expected swap:
//   exact token IDs, exact amounts, exact accounts (user + pool only), no
//   hidden transfers to third-party accounts.
//
// SEC-15: Replay protection — signed TX ID deduplication via KV.
//   Hedera TX IDs are unique (payer@validStart), but a co-signed TX that
//   hasn't been submitted yet could be captured and replayed within its
//   validity window. By recording co-signed TX IDs in KV, we guarantee
//   each TX is signed at most once.
//
// PERF-06: In-memory reserve cache for public read endpoints.
//   5s TTL — stale reserves in read endpoints are acceptable (display only).
//   NEVER used for signing validation (SEC-07 requires fresh Mirror Node reads).
// ══════════════════════════════════════════════════════════════════════

// ── Imports ──────────────────────────────────────────────────────────
// import { Hono } from "npm:hono@4.6.3";
// import * as kv from "./kv_store.tsx";
// import { getClientIp, isRateLimited, ... } from "./shared.ts";
// import { requireAuth, requireOwner, logAdminAction } from "./auth.ts";
// import { getAmountOut, TOTAL_SWAP_FEE_BPS, BPS_BASE } from "./amm-math-shared.ts";  // SHARED-01

// ── Constants ────────────────────────────────────────────────────────
// MIRROR_TIMEOUT_MS = 10_000
// SIGNED_TX_PREFIX = "atomic_stx_"
// TX_VALID_START_MAX_DRIFT_MS = 180_000 (180s — matches Hedera TX validity)
// SIGNED_TX_EXPIRY_MS = 300_000 (5 min — outlives Hedera's validity window)

// ── Kill Switch ──────────────────────────────────────────────────────
// isAmmKilled() — checks KV with 5s cache, fails CLOSED on KV unreachable

// ── Token Whitelist (13 tokens, must match client) ───────────────────
// Same 13 tokens as atomic-swap-engine.ts

// ── Pool Registry (8 pools, must match client) ───────────────────────
// Same 8 pools + envKeyName for each pool's private key env var
// e.g., POOL_KEY_AP_USDC_WHBAR

// ── Mirror Node Reserve Reading ──────────────────────────────────────
// fetchPoolReserves() — independent of client, uses circuit breaker
// fetchPoolReservesCached() — PERF-06: 5s TTL, NEVER for signing

// ── Pool Key Management (SEC-08) ─────────────────────────────────────
// signTransactionWithPoolKey():
//   1. Read key from env var (never cached in plain text)
//   2. SEC-08: Log SHA-256 fingerprint prefix on first use
//   3. SEC-13: TX type gate — ONLY TransferTransaction allowed
//   4. Sign with ED25519 pool key
//   5. Return signed bytes

// ── TX Content Validation (SEC-14) ───────────────────────────────────
// validateSwapTransactionContents():
//   1. Deserialize TX from bytes
//   2. SEC-13: Verify instanceof TransferTransaction
//   3. Extract TX ID, verify validStart within drift window
//   4. Parse _tokenTransfers (SDK internals, fail CLOSED if structure changes)
//   5. Verify no unexpected HBAR transfers
//   6. Verify exactly 2 token transfer groups
//   7. Match groups to expected tokenIn/tokenOut IDs
//   8. Verify tokenIn: user=-X, pool=+X (exact amounts)
//   9. Verify tokenOut: pool=-Y, user=+Y (exact amounts)
//   10. Return { valid: true, transactionIdStr }

// ── Replay Protection (SEC-15) ───────────────────────────────────────
// isTransactionReplay() — check KV for existing co-signed TX ID
// recordSignedTransaction() — store in KV (non-blocking)

// ── Swap Validation (SEC-07) ─────────────────────────────────────────
// validateSwap():
//   1. Pool exists, active, not PENDING
//   2. Tokens valid, belong to pool
//   3. Amount is valid positive BigInt string
//   4. Read reserves from Mirror Node (independent of client)
//   5. Recompute expected output with getAmountOut()
//   5b. Explicit k-invariant assertion (SEC-09): kAfter >= kBefore
//   6. Client output <= server output + 1n tolerance
//   7. Kill switch not active

// ── Rate Limiting ────────────────────────────────────────────────────
// isSignRateLimited() — KV-backed: 5 co-sign requests per 10s per account
// Plus per-IP and per-account rate limits from shared.ts

// ── Route Registration ───────────────────────────────────────────────
// registerAtomicSignerRoutes(app):
//
//   POST /atomic/sign-swap
//     Auth -> IP rate limit -> account rate limit -> kill switch
//     -> validateSwap (SEC-07) -> decode TX bytes
//     -> validateSwapTransactionContents (SEC-14)
//     -> isTransactionReplay (SEC-15)
//     -> signTransactionWithPoolKey (SEC-13 + SEC-08)
//     -> recordSignedTransaction (SEC-15)
//     -> return { signedTransactionBytes, serverAmountOutRaw, serverReserves }
//
//   POST /atomic/sign-liquidity
//     Auth -> rate limits -> validateLiquidity
//     -> kill switch (blocks add, allows remove)
//     -> signTransactionWithPoolKey -> return signed bytes
//
//   GET /atomic/pools — public, pool registry with deployment status
//   GET /atomic/pools/:poolId/reserves — public, live reserves (PERF-06 cached)
//   GET /atomic/status — public, system status + decentralization roadmap
//   GET /atomic/tokens — public, supported token whitelist
//
//   POST /atomic/admin/kill-switch — owner-only, activate/deactivate
//   GET /atomic/admin/kill-switch — owner-only, read state
//
//   Backward-compat shims:
//   GET /amm/kill-switch — proxies to same KV key
//   POST /amm/kill — owner-only halt
//   POST /amm/resume — owner-only resume


// ┌─────────────────────────────────────────────────────────────────────────┐
// │  FILE 6/9: /src/app/routes.tsx                                         │
// │  React Router route map — landing page + DEX app                       │
// └─────────────────────────────────────────────────────────────────────────┘

// /                -> Institutional landing page (no DEX chrome)
// /markets         -> DEX Dashboard (default DEX entry)
// /trading         -> Trading terminal
// /trading/:symbol -> Trading terminal (specific token)
// /swap            -> Token swap
// /buy-sell        -> Fiat on/off ramp
// /wallet          -> Portfolio & wallet
// /dao             -> Governance
// /bridges         -> Cross-chain
// /defi            -> DeFi hub
// /audit           -> Security reports
// /white-paper     -> Wrapp Paper
// /branding        -> Brand identity
// /terms           -> Terms of Service
// /privacy         -> Privacy Policy
// /smart-liquidity -> Redirect to /trading (legacy)
//
// All DEX routes share Layout chrome (sidebar, header, wallet connection)
// Landing page renders standalone with its own 15 components
// All route components are lazy-loaded with retry logic for chunk failures


// ┌─────────────────────────────────────────────────────────────────────────┐
// │  FILE 7/9: /supabase/functions/server/index.tsx                        │
// │  Hono server entry — route orchestrator + middleware                    │
// └─────────────────────────────────────────────────────────────────────────┘

// Modules registered:
//   Auth, VIP, Spin Wheel, News, Atomic Signer, VIP Chat, DAO, Storage,
//   Health, 1inch, SaucerSwap Pools
//
// Middleware stack:
//   1. logger(console.log)
//   2. Open CORS (access control is via ED25519 session tokens, not CORS)
//      SEC-01/SEC-02: X-Account-Id listed for compat but IGNORED by server
//   3. Request body size limit: 512 KB max
//   4. Security response headers:
//      X-Content-Type-Options: nosniff
//      X-Frame-Options: DENY
//      Referrer-Policy: strict-origin-when-cross-origin
//      X-XSS-Protection: 0
//      Strict-Transport-Security: max-age=31536000; includeSubDomains
//      Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
//      Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
//
// Entry: Deno.serve(app.fetch)


// ┌─────────────────────────────────────────────────────────────────────────┐
// │  FILE 8/9: /supabase/functions/server/amm-math.test.ts                 │
// │  Unit tests — 14 suites, ~120+ test steps                              │
// │  Run: deno test supabase/functions/server/amm-math.test.ts             │
// └─────────────────────────────────────────────────────────────────────────┘

// Test suites:
//   1.  getAmountOut          — zero/negative guards, hand-calculated values, fee behavior
//   2.  decimalToBigInt       — string parsing, IEEE 754 safety
//   3.  bigIntSqrt            — Newton's method correctness
//   4.  getPriceImpactBps     — impact estimation
//   5.  Fee invariants        — 0.25% total, 0.20% LP / 0.05% protocol split
//   6.  Protocol micro-fee    — $0.0007 flat per swap, tinybar cap
//   7.  k-invariant           — algebraic proof: fees increase pool depth
//   8.  Swap round-trips      — property-based tests across pool configs
//   9.  getAmountIn           — inverse swap formula
//  10.  bigIntToDecimal       — raw -> display string
//  11.  getSpotPrice          — reserve ratio computation
//  12.  computeLPSharesMint   — first deposit + proportional
//  13.  computeLPSharesBurn   — pro-rata withdrawal
//  14.  computeOptimalDeposit — proportional deposit helper
//  15.  Protocol fee accum    — per-pool tracking + extraction safety
//
// Imports from both amm.ts (re-exports) and amm-math-shared.ts directly
// SHARED-01: Validates server-side math matches client-side engine


// ┌─────────────────────────────────────────────────────────────────────────┐
// │  FILE 9/9: /src/app/components/TradingSwapPanel.tsx                    │
// │  Main swap UI — kill switch, oracle status, pool liveness              │
// │  Key state/status section only (full file is ~600+ lines)              │
// └─────────────────────────────────────────────────────────────────────────┘

// State flags:
//   ammHalted: boolean       — kill switch active (red banner, PowerOff icon)
//   ammPrelaunch: boolean    — pre-launch lock (replaces swap body with AmmPrelaunchBanner)
//   oracleStale: boolean     — /atomic/status unreachable (amber banner, WifiOff icon)
//   executeSupported: boolean — at least one pool live + oracle healthy
//
// Parallel-fetch polling (30s interval):
//   /amm/kill-switch   -> ammHalted, ammPrelaunch
//   /atomic/status     -> oracleStale, executeSupported
//
// isSwapDisabled = !quote || !accountId || swapping || success || ammHalted || oracleStale || !executeSupported
//
// Header status dot:
//   oracleStale -> amber pulse "Stale"
//   ammHalted   -> red "Halted"
//   quote       -> green pulse "Live"
//   default     -> gray "Ready"
//
// Banner priority:
//   1. ammPrelaunch -> AmmPrelaunchBanner (replaces entire body)
//   2. ammHalted -> red "AMM Trading Halted" banner
//   3. oracleStale && !ammHalted -> amber "Oracle Unreachable" banner
//   4. !executeSupported && !oracleStale && !ammHalted -> blue "Pools Deploying" banner
//
// ATOMIC-10 context: Transaction building uses Long.fromString() via toLong helper
// in atomic-swap-engine.ts to prevent Number() silent precision truncation on
// amounts exceeding Number.MAX_SAFE_INTEGER (relevant for 18-decimal WETH).


// ┌─────────────────────────────────────────────────────────────────────────┐
// │  REMAINING OPEN ITEMS                                                  │
// └─────────────────────────────────────────────────────────────────────────┘
//
// 1. _redirects directory launch blocker (Vite SPA routing for production)
// 2. Discord invite link: VERIFIED -> https://discord.com/invite/ZFnfRFxQZ
//    (all 9 refs across 7 files now use correct invite code ZFnfRFxQZ)
// 3. Sync bigIntToDisplaySafe into atomic-swap-engine.ts's bigIntToDecimal()
// 4. Four orphaned components awaiting owner deletion confirmation:
//    - CrossChainExchange.tsx, FiatTopUp.tsx, TransactionDiagnoser.tsx, SmartLiquidity.tsx
// 5. Full go-live checklist (Hedera account deployment, initial liquidity, etc.)

export {};

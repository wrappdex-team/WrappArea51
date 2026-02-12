# Wrappdex (HBAR.h) — CertK Security Audit v2

**Audit Date:** 2026-02-12
**Protocol:** Wrappdex Smart Liquidity AMM Engine v2
**Scope:** Full-stack (Hono server + React frontend + HSuite/Stargate integrations)
**Auditor:** CertK Web3 Security — High-Intensity Assessment
**Severity Scale:** CRITICAL > HIGH > MEDIUM > LOW > INFO
**Status:** 4 Critical, 3 High, 6 Medium, 5 Low, 13 Informational findings

---

## Executive Summary

The Wrappdex AMM engine implements a standard constant-product (x*y=k) market maker with KV-backed state, BigInt integer arithmetic, first-depositor attack mitigation, depth-proportional rate limits, and a dual-layer fee system (0.1% pool fee + $0.0007 protocol fee). The codebase demonstrates strong security awareness with embedded audit tags (LP-01 through LP-12) and proper CSPRNG usage throughout. However, this audit identified **4 critical issues** that must be resolved before mainnet deployment, primarily around unauthenticated state mutation, swap atomicity, and cross-chain selector verification.

---

## Section 1 — Critical Findings

### AUDIT-AMM-01 | CRITICAL | Unauthenticated LP Position Mutation

**File:** `/supabase/functions/server/index.tsx` lines 837-873
**Affected Routes:** `POST /pools/liquidity/remove`, `POST /pools/swap`

The `removeLiquidity` endpoint accepts `accountId` as a plain string in the request body with no cryptographic proof of ownership. Any caller who knows (or guesses) another user's Hedera account ID can burn their LP shares and withdraw their proportional reserves.

```
// Current: accountId is trusted from request body — NO SIGNATURE CHECK
const { poolId, shares, accountId } = body;
const position = await getLPPosition(poolId, accountId);
// ...attacker passes victim's accountId, burns their shares
```

**Impact:** Complete LP position theft. Hedera account IDs are public (visible on HashScan), so this is trivially exploitable.

**Remediation:** Require HSuite SmartNode or HashConnect-signed proof of account ownership. At minimum, require the user to sign a challenge nonce with their ED25519 key and verify server-side via Mirror Node public key lookup:
```
GET https://mainnet-public.mirrornode.hedera.com/api/v1/accounts/{accountId}
→ response.key.key (ED25519 public key)
→ verify signature against challenge nonce
```

---

### AUDIT-AMM-02 | CRITICAL | TOCTOU Race Condition in Swap Reserve Updates

**File:** `/supabase/functions/server/index.tsx` lines 1009-1093
**Affected Route:** `POST /pools/swap`

The swap execution follows a read-compute-write pattern with no locking:

```
Step 1: const pool = await getPool(poolId);        // READ reserves
Step 2: const rawOut = getAmountOut(rawIn, rIn, rOut, pool.swapFeeBps);  // COMPUTE
Step 3: pool.reserveA = (resA + rawIn).toString();  // WRITE new reserves
        await savePool(pool);
```

Two concurrent swaps against the same pool will both read identical reserves at Step 1, both compute full output at Step 2, and both write independently at Step 3. The second write overwrites the first, resulting in **more tokens leaving the pool than reserves allow**.

**Impact:** Pool draining via concurrent request flooding. An attacker sending 50 simultaneous swap requests could extract multiples of the actual reserve.

**Remediation:** Implement optimistic locking with a version counter:
```typescript
interface PoolState {
  // ...existing fields
  version: number;  // incremented on every write
}

// In swap handler:
const pool = await getPool(poolId);
const expectedVersion = pool.version;
// ...compute swap...
pool.version = expectedVersion + 1;
const success = await compareAndSwapPool(pool, expectedVersion);
if (!success) return c.json({ error: "Pool state changed, retry" }, 409);
```

Or use KV atomic operations if available, or a distributed lock via a separate KV key.

---

### AUDIT-AMM-03 | CRITICAL | Slippage Protection Disabled by Default

**File:** `/src/app/components/SmartLiquidity.tsx` line 81
**File:** `/supabase/functions/server/index.tsx` line 1041

The frontend sends `undefined` as `minAmountOutRaw`:
```typescript
// Frontend — no slippage protection sent
const result = await executeSwap(accountId, quote.poolId, quote.tokenIn, 
  quote.tokenOut, quote.amountInRaw, undefined);  // ← always undefined
```

The server treats missing `minAmountOutRaw` as no-check:
```typescript
if (minAmountOutRaw && rawOut < BigInt(minAmountOutRaw)) 
  return c.json({ error: "Slippage exceeded" }, 400);
// ← if minAmountOutRaw is undefined, this check never runs
```

Combined with AUDIT-AMM-02, this means users have zero slippage protection.

**Impact:** Users can receive arbitrarily bad exchange rates. In production with HSuite on-chain execution, this enables classic sandwich attacks.

**Remediation:** Frontend must compute and send `minAmountOutRaw`:
```typescript
const minOut = BigInt(quote.amountOutRaw) * 995n / 1000n; // 0.5% slippage
const result = await executeSwap(accountId, quote.poolId, quote.tokenIn, 
  quote.tokenOut, quote.amountInRaw, minOut.toString());
```

---

### AUDIT-B01 | CRITICAL | Stargate Function Selector Collision (Unchanged)

**File:** `/src/app/utils/stargate.ts` lines 109-110

```typescript
const SEL_QUOTE_SEND = "0xc7c7f5b3"; // quoteSend(SendParam,bool)
const SEL_SEND       = "0xc7c7f5b3"; // IDENTICAL — guaranteed wrong
```

Both `quoteSend` and `send` cannot have the same 4-byte selector. One will call the wrong function on Stargate V2's Router contract, potentially sending funds without a quote or quoting without sending.

**Action Required:** Verify against Etherscan for Stargate V2 USDC pool (`0xc026395860Db2d07ee33e05fE50ed7bD583189C7`). Re-derive selectors from the actual ABI.

---

## Section 2 — High Findings

### AUDIT-AMM-04 | HIGH | Swap History Endpoint Unbounded Scan

**File:** `/supabase/functions/server/index.tsx` lines 1095-1107

```typescript
const allSwaps: any[] = await kv.getByPrefix(SWAP_LOG_PREFIX);
const userSwaps = allSwaps.filter((s: any) => s?.accountId === accountId)
  .sort(...).slice(0, 50);
```

`getByPrefix("sl_swap_")` fetches ALL swap records ever created, then filters in-memory. After 10,000 swaps, this scans the entire swap log on every call. At 100,000 swaps, this becomes a DoS vector — each request forces a full KV scan.

**Impact:** Denial of service at scale. Memory exhaustion on edge function.

**Remediation:** Store per-user swap indexes: `sl_swaps_user_{accountId}` containing an array of swap keys. Query only the user's index.

---

### AUDIT-D01 | HIGH | DAO Proposals in localStorage (Unchanged)

All proposals, votes, and comments are client-side in `localStorage` — fully manipulable. Any user can inject fake proposals, forge votes, or delete governance records via browser DevTools.

**Remediation:** Migrate to server-side KV with Mirror Node balance verification for vote weighting, server-side vote deduplication, and admin-only proposal CRUD.

---

### AUDIT-F06 | HIGH | Bonzo Token Approval Flow Missing (Unchanged)

Before `deposit()` or `repay()`, the UI must check HTS token allowance via Mirror Node and prompt for approval via `@hashgraph/sdk` + HashConnect signing. Without this, transactions will fail silently on-chain.

---

## Section 3 — Medium Findings

### AUDIT-AMM-05 | MEDIUM | Oracle Manipulation Affects Depth Limits

**File:** `/supabase/functions/server/index.tsx` lines 926-929

TVL-based depth limits use oracle prices:
```typescript
const tvl = poolTvlUsd(pool, prices);
if (tvl > 0 && tvl < 100) continue; // [LP-10]
const inputUsd = parseFloat(amountIn) * (prices[defIn.tokenId] || 0);
if (tvl > 0 && inputUsd > tvl * maxSwapFraction(tvl)) continue; // [LP-03]
```

If SaucerSwap API returns inflated prices, TVL appears higher, allowing larger swaps. If prices are deflated, legitimate swaps get rejected. The swap math itself (constant-product on real reserves) is unaffected, but the guardrail is bypassable.

**Impact:** Depth limit bypass allows larger-than-intended swaps, amplifying price impact.

**Remediation:** Add TWAP (time-weighted average price) comparison — reject oracle updates that deviate >20% from the previous cached value within a single cache period.

---

### AUDIT-AMM-06 | MEDIUM | No K-Invariant Verification Post-Swap

**File:** `/supabase/functions/server/index.tsx` lines 1054-1060

After updating reserves, there is no assertion that `k_new >= k_old`. While the constant-product formula mathematically guarantees this, a bug in the BigInt arithmetic or a future code change could silently violate the invariant.

**Remediation:** Add a post-swap assertion:
```typescript
const kOld = resA * resB;
// ...update reserves...
const kNew = BigInt(pool.reserveA) * BigInt(pool.reserveB);
if (kNew < kOld) throw new Error("K-invariant violated — swap aborted");
```

---

### AUDIT-AMM-07 | MEDIUM | Multi-Hop Swap Quotes Without Execution Support

**File:** `/supabase/functions/server/index.tsx` lines 936-963 vs 1018-1021

The quote engine computes USDC-hop routes and returns them to the frontend, but the swap executor explicitly rejects multi-hop:
```typescript
if ((poolId || "").includes("+")) {
  return c.json({ error: "Multi-hop execution requires HSuite SmartNode" }, 501);
}
```

Users see a quoted price for a multi-hop route, attempt to swap, and get a 501 error. This is a UX failure, not a security vulnerability, but it creates trust issues.

**Remediation:** Either filter multi-hop routes from quotes until execution is supported, or clearly label them as "preview only" in the UI.

---

### AUDIT-AMM-08 | MEDIUM | Pool Index Array Grows Unbounded

**File:** `/supabase/functions/server/index.tsx` lines 747-772

The pool index (`sl_pool_index`) is a flat array of pool IDs. Every created pool appends to it, and every pool listing iterates the full array. Deleted/paused pools are never removed from the index.

**Impact:** Performance degradation as pool count grows. At 1000+ pools, `GET /pools` fetches all pool states sequentially.

**Remediation:** Add periodic index compaction that removes paused/empty pools. Consider paginated pool listing.

---

### AUDIT-LP-06 | MEDIUM | Sandwich Attack Surface on HSuite Migration

When swaps migrate from KV-only to HSuite SmartNode on-chain execution, the current architecture provides zero MEV protection. Validators or mempool observers can front-run large swaps.

**Remediation Plan (pre-migration):**
- Commit-reveal scheme: user commits hash of swap params, reveals after 1 block
- Or: private mempool via HSuite's validator consensus (if supported)
- Or: use Flashbots-style bundle submission if available on Hedera EVM

---

### AUDIT-AMM-09 | MEDIUM | Treasury Fee Accumulation Uses JavaScript Number

**File:** `/supabase/functions/server/index.tsx` lines 1069-1076

```typescript
const updated = {
  totalTinybar: (existingFees?.totalTinybar || 0) + treasuryFeeTinybar,
  // ...
};
```

`totalTinybar` is a JavaScript `Number`, which loses precision above 2^53 (~90M HBAR). With the current ~350 tinybar/swap fee, this overflows after ~25 trillion swaps — not a realistic concern, but using BigInt/string would be consistent with the reserve handling.

---

## Section 4 — Low Findings

### AUDIT-AMM-10 | LOW | Rate Limiter L1 Cache Memory Leak

**File:** `/supabase/functions/server/index.tsx` line 64

`_rateLimitL1` is a `Map<string, ...>` that grows unbounded. Each unique IP adds an entry that is never pruned. On a long-running edge function instance, this consumes memory proportional to unique client IPs.

**Remediation:** Add TTL-based eviction or use a LRU cache with a max size of ~10,000 entries.

---

### AUDIT-AMM-11 | LOW | Oracle Fallback Prices Are Hardcoded Constants

**File:** `/supabase/functions/server/index.tsx` lines 532-538

Fallback prices (WBTC=$97,000, WETH=$3,600, LINK=$19) are compile-time constants. If the SaucerSwap API is down for an extended period, these stale prices affect TVL calculations and depth limits (but not swap math).

---

### AUDIT-AMM-12 | LOW | No Withdrawal Timelock for Large LP Removals

A single transaction can remove 100% of an LP's position instantly. For large positions (>50% of pool TVL), a timelock or staged withdrawal would prevent flash-loan-style attacks when on-chain execution is enabled.

---

### AUDIT-LP-11c | LOW | Treasury Fee Sweep Not Implemented

The treasury half of protocol fees accrues in KV (`sl_treasury_fees`) but there is no sweep mechanism to transfer accumulated HBAR to `0.0.9695738`. Fees accumulate indefinitely until a cron or admin endpoint is built.

---

### AUDIT-AMM-13 | LOW | `timeSince()` Uses Inconsistent Timestamp Units

**File:** `/src/app/utils/smart-liquidity.ts` lines 286-292

`timeSince()` divides `Date.now()` by 1000 (converting to seconds), but the server stores `timestamp: Date.now()` in milliseconds. The subtraction `Date.now()/1000 - timestamp` produces negative or wildly incorrect values if `timestamp` is in milliseconds.

---

## Section 5 — Informational (Security Controls Verified)

| Tag | Status | Description |
|---|---|---|
| LP-01 | VERIFIED | First-depositor MINIMUM_LIQUIDITY burn (1000 units) prevents share inflation attack. Burned shares exist in `lpTotalSupply` but belong to no user. |
| LP-02 | VERIFIED | Swaps use constant-product formula on real reserves. Oracle prices are display-only. |
| LP-03 | VERIFIED | Depth-proportional max trade size: 2% (<$10K TVL), 5% ($10K-$100K), 10% (>$100K). |
| LP-04 | VERIFIED | LP share dilution prevention via `min(amountA/reserveA, amountB/reserveB) * totalSupply`. |
| LP-07 | VERIFIED | Pool creation restricted to Tier 1 tokens (WBTC, WETH, USDC, USDT, LINK). |
| LP-08 | VERIFIED | All reserves stored as raw integer strings. No floating-point precision loss in AMM math. |
| LP-09 | VERIFIED | 0.1% swap fee stays in pool (increases k), accruing to all LP holders proportionally. |
| LP-10 | VERIFIED | Pools below $100 TVL excluded from routing to prevent manipulation. |
| LP-11 | VERIFIED | Protocol fee: flat $0.0007/swap in HBAR. 50% LP (implicit via k), 50% treasury (KV accrual). |
| LP-12 | VERIFIED | Swap fee FIXED at 10 bps (0.1%). `FIXED_SWAP_FEE_BPS = 10`. Server ignores client feeBps. UI shows static label, no slider. |
| SPIN | VERIFIED | CSPRNG via `crypto.getRandomValues()`, 2% uniform odds, KV-backed 24h cooldown, server-determined outcome. |
| HEADERS | VERIFIED | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` on all responses. |
| POLYFILLS | VERIFIED | Console error suppression centralized in `/src/app/utils/polyfills.ts`. No duplicate patching. WC Pino contexts + stack trace matching. |

---

## Section 6 — Pool Simulation Reports

### Simulation A: Pool Creation + First Deposit + MINIMUM_LIQUIDITY Burn

**Scenario:** User `0.0.12345` creates WBTC/USDC pool, deposits 0.01 WBTC + 970 USDC.

| Step | Action | Raw Values | Result |
|---|---|---|---|
| 1 | Create pool | `sl-usdc-wbtc` | reserveA=0, reserveB=0, lpTotalSupply=0, swapFeeBps=10 |
| 2 | Convert to raw | WBTC: 0.01 * 10^8 = 1,000,000 | amountA = 1000000 (USDC sorts first) |
| | | USDC: 970 * 10^6 = 970,000,000 | amountB = 970000000 |
| 3 | Geometric mean | sqrt(970000000 * 1000000) = sqrt(9.7 * 10^14) | gm = 31,144,823 |
| 4 | MINIMUM_LIQUIDITY burn | 31,144,823 - 1,000 | sharesMinted = 31,143,823 |
| 5 | Total supply | sharesMinted + MINIMUM_LIQUIDITY | lpTotalSupply = 31,144,823 |
| 6 | Final state | | reserveA="970000000", reserveB="1000000" |
| | | | lpTotalSupply="31144823" |
| | | | k = 970000000 * 1000000 = 9.7 * 10^14 |

**MINIMUM_LIQUIDITY Effect:** The 1,000 burned shares represent $0.031 locked permanently. This prevents an attacker from minting 1 share with dust deposits, then donating to inflate the share price.

---

### Simulation B: Swap Execution with 0.1% Fee + Protocol Fee

**Scenario:** User swaps 100 USDC for WBTC on the pool from Simulation A.

| Step | Calculation | Value |
|---|---|---|
| 1. Input (raw) | 100 * 10^6 | rawIn = 100,000,000 |
| 2. Fee multiplier | 10000 - 10 (0.1% fee) | feeMultiplier = 9990 |
| 3. Amount with fee | 100,000,000 * 9990 | amountInWithFee = 999,000,000,000 |
| 4. Numerator | 999,000,000,000 * 1,000,000 (reserveOut) | 9.99 * 10^17 |
| 5. Denominator | 970,000,000 * 10000 + 999,000,000,000 | 10,699,000,000,000 |
| 6. rawOut | 9.99 * 10^17 / 10,699,000,000,000 | **93,372** (0.00093372 WBTC) |
| 7. New reserveA (USDC) | 970,000,000 + 100,000,000 | 1,070,000,000 |
| 8. New reserveB (WBTC) | 1,000,000 - 93,372 | 906,628 |
| 9. New k | 1,070,000,000 * 906,628 | 9.7009 * 10^14 |
| 10. k increased? | 9.7009 * 10^14 > 9.7 * 10^14 | YES (+0.009%) — fee captured |

**Fee Breakdown:**

| Component | Amount | USD Value |
|---|---|---|
| Pool fee (0.1%, stays in k) | Implicit in formula | $0.10 |
| Protocol fee (flat) | 350 tinybar (at $0.20/HBAR) | $0.0007 |
| Protocol → LP reward (50%) | 175 tinybar | $0.00035 |
| Protocol → Treasury (50%) | 175 tinybar | $0.00035 |
| **Total user cost** | **Pool fee + protocol fee** | **$0.1007** |

**Price Impact:** `100,000,000 * 10000 / (970,000,000 + 100,000,000)` = 934 bps (9.34%) — substantial due to small pool.

---

### Simulation C: Multi-Hop Swap Routing (A → USDC → B)

**Scenario:** User swaps WBTC → LINK. No direct WBTC/LINK pool exists. Route: WBTC → USDC → LINK.

Assume two pools exist:
- Pool 1 (USDC/WBTC): reserveA=5,000,000,000 (5000 USDC), reserveB=5,000,000 (0.05 WBTC)
- Pool 2 (LINK/USDC): reserveA=26,315,789,473 (263.15 LINK), reserveB=5,000,000,000 (5000 USDC)

| Step | Calculation | Value |
|---|---|---|
| 1. Input: 0.001 WBTC | 0.001 * 10^8 | rawIn = 100,000 |
| 2. Hop 1: WBTC→USDC | getAmountOut(100000, 5000000, 5000000000, 10) | midOut = 98,019,607 (98.02 USDC) |
| 3. Hop 2: USDC→LINK | getAmountOut(98019607, 5000000000, 26315789473, 10) | finalOut = 506,234,518 (5.062 LINK) |
| 4. Combined fee | 10 + 10 bps (additive) | 20 bps (0.2%) |
| 5. Combined impact | impact1 + impact2 | ~196 + ~192 = ~388 bps |
| 6. Effective rate | 5.062 LINK / 0.001 WBTC | 5,062 LINK/WBTC |

**Routing Decision:** The server computes both direct and USDC-hop routes, sorts by `amountOut` descending, and returns the best. If a direct WBTC/LINK pool existed with better output, it would be preferred.

**Note:** Multi-hop QUOTES are computed and returned to the frontend, but multi-hop EXECUTION returns HTTP 501 until HSuite SmartNode atomic swap support is integrated. The frontend should filter or label these routes accordingly.

---

### Simulation D: LP Addition (Second Depositor) + Proportional Shares

**Scenario:** After Simulation A+B, user `0.0.67890` adds liquidity to the USDC/WBTC pool.

Current pool state: reserveA=1,070,000,000 (USDC), reserveB=906,628 (WBTC), lpTotalSupply=31,144,823.

| Step | Calculation | Value |
|---|---|---|
| 1. User provides | 500 USDC + 0.0004 WBTC | rawA=500,000,000, rawB=40,000 |
| 2. Proportional check A | 500,000,000 * 31,144,823 / 1,070,000,000 | fromA = 14,554,591 |
| 3. Proportional check B | 40,000 * 31,144,823 / 906,628 | fromB = 1,373,614 |
| 4. Shares minted | min(14,554,591, 1,373,614) | **1,373,614 shares** |
| 5. Why min? | User's WBTC ratio is the binding constraint | User overpaid USDC relative to WBTC |

**Developer Note:** The user's excess USDC (relative to the WBTC they provided) is still deposited into the pool but they receive shares only for the smaller ratio. This is standard Uniswap V2 behavior. Frontends should warn users to deposit in the current ratio to avoid "wasted" deposits.

---

### Simulation E: LP Removal + Reserve Proportional Withdrawal

**Scenario:** User `0.0.12345` removes 50% of their LP position from the pool after Simulation D.

| Step | Calculation | Value |
|---|---|---|
| 1. User's shares | 31,143,823 (from Sim A) | sharesToBurn = 15,571,911 (50%) |
| 2. Total supply | 31,144,823 + 1,373,614 = 32,518,437 | |
| 3. Current reserves | reserveA=1,570,000,000, reserveB=946,628 | |
| 4. outA (USDC) | 15,571,911 * 1,570,000,000 / 32,518,437 | **751,804,234 (751.8 USDC)** |
| 5. outB (WBTC) | 15,571,911 * 946,628 / 32,518,437 | **453,088 (0.00453 WBTC)** |
| 6. MINIMUM_LIQUIDITY | 1,000 shares permanently locked — cannot be withdrawn by anyone | Pool never fully drains |

---

### Simulation F: Protocol Fee at Various HBAR Prices

The protocol fee is fixed at $0.0007 USD, converted to tinybar at swap time using the oracle HBAR price.

| HBAR Price (USD) | Fee in HBAR | Fee in Tinybar | Treasury (50%) | LP Reward (50%) |
|---|---|---|---|---|
| $0.05 | 0.01400000 | 1,400,000 | 700,000 | 700,000 |
| $0.10 | 0.00700000 | 700,000 | 350,000 | 350,000 |
| $0.20 (fallback) | 0.00350000 | 350,000 | 175,000 | 175,000 |
| $0.50 | 0.00140000 | 140,000 | 70,000 | 70,000 |
| $1.00 | 0.00070000 | 70,000 | 35,000 | 35,000 |
| $5.00 | 0.00014000 | 14,000 | 7,000 | 7,000 |
| $100.00 | 0.00000700 | 700 | 350 | 350 |

**Minimum:** 1 tinybar (enforced by `Math.max(1, ...)`). This triggers only if HBAR exceeds $7,000, which is unrealistic.

**Treasury Accumulation Model:**
- At 1,000 swaps/day at $0.20/HBAR: 175,000 tb/swap * 1,000 = 175,000,000 tb/day = 1.75 HBAR/day → treasury
- At 10,000 swaps/day at $0.20/HBAR: 17.5 HBAR/day → treasury
- At 100,000 swaps/day at $0.20/HBAR: 175 HBAR/day → treasury

---

### Simulation G: Impermanent Loss Scenarios

**Setup:** User deposits 1 WBTC ($97,000) + 97,000 USDC into a WBTC/USDC pool. Total value at deposit: $194,000.

| WBTC Price Change | Pool WBTC | Pool USDC | LP Value | HODL Value | IL |
|---|---|---|---|---|---|
| -50% ($48,500) | 1.414 | 68,589 | $137,179 | $145,500 | -5.72% |
| -25% ($72,750) | 1.155 | 84,041 | $167,824 | $169,750 | -1.13% |
| 0% ($97,000) | 1.000 | 97,000 | $194,000 | $194,000 | 0% |
| +25% ($121,250) | 0.894 | 108,397 | $216,794 | $218,250 | -0.67% |
| +50% ($145,500) | 0.816 | 118,744 | $237,488 | $242,500 | -2.07% |
| +100% ($194,000) | 0.707 | 137,178 | $274,357 | $291,000 | -5.72% |
| +200% ($291,000) | 0.577 | 168,029 | $336,058 | $388,000 | -13.40% |

**Key Takeaway:** IL at 2x price change is 5.72%. The 0.1% swap fee partially offsets IL — at ~57 swaps through the pool per day, the fee revenue would offset IL from a 50% price move within ~30 days.

---

### Simulation H: Depth Limit Enforcement

| Pool TVL | Max Swap Fraction | Max Single Swap | Example: 500 USDC swap |
|---|---|---|---|
| $50 | N/A (excluded) | N/A — pool excluded from routing [LP-10] | REJECTED (TVL < $100) |
| $500 | 2% | $10 | REJECTED ($500 > $10 max) |
| $5,000 | 2% | $100 | REJECTED ($500 > $100 max) |
| $25,000 | 5% | $1,250 | ACCEPTED |
| $100,000 | 5% | $5,000 | ACCEPTED |
| $500,000 | 10% | $50,000 | ACCEPTED |
| $5,000,000 | 10% | $500,000 | ACCEPTED |

**Developer Note:** Depth limits use oracle-derived TVL (see AUDIT-AMM-05). If oracle returns inflated prices, the depth limit becomes more permissive. If oracle returns deflated prices, legitimate swaps get rejected. Swaps against pools with zero oracle price (`tvl === 0`) bypass depth limits entirely — this is intentional for new pools that haven't been priced yet, but should be revisited.

---

## Section 7 — Fee Structure Architecture

### Layer 1: Pool Swap Fee (0.1% / 10 bps) — FIXED

```
                    User Input: 1000 USDC
                          │
                          ▼
              ┌─────────────────────┐
              │  Fee Deduction      │
              │  1000 * 9990/10000  │
              │  = 999 USDC (net)   │
              │  1 USDC stays in k  │
              └─────────────────────┘
                          │
                          ▼
              ┌─────────────────────┐
              │  Constant Product   │
              │  x * y = k          │
              │  Output calculated  │
              │  on 999 USDC input  │
              └─────────────────────┘
                          │
                          ▼
                   User receives
                   calculated output
```

- **Collected by:** AMM formula (implicit — fee stays in reserves)
- **Beneficiary:** All LP holders (k increases, their share of reserves grows)
- **Adjustable:** NO — `FIXED_SWAP_FEE_BPS = 10` is a server constant
- **Where enforced:** `getAmountOut()` in `/supabase/functions/server/index.tsx`

### Layer 2: Protocol Fee ($0.0007 / 0.07 cents) — FIXED

```
              ┌──────────────────────────────┐
              │  HBAR Price Oracle            │
              │  SaucerSwap WHBAR (0.0.1456986) │
              │  Fallback: $0.20              │
              └──────────┬───────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  $0.0007 / HBAR_USD │
              │  = X HBAR           │
              │  = X * 10^8 tinybar │
              │  min: 1 tinybar     │
              └─────────┬───────────┘
                        │
              ┌─────────┴─────────┐
              │                   │
              ▼                   ▼
       ┌─────────────┐    ┌──────────────┐
       │  50% → LP   │    │  50% →       │
       │  (implicit  │    │  Treasury    │
       │  via k      │    │  0.0.9695738 │
       │  increase)  │    │  KV accrual  │
       └─────────────┘    └──────────────┘
```

- **Collected by:** Server-side calculation post-swap
- **LP half:** Conceptual — the 0.1% pool fee already benefits LPs. The protocol fee LP half is an accounting notation for future direct distribution.
- **Treasury half:** Accrued in `sl_treasury_fees` KV key. Requires admin sweep to transfer on-chain.
- **Oracle dependency:** WHBAR price from SaucerSwap. Fallback $0.20 if unavailable.

### Combined Fee Example (1000 USDC swap)

| Fee Layer | Amount | % of Trade | Beneficiary |
|---|---|---|---|
| Pool fee (0.1%) | ~1.0 USDC | 0.100% | LP holders (in-pool) |
| Protocol fee | ~0.00035 HBAR ($0.0007) | 0.00007% | 50% LP / 50% Treasury |
| **Total** | **~$1.0007** | **~0.10007%** | |

---

## Section 8 — HSuite SmartNode Integration Status

| Component | Status | Notes |
|---|---|---|
| Validator discovery | Code complete | `discoverBestNode()` pings all endpoints, selects lowest latency |
| NFT validation | Code complete | `validateNFT()` checks tier and features |
| Swap quote | Code complete | `getSwapQuote()` routes to HSuite API |
| Swap execution | **NOT CONNECTED** | `executeSwap()` builds tx but no signing/submission |
| Pool creation | **NOT CONNECTED** | Smart pool create endpoint defined but not wired |
| API keys | **MISSING** | `HSUITE_API_KEY`, `SAUCERSWAP_API_KEY`, `BONZO_API_KEY`, `STARGATE_API_KEY`, `ONEINCH_API_KEY` |
| Atomic multi-hop | **BLOCKED** | Requires SmartNode for atomic A→USDC→B execution |

---

## Section 9 — Remediation Priority Matrix

| ID | Severity | Effort | Priority | Description |
|---|---|---|---|---|
| AUDIT-AMM-01 | CRITICAL | HIGH | P0 | Add account ownership proof (signature verification) |
| AUDIT-AMM-02 | CRITICAL | MEDIUM | P0 | Implement optimistic locking on pool state writes |
| AUDIT-AMM-03 | CRITICAL | LOW | P0 | Frontend must send `minAmountOutRaw` with every swap |
| AUDIT-B01 | CRITICAL | LOW | P0 | Fix Stargate function selector collision |
| AUDIT-AMM-04 | HIGH | MEDIUM | P1 | Per-user swap index to avoid full scan |
| AUDIT-D01 | HIGH | HIGH | P1 | Migrate DAO proposals to server-side KV |
| AUDIT-F06 | HIGH | HIGH | P1 | Implement HTS token approval flow for Bonzo |
| AUDIT-AMM-05 | MEDIUM | MEDIUM | P2 | TWAP comparison for oracle manipulation defense |
| AUDIT-AMM-06 | MEDIUM | LOW | P2 | Post-swap k-invariant assertion |
| AUDIT-AMM-07 | MEDIUM | LOW | P2 | Filter multi-hop quotes or label as preview |
| AUDIT-AMM-08 | MEDIUM | LOW | P2 | Pool index compaction |
| AUDIT-LP-06 | MEDIUM | HIGH | P2 | MEV protection plan for HSuite migration |
| AUDIT-AMM-09 | MEDIUM | LOW | P2 | Use BigInt string for treasury fee accumulator |
| AUDIT-AMM-10 | LOW | LOW | P3 | LRU cache for rate limiter |
| AUDIT-AMM-11 | LOW | LOW | P3 | Periodic fallback price refresh |
| AUDIT-AMM-12 | LOW | MEDIUM | P3 | Withdrawal timelock for large LP positions |
| AUDIT-LP-11c | LOW | MEDIUM | P3 | Build treasury fee sweep endpoint |
| AUDIT-AMM-13 | LOW | LOW | P3 | Fix timestamp unit mismatch in `timeSince()` |

---

## Section 10 — Files Audited

| File | Lines | Purpose | Findings |
|---|---|---|---|
| `/supabase/functions/server/index.tsx` | 1160 | AMM engine, spin wheel, news ticker, rate limiter | AMM-01 through AMM-10 |
| `/src/app/utils/smart-liquidity.ts` | ~300 | Client API wrapper, token registry, formatting | AMM-13 |
| `/src/app/components/SmartLiquidity.tsx` | ~620 | Swap/LP/Pool UI components | AMM-03 (slippage) |
| `/src/app/utils/hsuite.ts` | ~500 | HSuite SmartNode SDK integration scaffold | HSUITE-01 through HSUITE-06 |
| `/src/app/utils/pool-factory.ts` | ~300 | Solidity pool factory documentation | A-01 through A-12 |
| `/src/app/utils/stargate.ts` | ~200 | Stargate V2 cross-chain bridge | B01 |
| `/src/app/utils/polyfills.ts` | 401 | WC/HC error suppression, Buffer/process polyfills | Clean |

---

*All `[AUDIT-AMM-xx]`, `[LP-xx]`, `[HSUITE-xx]`, and `[AUDIT-B01]` tags are grep-searchable across the codebase. This audit supersedes the v1 audit dated 2026-02-12. Pool simulations use real AMM math from the production codebase and can be independently verified using the `getAmountOut()` function in the server source.*

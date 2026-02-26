# Deep Code Cleanup — Steps 6-10 Implementation Plan

## Status: Ready to Execute
**Prerequisites Completed:** Steps 1-5 (initial cleanup pass)  
**Prerequisites Completed:** Beta Terms Gate deployment & testing  
**Current Date:** February 25, 2026

---

## 📋 Overview

This document outlines the remaining cleanup work identified in the codebase audit. The focus is on:
- Removing deprecated/dead code
- Professionalizing remaining developer comments
- Standardizing error messages
- Broader codebase sweep for inconsistencies
- Final QA pass on mobile swap flow

---

## Step 6: Remove Remaining Dead Code

### 6.1 Server-Side Dead Code

**File: `/supabase/functions/server/amm.ts`**
- **Status:** DEPRECATED — entire 1500+ line file is dead code
- **Evidence:**
  - NOT imported in `/supabase/functions/server/index.tsx`
  - registerAmmRoutes() is NEVER called
  - All /amm/* and /pools/* routes from this module are unreachable
  - Superseded by `atomic-signer.ts` (Hedera-native atomic CryptoTransfer oracle)
- **Action:** DELETE file entirely
- **Risk:** ZERO — file is not loaded into production runtime
- **Justification:** Keeping 1500 lines of dead code increases cognitive load and repo bloat

**Verification:**
```bash
# Before deletion, verify no imports exist:
grep -r "from.*\\.\/amm" /supabase/functions/server/*.ts
grep -r "registerAmmRoutes" /supabase/functions/server/*.ts

# Should return ZERO matches (except amm.ts itself)
```

**Note:** `amm-math-shared.ts` is LIVE and actively used by `atomic-signer.ts` — DO NOT DELETE.

---

### 6.2 Frontend Dead Code Candidates

**Files to Review:**

1. **`/src/app/utils/atomic-swap-types.ts`**
   - Line 73: `status: "active" | "paused" | "deprecated"`
   - **Question:** Is `"deprecated"` status ever used in production?
   - **Check:** Search for `.status === "deprecated"` or `status: "deprecated"` assignments
   - **If unused:** Simplify to `status: "active" | "paused"`

2. **`/src/app/utils/staking-provider.ts`**
   - Line 21: `export type StakingStatus = "active" | "pending" | "deprecated";`
   - **Question:** Same as above — is `"deprecated"` used?
   - **If unused:** Simplify to `StakingStatus = "active" | "pending"`

**Action Items:**
- [ ] Search codebase for `"deprecated"` status assignments
- [ ] If zero usage found, simplify type unions
- [ ] Update any type guards or switch statements accordingly

---

## Step 7: Professionalize Remaining Developer Comments

### 7.1 Replace "AUDIT NOTES" with "IMPLEMENTATION NOTE"

**Files Requiring Updates:**

1. **`/src/app/utils/pool-factory.ts:35`**
   ```typescript
   // Current:
   *  * AUDIT NOTES:
   *  *  [A-01] ReentrancyGuard on createPool — prevents reentrancy via
   *  *         malicious token transfer callbacks.
   
   // Replace with:
   *  * IMPLEMENTATION NOTE — Security Protections:
   *  *  • ReentrancyGuard on createPool prevents reentrancy via
   *  *    malicious token transfer callbacks.
   ```

2. **`/src/app/utils/saucerswap/positions.ts:21`**
   ```typescript
   // Current:
   *  * AUDIT NOTES:
   *  *
   *  * (1) Position amounts are computed from on-chain liquidity + tick range
   
   // Replace with:
   *  * IMPLEMENTATION NOTE:
   *  *
   *  * (1) Position amounts are computed from on-chain liquidity + tick range
   ```

3. **`/src/app/utils/saucerswap/tick-math.ts:14`**
   ```typescript
   // Current:
   *  * AUDIT NOTES:
   *  *
   *  * (1) getSqrtRatioAtTick:
   
   // Replace with:
   *  * IMPLEMENTATION NOTE:
   *  *
   *  * (1) getSqrtRatioAtTick:
   ```

4. **`/src/app/utils/saucerswap/v2-liquidity-engine.ts:32`**
   ```typescript
   // Current:
   *  * FUND SAFETY AUDIT NOTES:
   *  *
   *  * (1) Slippage protection: amount0Min/amount1Min with bps tolerance
   
   // Replace with:
   *  * IMPLEMENTATION NOTE — Fund Safety Protections:
   *  *
   *  * (1) Slippage protection: amount0Min/amount1Min with bps tolerance
   ```

5. **`/src/app/utils/saucerswap/v2-remove-engine.ts:17`**
   ```typescript
   // Current:
   *  * FUND SAFETY AUDIT NOTES:
   *  *
   *  * (1) Slippage protection on decreaseLiquidity:
   
   // Replace with:
   *  * IMPLEMENTATION NOTE — Fund Safety Protections:
   *  *
   *  * (1) Slippage protection on decreaseLiquidity:
   ```

**Total Files:** 5  
**Estimated Time:** 10 minutes

---

### 7.2 Clean Up Inline TODO/FIXME Comments

**File: `/supabase/functions/server/saucerswap-engine.ts:720`**

```typescript
// Current:
// TODO [C59]: When token registry is server-side, enable full symbol fallback.

// Replace with:
// IMPLEMENTATION NOTE: Symbol-based token matching is currently restricted to
// prevent false positives. Full symbol fallback will be enabled once the token
// registry is migrated server-side (tracked in roadmap issue C59).
```

**Total Files:** 1  
**Estimated Time:** 2 minutes

---

## Step 8: Error Message Consistency

### 8.1 Standardize Hedera Account ID Error Messages

**Current State:** Multiple variations exist:
- `"Enter a valid Hedera account ID (0.0.xxxxx)"`
- `"Invalid Hedera account ID format (expected 0.0.xxxxx)"`
- `"Expected 0.0.xxxxx, got: ..."`

**Proposed Standard:**
```typescript
// User-facing (frontend):
"Invalid Hedera account ID format (expected 0.0.123456)"

// Developer-facing (API errors):
{ error: "Invalid account ID", detail: "Expected format: 0.0.123456, received: ..." }
```

**Files Requiring Updates:**

1. **Frontend:**
   - `/src/app/components/DAO.tsx:1998` → Update to standard format
   - `/src/app/components/TransactionDiagnoser.tsx:329` → Placeholder already correct

2. **Backend:**
   - `/supabase/functions/server/dao.ts:555` → Already matches standard
   - `/supabase/functions/server/saucerswap-engine.ts:1005` → Already matches standard
   - `/supabase/functions/server/saucerswap-engine.ts:1035` → Already matches standard
   - `/supabase/functions/server/saucerswap-engine.ts:1065` → Already matches standard
   - `/supabase/functions/server/saucerswap-quote.ts:1360` → Update to match
   - `/supabase/functions/server/saucerswap-quote.ts:1363` → Update to match

**Action Items:**
- [ ] Update DAO.tsx:1998
- [ ] Update saucerswap-quote.ts:1360 and 1363
- [ ] Verify all placeholders use `0.0.123456` (not `0.0.xxxxx` or `0.0.xxxxxx`)

---

### 8.2 Standardize Token ID Error Messages

**Proposed Standard:**
```typescript
{ error: "Invalid token ID", detail: 'Expected format: 0.0.123456 or "HBAR", received: ...' }
```

**Files Requiring Updates:**
- `/supabase/functions/server/saucerswap-engine.ts:1008` → Already correct
- `/supabase/functions/server/saucerswap-engine.ts:1038` → Already correct

---

## Step 9: Broader Codebase Sweep

### 9.1 Unused Import Detection

**Tool:** Use TypeScript LSP or ESLint to detect unused imports

```bash
# Run TypeScript compiler in noEmit mode to detect unused imports
npx tsc --noEmit

# OR use ESLint with unused-imports plugin
npx eslint . --ext .ts,.tsx --rule 'unused-imports/no-unused-imports: error'
```

**Action:** Remove any detected unused imports

---

### 9.2 Inconsistent Naming Patterns

**Search for:**
- Mixed camelCase/snake_case in function names
- Inconsistent acronym capitalization (HST vs hst, WHBAR vs whbar)
- Hungarian notation remnants (strValue, arrTokens, etc.)

**Files to Review:**
- [ ] All files in `/src/app/utils/saucerswap/`
- [ ] All files in `/supabase/functions/server/`

---

### 9.3 Deprecation Warning Suppression Review

**File: `/src/app/utils/polyfills.ts`**

Lines 105, 187:
```typescript
"requiredNamespaces are deprecated",
```

**Question:** Is this WalletConnect v2 deprecation warning still relevant?  
**Action:** Keep if still needed for WC compatibility, otherwise remove

---

### 9.4 Console.log Audit

**Search for debug/temp logging:**
```bash
grep -r "console.log.*debug" src/
grep -r "console.warn.*temp" src/
```

**Action:** Remove any debug logging that slipped through previous cleanup passes

---

## Step 10: Final QA Pass — Mobile Swap Flow

### 10.1 Mobile Signing Bug (HashPack Timeout)

**Status:** Five `[MOB-SWAP-V3]` fixes applied in `wallet-core.ts`  
**Remaining Work:** Physical device testing required

**Test Checklist:**

**Device Setup:**
- [ ] iPhone 13 Pro (iOS 16+) — Safari
- [ ] iPhone SE 2020 (iOS 15) — Safari
- [ ] Samsung Galaxy S21 (Android 12+) — Chrome
- [ ] Samsung Galaxy A52 (Android 11) — Chrome

**Test Scenarios:**

1. **Basic Swap (HBAR → USDC)**
   - [ ] Connect HashPack via WalletConnect
   - [ ] Enter swap amount (10 HBAR)
   - [ ] Click "Swap"
   - [ ] Sign approval transaction in HashPack mobile app
   - [ ] Wait for approval confirmation
   - [ ] Sign swap transaction in HashPack mobile app
   - [ ] Verify swap completes successfully
   - [ ] Check wallet balance updates

2. **Rapid Multi-Swap**
   - [ ] Perform 3 swaps back-to-back (HBAR → USDC → HBAR → USDC)
   - [ ] Verify no session timeout errors
   - [ ] Verify all transactions succeed

3. **Background Interruption**
   - [ ] Start swap flow
   - [ ] Switch to HashPack to approve
   - [ ] Switch to another app (Messages) for 30 seconds
   - [ ] Return to HashPack and complete approval
   - [ ] Verify swap completes without session loss

4. **Network Switch During Swap**
   - [ ] Start swap on WiFi
   - [ ] Switch to cellular data mid-transaction
   - [ ] Verify swap completes or fails gracefully (not timeout)

5. **Screen Lock During Approval**
   - [ ] Start swap
   - [ ] Lock device screen while waiting for HashPack approval prompt
   - [ ] Unlock and approve
   - [ ] Verify swap completes

**Expected Behavior:**
- ✅ No "Session timeout" errors
- ✅ No "Transaction not found" errors
- ✅ All swaps complete successfully OR fail with clear error message
- ✅ Wallet balance updates within 5 seconds of transaction confirmation

**Known Issues to Watch For:**
- HashPack session expiring after 60 seconds of inactivity
- Mirror Node transaction lookup failures on mobile networks
- WalletConnect bridge disconnects during background mode

---

### 10.2 Mobile UI Polish

**Viewport Testing:**

1. **Very Small Screens (320×568 iPhone SE)**
   - [ ] Swap panel fits without horizontal scroll
   - [ ] Token selector dropdowns are tappable (min 44×44px touch targets)
   - [ ] Amount input keyboard covers bottom controls → scroll works

2. **Landscape Mode (667×375)**
   - [ ] Swap panel doesn't overflow
   - [ ] Navigation remains accessible

3. **Tablet (768×1024 iPad)**
   - [ ] Layout scales appropriately (not stretched or squashed)

---

### 10.3 Accessibility Final Check

**Screen Reader Testing (VoiceOver/TalkBack):**
- [ ] All swap flow buttons have accessible labels
- [ ] Token amounts announced correctly (e.g., "10.5 HBAR")
- [ ] Transaction status changes announced via live regions
- [ ] Error messages announced immediately

**Keyboard Navigation:**
- [ ] Tab order is logical (token A → amount → token B → swap button)
- [ ] All interactive elements have focus indicators
- [ ] Escape key closes modals

---

## Implementation Schedule

### Phase 1: Quick Wins (30 minutes)
1. Delete `/supabase/functions/server/amm.ts`
2. Replace 5 "AUDIT NOTES" comments
3. Update TODO comment in saucerswap-engine.ts

### Phase 2: Error Message Standardization (45 minutes)
1. Update DAO.tsx error message
2. Update saucerswap-quote.ts error messages
3. Run codebase search to verify all Hedera ID errors match standard

### Phase 3: Dead Code Analysis (1 hour)
1. Search for `"deprecated"` status usage
2. Remove unused status types if applicable
3. Run TypeScript compiler to detect unused imports
4. Remove any found unused imports

### Phase 4: Mobile Testing (2-4 hours)
1. Deploy latest code to staging
2. Test all 5 mobile swap scenarios on 4 devices (20 test runs total)
3. Document any new issues found
4. Apply fixes if needed

### Phase 5: Final Sweep (1 hour)
1. Run ESLint with unused-imports rule
2. Grep for inconsistent naming patterns
3. Final manual review of all modified files
4. Update this document with completion status

---

## Success Criteria

**Code Quality:**
- ✅ Zero deprecated/dead code files in repo
- ✅ All developer comments use "IMPLEMENTATION NOTE" standard
- ✅ All error messages follow consistent format
- ✅ Zero unused imports (verified by TypeScript)

**Mobile QA:**
- ✅ 20/20 mobile swap test scenarios pass
- ✅ Zero session timeout errors on real devices
- ✅ All screen sizes display correctly

**Documentation:**
- ✅ This cleanup plan is updated with actual results
- ✅ Any new issues discovered are documented in GitHub issues

---

## Files Modified Summary

### To Be Deleted:
- `/supabase/functions/server/amm.ts` (1500+ lines)

### To Be Modified:
1. `/src/app/utils/pool-factory.ts` (comment professionalization)
2. `/src/app/utils/saucerswap/positions.ts` (comment professionalization)
3. `/src/app/utils/saucerswap/tick-math.ts` (comment professionalization)
4. `/src/app/utils/saucerswap/v2-liquidity-engine.ts` (comment professionalization)
5. `/src/app/utils/saucerswap/v2-remove-engine.ts` (comment professionalization)
6. `/src/app/components/DAO.tsx` (error message standardization)
7. `/supabase/functions/server/saucerswap-engine.ts` (TODO → IMPLEMENTATION NOTE)
8. `/supabase/functions/server/saucerswap-quote.ts` (error message standardization)

### Potentially Modified (pending dead code analysis):
9. `/src/app/utils/atomic-swap-types.ts` (simplify status type)
10. `/src/app/utils/staking-provider.ts` (simplify status type)

**Total Estimated Changes:** 8-10 files, ~50-100 lines of code

---

## Post-Cleanup Validation

**Automated Checks:**
```bash
# 1. TypeScript compilation
npm run build

# 2. ESLint
npm run lint

# 3. Unit tests (if any)
npm run test

# 4. Edge function deployment test
supabase functions deploy --dry-run
```

**Manual Checks:**
- [ ] App loads without console errors
- [ ] Swap flow works end-to-end on desktop
- [ ] Beta Terms Gate still functions correctly
- [ ] DAO admin panel loads without errors
- [ ] All server endpoints return expected responses

---

## Notes

- **Code Standards:** All changes must maintain the "IMPLEMENTATION NOTE" comment style established in Steps 1-5
- **Risk Mitigation:** Test each deletion thoroughly before committing (especially amm.ts removal)
- **Mobile Testing Priority:** The HashPack timeout bug is the #1 remaining production issue — prioritize Step 10.1
- **Version Control:** Create a new branch `cleanup/steps-6-10` for all changes
- **Deployment:** Deploy server changes first, then frontend (avoid version mismatches)

---

**Cleanup Initiated:** _[To be filled]_  
**Cleanup Completed:** _[To be filled]_  
**Tested By:** _[To be filled]_

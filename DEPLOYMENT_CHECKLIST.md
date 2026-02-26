# WRAPpDEX Beta Terms Gate — Deployment & Testing Checklist

## 📋 Pre-Deployment Summary

**What's Being Deployed:**
- Updated `/supabase/functions/server/auth.ts` — ED25519 challenge-response with enhanced error logging and public key normalization (9 previous fixes applied)
- New `/supabase/functions/server/beta-terms.ts` — 3 endpoints for versioned terms acceptance audit trail
- Server route registration in `/supabase/functions/server/index.tsx` (already configured)
- Frontend: `/src/app/components/TermsGate.tsx` — institutional-grade gate with scroll-to-bottom enforcement

**Server Changes:**
1. **auth.ts**: Challenge message now sends plain UTF-8 text (not base64) to HashPack with 24-char hex nonce
2. **beta-terms.ts**: 
   - `POST /beta-terms/accept` — logs acceptance with privacy-preserving IP hash, version, timestamp, viewport
   - `GET /beta-terms/stats?version=X` — retrieves acceptance count for a version
   - `GET /beta-terms/required-version` — server-authoritative version (allows live version bumps)
   - `PUT /beta-terms/required-version` — admin endpoint to force re-acceptance (requires SUPABASE_SERVICE_ROLE_KEY)

---

## 🚀 Step 1: Deploy Edge Functions

### Command:
```bash
supabase functions deploy
```

**OR deploy individual functions:**
```bash
supabase functions deploy make-server-54299934
```

### Expected Output:
```
Deploying function make-server-54299934...
Function deployed successfully
URL: https://<project-id>.supabase.co/functions/v1/make-server-54299934
```

### Verification:
```bash
# Test health endpoint
curl "https://<project-id>.supabase.co/functions/v1/make-server-54299934/health"

# Expected response:
# {"ok":true,"timestamp":"2026-02-25T..."}
```

---

## ✅ Step 2: End-to-End Testing Checklist

### 2.1 Server Health Check

**Test:**
```bash
curl "https://<project-id>.supabase.co/functions/v1/make-server-54299934/health" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>"
```

**Expected:** `{"ok": true, "timestamp": "..."}`

---

### 2.2 Beta Terms — Required Version Endpoint

**Test:**
```bash
curl "https://<project-id>.supabase.co/functions/v1/make-server-54299934/beta-terms/required-version" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>"
```

**Expected:**
```json
{
  "requiredVersion": "2026.02.25.1",
  "asOf": "2026-02-25T..."
}
```

**Validation:**
- ✅ `requiredVersion` matches `TERMS_VERSION` in `/src/app/components/TermsGate.tsx` (currently `2026.02.25.1`)
- ✅ `asOf` is a valid ISO-8601 timestamp

---

### 2.3 Beta Terms — Acceptance Logging

**Test:**
```bash
curl -X POST "https://<project-id>.supabase.co/functions/v1/make-server-54299934/beta-terms/accept" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "2026.02.25.1",
    "userAgent": "test-curl/1.0",
    "viewport": { "width": 1920, "height": 1080 }
  }'
```

**Expected:**
```json
{
  "ok": true,
  "recorded": "2026-02-25T...",
  "totalAcceptances": 1
}
```

**Validation:**
- ✅ Returns `ok: true`
- ✅ `totalAcceptances` increments on repeated calls
- ✅ Server logs show: `[BetaTerms] Acceptance logged — version=2026.02.25.1, ipHash=..., total=1, viewport=1920x1080`

---

### 2.4 Beta Terms — Stats Endpoint

**Test:**
```bash
curl "https://<project-id>.supabase.co/functions/v1/make-server-54299934/beta-terms/stats?version=2026.02.25.1" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>"
```

**Expected:**
```json
{
  "version": "2026.02.25.1",
  "totalAcceptances": 1,
  "asOf": "2026-02-25T..."
}
```

**Validation:**
- ✅ `totalAcceptances` matches the count from Step 2.3

---

### 2.5 Beta Terms — Rate Limiting

**Test:** Send 6+ rapid acceptance requests from the same IP

**Expected:** 
- First 5 succeed with `ok: true`
- 6th+ returns HTTP 429: `{"error": "Rate limited. Please try again later."}`
- Rate limit window: 10 minutes

**Validation:**
- ✅ Rate limit correctly enforces 5 acceptances per IP per 10 minutes
- ✅ Server logs show: `[BetaTerms] Rate limited acceptance from IP hash: ...`

---

### 2.6 Auth Flow — Challenge Generation

**Test:**
```bash
curl "https://<project-id>.supabase.co/functions/v1/make-server-54299934/auth/challenge/0.0.123456" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>"
```

**Expected:**
```json
{
  "challengeId": "...",
  "accountId": "0.0.123456",
  "nonce": "abc123...",
  "message": "WRAPpDEX Identity Verification\n\nSign to prove you own this account.\nNo fees will be charged.\n\nAccount: 0.0.123456\nTime: 2026-02-25 12:34:56 UTC\nID: abc123...",
  "expiresAt": 1740477296000
}
```

**Validation:**
- ✅ `nonce` is 24 hex characters (12 bytes)
- ✅ `message` is plain UTF-8 text (not base64)
- ✅ `message` includes human-readable timestamp
- ✅ `expiresAt` is ~5 minutes in the future

---

### 2.7 Frontend Integration — TermsGate Mount

**Manual Browser Test:**

1. **Clear localStorage:** Open DevTools → Application → Local Storage → Clear All
2. **Reload page:** You should see the Beta Terms Gate
3. **Scroll progress:** Verify blue progress bar advances as you scroll
4. **Scroll-to-bottom detection:**
   - ✅ Toggle remains disabled until scrolled to bottom (within 20px)
   - ✅ "Scroll to continue" indicator disappears when bottom reached
   - ✅ Screen reader announcement: "You have read the complete agreement. The acceptance toggle is now enabled."
5. **Toggle acceptance:**
   - ✅ Toggle activates blue color when checked
   - ✅ "Enter WRAPpDEX" button becomes enabled
6. **Accept and enter:**
   - ✅ Smooth fade-out animation
   - ✅ localStorage key `wrappdex_beta_tos_v_2026.02.25.1` is set to `"1"`
   - ✅ Console logs: `[BetaTerms] Acceptance logged to server — total: X`
7. **Reload page:**
   - ✅ No gate shown (localStorage key persists)
   - ✅ Console logs: `[BetaTerms] Version check unavailable — trusting localStorage` (if server unreachable) OR no logs (if server confirms version)

---

### 2.8 Frontend Integration — Version Enforcement

**Test:** Simulate a server-side version bump forcing re-acceptance

1. **Accept current version:** Complete Steps 2.7.1-2.7.6
2. **Simulate version bump:** Manually set `CURRENT_REQUIRED_VERSION` in `/supabase/functions/server/beta-terms.ts` to `"2026.02.25.2"` and redeploy
3. **Reload frontend:** 
   - ✅ Gate reappears even though localStorage still has `2026.02.25.1`
   - ✅ Console logs: `[BetaTerms] Server requires version 2026.02.25.2, client has 2026.02.25.1 — forcing re-acceptance`
   - ✅ Old localStorage keys are removed
4. **Accept new version:**
   - ✅ New localStorage key `wrappdex_beta_tos_v_2026.02.25.2` is created
   - ✅ Server logs new acceptance event

**Cleanup:** Revert `CURRENT_REQUIRED_VERSION` back to `"2026.02.25.1"` after testing

---

### 2.9 Frontend Integration — Cross-Tab Sync

**Test:**

1. **Tab A:** Accept terms (gate disappears)
2. **Tab B:** Open new tab WITHOUT accepting (gate visible)
3. **Tab A:** Execute in DevTools console:
   ```javascript
   localStorage.removeItem('wrappdex_beta_tos_v_2026.02.25.1')
   ```
4. **Tab B (automatic):**
   - ✅ Gate reappears automatically via `storage` event listener
   - ✅ Toggle resets to unchecked
   - ✅ Scroll progress resets to 0

**Cleanup:** Re-accept terms in both tabs

---

### 2.10 Accessibility Testing

**Keyboard Navigation:**
1. Press `Tab` repeatedly:
   - ✅ Focus indicator appears on scrollable container
   - ✅ Focus indicator appears on toggle switch
   - ✅ Focus indicator appears on "Enter WRAPpDEX" button
2. **Scroll with arrow keys:** Scrollable content responds to `↑` `↓` `Page Up` `Page Down` `Home` `End`
3. **Toggle with keyboard:**
   - Focus on toggle → Press `Space` or `Enter`
   - ✅ Toggle state changes
4. **Accept with keyboard:**
   - Focus on button → Press `Enter`
   - ✅ Gate dismisses

**Screen Reader Testing (NVDA/JAWS/VoiceOver):**
- ✅ "Beta Testing Agreement" heading announced
- ✅ "This software is in active development..." warning announced
- ✅ "region" role on scrollable container announced
- ✅ Toggle announced as "switch" role with current state
- ✅ "You have read the complete agreement..." live announcement when scroll-to-bottom reached
- ✅ Button disabled state announced

---

### 2.11 Mobile Viewport Testing

**Test on physical device or Chrome DevTools Device Mode:**

1. **Portrait mode (375×667 typical iPhone):**
   - ✅ Content is fully readable (10px base font scales to 11px on desktop)
   - ✅ "Closed Beta" badge is compact
   - ✅ Shield icon hidden on small screens to save vertical space
   - ✅ Scrollable content has sufficient height (`calc(100dvh - 360px)` with `180px` minimum)
   - ✅ Touch scrolling feels natural (no bounce, overscroll-contain works)
2. **Landscape mode (667×375):**
   - ✅ Content still scrollable (not cut off)
   - ✅ Accept button visible without scrolling the page
3. **Very small screens (320×568 iPhone SE):**
   - ✅ All text readable
   - ✅ Toggle and button don't overflow

---

### 2.12 Edge Case Testing

**Test 1: localStorage Unavailable (Private Browsing)**
- Set browser to block localStorage
- **Expected:** Gate still renders, but acceptance is session-only (resets on page reload)
- ✅ No JavaScript errors in console

**Test 2: Server Unreachable**
- Block outgoing requests to `*.supabase.co` via browser DevTools
- **Expected:** Gate uses localStorage as fallback (fail-open for existing users)
- ✅ Console warning: `[BetaTerms] Version check unavailable — trusting localStorage`
- ✅ Console warning: `[BetaTerms] Server audit log unavailable: <error>`

**Test 3: Content Fits Without Scrolling (Large Viewport)**
- Open gate on a 4K monitor (3840×2160)
- **Expected:** Scroll-to-bottom detection activates immediately
- ✅ Toggle enabled without manual scrolling
- ✅ Progress bar shows 100%
- ✅ No "Scroll to continue" indicator

**Test 4: Double-Click Protection**
- Accept terms and immediately click "Enter WRAPpDEX" button 5 times rapidly
- **Expected:** Only one acceptance logged to server (guarded by `entering` state)
- ✅ Server stats endpoint shows `totalAcceptances: 1` (not 5)

---

## 🔐 Step 3: Security Validation

### 3.1 Verify IP Hashing (Privacy)
**Check server logs after acceptance:**
- ✅ Raw IP address is NEVER logged
- ✅ Only `ipHash=...` appears (first 16 hex chars of SHA-256 hash)
- ✅ Hash includes project-scoped salt: `wrappdex_beta_tos_salt_{ip}`

### 3.2 Verify KV Storage
**Check Supabase KV dashboard or query:**
```bash
# Example: fetch acceptance records
curl "https://<project-id>.supabase.co/functions/v1/make-server-54299934/debug/kv?prefix=beta_tos:2026.02.25.1" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
```
- ✅ Keys follow pattern: `beta_tos:{version}:{timestamp_ms}`
- ✅ Values contain: `{ version, acceptedAt, timestampMs, ipHash, userAgent, viewport }`

### 3.3 Admin Endpoint Protection
**Test version update without service role key:**
```bash
curl -X PUT "https://<project-id>.supabase.co/functions/v1/make-server-54299934/beta-terms/required-version" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"version": "9999.99.99.9"}'
```
- ✅ Returns HTTP 401: `{"error": "Unauthorized"}`

**Test with service role key:**
```bash
curl -X PUT "https://<project-id>.supabase.co/functions/v1/make-server-54299934/beta-terms/required-version" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"version": "2026.02.25.1"}'
```
- ✅ Returns: `{"ok": true, "requiredVersion": "2026.02.25.1", "updatedAt": "..."}`

---

## 📊 Step 4: Production Monitoring

### Key Metrics to Track (Post-Launch):

1. **Acceptance Rate:**
   ```bash
   curl "https://<project-id>.supabase.co/functions/v1/make-server-54299934/beta-terms/stats?version=2026.02.25.1" \
     -H "Authorization: Bearer <SUPABASE_ANON_KEY>"
   ```
   - Track `totalAcceptances` growth over time

2. **Server Logs (Supabase Dashboard → Functions → Logs):**
   - Filter for `[BetaTerms]` prefix
   - Watch for rate limit triggers
   - Monitor viewport distributions (desktop vs mobile)

3. **Frontend Console Logs (Browser DevTools):**
   - Users should see: `[BetaTerms] Acceptance logged to server — total: X`
   - Watch for errors: `[BetaTerms] Server log failed (XXX): ...`

4. **Error Monitoring:**
   - If server acceptance logging fails, gate still works (localStorage is source of truth)
   - Non-blocking design ensures high availability

---

## 🐛 Common Issues & Fixes

### Issue: Gate Doesn't Appear After Version Bump
**Symptoms:** Server version updated, but users still bypass gate
**Diagnosis:**
```bash
# Check server version
curl "https://<project-id>.supabase.co/functions/v1/make-server-54299934/beta-terms/required-version"

# Check localStorage in browser DevTools
localStorage.getItem('wrappdex_beta_tos_v_2026.02.25.1')
```
**Fix:** Hard-refresh (`Cmd+Shift+R` / `Ctrl+F5`) to force version check, OR clear localStorage

---

### Issue: Acceptance Not Logging to Server
**Symptoms:** Console shows `[BetaTerms] Server log failed (XXX): ...`
**Diagnosis:** Check CORS headers in Supabase Function response
**Fix:** Verify `/supabase/functions/server/index.tsx` has:
```typescript
cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
})
```

---

### Issue: Rate Limit Blocking Legitimate Users
**Symptoms:** User sees `Rate limited` error after refreshing multiple times
**Diagnosis:** Check if user's IP is in shared network (office/VPN)
**Fix:** Increase `ACCEPT_RATE_LIMIT_MAX` from 5 to 10 in `/supabase/functions/server/beta-terms.ts` line 37

---

## 🎯 Post-Deployment Next Steps

Once all tests pass:

1. ✅ Mark deployment as complete
2. ✅ Monitor acceptance rate for first 24 hours
3. ✅ Collect user feedback on scroll UX
4. ✅ Resume **Deep Code Cleanup Steps 6-10**:
   - Step 6: Remove remaining dead code from swap modules
   - Step 7: Professionalize all remaining developer comments
   - Step 8: Final pass on error message consistency
   - Step 9: Broader codebase sweep for unused imports
   - Step 10: Final QA pass on mobile swap flow

---

## 📝 Notes

- **Version Bumping:** To force re-acceptance, update `CURRENT_REQUIRED_VERSION` in `beta-terms.ts` and redeploy. Users will be prompted on their next visit.
- **Admin Version Control:** Use the PUT endpoint with service role key to update version without redeploy.
- **Privacy:** IP addresses are never stored raw — only salted SHA-256 hashes (first 16 hex chars).
- **Fail-Safe:** If server is unreachable, gate still works via localStorage (fail-open for existing users, fail-closed for new users).

---

**Deployment Date:** _[To be filled after deployment]_
**Tested By:** _[To be filled]_
**Production URL:** `https://<project-id>.supabase.co/functions/v1/make-server-54299934`

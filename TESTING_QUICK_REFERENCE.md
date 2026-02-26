# Beta Terms Gate — Quick Testing Reference Card

## 🚀 Deploy Command
```bash
supabase functions deploy
```

## 📌 Essential Test Endpoints

### 1. Health Check
```bash
curl "https://<PROJECT_ID>.supabase.co/functions/v1/make-server-54299934/health"
```
✅ Expected: `{"ok":true}`

### 2. Required Version
```bash
curl "https://<PROJECT_ID>.supabase.co/functions/v1/make-server-54299934/beta-terms/required-version" \
  -H "Authorization: Bearer <ANON_KEY>"
```
✅ Expected: `{"requiredVersion":"2026.02.25.1"}`

### 3. Log Acceptance
```bash
curl -X POST "https://<PROJECT_ID>.supabase.co/functions/v1/make-server-54299934/beta-terms/accept" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"version":"2026.02.25.1","viewport":{"width":1920,"height":1080}}'
```
✅ Expected: `{"ok":true,"totalAcceptances":1}`

### 4. Get Stats
```bash
curl "https://<PROJECT_ID>.supabase.co/functions/v1/make-server-54299934/beta-terms/stats?version=2026.02.25.1" \
  -H "Authorization: Bearer <ANON_KEY>"
```
✅ Expected: `{"totalAcceptances":1}`

---

## 🖥️ Frontend Testing Checklist

### Initial Load
- [ ] Clear localStorage in DevTools
- [ ] Reload page → Gate appears
- [ ] Logo + "Closed Beta" badge visible
- [ ] Warning banner shows

### Scroll UX
- [ ] Blue progress bar advances as you scroll
- [ ] "Scroll to continue" indicator visible
- [ ] Toggle remains disabled until bottom reached
- [ ] Indicator disappears at bottom (±20px tolerance)
- [ ] Toggle becomes enabled

### Acceptance Flow
- [ ] Toggle turns blue when clicked
- [ ] "Enter WRAPpDEX" button enables
- [ ] Click button → smooth fade-out
- [ ] Console logs: `[BetaTerms] Acceptance logged to server — total: X`

### Persistence
- [ ] Reload page → no gate shown
- [ ] localStorage key: `wrappdex_beta_tos_v_2026.02.25.1 = "1"`

---

## 🔍 Server Logs to Watch

**Supabase Dashboard → Functions → Logs**

Look for:
```
[BetaTerms] Acceptance logged — version=2026.02.25.1, ipHash=abc123..., total=1, viewport=1920x1080
```

---

## 🐛 Quick Fixes

### Gate Not Appearing?
```javascript
// In browser DevTools console:
localStorage.clear()
location.reload()
```

### Server Not Logging?
Check CORS headers in Supabase Function logs. Should see:
```
Access-Control-Allow-Origin: *
```

### Version Mismatch?
```bash
# Force version update (requires service role key)
curl -X PUT "https://<PROJECT_ID>.supabase.co/functions/v1/make-server-54299934/beta-terms/required-version" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"version":"2026.02.25.1"}'
```

---

## 📱 Mobile Testing

**Chrome DevTools → Toggle Device Toolbar (Cmd+Shift+M)**

Test on:
- iPhone SE (320×568) — smallest target
- iPhone 12 (390×844) — most common
- iPad (768×1024) — tablet
- Landscape mode

Verify:
- [ ] All text readable (10px-11px base font)
- [ ] Toggle/button don't overflow
- [ ] Scroll works with touch
- [ ] Accept button visible without page scroll

---

## ♿ Accessibility Quick Check

### Keyboard
- [ ] Tab through all interactive elements
- [ ] Space/Enter toggles switch
- [ ] Arrow keys scroll content

### Screen Reader
- [ ] Heading announced: "Beta Testing Agreement"
- [ ] Warning announced
- [ ] Toggle role: "switch"
- [ ] Live region announces: "You have read the complete agreement..."

---

## 🎯 Success Criteria

✅ All API endpoints return expected responses  
✅ Frontend gate appears on first visit  
✅ Scroll-to-bottom enforcement works  
✅ Acceptance persists across page reloads  
✅ Server logs acceptances with privacy-preserving IP hash  
✅ No console errors  
✅ Mobile viewport displays correctly  
✅ Keyboard navigation works  

---

**Quick Command Reference:**

```bash
# View function logs (requires Supabase CLI)
supabase functions logs make-server-54299934

# Tail logs in real-time
supabase functions logs make-server-54299934 --tail

# Check function status
supabase functions list
```

---

**Environment Variables (verify in Supabase Dashboard):**
- ✅ `SUPABASE_URL` set
- ✅ `SUPABASE_ANON_KEY` set  
- ✅ `SUPABASE_SERVICE_ROLE_KEY` set

---

**Post-Deployment:**
1. Test all 4 endpoints above
2. Complete Frontend Testing Checklist
3. Verify server logs show acceptances
4. Test on mobile device
5. ✅ Mark DEPLOYMENT_CHECKLIST.md as complete

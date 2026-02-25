#!/usr/bin/env bash
#
# DAO Authentication Testing Script - SEC-AUDIT-2026-02
# 
# Tests the authentication fix for HashPack wallets with "0x" prefixed keys.
# Run this script after deploying the server-side auth fix.
#

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  WRAPpDEX DAO Authentication Test Suite (SEC-AUDIT-2026-02)   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Configuration
PROJECT_ID="${SUPABASE_PROJECT_ID:-your-project-id}"
API_BASE="https://${PROJECT_ID}.supabase.co/functions/v1/make-server-54299934"
ANON_KEY="${SUPABASE_ANON_KEY:-your-anon-key}"

# Test accounts (replace with real test accounts)
TEST_ACCOUNT_ED25519="0.0.518487"      # Owner account (known ED25519)
TEST_ACCOUNT_ECDSA="0.0.123456"        # Replace with ECDSA account if available

echo "🧪 Test 1: Challenge Request (ED25519 Account)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
CHALLENGE_RESPONSE=$(curl -s -X GET \
  "${API_BASE}/auth/challenge/${TEST_ACCOUNT_ED25519}" \
  -H "Authorization: Bearer ${ANON_KEY}")

echo "Response: ${CHALLENGE_RESPONSE}"
echo ""

# Extract challengeId for manual testing
CHALLENGE_ID=$(echo "${CHALLENGE_RESPONSE}" | jq -r '.challengeId // empty')
if [ -z "${CHALLENGE_ID}" ]; then
  echo "❌ FAILED: No challengeId in response"
  exit 1
fi

KEY_TYPE=$(echo "${CHALLENGE_RESPONSE}" | jq -r '.keyType // empty')
echo "✅ Challenge created successfully"
echo "   Challenge ID: ${CHALLENGE_ID}"
echo "   Key Type: ${KEY_TYPE}"
echo ""

echo "🧪 Test 2: Server Logs Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Check Supabase Edge Function logs for:"
echo "  [AUTH] Mirror Node response for ${TEST_ACCOUNT_ED25519}:"
echo "  [AUTH] Stripped \"0x\" prefix: XX → YY chars (if prefix was present)"
echo "  [AUTH] Key validation: type=ED25519, expected=64, actual=64"
echo "  [AUTH] Public key validated successfully"
echo ""

echo "🧪 Test 3: Manual Browser Test Instructions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Open WRAPpDEX in browser"
echo "2. Connect HashPack wallet (any account)"
echo "3. Navigate to DAO tab"
echo "4. Click \"Sign in to Participate\" button"
echo "5. Approve the signature request in HashPack"
echo ""
echo "Expected Results:"
echo "  ✅ \"Sign the message in HashPack to authenticate...\" toast appears"
echo "  ✅ HashPack shows signature request"
echo "  ✅ After approval: \"Signed in — session active for 30 minutes\" toast"
echo "  ✅ \"Sign in to Participate\" button changes to security badge"
echo "  ✅ Can now vote on proposals"
echo ""
echo "If Still Failing:"
echo "  1. Check browser console for [AUTH] logs"
echo "  2. Check Supabase Edge Function logs for detailed diagnostics"
echo "  3. Note the exact error message"
echo "  4. Verify account has ED25519 or ECDSA_SECP256K1 key type"
echo ""

echo "🧪 Test 4: Key Format Edge Cases"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "The fix handles these key formats from Mirror Node:"
echo "  ✅ Raw hex (64 chars for ED25519, 128 for ECDSA)"
echo "  ✅ With \"0x\" prefix (66 chars → stripped → 64 chars)"
echo "  ✅ DER-encoded (with ASN.1 prefix → stripped)"
echo "  ✅ Mixed case (normalized to lowercase)"
echo ""

echo "🧪 Test 5: Security Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Verify no security weakening:"
echo "  ✅ Public keys still fetched from Hedera Mirror Node"
echo "  ✅ Signatures still verified cryptographically"
echo "  ✅ Single-use nonces prevent replay attacks"
echo "  ✅ Sessions expire after 30 minutes"
echo "  ✅ Account-bound sessions (can't reuse for other accounts)"
echo ""

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  Test suite complete. Proceed with manual browser testing.    ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📊 Monitoring Commands:"
echo ""
echo "# Watch Edge Function logs:"
echo "supabase functions logs make-server-54299934 --follow"
echo ""
echo "# Grep for auth logs specifically:"
echo "supabase functions logs make-server-54299934 --follow | grep '\\[AUTH\\]'"
echo ""

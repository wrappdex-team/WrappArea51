## DAO Authentication Fix - SEC-AUDIT-2026-02

**Issue**: DAO governance signing failed for HashPack wallets with error:
```
Sign-in failed: Invalid ED25519 key length: expected 64 hex chars, got 66
```

**Root Cause**:
The server-side authentication module (`/supabase/functions/server/auth.ts`) was validating public key length BEFORE stripping common prefixes like "0x". Hedera Mirror Node returns public keys in different formats depending on the wallet and key type:
- Some wallets prefix keys with "0x" (66 chars instead of 64)
- DER-encoded keys have an ASN.1 prefix that needs stripping
- ECDSA_SECP256K1 keys are 128 chars (64 bytes) vs ED25519's 64 chars (32 bytes)

**Security Impact**: 
- **HIGH PRIORITY** - Prevented legitimate users with certain HashPack wallet configurations from participating in DAO governance
- Authentication was failing at the public key validation stage, before any cryptographic operations
- Zero security risk from the fix - we're normalizing input format, not weakening validation

**Fix Applied** (2026-02-25):

### 1. **Normalized Public Key Format Handling**
```typescript
// Strip "0x" prefix if present (common in wallet responses)
if (rawKeyHex.startsWith("0x")) {
  rawKeyHex = rawKeyHex.substring(2);
}

// Strip ED25519 DER prefix if present (ASN.1 encoded public keys)
if (rawKeyHex.startsWith(ED25519_DER_PREFIX)) {
  rawKeyHex = rawKeyHex.substring(ED25519_DER_PREFIX.length);
}
```

### 2. **Key Type-Aware Length Validation**
```typescript
// Validate based on algorithm:
// - ED25519: 32 bytes = 64 hex characters
// - ECDSA_SECP256K1: 64 bytes = 128 hex characters
const expectedLength = keyData._type === "ED25519" ? 64 : 128;
if (rawKeyHex.length !== expectedLength) {
  return { error: `Invalid ${keyData._type} key length: expected ${expectedLength} hex chars, got ${rawKeyHex.length}` };
}
```

### 3. **Comprehensive Diagnostic Logging**
Added detailed console logging to track:
- Raw Mirror Node response (key type, length, preview)
- Each normalization step (prefix stripping)
- Final validation results
- Clear error messages with context

This enables rapid diagnosis of any future authentication issues without exposing sensitive key material.

**Testing Checklist**:
- [x] Code review for security implications
- [ ] Test with HashPack wallet (ED25519 key)
- [ ] Test with HashPack wallet (ECDSA_SECP256K1 key if available)
- [ ] Verify DAO voting works end-to-end
- [ ] Verify error messages are helpful for users
- [ ] Monitor server logs for successful authentication patterns

**Bank-Grade Security Maintained**:
✅ No weakening of cryptographic validation  
✅ All signatures still verified against Mirror Node public keys  
✅ Single-use nonces prevent replay attacks  
✅ 30-minute session TTL unchanged  
✅ Account-bound sessions (can't reuse token for different account)  
✅ CSPRNG for all random values (challenges, tokens)  
✅ Comprehensive audit logging

**Files Modified**:
- `/supabase/functions/server/auth.ts` (lines 114-159)

**Production Deployment Notes**:
- No database migrations required
- No frontend changes needed
- Existing sessions remain valid
- Public key cache will auto-refresh (10-min TTL)
- Zero downtime deployment possible

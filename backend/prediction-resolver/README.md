# Wrappdex Prediction Market Resolver (Backend)

This backend solves the biggest pain point we've had:

- User wallets (especially tester wallets) were getting `INVALID_SIGNATURE` when trying to post `CREATE_MARKET` and `PLACE_BET` messages directly via HashPack.
- Money was moving, but the on-chain event log on the HCS topic was failing.

## New Architecture (Recommended for Production)

**Frontend (any wallet):**
- User only signs HBAR transfers (the actual value movement).
- After the transfer succeeds, the frontend calls this backend with the transfer details + market parameters.

**Backend (using resolution key from Supabase kv or .env, e.g. 0.0.9006979):**
- Verifies the incoming transfer.
- Posts clean, reliable `CREATE_MARKET`, `PLACE_BET`, and `MARKET_RESOLVED` messages using the privileged resolution account.
- Uses Scheduled Transactions for payouts (more secure and auditable).
- Loads the private key securely from Supabase kv_store at startup (for Railway) or .env (local), never hard-coded.

This completely removes the user-paid HCS signing problem. The private key is never in the frontend or committed code.

## Setup (Testnet)

1. `cd backend/prediction-resolver`
2. `npm install`
3. Copy `.env.example` to `.env` and fill real values (never commit .env):
   - `RESOLUTION_ACCOUNT_ID=0.0.9006979`
   - `RESOLUTION_PRIVATE_KEY=...` (the private key for the resolution account — **never commit this**; for Railway, omit this var and provide SUPABASE_* instead)
   - `MASTER_TOPIC_ID=0.0.9017517`
   - `TREASURY_ACCOUNT_ID=0.0.9006841`
   - `SUPABASE_URL=...`
   - `SUPABASE_SERVICE_ROLE_KEY=...` (for loading private key from kv_store)
4. `npm run dev`

The server will:
- Expose HTTP endpoints the frontend can call after the user has paid.
- Poll the Mirror Node.
- On startup, load private key from Supabase if not in .env (for prod/Railway).
- Run auto-resolution and payout loops.

## Endpoints

- `POST /api/prediction/fast-game/create` — called after user pays creation fee + initial stake.
- `POST /api/prediction/bet` — called after user pays for a bet on an existing market.
- `POST /api/prediction/resolve` — admin/resolver posts resolution + triggers scheduled payouts.

## Security Notes (Production Grade)

- Never expose the resolution private key to the frontend.
- In production (Railway), do NOT set RESOLUTION_PRIVATE_KEY in env vars. Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (as secret) instead; the resolver loads the private key from your Supabase kv_store_54299934 at startup using the service role (which is RLS-protected to service_role only).
- Always verify incoming transfers on-chain before posting messages (done in the /bet and create endpoints).
- Use idempotency via HCS checks (PAYOUT_CLOSED etc.) to prevent duplicate.
- The admin routes use simple caller ID check (treasury account); for full prod, consider adding a shared secret or signed request for admin endpoints.
- The .env file (with real key) must never be committed (it is gitignored). Use .env.example for template.

## Scheduled Transactions

The `schedulePayout` function shows how to create Scheduled Transactions for winner payouts. These can be executed later by the resolver or automatically.

This is much safer than having the resolution key sign every single payout in real time.

## Next Steps (Recommended)

1. Wire the frontend (Predict.tsx) to call the backend endpoints **after** the user has successfully executed the HBAR transfer.
2. Remove or deprecate the direct user-paid HCS message calls for creation/betting (keep them only as fallback if needed).
3. Add proper database tracking of pending creations/bets (so the resolver knows what message to post when a transfer arrives).

This architecture finally lets **any wallet** create and bet on markets safely, while keeping the on-chain record clean and reliable.

---

Let me know when you're ready and I'll help wire the frontend calls to this backend.
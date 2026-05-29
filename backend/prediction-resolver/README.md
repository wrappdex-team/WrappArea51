# Wrappdex Prediction Market Resolver (Backend)

This backend solves the biggest pain point we've had:

- User wallets (especially tester wallets) were getting `INVALID_SIGNATURE` when trying to post `CREATE_MARKET` and `PLACE_BET` messages directly via HashPack.
- Money was moving, but the on-chain event log on the HCS topic was failing.

## New Architecture (Recommended for Production)

**Frontend (any wallet):**
- User only signs HBAR transfers (the actual value movement).
- After the transfer succeeds, the frontend calls this backend with the transfer details + market parameters.

**Backend (using resolution key 0.0.9006850):**
- Verifies the incoming transfer.
- Posts clean, reliable `CREATE_MARKET`, `PLACE_BET`, and `MARKET_RESOLVED` messages using the privileged resolution account.
- Uses Scheduled Transactions for payouts (more secure and auditable).

This completely removes the user-paid HCS signing problem.

## Setup (Testnet)

1. `cd backend/prediction-resolver`
2. `npm install`
3. Copy `.env.example` → `.env` and fill in:
   - `RESOLUTION_PRIVATE_KEY` (the private key for 0.0.9006850 — **never commit this**)
4. `npm run dev`

The server will:
- Expose HTTP endpoints the frontend can call after the user has paid.
- Poll the Mirror Node every 15s as a fallback.

## Endpoints

- `POST /api/prediction/fast-game/create` — called after user pays creation fee + initial stake.
- `POST /api/prediction/bet` — called after user pays for a bet on an existing market.
- `POST /api/prediction/resolve` — admin/resolver posts resolution + triggers scheduled payouts.

## Security Notes (Production Grade)

- Never expose the resolution private key to the frontend.
- In production, store the key in AWS KMS, Hashicorp Vault, or use a dedicated Hedera account with proper access controls.
- Always verify incoming transfers on-chain before posting messages.
- Use idempotency keys (marketId + transfer txId) to prevent duplicate messages.
- Add proper authentication (JWT / API keys) on the API routes in production.

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
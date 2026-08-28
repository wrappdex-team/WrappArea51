# WRAPpDEX DAO — Hedera TESTNET HCS (KZN-20260828-04)

Area 51 only. Never wrappdex.io / Wrappmvp10.

## Outcome

On wrapp-area51.vercel.app, eligible members **post ideas to KV only**. Admins promote an idea into a vote proposal **or** create a proposal. Each of those actions **TopicCreate**s a new Hedera TESTNET HCS topic. KV indexes `proposalId → topicId`. Eligibility: Mirror Node 100M HBAR.h **or** 1 Wrapped Ones NFT (whitepaper v2 §12), token IDs from env.

## Source of truth

| Layer | Role |
| --- | --- |
| Per-proposal Hedera **testnet** HCS topic | Canonical ledger for that proposal's `PROPOSAL_CREATE` and `VOTE`. `adminKey` + `submitKey` = treasury `0.0.9006841` only |
| Users | Do **not** submit to HCS. HashPack signs the session; **server** posts with treasury submit key |
| Operator `0.0.9006979` | Fee payer (prediction-escrow account refurbished). Not the topic admin |
| Supabase KV (`dao_v2_*`) | Indexer / cache only, including `proposalId → topicId`. Fail closed if operator/treasury keys unset (`DAO_HCS_UNCONFIGURED`) |
| Mirror Node via `DAO_MIRROR_NETWORK` | Eligibility and vote weight (FT/NFT). Not hardcoded mainnet. LP extra path stays mainnet `0.0.9356724` this PR |

Do **not** use an EVM Governor. Do **not** write DAO messages to mainnet HCS. Do **not** reuse Fast Games topic `0.0.9017517`. Do **not** rebuild Fast Games. Do **not** use a shared `DAO_HCS_TOPIC_ID` for create/vote.

## Eligibility

Token IDs come from **env** on Area 51 (testnet copies Kyle mints). Do not treat mainnet `0.0.9356476` / `0.0.10146181` as the only IDs.

- `DAO_HBARH_TOKEN_ID` / `VITE_DAO_HBARH_TOKEN_ID` — 100,000,000 display units **or**
- `DAO_NFT_TOKEN_ID` / `VITE_DAO_NFT_TOKEN_ID` — 1+ serials
- `DAO_MIRROR_NETWORK` — `testnet` or `mainnet` (FT/NFT Mirror). LP extra path stays mainnet `0.0.9356724` this PR.
- Token votes: `floor(balance / 100_000_000)` max 10
- NFT votes: `floor(nftCount / 3)` max 1
- Server re-verifies weight at vote time via Mirror Node
- HashPack ED25519/ECDSA session still required (SEC-01/SEC-02, 30 min TTL)
- **Create proposal** is **admin-only**. Eligible members post **ideas** to KV (`dao_v2_ideas` / `dao_v2_i:{id}`). Admins **promote** an idea into a vote proposal (then that proposal gets its own treasury-locked HCS topic; submitter `0.0.9006841` only)
- Founder `0.0.518487` unremovable. Extra admins `0.0.3967564`, `0.0.9715988` stay in KV (`dao_admin_accounts`) — do not drop
- Keep `dao_v2_*` shards and `prop-{8 hex}` IDs

LP votes exist in current code; this slice does **not** change LP math.

Treasury `0.0.9006841` (adminKey + submitKey only). Operator / fee payer `0.0.9006979` confirmed. Do not put keys in git. Do not read `resolution_private_key`.

## Env vars (names only — no keys in git)

Set on **Area 51** Vercel (public IDs) and the Supabase edge function (server). Secrets live in **Area 51 Supabase only**. Never commit values.

| Name | Where | Secret? | Shape |
| --- | --- | --- | --- |
| `DAO_HCS_NETWORK` | Supabase edge function | No | must be `testnet` |
| `DAO_HCS_OPERATOR_ID` | Supabase edge function | No | `0.0.9006979` (fee payer) |
| `DAO_HCS_OPERATOR_KEY` | Area 51 Supabase only | **Yes** | operator private key (placeholder empty in git) |
| `DAO_HCS_TREASURY_ID` | Supabase edge function | No | `0.0.9006841` (adminKey + submitKey) |
| `DAO_HCS_TREASURY_KEY` | Area 51 Supabase only | **Yes** | treasury private key (placeholder empty in git) |
| `DAO_HBARH_TOKEN_ID` | Supabase edge | No | testnet FT id, `0.0.<digits>` |
| `DAO_NFT_TOKEN_ID` | Supabase edge | No | testnet NFT id, `0.0.<digits>` |
| `DAO_MIRROR_NETWORK` | Supabase edge | No | `testnet` or `mainnet` (FT/NFT only) |
| `VITE_DAO_HBARH_TOKEN_ID` | Vercel / frontend | No | same FT id for UI |
| `VITE_DAO_NFT_TOKEN_ID` | Vercel / frontend | No | same NFT id for UI |
| `VITE_DAO_HCS_TOPIC_ID` | Vercel / frontend | No | unused leftover; per-proposal `topicId` is on the proposal |

`DAO_HCS_TOPIC_ID` is **not** required for create/promote/vote. A leftover value equal to `0.0.9017517` is rejected. TopicCreate result equal to that id is rejected.

If operator/treasury keys are unset: `503 DAO_HCS_UNCONFIGURED`. Wrong network: `DAO_HCS_TESTNET_ONLY`.

`GET /dao/hcs` returns `{ configured, network, operatorId, treasuryId, topics: "per-proposal" }` — never keys, never a shared topicId.

## HCS message schema (submitted this PR)

JSON, UTF-8, versioned. Keep under HCS 1 KiB when possible.

Admin create / admin promote (server TopicCreate, then submit to the new topic):

```json
{
  "v": 1,
  "type": "PROPOSAL_CREATE",
  "proposalId": "prop-...",
  "accountId": "0.0.x",
  "proposerType": "admin",
  "title": "...",
  "category": "Governance",
  "durationDays": 7,
  "ts": 0
}
```

Promote uses `proposerType: "promote"` and includes `ideaId`. `accountId` is the admin doing the promote.

Vote (after Mirror weight, to **that proposal's** topic, then KV):

```json
{
  "v": 1,
  "type": "VOTE",
  "proposalId": "prop-...",
  "accountId": "0.0.x",
  "direction": "for",
  "weight": 1,
  "ts": 0
}
```

If TopicCreate or PROPOSAL_CREATE submit fails, the request fails and **no KV proposal is written**. If VOTE submit fails, the request fails and **no voterLog KV write**. Ideas (`POST /dao/ideas`) stay KV-only.

`proposerType` is `admin` | `promote` (`human`/`agent` path later; allowlisted testnet key).

## This PR

**This PR:** TopicCreate per admin-created or admin-promoted proposal (adminKey + submitKey = treasury `0.0.9006841`); server submits `PROPOSAL_CREATE` and `VOTE`; operator `0.0.9006979` fee payer; KV `proposalId → topicId`. Users HashPack-sign the session only. Fail closed if keys missing. Member ideas stay KV. Create stays admin-only.

**Not this work:** Fast Games rewrite; shared DAO topic; reusing `0.0.9017517`.

## Done-when (full Kaizen)

1. Each new proposal creates a testnet HCS topic (treasury keys only)
2. Create-proposal + vote: HashPack sign, server posts to that topic
3. KV indexes `proposalId → topicId`
4. Gate unchanged (env token IDs)
5. Live demo untouched
6. Ping KAIZEN Done

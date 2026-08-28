# WRAPpDEX DAO — Hedera TESTNET HCS (KZN-20260828-04)

Area 51 only. Never wrappdex.io / Wrappmvp10.

## Outcome

On wrapp-area51.vercel.app, an eligible HashPack wallet creates a proposal and votes on **one Hedera TESTNET HCS topic**. KV is indexer only. Eligibility stays Mirror Node: 100M HBAR.h **or** 1 Wrapped Ones NFT (whitepaper v2 §12).

## Source of truth

| Layer | Role |
| --- | --- |
| Hedera testnet HCS topic | Canonical ledger for `PROPOSAL_CREATE` and `VOTE` |
| Supabase KV (`dao_v2_*`) | Indexer / cache only. Must not accept create/vote if the topic ID is unset |
| Mirror Node **mainnet** | Eligibility and vote weight (real HBAR.h + Wrapped Ones) |

Do **not** use an EVM Governor. Do **not** write DAO messages to mainnet HCS in this slice.

## Eligibility

Token IDs come from **env** on Area 51 (testnet copies Kyle mints). Do not treat mainnet `0.0.9356476` / `0.0.10146181` as the only IDs.

- `DAO_HBARH_TOKEN_ID` / `VITE_DAO_HBARH_TOKEN_ID` — 100,000,000 display units **or**
- `DAO_NFT_TOKEN_ID` / `VITE_DAO_NFT_TOKEN_ID` — 1+ serials
- `DAO_MIRROR_NETWORK` — `testnet` or `mainnet` (FT/NFT Mirror). LP extra path stays mainnet `0.0.9356724` this PR.
- Token votes: `floor(balance / 100_000_000)` max 10
- NFT votes: `floor(nftCount / 3)` max 1
- Server re-verifies weight at vote time via Mirror Node
- HashPack ED25519/ECDSA session still required (SEC-01/SEC-02, 30 min TTL)
- **Create** is eligible-wallet (Mirror gate), not admin-only
- Founder `0.0.518487` unremovable. Extra admins `0.0.3967564`, `0.0.9715988` stay in KV (`dao_admin_accounts`) — do not drop
- Keep `dao_v2_*` shards and `prop-{8 hex}` IDs

LP votes exist in current code; this slice does **not** change LP math.

Public testnet treasury ID: `0.0.9006841`. Likely operator `0.0.9006979` pending Kyle confirm. Do not put keys in git. Do not read `resolution_private_key`.

## Env vars (no keys in git)

Set on **Area 51** Vercel (public) and the Supabase edge function (server). Never commit values.

| Name | Where | Secret? | Shape |
| --- | --- | --- | --- |
| `DAO_HCS_TOPIC_ID` | Supabase edge function | No (topic IDs are public) | `0.0.<digits>` testnet topic |
| `DAO_HCS_NETWORK` | Supabase edge function | No | must be `testnet` |
| `VITE_DAO_HCS_TOPIC_ID` | Vercel / frontend | No | same id, HashScan links only |
| `DAO_HBARH_TOKEN_ID` | Supabase edge | No | testnet FT id, `0.0.<digits>` |
| `DAO_NFT_TOKEN_ID` | Supabase edge | No | testnet NFT id, `0.0.<digits>` |
| `DAO_MIRROR_NETWORK` | Supabase edge | No | `testnet` or `mainnet` (FT/NFT only) |
| `VITE_DAO_HBARH_TOKEN_ID` | Vercel / frontend | No | same FT id for UI |
| `VITE_DAO_NFT_TOKEN_ID` | Vercel / frontend | No | same NFT id for UI |

Operator / treasury **private keys** are not used in this first PR. CEO creates the testnet topic in HashPack and pastes the topic ID into Area 51 env. Keys, if later needed for submit, live only in Area 51 Vercel/Supabase secrets — never git, chat, or agent memory.

If `DAO_HCS_TOPIC_ID` is missing or not `0.0.digits`, create and vote **fail closed** (`DAO_HCS_UNCONFIGURED`). KV-only writes are not allowed.

## HCS message schema (next PR will submit these)

JSON, UTF-8, versioned. Keep under HCS 1 KiB when possible.

```json
{
  "v": 1,
  "type": "PROPOSAL_CREATE",
  "proposalId": "prop-...",
  "accountId": "0.0.x",
  "proposerType": "human",
  "title": "...",
  "category": "Governance",
  "durationDays": 7,
  "ts": 0
}
```

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

`proposerType` is `human` | `agent` (agent path later; allowlisted testnet key).

## This PR vs remaining work

**This PR:** spec + read/validate topic ID from env + fail-closed create/vote if unset.

**Needs CEO next:** HashPack testnet operator, treasury, create the HCS topic, paste `DAO_HCS_TOPIC_ID` into Area 51 env, Hgraph connect.

**Next code:** submit `PROPOSAL_CREATE` / `VOTE` to that topic (operator from env, never git), KV indexes after a successful HCS receipt.

## Done-when (full Kaizen)

1. Testnet HCS topic ID recorded in Area 51 env
2. Create-proposal writes to that topic
3. Vote writes to that topic with Mirror Node weight
4. Gate unchanged
5. Live demo untouched
6. Ping KAIZEN Done

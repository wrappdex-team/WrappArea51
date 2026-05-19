# WRAPPDEX Prediction Markets — Smart Contracts

**Status:** v1 Production Foundation (Security Hardened)  
**Chain:** Hedera EVM (chainId 296 testnet, 295 mainnet)  
**Solidity:** 0.8.20 (OpenZeppelin 5.0.1)

## Architecture

- **PredictionMarket.sol** — Individual binary market contract.
  - Parimutuel payout model: winners split entire net pool proportionally.
  - 1.5% platform fee skimmed on every bet (sent to treasury immediately).
  - 5 HBAR creation fee + min ~100 HBAR initial liquidity enforced at factory.
  - 2-hour resolution delay after endTime (anti-front-running / monitoring window).
  - Full AccessControl (RESOLVER_ROLE, PAUSER_ROLE, CANCELLER_ROLE) granted to factory.
  - ReentrancyGuard + Pausable + CEI on every critical path.
  - Custom errors + rich events for indexers.

- **MarketFactory.sol** — Registry + deployment + fee collection + authorized resolution gateway.
  - Anyone can create (pays fees).
  - Central point for resolution (multi-sig / oracle calls factory.resolveMarket).
  - Emergency cancel for all markets.

## Security Measures Implemented

1. **No reentrancy** — Guard on placeBet, claimWinnings, create.
2. **No integer overflow** — Solidity 0.8+ checked arithmetic.
3. **Access control** — Roles instead of tx.origin / owner only.
4. **Pull payments** — Winners must call claim (no push loops).
5. **Timelock on resolution** — 2h delay after market close.
6. **Fee extraction before state update** + forward to treasury (no accumulation risk).
7. **Min bet + min pool** — Griefing / spam prevention.
8. **Initial liquidity seeding split 50/50** — Prevents 0-pool division attacks.
9. **Pausable everywhere** — Emergency circuit breaker.
10. **Events for everything** — Enables real-time indexing via Hedera mirror + subgraphs later.
11. **No delegatecall / selfdestruct / tx.origin** usage.
12. **Treasury is immutable per market** (factory can be upgraded by new deploy + role transfer).

## Resolution Model (v1 → Decentralized Roadmap)

**Current (v1):** Trusted resolver (admin EOA or multisig) calls `factory.resolveMarket(market, outcome)`.
- Must wait endTime + 2h.
- Can be called by any account granted RESOLVER_ROLE on the factory.

**Next (recommended):**
- Deploy a ResolutionOracle contract that accepts signed attestations from a set of oracles or reads HCS (Hedera Consensus Service) topic messages for immutable event outcomes.
- Or integrate Chainlink Functions / API for "will price reach X" markets.
- Add a 24-48h dispute window where DAO can veto a resolution before finality (claim window opens after).

## Deployment

1. `cp .env.example .env`
2. Export `HEDERA_EVM_PRIVATE_KEY=0x...` (funded testnet HBAR EVM account)
3. `npx hardhat compile`
4. `npx hardhat test contracts/test/PredictionMarket.test.ts --network hardhat`
5. `npx hardhat run contracts/scripts/deploy-prediction-markets.ts --network hederaTestnet`

Update the generated `contracts/deployment.json` address into frontend config.

**Verification:** Use HashScan or `hardhat verify` once Sourcify/Hedera verifier supports the network.

## Frontend Integration

See `src/app/utils/predictionMarkets.ts` (to be created by integration pass) + `Predict.tsx` (internal data sources swapped, JSX 100% preserved).

## Fee Split (per architecture doc)

- Creation: 5 HBAR → treasury (100%)
- Trading: 1.5% of every bet → treasury (100% for v1; future 60/40 treasury vs insurance / incentives)
- Resolution: 2 HBAR flat can be deducted on resolve or as % of winning pool (v1 uses the trading fee only; flat can be added in future claim math)

## Known Limitations (v1)

- No on-chain oracle yet (human / multisig resolution)
- No AMM bonding curve (simple parimutuel + seed)
- No dispute UI (off-chain monitoring + cancel possible)
- Claim UI not in original Predict mock (future "My Positions" panel can be added without touching existing JSX)
- Initial markets seeded only on testnet deploy (mainnet starts empty or via admin script)

This foundation is audit-ready. All classic prediction market attack vectors (reentrancy on claims, front-running resolution, tiny bet griefing, zero-pool division, unauthorized resolve) have been mitigated.

© 2026 WRAPPDEX — Security First.

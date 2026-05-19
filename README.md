# WRAPpDEX

> Institutional-grade decentralized exchange and on-chain Prediction Markets platform built natively on Hedera Hashgraph.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built on Hedera](https://img.shields.io/badge/Built%20on-Hedera-00A3E0?logo=hedera)](https://hedera.com)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://vercel.com)

**WRAPpDEX** delivers sub-3-second finality, native HashPack integration, real-time trading, cross-chain bridging, DAO governance, and fully on-chain **Prediction Markets** — all with institutional security standards.

Live: [wrappdex.io](https://www.wrappdex.io)

---

## Features

- **High-Performance DEX** — Instant swaps, limit orders, and deep liquidity on Hedera.
- **Real-Time Charts & Analytics** — Professional-grade trading interface with candlesticks, order book, and on-chain data.
- **Cross-Chain Bridging** — Seamless movement of assets via HashPort, Squid, and other trusted bridges.
- **DAO Governance** — On-chain proposals, voting, and treasury management via the WRAPpDEX DAO.
- **VIP Features** — Premium themes, sounds, and glow for eligible token/NFT holders.
- **On-Chain Prediction Markets** — Binary Yes/No markets with parimutuel payouts, role-gated resolution, 2-hour delay, and full on-chain settlement (new v1 engine).
- **Native Wallet Experience** — First-class HashPack support + WalletConnect + MetaMask EVM (no heavy third-party wallet SDKs).

---

## Prediction Markets (Highlight)

The newest flagship feature: fully on-chain binary prediction markets.

- Parimutuel payouts with platform fee (1.5%)
- 18-decimal EVM precision on Hedera
- 2-hour resolution delay + role-based resolver
- 90-day claim protection window
- Emergency pause + cancel controls
- Graceful demo mode when factory not deployed

Markets are created and settled directly on Hedera EVM. The frontend is 100% integrated into the existing WRAPpDEX UI with zero branding or UX deviation.

See `contracts/PredictionMarket.sol` + `MarketFactory.sol` and `src/app/utils/predictionMarkets.ts`.

---

## How It Works

1. Connect with HashPack (or EVM wallet for markets).
2. Trade, provide liquidity, bridge, or participate in DAO.
3. For Prediction Markets: create or bet on real-world events with on-chain resolution.
4. VIP users unlock cosmetic and sound enhancements.

All core logic lives on Hedera (smart contracts + Mirror Node + Consensus Service where applicable). No custodial risk.

---

## Security

- Multiple independent security reviews performed (see `docs/SEC-AUDIT-*.md`).
- OpenZeppelin v5 patterns in contracts (ReentrancyGuard, AccessControl, Pausable).
- Strict CEI ordering + pull-based payouts.
- 18-decimal standardization for Hedera EVM.
- No Dynamic Labs / heavy wallet SDKs in production bundle (native HashPack + WalletConnect only).
- Content-Security-Policy + strict referrers in production.
- .env.example + never-committed private keys for deployments.

**Responsible Disclosure**: See `.github/SECURITY.md`.

---

## Roadmap

- [x] Core DEX + charts + bridging
- [x] DAO governance + VIP system
- [x] On-chain Prediction Markets v1 (binary, parimutuel, secure resolution)
- [ ] HCS-based oracle resolution for markets
- [ ] Advanced order types & limit book on-chain
- [ ] Mobile-first PWA enhancements
- [ ] More cross-chain routes + HTS native support

---

## Tech Stack

**Frontend**
- Vite + React 18 + TypeScript + Tailwind
- Recharts / Lightweight Charts
- Native HashPack + WalletConnect + MetaMask

**Smart Contracts**
- Solidity 0.8.20+ on Hedera EVM (Hardhat)
- OpenZeppelin v5
- Parimutuel Prediction Market engine

**Infrastructure**
- Hedera Mirror Node + JSON-RPC
- Supabase (edge functions, storage for logos)
- Vercel (edge + static)

**Prediction Markets Specific**
- 18-decimal native value handling
- Factory + per-market contracts
- Role-gated resolution with timelock

---

## Getting Started (Local)

```bash
git clone https://github.com/<your-org>/wrapparea51.git
cd wrapparea51
npm install
npm run dev
```

For Prediction Markets contracts:

```bash
cp .env.example .env
# fill HEDERA_EVM_PRIVATE_KEY (testnet only)
npx hardhat compile
npx hardhat run contracts/scripts/deploy-prediction-markets.ts --network hederaTestnet
```

Update the factory address in `src/app/utils/predictionMarkets.ts`.

---

## Deployment

- **Vercel** (recommended): Connect repo → `npm run build` → Deploy. Uses `vercel.json` for SPA routing.
- Contracts are deployed separately via Hardhat (see `contracts/README.md`).

---

## Contributing

We welcome contributions from the Hedera and broader DeFi community.

Please read:
- [CONTRIBUTING.md](.github/CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md)

Good first issues are labeled `good first issue`.

---

## Security

See [SECURITY.md](.github/SECURITY.md) for reporting vulnerabilities.

We take security seriously — especially around Prediction Market resolution, fee handling, and wallet integrations.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Links

- Website: [wrappdex.io](https://www.wrappdex.io)
- Twitter / X: [@WRAPpDEX](https://x.com/WRAPpDEX)
- Discord: [Community](https://discord.com/invite/8w36D2TGc)
- Contracts: `contracts/` (audited patterns, open for review)
- Prediction Markets: `contracts/PredictionMarket.sol` + frontend integration in `src/app/utils/predictionMarkets.ts`

---

**Built with ❤️ on Hedera. Designed for institutions. Open for the community.**

*This repository contains the complete frontend + smart contract sources for WRAPpDEX.*
  

**Institutional-Grade DeFi Exchange on Hedera Hashgraph**

Premium trading platform with CLPR, wrapped assets, and upcoming prediction markets.

## Features
- Swap & Trade Terminal
- Bridge with CLPR
- DeFi modules
- DAO governance
- Prediction Markets (coming soon)

Live at [wrappdex.io](https://wrappdex.io)

## Tech Stack
- Hedera Hashgraph
- React + Vite + TypeScript
- Tailwind + shadcn/ui
- HashPack + WalletConnect

## Roadmap
- Prediction Markets on CLPR-wrapped tokens
- Full DAO activation at ~$2M MCAP
- Hgraph MCP integration

Join the community and help us build the future of DeFi on Hedera!
 main

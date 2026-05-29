# WRAPpDEX

**The most exciting thing you can actually do on Hedera today.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built on Hedera](https://img.shields.io/badge/Built%20on-Hedera-00A3E0?logo=hedera)](https://hedera.com)
[![HCS Native](https://img.shields.io/badge/HCS-Native-00A3E0)](https://hedera.com)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://vercel.com)

**Play short-duration parimutuel prediction games on HBAR price that settle automatically in ~28 seconds.**  
Fully on-chain via Hedera Consensus Service. Beautiful cryptographic receipts. Real money. Real settlement.

Backed by a powerful DeFi hub with native SaucerSwap routing, 1inch aggregation, and best-in-class bridges (HashPort, Squid, Stargate).

Live: [wrappdex.io](https://www.wrappdex.io)

---

## The Hedera Fast Games Experience

> **This is the heart of WRAPpDEX** — the most advanced on-chain prediction experience you can actually play on Hedera today.

**Key Highlights**
- **~28 Second Automatic Payouts** — Games resolve and pay winners automatically via a dedicated resolver.
- **Private Hashgraph Game Tickets** — Rich, beautiful on-chain receipts with profit multiples, fishing data, and multiple direct HashScan proof links.
- **Fully Immutable on HCS** — Every bet, resolution, and payout is permanently recorded on Hedera Consensus Service (topic `0.0.9017517`).
- **Reliable Portfolio & Claims** — Real-time history and claimables powered by our resolver "belt" — no more vanishing data or flaky Mirror calls.

**Why this matters on Hedera:**  
Traditional prediction markets take hours or days to settle. WRAPpDEX Fast Games deliver sub-30-second finality with full cryptographic provenance.

| Feature                    | WRAPpDEX Fast Games          | Traditional Markets / Other Chains |
|---------------------------|------------------------------|------------------------------------|
| Settlement Time           | ~28 seconds (automatic)      | Hours to days                      |
| Data Source               | Hedera Consensus Service     | Oracles or slow finality           |
| Receipts                  | Rich on-chain tickets        | Basic transaction logs             |
| Audit Trail               | Permanent + human readable   | Often fragmented                   |

<!-- Screenshot Placeholder: Fast Games interface + example "Private Hashgraph Game Ticket" receipt -->

---

## What You Can Play Right Now

| Experience       | Description                                                                 | Key Integrations                          | Access    |
|------------------|-----------------------------------------------------------------------------|-------------------------------------------|-----------|
| **Predict**      | Short-duration (10/20 min) parimutuel HBAR price games with auto-payouts   | HCS + Resolver                            | Open      |
| **Swap**         | High-performance token swapping on Hedera                                  | SaucerSwap (primary) + 1inch Fusion+     | VIP       |
| **Bridges**      | Move assets cross-chain with trusted routes                                | HashPort (official), Squid, Stargate      | Open      |
| **Trade**        | Advanced charts and trading interface                                      | Real-time data + on-chain execution       | Open      |
| **DeFi**         | Lending, borrowing, and yield opportunities                                | Bonzo + other protocols                   | Open      |
| **DAO**          | On-chain governance and proposals                                          | Treasury + voting                         | Open      |

<!-- Screenshot Placeholder: Main navigation + Predict page overview -->

---

## Swap & Liquidity Engine

Trade directly on Hedera with two powerful routing options:

- **SaucerSwap Native** — Primary route with deep Hedera liquidity, multi-hop support, and full on-chain execution via HashPack.
- **1inch Fusion+** — Advanced aggregation for EVM chains (Ethereum, Arbitrum, Polygon, Base, and more).

The Swap experience is currently available to VIP users (token or NFT holders).

<!-- Screenshot Placeholder: Swap interface showing SaucerSwap + 1inch routing options -->

---

## Cross-Chain Power — Bridges

Move assets confidently between Hedera and the rest of the ecosystem:

- **HashPort** — The official, audited Hedera bridge (Hedera ↔ EVM).
- **Squid (Axelar)** — 60+ chains with cross-chain swaps and transfers.
- **Stargate (LayerZero)** — Omnichain liquidity with instant finality.

Each bridge is presented with clear branding, fees, and expected times so you always know what you're using.

<!-- Screenshot Placeholder: Bridges selection screen with HashPort, Squid, and Stargate options -->

---

## Deep Hedera Integration

WRAPpDEX is built *natively* for Hedera, not just deployed on it.

- Short-duration prediction games recorded directly on the Hedera Consensus Service.
- A dedicated resolver backend ensures reliable data and automatic payouts.
- Native HashPack experience with first-class HTS token support.
- Sub-3-second finality for most operations.

This is real Hedera DeFi — fast, cheap, and cryptographically verifiable.

---

## The Full Platform

- **Wallet** — Multi-chain asset view (Hedera + EVM + Solana)
- **Buy/Sell** — On and off-ramps
- **VIP Perks** — Custom themes, sounds, and visual effects for eligible holders
- **Security & Audit** — Multiple reviews + transparent reporting

---

## Trust & Reality

- All Fast Game activity is permanently anchored to Hedera Consensus Service.
- Portfolio data is served through a hardened resolver layer for reliability.
- Multiple independent security reviews performed (see `docs/SEC-AUDIT-*.md`).
- No heavy third-party wallet SDKs in the core bundle.

**Current Status**: The Predict experience and Bridges are fully open. Swap is currently VIP-gated while we continue hardening routing and liquidity depth.

---

## Getting Started

1. Visit [wrappdex.io](https://www.wrappdex.io)
2. Connect your HashPack wallet (best experience for Hedera-native features)
3. Head to **Predict** and try a Fast Game — the most exciting part of the platform today
4. Explore **Bridges** (fully open) or **Swap** (currently VIP)

All core activity is recorded on Hedera. No middlemen holding your funds.

---

## Links & Community

- **Live App**: [wrappdex.io](https://www.wrappdex.io)
- **Twitter / X**: [@WRAPpDEX](https://x.com/WRAPpDEX)
- **Discord**: [Join the community](https://discord.com/invite/8w36D2TGc)

---

**Built with ❤️ on Hedera.**

*This repository contains the frontend + backend resolver for WRAPpDEX.*

---

### For Contributors

The project combines:
- A sophisticated React + TypeScript frontend
- A Node.js resolver backend that reliably indexes HCS data
- Real integrations with SaucerSwap, 1inch, HashPort, Squid, and Stargate

See the code for the full picture. Good first issues are welcome.



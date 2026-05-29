# WRAPpDEX

> **Fast. On-Chain. Hedera-Native.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built on Hedera](https://img.shields.io/badge/Built%20on-Hedera-00A3E0?logo=hedera)](https://hedera.com)
[![Live](https://img.shields.io/badge/Live%20on-wrappdex.io-black?logo=vercel)](https://wrappdex.io)

Play short-duration parimutuel prediction games on HBAR price that settle automatically in **~28 seconds** with beautiful cryptographic receipts. Real money. Real settlement. Powered directly by the Hedera Consensus Service.

Backed by a capable DeFi hub: native SaucerSwap routing, 1inch aggregation, and best-in-class bridges (HashPort, Squid, Stargate).

**Live:** [wrappdex.io](https://wrappdex.io)

---

## The Hedera Fast Games Experience

This is the one thing you can do on Hedera today that feels genuinely new.

Short-duration (10 or 20 minute) parimutuel markets on HBAR price direction ("Higher" or "Lower"). Create a game or join as a predictor. When the window closes, the resolver settles automatically using reliable Hedera data. Winners claim proportional payouts in ~28 seconds.

Everything is recorded immutably on **Hedera Consensus Service topic 0.0.9017517** with rich structured memos — including bet sequencing, fees, and user context for perfect auditability.

### Why Players Love It

| ⚡ ~28 Second Automatic Payouts | 🎫 Private Hashgraph Game Tickets |
|--------------------------------|-----------------------------------|
| Sub-30s settlement after resolution. No waiting hours or days. The resolver acts as a reliable server-side "belt" for data accuracy (bypasses browser CSP/DNS issues). | Premium private receipts in your Portfolio & Claim Center. Profit multiples, entry "fishing data", multiple direct HashScan proof links. Only visible to you — derived purely from public HCS. |

| 🔗 Fully On-Chain via HCS | 📊 Real Portfolio & Claim Center |
|---------------------------|----------------------------------|
| No slow oracles. No centralized servers holding your bets. Immutable, human-readable memos + on-chain history pulled live via the resolver. | Track every game, claim winnings with one click, see your complete cryptographic audit trail. Duplicate-claim protection built in. |

### Fast Games vs Traditional Prediction Markets

| Aspect                  | WRAPpDEX Fast Games (HCS)              | Traditional / Other Chains              |
|-------------------------|----------------------------------------|-----------------------------------------|
| Resolution Window       | 10–20 minutes                          | 2+ hours (often days)                   |
| Settlement              | ~28 seconds automatic                  | Hours to days (oracle + manual)         |
| Audit Trail             | Rich HCS memos + multiple HashScan links | Basic on-chain events or off-chain      |
| Oracle Dependency       | None (resolver + Hedera consensus)     | Heavy (slow, expensive, centralized)    |
| Receipt Experience      | Beautiful private "Game Tickets"       | Generic tx hashes                       |
| Best For                | Fast, fun, real-money micro-prediction | Long-form event betting                 |

The only short-duration, automatically settled parimutuel games on Hedera with cryptographic receipts you’ll actually want to keep.

---

## What You Can Play Right Now

| Experience       | Status          | Highlights |
|------------------|-----------------|------------|
| **Predict (Fast Games)** ★★★★★ | Production (testnet) | 10/20-min HBAR Higher/Lower • ~28s auto-payouts • Rich private receipts • Full claim center |
| **Swap** ★★★★ | Active (VIP for full) | SaucerSwap V1/V2 primary (native HBAR↔WHBAR, multi-hop, pool routes) • 1inch Fusion+ for EVM chains • Server proxy for reliability |
| **Bridges** ★★★★ | Fully implemented | HashPort (official Hedera ↔ EVM) • Squid (Axelar, 60+ chains) • Stargate (LayerZero omnichain) — dedicated branded widgets |
| **DeFi** ★★★ | Active | Bonzo Finance lend & borrow integration |
| **DAO** ★★★ | Functional | On-chain proposals, voting, governance |
| **Trade** ★★★ | Active | Professional charts, order flow, real-time data |
| **Wallet** ★★★ | Active | Multi-chain view (Hedera + EVM + Solana) |
| **Buy/Sell** ★★★ | Active | Fiat on/off-ramp style flows |

Everything lives in one clean, premium interface with light/dark + VIP theming.

---

## Why This Feels Different on Hedera

Hedera Consensus Service gives us something no other chain delivers at this speed and cost:

- **Sub-30-second finality** for game resolution and payouts — the resolver watches the topic, computes proportional math server-side, and executes claims.
- **Immutable, human-readable memos** on every action (betSequence, fees, side, user). Perfect for players, auditors, and scripts.
- **No oracle lag or cost** for short-duration games. The resolver provides reliable pricing data as a trusted but transparent layer.
- **Beautiful private receipts** that feel like high-end trading confirmations, not just tx hashes.

This is parimutuel prediction markets done the Hedera way: fast, verifiable, and actually fun.

---

## Swap & Liquidity Engine

**Primary path: SaucerSwap (native Hedera excellence)**

- Direct V1 and V2 routing with real-time pool data (TVL, volume, fees).
- Multi-hop discovery, smart route selection, and native HBAR ↔ WHBAR wrapping.
- On-chain execution via HashPack — no middlemen.

**Secondary path: 1inch Fusion+ (advanced / EVM reach)**

- Aggregator access to deep liquidity on Ethereum, Polygon, BSC, Arbitrum, Optimism, Base.
- Server-side quote + build proxy for better reliability and cross-chain intent support.

**Note:** Full Swap interface is currently VIP-gated (token/NFT holdings unlock premium themes, sounds, glow, and advanced features). Non-VIP users can still explore the hub.

Supporting instant swaps via ChangeNOW affiliate integration (server-side redirects).

---

## Cross-Chain Access

Move assets in and out of Hedera with confidence:

- **HashPort** — The official Hedera bridge (Hedera ↔ EVM). Strongest native option with excellent branding and UX.
- **Squid (Axelar)** — 60+ chains, powerful cross-chain swaps + transfers in one widget.
- **Stargate (LayerZero)** — Omnichain liquidity, instant finality, unified experience.

Each bridge has its own dedicated, clearly branded widget inside the app. No guessing which route is best — just pick the one that matches your needs.

---

## The Full Platform

WRAPpDEX is a complete Hedera-native DeFi hub:

- **DeFi** — Lend, borrow, and earn via Bonzo Finance integration.
- **DAO** — Real governance. Create and vote on proposals that shape the protocol.
- **Trade** — Advanced terminal with lightweight charts, depth, and on-chain order awareness.
- **Wallet** — Clean multi-chain portfolio view (Hedera HTS + EVM + Solana).
- **Buy/Sell** — On-ramps and off-ramps for getting in and out with fiat.
- **VIP System** — Cosmetic and functional unlocks (themes, sounds, glow, full Swap access) based on holdings.

All modules share the same premium design language and Hedera-first wallet experience (HashPack native + EVM fallbacks).

---

## Trust, Security & Reality

We are honest about where we are:

- **Fast Games (Predict)**: Production-ready on testnet. ~28s automatic payouts with duplicate-claim protection and proportional math. Edge cases around extreme load or data freshness are actively monitored and improved.
- **Swap**: Strong native routing via SaucerSwap. 1inch path is implemented but shows occasional reliability notes in logs. VIP-gated for the full experience.
- **Bridges**: Fully functional widgets for three best-in-class providers, including the official Hedera bridge.
- **Legacy Layer**: Older EVM-based prediction market contracts exist in the repo history/backup. The active flagship is the HCS-native Fast Games. We do not lead with outdated 2-hour resolution experiences.

**Security Posture**
- Hedera Consensus Service as immutable source of truth for all Fast Games.
- Resolver operates with clear, auditable logic (open for review).
- Multiple security reviews performed (see `docs/SEC-AUDIT-*.md` and `docs/SEC-AUDIT-2026-02-DAO-AUTH-FIX.md`).
- OpenZeppelin v5 patterns in legacy contracts; strict CEI, pull-based payouts, and careful key handling throughout.
- Content-Security-Policy + production referrer hardening.
- Responsible disclosure: see `.github/SECURITY.md` or contact the team.

No overclaims. No hidden custodial risk. Everything that matters is verifiable on Hedera.

---

## Getting Started

1. **Visit the app** — [wrappdex.io](https://wrappdex.io)
2. **Connect HashPack** (recommended for the full native Hedera experience) or any EVM wallet for bridges/Swap.
3. **Try Predict (Fast Games)** — Create a 10- or 20-minute HBAR Higher/Lower game or join an existing one with real HBAR. Watch it resolve and claim in ~28 seconds.
4. **Open your Portfolio & Claim Center** — See your Private Hashgraph Game Tickets with full proof links and fishing data.
5. **Explore the hub** — Swap (if VIP), bridge assets via HashPort/Squid/Stargate, check DAO proposals, or use the Trade terminal.

**Need HBAR?** Use the built-in Buy/Sell flows or bridge from any major chain.

**Developers:** Full source (frontend + resolver backend + legacy contracts) is in this repository. See `DEPLOYMENT_CHECKLIST.md`, `MASTER_PLAN_Volume_Accuracy_Memos_Private_Receipts.md`, and `backend/prediction-resolver/`.

---

## Community & Links

- **Website:** [wrappdex.io](https://wrappdex.io)
- **X / Twitter:** [@WRAPpDEX](https://x.com/WRAPpDEX)
- **Discord:** [Join the community](https://discord.com/invite/8w36D2TGc)
- **GitHub:** [wrappdex-team/WrappArea51](https://github.com/wrappdex-team/WrappArea51)
- **Audits & Docs:** `docs/` folder (security reviews, deployment guides, master plans)
- **HashScan (Fast Games topic):** [0.0.9017517](https://hashscan.io/testnet/topic/0.0.9017517)

**The most exciting thing you can actually do on Hedera today.**

Built with care on Hedera Consensus Service. Open for the community.

---

*This repository contains the complete frontend, backend resolver, and supporting contracts for WRAPpDEX.*

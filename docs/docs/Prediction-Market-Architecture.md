# WRAPPDEX PREDICTION MARKET – FULL ARCHITECTURE DOCUMENT

**Version:** 1.0  
**Date:** May 10, 2026  
**Status:** Production-Ready Blueprint  
**Author:** Grok Agent + Wrappdex Team

---

## 1. Executive Summary

Wrappdex is building a professional-grade, on-chain prediction market platform on Hedera Hashgraph. The system combines real-time market data, AI-powered odds generation, and immutable resolution via Hedera Consensus Service (HCS).

The goal is to create the most trusted and liquid prediction market platform in the Hedera ecosystem.

---

## 2. Business Model

**Revenue Streams:**
- Market Creation Fee: 5 HBAR per market (fixed)
- Trading Fees: 1.5% on every bet (60/40 split)
- Resolution Fee: 2 HBAR paid by winning side
- Future: Premium analytics & AI signals

**Economic Design:**
- Minimum pool size: $100 HBAR (locked, irreversible)
- Maximum platform exposure: 2.5x initial pool
- Dynamic Fibonacci range scaling to reduce manipulation

---

## 3. High-Level System Architecture
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + Vite)                   │
│  - Predict Page (Heatmap + Create Market Modal)              │
│  - Real-time AI odds display                                 │
│  - Betting interface                                         │
└──────────────────────┬──────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│              BACKEND / API LAYER (Future: Node.js)           │
│  - Market creation endpoint                                  │
│  - AI Odds Engine integration                                │
│  - Hedera HCS topic management                               │
└──────────────────────┬──────────────────────────────────────┘
│
┌────────────┴────────────┐
▼                         ▼
┌──────────────────┐     ┌──────────────────────────────┐
│   CoinCap API    │     │   Hedera ML Pipeline         │
│ (Price Oracle)   │     │   (Odds Generation Engine)   │
└──────────────────┘     └──────────────┬───────────────┘
│
▼
┌──────────────────────┐
│  Hedera Consensus    │
│  Service (HCS)       │
│  - Market Creation   │
│  - Resolution Logs   │
└──────────────────────┘


---

## 4. Core Components

**4.1 Frontend**
- `Predict.tsx` – Main page + advanced Create Market modal
- Dynamic range calculation (Fibonacci scaling)
- + / - / ± movement type selector
- Live AI-generated odds + confidence score

**4.2 AI Odds Engine (Hedera ML Pipeline)**
- Real-time probability model
- Inputs: Historical volatility, on-chain volume, technical indicators
- Outputs: Implied probability, recommended Kelly size, volatility warning

**4.3 Resolution Layer**
- Primary: CoinGecko / Chainlink price oracles
- Secondary: Hedera Consensus Service (immutable audit trail)
- Dispute window: 24 hours

---

## 5. Detailed Data Flow (Market Creation)

1. User opens Create Market modal
2. Selects asset → Frontend pulls live price from CoinCap
3. User configures expiry, range, movement type, and pool size
4. **AI Odds Engine** calculates:
   - Implied probability
   - Recommended Kelly size
   - Volatility risk level
5. User confirms → pays 5 HBAR fee
6. Market is created on-chain via Hedera HCS Topic
7. Market appears in heatmap and becomes tradable

---

## 6. Security & Risk Management

**Key Protections:**
- Minimum $100 HBAR locked pool
- Maximum platform payout cap (2.5x pool)
- Dynamic range limits based on timeframe
- 24-hour dispute window
- All market creations logged immutably on HCS
- No private keys stored in frontend

**Future Enhancements:**
- Multi-oracle consensus
- AI anomaly detection
- Insurance fund

---

## 7. Technical Stack

| Layer              | Technology                              |
|--------------------|-----------------------------------------|
| Frontend           | React 18 + Vite + TypeScript + Tailwind |
| Styling            | Glassmorphism (Wrappdex design system)  |
| Blockchain         | Hedera Hashgraph (HCS + HTS)            |
| Oracles            | CoinCap + Chainlink (future)            |
| ML / AI            | Hedera ML Pipeline                      |
| Backend (Future)   | Node.js + Express + Hedera SDK          |

---

## 8. Next Steps (Recommended Order)

1. **Step 4** – Integrate Hedera ML Pipeline for real AI odds (Current)
2. **Step 5** – Connect real Hedera wallet transactions
3. **Step 6** – Build betting flow with real HBAR transfers
4. **Step 7** – Add market resolution engine
5. **Step 8** – Deploy to mainnet + security audit

---

**Document Status:** Production-Ready Blueprint  
**Next Update:** After AI Odds Engine integration is complete
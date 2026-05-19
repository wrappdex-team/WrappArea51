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
/**
 * SEO Head — Dynamic document head management
 *
 * Manages <title>, <meta> description, Open Graph, and Twitter Card tags
 * for each route. Uses useEffect to update document.head directly
 * (no external dependency needed).
 *
 * Usage:
 *   <SEOHead
 *     title="Trading"
 *     description="CEX-like trading terminal on Hedera"
 *     path="/trading"
 *   />
 */

import { useEffect } from "react";

interface SEOHeadProps {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
}

const BASE_TITLE = "WRAPpDEX";
const DEFAULT_DESC = "Decentralized exchange on the Hedera network — swap, trade, stake, and bridge with HashPack wallet integration.";
const DEFAULT_IMAGE = "https://www.wrappdex.io/og-image.png";
const BASE_URL = "https://www.wrappdex.io";

function setMeta(name: string, content: string, isProperty = false): void {
  const attr = isProperty ? "property" : "name";
  let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function SEOHead({ title, description, path, image }: SEOHeadProps) {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${BASE_TITLE}` : `${BASE_TITLE} — Decentralized Exchange`;
    const desc = description || DEFAULT_DESC;
    const url = path ? `${BASE_URL}${path}` : BASE_URL;
    const img = image || DEFAULT_IMAGE;

    // Document title
    document.title = fullTitle;

    // Standard meta
    setMeta("description", desc);

    // Open Graph
    setMeta("og:title", fullTitle, true);
    setMeta("og:description", desc, true);
    setMeta("og:url", url, true);
    setMeta("og:image", img, true);
    setMeta("og:type", "website", true);
    setMeta("og:site_name", BASE_TITLE, true);

    // Twitter Card
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", fullTitle);
    setMeta("twitter:description", desc);
    setMeta("twitter:image", img);

    // Canonical
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", url);
  }, [title, description, path, image]);

  return null;
}

/** Route-specific SEO configs */
export const ROUTE_SEO: Record<string, SEOHeadProps> = {
  "/": {
    title: "WRAPpDEX — Sovereign Digital Asset Infrastructure",
    description: "Wrappdex delivers high-performance decentralized custody and liquidity settlement. Built on the Hedera network for ultimate transparency and institutional security.",
    path: "/",
  },
  "/markets": {
    title: "Markets",
    description: "Live cryptocurrency market data with Chainlink oracle prices, real-time charts, and AI-powered market sentiment on the Hedera network.",
    path: "/markets",
  },
  "/trading": {
    title: "Trading",
    description: "CEX-like trading terminal with candlestick charts, technical indicators, and real-time order flow on the WRAPpDEX decentralized exchange.",
    path: "/trading",
  },
  "/swap": {
    title: "Swap",
    description: "Swap tokens on the Hedera network via SaucerSwap V1 router with HashPack wallet signing and real-time price feeds.",
    path: "/swap",
  },
  "/buy-sell": {
    title: "Buy & Sell",
    description: "Buy and sell crypto with fiat on-ramp, cross-chain swaps via ChangeNOW, and Hedera-native token swaps.",
    path: "/buy-sell",
  },
  "/defi": {
    title: "DeFi",
    description: "DeFi dashboard with staking, liquidity pools, lending via Bonzo Finance, and live SaucerSwap pool analytics on Hedera.",
    path: "/defi",
  },
  "/wallet": {
    title: "Wallet",
    description: "Multi-chain wallet dashboard showing Hedera HBAR, ERC-20 token balances, portfolio analytics, and transaction history.",
    path: "/wallet",
  },
  "/dao": {
    title: "DAO",
    description: "WRAPpDEX DAO governance — create proposals, vote with token and NFT holdings, and participate in community decisions.",
    path: "/dao",
  },
  "/bridges": {
    title: "Bridges",
    description: "Cross-chain bridge aggregator for transferring assets between Hedera and other blockchain networks.",
    path: "/bridges",
  },
  "/terms": {
    title: "Terms of Service",
    description: "WRAPpDEX Terms of Service — legal terms governing use of the WRAPpDEX decentralized exchange platform on the Hedera network.",
    path: "/terms",
  },
  "/privacy": {
    title: "Privacy Policy",
    description: "WRAPpDEX Privacy Policy — how we collect, use, and protect your information on the WRAPpDEX decentralized exchange platform.",
    path: "/privacy",
  },
  "/white-paper": {
    title: "White Paper",
    description: "The WRAPpDEX Wrapp Paper — institutional-grade DEX on Hedera. Platform overview, AMM engine, oracle pipeline, tokenomics, governance, and roadmap.",
    path: "/white-paper",
  },
  "/audit": {
    title: "Audit",
    description: "WRAPpDEX security audit reports and transparency disclosures for the Hedera-native decentralized exchange.",
    path: "/audit",
  },
  "/branding": {
    title: "Branding",
    description: "WRAPpDEX brand identity — logos, color palette, typography, and usage guidelines for the WRAPpDEX decentralized exchange.",
    path: "/branding",
  },
};
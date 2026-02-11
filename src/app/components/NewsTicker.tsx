import { useTheme } from "../contexts/ThemeContext";
import { useEffect, useRef, useState } from "react";

interface NewsItem {
  token: string;
  headline: string;
  url: string;
  source: string;
}

const NEWS_ITEMS: NewsItem[] = [
  { token: "BTC", headline: "Bitcoin institutional adoption continues to accelerate globally", url: "https://www.coindesk.com/markets/", source: "CoinDesk" },
  { token: "ETH", headline: "Ethereum ecosystem expands with new L2 scaling solutions", url: "https://www.coindesk.com/tech/", source: "CoinDesk" },
  { token: "SOL", headline: "Solana DeFi ecosystem sees growing developer activity", url: "https://www.theblock.co/", source: "The Block" },
  { token: "HBAR", headline: "Hedera network processes record enterprise transactions", url: "https://hedera.com/blog", source: "Hedera" },
  { token: "XRP", headline: "Ripple expands institutional payment solutions worldwide", url: "https://www.coindesk.com/business/", source: "CoinDesk" },
  { token: "ADA", headline: "Cardano governance framework enters next development phase", url: "https://www.coindesk.com/tech/", source: "CoinDesk" },
  { token: "AVAX", headline: "Avalanche subnet architecture attracts new use cases", url: "https://www.theblock.co/", source: "The Block" },
  { token: "DOT", headline: "Polkadot parachain ecosystem continues to grow", url: "https://www.coindesk.com/tech/", source: "CoinDesk" },
  { token: "LINK", headline: "Chainlink oracle network expands cross-chain coverage", url: "https://www.theblock.co/", source: "The Block" },
  { token: "BNB", headline: "BNB Chain ecosystem sees rising transaction throughput", url: "https://www.coindesk.com/tech/", source: "CoinDesk" },
  { token: "DOGE", headline: "Dogecoin community explores new utility and adoption paths", url: "https://www.coindesk.com/markets/", source: "CoinDesk" },
  { token: "LTC", headline: "Litecoin maintains strong hash rate with continued mining interest", url: "https://www.coindesk.com/markets/", source: "CoinDesk" },
  { token: "TRX", headline: "TRON stablecoin transfer volume remains elevated globally", url: "https://www.theblock.co/", source: "The Block" },
  { token: "PAXG", headline: "Tokenized gold demand rises alongside physical bullion markets", url: "https://www.coindesk.com/markets/", source: "CoinDesk" },
];

export function NewsTicker() {
  const { isDark } = useTheme();
  const tickerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [animDuration, setAnimDuration] = useState(120);

  useEffect(() => {
    if (innerRef.current) {
      const contentWidth = innerRef.current.scrollWidth / 2;
      // ~60px per second scroll speed
      const duration = Math.max(60, contentWidth / 60);
      setAnimDuration(duration);
    }
  }, []);

  const separator = (
    <span className={`mx-4 ${isDark ? "text-pink-500/60" : "text-pink-400/60"}`}>
      ◆
    </span>
  );

  const renderNewsItem = (item: NewsItem, index: number) => (
    <a
      key={`${item.token}-${index}`}
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 whitespace-nowrap transition-colors duration-200 ${
        isDark
          ? "text-slate-400 hover:text-pink-400"
          : "text-gray-500 hover:text-pink-600"
      }`}
    >
      <span
        className={`text-[10px] px-1 py-0.5 rounded ${
          isDark
            ? "bg-pink-500/15 text-pink-400"
            : "bg-pink-100 text-pink-600"
        }`}
      >
        {item.token}
      </span>
      <span className="text-[11px]">{item.headline}</span>
      <span className={`text-[9px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
        — {item.source}
      </span>
    </a>
  );

  // Duplicate items to create seamless loop
  const allItems = [...NEWS_ITEMS, ...NEWS_ITEMS];

  return (
    <div
      ref={tickerRef}
      className={`w-full overflow-hidden border-b ${
        isDark
          ? "bg-[#08080d] border-pink-900/15"
          : "bg-gray-50 border-gray-200"
      }`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        ref={innerRef}
        className={`inline-flex items-center py-1.5 ticker-scroll ${isPaused ? "ticker-paused" : ""}`}
        style={{ ["--ticker-duration" as string]: `${animDuration}s` }}
      >
        {allItems.map((item, i) => (
          <span key={`item-${i}`} className="inline-flex items-center">
            {renderNewsItem(item, i)}
            {separator}
          </span>
        ))}
      </div>

      <style>{`
        @keyframes tickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-scroll {
          animation: tickerScroll var(--ticker-duration, 120s) linear infinite;
        }
        .ticker-paused {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
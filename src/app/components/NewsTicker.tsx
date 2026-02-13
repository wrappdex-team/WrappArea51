import { useTheme } from "../contexts/ThemeContext";
import { useEffect, useRef, useState, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";

interface NewsItem {
  token: string;
  headline: string;
  url: string;
  source: string;
}

// Minimal fallback headlines shown while real data loads or if fetch fails
const FALLBACK_ITEMS: NewsItem[] = [
  { token: "BTC", headline: "Bitcoin continues as the leading digital asset by market capitalization", url: "https://www.coingecko.com/en/coins/bitcoin", source: "CoinGecko" },
  { token: "HBAR", headline: "Hedera Hashgraph — enterprise-grade distributed ledger technology", url: "https://hedera.com", source: "Hedera" },
  { token: "ETH", headline: "Ethereum ecosystem powering DeFi, NFTs, and L2 scaling solutions", url: "https://www.coingecko.com/en/coins/ethereum", source: "CoinGecko" },
];

const NEWS_ENDPOINT = `https://${projectId}.supabase.co/functions/v1/make-server-54299934/news`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (matches server cache TTL)

export function NewsTicker() {
  const { isDark } = useTheme();
  const tickerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [animDuration, setAnimDuration] = useState(120);
  const [newsItems, setNewsItems] = useState<NewsItem[]>(FALLBACK_ITEMS);
  const [lastFetch, setLastFetch] = useState(0);

  const fetchNews = useCallback(async () => {
    try {
      const resp = await fetch(NEWS_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${publicAnonKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`News fetch failed: ${resp.status}`);
      const data = await resp.json();
      if (data?.items?.length > 0) {
        setNewsItems(data.items);
        setLastFetch(Date.now());
      }
    } catch (err) {
      console.log("[NewsTicker] Fetch error (using fallback):", err);
      // Keep existing items (fallback or previously fetched)
    }
  }, []);

  // Fetch on mount + periodic refresh
  useEffect(() => {
    fetchNews();
    const timer = setInterval(fetchNews, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchNews]);

  // Recalculate animation duration when items change
  useEffect(() => {
    // Small delay to allow DOM to update
    const raf = requestAnimationFrame(() => {
      if (innerRef.current) {
        const contentWidth = innerRef.current.scrollWidth / 2;
        // ~60px per second scroll speed
        const duration = Math.max(60, contentWidth / 60);
        setAnimDuration(duration);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [newsItems]);

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
  const allItems = [...newsItems, ...newsItems];

  return (
    <div
      ref={tickerRef}
      className={`relative w-full overflow-hidden border-b ${
        isDark
          ? "bg-[#080a12] border-white/[0.04]"
          : "bg-gray-50 border-gray-100"
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

      {/* Live indicator — shows when data is real (not fallback) */}
      {lastFetch > 0 && (
        <div className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[9px] ${
          isDark ? "text-emerald-500/60" : "text-emerald-600/60"
        }`}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
          </span>
          LIVE
        </div>
      )}

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
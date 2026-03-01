import { useState, useEffect } from "react";
import { ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { fetchTop20Index, formatMarketCap, type Top20IndexData, type Top20Coin } from "../utils/coingecko";
import { Tip } from "./Tip";

interface FearGreedData {
  value: number;
  value_classification: string;
  timestamp: string;
}

export function FearGreedGauge() {
  const { isDark } = useTheme();
  const [data, setData] = useState<FearGreedData | null>(null);
  const [loading, setLoading] = useState(true);

  // Top 20 composite index data
  const [top20, setTop20] = useState<Top20IndexData | null>(null);
  const [top20Loading, setTop20Loading] = useState(true);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    const fetchFearGreed = async () => {
      try {
        const res = await fetch("https://api.alternative.me/fng/?limit=1");
        const json = await res.json();
        if (json.data && json.data.length > 0) {
          setData({
            value: parseInt(json.data[0].value),
            value_classification: json.data[0].value_classification,
            timestamp: json.data[0].timestamp,
          });
        }
      } catch {
        setData({ value: 68, value_classification: "Greed", timestamp: "" });
      } finally {
        setLoading(false);
      }
    };

    fetchFearGreed();
    const interval = setInterval(fetchFearGreed, 300000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Top 20 index data
  useEffect(() => {
    const loadTop20 = async () => {
      const result = await fetchTop20Index();
      setTop20(result);
      setTop20Loading(false);
    };
    loadTop20();
    const iv = setInterval(loadTop20, 120000);
    return () => clearInterval(iv);
  }, []);

  const value = data?.value ?? 50;
  const label = data?.value_classification ?? "Neutral";

  const getColor = (v: number) => {
    if (v <= 25) return "#ea3943";
    if (v <= 45) return "#ea8c00";
    if (v <= 55) return "#f5d100";
    if (v <= 75) return "#16c784";
    return "#16c784";
  };

  const color = getColor(value);

  // ── CoinMarketCap-style compact speedometer ──
  const W = 120;
  const H = 72;
  const cx = W / 2;
  const cy = 62;
  const R = 48;
  const strokeW = 10;

  const needleAngle = Math.PI * (1 - value / 100);
  const needleR = R - 6;
  const nx = cx + needleR * Math.cos(needleAngle);
  const ny = cy - needleR * Math.sin(needleAngle);

  const arcPath = (startFrac: number, endFrac: number) => {
    const a1 = Math.PI * (1 - startFrac);
    const a2 = Math.PI * (1 - endFrac);
    const x1 = cx + R * Math.cos(a1);
    const y1 = cy - R * Math.sin(a1);
    const x2 = cx + R * Math.cos(a2);
    const y2 = cy - R * Math.sin(a2);
    const sweep = endFrac - startFrac > 0.5 ? 1 : 0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${sweep} 1 ${x2} ${y2}`;
  };

  const zones = [
    { from: 0, to: 0.25, color: "#ea3943" },
    { from: 0.25, to: 0.45, color: "#ea8c00" },
    { from: 0.45, to: 0.55, color: "#f5d100" },
    { from: 0.55, to: 0.75, color: "#16c784" },
    { from: 0.75, to: 1.0, color: "#16c784" },
  ];

  const cardClass = isDark
    ? "rounded-xl p-4 border border-white/[0.06] bg-[#0d0f1a]/80"
    : "rounded-xl p-4 border border-gray-200 bg-white";

  return (
    <div className={cardClass}>
      {/* Title row — CoinMarketCap style */}
      <div className="flex items-center gap-0.5 mb-3">
        <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-gray-800"}`}>
          Fear & Greed
        </span>
        <ChevronRight className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[72px]">
          <div className={`animate-spin w-5 h-5 border-2 rounded-full ${isDark ? "border-white/10 border-t-white/50" : "border-gray-200 border-t-gray-500"}`} />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {/* Compact gauge */}
          <div className="flex-shrink-0">
            <svg viewBox={`0 0 ${W} ${H}`} width={110} height={66}>
              {/* Background track */}
              <path
                d={arcPath(0, 1)}
                fill="none"
                stroke={isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}
                strokeWidth={strokeW + 2}
                strokeLinecap="round"
              />

              {/* Colored zone arcs */}
              {zones.map((z, i) => (
                <path
                  key={i}
                  d={arcPath(z.from, z.to)}
                  fill="none"
                  stroke={z.color}
                  strokeWidth={strokeW}
                  strokeLinecap="butt"
                  opacity={0.85}
                />
              ))}

              {/* End caps */}
              {[0, 1].map((frac) => {
                const a = Math.PI * (1 - frac);
                const capX = cx + R * Math.cos(a);
                const capY = cy - R * Math.sin(a);
                return (
                  <circle
                    key={frac}
                    cx={capX}
                    cy={capY}
                    r={strokeW / 2}
                    fill={frac === 0 ? "#ea3943" : "#16c784"}
                    opacity={0.85}
                  />
                );
              })}

              {/* Needle */}
              <line
                x1={cx}
                y1={cy}
                x2={nx}
                y2={ny}
                stroke={isDark ? "#e2e8f0" : "#334155"}
                strokeWidth="2"
                strokeLinecap="round"
              />

              {/* Needle tip dot */}
              <circle cx={nx} cy={ny} r="4" fill={color} stroke={isDark ? "#0f172a" : "#ffffff"} strokeWidth="1.5" />

              {/* Center pivot */}
              <circle cx={cx} cy={cy} r="4" fill={isDark ? "#1e293b" : "#f1f5f9"} stroke={isDark ? "#334155" : "#cbd5e1"} strokeWidth="1.5" />
              <circle cx={cx} cy={cy} r="1.5" fill={color} />
            </svg>
          </div>

          {/* Score + Classification */}
          <div>
            <div className={`text-[32px] font-bold leading-none tracking-tight ${isDark ? "text-white" : "text-gray-900"}`}>
              {value}
            </div>
            <div className="text-xs font-medium mt-1" style={{ color }}>
              {label}
            </div>
          </div>
        </div>
      )}

      {/* ── Top 20 Composite Index ─────────────────────────────────── */}
      <div className={`mt-3 pt-3 border-t ${isDark ? "border-white/[0.06]" : "border-gray-100"}`}>
        <div className="flex items-center justify-between mb-1.5">
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className={`flex items-center gap-1 text-xs font-medium ${isDark ? "text-slate-400 hover:text-slate-200" : "text-gray-500 hover:text-gray-700"} transition-colors`}
          >
            Top 20
            <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${showBreakdown ? "rotate-90" : ""}`} />
          </button>
        </div>

        {top20Loading ? (
          <div className="flex items-center gap-2 h-8">
            <div className={`h-5 w-16 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-100"} animate-pulse`} />
            <div className={`h-4 w-14 rounded ${isDark ? "bg-white/[0.04]" : "bg-gray-100"} animate-pulse`} />
          </div>
        ) : top20 ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className={`text-lg font-bold tracking-tight leading-none ${isDark ? "text-white" : "text-gray-900"}`}>
                {formatMarketCap(top20.totalMarketCap)}
              </span>
              <span className={`flex items-center gap-0.5 text-xs font-medium ${
                top20.weightedChange24h >= 0 ? "text-[#16c784]" : "text-[#ea3943]"
              }`}>
                {top20.weightedChange24h >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {Math.abs(top20.weightedChange24h).toFixed(2)}%
                <span className={`${isDark ? "text-slate-500" : "text-gray-400"} font-normal`}>(24h)</span>
              </span>
            </div>

            {/* Mini dominance bar — top 5 coins market-cap weighted */}
            {top20.topCoins.length > 0 && (
              <div className="mt-2.5">
                <div className="flex gap-[2px] h-[5px] rounded-full overflow-hidden">
                  {top20.topCoins.slice(0, 5).map((coin, i) => {
                    const colors = ["#f7931a", "#627eea", "#26a17b", "#f3ba2f", "#e6007a"];
                    return (
                      <Tip key={coin.symbol} content={`${coin.symbol} ${coin.dominancePercent.toFixed(1)}%`}>
                        <div
                          className="h-full transition-all duration-300"
                          style={{
                            width: `${coin.dominancePercent}%`,
                            minWidth: "3%",
                            backgroundColor: colors[i] || (isDark ? "#475569" : "#94a3b8"),
                            opacity: isDark ? 0.85 : 0.75,
                          }}
                        />
                      </Tip>
                    );
                  })}
                  {/* Rest of top 20 as one segment */}
                  {(() => {
                    const top5Dom = top20.topCoins.slice(0, 5).reduce((sum, c) => sum + c.dominancePercent, 0);
                    const restDom = 100 - top5Dom;
                    if (restDom > 1) {
                      return (
                        <Tip content={`Others ${restDom.toFixed(1)}%`}>
                          <div
                            className="h-full"
                            style={{
                              width: `${restDom}%`,
                              backgroundColor: isDark ? "#334155" : "#cbd5e1",
                              opacity: isDark ? 0.5 : 0.4,
                            }}
                          />
                        </Tip>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className="flex justify-between mt-1">
                  <div className="flex items-center gap-2">
                    {top20.topCoins.slice(0, 3).map((coin, i) => {
                      const colors = ["#f7931a", "#627eea", "#26a17b"];
                      return (
                        <span key={coin.symbol} className="flex items-center gap-1 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors[i] }} />
                          <span className={isDark ? "text-slate-500" : "text-gray-400"}>{coin.symbol}</span>
                        </span>
                      );
                    })}
                  </div>
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {top20.topCoinCount} coins
                  </span>
                </div>
              </div>
            )}

            {/* Expandable top-5 breakdown */}
            {showBreakdown && top20.topCoins.length > 0 && (
              <div className={`mt-2.5 pt-2 border-t ${isDark ? "border-white/[0.04]" : "border-gray-50"}`}>
                {top20.topCoins.slice(0, 5).map((coin) => (
                  <TopCoinRow key={coin.symbol} coin={coin} isDark={isDark} />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Compact single-line coin row for the top-5 breakdown */
function TopCoinRow({ coin, isDark }: { coin: Top20Coin; isDark: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 text-xs ${isDark ? "text-slate-300" : "text-gray-600"}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        {coin.image && (
          <img
            src={coin.image}
            alt={coin.symbol}
            className="w-3.5 h-3.5 rounded-full flex-shrink-0"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
        <span className="font-medium">{coin.symbol}</span>
        <span className={isDark ? "text-slate-500" : "text-gray-400"}>
          ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : coin.price.toFixed(4)}
        </span>
      </div>
      <span className={`font-medium tabular-nums ${
        coin.change24h >= 0 ? "text-[#16c784]" : "text-[#ea3943]"
      }`}>
        {coin.change24h >= 0 ? "+" : ""}{coin.change24h.toFixed(2)}%
      </span>
    </div>
  );
}
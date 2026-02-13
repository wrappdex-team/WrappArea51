import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { fetchMarketRSI } from "../utils/coingecko";

/** CoinMarketCap-style horizontal segmented bar colors (oversold → overbought) */
const RSI_SEGMENTS = [
  "#16c784", "#16c784",     // deep green — very oversold
  "#30e0a1", "#93f0c8",     // light green — oversold
  "#f5d100", "#f5d100",     // yellow — neutral
  "#ea8c00", "#ea8c00",     // orange — leaning overbought
  "#ea3943", "#ea3943",     // red — overbought
];

export function RSIGauge() {
  const { isDark } = useTheme();
  const [rsi, setRsi] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const data = await fetchMarketRSI();
      setRsi(data.rsi);
      setLoading(false);
    };
    load();
    const iv = setInterval(() => {
      fetchMarketRSI().then((data) => setRsi(data.rsi));
    }, 120000);
    return () => clearInterval(iv);
  }, []);

  const value = rsi ?? 50;

  const cardClass = isDark
    ? "rounded-xl p-4 border border-white/[0.06] bg-[#0d0f1a]/80"
    : "rounded-xl p-4 border border-gray-200 bg-white";

  return (
    <div className={cardClass}>
      {/* Title row */}
      <div className="flex items-center gap-0.5 mb-3">
        <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-gray-800"}`}>
          Average Crypto RSI
        </span>
        <ChevronRight className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[72px]">
          <div className={`animate-spin w-5 h-5 border-2 rounded-full ${isDark ? "border-white/10 border-t-white/50" : "border-gray-200 border-t-gray-500"}`} />
        </div>
      ) : (
        <>
          {/* Large score */}
          <div className={`text-[32px] font-bold leading-none tracking-tight mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
            {rsi !== null ? value.toFixed(2) : "—"}
          </div>

          {/* Segmented horizontal bar */}
          <div className="relative mb-2">
            <div className="flex gap-[3px]">
              {RSI_SEGMENTS.map((color, i) => (
                <div
                  key={i}
                  className={`flex-1 h-[8px] ${i === 0 ? "rounded-l-full" : ""} ${i === RSI_SEGMENTS.length - 1 ? "rounded-r-full" : ""}`}
                  style={{ backgroundColor: color, opacity: isDark ? 0.85 : 0.75 }}
                />
              ))}
            </div>

            {/* Position dot — CoinMarketCap style */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[14px] h-[14px] rounded-full z-10"
              style={{
                left: `${Math.min(Math.max(value, 3), 97)}%`,
                backgroundColor: isDark ? "#0f172a" : "#1e293b",
                border: `2.5px solid ${isDark ? "#e2e8f0" : "#ffffff"}`,
                boxShadow: isDark ? "0 0 0 1px rgba(255,255,255,0.1)" : "0 0 0 1px rgba(0,0,0,0.08)",
              }}
            />
          </div>

          {/* Labels */}
          <div className="flex justify-between mt-1">
            <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Oversold
            </span>
            <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Overbought
            </span>
          </div>
        </>
      )}
    </div>
  );
}

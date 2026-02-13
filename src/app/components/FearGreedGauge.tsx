import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

interface FearGreedData {
  value: number;
  value_classification: string;
  timestamp: string;
}

export function FearGreedGauge() {
  const { isDark } = useTheme();
  const [data, setData] = useState<FearGreedData | null>(null);
  const [loading, setLoading] = useState(true);

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
    </div>
  );
}

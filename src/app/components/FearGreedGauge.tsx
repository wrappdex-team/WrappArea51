import { useState, useEffect } from "react";
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
    if (v <= 25) return "#ef4444";
    if (v <= 45) return "#f97316";
    if (v <= 55) return "#eab308";
    if (v <= 75) return "#22c55e";
    return "#a855f7";
  };

  // SVG constants
  const W = 160;
  const H = 96;
  const cx = W / 2;
  const cy = 78;
  const R = 64;
  const strokeW = 14;

  // Needle angle: value 0 → π (left), value 100 → 0 (right)
  const needleAngle = Math.PI * (1 - value / 100);
  const needleR = R - strokeW / 2 - 2;
  const nx = cx + needleR * Math.cos(needleAngle);
  const ny = cy - needleR * Math.sin(needleAngle);

  // Build arc segments - five zones
  const zones = [
    { from: 0, to: 0.25, color: "#ef4444" },   // Extreme Fear
    { from: 0.25, to: 0.45, color: "#f97316" }, // Fear
    { from: 0.45, to: 0.55, color: "#eab308" }, // Neutral
    { from: 0.55, to: 0.75, color: "#22c55e" }, // Greed
    { from: 0.75, to: 1.0, color: "#a855f7" },  // Extreme Greed
  ];

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

  return (
    <div
      className={`rounded-xl p-3 pb-2 border ${
        isDark
          ? "bg-gradient-to-br from-slate-900/80 to-slate-800/40 border-slate-700/40 backdrop-blur-sm"
          : "bg-white border-gray-200 shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className={`text-[10px] font-bold tracking-wide uppercase ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Fear & Greed
        </div>
        <div
          className="text-[10px] px-1.5 py-0.5 rounded font-bold"
          style={{
            color: getColor(value),
            backgroundColor: `${getColor(value)}18`,
          }}
        >
          {label}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-16">
          <div className="animate-spin w-4 h-4 border-2 border-pink-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="relative flex flex-col items-center">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ maxWidth: 180 }}
          >
            {/* Background track */}
            <path
              d={arcPath(0, 1)}
              fill="none"
              stroke={isDark ? "rgba(100,116,139,0.12)" : "rgba(0,0,0,0.06)"}
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
                opacity={isDark ? 0.8 : 0.65}
              />
            ))}

            {/* Gap lines between zones */}
            {[0.25, 0.45, 0.55, 0.75].map((frac) => {
              const a = Math.PI * (1 - frac);
              const gx1 = cx + (R - strokeW / 2 - 1) * Math.cos(a);
              const gy1 = cy - (R - strokeW / 2 - 1) * Math.sin(a);
              const gx2 = cx + (R + strokeW / 2 + 1) * Math.cos(a);
              const gy2 = cy - (R + strokeW / 2 + 1) * Math.sin(a);
              return (
                <line
                  key={frac}
                  x1={gx1} y1={gy1} x2={gx2} y2={gy2}
                  stroke={isDark ? "#0f172a" : "#ffffff"}
                  strokeWidth="2"
                />
              );
            })}

            {/* End caps - round the ends */}
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
                  fill={frac === 0 ? "#ef4444" : "#a855f7"}
                  opacity={isDark ? 0.8 : 0.65}
                />
              );
            })}

            {/* Needle line */}
            <line
              x1={cx}
              y1={cy}
              x2={nx}
              y2={ny}
              stroke={isDark ? "#e2e8f0" : "#1e293b"}
              strokeWidth="2"
              strokeLinecap="round"
            />

            {/* Needle tip dot */}
            <circle
              cx={nx}
              cy={ny}
              r="3.5"
              fill={getColor(value)}
              stroke={isDark ? "#0f172a" : "#ffffff"}
              strokeWidth="1.5"
            />

            {/* Center pivot */}
            <circle cx={cx} cy={cy} r="5" fill={isDark ? "#1e293b" : "#f8fafc"} stroke={isDark ? "#334155" : "#cbd5e1"} strokeWidth="1.5" />
            <circle cx={cx} cy={cy} r="2" fill={getColor(value)} />

            {/* Score text centered */}
            <text
              x={cx}
              y={cy - 16}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={getColor(value)}
              fontSize="22"
              fontWeight="800"
              fontFamily="system-ui, sans-serif"
            >
              {value}
            </text>

            {/* Min / Max labels */}
            <text
              x={cx - R - 2}
              y={cy + 12}
              textAnchor="middle"
              fill={isDark ? "rgba(148,163,184,0.5)" : "rgba(0,0,0,0.3)"}
              fontSize="8"
              fontWeight="600"
            >
              0
            </text>
            <text
              x={cx + R + 2}
              y={cy + 12}
              textAnchor="middle"
              fill={isDark ? "rgba(148,163,184,0.5)" : "rgba(0,0,0,0.3)"}
              fontSize="8"
              fontWeight="600"
            >
              100
            </text>
          </svg>
        </div>
      )}
    </div>
  );
}

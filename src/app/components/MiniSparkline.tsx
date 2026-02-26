/**
 * MiniSparkline — Lightweight SVG sparkline for market table rows.
 *
 * Renders real 7-day price history as a smooth SVG path with gradient fill.
 * Replaces the heavyweight TradingView candlestick mini-charts that were
 * stuck on synthetic/mock data.
 *
 * Color: green (#22c55e) for positive 24h change, red (#ef4444) for negative.
 * Falls back to a subtle animated skeleton when no data is available.
 */

import { useMemo } from "react";

interface MiniSparklineProps {
  /** Array of price points (typically ~168 hourly points from CoinGecko 7-day sparkline) */
  data: number[];
  /** 24h price change percentage — determines line color (green/red) */
  change24h: number;
  /** SVG width in pixels */
  width?: number;
  /** SVG height in pixels */
  height?: number;
  /** Unique ID prefix for SVG gradient defs (prevents cross-component gradient conflicts) */
  id?: string;
}

export function MiniSparkline({
  data,
  change24h,
  width = 128,
  height = 40,
  id = "spark",
}: MiniSparklineProps) {
  const { linePath, areaPath, isPositive } = useMemo(() => {
    const positive = change24h >= 0;
    if (!data || data.length < 2) return { linePath: "", areaPath: "", isPositive: positive };

    // Downsample to ~64 points max for performance (7-day data can be 168 points)
    const maxPoints = 64;
    const step = data.length > maxPoints ? Math.ceil(data.length / maxPoints) : 1;
    const sampled = step > 1 ? data.filter((_, i) => i % step === 0) : data;

    const min = Math.min(...sampled);
    const max = Math.max(...sampled);
    const range = max - min || 1; // Avoid division by zero for flat lines

    // Padding: 10% top/bottom so the line doesn't clip edges
    const padY = height * 0.1;
    const innerH = height - padY * 2;
    const stepX = width / (sampled.length - 1);

    // Build SVG path
    const points = sampled.map((val, i) => ({
      x: i * stepX,
      y: padY + innerH - ((val - min) / range) * innerH,
    }));

    // Smooth curve using cubic bezier (Catmull-Rom to cubic bezier conversion)
    let line = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      line += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }

    // Area path = line path + close to bottom
    const lastPt = points[points.length - 1];
    const area = `${line} L ${lastPt.x.toFixed(1)},${height} L 0,${height} Z`;

    return { linePath: line, areaPath: area, isPositive: positive };
  }, [data, change24h, width, height]);

  // Loading skeleton when no data
  if (!data || data.length < 2) {
    return (
      <div
        className="rounded animate-pulse"
        style={{
          width,
          height,
          background: "linear-gradient(90deg, transparent 25%, rgba(100,116,139,0.1) 50%, transparent 75%)",
          backgroundSize: "200% 100%",
        }}
      />
    );
  }

  const strokeColor = isPositive ? "#22c55e" : "#ef4444";
  const gradId = `${id}-grad`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Gradient fill area */}
      <path d={areaPath} fill={`url(#${gradId})`} />
      {/* Sparkline stroke */}
      <path
        d={linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

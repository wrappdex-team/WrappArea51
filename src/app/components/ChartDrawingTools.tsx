import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import {
  Minus,
  TrendingUp,
  BarChart2,
  MousePointer,
  Trash2,
  MoveUpRight,
} from "lucide-react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

type DrawingMode = "none" | "trendline" | "horizontal" | "ray" | "fibonacci";

interface Point {
  time: any;
  price: number;
}

interface Drawing {
  id: string;
  type: DrawingMode;
  points: Point[];
  color: string;
}

const FIBO_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIBO_COLORS: Record<number, string> = {
  0: "#ef4444",
  0.236: "#f97316",
  0.382: "#eab308",
  0.5: "#22c55e",
  0.618: "#06b6d4",
  0.786: "#8b5cf6",
  1: "#ec4899",
};

interface ChartDrawingToolsProps {
  chartApi: IChartApi | null;
  seriesApi: ISeriesApi<"Candlestick"> | null;
  isDark: boolean;
  chartHeight: number;
  children: ReactNode;
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  symbol?: string;
}

const STORAGE_KEY = "hbarh-chart-drawings";

function loadDrawings(symbol: string): Drawing[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as Record<string, Drawing[]>;
    return all[symbol] || [];
  } catch {
    return [];
  }
}

function saveDrawings(symbol: string, drawings: Drawing[]): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, Drawing[]> : {};
    all[symbol] = drawings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function ChartDrawingTools({
  chartApi,
  seriesApi,
  isDark,
  chartHeight,
  children,
  chartContainerRef,
  symbol = "default",
}: ChartDrawingToolsProps) {
  const [mode, setMode] = useState<DrawingMode>("none");
  const [drawings, setDrawings] = useState<Drawing[]>(() => loadDrawings(symbol));
  const [activePoints, setActivePoints] = useState<Point[]>([]);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  // Persist drawings when they change
  useEffect(() => {
    saveDrawings(symbol, drawings);
  }, [drawings, symbol]);

  // Reload drawings when symbol changes
  useEffect(() => {
    setDrawings(loadDrawings(symbol));
    setActivePoints([]);
    setMode("none");
  }, [symbol]);

  const getPointFromMouse = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point | null => {
      if (!chartApi || !seriesApi || !chartContainerRef.current) return null;
      const rect = chartContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      try {
        const time = chartApi.timeScale().coordinateToTime(x);
        const price = seriesApi.coordinateToPrice(y);
        if (time == null || price == null) return null;
        return { time, price: price as number };
      } catch {
        return null;
      }
    },
    [chartApi, seriesApi, chartContainerRef]
  );

  const toPixel = useCallback(
    (pt: Point): { x: number; y: number } | null => {
      if (!chartApi || !seriesApi) return null;
      try {
        const x = chartApi.timeScale().timeToCoordinate(pt.time);
        const y = seriesApi.priceToCoordinate(pt.price);
        if (x == null || y == null) return null;
        return { x: x as number, y: y as number };
      } catch {
        return null;
      }
    },
    [chartApi, seriesApi]
  );

  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const allDrawings = [...drawings];

    // Add preview for active drawing
    if (activePoints.length > 0 && mousePos && mode !== "none") {
      if (!chartApi || !seriesApi) return;
      try {
        const time = chartApi.timeScale().coordinateToTime(mousePos.x);
        const price = seriesApi.coordinateToPrice(mousePos.y);
        if (time != null && price != null) {
          const previewPt: Point = { time, price: price as number };
          allDrawings.push({
            id: "preview",
            type: mode,
            points:
              mode === "horizontal"
                ? [activePoints[0]]
                : [...activePoints, previewPt],
            color: getDrawingColor(mode),
          });
        }
      } catch {
        // ignore coordinate errors during preview
      }
    }

    for (const d of allDrawings) {
      const pixels = d.points.map(toPixel).filter(Boolean) as {
        x: number;
        y: number;
      }[];

      if (d.type === "horizontal" && pixels.length >= 1) {
        drawHorizontalLine(ctx, pixels[0], w, d.color, isDark);
      } else if (d.type === "trendline" && pixels.length >= 2) {
        drawTrendLine(ctx, pixels[0], pixels[1], d.color);
      } else if (d.type === "ray" && pixels.length >= 2) {
        drawRay(ctx, pixels[0], pixels[1], w, d.color);
      } else if (d.type === "fibonacci" && pixels.length >= 2) {
        drawFibonacci(ctx, pixels[0], pixels[1], w, isDark);
      }
    }
  }, [drawings, activePoints, mousePos, mode, toPixel, isDark, chartApi, seriesApi]);

  // Redraw on chart scroll/zoom
  useEffect(() => {
    if (!chartApi) return;
    const handler = () => {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(drawAll);
    };
    chartApi.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => {
      chartApi.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [chartApi, drawAll]);

  // Redraw whenever drawings or theme changes
  useEffect(() => {
    drawAll();
  }, [drawAll]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === "none") return;
    const pt = getPointFromMouse(e);
    if (!pt) return;

    if (mode === "horizontal") {
      setDrawings((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: "horizontal",
          points: [pt],
          color: getDrawingColor("horizontal"),
        },
      ]);
      setActivePoints([]);
      return;
    }

    if (activePoints.length === 0) {
      setActivePoints([pt]);
    } else {
      setDrawings((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: mode,
          points: [...activePoints, pt],
          color: getDrawingColor(mode),
        },
      ]);
      setActivePoints([]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!chartContainerRef.current) return;
    const rect = chartContainerRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const clearAll = () => {
    setDrawings([]);
    setActivePoints([]);
    setMode("none");
  };

  const undoLast = () => {
    setDrawings((prev) => prev.slice(0, -1));
    setActivePoints([]);
  };

  const tools: {
    id: DrawingMode;
    label: string;
    icon: typeof Minus;
    tooltip: string;
  }[] = [
    { id: "none", label: "Select", icon: MousePointer, tooltip: "Select / Pan" },
    { id: "trendline", label: "Trend Line", icon: TrendingUp, tooltip: "Trend Line" },
    { id: "horizontal", label: "H-Line", icon: Minus, tooltip: "Horizontal Line" },
    { id: "ray", label: "Ray", icon: MoveUpRight, tooltip: "Ray" },
    { id: "fibonacci", label: "Fibonacci", icon: BarChart2, tooltip: "Fibonacci Retracement" },
  ];

  const isDrawing = mode !== "none";

  return (
    <>
      {/* Drawing Toolbar */}
      <div className={`flex items-center gap-1 mb-2 py-1.5 px-2 rounded-lg ${isDark ? "bg-slate-800/30" : "bg-gray-50/80"}`}>
        <span className={`text-xs mr-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Draw:</span>
        {tools.map((tool) => {
          const Icon = tool.icon;
          const active = mode === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => {
                setMode(tool.id);
                setActivePoints([]);
              }}
              title={tool.tooltip}
              className={`px-2 py-1 rounded text-xs transition-all flex items-center gap-1.5 ${
                active
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
                  : isDark
                  ? "text-slate-400 hover:text-white hover:bg-slate-700/60"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tool.label}</span>
            </button>
          );
        })}

        <div className={`w-px h-5 mx-1.5 ${isDark ? "bg-slate-700" : "bg-gray-300"}`} />

        <button
          onClick={undoLast}
          title="Undo last drawing"
          disabled={drawings.length === 0}
          className={`px-2 py-1 rounded text-xs transition-all ${
            drawings.length === 0
              ? isDark
                ? "text-slate-600 cursor-not-allowed"
                : "text-gray-300 cursor-not-allowed"
              : isDark
              ? "text-slate-400 hover:text-white hover:bg-slate-700/60"
              : "text-gray-500 hover:text-gray-900 hover:bg-gray-200"
          }`}
        >
          Undo
        </button>

        <button
          onClick={clearAll}
          title="Clear all drawings"
          disabled={drawings.length === 0}
          className={`px-2 py-1 rounded text-xs transition-all flex items-center gap-1 ${
            drawings.length === 0
              ? isDark
                ? "text-slate-600 cursor-not-allowed"
                : "text-gray-300 cursor-not-allowed"
              : "text-red-400 hover:text-red-300 hover:bg-red-900/20"
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>

        {drawings.length > 0 && (
          <span className={`text-xs ml-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            ({drawings.length})
          </span>
        )}
      </div>

      {/* Chart + Canvas Overlay */}
      <div className="relative">
        {children}
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full"
          style={{
            height: chartHeight,
            pointerEvents: isDrawing ? "auto" : "none",
            cursor: isDrawing ? "crosshair" : "default",
            zIndex: isDrawing ? 10 : 1,
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setMousePos(null)}
        />
      </div>
    </>
  );
}

function getDrawingColor(mode: DrawingMode): string {
  switch (mode) {
    case "trendline":
      return "#ec4899";
    case "horizontal":
      return "#f59e0b";
    case "ray":
      return "#06b6d4";
    case "fibonacci":
      return "#8b5cf6";
    default:
      return "#ec4899";
  }
}

function drawHorizontalLine(
  ctx: CanvasRenderingContext2D,
  pt: { x: number; y: number },
  width: number,
  color: string,
  isDark: boolean
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(0, pt.y);
  ctx.lineTo(width, pt.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Price label bg
  const labelBg = isDark ? "rgba(15,15,25,0.9)" : "rgba(255,255,255,0.95)";
  ctx.fillStyle = labelBg;
  ctx.fillRect(width - 48, pt.y - 9, 44, 18);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(width - 48, pt.y - 9, 44, 18);
  ctx.fillStyle = color;
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText("H-Line", width - 26, pt.y + 3);
  ctx.restore();
}

function drawTrendLine(
  ctx: CanvasRenderingContext2D,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  color: string
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // Endpoint dots
  ctx.fillStyle = color;
  [p1, p2].forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawRay(
  ctx: CanvasRenderingContext2D,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  width: number,
  color: string
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let endX = p2.x;
  let endY = p2.y;
  if (Math.abs(dx) > 0.01) {
    const t = (width - p1.x) / dx;
    if (t > 0) {
      endX = p1.x + dx * t;
      endY = p1.y + dy * t;
    }
  }

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFibonacci(
  ctx: CanvasRenderingContext2D,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  width: number,
  isDark: boolean
) {
  ctx.save();
  const top = Math.min(p1.y, p2.y);
  const bottom = Math.max(p1.y, p2.y);
  const range = bottom - top;
  if (range < 2) {
    ctx.restore();
    return;
  }

  for (const level of FIBO_LEVELS) {
    const y = top + range * level;
    const color = FIBO_COLORS[level] || "#888";

    // Fill zone between levels
    const nextIdx = FIBO_LEVELS.indexOf(level) + 1;
    if (nextIdx < FIBO_LEVELS.length) {
      const nextY = top + range * FIBO_LEVELS[nextIdx];
      ctx.fillStyle = color;
      ctx.globalAlpha = isDark ? 0.06 : 0.08;
      ctx.fillRect(0, y, width, nextY - y);
    }

    // Line
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.globalAlpha = 1;
    const label = `${(level * 100).toFixed(1)}%`;
    const textW = ctx.measureText(label).width;
    const labelBg = isDark ? "rgba(15,15,25,0.9)" : "rgba(255,255,255,0.95)";
    ctx.fillStyle = labelBg;
    ctx.fillRect(4, y - 8, textW + 10, 16);
    ctx.fillStyle = color;
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(label, 9, y + 4);
  }

  // Vertical bracket lines
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = isDark ? "#94a3b8" : "#64748b";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  [p1.x, p2.x].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // Endpoint dots
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ec4899";
  [p1, p2].forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}
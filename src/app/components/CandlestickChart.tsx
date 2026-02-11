import { useEffect, useRef } from "react";
import type { IChartApi, CandlestickData } from "lightweight-charts";
import { CANDLE_COLORS } from "../utils/chartData";

interface CandlestickChartProps {
  data: CandlestickData[];
  symbol: string;
}

export function CandlestickChart({ data, symbol }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    let cancelled = false;
    let localChart: IChartApi | null = null;
    let resizeHandler: (() => void) | null = null;

    import("lightweight-charts").then((LWC) => {
      if (cancelled || !chartContainerRef.current) return;

      const chart = LWC.createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight || 60,
        layout: {
          background: { color: "transparent" },
          textColor: "transparent",
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        timeScale: {
          visible: false,
        },
        rightPriceScale: {
          visible: false,
        },
        leftPriceScale: {
          visible: false,
        },
        crosshair: {
          vertLine: { visible: false },
          horzLine: { visible: false },
        },
        handleScroll: false,
        handleScale: false,
      });
      localChart = chart;

      const series = chart.addSeries(LWC.CandlestickSeries, CANDLE_COLORS);
      series.setData(data);
      chart.timeScale().fitContent();
      chartRef.current = chart;

      resizeHandler = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener("resize", resizeHandler);
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (localChart) {
        try { localChart.remove(); } catch {}
        localChart = null;
      }
      chartRef.current = null;
    };
  }, [data]);

  return <div ref={chartContainerRef} className="w-full h-full" />;
}

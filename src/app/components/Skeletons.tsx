/**
 * Skeletons — Bank-grade shimmer loading placeholders.
 *
 * Every skeleton matches the exact layout geometry of its real counterpart
 * so the page doesn't shift when data loads in. Uses the glass-morphism
 * dark theme colors with a subtle gradient shimmer sweep.
 */

import { useTheme } from "../contexts/ThemeContext";

// ── Base Shimmer Block ────────────────────────────────────────────────

interface ShimmerProps {
  className?: string;
  /** Override the base background for light/dark; defaults to theme-aware */
  bgOverride?: string;
}

function Shimmer({ className = "", bgOverride }: ShimmerProps) {
  const { isDark } = useTheme();
  const bg = bgOverride ?? (isDark ? "bg-white/[0.04]" : "bg-gray-200/60");
  return (
    <div
      className={`relative overflow-hidden rounded-md ${bg} ${className}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 skeleton-shimmer" />
    </div>
  );
}

// ── Dashboard: Global Stats Header ───────────────────────────────────

export function DashboardStatsSkeleton() {
  const { isDark } = useTheme();
  const card = isDark
    ? "rounded-xl p-4 border border-white/[0.06] bg-[#0d0f1a]/80"
    : "rounded-xl p-4 border border-gray-200 bg-white";

  return (
    <div className={card} role="status" aria-label="Loading market statistics">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Market Cap */}
        <div>
          <Shimmer className="h-8 w-48 rounded-lg" />
          <div className="flex items-center gap-1.5 mt-2">
            <Shimmer className="h-3.5 w-20 rounded" />
            <Shimmer className="h-3.5 w-12 rounded" />
          </div>
        </div>
        {/* 24h Volume */}
        <div>
          <Shimmer className="h-8 w-44 rounded-lg" />
          <Shimmer className="h-3.5 w-28 rounded mt-2" />
        </div>
        {/* BTC / ETH / Coins */}
        <div className="hidden md:flex items-center gap-4">
          <Shimmer className="h-10 w-24 rounded-lg" />
          <Shimmer className="h-10 w-24 rounded-lg" />
          <Shimmer className="h-10 w-20 rounded-lg" />
        </div>
      </div>
      <span className="sr-only">Loading market statistics...</span>
    </div>
  );
}

// ── Dashboard: Single Market Row ─────────────────────────────────────

export function MarketRowSkeleton() {
  const { isDark } = useTheme();
  return (
    <div
      className={`rounded-xl p-3 md:p-4 flex items-center justify-between ${
        isDark
          ? "border border-slate-800/50 bg-slate-900/30"
          : "border border-gray-200 bg-white"
      }`}
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 md:gap-3">
        <Shimmer className="w-8 h-8 md:w-10 md:h-10 rounded-full" />
        <div>
          <Shimmer className="h-4 w-16 rounded mb-1.5" />
          <Shimmer className="h-3 w-24 rounded hidden sm:block" />
        </div>
      </div>
      <div className="flex items-center gap-3 md:gap-6">
        <div className="text-right">
          <Shimmer className="h-4 w-20 rounded mb-1" />
          <Shimmer className="h-3 w-12 rounded md:hidden" />
        </div>
        <Shimmer className="h-4 w-14 rounded hidden md:block" />
        <Shimmer className="h-4 w-14 rounded hidden md:block" />
        <Shimmer className="h-4 w-14 rounded hidden md:block" />
        <Shimmer className="h-5 w-5 rounded" />
      </div>
    </div>
  );
}

/** Multiple market rows */
export function MarketListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3" role="status" aria-label="Loading market data">
      {Array.from({ length: rows }).map((_, i) => (
        <MarketRowSkeleton key={i} />
      ))}
      <span className="sr-only">Loading market data...</span>
    </div>
  );
}

// ── Swap Panel Skeleton ──────────────────────────────────────────────

export function SwapPanelSkeleton() {
  const { isDark } = useTheme();
  const card = isDark
    ? "bg-slate-900/60 border border-pink-500/10 backdrop-blur-xl"
    : "bg-white border border-gray-200 shadow-sm";
  const input = isDark
    ? "bg-slate-800/60 border border-slate-700/30"
    : "bg-gray-50 border border-gray-200";

  return (
    <div className={`rounded-2xl p-5 ${card}`} role="status" aria-label="Loading swap interface">
      {/* Input token area */}
      <div className={`rounded-xl p-4 mb-2 ${input}`}>
        <div className="flex items-center justify-between mb-3">
          <Shimmer className="h-3 w-14 rounded" />
          <Shimmer className="h-3 w-16 rounded" />
        </div>
        <div className="flex items-center gap-3">
          <Shimmer className="h-8 flex-1 rounded-lg" />
          <Shimmer className="h-10 w-28 rounded-xl" />
        </div>
        <Shimmer className="h-3 w-24 rounded mt-2" />
      </div>

      {/* Flip button */}
      <div className="flex justify-center -my-3 relative z-10">
        <Shimmer className="w-10 h-10 rounded-xl" />
      </div>

      {/* Output token area */}
      <div className={`rounded-xl p-4 mt-2 ${input}`}>
        <div className="flex items-center justify-between mb-3">
          <Shimmer className="h-3 w-18 rounded" />
        </div>
        <div className="flex items-center gap-3">
          <Shimmer className="h-8 flex-1 rounded-lg" />
          <Shimmer className="h-10 w-28 rounded-xl" />
        </div>
        <Shimmer className="h-3 w-20 rounded mt-2" />
      </div>

      {/* Slippage */}
      <Shimmer className="h-5 w-32 rounded mt-4" />

      {/* Swap button */}
      <Shimmer className="h-12 w-full rounded-xl mt-4" />

      {/* Footer info */}
      <div className="flex justify-center mt-3">
        <Shimmer className="h-3 w-48 rounded" />
      </div>
      <span className="sr-only">Loading swap interface...</span>
    </div>
  );
}

// ── Pool Routes Table Skeleton ───────────────────────────────────────

export function PoolTableSkeleton({ rows = 6 }: { rows?: number }) {
  const { isDark } = useTheme();
  const card = isDark
    ? "bg-slate-900/60 border border-pink-500/10 backdrop-blur-xl"
    : "bg-white border border-gray-200 shadow-sm";

  return (
    <div className={`rounded-2xl overflow-hidden ${card}`} role="status" aria-label="Loading pool routes">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <Shimmer className="h-5 w-44 rounded" />
        <Shimmer className="h-4 w-24 rounded" />
      </div>
      {/* Table header */}
      <div className="px-5 pb-2 flex items-center gap-4">
        <Shimmer className="h-3 w-12 rounded" />
        <Shimmer className="h-3 w-10 rounded ml-auto" />
        <Shimmer className="h-3 w-12 rounded" />
        <Shimmer className="h-3 w-8 rounded" />
        <Shimmer className="h-3 w-10 rounded" />
        <Shimmer className="h-3 w-10 rounded" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center justify-between px-5 py-2.5 ${
            isDark ? "border-t border-slate-800/30" : "border-t border-gray-100"
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5">
              <Shimmer className="w-5 h-5 rounded-full" />
              <Shimmer className="w-5 h-5 rounded-full" />
            </div>
            <Shimmer className="h-3.5 w-20 rounded" />
          </div>
          <div className="flex items-center gap-4">
            <Shimmer className="h-3.5 w-14 rounded" />
            <Shimmer className="h-3.5 w-14 rounded" />
            <Shimmer className="h-3.5 w-10 rounded" />
            <Shimmer className="h-3.5 w-12 rounded" />
            <Shimmer className="h-5 w-5 rounded" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading pool routes...</span>
    </div>
  );
}

// ── Trading Chart Skeleton ───────────────────────────────────────────

export function ChartSkeleton({ height = "h-[400px]" }: { height?: string }) {
  const { isDark } = useTheme();
  return (
    <div
      className={`relative rounded-xl overflow-hidden ${height} ${
        isDark ? "bg-[#0d0f1a]/80 border border-white/[0.06]" : "bg-white border border-gray-200"
      }`}
      role="status"
      aria-label="Loading chart"
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Shimmer key={i} className="h-6 w-10 rounded-md" />
        ))}
        <div className="ml-auto flex gap-2">
          <Shimmer className="h-6 w-6 rounded" />
          <Shimmer className="h-6 w-6 rounded" />
        </div>
      </div>
      {/* Skeleton chart bars */}
      <div className="flex items-end justify-around px-6 pb-4 h-[calc(100%-48px)]">
        {Array.from({ length: 30 }).map((_, i) => (
          <Shimmer
            key={i}
            className="w-[2.5%] rounded-t-sm"
            style={{ height: `${20 + Math.random() * 60}%` } as React.CSSProperties}
          />
        ))}
      </div>
      <span className="sr-only">Loading chart...</span>
    </div>
  );
}

// ── Trading Watchlist Skeleton ────────────────────────────────────────

export function WatchlistSkeleton({ rows = 8 }: { rows?: number }) {
  const { isDark } = useTheme();
  return (
    <div role="status" aria-label="Loading watchlist">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center justify-between px-3 py-2 ${
            isDark ? "border-b border-slate-800/30" : "border-b border-gray-100"
          }`}
        >
          <div className="flex items-center gap-2">
            <Shimmer className="w-6 h-6 rounded-full" />
            <div>
              <Shimmer className="h-3.5 w-12 rounded mb-1" />
              <Shimmer className="h-2.5 w-16 rounded" />
            </div>
          </div>
          <div className="text-right">
            <Shimmer className="h-3.5 w-16 rounded mb-1" />
            <Shimmer className="h-2.5 w-10 rounded ml-auto" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading watchlist...</span>
    </div>
  );
}

// ── Wallet Portfolio Card Skeleton ───────────────────────────────────

export function WalletCardSkeleton() {
  const { isDark } = useTheme();
  const card = isDark
    ? "rounded-2xl p-6 border border-white/[0.06] bg-[#0d0f1a]/80"
    : "rounded-2xl p-6 border border-gray-200 bg-white";

  return (
    <div className={card} role="status" aria-label="Loading wallet portfolio">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shimmer className="w-10 h-10 rounded-lg" />
          <div>
            <Shimmer className="h-4 w-24 rounded mb-1.5" />
            <Shimmer className="h-3 w-32 rounded" />
          </div>
        </div>
        <Shimmer className="h-8 w-20 rounded-lg" />
      </div>

      {/* Balance */}
      <Shimmer className="h-7 w-36 rounded-lg mb-1" />
      <Shimmer className="h-3.5 w-20 rounded mb-6" />

      {/* Donut chart placeholder */}
      <div className="flex items-center gap-6 mb-6">
        <Shimmer className="w-28 h-28 rounded-full" />
        <div className="flex-1 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Shimmer className="w-3 h-3 rounded-full" />
              <Shimmer className="h-3 flex-1 rounded" />
              <Shimmer className="h-3 w-14 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Token rows */}
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <Shimmer className="w-7 h-7 rounded-full" />
              <div>
                <Shimmer className="h-3.5 w-16 rounded mb-1" />
                <Shimmer className="h-2.5 w-10 rounded" />
              </div>
            </div>
            <div className="text-right">
              <Shimmer className="h-3.5 w-20 rounded mb-1" />
              <Shimmer className="h-2.5 w-14 rounded ml-auto" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading wallet portfolio...</span>
    </div>
  );
}

// ── DeFi Pool Row Skeleton ───────────────────────────────────────────

export function DeFiPoolRowSkeleton() {
  const { isDark } = useTheme();
  return (
    <div
      className={`rounded-xl p-4 flex items-center justify-between ${
        isDark
          ? "border border-slate-800/50 bg-slate-900/30"
          : "border border-gray-200 bg-white"
      }`}
      aria-hidden="true"
    >
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <Shimmer className="w-8 h-8 rounded-full" />
          <Shimmer className="w-8 h-8 rounded-full" />
        </div>
        <div>
          <Shimmer className="h-4 w-28 rounded mb-1" />
          <Shimmer className="h-3 w-16 rounded" />
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <Shimmer className="h-3 w-10 rounded mb-1" />
          <Shimmer className="h-4 w-16 rounded" />
        </div>
        <div className="text-right">
          <Shimmer className="h-3 w-10 rounded mb-1" />
          <Shimmer className="h-4 w-14 rounded" />
        </div>
        <div className="text-right hidden md:block">
          <Shimmer className="h-3 w-10 rounded mb-1" />
          <Shimmer className="h-4 w-12 rounded" />
        </div>
      </div>
    </div>
  );
}

export function DeFiPoolListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading DeFi pools">
      {Array.from({ length: rows }).map((_, i) => (
        <DeFiPoolRowSkeleton key={i} />
      ))}
      <span className="sr-only">Loading DeFi pools...</span>
    </div>
  );
}

// ── DAO Proposal Card Skeleton ───────────────────────────────────────

export function ProposalCardSkeleton() {
  const { isDark } = useTheme();
  return (
    <div
      className={`rounded-xl p-4 space-y-3 ${
        isDark
          ? "border border-white/[0.06] bg-[#0d0f1a]/80"
          : "border border-gray-200 bg-white"
      }`}
      aria-hidden="true"
    >
      <div className="flex items-center justify-between">
        <Shimmer className="h-5 w-48 rounded" />
        <Shimmer className="h-5 w-16 rounded-full" />
      </div>
      <Shimmer className="h-3.5 w-full rounded" />
      <Shimmer className="h-3.5 w-3/4 rounded" />
      {/* Vote bar */}
      <div className="flex items-center gap-3">
        <Shimmer className="h-2 flex-1 rounded-full" />
      </div>
      <div className="flex items-center gap-4">
        <Shimmer className="h-3 w-16 rounded" />
        <Shimmer className="h-3 w-16 rounded" />
        <Shimmer className="h-3 w-24 rounded ml-auto" />
      </div>
    </div>
  );
}

export function DAOProposalListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading proposals">
      {Array.from({ length: rows }).map((_, i) => (
        <ProposalCardSkeleton key={i} />
      ))}
      <span className="sr-only">Loading proposals...</span>
    </div>
  );
}

// ── Suspense Fallback (full page) ────────────────────────────────────

export function PageSkeleton() {
  const { isDark } = useTheme();
  return (
    <div
      className="min-h-[60vh] flex flex-col items-center justify-center gap-4"
      role="status"
      aria-label="Loading page"
    >
      {/* Animated iridescent orb */}
      <div className="relative w-12 h-12">
        <div
          className={`absolute inset-0 rounded-full ${
            isDark ? "bg-pink-500/10" : "bg-pink-100"
          } animate-ping`}
          style={{ animationDuration: "1.5s" }}
        />
        <div
          className="absolute inset-1 rounded-full bg-gradient-to-br from-pink-500/30 via-purple-500/30 to-blue-500/30 animate-pulse"
        />
        <div
          className="absolute inset-2 rounded-full skeleton-shimmer"
          style={{ background: isDark
            ? "linear-gradient(135deg, rgba(236,72,153,0.15), rgba(168,85,247,0.15), rgba(59,130,246,0.15))"
            : "linear-gradient(135deg, rgba(236,72,153,0.1), rgba(168,85,247,0.1), rgba(59,130,246,0.1))"
          }}
        />
      </div>
      <span className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        Loading...
      </span>
      <span className="sr-only">Loading page content...</span>
    </div>
  );
}

// ── Fear & Greed Gauge Skeleton ──────────────────────────────────────

export function GaugeSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2" role="status" aria-label="Loading gauge">
      <Shimmer className="w-24 h-12 rounded-t-full" />
      <Shimmer className="h-5 w-16 rounded" />
      <Shimmer className="h-3 w-20 rounded" />
      <span className="sr-only">Loading gauge...</span>
    </div>
  );
}

// ── Generic Card Skeleton ────────────────────────────────────────────

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  const { isDark } = useTheme();
  return (
    <div
      className={`rounded-xl p-4 space-y-3 ${
        isDark
          ? "border border-white/[0.06] bg-[#0d0f1a]/80"
          : "border border-gray-200 bg-white"
      }`}
      role="status"
      aria-hidden="true"
    >
      <Shimmer className="h-5 w-2/3 rounded" />
      {Array.from({ length: lines }).map((_, i) => (
        <Shimmer
          key={i}
          className={`h-3.5 rounded ${i === lines - 1 ? "w-1/2" : "w-full"}`}
        />
      ))}
    </div>
  );
}
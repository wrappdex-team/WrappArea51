/**
 * Portfolio Overview Widget — shows connected wallet's token allocation
 * as a visual donut chart + value breakdown. Appears on the Dashboard
 * when a Hedera wallet is connected.
 */

import { useMemo, useState, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Wallet, TrendingUp, ExternalLink, Vote } from "lucide-react";
import { Link } from "react-router";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { formatHbar } from "../utils/hedera";
import { fetchHbarhTokenPrice, fetchLPTokenPrice } from "../utils/saucerswap";
import { maxVotesForBalance } from "../utils/dao";

const COLORS = [
  "#ec4899", // pink
  "#a855f7", // purple
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#ef4444", // red
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#f97316", // orange
];

interface SliceData {
  name: string;
  symbol: string;
  value: number; // USD value
  percentage: number;
}

export function PortfolioWidget() {
  const { isDark } = useTheme();
  const { hederaAccount, hbarPrice, primaryWallet, hederaNetwork } = useWallet();

  // Live HBAR.ħ price from DexScreener/SaucerSwap
  const [hbarhPrice, setHbarhPrice] = useState(0.008);
  useEffect(() => {
    fetchHbarhTokenPrice().then((r) => {
      if (r.price > 0) setHbarhPrice(r.price);
    });
  }, []);

  // Live ssLP-WHBAR-HBAR.ħ price
  const [lpTokenPrice, setLpTokenPrice] = useState(0);
  useEffect(() => {
    fetchLPTokenPrice().then((r) => {
      if (r.price > 0) setLpTokenPrice(r.price);
    });
  }, []);

  // DAO voting power
  const votingPower = useMemo(() => {
    if (!hederaAccount) return 0;
    return maxVotesForBalance(hederaAccount.tokens, hederaNetwork);
  }, [hederaAccount, hederaNetwork]);

  const portfolio = useMemo<{
    slices: SliceData[];
    totalUsd: number;
  }>(() => {
    if (!hederaAccount) return { slices: [], totalUsd: 0 };

    const items: SliceData[] = [];

    // HBAR native balance
    const hbarUsd = hederaAccount.hbarBalance * hbarPrice;
    if (hbarUsd > 0.01) {
      items.push({
        name: "HBAR",
        symbol: "HBAR",
        value: hbarUsd,
        percentage: 0,
      });
    }

    // HTS token balances — use balance (human-readable) * rough price
    // We don't have live prices for all tokens here, so estimate where possible
    const KNOWN_PRICES: Record<string, number> = {
      "0.0.456858": 1.0,     // USDC
      "0.0.4291336": 1.0,    // USDT
      "0.0.1456986": hbarPrice, // WHBAR
      "0.0.731861": 0.045,   // SAUCE
      "0.0.9356476": hbarhPrice,  // HBAR.ħ — live price from DexScreener
      "0.0.9356724": lpTokenPrice, // ssLP-WHBAR-HBAR.ħ — live LP price
      "0.0.2283328": 0.001,  // KARATE
      "0.0.4589822": 0.03,   // PACK
      "0.0.1159928": 0.002,  // HST
    };

    for (const token of hederaAccount.tokens) {
      const price = KNOWN_PRICES[token.tokenId];
      const usd = price ? token.balance * price : 0;
      if (usd > 0.01) {
        items.push({
          name: token.symbol || token.tokenId,
          symbol: token.symbol || "???",
          value: usd,
          percentage: 0,
        });
      }
    }

    // Sort by value descending
    items.sort((a, b) => b.value - a.value);

    // Cap at 8 slices, group the rest as "Other"
    let slices: SliceData[];
    if (items.length > 8) {
      const top = items.slice(0, 7);
      const rest = items.slice(7);
      const otherValue = rest.reduce((s, i) => s + i.value, 0);
      slices = [
        ...top,
        { name: `${rest.length} Others`, symbol: "OTHER", value: otherValue, percentage: 0 },
      ];
    } else {
      slices = items;
    }

    const totalUsd = slices.reduce((s, i) => s + i.value, 0);

    // Calculate percentages
    for (const s of slices) {
      s.percentage = totalUsd > 0 ? (s.value / totalUsd) * 100 : 0;
    }

    return { slices, totalUsd };
  }, [hederaAccount, hbarPrice, hbarhPrice, lpTokenPrice]);

  // Don't render if no wallet connected
  if (!primaryWallet || !hederaAccount) return null;

  // Don't render if zero portfolio value
  if (portfolio.totalUsd < 0.01) return null;

  const cardClass = isDark
    ? "bg-gradient-to-br from-slate-900/50 to-slate-900/30 border border-pink-500/20 backdrop-blur-sm"
    : "bg-white border border-gray-200 shadow-sm";

  return (
    <div className={`rounded-xl p-4 ${cardClass}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center">
            <Wallet className={`w-4 h-4 ${isDark ? "text-pink-400" : "text-pink-500"}`} />
          </div>
          <div>
            <div className="text-sm font-bold">Portfolio Overview</div>
            <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Connected wallet allocation
            </div>
          </div>
        </div>
        <Link
          to="/wallet"
          className={`flex items-center gap-1 text-xs transition-colors ${
            isDark ? "text-pink-400 hover:text-pink-300" : "text-pink-600 hover:text-pink-500"
          }`}
        >
          Details <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      <div className="flex items-center gap-4">
        {/* Donut Chart */}
        <div className="w-28 h-28 flex-shrink-0 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={portfolio.slices}
                cx="50%"
                cy="50%"
                innerRadius={30}
                outerRadius={48}
                dataKey="value"
                strokeWidth={1}
                stroke={isDark ? "#0f0f1a" : "#ffffff"}
              >
                {portfolio.slices.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.[0]) return null;
                  const d = payload[0].payload as SliceData;
                  return (
                    <div
                      className={`px-2.5 py-1.5 rounded-lg text-xs shadow-lg ${
                        isDark
                          ? "bg-slate-800 border border-pink-500/20 text-white"
                          : "bg-white border border-gray-200 text-gray-900"
                      }`}
                    >
                      <div className="font-bold">{d.name}</div>
                      <div>${d.value.toFixed(2)} ({d.percentage.toFixed(1)}%)</div>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-[10px] font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                ${portfolio.totalUsd >= 1000
                  ? `${(portfolio.totalUsd / 1000).toFixed(1)}K`
                  : portfolio.totalUsd.toFixed(0)}
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 min-w-0 space-y-1">
          {portfolio.slices.slice(0, 6).map((slice, idx) => (
            <div key={slice.symbol} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                />
                <span className="truncate font-bold">{slice.symbol}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                  ${slice.value >= 1000 ? `${(slice.value / 1000).toFixed(1)}K` : slice.value.toFixed(2)}
                </span>
                <span className={`w-10 text-right ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {slice.percentage.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
          {portfolio.slices.length > 6 && (
            <div className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              +{portfolio.slices.length - 6} more in wallet
            </div>
          )}
        </div>
      </div>

      {/* Quick stats row */}
      <div className={`flex items-center gap-3 mt-3 pt-3 border-t text-xs flex-wrap ${
        isDark ? "border-pink-500/10 text-slate-400" : "border-gray-100 text-gray-500"
      }`}>
        <div className="flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          <span>{formatHbar(hederaAccount.hbarBalance)} HBAR</span>
        </div>
        <span>&middot;</span>
        <span>{hederaAccount.tokens.length} tokens</span>
        <span>&middot;</span>
        <span>${(hederaAccount.hbarBalance * hbarPrice).toFixed(2)} in HBAR</span>
        {votingPower > 0 && (
          <>
            <span>&middot;</span>
            <span className="flex items-center gap-1 text-purple-400">
              <Vote className="w-3 h-3" />
              <span>{votingPower}x DAO Power</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
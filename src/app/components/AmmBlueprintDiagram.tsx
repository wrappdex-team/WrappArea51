import { motion } from "motion/react";
import {
  Cpu,
  ArrowRight,
  ArrowDown,
  Shield,
  Lock,
  Zap,
  Database,
  Globe,
  Server,
  CheckCircle2,
  Layers,
  Router,
  Wallet,
  KeyRound,
  DollarSign,
  AlertTriangle,
  Droplets,
  CircleDot,
  Repeat,
  TrendingUp,
  Box,
  ArrowDownUp,
  Minus,
  Plus,
  Gem,
  Sigma,
} from "lucide-react";

/* ── Shared tiny helpers (duplicated from EmrakDiagrams for isolation) ── */

function SectionLabel({
  children,
  isDark,
  color,
}: {
  children: string;
  isDark: boolean;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      <span
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color }}
      >
        {children}
      </span>
      <div
        className="flex-1 h-px"
        style={{
          background: isDark
            ? `linear-gradient(90deg, ${color}30, transparent)`
            : `linear-gradient(90deg, ${color}20, transparent)`,
        }}
      />
    </div>
  );
}

function FlowArrow({
  direction = "down",
  label,
  isDark,
  color = "#94A3B8",
}: {
  direction?: "right" | "down";
  label?: string;
  isDark: boolean;
  color?: string;
}) {
  const Arr = direction === "down" ? ArrowDown : ArrowRight;
  return (
    <div
      className={`flex ${direction === "down" ? "flex-col" : "flex-row"} items-center gap-0.5 ${
        direction === "down" ? "py-1" : "px-1"
      }`}
    >
      {label && (
        <span className="text-[9px] font-medium whitespace-nowrap" style={{ color }}>
          {label}
        </span>
      )}
      <motion.div
        animate={direction === "down" ? { y: [0, 3, 0] } : { x: [0, 3, 0] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <Arr className="w-3.5 h-3.5" style={{ color }} />
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   AMM BLUEPRINT — Full Wiring Schematic
   ═══════════════════════════════════════════════════════════════════════ */

export function AmmBlueprintDiagram({ isDark }: { isDark: boolean }) {
  const bg = (opacity: string) =>
    isDark ? `bg-white/[${opacity}]` : "bg-white/80";
  const bdr = (opacity: string) =>
    isDark ? `border-white/[${opacity}]` : "border-gray-200";
  const muted = isDark ? "text-slate-500" : "text-gray-400";
  const faint = isDark ? "text-slate-600" : "text-gray-300";
  const bright = isDark ? "text-white" : "text-slate-900";

  return (
    <div className="space-y-5">
      {/* ── Title Banner ───────────────────────────────────────────── */}
      <SectionLabel isDark={isDark} color="#06b6d4">
        WRAPpDEX Constant-Product AMM Engine — Full Wiring Schematic
      </SectionLabel>

      {/* Engineering spec badge */}
      <motion.div
        className={`rounded-xl px-4 py-3 border ${
          isDark ? "bg-cyan-500/[0.04] border-cyan-500/[0.10]" : "bg-cyan-50 border-cyan-200"
        }`}
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className={`text-[10px] font-bold ${isDark ? "text-cyan-300" : "text-cyan-700"}`}>
            ENGINEERING SPECIFICATION
          </span>
          <span
            className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
              isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-cyan-100 text-cyan-700"
            }`}
          >
            v2.1
          </span>
        </div>
        <p className={`text-[10px] leading-relaxed ${muted}`}>
          Server-side constant-product AMM on Hedera. No smart contracts — pool reserves live in KV store,
          the Hono server is the sole sequencer. Zero MEV by design. BigInt arithmetic throughout. This
          diagram traces every data flow from user intent to settlement.
        </p>
      </motion.div>

      {/* ═══ SECTION 1 — THE REACTOR CORE (x · y = k) ═══ */}
      <SectionLabel isDark={isDark} color="#8b5cf6">
        1 — Reactor Core: Constant-Product Engine
      </SectionLabel>

      <motion.div
        className={`relative rounded-2xl border p-5 overflow-hidden ${bg("0.02")} ${bdr("0.08")}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        {/* Background glow */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: isDark
              ? "radial-gradient(ellipse at 50% 50%, rgba(139,92,246,0.06), transparent 70%)"
              : "radial-gradient(ellipse at 50% 50%, rgba(139,92,246,0.03), transparent 70%)",
          }}
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 4, repeat: Infinity }}
        />

        {/* Core formula */}
        <div className="relative text-center mb-5">
          <motion.div
            className={`inline-block text-2xl sm:text-3xl font-bold font-mono tracking-wider ${
              isDark ? "text-purple-300" : "text-purple-700"
            }`}
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            x &middot; y = k
          </motion.div>
          <div className={`text-[10px] mt-1.5 ${faint}`}>
            Uniswap V2 constant-product invariant &mdash; the law that governs every pool
          </div>
        </div>

        {/* Reserve pair visual */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center mb-4">
          <motion.div
            className={`rounded-xl border p-3 text-center ${
              isDark ? "bg-blue-500/[0.04] border-blue-500/[0.10]" : "bg-blue-50 border-blue-200"
            }`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Box className="w-5 h-5 text-blue-400 mx-auto mb-1" />
            <div className={`text-xs font-bold ${bright}`}>Reserve X</div>
            <div className={`text-[9px] ${muted}`}>Token A balance</div>
            <div className={`text-[8px] font-mono mt-1 ${faint}`}>BigInt</div>
          </motion.div>

          <motion.div
            className="flex flex-col items-center gap-1"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Repeat className="w-5 h-5 text-purple-400" />
            <span className={`text-[8px] font-bold ${isDark ? "text-purple-400" : "text-purple-600"}`}>
              INVARIANT
            </span>
          </motion.div>

          <motion.div
            className={`rounded-xl border p-3 text-center ${
              isDark ? "bg-emerald-500/[0.04] border-emerald-500/[0.10]" : "bg-emerald-50 border-emerald-200"
            }`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Box className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
            <div className={`text-xs font-bold ${bright}`}>Reserve Y</div>
            <div className={`text-[9px] ${muted}`}>Token B balance</div>
            <div className={`text-[8px] font-mono mt-1 ${faint}`}>BigInt</div>
          </motion.div>
        </div>

        {/* Core math breakdown */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "getAmountOut()", formula: "dy = (y · dx · 9975) / (x · 10000 + dx · 9975)", color: "#3b82f6", icon: ArrowDownUp },
            { label: "getAmountIn()", formula: "dx = (x · dy · 10000) / ((y - dy) · 9975) + 1", color: "#8b5cf6", icon: Sigma },
            { label: "Price Impact", formula: "1 - (amountOut / (dx · spotPrice))", color: "#f59e0b", icon: TrendingUp },
            { label: "Spot Price", formula: "reserveY / reserveX", color: "#10b981", icon: CircleDot },
          ].map((item, i) => (
            <motion.div
              key={item.label}
              className={`rounded-lg border p-2.5 ${
                isDark ? "bg-[#0b0e1a]/60 border-white/[0.05]" : "bg-gray-50 border-gray-100"
              }`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.08 }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <item.icon className="w-3 h-3" style={{ color: item.color }} />
                <span className="text-[10px] font-bold" style={{ color: item.color }}>
                  {item.label}
                </span>
              </div>
              <div className={`text-[8px] font-mono leading-relaxed ${faint}`}>{item.formula}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ═══ SECTION 2 — SWAP EXECUTION FLOW ═══ */}
      <SectionLabel isDark={isDark} color="#3b82f6">
        2 — Swap Execution Flow
      </SectionLabel>

      <div className="space-y-1">
        {[
          { icon: Wallet, label: "User Intent", sub: "HashPack signs swap request", color: "#8b5cf6", tag: "CLIENT" },
          { icon: KeyRound, label: "Session Auth", sub: "X-Session-Token header validated", color: "#f59e0b", tag: "AUTH" },
          { icon: Router, label: "Smart Router", sub: "Score direct vs USDC-hop, pick best amountOut", color: "#06b6d4", tag: "ROUTE" },
          { icon: Lock, label: "Pool Lock Acquired", sub: "KV pessimistic mutex · 5s TTL · 3s wait", color: "#ef4444", tag: "LOCK" },
          { icon: Database, label: "Read Reserves", sub: "KV mget() · BigInt parse · version check", color: "#3b82f6", tag: "READ" },
          { icon: Sigma, label: "Compute Output", sub: "getAmountOut() · fee deduction · slippage guard", color: "#8b5cf6", tag: "MATH" },
          { icon: Zap, label: "Fee Split", sub: "0.25% stays in pool · $0.0007 flat \u2192 50/50 LP/Treasury", color: "#f59e0b", tag: "FEE" },
          { icon: CheckCircle2, label: "K-Invariant Assert", sub: "k_new \u2265 k_old or revert. Non-negotiable.", color: "#10b981", tag: "GUARD" },
          { icon: Layers, label: "CAS Write", sub: "Compare-and-swap reserves + bump version", color: "#06b6d4", tag: "WRITE" },
          { icon: Database, label: "Settlement", sub: "~2s Hedera consensus finality", color: "#10b981", tag: "DONE" },
        ].map((step, i) => (
          <div key={step.label}>
            <motion.div
              className={`relative rounded-xl border px-3 py-2 ${bg("0.03")} ${bdr("0.08")}`}
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
            >
              {i === 9 && (
                <motion.div
                  className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0.4, 0.8] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              )}
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ background: `${step.color}15`, border: `1px solid ${step.color}25` }}
                >
                  <step.icon className="w-3 h-3" style={{ color: step.color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold ${bright}`}>{step.label}</span>
                    <span
                      className="text-[7px] font-mono font-bold px-1.5 py-0.5 rounded"
                      style={{ background: `${step.color}12`, color: step.color }}
                    >
                      {step.tag}
                    </span>
                  </div>
                  <div className={`text-[9px] mt-0.5 ${muted}`}>{step.sub}</div>
                </div>
                <span className={`text-[9px] font-mono flex-shrink-0 ${faint}`}>{i + 1}/10</span>
              </div>
            </motion.div>
            {i < 9 && (
              <div className="flex items-center justify-center py-0.5">
                <motion.div
                  animate={{ y: [0, 2, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.05 }}
                >
                  <ArrowDown
                    className="w-3 h-3"
                    style={{ color: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)" }}
                  />
                </motion.div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ═══ SECTION 3 — LIQUIDITY OPERATIONS ═══ */}
      <SectionLabel isDark={isDark} color="#10b981">
        3 — Liquidity Operations
      </SectionLabel>

      <div className="grid grid-cols-2 gap-3">
        {/* Add Liquidity */}
        <motion.div
          className={`rounded-xl border p-4 ${
            isDark ? "bg-emerald-500/[0.03] border-emerald-500/[0.08]" : "bg-emerald-50/50 border-emerald-200"
          }`}
          initial={{ opacity: 0, x: -15 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20">
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div>
              <div className={`text-[11px] font-bold ${bright}`}>Add Liquidity</div>
              <div className={`text-[8px] ${faint}`}>Proportional deposit</div>
            </div>
          </div>
          <div className="space-y-2">
            {[
              "Calculate ratio: dA/dB = rA/rB",
              "LP shares = min(dA/rA, dB/rB) \u00b7 totalLP",
              "First deposit: \u221a(A\u00b7B) - 1000",
              "MINIMUM_LIQUIDITY burned forever",
              "Reserves += deposits",
              "totalLpSupply += newShares",
            ].map((line, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[8px] font-mono font-bold text-emerald-400/60 mt-0.5 w-3 flex-shrink-0">
                  {i + 1}.
                </span>
                <span className={`text-[9px] leading-snug ${muted}`}>{line}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Remove Liquidity */}
        <motion.div
          className={`rounded-xl border p-4 ${
            isDark ? "bg-red-500/[0.03] border-red-500/[0.08]" : "bg-red-50/50 border-red-200"
          }`}
          initial={{ opacity: 0, x: 15 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/20">
              <Minus className="w-3.5 h-3.5 text-red-400" />
            </div>
            <div>
              <div className={`text-[11px] font-bold ${bright}`}>Remove Liquidity</div>
              <div className={`text-[8px] ${faint}`}>Pro-rata withdrawal</div>
            </div>
          </div>
          <div className="space-y-2">
            {[
              "outA = shares/totalLP \u00b7 reserveA",
              "outB = shares/totalLP \u00b7 reserveB",
              "Includes accumulated swap fees",
              "Reserves -= withdrawals",
              "totalLpSupply -= burned shares",
              "Always open (even if kill switch on)",
            ].map((line, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[8px] font-mono font-bold text-red-400/60 mt-0.5 w-3 flex-shrink-0">
                  {i + 1}.
                </span>
                <span className={`text-[9px] leading-snug ${muted}`}>{line}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* LP token explanation */}
      <motion.div
        className={`rounded-xl border p-4 ${bg("0.02")} ${bdr("0.06")}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Gem className="w-3.5 h-3.5 text-purple-400" />
          <span className={`text-[10px] font-bold ${isDark ? "text-purple-300" : "text-purple-700"}`}>
            LP Share Token
          </span>
        </div>
        <p className={`text-[10px] leading-relaxed ${muted}`}>
          Each pool tracks{" "}
          <code
            className={`text-[9px] px-1 py-0.5 rounded ${isDark ? "bg-white/[0.05]" : "bg-gray-100"}`}
          >
            totalLpSupply
          </code>{" "}
          as a BigInt in KV. LP tokens are virtual — represented as a counter, not an on-chain HTS token
          (yet). Share calculation uses the Uniswap V2 formula: minted shares proportional to the lesser
          of the two deposit ratios. Fees compound automatically because they increase reserves without
          increasing LP supply.
        </p>
      </motion.div>

      {/* ═══ SECTION 4 — KV STORAGE SCHEMA ═══ */}
      <SectionLabel isDark={isDark} color="#f59e0b">
        4 — State Machine: KV Storage Schema
      </SectionLabel>

      <motion.div
        className={`rounded-xl border overflow-hidden ${bg("0.02")} ${bdr("0.08")}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <div
          className={`grid grid-cols-[1fr_2fr_1fr] gap-2 px-4 py-2.5 border-b ${
            isDark ? "bg-white/[0.02] border-white/[0.05]" : "bg-gray-50 border-gray-100"
          }`}
        >
          <span className={`text-[9px] font-bold uppercase tracking-wider ${faint}`}>KV Key</span>
          <span className={`text-[9px] font-bold uppercase tracking-wider ${faint}`}>Contents</span>
          <span className={`text-[9px] font-bold uppercase tracking-wider ${faint}`}>Type</span>
        </div>
        {[
          { key: "sl_pool_{id}", contents: "reserveA, reserveB, totalLP, version, fee counters", type: "JSON/BigInt" },
          { key: "sl_pool_lock_{id}", contents: "Pessimistic mutex \u00b7 5s TTL \u00b7 3s wait \u00b7 20ms retry", type: "Lock" },
          { key: "sl_treasury_fees", contents: "Accumulated protocol fees (per-token map)", type: "JSON/BigInt" },
          { key: "sl_treasury_lock", contents: "Serializes cross-pool treasury writes", type: "Lock" },
          { key: "sl_oracle_cache", contents: "SaucerSwap price data \u00b7 60s TTL", type: "JSON" },
          { key: "sl_pool_list", contents: "Active pool IDs + metadata (token pair, decimals)", type: "JSON" },
          { key: "sl_amm_halt", contents: "Emergency kill switch flag", type: "Boolean" },
        ].map((row, i) => (
          <motion.div
            key={row.key}
            className={`grid grid-cols-[1fr_2fr_1fr] gap-2 px-4 py-2 border-b last:border-b-0 ${
              isDark ? "border-white/[0.03]" : "border-gray-50"
            }`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 + i * 0.04 }}
          >
            <span className={`text-[9px] font-mono font-semibold ${isDark ? "text-amber-300/80" : "text-amber-700"}`}>
              {row.key}
            </span>
            <span className={`text-[9px] ${muted}`}>{row.contents}</span>
            <span className={`text-[8px] font-mono ${faint}`}>{row.type}</span>
          </motion.div>
        ))}
      </motion.div>

      {/* ═══ SECTION 5 — CONCURRENCY & SAFETY ═══ */}
      <SectionLabel isDark={isDark} color="#ef4444">
        5 — Concurrency & Safety Guarantees
      </SectionLabel>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Pessimistic Lock", desc: "KV-backed mutex per pool. Prevents concurrent reserve mutations.", specs: "5s TTL \u00b7 3s wait \u00b7 20ms retry", color: "#ef4444", icon: Lock },
          { label: "CAS Versioning", desc: "Version counter on every pool. Rejects stale writes even if lock held.", specs: "Monotonic uint64", color: "#f59e0b", icon: Layers },
          { label: "K-Invariant", desc: "Final assertion: k_new \u2265 k_old. Catches any arithmetic bug or exploit.", specs: "BigInt comparison", color: "#10b981", icon: Shield },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            className={`rounded-xl border p-3 ${bg("0.02")} ${bdr("0.06")}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.08 }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <item.icon className="w-3.5 h-3.5" style={{ color: item.color }} />
              <span className="text-[10px] font-bold" style={{ color: item.color }}>
                {item.label}
              </span>
            </div>
            <p className={`text-[9px] leading-snug ${muted}`}>{item.desc}</p>
            <div
              className={`text-[8px] font-mono mt-2 px-2 py-1 rounded ${
                isDark ? "bg-white/[0.03]" : "bg-gray-50"
              } ${faint}`}
            >
              {item.specs}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Kill switch + no MEV */}
      <div className="grid grid-cols-2 gap-3">
        <motion.div
          className={`rounded-xl border p-3 ${
            isDark ? "bg-red-500/[0.03] border-red-500/[0.08]" : "bg-red-50 border-red-200"
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className={`text-[10px] font-bold ${isDark ? "text-red-300" : "text-red-700"}`}>
              Kill Switch
            </span>
          </div>
          <p className={`text-[9px] leading-snug ${muted}`}>
            Owner-only halt. Swaps + deposits rejected. LP removals always open — users can always exit.
          </p>
        </motion.div>
        <motion.div
          className={`rounded-xl border p-3 ${
            isDark ? "bg-purple-500/[0.03] border-purple-500/[0.08]" : "bg-purple-50 border-purple-200"
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Shield className="w-3.5 h-3.5 text-purple-400" />
            <span className={`text-[10px] font-bold ${isDark ? "text-purple-300" : "text-purple-700"}`}>
              Zero MEV
            </span>
          </div>
          <p className={`text-[9px] leading-snug ${muted}`}>
            No public mempool. Server is the sole sequencer. No front-running, sandwiching, or tx
            reordering possible.
          </p>
        </motion.div>
      </div>

      {/* ═══ SECTION 6 — FEE WIRING ═══ */}
      <SectionLabel isDark={isDark} color="#f59e0b">
        6 — Fee Wiring
      </SectionLabel>

      <motion.div
        className={`rounded-xl border p-4 ${bg("0.02")} ${bdr("0.06")}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        {/* Fee pipeline */}
        <div className="flex items-center gap-2 mb-4">
          <div
            className={`flex-1 text-center rounded-lg py-2 border ${
              isDark ? "bg-blue-500/[0.04] border-blue-500/[0.10]" : "bg-blue-50 border-blue-200"
            }`}
          >
            <div className={`text-sm font-bold ${isDark ? "text-blue-300" : "text-blue-700"}`}>
              amountIn
            </div>
            <div className={`text-[8px] ${faint}`}>User sends Token A</div>
          </div>
          <ArrowRight
            className="w-4 h-4 flex-shrink-0"
            style={{ color: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)" }}
          />
          <div
            className={`flex-1 text-center rounded-lg py-2 border ${
              isDark ? "bg-amber-500/[0.04] border-amber-500/[0.10]" : "bg-amber-50 border-amber-200"
            }`}
          >
            <div className={`text-sm font-bold ${isDark ? "text-amber-300" : "text-amber-700"}`}>
              - 0.25%
            </div>
            <div className={`text-[8px] ${faint}`}>25 bps deducted</div>
          </div>
          <ArrowRight
            className="w-4 h-4 flex-shrink-0"
            style={{ color: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)" }}
          />
          <div
            className={`flex-1 text-center rounded-lg py-2 border ${
              isDark
                ? "bg-emerald-500/[0.04] border-emerald-500/[0.10]"
                : "bg-emerald-50 border-emerald-200"
            }`}
          >
            <div className={`text-sm font-bold ${isDark ? "text-emerald-300" : "text-emerald-700"}`}>
              amountOut
            </div>
            <div className={`text-[8px] ${faint}`}>User receives Token B</div>
          </div>
        </div>

        <FlowArrow
          direction="down"
          isDark={isDark}
          label="swap fee stays in pool reserves (increases k)"
          color="#10b981"
        />

        {/* Flat protocol fee */}
        <div className="mt-3 mb-3 text-center">
          <span
            className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg ${
              isDark
                ? "bg-amber-500/[0.06] text-amber-300 border border-amber-500/[0.12]"
                : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}
          >
            <DollarSign className="w-3 h-3" /> + $0.0007 flat fee
            <span className={`text-[8px] font-normal ${muted}`}>
              (HBAR \u00b7 oracle-priced \u00b7 500K tinybar cap)
            </span>
          </span>
        </div>

        <FlowArrow direction="down" isDark={isDark} label="50/50 split" color="#f59e0b" />

        <div className="grid grid-cols-2 gap-2 mt-2">
          <div
            className={`rounded-lg border p-2.5 text-center ${
              isDark ? "bg-emerald-500/[0.04] border-emerald-500/[0.10]" : "bg-emerald-50 border-emerald-200"
            }`}
          >
            <Droplets className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
            <div className={`text-xs font-bold ${isDark ? "text-emerald-300" : "text-emerald-700"}`}>
              50% LP Reward
            </div>
            <div className={`text-[8px] ${faint}`}>Added to reserves \u00b7 increases k</div>
          </div>
          <div
            className={`rounded-lg border p-2.5 text-center ${
              isDark ? "bg-blue-500/[0.04] border-blue-500/[0.10]" : "bg-blue-50 border-blue-200"
            }`}
          >
            <Database className="w-4 h-4 text-blue-400 mx-auto mb-1" />
            <div className={`text-xs font-bold ${isDark ? "text-blue-300" : "text-blue-700"}`}>
              50% Treasury
            </div>
            <div className={`text-[8px] font-mono ${faint}`}>0.0.9695738</div>
          </div>
        </div>
      </motion.div>

      {/* ═══ SECTION 7 — SYSTEM TOPOLOGY ═══ */}
      <SectionLabel isDark={isDark} color="#06b6d4">
        7 — System Topology
      </SectionLabel>

      <motion.div
        className={`rounded-xl border p-4 ${bg("0.02")} ${bdr("0.06")}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: "Frontend", sub: "React + Vite + Tailwind", detail: "HashPack SDK, MetaMask, WalletConnect", color: "#8b5cf6", icon: Globe },
            { label: "Edge Server", sub: "Hono on Supabase Edge", detail: "Sole sequencer, all AMM logic here", color: "#3b82f6", icon: Server },
            { label: "Data Layer", sub: "Supabase KV Store", detail: "BigInt pool state, locks, oracles", color: "#10b981", icon: Database },
          ].map((tier, i) => (
            <motion.div
              key={tier.label}
              className={`rounded-lg border p-3 text-center ${bg("0.03")} ${bdr("0.08")}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
            >
              <tier.icon className="w-5 h-5 mx-auto mb-1.5" style={{ color: tier.color }} />
              <div className={`text-[11px] font-bold ${bright}`}>{tier.label}</div>
              <div className={`text-[9px] ${muted}`}>{tier.sub}</div>
              <div className={`text-[8px] mt-1 ${faint}`}>{tier.detail}</div>
            </motion.div>
          ))}
        </div>

        {/* Connection lines */}
        <div className="flex items-center justify-center gap-2 mb-3">
          {[
            { from: "Frontend", to: "Edge Server", color: "#8b5cf6" },
            { from: "Edge Server", to: "KV Store", color: "#3b82f6" },
          ].map((conn) => (
            <div key={conn.from} className="flex items-center gap-1">
              <span className={`text-[8px] font-bold ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {conn.from}
              </span>
              <div className="flex items-center gap-0.5">
                <div className="w-6 h-px" style={{ background: conn.color }} />
                <motion.div
                  animate={{ x: [0, 3, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <ArrowRight className="w-2.5 h-2.5" style={{ color: conn.color }} />
                </motion.div>
              </div>
              <span className={`text-[8px] font-bold ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {conn.to}
              </span>
            </div>
          ))}
        </div>

        {/* External integrations */}
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { name: "Hedera\nMainnet", color: "#8b5cf6" },
            { name: "SaucerSwap\nOracle", color: "#10b981" },
            { name: "Mirror\nNode", color: "#3b82f6" },
            { name: "1inch\nAPI v6", color: "#f59e0b" },
          ].map((ext) => (
            <div
              key={ext.name}
              className={`text-center rounded-lg py-2 border ${
                isDark ? "bg-white/[0.02] border-white/[0.04]" : "bg-gray-50 border-gray-100"
              }`}
            >
              <div
                className="w-5 h-5 rounded-full mx-auto flex items-center justify-center text-[7px] font-bold text-white mb-1"
                style={{ background: ext.color }}
              >
                {ext.name.charAt(0)}
              </div>
              <div className={`text-[8px] font-semibold whitespace-pre-line leading-tight ${muted}`}>
                {ext.name}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── Footer: design philosophy ── */}
      <motion.div
        className={`rounded-xl px-4 py-3 border ${
          isDark ? "bg-white/[0.02] border-white/[0.05]" : "bg-gray-50 border-gray-100"
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <p className={`text-[10px] leading-relaxed ${muted}`}>
          <strong className={isDark ? "text-slate-400" : "text-gray-500"}>Design philosophy:</strong>{" "}
          WRAPpDEX deliberately avoids on-chain smart contracts. All AMM logic runs server-side in a
          Supabase Edge Function, using KV as the sole state store. This eliminates MEV, simplifies
          upgrades, and enables BigInt-precise arithmetic without EVM gas constraints. The tradeoff is
          trust in the server operator — mitigated by open-source code, audit trails, and the K-invariant
          safety net that prevents any reserve-draining bug from executing.
        </p>
      </motion.div>
    </div>
  );
}

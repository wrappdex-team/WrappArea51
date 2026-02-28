import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Cpu,
  ArrowRight,
  ArrowDown,
  Shield,
  Lock,
  Zap,
  Database,
  Globe,
  Server,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Layers,
  GitBranch,
  Router,
  Wallet,
  KeyRound,
  Activity,
  DollarSign,
  ChevronRight,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { AmmBlueprintDiagram } from "./AmmBlueprintDiagram";

/* ═══════════════════════════════════════════════════════════════════════
   TECHNICAL SCHEMATICS — Architecture Diagrams
   "You opened this expecting something techy... here are some doodles."
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Shared helpers ──────────────────────────────────────────────────── */

type Tab = "swap" | "router" | "security" | "oracle" | "fees" | "amm";

const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: "swap", label: "Swap Pipeline", icon: Zap },
  { id: "router", label: "Smart Router", icon: Router },
  { id: "security", label: "Security", icon: Shield },
  { id: "oracle", label: "Oracle", icon: Eye },
  { id: "fees", label: "Fees & Split", icon: DollarSign },
  { id: "amm", label: "AMM Blueprint", icon: Cpu },
];

/* ── Diagram building blocks ─────────────────────────────────────────── */

function DiagramBox({
  label,
  sublabel,
  icon: Icon,
  color,
  isDark,
  pulse,
  className = "",
  small,
}: {
  label: string;
  sublabel?: string;
  icon: typeof Cpu;
  color: string;
  isDark: boolean;
  pulse?: boolean;
  className?: string;
  small?: boolean;
}) {
  const sz = small ? "w-full" : "w-full";
  return (
    <motion.div
      className={`relative rounded-xl border px-3 py-2.5 ${sz} ${className} ${
        isDark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/80 border-gray-200"
      }`}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35 }}
    >
      {pulse && (
        <motion.div
          className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full"
          style={{ background: color }}
          animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0.4, 0.8] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: `${color}18`,
            border: `1px solid ${color}30`,
          }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
        <div className="min-w-0">
          <div
            className={`text-xs font-semibold leading-tight truncate ${
              isDark ? "text-white" : "text-slate-900"
            }`}
          >
            {label}
          </div>
          {sublabel && (
            <div
              className={`text-[10px] leading-tight mt-0.5 truncate ${
                isDark ? "text-slate-500" : "text-gray-400"
              }`}
            >
              {sublabel}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function FlowArrow({
  direction = "right",
  label,
  isDark,
  color = "#94A3B8",
  delay = 0,
}: {
  direction?: "right" | "down";
  label?: string;
  isDark: boolean;
  color?: string;
  delay?: number;
}) {
  const ArrowIcon = direction === "down" ? ArrowDown : ArrowRight;
  return (
    <motion.div
      className={`flex ${direction === "down" ? "flex-col" : "flex-row"} items-center gap-0.5 ${
        direction === "down" ? "py-1" : "px-1"
      }`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.3 }}
    >
      {label && (
        <span
          className="text-[9px] font-medium whitespace-nowrap"
          style={{ color }}
        >
          {label}
        </span>
      )}
      <motion.div
        animate={
          direction === "down"
            ? { y: [0, 3, 0] }
            : { x: [0, 3, 0] }
        }
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <ArrowIcon className="w-3.5 h-3.5" style={{ color }} />
      </motion.div>
    </motion.div>
  );
}

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

/* ── Token badge (for router diagram) ────────────────────────────────── */

function TokenBadge({
  symbol,
  color,
  isDark,
  size = "md",
}: {
  symbol: string;
  color: string;
  isDark: boolean;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "w-8 h-8" : "w-10 h-10";
  const text = size === "sm" ? "text-[9px]" : "text-[10px]";
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-bold ${text} text-white flex-shrink-0`}
      style={{
        background: `linear-gradient(135deg, ${color}, ${color}99)`,
        boxShadow: `0 0 12px ${color}30`,
      }}
    >
      {symbol}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TAB 1 — SWAP EXECUTION PIPELINE
   ═══════════════════════════════════════════════════════════════════════ */

function SwapPipelineDiagram({ isDark }: { isDark: boolean }) {
  const steps = [
    {
      icon: Wallet,
      label: "HashPack Wallet",
      sub: "ED25519 key pair",
      color: "#8b5cf6",
    },
    {
      icon: KeyRound,
      label: "Auth Challenge",
      sub: "CSPRNG nonce · 5 min TTL",
      color: "#f59e0b",
    },
    {
      icon: Globe,
      label: "Mirror Node Read",
      sub: "Pool account balances · on-chain ground truth",
      color: "#10b981",
    },
    {
      icon: Cpu,
      label: "Client-Side AMM Math",
      sub: "BigInt x·y=k · getAmountOut() · route scoring",
      color: "#3b82f6",
    },
    {
      icon: Server,
      label: "Server Co-Sign",
      sub: "Re-reads reserves · validates math · signs pool side",
      color: "#ef4444",
    },
    {
      icon: CheckCircle2,
      label: "Atomic CryptoTransfer",
      sub: "Both legs settle in ~3-5s · atomic or nothing",
      color: "#06b6d4",
    },
  ];

  return (
    <div>
      <SectionLabel isDark={isDark} color="#3b82f6">
        Swap Execution Pipeline
      </SectionLabel>

      {/* Main vertical flow */}
      <div className="space-y-1">
        {steps.map((step, i) => (
          <div key={step.label}>
            <DiagramBox
              icon={step.icon}
              label={step.label}
              sublabel={step.sub}
              color={step.color}
              isDark={isDark}
              pulse={i === 5}
            />
            {i < steps.length - 1 && (
              <FlowArrow
                direction="down"
                isDark={isDark}
                color={steps[i + 1].color}
                delay={i * 0.08}
                label={
                  i === 0
                    ? "sign nonce"
                    : i === 1
                      ? "X-Session-Token"
                      : i === 2
                        ? "BigInt reserves"
                        : i === 3
                          ? "frozen TX bytes"
                          : "wallet sign + submit"
                }
              />
            )}
          </div>
        ))}
      </div>

      {/* K-Invariant callout */}
      <motion.div
        className={`mt-4 rounded-xl px-3.5 py-3 border ${
          isDark
            ? "bg-emerald-500/[0.04] border-emerald-500/[0.12]"
            : "bg-emerald-50 border-emerald-200"
        }`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className={`text-[11px] font-semibold ${isDark ? "text-emerald-300" : "text-emerald-700"}`}>
              Post-Swap K-Invariant Assertion
            </p>
            <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Server independently verifies k<sub>new</sub> {"≥"} k<sub>old</sub> before co-signing. Fee stays in pool (increases k), benefiting all LPs.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Architecture note */}
      <motion.div
        className={`mt-3 rounded-xl px-3.5 py-3 border ${
          isDark
            ? "bg-white/[0.02] border-white/[0.05]"
            : "bg-gray-50 border-gray-100"
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        <p className={`text-[10px] leading-relaxed ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          <strong className={isDark ? "text-slate-400" : "text-gray-500"}>Key design decision:</strong>{" "}
          Pool reserves are the actual on-chain token balances of real Hedera accounts, verifiable by anyone
          via Mirror Node or HashScan. AMM math runs client-side in BigInt. The server is a <em>signing oracle</em> —
          it holds pool account keys (Phase 1), validates the math independently, and co-signs the pool side of
          the CryptoTransfer. Both token legs settle atomically at Hedera consensus — no partial fills, no intermediate state.
        </p>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TAB 2 — SMART ROUTING ENGINE
   ═══════════════════════════════════════════════════════════════════════ */

function SmartRouterDiagram({ isDark }: { isDark: boolean }) {
  return (
    <div>
      <SectionLabel isDark={isDark} color="#8b5cf6">
        Smart Routing · Direct vs Hub Multi-Hop
      </SectionLabel>

      {/* Direct Route */}
      <motion.div
        className={`rounded-xl border p-4 mb-3 ${
          isDark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white/80 border-gray-200"
        }`}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-1.5 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
            Route A — Direct Pool
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <TokenBadge symbol="WBTC" color="#f7931a" isDark={isDark} />
          <div className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full h-px"
              style={{
                background: isDark
                  ? "linear-gradient(90deg, #f7931a50, #10b98150)"
                  : "linear-gradient(90deg, #f7931a30, #10b98130)",
              }}
            />
            <div className={`text-[9px] font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              ap-wbtc-whbar · 25 bps
            </div>
            <div
              className={`text-[9px] px-2 py-0.5 rounded-full ${
                isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
              }`}
            >
              x · y = k
            </div>
          </div>
          <TokenBadge symbol="WHBAR" color="#8247e5" isDark={isDark} />
        </div>
      </motion.div>

      {/* Multi-Hop Route */}
      <motion.div
        className={`rounded-xl border p-4 mb-3 ${
          isDark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white/80 border-gray-200"
        }`}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
      >
        <div className="flex items-center gap-1.5 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-purple-400" : "text-purple-600"}`}>
            Route B — WHBAR Hub Multi-Hop
          </span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <TokenBadge symbol="WBTC" color="#f7931a" isDark={isDark} size="sm" />
          <div className="flex flex-col items-center flex-1 gap-0.5">
            <div
              className="w-full h-px"
              style={{
                background: isDark ? "rgba(247,147,26,0.25)" : "rgba(247,147,26,0.15)",
              }}
            />
            <span className={`text-[8px] ${isDark ? "text-slate-600" : "text-gray-300"}`}>ap-wbtc-whbar</span>
          </div>
          <TokenBadge symbol="WHBAR" color="#8247e5" isDark={isDark} size="sm" />
          <div className="flex flex-col items-center flex-1 gap-0.5">
            <div
              className="w-full h-px"
              style={{
                background: isDark ? "rgba(130,71,229,0.25)" : "rgba(130,71,229,0.15)",
              }}
            />
            <span className={`text-[8px] ${isDark ? "text-slate-600" : "text-gray-300"}`}>ap-usdc-whbar</span>
          </div>
          <TokenBadge symbol="USDC" color="#2775ca" isDark={isDark} size="sm" />
        </div>
        <div className={`text-[9px] text-center mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          2× 25 bps = 50 bps total · Combined price impact evaluated
        </div>
      </motion.div>

      {/* Smart Router details */}
      <motion.div
        className={`rounded-xl border p-4 ${
          isDark ? "bg-amber-500/[0.03] border-amber-500/[0.10]" : "bg-amber-50 border-amber-200"
        }`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <GitBranch className="w-3.5 h-3.5 text-amber-400" />
          <span className={`text-[10px] font-bold ${isDark ? "text-amber-300" : "text-amber-700"}`}>
            Route Selection
          </span>
        </div>
        <div className="space-y-1.5">
          {[
            "All active pool reserves fetched from Mirror Node in parallel",
            "Both direct and hub-hop candidates scored (hubs: USDC, WHBAR)",
            "Winner = highest amountOut (sort descending)",
            "TVL < $100 pools excluded (manipulation resistance)",
            "Depth cap: <$10K→2%, <$100K→5%, >$100K→10% of TVL",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <ChevronRight className={`w-3 h-3 mt-0.5 flex-shrink-0 ${isDark ? "text-amber-500/60" : "text-amber-400"}`} />
              <span className={`text-[10px] leading-snug ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {item}
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* External DEX aggregation (planned) */}
      <motion.div
        className={`mt-3 rounded-xl border p-4 ${
          isDark ? "bg-cyan-500/[0.03] border-cyan-500/[0.10]" : "bg-cyan-50 border-cyan-200"
        }`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span className={`text-[10px] font-bold ${isDark ? "text-cyan-300" : "text-cyan-700"}`}>
            External DEX Aggregation (Planned)
          </span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          {["SaucerSwap", "Pangolin", "HeliSwap"].map((dex, i) => (
            <motion.div
              key={dex}
              className={`flex-1 text-center rounded-lg py-1.5 border text-[9px] font-medium ${
                isDark ? "bg-white/[0.02] border-white/[0.05] text-slate-400" : "bg-white border-gray-100 text-gray-500"
              }`}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.08 }}
            >
              <Cpu className={`w-3 h-3 mx-auto mb-0.5 ${i === 0 ? "text-cyan-400" : isDark ? "text-slate-600" : "text-gray-300"}`} />
              {dex}
            </motion.div>
          ))}
        </div>
        <p className={`text-[10px] leading-snug ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Currently WRAPpDEX pools only. Future roadmap: cross-DEX aggregation via
          1inch and native multi-hop routing across SaucerSwap, Pangolin, HeliSwap.
        </p>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TAB 3 — SECURITY ARCHITECTURE
   ═══════════════════════════════════════════════════════════════════════ */

function SecurityDiagram({ isDark }: { isDark: boolean }) {
  const layers = [
    {
      label: "ED25519 Session Auth",
      desc: "CSPRNG nonce → wallet signature → Mirror Node pubkey verify → 30-min session token. Single-use nonces, replay-protected.",
      color: "#8b5cf6",
      icon: KeyRound,
    },
    {
      label: "Atomic Settlement (No MEV)",
      desc: "Every swap is a single Hedera CryptoTransfer — both token legs settle atomically at consensus. No public transaction queue, no front-running, no sandwich attacks, no reordering.",
      color: "#ef4444",
      icon: Shield,
    },
    {
      label: "Server-Side Reserve Validation",
      desc: "The signing oracle independently re-reads pool account balances from Mirror Node and recomputes the expected output. If client and server disagree by >1 raw unit, co-signing is refused.",
      color: "#f59e0b",
      icon: Lock,
    },
    {
      label: "Dual-Sig Transaction Model",
      desc: "Transaction bytes are built client-side. The user's wallet shows the full transfer for review. Server signs pool side only after independent validation. User signs last + submits.",
      color: "#10b981",
      icon: Layers,
    },
    {
      label: "K-Invariant Assertion",
      desc: "The constant-product formula mathematically guarantees k_new ≥ k_old (algebraically proven in unit tests). The server's independent reserve re-read + AMM recomputation enforces this. Any divergence triggers co-sign rejection.",
      color: "#06b6d4",
      icon: CheckCircle2,
    },
    {
      label: "AMM Kill Switch",
      desc: "Owner-only emergency halt. All swaps and new liquidity rejected. LP removals stay open — users must always be able to withdraw.",
      color: "#dc2626",
      icon: AlertTriangle,
    },
  ];

  return (
    <div>
      <SectionLabel isDark={isDark} color="#ef4444">
        Defense-in-Depth Security Model
      </SectionLabel>

      {/* Concentric security rings visualization */}
      <div className="relative mb-4">
        {[0, 1, 2].map((ring) => (
          <motion.div
            key={ring}
            className="absolute inset-0 rounded-xl border pointer-events-none"
            style={{
              borderColor: isDark
                ? `rgba(239,68,68,${0.04 + ring * 0.03})`
                : `rgba(239,68,68,${0.06 + ring * 0.03})`,
              margin: `${ring * 4}px`,
            }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: ring * 0.15, duration: 0.4 }}
          />
        ))}
        <div className="relative p-3 space-y-2">
          {layers.map((layer, i) => (
            <motion.div
              key={layer.label}
              className={`rounded-lg border p-3 ${
                isDark ? "bg-[#0b0e1a]/80 border-white/[0.06]" : "bg-white/90 border-gray-100"
              }`}
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08, duration: 0.35 }}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{
                    background: `${layer.color}15`,
                    border: `1px solid ${layer.color}25`,
                  }}
                >
                  <layer.icon className="w-3 h-3" style={{ color: layer.color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] font-bold ${isDark ? "text-white" : "text-slate-900"}`}
                    >
                      {layer.label}
                    </span>
                    <span
                      className="text-[8px] font-mono px-1.5 py-0.5 rounded"
                      style={{
                        background: `${layer.color}12`,
                        color: layer.color,
                      }}
                    >
                      L{i + 1}
                    </span>
                  </div>
                  <p className={`text-[10px] mt-0.5 leading-snug ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {layer.desc}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Depth cap visual */}
      <motion.div
        className={`rounded-xl border p-4 ${
          isDark ? "bg-white/[0.02] border-white/[0.06]" : "bg-gray-50 border-gray-100"
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-3.5 h-3.5 text-pink-400" />
          <span className={`text-[10px] font-bold ${isDark ? "text-pink-300" : "text-pink-600"}`}>
            Depth-Proportional Swap Caps
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { range: "< $10K TVL", cap: "2%", color: "#ef4444" },
            { range: "< $100K TVL", cap: "5%", color: "#f59e0b" },
            { range: "> $100K TVL", cap: "10%", color: "#10b981" },
          ].map((tier) => (
            <div
              key={tier.range}
              className={`text-center rounded-lg py-2 border ${
                isDark ? "bg-white/[0.02] border-white/[0.05]" : "bg-white border-gray-100"
              }`}
            >
              <div
                className="text-sm font-bold"
                style={{ color: tier.color }}
              >
                {tier.cap}
              </div>
              <div className={`text-[9px] mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {tier.range}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TAB 4 — ORACLE PIPELINE
   ═══════════════════════════════════════════════════════════════════════ */

function OracleDiagram({ isDark }: { isDark: boolean }) {
  return (
    <div>
      <SectionLabel isDark={isDark} color="#f59e0b">
        Oracle Price Pipeline — Display Only
      </SectionLabel>

      {/* Critical callout */}
      <motion.div
        className={`rounded-xl px-3.5 py-2.5 mb-4 border ${
          isDark
            ? "bg-amber-500/[0.04] border-amber-500/[0.12]"
            : "bg-amber-50 border-amber-200"
        }`}
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <p className={`text-[10px] font-medium ${isDark ? "text-amber-300/80" : "text-amber-700"}`}>
          Oracle prices are used for UI display and TVL calculation only.
          Actual swap outputs are computed from pool reserves using constant-product math.
          Oracle manipulation cannot affect swap execution.
        </p>
      </motion.div>

      {/* Pipeline flow */}
      <div className="space-y-1">
        <DiagramBox
          icon={Globe}
          label="SaucerSwap API"
          sublabel="/tokens, /v1/tokens, /v2/tokens — tries cached working path first"
          color="#8b5cf6"
          isDark={isDark}
        />
        <FlowArrow direction="down" isDark={isDark} label="8s timeout · try next variant on fail" color="#8b5cf6" />
        <DiagramBox
          icon={Database}
          label="In-Memory Oracle Cache"
          sublabel="30s TTL · SaucerSwap prices · display only"
          color="#3b82f6"
          isDark={isDark}
        />
        <FlowArrow direction="down" isDark={isDark} label="cache miss or stale" color="#f59e0b" />
        <DiagramBox
          icon={Shield}
          label="Hardcoded Fallback Prices"
          sublabel="Per-token fallbackPriceUsd · last resort when all oracles fail"
          color="#f59e0b"
          isDark={isDark}
        />
        <FlowArrow direction="down" isDark={isDark} label="prices delivered" color="#10b981" />
        <DiagramBox
          icon={Eye}
          label="UI / TVL Display"
          sublabel="Portfolio valuation · pool TVL · depth cap calculation"
          color="#10b981"
          isDark={isDark}
          pulse
        />
      </div>

      {/* Token whitelist */}
      <motion.div
        className={`mt-4 rounded-xl border p-4 ${
          isDark ? "bg-white/[0.02] border-white/[0.06]" : "bg-gray-50 border-gray-100"
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-3.5 h-3.5 text-blue-400" />
          <span className={`text-[10px] font-bold ${isDark ? "text-blue-300" : "text-blue-600"}`}>
            Token Whitelist (Tier 1 — Pool Eligible)
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {[
            { sym: "WHBAR", color: "#8247e5", bridge: "Native" },
            { sym: "USDC", color: "#2775ca", bridge: "Circle" },
            { sym: "USDT", color: "#26a17b", bridge: "Tether" },
            { sym: "DAI", color: "#f5ac37", bridge: "HashPort" },
            { sym: "WBTC", color: "#f7931a", bridge: "HashPort" },
            { sym: "WETH", color: "#627eea", bridge: "HashPort" },
            { sym: "LINK", color: "#2a5ada", bridge: "HashPort" },
            { sym: "AAVE", color: "#9f71ec", bridge: "HashPort" },
            { sym: "WBNB", color: "#f0b90b", bridge: "LayerZero" },
            { sym: "WAVAX", color: "#e84142", bridge: "LayerZero" },
          ].map((t) => (
            <div
              key={t.sym}
              className={`text-center rounded-lg py-2 border ${
                isDark ? "bg-white/[0.02] border-white/[0.05]" : "bg-white border-gray-100"
              }`}
            >
              <div
                className="w-6 h-6 rounded-full mx-auto flex items-center justify-center text-[8px] font-bold text-white mb-1"
                style={{ background: t.color }}
              >
                {t.sym.charAt(0)}
              </div>
              <div className={`text-[9px] font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                {t.sym}
              </div>
              <div className={`text-[8px] ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                {t.bridge}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* 1inch proxy */}
      <motion.div
        className={`mt-3 rounded-xl border p-4 ${
          isDark ? "bg-purple-500/[0.03] border-purple-500/[0.10]" : "bg-purple-50 border-purple-200"
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Router className="w-3.5 h-3.5 text-purple-400" />
          <span className={`text-[10px] font-bold ${isDark ? "text-purple-300" : "text-purple-700"}`}>
            1inch Swap API v6.0 — EVM Cross-Chain Proxy
          </span>
        </div>
        <p className={`text-[10px] leading-snug ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Server-side proxy keeps API key secure. Supports ETH, Polygon, BSC, Arbitrum, Optimism, Base.
          10s quote cache (500 max). Rate-limited per IP. Frontend never touches the 1inch key.
        </p>
        <div className="flex flex-wrap gap-1 mt-2">
          {["ETH", "MATIC", "BSC", "ARB", "OP", "BASE"].map((chain) => (
            <span
              key={chain}
              className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${
                isDark ? "bg-purple-500/10 text-purple-400" : "bg-purple-100 text-purple-600"
              }`}
            >
              {chain}
            </span>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TAB 5 — PROTOCOL FEE ARCHITECTURE
   ═══════════════════════════════════════════════════════════════════════ */

function FeesDiagram({ isDark }: { isDark: boolean }) {
  return (
    <div>
      <SectionLabel isDark={isDark} color="#10b981">
        Protocol Fee Architecture
      </SectionLabel>

      {/* Main fee split diagram */}
      <motion.div
        className={`rounded-xl border p-4 mb-4 ${
          isDark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white/80 border-gray-200"
        }`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Swap fee */}
        <div className="text-center mb-4">
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{
              background: isDark
                ? "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.06))"
                : "linear-gradient(135deg, rgba(16,185,129,0.06), rgba(59,130,246,0.04))",
              border: isDark ? "1px solid rgba(16,185,129,0.15)" : "1px solid rgba(16,185,129,0.2)",
            }}
          >
            <Zap className="w-4 h-4 text-emerald-400" />
            <div>
              <span className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                0.25%
              </span>
              <span className={`text-[10px] ml-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                (25 bps) swap fee
              </span>
            </div>
          </div>
          <p className={`text-[10px] mt-1.5 ${isDark ? "text-slate-600" : "text-gray-300"}`}>
            Full 0.25% stays in pool · 0.05% tracked for DAO extraction
          </p>
        </div>

        <FlowArrow direction="down" isDark={isDark} label="fee stays in reserves" color="#10b981" />

        {/* Protocol fee - the flat $0.0007 */}
        <div className="text-center my-3">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{
              background: isDark ? "rgba(251,191,36,0.06)" : "rgba(251,191,36,0.08)",
              border: isDark ? "1px solid rgba(251,191,36,0.12)" : "1px solid rgba(251,191,36,0.2)",
            }}
          >
            <DollarSign className="w-3.5 h-3.5 text-amber-400" />
            <span className={`text-xs font-bold ${isDark ? "text-amber-300" : "text-amber-700"}`}>
              + $0.0007 flat protocol fee per swap
            </span>
          </div>
          <p className={`text-[10px] mt-1 ${isDark ? "text-slate-600" : "text-gray-300"}`}>
            Paid in HBAR · oracle-priced · clamped at 500,000 tinybar safety ceiling
          </p>
        </div>

        <FlowArrow direction="down" isDark={isDark} label="50/50 split" color="#f59e0b" />

        {/* Split diagram */}
        <div className="grid grid-cols-2 gap-3 mt-2">
          <motion.div
            className={`rounded-xl border p-3 text-center ${
              isDark ? "bg-emerald-500/[0.04] border-emerald-500/[0.10]" : "bg-emerald-50 border-emerald-200"
            }`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="text-lg font-bold text-emerald-400">50%</div>
            <div className={`text-[10px] font-semibold ${isDark ? "text-emerald-300/80" : "text-emerald-700"}`}>
              LP Reward
            </div>
            <div className={`text-[9px] mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Added to reserves
            </div>
            <div className={`text-[9px] ${isDark ? "text-slate-600" : "text-gray-300"}`}>
              Increases k
            </div>
          </motion.div>
          <motion.div
            className={`rounded-xl border p-3 text-center ${
              isDark ? "bg-blue-500/[0.04] border-blue-500/[0.10]" : "bg-blue-50 border-blue-200"
            }`}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="text-lg font-bold text-blue-400">50%</div>
            <div className={`text-[10px] font-semibold ${isDark ? "text-blue-300/80" : "text-blue-700"}`}>
              Treasury
            </div>
            <div className={`text-[9px] mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Accrued on-chain
            </div>
            <div className={`text-[9px] font-mono ${isDark ? "text-slate-600" : "text-gray-300"}`}>
              0.0.9695738
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Concurrency protection for fee accumulation */}
      <motion.div
        className={`rounded-xl border p-4 ${
          isDark ? "bg-white/[0.02] border-white/[0.06]" : "bg-gray-50 border-gray-100"
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Lock className="w-3.5 h-3.5 text-pink-400" />
          <span className={`text-[10px] font-bold ${isDark ? "text-pink-300" : "text-pink-600"}`}>
            Treasury Fee Lock
          </span>
        </div>
        <p className={`text-[10px] leading-snug ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Server-side signing lock serializes concurrent co-sign requests that would affect the same
          pool's fee accumulator. Prevents double-counting under high swap throughput. Fee extraction
          by DAO governance deducts tracked fees and credits the treasury account.
        </p>
      </motion.div>

      {/* Protocol Fee Tracking */}
      <motion.div
        className={`mt-3 rounded-xl border p-4 ${
          isDark ? "bg-pink-500/[0.03] border-pink-500/[0.10]" : "bg-pink-50 border-pink-200"
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-3.5 h-3.5 text-pink-400" />
          <span className={`text-[10px] font-bold ${isDark ? "text-pink-300" : "text-pink-600"}`}>
            Protocol Fee Tracking
          </span>
        </div>
        <p className={`text-[10px] leading-snug ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          Protocol's 0.05% share is tracked per pool via a dedicated accumulator. Fee extraction by DAO
          governance deducts from pool reserves and credits the treasury account (0.0.9695738). Until
          extraction, LPs earn the full 0.25%.
        </p>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN MODAL
   ═══════════════════════════════════════════════════════════════════════ */

interface EmrakDiagramsProps {
  open: boolean;
  onClose: () => void;
}

export function EmrakDiagrams({ open, onClose }: EmrakDiagramsProps) {
  const { isDark } = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("swap");
  const [jokeRevealed, setJokeRevealed] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      scrollRef.current?.scrollTo(0, 0);
      setJokeRevealed(false);
      // Auto-reveal joke after a beat
      const t = setTimeout(() => setJokeRevealed(true), 1200);
      return () => clearTimeout(t);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Scroll to top when tab changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 260, behavior: "smooth" });
  }, [tab]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0"
            style={{
              background: isDark
                ? "radial-gradient(ellipse at 50% 20%, rgba(251,146,60,0.04), rgba(0,0,0,0.75))"
                : "radial-gradient(ellipse at 50% 20%, rgba(251,146,60,0.03), rgba(0,0,0,0.5))",
              backdropFilter: "blur(6px)",
            }}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Container */}
          <motion.div
            className={`relative w-full max-w-2xl max-h-[90vh] rounded-2xl border overflow-hidden ${
              isDark ? "bg-[#0b0e1a]/95 border-white/[0.08]" : "bg-white/95 border-gray-200"
            }`}
            style={{
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              boxShadow: isDark
                ? "0 0 80px rgba(251,146,60,0.05), 0 32px 64px rgba(0,0,0,0.5)"
                : "0 32px 64px rgba(0,0,0,0.15)",
            }}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className={`absolute top-4 right-4 z-20 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                isDark
                  ? "bg-white/[0.06] hover:bg-white/[0.12] text-slate-400 hover:text-white"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800"
              }`}
              aria-label="Close diagrams"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Scrollable content */}
            <div ref={scrollRef} className="overflow-y-auto max-h-[90vh] overscroll-contain">
              {/* ── Header + Joke ── */}
              <div
                className="px-6 sm:px-10 pt-10 pb-4"
                style={{
                  background: isDark
                    ? "linear-gradient(180deg, rgba(251,146,60,0.04) 0%, transparent 100%)"
                    : "linear-gradient(180deg, rgba(251,146,60,0.03) 0%, transparent 100%)",
                }}
              >
                {/* Avatar */}
                <div className="flex justify-center mb-5">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white"
                    style={{
                      background: "linear-gradient(135deg, #f59e0b, #f97316)",
                    }}
                  >
                    <Cpu className="w-7 h-7" />
                  </div>
                </div>

                <h2
                  className={`text-center text-xl sm:text-2xl font-bold tracking-tight ${
                    isDark ? "text-white" : "text-slate-900"
                  }`}
                >
                  Technical Schematics
                </h2>
                <p className={`text-center text-sm mt-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Protocol Architecture
                </p>

                {/* The Joke */}
                <AnimatePresence>
                  {jokeRevealed && (
                    <motion.div
                      className={`mt-5 rounded-xl px-4 py-3 text-center border ${
                        isDark
                          ? "bg-amber-500/[0.04] border-amber-500/[0.10]"
                          : "bg-amber-50 border-amber-200"
                      }`}
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                    >
                      <p className={`text-sm italic ${isDark ? "text-amber-200/80" : "text-amber-800"}`}>
                        "You opened this expecting something techy.{" "}
                        <span className={isDark ? "text-amber-300" : "text-amber-600"}>
                          Here are some doodles instead.
                        </span>"
                      </p>
                      <p className={`text-[10px] mt-1.5 ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                        — just kidding, these are the actual architecture schematics
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Tab bar ── */}
              <div className="px-6 sm:px-10 pb-2">
                <div
                  className={`flex gap-0.5 overflow-x-auto rounded-xl p-1 ${
                    isDark ? "bg-white/[0.03]" : "bg-gray-100"
                  }`}
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {TABS.map((t) => {
                    const active = tab === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`relative flex items-center gap-1 px-2 sm:px-2.5 py-2 rounded-lg text-[10px] sm:text-[11px] font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
                          active
                            ? isDark
                              ? "text-white"
                              : "text-slate-900"
                            : isDark
                              ? "text-slate-500 hover:text-slate-300"
                              : "text-gray-400 hover:text-gray-600"
                        }`}
                      >
                        {active && (
                          <motion.div
                            layoutId="schematics-tab"
                            className={`absolute inset-0 rounded-lg ${
                              isDark
                                ? "bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-white/[0.08]"
                                : "bg-white border border-gray-200 shadow-sm"
                            }`}
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                          />
                        )}
                        <span className="relative flex items-center gap-1.5">
                          <t.icon className="w-3 h-3" />
                          <span className="hidden sm:inline">{t.label}</span>
                          <span className="sm:hidden">
                            {t.label.split(" ")[0]}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Diagram content ── */}
              <div className="px-6 sm:px-10 py-6">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tab}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.25 }}
                  >
                    {tab === "swap" && <SwapPipelineDiagram isDark={isDark} />}
                    {tab === "router" && <SmartRouterDiagram isDark={isDark} />}
                    {tab === "security" && <SecurityDiagram isDark={isDark} />}
                    {tab === "oracle" && <OracleDiagram isDark={isDark} />}
                    {tab === "fees" && <FeesDiagram isDark={isDark} />}
                    {tab === "amm" && <AmmBlueprintDiagram isDark={isDark} />}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* ── Footer signature ── */}
              <div className="px-6 sm:px-10 pb-8">
                <div
                  className="pt-4 border-t border-dashed"
                  style={{
                    borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{
                        background: "linear-gradient(135deg, #f59e0b, #f97316)",
                      }}
                    >
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <p className={`text-xs font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                        WRAPpDEX
                      </p>
                      <p className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        Architecture & Protocol Direction
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
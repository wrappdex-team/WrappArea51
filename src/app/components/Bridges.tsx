import { useState } from "react";
import { Zap, Shield, Globe } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { SquidBridgeWidget } from "./SquidBridgeWidget";
import { HashPortBridgeWidget } from "./HashPortBridgeWidget";
import { StargateBridgeWidget } from "./StargateBridgeWidget";

// ── Official brand logos ──
import squidLogo from "figma:asset/29d60835fb1c27fec24f24737da2b23596433909.png";
import hashportLogo from "figma:asset/361e908e8e84e0eeb5da449426c15dc4ec627a57.png";

// Stargate — inline SVG (dark circle with nested diamond geometry)
const STARGATE_LOGO = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="60" fill="#1B1B2B"/><g fill="none" stroke="#fff" stroke-width="2.5"><polygon points="60,16 104,60 60,104 16,60" stroke-width="3"/><polygon points="60,30 90,60 60,90 30,60" stroke-width="2.5"/><circle cx="60" cy="60" r="11" fill="#fff" stroke="none"/></g></svg>`)}`;

type ActiveBridge = null | "squid" | "hashport" | "stargate";

interface BridgeOption {
  id: "squid" | "hashport" | "stargate";
  name: string;
  description: string;
  logo: string;
  fallbackLetter: string;
  gradient: string;
  accentColor: string;
  logoBg?: string;
  features: string[];
}

const bridgeOptions: BridgeOption[] = [
  {
    id: "squid",
    name: "Squid (Axelar)",
    description: "Cross-chain swaps across 60+ chains including Ethereum, Arbitrum, Polygon, Avalanche, Base and more.",
    logo: squidLogo,
    fallbackLetter: "S",
    gradient: "from-purple-500 to-indigo-500",
    accentColor: "purple",
    logoBg: "bg-[#CDFA50]",
    features: ["60+ Chains", "Low Fees", "Fast Transfers"],
  },
  {
    id: "hashport",
    name: "HashPort",
    description: "Official Hedera bridge. Move tokens between Hedera and Ethereum/EVM chains with audited security.",
    logo: hashportLogo,
    fallbackLetter: "H",
    gradient: "from-teal-500 to-cyan-500",
    accentColor: "teal",
    logoBg: "bg-white",
    features: ["Hedera Native", "EVM Compatible", "Audited"],
  },
  {
    id: "stargate",
    name: "Stargate (LayerZero)",
    description: "Omnichain bridge with instant finality and unified liquidity. Ethereum, Arbitrum, Optimism, Base, Polygon & more.",
    logo: STARGATE_LOGO,
    fallbackLetter: "S",
    gradient: "from-cyan-500 to-blue-500",
    accentColor: "cyan",
    features: ["Instant Finality", "Unified Liquidity", "Native Assets"],
  },
];

// Accent color resolver for dynamic styling
function getAccentClasses(accentColor: string) {
  switch (accentColor) {
    case "teal":
      return {
        activeDark: "from-teal-900/40 to-cyan-900/40 border-teal-400/60 shadow-[0_0_20px_rgba(20,184,166,0.15)]",
        activeLight: "from-teal-50 to-cyan-50 border-teal-400",
        badgeBg: "bg-teal-500/20 text-teal-300",
        borderActive: "border-teal-500/20 text-teal-400",
        borderActiveLight: "border-teal-200 text-teal-600",
      };
    case "cyan":
      return {
        activeDark: "from-cyan-900/40 to-blue-900/40 border-cyan-400/60 shadow-[0_0_20px_rgba(34,211,238,0.15)]",
        activeLight: "from-cyan-50 to-blue-50 border-cyan-400",
        badgeBg: "bg-cyan-500/20 text-cyan-300",
        borderActive: "border-cyan-500/20 text-cyan-400",
        borderActiveLight: "border-cyan-200 text-cyan-600",
      };
    default: // purple
      return {
        activeDark: "from-purple-900/40 to-indigo-900/40 border-purple-400/60 shadow-[0_0_20px_rgba(168,85,247,0.15)]",
        activeLight: "from-purple-50 to-indigo-50 border-purple-400",
        badgeBg: "bg-purple-500/20 text-purple-300",
        borderActive: "border-purple-500/20 text-purple-400",
        borderActiveLight: "border-purple-200 text-purple-600",
      };
  }
}

export function Bridges() {
  const { isDark } = useTheme();
  const [activeBridge, setActiveBridge] = useState<ActiveBridge>(null);

  const handleBridgeToggle = (id: "squid" | "hashport" | "stargate") => {
    setActiveBridge((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="text-center">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent mb-2">
          Cross-Chain Bridges
        </h2>
        <p className={`max-w-xl mx-auto ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          Bridge assets seamlessly between Hedera and 60+ blockchains
        </p>
      </div>

      {/* ── Bridge Selector Cards (3-column grid) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
        {bridgeOptions.map((bridge) => {
          const isActive = activeBridge === bridge.id;
          const accent = getAccentClasses(bridge.accentColor);

          return (
            <button
              key={bridge.id}
              onClick={() => handleBridgeToggle(bridge.id)}
              className={`group relative overflow-hidden rounded-2xl p-5 text-left transition-all duration-300 ${
                isActive
                  ? isDark
                    ? `bg-gradient-to-br ${accent.activeDark} border`
                    : `bg-gradient-to-br ${accent.activeLight} border shadow-lg`
                  : isDark
                  ? "bg-slate-900/40 border border-white/[0.06] hover:border-white/[0.15] hover:bg-slate-900/60"
                  : "bg-white/60 border border-gray-200 hover:border-gray-300 hover:shadow-md"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="relative w-11 h-11 flex-shrink-0">
                  <img
                    src={bridge.logo}
                    alt={bridge.name}
                    className={`w-11 h-11 rounded-xl object-contain ${bridge.logoBg ? `${bridge.logoBg} p-1` : ""}`}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove("hidden");
                    }}
                  />
                  <div className={`w-11 h-11 bg-gradient-to-br ${bridge.gradient} rounded-xl flex items-center justify-center text-lg font-bold text-white hidden`}>
                    {bridge.fallbackLetter}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-bold truncate text-sm">{bridge.name}</h4>
                    {isActive && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${accent.badgeBg}`}>
                        Active
                      </span>
                    )}
                  </div>
                  <p className={`text-xs mb-2.5 line-clamp-3 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {bridge.description}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {bridge.features.map((f) => (
                      <span
                        key={f}
                        className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                          isDark
                            ? "bg-white/[0.05] text-slate-400"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom action hint */}
              <div className={`mt-4 pt-3 text-center text-xs font-bold ${
                isDark
                  ? `border-t ${isActive ? accent.borderActive : "border-white/[0.04] text-slate-500 group-hover:text-slate-300"}`
                  : `border-t ${isActive ? accent.borderActiveLight : "border-gray-100 text-gray-400 group-hover:text-gray-600"}`
              }`}>
                {isActive ? "Click to Close" : "Click to Open Bridge"}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Active Bridge Widget (centered) ── */}
      {activeBridge && (
        <div className="flex justify-center">
          <div className="w-full max-w-[480px]">
            {activeBridge === "squid" && (
              <SquidBridgeWidget
                onClose={() => setActiveBridge(null)}
                isDark={isDark}
              />
            )}
            {activeBridge === "hashport" && (
              <HashPortBridgeWidget
                onClose={() => setActiveBridge(null)}
                isDark={isDark}
              />
            )}
            {activeBridge === "stargate" && (
              <StargateBridgeWidget
                onClose={() => setActiveBridge(null)}
                isDark={isDark}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Info Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
        {[
          { icon: Zap, title: "Fast", desc: "Most transfers complete in under 2 minutes" },
          { icon: Shield, title: "Secure", desc: "Validated by decentralized relayer networks" },
          { icon: Globe, title: "Multi-Chain", desc: "Hedera, Ethereum, Arbitrum, Polygon & more" },
        ].map((item) => (
          <div
            key={item.title}
            className={`rounded-xl p-4 text-center ${
              isDark
                ? "bg-slate-900/30 border border-white/[0.06]"
                : "bg-white/60 border border-gray-200"
            }`}
          >
            <item.icon className={`w-5 h-5 mx-auto mb-2 ${isDark ? "text-purple-400" : "text-purple-500"}`} />
            <div className="font-bold text-sm mb-1">{item.title}</div>
            <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{item.desc}</p>
          </div>
        ))}
      </div>

      {/* ── Safety Note ── */}
      <div className="max-w-3xl mx-auto">
        <div className={`rounded-xl p-4 text-center text-sm ${
          isDark
            ? "bg-pink-900/10 border border-pink-500/15 text-pink-300/70"
            : "bg-pink-50 border border-pink-200 text-pink-600"
        }`}>
          Always verify bridge URLs and start with small test amounts. Bridge transfers are irreversible.
        </div>
      </div>
    </div>
  );
}
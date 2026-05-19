import { useState, useEffect, useCallback, useRef } from "react";
import {
  Crown,
  Sparkles,
  Volume2,
  Palette,
  Lock,
  X,
  ShieldCheck,
  Check,
} from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import {
  VIP_FEATURES,
  isVipEligible,
  getHbarhBalance,
  getVipNftCount,
  loadVipPrefs,
  saveVipPrefs,
  verifyVipEligibilityDirect,
  type VipPrefs,
  type VipFeatureId,
} from "../utils/vip";
import { GATE_THRESHOLD, formatTokenCount } from "../utils/dao";
import { playVipUnlock, playVipConfirm, playVipFeatureBass } from "../utils/sounds";
import { useEscapeKey } from "../hooks/useEscapeKey";

const FEATURE_ICONS: Record<VipFeatureId, React.ReactNode> = {
  vip_theme: <Palette className="w-5 h-5" />,
  vip_sounds: <Volume2 className="w-5 h-5" />,
  vip_glow: <Sparkles className="w-5 h-5" />,
};

interface VIPPanelProps {
  open: boolean;
  onClose: () => void;
  onPrefsChange: (prefs: VipPrefs) => void;
}

export function VIPPanel({ open, onClose, onPrefsChange }: VIPPanelProps) {
  // STRONG DEFENSIVE GUARD for the exact runtime error:
  // "Cannot read properties of undefined 'recentlyCreatedOwnerStacks'"
  // We force hederaAccount to always be an object, then use optional chaining + fallback.
  let { hederaAccount, hederaNetwork, hashPackSession } = useWallet() || ({} as any);
  hederaAccount = hederaAccount || ({} as any);

  // This line is the strong guard the user requested.
  // Optional chaining (?. ) + explicit fallback to empty array (|| [])
  const recentlyCreatedOwnerStacks: any[] =
    (hederaAccount as any)?.ownerData?.recentlyCreatedOwnerStacks ||
    (hederaAccount as any)?.stacks?.recentlyCreatedOwnerStacks ||
    (hederaAccount as any)?.recentlyCreatedOwnerStacks ||
    [];

  // ---- Escape key dismissal (WCAG 2.1 SC 2.1.2) ----
  useEscapeKey(onClose, !open);

  const [rawPrefs, setPrefs] = useState<VipPrefs>(loadVipPrefs);
  // Never let prefs be undefined — prevents crashes on missing features or other fields
  const prefs = rawPrefs || { active: false, features: { vip_theme: true, vip_sounds: true, vip_glow: true } };

  // ---- Double-check verification state ----
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifiedEligible, setVerifiedEligible] = useState(false);
  const [verifiedBalance, setVerifiedBalance] = useState<number | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // ---- Activation ceremony state ----
  const [justActivated, setJustActivated] = useState(false);
  const activationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tokens = hederaAccount?.tokens ?? [];
  const cachedEligible = isVipEligible(tokens, hederaNetwork);
  const balance = getHbarhBalance(tokens, hederaNetwork);
  const nftCount = getVipNftCount(tokens);
  const connected = !!hashPackSession?.accountId;
  const walletAccountId = hashPackSession?.accountId;

  // Safe fallbacks to prevent "Cannot read properties of undefined" crashes
  // (e.g. recentlyCreatedOwnerStacks or other owner stack data)
  const safePrefs = {
    active: prefs?.active ?? false,
    features: prefs?.features || { vip_theme: true, vip_sounds: true, vip_glow: true },
  };
  const safeHashPack = hashPackSession || ({} as any);

  const eligible = verified ? verifiedEligible : cachedEligible;

  // Use safe versions everywhere below
  const featurePrefs = safePrefs.features;

  // ---- Run direct Mirror Node double-check when panel opens ----
  useEffect(() => {
    if (!open || !connected || !hashPackSession?.accountId) return;

    let cancelled = false;

    const verify = async () => {
      setVerifying(true);
      setVerifyError(null);

      const result = await verifyVipEligibilityDirect(hashPackSession.accountId);

      if (cancelled) return;

      if (result.error) {
        setVerifyError(result.error);
        setVerified(false);
      } else {
        const directTokenEligible = result.balance >= GATE_THRESHOLD;
        const nftEligible = nftCount >= 1;
        const finalEligible = directTokenEligible || nftEligible;

        setVerifiedBalance(result.balance);
        setVerifiedEligible(finalEligible);
        setVerified(true);

        if (!finalEligible && safePrefs.active) {
          const next = { ...prefs, active: false };
          setPrefs(next);
          saveVipPrefs(next, walletAccountId);
        }
      }

      setVerifying(false);
    };

    verify();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected, hashPackSession?.accountId]);

  // Sync prefs to parent whenever they change
  useEffect(() => {
    onPrefsChange(prefs);
  }, [prefs, onPrefsChange]);

  // Clean up activation timer
  useEffect(() => {
    return () => {
      if (activationTimer.current) clearTimeout(activationTimer.current);
    };
  }, []);

  const toggleMaster = useCallback(async () => {
    // If turning ON, run a fresh verification first
    if (!safePrefs.active && hashPackSession?.accountId) {
      setVerifying(true);
      setVerifyError(null);

      const result = await verifyVipEligibilityDirect(hashPackSession.accountId);

      if (result.error) {
        setVerifyError(result.error);
        setVerifying(false);
        return;
      }

      const directTokenEligible = result.balance >= GATE_THRESHOLD;
      const nftEligible = nftCount >= 1;
      const finalEligible = directTokenEligible || nftEligible;

      setVerifiedBalance(result.balance);
      setVerifiedEligible(finalEligible);
      setVerified(true);
      setVerifying(false);

      if (!finalEligible) {
        return;
      }
    }

    setPrefs((prev) => {
      const next = { ...prev, active: !prev.active };
      saveVipPrefs(next, walletAccountId);
      if (next.active && eligible) {
        playVipUnlock();
        // Trigger activation ceremony
        setJustActivated(true);
        if (activationTimer.current) clearTimeout(activationTimer.current);
        activationTimer.current = setTimeout(() => setJustActivated(false), 1800);
      }
      return next;
    });
  }, [eligible, safePrefs.active, hashPackSession?.accountId, nftCount, walletAccountId]);

  const toggleFeature = useCallback((id: VipFeatureId) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        features: { ...prev.features, [id]: !prev.features[id] },
      };
      saveVipPrefs(next, walletAccountId);
      if (next.features[id]) playVipConfirm();
      return next;
    });
  }, [walletAccountId]);

  if (!open) return null;

  const displayBalance = verifiedBalance !== null ? verifiedBalance : balance;
  const isActive = safePrefs.active && eligible;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="VIP Features"
    >
      <div
        className={`relative max-w-md w-full overflow-hidden rounded-2xl transition-all duration-700 ${
          isActive
            ? "bg-[#0a1a14]/80 backdrop-blur-2xl border border-emerald-500/30 shadow-[0_0_40px_rgba(16,185,129,0.15),0_0_80px_rgba(16,185,129,0.05)]"
            : "bg-slate-900/95 backdrop-blur-xl border border-white/[0.08] shadow-2xl"
        } ${justActivated ? "vip-panel-activate" : ""}`}
      >
        {/* Iridescent glass overlay — only visible when active */}
        {isActive && (
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden"
            aria-hidden="true"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.07] via-teal-400/[0.04] to-cyan-500/[0.07]" />
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-emerald-400/[0.03] to-transparent vip-glass-shimmer" />
            {/* Top edge light refraction */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" />
            {/* Bottom edge subtle glow */}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-teal-400/20 to-transparent" />
          </div>
        )}

        {/* Activation burst overlay */}
        {justActivated && (
          <div className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden z-10" aria-hidden="true">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/20 via-teal-300/10 to-cyan-400/20 vip-burst-flash" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-emerald-400/20 vip-burst-ring" />
          </div>
        )}

        {/* Header */}
        <div className={`relative px-5 py-4 transition-all duration-700 ${
          isActive
            ? "bg-gradient-to-r from-emerald-600/15 via-teal-500/10 to-cyan-600/15"
            : "bg-gradient-to-r from-slate-800/50 via-slate-800/30 to-slate-800/50"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`relative transition-all duration-500 ${isActive ? "drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" : ""}`}>
                <Crown className={`w-5 h-5 transition-colors duration-500 ${isActive ? "text-emerald-400" : "text-slate-500"}`} />
                {isActive && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </div>
              <span className={`font-semibold transition-colors duration-500 ${isActive ? "text-emerald-50" : "text-white"}`}>
                VIP Features
              </span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close VIP panel"
              className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className={`text-xs mt-1.5 transition-colors duration-500 ${isActive ? "text-emerald-400/60" : "text-slate-500"}`}>
            Hold {formatTokenCount(GATE_THRESHOLD)} WRAPpDEX or 1 VIP NFT to unlock
          </p>
        </div>

        <div className="relative p-5 space-y-3">
          {/* Eligibility status */}
          {!connected ? (
            <div className="flex items-center gap-3 p-3.5 bg-slate-800/40 rounded-xl border border-white/5">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-800 text-slate-500">
                <Lock className="w-4.5 h-4.5" />
              </div>
              <div className="text-sm text-slate-400">Wallet not connected</div>
            </div>
          ) : verifyError ? (
            <div className="flex items-center gap-3 p-3.5 bg-red-500/5 rounded-xl border border-red-500/15">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-red-500/10 text-red-400">
                <ShieldCheck className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-red-300">Verification failed</div>
                <div className="text-xs text-slate-500 mt-0.5">{verifyError}</div>
              </div>
            </div>
          ) : !eligible ? (
            <div className="flex items-center gap-3 p-3.5 bg-amber-500/5 rounded-xl border border-amber-500/15">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-amber-500/10 text-amber-400">
                <Lock className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-amber-300">Not eligible</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {formatTokenCount(displayBalance)} WRAPpDEX &middot; Need {formatTokenCount(GATE_THRESHOLD)}
                </div>
              </div>
            </div>
          ) : (
            <div className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-700 ${
              isActive
                ? "bg-emerald-500/[0.08] border-emerald-500/20"
                : "bg-emerald-500/5 border-emerald-500/15"
            }`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-500 ${
                isActive
                  ? "bg-emerald-500/20 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                  : "bg-emerald-500/10 text-emerald-400"
              }`}>
                {isActive ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <ShieldCheck className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium transition-colors duration-500 ${
                  isActive ? "text-emerald-300" : "text-emerald-400/80"
                }`}>
                  {isActive ? "VIP Active" : "VIP Eligible"}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {formatTokenCount(displayBalance)} WRAPpDEX{nftCount > 0 ? ` + ${nftCount} NFT${nftCount !== 1 ? "s" : ""}` : ""} verified
                </div>
              </div>
              {/* Master toggle */}
              <button
                onClick={toggleMaster}
                disabled={verifying}
                aria-label={isActive ? "Deactivate VIP" : "Activate VIP"}
                className={`relative w-12 h-7 rounded-full transition-all duration-500 shrink-0 ${
                  isActive
                    ? "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                    : "bg-slate-700 hover:bg-slate-600"
                } ${verifying ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
              >
                <div
                  className={`absolute top-1 w-5 h-5 rounded-full transition-all duration-500 ${
                    isActive
                      ? "left-[26px] bg-white shadow-[0_0_6px_rgba(255,255,255,0.3)]"
                      : "left-1 bg-slate-400"
                  }`}
                />
              </button>
            </div>
          )}

          {/* Feature list */}
          <div className="space-y-1.5">
            {VIP_FEATURES.map((feat, idx) => {
              const isOn = safePrefs.active && featurePrefs[feat.id];
              const locked = !eligible || !isActive;

              return (
                <div
                  key={feat.id}
                  onMouseEnter={() => {
                    if (isOn && featurePrefs.vip_sounds) playVipFeatureBass(idx);
                  }}
                  className={`group flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all duration-500 ${
                    isOn
                      ? "bg-emerald-500/[0.06] border-emerald-500/15 hover:bg-emerald-500/[0.1] hover:border-emerald-500/25"
                      : "bg-slate-800/20 border-white/[0.04] hover:bg-slate-800/40"
                  } ${locked ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-500 ${
                      isOn
                        ? "bg-emerald-500/15 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.15)] group-hover:shadow-[0_0_12px_rgba(16,185,129,0.25)]"
                        : "bg-slate-800/60 text-slate-500"
                    }`}
                  >
                    {FEATURE_ICONS[feat.id]}
                  </div>
                  <span
                    className={`flex-1 text-sm font-medium transition-colors duration-500 ${
                      isOn ? "text-emerald-100" : "text-slate-400"
                    }`}
                  >
                    {feat.name}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (!locked) toggleFeature(feat.id); }}
                    disabled={locked}
                    aria-label={`${feat.name}: ${isOn ? "on" : "off"}`}
                    className={`relative w-9 h-5 rounded-full transition-all duration-500 shrink-0 ${
                      isOn
                        ? "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-[0_0_8px_rgba(16,185,129,0.25)]"
                        : "bg-slate-700"
                    } ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-500 ${
                        isOn ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Activation ceremony keyframes */}
      <style>{`
        @keyframes vipPanelActivate {
          0% { transform: scale(1); }
          15% { transform: scale(1.02); }
          30% { transform: scale(0.99); }
          50% { transform: scale(1.005); }
          100% { transform: scale(1); }
        }
        .vip-panel-activate {
          animation: vipPanelActivate 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        @keyframes vipBurstFlash {
          0% { opacity: 0; }
          20% { opacity: 1; }
          100% { opacity: 0; }
        }
        .vip-burst-flash {
          animation: vipBurstFlash 1.2s ease-out forwards;
        }

        @keyframes vipBurstRing {
          0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0.8; }
          100% { transform: translate(-50%, -50%) scale(4); opacity: 0; }
        }
        .vip-burst-ring {
          animation: vipBurstRing 1.4s ease-out forwards;
        }

        @keyframes vipGlassShimmer {
          0% { transform: translateX(-100%) rotate(12deg); }
          100% { transform: translateX(200%) rotate(12deg); }
        }
        .vip-glass-shimmer {
          animation: vipGlassShimmer 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
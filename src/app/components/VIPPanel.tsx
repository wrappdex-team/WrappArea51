import { useState, useEffect, useCallback } from "react";
import {
  Crown,
  Sparkles,
  Volume2,
  Palette,
  Lock,
  X,
  ShieldCheck,
  Loader2,
  RefreshCw,
  AlertTriangle,
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
import { GATE_THRESHOLD, VIP_NFT_TOKEN_ID, formatTokenCount } from "../utils/dao";
import { playVipUnlock, playVipConfirm } from "../utils/sounds";

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
  const { hederaAccount, hederaNetwork, hashPackSession } = useWallet();

  const [prefs, setPrefs] = useState<VipPrefs>(loadVipPrefs);

  // ── Double-check verification state ──
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifiedEligible, setVerifiedEligible] = useState(false);
  const [verifiedBalance, setVerifiedBalance] = useState<number | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const tokens = hederaAccount?.tokens ?? [];
  const cachedEligible = isVipEligible(tokens, hederaNetwork);
  const balance = getHbarhBalance(tokens, hederaNetwork);
  const nftCount = getVipNftCount(tokens);
  const connected = !!hashPackSession?.accountId;

  // The user is only truly eligible if BOTH the cached check AND the
  // direct verification agree (or verification hasn't run yet but cached says yes).
  // Once verified, use the verified result as the source of truth.
  const eligible = verified ? verifiedEligible : cachedEligible;

  // ── Run direct Mirror Node double-check when panel opens ──
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
        // Combine direct token check with cached NFT count
        const directTokenEligible = result.balance >= GATE_THRESHOLD;
        const nftEligible = nftCount >= 1;
        const finalEligible = directTokenEligible || nftEligible;

        setVerifiedBalance(result.balance);
        setVerifiedEligible(finalEligible);
        setVerified(true);

        // If verification shows NOT eligible but prefs are active, deactivate
        if (!finalEligible && prefs.active) {
          const next = { ...prefs, active: false };
          setPrefs(next);
          saveVipPrefs(next);
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

  // ── Manual re-verify ──
  const handleReVerify = useCallback(async () => {
    if (!hashPackSession?.accountId) return;

    setVerifying(true);
    setVerifyError(null);
    setVerified(false);

    const result = await verifyVipEligibilityDirect(hashPackSession.accountId);

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

      if (!finalEligible && prefs.active) {
        const next = { ...prefs, active: false };
        setPrefs(next);
        saveVipPrefs(next);
      }
    }

    setVerifying(false);
  }, [hashPackSession?.accountId, nftCount, prefs]);

  // Sync prefs to parent whenever they change
  useEffect(() => {
    onPrefsChange(prefs);
  }, [prefs, onPrefsChange]);

  const toggleMaster = useCallback(async () => {
    // If turning ON, run a fresh verification first
    if (!prefs.active && hashPackSession?.accountId) {
      setVerifying(true);
      setVerifyError(null);

      const result = await verifyVipEligibilityDirect(hashPackSession.accountId);

      if (result.error) {
        setVerifyError(result.error);
        setVerifying(false);
        return; // Don't activate if verification fails
      }

      const directTokenEligible = result.balance >= GATE_THRESHOLD;
      const nftEligible = nftCount >= 1;
      const finalEligible = directTokenEligible || nftEligible;

      setVerifiedBalance(result.balance);
      setVerifiedEligible(finalEligible);
      setVerified(true);
      setVerifying(false);

      if (!finalEligible) {
        // Balance dropped below threshold — don't activate
        return;
      }
    }

    setPrefs((prev) => {
      const next = { ...prev, active: !prev.active };
      saveVipPrefs(next);
      if (next.active && eligible) {
        playVipUnlock();
      }
      return next;
    });
  }, [eligible, prefs.active, hashPackSession?.accountId, nftCount]);

  const toggleFeature = useCallback((id: VipFeatureId) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        features: { ...prev.features, [id]: !prev.features[id] },
      };
      saveVipPrefs(next);
      if (next.features[id]) playVipConfirm();
      return next;
    });
  }, []);

  if (!open) return null;

  // Display balance: prefer verified balance, fall back to cached
  const displayBalance = verifiedBalance !== null ? verifiedBalance : balance;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-900 border border-emerald-500/20 rounded-xl max-w-md w-full overflow-hidden">
        {/* Header with iridescent gradient */}
        <div className="relative px-5 py-4 bg-gradient-to-r from-emerald-600/20 via-teal-600/20 to-cyan-600/20 border-b border-emerald-500/15">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-emerald-400" />
              <span className="text-white">VIP Features</span>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Hold {formatTokenCount(GATE_THRESHOLD)} HBAR.ħ or 1 VIP NFT to unlock
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* Eligibility status */}
          {!connected ? (
            <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg border border-white/5">
              <Lock className="w-5 h-5 text-slate-500" />
              <div>
                <div className="text-sm text-slate-300">Wallet not connected</div>
                <div className="text-xs text-slate-500">
                  Connect HashPack to check VIP eligibility
                </div>
              </div>
            </div>
          ) : !eligible ? (
            <div className="flex items-center gap-3 p-3 bg-amber-500/5 rounded-lg border border-amber-500/15">
              <Lock className="w-5 h-5 text-amber-400" />
              <div>
                <div className="text-sm text-amber-300">Not eligible</div>
                <div className="text-xs text-slate-400">
                  You hold {formatTokenCount(displayBalance)} HBAR.ħ and {nftCount} VIP NFT{nftCount !== 1 ? "s" : ""}.
                  Need {formatTokenCount(GATE_THRESHOLD)} tokens or 1 NFT.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 bg-emerald-500/5 rounded-lg border border-emerald-500/15">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <div className="flex-1">
                <div className="text-sm text-emerald-300">VIP Eligible</div>
                <div className="text-xs text-slate-400">
                  {formatTokenCount(displayBalance)} HBAR.ħ{nftCount > 0 ? ` + ${nftCount} VIP NFT${nftCount !== 1 ? "s" : ""}` : ""} verified
                </div>
              </div>
              {/* Master toggle */}
              <button
                onClick={toggleMaster}
                disabled={verifying}
                className={`relative w-11 h-6 rounded-full transition-all duration-300 ${
                  prefs.active
                    ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                    : "bg-slate-700"
                } ${verifying ? "opacity-50 cursor-wait" : ""}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-300 ${
                    prefs.active ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          )}

          {/* Verification status */}
          {connected && (
            <div className="flex items-center gap-2 px-1">
              {verifying ? (
                <div className="flex items-center gap-2 text-xs text-blue-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Verifying balance on-chain...
                </div>
              ) : verified ? (
                <div className="flex items-center gap-2 text-xs text-emerald-400/70">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Balance double-checked: {formatTokenCount(verifiedBalance ?? 0)} tokens
                  {verifiedEligible ? " — eligible" : " — below threshold"}
                </div>
              ) : verifyError ? (
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Verification failed: {verifyError}
                </div>
              ) : null}
              {connected && !verifying && (
                <button
                  onClick={handleReVerify}
                  className="ml-auto p-1 rounded hover:bg-white/5 transition-colors text-slate-500 hover:text-slate-300"
                  title="Re-verify balance from Mirror Node"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Feature list */}
          <div className="space-y-2">
            {VIP_FEATURES.map((feat) => {
              const isOn = prefs.active && prefs.features[feat.id];
              const locked = !eligible || !prefs.active;

              return (
                <div
                  key={feat.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-300 ${
                    isOn
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : "bg-slate-800/30 border-white/5"
                  } ${locked ? "opacity-50" : ""}`}
                >
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                      isOn
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {FEATURE_ICONS[feat.id]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm ${
                        isOn ? "text-white" : "text-slate-300"
                      }`}
                    >
                      {feat.name}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {feat.description}
                    </div>
                  </div>
                  <button
                    onClick={() => !locked && toggleFeature(feat.id)}
                    disabled={locked}
                    className={`relative w-9 h-5 rounded-full transition-all duration-300 shrink-0 ${
                      isOn
                        ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                        : "bg-slate-700"
                    } ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-300 ${
                        isOn ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Token info footer */}
          <div className="text-xs text-slate-500 pt-2 border-t border-white/5">
            HBAR.ħ Token: <span className="font-mono text-slate-400">0.0.9356476</span>
            {" | "}
            VIP NFT: <span className="font-mono text-slate-400">{VIP_NFT_TOKEN_ID}</span>
            {" | "}
            Gate: {formatTokenCount(GATE_THRESHOLD)} tokens or 1 NFT
          </div>
        </div>
      </div>
    </div>
  );
}

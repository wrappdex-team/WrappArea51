import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  X,
  ExternalLink,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Shield,
} from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import { playConnectionSuccess } from "../utils/sounds";
import { isMetaMaskInstalled, formatAddress } from "../utils/metamask";
import type { HashPackSession } from "../utils/hashpack";
import {
  clearWCStorage,
  forceResetHashConnect,
} from "../utils/hashpack";
import {
  HASHPACK_LOGO,
  METAMASK_LOGO,
  DYNAMIC_LOGO,
} from "../assets/brand";
import { isDynamicSDKAvailable } from "./DynamicSDKWrapper";
import { usePartneredLogos } from "../contexts/PartneredLogosContext";
import { useDynamicContext, useIsLoggedIn, useDynamicModals } from "@dynamic-labs/sdk-react-core";

/**
 * Dynamic SDK hook results forwarded from DynamicHooksBridge.
 * Defaults are safe no-ops for when the SDK is unavailable.
 */
interface DynamicHooksResult {
  setShowAuthFlow: (show: boolean) => void;
  isLoggedIn: boolean;
  setShowLinkNewWalletModal: (show: boolean) => void;
  available: boolean;
}

const DYNAMIC_HOOKS_DEFAULTS: DynamicHooksResult = {
  setShowAuthFlow: () => {},
  isLoggedIn: false,
  setShowLinkNewWalletModal: () => {},
  available: false,
};

/**
 * Bridge component rendered ONLY when the Dynamic SDK has initialized.
 * Hooks are called unconditionally inside this component (Rules of Hooks
 * compliant). Results are forwarded to the parent via a stable callback ref.
 */
function DynamicHooksBridge({ onUpdateRef }: { onUpdateRef: React.RefObject<(h: DynamicHooksResult) => void> }) {
  const { setShowAuthFlow } = useDynamicContext();
  const isLoggedIn = useIsLoggedIn();
  const { setShowLinkNewWalletModal } = useDynamicModals();

  useEffect(() => {
    onUpdateRef.current?.({ setShowAuthFlow, isLoggedIn, setShowLinkNewWalletModal, available: true });
  }, [setShowAuthFlow, isLoggedIn, setShowLinkNewWalletModal, onUpdateRef]);

  return null;
}

// ── Types ──────────────────────────────────────────────────────────────

interface WalletConnectModalProps {
  onClose: () => void;
}

type WalletId = "hashpack" | "metamask" | "dynamic";

type ConnectionStep =
  | "list"
  | "wc-connecting"
  | "wc-success"
  | "metamask-connect"
  | "metamask-success"
  | "dynamic-connect";

interface WalletOption {
  id: WalletId;
  name: string;
  logo: string;
  badge: string;
  badgeColor: string;
  description: string;
  isWC: boolean;
}

const WALLET_OPTIONS: WalletOption[] = [
  {
    id: "hashpack",
    name: "HashPack",
    logo: HASHPACK_LOGO,
    badge: "Hedera",
    badgeColor: "purple",
    description: "Extension or mobile",
    isWC: true,
  },
  {
    id: "metamask",
    name: "MetaMask",
    logo: METAMASK_LOGO,
    badge: "EVM",
    badgeColor: "orange",
    description: "Browser extension",
    isWC: false,
  },
  {
    id: "dynamic",
    name: "Dynamic",
    logo: DYNAMIC_LOGO,
    badge: "Multi-chain",
    badgeColor: "blue",
    description: "Email, social, or 300+ wallets",
    isWC: false,
  },
];

// ── Shared Components ──────────────────────────────────────────────────

function ModalShell({ children, maxW = "max-w-md" }: { children: ReactNode; maxW?: string }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Connect wallet"
    >
      <div className={`${maxW} w-full rounded-2xl bg-[#0c0c14] border border-white/[0.06] shadow-2xl shadow-black/50 overflow-hidden`}>
        {children}
      </div>
    </div>
  );
}

function Badge({ children, color = "emerald" }: { children: ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${colors[color] || colors.emerald}`}>
      {children}
    </span>
  );
}

function SuccessScreen({ label, accountId, onClose }: { label: string; accountId?: string; onClose: () => void }) {
  const autoCloseRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    autoCloseRef.current = setTimeout(onClose, 2800);
    return () => clearTimeout(autoCloseRef.current);
  }, [onClose]);

  return (
    <button onClick={onClose} className="w-full text-center py-16 px-6 cursor-pointer focus:outline-none group">
      <div className="relative w-20 h-20 mx-auto mb-8">
        <motion.div
          className="absolute inset-0 rounded-full bg-emerald-500/10"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: [0.8, 1.4, 1.2], opacity: [0, 0.4, 0] }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
        <motion.div
          className="absolute inset-0 rounded-full border border-emerald-500/30"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        />
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <CheckCircle2 className="w-9 h-9 text-emerald-400" />
        </motion.div>
      </div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.5 }}>
        <p className="text-[22px] tracking-tight text-white/90">{label}</p>
      </motion.div>
      {accountId && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.5 }}>
          <p className="mt-2.5 font-mono text-xs text-white/20 tracking-wide">{accountId}</p>
        </motion.div>
      )}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2, duration: 0.8 }}>
        <p className="mt-10 text-[10px] text-white/10 group-hover:text-white/20 transition-colors">tap to continue</p>
      </motion.div>
    </button>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────

export function WalletConnectModal({ onClose }: WalletConnectModalProps) {
  const {
    connectHashPack,
    isConnectingHedera,
    hederaConnectionError,
    hashPackSession,
    hashConnectSDKReady,
    connectMetaMask,
    isConnectingMetaMask,
    metaMaskError,
    metaMaskAccount,
  } = useWallet();

  const partnerLogos = usePartneredLogos();

  // Dynamic Labs — programmatic auth flow trigger.
  // DynamicHooksBridge is a child component that only mounts when the SDK is
  // available, keeping all hook calls unconditional (Rules of Hooks compliant).
  const [dynamicHooks, setDynamicHooks] = useState<DynamicHooksResult>(DYNAMIC_HOOKS_DEFAULTS);
  const dynamicUpdateRef = useRef((h: DynamicHooksResult) => setDynamicHooks(h));
  dynamicUpdateRef.current = (h: DynamicHooksResult) => setDynamicHooks(h);

  const { setShowAuthFlow, isLoggedIn: isLoggedInDynamic, setShowLinkNewWalletModal } = dynamicHooks;

  const [step, setStep] = useState<ConnectionStep>("list");
  const [selectedWallet, setSelectedWallet] = useState<WalletOption | null>(null);
  const [localSession, setLocalSession] = useState<HashPackSession | null>(null);
  const [wcError, setWcError] = useState<string | null>(null);

  // Connection state
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<string>("Initializing...");

  // Guard: prevent a stale MetaMask connection from advancing the UI
  // after the user clicked Back. Incremented on each connect attempt,
  // checked after the async call returns.
  const mmConnectIdRef = useRef(0);

  // ── Dynamic Connect ──────────────────────────────────────────────
  //
  // Opens the Dynamic Labs auth modal (email, social, 300+ wallets).
  // Our modal closes and hands off to Dynamic's UI (themed via
  // dynamic-theme.css). The DynamicWalletBridge syncs the resulting
  // wallet back into WalletContext automatically.
  //
  // When the user is already logged in via Dynamic, we show the
  // "link new wallet" modal instead of the auth flow to avoid the
  // SDK deprecation warning.

  const handleDynamicConnect = useCallback(() => {
    // Close our wallet modal — Dynamic opens its own themed overlay
    onClose();
    if (isLoggedInDynamic) {
      // Already authenticated → show the "link additional wallet" modal
      setShowLinkNewWalletModal(true);
    } else {
      // Not authenticated → show the full auth/connect flow
      setShowAuthFlow(true);
    }
  }, [onClose, isLoggedInDynamic, setShowAuthFlow, setShowLinkNewWalletModal]);

  // ── WalletConnect Connect ────────────────────────────────────
  //
  // Flow:
  //   1. User clicks "HashPack" (or Hedera Wallet) → we show spinner
  //   2. connectHashPack() inits SignClient → proposes session → gets URI
  //   3. The official WalletConnect modal opens on top with QR + wallet list
  //   4. User picks their wallet (HashPack, Blade, etc.) and approves
  //   5. Session established → we show success screen
  //   6. If user closes WC modal → treated as cancellation

  const handleWCConnect = useCallback(async (wallet: WalletOption) => {
    setSelectedWallet(wallet);
    setStep("wc-connecting");
    setWcError(null);
    setLocalSession(null);
    setPairingUri(null);
    setConnectionState("Initializing WalletConnect...");

    // connectHashPack opens the WC modal automatically.
    // Our modal stays on "wc-connecting" to show status behind the WC modal.
    const resultPromise = connectHashPack(
      "mainnet",
      // onPairingString: still receives the URI for reference
      (uri: string) => {
        setPairingUri(uri);
        // Do NOT switch to wc-qr — the WC modal handles QR display
      },
      // onConnectionState: fires with status updates
      (state: string) => {
        setConnectionState(state);
      },
    );

    const result = await resultPromise;

    if (result.success && result.session) {
      setLocalSession(result.session);
      setStep("wc-success");
      playConnectionSuccess();
    } else if (result.error) {
      // "Connection was cancelled" means user closed the WC modal — go back to list
      if (result.error.includes("cancelled") || result.error.includes("aborted")) {
        setStep("list");
      } else {
        setWcError(result.error);
        // Stay on wc-connecting to show error
      }
    } else {
      setStep("list");
    }
  }, [connectHashPack]);

  // ── MetaMask Connect ─────────────────────────────────────────────

  const handleMetaMaskConnect = async () => {
    const connectId = ++mmConnectIdRef.current;
    setSelectedWallet(WALLET_OPTIONS.find((w) => w.id === "metamask") || null);
    setStep("metamask-connect");
    const success = await connectMetaMask();
    // Only advance UI if this is still the active connection attempt
    if (connectId !== mmConnectIdRef.current) return;
    if (success) {
      setStep("metamask-success");
      playConnectionSuccess();
    }
    // If !success and no metaMaskError, the user cancelled (Back button or
    // abort). connectMetaMask already reset isConnectingMetaMask to false.
  };

  // Cancel an in-flight MetaMask connection and return to the wallet list.
  // Bumps the connect ID so the stale async handler discards its result.
  const handleMetaMaskBack = () => {
    mmConnectIdRef.current++;
    setStep("list");
  };

  const handleClearAndRetry = async () => {
    clearWCStorage(false);
    try { localStorage.removeItem("hbarh-hashpack-session"); } catch { /* */ }
    await forceResetHashConnect();
    setWcError(null);
    setPairingUri(null);
    if (selectedWallet?.isWC) {
      handleWCConnect(selectedWallet);
    }
  };

  // Stable bridge element — rendered in every return branch to keep Dynamic
  // hooks mounted consistently (React reconciles by position in the tree).
  const dynamicBridge = isDynamicSDKAvailable
    ? <DynamicHooksBridge onUpdateRef={dynamicUpdateRef} />
    : null;

  // ═══════════════════════════════════════════════════════════
  // METAMASK CONNECTING
  // ═════════════════════════════════════════════════════════════
  if (step === "metamask-connect") {
    return (
      <> {dynamicBridge}
      <ModalShell>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <button onClick={handleMetaMaskBack} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
              <ArrowLeft className="w-4 h-4 text-white/50" />
            </button>
            <img src={partnerLogos.metamask} alt="MetaMask" className="w-7 h-7 rounded-lg" />
            <span className="text-white/90">MetaMask</span>
          </div>
          <div className="text-center py-10">
            {isConnectingMetaMask ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center mx-auto mb-5">
                  <Loader2 className="w-8 h-8 text-orange-400 animate-spin" />
                </div>
                <p className="text-white/90 mb-1">Connecting...</p>
                <p className="text-white/30 text-sm mb-4">Approve in your MetaMask extension</p>
                <button
                  onClick={handleMetaMaskBack}
                  className="px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 text-xs transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : metaMaskError ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-5">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <p className="text-white/90 mb-2">Connection Failed</p>
                <p className="text-white/30 text-sm mb-6">{metaMaskError}</p>
                {!isMetaMaskInstalled() && (
                  <a
                    href="https://metamask.io/download/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm mb-3 hover:bg-orange-400 transition-colors"
                  >
                    Install MetaMask <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  onClick={handleMetaMaskConnect}
                  className="block mx-auto px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm transition-colors"
                >
                  Try Again
                </button>
              </>
            ) : null}
          </div>
        </div>
      </ModalShell>
      </>
    );
  }

  // ════════════════════════════════════════════════════════════
  // METAMASK SUCCESS
  // ═════════════════════════════════════════════════════════════
  if (step === "metamask-success" && metaMaskAccount) {
    return (
      <>{dynamicBridge}
      <ModalShell>
        <SuccessScreen label="Connected" accountId={formatAddress(metaMaskAccount.address)} onClose={onClose} />
      </ModalShell>
      </>
    );
  }

  // ═════════════════════════════════════════════════════════════
  // WC CONNECTING (Initial spinner before QR is ready)
  // ═════════════════════════════════════════════════════════════
  if (step === "wc-connecting") {
    const hasError = wcError || (!isConnectingHedera && hederaConnectionError);
    const errorMsg = wcError || hederaConnectionError;

    return (
      <>{dynamicBridge}
      <ModalShell>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <button onClick={() => setStep("list")} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
              <ArrowLeft className="w-4 h-4 text-white/50" />
            </button>
            {selectedWallet && (
              <img src={selectedWallet.id === "hashpack" ? partnerLogos.hashpack : selectedWallet.logo} alt={selectedWallet.name} className="w-7 h-7 rounded-lg object-cover" />
            )}
            <span className="text-white/90">{selectedWallet?.name || "Connecting"}</span>
          </div>
          <div className="text-center py-10">
            {hasError ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-5">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <p className="text-white/90 mb-2">Connection Failed</p>
                <p className="text-white/30 text-sm mb-6 max-w-xs mx-auto">{errorMsg}</p>
                <div className="flex gap-2 justify-center flex-wrap">
                  <button
                    onClick={() => selectedWallet && handleWCConnect(selectedWallet)}
                    className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm transition-colors"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={handleClearAndRetry}
                    className="px-5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-sm flex items-center gap-2 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Reset
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-5">
                  <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                </div>
                <p className="text-white/90 mb-1">{connectionState}</p>
                <p className="text-white/30 text-sm">
                  Preparing secure connection...
                </p>
              </>
            )}
          </div>
        </div>
      </ModalShell>
      </>
    );
  }

  // ═════════════════════════════════════════════════════════════
  // WC SUCCESS
  // ═════════════════════════════════════════════════════════════
  const sessionForSuccess = localSession || hashPackSession;
  if (step === "wc-success" && sessionForSuccess) {
    return (
      <>{dynamicBridge}
      <ModalShell>
        <SuccessScreen label="Connected" accountId={sessionForSuccess.accountId} onClose={onClose} />
      </ModalShell>
      </>
    );
  }

  // ════════════════════════════════════════════════════════════
  // MAIN WALLET LIST
  // ═════════════════════════════════════════════════════════════
  return (
    <>{dynamicBridge}
    <ModalShell>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-white/90">Connect Wallet</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-4 h-4 text-white/30" />
          </button>
        </div>

        {/* Hedera Wallets Label */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[10px] text-white/20 tracking-widest uppercase">Hedera</span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>

        {/* HashPack (via WalletConnect v2 SignClient — QR in our UI) */}
        {WALLET_OPTIONS.filter((w) => w.isWC).map((wallet) => (
          <button
            key={wallet.id}
            onClick={() => handleWCConnect(wallet)}
            className="group w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 border border-white/[0.06] hover:border-purple-500/30 hover:bg-white/[0.02] text-left mb-2"
          >
            <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-white/[0.03]">
              <img src={wallet.id === "hashpack" ? partnerLogos.hashpack : wallet.logo} alt={wallet.name} className="w-11 h-11 object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm text-white/90">{wallet.name}</span>
                <Badge color={wallet.badgeColor}>{wallet.badge}</Badge>
              </div>
              <p className="text-xs text-white/30">{wallet.description}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center shrink-0 group-hover:bg-purple-500/10 transition-colors">
              <Shield className="w-4 h-4 text-white/15 group-hover:text-purple-400 transition-colors" />
            </div>
          </button>
        ))}

        {/* EVM Divider */}
        <div className="flex items-center gap-3 my-4">
          <span className="text-[10px] text-white/20 tracking-widest uppercase">EVM</span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>

        {/* MetaMask */}
        <button
          onClick={handleMetaMaskConnect}
          className="group w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 border border-white/[0.06] hover:border-orange-500/30 hover:bg-white/[0.02] text-left mb-2"
        >
          <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0">
            <img src={partnerLogos.metamask} alt="MetaMask" className="w-11 h-11 object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm text-white/90">MetaMask</span>
              <Badge color="orange">Ethereum</Badge>
            </div>
            <p className="text-xs text-white/30">Browser extension</p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center shrink-0 group-hover:bg-orange-500/10 transition-colors">
            <ExternalLink className="w-4 h-4 text-white/15 group-hover:text-orange-400 transition-colors" />
          </div>
        </button>

        {/* Multi-chain Divider */}
        <div className="flex items-center gap-3 my-4">
          <span className="text-[10px] text-white/20 tracking-widest uppercase">Multi-chain</span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>

        {/* Dynamic */}
        <button
          onClick={handleDynamicConnect}
          className="group w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 border border-white/[0.06] hover:border-blue-500/30 hover:bg-white/[0.02] text-left mb-2"
        >
          <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0">
            <img src={partnerLogos.dynamic} alt="Dynamic" className="w-11 h-11 object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm text-white/90">Dynamic</span>
              <Badge color="blue">Multi-chain</Badge>
            </div>
            <p className="text-xs text-white/30">Email, social, or 300+ wallets</p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center shrink-0 group-hover:bg-blue-500/10 transition-colors">
            <ExternalLink className="w-4 h-4 text-white/15 group-hover:text-blue-400 transition-colors" />
          </div>
        </button>

        {/* Security note */}
        <div className="mt-5 flex items-center gap-2 px-1">
          <Shield className="w-3.5 h-3.5 text-white/15 shrink-0" />
          <p className="text-[11px] text-white/20">
            All signing happens in your wallet. No private keys stored.
          </p>
        </div>
      </div>
    </ModalShell>
    </>
  );
}
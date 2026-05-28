import { useState, useEffect, useRef, useCallback, type ReactNode, lazy, Suspense } from "react";
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
import { isMetaMaskInstalled, formatAddress, isMobileBrowser, getMetaMaskDeepLink } from "../utils/metamask";
import type { HashPackSession } from "../utils/hashpack";
import {
  clearWCStorage,
  forceResetHashConnect,
} from "../utils/hashpack";
import {
  HASHPACK_LOGO,
  METAMASK_LOGO,
} from "../assets/brand";
import { usePartneredLogos } from "../contexts/PartneredLogosContext";
import { getSignClient, getWCModal } from "../utils/wallet-core";
import { useEscapeKey } from "../hooks/useEscapeKey";

// [PERFORMANCE-FIX] Lazy-load QRCodeSVG — only needed when showing QR, not on modal open
const QRCodeSVG = lazy(() => import("qrcode.react").then(m => ({ default: m.QRCodeSVG })));

// ── [WALLET-SURGERY Step 2] Pre-warm WC on modal mount ─────────────
// Fire getSignClient() the moment the modal opens, so by the time the user
// clicks "HashPack" the WC SDK is already initialized and relay is connected.
// ── [WALLET-SURGERY Step 3] Detect HashPack extension ──────────────
const HASHPACK_EXTENSION_ID = "gjagmgiddbbciopjhllkdnddhcglnemk";

/** Detect if HashPack browser extension is installed via chrome.runtime */
function detectHashPackExtension(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const chromeApi = (globalThis as any).chrome;
      if (!chromeApi?.runtime?.sendMessage) {
        resolve(false);
        return;
      }
      // Send a "ping" — if the extension responds (or doesn't throw), it's installed
      const timer = setTimeout(() => resolve(false), 800);
      chromeApi.runtime.sendMessage(
        HASHPACK_EXTENSION_ID,
        { type: "ping" },
        (response: any) => {
          clearTimeout(timer);
          // chrome.runtime.lastError is set if the extension doesn't exist
          const err = chromeApi.runtime.lastError;
          if (err) {
            // Extension NOT installed or not externally_connectable
            // But if the error is "Could not establish connection" that means
            // the extension IS installed but doesn't handle external messages.
            // Chrome reports different errors:
            // - "Could not establish connection" = extension exists but no handler
            // - "Cannot find extension" / similar = extension not installed
            const errMsg = (err.message || "").toLowerCase();
            resolve(errMsg.includes("could not establish connection") || errMsg.includes("receiving end"));
          } else {
            // Got a response — extension is definitely installed
            resolve(true);
          }
        }
      );
    } catch {
      resolve(false);
    }
  });
}

/** Send WC pairing URI directly to the HashPack extension */
function sendUriToHashPackExtension(uri: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const chromeApi = (globalThis as any).chrome;
      if (!chromeApi?.runtime?.sendMessage) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => resolve(false), 2000);
      chromeApi.runtime.sendMessage(
        HASHPACK_EXTENSION_ID,
        { type: "wc_uri", uri, action: "pair" },
        () => {
          clearTimeout(timer);
          const err = chromeApi.runtime.lastError;
          // Even if we get an error, the extension may still process the pairing
          // via the WC relay (the URI was generated and the relay delivers it)
          resolve(!err);
        }
      );
    } catch {
      resolve(false);
    }
  });
}

// ── Types ──────────────────────────────────────────────────────────────

interface WalletConnectModalProps {
  onClose: () => void;
}

type WalletId = "hashpack" | "metamask";

type ConnectionStep =
  | "list"
  | "wc-connecting"
  | "wc-success"
  | "metamask-connect"
  | "metamask-success";

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
    description: "Extension or mobile (Mainnet)",
    isWC: true,
  },
  {
    id: "hashpack-testnet",
    name: "HashPack (Testnet)",
    logo: HASHPACK_LOGO,
    badge: "Hedera Testnet",
    badgeColor: "blue",
    description: "For Prediction Markets on Testnet",
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
];

// ── Shared Components ──────────────────────────────────────────────────

// Shared Components
function ModalShell({ children, maxW = "max-w-md" }: { children: React.ReactNode; maxW?: string }) {
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

  // Escape key dismissal (WCAG 2.1 SC 2.1.2)
  useEscapeKey(onClose);

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

  // ── [WALLET-SURGERY Step 2] Pre-warm WC on modal mount ──────────────
  // Fire getSignClient() the moment the modal opens, so by the time the user
  // clicks "HashPack" the WC SDK is already initialized and relay is connected.
  // ── [WALLET-SURGERY Step 3] Detect HashPack extension ──────────────
  const [hashPackDetected, setHashPackDetected] = useState<boolean | null>(null);
  useEffect(() => {
    // Pre-warm WC SignClient in background (non-blocking)
    getSignClient().catch(() => { /* non-critical */ });
    // [CONNECT-PERF] Pre-warm WC Modal package so openWCModal is instant
    getWCModal().catch(() => { /* non-critical */ });
    // Detect HashPack extension
    if (!isMobileBrowser()) {
      detectHashPackExtension().then(setHashPackDetected);
    }
  }, []);

  // ── WalletConnect Connect ────────────────────────────────────
  //
  // [WALLET-SURGERY] Simplified flow — let the standard WC modal open.
  // The WC modal is the proven delivery mechanism for the pairing URI
  // to reach HashPack (extension or mobile). Pre-warming the SignClient
  // at page load (Step 1) already eliminates the 1-3s init wait.
  //
  // Flow:
  //   1. User clicks "HashPack" → we close our modal, connectHashPack runs
  //   2. WC modal opens instantly (SignClient pre-warmed) showing QR + wallets
  //   3. HashPack extension auto-detects OR user scans QR with HashPack mobile
  //   4. User approves → session established → success screen

  const handleWCConnect = useCallback(async (wallet: WalletOption) => {
    setSelectedWallet(wallet);
    setWcError(null);
    setLocalSession(null);
    setPairingUri(null);
    setConnectionState("Connecting...");

    // Close our modal — the WC modal will open on top and handle the flow.
    // This avoids z-index conflicts between our ModalShell and the WC modal.
    onClose();

    // Let the standard WC modal handle URI delivery to HashPack.
    // Use "testnet" for the dedicated Prediction Markets option so testnet accounts appear.
    const networkToUse: "mainnet" | "testnet" = wallet.id === "hashpack-testnet" ? "testnet" : "mainnet";
    const result = await connectHashPack(
      networkToUse,
      (uri: string) => {
        setPairingUri(uri);
      },
      (state: string) => {
        setConnectionState(state);
      },
      // No options — let the WC modal open normally
    );

    // WC modal is now closed (session approved, rejected, or timed out).
    // If success, the WalletContext already updated — nothing more to do.
    // If error, we can't re-open our modal easily, but WalletContext holds
    // the error state which the UI reads from hederaConnectionError.
    if (result.success && result.session) {
      playConnectionSuccess();
    }
    // Errors are surfaced via WalletContext.hederaConnectionError
  }, [connectHashPack, onClose]);

  // ── MetaMask Connect ────────────────────────────────────────────

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

  // ══════════════════════════════════════════════════════════
  // METAMASK CONNECTING
  // ═════════════════════════════════════════════════════════════
  if (step === "metamask-connect") {
    return (
      <> 
      <ModalShell>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <button onClick={handleMetaMaskBack} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50">
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
                <p className="text-white/30 text-sm mb-4">
                  {isMobileBrowser()
                    ? "Approve in MetaMask Mobile — you'll return here after"
                    : "Approve in your MetaMask extension"}
                </p>
                <button
                  onClick={handleMetaMaskBack}
                  className="px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
                >
                  Cancel
                </button>
              </>
            ) : metaMaskError ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-5">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                {metaMaskError === "MOBILE_NO_PROVIDER" || metaMaskError === "MOBILE_SDK_FALLBACK" ? (
                  /* ── Mobile: SDK failed or legacy fallback — offer deep-link ── */
                  /* IMPLEMENTATION NOTE: MOBILE_SDK_FALLBACK means the MetaMask SDK
                     tried to connect via socket channel but failed (SDK init error,
                     MetaMask app not installed, etc.). Show the deep-link option
                     as a fallback so the user can still connect via in-app browser. */
                  <>
                    <p className="text-white/90 mb-2">Connect via MetaMask</p>
                    <p className="text-white/30 text-sm mb-6 max-w-xs mx-auto">
                      {metaMaskError === "MOBILE_SDK_FALLBACK"
                        ? "Direct connection couldn't be established. You can open this dApp inside MetaMask's browser, or try again."
                        : "Tap below to open this dApp inside the MetaMask app, or install MetaMask Mobile if you haven't already."}
                    </p>
                    <a
                      href={getMetaMaskDeepLink()}
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-sm transition-colors mb-3"
                    >
                      <img src={partnerLogos.metamask} alt="MetaMask" className="w-5 h-5 rounded" />
                      Open in MetaMask
                    </a>
                    <button
                      onClick={handleMetaMaskConnect}
                      className="block mx-auto px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 text-xs transition-colors mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
                    >
                      Try SDK Again
                    </button>
                    <button
                      onClick={handleMetaMaskBack}
                      className="block mx-auto px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
                    >
                      Back
                    </button>
                  </>
                ) : (
                  /* ── Desktop: standard error with install / retry ── */
                  <>
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
                      className="block mx-auto px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
                    >
                      Try Again
                    </button>
                  </>
                )}
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
  // ════════════════════════════════════════════════════════════
  if (step === "metamask-success" && metaMaskAccount) {
    return (
      <>
      <ModalShell>
        <SuccessScreen label="Connected" accountId={formatAddress(metaMaskAccount.address)} onClose={onClose} />
      </ModalShell>
      </>
    );
  }

  // ═════════════════════════════════════════════════════════════
  // WC CONNECTING — [WALLET-SURGERY Step 6] Streamlined UI
  // ════════════════════════════════════════════════════════════
  if (step === "wc-connecting") {
    const hasError = wcError || (!isConnectingHedera && hederaConnectionError);
    const errorMsg = wcError || hederaConnectionError;
    const showQR = pairingUri && !hashPackDetected && !isMobileBrowser();

    return (
      <>
      <ModalShell>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setStep("list")} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50">
              <ArrowLeft className="w-4 h-4 text-white/50" />
            </button>
            {selectedWallet && (
              <img src={selectedWallet.id === "hashpack" ? partnerLogos.hashpack : selectedWallet.logo} alt={selectedWallet.name} className="w-7 h-7 rounded-lg object-cover" />
            )}
            <span className="text-white/90">{selectedWallet?.name || "Connecting"}</span>
          </div>

          {hasError ? (
            /* ── Error State ── */
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-5">
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
              <p className="text-white/90 mb-2">Connection Failed</p>
              <p className="text-white/30 text-sm mb-6 max-w-xs mx-auto">{errorMsg}</p>
              <div className="flex gap-2 justify-center flex-wrap">
                <button
                  onClick={() => selectedWallet && handleWCConnect(selectedWallet)}
                  className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
                >
                  Try Again
                </button>
                <button
                  onClick={handleClearAndRetry}
                  className="px-5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-sm flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reset
                </button>
              </div>
            </div>
          ) : showQR ? (
            /* ── QR Code for non-extension users ── */
            <div className="text-center py-4">
              <div className="bg-white rounded-2xl p-4 w-56 h-56 mx-auto mb-5 flex items-center justify-center">
                <Suspense fallback={<div className="w-56 h-56 bg-gray-200 animate-pulse" />}>
                  <QRCodeSVG
                    value={pairingUri}
                    size={208}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#0c0c14"
                  />
                </Suspense>
              </div>
              <p className="text-white/90 text-sm mb-1">Scan with HashPack</p>
              <p className="text-white/30 text-xs mb-4">
                Open HashPack on your phone and scan this QR code
              </p>
              <div className="flex items-center justify-center gap-3 mb-3">
                <a
                  href="https://www.hashpack.app/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 text-xs hover:text-purple-300 flex items-center gap-1 transition-colors"
                >
                  Get HashPack <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <button
                onClick={() => setStep("list")}
                className="px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
              >
                Cancel
              </button>
            </div>
          ) : (
            /* ── Extension detected or mobile — waiting for approval ── */
            <div className="text-center py-10">
              <motion.div
                className="w-20 h-20 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-6 relative overflow-hidden"
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                {selectedWallet && (
                  <img
                    src={selectedWallet.id === "hashpack" ? partnerLogos.hashpack : selectedWallet.logo}
                    alt=""
                    className="w-12 h-12 rounded-xl object-cover"
                  />
                )}
                {/* Pulsing ring to indicate waiting */}
                <motion.div
                  className="absolute inset-0 rounded-2xl border-2 border-purple-500/30"
                  animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
              </motion.div>
              <p className="text-white/90 text-base mb-1">{connectionState}</p>
              <p className="text-white/30 text-sm mb-6">
                {hashPackDetected
                  ? "Check your HashPack extension"
                  : isMobileBrowser()
                    ? "Approve the connection in HashPack"
                    : "Waiting for wallet response..."}
              </p>
              <button
                onClick={() => setStep("list")}
                className="px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
              >
                Cancel
              </button>
            </div>
          )}
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
      <>
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
    <>
    <ModalShell>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-white/90">Connect Wallet</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50">
            <X className="w-4 h-4 text-white/30" />
          </button>
        </div>

        {/* Hedera Wallets Label */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[10px] text-white/20 tracking-widest uppercase">Hedera</span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>

        {/* HashPack — with extension detection badge */}
        {WALLET_OPTIONS.filter((w) => w.isWC).map((wallet) => (
          <button
            key={wallet.id}
            onClick={() => handleWCConnect(wallet)}
            className="group w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 border border-white/[0.06] hover:border-purple-500/30 hover:bg-white/[0.02] text-left mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
          >
            <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-white/[0.03]">
              <img src={wallet.id === "hashpack" ? partnerLogos.hashpack : wallet.logo} alt={wallet.name} className="w-11 h-11 object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm text-white/90">{wallet.name}</span>
                <Badge color={wallet.badgeColor}>{wallet.badge}</Badge>
                {wallet.id === "hashpack" && hashPackDetected && (
                  <Badge color="emerald">Detected</Badge>
                )}
              </div>
              <p className="text-xs text-white/30">
                {wallet.id === "hashpack" && hashPackDetected
                  ? "Extension detected — 1-click connect"
                  : wallet.description}
              </p>
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
          className="group w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 border border-white/[0.06] hover:border-orange-500/30 hover:bg-white/[0.02] text-left mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
        >
          <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0">
            <img src={partnerLogos.metamask} alt="MetaMask" className="w-11 h-11 object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm text-white/90">MetaMask</span>
              <Badge color="orange">Ethereum</Badge>
            </div>
            <p className="text-xs text-white/30">{isMobileBrowser() ? "Mobile app (SDK)" : "Browser extension"}</p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center shrink-0 group-hover:bg-orange-500/10 transition-colors">
            <ExternalLink className="w-4 h-4 text-white/15 group-hover:text-orange-400 transition-colors" />
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
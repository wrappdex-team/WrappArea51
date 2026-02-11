import { useState, useEffect, useRef, type ReactNode } from "react";
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
  Wifi,
  WifiOff,
  Download,
  Copy,
  Check,
  MonitorSmartphone,
  ChevronDown,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useWallet } from "../contexts/WalletContext";
import { copyToClipboard as copyText } from "../utils/clipboard";
import { playConnectionSuccess } from "../utils/sounds";
import {
  isMetaMaskInstalled,
  formatAddress,
} from "../utils/metamask";
import type { HashPackSession } from "../utils/hashpack";
import {
  isHashPackExtensionInstalled,
  detectHashPackExtension,
  openHashPackExtension,
  getHashPackDownloadUrl,
  getHashPackDeepLink,
  getWalletConnectUniversalLink,
  injectPairingUri,
  forceResetHashConnect,
  clearWCStorage,
} from "../utils/hashpack";
import dynamicLogo from "figma:asset/31f4159e893e1bb0c3379868de210c68bae08c26.png";
import hashpackLogo from "figma:asset/88a04a0e847751906ce5a271fa9d750625ac069d.png";

// SVG data URI logo for MetaMask
const METAMASK_LOGO = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#F6851B"/><path d="M29.5 9l-7.8 5.8 1.4-3.4z" fill="#E2761B" stroke="#E2761B" stroke-width=".3"/><path d="M10.5 9l7.7 5.9-1.3-3.5zm13.3 16.6l-2.1 3.2 4.4 1.2 1.3-4.3zm-16.4.1l1.3 4.3 4.4-1.2-2.1-3.2z" fill="#E4761B" stroke="#E4761B" stroke-width=".3"/><path d="M13 18.5l-1.2 1.9 4.4.2-.2-4.7zm14 0l-3.1-2.7-.1 4.8 4.4-.2zm-13.9 8.1l2.6-1.3-2.3-1.8zm7.2-1.3l2.6 1.3-.3-3z" fill="#E4761B" stroke="#E4761B" stroke-width=".3"/><path d="M22.9 26.6l-2.6-1.3.2 1.7v.7zm-5.8 0l.3 2.4v-.7l.2-1.7z" fill="#D7C1B3" stroke="#D7C1B3" stroke-width=".3"/><path d="M17.3 22.5l-2.2-.6 1.5-.7zm5.4 0l.7-1.3 1.5.7z" fill="#233447" stroke="#233447" stroke-width=".3"/><path d="M17.1 26.6l.3-3.2-2.4.1zm5.5-3.2l.3 3.2 2.1-3.1zm2.6-5.3l-4.4.2.4 2.2.7-1.3 1.6.7zm-10.1 1.8l1.5-.7.7 1.3.4-2.2-4.4-.2z" fill="#CD6116" stroke="#CD6116" stroke-width=".3"/><path d="M11.8 19.9l1.9 3.7-.1-1.8zm8.5 1.9l-.1 1.8 1.9-3.7zm-4.1-1.7l-.4 2.2.5 2.6.1-3.4zm3.6 0l-.2 1.3.1 3.5.5-2.6z" fill="#E4751F" stroke="#E4751F" stroke-width=".3"/><path d="M22.7 22.5l-.5 2.6.3.2 2.3-1.8.1-1.8zm-7.6-.8l.1 1.8 2.2 1.8.4-.2-.5-2.6z" fill="#F6851B" stroke="#F6851B" stroke-width=".3"/><path d="M22.8 29l.1-.7-.2-.2h-5.4l-.2.2v.7l-4.4-2.1 1.5 1.3 3.1 2.2h5.5l3.1-2.2 1.5-1.3z" fill="#C0AD9E" stroke="#C0AD9E" stroke-width=".3"/><path d="M20.3 25.3l-.4-.2h-2.4l-.3.2-.2 1.7.2-.2h5.4l.2.2z" fill="#161616" stroke="#161616" stroke-width=".3"/><path d="M30 10l.7-3.5L29.5 9l-7.3 2.7 3.1 2.7 4.3 1.3 1.5-1.8-.7-.5 1-.9-.7-.6 1-.8zM9.3 6.5L10 10l-.7.8 1 .8-.7.6 1 .9-.7.5 1.5 1.8 4.3-1.3L18.5 9 11.2 6.3z" fill="#763D16" stroke="#763D16" stroke-width=".3"/></svg>`)}`;

interface WalletConnectModalProps {
  onClose: () => void;
}

type ConnectionStep =
  | "list"
  | "hashpack-connecting"
  | "hashpack-pairing"
  | "hashpack-success"
  | "metamask-connect"
  | "metamask-success";

// ── Shared backdrop + modal shell ──
function ModalShell({
  children,
  maxW = "max-w-md",
}: {
  children: ReactNode;
  maxW?: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-md p-4">
      <div
        className={`${maxW} w-full rounded-2xl bg-[#0c0c14] border border-white/[0.06] shadow-2xl shadow-black/50 overflow-hidden`}
      >
        {children}
      </div>
    </div>
  );
}

// ── Pill badge component ──
function Badge({
  children,
  color = "emerald",
}: {
  children: ReactNode;
  color?: "emerald" | "purple" | "orange" | "blue" | "red" | "amber" | "yellow";
}) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    yellow: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  };
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full border ${colors[color]}`}
    >
      {children}
    </span>
  );
}

// ── Ultra-minimal success screen ──
function SuccessScreen({
  label,
  accountId,
  onClose,
}: {
  label: string;
  accountId?: string;
  onClose: () => void;
}) {
  const autoCloseRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    autoCloseRef.current = setTimeout(onClose, 2800);
    return () => clearTimeout(autoCloseRef.current);
  }, [onClose]);

  return (
    <button
      onClick={onClose}
      className="w-full text-center py-16 px-6 cursor-pointer focus:outline-none group"
    >
      {/* Animated ring */}
      <div className="relative w-20 h-20 mx-auto mb-8">
        {/* Outer glow pulse */}
        <motion.div
          className="absolute inset-0 rounded-full bg-emerald-500/10"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: [0.8, 1.4, 1.2], opacity: [0, 0.4, 0] }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
        {/* Inner ring */}
        <motion.div
          className="absolute inset-0 rounded-full border border-emerald-500/30"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        />
        {/* Check icon */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <CheckCircle2 className="w-9 h-9 text-emerald-400" />
        </motion.div>
      </div>

      {/* "Connected" text */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.5 }}
      >
        <p className="text-[22px] tracking-tight text-white/90">{label}</p>
      </motion.div>

      {/* Account ID */}
      {accountId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55, duration: 0.5 }}
        >
          <p className="mt-2.5 font-mono text-xs text-white/20 tracking-wide">
            {accountId}
          </p>
        </motion.div>
      )}

      {/* Subtle dismiss hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.8 }}
      >
        <p className="mt-10 text-[10px] text-white/10 group-hover:text-white/20 transition-colors">
          tap to continue
        </p>
      </motion.div>
    </button>
  );
}

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

  const [step, setStep] = useState<ConnectionStep>("list");
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [extensionDetected, setExtensionDetected] = useState(false);

  const [manualPairingInput, setManualPairingInput] = useState("");
  const [manualPairingError, setManualPairingError] = useState<string | null>(
    null
  );
  const [isManualPairing, setIsManualPairing] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  const [localSession, setLocalSession] = useState<HashPackSession | null>(
    null
  );

  useEffect(() => {
    setExtensionDetected(isHashPackExtensionInstalled());
    detectHashPackExtension(3000).then((found) => {
      if (found) setExtensionDetected(true);
    });
  }, []);

  const handleHashConnectConnect = async () => {
    setStep("hashpack-connecting");
    setPairingUri(null);
    setConnectionState("");
    setLocalSession(null);
    setManualPairingInput("");
    setManualPairingError(null);
    setIsManualPairing(false);
    setShowManualInput(false);

    const result = await connectHashPack(
      "mainnet",
      (uri) => {
        setPairingUri(uri);
        setStep("hashpack-pairing");
      },
      (state) => {
        setConnectionState(state);
      }
    );

    if (result.success && result.session) {
      setLocalSession(result.session);
      setStep("hashpack-success");
      playConnectionSuccess();
    }
  };

  const handleMetaMaskConnect = async () => {
    setStep("metamask-connect");
    const success = await connectMetaMask();
    if (success) {
      setStep("metamask-success");
      playConnectionSuccess();
    }
  };

  const copyToClipboard = (text: string) => {
    copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleManualPairing = async () => {
    const input = manualPairingInput.trim();
    if (!input) {
      setManualPairingError("Please paste a pairing string.");
      return;
    }
    setIsManualPairing(true);
    setManualPairingError(null);

    const error = await injectPairingUri(input);
    if (error) {
      setManualPairingError(error);
      setIsManualPairing(false);
    } else {
      setManualPairingError(null);
    }
  };

  const handleClearAndRetry = async () => {
    const removed = clearWCStorage(false);
    console.log(
      `[HBAR.h] Clear & Retry: removed ${removed} WC/HC localStorage keys`
    );

    try {
      localStorage.removeItem("hbarh-hashpack-session");
    } catch {
      /* best-effort */
    }

    await forceResetHashConnect();
    handleHashConnectConnect();
  };

  const handleExtensionRetry = () => {
    if (pairingUri) {
      openHashPackExtension(pairingUri);
    } else {
      openHashPackExtension();
    }
  };

  // ═══════════════════════════════════════════════════════
  // METAMASK CONNECTING
  // ═══════════════════════════════════════════════════════
  if (step === "metamask-connect") {
    return (
      <ModalShell>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => setStep("list")}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-white/50" />
            </button>
            <img
              src={METAMASK_LOGO}
              alt="MetaMask"
              className="w-7 h-7 rounded-lg"
            />
            <span className="text-white/90">MetaMask</span>
          </div>

          <div className="text-center py-10">
            {isConnectingMetaMask ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center mx-auto mb-5">
                  <Loader2 className="w-8 h-8 text-orange-400 animate-spin" />
                </div>
                <p className="text-white/90 mb-1">Connecting...</p>
                <p className="text-white/30 text-sm">
                  Approve in your MetaMask extension
                </p>
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
    );
  }

  // ═══════════════════════════════════════════════════════
  // METAMASK SUCCESS
  // ═══════════════════════════════════════════════════════
  if (step === "metamask-success" && metaMaskAccount) {
    return (
      <ModalShell>
        <SuccessScreen
          label="Connected"
          accountId={formatAddress(metaMaskAccount.address)}
          onClose={onClose}
        />
      </ModalShell>
    );
  }

  // ═══════════════════════════════════════════════════════
  // HASHPACK CONNECTING
  // ═══════════════════════════════════════════════════════
  if (step === "hashpack-connecting") {
    return (
      <ModalShell>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => setStep("list")}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-white/50" />
            </button>
            <img
              src={hashpackLogo}
              alt="HashPack"
              className="w-7 h-7 rounded-lg object-cover"
            />
            <span className="text-white/90">HashPack</span>
          </div>

          <div className="text-center py-10">
            {isConnectingHedera ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-5">
                  <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                </div>
                <p className="text-white/90 mb-1">Initializing...</p>
                <p className="text-white/30 text-sm">
                  {connectionState === "Connecting"
                    ? "Searching for extension..."
                    : connectionState === "Connected"
                      ? "Waiting for approval..."
                      : connectionState === "Extension found — connecting..."
                        ? "Extension detected..."
                        : connectionState === "Generating pairing string..."
                          ? "Generating QR code..."
                          : connectionState || "Setting up session..."}
                </p>
                {connectionState && (
                  <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] bg-purple-500/10 text-purple-400">
                    <Wifi className="w-3 h-3" />
                    {connectionState}
                  </div>
                )}
              </>
            ) : hederaConnectionError ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-5">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <p className="text-white/90 mb-2">Connection Failed</p>
                <p className="text-white/30 text-sm mb-6 max-w-xs mx-auto">
                  {hederaConnectionError}
                </p>
                <div className="flex gap-2 justify-center flex-wrap">
                  <button
                    onClick={handleHashConnectConnect}
                    className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm transition-colors"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={handleClearAndRetry}
                    className="px-5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-sm flex items-center gap-2 transition-colors"
                    title="Clear stale data and retry"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Reset
                  </button>
                  <a
                    href={getHashPackDownloadUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 text-sm flex items-center gap-2 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Install
                  </a>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </ModalShell>
    );
  }

  // ═══════════════════════════════════════════════════════
  // HASHPACK PAIRING (QR Code)
  // ═══════════════════════════════════════════════════════
  if (step === "hashpack-pairing") {
    return (
      <ModalShell>
        <div className="p-6 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setStep("list")}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-white/50" />
            </button>
            <img
              src={hashpackLogo}
              alt="HashPack"
              className="w-7 h-7 rounded-lg object-cover"
            />
            <span className="text-white/90">Scan to Connect</span>
          </div>

          <div className="text-center">
            {pairingUri ? (
              <>
                {/* QR Code */}
                <div className="flex justify-center mb-5">
                  <div className="bg-white p-4 rounded-2xl">
                    <QRCodeSVG
                      value={pairingUri}
                      size={180}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#0a0a0f"
                      includeMargin={false}
                    />
                  </div>
                </div>

                {/* URI + Copy */}
                <div className="flex items-center gap-2 mb-4 px-1">
                  <code className="flex-1 text-[10px] font-mono p-2.5 rounded-lg truncate bg-white/[0.03] text-white/30 border border-white/[0.06]">
                    {pairingUri.slice(0, 50)}...
                  </code>
                  <button
                    onClick={() => copyToClipboard(pairingUri)}
                    className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/40"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Deep link buttons */}
                <div className="flex gap-2 justify-center mb-5">
                  <a
                    href={getHashPackDeepLink(pairingUri)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-500/15 text-purple-300 text-sm hover:bg-purple-500/25 transition-colors"
                  >
                    <MonitorSmartphone className="w-4 h-4" />
                    Open HashPack
                  </a>
                  <a
                    href={getWalletConnectUniversalLink(pairingUri)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 text-white/40 text-sm hover:bg-white/10 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Browser
                  </a>
                </div>

                {/* Manual Pairing */}
                <div className="text-left mb-4">
                  <button
                    onClick={() => setShowManualInput(!showManualInput)}
                    className="w-full text-left text-xs px-3 py-2.5 rounded-xl flex items-center justify-between transition-colors bg-white/[0.02] text-white/30 hover:bg-white/[0.04] border border-white/[0.06]"
                  >
                    <span className="flex items-center gap-2">
                      <Copy className="w-3.5 h-3.5" />
                      Paste pairing string
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showManualInput ? "rotate-180" : ""}`}
                    />
                  </button>

                  {showManualInput && (
                    <div className="mt-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={manualPairingInput}
                          onChange={(e) => {
                            setManualPairingInput(e.target.value);
                            setManualPairingError(null);
                          }}
                          placeholder="wc:abc123..."
                          className="flex-1 px-3 py-2 rounded-lg text-sm font-mono outline-none bg-white/[0.03] border border-white/[0.06] focus:border-purple-500/40 text-white/70 placeholder:text-white/15 transition-colors"
                        />
                        <button
                          onClick={handleManualPairing}
                          disabled={
                            isManualPairing || !manualPairingInput.trim()
                          }
                          className="px-4 py-2 rounded-lg text-sm bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {isManualPairing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "Pair"
                          )}
                        </button>
                      </div>
                      {manualPairingError && (
                        <div className="mt-2 flex items-start gap-1.5 text-xs text-red-400">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                          {manualPairingError}
                        </div>
                      )}
                      {isManualPairing && !manualPairingError && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-purple-400">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Waiting for approval...
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Extension retry */}
                {extensionDetected && (
                  <div className="rounded-xl bg-purple-500/5 border border-purple-500/10 p-3 flex items-center gap-3 mb-4">
                    <Shield className="w-4 h-4 text-purple-400 shrink-0" />
                    <span className="flex-1 text-left text-xs text-white/30">
                      Extension detected
                    </span>
                    <button
                      onClick={handleExtensionRetry}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 transition-colors"
                    >
                      Open
                    </button>
                  </div>
                )}

                {/* Connection status */}
                {isConnectingHedera && (
                  <div className="flex items-center justify-center gap-2 text-sm text-purple-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {connectionState === "Connected"
                      ? "Waiting for approval..."
                      : connectionState || "Connecting..."}
                  </div>
                )}
              </>
            ) : hederaConnectionError ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-5">
                  <WifiOff className="w-8 h-8 text-red-400" />
                </div>
                <p className="text-white/90 mb-2">Pairing Failed</p>
                <p className="text-white/30 text-sm mb-6">
                  {hederaConnectionError}
                </p>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={handleHashConnectConnect}
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
              <div className="py-10">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin mx-auto mb-4" />
                <p className="text-white/30 text-sm">Generating QR...</p>
              </div>
            )}
          </div>
        </div>
      </ModalShell>
    );
  }

  // ═══════════════════════════════════════════════════════
  // HASHPACK SUCCESS
  // ═══════════════════════════════════════════════════════
  const sessionForSuccess = localSession || hashPackSession;
  if (step === "hashpack-success" && sessionForSuccess) {
    return (
      <ModalShell>
        <SuccessScreen
          label="Connected"
          accountId={sessionForSuccess.accountId}
          onClose={onClose}
        />
      </ModalShell>
    );
  }

  // ═══════════════════════════════════════════════════════
  // MAIN WALLET LIST
  // ═══════════════════════════════════════════════════════
  return (
    <ModalShell>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-white/90">Connect Wallet</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4 text-white/30" />
          </button>
        </div>

        {/* Dynamic */}
        <a
          href="https://demo.dynamic.xyz/"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-4 p-4 rounded-xl transition-all duration-200 border border-white/[0.06] hover:border-purple-500/30 hover:bg-white/[0.02] mb-3"
        >
          <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0">
            <img
              src={dynamicLogo}
              alt="Dynamic"
              className="w-9 h-9 object-contain"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm text-white/90">Dynamic</span>
              <Badge color="purple">Multi-Wallet</Badge>
            </div>
            <p className="text-xs text-white/30 truncate">
              Google, email, or any wallet
            </p>
          </div>
          <ExternalLink className="w-4 h-4 text-white/15 group-hover:text-white/30 transition-colors shrink-0" />
        </a>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-white/[0.06]" />
          <span className="text-[10px] text-white/20 tracking-widest uppercase">
            Direct
          </span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>

        {/* HashPack */}
        <button
          onClick={handleHashConnectConnect}
          className="group w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 border border-white/[0.06] hover:border-purple-500/30 hover:bg-white/[0.02] text-left mb-3"
        >
          <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0">
            <img
              src={hashpackLogo}
              alt="HashPack"
              className="w-11 h-11 object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm text-white/90">HashPack</span>
              {hashConnectSDKReady && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              <Badge color="purple">Hedera</Badge>
            </div>
            <p className="text-xs text-white/30">
              Extension or WalletConnect
            </p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center shrink-0 group-hover:bg-purple-500/10 transition-colors">
            <Shield className="w-4 h-4 text-white/15 group-hover:text-purple-400 transition-colors" />
          </div>
        </button>

        {/* MetaMask */}
        <button
          onClick={handleMetaMaskConnect}
          className="group w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 border border-white/[0.06] hover:border-orange-500/30 hover:bg-white/[0.02] text-left mb-3"
        >
          <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0">
            <img
              src={METAMASK_LOGO}
              alt="MetaMask"
              className="w-11 h-11 object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm text-white/90">MetaMask</span>
              <Badge color="orange">Ethereum</Badge>
            </div>
            <p className="text-xs text-white/30">
              Browser extension
            </p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center shrink-0 group-hover:bg-orange-500/10 transition-colors">
            <ExternalLink className="w-4 h-4 text-white/15 group-hover:text-orange-400 transition-colors" />
          </div>
        </button>

        {/* Security note */}
        <div className="mt-5 flex items-center gap-2 px-1">
          <Shield className="w-3.5 h-3.5 text-white/15 shrink-0" />
          <p className="text-[11px] text-white/20">
            No private keys are stored or transmitted
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
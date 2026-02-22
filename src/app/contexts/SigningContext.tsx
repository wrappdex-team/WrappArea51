/**
 * SigningContext — Global signing operation overlay
 *
 * Provides a React context + overlay UI that wraps all wallet signing
 * operations (auth challenges, DAO proposals, swaps, etc.) with clear
 * visual feedback.
 *
 * Usage from any component:
 *   const { withSigning } = useSigning();
 *   const result = await withSigning("Authenticating...", () => authenticate(accountId));
 *
 * Features:
 *   - Animated overlay with spinner + status text
 *   - Cancel button with AbortController integration
 *   - 5-minute countdown timer
 *   - beforeunload interception during signing
 *   - Error state with "Reconnect Wallet" action
 *   - Dark glassmorphism matching Wrappdex design system
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Wallet,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { tryOpenWalletExtension } from "../utils/hashpack";

// ── Types ──────────────────────────────────────────────────────────────

type SigningStatus = "idle" | "pending" | "success" | "error";

interface SigningState {
  status: SigningStatus;
  label: string;
  detail?: string;
  error?: string;
  startedAt: number | null;
}

interface SigningContextValue {
  /** Wrap an async signing operation with the overlay */
  withSigning: <T>(
    label: string,
    operation: (signal: AbortSignal) => Promise<T>,
    options?: { detail?: string; timeoutMs?: number },
  ) => Promise<T>;
  /** Whether a signing operation is currently in progress */
  isSigning: boolean;
}

const SigningContext = createContext<SigningContextValue | null>(null);

export function useSigning(): SigningContextValue {
  const ctx = useContext(SigningContext);
  if (!ctx) {
    throw new Error("useSigning must be used within a SigningProvider");
  }
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SUCCESS_DISPLAY_MS = 1500;

export function SigningProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SigningState>({
    status: "idle",
    label: "",
    startedAt: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const beforeUnloadRef = useRef<((e: BeforeUnloadEvent) => void) | null>(null);

  // ── beforeunload guard ─────────────────────────────────────────────

  useEffect(() => {
    if (state.status === "pending") {
      const handler = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        // Legacy browsers need returnValue
        e.returnValue = "A wallet signing operation is in progress. Are you sure you want to leave?";
        return e.returnValue;
      };
      beforeUnloadRef.current = handler;
      window.addEventListener("beforeunload", handler);
      return () => {
        window.removeEventListener("beforeunload", handler);
        beforeUnloadRef.current = null;
      };
    }
  }, [state.status]);

  // ── Core signing wrapper ───────────────────────────────────────────

  const withSigning = useCallback(
    async <T,>(
      label: string,
      operation: (signal: AbortSignal) => Promise<T>,
      options?: { detail?: string; timeoutMs?: number },
    ): Promise<T> => {
      // Abort any in-flight signing
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      setState({
        status: "pending",
        label,
        detail: options?.detail ?? "Check your wallet and approve the request",
        startedAt: Date.now(),
      });

      // Timeout race
      const timeout = setTimeout(() => {
        ac.abort();
      }, timeoutMs);

      try {
        const result = await operation(ac.signal);

        clearTimeout(timeout);

        // Brief success flash
        setState((prev) => ({
          ...prev,
          status: "success",
          label: "Signed successfully",
          detail: undefined,
          error: undefined,
        }));

        // Auto-dismiss success
        await new Promise((r) => setTimeout(r, SUCCESS_DISPLAY_MS));
        setState({ status: "idle", label: "", startedAt: null });

        return result;
      } catch (err: any) {
        clearTimeout(timeout);
        const msg = err?.message || String(err);
        const isAborted = msg.includes("aborted") || msg.includes("cancelled") || ac.signal.aborted;

        if (isAborted) {
          setState({ status: "idle", label: "", startedAt: null });
          throw new Error("Signing was cancelled by user");
        }

        setState((prev) => ({
          ...prev,
          status: "error",
          error: msg,
        }));

        throw err;
      }
    },
    [],
  );

  // ── Cancel handler ─────────────────────────────────────────────────

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle", label: "", startedAt: null });
  }, []);

  const handleDismissError = useCallback(() => {
    setState({ status: "idle", label: "", startedAt: null });
  }, []);

  // ── Context value ──────────────────────────────────────────────────

  const value: SigningContextValue = {
    withSigning,
    isSigning: state.status === "pending",
  };

  return (
    <SigningContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {state.status !== "idle" && (
          <SigningOverlay
            state={state}
            onCancel={handleCancel}
            onDismiss={handleDismissError}
          />
        )}
      </AnimatePresence>
    </SigningContext.Provider>
  );
}

// ── Overlay Component ──────────────────────────────────────────────────

function SigningOverlay({
  state,
  onCancel,
  onDismiss,
}: {
  state: SigningState;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
      style={{ willChange: "opacity" }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 16 }}
        transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
        className="w-full max-w-sm rounded-2xl bg-[#0c0c14]/95 border border-white/[0.08] shadow-2xl shadow-black/60 overflow-hidden"
        style={{ willChange: "transform, opacity" }}
      >
        {state.status === "pending" && (
          <PendingContent state={state} onCancel={onCancel} />
        )}
        {state.status === "success" && <SuccessContent />}
        {state.status === "error" && (
          <ErrorContent error={state.error || "Unknown error"} onDismiss={onDismiss} />
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Pending State ─────────────────────────────────────────────────────

function PendingContent({
  state,
  onCancel,
}: {
  state: SigningState;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!state.startedAt) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - state.startedAt!) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [state.startedAt]);

  const remaining = Math.max(0, 300 - elapsed); // 5 min = 300s
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isUrgent = remaining < 60;

  return (
    <div className="p-6 text-center">
      {/* Animated wallet icon */}
      <div className="relative w-20 h-20 mx-auto mb-6">
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: "conic-gradient(from 0deg, #ec4899, #a855f7, #6366f1, #22d3ee, #ec4899)",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
        <div className="absolute inset-[3px] rounded-full bg-[#0c0c14] flex items-center justify-center">
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Wallet className="w-8 h-8 text-purple-400" />
          </motion.div>
        </div>
      </div>

      {/* Label */}
      <p className="text-white/90 text-lg font-medium mb-1">{state.label}</p>
      <p className="text-white/40 text-sm mb-6">{state.detail}</p>

      {/* Countdown */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs mb-6 ${
        isUrgent
          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
          : "bg-white/[0.04] text-white/30 border border-white/[0.06]"
      }`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>
          {remaining > 0
            ? `${mins}:${secs.toString().padStart(2, "0")} remaining`
            : "Request may have timed out"}
        </span>
      </div>

      {/* Pulse indicator */}
      <div className="flex items-center justify-center gap-1.5 mb-6">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-purple-400"
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.3,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* [C85] Open Wallet + Cancel buttons */}
      <div className="flex items-center justify-center gap-2">
        {elapsed >= 5 && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => tryOpenWalletExtension()}
            className="px-5 py-2.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/20 text-purple-300 text-sm flex items-center gap-2 transition-all duration-200"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open HashPack
          </motion.button>
        )}
        <button
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white/50 hover:text-white/70 text-sm transition-all duration-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Success State ──────────────────────────────────────────────────────

function SuccessContent() {
  return (
    <div className="p-6 text-center py-10">
      <motion.div
        className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
      </motion.div>
      <motion.p
        className="text-emerald-400 text-lg font-medium"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
      >
        Signed successfully
      </motion.p>
      <motion.div
        className="mt-2 flex items-center justify-center gap-1.5 text-xs text-white/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <ShieldCheck className="w-3 h-3" />
        <span>Verified on-chain</span>
      </motion.div>
    </div>
  );
}

// ── Error State ────────────────────────────────────────────────────────

function ErrorContent({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  const isRejected = error.includes("rejected") || error.includes("Rejected");
  const isTimeout = error.includes("timed out") || error.includes("timeout");
  const isSessionDead = error.includes("No active") || error.includes("session") || error.includes("expired");

  return (
    <div className="p-6 text-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <AlertCircle className="w-8 h-8 text-red-400" />
      </div>

      <p className="text-white/90 text-lg font-medium mb-1">
        {isRejected ? "Request Rejected" : isTimeout ? "Request Timed Out" : "Signing Failed"}
      </p>
      <p className="text-white/30 text-sm mb-6 max-w-xs mx-auto leading-relaxed">{error}</p>

      <div className="flex gap-2 justify-center flex-wrap">
        <button
          onClick={onDismiss}
          className="px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white/60 hover:text-white/80 text-sm transition-all duration-200"
        >
          Dismiss
        </button>
        {isSessionDead && (
          <button
            onClick={() => {
              onDismiss();
              // Trigger wallet reconnect — dispatch custom event that WalletConnectModal listens for
              window.dispatchEvent(new CustomEvent("wrappdex:open-wallet-modal"));
            }}
            className="px-5 py-2.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/20 text-purple-300 text-sm flex items-center gap-2 transition-all duration-200"
          >
            <Wallet className="w-3.5 h-3.5" />
            Reconnect Wallet
          </button>
        )}
        {isSessionDead && (
          <button
            onClick={() => {
              onDismiss();
              // Try to open HashPack extension
              tryOpenWalletExtension();
            }}
            className="px-5 py-2.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/20 text-purple-300 text-sm flex items-center gap-2 transition-all duration-200"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open HashPack
          </button>
        )}
      </div>
    </div>
  );
}
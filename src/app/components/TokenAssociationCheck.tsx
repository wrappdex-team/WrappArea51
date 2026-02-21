/**
 * TokenAssociationCheck — Inline Pre-Swap Association Gate
 *
 * Hedera HTS tokens must be explicitly associated with an account before
 * that account can receive them. This component checks association status
 * for a given token and provides a one-click associate flow.
 *
 * Renders inline (not a modal) — designed to sit between quote details
 * and the swap/deposit button. Shows nothing when the token is already
 * associated or when no wallet is connected.
 *
 * Uses: checkTokenAssociation() and buildTokenAssociateTransaction()
 * from atomic-swap-client.ts, sendHederaTransaction() from hashpack.ts.
 *
 * SENIOR DEV NOTE [C4-01]:
 *   Token association is a Hedera-specific requirement with no EVM equivalent.
 *   Unlike ERC-20 approvals, association is a one-time on-chain transaction
 *   that costs ~0.05 HBAR. Without it, any CryptoTransfer crediting the
 *   unassociated token to the user's account will fail with
 *   TOKEN_NOT_ASSOCIATED_TO_ACCOUNT at consensus.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Link2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  checkTokenAssociation,
  buildTokenAssociateTransaction,
} from "../utils/atomic-swap-client";
import { sendHederaTransaction } from "../utils/hashpack";
import { playVipButtonChime, playVipConfirm } from "../utils/sounds";

// ── Types ───────────────────────────────────────────────────────────

export type AssociationStatus =
  | "unknown"     // Not yet checked
  | "checking"    // Mirror Node query in flight
  | "associated"  // Token is associated — no action needed
  | "needed"      // Token NOT associated — user must associate
  | "associating" // TokenAssociateTransaction in wallet
  | "success"     // Just associated — brief success flash
  | "error";      // Association attempt failed

interface TokenAssociationCheckProps {
  /** User's Hedera account ID */
  accountId: string | null;
  /** HTS token ID to check (e.g., "0.0.456858") */
  tokenId: string;
  /** Human-readable symbol for display (e.g., "USDC") */
  tokenSymbol: string;
  /** Token logo URL (optional) */
  tokenLogo?: string;
  /** Dark mode */
  isDark: boolean;
  /** Fires when association status changes — parent can gate actions */
  onStatusChange?: (status: AssociationStatus) => void;
  /** Compact mode — less padding, smaller text */
  compact?: boolean;
}

// ── Component ───────────────────────────────────────────────────────

export function TokenAssociationCheck({
  accountId,
  tokenId,
  tokenSymbol,
  tokenLogo,
  isDark,
  onStatusChange,
  compact = false,
}: TokenAssociationCheckProps) {
  const [status, setStatus] = useState<AssociationStatus>("unknown");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const lastCheckRef = useRef<string>("");

  // Track mounted state for async safety
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Notify parent on status changes
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // ── Check association on mount and when inputs change ────────────
  useEffect(() => {
    const key = `${accountId}:${tokenId}`;
    if (key === lastCheckRef.current && status !== "unknown") return;
    lastCheckRef.current = key;

    if (!accountId || !tokenId) {
      setStatus("unknown");
      return;
    }

    let cancelled = false;
    setStatus("checking");
    setErrorMsg(null);

    checkTokenAssociation(accountId, tokenId).then((isAssociated) => {
      if (cancelled || !mountedRef.current) return;
      setStatus(isAssociated ? "associated" : "needed");
    });

    return () => { cancelled = true; };
  }, [accountId, tokenId]);

  // ── Handle association ──────────────────────────────────────────
  const handleAssociate = useCallback(async () => {
    if (!accountId || !tokenId) return;

    setStatus("associating");
    setErrorMsg(null);
    playVipButtonChime();

    try {
      // Build the TokenAssociateTransaction
      const buildResult = await buildTokenAssociateTransaction(accountId, tokenId);
      if ("error" in buildResult) {
        throw new Error(buildResult.error);
      }

      // Send to wallet for signing + execution
      const walletResult = await sendHederaTransaction(
        accountId,
        buildResult.transactionBytes,
      );

      if (!mountedRef.current) return;

      if (!walletResult.success) {
        if (walletResult.error?.includes("rejected")) {
          setStatus("needed");
          toast.error("Token association cancelled");
          return;
        }
        throw new Error(walletResult.error || "Association failed");
      }

      // Success
      setStatus("success");
      playVipConfirm();
      toast.success(`${tokenSymbol} associated successfully`);

      // Transition to "associated" after brief success flash
      setTimeout(() => {
        if (mountedRef.current) setStatus("associated");
      }, 2000);
    } catch (err: any) {
      if (!mountedRef.current) return;
      const msg = err?.message || "Token association failed";
      setStatus("error");
      setErrorMsg(msg);
      toast.error(msg);
    }
  }, [accountId, tokenId, tokenSymbol]);

  // ── Retry after error ───────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setStatus("needed");
    setErrorMsg(null);
  }, []);

  // ── Render nothing when associated or not checkable ─────────────
  if (
    status === "unknown" ||
    status === "checking" ||
    status === "associated" ||
    !accountId
  ) {
    // Show a subtle checking indicator only during active check
    if (status === "checking") {
      return (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className={`flex items-center gap-2 ${compact ? "py-1" : "py-1.5"} ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[10px]">Checking {tokenSymbol} association...</span>
          </div>
        </motion.div>
      );
    }
    return null;
  }

  // ── Render: needs association / associating / success / error ────
  return (
    <AnimatePresence mode="wait">
      {/* Needs Association */}
      {status === "needed" && (
        <motion.div
          key="needed"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className={`rounded-xl ${compact ? "p-2.5" : "p-3"} flex items-start gap-2.5 ${
            isDark
              ? "bg-amber-500/[0.06] border border-amber-500/15"
              : "bg-amber-50 border border-amber-200"
          }`}>
            <Shield className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? "text-amber-400/80" : "text-amber-500"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {tokenLogo && (
                  <img
                    src={tokenLogo}
                    alt={tokenSymbol}
                    className="w-4 h-4 rounded-full"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <p className={`text-xs font-semibold ${isDark ? "text-amber-400" : "text-amber-700"}`}>
                  Associate {tokenSymbol}
                </p>
              </div>
              <p className={`text-[10px] leading-relaxed mb-2 ${isDark ? "text-amber-400/60" : "text-amber-600/70"}`}>
                Your account must associate this token before receiving it. This is a one-time Hedera transaction (~0.05 HBAR).
              </p>
              <motion.button
                onClick={handleAssociate}
                whileTap={{ scale: 0.97 }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-all cursor-pointer ${
                  isDark
                    ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:shadow-[0_0_12px_rgba(245,158,11,0.3)]"
                    : "bg-gradient-to-r from-amber-500 to-orange-500 hover:shadow-lg"
                }`}
              >
                <Link2 className="w-3 h-3" />
                Associate {tokenSymbol}
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Associating (wallet interaction in progress) */}
      {status === "associating" && (
        <motion.div
          key="associating"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className={`rounded-xl ${compact ? "p-2.5" : "p-3"} flex items-center gap-2.5 ${
            isDark
              ? "bg-blue-500/[0.06] border border-blue-500/15"
              : "bg-blue-50 border border-blue-200"
          }`}>
            <Loader2 className={`w-4 h-4 animate-spin ${isDark ? "text-blue-400" : "text-blue-500"}`} />
            <div>
              <p className={`text-xs font-semibold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                Associating {tokenSymbol}...
              </p>
              <p className={`text-[10px] ${isDark ? "text-blue-400/60" : "text-blue-500/70"}`}>
                Confirm in your wallet
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Success */}
      {status === "success" && (
        <motion.div
          key="success"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className={`rounded-xl ${compact ? "p-2.5" : "p-3"} flex items-center gap-2.5 ${
            isDark
              ? "bg-emerald-500/[0.06] border border-emerald-500/15"
              : "bg-emerald-50 border border-emerald-200"
          }`}>
            <CheckCircle2 className={`w-4 h-4 ${isDark ? "text-emerald-400" : "text-emerald-500"}`} />
            <p className={`text-xs font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
              {tokenSymbol} associated
            </p>
          </div>
        </motion.div>
      )}

      {/* Error */}
      {status === "error" && (
        <motion.div
          key="error"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className={`rounded-xl ${compact ? "p-2.5" : "p-3"} flex items-start gap-2.5 ${
            isDark
              ? "bg-red-500/[0.08] border border-red-500/20"
              : "bg-red-50 border border-red-200"
          }`}>
            <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? "text-red-400" : "text-red-500"}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-semibold ${isDark ? "text-red-400" : "text-red-600"}`}>
                Association Failed
              </p>
              {errorMsg && (
                <p className={`text-[10px] mt-0.5 truncate ${isDark ? "text-red-400/60" : "text-red-500/70"}`}>
                  {errorMsg}
                </p>
              )}
              <button
                onClick={handleRetry}
                className={`mt-1.5 text-[10px] font-bold underline underline-offset-2 cursor-pointer ${isDark ? "text-red-400/80 hover:text-red-400" : "text-red-500 hover:text-red-700"}`}
              >
                Try again
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Utility Hook — Check association status imperatively ─────────────

/**
 * Lightweight hook for components that need to check association
 * without rendering the full TokenAssociationCheck UI.
 */
export function useTokenAssociation(
  accountId: string | null,
  tokenId: string | null,
): { isAssociated: boolean | null; isChecking: boolean; recheck: () => void } {
  const [isAssociated, setIsAssociated] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const check = useCallback(async () => {
    if (!accountId || !tokenId) {
      setIsAssociated(null);
      return;
    }
    setIsChecking(true);
    try {
      const result = await checkTokenAssociation(accountId, tokenId);
      setIsAssociated(result);
    } catch {
      setIsAssociated(null);
    }
    setIsChecking(false);
  }, [accountId, tokenId]);

  useEffect(() => { check(); }, [check]);

  return { isAssociated, isChecking, recheck: check };
}

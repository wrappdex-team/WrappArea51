/**
 * V2TokenAssociationGuard — Pre-Transaction Token Association Checker
 *
 * [LP-14] Step 14 of the V2 Liquidity Master Plan.
 *
 * Before executing V2 liquidity operations, Hedera requires explicit
 * token association. This component checks and auto-associates:
 *
 *   Minting:    Both pool tokens + V2 LP NFT (0.0.4054027)
 *   Collecting: Both output tokens
 *   Removing:   Both output tokens
 *
 * Integrates with existing TokenAssociationCheck patterns from
 * atomic-swap-client.ts and hashpack.ts.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Link2,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import {
  checkTokenAssociation,
  buildTokenAssociateTransaction,
} from "../utils/atomic-swap-client";
import { sendHederaTransaction } from "../utils/hashpack";
import { SAUCERSWAP_V2_LP_NFT } from "../utils/saucerswap/contracts";

// ── Types ────────────────────────────────────────────────────────────

type AssocStatus = "checking" | "needed" | "associating" | "associated" | "error";

interface TokenToCheck {
  tokenId: string;
  symbol: string;
  logo?: string;
}

interface AssocResult {
  tokenId: string;
  symbol: string;
  status: AssocStatus;
  error?: string;
}

export type GuardResult = "ready" | "pending" | "blocked";

interface V2TokenAssociationGuardProps {
  /** Which operation is being guarded */
  operation: "mint" | "collect" | "remove";
  /** Tokens involved in the operation */
  tokens: TokenToCheck[];
  /** Whether to include the V2 LP NFT check (for minting) */
  includeNFT?: boolean;
  /** Callback when all associations are ready (or not) */
  onGuardResult?: (result: GuardResult) => void;
  /** Compact display mode */
  compact?: boolean;
}

// ── Component ────────────────────────────────────────────────────────

export function V2TokenAssociationGuard({
  operation,
  tokens,
  includeNFT = false,
  onGuardResult,
  compact = false,
}: V2TokenAssociationGuardProps) {
  const { isDark } = useTheme();
  const { primaryWallet, hederaAccount, hederaNetwork } = useWallet();
  const accountId = hederaAccount?.accountId || primaryWallet?.accountId || "";
  const network = (hederaNetwork || "mainnet") as "mainnet" | "testnet";
  const mountedRef = useRef(true);

  // Build full token list (including NFT if minting)
  const nftTokenId = SAUCERSWAP_V2_LP_NFT[network] || "0.0.4054027";
  const allTokens: TokenToCheck[] = [
    ...tokens.filter(t => t.tokenId && t.tokenId !== "native" && t.tokenId !== "0.0.0"),
    ...(includeNFT ? [{ tokenId: nftTokenId, symbol: "V2 LP NFT", logo: undefined }] : []),
  ];

  const [results, setResults] = useState<AssocResult[]>(
    allTokens.map(t => ({ tokenId: t.tokenId, symbol: t.symbol, status: "checking" as AssocStatus }))
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // If no tokens to check, immediately report ready
  useEffect(() => {
    if (allTokens.length === 0) {
      onGuardResult?.("ready");
    }
  }, [allTokens.length, onGuardResult]);

  // Check all associations on mount
  useEffect(() => {
    if (!accountId || allTokens.length === 0) return;

    const checkAll = async () => {
      const newResults: AssocResult[] = [];

      for (const token of allTokens) {
        try {
          const isAssociated = await checkTokenAssociation(accountId, token.tokenId);
          if (!mountedRef.current) return;
          newResults.push({
            tokenId: token.tokenId,
            symbol: token.symbol,
            status: isAssociated ? "associated" : "needed",
          });
        } catch (err: any) {
          if (!mountedRef.current) return;
          newResults.push({
            tokenId: token.tokenId,
            symbol: token.symbol,
            status: "error",
            error: err?.message || "Check failed",
          });
        }
      }

      if (mountedRef.current) {
        setResults(newResults);
      }
    };

    checkAll();
  }, [accountId, JSON.stringify(allTokens.map(t => t.tokenId))]);

  // Compute guard result
  useEffect(() => {
    const allAssociated = results.every(r => r.status === "associated");
    const anyChecking = results.some(r => r.status === "checking" || r.status === "associating");
    const result: GuardResult = allAssociated ? "ready" : anyChecking ? "pending" : "blocked";
    onGuardResult?.(result);
  }, [results, onGuardResult]);

  // Associate a single token
  const handleAssociate = useCallback(async (tokenId: string) => {
    if (!accountId) return;

    setResults(prev => prev.map(r =>
      r.tokenId === tokenId ? { ...r, status: "associating" as AssocStatus } : r
    ));

    try {
      const txResult = await buildTokenAssociateTransaction(accountId, tokenId);
      if ("error" in txResult) {
        throw new Error(txResult.error);
      }
      const result = await sendHederaTransaction(accountId, txResult.transactionBytes);

      if (!mountedRef.current) return;

      if (result?.success) {
        setResults(prev => prev.map(r =>
          r.tokenId === tokenId ? { ...r, status: "associated" as AssocStatus } : r
        ));
        const symbol = allTokens.find(t => t.tokenId === tokenId)?.symbol || tokenId;
        toast.success(`${symbol} associated successfully`);
      } else {
        setResults(prev => prev.map(r =>
          r.tokenId === tokenId ? { ...r, status: "needed" as AssocStatus, error: "Association failed" } : r
        ));
        toast.error("Token association failed — check your wallet");
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setResults(prev => prev.map(r =>
        r.tokenId === tokenId ? { ...r, status: "error" as AssocStatus, error: err?.message } : r
      ));
      toast.error(`Association error: ${err?.message || "Unknown error"}`);
    }
  }, [accountId, allTokens]);

  // Associate all needed tokens at once
  const handleAssociateAll = useCallback(async () => {
    const needed = results.filter(r => r.status === "needed" || r.status === "error");
    for (const r of needed) {
      await handleAssociate(r.tokenId);
    }
  }, [results, handleAssociate]);

  // ── Render ─────────────────────────────────────────────────────────

  const needsAssociation = results.some(r => r.status === "needed" || r.status === "error");
  const isChecking = results.some(r => r.status === "checking");
  const isAssociating = results.some(r => r.status === "associating");
  const allReady = results.every(r => r.status === "associated");

  // If all tokens are associated, show nothing (or a minimal checkmark)
  if (allReady && !compact) return null;
  if (allReady && compact) {
    return (
      <div className={`flex items-center gap-1.5 text-xs ${isDark ? "text-emerald-400/70" : "text-emerald-500"}`}>
        <CheckCircle2 className="w-3 h-3" />
        All tokens associated
      </div>
    );
  }

  // If checking
  if (isChecking) {
    return (
      <div className={`flex items-center gap-2 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        Checking token associations...
      </div>
    );
  }

  // Show association requirements
  const operationLabel = operation === "mint" ? "mint a position" : operation === "collect" ? "collect fees" : "remove liquidity";

  return (
    <div className={`rounded-lg ${compact ? "p-2" : "p-3"} space-y-2 ${
      isDark
        ? "bg-amber-500/5 border border-amber-500/20"
        : "bg-amber-50 border border-amber-200"
    }`}>
      <div className="flex items-start gap-2">
        <Shield className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? "text-amber-400" : "text-amber-500"}`} />
        <div className="flex-1">
          <div className={`font-bold text-xs ${isDark ? "text-amber-300" : "text-amber-700"}`}>
            Token Association Required
          </div>
          <div className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Hedera requires explicit token association before you can {operationLabel}.
          </div>
        </div>
      </div>

      {/* Token list */}
      <div className="space-y-1">
        {results.map((r) => (
          <div key={r.tokenId} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              {r.status === "associated" && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
              {r.status === "needed" && <AlertTriangle className="w-3 h-3 text-amber-400" />}
              {r.status === "associating" && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
              {r.status === "checking" && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
              {r.status === "error" && <AlertTriangle className="w-3 h-3 text-red-400" />}
              <span className={r.status === "associated" ? (isDark ? "text-slate-400" : "text-gray-500") : ""}>
                {r.symbol}
              </span>
              <span className={`font-mono ${isDark ? "text-slate-600" : "text-gray-300"}`}>
                ({r.tokenId})
              </span>
            </div>
            {(r.status === "needed" || r.status === "error") && (
              <button
                onClick={() => handleAssociate(r.tokenId)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold transition-all ${
                  isDark
                    ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                    : "bg-amber-100 text-amber-600 hover:bg-amber-200"
                }`}
              >
                <Link2 className="w-3 h-3" />
                Associate
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Associate All button */}
      {needsAssociation && results.filter(r => r.status === "needed" || r.status === "error").length > 1 && (
        <button
          onClick={handleAssociateAll}
          disabled={isAssociating}
          className={`w-full py-2 rounded-lg text-xs font-bold transition-all ${
            isAssociating
              ? isDark ? "bg-slate-800 text-slate-500 cursor-wait" : "bg-gray-200 text-gray-400 cursor-wait"
              : isDark
                ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20"
                : "bg-amber-100 text-amber-600 hover:bg-amber-200 border border-amber-200"
          }`}
        >
          {isAssociating ? "Associating..." : `Associate All (${results.filter(r => r.status !== "associated").length})`}
        </button>
      )}
    </div>
  );
}
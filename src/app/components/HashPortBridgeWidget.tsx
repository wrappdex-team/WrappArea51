/**
 * HashPortBridgeWidget — Embedded Hedera ↔ EVM bridge.
 *
 * IMPLEMENTATION NOTE — Wallet Connection in Iframes (Browser Security)
 * ======================================================================
 * Browser extensions (MetaMask, HashPack desktop extension) deliberately
 * DO NOT inject their providers (window.ethereum / window.hethers) into
 * cross-origin iframes. This is enforced at the browser extension layer —
 * specifically MetaMask's content-script checks `window.self !== window.top`
 * and refuses to inject when the frame origin doesn't match the top-level
 * window. This is a BROWSER/EXTENSION-LEVEL constraint, NOT a bug in
 * WRAPpDEX or in HashPort.
 *
 * WHAT WORKS in this embedded widget:
 *   ✅  WalletConnect  — WebSocket-based, QR code modal, no extension needed
 *   ✅  Import Hedera Account — manual account entry, no extension needed
 *
 * WHAT DOES NOT WORK in this embedded widget (by design of the browser):
 *   ❌  MetaMask extension ("Connect to EVM Wallet")
 *   ❌  HashPack desktop browser extension
 *
 * WORKAROUND: Open HashPort in its own browser tab via "Open Full App".
 * In a full tab, extensions inject normally and all connection methods work.
 *
 * ROOT CAUSE DETAIL:
 *   MetaMask content-script (contentscript.js) guard:
 *     if (window.self !== window.top && !isSameOriginFrame()) return;
 *   HashPack extension has an equivalent origin-check guard.
 *   This cannot be overridden by the iframe `sandbox` or `allow` attributes —
 *   those only control browser-native APIs, not extension injection logic.
 *
 * ADDITIONAL FIX: Added `allow-storage-access-by-user-activation` to sandbox
 * so WalletConnect session keys and bridge state can persist in the iframe's
 * own localStorage (third-party storage access was previously blocked by
 * Chrome 115+ / Safari ITP, silently breaking WalletConnect reconnects).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  X,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { Tip } from "./Tip";

interface HashPortBridgeWidgetProps {
  onClose: () => void;
  isDark: boolean;
}

const HASHPORT_APP_URL = "https://app.hashport.network/";

export function HashPortBridgeWidget({ onClose, isDark }: HashPortBridgeWidgetProps) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIframeLoaded(false);
    setLoadError(false);

    loadTimerRef.current = setTimeout(() => {
      setLoadError(true);
    }, 30_000);

    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  const handleIframeLoad = useCallback(() => {
    setIframeLoaded(true);
    setLoadError(false);
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
  }, []);

  const handleIframeError = useCallback(() => {
    setLoadError(true);
    setIframeLoaded(false);
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
  }, []);

  const handleRetry = useCallback(() => {
    setRetryKey((k) => k + 1);
  }, []);

  return (
    <div className="w-full space-y-3">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              iframeLoaded
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                : loadError
                ? "bg-red-400"
                : "bg-teal-400 animate-pulse"
            }`}
          />
          <span className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            {iframeLoaded ? "HashPort loaded" : loadError ? "Load error" : "Loading HashPort…"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Tip content="Open HashPort in new tab">
            <a
              href={HASHPORT_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`p-1.5 rounded-lg transition-colors ${
                isDark
                  ? "hover:bg-white/[0.06] text-slate-500 hover:text-slate-300"
                  : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              }`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </Tip>
          <Tip content="Close">
            <button
              onClick={onClose}
              className={`p-1.5 rounded-lg transition-colors ${
                isDark
                  ? "hover:bg-white/[0.06] text-slate-500 hover:text-slate-300"
                  : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              }`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </Tip>
        </div>
      </div>

      {/* ── Widget Container ── */}
      <div
        className="relative w-full rounded-2xl overflow-hidden"
        style={{ backgroundColor: "#0d1117", minHeight: "680px" }}
      >
        {/* Loading state */}
        <AnimatePresence>
          {!iframeLoaded && !loadError && (
            <motion.div
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10"
              style={{ backgroundColor: "#0d1117" }}
            >
              <div className="w-10 h-10 rounded-full border-2 border-teal-500/30 border-t-teal-500 animate-spin" />
              <span className="text-sm text-slate-500">Loading HashPort Bridge…</span>
              <span className="text-xs text-slate-600">Connecting to app.hashport.network</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error state */}
        {loadError && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center z-10"
            style={{ backgroundColor: "#0d1117" }}
          >
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <div>
              <h4 className="text-slate-200 font-bold mb-1">Widget Failed to Load</h4>
              <p className="text-sm text-slate-400 max-w-sm">
                Could not reach HashPort. This may be caused by an ad-blocker or network issue.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
              <a
                href={HASHPORT_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Open Full App
              </a>
            </div>
          </div>
        )}

        {/* IMPLEMENTATION NOTE: sandbox additions over original:
            - allow-storage-access-by-user-activation: fixes WalletConnect
              session persistence (Chrome 115+ / Safari ITP block 3rd-party
              storage in iframes, breaking WalletConnect reconnects silently)
            - allow-downloads: HashPack QR export & tx receipts
            allow additions: camera (QR scan), payment (WalletConnect flows) */}
        <iframe
          key={retryKey}
          ref={iframeRef}
          title="HashPort Bridge"
          src={HASHPORT_APP_URL}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          referrerPolicy="no-referrer-when-downgrade"
          allow="clipboard-write; clipboard-read; camera; payment; wallet-*"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-top-navigation-by-user-activation allow-storage-access-by-user-activation allow-downloads"
          className="w-full border-0"
          style={{
            height: "680px",
            opacity: iframeLoaded && !loadError ? 1 : 0,
            transition: "opacity 0.4s ease",
            colorScheme: "dark",
          }}
        />
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between">
        <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
          Powered by HashPort Network — Hedera ↔ EVM Bridge
        </p>
        <a
          href={HASHPORT_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-1 text-xs transition-colors ${
            isDark ? "text-teal-500 hover:text-teal-300" : "text-teal-600 hover:text-teal-800"
          }`}
        >
          <Wifi className="w-3 h-3" />
          Open Full App
        </a>
      </div>
    </div>
  );
}
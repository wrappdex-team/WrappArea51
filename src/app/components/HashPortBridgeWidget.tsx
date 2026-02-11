/**
 * HashPort Bridge Widget — Embedded Hedera ↔ EVM bridge.
 *
 * Embeds the official HashPort web app (app.hashport.network) in an iframe.
 * HashPort natively supports HashPack and MetaMask wallet connections inside
 * the widget, so users can bridge assets on mainnet without leaving the site.
 *
 * Pattern: identical to SquidBridgeWidget.tsx (iframe embed with loading/error
 * states and graceful fallback to external link).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import {
  X,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

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
      if (!iframeLoaded) {
        setLoadError(true);
      }
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
    <div className="w-full">
      {/* ── Minimal top bar ── */}
      <div className="flex items-center justify-between mb-3">
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
          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {iframeLoaded ? "Connected" : loadError ? "Error" : "Connecting..."}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <a
            href={HASHPORT_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`p-1.5 rounded-lg transition-colors ${
              isDark
                ? "hover:bg-white/[0.06] text-slate-500 hover:text-slate-300"
                : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            }`}
            title="Open in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isDark
                ? "hover:bg-white/[0.06] text-slate-500 hover:text-slate-300"
                : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            }`}
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Widget Container — dark background matching HashPort app ── */}
      <div
        className="relative w-full rounded-2xl overflow-hidden"
        style={{
          backgroundColor: "#0d1117",
          minHeight: "700px",
        }}
      >
        {/* Loading state */}
        <AnimatePresence>
          {!iframeLoaded && !loadError && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10"
              style={{ backgroundColor: "#0d1117" }}
            >
              <div className="w-10 h-10 rounded-full border-2 border-teal-500/30 border-t-teal-500 animate-spin" />
              <span className="text-sm text-slate-500">
                Loading HashPort Bridge...
              </span>
            </div>
          )}
        </AnimatePresence>

        {/* Error state */}
        {loadError && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center z-10"
            style={{ backgroundColor: "#0d1117" }}
          >
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            <div>
              <h4 className="text-slate-200 mb-1">Widget Failed to Load</h4>
              <p className="text-sm text-slate-400 max-w-sm">
                Could not reach HashPort. This may be caused by an ad-blocker, CSP policy, or network issue. Try opening externally.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
              <a
                href={HASHPORT_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Open Externally
              </a>
            </div>
          </div>
        )}

        {/* Iframe */}
        <iframe
          key={retryKey}
          ref={iframeRef}
          title="HashPort Bridge"
          src={HASHPORT_APP_URL}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          allow="clipboard-write; clipboard-read; wallet-*"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-top-navigation-by-user-activation"
          className="w-full border-0"
          style={{
            height: "700px",
            opacity: iframeLoaded && !loadError ? 1 : 0,
            transition: "opacity 0.4s ease",
            colorScheme: "dark",
          }}
        />
      </div>

      {/* ── Subtle footer ── */}
      <div className={`mt-2 text-center text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
        Powered by HashPort Network — Hedera ↔ EVM Bridge
      </div>
    </div>
  );
}

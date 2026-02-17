/**
 * Squid Bridge Widget — Embedded cross-chain swap widget powered by Axelar.
 *
 * Embeds the Squid Router widget via an iframe from studio.squidrouter.com.
 * The config is JSON-stringified and URL-encoded as a query parameter.
 *
 * Fallback: if the iframe fails to load (CSP / network), the user can open
 * the full Squid app at app.squidrouter.com in a new tab.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import {
  X,
  ExternalLink,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Tip } from "./Tip";

interface SquidBridgeWidgetProps {
  onClose: () => void;
  isDark: boolean;
}

/* ── Widget configuration (matching Squid Studio output) ───── */

const SQUID_WIDGET_CONFIG = {
  integratorId: "squid-widget-studio",
  theme: {
    borderRadius: {
      "button-lg-primary": "3.75rem",
      "button-lg-secondary": "3.75rem",
      "button-lg-tertiary": "3.75rem",
      "button-md-primary": "1.25rem",
      "button-md-secondary": "1.25rem",
      "button-md-tertiary": "1.25rem",
      "button-sm-primary": "1.25rem",
      "button-sm-secondary": "1.25rem",
      "button-sm-tertiary": "1.25rem",
      container: "1.875rem",
      input: "9999px",
      "menu-sm": "0.9375rem",
      "menu-lg": "1.25rem",
      modal: "1.875rem",
    },
    fontSize: {
      caption: "0.875rem",
      "body-small": "1.14375rem",
      "body-medium": "1.40625rem",
      "body-large": "1.75625rem",
      "heading-small": "2.1875rem",
      "heading-medium": "3.08125rem",
      "heading-large": "4.40625rem",
    },
    fontWeight: {
      caption: "400",
      "body-small": "400",
      "body-medium": "400",
      "body-large": "400",
      "heading-small": "400",
      "heading-medium": "400",
      "heading-large": "400",
    },
    fontFamily: { "squid-main": "GeistVariable, sans-serif" },
    boxShadow: {
      container:
        "0px 2px 4px 0px rgba(0, 0, 0, 0.20), 0px 5px 50px -1px rgba(0, 0, 0, 0.33)",
    },
    color: {
      "grey-100": "#FBFBFD",
      "grey-200": "#EDEFF3",
      "grey-300": "#D1D6E0",
      "grey-400": "#A7ABBE",
      "grey-500": "#8A8FA8",
      "grey-600": "#676B7E",
      "grey-700": "#4C515D",
      "grey-800": "#292C32",
      "grey-900": "#17191C",
      "royal-300": "#D9BEF4",
      "royal-400": "#B893EC",
      "royal-500": "#9E79D2",
      "royal-600": "#8353C5",
      "royal-700": "#6B45A1",
      "status-positive": "#7AE870",
      "status-negative": "#FF4D5B",
      "status-partial": "#F3AF25",
      "highlight-700": "#E4FE53",
      "animation-bg": "#9E79D2",
      "animation-text": "#FBFBFD",
      "button-lg-primary-bg": "#9E79D2",
      "button-lg-primary-text": "#FBFBFD",
      "button-lg-secondary-bg": "#FBFBFD",
      "button-lg-secondary-text": "#292C32",
      "button-lg-tertiary-bg": "#292C32",
      "button-lg-tertiary-text": "#D1D6E0",
      "button-md-primary-bg": "#9E79D2",
      "button-md-primary-text": "#FBFBFD",
      "button-md-secondary-bg": "#FBFBFD",
      "button-md-secondary-text": "#292C32",
      "button-md-tertiary-bg": "#292C32",
      "button-md-tertiary-text": "#D1D6E0",
      "button-sm-primary-bg": "#9E79D2",
      "button-sm-primary-text": "#FBFBFD",
      "button-sm-secondary-bg": "#FBFBFD",
      "button-sm-secondary-text": "#292C32",
      "button-sm-tertiary-bg": "#292C32",
      "button-sm-tertiary-text": "#D1D6E0",
      "input-bg": "#17191C",
      "input-placeholder": "#676B7E",
      "input-text": "#D1D6E0",
      "input-selection": "#D1D6E0",
      "menu-bg": "#17191CA8",
      "menu-text": "#FBFBFDA8",
      "menu-backdrop": "#FBFBFD1A",
      "modal-backdrop": "#17191C54",
    },
  },
  themeType: "dark",
  apiUrl: "https://v2.api.squidrouter.com",
  tabs: {
    swap: true,
    buy: true,
    send: false,
  },
  priceImpactWarnings: {
    warning: 3,
    critical: 5,
  },
  initialAssets: {},
  loadPreviousStateFromLocalStorage: true,
};

/**
 * Build the iframe src URL.
 */
function buildIframeSrc(): string {
  const json = JSON.stringify(SQUID_WIDGET_CONFIG);
  return `https://studio.squidrouter.com/iframe?config=${encodeURIComponent(json)}`;
}

const SQUID_APP_URL = "https://app.squidrouter.com/";

/* ── Component ──────────────────────────────────────────────── */

export function SquidBridgeWidget({ onClose, isDark }: SquidBridgeWidgetProps) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const iframeSrc = buildIframeSrc();

  useEffect(() => {
    setIframeLoaded(false);
    setLoadError(false);

    loadTimerRef.current = setTimeout(() => {
      if (!iframeLoaded) {
        setLoadError(true);
      }
    }, 25_000);

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
                ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]"
                : loadError
                ? "bg-red-400"
                : "bg-purple-400 animate-pulse"
            }`}
          />
          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {iframeLoaded ? "Connected" : loadError ? "Error" : "Connecting..."}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Tip content="Open in new tab">
          <a
            href={SQUID_APP_URL}
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

      {/* ── Widget Container — uses Squid's own dark background ── */}
      <div
        className="relative w-full rounded-2xl overflow-hidden"
        style={{
          backgroundColor: "#17191C",
          height: "626px",
        }}
      >
        {/* Loading state */}
        <AnimatePresence>
          {!iframeLoaded && !loadError && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10"
              style={{ backgroundColor: "#17191C" }}
            >
              <div className="w-10 h-10 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
              <span className="text-sm text-slate-500">
                Loading Squid Bridge...
              </span>
            </div>
          )}
        </AnimatePresence>

        {/* Error state */}
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center z-10" style={{ backgroundColor: "#17191C" }}>
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <div>
              <h4 className="text-slate-200 mb-1">Widget Failed to Load</h4>
              <p className="text-sm text-slate-400 max-w-sm">
                Could not reach Squid Bridge. Try disabling your ad-blocker or open externally.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
              <a
                href={SQUID_APP_URL}
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
          title="Squid Bridge Widget"
          src={iframeSrc}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          allow="clipboard-write; clipboard-read"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-top-navigation-by-user-activation"
          scrolling="no"
          className="w-full border-0 overflow-hidden"
          style={{
            height: "626px",
            opacity: iframeLoaded && !loadError ? 1 : 0,
            transition: "opacity 0.4s ease",
            colorScheme: "dark",
            backgroundColor: "#17191C",
          }}
        />
      </div>

      {/* ── Subtle footer ── */}
      <div className={`mt-2 text-center text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>
        Powered by Squid Router & Axelar Network
      </div>
    </div>
  );
}
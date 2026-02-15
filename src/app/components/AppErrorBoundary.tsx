/**
 * AppErrorBoundary — Top-Level Catch-All Error Boundary
 *
 * Wraps the entire application. If any uncaught rendering error
 * bubbles up past all inner boundaries, this prevents a white screen
 * and shows a branded recovery UI.
 *
 * This differs from the route-level ErrorBoundary (inside Layout)
 * which only catches errors within <Outlet> (lazy route components).
 * AppErrorBoundary catches errors in ThemeProvider, WalletProvider,
 * DynamicContextProvider, Layout itself, etc.
 *
 * In production builds the raw error message is replaced with a
 * deterministic reference code (FNV-1a hash) to prevent information
 * disclosure of module paths, stack traces, or internal identifiers.
 */

import { Component, type ReactNode } from "react";
import { ENV } from "../utils/env";
import { log } from "../utils/logger";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Derive a short reference code from the error message (FNV-1a 32-bit).
 * Deterministic so the same error always produces the same code.
 */
function errorRefCode(msg: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < msg.length; i++) {
    h ^= msg.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "ERR-" + ((h >>> 0).toString(36).toUpperCase().padStart(7, "0"));
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    log.error("AppErrorBoundary", "Uncaught error in React tree", {
      error,
      componentStack: info.componentStack?.slice(0, 500) || "",
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const msg = this.state.error?.message || "An unexpected error occurred";
    const displayMsg = ENV.IS_DEV ? msg : `Reference: ${errorRefCode(msg)}`;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080a12",
          color: "#e2e8f0",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: "480px",
            width: "100%",
            background: "rgba(13,15,26,0.9)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "16px",
            padding: "32px",
            textAlign: "center",
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              margin: "0 auto 20px",
              borderRadius: "50%",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 8px" }}>
            Something Went Wrong
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "#94a3b8",
              margin: "0 0 20px",
              lineHeight: 1.5,
            }}
          >
            The application encountered an error. This is usually temporary.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                padding: "10px 24px",
                background: "rgba(255,255,255,0.06)",
                color: "white",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 24px",
                background: "linear-gradient(135deg, #ec4899, #9333ea)",
                color: "white",
                border: "none",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload Page
            </button>
          </div>
          <details
            style={{
              textAlign: "left",
              background: "rgba(0,0,0,0.3)",
              borderRadius: "8px",
              padding: "8px 12px",
              marginTop: "16px",
            }}
          >
            <summary
              style={{
                fontSize: "11px",
                color: "#64748b",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Error Details
            </summary>
            <pre
              style={{
                fontSize: "10px",
                color: "#f87171",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                margin: "8px 0 0",
                maxHeight: "120px",
                overflowY: "auto",
              }}
            >
              {displayMsg}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
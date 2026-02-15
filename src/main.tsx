import "./styles/index.css";

/**
 * Resilient entry point — uses dynamic import for App so that if ANY
 * dependency in the App module graph fails to load (Dynamic Labs SDK,
 * WalletConnect, Hashgraph SDK, etc.), we catch the error and show a
 * visible error UI instead of a white screen.
 *
 * Common causes of white screen on published sites:
 * - Third-party SDK module evaluation failure
 * - CSP restrictions blocking external fetches / iframes / wasm
 * - Missing or corrupt bundled chunks
 */

const rootEl = document.getElementById("root")!;

function showFatalError(error: unknown): void {
  const msg =
    error instanceof Error ? error.message : String(error || "Unknown error");
  const stack = error instanceof Error ? error.stack || "" : "";

  console.error("[HBAR.h] Fatal error during app initialization:", error);

  // In production, suppress raw error details (module paths, stack traces)
  // and show only a deterministic reference code. Dev builds retain full details.
  let detailsHtml: string;
  if (import.meta.env.DEV) {
    // Escape HTML entities to prevent XSS from error messages
    const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    detailsHtml = `${escape(msg)}\n\n${escape(stack.slice(0, 600))}`;
  } else {
    // FNV-1a 32-bit fingerprint — deterministic, leaks no internal paths
    let h = 0x811c9dc5;
    for (let i = 0; i < msg.length; i++) {
      h ^= msg.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    detailsHtml = `Reference: ERR-${(h >>> 0).toString(36).toUpperCase().padStart(7, "0")}`;
  }

  rootEl.innerHTML = `
    <div style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #080a12;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
      padding: 24px;
    ">
      <div style="
        max-width: 480px;
        width: 100%;
        background: rgba(13,15,26,0.9);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 16px;
        padding: 32px;
        text-align: center;
        backdrop-filter: blur(12px);
      ">
        <div style="
          width: 56px; height: 56px; margin: 0 auto 20px;
          border-radius: 50%;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          display: flex; align-items: center; justify-content: center;
          font-size: 28px;
        ">!</div>
        <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">
          Failed to Load
        </h1>
        <p style="font-size: 14px; color: #94a3b8; margin: 0 0 20px; line-height: 1.5;">
          The application encountered an error during startup.
          This is usually a temporary issue.
        </p>
        <button onclick="window.location.reload()" style="
          padding: 10px 24px;
          background: linear-gradient(135deg, #ec4899, #9333ea);
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          margin-bottom: 16px;
        ">
          Reload Page
        </button>
        <details style="
          text-align: left;
          background: rgba(0,0,0,0.3);
          border-radius: 8px;
          padding: 8px 12px;
          margin-top: 8px;
        ">
          <summary style="
            font-size: 11px;
            color: #64748b;
            cursor: pointer;
            font-weight: 600;
          ">Error Details</summary>
          <pre style="
            font-size: 10px;
            color: #f87171;
            white-space: pre-wrap;
            word-break: break-all;
            margin: 8px 0 0;
            max-height: 150px;
            overflow-y: auto;
          ">${detailsHtml}</pre>
        </details>
      </div>
    </div>
  `;
}

// ── Bootstrap with dynamic import ──────────────────────────────────
// Dynamic import means that if App.tsx or ANY of its transitive imports
// (Dynamic Labs SDK, WalletConnect, etc.) fail to load or evaluate,
// the error is caught here instead of silently killing the page.

async function bootstrap(): Promise<void> {
  const [{ StrictMode }, { createRoot }, { default: App }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./app/App"),
  ]);

  const root = createRoot(rootEl);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap().catch(showFatalError);

// Fallback: catch unhandled errors that happen after mount but leave
// the root empty (shouldn't happen with ErrorBoundary, but just in case)
window.addEventListener("error", (event) => {
  if (rootEl.children.length === 0 || rootEl.innerHTML.trim() === "") {
    showFatalError(event.error || event.message);
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (rootEl.children.length === 0 || rootEl.innerHTML.trim() === "") {
    showFatalError(event.reason);
  }
});
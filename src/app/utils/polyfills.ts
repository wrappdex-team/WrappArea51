/**
 * Browser polyfills for Node.js built-ins
 *
 * This file MUST be imported before any code that uses:
 * - @hashgraph/sdk (uses Buffer, process)
 * - @walletconnect/sign-client (uses Buffer for encoding)
 *
 * Also the SOLE location for console error suppression (project constraint).
 */

import { Buffer } from "buffer";

// Make Buffer available globally — many crypto libraries expect this
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as any).Buffer = Buffer;
}

if (typeof window !== "undefined" && typeof (window as any).Buffer === "undefined") {
  (window as any).Buffer = Buffer;
}

// Ensure process exists with at least env and browser properties
if (typeof globalThis.process === "undefined") {
  (globalThis as any).process = { env: {}, browser: true };
} else if (typeof globalThis.process.env === "undefined") {
  (globalThis as any).process.env = {};
}

// Stub process.emitWarning — WC / EventEmitter may call this
if (typeof (globalThis as any).process.emitWarning !== "function") {
  (globalThis as any).process.emitWarning = function (warning: any) {
    const msg = typeof warning === "string" ? warning : (warning?.message || "");
    if (msg.includes("MaxListeners") || msg.includes("memory leak") || msg.includes("EventEmitter")) {
      return; // Suppress
    }
    console.warn(warning);
  };
}

// Stub process.on / process.once / process.off — some WC internals call these
if (typeof (globalThis as any).process.on !== "function") {
  (globalThis as any).process.on = function () { return (globalThis as any).process; };
}
if (typeof (globalThis as any).process.once !== "function") {
  (globalThis as any).process.once = function () { return (globalThis as any).process; };
}
if (typeof (globalThis as any).process.off !== "function") {
  (globalThis as any).process.off = function () { return (globalThis as any).process; };
}
if (typeof (globalThis as any).process.removeListener !== "function") {
  (globalThis as any).process.removeListener = function () { return (globalThis as any).process; };
}

// Bump EventEmitter.defaultMaxListeners if available
try {
  if (typeof (globalThis as any).EventEmitter !== "undefined") {
    (globalThis as any).EventEmitter.defaultMaxListeners = 200;
  }
} catch { /* ignore */ }

// Ensure global === globalThis
if (typeof globalThis.global === "undefined") {
  (globalThis as any).global = globalThis;
}

// ── Console Patch: WalletConnect Error Suppression ──────────────────
//
// This is the SOLE location for all WC console suppression (project constraint).
// Patterns are specific enough to not match normal app logging.
// Vite/HMR messages are explicitly passed through.

const _SUPPRESS_PATTERNS = [
  "Proposal expired",
  "Approval error",
  "proposal_expire",
  "No matching key",
  "Record was recently deleted",
  "Missing or invalid",
  "WalletConnect Core is already initialized",
  "MaxListenersExceededWarning",
  "MaxListeners",
  "Possible EventEmitter memory leak",
  "Failed to publish payload",
  "WebSocket connection failed",
  "publish payload",
  "Publish request failed",
  "socket stalled",
  "iframe-widget not found",
  "session or pairing topic doesn't exist",
  "isValidSessionOrPairingTopic",
  "deleteSession",
  "onSessionDeleteRequest",
  "User rejected",
  "user rejected",
  "send was called before connect",
  "requiredNamespaces are deprecated",
  // WC metadata URL mismatch warning (harmless in sandboxed previews)
  "differs from the actual page url",
  "configured WalletConnect",
];

const _VITE_PASSTHROUGH = [
  "[vite]",
  "[hmr]",
  "Failed to fetch dynamically imported module",
];

function _buildArgString(args: any[]): string {
  let combined = "";
  for (let i = 0; i < Math.min(args.length, 8); i++) {
    const a = args[i];
    if (typeof a === "string") combined += " " + a;
    else if (a instanceof Error) combined += " " + a.message;
    else if (a && typeof a === "object") {
      if (typeof a.message === "string") combined += " " + a.message;
      if (typeof a.msg === "string") combined += " " + a.msg;
      if (typeof a.context === "string") combined += " " + a.context;
    }
  }
  return combined;
}

function _isSuppressed(args: any[]): boolean {
  if (args.length === 0) return false;
  const combined = _buildArgString(args);
  for (const v of _VITE_PASSTHROUGH) {
    if (combined.includes(v)) return false;
  }
  for (const p of _SUPPRESS_PATTERNS) {
    if (combined.includes(p)) return true;
  }
  return false;
}

if (typeof window !== "undefined" && typeof console !== "undefined") {
  const _origLog = console.log;
  const _origWarn = console.warn;
  const _origError = console.error;

  console.log = function (...args: any[]) {
    if (_isSuppressed(args)) return;
    _origLog.apply(console, args);
  };

  console.warn = function (...args: any[]) {
    if (_isSuppressed(args)) return;
    _origWarn.apply(console, args);
  };

  console.error = function (...args: any[]) {
    if (_isSuppressed(args)) return;
    _origError.apply(console, args);
  };
}

// ── Global WC Error Handlers ────────────────────────────────────────

const _WC_ERROR_PATTERNS = [
  "Missing or invalid. Record was recently deleted",
  "No matching key",
  "Proposal expired",
  "Approval error",
  "proposal_expire",
  "WalletConnect Core is already initialized",
  "Failed to publish payload",
  "WebSocket connection failed",
  "socket stalled",
  "MaxListenersExceededWarning",
  "session or pairing topic doesn't exist",
  "deleteSession",
  "User rejected",
  "user rejected",
  "send was called before connect",
  "requiredNamespaces are deprecated",
];

const _WC_STACK_MARKERS = [
  "onSessionDeleteRequest",
  "isValidSessionOrPairingTopic",
  "deleteSession",
  "processRequest",
  "rpcPublish",
  "updateMetadata",
];

function _isWCError(msg: string, stack?: string): boolean {
  if (!msg) return false;
  for (const v of _VITE_PASSTHROUGH) {
    if (msg.includes(v)) return false;
  }
  for (const p of _WC_ERROR_PATTERNS) {
    if (msg.includes(p)) return true;
  }
  if (stack) {
    for (const m of _WC_STACK_MARKERS) {
      if (stack.includes(m)) return true;
    }
  }
  return false;
}

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason;
      const msg = typeof reason === "string" ? reason : (reason?.message || String(reason || ""));
      const stack = reason?.stack || "";
      if (_isWCError(msg, stack)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    } catch { /* let original propagate */ }
  }, true);

  window.addEventListener("error", (event: ErrorEvent) => {
    try {
      const msg = event.message || event.error?.message || "";
      const stack = event.error?.stack || "";
      if (_isWCError(msg, stack)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    } catch { /* let original propagate */ }
  }, true);

}
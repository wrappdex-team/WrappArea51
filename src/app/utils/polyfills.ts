/**
 * Browser polyfills for Node.js built-ins
 *
 * This file MUST be imported before any code that uses:
 * - @hashgraph/sdk (uses Buffer, process)
 * - hashconnect (uses Buffer via @hashgraph/sdk and WalletConnect)
 * - @walletconnect/sign-client (uses Buffer for encoding)
 * - web3 (uses Buffer for transaction encoding)
 *
 * Vite externalizes Node.js built-in modules (buffer, process, etc.)
 * for browser compatibility. This polyfill provides browser-compatible
 * replacements via the `buffer` and `process` npm packages.
 */

import { Buffer } from "buffer";

// Make Buffer available globally — many crypto libraries expect this
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as any).Buffer = Buffer;
}

// Also set on window for maximum compatibility
if (typeof window !== "undefined" && typeof (window as any).Buffer === "undefined") {
  (window as any).Buffer = Buffer;
}

// Ensure process exists with at least env and browser properties
if (typeof globalThis.process === "undefined") {
  (globalThis as any).process = { env: {}, browser: true };
} else if (typeof globalThis.process.env === "undefined") {
  (globalThis as any).process.env = {};
}

// ── Stub process.emitWarning ──
// WalletConnect / EventEmitter2 may call process.emitWarning() to emit
// MaxListenersExceededWarning. In the browser our process polyfill doesn't
// have this method, so the call would throw. We add a no-op that also
// checks for our suppressed patterns so the warning never surfaces.
if (typeof (globalThis as any).process.emitWarning !== "function") {
  (globalThis as any).process.emitWarning = function (warning: any, ..._args: any[]) {
    // Check if this is a MaxListeners warning we want to suppress
    const msg = typeof warning === "string" ? warning : (warning?.message || "");
    if (
      msg.includes("MaxListeners") ||
      msg.includes("memory leak") ||
      msg.includes("EventEmitter")
    ) {
      return; // Suppress
    }
    // For any other process warning, log it as a console.warn
    // (which itself goes through our early filter)
    console.warn(warning);
  };
}

// ── Stub process.on / process.once ──
// Some WC internals call process.on('warning', ...) to handle warnings.
// Our minimal process polyfill doesn't have an event emitter interface.
// Add no-op stubs so these calls don't throw.
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

// ── Suppress MaxListenersExceededWarning at the process level ──
// Some EventEmitter implementations (events, eventemitter2, eventemitter3)
// call process.emitWarning() or fire a 'warning' event on process when
// the listener count exceeds the threshold. Our process polyfill already
// has a no-op emitWarning, but we also need to handle the 'warning' event
// pattern used by Node-compatible EventEmitter polyfills.
// Additionally, set a global defaultMaxListeners if the events module
// exports one — this prevents the warning from being generated in the first place.
try {
  // Attempt to find and bump EventEmitter.defaultMaxListeners from the
  // events polyfill that WC/HC's dependency tree includes
  if (typeof (globalThis as any).EventEmitter !== "undefined") {
    (globalThis as any).EventEmitter.defaultMaxListeners = 200;
  }
} catch { /* ignore */ }

// Ensure global === globalThis for packages that reference `global`
if (typeof globalThis.global === "undefined") {
  (globalThis as any).global = globalThis;
}

// ── Early Console Patch: HashConnect / WalletConnect Error Suppression ──
//
// HashConnect's bundled code captures references to console.log at module
// evaluation time (e.g., `const log = console.log.bind(console)`). Our later
// patch in hashpack.ts (installWCInitWarningFilter) replaces console.log AFTER
// the HashConnect module has already cached the original. This means the
// cached reference bypasses all our filtering.
//
// By patching HERE — the very first module loaded in the entire app —
// HashConnect's module evaluation will capture our already-patched console.log.
// Even cached references point to the filtered version.
//
// SAFETY:
// - Vite's HMR client is injected BEFORE any app modules evaluate, so its
//   WebSocket and console usage is already set up by the time we get here.
// - We explicitly pass through Vite/HMR messages to avoid interfering with
//   hot module replacement.
// - console.log, console.warn, and console.error ALL use the same broad
//   pattern matching. The patterns are specific enough ("Proposal expired",
//   "Approval error", etc.) that they won't match normal application logging.
//   Previous versions restricted console.log to hashconnect-prefixed messages
//   only, but WC's own internal code paths log errors WITHOUT that prefix,
//   causing the "Proposal expired" error to leak through.

const _EARLY_SUPPRESS_PATTERNS = [
  "Proposal expired",
  "Approval error",
  "No matching key",
  "Record was recently deleted",
  "Missing or invalid",
  "WalletConnect Core is already initialized",
  "MaxListenersExceededWarning",
  "MaxListeners",
  "Possible EventEmitter memory leak",
  "session_connect listeners",
  "proposal_expire listeners",
  "Failed to publish payload",
  "WebSocket connection failed",
  "publish payload",
  "Publish request failed",
  "socket stalled",
  "iframe-widget not found",
  "emitting session_connect",
  "session or pairing topic doesn't exist",
  "isValidSessionOrPairingTopic",
  "deleteSession",
  "onSessionDeleteRequest",
  "User rejected",
  "user rejected",
];

const _EARLY_VITE_PASSTHROUGH = [
  "[vite]",
  "[hmr]",
  "send was called before connect",
  "Failed to fetch dynamically imported module",
];

/**
 * Build a combined string from console arguments for pattern matching.
 * Handles strings, Error objects, and objects with a .message property.
 * Also detects WalletConnect's Pino-structured log objects (with context/level).
 */
function _buildArgString(args: any[]): string {
  let combined = "";
  for (let i = 0; i < Math.min(args.length, 8); i++) {
    const a = args[i];
    if (typeof a === "string") {
      combined += " " + a;
    } else if (a instanceof Error) {
      combined += " " + a.message;
    } else if (a && typeof a === "object") {
      if (typeof a.message === "string") combined += " " + a.message;
      if (typeof a.msg === "string") combined += " " + a.msg;
      if (typeof a.context === "string") combined += " " + a.context;
      if (a.reason) {
        if (typeof a.reason === "string") combined += " " + a.reason;
        else if (typeof a.reason.message === "string") combined += " " + a.reason.message;
      }
    }
  }
  return combined;
}

/**
 * Known WalletConnect Pino logger contexts that are non-actionable noise.
 * If ANY argument has a `context` property matching one of these, suppress.
 */
const _WC_PINO_CONTEXTS = [
  "core/publisher",
  "core/relayer",
  "core",
  "client",
];

/**
 * Check if any argument is a WC Pino structured log object from a noisy context.
 * WC's Pino logger emits objects like {time, level, context} as the first arg
 * with the error message as a subsequent string arg.
 */
function _hasWCPinoContext(args: any[]): boolean {
  for (let i = 0; i < Math.min(args.length, 4); i++) {
    const a = args[i];
    if (a && typeof a === "object" && typeof a.context === "string") {
      // Check if this is a known WC internal context AND it's an error-level log
      // Pino level 50 = error, 40 = warn. We suppress both for known contexts.
      if (_WC_PINO_CONTEXTS.includes(a.context) && typeof a.level === "number" && a.level >= 40) {
        return true;
      }
      // Also suppress if context matches and there's an error string/object in later args
      if (_WC_PINO_CONTEXTS.includes(a.context)) {
        for (let j = i + 1; j < Math.min(args.length, 6); j++) {
          const b = args[j];
          const s = typeof b === "string" ? b : (b instanceof Error ? b.message : "");
          if (s && (_EARLY_SUPPRESS_PATTERNS.some(p => s.includes(p)))) {
            return true;
          }
          // Check if subsequent arg is an Error with a WC-internal stack trace.
          // E.g., TypeError from accessing .proposer on undefined after session deletion.
          if (b instanceof Error && b.stack) {
            const st = b.stack;
            if (
              st.includes("onSessionDeleteRequest") ||
              st.includes("deleteSession") ||
              st.includes("isValidSessionOrPairingTopic") ||
              st.includes("processRequest") ||
              st.includes("hashconnect.js")
            ) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * Check if console.warn/error args match WC/HC suppressed patterns.
 * Any matching pattern suppresses the message.
 */
function _isEarlySuppressedWarnError(args: any[]): boolean {
  if (args.length === 0) return false;
  const combined = _buildArgString(args);
  // Never suppress Vite/HMR messages
  for (const v of _EARLY_VITE_PASSTHROUGH) {
    if (combined.includes(v)) return false;
  }
  for (const p of _EARLY_SUPPRESS_PATTERNS) {
    if (combined.includes(p)) return true;
  }
  return _hasWCPinoContext(args);
}

/**
 * Check if console.log args match WC/HC error patterns.
 *
 * UPDATED: Now uses the SAME broad pattern matching as warn/error.
 * The previous version only checked "hashconnect"-prefixed messages,
 * but WalletConnect's internal code (SignClient engine, Pairing, Core)
 * logs errors via console.log WITHOUT the "hashconnect" prefix. For
 * example, WC's SignClient engine logs "Proposal expired" directly
 * when a proposal times out. The suppression patterns are specific
 * enough that false positives with normal app logging are not a concern.
 */
function _isEarlySuppressedLog(args: any[]): boolean {
  if (args.length === 0) return false;
  const combined = _buildArgString(args);
  // Never suppress Vite/HMR messages
  for (const v of _EARLY_VITE_PASSTHROUGH) {
    if (combined.includes(v)) return false;
  }
  for (const p of _EARLY_SUPPRESS_PATTERNS) {
    if (combined.includes(p)) return true;
  }
  // Also check stringified first arg for deeply nested error objects
  // that _buildArgString might miss (e.g., {context: "...", error: {message: "..."}})
  const first = args[0];
  if (first && typeof first === "object") {
    try {
      const json = JSON.stringify(first).slice(0, 500);
      for (const p of _EARLY_SUPPRESS_PATTERNS) {
        if (json.includes(p)) return true;
      }
    } catch { /* circular object — ignore */ }
  }
  return _hasWCPinoContext(args);
}

if (typeof window !== "undefined" && typeof console !== "undefined") {
  const _earlyOrigLog = console.log;
  const _earlyOrigWarn = console.warn;
  const _earlyOrigError = console.error;

  console.log = function (...args: any[]) {
    if (_isEarlySuppressedLog(args)) return;
    _earlyOrigLog.apply(console, args);
  };

  console.warn = function (...args: any[]) {
    if (_isEarlySuppressedWarnError(args)) return;
    _earlyOrigWarn.apply(console, args);
  };

  console.error = function (...args: any[]) {
    if (_isEarlySuppressedWarnError(args)) return;
    _earlyOrigError.apply(console, args);
  };
}

// ── WalletConnect Error Suppression ──
// WalletConnect Core throws async errors from internal EventEmitter callbacks
// (e.g., "Missing or invalid. Record was recently deleted - pairing: ...")
// and "Proposal expired" / "No matching key" errors when proposals timeout.
// These are non-fatal WC internal bookkeeping errors that cannot be caught
// with try/catch because they originate inside WC's EventEmitter dispatch.
// We install global handlers HERE (the very first module loaded) to ensure
// they are in place before any WC code runs.
//
// SAFETY: These handlers must NOT interfere with Vite's own error handling.
// We explicitly check for Vite-related error messages and let them through.
const _WC_SUPPRESSED_PATTERNS = [
  "Missing or invalid. Record was recently deleted",
  "No matching key",
  "Proposal expired",
  "Approval error",
  "WalletConnect Core is already initialized",
  "Failed to publish payload",
  "WebSocket connection failed",
  "publish payload",
  "Publish request failed",
  "socket stalled",
  "MaxListenersExceededWarning",
  "Possible EventEmitter memory leak",
  "session_connect listeners",
  "emitting session_connect",
  "session or pairing topic doesn't exist",
  "isValidSessionOrPairingTopic",
  "deleteSession",
  "onSessionDeleteRequest",
  "User rejected",
  "user rejected",
];

// Patterns from Vite / HMR that must NEVER be suppressed
const _VITE_PASSTHROUGH_PATTERNS = [
  "send was called before connect",
  "[vite]",
  "[hmr]",
  "Failed to fetch dynamically imported module",
];

/**
 * WC engine methods whose presence in a stack trace indicates
 * the error originated from WC's internal session/pairing management.
 * If a generic TypeError comes from one of these, it's safe to suppress.
 */
const _WC_STACK_MARKERS = [
  "onSessionDeleteRequest",
  "isValidSessionOrPairingTopic",
  "isValidDisconnect",
  "deleteSession",
  "processRequest",
  "processRequestsQueue",
  "onRelayEventRequest",
  "rpcPublish",
  "getData",
  "hashconnect.js",
];

function _isWCSuppressedError(msg: string, stack?: string): boolean {
  if (!msg) return false;
  // Never suppress Vite / HMR errors — let them propagate for proper dev UX
  for (const vp of _VITE_PASSTHROUGH_PATTERNS) {
    if (msg.includes(vp)) return false;
  }
  for (const pattern of _WC_SUPPRESSED_PATTERNS) {
    if (msg.includes(pattern)) return true;
  }
  // For generic TypeErrors (e.g., Cannot read properties of undefined),
  // check if the stack trace originates from WC internals.
  if (stack && (msg.includes("Cannot read properties of undefined") || msg.includes("TypeError"))) {
    for (const marker of _WC_STACK_MARKERS) {
      if (stack.includes(marker)) return true;
    }
  }
  return false;
}

if (typeof window !== "undefined") {
  // Catch unhandled promise rejections from WC async internals
  // Use capture phase to intercept before any framework error overlays.
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    // SAFETY: wrap in try-catch to prevent this handler itself from causing
    // cascading errors during Vite's module evaluation phase
    try {
      const reason = event.reason;
      const msg = typeof reason === "string"
        ? reason
        : (reason?.message || String(reason || ""));
      const stack = reason?.stack || "";
      if (_isWCSuppressedError(msg, stack)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    } catch {
      // Let the original error propagate
    }
  }, true);

  // Catch synchronous errors from WC EventEmitter callbacks
  // Use capture phase to intercept before Vite's error overlay or
  // any framework error boundary can display the error.
  window.addEventListener("error", (event: ErrorEvent) => {
    try {
      const msg = event.message || event.error?.message || "";
      const stack = event.error?.stack || "";
      if (_isWCSuppressedError(msg, stack)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    } catch {
      // Let the original error propagate
    }
  }, true);
}
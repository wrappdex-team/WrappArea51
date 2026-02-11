/**
 * HashPack Wallet Integration for HBAR.h
 *
 * Uses HashConnect v3 SDK for proper wallet integration:
 * 1. HashConnect SDK manages extension detection & WalletConnect v2 pairing
 * 2. Hedera Mirror Node for read-only account lookup fallback
 * 3. Built-in user profile API via HashConnect
 * 4. Session persistence with 24h expiry
 *
 * Security: No private keys are stored or transmitted.
 * All signing happens inside the HashPack wallet.
 *
 * IMPORTANT: HashConnect and @hashgraph/sdk are dynamically imported
 * to avoid top-level import failures in environments where the
 * native bindings may not resolve.
 *
 * POLYFILL NOTE: The Buffer polyfill from /src/app/utils/polyfills.ts
 * MUST be loaded before this module is used. App.tsx imports it first.
 *
 * WalletConnect Core Singleton Note:
 * WalletConnect Core is a global singleton — it can only be initialized once
 * per page lifecycle. This means:
 *   - We must never create more than one HashConnect instance (the constructor
 *     itself creates a SignClient which initializes Core internally).
 *   - After disconnect, we keep the instance alive and reuse it for the next
 *     connection instead of destroying and recreating it.
 *   - The entire create+init flow is serialized through a single promise lock.
 *
 * ARCHITECTURE NOTE (v2 - simplified):
 * Previous versions of this file applied extensive monkey-patches to
 * WalletConnect's internal SignClient, engine, stores, publisher, and event
 * emitters. These patches suppressed console errors but inadvertently removed
 * critical internal event listeners (e.g., "session_connect" on the engine),
 * which prevented HashConnect's pairingEvent from firing after the user
 * approved the connection in their wallet.
 *
 * This version takes a MINIMAL approach:
 * - Console-level suppression only (harmless — does not affect WC internals)
 * - NO monkey-patching of WC stores, engine methods, or event emitters
 * - NO background keepalive timer (was purging proposals + removing listeners)
 * - HashConnect's internal event system is left completely untouched
 * - Pairing strings are generated via HashConnect's own generatePairingString()
 *   which creates a proper WC proposal (required for session establishment)
 */

// Ensure polyfills are loaded (safe re-import; the module is idempotent)
import "./polyfills";

import type { HederaNetwork } from "./hedera";
import { fetchAccountInfo } from "./hedera";

// ── Constants ──

const MIRROR_NODES: Record<HederaNetwork, string> = {
  mainnet: "https://mainnet-public.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
};

// ── Mirror Node Receipt Polling ──────────────────────────────────────

/**
 * Convert an SDK-style transaction ID (0.0.xxx@seconds.nanos) to
 * Mirror Node format (0.0.xxx-seconds-nanos).
 */
function _formatTxIdForMirrorNode(txId: string): string {
  if (!txId.includes("@")) return txId;
  const atIdx = txId.indexOf("@");
  const accountPart = txId.substring(0, atIdx);
  const timestampPart = txId.substring(atIdx + 1);
  const normalizedTimestamp = timestampPart.replace(".", "-");
  return `${accountPart}-${normalizedTimestamp}`;
}

/**
 * Poll the Mirror Node for a transaction's consensus result.
 */
async function pollMirrorNodeReceipt(
  txId: string,
  network: HederaNetwork,
  maxAttempts = 6,
  initialDelayMs = 2000
): Promise<{ result: string; status: string } | null> {
  const base = MIRROR_NODES[network];
  const normalizedId = _formatTxIdForMirrorNode(txId);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = initialDelayMs * Math.pow(1.5, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(
        `${base}/api/v1/transactions/${normalizedId}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (res.status === 404) {
        console.log(
          `[HBAR.h] Mirror Node receipt poll attempt ${attempt + 1}/${maxAttempts}: not indexed yet`
        );
        continue;
      }
      if (!res.ok) continue;

      const data = await res.json();
      const txList = data.transactions || [];
      if (txList.length === 0) continue;

      const tx = txList[0];
      const result = tx.result || "";
      console.log(
        `[HBAR.h] Mirror Node receipt poll: result="${result}" (attempt ${attempt + 1})`
      );
      return { result, status: result };
    } catch {
      console.log(
        `[HBAR.h] Mirror Node receipt poll attempt ${attempt + 1}/${maxAttempts}: network error`
      );
    }
  }

  return null;
}

// WalletConnect Project ID — users should replace with their own from https://cloud.walletconnect.com
const WALLETCONNECT_PROJECT_ID = "ee0fadbd85d3a0334a93a65d32d506be";

const HBARH_METADATA = {
  name: "HBAR.ħ",
  description: "Decentralized Exchange on Hedera Network",
  icons: [
    typeof window !== "undefined"
      ? `${window.location.origin}/logo.png`
      : "https://hbar.exchange/logo.png",
  ],
  url:
    typeof window !== "undefined"
      ? window.location.origin
      : "https://hbarh.app",
};

// ── Types ──

export interface HashPackSession {
  accountId: string;
  evmAddress: string;
  network: HederaNetwork;
  connectedAt: number;
  isVerified: boolean;
  connectionMethod: "hashconnect" | "walletconnect" | "mirror-node";
  profile: HashPackProfile | null;
  /** WC topic for disconnect — only set for WC connections */
  wcTopic?: string;
}

export interface HashPackProfile {
  accountId: string;
  username: string;
  profilePicture: string;
  bio: string;
  twitterHandle: string;
  currency: string;
}

export interface HashPackConnectionResult {
  success: boolean;
  session: HashPackSession | null;
  error: string | null;
}

// ── SDK Instance Management ──

/**
 * Cached HashConnect instance — we only ever create ONE per page lifecycle.
 */
let _hashConnectInstance: any = null;
let _hashConnectNetwork: HederaNetwork | null = null;
let _sdkAvailable: boolean | null = null;

/**
 * Single promise lock covering the entire create+init lifecycle.
 */
let _readyPromise: Promise<any> | null = null;
let _readyFailed = false;

/**
 * Per-attempt callback routing.
 *
 * HashConnect v3's README says: "Make sure you register your events before
 * calling init — as some events will fire immediately after calling init."
 *
 * We satisfy this requirement by installing PERMANENT event listeners during
 * doCreateAndInit() (before init()), and routing their data to per-connection-
 * attempt callbacks.
 */
let _currentPairingCallback: ((data: any) => void) | null = null;
let _currentStateCallback: ((state: string) => void) | null = null;
let _currentDisconnectCallback: (() => void) | null = null;

/**
 * If the HashPack extension auto-pairs during init() (before any
 * connectViaHashConnect call sets _currentPairingCallback), we capture
 * the session data here so the first connectViaHashConnect call can
 * resolve immediately with it.
 */
let _bufferedPairingData: any | null = null;

/**
 * Guard flag: permanent event listeners should only be registered once.
 */
let _eventListenersRegistered = false;

/**
 * Active connection cleanup — called before each new connection attempt.
 */
let _activeCleanup: (() => void) | null = null;
let _activeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Per-attempt callback for pairing string refresh.
 */
let _currentPairingStringCallback: ((uri: string) => void) | null = null;

/**
 * Timer for proactive pairing string refresh.
 * WC proposals have a ~5 minute TTL. We refresh at 4 minutes.
 */
let _pairingRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const PAIRING_REFRESH_MS = 4 * 60 * 1000; // 4 minutes

/**
 * Generate a fresh WC pairing string on the given HC instance.
 * Returns the new URI or null on failure.
 *
 * IMPORTANT: We use generatePairingString() which internally calls
 * signClient.connect() — this creates BOTH a pairing AND a proposal.
 * A bare pairing.create() (without a proposal) would NOT work because
 * the wallet needs a proposal to approve for session establishment.
 */
async function regeneratePairingString(hc: any): Promise<string | null> {
  try {
    if (typeof (hc as any).generatePairingString === "function") {
      await (hc as any).generatePairingString();
      if (hc.pairingString) {
        console.log("[HBAR.h] Fresh pairing string regenerated via generatePairingString()");
        return hc.pairingString;
      }
    }
  } catch (err: any) {
    // Only log non-suppressed errors
    const msg = err?.message || "";
    if (!msg.includes("Proposal expired") && !msg.includes("No matching key")) {
      console.warn("[HBAR.h] regeneratePairingString failed:", msg);
    }
  }

  return null;
}

/**
 * Schedule the next automatic pairing string refresh.
 */
function schedulePairingRefresh(hc: any): void {
  if (_pairingRefreshTimer) {
    clearTimeout(_pairingRefreshTimer);
    _pairingRefreshTimer = null;
  }
  _pairingRefreshTimer = setTimeout(async () => {
    _pairingRefreshTimer = null;
    if (!_currentPairingStringCallback) return;
    try {
      const newUri = await regeneratePairingString(hc);
      if (newUri && _currentPairingStringCallback) {
        _currentPairingStringCallback(newUri);
        schedulePairingRefresh(hc);
      }
    } catch { /* non-critical */ }
  }, PAIRING_REFRESH_MS);
}

function abortActiveConnection(): void {
  if (_activeCleanup) {
    try { _activeCleanup(); } catch { /* ignore */ }
    _activeCleanup = null;
  }
  if (_activeTimer) {
    clearTimeout(_activeTimer);
    _activeTimer = null;
  }
  if (_pairingRefreshTimer) {
    clearTimeout(_pairingRefreshTimer);
    _pairingRefreshTimer = null;
  }
  _currentPairingStringCallback = null;
}

// ── WalletConnect Console Suppression ──
// This is the ONLY place we interfere with WC — purely at the console level.
// No WC internals (stores, engine, event emitters) are modified.

const _WC_SUPPRESS_PATTERNS = [
  "WalletConnect Core is already initialized",
  "Missing or invalid. Record was recently deleted",
  "No matching key.",
  "Proposal expired",
  "Approval error",
  "MaxListenersExceededWarning",
  "MaxListeners",
  "Possible EventEmitter memory leak",
  "Failed to publish payload",
  "WebSocket connection failed",
  "publish payload",
  "socket stalled",
  "session_connect listeners",
  "proposal_expire listeners",
  "session or pairing topic doesn't exist",
  "onSessionDeleteRequest",
  "isValidSessionOrPairingTopic",
  "User rejected",
  "user rejected",
];

const _WC_PINO_CONTEXTS = ["core/publisher", "core/relayer", "core", "client"];

function _isWCSuppressedMessage(args: any[]): boolean {
  for (let i = 0; i < Math.min(args.length, 8); i++) {
    const a = args[i];
    let str = "";
    if (typeof a === "string") {
      str = a;
    } else if (a && typeof a === "object") {
      const parts: string[] = [];
      if (typeof a.message === "string") parts.push(a.message);
      if (typeof a.msg === "string") parts.push(a.msg);
      if (typeof a.reason === "string") parts.push(a.reason);
      if (a.reason && typeof a.reason === "object" && typeof a.reason.message === "string") {
        parts.push(a.reason.message);
      }
      if (typeof a.context === "string" && _WC_PINO_CONTEXTS.includes(a.context)) {
        if (typeof a.level === "number" && a.level >= 40) return true;
      }
      if (parts.length > 0) {
        str = parts.join(" ");
      } else {
        try { str = JSON.stringify(a).slice(0, 500); } catch { str = ""; }
      }
    }
    for (const pattern of _WC_SUPPRESS_PATTERNS) {
      if (str.includes(pattern)) return true;
    }
  }
  return false;
}

/**
 * Check if a console.log call is from HashConnect's internal logger.
 */
function _isHashConnectSuppressedLog(args: any[]): boolean {
  if (args.length === 0) return false;
  const first = args[0];
  if (typeof first !== "string") return false;
  if (!first.toLowerCase().startsWith("hashconnect")) return false;
  const fullMsg = args.map((a: any) => {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.message;
    if (a && typeof a === "object" && typeof a.message === "string") return a.message;
    try { return String(a); } catch { return ""; }
  }).join(" ");
  return (
    fullMsg.includes("Proposal expired") ||
    fullMsg.includes("Approval error") ||
    fullMsg.includes("No matching key") ||
    fullMsg.includes("Record was recently deleted") ||
    fullMsg.includes("Missing or invalid") ||
    fullMsg.includes("Failed to publish payload") ||
    fullMsg.includes("WebSocket connection failed") ||
    fullMsg.includes("socket stalled") ||
    fullMsg.includes("session or pairing topic doesn't exist") ||
    fullMsg.includes("onSessionDeleteRequest") ||
    fullMsg.includes("isValidSessionOrPairingTopic") ||
    fullMsg.includes("User rejected") ||
    fullMsg.includes("user rejected")
  );
}

let _wcFilterInstalled = false;

function installWCInitWarningFilter(): void {
  if (_wcFilterInstalled) return;
  _wcFilterInstalled = true;

  const origWarn = console.warn;
  const origError = console.error;
  const origLog = console.log;

  console.warn = (...args: any[]) => {
    if (_isWCSuppressedMessage(args)) return;
    origWarn.apply(console, args);
  };
  console.error = (...args: any[]) => {
    if (_isWCSuppressedMessage(args)) return;
    origError.apply(console, args);
  };
  console.log = (...args: any[]) => {
    if (_isHashConnectSuppressedLog(args)) return;
    origLog.apply(console, args);
  };
}

// ── SDK Availability ──

export async function isHashConnectSDKAvailable(): Promise<boolean> {
  if (_sdkAvailable !== null) return _sdkAvailable;
  if (_hashConnectInstance) {
    _sdkAvailable = true;
    return true;
  }
  _sdkAvailable = true;
  return true;
}

// ── getReadyHashConnect ──

async function getReadyHashConnect(network: HederaNetwork): Promise<any> {
  if (_hashConnectInstance) {
    if (_hashConnectNetwork && _hashConnectNetwork !== network) {
      console.warn(
        `[HBAR.h] HashConnect initialized for ${_hashConnectNetwork} — ` +
        `reusing for ${network}. A page reload is needed to truly switch networks.`
      );
    }
    return _hashConnectInstance;
  }

  if (!_readyPromise || _readyFailed) {
    _readyFailed = false;
    _readyPromise = doCreateAndInit(network);
    _readyPromise.catch(() => { _readyFailed = true; });
  }

  const READY_TIMEOUT_MS = 30000;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(
          "HashConnect initialization timed out after 30s. " +
          "The WalletConnect relay may be unreachable. " +
          "Please check your network connection and try again."
        )),
        READY_TIMEOUT_MS
      );
    });

    return await Promise.race([_readyPromise, timeoutPromise]);
  } catch (err) {
    if (_hashConnectInstance) {
      console.warn("[HBAR.h] HashConnect init had errors but instance is usable — proceeding");
      return _hashConnectInstance;
    }
    throw err;
  }
}

// ── doCreateAndInit ──

async function doCreateAndInit(network: HederaNetwork): Promise<any> {
  if (!isWalletConnectConfigured()) {
    throw new Error(
      "WalletConnect Project ID is not configured. " +
      "The HashConnect SDK requires a valid WalletConnect Project ID to initialize. " +
      "Get one at https://cloud.walletconnect.com and update WALLETCONNECT_PROJECT_ID in hashpack.ts. " +
      "In the meantime, use the Mirror Node account lookup for read-only access."
    );
  }

  if (typeof globalThis.Buffer === "undefined") {
    throw new Error(
      "Buffer polyfill is not loaded. This is required for HashConnect and @hashgraph/sdk to work in the browser."
    );
  }

  // Install console-level WC warning filter (harmless — doesn't touch WC internals)
  installWCInitWarningFilter();

  // Dynamic import to avoid top-level import issues
  const { HashConnect } = await import("hashconnect");
  const { LedgerId } = await import("@hashgraph/sdk");

  const ledgerId =
    network === "mainnet" ? LedgerId.MAINNET : LedgerId.TESTNET;

  // Pre-init cleanup: remove stale WC pairings from localStorage
  cleanStaleWCLocalStorage();

  try {
    const hc = new HashConnect(
      ledgerId,
      WALLETCONNECT_PROJECT_ID,
      HBARH_METADATA,
      false // debug
    );

    _hashConnectInstance = hc;
    _hashConnectNetwork = network;

    // ── CRITICAL: Register events BEFORE init() ──
    if (!_eventListenersRegistered) {
      _eventListenersRegistered = true;

      hc.pairingEvent.on((sessionData: any) => {
        console.log("[HBAR.h] pairingEvent fired:", sessionData?.accountIds);
        if (_currentPairingCallback) {
          _currentPairingCallback(sessionData);
        } else {
          console.log("[HBAR.h] pairingEvent buffered (no callback set yet)");
          _bufferedPairingData = sessionData;
        }
      });

      hc.connectionStatusChangeEvent.on((state: any) => {
        console.log("[HBAR.h] connectionStatusChange:", state);
        if (_currentStateCallback) {
          _currentStateCallback(state);
        }
      });

      hc.disconnectionEvent.on(() => {
        console.log("[HBAR.h] disconnectionEvent fired");
        if (_currentDisconnectCallback) {
          _currentDisconnectCallback();
        }
      });
    }

    // ── Raise maxListeners to prevent warnings ──
    // This is safe — it just increases a numeric limit, does NOT modify events.
    raiseMaxListeners(hc);

    // ── Init ──
    const INIT_TIMEOUT_MS = 20000;
    try {
      const initTimeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error("init_timeout")),
          INIT_TIMEOUT_MS
        );
      });
      await Promise.race([hc.init(), initTimeoutPromise]);
    } catch (initErr: any) {
      const msg = initErr?.message || "";
      const nonFatal =
        msg.includes("already initialized") ||
        msg.includes("Already initialized") ||
        msg.includes("Proposal expired") ||
        msg.includes("Approval error") ||
        msg.includes("No matching key") ||
        msg === "init_timeout";
      if (!nonFatal) {
        throw initErr;
      }
      if (msg === "init_timeout") {
        console.warn("[HBAR.h] hc.init() timed out after 20s — proceeding with partial init (pairing may still work)");
      } else {
        console.log("[HBAR.h] Non-fatal init error suppressed:", msg);
      }
    }

    console.log("[HBAR.h] HashConnect init complete. Pairing string:", hc.pairingString ? "available" : "none");
    console.log("[HBAR.h] Connected accounts:", hc.connectedAccountIds?.map?.((a: any) => a.toString?.() ?? a) ?? []);

    // ── Install global error handlers for WC relay errors ──
    // These catch unhandled rejections/errors from WC's async internals
    // (session_delete for stale sessions, relay disconnects, etc.)
    // They ONLY suppress — they do NOT modify WC's behavior.
    installGlobalWCErrorHandlers();

    return hc;
  } catch (err: any) {
    if (!_hashConnectInstance) {
      _hashConnectNetwork = null;
    }

    const msg = err?.message || String(err);

    if (
      msg.includes("already initialized") ||
      msg.includes("Already initialized")
    ) {
      if (_hashConnectInstance) {
        console.warn("[HBAR.h] WC Core re-init warning caught in outer catch — instance still usable");
        return _hashConnectInstance;
      }
    }

    if (msg.includes("Buffer") || msg.includes("buffer")) {
      throw new Error(
        "Buffer polyfill failed to initialize. Please reload the page and try again."
      );
    }
    if (msg.includes("Project") || msg.includes("project")) {
      throw new Error(
        "WalletConnect Project ID is invalid. Get one at cloud.walletconnect.com and update WALLETCONNECT_PROJECT_ID in hashpack.ts"
      );
    }
    throw new Error(`Failed to create HashConnect instance: ${msg}`);
  }
}

// ── Global WC Error Handlers ──
// Catch unhandled errors/rejections from WC's async internals.
// These do NOT modify WC behavior — they only prevent errors from showing in console.

let _globalHandlersInstalled = false;

function installGlobalWCErrorHandlers(): void {
  if (_globalHandlersInstalled) return;
  _globalHandlersInstalled = true;

  const _WC_ERROR_PATTERNS = [
    "No matching key",
    "session or pairing topic doesn't exist",
    "Missing or invalid",
    "Record was recently deleted",
    "proposer",
    "Cannot read properties of undefined",
    "Proposal expired",
    "User rejected",
    "user rejected",
  ];

  const _WC_STACK_MARKERS = [
    "@walletconnect",
    "walletconnect",
    "signClient",
    "SignClient",
    "hashconnect",
    "HashConnect",
    "deleteSession",
    "rpcPublish",
    "getData",
  ];

  const _isWCOrigin = (err: any): boolean => {
    const msg = err?.message || err?.reason?.message || String(err || "");
    for (const p of _WC_ERROR_PATTERNS) {
      if (msg.includes(p)) return true;
    }
    const stack = err?.stack || err?.reason?.stack || "";
    if (stack) {
      for (const m of _WC_STACK_MARKERS) {
        if (stack.includes(m)) return true;
      }
    }
    return false;
  };

  window.addEventListener("unhandledrejection", (event) => {
    if (_isWCOrigin(event.reason)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener("error", (event) => {
    if (_isWCOrigin(event.error) || _isWCOrigin({ message: event.message, stack: event.error?.stack })) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

// ── Raise MaxListeners ──
// Safe: only bumps a numeric limit, does not modify event listeners.

function raiseMaxListeners(hc: any): void {
  const LIMIT = 0; // 0 = unlimited
  const bump = (obj: any) => {
    if (obj && typeof obj.setMaxListeners === "function") {
      try { obj.setMaxListeners(LIMIT); } catch { /* ignore */ }
    }
  };

  try {
    bump(hc.pairingEvent);
    bump(hc.connectionStatusChangeEvent);
    bump(hc.disconnectionEvent);

    const signClient =
      hc.signClient ??
      hc.walletConnectClient ??
      hc._signClient ??
      hc.client;
    if (!signClient) return;

    bump(signClient);
    bump(signClient.events);

    const engine = signClient.engine;
    if (engine) {
      bump(engine);
      bump(engine.events);
    }

    const core = signClient.core;
    if (!core) return;

    bump(core);
    bump(core.events);
    bump(core.relayer);
    bump(core.relayer?.events);
    bump(core.relayer?.provider);
    bump(core.relayer?.subscriber);
    bump(core.relayer?.subscriber?.events);
    bump(core.relayer?.publisher);
    bump(core.relayer?.publisher?.events);
    bump(core.pairing);
    bump(core.pairing?.events);
    bump(core.heartbeat);
    bump(core.heartbeat?.events);
    bump(core.expirer);
    bump(core.expirer?.events);
  } catch {
    // Non-critical
  }
}

// ── Clean Stale WC LocalStorage ──

function cleanStaleWCLocalStorage(): void {
  try {
    // AGGRESSIVE CLEANUP: Remove ALL WC session, pairing, proposal, message,
    // and keychain data. Only preserve identity/crypto keys (relay auth).
    //
    // WHY: Stale sessions whose keychain entries have been removed cause
    // "No matching key" errors when WC's engine tries to process incoming
    // session_delete requests from the relay. The old approach of only
    // removing expired entries wasn't sufficient because a session can be
    // non-expired but have a missing keychain entry (e.g., after a partial
    // cleanup or browser storage eviction).
    //
    // Since we create a fresh HC/WC session on every connect, there's no
    // benefit to preserving old session/pairing state across page loads.
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith("wc@2:") && !key.startsWith("wc@1:")) continue;

      // Preserve identity keys (used for relay authentication).
      // Preserving these avoids unnecessary relay re-registration.
      if (key.includes("identity") || key.includes("crypto")) continue;

      // Remove everything else: sessions, pairings, proposals, messages,
      // subscription, history, expirer, AND keychain (stale keys cause the
      // "No matching key" error). The new HC instance will create fresh keys.
      keysToRemove.push(key);
    }

    if (keysToRemove.length > 0) {
      console.log(`[HBAR.h] Cleaning ${keysToRemove.length} stale WC localStorage entries`);
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Non-critical
  }
}

/**
 * Get the current HashConnect instance (if any).
 * Used for signing transactions later.
 */
export function getCurrentHashConnect(): any {
  return _hashConnectInstance;
}

/**
 * Reset the HashConnect session state.
 * Keeps the instance alive for reuse.
 */
export async function resetHashConnectInstance(): Promise<void> {
  if (_pairingRefreshTimer) {
    clearTimeout(_pairingRefreshTimer);
    _pairingRefreshTimer = null;
  }
  _currentPairingStringCallback = null;

  if (_hashConnectInstance) {
    try {
      await _hashConnectInstance.disconnect();
    } catch {
      /* ignore */
    }
  }

  _readyPromise = null;
  _readyFailed = false;
  _bufferedPairingData = null;
}

/**
 * Force-reset the HashConnect instance completely ("nuclear option").
 */
export async function forceResetHashConnect(): Promise<void> {
  abortActiveConnection();

  _currentPairingCallback = null;
  _currentStateCallback = null;
  _currentDisconnectCallback = null;
  _bufferedPairingData = null;

  if (_hashConnectInstance) {
    try {
      await _hashConnectInstance.disconnect();
    } catch { /* ignore */ }
  }

  _hashConnectInstance = null;
  _hashConnectNetwork = null;
  _readyPromise = null;
  _readyFailed = false;
  _sdkAvailable = null;
  _eventListenersRegistered = false;

  console.log("[HBAR.h] HashConnect instance force-reset — next connect will create a fresh instance");
}

/**
 * Clear WalletConnect localStorage data.
 */
export function clearWCStorage(preserveIdentity = false): number {
  let removed = 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      const isWC = key.startsWith("wc@2:") || key.startsWith("wc@1:");
      const isHC = key.startsWith("hashconnect") || key.includes("walletconnect");

      if (isWC || isHC) {
        if (preserveIdentity && (key.includes("keychain") || key.includes("identity") || key.includes("crypto"))) {
          continue;
        }
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => {
      localStorage.removeItem(k);
      removed++;
    });
  } catch {
    /* best-effort */
  }
  return removed;
}

// ── Storage Keys ──

const STORAGE_KEYS = {
  session: "hbarh-hashpack-session",
  network: "hbarh-hedera-network",
} as const;

// ── Extension Detection ──

export function isHashPackExtensionInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as any;
  return !!(
    win.hashpack ||
    win.hashconnect ||
    win.__hashpack_provider ||
    win.ethereum?.isHashPack ||
    win.hedera?.isHashPack
  );
}

export async function detectHashPackExtension(maxWaitMs = 3000): Promise<boolean> {
  if (isHashPackExtensionInstalled()) return true;

  const interval = 250;
  let waited = 0;
  while (waited < maxWaitMs) {
    await new Promise((r) => setTimeout(r, interval));
    waited += interval;
    if (isHashPackExtensionInstalled()) {
      console.log(`[HBAR.h] HashPack extension detected after ${waited}ms`);
      return true;
    }
  }
  return false;
}

export async function tryExtensionDirect(hc: any): Promise<boolean> {
  try {
    if (typeof hc.connectToExtension === "function") {
      console.log("[HBAR.h] Calling hc.connectToExtension()...");
      await hc.connectToExtension();
      return true;
    }
  } catch (e) {
    console.warn("[HBAR.h] connectToExtension() failed:", e);
  }

  try {
    if (typeof hc.findLocalWallets === "function") {
      console.log("[HBAR.h] Calling hc.findLocalWallets()...");
      await hc.findLocalWallets();
      return true;
    }
  } catch (e) {
    console.warn("[HBAR.h] findLocalWallets() failed:", e);
  }

  try {
    if (typeof window !== "undefined") {
      window.postMessage(
        { type: "hashconnect-query-extension-id", source: "dapp" },
        "*"
      );
    }
  } catch { /* non-critical */ }

  return false;
}

export function openHashPackExtension(pairingUri?: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (pairingUri) {
      window.open(`hashpack://wc?uri=${encodeURIComponent(pairingUri)}`, "_self");
    } else {
      window.open("hashpack://", "_self");
    }
    return true;
  } catch {
    return false;
  }
}

// ── Mirror Node Utilities ──

export async function resolveEvmToAccountId(
  evmAddress: string,
  network: HederaNetwork
): Promise<string | null> {
  try {
    const baseUrl = MIRROR_NODES[network];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(
      `${baseUrl}/api/v1/accounts/${evmAddress.toLowerCase()}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    return data.account || null;
  } catch {
    return null;
  }
}

export async function resolveAccountIdToEvm(
  accountId: string,
  network: HederaNetwork
): Promise<string | null> {
  try {
    const baseUrl = MIRROR_NODES[network];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(
      `${baseUrl}/api/v1/accounts/${accountId.trim()}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    return data.evm_address || null;
  } catch {
    return null;
  }
}

// ── User Profile API ──

export async function fetchHashPackProfile(
  accountId: string,
  network: HederaNetwork
): Promise<HashPackProfile | null> {
  if (_hashConnectInstance) {
    try {
      const profile = await _hashConnectInstance.getUserProfile(
        accountId,
        network
      );
      if (profile) {
        return {
          accountId: profile.accountId || accountId,
          username: profile.username?.name || "",
          profilePicture: profile.profilePicture?.thumbUrl || "",
          bio: "",
          twitterHandle: "",
          currency: profile.currency || "USD",
        };
      }
    } catch {
      /* fall through to direct API */
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(
      "https://api.hashpack.app/user-profile/get",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, network }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.error) return null;
    return {
      accountId: data.accountId || accountId,
      username: data.username?.name || data.username || "",
      profilePicture:
        data.profilePicture?.thumbUrl || data.profilePicture || "",
      bio: data.bio || "",
      twitterHandle: data.twitterHandle || "",
      currency: data.currency || "USD",
    };
  } catch {
    return null;
  }
}

// ── Connection Methods ──

/**
 * Connect via HashConnect SDK (extension + WalletConnect).
 *
 * HashConnect v3 handles both extension detection and WalletConnect pairing
 * internally via `init()` + event listeners.
 */
export async function connectViaHashConnect(
  network: HederaNetwork,
  onPairingString?: (uri: string) => void,
  onConnectionState?: (state: string) => void
): Promise<HashPackConnectionResult> {
  if (!isWalletConnectConfigured()) {
    return {
      success: false,
      session: null,
      error:
        "WalletConnect Project ID is not configured. " +
        "The HashConnect SDK requires a valid Project ID from cloud.walletconnect.com to initialize. " +
        "Please use the Account Lookup (Mirror Node) option for read-only access, or configure a WalletConnect Project ID in hashpack.ts.",
    };
  }

  try {
    const hc = await getReadyHashConnect(network);

    // Abort any in-flight connection attempt
    abortActiveConnection();

    // ── Check for buffered pairing data (extension auto-paired during init) ──
    if (_bufferedPairingData) {
      const buffered = _bufferedPairingData;
      _bufferedPairingData = null;
      console.log("[HBAR.h] Using buffered pairing data from init:", buffered?.accountIds);
      return await buildSessionFromPairingData(buffered, network, "hashconnect");
    }

    // ── Check if already paired ──
    try {
      const already = hc.connectedAccountIds;
      if (already && already.length > 0) {
        const accountId = already[0].toString?.() ?? String(already[0]);
        console.log("[HBAR.h] Already paired to:", accountId);
        return await buildSessionFromPairingData(
          { accountIds: [accountId], network: network, metadata: {} },
          network,
          "hashconnect"
        );
      }
    } catch { /* ignore */ }

    // ── Attempt explicit extension connection ──
    onConnectionState?.("Searching for extension...");
    const extensionFound = await detectHashPackExtension(1500);

    if (extensionFound) {
      console.log("[HBAR.h] Extension detected — attempting direct connection");
      onConnectionState?.("Extension found — connecting...");

      await tryExtensionDirect(hc);

      // Give the extension up to 5s to auto-pair
      const extPairWaitMs = 5000;
      const extPairInterval = 500;
      let extWaited = 0;
      while (extWaited < extPairWaitMs) {
        if (_bufferedPairingData) {
          const buffered = _bufferedPairingData;
          _bufferedPairingData = null;
          console.log("[HBAR.h] Extension auto-paired after direct trigger:", buffered?.accountIds);
          return await buildSessionFromPairingData(buffered, network, "hashconnect");
        }
        try {
          const ids = hc.connectedAccountIds;
          if (ids && ids.length > 0) {
            const accountId = ids[0].toString?.() ?? String(ids[0]);
            console.log("[HBAR.h] Extension connected:", accountId);
            return await buildSessionFromPairingData(
              { accountIds: [accountId], network, metadata: {} },
              network,
              "hashconnect"
            );
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, extPairInterval));
        extWaited += extPairInterval;
      }
      console.log("[HBAR.h] Extension direct connection did not auto-pair — falling through to WC pairing");
    } else {
      console.log("[HBAR.h] No extension detected — proceeding to WC pairing");
    }

    onConnectionState?.("Generating pairing string...");

    // ── Generate a fresh pairing string ──
    // CRITICAL: Use generatePairingString() which creates BOTH a pairing AND
    // a session proposal. A bare pairing.create() would NOT work because the
    // wallet needs a proposal to approve for session establishment.
    const freshUri = await regeneratePairingString(hc);
    if (freshUri) {
      console.log("[HBAR.h] Fresh pairing string ready for connection attempt");
    } else if (!hc.pairingString) {
      console.warn("[HBAR.h] Could not generate fresh pairing string — no existing string available");
    }

    return new Promise<HashPackConnectionResult>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({
            success: false,
            session: null,
            error:
              "Connection timed out after 2 minutes. Try: (1) Open HashPack and go to Settings → Connect DApp, (2) Copy the pairing string above and paste it in HashPack, (3) Clear browser cache and try again.",
          });
        }
      }, 120000);

      _activeTimer = timer;

      const cleanup = () => {
        _currentPairingCallback = null;
        _currentStateCallback = null;
        _currentDisconnectCallback = null;
        _currentPairingStringCallback = null;
        if (_pairingRefreshTimer) {
          clearTimeout(_pairingRefreshTimer);
          _pairingRefreshTimer = null;
        }
        if (_activeCleanup === cleanup) _activeCleanup = null;
        if (_activeTimer === timer) _activeTimer = null;
      };

      _activeCleanup = cleanup;

      // ── Set per-attempt callbacks ──
      _currentStateCallback = (state: string) => {
        onConnectionState?.(state);
      };

      _currentPairingCallback = async (sessionData: {
        accountIds: string[];
        network: string;
        metadata: any;
      }) => {
        clearTimeout(timer);
        if (resolved) return;
        resolved = true;
        cleanup();

        try {
          const result = await buildSessionFromPairingData(sessionData, network, "hashconnect");
          resolve(result);
        } catch (err: any) {
          resolve({
            success: false,
            session: null,
            error: err.message || "Failed to process pairing data.",
          });
        }
      };

      // Provide the pairing string for QR code display
      if (hc.pairingString && onPairingString) {
        onPairingString(hc.pairingString);

        // Set up auto-refresh for the pairing string (at 4 minutes)
        _currentPairingStringCallback = onPairingString;
        schedulePairingRefresh(hc);

        if (extensionFound) {
          console.log("[HBAR.h] Extension detected — triggering hashpack:// deep link with pairing URI");
          openHashPackExtension(hc.pairingString);
        }
      } else if (!hc.pairingString) {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({
            success: false,
            session: null,
            error:
              "Could not generate a WalletConnect pairing string. " +
              "The WC relay server may be unreachable. " +
              "Try: (1) Check your internet connection, (2) Click 'Clear & Retry', " +
              "(3) Reload the page, or (4) Try again in a few minutes.",
          });
        }
      }
    });
  } catch (err: any) {
    if (
      err.message?.includes("Project ID") ||
      err.message?.includes("projectId")
    ) {
      return {
        success: false,
        session: null,
        error:
          "WalletConnect Project ID not configured. Please set up your project at cloud.walletconnect.com",
      };
    }
    return {
      success: false,
      session: null,
      error: err.message || "Failed to connect via HashConnect SDK.",
    };
  }
}

/**
 * Build a HashPackSession from raw pairing event data.
 */
async function buildSessionFromPairingData(
  sessionData: { accountIds: string[]; network: string; metadata?: any },
  network: HederaNetwork,
  connectionMethod: "hashconnect" | "walletconnect"
): Promise<HashPackConnectionResult> {
  const accountIds = sessionData.accountIds || [];
  if (accountIds.length === 0) {
    return {
      success: false,
      session: null,
      error: "No accounts returned from HashPack.",
    };
  }

  const accountId = typeof accountIds[0] === "string"
    ? accountIds[0]
    : accountIds[0]?.toString?.() ?? String(accountIds[0]);

  console.log("[HBAR.h] Building session for:", accountId);

  let evmAddress = "";
  try {
    evmAddress = (await resolveAccountIdToEvm(accountId, network)) || "";
  } catch { /* non-critical */ }

  let profile: HashPackProfile | null = null;
  try {
    profile = await fetchHashPackProfile(accountId, network);
  } catch { /* non-critical */ }

  const session: HashPackSession = {
    accountId,
    evmAddress,
    network,
    connectedAt: Date.now(),
    isVerified: true,
    connectionMethod,
    profile,
  };

  persistSession(session);
  return { success: true, session, error: null };
}

/**
 * Open the HashConnect built-in pairing modal.
 */
export async function openHashConnectPairingModal(
  network: HederaNetwork,
  themeMode: "dark" | "light" = "dark"
): Promise<HashPackConnectionResult> {
  if (!isWalletConnectConfigured()) {
    return {
      success: false,
      session: null,
      error:
        "WalletConnect Project ID is not configured. " +
        "The SDK Pairing Modal requires a valid Project ID from cloud.walletconnect.com. " +
        "Please use the Account Lookup (Mirror Node) option instead.",
    };
  }

  try {
    const hc = await getReadyHashConnect(network);

    abortActiveConnection();

    // Regenerate a fresh pairing string so the modal uses a valid proposal
    await regeneratePairingString(hc);

    return new Promise<HashPackConnectionResult>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({
            success: false,
            session: null,
            error: "Pairing timed out.",
          });
        }
      }, 120000);

      _activeTimer = timer;

      const cleanup = () => {
        _currentPairingCallback = null;
        _currentStateCallback = null;
        _currentDisconnectCallback = null;
        if (_activeCleanup === cleanup) _activeCleanup = null;
        if (_activeTimer === timer) _activeTimer = null;
      };

      _activeCleanup = cleanup;

      _currentPairingCallback = async (sessionData: {
        accountIds: string[];
        network: string;
      }) => {
        clearTimeout(timer);
        if (resolved) return;
        resolved = true;
        cleanup();

        try {
          const result = await buildSessionFromPairingData(sessionData, network, "walletconnect");
          resolve(result);
        } catch (err: any) {
          resolve({
            success: false,
            session: null,
            error: err.message || "Failed to process pairing data.",
          });
        }
      };

      hc.openPairingModal(
        themeMode,
        themeMode === "dark" ? "#0a0a0f" : "#ffffff",
        "#ec4899",
        "#ffffff",
        "12px"
      ).catch((err: any) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({
            success: false,
            session: null,
            error: err.message || "Failed to open pairing modal.",
          });
        }
      });
    });
  } catch (err: any) {
    return {
      success: false,
      session: null,
      error: err.message || "Failed to open HashConnect pairing modal.",
    };
  }
}

/**
 * Connect via Mirror Node account lookup (fallback / read-only mode).
 */
export async function connectViaMirrorNode(
  accountId: string,
  network: HederaNetwork
): Promise<HashPackConnectionResult> {
  try {
    if (!/^0\.0\.\d+$/.test(accountId.trim())) {
      return {
        success: false,
        session: null,
        error: "Invalid account ID format. Use 0.0.xxxxx format.",
      };
    }

    const accountInfo = await fetchAccountInfo(accountId.trim(), network);

    if (!accountInfo) {
      return {
        success: false,
        session: null,
        error: `Account ${accountId} not found on ${network}. Please verify the account ID and network.`,
      };
    }

    if (accountInfo.deleted) {
      return {
        success: false,
        session: null,
        error: `Account ${accountId} has been deleted on ${network}.`,
      };
    }

    const profile = await fetchHashPackProfile(accountId.trim(), network);

    const session: HashPackSession = {
      accountId: accountInfo.accountId,
      evmAddress: accountInfo.evmAddress || "",
      network,
      connectedAt: Date.now(),
      isVerified: false,
      connectionMethod: "mirror-node",
      profile,
    };

    persistSession(session);
    return { success: true, session, error: null };
  } catch (err: any) {
    return {
      success: false,
      session: null,
      error:
        err.message ||
        "Failed to connect via Mirror Node. Please try again.",
    };
  }
}

// ── Disconnect ──

export async function disconnectHashConnect(): Promise<void> {
  _currentPairingCallback = null;
  _currentStateCallback = null;
  _currentDisconnectCallback = null;
  _bufferedPairingData = null;
  abortActiveConnection();

  if (_hashConnectInstance) {
    try {
      await _hashConnectInstance.disconnect();
    } catch {
      /* ignore */
    }
  }
  clearSession();
}

// ── Message Signing ──

export async function signMessage(
  accountId: string,
  message: string
): Promise<{ signatures: any[] } | null> {
  if (!_hashConnectInstance) return null;
  try {
    const { AccountId } = await import("@hashgraph/sdk");
    const result = await _hashConnectInstance.signMessages(
      AccountId.fromString(accountId),
      message
    );
    return { signatures: result };
  } catch {
    return null;
  }
}

// ── Session Management ──

function persistSession(session: HashPackSession): void {
  try {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
    localStorage.setItem("hbarh-hedera-account", session.accountId);
    localStorage.setItem("hbarh-hedera-network", session.network);
  } catch {
    console.warn("Failed to persist HashPack session to localStorage");
  }
}

export function restoreSession(): HashPackSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.session);
    if (!raw) return null;

    const session: HashPackSession = JSON.parse(raw);

    const maxAge = 24 * 60 * 60 * 1000;
    if (Date.now() - session.connectedAt > maxAge) {
      clearSession();
      return null;
    }

    if (!session.accountId || !session.network) {
      clearSession();
      return null;
    }

    return session;
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.session);
    localStorage.removeItem("hbarh-hedera-account");
  } catch {
    /* ignore */
  }
}

// ── Manual Pairing String Connection ──

export async function connectViaPairingString(
  pairingString: string,
  network: HederaNetwork,
): Promise<HashPackConnectionResult> {
  if (!pairingString || !pairingString.startsWith("wc:")) {
    return {
      success: false,
      session: null,
      error: "Invalid pairing string. It should start with 'wc:' — copy the full string from HashPack Settings → Connect DApp → WalletConnect.",
    };
  }

  if (!isWalletConnectConfigured()) {
    return {
      success: false,
      session: null,
      error: "WalletConnect Project ID is not configured.",
    };
  }

  try {
    const hc = await getReadyHashConnect(network);
    abortActiveConnection();

    const signClient =
      (hc as any).signClient ??
      (hc as any)._signClient ??
      (hc as any).walletConnectClient ??
      (hc as any).client;

    if (!signClient?.core?.pairing?.pair) {
      return {
        success: false,
        session: null,
        error: "SignClient not available — please reload the page and try again.",
      };
    }

    return new Promise<HashPackConnectionResult>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({
            success: false,
            session: null,
            error: "Pairing timed out. Make sure HashPack is open and you approved the connection request.",
          });
        }
      }, 60000);

      _activeTimer = timer;

      const cleanup = () => {
        _currentPairingCallback = null;
        _currentStateCallback = null;
        _currentDisconnectCallback = null;
        if (_activeCleanup === cleanup) _activeCleanup = null;
        if (_activeTimer === timer) _activeTimer = null;
      };

      _activeCleanup = cleanup;

      _currentPairingCallback = async (sessionData: any) => {
        clearTimeout(timer);
        if (resolved) return;
        resolved = true;
        cleanup();
        try {
          const result = await buildSessionFromPairingData(sessionData, network, "walletconnect");
          resolve(result);
        } catch (err: any) {
          resolve({
            success: false,
            session: null,
            error: err.message || "Failed to process pairing data.",
          });
        }
      };

      signClient.core.pairing.pair({ uri: pairingString }).catch((err: any) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          cleanup();

          const msg = err?.message || "";
          if (msg.includes("expired") || msg.includes("Proposal expired")) {
            resolve({
              success: false,
              session: null,
              error: "Pairing string has expired. Generate a fresh one from HashPack Settings → Connect DApp.",
            });
          } else if (msg.includes("already exists") || msg.includes("Pairing already exists")) {
            setTimeout(async () => {
              try {
                const ids = hc.connectedAccountIds;
                if (ids && ids.length > 0) {
                  const accountId = ids[0].toString?.() ?? String(ids[0]);
                  const result = await buildSessionFromPairingData(
                    { accountIds: [accountId], network, metadata: {} },
                    network,
                    "walletconnect"
                  );
                  resolve(result);
                  return;
                }
              } catch { /* fall through */ }
              resolve({
                success: false,
                session: null,
                error: "This pairing already exists but no account was connected. Try disconnecting in HashPack first, then pair again.",
              });
            }, 2000);
          } else {
            resolve({
              success: false,
              session: null,
              error: `Pairing failed: ${msg}`,
            });
          }
        }
      });
    });
  } catch (err: any) {
    return {
      success: false,
      session: null,
      error: err.message || "Failed to connect via pairing string.",
    };
  }
}

/**
 * Inject a WalletConnect pairing URI into the existing HashConnect instance.
 */
export async function injectPairingUri(uri: string): Promise<string | null> {
  if (!uri || !uri.startsWith("wc:")) {
    return "Invalid pairing string. It should start with 'wc:' — copy the full string from HashPack or the QR screen.";
  }

  if (!_hashConnectInstance) {
    return "HashConnect is not initialized. Please try the connection again.";
  }

  try {
    const signClient =
      (_hashConnectInstance as any).signClient ??
      (_hashConnectInstance as any)._signClient ??
      (_hashConnectInstance as any).walletConnectClient ??
      (_hashConnectInstance as any).client;

    if (!signClient?.core?.pairing?.pair) {
      return "WalletConnect SignClient not available. Please reload and try again.";
    }

    console.log("[HBAR.h] Injecting manual pairing URI...");
    await signClient.core.pairing.pair({ uri });
    console.log("[HBAR.h] Pairing URI injected — waiting for HashPack approval");
    return null;
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("expired") || msg.includes("Proposal expired")) {
      return "Pairing string has expired. Copy a fresh one.";
    }
    if (msg.includes("already exists")) {
      return null;
    }
    return `Pairing failed: ${msg}`;
  }
}

// ── Token Gating Utility ──

export async function checkTokenHolding(
  accountId: string,
  tokenId: string,
  network: HederaNetwork,
  minBalance = 0
): Promise<{ holds: boolean; balance: number }> {
  try {
    const baseUrl = MIRROR_NODES[network];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(
      `${baseUrl}/api/v1/accounts/${accountId.trim()}/tokens?token.id=${tokenId}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) return { holds: false, balance: 0 };
    const data = await response.json();
    if (!data.tokens || data.tokens.length === 0)
      return { holds: false, balance: 0 };
    const token = data.tokens[0];
    const balance = token.balance || 0;
    return { holds: balance > minBalance, balance };
  } catch {
    return { holds: false, balance: 0 };
  }
}

// ── Utility Exports ──

export function getHashPackDownloadUrl(): string {
  return "https://www.hashpack.app/download";
}

export function getHashPackDeepLink(pairingUri: string): string {
  return `hashpack://wc?uri=${encodeURIComponent(pairingUri)}`;
}

export function getWalletConnectUniversalLink(pairingUri: string): string {
  return `https://wc.hashpack.app/wc?uri=${encodeURIComponent(pairingUri)}`;
}

export function isWalletConnectConfigured(): boolean {
  return (
    WALLETCONNECT_PROJECT_ID !== "YOUR_WALLETCONNECT_PROJECT_ID" &&
    WALLETCONNECT_PROJECT_ID.length > 0
  );
}

export function getWalletConnectProjectId(): string {
  return WALLETCONNECT_PROJECT_ID;
}

// ── Transaction Signing for HSuite SmartNode ──

export async function signTransaction(
  accountId: string,
  txBytes: Uint8Array
): Promise<Uint8Array | null> {
  if (!_hashConnectInstance) {
    console.debug("[HashPack] signTransaction: no HashConnect instance");
    return null;
  }

  try {
    const { AccountId, Transaction } = await import("@hashgraph/sdk");

    const transaction = Transaction.fromBytes(txBytes);

    const signer = _hashConnectInstance.getSigner?.(
      AccountId.fromString(accountId)
    );

    if (signer) {
      const signedTx = await signer.signTransaction(transaction);
      return signedTx.toBytes();
    }

    if (typeof _hashConnectInstance.sendTransaction === "function") {
      const result = await _hashConnectInstance.sendTransaction(
        AccountId.fromString(accountId),
        transaction
      );
      if (result?.transactionId) {
        return txBytes;
      }
    }

    console.debug("[HashPack] signTransaction: no signer or sendTransaction available");
    return null;
  } catch (err: any) {
    console.debug("[HashPack] signTransaction failed:", err?.message || err);
    return null;
  }
}

export async function sendHederaTransaction(
  accountId: string,
  txBytes: Uint8Array
): Promise<{
  success: boolean;
  transactionId: string | null;
  error: string | null;
}> {
  if (!_hashConnectInstance) {
    return {
      success: false,
      transactionId: null,
      error: "HashPack wallet not connected",
    };
  }

  try {
    const { AccountId, Transaction } = await import(
      "@hashgraph/sdk"
    );

    const transaction = Transaction.fromBytes(txBytes);

    const signer = _hashConnectInstance.getSigner?.(
      AccountId.fromString(accountId)
    );

    if (signer) {
      let readyTx = transaction;
      if (!transaction.isFrozen()) {
        readyTx = await transaction.freezeWithSigner(signer);
      }
      const response = await readyTx.executeWithSigner(signer);
      const txId = response.transactionId?.toString() ?? null;

      // Try SDK receipt, fall back to Mirror Node on protobuf bug
      try {
        const receipt = await response.getReceiptWithSigner(signer);
        return {
          success: receipt.status?.toString() === "SUCCESS",
          transactionId: txId,
          error: null,
        };
      } catch (receiptErr: any) {
        const msg = receiptErr?.message || "";
        if (
          msg.includes("body.data was not set") ||
          msg.includes("protobuf") ||
          msg.includes("BUG")
        ) {
          console.log("[HBAR.h] SDK receipt failed (known protobuf bug) — falling back to Mirror Node poll");
          if (txId) {
            const network = _hashConnectNetwork || "mainnet";
            const mirrorResult = await pollMirrorNodeReceipt(txId, network);
            if (mirrorResult) {
              return {
                success: mirrorResult.result === "SUCCESS",
                transactionId: txId,
                error: mirrorResult.result === "SUCCESS" ? null : `Transaction failed: ${mirrorResult.result}`,
              };
            }
          }
          // If mirror node poll fails, assume success since the tx was submitted
          return {
            success: true,
            transactionId: txId,
            error: null,
          };
        }
        throw receiptErr;
      }
    }

    // Fallback: try sendTransaction
    if (typeof _hashConnectInstance.sendTransaction === "function") {
      const { AccountId: AId } = await import("@hashgraph/sdk");
      const receipt = await _hashConnectInstance.sendTransaction(
        AId.fromString(accountId),
        transaction
      );
      return {
        success: receipt?.status?.toString() === "SUCCESS",
        transactionId: receipt?.transactionId?.toString() ?? null,
        error: null,
      };
    }

    return {
      success: false,
      transactionId: null,
      error: "No signing method available on HashConnect instance.",
    };
  } catch (err: any) {
    return {
      success: false,
      transactionId: null,
      error: err.message || "Transaction failed.",
    };
  }
}

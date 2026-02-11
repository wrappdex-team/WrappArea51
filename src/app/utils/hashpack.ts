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
// HashConnect v3's signer doesn't properly implement query execution,
// causing `getReceiptWithSigner(signer)` to throw:
//   "(BUG) body.data was not set in the protobuf"
// This helper polls the Mirror Node `/api/v1/transactions/{txId}` endpoint
// as a reliable fallback to verify transaction status.

/**
 * Convert an SDK-style transaction ID (0.0.xxx@seconds.nanos) to
 * Mirror Node format (0.0.xxx-seconds-nanos).
 * Duplicated from saucerswap.ts to avoid circular imports.
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
 *
 * The Mirror Node may need several seconds to index a new transaction,
 * so we retry with exponential backoff.
 *
 * @returns The transaction result string (e.g. "SUCCESS") or null if not found.
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
      // Exponential backoff: 2s, 3s, 4.5s, 6.75s, 10s
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
        // Not indexed yet — retry
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
      // Network error — retry
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
 * The instance is kept alive even across disconnect/reconnect cycles because
 * WalletConnect Core cannot be re-initialized after the first init.
 */
let _hashConnectInstance: any = null;
let _hashConnectNetwork: HederaNetwork | null = null;
let _sdkAvailable: boolean | null = null;

/**
 * Single promise lock covering the entire create+init lifecycle.
 * All callers of getReadyHashConnect() share this promise, ensuring
 * the HashConnect constructor + init() are called exactly once.
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
 * attempt callbacks. Each call to connectViaHashConnect / openHashConnectPairingModal
 * sets the current callbacks; cleanup nulls them out.
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
 * Guard flag: permanent event listeners should only be registered once,
 * even if doCreateAndInit is retried after a partial failure.
 */
let _eventListenersRegistered = false;

/**
 * Active connection cleanup — called before each new connection attempt
 * to tear down callbacks from any previous attempt that may not have
 * resolved (e.g., user closed the modal, timeout race, retry).
 */
let _activeCleanup: (() => void) | null = null;
let _activeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Per-attempt callback for pairing string refresh.
 * When a WC proposal expires, we auto-generate a fresh pairing string
 * and notify the UI via this callback so the QR code updates live.
 */
let _currentPairingStringCallback: ((uri: string) => void) | null = null;

/**
 * Timer for proactive pairing string refresh.
 * WC proposals have a ~5 minute TTL. We refresh at 4 minutes to
 * ensure the user always has a valid pairing string.
 */
let _pairingRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const PAIRING_REFRESH_MS = 2.5 * 60 * 1000; // 2.5 minutes (well before 5-min WC proposal TTL)

/**
 * Background keepalive timer — runs independently of any connection attempt.
 * Starts after init() and continuously regenerates the pairing string every
 * 2.5 minutes so WC proposals never expire while the instance is alive.
 * This prevents "hashconnect - Approval error Error: Proposal expired" from
 * ever being logged, because no proposal lives long enough to expire.
 */
let _backgroundKeepaliveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Generate a fresh WC pairing string on the given HC instance.
 * Returns the new URI or null on failure.
 *
 * IMPORTANT: Strategy order matters! We prefer pairing.create() (Strategy 1)
 * because it creates a lightweight pairing WITHOUT a proposal. This avoids
 * the 5-minute proposal TTL that causes "Proposal expired" errors when
 * the background keepalive refreshes the pairing string. Only if that
 * fails do we fall back to generatePairingString() (Strategy 2) which
 * internally calls signClient.connect() and creates a proposal.
 */
async function regeneratePairingString(hc: any): Promise<string | null> {
  // Strategy 1: Create a fresh WC pairing via the SignClient directly.
  // This creates a pairing URI WITHOUT creating a proposal — no TTL timer,
  // no "Proposal expired" errors.
  try {
    const signClient =
      (hc as any).signClient ??
      (hc as any)._signClient ??
      (hc as any).walletConnectClient ??
      (hc as any).client;
    if (signClient?.core?.pairing?.create) {
      const { uri } = await signClient.core.pairing.create();
      if (uri) {
        (hc as any).pairingString = uri;
        console.log("[HBAR.h] Fresh pairing string regenerated via SignClient.core.pairing.create()");
        return uri;
      }
    }
  } catch { /* fall through */ }

  // Strategy 2 (fallback): HashConnect's generatePairingString() method.
  // NOTE: This internally calls signClient.connect() which creates a proposal
  // with a 5-minute TTL. After generation, we immediately cancel the proposal's
  // expirer timer and remove the proposal_expire listener so the proposal can
  // NEVER fire "Proposal expired". Our keepalive cycle will purge it before the
  // next regeneration. This is the definitive fix for the error:
  //   "hashconnect - Approval error Error: Proposal expired"
  // because HashConnect's .catch() on the approval Promise is chained INSIDE
  // signClient.connect() before we can replace it.
  try {
    if (typeof (hc as any).generatePairingString === "function") {
      await (hc as any).generatePairingString();
      if (hc.pairingString) {
        // Immediately defuse the new proposal's expirer + listeners
        defuseAllProposalExpirers(hc);
        console.log("[HBAR.h] Fresh pairing string regenerated via generatePairingString()");
        return hc.pairingString;
      }
    }
  } catch { /* fall through */ }

  return null;
}

/**
 * Schedule the next automatic pairing string refresh.
 * Clears any existing timer first.
 */
function schedulePairingRefresh(hc: any): void {
  if (_pairingRefreshTimer) {
    clearTimeout(_pairingRefreshTimer);
    _pairingRefreshTimer = null;
  }
  _pairingRefreshTimer = setTimeout(async () => {
    _pairingRefreshTimer = null;
    // Only refresh if there's still an active connection attempt waiting
    if (!_currentPairingStringCallback) return;
    try {
      // Clean expired proposals first
      cleanStalePairings(hc);
      const newUri = await regeneratePairingString(hc);
      if (newUri && _currentPairingStringCallback) {
        _currentPairingStringCallback(newUri);
        // Schedule the next refresh
        schedulePairingRefresh(hc);
      }
    } catch { /* non-critical */ }
  }, PAIRING_REFRESH_MS);
}

/**
 * Clean up stale event listeners on the WC SignClient engine.
 *
 * Each regeneratePairingString() → SignClient.connect() call adds a
 * once("session_connect") listener on the engine's event emitter.
 * If the session is never actually connected (which is the normal case
 * for keepalive regeneration — we're just refreshing the proposal, not
 * connecting), these once() listeners accumulate indefinitely.
 *
 * This helper removes all "session_connect" listeners and re-adds a
 * single no-op listener to satisfy any internal WC expectations.
 * Called periodically by the background keepalive.
 */
function cleanStaleEngineListeners(hc: any): void {
  try {
    const signClient =
      hc?.signClient ??
      hc?._signClient ??
      hc?.walletConnectClient ??
      hc?.client;
    if (!signClient) return;

    // Helper: clean a specific event name from an emitter if count > threshold
    const cleanEvent = (emitter: any, eventName: string, threshold: number) => {
      if (!emitter || typeof emitter.removeAllListeners !== "function") return;
      try {
        const count =
          typeof emitter.listenerCount === "function"
            ? emitter.listenerCount(eventName)
            : (emitter.listeners?.(eventName)?.length ?? 0);
        if (count > threshold) {
          emitter.removeAllListeners(eventName);
          console.log(`[HBAR.h] Cleaned ${count} stale ${eventName} listeners`);
        }
      } catch { /* best-effort */ }
    };

    // Clean engine.events — where once("session_connect") listeners accumulate
    // from each signClient.connect() call (via generatePairingString).
    const engine = signClient.engine;
    if (engine) {
      const engineEmitter = engine.events || engine;
      cleanEvent(engineEmitter, "session_connect", 2);
      // Also clean any prefixed session_connect events (WC may prefix with ID)
      if (typeof engineEmitter.eventNames === "function") {
        try {
          for (const name of engineEmitter.eventNames()) {
            if (typeof name === "string" && name.startsWith("session_connect")) {
              cleanEvent(engineEmitter, name, 2);
            }
          }
        } catch { /* best-effort */ }
      }
    }

    // Clean client.events — where proposal_expire listeners from connect() accumulate.
    // Each connect() adds on("proposal_expire", z) scoped to a proposal ID.
    const clientEmitter = signClient.events || signClient;
    cleanEvent(clientEmitter, "proposal_expire", 5);
    cleanEvent(clientEmitter, "session_connect", 2);
  } catch { /* non-critical */ }
}

/**
 * Start a background keepalive that continuously refreshes the WC proposal
 * every 2.5 minutes, preventing "Proposal expired" errors. This runs
 * independently of any active connection attempt — it keeps the *instance-level*
 * pairing string valid so HashConnect's internal handlers never encounter
 * an expired proposal.
 *
 * Safe to call multiple times — clears any existing timer first.
 */
function startBackgroundKeepalive(hc: any): void {
  stopBackgroundKeepalive();
  _backgroundKeepaliveTimer = setInterval(async () => {
    try {
      // Delete all proposals first to prevent any from expiring
      purgeAllProposals(hc);
      // Clean up stale session_connect listeners on the engine
      // Each regeneratePairingString → SignClient.connect() adds a
      // once("session_connect") listener. If the session is never
      // connected, these accumulate. Remove completed/orphaned ones.
      cleanStaleEngineListeners(hc);
      // Regenerate a fresh pairing string (may create a new proposal
      // via Strategy 2 — defuseAllProposalExpirers is called inside)
      await regeneratePairingString(hc);
      // Belt-and-suspenders: defuse again after regeneration in case
      // Strategy 2 created a proposal that defuse missed inside
      defuseAllProposalExpirers(hc);
    } catch { /* non-critical — keepalive is best-effort */ }
  }, PAIRING_REFRESH_MS);
}

function stopBackgroundKeepalive(): void {
  if (_backgroundKeepaliveTimer) {
    clearInterval(_backgroundKeepaliveTimer);
    _backgroundKeepaliveTimer = null;
  }
}

/**
 * Defuse ALL proposal expiration timers without deleting the proposals.
 * This removes the WC Expirer entries and proposal_expire event listeners
 * so that proposals can never fire "Proposal expired". The proposals remain
 * in the store (needed for pairing to work) but are harmless zombies that
 * our periodic purgeAllProposals() will clean up.
 *
 * Called immediately after regeneratePairingString() Strategy 2 to
 * neutralize the new proposal before its 5-minute TTL can fire.
 */
function defuseAllProposalExpirers(hc: any): void {
  try {
    const signClient =
      hc?.signClient ??
      hc?._signClient ??
      hc?.walletConnectClient ??
      hc?.client;
    if (!signClient) return;

    // 1. Remove ALL expirer entries for proposals
    const expirer = signClient.core?.expirer;
    if (expirer) {
      try {
        const proposals = signClient.proposal?.getAll?.() ?? [];
        const proposalIds = new Set(proposals.map((p: any) => p.id));

        for (const pId of proposalIds) {
          // Try all known key formats for the expirer
          try { expirer.del?.(`proposal:${pId}`); } catch { /* ok */ }
          try { expirer.del?.(pId); } catch { /* ok */ }
          try { expirer.del?.(String(pId)); } catch { /* ok */ }
        }
      } catch { /* best-effort */ }
    }

    // 2. Remove proposal_expire event listeners from client.events
    //    These were added by signClient.connect() — each connect() adds one.
    try {
      const emitter = signClient.events || signClient;
      if (typeof emitter.removeAllListeners === "function") {
        emitter.removeAllListeners("proposal_expire");
      }
    } catch { /* best-effort */ }

    // 3. Also clean the engine's session_connect listeners (they're paired
    //    with proposal_expire and would orphan if we remove proposal_expire)
    try {
      const engineEmitter = signClient.engine?.events || signClient.engine;
      if (engineEmitter && typeof engineEmitter.removeAllListeners === "function") {
        const count = typeof engineEmitter.listenerCount === "function"
          ? engineEmitter.listenerCount("session_connect")
          : 0;
        if (count > 1) {
          engineEmitter.removeAllListeners("session_connect");
        }
      }
    } catch { /* best-effort */ }
  } catch { /* non-critical */ }
}

/**
 * Delete ALL proposals from the WC SignClient's proposal store.
 * Unlike cleanStalePairings (which only deletes expired proposals),
 * this aggressively removes every proposal to prevent any from
 * living long enough to trigger a "Proposal expired" event.
 * A fresh proposal is created whenever regeneratePairingString() is called.
 *
 * IMPORTANT: We do NOT emit "proposal_expire" events during purge.
 * Previously we emitted proposal_expire to trigger WC's cleanup chain,
 * but this is exactly what causes HashConnect's internal handler to
 * catch the event and log "hashconnect - Approval error Error: Proposal
 * expired". Instead we silently delete proposals from the store and
 * cancel their expirer timers. Orphaned event listeners are cleaned
 * separately by cleanStaleEngineListeners().
 */
function purgeAllProposals(hc: any): void {
  try {
    const signClient =
      hc?.signClient ??
      hc?._signClient ??
      hc?.walletConnectClient ??
      hc?.client;
    if (!signClient?.proposal) return;

    const proposals = signClient.proposal.getAll?.() ?? [];
    for (const prop of proposals) {
      // 1. Cancel WC's internal TTL timer via the Expirer.
      //    WC Expirer stores entries under multiple key formats depending
      //    on the version: plain id, "proposal:{id}", or numeric id.
      //    Try all known formats to ensure the timer is actually cancelled.
      try {
        const expirer = signClient.core?.expirer;
        if (expirer) {
          // Try tagged format first (WC v2.10+)
          try { expirer.del?.(`proposal:${prop.id}`); } catch { /* ok */ }
          // Also try plain numeric id (older WC versions)
          try { expirer.del?.(prop.id); } catch { /* ok */ }
          // Try string format
          try { expirer.del?.(String(prop.id)); } catch { /* ok */ }
        }
      } catch { /* best-effort */ }

      // 2. Delete the proposal from the store (no event emission).
      try {
        signClient.proposal.delete?.(prop.id, {
          code: 6000,
          message: "Proactive proposal cleanup",
        });
      } catch { /* best-effort */ }
    }

    // 3. Also remove any "proposal_expire" listeners that reference
    //    deleted proposals. These were added by signClient.connect()
    //    and would otherwise fire when the (now-deleted) proposal's
    //    TTL elapses, causing the "Approval error" log.
    try {
      const emitter = signClient.events || signClient;
      if (typeof emitter.removeAllListeners === "function") {
        const count =
          typeof emitter.listenerCount === "function"
            ? emitter.listenerCount("proposal_expire")
            : 0;
        if (count > 0) {
          emitter.removeAllListeners("proposal_expire");
        }
      }
    } catch { /* best-effort */ }
  } catch { /* non-critical */ }
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

// ── WalletConnect Core Warning Suppression ──

/**
 * WalletConnect Core is a global singleton whose init() gets called
 * multiple times internally by HashConnect's constructor chain and
 * our explicit init() call. Each redundant call logs:
 *   "WalletConnect Core is already initialized..."
 * This is a harmless warning (Core works fine after the first init),
 * but it clutters the console.
 *
 * APPROACH: We install a PERMANENT global filter on console.warn,
 * console.log, and console.error. A temporary wrapper (save → patch →
 * restore in finally) doesn't work because WalletConnect Core fires
 * some init() calls via deferred microtasks and async relay callbacks
 * that execute AFTER the wrapper's finally block restores the originals.
 *
 * The filter is installed once (idempotent) and stays active for the
 * entire page lifecycle. It ONLY suppresses the specific WC Core init
 * warning — all other console output passes through unchanged.
 */
const WC_INIT_MSG = "WalletConnect Core is already initialized";
const WC_DELETED_PAIRING_MSG = "Missing or invalid. Record was recently deleted";
const WC_NO_MATCHING_KEY_MSG = "No matching key.";
const WC_PROPOSAL_EXPIRED_MSG = "Proposal expired";
const WC_APPROVAL_ERROR_MSG = "Approval error";

const WC_MAX_LISTENERS_MSG = "MaxListenersExceededWarning";
const WC_MAX_LISTENERS_SHORT = "MaxListeners";
const WC_MEMORY_LEAK_MSG = "Possible EventEmitter memory leak";
const WC_FAILED_PUBLISH_MSG = "Failed to publish payload";
const WC_WEBSOCKET_FAILED_MSG = "WebSocket connection failed";
const WC_PUBLISH_PAYLOAD_MSG = "publish payload";
const WC_SOCKET_STALLED_MSG = "socket stalled";

function containsWCSuppressedMessage(args: any[]): boolean {
  const patterns = [
    WC_INIT_MSG,
    WC_DELETED_PAIRING_MSG,
    WC_NO_MATCHING_KEY_MSG,
    WC_PROPOSAL_EXPIRED_MSG,
    WC_APPROVAL_ERROR_MSG,
    WC_MAX_LISTENERS_MSG,
    WC_MAX_LISTENERS_SHORT,
    WC_MEMORY_LEAK_MSG,
    WC_FAILED_PUBLISH_MSG,
    WC_WEBSOCKET_FAILED_MSG,
    WC_PUBLISH_PAYLOAD_MSG,
    WC_SOCKET_STALLED_MSG,
    "session_connect listeners",
    "proposal_expire listeners",
    "emitting session_connect",
  ];
  // Known WC Pino logger contexts for noisy internal modules
  const pinoContexts = ["core/publisher", "core/relayer", "core", "client"];
  for (let i = 0; i < Math.min(args.length, 8); i++) {
    const a = args[i];
    // Build search string — check multiple property names used by
    // different loggers: .message (Error), .msg (Pino), .reason (Promise rejection)
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
      // Detect WC Pino structured log objects: {time, level, context}
      // These are emitted as the first argument with error text in subsequent args.
      if (typeof a.context === "string" && pinoContexts.includes(a.context)) {
        // Error level (50) or warn level (40) from a known WC context — suppress
        if (typeof a.level === "number" && a.level >= 40) return true;
      }
      // SAFETY: wrap JSON.stringify in try-catch to prevent errors from
      // circular objects or Proxy objects (e.g., Vite module runner internals).
      // A failed stringify just means we fall back to the property checks above.
      if (parts.length > 0) {
        str = parts.join(" ");
      } else {
        try {
          str = JSON.stringify(a).slice(0, 500);
        } catch {
          str = "";
        }
      }
    }
    for (const pattern of patterns) {
      if (str.includes(pattern)) return true;
    }
  }
  return false;
}

/**
 * Check if a console.log call is from HashConnect's internal logger.
 * HashConnect prefixes its log messages with "hashconnect" or "hashconnect -".
 * We only suppress console.log for HashConnect-specific error messages to
 * avoid interfering with Vite's HMR transport or other logging.
 */
function isHashConnectSuppressedLog(args: any[]): boolean {
  if (args.length === 0) return false;
  const first = args[0];
  if (typeof first !== "string") return false;
  // HashConnect internal logger prefixes with "hashconnect" (lowercase)
  if (!first.toLowerCase().startsWith("hashconnect")) return false;
  // Only suppress known non-actionable errors
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
    fullMsg.includes("socket stalled")
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
    if (containsWCSuppressedMessage(args)) return;
    origWarn.apply(console, args);
  };
  console.error = (...args: any[]) => {
    if (containsWCSuppressedMessage(args)) return;
    origError.apply(console, args);
  };
  // NOTE: We now patch console.log with a TARGETED filter that only
  // suppresses HashConnect-prefixed error messages (e.g., "hashconnect -
  // Approval error Error: Proposal expired"). General console.log calls
  // pass through unchanged, preserving Vite HMR transport and WC relay
  // communication.
  console.log = (...args: any[]) => {
    if (isHashConnectSuppressedLog(args)) return;
    origLog.apply(console, args);
  };
}

// NOTE: The WC init warning filter was previously installed here at module load
// time, but this caused "send was called before connect" errors in Vite 6 because
// patching console.warn/log/error during module evaluation interferes with Vite's
// HMR transport initialization. The filter is now installed lazily inside
// getReadyHashConnect() right before HashConnect is imported, which is the earliest
// point where WC warnings can actually occur.
//
// UPDATE: The PRIMARY console suppression now lives in polyfills.ts (the very first
// module loaded). It patches console.log/warn/error before any other module evaluates,
// ensuring that even if HashConnect's bundled code caches a reference to console.log
// at module evaluation time, that cached reference already points to our filtered
// version. installWCInitWarningFilter() below is now a REDUNDANT SAFETY NET — it
// adds an additional layer of filtering in case the polyfills.ts patch misses
// anything (e.g., a code path that doesn't match the hashconnect-prefix check).

// NOTE: Global `unhandledrejection` and `error` event handlers for WC errors
// were previously installed here at module-level, but they duplicate the handlers
// already in polyfills.ts (which loads first via App.tsx). Having them here added
// unnecessary side effects to module evaluation that could interfere with Vite's
// HMR transport during initial page load. The polyfills.ts handlers cover all the
// same WC error patterns and are sufficient.

/**
 * Check if the HashConnect SDK and @hashgraph/sdk are available
 * at runtime. This is cached after the first check.
 *
 * IMPORTANT: We do NOT import the hashconnect module here. Importing
 * it triggers WalletConnect Core initialization as a module-level
 * side effect (WC Core singleton is created when @walletconnect/core
 * is first imported by hashconnect's dependency chain). This causes
 * "WalletConnect Core is already initialized" when doCreateAndInit()
 * later creates a new HashConnect instance (whose constructor creates
 * another SignClient → another Core.init()).
 *
 * Since hashconnect and @hashgraph/sdk are bundled in our app, we
 * optimistically assume they're available. Actual availability is
 * verified at connection time in doCreateAndInit(), which handles
 * import failures gracefully.
 */
export async function isHashConnectSDKAvailable(): Promise<boolean> {
  if (_sdkAvailable !== null) return _sdkAvailable;
  if (_hashConnectInstance) {
    _sdkAvailable = true;
    return true;
  }
  // Optimistic: packages are bundled, so assume available.
  // doCreateAndInit() will verify and set _sdkAvailable = false if
  // the dynamic import fails at connection time.
  _sdkAvailable = true;
  return true;
}

/**
 * Get an initialized, ready-to-use HashConnect instance.
 *
 * This is the SINGLE entry point for obtaining a HashConnect instance.
 * It atomically handles construction + init() in one locked promise so
 * that WalletConnect Core's init() is never called more than once.
 *
 * If an instance already exists (even after a disconnect), it is reused
 * to avoid recreating the WalletConnect Core singleton.
 */
async function getReadyHashConnect(network: HederaNetwork): Promise<any> {
  // ── CRITICAL: Always reuse an existing instance ──
  // WalletConnect Core is a global singleton that CANNOT be re-initialized.
  // Creating a second HashConnect instance would call Core.init() again,
  // producing "WalletConnect Core is already initialized" errors.
  // We return the existing instance regardless of network or failure state.
  if (_hashConnectInstance) {
    if (_hashConnectNetwork && _hashConnectNetwork !== network) {
      console.warn(
        `[HBAR.h] HashConnect initialized for ${_hashConnectNetwork} — ` +
        `reusing for ${network}. A page reload is needed to truly switch networks.`
      );
    }
    return _hashConnectInstance;
  }

  // Start a new init if none is in flight or the previous one failed.
  // IMPORTANT: We only start ONE doCreateAndInit — if it's still running
  // (e.g., timed out on a previous call but still awaiting WC relay),
  // we share the same promise. This prevents creating multiple HashConnect
  // instances (WC Core singleton violation).
  if (!_readyPromise || _readyFailed) {
    _readyFailed = false;
    _readyPromise = doCreateAndInit(network);
    // Track fatal failures so the next caller can retry
    _readyPromise.catch(() => { _readyFailed = true; });
  }

  // ── SAFETY TIMEOUT ──
  // Race against a per-caller timeout. If doCreateAndInit hangs (e.g.,
  // WC relay unreachable), the caller gets an error after 30s. The actual
  // doCreateAndInit continues in the background — if it eventually succeeds,
  // _hashConnectInstance will be set and the next call returns instantly.
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
    // Even if init() had errors/timed out, if the instance was constructed
    // successfully (WC Core initialized), return it. The instance is still
    // usable for pairing — only some post-init setup may have failed.
    if (_hashConnectInstance) {
      console.warn("[HBAR.h] HashConnect init had errors but instance is usable — proceeding");
      return _hashConnectInstance;
    }
    throw err;
  }
}

/**
 * Atomic create + init. Called exactly once per page lifecycle.
 * The WC init warning filter is installed here (lazily) right before
 * importing hashconnect — this is the earliest point where WC warnings
 * can occur. Installing it here instead of at module-level avoids
 * patching console.warn/log/error during Vite's module evaluation phase,
 * which was causing "send was called before connect" HMR transport errors.
 */
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

  // Install the WC warning filter LAZILY — right before importing hashconnect.
  // This is the earliest point where WC Core can produce warnings (the import
  // triggers WC's module-level initialization). Installing it here instead of
  // at module-level prevents console patching during Vite's HMR setup phase.
  installWCInitWarningFilter();

  // Dynamic import to avoid top-level import issues
  const { HashConnect } = await import("hashconnect");
  const { LedgerId } = await import("@hashgraph/sdk");

  const ledgerId =
    network === "mainnet" ? LedgerId.MAINNET : LedgerId.TESTNET;

  // ── Pre-init cleanup: remove stale WC pairings from localStorage ──
  // This prevents "Record was recently deleted" errors that occur when
  // WalletConnect Core tries to update metadata for orphaned pairings
  // left over from a previous session.
  cleanStaleWCLocalStorage();

  // ── Construct ──
  // The constructor internally creates a WalletConnect SignClient,
  // which may initialize WC Core (counts as init #1 inside WC).
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
    // HashConnect v3 docs say: "Make sure you register your events before
    // calling init — as some events will fire immediately after calling init."
    //
    // We install PERMANENT event listeners that route to per-attempt callbacks.
    // If no callback is set yet (e.g., extension auto-pairs during init before
    // connectViaHashConnect sets its callback), we buffer the data.
    //
    // Guard: only register once, even if doCreateAndInit is retried after
    // a partial failure where the instance was kept alive.
    if (!_eventListenersRegistered) {
      _eventListenersRegistered = true;

      hc.pairingEvent.on((sessionData: any) => {
        console.log("[HBAR.h] pairingEvent fired:", sessionData?.accountIds);
        if (_currentPairingCallback) {
          _currentPairingCallback(sessionData);
        } else {
          // Buffer the pairing data — connectViaHashConnect will pick it up
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

    // ── CRITICAL: Install patches BEFORE init() ──
    // These patches MUST be applied before hc.init() because init() processes
    // stale WC proposals from localStorage. If a stale proposal has expired,
    // WC fires "proposal_expire" during init, and HashConnect's internal
    // handler calls console.error("hashconnect - Approval error", error).
    // By patching BEFORE init, we intercept the error at the source.

    // ── Monkey-patch updateMetadata to prevent "Record was recently deleted" ──
    patchPairingUpdateMetadata(hc);

    // ── Suppress WC pairing logger errors ──
    suppressPairingLoggerErrors(hc);

    // ── Patch publisher to prevent infinite retry storms ──
    patchPublisherRetry(hc);

    // ── Patch signClient.connect() to intercept "Proposal expired" ──
    // WC's connect() returns {uri, approval} where `approval` is a Promise
    // that rejects with "Proposal expired" after the 5-min TTL. HashConnect
    // awaits this promise and logs the error. By wrapping connect(), we
    // replace the approval Promise with one that silently swallows these
    // rejections. Also wraps approve() as a secondary safety net.
    patchSignClientApprove(hc);

    // ── Patch HashConnect's internal approval handler ──
    // HashConnect may have an internal method (e.g., _onSessionProposal,
    // _approveSession, onSessionProposal) that handles WC session proposals.
    // If the proposal is expired, the handler catches the WC error and logs
    // "hashconnect - Approval error Error: Proposal expired". We patch any
    // such handler to silently swallow "Proposal expired" errors.
    patchHashConnectApprovalHandler(hc);

    // ── Register proposal_expire handler on WC SignClient BEFORE init ──
    // When a WC proposal expires (~5 min TTL), auto-regenerate the
    // pairing string so the QR code stays valid. Registering before
    // init() ensures we catch any proposal_expire events that fire
    // during init from stale localStorage proposals.
    try {
      const signClient =
        hc.signClient ??
        hc.walletConnectClient ??
        hc._signClient ??
        hc.client;
      if (signClient?.on) {
        signClient.on("proposal_expire", async () => {
          console.log("[HBAR.h] WC proposal expired — auto-regenerating pairing string");
          try {
            cleanStalePairings(hc);
            const newUri = await regeneratePairingString(hc);
            if (newUri && _currentPairingStringCallback) {
              _currentPairingStringCallback(newUri);
              schedulePairingRefresh(hc);
            }
          } catch { /* non-critical */ }
        });
      }
    } catch { /* non-critical — event registration is best-effort */ }

    // ── Purge stale proposals BEFORE init to prevent expiration ──
    purgeAllProposals(hc);

    // ── Raise maxListeners on WC internal EventEmitters ──
    raiseMaxListeners(hc);

    // ── Init ──
    // hc.init() sets up internal WC event handlers and generates a pairing string.
    // If the HashPack extension is found, it will auto-connect and fire
    // pairingEvent — which our listener above will buffer.
    //
    // TIMEOUT: hc.init() internally connects to the WalletConnect relay
    // server via WebSocket. If the relay is slow or unreachable, init()
    // can hang indefinitely. We race it against a 20s timeout.
    // If init times out, the instance is still partially usable —
    // the constructor already initialized WC Core, so we can still
    // generate pairing strings and handle pairingEvent callbacks.
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

    // ── Clean stale WC pairings (post-init) ──
    cleanStalePairings(hc);

    // ── Defuse any proposals created during init ──
    // init() may have called connect() internally, creating proposals with
    // 5-minute TTL timers. Cancel those timers immediately so they can
    // never fire "Proposal expired".
    defuseAllProposalExpirers(hc);

    // ── Start background keepalive ──
    // Continuously regenerate the WC pairing every 2.5 minutes.
    // Uses pairing.create() (no proposal) to avoid "Proposal expired".
    // Falls back to generatePairingString() + immediate defuse.
    startBackgroundKeepalive(hc);

    return hc;
  } catch (err: any) {
    // IMPORTANT: Do NOT null _hashConnectInstance if the constructor
    // already succeeded (line above sets it). WalletConnect Core is
    // a singleton — if we null the instance and retry, the next
    // `new HashConnect()` call triggers Core.init() again, causing
    // "WalletConnect Core is already initialized" errors.
    // Only null the instance if construction itself failed.
    if (!_hashConnectInstance) {
      _hashConnectNetwork = null;
    }

    const msg = err?.message || String(err);

    // If the error is a WC "already initialized" warning surfaced
    // as an error, treat it as success — the instance is usable.
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

/**
 * Remove stale/inactive WalletConnect pairings to prevent
 * "No matching key. proposal" errors from orphaned proposals.
 *
 * IMPORTANT: We avoid calling signClient.core.pairing.disconnect() for
 * inactive pairings because that triggers an async updateMetadata() call
 * which crashes with "Missing or invalid. Record was recently deleted"
 * when the pairing store entry is already gone. Instead, we delete the
 * record directly from the pairing store.
 */
function cleanStalePairings(hc: any): void {
  try {
    // HashConnect v3 exposes the WC SignClient internally
    const signClient =
      hc.signClient ??
      hc.walletConnectClient ??
      hc._signClient ??
      hc.client;
    if (!signClient?.core?.pairing) return;

    const pairings = signClient.core.pairing.getPairings?.() ?? [];
    for (const p of pairings) {
      if (!p.active) {
        try {
          // Delete directly from the store instead of calling disconnect(),
          // which would trigger an async metadata update on a deleted record.
          const pairingStore = signClient.core.pairing.pairings ?? signClient.core.pairing.store;
          if (pairingStore && typeof pairingStore.delete === "function") {
            pairingStore.delete(p.topic, { code: 6000, message: "Stale pairing cleanup" });
          } else {
            // Fallback: try disconnect but catch async errors
            signClient.core.pairing.disconnect({ topic: p.topic }).catch(() => {});
          }
        } catch {
          /* best-effort */
        }
      }
    }

    // Also clear any expired proposals
    if (signClient.proposal) {
      const proposals = signClient.proposal.getAll?.() ?? [];
      const now = Date.now();
      for (const prop of proposals) {
        // Proposals older than 5 minutes are stale
        if (prop.expiry && prop.expiry * 1000 < now) {
          try {
            signClient.proposal.delete?.(prop.id, {
              code: 6000,
              message: "Expired proposal cleanup",
            });
          } catch {
            /* best-effort */
          }
        }
      }
    }
  } catch {
    // Non-critical — stale cleanup is best-effort
  }
}

/**
 * Pre-init cleanup: remove stale WalletConnect pairing data from localStorage.
 *
 * WalletConnect Core stores pairings in localStorage under keys like
 * "wc@2:core:0.3//pairing". If stale entries exist from a previous session,
 * they can cause "Record was recently deleted" errors when Core tries to
 * update metadata for pairings that no longer have matching relay subscriptions.
 *
 * This runs BEFORE HashConnect construction to ensure a clean slate.
 */
function cleanStaleWCLocalStorage(): void {
  try {
    const keysToCheck: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("wc@2:")) {
        keysToCheck.push(key);
      }
    }

    for (const key of keysToCheck) {
      // Clean pairing and proposal data (not core identity or keychain)
      if (key.includes("keychain") || key.includes("crypto")) continue;

      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);

        if (key.includes("pairing")) {
          // Pairings: filter out inactive ones
          if (Array.isArray(data)) {
            const active = data.filter((p: any) => p.active !== false);
            if (active.length !== data.length) {
              if (active.length === 0) {
                localStorage.removeItem(key);
              } else {
                localStorage.setItem(key, JSON.stringify(active));
              }
            }
          }
        } else if (key.includes("proposal")) {
          // Proposals: remove expired ones (proposals have a ~5min TTL)
          if (Array.isArray(data)) {
            const nowSec = Math.floor(Date.now() / 1000);
            const valid = data.filter(
              (p: any) => !p.expiry || p.expiry > nowSec
            );
            if (valid.length !== data.length) {
              if (valid.length === 0) {
                localStorage.removeItem(key);
              } else {
                localStorage.setItem(key, JSON.stringify(valid));
              }
            }
          }
        }
      } catch {
        // If we can't parse it, leave it alone
      }
    }
  } catch {
    // Non-critical
  }
}

/**
 * Monkey-patch WalletConnect Core's pairing engine to prevent
 * "Record was recently deleted" errors from updateMetadata().
 *
 * WC Core's pairing engine calls updateMetadata() asynchronously
 * from an internal EventEmitter callback. If the pairing was already deleted
 * (by cleanStalePairings, disconnect, or WC's own GC), updateMetadata throws
 * because it calls getData() which checks a "recently deleted" set. This error
 * propagates as an uncaught error or unhandled rejection. We patch the method
 * to silently swallow these specific errors at the source.
 */
function patchPairingUpdateMetadata(hc: any): void {
  try {
    // HashConnect v3 exposes the WC SignClient internally
    const signClient =
      hc.signClient ??
      hc.walletConnectClient ??
      hc._signClient ??
      hc.client;
    if (!signClient?.core?.pairing) return;

    const pairing = signClient.core.pairing;
    const originalUpdateMetadata = pairing.updateMetadata;
    if (!originalUpdateMetadata || pairing.__hbarh_patched) return;
    pairing.__hbarh_patched = true;

    pairing.updateMetadata = function (...args: any[]) {
      try {
        const result = originalUpdateMetadata.apply(this, args);
        // Handle async case — updateMetadata may return a Promise
        if (result && typeof result.catch === "function") {
          return result.catch((err: any) => {
            const msg = err?.message || "";
            if (
              msg.includes("Record was recently deleted") ||
              msg.includes("Missing or invalid")
            ) {
              // Silently swallow
              return;
            }
            throw err;
          });
        }
        return result;
      } catch (err: any) {
        const msg = err?.message || "";
        if (
          msg.includes("Record was recently deleted") ||
          msg.includes("Missing or invalid")
        ) {
          // Silently swallow this specific error
          return;
        }
        // Re-throw other errors
        throw err;
      }
    };

    // Also patch the underlying pairing store's update method if accessible
    const pairingStore = pairing.pairings ?? pairing.store;
    if (pairingStore && pairingStore.update && !pairingStore.__hbarh_patched) {
      pairingStore.__hbarh_patched = true;
      const originalStoreUpdate = pairingStore.update;
      pairingStore.update = function (...args: any[]) {
        // Pre-check: if the first arg is a topic/key, verify the record still
        // exists BEFORE calling the original. WC's internal getData() logs the
        // error and THEN throws, so catching after is too late to suppress the log.
        const topic = args[0];
        if (typeof topic === "string") {
          try {
            const allRecords = typeof this.getAll === "function" ? this.getAll() : null;
            if (allRecords && !(topic in allRecords)) {
              // Record doesn't exist (deleted) — skip silently
              return;
            }
          } catch {
            // getAll might not exist or fail — fall through to original
          }
        }
        try {
          const result = originalStoreUpdate.apply(this, args);
          if (result && typeof result.catch === "function") {
            return result.catch((err: any) => {
              const msg = err?.message || "";
              if (
                msg.includes("Record was recently deleted") ||
                msg.includes("Missing or invalid")
              ) {
                return;
              }
              throw err;
            });
          }
          return result;
        } catch (err: any) {
          const msg = err?.message || "";
          if (
            msg.includes("Record was recently deleted") ||
            msg.includes("Missing or invalid")
          ) {
            return;
          }
          throw err;
        }
      };

      // Also patch getData to suppress the log+throw for deleted records.
      // getData is where WC actually logs "Missing or invalid" before throwing.
      if (pairingStore.getData && !pairingStore.__hbarh_getData_patched) {
        pairingStore.__hbarh_getData_patched = true;
        const originalGetData = pairingStore.getData;
        pairingStore.getData = function (...args: any[]) {
          try {
            return originalGetData.apply(this, args);
          } catch (err: any) {
            const msg = err?.message || "";
            if (
              msg.includes("Record was recently deleted") ||
              msg.includes("Missing or invalid")
            ) {
              return undefined;
            }
            throw err;
          }
        };
      }
    }
  } catch {
    // Non-critical — patching is best-effort
  }
}

/**
 * Suppress WalletConnect's internal Pino logger from emitting "Record was recently
 * deleted" error logs. WC logs the error BEFORE throwing it, so our catch-patches
 * alone can't prevent the console output. We walk the internal logger hierarchy
 * and wrap the `error` method to filter these specific messages.
 */
function suppressPairingLoggerErrors(hc: any): void {
  try {
    const signClient =
      hc.signClient ??
      hc.walletConnectClient ??
      hc._signClient ??
      hc.client;
    if (!signClient?.core?.pairing) return;

    // Walk known logger locations in WC's internal structure AND
    // HashConnect's own logger (which prefixes messages with "hashconnect -")
    const loggerTargets = [
      signClient.core?.pairing?.logger,
      signClient.core?.pairing?.pairings?.logger,
      signClient.core?.pairing?.store?.logger,
      signClient.core?.logger,
      signClient.logger,
      // SignClient Engine — where session_connect/proposal handlers live
      signClient.engine?.logger,
      // Relayer & Publisher — where "Failed to publish payload" / "WebSocket
      // connection failed" errors originate. These fire hundreds of times when
      // the WC relay WebSocket is unreachable.
      signClient.core?.relayer?.logger,
      signClient.core?.relayer?.publisher?.logger,
      signClient.core?.relayer?.subscriber?.logger,
      signClient.core?.relayer?.provider?.logger,
      // HashConnect's own logger instance
      hc.logger,
      hc._logger,
    ];

    for (const logger of loggerTargets) {
      if (!logger || logger.__hbarh_error_patched) continue;

      // Patch error method
      const origError = logger.error;
      if (typeof origError === "function") {
        logger.__hbarh_error_patched = true;
        logger.error = function (...args: any[]) {
          const msgStr = args.map((a: any) =>
            typeof a === "string" ? a : typeof a === "object" ? JSON.stringify(a) : String(a)
          ).join(" ");
          if (
            msgStr.includes("Record was recently deleted") ||
            msgStr.includes("Missing or invalid") ||
            msgStr.includes("Proposal expired") ||
            msgStr.includes("Approval error") ||
            msgStr.includes("Failed to publish payload") ||
            msgStr.includes("WebSocket connection failed") ||
            msgStr.includes("publish payload") ||
            msgStr.includes("socket stalled")
          ) {
            return;
          }
          return origError.apply(this, args);
        };
      }

      // Also patch warn method — WC Core logs "already initialized" via logger.warn
      const origWarn = logger.warn;
      if (typeof origWarn === "function" && !logger.__hbarh_warn_patched) {
        logger.__hbarh_warn_patched = true;
        logger.warn = function (...args: any[]) {
          const msgStr = args.map((a: any) =>
            typeof a === "string" ? a : typeof a === "object" ? JSON.stringify(a) : String(a)
          ).join(" ");
          if (
            msgStr.includes("already initialized") ||
            msgStr.includes("Already initialized") ||
            msgStr.includes("Proposal expired")
          ) {
            return;
          }
          return origWarn.apply(this, args);
        };
      }
    }
  } catch {
    // Non-critical — logger patching is best-effort
  }
}

/**
 * Patch WalletConnect's publisher to limit retry storms.
 *
 * When the WC relay WebSocket connection fails, the publisher's publish()
 * method rejects with "Failed to publish payload" for every pending message.
 * WC's relay then re-queues these messages, creating an infinite retry loop
 * that floods the console with hundreds of errors per second. This function
 * patches the publisher's publish method to silently swallow publish failures
 * and limit the retry noise.
 *
 * We also patch the relayer's transportOpen/reconnect logic to prevent
 * it from emitting errors on each failed WebSocket open attempt.
 */
function patchPublisherRetry(hc: any): void {
  try {
    const signClient =
      hc?.signClient ??
      hc?._signClient ??
      hc?.walletConnectClient ??
      hc?.client;
    if (!signClient?.core?.relayer) return;

    const relayer = signClient.core.relayer;

    // ── Patch publisher.publish to catch "Failed to publish payload" ──
    const publisher = relayer.publisher;
    if (publisher && typeof publisher.publish === "function" && !publisher.__hbarh_publish_patched) {
      publisher.__hbarh_publish_patched = true;
      const origPublish = publisher.publish.bind(publisher);
      publisher.publish = async function (...args: any[]) {
        try {
          return await origPublish(...args);
        } catch (err: any) {
          const msg = err?.message || "";
          if (
            msg.includes("Failed to publish") ||
            msg.includes("WebSocket connection failed") ||
            msg.includes("socket stalled")
          ) {
            // Silently swallow — the relay is unreachable. The relayer's
            // own reconnect logic will re-establish the connection.
            return;
          }
          throw err;
        }
      };
    }

    // ── Patch relayer.request to catch publish-related errors ──
    if (typeof relayer.request === "function" && !relayer.__hbarh_request_patched) {
      relayer.__hbarh_request_patched = true;
      const origRequest = relayer.request.bind(relayer);
      relayer.request = async function (...args: any[]) {
        try {
          return await origRequest(...args);
        } catch (err: any) {
          const msg = err?.message || "";
          if (
            msg.includes("Failed to publish") ||
            msg.includes("WebSocket connection failed") ||
            msg.includes("socket stalled")
          ) {
            return;
          }
          throw err;
        }
      };
    }

    // ── Patch the WebSocket provider's onerror to limit noise ──
    // The provider emits an error event for every failed WS connection,
    // which surfaces as "WebSocket connection failed for host: wss://..."
    const provider = relayer.provider;
    if (provider && !provider.__hbarh_error_patched) {
      provider.__hbarh_error_patched = true;
      // Override emitError if it exists (WC's JsonRpcProvider)
      if (typeof provider.emitError === "function") {
        const origEmitError = provider.emitError.bind(provider);
        provider.emitError = function (err: any) {
          const msg = err?.message || String(err || "");
          if (
            msg.includes("WebSocket connection failed") ||
            msg.includes("Failed to publish") ||
            msg.includes("socket stalled")
          ) {
            return; // Swallow WebSocket connection errors silently
          }
          return origEmitError(err);
        };
      }
    }
  } catch {
    // Non-critical — publisher patching is best-effort
  }
}

/**
 * Patch signClient.connect() to intercept the `approval` Promise it returns.
 *
 * WC's signClient.connect() returns {uri, approval} where `approval` is a
 * Promise that rejects with Error("Proposal expired") when the 5-min TTL hits.
 * HashConnect awaits this promise and catches the rejection, logging:
 *   console.error("hashconnect - Approval error", error)
 *
 * Previous attempts patched signClient.approve() — but the error doesn't come
 * from approve(). It comes from the `approval` Promise rejection inside
 * connect(). By wrapping connect() itself, we intercept the approval Promise
 * and replace it with one that silently swallows "Proposal expired" rejections.
 *
 * We also wrap approve() as a secondary safety net.
 */
function patchSignClientApprove(hc: any): void {
  try {
    const signClient =
      hc?.signClient ??
      hc?._signClient ??
      hc?.walletConnectClient ??
      hc?.client;
    if (!signClient) return;

    // ── PRIMARY FIX: Wrap signClient.connect() ──
    // Intercept the approval Promise to silently handle "Proposal expired".
    const wrapConnect = (target: any) => {
      if (!target || typeof target.connect !== "function") return;
      if (target.__hbarh_connect_patched) return;
      target.__hbarh_connect_patched = true;
      const origConnect = target.connect;
      target.connect = async function (this: any, ...args: any[]) {
        const result = await origConnect.apply(this, args);
        if (result && result.approval && typeof result.approval.then === "function") {
          const origApproval = result.approval;
          // Replace the approval Promise with one that silently swallows
          // "Proposal expired" / "No matching key" rejections.
          // The replacement STILL rejects for other errors so HashConnect
          // can handle genuine failures.
          result.approval = new Promise((resolve, reject) => {
            origApproval.then(resolve, (err: any) => {
              const msg = err?.message || String(err || "");
              if (
                msg.includes("Proposal expired") ||
                msg.includes("No matching key")
              ) {
                // Silently swallow — return a never-resolving promise.
                // HashConnect's `await approval` will hang harmlessly
                // for this expired proposal; the keepalive will generate
                // a fresh one. This prevents the console.error log.
                return;
              }
              reject(err);
            });
          });
          // Also add a no-op .catch() on the ORIGINAL promise to prevent
          // unhandled rejection warnings from the browser.
          origApproval.catch(() => {});
        }
        return result;
      };
    };

    wrapConnect(signClient);
    if (signClient.engine) {
      wrapConnect(signClient.engine);
    }

    // ── SECONDARY SAFETY NET: Wrap approve() ──
    const wrapApprove = (target: any, methodName: string) => {
      if (!target || typeof target[methodName] !== "function") return;
      const patchKey = `__hbarh_${methodName}_patched`;
      if (target[patchKey]) return;
      target[patchKey] = true;
      const original = target[methodName].bind(target);
      target[methodName] = async function (...args: any[]) {
        try {
          return await original(...args);
        } catch (err: any) {
          const msg = err?.message || "";
          if (msg.includes("Proposal expired") || msg.includes("No matching key")) {
            return null;
          }
          throw err;
        }
      };
    };

    wrapApprove(signClient, "approve");
    if (signClient.engine) {
      wrapApprove(signClient.engine, "approve");
      wrapApprove(signClient.engine, "approveSession");
    }

    // ── TERTIARY SAFETY NET: Wrap HC's generatePairingString() ──
    // HashConnect's generatePairingString() calls signClient.connect()
    // internally and chains .catch() on the approval Promise INSIDE the
    // method body. Our connect() wrapper replaces result.approval, but
    // the .catch() is chained before the result is returned. By wrapping
    // generatePairingString itself, we intercept any error that leaks.
    if (typeof hc.generatePairingString === "function" && !hc.__hbarh_genPairing_patched) {
      hc.__hbarh_genPairing_patched = true;
      const origGen = hc.generatePairingString.bind(hc);
      hc.generatePairingString = async function (...args: any[]) {
        try {
          return await origGen(...args);
        } catch (err: any) {
          const msg = err?.message || "";
          if (msg.includes("Proposal expired") || msg.includes("No matching key")) {
            return; // silently swallow
          }
          throw err;
        }
      };
    }
  } catch { /* non-critical */ }
}

/**
 * Patch HashConnect's internal session proposal / approval error handler.
 *
 * HashConnect registers its own handler for WC session proposals. When the
 * handler calls signClient.approve() and it fails (e.g., "Proposal expired"),
 * HashConnect catches the error and logs it via console.log with the prefix
 * "hashconnect". We patch the handler to silently swallow these specific errors.
 *
 * This function tries several known internal method names that HashConnect
 * versions may use for the approval flow.
 */
function patchHashConnectApprovalHandler(hc: any): void {
  try {
    // Known method names used by different HashConnect versions
    const handlerNames = [
      "_onSessionProposal",
      "onSessionProposal",
      "_approveSession",
      "approveSession",
      "_handleSessionProposal",
      "handleSessionProposal",
    ];

    for (const name of handlerNames) {
      if (typeof hc[name] === "function" && !hc[`__hbarh_${name}_patched`]) {
        hc[`__hbarh_${name}_patched`] = true;
        const original = hc[name].bind(hc);
        hc[name] = async function (...args: any[]) {
          try {
            return await original(...args);
          } catch (err: any) {
            const msg = err?.message || "";
            if (
              msg.includes("Proposal expired") ||
              msg.includes("Approval error") ||
              msg.includes("No matching key")
            ) {
              // Silently swallow
              return;
            }
            throw err;
          }
        };
      }
    }

    // Also patch the prototype if the methods live there
    const proto = Object.getPrototypeOf(hc);
    if (proto && proto !== Object.prototype) {
      for (const name of handlerNames) {
        if (typeof proto[name] === "function" && !proto[`__hbarh_${name}_patched`]) {
          proto[`__hbarh_${name}_patched`] = true;
          const original = proto[name];
          proto[name] = async function (this: any, ...args: any[]) {
            try {
              return await original.apply(this, args);
            } catch (err: any) {
              const msg = err?.message || "";
              if (
                msg.includes("Proposal expired") ||
                msg.includes("Approval error") ||
                msg.includes("No matching key")
              ) {
                return;
              }
              throw err;
            }
          };
        }
      }
    }
  } catch { /* non-critical */ }
}

/**
 * Raise the maxListeners limit on WalletConnect's internal EventEmitters.
 *
 * WC's relay, SignClient, and Core all use EventEmitter under the hood.
 * Each pairing attempt adds internal listeners (e.g. "relayer_message")
 * that persist for the lifetime of the instance. Because we keep a single
 * HashConnect instance alive for the entire page lifecycle, the listener
 * count grows across connect/disconnect cycles, eventually exceeding the
 * default Node-style limit of 10 and triggering MaxListenersExceededWarning.
 *
 * CRITICAL: We also cover signClient.engine and signClient.engine.events.
 * Each regeneratePairingString() call can trigger SignClient.connect()
 * internally, which adds a once("session_connect") listener on the engine's
 * event emitter. The background keepalive calls regeneratePairingString
 * every 4 minutes, so after ~40 min the listener count hits the default 10
 * limit. The engine emitter was previously missing from this function,
 * causing the MaxListenersExceededWarning to leak through.
 *
 * We bump to 200 to give ample headroom for very long-running sessions
 * (e.g., a user leaves the tab open for hours). Additionally, we try to
 * set EventEmitter.defaultMaxListeners globally so ANY new emitter created
 * by WC internals also inherits the higher limit.
 */
function raiseMaxListeners(hc: any): void {
  // 0 = unlimited. WC's signClient.connect() adds once("session_connect") and
  // on("proposal_expire") listeners per-proposal. When proposals are purged
  // before natural expiry, these listeners orphan and accumulate. Setting to 0
  // prevents MaxListenersExceededWarning while cleanStaleEngineListeners
  // handles periodic cleanup.
  const LIMIT = 0;
  const bump = (obj: any) => {
    if (obj && typeof obj.setMaxListeners === "function") {
      try { obj.setMaxListeners(LIMIT); } catch { /* ignore */ }
    }
  };

  try {
    // ── Global EventEmitter.defaultMaxListeners ──
    // If we can find the EventEmitter constructor from any of WC's internal
    // emitters, set the static defaultMaxListeners property. This ensures
    // that ANY new EventEmitter created later (e.g., by WC's relay reconnect
    // or new pairing engine instances) starts with a high limit.
    try {
      const events = (globalThis as any).EventEmitter;
      if (events && typeof events.defaultMaxListeners === "number") {
        events.defaultMaxListeners = LIMIT;
      }
    } catch { /* ignore */ }

    // HashConnect's own event emitters
    bump(hc.pairingEvent);
    bump(hc.connectionStatusChangeEvent);
    bump(hc.disconnectionEvent);

    // WalletConnect SignClient → Core → Relayer chain
    const signClient =
      hc.signClient ??
      hc.walletConnectClient ??
      hc._signClient ??
      hc.client;
    if (!signClient) return;

    bump(signClient);
    bump(signClient.events);

    // Try to set defaultMaxListeners on the constructor of the emitter
    // (covers EventEmitter2 which WC uses internally)
    try {
      const EmitterCtor = signClient.constructor || signClient.events?.constructor;
      if (EmitterCtor && typeof EmitterCtor.defaultMaxListeners === "number") {
        EmitterCtor.defaultMaxListeners = LIMIT;
      }
    } catch { /* ignore */ }

    // ── CRITICAL: SignClient Engine ──
    // signClient.engine.events is where session_connect, session_proposal,
    // session_request etc. listeners accumulate. Each connect() call adds
    // a once("session_connect") listener. This was the missing piece that
    // caused the MaxListenersExceededWarning.
    const engine = signClient.engine;
    if (engine) {
      bump(engine);
      bump(engine.events);
      // Also try the engine's constructor for defaultMaxListeners
      try {
        const EngineCtor = engine.events?.constructor || engine.constructor;
        if (EngineCtor && typeof EngineCtor.defaultMaxListeners === "number") {
          EngineCtor.defaultMaxListeners = LIMIT;
        }
      } catch { /* ignore */ }
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
    bump(core.pairing?.engine);
    bump(core.pairing?.engine?.events);
    bump(core.heartbeat);
    bump(core.heartbeat?.events);
    bump(core.crypto);
    bump(core.crypto?.events);
    bump(core.history);
    bump(core.history?.events);
    bump(core.expirer);
    bump(core.expirer?.events);
    bump(core.verify);
    bump(core.verify?.events);
  } catch {
    // Non-critical — if we can't raise limits, the worst case is a
    // console warning, not a functional failure.
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
 *
 * IMPORTANT: We keep the HashConnect instance alive — WalletConnect Core
 * is a singleton that cannot be re-initialized. Nulling the instance would
 * force a new `new HashConnect()` on the next connect, triggering
 * "WalletConnect Core is already initialized" errors.
 *
 * This function disconnects the active session but preserves the instance
 * for reuse by getReadyHashConnect().
 */
export async function resetHashConnectInstance(): Promise<void> {
  // Clear pairing refresh state
  if (_pairingRefreshTimer) {
    clearTimeout(_pairingRefreshTimer);
    _pairingRefreshTimer = null;
  }
  _currentPairingStringCallback = null;
  stopBackgroundKeepalive();

  if (_hashConnectInstance) {
    try {
      await _hashConnectInstance.disconnect();
    } catch {
      /* ignore */
    }
    // Clean stale pairings after reset
    cleanStalePairings(_hashConnectInstance);
  }
  // DO NOT null _hashConnectInstance or _hashConnectNetwork — reuse on next connect.
  // But DO reset the promise lock so getReadyHashConnect() can retry if needed.
  _readyPromise = null;
  _readyFailed = false;
  // Clear buffered pairing data from any previous attempt
  _bufferedPairingData = null;
}

/**
 * Force-reset the HashConnect instance completely ("nuclear option").
 *
 * This DESTROYS the cached instance and resets ALL internal state so that
 * the next connection attempt creates a brand-new HashConnect + WC Core.
 * WC Core's re-initialization will trigger an "already initialized" error
 * which doCreateAndInit() already handles as non-fatal.
 *
 * Use this after clearing WC localStorage — the existing instance's internal
 * WC Core state references localStorage data that no longer exists, making
 * it unsafe to reuse.
 *
 * NOTE: This should only be used as a last resort (e.g., the "Clear & Retry"
 * button in the error UI). Normal disconnect/reconnect cycles should use
 * disconnectHashConnect() which preserves the instance for reuse.
 */
export async function forceResetHashConnect(): Promise<void> {
  // Abort any in-flight connection
  abortActiveConnection();
  stopBackgroundKeepalive();

  // Clear all per-attempt callbacks
  _currentPairingCallback = null;
  _currentStateCallback = null;
  _currentDisconnectCallback = null;
  _bufferedPairingData = null;

  // Try to gracefully disconnect before destroying
  if (_hashConnectInstance) {
    try {
      await _hashConnectInstance.disconnect();
    } catch { /* ignore */ }
  }

  // Destroy the instance — the next getReadyHashConnect() will create a new one
  _hashConnectInstance = null;
  _hashConnectNetwork = null;
  _readyPromise = null;
  _readyFailed = false;
  _sdkAvailable = null;

  // Reset the event listener guard so they're re-registered on the new instance
  _eventListenersRegistered = false;

  console.log("[HBAR.h] HashConnect instance force-reset — next connect will create a fresh instance");
}

/**
 * Clear WalletConnect localStorage data.
 *
 * @param preserveIdentity If true, keeps WC Core's identity/keychain keys
 *   so the relay can re-authenticate. If false, wipes everything (true nuclear).
 * @returns Number of keys removed.
 */
export function clearWCStorage(preserveIdentity = false): number {
  let removed = 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Match WC v2 keys (wc@2:*) and WC v1 keys (wc@1:*)
      const isWC = key.startsWith("wc@2:") || key.startsWith("wc@1:");
      // Match hashconnect-specific keys
      const isHC = key.startsWith("hashconnect") || key.includes("walletconnect");

      if (isWC || isHC) {
        // Optionally preserve WC Core identity/keychain for relay auth
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

/**
 * Detect if HashPack browser extension is installed.
 * HashPack injects providers via:
 * - window.hashpack (direct extension API)
 * - window.hashconnect (HashConnect injected provider)
 * - EIP-6963 provider announcements
 * - HIP-820 hedera provider injection
 */
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

/**
 * Detect the HashPack extension with a delayed retry.
 * The extension's content script may inject its provider after DOMContentLoaded,
 * so an immediate check can miss it. This polls up to `maxWaitMs` before giving up.
 */
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

/**
 * Try to trigger the HashPack extension directly.
 *
 * HashConnect v3 keeps `connectToExtension` and `findLocalWallets` as private
 * methods. At runtime, however, we can access them via bracket notation.
 * This helper attempts that, failing silently if the methods are mangled/removed.
 *
 * Also posts a message event that the extension's content script may be listening for.
 */
export async function tryExtensionDirect(hc: any): Promise<boolean> {
  // Strategy 1: call the private connectToExtension() method
  try {
    if (typeof hc.connectToExtension === "function") {
      console.log("[HBAR.h] Calling hc.connectToExtension()...");
      await hc.connectToExtension();
      return true;
    }
  } catch (e) {
    console.warn("[HBAR.h] connectToExtension() failed:", e);
  }

  // Strategy 2: call the private findLocalWallets() method
  try {
    if (typeof hc.findLocalWallets === "function") {
      console.log("[HBAR.h] Calling hc.findLocalWallets()...");
      await hc.findLocalWallets();
      return true;
    }
  } catch (e) {
    console.warn("[HBAR.h] findLocalWallets() failed:", e);
  }

  // Strategy 3: post a HashPack-specific extension handshake message
  try {
    if (typeof window !== "undefined") {
      window.postMessage(
        { type: "hashconnect-query-extension-id", source: "dapp" },
        "*"
      );
      console.log("[HBAR.h] Posted hashconnect extension query message");
    }
  } catch { /* non-critical */ }

  return false;
}

/**
 * Try to open the HashPack extension via its custom URI scheme.
 * If a WC pairing URI is available, embeds it so the extension
 * immediately starts pairing. Otherwise opens the extension bare.
 *
 * Returns true if the open was attempted (no guarantee it worked —
 * browsers silently fail for unregistered URI schemes).
 */
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

/**
 * Resolve an EVM address (0x...) to a Hedera account ID (0.0.xxxxx)
 * via the Hedera Mirror Node accounts API.
 */
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

/**
 * Resolve a Hedera account ID to its EVM address via Mirror Node.
 */
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

/**
 * Fetch user profile from the HashPack / HashConnect API.
 * Uses the built-in HashConnect helper if SDK is loaded,
 * otherwise falls back to direct POST to the API.
 */
export async function fetchHashPackProfile(
  accountId: string,
  network: HederaNetwork
): Promise<HashPackProfile | null> {
  // Try the SDK helper first (uses caching)
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

  // Fallback: direct API call
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
 * internally via `init()` + event listeners. This method:
 * 1. Gets the singleton HashConnect instance (created + initialized exactly once)
 * 2. Routes the permanent `pairingEvent` listener to this attempt's callback
 * 3. If no extension is found, provides the pairing string for WalletConnect QR
 * 4. Tries to regenerate the pairing string on reconnection attempts
 *
 * IMPORTANT: Event listeners are registered PERMANENTLY in doCreateAndInit()
 * (before init(), as required by HashConnect v3). This function only sets the
 * per-attempt callback that those listeners delegate to.
 *
 * @param network - "mainnet" | "testnet"
 * @param onPairingString - Callback when a WalletConnect pairing string is generated (for QR display)
 * @param onConnectionState - Callback for connection state changes
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

    // Abort any in-flight connection attempt (cleans up old callbacks + timers)
    abortActiveConnection();

    // ── Check for buffered pairing data (extension auto-paired during init) ──
    if (_bufferedPairingData) {
      const buffered = _bufferedPairingData;
      _bufferedPairingData = null;
      console.log("[HBAR.h] Using buffered pairing data from init:", buffered?.accountIds);
      return await buildSessionFromPairingData(buffered, network, "hashconnect");
    }

    // ── Check if already paired (e.g., connectedAccountIds from a prior session) ──
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
    } catch { /* ignore — connectedAccountIds may not exist */ }

    // ── Attempt explicit extension connection ──
    // HashConnect v3's private methods may be accessible at runtime.
    // Also try a delayed extension detection (injection can be slow).
    // NOTE: Reduced from 2000ms to 1500ms to avoid excessive wait time
    // when no extension is present (most common case for WC pairing).
    onConnectionState?.("Searching for extension...");
    const extensionFound = await detectHashPackExtension(1500);

    if (extensionFound) {
      console.log("[HBAR.h] Extension detected — attempting direct connection");
      onConnectionState?.("Extension found — connecting...");

      // Try calling private connectToExtension / findLocalWallets
      await tryExtensionDirect(hc);

      // Give the extension up to 5s to auto-pair after the direct trigger
      const extPairWaitMs = 5000;
      const extPairInterval = 500;
      let extWaited = 0;
      while (extWaited < extPairWaitMs) {
        // Check if buffered pairing data arrived
        if (_bufferedPairingData) {
          const buffered = _bufferedPairingData;
          _bufferedPairingData = null;
          console.log("[HBAR.h] Extension auto-paired after direct trigger:", buffered?.accountIds);
          return await buildSessionFromPairingData(buffered, network, "hashconnect");
        }
        // Check connectedAccountIds
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

    // ── Pre-connection cleanup ──
    // Clean expired proposals and stale pairings from WC's internal store.
    // This prevents "Proposal expired" errors from orphaned proposals left
    // over from a previous connection attempt or init().
    cleanStalePairings(hc);

    // ── Generate a fresh pairing string for this connection attempt ──
    // The pairing string from init() may have expired (WC proposals have
    // a ~5 minute TTL). We always regenerate to ensure freshness.
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
      }, 120000); // 2 minute timeout

      // Track timer so abortActiveConnection can clear it
      _activeTimer = timer;

      const cleanup = () => {
        // Clear per-attempt callbacks
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

      // Register cleanup so future connection attempts can abort us
      _activeCleanup = cleanup;

      // ── Set per-attempt callbacks for the permanent event listeners ──
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

        // ── Set up auto-refresh for the pairing string ──
        // WC proposals expire after ~5 minutes. We proactively regenerate
        // at 4 minutes so the QR code is always valid. The onPairingString
        // callback updates the UI with the fresh URI.
        _currentPairingStringCallback = onPairingString;
        schedulePairingRefresh(hc);

        // If extension was detected, also try the hashpack:// deep link
        // to automatically trigger the extension to open and process the URI
        if (extensionFound) {
          console.log("[HBAR.h] Extension detected — triggering hashpack:// deep link with pairing URI");
          openHashPackExtension(hc.pairingString);
        }
      } else if (!hc.pairingString) {
        // No pairing string available — both generation strategies failed
        // and init() didn't produce one. This usually means the WC relay
        // was completely unreachable. Resolve with an error instead of
        // leaving the UI hanging on "Generating pairing string..." forever.
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
 * Shared by connectViaHashConnect, openHashConnectPairingModal,
 * and the buffered-pairing-data path.
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

  // Resolve EVM address (non-blocking failure)
  let evmAddress = "";
  try {
    evmAddress = (await resolveAccountIdToEvm(accountId, network)) || "";
  } catch { /* non-critical */ }

  // Fetch profile (non-blocking failure)
  let profile: HashPackProfile | null = null;
  try {
    profile = await fetchHashPackProfile(accountId, network);
  } catch { /* non-critical */ }

  const session: HashPackSession = {
    accountId,
    evmAddress,
    network,
    connectedAt: Date.now(),
    isVerified: true, // SDK-connected = verified
    connectionMethod,
    profile,
  };

  persistSession(session);
  return { success: true, session, error: null };
}

/**
 * Open the HashConnect built-in pairing modal.
 * This provides a styled WalletConnect pairing dialog from the SDK itself.
 * Uses the singleton initialized instance.
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

    // Abort any in-flight connection attempt (cleans up old callbacks + timers)
    abortActiveConnection();

    // Clean expired proposals before opening the modal to prevent
    // "Proposal expired" errors from stale WC proposals.
    cleanStalePairings(hc);

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

      // Track timer so abortActiveConnection can clear it
      _activeTimer = timer;

      const cleanup = () => {
        _currentPairingCallback = null;
        _currentStateCallback = null;
        _currentDisconnectCallback = null;
        if (_activeCleanup === cleanup) _activeCleanup = null;
        if (_activeTimer === timer) _activeTimer = null;
      };

      // Register cleanup so future connection attempts can abort us
      _activeCleanup = cleanup;

      // Set per-attempt callback for the permanent pairingEvent listener
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

      // Open the SDK's built-in pairing modal
      hc.openPairingModal(
        themeMode,
        themeMode === "dark" ? "#0a0a0f" : "#ffffff",
        "#ec4899", // pink accent
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
 * This doesn't require the HashConnect SDK — it uses the Mirror Node
 * to fetch account data given an account ID. No signing capability.
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

/**
 * Disconnect the current HashConnect session.
 *
 * IMPORTANT: We intentionally keep the HashConnect instance alive and
 * DON'T reset the ready promise. WalletConnect Core is a global singleton
 * that cannot be re-initialized. If we destroyed the instance here,
 * the next connection attempt would create a new one, triggering
 * "WalletConnect Core is already initialized" errors.
 *
 * The instance will be reused for the next connection via getReadyHashConnect().
 */
export async function disconnectHashConnect(): Promise<void> {
  // Clear any active connection attempt callbacks
  _currentPairingCallback = null;
  _currentStateCallback = null;
  _currentDisconnectCallback = null;
  _bufferedPairingData = null;
  abortActiveConnection();
  stopBackgroundKeepalive();

  if (_hashConnectInstance) {
    try {
      await _hashConnectInstance.disconnect();
    } catch {
      /* ignore */
    }
    // Clean up stale pairings after disconnect
    cleanStalePairings(_hashConnectInstance);
    // DO NOT null the instance — it will be reused on next connect
  }
  clearSession();
}

// ── Message Signing ──

/**
 * Sign a message using the connected HashPack wallet.
 * Requires an active HashConnect SDK session.
 *
 * @param accountId - The account to sign with
 * @param message - The message to sign
 * @returns The signed message or null if signing failed
 */
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

/**
 * Restore a saved HashPack session from localStorage.
 * Validates the session age (24h max).
 */
export function restoreSession(): HashPackSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.session);
    if (!raw) return null;

    const session: HashPackSession = JSON.parse(raw);

    // Validate session age (24 hours max)
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

/**
 * Clear the stored HashPack session.
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.session);
    localStorage.removeItem("hbarh-hedera-account");
  } catch {
    /* ignore */
  }
}

// ── Manual Pairing String Connection ──

/**
 * Connect using a manually-entered pairing string.
 *
 * This is the production fallback for multi-wallet setups where:
 * - Extension auto-detect fails
 * - Pop-up blockers prevent the WC modal
 * - The user is on a device without the HashPack extension
 *
 * The user copies the pairing string from the QR screen (or from
 * HashPack Settings → Connect DApp) and pastes it here.
 *
 * Under the hood this feeds the WC pairing URI into the SignClient,
 * which creates a new session proposal for HashPack to approve.
 */
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

    // Get the underlying SignClient to pair with the user-provided URI
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

    // Start listening for the pairing event
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

      // Initiate pairing with the provided URI
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
            // This is actually okay — the session may already be active
            // Check connectedAccountIds after a brief wait
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
 *
 * This is designed to work WITH an active `connectViaHashConnect` call:
 * the existing `_currentPairingCallback` will fire when HashPack approves,
 * completing the original connection flow naturally.
 *
 * Use case: the user manually copies a pairing string and pastes it in the UI,
 * or obtains a pairing URI from HashPack Settings → Connect DApp.
 *
 * @returns An error string, or null on success (pairing initiated — wait for callback).
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
    return null; // Success — the existing pairingEvent callback will handle the rest
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("expired") || msg.includes("Proposal expired")) {
      return "Pairing string has expired. Copy a fresh one.";
    }
    if (msg.includes("already exists")) {
      // This is often fine — the session may already be active
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
  // Try the HashPack native deep link first (works when HashPack app is installed)
  // Fallback: use the WalletConnect universal link which opens the WC modal in browser
  return `hashpack://wc?uri=${encodeURIComponent(pairingUri)}`;
}

/**
 * Get a universal WalletConnect link that works in mobile browsers.
 * This opens the WalletConnect modal which redirects to HashPack if installed.
 */
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

/**
 * Sign unsigned transaction bytes via HashConnect (HashPack wallet).
 * Used by HSuite SmartNode swap/pool operations:
 *   1. SmartNode builds the unsigned transaction
 *   2. This function signs it via the user's HashPack wallet
 *   3. Signed bytes are returned to SmartNode for submission
 *
 * @param accountId  Hedera account ID (0.0.xxxxx)
 * @param txBytes    Unsigned transaction bytes from SmartNode
 * @returns Signed transaction bytes, or null on failure
 */
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

    // Deserialize the transaction bytes from SmartNode
    const transaction = Transaction.fromBytes(txBytes);

    // Use HashConnect's sendTransaction method
    // HashConnect v3 uses executeTransaction or sendTransaction depending on version
    const signer = _hashConnectInstance.getSigner?.(
      AccountId.fromString(accountId)
    );

    if (signer) {
      // v3 path: use the signer to sign the transaction
      const signedTx = await signer.signTransaction(transaction);
      return signedTx.toBytes();
    }

    // Fallback: try the direct sendTransaction method
    if (typeof _hashConnectInstance.sendTransaction === "function") {
      const result = await _hashConnectInstance.sendTransaction(
        AccountId.fromString(accountId),
        transaction
      );
      // If sendTransaction returns a TransactionResponse, we need the receipt
      if (result?.transactionId) {
        // Transaction was already submitted by HashConnect
        return txBytes; // Return original bytes as a signal that tx was submitted
      }
    }

    // Last resort: try signMessages with the raw bytes as base64
    console.debug("[HashPack] signTransaction: no signer or sendTransaction available");
    return null;
  } catch (err: any) {
    console.debug("[HashPack] signTransaction failed:", err?.message || err);
    return null;
  }
}

/**
 * Send a transaction directly via HashConnect.
 * This is the higher-level method — the wallet signs AND submits.
 *
 * @param accountId   Hedera account ID
 * @param txBytes     Unsigned transaction bytes
 * @returns Transaction result with ID and status
 */
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
    const { AccountId, Transaction, TransactionId } = await import(
      "@hashgraph/sdk"
    );

    const transaction = Transaction.fromBytes(txBytes);

    // Try getSigner first (HashConnect v3)
    const signer = _hashConnectInstance.getSigner?.(
      AccountId.fromString(accountId)
    );

    if (signer) {
      // Must freeze with signer before executing — sets nodeAccountIds + txId
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
        const rMsg = receiptErr?.message || "";
        if (rMsg.includes("body.data") || rMsg.includes("not set in the protobuf")) {
          console.warn("[HBAR.h] sendHederaTransaction: protobuf bug — Mirror Node fallback. Tx:", txId);
          if (txId) {
            const pollNet: HederaNetwork = _hashConnectNetwork || "mainnet";
            const mr = await pollMirrorNodeReceipt(txId, pollNet);
            if (mr) {
              return {
                success: mr.result === "SUCCESS",
                transactionId: txId,
                error: mr.result === "SUCCESS" ? null : `Status: ${mr.result}`,
              };
            }
          }
          return {
            success: false,
            transactionId: txId,
            error: "Receipt check failed (protobuf bug) — verify on HashScan: " + txId,
          };
        }
        throw receiptErr; // Re-throw non-protobuf errors
      }
    }

    // Fallback: sendTransaction method
    if (typeof _hashConnectInstance.sendTransaction === "function") {
      const result = await _hashConnectInstance.sendTransaction(
        AccountId.fromString(accountId),
        transaction
      );

      const txId =
        result?.transactionId?.toString?.() ??
        result?.receipt?.transactionId?.toString?.() ??
        null;

      return {
        success: !!txId,
        transactionId: txId,
        error: txId ? null : "Transaction may have failed",
      };
    }

    return {
      success: false,
      transactionId: null,
      error: "No transaction signing method available in HashConnect",
    };
  } catch (err: any) {
    return {
      success: false,
      transactionId: null,
      error: err?.message || "Transaction signing failed",
    };
  }
}

/**
 * Execute a Hedera transaction using HashConnect's signer-based flow.
 *
 * This is the recommended method for swap execution. It:
 * 1. Gets the HashConnect signer for the account
 * 2. Accepts a pre-built (unfrozen) transaction object
 * 3. Freezes with signer (sets nodeAccountIds, transactionId)
 * 4. Executes with signer (signs + submits via HashPack)
 * 5. Waits for receipt
 *
 * @param accountId  Hedera account ID (0.0.xxxxx)
 * @param transaction  An unfrozen Hedera SDK transaction object
 * @returns Transaction result with ID and status
 */
export async function executeHederaTransaction(
  accountId: string,
  transaction: any
): Promise<{
  success: boolean;
  transactionId: string | null;
  error: string | null;
  /** True when the user actively declined/cancelled the transaction in their wallet */
  userCancelled?: boolean;
}> {
  if (!_hashConnectInstance) {
    return {
      success: false,
      transactionId: null,
      error: "HashPack wallet not connected. Please connect your wallet first.",
    };
  }

  // Track the transaction ID across try/catch boundaries so we can
  // always return it — even when the receipt check throws.
  let capturedTxId: string | null = null;

  try {
    const { AccountId } = await import("@hashgraph/sdk");

    // Get the signer from HashConnect v3
    const signer = _hashConnectInstance.getSigner?.(
      AccountId.fromString(accountId)
    );

    if (signer) {
      console.log("[HBAR.h] executeHederaTransaction: freezeWithSigner...");
      // freezeWithSigner sets the transaction ID (payer + timestamp) and
      // node account IDs from the signer's network configuration.
      const frozenTx = await transaction.freezeWithSigner(signer);

      console.log("[HBAR.h] executeHederaTransaction: executeWithSigner (awaiting HashPack)...");
      // executeWithSigner sends the transaction to HashPack for signing,
      // then submits it to the Hedera network.
      const response = await frozenTx.executeWithSigner(signer);

      // Capture the transaction ID BEFORE receipt check — getReceipt may throw
      capturedTxId = response.transactionId?.toString() ?? null;
      console.log("[HBAR.h] Transaction submitted:", capturedTxId);

      // Wait for consensus receipt.
      // NOTE: The Hedera SDK throws ReceiptStatusError if the receipt status
      // is anything other than SUCCESS. We catch this below and include the
      // transaction ID so the user can look it up on HashScan.
      try {
        const receipt = await response.getReceiptWithSigner(signer);
        const status = receipt.status?.toString() || "";
        console.log("[HBAR.h] Receipt status:", status, "| Tx:", capturedTxId);

        return {
          success: status === "SUCCESS",
          transactionId: capturedTxId,
          error: status === "SUCCESS" ? null : `Transaction status: ${status}`,
        };
      } catch (receiptErr: any) {
        // getReceiptWithSigner throws if status != SUCCESS.
        // Extract the status from the error for a clearer message.
        const receiptMsg = receiptErr?.message || "Receipt check failed";

        // ── WORKAROUND: HashConnect signer protobuf bug ──
        // HashConnect v3's signer doesn't properly implement query execution,
        // so getReceiptWithSigner() throws "(BUG) body.data was not set in
        // the protobuf". The transaction itself WAS submitted successfully —
        // we just can't check the receipt via the SDK. Fall back to Mirror
        // Node polling to verify the actual on-chain status.
        if (
          receiptMsg.includes("body.data was not set") ||
          receiptMsg.includes("body.data") ||
          receiptMsg.includes("not set in the protobuf")
        ) {
          console.warn(
            "[HBAR.h] getReceiptWithSigner hit known protobuf bug — falling back to Mirror Node receipt poll. Tx:",
            capturedTxId
          );

          if (capturedTxId) {
            // Determine network from the cached instance variable first,
            // then fall back to localStorage, then default to mainnet.
            let pollNetwork: HederaNetwork = _hashConnectNetwork || "mainnet";
            if (!_hashConnectNetwork) {
              try {
                const stored = localStorage.getItem("hbarh-hedera-network");
                if (stored === "testnet") pollNetwork = "testnet";
              } catch { /* default to mainnet */ }
            }

            const mirrorResult = await pollMirrorNodeReceipt(
              capturedTxId,
              pollNetwork,
              6,   // max attempts
              2500  // initial delay — give Mirror Node time to index
            );

            if (mirrorResult) {
              const isSuccess = mirrorResult.result === "SUCCESS";
              console.log(
                `[HBAR.h] Mirror Node receipt fallback: result="${mirrorResult.result}", success=${isSuccess} | Tx: ${capturedTxId}`
              );
              return {
                success: isSuccess,
                transactionId: capturedTxId,
                error: isSuccess
                  ? null
                  : `Transaction status: ${mirrorResult.result} (verified via Mirror Node)`,
              };
            }

            // Mirror Node didn't return a result within the retry window.
            // The transaction was submitted, so return a "pending" result
            // rather than a hard failure — the user can check HashScan.
            console.warn(
              "[HBAR.h] Mirror Node receipt poll exhausted — transaction status unknown. Tx:",
              capturedTxId
            );
            return {
              success: false,
              transactionId: capturedTxId,
              error:
                "Transaction was submitted but receipt verification timed out. " +
                "The swap may have succeeded — check HashScan for the final status: " +
                capturedTxId,
            };
          }
        }

        const statusMatch = receiptMsg.match(/status\s*[:=]\s*(\w+)/i) ||
          receiptMsg.match(/(CONTRACT_REVERT_EXECUTED|INSUFFICIENT_GAS|INVALID_SIGNATURE|TOKEN_NOT_ASSOCIATED|INSUFFICIENT_PAYER_BALANCE|INSUFFICIENT_ACCOUNT_BALANCE)/i);
        const extractedStatus = statusMatch?.[1] || null;

        console.error("[HBAR.h] Receipt error:", receiptMsg, "| Tx:", capturedTxId);

        // Special handling for contract reverts — surface the reason
        let errorDetail = extractedStatus
          ? `Transaction reverted: ${extractedStatus}`
          : `Transaction failed: ${receiptMsg}`;

        if (extractedStatus === "CONTRACT_REVERT_EXECUTED") {
          errorDetail = "Smart contract reverted — the router rejected the swap. " +
            "Common causes: insufficient liquidity, stale quote, wrong token path, or token not associated. " +
            `Check HashScan for details: ${capturedTxId}`;
        }

        return {
          success: false,
          transactionId: capturedTxId,
          error: errorDetail,
        };
      }
    }

    // Fallback: use sendTransaction if getSigner is unavailable
    if (typeof _hashConnectInstance.sendTransaction === "function") {
      console.log("[HBAR.h] executeHederaTransaction: using sendTransaction fallback");
      const result = await _hashConnectInstance.sendTransaction(
        AccountId.fromString(accountId),
        transaction
      );

      const txId =
        result?.transactionId?.toString?.() ??
        result?.receipt?.transactionId?.toString?.() ??
        null;

      return {
        success: !!txId,
        transactionId: txId,
        error: txId ? null : "Transaction may have failed — no transaction ID returned",
      };
    }

    return {
      success: false,
      transactionId: null,
      error: "No transaction execution method available. Please reconnect HashPack and try again.",
    };
  } catch (err: any) {
    const msg = err?.message || "Transaction execution failed";

    // ── User Rejection ──
    // HashConnect v3 throws "USER_REJECT" (no "ED") when the user
    // declines in HashPack. This is a normal user action, not an error —
    // log at info level and return a distinct flag so callers can
    // differentiate cancellation from real failures.
    const msgLower = msg.toLowerCase();
    if (msg.includes("USER_REJECT") || msgLower.includes("rejected") || msgLower.includes("denied") || msgLower.includes("user reject")) {
      console.log("[HBAR.h] Transaction cancelled by user in wallet — no gas charged");
      return {
        success: false,
        transactionId: capturedTxId,
        error: "Transaction cancelled by user",
        userCancelled: true,
      };
    }

    console.error("[HBAR.h] executeHederaTransaction error:", msg, "| Tx:", capturedTxId);

    // Provide user-friendly error messages for common failures
    if (msg.includes("INSUFFICIENT_PAYER_BALANCE") || msg.includes("INSUFFICIENT_ACCOUNT_BALANCE")) {
      return {
        success: false,
        transactionId: capturedTxId,
        error: "Insufficient HBAR balance to pay transaction fees",
      };
    }
    if (msg.includes("INVALID_SIGNATURE")) {
      return {
        success: false,
        transactionId: capturedTxId,
        error: "Invalid signature — please reconnect your wallet and try again",
      };
    }
    if (msg.includes("TOKEN_NOT_ASSOCIATED")) {
      return {
        success: false,
        transactionId: capturedTxId,
        error: "Token not associated with your account. Please associate the token first.",
      };
    }
    if (msg.includes("CONTRACT_REVERT") || msg.includes("REVERT")) {
      return {
        success: false,
        transactionId: capturedTxId,
        error: `Contract reverted: ${msg}` + (capturedTxId ? ` — check tx on HashScan: ${capturedTxId}` : ""),
      };
    }

    return {
      success: false,
      transactionId: capturedTxId,
      error: msg + (capturedTxId ? ` (tx: ${capturedTxId})` : ""),
    };
  }
}
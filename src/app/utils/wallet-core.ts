/**
 * WalletConnect v2 SignClient — Production singleton
 *
 * This module is the SOLE owner of the WalletConnect SignClient lifecycle.
 * Every Hedera wallet connection (any HIP-820 compliant wallet) routes
 * through here. MetaMask uses native EIP-1193 (see metamask.ts) and is
 * completely independent — nothing in this file touches it.
 *
 * Architecture:
 *   - Single SignClient instance per page (WC Core is a global singleton)
 *   - Session proposals use the Hedera namespace per HIP-820
 *   - Transaction signing: hedera_signAndExecuteTransaction
 *   - Message signing: hedera_signMessage
 *   - Relay wait ensures WebSocket is ready before any RPC call
 *
 * References:
 *   - WalletConnect v2 Spec: https://specs.walletconnect.com/2.0/
 *   - HIP-820: https://hips.hedera.com/hip/hip-820
 */

import "./polyfills";
import type { HederaNetwork } from "./hedera";
import { ENV } from "./env";

// ── Constants ──────────────────────────────────────────────────────────

/** WalletConnect Cloud project ID — sourced from ENV (supports env var rotation) */
const WC_PROJECT_ID = ENV.WALLETCONNECT_PROJECT_ID;

const DAPP_METADATA = {
  name: "Wrappdex",
  description: "Wrappdex — Secure Decentralized Exchange on Hedera",
  url: typeof window !== "undefined" ? window.location.origin : "https://wrappdex.com",
  icons: [
    "https://assets.coingecko.com/coins/images/3688/large/hbar.png",
  ],
};

/** HIP-820 JSON-RPC methods */
const HEDERA_METHODS = [
  "hedera_signTransaction",
  "hedera_signAndExecuteTransaction",
  "hedera_signMessage",
] as const;

/** HIP-820 session events */
const HEDERA_EVENTS = ["accountsChanged", "chainChanged"] as const;

// ── CAIP-2 Helpers ─────────────────────────────────────────────────────

/** Map network label → WalletConnect CAIP-2 chain ID */
export function getHederaChainId(network: HederaNetwork): string {
  return network === "testnet" ? "hedera:testnet" : "hedera:mainnet";
}

/** Parse a CAIP-10 account string: "hedera:mainnet:0.0.12345" */
export function parseHederaAccount(caip10: string): { network: string; accountId: string } | null {
  const parts = caip10.split(":");
  if (parts.length !== 3 || parts[0] !== "hedera") return null;
  return { network: parts[1], accountId: parts[2] };
}

// ── SignClient Singleton ───────────────────────────────────────────────

// Persist across Vite HMR / iframe re-evaluations — WC Core uses an
// internal global that can only be init'd once per page.
const _G = globalThis as any;
const _WC_KEY = "__wrappdex_wc_sign_client";
const _WC_INIT_KEY = "__wrappdex_wc_init_promise";

let _signClient: any = _G[_WC_KEY] ?? null;
let _initPromise: Promise<any> | null = _G[_WC_INIT_KEY] ?? null;
let _initFailed = false;

/**
 * Get or create the WC SignClient singleton.
 * WalletConnect Core can only be initialized ONCE per page.
 */
export async function getSignClient(): Promise<any> {
  // Re-read from globalThis in case another module evaluation already finished
  if (_G[_WC_KEY]) { _signClient = _G[_WC_KEY]; return _signClient; }
  if (_signClient) return _signClient;

  if (!_initPromise || _initFailed) {
    _initFailed = false;
    _initPromise = _initSignClient();
    _G[_WC_INIT_KEY] = _initPromise;
    _initPromise.catch(() => { _initFailed = true; });
  }

  return _initPromise;
}

async function _initSignClient(): Promise<any> {
  // Final guard: if another execution path raced ahead, return its result
  if (_G[_WC_KEY]) { _signClient = _G[_WC_KEY]; return _signClient; }

  cleanStaleStorage();

  const { SignClient } = await import("@walletconnect/sign-client");

  const client = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: DAPP_METADATA,
  });

  _signClient = client;
  _G[_WC_KEY] = client;

  // Wait for the WebSocket relay handshake before sending anything.
  await _waitForRelay(client);

  // ── Lifecycle events ─────────────────────────────────────────
  client.on("session_event", (event: any) => {
    console.log("[WC] session_event:", event?.params?.event?.name);
  });

  client.on("session_update", ({ topic }: any) => {
    console.log("[WC] session_update:", topic);
    const s = client.session.get(topic);
    if (s) _sessionUpdateCBs.forEach((cb) => cb(s));
  });

  client.on("session_delete", ({ topic }: any) => {
    console.log("[WC] session_delete:", topic);
    _sessionDeleteCBs.forEach((cb) => cb(topic));
  });

  client.on("session_expire", ({ topic }: any) => {
    console.log("[WC] session_expire:", topic);
    _sessionDeleteCBs.forEach((cb) => cb(topic));
  });

  // Purge orphaned pairings
  try {
    const pairings = client.core?.pairing?.pairings?.getAll?.() ?? [];
    const activeSessions = client.session?.getAll?.() ?? [];
    const activeTopics = new Set(activeSessions.map((s: any) => s.pairingTopic));
    for (const p of pairings) {
      if (!activeTopics.has(p.topic)) {
        try { await client.core.pairing.disconnect({ topic: p.topic }).catch(() => {}); } catch { /* gone */ }
      }
    }
  } catch { /* non-critical */ }

  console.log("[WC] SignClient ready. Sessions:", client.session?.getAll?.()?.length ?? 0);
  return client;
}

// ── Event Callback Registry ────────────────────────────────────────────

type SessionUpdateCB = (session: any) => void;
type SessionDeleteCB = (topic: string) => void;

const _sessionUpdateCBs = new Set<SessionUpdateCB>();
const _sessionDeleteCBs = new Set<SessionDeleteCB>();

export function onSessionUpdate(cb: SessionUpdateCB): () => void {
  _sessionUpdateCBs.add(cb);
  return () => { _sessionUpdateCBs.delete(cb); };
}

export function onSessionDelete(cb: SessionDeleteCB): () => void {
  _sessionDeleteCBs.add(cb);
  return () => { _sessionDeleteCBs.delete(cb); };
}

// ── Session Proposal ───────────────────────────────────────────────────

export interface WCConnectResult {
  uri: string;
  approval: Promise<any>;
}

/**
 * Create a new WalletConnect session proposal for Hedera.
 *
 * Uses `optionalNamespaces` (WC v2.x deprecated `requiredNamespaces` and
 * auto-assigns them to optional).  The downstream `getAccountsFromSession`
 * check already rejects sessions that return zero Hedera accounts, so
 * the wallet is still expected to include them.
 *
 * Returns:
 *   - uri      — pairing URI for QR code / deep link
 *   - approval — promise that resolves to the approved Session
 */
export async function proposeSession(network: HederaNetwork): Promise<WCConnectResult> {
  const client = await getSignClient();
  const chainId = getHederaChainId(network);

  const { uri, approval } = await client.connect({
    optionalNamespaces: {
      hedera: {
        methods: [...HEDERA_METHODS],
        chains: [chainId],
        events: [...HEDERA_EVENTS],
      },
    },
  });

  if (!uri) {
    throw new Error("Failed to generate WalletConnect pairing URI. The relay may be unreachable.");
  }

  // CRITICAL: approval is a FUNCTION () => Promise<Session>, not a Promise.
  return { uri, approval: approval() };
}

/**
 * Extract Hedera account IDs from an approved WC session.
 *
 * Checks every namespace key starting with "hedera" to handle both
 * "hedera" (ecosystem key) and "hedera:mainnet" (chain-specific key).
 */
export function getAccountsFromSession(session: any): string[] {
  const accounts: string[] = [];
  const ns = session?.namespaces;

  if (!ns || typeof ns !== "object") {
    console.warn("[WC] getAccountsFromSession: no namespaces on session",
      JSON.stringify(session, null, 2)?.slice(0, 800));
    return accounts;
  }

  for (const key of Object.keys(ns)) {
    if (!key.startsWith("hedera")) continue;
    const list = ns[key]?.accounts;
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      const parsed = parseHederaAccount(a);
      if (parsed && !accounts.includes(parsed.accountId)) {
        accounts.push(parsed.accountId);
      }
    }
  }

  if (accounts.length === 0) {
    console.warn("[WC] No hedera accounts in namespaces:",
      JSON.stringify(ns, null, 2)?.slice(0, 1500));
  }

  return accounts;
}

// ── Transaction Signing (HIP-820) ──────────────────────────────────────

/**
 * Validate session health before any client.request() call.
 * Catches stale/expired/relay-disconnected sessions before they hit WC internals
 * (which can fail opaquely or trigger unwanted deep-link redirects).
 */
async function _validateSessionBeforeRequest(client: any, topic: string): Promise<void> {
  // 1. Session must exist in the client's store
  let session: any;
  try {
    session = client.session?.get?.(topic);
  } catch {
    session = null;
  }

  if (!session) {
    // Check if it's in the list at all
    const allSessions = client.session?.getAll?.() ?? [];
    const found = allSessions.some((s: any) => s.topic === topic);
    if (!found) {
      throw new Error(
        "Wallet session expired or was disconnected remotely. " +
        "Please reconnect your wallet from the wallet menu."
      );
    }
  }

  // 2. Session must not be expired (WC sessions have an expiry timestamp)
  if (session?.expiry) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > session.expiry) {
      // Clean up the expired session
      try { await client.disconnect({ topic, reason: { code: 6000, message: "Session expired" } }); } catch { /* */ }
      throw new Error(
        "Wallet session has expired. Please reconnect your wallet."
      );
    }
  }

  // 3. Relay should be connected (best-effort — don't block if relay is reconnecting)
  const relayConnected = !!client.core?.relayer?.connected;
  if (!relayConnected) {
    console.warn("[WC] Relay disconnected before signing — attempting reconnect...");
    // Give relay a brief window to reconnect
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          const poll = setInterval(() => {
            if (client.core?.relayer?.connected) { clearInterval(poll); resolve(); }
          }, 200);
          setTimeout(() => { clearInterval(poll); resolve(); }, 3000);
        }),
      ]);
    } catch { /* proceed anyway — relay may reconnect during the request */ }

    if (!client.core?.relayer?.connected) {
      console.warn("[WC] Relay still disconnected — signing may fail");
    }
  }
}

/**
 * Iframe-safe AND mobile-safe wrapper around client.request().
 *
 * WC v2.23 fires a deep-link redirect via window.open(url, ...) in
 * parallel with every relay request.
 *
 * IFRAME problem: window.open(url, "_top") navigates the parent frame
 * away, destroying the dApp. Fix: downgrade _top/_parent → _blank.
 *
 * MOBILE problem: The SDK fires window.open("wc:<pairingTopic>@2?...")
 * which the mobile OS routes to the wallet app as a NEW pairing request
 * instead of a signing request. HashPack shows "Pair with dApp" with a
 * malformed URI error. The actual signing request is delivered via the
 * relay — the deep link is only meant to bring the wallet to foreground.
 *
 * Fix: On mobile, suppress the raw `wc:` pairing URI deep links and
 * instead open the wallet via its registered native/universal redirect
 * URL (from the WC session peer metadata). The relay delivers the
 * signing request; the redirect just brings the wallet to foreground.
 *
 * Desktop is unaffected — the interceptor only activates for iframe
 * or mobile user agents.
 */
async function _safeRequest(client: any, params: Record<string, any>): Promise<any> {
  const origOpen = window.open;
  const isIframe = (() => { try { return window !== window.top; } catch { return true; } })();
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ── Resolve wallet redirect URL for mobile ────────────────────────
  // The WC session's peer metadata includes the wallet's registered
  // native (custom scheme) and universal (HTTPS) redirect URLs.
  // We prefer native ("hashpack://") because it opens the app directly
  // without navigating the browser away.
  let walletRedirect: string | null = null;
  if (isMobile && params.topic) {
    try {
      const session = client.session?.get?.(params.topic);
      const redirect = session?.peer?.metadata?.redirect;
      walletRedirect = redirect?.native || redirect?.universal || null;
      if (!walletRedirect) {
        // Fallback: scan peer metadata URL for known wallet schemes
        const peerUrl = session?.peer?.metadata?.url || "";
        if (peerUrl.includes("hashpack")) walletRedirect = "https://www.hashpack.app/wc";
      }
    } catch { /* session lookup failed — proceed without redirect */ }
  }

  if (isIframe || isMobile) {
    let redirectFired = false;
    window.open = function (url?: any, target?: any, features?: any): WindowProxy | null {
      const urlStr = String(url || "");

      // ── Mobile: suppress WC pairing URI deep links ──────────────
      // These are `wc:<topic>@2?...` URIs that HashPack interprets as
      // new pairing requests, causing the "Pair with dApp" error.
      // The relay already delivered the signing request — we just need
      // to bring the wallet to the foreground.
      if (isMobile && (urlStr.startsWith("wc:") || urlStr.includes("wc%3A") || urlStr.includes("/wc?uri=wc"))) {
        console.log("[WC] Mobile: suppressed WC pairing deep-link:", urlStr.slice(0, 120));
        if (walletRedirect && !redirectFired) {
          redirectFired = true;
          console.log("[WC] Mobile: opening wallet via redirect:", walletRedirect);
          // Use location.href for native schemes (hashpack://) — this
          // opens the app without navigating the browser away (like tel:
          // or mailto: links). Falls back to window.open for HTTPS URLs.
          try {
            if (walletRedirect.startsWith("http")) {
              origOpen.call(window, walletRedirect, "_blank");
            } else {
              window.location.href = walletRedirect;
            }
          } catch {
            try { origOpen.call(window, walletRedirect, "_blank"); } catch { /* */ }
          }
        }
        return null;
      }

      // ── Iframe: downgrade _top / _parent → _blank ──────────────
      if (isIframe && typeof target === "string" && (target === "_top" || target === "_parent")) {
        console.log(`[WC] Deep-link target downgraded "${target}" → "_blank":`,
          urlStr.slice(0, 120));
        return origOpen.call(window, url, "_blank", features);
      }

      return origOpen.call(window, url, target, features);
    } as typeof window.open;
  }

  try {
    return await client.request(params);
  } finally {
    if (isIframe || isMobile) window.open = origOpen;
  }
}

export async function signAndExecuteTransaction(
  topic: string,
  network: HederaNetwork,
  accountId: string,
  transactionBytes: Uint8Array,
): Promise<any> {
  const client = await getSignClient();
  await _validateSessionBeforeRequest(client, topic);
  const chainId = getHederaChainId(network);

  return _safeRequest(client, {
    topic,
    chainId,
    request: {
      method: "hedera_signAndExecuteTransaction",
      params: {
        signerAccountId: `${chainId}:${accountId}`,
        transactionList: _u8ToBase64(transactionBytes),
      },
    },
  });
}

export async function signTransactionViaWC(
  topic: string,
  network: HederaNetwork,
  accountId: string,
  transactionBytes: Uint8Array,
): Promise<Uint8Array | null> {
  const client = await getSignClient();
  await _validateSessionBeforeRequest(client, topic);
  const chainId = getHederaChainId(network);

  try {
    const result = await _safeRequest(client, {
      topic,
      chainId,
      request: {
        method: "hedera_signTransaction",
        params: {
          signerAccountId: `${chainId}:${accountId}`,
          transactionList: _u8ToBase64(transactionBytes),
        },
      },
    });

    if (typeof result === "string") return _base64ToU8(result);
    if (result?.signedTransactionBytes) {
      return typeof result.signedTransactionBytes === "string"
        ? _base64ToU8(result.signedTransactionBytes)
        : new Uint8Array(result.signedTransactionBytes);
    }
    return null;
  } catch (err: any) {
    console.warn("[WC] signTransaction failed:", err?.message);
    return null;
  }
}

export async function signMessageViaWC(
  topic: string,
  network: HederaNetwork,
  accountId: string,
  message: string,
): Promise<{ signatures: any[]; rawSignatureMap?: string } | null> {
  const client = await getSignClient();
  await _validateSessionBeforeRequest(client, topic);
  const chainId = getHederaChainId(network);

  // HIP-820 spec requires the message parameter to be base64-encoded.
  // The wallet decodes it back to the original bytes before signing.
  // Using a UTF-8-safe encoding path for robustness.
  const msgBytes = new TextEncoder().encode(message);
  let binStr = "";
  for (let i = 0; i < msgBytes.length; i++) binStr += String.fromCharCode(msgBytes[i]);
  const messageB64 = btoa(binStr);

  try {
    const result = await _safeRequest(client, {
      topic,
      chainId,
      request: {
        method: "hedera_signMessage",
        params: {
          signerAccountId: `${chainId}:${accountId}`,
          message: messageB64,
        },
      },
    });

    console.log("[WC] signMessage raw result:", typeof result,
      result ? JSON.stringify(result).slice(0, 600) : "null");

    // Capture the raw signatureMap string for server-side re-extraction fallback.
    // This ensures the server has the full protobuf data even if client-side
    // extraction gets wrong bytes (e.g., pubKeyPrefix false-positive on 0x1A 0x40).
    let rawSignatureMap: string | undefined;
    if (result && typeof result === "object" && typeof result.signatureMap === "string") {
      rawSignatureMap = result.signatureMap;
    }

    // Parse the WC response — wallets return many different formats
    const signatures = _parseSignMessageResponse(result);
    if (!signatures || signatures.length === 0) {
      console.warn("[WC] Could not extract signatures from WC response");
      return null;
    }
    return { signatures, rawSignatureMap };
  } catch (err: any) {
    console.warn("[WC] signMessage failed:", err?.message);
    return null;
  }
}

// ── Disconnect ─────────────────────────────────────────────────────────

export async function disconnectSession(topic: string): Promise<void> {
  if (!_signClient) return;
  try {
    await _signClient.disconnect({
      topic,
      reason: { code: 6000, message: "User disconnected" },
    });
  } catch { /* session may already be gone */ }
}

export async function disconnectAll(): Promise<void> {
  if (!_signClient) return;
  try {
    const sessions = _signClient.session?.getAll?.() ?? [];
    for (const s of sessions) {
      try {
        await _signClient.disconnect({ topic: s.topic, reason: { code: 6000, message: "Disconnect all" } });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ── Session Queries ────────────────────────────────────────────────────

export function getActiveSessions(): any[] {
  if (!_signClient) return [];
  try { return _signClient.session?.getAll?.() ?? []; } catch { return []; }
}

export function findSessionForAccount(accountId: string): any | null {
  for (const s of getActiveSessions()) {
    if (getAccountsFromSession(s).includes(accountId)) return s;
  }
  return null;
}

// ── Force Reset ────────────────────────────────────────────────────────

export async function forceResetSignClient(): Promise<void> {
  if (_signClient) {
    try {
      for (const s of (_signClient.session?.getAll?.() ?? [])) {
        try { await _signClient.disconnect({ topic: s.topic, reason: { code: 6000, message: "Force reset" } }); } catch { /* */ }
      }
    } catch { /* */ }
  }

  _signClient = null;
  _initPromise = null;
  _initFailed = false;
  delete _G[_WC_KEY];
  delete _G[_WC_INIT_KEY];
  cleanStaleStorage(true);
  console.log("[WC] SignClient force-reset complete");
}

// ── Configuration Check ────────────────────────────────────────────────

export function isWalletConnectConfigured(): boolean {
  return WC_PROJECT_ID.length >= 16 && /^[a-f0-9]+$/i.test(WC_PROJECT_ID);
}

export function getWalletConnectProjectId(): string {
  return WC_PROJECT_ID;
}

// ── WalletConnect Modal ────────────────────────────────────────────────

let _wcModal: any = null;
let _wcModalPromise: Promise<any> | null = null;

/**
 * Get or create the WalletConnect Modal singleton.
 * Dynamically imports @walletconnect/modal to avoid bundle bloat.
 */
export async function getWCModal(): Promise<any> {
  if (_wcModal) return _wcModal;
  if (_wcModalPromise) return _wcModalPromise;

  _wcModalPromise = (async () => {
    const { WalletConnectModal } = await import("@walletconnect/modal");
    _wcModal = new WalletConnectModal({
      projectId: WC_PROJECT_ID,
      themeMode: "dark",
      themeVariables: {
        "--wcm-z-index": "99999",
      },
      // Show Hedera-compatible wallets
      chains: ["hedera:mainnet", "hedera:testnet"],
    });
    return _wcModal;
  })();

  return _wcModalPromise;
}

/**
 * Open the WalletConnect modal with a pairing URI.
 * The modal shows a QR code and a list of compatible wallets.
 */
export async function openWCModal(uri: string): Promise<void> {
  const modal = await getWCModal();
  await modal.openModal({ uri });
  console.log("[WC] Modal opened with pairing URI");
}

/**
 * Close the WalletConnect modal.
 */
export function closeWCModal(): void {
  try { _wcModal?.closeModal(); } catch { /* ignore */ }
}

/**
 * Subscribe to WC modal open/close events.
 * Returns an unsubscribe function.
 */
export function subscribeWCModal(cb: (state: { open: boolean }) => void): () => void {
  if (!_wcModal) return () => {};
  try {
    return _wcModal.subscribeModal(cb) ?? (() => {});
  } catch {
    return () => {};
  }
}

// ── Storage Cleanup ────────────────────────────────────────────────────

function cleanStaleStorage(aggressive = false): void {
  try {
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const isWC = key.startsWith("wc@2:") || key.startsWith("wc@1:") || key.includes("walletconnect");
      if (aggressive) {
        if (isWC) remove.push(key);
      } else {
        if (isWC && (key.includes("proposal") || key.includes("history") || key.includes("message"))) {
          remove.push(key);
        }
      }
    }
    if (remove.length > 0) {
      remove.forEach((k) => localStorage.removeItem(k));
      console.log(`[WC] Cleaned ${remove.length} stale localStorage entries`);
    }
  } catch { /* non-critical */ }
}

export function clearWCStorage(preserveIdentity = false): number {
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const isWC = key.startsWith("wc@2:") || key.startsWith("wc@1:") || key.includes("walletconnect");
      if (isWC) {
        if (preserveIdentity && (key.includes("identity") || key.includes("crypto"))) continue;
        keys.push(key);
      }
    }
    keys.forEach((k) => { localStorage.removeItem(k); removed++; });
  } catch { /* best-effort */ }
  return removed;
}

// ── Internal Utilities ─────────────────────────────────────────────────

function _u8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function _base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Wait for the WC relay WebSocket to connect.
 *
 * SignClient.init() can resolve before the relay handshake finishes.
 * Sending anything before that throws "send was called before connect".
 */
async function _waitForRelay(client: any, timeoutMs = 8000): Promise<void> {
  try {
    const relayer = client.core?.relayer;
    if (!relayer) { console.warn("[WC] No relayer — skipping wait"); return; }
    if (relayer.connected) return;

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        try { relayer.off("relayer_connect", onConnect); } catch { /* */ }
        resolve();
      };
      const onConnect = () => done();
      try { relayer.on("relayer_connect", onConnect); } catch { /* */ }
      const poll = setInterval(() => { if (relayer.connected) done(); }, 100);
      const timer = setTimeout(() => {
        if (!settled) { console.log("[WC] Relay wait timed out — proceeding"); done(); }
      }, timeoutMs);
    });
  } catch {
    console.warn("[WC] Could not wait for relay — proceeding");
  }
}

/**
 * Parse a WalletConnect response for signMessage.
 *
 * Wallets return various formats for signatures:
 * - Single string (base64-encoded)
 * - Object with a single key (base64-encoded)
 * - Array of strings (base64-encoded)
 * - Object with multiple keys (base64-encoded)
 *
 * This function attempts to extract all signatures from the response.
 */
function _parseSignMessageResponse(result: any): string[] {
  if (!result) return [];

  // Case 1: Direct string (some wallets return just the sig)
  if (typeof result === "string") {
    console.log("[WC] parseSignMsg: direct string, length=" + result.length);
    return [result];
  }

  // Case 2: Array of strings
  if (Array.isArray(result)) {
    const filtered = result.filter((s: any) => typeof s === "string" && s.length > 0);
    console.log("[WC] parseSignMsg: array of " + result.length + " items, " + filtered.length + " valid strings");
    return filtered;
  }

  // Case 3: Object with signatureMap
  if (result.signatureMap != null) {
    const sm = result.signatureMap;
    console.log("[WC] parseSignMsg: has signatureMap, type=" + typeof sm);

    // 3a: signatureMap is a base64 string (protobuf-encoded SignatureMap)
    if (typeof sm === "string") {
      const extracted = _extractED25519FromProtobuf(sm);
      if (extracted) {
        console.log("[WC] Extracted ED25519 sig from protobuf SignatureMap: " + extracted.length + " hex chars");
        return [extracted];
      }
      // Protobuf extraction failed — pass the raw base64 string through.
      // The server's decodeSigTo64Bytes will try to extract it server-side.
      console.warn("[WC] Protobuf extraction failed — passing raw signatureMap string (" + sm.length + " chars) to server");
      return [sm];
    }

    // 3b: signatureMap has sigPair array (JSON-decoded protobuf)
    if (sm.sigPair && Array.isArray(sm.sigPair)) {
      const sigs: string[] = [];
      for (const pair of sm.sigPair) {
        const sig = pair?.ed25519 || pair?.ECDSA_secp256k1 || pair?.signature;
        if (typeof sig === "string") sigs.push(sig);
      }
      if (sigs.length > 0) {
        console.log("[WC] parseSignMsg: sigPair array, extracted " + sigs.length + " sigs, first=" + sigs[0].length + " chars");
        return sigs;
      }
    }

    // 3c: signatureMap is a flat key-value map { accountId/pubkey: sigString }
    if (typeof sm === "object" && sm !== null) {
      const vals = Object.values(sm).filter((v: any) => typeof v === "string" && v.length > 0) as string[];
      if (vals.length > 0) {
        console.log("[WC] parseSignMsg: flat signatureMap, " + vals.length + " string values");
        return vals;
      }

      // Nested objects: { key: { ed25519: sigHex } }
      for (const v of Object.values(sm)) {
        if (v && typeof v === "object") {
          const nested = (v as any).ed25519 || (v as any).signature || (v as any).sig;
          if (typeof nested === "string") {
            console.log("[WC] parseSignMsg: nested object sig, " + nested.length + " chars");
            return [nested];
          }
        }
      }
    }
  }

  // Case 4: Object without signatureMap — check for common signature fields
  if (typeof result === "object") {
    for (const key of ["signature", "sig", "ed25519", "data"]) {
      if (typeof result[key] === "string" && result[key].length > 0) {
        console.log("[WC] parseSignMsg: found result." + key + ", " + result[key].length + " chars");
        return [result[key]];
      }
    }
  }

  console.warn("[WC] parseSignMsg: no signatures found in result, keys=" + (typeof result === "object" ? Object.keys(result).join(",") : "N/A"));
  return [];
}

/**
 * Read a protobuf varint starting at `pos` in `bytes`.
 * Returns { value, newPos } or null if the read fails.
 */
function _readVarint(bytes: Uint8Array, pos: number): { value: number; newPos: number } | null {
  let result = 0;
  let shift = 0;
  while (pos < bytes.length) {
    const byte = bytes[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, newPos: pos };
    shift += 7;
    if (shift > 35) break; // max 5 bytes for a 32-bit varint
  }
  return null;
}

/**
 * Walk a protobuf SignaturePair message and extract the ed25519 field
 * (field 3, wire type 2, expected length 64 bytes).
 */
function _extractFromSignaturePair(bytes: Uint8Array): Uint8Array | null {
  let pos = 0;
  while (pos < bytes.length) {
    const tagResult = _readVarint(bytes, pos);
    if (!tagResult) break;
    pos = tagResult.newPos;
    const fieldNum = tagResult.value >> 3;
    const wireType = tagResult.value & 0x07;

    if (wireType === 2) { // length-delimited
      const lenResult = _readVarint(bytes, pos);
      if (!lenResult) break;
      pos = lenResult.newPos;
      const fieldLen = lenResult.value;

      // Field 3 = ed25519 signature (expected 64 bytes)
      if (fieldNum === 3 && fieldLen === 64 && pos + 64 <= bytes.length) {
        return bytes.slice(pos, pos + 64);
      }
      pos += fieldLen;
    } else if (wireType === 0) { // varint — skip
      const skip = _readVarint(bytes, pos);
      if (!skip) break;
      pos = skip.newPos;
    } else {
      break; // unsupported wire type
    }
  }
  return null;
}

/**
 * Try to extract a raw ED25519 signature from a base64-encoded protobuf
 * SignatureMap.
 *
 * Strategy 1 (proper parsing): Walk the protobuf structure —
 *   SignatureMap.sigPair (field 1) → SignaturePair → ed25519 (field 3).
 *   This correctly skips pubKeyPrefix data and is not fooled by
 *   byte patterns (0x1A 0x40) that happen to appear in field data.
 *
 * Strategy 2 (legacy byte scan): Scan for the 0x1A 0x40 tag pair.
 *   Kept as a fallback for non-standard wallet protobuf layouts.
 *
 * Strategy 3 (heuristics): Exact 64-byte payload or last-64-byte extraction.
 *
 * Returns the signature as a hex string, or null if not found.
 */
function _extractED25519FromProtobuf(base64Str: string): string | null {
  try {
    const bin = atob(base64Str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    console.log("[WC] Protobuf decode: " + bytes.length + " bytes, first 12: " +
      Array.from(bytes.slice(0, 12)).map(b => b.toString(16).padStart(2, "0")).join(" "));

    // ── Strategy 1: Proper protobuf walk ──────────────────────────────
    // Parse SignatureMap → repeated SignaturePair (field 1) → ed25519 (field 3)
    let pos = 0;
    while (pos < bytes.length) {
      const tagResult = _readVarint(bytes, pos);
      if (!tagResult) break;
      pos = tagResult.newPos;
      const fieldNum = tagResult.value >> 3;
      const wireType = tagResult.value & 0x07;

      if (wireType === 2) { // length-delimited
        const lenResult = _readVarint(bytes, pos);
        if (!lenResult) break;
        pos = lenResult.newPos;
        const fieldLen = lenResult.value;

        if (fieldNum === 1 && pos + fieldLen <= bytes.length) {
          // field 1 = sigPair (nested SignaturePair message)
          const sigPairBytes = bytes.slice(pos, pos + fieldLen);
          const ed25519Sig = _extractFromSignaturePair(sigPairBytes);
          if (ed25519Sig && ed25519Sig.length === 64) {
            console.log("[WC] Protobuf: proper parse found ED25519 sig at sigPair offset");
            return Array.from(ed25519Sig).map(b => b.toString(16).padStart(2, "0")).join("");
          }
        }
        pos += fieldLen;
      } else if (wireType === 0) {
        const skip = _readVarint(bytes, pos);
        if (!skip) break;
        pos = skip.newPos;
      } else {
        break;
      }
    }

    // ── Strategy 2: Legacy byte-pattern scan (0x1A 0x40) ─────────────
    // Fallback for non-standard protobuf layouts. The proper parser above
    // should handle all compliant wallets; this catches edge cases.
    for (let i = 0; i < bytes.length - 65; i++) {
      if (bytes[i] === 0x1A && bytes[i + 1] === 0x40 && i + 66 <= bytes.length) {
        const sig = bytes.slice(i + 2, i + 66);
        console.log("[WC] Protobuf: legacy byte scan found 0x1A 0x40 at offset " + i);
        return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
      }
    }

    // ── Strategy 3: Heuristics ────────────────────────────────────────

    // Exact 64 bytes = raw signature (no protobuf wrapper)
    if (bytes.length === 64) {
      console.log("[WC] Protobuf decode: exactly 64 bytes — treating as raw signature");
      return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    // Last-64-bytes heuristic for small payloads (e.g., pubKeyPrefix + sig)
    if (bytes.length > 64 && bytes.length <= 128) {
      console.log("[WC] Protobuf: no tag found — trying last 64 bytes as heuristic (" + bytes.length + "B total)");
      const sig = bytes.slice(bytes.length - 64);
      return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    console.warn("[WC] Protobuf: all extraction strategies failed for " + bytes.length + " bytes");
  } catch (e: any) {
    console.warn("[WC] Protobuf decode error:", e?.message);
  }
  return null;
}
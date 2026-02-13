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

// ── Constants ──────────────────────────────────────────────────────────

/** Real WalletConnect Cloud project ID — https://cloud.walletconnect.com */
const WC_PROJECT_ID = "44b5b74e402af9f8e3c14ce8e4d2d2a0";

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

let _signClient: any = null;
let _initPromise: Promise<any> | null = null;
let _initFailed = false;

/**
 * Get or create the WC SignClient singleton.
 * WalletConnect Core can only be initialized ONCE per page.
 */
export async function getSignClient(): Promise<any> {
  if (_signClient) return _signClient;

  if (!_initPromise || _initFailed) {
    _initFailed = false;
    _initPromise = _initSignClient();
    _initPromise.catch(() => { _initFailed = true; });
  }

  return _initPromise;
}

async function _initSignClient(): Promise<any> {
  cleanStaleStorage();

  const { SignClient } = await import("@walletconnect/sign-client");

  const client = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: DAPP_METADATA,
  });

  _signClient = client;

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
 * Uses `requiredNamespaces` so the wallet MUST include Hedera accounts
 * in the approval response (using optionalNamespaces allows wallets to
 * omit them entirely).
 *
 * Returns:
 *   - uri      — pairing URI for QR code / deep link
 *   - approval — promise that resolves to the approved Session
 */
export async function proposeSession(network: HederaNetwork): Promise<WCConnectResult> {
  const client = await getSignClient();
  const chainId = getHederaChainId(network);

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
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

export async function signAndExecuteTransaction(
  topic: string,
  network: HederaNetwork,
  accountId: string,
  transactionBytes: Uint8Array,
): Promise<any> {
  const client = await getSignClient();
  const chainId = getHederaChainId(network);

  return client.request({
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
  const chainId = getHederaChainId(network);

  try {
    const result = await client.request({
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
): Promise<{ signatures: any[] } | null> {
  const client = await getSignClient();
  const chainId = getHederaChainId(network);

  try {
    const result = await client.request({
      topic,
      chainId,
      request: {
        method: "hedera_signMessage",
        params: {
          signerAccountId: `${chainId}:${accountId}`,
          message,
        },
      },
    });

    if (result?.signatureMap) return { signatures: Object.values(result.signatureMap) };
    if (Array.isArray(result)) return { signatures: result };
    return { signatures: [result] };
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
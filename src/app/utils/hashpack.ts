/**
 * Hedera Wallet Integration — Pure WalletConnect v2 (HIP-820)
 *
 * Connects to ANY HIP-820 compliant Hedera wallet via WalletConnect v2.
 * All wallet-specific SDK/API dependencies have been removed.
 * The WC SignClient singleton lives in wallet-core.ts.
 *
 * Supported wallets (via WC v2 QR / deep link):
 *   - HashPack, Blade, Kabila, any HIP-820 wallet
 *   - Mirror Node read-only fallback (no signing)
 *
 * MetaMask is handled separately in metamask.ts — nothing here touches it.
 *
 * Security:
 *   - All signing happens inside the user's wallet
 *   - No private keys stored or transmitted
 *   - End-to-end encrypted WC relay communication
 *   - Sessions expire after 24 h in localStorage
 */

import "./polyfills";

import type { HederaNetwork } from "./hedera";
import { fetchAccountInfo } from "./hedera";
import {
  getSignClient,
  proposeSession,
  getAccountsFromSession,
  signAndExecuteTransaction,
  signTransactionViaWC,
  signMessageViaWC,
  disconnectSession,
  forceResetSignClient,
  onSessionDelete,
  clearWCStorage as coreClearWCStorage,
  isWalletConnectConfigured,
  getWalletConnectProjectId,
  openWCModal,
  closeWCModal,
  subscribeWCModal,
} from "./wallet-core";

// ── Mirror Node Endpoints ──────────────────────────────────────────

const MIRROR_NODES: Record<HederaNetwork, string> = {
  mainnet: "https://mainnet-public.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
};

// ── Mirror Node Receipt Polling ────────────────────────────────────────

function _fmtTxId(txId: string): string {
  if (!txId.includes("@")) return txId;
  const at = txId.indexOf("@");
  return `${txId.substring(0, at)}-${txId.substring(at + 1).replace(".", "-")}`;
}

async function pollMirrorNodeReceipt(
  txId: string,
  network: HederaNetwork,
  maxAttempts = 6,
  initialDelayMs = 2000,
): Promise<{ result: string; status: string } | null> {
  const base = MIRROR_NODES[network];
  const nid = _fmtTxId(txId);
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, initialDelayMs * Math.pow(1.5, i - 1)));
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      const res = await fetch(`${base}/api/v1/transactions/${nid}`, { signal: c.signal });
      clearTimeout(t);
      if (res.status === 404 || !res.ok) continue;
      const data = await res.json();
      const txList = data.transactions || [];
      if (txList.length === 0) continue;
      const result = txList[0].result || "";
      console.log(`[HBAR.\u0127] Mirror receipt: "${result}" (attempt ${i + 1})`);
      return { result, status: result };
    } catch {
      console.log(`[HBAR.\u0127] Mirror poll ${i + 1}/${maxAttempts}: network error`);
    }
  }
  return null;
}

// ── Types (preserved for consumer compatibility) ───────────────────────

export interface HashPackSession {
  accountId: string;
  evmAddress: string;
  network: HederaNetwork;
  connectedAt: number;
  isVerified: boolean;
  connectionMethod: "walletconnect" | "mirror-node";
  profile: HashPackProfile | null;
  /** WC session topic — used for signing and disconnect */
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

// ── Active Connection State ────────────────────────────────────────────

let _activeNetwork: HederaNetwork = "mainnet";
let _activeWcTopic: string | null = null;
let _connectionAbortController: AbortController | null = null;

// Clear local state when the wallet deletes the session remotely
onSessionDelete((topic) => {
  if (topic === _activeWcTopic) {
    _activeWcTopic = null;
    clearSession();
    console.log("[HBAR.\u0127] WC session deleted remotely");
  }
});

// ── SDK / Configuration Availability ───────────────────────────────────

export async function isHashConnectSDKAvailable(): Promise<boolean> {
  return isWalletConnectConfigured();
}

// ── Connect via WalletConnect v2 ───────────────────────────────────────

/**
 * Primary connection — creates a WC v2 session proposal for Hedera
 * and opens the official WalletConnect modal for wallet selection.
 *
 * The WC modal shows a QR code and a list of compatible wallets
 * (HashPack, Blade, Kabila, etc.). The user picks their wallet,
 * scans the QR, and approves. Once approved the session carries
 * the Hedera account IDs in its namespaces.
 */
export async function connectViaHashConnect(
  network: HederaNetwork,
  onPairingString?: (uri: string) => void,
  onConnectionState?: (state: string) => void,
): Promise<HashPackConnectionResult> {
  if (!isWalletConnectConfigured()) {
    return {
      success: false,
      session: null,
      error:
        "WalletConnect Project ID is not configured. " +
        "Get one at cloud.walletconnect.com. " +
        "In the meantime, use the Account Lookup for read-only access.",
    };
  }

  // Abort any in-flight connection
  _connectionAbortController?.abort();
  _connectionAbortController = new AbortController();
  const signal = _connectionAbortController.signal;

  try {
    onConnectionState?.("Initializing WalletConnect...");

    await getSignClient();
    if (signal.aborted) throw new Error("Connection aborted");

    onConnectionState?.("Generating pairing code...");

    const { uri, approval } = await proposeSession(network);
    if (signal.aborted) throw new Error("Connection aborted");

    // Also pass the URI to the callback for backward compatibility
    onPairingString?.(uri);

    // Open the official WalletConnect modal with wallet list & QR
    onConnectionState?.("Opening wallet selector...");
    try {
      await openWCModal(uri);
    } catch (modalErr: any) {
      console.warn("[HBAR.\u0127] WC Modal failed to open, falling back:", modalErr?.message);
      // If modal fails, the UI still has the URI via onPairingString
    }

    onConnectionState?.("Waiting for wallet approval...");

    // Watch for modal close → treat as user cancellation
    let userClosedModal = false;
    let graceElapsed = false;
    // Small grace period — the modal may briefly report { open: false }
    // during its own init animation before settling to { open: true }.
    setTimeout(() => { graceElapsed = true; }, 1500);
    const unsubModal = subscribeWCModal((state) => {
      if (!state.open && graceElapsed && !userClosedModal) {
        userClosedModal = true;
      }
    });

    // Race: approval vs timeout vs modal-close vs abort
    const session = await Promise.race([
      approval,
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error(
            "Connection timed out after 2 minutes. " +
            "Open your Hedera wallet, scan the QR code, and approve the connection.")),
          120_000,
        );

        // Poll for modal close
        const modalPoll = setInterval(() => {
          if (userClosedModal) {
            clearInterval(modalPoll);
            clearTimeout(t);
            reject(new Error("Connection aborted"));
          }
        }, 300);

        signal.addEventListener("abort", () => {
          clearInterval(modalPoll);
          clearTimeout(t);
          reject(new Error("Connection aborted"));
        });
      }),
    ]);

    unsubModal();
    closeWCModal();

    if (signal.aborted) throw new Error("Connection aborted");

    // Extract accounts
    console.log("[HBAR.\u0127] WC session approved. Topic:", session?.topic);
    console.log("[HBAR.\u0127] Namespaces:", JSON.stringify(session?.namespaces, null, 2)?.slice(0, 2000));
    console.log("[HBAR.\u0127] Peer:", session?.peer?.metadata?.name);

    const accounts = getAccountsFromSession(session);
    if (accounts.length === 0) {
      console.warn("[HBAR.\u0127] No Hedera accounts in session. Keys:", Object.keys(session?.namespaces || {}));
      return {
        success: false,
        session: null,
        error:
          "No Hedera accounts returned from wallet. " +
          "Namespace keys: [" + Object.keys(session?.namespaces || {}).join(", ") + "]. " +
          "Try: Reset connection, then reconnect.",
      };
    }

    const accountId = accounts[0];
    _activeWcTopic = session.topic;
    _activeNetwork = network;

    console.log(`[HBAR.\u0127] Connected: ${accountId} (topic: ${session.topic})`);

    return await _buildSession(accountId, network, "walletconnect", session.topic);
  } catch (err: any) {
    closeWCModal(); // Ensure modal is closed on error
    const msg = err?.message || String(err);
    if (msg.includes("aborted")) return { success: false, session: null, error: "Connection was cancelled." };
    if (msg.includes("rejected") || msg.includes("User rejected")) return { success: false, session: null, error: "Connection rejected by wallet." };
    if (msg.includes("expired") || msg.includes("Proposal expired")) return { success: false, session: null, error: "Pairing expired. Please try connecting again." };
    return { success: false, session: null, error: msg };
  }
}

// ── Connect via Mirror Node (read-only) ────────────────────────────────

/**
 * Lightweight read-only connection — validates the account exists on
 * mainnet via Mirror Node, but provides no signing capability.
 * Used as a fallback when WalletConnect is unavailable.
 */
export async function connectViaMirrorNode(
  accountId: string,
  network: HederaNetwork = "mainnet",
): Promise<HashPackConnectionResult> {
  try {
    const info = await fetchAccountInfo(accountId);
    if (!info) {
      return { success: false, session: null, error: `Account ${accountId} not found on Hedera ${network}` };
    }
    return await _buildSession(accountId, network, "mirror-node");
  } catch (err: any) {
    return { success: false, session: null, error: err?.message || "Mirror Node connection failed" };
  }
}

// ── Session Builder ────────────────────────────────────────────────────

async function _buildSession(
  accountId: string,
  network: HederaNetwork,
  method: "walletconnect" | "mirror-node",
  wcTopic?: string,
): Promise<HashPackConnectionResult> {
  const evmAddress = await _getEvmAddress(accountId, network);
  const session: HashPackSession = {
    accountId,
    evmAddress: evmAddress || "",
    network,
    connectedAt: Date.now(),
    isVerified: method === "walletconnect",
    connectionMethod: method,
    profile: null,
    wcTopic,
  };

  if (wcTopic) _activeWcTopic = wcTopic;
  _activeNetwork = network;

  // Persist to localStorage for session restore
  try {
    localStorage.setItem("hashpack_session", JSON.stringify(session));
  } catch { /* storage quota — non-critical */ }

  return { success: true, session, error: null };
}

async function _getEvmAddress(accountId: string, network: HederaNetwork): Promise<string | null> {
  try {
    const base = MIRROR_NODES[network];
    const res = await fetch(`${base}/api/v1/accounts/${accountId}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()).evm_address || null;
  } catch { return null; }
}

// ── Session Persistence ────────────────────────────────────────────────

const SESSION_KEY = "hashpack_session";

/** Stale-session event — consumers can subscribe to detect expired WC sessions */
type StaleSessionCallback = (accountId: string) => void;
const _staleSessionCBs = new Set<StaleSessionCallback>();

export function onStaleSession(cb: StaleSessionCallback): () => void {
  _staleSessionCBs.add(cb);
  return () => { _staleSessionCBs.delete(cb); };
}

export function restoreSession(): HashPackSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: HashPackSession = JSON.parse(raw);
    // Reject sessions older than 24 hours
    if (Date.now() - session.connectedAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    if (session.wcTopic) _activeWcTopic = session.wcTopic;
    _activeNetwork = session.network;

    // Schedule async WC session validation (REC-004)
    // This runs after the sync return so the UI can render immediately,
    // then fires stale-session callbacks if the WC session is gone.
    if (session.wcTopic && session.connectionMethod === "walletconnect") {
      _scheduleSessionValidation(session);
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Async background check: verifies the persisted wcTopic actually exists
 * in the WC SignClient session store. If not, the session is stale —
 * the user appears "connected" but cannot sign anything.
 *
 * Fires after a brief delay to let the SignClient finish initializing.
 * On stale detection: clears local state and notifies subscribers.
 */
function _scheduleSessionValidation(session: HashPackSession): void {
  // Delay to allow SignClient init (getSignClient is lazy-async)
  setTimeout(async () => {
    try {
      const client = await getSignClient();
      if (!client) return;

      // Check if the topic is in the client's session store
      let found = false;
      try {
        const wcSession = client.session?.get?.(session.wcTopic);
        found = !!wcSession;
      } catch {
        // session.get throws if topic doesn't exist in some WC versions
        found = false;
      }

      if (!found) {
        // Fallback: scan all sessions for this account
        const allSessions = client.session?.getAll?.() ?? [];
        const matchingSession = allSessions.find((s: any) => {
          const accounts = s?.namespaces?.hedera?.accounts ?? [];
          return accounts.some((a: string) => a.includes(session.accountId));
        });

        if (matchingSession) {
          // Found under a different topic — update our local state
          console.log(`[HBAR.\u0127] Session topic updated: ${session.wcTopic?.slice(0, 8)} → ${matchingSession.topic.slice(0, 8)}`);
          _activeWcTopic = matchingSession.topic;
          session.wcTopic = matchingSession.topic;
          try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* */ }
          return;
        }

        // No WC session at all — stale
        console.warn(`[HBAR.\u0127] Stale session detected for ${session.accountId} — WC topic not found in SignClient`);
        _activeWcTopic = null;
        try { localStorage.removeItem(SESSION_KEY); } catch { /* */ }
        _staleSessionCBs.forEach(cb => {
          try { cb(session.accountId); } catch { /* */ }
        });
      }
    } catch (err: any) {
      // SignClient init failed — can't validate, leave session as-is
      console.warn("[HBAR.\u0127] Session validation skipped — SignClient unavailable:", err?.message);
    }
  }, 2000); // 2s delay — SignClient needs time to init + relay handshake
}

export function clearSession(): void {
  _activeWcTopic = null;
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

// ── Disconnect ─────────────────────────────────────────────────────────

export async function disconnectHashConnect(): Promise<void> {
  try {
    if (_activeWcTopic) {
      await disconnectSession(_activeWcTopic);
    }
  } catch (err) {
    console.warn("[HBAR.\u0127] Disconnect error (non-fatal):", err);
  } finally {
    _activeWcTopic = null;
    clearSession();
  }
}

// ── Transaction Signing ────────────────────────────────────────────────

/**
 * Sign and execute a transaction via the connected wallet.
 * Returns the transaction response bytes, or null if rejected.
 */
export async function sendHederaTransaction(
  accountId: string,
  transactionBytes: Uint8Array,
): Promise<{ success: boolean; receipt?: { result: string; status: string } | null; error?: string }> {
  if (!_activeWcTopic) {
    return { success: false, error: "No active WalletConnect session" };
  }
  try {
    const result = await signAndExecuteTransaction(_activeWcTopic, _activeNetwork, accountId, transactionBytes);
    // Poll Mirror Node for receipt confirmation
    const receipt = await pollMirrorNodeReceipt(result.transactionId, _activeNetwork);
    return { success: true, receipt };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("rejected") || msg.includes("User rejected")) {
      return { success: false, error: "Transaction rejected by wallet" };
    }
    return { success: false, error: msg };
  }
}

/**
 * Sign a transaction (without executing). Returns signed bytes or null.
 */
export async function signTransaction(
  accountId: string,
  transactionBytes: Uint8Array,
): Promise<Uint8Array | null> {
  if (!_activeWcTopic) return null;
  try {
    return await signTransactionViaWC(_activeWcTopic, _activeNetwork, accountId, transactionBytes);
  } catch (err: any) {
    console.warn("[HBAR.\u0127] Sign failed:", err?.message);
    return null;
  }
}

/**
 * Sign an arbitrary message (for auth challenge-response).
 * Returns the wallet's response object with `signatures` (preserving
 * the interface that auth.ts expects), or null on rejection.
 *
 * wallet-core.signMessageViaWC already returns { signatures: any[] },
 * so we pass it through directly — no extra wrapping needed.
 */
export async function signMessage(
  accountId: string,
  message: string,
): Promise<{ signatures: any } | null> {
  if (!_activeWcTopic) return null;
  try {
    return await signMessageViaWC(_activeWcTopic, _activeNetwork, accountId, message);
  } catch (err: any) {
    console.warn("[HBAR.\u0127] Message sign failed:", err?.message);
    return null;
  }
}

// ── Reset / Cleanup Utilities ──────────────────────────────────────────

export async function forceResetHashConnect(): Promise<void> {
  _activeWcTopic = null;
  clearSession();
  try { await forceResetSignClient(); } catch { /* best-effort */ }
}

export function clearWCStorage(preserveIdentity = false): void {
  coreClearWCStorage(preserveIdentity);
}

/**
 * Diagnostic accessor — returns current connection state for health reports.
 */
export function getCurrentHashConnect(): { topic: string | null; network: HederaNetwork } {
  return { topic: _activeWcTopic, network: _activeNetwork };
}

export { isWalletConnectConfigured, getWalletConnectProjectId, openWCModal, closeWCModal, subscribeWCModal };
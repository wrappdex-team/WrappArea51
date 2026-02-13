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
  findSessionForAccount,
  onSessionDelete,
  clearWCStorage as coreClearWCStorage,
  isWalletConnectConfigured,
  getWalletConnectProjectId,
  openWCModal,
  closeWCModal,
  subscribeWCModal,
} from "./wallet-core";

// ── Mirror Node Endpoints ──────────────────────────────────────────────

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

// ── Extension Detection Stubs ──────────────────────────────────────────
// These are kept as no-op stubs so the UI layer (WalletConnectModal.tsx)
// continues to compile without changes. The next UI step can remove them.

export function isHashPackExtensionInstalled(): boolean {
  return false;
}

export async function detectHashPackExtension(_maxWaitMs = 3000): Promise<boolean> {
  return false;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
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

/** Kept for API compatibility */
export async function openHashConnectPairingModal(
  network: HederaNetwork,
  _themeMode: "dark" | "light" = "dark",
): Promise<HashPackConnectionResult> {
  return connectViaHashConnect(network);
}

// ── Connect via Mirror Node (read-only) ────────────────────────────────

export async function connectViaMirrorNode(
  accountId: string,
  network: HederaNetwork,
): Promise<HashPackConnectionResult> {
  try {
    if (!/^0\.0\.\d+$/.test(accountId.trim())) {
      return { success: false, session: null, error: "Invalid account ID format. Use 0.0.xxxxx format." };
    }

    const accountInfo = await fetchAccountInfo(accountId.trim(), network);
    if (!accountInfo) return { success: false, session: null, error: `Account ${accountId} not found on ${network}.` };
    if (accountInfo.deleted) return { success: false, session: null, error: `Account ${accountId} has been deleted on ${network}.` };

    const session: HashPackSession = {
      accountId: accountInfo.accountId,
      evmAddress: accountInfo.evmAddress || "",
      network,
      connectedAt: Date.now(),
      isVerified: false,
      connectionMethod: "mirror-node",
      profile: null,
    };

    persistSession(session);
    return { success: true, session, error: null };
  } catch (err: any) {
    return { success: false, session: null, error: err.message || "Failed to connect via Mirror Node." };
  }
}

// ── Build Session Helper ───────────────────────────────────────────────

async function _buildSession(
  accountId: string,
  network: HederaNetwork,
  connectionMethod: "walletconnect",
  wcTopic?: string,
): Promise<HashPackConnectionResult> {
  let evmAddress = "";
  try { evmAddress = (await resolveAccountIdToEvm(accountId, network)) || ""; } catch { /* */ }

  const session: HashPackSession = {
    accountId,
    evmAddress,
    network,
    connectedAt: Date.now(),
    isVerified: true,
    connectionMethod,
    profile: null,
    wcTopic,
  };

  persistSession(session);
  return { success: true, session, error: null };
}

// ── Disconnect ─────────────────────────────────────────────────────────

export async function disconnectHashConnect(): Promise<void> {
  _connectionAbortController?.abort();
  _connectionAbortController = null;
  if (_activeWcTopic) {
    await disconnectSession(_activeWcTopic);
    _activeWcTopic = null;
  }
  clearSession();
}

// ── Transaction Signing ────────────────────────────────────────────────

export function getCurrentHashConnect(): { topic: string | null } {
  return { topic: _activeWcTopic };
}

/** Resolve the WC topic for signing (state → persisted → WC client scan) */
function _resolveTopic(accountId: string): string | null {
  if (_activeWcTopic) return _activeWcTopic;
  const saved = restoreSession();
  if (saved?.wcTopic) { _activeWcTopic = saved.wcTopic; return saved.wcTopic; }
  const wc = findSessionForAccount(accountId);
  if (wc) { _activeWcTopic = wc.topic; return wc.topic; }
  return null;
}

export async function signTransaction(
  accountId: string,
  txBytes: Uint8Array,
): Promise<Uint8Array | null> {
  const topic = _resolveTopic(accountId);
  if (!topic) { console.debug("[HBAR.\u0127] signTransaction: no active WC session"); return null; }
  return signTransactionViaWC(topic, _activeNetwork, accountId, txBytes);
}

export async function sendHederaTransaction(
  accountId: string,
  txBytes: Uint8Array,
): Promise<{ success: boolean; transactionId: string | null; error: string | null }> {
  const topic = _resolveTopic(accountId);
  if (!topic) return { success: false, transactionId: null, error: "Wallet not connected. Please reconnect." };

  try {
    const result = await signAndExecuteTransaction(topic, _activeNetwork, accountId, txBytes);
    const txId = result?.transactionId?.toString?.() ?? result?.transactionId ?? null;
    const status = result?.status ?? result?.receipt?.status ?? "";

    if (txId && (status === "SUCCESS" || !status)) {
      try {
        const mr = await pollMirrorNodeReceipt(txId, _activeNetwork);
        if (mr) return { success: mr.result === "SUCCESS", transactionId: txId, error: mr.result === "SUCCESS" ? null : `Transaction failed: ${mr.result}` };
      } catch { /* fall through */ }
      return { success: true, transactionId: txId, error: null };
    }
    return { success: !!result, transactionId: txId, error: null };
  } catch (err: any) {
    const msg = err?.message || "Transaction failed";
    if (msg.includes("rejected") || msg.includes("User rejected")) return { success: false, transactionId: null, error: "Transaction rejected by user." };
    return { success: false, transactionId: null, error: msg };
  }
}

export async function executeHederaTransaction(
  accountId: string,
  transaction: any,
): Promise<{ success: boolean; transactionId: string | null; error: string | null; userCancelled?: boolean }> {
  try {
    let txBytes: Uint8Array;
    if (transaction instanceof Uint8Array) txBytes = transaction;
    else if (typeof transaction?.toBytes === "function") txBytes = transaction.toBytes();
    else return { success: false, transactionId: null, error: "Invalid transaction object — must have toBytes() method." };
    const result = await sendHederaTransaction(accountId, txBytes);
    return { ...result, userCancelled: result.error?.includes("rejected") || result.error?.includes("cancelled") };
  } catch (err: any) {
    const msg = err?.message || "Transaction execution failed";
    return { success: false, transactionId: null, error: msg, userCancelled: msg.includes("rejected") || msg.includes("cancelled") };
  }
}

// ── Message Signing ────────────────────────────────────────────────────

export async function signMessage(
  accountId: string,
  message: string,
): Promise<{ signatures: any[] } | null> {
  const topic = _resolveTopic(accountId);
  if (!topic) { console.debug("[HBAR.\u0127] signMessage: no active WC session"); return null; }
  return signMessageViaWC(topic, _activeNetwork, accountId, message);
}

// ── Mirror Node Utilities ──────────────────────────────────────────────

export async function resolveEvmToAccountId(evmAddress: string, network: HederaNetwork): Promise<string | null> {
  try {
    const res = await fetch(`${MIRROR_NODES[network]}/api/v1/accounts/${evmAddress.toLowerCase()}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json()).account || null;
  } catch { return null; }
}

export async function resolveAccountIdToEvm(accountId: string, network: HederaNetwork): Promise<string | null> {
  try {
    const res = await fetch(`${MIRROR_NODES[network]}/api/v1/accounts/${accountId.trim()}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json()).evm_address || null;
  } catch { return null; }
}

export async function fetchHashPackProfile(
  _accountId: string,
  _network: HederaNetwork,
): Promise<HashPackProfile | null> {
  // Stub — wallet-specific profile APIs removed.
  // Returns null; the UI degrades gracefully (no profile picture/username).
  return null;
}

// ── Token Gating Utility ───────────────────────────────────────────────

export async function checkTokenHolding(
  accountId: string,
  tokenId: string,
  network: HederaNetwork,
  minBalance = 0,
): Promise<{ holds: boolean; balance: number }> {
  try {
    const res = await fetch(
      `${MIRROR_NODES[network]}/api/v1/accounts/${accountId.trim()}/tokens?token.id=${tokenId}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return { holds: false, balance: 0 };
    const data = await res.json();
    if (!data.tokens || data.tokens.length === 0) return { holds: false, balance: 0 };
    const balance = data.tokens[0].balance || 0;
    return { holds: balance > minBalance, balance };
  } catch { return { holds: false, balance: 0 }; }
}

// ── Session Persistence ────────────────────────────────────────────────

const STORAGE_KEYS = {
  session: "hbarh-hashpack-session",
  network: "hbarh-hedera-network",
} as const;

function persistSession(session: HashPackSession): void {
  try {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
    localStorage.setItem("hbarh-hedera-account", session.accountId);
    localStorage.setItem("hbarh-hedera-network", session.network);
  } catch { console.warn("Failed to persist session"); }
}

export function restoreSession(): HashPackSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.session);
    if (!raw) return null;
    const session: HashPackSession = JSON.parse(raw);
    if (Date.now() - session.connectedAt > 24 * 60 * 60 * 1000) { clearSession(); return null; }
    if (!session.accountId || !session.network) { clearSession(); return null; }
    if (session.wcTopic) _activeWcTopic = session.wcTopic;
    _activeNetwork = session.network;
    return session;
  } catch { clearSession(); return null; }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.session);
    localStorage.removeItem("hbarh-hedera-account");
  } catch { /* ignore */ }
}

// ── Manual Pairing String Connection ───────────────────────────────────

export async function injectPairingUri(uri: string): Promise<string | null> {
  if (!uri || !uri.startsWith("wc:")) return "Invalid pairing string. It should start with 'wc:'.";
  try {
    const client = await getSignClient();
    await client.core.pairing.pair({ uri });
    console.log("[HBAR.\u0127] Manual pairing URI injected");
    return null;
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("expired")) return "Pairing string has expired. Copy a fresh one.";
    if (msg.includes("already exists")) return null;
    return `Pairing failed: ${msg}`;
  }
}

export async function connectViaPairingString(
  pairingString: string,
  network: HederaNetwork,
): Promise<HashPackConnectionResult> {
  const error = await injectPairingUri(pairingString);
  if (error) return { success: false, session: null, error };
  return new Promise<HashPackConnectionResult>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, session: null, error: "Pairing timed out. Approve the connection in your wallet." });
    }, 60000);
    const check = setInterval(async () => {
      try {
        const client = await getSignClient();
        const sessions = client.session?.getAll?.() ?? [];
        for (const s of sessions) {
          const accounts = getAccountsFromSession(s);
          if (accounts.length > 0) {
            clearTimeout(timeout);
            clearInterval(check);
            _activeWcTopic = s.topic;
            _activeNetwork = network;
            resolve(await _buildSession(accounts[0], network, "walletconnect", s.topic));
            return;
          }
        }
      } catch { /* keep checking */ }
    }, 1500);
  });
}

// ── Force Reset & Storage (public API for modal) ───────────────────────

export async function forceResetHashConnect(): Promise<void> {
  _connectionAbortController?.abort();
  _connectionAbortController = null;
  _activeWcTopic = null;
  await forceResetSignClient();
  clearSession();
  console.log("[HBAR.\u0127] Wallet connection force-reset complete");
}

export function clearWCStorage(preserveIdentity = false): number {
  return coreClearWCStorage(preserveIdentity);
}

// ── Utility Exports ────────────────────────────────────────────────────

export function getHashPackDownloadUrl(): string {
  return "https://www.hashpack.app/download";
}

export function getHashPackDeepLink(pairingUri: string): string {
  return `https://www.hashpack.app/wc?uri=${encodeURIComponent(pairingUri)}`;
}

export function getBladeDeepLink(pairingUri: string): string {
  if (isMobileDevice()) return `bladewallet://wc?uri=${encodeURIComponent(pairingUri)}`;
  return `https://blade.app/wc?uri=${encodeURIComponent(pairingUri)}`;
}

export function getWalletConnectUniversalLink(pairingUri: string): string {
  return `https://www.hashpack.app/wc?uri=${encodeURIComponent(pairingUri)}`;
}

export { isWalletConnectConfigured, getWalletConnectProjectId, openWCModal, closeWCModal, subscribeWCModal };

/** Backward-compat stub */
export async function tryExtensionDirect(_hc: any): Promise<boolean> {
  return false;
}
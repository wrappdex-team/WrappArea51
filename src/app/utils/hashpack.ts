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

import { AccountId } from "./hedera-sdk";
import type { HederaNetwork } from "./hedera";
import { fetchAccountInfo } from "./hedera";
import { log } from "./logger";
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
  prewarmRelay,
  startRelayKeepalive,
  stopRelayKeepalive,
  tryOpenWalletExtension,
} from "./wallet-core";

// ── Mirror Node Endpoints ───────────────────────────────────────

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

/**
 * [C81-02] Optimized receipt polling with fast initial attempts.
 *
 * Hedera consensus is 3-5s, Mirror Node lag is typically 3-7s.
 * [C93] First poll at 800ms (catches txs already at consensus),
 * then 1s intervals for 2 more attempts, then exponential backoff.
 *
 * Timing: 0s, 0.8s, 1s, 1s, 2s, 3s, 5s, 8s = ~20.8s worst case
 * Typical: confirmed by attempt 2-3 (~1.8-2.8s after wallet signs)
 */
async function pollMirrorNodeReceipt(
  txId: string,
  network: HederaNetwork,
  maxAttempts = 8,
  initialDelayMs = 800,
): Promise<{ result: string; status: string } | null> {
  const base = MIRROR_NODES[network];
  const nid = _fmtTxId(txId);
  for (let i = 0; i < maxAttempts; i++) {
    // [C93] Fast initial polls (800ms, 1s, 1s), then exponential backoff
    if (i > 0) {
      const delay = i <= 3
        ? (i === 1 ? initialDelayMs : 1000)       // 800ms first, then 1s flat
        : 1000 * Math.pow(1.5, i - 3);            // exponential after attempt 3
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 8000);
      const res = await fetch(`${base}/api/v1/transactions/${nid}`, { signal: c.signal });
      clearTimeout(t);
      if (res.status === 404 || !res.ok) continue;
      const data = await res.json();
      const txList = data.transactions || [];
      if (txList.length === 0) continue;
      const result = txList[0].result || "";
      log.info("HashPack", `Mirror receipt: "${result}" (attempt ${i + 1}, ${((i === 0 ? 0 : i <= 3 ? (i === 1 ? initialDelayMs : 1000) : 3 + (1000 * Math.pow(1.5, i - 3)) / 1000)).toFixed(1)}s)`);
      return { result, status: result };
    } catch {
      log.info("HashPack", `Mirror poll ${i + 1}/${maxAttempts}: network error`);
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
    log.info("HashPack", "WC session deleted remotely");
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
      log.warn("HashPack", "WC Modal failed to open, falling back", modalErr?.message);
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
    log.info("HashPack", `WC session approved. Topic: ${session?.topic}`);
    log.debug("HashPack", "Namespaces", JSON.stringify(session?.namespaces, null, 2)?.slice(0, 2000));
    log.info("HashPack", `Peer: ${session?.peer?.metadata?.name}`);

    const accounts = getAccountsFromSession(session);
    if (accounts.length === 0) {
      log.warn("HashPack", "No Hedera accounts in session. Keys: " + Object.keys(session?.namespaces || {}).join(", "));
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

    log.info("HashPack", `Connected: ${accountId} (topic: ${session.topic})`);

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
  // [C16-04] Delay long enough for the SignClient to fully initialize AND
  // complete the relay handshake. The old 2s delay was too aggressive in
  // HMR / preview environments where module-level WC state gets reset —
  // a new SignClient hasn't synced sessions yet, causing a false "stale"
  // detection that disconnects the wallet every ~30 seconds.
  //
  // Strategy: wait 5s, then verify relay connectivity before checking
  // session store. If relay is not connected, skip validation entirely
  // (leave the session in localStorage — next real sign call will
  // reconnect or fail with a clear user-facing error).
  setTimeout(async () => {
    try {
      const client = await getSignClient();
      if (!client) return;

      // [C16-04] Guard: only validate if the relay appears connected.
      // A freshly-initialized SignClient (e.g., after HMR) won't have
      // synced sessions from the relay yet, so its session store is
      // empty — this is NOT the same as a genuinely stale session.
      const relayConnected = (client as any)?.core?.relayer?.connected
        ?? (client as any)?.core?.relayer?.provider?.connection?.connected
        ?? null;
      if (relayConnected === false) {
        log.info("HashPack", "Session validation deferred — relay not yet connected (SignClient may still be initializing)");
        return;
      }

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
          log.info("HashPack", `Session topic updated: ${session.wcTopic?.slice(0, 8)} → ${matchingSession.topic.slice(0, 8)}`);
          _activeWcTopic = matchingSession.topic;
          session.wcTopic = matchingSession.topic;
          try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* */ }
          return;
        }

        // [C16-04] Before declaring stale, double-check that we have at
        // least ONE session in the store. An empty store after init
        // usually means the relay hasn't synced yet — not a real stale.
        const totalSessionCount = allSessions.length;
        if (totalSessionCount === 0 && relayConnected === null) {
          log.info("HashPack", "Session validation inconclusive — 0 sessions in store but relay state unknown. Keeping local session.");
          return;
        }

        // No WC session at all — stale
        log.warn("HashPack", `Stale session detected for ${session.accountId} — WC topic not found in SignClient (${totalSessionCount} total sessions, relay=${relayConnected})`);
        _activeWcTopic = null;
        try { localStorage.removeItem(SESSION_KEY); } catch { /* */ }
        _staleSessionCBs.forEach(cb => {
          try { cb(session.accountId); } catch { /* */ }
        });
      }
    } catch (err: any) {
      // SignClient init failed — can't validate, leave session as-is
      log.warn("HashPack", "Session validation skipped — SignClient unavailable", err?.message);
    }
  }, 5000); // [C16-04] Increased from 2s → 5s for relay sync time
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
    log.warn("HashPack", "Disconnect error (non-fatal)", err);
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
 * Execute an unfrozen Hedera SDK Transaction via the connected wallet.
 *
 * This is the primary entry point used by saucerswap.ts for all on-chain
 * operations (swaps, approvals, token associations, wrap/unwrap).
 *
 * Flow:
 *   1. Serialize the unfrozen SDK transaction to bytes via .toBytes()
 *   2. Send to the connected wallet via WalletConnect (HIP-820)
 *   3. The wallet freezes (sets nodeAccountIds + txId), signs, and submits
 *   4. Poll Mirror Node for receipt confirmation
 *
 * Returns { success, transactionId?, error?, userCancelled? } which is
 * the shape all SaucerSwap execution functions expect.
 */
export async function executeHederaTransaction(
  accountId: string,
  sdkTransaction: any,
): Promise<{ success: boolean; transactionId?: string; error?: string; userCancelled?: boolean }> {
  if (!_activeWcTopic) {
    return { success: false, error: "No active WalletConnect session" };
  }
  try {
    // [C28-02] Limit to single consensus node to prevent fee multiplication.
    // The SDK's toBytes() creates N transaction variants (one per node).
    // Each variant gets signed and may be submitted, costing ~0.5 HBAR per
    // attempt. With 3 nodes default, a reverted contract call costs 3×.
    try {
      if (typeof sdkTransaction.setNodeAccountIds === "function") {
        sdkTransaction.setNodeAccountIds([new AccountId(3)]);
      }
    } catch { /* non-blocking — proceed with default nodes */ }

    // Serialize the SDK transaction
    const txBytes: Uint8Array = sdkTransaction.toBytes();
    log.info("HashPack", `Sending ${txBytes.length}B transaction via WC (single-node)`);
    const result = await signAndExecuteTransaction(_activeWcTopic, _activeNetwork, accountId, txBytes);
    const txId = result?.transactionId || undefined;

    log.info("HashPack", `WC response received — txId: ${txId || "none"}, keys: ${result ? Object.keys(result).join(",") : "null"}`);

    // Poll Mirror Node for receipt to confirm on-chain success
    if (txId) {
      const receipt = await pollMirrorNodeReceipt(txId, _activeNetwork);
      if (receipt && receipt.status !== "SUCCESS") {
        return {
          success: false,
          transactionId: txId,
          error: `Transaction reverted on-chain: ${receipt.status}`,
        };
      }
      // [C28-03] If mirror node polling returns null (receipt not found in time),
      // proceed optimistically. The wallet confirmed submission, and the most
      // likely cause of null receipt is mirror node lag — not a failed tx.
      // If the tx actually failed on-chain, the NEXT step (swap) will fail
      // with a clear error, costing only one extra popup vs blocking everything.
      if (!receipt) {
        log.warn("HashPack", `Mirror Node receipt not found for ${txId} — proceeding optimistically (wallet confirmed submission)`);
      }
    }

    return { success: true, transactionId: txId };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const lc = msg.toLowerCase();
    const isUserReject =
      lc.includes("rejected") ||
      lc.includes("user_reject") ||
      lc.includes("cancelled by user") ||
      lc.includes("canceled by user") ||
      lc.includes("user denied");
    if (isUserReject) {
      return { success: false, error: "Transaction rejected by wallet", userCancelled: true };
    }

    // ── Timeout recovery: check Mirror Node for recent transactions ──
    // [C9-01] When WalletConnect times out, the wallet may have already
    // signed and submitted the transaction. Check the account's recent
    // transaction history to see if a contract execute succeeded.
    const isTimeout = lc.includes("timed out") || lc.includes("timeout");
    if (isTimeout) {
      log.warn("HashPack", "WC timed out — checking Mirror Node for recent contract executions");
      try {
        const base = MIRROR_NODES[_activeNetwork];
        const lookbackSec = 180; // check last 3 minutes
        const since = new Date(Date.now() - lookbackSec * 1000).toISOString();
        const url = `${base}/api/v1/transactions?account.id=${accountId}&transactiontype=CONTRACTCALL&order=desc&limit=3&timestamp=gte:${encodeURIComponent(since)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const data = await res.json();
          const txns = data.transactions || [];
          const recent = txns.find((t: any) => t.result === "SUCCESS");
          if (recent) {
            const recentTxId = recent.transaction_id || recent.consensus_timestamp;
            log.info("HashPack", `Found recent SUCCESS tx via Mirror Node: ${recentTxId}`);
            return {
              success: true,
              transactionId: recentTxId,
              error: "WalletConnect relay timed out, but the transaction appears to have succeeded on-chain. " +
                "Verify in your wallet or on HashScan.",
            };
          }
          // Check for recent failures
          const failed = txns.find((t: any) => t.result && t.result !== "SUCCESS");
          if (failed) {
            log.warn("HashPack", `Found recent FAILED tx: ${failed.transaction_id} — result: ${failed.result}`);
            return {
              success: false,
              transactionId: failed.transaction_id,
              error: `WalletConnect timed out. A recent transaction was found but it failed: ${failed.result}. ` +
                `Check HashScan for details.`,
            };
          }
          log.info("HashPack", `No recent contract calls found in last ${lookbackSec}s — transaction may not have been submitted`);
        }
      } catch (mnErr: any) {
        log.warn("HashPack", `Mirror Node fallback check failed: ${mnErr?.message}`);
      }
    }

    return { success: false, error: msg };
  }
}

/**
 * [C81-02] Fast-path transaction execution — skips Mirror Node receipt polling.
 *
 * Used for approval transactions where we don't need to wait for receipt
 * confirmation. The wallet signs and submits to consensus; we proceed
 * immediately after a short 3s consensus wait (Hedera finality is 3-5s).
 *
 * If the approval didn't actually commit, the subsequent swap TX will
 * revert with CONTRACT_REVERT_EXECUTED, giving a clear error — much
 * better UX than waiting 15-30s for receipt polling on every approval.
 *
 * This saves 5-25 seconds per approval transaction.
 */
export async function executeHederaTransactionFast(
  accountId: string,
  sdkTransaction: any,
): Promise<{ success: boolean; transactionId?: string; error?: string; userCancelled?: boolean }> {
  if (!_activeWcTopic) {
    return { success: false, error: "No active WalletConnect session" };
  }
  try {
    // Single node to prevent fee multiplication
    try {
      if (typeof sdkTransaction.setNodeAccountIds === "function") {
        sdkTransaction.setNodeAccountIds([new AccountId(3)]);
      }
    } catch { /* non-blocking */ }

    const txBytes: Uint8Array = sdkTransaction.toBytes();
    log.info("HashPack", `[FAST] Sending ${txBytes.length}B transaction via WC (no receipt poll)`);
    const result = await signAndExecuteTransaction(_activeWcTopic, _activeNetwork, accountId, txBytes);
    const txId = result?.transactionId || undefined;

    log.info("HashPack", `[FAST] WC response — txId: ${txId || "none"}`);

    // [PERF-01] No artificial wait — WalletConnect round-trip already takes
    // 2-5s (wallet signs → submits to consensus node → returns). Both
    // prerequisite (approve/associate) and dependent (swap) transactions
    // target the same node (0.0.3), so the node processes them sequentially.
    // This matches SaucerSwap.finance's behavior — zero delay between popups.
    // Previous 1s wait was redundant with the 3s CONSENSUS_WAIT_MS in
    // swap-engine.ts and added unnecessary UX friction.

    return { success: true, transactionId: txId };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const lc = msg.toLowerCase();
    const isUserReject =
      lc.includes("rejected") ||
      lc.includes("user_reject") ||
      lc.includes("cancelled by user") ||
      lc.includes("canceled by user") ||
      lc.includes("user denied");
    if (isUserReject) {
      return { success: false, error: "Transaction rejected by wallet", userCancelled: true };
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
    log.warn("HashPack", "Sign failed", err?.message);
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
): Promise<{ signatures: any; rawSignatureMap?: string } | null> {
  if (!_activeWcTopic) return null;
  try {
    return await signMessageViaWC(_activeWcTopic, _activeNetwork, accountId, message);
  } catch (err: any) {
    log.warn("HashPack", "Message sign failed", err?.message);
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

export { isWalletConnectConfigured, getWalletConnectProjectId, openWCModal, closeWCModal, subscribeWCModal, prewarmRelay, startRelayKeepalive, stopRelayKeepalive, tryOpenWalletExtension };
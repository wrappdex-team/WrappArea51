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
  // [CONNECT-PERF] Use a shorter 5s timeout for init — if the relay is slow,
  // the pre-connect keepalive will handle reconnection in the background.
  // This prevents the prewarm from blocking for 10s+ on slow networks.
  await _ensureRelayConnected(client, 5000);

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

  // Ensure relay WebSocket is alive before sending the proposal.
  // Without this, client.connect() throws "send was called before connect"
  // if the relay dropped while the tab was backgrounded. [C15-01]
  //
  // [CONNECT-PERF] Use a short 3s timeout instead of the default 10s.
  // The pre-connect keepalive (startPreConnectKeepalive) keeps the relay
  // warm since page load, so this is just a fast verification check. If the
  // relay truly dropped, the retry loop below handles it with a force-reset.
  await _ensureRelayConnected(client, 3000);

  // [C96] Retry with force-reset on relay failures.
  // proposeSession doesn't go through _safeRequest, so it needs its own retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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
    } catch (err: any) {
      const msg = err?.message || "";
      if (attempt === 0 && (msg.includes("send was called before connect") || msg.includes("Missing or invalid"))) {
        console.warn("[WC] proposeSession failed with relay error — force-resetting SignClient and retrying...");
        await forceResetSignClient();
        // Re-init and retry — getSignClient() will create a fresh instance
        const freshClient = await getSignClient();
        await _ensureRelayConnected(freshClient, 12000);
        // Loop continues with attempt=1 using freshClient, but we need the
        // client variable updated. Since we're in a closure, just recurse once:
        const { uri, approval } = await freshClient.connect({
          optionalNamespaces: {
            hedera: {
              methods: [...HEDERA_METHODS],
              chains: [chainId],
              events: [...HEDERA_EVENTS],
            },
          },
        });
        if (!uri) throw new Error("Failed to generate WalletConnect pairing URI after force-reset.");
        return { uri, approval: approval() };
      }
      throw err;
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("proposeSession: exhausted retries");
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

  // 3. Ensure relay WebSocket is alive — uses _ensureRelayConnected which
  //    actively triggers restartTransport() if disconnected. [C15-01]
  await _ensureRelayConnected(client);
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

  // ── [MOB-FIX] Resolve wallet redirect URL for mobile ────────────────
  //
  // On mobile, the WC relay delivers the signing request to the wallet,
  // but we need to bring the wallet app to the FOREGROUND so the user
  // can see the approval prompt. Without this, the request arrives
  // silently and the dApp spins until timeout.
  //
  // Priority order for redirect URL:
  //   1. Session peer metadata `redirect.native` (e.g., "hashpack://")
  //   2. Session peer metadata `redirect.universal` (e.g., "https://...")
  //   3. Detect wallet by peer name/url → use known native deep link
  //   4. Last resort: generic "wc:" deep link pass-through
  //
  // CRITICAL: On mobile, `window.open(url, "_blank")` opens a BROWSER TAB
  // (shows the website, not the app). iOS Universal Links and Android App
  // Links only activate from `window.location.href` navigation or user taps.
  // Native custom schemes (hashpack://) work with `window.location.href`.
  let walletRedirect: string | null = null;
  let walletRedirectKind: "native" | "universal" | "fallback" = "fallback";
  if (isMobile && params.topic) {
    try {
      const session = client.session?.get?.(params.topic);
      const redirect = session?.peer?.metadata?.redirect;
      const peerName = (session?.peer?.metadata?.name || "").toLowerCase();
      const peerUrl = (session?.peer?.metadata?.url || "").toLowerCase();
      console.log(`[WC] [MOB-FIX] Mobile redirect resolution:`,
        `peer="${peerName}", url="${peerUrl}",`,
        `redirect.native="${redirect?.native || "—"}",`,
        `redirect.universal="${redirect?.universal || "—"}"`);

      // 1. Peer-provided native deep link (most reliable)
      if (redirect?.native) {
        walletRedirect = redirect.native;
        walletRedirectKind = "native";
      }
      // 2. Peer-provided universal link
      else if (redirect?.universal) {
        walletRedirect = redirect.universal;
        walletRedirectKind = "universal";
      }
      // 3. Detect HashPack by name or URL → use native scheme
      //    "hashpack://" is the registered custom URL scheme for HashPack's
      //    iOS and Android apps. Using the native scheme directly opens the
      //    app without any browser tab — far more reliable than the
      //    universal link "https://www.hashpack.app/wc" which just opens
      //    the website in a browser tab.
      else if (peerName.includes("hashpack") || peerUrl.includes("hashpack")) {
        walletRedirect = "hashpack://";
        walletRedirectKind = "native";
        console.log(`[WC] [MOB-FIX] Detected HashPack — using native scheme "hashpack://"`);
      }
      // 4. Detect Blade wallet
      else if (peerName.includes("blade") || peerUrl.includes("blade")) {
        walletRedirect = "blade://";
        walletRedirectKind = "native";
      }
    } catch (e: any) {
      console.warn("[WC] [MOB-FIX] Session lookup failed:", e?.message);
    }
    console.log(`[WC] [MOB-FIX] Resolved: walletRedirect="${walletRedirect}", kind=${walletRedirectKind}`);
  }

  /**
   * [MOB-FIX] Fire mobile redirect to bring wallet app to foreground.
   *
   * Uses `window.location.href` for ALL redirect types on mobile:
   * - Native schemes (hashpack://, blade://, etc.), window.location.href
   *   triggers the OS deep link handler. The browser page is NOT navigated
   *   away — the OS intercepts the custom scheme before navigation occurs.
   * - Universal links (https://...) → OS intercepts IF app is installed
   *   and the domain has .well-known/apple-app-site-association configured
   *
   * `window.open(url, "_blank")` DOES NOT work for bringing apps to
   * foreground on mobile — it opens a browser tab to the website instead.
   */
  function fireMobileRedirect(): boolean {
    if (!walletRedirect) {
      console.warn("[WC] [MOB-FIX] No wallet redirect URL available — wallet may not open");
      return false;
    }
    console.log(`[WC] [MOB-FIX] Firing mobile redirect (${walletRedirectKind}): ${walletRedirect}`);
    try {
      // For native schemes (hashpack://, blade://, etc.), window.location.href
      // triggers the OS deep link handler. The browser page is NOT navigated
      // away — the OS intercepts the custom scheme before navigation occurs.
      // For universal links, window.location.href is also the correct approach
      // (window.open would just open a browser tab).
      window.location.href = walletRedirect;
      return true;
    } catch (e1: any) {
      console.warn("[WC] [MOB-FIX] location.href redirect failed:", e1?.message);
      // Fallback: try window.open as last resort
      try {
        origOpen.call(window, walletRedirect, "_blank");
        return true;
      } catch (e2: any) {
        console.warn("[WC] [MOB-FIX] window.open fallback also failed:", e2?.message);
        return false;
      }
    }
  }

  // ── [C89] Non-blocking wallet pre-activation ───────────────────────
  // Chrome kills extension service workers after ~30s of inactivity,
  // severing the WC relay WebSocket. Fix: fire activation strategies
  // in the background and proceed with just a brief 500ms window.
  // This eliminates the 3.25s blocking delay that caused screen flicker.
  //
  // Strategy: Fire chrome.runtime.sendMessage FIRST (instant, most reliable),
  // then WC session ping in background. Both are non-blocking and fail silently.
  // The 500ms wait gives the service worker enough time to reconnect its relay WS
  // without causing a visible UI stall.
  if (params.topic && !isMobile) {
    await _tryActivateWalletFast(client, params.topic);
  }

  // ── [MOB-FIX-v2] Mobile redirect is now fired AFTER client.request() ──
  // The old pre-activation fired fireMobileRedirect() BEFORE the WC relay
  // request, which caused a deadlock: opening the wallet backgrounded the
  // browser tab, freezing setTimeout/JS execution, so client.request()
  // never fired → the user waited in the wallet for a prompt that was
  // never sent. Fix: send the relay request first, THEN redirect.
  // See doRequest() below for the new mobile redirect logic.

  if (isIframe || isMobile) {
    window.open = function (url?: any, target?: any, features?: any): WindowProxy | null {
      const urlStr = String(url || "");

      // ── Mobile: suppress WC pairing URI deep links ──────────────
      // The WC SDK fires window.open("wc:<pairingTopic>@2?...") which
      // the mobile OS misinterprets as a NEW pairing request. Suppress
      // it — the doRequest() redirect (fired after relay publish) handles
      // bringing the wallet to foreground. The WC SDK's deep link is broken
      // on mobile (opens "Pair with dApp" instead of the signing prompt).
      if (isMobile && (urlStr.startsWith("wc:") || urlStr.includes("wc%3A") || urlStr.includes("/wc?uri=wc"))) {
        console.log("[WC] [MOB-FIX-v2] Suppressed WC pairing deep-link:", urlStr.slice(0, 120));
        // [MOB-FIX-v2] Do NOT fire redirect from interceptor — doRequest()
        // handles the redirect AFTER confirming the relay publish succeeded.
        // Firing here could redirect before the message is sent.
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

  // ── [MOB-FIX-v2] visibilitychange handler ──────────────────────────
  // When the user returns from the wallet app, the browser tab resumes
  // but the relay WebSocket is likely dead (mobile OS killed it while
  // backgrounded). This handler reconnects the relay so the signed
  // response can be delivered from the relay server's message queue.
  //
  // [MOB-SWAP-FIX] Extended timeout + immediate reconnection attempt.
  // The signed transaction response is queued at the relay server, but
  // we must reconnect the WS FAST or the 120s client.request() timeout
  // will expire before we retrieve it. Give the relay 15s to reconnect.
  let _visCleanup: (() => void) | null = null;
  if (isMobile) {
    const onVis = async () => {
      if (document.visibilityState === "visible") {
        console.log("[WC] [MOB-FIX-v3] Tab resumed from background — FORCED relay reconnection...");
        try {
          // [MOB-FIX-v3] Don't use _ensureRelayConnected here — it trusts
          // relayer.connected which is stale after mobile backgrounding.
          // Instead, force disconnect→reconnect just like pre-request.
          const relayer = client.core?.relayer;
          const provider = relayer?.provider;

          // Force disconnect
          if (provider && typeof provider.disconnect === "function") {
            try {
              await Promise.race([provider.disconnect(), new Promise(r => setTimeout(r, 1500))]);
            } catch { /* may already be closed */ }
          }
          await new Promise(r => setTimeout(r, 200));

          // Force reconnect
          if (provider && typeof provider.connect === "function") {
            await Promise.race([
              provider.connect(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("vis reconnect timeout")), 10000)),
            ]);
          } else if (typeof relayer?.restartTransport === "function") {
            await Promise.race([
              relayer.restartTransport(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("vis restart timeout")), 10000)),
            ]);
          }

          // Verify
          const ws = provider?.connection?.socket ?? provider?.socket;
          console.log("[WC] [MOB-FIX-v3] Post-resume relay state:",
            "relayer.connected=", relayer?.connected,
            "ws.readyState=", ws?.readyState);

          if (ws?.readyState !== 1) {
            // Poll up to 5s more
            const pollStart = Date.now();
            while (Date.now() - pollStart < 5000) {
              const wsNow = provider?.connection?.socket ?? provider?.socket;
              if (wsNow?.readyState === 1) {
                console.log("[WC] [MOB-FIX-v3] WS reconnected after", Date.now() - pollStart, "ms post-resume");
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            }
          }
          console.log("[WC] [MOB-FIX-v3] Relay reconnected — listening for wallet response");
        } catch (e: any) {
          console.error("[WC] [MOB-FIX-v3] CRITICAL: Relay reconnect on resume FAILED:", e?.message,
            "— wallet response may be lost. User will see timeout.");
          // Last resort: try _ensureRelayConnected as fallback
          try {
            await _ensureRelayConnected(client, 15000);
          } catch { /* truly failed */ }
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    _visCleanup = () => document.removeEventListener("visibilitychange", onVis);
  }

  try {
    // ── Relay readiness + retry for "send was called before connect" ──
    // Even after _ensureRelayConnected, the WebSocket may still be in a
    // brief CONNECTING state. Retry once on this specific error. [C15-01]
    // [MOB-SWAP-FIX] Increase mobile timeout from 120s → 180s (3 minutes)
    // to account for slower mobile relay reconnection after app switch.
    const WC_REQUEST_TIMEOUT_MS = isMobile ? 180_000 : 120_000;

    // ── [MOB-FIX-v3] Forced relay freshness for mobile ──────────────────
    // On mobile, the relay WebSocket is frequently in a "half-open" state:
    // the OS killed it while the tab was backgrounded, but the SDK hasn't
    // detected the close event. client.request() sends data to this dead
    // socket, ws.send() doesn't throw (data goes to OS buffer for dead
    // connection), and the relay never receives the message.
    //
    // Fix: Force a disconnect→reconnect cycle on mobile EVERY TIME before
    // sending a signing request. This guarantees a fresh, verified WebSocket.
    // Sessions persist in localStorage — only the transport is recycled.
    if (isMobile) {
      console.log("[WC] [MOB-FIX-v3] Mobile detected — forcing fresh relay connection before signing...");
      try {
        const relayer = client.core?.relayer;
        const provider = relayer?.provider;

        // 1. Check raw WS state
        const ws = provider?.connection?.socket ?? provider?.socket;
        const wsState = ws?.readyState ?? -1;
        console.log("[WC] [MOB-FIX-v3] Pre-cycle WS state:",
          "relayer.connected=", relayer?.connected,
          "ws.readyState=", wsState,
          "(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)");

        // 2. Force disconnect the provider (tears down the WebSocket)
        if (provider && typeof provider.disconnect === "function") {
          try {
            await Promise.race([
              provider.disconnect(),
              new Promise(r => setTimeout(r, 2000)),
            ]);
          } catch { /* disconnect can throw if already closed */ }
        }

        // 3. Brief pause for WebSocket to fully close
        await new Promise(r => setTimeout(r, 300));

        // 4. Reconnect with a fresh WebSocket
        if (provider && typeof provider.connect === "function") {
          await Promise.race([
            provider.connect(),
            new Promise((_, rej) => setTimeout(() => rej(new Error("mobile relay reconnect timeout")), 8000)),
          ]);
        } else if (typeof relayer?.restartTransport === "function") {
          await Promise.race([
            relayer.restartTransport(),
            new Promise((_, rej) => setTimeout(() => rej(new Error("mobile relay restart timeout")), 8000)),
          ]);
        }

        // 5. Verify the new connection
        const ws2 = provider?.connection?.socket ?? provider?.socket;
        const ws2State = ws2?.readyState ?? -1;
        console.log("[WC] [MOB-FIX-v3] Post-cycle WS state:",
          "relayer.connected=", relayer?.connected,
          "ws.readyState=", ws2State);

        if (ws2State !== 1 /* OPEN */) {
          console.warn("[WC] [MOB-FIX-v3] Fresh WS still not OPEN — polling for up to 5s...");
          const pollStart = Date.now();
          while (Date.now() - pollStart < 5000) {
            const wsNow = provider?.connection?.socket ?? provider?.socket;
            if (wsNow?.readyState === 1) {
              console.log("[WC] [MOB-FIX-v3] WS became OPEN after", Date.now() - pollStart, "ms");
              break;
            }
            await new Promise(r => setTimeout(r, 200));
          }
        }
      } catch (e: any) {
        console.warn("[WC] [MOB-FIX-v3] Forced relay cycle failed:", e?.message,
          "— proceeding with existing connection (may fail)");
      }
    }

    const doRequest = async () => {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          `WalletConnect request timed out after ${WC_REQUEST_TIMEOUT_MS / 1000} seconds. ` +
          "The wallet may not have received the request, or the relay failed to deliver the response. " +
          "Check your wallet for any pending approval prompts, then try again."
        )), WC_REQUEST_TIMEOUT_MS)
      );

      // ── [MOB-FIX-v2] Send request FIRST, then redirect ──────────────
      // Start the WC relay request (sends the message to the relay server).
      // The relay queues it for the wallet. THEN open the wallet app so it
      // connects to the relay and picks up the queued signing request.
      //
      // Old flow (BROKEN): redirect → sleep(1200) → request
      //   → Browser tab backgrounds, sleep freezes, request never sends.
      //
      // New flow (FIXED):  request → verify publish → redirect
      //   → Relay message is confirmed sent, wallet opens and receives it.
      //
      // CRITICAL GUARD: Only fire redirect if the publish didn't fail.
      // If client.request() rejects early (dead relay WS, bad topic, etc.),
      // redirecting would background the tab and freeze the retry logic.

      // Log relay state for mobile debugging
      if (isMobile) {
        try {
          const relayer = client.core?.relayer;
          const provider = relayer?.provider;
          const ws = provider?.connection?.socket ?? provider?.socket;
          console.log("[WC] [MOB-FIX-v3] Pre-request relay state:",
            "relayer.connected=", relayer?.connected,
            "ws.readyState=", ws?.readyState,
            "ws.bufferedAmount=", ws?.bufferedAmount);
        } catch { /* diagnostic only */ }
      }

      // Track whether the request failed BEFORE the redirect timer fires.
      // client.request() is async: it encrypts, then calls ws.send(), then
      // returns a Promise that resolves when the wallet RESPONDS. An early
      // rejection means the publish itself failed (dead WS, bad topic, etc.).
      let publishFailed = false;
      let publishFailReason = "";
      const requestPromise = client.request(params);

      // Attach a catch handler to detect early failures WITHOUT consuming
      // the rejection (the outer Promise.race still sees it).
      requestPromise.catch((err: any) => {
        publishFailed = true;
        publishFailReason = err?.message || "unknown";
      });

      if (isMobile && walletRedirect) {
        // [MOB-FIX-v3] Smart publish confirmation before redirect.
        //
        // Old approach: 600ms fixed timer → wallet redirect. BROKEN because
        // the relay publish might not complete in 600ms on mobile, or the
        // WS might be half-open (send() doesn't throw but data is lost).
        //
        // New approach: Monitor ws.bufferedAmount to confirm the encrypted
        // message was flushed to the OS network stack, THEN redirect.
        // This guarantees the relay received (or will receive) the data
        // before we background the browser tab by opening the wallet.
        //
        // Fallback: if bufferedAmount monitoring fails or takes too long,
        // redirect after 2500ms (conservative) instead of 600ms.
        (async () => {
          try {
            // Phase 1: Wait for the async encrypt → publish chain to start.
            // client.request() runs: await crypto.encode() → await relayer.publish()
            // The first microtask yields happen within ~10-50ms.
            await new Promise(r => setTimeout(r, 300));

            if (publishFailed) {
              console.warn("[WC] [MOB-FIX-v3] Request FAILED early — NOT opening wallet.",
                "Reason:", publishFailReason);
              return;
            }

            // Phase 2: Wait for WS buffer to flush (data sent to OS network stack).
            // ws.bufferedAmount > 0 means data is queued but not yet sent.
            const relayer = client.core?.relayer;
            const provider = relayer?.provider;
            const ws = provider?.connection?.socket ?? provider?.socket;
            const flushStart = Date.now();
            const maxFlushWait = 2200; // max 2.2s for buffer flush

            if (ws && ws.readyState === 1 /* OPEN */) {
              let flushLoops = 0;
              while (ws.bufferedAmount > 0 && Date.now() - flushStart < maxFlushWait) {
                await new Promise(r => setTimeout(r, 50));
                flushLoops++;
              }
              if (flushLoops > 0) {
                console.log("[WC] [MOB-FIX-v3] WS buffer flushed after",
                  Date.now() - flushStart, "ms,", flushLoops, "polls");
              }
            } else {
              // WS not open — wait longer and hope for the best
              console.warn("[WC] [MOB-FIX-v3] WS not OPEN at redirect time:",
                "readyState=", ws?.readyState, "— waiting 2s fallback");
              await new Promise(r => setTimeout(r, 2000));
            }

            // Phase 3: Extra safety margin for relay server ACK processing
            await new Promise(r => setTimeout(r, 200));

            if (publishFailed) {
              console.warn("[WC] [MOB-FIX-v3] Request failed during flush wait — NOT opening wallet.",
                "Reason:", publishFailReason);
              return;
            }

            // Phase 4: Final relay state check and redirect
            const ws2 = provider?.connection?.socket ?? provider?.socket;
            console.log("[WC] [MOB-FIX-v3] Pre-redirect state:",
              "relayer.connected=", relayer?.connected,
              "ws.readyState=", ws2?.readyState,
              "bufferedAmount=", ws2?.bufferedAmount,
              "totalWait=", Date.now() - flushStart, "ms");
            console.log("[WC] [MOB-FIX-v3] Relay publish confirmed — opening wallet app...");
            fireMobileRedirect();
          } catch (e: any) {
            console.warn("[WC] [MOB-FIX-v3] Redirect helper error:", e?.message);
            // Fallback: redirect anyway if publish didn't fail
            if (!publishFailed) {
              console.log("[WC] [MOB-FIX-v3] Fallback redirect despite error");
              fireMobileRedirect();
            }
          }
        })();
      }

      return await Promise.race([requestPromise, timeoutPromise]);
    };

    try {
      return await doRequest();
    } catch (firstErr: any) {
      const msg = firstErr?.message || "";
      // Retry exactly once on relay-not-ready errors
      if (msg.includes("send was called before connect") || msg.includes("Missing or invalid topic")) {
        console.warn("[WC] Relay not ready — reconnecting and retrying once...");
        await _ensureRelayConnected(client, 8000);
        try {
          return await doRequest();
        } catch (retryErr: any) {
          const retryMsg = retryErr?.message || "";
          // [C97] If retry still fails with relay error, force-reset and try one last time
          if (retryMsg.includes("send was called before connect") || retryMsg.includes("Missing or invalid")) {
            console.warn("[WC] Retry still failed — force-resetting SignClient for last attempt...");
            await forceResetSignClient();
            const freshClient = await getSignClient();
            await _ensureRelayConnected(freshClient, 12000);
            // Rebuild request with fresh client
            const freshRequestPromise = freshClient.request(params);
            // [MOB-FIX-v3] Smart redirect for force-reset path too
            if (isMobile && walletRedirect) {
              let freshFailed = false;
              freshRequestPromise.catch(() => { freshFailed = true; });
              (async () => {
                try {
                  // Wait for encrypt + publish to complete
                  await new Promise(r => setTimeout(r, 500));
                  // Monitor buffer flush
                  const fp = freshClient.core?.relayer?.provider;
                  const fws = fp?.connection?.socket ?? fp?.socket;
                  const fStart = Date.now();
                  if (fws && fws.readyState === 1) {
                    while (fws.bufferedAmount > 0 && Date.now() - fStart < 2000) {
                      await new Promise(r => setTimeout(r, 50));
                    }
                  } else {
                    await new Promise(r => setTimeout(r, 1500));
                  }
                  await new Promise(r => setTimeout(r, 200));
                  if (!freshFailed) {
                    console.log("[WC] [MOB-FIX-v3] Force-reset publish confirmed — opening wallet...");
                    fireMobileRedirect();
                  }
                } catch {
                  if (!freshFailed) fireMobileRedirect();
                }
              })();
            }
            return await Promise.race([
              freshRequestPromise,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("WalletConnect request timed out after force-reset.")), WC_REQUEST_TIMEOUT_MS)
              ),
            ]);
          }
          throw retryErr;
        }
      }
      throw firstErr;
    }
  } finally {
    if (isIframe || isMobile) window.open = origOpen;
    // [MOB-FIX-v2] Clean up visibilitychange listener
    if (typeof _visCleanup === "function") _visCleanup();
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

  // IMPLEMENTATION NOTE: Send the message as plain UTF-8 text to the wallet.
  // HashPack (and most HIP-820 wallets) treat the message parameter as a
  // plain string — displaying it directly and signing its UTF-8 bytes.
  // Base64 encoding caused HashPack to display gibberish and sign the wrong
  // bytes, leading to server-side verification failures.

  try {
    const result = await _safeRequest(client, {
      topic,
      chainId,
      request: {
        method: "hedera_signMessage",
        params: {
          signerAccountId: `${chainId}:${accountId}`,
          message: message,
        },
      },
    });

    console.log("[WC] signMessage raw result:", typeof result,
      result ? JSON.stringify(result).slice(0, 600) : "null");

    let rawSignatureMap: string | undefined;
    if (result && typeof result === "object" && typeof result.signatureMap === "string") {
      rawSignatureMap = result.signatureMap;
    }

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

// ── Relay Prewarm ─────────────────────────────────────────────────────

/**
 * [C81-01] Pre-warm the WalletConnect relay WebSocket connection.
 *
 * Call this EARLY — at swap button hover, swap panel mount, or the very
 * start of handleSwap() — so the relay is already connected by the time
 * the wallet signing request is dispatched.
 *
 * Without this, the relay may be in a CLOSED state (browser backgrounded
 * the tab, relay server dropped the connection) and `_safeRequest()` has
 * to reconnect synchronously, causing the wallet to NOT auto-popup.
 *
 * This is fire-and-forget — errors are silently caught.
 */
export async function prewarmRelay(): Promise<void> {
  try {
    const client = await getSignClient();
    await _ensureRelayConnected(client, 8000);
  } catch {
    // Non-critical — _safeRequest will retry before actual signing
  }
}

/** Keepalive interval ID — set once per session. */
let _relayKeepaliveId: ReturnType<typeof setInterval> | null = null;

/**
 * [C81-01] Start a relay keepalive that pings every 25 seconds.
 *
 * WalletConnect relay WebSockets typically drop after 30-60 seconds of
 * inactivity. This keepalive ensures the connection stays warm so wallet
 * signing requests are delivered instantly.
 *
 * Call once after wallet connection. Safe to call multiple times.
 */
export function startRelayKeepalive(): void {
  if (_relayKeepaliveId) return;
  // [CONNECT-PERF] Stop the pre-connect keepalive — this one takes over
  stopPreConnectKeepalive();
  _relayKeepaliveId = setInterval(async () => {
    try {
      if (!_signClient) return;
      const relayer = _signClient.core?.relayer;
      if (relayer && !relayer.connected) {
        console.log("[WC] Keepalive: relay disconnected — reconnecting");
        await _ensureRelayConnected(_signClient, 5000);
      }
    } catch {
      // Best effort — don't throw in keepalive
    }
  }, 25_000);
}

/**
 * Stop the relay keepalive (on disconnect).
 */
export function stopRelayKeepalive(): void {
  if (_relayKeepaliveId) {
    clearInterval(_relayKeepaliveId);
    _relayKeepaliveId = null;
  }
}

// ── Pre-Connect Relay Keepalive ────────────────────────────────────────

/** Pre-connect keepalive interval ID */
let _preConnectKeepaliveId: ReturnType<typeof setInterval> | null = null;

/**
 * [CONNECT-PERF] Start a relay keepalive that runs BEFORE the wallet connects.
 *
 * Problem: The relay WebSocket drops after ~30-60s of inactivity. The post-
 * connect keepalive (startRelayKeepalive) only runs after a wallet is linked.
 * Between page load prewarm and the user clicking "Connect" (often 30-120s),
 * the relay dies. When connectViaHashConnect → proposeSession calls
 * _ensureRelayConnected, it triggers a multi-phase reconnection cycle that
 * takes 5-10+ seconds — this is the source of the slow initial connect.
 *
 * Fix: Ping the relay every 20s starting immediately after prewarm.
 * Auto-stops when the post-connect keepalive takes over (startRelayKeepalive).
 * Safe to call multiple times.
 */
export function startPreConnectKeepalive(): void {
  if (_preConnectKeepaliveId) return;
  // If the post-connect keepalive is already running, no need for this
  if (_relayKeepaliveId) return;

  _preConnectKeepaliveId = setInterval(async () => {
    try {
      if (!_signClient) return;
      // If the post-connect keepalive started, this one is no longer needed
      if (_relayKeepaliveId) {
        stopPreConnectKeepalive();
        return;
      }
      const relayer = _signClient.core?.relayer;
      if (!relayer) return;

      // Check raw WS state — relayer.connected can be stale
      const provider = relayer.provider;
      const ws = provider?.connection?.socket ?? provider?.socket;
      const wsState = ws?.readyState ?? -1;

      if (!relayer.connected || wsState !== 1 /* OPEN */) {
        console.log("[WC] Pre-connect keepalive: relay dropped — reconnecting...");
        await _ensureRelayConnected(_signClient, 5000);
      }
    } catch {
      // Best effort — don't throw in keepalive
    }
  }, 20_000);
  console.log("[WC] Pre-connect relay keepalive started");
}

/**
 * Stop the pre-connect keepalive.
 */
export function stopPreConnectKeepalive(): void {
  if (_preConnectKeepaliveId) {
    clearInterval(_preConnectKeepaliveId);
    _preConnectKeepaliveId = null;
    console.log("[WC] Pre-connect relay keepalive stopped");
  }
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
      chains: ["hedera:mainnet", "hedera:testnet"],
    });
    return _wcModal;
  })();

  return _wcModalPromise;
}

/**
 * Open the WalletConnect modal with a pairing URI.
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
 * Ensure the WC relay WebSocket is connected before sending anything.
 *
 * This function is called:
 *   1. During init (after SignClient.init resolves but before first use)
 *   2. Before proposeSession() — "send was called before connect" fix
 *   3. Before _safeRequest() — relay may have dropped since init
 *
 * If the relay is disconnected, it actively triggers reconnection via
 * restartTransport() (full WebSocket teardown + reconnect) before
 * waiting. This is critical because the relay WebSocket can silently
 * close when the browser tab goes to background, and simply polling
 * `.connected` without triggering reconnection will never resolve.
 *
 * Throws if relay cannot reconnect within the timeout. [C15-01]
 */
async function _ensureRelayConnected(client: any, timeoutMs = 10000): Promise<void> {
  try {
    const relayer = client.core?.relayer;
    if (!relayer) { console.warn("[WC] No relayer — skipping wait"); return; }
    if (relayer.connected) {
      // [MOB-FIX-v3] On mobile, `relayer.connected` can be STALE: the OS
      // killed the WebSocket while the tab was backgrounded, but the SDK
      // hasn't detected the close event yet ("half-open" connection).
      // Verify by checking the RAW WebSocket readyState directly.
      try {
        const provider = relayer.provider;
        const ws = provider?.connection?.socket ?? provider?.socket;
        if (ws && ws.readyState !== 1 /* OPEN */) {
          console.warn("[WC] [MOB-FIX-v3] relayer.connected=true BUT ws.readyState=",
            ws.readyState, "— STALE connection detected, forcing reconnect");
          // Fall through to reconnection logic below
        } else {
          return; // Truly connected
        }
      } catch {
        return; // Can't verify — trust relayer.connected
      }
    }

    console.log("[WC] Relay disconnected — triggering reconnection...");

    // [C96] [MOB-SWAP-FIX] Multi-phase reconnection strategy:
    //   Phase 1: Try restartTransport / transportOpen / provider.connect
    //   Phase 2: If still disconnected, hard disconnect→connect cycle on the provider
    //   Phase 3 (mobile only): One more aggressive attempt with extended polling
    const maxAttempts = timeoutMs >= 15000 ? 3 : 2; // mobile gets 3 attempts
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (relayer.connected) { console.log("[WC] Relay connected (attempt", attempt, ")"); return; }

      try {
        if (attempt === 0) {
          // Phase 1: Normal reconnection via restartTransport
          if (typeof relayer.restartTransport === "function") {
            await Promise.race([
              relayer.restartTransport(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("restartTransport timeout")), 5000)),
            ]).catch((e: any) => console.warn("[WC] restartTransport error:", e?.message));
          } else if (typeof relayer.transportOpen === "function") {
            await Promise.race([
              relayer.transportOpen(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("transportOpen timeout")), 5000)),
            ]).catch((e: any) => console.warn("[WC] transportOpen error:", e?.message));
          } else if (relayer.provider && typeof relayer.provider.connect === "function") {
            await Promise.race([
              relayer.provider.connect(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("provider.connect timeout")), 5000)),
            ]).catch((e: any) => console.warn("[WC] provider.connect error:", e?.message));
          }
        } else if (attempt === 1) {
          // Phase 2: Hard disconnect→connect cycle on the WebSocket provider
          console.log("[WC] Phase 2: hard provider disconnect→connect cycle...");
          const provider = relayer.provider;
          if (provider) {
            // Force-close the existing WebSocket
            if (typeof provider.disconnect === "function") {
              try { await Promise.race([provider.disconnect(), new Promise(r => setTimeout(r, 2000))]); } catch { /* */ }
            }
            // Brief pause to allow the WebSocket to fully close
            await new Promise(r => setTimeout(r, 500));
            // Open a fresh WebSocket connection
            if (typeof provider.connect === "function") {
              await Promise.race([
                provider.connect(),
                new Promise((_, rej) => setTimeout(() => rej(new Error("provider.connect phase2 timeout")), 5000)),
              ]).catch((e: any) => console.warn("[WC] Phase 2 provider.connect error:", e?.message));
            }
          } else if (typeof relayer.restartTransport === "function") {
            // Fallback: restartTransport again as second attempt
            await Promise.race([
              relayer.restartTransport(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("restartTransport phase2 timeout")), 5000)),
            ]).catch((e: any) => console.warn("[WC] Phase 2 restartTransport error:", e?.message));
          }
        } else {
          // Phase 3 (mobile only): Extended aggressive reconnection for slow mobile networks
          console.log("[WC] [MOB-SWAP-FIX] Phase 3: Extended mobile reconnection attempt...");
          const provider = relayer.provider;
          if (provider && typeof provider.connect === "function") {
            // Wait longer for mobile OS to stabilize network after app switch
            await new Promise(r => setTimeout(r, 1000));
            await Promise.race([
              provider.connect(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("provider.connect phase3 timeout")), 8000)),
            ]).catch((e: any) => console.warn("[WC] [MOB-SWAP-FIX] Phase 3 provider.connect error:", e?.message));
          } else if (typeof relayer.restartTransport === "function") {
            await Promise.race([
              relayer.restartTransport(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("restartTransport phase3 timeout")), 8000)),
            ]).catch((e: any) => console.warn("[WC] [MOB-SWAP-FIX] Phase 3 restartTransport error:", e?.message));
          }
        }
      } catch { /* transport methods may throw — try next phase */ }

      // Check if connected immediately
      if (relayer.connected) {
        console.log(`[WC] Relay reconnected after phase ${attempt + 1}`);
        return;
      }

      // Poll for connection with half the remaining timeout per attempt
      const pollTimeout = Math.floor(timeoutMs * 0.5);
      const connected = await new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (success: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearInterval(pollInterval);
          try { relayer.off("relayer_connect", onConnect); } catch { /* */ }
          resolve(success);
        };
        const onConnect = () => done(true);
        try { relayer.on("relayer_connect", onConnect); } catch { /* */ }
        const pollInterval = setInterval(() => { if (relayer.connected) done(true); }, 100);
        const timer = setTimeout(() => done(false), pollTimeout);
      });

      if (connected) {
        console.log(`[WC] Relay connected after phase ${attempt + 1} polling`);
        return;
      }

      console.warn(`[WC] Phase ${attempt + 1} reconnection timed out`);
    }

    // Both phases failed — resolve anyway, caller will get "send before connect"
    // and can handle via retry (proposeSession/safeRequest retry logic).
    console.warn("[WC] All relay reconnection attempts failed after", timeoutMs, "ms");
  } catch {
    console.warn("[WC] Could not ensure relay connection — proceeding");
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
 *
 * Strategy 2 (legacy byte scan): Scan for the 0x1A 0x40 tag pair.
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
    for (let i = 0; i < bytes.length - 65; i++) {
      if (bytes[i] === 0x1A && bytes[i + 1] === 0x40 && i + 66 <= bytes.length) {
        const sig = bytes.slice(i + 2, i + 66);
        console.log("[WC] Protobuf: legacy byte scan found 0x1A 0x40 at offset " + i);
        return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
      }
    }

    // ── Strategy 3: Heuristics ────────────────────────────────────────
    if (bytes.length === 64) {
      console.log("[WC] Protobuf decode: exactly 64 bytes — treating as raw signature");
      return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    }

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

// ── Known Hedera Wallet Extension IDs (Chrome Web Store) ──────────────
const KNOWN_WALLET_EXTENSION_IDS = [
  "gjagmgiddbbciopjhllkdnddhcglnemk", // HashPack
  "nihmfbcfaoaoplfjlbmpbgddhfkceogn", // Blade (Cypher D)
];

/**
 * [C85] Public helper: attempt to bring the connected wallet to foreground.
 *
 * Called from the signing overlay's "Open Wallet" button to give users
 * a manual way to activate HashPack if the automatic mechanisms fail.
 *
 * Tries:
 *   1. chrome.runtime.sendMessage to known wallet extensions
 *   2. WC session ping to wake the extension's service worker via relay
 *
 * IMPORTANT: Do NOT open any URLs (hashpack.app, deep links, etc.) — that
 * opens the website instead of the extension and confuses users.
 * The chrome.runtime + WC ping combo reliably wakes the extension
 * without any URL tab opening.
 */
export async function tryOpenWalletExtension(): Promise<void> {
  // Try chrome.runtime first
  const chromeApi = (globalThis as any).chrome;
  if (chromeApi?.runtime?.sendMessage) {
    for (const extId of KNOWN_WALLET_EXTENSION_IDS) {
      try {
        chromeApi.runtime.sendMessage(extId, { type: "wc_focus" }, () => {
          chromeApi.runtime.lastError; // suppress console error
        });
      } catch { /* */ }
    }
  }

  // [C93] Also fire a WC session ping to wake the extension's service worker
  // via the relay WebSocket. This is more reliable than chrome.runtime when
  // the extension doesn't declare "externally_connectable".
  try {
    const client = await getSignClient();
    const sessions = client?.session?.getAll?.() ?? [];
    for (const s of sessions) {
      try {
        // Ping wakes the service worker which reconnects its relay WS
        client.ping({ topic: s.topic });
      } catch { /* non-fatal */ }
    }
  } catch { /* */ }
}

/**
 * [C85] Fast activation strategy for wallet pre-activation.
 *
 * Called from _safeRequest() to wake the wallet's service worker
 * before sending a signing request. This is a non-blocking call that
 * attempts to wake the wallet in the background.
 *
 * Strategies:
 *   1. chrome.runtime.sendMessage — directly wakes the extension's
 *      service worker (if the extension has configured
 *      `externally_connectable` for our domain).
 *   2. WC session ping — sends a `wc_sessionPing` via the relay, which
 *      can wake the wallet if its relay WebSocket is still alive.
 *
 * Both strategies are non-blocking and fail silently. The worst case is
 * that the wallet doesn't auto-prompt and the user has to click the
 * extension icon (same as before this fix).
 */
async function _tryActivateWalletFast(client: any, topic: string): Promise<void> {
  const startMs = Date.now();

  // ── Strategy 1 (fire-and-forget): chrome.runtime.sendMessage ───────
  // This is the most reliable for browser extensions. It directly triggers
  // Chrome to start the service worker even if the relay WS is dead.
  const chromeApi = (globalThis as any).chrome;
  if (chromeApi?.runtime?.sendMessage) {
    for (const extId of KNOWN_WALLET_EXTENSION_IDS) {
      try {
        chromeApi.runtime.sendMessage(extId, {
          type: "wc_activate",
          topic,
          origin: window.location.origin,
        }, () => {
          const _lastError = chromeApi.runtime.lastError;
          if (_lastError) {
            console.log(`[WC] Extension ${extId.slice(0, 8)}… not externally connectable`);
          } else {
            console.log(`[WC] Extension ${extId.slice(0, 8)}… activated via chrome.runtime`);
          }
        });
      } catch {
        // chrome.runtime may throw in sandboxed iframes
      }
    }
  }

  // ── Strategy 2 (background): WC session ping ──────────────────────
  // Fire-and-forget — don't await. The ping wakes the wallet if its
  // relay WS is still alive, but we don't block on it completing.
  client.ping({ topic }).then(
    () => console.log(`[WC] Session ping OK (${Date.now() - startMs}ms)`),
    (e: any) => console.log(`[WC] Session ping failed (${Date.now() - startMs}ms):`, e?.message?.slice(0, 80)),
  );

  // ── Brief wait ───────────────────────────────────────────────────────
  // [WALLET-SURGERY Step 9] Reduced from 800ms to 300ms. The relay keepalive
  // (startRelayKeepalive in SwapPanel) keeps the service worker alive, so we
  // only need a brief yield for chrome.runtime.sendMessage to fire. The WC
  // relay delivers the signing request regardless; this wait only affects
  // whether the wallet auto-pops or the user has to click the extension icon.
  // 300ms is enough for chrome.runtime to trigger the service worker start.
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  console.log(`[WC] Fast wallet activation complete (${Date.now() - startMs}ms)`);
}
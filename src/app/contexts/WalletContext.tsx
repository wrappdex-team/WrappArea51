import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { log } from "../utils/logger";
import type { HederaAccountInfo, HederaNetwork } from "../utils/hedera";
import { fetchAccountInfo, fetchHbarPrice } from "../utils/hedera";
import type { MetaMaskAccountInfo } from "../utils/metamask";
import {
  connectMetaMask as connectMM,
  getConnectedAccounts,
  getBalance,
  getChainId,
  subscribeToMetaMaskEvents,
  isMetaMaskInstalled,
  isMobileBrowser,
  fetchEthPrice,
  fetchSolPrice,
  CHAIN_INFO,
  signPersonalMessage,
} from "../utils/metamask";
import type {
  HashPackSession,
  HashPackConnectionResult,
  HashPackProfile,
} from "../utils/hashpack";
import {
  isHashConnectSDKAvailable,
  connectViaHashConnect,
  connectViaMirrorNode,
  disconnectHashConnect,
  restoreSession,
  onStaleSession,
} from "../utils/hashpack";

interface Wallet {
  address: string;
  type: "hedera" | "ethereum" | "solana";
  connector: string;
}

interface WalletContextType {
  connectedWallets: Wallet[];
  connectWallet: (type: "hedera" | "ethereum" | "solana", connector: string) => void;
  disconnectWallet: (address: string) => void;
  disconnectAll: () => void;
  primaryWallet: Wallet | null;

  // Hedera wallet
  hederaAccount: HederaAccountInfo | null;
  hederaNetwork: HederaNetwork;
  hbarPrice: number;
  isConnectingHedera: boolean;
  hederaConnectionError: string | null;
  hashPackSession: HashPackSession | null;
  hashPackProfile: HashPackProfile | null;
  hashConnectSDKReady: boolean;
  connectHashPack: (
    network: HederaNetwork,
    onPairingString?: (uri: string) => void,
    onConnectionState?: (state: string) => void,
  ) => Promise<HashPackConnectionResult>;
  connectHashPackMirror: (accountId: string, network: HederaNetwork) => Promise<boolean>;
  disconnectHashPack: () => void;
  refreshHederaBalance: () => Promise<void>;
  setHederaNetwork: (network: HederaNetwork) => void;

  // MetaMask / EVM
  metaMaskAccount: MetaMaskAccountInfo | null;
  ethPrice: number;
  solPrice: number;
  isConnectingMetaMask: boolean;
  metaMaskError: string | null;
  connectMetaMask: () => Promise<boolean>;
  disconnectMetaMask: () => void;
  refreshMetaMaskBalance: () => Promise<void>;
  signEvmMessage: (message: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const DEFAULT_WALLET: WalletContextType = {
  connectedWallets: [],
  connectWallet: () => {},
  disconnectWallet: () => {},
  disconnectAll: () => {},
  primaryWallet: null,
  hederaAccount: null,
  hederaNetwork: "mainnet",
  hbarPrice: 0,
  isConnectingHedera: false,
  hederaConnectionError: null,
  hashPackSession: null,
  hashPackProfile: null,
  hashConnectSDKReady: false,
  connectHashPack: async () => ({ success: false, session: null, error: "Not in provider" }),
  connectHashPackMirror: async () => false,
  disconnectHashPack: () => {},
  refreshHederaBalance: async () => {},
  setHederaNetwork: () => {},
  metaMaskAccount: null,
  ethPrice: 3500,
  solPrice: 185,
  isConnectingMetaMask: false,
  metaMaskError: null,
  connectMetaMask: async () => false,
  disconnectMetaMask: () => {},
  refreshMetaMaskBalance: async () => {},
  signEvmMessage: async () => "",
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [connectedWallets, setConnectedWallets] = useState<Wallet[]>([]);

  // Hedera state
  const [hederaAccount, setHederaAccount] = useState<HederaAccountInfo | null>(null);
  const [hederaNetwork, setHederaNetwork] = useState<HederaNetwork>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hbarh-hedera-network");
      return (saved as HederaNetwork) || "mainnet";
    }
    return "mainnet";
  });
  const [hbarPrice, setHbarPrice] = useState(0);
  const [isConnectingHedera, setIsConnectingHedera] = useState(false);
  const [hederaConnectionError, setHederaConnectionError] = useState<string | null>(null);
  const [hashPackSession, setHashPackSession] = useState<HashPackSession | null>(null);
  const [hashPackProfile, setHashPackProfile] = useState<HashPackProfile | null>(null);
  const [hashConnectSDKReady, setHashConnectSDKReady] = useState(false);

  // MetaMask state
  const [metaMaskAccount, setMetaMaskAccount] = useState<MetaMaskAccountInfo | null>(null);
  const [ethPrice, setEthPrice] = useState(3500);
  const [solPrice, setSolPrice] = useState(185);
  const [isConnectingMetaMask, setIsConnectingMetaMask] = useState(false);
  const [metaMaskError, setMetaMaskError] = useState<string | null>(null);

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metaMaskUnsubRef = useRef<(() => void) | null>(null);
  const metaMaskAbortRef = useRef<AbortController | null>(null);

  // Save network preference
  useEffect(() => {
    localStorage.setItem("hbarh-hedera-network", hederaNetwork);
  }, [hederaNetwork]);

  // Check WC availability on mount
  useEffect(() => {
    isHashConnectSDKAvailable().then(setHashConnectSDKReady);
  }, []);

  // Restore Hedera session on mount
  useEffect(() => {
    const savedSession = restoreSession();
    if (savedSession) {
      setHashPackSession(savedSession);
      setHashPackProfile(savedSession.profile || null);
      setHederaNetwork(savedSession.network);
      loadHederaAccountFromSession(savedSession);
    }
    fetchHbarPrice().then(setHbarPrice).catch(() => { /* non-critical */ });
    const hbarPriceIv = setInterval(() => {
      fetchHbarPrice().then(setHbarPrice).catch(() => { /* non-critical */ });
    }, 300_000);
    return () => clearInterval(hbarPriceIv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // REC-004: Listen for stale WC session detection (fires ~2s after mount)
  useEffect(() => {
    const unsub = onStaleSession((accountId) => {
      log.warn("WalletContext", `Stale session for ${accountId} — clearing wallet state`);
      setHashPackSession(null);
      setHederaAccount(null);
      setHashPackProfile(null);
      setHederaConnectionError("Wallet session expired — please reconnect.");
      setConnectedWallets((prev) => prev.filter((w) => w.type !== "hedera"));
    });
    return unsub;
  }, []);

  // Restore MetaMask connection on mount
  useEffect(() => {
    const wasConnected = localStorage.getItem("hbarh-metamask-connected");
    if (wasConnected === "true" && isMetaMaskInstalled()) {
      getConnectedAccounts()
        .then(async (accounts) => {
          if (accounts.length > 0) {
            const address = accounts[0];
            const chainId = await getChainId();
            const { balanceWei, balanceEth } = await getBalance(address);
            const chain = CHAIN_INFO[chainId];
            const info: MetaMaskAccountInfo = {
              address,
              balanceWei,
              balanceEth,
              chainId,
              chainName: chain?.name || `Chain ${chainId}`,
              nativeSymbol: chain?.symbol || "ETH",
              explorerUrl: chain?.explorer || "",
            };
            setMetaMaskAccount(info);
            setConnectedWallets((prev) => {
              const filtered = prev.filter((w) => !(w.type === "ethereum" && w.connector === "MetaMask"));
              return [...filtered, { address, type: "ethereum", connector: "MetaMask" }];
            });
          }
          // If accounts is empty, MetaMask is locked or user revoked permission.
          // Keep the localStorage flag — the connection will restore when the
          // user unlocks MetaMask and we receive an accountsChanged event.
        })
        .catch((err) => {
          // MetaMask provider threw during auto-restore (extension disabled,
          // corrupted state, etc.). Clear the flag to prevent retry loops and
          // log the error for diagnostics.
          log.warn("WalletContext", `MetaMask auto-restore failed: ${err?.message || err}`);
          localStorage.removeItem("hbarh-metamask-connected");
        });
    }
    fetchEthPrice().then(setEthPrice);
    fetchSolPrice().then(setSolPrice);
  }, []);

  // MetaMask event subscriptions
  useEffect(() => {
    if (metaMaskAccount && isMetaMaskInstalled()) {
      metaMaskUnsubRef.current?.();
      const unsub = subscribeToMetaMaskEvents({
        onAccountsChanged: async (accounts) => {
          if (accounts.length === 0) {
            handleDisconnectMetaMask();
          } else {
            const address = accounts[0];
            const chainId = await getChainId();
            const { balanceWei, balanceEth } = await getBalance(address);
            const chain = CHAIN_INFO[chainId];
            setMetaMaskAccount({
              address,
              balanceWei,
              balanceEth,
              chainId,
              chainName: chain?.name || `Chain ${chainId}`,
              nativeSymbol: chain?.symbol || "ETH",
              explorerUrl: chain?.explorer || "",
            });
            setConnectedWallets((prev) =>
              prev.map((w) =>
                w.type === "ethereum" && w.connector === "MetaMask" ? { ...w, address } : w,
              ),
            );
          }
        },
        onChainChanged: async (chainId) => {
          if (metaMaskAccount) {
            const { balanceWei, balanceEth } = await getBalance(metaMaskAccount.address);
            const chain = CHAIN_INFO[chainId];
            setMetaMaskAccount((prev) =>
              prev
                ? {
                    ...prev,
                    chainId,
                    balanceWei,
                    balanceEth,
                    chainName: chain?.name || `Chain ${chainId}`,
                    nativeSymbol: chain?.symbol || "ETH",
                    explorerUrl: chain?.explorer || "",
                  }
                : prev,
            );
          }
        },
        onDisconnect: () => handleDisconnectMetaMask(),
      });
      metaMaskUnsubRef.current = unsub;
      return () => unsub();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaMaskAccount?.address]);

  // Auto-refresh MetaMask balance
  useEffect(() => {
    if (metaMaskAccount) {
      const interval = setInterval(async () => {
        const { balanceWei, balanceEth } = await getBalance(metaMaskAccount.address);
        setMetaMaskAccount((prev) => (prev ? { ...prev, balanceWei, balanceEth } : prev));
      }, 30000);
      const priceInterval = setInterval(() => {
        fetchEthPrice().then(setEthPrice);
        fetchSolPrice().then(setSolPrice);
      }, 60000);
      return () => {
        clearInterval(interval);
        clearInterval(priceInterval);
      };
    }
  }, [metaMaskAccount?.address]);

  // Auto-refresh Hedera balance
  useEffect(() => {
    if (hederaAccount) {
      refreshIntervalRef.current = setInterval(() => refreshHederaBalance(), 30000);
      const priceInterval = setInterval(() => {
        fetchHbarPrice().then(setHbarPrice).catch(() => {
          // [C21-01] Swallow price fetch errors — transient Mirror Node / API
          // failures must not produce unhandled promise rejections that could
          // destabilize React state or trigger HMR disconnect artifacts.
        });
      }, 60000);
      return () => {
        if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
        clearInterval(priceInterval);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hederaAccount?.accountId, hederaAccount?.network]);

  // ─── Helpers ────────────────────────────────────────────────

  const loadHederaAccountFromSession = useCallback(async (session: HashPackSession) => {
    try {
      const accountInfo = await fetchAccountInfo(session.accountId, session.network);
      if (accountInfo && !accountInfo.deleted) {
        setHederaAccount(accountInfo);
        setConnectedWallets((prev) => {
          const filtered = prev.filter((w) => w.type !== "hedera");
          return [{ address: session.accountId, type: "hedera", connector: "WalletConnect" }, ...filtered];
        });
      }
    } catch {
      log.debug("WalletContext", "Failed to restore Hedera account from session");
    }
  }, []);

  // ─── MetaMask ──────────────────────────────────────────────

  const connectMetaMask = useCallback(async (): Promise<boolean> => {
    // Abort any in-flight connection attempt (prevents stacked eth_requestAccounts)
    if (metaMaskAbortRef.current) {
      metaMaskAbortRef.current.abort();
      metaMaskAbortRef.current = null;
    }

    setIsConnectingMetaMask(true);
    setMetaMaskError(null);
    if (!isMetaMaskInstalled()) {
      // On mobile, there's no browser extension — the user needs to open
      // this dApp inside MetaMask Mobile's in-app browser via deep link.
      // WalletConnectModal reads this specific error to show "Open in MetaMask".
      if (isMobileBrowser()) {
        setMetaMaskError("MOBILE_NO_PROVIDER");
      } else {
        setMetaMaskError("MetaMask is not installed. Please install the MetaMask browser extension.");
      }
      setIsConnectingMetaMask(false);
      return false;
    }

    const controller = new AbortController();
    metaMaskAbortRef.current = controller;

    try {
      const info = await connectMM(controller.signal);
      // If this controller was superseded by a newer attempt, discard
      if (controller.signal.aborted) return false;
      setMetaMaskAccount(info);
      localStorage.setItem("hbarh-metamask-connected", "true");
      setConnectedWallets((prev) => {
        const filtered = prev.filter((w) => !(w.type === "ethereum" && w.connector === "MetaMask"));
        return [...filtered, { address: info.address, type: "ethereum", connector: "MetaMask" }];
      });
      fetchEthPrice().then(setEthPrice);
      fetchSolPrice().then(setSolPrice);
      setIsConnectingMetaMask(false);
      return true;
    } catch (error: any) {
      // Silently swallow cancellation errors (user clicked Back)
      if (error.message === "Connection cancelled" || controller.signal.aborted) {
        setIsConnectingMetaMask(false);
        return false;
      }
      setMetaMaskError(error.message || "Failed to connect to MetaMask.");
      setIsConnectingMetaMask(false);
      return false;
    } finally {
      if (metaMaskAbortRef.current === controller) {
        metaMaskAbortRef.current = null;
      }
    }
  }, []);

  const handleDisconnectMetaMask = useCallback(() => {
    setMetaMaskAccount(null);
    setMetaMaskError(null);
    localStorage.removeItem("hbarh-metamask-connected");
    setConnectedWallets((prev) => prev.filter((w) => !(w.type === "ethereum" && w.connector === "MetaMask")));
    metaMaskUnsubRef.current?.();
    metaMaskUnsubRef.current = null;
  }, []);

  const refreshMetaMaskBalance = useCallback(async () => {
    if (!metaMaskAccount) return;
    const { balanceWei, balanceEth } = await getBalance(metaMaskAccount.address);
    setMetaMaskAccount((prev) => (prev ? { ...prev, balanceWei, balanceEth } : prev));
  }, [metaMaskAccount]);

  const signEvmMessage = useCallback(async (message: string) => {
    if (!metaMaskAccount) return "";
    try {
      const signature = await signPersonalMessage(metaMaskAccount.address, message);
      return signature;
    } catch (error: any) {
      setMetaMaskError(error.message || "Failed to sign message.");
      return "";
    }
  }, [metaMaskAccount]);

  // ─── Hedera (WalletConnect v2) ──────────────────────────────

  const connectHashPack = useCallback(
    async (
      network: HederaNetwork,
      onPairingString?: (uri: string) => void,
      onConnectionState?: (state: string) => void,
    ): Promise<HashPackConnectionResult> => {
      setIsConnectingHedera(true);
      setHederaConnectionError(null);

      const result = await connectViaHashConnect(network, onPairingString, onConnectionState);

      if (result.success && result.session) {
        setHashPackSession(result.session);
        setHashPackProfile(result.session.profile || null);
        setHederaNetwork(network);

        const accountInfo = await fetchAccountInfo(result.session.accountId, network);
        if (accountInfo) {
          setHederaAccount(accountInfo);
          setConnectedWallets((prev) => {
            const filtered = prev.filter((w) => w.type !== "hedera");
            return [
              { address: result.session!.accountId, type: "hedera", connector: "WalletConnect" },
              ...filtered,
            ];
          });
        }
        fetchHbarPrice().then(setHbarPrice);
      } else {
        setHederaConnectionError(result.error || "Connection failed.");
      }

      setIsConnectingHedera(false);
      return result;
    },
    [],
  );

  const connectHashPackMirror = useCallback(
    async (accountId: string, network: HederaNetwork): Promise<boolean> => {
      setIsConnectingHedera(true);
      setHederaConnectionError(null);

      const result = await connectViaMirrorNode(accountId, network);
      if (result.success && result.session) {
        setHashPackSession(result.session);
        setHashPackProfile(result.session.profile || null);
        setHederaNetwork(network);
        const accountInfo = await fetchAccountInfo(result.session.accountId, network);
        if (accountInfo) {
          setHederaAccount(accountInfo);
          setConnectedWallets((prev) => {
            const filtered = prev.filter((w) => w.type !== "hedera");
            return [
              { address: result.session!.accountId, type: "hedera", connector: "Mirror Node" },
              ...filtered,
            ];
          });
          fetchHbarPrice().then(setHbarPrice);
          setIsConnectingHedera(false);
          return true;
        } else {
          setHederaConnectionError(`Account ${accountId} not found on ${network}.`);
        }
      } else {
        setHederaConnectionError(result.error || "Connection failed.");
      }

      setIsConnectingHedera(false);
      return false;
    },
    [],
  );

  const handleDisconnectHashPack = useCallback(() => {
    setHederaAccount(null);
    setHashPackSession(null);
    setHashPackProfile(null);
    setHederaConnectionError(null);
    disconnectHashConnect();
    setConnectedWallets((prev) => prev.filter((w) => w.type !== "hedera"));
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
  }, []);

  const refreshHederaBalance = useCallback(async () => {
    if (!hederaAccount) return;
    try {
      const updated = await fetchAccountInfo(hederaAccount.accountId, hederaAccount.network);
      if (updated) setHederaAccount(updated);
    } catch (err) {
      // [C16-04] Swallow refresh errors — a transient Mirror Node failure
      // must not propagate into React state and trigger a disconnect/reset.
      console.log("[WalletContext] Balance refresh failed (non-fatal):", (err as any)?.message || err);
    }
  }, [hederaAccount]);

  // ─── Wallet connections ─────────────────────────────────────
  // Real wallet connections are handled by connectHashPack, connectHashPackMirror,
  // and connectMetaMask above. This stub satisfies the interface for external
  // bridge consumers (e.g. Dynamic Labs) but performs no action.

  const connectWallet = (_type: "hedera" | "ethereum" | "solana", _connector: string) => {
    // No-op — all real connections route through dedicated connect* methods.
  };

  const disconnectWallet = (address: string) => {
    const wallet = connectedWallets.find((w) => w.address === address);
    if (wallet?.type === "hedera") {
      handleDisconnectHashPack();
      return;
    }
    if (wallet?.type === "ethereum" && wallet.connector === "MetaMask") {
      handleDisconnectMetaMask();
      return;
    }
    setConnectedWallets((prev) => prev.filter((w) => w.address !== address));
  };

  const disconnectAll = () => {
    handleDisconnectHashPack();
    handleDisconnectMetaMask();
    setConnectedWallets([]);
  };

  const primaryWallet = connectedWallets[0] || null;

  return (
    <WalletContext.Provider
      value={{
        connectedWallets,
        connectWallet,
        disconnectWallet,
        disconnectAll,
        primaryWallet,
        hederaAccount,
        hederaNetwork,
        hbarPrice,
        isConnectingHedera,
        hederaConnectionError,
        hashPackSession,
        hashPackProfile,
        hashConnectSDKReady,
        connectHashPack,
        connectHashPackMirror,
        disconnectHashPack: handleDisconnectHashPack,
        refreshHederaBalance,
        setHederaNetwork,
        metaMaskAccount,
        ethPrice,
        solPrice,
        isConnectingMetaMask,
        metaMaskError,
        connectMetaMask,
        disconnectMetaMask: handleDisconnectMetaMask,
        refreshMetaMaskBalance,
        signEvmMessage,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error(
      "useWallet() called outside <WalletProvider>. " +
      "Wrap your component tree with <WalletProvider> before using useWallet."
    );
  }
  return context;
}
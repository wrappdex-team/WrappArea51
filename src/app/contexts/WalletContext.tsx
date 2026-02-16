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
  fetchEthPrice,
  fetchSolPrice,
  CHAIN_INFO,
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
import {
  connectToSmartNode,
  disconnectSmartNode,
  validateNFT,
  type HSuiteNFTStatus,
} from "../utils/hsuite";

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

  // HSuite
  hSuiteNFTStatus: HSuiteNFTStatus | null;
  isConnectingHSuite: boolean;
  hSuiteConnectionError: string | null;
  connectHSuite: () => Promise<boolean>;
  disconnectHSuite: () => void;
  refreshHSuiteNFTStatus: () => Promise<void>;
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
  hSuiteNFTStatus: null,
  isConnectingHSuite: false,
  hSuiteConnectionError: null,
  connectHSuite: async () => false,
  disconnectHSuite: () => {},
  refreshHSuiteNFTStatus: async () => {},
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

  // HSuite state
  const [hSuiteNFTStatus, setHSuiteNFTStatus] = useState<HSuiteNFTStatus | null>(null);
  const [isConnectingHSuite, setIsConnectingHSuite] = useState(false);
  const [hSuiteConnectionError, setHSuiteConnectionError] = useState<string | null>(null);

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
    fetchHbarPrice().then(setHbarPrice);
    const hbarPriceIv = setInterval(() => {
      fetchHbarPrice().then(setHbarPrice);
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
      getConnectedAccounts().then(async (accounts) => {
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
      });
    }
    fetchEthPrice().then(setEthPrice);
    fetchSolPrice().then(setSolPrice);
  }, []);

  // Auto-connect to HSuite when HashPack session is active
  useEffect(() => {
    if (hashPackSession?.accountId) {
      connectToSmartNode(hederaNetwork)
        .then((result) => {
          if (result.success) {
            validateNFT(hashPackSession.accountId, hederaNetwork)
              .then(setHSuiteNFTStatus)
              .catch(() => {});
          }
        })
        .catch(() => {});
    }
  }, [hashPackSession?.accountId, hederaNetwork]);

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
        fetchHbarPrice().then(setHbarPrice);
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

  // ─── MetaMask ───────────────────────────────────────────────

  const connectMetaMask = useCallback(async (): Promise<boolean> => {
    // Abort any in-flight connection attempt (prevents stacked eth_requestAccounts)
    if (metaMaskAbortRef.current) {
      metaMaskAbortRef.current.abort();
      metaMaskAbortRef.current = null;
    }

    setIsConnectingMetaMask(true);
    setMetaMaskError(null);
    if (!isMetaMaskInstalled()) {
      setMetaMaskError("MetaMask is not installed. Please install the MetaMask browser extension.");
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
    const updated = await fetchAccountInfo(hederaAccount.accountId, hederaAccount.network);
    if (updated) setHederaAccount(updated);
  }, [hederaAccount]);

  // ─── HSuite ─────────────────────────────────────────────────

  const connectHSuite = useCallback(async (): Promise<boolean> => {
    setIsConnectingHSuite(true);
    setHSuiteConnectionError(null);
    try {
      const result = await connectToSmartNode(hederaNetwork);
      if (!result.success) {
        setHSuiteConnectionError(result.error || "Failed to connect to HSuite SmartNode.");
        setIsConnectingHSuite(false);
        return false;
      }
      if (hashPackSession?.accountId) {
        const nftStatus = await validateNFT(hashPackSession.accountId, hederaNetwork);
        setHSuiteNFTStatus(nftStatus);
      }
      setIsConnectingHSuite(false);
      return true;
    } catch (error: any) {
      setHSuiteConnectionError(error.message || "Failed to connect to HSuite.");
      setIsConnectingHSuite(false);
      return false;
    }
  }, [hederaNetwork, hashPackSession?.accountId]);

  const handleDisconnectHSuite = useCallback(() => {
    setHSuiteNFTStatus(null);
    setHSuiteConnectionError(null);
    disconnectSmartNode();
  }, []);

  const refreshHSuiteNFTStatus = useCallback(async () => {
    if (!hashPackSession?.accountId) return;
    try {
      const nftStatus = await validateNFT(hashPackSession.accountId, hederaNetwork);
      setHSuiteNFTStatus(nftStatus);
    } catch { /* non-critical */ }
  }, [hashPackSession?.accountId, hederaNetwork]);

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
    handleDisconnectHSuite();
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
        hSuiteNFTStatus,
        isConnectingHSuite,
        hSuiteConnectionError,
        connectHSuite,
        disconnectHSuite: handleDisconnectHSuite,
        refreshHSuiteNFTStatus,
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
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import type {
  HederaAccountInfo,
  HederaNetwork,
} from "../utils/hedera";
import {
  fetchAccountInfo,
  fetchHbarPrice,
} from "../utils/hedera";
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
  openHashConnectPairingModal,
  connectViaMirrorNode,
  disconnectHashConnect,
  restoreSession,
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
  isDemo?: boolean;
}

interface WalletContextType {
  // Existing wallet support (mock for SOL, real for ETH via MetaMask)
  connectedWallets: Wallet[];
  connectWallet: (
    type: "hedera" | "ethereum" | "solana",
    connector: string
  ) => void;
  disconnectWallet: (address: string) => void;
  disconnectAll: () => void;
  primaryWallet: Wallet | null;

  // Real Hedera wallet support (HashPack via HashConnect SDK / Mirror Node)
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
    onConnectionState?: (state: string) => void
  ) => Promise<HashPackConnectionResult>;
  connectHashPackModal: (
    network: HederaNetwork
  ) => Promise<HashPackConnectionResult>;
  connectHashPackMirror: (
    accountId: string,
    network: HederaNetwork
  ) => Promise<boolean>;
  disconnectHashPack: () => void;
  refreshHederaBalance: () => Promise<void>;
  setHederaNetwork: (network: HederaNetwork) => void;

  // Real MetaMask / EVM wallet support
  metaMaskAccount: MetaMaskAccountInfo | null;
  ethPrice: number;
  solPrice: number;
  isConnectingMetaMask: boolean;
  metaMaskError: string | null;
  connectMetaMask: () => Promise<boolean>;
  disconnectMetaMask: () => void;
  refreshMetaMaskBalance: () => Promise<void>;

  // Real HSUITE / SmartNode wallet support
  hSuiteNFTStatus: HSuiteNFTStatus | null;
  isConnectingHSuite: boolean;
  hSuiteConnectionError: string | null;
  connectHSuite: () => Promise<boolean>;
  disconnectHSuite: () => void;
  refreshHSuiteNFTStatus: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Default fallback for when useWallet is called outside WalletProvider (e.g. preview/HMR)
const DEFAULT_WALLET: WalletContextType = {
  connectedWallets: [],
  connectWallet: () => {},
  disconnectWallet: () => {},
  disconnectAll: () => {},
  primaryWallet: null,
  hederaAccount: null,
  hederaNetwork: "mainnet",
  hbarPrice: 0, // Will be populated by multi-source fetchHbarPrice() on mount
  isConnectingHedera: false,
  hederaConnectionError: null,
  hashPackSession: null,
  hashPackProfile: null,
  hashConnectSDKReady: false,
  connectHashPack: async () => ({
    success: false,
    session: null,
    error: "Not in provider",
  }),
  connectHashPackModal: async () => ({
    success: false,
    session: null,
    error: "Not in provider",
  }),
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

  // Real Hedera state
  const [hederaAccount, setHederaAccount] = useState<HederaAccountInfo | null>(
    null
  );
  const [hederaNetwork, setHederaNetwork] = useState<HederaNetwork>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hbarh-hedera-network");
      return (saved as HederaNetwork) || "mainnet";
    }
    return "mainnet";
  });
  const [hbarPrice, setHbarPrice] = useState(0); // Populated by fetchHbarPrice() — no stale default
  const [isConnectingHedera, setIsConnectingHedera] = useState(false);
  const [hederaConnectionError, setHederaConnectionError] = useState<
    string | null
  >(null);
  const [hashPackSession, setHashPackSession] =
    useState<HashPackSession | null>(null);
  const [hashPackProfile, setHashPackProfile] =
    useState<HashPackProfile | null>(null);
  const [hashConnectSDKReady, setHashConnectSDKReady] = useState(false);

  // Real MetaMask state
  const [metaMaskAccount, setMetaMaskAccount] =
    useState<MetaMaskAccountInfo | null>(null);
  const [ethPrice, setEthPrice] = useState(3500);
  const [solPrice, setSolPrice] = useState(185);
  const [isConnectingMetaMask, setIsConnectingMetaMask] = useState(false);
  const [metaMaskError, setMetaMaskError] = useState<string | null>(null);

  // Real HSUITE state
  const [hSuiteNFTStatus, setHSuiteNFTStatus] =
    useState<HSuiteNFTStatus | null>(null);
  const [isConnectingHSuite, setIsConnectingHSuite] = useState(false);
  const [hSuiteConnectionError, setHSuiteConnectionError] =
    useState<string | null>(null);

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const metaMaskUnsubRef = useRef<(() => void) | null>(null);

  // Save network preference
  useEffect(() => {
    localStorage.setItem("hbarh-hedera-network", hederaNetwork);
  }, [hederaNetwork]);

  // Check SDK availability on mount
  useEffect(() => {
    isHashConnectSDKAvailable().then(setHashConnectSDKReady);
  }, []);

  // Restore HashPack session on mount
  useEffect(() => {
    const savedSession = restoreSession();
    if (savedSession) {
      setHashPackSession(savedSession);
      setHashPackProfile(savedSession.profile || null);
      setHederaNetwork(savedSession.network);
      loadHederaAccountFromSession(savedSession);
    }
    // Fetch HBAR price on mount + every 5 minutes
    fetchHbarPrice().then(setHbarPrice);
    const hbarPriceIv = setInterval(() => {
      fetchHbarPrice().then(setHbarPrice);
    }, 300_000);
    return () => clearInterval(hbarPriceIv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore MetaMask connection on mount (if previously connected)
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

          const mmWallet: Wallet = {
            address,
            type: "ethereum",
            connector: "MetaMask",
          };
          setConnectedWallets((prev) => {
            const filtered = prev.filter(
              (w) => !(w.type === "ethereum" && w.connector === "MetaMask")
            );
            return [...filtered, mmWallet];
          });
        }
      });
    }
    fetchEthPrice().then(setEthPrice);
    fetchSolPrice().then(setSolPrice);
  }, []);

  // Auto-connect to HSuite SmartNode when a HashPack session is active
  useEffect(() => {
    if (hashPackSession?.accountId) {
      connectToSmartNode(hederaNetwork).then((result) => {
        if (result.success) {
          // Validate NFT in background (non-blocking)
          validateNFT(hashPackSession.accountId, hederaNetwork).then((nft) => {
            setHSuiteNFTStatus(nft);
          }).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [hashPackSession?.accountId, hederaNetwork]);

  // Subscribe to MetaMask events when connected
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
                w.type === "ethereum" && w.connector === "MetaMask"
                  ? { ...w, address }
                  : w
              )
            );
          }
        },
        onChainChanged: async (chainId) => {
          if (metaMaskAccount) {
            const { balanceWei, balanceEth } = await getBalance(
              metaMaskAccount.address
            );
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
                : prev
            );
          }
        },
        onDisconnect: () => {
          handleDisconnectMetaMask();
        },
      });

      metaMaskUnsubRef.current = unsub;

      return () => {
        unsub();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaMaskAccount?.address]);

  // Auto-refresh MetaMask balance every 30 seconds
  useEffect(() => {
    if (metaMaskAccount) {
      const interval = setInterval(async () => {
        const { balanceWei, balanceEth } = await getBalance(
          metaMaskAccount.address
        );
        setMetaMaskAccount((prev) =>
          prev ? { ...prev, balanceWei, balanceEth } : prev
        );
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

  // Auto-refresh Hedera balance every 30 seconds
  useEffect(() => {
    if (hederaAccount) {
      refreshIntervalRef.current = setInterval(() => {
        refreshHederaBalance();
      }, 30000);

      const priceInterval = setInterval(() => {
        fetchHbarPrice().then(setHbarPrice);
      }, 60000);

      return () => {
        if (refreshIntervalRef.current)
          clearInterval(refreshIntervalRef.current);
        clearInterval(priceInterval);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hederaAccount?.accountId, hederaAccount?.network]);

  // ─── Helper: Load Hedera account from a HashPack session ───
  const loadHederaAccountFromSession = useCallback(
    async (session: HashPackSession) => {
      try {
        const accountInfo = await fetchAccountInfo(
          session.accountId,
          session.network
        );
        if (accountInfo && !accountInfo.deleted) {
          setHederaAccount(accountInfo);

          const hederaWallet: Wallet = {
            address: session.accountId,
            type: "hedera",
            connector: "HashPack",
          };
          setConnectedWallets((prev) => {
            const filtered = prev.filter((w) => w.type !== "hedera");
            return [hederaWallet, ...filtered];
          });
        }
      } catch {
        console.debug("Failed to restore Hedera account from session");
      }
    },
    []
  );

  // ─── MetaMask connection ───
  const connectMetaMask = useCallback(async (): Promise<boolean> => {
    setIsConnectingMetaMask(true);
    setMetaMaskError(null);

    if (!isMetaMaskInstalled()) {
      setMetaMaskError(
        "MetaMask is not installed. Please install the MetaMask browser extension."
      );
      setIsConnectingMetaMask(false);
      return false;
    }

    try {
      const info = await connectMM();

      setMetaMaskAccount(info);
      localStorage.setItem("hbarh-metamask-connected", "true");

      const mmWallet: Wallet = {
        address: info.address,
        type: "ethereum",
        connector: "MetaMask",
      };

      setConnectedWallets((prev) => {
        const filtered = prev.filter(
          (w) => !(w.type === "ethereum" && w.connector === "MetaMask")
        );
        return [...filtered, mmWallet];
      });

      fetchEthPrice().then(setEthPrice);
      fetchSolPrice().then(setSolPrice);

      setIsConnectingMetaMask(false);
      return true;
    } catch (error: any) {
      setMetaMaskError(
        error.message || "Failed to connect to MetaMask. Please try again."
      );
      setIsConnectingMetaMask(false);
      return false;
    }
  }, []);

  const handleDisconnectMetaMask = useCallback(() => {
    setMetaMaskAccount(null);
    setMetaMaskError(null);
    localStorage.removeItem("hbarh-metamask-connected");
    setConnectedWallets((prev) =>
      prev.filter(
        (w) => !(w.type === "ethereum" && w.connector === "MetaMask")
      )
    );
    metaMaskUnsubRef.current?.();
    metaMaskUnsubRef.current = null;
  }, []);

  const refreshMetaMaskBalance = useCallback(async () => {
    if (!metaMaskAccount) return;
    const { balanceWei, balanceEth } = await getBalance(
      metaMaskAccount.address
    );
    setMetaMaskAccount((prev) =>
      prev ? { ...prev, balanceWei, balanceEth } : prev
    );
  }, [metaMaskAccount]);

  // ─── HashPack Connection (HashConnect SDK) ───
  const connectHashPack = useCallback(
    async (
      network: HederaNetwork,
      onPairingString?: (uri: string) => void,
      onConnectionState?: (state: string) => void
    ): Promise<HashPackConnectionResult> => {
      setIsConnectingHedera(true);
      setHederaConnectionError(null);

      const result = await connectViaHashConnect(
        network,
        onPairingString,
        onConnectionState
      );

      if (result.success && result.session) {
        setHashPackSession(result.session);
        setHashPackProfile(result.session.profile || null);
        setHederaNetwork(network);

        const accountInfo = await fetchAccountInfo(
          result.session.accountId,
          network
        );

        if (accountInfo) {
          setHederaAccount(accountInfo);

          const hederaWallet: Wallet = {
            address: result.session.accountId,
            type: "hedera",
            connector: "HashPack",
          };
          setConnectedWallets((prev) => {
            const filtered = prev.filter((w) => w.type !== "hedera");
            return [hederaWallet, ...filtered];
          });
        }

        fetchHbarPrice().then(setHbarPrice);
      } else {
        setHederaConnectionError(result.error || "Connection failed.");
      }

      setIsConnectingHedera(false);
      return result;
    },
    []
  );

  // ─── HashPack Connection via built-in modal ───
  const connectHashPackModal = useCallback(
    async (network: HederaNetwork): Promise<HashPackConnectionResult> => {
      setIsConnectingHedera(true);
      setHederaConnectionError(null);

      const result = await openHashConnectPairingModal(network, "dark");

      if (result.success && result.session) {
        setHashPackSession(result.session);
        setHashPackProfile(result.session.profile || null);
        setHederaNetwork(network);

        const accountInfo = await fetchAccountInfo(
          result.session.accountId,
          network
        );

        if (accountInfo) {
          setHederaAccount(accountInfo);

          const hederaWallet: Wallet = {
            address: result.session.accountId,
            type: "hedera",
            connector: "HashPack",
          };
          setConnectedWallets((prev) => {
            const filtered = prev.filter((w) => w.type !== "hedera");
            return [hederaWallet, ...filtered];
          });
        }

        fetchHbarPrice().then(setHbarPrice);
      } else {
        setHederaConnectionError(result.error || "Connection failed.");
      }

      setIsConnectingHedera(false);
      return result;
    },
    []
  );

  // ─── HashPack Mirror Node Connection (read-only fallback) ───
  const connectHashPackMirror = useCallback(
    async (accountId: string, network: HederaNetwork): Promise<boolean> => {
      setIsConnectingHedera(true);
      setHederaConnectionError(null);

      const result = await connectViaMirrorNode(accountId, network);

      if (result.success && result.session) {
        setHashPackSession(result.session);
        setHashPackProfile(result.session.profile || null);
        setHederaNetwork(network);

        const accountInfo = await fetchAccountInfo(
          result.session.accountId,
          network
        );

        if (accountInfo) {
          setHederaAccount(accountInfo);

          const hederaWallet: Wallet = {
            address: result.session.accountId,
            type: "hedera",
            connector: "HashPack",
          };
          setConnectedWallets((prev) => {
            const filtered = prev.filter((w) => w.type !== "hedera");
            return [hederaWallet, ...filtered];
          });

          fetchHbarPrice().then(setHbarPrice);
          setIsConnectingHedera(false);
          return true;
        } else {
          setHederaConnectionError(
            `Account ${accountId} not found on ${network}.`
          );
        }
      } else {
        setHederaConnectionError(result.error || "Connection failed.");
      }

      setIsConnectingHedera(false);
      return false;
    },
    []
  );

  // ─── Disconnect HashPack ───
  const handleDisconnectHashPack = useCallback(() => {
    setHederaAccount(null);
    setHashPackSession(null);
    setHashPackProfile(null);
    setHederaConnectionError(null);
    disconnectHashConnect(); // async but we don't need to await
    setConnectedWallets((prev) => prev.filter((w) => w.type !== "hedera"));
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
  }, []);

  const refreshHederaBalance = useCallback(async () => {
    if (!hederaAccount) return;
    const updated = await fetchAccountInfo(
      hederaAccount.accountId,
      hederaAccount.network
    );
    if (updated) {
      setHederaAccount(updated);
    }
  }, [hederaAccount]);

  // ─── HSUITE Connection ───
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

      // If we have a Hedera account, validate NFT access
      if (hashPackSession?.accountId) {
        const nftStatus = await validateNFT(hashPackSession.accountId, hederaNetwork);
        setHSuiteNFTStatus(nftStatus);
      }

      setIsConnectingHSuite(false);
      return true;
    } catch (error: any) {
      setHSuiteConnectionError(
        error.message || "Failed to connect to HSuite. Please try again."
      );
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
    } catch {
      // Non-critical
    }
  }, [hashPackSession?.accountId, hederaNetwork]);

  // ─── DEMO: Mock wallet connections for unsupported chains ───
  // Solana/Phantom wallets use simulated (fake) addresses.
  // Real wallet connections: Hedera (HashPack), Ethereum (MetaMask).
  const connectWallet = (
    type: "hedera" | "ethereum" | "solana",
    connector: string
  ) => {
    if (type === "hedera") return; // HashPack flow handles it
    if (type === "ethereum" && connector === "MetaMask") return; // Real MetaMask handles it

    const generateAddress = (
      walletType: "hedera" | "ethereum" | "solana"
    ): string => {
      if (walletType === "ethereum")
        return `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`;
      return `${Math.random().toString(36).slice(2, 6).toUpperCase()}...${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    };

    const newWallet: Wallet = {
      address: generateAddress(type),
      type,
      connector,
      isDemo: true,
    };

    const existing = connectedWallets.find((w) => w.type === type);
    if (existing) {
      setConnectedWallets((prev) =>
        prev.map((w) => (w.type === type ? newWallet : w))
      );
    } else {
      setConnectedWallets((prev) => [...prev, newWallet]);
    }
  };

  const disconnectWallet = (address: string) => {
    const wallet = connectedWallets.find((w) => w.address === address);
    if (wallet?.type === "hedera") {
      handleDisconnectHashPack();
      return;
    }
    if (
      wallet?.type === "ethereum" &&
      wallet.connector === "MetaMask"
    ) {
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
        connectHashPackModal,
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

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    return DEFAULT_WALLET;
  }
  return context;
}
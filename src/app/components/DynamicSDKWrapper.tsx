/**
 * DynamicSDKWrapper — Fault-Tolerant Dynamic Labs SDK Initialization
 *
 * Lazily loads DynamicContextProvider AND the wallet connectors so that
 * if either @dynamic-labs/sdk-react-core or @dynamic-labs/ethereum fails
 * to load (CSP, network, bundle errors), the rest of the app still renders.
 *
 * On failure, wallet features powered by Dynamic are unavailable, but the
 * core app (markets, charts, swap UI, DAO, etc.) remains fully functional.
 * The native HashPack/MetaMask connectors in WalletContext work independently.
 */

import { Component, type ReactNode, useState, useEffect, useRef } from "react";
import { log } from "../utils/logger";

// ── CSS injected into the Dynamic SDK's shadow DOM ─────────────────
const DYNAMIC_CSS_OVERRIDES = `
  .dynamic-modal-overlay, .modal-overlay {
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(12px) !important;
    background: rgba(0, 0, 0, 0.7) !important;
  }
  .dynamic-modal, .modal {
    max-height: 90vh !important;
    overflow-y: auto !important;
    background: rgba(13, 15, 26, 0.95) !important;
    border: 1px solid rgba(255, 255, 255, 0.06) !important;
    backdrop-filter: blur(20px) !important;
    -webkit-backdrop-filter: blur(20px) !important;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5),
                0 0 30px rgba(168,85,247,0.08) !important;
    border-radius: 16px !important;
  }
  .wallet-list-item, .dynamic-wallet-list__tile {
    background: rgba(255,255,255,0.02) !important;
    border: 1px solid rgba(255,255,255,0.06) !important;
    border-radius: 12px !important;
    transition: all 0.2s ease !important;
  }
  .wallet-list-item:hover, .dynamic-wallet-list__tile:hover {
    background: rgba(255,255,255,0.04) !important;
    border-color: rgba(168,85,247,0.3) !important;
  }
  .dynamic-button--primary, button[data-testid="btn-primary"] {
    background: linear-gradient(135deg, #ec4899, #9333ea) !important;
    border: none !important;
    color: white !important;
    border-radius: 12px !important;
  }
`;

// ── Error Boundary (class component) ───────────────────────────────

interface BoundaryProps {
  children: ReactNode;
  fallbackChildren: ReactNode;
}

interface BoundaryState {
  hasFailed: boolean;
}

class DynamicErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasFailed: false };
  }

  static getDerivedStateFromError(): BoundaryState {
    return { hasFailed: true };
  }

  componentDidCatch(error: Error): void {
    log.warn("DynamicSDK", "Dynamic Labs SDK render error — degrading gracefully", error.message);
  }

  render(): ReactNode {
    if (this.state.hasFailed) {
      return this.props.fallbackChildren;
    }
    return this.props.children;
  }
}

// ── Public Component ───────────────────────────────────────────────

interface DynamicSDKWrapperProps {
  children: ReactNode;
}

/**
 * Context flag so consumers (like DynamicWalletBridge) know whether
 * the Dynamic SDK actually loaded.
 */
export let isDynamicSDKAvailable = false;

export function DynamicSDKWrapper({ children }: DynamicSDKWrapperProps) {
  const [sdkState, setSdkState] = useState<{
    Provider: React.ComponentType<any> | null;
    connectors: any | null;
    loaded: boolean;
    failed: boolean;
  }>({ Provider: null, connectors: null, loaded: false, failed: false });

  const loadAttempted = useRef(false);

  useEffect(() => {
    if (loadAttempted.current) return;
    loadAttempted.current = true;

    Promise.all([
      import("@dynamic-labs/sdk-react-core"),
      import("../utils/dynamic-connectors"),
    ])
      .then(([sdkMod, connectorsMod]) => {
        isDynamicSDKAvailable = true;
        setSdkState({
          Provider: sdkMod.DynamicContextProvider,
          connectors: connectorsMod.SafeEvmWalletConnectors,
          loaded: true,
          failed: false,
        });
      })
      .catch((err) => {
        log.warn("DynamicSDK", "Failed to load Dynamic Labs SDK — continuing without Dynamic wallet features", err.message || err);
        setSdkState({ Provider: null, connectors: null, loaded: true, failed: true });
      });
  }, []);

  // SDK not loaded yet, or failed — render children without Dynamic
  if (!sdkState.loaded || sdkState.failed || !sdkState.Provider) {
    return <>{children}</>;
  }

  const { Provider, connectors } = sdkState;

  return (
    <DynamicErrorBoundary fallbackChildren={children}>
      <Provider
        settings={{
          environmentId: "7e0e9ad0-5717-40f4-8aa4-5a2bdc7f062e",
          walletConnectors: [connectors],
          initialAuthenticationMode: "connect-only",
          logLevel: "ERROR",
          cssOverrides: DYNAMIC_CSS_OVERRIDES,
        }}
      >
        {children}
      </Provider>
    </DynamicErrorBoundary>
  );
}

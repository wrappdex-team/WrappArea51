/**
 * CSP-Safe EVM Wallet Connectors for Dynamic Labs SDK
 *
 * Drop-in replacement for `EthereumWalletConnectors` that excludes the
 * embedded-wallet connectors (Turnkey, WaaS, Base Account Abstraction)
 * which create iframes to `app.dynamicauth.com`. Those iframes are
 * blocked by Content Security Policy in sandboxed environments (e.g.
 * Figma Make), causing `DynamicWaasWalletClient` timeout errors.
 *
 * What's INCLUDED (safe, no iframe):
 *   - Injected wallet overrides (Phantom EVM, Exodus EVM, etc.)
 *   - EIP-6963 injected wallet detection (auto-detects installed wallets)
 *   - MetaMask Connector (SDK-based MetaMask integration)
 *   - FallbackEvmConnector (generic injected wallet fallback)
 *
 * WalletConnect handling:
 *   `fetchInjectedWalletConnector` already creates WalletConnectConnector
 *   fallbacks for non-installed wallets that support WC. We do NOT also
 *   include `EvmWalletConnectConnectors` because the SDK explicitly warns:
 *     "You should not use this if you are also using fetchInjectedWalletConnector.
 *      fetchInjectedWalletConnector wallets will turn into WalletConnectConnector
 *      if the wallet is not installed and supports WalletConnect, which will
 *      result in two instances of the same wallet."
 *
 * What's EXCLUDED (iframe-dependent, CSP-blocked):
 *   - TurnkeyEVMWalletConnectors  (@dynamic-labs/embedded-wallet-evm)
 *   - DynamicWaasEVMConnectors     (@dynamic-labs/waas-evm)
 *   - createBaseAccountConnector   (@dynamic-labs-connectors/base-account-evm)
 *
 * Also excluded (not publicly exported from @dynamic-labs/ethereum barrel):
 *   - Coinbase connector class     (Coinbase Wallet SDK — minor loss)
 *
 * Usage in App.tsx:
 *   import { SafeEvmWalletConnectors } from "./utils/dynamic-connectors";
 *   walletConnectors: [SafeEvmWalletConnectors]
 */

import {
  injectedWalletOverrides,
  fetchInjectedWalletConnector,
  MetaMaskConnector,
  FallbackEvmConnector,
} from "@dynamic-labs/ethereum";

// Wallets that have dedicated connector classes and should be excluded
// from the generic injected-wallet detection to avoid duplicates.
// Mirrors the list in the original EthereumWalletConnectors factory.
const WALLETS_WITH_CUSTOM_CONNECTORS = [
  "phantomevm",
  "coinbase",
  "exodusevm",
  "abstract",
  "edenonline",
  "intersend",
];

/**
 * CSP-safe wallet connector factory.
 *
 * Same signature as `EthereumWalletConnectors` so it's a direct
 * replacement in `DynamicContextProvider.settings.walletConnectors`.
 *
 * The SDK calls this factory with internal props (walletBook, evmNetworks,
 * etc.) and expects an array of `WalletConnectorConstructor` back.
 */
export const SafeEvmWalletConnectors = (props: any) => {
  const { useMetamaskSdk } = props || {};

  // Build the custom-connector exclusion list.
  // If MetaMask SDK mode is enabled, MetaMask is handled by
  // `MetaMaskConnector` and should be excluded from injected detection.
  const walletsWithCustomConnectors = [...WALLETS_WITH_CUSTOM_CONNECTORS];
  if (useMetamaskSdk) {
    walletsWithCustomConnectors.push("metamask");
  }

  return [
    // 1. Hardcoded override connectors (Phantom EVM, Exodus EVM, etc.)
    ...injectedWalletOverrides,

    // 2. Dynamically detected injected wallets (EIP-6963 + window.ethereum)
    //    Wallets in `walletsWithCustomConnectors` are skipped here to avoid
    //    duplicates with their dedicated connector classes.
    //    For non-installed wallets that support WalletConnect, this function
    //    automatically creates WalletConnectConnector fallback entries —
    //    so we do NOT need EvmWalletConnectConnectors separately.
    ...fetchInjectedWalletConnector({
      ...props,
      walletsWithCustomConnectors,
    }),

    // 3. MetaMask SDK connector (if MetaMask SDK mode is requested)
    ...(useMetamaskSdk ? [MetaMaskConnector] : []),

    // 4. Generic fallback for any injected wallet not matched above
    FallbackEvmConnector,

    // EXCLUDED: EvmWalletConnectConnectors (duplicates fetchInjectedWalletConnector WC fallbacks)
    // EXCLUDED: TurnkeyEVMWalletConnectors (iframe → app.dynamicauth.com)
    // EXCLUDED: DynamicWaasEVMConnectors   (iframe → app.dynamicauth.com)
    // EXCLUDED: createBaseAccountConnector (depends on embedded wallet infra)
    // EXCLUDED: Coinbase (not in public barrel — can restore via deep import if needed)
  ];
};
import { useState, useEffect, useMemo } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ExternalLink,
  Filter,
  Wallet as WalletIcon,
  Clock,
  Globe,
  Shield,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useWallet } from "../contexts/WalletContext";
import { fetchRecentTransactions } from "../utils/hedera";
import type { HederaTransaction } from "../utils/hedera";
// metamask utils not needed here since mock txn generation uses address directly

// ─── Unified transaction type ───
interface UnifiedTransaction {
  id: string;
  type: "buy" | "sell" | "deposit" | "withdraw" | "transfer" | "contract";
  network: "hedera" | "ethereum" | "solana";
  pair: string;
  amount: number;
  price: number | null;
  total: number | null;
  fee: number;
  status: "completed" | "pending" | "failed";
  time: string;
  timestamp: number; // for sorting
  explorerUrl: string;
  walletLabel: string;
}

// Generate deterministic mock EVM transactions from MetaMask address
function generateMockEvmTxns(address: string, chainId: number, ethPrice: number): UnifiedTransaction[] {
  const seed = parseInt(address.slice(2, 10), 16);
  const now = Date.now();
  const pairs = ["ETH/USDC", "ETH/USDT", "WBTC/ETH", "UNI/ETH", "LINK/ETH", "AAVE/ETH"];
  const types: ("buy" | "sell" | "deposit" | "withdraw")[] = ["buy", "sell", "deposit", "withdraw"];
  const explorer = chainId === 1 ? "https://etherscan.io" : "https://etherscan.io";
  const txns: UnifiedTransaction[] = [];

  for (let i = 0; i < 10; i++) {
    const txSeed = (seed + i * 7919) % 1000000;
    const type = types[txSeed % types.length];
    const pairIdx = (txSeed + i) % pairs.length;
    const pair = type === "deposit" || type === "withdraw" ? "ETH" : pairs[pairIdx];
    const amount = type === "deposit" || type === "withdraw"
      ? parseFloat(((txSeed % 5000) / 1000 + 0.01).toFixed(4))
      : parseFloat(((txSeed % 3000) / 1000 + 0.001).toFixed(4));
    const price = pair.includes("/") ? ethPrice : null;
    const total = price ? parseFloat((amount * price).toFixed(2)) : null;
    const fee = parseFloat(((txSeed % 100) / 1000 + 0.001).toFixed(4));
    const timeOffset = i * 3600000 + (txSeed % 3600000);
    const ts = now - timeOffset;
    const txHash = `0x${(txSeed * 12345 + i).toString(16).padStart(64, "0").slice(0, 64)}`;

    txns.push({
      id: txHash,
      type,
      network: "ethereum",
      pair,
      amount,
      price,
      total,
      fee,
      status: "completed",
      time: new Date(ts).toLocaleString(),
      timestamp: ts,
      explorerUrl: `${explorer}/tx/${txHash}`,
      walletLabel: "MetaMask",
    });
  }

  return txns;
}

// Generate deterministic mock SOL transactions from derived SOL address
function generateMockSolTxns(ethAddress: string, solPrice: number): UnifiedTransaction[] {
  const seed = parseInt(ethAddress.slice(10, 18), 16);
  const now = Date.now();
  const pairs = ["SOL/USDC", "SOL/USDT", "RAY/SOL", "JTO/SOL", "BONK/SOL"];
  const types: ("buy" | "sell" | "deposit" | "withdraw")[] = ["buy", "sell", "deposit", "withdraw"];
  const txns: UnifiedTransaction[] = [];

  for (let i = 0; i < 6; i++) {
    const txSeed = (seed + i * 6271) % 1000000;
    const type = types[txSeed % types.length];
    const pairIdx = (txSeed + i) % pairs.length;
    const pair = type === "deposit" || type === "withdraw" ? "SOL" : pairs[pairIdx];
    const amount = type === "deposit" || type === "withdraw"
      ? parseFloat(((txSeed % 20000) / 1000 + 0.1).toFixed(4))
      : parseFloat(((txSeed % 10000) / 1000 + 0.01).toFixed(4));
    const price = pair.includes("/") ? solPrice : null;
    const total = price ? parseFloat((amount * price).toFixed(2)) : null;
    const fee = parseFloat(((txSeed % 50) / 10000 + 0.00001).toFixed(5));
    const timeOffset = i * 5400000 + (txSeed % 5400000);
    const ts = now - timeOffset;
    const sig = `${(txSeed * 54321 + i).toString(36).padStart(44, "0").slice(0, 44)}`;

    txns.push({
      id: sig,
      type,
      network: "solana",
      pair,
      amount,
      price,
      total,
      fee,
      status: "completed",
      time: new Date(ts).toLocaleString(),
      timestamp: ts,
      explorerUrl: `https://solscan.io/tx/${sig}`,
      walletLabel: "MetaMask (SOL)",
    });
  }

  return txns;
}

// Convert Hedera mirror node transactions to unified format
function convertHederaTxns(
  txns: HederaTransaction[],
  accountId: string,
  network: string
): UnifiedTransaction[] {
  // Mirror Node can return multiple records with the same transactionId
  // (different nonces / child transactions). Deduplicate by transactionId
  // to avoid React duplicate-key warnings.
  const seen = new Set<string>();
  const unique = txns.filter((tx) => {
    if (seen.has(tx.transactionId)) return false;
    seen.add(tx.transactionId);
    return true;
  });

  return unique.map((tx) => {
    const myTransfer = tx.transfers.find((t) => t.account === accountId);
    const isIncoming = myTransfer && myTransfer.amount > 0;
    const amount = myTransfer ? Math.abs(myTransfer.amount) : 0;
    const seconds = parseFloat(tx.consensusTimestamp.split(".")[0]);
    const ts = seconds * 1000;

    let type: UnifiedTransaction["type"] = "transfer";
    if (tx.name.includes("TOKEN") || tx.name.includes("SWAP")) {
      type = isIncoming ? "buy" : "sell";
    } else if (tx.name.includes("TRANSFER")) {
      type = isIncoming ? "deposit" : "withdraw";
    } else if (tx.name.includes("CONTRACT")) {
      type = "contract";
    } else {
      type = isIncoming ? "deposit" : "withdraw";
    }

    return {
      id: tx.transactionId,
      type,
      network: "hedera" as const,
      pair: "HBAR",
      amount,
      price: null,
      total: null,
      fee: 0.0001,
      status: tx.result === "SUCCESS" ? "completed" as const : "failed" as const,
      time: new Date(ts).toLocaleString(),
      timestamp: ts,
      explorerUrl: `https://hashscan.io/${network}/transaction/${tx.transactionId}`,
      walletLabel: "HashPack",
    };
  });
}

export function History() {
  const [filter, setFilter] = useState<"all" | "trades" | "deposits" | "withdrawals" | "hedera" | "ethereum" | "solana">("all");
  const [showAll, setShowAll] = useState(false);
  const { isDark } = useTheme();
  const {
    hederaAccount,
    metaMaskAccount,
    ethPrice,
    solPrice,
    connectedWallets,
  } = useWallet();

  const [hederaTxns, setHederaTxns] = useState<HederaTransaction[]>([]);
  const [loadingHedera, setLoadingHedera] = useState(false);

  const hasAnyWallet = !!hederaAccount || !!metaMaskAccount || connectedWallets.length > 0;

  // Fetch real Hedera transactions
  useEffect(() => {
    if (hederaAccount) {
      setLoadingHedera(true);
      fetchRecentTransactions(hederaAccount.accountId, hederaAccount.network)
        .then(setHederaTxns)
        .finally(() => setLoadingHedera(false));
    } else {
      setHederaTxns([]);
    }
  }, [hederaAccount?.accountId, hederaAccount?.network]);

  // Build unified transaction list from all connected wallets
  const allTransactions = useMemo(() => {
    const txns: UnifiedTransaction[] = [];

    // Hedera real transactions
    if (hederaAccount && hederaTxns.length > 0) {
      txns.push(
        ...convertHederaTxns(hederaTxns, hederaAccount.accountId, hederaAccount.network)
      );
    }

    // MetaMask EVM transactions (simulated)
    if (metaMaskAccount) {
      txns.push(...generateMockEvmTxns(metaMaskAccount.address, metaMaskAccount.chainId, ethPrice));
      // Also generate Solana transactions (linked via MetaMask)
      txns.push(...generateMockSolTxns(metaMaskAccount.address, solPrice));
    }

    // Sort by timestamp descending (most recent first)
    txns.sort((a, b) => b.timestamp - a.timestamp);

    return txns;
  }, [hederaAccount, hederaTxns, metaMaskAccount, ethPrice, solPrice]);

  // Apply filters
  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((tx) => {
      if (filter === "all") return true;
      if (filter === "trades") return tx.type === "buy" || tx.type === "sell";
      if (filter === "deposits") return tx.type === "deposit";
      if (filter === "withdrawals") return tx.type === "withdraw";
      if (filter === "hedera") return tx.network === "hedera";
      if (filter === "ethereum") return tx.network === "ethereum";
      if (filter === "solana") return tx.network === "solana";
      return true;
    });
  }, [allTransactions, filter]);

  const displayedTxns = showAll ? filteredTransactions : filteredTransactions.slice(0, 15);

  const getTypeIcon = (type: string) => {
    if (type === "buy" || type === "deposit") {
      return <ArrowDownLeft className="w-4 h-4 text-pink-400" />;
    }
    return <ArrowUpRight className="w-4 h-4 text-red-400" />;
  };

  const getTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      buy: isDark ? "bg-pink-900/30 text-pink-400 border-pink-700/50" : "bg-pink-100 text-pink-600 border-pink-200",
      sell: isDark ? "bg-red-900/30 text-red-400 border-red-700/50" : "bg-red-100 text-red-600 border-red-200",
      deposit: isDark ? "bg-purple-900/30 text-purple-400 border-purple-700/50" : "bg-purple-100 text-purple-600 border-purple-200",
      withdraw: isDark ? "bg-orange-900/30 text-orange-400 border-orange-700/50" : "bg-orange-100 text-orange-600 border-orange-200",
      transfer: isDark ? "bg-blue-900/30 text-blue-400 border-blue-700/50" : "bg-blue-100 text-blue-600 border-blue-200",
      contract: isDark ? "bg-cyan-900/30 text-cyan-400 border-cyan-700/50" : "bg-cyan-100 text-cyan-600 border-cyan-200",
    };

    return (
      <span className={`px-2 py-1 rounded text-xs border ${colors[type] || colors.transfer}`}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </span>
    );
  };

  const getNetworkBadge = (network: string) => {
    const styles: Record<string, string> = {
      hedera: isDark ? "bg-indigo-500/15 text-indigo-400" : "bg-indigo-100 text-indigo-600",
      ethereum: isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-600",
      solana: isDark ? "bg-purple-500/15 text-purple-400" : "bg-purple-100 text-purple-600",
    };
    const labels: Record<string, string> = {
      hedera: "Hedera",
      ethereum: "ETH",
      solana: "SOL",
    };
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${styles[network] || ""}`}>
        {labels[network] || network}
      </span>
    );
  };

  // Summary stats
  const stats = useMemo(() => {
    const trades = allTransactions.filter((tx) => tx.type === "buy" || tx.type === "sell");
    const totalVolume = allTransactions
      .filter((tx) => tx.total !== null)
      .reduce((sum, tx) => sum + (tx.total || 0), 0);
    const totalFees = allTransactions.reduce((sum, tx) => sum + tx.fee, 0);
    const networkBreakdown = {
      hedera: allTransactions.filter((tx) => tx.network === "hedera").length,
      ethereum: allTransactions.filter((tx) => tx.network === "ethereum").length,
      solana: allTransactions.filter((tx) => tx.network === "solana").length,
    };
    return { trades: trades.length, totalVolume, totalFees, networkBreakdown };
  }, [allTransactions]);

  // ─── No wallet connected ───
  if (!hasAnyWallet) {
    return (
      <div className="space-y-6">
        <div
          className={`text-center py-16 rounded-xl ${
            isDark
              ? "bg-gradient-to-br from-purple-900/10 to-pink-900/10 border border-pink-500/20"
              : "bg-gradient-to-br from-purple-50 to-pink-50 border border-pink-200"
          }`}
        >
          <div className="w-20 h-20 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <WalletIcon className={`w-10 h-10 ${isDark ? "text-purple-400" : "text-purple-500"}`} />
          </div>
          <h3 className="text-xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent mb-2">
            Connect a Wallet to View History
          </h3>
          <p className={`text-sm max-w-lg mx-auto mb-6 px-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Your transaction history will appear here once you connect a Hedera, Ethereum, or Solana wallet.
            All transactions are pulled directly from connected wallets.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs px-4">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Shield className="w-3.5 h-3.5" /> Wallet-sourced data
            </span>
            <span className={isDark ? "text-slate-700" : "text-gray-300"}>|</span>
            <span className="flex items-center gap-1.5 text-purple-400">
              <Globe className="w-3.5 h-3.5" /> Multi-chain
            </span>
            <span className={isDark ? "text-slate-700" : "text-gray-300"}>|</span>
            <span className="flex items-center gap-1.5 text-pink-400">
              <Clock className="w-3.5 h-3.5" /> Real-time
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Connected ───
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
            Transaction History
          </h2>
          <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {allTransactions.length} transactions from {
              [
                hederaAccount ? "Hedera" : null,
                metaMaskAccount ? "Ethereum" : null,
                metaMaskAccount ? "Solana" : null,
              ].filter(Boolean).join(", ")
            }
          </p>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {([
          { key: "all" as const, label: "All", icon: true },
          { key: "trades" as const, label: "Trades", icon: false },
          { key: "deposits" as const, label: "Deposits", icon: false },
          { key: "withdrawals" as const, label: "Withdrawals", icon: false },
          ...(hederaAccount ? [{ key: "hedera" as const, label: "Hedera", icon: false }] : []),
          ...(metaMaskAccount ? [{ key: "ethereum" as const, label: "Ethereum", icon: false }] : []),
          ...(metaMaskAccount ? [{ key: "solana" as const, label: "Solana", icon: false }] : []),
        ]).map((btn) => (
          <button
            key={btn.key}
            onClick={() => setFilter(btn.key)}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all duration-300 whitespace-nowrap ${
              filter === btn.key
                ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/30"
                : isDark
                  ? "bg-slate-800/50 text-slate-400 hover:text-white border border-pink-500/20"
                  : "bg-white text-gray-500 hover:text-gray-700 border border-gray-200"
            }`}
          >
            {btn.icon && <Filter className="w-4 h-4" />}
            {btn.label}
          </button>
        ))}
      </div>

      {/* Loading state for Hedera */}
      {loadingHedera && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
          <span className={`ml-2 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Fetching Hedera transactions...
          </span>
        </div>
      )}

      {/* Transactions Table */}
      <div className={`rounded-xl overflow-hidden backdrop-blur-sm ${
        isDark
          ? "bg-slate-900/30 border border-pink-500/20"
          : "bg-white border border-gray-200 shadow-sm"
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className={isDark ? "bg-slate-800/50 border-b border-pink-500/20" : "bg-gray-50 border-b border-gray-200"}>
              <tr>
                <th className={`text-left p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Type</th>
                <th className={`text-left p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Network</th>
                <th className={`text-left p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Pair/Asset</th>
                <th className={`text-right p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Amount</th>
                <th className={`text-right p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Price</th>
                <th className={`text-right p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total</th>
                <th className={`text-right p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Fee</th>
                <th className={`text-left p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Status</th>
                <th className={`text-left p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Time</th>
                <th className={`text-center p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Details</th>
              </tr>
            </thead>
            <tbody>
              {displayedTxns.map((tx) => (
                <tr
                  key={`${tx.network}-${tx.id}`}
                  className={`transition-colors ${
                    isDark
                      ? "border-b border-slate-800/50 hover:bg-slate-800/30"
                      : "border-b border-gray-100 hover:bg-gray-50"
                  }`}
                >
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(tx.type)}
                      {getTypeBadge(tx.type)}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1.5">
                      {getNetworkBadge(tx.network)}
                      {tx.network !== "hedera" && (
                        <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                          isDark ? "bg-yellow-500/10 text-yellow-500/70 border border-yellow-500/20" : "bg-yellow-50 text-yellow-600 border border-yellow-200"
                        }`} title="Simulated demo data — live indexing coming soon">
                          DEMO
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 font-mono">{tx.pair}</td>
                  <td className="p-4 text-right font-mono">
                    {tx.amount >= 1 ? tx.amount.toLocaleString(undefined, { maximumFractionDigits: 4 }) : tx.amount.toFixed(6)}
                  </td>
                  <td className="p-4 text-right font-mono">
                    {tx.price ? `$${tx.price >= 1 ? tx.price.toLocaleString() : tx.price.toFixed(4)}` : "-"}
                  </td>
                  <td className="p-4 text-right font-mono">
                    {tx.total ? `$${tx.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "-"}
                  </td>
                  <td className={`p-4 text-right font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {tx.fee >= 0.01 ? `$${tx.fee.toFixed(2)}` : tx.fee >= 0.0001 ? `$${tx.fee.toFixed(4)}` : `$${tx.fee.toFixed(6)}`}
                  </td>
                  <td className="p-4">
                    <span className="inline-flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${
                        tx.status === "completed" ? "bg-pink-500 animate-pulse" : tx.status === "failed" ? "bg-red-500" : "bg-yellow-500 animate-pulse"
                      }`}></div>
                      <span className={`capitalize ${
                        tx.status === "completed" ? "text-pink-400" : tx.status === "failed" ? "text-red-400" : "text-yellow-400"
                      }`}>
                        {tx.status}
                      </span>
                    </span>
                  </td>
                  <td className={`p-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>{tx.time}</td>
                  <td className="p-4 text-center">
                    <a
                      href={tx.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center justify-center p-2 rounded transition-colors ${
                        isDark ? "hover:bg-slate-700" : "hover:bg-gray-200"
                      }`}
                      title="View on Explorer"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredTransactions.length === 0 && !loadingHedera && (
          <div className={`p-12 text-center ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            <p>No transactions found for this filter</p>
          </div>
        )}

        {filteredTransactions.length > 15 && (
          <div className="p-3 text-center">
            <button
              onClick={() => setShowAll(!showAll)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-colors ${
                isDark
                  ? "text-pink-400 hover:bg-slate-800/50"
                  : "text-pink-600 hover:bg-gray-50"
              }`}
            >
              {showAll ? (
                <>Show less <ChevronUp className="w-3.5 h-3.5" /></>
              ) : (
                <>Show all {filteredTransactions.length} transactions <ChevronDown className="w-3.5 h-3.5" /></>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className={`rounded-xl p-5 backdrop-blur-sm ${
          isDark
            ? "bg-gradient-to-br from-pink-900/20 to-purple-900/20 border border-pink-500/20"
            : "bg-gradient-to-br from-pink-50 to-purple-50 border border-pink-200"
        }`}>
          <div className={`text-sm mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total Trades</div>
          <div className="text-2xl font-bold">{stats.trades}</div>
        </div>
        <div className={`rounded-xl p-5 backdrop-blur-sm ${
          isDark
            ? "bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/20"
            : "bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200"
        }`}>
          <div className={`text-sm mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total Volume</div>
          <div className="text-2xl font-bold">
            ${stats.totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className={`rounded-xl p-5 backdrop-blur-sm ${
          isDark
            ? "bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/20"
            : "bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200"
        }`}>
          <div className={`text-sm mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total Fees</div>
          <div className="text-2xl font-bold">
            ${stats.totalFees.toFixed(4)}
          </div>
        </div>
        <div className={`rounded-xl p-5 backdrop-blur-sm ${
          isDark
            ? "bg-gradient-to-br from-cyan-900/20 to-teal-900/20 border border-cyan-500/20"
            : "bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-200"
        }`}>
          <div className={`text-sm mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Networks</div>
          <div className="flex items-center gap-2 mt-1">
            {stats.networkBreakdown.hedera > 0 && (
              <span className={`text-xs px-2 py-1 rounded font-bold ${
                isDark ? "bg-indigo-500/15 text-indigo-400" : "bg-indigo-100 text-indigo-600"
              }`}>
                HBAR {stats.networkBreakdown.hedera}
              </span>
            )}
            {stats.networkBreakdown.ethereum > 0 && (
              <span className={`text-xs px-2 py-1 rounded font-bold ${
                isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-600"
              }`}>
                ETH {stats.networkBreakdown.ethereum}
              </span>
            )}
            {stats.networkBreakdown.solana > 0 && (
              <span className={`text-xs px-2 py-1 rounded font-bold ${
                isDark ? "bg-purple-500/15 text-purple-400" : "bg-purple-100 text-purple-600"
              }`}>
                SOL {stats.networkBreakdown.solana}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Data source info */}
      <div className={`rounded-xl p-4 flex items-start gap-3 ${
        isDark
          ? "bg-slate-900/20 border border-pink-500/10"
          : "bg-gray-50 border border-gray-100"
      }`}>
        <Shield className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
        <p className={`text-xs leading-relaxed ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          {hederaAccount && "Hedera transactions are fetched live from the Mirror Node. "}
          {metaMaskAccount && "Ethereum and Solana transactions are simulated based on your connected wallet address — live blockchain indexing coming soon. "}
          Connect additional wallets to see their transaction history here.
        </p>
      </div>
    </div>
  );
}
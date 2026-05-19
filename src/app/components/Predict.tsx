// ========================================================
// GROK AGENT NOTE – FINAL STABLE VERSION (All Functions Restored)
// ========================================================

import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Zap, X, RefreshCw, TrendingUp } from 'lucide-react';
import { useSigning } from '../contexts/SigningContext';
import { useWallet } from '../contexts/WalletContext'; // for metaMaskAccount / primary
import {
  fetchActiveMarkets,
  createMarketOnChain,
  placeBetOnChain,
  ensureHederaEVMNetwork,
  type OnChainMarket,
} from '../utils/predictionMarkets';

interface Asset {
  symbol: string;
  name: string;
  price: number | null;
  change24h: number;
  logo: string;
}

interface MockMarket {
  id: number;
  asset: string;
  question: string;
  yesOdds: number;
  noOdds: number;
  volume: string;
  endsIn: string;
  totalBets: number;
  // Internal: real on-chain address (never rendered, only for tx calls)
  address?: string;
  endTime?: number;
  resolved?: boolean;
}

export function Predict() {
  const { isDark } = useTheme();
  const { withSigning, isSigning } = useSigning();
  const { metaMaskAccount } = useWallet();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBetModal, setShowBetModal] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<MockMarket | null>(null);
  const [betSide, setBetSide] = useState<'YES' | 'NO'>('YES');
  const [betAmount, setBetAmount] = useState(100);
  const [selectedAsset, setSelectedAsset] = useState('BTC');
  const [currentPrice, setCurrentPrice] = useState(0);
  const [side, setSide] = useState<'YES' | 'NO'>('YES');
  const [expiryDays, setExpiryDays] = useState(7);
  const [priceRange, setPriceRange] = useState(15);
  const [poolSize, setPoolSize] = useState(500);
  const [aiOdds, setAiOdds] = useState({ probability: 62, confidence: 87 });
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Real on-chain markets replace the previous hardcoded mock list (UI render unchanged)
  const [activeMarkets, setActiveMarkets] = useState<MockMarket[]>([]);

  const fetchLivePrices = async () => {
    setIsLoadingPrices(true);
    setErrorMessage('');

    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,hedera-hashgraph,solana,avalanche-2,chainlink,cardano,ripple,polkadot,matic-network&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h'
      );

      if (!response.ok) throw new Error(`CoinGecko error: ${response.status}`);

      const data = await response.json();

      const liveAssets: Asset[] = data
        .map((coin: any) => ({
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          price: coin.current_price ?? null,
          change24h: coin.price_change_percentage_24h || 0,
          logo: coin.image,
        }))
        .filter((asset: Asset) => asset.price !== null);

      setAssets(liveAssets);

      const selected = liveAssets.find(a => a.symbol === selectedAsset);
      if (selected && selected.price !== null) setCurrentPrice(selected.price);

    } catch (error: any) {
      console.error('Price fetch error:', error);
      setErrorMessage('Unable to load live prices. Please try again.');
      setAssets([]);
    } finally {
      setIsLoadingPrices(false);
    }
  };

  // Real on-chain market loader (replaces hardcoded data source, UI identical)
  const loadOnChainMarkets = async () => {
    try {
      const onChain = await fetchActiveMarkets();
      const mapped: MockMarket[] = onChain.map((m, idx) => ({
        id: idx + 1,
        asset: m.asset,
        question: m.question,
        yesOdds: m.yesOdds,
        noOdds: m.noOdds,
        volume: m.volume,
        endsIn: m.endsIn,
        totalBets: m.totalBets,
        address: m.address,
        endTime: m.endTime,
        resolved: m.resolved,
      }));
      if (mapped.length > 0) {
        setActiveMarkets(mapped);
      }
      // If none deployed yet, leave empty (or could keep previous demo but per spec we use real source)
    } catch (e) {
      // Silent — existing errorMessage / alert paths handle UX
      console.warn('[Predict] On-chain markets load skipped:', e);
    }
  };

  useEffect(() => {
    fetchLivePrices();
    loadOnChainMarkets(); // initial real market data
    const interval = setInterval(fetchLivePrices, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const selected = assets.find(a => a.symbol === selectedAsset);
    if (selected && selected.price !== null) setCurrentPrice(selected.price);
  }, [selectedAsset, assets]);

  const generateAIOdds = () => {
    setIsLoadingAI(true);
    setTimeout(() => {
      const baseProb = side === 'YES' ? 58 : 42;
      const volatilityFactor = expiryDays > 14 ? 12 : 8;
      const rangeFactor = priceRange * 0.6;
      const probability = Math.round(Math.max(35, Math.min(78, baseProb + rangeFactor - volatilityFactor)));
      const confidence = Math.round(Math.max(72, Math.min(94, 82 + (expiryDays > 7 ? -4 : 6))));

      setAiOdds({ probability, confidence });
      setIsLoadingAI(false);
    }, 650);
  };

  useEffect(() => {
    if (assets.length > 0) generateAIOdds();
  }, [selectedAsset, side, expiryDays, priceRange]);

  const getMaxRange = () => Math.min(8 + (expiryDays - 1) * 1.6, 100);
  const maxRange = getMaxRange();

  const openBetModal = (market: MockMarket) => {
    setSelectedMarket(market);
    setBetSide('YES');
    setBetAmount(100);
    setShowBetModal(true);
  };

  // Real on-chain implementations (exact same call sites & alert UX as original mock)
  const placeBet = async () => {
    if (!selectedMarket) return;

    if (!metaMaskAccount?.address) {
      setErrorMessage('Connect MetaMask to Hedera EVM (chain 296) to place bets.');
      alert('Connect MetaMask to Hedera Testnet EVM to place real bets.');
      return;
    }

    const marketAddr = selectedMarket.address;
    if (!marketAddr) {
      alert(`✅ Bet Placed (Demo Mode — contracts not deployed on this network yet)\n\nMarket: ${selectedMarket.question}\nSide: ${betSide}\nAmount: ${betAmount} HBAR`);
      setShowBetModal(false);
      return;
    }

    try {
      await withSigning(
        `Placing ${betAmount} HBAR bet on ${betSide}...`,
        async () => {
          await placeBetOnChain(marketAddr, betSide === 'YES', betAmount);
        }
      );

      alert(`✅ Bet Placed (On-Chain)\n\nMarket: ${selectedMarket.question}\nSide: ${betSide}\nAmount: ${betAmount} HBAR\n\nTx submitted to Hedera EVM. Refresh in a moment for updated odds.`);

      // Refresh list after settlement
      setTimeout(() => loadOnChainMarkets(), 6500);
    } catch (e: any) {
      console.error(e);
      alert(`Bet failed: ${e?.message || 'See console'}`);
    }

    setShowBetModal(false);
  };

  const createMarket = async () => {
    if (!metaMaskAccount?.address) {
      alert('Connect MetaMask to Hedera EVM to create real markets (5 HBAR fee + pool).');
      setShowCreateModal(false);
      return;
    }

    // Compute a realistic endTime from UI inputs
    const endTime = Math.floor(Date.now() / 1000) + (expiryDays * 86400);

    try {
      await withSigning(
        `Creating market • paying 5 HBAR fee + ${poolSize} HBAR pool...`,
        async () => {
          await createMarketOnChain({
            question: `${side} — Will ${selectedAsset} move ±${priceRange}% in ${expiryDays}d? (AI ${aiOdds.probability}% conf)`,
            asset: selectedAsset,
            endTime,
            initialPoolHBAR: poolSize,
          });
        }
      );

      alert(`✅ Market Created (On-Chain)\n\nAsset: ${selectedAsset}\nSide: ${side}\nExpiry: ${expiryDays} days\nRange: ±${priceRange}%\n\n5 HBAR fee paid. New market will appear in list shortly.`);

      setShowCreateModal(false);
      setTimeout(() => loadOnChainMarkets(), 8000);
    } catch (e: any) {
      console.error(e);
      alert(`Create failed: ${e?.message || 'Insufficient HBAR or wrong network (use Hedera Testnet EVM)'}`);
      setShowCreateModal(false);
    }
  };

  const formatPrice = (price: number | null) => {
    if (price === null || price === undefined) return 'N/A';
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className={`min-h-[calc(100vh-120px)] ${isDark ? 'bg-[#080a12] text-white' : 'bg-[#f8fafc] text-slate-900'} p-6`}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className={`text-sm ${isDark ? 'text-white/60' : 'text-slate-600'}`}>
            Live Prices • Updates every 60s
          </div>
          <button 
            onClick={fetchLivePrices} 
            className="flex items-center gap-2 text-xs text-[#00f9ff] hover:text-[#00d4ff] transition-colors"
          >
            <RefreshCw size={14} className={isLoadingPrices ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5 mb-12">
          {isLoadingPrices && assets.length === 0 ? (
            <div className="col-span-full text-center py-12 text-white/50">Loading live prices...</div>
          ) : errorMessage ? (
            <div className="col-span-full text-center py-12">
              <div className="text-red-400 mb-4">{errorMessage}</div>
              <button onClick={fetchLivePrices} className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm">Try Again</button>
            </div>
          ) : assets.length > 0 ? (
            assets.map((asset, index) => (
              <div 
                key={index}
                onClick={() => { setSelectedAsset(asset.symbol); setShowCreateModal(true); }}
                className={`group rounded-3xl p-5 border transition-all hover:-translate-y-0.5 cursor-pointer ${
                  isDark 
                    ? 'bg-white/5 border-white/10 hover:border-[#00f9ff]/40' 
                    : 'bg-white border-slate-200 hover:border-[#00f9ff]/60 shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <img src={asset.logo} alt={asset.symbol} className="w-10 h-10 rounded-full object-contain" />
                    <div>
                      <div className="font-semibold text-xl tracking-tight">{asset.name}</div>
                      <div className={`text-sm font-mono -mt-0.5 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{asset.symbol}</div>
                    </div>
                  </div>
                  <div className={`text-right text-sm font-medium ${asset.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(1)}%
                  </div>
                </div>

                <div className="text-4xl font-semibold tracking-[-1.5px] tabular-nums">
                  ${formatPrice(asset.price)}
                </div>

                <div className="mt-5 pt-4 border-t border-white/10 text-center text-sm text-[#00f9ff] group-hover:underline">
                  Create Market →
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-12 text-white/50">No assets loaded</div>
          )}
        </div>

        {/* Active Prediction Markets */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-6">
            <TrendingUp className="text-[#00f9ff]" />
            <h2 className="text-3xl font-semibold tracking-tight">Active Prediction Markets</h2>
            <div className={`text-sm ml-2 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
              ({activeMarkets.length} open)
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activeMarkets.map((market) => (
              <div 
                key={market.id}
                className={`group rounded-3xl p-6 border transition-all hover:-translate-y-0.5 ${
                  isDark 
                    ? 'bg-white/5 border-white/10 hover:border-[#00f9ff]/40' 
                    : 'bg-white border-slate-200 hover:border-[#00f9ff]/60 shadow-sm'
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className={`text-sm ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{market.asset}</div>
                    <div className="font-semibold text-xl leading-tight mt-1 pr-8">{market.question}</div>
                  </div>
                </div>

                <div className="flex justify-between items-end mb-6">
                  <div>
                    <div className={`text-xs ${isDark ? 'text-white/50' : 'text-slate-500'}`}>YES</div>
                    <div className="text-3xl font-semibold text-emerald-400">{market.yesOdds}%</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs ${isDark ? 'text-white/50' : 'text-slate-500'}`}>NO</div>
                    <div className="text-3xl font-semibold text-red-400">{market.noOdds}%</div>
                  </div>
                </div>

                <div className={`flex justify-between text-sm mb-6 ${isDark ? 'text-white/60' : 'text-slate-600'}`}>
                  <div>Volume: <span className={isDark ? 'text-white' : 'text-slate-900'}>{market.volume}</span></div>
                  <div>Ends in: <span className={isDark ? 'text-white' : 'text-slate-900'}>{market.endsIn}</span></div>
                </div>

                <button 
                  onClick={() => openBetModal(market)}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black font-semibold hover:brightness-110 active:scale-[0.985] transition-all shadow-md"
                >
                  PLACE BET
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Betting Modal */}
      {showBetModal && selectedMarket && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-[100] p-4" onClick={() => setShowBetModal(false)}>
          <div className="bg-[#0a0c17] border border-white/10 rounded-3xl w-full max-w-[480px] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-white/10 flex justify-between items-center">
              <div>
                <div className="font-semibold text-xl">Place Your Bet</div>
                <div className="text-xs text-white/50 mt-1">{selectedMarket.question}</div>
              </div>
              <button onClick={() => setShowBetModal(false)}><X size={24} /></button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-2">SELECT SIDE</label>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setBetSide('YES')}
                    className={`flex-1 py-4 rounded-2xl font-semibold text-lg transition-all ${betSide === 'YES' ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10'}`}
                  >
                    YES • {selectedMarket.yesOdds}%
                  </button>
                  <button 
                    onClick={() => setBetSide('NO')}
                    className={`flex-1 py-4 rounded-2xl font-semibold text-lg transition-all ${betSide === 'NO' ? 'bg-red-500 text-white' : 'bg-white/5 hover:bg-white/10'}`}
                  >
                    NO • {selectedMarket.noOdds}%
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-2">STAKE AMOUNT (HBAR)</label>
                <input 
                  type="number" 
                  value={betAmount} 
                  onChange={(e) => setBetAmount(Math.max(10, parseInt(e.target.value) || 10))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-3xl font-mono focus:outline-none focus:border-[#00f9ff]"
                />
              </div>

              <div className="bg-white/5 rounded-2xl p-4 text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-white/60">Potential Payout</span>
                  <span className="font-mono text-emerald-400">
                    {(betAmount * (betSide === 'YES' ? selectedMarket.yesOdds : selectedMarket.noOdds) / 100).toFixed(0)} HBAR
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 border-t border-white/10 pt-5">
              <button 
                onClick={placeBet}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black font-bold text-lg hover:brightness-110 active:scale-[0.985] transition-all shadow-xl"
              >
                CONFIRM BET • {betAmount} HBAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Market Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-[100] p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[#0a0c17] border border-white/10 rounded-3xl w-full max-w-[560px] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div>
                <div className="font-semibold text-2xl tracking-tight">Create Prediction Market</div>
                <div className="text-xs text-white/50">Live Data • AI Odds • $5 HBAR Fee</div>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-white/50 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-2">ASSET</label>
                <select 
                  value={selectedAsset} 
                  onChange={(e) => setSelectedAsset(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-lg focus:outline-none focus:border-[#00f9ff]"
                >
                  {assets.map(a => (
                    <option key={a.symbol} value={a.symbol}>
                      {a.name} ({a.symbol}) — ${formatPrice(a.price)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-2">PREDICTION SIDE</label>
                <div className="flex gap-3">
                  <button onClick={() => setSide('YES')} className={`flex-1 py-3 rounded-2xl font-semibold transition-all ${side === 'YES' ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10'}`}>YES</button>
                  <button onClick={() => setSide('NO')} className={`flex-1 py-3 rounded-2xl font-semibold transition-all ${side === 'NO' ? 'bg-red-500 text-white' : 'bg-white/5 hover:bg-white/10'}`}>NO</button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-2">EXPIRY DURATION</label>
                <div className="flex gap-2 mb-4">
                  {[1,3,7,14,30,60].map(days => (
                    <button 
                      key={days} 
                      onClick={() => setExpiryDays(days)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${expiryDays === days ? 'bg-[#00f9ff] text-black' : 'bg-white/5 hover:bg-white/10'}`}
                    >
                      {days}d
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-medium text-white/60">PRICE RANGE (±%)</label>
                  <span className="text-[#00f9ff] text-sm font-mono">±{priceRange}%</span>
                </div>
                <input 
                  type="range" 
                  min="2" 
                  max={maxRange} 
                  step="0.5"
                  value={priceRange} 
                  onChange={(e) => setPriceRange(parseFloat(e.target.value))}
                  className="w-full accent-[#00f9ff]"
                />
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Zap size={18} className="text-[#00f9ff]" />
                    <div className="font-semibold">AI Odds Engine</div>
                  </div>
                  <button onClick={generateAIOdds} disabled={isLoadingAI} className="flex items-center gap-1 text-xs text-[#00f9ff] hover:text-white transition-colors">
                    <RefreshCw size={14} className={isLoadingAI ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <div className="text-xs text-white/50">IMPLIED PROBABILITY</div>
                    <div className="text-4xl font-semibold text-emerald-400 mt-1">{aiOdds.probability}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-white/50">AI CONFIDENCE</div>
                    <div className="text-4xl font-semibold text-[#00f9ff] mt-1">{aiOdds.confidence}%</div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-2">INITIAL POOL (HBAR) — MIN $100</label>
                <input 
                  type="number" 
                  value={poolSize} 
                  onChange={(e) => setPoolSize(Math.max(100, parseInt(e.target.value) || 100))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-2xl font-mono focus:outline-none focus:border-[#00f9ff]"
                />
              </div>
            </div>

            <div className="px-6 pb-6 border-t border-white/10 pt-5">
              <div className="flex justify-between text-sm mb-4 px-1">
                <div className="text-white/60">Creation Fee</div>
                <div className="text-[#fbbf24]">5 HBAR</div>
              </div>
              <button 
                onClick={createMarket}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black font-bold text-lg hover:brightness-110 active:scale-[0.985] transition-all shadow-xl"
              >
                CREATE MARKET • PAY 5 HBAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
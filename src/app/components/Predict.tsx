// ========================================================
// CLEAN BOOTABLE RECOVERY VERSION – May 2026
// This file was written to get the dev server running again.
// It preserves the core Fast Games + Portfolio + extracted components flow.
// ========================================================

import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Zap, X, RefreshCw, TrendingUp } from 'lucide-react';
import { useSigning } from '../contexts/SigningContext';
import { useWallet } from '../contexts/WalletContext';
import { signAndExecuteTransaction } from '../utils/wallet-core';
import { getAudioContext, getMasterOutput, getVolumeMultiplier, getSoundMuted, shouldPlayVipSounds } from '../utils/sounds';
import { isVipEligible, loadVipPrefs } from '../utils/vip';
import {
  HBARH_LOGO_DARK,
  HBARH_LOGO_LIGHT,
} from '../assets/brand';
import { HolidayLogo } from './HolidayLogo';
import { useBrandLogos } from '../hooks/useBrandLogos';

import { TreasuryAdminPanel } from './TreasuryAdminPanel';
import { PredictionHistory } from './PredictionHistory';

const RESOLVER_BASE = 'http://localhost:4000';
const ESCROW_ACCOUNT_ID = '0.0.9006979';
const TREASURY_ACCOUNT_ID = '0.0.9006841';

import {
  fetchNativeActiveMarkets as fetchActiveMarkets,
  createNativeMarket,
  placeNativeBetForUser,
  base64ToUint8Array,
  prepareBetPaymentTransfer,
  fetchUserActiveBets,
  fetchFastGames,
  calculateFastGamePayout,
  getTopicMessagesReliable,
  MASTER_TOPIC_ID,
} from '../utils/predictionMarkets/native/nativePredictionService';

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
  address?: string;
  marketId?: string;
  endTime?: number;
  resolved?: boolean;
}

export function Predict() {
  const { isDark } = useTheme();
  const brandLogos = useBrandLogos();
  const { hederaAccount, hederaNetwork, hashPackSession } = useWallet();

  const canPlayPredictionSounds = useMemo(() => {
    const tokens = hederaAccount?.tokens ?? null;
    const network = hederaNetwork ?? "testnet";
    const acct = hashPackSession?.accountId || hederaAccount?.accountId;
    return shouldPlayVipSounds(tokens, network, acct);
  }, [hederaAccount?.tokens, hederaNetwork, hashPackSession?.accountId, hederaAccount?.accountId]);

  const isVIP = canPlayPredictionSounds || (
    typeof window !== 'undefined' && (
      localStorage.getItem('vip_active') === 'true' ||
      localStorage.getItem('vip_theme') === 'true' ||
      localStorage.getItem('vip_glow') === 'true'
    )
  );

  const vipSoundsEnabled = canPlayPredictionSounds;

  const playVIPSound = (type: 'card' | 'toggle' | 'slider' | 'action' | 'side-yes' | 'side-no') => {
    if (!canPlayPredictionSounds) return;
    if (getSoundMuted()) return;
    const volMul = getVolumeMultiplier();
    try {
      const audio = getAudioContext();
      const master = getMasterOutput();
      const now = audio.currentTime;

      if (type === 'card') {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        const filter = audio.createBiquadFilter();
        osc.type = 'sine'; osc.frequency.value = 620;
        filter.type = 'lowpass'; filter.frequency.value = 1600;
        gain.gain.value = 0.4 * volMul;
        osc.connect(filter); filter.connect(gain); gain.connect(master);
        osc.start(now);
        osc.frequency.linearRampToValueAtTime(880, now + 0.22);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.28);
        osc.stop(now + 0.32);
      } else if (type === 'action') {
        const osc1 = audio.createOscillator();
        const osc2 = audio.createOscillator();
        const gain = audio.createGain();
        osc1.type = 'sine'; osc1.frequency.value = 880;
        osc2.type = 'sine'; osc2.frequency.value = 1320;
        gain.gain.value = 0.35 * volMul;
        osc1.connect(gain); osc2.connect(gain); gain.connect(master);
        osc1.start(now); osc2.start(now + 0.06);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.35);
        osc1.stop(now + 0.4); osc2.stop(now + 0.4);
      }
    } catch (e) {}
  };

  const { withSigning } = useSigning();
  const { metaMaskAccount } = useWallet();

  const [isOnTestnet, setIsOnTestnet] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBetModal, setShowBetModal] = useState(false);
  const [showFastGameModal, setShowFastGameModal] = useState(false);
  const [fastGameDuration, setFastGameDuration] = useState<10 | 20>(10);
  const [fastGameSide, setFastGameSide] = useState<'YES' | 'NO'>('YES');
  const [fastGameStake, setFastGameStake] = useState(25);
  const [isCreatingFastGame, setIsCreatingFastGame] = useState(false);

  // Modal-specific HBAR price (refreshes every 15s for UI accuracy)
  const [modalHbarPrice, setModalHbarPrice] = useState<number | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [priceSecondsUntilRefresh, setPriceSecondsUntilRefresh] = useState(15);

  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  // 15-second HBAR price refresh + countdown when Create Fast Game modal is open
  useEffect(() => {
    if (!showFastGameModal) {
      setPriceSecondsUntilRefresh(15);
      return;
    }

    const fetchModalHbarPrice = async () => {
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd'
        );
        const json = await res.json();
        const price = json['hedera-hashgraph']?.usd;
        if (price) {
          setModalHbarPrice(price);
          setLastPriceUpdate(new Date());
          setPriceSecondsUntilRefresh(15);
        }
      } catch (e) {
        console.warn('Modal HBAR price refresh failed');
      }
    };

    // Initial load when modal opens
    fetchModalHbarPrice();

    const countdownInterval = setInterval(() => {
      setPriceSecondsUntilRefresh((prev) => {
        if (prev <= 1) {
          fetchModalHbarPrice();
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [showFastGameModal]);

  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: 'success' | 'error' | 'info' }>>([]);
  const toastIdRef = React.useRef(0);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  const [fastGames, setFastGames] = useState<any[]>([]);
  // Separate optimistic layer — HGraph lag will no longer nuke newly created games
  const [optimisticGames, setOptimisticGames] = useState<any[]>([]);

  // Session-persistent "recently active" cache (survives hard refresh, tab switch, come back).
  // Any marketId you *create or bet on* (including bets placed while viewing as another wallet in the same browser)
  // is force-kept in the UI list for ~90-120 minutes. This defeats HGraph lag for both your own games
  // and games other participants bet on while you are watching.
  const [recentlyCreatedMarketIds, setRecentlyCreatedMarketIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('recentlyCreatedFastGames');
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, number>;
        // Only keep entries from the last 2 hours to avoid long-term pollution
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        const filtered = new Set(
          Object.entries(parsed)
            .filter(([, ts]) => typeof ts === 'number' && ts > twoHoursAgo)
            .map(([id]) => id)
        );
        return filtered;
      }
    } catch {}
    return new Set();
  });
  const [isLoadingFastGames, setIsLoadingFastGames] = useState(false);

  // The highest priority source for display during active smoke testing:
  // the session-persistent "recently active" cache (creations + any bets you placed).
  // These marketIds are ALWAYS force-included even on hard refresh or when HGraph is behind.
  // Combined with the reliable (Mirror-backed) volume scan, this stops both vanishing tiles
  // and "bets from other accounts never tally on the UI".
  const displayFastGames = React.useMemo(() => {
    const map = new Map<string, any>();

    // Add HGraph games first
    fastGames.forEach(g => map.set(g.marketId, g));

    // Overlay optimistic (in-memory) games
    optimisticGames.forEach(g => {
      map.set(g.marketId, { ...g, _optimistic: true });
    });

    const now = Date.now();
    const NINETY_MIN = 90 * 60 * 1000;

    // Force-include every marketId from the persisted recent creations cache
    // for the next 90 minutes. This survives hard refresh and defeats HGraph lag.
    recentlyCreatedMarketIds.forEach(id => {
      if (!map.has(id)) {
        // Create a minimal placeholder so it renders.
        // The next successful loadFastGames will fill in the real data.
        map.set(id, {
          marketId: id,
          question: 'Recently created game (data loading...)',
          direction: 'YES',
          durationMinutes: 20,
          endTime: Math.floor((now + 20 * 60 * 1000) / 1000),
          creationPrice: 0,
          currentVolume: 0,
          resolved: false,
          _recentlyCreated: true,
        });
      }
    });

    // Final filter: for everything NOT in the recent cache, apply normal pruning.
    const result = Array.from(map.values()).filter(g => {
      if ((g as any)._recentlyCreated || recentlyCreatedMarketIds.has(g.marketId)) {
        return true; // never drop recently created games in this session
      }

      const cTs = parseInt((g.marketId || '').split('-')[1] || '0', 10);
      const age = now - cTs;

      if (cTs > 0 && age < NINETY_MIN) {
        return true;
      }

      if (g.resolved) {
        return (g.endTime || 0) > (now / 1000 - 3600);
      }
      return (g.endTime || 0) > (now / 1000 - 3600);
    });

    return result.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
  }, [fastGames, optimisticGames, recentlyCreatedMarketIds]);
  const [fastBetStake, setFastBetStake] = useState(10);

  const [marketCutoff, setMarketCutoff] = useState<number>(() => {
    const saved = localStorage.getItem('predictionMarketCutoff');
    return saved ? parseInt(saved) : 0;
  });

  const [myClaimables, setMyClaimables] = useState<any[]>([]);
  const [myHistory, setMyHistory] = useState<any[]>([]);
  const [isLoadingMyPortfolio, setIsLoadingMyPortfolio] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);

  const [recentlyClaimedMarketIds] = useState(() => new Set<string>());

  const loadFastGames = async () => {
    setIsLoadingFastGames(true);
    try {
      const gamesFromHGraph = await fetchFastGames();

      // Much stronger protection for recently created games.
      // Any game we optimistically added in the last 30 minutes will
      // always be kept, even if HGraph hasn't indexed it yet.
      // This stops the "blink on then disappear" behavior.
      setFastGames(prev => {
        const map = new Map<string, any>();
        gamesFromHGraph.forEach(g => map.set(g.marketId, g));

        const THIRTY_MINUTES = 30 * 60 * 1000;

        optimisticGames.forEach(g => {
          const age = Date.now() - (g._createdAt || 0);
          if (age < THIRTY_MINUTES) {
            // Always keep our recently created games
            map.set(g.marketId, { ...g, _optimistic: true });
          } else {
            // For older optimistic games, only keep if server doesn't have it
            const existing = map.get(g.marketId);
            if (!existing) {
              map.set(g.marketId, { ...g, _optimistic: true });
            }
          }
        });

        return Array.from(map.values());
      });
    } catch (e) {
      console.error("Failed to load fast games", e);
    } finally {
      setIsLoadingFastGames(false);
    }
  };

  const loadMyClaimsAndHistory = async () => {
    if (!hashPackSession?.accountId) {
      setMyClaimables([]); setMyHistory([]); return;
    }
    setIsLoadingMyPortfolio(true);
    try {
      const userId = hashPackSession.accountId;
      const claimables: any[] = [];
      const history: any[] = [];

      // Dedicated wider scan for the user's personal history (reliable path).
      // HGraph + Mirror Node fallback guarantees we capture every PLACE_BET the player made.
      // This is the targeted fix for "proper recording of wins and losses from the players" + "no record is show up".
      const hgraphResponse = await getTopicMessagesReliable(MASTER_TOPIC_ID, 1500);
      const messages = hgraphResponse?.topic_message || [];

      const userBets: Record<string, { myStake: number; side: string; game: any }> = {};

      for (const msg of messages) {
        try {
          let decoded = (msg.message || '');
          if (decoded.startsWith('\\x')) {
            try {
              const clean = decoded.replace(/\\x/g, '');
              const bytes = new Uint8Array(clean.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
              decoded = new TextDecoder().decode(bytes);
            } catch {}
          } else if (/^[A-Za-z0-9+/=]+$/.test(decoded) && decoded.length > 16) {
            try { decoded = atob(decoded); const bytes = new Uint8Array(decoded.length); for (let i=0;i<decoded.length;i++) bytes[i]=decoded.charCodeAt(i); decoded = new TextDecoder().decode(bytes); } catch {}
          }
          const p = JSON.parse(decoded);
          if (p.type !== "PLACE_BET") continue;
          if ((p.user || p.submittedBy) !== userId) continue;

          const mid = p.marketId;
          if (!userBets[mid]) userBets[mid] = { myStake: 0, side: p.side, game: null };

          userBets[mid].myStake += Number(p.amount) || 0;
        } catch {}
      }

      // For each market the user predicted on, gather rich data for private Game Receipts.
      for (const mid of Object.keys(userBets)) {
        const payout = await calculateFastGamePayout(mid, userId);

        // Try to get a bit more context for beautiful private receipts (fishing data)
        let creationPrice = null;
        let userSideAtBet = userBets[mid].side;

        try {
          // Quick scan for CREATE_MARKET to get entry price context
          const createRes = await getTopicMessagesReliable(MASTER_TOPIC_ID, 500);
          const createMsgs = createRes?.topic_message || [];
          for (const msg of createMsgs) {
            let decoded = (msg.message || '');
            // reuse the same decoding logic
            if (decoded.startsWith('\\x')) {
              try {
                const clean = decoded.replace(/\\x/g, '');
                const bytes = new Uint8Array(clean.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
                decoded = new TextDecoder().decode(bytes);
              } catch {}
            }
            const p = JSON.parse(decoded);
            if (p.type === 'CREATE_MARKET' && p.marketId === mid) {
              creationPrice = p.creationPrice || p.currentPrice;
              break;
            }
          }
        } catch {}

        const item = {
          marketId: mid,
          question: `Fast game ${mid}`,
          myStake: userBets[mid].myStake,
          userSide: userSideAtBet,
          totalWinningPool: payout.totalWinningSideStake || 0,
          claimable: payout.owed || 0,
          alreadyPaid: payout.alreadyPaid || false,
          resolved: true,
          sharePercent: (payout.totalWinningSideStake || 0) > 0 
            ? ((userBets[mid].myStake / (payout.totalWinningSideStake || 1)) * 100).toFixed(1) 
            : "0.0",
          creationPrice,                    // Great for "fishing data"
          openPrice: creationPrice,         // alias for receipts
        };

        if (userBets[mid].myStake > 0) {
          history.push(item);
        }
        if ((payout.owed || 0) > 0 && !item.alreadyPaid && !recentlyClaimedMarketIds.has(mid)) {
          claimables.push(item);
        }
      }

      setMyClaimables(claimables);
      setMyHistory(history.slice(0, 20));
    } catch (e) {
      console.error("Failed to load portfolio", e);
    } finally {
      setIsLoadingMyPortfolio(false);
    }
  };

  /**
   * Reconciles the live volume for a specific market using the new reliable backend endpoint (Step 2).
   * This is the key to making YES/NO volumes feel accurate right after anyone predicts (Step 3).
   * Defensive: Shows user-friendly toasts on failure and works even if HGraph is down (via Mirror).
   */
  const reconcileMarketVolume = async (marketId: string) => {
    try {
      const res = await fetch(`${RESOLVER_BASE}/api/prediction/market-volume?marketId=${marketId}`);
      if (!res.ok) {
        showToast("Volume reconciliation temporarily unavailable", 'error');
        return;
      }

      const data = await res.json();

      setFastGames((prev: any[]) =>
        prev.map((g: any) =>
          g.marketId === marketId
            ? {
                ...g,
                currentVolume: data.totalVolume ?? g.currentVolume,
                yesStake: data.yesStake ?? g.yesStake,
                noStake: data.noStake ?? g.noStake,
                _lastReconciled: Date.now(),
              }
            : g
        )
      );

      // Also update optimistic layer if present
      setOptimisticGames((prev: any[]) =>
        prev.map((g: any) =>
          g.marketId === marketId
            ? {
                ...g,
                currentVolume: data.totalVolume ?? g.currentVolume,
                yesStake: data.yesStake ?? g.yesStake,
                noStake: data.noStake ?? g.noStake,
              }
            : g
        )
      );

      // Subtle confirmation for user during smoke tests
      showToast("Volume reconciled from HCS", 'info');
    } catch (e) {
      console.warn('Volume reconciliation failed for', marketId, e);
      showToast("Could not reconcile volume right now", 'error');
    }
  };

  const handleFastBet = async (game: any, side: 'YES' | 'NO') => {
    const session = hashPackSession;
    if (!session?.accountId) { alert("Connect wallet"); return; }
    const stake = Math.max(1, fastBetStake);

    // Phase 2: Proper 1% platform fee handling (restored for real fee integrity)
    const platformFee = Math.round(stake * 100) / 10000; // exactly 1%
    const totalToSend = stake + platformFee;

    try {
      const paymentPrepare = await prepareBetPaymentTransfer({
        userAccountId: session.accountId,
        amountHbar: totalToSend,
        stakeAmount: stake,
        feeAmount: platformFee,
        resolutionAccountId: ESCROW_ACCOUNT_ID,
        treasuryAccountId: TREASURY_ACCOUNT_ID,
      });
      if (!paymentPrepare.success) throw new Error("Payment prep failed");

      const paymentBytes = base64ToUint8Array(paymentPrepare.transactionBytes);
      const paymentTxId = paymentPrepare.transactionId;

      await withSigning(`Predicting ${stake} HBAR (+1% fee) on ${side}...`, async () => {
        await signAndExecuteTransaction(session.wcTopic, 'testnet', session.accountId, paymentBytes);
        return "bet-paid";
      });

      // Phase 2: Tell the resolver about the bet + send the payment txId so it can verify the fee on-chain.
      // Retry a couple of times — Mirror propagation can be slightly delayed.
      let betRecorded = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const betRes = await fetch(`${RESOLVER_BASE}/api/prediction/bet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              marketId: game.marketId,
              side,
              amount: stake,
              user: session.accountId,
              platformFeeCollected: platformFee,
              paymentTxId,
            }),
          });

          if (betRes.ok) {
            betRecorded = true;
            break;
          } else {
            const errData = await betRes.json().catch(() => ({}));
            console.warn(`Bet recording attempt ${attempt} failed:`, errData.error || betRes.status);
          }
        } catch (e) {
          console.warn(`Bet recording attempt ${attempt} error:`, e);
        }

        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 2500)); // wait a bit for Mirror to catch up
        }
      }

      if (!betRecorded) {
        console.error("CRITICAL: Payment succeeded but all attempts to record the bet on the resolver failed.");
        showToast("Payment went through, but we couldn't record the prediction after several tries. Please contact support with the tx ID.", 'error');
      } else {
        showToast(`Prediction placed on ${side}`, 'success');

        // Make sure games you predict on (including predictions from other wallets in the same browser session)
        // are protected in the recent-active cache. This fixes "prediction from another account did not tally"
        // + disappearing after hard refresh or leaving the tab.
        setRecentlyCreatedMarketIds((prev: Set<string>) => {
          const next = new Set(prev);
          next.add(game.marketId);
          try {
            const toSave: Record<string, number> = {};
            next.forEach(id => { toSave[id] = Date.now(); });
            localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
          } catch {}
          return next;
        });

        // Immediate optimistic volume update so the tile "tallies" right away (no waiting for next poll)
        setFastGames((prev: any[]) => prev.map((g: any) => {
          if (g.marketId !== game.marketId) return g;
          const addYes = side === 'YES' ? stake : 0;
          const addNo = side === 'NO' ? stake : 0;
          return {
            ...g,
            currentVolume: (g.currentVolume || 0) + stake,
            yesStake: (g.yesStake || 0) + addYes,
            noStake: (g.noStake || 0) + addNo,
          };
        }));

        loadFastGames();
        loadMyClaimsAndHistory();

        // Immediate optimistic update already applied above.
        // Now trigger a proper reconciliation against the reliable backend after a short delay.
        // This catches bets from other wallets that happened around the same time.
        setTimeout(() => {
          reconcileMarketVolume(game.marketId);
        }, 3800);

        // Also do a full refresh a bit later as a safety net
        setTimeout(() => {
          loadFastGames();
        }, 6500);
      }
    } catch (e: any) {
      showToast("Prediction failed: " + (e?.message || e), 'error');
    }
  };

  const claimFastGamePayout = async (game: any) => {
    const userId = hashPackSession?.accountId;
    if (!userId) { alert("Connect wallet"); return; }
    try {
      const res = await fetch(`${RESOLVER_BASE}/api/prediction/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId: game.marketId, winner: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Claim failed');
      showToast(`Claimed +${data.amountPaid} HBAR`, 'success');
      recentlyClaimedMarketIds.add(game.marketId);
      setMyClaimables(prev => prev.filter(g => g.marketId !== game.marketId));
      loadFastGames();
    } catch (e: any) {
      alert("Claim failed: " + (e?.message || e));
    }
  };

  // Minimal stubs so the page doesn't explode
  const [selectedMarket, setSelectedMarket] = useState<MockMarket | null>(null);
  const [betSide, setBetSide] = useState<'YES' | 'NO'>('YES');
  const [betAmount, setBetAmount] = useState(100);
  const [selectedAsset, setSelectedAsset] = useState('BTC');
  const [currentPrice, setCurrentPrice] = useState(0);
  const [side, setSide] = useState<'YES' | 'NO'>('YES');
  const [expiryDays, setExpiryDays] = useState(7);
  const [priceRange, setPriceRange] = useState(15);
  const [poolSize, setPoolSize] = useState(10);
  const [aiOdds, setAiOdds] = useState({ probability: 62, confidence: 87 });
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [priceDirection, setPriceDirection] = useState<'+' | '-' | '±'>('±');
  const [activeMarkets, setActiveMarkets] = useState<MockMarket[]>([]);
  const [userBets, setUserBets] = useState<any[]>([]);

  const fetchLivePrices = async () => {
    setIsLoadingPrices(true);
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,hedera-hashgraph&order=market_cap_desc&per_page=10&page=1');
      const data = await response.json();
      const liveAssets: Asset[] = data.map((coin: any) => ({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price ?? null,
        change24h: coin.price_change_percentage_24h ?? 0,
        logo: coin.image || '',
      }));
      setAssets(liveAssets);
      const selected = liveAssets.find(a => a.symbol === selectedAsset);
      if (selected && selected.price !== null) setCurrentPrice(selected.price);
    } catch (e) {
      setErrorMessage('Price fetch failed');
    } finally {
      setIsLoadingPrices(false);
    }
  };

  const loadOnChainMarkets = async () => {
    try {
      const native = await fetchActiveMarkets();
      const mapped = native.map((m: any, idx: number) => ({
        id: idx + 1,
        asset: m.asset,
        question: m.question,
        yesOdds: 50, noOdds: 50,
        volume: "TBD",
        endsIn: m.endTime ? "soon" : "—",
        totalBets: 0,
        marketId: m.marketId,
        endTime: m.endTime,
        resolved: (m as any).resolved,
      }));
      setActiveMarkets(mapped);
    } catch (e) { console.warn(e); }
  };

  useEffect(() => {
    fetchLivePrices();
    loadOnChainMarkets();
    loadFastGames();
    loadMyClaimsAndHistory();
    if (hashPackSession?.accountId) {
      fetchUserActiveBets(hashPackSession.accountId).then(setUserBets);
    }
    const marketRefresh = setInterval(() => {
      loadOnChainMarkets();
      loadFastGames();
    }, 15000);
    const priceRefresh = setInterval(fetchLivePrices, 60000);

    // Robust resume when user returns to the tab or focuses the window.
    // This fixes "left the tab and came back → poof it's gone" (polling may have been throttled or state stale).
    const handleVisibilityOrFocus = () => {
      // Re-hydrate the recent cache from localStorage in case of edge cases
      try {
        const saved = localStorage.getItem('recentlyCreatedFastGames');
        if (saved) {
          const parsed = JSON.parse(saved) as Record<string, number>;
          const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
          const filtered = new Set(
            Object.entries(parsed)
              .filter(([, ts]) => typeof ts === 'number' && ts > twoHoursAgo)
              .map(([id]) => id)
          );
          setRecentlyCreatedMarketIds(filtered);
        }
      } catch {}
      // Only refresh when the tab is actually visible (polite, production behavior)
      if (document.visibilityState === 'visible') {
        loadFastGames();
        loadMyClaimsAndHistory();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      clearInterval(marketRefresh);
      clearInterval(priceRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [hashPackSession?.accountId]);

  const openBetModal = (market: MockMarket) => {
    setSelectedMarket(market);
    setBetSide('YES');
    setBetAmount(100);
    setShowBetModal(true);
  };

  const placeBet = async () => {
    alert("Bet flow temporarily simplified during recovery. Full flow will be restored in next step.");
    setShowBetModal(false);
  };

  const createMarket = async () => {
    alert("Create flow temporarily simplified during recovery.");
    setShowCreateModal(false);
  };

  const formatPrice = (price: number | null) => price ? price.toFixed(2) : 'N/A';

  return (
    <div className={`min-h-[calc(100vh-120px)] ${isDark ? 'bg-[#080a12] text-white' : 'bg-[#f8fafc] text-slate-900'} p-6`}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className={`text-sm ${isDark ? 'text-white/60' : 'text-slate-600'}`}>Live Prices • Updates every 60s</div>
          <button onClick={fetchLivePrices} className="flex items-center gap-2 text-xs text-[#00f9ff] hover:text-[#00d4ff]">
            <RefreshCw size={14} className={isLoadingPrices ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Asset cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5 mb-12">
          {isLoadingPrices && assets.length === 0 ? (
            <div className="col-span-full text-center py-12 text-white/50">Loading live prices...</div>
          ) : assets.length > 0 ? (
            assets.map((asset, index) => (
              <div key={index} onClick={() => { setSelectedAsset(asset.symbol); setShowCreateModal(true); }}
                className={`group rounded-3xl p-5 border transition-all hover:-translate-y-0.5 cursor-pointer ${isDark ? 'bg-white/5 border-white/10 hover:border-[#00f9ff]/40' : 'bg-white border-slate-200 hover:border-[#00f9ff]/60 shadow-sm'}`}>
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
                <div className="text-4xl font-semibold tracking-[-1.5px] tabular-nums">${formatPrice(asset.price)}</div>
                <div className="mt-5 pt-4 border-t border-white/10 text-center text-sm text-[#00f9ff] group-hover:underline">Create Market →</div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-12 text-white/50">No assets loaded</div>
          )}
        </div>

        {/* HBAR Fast Guess */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight">HBAR Fast Guess</h3>
              <p className="text-sm text-white/60">Up or Down from current price • 10 / 20 minutes</p>
            </div>
            <button onClick={() => setShowFastGameModal(true)}
              className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black font-semibold hover:brightness-110">
              Create Fast Game
            </button>
          </div>

          {/* Active Fast Games */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-white/70">Active HBAR Fast Games (Live Timers)</div>
              <button onClick={loadFastGames} className="text-xs px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20">Refresh</button>
            </div>

            {isLoadingFastGames ? (
              <div className="text-white/50 text-sm py-4">Loading fast games from HCS...</div>
            ) : displayFastGames.filter((g: any) => !g.resolved).length === 0 ? (
              <div className="text-white/50 text-sm py-4 space-y-1">
                <div>No active fast games right now.</div>
                <div className="text-white/40 text-xs">Fast games are short (10-20 min). Check your <span className="underline">Portfolio &amp; Claim Center</span> below for completed games, winnings, and full audit trail.</div>
                <div className="text-white/40 text-xs">All activity is permanently recorded on HCS topic 0.0.9017517.</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {displayFastGames.filter((g: any) => !g.resolved).slice(0, 6).map((game: any) => {
                  const remaining = Math.max(0, (game.endTime || 0) - now);
                  const mins = Math.floor(remaining / 60);
                  const secs = remaining % 60;
                  const timeStr = remaining > 0 ? `${mins}m ${secs}s` : "EXPIRED";

                  const isBettingOpen = remaining > ((game.durationMinutes || 10) * 60 * 0.5);

                  return (
                    <div 
                      key={game.marketId} 
                      className={`group rounded-3xl border p-5 transition-all ${isDark ? 'border-white/10 bg-white/5 hover:bg-white/[0.08]' : 'border-slate-200 bg-white shadow-sm hover:shadow-md'} ${isVIP ? 'vip-glass vip-shimmer ring-1 ring-white/10' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="font-mono text-[10px] text-white/50 tracking-[0.5px]">{game.marketId}</div>
                          <a 
                            href="https://hashscan.io/testnet/topic/0.0.9017517" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] text-[#00f9ff] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Topic
                          </a>
                        </div>
                        <div className={`text-[10px] px-2.5 py-0.5 rounded-full font-medium ${isBettingOpen ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                          {isBettingOpen ? 'OPEN' : 'CLOSED'}
                        </div>
                      </div>

                      <div className="font-semibold text-[15px] leading-tight tracking-[-0.2px] mb-4 pr-1">
                        {game.question}
                      </div>

                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-4">
                        <div>
                          <div className="text-[10px] text-white/50 tracking-widest">CREATION PRICE</div>
                          <div className="font-mono text-[#00f9ff] tabular-nums">${game.creationPrice?.toFixed(4) || '—'}</div>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="text-[10px] text-white/50 tracking-widest">VOLUME</div>
                            {recentlyCreatedMarketIds.has(game.marketId) && (
                              <button
                                onClick={() => reconcileMarketVolume(game.marketId)}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/60 hover:text-white/90 transition-colors"
                                title="Reconcile live volume from HCS"
                              >
                                Reconcile
                              </button>
                            )}
                          </div>
                          <div className="font-semibold tabular-nums flex items-center gap-1.5">
                            {(game.currentVolume || 0).toFixed(1)} HBAR
                            {game._lastReconciled && Date.now() - game._lastReconciled < 30000 && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400">LIVE</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* YES / NO Volume Ratio (first small visual improvement) */}
                      {(() => {
                        const yesStake = game.yesStake ?? 0;
                        const noStake = game.noStake ?? 0;
                        const total = yesStake + noStake;

                        if (total <= 0) return null;

                        const yesPercent = Math.round((yesStake / total) * 100);
                        const noPercent = 100 - yesPercent;

                        return (
                          <div className="mb-4">
                            <div className="flex justify-between text-[10px] text-white/50 tracking-widest mb-1.5">
                              <div className="text-emerald-400">YES {yesPercent}%</div>
                              <div className="text-rose-400">NO {noPercent}%</div>
                            </div>
                            <div className="h-2.5 bg-white/10 rounded-full overflow-hidden flex">
                              <div 
                                className="bg-emerald-500 transition-all duration-300" 
                                style={{ width: `${yesPercent}%` }}
                              />
                              <div 
                                className="bg-rose-500 transition-all duration-300" 
                                style={{ width: `${noPercent}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-[10px] mt-1 font-mono">
                              <div className="text-emerald-400">{yesStake.toFixed(1)}</div>
                              <div className="text-rose-400">{noStake.toFixed(1)}</div>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="flex items-baseline justify-between mb-4">
                        <div className="text-[28px] font-semibold text-[#00f9ff] tabular-nums tracking-[-1px] leading-none">
                          {timeStr}
                        </div>
                        <div className="text-right text-[10px] text-white/50">
                          {isBettingOpen ? 'Predictions close at 50%' : 'Resolution pending'}
                        </div>
                      </div>

                      {remaining > 30 && hashPackSession?.accountId && isBettingOpen && (
                        <div className="pt-4 border-t border-white/10">
                          {/* Quick stake presets */}
                          <div className="flex justify-between items-center mb-2 text-xs">
                            <div className="text-white/50">Stake</div>
                            <div className="flex gap-1">
                              {[10, 25, 50, 100].map((amt) => (
                                <button
                                  key={amt}
                                  onClick={() => setFastBetStake(amt)}
                                  className={`px-2 py-0.5 rounded text-xs transition-all border ${
                                    fastBetStake === amt 
                                      ? 'bg-white/20 border-white/30' 
                                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                                  }`}
                                >
                                  {amt}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleFastBet(game, 'YES')} 
                              className="flex-1 py-2.5 text-sm rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.985] text-white font-semibold transition-all"
                            >
                              YES {fastBetStake}
                            </button>
                            <button 
                              onClick={() => handleFastBet(game, 'NO')} 
                              className="flex-1 py-2.5 text-sm rounded-2xl bg-red-600 hover:bg-red-500 active:scale-[0.985] text-white font-semibold transition-all"
                            >
                              NO {fastBetStake}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Portfolio Dropdown */}
        <div className="mt-10 border-t border-white/10 pt-8">
          <button
            onClick={() => {
              const next = !portfolioOpen;
              setPortfolioOpen(next);
              if (next && hashPackSession?.accountId) loadMyClaimsAndHistory();
            }}
            className="w-full flex items-center justify-between rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 px-6 py-4 text-left"
          >
            <div>
              <div className="font-semibold text-xl tracking-tight">My Prediction Portfolio &amp; Claim Center</div>
              <div className="text-sm text-white/60">
                {myClaimables.length > 0 ? `${myClaimables.length} game(s) with claimable HBAR` : "View your past predictions and pending winnings"}
              </div>
            </div>
            <div className={`text-2xl transition-transform ${portfolioOpen ? 'rotate-180' : ''}`}>⌄</div>
          </button>

          {portfolioOpen && (
            <div className={`mt-4 rounded-3xl border p-6 space-y-6 ${isDark ? 'border-white/10 bg-[#0a0c17]/80' : 'border-gray-200 bg-white shadow-sm'}`}>
              {isLoadingMyPortfolio ? (
                <div className={`${isDark ? 'text-white/60' : 'text-gray-600'}`}>Loading your prediction history...</div>
              ) : !hashPackSession?.accountId ? (
                <div className={`${isDark ? 'text-white/60' : 'text-gray-600'} italic`}>Connect your wallet to see your personal claimable winnings.</div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-6 text-sm">
                    <div>
                      <div className="text-white/50">Total Claimable Right Now</div>
                      <div className="text-3xl font-semibold text-emerald-400">
                        {myClaimables.reduce((sum, g) => sum + (g.claimable || 0), 0).toFixed(2)} HBAR
                      </div>
                    </div>
                    <div>
                      <div className="text-white/50">Games You Participated In</div>
                      <div className="text-3xl font-semibold">{myHistory.length}</div>
                    </div>
                  </div>

                  {/* Claimables */}
                  <div>
                    <div className="font-semibold text-emerald-400 mb-3">Claimable Winnings</div>
                    {myClaimables.length === 0 ? (
                      <div className={`${isDark ? 'text-white/50' : 'text-gray-500'} text-sm italic`}>No pending claims right now.</div>
                    ) : (
                      <div className="space-y-3">
                        {myClaimables.map((game, idx) => (
                          <div key={idx} className={`rounded-3xl border p-5 flex flex-col lg:flex-row gap-5 ${isDark ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-emerald-200 bg-emerald-50/70'}`}>
                            <div className="flex-1">
                              <div className="font-semibold">{game.question}</div>
                              <div className="text-[10px] font-mono text-white/40">{game.marketId}</div>
                            </div>
                            <div className="flex gap-8 text-sm">
                              <div><div className="text-[10px] text-white/50">YOUR STAKE</div><div className="font-semibold">{game.myStake} HBAR</div></div>
                              <div><div className="text-[10px] text-white/50">YOU RECEIVE</div><div className="text-2xl font-semibold text-emerald-400">{game.claimable} HBAR</div></div>
                            </div>
                            <button onClick={() => claimFastGamePayout(game)} className="px-7 py-3 rounded-2xl font-semibold bg-emerald-500 text-black hover:bg-emerald-400">Claim Now</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <PredictionHistory myHistory={myHistory} isDark={isDark} isVIP={isVIP} showToast={showToast} />

                  {/* Master Audit Trail Note - Added in Step 5 integration */}
                  <div className="pt-4 border-t border-white/10 text-[11px] text-white/50">
                    All activity (creations, predictions, resolutions, payouts) is permanently recorded on the immutable HCS topic <span className="font-mono text-white/70">0.0.9017517</span>.
                    <a 
                      href="https://hashscan.io/testnet/topic/0.0.9017517/messages" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="ml-2 text-[#00f9ff] hover:underline"
                    >
                      View full Master Audit Trail →
                    </a>
                  </div>

                  <TreasuryAdminPanel
                    hashPackSession={hashPackSession}
                    showToast={showToast}
                    RESOLVER_BASE={RESOLVER_BASE}
                    isDark={isDark}
                    isVIP={isVIP}
                    vipSoundsEnabled={vipSoundsEnabled}
                    playVIPSound={playVIPSound}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* Toasts */}
        {toasts.length > 0 && (
          <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 max-w-[420px]">
            {toasts.map((toast) => (
              <div key={toast.id} className={`px-5 py-4 rounded-3xl border shadow-2xl backdrop-blur-xl text-sm flex items-start gap-3 ${toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300' : 'bg-rose-500/10 border-rose-500/40 text-rose-300'}`}>
                <div className="mt-0.5 text-lg">{toast.type === 'success' ? '✅' : '❌'}</div>
                <div className="flex-1 font-medium">{toast.message}</div>
                <button onClick={() => dismissToast(toast.id)} className="text-xs opacity-50">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fast Game Modal (simplified for boot) */}
      {showFastGameModal && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4" onClick={() => setShowFastGameModal(false)}>
          <div className={`rounded-3xl w-full max-w-[480px] p-6 ${isDark ? 'bg-[#0a0c17] border-white/10' : 'bg-white'}`} onClick={e => e.stopPropagation()}>

            {/* Dynamic WRAPpDEX Logo (pulls main wordmark from Supabase + respects holidays) */}
            <div className="flex justify-center mb-4">
              <HolidayLogo 
                defaultDarkSrc={brandLogos.dark} 
                defaultLightSrc={brandLogos.light} 
                isDark={isDark} 
                alt="WRAPpDEX" 
                imgClassName="h-32 w-auto object-contain"
                holidayImgClassName="h-32 w-auto object-contain"
              />
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <div className="font-semibold text-xl tracking-tight">Create HBAR Fast Guess</div>
                  <div className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                    Up or Down • 10 / 20 min
                  </div>
                </div>
                <button onClick={() => setShowFastGameModal(false)}><X /></button>
              </div>

              {/* Current HBAR Price - Refreshes every 15s for UI accuracy */}
              <div className="flex flex-col gap-0.5 text-xs">
                <div className="flex items-baseline gap-2">
                  <span className={`${isDark ? 'text-white/50' : 'text-gray-500'}`}>CURRENT HBAR</span>
                  <span className={`font-mono font-semibold tabular-nums ${isDark ? 'text-[#00f9ff]' : 'text-blue-600'}`}>
                    ${(modalHbarPrice ?? assets.find(a => a.symbol === 'HBAR')?.price ?? 0).toFixed(4)}
                  </span>
                </div>

                {lastPriceUpdate && (
                  <div className={`text-[10px] flex items-center gap-2 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                    <span>
                      {lastPriceUpdate.toLocaleDateString()} {lastPriceUpdate.toLocaleTimeString()}
                    </span>
                    <span className="text-emerald-400">
                      • next in {priceSecondsUntilRefresh}s
                    </span>
                  </div>
                )}

                <div className="text-[9px] text-white/40 mt-0.5">
                  Settlement price is captured at creation time for fairness
                </div>
              </div>
            </div>

            <div className="space-y-5">
              {/* Duration */}
              <div>
                <div className={`text-xs font-medium tracking-[1px] mb-2 ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
                  GAME DURATION
                </div>
                <div className="flex gap-2">
                  {[10, 20].map((mins) => {
                    const isActive = fastGameDuration === mins;
                    return (
                      <button
                        key={mins}
                        onClick={() => setFastGameDuration(mins as 10 | 20)}
                        className={`flex-1 py-3 rounded-2xl text-sm font-semibold transition-all border
                          ${isActive 
                            ? 'bg-[#00f9ff] text-black border-[#00f9ff]' 
                            : isDark 
                              ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/90' 
                              : 'bg-gray-100 border-gray-200 hover:bg-gray-200 text-gray-800'
                          }`}
                      >
                        {mins} min
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Side Selection */}
              <div>
                <div className={`text-xs font-medium tracking-[1px] mb-2 ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
                  WHICH SIDE ARE YOU TAKING?
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setFastGameSide('YES')}
                    className={`flex-1 py-3.5 rounded-2xl text-sm font-semibold transition-all border flex flex-col items-center justify-center
                      ${fastGameSide === 'YES' 
                        ? 'bg-[#00f9ff] text-black border-[#00f9ff]' 
                        : isDark 
                          ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/90' 
                          : 'bg-gray-100 border-gray-200 hover:bg-gray-200'
                      }`}
                  >
                    <span className="font-bold">YES</span>
                    <span className="text-[10px] opacity-70">I predict it will be ABOVE</span>
                  </button>
                  <button
                    onClick={() => setFastGameSide('NO')}
                    className={`flex-1 py-3.5 rounded-2xl text-sm font-semibold transition-all border flex flex-col items-center justify-center
                      ${fastGameSide === 'NO' 
                        ? 'bg-rose-500 text-white border-rose-500' 
                        : isDark 
                          ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/90' 
                          : 'bg-gray-100 border-gray-200 hover:bg-gray-200'
                      }`}
                  >
                    <span className="font-bold">NO</span>
                    <span className="text-[10px] opacity-70">I predict it will be BELOW</span>
                  </button>
                </div>
              </div>

              {/* Stake with Presets */}
              <div>
                <div className={`text-xs font-medium tracking-[1px] mb-2 ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
                  YOUR INITIAL STAKE (HBAR)
                </div>

                <div className={`flex items-center rounded-2xl border px-4 py-3 mb-2 ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-100'}`}>
                  <input 
                    type="number" 
                    value={fastGameStake} 
                    min={10}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value);
                      if (!isNaN(raw)) setFastGameStake(Math.max(0, raw));
                    }}
                    className={`flex-1 bg-transparent text-xl font-mono focus:outline-none tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}
                  />
                  <span className={`ml-2 text-sm ${isDark ? 'text-white/60' : 'text-gray-500'}`}>HBAR</span>
                </div>

                {/* Quick Presets */}
                <div className="flex gap-2">
                  {[10, 25, 50, 100, 250].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setFastGameStake(amt)}
                      className={`flex-1 py-1.5 rounded-xl text-xs font-medium transition-all border
                        ${fastGameStake === amt
                          ? (isVIP ? 'bg-emerald-500 text-black border-emerald-400' : 'bg-[#00f9ff] text-black border-[#00f9ff]')
                          : isDark 
                            ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/80' 
                            : 'bg-gray-100 border-gray-200 hover:bg-gray-200 text-gray-700'
                        }`}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary Box */}
              <div className={`p-4 rounded-2xl text-sm border ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs mb-2 ${isDark ? 'text-white/60' : 'text-gray-500'}`}>YOU ARE CREATING</div>
                <div className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Will HBAR be above current price in {fastGameDuration} minutes?
                </div>
                <div className={`text-xs mt-2 ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
                  You are taking the <span className="font-semibold">{fastGameSide}</span> side with your {fastGameStake} HBAR stake
                </div>
              </div>
              <button
                onClick={async () => {
                  const session = hashPackSession;
                  if (!session?.accountId) {
                    alert("Please connect your wallet first.");
                    return;
                  }

                  setIsCreatingFastGame(true);

                  try {
                    // 1. Prepare the payment (2.5 HBAR creation fee + user's initial stake)
                    const paymentPrepare = await prepareBetPaymentTransfer({
                      userAccountId: session.accountId,
                      amountHbar: 2.5 + fastGameStake,
                      stakeAmount: fastGameStake,
                      feeAmount: 2.5,
                      resolutionAccountId: ESCROW_ACCOUNT_ID,
                      treasuryAccountId: TREASURY_ACCOUNT_ID,
                    });

                    if (!paymentPrepare.success) {
                      throw new Error("Failed to prepare payment");
                    }

                    const paymentBytes = base64ToUint8Array(paymentPrepare.transactionBytes);

                    // 2. User signs the HBAR transfer (correct architecture)
                    await withSigning(`Paying creation fee + stake...`, async () => {
                      await signAndExecuteTransaction(
                        session.wcTopic,
                        'testnet',
                        session.accountId,
                        paymentBytes
                      );
                      return "payment-sent";
                    });

                    // 3. Payment succeeded — now tell the resolver to record the market on HCS
                    const hbarPrice = assets.find(a => a.symbol === 'HBAR')?.price || 0.05;

                    const generatedMarketId = `fast-${Date.now()}`;

                    const res = await fetch(`${RESOLVER_BASE}/api/prediction/fast-game/create`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        marketId: generatedMarketId,
                        question: `Will HBAR be above current price in ${fastGameDuration} minutes?`,
                        asset: 'HBAR',
                        endTime: Math.floor(Date.now() / 1000) + (fastGameDuration * 60),
                        durationMinutes: fastGameDuration,
                        initialSide: fastGameSide,
                        initialStake: fastGameStake,
                        creationPrice: hbarPrice,
                        submittedBy: session.accountId,
                      }),
                    });

                    const data = await res.json();

                    if (!res.ok || !data.success) {
                      throw new Error(data.error || 'Resolver failed to record the game');
                    }

                    // Optimistic update: immediately show the new game in the UI
                    // This solves the "game created but doesn't appear" issue caused by HGraph indexing delay.
                    const optimisticGame = {
                      marketId: generatedMarketId,
                      question: `Will HBAR be ${fastGameSide} in ${fastGameDuration} minutes?`,
                      direction: fastGameSide,
                      durationMinutes: fastGameDuration,
                      endTime: Math.floor(Date.now() / 1000) + (fastGameDuration * 60),
                      creationPrice: hbarPrice,
                      currentVolume: fastGameStake,
                      resolved: false,
                      creator: session.accountId,
                      yesStake: fastGameSide === 'YES' ? fastGameStake : 0,
                      noStake: fastGameSide === 'NO' ? fastGameStake : 0,
                      yesParticipants: fastGameSide === 'YES' ? 1 : 0,
                      noParticipants: fastGameSide === 'NO' ? 1 : 0,
                      totalParticipants: 1,
                    } as any;

                    // Push to optimistic layer instead of main list
                    setOptimisticGames(prev => {
                      const exists = prev.some(g => g.marketId === optimisticGame.marketId);
                      if (exists) return prev;
                      return [optimisticGame, ...prev];
                    });

                    // CRITICAL: Persist to the recentlyCreated cache + localStorage so the game
                    // survives hard refresh, tab switch, and coming back later (even if HGraph lags).
                    // This was the missing write side causing "poof it's gone on hard refresh".
                    setRecentlyCreatedMarketIds((prev: Set<string>) => {
                      const next = new Set(prev);
                      next.add(optimisticGame.marketId);
                      // Persist to localStorage for cross-reload survival
                      try {
                        const toSave: Record<string, number> = {};
                        next.forEach(id => { toSave[id] = Date.now(); });
                        localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
                      } catch {}
                      return next;
                    });

                    showToast('Fast Game created successfully!', 'success');
                    setShowFastGameModal(false);

                    // Also do normal refreshes (the optimistic layer will protect the game)
                    setTimeout(() => loadFastGames(), 2000);
                    setTimeout(() => loadFastGames(), 6000);
                  } catch (err: any) {
                    showToast(`Creation failed: ${err?.message || err}`, 'error');
                    console.error(err);
                  } finally {
                    setIsCreatingFastGame(false);
                  }
                }}
                disabled={isCreatingFastGame}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold disabled:opacity-60"
              >
                {isCreatingFastGame ? "Waiting for signature..." : "CREATE FAST GAME • PAY 2.5 HBAR + STAKE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

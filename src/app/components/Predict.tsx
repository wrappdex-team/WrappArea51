// ========================================================
// CLEAN BOOTABLE RECOVERY VERSION – May 2026
// This file was written to get the dev server running again.
// It preserves the core Fast Games + Portfolio + extracted components flow.
// ========================================================

import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Zap, X, RefreshCw, TrendingUp, Feather } from 'lucide-react';
import { Slider } from './ui/slider';
import { motion, AnimatePresence } from 'framer-motion';
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
import { ENV } from '../utils/env';

const RESOLVER_BASE = ENV.RESOLVER_BASE;

// === LOCAL DEV PARITY + PROD URL GUARD (critical for create-to-HCS wire) ===
// In dev (npm run dev), make sure a .env (or .env.local) next to the project root has:
// VITE_RESOLVER_URL=http://localhost:4000
// Then the local frontend will hit your local resolver instance (run the backend/prediction-resolver with its own .env containing the testnet key + topic).
// The checks below catch the #1 cause of "payment succeeds but no game / no HCS train": the built bundle talking to localhost or a stale Railway URL.
// Whenever Railway resolver redeploys (new hostname), you MUST also set VITE_RESOLVER_URL in Vercel envs and redeploy FE.
if (typeof window !== 'undefined') {
  const isProdLike = !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');
  const looksLikeLiveResolver = RESOLVER_BASE.includes('wrapparea51') || RESOLVER_BASE.includes('railway.app');
  if (isProdLike && (RESOLVER_BASE.includes('localhost') || !looksLikeLiveResolver)) {
    console.error(
      '[CRITICAL CONFIG] RESOLVER_BASE =', RESOLVER_BASE,
      'This is the exact URL the Predict create flow will POST to after payment. ' +
      'Fast game creates will take your HBAR (to the hardcoded escrow/treasury) but the record step will fail (no HCS CREATE/PLACE_BET, no register). ' +
      'Fix: set VITE_RESOLVER_URL=https://wrapparea51-production.up.railway.app (or current Railway) in Vercel project settings and redeploy frontend.'
    );
  }
  if (typeof window !== 'undefined' && (window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1'))) {
    console.log('[DEV] RESOLVER_BASE =', RESOLVER_BASE, '(ensure your local resolver is running on this and VITE_RESOLVER_URL matches in .env)');
  }
}
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
  fetchUserHbarBalance,
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

  const isVIP = canPlayPredictionSounds || !!hashPackSession?.accountId || (
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
  const [fastGameDuration, setFastGameDuration] = useState<10 | 20 | 60 | 240>(10); // extended support per master plan (1h/4h after polish)
  const [fastGameSide, setFastGameSide] = useState<'YES' | 'NO'>('YES');
  const [fastGameStake, setFastGameStake] = useState(25);
  const [fastGameMaxBalance, setFastGameMaxBalance] = useState<number | null>(null); // dynamic from Mirror via resolver for slider UX
  const [isCreatingFastGame, setIsCreatingFastGame] = useState(false);

  // Controls the collapsible Game Rules section inside the Fast Game create modal.
  // Provides quick rules + advanced factual breakdown with clean prediction/staking language.
  const [showGameRules, setShowGameRules] = useState(false);

  // Modal-specific HBAR price for "CURRENT HBAR (official rate for this game)".
  // Resolver is authoritative (now always mainnet sources: SaucerSwap last-traded verified + mainnet-public mirror / public CG/CoinCap backups).
  // We poll every ~10s while modal open for a "second-to-second" reliable feel (tighter than cards for the rate the user will lock in).
  // Countdown is live (1s decrement). On 0 we force a fresh resolver fetch (critical path inside resolver also bypasses its cache).
  const [modalHbarPrice, setModalHbarPrice] = useState<number | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [priceSecondsUntilRefresh, setPriceSecondsUntilRefresh] = useState(10);

  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  // Shared live HBAR price for cards tiny delta/chart.
  // Resolver now serves reliable mainnet price (Saucer last-traded verified or mainnet-public mirror + public backups).
  // We poll resolver at 15s for consistency with the rate that will be locked at creation.
  // For snappier visual movement/deltas on cards we also use fast coingecko assets (fetchLivePrices).
  const [liveHbarPrice, setLiveHbarPrice] = useState<number | null>(null);
  const [livePriceTs, setLivePriceTs] = useState<number>(0);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`${RESOLVER_BASE}/api/price/hbar`);
        const j = await res.json();
        const p = j.price ?? j['hedera-hashgraph']?.usd;
        if (active && p) {
          setLiveHbarPrice(p);
          setLivePriceTs(Date.now());
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Modal HBAR price refresh + live countdown (mainnet reliable sources via resolver).
  useEffect(() => {
    if (!showFastGameModal) {
      setPriceSecondsUntilRefresh(10);
      return;
    }

    const fetchModalHbarPrice = async () => {
      try {
        // Resolver is authoritative for the rate "for this game" (now mainnet Saucer + mainnet mirror/public backups for fairness).
        const res = await fetch(`${RESOLVER_BASE}/api/price/hbar`);
        const json = await res.json();
        const price = json.price ?? json['hedera-hashgraph']?.usd;
        if (price) {
          setModalHbarPrice(price);
          setLastPriceUpdate(new Date());
          setPriceSecondsUntilRefresh(10);
        }
      } catch (e) {
        console.warn('Modal HBAR price refresh from resolver failed, falling back to public mainnet sources (CoinGecko/CoinCap)');
        // Direct public mainnet fallbacks for display (very reliable + fast).
        try {
          let price: number | null = null;
          // CoinGecko
          const cg = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd');
          if (cg.ok) {
            const j = await cg.json();
            price = j['hedera-hashgraph']?.usd ?? null;
          }
          if (!price) {
            // CoinCap backup
            const cc = await fetch('https://api.coincap.io/v2/assets/hedera-hashgraph');
            if (cc.ok) {
              const j = await cc.json();
              price = parseFloat(j?.data?.priceUsd) || null;
            }
          }
          if (price) {
            setModalHbarPrice(price);
            setLastPriceUpdate(new Date());
            setPriceSecondsUntilRefresh(10);
          }
        } catch {}
      }
    };

    // Initial load when modal opens
    fetchModalHbarPrice();

    const countdownInterval = setInterval(() => {
      setPriceSecondsUntilRefresh((prev) => {
        if (prev <= 1) {
          fetchModalHbarPrice();
          return 10;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [showFastGameModal]);

  // Fetch real user HBAR balance (via resolver for prod consistency) when wallet connects/changes.
  // Used to drive max for BOTH create modal AND per-card betting stakes (wallet - ~3 HBAR buffer for fees/gas).
  // SECURITY: UX only — backend always re-verifies before recording.
  useEffect(() => {
    if (!hashPackSession?.accountId) {
      setFastGameMaxBalance(null);
      return;
    }
    (async () => {
      try {
        const bal = await fetchUserHbarBalance(hashPackSession.accountId);
        // Leave small buffer for fees (create fixed 2.5 HBAR + network; the 2% facilitation is taken only at payout/claim time, not on the stake transfer)
        const safeMax = Math.max(1, Math.floor((bal - 3) * 100) / 100);
        setFastGameMaxBalance(safeMax > 0 ? safeMax : null);
      } catch {
        setFastGameMaxBalance(null);
      }
    })();
  }, [hashPackSession?.accountId]);

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
  // is force-kept in the UI list for up to ~5 hours (covers 4h games + HGraph lag buffer).
  // This defeats HGraph lag for both your own games and games other participants bet on while watching.
  const MAX_RECENT_FAST_GAME_AGE_MS = 5 * 60 * 60 * 1000; // 5 hours
  const [recentlyCreatedMarketIds, setRecentlyCreatedMarketIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('recentlyCreatedFastGames');
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, number>;
        // Only keep entries from the last 6 hours to avoid long-term pollution (supports 4h games)
        const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
        const filtered = new Set(
          Object.entries(parsed)
            .filter(([, ts]) => typeof ts === 'number' && ts > sixHoursAgo)
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

    // Force-include logic for recent games — with EXTREMELY strict safeguards
    // to prevent ghost/placeholder games with bogus timers.
    recentlyCreatedMarketIds.forEach(id => {
      if (!map.has(id)) {
        const cTsMs = parseInt(id.split('-')[1] || '0', 10);
        if (!cTsMs) return;

        const creationSec = Math.floor(cTsMs / 1000);
        const nowSec = now / 1000;
        const ageSec = nowSec - creationSec;

        // Nuclear hard limit: never create placeholder for anything older than the recent protection window.
        // Increased to support 1h/4h games + HGraph lag. This is the main kill switch for lingering ghosts.
        if (ageSec > MAX_RECENT_FAST_GAME_AGE_MS / 1000) {
          return;
        }

        // Fixed endTime based purely on creation timestamp + max duration (in seconds).
        // Never use "now + X" here — that causes the timer to reset on every render.
        const assumedMaxDurSec = Math.max(20 * 60, (240) * 60); // support up to 4h games
        const fixedEndTimeSec = creationSec + assumedMaxDurSec;

        // If we're already past the natural end + small grace, do not create placeholder.
        const graceSec = 5 * 60;
        if (nowSec > fixedEndTimeSec + graceSec) {
          return;
        }

        // For pending confirmation, use a longer display window (30min) so that long-duration games
        // (especially 4h) do not appear to "expire" the placeholder while we wait for HCS/resolver confirmation.
        // The real data (with strengthened endTime enforcement) will take over quickly and show the true
        // full timer until the last second.
        const displayDurMin = 30;

        const pendingEnd = creationSec + (displayDurMin * 60);
        map.set(id, {
          marketId: id,
          question: 'Confirming on HCS (pending resolver)…',
          direction: 'YES',
          durationMinutes: displayDurMin,
          endTime: pendingEnd,
          creationPrice: 0,
          currentVolume: 0,
          resolved: false,
          _recentlyCreated: true,
          _isPendingConfirm: true,
        });
      }
    });

    // Final filter — very careful with units and expiration
    const result = Array.from(map.values()).filter(g => {
      const isRecent = recentlyCreatedMarketIds.has(g.marketId);
      const nowSec = now / 1000;

      if (isRecent) {
        const cTsMs = parseInt((g.marketId || '').split('-')[1] || '0', 10);
        if (!cTsMs) return false;

        const creationSec = Math.floor(cTsMs / 1000);
        const ageSec = nowSec - creationSec;

        // Hard nuclear cutoff at the recent protection window from creation for ANY recent game.
        // Increased to support 1h/4h games. This is the primary defense against old ghosts.
        if (ageSec > MAX_RECENT_FAST_GAME_AGE_MS / 1000) {
          return false;
        }

        // Natural expiration based on creation time + max duration + grace.
        const assumedMaxDur = Math.max(20 * 60, 240 * 60); // support up to 4h games
        const naturalEndSec = creationSec + assumedMaxDur;
        const graceSec = 5 * 60;

        if (nowSec > naturalEndSec + graceSec) {
          return false;
        }

        // If we have real resolved data, respect its endTime.
        if (g.resolved) {
          return (g.endTime || 0) > (nowSec - 3600);
        }

        // Within the safe window and not past natural expiration → allow (for HGraph lag protection).
        return true;
      }

      // Normal (non-recent) games — original pruning logic (units already correct in this path)
      const cTsMs = parseInt((g.marketId || '').split('-')[1] || '0', 10);
      const ageMs = now - cTsMs;

      if (cTsMs > 0 && ageMs < NINETY_MIN) {
        return true;
      }

      if (g.resolved) {
        return (g.endTime || 0) > (nowSec - 3600);
      }
      return (g.endTime || 0) > (nowSec - 3600);
    });

    return result.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
  }, [fastGames, optimisticGames, recentlyCreatedMarketIds]);
  // Per-game stake amounts (fixes global stake selector problem - Tier 1)
  const [gameStakes, setGameStakes] = useState<Record<string, number>>({});

  // Per-wallet bet count for this browser session + optimistic (for live "X/3" or "X/5" safety net display).
  // Backend (resolver) is the hard authority and will reject + log on HCS if violated.
  // We increment on successful local bet record and on create (initial counts as 1).
  const [myBetCounts, setMyBetCounts] = useState<Record<string, number>>({});

  const [marketCutoff, setMarketCutoff] = useState<number>(() => {
    const saved = localStorage.getItem('predictionMarketCutoff');
    return saved ? parseInt(saved) : 0;
  });

  const [myClaimables, setMyClaimables] = useState<any[]>([]);
  const [myHistory, setMyHistory] = useState<any[]>([]);
  const [isLoadingMyPortfolio, setIsLoadingMyPortfolio] = useState(false);
  const [lastPortfolioSync, setLastPortfolioSync] = useState<number>(0);
  const [portfolioCacheStatus, setPortfolioCacheStatus] = useState<'live' | 'cached' | 'stale'>('live');
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [activeReceiptFilter, setActiveReceiptFilter] = useState<'ALL' | 'WINS' | 'LOSSES' | 'UNMATCHED'>(() => {
    try {
      return (localStorage.getItem('predictionReceiptFilter') as any) || 'ALL';
    } catch {
      return 'ALL';
    }
  });
  const [receiptSearch, setReceiptSearch] = useState('');

  // Per-user positions for "Your Position" on tiles (Tier 1 UX)
  const [userPositions, setUserPositions] = useState<Record<string, { side: string; amount: number }>>({});

  // Temporary "just bet" confirmation state for strong visual feedback on specific tile (Tier 1)
  const [justBetGames, setJustBetGames] = useState<Record<string, { side: string; amount: number; timestamp: number }>>({});

  // Tier 2 #2: Recent Outcomes strip (last few resolved games for social proof during smoke tests)
  const [recentOutcomes, setRecentOutcomes] = useState<Array<{ marketId: string; winner: string; multiple?: string; timestamp: number }>>([]);

  // Immediate one-time prune for the specific ghost reported in the screenshot.
  // Runs on mount to clear the lingering "fast-1780763848289" even before the next loadFastGames.
  // This is the client-side source of the ghost (localStorage 'recentlyCreatedFastGames' + optimistic).
  useEffect(() => {
    const GHOST_ID = 'fast-1780763848289';
    if (recentlyCreatedMarketIds.has(GHOST_ID)) {
      setRecentlyCreatedMarketIds(prev => {
        const next = new Set(prev);
        next.delete(GHOST_ID);
        try {
          const toSave: Record<string, number> = {};
          next.forEach(id => { toSave[id] = Date.now(); });
          localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
        } catch {}
        return next;
      });
      setOptimisticGames(prev => prev.filter((g: any) => g.marketId !== GHOST_ID));
    }
  }, []); // once on mount

  // Capture recently resolved games for the outcomes strip
  useEffect(() => {
    const newlyResolved = fastGames
      .filter((g: any) => g.resolutionWinner && !recentOutcomes.some(r => r.marketId === g.marketId))
      .map((g: any) => ({
        marketId: g.marketId,
        winner: g.resolutionWinner,
        multiple: g.profitMultiple || undefined, // if available from data
        timestamp: Date.now()
      }));

    if (newlyResolved.length > 0) {
      setRecentOutcomes(prev => [...newlyResolved, ...prev].slice(0, 4)); // keep last 4
    }
  }, [fastGames]);

  // Phase 1 fix: Prune "ghost" recentlyCreated entries that never materialized in the authoritative resolver list.
  // This happens for errored creations (e.g. record to HCS failed after on-chain payment).
  // The placeholder would otherwise linger (root cause of the lingering errored game with odd timer even after terminal restart).
  // Hard prune for the specific ID + general + eager localStorage rewrite on every authoritative load.
  useEffect(() => {
    if (!fastGames || fastGames.length === 0) return;

    const authoritativeIds = new Set(fastGames.map((g: any) => g.marketId));
    const GRACE_MS = 2 * 60 * 1000; // tightened grace

    const toRemove: string[] = [];

    recentlyCreatedMarketIds.forEach(id => {
      if (!authoritativeIds.has(id)) {
        const cTs = parseInt((id || '').split('-')[1] || '0', 10);
        if (cTs && (Date.now() - cTs) > GRACE_MS) {
          toRemove.push(id);
        }
      }
    });

    // Hard prune the specific lingering errored game reported (even if age check passes)
    const GHOST_ID = 'fast-1780763848289';
    if (recentlyCreatedMarketIds.has(GHOST_ID)) {
      toRemove.push(GHOST_ID);
    }

    if (toRemove.length > 0) {
      setRecentlyCreatedMarketIds(prev => {
        const next = new Set(prev);
        toRemove.forEach(id => next.delete(id));
        try {
          const toSave: Record<string, number> = {};
          next.forEach(id => { toSave[id] = Date.now(); });
          localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
        } catch {}
        return next;
      });

      // Also clean from optimistic layer
      setOptimisticGames(prev => prev.filter((g: any) => !toRemove.includes(g.marketId)));
    }
  }, [fastGames]); // re-run when authoritative fastGames list arrives from resolver

  // Extra eager cleanup: whenever fastGames authoritative list updates, rewrite localStorage to drop any
  // recently IDs that the resolver does not currently know about (prevents ghosts surviving across reloads / terminal restarts).
  useEffect(() => {
    if (!fastGames || fastGames.length === 0) return;
    const auth = new Set(fastGames.map((g: any) => g.marketId));
    setRecentlyCreatedMarketIds(prev => {
      let changed = false;
      const next = new Set(prev);
      next.forEach(id => {
        if (!auth.has(id)) {
          const cTs = parseInt((id || '').split('-')[1] || '0', 10);
          if (!cTs || (Date.now() - cTs) > 60_000) {
            next.delete(id);
            changed = true;
          }
        }
      });
      if (changed) {
        try {
          const toSave: Record<string, number> = {};
          next.forEach(id => { toSave[id] = Date.now(); });
          localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
        } catch {}
      }
      return next;
    });
  }, [fastGames]);

  // Live ticking "last reconciled X seconds ago" display (only when portfolio panel is open)
  const [, setTimeTick] = useState(0);
  useEffect(() => {
    if (!portfolioOpen || lastPortfolioSync === 0) return;
    const tick = setInterval(() => {
      setTimeTick(t => t + 1); // purely for relative time display refresh
    }, 5000);
    return () => clearInterval(tick);
  }, [portfolioOpen, lastPortfolioSync]);

  // Load historical user positions into tile display when portfolio data arrives (persists across refresh)
  useEffect(() => {
    if (myHistory.length === 0) return;

    const newPositions: Record<string, { side: string; amount: number }> = {};

    myHistory.forEach((item: any) => {
      if (!item.marketId || !item.userSide || !item.myStake) return;
      // Only show if not yet resolved or if user had a position
      newPositions[item.marketId] = {
        side: item.userSide,
        amount: item.myStake
      };
    });

    setUserPositions(prev => ({ ...prev, ...newPositions }));
  }, [myHistory]);

  // Persist active receipt filter
  useEffect(() => {
    try {
      localStorage.setItem('predictionReceiptFilter', activeReceiptFilter);
    } catch {}
  }, [activeReceiptFilter]);

  const [recentlyClaimedMarketIds] = useState(() => new Set<string>());

  const loadFastGames = async () => {
    setIsLoadingFastGames(true);

    // Aggressive cleanup on every load — correct units (cTs is ms)
    setRecentlyCreatedMarketIds(currentSet => {
      const nowSec = Date.now() / 1000;
      const MAX_AGE_SEC = MAX_RECENT_FAST_GAME_AGE_MS / 1000;
      const assumedMaxDur = Math.max(20 * 60, 240 * 60); // support up to 4h games
      const grace = 5 * 60;

      const newSet = new Set(currentSet);
      let changed = false;

      for (const id of newSet) {
        const cTsMs = parseInt(id.split('-')[1] || '0', 10);
        if (!cTsMs) {
          newSet.delete(id);
          changed = true;
          continue;
        }

        const creationSec = Math.floor(cTsMs / 1000);
        const naturalEndSec = creationSec + assumedMaxDur + grace;
        const ageSec = nowSec - creationSec;

        if (ageSec > MAX_AGE_SEC || nowSec > naturalEndSec) {
          newSet.delete(id);
          changed = true;
        }
      }

      if (changed) {
        try {
          const toSave: Record<string, number> = {};
          newSet.forEach(id => { toSave[id] = Date.now(); });
          localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
        } catch {}
      }
      return changed ? newSet : currentSet;
    });

    try {
      const gamesFromHGraph = await fetchFastGames();

      // Global + ghost fix: if the resolver (hopefully the canonical prod one) returned a non-empty list,
      // aggressively drop any recentlyCreated IDs that are not present in it (after a tiny grace for the
      // exact game we just created in this browser). This stops "data loading" placeholders from
      // dominating when the FE is talking to the wrong resolver or the list is partial.
      if (Array.isArray(gamesFromHGraph) && gamesFromHGraph.length > 0) {
        const authIds = new Set(gamesFromHGraph.map((g: any) => g.marketId));
        const GRACE_FOR_JUST_CREATED_MS = 60 * 1000;
        setRecentlyCreatedMarketIds(currentSet => {
          const newSet = new Set(currentSet);
          let changed = false;
          for (const id of newSet) {
            if (!authIds.has(id)) {
              const cTsMs = parseInt((id.split('-')[1] || '0'), 10);
              if (!cTsMs || (Date.now() - cTsMs) > GRACE_FOR_JUST_CREATED_MS) {
                newSet.delete(id);
                changed = true;
              }
            }
          }
          if (changed) {
            try {
              const toSave: Record<string, number> = {};
              newSet.forEach(id => { toSave[id] = Date.now(); });
              localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
            } catch {}
          }
          return changed ? newSet : currentSet;
        });
      }

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
            map.set(g.marketId, { ...g, _optimistic: true });
          } else {
            const existing = map.get(g.marketId);
            if (!existing) {
              map.set(g.marketId, { ...g, _optimistic: true });
            }
          }
        });

        // Clean up recentlyCreatedMarketIds for games that have actually resolved
        // This prevents resolved games from lingering as broken placeholders
        setRecentlyCreatedMarketIds(currentSet => {
          const newSet = new Set(currentSet);
          let changed = false;

          for (const id of newSet) {
            const game = map.get(id);
            if (game && game.resolved) {
              newSet.delete(id);
              changed = true;
            }
          }

          if (changed) {
            try {
              const toSave: Record<string, number> = {};
              newSet.forEach(id => { toSave[id] = Date.now(); });
              localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
            } catch {}
          }

          return changed ? newSet : currentSet;
        });

        return Array.from(map.values());
      });
    } catch (e) {
      console.error("Failed to load fast games", e);
    } finally {
      setIsLoadingFastGames(false);
    }
  };

  // ============================================================
  // RETRY FOR PENDING/WC-TIMEOUT/FAILED RECORDS (recovery for "funds taken but no topic" cases)
  // Allows creator to force the /fast-game/create POST (which triggers resolver HCS CREATE_MARKET + PLACE_BET)
  // even if the initial post-pay background record hit 429, network blip, or the WC sign timed out before reaching the IIFE.
  // Uses same fields the success path sends. Robust json + 429-aware backoff (up to 8 tries).
  // ============================================================
  const retryRecordForGame = async (game: any) => {
    if (!game?.marketId) return;
    const submittedBy = game.creator || (game as any).submittedBy;
    if (!submittedBy) {
      showToast('Cannot retry record: missing creator account on the pending game.', 'error');
      return;
    }
    setOptimisticGames(prev => prev.map(g => g.marketId === game.marketId ? { ...g, _retrying: true } : g));

    let hbarPrice = (typeof game.creationPrice === 'number' ? game.creationPrice : 0.05);
    let creationPriceTime: string | undefined;
    try {
      const pRes = await fetch(`${RESOLVER_BASE}/api/price/hbar`);
      if (pRes.ok) {
        const pJson = await pRes.json().catch(() => ({} as any));
        hbarPrice = pJson?.price ?? hbarPrice;
        creationPriceTime = pJson?.priceTime || pJson?.resolvedAt;
      }
    } catch {}

    let recordSuccess = false;
    let lastRecordError = '';
    const dur = (game.durationMinutes as number) || 10;
    const stk = (game.currentVolume as number) || (game as any).initialStake || 25;
    const side: 'YES' | 'NO' = (game.direction as any) || 'YES';
    const q = game.question || `Will HBAR be ${side === 'YES' ? 'Higher' : 'Lower'} than creation price in ${dur} min?`;

    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        const res = await fetch(`${RESOLVER_BASE}/api/prediction/fast-game/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketId: game.marketId,
            question: q,
            asset: 'HBAR',
            endTime: (game.endTime as number) || Math.floor(Date.now() / 1000) + (dur * 60),
            durationMinutes: dur,
            initialSide: side,
            initialStake: stk,
            creationPrice: hbarPrice,
            creationPriceTime,
            submittedBy,
          }),
        });
        let data: any = {};
        try { data = await res.json(); } catch { data = { error: `HTTP ${res.status}` }; }
        if (res.ok && data?.success) {
          recordSuccess = true;
          break;
        } else {
          lastRecordError = data?.error || data?.stage || `status ${res.status}`;
          if (res.status === 429) lastRecordError += ' (resolver rate-limited)';
        }
      } catch (e: any) {
        lastRecordError = e?.message || 'Network error calling resolver';
      }
      if (attempt < 8) {
        const isRate = lastRecordError.includes('429') || lastRecordError.includes('rate');
        const backoff = isRate ? (6500 * attempt) : (1600 * attempt);
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    if (recordSuccess) {
      setOptimisticGames(prev => prev.map(g => g.marketId === game.marketId ? {
        ...g, creationPrice: hbarPrice, _pendingRecord: false, _recordFailed: false, _wcTimedOut: false, _mayHavePayment: false, _retrying: false
      } : g));
      showToast('Fast Game recorded on HCS via retry! (CREATE + PLACE_BET topic messages posted)', 'success');
      setTimeout(() => loadFastGames(), 700);
      setTimeout(() => loadFastGames(), 2200);
    } else {
      setOptimisticGames(prev => prev.map(g => g.marketId === game.marketId ? {
        ...g, _recordFailed: true, _retrying: false, _lastRecordError: lastRecordError
      } : g));
      showToast(`Retry record failed: ${lastRecordError}. MarketId: ${game.marketId}. Resolver: ${RESOLVER_BASE}. Check HashScan or try again in a minute.`, 'error');
    }
  };

  // ============================================================
  // STABLE PORTFOLIO DATA COLLECTION (Web3 Hedera expert layer)
  // Resolver is the authoritative "belt". Client now treats it as the
  // single source of truth with short-TTL cache + smart refresh.
  // Eliminates "comes and goes", 23/13 flips, and polling spam.
  // ============================================================
  const PORTFOLIO_CACHE_TTL_MS = 75_000; // 75 seconds — sweet spot for smoke tests + real use
  const PORTFOLIO_CACHE_KEY = 'portfolioCache_v1';

  interface PortfolioCacheEntry {
    accountId: string;
    myHistory: any[];
    myClaimables: any[];
    ts: number;
  }

  const getCachedPortfolio = (accountId: string): PortfolioCacheEntry | null => {
    try {
      const raw = localStorage.getItem(PORTFOLIO_CACHE_KEY);
      if (!raw) return null;
      const entry: PortfolioCacheEntry = JSON.parse(raw);
      if (entry.accountId !== accountId) return null;
      return entry;
    } catch {
      return null;
    }
  };

  const setCachedPortfolio = (accountId: string, myHistory: any[], myClaimables: any[]) => {
    try {
      const entry: PortfolioCacheEntry = { accountId, myHistory, myClaimables, ts: Date.now() };
      localStorage.setItem(PORTFOLIO_CACHE_KEY, JSON.stringify(entry));
    } catch {}
  };

  const isCacheFresh = (entry: PortfolioCacheEntry | null): boolean => {
    if (!entry) return false;
    return (Date.now() - entry.ts) < PORTFOLIO_CACHE_TTL_MS;
  };

  const loadMyClaimsAndHistory = async (forceRefresh = false) => {
    if (!hashPackSession?.accountId) {
      setMyClaimables([]); setMyHistory([]); return;
    }

    const userId = hashPackSession.accountId;

    // === FAST PATH: Serve from cache if fresh and not forced ===
    // This is the #1 thing that kills "comes and goes" and 23/13 flips.
    if (!forceRefresh) {
      const cached = getCachedPortfolio(userId);
      if (cached && isCacheFresh(cached)) {
        setMyHistory(cached.myHistory);
        setMyClaimables(cached.myClaimables);
        setLastPortfolioSync(cached.ts);
        setPortfolioCacheStatus('cached');
        return; // Instant, stable, zero network spam
      }
    }

    setIsLoadingMyPortfolio(true);

    try {
      console.log('[Portfolio] Hitting resolver for', userId, forceRefresh ? '(forced)' : '');

      // === PRIMARY: Resolver belt (server-side reliable scan) ===
      // We almost never want the client doing 10-page direct Mirror scans anymore.
      const res = await fetch(`${RESOLVER_BASE}/api/prediction/user-history?account=${encodeURIComponent(userId)}`);

      if (res.ok) {
        const data = await res.json();
        const newHistory = Array.isArray(data.myHistory) ? data.myHistory : [];
        const newClaimables = Array.isArray(data.myClaimables) ? data.myClaimables : [];

        // Success — update UI + write durable cache
        setMyHistory(newHistory);
        setMyClaimables(newClaimables);

        const now = Date.now();
        setLastPortfolioSync(now);
        setPortfolioCacheStatus('live');
        setCachedPortfolio(userId, newHistory, newClaimables);

        console.log('[Portfolio] Resolver success → cached', newHistory.length, 'history,', newClaimables.length, 'claimables');
        return;
      }

      // Resolver returned non-OK — treat as transient, keep cache if we have any
      console.warn('[Portfolio] Resolver returned', res.status, '— keeping previous data (no destructive overwrite)');

    } catch (e) {
      console.warn('[Portfolio] Resolver fetch failed (transient). Using cached data if available.', e);
    } finally {
      // If we had no fresh cache and resolver failed, we may have stale data — mark it
      const stillCached = getCachedPortfolio(userId);
      if (stillCached) {
        setPortfolioCacheStatus('stale');
      }
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
    const stake = Math.max(1, gameStakes[game.marketId] || 10);

    // === CLIENT-SIDE SAFETY NET (user-friendly, before any signing or gas) ===
    // Computes live from current pot (yes+no stakes) + time vs duration + our local bet count.
    // Exact same rules as backend validator. Backend is still the single source of truth and will hard-reject.
    const pot = (game.yesStake || 0) + (game.noStake || 0);
    // Use same 4h+ timer strengthening as the card display for consistent safety limits.
    const cTsForSafety = parseInt((game.marketId || '').split('-')[1] || '0', 10);
    const dMinForSafety = game.durationMinutes || 10;
    let effEndForSafety = game.endTime || 0;
    if (cTsForSafety && dMinForSafety > 0) {
      const safe = Math.floor(cTsForSafety / 1000) + dMinForSafety * 60;
      if (!effEndForSafety || effEndForSafety < safe - 30) effEndForSafety = safe;
    }
    const durSec = (game.durationMinutes || 10) * 60;
    const rem = Math.max(0, effEndForSafety - now);
    const pastHalf = rem <= durSec * 0.5;
    const maxBetThis = pastHalf
      ? Math.max(1, Math.floor(pot * 0.40 * 100) / 100)
      : Math.max(1, Math.floor(pot * 1.25 * 100) / 100);
    const myCountNow = myBetCounts[game.marketId] || 0;
    const walletLimit = 3; // conservative; creator 5 is enforced server-side using on-chain first-bet detection
    if (stake > maxBetThis + 0.01) {
      showToast(`Bet exceeds safety limit: ${maxBetThis.toFixed(2)} HBAR max (${pastHalf ? '40% whale cap' : '1.25× pot'}).`, 'error');
      return;
    }
    if (myCountNow >= walletLimit) {
      showToast(`You have reached the per-wallet limit for this market.`, 'error');
      return;
    }

    // Under current fee structure: user sends exactly the stake (no variable % on the prediction itself).
    // 2% facilitation fee (only when opposing stake existed) is applied exclusively at payout/claim time by the resolver.
    const totalToSend = stake;

    try {
      const paymentPrepare = await prepareBetPaymentTransfer({
        userAccountId: session.accountId,
        amountHbar: totalToSend,
        stakeAmount: stake,
        feeAmount: 0,
        resolutionAccountId: ESCROW_ACCOUNT_ID,
        treasuryAccountId: TREASURY_ACCOUNT_ID,
      });
      if (!paymentPrepare.success) throw new Error("Payment prep failed");

      const paymentBytes = base64ToUint8Array(paymentPrepare.transactionBytes);
      const paymentTxId = paymentPrepare.transactionId;

      await withSigning(`Predicting ${stake} HBAR on ${side} (2% facilitation settled only at payout)...`, async () => {
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
              platformFeeCollected: 0, // 2% is now taken only at payout/claim per hard safety rules
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

        // Increment our local safety-net count immediately (backend will be authoritative on next error or refresh).
        setMyBetCounts(prev => ({
          ...prev,
          [game.marketId]: (prev[game.marketId] || 0) + 1
        }));

        // Strong immediate confirmation on the specific tile (Tier 1)
        const betTime = Date.now();
        setJustBetGames(prev => ({
          ...prev,
          [game.marketId]: { side, amount: stake, timestamp: betTime }
        }));

        // Auto-clear the confirmation indicator after 8 seconds
        setTimeout(() => {
          setJustBetGames(prev => {
            const next = { ...prev };
            if (next[game.marketId]?.timestamp === betTime) {
              delete next[game.marketId];
            }
            return next;
          });
        }, 8000);

        // Loading fix (cross-user visibility): rapid follow-up polls after a successful record.
        // The optimistic + justBet + recentlyCreated already make *this* browser feel instant.
        // These extra fetches pull the resolver's authoritative view (which includes the just-recorded PLACE_BET
        // volume/participants) and make it visible to any other team member polling at the same time.
        // 650ms + 2100ms covers Mirror/HCS short propagation + the 8s global poll cadence.
        setTimeout(() => { loadFastGames(); }, 650);
        setTimeout(() => { loadFastGames(); }, 2100);

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

        // Immediate optimistic volume update + track user's personal position (for tile "Your Position" display)
        setFastGames((prev: any[]) => prev.map((g: any) => {
          if (g.marketId !== game.marketId) return g;
          const addYes = side === 'YES' ? stake : 0;
          const addNo = side === 'NO' ? stake : 0;
          const addYesP = side === 'YES' ? 1 : 0;
          const addNoP = side === 'NO' ? 1 : 0;
          return {
            ...g,
            currentVolume: (g.currentVolume || 0) + stake,
            yesStake: (g.yesStake || 0) + addYes,
            noStake: (g.noStake || 0) + addNo,
            yesParticipants: (g.yesParticipants || 0) + addYesP,
            noParticipants: (g.noParticipants || 0) + addNoP,
          };
        }));

        setUserPositions(prev => ({
          ...prev,
          [game.marketId]: {
            side,
            amount: (prev[game.marketId]?.amount || 0) + stake
          }
        }));

        loadFastGames();
        loadMyClaimsAndHistory(true); // user just bet — force fresh resolver data

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

  // Toggle for consolidated active markets view: fast, prediction (long), or both
  const [activeMarketFilter, setActiveMarketFilter] = useState<'fast' | 'prediction' | 'both'>('both');

  const fetchLivePrices = async () => {
    setIsLoadingPrices(true);
    try {
      // Prefer resolver proxy for live deploys (avoids CORS from vercel.app origin to CoinGecko).
      // But fall back to direct if the resolver wire is bad (HTML error, unreachable, or proxy not returning JSON) so the 4 tokens (BTC/ETH/HBAR/SOL) + 24h % always show.
      const isLive = !RESOLVER_BASE.includes('localhost');
      let coingeckoUrl = isLive
        ? `${RESOLVER_BASE}/api/proxy/coingecko/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,hedera-hashgraph,solana&order=market_cap_desc&per_page=10&page=1`
        : 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,hedera-hashgraph,solana&order=market_cap_desc&per_page=10&page=1';
      let response = await fetch(coingeckoUrl);
      if (!response.ok) throw new Error('proxy bad status');
      let data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        // fallback direct
        coingeckoUrl = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,hedera-hashgraph,solana&order=market_cap_desc&per_page=10&page=1';
        response = await fetch(coingeckoUrl);
        data = await response.json();
      }
      const liveAssets: Asset[] = (Array.isArray(data) ? data : []).map((coin: any) => ({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price ?? null,
        change24h: coin.price_change_percentage_24h ?? 0,
        logo: coin.image || '',
      }));
      setAssets(liveAssets);
      const selected = liveAssets.find(a => a.symbol === selectedAsset);
      if (selected && selected.price !== null) setCurrentPrice(selected.price);
      setErrorMessage('');
    } catch (e) {
      // last resort direct
      try {
        const direct = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,hedera-hashgraph,solana&order=market_cap_desc&per_page=10&page=1';
        const r = await fetch(direct);
        const d = await r.json();
        const liveAssets: Asset[] = (Array.isArray(d) ? d : []).map((coin: any) => ({
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          price: coin.current_price ?? null,
          change24h: coin.price_change_percentage_24h ?? 0,
          logo: coin.image || '',
        }));
        setAssets(liveAssets);
        const selected = liveAssets.find(a => a.symbol === selectedAsset);
        if (selected && selected.price !== null) setCurrentPrice(selected.price);
      } catch {
        setErrorMessage('Price fetch failed');
      }
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
    loadMyClaimsAndHistory(); // will hit cache fast-path on most mounts
    if (hashPackSession?.accountId) {
      fetchUserActiveBets(hashPackSession.accountId).then(setUserBets);
    }

    // Aggressive poll for fast games (8s) — the key part of the "loading fix" for cross-user bet visibility.
    // Local actor gets optimistic + rapid follow-ups below. Remote team members (different machines/tabs)
    // now see new PLACE_BET volume/participants/positions within ~8s without hard refresh.
    // Focus/visibility (below) also forces an immediate load so returning to the tab snaps latest state.
    // Resolver is the source of truth; this just asks it more often + on natural user signals.
    const FAST_POLL_MS = 8000;
    const marketRefresh = setInterval(() => {
      loadOnChainMarkets();
      loadFastGames();
    }, FAST_POLL_MS);

    const priceRefresh = setInterval(fetchLivePrices, 60000);

    // Portfolio gets a gentle background heartbeat — only when tab is visible.
    // Much less aggressive than before to prevent spam + "comes and goes".
    const portfolioHeartbeat = setInterval(() => {
      if (document.visibilityState === 'visible' && hashPackSession?.accountId) {
        // Only refresh portfolio if cache is getting old
        const cached = getCachedPortfolio(hashPackSession.accountId);
        if (!cached || !isCacheFresh(cached)) {
          loadMyClaimsAndHistory();
        }
      }
    }, 45000); // every 45s max — huge reduction from constant 15s + visibility storms

    // Smart visibility/focus handler (loading fix): force fast-game list refresh on tab return / focus.
    // This is the "come back and see teammate's new bet without hard refresh" path.
    // Portfolio stays gentle (only on long idle). Fast games are cheap + user-visible so we always refresh them.
    const handleVisibilityOrFocus = () => {
      // Always keep fast-game recent cache fresh (cheap)
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

      // Force a fast-game poll on visibility/focus so remote observers instantly see the latest volumes
      // from the resolver (new bets from other users, resolutions, etc.) without waiting for the next 8s tick.
      // Safe and idempotent; loadFastGames already does heavy pruning + authoritative merge.
      // Runs for everyone (even non-wallet observers) so the public active list snaps fresh on tab return.
      loadFastGames();

      if (document.visibilityState === 'visible' && hashPackSession?.accountId) {
        // Only hit portfolio if we have been away long enough that cache may be stale
        const cached = getCachedPortfolio(hashPackSession.accountId);
        const longIdle = !cached || (Date.now() - cached.ts) > 60_000;
        if (longIdle) {
          loadMyClaimsAndHistory();
        } else {
          // Just re-apply the still-fresh cache instantly (no network)
          setMyHistory(cached!.myHistory);
          setMyClaimables(cached!.myClaimables);
          setLastPortfolioSync(cached!.ts);
          setPortfolioCacheStatus('cached');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      clearInterval(marketRefresh);
      clearInterval(priceRefresh);
      clearInterval(portfolioHeartbeat);
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

  // REMOVED in Phase 7 cleanup (per master plan): old simplified bet/create flows (fast game is the active path now).
  // Legacy modals (showBetModal/showCreateModal) and these functions were remnants from pre-fast-game recovery.
  // Fast game create/bet fully wired via resolver with retries, optimistic, etc. Safe to drop.

  const formatPrice = (price: number | null) => {
    if (price === null || price === undefined) return 'N/A';
    if (price < 1) {
      // Very low priced assets (HBAR etc.) → 6 decimals for prediction accuracy (matches resolver PRIMARY source)
      return price.toFixed(6);
    }
    // Higher priced assets → show 3 decimals for better accuracy (e.g. SOL)
    return price.toFixed(3);
  };

  const activePredSorted = React.useMemo(() => {
    return activeMarkets
      .filter((m: any) => !m.resolved)
      .sort((a: any, b: any) => (b.id || 0) - (a.id || 0));
  }, [activeMarkets]);

  // Most-recently-made first for the consolidated "Active markets" view (user spec: "the one that is most recently made should be the one in first que").
  // Base list is displayFastGames (already has optimistic + recentlyCreated prune + only active logic).
  // marketId format is typically "fast-<creationTsMs>" so we parse that for recency sort.
  const activeFastSorted = React.useMemo(() => {
    return [...displayFastGames].sort((a: any, b: any) => {
      const ta = parseInt((a.marketId || '').split('-')[1] || '0', 10) || ((a.endTime || 0) * 1000) || 0;
      const tb = parseInt((b.marketId || '').split('-')[1] || '0', 10) || ((b.endTime || 0) * 1000) || 0;
      return tb - ta; // desc: newest creation first
    });
  }, [displayFastGames]);

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
            <div className={`col-span-full text-center py-12 ${isDark ? 'text-white/50' : 'text-slate-400'}`}>Loading live prices...</div>
          ) : assets.length > 0 ? (
            assets.map((asset, index) => (
              <div key={index}
                className={`group rounded-3xl p-5 border transition-all hover:-translate-y-0.5 ${isDark ? 'bg-white/5 border-white/10 hover:border-[#00f9ff]/40' : 'bg-white border-slate-200 hover:border-[#00f9ff]/60 shadow-sm'}`}>
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

                {/* Two-button entry: Fast Game (short) + Prediction (long) — nice first experience, theme + VIP sensitive */}
                <div className="mt-5 pt-3 border-t border-white/10 grid grid-cols-2 gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowFastGameModal(true); }}
                    className={`py-2 rounded-2xl text-xs font-semibold tracking-wide transition-all active:scale-[0.985] flex items-center justify-center gap-1
                      ${isVIP
                        ? 'bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black vip-shimmer shadow'
                        : isDark
                          ? 'bg-[#00f9ff] text-black hover:brightness-110'
                          : 'bg-[#00f9ff] text-black hover:brightness-110'}`}
                  >
                    <Zap className="w-3 h-3" /> Fast Game
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedAsset(asset.symbol); setShowCreateModal(true); }}
                    className={`py-2 rounded-2xl text-xs font-semibold tracking-wide transition-all active:scale-[0.985] flex items-center justify-center gap-1 border
                      ${isVIP
                        ? (isDark 
                            ? 'border-white/30 text-white hover:bg-white/5 vip-shimmer' 
                            : 'border-[#00f9ff]/40 text-[#00f9ff] hover:bg-[#00f9ff]/10 vip-shimmer')
                        : isDark
                          ? 'border-white/20 text-[#00f9ff] hover:bg-white/5'
                          : 'border-slate-300 text-[#00f9ff] hover:bg-slate-50'}`}
                  >
                    <Feather className="w-3 h-3" /> Prediction
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-12 text-white/50">No assets loaded</div>
          )}
        </div>

        {/* Active markets - consolidated view (fast + prediction/long) with toggle. Most recent first. Only active (unresolved). Same timers, backend, care as before. */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight">Active markets</h3>
            </div>
            <button onClick={() => setShowFastGameModal(true)}
              className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black font-semibold hover:brightness-110">
              Create Fast Game
            </button>
          </div>

          {/* Toggle for fast / prediction / both - user friendly, theme/VIP sensitive */}
          <div className="flex gap-2 mb-4">
            {(['fast', 'prediction', 'both'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setActiveMarketFilter(f)}
                className={`px-4 py-1.5 rounded-2xl text-xs font-semibold transition-all ${activeMarketFilter === f
                  ? (isVIP ? 'bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black vip-shimmer' : 'bg-[#00f9ff] text-black')
                  : isDark ? 'bg-white/10 text-white/80 hover:bg-white/20' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {f === 'fast' ? 'Fast Games' : f === 'prediction' ? 'Prediction Markets' : 'Both'}
              </button>
            ))}
          </div>

          {/* Your recent/pending fast games — always visible to the creator immediately after payment/signing, even if the resolver is rate-limited (429), returning empty, or the direct HGraph fallback is blocked (CORS/DNS from vercel). 
              This guarantees the game "shows up" after the funds are taken / market making stake, matching the working experience from the backup. 
              The HCS record (topic CREATE + initial PLACE_BET) is still attempted in the background for official confirmation and visibility to others. */}
          {Array.from(recentlyCreatedMarketIds).some(id => id.startsWith('fast-')) && (
            <div className="mb-4 p-3 rounded-2xl border border-[#00f9ff]/40 bg-[#00f9ff]/5 text-sm">
              <div className="font-semibold text-[#00f9ff] mb-1 text-xs tracking-widest">YOUR RECENT FAST GAMES (visible to you immediately — HCS confirmation pending)</div>
              {optimisticGames.filter((g: any) => g.marketId && g.marketId.startsWith('fast-')).map((g: any) => {
                const isPending = g._pendingRecord || g._wcTimedOut || g._recordFailed;
                const statusText = g._wcTimedOut
                  ? 'WC sign timed out (check HashScan for escrow transfer) — retry below'
                  : g._recordFailed
                    ? `Record failed${g._lastRecordError ? ' — ' + String(g._lastRecordError).slice(0, 60) : ''} — retry below`
                    : (g._retrying ? 'Retrying HCS record...' : 'Confirming on HCS...');
                return (
                  <div key={g.marketId} className="py-1 border-b border-white/10 last:border-0 flex items-center justify-between gap-2">
                    <span>
                      {g.question} — {g.currentVolume || g.initialStake} HBAR on {g.direction} — {statusText}
                    </span>
                    {isPending && (
                      <button
                        onClick={() => retryRecordForGame(g)}
                        disabled={!!g._retrying}
                        className="text-[10px] px-2 py-0.5 rounded-lg bg-[#00f9ff]/20 hover:bg-[#00f9ff]/30 text-[#00f9ff] border border-[#00f9ff]/30 disabled:opacity-50"
                      >
                        {g._retrying ? 'Retrying...' : 'Retry record'}
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="text-[10px] text-white/50 mt-1">The topic messages (CREATE + initial PLACE_BET) will appear on HCS 0.0.9017517 when the record succeeds. Use Retry on timed-out/failed entries to push from escrow stake. MarketId shown in toasts.</div>
            </div>
          )}

          {/* Active list (filtered by toggle). Refresh loads both fast and long prediction wires. */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className={`text-sm font-semibold ${isDark ? 'text-white/80' : 'text-slate-700'}`}>Active Markets (Live Timers)</div>
              <button onClick={() => { loadFastGames(); loadOnChainMarkets(); }} className="text-xs px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20">Refresh</button>
            </div>

            {/* Fast games content - only for fast or both. Using pre-sorted for recent first. 
                Loading is fully background now (no visible "Loading..." message to avoid UI instability).
                New/updated games animate in with a smooth pop + slide for a polished feel. */}
            {(activeMarketFilter === 'fast' || activeMarketFilter === 'both') && (
              activeFastSorted.length === 0 ? (
                <div className={`${isDark ? 'text-white/60' : 'text-slate-500'} text-sm py-4 space-y-1`}>
                  <div>No active fast games right now.</div>
                  <div className="text-white/40 text-xs">Create one above or wait for others — games last 10m-4h and auto-settle on HCS with weighted payouts.</div>
                  <div className="text-white/40 text-xs">All activity on HCS 0.0.9017517. Check Portfolio below for your receipts.</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AnimatePresence>
                    {activeFastSorted.slice(0, 6).map((game: any) => {
                  // Strengthen 4h (and long-duration) timer enforcement in the UI.
                  // The marketId timestamp + declared durationMinutes is the reliable source of truth
                  // for when the game truly ends. Some data paths (resolver list during lag, direct HCS
                  // for games created against other resolver instances, old cached state) can under-report
                  // endTime. We compute a safeEnd from creation + duration and use it if the provided
                  // endTime is missing or way too short. This ensures the countdown, "Closes at", OPEN/CLOSED
                  // badge, betting window, and "displayed until the last second" all respect the full intended
                  // duration (especially 240min / 4h games) until the backend actually resolves it.
                  const creationTs = parseInt((game.marketId || '').split('-')[1] || '0', 10);
                  const durMin = game.durationMinutes || 10;
                  let effectiveEndTime = game.endTime || 0;
                  if (creationTs && durMin > 0) {
                    const safeEnd = Math.floor(creationTs / 1000) + durMin * 60;
                    if (!effectiveEndTime || effectiveEndTime < safeEnd - 30) {
                      effectiveEndTime = safeEnd;
                    }
                  }

                  const remaining = Math.max(0, effectiveEndTime - now);
                  const mins = Math.floor(remaining / 60);
                  const secs = remaining % 60;
                  const timeStr = remaining > 0 ? `${mins}m ${secs}s` : "EXPIRED";

                  // Prefer server-computed isBettingOpen (authoritative, includes correct durationMinutes
                  // from the CREATE memo or /create body) for reliable 50% cutoff across all durations.
                  // Fall back to client calc only if the flag is missing (older resolver responses).
                  let isBettingOpen = remaining > ((game.durationMinutes || 10) * 60 * 0.5);
                  if (game.isBettingOpen !== undefined) {
                    isBettingOpen = !!game.isBettingOpen;
                  }

                  // Informative times for the new beautiful card header (creation ts from marketId, close from endTime)
                  // Use the same creationTs we already computed for the safe endTime enforcement above.
                  const createdTime = creationTs ? new Date(creationTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
                  const closeTime = effectiveEndTime ? new Date(effectiveEndTime * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';

                  // Countdown to betting close (50% of duration) for the bottom action area
                  const durationSec = (game.durationMinutes || 10) * 60;
                  const timeToBetClose = Math.max(0, remaining - (durationSec * 0.5));
                  const betMins = Math.floor(timeToBetClose / 60);
                  const betSecs = timeToBetClose % 60;
                  const betCloseStr = timeToBetClose > 0 ? `${betMins}m ${betSecs}s` : "CLOSED";

                  return (
                    <motion.div 
                      key={game.marketId} 
                      initial={{ opacity: 0, y: 15, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      layout
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

                      {/* Strong Tier 1 confirmation: Shows right on the tile when you just predicted */}
                      {justBetGames[game.marketId] && (
                        <div className="mb-3 px-3 py-1.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-2">
                          ✓ Prediction #{(userPositions[game.marketId]?.amount || 0) > 0 ? 'updated' : 'recorded'} — {justBetGames[game.marketId].amount} HBAR on {justBetGames[game.marketId].side === 'YES' ? 'UP' : 'DOWN'}
                        </div>
                      )}

                      {/* Beautiful super-informative header per spec:
                          "Will HBAR be UP or DOWN at [time of close]?"
                          + open time + creation price + current % under it.
                          Then volume + game details row below. */}
                      <div className="mb-3">
                        <div className={`font-semibold text-[15px] leading-snug tracking-[-0.3px] ${isDark ? 'text-white' : 'text-slate-900'}`}>
                          Will HBAR be <span className="text-emerald-400 font-semibold">UP</span> or <span className="text-rose-400 font-semibold">DOWN</span> at {closeTime}?
                        </div>
                        <div className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] ${isDark ? 'text-white/65' : 'text-slate-600'}`}>
                          <span>
                            Opened <span className={`${isDark ? 'text-white/85' : 'text-slate-700'}`}>{createdTime}</span> at <span className="font-mono text-[#00f9ff]">${(game.creationPrice || 0).toFixed(6)}</span>
                          </span>
                          {liveHbarPrice != null && game.creationPrice != null && (
                            <span className="font-mono">
                              {(() => {
                                const delta = liveHbarPrice - game.creationPrice;
                                const pct = game.creationPrice > 0 ? (delta / game.creationPrice) * 100 : 0;
                                const sign = delta >= 0 ? '▲' : '▼';
                                const color = delta >= 0 ? 'text-emerald-400' : 'text-rose-400';
                                return <span className={color}>{sign} {pct.toFixed(1)}%</span>;
                              })()}
                            </span>
                          )}
                          <span>Closes <span className={`${isDark ? 'text-white/85' : 'text-slate-700'}`}>{closeTime}</span></span>
                        </div>
                      </div>

                      {/* Volume + game details row (clean, under the beautiful header) */}
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <div className={`text-[10px] uppercase tracking-[1px] ${isDark ? 'text-white/50' : 'text-slate-500'}`}>Volume</div>
                          <div className={`flex items-center gap-2 font-semibold tabular-nums ${isDark ? 'text-white' : 'text-slate-900'}`}>
                            <span>{(game.currentVolume || 0).toFixed(1)} HBAR</span>
                            {game._lastReconciled && Date.now() - game._lastReconciled < 30000 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">LIVE</span>
                            )}
                          </div>
                        </div>
                        {recentlyCreatedMarketIds.has(game.marketId) && (
                          <button
                            onClick={() => reconcileMarketVolume(game.marketId)}
                            className={`text-[10px] px-2 py-1 rounded-xl transition-colors ${isDark ? 'bg-white/10 hover:bg-white/20 text-white/70 hover:text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-600 hover:text-slate-900'}`}
                            title="Reconcile live volume from HCS"
                          >
                            Reconcile
                          </button>
                        )}
                      </div>

                      {/* UP / DOWN Volume Ratio (first small visual improvement) */}
                      {(() => {
                        const yesStake = game.yesStake ?? 0;
                        const noStake = game.noStake ?? 0;
                        const total = yesStake + noStake;

                        if (total <= 0) return null;

                        const yesPercent = Math.round(((yesStake) / total) * 100);
                        const noPercent = 100 - yesPercent;

                        return (
                          <div className="mb-4">
                            <div className={`flex justify-between text-[10px] tracking-widest mb-1.5 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
                              <div className="text-emerald-400">UP {yesPercent}%</div>
                              <div className="text-rose-400">DOWN {noPercent}%</div>
                            </div>
                            <div className={`h-2.5 rounded-full overflow-hidden flex ${isDark ? 'bg-white/10' : 'bg-slate-200'}`}>
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
                            {/* User counts + sides (data from resolver volume enrichment) */}
                            <div className={`flex justify-between text-[9px] mt-0.5 ${isDark ? 'text-white/60' : 'text-slate-500'}`}>
                              <div>{(game.yesParticipants || 0)} users</div>
                              <div>{(game.noParticipants || 0)} users</div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Tier 2 #1: Live "Your Impact" — instrumental improvement for smoke tests */}
                      {(() => {
                        const stake = gameStakes[game.marketId] || 10;
                        const yesStake = game.yesStake ?? 0;
                        const noStake = game.noStake ?? 0;

                        if (stake <= 0) return null;

                        const yesImpact = (yesStake + stake) > 0 
                          ? (((stake) / (yesStake + stake)) * 100).toFixed(1) 
                          : '100';
                        const noImpact = (noStake + stake) > 0 
                          ? (((stake) / (noStake + stake)) * 100).toFixed(1) 
                          : '100';

                        return (
                          <div className={`mb-3 px-2 py-1.5 rounded-xl border text-[10px] ${isDark ? 'bg-white/5 border-white/10 text-white/70' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
                            Adding <span className={`font-mono font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>{stake}</span> HBAR would give you 
                            ~<span className="font-semibold text-emerald-400">{yesImpact}%</span> of the UP pool or 
                            ~<span className="font-semibold text-rose-400">{noImpact}%</span> of the DOWN pool
                          </div>
                        );
                      })()}

                      {/* Tier 1 UX: Your Position on this game (very high value for smoke tests) */}
                      {userPositions[game.marketId] && (
                        <div className={`mb-4 px-3 py-2 rounded-2xl border text-sm ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
                          <span className={`text-xs tracking-widest ${isDark ? 'text-white/50' : 'text-slate-500'}`}>YOUR POSITION</span>
                          <div className={`font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                            {userPositions[game.marketId].amount} HBAR on <span className={userPositions[game.marketId].side === 'YES' ? 'text-emerald-400' : 'text-rose-400'}>{userPositions[game.marketId].side === 'YES' ? 'UP' : 'DOWN'}</span>
                          </div>
                        </div>
                      )}

                      {/* Basic graceful resolution notice (Tier 1) - shows outcome briefly if we have resolution data */}
                      {game.resolutionWinner && (
                        <div className="mb-3 px-3 py-1.5 rounded-2xl bg-[#00f9ff]/10 border border-[#00f9ff]/30 text-[#00f9ff] text-xs font-semibold">
                          RESOLVED — Winner: {game.resolutionWinner} @ ${game.closingPrice?.toFixed(6) || '—'}
                        </div>
                      )}

                      <div className="flex items-baseline justify-between mb-4">
                        <div className={`text-[28px] font-semibold tabular-nums tracking-[-1px] leading-none ${remaining < 120 ? 'text-rose-400' : 'text-[#00f9ff]'}`}>
                          {timeStr}
                        </div>
                        <div className={`text-right text-[10px] ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
                          {isBettingOpen ? (remaining < 120 ? 'Closing soon' : 'Predictions close at 50%') : 'Resolution pending'}
                        </div>
                      </div>

                      {/* Stable bottom section: always rendered with min-height to prevent card "unstable" / layout jump when the 50% betting window closes (e.g. 5min on 10m game) */}
                      <div className="pt-4 border-t border-white/10 min-h-[68px]">
                        {isBettingOpen && remaining > 30 && hashPackSession?.accountId ? (
                          <>
                            {/* Stake input field (replaces quick picks) + slider (betting bar stays) */}
                            {/* User can type any amount up to (wallet balance - ~3 HBAR for fees/gas) */}
                            {/* HARD-CODED SAFETY NET (live, real-time): Max bet + per-wallet count + disable + warnings */}
                            {(() => {
                              const pot = (game.yesStake || 0) + (game.noStake || 0);
                              const durSec = (game.durationMinutes || 10) * 60;
                              const remForHalf = Math.max(0, (game.endTime || 0) - now);
                              const isPastHalf = remForHalf <= durSec * 0.5;
                              let maxAllowed = isPastHalf
                                ? Math.max(1, Math.floor(pot * 0.40 * 100) / 100)
                                : Math.max(1, Math.floor(pot * 1.25 * 100) / 100);
                              // Also respect wallet balance buffer (UX only — resolver re-validates everything)
                              const walletCap = fastGameMaxBalance != null ? fastGameMaxBalance : 9999;
                              maxAllowed = Math.min(maxAllowed, walletCap);
                              const currentStakeVal = gameStakes[game.marketId] || 10;
                              const myCount = myBetCounts[game.marketId] || 0;
                              // Display uses the higher creator cap (5). Backend safety validator strictly enforces 3 for normal players vs 5 for the on-chain creator.
                              const limitForDisplay = 5;
                              const overLimit = currentStakeVal > maxAllowed + 0.009;
                              const betsExhausted = myCount >= limitForDisplay;

                              return (
                                <>
                                  <div className="mb-2">
                                    <div className={`text-xs mb-1 flex items-center justify-between ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
                                      <span>Stake</span>
                                      <span className="font-mono text-[10px]">
                                        Max allowed: <span className="text-[#00f9ff]">{maxAllowed.toFixed(2)}</span> HBAR
                                        <span className="opacity-60"> {isPastHalf ? '(40% cap)' : '(1.25× pot)'}</span>
                                      </span>
                                    </div>

                                    <input
                                      type="number"
                                      min={1}
                                      max={walletCap}
                                      step={1}
                                      value={currentStakeVal}
                                      onChange={(e) => {
                                        const raw = parseFloat(e.target.value);
                                        let v = isNaN(raw) ? 1 : raw;
                                        v = Math.max(1, v);
                                        const max = walletCap;
                                        const clamped = Math.min(max, v);
                                        const final = Math.round(clamped * 100) / 100;
                                        setGameStakes(prev => ({ ...prev, [game.marketId]: final }));
                                      }}
                                      placeholder="enter amount"
                                      className={`w-full px-3 py-1.5 text-sm rounded-xl focus:border-[#00f9ff]/50 outline-none font-mono ${isDark ? 'bg-white/5 border-white/10 text-white placeholder:text-white/40' : 'bg-slate-100 border-slate-300 text-slate-900 placeholder:text-slate-400'}`}
                                    />

                                    {/* Live safety status line (centered, prominent per prior UX direction) */}
                                    <div className={`mt-1 text-center text-[11px] font-medium ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
                                      You have placed <span className="font-mono">{myCount}</span>/{limitForDisplay} bets in this market
                                      {betsExhausted && <span className="ml-1 text-rose-400">(limit reached)</span>}
                                    </div>

                                    {/* Clear, actionable warning when user exceeds a rule */}
                                    {(overLimit || betsExhausted) && (
                                      <div className="mt-1.5 px-2 py-1 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[10px] text-center">
                                        {overLimit && `Exceeds max: ${maxAllowed.toFixed(2)} HBAR. `}
                                        {betsExhausted && 'Wallet bet limit reached for this game. '}
                                        {isPastHalf ? 'Whale cap active after halfway.' : '1.25× pot limit until halfway.'}
                                      </div>
                                    )}
                                  </div>

                                  <Slider
                                    min={1}
                                    max={walletCap > 10 ? walletCap : 500}
                                    step={1}
                                    value={[currentStakeVal]}
                                    onValueChange={(vals) => {
                                      const v = Math.max(1, vals[0] || 1);
                                      const clamped = walletCap != null ? Math.min(walletCap, v) : v;
                                      setGameStakes(prev => ({ ...prev, [game.marketId]: clamped }));
                                    }}
                                    className="mb-2"
                                  />

                                  <div className={`text-center text-xs mb-1.5 ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
                                    Bet closes in {betCloseStr}
                                  </div>

                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleFastBet(game, 'YES')}
                                      disabled={overLimit || betsExhausted}
                                      className="flex-1 py-2.5 text-sm rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.985] text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      UP
                                    </button>
                                    <button
                                      onClick={() => handleFastBet(game, 'NO')}
                                      disabled={overLimit || betsExhausted}
                                      className="flex-1 py-2.5 text-sm rounded-2xl bg-red-600 hover:bg-red-500 active:scale-[0.985] text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      DOWN
                                    </button>
                                  </div>
                                </>
                              );
                            })()}
                          </>
                        ) : (
                          <div className={`text-center text-xs py-2 ${isDark ? 'text-white/60' : 'text-slate-500'}`}>
                            {isBettingOpen ? 'Betting open' : 'Betting closed — resolution in progress'}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                } ) }
                  </AnimatePresence>
              </div>
            ))}

            {/* Prediction markets (consolidated toggle view) */}

              {(activeMarketFilter === 'prediction' || activeMarketFilter === 'both') && activePredSorted.length === 0 && activeMarketFilter === 'prediction' && (
              <div className={`${isDark ? 'text-white/60' : 'text-slate-500'} text-sm py-4`}>No active prediction markets right now.</div>
            )}
            {(activeMarketFilter === 'prediction' || activeMarketFilter === 'both') && activePredSorted.length > 0 && (
              <div className="mt-4">
                {activeMarketFilter === 'both' && (
                  <div className={`text-sm font-semibold mb-2 ${isDark ? 'text-white/80' : 'text-slate-700'}`}>Prediction Markets</div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activePredSorted.slice(0, 6).map((m: any) => {
                      const remaining = m.endTime ? Math.max(0, m.endTime - Math.floor(Date.now() / 1000)) : 0;
                      const mins = Math.floor(remaining / 60);
                      const timeStr = remaining > 0 ? `${mins}m` : 'EXPIRED';
                      return (
                        <div
                          key={m.marketId || m.id}
                          onClick={() => openBetModal(m)}
                          className={`group rounded-3xl border p-5 transition-all cursor-pointer ${isDark ? 'border-white/10 bg-white/5 hover:bg-white/[0.08]' : 'border-slate-200 bg-white shadow-sm hover:shadow-md'} ${isVIP ? 'vip-glass vip-shimmer ring-1 ring-white/10' : ''}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-mono text-[10px] text-white/50 tracking-[0.5px]">{m.asset} • {m.marketId}</div>
                            <div className={`text-[10px] px-2.5 py-0.5 rounded-full font-medium ${remaining > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                              {remaining > 0 ? 'OPEN' : 'CLOSED'}
                            </div>
                          </div>
                          <div className="font-semibold text-[15px] leading-tight tracking-[-0.2px] mb-2 pr-1 line-clamp-2">{m.question}</div>
                          <div className="text-sm mb-1">~{timeStr} • {m.volume} vol • {m.totalBets} bets</div>
                          <div className="mt-2 text-xs text-[#00f9ff] group-hover:underline">Place bet on this market →</div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Tier 2 #2: Recent Outcomes strip — social proof for smoke tests */}
        {recentOutcomes.length > 0 && (
          <div className="mt-6">
            <div className="text-sm font-semibold text-white/70 mb-3">Recent Outcomes</div>
            <div className="flex flex-wrap gap-2">
              {recentOutcomes.map((outcome, idx) => (
                <div key={idx} className="px-3 py-1.5 rounded-2xl bg-white/5 border border-white/10 text-xs">
                  <span className="font-mono text-white/60 mr-2">{outcome.marketId}</span>
                  <span className={outcome.winner === 'YES' ? 'text-emerald-400' : 'text-rose-400'}>
                    {outcome.winner} WIN
                  </span>
                  {outcome.multiple && (
                    <span className="text-white/60 ml-2">({outcome.multiple}x)</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fast Game Updates section fully removed - now consolidated into the "Active markets" section above (active only, recent-first via toggle). */}

        {/* Portfolio Dropdown */}
        <div className="mt-10 border-t border-white/10 pt-8">
          <button
            onClick={() => {
              const next = !portfolioOpen;
              setPortfolioOpen(next);
              if (next && hashPackSession?.accountId) loadMyClaimsAndHistory(true); // explicit open → fresh data from resolver belt
            }}
            className={`w-full flex items-center justify-between rounded-2xl px-6 py-4 text-left border transition-colors ${isDark 
              ? 'bg-white/5 hover:bg-white/10 border-white/10' 
              : 'bg-slate-100 hover:bg-slate-200 border-slate-200'}`}
          >
            <div>
              <div className={`font-semibold text-xl tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>My Prediction Portfolio &amp; Claim Center</div>
              <div className={`text-sm ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
                Private • All activity cryptographically anchored to HCS 0.0.9017517 • Wins, losses &amp; unmatched returns tracked
              </div>
            </div>
            <div className={`text-2xl transition-transform ${isDark ? 'text-white/70' : 'text-slate-500'} ${portfolioOpen ? 'rotate-180' : ''}`}>⌄</div>
          </button>

          {portfolioOpen && (
            <div className={`mt-4 rounded-3xl border p-6 space-y-6 ${isDark ? 'border-white/10 bg-[#0a0c17]' : 'border-slate-200 bg-white shadow-sm'}`}>
              {/* FULLY WIRED STAGE 1 PANEL — 100% real HCS data via reliable topic fetch + resolver (no mocks) • Premium light + dark support */}
              <div className={`flex items-center justify-between pb-3 border-b ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <div>
                  <div className={`font-semibold text-xl tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>My Prediction Games • Private Ledger</div>
                  <div className={`text-xs tracking-[1.5px] mt-0.5 ${isDark ? 'text-white/60' : 'text-slate-600'}`}>ALL WINS, LOSSES &amp; PAYOUTS • 100% FROM HCS 0.0.9017517</div>
                </div>
                <a 
                  href="https://hashscan.io/testnet/topic/0.0.9017517/messages" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className={`text-xs px-4 py-1.5 rounded-2xl border transition-colors font-medium ${isDark ? 'border-white/20 hover:bg-white/5 text-[#00f9ff] hover:text-[#00f9ff]' : 'border-slate-200 hover:bg-slate-100 text-[#00f9ff] hover:text-[#00d4ff]'}`}
                >
                  VIEW MASTER TOPIC →
                </a>
              </div>

              {/* Stable data collection status — shows the resolver belt + cache health */}
              <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-2xl ${isDark ? 'bg-white/5' : 'bg-slate-200'} mb-2`}>
                <div className={`${isDark ? 'text-white/75' : 'text-slate-700'} flex items-center gap-2`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${portfolioCacheStatus === 'live' ? 'bg-emerald-400' : portfolioCacheStatus === 'cached' ? 'bg-[#00f9ff]' : 'bg-amber-400'}`} />
                  {lastPortfolioSync > 0 ? (
                    <>Synced <span className="tabular-nums font-medium">{Math.max(0, Math.floor((Date.now() - lastPortfolioSync) / 1000))}</span>s ago via resolver <span className="opacity-70">({portfolioCacheStatus === 'stale' ? 'cached' : portfolioCacheStatus})</span></>
                  ) : (
                    'Connecting to resolver belt…'
                  )}
                </div>
                <button
                  onClick={() => loadMyClaimsAndHistory(true)}
                  disabled={isLoadingMyPortfolio}
                  className={`flex items-center gap-1 px-3 py-1 rounded-xl border transition ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-slate-300 hover:bg-white'} disabled:opacity-50`}
                  title="Force fresh pull from resolver (bypasses cache)"
                >
                  <RefreshCw size={12} className={isLoadingMyPortfolio ? 'animate-spin' : ''} />
                  <span>Refresh</span>
                </button>
              </div>
              {isLoadingMyPortfolio ? (
                <div className={`${isDark ? 'text-white/70' : 'text-slate-600'}`}>Loading your prediction history...</div>
              ) : !hashPackSession?.accountId ? (
                <div className={`${isDark ? 'text-white/70' : 'text-slate-600'} italic`}>Connect your wallet to see your personal claimable winnings.</div>
              ) : (
                <>
                  {/* Premium Portfolio Summary — perfectly matched site typography & colors */}
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                    <div>
                      <div className={`text-[10px] uppercase tracking-[1.5px] ${isDark ? 'text-white/60' : 'text-slate-600'}`}>LIFETIME P&amp;L (FROM HCS)</div>
                      <div className="text-4xl font-semibold tabular-nums tracking-[-1.5px] text-emerald-400">
                        {myHistory.reduce((sum, g) => sum + ((g.claimedAmount || g.claimable || 0) - (g.myStake || 0)), 0).toFixed(2)} HBAR
                      </div>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <div>
                        <div className={`${isDark ? 'text-white/60' : 'text-slate-600'} text-xs tracking-widest`}>GAMES PLAYED</div>
                        <div className={`text-3xl font-semibold tabular-nums ${isDark ? 'text-white' : 'text-slate-900'}`}>{myHistory.length}</div>
                      </div>
                      <div>
                        <div className={`${isDark ? 'text-white/60' : 'text-slate-600'} text-xs tracking-widest`}>WIN RATE</div>
                        <div className="text-3xl font-semibold tabular-nums text-[#00f9ff]">
                          {myHistory.length > 0 
                            ? Math.round((myHistory.filter(g => g.userWon || (g.actualPaid || 0) > (g.myStake || 0)).length / myHistory.length) * 100) 
                            : 0}%
                        </div>
                      </div>
                      <div>
                        <div className={`${isDark ? 'text-white/60' : 'text-slate-600'} text-xs tracking-widest`}>CLAIMABLE NOW</div>
                        <div className="text-3xl font-semibold tabular-nums text-emerald-400">
                          {myClaimables.reduce((sum, g) => sum + (g.claimable || 0), 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Claimables section - exact site text style + cyan/rose accents */}
                  <div>
                    <div className="font-semibold text-emerald-400 mb-3 tracking-[1.5px] text-sm">CLAIMABLE WINNINGS</div>
                    <div className={`text-xs -mt-2 mb-3 ${isDark ? 'text-white/60' : 'text-slate-600'}`}>Auto-paid games appear in your receipts below</div>
                    {myClaimables.length === 0 ? (
                      <div className={`${isDark ? 'text-white/60' : 'text-slate-600'} text-sm`}>No pending manual claims. Most fast games auto-settle ~28s after resolution.</div>
                    ) : (
                      <div className="space-y-3">
                        {myClaimables.map((game, idx) => (
                          <div key={idx} className={`rounded-3xl border p-5 flex flex-col lg:flex-row gap-5 items-center ${isDark ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-emerald-200 bg-emerald-50/70'}`}>
                            <div className="flex-1">
                              <div className="font-semibold">{game.question}</div>
                              <div className="text-[10px] font-mono text-white/40">{game.marketId}</div>
                            </div>
                            <div className="flex gap-8 text-sm">
                              <div><div className="text-[10px] text-white/50">YOUR STAKE</div><div className="font-semibold">{game.myStake} HBAR</div></div>
                              <div><div className="text-[10px] text-white/50">YOU RECEIVE</div><div className="text-2xl font-semibold text-emerald-400 tabular-nums">{game.claimable} HBAR</div></div>
                            </div>
                            <button onClick={() => claimFastGamePayout(game)} className="px-8 py-3 rounded-2xl font-semibold bg-emerald-500 text-black hover:bg-emerald-400 active:scale-[0.985] transition-all">Claim Now</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Search + Export + Filters (Step 5 polish) */}
                  <div className="flex flex-col md:flex-row md:items-center gap-3 pt-2">
                    <input
                      type="text"
                      value={receiptSearch}
                      onChange={(e) => setReceiptSearch(e.target.value)}
                      placeholder="Search by market ID or side..."
                      className={`flex-1 rounded-2xl px-4 py-2 text-sm placeholder:text-white/40 focus:outline-none focus:border-[#00f9ff]/50 ${isDark ? 'bg-white/5 border border-white/20' : 'bg-slate-100 border border-slate-200 text-slate-900'}`}
                    />
                    
                    <button
                      onClick={() => {
                        const rows = myHistory.map(g => ({
                          marketId: g.marketId,
                          side: g.userSide,
                          stake: g.myStake,
                          betSequence: g.betSequence || '',
                          creationPrice: g.creationPrice || '',
                          closingPrice: g.closingPrice || '',
                          resolutionWinner: g.resolutionWinner || '',
                          actualPaid: g.actualPaid || g.claimedAmount || 0,
                          profitMultiple: g.profitMultiple || '',
                          payoutTxId: g.payoutTxId || '',
                          userWon: g.userWon ? 'WIN' : (g.resolved ? 'LOSS' : 'PENDING'),
                        }));

                        const csv = [
                          Object.keys(rows[0] || {}).join(','),
                          ...rows.map(r => Object.values(r).join(','))
                        ].join('\n');

                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `wrappdex-prediction-audit-${new Date().toISOString().slice(0,10)}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className={`px-5 py-2 rounded-2xl text-sm font-semibold flex items-center gap-2 active:scale-[0.985] transition-all ${isVIP 
                        ? 'bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black vip-shimmer' 
                        : isDark 
                          ? 'border border-white/20 hover:bg-white/5 text-white' 
                          : 'border border-slate-200 hover:bg-slate-100 text-slate-700'}`}
                    >
                      EXPORT FULL AUDIT (CSV)
                    </button>
                  </div>

                  {/* Receipt Filters — premium gradient matching site CTA (cyan/violet or pink for Losses), VIP gated shimmer */}
                  <div className="flex flex-wrap gap-2">
                    {(['ALL', 'WINS', 'LOSSES', 'UNMATCHED'] as const).map((f) => {
                      const isActive = activeReceiptFilter === f;
                      let activeClasses = '';

                      if (isActive) {
                        if (f === 'LOSSES') {
                          // Pink mode for Losses
                          activeClasses = isVIP 
                            ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white vip-shimmer ring-1 ring-white/30' 
                            : 'bg-gradient-to-r from-rose-500 to-pink-500 text-white';
                        } else {
                          // Blue/cyan gradient matching Create Fast Game button
                          activeClasses = isVIP 
                            ? 'bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black vip-shimmer ring-1 ring-white/30' 
                            : 'bg-gradient-to-r from-[#00f9ff] to-[#7c3aed] text-black';
                        }
                      }

                      return (
                        <button
                          key={f}
                          onClick={() => setActiveReceiptFilter(f)}
                          className={`px-4 py-1.5 text-xs rounded-2xl border transition-all font-medium ${isActive 
                            ? activeClasses 
                            : isDark 
                              ? 'border-white/20 text-white/70 hover:text-white hover:bg-white/5' 
                              : 'border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
                        >
                          {f === 'ALL' ? 'All Predictions' : f === 'WINS' ? 'Wins' : f === 'LOSSES' ? 'Losses' : 'Unmatched Returns'}
                        </button>
                      );
                    })}
                  </div>

                  <PredictionHistory 
                    myHistory={myHistory
                      .filter(g => {
                        if (activeReceiptFilter === 'ALL') return true;
                        if (activeReceiptFilter === 'WINS') return g.userWon === true || (g.actualPaid || 0) > (g.myStake || 0);
                        if (activeReceiptFilter === 'LOSSES') return g.resolved && (g.actualPaid || 0) === 0 && (g.myStake || 0) > 0;
                        if (activeReceiptFilter === 'UNMATCHED') return (g.actualPaid || 0) === (g.myStake || 0) && (g.myStake || 0) > 0;
                        return true;
                      })
                      .filter(g => {
                        if (!receiptSearch) return true;
                        const q = receiptSearch.toLowerCase();
                        return (
                          g.marketId?.toLowerCase().includes(q) ||
                          g.userSide?.toLowerCase().includes(q)
                        );
                      })
                    } 
                    isDark={isDark} 
                    isVIP={isVIP} 
                    showToast={showToast} 
                  />

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

      {/* Fast Game Create Modal — premium bank-grade UX with live balance, 4 durations, slider, etc. */}
      {showFastGameModal && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4" onClick={() => setShowFastGameModal(false)}>
          <div 
            className={`rounded-3xl w-full max-w-[480px] max-h-[92vh] flex flex-col overflow-hidden ${isDark ? 'bg-[#0a0c17] border-white/10' : 'bg-white'}`} 
            onClick={e => e.stopPropagation()}
          >

            {/* Header - fixed */}
            <div className="flex-none p-5 pb-3">
              {/* Dynamic WRAPpDEX Logo (smaller to save space) */}
              <div className="flex justify-center mb-2">
                <HolidayLogo 
                  defaultDarkSrc={brandLogos.dark} 
                  defaultLightSrc={brandLogos.light} 
                  isDark={isDark} 
                  alt="WRAPpDEX" 
                  imgClassName="h-20 w-auto object-contain"
                  holidayImgClassName="h-20 w-auto object-contain"
                />
              </div>

              <div className="relative text-center">
                <button 
                  onClick={() => setShowFastGameModal(false)} 
                  className="absolute right-0 top-1 text-white/70 hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
                <div className="font-bold text-2xl tracking-tight">
                  <span className="text-emerald-400">UP</span> or <span className="text-rose-400">DOWN</span>
                </div>
                <div className={`mt-0.5 text-3xl font-semibold tabular-nums ${isDark ? 'text-[#00f9ff]' : 'text-blue-600'}`}>
                  ${(modalHbarPrice ?? assets.find(a => a.symbol === 'HBAR')?.price ?? 0).toFixed(6)}
                </div>
                {(() => {
                  const hbar = assets.find(a => a.symbol === 'HBAR');
                  const ch = hbar?.change24h;
                  if (typeof ch !== 'number') return null;
                  const pos = ch >= 0;
                  return (
                    <div className="mt-2 text-center">
                      <div className={`text-lg font-semibold ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pos ? '+' : ''}{ch.toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-white/50">24h (CoinGecko)</div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-auto px-5 space-y-3 pb-1 text-sm">
              {/* Duration - Minimal & Clean */}
              <div>
                <div className={`text-xs font-medium tracking-[1px] mb-2 ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
                  GAME DURATION
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[10, 20, 60, 240].map((mins) => {
                    const isActive = fastGameDuration === mins;
                    const predictMins = Math.floor(mins / 2);
                    const label = mins >= 60 ? `${mins/60}h` : `${mins}m`;
                    return (
                      <button
                        key={mins}
                        onClick={() => setFastGameDuration(mins as 10 | 20 | 60 | 240)}
                        className={`p-3 rounded-2xl transition-all border text-center
                          ${isActive 
                            ? 'bg-[#00f9ff] text-black border-[#00f9ff] shadow-lg' 
                            : isDark 
                              ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/90' 
                              : 'bg-gray-100 border-gray-200 hover:bg-gray-200 text-gray-800'
                          }`}
                      >
                        <div className="text-xl font-bold tabular-nums tracking-tighter">
                          {label}
                        </div>
                        <div className="text-[9px] opacity-70 leading-none">close ~{predictMins}m</div>
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
                <div className="flex gap-3">
                  {/* YES / ABOVE */}
                  <button
                    onClick={() => setFastGameSide('YES')}
                    className={`flex-1 py-3 rounded-2xl text-sm font-semibold transition-all border flex flex-col items-center justify-center
                      ${fastGameSide === 'YES' 
                        ? 'bg-[#00f9ff] text-black border-[#00f9ff] shadow-lg' 
                        : isDark 
                          ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/90' 
                          : 'bg-gray-100 border-gray-200 hover:bg-gray-200'
                      }`}
                  >
                    <div className="font-bold tracking-widest">ABOVE</div>
                    <div className="text-[9px] opacity-70 -mt-0.5">the current price</div>
                  </button>

                  {/* NO / BELOW */}
                  <button
                    onClick={() => setFastGameSide('NO')}
                    className={`flex-1 py-3 rounded-2xl text-sm font-semibold transition-all border flex flex-col items-center justify-center
                      ${fastGameSide === 'NO' 
                        ? 'bg-rose-500 text-white border-rose-500 shadow-lg' 
                        : isDark 
                          ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/90' 
                          : 'bg-gray-100 border-gray-200 hover:bg-gray-200'
                      }`}
                  >
                    <div className="font-bold tracking-widest">BELOW</div>
                    <div className="text-[9px] opacity-70 -mt-0.5">the current price</div>
                  </button>
                </div>
              </div>

              {/* Game Rules — clean, collapsible "pop down" experience.
                  Quick scannable rules + advanced factual breakdown sheet.
                  Uses only precise, serious language ("prediction", "stake", "pool", "resolution").
                  No hype, no betting jargon, no "ai slop". */}
              <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
                <button
                  onClick={() => setShowGameRules(!showGameRules)}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium tracking-[0.5px] transition-colors ${isDark ? 'text-white/90 hover:bg-white/5' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  <span>Game Rules</span>
                  <span className={`text-xs opacity-60 transition-transform ${showGameRules ? 'rotate-180' : ''}`}>▼</span>
                </button>

                {showGameRules && (
                  <div className="px-4 pb-4 space-y-4 text-xs border-t border-white/10 dark:border-white/10">
                    {/* Quick Rules — short, clear, scannable */}
                    <div>
                      <div className={`font-semibold mb-1.5 text-[11px] tracking-wider ${isDark ? 'text-white/70' : 'text-slate-500'}`}>
                        QUICK RULES
                      </div>
                      <ul className={`space-y-1 leading-snug ${isDark ? 'text-white/85' : 'text-slate-700'}`}>
                        <li>• A prediction game runs for the duration you select.</li>
                        <li>• New predictions can be placed until halfway through the game.</li>
                        <li>• Your stake is added to the total pool on the side you select (UP or DOWN).</li>
                        <li>• At resolution the matching side receives a proportional share of the opposing pool.</li>
                        <li>• A 2% facilitation fee applies only to payouts when there was opposing stake in the game, taken at the time of claim.</li>
                      </ul>
                    </div>

                    {/* Advanced Details — precise, serious, truth-only breakdown */}
                    <div>
                      <div className={`font-semibold mb-1.5 text-[11px] tracking-wider ${isDark ? 'text-white/70' : 'text-slate-500'}`}>
                        ADVANCED DETAILS
                      </div>
                      <div className={`space-y-1.5 leading-snug text-[11px] ${isDark ? 'text-white/75' : 'text-slate-600'}`}>
                        <div>
                          <span className="font-medium">Stake limit per prediction:</span> Before the halfway point the maximum stake is 1.25× the current total staked in the game. After the halfway point the limit is 40% of the current total staked.
                        </div>
                        <div>
                          <span className="font-medium">Account limits:</span> A standard account may place a maximum of 3 predictions in one game. The account that created the game may place up to 5 predictions (the initial stake counts as the first).
                        </div>
                        <div>
                          <span className="font-medium">Minimum to create a game:</span> 25 HBAR. This requirement is enforced by the resolver.
                        </div>
                        <div>
                          <span className="font-medium">Facilitation fee:</span> 2% of the final payout amount is sent to the treasury when a participant claims — but only when the game had real opposing stake (matched predictions). Pure unmatched returns (no one took the other side) return the full original stake with no fee. No variable fee is collected when staking or creating a game.
                        </div>
                        <div>
                          <span className="font-medium">Enforcement &amp; records:</span> Limits and settlement are validated by the resolver before any record is written. Every prediction, resolution, and payout is permanently logged on Hedera Consensus Service topic 0.0.9017517. The resolver is the single source of truth.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Stake input + slider (cleaned: removed quick presets + helper text; min 25 hidden rule; placeholder for free entry; keep input + slider) */}
              <div>
                <div className={`text-xs font-medium tracking-[1px] mb-2 ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
                  YOUR INITIAL STAKE (HBAR)
                </div>

                <div className={`flex items-center rounded-2xl border px-4 py-3 mb-2 ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-100'}`}>
                  <input 
                    type="number" 
                    value={fastGameStake} 
                    min={25}
                    max={fastGameMaxBalance || undefined}
                    placeholder="enter amount"
                    onChange={(e) => {
                      const raw = parseFloat(e.target.value);
                      if (isNaN(raw)) {
                        setFastGameStake(25);
                      } else {
                        const clamped = fastGameMaxBalance != null ? Math.min(fastGameMaxBalance, Math.max(25, raw)) : Math.max(25, raw);
                        setFastGameStake(clamped);
                      }
                    }}
                    className={`flex-1 bg-transparent text-xl font-mono focus:outline-none tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}
                  />
                  <span className={`ml-2 text-sm ${isDark ? 'text-white/60' : 'text-gray-500'}`}>HBAR</span>
                </div>

                {/* Custom Slider (min 25 hidden, up to real balance via Mirror) */}
                <Slider
                  min={25}
                  max={fastGameMaxBalance && fastGameMaxBalance > 25 ? fastGameMaxBalance : 1000}
                  step={0.1}
                  value={[fastGameStake]}
                  onValueChange={(vals) => {
                    const v = Math.max(25, vals[0] || 25);
                    const clamped = fastGameMaxBalance != null ? Math.min(fastGameMaxBalance, v) : v;
                    setFastGameStake(clamped);
                  }}
                  className="mb-3"
                />
              </div>

              {/* Tier 2: Clear Fee Breakdown - premium, exact, and honest (matches site aesthetic) */}
              {/* Fee structure: 2% facilitation (only on matched payouts) is taken ONLY at final payout/claim. No variable % on stake or creation. Fixed 2.50 HBAR is the creation + HCS audit trail cost. */}
              <div className={`p-4 rounded-2xl text-sm border ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Total Cost Breakdown</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className={isDark ? 'text-white/70' : 'text-gray-600'}>Your Initial Stake (min 25 HBAR)</span>
                    <span className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{fastGameStake} HBAR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={isDark ? 'text-white/70' : 'text-gray-600'}>2% Facilitation Fee</span>
                    <span className={`font-mono font-medium ${isDark ? 'text-white/70' : 'text-gray-600'}`}>0 now — taken only at payout/claim</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={isDark ? 'text-white/70' : 'text-gray-600'}>Creation Fee (Resolver + Permanent HCS Audit Trail)</span>
                    <span className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>2.50 HBAR</span>
                  </div>
                  <div className={`flex justify-between pt-2 mt-1 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                    <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Total to Pay Now</span>
                    <span className="font-mono font-semibold text-[#00f9ff]">{(fastGameStake + 2.5).toFixed(2)} HBAR</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Fixed footer with action button - always visible */}
            <div className="flex-none p-5 pt-3 border-t border-white/10 bg-inherit">
              <button
                onClick={async () => {
                  const session = hashPackSession;
                  if (!session?.accountId) {
                    alert("Please connect your wallet first.");
                    return;
                  }

                  setIsCreatingFastGame(true);

                  try {
                    // Pre-payment reachability probe: fail fast with exact URL so user never pays into escrow
                    // when the create-to-HCS wire (RESOLVER_BASE) is broken (stale Railway hostname, missing VITE_RESOLVER_URL, etc.).
                    try {
                      const probe = await fetch(`${RESOLVER_BASE}/api/price/hbar`, { method: 'HEAD' });
                      if (!probe.ok) throw new Error(`status ${probe.status}`);
                    } catch (probeErr: any) {
                      const msg = `Resolver not reachable at ${RESOLVER_BASE}. Payment would succeed but record (HCS CREATE + register) would fail. Set VITE_RESOLVER_URL to the current Railway URL (e.g. https://wrapparea51-production.up.railway.app) in Vercel and redeploy frontend.`;
                      showToast(msg, 'error');
                      console.error('[Predict] Resolver probe failed before create payment:', RESOLVER_BASE, probeErr?.message || probeErr);
                      setIsCreatingFastGame(false);
                      return;
                    }

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
                    // Note: The variable 2% facilitation fee is applied ONLY at payout/claim time (and only when there was opposing stake).
                    // No % of stake is taken on creation or individual predictions. The 2.5 HBAR is a separate fixed creation/audit fee.
                    await withSigning(`Paying total (${(fastGameStake + 2.5).toFixed(2)} HBAR)...`, async () => {
                      await signAndExecuteTransaction(
                        session.wcTopic,
                        'testnet',
                        session.accountId,
                        paymentBytes
                      );
                      return "payment-sent";
                    });

                    // Payment succeeded — unblock UI *immediately* so user never sees stuck "Waiting for signature..." after the actual sign.
                    // The record to HCS (to start the topic) is now background / best-effort so the game card appears right away for the creator (matching the "working extremely well" experience from the backup).
                    setIsCreatingFastGame(false);

                    // Add pending optimistic card + recently + myBetCounts *right after payment* (visible in "Your recent fast games" section and main list).
                    // This guarantees the game "shows up" after funds are taken / market making stake, even if resolver is busy (429), slow, or record fails transiently.
                    const pendingMarketId = `fast-${Date.now()}`;
                    const pendingSideLabel = fastGameSide === 'YES' ? 'Higher' : 'Lower';
                    const pendingDurationLabel = `${fastGameDuration} min`;
                    const pendingEstimated = new Date(Date.now() + fastGameDuration * 60 * 1000);
                    const pendingTimeLabel = pendingEstimated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const pendingQuestion = `Will HBAR price be ${pendingSideLabel} than the current price at resolution? (~${pendingDurationLabel}, est. ${pendingTimeLabel})`;
                    const approxPrice = (typeof modalHbarPrice === 'number' ? modalHbarPrice : (assets.find(a => a.symbol === 'HBAR')?.price || 0.05));

                    const pendingGame = {
                      marketId: pendingMarketId,
                      question: pendingQuestion,
                      direction: fastGameSide,
                      durationMinutes: fastGameDuration,
                      endTime: Math.floor(Date.now() / 1000) + (fastGameDuration * 60),
                      creationPrice: approxPrice,
                      currentVolume: fastGameStake,
                      resolved: false,
                      creator: session.accountId,
                      yesStake: fastGameSide === 'YES' ? fastGameStake : 0,
                      noStake: fastGameSide === 'NO' ? fastGameStake : 0,
                      yesParticipants: fastGameSide === 'YES' ? 1 : 0,
                      noParticipants: fastGameSide === 'NO' ? 1 : 0,
                      totalParticipants: 1,
                      _pendingRecord: true,
                    } as any;

                    setOptimisticGames(prev => {
                      const exists = prev.some(g => g.marketId === pendingMarketId);
                      if (exists) return prev;
                      return [pendingGame, ...prev];
                    });

                    setRecentlyCreatedMarketIds((prev: Set<string>) => {
                      const next = new Set(prev);
                      next.add(pendingMarketId);
                      try {
                        const toSave: Record<string, number> = {};
                        next.forEach(id => { toSave[id] = Date.now(); });
                        localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
                      } catch {}
                      return next;
                    });

                    setMyBetCounts(prev => ({ ...prev, [pendingMarketId]: 1 }));

                    showToast('Payment successful. Recording game to HCS in background (card visible now — topic starts on success). Resolver may be busy (429); will retry.', 'success');

                    // Record to resolver/HCS in background (non-blocking, more retries + backoff for resilience against load).
                    // If succeeds, update the pending card to confirmed.
                    // If fails after retries, card stays as pending (visible to creator), user has marketId for recovery.
                    (async () => {
                      let hbarPrice = approxPrice;
                      let creationPriceTime: string | undefined;
                      try {
                        const pRes = await fetch(`${RESOLVER_BASE}/api/price/hbar`);
                        const pJson = await pRes.json().catch(() => ({} as any));
                        hbarPrice = pJson?.price || approxPrice;
                        creationPriceTime = pJson?.priceTime || pJson?.resolvedAt;
                      } catch {}

                      const questionText = pendingQuestion;
                      let recordSuccess = false;
                      let lastRecordError = '';
                      for (let attempt = 1; attempt <= 8; attempt++) {
                        try {
                          const res = await fetch(`${RESOLVER_BASE}/api/prediction/fast-game/create`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              marketId: pendingMarketId,
                              question: questionText,
                              asset: 'HBAR',
                              endTime: Math.floor(Date.now() / 1000) + (fastGameDuration * 60),
                              durationMinutes: fastGameDuration,
                              initialSide: fastGameSide,
                              initialStake: fastGameStake,
                              creationPrice: hbarPrice,
                              creationPriceTime,
                              submittedBy: session.accountId,
                            }),
                          });
                          let data: any = {};
                          try { data = await res.json(); } catch { data = { error: `HTTP ${res.status}` }; }
                          if (res.ok && data?.success) {
                            recordSuccess = true;
                            break;
                          } else {
                            lastRecordError = data?.error || data?.stage || `status ${res.status}`;
                            if (res.status === 429) lastRecordError += ' (rate limited)';
                          }
                        } catch (e: any) {
                          lastRecordError = e?.message || 'Network error calling resolver';
                        }
                        if (attempt < 8) {
                          const isRate = lastRecordError.includes('429') || lastRecordError.includes('rate');
                          const backoff = isRate ? (6500 * attempt) : (1600 * attempt);
                          await new Promise(r => setTimeout(r, backoff));
                        }
                      }

                      if (recordSuccess) {
                        setOptimisticGames(prev => prev.map(g => g.marketId === pendingMarketId ? { ...g, creationPrice: hbarPrice, _pendingRecord: false } : g));
                        showToast('Fast Game recorded on HCS successfully! (topic started)', 'success');
                        setShowFastGameModal(false);
                        setTimeout(() => loadFastGames(), 650);
                        setTimeout(() => loadFastGames(), 2100);
                        setTimeout(() => loadFastGames(), 5500);
                      } else {
                        console.error('Fast game record failed after retries:', lastRecordError, 'marketId:', pendingMarketId, 'resolver:', RESOLVER_BASE);
                        setOptimisticGames(prev => prev.map(g => g.marketId === pendingMarketId ? { ...g, _recordFailed: true, _lastRecordError: lastRecordError } : g));
                        showToast(`Record to HCS failed after retries: ${lastRecordError}. (resolver=${RESOLVER_BASE}) Game card is visible to you (pending confirmation). Payment in escrow (0.0.9006979). MarketId: ${pendingMarketId}. Use the Retry button in YOUR RECENT section. Topic starts on success.`, 'error');
                      }
                    })();

                    // Normal refreshes (the optimistic/pending layer protects visibility)
                    setTimeout(() => loadFastGames(), 2000);
                    setTimeout(() => loadFastGames(), 6000);
                  } catch (err: any) {
                    showToast(`Creation failed: ${err?.message || err}`, 'error');
                    console.error(err);

                    // WC / relay timeout recovery path (the case hitting "still no topic, funds taken, stuck waiting, times out").
                    // Even though withSigning rejected before the happy-path pending+record code, we still generate the exact same
                    // pending card + add to recently/optimistic here so the creator sees their game immediately and can retry the
                    // record POST (which is what actually writes CREATE_MARKET + PLACE_BET to topic 0.0.9017517 via resolver).
                    // This closes the last hole vs the "working extremely well before" backup experience.
                    const em = (err?.message || String(err || '')).toLowerCase();
                    if (em.includes('timed out') || em.includes('walletconnect request') || em.includes('timeout')) {
                      try {
                        const pid = `fast-${Date.now()}`;
                        const pSideLabel = fastGameSide === 'YES' ? 'Higher' : 'Lower';
                        const pDurLabel = `${fastGameDuration} min`;
                        const pEst = new Date(Date.now() + fastGameDuration * 60 * 1000);
                        const pTimeLabel = pEst.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const pQ = `Will HBAR price be ${pSideLabel} than the current price at resolution? (~${pDurLabel}, est. ${pTimeLabel})`;
                        const pPrice = (typeof modalHbarPrice === 'number' ? modalHbarPrice : (assets.find(a => a.symbol === 'HBAR')?.price || 0.05));

                        const pGame = {
                          marketId: pid,
                          question: pQ,
                          direction: fastGameSide,
                          durationMinutes: fastGameDuration,
                          endTime: Math.floor(Date.now() / 1000) + (fastGameDuration * 60),
                          creationPrice: pPrice,
                          currentVolume: fastGameStake,
                          resolved: false,
                          creator: session.accountId,
                          yesStake: fastGameSide === 'YES' ? fastGameStake : 0,
                          noStake: fastGameSide === 'NO' ? fastGameStake : 0,
                          yesParticipants: fastGameSide === 'YES' ? 1 : 0,
                          noParticipants: fastGameSide === 'NO' ? 1 : 0,
                          totalParticipants: 1,
                          _wcTimedOut: true,
                          _mayHavePayment: true,
                          _pendingRecord: true,
                        } as any;

                        setOptimisticGames(prev => {
                          const exists = prev.some(gg => gg.marketId === pid);
                          if (exists) return prev;
                          return [pGame, ...prev];
                        });

                        setRecentlyCreatedMarketIds((prev: Set<string>) => {
                          const next = new Set(prev);
                          next.add(pid);
                          try {
                            const toSave: Record<string, number> = {};
                            next.forEach(id => { toSave[id] = Date.now(); });
                            localStorage.setItem('recentlyCreatedFastGames', JSON.stringify(toSave));
                          } catch {}
                          return next;
                        });

                        setMyBetCounts(prev => ({ ...prev, [pid]: 1 }));

                        const totalPaid = (fastGameStake + 2.5).toFixed(2);
                        showToast(`WalletConnect timed out (120s relay). If you approved the transfer in HashPack, ${totalPaid} HBAR likely reached escrow (0.0.9006979) + treasury (0.0.9006841). Recovery card added to YOUR RECENT FAST GAMES below + main list. Click "Retry record" on it to POST the CREATE + PLACE_BET (this is what starts the topic). MarketId: ${pid}. Resolver: ${RESOLVER_BASE}`, 'error');
                      } catch (recErr) {
                        console.warn('[Predict] WC-timeout recovery pending add failed (non-fatal)', recErr);
                      }
                    }
                  } finally {
                    setIsCreatingFastGame(false);
                  }
                }}
                disabled={isCreatingFastGame}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold disabled:opacity-60"
              >
                {isCreatingFastGame ? "Waiting for signature..." : "CREATE FAST GAME — PAY TOTAL ABOVE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

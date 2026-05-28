import React from 'react';

const MASTER_TOPIC_ID = '0.0.9017517';

interface PredictionHistoryProps {
  myHistory: any[];
  isDark: boolean;
  isVIP: boolean;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function PredictionHistory({ myHistory, isDark, isVIP, showToast }: PredictionHistoryProps) {
  if (myHistory.length === 0) {
    return (
      <div className={`${isDark ? 'text-white/50' : 'text-gray-500'} text-sm italic`}>
        No predictions yet. Your full audit trail will appear here after you create or predict on markets.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`text-[10px] font-medium tracking-widest px-1 ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
        PRIVATE GAME RECEIPTS — Only visible to you
      </div>

      {myHistory.map((item, i) => {
        const hasRealClaim = item.claimedAmount && item.claimedAmount > 0;
        const payoutLink = item.payoutTxId 
          ? `https://hashscan.io/testnet/transaction/${item.payoutTxId}` 
          : null;

        // Construct a nice HCS topic link (approximate using marketId timestamp if available)
        const topicLink = `https://hashscan.io/testnet/topic/${MASTER_TOPIC_ID || '0.0.9017517'}/messages`;

        const myStake = item.myStake || 0;
        const totalWinning = item.totalWinningPool || 0;
        const stakePercent = totalWinning > 0 ? ((myStake / totalWinning) * 100).toFixed(1) : null;

        let outcomeBadge = null;
        let receiptFooter = null;

        if (item.autoPaid || hasRealClaim) {
          outcomeBadge = (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${isVIP 
              ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-300 border-emerald-400/40 vip-shimmer' 
              : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'}`}>
              {hasRealClaim ? 'WON & PAID' : 'AUTO-PAID'}
            </span>
          );
          receiptFooter = (
            <div className="mt-3 pt-3 border-t border-white/10 text-emerald-400 font-semibold tabular-nums text-lg">
              +{(item.claimedAmount || item.claimable || 0).toFixed(2)} HBAR received
            </div>
          );
        } else if (item.resolved) {
          outcomeBadge = (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${item.userWon 
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' 
              : 'bg-rose-500/15 text-rose-400 border-rose-500/30'}`}>
              {item.userWon ? 'YOU WON' : 'YOU LOST'}
            </span>
          );
        }

        return (
          <div 
            key={i} 
            className={`rounded-3xl border p-5 ${isDark 
              ? 'border-white/10 bg-white/[0.015]' 
              : 'border-gray-200 bg-white'} ${isVIP ? 'vip-glass' : ''}`}
          >
            {/* Receipt Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="font-semibold text-base tracking-tight">Private Game Receipt</div>
                <div className="font-mono text-[11px] text-white/40 mt-0.5">{item.marketId}</div>
                <div className="text-[10px] text-white/40 mt-1">Master Topic: 0.0.9017517</div>
              </div>
              <div className="text-right">
                {outcomeBadge}
              </div>
            </div>

            {/* Your Prediction */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm mb-4">
              <div>
                <div className="text-[10px] text-white/50 tracking-widest">YOUR PREDICTION</div>
                <div className="font-semibold mt-0.5">{item.userSide} • {myStake} HBAR</div>
                <div className="text-[10px] text-white/50">+1% platform fee applied</div>
              </div>

              <div>
                <div className="text-[10px] text-white/50 tracking-widest">ENTRY CONTEXT</div>
                <div className="mt-0.5">
                  {item.creationPrice && <div className="font-mono">Price: ${Number(item.creationPrice).toFixed(4)}</div>}
                  <div className="text-[10px] text-white/50">Fast game • 10-20 min duration</div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-[10px] text-white/50 tracking-widest">YOUR STAKE</div>
                <div className="font-semibold tabular-nums text-lg mt-0.5">{myStake} HBAR</div>
              </div>
            </div>

            {/* Fishing Data Section */}
            <div className={`rounded-2xl p-4 mb-4 text-sm ${isDark ? 'bg-white/[0.025]' : 'bg-gray-50'}`}>
              <div className="font-medium text-emerald-400 mb-2 tracking-widest text-[10px]">FISHING DATA — PRIVATE ANALYSIS</div>
              
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                {stakePercent && (
                  <div>
                    Your stake was <span className="font-semibold">{stakePercent}%</span> of the winning side pool
                  </div>
                )}
                
                {item.creationPrice && (
                  <div>
                    Entered at <span className="font-mono">${Number(item.creationPrice).toFixed(4)}</span>
                  </div>
                )}

                <div className="col-span-2 text-[11px] text-white/50 mt-1">
                  You fished this market when it was still forming. All data derived from immutable HCS records.
                </div>
              </div>
            </div>

            {/* Proof & Outcome */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                {payoutLink ? (
                  <a href={payoutLink} target="_blank" rel="noopener noreferrer" 
                     className="text-emerald-400 hover:underline font-medium">
                    View exact payout on HashScan →
                  </a>
                ) : (
                  <a href={topicLink} target="_blank" rel="noopener noreferrer" 
                     className="text-white/60 hover:text-white/80 font-medium">
                    View full audit trail on HCS Topic →
                  </a>
                )}
              </div>

              <div>
                {receiptFooter}
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-white/10 text-[10px] text-white/40 italic">
              This receipt is private to you. All data is derived from public HCS topic 0.0.9017517.
            </div>
          </div>
        );
      })}
    </div>
  );
}

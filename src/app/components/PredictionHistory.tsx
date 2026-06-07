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
      <div className={`rounded-3xl border p-8 text-center ${isDark ? 'border-white/10 bg-[#0a0c17]' : 'border-slate-200 bg-white shadow-sm'}`}>
        <div className="mx-auto mb-4 h-11 w-11 rounded-full bg-[#00f9ff]/10 flex items-center justify-center">
          <span className="text-xl">📜</span>
        </div>
        <div className={`font-semibold text-lg tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Your Private Hedera Game Ledger
        </div>
        <div className={`mt-2 max-w-md mx-auto text-sm leading-snug ${isDark ? 'text-white/60' : 'text-slate-600'}`}>
          Wins, losses, unmatched returns &amp; exact payout proofs appear here automatically — fully auditable and private to you.
        </div>
        <div className={`mt-4 text-[11px] tracking-widest ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
          CONNECT • PREDICT ON A FAST GAME • YOUR CRYPTOGRAPHIC RECEIPTS ARRIVE HERE
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <div className={`text-[10px] font-medium tracking-[1.5px] uppercase ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
          PRIVATE GAME RECEIPTS — CRYPTOGRAPHIC PROOFS FROM HCS 0.0.9017517
        </div>
        <div className={`text-[10px] ${isDark ? 'text-white/40' : 'text-slate-500'}`}>Only visible to you</div>
      </div>

      {myHistory.map((item, i) => {
        const myStake = item.myStake || 0;
        const actualPaid = item.actualPaid || item.claimedAmount || item.claimable || 0;
        const isWin = item.userWon === true || actualPaid > myStake;
        const isLoss = item.resolved && !isWin && actualPaid === 0;
        const isUnmatched = item.resolved && actualPaid === myStake && myStake > 0;

        // Strong outcome badge with pink/rose for losses
        let outcomeBadge = null;
        if (isWin) {
          outcomeBadge = (
            <span className={`px-3.5 py-1 rounded-full text-xs font-semibold border tracking-wide ${isVIP 
              ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-300 border-emerald-400/40 vip-shimmer' 
              : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'}`}>
              {item.autoPaid || item.alreadyPaid ? 'AUTO-PAID WIN' : 'WON'}
            </span>
          );
        } else if (isLoss) {
          outcomeBadge = (
            <span className="px-3.5 py-1 rounded-full text-xs font-semibold border tracking-wide bg-rose-500/15 text-rose-400 border-rose-500/30">
              LOSS
            </span>
          );
        } else if (isUnmatched) {
          outcomeBadge = (
            <span className="px-3.5 py-1 rounded-full text-xs font-semibold border tracking-wide bg-[#00f9ff]/15 text-[#00f9ff] border-[#00f9ff]/30">
              UNMATCHED RETURN
            </span>
          );
        } else if (item.resolved) {
          outcomeBadge = (
            <span className={`px-3.5 py-1 rounded-full text-xs font-semibold border tracking-wide ${isDark ? 'bg-white/10 text-white/80 border-white/20' : 'bg-slate-100 text-slate-700 border-slate-300'}`}>
              RESOLVED
            </span>
          );
        }

        // Multiple high-quality HashScan proof links (Web3 expert standard)
        const topicBase = `https://hashscan.io/testnet/topic/${MASTER_TOPIC_ID}/messages`;
        const payoutLink = item.payoutTxId 
          ? `https://hashscan.io/testnet/transaction/${item.payoutTxId}` 
          : null;

        const profitMultiple = item.profitMultiple || (myStake > 0 && actualPaid > myStake ? (actualPaid / myStake).toFixed(2) : null);
        const stakePercent = item.sharePercent || (item.totalWinningPool > 0 ? ((myStake / item.totalWinningPool) * 100).toFixed(1) : null);

        return (
          <div 
            key={i} 
            className={`group rounded-3xl border p-6 transition-all hover:scale-[1.01] ${isDark ? 'border-white/10 bg-[#0a0c17] hover:border-white/20' : 'border-slate-200 bg-white shadow-sm'} ${isVIP ? 'vip-glass vip-shimmer ring-1 ring-white/10' : ''}`}
          >
            {/* Premium Ticket Header */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="flex items-center gap-2">
                  <div className={`font-semibold text-lg tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Private Hashgraph Receipt</div>
                  <div className="text-[9px] px-2 py-px rounded bg-[#00f9ff]/10 text-[#00f9ff] font-medium tracking-[1px]">VERIFIED ON HEDERA</div>
                </div>
                <div className={`font-mono text-[11px] mt-1 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{item.marketId}</div>
                <div className={`text-[10px] mt-0.5 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>Master Topic: <span className="font-mono text-[#00f9ff]">0.0.9017517</span></div>
              </div>
              <div className="text-right">
                {outcomeBadge}
                {item.betSequence && (
                  <div className={`text-[10px] mt-1 font-mono ${isDark ? 'text-white/50' : 'text-slate-500'}`}>Prediction #{item.betSequence}</div>
                )}
              </div>
            </div>

            {/* Core Facts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5 text-sm">
              <div>
                <div className={`text-[10px] tracking-widest mb-1 ${isDark ? 'text-white/60' : 'text-slate-600'}`}>YOUR PREDICTION</div>
                <div className="font-semibold text-base">{item.userSide} • {myStake} HBAR</div>
                <div className={`text-[10px] ${isDark ? 'text-white/50' : 'text-slate-500'}`}>+1% platform fee</div>
              </div>

              <div>
                <div className={`text-[10px] tracking-widest mb-1 ${isDark ? 'text-white/60' : 'text-slate-600'}`}>ENTRY PRICE</div>
                <div className="font-mono font-medium">{item.creationPrice ? `$${Number(item.creationPrice).toFixed(4)}` : '—'}</div>
                <div className={`text-[10px] ${isDark ? 'text-white/50' : 'text-slate-500'}`}>Fast game • 10/20 min</div>
              </div>

              <div>
                <div className={`text-[10px] tracking-widest mb-1 ${isDark ? 'text-white/60' : 'text-slate-600'}`}>RESOLUTION</div>
                {item.resolved && item.closingPrice ? (
                  <div>
                    <div className="font-mono font-medium">${Number(item.closingPrice).toFixed(4)}</div>
                    <div className={`text-xs ${item.resolutionWinner === item.userSide ? 'text-emerald-400' : 'text-rose-400'}`}>
                      Winner: {item.resolutionWinner}
                    </div>
                  </div>
                ) : (
                  <div className={`${isDark ? 'text-white/60' : 'text-slate-500'} text-sm`}>Pending resolution</div>
                )}
              </div>

              <div className="text-right">
                <div className={`text-[10px] tracking-widest mb-1 ${isDark ? 'text-white/60' : 'text-slate-600'}`}>RESULT</div>
                <div className={`font-semibold text-xl tabular-nums ${isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-[#00f9ff]'}`}>
                  {actualPaid > 0 ? `+${actualPaid.toFixed(2)}` : myStake > 0 ? `–${myStake.toFixed(2)}` : '0.00'} HBAR
                </div>
                {profitMultiple && (
                  <div className="text-[11px] text-emerald-400 font-medium">{profitMultiple}x multiple</div>
                )}
              </div>
            </div>

            {/* Enhanced Fishing Data + Personal Edge */}
            <div className={`rounded-2xl p-4 mb-5 text-sm border ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <div className="font-medium text-[#00f9ff] mb-2 tracking-widest text-[10px] flex items-center gap-2">
                FISHING DATA — YOUR PRIVATE EDGE
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-[12px]">
                {stakePercent && (
                  <div>
                    You controlled <span className="font-semibold text-white">{stakePercent}%</span> of the winning pool
                  </div>
                )}
                {item.creationPrice && item.closingPrice && (
                  <div>
                    Price moved from <span className="font-mono">${Number(item.creationPrice).toFixed(4)}</span> → <span className="font-mono">${Number(item.closingPrice).toFixed(4)}</span>
                  </div>
                )}
                {profitMultiple && (
                  <div className="text-emerald-400 font-medium">
                    Your edge delivered {profitMultiple}x on this prediction
                  </div>
                )}
                <div className={`col-span-2 md:col-span-3 text-[11px] mt-1 ${isDark ? 'text-white/55' : 'text-slate-500'}`}>
                  All numbers derived directly from immutable HCS messages. No trust required.
                </div>
              </div>
            </div>

            {/* Strong Multi-Link Proof Section (Hashgraph expert standard) */}
            <div className={`pt-4 border-t ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
              <div className={`text-[10px] tracking-widest mb-2 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>CRYPTOGRAPHIC PROOF LINKS</div>
              <div className="flex flex-wrap gap-2 text-xs">
                <a 
                  href={topicBase} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/5 text-white/80 hover:text-white transition-colors"
                >
                  View full topic on HashScan →
                </a>

                {payoutLink && (
                  <a 
                    href={payoutLink} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-xl border border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                  >
                    View your exact PAYOUT tx →
                  </a>
                )}

                <a 
                  href={topicBase} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/5 text-white/80 hover:text-white transition-colors"
                >
                  Search messages for {item.marketId} →
                </a>
              </div>
            </div>

            <div className={`mt-4 pt-4 border-t text-[10px] flex items-center justify-between ${isDark ? 'border-white/10 text-white/40' : 'border-slate-200 text-slate-500'}`}>
              <span>This receipt is private to you. Everything is verifiable on public HCS topic 0.0.9017517.</span>
              {isVIP && <span className="text-[9px] text-emerald-400/70 tracking-widest">VIP • ENHANCED PROVENANCE</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

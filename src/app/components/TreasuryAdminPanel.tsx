import React from 'react';

interface TreasuryAdminPanelProps {
  hashPackSession: any;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  RESOLVER_BASE: string;
  isDark: boolean;
  isVIP: boolean;
  vipSoundsEnabled?: boolean;
  playVIPSound?: (type?: string) => void;
}

export function TreasuryAdminPanel({
  hashPackSession,
  showToast,
  RESOLVER_BASE,
  isDark,
  isVIP,
  vipSoundsEnabled = false,
  playVIPSound,
}: TreasuryAdminPanelProps) {
  if (hashPackSession?.accountId !== '0.0.9006841') return null;

  const triggerForcePayout = async () => {
    const marketId = prompt('Enter marketId to force payout (e.g. fast-1234567890):');
    if (!marketId) return;

    try {
      const res = await fetch(`${RESOLVER_BASE}/api/admin/force-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId,
          caller: hashPackSession.accountId,
        }),
      });
      const data = await res.json();
      showToast(data.message || 'Force payout triggered', res.ok ? 'success' : 'error');
    } catch (e) {
      showToast('Admin action failed', 'error');
    }
  };

  const triggerForceResolve = async () => {
    const marketId = prompt('Enter marketId to FORCE RESOLVE (e.g. fast-1234567890):');
    if (!marketId) return;

    const winner = prompt('Enter winner (YES or NO):')?.toUpperCase();
    if (winner !== 'YES' && winner !== 'NO') {
      showToast('Winner must be YES or NO', 'error');
      return;
    }

    try {
      const res = await fetch(`${RESOLVER_BASE}/api/admin/force-resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId,
          winner,
          caller: hashPackSession.accountId,
        }),
      });
      const data = await res.json();
      showToast(data.message || 'Force resolve triggered', res.ok ? 'success' : 'error');
    } catch (e) {
      showToast('Force resolve failed', 'error');
    }
  };

  const reRecordBet = async () => {
    const marketId = prompt('Enter marketId (e.g. fast-1234567890):');
    if (!marketId) return;

    const side = prompt('Side (YES or NO):')?.toUpperCase();
    if (side !== 'YES' && side !== 'NO') {
      showToast('Side must be YES or NO', 'error');
      return;
    }

    const amountStr = prompt('Stake amount (without fee):');
    const amount = parseFloat(amountStr || '0');
    if (!amount || amount <= 0) {
      showToast('Invalid amount', 'error');
      return;
    }

    const bettor = prompt('Bettor account ID (e.g. 0.0.123456):');
    if (!bettor) return;

    const feeStr = prompt('Platform fee collected (usually 1% of stake):');
    const platformFeeCollected = parseFloat(feeStr || '0');

    try {
      const res = await fetch(`${RESOLVER_BASE}/api/admin/re-record-bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId,
          side,
          amount,
          user: bettor,
          platformFeeCollected: platformFeeCollected || undefined,
          caller: hashPackSession.accountId,
        }),
      });
      const data = await res.json();
      showToast(data.message || 'Re-record attempt completed', res.ok ? 'success' : 'error');
    } catch (e) {
      showToast('Re-record failed', 'error');
    }
  };

  const runSimulation = async () => {
    const marketId = prompt('Enter marketId for read-only simulation:');
    if (!marketId) return;

    try {
      const res = await fetch(`${RESOLVER_BASE}/api/admin/simulate-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId,
          caller: hashPackSession.accountId,
        }),
      });
      const data = await res.json();

      if (data.success && data.simulation) {
        const s = data.simulation;
        const msg = `Sim ${marketId} → ${s.winningSide} | ${s.totalPayouts} payouts | ${s.totalAmountToPay} HBAR`;
        showToast(msg, 'success');
        console.log('%c[Stage 8 Simulation Result]', 'color:#10b981; font-weight:bold', data.simulation);
      } else {
        showToast(data.error || 'Simulation failed', 'error');
      }
    } catch (e) {
      showToast('Simulation request failed', 'error');
    }
  };

  return (
    <div className="mt-8 p-6 rounded-3xl border border-emerald-500/30 bg-emerald-950/10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="text-emerald-300 font-semibold text-lg tracking-tight">
            TREASURY COMMAND CENTER
          </div>
          <div className="px-2.5 py-0.5 text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
            OPERATOR ONLY
          </div>
        </div>
        {isVIP && (
          <div className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
            VIP • FULL ACCESS
          </div>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="text-[10px] text-white/50">SYSTEM STATUS</div>
          <div className="text-emerald-400 font-semibold mt-1">Auto-Payouts Active</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="text-[10px] text-white/50">LAST RECOVERY SCAN</div>
          <div className="text-white/80 font-mono text-sm mt-1">On startup</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="text-[10px] text-white/50">SIMULATION MODE</div>
          <div className="text-emerald-400 font-semibold mt-1">Read-Only</div>
        </div>
      </div>

      {/* Manual Controls */}
      <div className="mb-6">
        <div className="text-emerald-300 text-xs tracking-[1px] mb-2 font-medium">MANUAL OVERRIDE</div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={triggerForcePayout}
            onMouseEnter={() => isVIP && vipSoundsEnabled && playVIPSound?.('action')}
            className="px-5 py-2.5 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-sm font-medium transition-all active:scale-[0.985]"
          >
            Force Payout for Market
          </button>

          <button
            onClick={triggerForceResolve}
            onMouseEnter={() => isVIP && vipSoundsEnabled && playVIPSound?.('action')}
            className="px-5 py-2.5 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-sm font-medium transition-all active:scale-[0.985]"
          >
            Force Resolve Market
          </button>

          <button
            onClick={reRecordBet}
            onMouseEnter={() => isVIP && vipSoundsEnabled && playVIPSound?.('action')}
            className="px-5 py-2.5 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-sm font-medium transition-all active:scale-[0.985]"
          >
            Re-record Prediction (Recovery)
          </button>

          <button
            onClick={async () => {
              try {
                const res = await fetch(`${RESOLVER_BASE}/api/admin/active-games`);
                const data = await res.json();
                if (data.success) {
                  console.log('%c[Resolver Active Games State]', 'color:#34d399; font-weight:bold', data.state);
                  const active = data.state.activeGames || [];
                  const tie = data.state.tieResolutionGames || [];
                  showToast(`Active: ${active.length} | In Tie: ${tie.length} — see console for details`, 'success');
                } else {
                  showToast('Failed to fetch active games', 'error');
                }
              } catch (e) {
                showToast('Error fetching resolver state', 'error');
              }
            }}
            onMouseEnter={() => isVIP && vipSoundsEnabled && playVIPSound?.('info')}
            className="px-5 py-2.5 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-sm font-medium transition-all active:scale-[0.985]"
          >
            View Active Games (Resolver State)
          </button>
        </div>
      </div>

      {/* Simulation Lab */}
      <div>
        <div className="text-emerald-300 text-xs tracking-[1px] mb-2 font-medium">SIMULATION LAB (READ-ONLY)</div>
        <div className="text-[10px] text-white/50 mb-3">
          Run pure calculations against historical HCS data. Safe for analysis and future AI tooling.
        </div>

        <button
          onClick={runSimulation}
          onMouseEnter={() => isVIP && vipSoundsEnabled && playVIPSound?.('action')}
          className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 hover:from-emerald-500/20 hover:to-teal-500/20 text-emerald-300 border border-emerald-400/30 text-sm font-medium transition-all active:scale-[0.985]"
        >
          Run Read-Only Simulation
        </button>
        <div className="text-[9px] text-white/40 mt-1.5 text-center">
          Results logged to console • No funds moved
        </div>
      </div>
    </div>
  );
}

import { Lock } from "lucide-react";

/**
 * AmmPrelaunchBanner — displayed inside every AMM entry point while
 * the AMM is in pre-launch lockdown.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  SENIOR DEV NOTE                                               │
 * │  This component can be deleted once AMM goes live.             │
 * │  Backend flag: AMM_PRELAUNCH_LOCKED in amm.ts                  │
 * │  See the master go-live checklist in amm.ts for all usages.    │
 * └─────────────────────────────────────────────────────────────────┘
 */
export function AmmPrelaunchBanner({
  isDark,
  onClose,
}: {
  isDark: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
      <div
        className={`w-11 h-11 rounded-full flex items-center justify-center mb-5 ${
          isDark
            ? "bg-slate-800 border border-slate-700"
            : "bg-gray-100 border border-gray-200"
        }`}
      >
        <Lock
          className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-400"}`}
        />
      </div>

      <h3
        className={`text-sm font-semibold mb-2 ${
          isDark ? "text-white" : "text-gray-900"
        }`}
      >
        AMM Coming Soon
      </h3>

      <p
        className={`text-xs leading-relaxed max-w-[260px] ${
          isDark ? "text-slate-500" : "text-gray-500"
        }`}
      >
        Pool creation, liquidity, and swaps will go live after testing and
        security audits are complete.
      </p>

      {onClose && (
        <button
          onClick={onClose}
          className={`mt-6 px-5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            isDark
              ? "text-slate-400 bg-slate-800/60 hover:bg-slate-800"
              : "text-gray-500 bg-gray-100 hover:bg-gray-200"
          }`}
        >
          Close
        </button>
      )}
    </div>
  );
}
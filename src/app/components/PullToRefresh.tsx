import { useState, useRef, useCallback, useEffect } from "react";
import { motion, useMotionValue, useTransform } from "motion/react";
import { RefreshCw } from "lucide-react";

/**
 * PullToRefresh — mobile DeFi-grade pull-to-refresh overlay.
 *
 * Listens on touch events and dispatches a `wrappdex:pull-refresh` CustomEvent
 * when the user pulls down > threshold (60px) and releases.
 *
 * Individual pages listen for this event and re-fetch their data.
 * Only activates when the scroll position is at the very top (scrollY === 0)
 * and only on touch devices (pointer: coarse).
 */

const THRESHOLD = 64;
const MAX_PULL = 120;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [refreshing, setRefreshing] = useState(false);
  const pullY = useMotionValue(0);
  const indicatorOpacity = useTransform(pullY, [0, THRESHOLD * 0.5, THRESHOLD], [0, 0.5, 1]);
  const indicatorScale = useTransform(pullY, [0, THRESHOLD], [0.5, 1]);
  const indicatorRotate = useTransform(pullY, [0, MAX_PULL], [0, 360]);

  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Only activate when fully scrolled to top
    if (window.scrollY > 0 || refreshing) return;
    startYRef.current = e.touches[0].clientY;
    pullingRef.current = true;
  }, [refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pullingRef.current) return;
    const dy = Math.max(0, e.touches[0].clientY - startYRef.current);
    if (dy > 10) {
      // Apply resistance — diminishing returns past threshold
      const dampened = dy < THRESHOLD ? dy : THRESHOLD + (dy - THRESHOLD) * 0.3;
      const clamped = Math.min(dampened, MAX_PULL);
      pullY.set(clamped);
    }
  }, [pullY]);

  const handleTouchEnd = useCallback(() => {
    if (!pullingRef.current) return;
    pullingRef.current = false;

    const currentPull = pullY.get();
    if (currentPull >= THRESHOLD && !refreshing) {
      // Snap to threshold position and trigger refresh
      pullY.set(THRESHOLD);
      setRefreshing(true);

      // Dispatch the event
      window.dispatchEvent(new CustomEvent("wrappdex:pull-refresh"));

      // Auto-reset after reasonable timeout
      setTimeout(() => {
        pullY.set(0);
        setRefreshing(false);
      }, 1500);
    } else {
      pullY.set(0);
    }
  }, [pullY, refreshing]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Passive touch listeners for scroll performance
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return (
    <div ref={containerRef} className="relative">
      {/* Pull indicator */}
      <motion.div
        style={{ opacity: indicatorOpacity, scale: indicatorScale }}
        className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] pointer-events-none lg:hidden"
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-pink-500/20 to-purple-500/20 dark:from-pink-500/30 dark:to-purple-500/30 border border-pink-500/30 dark:border-pink-500/40 backdrop-blur-xl shadow-lg shadow-pink-500/20">
          <motion.div
            style={{ rotate: indicatorRotate }}
            animate={refreshing ? { rotate: 360 } : undefined}
            transition={refreshing ? { duration: 0.8, repeat: Infinity, ease: "linear" } : undefined}
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? "text-pink-400" : "text-pink-500 dark:text-pink-400"}`} />
          </motion.div>
        </div>
        <div className="mt-1.5 text-center">
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tracking-wider uppercase">
            {refreshing ? "Refreshing..." : "Pull to refresh"}
          </span>
        </div>
      </motion.div>

      {children}
    </div>
  );
}

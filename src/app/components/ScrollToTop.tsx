import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronUp } from "lucide-react";

/**
 * ScrollToTop — floating action button that appears after scrolling
 * past 400px. Positioned bottom-right, offset above mobile bottom nav.
 */

const SCROLL_THRESHOLD = 400;

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setVisible(window.scrollY > SCROLL_THRESHOLD);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.7, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.7, y: 20 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          onClick={scrollToTop}
          aria-label="Scroll to top"
          className="fixed z-[45] right-4 bottom-20 lg:bottom-6 w-10 h-10 flex items-center justify-center
            rounded-full border shadow-lg backdrop-blur-xl transition-colors
            bg-white/80 dark:bg-slate-800/80 border-slate-200 dark:border-white/10
            text-slate-600 dark:text-slate-300 hover:text-pink-600 dark:hover:text-pink-400
            hover:border-pink-300 dark:hover:border-pink-500/40
            hover:shadow-pink-500/20 dark:hover:shadow-pink-500/30
            active:scale-90"
        >
          <ChevronUp className="w-5 h-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

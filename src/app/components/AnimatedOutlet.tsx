import { Suspense } from "react";
import { Outlet, useLocation } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { ErrorBoundary } from "./ErrorBoundary";
import { PageSkeleton } from "./Skeletons";
import { useTheme } from "../contexts/ThemeContext";

/**
 * Route-aware animated outlet — wraps page content with
 * subtle opacity + translateY transitions on route changes.
 */
export function AnimatedOutlet() {
  const location = useLocation();
  const { isDark } = useTheme();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
      >
        <ErrorBoundary isDark={isDark}>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}

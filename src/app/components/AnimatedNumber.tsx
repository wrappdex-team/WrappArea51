import { useEffect, useRef, useState } from "react";

/**
 * AnimatedNumber — smoothly counts up/down when a numeric value changes.
 * Uses requestAnimationFrame for buttery 60fps interpolation.
 *
 * Designed for wallet balances and portfolio values in Wrappdex.
 */

interface AnimatedNumberProps {
  value: number;
  /** Duration in ms (default 600) */
  duration?: number;
  /** Number of decimal places */
  decimals?: number;
  /** Optional prefix like "$" */
  prefix?: string;
  /** Optional suffix like " HBAR" */
  suffix?: string;
  /** CSS classes */
  className?: string;
}

export function AnimatedNumber({
  value,
  duration = 600,
  decimals = 2,
  prefix = "",
  suffix = "",
  className = "",
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevRef = useRef(value);
  const animRef = useRef<number>(0);
  const startRef = useRef(0);
  const fromRef = useRef(value);

  useEffect(() => {
    // Skip animation on first render or when value hasn't changed
    if (prevRef.current === value) return;

    const from = prevRef.current;
    const to = value;
    prevRef.current = value;
    fromRef.current = from;
    startRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic for natural deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = fromRef.current + (to - fromRef.current) * eased;
      setDisplayValue(current);

      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(to);
      }
    };

    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animRef.current);
  }, [value, duration]);

  const formatted =
    decimals === 0
      ? Math.round(displayValue).toLocaleString()
      : displayValue.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });

  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

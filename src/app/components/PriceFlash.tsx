import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * PriceFlash — wraps a price change percentage and briefly flashes
 * green (positive) or red (negative) when the value changes.
 *
 * The flash is a quick opacity pulse on a background highlight
 * that fades in and out over ~500ms, mimicking Bloomberg Terminal style.
 */

interface PriceFlashProps {
  /** The numeric value to monitor for changes */
  value: number;
  children: ReactNode;
  className?: string;
}

export function PriceFlash({ value, children, className = "" }: PriceFlashProps) {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    // Skip initial render
    if (prevRef.current === value) return;

    const direction = value > prevRef.current ? "up" : value < prevRef.current ? "down" : null;
    prevRef.current = value;

    if (!direction) return;

    // Clear any pending flash
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setFlash(direction);
    timeoutRef.current = setTimeout(() => setFlash(null), 600);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value]);

  return (
    <span
      className={`relative inline-flex items-center ${className}`}
      aria-live="polite"
    >
      {/* Flash overlay */}
      {flash && (
        <span
          className={`absolute inset-0 rounded-sm pointer-events-none price-flash-anim ${
            flash === "up"
              ? "bg-emerald-500/25 dark:bg-emerald-400/20"
              : "bg-red-500/25 dark:bg-red-400/20"
          }`}
        />
      )}
      {children}
    </span>
  );
}

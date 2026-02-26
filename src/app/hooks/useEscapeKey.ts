/**
 * useEscapeKey — Dismiss modals and overlays with the Escape key.
 *
 * WCAG 2.1 SC 2.1.2 requires that keyboard-operated UI components
 * can be dismissed without requiring a specific physical gesture.
 * For modal dialogs, the universally expected dismissal key is Escape.
 *
 * Usage:
 *   useEscapeKey(onClose);              // fires on every Escape press
 *   useEscapeKey(onClose, !isOpen);     // disabled when modal is closed
 *
 * IMPLEMENTATION NOTE: The listener is attached to `document` (not the
 * modal element) so it works regardless of focus position. Only one
 * instance fires at a time because each modal should unmount or pass
 * `disabled=true` when it's not the topmost overlay.
 */

import { useEffect } from "react";

export function useEscapeKey(
  onEscape: () => void,
  disabled = false,
): void {
  useEffect(() => {
    if (disabled) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      }
    };

    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, [onEscape, disabled]);
}

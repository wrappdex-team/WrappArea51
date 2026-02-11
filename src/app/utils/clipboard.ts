/**
 * Copy text to clipboard with fallback for restricted contexts (iframes, permissions policy).
 *
 * Strategy:
 * 1. In cross-origin iframes or when Permissions-Policy blocks clipboard-write,
 *    skip the modern Clipboard API entirely to avoid noisy DOMException logs.
 * 2. Otherwise, try `navigator.clipboard.writeText` first.
 * 3. Fall back to a temporary textarea + `document.execCommand("copy")`.
 */

/** Detect if we're in a cross-origin or sandboxed iframe. */
function isRestrictedContext(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    // Accessing window.top throws in cross-origin iframes — that's restricted.
    return true;
  }
}

/** Cache the restriction check for the page lifecycle. */
const _restricted = isRestrictedContext();

export async function copyToClipboard(text: string): Promise<boolean> {
  // Only attempt the modern Clipboard API in unrestricted top-level contexts.
  // In iframes, the Permissions-Policy header typically blocks clipboard-write
  // and Chrome logs a noisy DOMException even when the rejection is caught.
  if (!_restricted && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API blocked — fall through to legacy fallback
    }
  }

  // Fallback: temporary off-screen textarea + execCommand
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

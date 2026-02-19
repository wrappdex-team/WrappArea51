/**
 * Inline SVG wallet icons for the wallet bar.
 * Self-contained — no external URLs, CDN calls, or image fetches.
 * Deploys cleanly on Vercel with zero runtime dependencies.
 */

interface IconProps {
  size?: number;
  className?: string;
}

export function HashPackIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" fill="#7B61FF" />
      <path
        d="M11 9v14M21 9v14M11 16h10M11 12h10M11 20h10"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function KabilaIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" fill="#1A1A2E" />
      <path
        d="M10 8v16M10 16l10-8M10 16l10 8"
        stroke="#E94560"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MetaMaskIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M27.2 3L17.4 10.4l1.8-4.3L27.2 3z" fill="#E2761B" />
      <path
        d="M4.8 3l9.7 7.5-1.7-4.4L4.8 3zM23.6 21.8l-2.6 4 5.6 1.5 1.6-5.4-4.6-.1zM3.8 21.9l1.6 5.4 5.6-1.5-2.6-4-4.6.1z"
        fill="#E4761B"
      />
      <path
        d="M10.7 14.1l-1.5 2.3 5.5.2-.2-6-3.8 3.5zM21.3 14.1l-3.9-3.6-.1 6.1 5.5-.2-1.5-2.3zM11 25.8l3.3-1.6-2.9-2.2-.4 3.8zM17.7 24.2l3.3 1.6-.4-3.8-2.9 2.2z"
        fill="#E4761B"
      />
      <path
        d="M21 25.8l-3.3-1.6.3 2.1v.9l3-1.4zM11 25.8l3 1.4v-.9l.2-2.1-3.2 1.6z"
        fill="#D7C1B3"
      />
      <path
        d="M14.1 20.4l-2.7-.8 1.9-.9.8 1.7zM17.9 20.4l.8-1.7 1.9.9-2.7.8z"
        fill="#233447"
      />
      <path
        d="M11 25.8l.4-4-3 .1 2.6 3.9zM20.6 21.8l.4 4 2.6-3.9-3-.1zM22.8 16.4l-5.5.2.5 2.8.8-1.7 1.9.9 2.3-2.2zM11.4 18.6l1.9-.9.8 1.7.5-2.8-5.5-.2 2.3 2.2z"
        fill="#CD6116"
      />
      <path
        d="M9.2 16.4l2.4 4.7-.1-2.5-2.3-2.2zM20.5 18.6l-.1 2.5 2.4-4.7-2.3 2.2zM14.7 16.6l-.5 2.8.7 3.3.1-4.4-.3-1.7zM17.3 16.6l-.3 1.6.1 4.5.6-3.3-.4-2.8z"
        fill="#E4751F"
      />
      <path
        d="M17.8 19.4l-.6 3.3.5.3 2.8-2.2.1-2.5-2.8.8-.1.3zM11.4 18.6l.1 2.5 2.8 2.2.5-.3-.7-3.3-2.7-1.1z"
        fill="#F6851B"
      />
      <path
        d="M17.9 27.2v-.9l-.2-.2h-3.4l-.2.2v.9L11 25.8l1.1.9 2.2 1.5h3.5l2.2-1.5 1-1-3-1.5z"
        fill="#C0AD9E"
      />
      <path
        d="M17.7 24.2l-.5-.3h-2.5l-.5.3-.2 2.1.2-.2h3.4l.2.2-.1-2.1z"
        fill="#161616"
      />
      <path
        d="M27.6 3.3L28.5 0l-1.3-.3-9.7 7.2-3.8 3.5L4.4-.3 3.1 0l.9 3.3-1 4.7.7.5-1 .8.8.6-1 .9.7.5-1 1.2 1.5 1.8 5.5-1.7 0 0 3.8-3.5 9.8-7.2L28.6 0l-1 3.3z"
        fill="#763D16"
        opacity="0"
      />
    </svg>
  );
}

export function PhantomIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" fill="#AB9FF2" />
      <path
        d="M24 14.5c0 5.2-4.3 10-10.5 10H12c-.3 0-.5-.2-.5-.5 0-.2.1-.3.2-.4 1.2-.8 1.8-2 1.8-3.6 0-.3-.3-.5-.6-.5h-.4C9.4 19.5 7 17.2 7 14.5S9.4 9.5 12.5 9.5h1C19.6 9.5 24 11.7 24 14.5z"
        fill="white"
      />
      <circle cx="12.5" cy="14.5" r="1.5" fill="#AB9FF2" />
      <circle cx="17.5" cy="14.5" r="1.5" fill="#AB9FF2" />
    </svg>
  );
}

export function DynamicIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" fill="#4C47F7" />
      <path
        d="M10 9h5a7 7 0 0 1 7 7v0a7 7 0 0 1-7 7h-5V9z"
        stroke="white"
        strokeWidth="2"
        fill="none"
      />
      <circle cx="15" cy="16" r="2.5" fill="white" />
    </svg>
  );
}

export function WalletConnectIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" fill="#3B99FC" />
      <path
        d="M9.6 13.1c3.5-3.5 9.3-3.5 12.8 0l.4.4c.2.2.2.5 0 .6l-1.4 1.3c-.1.1-.2.1-.3 0l-.6-.5c-2.5-2.4-6.5-2.4-8.9 0l-.6.6c-.1.1-.2.1-.3 0l-1.4-1.3c-.2-.2-.2-.5 0-.6l.3-.5zm15.8 3l1.2 1.2c.2.2.2.5 0 .6l-5.5 5.4c-.2.2-.4.2-.6 0l-3.9-3.8c0-.1-.1-.1-.2 0l-3.9 3.8c-.2.2-.4.2-.6 0L6.4 17.9c-.2-.2-.2-.5 0-.6l1.2-1.2c.2-.2.4-.2.6 0l3.9 3.8c0 .1.1.1.2 0l3.9-3.8c.2-.2.4-.2.6 0l3.9 3.8c0 .1.1.1.2 0l3.9-3.8c.2-.2.4-.2.6 0z"
        fill="white"
      />
    </svg>
  );
}

/** Map wallet name → icon component for lookup */
export const walletIconMap: Record<string, React.FC<IconProps>> = {
  HashPack: HashPackIcon,
  Kabila: KabilaIcon,
  MetaMask: MetaMaskIcon,
  Phantom: PhantomIcon,
  Dynamic: DynamicIcon,
  WalletConnect: WalletConnectIcon,
};

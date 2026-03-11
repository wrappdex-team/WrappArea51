/**
 * Wallet icons for the wallet bar — using real logos from Supabase Storage.
 * IMPLEMENTATION NOTE: Replaced mock inline SVGs with real provider logos
 * hosted in the "Wallet connect logos" and "Partnered logos" Supabase buckets.
 */

interface IconProps {
  size?: number;
  className?: string;
}

// ── Supabase Storage public URLs ─────────────────────────────────────
const WALLET_LOGOS = {
  hashpack: "https://ehmlclowiedoqncymegi.supabase.co/storage/v1/object/public/Wallet%20connect%20logos/hashpack.png",
  kabila: "https://ehmlclowiedoqncymegi.supabase.co/storage/v1/object/public/Wallet%20connect%20logos/kabila.png",
  metamask: "https://ehmlclowiedoqncymegi.supabase.co/storage/v1/object/public/Wallet%20connect%20logos/metamask.png",
  phantom: "https://ehmlclowiedoqncymegi.supabase.co/storage/v1/object/public/Wallet%20connect%20logos/phantom.png",
  dynamic: "https://ehmlclowiedoqncymegi.supabase.co/storage/v1/object/public/Partnered%20logos/dynamiclogin_logo.png",
  walletconnect: "https://ehmlclowiedoqncymegi.supabase.co/storage/v1/object/public/Wallet%20connect%20logos/walletconnect.png",
} as const;

function WalletLogoImg({ src, alt, size = 24, className }: { src: string; alt: string } & IconProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain", borderRadius: 4 }}
      loading="lazy"
    />
  );
}

export function HashPackIcon({ size = 24, className }: IconProps) {
  return <WalletLogoImg src={WALLET_LOGOS.hashpack} alt="HashPack" size={size} className={className} />;
}

export function KabilaIcon({ size = 24, className }: IconProps) {
  return <WalletLogoImg src={WALLET_LOGOS.kabila} alt="Kabila" size={size} className={className} />;
}

export function MetaMaskIcon({ size = 24, className }: IconProps) {
  return <WalletLogoImg src={WALLET_LOGOS.metamask} alt="MetaMask" size={size} className={className} />;
}

export function PhantomIcon({ size = 24, className }: IconProps) {
  return <WalletLogoImg src={WALLET_LOGOS.phantom} alt="Phantom" size={size} className={className} />;
}

export function DynamicIcon({ size = 24, className }: IconProps) {
  return <WalletLogoImg src={WALLET_LOGOS.dynamic} alt="Dynamic" size={size} className={className} />;
}

export function WalletConnectIcon({ size = 24, className }: IconProps) {
  return <WalletLogoImg src={WALLET_LOGOS.walletconnect} alt="WalletConnect" size={size} className={className} />;
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

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  TrendingUp, BarChart3, ArrowRightLeft, DollarSign,
  Droplets, Wallet, Vote, Globe, Shield,Zap,
  Sun, Moon, Crown, LogOut, Menu,
  VolumeOff, Volume1, Volume2, AlertTriangle,
  Feather,
} from "lucide-react";
import { Toaster } from "sonner";

import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import { usePartneredLogos } from "../contexts/PartneredLogosContext";
import { useBrandLogos } from "../hooks/useBrandLogos";

import { WalletConnectModal } from "./WalletConnectModal";
import { AnimatedOutlet } from "./AnimatedOutlet";
import { AnimatedNumber } from "./AnimatedNumber";
import { HolidayLogo } from "./HolidayLogo";
import { VIPPanel } from "./VIPPanel";
import { ScrollToTop } from "./ScrollToTop";
import { PullToRefresh } from "./PullToRefresh";
import { SEOHead, ROUTE_SEO } from "./SEOHead";
import { Tip } from "./Tip";
import { NewsTicker } from "./NewsTicker";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "./ui/sheet";

import { formatAddress } from "../utils/metamask";
import { trackRouteChange } from "../utils/performance";
import { preloadRoute } from "../utils/preload";
import { isVipEligible, loadVipPrefs, type VipPrefs } from "../utils/vip";
import {
  getSoundVolume, cycleSoundVolume, playTabChime,
  playVipWalletWave, playVipNavNote,
} from "../utils/sounds";

export function Layout() {
  const location = useLocation();
  const { connectedWallets, disconnectWallet, primaryWallet, hederaAccount, hbarPrice, metaMaskAccount, nativeTokenPrice, hashPackProfile, hashPackSession } = useWallet();
  const { theme, toggleTheme, isDark, accent, toggleAccent, isSky } = useTheme();
  const brandLogos = useBrandLogos();
  const partnerLogos = usePartneredLogos();
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [flashingTab, setFlashingTab] = useState<string | null>(null);
  const lastPathRef = useRef(location.pathname);
  const [soundVolume, _setSoundVolume] = useState(getSoundVolume);
  const [showVipPanel, setShowVipPanel] = useState(false);
  const [vipPrefs, setVipPrefs] = useState<VipPrefs>(loadVipPrefs);

  const { hederaNetwork } = useWallet();
  const tokens = hederaAccount?.tokens ?? [];
  const vipEligible = isVipEligible(tokens, hederaNetwork);
  const vipActive = vipEligible && vipPrefs.active;

  // Re-verify VIP prefs integrity once the wallet account is known —
  // detects localStorage tampering between sessions.
  useEffect(() => {
    const acct = hederaAccount?.accountId ?? hashPackSession?.accountId;
    if (acct) setVipPrefs(loadVipPrefs(acct));
  }, [hederaAccount?.accountId, hashPackSession?.accountId]);

  // Apply VIP CSS classes to <html> element
  useEffect(() => {
    const root = document.documentElement;
    if (vipActive && vipPrefs.features.vip_theme) {
      root.classList.add("vip-theme");
    } else {
      root.classList.remove("vip-theme");
    }
    if (vipActive && vipPrefs.features.vip_glow) {
      root.classList.add("vip-glow");
    } else {
      root.classList.remove("vip-glow");
    }
    return () => {
      root.classList.remove("vip-theme", "vip-glow");
    };
  }, [vipActive, vipPrefs.features.vip_theme, vipPrefs.features.vip_glow]);

  const toggleMute = useCallback(() => {
    const next = cycleSoundVolume();
    _setSoundVolume(next);
  }, []);

  const handleTabClick = useCallback((path: string) => {
    // Only play sound if navigating to a new tab
    if (path !== lastPathRef.current) {
      playTabChime(path);
      setFlashingTab(path);
      setTimeout(() => setFlashingTab(null), 300);
      lastPathRef.current = path;
    }
  }, []);

  const navItems = [
    { path: "/markets", label: "Markets", icon: TrendingUp },
    { path: "/trading", label: "Trade", icon: BarChart3 },
    { path: "/swap", label: "Swap", icon: ArrowRightLeft },
    { path: "/buy-sell", label: "Buy/Sell", icon: DollarSign },
    { path: "/defi", label: "DeFi", icon: Droplets },
    { path: "/wallet", label: "Wallet", icon: Wallet },
    { path: "/dao", label: "DAO", icon: Vote },
    { path: "/predict", label: "Predict", icon: Feather },
  ];

  // Secondary items shown in the mobile "More" sheet drawer
  const secondaryNavItems = [
    { path: "/wallet", label: "Wallet", icon: Wallet, description: "Assets & portfolio" },
    { path: "/dao", label: "DAO", icon: Vote, description: "Governance & proposals" },
    { path: "/bridges", label: "Bridges", icon: Globe, description: "Cross-chain transfers" },
    { path: "/audit", label: "Audit", icon: Shield, description: "Security reports" },
  ];

  const isActive = (path: string) => {
    if (path === "/markets") return location.pathname === "/markets";
    return location.pathname.startsWith(path);
  };

  const getWalletColor = (type: string) => {
    if (type === "hedera") return "from-purple-500 to-indigo-500";
    if (type === "ethereum") return "from-orange-500 to-amber-500";
    if (type === "solana") return "from-purple-600 to-pink-600";
    return "from-pink-500 to-purple-500";
  };

  // Track route changes for performance monitoring + SEO
  const currentSEO = ROUTE_SEO[location.pathname] || ROUTE_SEO["/markets"];
  useEffect(() => {
    trackRouteChange(location.pathname);
  }, [location.pathname]);

  // ── Scroll to top on route change ─────────────────────────────────
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  // ── Desktop hover-to-open wallet menu ──────────────────────────────
  const walletMenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDesktop = typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const handleWalletMouseEnter = useCallback(() => {
    if (!isDesktop) return;
    if (walletMenuTimeoutRef.current) {
      clearTimeout(walletMenuTimeoutRef.current);
      walletMenuTimeoutRef.current = null;
    }
    setShowWalletMenu(true);
    // VIP ocean wave sound — gated by VIP active + vip_sounds toggle
    if (vipActive && vipPrefs.features.vip_sounds) playVipWalletWave();
  }, [isDesktop, vipActive, vipPrefs.features.vip_sounds]);

  const handleWalletMouseLeave = useCallback(() => {
    if (!isDesktop) return;
    walletMenuTimeoutRef.current = setTimeout(() => {
      setShowWalletMenu(false);
      walletMenuTimeoutRef.current = null;
    }, 200); // small grace period so cursor can travel to the dropdown
  }, [isDesktop]);

  // Cleanup hover timeout on unmount
  useEffect(() => {
    return () => {
      if (walletMenuTimeoutRef.current) clearTimeout(walletMenuTimeoutRef.current);
    };
  }, []);

  return (
    <div className={`min-h-screen flex flex-col ${isDark ? "bg-[#080a12] text-white" : "bg-[#f8fafc] text-slate-900"}`}>
      {/* Dynamic SEO Head */}
      <SEOHead {...currentSEO} />

      {/* Skip to content — accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-pink-600 focus:text-white focus:rounded-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* News Ticker */}
      <NewsTicker />

      {/* Testnet Warning Banner — prominent full-width strip when on testnet */}
      {hederaNetwork === "testnet" && (
        <div className="relative z-[51] bg-gradient-to-r from-amber-600/90 via-orange-500/90 to-amber-600/90 text-white text-center py-1.5 px-4 backdrop-blur-sm" role="alert">
          <div className="flex items-center justify-center gap-2 text-xs md:text-sm font-bold">
            <AlertTriangle className="w-3.5 h-3.5 md:w-4 md:h-4 animate-pulse" />
            <span>TESTNET MODE — You are connected to Hedera Testnet. Transactions use test HBAR with no real value.</span>
            <AlertTriangle className="w-3.5 h-3.5 md:w-4 md:h-4 animate-pulse" />
          </div>
        </div>
      )}

      {/* Header */}
      <header className={`border-b sticky top-0 z-50 backdrop-blur-xl ${
        isDark
          ? "border-white/[0.06] bg-[#080a12]/80"
          : "border-gray-100 bg-white/90"
      }`}>
        <div className="container mx-auto px-3 md:px-4 lg:px-5 py-2 md:py-3">
          <div className="flex items-center justify-between gap-2">
            {/* WRAPpDEX Logo — responsive viewport-aware sizing, no overflow clipping */}
            <Link to="/markets" className="flex items-center group flex-shrink-0 ml-0 sm:ml-1">
              <HolidayLogo
                defaultDarkSrc={brandLogos.dark}
                defaultLightSrc={brandLogos.light}
                isDark={isDark}
                alt="Wrappdex Decentralized Exchange"
                vipPulse={vipActive}
                wrapperClassName="flex-shrink-0 transition-transform duration-300 flex items-center"
                imgClassName="h-[72px] sm:h-[88px] md:h-[104px] lg:h-[88px] xl:h-[104px] 2xl:h-[120px] max-w-[50vw] sm:max-w-none w-auto object-contain"
                holidayImgClassName="h-[42px] sm:h-[50px] md:h-[59px] lg:h-[50px] xl:h-[59px] 2xl:h-[67px] max-w-[50vw] sm:max-w-none w-auto object-contain"
              />
            </Link>

            {/* IMPLEMENTATION NOTE: BETA badge removed to free header space on mobile
                and signal production readiness. BetaBadge component preserved for
                future feature-flag reintroduction if needed. */}

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center justify-center flex-1 min-w-0 mx-1 xl:mx-3 overflow-hidden" aria-label="Main navigation">
              <div className="flex items-center gap-0.5 lg:gap-0.5 xl:gap-1.5" role="menubar">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                const isFlashing = flashingTab === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => handleTabClick(item.path)}
                    onMouseEnter={() => { preloadRoute(item.path); }}
                    role="menuitem"
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-1.5 lg:px-1.5 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg transition-all duration-300 lg:text-[11px] xl:text-xs 2xl:text-sm whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent ${
                      active
                        ? `text-white shadow-lg shadow-pink-500/30 active-nav nav-iridescent ${isFlashing ? "tab-click-flash" : ""}`
                        : isDark
                        ? "text-slate-400 hover:text-white hover:bg-slate-800/50 link-iridescent"
                        : "text-gray-500 hover:text-gray-900 hover:bg-gray-100 link-iridescent"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 hidden xl:block" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
              </div>
            </nav>

            {/* Right Side: Theme Toggle + Wallet + Mobile Menu */}
            <div className="flex items-center gap-0.5 sm:gap-1 md:gap-1.5 flex-shrink-0">
              {/* Network Indicator Badge */}
              <Tip content={`Connected to Hedera ${hederaNetwork === "testnet" ? "Testnet" : "Mainnet"}`}>
              <div className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border cursor-default ${
                hederaNetwork === "testnet"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : isDark
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
              }`} role="status" aria-label={`Network: ${hederaNetwork}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  hederaNetwork === "testnet" ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
                }`} />
                {hederaNetwork === "testnet" && (
                  <span className="uppercase tracking-wider">Testnet</span>
                )}
              </div>
              </Tip>

              {/* Social Links */}
              <Tip content="Follow WRAPpDEX on X">
              <a
                href="https://x.com/WRAPpDEX"
                target="_blank"
                rel="noopener noreferrer"
                onMouseEnter={() => { if (vipActive && vipPrefs.features.vip_sounds) playVipNavNote(0); }}
                className={`hidden xl:inline-flex p-2 md:p-2.5 rounded-lg transition-all duration-300 ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 text-slate-300 hover:text-white border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 border border-gray-200"
                }`}
              >
                <svg className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              </Tip>
              <Tip content="Join WRAPpDEX Discord — Community Support">
              <a
                href="https://discord.com/invite/8w36D2TGc"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Join WRAPpDEX Discord community support"
                onMouseEnter={() => { if (vipActive && vipPrefs.features.vip_sounds) playVipNavNote(1); }}
                className={`inline-flex p-2 md:p-2.5 rounded-lg transition-all duration-300 ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 text-slate-300 hover:text-[#5865F2] border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-[#5865F2] border border-gray-200"
                }`}
              >
                <svg className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.074.074 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </a>
              </Tip>

              {/* Theme Toggle */}
              <Tip content={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}>
              <button
                onClick={toggleTheme}
                onMouseEnter={() => { if (vipActive && vipPrefs.features.vip_sounds) playVipNavNote(2); }}
                aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                className={`relative p-2 md:p-2.5 rounded-lg transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 text-yellow-400 border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                }`}
              >
                {isDark ? (
                  <Sun className="w-4 h-4 md:w-5 md:h-5" />
                ) : (
                  <Moon className="w-4 h-4 md:w-5 md:h-5" />
                )}
              </button>
              </Tip>

              {/* Accent Color Toggle — Sky (Blue) ↔ Pink */}
              <Tip content={isSky ? "Switch to Pink accent" : "Switch to Sky accent"}>
              <button
                onClick={toggleAccent}
                onMouseEnter={() => { if (vipActive && vipPrefs.features.vip_sounds) playVipNavNote(3); }}
                className={`hidden sm:inline-flex relative p-2 md:p-2.5 rounded-lg transition-all duration-300 ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 border border-gray-200"
                }`}
              >
                <span className="w-4 h-4 md:w-5 md:h-5 flex items-center justify-center text-sm md:text-base leading-none select-none" role="img" aria-label={isSky ? "Sky Blue mode" : "Pink mode"}>
                  {isSky ? "🩵" : "🩷"}
                </span>
              </button>
              </Tip>

              {/* Sound Toggle */}
              <Tip content={`Sound: ${soundVolume.charAt(0).toUpperCase() + soundVolume.slice(1)} — click to cycle`}>
              <button
                onClick={toggleMute}
                onMouseEnter={() => { if (vipActive && vipPrefs.features.vip_sounds) playVipNavNote(4); }}
                aria-label={`Sound volume: ${soundVolume}. Click to cycle.`}
                aria-pressed={soundVolume !== "off"}
                className={`hidden sm:inline-flex relative p-2 md:p-2.5 rounded-lg transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 border border-gray-200"
                } ${soundVolume === "off" ? (isDark ? "text-slate-500" : "text-gray-400") : (isDark ? "text-pink-400" : "text-pink-600")}`}
              >
                {soundVolume === "off" ? (
                  <VolumeOff className="w-4 h-4 md:w-5 md:h-5" />
                ) : soundVolume === "low" ? (
                  <Volume1 className="w-4 h-4 md:w-5 md:h-5" />
                ) : (
                  <Volume2 className="w-4 h-4 md:w-5 md:h-5" />
                )}
                {/* Volume level indicator bars */}
                {soundVolume !== "off" && (
                  <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 flex gap-px">
                    <span className={`w-1 h-0.5 rounded-full vol-bar-anim ${isDark ? "bg-pink-400" : "bg-pink-500"}`} />
                    <span className={`w-1 h-0.5 rounded-full vol-bar-anim ${soundVolume === "medium" || soundVolume === "high" ? (isDark ? "bg-pink-400" : "bg-pink-500") : (isDark ? "bg-slate-700" : "bg-gray-300")}`} />
                    <span className={`w-1 h-0.5 rounded-full vol-bar-anim ${soundVolume === "high" ? (isDark ? "bg-pink-400" : "bg-pink-500") : (isDark ? "bg-slate-700" : "bg-gray-300")}`} />
                  </span>
                )}
              </button>
              </Tip>

              {/* VIP Crown Button */}
              <Tip content={vipActive ? "VIP Active" : "VIP Features"}>
              <button
                onClick={() => setShowVipPanel(true)}
                onMouseEnter={() => { if (vipActive && vipPrefs.features.vip_sounds) playVipNavNote(5); }}
                aria-label={vipActive ? "VIP Active — Open VIP panel" : "Open VIP Features panel"}
                className={`relative p-2 md:p-2.5 rounded-lg transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 crown-shimmer-hover ${
                  vipActive
                    ? "bg-gradient-to-br from-emerald-600/20 to-teal-600/20 border border-emerald-500/30 text-emerald-400"
                    : isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 border border-pink-500/20 text-slate-400 hover:text-emerald-400"
                    : "bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-500 hover:text-emerald-600"
                }`}
              >
                <Crown className={`w-4 h-4 md:w-5 md:h-5 transition-all duration-300 ${vipActive ? "drop-shadow-[0_0_4px_rgba(16,185,129,0.5)]" : ""}`} />
                {vipActive && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>
              </Tip>

              {/* Wallet Connection */}
              <div className="relative">
                {primaryWallet ? (
                  <div
                    onMouseEnter={handleWalletMouseEnter}
                    onMouseLeave={handleWalletMouseLeave}
                  >
                    <button
                      onClick={() => setShowWalletMenu(!showWalletMenu)}
                      aria-label="Wallet menu"
                      aria-expanded={showWalletMenu}
                      aria-haspopup="true"
                      className={`flex items-center gap-2 md:gap-3 px-2 md:px-4 py-1.5 md:py-2 rounded-lg transition-all duration-300 ${
                        isDark
                          ? "bg-slate-800/50 hover:bg-slate-800 border border-pink-500/20"
                          : "bg-white hover:bg-gray-50 border border-gray-200 shadow-sm"
                      }`}
                    >
                      {primaryWallet.type === "hedera" ? (
                        hashPackProfile?.profilePicture ? (
                          <img
                            src={hashPackProfile.profilePicture}
                            alt={hashPackProfile.username || "Profile"}
                            className="w-7 h-7 md:w-8 md:h-8 rounded-full flex-shrink-0 object-cover ring-2 ring-purple-500/50"
                          />
                        ) : (
                          <img
                            src={partnerLogos.hashpack}
                            alt="HashPack"
                            className="w-7 h-7 md:w-8 md:h-8 rounded-lg flex-shrink-0 object-cover"
                          />
                        )
                      ) : primaryWallet.connector === "MetaMask" ? (
                        <img
                          src={partnerLogos.metamask}
                          alt="MetaMask"
                          className="w-7 h-7 md:w-8 md:h-8 rounded-lg flex-shrink-0 object-cover"
                        />
                      ) : (
                        <div className={`w-7 h-7 md:w-8 md:h-8 bg-gradient-to-br ${getWalletColor(primaryWallet.type)} rounded-lg flex items-center justify-center font-bold text-xs md:text-sm text-white`}>
                          {primaryWallet.connector[0]}
                        </div>
                      )}
                      <div className="text-left hidden sm:block">
                        <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {primaryWallet.type === "hedera" && hashPackProfile?.username
                            ? hashPackProfile.username
                            : primaryWallet.connector}
                        </div>
                        <div className="text-sm font-mono">{formatAddress(primaryWallet.address)}</div>
                        {hederaAccount && primaryWallet.type === "hedera" && (
                          <div className="text-xs text-emerald-400 font-bold">
                            <AnimatedNumber value={hederaAccount.hbarBalance} decimals={2} suffix=" HBAR" /> (~$<AnimatedNumber value={hederaAccount.hbarBalance * hbarPrice} decimals={2} />)
                          </div>
                        )}
                        {metaMaskAccount && primaryWallet.type === "ethereum" && primaryWallet.connector === "MetaMask" && (
                          <div className="text-xs text-orange-400 font-bold">
                            <AnimatedNumber value={parseFloat(metaMaskAccount.balanceEth)} decimals={4} suffix={` ${metaMaskAccount.nativeSymbol}`} /> (~$<AnimatedNumber value={parseFloat(metaMaskAccount.balanceEth) * nativeTokenPrice} decimals={2} />)
                          </div>
                        )}
                      </div>
                    </button>

                    <AnimatePresence>
                    {showWalletMenu && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        role="menu"
                        aria-label="Connected wallets"
                        className="absolute right-0 mt-0 pt-2 w-72 z-50"
                      >
                        <div className={`rounded-xl shadow-xl overflow-hidden ${
                          isDark
                            ? "bg-slate-900 border border-pink-500/30 shadow-pink-500/10"
                            : "bg-white border border-gray-200 shadow-gray-200/50"
                        }`}>
                        <div className={`p-3 border-b ${isDark ? "border-pink-500/20" : "border-gray-100"}`}>
                          <div className={`text-xs mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            Connected Wallets ({connectedWallets.length})
                          </div>
                          {/* HashPack session badges */}
                          {hashPackSession && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold capitalize ${
                                hashPackSession.connectionMethod === "walletconnect"
                                  ? "bg-blue-500/20 text-blue-400"
                                  : "bg-yellow-500/20 text-yellow-400"
                              }`}>
                                {hashPackSession.connectionMethod}
                              </span>
                              {hashPackSession.isVerified && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">
                                  verified
                                </span>
                              )}
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center gap-1">
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                                live
                              </span>
                            </div>
                          )}
                        </div>
                        {connectedWallets.map((wallet) => (
                          <div
                            key={wallet.address}
                            className={`flex items-center justify-between p-3 border-b ${
                              isDark
                                ? "hover:bg-slate-800/50 border-pink-500/10"
                                : "hover:bg-gray-50 border-gray-100"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {wallet.type === "hedera" ? (
                                <img
                                  src={partnerLogos.hashpack}
                                  alt="HashPack"
                                  className="w-8 h-8 rounded-lg flex-shrink-0 object-cover"
                                />
                              ) : wallet.connector === "MetaMask" ? (
                                <img
                                  src={partnerLogos.metamask}
                                  alt="MetaMask"
                                  className="w-8 h-8 rounded-lg flex-shrink-0 object-cover"
                                />
                              ) : (
                                <div className={`w-8 h-8 bg-gradient-to-br ${getWalletColor(wallet.type)} rounded-lg flex items-center justify-center font-bold text-sm text-white`}>
                                  {wallet.connector[0]}
                                </div>
                              )}
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <div className="text-sm font-bold">{wallet.connector}</div>
                                </div>
                                <div className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                  {formatAddress(wallet.address)}
                                </div>
                              </div>
                            </div>
                            <Tip content="Disconnect wallet" side="left">
                            <button
                              onClick={() => disconnectWallet(wallet.address)}
                              className="p-1 hover:bg-red-500/20 rounded transition-colors"
                            >
                              <LogOut className="w-4 h-4 text-red-400" />
                            </button>
                            </Tip>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            setShowWalletMenu(false);
                            setShowWalletModal(true);
                          }}
                          className={`w-full p-3 text-sm transition-colors ${
                            isDark
                              ? "text-pink-400 hover:bg-slate-800/50"
                              : "text-pink-600 hover:bg-gray-50"
                          }`}
                        >
                          + Connect Another Wallet
                        </button>
                        </div>
                      </motion.div>
                    )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowWalletModal(true)}
                    aria-label="Connect crypto wallet"
                    className="px-3 md:px-6 py-1.5 md:py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-pink-500/30 text-white text-sm md:text-base btn-iridescent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50"
                  >
                    <span className="hidden sm:inline">Connect Wallet</span>
                    <span className="sm:hidden">Connect</span>
                  </button>
                )}
              </div>

              {/* Mobile Menu Toggle — REMOVED: Bottom bar "More" now opens a sheet drawer.
                  Single access path eliminates dual-nav confusion on mobile. */}
            </div>
          </div>

          {/* Mobile navigation handled via bottom sheet ("More" button) */}
        </div>
      </header>

      {/* Main Content — wrapped in PullToRefresh for mobile DeFi UX */}
      <main className="flex-1 container mx-auto px-3 md:px-4 py-4 md:py-6 pb-20 lg:pb-6" id="main-content">
        <PullToRefresh>
          <AnimatedOutlet />
        </PullToRefresh>
      </main>

      {/* Footer – Copyright */}
      <footer className={`py-4 px-4 md:px-6 mb-16 lg:mb-0 ${
        isDark
          ? "bg-[#080a12]"
          : "bg-[#f8fafc]"
      }`}>
        <div className="container mx-auto flex items-center justify-between">
          <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            &copy; 2026 WRAPpDEX
          </p>
          <div className="flex items-center gap-3 md:gap-4">
            <Link
              to="/terms"
              className={`text-xs transition-colors ${
                isDark ? "text-slate-600 hover:text-slate-400" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              Terms of Service
            </Link>
            <Link
              to="/privacy"
              className={`text-xs transition-colors ${
                isDark ? "text-slate-600 hover:text-slate-400" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              Privacy Policy
            </Link>
            <Link
              to="/white-paper"
              className={`text-xs transition-colors ${
                isDark ? "text-slate-600 hover:text-slate-400" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              White Paper
            </Link>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation */}
      <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t ${
        isDark
          ? "bg-[#12121a]/95 border-pink-900/20 backdrop-blur-md"
          : "bg-white/95 border-gray-200 backdrop-blur-md"
      }`} aria-label="Bottom navigation">
        <div className="flex justify-around items-center py-1.5 px-1 safe-bottom">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => handleTabClick(item.path)}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg transition-all min-w-[52px] ${
                  active
                    ? `nav-iridescent-mobile ${isDark ? "text-pink-400" : "text-pink-600"}`
                    : isDark
                    ? "text-slate-500"
                    : "text-gray-400"
                }`}
              >
                <Icon className={`w-5 h-5 nav-icon ${active ? "drop-shadow-[0_0_6px_rgba(236,72,153,0.5)]" : ""}`} />
                <span className="text-xs">{item.label}</span>
                {active && (
                  <div className="w-1 h-1 rounded-full nav-dot -mt-0.5" />
                )}
              </Link>
            );
          })}
          <button
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            aria-label="More navigation options"
            aria-expanded={showMobileMenu}
            className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg transition-all min-w-[52px] ${
              isDark ? "text-slate-500" : "text-gray-400"
            }`}
          >
            <Menu className="w-5 h-5" />
            <span className="text-xs">More</span>
          </button>
        </div>
      </nav>

      {/* Wallet Connect Modal */}
      {showWalletModal && <WalletConnectModal onClose={() => setShowWalletModal(false)} />}

      {/* Click outside to close wallet menu — animated backdrop */}
      <AnimatePresence>
      {showWalletMenu && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-40"
          onClick={() => setShowWalletMenu(false)}
          aria-hidden="true"
        />
      )}
      </AnimatePresence>

      {/* VIP Features Panel */}
      <VIPPanel
        open={showVipPanel}
        onClose={() => setShowVipPanel(false)}
        onPrefsChange={setVipPrefs}
      />

      {/* Mobile "More" Bottom Sheet — secondary nav items */}
      <Sheet open={showMobileMenu} onOpenChange={setShowMobileMenu}>
        <SheetContent
          side="bottom"
          className={`rounded-t-2xl ${
            isDark
              ? "bg-[#0f1019] border-t border-pink-500/20"
              : "bg-white border-t border-gray-200"
          }`}
        >
          <SheetHeader className="pb-2">
            <SheetTitle className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
              More
            </SheetTitle>
            <SheetDescription className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Additional sections & tools
            </SheetDescription>
          </SheetHeader>

          <nav className="grid grid-cols-2 gap-2 pb-4 px-1" aria-label="Secondary navigation">
            {secondaryNavItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => {
                    handleTabClick(item.path);
                    setShowMobileMenu(false);
                  }}
                  className={`flex items-center gap-3 p-3.5 rounded-xl transition-all duration-200 ${
                    active
                      ? isDark
                        ? "bg-pink-500/10 border border-pink-500/25 text-pink-400"
                        : "bg-pink-50 border border-pink-200 text-pink-600"
                      : isDark
                      ? "bg-slate-800/40 border border-white/5 text-slate-300 hover:bg-slate-800/70 hover:text-white"
                      : "bg-gray-50 border border-gray-100 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    active
                      ? "bg-pink-500/20"
                      : isDark
                      ? "bg-slate-700/50"
                      : "bg-gray-200/50"
                  }`}>
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight">{item.label}</div>
                    <div className={`text-xs leading-tight mt-0.5 ${
                      isDark ? "text-slate-500" : "text-gray-400"
                    }`}>
                      {item.description}
                    </div>
                  </div>
                  {active && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-pink-500 shrink-0" />
                  )}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>

      {/* Scroll-to-Top floating button */}
      <ScrollToTop />

      {/* Toast notifications — offset on mobile to clear bottom nav */}
      <Toaster
        theme={isDark ? "dark" : "light"}
        position="bottom-right"
        toastOptions={{
          style: {
            background: isDark ? "rgba(15,15,26,0.95)" : undefined,
            border: isDark ? `1px solid ${isSky ? "rgba(14,165,233,0.2)" : "rgba(236,72,153,0.2)"}` : undefined,
            backdropFilter: "blur(12px)",
          },
        }}
        richColors
        closeButton
      />

      <style>{`
        .safe-bottom {
          padding-bottom: env(safe-area-inset-bottom, 4px);
        }
        /* Push toasts above mobile bottom nav (≈60px) on small screens */
        @media (max-width: 1023px) {
          [data-sonner-toaster] {
            --offset: 72px !important;
          }
        }
      `}</style>
    </div>
  );
}
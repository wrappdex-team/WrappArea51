import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { HBARH_BRANDING_DARK, HBARH_BRANDING_LIGHT, HASHPACK_LOGO, METAMASK_LOGO } from "../assets/brand";
import { Outlet, Link, useLocation } from "react-router";
import { TrendingUp, Wallet, History, BarChart3, Vote, ArrowRightLeft, LogOut, Sun, Moon, DollarSign, Menu, X, Volume2, VolumeOff, Droplets, Layers, Crown } from "lucide-react";
import { useWallet } from "../contexts/WalletContext";
import { useTheme } from "../contexts/ThemeContext";
import { WalletConnectModal } from "./WalletConnectModal";
import { formatHbar } from "../utils/hedera";
import { formatAddress } from "../utils/metamask";
import { NewsTicker } from "./NewsTicker";
import { playTabChime, getSoundMuted, setSoundMuted } from "../utils/sounds";
import { Toaster } from "sonner";
import { VIPPanel } from "./VIPPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  isVipEligible,
  loadVipPrefs,
  type VipPrefs,
} from "../utils/vip";
import { SEOHead, ROUTE_SEO } from "./SEOHead";
import { preloadRoute } from "../utils/preload";
import { trackRouteChange } from "../utils/performance";

export function Layout() {
  const location = useLocation();
  const { connectedWallets, disconnectWallet, primaryWallet, hederaAccount, hbarPrice, metaMaskAccount, ethPrice, hashPackProfile, hashPackSession } = useWallet();
  const { theme, toggleTheme, isDark } = useTheme();
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [flashingTab, setFlashingTab] = useState<string | null>(null);
  const lastPathRef = useRef(location.pathname);
  const [soundMuted, _setSoundMuted] = useState(getSoundMuted);
  const [showVipPanel, setShowVipPanel] = useState(false);
  const [vipPrefs, setVipPrefs] = useState<VipPrefs>(loadVipPrefs);

  const { hederaNetwork } = useWallet();
  const tokens = hederaAccount?.tokens ?? [];
  const vipEligible = isVipEligible(tokens, hederaNetwork);
  const vipActive = vipEligible && vipPrefs.active;

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
    _setSoundMuted((prev) => {
      const next = !prev;
      setSoundMuted(next);
      return next;
    });
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
    { path: "/", label: "Markets", icon: TrendingUp },
    { path: "/trading", label: "Trading", icon: BarChart3 },
    { path: "/swap", label: "Swap", icon: ArrowRightLeft },
    { path: "/buy-sell", label: "Buy/Sell", icon: DollarSign },
    { path: "/defi", label: "DeFi", icon: Droplets },
    { path: "/smart-liquidity", label: "Smart Liquidity", shortLabel: "Liquidity", icon: Layers },
    { path: "/wallet", label: "Wallet", icon: Wallet },
    { path: "/history", label: "History", icon: History },
    { path: "/dao", label: "DAO", icon: Vote },
  ];

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const getWalletColor = (type: string) => {
    if (type === "hedera") return "from-purple-500 to-indigo-500";
    if (type === "ethereum") return "from-orange-500 to-amber-500";
    if (type === "solana") return "from-purple-600 to-pink-600";
    return "from-pink-500 to-purple-500";
  };

  // Track route changes for performance monitoring + SEO
  const currentSEO = ROUTE_SEO[location.pathname] || ROUTE_SEO["/"];
  useEffect(() => {
    trackRouteChange(location.pathname);
  }, [location.pathname]);

  return (
    <div className={`min-h-screen ${isDark ? "bg-[#0a0a0f] text-white" : "bg-[#f8fafc] text-slate-900"}`}>
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

      {/* Header */}
      <header className={`border-b sticky top-0 z-50 backdrop-blur-sm ${
        isDark
          ? "border-pink-900/20 bg-[#12121a]/50"
          : "border-gray-200 bg-white/85"
      }`}>
        <div className="container mx-auto px-3 md:px-4 lg:px-5 py-2 md:py-3">
          <div className="flex items-center justify-between gap-2">
            {/* HBAR.ħ Logo — compact on lg to free nav space */}
            <Link to="/" className="flex items-center group flex-shrink-0 ml-1">
              <div className={`relative flex-shrink-0 transition-transform duration-300 ${vipActive ? "animate-vip-pulse" : ""}`}>
                {isDark ? (
                  <div className="h-[60px] md:h-[70px] lg:h-[60px] xl:h-[70px] flex items-center">
                    <img
                      src={HBARH_BRANDING_DARK}
                      alt="Wrappdex Decentralized Exchange"
                      className="h-[54px] md:h-[64px] lg:h-[54px] xl:h-[64px] w-auto object-contain drop-shadow-[0_0_8px_rgba(56,189,248,0.4)]"
                    />
                  </div>
                ) : (
                  <div className="h-[70px] md:h-[85px] lg:h-[70px] xl:h-[80px] flex items-center">
                    <img
                      src={HBARH_BRANDING_LIGHT}
                      alt="Wrappdex Decentralized Exchange"
                      className="h-[64px] md:h-[78px] lg:h-[64px] xl:h-[74px] w-auto object-contain"
                    />
                  </div>
                )}
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center justify-center flex-1 min-w-0 mx-1 xl:mx-3">
              <div className="flex items-center gap-px xl:gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                const isFlashing = flashingTab === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => handleTabClick(item.path)}
                    onMouseEnter={() => preloadRoute(item.path)}
                    className={`flex items-center gap-1 px-2 xl:px-2.5 py-1.5 rounded-lg transition-all duration-300 text-xs xl:text-sm whitespace-nowrap ${
                      active
                        ? `text-white shadow-lg shadow-pink-500/30 active-nav nav-iridescent ${isFlashing ? "tab-click-flash" : ""}`
                        : isDark
                        ? "text-slate-400 hover:text-white hover:bg-slate-800/50 link-iridescent"
                        : "text-gray-500 hover:text-gray-900 hover:bg-gray-100 link-iridescent"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 hidden xl:block" />
                    {item.shortLabel ? (
                      <>
                        <span className="xl:hidden">{item.shortLabel}</span>
                        <span className="hidden xl:inline">{item.label}</span>
                      </>
                    ) : (
                      <span>{item.label}</span>
                    )}
                  </Link>
                );
              })}
              </div>
            </nav>

            {/* Right Side: Theme Toggle + Wallet + Mobile Menu */}
            <div className="flex items-center gap-1 md:gap-1.5 flex-shrink-0">
              {/* Social Links */}
              <a
                href="https://x.com/WRAPpDEX"
                target="_blank"
                rel="noopener noreferrer"
                className={`p-2 md:p-2.5 rounded-lg transition-all duration-300 ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 text-slate-300 hover:text-white border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 border border-gray-200"
                }`}
                title="Follow HBAR.ħ on X"
              >
                <svg className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://discord.gg/tRSZZ9rUJ"
                target="_blank"
                rel="noopener noreferrer"
                className={`p-2 md:p-2.5 rounded-lg transition-all duration-300 ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 text-slate-300 hover:text-[#5865F2] border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-[#5865F2] border border-gray-200"
                }`}
                title="Join HBAR.ħ Discord"
              >
                <svg className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.074.074 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </a>

              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className={`relative p-2 md:p-2.5 rounded-lg transition-all duration-300 ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 text-yellow-400 border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                }`}
                title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {isDark ? (
                  <Sun className="w-4 h-4 md:w-5 md:h-5" />
                ) : (
                  <Moon className="w-4 h-4 md:w-5 md:h-5" />
                )}
              </button>

              {/* Sound Toggle */}
              <button
                onClick={toggleMute}
                className={`relative p-2 md:p-2.5 rounded-lg transition-all duration-300 ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 border border-gray-200"
                } ${soundMuted ? (isDark ? "text-slate-500" : "text-gray-400") : (isDark ? "text-pink-400" : "text-pink-600")}`}
                title={soundMuted ? "Unmute Sounds" : "Mute Sounds"}
              >
                {soundMuted ? (
                  <VolumeOff className="w-4 h-4 md:w-5 md:h-5" />
                ) : (
                  <Volume2 className="w-4 h-4 md:w-5 md:h-5" />
                )}
              </button>

              {/* VIP Crown Button */}
              <button
                onClick={() => setShowVipPanel(true)}
                className={`relative p-2 md:p-2.5 rounded-lg transition-all duration-300 ${
                  vipActive
                    ? "bg-gradient-to-br from-emerald-600/20 to-teal-600/20 border border-emerald-500/30 text-emerald-400"
                    : isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 border border-pink-500/20 text-slate-400 hover:text-emerald-400"
                    : "bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-500 hover:text-emerald-600"
                }`}
                title={vipActive ? "VIP Active" : "VIP Features"}
              >
                <Crown className={`w-4 h-4 md:w-5 md:h-5 ${vipActive ? "drop-shadow-[0_0_4px_rgba(16,185,129,0.5)]" : ""}`} />
                {vipActive && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>

              {/* Wallet Connection */}
              <div className="relative">
                {primaryWallet ? (
                  <div>
                    <button
                      onClick={() => setShowWalletMenu(!showWalletMenu)}
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
                            src={HASHPACK_LOGO}
                            alt="HashPack"
                            className="w-7 h-7 md:w-8 md:h-8 rounded-lg flex-shrink-0 object-cover"
                          />
                        )
                      ) : primaryWallet.connector === "MetaMask" ? (
                        <img
                          src={METAMASK_LOGO}
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
                          {primaryWallet.isDemo && (
                            <span className={`ml-1.5 text-[9px] px-1 py-0.5 rounded font-bold ${
                              isDark ? "bg-yellow-500/10 text-yellow-500/70" : "bg-yellow-50 text-yellow-600"
                            }`}>DEMO</span>
                          )}
                        </div>
                        <div className="text-sm font-mono">{formatAddress(primaryWallet.address)}</div>
                        {hederaAccount && primaryWallet.type === "hedera" && (
                          <div className="text-[10px] text-emerald-400 font-bold">
                            {formatHbar(hederaAccount.hbarBalance)} HBAR (~${(hederaAccount.hbarBalance * hbarPrice).toFixed(2)})
                          </div>
                        )}
                        {metaMaskAccount && primaryWallet.type === "ethereum" && primaryWallet.connector === "MetaMask" && (
                          <div className="text-[10px] text-orange-400 font-bold">
                            {parseFloat(metaMaskAccount.balanceEth).toFixed(4)} {metaMaskAccount.nativeSymbol} (~${(parseFloat(metaMaskAccount.balanceEth) * ethPrice).toFixed(2)})
                          </div>
                        )}
                      </div>
                    </button>

                    {showWalletMenu && (
                      <div className={`absolute right-0 mt-2 w-72 rounded-xl shadow-xl overflow-hidden z-50 ${
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
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold capitalize ${
                                hashPackSession.connectionMethod === "hashconnect"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : hashPackSession.connectionMethod === "walletconnect"
                                    ? "bg-blue-500/20 text-blue-400"
                                    : "bg-yellow-500/20 text-yellow-400"
                              }`}>
                                {hashPackSession.connectionMethod === "mirror-node" ? "read-only" : hashPackSession.connectionMethod}
                              </span>
                              {hashPackSession.isVerified && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">
                                  verified
                                </span>
                              )}
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center gap-1">
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
                                  src={HASHPACK_LOGO}
                                  alt="HashPack"
                                  className="w-8 h-8 rounded-lg flex-shrink-0 object-cover"
                                />
                              ) : wallet.connector === "MetaMask" ? (
                                <img
                                  src={METAMASK_LOGO}
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
                                  {wallet.isDemo && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                                      isDark ? "bg-yellow-500/10 text-yellow-500/70 border border-yellow-500/20" : "bg-yellow-50 text-yellow-600 border border-yellow-200"
                                    }`} title="Simulated demo wallet — not a real blockchain connection">
                                      DEMO
                                    </span>
                                  )}
                                </div>
                                <div className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                  {formatAddress(wallet.address)}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => disconnectWallet(wallet.address)}
                              className="p-1 hover:bg-red-500/20 rounded transition-colors"
                              title="Disconnect"
                            >
                              <LogOut className="w-4 h-4 text-red-400" />
                            </button>
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
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setShowWalletModal(true)}
                    className="px-3 md:px-6 py-1.5 md:py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-pink-500/30 text-white text-sm md:text-base btn-iridescent"
                  >
                    <span className="hidden sm:inline">Connect Wallet</span>
                    <span className="sm:hidden">Connect</span>
                  </button>
                )}
              </div>

              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className={`lg:hidden p-2 rounded-lg transition-all ${
                  isDark
                    ? "bg-slate-800/50 hover:bg-slate-700 border border-pink-500/20"
                    : "bg-gray-100 hover:bg-gray-200 border border-gray-200"
                }`}
              >
                {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Mobile Dropdown Menu */}
          {showMobileMenu && (
            <nav className={`lg:hidden mt-3 pt-3 pb-1 border-t ${isDark ? "border-pink-900/20" : "border-gray-200"}`}>
              <div className="grid grid-cols-4 gap-2">
                {navItems.map((item) => {
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
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-lg transition-all duration-200 text-xs ${
                        active
                          ? "text-white shadow-lg shadow-pink-500/30 nav-iridescent-dropdown"
                          : isDark
                          ? "text-slate-400 hover:text-white hover:bg-slate-800/50"
                          : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </nav>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-3 md:px-4 py-4 md:py-6 pb-20 lg:pb-6" id="main-content">
        <ErrorBoundary isDark={isDark}>
          <Suspense
            fallback={
              <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-10 h-10 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                  <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading…</span>
                </div>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* Footer – Copyright */}
      <footer className={`border-t py-4 px-3 text-center mb-16 lg:mb-0 ${
        isDark
          ? "border-pink-900/20 bg-[#0a0a0f]"
          : "border-gray-200 bg-[#f8fafc]"
      }`}>
        <p className={`text-[10px] md:text-[11px] leading-relaxed ${isDark ? "text-slate-600" : "text-gray-400"}`}>
          &copy; {new Date().getFullYear()} Wrappdex. All rights reserved. Wrappdex is a decentralized exchange on the Hedera network. Trading crypto assets involves significant risk. This platform does not constitute financial advice.
        </p>
        <p className={`text-[9px] md:text-[10px] mt-1.5 ${isDark ? "text-slate-700" : "text-gray-300"}`}>
          BETA VERSION — Not audited. For testing purposes only. Use at your own risk.
        </p>
      </footer>

      {/* Mobile Bottom Navigation */}
      <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t ${
        isDark
          ? "bg-[#12121a]/95 border-pink-900/20 backdrop-blur-md"
          : "bg-white/95 border-gray-200 backdrop-blur-md"
      }`}>
        <div className="flex justify-around items-center py-1.5 px-1 safe-bottom">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => handleTabClick(item.path)}
                className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg transition-all min-w-[52px] ${
                  active
                    ? `nav-iridescent-mobile ${isDark ? "text-pink-400" : "text-pink-600"}`
                    : isDark
                    ? "text-slate-500"
                    : "text-gray-400"
                }`}
              >
                <Icon className={`w-5 h-5 nav-icon ${active ? "drop-shadow-[0_0_6px_rgba(236,72,153,0.5)]" : ""}`} />
                <span className="text-[10px]">{item.label}</span>
                {active && (
                  <div className="w-1 h-1 rounded-full nav-dot -mt-0.5" />
                )}
              </Link>
            );
          })}
          <button
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg transition-all min-w-[52px] ${
              isDark ? "text-slate-500" : "text-gray-400"
            }`}
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px]">More</span>
          </button>
        </div>
      </nav>

      {/* Wallet Connect Modal */}
      {showWalletModal && <WalletConnectModal onClose={() => setShowWalletModal(false)} />}

      {/* Click outside to close menu */}
      {showWalletMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowWalletMenu(false)}
        />
      )}

      {/* VIP Features Panel */}
      <VIPPanel
        open={showVipPanel}
        onClose={() => setShowVipPanel(false)}
        onPrefsChange={setVipPrefs}
      />

      {/* Toast notifications */}
      <Toaster
        theme={isDark ? "dark" : "light"}
        position="bottom-right"
        toastOptions={{
          style: {
            background: isDark ? "rgba(15,15,26,0.95)" : undefined,
            border: isDark ? "1px solid rgba(236,72,153,0.2)" : undefined,
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
      `}</style>
    </div>
  );
}
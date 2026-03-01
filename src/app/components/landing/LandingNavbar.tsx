import { Link } from "react-router";
import { Menu, X, Globe, User, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LandingLogo } from "./LandingLogo";
import { motion, AnimatePresence } from "motion/react";

const BLUE = "#1D63ED";

/* ── Mobile menu items ─────────────────────────────────────────────── */
const MOBILE_NAV_ITEMS = [
  { name: "Brand", href: "/branding", type: "internal" as const },
  { name: "Docs", href: "/white-paper", type: "internal" as const },
  { name: "Global Network", href: "https://www.reddit.com/r/Hedera/", type: "external" as const },
  { name: "DAO Access", href: "/dao", type: "internal" as const },
  { name: "Platform", href: "#platform", type: "anchor" as const },
  { name: "Roadmap", href: "#roadmap", type: "anchor" as const },
  { name: "Ecosystem", href: "#ecosystem", type: "anchor" as const },
  { name: "Network", href: "#network", type: "anchor" as const },
  { name: "About Us", href: "#about", type: "anchor" as const },
];

/* ── Mobile Full-Screen Menu (portalled to body) ───────────────────── */
function MobileMenu({ onClose }: { onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleNavClick = (href: string) => {
    onClose();
    // For anchor links, smooth scroll after menu closes
    if (href.startsWith("#")) {
      setTimeout(() => {
        const el = document.querySelector(href);
        el?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  const renderItem = (item: typeof MOBILE_NAV_ITEMS[number], i: number) => {
    const inner = (
      <div className="flex items-center justify-between py-[14px] px-1 group">
        <span className="text-[13px] font-bold uppercase tracking-[0.16em] text-slate-700 group-hover:text-[#1D63ED] transition-colors">
          {item.name}
        </span>
        <ChevronRight size={14} className="text-slate-300 group-hover:text-[#1D63ED] transition-colors" />
      </div>
    );

    const cls = "block border-b border-slate-100 last:border-b-0";

    if (item.type === "external") {
      return (
        <a key={item.name} href={item.href} target="_blank" rel="noopener noreferrer"
          onClick={() => onClose()} className={cls}>
          {inner}
        </a>
      );
    }
    if (item.type === "internal") {
      return (
        <Link key={item.name} to={item.href} onClick={() => onClose()} className={cls}>
          {inner}
        </Link>
      );
    }
    return (
      <a key={item.name} href={item.href}
        onClick={(e) => { e.preventDefault(); handleNavClick(item.href); }}
        className={cls}>
        {inner}
      </a>
    );
  };

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        backgroundColor: "#ffffff",
        display: "flex",
        flexDirection: "column",
      }}
      className="md:hidden"
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          height: 64,
          paddingLeft: 20,
          paddingRight: 12,
          borderBottom: "1px solid #f1f5f9",
        }}
      >
        <Link to="/" onClick={onClose} className="flex items-center">
          <LandingLogo className="text-[1.65rem]" />
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="p-2 text-slate-500 hover:text-black transition-colors cursor-pointer"
          aria-label="Close menu"
        >
          <X size={22} strokeWidth={2.5} />
        </button>
      </div>

      {/* ── Scrollable nav items ───────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ padding: "8px 20px 24px" }}
      >
        <nav className="flex flex-col">
          {MOBILE_NAV_ITEMS.map(renderItem)}
        </nav>

        {/* ── CTA ───────────────────────────────────────────────────── */}
        <div style={{ marginTop: 28 }}>
          <Link to="/markets" className="block" onClick={onClose}>
            <button
              type="button"
              className="w-full cursor-pointer flex items-center justify-center gap-2"
              style={{
                height: 52,
                backgroundColor: "#0f172a",
                color: "#ffffff",
                fontWeight: 900,
                fontSize: 11,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                borderRadius: 8,
                border: "none",
                boxShadow: "0 4px 20px -4px rgba(0,0,0,0.2)",
              }}
            >
              Launch App
              <ArrowRight size={14} />
            </button>
          </Link>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Main Navbar ───────────────────────────────────────────────────── */
export function LandingNavbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleLogoClick = (e: React.MouseEvent) => {
    if (window.location.pathname === "/") {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          scrolled
            ? "bg-white/90 backdrop-blur-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_8px_24px_-8px_rgba(0,0,0,0.04)] py-0"
            : "bg-white/0 py-2"
        }`}
        style={{ borderBottom: scrolled ? "1px solid rgba(226,232,240,0.6)" : "none" }}
      >
        {/* Top Utility Nav */}
        <AnimatePresence>
          {!scrolled && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="hidden md:flex border-b border-slate-100 bg-slate-50/50 py-2 overflow-hidden"
            >
              <div className="container mx-auto px-4 flex justify-end gap-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                <Link
                  to="/branding"
                  className="flex items-center gap-1.5 hover:text-[#1D63ED] transition-colors"
                >
                  Brand Identity
                </Link>
                <Link
                  to="/white-paper"
                  className="flex items-center gap-1.5 hover:text-[#1D63ED] transition-colors"
                >
                  Docs
                </Link>
                <a
                  href="https://www.reddit.com/r/Hedera/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-[#1D63ED] transition-colors"
                >
                  <Globe size={10} />
                  Global Network
                </a>
                <Link
                  to="/dao"
                  className="flex items-center gap-1.5 hover:text-[#1D63ED] transition-colors"
                >
                  <User size={10} />
                  DAO Access
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="container mx-auto px-4 h-16 md:h-20 flex items-center justify-between">
          <div className="flex items-center gap-12">
            <Link
              to="/"
              onClick={handleLogoClick}
              className="flex items-center transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <LandingLogo className="text-[1.65rem] md:text-[1.85rem]" />
            </Link>

            {/* Desktop Nav Links */}
            <div className="hidden lg:flex items-center gap-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">
              {[
                { name: "Platform", href: "#platform" },
                { name: "Roadmap", href: "#roadmap" },
                { name: "Ecosystem", href: "#ecosystem" },
                { name: "Network", href: "#network" },
                { name: "About Us", href: "#about" },
              ].map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  className="hover:text-[#1D63ED] transition-colors relative group py-2"
                >
                  {item.name}
                  <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-[#1D63ED] transition-all duration-300 group-hover:w-full" />
                </a>
              ))}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6">
            <Link to="/markets">
              <button type="button" className="border-2 border-slate-900 text-slate-900 font-black uppercase tracking-[0.2em] text-[10px] h-11 px-8 hover:bg-slate-900 hover:text-white transition-all duration-300 cursor-pointer rounded-sm">
                Launch App
              </button>
            </Link>
          </div>

          {/* Mobile Toggle */}
          <button
            type="button"
            className="md:hidden text-black p-2 cursor-pointer"
            onClick={() => setIsOpen((v) => !v)}
            aria-label={isOpen ? "Close menu" : "Open menu"}
            aria-expanded={isOpen}
          >
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </nav>

      {/* Mobile menu — portalled to body, completely independent */}
      {isOpen && <MobileMenu onClose={() => setIsOpen(false)} />}
    </>
  );
}

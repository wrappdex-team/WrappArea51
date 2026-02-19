import { Link } from "react-router";
import { Menu, X, Globe, User, ChevronDown } from "lucide-react";
import { useState, useEffect } from "react";
import { LandingLogo } from "./LandingLogo";
import { motion, AnimatePresence } from "motion/react";

const BLUE = "#1D63ED";

export function LandingNavbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleLogoClick = (e: React.MouseEvent) => {
    if (window.location.pathname === "/") {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-white/80 backdrop-blur-md border-b border-white/20 shadow-lg py-0"
          : "bg-white py-2"
      }`}
      style={{ borderWidth: scrolled ? undefined : 0 }}
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
            <LandingLogo className="text-2xl md:text-3xl" />
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
            <button className="border border-black text-black font-black uppercase tracking-[0.2em] text-[10px] h-11 px-8 hover:bg-black hover:text-white transition-all shadow-sm hover:shadow-xl hover:translate-y-[-1px] cursor-pointer">
              Launch App
            </button>
          </Link>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden text-black p-2 cursor-pointer"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Nav */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="md:hidden fixed inset-0 top-16 bg-white z-40 p-8 flex flex-col gap-8 text-left"
          >
            <div className="flex flex-col gap-6 text-sm font-black uppercase tracking-[0.2em]">
              {[
                { name: "Brand", href: "/branding", internal: true },
                { name: "Docs", href: "/white-paper", internal: true },
                { name: "Global Network", href: "https://www.reddit.com/r/Hedera/", external: true },
                { name: "DAO Access", href: "/dao", internal: true },
                { name: "Platform", href: "#platform" },
                { name: "Roadmap", href: "#roadmap" },
                { name: "Ecosystem", href: "#ecosystem" },
                { name: "Network", href: "#network" },
                { name: "About Us", href: "#about" },
              ].map((item) =>
                item.external ? (
                  <a
                    key={item.name}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsOpen(false)}
                    className="flex items-center justify-between border-b border-slate-100 pb-4 text-black"
                  >
                    {item.name}
                    <ChevronDown className="-rotate-90 text-slate-300" size={16} />
                  </a>
                ) : item.internal ? (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={() => setIsOpen(false)}
                    className="flex items-center justify-between border-b border-slate-100 pb-4 text-black"
                  >
                    {item.name}
                    <ChevronDown className="-rotate-90 text-slate-300" size={16} />
                  </Link>
                ) : (
                  <a
                    key={item.name}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className="flex items-center justify-between border-b border-slate-100 pb-4 text-black"
                  >
                    {item.name}
                    <ChevronDown className="-rotate-90 text-slate-300" size={16} />
                  </a>
                )
              )}
            </div>
            <div className="mt-auto">
              <Link to="/markets" className="w-full block" onClick={() => setIsOpen(false)}>
                <button className="bg-black text-white font-black w-full h-14 uppercase tracking-[0.2em] text-xs shadow-2xl cursor-pointer">
                  Launch App
                </button>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
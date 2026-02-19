import { Link } from "react-router";
import { Twitter, Linkedin } from "lucide-react";
import { LandingLogo } from "./LandingLogo";

const DiscordIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.334-.946 2.419-2.157 2.419z" />
  </svg>
);

export function LandingFooter() {
  return (
    <footer className="bg-white pt-32 pb-12" style={{ borderTop: "1px solid #e2e8f0" }}>
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-16 mb-24">
          <div className="col-span-1 md:col-span-2">
            <Link to="/" className="inline-block mb-10 transition-opacity hover:opacity-80">
              <LandingLogo className="text-2xl" />
            </Link>
            <p className="text-slate-400 max-w-sm mb-10 leading-relaxed text-sm font-medium" style={{ fontFamily: "'Inter', sans-serif" }}>
              Wrappdex provides international decentralized custody and liquidity settlement.
              Secure, transparent infrastructure built for high-performance global operations.
            </p>
            <div className="flex gap-4">
              <a
                href="https://x.com/WRAPpDEX"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 flex items-center justify-center hover:bg-black hover:text-white transition-all text-black"
                style={{ border: "1px solid #e2e8f0" }}
              >
                <Twitter size={16} />
              </a>
              <a
                href="https://discord.com/invite/ZFnfRFxQZ"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 flex items-center justify-center hover:bg-black hover:text-white transition-all text-black"
                style={{ border: "1px solid #e2e8f0" }}
              >
                <DiscordIcon className="w-4 h-4" />
              </a>
              <a
                href="https://www.linkedin.com/company/wrappdex"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 flex items-center justify-center hover:bg-black hover:text-white transition-all text-black"
                style={{ border: "1px solid #e2e8f0" }}
              >
                <Linkedin size={16} />
              </a>
            </div>
          </div>

          <div>
            <h4 className="font-black mb-8 text-black uppercase tracking-[0.2em] text-[10px]">Ecosystem</h4>
            <ul className="space-y-4 text-slate-400 text-xs font-bold uppercase tracking-widest">
              <li>
                <a href="https://hedera.com" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">
                  Hedera Site
                </a>
              </li>
              <li>
                <a href="https://www.saucerswap.finance/" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">
                  SaucerSwap
                </a>
              </li>
              <li>
                <a href="https://bonzo.finance/" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">
                  Bonzo Finance
                </a>
              </li>
              <li>
                <a href="https://portal.hedera.com" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">
                  Hedera Portal
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-black mb-8 text-black uppercase tracking-[0.2em] text-[10px]">Bridging</h4>
            <ul className="space-y-4 text-slate-400 text-xs font-bold uppercase tracking-widest">
              <li>
                <a href="https://www.squidrouter.com/" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">
                  Squid Router
                </a>
              </li>
              <li>
                <a href="https://www.hashport.network/" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">
                  Hashport
                </a>
              </li>
              <li>
                <a href="https://stargate.finance/" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">
                  Stargate
                </a>
              </li>
              <li>
                <a href="https://changenow.io/" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">
                  ChangeNOW
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-black mb-8 text-black uppercase tracking-[0.2em] text-[10px]">Network</h4>
            <a
              href="https://hedera.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 p-5 bg-slate-50 hover:bg-white transition-all group"
              style={{ border: "1px solid #e2e8f0" }}
            >
              <img
                src="https://www.google.com/s2/favicons?domain=hedera.com&sz=128"
                className="w-5 h-5 object-contain grayscale group-hover:grayscale-0 transition-all"
                alt="Hedera"
              />
              <span className="font-black text-black text-[10px] uppercase tracking-[0.2em]">
                Powered by Hedera
              </span>
            </a>
          </div>
        </div>

        <div className="pt-16" style={{ borderTop: "1px solid #e2e8f0" }}>
          <div className="flex flex-col md:flex-row justify-between items-start gap-12 text-[10px] text-slate-400 font-medium uppercase tracking-[0.2em]">
            <div className="max-w-5xl">
              <p className="mb-8 font-black text-black text-xs">
                &copy; 2026 Wrappdex. Leading International Institutional Infrastructure.
              </p>
            </div>
            <div className="flex gap-8 whitespace-nowrap pt-12 md:pt-16">
              <Link to="/privacy" className="hover:text-black transition-colors">
                Privacy Policy
              </Link>
              <Link to="/terms" className="hover:text-black transition-colors">
                Terms of Use
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
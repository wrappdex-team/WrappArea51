/** WRAPpDEX institutional wordmark — exact match to wrapp.finance */

interface LandingLogoProps {
  className?: string;
  inverted?: boolean;
}

export function LandingLogo({ className = "", inverted = false }: LandingLogoProps) {
  return (
    <div className={`flex items-baseline font-black tracking-[-0.05em] leading-none select-none ${className}`}>
      <span className={`transition-colors duration-500 font-sans ${inverted ? "text-white" : "text-black"}`}>
        WRAP
      </span>
      <span className="text-[#1D63ED] italic transform -skew-x-6 font-sans">p</span>
      <span className={`text-[0.45em] ml-2 font-black uppercase tracking-[0.3em] transition-colors duration-500 font-sans opacity-80 ${inverted ? "text-white/60" : "text-slate-500"}`}>
        Dex
      </span>
    </div>
  );
}

/** WRAPpDEX institutional wordmark — exact match to wrappdex.io */

interface LandingLogoProps {
  className?: string;
  inverted?: boolean;
}

export function LandingLogo({ className = "", inverted = false }: LandingLogoProps) {
  return (
    <div className={`flex items-baseline leading-none select-none ${className}`}>
      <span
        className={`font-black tracking-[-0.04em] transition-colors duration-500 font-sans ${inverted ? "text-white" : "text-slate-900"}`}
        style={{ letterSpacing: "-0.03em" }}
      >
        WRAP
      </span>
      <span
        className="italic font-black font-sans"
        style={{
          color: "#1D63ED",
          letterSpacing: "-0.04em",
          transform: "skewX(-8deg)",
          display: "inline-block",
          marginLeft: "-0.02em",
        }}
      >
        p
      </span>
      <span
        className={`font-black uppercase font-sans transition-colors duration-500 ${inverted ? "text-white/50" : "text-slate-400"}`}
        style={{
          fontSize: "0.38em",
          letterSpacing: "0.35em",
          marginLeft: "0.35em",
          verticalAlign: "baseline",
        }}
      >
        DEX
      </span>
    </div>
  );
}
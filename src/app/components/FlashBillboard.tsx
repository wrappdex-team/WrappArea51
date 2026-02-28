import { useRef, useEffect, useState, useMemo } from "react";
import { useTheme } from "../contexts/ThemeContext";

// ── Retro 90s flash-billboard marquee ──────────────────────────────────
// IMPLEMENTATION NOTE: Warm-sunlight palette — close to white with a
// gentle warm tint (~4500K colour temperature), like natural sunlight
// through a window. Dark mode uses warm-white text on deep charcoal;
// light mode uses warm dark-brown on a soft cream field.

const MESSAGES = [
  "HEDERA QUICK EXCHANGE",
  "BRIDGE ANYWHERE — WRAPLESS IN MINUTES",
  "TOP UP OR TAKE HOME!!",
  "SWAP • BRIDGE • BUY WITH CARD",
  "NEAR-ZERO FEES • ~2s FINALITY",
  "ON-CHAIN • NON-CUSTODIAL • INSTANT",
];

const PALETTE = {
  dark: {
    text: "rgb(255, 248, 230)",
    textDim: "rgba(255, 248, 230, 0.55)",
    sep: "rgba(255, 248, 230, 0.2)",
    led: "rgba(255, 245, 220, 0.7)",
    border: "rgba(255, 245, 220, 0.18)",
    bg: "linear-gradient(135deg, rgba(18, 18, 22, 0.97) 0%, rgba(12, 12, 16, 0.99) 100%)",
    scanline: "rgba(255, 248, 230, 0.08)",
    edgeGlow: "rgba(255, 245, 220, 0.3)",
    fadeSolid: "rgba(15, 15, 19, 1)",
    shadow: "inset 0 1px 0 rgba(255, 248, 230, 0.04), 0 0 20px rgba(255, 245, 220, 0.03)",
    glowLo: "0 0 6px rgba(255, 248, 230, 0.2), 0 0 16px rgba(255, 245, 220, 0.04)",
    glowHi: "0 0 14px rgba(255, 248, 230, 0.6), 0 0 36px rgba(255, 245, 220, 0.18), 0 0 60px rgba(255, 240, 210, 0.06)",
    glowMax: "0 0 20px rgba(255, 252, 240, 0.9), 0 0 50px rgba(255, 248, 230, 0.3), 0 0 80px rgba(255, 240, 210, 0.1)",
    flicker: "rgba(255, 248, 230, 0.02)",
  },
  light: {
    text: "rgb(90, 75, 55)",
    textDim: "rgba(90, 75, 55, 0.45)",
    sep: "rgba(90, 75, 55, 0.18)",
    led: "rgba(160, 140, 100, 0.5)",
    border: "rgba(200, 185, 155, 0.4)",
    bg: "linear-gradient(135deg, rgba(255, 252, 245, 0.98) 0%, rgba(252, 248, 238, 0.99) 100%)",
    scanline: "rgba(90, 75, 55, 0.04)",
    edgeGlow: "rgba(200, 185, 155, 0.3)",
    fadeSolid: "rgba(255, 252, 245, 1)",
    shadow: "inset 0 1px 0 rgba(200, 185, 155, 0.12), 0 1px 4px rgba(90, 75, 55, 0.06)",
    glowLo: "0 0 4px rgba(160, 140, 100, 0.12)",
    glowHi: "0 0 8px rgba(160, 140, 100, 0.28), 0 0 20px rgba(160, 140, 100, 0.08)",
    glowMax: "0 0 12px rgba(180, 160, 120, 0.4), 0 0 30px rgba(180, 160, 120, 0.12)",
    flicker: "rgba(160, 140, 100, 0.02)",
  },
} as const;

// Generate stable random animation params per word across both strip copies
function useRandomOffsets(count: number) {
  return useMemo(() => {
    const offsets: { delay: number; duration: number; anim: string }[] = [];
    const anims = ["bb-pulse-a", "bb-pulse-b", "bb-pulse-c", "bb-flicker"];
    for (let i = 0; i < count; i++) {
      offsets.push({
        delay: Math.random() * 6,
        duration: 2.2 + Math.random() * 3.5,
        anim: anims[Math.floor(Math.random() * anims.length)],
      });
    }
    return offsets;
  }, [count]);
}

export function FlashBillboard() {
  const { isDark } = useTheme();
  const p = isDark ? PALETTE.dark : PALETTE.light;
  const innerRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(50);

  // Flatten messages into individual words for per-word animation
  const words = useMemo(() => {
    const result: { text: string; isSep: boolean }[] = [];
    MESSAGES.forEach((msg, mi) => {
      const parts = msg.split(" ");
      parts.forEach((word, wi) => {
        result.push({ text: word, isSep: false });
      });
      if (mi < MESSAGES.length - 1) {
        result.push({ text: "✦", isSep: true });
      }
    });
    return result;
  }, []);

  const offsets = useRandomOffsets(words.length);

  // Measure content width → set scroll duration to match news ticker speed
  useEffect(() => {
    if (!innerRef.current) return;
    const halfWidth = innerRef.current.scrollWidth / 2;
    const pxPerSec = 55;
    setDuration(Math.max(25, Math.round(halfWidth / pxPerSec)));
  }, []);

  const renderStrip = (copyIdx: number) => (
    <span key={copyIdx} className="inline-flex items-center gap-0">
      {words.map((w, i) => {
        const o = offsets[i];
        if (w.isSep) {
          return (
            <span
              key={`${copyIdx}-sep-${i}`}
              className="mx-4 inline-block"
              style={{
                color: p.sep,
                fontSize: "0.85rem",
                animation: `bb-sep-spin 4s linear infinite ${o.delay}s`,
              }}
            >
              ✦
            </span>
          );
        }
        return (
          <span
            key={`${copyIdx}-w-${i}`}
            className="inline-block mx-[0.22em]"
            style={{
              color: p.text,
              animation: `${o.anim} ${o.duration}s ease-in-out infinite ${o.delay}s`,
              fontFamily: "'Courier New', 'Lucida Console', 'Monaco', monospace",
              fontSize: "1.45rem",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              lineHeight: 1,
            }}
          >
            {w.text}
          </span>
        );
      })}
    </span>
  );

  return (
    <div
      className="relative flex-1 min-w-0 overflow-hidden rounded-lg border"
      style={{
        borderColor: p.border,
        background: p.bg,
        boxShadow: p.shadow,
      }}
    >
      {/* Scanline overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-10 opacity-[0.03]"
        style={{
          backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${p.scanline} 2px, ${p.scanline} 4px)`,
        }}
      />

      {/* Random flicker overlay — simulates voltage wobble */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: p.flicker,
          animation: "bb-voltage 0.15s steps(2) infinite",
        }}
      />

      {/* Top edge glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px z-20"
        style={{
          background: `linear-gradient(90deg, transparent 5%, ${p.edgeGlow} 50%, transparent 95%)`,
        }}
      />

      {/* Bottom edge glow */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px z-20"
        style={{
          background: `linear-gradient(90deg, transparent 15%, ${isDark ? "rgba(255, 245, 220, 0.15)" : "rgba(200, 185, 155, 0.15)"} 50%, transparent 85%)`,
        }}
      />

      {/* Left/right fade masks */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-10 z-20"
        style={{
          background: `linear-gradient(90deg, ${p.fadeSolid} 0%, transparent 100%)`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-10 z-20"
        style={{
          background: `linear-gradient(270deg, ${p.fadeSolid} 0%, transparent 100%)`,
        }}
      />

      {/* Corner LEDs */}
      {[
        { pos: "top-1.5 left-1.5", d: 0 },
        { pos: "top-1.5 right-1.5", d: 0.6 },
        { pos: "bottom-1.5 left-1.5", d: 1.2 },
        { pos: "bottom-1.5 right-1.5", d: 1.8 },
      ].map((led, i) => (
        <div
          key={i}
          className={`absolute ${led.pos} w-1.5 h-1.5 rounded-full z-20`}
          style={{
            background: p.led,
            animation: `bb-led 2.4s ease-in-out infinite ${led.d}s`,
          }}
        />
      ))}

      {/* Scrolling marquee strip */}
      <div className="relative h-11 flex items-center justify-center overflow-hidden">
        <div
          ref={innerRef}
          className="bb-scroll inline-flex items-center whitespace-nowrap select-none leading-none"
          style={{
            ["--bb-dur" as string]: `${duration}s`,
            marginTop: "1px",
          }}
        >
          {renderStrip(0)}
          {renderStrip(1)}
        </div>
      </div>

      {/* Keyframes — all animations injected once */}
      <style>{`
        @keyframes bb-marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .bb-scroll {
          animation: bb-marquee var(--bb-dur, 50s) linear infinite;
        }
        .bb-scroll:hover {
          animation-play-state: paused;
        }

        /* Three pulse variants with different intensities for randomness */
        @keyframes bb-pulse-a {
          0%, 100% { text-shadow: ${p.glowLo}; opacity: 0.85; }
          50%      { text-shadow: ${p.glowHi}; opacity: 1; }
        }
        @keyframes bb-pulse-b {
          0%, 100% { text-shadow: ${p.glowLo}; opacity: 0.75; transform: scale(1); }
          35%      { text-shadow: ${p.glowMax}; opacity: 1; transform: scale(1.04); }
          70%      { text-shadow: ${p.glowHi}; opacity: 0.9; transform: scale(1); }
        }
        @keyframes bb-pulse-c {
          0%, 20%, 100% { text-shadow: ${p.glowLo}; opacity: 0.8; }
          10%           { text-shadow: ${p.glowMax}; opacity: 1; }
          60%           { text-shadow: ${p.glowHi}; opacity: 0.95; }
        }

        /* Rapid flicker — like a bulb about to pop */
        @keyframes bb-flicker {
          0%, 18%, 22%, 25%, 53%, 57%, 100% {
            text-shadow: ${p.glowHi};
            opacity: 1;
          }
          20%, 24%, 55% {
            text-shadow: none;
            opacity: 0.4;
          }
        }

        /* Separator diamond spin */
        @keyframes bb-sep-spin {
          0%   { transform: rotate(0deg) scale(1); opacity: 0.4; }
          50%  { transform: rotate(180deg) scale(1.3); opacity: 0.8; }
          100% { transform: rotate(360deg) scale(1); opacity: 0.4; }
        }

        /* Voltage wobble for the whole panel */
        @keyframes bb-voltage {
          0%   { opacity: 0; }
          50%  { opacity: 1; }
          100% { opacity: 0; }
        }

        /* Corner LEDs */
        @keyframes bb-led {
          0%, 100% { opacity: 0.2; box-shadow: none; }
          50%      { opacity: 1; box-shadow: 0 0 6px ${p.led}; }
        }
      `}</style>
    </div>
  );
}
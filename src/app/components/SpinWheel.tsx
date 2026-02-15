import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence, useMotionValue, animate as motionAnimate } from "motion/react";
import {
  Gift,
  Ticket,
  Clock,
  Share2,
  Copy,
  CheckCircle2,
  X,
  PartyPopper,
  Sparkles,
  Trophy,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { HBARH_LOGO_DARK as hbarhLogo } from "../assets/brand";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { getSessionToken } from "../utils/auth";
import { verifyVipEligibilityDirect } from "../utils/vip";

// ═══════════════════════════════════════════════════════════════════════
// SpinWheel — Client is display-only. All outcomes are server-authoritative.
//   - Win/lose decided by POST /spin (CSPRNG, uniform 2% odds, 24h cooldown)
//   - Ticket IDs generated server-side
//   - No wallet addresses hardcoded in this file
//   - Math.random() below is COSMETIC ONLY (sparkles, confetti, audio jitter)
// ═══════════════════════════════════════════════════════════════════════

// ── Config ─────────────────────────────────────────────────────────

/** Cooldown between spins in milliseconds (24 hours). */
const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** localStorage key prefix for spin tracking */
const SPIN_STORAGE_KEY = "hbarh_dao_spin_";

/** Discord invite link for prize claims */
const DISCORD_LINK = "https://discord.gg/ZFnfRFxQZ";

/** Supabase API base URL for winner endpoints */
const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

// ── Firework colors ─────────────────────────────────────────────────

const FW_COLORS = ["#ec4899", "#a855f7", "#fbbf24", "#22c55e", "#3b82f6", "#f43f5e", "#06b6d4", "#f97316", "#ffffff"];

// ── Wheel Segments ──────────────────────────────────────────────────

interface WheelSegment {
  label: string;
  color: string;
  textColor: string;
  isWinner: boolean;
}

const SEGMENTS: WheelSegment[] = [
  { label: "Try Again", color: "#1e1b4b", textColor: "#c4b5fd", isWinner: false },
  { label: "Almost!", color: "#172554", textColor: "#93c5fd", isWinner: false },
  { label: "So Close", color: "#1e1b4b", textColor: "#c4b5fd", isWinner: false },
  { label: "Not Yet", color: "#172554", textColor: "#93c5fd", isWinner: false },
  { label: "Try Again", color: "#1e1b4b", textColor: "#c4b5fd", isWinner: false },
  { label: "HBAR.h", color: "#4a1942", textColor: "#ec4899", isWinner: true },
  { label: "Not Yet", color: "#172554", textColor: "#93c5fd", isWinner: false },
  { label: "Almost!", color: "#1e1b4b", textColor: "#c4b5fd", isWinner: false },
  { label: "Try Again", color: "#172554", textColor: "#93c5fd", isWinner: false },
  { label: "So Close", color: "#1e1b4b", textColor: "#c4b5fd", isWinner: false },
  { label: "Not Yet", color: "#172554", textColor: "#93c5fd", isWinner: false },
  { label: "Almost!", color: "#1e1b4b", textColor: "#c4b5fd", isWinner: false },
];

const SEGMENT_COUNT = SEGMENTS.length;
const SEGMENT_ANGLE = 360 / SEGMENT_COUNT;

// The winning segment index
const WINNER_INDEX = SEGMENTS.findIndex((s) => s.isWinner);

// ── Helpers ─────────────────────────────────────────────────────────

function getLastSpinTime(accountId: string): number {
  try {
    const raw = localStorage.getItem(SPIN_STORAGE_KEY + accountId);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function setLastSpinTime(accountId: string, time: number) {
  try {
    localStorage.setItem(SPIN_STORAGE_KEY + accountId, String(time));
  } catch {
    /* non-critical */
  }
}

function getTimeUntilNextSpin(accountId: string): number {
  const last = getLastSpinTime(accountId);
  if (!last) return 0;
  const remaining = SPIN_COOLDOWN_MS - (Date.now() - last);
  return Math.max(0, remaining);
}

function formatCountdown(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// ── Winner History (Supabase Backend) ────────────────────────────────

interface WinnerRecord {
  accountId: string;
  ticketId: string;
  timestamp: number;
}

async function fetchWinnerHistory(): Promise<WinnerRecord[]> {
  try {
    const res = await fetch(`${API_BASE}/winners`, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.winners ?? []) as WinnerRecord[];
  } catch {
    return [];
  }
}

interface SpinResult {
  win: boolean;
  ticketId: string | null;
  segmentIndex: number;
  spinDelta: number;
  timestamp: number;
  winners?: WinnerRecord[];
  canSpin?: boolean;
  cooldownMs?: number;
  error?: string;
}

async function requestSpin(accountId: string): Promise<SpinResult | null> {
  try {
    const sessionToken = getSessionToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${publicAnonKey}`,
    };
    if (sessionToken) headers["X-Session-Token"] = sessionToken;

    const res = await fetch(`${API_BASE}/spin`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { win: false, ticketId: null, segmentIndex: 0, spinDelta: 0, timestamp: 0, error: data.error || "Spin failed", canSpin: data.canSpin, cooldownMs: data.cooldownMs };
    }
    return data as SpinResult;
  } catch {
    return null;
  }
}

// ── Wheel Drawing (Canvas) ──────────────────────────────────────────

function drawWheel(
  canvas: HTMLCanvasElement,
  logoImg: HTMLImageElement | null,
  displaySize: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = displaySize;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 4;

  ctx.clearRect(0, 0, size, size);

  // Draw segments
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const seg = SEGMENTS[i];
    const startAngle = (i * SEGMENT_ANGLE - 90) * (Math.PI / 180);
    const endAngle = ((i + 1) * SEGMENT_ANGLE - 90) * (Math.PI / 180);

    // Fill segment
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();

    if (seg.isWinner) {
      // Gradient for winner segment
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, "#831843");
      grad.addColorStop(0.5, "#9d174d");
      grad.addColorStop(1, "#be185d");
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = seg.color;
    }
    ctx.fill();

    // Segment border
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw text/logo
    ctx.save();
    ctx.translate(cx, cy);
    const midAngle = (startAngle + endAngle) / 2;
    ctx.rotate(midAngle);

    if (seg.isWinner && logoImg) {
      // "WINNER" text on the winning segment
      ctx.fillStyle = "#fbbf24";
      ctx.font = `bold ${Math.round(radius * 0.09)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("WINNER", radius * 0.6, 0);
    } else {
      // Regular segment label — bright white text
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(radius * 0.08)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(seg.label, radius * 0.62, 0);
    }

    ctx.restore();
  }

  // Center circle (hub) — larger to hold the logo
  const hubRadius = radius * 0.2;
  const hubGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, hubRadius);
  hubGrad.addColorStop(0, "#ec4899");
  hubGrad.addColorStop(1, "#7c3aed");
  ctx.beginPath();
  ctx.arc(cx, cy, hubRadius, 0, Math.PI * 2);
  ctx.fillStyle = hubGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,250,0.3)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw logo dead center (replaces "SPIN" text)
  if (logoImg) {
    const logoSize = hubRadius * 1.5;
    ctx.save();
    // Clip to circle so logo is round
    ctx.beginPath();
    ctx.arc(cx, cy, hubRadius - 3, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      logoImg,
      cx - logoSize / 2,
      cy - logoSize / 2,
      logoSize,
      logoSize,
    );
    ctx.restore();
    // Re-draw the ring on top after clipping
    ctx.beginPath();
    ctx.arc(cx, cy, hubRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,250,0.4)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
    // Fallback text if logo didn't load
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(radius * 0.07)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SPIN", cx, cy);
  }

  // Outer ring glow
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(236, 72, 153, 0.4)";
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ── Fireworks Overlay Component ─────────────────────────────────────
// Full-screen canvas-based fireworks that play on win BEFORE the ticket.

function FireworksOverlay({ onComplete }: { onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Size canvas to viewport
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Audio context for firework sounds
    try { audioRef.current = new AudioContext(); } catch { /* silent */ }

    // Firework particle types
    interface Particle {
      x: number; y: number;
      vx: number; vy: number;
      life: number; maxLife: number;
      color: string;
      size: number;
      trail: { x: number; y: number }[];
    }

    interface Rocket {
      x: number; y: number;
      vy: number;
      targetY: number;
      color: string;
      exploded: boolean;
    }

    const particles: Particle[] = [];
    const rockets: Rocket[] = [];
    let frame = 0;
    let running = true;

    // Play a quick crackle/pop sound
    const playPop = () => {
      try {
        const ac = audioRef.current;
        if (!ac) return;
        // White noise burst for crackle
        const buf = ac.createBuffer(1, ac.sampleRate * 0.08, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.3));
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        const gain = ac.createGain();
        gain.gain.setValueAtTime(0.06 + Math.random() * 0.04, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
        const filter = ac.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 2000 + Math.random() * 4000;
        filter.Q.value = 1;
        src.connect(filter).connect(gain).connect(ac.destination);
        src.start();
        src.stop(ac.currentTime + 0.15);
      } catch { /* non-critical */ }
    };

    // Play a deep boom
    const playBoom = () => {
      try {
        const ac = audioRef.current;
        if (!ac) return;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.connect(g).connect(ac.destination);
        osc.frequency.setValueAtTime(80, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, ac.currentTime + 0.3);
        osc.type = "sine";
        g.gain.setValueAtTime(0.2, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);
        osc.start();
        osc.stop(ac.currentTime + 0.4);
      } catch { /* non-critical */ }
    };

    // Explode a rocket into particles
    const explode = (x: number, y: number, color: string) => {
      const count = 50 + Math.floor(Math.random() * 30);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
        const speed = 2 + Math.random() * 5;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 60 + Math.random() * 40,
          color: Math.random() > 0.3 ? color : FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)],
          size: 1.5 + Math.random() * 2,
          trail: [],
        });
      }
      playPop();
      setTimeout(playBoom, 20);
    };

    // Launch rockets in waves
    const launchWave = () => {
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          if (!running) return;
          rockets.push({
            x: canvas.width * (0.15 + Math.random() * 0.7),
            y: canvas.height,
            vy: -(8 + Math.random() * 5),
            targetY: canvas.height * (0.15 + Math.random() * 0.35),
            color: FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)],
            exploded: false,
          });
        }, i * (100 + Math.random() * 150));
      }
    };

    // Schedule multiple waves
    launchWave();
    const w2 = setTimeout(launchWave, 600);
    const w3 = setTimeout(launchWave, 1300);
    const w4 = setTimeout(launchWave, 2000);

    // Animation loop
    const animate = () => {
      if (!running) return;
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      frame++;

      // Update rockets
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy;
        // Draw rocket trail
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = r.color;
        ctx.fill();
        // Spark trail
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x + (Math.random() - 0.5) * 3, r.y + 12);
        ctx.strokeStyle = "rgba(255,200,100,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();

        if (r.y <= r.targetY && !r.exploded) {
          r.exploded = true;
          explode(r.x, r.y, r.color);
          rockets.splice(i, 1);
        }
      }

      // Update particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 5) p.trail.shift();

        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04; // gravity
        p.vx *= 0.99; // drag
        p.life++;

        const alpha = 1 - p.life / p.maxLife;
        if (alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        // Draw trail
        if (p.trail.length > 1) {
          ctx.beginPath();
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let t = 1; t < p.trail.length; t++) {
            ctx.lineTo(p.trail[t].x, p.trail[t].y);
          }
          ctx.strokeStyle = p.color + Math.round(alpha * 60).toString(16).padStart(2, "0");
          ctx.lineWidth = p.size * 0.5;
          ctx.stroke();
        }

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fillStyle = p.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
        ctx.fill();

        // Glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.5 * alpha, 0, Math.PI * 2);
        ctx.fillStyle = p.color + Math.round(alpha * 40).toString(16).padStart(2, "0");
        ctx.fill();
      }

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);

    // Auto-dismiss after 3.2s
    const dismiss = setTimeout(() => {
      running = false;
      onComplete();
    }, 3200);

    return () => {
      running = false;
      clearTimeout(w2);
      clearTimeout(w3);
      clearTimeout(w4);
      clearTimeout(dismiss);
      window.removeEventListener("resize", resize);
      try { audioRef.current?.close(); } catch { /* */ }
    };
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[150] pointer-events-none"
    >
      <canvas ref={canvasRef} className="w-full h-full" />
      {/* Giant WINNER text in center */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 10, stiffness: 100, delay: 0.3 }}
        className="absolute inset-0 flex items-center justify-center"
      >
        <div className="text-center">
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 0.8, repeat: 9999 }}
            className="text-6xl sm:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-yellow-300 drop-shadow-[0_0_40px_rgba(251,191,36,0.6)]"
            style={{ textShadow: "0 0 60px rgba(251,191,36,0.5), 0 0 120px rgba(236,72,153,0.3)" }}
          >
            WINNER!
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="text-white text-lg mt-2 font-medium"
            style={{ textShadow: "0 0 20px rgba(255,255,255,0.5)" }}
          >
            Congratulations!
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Prize Ticket Component ─────────────────────────────────────────

function PrizeTicket({
  accountId,
  ticketId,
  winTimestamp,
  onClose,
}: {
  accountId: string;
  ticketId: string;
  winTimestamp: number;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ticketRef = useRef<HTMLDivElement>(null);
  const winDate = new Date(winTimestamp);

  const copyTicketInfo = () => {
    const text = `HBAR.h DAO Spin Winner!\nTicket: ${ticketId}\nAccount: ${accountId}\nDate: ${winDate.toLocaleString()}\nVerify on Discord: ${DISCORD_LINK}`;
    // Use textarea + execCommand fallback for iframe/permissions-policy environments
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: try async clipboard API anyway
      navigator.clipboard?.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => { /* silent fail */ });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={ticketRef}
        initial={{ scale: 0.5, rotateY: 180 }}
        animate={{ scale: 1, rotateY: 0 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ type: "spring", damping: 20, stiffness: 200 }}
        className="relative max-w-md w-full"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-white/70 hover:text-white hover:border-pink-500/50 transition-colors active:scale-90"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Ticket */}
        <div className="rounded-2xl overflow-hidden border-2 border-pink-500/50 shadow-[0_0_60px_rgba(236,72,153,0.3)]">
          {/* Top strip */}
          <div className="bg-gradient-to-r from-pink-600 via-purple-600 to-pink-600 p-4 text-center relative overflow-hidden">
            {/* Animated sparkles bg */}
            <div className="absolute inset-0 opacity-20">
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-1 h-1 bg-white rounded-full"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                  }}
                  animate={{
                    opacity: [0, 1, 0],
                    scale: [0, 1.5, 0],
                  }}
                  transition={{
                    duration: 2,
                    repeat: 9999,
                    delay: Math.random() * 2,
                  }}
                />
              ))}
            </div>
            <div className="relative">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Trophy className="w-6 h-6 text-yellow-300" />
                <span className="text-2xl text-white font-bold tracking-wider">WINNER!</span>
                <Trophy className="w-6 h-6 text-yellow-300" />
              </div>
              <div className="text-pink-100 text-xs tracking-widest uppercase">
                HBAR.h DAO Free Spin Prize
              </div>
            </div>
          </div>

          {/* Dashed divider (ticket tear line effect) */}
          <div className="relative bg-[#0f0f1a]">
            <div className="absolute -top-3 -left-3 w-6 h-6 bg-black/70 rounded-full" />
            <div className="absolute -top-3 -right-3 w-6 h-6 bg-black/70 rounded-full" />
            <div className="border-t-2 border-dashed border-pink-500/30 mx-6" />
          </div>

          {/* Ticket body */}
          <div className="bg-[#0f0f1a] p-6 space-y-4">
            {/* Logo */}
            <div className="flex justify-center">
              <motion.img
                src={hbarhLogo}
                alt="HBAR.h"
                className="w-16 h-16 rounded-full ring-2 ring-pink-500/50 shadow-lg shadow-pink-500/30"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 3, repeat: 9999 }}
              />
            </div>

            {/* Account ID */}
            <div className="text-center">
              <div className="text-[10px] text-white/50 uppercase tracking-wider mb-1">
                Winner Account ID
              </div>
              <div className="font-mono text-lg text-white bg-slate-800/60 rounded-lg px-4 py-2.5 border border-pink-500/20 inline-block">
                {accountId}
              </div>
            </div>

            {/* Ticket details */}
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <div className="text-[10px] text-white/50 uppercase tracking-wider mb-0.5">
                  Ticket ID
                </div>
                <div className="text-sm font-mono text-pink-400">{ticketId}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/50 uppercase tracking-wider mb-0.5">
                  Date & Time
                </div>
                <div className="text-sm text-white">
                  {winDate.toLocaleDateString()} {winDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>

            {/* Separator */}
            <div className="border-t border-slate-700/50" />

            {/* Instructions */}
            <div className="bg-gradient-to-br from-pink-900/20 to-purple-900/20 border border-pink-500/20 rounded-xl p-4 text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-pink-400">
                <Share2 className="w-4 h-4" />
                <span className="text-sm font-bold text-white">How to Claim Your Prize</span>
              </div>
              <ol className="text-xs text-white/80 space-y-1 text-left list-decimal list-inside">
                <li>
                  <span className="text-white">Screenshot this winning ticket</span>
                </li>
                <li>
                  <span className="text-white">Head to the HBAR.h Discord server</span>
                </li>
                <li>
                  <span className="text-white">
                    Post your screenshot in the <span className="text-pink-400 font-mono">#prize-claims</span> channel
                  </span>
                </li>
                <li>
                  <span className="text-white">A moderator will verify and distribute your prize</span>
                </li>
              </ol>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={copyTicketInfo}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-800/80 border border-pink-500/20 text-sm text-white hover:border-pink-500/40 transition-all active:scale-95 shadow-md hover:shadow-lg hover:shadow-pink-500/10"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy Ticket
                  </>
                )}
              </button>
              <a
                href={DISCORD_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-sm text-white font-medium transition-all active:scale-95 shadow-lg shadow-pink-500/20 hover:shadow-pink-500/40"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
                </svg>
                Claim on Discord
              </a>
            </div>

            {/* Footer watermark */}
            <div className="text-center text-[9px] text-white/30 pt-2">
              HBAR.h DAO | Verified On-Chain | Token-Gated Prize
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main SpinWheel Component ────────────────────────────────────────

export function SpinWheel({ accountId }: { accountId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState<"win" | "lose" | null>(null);
  const [showTicket, setShowTicket] = useState(false);
  const [showFireworks, setShowFireworks] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [wheelReady, setWheelReady] = useState(false);
  const [winTicketId, setWinTicketId] = useState<string>("");
  const [winTimestamp, setWinTimestamp] = useState<number>(0);
  const spinAudioRef = useRef<AudioContext | null>(null);
  const [winnerHistory, setWinnerHistory] = useState<WinnerRecord[]>([]);
  const [spinError, setSpinError] = useState<string | null>(null);

  // ── Mirror Node VIP Verification ──
  const [vipStatus, setVipStatus] = useState<"checking" | "verified" | "ineligible" | "error">("checking");
  const [vipBalance, setVipBalance] = useState<number>(0);

  // ── Rotation via useMotionValue for direct, ref-safe animation ──
  const wheelRotation = useMotionValue(0);
  const cumulativeRotationRef = useRef(0);
  const pendingResultRef = useRef<SpinResult | null>(null);
  const spinAnimControlRef = useRef<ReturnType<typeof motionAnimate> | null>(null);

  // Load winner history on mount
  useEffect(() => {
    fetchWinnerHistory().then(setWinnerHistory);
  }, []);

  // ── Mirror Node VIP verification on mount ──
  useEffect(() => {
    if (!accountId) {
      setVipStatus("ineligible");
      return;
    }
    setVipStatus("checking");
    verifyVipEligibilityDirect(accountId).then((res) => {
      setVipBalance(res.balance);
      if (res.error) setVipStatus("error");
      else if (res.eligible) setVipStatus("verified");
      else setVipStatus("ineligible");
    });
  }, [accountId]);

  // Load logo image and draw initial wheel
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      logoImgRef.current = img;
      setWheelReady(true);
    };
    img.onerror = () => {
      setWheelReady(true);
    };
    img.src = hbarhLogo;
  }, []);

  // Draw wheel whenever ready
  useEffect(() => {
    if (!wheelReady || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const displaySize = 340;
    canvas.width = displaySize * dpr;
    canvas.height = displaySize * dpr;
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
    drawWheel(canvas, logoImgRef.current, displaySize);
  }, [wheelReady]);

  // Cooldown timer
  useEffect(() => {
    const update = () => setCooldown(getTimeUntilNextSpin(accountId));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [accountId]);

  const canSpin = cooldown === 0 && !isSpinning && vipStatus === "verified";

  // Helper: ensure AudioContext exists
  const getAudioCtx = useCallback(() => {
    if (!spinAudioRef.current) {
      spinAudioRef.current = new AudioContext();
    }
    return spinAudioRef.current;
  }, []);

  // Play a button click sound (quick crisp pop)
  const playClickSound = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.05);
      osc.type = "sine";
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.06);
    } catch { /* non-critical */ }
  }, [getAudioCtx]);

  // Play a quick tick sound during spin (ratchet click)
  const playTick = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800 + Math.random() * 400;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.08);
    } catch {
      /* non-critical */
    }
  }, [getAudioCtx]);

  // Casino chime on spin start — bright ascending arpeggio
  const playCasinoChime = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      const chimeNotes = [1318.5, 1568, 1760, 2093, 2637];
      chimeNotes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        const start = ctx.currentTime + i * 0.07;
        gain.gain.setValueAtTime(0.06, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        osc.start(start);
        osc.stop(start + 0.35);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = freq * 2;
        osc2.type = "sine";
        gain2.gain.setValueAtTime(0.02, start);
        gain2.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
        osc2.start(start);
        osc2.stop(start + 0.2);
      });

      const ching = ctx.createOscillator();
      const chingGain = ctx.createGain();
      ching.connect(chingGain);
      chingGain.connect(ctx.destination);
      ching.frequency.value = 4000;
      ching.type = "square";
      const chingStart = ctx.currentTime + 0.38;
      chingGain.gain.setValueAtTime(0.03, chingStart);
      chingGain.gain.exponentialRampToValueAtTime(0.001, chingStart + 0.08);
      ching.start(chingStart);
      ching.stop(chingStart + 0.08);
    } catch {
      /* non-critical */
    }
  }, [getAudioCtx]);

  // Winner sound — deep 33Hz + 40Hz sine wave rumble with rising shimmer
  const playWinSound = useCallback(() => {
    try {
      const ctx = getAudioCtx();

      const sub33 = ctx.createOscillator();
      const sub33Gain = ctx.createGain();
      sub33.connect(sub33Gain);
      sub33Gain.connect(ctx.destination);
      sub33.frequency.value = 33;
      sub33.type = "sine";
      sub33Gain.gain.setValueAtTime(0.15, ctx.currentTime);
      sub33Gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.3);
      sub33Gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.0);
      sub33.start(ctx.currentTime);
      sub33.stop(ctx.currentTime + 2.0);

      const sub40 = ctx.createOscillator();
      const sub40Gain = ctx.createGain();
      sub40.connect(sub40Gain);
      sub40Gain.connect(ctx.destination);
      sub40.frequency.value = 40;
      sub40.type = "sine";
      sub40Gain.gain.setValueAtTime(0.12, ctx.currentTime);
      sub40Gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.3);
      sub40Gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.0);
      sub40.start(ctx.currentTime);
      sub40.stop(ctx.currentTime + 2.0);

      const shimmerNotes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      shimmerNotes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        const start = ctx.currentTime + 0.4 + i * 0.18;
        gain.gain.setValueAtTime(0.05, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
        osc.start(start);
        osc.stop(start + 0.5);
      });
    } catch {
      /* non-critical */
    }
  }, [getAudioCtx]);

  // ── onSpinComplete — called by motionAnimate's onComplete callback ──
  const onSpinComplete = useCallback(() => {
    const spinRes = pendingResultRef.current;
    pendingResultRef.current = null;
    spinAnimControlRef.current = null;

    setIsSpinning(false);

    // Cooldown tracking (localStorage for UX hint, server enforces truth)
    setLastSpinTime(accountId, Date.now());
    setCooldown(SPIN_COOLDOWN_MS);

    if (!spinRes) return;

    if (spinRes.win) {
      setResult("win");
      playWinSound();
      setWinTicketId(spinRes.ticketId || "");
      setWinTimestamp(spinRes.timestamp);
      if (spinRes.winners) setWinnerHistory(spinRes.winners);
      // Show fireworks FIRST, then ticket after fireworks complete
      setShowFireworks(true);
    } else {
      setResult("lose");
    }
  }, [accountId, playWinSound]);

  // ── handleSpin — main spin handler ──
  const handleSpin = useCallback(async () => {
    if (!canSpin) return;

    setIsSpinning(true);
    setResult(null);
    setSpinError(null);
    playClickSound();
    playCasinoChime();

    try {
      const spinRes = await requestSpin(accountId);

      if (!spinRes) {
        throw new Error("Network error — no response from server");
      }

      if (spinRes.error) {
        if (spinRes.cooldownMs) {
          setCooldown(spinRes.cooldownMs);
          setLastSpinTime(accountId, Date.now() - SPIN_COOLDOWN_MS + spinRes.cooldownMs);
        }
        throw new Error(spinRes.error);
      }

      // ── Calculate final rotation ──
      const currentCum = cumulativeRotationRef.current;
      const targetMod360 = ((spinRes.spinDelta % 360) + 360) % 360;
      const currentMod360 = ((currentCum % 360) + 360) % 360;

      const angleCorrection = ((targetMod360 - currentMod360) % 360 + 360) % 360;

      const MIN_FULL_SPINS = 5;
      const fullSpinDegrees = MIN_FULL_SPINS * 360;

      const finalRotation = currentCum + fullSpinDegrees + angleCorrection;

      // Store the pending result for onSpinComplete
      pendingResultRef.current = spinRes;
      cumulativeRotationRef.current = finalRotation;

      // ── Tick sounds during spin ──
      const tickCount = 30;
      for (let i = 0; i < tickCount; i++) {
        setTimeout(() => playTick(), 100 + i * (3500 / tickCount) * (i / tickCount));
      }

      // ── Imperatively animate the MotionValue ──
      spinAnimControlRef.current = motionAnimate(
        wheelRotation,
        finalRotation,
        {
          duration: 4,
          ease: [0.2, 0.8, 0.3, 1],
          onComplete: onSpinComplete,
        }
      );
    } catch (err) {
      setIsSpinning(false);
      setSpinError(err instanceof Error ? err.message : "Spin failed — please try again");
    }
  }, [canSpin, accountId, playCasinoChime, playClickSound, playTick, onSpinComplete, wheelRotation]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      spinAnimControlRef.current?.stop();
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-500 shadow-lg shadow-blue-500/25 mb-3">
          <Sparkles className="w-4 h-4 text-yellow-300" />
          <span className="text-xs text-white font-bold tracking-wider uppercase">
            DAO Members Only
          </span>
          <Sparkles className="w-4 h-4 text-yellow-300" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
          Free Spin Prize Wheel
        </h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm max-w-md mx-auto">
          Exclusive for HBAR.h DAO members. Spin once every 24 hours for a chance to win prizes!
        </p>
      </div>

      {/* Mirror Node VIP Verification Status */}
      <div className="max-w-md mx-auto">
        {vipStatus === "checking" && (
          <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: 9999, ease: "linear" }}>
              <ShieldCheck className="w-4 h-4 text-blue-400" />
            </motion.div>
            <span className="text-sm text-blue-700 dark:text-blue-300">Verifying wallet via Hedera Mirror Node...</span>
          </div>
        )}
        {vipStatus === "verified" && (
          <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-emerald-700 dark:text-emerald-300">
              VIP Verified — {vipBalance >= 1_000_000 ? `${(vipBalance / 1_000_000).toFixed(0)}M` : vipBalance.toLocaleString()} HBAR.h
            </span>
          </div>
        )}
        {vipStatus === "ineligible" && (
          <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-sm text-amber-700 dark:text-amber-300">
              Hold 100M+ HBAR.h tokens to unlock the spin wheel
              {vipBalance > 0 && <span className="text-amber-500/70 dark:text-amber-400/60"> (current: {vipBalance >= 1_000_000 ? `${(vipBalance / 1_000_000).toFixed(1)}M` : vipBalance.toLocaleString()})</span>}
            </span>
          </div>
        )}
        {vipStatus === "error" && (
          <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-sm text-red-700 dark:text-red-300">Mirror Node verification failed</span>
            <button
              onClick={() => {
                playClickSound();
                setVipStatus("checking");
                verifyVipEligibilityDirect(accountId).then((res) => {
                  setVipBalance(res.balance);
                  if (res.error) setVipStatus("error");
                  else if (res.eligible) setVipStatus("verified");
                  else setVipStatus("ineligible");
                });
              }}
              className="text-xs text-red-500 dark:text-red-400 hover:text-red-400 dark:hover:text-red-300 underline underline-offset-2 active:scale-95 transition-transform"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Wheel Area */}
      <div className="flex flex-col items-center">
        {/* Pointer (triangle at top) */}
        <div className="relative z-10 -mb-3">
          <svg width="28" height="24" viewBox="0 0 28 24" className="drop-shadow-[0_0_8px_rgba(236,72,153,0.6)]">
            <polygon
              points="14,24 0,0 28,0"
              fill="url(#pointerGrad)"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1"
            />
            <defs>
              <linearGradient id="pointerGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ec4899" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Wheel */}
        <div className="relative">
          {/* Outer glow */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-pink-500/20 to-purple-500/20 blur-xl" />

          {/* Wheel with rotation */}
          <motion.div
            style={{ rotate: wheelRotation }}
          >
            <canvas
              ref={canvasRef}
              className="relative z-[1]"
              style={{ width: 340, height: 340 }}
              role="img"
              aria-label="Spin the wheel game — spin to win prizes"
            />
          </motion.div>

          {/* Win celebration overlay (small confetti on wheel) */}
          <AnimatePresence>
            {result === "win" && !isSpinning && (
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
              >
                {[...Array(20)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute w-2 h-2 rounded-full"
                    style={{
                      background: ["#ec4899", "#a855f7", "#fbbf24", "#22c55e", "#3b82f6"][i % 5],
                    }}
                    initial={{ x: 0, y: 0, opacity: 1 }}
                    animate={{
                      x: (Math.random() - 0.5) * 300,
                      y: (Math.random() - 0.5) * 300,
                      opacity: 0,
                      scale: [1, 2, 0],
                    }}
                    transition={{ duration: 1.5, delay: i * 0.05 }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Spin Button / Status */}
        <div className="mt-6 text-center">
          {cooldown > 0 && !isSpinning ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
                <Clock className="w-4 h-4" />
                <span className="text-sm text-slate-600 dark:text-slate-300">Next spin available in:</span>
              </div>
              <div className="font-mono text-2xl text-pink-400 tracking-wider">
                {formatCountdown(cooldown)}
              </div>
              {result === "win" && (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => { playClickSound(); setShowTicket(true); }}
                  className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-yellow-600 to-amber-500 hover:from-yellow-500 hover:to-amber-400 text-white font-medium text-sm transition-all shadow-lg shadow-yellow-500/25 hover:shadow-yellow-500/40"
                >
                  <Ticket className="w-4 h-4" />
                  View Winning Ticket
                </motion.button>
              )}
            </div>
          ) : (
            <motion.button
              whileHover={canSpin ? { scale: 1.06 } : {}}
              whileTap={canSpin ? { scale: 0.93 } : {}}
              onClick={handleSpin}
              disabled={!canSpin}
              aria-label={isSpinning ? "Wheel is spinning" : canSpin ? "Spin the wheel for a chance to win" : "Spin unavailable"}
              className={`group relative px-10 py-4 rounded-xl text-lg font-bold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 ${
                canSpin
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-xl shadow-pink-500/30 hover:shadow-2xl hover:shadow-pink-500/50"
                  : "bg-slate-200 dark:bg-slate-700/80 text-slate-400 dark:text-slate-500 cursor-not-allowed"
              }`}
            >
              {isSpinning ? (
                <span className="flex items-center gap-2 text-white">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: 9999, ease: "linear" }}
                  >
                    <Sparkles className="w-5 h-5" />
                  </motion.div>
                  Spinning...
                </span>
              ) : (
                <span className="flex items-center gap-2 text-white">
                  <Gift className="w-5 h-5" />
                  Spin the Wheel!
                </span>
              )}

              {/* Glow pulse when ready */}
              {canSpin && !isSpinning && (
                <motion.div
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 opacity-0"
                  animate={{ opacity: [0, 0.3, 0] }}
                  transition={{ duration: 2, repeat: 9999 }}
                />
              )}
            </motion.button>
          )}
        </div>

        {/* Result message */}
        <AnimatePresence>
          {result && !isSpinning && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mt-4 text-center"
            >
              {result === "win" ? (
                <div className="flex items-center gap-2 text-yellow-400">
                  <PartyPopper className="w-5 h-5" />
                  <span className="font-bold text-slate-900 dark:text-white">Congratulations! You won!</span>
                  <PartyPopper className="w-5 h-5" />
                </div>
              ) : (
                <div className="text-slate-500 dark:text-slate-400">
                  Better luck next time! Come back in 24 hours.
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error message */}
        <AnimatePresence>
          {spinError && !isSpinning && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 max-w-sm mx-auto"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-sm text-red-700 dark:text-red-300">{spinError}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Rules */}
      <div className="rounded-xl bg-white/80 dark:bg-slate-800/30 border border-slate-200 dark:border-white/5 p-4 max-w-md mx-auto shadow-sm dark:shadow-none">
        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-2">
          <Gift className="w-4 h-4 text-pink-500 dark:text-pink-400" />
          Spin Rules
        </h4>
        <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
          <li className="flex items-start gap-2">
            <span className="text-pink-500 dark:text-pink-400 mt-0.5">&#x2022;</span>
            <span>Must hold <span className="text-pink-600 dark:text-pink-400 font-medium">100M+ HBAR.h</span> tokens to access</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-pink-500 dark:text-pink-400 mt-0.5">&#x2022;</span>
            <span>One free spin every 24 hours per wallet</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-pink-500 dark:text-pink-400 mt-0.5">&#x2022;</span>
            <span>Winners receive a verifiable prize ticket</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-pink-500 dark:text-pink-400 mt-0.5">&#x2022;</span>
            <span>Screenshot your ticket and claim on <a href={DISCORD_LINK} target="_blank" rel="noopener noreferrer" className="text-pink-600 dark:text-pink-400 hover:text-pink-500 dark:hover:text-pink-300 underline underline-offset-2">Discord</a></span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-pink-500 dark:text-pink-400 mt-0.5">&#x2022;</span>
            <span>Prizes are distributed by DAO moderators after verification</span>
          </li>
        </ul>
      </div>

      {/* Winner Verification Log — Last 10 Winners */}
      <div className="rounded-xl bg-white/80 dark:bg-slate-800/30 border border-slate-200 dark:border-emerald-500/10 p-4 max-w-md mx-auto shadow-sm dark:shadow-none">
        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          Winner Verification
          <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500 tracking-wider uppercase">
            Last 10 Winners
          </span>
        </h4>
        {winnerHistory.length === 0 ? (
          <div className="text-center py-4">
            <div className="text-slate-400 dark:text-slate-500 text-xs">No winners recorded yet</div>
            <div className="text-slate-300 dark:text-slate-600 text-[10px] mt-1">
              Winners will appear here after a winning spin
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {winnerHistory.map((w, i) => {
              const d = new Date(w.timestamp);
              return (
                <div
                  key={w.ticketId}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    i === 0 && result === "win" && !isSpinning
                      ? "bg-emerald-500/10 border border-emerald-500/20"
                      : "bg-slate-50 dark:bg-slate-900/40 border border-transparent"
                  }`}
                >
                  <div className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700/60 text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-slate-800 dark:text-slate-200 truncate">
                      {w.accountId}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">
                      {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </div>
                    <div className="text-[10px] text-slate-300 dark:text-slate-600">
                      {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 pt-2 border-t border-slate-200 dark:border-slate-700/30 text-center">
          <div className="text-[10px] text-slate-400 dark:text-slate-600">
            Server-synced verification — visible across all devices & sessions
          </div>
        </div>
      </div>

      {/* Fireworks Overlay — plays on win BEFORE the ticket modal */}
      <AnimatePresence>
        {showFireworks && (
          <FireworksOverlay
            onComplete={() => {
              setShowFireworks(false);
              setShowTicket(true);
            }}
          />
        )}
      </AnimatePresence>

      {/* Prize Ticket Modal */}
      <AnimatePresence>
        {showTicket && (
          <PrizeTicket
            accountId={accountId}
            ticketId={winTicketId}
            winTimestamp={winTimestamp}
            onClose={() => setShowTicket(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

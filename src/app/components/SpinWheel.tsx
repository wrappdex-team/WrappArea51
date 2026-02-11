import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
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
} from "lucide-react";
import hbarhLogo from "figma:asset/a4dcb71ed037398f210b836928214a568ecf191e.png";
import { projectId, publicAnonKey } from "/utils/supabase/info";

// ── Config ───────────────────────────────────────────────────────────

/** Cooldown between spins in milliseconds (24 hours). */
const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** localStorage key prefix for spin tracking */
const SPIN_STORAGE_KEY = "hbarh_dao_spin_";

/** Discord invite link for prize claims */
const DISCORD_LINK = "https://discord.gg/ZFnfRFxQZ";

/** Supabase API base URL for winner endpoints */
const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

// ── Wheel Segments ──────────────────────────────────────────────────

interface WheelSegment {
  label: string;
  color: string;
  textColor: string;
  isWinner: boolean;
}

const SEGMENTS: WheelSegment[] = [
  { label: "Try Again", color: "#1e1b4b", textColor: "#7c3aed", isWinner: false },
  { label: "Almost!", color: "#172554", textColor: "#3b82f6", isWinner: false },
  { label: "So Close", color: "#1e1b4b", textColor: "#7c3aed", isWinner: false },
  { label: "Not Yet", color: "#172554", textColor: "#3b82f6", isWinner: false },
  { label: "Try Again", color: "#1e1b4b", textColor: "#7c3aed", isWinner: false },
  { label: "HBAR.ħ", color: "#4a1942", textColor: "#ec4899", isWinner: true },
  { label: "Not Yet", color: "#172554", textColor: "#3b82f6", isWinner: false },
  { label: "Almost!", color: "#1e1b4b", textColor: "#7c3aed", isWinner: false },
  { label: "Try Again", color: "#172554", textColor: "#3b82f6", isWinner: false },
  { label: "So Close", color: "#1e1b4b", textColor: "#7c3aed", isWinner: false },
  { label: "Not Yet", color: "#172554", textColor: "#3b82f6", isWinner: false },
  { label: "Almost!", color: "#1e1b4b", textColor: "#7c3aed", isWinner: false },
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
    if (!res.ok) {
      console.log(`Failed to fetch winners: ${res.status} ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    return (data.winners ?? []) as WinnerRecord[];
  } catch (err) {
    console.log("Error fetching winner history from backend:", err);
    return [];
  }
}

async function postWinner(record: WinnerRecord): Promise<WinnerRecord[]> {
  try {
    const res = await fetch(`${API_BASE}/winners`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${publicAnonKey}`,
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      console.log(`Failed to post winner: ${res.status} ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    return (data.winners ?? []) as WinnerRecord[];
  } catch (err) {
    console.log("Error posting winner to backend:", err);
    return [];
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
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw text/logo
    ctx.save();
    ctx.translate(cx, cy);
    const midAngle = (startAngle + endAngle) / 2;
    ctx.rotate(midAngle);

    if (seg.isWinner && logoImg) {
      // "WINNER" text on the winning segment (logo moved to center hub)
      ctx.fillStyle = "#fbbf24";
      ctx.font = `bold ${Math.round(radius * 0.09)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("WINNER", radius * 0.6, 0);
    } else {
      // Regular segment label
      ctx.fillStyle = seg.textColor;
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
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
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
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
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
    const text = `HBAR.ħ DAO Spin Winner!\nTicket: ${ticketId}\nAccount: ${accountId}\nDate: ${winDate.toLocaleString()}\nVerify on Discord: ${DISCORD_LINK}`;
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
          className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-slate-400 hover:text-white hover:border-pink-500/50 transition-colors"
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
                    repeat: Infinity,
                    delay: Math.random() * 2,
                  }}
                />
              ))}
            </div>
            <div className="relative">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Trophy className="w-6 h-6 text-yellow-300" />
                <span className="text-2xl text-white tracking-wider">WINNER!</span>
                <Trophy className="w-6 h-6 text-yellow-300" />
              </div>
              <div className="text-pink-200 text-xs tracking-widest uppercase">
                HBAR.ħ DAO Free Spin Prize
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
                alt="HBAR.ħ"
                className="w-16 h-16 rounded-full ring-2 ring-pink-500/50 shadow-lg shadow-pink-500/30"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 3, repeat: Infinity }}
              />
            </div>

            {/* Account ID */}
            <div className="text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                Winner Account ID
              </div>
              <div className="font-mono text-lg text-white bg-slate-800/60 rounded-lg px-4 py-2.5 border border-pink-500/20 inline-block">
                {accountId}
              </div>
            </div>

            {/* Ticket details */}
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
                  Ticket ID
                </div>
                <div className="text-sm font-mono text-pink-400">{ticketId}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
                  Date & Time
                </div>
                <div className="text-sm text-slate-300">
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
                <span className="text-sm font-bold">How to Claim Your Prize</span>
              </div>
              <ol className="text-xs text-slate-400 space-y-1 text-left list-decimal list-inside">
                <li>
                  <span className="text-slate-300">Screenshot this winning ticket</span>
                </li>
                <li>
                  <span className="text-slate-300">Head to the HBAR.ħ Discord server</span>
                </li>
                <li>
                  <span className="text-slate-300">
                    Post your screenshot in the <span className="text-pink-400 font-mono">#prize-claims</span> channel
                  </span>
                </li>
                <li>
                  <span className="text-slate-300">A moderator will verify and distribute your prize</span>
                </li>
              </ol>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={copyTicketInfo}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-800/80 border border-pink-500/20 text-sm text-slate-300 hover:text-white hover:border-pink-500/40 transition-all"
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
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-sm text-white transition-all"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
                </svg>
                Claim on Discord
              </a>
            </div>

            {/* Footer watermark */}
            <div className="text-center text-[9px] text-slate-600 pt-2">
              HBAR.ħ DAO | Verified On-Chain | Token-Gated Prize
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
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState<"win" | "lose" | null>(null);
  const [showTicket, setShowTicket] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [wheelReady, setWheelReady] = useState(false);
  const [winTicketId, setWinTicketId] = useState<string>("");
  const [winTimestamp, setWinTimestamp] = useState<number>(0);
  const spinAudioRef = useRef<AudioContext | null>(null);
  const [winnerHistory, setWinnerHistory] = useState<WinnerRecord[]>([]);

  // Load winner history on mount
  useEffect(() => {
    fetchWinnerHistory().then(setWinnerHistory);
  }, []);

  // Load logo image and draw initial wheel
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      logoImgRef.current = img;
      setWheelReady(true);
    };
    img.onerror = () => {
      // Still render wheel without logo
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

  const canSpin = cooldown === 0 && !isSpinning;

  // Helper: ensure AudioContext exists
  const getAudioCtx = useCallback(() => {
    if (!spinAudioRef.current) {
      spinAudioRef.current = new AudioContext();
    }
    return spinAudioRef.current;
  }, []);

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
      // Bright casino chime: ascending bell-like tones
      const chimeNotes = [1318.5, 1568, 1760, 2093, 2637]; // E6, G6, A6, C7, E7
      chimeNotes.forEach((freq, i) => {
        // Primary tone
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

        // Harmonic shimmer (octave above, quieter)
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

      // Coin-drop "ching" — short metallic burst
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

      // Layer 1: Deep 33Hz sub-bass sine
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

      // Layer 2: Deep 40Hz sine (beating with the 33Hz at ~7Hz)
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

      // Layer 3: Rising victory shimmer on top of the bass
      const shimmerNotes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5→E6
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

  const handleSpin = useCallback(() => {
    if (!canSpin) return;

    setIsSpinning(true);
    setResult(null);

    // Casino chime on spin start
    playCasinoChime();

    // Determine outcome
    const isWin = Math.random() < 0.04; // 1:25 odds

    // Calculate target rotation
    // The pointer is at the top (12 o'clock = 0 degrees)
    // We need the winning segment's center to align with 0 degrees
    // Segment center = (index * segmentAngle) + (segmentAngle / 2)
    let targetSegmentIndex: number;

    if (isWin) {
      targetSegmentIndex = WINNER_INDEX;
    } else {
      // Pick a random non-winning segment
      let idx: number;
      do {
        idx = Math.floor(Math.random() * SEGMENT_COUNT);
      } while (idx === WINNER_INDEX);
      targetSegmentIndex = idx;
    }

    // The angle at which the target segment's CENTER is at the top (pointer)
    // pointer at top = 0deg in CSS rotation frame
    // segment center angle from wheel's 0: (index * segAngle) + (segAngle/2)
    const segCenterAngle = targetSegmentIndex * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
    // To bring this segment to the top (0deg pointer), rotate wheel by -(segCenterAngle)
    // Add small random offset within segment for realism
    const jitter = (Math.random() - 0.5) * SEGMENT_ANGLE * 0.6;
    const targetAngle = 360 - segCenterAngle + jitter;

    // Account for the current accumulated rotation so the final position is correct
    const currentAngleMod = ((rotation % 360) + 360) % 360;
    const neededRotation = ((targetAngle - currentAngleMod) % 360 + 360) % 360;

    // Add multiple full rotations for visual effect (5-8 turns)
    const fullRotations = (5 + Math.floor(Math.random() * 4)) * 360;
    const finalRotation = rotation + fullRotations + neededRotation;

    setRotation(finalRotation);

    // Tick sounds during spin
    const tickCount = 30;
    for (let i = 0; i < tickCount; i++) {
      setTimeout(() => playTick(), 100 + i * (3500 / tickCount) * (i / tickCount));
    }

    // After spin completes
    setTimeout(() => {
      setIsSpinning(false);

      setLastSpinTime(accountId, Date.now());
      setCooldown(SPIN_COOLDOWN_MS);

      if (isWin) {
        setResult("win");
        playWinSound();
        // Auto-show ticket after a beat
        setTimeout(() => setShowTicket(true), 800);
        // Generate and store ticket ID and timestamp
        const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;
        const timestamp = Date.now();
        setWinTicketId(ticketId);
        setWinTimestamp(timestamp);
        // Add to winner history
        const record: WinnerRecord = { accountId, ticketId, timestamp };
        postWinner(record).then(setWinnerHistory);
      } else {
        setResult("lose");
      }
    }, 4200);
  }, [canSpin, rotation, accountId, playTick, playWinSound, playCasinoChime]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-500/20 mb-3">
          <Sparkles className="w-4 h-4 text-yellow-400" />
          <span className="text-xs text-pink-400 font-bold tracking-wider uppercase">
            DAO Members Only
          </span>
          <Sparkles className="w-4 h-4 text-yellow-400" />
        </div>
        <h3 className="text-xl bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent mb-1">
          Free Spin Prize Wheel
        </h3>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Exclusive for HBAR.ħ DAO members. Spin once every 24 hours for a chance to win prizes!
        </p>
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
            style={{ rotate: rotation }}
            animate={{ rotate: rotation }}
            transition={
              isSpinning
                ? {
                    duration: 4,
                    ease: [0.2, 0.8, 0.3, 1],
                  }
                : { duration: 0 }
            }
          >
            <canvas
              ref={canvasRef}
              className="relative z-[1]"
              style={{ width: 340, height: 340 }}
            />
          </motion.div>

          {/* Win celebration overlay */}
          <AnimatePresence>
            {result === "win" && !isSpinning && (
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
              >
                {/* Confetti-like particles */}
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
              <div className="flex items-center justify-center gap-2 text-slate-400">
                <Clock className="w-4 h-4" />
                <span className="text-sm">Next spin available in:</span>
              </div>
              <div className="font-mono text-2xl text-pink-400 tracking-wider">
                {formatCountdown(cooldown)}
              </div>
              {result === "win" && (
                <button
                  onClick={() => setShowTicket(true)}
                  className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-yellow-600 to-amber-500 hover:from-yellow-500 hover:to-amber-400 text-white text-sm transition-all shadow-lg shadow-yellow-500/20"
                >
                  <Ticket className="w-4 h-4" />
                  View Winning Ticket
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handleSpin}
              disabled={!canSpin}
              className={`group relative px-10 py-4 rounded-xl text-lg transition-all duration-300 ${
                canSpin
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-500/30 hover:shadow-pink-500/50 hover:scale-105"
                  : "bg-slate-700 text-slate-400 cursor-not-allowed"
              }`}
            >
              {isSpinning ? (
                <span className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    <Sparkles className="w-5 h-5" />
                  </motion.div>
                  Spinning...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Gift className="w-5 h-5" />
                  Spin the Wheel!
                </span>
              )}

              {/* Glow pulse when ready */}
              {canSpin && !isSpinning && (
                <motion.div
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 opacity-0"
                  animate={{ opacity: [0, 0.3, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              )}
            </button>
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
                  <span className="font-bold">Congratulations! You won!</span>
                  <PartyPopper className="w-5 h-5" />
                </div>
              ) : (
                <div className="text-slate-400">
                  Better luck next time! Come back in 24 hours.
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Rules */}
      <div className="rounded-xl bg-slate-800/30 border border-white/5 p-4 max-w-md mx-auto">
        <h4 className="text-sm font-bold text-slate-300 mb-2 flex items-center gap-2">
          <Gift className="w-4 h-4 text-pink-400" />
          Spin Rules
        </h4>
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li className="flex items-start gap-2">
            <span className="text-pink-400 mt-0.5">&#x2022;</span>
            <span>Must hold <span className="text-pink-400">100M+ HBAR.ħ</span> tokens to access</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-pink-400 mt-0.5">&#x2022;</span>
            <span>One free spin every 24 hours per wallet</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-pink-400 mt-0.5">&#x2022;</span>
            <span>Winners receive a verifiable prize ticket</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-pink-400 mt-0.5">&#x2022;</span>
            <span>Screenshot your ticket and claim on <a href={DISCORD_LINK} target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300 underline underline-offset-2">Discord</a></span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-pink-400 mt-0.5">&#x2022;</span>
            <span>Prizes are distributed by DAO moderators after verification</span>
          </li>
        </ul>
      </div>

      {/* Winner Verification Log — Last 10 Winners */}
      <div className="rounded-xl bg-slate-800/30 border border-emerald-500/10 p-4 max-w-md mx-auto">
        <h4 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Winner Verification
          <span className="ml-auto text-[10px] text-slate-500 tracking-wider uppercase">
            Last 10 Winners
          </span>
        </h4>
        {winnerHistory.length === 0 ? (
          <div className="text-center py-4">
            <div className="text-slate-500 text-xs">No winners recorded yet</div>
            <div className="text-slate-600 text-[10px] mt-1">
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
                      : "bg-slate-900/40 border border-transparent"
                  }`}
                >
                  <div className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-700/60 text-[10px] text-slate-400 shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-slate-200 truncate">
                      {w.accountId}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-slate-500">
                      {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </div>
                    <div className="text-[10px] text-slate-600">
                      {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 pt-2 border-t border-slate-700/30 text-center">
          <div className="text-[10px] text-slate-600">
            Server-synced verification — visible across all devices & sessions
          </div>
        </div>
      </div>

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
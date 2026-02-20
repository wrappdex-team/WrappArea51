import { loadVipPrefs } from "./vip";

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

// ── Volume System ────────────────────────────────────────────────────
// 4-level presets: off / low / medium / high.
// Backward compatible: getSoundMuted() still works (returns true when off).

export type SoundVolume = "off" | "low" | "medium" | "high";

const VOLUME_KEY = "hbarh-sound-volume";

const VOLUME_MULTIPLIERS: Record<SoundVolume, number> = {
  off: 0,
  low: 0.3,
  medium: 0.65,
  high: 1.0,
};

const VOLUME_CYCLE: SoundVolume[] = ["off", "low", "medium", "high"];

let _volume: SoundVolume | null = null;

function resolveVolume(): SoundVolume {
  if (_volume !== null) return _volume;
  if (typeof window === "undefined") { _volume = "off"; return _volume; }
  // Try new key first
  const stored = localStorage.getItem(VOLUME_KEY) as SoundVolume | null;
  if (stored && VOLUME_MULTIPLIERS[stored] !== undefined) {
    _volume = stored;
    return _volume;
  }
  _volume = "off";
  localStorage.setItem(VOLUME_KEY, _volume);
  return _volume;
}

export function getSoundVolume(): SoundVolume {
  return resolveVolume();
}

export function setSoundVolume(vol: SoundVolume): void {
  _volume = vol;
  if (typeof window !== "undefined") {
    localStorage.setItem(VOLUME_KEY, vol);
  }
  // Update live master gain if audio context exists
  if (masterGain) {
    masterGain.gain.setTargetAtTime(VOLUME_MULTIPLIERS[vol], audioCtx!.currentTime, 0.03);
  }
}

/** Cycle to the next volume level and return it */
export function cycleSoundVolume(): SoundVolume {
  const current = resolveVolume();
  const idx = VOLUME_CYCLE.indexOf(current);
  const next = VOLUME_CYCLE[(idx + 1) % VOLUME_CYCLE.length];
  setSoundVolume(next);
  return next;
}

export function getVolumeMultiplier(): number {
  return VOLUME_MULTIPLIERS[resolveVolume()];
}

// Backward compat — still used by some callers
function isMuted(): boolean { return resolveVolume() === "off"; }
export function setSoundMuted(muted: boolean): void { setSoundVolume(muted ? "off" : "high"); }
export function getSoundMuted(): boolean { return isMuted(); }

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  // Create / reconnect master gain
  if (!masterGain) {
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(VOLUME_MULTIPLIERS[resolveVolume()], audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

/** Central output node — all sounds connect here instead of ctx.destination */
function getMasterOutput(): GainNode {
  getAudioContext(); // ensures masterGain exists
  return masterGain!;
}

interface ChimeConfig {
  frequencies: number[];
  durations: number[];
  delays: number[];
  waveform: OscillatorType;
  volume: number;
  filterFreq?: number;
}

const TAB_CHIMES: Record<string, ChimeConfig> = {
  "/":        { frequencies: [523.25, 659.25, 783.99], durations: [0.12, 0.12, 0.18], delays: [0, 0.06, 0.12], waveform: "sine", volume: 0.15, filterFreq: 3000 },
  "/trading": { frequencies: [783.99, 1046.5], durations: [0.1, 0.2], delays: [0, 0.08], waveform: "sine", volume: 0.13, filterFreq: 4000 },
  "/swap":     { frequencies: [1174.66, 1396.91], durations: [0.12, 0.18], delays: [0, 0.06], waveform: "sine", volume: 0.12, filterFreq: 3800 },
  "/buy-sell": { frequencies: [1318.5, 1567.98], durations: [0.25, 0.15], delays: [0, 0.02], waveform: "sine", volume: 0.1, filterFreq: 3500 },
  "/wallet":  { frequencies: [659.25, 523.25], durations: [0.15, 0.2], delays: [0, 0.1], waveform: "triangle", volume: 0.14, filterFreq: 2500 },
  "/history": { frequencies: [440, 880], durations: [0.3, 0.2], delays: [0, 0.01], waveform: "sine", volume: 0.08, filterFreq: 2000 },
  "/dao":     { frequencies: [261.63, 392, 659.25], durations: [0.15, 0.15, 0.25], delays: [0, 0.05, 0.1], waveform: "sine", volume: 0.1, filterFreq: 2800 },
  "/bridges": { frequencies: [987.77, 1174.66, 1479.98], durations: [0.1, 0.1, 0.22], delays: [0, 0.07, 0.14], waveform: "sine", volume: 0.09, filterFreq: 5000 },
  "/defi":    { frequencies: [880, 1108.73, 1318.5], durations: [0.12, 0.12, 0.2], delays: [0, 0.05, 0.1], waveform: "sine", volume: 0.11, filterFreq: 3200 },
  "/smart-liquidity": { frequencies: [659.25, 783.99, 1046.5, 1318.5], durations: [0.1, 0.1, 0.12, 0.2], delays: [0, 0.05, 0.1, 0.15], waveform: "sine", volume: 0.12, filterFreq: 3500 },
};

function playNote(
  ctx: AudioContext, frequency: number, startTime: number,
  duration: number, waveform: OscillatorType, volume: number, filterFreq: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = waveform;
  osc.frequency.setValueAtTime(frequency, startTime);
  osc.frequency.exponentialRampToValueAtTime(frequency * 1.002, startTime + duration);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFreq, startTime);
  filter.Q.setValueAtTime(1, startTime);

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
  gain.gain.setValueAtTime(volume * 0.8, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(getMasterOutput());
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

export function playTabChime(path: string): void {
  if (isMuted()) return;
  try {
    const config = TAB_CHIMES[path];
    if (!config) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    config.frequencies.forEach((freq, i) => {
      playNote(ctx, freq, now + config.delays[i], config.durations[i], config.waveform, config.volume, config.filterFreq ?? 3000);
    });
  } catch { /* audio not supported */ }
}

// Theme toggle whistle: "up" = ascending (light mode), "down" = descending (dark mode)
export function playThemeWhistle(direction: "up" | "down"): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    if (direction === "up") {
      // Grace note rise
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(600, now);
      osc1.frequency.exponentialRampToValueAtTime(900, now + 0.12);
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.13, now + 0.015);
      gain1.gain.setValueAtTime(0.12, now + 0.06);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc1.connect(gain1); gain1.connect(getMasterOutput());
      osc1.start(now); osc1.stop(now + 0.16);

      // Main ascending glide
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(700, now + 0.18);
      osc2.frequency.exponentialRampToValueAtTime(1350, now + 0.42);
      osc2.frequency.exponentialRampToValueAtTime(1100, now + 0.56);
      gain2.gain.setValueAtTime(0, now + 0.18);
      gain2.gain.linearRampToValueAtTime(0.15, now + 0.2);
      gain2.gain.setValueAtTime(0.14, now + 0.36);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
      osc2.connect(gain2); gain2.connect(getMasterOutput());
      osc2.start(now + 0.18); osc2.stop(now + 0.62);

      // Breathy overtone
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      const filter3 = ctx.createBiquadFilter();
      osc3.type = "triangle";
      osc3.frequency.setValueAtTime(1400, now + 0.18);
      osc3.frequency.exponentialRampToValueAtTime(2700, now + 0.42);
      osc3.frequency.exponentialRampToValueAtTime(2200, now + 0.56);
      filter3.type = "lowpass";
      filter3.frequency.setValueAtTime(2500, now + 0.18);
      gain3.gain.setValueAtTime(0, now + 0.18);
      gain3.gain.linearRampToValueAtTime(0.03, now + 0.22);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc3.connect(filter3); filter3.connect(gain3); gain3.connect(getMasterOutput());
      osc3.start(now + 0.18); osc3.stop(now + 0.6);
    } else {
      // Descending glide
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(1200, now);
      osc1.frequency.exponentialRampToValueAtTime(900, now + 0.15);
      osc1.frequency.exponentialRampToValueAtTime(500, now + 0.4);
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.14, now + 0.02);
      gain1.gain.setValueAtTime(0.13, now + 0.15);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
      osc1.connect(gain1); gain1.connect(getMasterOutput());
      osc1.start(now); osc1.stop(now + 0.48);

      // Warm overtone
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      const filter2 = ctx.createBiquadFilter();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(2400, now);
      osc2.frequency.exponentialRampToValueAtTime(1000, now + 0.4);
      filter2.type = "lowpass";
      filter2.frequency.setValueAtTime(2000, now);
      gain2.gain.setValueAtTime(0, now);
      gain2.gain.linearRampToValueAtTime(0.025, now + 0.03);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      osc2.connect(filter2); filter2.connect(gain2); gain2.connect(getMasterOutput());
      osc2.start(now); osc2.stop(now + 0.45);
    }
  } catch { /* audio not supported */ }
}

// ── VIP Premium Sounds ───────────────────────────────────────────────

/** Cash register "ka-ching" — plays on trade button clicks for VIP users */
export function playVipCashRegister(): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Metallic "ka" hit
    const hit = ctx.createOscillator();
    const hitGain = ctx.createGain();
    const hitFilter = ctx.createBiquadFilter();
    hit.type = "square";
    hit.frequency.setValueAtTime(1800, now);
    hit.frequency.exponentialRampToValueAtTime(600, now + 0.04);
    hitFilter.type = "bandpass";
    hitFilter.frequency.setValueAtTime(2000, now);
    hitFilter.Q.setValueAtTime(3, now);
    hitGain.gain.setValueAtTime(0.12, now);
    hitGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    hit.connect(hitFilter);
    hitFilter.connect(hitGain);
    hitGain.connect(getMasterOutput());
    hit.start(now);
    hit.stop(now + 0.08);

    // Bell "ching" ring
    const bell1 = ctx.createOscillator();
    const bell1Gain = ctx.createGain();
    bell1.type = "sine";
    bell1.frequency.setValueAtTime(2637, now + 0.05);
    bell1Gain.gain.setValueAtTime(0, now + 0.05);
    bell1Gain.gain.linearRampToValueAtTime(0.15, now + 0.06);
    bell1Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    bell1.connect(bell1Gain);
    bell1Gain.connect(getMasterOutput());
    bell1.start(now + 0.05);
    bell1.stop(now + 0.5);

    // Harmonic overtone
    const bell2 = ctx.createOscillator();
    const bell2Gain = ctx.createGain();
    bell2.type = "sine";
    bell2.frequency.setValueAtTime(3951, now + 0.05);
    bell2Gain.gain.setValueAtTime(0, now + 0.05);
    bell2Gain.gain.linearRampToValueAtTime(0.06, now + 0.06);
    bell2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    bell2.connect(bell2Gain);
    bell2Gain.connect(getMasterOutput());
    bell2.start(now + 0.05);
    bell2.stop(now + 0.4);

    // Drawer slide noise burst
    const noise = ctx.createBufferSource();
    const noiseLen = ctx.sampleRate * 0.08;
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) noiseData[i] = (Math.random() * 2 - 1) * 0.3;
    noise.buffer = noiseBuf;
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.setValueAtTime(3000, now);
    noiseGain.gain.setValueAtTime(0.04, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(getMasterOutput());
    noise.start(now);
  } catch { /* audio not supported */ }
}

/** Premium confirmation chime — ascending sparkle */
export function playVipConfirm(): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const notes = [1046.5, 1318.5, 1568, 2093];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const t = now + i * 0.07;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.1, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(getMasterOutput());
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch { /* audio not supported */ }
}

/**
 * VIP iridescent button chime — uses 33Hz and 44Hz sine waves layered
 * with harmonics to produce a deep, pleasant resonance when hovering
 * or clicking Trade/Bridge buttons in VIP mode.
 *
 * Internally gated by the VIP "Premium Sound FX" toggle — if the user
 * has disabled vip_sounds (or VIP is inactive), this is a silent no-op.
 * This keeps all 15+ call sites clean.
 */
export function playVipButtonChime(): void {
  if (isMuted()) return;
  // Gate behind VIP sound toggle so Trade/Bridge premium sounds
  // respect the same preference as cash register and piano notes.
  try {
    const prefs = loadVipPrefs();
    if (!prefs.active || !prefs.features.vip_sounds) return;
  } catch { /* prefs unavailable — allow sound */ }
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Deep 33Hz fundamental — felt more than heard
    const sub33 = ctx.createOscillator();
    const sub33Gain = ctx.createGain();
    sub33.type = "sine";
    sub33.frequency.setValueAtTime(33, now);
    sub33Gain.gain.setValueAtTime(0, now);
    sub33Gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
    sub33Gain.gain.setValueAtTime(0.14, now + 0.1);
    sub33Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    sub33.connect(sub33Gain);
    sub33Gain.connect(getMasterOutput());
    sub33.start(now);
    sub33.stop(now + 0.65);

    // 44Hz second voice — creates a beating pattern with 33Hz (11Hz beat)
    const sub44 = ctx.createOscillator();
    const sub44Gain = ctx.createGain();
    sub44.type = "sine";
    sub44.frequency.setValueAtTime(44, now);
    sub44Gain.gain.setValueAtTime(0, now);
    sub44Gain.gain.linearRampToValueAtTime(0.14, now + 0.04);
    sub44Gain.gain.setValueAtTime(0.11, now + 0.12);
    sub44Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    sub44.connect(sub44Gain);
    sub44Gain.connect(getMasterOutput());
    sub44.start(now);
    sub44.stop(now + 0.6);

    // 5th harmonic of 33Hz (165Hz) — warm overtone
    const harm5 = ctx.createOscillator();
    const harm5Gain = ctx.createGain();
    const harm5Filter = ctx.createBiquadFilter();
    harm5.type = "sine";
    harm5.frequency.setValueAtTime(165, now + 0.02);
    harm5.frequency.exponentialRampToValueAtTime(176, now + 0.3);
    harm5Filter.type = "lowpass";
    harm5Filter.frequency.setValueAtTime(400, now);
    harm5Filter.Q.setValueAtTime(2, now);
    harm5Gain.gain.setValueAtTime(0, now + 0.02);
    harm5Gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
    harm5Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    harm5.connect(harm5Filter);
    harm5Filter.connect(harm5Gain);
    harm5Gain.connect(getMasterOutput());
    harm5.start(now + 0.02);
    harm5.stop(now + 0.55);

    // Crystal bell at 528Hz (Solfeggio frequency)
    const bell = ctx.createOscillator();
    const bellGain = ctx.createGain();
    bell.type = "sine";
    bell.frequency.setValueAtTime(528, now + 0.05);
    bell.frequency.exponentialRampToValueAtTime(520, now + 0.4);
    bellGain.gain.setValueAtTime(0, now + 0.05);
    bellGain.gain.linearRampToValueAtTime(0.06, now + 0.07);
    bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    bell.connect(bellGain);
    bellGain.connect(getMasterOutput());
    bell.start(now + 0.05);
    bell.stop(now + 0.5);

    // Soft shimmer at 1056Hz — octave of 528Hz
    const shim = ctx.createOscillator();
    const shimGain = ctx.createGain();
    shim.type = "triangle";
    shim.frequency.setValueAtTime(1056, now + 0.08);
    shimGain.gain.setValueAtTime(0, now + 0.08);
    shimGain.gain.linearRampToValueAtTime(0.02, now + 0.1);
    shimGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    shim.connect(shimGain);
    shimGain.connect(getMasterOutput());
    shim.start(now + 0.08);
    shim.stop(now + 0.4);
  } catch { /* audio not supported */ }
}

/** VIP unlock fanfare — plays once when VIP mode is first activated */
export function playVipUnlock(): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Triumphant ascending chord
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const t = now + i * 0.08;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.setValueAtTime(0.1, t + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(gain);
      gain.connect(getMasterOutput());
      osc.start(t);
      osc.stop(t + 0.65);
    });

    // Shimmer on top
    const shimmer = ctx.createOscillator();
    const shimGain = ctx.createGain();
    shimmer.type = "triangle";
    shimmer.frequency.setValueAtTime(2093, now + 0.3);
    shimmer.frequency.exponentialRampToValueAtTime(4186, now + 0.7);
    shimGain.gain.setValueAtTime(0, now + 0.3);
    shimGain.gain.linearRampToValueAtTime(0.04, now + 0.35);
    shimGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    shimmer.connect(shimGain);
    shimGain.connect(getMasterOutput());
    shimmer.start(now + 0.3);
    shimmer.stop(now + 0.85);
  } catch { /* audio not supported */ }
}

/**
 * Wallet connection success — layered 40Hz + 33Hz sine waves.
 * The 7Hz difference tone creates a deep, satisfying binaural pulse
 * that feels like a confirmation "lock-in". Gentle fade in/out over ~1.2s.
 */
export function playConnectionSuccess(): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const duration = 1.2;

    // Master gain — keeps the sub-bass at a pleasant level
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.22, now + 0.08);
    master.gain.setValueAtTime(0.22, now + duration * 0.5);
    master.gain.exponentialRampToValueAtTime(0.001, now + duration);
    master.connect(getMasterOutput());

    // 40Hz sine — the body
    const osc40 = ctx.createOscillator();
    const gain40 = ctx.createGain();
    osc40.type = "sine";
    osc40.frequency.setValueAtTime(40, now);
    gain40.gain.setValueAtTime(1.0, now);
    osc40.connect(gain40);
    gain40.connect(master);
    osc40.start(now);
    osc40.stop(now + duration + 0.1);

    // 33Hz sine — creates 7Hz beating with the 40Hz
    const osc33 = ctx.createOscillator();
    const gain33 = ctx.createGain();
    osc33.type = "sine";
    osc33.frequency.setValueAtTime(33, now);
    gain33.gain.setValueAtTime(0.85, now);
    osc33.connect(gain33);
    gain33.connect(master);
    osc33.start(now);
    osc33.stop(now + duration + 0.1);

    // Soft harmonic at 80Hz (octave of 40Hz) for warmth
    const harm = ctx.createOscillator();
    const harmGain = ctx.createGain();
    harm.type = "sine";
    harm.frequency.setValueAtTime(80, now);
    harmGain.gain.setValueAtTime(0, now);
    harmGain.gain.linearRampToValueAtTime(0.15, now + 0.15);
    harmGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.8);
    harm.connect(harmGain);
    harmGain.connect(master);
    harm.start(now);
    harm.stop(now + duration);

    // Gentle confirmation ping at 396Hz (Solfeggio — liberation)
    const ping = ctx.createOscillator();
    const pingGain = ctx.createGain();
    ping.type = "sine";
    ping.frequency.setValueAtTime(396, now + 0.1);
    ping.frequency.exponentialRampToValueAtTime(390, now + 0.8);
    pingGain.gain.setValueAtTime(0, now + 0.1);
    pingGain.gain.linearRampToValueAtTime(0.06, now + 0.15);
    pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    ping.connect(pingGain);
    pingGain.connect(master);
    ping.start(now + 0.1);
    ping.stop(now + 1.0);
  } catch { /* audio not supported */ }
}

// ── Portfolio VIP Sound Effects ──────────────────────────────────────

/** Ascending emerald crystal arpeggio — plays on VIP portfolio page load */
export function playPortfolioReveal(): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = "sine";
      const t = now + i * 0.065;
      osc.frequency.setValueAtTime(freq, t);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(3500, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.07 - i * 0.008, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(getMasterOutput());
      osc.start(t);
      osc.stop(t + 0.35);
    });
  } catch { /* audio not supported */ }
}

/** Soft crystal ping — plays on VIP token row hover (randomized pitch) */
export function playTokenHover(): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2093 + Math.random() * 300, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.03, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(getMasterOutput());
    osc.start(now);
    osc.stop(now + 0.12);
  } catch { /* audio not supported */ }
}

/** Whoosh sweep — plays on VIP refresh button click */
export function playRefreshWhoosh(): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    const len = ctx.sampleRate * 0.25;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.15;
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(3500, now + 0.12);
    filter.frequency.exponentialRampToValueAtTime(800, now + 0.25);
    filter.Q.setValueAtTime(2, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(getMasterOutput());
    noise.start(now);
  } catch { /* audio not supported */ }
}

// ── VIP Navigation Piano Scale ──────────────────────────────────────
// 6 unique notes in C major pentatonic, voiced like a concert grand piano.
// Each note has a fundamental + 2nd/3rd partials with exponential decay
// and a soft hammer attack. Notes rise in scale for a "staircase of light" feel.

const VIP_NAV_SCALE: { freq: number; name: string }[] = [
  { freq: 523.25, name: "C5"  },  // Markets
  { freq: 587.33, name: "D5"  },  // Trade
  { freq: 659.25, name: "E5"  },  // Swap
  { freq: 783.99, name: "G5"  },  // Buy/Sell
  { freq: 880.00, name: "A5"  },  // DeFi
  { freq: 1046.50, name: "C6" },  // Wallet / DAO / More
];

/**
 * Play a single grand-piano note from the VIP navigation scale.
 * @param index 0–5 maps to C5→C6 pentatonic. Values outside range are clamped.
 */
export function playVipNavNote(index: number): void {
  if (isMuted()) return;
  // Suppress piano hover notes on mobile — they clash with tap/interaction sounds
  if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const note = VIP_NAV_SCALE[Math.max(0, Math.min(index, VIP_NAV_SCALE.length - 1))];
    const f = note.freq;

    // Fundamental — warm sine, the body of the piano tone
    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(f, now);
    // Subtle pitch drift — simulates string resonance
    osc1.frequency.exponentialRampToValueAtTime(f * 0.999, now + 0.8);
    g1.gain.setValueAtTime(0, now);
    g1.gain.linearRampToValueAtTime(0.13, now + 0.008);  // ~8ms hammer attack
    g1.gain.setValueAtTime(0.11, now + 0.04);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc1.connect(g1);
    g1.connect(getMasterOutput());
    osc1.start(now);
    osc1.stop(now + 0.95);

    // 2nd partial (octave) — adds brightness and "ring"
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(f * 2, now);
    g2.gain.setValueAtTime(0, now);
    g2.gain.linearRampToValueAtTime(0.045, now + 0.006);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(g2);
    g2.connect(getMasterOutput());
    osc2.start(now);
    osc2.stop(now + 0.6);

    // 3rd partial (octave + fifth) — shimmer and warmth
    const osc3 = ctx.createOscillator();
    const g3 = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc3.type = "sine";
    osc3.frequency.setValueAtTime(f * 3, now);
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(4000, now);
    lp.Q.setValueAtTime(0.7, now);
    g3.gain.setValueAtTime(0, now);
    g3.gain.linearRampToValueAtTime(0.018, now + 0.005);
    g3.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc3.connect(lp);
    lp.connect(g3);
    g3.connect(getMasterOutput());
    osc3.start(now);
    osc3.stop(now + 0.4);

    // Hammer noise — the percussive "thock" of a felt hammer hitting strings
    const noise = ctx.createBufferSource();
    const nLen = Math.floor(ctx.sampleRate * 0.012);
    const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nData = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nData[i] = (Math.random() * 2 - 1) * 0.15;
    noise.buffer = nBuf;
    const nGain = ctx.createGain();
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = "bandpass";
    nFilter.frequency.setValueAtTime(f * 4, now);
    nFilter.Q.setValueAtTime(1.5, now);
    nGain.gain.setValueAtTime(0.04, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
    noise.connect(nFilter);
    nFilter.connect(nGain);
    nGain.connect(getMasterOutput());
    noise.start(now);
  } catch { /* audio not supported */ }
}

// ── VIP Feature Toggle Bass Hover ───────────────────────────────────
// Descending sub-bass notes for the 3 VIP feature rows.
// 40Hz → 36Hz → 33Hz — felt as much as heard, with warm harmonic shimmer.

const VIP_BASS_SCALE = [40, 36, 33];

/**
 * Play a deep bass pulse when hovering a VIP feature toggle row.
 * @param index 0–2 maps to 40Hz → 36Hz → 33Hz (descending).
 */
export function playVipFeatureBass(index: number): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const f = VIP_BASS_SCALE[Math.max(0, Math.min(index, 2))];

    // Sub-bass fundamental — deep rumble
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(f, now);
    sub.frequency.exponentialRampToValueAtTime(f * 0.97, now + 0.5);
    subG.gain.setValueAtTime(0, now);
    subG.gain.linearRampToValueAtTime(0.2, now + 0.025);
    subG.gain.setValueAtTime(0.16, now + 0.08);
    subG.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    sub.connect(subG);
    subG.connect(getMasterOutput());
    sub.start(now);
    sub.stop(now + 0.6);

    // 2nd harmonic — adds body you can hear on small speakers
    const h2 = ctx.createOscillator();
    const h2G = ctx.createGain();
    const h2Lp = ctx.createBiquadFilter();
    h2.type = "sine";
    h2.frequency.setValueAtTime(f * 2, now);
    h2Lp.type = "lowpass";
    h2Lp.frequency.setValueAtTime(200, now);
    h2Lp.Q.setValueAtTime(1, now);
    h2G.gain.setValueAtTime(0, now);
    h2G.gain.linearRampToValueAtTime(0.09, now + 0.02);
    h2G.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    h2.connect(h2Lp);
    h2Lp.connect(h2G);
    h2G.connect(getMasterOutput());
    h2.start(now);
    h2.stop(now + 0.45);

    // Warm 5th-harmonic shimmer — subtle emerald glow in audio form
    const h5 = ctx.createOscillator();
    const h5G = ctx.createGain();
    h5.type = "sine";
    h5.frequency.setValueAtTime(f * 5, now + 0.015);
    h5G.gain.setValueAtTime(0, now + 0.015);
    h5G.gain.linearRampToValueAtTime(0.025, now + 0.03);
    h5G.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    h5.connect(h5G);
    h5G.connect(getMasterOutput());
    h5.start(now + 0.015);
    h5.stop(now + 0.3);
  } catch { /* audio not supported */ }
}

// ── VIP Wallet Hover — Ocean Wave ────────────────────────────────────
// A short, synthesised ocean wave that swells and recedes (~1s).
// Built from three layers:
//   1. Broadband noise swept through a bandpass filter that climbs then
//      falls (simulates the frequency content of a real wave crest).
//   2. Sub-bass sine at 55 Hz — the deep body of the wave you *feel*.
//   3. High-frequency shimmer — the sparkling foam at the peak.
// Internally gated: plays only when global sound is on.
// VIP-feature gating (vip_sounds toggle) is handled at the call site.

/** Gentle ocean-wave wash — plays on wallet menu hover for VIP users */
export function playVipWalletWave(): void {
  if (isMuted()) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const dur = 0.95;

    // ── Layer 1: Broadband wave body (filtered noise) ──
    const noiseSrc = ctx.createBufferSource();
    const noiseLen = Math.floor(ctx.sampleRate * dur);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;
    noiseSrc.buffer = noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.setValueAtTime(0.8, now);
    // Sweep: 200 Hz → 1400 Hz (crest at ~40%) → 250 Hz (recede)
    bp.frequency.setValueAtTime(200, now);
    bp.frequency.exponentialRampToValueAtTime(1400, now + dur * 0.4);
    bp.frequency.exponentialRampToValueAtTime(250, now + dur);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(0.10, now + dur * 0.15);
    noiseGain.gain.linearRampToValueAtTime(0.14, now + dur * 0.38);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noiseSrc.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(getMasterOutput());
    noiseSrc.start(now);

    // ── Layer 2: Sub-bass rumble (55 Hz) ──
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(55, now);
    sub.frequency.exponentialRampToValueAtTime(52, now + dur);
    subG.gain.setValueAtTime(0, now);
    subG.gain.linearRampToValueAtTime(0.16, now + dur * 0.3);
    subG.gain.setValueAtTime(0.13, now + dur * 0.5);
    subG.gain.exponentialRampToValueAtTime(0.001, now + dur);
    sub.connect(subG);
    subG.connect(getMasterOutput());
    sub.start(now);
    sub.stop(now + dur + 0.05);

    // ── Layer 3: Foam shimmer (high-passed noise) ──
    const foamSrc = ctx.createBufferSource();
    const foamLen = Math.floor(ctx.sampleRate * dur * 0.5);
    const foamBuf = ctx.createBuffer(1, foamLen, ctx.sampleRate);
    const foamData = foamBuf.getChannelData(0);
    for (let i = 0; i < foamLen; i++) foamData[i] = Math.random() * 2 - 1;
    foamSrc.buffer = foamBuf;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(4000, now + dur * 0.25);
    hp.Q.setValueAtTime(0.5, now);

    const foamGain = ctx.createGain();
    foamGain.gain.setValueAtTime(0, now + dur * 0.25);
    foamGain.gain.linearRampToValueAtTime(0.035, now + dur * 0.4);
    foamGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.75);

    foamSrc.connect(hp);
    hp.connect(foamGain);
    foamGain.connect(getMasterOutput());
    foamSrc.start(now + dur * 0.25);
  } catch { /* audio not supported */ }
}
let audioCtx: AudioContext | null = null;

// Mute state persisted to localStorage
const MUTE_KEY = "hbarh-sound-muted";
let _muted: boolean | null = null;

function isMuted(): boolean {
  if (_muted === null) {
    _muted = typeof window !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
  }
  return _muted;
}

export function setSoundMuted(muted: boolean): void {
  _muted = muted;
  if (typeof window !== "undefined") {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  }
}

export function getSoundMuted(): boolean {
  return isMuted();
}

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
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
  gain.connect(ctx.destination);
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
      osc1.connect(gain1); gain1.connect(ctx.destination);
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
      osc2.connect(gain2); gain2.connect(ctx.destination);
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
      osc3.connect(filter3); filter3.connect(gain3); gain3.connect(ctx.destination);
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
      osc1.connect(gain1); gain1.connect(ctx.destination);
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
      osc2.connect(filter2); filter2.connect(gain2); gain2.connect(ctx.destination);
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
    hitGain.connect(ctx.destination);
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
    bell1Gain.connect(ctx.destination);
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
    bell2Gain.connect(ctx.destination);
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
    noiseGain.connect(ctx.destination);
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
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch { /* audio not supported */ }
}

/**
 * VIP iridescent button chime — uses 33Hz and 44Hz sine waves layered
 * with harmonics to produce a deep, pleasant resonance when hovering
 * or clicking Trade/Bridge buttons in VIP mode.
 */
export function playVipButtonChime(): void {
  if (isMuted()) return;
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
    sub33Gain.connect(ctx.destination);
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
    sub44Gain.connect(ctx.destination);
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
    harm5Gain.connect(ctx.destination);
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
    bellGain.connect(ctx.destination);
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
    shimGain.connect(ctx.destination);
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
      gain.connect(ctx.destination);
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
    shimGain.connect(ctx.destination);
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
    master.connect(ctx.destination);

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
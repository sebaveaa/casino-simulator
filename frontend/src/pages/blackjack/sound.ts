import cardDealUrl from "./card-deal.mp3";
import type { RoundTone } from "./format";

const STORAGE_KEY = "casino.blackjack.sound";

let context: AudioContext | null = null;
let buffer: Promise<AudioBuffer | null> | null = null;

/** Whether the player turned the table's sound off; on by default, and when storage is blocked. */
export function isSoundOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // A preference only: without storage it lasts until the page reloads.
  }
}

function audioContext(): AudioContext | null {
  if (typeof window.AudioContext !== "function") return null;
  context ??= new window.AudioContext();
  return context;
}

/**
 * The context to play on, or `null` when the player turned the sound off or Web Audio is missing
 * (tests, old browsers). Browsers start audio suspended until a gesture; a sound always follows a
 * click.
 */
function liveContext(): AudioContext | null {
  if (!isSoundOn()) return null;
  const ctx = audioContext();
  if (ctx?.state === "suspended") void ctx.resume();
  return ctx;
}

/** Builds and starts a sound a moment from now. Sound is decoration: it never throws. */
function play(build: (ctx: AudioContext, at: number) => void): void {
  const ctx = liveContext();
  if (!ctx) return;
  try {
    build(ctx, ctx.currentTime + 0.01);
  } catch {
    // The game never depends on its sound.
  }
}

/**
 * Fetches and decodes the card sound once: one card a dealer slides onto a wooden table, cut from
 * a three-card recording, with the room's echo gated out. Call it when the table shows, so the
 * first card already has its sound. `null` where Web Audio is missing.
 */
export function preloadCardSound(): Promise<AudioBuffer | null> {
  const ctx = audioContext();
  if (!ctx) return Promise.resolve(null);
  buffer ??= fetch(cardDealUrl)
    .then((response) => response.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .catch(() => null);
  return buffer;
}

export function playCardSound(): void {
  if (!liveContext()) return;
  void preloadCardSound().then((decoded) => {
    if (!decoded) return;
    play((ctx, at) => {
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      const gain = ctx.createGain();
      gain.gain.value = 0.8;
      source.connect(gain).connect(ctx.destination);
      source.start(at);
    });
  });
}

/** A burst of band-passed noise that dies off fast: clay striking clay. */
function click(ctx: AudioContext, at: number, frequency: number, level: number, length: number) {
  const samples = Math.ceil(ctx.sampleRate * length);
  const noise = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / samples) ** 3;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = 2.5;
  const gain = ctx.createGain();
  gain.gain.value = level;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at);
}

/** One note with a quick attack and an exponential fade; `glideTo` bends it on the way out. */
function note(
  ctx: AudioContext,
  at: number,
  frequency: number,
  length: number,
  level: number,
  type: OscillatorType = "triangle",
  glideTo?: number,
) {
  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, at + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.05);
}

/** A chip set down on the bet: a bright clack with a short ring, then a smaller one as it settles. */
export function playChipSound(): void {
  play((ctx, at) => {
    click(ctx, at, 3600, 1.2, 0.04);
    click(ctx, at, 1400, 0.5, 0.03);
    note(ctx, at, 2900, 0.08, 0.05, "sine");
    click(ctx, at + 0.05, 4200, 0.5, 0.025);
  });
}

// C major for a gain, a repeated G for even, a falling C minor for a loss (Hz).
const C4 = 261.63;
const E_FLAT4 = 311.13;
const G4 = 392;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

/**
 * The round's result, by its net over every hand (so a split that lost one hand and won more on
 * the other sounds like a win): a rising arpeggio for a gain, two soft even notes for a push, a
 * falling line that sags at the end for a loss.
 */
export function playResultSound(tone: RoundTone): void {
  play((ctx, at) => {
    if (tone === "won") {
      [C5, E5, G5].forEach((frequency, i) => {
        note(ctx, at + i * 0.09, frequency, 0.25, 0.16);
      });
      note(ctx, at + 0.27, C6, 0.7, 0.18);
      note(ctx, at + 0.27, C5, 0.7, 0.1, "sine");
    } else if (tone === "even") {
      note(ctx, at, G4, 0.22, 0.14, "sine");
      note(ctx, at + 0.18, G4, 0.35, 0.12, "sine");
    } else {
      note(ctx, at, G4, 0.28, 0.15);
      note(ctx, at + 0.2, E_FLAT4, 0.28, 0.15);
      note(ctx, at + 0.4, C4, 0.75, 0.16, "triangle", C4 * 0.94);
    }
  });
}

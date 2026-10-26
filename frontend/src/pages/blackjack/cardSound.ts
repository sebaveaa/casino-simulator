const STORAGE_KEY = "casino.blackjack.sound";

let context: AudioContext | null = null;

/** Whether the player turned the card sound off; on by default, and when storage is blocked. */
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

/**
 * The snap of a card on the felt, synthesized with Web Audio so the repo ships no audio file: a
 * short burst of noise, band-passed around a card's crack and fading fast. Silent where Web Audio
 * is missing (tests, old browsers) or the player turned it off.
 */
export function playCardSound(): void {
  if (!isSoundOn() || typeof window.AudioContext !== "function") return;
  try {
    context ??= new window.AudioContext();
    if (context.state === "suspended") void context.resume();
    const ctx = context;
    const length = Math.floor(ctx.sampleRate * 0.09);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // White noise under a steep exponential decay: a snap, not a hiss.
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 4;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  } catch {
    // Sound is decoration; the game never depends on it.
  }
}

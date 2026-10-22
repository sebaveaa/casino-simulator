import type * as Pixi from "pixi.js";
import { animals } from "./animals";

/* Static layers of the track in the Casino Cloud look: ink outlines and flat fills. */

export const SCENE_WIDTH = 640;
export const SCENE_HEIGHT = 320;
const MARGIN_Y = 10;
export const START_X = 56;
export const FINISH_X = SCENE_WIDTH - 40;
const RUNNER_SIZE = 30;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const LANE_HEIGHT = (SCENE_HEIGHT - MARGIN_Y * 2) / animals.length;

export interface TrackPalette {
  ink: number;
  chalk: number;
  lilac: number;
  font: string;
}

const FALLBACK: TrackPalette = {
  ink: 0x141414,
  chalk: 0xffffff,
  lilac: 0xf1ecff,
  font: '"Space Mono", ui-monospace, "Cascadia Mono", monospace',
};

function cssValue(name: string): string {
  return typeof document === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function cssColor(name: string, fallback: number): number {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(cssValue(name));
  const digits = match?.[1];
  if (!digits) return fallback;
  const hex = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  return Number.parseInt(hex, 16);
}

/** Reads the design tokens from the live stylesheet, with fixed fallbacks. */
export function readTrackPalette(): TrackPalette {
  return {
    ink: cssColor("--ink", FALLBACK.ink),
    chalk: cssColor("--chalk", FALLBACK.chalk),
    lilac: cssColor("--lilac", FALLBACK.lilac),
    font: cssValue("--font-amount") || FALLBACK.font,
  };
}

/** Horizontal scene position of a runner that advanced `advance` (0..1) along the lane. */
export function runnerX(advance: number): number {
  return START_X + (FINISH_X - START_X) * Math.min(1, Math.max(0, advance));
}

export function laneCenterY(lane: number): number {
  return MARGIN_Y + LANE_HEIGHT * (lane + 0.5);
}

/** Lane backgrounds, lane lines, start line and checkered finish line. */
export function buildTrack(pixi: typeof Pixi, palette: TrackPalette): Pixi.Container {
  const track = new pixi.Container();
  const g = new pixi.Graphics();
  const left = START_X - 20;
  g.roundRect(2, 2, SCENE_WIDTH - 4, SCENE_HEIGHT - 4, 12).fill(palette.chalk);
  animals.forEach((animal, lane) => {
    const y = MARGIN_Y + LANE_HEIGHT * lane;
    if (lane % 2 === 0) g.rect(left, y, FINISH_X - left, LANE_HEIGHT).fill(palette.lilac);
    g.moveTo(left, y).lineTo(FINISH_X, y).stroke({ width: 1, color: palette.ink, alpha: 0.35 });
    const label = new pixi.Text({
      text: String(animal.id + 1),
      style: { fontFamily: palette.font, fontSize: 14, fontWeight: "700", fill: palette.ink },
    });
    label.anchor.set(0.5);
    label.position.set(18, laneCenterY(lane));
    track.addChild(label);
  });
  const bottom = MARGIN_Y + LANE_HEIGHT * animals.length;
  g.moveTo(left, bottom)
    .lineTo(FINISH_X, bottom)
    .stroke({ width: 1, color: palette.ink, alpha: 0.35 });
  g.moveTo(left, MARGIN_Y).lineTo(left, bottom).stroke({ width: 2, color: palette.ink });
  // Checkered finish line, two columns of squares.
  const square = LANE_HEIGHT / 3;
  for (let row = 0; row < animals.length * 3; row++) {
    for (let col = 0; col < 2; col++) {
      if ((row + col) % 2 === 0) {
        g.rect(FINISH_X + col * square * 0.5, MARGIN_Y + row * square, square * 0.5, square).fill(
          palette.ink,
        );
      }
    }
  }
  g.roundRect(2, 2, SCENE_WIDTH - 4, SCENE_HEIGHT - 4, 12).stroke({
    width: 3,
    color: palette.ink,
  });
  track.addChildAt(g, 0);
  return track;
}

/** One marker per animal (index = animal id): its emoji, mirrored when it looks away from the finish. */
export function buildRunners(pixi: typeof Pixi, palette: TrackPalette): Pixi.Container[] {
  return animals.map((animal, lane) => {
    const runner = new pixi.Container();
    const glyph = new pixi.Text({
      text: animal.emoji,
      style: {
        fontFamily: EMOJI_FONT,
        fontSize: RUNNER_SIZE,
        dropShadow: { color: palette.ink, alpha: 0.5, angle: Math.PI / 2, blur: 2, distance: 4 },
      },
    });
    glyph.anchor.set(0.5);
    if (animal.facesLeft) glyph.scale.x = -1;
    runner.addChild(glyph);
    runner.position.set(runnerX(0), laneCenterY(lane));
    return runner;
  });
}

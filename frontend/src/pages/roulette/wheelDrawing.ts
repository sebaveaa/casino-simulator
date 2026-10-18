import { pocketColor } from "@casino/shared";
import type * as Pixi from "pixi.js";
import { POCKET_INNER, POCKET_OUTER } from "./ballMotion";
import { POCKET_ANGLE, WHEEL_ORDER } from "./wheelAngles";

/*
 * Static layers of the wheel in the Casino Cloud look: thick ink outlines, flat fills and hard
 * offset shadows with no blur, the same as the rest of the app (styles.css).
 */

const TAU = Math.PI * 2;

/** Side of the square scene, in scene units. The canvas scales to its container. */
export const SCENE_SIZE = 400;
export const CENTER = SCENE_SIZE / 2;
export const BALL_RADIUS = 6.5;

const RIM_RADIUS = 190;
const TRACK_EDGE_RADIUS = 177;

export interface Palette {
  ink: number;
  sun: number;
  chalk: number;
  lilac: number;
  red: number;
  green: number;
  /** CSS font-family list for the pocket numbers. */
  font: string;
}

const FALLBACK: Palette = {
  ink: 0x141414,
  sun: 0xffc933,
  chalk: 0xffffff,
  lilac: 0xf1ecff,
  red: 0xd62839,
  green: 0x1b8a3e,
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

/** Reads the design tokens from the live stylesheet when it draws, with fixed fallbacks. */
export function readPalette(): Palette {
  return {
    ink: cssColor("--ink", FALLBACK.ink),
    sun: cssColor("--sun", FALLBACK.sun),
    chalk: cssColor("--chalk", FALLBACK.chalk),
    lilac: cssColor("--lilac", FALLBACK.lilac),
    // The table's .pocket-red and .pocket-green use these tokens.
    red: cssColor("--pocket-red", FALLBACK.red),
    green: cssColor("--pocket-green", FALLBACK.green),
    font: cssValue("--font-amount") || FALLBACK.font,
  };
}

/** Longest wait for the wheel font before drawing with the fallback. */
const FONT_TIMEOUT_MS = 1500;

/** Waits for the numbers' font so the first draw does not fall back to a system font. */
export async function loadWheelFonts(timeoutMs = FONT_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A load that never settles must not hold the wheel back: past the timeout it draws anyway.
    await Promise.race([
      Promise.all([
        document.fonts.load("700 12px 'Space Mono'"),
        document.fonts.load("400 12px 'Space Mono'"),
      ]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // The font is cosmetic: draw with the fallback if it cannot load.
  } finally {
    clearTimeout(timer);
  }
}

/** Annular sector. Angles are Pixi's (from +x, clockwise). */
function sector(g: Pixi.Graphics, inner: number, outer: number, a0: number, a1: number) {
  return g
    .moveTo(Math.cos(a0) * outer, Math.sin(a0) * outer)
    .arc(0, 0, outer, a0, a1)
    .lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner)
    .arc(0, 0, inner, a1, a0, true)
    .closePath();
}

/** Pocket `index` spans these Pixi angles; the wheel measures clockwise from the top. */
function pocketArc(index: number): [number, number] {
  const centre = index * POCKET_ANGLE - Math.PI / 2;
  return [centre - POCKET_ANGLE / 2, centre + POCKET_ANGLE / 2];
}

function diamondPoints(angle: number, radius: number, halfW: number, halfH: number): number[] {
  const x = Math.sin(angle) * radius;
  const y = -Math.cos(angle) * radius;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    [0, -halfH],
    [halfW, 0],
    [0, halfH],
    [-halfW, 0],
  ].flatMap(([px = 0, py = 0]) => [x + px * cos - py * sin, y + px * sin + py * cos]);
}

/** The fixed bowl: hard shadow, sun-yellow rim, lilac ball track and the deflector diamonds. */
export function buildBowl(pixi: typeof Pixi, p: Palette): Pixi.Container {
  const { Container, Graphics } = pixi;
  const bowl = new Container();
  bowl.position.set(CENTER, CENTER);
  // A hard offset copy of the rim, like the app's offset shadows.
  bowl.addChild(new Graphics().circle(7, 7, RIM_RADIUS).fill(p.ink));
  bowl.addChild(
    new Graphics().circle(0, 0, RIM_RADIUS).fill(p.sun).stroke({ width: 3, color: p.ink }),
  );
  bowl.addChild(
    new Graphics().circle(0, 0, TRACK_EDGE_RADIUS).fill(p.lilac).stroke({ width: 3, color: p.ink }),
  );
  const studs = new Graphics();
  for (let k = 0; k < 12; k++) {
    const angle = (k / 12) * TAU;
    studs.circle(Math.sin(angle) * 183.5, -Math.cos(angle) * 183.5, 2.6);
  }
  bowl.addChild(studs.fill(p.ink));
  for (let k = 0; k < 8; k++) {
    const angle = (k + 0.5) * (TAU / 8);
    bowl.addChild(
      new Graphics()
        .poly(diamondPoints(angle, 164, 5.5, 8))
        .fill(p.sun)
        .stroke({ width: 2, color: p.ink }),
    );
  }
  return bowl;
}

/** The turning part: pockets with their numbers, frets, chalk cone with spokes, and the turret. */
export function buildWheel(pixi: typeof Pixi, p: Palette): Pixi.Container {
  const { Container, Graphics, Text } = pixi;
  const colors = { red: p.red, black: p.ink, green: p.green } as const;
  const wheel = new Container();
  wheel.addChild(new Graphics().circle(0, 0, POCKET_OUTER + 4).fill(p.ink));

  WHEEL_ORDER.forEach((pocket, index) => {
    const [a0, a1] = pocketArc(index);
    wheel.addChild(
      sector(new Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).fill(colors[pocketColor(pocket)]),
    );
  });

  // Sun-yellow frets on every pocket boundary, with ink lips inside and outside.
  const frets = new Graphics();
  WHEEL_ORDER.forEach((_, index) => {
    const [a] = pocketArc(index);
    if (a === undefined) return;
    frets
      .moveTo(Math.cos(a) * POCKET_INNER, Math.sin(a) * POCKET_INNER)
      .lineTo(Math.cos(a) * (POCKET_OUTER + 2), Math.sin(a) * (POCKET_OUTER + 2));
  });
  wheel.addChild(frets.stroke({ width: 2, color: p.sun }));
  wheel.addChild(
    new Graphics()
      .circle(0, 0, POCKET_INNER)
      .stroke({ width: 3, color: p.ink })
      .circle(0, 0, POCKET_OUTER + 1)
      .stroke({ width: 3, color: p.ink }),
  );

  WHEEL_ORDER.forEach((pocket, index) => {
    const centre = index * POCKET_ANGLE;
    const label = new Text({
      text: String(pocket),
      style: { fill: p.chalk, fontSize: 12, fontWeight: "700", fontFamily: p.font },
    });
    label.anchor.set(0.5);
    label.position.set(Math.sin(centre) * 139, -Math.cos(centre) * 139);
    label.rotation = centre;
    wheel.addChild(label);
  });

  wheel.addChild(new Graphics().circle(0, 0, POCKET_INNER - 1).fill(p.chalk));
  // Eight ink spokes, the same pattern as the roulette icon in the lobby.
  const spokes = new Graphics();
  for (let k = 0; k < 8; k++) {
    const angle = (k / 8) * TAU;
    spokes
      .moveTo(Math.sin(angle) * 40, -Math.cos(angle) * 40)
      .lineTo(Math.sin(angle) * 98, -Math.cos(angle) * 98);
  }
  wheel.addChild(spokes.stroke({ width: 4, color: p.ink, cap: "round" }));
  wheel.addChild(
    new Graphics()
      .circle(0, 0, 32)
      .fill(p.sun)
      .stroke({ width: 3, color: p.ink })
      .circle(0, 0, 7)
      .fill(p.ink),
  );
  return wheel;
}

/** Flat sticker-like ring around a pocket: thick ink outline with a sun-yellow core, no blur. */
export function buildWinRing(pixi: typeof Pixi, p: Palette, pocket: number): Pixi.Container {
  const [a0, a1] = pocketArc(WHEEL_ORDER.indexOf(pocket));
  const ring = new pixi.Container();
  ring.addChild(
    sector(new pixi.Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).stroke({
      width: 8,
      color: p.ink,
    }),
  );
  ring.addChild(
    sector(new pixi.Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).stroke({
      width: 4,
      color: p.sun,
    }),
  );
  ring.alpha = 0;
  return ring;
}

/** Flat white ball with a thick ink outline and a hard ink shadow. */
export function buildBall(pixi: typeof Pixi, p: Palette) {
  const shadow = new pixi.Graphics().circle(0, 0, BALL_RADIUS + 1).fill(p.ink);
  const body = new pixi.Graphics()
    .circle(0, 0, BALL_RADIUS)
    .fill(p.chalk)
    .stroke({ width: 2.5, color: p.ink });
  return { shadow, body };
}

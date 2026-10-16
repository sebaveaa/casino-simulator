// PROTOTYPE — throwaway, see branch prototype/12-roulette-table
import { type PocketColor, pocketColor } from "@casino/shared";
import type * as Pixi from "pixi.js";
import { easeOutCubic, POCKET_ANGLE, pocketAngle, WHEEL_ORDER } from "../wheelAngles";

export const BALL_WHEEL_SIZE = 400;
const C = BALL_WHEEL_SIZE / 2;
const TAU = Math.PI * 2;

// Radii, from the outside in.
const TRACK_RADIUS = 166; // where the ball runs before it drops
const POCKET_OUTER = 148;
const POCKET_INNER = 108;
const POCKET_BALL_RADIUS = 127;
const BALL_RADIUS = 6.5;

// Timeline (ms). The wheel stops at TOTAL_MS; the ball is in its pocket long before.
const DROP_START_MS = 3200;
const SPIRAL_END_MS = 5000;
const HOP_MS = [400, 280, 200, 120];
const HOP_END_MS = SPIRAL_END_MS + HOP_MS.reduce((sum, ms) => sum + ms, 0);
const TOTAL_MS = 6600;
const GLOW_MS = 1500;
const WHEEL_TURNS = 3.2;
const FADE_MS = 300;

// ---------------------------------------------------------------------------------------
// Themes. Each theme picks a different *structure* for the rim, frets, cone, turret,
// handles, deflectors and ball, not only a different palette.
// ---------------------------------------------------------------------------------------

export type WheelThemeId = "brand" | "classic" | "luxury";

/** The app's design tokens (styles.css), as Pixi colours. */
export interface BrandPalette {
  ink: number;
  sun: number;
  chalk: number;
  lilac: number;
  /** CSS font-family list for the pocket numbers. */
  font: string;
}

const BRAND_FALLBACK: BrandPalette = {
  ink: 0x141414,
  sun: 0xffc933,
  chalk: 0xffffff,
  lilac: 0xf1ecff,
  font: '"Space Mono", ui-monospace, "Cascadia Mono", monospace',
};

/** Table-cell colours (not CSS tokens: styles.css hardcodes them on .pocket-red/.pocket-green). */
const BRAND_RED = 0xd62839;
const BRAND_GREEN = 0x1b8a3e;

function cssColor(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!match?.[1]) return fallback;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return Number.parseInt(hex, 16);
}

/** Reads the brand tokens from the live stylesheet, with hardcoded fallbacks. */
export function readBrandPalette(): BrandPalette {
  const font =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue("--font-amount").trim();
  return {
    ink: cssColor("--ink", BRAND_FALLBACK.ink),
    sun: cssColor("--sun", BRAND_FALLBACK.sun),
    chalk: cssColor("--chalk", BRAND_FALLBACK.chalk),
    lilac: cssColor("--lilac", BRAND_FALLBACK.lilac),
    font: font || BRAND_FALLBACK.font,
  };
}

export interface WheelTheme {
  id: WheelThemeId;
  label: string;
  /** CSS background for the picker swatch. */
  swatch: string;
  rim: "brand" | "wood" | "gold";
  /** Track floor shades, outer to inner (wood and gold rims). */
  trackShades: [number, number];
  /** Drop shadow under the bowl: soft blur-like, or a hard offset copy. */
  shadow: { kind: "soft" | "hard"; color: number; alpha: number };
  wheelBase: number;
  pockets: Record<PocketColor, number>;
  labels: {
    color: number;
    font: string;
    weight: "400" | "600" | "700";
    size: number;
  };
  frets: { color: number; width: number; lip: number; lipWidth: number };
  cone: "brand" | "wood" | "gold";
  turret: "brand" | "brass" | "gold";
  handles: "chrome" | "gold" | "none";
  diamonds: "brand" | "gold";
  ball: {
    body: number;
    rim: number;
    rimWidth: number;
    /** Specular dot, or null for a flat ball. */
    highlight: number | null;
    /** Hard ink shadow instead of a soft one. */
    hardShadow: boolean;
  };
  /** Winning pocket highlight: a soft bloom or a flat sticker-like ring. */
  glow: { style: "bloom" | "ring"; color: number; edge: number; strength: number };
  /** Palette used by the brand structures. */
  palette: BrandPalette;
}

function brandTheme(p: BrandPalette): WheelTheme {
  return {
    id: "brand",
    label: "Casino Cloud",
    swatch: "linear-gradient(135deg, #ffc933 50%, #141414 50%)",
    rim: "brand",
    trackShades: [p.lilac, p.lilac],
    shadow: { kind: "hard", color: p.ink, alpha: 1 },
    wheelBase: p.ink,
    pockets: { red: BRAND_RED, black: p.ink, green: BRAND_GREEN },
    labels: { color: p.chalk, font: p.font, weight: "700", size: 12 },
    frets: { color: p.sun, width: 2, lip: p.ink, lipWidth: 3 },
    cone: "brand",
    turret: "brand",
    handles: "none",
    diamonds: "brand",
    ball: {
      body: p.chalk,
      rim: p.ink,
      rimWidth: 2.5,
      highlight: null,
      hardShadow: true,
    },
    glow: { style: "ring", color: p.sun, edge: p.ink, strength: 1 },
    palette: p,
  };
}

export const WHEEL_THEMES: Record<WheelThemeId, WheelTheme> = {
  brand: brandTheme(BRAND_FALLBACK),
  classic: {
    id: "classic",
    label: "Clásica",
    swatch: "linear-gradient(135deg, #8a5a2b 50%, #d62839 50%)",
    rim: "wood",
    trackShades: [0x1b1b22, 0x3d3d4a],
    shadow: { kind: "soft", color: 0x000000, alpha: 0.22 },
    wheelBase: 0xb8942f,
    pockets: { red: 0xd62839, black: 0x141414, green: 0x1b8a3e },
    labels: { color: 0xffffff, font: "monospace", weight: "700", size: 12 },
    frets: { color: 0xf0d36e, width: 1.6, lip: 0xf0d36e, lipWidth: 2.5 },
    cone: "wood",
    turret: "brass",
    handles: "chrome",
    diamonds: "gold",
    ball: { body: 0xf4f4f8, rim: 0xb0b0ba, rimWidth: 1, highlight: 0xffffff, hardShadow: false },
    glow: { style: "bloom", color: 0xffffff, edge: 0xffc933, strength: 1 },
    palette: BRAND_FALLBACK,
  },
  luxury: {
    id: "luxury",
    label: "Lujo",
    swatch: "linear-gradient(135deg, #d4af37 50%, #0a0a0a 50%)",
    rim: "gold",
    trackShades: [0x0c0c0c, 0x2a2410],
    shadow: { kind: "soft", color: 0x000000, alpha: 0.3 },
    wheelBase: 0xd4af37,
    pockets: { red: 0x8e1b2a, black: 0x0a0a0a, green: 0x0f5a35 },
    labels: { color: 0xf6e7b4, font: "Georgia, serif", weight: "700", size: 13 },
    frets: { color: 0xd4af37, width: 2.2, lip: 0xd4af37, lipWidth: 2.5 },
    cone: "gold",
    turret: "gold",
    handles: "gold",
    diamonds: "gold",
    ball: { body: 0xfff4d6, rim: 0xc9a227, rimWidth: 1, highlight: 0xffffff, hardShadow: false },
    glow: { style: "bloom", color: 0xffe08a, edge: 0xffffff, strength: 1.3 },
    palette: BRAND_FALLBACK,
  },
};

export const WHEEL_THEME_IDS: WheelThemeId[] = ["brand", "classic", "luxury"];

export function isWheelThemeId(value: unknown): value is WheelThemeId {
  return typeof value === "string" && (WHEEL_THEME_IDS as string[]).includes(value);
}

/** The theme to draw with: the brand theme follows the live CSS tokens. */
function resolveTheme(id: WheelThemeId): WheelTheme {
  return id === "brand" ? brandTheme(readBrandPalette()) : WHEEL_THEMES[id];
}

export interface BallWheelScene {
  /** Spins to `pocket`; `onEnd` runs once when the wheel stops. Replaces a spin in progress. */
  spinTo(pocket: number, onEnd: () => void, instant: boolean): void;
  /** Redraws the static layers. During a spin it waits for the spin to end. */
  setTheme(id: WheelThemeId): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function mix(a: number, b: number, t: number): number {
  const ch = (shift: number) =>
    Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, t)) << shift;
  return ch(16) | ch(8) | ch(0);
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

/** Radial lines on every pocket boundary. */
function fretLayer(pixi: typeof Pixi, width: number, color: number): Pixi.Graphics {
  const g = new pixi.Graphics();
  WHEEL_ORDER.forEach((_, index) => {
    const a = pocketArc(index)[0];
    g.moveTo(Math.cos(a) * POCKET_INNER, Math.sin(a) * POCKET_INNER).lineTo(
      Math.cos(a) * (POCKET_OUTER + 2),
      Math.sin(a) * (POCKET_OUTER + 2),
    );
  });
  return g.stroke({ width, color });
}

function diamondPoints(a: number, radius: number, halfW: number, halfH: number): number[] {
  const x = Math.sin(a) * radius;
  const y = -Math.cos(a) * radius;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [
    [0, -halfH],
    [halfW, 0],
    [0, halfH],
    [-halfW, 0],
  ].flatMap(([px = 0, py = 0]) => [x + px * cos - py * sin, y + px * sin + py * cos]);
}

// ---------------------------------------------------------------------------------------
// Static layers
// ---------------------------------------------------------------------------------------

function buildBowl(pixi: typeof Pixi, t: WheelTheme): Pixi.Container {
  const { Container, Graphics } = pixi;
  const b = t.palette;
  const bowl = new Container();
  bowl.position.set(C, C);

  if (t.shadow.kind === "hard") {
    // Hard offset copy of the rim, like the app's offset shadows.
    bowl.addChild(new Graphics().circle(7, 7, 190).fill(t.shadow.color));
  } else {
    bowl.addChild(
      new Graphics().circle(3, 9, 196).fill({ color: t.shadow.color, alpha: t.shadow.alpha }),
    );
  }

  if (t.rim === "brand") {
    // Sun-yellow rim and lilac track, both with thick ink outlines.
    bowl.addChild(new Graphics().circle(0, 0, 190).fill(b.sun).stroke({ width: 3, color: b.ink }));
    bowl.addChild(
      new Graphics().circle(0, 0, 177).fill(b.lilac).stroke({ width: 3, color: b.ink }),
    );
    const studs = new Graphics();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      studs.circle(Math.sin(a) * 183.5, -Math.cos(a) * 183.5, 2.6);
    }
    bowl.addChild(studs.fill(b.ink));
  } else {
    const rim = new Graphics();
    if (t.rim === "wood") {
      rim
        .circle(0, 0, 197)
        .fill(0x2a170a)
        .circle(0, 0, 192)
        .fill(0x6b3f1e)
        .circle(0, 0, 189)
        .stroke({ width: 2, color: 0xa56a38 })
        .circle(0, 0, 183)
        .fill(0xb9bac4);
    } else {
      rim
        .circle(0, 0, 197)
        .fill(0x0b0b0b)
        .circle(0, 0, 194)
        .fill(0xb8942f)
        .circle(0, 0, 190)
        .fill(0xe7c65a)
        .circle(0, 0, 186)
        .fill(0x8a6a14)
        .circle(0, 0, 183)
        .fill(0xd4af37);
    }
    bowl.addChild(rim);

    // The ball track slopes toward the wheel: shades step from outside to inside.
    const track = new Graphics().circle(0, 0, 181).fill(t.trackShades[0]);
    for (let r = 180; r > 152; r -= 4) {
      track.circle(0, 0, r).fill(mix(t.trackShades[0], t.trackShades[1], (180 - r) / 28));
    }
    bowl.addChild(track);

    if (t.rim === "gold") {
      // Engraved ticks around the gold rim.
      const ticks = new Graphics();
      for (let k = 0; k < 74; k++) {
        const a = (k / 74) * TAU;
        const major = k % 6 === 0;
        const r0 = major ? 183.5 : 185.5;
        const r1 = major ? 192 : 190;
        ticks
          .moveTo(Math.sin(a) * r0, -Math.cos(a) * r0)
          .lineTo(Math.sin(a) * r1, -Math.cos(a) * r1);
      }
      bowl.addChild(ticks.stroke({ width: 1.2, color: 0x4a3608 }));
    }
  }

  // Diamond deflectors on the track.
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * (TAU / 8);
    const diamond =
      t.diamonds === "brand"
        ? new Graphics()
            .poly(diamondPoints(a, 164, 5.5, 8))
            .fill(b.sun)
            .stroke({ width: 2, color: b.ink })
        : new Graphics()
            .poly(diamondPoints(a, 157, 5, 9))
            .fill(0xe8c75a)
            .stroke({ width: 1.5, color: 0x6b3f1e });
    bowl.addChild(diamond);
  }
  return bowl;
}

function buildWheel(pixi: typeof Pixi, t: WheelTheme): Pixi.Container {
  const { Container, Graphics, Text } = pixi;
  const b = t.palette;
  const wheel = new Container();
  wheel.addChild(new Graphics().circle(0, 0, POCKET_OUTER + 4).fill(t.wheelBase));

  WHEEL_ORDER.forEach((pocket, index) => {
    const [a0, a1] = pocketArc(index);
    wheel.addChild(
      sector(new Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).fill(
        t.pockets[pocketColor(pocket)],
      ),
    );
  });

  // Pocket separators and the inner and outer lips.
  const f = t.frets;
  wheel.addChild(fretLayer(pixi, f.width, f.color));
  wheel.addChild(
    new Graphics()
      .circle(0, 0, POCKET_INNER)
      .stroke({ width: f.lipWidth, color: f.lip })
      .circle(0, 0, POCKET_OUTER + 1)
      .stroke({ width: f.lipWidth, color: f.lip }),
  );

  WHEEL_ORDER.forEach((pocket, index) => {
    const centre = index * POCKET_ANGLE;
    const label = new Text({
      text: String(pocket),
      style: {
        fill: t.labels.color,
        fontSize: t.labels.size,
        fontWeight: t.labels.weight,
        fontFamily: t.labels.font,
      },
    });
    label.anchor.set(0.5);
    label.position.set(Math.sin(centre) * 139, -Math.cos(centre) * 139);
    label.rotation = centre;
    wheel.addChild(label);
  });

  // Cone between the pockets and the turret.
  const cone = new Graphics();
  if (t.cone === "brand") {
    cone.circle(0, 0, POCKET_INNER - 1).fill(b.chalk);
  } else {
    const [from, to] =
      t.cone === "wood" ? ([0x5a3416, 0xc08a4a] as const) : ([0x0a0a0a, 0x2a2410] as const);
    for (let r = POCKET_INNER - 1; r > 60; r -= 4) {
      cone.circle(0, 0, r).fill(mix(from, to, (POCKET_INNER - r) / 48));
    }
  }
  wheel.addChild(cone);

  if (t.cone === "brand") {
    // Eight ink spokes, the same pattern as the roulette icon in the lobby.
    const spokes = new Graphics();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      spokes
        .moveTo(Math.sin(a) * 40, -Math.cos(a) * 40)
        .lineTo(Math.sin(a) * 98, -Math.cos(a) * 98);
    }
    wheel.addChild(spokes.stroke({ width: 4, color: b.ink, cap: "round" }));
  }
  if (t.cone === "gold") {
    const spokes = new Graphics();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      spokes
        .moveTo(Math.sin(a) * 66, -Math.cos(a) * 66)
        .lineTo(Math.sin(a) * 104, -Math.cos(a) * 104);
    }
    wheel.addChild(spokes.stroke({ width: 1.2, color: 0xd4af37, alpha: 0.8 }));
    wheel.addChild(
      new Graphics()
        .circle(0, 0, 100)
        .stroke({ width: 1.5, color: 0xd4af37 })
        .circle(0, 0, 84)
        .stroke({ width: 1, color: 0xd4af37, alpha: 0.7 }),
    );
  }

  // Turret.
  if (t.turret === "brand") {
    wheel.addChild(
      new Graphics()
        .circle(0, 0, 32)
        .fill(b.sun)
        .stroke({ width: 3, color: b.ink })
        .circle(0, 0, 7)
        .fill(b.ink),
    );
  } else {
    const turret = new Graphics();
    const [dark, light] =
      t.turret === "brass" ? ([0x8a6a14, 0xfff0b0] as const) : ([0x9a7a1a, 0xffe9a0] as const);
    for (let r = 62; r > 8; r -= 3) turret.circle(0, 0, r).fill(mix(dark, light, (62 - r) / 54));
    turret.circle(0, 0, 62).stroke({ width: 2, color: 0x6b4f0c });
    if (t.turret === "gold") {
      turret
        .circle(0, 0, 48)
        .stroke({ width: 1, color: 0x6b4f0c })
        .circle(0, 0, 36)
        .stroke({ width: 1, color: 0x6b4f0c, alpha: 0.7 });
    }
    wheel.addChild(turret);
  }

  // Cross handles.
  if (t.handles === "chrome" || t.handles === "gold") {
    const [bar, edge, cap] =
      t.handles === "chrome"
        ? ([0xd5d5de, 0x6a6a76, 0xf2f2f7] as const)
        : ([0xd4af37, 0x6b4f0c, 0xfff4d6] as const);
    const handles = new Graphics()
      .roundRect(-72, -3.5, 144, 7, 3.5)
      .fill(bar)
      .stroke({ width: 1, color: edge })
      .roundRect(-3.5, -72, 7, 144, 3.5)
      .fill(bar)
      .stroke({ width: 1, color: edge });
    for (const [x, y] of [
      [72, 0],
      [-72, 0],
      [0, 72],
      [0, -72],
    ] as const) {
      handles.circle(x, y, 6).fill(cap).stroke({ width: 1, color: edge });
    }
    handles.circle(0, 0, 9).fill(cap).stroke({ width: 1.5, color: edge });
    wheel.addChild(handles);
  }
  return wheel;
}

function buildGlow(pixi: typeof Pixi, t: WheelTheme, pocket: number): Pixi.Container {
  const { Container, Graphics } = pixi;
  const [a0, a1] = pocketArc(WHEEL_ORDER.indexOf(pocket));
  const s = t.glow.strength;
  const glow = new Container();
  if (t.glow.style === "ring") {
    // Flat sticker-like outline: thick ink ring with a sun-yellow core, no blur.
    glow.addChild(
      sector(new Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).stroke({
        width: 8,
        color: t.glow.edge,
      }),
    );
    glow.addChild(
      sector(new Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).stroke({
        width: 4,
        color: t.glow.color,
      }),
    );
  } else {
    glow.addChild(
      sector(new Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).fill({
        color: t.glow.color,
        alpha: Math.min(1, 0.45 * s),
      }),
    );
    for (const [width, alpha] of [
      [11 * s, 0.12],
      [6 * s, 0.25],
      [3, 1],
    ] as const) {
      glow.addChild(
        sector(new Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).stroke({
          width,
          color: t.glow.edge,
          alpha,
        }),
      );
    }
  }
  glow.alpha = 0;
  return glow;
}

// ---------------------------------------------------------------------------------------
// Ball motion
// ---------------------------------------------------------------------------------------

interface HopPlan {
  /** Ball offsets from the target pocket, in the wheel's frame (radians). */
  offsets: number[];
  heights: number[];
  /** Total travel in the wheel's frame before the hops (radians). */
  travel: number;
}

function planBall(): HopPlan {
  const jitter = (base: number) => base * (0.8 + Math.random() * 0.4);
  const side = Math.random() < 0.5 ? 1 : -1;
  return {
    offsets: [
      3.5 * POCKET_ANGLE,
      -jitter(1.8) * POCKET_ANGLE * side,
      jitter(1.1) * POCKET_ANGLE * side,
      -jitter(0.5) * POCKET_ANGLE * side,
      0,
    ],
    heights: [jitter(0.9), jitter(0.65), jitter(0.4), jitter(0.2)],
    travel: TAU * (6 + Math.random() * 0.9),
  };
}

interface BallPose {
  /** Angle in the wheel's frame, clockwise from the top, relative to the target pocket. */
  offset: number;
  radius: number;
  /** 0 on the surface, 1 at the top of a hop. */
  height: number;
}

/**
 * The ball is described in the wheel's own frame, ending exactly on the target pocket
 * (offset 0). Its world position is that angle plus the wheel rotation, so the ball can
 * only ever end in the pocket it was given.
 */
function ballPose(ms: number, plan: HopPlan): BallPose {
  const hopStart = plan.offsets[0] ?? 0;
  if (ms < SPIRAL_END_MS) {
    // Remaining travel decelerates to a slow, steady crawl (END_SPEED rad/s) at the drop.
    const END_SPEED = 1.5;
    const seconds = SPIRAL_END_MS / 1000;
    const u = ms / SPIRAL_END_MS;
    const remaining =
      hopStart +
      END_SPEED * (seconds - ms / 1000) +
      (plan.travel - hopStart - END_SPEED * seconds) * (1 - u) ** 1.8;
    let radius = TRACK_RADIUS + Math.sin(ms / 90) * 0.7;
    let height = 0;
    if (ms >= DROP_START_MS) {
      const s = (ms - DROP_START_MS) / (SPIRAL_END_MS - DROP_START_MS);
      radius =
        lerp(TRACK_RADIUS, POCKET_BALL_RADIUS, easeInOutCubic(s)) + Math.sin(ms / 70) * (1 - s);
      height = Math.max(0, Math.sin(Math.min(1, (ms - DROP_START_MS) / 350) * Math.PI)) * 0.5;
    }
    return { offset: remaining, radius, height };
  }

  let t = ms - SPIRAL_END_MS;
  for (let k = 0; k < HOP_MS.length; k++) {
    const duration = HOP_MS[k] ?? 1;
    if (t <= duration) {
      const u = t / duration;
      const from = plan.offsets[k] ?? 0;
      const to = plan.offsets[k + 1] ?? 0;
      const eased = k === 0 ? u : easeInOutSine(u);
      return {
        offset: lerp(from, to, eased),
        radius: POCKET_BALL_RADIUS,
        height: (plan.heights[k] ?? 0) * 4 * u * (1 - u),
      };
    }
    t -= duration;
  }
  return { offset: 0, radius: POCKET_BALL_RADIUS, height: 0 };
}

// ---------------------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------------------

/** Waits for the numbers' font so the first draw does not fall back to a system font. */
async function loadWheelFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load("700 12px 'Space Mono'"),
      document.fonts.load("400 12px 'Space Mono'"),
    ]);
  } catch {
    // Fonts are cosmetic; draw with the fallback if loading fails.
  }
}

/** Mounts a PixiJS wheel with a ball in `host`. The ball always ends in the pocket it is given. */
export async function createBallWheelScene(
  host: HTMLElement,
  initialTheme: WheelThemeId = "brand",
): Promise<BallWheelScene> {
  const pixi = await import("pixi.js");
  const { Application, Container, Graphics } = pixi;
  await loadWheelFonts();
  const app = new Application();
  await app.init({
    width: BALL_WHEEL_SIZE,
    height: BALL_WHEEL_SIZE,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";
  host.appendChild(app.canvas);

  let shown: WheelThemeId = initialTheme;
  let wanted: WheelThemeId = initialTheme;
  let theme = resolveTheme(shown);
  let bowl = buildBowl(pixi, theme);
  let wheel = buildWheel(pixi, theme);
  wheel.position.set(C, C);
  app.stage.addChild(bowl, wheel);

  const ball = new Container();
  const ballShadow = new Graphics();
  const ballBody = new Graphics();
  ball.addChild(ballShadow, ballBody);
  ball.visible = false;
  app.stage.addChild(ball);

  function drawBall(t: WheelTheme) {
    ballShadow.clear();
    ballBody.clear();
    if (t.ball.hardShadow) {
      ballShadow.circle(0, 0, BALL_RADIUS + 1).fill(t.palette.ink);
    } else {
      ballShadow.circle(0, 0, BALL_RADIUS).fill({ color: 0x000000, alpha: 0.4 });
    }
    ballBody
      .circle(0, 0, BALL_RADIUS)
      .fill(t.ball.body)
      .stroke({ width: t.ball.rimWidth, color: t.ball.rim });
    if (t.ball.highlight !== null) {
      ballBody.circle(-2, -2.2, 2.1).fill({ color: t.ball.highlight, alpha: 0.95 });
    }
  }
  drawBall(theme);

  let glow: Pixi.Container | null = null;
  let stopCurrent: (() => void) | null = null;
  let spinning = false;
  let lastTarget: number | null = null;

  function clearGlow() {
    glow?.destroy({ children: true });
    glow = null;
  }

  function placeBall(offset: number, radius: number, height: number, target: number) {
    const angle = pocketAngle(target) + offset + wheel.rotation;
    const x = C + Math.sin(angle) * radius;
    const y = C - Math.cos(angle) * radius;
    ballBody.position.set(x, y);
    ballBody.scale.set(1 + 0.45 * height);
    if (theme.ball.hardShadow) {
      // Hard offset shadow, like the app's buttons: it grows with the hop but never blurs.
      ballShadow.position.set(x + 3 + 4 * height, y + 3 + 4 * height);
      ballShadow.scale.set(1 + 0.45 * height);
      ballShadow.alpha = 1;
    } else {
      ballShadow.position.set(x + 2 + 8 * height, y + 3 + 10 * height);
      ballShadow.scale.set(1);
      ballShadow.alpha = 1 - 0.4 * height;
    }
  }

  /** Redraws bowl, wheel and ball style for the wanted theme, keeping the wheel's rotation. */
  function mountStatic() {
    const rotation = wheel.rotation;
    bowl.destroy({ children: true });
    wheel.destroy({ children: true });
    glow = null;
    shown = wanted;
    theme = resolveTheme(shown);
    bowl = buildBowl(pixi, theme);
    wheel = buildWheel(pixi, theme);
    wheel.position.set(C, C);
    wheel.rotation = rotation;
    app.stage.addChildAt(bowl, 0);
    app.stage.addChildAt(wheel, 1);
    drawBall(theme);
    if (lastTarget !== null) placeBall(0, POCKET_BALL_RADIUS, 0, lastTarget);
  }

  function endSpin() {
    spinning = false;
    stopCurrent = null;
    if (wanted !== shown) mountStatic();
  }

  return {
    setTheme(id) {
      wanted = id;
      if (!spinning && wanted !== shown) mountStatic();
    },
    spinTo(pocket, onEnd, instant) {
      stopCurrent?.();
      clearGlow();
      spinning = true;
      lastTarget = pocket;
      ball.visible = true;
      glow = buildGlow(pixi, theme, pocket);
      wheel.addChild(glow);

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        onEnd();
      };
      let elapsed = 0;

      if (instant) {
        // Reduced motion: no physics. The ball fades into the target pocket.
        placeBall(0, POCKET_BALL_RADIUS, 0, pocket);
        ball.alpha = 0;
        const tickInstant = () => {
          elapsed += app.ticker.deltaMS;
          ball.alpha = Math.min(1, elapsed / FADE_MS);
          placeBall(0, POCKET_BALL_RADIUS, 0, pocket);
          if (elapsed >= FADE_MS) {
            app.ticker.remove(tickInstant);
            if (glow) glow.alpha = 0.5;
            finish();
            endSpin();
          }
        };
        stopCurrent = () => {
          app.ticker.remove(tickInstant);
          endSpin();
        };
        app.ticker.add(tickInstant);
        return;
      }

      const plan = planBall();
      const from = wheel.rotation;
      ball.alpha = 0;
      const tick = () => {
        elapsed += Math.min(app.ticker.deltaMS, 100);
        const spin = Math.min(elapsed, TOTAL_MS) / TOTAL_MS;
        wheel.rotation = from + WHEEL_TURNS * TAU * easeOutCubic(spin);
        ball.alpha = Math.min(1, elapsed / 250);
        const pose =
          elapsed < HOP_END_MS
            ? ballPose(elapsed, plan)
            : { offset: 0, radius: POCKET_BALL_RADIUS, height: 0 };
        placeBall(pose.offset, pose.radius, pose.height, pocket);
        if (elapsed >= TOTAL_MS) {
          finish();
          const g = (elapsed - TOTAL_MS) / GLOW_MS;
          if (glow && g < 1) {
            glow.alpha = (1 - g) * (0.55 + 0.45 * Math.sin(g * TAU * 3));
          } else {
            clearGlow();
            app.ticker.remove(tick);
            endSpin();
          }
        }
      };
      stopCurrent = () => {
        app.ticker.remove(tick);
        endSpin();
      };
      app.ticker.add(tick);
    },
    destroy() {
      stopCurrent?.();
      app.destroy(true, { children: true });
    },
  };
}

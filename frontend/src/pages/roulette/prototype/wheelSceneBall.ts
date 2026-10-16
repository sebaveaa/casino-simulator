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
const TRAIL_POINTS = 18;

// ---------------------------------------------------------------------------------------
// Themes. Each theme picks a different *structure* for the rim, frets, cone, turret,
// handles, deflectors and ball, not only a different palette.
// ---------------------------------------------------------------------------------------

export type WheelThemeId = "classic" | "neon" | "luxury" | "minimal";

export interface WheelTheme {
  id: WheelThemeId;
  label: string;
  /** Swatch for the picker (CSS colour). */
  swatch: string;
  rim: "wood" | "neon" | "gold" | "flat";
  /** Track floor shades, outer to inner. */
  trackShades: [number, number];
  /** Alpha of the drop shadow under the bowl; 0 for none. */
  shadow: number;
  wheelBase: number;
  pockets: Record<PocketColor, number>;
  labels: {
    colors: Record<PocketColor, number>;
    font: string;
    weight: "400" | "600" | "700";
    size: number;
  };
  frets: { style: "solid" | "neon" | "thin"; color: number; color2: number; width: number };
  cone: "wood" | "dark" | "gold" | "flat";
  turret: "brass" | "neon" | "gold" | "flat";
  handles: "chrome" | "neon" | "gold" | "none";
  diamonds: "gold" | "neon" | "none";
  ball: {
    body: number;
    rim: number;
    highlight: number;
    /** Soft halo colour around the ball, or null. */
    halo: number | null;
    /** Trail colour, or null for no trail. */
    trail: number | null;
  };
  /** Winning pocket glow. `strength` scales fill and bloom. */
  glow: { color: number; edge: number; strength: number };
}

export const WHEEL_THEMES: Record<WheelThemeId, WheelTheme> = {
  classic: {
    id: "classic",
    label: "Clásica",
    swatch: "#8a5a2b",
    rim: "wood",
    trackShades: [0x1b1b22, 0x3d3d4a],
    shadow: 0.22,
    wheelBase: 0xb8942f,
    pockets: { red: 0xd62839, black: 0x141414, green: 0x1b8a3e },
    labels: {
      colors: { red: 0xffffff, black: 0xffffff, green: 0xffffff },
      font: "monospace",
      weight: "700",
      size: 12,
    },
    frets: { style: "solid", color: 0xf0d36e, color2: 0xf0d36e, width: 1.6 },
    cone: "wood",
    turret: "brass",
    handles: "chrome",
    diamonds: "gold",
    ball: { body: 0xf4f4f8, rim: 0xb0b0ba, highlight: 0xffffff, halo: null, trail: null },
    glow: { color: 0xffffff, edge: 0xffc933, strength: 1 },
  },
  neon: {
    id: "neon",
    label: "Neón",
    swatch: "#ff3df2",
    rim: "neon",
    trackShades: [0x07070f, 0x17173a],
    shadow: 0,
    wheelBase: 0x05050c,
    pockets: { red: 0x4a0c3a, black: 0x0a0a16, green: 0x07402e },
    labels: {
      colors: { red: 0xff7ae8, black: 0x7af6ff, green: 0x8dffc4 },
      font: "monospace",
      weight: "700",
      size: 12,
    },
    frets: { style: "neon", color: 0x2de2ff, color2: 0xff3df2, width: 1.4 },
    cone: "dark",
    turret: "neon",
    handles: "neon",
    diamonds: "neon",
    ball: { body: 0xffffff, rim: 0x9ff6ff, highlight: 0xffffff, halo: 0x2de2ff, trail: 0xff3df2 },
    glow: { color: 0x2de2ff, edge: 0xff3df2, strength: 2 },
  },
  luxury: {
    id: "luxury",
    label: "Lujo",
    swatch: "#d4af37",
    rim: "gold",
    trackShades: [0x0c0c0c, 0x2a2410],
    shadow: 0.3,
    wheelBase: 0xd4af37,
    pockets: { red: 0x8e1b2a, black: 0x0a0a0a, green: 0x0f5a35 },
    labels: {
      colors: { red: 0xf6e7b4, black: 0xf6e7b4, green: 0xf6e7b4 },
      font: "Georgia, serif",
      weight: "700",
      size: 13,
    },
    frets: { style: "solid", color: 0xd4af37, color2: 0xd4af37, width: 2.2 },
    cone: "gold",
    turret: "gold",
    handles: "gold",
    diamonds: "gold",
    ball: { body: 0xfff4d6, rim: 0xc9a227, highlight: 0xffffff, halo: null, trail: null },
    glow: { color: 0xffe08a, edge: 0xffffff, strength: 1.3 },
  },
  minimal: {
    id: "minimal",
    label: "Minimal",
    swatch: "#e5484d",
    rim: "flat",
    trackShades: [0xeeeef4, 0xeeeef4],
    shadow: 0.08,
    wheelBase: 0xffffff,
    pockets: { red: 0xe5484d, black: 0x2b2b33, green: 0x2f9e44 },
    labels: {
      colors: { red: 0xffffff, black: 0xffffff, green: 0xffffff },
      font: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      weight: "600",
      size: 12,
    },
    frets: { style: "thin", color: 0xffffff, color2: 0xffffff, width: 1 },
    cone: "flat",
    turret: "flat",
    handles: "none",
    diamonds: "none",
    ball: { body: 0xffffff, rim: 0x2b2b33, highlight: 0xe8e8ee, halo: null, trail: null },
    glow: { color: 0xffffff, edge: 0x2b2b33, strength: 0.8 },
  },
};

export const WHEEL_THEME_IDS: WheelThemeId[] = ["classic", "neon", "luxury", "minimal"];

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

/** A circle drawn as stacked strokes so it reads as glowing. */
function neonRing(pixi: typeof Pixi, parent: Pixi.Container, r: number, color: number, w: number) {
  for (const [width, alpha] of [
    [w * 6, 0.07],
    [w * 3.5, 0.14],
    [w * 1.8, 0.3],
    [w, 1],
  ] as const) {
    parent.addChild(new pixi.Graphics().circle(0, 0, r).stroke({ width, color, alpha }));
  }
}

/** Radial lines on pocket boundaries; `parity` limits them to every other one. */
function fretLayer(
  pixi: typeof Pixi,
  parity: 0 | 1 | null,
  width: number,
  color: number,
  alpha: number,
): Pixi.Graphics {
  const g = new pixi.Graphics();
  WHEEL_ORDER.forEach((_, index) => {
    if (parity !== null && index % 2 !== parity) return;
    const a = pocketArc(index)[0];
    g.moveTo(Math.cos(a) * POCKET_INNER, Math.sin(a) * POCKET_INNER).lineTo(
      Math.cos(a) * (POCKET_OUTER + 2),
      Math.sin(a) * (POCKET_OUTER + 2),
    );
  });
  return g.stroke({ width, color, alpha });
}

// ---------------------------------------------------------------------------------------
// Static layers
// ---------------------------------------------------------------------------------------

function buildBowl(pixi: typeof Pixi, t: WheelTheme): Pixi.Container {
  const { Container, Graphics } = pixi;
  const bowl = new Container();
  bowl.position.set(C, C);
  if (t.shadow > 0) {
    bowl.addChild(new Graphics().circle(3, 9, 196).fill({ color: 0x000000, alpha: t.shadow }));
  }

  const rim = new Graphics();
  switch (t.rim) {
    case "wood":
      rim
        .circle(0, 0, 197)
        .fill(0x2a170a)
        .circle(0, 0, 192)
        .fill(0x6b3f1e)
        .circle(0, 0, 189)
        .stroke({ width: 2, color: 0xa56a38 })
        .circle(0, 0, 183)
        .fill(0xb9bac4);
      break;
    case "neon":
      rim.circle(0, 0, 197).fill(0x05050c);
      break;
    case "gold":
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
      break;
    case "flat":
      rim.circle(0, 0, 197).fill(0xffffff).stroke({ width: 2, color: 0xcfcfd8 });
      break;
  }
  bowl.addChild(rim);

  // The ball track slopes toward the wheel: shades step from outside to inside.
  const track = new Graphics().circle(0, 0, 181).fill(t.trackShades[0]);
  for (let r = 180; r > 152; r -= 4) {
    track.circle(0, 0, r).fill(mix(t.trackShades[0], t.trackShades[1], (180 - r) / 28));
  }
  bowl.addChild(track);

  if (t.rim === "neon") {
    neonRing(pixi, bowl, 190, 0x2de2ff, 2);
    neonRing(pixi, bowl, 184, 0xff3df2, 1.2);
  }
  if (t.rim === "gold") {
    // Engraved ticks around the gold rim.
    const ticks = new Graphics();
    for (let k = 0; k < 74; k++) {
      const a = (k / 74) * TAU;
      const major = k % 6 === 0;
      const r0 = major ? 183.5 : 185.5;
      const r1 = major ? 192 : 190;
      ticks.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0).lineTo(Math.sin(a) * r1, -Math.cos(a) * r1);
    }
    bowl.addChild(ticks.stroke({ width: 1.2, color: 0x4a3608 }));
  }

  if (t.diamonds !== "none") {
    for (let k = 0; k < 8; k++) {
      const a = (k + 0.5) * (TAU / 8);
      const x = Math.sin(a) * 157;
      const y = -Math.cos(a) * 157;
      const pts = [
        [0, -9],
        [5, 0],
        [0, 9],
        [-5, 0],
      ].flatMap(([px = 0, py = 0]) => {
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        return [x + px * cos - py * sin, y + px * sin + py * cos];
      });
      const diamond = new Graphics().poly(pts);
      bowl.addChild(
        t.diamonds === "gold"
          ? diamond.fill(0xe8c75a).stroke({ width: 1.5, color: 0x6b3f1e })
          : diamond.fill({ color: 0x2de2ff, alpha: 0.15 }).stroke({ width: 1.5, color: 0x2de2ff }),
      );
    }
  }
  return bowl;
}

function buildWheel(pixi: typeof Pixi, t: WheelTheme): Pixi.Container {
  const { Container, Graphics, Text } = pixi;
  const wheel = new Container();
  const base = new Graphics().circle(0, 0, POCKET_OUTER + 4).fill(t.wheelBase);
  if (t.rim === "flat") base.stroke({ width: 1, color: 0xcfcfd8 });
  wheel.addChild(base);

  WHEEL_ORDER.forEach((pocket, index) => {
    const [a0, a1] = pocketArc(index);
    wheel.addChild(
      sector(new Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).fill(
        t.pockets[pocketColor(pocket)],
      ),
    );
  });

  // Pocket separators.
  const f = t.frets;
  if (f.style === "neon") {
    for (const parity of [0, 1] as const) {
      const color = parity === 0 ? f.color : f.color2;
      wheel.addChild(fretLayer(pixi, parity, f.width * 5, color, 0.1));
      wheel.addChild(fretLayer(pixi, parity, f.width * 2.5, color, 0.25));
      wheel.addChild(fretLayer(pixi, parity, f.width, color, 1));
    }
    const lips = new Container();
    neonRing(pixi, lips, POCKET_INNER, f.color2, 1.4);
    neonRing(pixi, lips, POCKET_OUTER + 1, f.color, 1.4);
    wheel.addChild(lips);
  } else {
    wheel.addChild(fretLayer(pixi, null, f.width, f.color, 1));
    wheel.addChild(
      new Graphics()
        .circle(0, 0, POCKET_INNER)
        .stroke({ width: f.style === "thin" ? 1 : 2.5, color: f.color })
        .circle(0, 0, POCKET_OUTER + 1)
        .stroke({ width: f.style === "thin" ? 1 : 2, color: f.color }),
    );
  }

  WHEEL_ORDER.forEach((pocket, index) => {
    const centre = index * POCKET_ANGLE;
    const label = new Text({
      text: String(pocket),
      style: {
        fill: t.labels.colors[pocketColor(pocket)],
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
  switch (t.cone) {
    case "wood":
      for (let r = POCKET_INNER - 1; r > 60; r -= 4) {
        cone.circle(0, 0, r).fill(mix(0x5a3416, 0xc08a4a, (POCKET_INNER - r) / 48));
      }
      break;
    case "dark":
    case "gold":
      for (let r = POCKET_INNER - 1; r > 60; r -= 4) {
        const [from, to] =
          t.cone === "dark" ? ([0x0a0a18, 0x1c1c40] as const) : ([0x0a0a0a, 0x2a2410] as const);
        cone.circle(0, 0, r).fill(mix(from, to, (POCKET_INNER - r) / 48));
      }
      break;
    case "flat":
      cone.circle(0, 0, POCKET_INNER - 1).fill(0xf3f3f8);
      break;
  }
  wheel.addChild(cone);
  if (t.cone === "dark") {
    neonRing(pixi, wheel, 84, 0xff3df2, 1);
    neonRing(pixi, wheel, 98, 0x2de2ff, 0.8);
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
  switch (t.turret) {
    case "brass":
    case "gold": {
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
      break;
    }
    case "neon": {
      wheel.addChild(new Graphics().circle(0, 0, 56).fill(0x080814));
      neonRing(pixi, wheel, 56, 0xff3df2, 1.4);
      neonRing(pixi, wheel, 40, 0x2de2ff, 1.2);
      wheel.addChild(new Graphics().circle(0, 0, 14).fill({ color: 0x2de2ff, alpha: 0.9 }));
      break;
    }
    case "flat":
      wheel.addChild(
        new Graphics()
          .circle(0, 0, 26)
          .fill(0xffffff)
          .stroke({ width: 1.5, color: 0xcfcfd8 })
          .circle(0, 0, 4)
          .fill(0x2b2b33),
      );
      break;
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
  } else if (t.handles === "neon") {
    const arms = new Graphics()
      .moveTo(-72, 0)
      .lineTo(72, 0)
      .moveTo(0, -72)
      .lineTo(0, 72)
      .stroke({ width: 2, color: 0x2de2ff, alpha: 0.9 });
    wheel.addChild(arms);
    for (const [x, y] of [
      [72, 0],
      [-72, 0],
      [0, 72],
      [0, -72],
    ] as const) {
      wheel.addChild(
        new Graphics()
          .circle(x, y, 9)
          .fill({ color: 0xff3df2, alpha: 0.25 })
          .circle(x, y, 5)
          .fill(0xff3df2),
      );
    }
  }
  return wheel;
}

function buildGlow(pixi: typeof Pixi, t: WheelTheme, pocket: number): Pixi.Container {
  const { Container, Graphics } = pixi;
  const [a0, a1] = pocketArc(WHEEL_ORDER.indexOf(pocket));
  const s = t.glow.strength;
  const glow = new Container();
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

/** Mounts a PixiJS wheel with a ball in `host`. The ball always ends in the pocket it is given. */
export async function createBallWheelScene(
  host: HTMLElement,
  initialTheme: WheelThemeId = "classic",
): Promise<BallWheelScene> {
  const pixi = await import("pixi.js");
  const { Application, Container, Graphics } = pixi;
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
  let bowl = buildBowl(pixi, WHEEL_THEMES[shown]);
  let wheel = buildWheel(pixi, WHEEL_THEMES[shown]);
  wheel.position.set(C, C);
  app.stage.addChild(bowl, wheel);

  const trail = new Graphics();
  const ball = new Container();
  const ballShadow = new Graphics().circle(0, 0, BALL_RADIUS).fill({ color: 0x000000, alpha: 0.4 });
  const ballHalo = new Graphics();
  const ballBody = new Graphics();
  ball.addChild(ballShadow, ballHalo, ballBody);
  ball.visible = false;
  app.stage.addChild(trail, ball);

  function drawBall(t: WheelTheme) {
    ballHalo.clear();
    ballBody.clear();
    if (t.ball.halo !== null) {
      ballHalo
        .circle(0, 0, BALL_RADIUS * 2.6)
        .fill({ color: t.ball.halo, alpha: 0.2 })
        .circle(0, 0, BALL_RADIUS * 1.7)
        .fill({ color: t.ball.halo, alpha: 0.35 });
    }
    ballBody
      .circle(0, 0, BALL_RADIUS)
      .fill(t.ball.body)
      .stroke({ width: t.id === "minimal" ? 1.5 : 1, color: t.ball.rim })
      .circle(-2, -2.2, 2.1)
      .fill({ color: t.ball.highlight, alpha: 0.95 });
  }
  drawBall(WHEEL_THEMES[shown]);

  let glow: Pixi.Container | null = null;
  let stopCurrent: (() => void) | null = null;
  let spinning = false;
  let lastTarget: number | null = null;
  let trailPoints: { x: number; y: number }[] = [];

  function clearGlow() {
    glow?.destroy({ children: true });
    glow = null;
  }

  function clearTrail() {
    trail.clear();
    trailPoints = [];
  }

  function placeBall(offset: number, radius: number, height: number, target: number) {
    const angle = pocketAngle(target) + offset + wheel.rotation;
    const x = C + Math.sin(angle) * radius;
    const y = C - Math.cos(angle) * radius;
    ballHalo.position.set(x, y);
    ballBody.position.set(x, y);
    ballBody.scale.set(1 + 0.45 * height);
    ballShadow.position.set(x + 2 + 8 * height, y + 3 + 10 * height);
    ballShadow.alpha = 1 - 0.4 * height;
    return { x, y };
  }

  function drawTrail(color: number) {
    trail.clear();
    trailPoints.forEach((p, i) => {
      const k = (i + 1) / trailPoints.length;
      trail.circle(p.x, p.y, BALL_RADIUS * (0.3 + 0.6 * k)).fill({ color, alpha: 0.5 * k });
    });
  }

  /** Redraws bowl, wheel and ball style for the wanted theme, keeping the wheel's rotation. */
  function mountStatic() {
    const rotation = wheel.rotation;
    bowl.destroy({ children: true });
    wheel.destroy({ children: true });
    glow = null;
    shown = wanted;
    const theme = WHEEL_THEMES[shown];
    bowl = buildBowl(pixi, theme);
    wheel = buildWheel(pixi, theme);
    wheel.position.set(C, C);
    wheel.rotation = rotation;
    app.stage.addChildAt(bowl, 0);
    app.stage.addChildAt(wheel, 1);
    drawBall(theme);
    clearTrail();
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
      clearTrail();
      spinning = true;
      lastTarget = pocket;
      const theme = WHEEL_THEMES[shown];
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
        const moving = elapsed < HOP_END_MS;
        const pose = moving
          ? ballPose(elapsed, plan)
          : { offset: 0, radius: POCKET_BALL_RADIUS, height: 0 };
        const at = placeBall(pose.offset, pose.radius, pose.height, pocket);
        if (theme.ball.trail !== null) {
          if (moving) {
            trailPoints.push(at);
            if (trailPoints.length > TRAIL_POINTS) trailPoints.shift();
            drawTrail(theme.ball.trail);
          } else if (trailPoints.length > 0) {
            clearTrail();
          }
        }
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

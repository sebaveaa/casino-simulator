// PROTOTYPE — throwaway, see branch prototype/12-roulette-table
import { pocketColor } from "@casino/shared";
import type * as Pixi from "pixi.js";
import { easeOutCubic, POCKET_ANGLE, pocketAngle, WHEEL_ORDER } from "../wheelAngles";

export const BALL_WHEEL_SIZE = 400;
const C = BALL_WHEEL_SIZE / 2;
const TAU = Math.PI * 2;

const COLORS = { red: 0xd62839, black: 0x141414, green: 0x1b8a3e } as const;

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

export interface BallWheelScene {
  /** Spins to `pocket`; `onEnd` runs once when the wheel stops. Replaces a spin in progress. */
  spinTo(pocket: number, onEnd: () => void, instant: boolean): void;
  destroy(): void;
}

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

function buildBowl(pixi: typeof Pixi): Pixi.Container {
  const { Container, Graphics } = pixi;
  const bowl = new Container();
  bowl.addChild(new Graphics().circle(C + 3, C + 9, 196).fill({ color: 0x000000, alpha: 0.22 }));
  const g = new Graphics()
    .circle(C, C, 197)
    .fill(0x2a170a)
    .circle(C, C, 192)
    .fill(0x6b3f1e)
    .circle(C, C, 189)
    .stroke({ width: 2, color: 0xa56a38 })
    .circle(C, C, 183)
    .fill(0xb9bac4)
    .circle(C, C, 181)
    .fill(0x1b1b22);
  // The ball track slopes toward the wheel: lighter steps to the inside.
  for (let r = 180; r > 152; r -= 4) {
    g.circle(C, C, r).fill(mix(0x1b1b22, 0x3d3d4a, (180 - r) / 28));
  }
  bowl.addChild(g);
  // Diamond deflectors on the track.
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * (TAU / 8);
    const x = C + Math.sin(a) * 157;
    const y = C - Math.cos(a) * 157;
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
    bowl.addChild(new Graphics().poly(pts).fill(0xe8c75a).stroke({ width: 1.5, color: 0x6b3f1e }));
  }
  return bowl;
}

function buildWheel(pixi: typeof Pixi): Pixi.Container {
  const { Container, Graphics, Text } = pixi;
  const wheel = new Container();
  wheel.addChild(new Graphics().circle(0, 0, POCKET_OUTER + 4).fill(0xb8942f));

  WHEEL_ORDER.forEach((pocket, index) => {
    const [a0, a1] = pocketArc(index);
    wheel.addChild(
      sector(new Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1).fill(COLORS[pocketColor(pocket)]),
    );
  });

  // Pocket separators (frets) and the inner lip.
  const frets = new Graphics();
  WHEEL_ORDER.forEach((_, index) => {
    const a = pocketArc(index)[0];
    frets
      .moveTo(Math.cos(a) * POCKET_INNER, Math.sin(a) * POCKET_INNER)
      .lineTo(Math.cos(a) * (POCKET_OUTER + 2), Math.sin(a) * (POCKET_OUTER + 2));
  });
  frets.stroke({ width: 1.6, color: 0xf0d36e });
  frets
    .circle(0, 0, POCKET_INNER)
    .stroke({ width: 2.5, color: 0xf0d36e })
    .circle(0, 0, POCKET_OUTER + 1)
    .stroke({ width: 2, color: 0xf0d36e });
  wheel.addChild(frets);

  WHEEL_ORDER.forEach((pocket, index) => {
    const centre = index * POCKET_ANGLE;
    const label = new Text({
      text: String(pocket),
      style: { fill: 0xffffff, fontSize: 12, fontWeight: "700", fontFamily: "monospace" },
    });
    label.anchor.set(0.5);
    label.position.set(Math.sin(centre) * 139, -Math.cos(centre) * 139);
    label.rotation = centre;
    wheel.addChild(label);
  });

  // Sloped cone between the pockets and the turret.
  const cone = new Graphics();
  for (let r = POCKET_INNER - 1; r > 60; r -= 4) {
    cone.circle(0, 0, r).fill(mix(0x5a3416, 0xc08a4a, (POCKET_INNER - r) / 48));
  }
  wheel.addChild(cone);

  // Turret.
  const turret = new Graphics();
  for (let r = 62; r > 8; r -= 3) {
    turret.circle(0, 0, r).fill(mix(0x8a6a14, 0xfff0b0, (62 - r) / 54));
  }
  turret.circle(0, 0, 62).stroke({ width: 2, color: 0x6b4f0c });
  wheel.addChild(turret);

  // Cross handles.
  const handles = new Graphics()
    .roundRect(-72, -3.5, 144, 7, 3.5)
    .fill(0xd5d5de)
    .stroke({ width: 1, color: 0x6a6a76 })
    .roundRect(-3.5, -72, 7, 144, 3.5)
    .fill(0xd5d5de)
    .stroke({ width: 1, color: 0x6a6a76 });
  for (const [x, y] of [
    [72, 0],
    [-72, 0],
    [0, 72],
    [0, -72],
  ] as const) {
    handles.circle(x, y, 6).fill(0xf2f2f7).stroke({ width: 1, color: 0x6a6a76 });
  }
  handles.circle(0, 0, 9).fill(0xf6f6fa).stroke({ width: 1.5, color: 0x6a6a76 });
  wheel.addChild(handles);
  return wheel;
}

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

/** Mounts a PixiJS wheel with a ball in `host`. The ball always ends in the pocket it is given. */
export async function createBallWheelScene(host: HTMLElement): Promise<BallWheelScene> {
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

  app.stage.addChild(buildBowl(pixi));
  const wheel = buildWheel(pixi);
  wheel.position.set(C, C);
  app.stage.addChild(wheel);

  const ball = new Container();
  const ballShadow = new Graphics().circle(0, 0, BALL_RADIUS).fill({ color: 0x000000, alpha: 0.4 });
  const ballBody = new Graphics()
    .circle(0, 0, BALL_RADIUS)
    .fill(0xf4f4f8)
    .stroke({ width: 1, color: 0xb0b0ba })
    .circle(-2, -2.2, 2.1)
    .fill({ color: 0xffffff, alpha: 0.95 });
  ball.addChild(ballShadow, ballBody);
  ball.visible = false;
  app.stage.addChild(ball);

  let glow: Pixi.Graphics | null = null;
  let stopCurrent: (() => void) | null = null;

  function clearGlow() {
    glow?.destroy();
    glow = null;
  }

  function placeBall(offset: number, radius: number, height: number, target: number) {
    const angle = pocketAngle(target) + offset + wheel.rotation;
    const x = C + Math.sin(angle) * radius;
    const y = C - Math.cos(angle) * radius;
    ballBody.position.set(x, y);
    ballBody.scale.set(1 + 0.45 * height);
    ballShadow.position.set(x + 2 + 8 * height, y + 3 + 10 * height);
    ballShadow.alpha = 1 - 0.4 * height;
  }

  function addGlow(target: number) {
    clearGlow();
    const index = WHEEL_ORDER.indexOf(target);
    const [a0, a1] = pocketArc(index);
    glow = sector(new Graphics(), POCKET_INNER, POCKET_OUTER, a0, a1)
      .fill(0xffffff)
      .stroke({ width: 3, color: 0xffc933 });
    glow.alpha = 0;
    wheel.addChild(glow);
  }

  return {
    spinTo(pocket, onEnd, instant) {
      stopCurrent?.();
      clearGlow();
      ball.visible = true;
      addGlow(pocket);

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
            stop();
            if (glow) glow.alpha = 0.5;
            finish();
          }
        };
        const stop = () => {
          app.ticker.remove(tickInstant);
          stopCurrent = null;
        };
        stopCurrent = stop;
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
          elapsed >= HOP_END_MS
            ? { offset: 0, radius: POCKET_BALL_RADIUS, height: 0 }
            : ballPose(elapsed, plan);
        placeBall(pose.offset, pose.radius, pose.height, pocket);
        if (elapsed >= TOTAL_MS) {
          finish();
          if (glow) {
            const g = (elapsed - TOTAL_MS) / GLOW_MS;
            glow.alpha = g >= 1 ? 0 : (1 - g) * (0.55 + 0.45 * Math.sin(g * TAU * 3));
            if (g >= 1) {
              clearGlow();
              stop();
            }
          } else {
            stop();
          }
        }
      };
      const stop = () => {
        app.ticker.remove(tick);
        stopCurrent = null;
      };
      stopCurrent = stop;
      app.ticker.add(tick);
    },
    destroy() {
      stopCurrent?.();
      app.destroy(true, { children: true });
    },
  };
}

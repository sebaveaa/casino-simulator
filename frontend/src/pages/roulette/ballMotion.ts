import { POCKET_COUNT } from "@casino/shared";
import { easeOutCubic, POCKET_ANGLE, pocketAngle, WHEEL_ORDER } from "./wheelAngles";

/*
 * Pure motion of the ball wheel. The ball is described in the wheel's own frame and always ends
 * at offset 0 from the pocket the server drew, so the animation can never decide a result
 * (README §2.2, §4.2). Its position on screen is that angle plus the wheel's rotation.
 */

const TAU = Math.PI * 2;

// Radii in scene units, from the outside in.
export const TRACK_RADIUS = 166; // where the ball runs before it drops
export const POCKET_OUTER = 148;
export const POCKET_INNER = 108;
export const POCKET_BALL_RADIUS = 127;

// Timeline (ms). The wheel stops at TOTAL_MS; the ball is in its pocket well before.
export const DROP_START_MS = 3200;
export const SPIRAL_END_MS = 5000;
export const HOP_MS: readonly number[] = [400, 280, 200, 120];
export const HOP_END_MS = SPIRAL_END_MS + HOP_MS.reduce((sum, ms) => sum + ms, 0);
export const TOTAL_MS = 6600;
export const WIN_RING_MS = 1500;
export const FADE_MS = 300;
const BALL_FADE_IN_MS = 250;
export const WHEEL_TURNS = 3.2;

/** Speed of the ball, in rad/s, when it reaches the pockets. */
const CRAWL_SPEED = 1.5;

export type Random = () => number;

/** Small deterministic generator (mulberry32), so a plan can be reproduced in tests. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BallPlan {
  /** Offsets from the target pocket where each hop starts, then 0 where the last one ends. */
  offsets: number[];
  /** Peak height of each hop, 0 to 1. */
  heights: number[];
  /** Angle the ball covers on the track before the hops (radians). */
  travel: number;
}

/** Picks the look of one spin. Only cosmetic: every plan ends at offset 0. */
export function planBall(random: Random): BallPlan {
  const jitter = (base: number) => base * (0.8 + random() * 0.4);
  const side = random() < 0.5 ? 1 : -1;
  return {
    offsets: [
      3.5 * POCKET_ANGLE,
      -jitter(1.8) * POCKET_ANGLE * side,
      jitter(1.1) * POCKET_ANGLE * side,
      -jitter(0.5) * POCKET_ANGLE * side,
      0,
    ],
    heights: [jitter(0.9), jitter(0.65), jitter(0.4), jitter(0.2)],
    travel: TAU * (6 + random() * 0.9),
  };
}

export interface BallPose {
  /** Angle in the wheel's frame, clockwise, relative to the target pocket. */
  offset: number;
  radius: number;
  /** 0 on the surface, 1 at the top of a hop. */
  height: number;
}

/** The ball at rest in its pocket. */
export const RESTING_POSE: BallPose = { offset: 0, radius: POCKET_BALL_RADIUS, height: 0 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Where the ball is `ms` after the spin starts: on the track, spiralling in, then hopping. */
export function ballPose(ms: number, plan: BallPlan): BallPose {
  const hopStart = plan.offsets[0] ?? 0;
  if (ms < SPIRAL_END_MS) {
    // The remaining travel decelerates to a slow, steady crawl at the drop.
    const seconds = SPIRAL_END_MS / 1000;
    const u = Math.max(0, ms) / SPIRAL_END_MS;
    const offset =
      hopStart +
      CRAWL_SPEED * (seconds - ms / 1000) +
      (plan.travel - hopStart - CRAWL_SPEED * seconds) * (1 - u) ** 1.8;
    let radius = TRACK_RADIUS + Math.sin(ms / 90) * 0.7;
    let height = 0;
    if (ms >= DROP_START_MS) {
      const s = (ms - DROP_START_MS) / (SPIRAL_END_MS - DROP_START_MS);
      radius =
        lerp(TRACK_RADIUS, POCKET_BALL_RADIUS, easeInOutCubic(s)) + Math.sin(ms / 70) * (1 - s);
      height = Math.max(0, Math.sin(Math.min(1, (ms - DROP_START_MS) / 350) * Math.PI)) * 0.5;
    }
    return { offset, radius, height };
  }

  let t = ms - SPIRAL_END_MS;
  for (let k = 0; k < HOP_MS.length; k++) {
    const duration = HOP_MS[k] ?? 1;
    if (t <= duration) {
      const u = t / duration;
      const from = plan.offsets[k] ?? 0;
      const to = plan.offsets[k + 1] ?? 0;
      return {
        offset: lerp(from, to, k === 0 ? u : easeInOutSine(u)),
        radius: POCKET_BALL_RADIUS,
        height: (plan.heights[k] ?? 0) * 4 * u * (1 - u),
      };
    }
    t -= duration;
  }
  return RESTING_POSE;
}

/** Wheel rotation `ms` after the spin starts: one way, fast at first, stopped at TOTAL_MS. */
export function wheelRotation(from: number, ms: number): number {
  return from + WHEEL_TURNS * TAU * easeOutCubic(ms / TOTAL_MS);
}

/** Opacity of the ball: it fades in when released. */
export function ballOpacity(ms: number): number {
  return Math.min(1, Math.max(0, ms / BALL_FADE_IN_MS));
}

/** Opacity of the win ring at `ms` after the wheel stopped: a few pulses, then gone. */
export function winRingOpacity(msSinceStop: number): number {
  const g = msSinceStop / WIN_RING_MS;
  return g >= 1 ? 0 : (1 - g) * (0.55 + 0.45 * Math.sin(g * TAU * 3));
}

/** Reduced motion: no physics. The ball is already in the target pocket and fades in. */
export function reducedBall(ms: number): { pose: BallPose; opacity: number } {
  return { pose: RESTING_POSE, opacity: Math.min(1, Math.max(0, ms / FADE_MS)) };
}

/** Angle of the ball on screen, clockwise from the top, for a target pocket and wheel rotation. */
export function ballAngle(target: number, offset: number, rotation: number): number {
  return pocketAngle(target) + offset + rotation;
}

/** The pocket under an angle given in the wheel's frame (clockwise from the top). */
export function pocketAtAngle(frameAngle: number): number {
  const turns = (((frameAngle / POCKET_ANGLE) % POCKET_COUNT) + POCKET_COUNT) % POCKET_COUNT;
  return WHEEL_ORDER[Math.round(turns) % POCKET_COUNT] ?? 0;
}

/** The pocket the ball sits in, given its screen angle and the wheel's rotation. */
export function pocketUnderBall(angle: number, rotation: number): number {
  return pocketAtAngle(angle - rotation);
}

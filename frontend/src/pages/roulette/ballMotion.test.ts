import { POCKET_COUNT } from "@casino/shared";
import { describe, expect, it } from "vitest";
import {
  ballAngle,
  ballOpacity,
  ballPose,
  DROP_START_MS,
  FADE_MS,
  HOP_END_MS,
  planBall,
  pocketAtAngle,
  pocketUnderBall,
  RESTING_POSE,
  reducedBall,
  SPIRAL_END_MS,
  seededRandom,
  TOTAL_MS,
  WHEEL_TURNS,
  wheelRotation,
  winRingOpacity,
} from "./ballMotion";
import { POCKET_ANGLE, pocketAngle, WHEEL_ORDER } from "./wheelAngles";

const TAU = Math.PI * 2;
const SEEDS = [1, 7, 42, 1234, 99999];

describe("seededRandom", () => {
  it("repeats for a seed and stays in [0, 1)", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    for (let i = 0; i < 50; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("pocketAtAngle", () => {
  it("maps each pocket's own angle back to it, in either direction around the wheel", () => {
    for (const pocket of WHEEL_ORDER) {
      expect(pocketAtAngle(pocketAngle(pocket))).toBe(pocket);
      expect(pocketAtAngle(pocketAngle(pocket) + TAU * 3)).toBe(pocket);
      expect(pocketAtAngle(pocketAngle(pocket) - TAU * 2)).toBe(pocket);
    }
  });

  it("tolerates a quarter of a pocket of error", () => {
    expect(pocketAtAngle(POCKET_ANGLE * 0.25)).toBe(0);
    expect(pocketAtAngle(POCKET_ANGLE * 0.75)).toBe(WHEEL_ORDER[1]);
  });
});

describe("the ball always ends in the pocket it was given", () => {
  it("lands every pocket for several seeds and starting rotations", () => {
    for (const target of WHEEL_ORDER) {
      for (const seed of SEEDS) {
        for (const start of [0, 1.3, 55.5]) {
          const plan = planBall(seededRandom(seed));
          const rotation = wheelRotation(start, TOTAL_MS);
          const pose = ballPose(TOTAL_MS, plan);
          const angle = ballAngle(target, pose.offset, rotation);
          expect(pose.offset).toBe(0);
          expect(pocketUnderBall(angle, rotation)).toBe(target);
        }
      }
    }
  });

  it("settles at offset 0 from the end of the hops, whatever the plan", () => {
    for (const seed of SEEDS) {
      const plan = planBall(seededRandom(seed));
      expect(plan.offsets.at(-1)).toBe(0);
      for (const ms of [HOP_END_MS, HOP_END_MS + 1, TOTAL_MS]) {
        expect(ballPose(ms, plan)).toEqual(RESTING_POSE);
      }
    }
  });

  it("hops over neighbouring pockets only", () => {
    for (const seed of SEEDS) {
      const plan = planBall(seededRandom(seed));
      for (let ms = SPIRAL_END_MS; ms <= HOP_END_MS; ms += 10) {
        expect(Math.abs(ballPose(ms, plan).offset)).toBeLessThanOrEqual(3.5 * POCKET_ANGLE + 1e-9);
      }
    }
  });
});

describe("ballPose", () => {
  it("runs the track one way, ever slower, then drops inwards", () => {
    for (const seed of SEEDS) {
      const plan = planBall(seededRandom(seed));
      let previous = ballPose(0, plan);
      let previousStep = Number.POSITIVE_INFINITY;
      for (let ms = 50; ms < SPIRAL_END_MS; ms += 50) {
        const pose = ballPose(ms, plan);
        const step = previous.offset - pose.offset;
        expect(step).toBeGreaterThan(0);
        expect(step).toBeLessThanOrEqual(previousStep + 1e-9);
        previousStep = step;
        previous = pose;
      }
      expect(ballPose(DROP_START_MS - 1, plan).radius).toBeGreaterThan(160);
      expect(ballPose(SPIRAL_END_MS, plan).radius).toBeCloseTo(RESTING_POSE.radius, 6);
    }
  });

  it("has no jumps between frames, including at the phase boundaries", () => {
    for (const seed of SEEDS) {
      const plan = planBall(seededRandom(seed));
      let previous = ballPose(0, plan);
      for (let ms = 1; ms <= TOTAL_MS; ms++) {
        const pose = ballPose(ms, plan);
        // At most a pocket's width of travel and a couple of scene units per millisecond.
        expect(Math.abs(pose.offset - previous.offset)).toBeLessThan(POCKET_ANGLE);
        expect(Math.abs(pose.radius - previous.radius)).toBeLessThan(2);
        expect(Math.abs(pose.height - previous.height)).toBeLessThan(0.2);
        previous = pose;
      }
    }
  });

  it("keeps the height between 0 and 1", () => {
    const plan = planBall(seededRandom(3));
    for (let ms = 0; ms <= TOTAL_MS; ms += 5) {
      const { height } = ballPose(ms, plan);
      expect(height).toBeGreaterThanOrEqual(0);
      expect(height).toBeLessThanOrEqual(1);
    }
  });
});

describe("wheelRotation", () => {
  it("turns one way, decelerating, and stops at the end of the spin", () => {
    let previous = wheelRotation(2, 0);
    let previousStep = Number.POSITIVE_INFINITY;
    expect(previous).toBe(2);
    for (let ms = 100; ms <= TOTAL_MS; ms += 100) {
      const rotation = wheelRotation(2, ms);
      const step = rotation - previous;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(previousStep + 1e-9);
      previousStep = step;
      previous = rotation;
    }
    expect(wheelRotation(2, TOTAL_MS)).toBeCloseTo(2 + WHEEL_TURNS * TAU);
    expect(wheelRotation(2, TOTAL_MS + 5000)).toBe(wheelRotation(2, TOTAL_MS));
  });
});

describe("fades", () => {
  it("fades the ball in and clamps", () => {
    expect(ballOpacity(-5)).toBe(0);
    expect(ballOpacity(125)).toBeCloseTo(0.5);
    expect(ballOpacity(5000)).toBe(1);
  });

  it("pulses the win ring, then clears it", () => {
    expect(winRingOpacity(0)).toBeGreaterThan(0);
    expect(winRingOpacity(1500)).toBe(0);
    expect(winRingOpacity(9000)).toBe(0);
  });
});

describe("reduced motion", () => {
  it("puts the ball in the pocket from the first frame and only fades it in", () => {
    for (const ms of [0, FADE_MS / 2, FADE_MS, FADE_MS * 4]) {
      expect(reducedBall(ms).pose).toEqual(RESTING_POSE);
    }
    expect(reducedBall(0).opacity).toBe(0);
    expect(reducedBall(FADE_MS / 2).opacity).toBeCloseTo(0.5);
    expect(reducedBall(FADE_MS * 4).opacity).toBe(1);
  });

  it("rests on every pocket of the wheel", () => {
    for (const target of WHEEL_ORDER) {
      const angle = ballAngle(target, reducedBall(0).pose.offset, 0);
      expect(pocketUnderBall(angle, 0)).toBe(target);
    }
    expect(WHEEL_ORDER).toHaveLength(POCKET_COUNT);
  });
});

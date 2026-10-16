import { POCKET_COUNT } from "@casino/shared";
import { describe, expect, it } from "vitest";
import { easeOutCubic, POCKET_ANGLE, pocketAngle, spinTarget, WHEEL_ORDER } from "./wheelAngles";

const TAU = Math.PI * 2;

function mod(value: number): number {
  return ((value % TAU) + TAU) % TAU;
}

describe("wheel layout", () => {
  it("lists every pocket exactly once, starting at the zero", () => {
    expect(WHEEL_ORDER).toHaveLength(POCKET_COUNT);
    expect(new Set(WHEEL_ORDER).size).toBe(POCKET_COUNT);
    expect(WHEEL_ORDER[0]).toBe(0);
  });

  it("places pockets one step apart, clockwise", () => {
    expect(pocketAngle(0)).toBe(0);
    expect(pocketAngle(32)).toBeCloseTo(POCKET_ANGLE);
    expect(pocketAngle(26)).toBeCloseTo(36 * POCKET_ANGLE);
  });

  it("rejects a number that is not a pocket", () => {
    expect(() => pocketAngle(37)).toThrow(RangeError);
  });
});

describe("spinTarget", () => {
  it("lands every pocket under the pointer", () => {
    for (const pocket of WHEEL_ORDER) {
      const rotation = spinTarget(1.234, pocket, 5);
      // After rotating, the pocket's angle plus the rotation points at the top.
      const offset = mod(rotation + pocketAngle(pocket));
      expect(Math.min(offset, TAU - offset)).toBeCloseTo(0, 9);
    }
  });

  it("spins forward by at least the requested turns, less than one extra turn", () => {
    for (const current of [0, 0.5, 3, 100.7]) {
      const rotation = spinTarget(current, 17, 4);
      expect(rotation).toBeGreaterThanOrEqual(current + 4 * TAU);
      expect(rotation).toBeLessThan(current + 5 * TAU);
    }
  });

  it("with zero turns still never moves backwards", () => {
    expect(spinTarget(2, 8, 0)).toBeGreaterThanOrEqual(2);
  });
});

describe("easeOutCubic", () => {
  it("runs from 0 to 1, decelerating, and clamps its input", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-3)).toBe(0);
    expect(easeOutCubic(9)).toBe(1);
    expect(easeOutCubic(0.5) - easeOutCubic(0.4)).toBeLessThan(easeOutCubic(0.1));
  });
});

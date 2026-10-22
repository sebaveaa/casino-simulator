import { describe, expect, it } from "vitest";
import { FIRST_FINISH, LAST_FINISH, positionsAt, trackProgress } from "./trackMotion";

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

const ALL = permutations([0, 1, 2, 3, 4]);
const FIXED = [
  [0, 1, 2, 3, 4],
  [4, 3, 2, 1, 0],
  [2, 0, 4, 1, 3],
];

describe("positionsAt", () => {
  it("starts everyone at 0 and ends everyone at exactly 1", () => {
    for (const order of ALL) {
      expect(positionsAt(order, 0)).toEqual([0, 0, 0, 0, 0]);
      expect(positionsAt(order, 1)).toEqual([1, 1, 1, 1, 1]);
    }
  });

  it("clamps progress outside [0, 1]", () => {
    const order = [3, 1, 4, 0, 2];
    expect(positionsAt(order, -5)).toEqual(positionsAt(order, 0));
    expect(positionsAt(order, 7)).toEqual(positionsAt(order, 1));
    expect(positionsAt(order, Number.NaN)).toEqual(positionsAt(order, 0));
  });

  it("never decreases and stays within [0, 1]", () => {
    for (const order of FIXED) {
      let prev = positionsAt(order, 0);
      for (let i = 1; i <= 2000; i++) {
        const next = positionsAt(order, i / 2000);
        for (let a = 0; a < 5; a++) {
          expect(next[a]).toBeGreaterThanOrEqual(prev[a] as number);
          expect(next[a]).toBeLessThanOrEqual(1);
        }
        prev = next;
      }
    }
    for (const order of ALL) {
      let prev = positionsAt(order, 0);
      for (let i = 1; i <= 100; i++) {
        const next = positionsAt(order, i / 100);
        for (let a = 0; a < 5; a++) expect(next[a]).toBeGreaterThanOrEqual(prev[a] as number);
        prev = next;
      }
    }
  });

  it("reaches 1 strictly in the given order, winner first", () => {
    for (const order of ALL) {
      const finish = new Map<number, number>();
      for (let i = 0; i <= 1000; i++) {
        const positions = positionsAt(order, i / 1000);
        for (const animal of order) {
          if (positions[animal] === 1 && !finish.has(animal)) finish.set(animal, i / 1000);
        }
      }
      const times = order.map((animal) => finish.get(animal) as number);
      for (let r = 1; r < times.length; r++) {
        expect(times[r]).toBeGreaterThan(times[r - 1] as number);
      }
      expect(times[0]).toBeGreaterThanOrEqual(FIRST_FINISH - 0.001);
      expect(times[4]).toBeLessThanOrEqual(LAST_FINISH + 0.001);
    }
  });

  it("keeps everyone short of the line before the winner finishes", () => {
    for (const order of FIXED) {
      const positions = positionsAt(order, FIRST_FINISH - 0.001);
      for (const p of positions) expect(p).toBeLessThan(1);
    }
  });

  it("is deterministic", () => {
    const order = [2, 0, 4, 1, 3];
    expect(positionsAt(order, 0.37)).toEqual(positionsAt(order, 0.37));
  });

  it("exports the finish constants", () => {
    expect(FIRST_FINISH).toBeCloseTo(0.8);
    expect(LAST_FINISH).toBeCloseTo(0.98);
  });
});

describe("trackProgress", () => {
  it("maps elapsed time to [0, 1]", () => {
    expect(trackProgress(1000, 1000, 8000)).toBe(0);
    expect(trackProgress(5000, 1000, 8000)).toBe(0.5);
    expect(trackProgress(500, 1000, 8000)).toBe(0);
    expect(trackProgress(99_999, 1000, 8000)).toBe(1);
  });
  it("treats a non-positive duration as finished", () => {
    expect(trackProgress(10, 0, 0)).toBe(1);
  });
});

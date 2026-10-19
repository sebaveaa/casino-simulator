import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "../rng";
import { ANIMAL_COUNT, raceResultSchema, resolveRace } from "./races";

const OUTCOME = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

describe("resolveRace", () => {
  it("returns a permutation of all animals with the winner first", () => {
    const result = resolveRace(createRng(OUTCOME));
    expect([...result.order].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(result.winner).toBe(result.order[0]);
    expect(raceResultSchema.safeParse(result).success).toBe(true);
  });

  it("is deterministic for the same outcome", () => {
    expect(resolveRace(createRng(OUTCOME))).toEqual(resolveRace(createRng(OUTCOME)));
  });

  it("produces the known order for a fixed outcome", () => {
    expect(resolveRace(createRng(OUTCOME)).order).toEqual([1, 2, 3, 4, 0]);
  });

  it("makes every animal the winner in 24 of the 5! = 120 draw sequences", () => {
    const wins = new Array<number>(ANIMAL_COUNT).fill(0);
    for (let a = 0; a < 5; a++)
      for (let b = 0; b < 4; b++)
        for (let c = 0; c < 3; c++)
          for (let d = 0; d < 2; d++) {
            const rng = feed([a, b, c, d]); // answers int(5), int(4), int(3), int(2)
            const { winner } = resolveRace(rng);
            wins[winner] = (wins[winner] ?? 0) + 1;
          }
    expect(wins).toEqual(new Array(ANIMAL_COUNT).fill(24));
  });
});

function feed(values: number[]): Rng {
  const queue = [...values];
  return { int: () => queue.shift() as number };
}

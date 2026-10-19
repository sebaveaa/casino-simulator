import { describe, expect, it } from "vitest";
import { MAX_MONEY } from "../money";
import { createRng, type Rng } from "../rng";
import { ANIMAL_COUNT, racePayout, raceResultSchema, races, resolveRace } from "./races";

const OUTCOME = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

describe("resolveRace", () => {
  it("returns a permutation of all animals with the winner first", () => {
    const result = resolveRace(createRng(OUTCOME));
    expect([...result.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
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

/** Answers the draws of `resolveRace` and checks it asks for int(5), int(4), int(3), int(2). */
function feed(values: number[]): Rng {
  const queue = [...values];
  const expectedMax = [5, 4, 3, 2];
  let asked = 0;
  return {
    int: (max: number) => {
      if (max !== expectedMax[asked]) throw new Error(`unexpected int(${max}) at draw ${asked}`);
      asked++;
      return queue.shift() as number;
    },
  };
}

describe("racePayout", () => {
  it("pays 4.5x the stake, rounded down", () => {
    expect(racePayout(1n)).toBe(4n);
    expect(racePayout(100n)).toBe(450n);
    expect(racePayout(3n)).toBe(13n);
  });
});

describe("races game", () => {
  it("has the races id", () => {
    expect(races.id).toBe("races");
  });

  it("accepts a positive stake on a valid animal", () => {
    expect(races.validateBet({ stake: 1n, animal: 0 })).toBe(true);
    expect(races.validateBet({ stake: 1n, animal: 4 })).toBe(true);
  });

  it("rejects a bad stake or animal", () => {
    expect(races.validateBet({ stake: 0n, animal: 0 })).toBe(false);
    expect(races.validateBet({ stake: 1n, animal: 5 })).toBe(false);
    expect(races.validateBet({ stake: 1n, animal: -1 })).toBe(false);
    expect(races.validateBet({ stake: 1n, animal: 1.5 })).toBe(false);
  });

  it("rejects a stake whose payout exceeds MAX_MONEY", () => {
    expect(races.validateBet({ stake: MAX_MONEY, animal: 0 })).toBe(false);
  });

  it("pays only when the bet animal wins", () => {
    const result = { winner: 2, order: [2, 0, 1, 3, 4] };
    expect(races.payout({ stake: 100n, animal: 2 }, result)).toBe(450n);
    expect(races.payout({ stake: 100n, animal: 1 }, result)).toBe(0n);
  });

  it("resolves like resolveRace", () => {
    const bet = { stake: 1n, animal: 0 };
    expect(races.resolve(bet, createRng(OUTCOME))).toEqual(resolveRace(createRng(OUTCOME)));
  });
});

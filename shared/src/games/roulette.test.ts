import { describe, expect, it } from "vitest";
import { computeOutcome, createRng } from "../rng";
import {
  pocketColor,
  type RouletteBet,
  type RouletteSelection,
  roulette,
  rouletteResultSchema,
  rouletteSelectionSchema,
} from "./roulette";

describe("rouletteSelectionSchema", () => {
  it("accepts each selection variant", () => {
    const selections = [
      { type: "straight", number: 0 },
      { type: "straight", number: 36 },
      { type: "color", color: "red" },
      { type: "color", color: "black" },
      { type: "parity", parity: "odd" },
      { type: "parity", parity: "even" },
      { type: "dozen", dozen: 1 },
      { type: "dozen", dozen: 3 },
    ];
    for (const s of selections) expect(rouletteSelectionSchema.parse(s)).toEqual(s);
  });

  it("rejects out-of-range numbers, unknown types and bad dozens", () => {
    const invalid = [
      { type: "straight", number: 37 },
      { type: "straight", number: -1 },
      { type: "straight", number: 1.5 },
      { type: "split", numbers: [1, 2] },
      { type: "dozen", dozen: 4 },
      { type: "dozen", dozen: 0 },
      { type: "color", color: "green" },
    ];
    for (const s of invalid) expect(rouletteSelectionSchema.safeParse(s).success).toBe(false);
  });
});

describe("rouletteResultSchema", () => {
  it("accepts 0 to 36 and rejects values outside", () => {
    expect(rouletteResultSchema.safeParse({ number: 0 }).success).toBe(true);
    expect(rouletteResultSchema.safeParse({ number: 36 }).success).toBe(true);
    expect(rouletteResultSchema.safeParse({ number: 37 }).success).toBe(false);
    expect(rouletteResultSchema.safeParse({ number: -1 }).success).toBe(false);
  });
});

const bet = (selection: RouletteSelection, stake = 100n): RouletteBet => ({ stake, selection });

describe("pocketColor", () => {
  it("colors the wheel", () => {
    expect(pocketColor(0)).toBe("green");
    expect(pocketColor(1)).toBe("red");
    expect(pocketColor(2)).toBe("black");
    expect(pocketColor(10)).toBe("black");
    expect(pocketColor(19)).toBe("red");
    expect(pocketColor(36)).toBe("red");
  });

  it("has 18 red and 18 black pockets", () => {
    const colors = Array.from({ length: 37 }, (_, n) => pocketColor(n));
    expect(colors.filter((c) => c === "red")).toHaveLength(18);
    expect(colors.filter((c) => c === "black")).toHaveLength(18);
  });
});

describe("roulette.validateBet", () => {
  it("accepts a positive stake with a legal selection", () => {
    expect(roulette.validateBet(bet({ type: "straight", number: 17 }))).toBe(true);
  });

  it("rejects a zero or negative stake", () => {
    expect(roulette.validateBet(bet({ type: "color", color: "red" }, 0n))).toBe(false);
    expect(roulette.validateBet(bet({ type: "color", color: "red" }, -5n))).toBe(false);
  });

  it("rejects an illegal selection", () => {
    expect(roulette.validateBet(bet({ type: "straight", number: 37 }))).toBe(false);
  });

  it("rejects a stake whose payout would not fit in a bigint column", () => {
    expect(roulette.validateBet(bet({ type: "straight", number: 1 }, 2n ** 62n))).toBe(false);
  });
});

describe("roulette.payout", () => {
  const cases: [RouletteSelection, number, bigint][] = [
    [{ type: "straight", number: 17 }, 17, 3600n],
    [{ type: "straight", number: 17 }, 18, 0n],
    [{ type: "straight", number: 0 }, 0, 3600n],
    [{ type: "color", color: "red" }, 1, 200n],
    [{ type: "color", color: "red" }, 2, 0n],
    [{ type: "color", color: "black" }, 2, 200n],
    [{ type: "parity", parity: "odd" }, 7, 200n],
    [{ type: "parity", parity: "even" }, 8, 200n],
    [{ type: "parity", parity: "even" }, 7, 0n],
    [{ type: "dozen", dozen: 1 }, 12, 300n],
    [{ type: "dozen", dozen: 2 }, 13, 300n],
    [{ type: "dozen", dozen: 3 }, 36, 300n],
    [{ type: "dozen", dozen: 2 }, 25, 0n],
  ];
  it.each(cases)("%o on %i pays %s", (selection, number, expected) => {
    expect(roulette.payout(bet(selection), { number })).toBe(expected);
  });

  it("loses every outside bet on zero", () => {
    const outside: RouletteSelection[] = [
      { type: "color", color: "red" },
      { type: "color", color: "black" },
      { type: "parity", parity: "odd" },
      { type: "parity", parity: "even" },
      { type: "dozen", dozen: 1 },
      { type: "dozen", dozen: 2 },
      { type: "dozen", dozen: 3 },
    ];
    for (const s of outside) expect(roulette.payout(bet(s), { number: 0 })).toBe(0n);
  });
});

describe("roulette.resolve", () => {
  it("gives a fixed number for a fixed seed", async () => {
    const numbers: number[] = [];
    for (let nonce = 0; nonce < 6; nonce++) {
      const outcome = await computeOutcome({
        serverSeed: "server-seed",
        clientSeed: "client-seed",
        nonce,
      });
      numbers.push(
        roulette.resolve(bet({ type: "color", color: "red" }), createRng(outcome)).number,
      );
    }
    expect(numbers).toEqual([8, 31, 33, 4, 3, 10]);
  });

  it("does not depend on the selection", async () => {
    const outcome = await computeOutcome({ serverSeed: "s", clientSeed: "c", nonce: 1 });
    const a = roulette.resolve(bet({ type: "straight", number: 5 }), createRng(outcome));
    const b = roulette.resolve(bet({ type: "dozen", dozen: 3 }, 999n), createRng(outcome));
    expect(a).toEqual(b);
  });

  it("stays within 0 to 36", () => {
    const rng = { int: (max: number) => max - 1 };
    expect(roulette.resolve(bet({ type: "color", color: "red" }), rng)).toEqual({ number: 36 });
  });
});

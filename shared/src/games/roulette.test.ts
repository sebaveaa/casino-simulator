import { describe, expect, it } from "vitest";
import { MAX_MONEY } from "../money";
import { computeOutcome, createRng } from "../rng";
import {
  MAX_SPIN_BETS,
  pocketColor,
  type RouletteBet,
  type RouletteSelection,
  roulette,
  rouletteResultSchema,
  rouletteSelectionSchema,
  selectionKey,
  spinPayouts,
  totalStake,
  validateSpin,
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

describe("validateSpin", () => {
  const straight = (number: number, stake = 100n) => bet({ type: "straight", number }, stake);
  const red = bet({ type: "color", color: "red" });

  it("accepts a mix of inside and outside bets", () => {
    expect(validateSpin([straight(17), red, bet({ type: "dozen", dozen: 2 }, 50n)])).toBe(true);
  });

  it("accepts every distinct selection at once", () => {
    const all: RouletteBet[] = [
      ...Array.from({ length: 37 }, (_, n) => straight(n)),
      red,
      bet({ type: "color", color: "black" }),
      bet({ type: "parity", parity: "odd" }),
      bet({ type: "parity", parity: "even" }),
      bet({ type: "dozen", dozen: 1 }),
      bet({ type: "dozen", dozen: 2 }),
      bet({ type: "dozen", dozen: 3 }),
    ];
    expect(all).toHaveLength(MAX_SPIN_BETS);
    expect(validateSpin(all)).toBe(true);
  });

  it("rejects an empty spin and one with more than 44 bets", () => {
    expect(validateSpin([])).toBe(false);
    const tooMany = Array.from({ length: MAX_SPIN_BETS + 1 }, (_, n) => straight(n % 37));
    expect(validateSpin(tooMany)).toBe(false);
  });

  it("rejects the same selection twice, whatever the stakes", () => {
    expect(validateSpin([straight(17), straight(17, 5n)])).toBe(false);
    expect(validateSpin([red, { ...red, stake: 1n }])).toBe(false);
  });

  it("rejects a spin holding an invalid bet", () => {
    expect(validateSpin([red, straight(17, 0n)])).toBe(false);
    expect(validateSpin([red, straight(37)])).toBe(false);
  });

  it("rejects a spin whose total stake or total payout would not fit in a bigint column", () => {
    // Each bet is valid alone (payout 2 x stake fits); together the payouts overflow.
    const half = MAX_MONEY / 2n;
    expect(roulette.validateBet(bet({ type: "color", color: "red" }, half))).toBe(true);
    expect(
      validateSpin([
        bet({ type: "color", color: "red" }, half),
        bet({ type: "parity", parity: "odd" }, half),
      ]),
    ).toBe(false);
  });
});

describe("selectionKey", () => {
  it("is equal exactly for selections that bet on the same thing", () => {
    expect(selectionKey({ type: "straight", number: 3 })).toBe(
      selectionKey({ type: "straight", number: 3 }),
    );
    expect(selectionKey({ type: "straight", number: 3 })).not.toBe(
      selectionKey({ type: "straight", number: 4 }),
    );
    expect(selectionKey({ type: "dozen", dozen: 1 })).not.toBe(
      selectionKey({ type: "color", color: "red" }),
    );
  });
});

describe("totalStake and spinPayouts", () => {
  const spin: RouletteBet[] = [
    bet({ type: "straight", number: 17 }, 100n),
    bet({ type: "color", color: "black" }, 200n),
    bet({ type: "color", color: "red" }, 300n),
    bet({ type: "dozen", dozen: 2 }, 400n),
  ];

  it("sums the stakes", () => {
    expect(totalStake(spin)).toBe(1000n);
  });

  it("pays each bet by its own multiplier on pocket 17, in order", () => {
    expect(spinPayouts(spin, { number: 17 })).toEqual({
      payouts: [3600n, 400n, 0n, 1200n],
      total: 5200n,
    });
  });

  it("loses every outside bet on zero", () => {
    const outside = spin.slice(1);
    expect(spinPayouts(outside, { number: 0 })).toEqual({ payouts: [0n, 0n, 0n], total: 0n });
    expect(spinPayouts(spin, { number: 0 }).total).toBe(0n);
  });
});

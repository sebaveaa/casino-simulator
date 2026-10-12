import { describe, expect, it } from "vitest";
import { rouletteResultSchema, rouletteSelectionSchema } from "./roulette";

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

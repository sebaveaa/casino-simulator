import { CHICKEN_ROAD_MULTIPLIERS } from "@casino/shared";
import { describe, expect, it } from "vitest";
import { credits, formatMultiplier, gainOf, stakeFromInput, wouldHaveWon } from "./format";

describe("formatMultiplier", () => {
  it("writes integer hundredths with a decimal comma and two decimals", () => {
    expect(CHICKEN_ROAD_MULTIPLIERS.map(formatMultiplier)).toEqual([
      "1,20x",
      "1,50x",
      "1,87x",
      "2,34x",
      "2,92x",
      "3,66x",
    ]);
    expect(formatMultiplier(100)).toBe("1,00x");
    expect(formatMultiplier(105)).toBe("1,05x");
  });
});

describe("money math", () => {
  it("computes the gain in BigInt, exact beyond Number's safe range", () => {
    // Number would give 16 here: both values are past 2^53 and round to the same double.
    const payout = "90071992547409930";
    const stake = "90071992547409913";
    expect(Number(payout) - Number(stake)).not.toBe(17);
    expect(gainOf(payout, stake)).toBe(17n);
    expect(credits(gainOf("1500", "1000"))).toBe("5");
    expect(credits(gainOf("1234", "1000"))).toBe("2.34");
  });

  it("floors what retiring would have paid, without decimals", () => {
    // 123 × 1.20 = 147.6 minor units: floored to 147, never 147.6.
    expect(wouldHaveWon("123", 1)).toBe(147n);
    expect(credits(wouldHaveWon("123", 1))).toBe("1.47");
    expect(wouldHaveWon("1000", 3)).toBe(1870n);
    expect(wouldHaveWon("90071992547409913", 2)).toBe(135107988821114869n);
  });

  it("shows credits short, from strings or minor units", () => {
    expect(credits("1000")).toBe("10");
    expect(credits("1250")).toBe("12.50");
    expect(credits(50000n)).toBe("500");
  });
});

describe("stakeFromInput", () => {
  it("accepts whole credits from 10 to 500 in steps of 10", () => {
    expect(stakeFromInput("10")).toBe("1000");
    expect(stakeFromInput(" 120 ")).toBe("12000");
    expect(stakeFromInput("500")).toBe("50000");
  });

  it("rejects amounts out of range, off the step, or not whole", () => {
    for (const text of ["", "0", "5", "15", "510", "1000", "12.5", "-10", "abc", "1e2"]) {
      expect(stakeFromInput(text)).toBeNull();
    }
  });
});

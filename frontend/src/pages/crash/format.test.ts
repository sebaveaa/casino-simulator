import { describe, expect, it } from "vitest";
import {
  creditsFromAmount,
  formatMultiplier,
  limitsInCredits,
  stakeMinorFromCredits,
} from "./format";

describe("formatMultiplier", () => {
  it("shows two decimals with a comma", () => {
    expect(formatMultiplier(100)).toBe("1,00x");
    expect(formatMultiplier(106)).toBe("1,06x");
    expect(formatMultiplier(245)).toBe("2,45x");
    expect(formatMultiplier(2000)).toBe("20,00x");
  });
});

describe("stakeMinorFromCredits", () => {
  it("turns whole credits into minor units", () => {
    expect(stakeMinorFromCredits("10")).toBe("1000");
    expect(stakeMinorFromCredits("500")).toBe("50000");
    expect(stakeMinorFromCredits(" 50 ")).toBe("5000");
  });
  it("rejects non-whole input", () => {
    expect(stakeMinorFromCredits("10.5")).toBeNull();
    expect(stakeMinorFromCredits("abc")).toBeNull();
    expect(stakeMinorFromCredits("")).toBeNull();
  });
});

describe("limitsInCredits", () => {
  it("converts the minor-unit bounds to whole credits", () => {
    expect(limitsInCredits({ minStake: "1000", maxStake: "50000" })).toEqual({ min: 10, max: 500 });
  });
});

describe("creditsFromAmount", () => {
  it("formats an API amount as credits", () => {
    expect(creditsFromAmount("1000")).toBe("10.00");
    expect(creditsFromAmount("123456")).toBe("1,234.56");
  });
});

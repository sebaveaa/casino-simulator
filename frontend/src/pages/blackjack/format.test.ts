import { describe, expect, it } from "vitest";
import { cardName, credits, gainOf, isRedSuit, isWin, stakeFromInput, totalLabel } from "./format";

describe("Blackjack format", () => {
  it("reads a stake in whole credits from 10 to 500, in steps of 10", () => {
    expect(stakeFromInput("10")).toBe("1000");
    expect(stakeFromInput(" 500 ")).toBe("50000");
    for (const text of ["", "5", "15", "510", "1e2", "-10", "10.5"]) {
      expect(stakeFromInput(text)).toBeNull();
    }
  });

  it("shows credits and the gain over what was wagered", () => {
    expect(credits("2500")).toBe("25");
    expect(credits(1250n)).toBe("12.50");
    expect(gainOf("4000", "2000")).toBe(2000n);
  });

  it("names cards in Spanish and colors hearts and diamonds", () => {
    expect(cardName({ rank: "A", suit: "spades" })).toBe("As de picas");
    expect(cardName({ rank: "10", suit: "hearts" })).toBe("10 de corazones");
    expect(isRedSuit("diamonds")).toBe(true);
    expect(isRedSuit("clubs")).toBe(false);
  });

  it("shows both totals while an ace still counts 11", () => {
    expect(totalLabel({ total: 17, soft: true })).toBe("7 / 17");
    expect(totalLabel({ total: 17, soft: false })).toBe("17");
    expect(totalLabel({ total: 21, soft: true })).toBe("21");
  });

  it("counts only a natural and a win as wins", () => {
    expect(isWin("blackjack")).toBe(true);
    expect(isWin("win")).toBe(true);
    for (const outcome of ["push", "lose", "bust", "dealer_blackjack"] as const) {
      expect(isWin(outcome)).toBe(false);
    }
  });
});

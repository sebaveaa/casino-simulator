import { describe, expect, it } from "vitest";
import {
  cardName,
  chipsFor,
  chipsOfStake,
  credits,
  creditsOfStake,
  gainOf,
  isRedSuit,
  isWin,
  PILE_MAX,
  pilesOf,
  stakeOfCredits,
  totalLabel,
} from "./format";

describe("Blackjack format", () => {
  it("takes chips worth 10 to 500 credits as a stake", () => {
    expect(stakeOfCredits(10)).toBe("1000");
    expect(stakeOfCredits(500)).toBe("50000");
    expect(stakeOfCredits(0)).toBeNull();
    expect(stakeOfCredits(510)).toBeNull();
    expect(creditsOfStake("25000")).toBe(250);
  });

  it("stacks a bet with the fewest chips, largest first", () => {
    expect(chipsFor(0)).toEqual([]);
    expect(chipsFor(500)).toEqual([500]);
    expect(chipsFor(490)).toEqual([100, 100, 100, 100, 50, 10, 10, 10, 10]);
    expect(chipsFor(160)).toEqual([100, 50, 10]);
  });

  it("piles chips as they were put down, a new pile every ten", () => {
    expect(pilesOf([])).toEqual([]);
    expect(pilesOf([50, 50])).toEqual([[50, 50]]);
    const many = Array.from({ length: PILE_MAX * 2 + 3 }, () => 10);
    expect(pilesOf(many).map((pile) => pile.length)).toEqual([10, 10, 3]);
  });

  it("keeps the player's chips for the stake they make, and stacks a restored one", () => {
    expect(chipsOfStake("10000", [50, 50])).toEqual([50, 50]);
    expect(chipsOfStake("10000", [10])).toEqual([100]);
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

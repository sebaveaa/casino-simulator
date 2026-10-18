import { type RouletteSelection, totalStake } from "@casino/shared";
import { describe, expect, it } from "vitest";
import {
  betsFromResponse,
  type Chip,
  chipsFromBets,
  doubleChips,
  maxWin,
  placeChip,
  stacksOf,
  toRequest,
  undoChip,
} from "./betSlip";

const red: RouletteSelection = { type: "color", color: "red" };
const odd: RouletteSelection = { type: "parity", parity: "odd" };
const seventeen: RouletteSelection = { type: "straight", number: 17 };
const dozen2: RouletteSelection = { type: "dozen", dozen: 2 };

describe("placeChip, undoChip", () => {
  it("adds chips in click order and takes the last one back", () => {
    let chips: Chip[] = [];
    chips = placeChip(chips, red, 500n);
    chips = placeChip(chips, seventeen, 100n);
    chips = placeChip(chips, red, 1000n);
    expect(chips.map((c) => c.amount)).toEqual([500n, 100n, 1000n]);
    expect(undoChip(chips).map((c) => c.amount)).toEqual([500n, 100n]);
    expect(undoChip([])).toEqual([]);
  });

  it("does not change the list it receives", () => {
    const chips = placeChip([], red, 500n);
    placeChip(chips, seventeen, 100n);
    undoChip(chips);
    doubleChips(chips);
    expect(chips).toEqual([{ selection: red, amount: 500n }]);
  });
});

describe("stacksOf", () => {
  it("sums the chips of one selection and orders stacks by first use", () => {
    const chips = [
      { selection: red, amount: 500n },
      { selection: seventeen, amount: 100n },
      { selection: red, amount: 1000n },
      { selection: dozen2, amount: 2500n },
      { selection: seventeen, amount: 500n },
    ];
    expect(stacksOf(chips)).toEqual([
      { selection: red, stake: 1500n },
      { selection: seventeen, stake: 600n },
      { selection: dozen2, stake: 2500n },
    ]);
  });

  it("is empty without chips, and undoing the only chip of a selection removes its stack", () => {
    expect(stacksOf([])).toEqual([]);
    const chips = placeChip(placeChip([], red, 500n), seventeen, 100n);
    expect(stacksOf(undoChip(chips))).toEqual([{ selection: red, stake: 500n }]);
  });
});

describe("doubleChips", () => {
  it("doubles every stack and the total", () => {
    const chips = [
      { selection: red, amount: 500n },
      { selection: seventeen, amount: 100n },
      { selection: red, amount: 1000n },
    ];
    const doubled = stacksOf(doubleChips(chips));
    expect(doubled.map((s) => s.stake)).toEqual([3000n, 200n]);
    expect(totalStake(doubled)).toBe(2n * totalStake(stacksOf(chips)));
  });
});

describe("chipsFromBets", () => {
  it("re-places each bet as one chip with its whole stake, same order", () => {
    const bets = [
      { selection: seventeen, stake: 700n },
      { selection: red, stake: 1500n },
    ];
    expect(chipsFromBets(bets)).toEqual([
      { selection: seventeen, amount: 700n },
      { selection: red, amount: 1500n },
    ]);
    expect(stacksOf(chipsFromBets(bets))).toEqual(bets);
  });
});

describe("maxWin", () => {
  it("is 0 for an empty slip", () => {
    expect(maxWin([])).toBe(0n);
  });

  it("is the best single pocket, since only one number comes up", () => {
    // 17 is black: hitting it returns 36 x 100 and the red bet loses. Any red pocket returns only
    // 2 x 1000, so the best pocket is 17.
    const bets = [
      { selection: seventeen, stake: 100n },
      { selection: red, stake: 1000n },
    ];
    expect(maxWin(bets)).toBe(3600n);
  });

  it("adds the bets that win together on the same pocket", () => {
    // 17 is odd, black and in the 2nd dozen: straight 36 x 100 + dozen 3 x 200 + odd 2 x 300.
    const bets = [
      { selection: seventeen, stake: 100n },
      { selection: dozen2, stake: 200n },
      { selection: odd, stake: 300n },
    ];
    expect(maxWin(bets)).toBe(3600n + 600n + 600n);
  });
});

describe("toRequest, betsFromResponse", () => {
  it("builds the request with amount strings in stack order", () => {
    const stacks = stacksOf([
      { selection: seventeen, amount: 100n },
      { selection: red, amount: 500n },
      { selection: seventeen, amount: 100n },
    ]);
    expect(toRequest(stacks)).toEqual({
      bets: [
        { stake: "200", selection: seventeen },
        { stake: "500", selection: red },
      ],
    });
  });

  it("reads the stakes of a response back as bigint", () => {
    expect(
      betsFromResponse([
        { stake: "200", selection: seventeen, payout: "0" },
        { stake: "500", selection: red, payout: "1000" },
      ]),
    ).toEqual([
      { selection: seventeen, stake: 200n },
      { selection: red, stake: 500n },
    ]);
  });
});

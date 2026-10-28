import type { BlackjackCard } from "@casino/shared";
import { describe, expect, it } from "vitest";
import { planDeal, type TableCards } from "./deal";

const card = (rank: BlackjackCard["rank"], suit: BlackjackCard["suit"] = "spades") => ({
  rank,
  suit,
});
const empty: TableCards = { player: [], dealer: [] };
const dealt: TableCards = { player: [[card("K"), card("7")]], dealer: [card("9"), null] };

describe("planDeal", () => {
  it("deals player, dealer, player, dealer on a fresh round", () => {
    const plan = planDeal(empty, dealt, 100, 300);
    expect(plan.player).toEqual([[0, 200]]);
    expect(plan.dealer).toEqual([100, 300]);
    expect(plan.durationMs).toBe(3 * 100 + 300);
  });

  it("lands only the new card after a hit", () => {
    const after = { ...dealt, player: [[card("K"), card("7"), card("2")]] };
    const plan = planDeal(dealt, after, 100, 300);
    expect(plan.player).toEqual([[null, null, 0]]);
    expect(plan.dealer).toEqual([null, null]);
    expect(plan.durationMs).toBe(300);
  });

  it("turns the hole card over, then the dealer's draws land", () => {
    const after = { player: dealt.player, dealer: [card("9"), card("5"), card("4")] };
    const plan = planDeal(dealt, after, 100, 300);
    expect(plan.player).toEqual([[null, null]]);
    expect(plan.dealer).toEqual([null, 0, 100]);
  });

  it("puts the player's double card before the dealer's turn", () => {
    const after = {
      player: [[card("K"), card("7"), card("K")]],
      dealer: [card("9"), card("8")],
    };
    const plan = planDeal(dealt, after, 100, 300);
    expect(plan.player).toEqual([[null, null, 0]]);
    expect(plan.dealer).toEqual([null, 100]);
  });

  it("lands the left hand's new card and the pair's other card on a split", () => {
    const pair: TableCards = {
      player: [[card("8"), card("8", "hearts")]],
      dealer: [card("9"), null],
    };
    const split = {
      player: [[card("8"), card("3")], [card("8", "hearts")]],
      dealer: pair.dealer,
    };
    const plan = planDeal(pair, split, 100, 300);
    expect(plan.player).toEqual([[null, 0], [100]]);
    expect(plan.dealer).toEqual([null, null]);

    // The right hand draws its second card when its turn comes.
    const right = { ...split, player: [split.player[0] ?? [], [card("8", "hearts"), card("K")]] };
    expect(planDeal(split, right, 100, 300).player).toEqual([
      [null, null],
      [null, 0],
    ]);
  });

  it("lands everything at once with reduced motion, and nothing when nothing changed", () => {
    expect(planDeal(empty, dealt, 0, 0)).toEqual({
      player: [[0, 0]],
      dealer: [0, 0],
      durationMs: 0,
    });
    expect(planDeal(dealt, dealt).durationMs).toBe(0);
  });
});

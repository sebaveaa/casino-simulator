import { describe, expect, it } from "vitest";
import { computeOutcome, createRng, type Rng } from "../rng";
import {
  BLACKJACK_MAX_ACTIONS,
  BLACKJACK_MAX_STAKE,
  BLACKJACK_MIN_STAKE,
  BLACKJACK_RANKS,
  type BlackjackAction,
  type BlackjackBet,
  type BlackjackRank,
  blackjack,
  blackjackHandPayout,
  blackjackPayout,
  blackjackResultSchema,
  blackjackWagerCount,
  describeCard,
  handValue,
  isNatural,
  legalActions,
  playHand,
  SHOE_SIZE,
  shuffleShoe,
} from "./blackjack";

/** The player's hands of a state, as `[cards, outcome]` pairs. */
const hands = (state: ReturnType<typeof playHand>) =>
  state.playerHands.map((hand) => [hand.cards, hand.outcome]);

/** The spades card of a rank: `c("A")` is 0, `c("K")` is 12. */
const c = (rank: BlackjackRank): number => BLACKJACK_RANKS.indexOf(rank);
const cards = (...ranks: BlackjackRank[]): number[] => ranks.map(c);

/** A stacked shoe dealt in order: player, dealer, player, dealer, then the draws. */
const shoe = cards;

const bet = (actions: BlackjackAction[] = [], stake = 1000n): BlackjackBet => ({ stake, actions });

async function seededRng(nonce: number): Promise<Rng> {
  const outcome = await computeOutcome({
    serverSeed: "server-seed",
    clientSeed: "client-seed",
    nonce,
  });
  return createRng(outcome);
}

describe("describeCard", () => {
  it("maps 0 to 51 to a rank and a suit", () => {
    expect(describeCard(0)).toEqual({ rank: "A", suit: "spades" });
    expect(describeCard(9)).toEqual({ rank: "10", suit: "spades" });
    expect(describeCard(13)).toEqual({ rank: "A", suit: "hearts" });
    expect(describeCard(38)).toEqual({ rank: "K", suit: "diamonds" });
    expect(describeCard(51)).toEqual({ rank: "K", suit: "clubs" });
  });

  it("rejects anything else", () => {
    for (const card of [-1, 52, 1.5]) expect(() => describeCard(card)).toThrow(RangeError);
  });
});

describe("handValue", () => {
  it("counts one ace as 11 when it does not bust the hand", () => {
    expect(handValue(cards("A", "K"))).toEqual({ total: 21, soft: true });
    expect(handValue(cards("A", "A"))).toEqual({ total: 12, soft: true });
    expect(handValue(cards("A", "6"))).toEqual({ total: 17, soft: true });
  });

  it("falls back to hard totals", () => {
    expect(handValue(cards("A", "6", "K"))).toEqual({ total: 17, soft: false });
    expect(handValue(cards("A", "A", "K"))).toEqual({ total: 12, soft: false });
    expect(handValue(cards("K", "Q", "2"))).toEqual({ total: 22, soft: false });
  });

  it("counts picture cards as 10 in every suit", () => {
    expect(handValue([10, 24, 38]).total).toBe(30);
  });
});

describe("isNatural", () => {
  it("is 21 with exactly two cards", () => {
    expect(isNatural(cards("A", "K"))).toBe(true);
    expect(isNatural(cards("10", "A"))).toBe(true);
    expect(isNatural(cards("A", "5", "5"))).toBe(false);
    expect(isNatural(cards("K", "Q"))).toBe(false);
  });
});

describe("shuffleShoe", () => {
  it("holds every card six times", () => {
    const counts = new Array(52).fill(0);
    for (const card of shuffleShoe(createRng("0".repeat(64)))) counts[card] += 1;
    expect(counts).toEqual(new Array(52).fill(6));
  });

  it("draws rng.int(i + 1) for i = 311 down to 1", () => {
    const maxes: number[] = [];
    shuffleShoe({
      int(max) {
        maxes.push(max);
        return 0;
      },
    });
    expect(maxes).toHaveLength(SHOE_SIZE - 1);
    expect(maxes[0]).toBe(SHOE_SIZE);
    expect(maxes.at(-1)).toBe(2);
  });

  it("gives the same shoe for the same seed", async () => {
    expect(shuffleShoe(await seededRng(3))).toEqual(shuffleShoe(await seededRng(3)));
    expect(shuffleShoe(await seededRng(3))).not.toEqual(shuffleShoe(await seededRng(4)));
  });
});

describe("playHand", () => {
  it("deals player, dealer, player, dealer and waits for the player", () => {
    const state = playHand(shoe("K", "9", "7", "8"), []);
    expect(state).toEqual({
      playerHands: [{ cards: cards("K", "7"), doubled: false, outcome: null }],
      active: 0,
      dealerCards: cards("9", "8"),
      finished: false,
    });
    expect(legalActions(state)).toEqual(["hit", "stand", "double"]);
  });

  it("ends the round at once on a natural", () => {
    expect(hands(playHand(shoe("A", "9", "K", "8"), []))).toEqual([[cards("A", "K"), "blackjack"]]);
    expect(playHand(shoe("9", "A", "8", "K"), []).playerHands[0]?.outcome).toBe("dealer_blackjack");
    expect(playHand(shoe("A", "A", "K", "K"), []).playerHands[0]?.outcome).toBe("push");
    expect(playHand(shoe("A", "9", "K", "8"), []).finished).toBe(true);
    expect(() => playHand(shoe("A", "9", "K", "8"), ["stand"])).toThrow(/not allowed/);
  });

  it("lets the dealer draw to 17 after a stand", () => {
    const state = playHand(shoe("K", "6", "9", "5", "3", "4"), ["stand"]);
    expect(state.dealerCards).toEqual(cards("6", "5", "3", "4"));
    expect(state.playerHands[0]?.outcome).toBe("win");
    expect(state.finished).toBe(true);
    expect(legalActions(state)).toEqual([]);
  });

  it("stands the dealer on soft 17", () => {
    const state = playHand(shoe("K", "A", "8", "6", "5"), ["stand"]);
    expect(state.dealerCards).toEqual(cards("A", "6"));
    expect(state.playerHands[0]?.outcome).toBe("win");
  });

  it("compares the totals", () => {
    const outcome = (s: number[]) => playHand(s, ["stand"]).playerHands[0]?.outcome;
    expect(outcome(shoe("K", "K", "7", "8", "5"))).toBe("lose");
    expect(outcome(shoe("K", "K", "8", "8"))).toBe("push");
    expect(outcome(shoe("K", "K", "7", "6", "K"))).toBe("win");
  });

  it("busts the player without the dealer drawing", () => {
    const state = playHand(shoe("K", "9", "6", "5", "K", "K"), ["hit"]);
    expect(hands(state)).toEqual([[cards("K", "6", "K"), "bust"]]);
    expect(state.dealerCards).toEqual(cards("9", "5"));
  });

  it("keeps the turn open after a hit under 21, and stands by itself on 21", () => {
    const open = playHand(shoe("5", "9", "6", "8", "2"), ["hit"]);
    expect(open.finished).toBe(false);
    expect(legalActions(open)).toEqual(["hit", "stand"]);

    const hand = shoe("5", "9", "6", "8", "K");
    expect(playHand(hand, ["hit"]).playerHands[0]?.outcome).toBe("win");
    expect(() => playHand(hand, ["hit", "stand"])).toThrow(/not allowed/);
  });

  it("doubles with one card and then stands", () => {
    const state = playHand(shoe("5", "9", "6", "8", "K"), ["double"]);
    expect(state.playerHands).toEqual([
      { cards: cards("5", "6", "K"), doubled: true, outcome: "win" },
    ]);
    const bust = playHand(shoe("K", "9", "6", "8", "K"), ["double"]);
    expect(bust.playerHands[0]).toMatchObject({ doubled: true, outcome: "bust" });
  });

  it("allows double only on the first two cards", () => {
    expect(() => playHand(shoe("2", "9", "3", "8", "2", "K"), ["hit", "double"])).toThrow(
      /not allowed/,
    );
  });

  it("throws when the shoe runs out", () => {
    expect(() => playHand(shoe("2", "9", "3"), [])).toThrow(RangeError);
  });
});

describe("playHand: split", () => {
  // Player 8+8 against a dealer 9 up (9+7 = 16).
  const eights = (...rest: BlackjackRank[]) => shoe("8", "9", "8", "7", ...rest);

  it("offers split on a pair of the same rank only", () => {
    expect(legalActions(playHand(eights(), []))).toEqual(["hit", "stand", "double", "split"]);
    expect(legalActions(playHand(shoe("K", "9", "Q", "7"), []))).not.toContain("split");
  });

  it("plays the left hand first; the right one draws its second card when its turn comes", () => {
    const state = playHand(eights("3", "K"), ["split"]);
    expect(state.playerHands.map((hand) => hand.cards)).toEqual([cards("8", "3"), cards("8")]);
    expect(state.active).toBe(0);
    expect(legalActions(state)).toEqual(["hit", "stand", "double"]);

    const right = playHand(eights("3", "K"), ["split", "stand"]);
    expect(right.active).toBe(1);
    expect(right.playerHands[1]?.cards).toEqual(cards("8", "K"));
  });

  it("settles each hand against the dealer once both are done", () => {
    // Left 8+3 stands on 11, right 8+K stands on 18; the dealer draws 9+7+2 = 18.
    const state = playHand(eights("3", "K", "2"), ["split", "stand", "stand"]);
    expect(state.finished).toBe(true);
    expect(state.dealerCards).toEqual(cards("9", "7", "2"));
    expect(hands(state)).toEqual([
      [cards("8", "3"), "lose"],
      [cards("8", "K"), "push"],
    ]);
  });

  it("allows a double after the split, and no second split", () => {
    // Left 8+8 again: no resplit. Double draws a 3 (19), then the right hand 8+K stands.
    const state = playHand(eights("8", "3", "K", "K"), ["split", "double", "stand"]);
    expect(legalActions(playHand(eights("8"), ["split"]))).not.toContain("split");
    expect(state.playerHands[0]).toMatchObject({ cards: cards("8", "8", "3"), doubled: true });
    expect(state.playerHands.map((hand) => hand.outcome)).toEqual(["win", "win"]);
  });

  it("gives split aces one card each and stands them, and 21 there is no blackjack", () => {
    const state = playHand(shoe("A", "9", "A", "7", "K", "5", "2"), ["split"]);
    expect(state.finished).toBe(true);
    expect(hands(state)).toEqual([
      [cards("A", "K"), "win"],
      [cards("A", "5"), "lose"],
    ]);
    expect(state.dealerCards).toEqual(cards("9", "7", "2"));
  });

  it("skips the dealer's draws when both hands bust", () => {
    const state = playHand(eights("6", "K", "6", "K"), ["split", "hit", "hit"]);
    expect(state.playerHands.map((hand) => hand.outcome)).toEqual(["bust", "bust"]);
    expect(state.dealerCards).toEqual(cards("9", "7"));
  });
});

describe("blackjackPayout", () => {
  const paid = (outcome: Parameters<typeof blackjackHandPayout>[1]["outcome"], doubled = false) =>
    blackjackHandPayout(1000n, { outcome, doubled });

  it("pays 3:2 on a natural, rounded down", () => {
    expect(paid("blackjack")).toBe(2500n);
    expect(blackjackHandPayout(1001n, { outcome: "blackjack", doubled: false })).toBe(2502n);
  });

  it("pays 2x the wagered amount on a win and returns it on a push", () => {
    expect(paid("win")).toBe(2000n);
    expect(paid("win", true)).toBe(4000n);
    expect(paid("push")).toBe(1000n);
    expect(paid("push", true)).toBe(2000n);
  });

  it("pays nothing on any loss", () => {
    for (const outcome of ["lose", "bust", "dealer_blackjack"] as const) {
      expect(paid(outcome)).toBe(0n);
      expect(paid(outcome, true)).toBe(0n);
    }
  });

  it("adds up the hands of a split", () => {
    const result = {
      playerHands: [
        { cards: [], doubled: true, outcome: "win" as const },
        { cards: [], doubled: false, outcome: "push" as const },
      ],
    };
    expect(blackjackPayout(1000n, result)).toBe(4000n + 1000n);
  });

  it("counts one stake, plus one per split and per double", () => {
    expect(blackjackWagerCount([])).toBe(1n);
    expect(blackjackWagerCount(["hit", "stand"])).toBe(1n);
    expect(blackjackWagerCount(["split", "double", "double"])).toBe(4n);
  });
});

describe("blackjack.validateBet", () => {
  it("accepts stakes from 10 to 500 credits", () => {
    expect(BLACKJACK_MIN_STAKE).toBe(1000n);
    expect(BLACKJACK_MAX_STAKE).toBe(50000n);
    expect(blackjack.validateBet(bet([], BLACKJACK_MIN_STAKE))).toBe(true);
    expect(blackjack.validateBet(bet([], BLACKJACK_MAX_STAKE))).toBe(true);
    expect(blackjack.validateBet(bet([], BLACKJACK_MIN_STAKE - 1n))).toBe(false);
    expect(blackjack.validateBet(bet([], BLACKJACK_MAX_STAKE + 1n))).toBe(false);
  });

  it("accepts the action lists a round can have", () => {
    for (const actions of [
      [],
      ["stand"],
      ["double"],
      ["hit", "hit", "stand"],
      ["split", "double", "hit", "stand"],
    ] as const) {
      expect(blackjack.validateBet(bet([...actions]))).toBe(true);
    }
  });

  it("rejects a split after the first action, unknown actions and too many", () => {
    const invalid = [
      ["hit", "split"],
      ["split", "split"],
      ["fold"],
      new Array(BLACKJACK_MAX_ACTIONS + 1).fill("hit"),
    ] as BlackjackAction[][];
    for (const actions of invalid) expect(blackjack.validateBet(bet(actions))).toBe(false);
  });
});

describe("blackjack.resolve", () => {
  it("gives known rounds for fixed seeds, every time", async () => {
    const lost = {
      playerHands: [{ cards: [28, 13], doubled: false, outcome: "lose" }],
      dealerCards: [0, 33],
    };
    expect(blackjack.resolve(bet(["stand"]), await seededRng(0))).toEqual(lost);
    expect(blackjack.resolve(bet(["stand"]), await seededRng(0))).toEqual(lost);
    expect(blackjack.resolve(bet(["hit", "stand"]), await seededRng(2))).toEqual({
      playerHands: [{ cards: [35, 14, 1], doubled: false, outcome: "win" }],
      dealerCards: [15, 40, 25, 10],
    });
  });

  it("depends on the actions", async () => {
    const outcome = async (actions: BlackjackAction[]) =>
      blackjack.resolve(bet(actions), await seededRng(2)).playerHands[0]?.outcome;
    expect(await outcome(["stand"])).toBe("lose");
    expect(await outcome(["hit"])).toBe("win");
  });

  it("stands for the player on every hand the actions leave open", async () => {
    for (const nonce of [0, 1, 2]) {
      const open = blackjack.resolve(bet([]), await seededRng(nonce));
      expect(open).toEqual(blackjack.resolve(bet(["stand"]), await seededRng(nonce)));
    }
  });

  it("matches the result schema and pays through the game", async () => {
    const result = blackjack.resolve(bet(["hit"]), await seededRng(2));
    expect(blackjackResultSchema.parse(result)).toEqual(result);
    expect(blackjack.payout(bet(["hit"]), result)).toBe(2000n);
  });
});

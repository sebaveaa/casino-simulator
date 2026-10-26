import { describe, expect, it } from "vitest";
import { BLACKJACK_MAX_ACTIONS, describeCard } from "../games/blackjack";
import {
  BLACKJACK_HISTORY_DEFAULT_LIMIT,
  BLACKJACK_HISTORY_MAX_LIMIT,
  blackjackActionRequestSchema,
  blackjackActionResponseSchema,
  blackjackCardSchema,
  blackjackCurrentResponseSchema,
  blackjackHandSchema,
  blackjackHistoryQuerySchema,
  blackjackHistoryResponseSchema,
  blackjackStartRequestSchema,
  blackjackStartResponseSchema,
} from "./blackjack";
import { apiPaths } from "./paths";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const king = { rank: "K", suit: "spades" };
const seven = { rank: "7", suit: "hearts" };
const nine = { rank: "9", suit: "clubs" };

const base = {
  handId: uuid,
  stake: "1000",
  fairness: { seedPairId: uuid, serverSeedHash: "a".repeat(64), clientSeed: "c", nonce: 3 },
};

const inProgress = {
  ...base,
  status: "player_turn",
  playerHands: [{ cards: [king, seven], total: { total: 17, soft: false }, doubled: false }],
  activeHand: 0,
  dealerUpCard: nine,
  actionCount: 0,
  canDouble: true,
  canSplit: false,
};

const settled = {
  ...base,
  status: "settled",
  playerHands: [
    {
      cards: [king, seven],
      total: { total: 17, soft: false },
      doubled: false,
      outcome: "lose",
      payout: "0",
    },
  ],
  dealerCards: [nine, king],
  dealerTotal: { total: 19, soft: false },
  totalStake: "1000",
  payout: "0",
};

/** A split in progress: the right hand waits with one card. */
const splitInProgress = {
  ...inProgress,
  playerHands: [
    { cards: [seven, king], total: { total: 17, soft: false }, doubled: false },
    { cards: [seven], total: { total: 7, soft: false }, doubled: false },
  ],
  actionCount: 1,
};

describe("blackjackCardSchema", () => {
  it("accepts every card describeCard builds", () => {
    for (let card = 0; card < 52; card++) {
      expect(blackjackCardSchema.safeParse(describeCard(card)).success).toBe(true);
    }
  });

  it("rejects unknown ranks and suits", () => {
    for (const card of [{ rank: "1", suit: "spades" }, { rank: "A", suit: "stars" }, 0]) {
      expect(blackjackCardSchema.safeParse(card).success).toBe(false);
    }
  });
});

describe("blackjackHandSchema", () => {
  it("accepts each state", () => {
    for (const hand of [inProgress, settled]) {
      expect(blackjackHandSchema.parse(hand)).toEqual(hand);
    }
    const [hand] = settled.playerHands;
    const split = {
      ...settled,
      playerHands: [
        { ...hand, doubled: true, outcome: "win", payout: "4000" },
        { ...hand, outcome: "push", payout: "1000" },
      ],
      totalStake: "3000",
      payout: "5000",
    };
    expect(blackjackHandSchema.parse(split)).toEqual(split);
    expect(blackjackHandSchema.parse(splitInProgress)).toEqual(splitInProgress);
  });

  it("never lets a hand in progress reveal the hole card or the shoe", () => {
    for (const extra of [
      { dealerCards: [nine, king] },
      { dealerTotal: { total: 19, soft: false } },
      { shoe: [1, 2, 3] },
    ]) {
      expect(blackjackHandSchema.safeParse({ ...inProgress, ...extra }).success).toBe(false);
    }
    const decided = [{ ...inProgress.playerHands[0], outcome: "lose" }];
    expect(blackjackHandSchema.safeParse({ ...inProgress, playerHands: decided }).success).toBe(
      false,
    );
  });

  it("rejects values that do not fit a hand", () => {
    const invalid = [
      { ...inProgress, playerHands: [] },
      { ...inProgress, playerHands: [...splitInProgress.playerHands, inProgress.playerHands[0]] },
      { ...inProgress, activeHand: 2 },
      { ...inProgress, actionCount: BLACKJACK_MAX_ACTIONS },
      { ...inProgress, canSplit: undefined },
      { ...settled, playerHands: [{ ...settled.playerHands[0], cards: [king] }] },
      { ...settled, playerHands: [{ ...settled.playerHands[0], outcome: "surrender" }] },
      { ...settled, dealerCards: [nine] },
      { ...settled, payout: 0 },
      { ...settled, totalStake: "0" },
      { ...settled, status: "won" },
    ];
    for (const hand of invalid) expect(blackjackHandSchema.safeParse(hand).success).toBe(false);
  });
});

describe("blackjackStartRequestSchema", () => {
  it("accepts stakes from 10 to 500 credits as strings", () => {
    for (const stake of ["1000", "50000", "12345"]) {
      expect(blackjackStartRequestSchema.parse({ stake })).toEqual({ stake });
    }
  });

  it("rejects stakes out of range, numbers and malformed strings", () => {
    for (const stake of ["0", "999", "50001", 1000, "1e3", "-1000", "abc"]) {
      expect(blackjackStartRequestSchema.safeParse({ stake }).success).toBe(false);
    }
  });

  it("answers with a hand in progress, or a settled one after a natural", () => {
    const natural = {
      ...settled,
      playerHands: [{ ...settled.playerHands[0], outcome: "blackjack", payout: "2500" }],
      payout: "2500",
    };
    for (const hand of [inProgress, natural]) {
      const body = { hand, balance: "9000" };
      expect(blackjackStartResponseSchema.parse(body)).toEqual(body);
    }
  });
});

describe("blackjackActionRequestSchema", () => {
  it("names the hand, the action and its index", () => {
    for (const action of ["hit", "stand", "double", "split"]) {
      const body = { handId: uuid, action, index: 0 };
      expect(blackjackActionRequestSchema.parse(body)).toEqual(body);
    }
    const last = { handId: uuid, action: "hit", index: BLACKJACK_MAX_ACTIONS - 1 };
    expect(blackjackActionRequestSchema.safeParse(last).success).toBe(true);
  });

  it("rejects unknown actions, bad indexes and bad ids", () => {
    const invalid = [
      { handId: uuid, action: "surrender", index: 0 },
      { handId: uuid, action: "hit", index: -1 },
      { handId: uuid, action: "hit", index: 1.5 },
      { handId: uuid, action: "hit", index: BLACKJACK_MAX_ACTIONS },
      { handId: "nope", action: "hit", index: 0 },
      { handId: uuid, action: "hit" },
    ];
    for (const body of invalid)
      expect(blackjackActionRequestSchema.safeParse(body).success).toBe(false);
  });

  it("answers with the hand in either state", () => {
    for (const hand of [inProgress, settled]) {
      expect(blackjackActionResponseSchema.safeParse({ hand, balance: "9000" }).success).toBe(true);
    }
  });
});

describe("blackjackCurrentResponseSchema", () => {
  it("is a hand in progress or null", () => {
    expect(blackjackCurrentResponseSchema.parse({ hand: inProgress })).toEqual({
      hand: inProgress,
    });
    expect(blackjackCurrentResponseSchema.parse({ hand: null })).toEqual({ hand: null });
    expect(blackjackCurrentResponseSchema.safeParse({ hand: settled }).success).toBe(false);
  });
});

describe("blackjack history", () => {
  it("coerces the limit and defaults to 5, up to 20", () => {
    expect(blackjackHistoryQuerySchema.parse({})).toEqual({
      limit: BLACKJACK_HISTORY_DEFAULT_LIMIT,
    });
    expect(blackjackHistoryQuerySchema.parse({ limit: "20" })).toEqual({ limit: 20 });
    for (const limit of ["0", "21", "abc"]) {
      expect(blackjackHistoryQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });

  it("lists settled hands only, at most 20", () => {
    expect(blackjackHistoryResponseSchema.parse({ hands: [settled] })).toEqual({
      hands: [settled],
    });
    expect(blackjackHistoryResponseSchema.safeParse({ hands: [inProgress] }).success).toBe(false);
    const tooMany = new Array(BLACKJACK_HISTORY_MAX_LIMIT + 1).fill(settled);
    expect(blackjackHistoryResponseSchema.safeParse({ hands: tooMany }).success).toBe(false);
  });
});

describe("blackjack paths", () => {
  it("live under /games/blackjack/hands", () => {
    expect(apiPaths.blackjackHands).toBe("/games/blackjack/hands");
    expect(apiPaths.blackjackCurrent).toBe("/games/blackjack/hands/current");
    expect(apiPaths.blackjackActions).toBe("/games/blackjack/hands/current/actions");
  });
});

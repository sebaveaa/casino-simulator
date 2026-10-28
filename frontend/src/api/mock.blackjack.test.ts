import {
  BLACKJACK_RANKS,
  type BlackjackRank,
  blackjackActionResponseSchema,
  blackjackCurrentResponseSchema,
  blackjackHistoryResponseSchema,
  blackjackStartResponseSchema,
  seedPairResponseSchema,
} from "@casino/shared";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "./client";
import { createMockApiClient } from "./mock";

const STAKE = "1000";

/** A stacked shoe of spades: player, dealer, player, dealer, then the draws. */
const shoe = (...ranks: BlackjackRank[]) => ranks.map((rank) => BLACKJACK_RANKS.indexOf(rank));

// Player K+7 against a dealer 9 up: the turn stays open.
const OPEN = shoe("K", "9", "7", "8", "2", "3", "4");
// Player 5+6 against 9+8 (17): a hit or a double draws the K for 21.
const ELEVEN = shoe("5", "9", "6", "8", "K", "K");

const balanceOf = async (api: ApiClient) => BigInt((await api.getBalance()).balance);
const start = (api: ApiClient, key = crypto.randomUUID(), stake = STAKE) =>
  api.startBlackjackHand({ stake }, key);

describe("mock API client: Blackjack", () => {
  it("starts a hand, charges the stake and shows only the dealer's up card", async () => {
    const api = createMockApiClient({ blackjackShoes: [OPEN] });
    const pair = seedPairResponseSchema.parse(await api.getSeedPair());
    const res = blackjackStartResponseSchema.parse(await start(api));
    expect(res.hand).toMatchObject({
      status: "player_turn",
      playerHands: [
        {
          cards: [
            { rank: "K", suit: "spades" },
            { rank: "7", suit: "spades" },
          ],
          total: { total: 17, soft: false },
          doubled: false,
        },
      ],
      activeHand: 0,
      dealerUpCard: { rank: "9", suit: "spades" },
      actionCount: 0,
      canDouble: true,
      canSplit: false,
    });
    expect(Object.keys(res.hand)).not.toContain("dealerCards");
    expect(res.hand.fairness).toMatchObject({
      seedPairId: pair.id,
      serverSeedHash: pair.serverSeedHash,
      nonce: pair.nextNonce,
    });
    expect(res.balance).toBe("99000");
    expect(res.shoe).toMatchObject({ size: 312, cutCard: 234, cardsDealt: 4, reshuffle: false });
    expect(blackjackCurrentResponseSchema.parse(await api.getCurrentBlackjackHand())).toEqual({
      hand: res.hand,
      shoe: res.shoe,
    });
  });

  it("settles a natural at the start and pays 3:2 once", async () => {
    const api = createMockApiClient({ blackjackShoes: [shoe("A", "9", "K", "8")] });
    const res = await start(api);
    expect(res.hand).toMatchObject({ status: "settled", payout: "2500" });
    expect(res.hand.playerHands[0]).toMatchObject({ outcome: "blackjack", payout: "2500" });
    expect(res.balance).toBe("101500");
    expect((await api.getCurrentBlackjackHand()).hand).toBeNull();
  });

  it("replays a retried start with the current hand and charges once", async () => {
    const api = createMockApiClient({ blackjackShoes: [OPEN] });
    const key = crypto.randomUUID();
    const first = await start(api, key);
    await api.playBlackjackAction({ handId: first.hand.handId, action: "hit", index: 0 });
    const retry = await start(api, key);
    expect(retry.hand).toMatchObject({ handId: first.hand.handId, actionCount: 1 });
    expect(await balanceOf(api)).toBe(99000n);
    await expect(start(api, key, "2000")).rejects.toMatchObject({ code: "conflict" });
  });

  it("allows one hand in progress and refuses bad stakes", async () => {
    const api = createMockApiClient({ blackjackShoes: [OPEN] });
    await start(api);
    await expect(start(api)).rejects.toMatchObject({ code: "conflict", status: 409 });
    await expect(start(api, crypto.randomUUID(), "999")).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("stands, lets the dealer draw to 17 and pays a win", async () => {
    const api = createMockApiClient({ blackjackShoes: [shoe("K", "6", "9", "5", "3", "4")] });
    const { hand } = await start(api);
    const res = blackjackActionResponseSchema.parse(
      await api.playBlackjackAction({ handId: hand.handId, action: "stand", index: 0 }),
    );
    expect(res.hand.playerHands[0]).toMatchObject({ outcome: "win", payout: "2000" });
    expect(res.hand).toMatchObject({
      status: "settled",
      dealerTotal: { total: 18, soft: false },
      totalStake: "1000",
      payout: "2000",
    });
    expect(res.balance).toBe("101000");
  });

  it("keeps the turn open after a hit and replays an index already played", async () => {
    const api = createMockApiClient({ blackjackShoes: [OPEN] });
    const { hand } = await start(api);
    const hit = await api.playBlackjackAction({ handId: hand.handId, action: "hit", index: 0 });
    expect(hit.hand).toMatchObject({ status: "player_turn", actionCount: 1, canDouble: false });
    expect(await api.playBlackjackAction({ handId: hand.handId, action: "hit", index: 0 })).toEqual(
      hit,
    );

    for (const body of [
      { handId: hand.handId, action: "stand", index: 0 },
      { handId: hand.handId, action: "stand", index: 2 },
      { handId: hand.handId, action: "double", index: 1 },
    ] as const) {
      await expect(api.playBlackjackAction(body)).rejects.toMatchObject({ code: "conflict" });
    }
  });

  it("doubles: charges the stake again once and pays on the doubled total", async () => {
    const api = createMockApiClient({ blackjackShoes: [ELEVEN] });
    const { hand } = await start(api);
    const body = { handId: hand.handId, action: "double", index: 0 } as const;
    const res = await api.playBlackjackAction(body);
    expect(res.hand.playerHands[0]).toMatchObject({ doubled: true, outcome: "win" });
    expect(res.hand).toMatchObject({
      status: "settled",
      totalStake: "2000",
      payout: "4000",
    });
    expect(res.balance).toBe("102000");
    expect(await api.playBlackjackAction(body)).toEqual(res);
    expect(await balanceOf(api)).toBe(102000n);
  });

  it("splits a pair: charges the stake again, plays both hands and pays their sum", async () => {
    // 8+8 against 9+7: the left hand draws a 3 (11), the right one a K (18); the dealer draws a
    // 2 to 18. Left loses, right pushes.
    const api = createMockApiClient({ blackjackShoes: [shoe("8", "9", "8", "7", "3", "K", "2")] });
    const { hand } = await start(api);
    expect(hand).toMatchObject({ canSplit: true });

    const split = await api.playBlackjackAction({ handId: hand.handId, action: "split", index: 0 });
    expect(split.hand).toMatchObject({ status: "player_turn", activeHand: 0, canSplit: false });
    expect(split.hand.playerHands.map((h) => h.cards.length)).toEqual([2, 1]);
    expect(split.balance).toBe("98000");
    expect(
      await api.playBlackjackAction({ handId: hand.handId, action: "split", index: 0 }),
    ).toEqual(split);

    const right = await api.playBlackjackAction({ handId: hand.handId, action: "stand", index: 1 });
    expect(right.hand).toMatchObject({ activeHand: 1 });
    const res = await api.playBlackjackAction({ handId: hand.handId, action: "stand", index: 2 });
    if (res.hand.status !== "settled") throw new Error("expected a settled round");
    expect(res.hand.playerHands.map((h) => [h.outcome, h.payout])).toEqual([
      ["lose", "0"],
      ["push", "1000"],
    ]);
    expect(res.hand).toMatchObject({ totalStake: "2000", payout: "1000" });
    expect(res.balance).toBe("99000");
  });

  it("refuses to split without the funds", async () => {
    const api = createMockApiClient({
      startingBalance: 1500n,
      blackjackShoes: [shoe("8", "9", "8", "7")],
    });
    const { hand } = await start(api);
    await expect(
      api.playBlackjackAction({ handId: hand.handId, action: "split", index: 0 }),
    ).rejects.toMatchObject({ code: "insufficient_funds", status: 422 });
    expect((await api.getCurrentBlackjackHand()).hand).toEqual(hand);
  });

  it("refuses to double without the funds and leaves the hand as it was", async () => {
    const api = createMockApiClient({ startingBalance: 1500n, blackjackShoes: [ELEVEN] });
    const { hand } = await start(api);
    await expect(
      api.playBlackjackAction({ handId: hand.handId, action: "double", index: 0 }),
    ).rejects.toMatchObject({ code: "insufficient_funds", status: 422 });
    expect((await api.getCurrentBlackjackHand()).hand).toEqual(hand);
    expect(await balanceOf(api)).toBe(500n);
  });

  it("answers 404 for an unknown hand and 409 after the hand is settled", async () => {
    const api = createMockApiClient({ blackjackShoes: [OPEN] });
    await expect(
      api.playBlackjackAction({ handId: crypto.randomUUID(), action: "hit", index: 0 }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });

    const { hand } = await start(api);
    await api.playBlackjackAction({ handId: hand.handId, action: "stand", index: 0 });
    await expect(
      api.playBlackjackAction({ handId: hand.handId, action: "hit", index: 1 }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("deals the next hand from the same shoe, right after the cards of the one before", async () => {
    const api = createMockApiClient();
    const first = blackjackStartResponseSchema.parse(await start(api));
    const settled =
      first.hand.status === "player_turn"
        ? await api.playBlackjackAction({ handId: first.hand.handId, action: "stand", index: 0 })
        : first;
    const second = await start(api);
    // One shoe, one nonce; the second hand starts where the first one stopped.
    expect(second.hand.fairness.nonce).toBe(first.hand.fairness.nonce);
    expect(second.hand.fairness.shoeId).toBe(first.hand.fairness.shoeId);
    expect(second.hand.fairness.cardOffset).toBe(settled.shoe?.cardsDealt);
  });

  it("finishes the shoe at the cut card and opens a new one for the next hand", async () => {
    const api = createMockApiClient({ blackjackShoeDealt: 233 });
    const first = await start(api);
    expect(first.hand.fairness.cardOffset).toBe(233);
    const settled =
      first.hand.status === "player_turn"
        ? await api.playBlackjackAction({ handId: first.hand.handId, action: "stand", index: 0 })
        : first;
    expect(settled.shoe).toMatchObject({ reshuffle: true });
    expect((await api.getCurrentBlackjackHand()).shoe).toBeNull();

    const next = await start(api);
    expect(next.hand.fairness.shoeId).not.toBe(first.hand.fairness.shoeId);
    expect(next.hand.fairness.cardOffset).toBe(0);
    expect(next.hand.fairness.nonce).toBe(first.hand.fairness.nonce + 1);
  });

  it("lists settled hands newest first, up to the limit", async () => {
    const api = createMockApiClient({ blackjackShoes: [OPEN, OPEN, OPEN] });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { hand } = await start(api);
      await api.playBlackjackAction({ handId: hand.handId, action: "stand", index: 0 });
      ids.push(hand.handId);
    }
    const res = blackjackHistoryResponseSchema.parse(await api.listBlackjackHistory({ limit: 2 }));
    expect(res.hands.map((h) => h.handId)).toEqual(ids.slice(1).reverse());
    expect((await api.listBlackjackHistory()).hands).toHaveLength(3);
    await expect(api.listBlackjackHistory({ limit: 21 })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});

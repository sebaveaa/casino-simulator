import {
  type ChickenRoadGame,
  chickenRoadCashoutResponseSchema,
  chickenRoadCurrentResponseSchema,
  chickenRoadHistoryResponseSchema,
  chickenRoadPayout,
  chickenRoadStartResponseSchema,
  chickenRoadStepResponseSchema,
  LANE_COUNT,
  seedPairResponseSchema,
} from "@casino/shared";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "./client";
import { createMockApiClient } from "./mock";

const STAKE = "1000";
// Plenty of credits: some tests play many games until the random road fits.
const RICH = 10_000_000n;

const balanceOf = async (api: ApiClient) => BigInt((await api.getBalance()).balance);
const start = (api: ApiClient, key = crypto.randomUUID(), stake = STAKE) =>
  api.startChickenRoadGame({ stake }, key);

/** Steps until the car hits or the game reaches `lanes`; returns the last response. */
async function stepTo(api: ApiClient, gameId: string, lanes: number) {
  let last = await api.stepChickenRoadGame({ gameId, lane: 1 });
  for (let lane = 2; lane <= lanes && last.game.status === "in_progress"; lane++) {
    last = await api.stepChickenRoadGame({ gameId, lane });
  }
  return last;
}

/**
 * Starts games until one survives `lanes` lanes, playing out the others. The mock's seed is
 * random, so the test picks the road instead of fixing it.
 */
async function gameSafeFor(api: ApiClient, lanes: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { game } = await start(api);
    const last = await stepTo(api, game.gameId, lanes);
    if (last.game.status !== "lost") return last.game;
    // Lost: the next attempt starts a fresh game.
  }
  throw new Error("no road survived");
}

function expectNoHitLane(game: ChickenRoadGame) {
  if (game.status === "in_progress") expect(Object.keys(game)).not.toContain("hitLane");
}

describe("mock API client: Chicken Road", () => {
  it("starts a game, charges the stake and shows the active pair's hash", async () => {
    const api = createMockApiClient();
    const pair = seedPairResponseSchema.parse(await api.getSeedPair());
    const res = chickenRoadStartResponseSchema.parse(await start(api));
    expect(res.game).toMatchObject({ status: "in_progress", lanesCrossed: 0, cashoutAmount: "0" });
    expectNoHitLane(res.game);
    expect(res.game.fairness).toMatchObject({
      seedPairId: pair.id,
      serverSeedHash: pair.serverSeedHash,
      clientSeed: pair.clientSeed,
      nonce: pair.nextNonce,
    });
    expect(res.balance).toBe("99000");
    expect((await api.getSeedPair()).nextNonce).toBe(pair.nextNonce + 1);
    expect(chickenRoadCurrentResponseSchema.parse(await api.getCurrentChickenRoadGame())).toEqual({
      game: res.game,
    });
  });

  it("replays a start with the game as it is now and charges once", async () => {
    const api = createMockApiClient({ startingBalance: RICH });
    for (let attempt = 0; attempt < 200; attempt++) {
      const key = crypto.randomUUID();
      const first = await start(api, key);
      const charged = await balanceOf(api);
      expect(await start(api, key)).toEqual(first);

      const one = await api.stepChickenRoadGame({ gameId: first.game.gameId, lane: 1 });
      // Hit on lane 1: the game is over, so try another road.
      if (one.game.status !== "in_progress") continue;

      // A late retry shows the chicken where it is now, not back at the start line.
      const replay = await start(api, key);
      expect(replay.game).toEqual(one.game);
      expect(replay.game.lanesCrossed).toBe(1);
      expect(await balanceOf(api)).toBe(charged);
      await expect(start(api, key, "2000")).rejects.toMatchObject({
        code: "conflict",
        status: 409,
      });
      return;
    }
    throw new Error("no road survived lane 1");
  });

  it("refuses a replayed start once the game finished", async () => {
    const api = createMockApiClient({ startingBalance: RICH });
    const key = crypto.randomUUID();
    const { game } = await start(api, key);
    await stepTo(api, game.gameId, LANE_COUNT);
    const after = await balanceOf(api);
    await expect(start(api, key)).rejects.toMatchObject({ code: "conflict" });
    expect(await balanceOf(api)).toBe(after);
  });

  it("allows one game in progress at a time", async () => {
    const api = createMockApiClient();
    await start(api);
    await expect(start(api)).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(await balanceOf(api)).toBe(99000n);
  });

  it("refuses an invalid stake and a stake above the balance", async () => {
    const api = createMockApiClient({ startingBalance: 999n });
    for (const stake of ["999", "50001", "10.5", "abc"]) {
      await expect(start(api, crypto.randomUUID(), stake)).rejects.toMatchObject({
        code: "invalid_request",
        status: 400,
      });
    }
    await expect(start(api)).rejects.toMatchObject({ code: "insufficient_funds", status: 422 });
    expect(await balanceOf(api)).toBe(999n);
    expect((await api.getSeedPair()).nextNonce).toBe(0);
    expect((await api.getCurrentChickenRoadGame()).game).toBeNull();
  });

  it("steps lane by lane, replays a lane already played and refuses a skipped one", async () => {
    const api = createMockApiClient({ startingBalance: RICH });
    const game = await gameSafeFor(api, 1);
    expect(game).toMatchObject({
      status: "in_progress",
      lanesCrossed: 1,
      cashoutAmount: chickenRoadPayout(1000n, 1).toString(),
    });
    expectNoHitLane(game);
    const replay = chickenRoadStepResponseSchema.parse(
      await api.stepChickenRoadGame({ gameId: game.gameId, lane: 1 }),
    );
    expect(replay.game).toEqual(game);
    await expect(api.stepChickenRoadGame({ gameId: game.gameId, lane: 3 })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      api.stepChickenRoadGame({ gameId: crypto.randomUUID(), lane: 1 }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("loses the stake on a hit and refuses any later step or cash-out", async () => {
    const api = createMockApiClient({ startingBalance: RICH });
    for (let attempt = 0; attempt < 200; attempt++) {
      const { game } = await start(api);
      const before = await balanceOf(api);
      const last = await stepTo(api, game.gameId, LANE_COUNT);
      if (last.game.status !== "lost") continue;

      const { hitLane, lanesCrossed } = last.game;
      expect(lanesCrossed).toBe(hitLane - 1);
      expect(last.game.payout).toBe("0");
      expect(await balanceOf(api)).toBe(before);
      expect(await api.stepChickenRoadGame({ gameId: game.gameId, lane: hitLane })).toEqual(last);
      if (hitLane < LANE_COUNT) {
        await expect(
          api.stepChickenRoadGame({ gameId: game.gameId, lane: hitLane + 1 }),
        ).rejects.toMatchObject({ code: "conflict" });
      }
      await expect(api.cashOutChickenRoadGame({ gameId: game.gameId })).rejects.toMatchObject({
        code: "conflict",
      });
      return;
    }
    throw new Error("no game was lost");
  });

  it("cashes out once and pays the lanes crossed", async () => {
    const api = createMockApiClient({ startingBalance: RICH });
    const game = await gameSafeFor(api, 2);
    const before = await balanceOf(api);
    const res = chickenRoadCashoutResponseSchema.parse(
      await api.cashOutChickenRoadGame({ gameId: game.gameId }),
    );
    const payout = chickenRoadPayout(1000n, 2);
    expect(res.game).toMatchObject({ status: "cashed_out", lanesCrossed: 2 });
    expect(res.game.payout).toBe(payout.toString());
    expect(await balanceOf(api)).toBe(before + payout);

    expect(await api.cashOutChickenRoadGame({ gameId: game.gameId })).toEqual(res);
    expect(await balanceOf(api)).toBe(before + payout);
    const payouts = (await api.listTransactions({ limit: 100 })).items.filter(
      (t) => t.type === "payout" && t.betId === game.gameId,
    );
    expect(payouts).toHaveLength(1);
  });

  it("refuses a cash-out before the first lane", async () => {
    const api = createMockApiClient();
    const { game } = await start(api);
    await expect(api.cashOutChickenRoadGame({ gameId: game.gameId })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("pays automatically on reaching the goal", async () => {
    const api = createMockApiClient({ startingBalance: RICH });
    for (let attempt = 0; attempt < 200; attempt++) {
      const { game } = await start(api);
      const before = await balanceOf(api);
      const last = await stepTo(api, game.gameId, LANE_COUNT);
      if (last.game.status !== "completed") continue;

      const payout = chickenRoadPayout(1000n, LANE_COUNT);
      expect(last.game).toMatchObject({ lanesCrossed: LANE_COUNT, payout: payout.toString() });
      expect(last.balance).toBe((before + payout).toString());
      expect(await api.cashOutChickenRoadGame({ gameId: game.gameId })).toEqual(last);
      expect(await balanceOf(api)).toBe(before + payout);
      expect((await api.getCurrentChickenRoadGame()).game).toBeNull();
      return;
    }
    throw new Error("no game reached the goal");
  });

  it("lists finished games newest first, up to the limit", async () => {
    const api = createMockApiClient({ startingBalance: RICH });
    const finished: string[] = [];
    for (let i = 0; i < 7; i++) {
      const { game } = await start(api);
      await stepTo(api, game.gameId, LANE_COUNT);
      finished.push(game.gameId);
    }
    await start(api); // in progress: not history

    const latest = chickenRoadHistoryResponseSchema.parse(await api.listChickenRoadHistory());
    expect(latest.games.map((g) => g.gameId)).toEqual(finished.slice(-5).reverse());
    const all = await api.listChickenRoadHistory({ limit: 20 });
    expect(all.games.map((g) => g.gameId)).toEqual([...finished].reverse());
    for (const limit of [0, 21]) {
      await expect(api.listChickenRoadHistory({ limit })).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
  });
});

import { randomUUID } from "node:crypto";
import {
  type ChickenRoadResult,
  chickenRoad,
  chickenRoadCashoutResponseSchema,
  chickenRoadFinishedGameSchema,
  chickenRoadPayout,
  chickenRoadStartResponseSchema,
  chickenRoadStepResponseSchema,
  computeOutcome,
  createRng,
  LANE_COUNT,
} from "@casino/shared";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../../db/database";
import { postgresTypes } from "../../platform/postgres";
import { postgresSeedPairService as seedPairs } from "../../rng/postgres-seed-pair-service";
import { postgresWalletService as wallet } from "../../wallet/postgres-wallet-service";
import { InsufficientFundsError, scopedKey } from "../../wallet/wallet-service";
import { CHICKEN_ROAD_ABANDON_MS, settleExpiredGame } from "./expiry";
import { cashOutChickenRoadGame, startChickenRoadGame, stepChickenRoadGame } from "./game";
import { getCurrentChickenRoadGame, listChickenRoadHistory } from "./view";

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). The
// ledger is append-only, so every test creates its own user instead of cleaning up.
describe.skipIf(!process.env.TEST_DATABASE_URL)("Chicken Road games", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const STAKE = 1000n;
  const FUNDS = 1_000_000n;

  async function createPlayer(balance = FUNDS): Promise<string> {
    const user = await db
      .insertInto("users")
      .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await wallet.createPlayerWallet(db, user.id);
    if (balance > 0n) {
      await db.transaction().execute((trx) =>
        wallet.transfer(trx, {
          from: "issuance",
          to: { userId: user.id },
          amount: balance,
          type: "deposit",
          idempotencyKey: scopedKey("deposit", user.id, randomUUID()),
        }),
      );
    }
    return user.id;
  }

  const start = (userId: string, key = randomUUID(), stake = STAKE) =>
    db
      .transaction()
      .execute((trx) =>
        startChickenRoadGame(trx, { wallet, seedPairs }, { userId, idempotencyKey: key, stake }),
      );
  const step = (userId: string, gameId: string, lane: number) =>
    db
      .transaction()
      .execute((trx) => stepChickenRoadGame(trx, { wallet }, { userId, gameId, lane }));
  const cashOut = (userId: string, gameId: string) =>
    db.transaction().execute((trx) => cashOutChickenRoadGame(trx, { wallet }, { userId, gameId }));
  const settleExpired = (userId: string) =>
    db.transaction().execute((trx) => settleExpiredGame(trx, { wallet }, userId));

  /** The road computed apart from the code under test, from the stored seed. */
  async function roadOf(gameId: string): Promise<ChickenRoadResult> {
    const row = await db
      .selectFrom("bets as b")
      .innerJoin("seed_pairs as s", "s.id", "b.seed_pair_id")
      .select(["b.nonce", "s.server_seed", "s.client_seed"])
      .where("b.id", "=", gameId)
      .executeTakeFirstOrThrow();
    const outcome = await computeOutcome({
      serverSeed: row.server_seed,
      clientSeed: row.client_seed,
      nonce: row.nonce ?? -1,
    });
    return chickenRoad.resolve({ stake: STAKE, cashOutAt: LANE_COUNT }, createRng(outcome));
  }

  /** Plays a game out: steps until the car hits or the goal pays. */
  async function playOut(userId: string, gameId: string): Promise<void> {
    for (let lane = 1; lane <= LANE_COUNT; lane++) {
      const { game } = await step(userId, gameId, lane);
      if (game.status !== "in_progress") return;
    }
  }

  /**
   * Starts games until one has a road that fits: seeds are random, so the test picks the road
   * instead of hard-coding a seed. Games that do not fit are played out.
   */
  async function startWithRoad(userId: string, fits: (road: ChickenRoadResult) => boolean) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const key = randomUUID();
      const res = await start(userId, key);
      const road = await roadOf(res.game.gameId);
      if (fits(road)) return { ...res, key, road };
      await playOut(userId, res.game.gameId);
    }
    throw new Error("no road fit in 60 games");
  }

  const safeFor = (lanes: number) => (road: ChickenRoadResult) =>
    road.hitLane === null || road.hitLane > lanes;

  async function payoutCount(gameId: string): Promise<number> {
    const rows = await db
      .selectFrom("transactions")
      .select("id")
      .where("bet_id", "=", gameId)
      .where("type", "=", "payout")
      .execute();
    return rows.length;
  }

  /** The cached balance equals the sum of the player's ledger entries. */
  async function expectLedgerMatches(userId: string): Promise<void> {
    const { sum } = await db
      .selectFrom("ledger_entries as e")
      .innerJoin("wallets as w", "w.id", "e.wallet_id")
      .select(sql<string>`coalesce(sum(e.amount), 0)::text`.as("sum"))
      .where("w.user_id", "=", userId)
      .executeTakeFirstOrThrow();
    expect(BigInt(sum)).toBe(await wallet.getBalance(db, userId));
  }

  /** Moves the game's start and every lane timestamp `ms` into the past. */
  async function age(gameId: string, ms: number): Promise<void> {
    const row = await db
      .selectFrom("bets")
      .select(["created_at", "actions"])
      .where("id", "=", gameId)
      .executeTakeFirstOrThrow();
    const actions = (row.actions as { lane: number; at: string }[]).map((a) => ({
      lane: a.lane,
      at: new Date(new Date(a.at).getTime() - ms).toISOString(),
    }));
    // Raw SQL: the schema types forbid updating `created_at`, which only tests rewrite.
    await sql`update bets set created_at = ${new Date(row.created_at.getTime() - ms)},
      actions = ${JSON.stringify(actions)}::jsonb where id = ${gameId}`.execute(db);
  }

  describe("start", () => {
    it("charges the stake and opens a game at the start line", async () => {
      const userId = await createPlayer();
      const res = await start(userId);
      expect(chickenRoadStartResponseSchema.parse(res)).toEqual(res);
      expect(res.game).toMatchObject({ status: "in_progress", lanesCrossed: 0, stake: "1000" });
      expect(res.game.cashoutAmount).toBe("0");
      expect(res.balance).toBe((FUNDS - STAKE).toString());

      const stored = await db
        .selectFrom("bets")
        .select(["status", "stake", "payout", "result", "nonce", "seed_pair_id"])
        .where("id", "=", res.game.gameId)
        .executeTakeFirstOrThrow();
      expect(stored).toMatchObject({ status: "in_progress", stake: STAKE, payout: null });
      // The road is not stored while the game runs (README §4.4).
      expect(stored.result).toBeNull();
      expect(stored.nonce).toBe(res.game.fairness.nonce);
      expect(stored.seed_pair_id).toBe(res.game.fairness.seedPairId);
      await expectLedgerMatches(userId);
    });

    it("replays a retried start with the current state of the game and charges once", async () => {
      const userId = await createPlayer();
      const first = await startWithRoad(userId, safeFor(2));
      const balanceAfterStart = await wallet.getBalance(db, userId);

      const again = await start(userId, first.key);
      expect(again).toEqual({ game: first.game, balance: balanceAfterStart.toString() });

      await step(userId, first.game.gameId, 1);
      await step(userId, first.game.gameId, 2);
      const late = await start(userId, first.key);
      expect(late.game).toMatchObject({ gameId: first.game.gameId, lanesCrossed: 2 });
      expect(await wallet.getBalance(db, userId)).toBe(balanceAfterStart);

      // Another stake under the same key is a client bug.
      await expect(start(userId, first.key, 2000n)).rejects.toMatchObject({ code: "conflict" });

      // Once the game is over, the start response cannot carry it.
      await cashOut(userId, first.game.gameId);
      const paid = await wallet.getBalance(db, userId);
      await expect(start(userId, first.key)).rejects.toMatchObject({ code: "conflict" });
      expect(await wallet.getBalance(db, userId)).toBe(paid);
    });

    it("allows one game in progress per player", async () => {
      const userId = await createPlayer();
      await start(userId);
      await expect(start(userId)).rejects.toMatchObject({ code: "conflict" });
      const games = await db
        .selectFrom("bets")
        .select("id")
        .where("user_id", "=", userId)
        .execute();
      expect(games).toHaveLength(1);
    });

    it("refuses a stake above the balance without burning a nonce", async () => {
      const userId = await createPlayer(STAKE - 1n);
      const before = await seedPairs.getActive(db, userId);
      await expect(start(userId)).rejects.toBeInstanceOf(InsufficientFundsError);
      expect((await seedPairs.getActive(db, userId)).nextNonce).toBe(before.nextNonce);
      const games = await db
        .selectFrom("bets")
        .select("id")
        .where("user_id", "=", userId)
        .execute();
      expect(games).toHaveLength(0);
      expect(await wallet.getBalance(db, userId)).toBe(STAKE - 1n);
    });
  });

  describe("step", () => {
    it("crosses lanes as the road says and replays a lane already played", async () => {
      const userId = await createPlayer();
      const { game } = await startWithRoad(userId, safeFor(2));

      const one = await step(userId, game.gameId, 1);
      expect(chickenRoadStepResponseSchema.parse(one)).toEqual(one);
      expect(one.game).toMatchObject({
        status: "in_progress",
        lanesCrossed: 1,
        cashoutAmount: chickenRoadPayout(STAKE, 1).toString(),
      });
      expect(await step(userId, game.gameId, 1)).toEqual(one);

      const two = await step(userId, game.gameId, 2);
      expect(two.game).toMatchObject({ lanesCrossed: 2 });
      // A lane replayed after the game moved on returns the game as it is now.
      expect(await step(userId, game.gameId, 1)).toEqual(two);
      await expect(step(userId, game.gameId, 4)).rejects.toMatchObject({ code: "conflict" });
    });

    it("loses the stake on the hit lane and refuses any later step", async () => {
      const userId = await createPlayer();
      const { game, road } = await startWithRoad(userId, (r) => r.hitLane !== null);
      const hitLane = road.hitLane ?? 0;
      let last = await step(userId, game.gameId, 1);
      for (let lane = 2; lane <= hitLane; lane++) last = await step(userId, game.gameId, lane);

      expect(last.game).toEqual({
        status: "lost",
        gameId: game.gameId,
        stake: "1000",
        fairness: game.fairness,
        lanesCrossed: hitLane - 1,
        hitLane,
        payout: "0",
      });
      expect(await step(userId, game.gameId, hitLane)).toEqual(last);
      if (hitLane < LANE_COUNT) {
        await expect(step(userId, game.gameId, hitLane + 1)).rejects.toMatchObject({
          code: "conflict",
        });
      }
      await expect(cashOut(userId, game.gameId)).rejects.toMatchObject({ code: "conflict" });

      const stored = await db
        .selectFrom("bets")
        .select(["status", "payout", "result", "settled_at"])
        .where("id", "=", game.gameId)
        .executeTakeFirstOrThrow();
      expect(stored).toMatchObject({ status: "settled", payout: 0n, result: road });
      expect(stored.settled_at).not.toBeNull();
      expect(await payoutCount(game.gameId)).toBe(0);
      await expectLedgerMatches(userId);
    });

    it("cashes out automatically on reaching the goal", async () => {
      const userId = await createPlayer();
      const { game } = await startWithRoad(userId, (r) => r.hitLane === null);
      const before = await wallet.getBalance(db, userId);
      let last = await step(userId, game.gameId, 1);
      for (let lane = 2; lane <= LANE_COUNT; lane++) last = await step(userId, game.gameId, lane);

      const payout = chickenRoadPayout(STAKE, LANE_COUNT);
      expect(last.game).toMatchObject({
        status: "completed",
        lanesCrossed: LANE_COUNT,
        payout: payout.toString(),
      });
      expect(last.balance).toBe((before + payout).toString());
      // A cash-out after the goal returns the paid game and pays nothing more.
      const again = await cashOut(userId, game.gameId);
      expect(again.game).toEqual(last.game);
      expect(await payoutCount(game.gameId)).toBe(1);
      await expectLedgerMatches(userId);
    });

    it("runs two concurrent steps on one lane once", async () => {
      const userId = await createPlayer();
      const { game } = await startWithRoad(userId, safeFor(1));
      const [a, b] = await Promise.all([
        step(userId, game.gameId, 1),
        step(userId, game.gameId, 1),
      ]);
      expect(a).toEqual(b);
      expect(a.game).toMatchObject({ status: "in_progress", lanesCrossed: 1 });
      const stored = await db
        .selectFrom("bets")
        .select("actions")
        .where("id", "=", game.gameId)
        .executeTakeFirstOrThrow();
      expect(stored.actions).toHaveLength(1);
    });

    it("does not find another player's game", async () => {
      const owner = await createPlayer();
      const other = await createPlayer();
      const { game } = await start(owner);
      await expect(step(other, game.gameId, 1)).rejects.toMatchObject({ code: "not_found" });
      await expect(cashOut(other, game.gameId)).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("cash out", () => {
    it("pays the lanes crossed once, even when asked twice", async () => {
      const userId = await createPlayer();
      const { game } = await startWithRoad(userId, safeFor(2));
      await step(userId, game.gameId, 1);
      await step(userId, game.gameId, 2);
      const before = await wallet.getBalance(db, userId);

      const res = await cashOut(userId, game.gameId);
      expect(chickenRoadCashoutResponseSchema.parse(res)).toEqual(res);
      const payout = chickenRoadPayout(STAKE, 2);
      expect(res.game).toMatchObject({
        status: "cashed_out",
        lanesCrossed: 2,
        payout: payout.toString(),
      });
      expect(res.balance).toBe((before + payout).toString());

      expect(await cashOut(userId, game.gameId)).toEqual(res);
      await expect(step(userId, game.gameId, 3)).rejects.toMatchObject({ code: "conflict" });
      expect(await payoutCount(game.gameId)).toBe(1);
      await expectLedgerMatches(userId);
    });

    it("pays once when two cash-outs race", async () => {
      const userId = await createPlayer();
      const { game } = await startWithRoad(userId, safeFor(1));
      await step(userId, game.gameId, 1);
      const before = await wallet.getBalance(db, userId);

      const [a, b] = await Promise.all([
        cashOut(userId, game.gameId),
        cashOut(userId, game.gameId),
      ]);
      expect(a).toEqual(b);
      expect(await payoutCount(game.gameId)).toBe(1);
      expect(await wallet.getBalance(db, userId)).toBe(before + chickenRoadPayout(STAKE, 1));
      await expectLedgerMatches(userId);
    });

    it("refuses a cash-out before the first lane", async () => {
      const userId = await createPlayer();
      const { game } = await start(userId);
      await expect(cashOut(userId, game.gameId)).rejects.toMatchObject({ code: "conflict" });
    });
  });

  describe("abandonment", () => {
    it("cashes out an abandoned game with lanes crossed", async () => {
      const userId = await createPlayer();
      const { game } = await startWithRoad(userId, safeFor(2));
      await step(userId, game.gameId, 1);
      await step(userId, game.gameId, 2);
      const before = await wallet.getBalance(db, userId);

      // The clock starts at the last lane: just under the limit nothing happens.
      await age(game.gameId, CHICKEN_ROAD_ABANDON_MS - 60_000);
      expect(await settleExpired(userId)).toBe(false);
      expect(await getCurrentChickenRoadGame(db, userId)).toMatchObject({ lanesCrossed: 2 });

      await age(game.gameId, 120_000);
      expect(await settleExpired(userId)).toBe(true);
      const payout = chickenRoadPayout(STAKE, 2);
      expect(await wallet.getBalance(db, userId)).toBe(before + payout);
      expect(await getCurrentChickenRoadGame(db, userId)).toBeNull();
      // Looked up by id: `age` moved its start back, so games `startWithRoad` played out earlier
      // now sort as newer.
      const history = await listChickenRoadHistory(db, userId, 20);
      const latest = history.find((g) => g.gameId === game.gameId);
      expect(latest).toMatchObject({
        status: "cashed_out",
        gameId: game.gameId,
        payout: payout.toString(),
      });
      // A late cash-out returns the settled game and pays nothing more.
      expect((await cashOut(userId, game.gameId)).game).toEqual(latest);
      expect(await payoutCount(game.gameId)).toBe(1);
      expect(await settleExpired(userId)).toBe(false);
      await expectLedgerMatches(userId);
    });

    it("refunds an abandoned game with no lanes crossed and leaves it out of history", async () => {
      const userId = await createPlayer();
      const { game } = await start(userId);
      await age(game.gameId, CHICKEN_ROAD_ABANDON_MS + 1000);

      expect(await settleExpired(userId)).toBe(true);
      expect(await wallet.getBalance(db, userId)).toBe(FUNDS);
      expect(await getCurrentChickenRoadGame(db, userId)).toBeNull();
      expect(await listChickenRoadHistory(db, userId, 5)).toEqual([]);
      await expect(step(userId, game.gameId, 1)).rejects.toMatchObject({
        code: "conflict",
        message: "The game expired and the stake was refunded",
      });
      await expect(cashOut(userId, game.gameId)).rejects.toMatchObject({ code: "conflict" });
      // The refund is a payout of the stake under the game's single payout key.
      expect(await payoutCount(game.gameId)).toBe(1);
      // The player can start again.
      await start(userId);
      await expectLedgerMatches(userId);
    });
  });

  describe("history", () => {
    it("lists finished games newest first, up to the limit", async () => {
      const userId = await createPlayer();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { game } = await startWithRoad(userId, safeFor(1));
        await step(userId, game.gameId, 1);
        await cashOut(userId, game.gameId);
        ids.push(game.gameId);
      }
      // A game still in progress is not history.
      await start(userId);

      const games = await listChickenRoadHistory(db, userId, 20);
      // `startWithRoad` may have played out extra games; the three cashed out come newest first.
      const cashed = games.filter((g) => ids.includes(g.gameId)).map((g) => g.gameId);
      expect(cashed).toEqual([...ids].reverse());
      expect(games[0]?.gameId).toBe(ids[2]);
      for (const g of games) expect(chickenRoadFinishedGameSchema.parse(g)).toEqual(g);

      const two = await listChickenRoadHistory(db, userId, 2);
      expect(two.map((g) => g.gameId)).toEqual(games.slice(0, 2).map((g) => g.gameId));
    });
  });
});

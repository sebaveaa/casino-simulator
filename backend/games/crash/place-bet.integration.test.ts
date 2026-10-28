import { randomUUID } from "node:crypto";
import { crashBetResponseSchema } from "@casino/shared";
import type { Transaction } from "kysely";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../../db/database";
import type { Database } from "../../db/schema";
import { postgresTypes } from "../../platform/postgres";
import { postgresWalletService as wallet } from "../../wallet/postgres-wallet-service";
import { InsufficientFundsError, scopedKey } from "../../wallet/wallet-service";
import { placeCrashBet } from "./place-bet";

class Rollback extends Error {}

const game = "dino-crash";
const limits = { min: 1000n, max: 50000n };

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). Each test runs
// inside a transaction that is rolled back, so the shared database stays clean.
describe.skipIf(!process.env.TEST_DATABASE_URL)("placeCrashBet", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });

  afterEach(async () => {});
  afterAll(async () => {
    await db.destroy();
  });

  async function rolledBack(fn: (trx: Transaction<Database>) => Promise<void>): Promise<void> {
    await db
      .transaction()
      .execute(async (trx) => {
        await fn(trx);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  }

  async function createPlayer(trx: Db, balance = 0n): Promise<string> {
    const user = await trx
      .insertInto("users")
      .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await wallet.createPlayerWallet(trx, user.id);
    if (balance > 0n) {
      await wallet.transfer(trx, {
        from: "issuance",
        to: { userId: user.id },
        amount: balance,
        type: "deposit",
        idempotencyKey: scopedKey("deposit", user.id, randomUUID()),
      });
    }
    return user.id;
  }

  async function createRound(
    trx: Db,
    opts: { status?: "open" | "closed"; opensInMs?: number; closesInMs?: number } = {},
  ): Promise<string> {
    const { status = "open", opensInMs = -60_000, closesInMs = 60_000 } = opts;
    const round = await trx
      .insertInto("game_rounds")
      .values({
        game,
        status,
        server_seed: "seed",
        server_seed_hash: "hash",
        opens_at: new Date(Date.now() + opensInMs),
        closes_at: new Date(Date.now() + closesInMs),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return round.id;
  }

  const place = (
    trx: Db,
    input: { userId: string; roundId: string; stake?: bigint; key?: string },
  ) =>
    placeCrashBet(
      trx,
      { wallet },
      {
        userId: input.userId,
        idempotencyKey: input.key ?? randomUUID(),
        roundId: input.roundId,
        game,
        stake: input.stake ?? 1000n,
        limits,
      },
    );

  const lockedHouseBalance = async (trx: Db) =>
    (
      await trx
        .selectFrom("wallets")
        .select("balance")
        .where("kind", "=", "house")
        .forUpdate()
        .executeTakeFirstOrThrow()
    ).balance;

  const countBets = async (trx: Db, userId: string) =>
    Number(
      (
        await trx
          .selectFrom("bets")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow()
      ).n,
    );

  it("places a pending bet: the row, the player and the house agree", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 10_000n);
      const roundId = await createRound(trx);
      const houseBefore = await lockedHouseBalance(trx);

      const res = await place(trx, { userId, roundId, stake: 1000n });
      expect(crashBetResponseSchema.parse(res)).toEqual(res);
      expect(res).toMatchObject({ roundId, stake: "1000", balance: "9000" });

      expect(await wallet.getBalance(trx, userId)).toBe(9000n);
      expect(await lockedHouseBalance(trx)).toBe(houseBefore + 1000n);

      const stored = await trx
        .selectFrom("bets")
        .select(["game", "round_id", "seed_pair_id", "nonce", "stake", "selection", "status"])
        .select(["result", "payout"])
        .where("id", "=", res.betId)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({
        game,
        round_id: roundId,
        seed_pair_id: null,
        nonce: null,
        stake: 1000n,
        selection: {},
        status: "pending",
        result: null,
        payout: null,
      });
    });
  });

  it("charges once when the same key is retried, and replays the original body", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 10_000n);
      const roundId = await createRound(trx);
      const key = randomUUID();
      const first = await place(trx, { userId, roundId, key });
      const retry = await place(trx, { userId, roundId, key });
      expect(retry).toEqual(first);
      expect(await countBets(trx, userId)).toBe(1);
      expect(await wallet.getBalance(trx, userId)).toBe(9000n);
    });
  });

  it("refuses a key reused with another stake", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 10_000n);
      const roundId = await createRound(trx);
      const key = randomUUID();
      const first = await place(trx, { userId, roundId, key, stake: 1000n });
      await expect(place(trx, { userId, roundId, key, stake: 2000n })).rejects.toMatchObject({
        code: "conflict",
      });
      expect(await place(trx, { userId, roundId, key })).toEqual(first);
    });
  });

  it("refuses a second bet in the same round under a different key, charging once", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 10_000n);
      const roundId = await createRound(trx);
      await place(trx, { userId, roundId });
      await expect(place(trx, { userId, roundId })).rejects.toMatchObject({ code: "conflict" });
      expect(await countBets(trx, userId)).toBe(1);
      expect(await wallet.getBalance(trx, userId)).toBe(9000n);
    });
  });

  it("rejects a bet on a closed round and past closes_at while still open", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 10_000n);
      const closed = await createRound(trx, { status: "closed" });
      const expired = await createRound(trx, { opensInMs: -60_000, closesInMs: -1000 });
      for (const roundId of [closed, expired]) {
        await expect(place(trx, { userId, roundId })).rejects.toMatchObject({
          code: "invalid_request",
        });
      }
      expect(await wallet.getBalance(trx, userId)).toBe(10_000n);
      expect(await countBets(trx, userId)).toBe(0);
    });
  });

  it("replays an accepted bet after the round has closed", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 10_000n);
      const roundId = await createRound(trx);
      const key = randomUUID();
      const first = await place(trx, { userId, roundId, key });
      await trx
        .updateTable("game_rounds")
        .set({ status: "closed" })
        .where("id", "=", roundId)
        .execute();
      expect(await place(trx, { userId, roundId, key })).toEqual(first);
      expect(await wallet.getBalance(trx, userId)).toBe(9000n);
    });
  });

  it("answers not_found for an unknown round", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 10_000n);
      await expect(place(trx, { userId, roundId: randomUUID() })).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  it("rejects stakes below the minimum or above the maximum", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 100_000n);
      const roundId = await createRound(trx);
      for (const stake of [999n, 50_001n]) {
        await expect(place(trx, { userId, roundId, stake })).rejects.toMatchObject({
          code: "invalid_request",
        });
      }
      expect(await countBets(trx, userId)).toBe(0);
      // The bounds themselves are allowed.
      await place(trx, { userId, roundId, stake: 1000n });
    });
  });

  it("rejects a bet the player cannot afford without a trace", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 500n);
      const roundId = await createRound(trx);
      await expect(place(trx, { userId, roundId, stake: 1000n })).rejects.toBeInstanceOf(
        InsufficientFundsError,
      );
      expect(await wallet.getBalance(trx, userId)).toBe(500n);
      expect(await countBets(trx, userId)).toBe(0);
    });
  });
});

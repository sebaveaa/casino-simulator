import { randomUUID } from "node:crypto";
import { raceBetResponseSchema } from "@casino/shared";
import { sql, type Transaction } from "kysely";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../../db/database";
import type { Database } from "../../db/schema";
import { postgresTypes } from "../../platform/postgres";
import { postgresWalletService as wallet } from "../../wallet/postgres-wallet-service";
import { InsufficientFundsError, scopedKey } from "../../wallet/wallet-service";
import { placeRaceBet } from "./place-bet";

class Rollback extends Error {}

const limits = { min: 10n, max: 500n };

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). Most tests
// run inside a transaction that is rolled back, so the shared database stays clean. The
// concurrency test needs committed rows, which it deletes afterwards.
describe.skipIf(!process.env.TEST_DATABASE_URL)("placeRaceBet", () => {
  let pool: pg.Pool;
  let db: Db;
  const committedUsers: string[] = [];
  const committedRounds: string[] = [];

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });

  afterEach(async () => {
    for (const roundId of committedRounds.splice(0)) {
      await db.deleteFrom("game_rounds").where("id", "=", roundId).execute();
    }
    for (const userId of committedUsers.splice(0)) {
      // A regression could let a bet through; the ledger rows it would leave cannot be deleted.
      await db.deleteFrom("bets").where("user_id", "=", userId).execute();
      await db.deleteFrom("wallets").where("user_id", "=", userId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });

  afterAll(async () => {
    await db.destroy();
  });

  /** Runs `fn` in a transaction and always rolls it back, rethrowing anything else. */
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
        game: "races",
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
    input: { userId: string; roundId: string; animal?: number; stake?: bigint; key?: string },
  ) =>
    placeRaceBet(
      trx,
      { wallet },
      {
        userId: input.userId,
        idempotencyKey: input.key ?? randomUUID(),
        roundId: input.roundId,
        animal: input.animal ?? 2,
        stake: input.stake ?? 100n,
        limits,
      },
    );

  /** Locks the house row: other test files also move money, so an unlocked read could drift. */
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
      const userId = await createPlayer(trx, 1000n);
      const roundId = await createRound(trx);
      const houseBefore = await lockedHouseBalance(trx);

      const res = await place(trx, { userId, roundId, animal: 3, stake: 100n });
      expect(raceBetResponseSchema.parse(res)).toEqual(res);
      expect(res).toMatchObject({ roundId, animal: 3, stake: "100", balance: "900" });

      expect(await wallet.getBalance(trx, userId)).toBe(900n);
      expect(await lockedHouseBalance(trx)).toBe(houseBefore + 100n);

      const stored = await trx
        .selectFrom("bets")
        .select(["game", "round_id", "seed_pair_id", "nonce", "stake", "selection", "status"])
        .select(["result", "payout"])
        .where("id", "=", res.betId)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({
        game: "races",
        round_id: roundId,
        seed_pair_id: null,
        nonce: null,
        stake: 100n,
        selection: { animal: 3 },
        status: "pending",
        result: null,
        payout: null,
      });
    });
  });

  it("charges once when the same key is retried, and replays the original body", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 1000n);
      const roundId = await createRound(trx);
      const key = randomUUID();
      const first = await place(trx, { userId, roundId, key });
      const retry = await place(trx, { userId, roundId, key });
      expect(retry).toEqual(first);
      expect(await countBets(trx, userId)).toBe(1);
      expect(await wallet.getBalance(trx, userId)).toBe(900n);
      const ledger = await trx
        .selectFrom("transactions")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("bet_id", "=", first.betId)
        .executeTakeFirstOrThrow();
      expect(Number(ledger.n)).toBe(1);
    });
  });

  it("refuses a key reused with another animal or stake", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 1000n);
      const roundId = await createRound(trx);
      const key = randomUUID();
      const first = await place(trx, { userId, roundId, key, animal: 2, stake: 100n });
      for (const changed of [{ animal: 4 }, { stake: 200n }]) {
        await expect(place(trx, { userId, roundId, key, ...changed })).rejects.toMatchObject({
          code: "conflict",
        });
      }
      expect(await countBets(trx, userId)).toBe(1);
      expect(await wallet.getBalance(trx, userId)).toBe(900n);
      expect(await place(trx, { userId, roundId, key })).toEqual(first);
    });
  });

  it("refuses a second bet in the same round under a different key, charging once", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 1000n);
      const roundId = await createRound(trx);
      await place(trx, { userId, roundId });
      await expect(place(trx, { userId, roundId })).rejects.toMatchObject({ code: "conflict" });
      expect(await countBets(trx, userId)).toBe(1);
      expect(await wallet.getBalance(trx, userId)).toBe(900n);
    });
  });

  it("rejects a bet on a closed round, balance untouched", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 1000n);
      const roundId = await createRound(trx, { status: "closed" });
      await expect(place(trx, { userId, roundId })).rejects.toMatchObject({
        code: "invalid_request",
      });
      expect(await wallet.getBalance(trx, userId)).toBe(1000n);
      expect(await countBets(trx, userId)).toBe(0);
    });
  });

  it("rejects a bet past closes_at even while the status is still open", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 1000n);
      const roundId = await createRound(trx, { opensInMs: -60_000, closesInMs: -1000 });
      await expect(place(trx, { userId, roundId })).rejects.toMatchObject({
        code: "invalid_request",
      });
      expect(await wallet.getBalance(trx, userId)).toBe(1000n);
      expect(await countBets(trx, userId)).toBe(0);
    });
  });

  it("replays an accepted bet after the round has closed", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 1000n);
      const roundId = await createRound(trx);
      const key = randomUUID();
      const first = await place(trx, { userId, roundId, key });
      await trx
        .updateTable("game_rounds")
        .set({ status: "closed" })
        .where("id", "=", roundId)
        .execute();
      const retry = await place(trx, { userId, roundId, key });
      expect(retry).toEqual(first);
      expect(await wallet.getBalance(trx, userId)).toBe(900n);
      // A new key is still refused.
      await expect(place(trx, { userId, roundId })).rejects.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("answers not_found for an unknown round", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 1000n);
      await expect(place(trx, { userId, roundId: randomUUID() })).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  it("rejects stakes below the minimum or above the maximum", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 10_000n);
      const roundId = await createRound(trx);
      for (const stake of [9n, 501n]) {
        await expect(place(trx, { userId, roundId, stake })).rejects.toMatchObject({
          code: "invalid_request",
        });
      }
      expect(await wallet.getBalance(trx, userId)).toBe(10_000n);
      expect(await countBets(trx, userId)).toBe(0);
      // The bounds themselves are allowed.
      await place(trx, { userId, roundId, stake: 10n });
    });
  });

  it("rejects an animal outside the field", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 1000n);
      const roundId = await createRound(trx);
      await expect(place(trx, { userId, roundId, animal: 5 })).rejects.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("rejects a bet the player cannot afford without a trace", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 50n);
      const roundId = await createRound(trx);
      await expect(place(trx, { userId, roundId, stake: 100n })).rejects.toBeInstanceOf(
        InsufficientFundsError,
      );
      expect(await wallet.getBalance(trx, userId)).toBe(50n);
      expect(await countBets(trx, userId)).toBe(0);
    });
  });

  it("rejects a bet that was waiting on the round lock when the worker closed it", async () => {
    // Committed rows: the two transactions below run on separate connections.
    const userId = await createPlayer(db);
    committedUsers.push(userId);
    const roundId = await createRound(db);
    committedRounds.push(roundId);

    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => {};
    const hasLock = new Promise<void>((resolve) => {
      locked = resolve;
    });

    // The worker: takes FOR UPDATE on the round and closes it, committing only when released.
    const closing = db.transaction().execute(async (trx) => {
      await trx
        .selectFrom("game_rounds")
        .select("id")
        .where("id", "=", roundId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable("game_rounds")
        .set({ status: "closed" })
        .where("id", "=", roundId)
        .execute();
      locked();
      await released;
    });
    await hasLock;

    let settled = false;
    const bet = db
      .transaction()
      .execute((trx) => place(trx, { userId, roundId }))
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        settled = true;
      });

    try {
      // The bet must be stuck on FOR SHARE, not finished.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      const waiting = await sql<{ n: string }>`
        select count(*) as n from pg_stat_activity
        where wait_event_type = 'Lock' and query ilike '%game_rounds%for share%'`.execute(db);
      expect(Number(waiting.rows[0]?.n)).toBeGreaterThanOrEqual(1);
    } finally {
      release();
      await closing.catch(() => {});
    }
    const outcome = await bet;
    // invalid_request, not insufficient_funds: the player is unfunded, so this also shows the
    // round state is checked before the balance.
    expect(outcome).toMatchObject({ error: { code: "invalid_request" } });
    expect(await countBets(db, userId)).toBe(0);
    expect(await wallet.getBalance(db, userId)).toBe(0n);
  });
});

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresTypes } from "../../platform/postgres";
import { createDatabase, type Db } from "../database";
import type { Database } from "../schema";
import * as raceRounds from "./0003_race_rounds";

class Rollback extends Error {}

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). Every test
// runs inside a transaction that is rolled back, so the shared database stays clean.
describe.skipIf(!process.env.TEST_DATABASE_URL)("0003_race_rounds", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
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

  async function fixtures(trx: Transaction<Database>) {
    const user = await trx
      .insertInto("users")
      .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const round = await trx
      .insertInto("game_rounds")
      .values({
        game: "races",
        status: "open",
        server_seed: "seed",
        server_seed_hash: "hash",
        opens_at: new Date(),
        closes_at: new Date(Date.now() + 60_000),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const seedPair = await trx
      .insertInto("seed_pairs")
      .values({ user_id: user.id, server_seed: "seed", server_seed_hash: "hash", client_seed: "c" })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { userId: user.id, roundId: round.id, seedPairId: seedPair.id };
  }

  it("rejects a second bet of the same user on the same round", async () => {
    await rolledBack(async (trx) => {
      const { userId, roundId } = await fixtures(trx);
      const bet = {
        user_id: userId,
        game: "races" as const,
        round_id: roundId,
        stake: 100n,
        selection: { animal: 1 },
        status: "pending" as const,
      };
      await trx.insertInto("bets").values(bet).execute();
      await expect(trx.insertInto("bets").values(bet).execute()).rejects.toMatchObject({
        code: "23505",
        constraint: "bets_round_user_key",
      });
    });
  });

  it("does not constrain bets without a round (roulette-style)", async () => {
    await rolledBack(async (trx) => {
      const { userId, seedPairId } = await fixtures(trx);
      const bet = (nonce: number) => ({
        user_id: userId,
        game: "roulette" as const,
        seed_pair_id: seedPairId,
        nonce,
        stake: 100n,
        selection: { number: 7 },
        status: "pending" as const,
      });
      await trx.insertInto("bets").values(bet(1)).execute();
      await trx.insertInto("bets").values(bet(2)).execute();
    });
  });

  it("is reversible", async () => {
    await rolledBack(async (trx) => {
      const columns = () =>
        sql<{ column_name: string }>`select column_name from information_schema.columns
          where table_name = 'game_rounds' and column_name in ('result', 'resolved_at', 'settled_at')`
          .execute(trx)
          .then((r) => r.rows.map((row) => row.column_name).sort());
      const index = () =>
        sql<{
          indexname: string;
        }>`select indexname from pg_indexes where indexname = 'bets_round_user_key'`
          .execute(trx)
          .then((r) => r.rows.length);

      expect(await columns()).toEqual(["resolved_at", "result", "settled_at"]);
      expect(await index()).toBe(1);

      await raceRounds.down(trx);
      expect(await columns()).toEqual([]);
      expect(await index()).toBe(0);

      await raceRounds.up(trx);
      expect(await columns()).toEqual(["resolved_at", "result", "settled_at"]);
      expect(await index()).toBe(1);
    });
  });
});

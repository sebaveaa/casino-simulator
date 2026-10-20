import { sql, type Transaction } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresTypes } from "../../platform/postgres";
import { createDatabase, type Db } from "../database";
import type { Database } from "../schema";
import * as raceCurrentIndex from "./0004_race_current_index";

class Rollback extends Error {}

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). Every test
// runs inside a transaction that is rolled back, so the shared database stays clean.
describe.skipIf(!process.env.TEST_DATABASE_URL)("0004_race_current_index", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });

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

  it("is reversible", async () => {
    await rolledBack(async (trx) => {
      const index = () =>
        sql<{
          indexname: string;
        }>`select indexname from pg_indexes
          where schemaname = current_schema() and indexname = 'game_rounds_current_idx'`
          .execute(trx)
          .then((r) => r.rows.length);

      expect(await index()).toBe(1);
      await raceCurrentIndex.down(trx);
      expect(await index()).toBe(0);
      await raceCurrentIndex.up(trx);
      expect(await index()).toBe(1);
    });
  });
});

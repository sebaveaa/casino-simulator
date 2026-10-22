import { sql, type Transaction } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresTypes } from "../../platform/postgres";
import { createDatabase, type Db } from "../database";
import type { Database } from "../schema";
import * as raceCurrentIndex from "./0004_race_current_index";
import * as racePartialIndexes from "./0005_race_round_partial_indexes";

class Rollback extends Error {}

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). Every test
// runs inside a transaction that is rolled back, so the shared database stays clean.
describe.skipIf(!process.env.TEST_DATABASE_URL)("0005_race_round_partial_indexes", () => {
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

  const indexNames = (trx: Transaction<Database>) =>
    sql<{ indexname: string }>`select indexname from pg_indexes
      where schemaname = current_schema() and tablename = 'game_rounds'
        and indexname in ('game_rounds_current_idx', 'game_rounds_open_idx', 'game_rounds_settled_idx')
      order by indexname`
      .execute(trx)
      .then((r) => r.rows.map((row) => row.indexname));

  it("is reversible", async () => {
    await rolledBack(async (trx) => {
      expect(await indexNames(trx)).toEqual(["game_rounds_open_idx", "game_rounds_settled_idx"]);
      await racePartialIndexes.down(trx);
      expect(await indexNames(trx)).toEqual(["game_rounds_current_idx"]);
      await racePartialIndexes.up(trx);
      expect(await indexNames(trx)).toEqual(["game_rounds_open_idx", "game_rounds_settled_idx"]);
    });
  });

  it("keeps 0004 reversible on top of it", async () => {
    await rolledBack(async (trx) => {
      await racePartialIndexes.down(trx);
      await raceCurrentIndex.down(trx);
      expect(await indexNames(trx)).toEqual([]);
      await raceCurrentIndex.up(trx);
      await racePartialIndexes.up(trx);
      expect(await indexNames(trx)).toEqual(["game_rounds_open_idx", "game_rounds_settled_idx"]);
    });
  });

  /** Many settled rounds, a few unsettled ones, all of one game, so a scan cannot win by size. */
  async function seedRounds(trx: Transaction<Database>) {
    await sql`insert into game_rounds (game, status, server_seed, server_seed_hash, opens_at, closes_at, resolved_at, settled_at)
      select 'races', 'settled', 's', 'h',
             now() - make_interval(mins => n + 10), now() - make_interval(mins => n + 9),
             now() - make_interval(mins => n + 8), now() - make_interval(mins => n + 7)
      from generate_series(1, 400) as n`.execute(trx);
    await sql`insert into game_rounds (game, status, server_seed, server_seed_hash, opens_at, closes_at)
      select 'races', 'open', 's', 'h', now() + make_interval(secs => n), now() + make_interval(mins => 1, secs => n)
      from generate_series(1, 3) as n`.execute(trx);
    await sql`analyze game_rounds`.execute(trx);
    // Force the planner onto indexes when it can use them: a plan that still scans or sorts is then
    // a real failure of the index, not a cost estimate on a tiny table.
    await sql`set local enable_seqscan = off`.execute(trx);
    await sql`set local enable_bitmapscan = off`.execute(trx);
  }

  async function plan(trx: Transaction<Database>, query: ReturnType<typeof sql>) {
    const result = await sql<{ "QUERY PLAN": string }>`explain ${query}`.execute(trx);
    return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
  }

  // The statements below are the ones in games/races/rounds.ts and worker/race-cycle.ts.
  it("serves the newest unsettled round from the open index, with no sort", async () => {
    await rolledBack(async (trx) => {
      await seedRounds(trx);
      const text = await plan(
        trx,
        sql`select id from game_rounds where game = 'races' and status <> 'settled'
          order by opens_at desc limit 1`,
      );
      expect(text).toContain("game_rounds_open_idx");
      expect(text).not.toMatch(/Sort/);
    });
  });

  it("serves the latest settled round of the intermission from the settled index, with no sort", async () => {
    await rolledBack(async (trx) => {
      await seedRounds(trx);
      const text = await plan(
        trx,
        sql`select id from game_rounds where game = 'races' and status = 'settled'
          and settled_at > now() - (60000::double precision * interval '1 millisecond')
          order by settled_at desc limit 1`,
      );
      expect(text).toContain("game_rounds_settled_idx");
      expect(text).not.toMatch(/Sort/);
    });
  });

  it("serves the worker's latest-settlement lookup from the settled index, with no sort", async () => {
    await rolledBack(async (trx) => {
      await seedRounds(trx);
      const text = await plan(
        trx,
        sql`select settled_at from game_rounds where game = 'races' and status = 'settled'
          order by settled_at desc limit 1`,
      );
      expect(text).toContain("game_rounds_settled_idx");
      expect(text).not.toMatch(/Sort/);
    });
  });
});

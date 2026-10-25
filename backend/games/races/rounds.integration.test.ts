import { randomUUID } from "node:crypto";
import {
  apiPaths,
  currentRaceResponseSchema,
  type RaceResult,
  raceRoundSchema,
} from "@casino/shared";
import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../../auth/token-service";
import { createDatabase, type Db } from "../../db/database";
import type { Database, RoundStatus } from "../../db/schema";
import { buildApp } from "../../platform/app";
import { postgresTypes } from "../../platform/postgres";
import { stubServices } from "../../platform/services";
import { getCurrentRound, getPlayerBet, getRound } from "./rounds";

class Rollback extends Error {}

const raceDurationMs = 10_000;
const raceIntermissionMs = 8000;
const config = {
  appEnv: "production" as const,
  allowedOrigins: [],
  raceDurationMs,
  raceIntermissionMs,
  raceMinStake: 1n,
  raceMaxStake: 1000n,
};
const result: RaceResult = { winner: 3, order: [3, 0, 1, 4, 2] };
const SECRET_SEED = "secret-seed-value";
const YEAR_MS = 365 * 24 * 3600 * 1000;

// Runs against a migrated database (see AGENTS.md), shared with other test files. Tests that
// need to know which round is "current" run in a rolled-back transaction where `game_rounds`
// is shadowed by an empty temp table, so other files' rows cannot interfere. The HTTP
// tests commit their rows, which are cleaned up afterwards, and either fetch rounds by id or
// pin the current round by opening it a year ahead, which makes it the latest one.
describe.skipIf(!process.env.TEST_DATABASE_URL)("race round queries and routes", () => {
  let pool: pg.Pool;
  let db: Db;
  let app: FastifyInstance;
  const players: string[] = [];
  const rounds: string[] = [];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
    const tokens: TokenService = {
      sign: async () => "token",
      verify: async (token): Promise<AuthUser> => {
        if (!players.includes(token)) throw new InvalidTokenError();
        return { id: token, role: "player" };
      },
    };
    app = await buildApp({
      config,
      checks: { postgres: async () => true, redis: async () => true },
      db,
      services: { ...stubServices, tokens },
    });
  });

  afterEach(async () => {
    if (rounds.length > 0) {
      await db.deleteFrom("bets").where("round_id", "in", rounds).execute();
      await db.deleteFrom("game_rounds").where("id", "in", rounds).execute();
    }
    rounds.length = 0;
    for (const userId of players.splice(0)) {
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Runs `fn` in a transaction that is always rolled back. With `emptyRounds`, `game_rounds` is
   * shadowed by an empty temp table (pg_temp comes first in the search_path and Kysely emits
   * unqualified names), so the queries see no other file's rounds while the real table is
   * never locked or written.
   */
  async function rolledBack(
    fn: (trx: Transaction<Database>) => Promise<void>,
    { emptyRounds = false }: { emptyRounds?: boolean } = {},
  ): Promise<void> {
    await db
      .transaction()
      .execute(async (trx) => {
        if (emptyRounds) {
          await sql`create temp table game_rounds (like public.game_rounds including defaults including constraints) on commit drop`.execute(
            trx,
          );
        }
        await fn(trx);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  }

  async function createPlayer(trx: Db = db): Promise<string> {
    const user = await trx
      .insertInto("users")
      .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (trx === db) players.push(user.id);
    return user.id;
  }

  async function createRound(
    trx: Db,
    status: RoundStatus,
    opts: { settledAgoMs?: number; opensInMs?: number } = {},
  ): Promise<string> {
    const resolved = status === "resolved" || status === "settled";
    const { settledAgoMs = 1_000, opensInMs = 0 } = opts;
    const row = await trx
      .insertInto("game_rounds")
      .values({
        game: "races",
        status,
        server_seed: SECRET_SEED,
        server_seed_hash: "b".repeat(64),
        opens_at: new Date(Date.now() + opensInMs),
        closes_at: new Date(Date.now() + opensInMs + 30_000),
        result: resolved ? (result as never) : null,
        resolved_at: resolved ? new Date(Date.now() - settledAgoMs - 5_000) : null,
        settled_at: status === "settled" ? new Date(Date.now() - settledAgoMs) : null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function committedRound(status: RoundStatus, opts: Parameters<typeof createRound>[2] = {}) {
    const id = await createRound(db, status, opts);
    rounds.push(id);
    return id;
  }

  function get(url: string, userId: string) {
    return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${userId}` } });
  }
  const roundUrl = (id: string) => apiPaths.raceRound.replace(":roundId", id);

  it("never exposes the seed or the result of an open or closed round", async () => {
    const userId = await createPlayer();
    for (const status of ["open", "closed"] as const) {
      const id = await committedRound(status);
      const res = await get(roundUrl(id), userId);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(SECRET_SEED);
      const body = raceRoundSchema.parse(res.json());
      expect(body.status).toBe(status);
      expect(body.serverSeed).toBeUndefined();
      expect(body.result).toBeUndefined();
      const direct = await getRound(db, id, { raceDurationMs });
      expect(direct?.serverSeed).toBeUndefined();
      expect(direct?.result).toBeUndefined();
    }
  });

  it("includes the seed and result of a resolved or settled round", async () => {
    const userId = await createPlayer();
    for (const status of ["resolved", "settled"] as const) {
      const id = await committedRound(status);
      const body = raceRoundSchema.parse((await get(roundUrl(id), userId)).json());
      expect(body.serverSeed).toBe(SECRET_SEED);
      expect(body.result).toEqual(result);
      expect(body.settlesAt).toMatch(/Z$/);
    }
  });

  it("answers 404 for an unknown round and 400 for a bad id", async () => {
    const userId = await createPlayer();
    expect((await get(roundUrl(randomUUID()), userId)).statusCode).toBe(404);
    expect((await get(roundUrl("nope"), userId)).statusCode).toBe(400);
  });

  it("answers the current round over HTTP with an ISO server time and no secrets", async () => {
    const userId = await createPlayer();
    const id = await committedRound("open", { opensInMs: YEAR_MS });
    const res = await get(apiPaths.raceCurrent, userId);
    expect(res.statusCode).toBe(200);
    const body = currentRaceResponseSchema.parse(res.json());
    expect(body.round?.id).toBe(id);
    expect(body.round?.serverSeed).toBeUndefined();
    expect(body.myBet).toBeNull();
    expect(body.limits).toEqual({ minStake: "1", maxStake: "1000" });
    expect(body.raceDurationMs).toBe(raceDurationMs);
    expect(new Date(body.now).toISOString()).toBe(body.now);
  });

  it("returns null when there are no rounds", async () => {
    await rolledBack(
      async (trx) => {
        expect(await getCurrentRound(trx, { raceDurationMs, raceIntermissionMs })).toBeNull();
      },
      { emptyRounds: true },
    );
  });

  it("returns a recently settled round and prefers a non-settled one", async () => {
    await rolledBack(
      async (trx) => {
        const settled = await createRound(trx, "settled", { settledAgoMs: 1_000 });
        expect((await getCurrentRound(trx, { raceDurationMs, raceIntermissionMs }))?.id).toBe(
          settled,
        );
        const open = await createRound(trx, "open", { opensInMs: 1_000 });
        expect((await getCurrentRound(trx, { raceDurationMs, raceIntermissionMs }))?.id).toBe(open);
      },
      { emptyRounds: true },
    );
  });

  it("keeps a settled round current for the intermission and then returns null", async () => {
    await rolledBack(
      async (trx) => {
        const settled = await createRound(trx, "settled", {
          settledAgoMs: raceIntermissionMs - 3_000,
        });
        expect((await getCurrentRound(trx, { raceDurationMs, raceIntermissionMs }))?.id).toBe(
          settled,
        );
        await trx.deleteFrom("game_rounds").execute();
        await createRound(trx, "settled", { settledAgoMs: raceIntermissionMs + 3_000 });
        expect(await getCurrentRound(trx, { raceDurationMs, raceIntermissionMs })).toBeNull();
      },
      { emptyRounds: true },
    );
  });

  it("shows no settled round at all when the intermission is 0", async () => {
    await rolledBack(
      async (trx) => {
        await createRound(trx, "settled", { settledAgoMs: 1_000 });
        expect(await getCurrentRound(trx, { raceDurationMs, raceIntermissionMs: 0 })).toBeNull();
        const open = await createRound(trx, "open", { opensInMs: 1_000 });
        expect((await getCurrentRound(trx, { raceDurationMs, raceIntermissionMs: 0 }))?.id).toBe(
          open,
        );
      },
      { emptyRounds: true },
    );
  });

  it("shows myBet to the bettor, null to another player, and the payout once settled", async () => {
    await rolledBack(async (trx) => {
      const bettor = await createPlayer(trx);
      const other = await createPlayer(trx);
      const id = await createRound(trx, "open");
      await trx
        .insertInto("bets")
        .values({
          user_id: bettor,
          game: "races",
          round_id: id,
          stake: 100n,
          selection: { animal: 1 },
          status: "pending",
        })
        .execute();
      expect(await getPlayerBet(trx, bettor, id)).toEqual({
        animal: 1,
        stake: 100n,
        payout: null,
      });
      expect(await getPlayerBet(trx, other, id)).toBeNull();

      await trx
        .updateTable("bets")
        .set({ status: "settled", payout: 450n, settled_at: new Date() })
        .where("round_id", "=", id)
        .execute();
      expect((await getPlayerBet(trx, bettor, id))?.payout).toBe(450n);
    });
  });
});

import { randomBytes, randomUUID } from "node:crypto";
import {
  CRASH_GAMES,
  type CrashEvent,
  type CrashGame,
  type CrashResult,
  computeRoundOutcome,
  crashPayout,
  crashResultSchema,
  createRng,
  hashServerSeed,
  impactAtMs,
  MAX_MULTIPLIER_HUNDREDTHS,
  resolveCrash,
} from "@casino/shared";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../db/database";
import { migrations } from "../db/migrations";
import { cashOutCrashBet } from "../games/crash/cashout";
import { placeCrashBet } from "../games/crash/place-bet";
import { postgresTypes } from "../platform/postgres";
import { createMemoryCrashEventBus } from "../realtime/crash-events";
import { postgresWalletService } from "../wallet/postgres-wallet-service";
import { scopedKey } from "../wallet/wallet-service";
import { advanceCrash, type CrashCycleDeps } from "./crash-cycle";

const WINDOW_MS = 60_000;
const limits = { min: 1000n, max: 50_000n };
const DINO: CrashGame = "dino-crash";

/**
 * `advanceCrash` works on the active round of a game across the whole database, so this file runs in
 * a PostgreSQL schema of its own: the migrations are applied to it through the pool's `search_path`,
 * every table is truncated between tests, and the schema is dropped at the end.
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)("advanceCrash", () => {
  const schema = `crash_cycle_test_${randomBytes(6).toString("hex")}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let db: Db;
  let clock: Date;
  let published: { game: CrashGame; event: CrashEvent }[];
  let deps: CrashCycleDeps;

  const now = () => clock;
  const advanceBy = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await adminPool.query(`create schema ${schema}`);
    pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
      types: postgresTypes,
    });
    db = createDatabase(pool);
    const migrator = new Migrator({
      db,
      provider: { getMigrations: async () => migrations },
      migrationTableSchema: schema,
    });
    const { error } = await migrator.migrateToLatest();
    if (error) throw error;
  });

  afterAll(async () => {
    await db?.destroy();
    await adminPool?.query(`drop schema if exists ${schema} cascade`);
    await adminPool?.end();
  });

  beforeEach(async () => {
    await sql`truncate ledger_entries, transactions, bets, blackjack_shoes, game_rounds, seed_pairs, wallets, users`.execute(
      db,
    );
    await sql`insert into wallets (kind, balance) values ('issuance', 0), ('house', 0)`.execute(db);
    clock = new Date();
    published = [];
    const events = createMemoryCrashEventBus();
    for (const game of CRASH_GAMES) {
      events.subscribe(game, (event) => published.push({ game, event }));
    }
    deps = { wallet: postgresWalletService, events, windowMs: WINDOW_MS, intermissionMs: 0 };
  });

  const tick = (game: CrashGame = DINO, overrides: Partial<CrashCycleDeps> = {}) =>
    advanceCrash(db, game, { ...deps, ...overrides }, now);

  const roundsOf = (game: CrashGame) =>
    db
      .selectFrom("game_rounds")
      .selectAll()
      .where("game", "=", game)
      .orderBy("opens_at")
      .orderBy("created_at")
      .execute();

  const activeCount = async (game: CrashGame) =>
    Number(
      (
        await db
          .selectFrom("game_rounds")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("game", "=", game)
          .where("status", "!=", "settled")
          .executeTakeFirstOrThrow()
      ).n,
    );

  const createPlayer = (balance: bigint): Promise<string> =>
    db.transaction().execute(async (trx) => {
      const user = await trx
        .insertInto("users")
        .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await postgresWalletService.createPlayerWallet(trx, user.id);
      await postgresWalletService.transfer(trx, {
        from: "issuance",
        to: { userId: user.id },
        amount: balance,
        type: "deposit",
        idempotencyKey: scopedKey("deposit", user.id, randomUUID()),
      });
      return user.id;
    });

  async function bet(game: CrashGame, roundId: string, stake: bigint) {
    const userId = await createPlayer(10_000n);
    const res = await db
      .transaction()
      .execute((trx) =>
        placeCrashBet(
          trx,
          { wallet: postgresWalletService },
          { userId, idempotencyKey: randomUUID(), roundId, game, stake, limits },
        ),
      );
    return { userId, betId: res.betId, stake };
  }

  async function crashOf(roundId: string): Promise<CrashResult> {
    const row = await db
      .selectFrom("game_rounds")
      .select("server_seed")
      .where("id", "=", roundId)
      .executeTakeFirstOrThrow();
    return resolveCrash(createRng(await computeRoundOutcome(row.server_seed, roundId)));
  }

  /** Replaces a round's seed with one whose impact point falls in `[min, max]`, hash kept in sync. */
  async function forceCrash(roundId: string, min: number, max: number): Promise<CrashResult> {
    for (let i = 0; i < 500; i++) {
      const seed = randomBytes(32).toString("hex");
      const crash = resolveCrash(createRng(await computeRoundOutcome(seed, roundId)));
      if (crash.crashHundredths >= min && crash.crashHundredths <= max) {
        await db
          .updateTable("game_rounds")
          .set({ server_seed: seed, server_seed_hash: await hashServerSeed(seed) })
          .where("id", "=", roundId)
          .execute();
        return crash;
      }
    }
    throw new Error("no seed found in the target crash range");
  }

  const balanceOf = (userId: string) => postgresWalletService.getBalance(db, userId);

  const payoutCount = async (betId: string) =>
    Number(
      (
        await db
          .selectFrom("transactions")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("bet_id", "=", betId)
          .where("type", "=", "payout")
          .executeTakeFirstOrThrow()
      ).n,
    );

  async function expectLedgerConsistent() {
    const unbalanced = await sql<{ id: string }>`
      select transaction_id as id from ledger_entries
      group by transaction_id having sum(amount) <> 0`.execute(db);
    expect(unbalanced.rows).toEqual([]);
    const drift = await sql<{ id: string }>`
      select w.id from wallets w
      left join ledger_entries e on e.wallet_id = w.id
      group by w.id, w.balance having w.balance <> coalesce(sum(e.amount), 0)`.execute(db);
    expect(drift.rows).toEqual([]);
    const total = await sql<{ total: string }>`
      select coalesce(sum(balance), 0)::text as total from wallets`.execute(db);
    expect(total.rows[0]?.total).toBe("0");
  }

  it("opens a round when there is none, publishing it without the seed", async () => {
    await tick();
    const [round] = await roundsOf(DINO);
    if (!round) throw new Error("no round");
    expect(round.status).toBe("open");
    expect(round.server_seed).toMatch(/^[0-9a-f]{64}$/);
    expect(round.closes_at.getTime() - round.opens_at.getTime()).toBe(WINDOW_MS);
    expect(published).toHaveLength(1);
    const first = published[0];
    if (first?.event.type !== "opened") throw new Error("expected opened");
    expect(first.event.round.serverSeed).toBeUndefined();
    expect(first.game).toBe(DINO);
  });

  it("runs open -> takeoff -> impact -> settled, revealing the seed only at impact", async () => {
    await tick();
    const [open] = await roundsOf(DINO);
    const roundId = (open as { id: string }).id;
    const crash = await crashOf(roundId);

    advanceBy(WINDOW_MS);
    await tick(); // takeoff
    expect((await roundsOf(DINO))[0]?.status).toBe("closed");

    advanceBy(impactAtMs(crash.crashHundredths));
    await tick(); // impact / resolved
    const resolved = (await roundsOf(DINO))[0];
    expect(resolved?.status).toBe("resolved");
    expect(crashResultSchema.parse(resolved?.result)).toEqual(crash);

    await tick(); // settled (no bets)
    expect((await roundsOf(DINO))[0]?.status).toBe("settled");

    const types = published.map((p) => p.event.type);
    expect(types).toEqual(["opened", "takeoff", "impact", "settled"]);
    const impact = published.find((p) => p.event.type === "impact");
    if (impact?.event.type !== "impact") throw new Error("no impact");
    expect(impact.event.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    // Only the impact event carries the seed.
    expect(JSON.stringify(published.filter((p) => p.event.type !== "impact"))).not.toContain(
      impact.event.serverSeed,
    );
  });

  it("settles a player who did not cash out as a loss, and the ledger balances", async () => {
    await tick();
    const roundId = (await roundsOf(DINO))[0]?.id as string;
    await forceCrash(roundId, 300, 1900);
    const { userId, betId, stake } = await bet(DINO, roundId, 1000n);
    const crash = await crashOf(roundId);

    advanceBy(WINDOW_MS);
    await tick(); // takeoff
    advanceBy(impactAtMs(crash.crashHundredths));
    await tick(); // impact
    await tick(); // settled

    const settledBet = await db
      .selectFrom("bets")
      .select(["status", "payout", "result"])
      .where("id", "=", betId)
      .executeTakeFirstOrThrow();
    expect(settledBet.status).toBe("settled");
    expect(settledBet.payout).toBe(0n);
    expect(settledBet.result).toEqual({ outcome: "lost" });
    expect(await balanceOf(userId)).toBe(10_000n - stake);
    await expectLedgerConsistent();
  });

  it("pays every still-flying player 20.00x when the round reaches the cap", async () => {
    await tick();
    const roundId = (await roundsOf(DINO))[0]?.id as string;
    const crash = await forceCrash(roundId, MAX_MULTIPLIER_HUNDREDTHS, MAX_MULTIPLIER_HUNDREDTHS);
    expect(crash.outcome).toBe("cap");
    const { userId, betId, stake } = await bet(DINO, roundId, 1000n);

    advanceBy(WINDOW_MS);
    await tick(); // takeoff
    advanceBy(impactAtMs(MAX_MULTIPLIER_HUNDREDTHS));
    await tick(); // impact
    await tick(); // settled

    const expected = crashPayout(stake, MAX_MULTIPLIER_HUNDREDTHS);
    const settledBet = await db
      .selectFrom("bets")
      .select(["status", "payout", "result"])
      .where("id", "=", betId)
      .executeTakeFirstOrThrow();
    expect(settledBet.payout).toBe(expected);
    expect(settledBet.result).toEqual({ outcome: "cap", atHundredths: MAX_MULTIPLIER_HUNDREDTHS });
    expect(await balanceOf(userId)).toBe(10_000n - stake + expected);
    expect(await payoutCount(betId)).toBe(1);
    await expectLedgerConsistent();
  });

  it("leaves a cashed-out bet untouched at settlement", async () => {
    await tick();
    const roundId = (await roundsOf(DINO))[0]?.id as string;
    await forceCrash(roundId, 500, 1900);
    const { userId, betId, stake } = await bet(DINO, roundId, 1000n);

    // Take off with a real-clock `closes_at` a second ago, so the API cash-out (which reads the
    // database clock, not the test's simulated one) sees a valid, small elapsed time.
    await db
      .updateTable("game_rounds")
      .set({
        status: "closed",
        opens_at: new Date(Date.now() - 6000),
        closes_at: new Date(Date.now() - 1000),
      })
      .where("id", "=", roundId)
      .execute();
    const cash = await db
      .transaction()
      .execute((trx) =>
        cashOutCrashBet(trx, { wallet: postgresWalletService }, { userId, game: DINO, betId }),
      );

    // Now let the worker resolve and settle; the simulated clock jumps past the impact instant.
    const crash = await crashOf(roundId);
    advanceBy(impactAtMs(crash.crashHundredths));
    await tick(); // impact
    await tick(); // settled

    const settledBet = await db
      .selectFrom("bets")
      .select(["status", "payout", "result"])
      .where("id", "=", betId)
      .executeTakeFirstOrThrow();
    expect(settledBet.result).toEqual({
      outcome: "cashout",
      atHundredths: cash.cashoutHundredths,
    });
    expect(settledBet.payout).toBe(crashPayout(stake, cash.cashoutHundredths));
    expect(await payoutCount(betId)).toBe(1);
    expect(await balanceOf(userId)).toBe(10_000n - stake + BigInt(cash.payout));
    await expectLedgerConsistent();
  });

  it("keeps at most one active round and resumes instead of reopening", async () => {
    await tick(); // open
    await tick(); // nothing (still in the betting window)
    expect(await activeCount(DINO)).toBe(1);
    advanceBy(WINDOW_MS);
    await tick(); // takeoff
    await tick(); // still flying (before impact), resumes the same round
    expect(await activeCount(DINO)).toBe(1);
  });

  it("drives the two games independently", async () => {
    await tick(DINO);
    await tick("aviator");
    expect(await activeCount(DINO)).toBe(1);
    expect(await activeCount("aviator")).toBe(1);
    expect(published.filter((p) => p.game === DINO)).toHaveLength(1);
    expect(published.filter((p) => p.game === "aviator")).toHaveLength(1);
  });

  it("waits out the intermission before opening the next round", async () => {
    const intermissionMs = 3000;
    await tick(DINO, { intermissionMs });
    const roundId = (await roundsOf(DINO))[0]?.id as string;
    const crash = await crashOf(roundId);
    advanceBy(WINDOW_MS);
    await tick(DINO, { intermissionMs }); // takeoff
    advanceBy(impactAtMs(crash.crashHundredths));
    await tick(DINO, { intermissionMs }); // impact
    await tick(DINO, { intermissionMs }); // settled
    expect(await activeCount(DINO)).toBe(0);

    await tick(DINO, { intermissionMs }); // too soon: intermission not elapsed
    expect(await activeCount(DINO)).toBe(0);
    advanceBy(intermissionMs);
    await tick(DINO, { intermissionMs }); // now it opens
    expect(await activeCount(DINO)).toBe(1);
  });
});

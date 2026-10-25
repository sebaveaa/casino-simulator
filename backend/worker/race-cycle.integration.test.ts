import { randomBytes, randomUUID } from "node:crypto";
import {
  computeRoundOutcome,
  createRng,
  hashServerSeed,
  type RaceEvent,
  type RaceResult,
  racePayout,
  raceRoundSchema,
  resolveRace,
} from "@casino/shared";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../db/database";
import { migrations } from "../db/migrations";
import { placeRaceBet } from "../games/races/place-bet";
import { postgresTypes } from "../platform/postgres";
import { createMemoryRaceEventBus } from "../realtime/race-events";
import { postgresWalletService } from "../wallet/postgres-wallet-service";
import { scopedKey, type WalletService } from "../wallet/wallet-service";
import { advanceRaces, type RaceCycleDeps } from "./race-cycle";

const WINDOW_MS = 60_000;
const DURATION_MS = 20_000;
const INTERMISSION_MS = 8000;
// No intermission by default, so most tests open the next round right after a settlement.
const config = { raceWindowMs: WINDOW_MS, raceDurationMs: DURATION_MS, raceIntermissionMs: 0 };
const limits = { min: 10n, max: 500n };

/**
 * `advanceRaces` works on "the" active round of the whole database, so this file runs in a
 * PostgreSQL schema of its own: the project migrations are applied to it through the pool's
 * `search_path`, every table is truncated between tests, and the schema is dropped at the end.
 * Nothing in `public` is read, locked or written.
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)("advanceRaces", () => {
  const schema = `race_cycle_test_${randomBytes(6).toString("hex")}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let db: Db;
  let clock: Date;
  let published: RaceEvent[];
  let deps: RaceCycleDeps;

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
    // TRUNCATE skips the append-only row triggers, which is fine for a throwaway schema.
    await sql`truncate ledger_entries, transactions, bets, game_rounds, seed_pairs, wallets, users`.execute(
      db,
    );
    await sql`insert into wallets (kind, balance) values ('issuance', 0), ('house', 0)`.execute(db);
    clock = new Date();
    published = [];
    const events = createMemoryRaceEventBus();
    events.subscribe((event) => published.push(event));
    deps = { wallet: postgresWalletService, events, config };
  });

  const tick = (overrides: Partial<RaceCycleDeps> = {}) =>
    advanceRaces(db, { ...deps, ...overrides }, now);

  const rounds = () =>
    db.selectFrom("game_rounds").selectAll().orderBy("opens_at").orderBy("created_at").execute();

  async function onlyRound() {
    const all = await rounds();
    expect(all).toHaveLength(1);
    return all[0] as (typeof all)[number];
  }

  const activeCount = async () =>
    Number(
      (
        await db
          .selectFrom("game_rounds")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("status", "!=", "settled")
          .executeTakeFirstOrThrow()
      ).n,
    );

  /** One transaction: the ledger's entry-count and zero-sum checks run at commit. */
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

  async function bet(roundId: string, animal: number, stake: bigint) {
    const userId = await createPlayer(1000n);
    const res = await db
      .transaction()
      .execute((trx) =>
        placeRaceBet(
          trx,
          { wallet: postgresWalletService },
          { userId, idempotencyKey: randomUUID(), roundId, animal, stake, limits },
        ),
      );
    return { userId, betId: res.betId, animal, stake };
  }

  async function expectedResult(roundId: string): Promise<RaceResult> {
    const row = await db
      .selectFrom("game_rounds")
      .select(["server_seed"])
      .where("id", "=", roundId)
      .executeTakeFirstOrThrow();
    return resolveRace(createRng(await computeRoundOutcome(row.server_seed, roundId)));
  }

  const balanceOf = (userId: string) => postgresWalletService.getBalance(db, userId);

  const houseBalance = async () =>
    (
      await db
        .selectFrom("wallets")
        .select("balance")
        .where("kind", "=", "house")
        .executeTakeFirstOrThrow()
    ).balance;

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

  /** Every transaction sums to zero and every wallet balance equals the sum of its entries. */
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

  /** Opens a round and advances it to `resolved`, with the clock past the settlement instant. */
  async function openRound() {
    await tick();
    return (await onlyRound()).id;
  }

  async function runToResolved() {
    advanceBy(WINDOW_MS);
    await tick(); // closed
    await tick(); // resolved
    advanceBy(DURATION_MS);
  }

  /** `n` players betting so that `winners` of them back the animal that will win. */
  async function placeBets(roundId: string, count: number, winners: number) {
    const { winner } = await expectedResult(roundId);
    const loser = (winner + 1) % 5;
    const placed = [];
    for (let i = 0; i < count; i++) {
      placed.push(await bet(roundId, i < winners ? winner : loser, 100n + BigInt(i) * 10n));
    }
    return placed;
  }

  it("opens a round when there is none, publishing it without the seed", async () => {
    await tick();

    const round = await onlyRound();
    expect(round.status).toBe("open");
    expect(round.game).toBe("races");
    expect(round.server_seed).toMatch(/^[0-9a-f]{64}$/);
    expect(round.server_seed_hash).toBe(await hashServerSeed(round.server_seed));
    expect(round.opens_at.getTime()).toBe(clock.getTime());
    expect(round.closes_at.getTime() - round.opens_at.getTime()).toBe(WINDOW_MS);
    expect(round.result).toBeNull();

    expect(published).toHaveLength(1);
    const event = published[0];
    if (event?.type !== "opened") throw new Error("expected an opened event");
    expect(raceRoundSchema.parse(event.round)).toEqual(event.round);
    expect(event.round).toEqual({
      id: round.id,
      status: "open",
      opensAt: round.opens_at.toISOString(),
      closesAt: round.closes_at.toISOString(),
      serverSeedHash: round.server_seed_hash,
    });
    expect(JSON.stringify(event)).not.toContain(round.server_seed);
  });

  it("opens a round when canOpenRound allows it", async () => {
    await tick({ canOpenRound: async () => true });
    expect((await onlyRound()).status).toBe("open");
  });

  it("opens no round while canOpenRound says no, and opens one once it says yes", async () => {
    await tick({ canOpenRound: async () => false });
    expect(await rounds()).toEqual([]);
    expect(published).toEqual([]);

    await tick({ canOpenRound: async () => true });
    expect((await onlyRound()).status).toBe("open");
  });

  it("never pauses closing, resolving or settling when canOpenRound says no", async () => {
    const canOpenRound = async () => false;
    const roundId = await openRound();
    await placeBets(roundId, 5, 2);

    advanceBy(WINDOW_MS);
    await tick({ canOpenRound });
    expect((await onlyRound()).status).toBe("closed");
    advanceBy(5);
    await tick({ canOpenRound });
    expect((await onlyRound()).status).toBe("resolved");
    advanceBy(DURATION_MS);
    await tick({ canOpenRound });

    expect((await onlyRound()).status).toBe("settled");
    const pending = await db
      .selectFrom("bets")
      .select("id")
      .where("status", "=", "pending")
      .execute();
    expect(pending).toEqual([]);
    expect(published.at(-1)).toEqual({ type: "settled", roundId });
    // Settled, and still nothing new opens while Redis is down.
    await tick({ canOpenRound });
    expect(await rounds()).toHaveLength(1);
  });

  it("uses the database clock when no clock is given", async () => {
    const before = (await sql<{ t: Date }>`select clock_timestamp() as t`.execute(db)).rows[0]?.t;
    await advanceRaces(db, deps);
    const after = (await sql<{ t: Date }>`select clock_timestamp() as t`.execute(db)).rows[0]?.t;

    const round = await onlyRound();
    expect(round.opens_at.getTime()).toBeGreaterThanOrEqual((before as Date).getTime());
    expect(round.opens_at.getTime()).toBeLessThanOrEqual((after as Date).getTime());
  });

  it("keeps an open round open until closes_at, then closes it", async () => {
    const roundId = await openRound();
    published = [];

    advanceBy(WINDOW_MS - 1);
    await tick();
    expect((await onlyRound()).status).toBe("open");
    expect(published).toEqual([]);

    advanceBy(1);
    await tick();
    expect((await onlyRound()).status).toBe("closed");
    expect(published).toEqual([{ type: "closed", roundId }]);
  });

  it("resolves a closed round with the provably fair result and reveals the seed", async () => {
    const roundId = await openRound();
    advanceBy(WINDOW_MS);
    await tick();
    published = [];

    advanceBy(5);
    await tick();

    const round = await onlyRound();
    const expected = await expectedResult(roundId);
    expect(round.status).toBe("resolved");
    expect(round.result).toEqual(expected);
    expect(round.resolved_at?.getTime()).toBe(clock.getTime());
    expect(published).toEqual([
      { type: "result", roundId, result: expected, serverSeed: round.server_seed },
    ]);
  });

  it("settles only after the race has run, paying the winners and nothing to the losers", async () => {
    const roundId = await openRound();
    const placed = await placeBets(roundId, 5, 2);
    const houseBefore = await houseBalance();
    await runToResolved();
    advanceBy(-1);
    published = [];

    await tick();
    expect((await onlyRound()).status).toBe("resolved");
    expect(published).toEqual([]);

    advanceBy(1);
    await tick();

    const round = await onlyRound();
    expect(round.status).toBe("settled");
    expect(round.settled_at?.getTime()).toBe(clock.getTime());
    expect(published).toEqual([{ type: "settled", roundId }]);

    const { winner } = await expectedResult(roundId);
    let paid = 0n;
    for (const p of placed) {
      const row = await db
        .selectFrom("bets")
        .select(["status", "payout", "result", "settled_at"])
        .where("id", "=", p.betId)
        .executeTakeFirstOrThrow();
      const won = p.animal === winner;
      expect(row).toEqual({
        status: "settled",
        payout: won ? racePayout(p.stake) : 0n,
        result: { winner, won },
        settled_at: clock,
      });
      expect(await payoutCount(p.betId)).toBe(won ? 1 : 0);
      expect(await balanceOf(p.userId)).toBe(1000n - p.stake + (won ? racePayout(p.stake) : 0n));
      if (won) paid += racePayout(p.stake);
    }
    expect(paid).toBeGreaterThan(0n);
    expect(await houseBalance()).toBe(houseBefore - paid);
    await expectLedgerConsistent();
  });

  it("settles in batches, survives a crash between and inside batches, and pays once", async () => {
    const roundId = await openRound();
    // Four winners of five: whatever batch the crash hits, it holds at least one payout.
    const placed = await placeBets(roundId, 5, 4);
    await runToResolved();
    const settledCount = async () =>
      Number(
        (
          await db
            .selectFrom("bets")
            .select((eb) => eb.fn.countAll().as("n"))
            .where("round_id", "=", roundId)
            .where("status", "=", "settled")
            .executeTakeFirstOrThrow()
        ).n,
      );

    await tick({ settlementBatchSize: 2 });
    expect(await settledCount()).toBe(2);
    expect((await onlyRound()).status).toBe("resolved");

    // A crash in the middle of the next batch, after a payout was written: it all rolls back.
    const crashing: WalletService = {
      ...postgresWalletService,
      async transfer(trx, input) {
        await postgresWalletService.transfer(trx, input);
        throw new Error("simulated crash");
      },
    };
    await expect(tick({ wallet: crashing, settlementBatchSize: 2 })).rejects.toThrow(
      "simulated crash",
    );
    expect(await settledCount()).toBe(2);

    // A restarted worker: fresh dependencies, same database.
    const restarted = createMemoryRaceEventBus();
    const afterRestart: RaceEvent[] = [];
    restarted.subscribe((event) => afterRestart.push(event));
    for (let i = 0; i < 6; i++) await tick({ events: restarted, settlementBatchSize: 2 });

    const { winner } = await expectedResult(roundId);
    for (const p of placed) {
      const won = p.animal === winner;
      expect(await payoutCount(p.betId)).toBe(won ? 1 : 0);
      expect(await balanceOf(p.userId)).toBe(1000n - p.stake + (won ? racePayout(p.stake) : 0n));
    }
    expect(await settledCount()).toBe(5);
    expect(afterRestart.filter((e) => e.type === "settled")).toEqual([
      { type: "settled", roundId },
    ]);
    // After settlement the loop moves on to exactly one new round.
    expect(afterRestart.filter((e) => e.type === "opened")).toHaveLength(1);
    expect(await activeCount()).toBe(1);
    await expectLedgerConsistent();
  });

  it("never pays twice when called again and again, and then opens exactly one new round", async () => {
    const roundId = await openRound();
    const placed = await placeBets(roundId, 3, 2);
    await runToResolved();

    await tick();
    expect((await rounds()).map((r) => r.status)).toEqual(["settled"]);
    for (let i = 0; i < 5; i++) await tick();

    const all = await rounds();
    expect(all.map((r) => r.status)).toEqual(["settled", "open"]);
    expect(published.filter((e) => e.type === "settled")).toHaveLength(1);
    expect(published.filter((e) => e.type === "opened")).toHaveLength(2);
    for (const p of placed) expect(await payoutCount(p.betId)).toBeLessThanOrEqual(1);
    await expectLedgerConsistent();
  });

  describe("intermission", () => {
    const withIntermission = { config: { ...config, raceIntermissionMs: INTERMISSION_MS } };

    async function settleOneRound(overrides: Partial<RaceCycleDeps>) {
      await tick(overrides);
      advanceBy(WINDOW_MS);
      await tick(overrides); // closed
      await tick(overrides); // resolved
      advanceBy(DURATION_MS);
      await tick(overrides); // settled
      expect((await onlyRound()).status).toBe("settled");
    }

    it("opens the very first round at once", async () => {
      await tick(withIntermission);
      expect((await onlyRound()).status).toBe("open");
    });

    it("opens no new round during the intermission, and opens one right after it", async () => {
      await settleOneRound(withIntermission);
      published = [];

      await tick(withIntermission);
      advanceBy(INTERMISSION_MS - 1);
      await tick(withIntermission);
      expect(await rounds()).toHaveLength(1);
      expect(published).toEqual([]);

      advanceBy(1);
      await tick(withIntermission);
      expect((await rounds()).map((r) => r.status)).toEqual(["settled", "open"]);
      expect(published.map((e) => e.type)).toEqual(["opened"]);
    });

    it("opens the next round at once when the intermission is 0", async () => {
      await settleOneRound({});
      await tick();
      expect((await rounds()).map((r) => r.status)).toEqual(["settled", "open"]);
    });

    it("measures the intermission from the latest settlement, not an older one", async () => {
      await settleOneRound(withIntermission);
      advanceBy(INTERMISSION_MS);
      await tick(withIntermission); // opens round 2
      await tick(withIntermission);
      advanceBy(WINDOW_MS);
      await tick(withIntermission); // closed
      await tick(withIntermission); // resolved
      advanceBy(DURATION_MS);
      await tick(withIntermission); // settled
      expect((await rounds()).map((r) => r.status)).toEqual(["settled", "settled"]);

      advanceBy(INTERMISSION_MS - 1);
      await tick(withIntermission);
      expect(await rounds()).toHaveLength(2);
      advanceBy(1);
      await tick(withIntermission);
      expect(await rounds()).toHaveLength(3);
    });

    it("does not change how an unsettled round advances", async () => {
      const roundId = await openRound();
      advanceBy(WINDOW_MS);
      await tick(withIntermission);
      expect((await onlyRound()).status).toBe("closed");
      await tick(withIntermission);
      expect((await onlyRound()).status).toBe("resolved");
      expect(published.map((e) => e.type)).toEqual(["opened", "closed", "result"]);
      expect(published.at(-1)).toMatchObject({ roundId });
    });
  });

  for (const outcome of ["commit", "rollback"] as const) {
    it(`waits for an in-flight bet before closing (${outcome}), then settles it`, async () => {
      const roundId = await openRound();
      const userId = await createPlayer(1000n);
      const { winner } = await expectedResult(roundId);

      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let placed: () => void = () => {};
      const betPlaced = new Promise<void>((resolve) => {
        placed = resolve;
      });
      const betting = db
        .transaction()
        .execute(async (trx) => {
          await placeRaceBet(
            trx,
            { wallet: postgresWalletService },
            { userId, idempotencyKey: randomUUID(), roundId, animal: winner, stake: 100n, limits },
          );
          placed();
          await gate;
          if (outcome === "rollback") throw new Error("rolled back");
        })
        .catch((error: Error) => {
          if (error.message !== "rolled back") throw error;
        });
      await betPlaced;

      advanceBy(WINDOW_MS);
      let closed = false;
      const closing = tick().then(() => {
        closed = true;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(closed).toBe(false);
        expect((await onlyRound()).status).toBe("open");
      } finally {
        // Released even on failure, so a broken close cannot leave the bet transaction open.
        release();
        await betting;
        await closing;
      }
      expect((await onlyRound()).status).toBe("closed");

      await tick(); // resolved
      advanceBy(DURATION_MS);
      await tick(); // settled
      expect((await onlyRound()).status).toBe("settled");

      const bets = await db
        .selectFrom("bets")
        .select(["status", "payout"])
        .where("round_id", "=", roundId)
        .execute();
      if (outcome === "commit") {
        expect(bets).toEqual([{ status: "settled", payout: racePayout(100n) }]);
        expect(await balanceOf(userId)).toBe(1000n - 100n + racePayout(100n));
      } else {
        expect(bets).toEqual([]);
        expect(await balanceOf(userId)).toBe(1000n);
      }
      await expectLedgerConsistent();
    });
  }

  it("never has two active rounds and opens the next only once the last is settled", async () => {
    let lastSettled: string | undefined;
    for (let i = 0; i < 40; i++) {
      await tick();
      expect(await activeCount()).toBeLessThanOrEqual(1);
      const all = await rounds();
      // Every round but the newest is settled.
      expect(all.slice(0, -1).every((r) => r.status === "settled")).toBe(true);
      if (all.length >= 2) lastSettled = all[all.length - 2]?.id;
      advanceBy(7_000);
    }
    expect(lastSettled).toBeDefined();
    const openedIds = published.filter((e) => e.type === "opened").map((e) => e.round.id);
    const settledIds = published.filter((e) => e.type === "settled").map((e) => e.roundId);
    // Each opened event after the first comes right after the previous round's settled event.
    for (let i = 1; i < openedIds.length; i++) {
      const settledAt = published.findIndex(
        (e) => e.type === "settled" && e.roundId === openedIds[i - 1],
      );
      const openedAt = published.findIndex(
        (e) => e.type === "opened" && e.round.id === openedIds[i],
      );
      expect(settledAt).toBeGreaterThanOrEqual(0);
      expect(openedAt).toBeGreaterThan(settledAt);
    }
    expect(settledIds.length).toBeGreaterThanOrEqual(openedIds.length - 1);
  });

  it("after a restart, closes and runs an open round that is already past closes_at", async () => {
    const roundId = await openRound();
    advanceBy(WINDOW_MS * 3);
    published = [];

    await tick(); // closed
    await tick(); // resolved
    advanceBy(DURATION_MS);
    await tick(); // settled
    expect((await onlyRound()).status).toBe("settled");
    expect(published.map((e) => e.type)).toEqual(["closed", "result", "settled"]);
    expect(published.every((e) => e.type === "opened" || e.roundId === roundId)).toBe(true);
  });

  it("after a restart, settles a resolved round with pending bets before opening another", async () => {
    const roundId = await openRound();
    const placed = await placeBets(roundId, 3, 1);
    await runToResolved();
    published = [];

    await tick();
    expect(await rounds()).toHaveLength(1);
    expect((await onlyRound()).status).toBe("settled");
    await tick();
    expect(published.map((e) => e.type)).toEqual(["settled", "opened"]);
    for (const p of placed) {
      const row = await db
        .selectFrom("bets")
        .select("status")
        .where("id", "=", p.betId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("settled");
    }
  });

  it("concurrent calls with no round open exactly one", async () => {
    await Promise.all(Array.from({ length: 5 }, () => tick()));
    expect(await rounds()).toHaveLength(1);
    expect(published.filter((e) => e.type === "opened")).toHaveLength(1);
  });

  it("concurrent calls on one round never repeat a transition or an event", async () => {
    const roundId = await openRound();
    await placeBets(roundId, 4, 2);
    advanceBy(WINDOW_MS);
    published = [];

    for (let i = 0; i < 4; i++) {
      await Promise.all([tick(), tick(), tick()]);
      advanceBy(DURATION_MS);
    }

    const forRound = published.filter((e) => e.type !== "opened" && e.roundId === roundId);
    expect(forRound.map((e) => e.type)).toEqual(["closed", "result", "settled"]);
    expect((await rounds())[0]?.status).toBe("settled");
    expect(await activeCount()).toBeLessThanOrEqual(1);
    await expectLedgerConsistent();
  });

  it("does nothing while another worker holds the round", async () => {
    const roundId = await openRound();
    await placeBets(roundId, 2, 1);
    advanceBy(WINDOW_MS);
    await tick(); // closed
    published = [];

    for (const status of ["closed", "resolved"] as const) {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => {};
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = db.transaction().execute(async (trx) => {
        await trx
          .selectFrom("game_rounds")
          .select("id")
          .where("id", "=", roundId)
          .forUpdate()
          .execute();
        locked();
        await gate;
      });
      await isLocked;

      try {
        await tick();
        expect((await onlyRound()).status).toBe(status);
        expect(published).toEqual([]);
      } finally {
        release();
        await holder;
      }
      await tick();
      expect(published).toHaveLength(1);
      published = [];
      advanceBy(DURATION_MS);
    }
    expect((await onlyRound()).status).toBe("settled");
  });

  /** Resolves once `fn` returns, or when it has failed for `timeoutMs` (the caller asserts). */
  async function waitFor(fn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !(await fn())) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** Some backend of this schema's pool waits on a row lock of the given table. */
  const someoneWaitsOn = async (table: string) => {
    const rows = await sql<{ n: string }>`
      select count(*)::text as n from pg_stat_activity
      where wait_event_type = 'Lock' and query ilike ${`%${table}%for update%`}
        and datname = current_database()`.execute(db);
    return Number(rows.rows[0]?.n) > 0;
  };

  it("settlement and a roulette-style bet (player, then house) never deadlock", {
    timeout: 20_000,
  }, async () => {
    const roundId = await openRound();
    // All winners: the old code paid them one by one, holding the house while locking the next.
    const placed = await placeBets(roundId, 3, 3);
    await runToResolved();
    const ordered = await db
      .selectFrom("bets")
      .select(["id", "user_id"])
      .where("round_id", "=", roundId)
      .orderBy("id")
      .execute();
    // The winner settled last, so earlier payouts already ran when settlement reaches them.
    const last = ordered[ordered.length - 1] as { id: string; user_id: string };

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // A roulette bet in flight: its player's wallet first, then the transfer to the house.
    const roulette = db.transaction().execute(async (trx) => {
      await postgresWalletService.lockBalance(trx, last.user_id);
      locked();
      await gate;
      await postgresWalletService.transfer(trx, {
        from: { userId: last.user_id },
        to: "house",
        amount: 10n,
        type: "bet",
        idempotencyKey: scopedKey("roulette-bet", last.user_id, randomUUID()),
      });
    });
    await isLocked;

    const settling = tick().then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      await waitFor(() => someoneWaitsOn("wallets"));
    } finally {
      release();
    }
    const [rouletteOutcome, settleOutcome] = await Promise.all([
      roulette.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
      settling,
    ]);
    expect(rouletteOutcome).toEqual({ ok: true });
    expect(settleOutcome).toEqual({ ok: true });

    expect((await onlyRound()).status).toBe("settled");
    for (const p of placed) {
      expect(await payoutCount(p.betId)).toBe(1);
      const roulette = p.userId === last.user_id ? 10n : 0n;
      expect(await balanceOf(p.userId)).toBe(1000n - p.stake - roulette + racePayout(p.stake));
    }
    await expectLedgerConsistent();
  });

  it("gives up a close after the lock timeout while a bet hangs, and closes once it ends", async () => {
    const roundId = await openRound();
    const userId = await createPlayer(1000n);
    published = [];

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let placed: () => void = () => {};
    const betPlaced = new Promise<void>((resolve) => {
      placed = resolve;
    });
    const betting = db.transaction().execute(async (trx) => {
      await placeRaceBet(
        trx,
        { wallet: postgresWalletService },
        { userId, idempotencyKey: randomUUID(), roundId, animal: 1, stake: 100n, limits },
      );
      placed();
      await gate;
    });
    await betPlaced;

    advanceBy(WINDOW_MS);
    try {
      const started = Date.now();
      await expect(tick({ closeLockTimeoutMs: 200 })).rejects.toMatchObject({ code: "55P03" });
      expect(Date.now() - started).toBeLessThan(3000);
      expect((await onlyRound()).status).toBe("open");
      expect(published).toEqual([]);
    } finally {
      release();
      await betting;
    }

    await tick({ closeLockTimeoutMs: 200 });
    expect((await onlyRound()).status).toBe("closed");
    expect(published).toEqual([{ type: "closed", roundId }]);
    const bets = await db
      .selectFrom("bets")
      .select("status")
      .where("round_id", "=", roundId)
      .execute();
    expect(bets).toEqual([{ status: "pending" }]);
  });

  it("fails loudly on a round status it does not know", async () => {
    await openRound();
    // Only this schema's copy of the constraint is dropped, and only for this test.
    await sql`alter table game_rounds drop constraint game_rounds_status_check`.execute(db);
    try {
      await sql`update game_rounds set status = 'paused'`.execute(db);
      await expect(tick()).rejects.toThrow("unexpected status: paused");
    } finally {
      await sql`delete from game_rounds where status = 'paused'`.execute(db);
      await sql`alter table game_rounds add constraint game_rounds_status_check
        check (status in ('open', 'closed', 'resolved', 'settled'))`.execute(db);
    }
  });

  it("publishing failures never fail the tick", async () => {
    const failing = {
      publish: async () => {
        throw new Error("redis down");
      },
      subscribe: () => () => {},
    };
    await expect(tick({ events: failing })).resolves.toBeUndefined();
    expect((await onlyRound()).status).toBe("open");
  });
});

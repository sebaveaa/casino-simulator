import { randomBytes } from "node:crypto";
import {
  CRASH_BETTING_WINDOW_MS,
  CRASH_INTERMISSION_MS,
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
import type { Db } from "../db/database";
import { toCrashRound } from "../games/crash/rounds";
import type { CrashBetResult } from "../games/crash/selection";
import type { CrashEventBus } from "../realtime/crash-events";
import { scopedKey, type WalletService } from "../wallet/wallet-service";

/** Bets settled per transaction, so one settlement never holds the house wallet for long. */
export const SETTLEMENT_BATCH_SIZE = 100;

/** How long takeoff waits for in-flight bets before giving up; a hung bet fails only that tick. */
export const CLOSE_LOCK_TIMEOUT_MS = 5000;

export type CrashCycleDeps = {
  wallet: WalletService;
  events: CrashEventBus;
  /** Overrides {@link SETTLEMENT_BATCH_SIZE}; tests use a small one. */
  settlementBatchSize?: number;
  /** Overrides the shared window/intermission; tests set them. */
  windowMs?: number;
  intermissionMs?: number;
  /** Asked only before opening a new round; false skips the tick (no Redis, no new round). */
  canOpenRound?: () => Promise<boolean>;
};

export type Clock = () => Date | Promise<Date>;

/**
 * Runs one step of a crash game's round lifecycle (PLAN-CRASH §5.1): opens a round when none is
 * active, or moves the active one one transition forward (`open -> closed -> resolved -> settled`).
 * Each step is one transaction and its events are published only after it commits, the same shape
 * as `advanceRaces`. The game is a parameter, so one worker drives `dino-crash` and `aviator`
 * independently; the open advisory lock keys on the game, so each game has at most one active round.
 *
 * `now` defaults to the database clock (`clock_timestamp()`), the one cash-outs are checked against.
 */
export async function advanceCrash(
  db: Db,
  game: CrashGame,
  deps: CrashCycleDeps,
  now?: Clock,
): Promise<void> {
  const events = await db.transaction().execute(async (trx) => {
    const readClock = now ?? (() => databaseNow(trx));
    return step(trx, game, deps, readClock);
  });
  for (const event of events) {
    try {
      await deps.events.publish(game, event);
    } catch (error) {
      // The database already holds the transition; clients catch up from the REST endpoints.
      console.error("crash event publish failed:", error);
    }
  }
}

async function databaseNow(trx: Db): Promise<Date> {
  const result = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(trx);
  return (result.rows[0] as { now: Date }).now;
}

async function step(
  trx: Db,
  game: CrashGame,
  deps: CrashCycleDeps,
  readClock: Clock,
): Promise<CrashEvent[]> {
  const active = await trx
    .selectFrom("game_rounds")
    .select(["id", "status", "closes_at", "server_seed"])
    .where("game", "=", game)
    .where("status", "!=", "settled")
    .orderBy("opens_at")
    .orderBy("id")
    .limit(1)
    .executeTakeFirst();
  const now = await readClock();

  if (!active) return openRound(trx, game, deps, now);
  switch (active.status) {
    case "open":
      return now >= active.closes_at ? takeoff(trx, active.id) : [];
    case "closed": {
      const crash = resolveCrash(
        createRng(await computeRoundOutcome(active.server_seed, active.id)),
      );
      const impactAt = active.closes_at.getTime() + impactAtMs(crash.crashHundredths);
      return now.getTime() >= impactAt ? resolveRound(trx, active.id, crash, now) : [];
    }
    case "resolved":
      return settleBatch(trx, deps, active.id, now);
    default:
      // The query excludes `settled`; anything else means the schema and this code disagree.
      throw new Error(`Round ${active.id} has an unexpected status: ${active.status}`);
  }
}

async function openRound(
  trx: Db,
  game: CrashGame,
  deps: CrashCycleDeps,
  now: Date,
): Promise<CrashEvent[]> {
  // Before the advisory lock, so a slow check never holds it.
  if (deps.canOpenRound && !(await deps.canOpenRound())) return [];

  // Keyed on the game and the schema, so the two games never contend and isolated test schemas
  // do not contend with each other.
  const lock = await sql<{ acquired: boolean }>`
    select pg_try_advisory_xact_lock(
      hashtext('casino:crash:open:' || ${game} || ':' || current_schema())
    ) as acquired`.execute(trx);
  if (!lock.rows[0]?.acquired) return [];

  // Re-checked under the lock: this statement sees a round another worker has just committed.
  const active = await trx
    .selectFrom("game_rounds")
    .select("id")
    .where("game", "=", game)
    .where(sql<boolean>`status <> 'settled'`)
    .limit(1)
    .executeTakeFirst();
  if (active) return [];

  const intermissionMs = deps.intermissionMs ?? CRASH_INTERMISSION_MS;
  if (intermissionMs > 0) {
    const last = await trx
      .selectFrom("game_rounds")
      .select("settled_at")
      .where("game", "=", game)
      .where(sql<boolean>`status = 'settled'`)
      .orderBy("settled_at", "desc")
      .limit(1)
      .executeTakeFirst();
    const reopensAt = last?.settled_at ? last.settled_at.getTime() + intermissionMs : 0;
    if (reopensAt > now.getTime()) return [];
  }

  const serverSeed = randomBytes(32).toString("hex");
  const windowMs = deps.windowMs ?? CRASH_BETTING_WINDOW_MS;
  const row = await trx
    .insertInto("game_rounds")
    .values({
      game,
      status: "open",
      server_seed: serverSeed,
      server_seed_hash: await hashServerSeed(serverSeed),
      opens_at: now,
      closes_at: new Date(now.getTime() + windowMs),
    })
    .returning(["id", "status", "opens_at", "closes_at", "server_seed_hash"])
    .executeTakeFirstOrThrow();
  // The seed stays secret until the round is resolved.
  const round = toCrashRound({ ...row, server_seed: null, result: null });
  return [{ type: "opened", round }];
}

async function takeoff(trx: Db, roundId: string): Promise<CrashEvent[]> {
  // SET does not take parameters; the value is an integer number of milliseconds.
  await sql`set local lock_timeout = ${sql.raw(String(CLOSE_LOCK_TIMEOUT_MS))}`.execute(trx);
  // Plain FOR UPDATE waits for in-flight bets (FOR SHARE); after the wait the status filter is
  // re-evaluated, so a takeoff another worker already made is skipped.
  const round = await trx
    .selectFrom("game_rounds")
    .select(["id", "closes_at"])
    .where("id", "=", roundId)
    .where("status", "=", "open")
    .forUpdate()
    .executeTakeFirst();
  if (!round) return [];
  await trx
    .updateTable("game_rounds")
    .set({ status: "closed" })
    .where("id", "=", roundId)
    .execute();
  return [{ type: "takeoff", roundId, startedAt: round.closes_at.toISOString() }];
}

async function resolveRound(
  trx: Db,
  roundId: string,
  crash: CrashResult,
  now: Date,
): Promise<CrashEvent[]> {
  const round = await trx
    .selectFrom("game_rounds")
    .select(["id", "server_seed"])
    .where("id", "=", roundId)
    .where("status", "=", "closed")
    .forUpdate()
    .skipLocked()
    .executeTakeFirst();
  if (!round) return [];

  await trx
    .updateTable("game_rounds")
    // Serialized by hand: the driver would send a JS object as-is, not as jsonb text.
    .set({ status: "resolved", result: JSON.stringify(crash), resolved_at: now })
    .where("id", "=", roundId)
    .execute();
  return [{ type: "impact", roundId, result: crash, serverSeed: round.server_seed }];
}

/**
 * Settles up to one batch of `pending` bets. Bets that cashed out through the API are already
 * `settled`, so only the ones still in the air are here: on an impact they all lose, and on a cap
 * they are all paid 20.00x (PLAN-CRASH §3.5). A payout is keyed by bet and looked up before it is
 * written, so a batch re-run after a crash never pays twice. The round becomes `settled` in the
 * batch that leaves no `pending` bet.
 */
async function settleBatch(
  trx: Db,
  deps: CrashCycleDeps,
  roundId: string,
  now: Date,
): Promise<CrashEvent[]> {
  const round = await trx
    .selectFrom("game_rounds")
    .select(["id", "result"])
    .where("id", "=", roundId)
    .where("status", "=", "resolved")
    .forUpdate()
    .skipLocked()
    .executeTakeFirst();
  if (!round) return [];
  const result = crashResultSchema.parse(round.result);
  const isCap = result.outcome === "cap";

  const bets = await trx
    .selectFrom("bets")
    .select(["id", "user_id", "stake"])
    .where("round_id", "=", roundId)
    .where("status", "=", "pending")
    .orderBy("id")
    .limit(deps.settlementBatchSize ?? SETTLEMENT_BATCH_SIZE)
    .forUpdate()
    .skipLocked()
    .execute();

  const settled = bets.map((bet) => ({
    ...bet,
    payout: isCap ? crashPayout(bet.stake, MAX_MULTIPLIER_HUNDREDTHS) : 0n,
  }));

  // On a cap every still-pending bet is paid; lock those wallets up front (ascending id), then the
  // house is the last lock, as everywhere else.
  const winners = isCap ? [...new Set(settled.map((bet) => bet.user_id))] : [];
  if (winners.length > 0) {
    await trx
      .selectFrom("wallets")
      .select("id")
      .where("user_id", "in", winners)
      .orderBy("id")
      .forUpdate()
      .execute();
  }

  const betResult: CrashBetResult = isCap
    ? { outcome: "cap", atHundredths: MAX_MULTIPLIER_HUNDREDTHS }
    : { outcome: "lost" };
  for (const bet of settled) {
    if (bet.payout > 0n) {
      const idempotencyKey = scopedKey("crash-payout", bet.user_id, bet.id);
      if (!(await deps.wallet.findTransaction(trx, idempotencyKey))) {
        await deps.wallet.transfer(trx, {
          from: "house",
          to: { userId: bet.user_id },
          amount: bet.payout,
          type: "payout",
          idempotencyKey,
          betId: bet.id,
        });
      }
    }
    await trx
      .updateTable("bets")
      .set({
        status: "settled",
        payout: bet.payout,
        settled_at: now,
        result: JSON.stringify(betResult),
      })
      .where("id", "=", bet.id)
      .execute();
  }

  // Counted without SKIP LOCKED: a bet locked elsewhere is still pending and keeps the round open.
  const pending = await trx
    .selectFrom("bets")
    .select("id")
    .where("round_id", "=", roundId)
    .where("status", "=", "pending")
    .limit(1)
    .executeTakeFirst();
  if (pending) return [];

  await trx
    .updateTable("game_rounds")
    .set({ status: "settled", settled_at: now })
    .where("id", "=", roundId)
    .execute();
  return [{ type: "settled", roundId }];
}

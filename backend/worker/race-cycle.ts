import { randomBytes } from "node:crypto";
import {
  computeRoundOutcome,
  createRng,
  hashServerSeed,
  type RaceEvent,
  type RaceResult,
  racePayout,
  raceResultSchema,
  races,
  resolveRace,
} from "@casino/shared";
import { sql } from "kysely";
import type { Db } from "../db/database";
import { toRaceRound } from "../games/races/rounds";
import { raceSelectionSchema } from "../games/races/selection";
import type { Config } from "../platform/config";
import type { RaceEventBus } from "../realtime/race-events";
import { scopedKey, type WalletService } from "../wallet/wallet-service";

/** Bets settled per transaction, so one settlement never holds the house wallet for long. */
export const SETTLEMENT_BATCH_SIZE = 100;

/**
 * How long a close waits for in-flight bets before giving up. A bet transaction that hangs then
 * only fails that tick (the loop logs it and the next tick retries), instead of stalling the loop.
 */
export const CLOSE_LOCK_TIMEOUT_MS = 5000;

export type RaceCycleDeps = {
  wallet: WalletService;
  events: RaceEventBus;
  config: Pick<Config, "raceWindowMs" | "raceDurationMs" | "raceIntermissionMs">;
  /** Overrides {@link SETTLEMENT_BATCH_SIZE}; tests use a small one. */
  settlementBatchSize?: number;
  /** Overrides {@link CLOSE_LOCK_TIMEOUT_MS}; tests use a short one. */
  closeLockTimeoutMs?: number;
  /**
   * Asked only before opening a new round; false skips the tick. The worker passes a Redis
   * health check: without live broadcast no new race opens, while bets already placed still
   * close, resolve and settle. Defaults to always true.
   */
  canOpenRound?: () => Promise<boolean>;
};

export type Clock = () => Date | Promise<Date>;

/**
 * Runs one step of the race lifecycle (README §4.3): opens a round when none is active, or moves
 * the active one a single transition forward (`open → closed → resolved → settled`). Settling a
 * batch of bets counts as one step; the round becomes `settled` in the batch that leaves no bet
 * `pending`. Each step is one transaction, and its events are published only after it commits.
 *
 * Several workers may call this at once. The round row is the mutex: transitions take it
 * `FOR UPDATE SKIP LOCKED`, so a worker that finds it locked does nothing. The close is the
 * exception: it waits for the lock, because in-flight bets hold the round `FOR SHARE`
 * (see `placeRaceBet`) and must land before betting closes; it then re-checks the status, so a
 * close another worker already made is not repeated. Opening has no row to lock, so it takes a
 * transaction-scoped advisory lock and re-checks that no round is active. It also waits out the
 * intermission (`raceIntermissionMs`) after the latest settlement, so the outcome of a race stays
 * on screen before the next round opens.
 *
 * Lock order is always round, then player wallets, then the house wallet. `placeRaceBet` takes
 * round then player then house, and roulette takes player then house, so none of them can form a
 * cycle with settlement.
 *
 * `now` defaults to the database clock (`clock_timestamp()`), the one bets are checked against.
 */
export async function advanceRaces(db: Db, deps: RaceCycleDeps, now?: Clock): Promise<void> {
  const events = await db.transaction().execute(async (trx) => {
    const readClock = now ?? (() => databaseNow(trx));
    return step(trx, deps, readClock);
  });
  for (const event of events) {
    try {
      await deps.events.publish(event);
    } catch (error) {
      // The database already holds the transition; clients catch up from the REST endpoints.
      console.error("race event publish failed:", error);
    }
  }
}

async function databaseNow(trx: Db): Promise<Date> {
  const result = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(trx);
  return (result.rows[0] as { now: Date }).now;
}

async function step(trx: Db, deps: RaceCycleDeps, readClock: Clock): Promise<RaceEvent[]> {
  // Unlocked read to pick the transition; each transition locks and re-checks the row itself.
  // The oldest active round goes first, so a backlog is drained before anything new opens.
  const active = await trx
    .selectFrom("game_rounds")
    .select(["id", "status", "closes_at", "resolved_at"])
    .where("game", "=", races.id)
    .where("status", "!=", "settled")
    .orderBy("opens_at")
    .orderBy("id")
    .limit(1)
    .executeTakeFirst();
  const now = await readClock();

  if (!active) return openRound(trx, deps, now);
  switch (active.status) {
    case "open":
      return now >= active.closes_at
        ? closeRound(trx, active.id, deps.closeLockTimeoutMs ?? CLOSE_LOCK_TIMEOUT_MS)
        : [];
    case "closed":
      return resolveRound(trx, active.id, now);
    case "resolved": {
      if (active.resolved_at === null) {
        throw new Error(`Round ${active.id} is resolved but has no resolved_at`);
      }
      const settlesAt = active.resolved_at.getTime() + deps.config.raceDurationMs;
      return now.getTime() >= settlesAt ? settleBatch(trx, deps, active.id, now) : [];
    }
    default:
      // The query excludes `settled`; anything else means the schema and this code disagree.
      throw new Error(`Round ${active.id} has an unexpected status: ${active.status}`);
  }
}

async function openRound(trx: Db, deps: RaceCycleDeps, now: Date): Promise<RaceEvent[]> {
  // Before the advisory lock, so a slow check never holds it.
  if (deps.canOpenRound && !(await deps.canOpenRound())) return [];

  // Scoped to the current schema so isolated test schemas do not contend with each other.
  const lock = await sql<{ acquired: boolean }>`
    select pg_try_advisory_xact_lock(hashtext('casino:races:open:' || current_schema())) as acquired`.execute(
    trx,
  );
  if (!lock.rows[0]?.acquired) return [];

  // Re-checked under the lock: this statement sees a round another worker has just committed.
  const active = await trx
    .selectFrom("game_rounds")
    .select("id")
    .where("game", "=", races.id)
    .where(sql<boolean>`status <> 'settled'`)
    .limit(1)
    .executeTakeFirst();
  if (active) return [];

  // The intermission is measured with the same clock the tick uses, from the latest settlement.
  if (deps.config.raceIntermissionMs > 0) {
    const last = await trx
      .selectFrom("game_rounds")
      .select("settled_at")
      .where("game", "=", races.id)
      .where(sql<boolean>`status = 'settled'`)
      .orderBy("settled_at", "desc")
      .limit(1)
      .executeTakeFirst();
    const reopensAt = last?.settled_at
      ? last.settled_at.getTime() + deps.config.raceIntermissionMs
      : 0;
    if (reopensAt > now.getTime()) return [];
  }

  const serverSeed = randomBytes(32).toString("hex");
  const row = await trx
    .insertInto("game_rounds")
    .values({
      game: races.id,
      status: "open",
      server_seed: serverSeed,
      server_seed_hash: await hashServerSeed(serverSeed),
      opens_at: now,
      closes_at: new Date(now.getTime() + deps.config.raceWindowMs),
    })
    .returning([
      "id",
      "status",
      "opens_at",
      "closes_at",
      "server_seed_hash",
      "result",
      "resolved_at",
    ])
    .executeTakeFirstOrThrow();
  // The seed stays secret until the round is resolved.
  const round = toRaceRound({ ...row, server_seed: null }, deps.config.raceDurationMs);
  return [{ type: "opened", round }];
}

async function closeRound(trx: Db, roundId: string, lockTimeoutMs: number): Promise<RaceEvent[]> {
  // SET does not take parameters; the value is an integer number of milliseconds.
  await sql`set local lock_timeout = ${sql.raw(String(Math.max(1, Math.trunc(lockTimeoutMs))))}`.execute(
    trx,
  );
  // Plain FOR UPDATE: waits for in-flight bets (FOR SHARE). After the wait PostgreSQL re-evaluates
  // the status filter on the latest row, so a round another worker closed meanwhile is skipped.
  const round = await trx
    .selectFrom("game_rounds")
    .select("id")
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
  return [{ type: "closed", roundId }];
}

async function resolveRound(trx: Db, roundId: string, now: Date): Promise<RaceEvent[]> {
  const round = await trx
    .selectFrom("game_rounds")
    .select(["id", "server_seed"])
    .where("id", "=", roundId)
    .where("status", "=", "closed")
    .forUpdate()
    .skipLocked()
    .executeTakeFirst();
  if (!round) return [];

  const result = resolveRace(createRng(await computeRoundOutcome(round.server_seed, round.id)));
  await trx
    .updateTable("game_rounds")
    // Serialized by hand: the driver would send a JS object as-is, not as jsonb text.
    .set({ status: "resolved", result: JSON.stringify(result), resolved_at: now })
    .where("id", "=", roundId)
    .execute();
  return [{ type: "result", roundId, result, serverSeed: round.server_seed }];
}

/**
 * Settles up to one batch of `pending` bets. Locks are taken round, bets, every winner's wallet
 * (ascending id), and only then the house wallet, inside the first `transfer`. Locking all the
 * winners up front matters: once a payout has locked the house, locking the next winner would be
 * house-then-player, the reverse of a roulette bet, and the two could deadlock. A payout is keyed by bet, and is looked up before it is written,
 * so a batch re-run after a crash never pays twice.
 */
async function settleBatch(
  trx: Db,
  deps: RaceCycleDeps,
  roundId: string,
  now: Date,
): Promise<RaceEvent[]> {
  const round = await trx
    .selectFrom("game_rounds")
    .select(["id", "result"])
    .where("id", "=", roundId)
    .where("status", "=", "resolved")
    .forUpdate()
    .skipLocked()
    .executeTakeFirst();
  if (!round) return [];
  const result: RaceResult = raceResultSchema.parse(round.result);

  const bets = await trx
    .selectFrom("bets")
    .select(["id", "user_id", "stake", "selection"])
    .where("round_id", "=", roundId)
    .where("status", "=", "pending")
    .orderBy("id")
    .limit(deps.settlementBatchSize ?? SETTLEMENT_BATCH_SIZE)
    .forUpdate()
    .skipLocked()
    .execute();

  const settled = bets.map((bet) => {
    const { animal } = raceSelectionSchema.parse(bet.selection);
    const won = animal === result.winner;
    return { ...bet, won, payout: won ? racePayout(bet.stake) : 0n };
  });

  // Losers have no ledger movement, so only the winners' wallets are locked.
  const winners = [...new Set(settled.filter((bet) => bet.won).map((bet) => bet.user_id))];
  if (winners.length > 0) {
    await trx
      .selectFrom("wallets")
      .select("id")
      .where("user_id", "in", winners)
      .orderBy("id")
      .forUpdate()
      .execute();
  }

  for (const { won, payout, ...bet } of settled) {
    if (won) {
      const idempotencyKey = scopedKey("race-payout", bet.user_id, bet.id);
      if (!(await deps.wallet.findTransaction(trx, idempotencyKey))) {
        await deps.wallet.transfer(trx, {
          from: "house",
          to: { userId: bet.user_id },
          amount: payout,
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
        payout,
        settled_at: now,
        result: JSON.stringify({ winner: result.winner, won }),
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

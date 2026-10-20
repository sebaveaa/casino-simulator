import { type RaceRound, raceResultSchema, races } from "@casino/shared";
import { sql } from "kysely";
import type { Db } from "../../db/database";
import type { Json, RoundStatus } from "../../db/schema";
import { raceSelectionSchema } from "./selection";

/** The columns `toRaceRound` reads. `server_seed` is already null unless the round is resolved. */
export type RaceRoundRow = {
  id: string;
  status: RoundStatus;
  opens_at: Date;
  closes_at: Date;
  server_seed_hash: string;
  server_seed: string | null;
  result: Json | null;
  resolved_at: Date | null;
};

/**
 * Explicit columns, never `select *`. The seed is read through a CASE so that the database itself
 * returns null while the round is `open` or `closed`: a leak would need two independent mistakes.
 */
function selectRounds(db: Db) {
  return db
    .selectFrom("game_rounds")
    .select([
      "id",
      "status",
      "opens_at",
      "closes_at",
      "server_seed_hash",
      "result",
      "resolved_at",
      "settled_at",
      sql<string | null>`case when status in ('resolved', 'settled') then server_seed end`.as(
        "server_seed",
      ),
    ])
    .where("game", "=", races.id);
}

/**
 * Maps a row to the public shape. `serverSeed` and `result` are included only when the status is
 * `resolved` or `settled`. `settlesAt` is `resolved_at + raceDurationMs` in both of those states
 * (the planned instant, not the real `settled_at`), so the client countdown never jumps.
 */
export function toRaceRound(row: RaceRoundRow, raceDurationMs: number): RaceRound {
  const round: RaceRound = {
    id: row.id,
    status: row.status,
    opensAt: row.opens_at.toISOString(),
    closesAt: row.closes_at.toISOString(),
    serverSeedHash: row.server_seed_hash,
  };
  if (row.status === "resolved" || row.status === "settled") {
    if (row.server_seed === null || row.result === null || row.resolved_at === null) {
      throw new Error(`Round ${row.id} is ${row.status} but has no seed, result or resolved_at`);
    }
    round.serverSeed = row.server_seed;
    round.result = raceResultSchema.parse(row.result);
    round.settlesAt = new Date(row.resolved_at.getTime() + raceDurationMs).toISOString();
  }
  return round;
}

/**
 * The round the lobby shows: the most recent one that is not `settled` or, if there is none, the
 * latest `settled` one during the intermission (settled less than `raceIntermissionMs` ago, by the
 * database clock), so the outcome stays on screen until the next round opens and a player who
 * reconnects right after settlement still sees it. Otherwise `null`; with an intermission of 0
 * a settled round is never current.
 */
export async function getCurrentRound(
  db: Db,
  { raceDurationMs, raceIntermissionMs }: { raceDurationMs: number; raceIntermissionMs: number },
): Promise<RaceRound | null> {
  const active = await selectRounds(db)
    .where("status", "!=", "settled")
    .orderBy("opens_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (active) return toRaceRound(active, raceDurationMs);

  const recent = await selectRounds(db)
    .where("status", "=", "settled")
    .where(
      sql<boolean>`settled_at > now() - (${raceIntermissionMs}::double precision * interval '1 millisecond')`,
    )
    .orderBy("settled_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return recent ? toRaceRound(recent, raceDurationMs) : null;
}

export async function getRound(
  db: Db,
  roundId: string,
  { raceDurationMs }: { raceDurationMs: number },
): Promise<RaceRound | undefined> {
  const row = await selectRounds(db).where("id", "=", roundId).executeTakeFirst();
  return row ? toRaceRound(row, raceDurationMs) : undefined;
}

/** The database clock, so client countdowns use the same time the worker schedules with. */
export async function getDatabaseNow(db: Db): Promise<string> {
  const { now } = await sql<{ now: Date }>`select now() as now`
    .execute(db)
    .then((result) => result.rows[0] as { now: Date });
  return now.toISOString();
}

export type PlayerRaceBet = { animal: number; stake: bigint; payout: bigint | null };

/** The caller's bet in a round. The payout stays null until the bet is settled. */
export async function getPlayerBet(
  db: Db,
  userId: string,
  roundId: string,
): Promise<PlayerRaceBet | null> {
  const bet = await db
    .selectFrom("bets")
    .select(["stake", "selection", "payout", "status"])
    .where("round_id", "=", roundId)
    .where("user_id", "=", userId)
    .where("game", "=", races.id)
    .executeTakeFirst();
  if (!bet) return null;
  const { animal } = raceSelectionSchema.parse(bet.selection);
  return { animal, stake: bet.stake, payout: bet.status === "settled" ? bet.payout : null };
}

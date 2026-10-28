import {
  type CrashGame,
  type CrashPlayerBet,
  type CrashRound,
  crashResultSchema,
  toAmount,
} from "@casino/shared";
import { sql } from "kysely";
import type { Db } from "../../db/database";
import type { Json, RoundStatus } from "../../db/schema";
import { crashBetResultSchema } from "./selection";

/** The columns `toCrashRound` reads. `server_seed` is already null unless the round is resolved. */
export type CrashRoundRow = {
  id: string;
  status: RoundStatus;
  opens_at: Date;
  closes_at: Date;
  server_seed_hash: string;
  server_seed: string | null;
  result: Json | null;
};

/**
 * Explicit columns, never `select *`. The seed is read through a CASE so that the database itself
 * returns null while the round is `open` or `closed`: a leak would need two independent mistakes.
 */
function selectRounds(db: Db, game: CrashGame) {
  return db
    .selectFrom("game_rounds")
    .select([
      "id",
      "status",
      "opens_at",
      "closes_at",
      "server_seed_hash",
      "result",
      "settled_at",
      sql<string | null>`case when status in ('resolved', 'settled') then server_seed end`.as(
        "server_seed",
      ),
    ])
    .where("game", "=", game);
}

/**
 * Maps a row to the public shape. `serverSeed` and `result` are included only when the status is
 * `resolved` or `settled`; `closesAt` is the takeoff instant.
 */
export function toCrashRound(row: CrashRoundRow): CrashRound {
  const round: CrashRound = {
    id: row.id,
    status: row.status,
    opensAt: row.opens_at.toISOString(),
    closesAt: row.closes_at.toISOString(),
    serverSeedHash: row.server_seed_hash,
  };
  if (row.status === "resolved" || row.status === "settled") {
    if (row.server_seed === null || row.result === null) {
      throw new Error(`Round ${row.id} is ${row.status} but has no seed or result`);
    }
    round.serverSeed = row.server_seed;
    round.result = crashResultSchema.parse(row.result);
  }
  return round;
}

/**
 * The round the lobby shows: the most recent one that is not `settled` or, if there is none, the
 * latest `settled` one during the intermission (settled less than `intermissionMs` ago, by the
 * database clock), so the outcome stays on screen until the next round opens. The status predicates
 * are literal SQL, spelled as in the race partial indexes, so the planner can use them.
 */
export async function getCurrentCrashRound(
  db: Db,
  game: CrashGame,
  { intermissionMs }: { intermissionMs: number },
): Promise<CrashRound | null> {
  const active = await selectRounds(db, game)
    .where(sql<boolean>`status <> 'settled'`)
    .orderBy("opens_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (active) return toCrashRound(active);

  const recent = await selectRounds(db, game)
    .where(sql<boolean>`status = 'settled'`)
    .where(
      sql<boolean>`settled_at > now() - (${intermissionMs}::double precision * interval '1 millisecond')`,
    )
    .orderBy("settled_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return recent ? toCrashRound(recent) : null;
}

/** The latest finished rounds (resolved or settled), newest first, each with its revealed seed. */
export async function getCrashHistory(
  db: Db,
  game: CrashGame,
  limit: number,
): Promise<CrashRound[]> {
  const rows = await selectRounds(db, game)
    .where(sql<boolean>`status in ('resolved', 'settled')`)
    .orderBy("opens_at", "desc")
    .limit(limit)
    .execute();
  return rows.map(toCrashRound);
}

/** The database clock, so client countdowns use the same time the worker schedules with. */
export async function getDatabaseNow(db: Db): Promise<string> {
  const { now } = await sql<{ now: Date }>`select now() as now`
    .execute(db)
    .then((result) => result.rows[0] as { now: Date });
  return now.toISOString();
}

/**
 * The caller's bet in a round, shaped for the API. `cashoutHundredths` is the multiplier paid when
 * the bet cashed out or was paid at the cap, and null otherwise; `payout` stays null until settled.
 */
export async function getPlayerCrashBet(
  db: Db,
  game: CrashGame,
  userId: string,
  roundId: string,
): Promise<CrashPlayerBet | null> {
  const bet = await db
    .selectFrom("bets")
    .select(["id", "stake", "status", "payout", "result"])
    .where("round_id", "=", roundId)
    .where("user_id", "=", userId)
    .where("game", "=", game)
    .executeTakeFirst();
  if (!bet) return null;

  const settled = bet.status === "settled";
  let cashoutHundredths: number | null = null;
  if (settled && bet.result !== null) {
    const result = crashBetResultSchema.parse(bet.result);
    if (result.outcome === "cashout" || result.outcome === "cap") {
      cashoutHundredths = result.atHundredths;
    }
  }
  return {
    betId: bet.id,
    stake: toAmount(bet.stake),
    status: settled ? "settled" : "pending",
    cashoutHundredths,
    payout: settled ? toAmount(bet.payout ?? 0n) : null,
  };
}

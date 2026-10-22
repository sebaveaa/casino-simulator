import {
  type ChickenRoadFinishedGame,
  type ChickenRoadGame,
  type ChickenRoadResult,
  chickenRoad,
  chickenRoadPayout,
  computeOutcome,
  createRng,
  LANE_COUNT,
  toAmount,
} from "@casino/shared";
import { sql } from "kysely";
import { z } from "zod";
import type { Db } from "../../db/database";
import { AppError } from "../../platform/errors";

/**
 * One entry per lane the player tried to cross, in order. A hit settles the game, so in a lost
 * game the last entry is the hit lane and every earlier one was crossed.
 */
const actionsSchema = z.array(
  z.object({ lane: z.number().int().min(1).max(LANE_COUNT), at: z.iso.datetime() }),
);
export type ChickenRoadActions = z.infer<typeof actionsSchema>;

/** A Chicken Road bet with the seed pair it was drawn from. */
export function selectGames(db: Db) {
  return (
    db
      .selectFrom("bets as b")
      .innerJoin("seed_pairs as s", "s.id", "b.seed_pair_id")
      .select([
        "b.id",
        "b.stake",
        "b.nonce",
        "b.actions",
        "b.payout",
        "b.status",
        "b.created_at",
        "s.id as seedPairId",
        "s.server_seed",
        "s.server_seed_hash",
        "s.client_seed",
      ])
      .where("b.game", "=", chickenRoad.id)
      // `bets_nonce_check`: a bet drawn from a seed pair always has a nonce.
      .$narrowType<{ nonce: number }>()
  );
}

export type GameRow = Awaited<
  ReturnType<ReturnType<typeof selectGames>["executeTakeFirstOrThrow"]>
>;

/** Locks the player's game (the bet row only, not its seed pair); `undefined` if there is none. */
export function findGameForUpdate(
  trx: Db,
  userId: string,
  gameId: string,
): Promise<GameRow | undefined> {
  return selectGames(trx)
    .where("b.id", "=", gameId)
    .where("b.user_id", "=", userId)
    .forUpdate("b")
    .executeTakeFirst();
}

/** Locks the player's game; 404 if the player has no such game. */
export async function lockGame(trx: Db, userId: string, gameId: string): Promise<GameRow> {
  const row = await findGameForUpdate(trx, userId, gameId);
  if (!row) throw new AppError("not_found", "Chicken Road game not found");
  return row;
}

/** The player's game in progress, locked; at most one exists (`bets_one_chicken_road_...`). */
export function lockGameInProgress(trx: Db, userId: string): Promise<GameRow | undefined> {
  return selectGames(trx)
    .where("b.user_id", "=", userId)
    .where("b.status", "=", "in_progress")
    .forUpdate("b")
    .executeTakeFirst();
}

export function parseActions(value: unknown): ChickenRoadActions {
  const result = actionsSchema.safeParse(value ?? []);
  if (!result.success) throw new Error("Stored Chicken Road actions are malformed");
  return result.data;
}

/** PostgreSQL's clock, the same for every backend instance; fixed for the whole transaction. */
export async function databaseNow(trx: Db): Promise<Date> {
  const { rows } = await sql<{ now: Date }>`select now() as now`.execute(trx);
  const now = rows[0]?.now;
  if (!now) throw new Error("now() returned no row");
  return now;
}

/**
 * The road of a game, recomputed from its seed (README §4.4, like the blackjack deck). The seed
 * pair id, nonce, server seed and client seed are written once and never updated, so the road
 * stays the same for the whole game.
 */
export async function roadOf(row: GameRow): Promise<ChickenRoadResult> {
  const outcome = await computeOutcome({
    serverSeed: row.server_seed,
    clientSeed: row.client_seed,
    nonce: row.nonce,
  });
  // `resolve` ignores the bet: the road is the same whatever the player does.
  return chickenRoad.resolve({ stake: row.stake, cashOutAt: LANE_COUNT }, createRng(outcome));
}

/**
 * The game as the API shows it, or `null` for a game that expired before its first lane and was
 * refunded: the contract has no state for it, so it is left out of current and history.
 */
export function toGame(row: GameRow): ChickenRoadGame | null {
  const actions = parseActions(row.actions);
  const base = {
    gameId: row.id,
    stake: toAmount(row.stake),
    fairness: {
      seedPairId: row.seedPairId,
      serverSeedHash: row.server_seed_hash,
      clientSeed: row.client_seed,
      nonce: row.nonce,
    },
  };
  const lanes = actions.length;

  if (row.status === "in_progress") {
    return {
      status: "in_progress",
      ...base,
      lanesCrossed: lanes,
      cashoutAmount: lanes === 0 ? "0" : toAmount(chickenRoadPayout(row.stake, lanes)),
    };
  }
  if (row.payout === null) throw new Error("A settled Chicken Road game has no payout");
  if (lanes === 0) return null;
  if (row.payout === 0n) {
    return { status: "lost", ...base, lanesCrossed: lanes - 1, hitLane: lanes, payout: "0" };
  }
  return {
    status: lanes === LANE_COUNT ? "completed" : "cashed_out",
    ...base,
    lanesCrossed: lanes,
    payout: toAmount(row.payout),
  } as ChickenRoadFinishedGame;
}

/** The player's game in progress, to restore it after a reload. */
export async function getCurrentChickenRoadGame(db: Db, userId: string) {
  const row = await selectGames(db)
    .where("b.user_id", "=", userId)
    .where("b.status", "=", "in_progress")
    .executeTakeFirst();
  const game = row ? toGame(row) : null;
  return game?.status === "in_progress" ? game : null;
}

/**
 * The player's latest finished games, newest first. A settled game with no lanes attempted can
 * only be a refund, so `jsonb_array_length > 0` leaves refunds out.
 */
export async function listChickenRoadHistory(
  db: Db,
  userId: string,
  limit: number,
): Promise<ChickenRoadFinishedGame[]> {
  const rows = await selectGames(db)
    .where("b.user_id", "=", userId)
    .where("b.status", "=", "settled")
    .where(sql<boolean>`jsonb_array_length(b.actions) > 0`)
    .orderBy("b.created_at", "desc")
    .orderBy("b.id", "desc")
    .limit(limit)
    .execute();
  return rows.flatMap((row) => {
    const game = toGame(row);
    return game && game.status !== "in_progress" ? [game] : [];
  });
}

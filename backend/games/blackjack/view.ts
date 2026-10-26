import {
  type BlackjackHand,
  type BlackjackHandState,
  type BlackjackInProgressHand,
  type BlackjackResult,
  type BlackjackSettledHand,
  blackjack,
  blackjackActionSchema,
  blackjackResultSchema,
  computeOutcome,
  createRng,
  describeCard,
  handValue,
  legalActions,
  type Money,
  playHand,
  shuffleShoe,
  toAmount,
} from "@casino/shared";
import { z } from "zod";
import type { Db } from "../../db/database";
import { AppError } from "../../platform/errors";

/** One entry per action the player took, in order, with PostgreSQL's time of the action. */
const actionsSchema = z.array(z.object({ action: blackjackActionSchema, at: z.iso.datetime() }));
export type BlackjackActions = z.infer<typeof actionsSchema>;

/** A Blackjack bet with the seed pair it was drawn from. */
export function selectHands(db: Db) {
  return (
    db
      .selectFrom("bets as b")
      .innerJoin("seed_pairs as s", "s.id", "b.seed_pair_id")
      .select([
        "b.id",
        "b.stake",
        "b.nonce",
        "b.actions",
        "b.result",
        "b.payout",
        "b.status",
        "b.created_at",
        "s.id as seedPairId",
        "s.server_seed",
        "s.server_seed_hash",
        "s.client_seed",
      ])
      .where("b.game", "=", blackjack.id)
      // `bets_nonce_check`: a bet drawn from a seed pair always has a nonce.
      .$narrowType<{ nonce: number }>()
  );
}

export type HandRow = Awaited<
  ReturnType<ReturnType<typeof selectHands>["executeTakeFirstOrThrow"]>
>;

/** Locks the player's hand (the bet row only, not its seed pair); `undefined` if there is none. */
export function findHandForUpdate(
  trx: Db,
  userId: string,
  handId: string,
): Promise<HandRow | undefined> {
  return selectHands(trx)
    .where("b.id", "=", handId)
    .where("b.user_id", "=", userId)
    .forUpdate("b")
    .executeTakeFirst();
}

/** Locks the player's hand; 404 if the player has no such hand. */
export async function lockHand(trx: Db, userId: string, handId: string): Promise<HandRow> {
  const row = await findHandForUpdate(trx, userId, handId);
  if (!row) throw new AppError("not_found", "Blackjack hand not found");
  return row;
}

/** The player's hand in progress, locked; at most one exists (`bets_one_blackjack_...`). */
export function lockHandInProgress(trx: Db, userId: string): Promise<HandRow | undefined> {
  return selectHands(trx)
    .where("b.user_id", "=", userId)
    .where("b.status", "=", "in_progress")
    .forUpdate("b")
    .executeTakeFirst();
}

export function parseActions(value: unknown): BlackjackActions {
  const result = actionsSchema.safeParse(value ?? []);
  if (!result.success) throw new Error("Stored Blackjack actions are malformed");
  return result.data;
}

/**
 * The stake the hand started with. `bets.stake` is the total wagered (README §3.4), so it doubles
 * when the player doubles.
 */
export function initialStake(row: HandRow): Money {
  const doubled = parseActions(row.actions).some((entry) => entry.action === "double");
  return doubled ? row.stake / 2n : row.stake;
}

/**
 * The shoe of a hand, recomputed from its seed (README §4.4: it is never stored). The seed pair
 * id, nonce, server seed and client seed are written once and never updated, so the shoe stays
 * the same for the whole hand.
 */
export async function shoeOf(row: HandRow): Promise<number[]> {
  const outcome = await computeOutcome({
    serverSeed: row.server_seed,
    clientSeed: row.client_seed,
    nonce: row.nonce,
  });
  return shuffleShoe(createRng(outcome));
}

/** The hand replayed from its shoe and the actions taken so far. */
export function replay(shoe: readonly number[], actions: BlackjackActions): BlackjackHandState {
  return playHand(
    shoe,
    actions.map((entry) => entry.action),
  );
}

function fieldsOf(row: HandRow, playerCards: readonly number[]) {
  return {
    handId: row.id,
    stake: toAmount(initialStake(row)),
    fairness: {
      seedPairId: row.seedPairId,
      serverSeedHash: row.server_seed_hash,
      clientSeed: row.client_seed,
      nonce: row.nonce,
    },
    playerCards: playerCards.map(describeCard),
    playerTotal: handValue(playerCards),
  };
}

/**
 * A hand waiting for the player, as the API shows it: only the dealer's up card, never the hole
 * card or the shoe.
 */
export function toInProgressHand(
  row: HandRow,
  state: BlackjackHandState,
  actionCount: number,
): BlackjackInProgressHand {
  const upCard = state.dealerCards[0];
  if (state.outcome !== null || upCard === undefined) {
    throw new Error("A Blackjack hand in progress has an outcome");
  }
  return {
    status: "player_turn",
    ...fieldsOf(row, state.playerCards),
    dealerUpCard: describeCard(upCard),
    actionCount,
    canDouble: legalActions(state).includes("double"),
  };
}

/** A settled hand from its stored result, with every card. */
export function toSettledHand(row: HandRow): BlackjackSettledHand {
  if (row.payout === null) throw new Error("A settled Blackjack hand has no payout");
  const result: BlackjackResult = blackjackResultSchema.parse(row.result);
  return {
    status: "settled",
    ...fieldsOf(row, result.playerCards),
    dealerCards: result.dealerCards.map(describeCard),
    dealerTotal: handValue(result.dealerCards),
    doubled: result.doubled,
    outcome: result.outcome,
    totalStake: toAmount(row.stake),
    payout: toAmount(row.payout),
  };
}

/** The hand as the API shows it, in either state. */
export async function toHand(row: HandRow): Promise<BlackjackHand> {
  if (row.status !== "in_progress") return toSettledHand(row);
  const actions = parseActions(row.actions);
  return toInProgressHand(row, replay(await shoeOf(row), actions), actions.length);
}

/** The player's hand in progress, to restore it after a reload. */
export async function getCurrentBlackjackHand(
  db: Db,
  userId: string,
): Promise<BlackjackInProgressHand | null> {
  const row = await selectHands(db)
    .where("b.user_id", "=", userId)
    .where("b.status", "=", "in_progress")
    .executeTakeFirst();
  if (!row) return null;
  const actions = parseActions(row.actions);
  return toInProgressHand(row, replay(await shoeOf(row), actions), actions.length);
}

/** The player's latest settled hands, newest first. */
export async function listBlackjackHistory(
  db: Db,
  userId: string,
  limit: number,
): Promise<BlackjackSettledHand[]> {
  const rows = await selectHands(db)
    .where("b.user_id", "=", userId)
    .where("b.status", "=", "settled")
    .orderBy("b.created_at", "desc")
    .orderBy("b.id", "desc")
    .limit(limit)
    .execute();
  return rows.map(toSettledHand);
}

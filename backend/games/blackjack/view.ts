import {
  type BlackjackHand,
  type BlackjackHandState,
  type BlackjackInProgressHand,
  type BlackjackResult,
  type BlackjackSettledHand,
  blackjack,
  blackjackActionSchema,
  blackjackHandPayout,
  blackjackResultSchema,
  blackjackWagerCount,
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
        "b.shoe_id",
        "b.card_offset",
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
 * The stake the round started with. `bets.stake` is the total on the table (README §3.4): the first
 * stake, plus one per split and per double, so it is the initial stake times the wager count of the
 * actions stored with it.
 */
export function initialStake(row: HandRow): Money {
  const actions = parseActions(row.actions).map((entry) => entry.action);
  return row.stake / blackjackWagerCount(actions);
}

/**
 * The cards of a hand, from its first one on: its shoe recomputed from the seed (README §4.4: it
 * is never stored), from the hand's offset in it. The seed pair, nonce and offset are written once
 * and never updated, so the cards stay the same for the whole hand. A hand from before the
 * continuous shoe has no offset: its own shoe, from the top.
 */
export async function shoeOf(row: HandRow): Promise<number[]> {
  const outcome = await computeOutcome({
    serverSeed: row.server_seed,
    clientSeed: row.client_seed,
    nonce: row.nonce,
  });
  return shuffleShoe(createRng(outcome)).slice(row.card_offset ?? 0);
}

/** The hand replayed from its shoe and the actions taken so far. */
export function replay(shoe: readonly number[], actions: BlackjackActions): BlackjackHandState {
  return playHand(
    shoe,
    actions.map((entry) => entry.action),
  );
}

function fieldsOf(row: HandRow) {
  return {
    handId: row.id,
    stake: toAmount(initialStake(row)),
    fairness: {
      seedPairId: row.seedPairId,
      serverSeedHash: row.server_seed_hash,
      clientSeed: row.client_seed,
      nonce: row.nonce,
      shoeId: row.shoe_id,
      cardOffset: row.card_offset ?? 0,
    },
  };
}

/**
 * A round waiting for the player, as the API shows it: the player's hands, and only the dealer's
 * up card, never the hole card or the shoe.
 */
export function toInProgressHand(
  row: HandRow,
  state: BlackjackHandState,
  actionCount: number,
): BlackjackInProgressHand {
  const upCard = state.dealerCards[0];
  if (state.finished || upCard === undefined) {
    throw new Error("A Blackjack round in progress is finished");
  }
  const legal = legalActions(state);
  return {
    status: "player_turn",
    ...fieldsOf(row),
    playerHands: state.playerHands.map((hand) => ({
      cards: hand.cards.map(describeCard),
      total: handValue(hand.cards),
      doubled: hand.doubled,
    })),
    activeHand: state.active,
    dealerUpCard: describeCard(upCard),
    actionCount,
    canDouble: legal.includes("double"),
    canSplit: legal.includes("split"),
  };
}

/** A settled round from its stored result, with every card and what each hand paid. */
export function toSettledHand(row: HandRow): BlackjackSettledHand {
  if (row.payout === null) throw new Error("A settled Blackjack hand has no payout");
  const result: BlackjackResult = blackjackResultSchema.parse(row.result);
  const stake = initialStake(row);
  return {
    status: "settled",
    ...fieldsOf(row),
    playerHands: result.playerHands.map((hand) => ({
      cards: hand.cards.map(describeCard),
      total: handValue(hand.cards),
      doubled: hand.doubled,
      outcome: hand.outcome,
      payout: toAmount(blackjackHandPayout(stake, hand)),
    })),
    dealerCards: result.dealerCards.map(describeCard),
    dealerTotal: handValue(result.dealerCards),
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

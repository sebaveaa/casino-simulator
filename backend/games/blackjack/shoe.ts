import { BLACKJACK_CUT_CARD, type BlackjackShoe, roundCardCount, SHOE_SIZE } from "@casino/shared";
import type { Selectable } from "kysely";
import type { Db } from "../../db/database";
import type { BlackjackShoesTable } from "../../db/schema";
import type { SeedPairService } from "../../rng/seed-pair-service";
import { type HandRow, parseActions, replay, selectHands, shoeOf } from "./view";

export type ShoeRow = Selectable<BlackjackShoesTable>;

/**
 * The player's shoe for a new hand (#66): the active one, or a new one. Run it inside the start's
 * transaction, after the funds check, so a refused start opens no shoe and burns no nonce.
 *
 * The active shoe is locked first, then the user's row, as `draw` and `rotate` do (lock order
 * wallets -> bets -> blackjack_shoes -> users -> seed_pairs). Holding the user's row serializes
 * this with `rotate`: either the rotation committed before and the shoe's seed pair reads as
 * revealed here, so the shoe is retired and a new one opens from the new pair; or this hand
 * commits first and the rotation is refused while the hand is in progress. A hand in progress is
 * never dealt from a seed whose server seed is public.
 */
export async function takeShoe(
  trx: Db,
  seedPairs: SeedPairService,
  userId: string,
  now: Date,
): Promise<ShoeRow> {
  const active = await trx
    .selectFrom("blackjack_shoes")
    .selectAll()
    .where("user_id", "=", userId)
    .where("status", "=", "active")
    .forUpdate()
    .executeTakeFirst();
  await trx
    .selectFrom("users")
    .select("id")
    .where("id", "=", userId)
    .forNoKeyUpdate()
    .executeTakeFirst();

  if (active) {
    const pair = await trx
      .selectFrom("seed_pairs")
      .select("revealed_at")
      .where("id", "=", active.seed_pair_id)
      .executeTakeFirstOrThrow();
    if (pair.revealed_at === null) return active;
    // The player rotated the seeds: this shoe's unseen cards are public now, so none is dealt.
    await trx
      .updateTable("blackjack_shoes")
      .set({ status: "finished", end_reason: "seed_rotated", finished_at: now })
      .where("id", "=", active.id)
      .execute();
  }

  const draw = await seedPairs.draw(trx, userId);
  return trx
    .insertInto("blackjack_shoes")
    .values({
      user_id: userId,
      seed_pair_id: draw.seedPairId,
      nonce: draw.nonce,
      cut_card: BLACKJACK_CUT_CARD,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Moves the shoe past a settled round, in the settlement's transaction: the next hand starts after
 * the round's last card, and once that is at or past the cut card the shoe is finished, so the
 * next hand opens a new one. The position is set, not added, so it cannot advance twice.
 */
export async function advanceShoe(
  trx: Db,
  input: {
    shoeId: string;
    cardOffset: number;
    round: Parameters<typeof roundCardCount>[0];
    now: Date;
  },
): Promise<void> {
  const shoe = await trx
    .selectFrom("blackjack_shoes")
    .select(["cut_card", "status"])
    .where("id", "=", input.shoeId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const nextCard = input.cardOffset + roundCardCount(input.round);
  const cut = shoe.status === "active" && nextCard >= shoe.cut_card;
  await trx
    .updateTable("blackjack_shoes")
    .set({
      next_card: nextCard,
      ...(cut
        ? { status: "finished" as const, end_reason: "cut_card" as const, finished_at: input.now }
        : {}),
    })
    .where("id", "=", input.shoeId)
    .execute();
}

function toShoe(
  shoe: Pick<ShoeRow, "id" | "cut_card" | "status">,
  cardsDealt: number,
): BlackjackShoe {
  return {
    shoeId: shoe.id,
    size: SHOE_SIZE,
    cutCard: shoe.cut_card,
    cardsDealt,
    reshuffle: shoe.status === "finished",
  };
}

/**
 * How much of a hand's shoe is dealt, as the API shows it after that hand's start or action. In
 * progress: the cards before the hand plus every card on the table, the hole card too (a count,
 * never its value). Settled: where the shoe stands now, and whether the hand finished it. `null`
 * for a hand from before the continuous shoe.
 */
export async function shoeOfHand(db: Db, row: HandRow): Promise<BlackjackShoe | null> {
  if (row.shoe_id === null || row.card_offset === null) return null;
  const shoe = await db
    .selectFrom("blackjack_shoes")
    .select(["id", "cut_card", "status", "next_card"])
    .where("id", "=", row.shoe_id)
    .executeTakeFirstOrThrow();
  if (row.status !== "in_progress") return toShoe(shoe, shoe.next_card);
  const state = replay(await shoeOf(row), parseActions(row.actions));
  return { ...toShoe(shoe, row.card_offset + roundCardCount(state)), reshuffle: false };
}

/**
 * The shoe the player's next cards come from: the hand in progress's, or the active shoe while
 * its seed pair is not revealed. `null` when the next hand opens a new shoe.
 */
export async function getCurrentShoe(db: Db, userId: string): Promise<BlackjackShoe | null> {
  const hand = await selectHands(db)
    .where("b.user_id", "=", userId)
    .where("b.status", "=", "in_progress")
    .executeTakeFirst();
  if (hand) return shoeOfHand(db, hand);
  const shoe = await db
    .selectFrom("blackjack_shoes as sh")
    .innerJoin("seed_pairs as s", "s.id", "sh.seed_pair_id")
    .select(["sh.id", "sh.cut_card", "sh.status", "sh.next_card"])
    .where("sh.user_id", "=", userId)
    .where("sh.status", "=", "active")
    .where("s.revealed_at", "is", null)
    .executeTakeFirst();
  return shoe ? toShoe(shoe, shoe.next_card) : null;
}

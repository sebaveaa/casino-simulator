import { BLACKJACK_CUT_CARD, roundCardCount } from "@casino/shared";
import type { Selectable } from "kysely";
import type { Db } from "../../db/database";
import type { BlackjackShoesTable } from "../../db/schema";
import type { SeedPairService } from "../../rng/seed-pair-service";

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

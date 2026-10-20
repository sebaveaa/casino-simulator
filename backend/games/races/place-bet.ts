import { type Money, type RaceBetResponse, races, toAmount } from "@casino/shared";
import { sql } from "kysely";
import type { Db } from "../../db/database";
import { AppError } from "../../platform/errors";
import { InsufficientFundsError, scopedKey, type WalletService } from "../../wallet/wallet-service";
import { raceSelectionSchema } from "./selection";

export type RaceBetDeps = { wallet: WalletService };

export type RaceBetInput = {
  userId: string;
  idempotencyKey: string;
  roundId: string;
  animal: number;
  stake: Money;
  /** Inclusive stake bounds, from the config. */
  limits: { min: Money; max: Money };
};

/**
 * Places one race bet inside the caller's transaction (README §3.2). The bet row and the ledger
 * transaction commit or roll back together.
 *
 * Lock order is round, then wallet: settlement holds the round `FOR UPDATE` and then moves money,
 * which locks wallets, so taking them the other way round could deadlock. The round is read with
 * `FOR SHARE`: the worker closes it with `FOR UPDATE`, so a close waits for the bets in flight,
 * and a bet that waited behind a close sees the closed status and is refused.
 *
 * The wallet lock comes before the idempotency lookup, so two requests with one key run one
 * after the other and the second replays the first (README §3.3). A replay is answered even if
 * the round has closed since, so the state check comes after it.
 */
export async function placeRaceBet(
  trx: Db,
  { wallet }: RaceBetDeps,
  input: RaceBetInput,
): Promise<RaceBetResponse> {
  const { userId, idempotencyKey, roundId, animal, stake, limits } = input;
  const betKey = scopedKey("race-bet", userId, idempotencyKey);

  const round = await trx
    .selectFrom("game_rounds")
    // The deadline is compared by the database clock, the one the worker also uses.
    .select(["id", "status", sql<boolean>`clock_timestamp() < closes_at`.as("accepting")])
    .where("id", "=", roundId)
    .where("game", "=", races.id)
    .forShare()
    .executeTakeFirst();
  if (!round) throw new AppError("not_found", "Round not found");

  const balance = await wallet.lockBalance(trx, userId);

  const existing = await wallet.findTransaction(trx, betKey);
  if (existing) return replay(trx, wallet, userId, existing.betId, input);

  if (round.status !== "open" || !round.accepting) {
    throw new AppError("invalid_request", "Betting for this round is closed");
  }

  if (!races.validateBet({ stake, animal }) || stake < limits.min || stake > limits.max) {
    throw new AppError("invalid_request", "Invalid animal or stake");
  }
  if (balance < stake) throw new InsufficientFundsError();

  // `do nothing` instead of a failing insert: a unique violation would abort the transaction.
  const inserted = await trx
    .insertInto("bets")
    .values({
      user_id: userId,
      game: races.id,
      round_id: roundId,
      stake,
      // Serialized by hand: the driver would send a JS object as-is, not as jsonb text.
      selection: JSON.stringify({ animal }),
      status: "pending",
    })
    .onConflict((oc) =>
      oc.columns(["round_id", "user_id"]).where("round_id", "is not", null).doNothing(),
    )
    .returning("id")
    .executeTakeFirst();
  if (!inserted) {
    throw new AppError("conflict", "You already have a bet in this round");
  }

  await wallet.transfer(trx, {
    from: { userId },
    to: "house",
    amount: stake,
    type: "bet",
    idempotencyKey: betKey,
    betId: inserted.id,
  });

  return {
    betId: inserted.id,
    roundId,
    animal,
    stake: toAmount(stake),
    balance: toAmount(await wallet.getBalance(trx, userId)),
  };
}

/**
 * Rebuilds the original response from the stored bet. Only the balance is current. A key reused
 * with another round, animal or stake is a client bug, so it is refused instead of replayed.
 */
async function replay(
  trx: Db,
  wallet: WalletService,
  userId: string,
  betId: string | null,
  input: RaceBetInput,
): Promise<RaceBetResponse> {
  const row = betId
    ? await trx
        .selectFrom("bets")
        .select(["id", "round_id", "stake", "selection"])
        .where("id", "=", betId)
        .where("user_id", "=", userId)
        .where("game", "=", races.id)
        .executeTakeFirst()
    : undefined;
  const selection = raceSelectionSchema.safeParse(row?.selection);
  if (!row || row.round_id === null || !selection.success) {
    throw new AppError("conflict", "Idempotency-Key was already used for another operation");
  }
  if (
    row.round_id !== input.roundId ||
    selection.data.animal !== input.animal ||
    row.stake !== input.stake
  ) {
    throw new AppError("conflict", "Idempotency-Key was already used for a different bet");
  }
  return {
    betId: row.id,
    roundId: row.round_id,
    animal: selection.data.animal,
    stake: toAmount(row.stake),
    balance: toAmount(await wallet.getBalance(trx, userId)),
  };
}

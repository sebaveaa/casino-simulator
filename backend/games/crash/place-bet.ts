import {
  type CrashBetResponse,
  type CrashGame,
  isValidCrashStake,
  type Money,
  toAmount,
} from "@casino/shared";
import { sql } from "kysely";
import type { Db } from "../../db/database";
import { AppError } from "../../platform/errors";
import { InsufficientFundsError, scopedKey, type WalletService } from "../../wallet/wallet-service";

export type CrashBetDeps = { wallet: WalletService };

export type CrashBetInput = {
  userId: string;
  idempotencyKey: string;
  roundId: string;
  game: CrashGame;
  stake: Money;
  /** Inclusive stake bounds. */
  limits: { min: Money; max: Money };
};

/**
 * Places one crash bet inside the caller's transaction (README §3.2). The bet row and the ledger
 * transaction commit or roll back together. Mirrors `placeRaceBet`: lock order is round
 * (`FOR SHARE`), then the player wallet, so a bet that waits behind the worker's close sees the
 * closed status and is refused; the idempotency replay is answered even after the round closes.
 */
export async function placeCrashBet(
  trx: Db,
  { wallet }: CrashBetDeps,
  input: CrashBetInput,
): Promise<CrashBetResponse> {
  const { userId, idempotencyKey, roundId, game, stake, limits } = input;
  const betKey = scopedKey("crash-bet", userId, idempotencyKey);

  const round = await trx
    .selectFrom("game_rounds")
    // The deadline is compared by the database clock, the one the worker also uses.
    .select(["id", "status", sql<boolean>`clock_timestamp() < closes_at`.as("accepting")])
    .where("id", "=", roundId)
    .where("game", "=", game)
    .forShare()
    .executeTakeFirst();
  if (!round) throw new AppError("not_found", "Round not found");

  const balance = await wallet.lockBalance(trx, userId);

  const existing = await wallet.findTransaction(trx, betKey);
  if (existing) return replay(trx, wallet, userId, game, existing.betId, input);

  if (round.status !== "open" || !round.accepting) {
    throw new AppError("invalid_request", "Betting for this round is closed");
  }
  if (!isValidCrashStake(stake) || stake < limits.min || stake > limits.max) {
    throw new AppError("invalid_request", "Invalid stake");
  }
  if (balance < stake) throw new InsufficientFundsError();

  // `do nothing` instead of a failing insert: a unique violation would abort the transaction.
  const inserted = await trx
    .insertInto("bets")
    .values({
      user_id: userId,
      game,
      round_id: roundId,
      stake,
      // Serialized by hand: the driver would send a JS object as-is, not as jsonb text.
      selection: JSON.stringify({}),
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
    stake: toAmount(stake),
    balance: toAmount(await wallet.getBalance(trx, userId)),
  };
}

/**
 * Rebuilds the original response from the stored bet. Only the balance is current. A key reused
 * with another round or stake is a client bug, so it is refused instead of replayed.
 */
async function replay(
  trx: Db,
  wallet: WalletService,
  userId: string,
  game: CrashGame,
  betId: string | null,
  input: CrashBetInput,
): Promise<CrashBetResponse> {
  const row = betId
    ? await trx
        .selectFrom("bets")
        .select(["id", "round_id", "stake"])
        .where("id", "=", betId)
        .where("user_id", "=", userId)
        .where("game", "=", game)
        .executeTakeFirst()
    : undefined;
  if (!row || row.round_id === null) {
    throw new AppError("conflict", "Idempotency-Key was already used for another operation");
  }
  if (row.round_id !== input.roundId || row.stake !== input.stake) {
    throw new AppError("conflict", "Idempotency-Key was already used for a different bet");
  }
  return {
    betId: row.id,
    roundId: row.round_id,
    stake: toAmount(row.stake),
    balance: toAmount(await wallet.getBalance(trx, userId)),
  };
}

import {
  type CrashCashoutResponse,
  type CrashGame,
  canCashOut,
  computeRoundOutcome,
  crashPayout,
  createRng,
  multiplierAtHundredths,
  resolveCrash,
  toAmount,
} from "@casino/shared";
import { sql } from "kysely";
import type { Db } from "../../db/database";
import { AppError } from "../../platform/errors";
import { scopedKey, type WalletService } from "../../wallet/wallet-service";
import { type CrashActions, type CrashBetResult, crashBetResultSchema } from "./selection";

export type CrashCashoutDeps = { wallet: WalletService };

export type CrashCashoutInput = { userId: string; game: CrashGame; betId: string };

/**
 * Cashes a bet out inside the caller's transaction (PLAN-CRASH §5.3). The bet row is locked
 * `FOR UPDATE` first; the worker settles bets with `SKIP LOCKED`, so it never blocks on a bet being
 * cashed out and the two cannot deadlock. Everything the player saw on screen is ignored: the
 * multiplier is derived from the round's seed and the elapsed time is measured with the PostgreSQL
 * clock (`clock_timestamp()`), so several API instances agree and none keeps state.
 *
 * Lock order is bet, then the player wallet, then (inside `transfer`) the house wallet, so the
 * house is the last lock, as everywhere else. The payout is keyed by bet, so a double click or a
 * retry pays exactly once.
 */
export async function cashOutCrashBet(
  trx: Db,
  { wallet }: CrashCashoutDeps,
  input: CrashCashoutInput,
): Promise<CrashCashoutResponse> {
  const { userId, game, betId } = input;

  const bet = await trx
    .selectFrom("bets")
    .select(["id", "round_id", "stake", "status", "payout", "result"])
    .where("id", "=", betId)
    .where("user_id", "=", userId)
    .where("game", "=", game)
    .forUpdate()
    .executeTakeFirst();
  if (!bet || bet.round_id === null) throw new AppError("not_found", "Bet not found");

  if (bet.status === "settled") return replay(trx, wallet, userId, bet);

  // The round is only read; the timing is decided by the clock, not the status.
  const round = await trx
    .selectFrom("game_rounds")
    .select([
      "id",
      "server_seed",
      "closes_at",
      sql<Date>`clock_timestamp()`.as("now"),
      sql<number>`extract(epoch from (clock_timestamp() - closes_at)) * 1000`.as("elapsed_ms"),
    ])
    .where("id", "=", bet.round_id)
    .executeTakeFirstOrThrow();

  if (round.now < round.closes_at) {
    throw new AppError("invalid_request", "The round has not taken off yet");
  }

  const result = resolveCrash(createRng(await computeRoundOutcome(round.server_seed, round.id)));
  const elapsedMs = Math.floor(round.elapsed_ms);
  if (!canCashOut(elapsedMs, result.crashHundredths)) {
    throw new AppError("invalid_request", "The round already crashed");
  }

  const cashoutHundredths = multiplierAtHundredths(elapsedMs);
  const payout = crashPayout(bet.stake, cashoutHundredths);

  // The player wallet is locked before the payout, so the house stays the last lock.
  await wallet.lockBalance(trx, userId);
  const payoutKey = scopedKey("crash-payout", userId, betId);
  if (!(await wallet.findTransaction(trx, payoutKey))) {
    await wallet.transfer(trx, {
      from: "house",
      to: { userId },
      amount: payout,
      type: "payout",
      idempotencyKey: payoutKey,
      betId,
    });
  }

  const actions: CrashActions = { type: "cashout", atHundredths: cashoutHundredths, elapsedMs };
  const betResult: CrashBetResult = { outcome: "cashout", atHundredths: cashoutHundredths };
  await trx
    .updateTable("bets")
    .set({
      status: "settled",
      payout,
      settled_at: round.now,
      // Serialized by hand: the driver would send a JS object as-is, not as jsonb text.
      actions: JSON.stringify(actions),
      result: JSON.stringify(betResult),
    })
    .where("id", "=", betId)
    .execute();

  return {
    betId,
    cashoutHundredths,
    payout: toAmount(payout),
    balance: toAmount(await wallet.getBalance(trx, userId)),
  };
}

/**
 * A bet that is already settled: replay the original cash-out, or refuse if it lost (the player did
 * not cash out in time; the worker settled it).
 */
async function replay(
  trx: Db,
  wallet: WalletService,
  userId: string,
  bet: { id: string; payout: bigint | null; result: unknown },
): Promise<CrashCashoutResponse> {
  const parsed = bet.result === null ? null : crashBetResultSchema.safeParse(bet.result);
  if (parsed?.success && (parsed.data.outcome === "cashout" || parsed.data.outcome === "cap")) {
    return {
      betId: bet.id,
      cashoutHundredths: parsed.data.atHundredths,
      payout: toAmount(bet.payout ?? 0n),
      balance: toAmount(await wallet.getBalance(trx, userId)),
    };
  }
  throw new AppError("invalid_request", "The round already crashed");
}

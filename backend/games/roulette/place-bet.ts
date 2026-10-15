import {
  computeOutcome,
  createRng,
  type RouletteBet,
  type RouletteBetResponse,
  type RouletteResult,
  roulette,
  rouletteResultSchema,
  toAmount,
} from "@casino/shared";
import type { Db } from "../../db/database";
import { AppError } from "../../platform/errors";
import type { SeedPairService } from "../../rng/seed-pair-service";
import { InsufficientFundsError, scopedKey, type WalletService } from "../../wallet/wallet-service";

export type RouletteBetDeps = { wallet: WalletService; seedPairs: SeedPairService };

/**
 * Places one roulette bet inside the caller's transaction (README §3.2, §4.2). Everything the
 * bet changes (nonce, bet row, both ledger transactions) commits or rolls back together.
 *
 * Order matters: the wallet is locked first (wallets -> users -> seed_pairs, see
 * `SeedPairService.draw`), and only then is the idempotency key looked up, so two requests with
 * one key run one after the other and the second one replays the first (README §3.3).
 */
export async function placeRouletteBet(
  trx: Db,
  { wallet, seedPairs }: RouletteBetDeps,
  input: { userId: string; idempotencyKey: string; bet: RouletteBet },
): Promise<RouletteBetResponse> {
  const { userId, idempotencyKey, bet } = input;
  const betKey = scopedKey("roulette-bet", userId, idempotencyKey);

  const balance = await wallet.lockBalance(trx, userId);

  const existing = await wallet.findTransaction(trx, betKey);
  if (existing) return replay(trx, wallet, userId, existing.betId);

  // Checked before `draw`, so a bet the player cannot afford burns no nonce. The transfer still
  // enforces it, and the transaction rolls back either way.
  if (balance < bet.stake) throw new InsufficientFundsError();

  const draw = await seedPairs.draw(trx, userId);
  const result: RouletteResult = roulette.resolve(bet, createRng(await computeOutcome(draw.seed)));
  const payout = roulette.payout(bet, result);

  const { id: betId } = await trx
    .insertInto("bets")
    .values({
      user_id: userId,
      game: roulette.id,
      seed_pair_id: draw.seedPairId,
      nonce: draw.nonce,
      stake: bet.stake,
      selection: bet.selection,
      result,
      payout,
      status: "settled",
      settled_at: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await wallet.transfer(trx, {
    from: { userId },
    to: "house",
    amount: bet.stake,
    type: "bet",
    idempotencyKey: betKey,
    betId,
  });
  // A losing bet pays nothing, and the ledger rejects zero-amount transactions.
  if (payout > 0n) {
    await wallet.transfer(trx, {
      from: "house",
      to: { userId },
      amount: payout,
      type: "payout",
      idempotencyKey: scopedKey("roulette-payout", userId, idempotencyKey),
      betId,
    });
  }

  return {
    betId,
    result,
    payout: toAmount(payout),
    balance: toAmount(await wallet.getBalance(trx, userId)),
    fairness: {
      seedPairId: draw.seedPairId,
      serverSeedHash: draw.serverSeedHash,
      clientSeed: draw.seed.clientSeed,
      nonce: draw.nonce,
    },
  };
}

/** Rebuilds the original response from the stored bet. Only the balance is current. */
async function replay(
  trx: Db,
  wallet: WalletService,
  userId: string,
  betId: string | null,
): Promise<RouletteBetResponse> {
  const row = betId
    ? await trx
        .selectFrom("bets as b")
        .innerJoin("seed_pairs as s", "s.id", "b.seed_pair_id")
        .select([
          "b.id",
          "b.nonce",
          "b.result",
          "b.payout",
          "s.id as seedPairId",
          "s.server_seed_hash",
          "s.client_seed",
        ])
        .where("b.id", "=", betId)
        .where("b.user_id", "=", userId)
        .where("b.game", "=", roulette.id)
        .executeTakeFirst()
    : undefined;
  const result = rouletteResultSchema.safeParse(row?.result);
  if (!row || row.nonce === null || row.payout === null || !result.success) {
    // The key was used for something other than a settled roulette bet.
    throw new AppError("conflict", "Idempotency-Key was already used for another operation");
  }
  return {
    betId: row.id,
    result: result.data,
    payout: toAmount(row.payout),
    balance: toAmount(await wallet.getBalance(trx, userId)),
    fairness: {
      seedPairId: row.seedPairId,
      serverSeedHash: row.server_seed_hash,
      clientSeed: row.client_seed,
      nonce: row.nonce,
    },
  };
}

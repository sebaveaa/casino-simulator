import {
  computeOutcome,
  createRng,
  parseAmount,
  type RouletteBetResponse,
  type RouletteResult,
  type RouletteSpin,
  roulette,
  rouletteBetItemSchema,
  rouletteResultSchema,
  selectionKey,
  spinPayouts,
  toAmount,
  totalStake,
} from "@casino/shared";
import { z } from "zod";
import type { Db } from "../../db/database";
import { AppError } from "../../platform/errors";
import type { SeedPairService } from "../../rng/seed-pair-service";
import { InsufficientFundsError, scopedKey, type WalletService } from "../../wallet/wallet-service";

export type RouletteBetDeps = { wallet: WalletService; seedPairs: SeedPairService };

/** What `bets.selection` holds for a spin: the list as requested, stakes as strings. */
const storedBetsSchema = z.array(rouletteBetItemSchema);

/**
 * Places one roulette spin (one or more selections, one draw) inside the caller's transaction
 * (README §3.2, §4.2). Everything the spin changes (nonce, bet row, both ledger transactions)
 * commits or rolls back together.
 *
 * Order matters: the wallet is locked first (wallets -> users -> seed_pairs, see
 * `SeedPairService.draw`), and only then is the idempotency key looked up, so two requests with
 * one key run one after the other and the second one replays the first (README §3.3).
 */
export async function placeRouletteBet(
  trx: Db,
  { wallet, seedPairs }: RouletteBetDeps,
  input: { userId: string; idempotencyKey: string; bets: RouletteSpin },
): Promise<RouletteBetResponse> {
  const { userId, idempotencyKey, bets } = input;
  const betKey = scopedKey("roulette-bet", userId, idempotencyKey);

  const balance = await wallet.lockBalance(trx, userId);

  const existing = await wallet.findTransaction(trx, betKey);
  if (existing) return replay(trx, wallet, userId, existing.betId, bets);

  // The whole spin is refused when the total stake is out of reach. Checked before `draw`, so it
  // burns no nonce; the transfer still enforces it, and the transaction rolls back either way.
  const stake = totalStake(bets);
  if (balance < stake) throw new InsufficientFundsError();

  const draw = await seedPairs.draw(trx, userId);
  // One draw settles every selection: `resolve` ignores the bet, so any of them serves.
  const result: RouletteResult = roulette.resolve(
    bets[0] ?? never(),
    createRng(await computeOutcome(draw.seed)),
  );
  const { payouts, total: payout } = spinPayouts(bets, result);

  const { id: betId } = await trx
    .insertInto("bets")
    .values({
      user_id: userId,
      game: roulette.id,
      seed_pair_id: draw.seedPairId,
      nonce: draw.nonce,
      stake,
      // Serialized by hand: the driver would send a JS array as a PostgreSQL array, not jsonb.
      selection: JSON.stringify(storeBets(bets)),
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
    amount: stake,
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
    bets: responseBets(bets, payouts),
    stake: toAmount(stake),
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

/**
 * Rebuilds the original response from the stored spin. Only the balance is current. A key reused
 * with a different list (another stake, selection, or order) is a client bug, so it is refused
 * instead of replayed.
 */
async function replay(
  trx: Db,
  wallet: WalletService,
  userId: string,
  betId: string | null,
  bets: RouletteSpin,
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
          "b.selection",
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
    // The key was used for something other than a settled roulette spin.
    throw new AppError("conflict", "Idempotency-Key was already used for another operation");
  }
  const stored = storedBetsSchema.safeParse(row.selection);
  if (!stored.success || !sameBets(stored.data, bets)) {
    throw new AppError("conflict", "Idempotency-Key was already used for a different bet");
  }
  // The payouts are a pure function of the stored list and the stored result.
  const { payouts, total } = spinPayouts(bets, result.data);
  return {
    betId: row.id,
    result: result.data,
    bets: responseBets(bets, payouts),
    stake: toAmount(totalStake(bets)),
    payout: toAmount(total),
    balance: toAmount(await wallet.getBalance(trx, userId)),
    fairness: {
      seedPairId: row.seedPairId,
      serverSeedHash: row.server_seed_hash,
      clientSeed: row.client_seed,
      nonce: row.nonce,
    },
  };
}

function storeBets(bets: RouletteSpin): z.infer<typeof storedBetsSchema> {
  return bets.map((bet) => ({ stake: toAmount(bet.stake), selection: bet.selection }));
}

function responseBets(bets: RouletteSpin, payouts: bigint[]): RouletteBetResponse["bets"] {
  return bets.map((bet, i) => ({
    stake: toAmount(bet.stake),
    selection: bet.selection,
    payout: toAmount(payouts[i] ?? 0n),
  }));
}

/** Same length, and the same stake and selection at every position. */
function sameBets(stored: z.infer<typeof storedBetsSchema>, bets: RouletteSpin): boolean {
  return (
    stored.length === bets.length &&
    stored.every((item, i) => {
      const bet = bets[i];
      return (
        bet !== undefined &&
        parseAmount(item.stake) === bet.stake &&
        selectionKey(item.selection) === selectionKey(bet.selection)
      );
    })
  );
}

function never(): never {
  throw new Error("A spin always has at least one bet");
}

import {
  type ChickenRoadCashoutResponse,
  type ChickenRoadGame,
  type ChickenRoadResult,
  type ChickenRoadStartResponse,
  type ChickenRoadStepResponse,
  chickenRoad,
  chickenRoadPayout,
  isValidChickenRoadStake,
  LANE_COUNT,
  type Money,
  toAmount,
} from "@casino/shared";
import type { Db } from "../../db/database";
import { AppError } from "../../platform/errors";
import type { SeedPairService } from "../../rng/seed-pair-service";
import { InsufficientFundsError, scopedKey, type WalletService } from "../../wallet/wallet-service";
import {
  type ChickenRoadActions,
  databaseNow,
  findGameForUpdate,
  type GameRow,
  lockGame,
  lockGameInProgress,
  parseActions,
  roadOf,
  toGame,
} from "./view";

export type ChickenRoadDeps = { wallet: WalletService; seedPairs: SeedPairService };

// Every operation runs inside its caller's transaction and locks the player's wallet first, then
// the bet: one player's operations run one at a time, in the order wallets -> bets (and
// wallets -> users -> seed_pairs when a game starts), so no two paths lock in opposite orders.

/**
 * Starts a game and charges the stake (README §3.2, §3.3). A retry with the same key returns the
 * game as it is now, so a late retry never puts the chicken back at the start line.
 */
export async function startChickenRoadGame(
  trx: Db,
  { wallet, seedPairs }: ChickenRoadDeps,
  input: { userId: string; idempotencyKey: string; stake: Money },
): Promise<ChickenRoadStartResponse> {
  const { userId, idempotencyKey, stake } = input;
  if (!isValidChickenRoadStake(stake)) {
    throw new AppError("invalid_request", "Stake must be between 10 and 500 credits");
  }
  const betKey = scopedKey("chicken-road-bet", userId, idempotencyKey);

  const balance = await wallet.lockBalance(trx, userId);

  const existing = await wallet.findTransaction(trx, betKey);
  if (existing) return replayStart(trx, wallet, userId, existing.betId, stake);

  if (await lockGameInProgress(trx, userId)) {
    throw new AppError("conflict", "A Chicken Road game is already in progress");
  }
  // Checked before `draw`, so a refused start burns no nonce.
  if (balance < stake) throw new InsufficientFundsError();

  const draw = await seedPairs.draw(trx, userId);
  const { id: betId } = await trx
    .insertInto("bets")
    .values({
      user_id: userId,
      game: chickenRoad.id,
      seed_pair_id: draw.seedPairId,
      nonce: draw.nonce,
      stake,
      // Serialized by hand, as in roulette: jsonb values go in as JSON text.
      selection: JSON.stringify({}),
      actions: JSON.stringify([]),
      status: "in_progress",
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

  return {
    game: inProgress(toGame(await lockGame(trx, userId, betId))),
    balance: toAmount(await wallet.getBalance(trx, userId)),
  };
}

async function replayStart(
  trx: Db,
  wallet: WalletService,
  userId: string,
  betId: string | null,
  stake: Money,
): Promise<ChickenRoadStartResponse> {
  const row = betId ? await findGameForUpdate(trx, userId, betId) : undefined;
  if (!row) {
    // The key was used for something other than a Chicken Road start.
    throw new AppError("conflict", "Idempotency-Key was already used for another operation");
  }
  if (row.stake !== stake) {
    throw new AppError("conflict", "Idempotency-Key was already used for a different stake");
  }
  const game = toGame(row);
  // The start response only carries a game in progress; a finished one is read from history.
  if (game?.status !== "in_progress") {
    throw new AppError("conflict", "This Chicken Road game already finished");
  }
  return { game, balance: toAmount(await wallet.getBalance(trx, userId)) };
}

/**
 * Tries to cross `lane`. A lane already played returns the game unchanged, so a retried or
 * double-clicked step never crosses two lanes. Crossing lane 6 cashes out automatically.
 */
export async function stepChickenRoadGame(
  trx: Db,
  { wallet }: Pick<ChickenRoadDeps, "wallet">,
  input: { userId: string; gameId: string; lane: number },
): Promise<ChickenRoadStepResponse> {
  const { userId, gameId, lane } = input;
  await wallet.lockBalance(trx, userId);
  const row = await lockGame(trx, userId, gameId);
  const actions = parseActions(row.actions);

  if (lane <= actions.length) return respond(trx, wallet, userId, row);
  if (row.status !== "in_progress") throw finished(row);
  if (lane !== actions.length + 1) {
    throw new AppError("conflict", `The next lane to cross is ${actions.length + 1}`);
  }

  const road = await roadOf(row);
  const now = await databaseNow(trx);
  const next = [...actions, { lane, at: now.toISOString() }];
  if (road.hitLane === lane) {
    await settleGame(trx, wallet, { userId, row, actions: next, road, payout: 0n, now });
  } else if (lane === LANE_COUNT) {
    const payout = chickenRoadPayout(row.stake, LANE_COUNT);
    await settleGame(trx, wallet, { userId, row, actions: next, road, payout, now });
  } else {
    await trx
      .updateTable("bets")
      .set({ actions: JSON.stringify(next) })
      .where("id", "=", row.id)
      .execute();
  }
  return respond(trx, wallet, userId, await lockGame(trx, userId, gameId));
}

/** Retires and collects. A game already paid is returned as is: it is never paid twice. */
export async function cashOutChickenRoadGame(
  trx: Db,
  { wallet }: Pick<ChickenRoadDeps, "wallet">,
  input: { userId: string; gameId: string },
): Promise<ChickenRoadCashoutResponse> {
  const { userId, gameId } = input;
  await wallet.lockBalance(trx, userId);
  const row = await lockGame(trx, userId, gameId);
  const game = toGame(row);

  if (game?.status === "cashed_out" || game?.status === "completed") {
    return { game, balance: toAmount(await wallet.getBalance(trx, userId)) };
  }
  if (game?.status !== "in_progress") throw finished(row);
  if (game.lanesCrossed === 0) {
    throw new AppError("conflict", "Cross at least one lane before cashing out");
  }

  const payout = chickenRoadPayout(row.stake, game.lanesCrossed);
  await settleGame(trx, wallet, {
    userId,
    row,
    actions: parseActions(row.actions),
    road: await roadOf(row),
    payout,
    now: await databaseNow(trx),
  });
  const paid = toGame(await lockGame(trx, userId, gameId));
  if (paid?.status !== "cashed_out" && paid?.status !== "completed") {
    throw new Error("A cashed-out Chicken Road game is not paid");
  }
  return { game: paid, balance: toAmount(await wallet.getBalance(trx, userId)) };
}

/**
 * Settles a locked game: stores the road for the verifier and pays `payout` once. Every payout of
 * a game (cash out, lane 6, abandonment) uses the same key, so a second one is impossible: the
 * caller sees `status = 'settled'` first, and `transactions.idempotency_key` is unique anyway.
 */
export async function settleGame(
  trx: Db,
  wallet: WalletService,
  input: {
    userId: string;
    row: GameRow;
    actions: ChickenRoadActions;
    road: ChickenRoadResult;
    payout: Money;
    now: Date;
  },
): Promise<void> {
  const { userId, row, actions, road, payout, now } = input;
  await trx
    .updateTable("bets")
    .set({
      actions: JSON.stringify(actions),
      result: road,
      payout,
      status: "settled",
      settled_at: now,
    })
    .where("id", "=", row.id)
    .execute();
  // A lost game pays nothing, and the ledger rejects zero-amount transactions.
  if (payout > 0n) {
    await wallet.transfer(trx, {
      from: "house",
      to: { userId },
      amount: payout,
      type: "payout",
      idempotencyKey: scopedKey("payout", userId, row.id),
      betId: row.id,
    });
  }
}

async function respond(
  trx: Db,
  wallet: WalletService,
  userId: string,
  row: GameRow,
): Promise<{ game: ChickenRoadGame; balance: string }> {
  const game = toGame(row);
  if (!game) throw finished(row);
  return { game, balance: toAmount(await wallet.getBalance(trx, userId)) };
}

/** Why a settled game takes no more steps or cash-outs. */
function finished(row: GameRow): AppError {
  const game = toGame(row);
  if (!game) return new AppError("conflict", "The game expired and the stake was refunded");
  if (game.status === "lost") return new AppError("conflict", "This Chicken Road game was lost");
  return new AppError("conflict", "This Chicken Road game already finished");
}

function inProgress(game: ChickenRoadGame | null) {
  if (game?.status !== "in_progress") throw new Error("A new Chicken Road game is not in progress");
  return game;
}

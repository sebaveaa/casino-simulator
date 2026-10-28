import {
  type BlackjackAction,
  type BlackjackActionResponse,
  type BlackjackHandState,
  type BlackjackStartResponse,
  blackjack,
  blackjackPayout,
  isValidBlackjackStake,
  legalActions,
  type Money,
  toAmount,
} from "@casino/shared";
import type { Db } from "../../db/database";
import { AppError } from "../../platform/errors";
import type { SeedPairService } from "../../rng/seed-pair-service";
import { InsufficientFundsError, scopedKey, type WalletService } from "../../wallet/wallet-service";
import { databaseNow } from "../chicken-road/view";
import {
  type BlackjackActions,
  findHandForUpdate,
  type HandRow,
  initialStake,
  lockHand,
  lockHandInProgress,
  parseActions,
  replay,
  shoeOf,
  toHand,
} from "./view";

export type BlackjackDeps = { wallet: WalletService; seedPairs: SeedPairService };

// Every operation runs inside its caller's transaction and locks the player's wallet first, then
// the bet: one player's operations run one at a time, in the order wallets -> bets (and
// wallets -> users -> seed_pairs when a hand starts), as in Chicken Road.

/**
 * Starts a hand and charges the stake (README §3.2, §3.3). A natural on either side settles it
 * in the same transaction. A retry with the same key returns the hand as it is now.
 */
export async function startBlackjackHand(
  trx: Db,
  { wallet, seedPairs }: BlackjackDeps,
  input: { userId: string; idempotencyKey: string; stake: Money },
): Promise<BlackjackStartResponse> {
  const { userId, idempotencyKey, stake } = input;
  if (!isValidBlackjackStake(stake)) {
    throw new AppError("invalid_request", "Stake must be between 10 and 500 credits");
  }
  const betKey = scopedKey("blackjack-bet", userId, idempotencyKey);

  const balance = await wallet.lockBalance(trx, userId);

  const existing = await wallet.findTransaction(trx, betKey);
  if (existing) return replayStart(trx, wallet, userId, existing.betId, stake);

  if (await lockHandInProgress(trx, userId)) {
    throw new AppError("conflict", "A Blackjack hand is already in progress");
  }
  // Checked before `draw`, so a refused start burns no nonce.
  if (balance < stake) throw new InsufficientFundsError();

  const draw = await seedPairs.draw(trx, userId);
  const { id: handId } = await trx
    .insertInto("bets")
    .values({
      user_id: userId,
      game: blackjack.id,
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
    betId: handId,
  });

  const row = await lockHand(trx, userId, handId);
  const state = replay(await shoeOf(row), []);
  if (state.outcome !== null) {
    await settleHand(trx, wallet, { userId, row, actions: [], state, now: await databaseNow(trx) });
  }
  return respond(trx, wallet, userId, handId);
}

async function replayStart(
  trx: Db,
  wallet: WalletService,
  userId: string,
  handId: string | null,
  stake: Money,
): Promise<BlackjackStartResponse> {
  const row = handId ? await findHandForUpdate(trx, userId, handId) : undefined;
  if (!row) {
    // The key was used for something other than a Blackjack start.
    throw new AppError("conflict", "Idempotency-Key was already used for another operation");
  }
  if (initialStake(row) !== stake) {
    throw new AppError("conflict", "Idempotency-Key was already used for a different stake");
  }
  return { hand: await toHand(row), balance: toAmount(await wallet.getBalance(trx, userId)) };
}

/**
 * Plays `action` as the hand's action number `index`. An index already played with the same
 * action returns the hand unchanged, so a retried or double-clicked action never plays twice.
 * Doubling charges the stake again; the action that ends the hand settles it.
 */
export async function actOnBlackjackHand(
  trx: Db,
  { wallet }: Pick<BlackjackDeps, "wallet">,
  input: { userId: string; handId: string; action: BlackjackAction; index: number },
): Promise<BlackjackActionResponse> {
  const { userId, handId, action, index } = input;
  const balance = await wallet.lockBalance(trx, userId);
  const row = await lockHand(trx, userId, handId);
  const actions = parseActions(row.actions);

  const played = actions[index];
  if (played) {
    if (played.action !== action) {
      throw new AppError("conflict", `Action ${index} was already played as "${played.action}"`);
    }
    return respond(trx, wallet, userId, handId);
  }
  if (row.status !== "in_progress") {
    throw new AppError("conflict", "This Blackjack hand already finished");
  }
  if (index !== actions.length) {
    throw new AppError("conflict", `The next action is number ${actions.length}`);
  }

  const shoe = await shoeOf(row);
  if (!legalActions(replay(shoe, actions)).includes(action)) {
    throw new AppError("conflict", `"${action}" is not allowed in this hand now`);
  }

  if (action === "double") {
    if (balance < row.stake) throw new InsufficientFundsError();
    // One key per hand: a hand doubles at most once.
    await wallet.transfer(trx, {
      from: { userId },
      to: "house",
      amount: row.stake,
      type: "bet",
      idempotencyKey: scopedKey("blackjack-double", userId, row.id),
      betId: row.id,
    });
  }

  const now = await databaseNow(trx);
  const next = [...actions, { action, at: now.toISOString() }];
  const state = replay(shoe, next);
  if (state.outcome !== null) {
    await settleHand(trx, wallet, { userId, row, actions: next, state, now });
  } else {
    await trx
      .updateTable("bets")
      .set({ actions: JSON.stringify(next) })
      .where("id", "=", row.id)
      .execute();
  }
  return respond(trx, wallet, userId, handId);
}

/**
 * Settles a locked hand: stores the cards for the verifier and pays once. Every payout of a hand
 * (natural, last action, abandonment) uses the same key, so a second one is impossible: the caller
 * sees `status = 'settled'` first, and `transactions.idempotency_key` is unique anyway.
 */
export async function settleHand(
  trx: Db,
  wallet: WalletService,
  input: {
    userId: string;
    row: HandRow;
    actions: BlackjackActions;
    state: BlackjackHandState;
    now: Date;
  },
): Promise<void> {
  const { userId, row, actions, state, now } = input;
  const { outcome, ...cards } = state;
  if (outcome === null) throw new Error("Only a finished Blackjack hand settles");
  // `row` is still in progress, so `bets.stake` is the initial stake: a double always ends the
  // hand, and settling is what writes the doubled total.
  const stake = row.stake;
  const payout = blackjackPayout(stake, { doubled: state.doubled, outcome });
  await trx
    .updateTable("bets")
    .set({
      stake: state.doubled ? stake * 2n : stake,
      actions: JSON.stringify(actions),
      result: { ...cards, outcome },
      payout,
      status: "settled",
      settled_at: now,
    })
    .where("id", "=", row.id)
    .execute();
  // A lost hand pays nothing, and the ledger rejects zero-amount transactions.
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

async function respond(trx: Db, wallet: WalletService, userId: string, handId: string) {
  const hand = await toHand(await lockHand(trx, userId, handId));
  return { hand, balance: toAmount(await wallet.getBalance(trx, userId)) };
}

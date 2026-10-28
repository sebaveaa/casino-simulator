import {
  type BlackjackAction,
  type BlackjackActionResponse,
  type BlackjackHandState,
  type BlackjackStartResponse,
  blackjack,
  blackjackPayout,
  blackjackWagerCount,
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
import { advanceShoe, shoeOfHand, takeShoe } from "./shoe";
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
// the bet: one player's operations run one at a time, in the order wallets -> bets ->
// blackjack_shoes -> users -> seed_pairs, as in Chicken Road plus the shoe (#66).

/**
 * Starts a hand and charges the stake (README §3.2, §3.3), dealt from the player's shoe at its
 * next card: the active shoe, or a new one from the seed pair. A natural on either side settles it
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
  // Checked before the shoe, so a refused start opens none and burns no nonce.
  if (balance < stake) throw new InsufficientFundsError();

  const shoe = await takeShoe(trx, seedPairs, userId, await databaseNow(trx));
  const { id: handId } = await trx
    .insertInto("bets")
    .values({
      user_id: userId,
      game: blackjack.id,
      // The hand shares its shoe's seed pair and nonce (`bets_shoe_fkey` keeps them equal).
      seed_pair_id: shoe.seed_pair_id,
      nonce: shoe.nonce,
      shoe_id: shoe.id,
      card_offset: shoe.next_card,
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
  if (state.finished) {
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
  return {
    hand: await toHand(row),
    balance: toAmount(await wallet.getBalance(trx, userId)),
    shoe: await shoeOfHand(trx, row),
  };
}

/**
 * Plays `action` on the active hand as the round's action number `index`. An index already played
 * with the same action returns the round unchanged, so a retried or double-clicked action never
 * plays twice. Splitting and doubling each charge the initial stake again; the action that ends
 * the round settles it.
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
  const before = replay(shoe, actions);
  if (!legalActions(before).includes(action)) {
    throw new AppError("conflict", `"${action}" is not allowed in this hand now`);
  }

  const stake = initialStake(row);
  if (action === "split" || action === "double") {
    if (balance < stake) throw new InsufficientFundsError();
    // A round splits at most once and each hand doubles at most once, so these keys charge once.
    const key =
      action === "split"
        ? scopedKey("blackjack-split", userId, row.id)
        : scopedKey("blackjack-double", userId, `${row.id}:${before.active}`);
    await wallet.transfer(trx, {
      from: { userId },
      to: "house",
      amount: stake,
      type: "bet",
      idempotencyKey: key,
      betId: row.id,
    });
  }

  const now = await databaseNow(trx);
  const next = [...actions, { action, at: now.toISOString() }];
  const state = replay(shoe, next);
  if (state.finished) {
    await settleHand(trx, wallet, { userId, row, actions: next, state, now });
  } else {
    await trx
      .updateTable("bets")
      .set({ actions: JSON.stringify(next), stake: stake * wagerCountOf(next) })
      .where("id", "=", row.id)
      .execute();
  }
  return respond(trx, wallet, userId, handId);
}

/**
 * Settles a locked round: stores the cards for the verifier, pays once (the sum over the player's
 * hands) and moves the shoe past the round. Every payout of a round (natural, last action,
 * abandonment) goes through here with the same key, so a second one is impossible: the caller sees
 * `status = 'settled'` first, and `transactions.idempotency_key` is unique anyway.
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
  if (!state.finished) throw new Error("Only a finished Blackjack round settles");
  const playerHands = state.playerHands.map(({ cards, doubled, outcome }) => {
    if (outcome === null) throw new Error("A settled Blackjack hand has no outcome");
    return { cards, doubled, outcome };
  });
  // `row` was read before this action, so its stake and actions still agree.
  const stake = initialStake(row);
  const payout = blackjackPayout(stake, { playerHands });
  await trx
    .updateTable("bets")
    .set({
      stake: stake * wagerCountOf(actions),
      actions: JSON.stringify(actions),
      result: { playerHands, dealerCards: state.dealerCards },
      payout,
      status: "settled",
      settled_at: now,
    })
    .where("id", "=", row.id)
    .execute();
  if (row.shoe_id !== null && row.card_offset !== null) {
    await advanceShoe(trx, {
      shoeId: row.shoe_id,
      cardOffset: row.card_offset,
      round: { playerHands, dealerCards: state.dealerCards },
      now,
    });
  }
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

const wagerCountOf = (actions: BlackjackActions) =>
  blackjackWagerCount(actions.map((entry) => entry.action));

async function respond(trx: Db, wallet: WalletService, userId: string, handId: string) {
  const row = await lockHand(trx, userId, handId);
  return {
    hand: await toHand(row),
    balance: toAmount(await wallet.getBalance(trx, userId)),
    shoe: await shoeOfHand(trx, row),
  };
}

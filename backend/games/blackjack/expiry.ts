import type { Db } from "../../db/database";
import type { WalletService } from "../../wallet/wallet-service";
import { databaseNow } from "../chicken-road/view";
import { settleHand } from "./game";
import { lockHandInProgress, parseActions, replay, shoeOf } from "./view";

/** A hand with no activity for this long is abandoned. */
export const BLACKJACK_ABANDON_MS = 10 * 60 * 1000;

/**
 * Settles the player's abandoned hand, if any (README §4.4: a disconnection never takes the
 * player's money). The player stands and the hand resolves with the normal rules, exactly as
 * `blackjack.resolve` does with an open turn. Run it in its own transaction before each Blackjack
 * operation, so the settlement commits even if that operation fails. Returns whether a hand was
 * settled.
 *
 * The clock starts at the last action, or at the start, and is PostgreSQL's `now()`.
 */
export async function settleAbandonedHand(
  trx: Db,
  { wallet }: { wallet: WalletService },
  userId: string,
): Promise<boolean> {
  await wallet.lockBalance(trx, userId);
  const row = await lockHandInProgress(trx, userId);
  if (!row) return false;

  const actions = parseActions(row.actions);
  const last = actions.at(-1);
  const lastActivity = last ? new Date(last.at) : row.created_at;
  const now = await databaseNow(trx);
  if (now.getTime() - lastActivity.getTime() < BLACKJACK_ABANDON_MS) return false;

  // A hand in progress can always stand: `double` and naturals end the hand by themselves.
  const stood = [...actions, { action: "stand" as const, at: now.toISOString() }];
  const state = replay(await shoeOf(row), stood);
  await settleHand(trx, wallet, { userId, row, actions: stood, state, now });
  return true;
}

import type { Db } from "../../db/database";
import type { WalletService } from "../../wallet/wallet-service";
import { databaseNow } from "../chicken-road/view";
import { settleHand } from "./game";
import { lockHandInProgress, parseActions, replay, shoeOf } from "./view";

/** A hand with no activity for this long is abandoned. */
export const BLACKJACK_ABANDON_MS = 10 * 60 * 1000;

/**
 * Settles the player's abandoned hand, if any (README §4.4: a disconnection never takes the
 * player's money). The player stands on every hand left and the round resolves with the normal
 * rules, exactly as `blackjack.resolve` does with open hands. Run it in its own transaction
 * before each Blackjack operation, so the settlement commits even if that operation fails.
 * Returns whether a hand was settled.
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

  // The player stands on every hand left: one stand per open hand (two at most after a split).
  const shoe = await shoeOf(row);
  const stood = [...actions];
  let state = replay(shoe, stood);
  while (!state.finished) {
    stood.push({ action: "stand", at: now.toISOString() });
    state = replay(shoe, stood);
  }
  await settleHand(trx, wallet, { userId, row, actions: stood, state, now });
  return true;
}

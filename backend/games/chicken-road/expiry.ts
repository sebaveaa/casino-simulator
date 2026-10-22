import { chickenRoadPayout } from "@casino/shared";
import type { Db } from "../../db/database";
import type { WalletService } from "../../wallet/wallet-service";
import { settleGame } from "./game";
import { databaseNow, lockGameInProgress, parseActions, roadOf } from "./view";

/** A game with no activity for this long is abandoned. */
export const CHICKEN_ROAD_ABANDON_MS = 10 * 60 * 1000;

/**
 * Settles the player's abandoned game, if any (README §4.4: a disconnection never takes the
 * player's money). Lanes crossed are cashed out; with none crossed the stake is refunded. Run it
 * in its own transaction before each Chicken Road operation, so the settlement commits even if
 * that operation fails. Returns whether a game was settled.
 *
 * The clock starts at the last lane attempted, or at the start, and is PostgreSQL's `now()`.
 */
export async function settleExpiredGame(
  trx: Db,
  { wallet }: { wallet: WalletService },
  userId: string,
): Promise<boolean> {
  await wallet.lockBalance(trx, userId);
  const row = await lockGameInProgress(trx, userId);
  if (!row) return false;

  const actions = parseActions(row.actions);
  const last = actions.at(-1);
  const lastActivity = last ? new Date(last.at) : row.created_at;
  const now = await databaseNow(trx);
  if (now.getTime() - lastActivity.getTime() < CHICKEN_ROAD_ABANDON_MS) return false;

  const payout = actions.length === 0 ? row.stake : chickenRoadPayout(row.stake, actions.length);
  await settleGame(trx, wallet, { userId, row, actions, road: await roadOf(row), payout, now });
  return true;
}

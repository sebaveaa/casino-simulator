import { z } from "zod";
import type { Money } from "../money";
import type { Rng } from "../rng";

export const gameIds = ["roulette", "slots", "races", "blackjack", "chicken-road"] as const;
export const gameIdSchema = z.enum(gameIds);
export type GameId = z.infer<typeof gameIdSchema>;

/** Every bet carries a stake in minor units. */
export type Wager = { stake: Money };

/**
 * Rules of one game (README §4.1). Implementations are pure so the browser
 * verifier runs the exact server code (§5.3).
 */
export interface Game<Bet extends Wager, Result> {
  readonly id: GameId;
  /** Checks the selection is legal and the stake is greater than zero. */
  validateBet(bet: Bet): boolean;
  /** Pure: the same bet and the same `rng` sequence give the same result. */
  resolve(bet: Bet, rng: Rng): Result;
  /**
   * Total returned to the player, stake included; `0n` when the bet loses.
   * Example (README §3.1): a 100 stake that wins 2x pays 200.
   */
  payout(bet: Bet, result: Result): Money;
}

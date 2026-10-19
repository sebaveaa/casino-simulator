import { z } from "zod";
import { MAX_MONEY, type Money } from "../money";
import type { Rng } from "../rng";
import type { Game, Wager } from "./game";

/** Animals in every race, numbered 0 to 4. */
export const ANIMAL_COUNT = 5;

/** `order` lists the animals from first to last place; `winner` is `order[0]`. */
export const raceResultSchema = z.object({
  winner: z
    .number()
    .int()
    .min(0)
    .max(ANIMAL_COUNT - 1),
  order: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(ANIMAL_COUNT - 1),
    )
    .length(ANIMAL_COUNT),
});
export type RaceResult = z.infer<typeof raceResultSchema>;

/** Fisher-Yates shuffle of the animals: uniform, so each one wins with probability 1/5. */
export function resolveRace(rng: Rng): RaceResult {
  const order = Array.from({ length: ANIMAL_COUNT }, (_, animal) => animal);
  for (let i = ANIMAL_COUNT - 1; i >= 1; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return { winner: order[0] as number, order };
}

export type RaceBet = Wager & { animal: number };

/** Total returned when the animal wins: 4.5x the stake, stake included, floored. */
export function racePayout(stake: Money): Money {
  return (stake * 9n) / 2n;
}

/** Animal races rules: bet on one animal to win. Pure, so the browser verifier runs this code. */
export const races: Game<RaceBet, RaceResult> = {
  id: "races",

  validateBet(bet) {
    if (bet.stake <= 0n) return false;
    if (!Number.isInteger(bet.animal) || bet.animal < 0 || bet.animal >= ANIMAL_COUNT) return false;
    // The payout must still fit in a bigint column.
    return racePayout(bet.stake) <= MAX_MONEY;
  },

  resolve(_bet, rng) {
    return resolveRace(rng);
  },

  payout(bet, result) {
    return bet.animal === result.winner ? racePayout(bet.stake) : 0n;
  },
};

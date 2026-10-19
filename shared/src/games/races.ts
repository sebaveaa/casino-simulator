import { z } from "zod";
import type { Rng } from "../rng";

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

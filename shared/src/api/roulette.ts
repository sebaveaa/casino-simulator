import { z } from "zod";
import { rouletteResultSchema, rouletteSelectionSchema } from "../games/roulette";
import { amountSchema, positiveAmountSchema } from "../money";

/** Data the verifier needs to recompute a bet (README §5). */
export const fairnessSchema = z.object({
  seedPairId: z.uuid(),
  serverSeedHash: z.string().regex(/^[0-9a-f]{64}$/, "Expected 64 lowercase hex characters"),
  clientSeed: z.string().min(1).max(64),
  nonce: z.number().int().min(0),
});
export type Fairness = z.infer<typeof fairnessSchema>;

export const rouletteBetRequestSchema = z.object({
  stake: positiveAmountSchema,
  selection: rouletteSelectionSchema,
});
export type RouletteBetRequest = z.infer<typeof rouletteBetRequestSchema>;

export const rouletteBetResponseSchema = z.object({
  betId: z.uuid(),
  result: rouletteResultSchema,
  /** Total returned to the player, stake included; "0" when the bet loses. */
  payout: amountSchema,
  balance: amountSchema,
  fairness: fairnessSchema,
});
export type RouletteBetResponse = z.infer<typeof rouletteBetResponseSchema>;

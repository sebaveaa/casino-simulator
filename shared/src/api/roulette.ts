import { z } from "zod";
import { MAX_SPIN_BETS, rouletteResultSchema, rouletteSelectionSchema } from "../games/roulette";
import { amountSchema, positiveAmountSchema } from "../money";

/** Data the verifier needs to recompute a bet (README §5). */
export const fairnessSchema = z.object({
  seedPairId: z.uuid(),
  serverSeedHash: z.string().regex(/^[0-9a-f]{64}$/, "Expected 64 lowercase hex characters"),
  clientSeed: z.string().min(1).max(64),
  nonce: z.number().int().min(0),
});
export type Fairness = z.infer<typeof fairnessSchema>;

/** One selection of a spin with its own stake. */
export const rouletteBetItemSchema = z.object({
  stake: positiveAmountSchema,
  selection: rouletteSelectionSchema,
});
export type RouletteBetItem = z.infer<typeof rouletteBetItemSchema>;

/** One spin: a list of selections resolved by a single draw, under one Idempotency-Key. */
export const rouletteBetRequestSchema = z.object({
  bets: z.array(rouletteBetItemSchema).min(1).max(MAX_SPIN_BETS),
});
export type RouletteBetRequest = z.infer<typeof rouletteBetRequestSchema>;

export const rouletteBetResponseSchema = z.object({
  betId: z.uuid(),
  result: rouletteResultSchema,
  /** Every selection of the spin, in request order, with what it returned. */
  bets: z.array(rouletteBetItemSchema.extend({ payout: amountSchema })),
  /** Total staked on the spin. */
  stake: amountSchema,
  /** Total returned to the player, stake included; "0" when every selection loses. */
  payout: amountSchema,
  balance: amountSchema,
  fairness: fairnessSchema,
});
export type RouletteBetResponse = z.infer<typeof rouletteBetResponseSchema>;

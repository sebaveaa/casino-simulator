import { MAX_MULTIPLIER_HUNDREDTHS, MIN_MULTIPLIER_HUNDREDTHS } from "@casino/shared";
import { z } from "zod";

/** Crash bets carry no selection beyond the stake. */
export const crashSelectionSchema = z.object({});

const hundredthsSchema = z
  .number()
  .int()
  .min(MIN_MULTIPLIER_HUNDREDTHS)
  .max(MAX_MULTIPLIER_HUNDREDTHS);

/**
 * What `bets.result` holds once a crash bet is settled: the player cashed out, was paid at the cap,
 * or lost. `cashout` and `cap` carry the multiplier paid; `lost` carries nothing.
 */
export const crashBetResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("cashout"), atHundredths: hundredthsSchema }),
  z.object({ outcome: z.literal("cap"), atHundredths: hundredthsSchema }),
  z.object({ outcome: z.literal("lost") }),
]);
export type CrashBetResult = z.infer<typeof crashBetResultSchema>;

/** What `bets.actions` holds: the cash-out action, or null for a bet settled by the worker. */
export const crashActionsSchema = z
  .object({
    type: z.literal("cashout"),
    atHundredths: hundredthsSchema,
    elapsedMs: z.number().int().min(0),
  })
  .nullable();
export type CrashActions = z.infer<typeof crashActionsSchema>;

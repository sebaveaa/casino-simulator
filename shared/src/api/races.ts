import { z } from "zod";
import { ANIMAL_COUNT, raceResultSchema } from "../games/races";
import { amountSchema, positiveAmountSchema } from "../money";

const animalSchema = z
  .number()
  .int()
  .min(0)
  .max(ANIMAL_COUNT - 1);

const datetimeSchema = z.iso.datetime({ offset: true });

/** Mirrors the backend round status; shared must not import backend. */
export const roundStatusSchema = z.enum(["open", "closed", "resolved", "settled"]);
export type RoundStatus = z.infer<typeof roundStatusSchema>;

/** One bet on the animal expected to win the round. */
export const raceBetRequestSchema = z.object({
  roundId: z.uuid(),
  animal: animalSchema,
  stake: positiveAmountSchema,
});
export type RaceBetRequest = z.infer<typeof raceBetRequestSchema>;

export const raceBetResponseSchema = z.object({
  betId: z.uuid(),
  roundId: z.uuid(),
  animal: animalSchema,
  stake: amountSchema,
  balance: amountSchema,
});
export type RaceBetResponse = z.infer<typeof raceBetResponseSchema>;

/**
 * A round as the player sees it. `serverSeed` and `result` are secret until the
 * round is resolved, so they must be absent while it is `open` or `closed`.
 */
export const raceRoundSchema = z
  .object({
    id: z.uuid(),
    status: roundStatusSchema,
    opensAt: datetimeSchema,
    closesAt: datetimeSchema,
    serverSeedHash: z.string().regex(/^[0-9a-f]{64}$/, "Expected 64 lowercase hex characters"),
    result: raceResultSchema.optional(),
    serverSeed: z.string().min(1).optional(),
    settlesAt: datetimeSchema.optional(),
  })
  .superRefine((round, ctx) => {
    const secretsAllowed = round.status === "resolved" || round.status === "settled";
    for (const field of ["serverSeed", "result"] as const) {
      const present = round[field] !== undefined;
      if (present && !secretsAllowed) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must be absent while the round is ${round.status}`,
        });
      } else if (!present && secretsAllowed) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required once the round is ${round.status}`,
        });
      }
    }
  });
export type RaceRound = z.infer<typeof raceRoundSchema>;

export const currentRaceResponseSchema = z.object({
  round: raceRoundSchema.nullable(),
  /** The caller's bet on this round; `payout` stays null until it is settled. */
  myBet: z
    .object({
      animal: animalSchema,
      stake: amountSchema,
      payout: amountSchema.nullable(),
    })
    .nullable(),
  /** Server clock, so the client can correct its countdowns. */
  now: datetimeSchema,
  /** The stake limits per bet, in minor units, so the client does not hardcode them. */
  limits: z.object({ minStake: amountSchema, maxStake: amountSchema }),
  /** How long the race animation lasts, so the client plays it for the same time as the server waits. */
  raceDurationMs: z.number().int().positive(),
});
export type CurrentRaceResponse = z.infer<typeof currentRaceResponseSchema>;

/** Realtime events of the race stream. */
export const raceEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("opened"), round: raceRoundSchema }),
  z.object({ type: z.literal("closed"), roundId: z.uuid() }),
  z.object({
    type: z.literal("result"),
    roundId: z.uuid(),
    result: raceResultSchema,
    serverSeed: z.string().min(1),
  }),
  z.object({ type: z.literal("settled"), roundId: z.uuid() }),
]);
export type RaceEvent = z.infer<typeof raceEventSchema>;

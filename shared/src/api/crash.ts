import { z } from "zod";
import {
  crashResultSchema,
  isValidCrashStake,
  MAX_MULTIPLIER_HUNDREDTHS,
  MIN_MULTIPLIER_HUNDREDTHS,
} from "../games/crash";
import { amountSchema, positiveAmountSchema } from "../money";

/** Finished rounds the history returns by default, and the most it returns. */
export const CRASH_HISTORY_DEFAULT_LIMIT = 20;
export const CRASH_HISTORY_MAX_LIMIT = 50;

const datetimeSchema = z.iso.datetime({ offset: true });

const multiplierSchema = z
  .number()
  .int()
  .min(MIN_MULTIPLIER_HUNDREDTHS)
  .max(MAX_MULTIPLIER_HUNDREDTHS);

/** Mirrors the backend round status; shared must not import backend. */
export const crashRoundStatusSchema = z.enum(["open", "closed", "resolved", "settled"]);
export type CrashRoundStatus = z.infer<typeof crashRoundStatusSchema>;

// Zod 4 runs refinements even after a failed regex, so the digits are checked before `BigInt`.
const stakeSchema = positiveAmountSchema.refine(
  (value) => /^\d{1,20}$/.test(value) && isValidCrashStake(BigInt(value)),
  "Stake must be between 10 and 500 credits",
);

/**
 * A round as the player sees it. `serverSeed` and `result` are secret until the round is resolved,
 * so they must be absent while it is `open` or `closed`. `closesAt` is the takeoff instant: betting
 * closes and the flight begins at the same moment (PLAN-CRASH §4).
 */
export const crashRoundSchema = z
  .object({
    id: z.uuid(),
    status: crashRoundStatusSchema,
    opensAt: datetimeSchema,
    closesAt: datetimeSchema,
    serverSeedHash: z.string().regex(/^[0-9a-f]{64}$/, "Expected 64 lowercase hex characters"),
    result: crashResultSchema.optional(),
    serverSeed: z.string().min(1).optional(),
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
export type CrashRound = z.infer<typeof crashRoundSchema>;

/**
 * The caller's bet in a round. `pending` while it waits, flies, or is yet to be settled;
 * `settled` once the worker closes it. A settled bet with `payout` "0" and no `cashoutHundredths`
 * lost; one with a `cashoutHundredths` and a positive `payout` cashed out (or was paid at the cap).
 */
export const crashPlayerBetSchema = z.object({
  betId: z.uuid(),
  stake: amountSchema,
  status: z.enum(["pending", "settled"]),
  cashoutHundredths: multiplierSchema.nullable(),
  payout: amountSchema.nullable(),
});
export type CrashPlayerBet = z.infer<typeof crashPlayerBetSchema>;

/** Places a bet in the open round. Sent with an `Idempotency-Key` header. */
export const crashBetRequestSchema = z.object({
  roundId: z.uuid(),
  stake: stakeSchema,
});
export type CrashBetRequest = z.infer<typeof crashBetRequestSchema>;

export const crashBetResponseSchema = z.object({
  betId: z.uuid(),
  roundId: z.uuid(),
  stake: amountSchema,
  balance: amountSchema,
});
export type CrashBetResponse = z.infer<typeof crashBetResponseSchema>;

/**
 * Cashes a bet out. The request carries no body: the bet is named by the path, and the multiplier
 * is decided on the server with the PostgreSQL clock. A retry replays the original cash-out.
 */
export const crashCashoutResponseSchema = z.object({
  betId: z.uuid(),
  cashoutHundredths: multiplierSchema,
  payout: positiveAmountSchema,
  balance: amountSchema,
});
export type CrashCashoutResponse = z.infer<typeof crashCashoutResponseSchema>;

/** The round the lobby shows, the caller's bet in it, and the server clock to correct countdowns. */
export const crashCurrentResponseSchema = z.object({
  round: crashRoundSchema.nullable(),
  myBet: crashPlayerBetSchema.nullable(),
  /** Server clock, so the client can correct its countdowns and animate from the same instant. */
  now: datetimeSchema,
  /** Stake limits per bet, in minor units, so the client does not hardcode them. */
  limits: z.object({ minStake: amountSchema, maxStake: amountSchema }),
});
export type CrashCurrentResponse = z.infer<typeof crashCurrentResponseSchema>;

/** Query of the round history ("Últimas rondas"). Query values arrive as strings. */
export const crashHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CRASH_HISTORY_MAX_LIMIT)
    .default(CRASH_HISTORY_DEFAULT_LIMIT),
});
export type CrashHistoryQuery = z.infer<typeof crashHistoryQuerySchema>;

/** The latest finished rounds, newest first, each with its revealed seed and impact point. */
export const crashHistoryResponseSchema = z.object({
  rounds: z.array(crashRoundSchema).max(CRASH_HISTORY_MAX_LIMIT),
});
export type CrashHistoryResponse = z.infer<typeof crashHistoryResponseSchema>;

/**
 * Realtime events of a Crash stream. Event type names follow the English convention of the race
 * stream (`opened`, ...); only interface copy is in Spanish. The server never ticks the multiplier:
 * it announces the takeoff and the impact, and the browser animates the curve in between
 * (PLAN-CRASH §3.3, §5.4). Only `impact` carries the revealed `serverSeed`; the events are strict,
 * so any other event that carries it is rejected instead of passing with the key stripped.
 */
export const crashEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("opened"), round: crashRoundSchema }),
  z.strictObject({ type: z.literal("takeoff"), roundId: z.uuid(), startedAt: datetimeSchema }),
  z.strictObject({
    type: z.literal("impact"),
    roundId: z.uuid(),
    result: crashResultSchema,
    serverSeed: z.string().min(1),
  }),
  z.strictObject({ type: z.literal("settled"), roundId: z.uuid() }),
  // Aggregate only, never usernames: how many players cashed out and at what multiplier.
  z.strictObject({
    type: z.literal("cashout"),
    roundId: z.uuid(),
    count: z.number().int().min(1),
    atHundredths: multiplierSchema,
  }),
]);
export type CrashEvent = z.infer<typeof crashEventSchema>;

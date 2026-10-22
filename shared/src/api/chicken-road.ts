import { z } from "zod";
import { isValidChickenRoadStake, LANE_COUNT } from "../games/chicken-road";
import { amountSchema, positiveAmountSchema } from "../money";
import { fairnessSchema } from "./roulette";

/** Finished games the history returns when no `limit` is given, and the most it returns. */
export const CHICKEN_ROAD_HISTORY_DEFAULT_LIMIT = 5;
export const CHICKEN_ROAD_HISTORY_MAX_LIMIT = 20;

const laneSchema = z.number().int().min(1).max(LANE_COUNT);

// Zod 4 runs refinements even after a failed regex, so the digits are checked before `BigInt`.
const stakeSchema = positiveAmountSchema.refine(
  (value) => /^\d{1,20}$/.test(value) && isValidChickenRoadStake(BigInt(value)),
  "Stake must be between 10 and 500 credits",
);

/** Fields every game carries. `gameId` is the id of its bet. */
const gameFields = {
  gameId: z.uuid(),
  stake: amountSchema,
  fairness: fairnessSchema,
};

/**
 * A game still on the road. Strict: it never carries `hitLane`, which would tell the player
 * where the car is. `cashoutAmount` is what retiring now pays; "0" before the first lane.
 */
export const chickenRoadInProgressGameSchema = z.strictObject({
  status: z.literal("in_progress"),
  ...gameFields,
  lanesCrossed: z
    .number()
    .int()
    .min(0)
    .max(LANE_COUNT - 1),
  cashoutAmount: amountSchema,
});

/** Hit on `hitLane` (`lanesCrossed + 1`); the stake is lost. */
const lostGameSchema = z.object({
  status: z.literal("lost"),
  ...gameFields,
  lanesCrossed: z
    .number()
    .int()
    .min(0)
    .max(LANE_COUNT - 1),
  hitLane: laneSchema,
  payout: z.literal("0"),
});

/** Retired after `lanesCrossed` lanes and paid `payout`, stake included. */
const cashedOutGameSchema = z.object({
  status: z.literal("cashed_out"),
  ...gameFields,
  lanesCrossed: z
    .number()
    .int()
    .min(1)
    .max(LANE_COUNT - 1),
  payout: positiveAmountSchema,
});

/** Crossed every lane and was paid automatically. */
const completedGameSchema = z.object({
  status: z.literal("completed"),
  ...gameFields,
  lanesCrossed: z.literal(LANE_COUNT),
  payout: positiveAmountSchema,
});

/**
 * One game in any state. With "no current game" (the bet form) these are the five states of the
 * screen. The verifier (#15) recomputes the road from `fairness` once the seed is revealed and
 * checks the payout with `chickenRoad.payout({ stake, cashOutAt }, road)`.
 */
export const chickenRoadGameSchema = z.discriminatedUnion("status", [
  chickenRoadInProgressGameSchema,
  lostGameSchema,
  cashedOutGameSchema,
  completedGameSchema,
]);
export type ChickenRoadGame = z.infer<typeof chickenRoadGameSchema>;

export type ChickenRoadInProgressGame = z.infer<typeof chickenRoadInProgressGameSchema>;

/** A game that ended: lost, cashed out, or completed. */
export const chickenRoadFinishedGameSchema = z.discriminatedUnion("status", [
  lostGameSchema,
  cashedOutGameSchema,
  completedGameSchema,
]);
export type ChickenRoadFinishedGame = z.infer<typeof chickenRoadFinishedGameSchema>;

/** Starts a game and charges the stake. Sent with an `Idempotency-Key` header. */
export const chickenRoadStartRequestSchema = z.object({ stake: stakeSchema });
export type ChickenRoadStartRequest = z.infer<typeof chickenRoadStartRequestSchema>;

export const chickenRoadStartResponseSchema = z.object({
  game: chickenRoadInProgressGameSchema,
  balance: amountSchema,
});
export type ChickenRoadStartResponse = z.infer<typeof chickenRoadStartResponseSchema>;

/**
 * Tries to cross `lane`, which must be `lanesCrossed + 1`. Naming the lane lets a retried or
 * double-clicked step replay its result instead of crossing two lanes.
 */
export const chickenRoadStepRequestSchema = z.object({ gameId: z.uuid(), lane: laneSchema });
export type ChickenRoadStepRequest = z.infer<typeof chickenRoadStepRequestSchema>;

/** The game after the step: still in progress, lost, or completed on lane 6. */
export const chickenRoadStepResponseSchema = z.object({
  game: chickenRoadGameSchema,
  balance: amountSchema,
});
export type ChickenRoadStepResponse = z.infer<typeof chickenRoadStepResponseSchema>;

/** Retires and collects. A second request for the same game returns it as settled. */
export const chickenRoadCashoutRequestSchema = z.object({ gameId: z.uuid() });
export type ChickenRoadCashoutRequest = z.infer<typeof chickenRoadCashoutRequestSchema>;

export const chickenRoadCashoutResponseSchema = z.object({
  game: z.discriminatedUnion("status", [cashedOutGameSchema, completedGameSchema]),
  balance: amountSchema,
});
export type ChickenRoadCashoutResponse = z.infer<typeof chickenRoadCashoutResponseSchema>;

/** The game in progress, to restore it after a reload; `null` shows the bet form. */
export const chickenRoadCurrentResponseSchema = z.object({
  game: chickenRoadInProgressGameSchema.nullable(),
});
export type ChickenRoadCurrentResponse = z.infer<typeof chickenRoadCurrentResponseSchema>;

/** Query of the history ("Tus últimas partidas"). Query values arrive as strings. */
export const chickenRoadHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHICKEN_ROAD_HISTORY_MAX_LIMIT)
    .default(CHICKEN_ROAD_HISTORY_DEFAULT_LIMIT),
});
export type ChickenRoadHistoryQuery = z.infer<typeof chickenRoadHistoryQuerySchema>;

/** The player's latest finished games, newest first. */
export const chickenRoadHistoryResponseSchema = z.object({
  games: z.array(chickenRoadFinishedGameSchema).max(CHICKEN_ROAD_HISTORY_MAX_LIMIT),
});
export type ChickenRoadHistoryResponse = z.infer<typeof chickenRoadHistoryResponseSchema>;

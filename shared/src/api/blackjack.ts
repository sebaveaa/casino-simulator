import { z } from "zod";
import {
  BLACKJACK_MAX_ACTIONS,
  BLACKJACK_RANKS,
  BLACKJACK_SUITS,
  blackjackActionSchema,
  blackjackOutcomeSchema,
  isValidBlackjackStake,
} from "../games/blackjack";
import { amountSchema, positiveAmountSchema } from "../money";
import { fairnessSchema } from "./roulette";

/** Settled hands the history returns when no `limit` is given, and the most it returns. */
export const BLACKJACK_HISTORY_DEFAULT_LIMIT = 5;
export const BLACKJACK_HISTORY_MAX_LIMIT = 20;

/** A card as the API shows it; `describeCard` builds it from the card number. */
export const blackjackCardSchema = z.object({
  rank: z.enum(BLACKJACK_RANKS),
  suit: z.enum(BLACKJACK_SUITS),
});
export type BlackjackCard = z.infer<typeof blackjackCardSchema>;

/** Best total of a hand (`handValue`): from 4 (two twos) up to 30 (20 plus a ten). */
const handTotalSchema = z.object({ total: z.number().int().min(4).max(30), soft: z.boolean() });

const playerCardsSchema = z
  .array(blackjackCardSchema)
  .min(2)
  .max(2 + BLACKJACK_MAX_ACTIONS);

// Zod 4 runs refinements even after a failed regex, so the digits are checked before `BigInt`.
const stakeSchema = positiveAmountSchema.refine(
  (value) => /^\d{1,20}$/.test(value) && isValidBlackjackStake(BigInt(value)),
  "Stake must be between 10 and 500 credits",
);

/** Fields every hand carries. `handId` is the id of its bet; `stake` is the initial stake. */
const handFields = {
  handId: z.uuid(),
  stake: amountSchema,
  fairness: fairnessSchema,
  playerCards: playerCardsSchema,
  playerTotal: handTotalSchema,
};

/**
 * A hand waiting for the player. Strict: it never carries the dealer's hole card, a dealer total
 * or the shoe, which would tell the player what comes next. `actionCount` is the `index` of the
 * next action; `canDouble` holds on the first two cards. The last possible action always ends
 * the hand, so a hand in progress has taken at most `BLACKJACK_MAX_ACTIONS - 1`.
 */
export const blackjackInProgressHandSchema = z.strictObject({
  status: z.literal("player_turn"),
  ...handFields,
  dealerUpCard: blackjackCardSchema,
  actionCount: z
    .number()
    .int()
    .min(0)
    .max(BLACKJACK_MAX_ACTIONS - 1),
  canDouble: z.boolean(),
});
export type BlackjackInProgressHand = z.infer<typeof blackjackInProgressHandSchema>;

/**
 * A finished hand with every card. `totalStake` is the stake, doubled after `double`; `payout`
 * includes it and is "0" on any loss. The verifier (#15) replays it with `blackjack.resolve`.
 */
export const blackjackSettledHandSchema = z.object({
  status: z.literal("settled"),
  ...handFields,
  dealerCards: z.array(blackjackCardSchema).min(2),
  dealerTotal: handTotalSchema,
  doubled: z.boolean(),
  outcome: blackjackOutcomeSchema,
  totalStake: positiveAmountSchema,
  payout: amountSchema,
});
export type BlackjackSettledHand = z.infer<typeof blackjackSettledHandSchema>;

/** One hand in any state. With "no current hand" (the bet form) these are the screen states. */
export const blackjackHandSchema = z.discriminatedUnion("status", [
  blackjackInProgressHandSchema,
  blackjackSettledHandSchema,
]);
export type BlackjackHand = z.infer<typeof blackjackHandSchema>;

/** Starts a hand and charges the stake. Sent with an `Idempotency-Key` header. */
export const blackjackStartRequestSchema = z.object({ stake: stakeSchema });
export type BlackjackStartRequest = z.infer<typeof blackjackStartRequestSchema>;

/** A natural on either side settles the hand at once, so the start can answer a settled hand. */
export const blackjackStartResponseSchema = z.object({
  hand: blackjackHandSchema,
  balance: amountSchema,
});
export type BlackjackStartResponse = z.infer<typeof blackjackStartResponseSchema>;

/**
 * Plays `action` as the hand's action number `index` (from 0), which must be its `actionCount`.
 * Naming the position lets a retried or double-clicked action replay its result instead of
 * playing twice.
 */
export const blackjackActionRequestSchema = z.object({
  handId: z.uuid(),
  action: blackjackActionSchema,
  index: z
    .number()
    .int()
    .min(0)
    .max(BLACKJACK_MAX_ACTIONS - 1),
});
export type BlackjackActionRequest = z.infer<typeof blackjackActionRequestSchema>;

/** The hand after the action: still on the player's turn, or settled. */
export const blackjackActionResponseSchema = z.object({
  hand: blackjackHandSchema,
  balance: amountSchema,
});
export type BlackjackActionResponse = z.infer<typeof blackjackActionResponseSchema>;

/** The hand in progress, to restore it after a reload; `null` shows the bet form. */
export const blackjackCurrentResponseSchema = z.object({
  hand: blackjackInProgressHandSchema.nullable(),
});
export type BlackjackCurrentResponse = z.infer<typeof blackjackCurrentResponseSchema>;

/** Query of the history ("Tus últimas manos"). Query values arrive as strings. */
export const blackjackHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BLACKJACK_HISTORY_MAX_LIMIT)
    .default(BLACKJACK_HISTORY_DEFAULT_LIMIT),
});
export type BlackjackHistoryQuery = z.infer<typeof blackjackHistoryQuerySchema>;

/** The player's latest settled hands, newest first. */
export const blackjackHistoryResponseSchema = z.object({
  hands: z.array(blackjackSettledHandSchema).max(BLACKJACK_HISTORY_MAX_LIMIT),
});
export type BlackjackHistoryResponse = z.infer<typeof blackjackHistoryResponseSchema>;

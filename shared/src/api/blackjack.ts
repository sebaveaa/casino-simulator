import { z } from "zod";
import {
  BLACKJACK_CUT_CARD,
  BLACKJACK_MAX_ACTIONS,
  BLACKJACK_MAX_HAND_CARDS,
  BLACKJACK_MAX_HANDS,
  BLACKJACK_RANKS,
  BLACKJACK_SUITS,
  blackjackActionSchema,
  blackjackOutcomeSchema,
  isValidBlackjackStake,
  SHOE_SIZE,
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

/**
 * Best total of a hand (`handValue`): from 2 (a lone two, waiting for its second card after a
 * split) up to 30 (20 plus a ten).
 */
const handTotalSchema = z.object({ total: z.number().int().min(2).max(30), soft: z.boolean() });

const cardsSchema = (min: number) =>
  z.array(blackjackCardSchema).min(min).max(BLACKJACK_MAX_HAND_CARDS);

/**
 * One of the player's hands while the round runs. After a split the right hand holds one card
 * until its turn comes.
 */
const playerHandInPlaySchema = z.strictObject({
  cards: cardsSchema(1),
  total: handTotalSchema,
  doubled: z.boolean(),
});
export type BlackjackPlayerHandInPlay = z.infer<typeof playerHandInPlaySchema>;

/** One of the player's hands once settled: its outcome, and what it paid, stake included. */
const playerHandSettledSchema = z.object({
  cards: cardsSchema(2),
  total: handTotalSchema,
  doubled: z.boolean(),
  outcome: blackjackOutcomeSchema,
  payout: amountSchema,
});
export type BlackjackPlayerHandSettled = z.infer<typeof playerHandSettledSchema>;

// Zod 4 runs refinements even after a failed regex, so the digits are checked before `BigInt`.
const stakeSchema = positiveAmountSchema.refine(
  (value) => /^\d{1,20}$/.test(value) && isValidBlackjackStake(BigInt(value)),
  "Stake must be between 10 and 500 credits",
);

/**
 * What the verifier needs for a round (README §5.1): the seed pair and the nonce of its shoe, the
 * shoe's id, and `cardOffset`, the place of the round's first card in it. `shoeId` is `null` for a
 * round from before the continuous shoe, which had its own shoe from card 0.
 */
export const blackjackFairnessSchema = fairnessSchema.extend({
  shoeId: z.uuid().nullable(),
  cardOffset: z
    .number()
    .int()
    .min(0)
    .max(BLACKJACK_CUT_CARD - 1),
});
export type BlackjackFairness = z.infer<typeof blackjackFairnessSchema>;

/**
 * How much of the player's shoe is dealt (#66), for the pile on the felt: never which cards are
 * left. `cardsDealt` counts every card on the table, the dealer's hole card too (not its value).
 * `reshuffle`: the cut card is out, so the next hand is dealt from a new shoe.
 */
export const blackjackShoeSchema = z.strictObject({
  shoeId: z.uuid(),
  size: z.literal(SHOE_SIZE),
  cutCard: z.number().int().min(1).max(SHOE_SIZE),
  cardsDealt: z.number().int().min(0).max(SHOE_SIZE),
  reshuffle: z.boolean(),
});
export type BlackjackShoe = z.infer<typeof blackjackShoeSchema>;

/** Fields every round carries. `handId` is the id of its bet; `stake` is the initial stake. */
const handFields = {
  handId: z.uuid(),
  stake: amountSchema,
  fairness: blackjackFairnessSchema,
};

/**
 * A round waiting for the player. Strict: it never carries the dealer's hole card, a dealer total
 * or the shoe, which would tell the player what comes next. `activeHand` is the hand being played
 * (0, or 1 after a split); `actionCount` is the `index` of the next action. `canDouble` and
 * `canSplit` say what the active hand allows. The last possible action always ends the round, so
 * a round in progress has taken at most `BLACKJACK_MAX_ACTIONS - 1`.
 */
export const blackjackInProgressHandSchema = z.strictObject({
  status: z.literal("player_turn"),
  ...handFields,
  playerHands: z.array(playerHandInPlaySchema).min(1).max(BLACKJACK_MAX_HANDS),
  activeHand: z
    .number()
    .int()
    .min(0)
    .max(BLACKJACK_MAX_HANDS - 1),
  dealerUpCard: blackjackCardSchema,
  actionCount: z
    .number()
    .int()
    .min(0)
    .max(BLACKJACK_MAX_ACTIONS - 1),
  canDouble: z.boolean(),
  canSplit: z.boolean(),
});
export type BlackjackInProgressHand = z.infer<typeof blackjackInProgressHandSchema>;

/**
 * A finished round with every card. `totalStake` is every stake put on the table (the first, a
 * split, each double); `payout` is the sum of the hands' payouts and is "0" when all lost. The
 * verifier (#15) replays it with `blackjack.resolve`.
 */
export const blackjackSettledHandSchema = z.object({
  status: z.literal("settled"),
  ...handFields,
  playerHands: z.array(playerHandSettledSchema).min(1).max(BLACKJACK_MAX_HANDS),
  dealerCards: z.array(blackjackCardSchema).min(2),
  dealerTotal: handTotalSchema,
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

/**
 * A natural on either side settles the hand at once, so the start can answer a settled hand.
 * `shoe` is the shoe the hand came from, `null` only for a hand from before the continuous shoe.
 */
export const blackjackStartResponseSchema = z.object({
  hand: blackjackHandSchema,
  balance: amountSchema,
  shoe: blackjackShoeSchema.nullable(),
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

/** The hand after the action: still on the player's turn, or settled; `shoe` as in the start. */
export const blackjackActionResponseSchema = z.object({
  hand: blackjackHandSchema,
  balance: amountSchema,
  shoe: blackjackShoeSchema.nullable(),
});
export type BlackjackActionResponse = z.infer<typeof blackjackActionResponseSchema>;

/**
 * The hand in progress, to restore it after a reload; `null` shows the bet form. `shoe` is the
 * shoe the next cards come from, so the pile shows on the bet form too; `null` when the next hand
 * opens a new shoe (none yet, the last one is finished, or the seeds were rotated).
 */
export const blackjackCurrentResponseSchema = z.object({
  hand: blackjackInProgressHandSchema.nullable(),
  shoe: blackjackShoeSchema.nullable(),
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

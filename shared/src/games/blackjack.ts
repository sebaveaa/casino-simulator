import { z } from "zod";
import { MINOR_UNITS_PER_CREDIT, type Money } from "../money";
import type { Rng } from "../rng";
import type { Game, Wager } from "./game";

/** Decks in the shoe. */
export const DECK_COUNT = 6;

const DECK_SIZE = 52;

/** Cards in the shoe: six decks. */
export const SHOE_SIZE = DECK_COUNT * DECK_SIZE;

/** Stake bounds: 10 to 500 credits, in minor units. */
export const BLACKJACK_MIN_STAKE: Money = 10n * MINOR_UNITS_PER_CREDIT;
export const BLACKJACK_MAX_STAKE: Money = 500n * MINOR_UNITS_PER_CREDIT;

/** Ranks in card order: card `c` has rank `BLACKJACK_RANKS[c % 13]`. */
export const BLACKJACK_RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
] as const;
export type BlackjackRank = (typeof BLACKJACK_RANKS)[number];

/** Suits in card order: card `c` has suit `BLACKJACK_SUITS[floor(c / 13)]`. */
export const BLACKJACK_SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type BlackjackSuit = (typeof BLACKJACK_SUITS)[number];

export const blackjackActions = ["hit", "stand", "double"] as const;
export const blackjackActionSchema = z.enum(blackjackActions);
export type BlackjackAction = z.infer<typeof blackjackActionSchema>;

/**
 * How a hand ended. `blackjack` is a player natural (3:2); `dealer_blackjack` is a dealer natural
 * against a player without one; `bust` is a player over 21, so the dealer never drew.
 */
export const blackjackOutcomes = [
  "blackjack",
  "win",
  "push",
  "lose",
  "bust",
  "dealer_blackjack",
] as const;
export const blackjackOutcomeSchema = z.enum(blackjackOutcomes);
export type BlackjackOutcome = z.infer<typeof blackjackOutcomeSchema>;

/**
 * Most actions a hand can take: from two aces (2), 19 more aces reach 21, which stands by
 * itself. Six decks hold 24 aces, so that hand exists.
 */
export const BLACKJACK_MAX_ACTIONS = 19;

/** A card as an integer from 0 to 51 (see `BLACKJACK_RANKS` and `BLACKJACK_SUITS`). */
const cardSchema = z
  .number()
  .int()
  .min(0)
  .max(DECK_SIZE - 1);

/** A finished hand, as `resolve` returns it and the backend stores it once settled. */
export const blackjackResultSchema = z.object({
  playerCards: z.array(cardSchema).min(2),
  dealerCards: z.array(cardSchema).min(2),
  doubled: z.boolean(),
  outcome: blackjackOutcomeSchema,
});
export type BlackjackResult = z.infer<typeof blackjackResultSchema>;

/** A hand at any point: `outcome` is `null` while it is the player's turn. */
export type BlackjackHandState = Omit<BlackjackResult, "outcome"> & {
  outcome: BlackjackOutcome | null;
};

/** A hand as one bet: `stake` is the initial stake, `actions` the player's decisions in order. */
export type BlackjackBet = Wager & { actions: readonly BlackjackAction[] };

export function describeCard(card: number): { rank: BlackjackRank; suit: BlackjackSuit } {
  const rank = BLACKJACK_RANKS[card % 13];
  const suit = BLACKJACK_SUITS[Math.floor(card / 13)];
  if (!Number.isInteger(card) || rank === undefined || suit === undefined) {
    throw new RangeError("card must be an integer from 0 to 51");
  }
  return { rank, suit };
}

/** Points of one card with the ace as 1; picture cards count 10. */
function cardPoints(card: number): number {
  return Math.min((card % 13) + 1, 10);
}

/** Best total of a hand: one ace counts 11 when that does not bust it, and the hand is `soft`. */
export function handValue(cards: readonly number[]): { total: number; soft: boolean } {
  const hard = cards.reduce((sum, card) => sum + cardPoints(card), 0);
  const soft = cards.some((card) => card % 13 === 0) && hard + 10 <= 21;
  return { total: soft ? hard + 10 : hard, soft };
}

/** Two cards worth 21. */
export function isNatural(cards: readonly number[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

/**
 * Shuffles the six-deck shoe with Fisher-Yates: `rng.int(i + 1)` for i = 311 down to 1.
 * Returns cards (0 to 51), each six times.
 */
export function shuffleShoe(rng: Rng): number[] {
  const shoe = Array.from({ length: SHOE_SIZE }, (_, i) => i % DECK_SIZE);
  for (let i = SHOE_SIZE - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [shoe[i], shoe[j]] = [shoe[j] as number, shoe[i] as number];
  }
  return shoe;
}

/** The actions the player may take next; empty once the hand is over. */
export function legalActions(state: BlackjackHandState): BlackjackAction[] {
  if (state.outcome !== null) return [];
  return state.playerCards.length === 2 ? ["hit", "stand", "double"] : ["hit", "stand"];
}

/**
 * Replays a hand from the shoe and the player's actions (README §4.4: shoe + decisions = the whole
 * hand). Deals player, dealer, player, dealer; a natural on either side ends the hand at once
 * (the dealer peeks). 21 stands by itself, a bust ends the hand, and the dealer then draws to 17,
 * standing on soft 17. Throws on an action `legalActions` would not allow.
 */
export function playHand(
  shoe: readonly number[],
  actions: readonly BlackjackAction[],
): BlackjackHandState {
  let next = 0;
  const draw = (): number => {
    const card = shoe[next++];
    if (card === undefined) throw new RangeError("The shoe ran out of cards");
    return card;
  };
  const playerCards = [draw()];
  const dealerCards = [draw()];
  playerCards.push(draw());
  dealerCards.push(draw());
  const state: BlackjackHandState = { playerCards, dealerCards, doubled: false, outcome: null };

  const playerNatural = isNatural(playerCards);
  const dealerNatural = isNatural(dealerCards);
  if (playerNatural || dealerNatural) {
    state.outcome = playerNatural ? (dealerNatural ? "push" : "blackjack") : "dealer_blackjack";
  }

  const finish = () => {
    while (handValue(dealerCards).total < 17) dealerCards.push(draw());
    const player = handValue(playerCards).total;
    const dealer = handValue(dealerCards).total;
    state.outcome = dealer > 21 || player > dealer ? "win" : player === dealer ? "push" : "lose";
  };

  for (const action of actions) {
    if (!legalActions(state).includes(action)) {
      throw new Error(`Action "${action}" is not allowed now`);
    }
    if (action !== "stand") playerCards.push(draw());
    if (action === "double") state.doubled = true;

    const total = handValue(playerCards).total;
    if (total > 21) state.outcome = "bust";
    else if (action !== "hit" || total === 21) finish();
  }
  return state;
}

/** Total returned to the player, stake included; `0n` for any loss. Integers only. */
export function blackjackPayout(stake: Money, hand: Pick<BlackjackResult, "doubled" | "outcome">) {
  const wagered = hand.doubled ? stake * 2n : stake;
  switch (hand.outcome) {
    case "blackjack":
      // 3:2 plus the stake, rounded down.
      return (stake * 5n) / 2n;
    case "win":
      return wagered * 2n;
    case "push":
      return wagered;
    case "lose":
    case "bust":
    case "dealer_blackjack":
      return 0n;
  }
}

export function isValidBlackjackStake(stake: Money): boolean {
  return stake >= BLACKJACK_MIN_STAKE && stake <= BLACKJACK_MAX_STAKE;
}

/**
 * The shape of an action list, before any card is known: `double` only first, and nothing after
 * `stand` or `double`. `playHand` checks the rest, which depends on the cards.
 */
function isValidActionShape(actions: readonly BlackjackAction[]): boolean {
  if (actions.length > BLACKJACK_MAX_ACTIONS) return false;
  return actions.every((action, i) => {
    if (!blackjackActionSchema.safeParse(action).success) return false;
    if (action === "double" && i !== 0) return false;
    return action === "hit" || i === actions.length - 1;
  });
}

/** Blackjack rules (README §4.4). Pure, so the browser verifier runs this exact code. */
export const blackjack: Game<BlackjackBet, BlackjackResult> & { readonly id: "blackjack" } = {
  id: "blackjack",

  validateBet(bet) {
    return isValidBlackjackStake(bet.stake) && isValidActionShape(bet.actions);
  },

  /**
   * Shuffles the shoe and replays the actions. When they leave the player's turn open, the player
   * stands, as an abandoned hand does (README §4.4), so the result is always a finished hand.
   */
  resolve(bet, rng) {
    const shoe = shuffleShoe(rng);
    const state = playHand(shoe, bet.actions);
    const { outcome, ...cards } =
      state.outcome === null ? playHand(shoe, [...bet.actions, "stand"]) : state;
    if (outcome === null) throw new Error("A resolved hand has no outcome");
    return { ...cards, outcome };
  },

  payout(bet, result) {
    return blackjackPayout(bet.stake, result);
  },
};

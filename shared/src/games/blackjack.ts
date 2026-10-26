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

export const blackjackActions = ["hit", "stand", "double", "split"] as const;
export const blackjackActionSchema = z.enum(blackjackActions);
export type BlackjackAction = z.infer<typeof blackjackActionSchema>;

/**
 * How one of the player's hands ended. `blackjack` is a player natural (3:2), never a 21 after a
 * split; `dealer_blackjack` is a dealer natural against a player without one; `bust` is a hand
 * over 21, which loses whatever the dealer does.
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

/** A pair splits once, so the player plays at most two hands. */
export const BLACKJACK_MAX_HANDS = 2;

/** Most cards one hand can hold: twenty-one aces make 21, which stands by itself. */
export const BLACKJACK_MAX_HAND_CARDS = 21;

/**
 * Most actions a hand can take: a split, then each hand at most 19 (from two cards, 19 more aces
 * reach 21 and stand by themselves). Without a split a hand takes at most 19.
 */
export const BLACKJACK_MAX_ACTIONS = 1 + 2 * 19;

/** A card as an integer from 0 to 51 (see `BLACKJACK_RANKS` and `BLACKJACK_SUITS`). */
const cardSchema = z
  .number()
  .int()
  .min(0)
  .max(DECK_SIZE - 1);

/** One of the player's hands, finished. */
const playerHandResultSchema = z.object({
  cards: z.array(cardSchema).min(2).max(BLACKJACK_MAX_HAND_CARDS),
  doubled: z.boolean(),
  outcome: blackjackOutcomeSchema,
});

/** A finished round, as `resolve` returns it and the backend stores it once settled. */
export const blackjackResultSchema = z.object({
  playerHands: z.array(playerHandResultSchema).min(1).max(BLACKJACK_MAX_HANDS),
  dealerCards: z.array(cardSchema).min(2),
});
export type BlackjackResult = z.infer<typeof blackjackResultSchema>;

/** One of the player's hands at any point: `outcome` is `null` until it is decided. */
export type BlackjackPlayerHand = {
  cards: number[];
  doubled: boolean;
  outcome: BlackjackOutcome | null;
};

/**
 * A round at any point. `active` is the hand being played (the left one first after a split);
 * `finished` once every hand is decided and the dealer has played.
 */
export type BlackjackHandState = {
  playerHands: BlackjackPlayerHand[];
  active: number;
  dealerCards: number[];
  finished: boolean;
};

/** A round as one bet: `stake` is the initial stake, `actions` the player's decisions in order. */
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

const isAce = (card: number) => card % 13 === 0;
const sameRank = (a: number, b: number) => a % 13 === b % 13;

/**
 * The actions the player may take on the active hand; empty once the round is over. Double and
 * split need the hand's first two cards; split also needs a pair and no split before.
 */
export function legalActions(state: BlackjackHandState): BlackjackAction[] {
  if (state.finished) return [];
  const cards = state.playerHands[state.active]?.cards ?? [];
  if (cards.length !== 2) return ["hit", "stand"];
  const [first, second] = cards as [number, number];
  const canSplit = state.playerHands.length < BLACKJACK_MAX_HANDS && sameRank(first, second);
  return canSplit ? ["hit", "stand", "double", "split"] : ["hit", "stand", "double"];
}

/**
 * Replays a round from the shoe and the player's actions (README §4.4: shoe + decisions = the whole
 * round). Deals player, dealer, player, dealer; a natural on either side ends the round at once
 * (the dealer peeks). Each action plays the active hand: 21 stands by itself and a bust ends the
 * hand. A split makes two hands from the pair: the left one draws its second card at once, the
 * right one when its turn comes; split aces take one card each and stand. Once every hand is
 * done the dealer draws to 17, standing on soft 17, unless every hand busted. Throws on an action
 * `legalActions` would not allow.
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
  const firstCards = [draw()];
  const dealerCards = [draw()];
  firstCards.push(draw());
  dealerCards.push(draw());
  const state: BlackjackHandState = {
    playerHands: [{ cards: firstCards, doubled: false, outcome: null }],
    active: 0,
    dealerCards,
    finished: false,
  };
  const active = () => state.playerHands[state.active] as BlackjackPlayerHand;

  const playerNatural = isNatural(firstCards);
  const dealerNatural = isNatural(dealerCards);
  if (playerNatural || dealerNatural) {
    active().outcome = playerNatural ? (dealerNatural ? "push" : "blackjack") : "dealer_blackjack";
    state.finished = true;
  }

  const dealerPlays = () => {
    state.finished = true;
    const live = state.playerHands.filter((hand) => hand.outcome === null);
    // Every hand busted: there is nothing left to beat.
    if (live.length === 0) return;
    while (handValue(dealerCards).total < 17) dealerCards.push(draw());
    const dealer = handValue(dealerCards).total;
    for (const hand of live) {
      const player = handValue(hand.cards).total;
      hand.outcome = dealer > 21 || player > dealer ? "win" : player === dealer ? "push" : "lose";
    }
  };

  /** Whether the active hand takes no decision: split aces, or 21. */
  const standsAlone = () => {
    const { cards } = active();
    const splitAces = state.playerHands.length > 1 && isAce(cards[0] as number);
    return splitAces || handValue(cards).total === 21;
  };

  /** The active hand is done: the next one draws its second card, or the dealer plays. */
  const nextHand = () => {
    while (state.active + 1 < state.playerHands.length) {
      state.active += 1;
      active().cards.push(draw());
      if (!standsAlone()) return;
    }
    dealerPlays();
  };

  for (const action of actions) {
    if (!legalActions(state).includes(action)) {
      throw new Error(`Action "${action}" is not allowed now`);
    }
    const hand = active();
    if (action === "split") {
      const [left, right] = hand.cards as [number, number];
      state.playerHands = [
        { cards: [left, draw()], doubled: false, outcome: null },
        { cards: [right], doubled: false, outcome: null },
      ];
      if (standsAlone()) nextHand();
      continue;
    }
    if (action === "stand") {
      nextHand();
      continue;
    }
    hand.cards.push(draw());
    if (action === "double") hand.doubled = true;
    const total = handValue(hand.cards).total;
    if (total > 21) hand.outcome = "bust";
    if (action === "double" || total >= 21) nextHand();
  }
  return state;
}

/** What one hand returns, stake included; `0n` for any loss. Integers only. */
export function blackjackHandPayout(
  stake: Money,
  hand: { doubled: boolean; outcome: BlackjackOutcome },
): Money {
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

/** What the round returns: the sum over the player's hands. */
export function blackjackPayout(stake: Money, result: Pick<BlackjackResult, "playerHands">): Money {
  return result.playerHands.reduce((sum, hand) => sum + blackjackHandPayout(stake, hand), 0n);
}

/** How many stakes the actions put on the table: the first, one per split, one per double. */
export function blackjackWagerCount(actions: readonly BlackjackAction[]): bigint {
  return 1n + BigInt(actions.filter((action) => action === "split" || action === "double").length);
}

export function isValidBlackjackStake(stake: Money): boolean {
  return stake >= BLACKJACK_MIN_STAKE && stake <= BLACKJACK_MAX_STAKE;
}

/**
 * The shape of an action list, before any card is known: known actions, not too many, and a split
 * only as the first one. `playHand` checks the rest, which depends on the cards.
 */
function isValidActionShape(actions: readonly BlackjackAction[]): boolean {
  if (actions.length > BLACKJACK_MAX_ACTIONS) return false;
  return actions.every(
    (action, i) =>
      blackjackActionSchema.safeParse(action).success && (action !== "split" || i === 0),
  );
}

/** Blackjack rules (README §4.4). Pure, so the browser verifier runs this exact code. */
export const blackjack: Game<BlackjackBet, BlackjackResult> & { readonly id: "blackjack" } = {
  id: "blackjack",

  validateBet(bet) {
    return isValidBlackjackStake(bet.stake) && isValidActionShape(bet.actions);
  },

  /**
   * Shuffles the shoe and replays the actions. When they leave a hand open, the player stands on
   * it, as an abandoned round does (README §4.4), so the result is always a finished round.
   */
  resolve(bet, rng) {
    const shoe = shuffleShoe(rng);
    const actions = [...bet.actions];
    let state = playHand(shoe, actions);
    while (!state.finished) {
      actions.push("stand");
      state = playHand(shoe, actions);
    }
    return {
      playerHands: state.playerHands.map(({ cards, doubled, outcome }) => {
        if (outcome === null) throw new Error("A resolved hand has no outcome");
        return { cards, doubled, outcome };
      }),
      dealerCards: state.dealerCards,
    };
  },

  payout(bet, result) {
    return blackjackPayout(bet.stake, result);
  },
};

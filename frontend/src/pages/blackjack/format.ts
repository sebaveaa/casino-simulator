import {
  BLACKJACK_MAX_STAKE,
  BLACKJACK_MIN_STAKE,
  type BlackjackCard,
  type BlackjackOutcome,
  type BlackjackSettledHand,
  MINOR_UNITS_PER_CREDIT,
  type Money,
  parseAmount,
} from "@casino/shared";
import { shortCredits } from "../roulette/money";

/** Credits as the screens show them ("10", "12.50"), from an API amount or minor units. */
export function credits(amount: string | Money): string {
  return shortCredits(typeof amount === "string" ? parseAmount(amount) : amount);
}

/** "Ganancia": payout minus what was wagered, in BigInt from the API strings. */
export function gainOf(payout: string, totalStake: string): Money {
  return parseAmount(payout) - parseAmount(totalStake);
}

/** Step of the amount field and quick buttons, in credits. */
export const STAKE_STEP_CREDITS = 10n;
export const QUICK_STAKES = [10, 50, 100, 500] as const;

/**
 * The stake typed in whole credits as an API amount (minor units), or null when it is not a whole
 * number of credits from 10 to 500 in steps of 10, like the field's min, max and step.
 */
export function stakeFromInput(text: string): string | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const creditsTyped = BigInt(text.trim());
  const minor = creditsTyped * MINOR_UNITS_PER_CREDIT;
  if (
    minor < BLACKJACK_MIN_STAKE ||
    minor > BLACKJACK_MAX_STAKE ||
    creditsTyped % STAKE_STEP_CREDITS !== 0n
  ) {
    return null;
  }
  return minor.toString();
}

export const SUIT_SYMBOLS: Record<BlackjackCard["suit"], string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const SUIT_NAMES: Record<BlackjackCard["suit"], string> = {
  spades: "picas",
  hearts: "corazones",
  diamonds: "diamantes",
  clubs: "tréboles",
};

const RANK_NAMES: Partial<Record<BlackjackCard["rank"], string>> = {
  A: "As",
  J: "J",
  Q: "Q",
  K: "K",
};

/** The card as a screen reader says it: "As de picas", "10 de corazones". */
export function cardName(card: BlackjackCard): string {
  return `${RANK_NAMES[card.rank] ?? card.rank} de ${SUIT_NAMES[card.suit]}`;
}

export function isRedSuit(suit: BlackjackCard["suit"]): boolean {
  return suit === "hearts" || suit === "diamonds";
}

/** A total as the table shows it: "17", or "7 / 17" while an ace still counts 11 (21 is 21). */
export function totalLabel(hand: { total: number; soft: boolean }): string {
  return hand.soft && hand.total !== 21 ? `${hand.total - 10} / ${hand.total}` : String(hand.total);
}

/** The headline of a settled hand. */
export const OUTCOME_TITLES: Record<BlackjackOutcome, string> = {
  blackjack: "¡Blackjack!",
  win: "¡Ganaste!",
  push: "Empate",
  lose: "Perdiste",
  bust: "Te pasaste",
  dealer_blackjack: "Blackjack de la banca",
};

/** Whether the outcome paid more than it took. */
export function isWin(outcome: BlackjackOutcome): boolean {
  return outcome === "blackjack" || outcome === "win";
}

/** The tone a round's result is shown in: sun for a gain, plain for even, tomato for a loss. */
export type RoundTone = "won" | "even" | "lost";

/**
 * How a settled round reads at a glance. One hand: its outcome ("Te pasaste"). Two hands after a
 * split: the net over both ("¡Ganaste!", "Empate", "Perdiste"). `net` is the payout minus every
 * stake on the table.
 */
export function roundSummary(hand: BlackjackSettledHand): {
  title: string;
  net: Money;
  tone: RoundTone;
} {
  const net = gainOf(hand.payout, hand.totalStake);
  const tone: RoundTone = net > 0n ? "won" : net === 0n ? "even" : "lost";
  const [only] = hand.playerHands;
  if (hand.playerHands.length === 1 && only)
    return { title: OUTCOME_TITLES[only.outcome], net, tone };
  const title = tone === "won" ? "¡Ganaste!" : tone === "even" ? "Empate" : "Perdiste";
  return { title, net, tone };
}

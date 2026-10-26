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

/** The chips a player puts on the bet, in credits. */
export const CHIP_VALUES = [10, 50, 100, 500] as const;
export type ChipValue = (typeof CHIP_VALUES)[number];

/** The most the bet holds, in credits. */
export const MAX_BET_CREDITS = Number(BLACKJACK_MAX_STAKE / MINOR_UNITS_PER_CREDIT);

/** Chips worth `total` credits as an API stake, or null below 10 or above 500 credits. */
export function stakeOfCredits(total: number): string | null {
  const minor = BigInt(total) * MINOR_UNITS_PER_CREDIT;
  return minor < BLACKJACK_MIN_STAKE || minor > BLACKJACK_MAX_STAKE ? null : minor.toString();
}

/** An API stake in whole credits, as the chips count it. */
export function creditsOfStake(stake: string): number {
  return Number(parseAmount(stake) / MINOR_UNITS_PER_CREDIT);
}

/** The fewest chips worth `total` credits, largest first: how a dealer stacks a bet. */
export function chipsFor(total: number): ChipValue[] {
  const chips: ChipValue[] = [];
  let left = total;
  for (const value of [...CHIP_VALUES].reverse()) {
    for (; left >= value; left -= value) chips.push(value);
  }
  return chips;
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

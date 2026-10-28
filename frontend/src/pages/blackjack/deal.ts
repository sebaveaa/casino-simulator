import type { BlackjackCard } from "@casino/shared";
import type { BlackjackView } from "./useBlackjack";

/** Time between two cards landing, and how long one card takes to land. */
export const DEAL_STEP_MS = 420;
export const DEAL_ANIMATION_MS = 520;

type Slot = BlackjackCard | null;

/**
 * The cards on the felt: the player's hands (two after a split) and the dealer's; `null` is the
 * dealer's hole card, face down.
 */
export type TableCards = {
  player: Slot[][];
  dealer: Slot[];
};

/**
 * When each card starts to land, in ms, or `null` for a card already on the felt. `durationMs` is
 * when the last one has landed, so the screen waits that long before showing the result.
 */
export type DealPlan = {
  player: (number | null)[][];
  dealer: (number | null)[];
  durationMs: number;
};

export const NO_DEAL: DealPlan = { player: [], dealer: [], durationMs: 0 };

export function cardsOf(view: BlackjackView): TableCards {
  if (view.kind === "bet") return { player: [], dealer: [] };
  const { hand } = view;
  return {
    player: hand.playerHands.map((h) => h.cards),
    dealer: hand.status === "player_turn" ? [hand.dealerUpCard, null] : hand.dealerCards,
  };
}

const sameSlot = (a: Slot | undefined, b: Slot) =>
  a !== undefined &&
  (a === null ? b === null : b !== null && a.rank === b.rank && a.suit === b.suit);

/**
 * A card is new when its place was empty or held another card: a draw, the hole card turned face
 * up, or after a split the left hand's second card and the pair's other card moving right.
 */
function newIndexes(before: Slot[], after: Slot[]): number[] {
  return after.flatMap((card, i) => (sameSlot(before[i], card) ? [] : [i]));
}

/**
 * The order the new cards land in. A fresh deal goes player, dealer, player, dealer, as at a real
 * table; afterwards the player's new cards come first, hand by hand, then the dealer turns the
 * hole card and draws. `stepMs` 0 (reduced motion) lands them all at once.
 */
export function planDeal(
  before: TableCards,
  after: TableCards,
  stepMs = DEAL_STEP_MS,
  animationMs = DEAL_ANIMATION_MS,
): DealPlan {
  const player = after.player.map((cards) => cards.map((): number | null => null));
  const dealer = after.dealer.map((): number | null => null);
  const newPlayer = after.player.map((cards, h) => newIndexes(before.player[h] ?? [], cards));
  const newDealer = newIndexes(before.dealer, after.dealer);

  const order: [number | "dealer", number][] = [];
  if (before.player.length === 0 && before.dealer.length === 0) {
    // Card by card across the table: player 1, dealer 1, player 2, dealer 2, then the rest.
    const first = after.player[0] ?? [];
    const rounds = Math.max(first.length, after.dealer.length);
    for (let i = 0; i < rounds; i++) {
      if (newPlayer[0]?.includes(i)) order.push([0, i]);
      if (newDealer.includes(i)) order.push(["dealer", i]);
    }
  } else {
    newPlayer.forEach((indexes, h) => {
      for (const i of indexes) order.push([h, i]);
    });
    for (const i of newDealer) order.push(["dealer", i]);
  }

  order.forEach(([who, i], position) => {
    const delay = position * stepMs;
    if (who === "dealer") dealer[i] = delay;
    else (player[who] as (number | null)[])[i] = delay;
  });
  const durationMs = order.length === 0 ? 0 : (order.length - 1) * stepMs + animationMs;
  return { player, dealer, durationMs };
}

import type { BlackjackCard } from "@casino/shared";
import type { BlackjackView } from "./useBlackjack";

/** Time between two cards landing, and how long one card takes to land. */
export const DEAL_STEP_MS = 420;
export const DEAL_ANIMATION_MS = 520;

/** The cards on the felt; `null` is the dealer's hole card, face down. */
export type TableCards = {
  player: (BlackjackCard | null)[];
  dealer: (BlackjackCard | null)[];
};

/**
 * When each card starts to land, in ms, or `null` for a card already on the felt. `durationMs` is
 * when the last one has landed, so the screen waits that long before showing the result.
 */
export type DealPlan = {
  player: (number | null)[];
  dealer: (number | null)[];
  durationMs: number;
};

export const NO_DEAL: DealPlan = { player: [], dealer: [], durationMs: 0 };

export function cardsOf(view: BlackjackView): TableCards {
  if (view.kind === "bet") return { player: [], dealer: [] };
  const { hand } = view;
  return {
    player: hand.playerCards,
    dealer: hand.status === "player_turn" ? [hand.dealerUpCard, null] : hand.dealerCards,
  };
}

/** A card is new when its place was empty, or held the hole card that is now face up. */
function newIndexes(before: TableCards[keyof TableCards], after: TableCards[keyof TableCards]) {
  return after.flatMap((card, i) =>
    i >= before.length || (before[i] === null && card) ? [i] : [],
  );
}

/**
 * The order the new cards land in. A fresh deal goes player, dealer, player, dealer, as at a real
 * table; afterwards the player's new card comes first, then the dealer turns the hole card and
 * draws. `stepMs` 0 (reduced motion) lands them all at once.
 */
export function planDeal(
  before: TableCards,
  after: TableCards,
  stepMs = DEAL_STEP_MS,
  animationMs = DEAL_ANIMATION_MS,
): DealPlan {
  const player: (number | null)[] = after.player.map(() => null);
  const dealer: (number | null)[] = after.dealer.map(() => null);
  const newPlayer = newIndexes(before.player, after.player);
  const newDealer = newIndexes(before.dealer, after.dealer);

  const order: ["player" | "dealer", number][] = [];
  if (before.player.length === 0 && before.dealer.length === 0) {
    // Card by card across both hands: player 1, dealer 1, player 2, dealer 2, then the rest.
    const rounds = Math.max(after.player.length, after.dealer.length);
    for (let i = 0; i < rounds; i++) {
      if (newPlayer.includes(i)) order.push(["player", i]);
      if (newDealer.includes(i)) order.push(["dealer", i]);
    }
  } else {
    for (const i of newPlayer) order.push(["player", i]);
    for (const i of newDealer) order.push(["dealer", i]);
  }

  order.forEach(([who, i], position) => {
    (who === "player" ? player : dealer)[i] = position * stepMs;
  });
  const durationMs = order.length === 0 ? 0 : (order.length - 1) * stepMs + animationMs;
  return { player, dealer, durationMs };
}

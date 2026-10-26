import type { BlackjackCard } from "@casino/shared";
import { useId } from "react";
import { totalLabel } from "./format";
import { PlayingCard } from "./PlayingCard";
import type { BlackjackView } from "./useBlackjack";

type Total = { total: number; soft: boolean };

function Hand({
  title,
  cards,
  total,
}: {
  title: string;
  cards: (BlackjackCard | null)[];
  /** `null` while the hole card hides the dealer's total. */
  total: Total | null;
}) {
  const titleId = useId();
  return (
    <div className="bj-hand">
      <div className="bj-hand-head">
        <h2 id={titleId} className="bj-hand-title">
          {title}
        </h2>
        {cards.length > 0 && (
          <span className="bj-total amount">
            <span className="roulette-sr-only">Total: </span>
            {total ? totalLabel(total) : "?"}
          </span>
        )}
      </div>
      {cards.length > 0 ? (
        <ul className="bj-cards" aria-labelledby={titleId}>
          {cards.map((card, index) => (
            // Cards never move once dealt, so the position is a stable key.
            // biome-ignore lint/suspicious/noArrayIndexKey: a dealt card keeps its position
            <PlayingCard key={index} card={card} index={index} />
          ))}
        </ul>
      ) : (
        <p className="bj-empty">Esperando el reparto</p>
      )}
    </div>
  );
}

/**
 * The felt: the dealer's hand on top, the player's below. On the player's turn the dealer shows
 * the up card and the hole card face down; the hand the server settled shows every card.
 */
export function Table({ view }: { view: BlackjackView }) {
  if (view.kind === "bet") {
    return (
      <div className="bj-table">
        <Hand title="Banca" cards={[]} total={null} />
        <p className="bj-rules-line">La banca se planta en 17 · Blackjack paga 3:2</p>
        <Hand title="Tú" cards={[]} total={null} />
      </div>
    );
  }
  const { hand } = view;
  const dealer =
    hand.status === "player_turn"
      ? { cards: [hand.dealerUpCard, null], total: null }
      : { cards: hand.dealerCards, total: hand.dealerTotal };
  return (
    <div className="bj-table">
      <Hand title="Banca" cards={dealer.cards} total={dealer.total} />
      <p className="bj-rules-line">La banca se planta en 17 · Blackjack paga 3:2</p>
      <Hand title="Tú" cards={hand.playerCards} total={hand.playerTotal} />
    </div>
  );
}

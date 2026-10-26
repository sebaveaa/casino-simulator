import type { BlackjackCard } from "@casino/shared";
import { cardName, isRedSuit, SUIT_SYMBOLS } from "./format";

/**
 * One card, or the dealer's hole card face down. `index` staggers the deal animation, so cards
 * land one after another; reduced motion turns it off in CSS.
 */
export function PlayingCard({ card, index }: { card: BlackjackCard | null; index: number }) {
  const style = { "--deal": index } as React.CSSProperties;
  if (!card) {
    return (
      <li className="bj-card is-hidden" style={style} aria-label="Carta oculta">
        <span className="bj-card-back" aria-hidden="true" />
      </li>
    );
  }
  const symbol = SUIT_SYMBOLS[card.suit];
  return (
    <li
      className={isRedSuit(card.suit) ? "bj-card is-red" : "bj-card"}
      style={style}
      aria-label={cardName(card)}
    >
      <span className="bj-card-corner" aria-hidden="true">
        {card.rank}
        <br />
        {symbol}
      </span>
      <span className="bj-card-pip" aria-hidden="true">
        {symbol}
      </span>
    </li>
  );
}

import type { BlackjackCard } from "@casino/shared";
import { useId } from "react";
import { cardsOf, type DealPlan } from "./deal";
import { totalLabel } from "./format";
import { PlayingCard } from "./PlayingCard";
import type { BlackjackView } from "./useBlackjack";

type Total = { total: number; soft: boolean };

function Hand({
  title,
  cards,
  delays,
  total,
}: {
  title: string;
  cards: (BlackjackCard | null)[];
  delays: (number | null)[];
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
            // A dealt card keeps its place; the hole card turns over in place, so the position is
            // the key and the flip is a transition, not a new card.
            // biome-ignore lint/suspicious/noArrayIndexKey: a dealt card keeps its position
            <PlayingCard key={index} card={card} delayMs={delays[index] ?? null} />
          ))}
        </ul>
      ) : (
        <p className="bj-empty">Esperando el reparto</p>
      )}
    </div>
  );
}

/**
 * The table rules printed on the felt in two arcs, like a casino table. Decorative: the same text
 * is in the page for screen readers.
 */
function FeltLegend() {
  const outer = useId();
  const inner = useId();
  return (
    <div className="bj-legend">
      <svg className="bj-legend-art" viewBox="0 0 600 120" aria-hidden="true" focusable="false">
        <defs>
          <path id={outer} d="M 30 16 Q 300 106 570 16" />
          <path id={inner} d="M 130 74 Q 300 140 470 74" />
        </defs>
        <text className="bj-legend-main">
          <textPath href={`#${outer}`} startOffset="50%" textAnchor="middle">
            BLACKJACK PAGA 3 A 2
          </textPath>
        </text>
        <text className="bj-legend-sub">
          <textPath href={`#${inner}`} startOffset="50%" textAnchor="middle">
            LA BANCA SE PLANTA EN 17
          </textPath>
        </text>
      </svg>
      <p className="roulette-sr-only">Blackjack paga 3 a 2. La banca se planta en 17.</p>
    </div>
  );
}

/**
 * The felt: the dealer's hand on top, the player's below. On the player's turn the dealer shows
 * the up card and the hole card face down; once the hand is settled the hole card turns over and
 * the dealer's draws land, in the order `deal` plans.
 */
export function Table({
  view,
  deal,
  dealing,
}: {
  view: BlackjackView;
  deal: DealPlan;
  /** While the cards land, the dealer's total stays hidden so it does not give the result away. */
  dealing: boolean;
}) {
  const { player, dealer } = cardsOf(view);
  const hand = view.kind === "bet" ? null : view.hand;
  const dealerTotal = hand?.status === "settled" && !dealing ? hand.dealerTotal : null;
  return (
    <div className="bj-table">
      <Hand title="Banca" cards={dealer} delays={deal.dealer} total={dealerTotal} />
      <FeltLegend />
      <Hand title="Tú" cards={player} delays={deal.player} total={hand?.playerTotal ?? null} />
    </div>
  );
}

import type { BlackjackCard, BlackjackShoe } from "@casino/shared";
import { type ReactNode, useId } from "react";
import { ChipPiles } from "./Chips";
import { MiniBack } from "./DeckPicker";
import { cardsOf, type DealPlan } from "./deal";
import { FeltArc } from "./FeltArc";
import { type ChipValue, totalLabel } from "./format";
import { PlayingCard } from "./PlayingCard";
import { ShoeMeter } from "./ShoeMeter";
import type { BlackjackView } from "./useBlackjack";

type Total = { total: number; soft: boolean };

function Hand({
  title,
  cards,
  delays,
  total,
  active = false,
  keyByCard = false,
  final = false,
  aside,
  waiting,
}: {
  title: string;
  cards: (BlackjackCard | null)[];
  delays: (number | null)[];
  /** `null` while the hole card hides the dealer's total. */
  total: Total | null;
  /** The hand being played after a split. */
  active?: boolean;
  /**
   * Key the player's cards by card, so the card a split moves or draws into a place lands anew.
   * The dealer's are keyed by place, so the hole card turns over in place instead.
   */
  keyByCard?: boolean;
  /** Once the round is settled a total reads as one number: "16", not "6 / 16". */
  final?: boolean;
  /** Beside the title and total: the hand's chips, or the shoe. */
  aside?: ReactNode;
  /** What the empty place says before the deal. */
  waiting: { suits: readonly [string, string]; text: string };
}) {
  const titleId = useId();
  return (
    <div className={active ? "bj-hand is-active" : "bj-hand"}>
      <div className="bj-hand-head">
        <h2 id={titleId} className="bj-hand-title">
          {title}
        </h2>
        {cards.length > 0 && (
          <span className="bj-total amount">
            <span className="roulette-sr-only">Total: </span>
            {total ? (final ? String(total.total) : totalLabel(total)) : "?"}
          </span>
        )}
        {active && <span className="bj-turn">Tu turno</span>}
        {aside}
      </div>
      {cards.length > 0 ? (
        <ul className="bj-cards" aria-labelledby={titleId}>
          {cards.map((card, index) => (
            <PlayingCard
              key={keyByCard && card ? `${index}-${card.rank}-${card.suit}` : index}
              card={card}
              delayMs={delays[index] ?? null}
            />
          ))}
        </ul>
      ) : (
        // Two card places waiting for the deal, gently lit in turn.
        <div className="bj-waiting">
          <span className="bj-ghosts" aria-hidden="true">
            <span className="bj-ghost">{waiting.suits[0]}</span>
            <span className="bj-ghost">{waiting.suits[1]}</span>
          </span>
          <p className="bj-wait">{waiting.text}</p>
        </div>
      )}
    </div>
  );
}

/** Opens the card-back designs; it shows the back in use. */
function DecksButton({
  deck,
  onOpen,
  disabled,
}: {
  deck: string;
  onOpen: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className="bj-shoe"
      title="Diseños de las cartas"
      disabled={disabled}
      onClick={onOpen}
    >
      <MiniBack deck={deck} />
      Mazos
    </button>
  );
}

const DEALER_WAITING = { suits: ["♠", "♥"], text: "La banca espera" } as const;

/**
 * The felt: the dealer's hand on top with the card designs and the shoe's meter, the player's below
 * with the chips of the bet,
 * two hands side by side after a split with the one being played highlighted (a doubled hand
 * shows its stake twice). On the player's turn the dealer shows the up card and the hole card
 * face down; once the round is settled the hole card turns over and the dealer's draws land, in
 * the order `deal` plans. Before the deal, a click on the chips takes back the one on top.
 */
export function Table({
  view,
  deal,
  dealing,
  chips,
  onTakeChip,
  shoe,
  deck,
  onDecks,
  canPickDeck,
}: {
  view: BlackjackView;
  deal: DealPlan;
  /** While the cards land, the dealer's total stays hidden so it does not give the result away. */
  dealing: boolean;
  /** The chips of one stake: the bet being built, or the round's. */
  chips: readonly ChipValue[];
  /** Before the deal, takes back the chip on top; absent while the felt is busy. */
  onTakeChip?: () => void;
  /** How much of the shoe is dealt; `null` for a new one. */
  shoe: BlackjackShoe | null;
  /** The card-back design in use, and opening the designs. */
  deck: string;
  onDecks: () => void;
  canPickDeck: boolean;
}) {
  const { player, dealer } = cardsOf(view);
  const hand = view.kind === "bet" ? null : view.hand;
  const dealerTotal = hand?.status === "settled" && !dealing ? hand.dealerTotal : null;
  const split = player.length > 1;
  const activeHand = hand?.status === "player_turn" ? hand.activeHand : null;
  const tools = (
    <span className="bj-table-tools">
      <DecksButton deck={deck} onOpen={onDecks} disabled={!canPickDeck} />
      <ShoeMeter shoe={shoe} />
    </span>
  );
  return (
    <div className="bj-table">
      <Hand
        title="Banca"
        cards={dealer}
        delays={deal.dealer}
        total={dealerTotal}
        final
        aside={tools}
        waiting={DEALER_WAITING}
      />
      <FeltArc
        main="BLACKJACK PAGA 3 A 2"
        sub="LA BANCA SE PLANTA EN 17"
        spoken="Blackjack paga 3 a 2. La banca se planta en 17."
      />
      {player.length === 0 ? (
        <Hand
          title="Tú"
          cards={[]}
          delays={[]}
          total={null}
          aside={
            <span className="bj-hand-chips">
              <ChipPiles chips={chips} size="sm" onTakeTop={onTakeChip} disabled={!onTakeChip} />
            </span>
          }
          waiting={{
            suits: ["♦", "♣"],
            text: chips.length > 0 ? "Listo para repartir" : "Pon tus fichas y reparte",
          }}
        />
      ) : (
        <div className={split ? "bj-player-hands is-split" : "bj-player-hands"}>
          {player.map((cards, h) => {
            const doubled = hand?.playerHands[h]?.doubled ?? false;
            return (
              <Hand
                // A split never reorders the hands, so the position is a stable key.
                // biome-ignore lint/suspicious/noArrayIndexKey: the player's hands keep their order
                key={h}
                title={split ? `Mano ${h + 1}` : "Tú"}
                cards={cards}
                delays={deal.player[h] ?? []}
                total={hand?.playerHands[h]?.total ?? null}
                active={split && activeHand === h}
                final={hand?.status === "settled"}
                keyByCard
                aside={
                  <span className="bj-hand-chips">
                    <ChipPiles chips={doubled ? [...chips, ...chips] : chips} size="sm" />
                  </span>
                }
                waiting={DEALER_WAITING}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

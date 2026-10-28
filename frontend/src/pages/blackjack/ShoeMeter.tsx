import { BLACKJACK_CUT_CARD, type BlackjackShoe, SHOE_SIZE } from "@casino/shared";
import type { CSSProperties } from "react";

/**
 * How much of the shoe is dealt (#66), in the dealer's corner beside Mazos: a bar that fills with
 * the backs of the chosen deck as cards are dealt, with the cut card as a red line at 75 %. Past
 * the line the shoe is shuffled before the next hand. `null` is a new shoe: nothing dealt yet.
 * A meter, not a button: the server decides when the shoe runs out. The drawn bar is decoration;
 * a native `<meter>` says the same to screen readers.
 */
export function ShoeMeter({ shoe }: { shoe: BlackjackShoe | null }) {
  const size = shoe?.size ?? SHOE_SIZE;
  const cutCard = shoe?.cutCard ?? BLACKJACK_CUT_CARD;
  const dealt = shoe?.cardsDealt ?? 0;
  const left = size - dealt;
  const style = {
    "--dealt": `${(dealt / size) * 100}%`,
    "--cut": `${(cutCard / size) * 100}%`,
  } as CSSProperties;
  const label = shoe?.reshuffle
    ? "Zapato: salió la carta de corte, se baraja antes de la próxima mano"
    : `Zapato: quedan ${left} de ${size} cartas; se baraja en la carta de corte`;
  return (
    <span
      className={shoe?.reshuffle ? "bj-shoe-meter is-cut" : "bj-shoe-meter"}
      title={`${label}. La línea roja es la carta de corte.`}
      style={style}
    >
      <meter className="roulette-sr-only" min={0} max={size} value={left} aria-label={label} />
      <span className="bj-shoe-track" aria-hidden="true">
        <span className="bj-shoe-fill" />
        <span className="bj-shoe-cut" />
      </span>
      <span className="bj-shoe-left amount" aria-hidden="true">
        {left}
      </span>
    </span>
  );
}

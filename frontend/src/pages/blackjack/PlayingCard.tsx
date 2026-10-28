import type { BlackjackCard } from "@casino/shared";
import { type CSSProperties, useEffect } from "react";
import { cardName, isRedSuit, SUIT_SYMBOLS } from "./format";
import { playCardSound } from "./sound";

/**
 * One card on the felt. It has a face and a back, so the dealer's hole card turns over in 3D
 * when the hand ends instead of popping in. `delayMs` is when it lands (or turns), from the deal
 * plan; `null` means it was already on the felt and does not move. Each landing snaps once.
 */
export function PlayingCard({
  card,
  delayMs,
}: {
  card: BlackjackCard | null;
  delayMs: number | null;
}) {
  useEffect(() => {
    if (delayMs === null) return;
    const timer = setTimeout(() => playCardSound(), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  const style = { "--deal-delay": `${delayMs ?? 0}ms` } as CSSProperties;
  const classes = ["bj-card"];
  if (!card) classes.push("is-down");
  if (card && isRedSuit(card.suit)) classes.push("is-red");

  return (
    <li
      className={classes.join(" ")}
      style={style}
      aria-label={card ? cardName(card) : "Carta oculta"}
    >
      <span className="bj-card-inner" aria-hidden="true">
        <span className="bj-card-face">
          {card && (
            <>
              <span className="bj-card-corner">
                {card.rank}
                <br />
                {SUIT_SYMBOLS[card.suit]}
              </span>
              <span className="bj-card-pip">{SUIT_SYMBOLS[card.suit]}</span>
              <span className="bj-card-corner is-bottom">
                {card.rank}
                <br />
                {SUIT_SYMBOLS[card.suit]}
              </span>
            </>
          )}
        </span>
        <span className="bj-card-back">
          <span className="bj-card-back-pattern" />
        </span>
      </span>
    </li>
  );
}

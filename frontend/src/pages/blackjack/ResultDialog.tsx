import type { BlackjackSettledHand } from "@casino/shared";
import { useEffect, useId, useRef } from "react";
import { credits, gainOf, isWin, OUTCOME_TITLES, totalLabel } from "./format";

/** The small line above the title: what the hand left the player with. */
function amountLine(hand: BlackjackSettledHand): string {
  if (isWin(hand.outcome))
    return `Ganaste ${credits(gainOf(hand.payout, hand.totalStake))} créditos`;
  if (hand.outcome === "push") return `Recuperas ${credits(hand.totalStake)} créditos`;
  return `Perdiste ${credits(hand.totalStake)} créditos`;
}

/**
 * The result of a settled hand, popped up over the felt once its cards have landed: what it left
 * the player with in small light type, the outcome large, and how the totals compared. "Jugar otra
 * vez" goes back to the bet form; "Ver la mesa" closes it to look at the cards.
 */
export function ResultDialog({
  hand,
  onPlayAgain,
  onClose,
}: {
  hand: BlackjackSettledHand;
  onPlayAgain: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const playAgain = useRef<HTMLButtonElement>(null);
  const won = isWin(hand.outcome);

  useEffect(() => {
    playAgain.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const detail =
    hand.outcome === "bust"
      ? "Sumaste más de 21."
      : `${totalLabel(hand.playerTotal)} contra ${totalLabel(hand.dealerTotal)} de la banca`;

  return (
    <div className="bj-result-backdrop">
      <section
        role="dialog"
        aria-labelledby={titleId}
        className={
          won ? "bj-result is-won" : hand.outcome === "push" ? "bj-result" : "bj-result is-lost"
        }
      >
        <p className="bj-result-amount amount">{amountLine(hand)}</p>
        <h2 id={titleId} className="bj-result-title">
          {OUTCOME_TITLES[hand.outcome]}
        </h2>
        {won && <p className="bj-result-prize amount">Cobras {credits(hand.payout)} créditos</p>}
        <p className="bj-result-detail">
          {detail}
          {hand.doubled ? " · Apuesta doblada" : ""}
        </p>
        <div className="bj-result-actions">
          <button
            ref={playAgain}
            type="button"
            className="button button-large cr-primary"
            onClick={onPlayAgain}
          >
            Jugar otra vez
          </button>
          <button type="button" className="button bj-result-close" onClick={onClose}>
            Ver la mesa
          </button>
        </div>
      </section>
    </div>
  );
}

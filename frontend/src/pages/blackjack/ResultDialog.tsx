import type { BlackjackSettledHand } from "@casino/shared";
import { useEffect, useId, useRef } from "react";
import { credits, OUTCOME_TITLES, roundSummary } from "./format";

/** The small line above the title: what the round left the player with. */
function amountLine(hand: BlackjackSettledHand, net: bigint): string {
  if (net > 0n) return `Ganaste ${credits(net)} créditos`;
  if (net === 0n) return `Recuperas ${credits(hand.totalStake)} créditos`;
  return `Perdiste ${credits(-net)} créditos`;
}

/** How one hand's totals compared, or that it busted. */
function versus(hand: BlackjackSettledHand["playerHands"][number], dealer: string): string {
  return hand.outcome === "bust"
    ? "Sumaste más de 21."
    : `${hand.total.total} contra ${dealer} de la banca`;
}

/**
 * The result of a settled round, popped up over the felt once its cards have landed: what it left
 * the player with in small light type, the result large, and how the totals compared; after a
 * split, one line per hand. "Jugar otra vez" goes back to the bet form; "Ver la mesa" closes it to
 * look at the cards.
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
  const { title, net, tone } = roundSummary(hand);
  // A settled hand reads its final total only: "16", not "6 / 16".
  const dealer = String(hand.dealerTotal.total);
  const [only] = hand.playerHands;
  const split = hand.playerHands.length > 1;

  useEffect(() => {
    playAgain.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toneClass = tone === "won" ? " is-won" : tone === "lost" ? " is-lost" : "";
  return (
    <div className="bj-result-backdrop">
      <section role="dialog" aria-labelledby={titleId} className={`bj-result${toneClass}`}>
        <p className="bj-result-amount amount">{amountLine(hand, net)}</p>
        <h2 id={titleId} className="bj-result-title">
          {title}
        </h2>
        {net > 0n && (
          <p className="bj-result-prize amount">Cobras {credits(hand.payout)} créditos</p>
        )}
        {split ? (
          <ul className="bj-result-hands">
            {hand.playerHands.map((h, i) => (
              // The hands keep their order, so the position is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: the player's hands keep their order
              <li key={i}>
                <strong>
                  Mano {i + 1}: {OUTCOME_TITLES[h.outcome]}
                </strong>{" "}
                · {versus(h, dealer)}
                {h.doubled ? " · Doblada" : ""}
              </li>
            ))}
          </ul>
        ) : (
          only && (
            <p className="bj-result-detail">
              {versus(only, dealer)}
              {only.doubled ? " · Apuesta doblada" : ""}
            </p>
          )
        )}
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

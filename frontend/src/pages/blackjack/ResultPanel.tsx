import type { BlackjackSettledHand } from "@casino/shared";
import { credits, gainOf, isWin, OUTCOME_TITLES, totalLabel } from "./format";

/** The hand the server settled: outcome, what it paid, and "Jugar otra vez". */
export function ResultPanel({
  hand,
  onPlayAgain,
  disabled,
}: {
  hand: BlackjackSettledHand;
  onPlayAgain: () => void;
  disabled: boolean;
}) {
  const won = isWin(hand.outcome);
  const versus = `${totalLabel(hand.playerTotal)} contra ${totalLabel(hand.dealerTotal)} de la banca`;
  return (
    <div className="cr-panel-body">
      <p className={won ? "cr-result-sticker is-won" : "cr-result-sticker is-lost"}>
        {OUTCOME_TITLES[hand.outcome]}
      </p>
      {won && <p className="cr-big-prize amount">{credits(hand.payout)} créditos</p>}
      {won && (
        <p>
          Ganancia: +{credits(gainOf(hand.payout, hand.totalStake))} créditos
          {hand.doubled ? " con la apuesta doblada" : ""}.
        </p>
      )}
      {hand.outcome === "push" && (
        <p>Recuperas tu apuesta de {credits(hand.totalStake)} créditos.</p>
      )}
      {!won && hand.outcome !== "push" && (
        <p>Perdiste tu apuesta de {credits(hand.totalStake)} créditos.</p>
      )}
      <p className="cr-muted">{hand.outcome === "bust" ? "Sumaste más de 21." : versus}</p>
      <button
        type="button"
        className="button button-large cr-primary"
        disabled={disabled}
        onClick={onPlayAgain}
      >
        Jugar otra vez
      </button>
    </div>
  );
}

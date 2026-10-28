import type { BlackjackSettledHand } from "@casino/shared";
import { credits, roundSummary } from "./format";

/**
 * The panel after a round: the result itself pops up over the felt; here "Repetir apuesta" deals
 * again with the same stake, and "Cambiar apuesta" goes back to the chips.
 */
export function ResultPanel({
  hand,
  canRepeat,
  onRepeat,
  onChangeBet,
  disabled,
}: {
  hand: BlackjackSettledHand;
  /** Whether the balance covers the same stake again. */
  canRepeat: boolean;
  onRepeat: () => void;
  onChangeBet: () => void;
  disabled: boolean;
}) {
  return (
    <div className="cr-panel-body">
      <p className="cr-progress">Mano terminada · {roundSummary(hand).title}</p>
      <div className="bj-result-panel-actions">
        <button
          type="button"
          className="button button-large cr-primary"
          disabled={disabled || !canRepeat}
          onClick={onRepeat}
        >
          Repetir apuesta · {credits(hand.stake)} créditos
        </button>
        <button
          type="button"
          className="button button-large cr-cashout"
          disabled={disabled}
          onClick={onChangeBet}
        >
          Cambiar apuesta
        </button>
      </div>
      {!canRepeat && <p className="bj-hint">No tienes saldo para repetir la apuesta.</p>}
    </div>
  );
}

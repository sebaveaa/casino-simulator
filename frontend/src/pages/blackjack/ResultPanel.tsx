import type { BlackjackSettledHand } from "@casino/shared";
import { OUTCOME_TITLES } from "./format";

/** The panel after a hand: the result itself pops up over the felt; here only "Jugar otra vez". */
export function ResultPanel({
  hand,
  onPlayAgain,
  disabled,
}: {
  hand: BlackjackSettledHand;
  onPlayAgain: () => void;
  disabled: boolean;
}) {
  return (
    <div className="cr-panel-body">
      <p className="cr-progress">Mano terminada · {OUTCOME_TITLES[hand.outcome]}</p>
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

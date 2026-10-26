import type { BlackjackSettledHand } from "@casino/shared";
import { roundSummary } from "./format";

/** The panel after a round: the result itself pops up over the felt; here only "Jugar otra vez". */
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
      <p className="cr-progress">Mano terminada · {roundSummary(hand).title}</p>
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

import type { BlackjackAction, BlackjackInProgressHand } from "@casino/shared";
import { credits, totalLabel } from "./format";

/** Why Doblar and Separar are off, or that a pair can be split; null when there is nothing to say. */
function wagerHint(hand: BlackjackInProgressHand, canAffordStake: boolean): string | null {
  if (!hand.canDouble) return "Solo puedes doblar o separar con tus dos primeras cartas.";
  if (!canAffordStake) return "No tienes saldo para doblar ni separar.";
  if (hand.canSplit) return "Tienes un par: puedes separarlo en dos manos.";
  return null;
}

/**
 * "Tu turno": the active hand's total and the actions. Pedir and Plantarse lead; Doblar and
 * Separar sit quieter in a tray below, with a small hint. They need what the server allows on the
 * active hand (`canDouble`, `canSplit`) and a balance that covers the stake again.
 */
export function PlayingPanel({
  hand,
  canAffordStake,
  onAction,
  disabled,
}: {
  hand: BlackjackInProgressHand;
  /** Whether the balance covers one more stake, for a double or a split. */
  canAffordStake: boolean;
  onAction: (action: BlackjackAction) => void;
  disabled: boolean;
}) {
  const split = hand.playerHands.length > 1;
  const active = hand.playerHands[hand.activeHand];
  const stake = credits(hand.stake);
  const hint = wagerHint(hand, canAffordStake);
  return (
    <div className="cr-panel-body">
      <p className="cr-progress">
        {split
          ? `Tu turno · Mano ${hand.activeHand + 1} de ${hand.playerHands.length}`
          : "Tu turno"}
      </p>
      <p className="cr-big-mult amount">{active ? totalLabel(active.total) : "…"}</p>
      <div className="cr-prize">
        <span>{split ? "Apuesta por mano" : "Apuesta"}</span>
        <strong className="amount">{stake} créditos</strong>
      </div>
      <div className="bj-actions">
        <button
          type="button"
          className="button button-large cr-primary"
          disabled={disabled}
          onClick={() => onAction("hit")}
        >
          Pedir
        </button>
        <button
          type="button"
          className="button button-large cr-cashout"
          disabled={disabled}
          onClick={() => onAction("stand")}
        >
          Plantarse
        </button>
      </div>
      <div className="bj-wagers">
        <div className="bj-wager-row">
          <button
            type="button"
            className="bj-wager"
            disabled={disabled || !hand.canDouble || !canAffordStake}
            onClick={() => onAction("double")}
          >
            Doblar
            <span className="bj-wager-cost amount">
              +{stake}
              <span className="roulette-sr-only"> créditos</span>
            </span>
          </button>
          <button
            type="button"
            className="bj-wager"
            disabled={disabled || !hand.canSplit || !canAffordStake}
            onClick={() => onAction("split")}
          >
            Separar
            <span className="bj-wager-cost amount">
              +{stake}
              <span className="roulette-sr-only"> créditos</span>
            </span>
          </button>
        </div>
        {hint && <p className="bj-hint">{hint}</p>}
      </div>
    </div>
  );
}

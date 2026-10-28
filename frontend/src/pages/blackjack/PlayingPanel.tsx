import type { BlackjackAction, BlackjackInProgressHand } from "@casino/shared";
import { credits, totalLabel } from "./format";

/**
 * "Tu turno": the player's total and the three actions. Doblar needs the first two cards
 * (`canDouble`, from the server) and a balance that covers the stake again.
 */
export function PlayingPanel({
  hand,
  canAffordDouble,
  onAction,
  disabled,
}: {
  hand: BlackjackInProgressHand;
  canAffordDouble: boolean;
  onAction: (action: BlackjackAction) => void;
  disabled: boolean;
}) {
  const doubleReady = hand.canDouble && canAffordDouble;
  return (
    <div className="cr-panel-body">
      <p className="cr-progress">Tu turno</p>
      <p className="cr-big-mult amount">{totalLabel(hand.playerTotal)}</p>
      <div className="cr-prize">
        <span>Apuesta</span>
        <strong className="amount">{credits(hand.stake)} créditos</strong>
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
      <button
        type="button"
        className="button button-large bj-double"
        disabled={disabled || !doubleReady}
        onClick={() => onAction("double")}
      >
        Doblar · +{credits(hand.stake)} créditos
      </button>
      {!hand.canDouble ? (
        <p className="cr-dashed">Solo puedes doblar con tus dos primeras cartas.</p>
      ) : (
        !canAffordDouble && <p className="cr-dashed">No tienes saldo para doblar.</p>
      )}
    </div>
  );
}

import type { BlackjackAction, BlackjackInProgressHand } from "@casino/shared";
import { credits, totalLabel } from "./format";

/**
 * "Tu turno": the active hand's total and the actions. Doblar and Separar need what the server
 * allows on the active hand (`canDouble`, `canSplit`) and a balance that covers the stake again.
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
        <button
          type="button"
          className="button button-large bj-double"
          disabled={disabled || !hand.canDouble || !canAffordStake}
          onClick={() => onAction("double")}
        >
          Doblar · +{stake}
        </button>
        <button
          type="button"
          className="button button-large bj-double"
          disabled={disabled || !hand.canSplit || !canAffordStake}
          onClick={() => onAction("split")}
        >
          Separar · +{stake}
        </button>
      </div>
      {hand.canSplit && canAffordStake && (
        <p className="cr-note">Tienes un par: puedes separarlo en dos manos.</p>
      )}
      {!hand.canDouble ? (
        <p className="cr-dashed">Solo puedes doblar o separar con tus dos primeras cartas.</p>
      ) : (
        !canAffordStake && <p className="cr-dashed">No tienes saldo para doblar ni separar.</p>
      )}
    </div>
  );
}

import { type ChickenRoadInProgressGame, chickenRoadMultiplier, LANE_COUNT } from "@casino/shared";
import { credits, formatMultiplier } from "./format";

/**
 * "En juego". Before the first lane nothing can be cashed out: the multiplier reads 1,00x and the
 * possible prize is the stake. From lane 1 on, the prize is the server's `cashoutAmount`.
 */
export function PlayingPanel({
  game,
  onStep,
  onCashOut,
  disabled,
}: {
  game: ChickenRoadInProgressGame;
  onStep: () => void;
  onCashOut: () => void;
  disabled: boolean;
}) {
  const lanes = game.lanesCrossed;
  const multiplier =
    lanes === 0 ? formatMultiplier(100) : formatMultiplier(chickenRoadMultiplier(lanes));
  const prize = credits(lanes === 0 ? game.stake : game.cashoutAmount);
  const next = formatMultiplier(chickenRoadMultiplier(lanes + 1));

  return (
    <div className="cr-panel-body">
      <p className="cr-progress">
        {lanes === 0 ? "Listo para cruzar" : `Carril ${lanes} de ${LANE_COUNT}`}
      </p>
      <p className="cr-big-mult amount">{multiplier}</p>
      <div className="cr-prize">
        <span>Premio posible</span>
        <strong className="amount">{prize} créditos</strong>
      </div>
      <p className="cr-next">Siguiente carril: {next} · 80 % de cruzar</p>
      <button
        type="button"
        className="button button-large cr-primary"
        disabled={disabled}
        onClick={onStep}
      >
        Siguiente paso
      </button>
      {lanes >= 1 ? (
        <button
          type="button"
          className="button button-large cr-cashout"
          disabled={disabled}
          onClick={onCashOut}
        >
          Retirar {credits(game.cashoutAmount)} créditos
        </button>
      ) : (
        <p className="cr-dashed">Da tu primer paso para poder retirar.</p>
      )}
    </div>
  );
}

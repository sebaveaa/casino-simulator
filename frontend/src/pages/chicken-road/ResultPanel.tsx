import { type ChickenRoadFinishedGame, chickenRoadMultiplier } from "@casino/shared";
import { credits, formatMultiplier, gainOf, wouldHaveWon } from "./format";

/** "Atropellado", "Cobrado" or "Meta": the game the server settled, and "Jugar otra vez". */
export function ResultPanel({
  game,
  onPlayAgain,
  disabled,
}: {
  game: ChickenRoadFinishedGame;
  onPlayAgain: () => void;
  disabled: boolean;
}) {
  return (
    <div className="cr-panel-body">
      {game.status === "lost" ? (
        <>
          <p className="cr-result-sticker is-lost">¡Te atropellaron!</p>
          <p>
            Perdiste tu apuesta de {credits(game.stake)} créditos en el carril {game.hitLane}.
          </p>
          {/* A hit on lane 1 had nothing to cash out yet. */}
          {game.lanesCrossed >= 1 && (
            <p className="cr-muted">
              Habrías cobrado {credits(wouldHaveWon(game.stake, game.lanesCrossed))} créditos si te
              retirabas antes.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="cr-result-sticker is-won">
            {game.status === "completed" ? "¡Cruzaste la calle!" : "¡Cobraste!"}
          </p>
          <p className="cr-big-prize amount">{credits(game.payout)} créditos</p>
          {game.status === "completed" ? (
            <p>
              Llegaste a la meta con {formatMultiplier(chickenRoadMultiplier(game.lanesCrossed))} y
              cobraste automáticamente.
            </p>
          ) : (
            <p>
              Ganancia: +{credits(gainOf(game.payout, game.stake))} créditos con{" "}
              {formatMultiplier(chickenRoadMultiplier(game.lanesCrossed))}.
            </p>
          )}
        </>
      )}
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

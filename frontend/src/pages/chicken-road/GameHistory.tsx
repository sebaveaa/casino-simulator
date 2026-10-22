import { type ChickenRoadFinishedGame, chickenRoadMultiplier } from "@casino/shared";
import { useId } from "react";
import { formatMultiplier } from "./format";

/** "Tus últimas partidas": a win shows its multiplier on sun, a loss "Atropellado" on tomato. */
export function GameHistory({ games }: { games: ChickenRoadFinishedGame[] }) {
  const titleId = useId();
  if (games.length === 0) return null;
  return (
    <div className="cr-history">
      <h2 id={titleId} className="cr-history-title">
        Tus últimas partidas
      </h2>
      <ul className="cr-history-list" aria-labelledby={titleId}>
        {games.map((game) =>
          game.status === "lost" ? (
            <li key={game.gameId} className="cr-history-pill is-lost">
              Atropellado
            </li>
          ) : (
            <li key={game.gameId} className="cr-history-pill is-win amount">
              {formatMultiplier(chickenRoadMultiplier(game.lanesCrossed))}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

import { CHICKEN_ROAD_MULTIPLIERS, LANE_COUNT } from "@casino/shared";
import { CheckArt, ChickenArt } from "./art";
import { formatMultiplier } from "./format";
import type { ChickenRoadView } from "./useChickenRoad";

/** Where the chicken stands: 0 is the start, 1–6 a lane, 7 the finish. */
export function chickenPosition(view: ChickenRoadView): number {
  if (view.kind === "bet") return 0;
  const { game } = view;
  if (game.status === "lost") return game.hitLane;
  if (game.status === "completed") return LANE_COUNT + 1;
  return game.lanesCrossed;
}

type LaneState = "crossed" | "next" | "ahead";

function laneState(view: ChickenRoadView, lane: number): LaneState {
  if (view.kind === "bet") return lane === 1 ? "next" : "ahead";
  const crossed = view.game.lanesCrossed;
  if (lane <= crossed) return "crossed";
  return view.kind === "playing" && lane === crossed + 1 ? "next" : "ahead";
}

/**
 * The road: start, six lanes with their multipliers, and the finish. It only draws the state the
 * server returned; it never decides anything.
 */
export function Road({ view }: { view: ChickenRoadView }) {
  const position = chickenPosition(view);
  const chicken = <ChickenArt className="cr-chicken" />;
  return (
    <div className="cr-road-card">
      <div className="cr-road-scroll">
        <div className="cr-road">
          <div className="cr-start">
            <span className="cr-road-label">Salida</span>
            {position === 0 && chicken}
          </div>
          {CHICKEN_ROAD_MULTIPLIERS.map((multiplier, index) => {
            const lane = index + 1;
            const state = laneState(view, lane);
            return (
              <div key={lane} className={`cr-lane is-${state}`} data-lane={lane} data-state={state}>
                <span className={`cr-mult is-${state}`}>{formatMultiplier(multiplier)}</span>
                {position === lane && chicken}
                {state === "crossed" && (
                  <span className="cr-check" role="img" aria-label="Carril cruzado">
                    <CheckArt />
                  </span>
                )}
              </div>
            );
          })}
          <div className="cr-finish">
            <span className="cr-road-label cr-finish-label">Meta</span>
            {position === LANE_COUNT + 1 && chicken}
          </div>
        </div>
      </div>
    </div>
  );
}

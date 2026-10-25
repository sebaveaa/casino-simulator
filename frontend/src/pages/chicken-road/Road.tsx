import { CHICKEN_ROAD_MULTIPLIERS, LANE_COUNT } from "@casino/shared";
import type { CSSProperties } from "react";
import { CarArt, CheckArt, ChickenArt } from "./art";
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

// Cars sit at different heights and cycle tomato, chalk and sun (the token values, as in the SVG).
const CAR_TOPS = [36, 214, 82, 246, 54, 190];
const CAR_COLORS = ["#ff5a36", "#fff", "#ffc933"];

/**
 * Horizontal center of a position, over the grid `96px repeat(6, 1fr) 84px`. Inside
 * `translateX`, percentages are of the full-width mover, so they match the grid's width.
 */
function chickenX(position: number): string {
  if (position === 0) return "48px";
  if (position === LANE_COUNT + 1) return "calc(100% - 42px)";
  return `calc(96px + ${position - 0.5} * (100% - 180px) / ${LANE_COUNT})`;
}

/**
 * The road: start, six lanes with their multipliers and cars, and the finish. It only draws the
 * state the server returned. The chicken jumps with a transform; on a hit the car drops onto it.
 */
export function Road({ view }: { view: ChickenRoadView }) {
  const position = chickenPosition(view);
  const hitLane = view.kind === "over" && view.game.status === "lost" ? view.game.hitLane : null;
  const moverStyle: CSSProperties = { transform: `translateX(${chickenX(position)})` };

  return (
    <div className="cr-road-card">
      <div className="cr-road-scroll">
        <div className="cr-road">
          <div className="cr-start">
            <span className="cr-road-label">Salida</span>
          </div>
          {CHICKEN_ROAD_MULTIPLIERS.map((multiplier, index) => {
            const lane = index + 1;
            const state = laneState(view, lane);
            return (
              <div key={lane} className={`cr-lane is-${state}`} data-lane={lane} data-state={state}>
                <span className={`cr-mult is-${state}`}>{formatMultiplier(multiplier)}</span>
                {lane === hitLane ? (
                  // The car that hit the chicken drops onto it, with the ¡PAF! sticker.
                  <span className="cr-hit" data-testid="cr-hit">
                    <span className="cr-car-slot cr-hit-car">
                      <CarArt className="cr-car-art" color={CAR_COLORS[index % 3] ?? "#fff"} />
                    </span>
                    <span className="cr-paf" aria-hidden="true">
                      ¡PAF!
                    </span>
                  </span>
                ) : (
                  // Lanes not crossed yet have traffic.
                  state !== "crossed" && (
                    <span className="cr-car-slot" style={{ top: CAR_TOPS[index] }}>
                      <CarArt className="cr-car-art" color={CAR_COLORS[index % 3] ?? "#fff"} />
                    </span>
                  )
                )}
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
          </div>

          <div className="cr-chicken-track" aria-hidden="true">
            <div className="cr-chicken-mover" style={moverStyle} data-pos={position}>
              {/* A new key per position replays the hop each time the chicken moves. */}
              <div key={position} className={hitLane === null ? "cr-chicken" : "cr-chicken is-hit"}>
                <ChickenArt className="cr-chicken-art" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

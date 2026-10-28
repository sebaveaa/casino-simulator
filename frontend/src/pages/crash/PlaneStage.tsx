import type { CrashStageProps } from "./stageTypes";

/**
 * Despegue scene: an original side-view passenger jet (long fuselage, nose, swept wing, tail fin with
 * stabiliser, row of windows) climbs the curve while the multiplier rises and leaves the frame on the
 * impact; a cap is a clean flight into a cloud. Decorative, so the whole SVG is `aria-hidden`; the
 * status text and the multiplier carry the meaning for assistive tech.
 */
export function PlaneStage({ phase }: CrashStageProps) {
  return (
    <div className="crash-scene crash-scene-plane" data-phase={phase}>
      <svg viewBox="0 0 200 120" className="crash-scene-svg" aria-hidden="true">
        <title>Despegue</title>
        {/* The climb curve */}
        <path className="crash-curve" d="M8 110 Q 90 108 180 20" fill="none" strokeWidth="4" />

        {/* A cloud the plane climbs into on a cap */}
        {phase === "cap" && (
          <g className="crash-cloud">
            <circle cx="176" cy="22" r="15" />
            <circle cx="160" cy="28" r="10" />
            <circle cx="190" cy="30" r="9" />
          </g>
        )}

        {/* Passenger jet, drawn nose-right in its own box; the group positions and tilts it. */}
        <g className="crash-plane">
          {/* Tail fin and stabiliser */}
          <path className="crash-plane-tail" d="M5 13 L0 2 L15 11 Z" />
          <path className="crash-plane-tail" d="M3 16 L-3 22 L10 17 Z" />
          {/* Fuselage, nose to the right */}
          <path d="M4 14 Q4 9 13 9 L39 9 Q49 10 51 14 Q49 18 39 19 L13 19 Q4 19 4 14 Z" />
          {/* Swept wing */}
          <path className="crash-plane-wing" d="M24 18 L12 29 L32 19 Z" />
          {/* Windows */}
          <circle className="crash-plane-window" cx="18" cy="13" r="1.4" />
          <circle className="crash-plane-window" cx="24" cy="13" r="1.4" />
          <circle className="crash-plane-window" cx="30" cy="13" r="1.4" />
          <circle className="crash-plane-window" cx="36" cy="13" r="1.4" />
          {/* Cockpit */}
          <path className="crash-plane-window" d="M44 11 Q48 11 49 14 L44 14 Z" />
        </g>
      </svg>
    </div>
  );
}

import type { CrashStageProps } from "./stageTypes";

/**
 * Despegue scene: a plane climbs a curve while the multiplier rises, then leaves the frame on the
 * impact; a cap is a clean flight into the sky. Decorative, so the whole SVG is `aria-hidden`; the
 * status text and the multiplier carry the meaning for assistive tech.
 */
export function PlaneStage({ phase }: CrashStageProps) {
  return (
    <div className="crash-scene crash-scene-plane" data-phase={phase}>
      <svg viewBox="0 0 200 120" className="crash-scene-svg" aria-hidden="true">
        <title>Despegue</title>
        {/* The climb curve */}
        <path className="crash-curve" d="M8 110 Q 90 108 180 20" fill="none" strokeWidth="4" />
        {/* The plane: a simple triangle with wings */}
        <g className="crash-plane">
          <polygon points="0,0 22,8 0,16" />
          <polygon points="6,6 14,-6 16,8" className="crash-plane-wing" />
        </g>
        {/* A cloud the plane disappears into on a cap */}
        {phase === "cap" && <circle className="crash-cloud" cx="176" cy="22" r="16" />}
      </svg>
    </div>
  );
}

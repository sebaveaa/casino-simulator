import type { CrashStageProps } from "./stageTypes";

/**
 * Dino Crash scene: the dino waits, runs while the multiplier climbs, and a meteor falls on the
 * impact; a cap is a safe finish. Decorative, so the whole SVG is `aria-hidden`; the status text
 * and the multiplier carry the meaning for assistive tech.
 */
export function DinoStage({ phase }: CrashStageProps) {
  return (
    <div className="crash-scene crash-scene-dino" data-phase={phase}>
      <svg viewBox="0 0 200 120" className="crash-scene-svg" aria-hidden="true">
        <title>Dino Crash</title>
        {/* Ground */}
        <rect className="crash-ground" x="0" y="100" width="200" height="20" />
        {/* Meteor, shown on impact */}
        {phase === "impact" && (
          <g className="crash-meteor">
            <line x1="150" y1="0" x2="110" y2="70" strokeWidth="4" strokeLinecap="round" />
            <circle cx="108" cy="74" r="9" />
          </g>
        )}
        {/* Dino: a simple runner silhouette */}
        <g className="crash-dino">
          <rect x="70" y="60" width="26" height="30" rx="6" />
          <rect x="90" y="50" width="16" height="18" rx="4" />
          <rect x="102" y="54" width="8" height="5" rx="2" className="crash-dino-eye" />
          <rect x="74" y="88" width="6" height="12" rx="2" />
          <rect x="88" y="88" width="6" height="12" rx="2" />
          <rect x="58" y="66" width="16" height="7" rx="3" />
        </g>
      </svg>
    </div>
  );
}

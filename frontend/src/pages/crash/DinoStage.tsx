import type { CrashStageProps } from "./stageTypes";

/**
 * Dino Crash scene: an original bipedal-dinosaur silhouette (big head with an open jaw, long raised
 * tail, strong hind legs, short arm) that runs while the multiplier climbs; a meteor falls on the
 * impact, and a cap is a safe finish. Decorative, so the whole SVG is `aria-hidden`; the status text
 * and the multiplier carry the meaning for assistive tech.
 */
export function DinoStage({ phase }: CrashStageProps) {
  return (
    <div className="crash-scene crash-scene-dino" data-phase={phase}>
      <svg viewBox="0 0 200 120" className="crash-scene-svg" aria-hidden="true">
        <title>Dino Crash</title>
        {/* Ground */}
        <rect className="crash-ground" x="0" y="100" width="200" height="20" />

        {/* Meteor, on impact */}
        {phase === "impact" && (
          <g className="crash-meteor">
            <line x1="168" y1="2" x2="128" y2="54" strokeWidth="5" strokeLinecap="round" />
            <circle cx="126" cy="58" r="10" />
          </g>
        )}

        <g className="crash-dino">
          {/* Long raised tail */}
          <path d="M14 54 L66 76 L60 86 L20 70 Z" />
          {/* Body */}
          <ellipse cx="88" cy="74" rx="34" ry="20" />
          {/* Neck, head and open jaw facing right */}
          <path d="M110 64 Q114 42 140 44 L162 48 L150 56 L162 61 L140 63 Q124 63 118 82 Z" />
          {/* Short arm */}
          <rect x="110" y="72" width="13" height="5" rx="2.5" />
          {/* Hind legs (animated while running) */}
          <g className="crash-dino-leg crash-dino-leg-a">
            <path d="M78 90 L88 90 L90 100 L80 100 Z" />
          </g>
          <g className="crash-dino-leg crash-dino-leg-b">
            <path d="M96 90 L106 90 L108 100 L98 100 Z" />
          </g>
        </g>
        {/* Eye, drawn last so it sits on top of the head */}
        <circle className="crash-dino-eye" cx="149" cy="52" r="3" />
      </svg>
    </div>
  );
}

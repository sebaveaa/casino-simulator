import type { ReactNode } from "react";

/** Ids of the mini games, as the hub lists them. */
export type MiniGameId = "chicken-road" | "dino-crash" | "aviator";

/** The chicken of Cruza la Calle, 64×64. */
export function Chicken() {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="#141414"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M33 14c-1-4 2-7 5-6 1-3 6-3 6 1 3 0 4 4 1 6" fill="#ff5a36" />
      <path
        d="M20 30c0-9 8-16 17-16 8 0 14 7 14 15v5c0 10-8 17-18 17-10 0-18-7-18-15 0-3 2-6 5-6z"
        fill="#ffffff"
      />
      <path d="M51 25l9 3-9 4z" fill="#ffc933" strokeWidth="2.5" />
      <circle cx="43" cy="23" r="2.4" fill="#141414" stroke="none" />
      <path d="M24 35c4 5 11 5 14 0" />
      <path d="M29 51v8M38 51v8M26 59h6M35 59h6" />
    </svg>
  );
}

/** A car seen from above, 32×52; `color` paints the body. */
export function Car({ color = "#ff5a36" }: { color?: string }) {
  return (
    <svg viewBox="0 0 32 52" aria-hidden="true">
      <rect x="1" y="10" width="5" height="10" rx="2" fill="#141414" />
      <rect x="26" y="10" width="5" height="10" rx="2" fill="#141414" />
      <rect x="1" y="34" width="5" height="10" rx="2" fill="#141414" />
      <rect x="26" y="34" width="5" height="10" rx="2" fill="#141414" />
      <rect
        x="4"
        y="3"
        width="24"
        height="46"
        rx="8"
        fill={color}
        stroke="#141414"
        strokeWidth="3"
      />
      <rect
        x="8"
        y="12"
        width="16"
        height="9"
        rx="2"
        fill="#fff"
        stroke="#141414"
        strokeWidth="2"
      />
      <rect
        x="8"
        y="33"
        width="16"
        height="7"
        rx="2"
        fill="#fff"
        stroke="#141414"
        strokeWidth="2"
      />
    </svg>
  );
}

/** Cruza la Calle: curb, three lanes and the checkered goal; the chicken floats, a car drives by. */
function RoadPanel() {
  return (
    <div className="mini-road" aria-hidden="true">
      <span className="mini-road-curb" />
      <span className="mini-road-lane" />
      <span className="mini-road-lane" />
      <span className="mini-road-lane" />
      <span className="mini-road-goal" />
      <span className="mini-road-chicken">
        <Chicken />
      </span>
      <span className="mini-road-car">
        <Car />
      </span>
    </div>
  );
}

/** Dino Crash: the chalk dino on the sun ground, an ink meteor falling toward it. */
function DinoPanel() {
  return (
    <div className="mini-scene" aria-hidden="true">
      <span className="mini-ground" />
      {/* Bottom-aligned, so the feet stay on the ground band at any panel width. */}
      <svg
        className="mini-scene-art"
        aria-hidden="true"
        viewBox="0 0 320 200"
        preserveAspectRatio="xMidYMax meet"
        fill="none"
        stroke="#141414"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g stroke="#ffc933" strokeWidth="5">
          <path d="M262 18l-26 26M278 30l-24 24M250 10l-20 20" />
        </g>
        <circle cx="222" cy="62" r="18" fill="#141414" />
        <path d="M212 56l6 4M224 70l6-2" stroke="#ff5a36" strokeWidth="2.5" />
        <g transform="translate(96 54)">
          <path d="M20 70L2 60l6 16 18 2" fill="#fff" />
          <path
            d="M50 38v16H40c-14 0-24 9-24 22v2c0 9 7 14 16 14h18c12 0 18-9 18-20V38z"
            fill="#fff"
          />
          <path d="M34 92v12M54 92v12" />
          <path d="M66 70h8" />
          <rect x="46" y="14" width="38" height="26" rx="7" fill="#fff" />
          <circle cx="72" cy="24" r="3" fill="#141414" stroke="none" />
          <path d="M64 33h14" />
        </g>
      </svg>
    </div>
  );
}

/** Despegue: the tomato flight curve on ink, the sun plane at its tip and a live multiplier. */
function PlanePanel() {
  return (
    <div className="mini-scene" aria-hidden="true">
      <svg
        className="mini-scene-art"
        aria-hidden="true"
        viewBox="0 0 320 200"
        fill="none"
        stroke="#141414"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M40 176C130 172 196 136 236 74" stroke="#ff5a36" strokeWidth="6" />
        <g transform="translate(248 60) rotate(-34)">
          <path d="M-20-6l-8-12h9l10 12z" fill="#ffc933" />
          <path d="M-24-6h30c9 0 14 3 14 6s-5 6-14 6h-30z" fill="#ffc933" />
          <path d="M-4 2l-12 18h9l16-18z" fill="#ffc933" />
          <circle cx="10" cy="-1" r="2.2" fill="#141414" stroke="none" />
        </g>
        <text
          x="48"
          y="64"
          fill="#fff"
          stroke="none"
          fontFamily="Space Mono, monospace"
          fontWeight="700"
          fontSize="34"
        >
          3,42x
        </text>
      </svg>
    </div>
  );
}

const panels: Record<MiniGameId, ReactNode> = {
  "chicken-road": <RoadPanel />,
  "dino-crash": <DinoPanel />,
  aviator: <PlanePanel />,
};

/** Illustration of a mini game card's panel; decorative. */
export function MiniGameArt({ id }: { id: MiniGameId }) {
  return panels[id];
}

import type { GameId } from "@casino/shared";
import type { ReactNode } from "react";

/** Distance between two symbols on a slot reel strip, in viewBox units. */
const REEL_STEP = 36;

/** Slot reels: each strip starts and ends on its 7, so a roll of three steps loops seamlessly. */
const reels = [
  { x: 14.6, seven: "#141414", symbols: ["7", "3", "9", "7"] },
  { x: 32, seven: "#ff5a36", symbols: ["7", "1", "4", "7"] },
  { x: 49.3, seven: "#141414", symbols: ["7", "5", "2", "7"] },
];

/** Wind around the races flag: above its top edge, beside its flying edge, and a curl below. */
const windStreaks = ["M22 4.5h18", "M50.5 21h8", "M24 38h16a4 4 0 1 1 -4 4"];

/**
 * Artwork of each game for the lobby; decorative, hidden from assistive tech.
 * Classed parts (`art-*`) carry each game's motion in the stylesheet.
 */
const art: Record<GameId, ReactNode> = {
  roulette: (
    <svg
      width="96"
      height="96"
      viewBox="0 0 64 64"
      fill="none"
      stroke="#141414"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="26" fill="#fff" />
      <g className="art-wheel">
        <g className="art-wheel-boost">
          <path d="M32 6v16M32 42v16M6 32h16M42 32h16M13.6 13.6l11.3 11.3M39.1 39.1l11.3 11.3M50.4 13.6L39.1 24.9M24.9 39.1L13.6 50.4" />
          <circle cx="32" cy="32" r="10" fill="#ffc933" />
        </g>
      </g>
    </svg>
  ),
  races: (
    <svg
      width="96"
      height="96"
      viewBox="0 0 64 64"
      fill="none"
      stroke="#141414"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className="art-flag">
        <rect x="14" y="10" width="34" height="22" fill="#fff" />
        <rect x="14" y="10" width="8.5" height="11" fill="#141414" stroke="none" />
        <rect x="31" y="10" width="8.5" height="11" fill="#141414" stroke="none" />
        <rect x="22.5" y="21" width="8.5" height="11" fill="#141414" stroke="none" />
        <rect x="39.5" y="21" width="8.5" height="11" fill="#141414" stroke="none" />
        <rect x="14" y="10" width="34" height="22" />
      </g>
      <path d="M14 58V8" />
      <g className="art-wind">
        {windStreaks.map((d) => (
          <g key={d} className="art-wind-streak">
            <path d={d} strokeWidth="4.5" />
            <path className="art-wind-core" d={d} strokeWidth="2" />
          </g>
        ))}
      </g>
    </svg>
  ),
  slots: (
    <svg
      width="96"
      height="96"
      viewBox="0 0 64 64"
      fill="none"
      stroke="#141414"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="art-slots-window">
          <rect x="7.5" y="15.5" width="49" height="33" rx="4.5" />
        </clipPath>
      </defs>
      <rect x="6" y="14" width="52" height="36" rx="6" fill="#f1ecff" />
      <g clipPath="url(#art-slots-window)">
        {reels.map((reel) => (
          <g key={reel.x} className="art-reel">
            {reel.symbols.map((symbol, row) => (
              <text
                // biome-ignore lint/suspicious/noArrayIndexKey: a strip repeats its symbols by design
                key={row}
                x={reel.x}
                y={39 - row * REEL_STEP}
                textAnchor="middle"
                fontFamily="Space Mono, monospace"
                fontWeight="700"
                fontSize="18"
                fill={row === 0 || row === reel.symbols.length - 1 ? reel.seven : "#141414"}
                stroke="none"
              >
                {symbol}
              </text>
            ))}
          </g>
        ))}
      </g>
      <path d="M23.3 14v36M40.6 14v36" />
    </svg>
  ),
  blackjack: (
    <svg
      width="96"
      height="96"
      viewBox="0 0 64 64"
      fill="none"
      stroke="#141414"
      strokeWidth="3"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="12" y="12" width="26" height="36" rx="4" fill="#fff" transform="rotate(-10 25 30)" />
      <g transform="rotate(8 39 33)">
        <g className="art-card">
          <rect x="26" y="15" width="26" height="36" rx="4" fill="#fff" />
          <text
            x="39"
            y="39"
            textAnchor="middle"
            fontFamily="Bricolage Grotesque Variable, sans-serif"
            fontWeight="800"
            fontSize="16"
            fill="#ff5a36"
            stroke="#141414"
            strokeWidth="0.8"
          >
            A
          </text>
          <g className="art-card-back" opacity="0">
            <rect x="26" y="15" width="26" height="36" rx="4" fill="#ff5a36" />
            <rect x="30" y="19" width="18" height="28" rx="2" strokeWidth="2" />
          </g>
        </g>
      </g>
    </svg>
  ),
};

/** Artwork for a game id. */
export function GameArt({ id }: { id: GameId }) {
  return art[id];
}

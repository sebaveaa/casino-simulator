import type { GameId } from "@casino/shared";
import type { ReactNode } from "react";

/**
 * What the lobby draws: the games, minus slots (replaced by the mini games hub, which is a menu,
 * not a game that records bets).
 */
export type GameArtId = Exclude<GameId, "slots" | "chicken-road"> | "mini-games";

/** Wind around the races flag: above its top edge, beside its flying edge, and a curl below. */
const windStreaks = ["M22 4.5h18", "M50.5 21h8", "M24 38h16a4 4 0 1 1 -4 4"];

/**
 * Artwork of each game for the lobby; decorative, hidden from assistive tech.
 * Classed parts (`art-*`) carry each icon's motion in the stylesheet.
 */
const art: Record<GameArtId, ReactNode> = {
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
  "mini-games": (
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
      <path
        className="art-bolt"
        d="M37 3l-9 12h7l-4 9 11-13h-7l5-8z"
        fill="#ff5a36"
        strokeWidth="2.5"
      />
      <path
        d="M17 26h30c7 0 11 6 12 13l1 7c0.6 5-4 8-8 5l-6-5H18l-6 5c-4 3-8.6 0-8-5l1-7c1-7 5-13 12-13z"
        fill="#ffc933"
      />
      <path d="M17 33v10M12 38h10" />
      <circle cx="43" cy="35" r="2.6" fill="#141414" stroke="none" />
      <circle cx="50" cy="41" r="2.6" fill="#ff5a36" strokeWidth="2" />
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
export function GameArt({ id }: { id: GameArtId }) {
  return art[id];
}

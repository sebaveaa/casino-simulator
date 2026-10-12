import type { GameId } from "@casino/shared";
import type { ReactNode } from "react";

/** Artwork of each game for the lobby; decorative, hidden from assistive tech. */
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
      <path d="M32 6v16M32 42v16M6 32h16M42 32h16M13.6 13.6l11.3 11.3M39.1 39.1l11.3 11.3M50.4 13.6L39.1 24.9M24.9 39.1L13.6 50.4" />
      <circle cx="32" cy="32" r="10" fill="#ffc933" />
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
      <rect x="14" y="10" width="34" height="22" fill="#fff" />
      <rect x="14" y="10" width="8.5" height="11" fill="#141414" stroke="none" />
      <rect x="31" y="10" width="8.5" height="11" fill="#141414" stroke="none" />
      <rect x="22.5" y="21" width="8.5" height="11" fill="#141414" stroke="none" />
      <rect x="39.5" y="21" width="8.5" height="11" fill="#141414" stroke="none" />
      <rect x="14" y="10" width="34" height="22" />
      <path d="M14 58V8" />
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
      <rect x="6" y="14" width="52" height="36" rx="6" fill="#f1ecff" />
      <path d="M23.3 14v36M40.6 14v36" />
      <text
        x="14.6"
        y="39"
        textAnchor="middle"
        fontFamily="Space Mono, monospace"
        fontWeight="700"
        fontSize="18"
        fill="#141414"
        stroke="none"
      >
        7
      </text>
      <text
        x="32"
        y="39"
        textAnchor="middle"
        fontFamily="Space Mono, monospace"
        fontWeight="700"
        fontSize="18"
        fill="#ff5a36"
        stroke="none"
      >
        7
      </text>
      <text
        x="49.3"
        y="39"
        textAnchor="middle"
        fontFamily="Space Mono, monospace"
        fontWeight="700"
        fontSize="18"
        fill="#141414"
        stroke="none"
      >
        7
      </text>
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
      <rect x="26" y="15" width="26" height="36" rx="4" fill="#fff" transform="rotate(8 39 33)" />
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
        transform="rotate(8 39 33)"
      >
        A
      </text>
    </svg>
  ),
};

/** Artwork for a game id. */
export function GameArt({ id }: { id: GameId }) {
  return art[id];
}

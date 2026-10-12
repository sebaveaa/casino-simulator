/** Inline decorative icons of the Arcade identity; all are hidden from assistive tech. */

/** The die that doubles as the logo. */
export function DieIcon({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="38"
        height="38"
        rx="9"
        fill="#fff"
        stroke="#141414"
        strokeWidth="3"
      />
      <circle cx="14" cy="14" r="3.5" fill="#141414" />
      <circle cx="22" cy="22" r="3.5" fill="#ff5a36" />
      <circle cx="30" cy="30" r="3.5" fill="#141414" />
    </svg>
  );
}

/** A credit coin. */
export function CoinIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="11" fill="#fff" stroke="#141414" strokeWidth="2.5" />
      <circle cx="13" cy="13" r="5.5" fill="none" stroke="#141414" strokeWidth="2" />
    </svg>
  );
}

import type { ReactNode } from "react";

/** Small decorative icons of the table summary and the result; hidden from assistive tech. */
function Icon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      className={`roulette-icon ${className ?? ""}`.trim()}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ChipStackIcon() {
  return (
    <Icon>
      <ellipse cx="12" cy="17" rx="8" ry="3" fill="currentColor" fillOpacity="0.35" />
      <ellipse cx="12" cy="12.5" rx="8" ry="3" fill="currentColor" fillOpacity="0.55" />
      <ellipse cx="12" cy="8" rx="8" ry="3" fill="currentColor" />
      <path d="M4 8v9M20 8v9" />
    </Icon>
  );
}

export function TrophyIcon() {
  return (
    <Icon>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor" fillOpacity="0.3" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 20h8" />
    </Icon>
  );
}

export function TicketIcon() {
  return (
    <Icon>
      <path
        d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <path d="M15 8v8" strokeDasharray="2 2" />
    </Icon>
  );
}

export function WalletIcon() {
  return (
    <Icon>
      <path
        d="M3 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3v3"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <circle cx="16" cy="13.5" r="1.2" fill="currentColor" />
    </Icon>
  );
}

export function CoinIcon() {
  return (
    <Icon className="roulette-coin">
      <circle cx="12" cy="12" r="9" fill="#ffc933" stroke="#141414" />
      <circle cx="12" cy="12" r="5.5" stroke="#141414" strokeWidth="1.5" />
    </Icon>
  );
}

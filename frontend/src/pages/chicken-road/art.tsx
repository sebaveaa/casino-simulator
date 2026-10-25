/** The chicken from DISENO-MINIJUEGOS §3 (64×64). Decorative. */
export function ChickenArt({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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

export function CheckArt() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function ShieldArt() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  );
}

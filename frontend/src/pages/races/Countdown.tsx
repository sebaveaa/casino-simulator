import { useEffect, useRef, useState } from "react";

/** "mm:ss", rounding up so 00:00 shows only once the time is really over. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Time left until `deadlineMs` on the server clock (`now`). It re-renders on each second boundary
 * and stops at zero, calling `onExpire` once. Not a live region: the seconds are not announced.
 */
export function Countdown({
  deadlineMs,
  now,
  onExpire,
}: {
  deadlineMs: number;
  now: () => number;
  onExpire?: () => void;
}) {
  const [, setTick] = useState(0);
  const left = Math.max(0, deadlineMs - now());
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const expiredFor = useRef<number | null>(null);

  useEffect(() => {
    if (left <= 0) {
      if (expiredFor.current !== deadlineMs) {
        expiredFor.current = deadlineMs;
        expireRef.current?.();
      }
      return;
    }
    // Wake up right after the shown second changes.
    const timer = setTimeout(() => setTick((tick) => tick + 1), left % 1000 || 1000);
    return () => clearTimeout(timer);
  });

  return (
    <p className="races-countdown">
      <span className="races-countdown-label">Cierre de apuestas en</span>
      <span className="races-clock amount" role="timer">
        {formatCountdown(left)}
      </span>
    </p>
  );
}

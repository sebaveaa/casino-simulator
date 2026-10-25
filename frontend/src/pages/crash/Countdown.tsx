import { useEffect, useState } from "react";

/** Whole seconds left until `deadlineMs` (server clock), refreshed four times a second. */
export function Countdown({ deadlineMs, now }: { deadlineMs: number; now: () => number }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((deadlineMs - now()) / 1000)));
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((deadlineMs - now()) / 1000)));
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [deadlineMs, now]);
  return <span className="crash-countdown">{seconds}</span>;
}

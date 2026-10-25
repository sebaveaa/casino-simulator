import { multiplierAtHundredths } from "@casino/shared";
import { useEffect, useState } from "react";

/** True when the viewer asked for reduced motion; re-evaluated on mount (SSR-safe guard). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface LiveMultiplierInput {
  /** Server-clock time (ms) of takeoff; null while the round is still open. */
  startedAtMs: number | null;
  /** Server clock in browser time. */
  now: () => number;
  /** The final multiplier once the round resolved; freezes the value. Null while flying. */
  frozenHundredths: number | null;
  /** Whether the multiplier is rising right now (the round is in the air). */
  flying: boolean;
}

/**
 * The multiplier to show, in hundredths. While the round is flying it rises with
 * `multiplierAtHundredths(now - takeoff)`, animated with `requestAnimationFrame`; once the round
 * resolved it freezes at the real impact point. With `prefers-reduced-motion` it steps as a plain
 * number every 250 ms instead of animating each frame (PLAN-CRASH §6.2).
 */
export function useLiveMultiplier({
  startedAtMs,
  now,
  frozenHundredths,
  flying,
}: LiveMultiplierInput): number {
  const [value, setValue] = useState(frozenHundredths ?? 100);

  useEffect(() => {
    if (frozenHundredths !== null) {
      setValue(frozenHundredths);
      return;
    }
    if (!flying || startedAtMs === null) {
      setValue(100);
      return;
    }
    let active = true;
    const tick = () => {
      if (!active) return;
      setValue(multiplierAtHundredths(now() - startedAtMs));
    };
    tick();
    if (prefersReducedMotion()) {
      const id = setInterval(tick, 250);
      return () => {
        active = false;
        clearInterval(id);
      };
    }
    let frame = 0;
    const loop = () => {
      tick();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [startedAtMs, now, frozenHundredths, flying]);

  return frozenHundredths ?? value;
}

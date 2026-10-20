import type { RaceRound } from "@casino/shared";
import { useEffect, useRef } from "react";

/** Grace after the expected end of a phase before the page asks the server what happened. */
export const WATCHDOG_GRACE_MS = 2000;
/** Interval between further fetches while the page is still behind. */
export const WATCHDOG_RETRY_MS = 5000;

/**
 * When the round on screen should have moved to its next phase, by the server clock, or null when
 * nothing is expected (settled, or the animation length is not known yet).
 */
export function expectedPhaseEnd(
  round: Pick<RaceRound, "status" | "closesAt" | "settlesAt">,
  raceDurationMs: number | null,
): number | null {
  if (round.status === "open") return Date.parse(round.closesAt) + WATCHDOG_GRACE_MS;
  if (round.status === "closed" || round.status === "resolved") {
    if (round.settlesAt) return Date.parse(round.settlesAt) + WATCHDOG_GRACE_MS;
    if (raceDurationMs !== null) {
      return Date.parse(round.closesAt) + raceDurationMs + WATCHDOG_GRACE_MS;
    }
  }
  return null;
}

/**
 * Events are not the source of truth (README §6): one can be lost between reconnections. This asks
 * `refresh` (a fetch of the current race) once a phase overstays its expected end by two seconds,
 * and again every five seconds while the page is still on that phase. Any change of phase, or
 * unmounting, cancels the timers. Fetches never overlap, and `refresh` must not reject.
 */
export function useRaceWatchdog({
  round,
  raceDurationMs,
  now,
  refresh,
  enabled,
}: {
  round: RaceRound | null;
  raceDurationMs: number | null;
  /** The server-adjusted clock, in milliseconds. */
  now: () => number;
  refresh: () => Promise<void>;
  enabled: boolean;
}): void {
  const inFlight = useRef(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const nowRef = useRef(now);
  nowRef.current = now;

  const id = round?.id ?? null;
  const status = round?.status ?? null;
  const closesAt = round?.closesAt ?? null;
  const settlesAt = round?.settlesAt ?? null;
  useEffect(() => {
    if (!enabled || id === null || status === null || closesAt === null) return;
    const end = expectedPhaseEnd(
      { status, closesAt, settlesAt: settlesAt ?? undefined },
      raceDurationMs,
    );
    if (end === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (cancelled) return;
      if (!inFlight.current) {
        inFlight.current = true;
        try {
          await refreshRef.current();
        } catch {
          // The caller reports its own failures; the retry below covers this one.
        } finally {
          inFlight.current = false;
        }
      }
      // Still here: the phase has not changed (a change would have cancelled this effect).
      if (!cancelled) timer = setTimeout(check, WATCHDOG_RETRY_MS);
    };

    timer = setTimeout(check, Math.max(0, end - nowRef.current()));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, id, status, closesAt, settlesAt, raceDurationMs]);
}

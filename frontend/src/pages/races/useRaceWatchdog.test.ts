import { describe, expect, it } from "vitest";
import { expectedPhaseEnd, WATCHDOG_GRACE_MS, WORKER_TICK_MS } from "./useRaceWatchdog";

const CLOSES_AT = "2026-01-01T00:00:30.000Z";
const SETTLES_AT = "2026-01-01T00:00:45.000Z";
const closesMs = Date.parse(CLOSES_AT);

describe("expectedPhaseEnd", () => {
  it("expects an open round to close at closesAt plus the grace", () => {
    expect(expectedPhaseEnd({ status: "open", closesAt: CLOSES_AT }, 10_000)).toBe(
      closesMs + WATCHDOG_GRACE_MS,
    );
  });

  it("expects a resolved round to settle at settlesAt plus the grace", () => {
    expect(
      expectedPhaseEnd({ status: "resolved", closesAt: CLOSES_AT, settlesAt: SETTLES_AT }, 10_000),
    ).toBe(Date.parse(SETTLES_AT) + WATCHDOG_GRACE_MS);
  });

  it("falls back to closesAt plus the duration and two worker ticks when only closesAt is known", () => {
    expect(expectedPhaseEnd({ status: "closed", closesAt: CLOSES_AT }, 10_000)).toBe(
      closesMs + 10_000 + 2 * WORKER_TICK_MS + WATCHDOG_GRACE_MS,
    );
  });

  it("bases a live-resolved round on the animation start the page already has", () => {
    const startedAtMs = closesMs + 1_900;
    expect(expectedPhaseEnd({ status: "resolved", closesAt: CLOSES_AT }, 10_000, startedAtMs)).toBe(
      startedAtMs + 10_000 + WATCHDOG_GRACE_MS,
    );
  });

  it("prefers settlesAt over the animation start", () => {
    expect(
      expectedPhaseEnd(
        { status: "resolved", closesAt: CLOSES_AT, settlesAt: SETTLES_AT },
        10_000,
        closesMs,
      ),
    ).toBe(Date.parse(SETTLES_AT) + WATCHDOG_GRACE_MS);
  });

  it("expects nothing from a settled round or an unknown race duration", () => {
    expect(expectedPhaseEnd({ status: "settled", closesAt: CLOSES_AT }, 10_000)).toBeNull();
    expect(expectedPhaseEnd({ status: "closed", closesAt: CLOSES_AT }, null)).toBeNull();
  });
});

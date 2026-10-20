import type { CurrentRaceResponse, RaceRound } from "@casino/shared";
import { describe, expect, it } from "vitest";
import {
  initialRaceState,
  type MyBet,
  type RaceAction,
  type RaceState,
  raceReducer,
} from "./raceState";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const HASH = "ab".repeat(32);
const SEED = "revealed-server-seed";
const RESULT = { winner: 2, order: [2, 0, 4, 1, 3] };
const DURATION = 10_000;
const LIMITS = { minStake: "100", maxStake: "100000" };
const NOW = Date.parse("2026-01-01T00:00:10.000Z");

function round(id: string, opensAtSeconds: number, extra: Partial<RaceRound> = {}): RaceRound {
  const opensAt = new Date(Date.parse("2026-01-01T00:00:00.000Z") + opensAtSeconds * 1000);
  return {
    id,
    status: "open",
    opensAt: opensAt.toISOString(),
    closesAt: new Date(opensAt.getTime() + 30_000).toISOString(),
    serverSeedHash: HASH,
    ...extra,
  };
}

function snapshot(
  r: RaceRound | null,
  myBet: CurrentRaceResponse["myBet"] = null,
  nowMs = NOW,
  raceDurationMs = DURATION,
): RaceAction {
  return {
    type: "snapshot",
    response: {
      round: r,
      myBet,
      now: new Date(nowMs).toISOString(),
      limits: LIMITS,
      raceDurationMs,
    },
    nowMs,
  };
}

function run(state: RaceState, ...actions: RaceAction[]): RaceState {
  return actions.reduce(raceReducer, state);
}

const closed = (roundId: string): RaceAction => ({
  type: "event",
  event: { type: "closed", roundId },
  nowMs: NOW,
});
const resultEvent = (roundId: string, nowMs = NOW): RaceAction => ({
  type: "event",
  event: { type: "result", roundId, result: RESULT, serverSeed: SEED },
  nowMs,
});
const settled = (roundId: string): RaceAction => ({
  type: "event",
  event: { type: "settled", roundId },
  nowMs: NOW,
});
const opened = (r: RaceRound): RaceAction => ({
  type: "event",
  event: { type: "opened", round: r },
  nowMs: NOW,
});

const BET: MyBet = { animal: 1, stake: "500", payout: null };

describe("raceReducer status", () => {
  it("knows no limits or race duration until the first snapshot", () => {
    expect(initialRaceState.limits).toBeNull();
    expect(initialRaceState.raceDurationMs).toBeNull();
  });

  it("keeps the limits and race duration of the latest snapshot, even with no round", () => {
    const first = run(initialRaceState, snapshot(null));
    expect(first.limits).toEqual(LIMITS);
    expect(first.raceDurationMs).toBe(DURATION);
    const second = run(first, snapshot(round(ID_A, 0), null, NOW, 6_000));
    expect(second.raceDurationMs).toBe(6_000);
  });

  it("starts a fetched animation at settlesAt minus the server's race duration", () => {
    const resolved = round(ID_A, 0, {
      status: "resolved",
      result: RESULT,
      serverSeed: SEED,
      settlesAt: new Date(NOW + 4_000).toISOString(),
    });
    const state = run(initialRaceState, snapshot(resolved, null, NOW, 6_000));
    expect(state.startedAtMs).toBe(NOW + 4_000 - 6_000);
  });

  it("starts a live result at the given server time", () => {
    const state = run(initialRaceState, snapshot(round(ID_A, 0)), resultEvent(ID_A, NOW + 1_234));
    expect(state.startedAtMs).toBe(NOW + 1_234);
    expect(state.raceDurationMs).toBe(DURATION);
  });

  it("never moves a round back to an earlier status", () => {
    const start = run(initialRaceState, snapshot(round(ID_A, 0)), closed(ID_A), resultEvent(ID_A));
    expect(start.round?.status).toBe("resolved");

    // A late snapshot taken while the round was still open, and a late closed event.
    const after = run(start, snapshot(round(ID_A, 0)), closed(ID_A));
    expect(after.round?.status).toBe("resolved");
    expect(after.round?.result).toEqual(RESULT);
  });

  it("keeps settled once reached", () => {
    const start = run(
      initialRaceState,
      snapshot(round(ID_A, 0)),
      resultEvent(ID_A),
      settled(ID_A),
      snapshot(round(ID_A, 0, { status: "resolved", result: RESULT, serverSeed: SEED })),
    );
    expect(start.round?.status).toBe("settled");
  });
});

describe("raceReducer rounds", () => {
  it("replaces the round with a newer one and resets the bet and the animation", () => {
    const resolved = round(ID_A, 0, { status: "resolved", result: RESULT, serverSeed: SEED });
    const before = run(initialRaceState, snapshot(resolved, BET));
    expect(before.myBet).toEqual(BET);
    expect(before.startedAtMs).toBe(NOW);

    const after = run(before, opened(round(ID_B, 40)));
    expect(after.round?.id).toBe(ID_B);
    expect(after.myBet).toBeNull();
    expect(after.startedAtMs).toBeNull();
    expect(after.pastRoundIds).toEqual([ID_A]);
  });

  it("ignores an older round, whether by opensAt or because it was replaced", () => {
    const state = run(initialRaceState, snapshot(round(ID_B, 40)));

    const older = run(state, snapshot(round(ID_A, 0)), opened(round(ID_A, 0)));
    expect(older.round?.id).toBe(ID_B);

    const replaced = run(state, opened(round(ID_C, 80)));
    // ID_B is now a past round, even with an opensAt that would otherwise look newer than C's.
    const late = run(replaced, snapshot(round(ID_B, 90)), closed(ID_B), settled(ID_B));
    expect(late.round?.id).toBe(ID_C);
    expect(late.round?.status).toBe("open");
    expect(late.syncRequest).toBe(0);
  });

  it("never wipes the round on screen with a null snapshot", () => {
    const state = run(initialRaceState, snapshot(round(ID_A, 0), BET));
    const after = run(state, snapshot(null));
    expect(after.round?.id).toBe(ID_A);
    expect(after.myBet).toEqual(BET);
    expect(after.loaded).toBe(true);
  });

  it("marks the page loaded on a null snapshot with nothing on screen", () => {
    const after = run(initialRaceState, snapshot(null));
    expect(after.loaded).toBe(true);
    expect(after.round).toBeNull();
  });
});

describe("raceReducer sync requests", () => {
  it("asks for a fetch on an event for an unknown round, but not for a past one", () => {
    const state = run(initialRaceState, snapshot(round(ID_A, 0)));
    expect(run(state, closed(ID_B)).syncRequest).toBe(1);
    expect(run(state, resultEvent(ID_B)).syncRequest).toBe(1);

    const next = run(state, opened(round(ID_B, 40)));
    expect(run(next, closed(ID_A)).syncRequest).toBe(0);
  });

  it("asks for a fetch on settled when the result or the payout was not seen", () => {
    const noResult = run(initialRaceState, snapshot(round(ID_A, 0)), settled(ID_A));
    expect(noResult.syncRequest).toBe(1);

    const noPayout = run(
      initialRaceState,
      snapshot(round(ID_A, 0), BET),
      resultEvent(ID_A),
      settled(ID_A),
    );
    expect(noPayout.syncRequest).toBe(1);

    const complete = run(
      initialRaceState,
      snapshot(round(ID_A, 0)),
      resultEvent(ID_A),
      settled(ID_A),
    );
    expect(complete.syncRequest).toBe(0);
  });

  it("never bumps syncRequest from a snapshot", () => {
    const state = run(
      initialRaceState,
      snapshot(round(ID_A, 0)),
      snapshot(round(ID_B, 40)),
      snapshot(round(ID_A, 0)),
      snapshot(null),
    );
    expect(state.syncRequest).toBe(0);
  });
});

describe("raceReducer events", () => {
  it("keeps the winner null when settled arrives before the result", () => {
    const state = run(initialRaceState, snapshot(round(ID_A, 0)), settled(ID_A));
    expect(state.round?.status).toBe("settled");
    expect(state.round?.result).toBeUndefined();
    expect(state.round?.result?.winner ?? null).toBeNull();
  });

  it("is idempotent for duplicate events", () => {
    const once = run(
      initialRaceState,
      snapshot(round(ID_A, 0), BET),
      closed(ID_A),
      resultEvent(ID_A),
      settled(ID_A),
    );
    const twice = run(once, closed(ID_A), resultEvent(ID_A), settled(ID_A));
    expect({ ...twice, syncRequest: 0 }).toEqual({ ...once, syncRequest: 0 });
    expect(twice.round).toEqual(once.round);
    expect(twice.myBet).toEqual(once.myBet);
  });

  it("does not reset startedAtMs when a later report arrives", () => {
    const started = run(initialRaceState, snapshot(round(ID_A, 0)), resultEvent(ID_A, NOW));
    expect(started.startedAtMs).toBe(NOW);

    const later = run(
      started,
      resultEvent(ID_A, NOW + 3_000),
      snapshot(
        round(ID_A, 0, {
          status: "resolved",
          result: RESULT,
          serverSeed: SEED,
          settlesAt: new Date(NOW + 2_000 + DURATION).toISOString(),
        }),
        null,
        NOW + 4_000,
      ),
    );
    expect(later.startedAtMs).toBe(NOW);
  });

  it("keeps a payout once seen over a later report without one", () => {
    const paid: MyBet = { animal: 1, stake: "500", payout: "2250" };
    const state = run(
      initialRaceState,
      snapshot(round(ID_A, 0, { status: "settled", result: RESULT, serverSeed: SEED }), paid),
      snapshot(round(ID_A, 0, { status: "resolved", result: RESULT, serverSeed: SEED }), BET),
    );
    expect(state.myBet).toEqual(paid);
  });
});

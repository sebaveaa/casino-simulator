import type { CrashCurrentResponse, CrashRound } from "@casino/shared";
import { describe, expect, it } from "vitest";
import { crashReducer, initialCrashState } from "./crashState";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const HASH = "ab".repeat(32);
const CLOSES = "2026-10-25T10:00:05.000Z";

const openRound: CrashRound = {
  id: ID_A,
  status: "open",
  opensAt: "2026-10-25T10:00:00.000Z",
  closesAt: CLOSES,
  serverSeedHash: HASH,
};

const snapshot = (round: CrashRound | null, myBet: CrashCurrentResponse["myBet"] = null) =>
  crashReducer(initialCrashState, {
    type: "snapshot",
    response: {
      round,
      myBet,
      now: "2026-10-25T10:00:01.000Z",
      limits: { minStake: "1000", maxStake: "50000" },
    },
  });

describe("crashReducer", () => {
  it("loads a snapshot and keeps the round and limits", () => {
    const state = snapshot(openRound);
    expect(state.loaded).toBe(true);
    expect(state.limits).toEqual({ minStake: "1000", maxStake: "50000" });
    expect(state.round?.id).toBe(ID_A);
    expect(state.startedAtMs).toBeNull();
  });

  it("takeoff closes the round and sets the start instant to closesAt", () => {
    const state = crashReducer(snapshot(openRound), {
      type: "event",
      event: { type: "takeoff", roundId: ID_A, startedAt: CLOSES },
    });
    expect(state.round?.status).toBe("closed");
    expect(state.startedAtMs).toBe(Date.parse(CLOSES));
  });

  it("impact records the result and the revealed seed", () => {
    const flying = crashReducer(snapshot(openRound), {
      type: "event",
      event: { type: "takeoff", roundId: ID_A, startedAt: CLOSES },
    });
    const state = crashReducer(flying, {
      type: "event",
      event: {
        type: "impact",
        roundId: ID_A,
        result: { crashHundredths: 245, outcome: "impact" },
        serverSeed: "seed",
      },
    });
    expect(state.round?.status).toBe("resolved");
    expect(state.round?.result).toEqual({ crashHundredths: 245, outcome: "impact" });
    expect(state.round?.serverSeed).toBe("seed");
  });

  it("asks for a fetch on a settlement whose bet payout it has not seen", () => {
    const withBet = crashReducer(
      snapshot(openRound, {
        betId: "33333333-3333-4333-8333-333333333333",
        stake: "1000",
        status: "pending",
        cashoutHundredths: null,
        payout: null,
      }),
      { type: "event", event: { type: "takeoff", roundId: ID_A, startedAt: CLOSES } },
    );
    const state = crashReducer(withBet, {
      type: "event",
      event: { type: "settled", roundId: ID_A },
    });
    expect(state.round?.status).toBe("settled");
    expect(state.syncRequest).toBe(1);
  });

  it("records the player's bet and then the cash-out", () => {
    const bet = crashReducer(snapshot(openRound), {
      type: "bet",
      roundId: ID_A,
      bet: {
        betId: "33333333-3333-4333-8333-333333333333",
        stake: "1000",
        status: "pending",
        cashoutHundredths: null,
        payout: null,
      },
    });
    expect(bet.myBet?.status).toBe("pending");
    const cashed = crashReducer(bet, {
      type: "cashout",
      betId: "33333333-3333-4333-8333-333333333333",
      cashoutHundredths: 180,
      payout: "1800",
    });
    expect(cashed.myBet?.status).toBe("settled");
    expect(cashed.myBet?.cashoutHundredths).toBe(180);
    expect(cashed.myBet?.payout).toBe("1800");
  });

  it("asks for a fetch on an event for an unknown round", () => {
    const state = crashReducer(snapshot(openRound), {
      type: "event",
      event: { type: "settled", roundId: ID_B },
    });
    expect(state.syncRequest).toBe(1);
  });

  it("ignores a round older than the one on screen", () => {
    const newer: CrashRound = { ...openRound, id: ID_B, opensAt: "2026-10-25T10:01:00.000Z" };
    const onNewer = snapshot(newer);
    const state = crashReducer(onNewer, {
      type: "event",
      event: { type: "opened", round: openRound },
    });
    expect(state.round?.id).toBe(ID_B);
  });
});

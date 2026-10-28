import { describe, expect, it } from "vitest";
import {
  CRASH_HISTORY_DEFAULT_LIMIT,
  CRASH_HISTORY_MAX_LIMIT,
  crashBetRequestSchema,
  crashCurrentResponseSchema,
  crashEventSchema,
  crashHistoryQuerySchema,
  crashRoundSchema,
} from "./crash";

const HASH = "a".repeat(64);
const SEED = "server-seed";
const ID = "11111111-1111-4111-8111-111111111111";

const openRound = {
  id: ID,
  status: "open" as const,
  opensAt: "2026-10-25T00:00:00.000Z",
  closesAt: "2026-10-25T00:00:05.000Z",
  serverSeedHash: HASH,
};

const resolvedRound = {
  ...openRound,
  status: "resolved" as const,
  result: { crashHundredths: 245, outcome: "impact" as const },
  serverSeed: SEED,
};

describe("crashRoundSchema", () => {
  it("accepts an open round without secrets", () => {
    expect(crashRoundSchema.safeParse(openRound).success).toBe(true);
  });

  it("rejects secrets while the round is still open or closed", () => {
    expect(crashRoundSchema.safeParse({ ...openRound, serverSeed: SEED }).success).toBe(false);
    expect(
      crashRoundSchema.safeParse({
        ...openRound,
        status: "closed",
        result: { crashHundredths: 200, outcome: "impact" },
        serverSeed: SEED,
      }).success,
    ).toBe(false);
  });

  it("requires the seed and result once resolved", () => {
    expect(crashRoundSchema.safeParse(resolvedRound).success).toBe(true);
    expect(crashRoundSchema.safeParse({ ...openRound, status: "resolved" }).success).toBe(false);
  });

  it("requires the seed and result once settled", () => {
    expect(crashRoundSchema.safeParse({ ...resolvedRound, status: "settled" }).success).toBe(true);
    expect(crashRoundSchema.safeParse({ ...openRound, status: "settled" }).success).toBe(false);
    expect(
      crashRoundSchema.safeParse({ ...openRound, status: "settled", serverSeed: SEED }).success,
    ).toBe(false);
  });
});

describe("crashBetRequestSchema", () => {
  it("accepts a stake within 10 to 500 credits", () => {
    expect(crashBetRequestSchema.safeParse({ roundId: ID, stake: "1000" }).success).toBe(true);
    expect(crashBetRequestSchema.safeParse({ roundId: ID, stake: "50000" }).success).toBe(true);
  });

  it("rejects a stake outside the bounds or not an amount string", () => {
    expect(crashBetRequestSchema.safeParse({ roundId: ID, stake: "999" }).success).toBe(false);
    expect(crashBetRequestSchema.safeParse({ roundId: ID, stake: "50001" }).success).toBe(false);
    expect(crashBetRequestSchema.safeParse({ roundId: ID, stake: "10.5" }).success).toBe(false);
  });
});

describe("crashHistoryQuerySchema", () => {
  it("defaults the limit and coerces strings", () => {
    expect(crashHistoryQuerySchema.parse({})).toEqual({ limit: CRASH_HISTORY_DEFAULT_LIMIT });
    expect(crashHistoryQuerySchema.parse({ limit: "10" })).toEqual({ limit: 10 });
  });

  it("rejects a limit over the maximum", () => {
    expect(
      crashHistoryQuerySchema.safeParse({ limit: String(CRASH_HISTORY_MAX_LIMIT + 1) }).success,
    ).toBe(false);
  });
});

describe("crashCurrentResponseSchema", () => {
  it("accepts a null round and a null bet", () => {
    expect(
      crashCurrentResponseSchema.safeParse({
        round: null,
        myBet: null,
        now: "2026-10-25T00:00:00.000Z",
        limits: { minStake: "1000", maxStake: "50000" },
      }).success,
    ).toBe(true);
  });

  it("accepts a pending bet with null payout", () => {
    expect(
      crashCurrentResponseSchema.safeParse({
        round: openRound,
        myBet: {
          betId: ID,
          stake: "1000",
          status: "pending",
          cashoutHundredths: null,
          payout: null,
        },
        now: "2026-10-25T00:00:01.000Z",
        limits: { minStake: "1000", maxStake: "50000" },
      }).success,
    ).toBe(true);
  });
});

describe("crashEventSchema", () => {
  it("accepts each event type", () => {
    expect(crashEventSchema.safeParse({ type: "opened", round: openRound }).success).toBe(true);
    expect(
      crashEventSchema.safeParse({
        type: "takeoff",
        roundId: ID,
        startedAt: "2026-10-25T00:00:05.000Z",
      }).success,
    ).toBe(true);
    expect(
      crashEventSchema.safeParse({
        type: "impact",
        roundId: ID,
        result: { crashHundredths: 245, outcome: "impact" },
        serverSeed: SEED,
      }).success,
    ).toBe(true);
    expect(crashEventSchema.safeParse({ type: "settled", roundId: ID }).success).toBe(true);
    expect(
      crashEventSchema.safeParse({ type: "cashout", roundId: ID, count: 3, atHundredths: 180 })
        .success,
    ).toBe(true);
  });

  it("only lets the impact event carry the server seed", () => {
    expect(
      crashEventSchema.safeParse({
        type: "takeoff",
        roundId: ID,
        startedAt: "2026-10-25T00:00:05.000Z",
        serverSeed: SEED,
      }).success,
    ).toBe(false);
    expect(
      crashEventSchema.safeParse({ type: "settled", roundId: ID, serverSeed: SEED }).success,
    ).toBe(false);
  });
});

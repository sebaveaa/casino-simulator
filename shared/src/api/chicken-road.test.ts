import { describe, expect, it } from "vitest";
import {
  chickenRoadCashoutResponseSchema,
  chickenRoadCurrentResponseSchema,
  chickenRoadGameSchema,
  chickenRoadHistoryQuerySchema,
  chickenRoadHistoryResponseSchema,
  chickenRoadStartRequestSchema,
  chickenRoadStartResponseSchema,
  chickenRoadStepRequestSchema,
} from "./chicken-road";
import { apiPaths } from "./paths";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const base = {
  gameId: uuid,
  stake: "1000",
  fairness: { seedPairId: uuid, serverSeedHash: "a".repeat(64), clientSeed: "c", nonce: 3 },
};

const inProgress = { ...base, status: "in_progress", lanesCrossed: 2, cashoutAmount: "1500" };
const lost = { ...base, status: "lost", lanesCrossed: 2, hitLane: 3, payout: "0" };
const cashedOut = { ...base, status: "cashed_out", lanesCrossed: 3, payout: "1870" };
const completed = { ...base, status: "completed", lanesCrossed: 6, payout: "3660" };

describe("chickenRoadGameSchema", () => {
  it("accepts each state", () => {
    for (const game of [inProgress, lost, cashedOut, completed]) {
      expect(chickenRoadGameSchema.parse(game)).toEqual(game);
    }
    expect(
      chickenRoadGameSchema.safeParse({ ...inProgress, lanesCrossed: 0, cashoutAmount: "0" }),
    ).toMatchObject({ success: true });
  });

  it("never lets a game in progress reveal the hit lane", () => {
    expect(chickenRoadGameSchema.safeParse({ ...inProgress, hitLane: 4 }).success).toBe(false);
  });

  it("rejects lanes that do not fit the state", () => {
    const invalid = [
      { ...inProgress, lanesCrossed: 6 },
      { ...lost, hitLane: 7 },
      { ...lost, payout: "1000" },
      { ...cashedOut, lanesCrossed: 0 },
      { ...completed, lanesCrossed: 5 },
      { ...completed, payout: 3660 },
      { ...cashedOut, status: "won" },
    ];
    for (const game of invalid) expect(chickenRoadGameSchema.safeParse(game).success).toBe(false);
  });
});

describe("chickenRoadStartRequestSchema", () => {
  it("accepts stakes from 10 to 500 credits as strings", () => {
    for (const stake of ["1000", "50000", "12345"]) {
      expect(chickenRoadStartRequestSchema.parse({ stake })).toEqual({ stake });
    }
  });

  it("rejects stakes out of range, numbers and malformed strings", () => {
    for (const stake of ["0", "999", "50001", 1000, "1e3", "-1000", "abc"]) {
      expect(chickenRoadStartRequestSchema.safeParse({ stake }).success).toBe(false);
    }
  });

  it("answers with a game in progress", () => {
    const body = { game: { ...inProgress, lanesCrossed: 0, cashoutAmount: "0" }, balance: "9000" };
    expect(chickenRoadStartResponseSchema.parse(body)).toEqual(body);
    expect(chickenRoadStartResponseSchema.safeParse({ game: lost, balance: "9000" }).success).toBe(
      false,
    );
  });
});

describe("chickenRoadStepRequestSchema", () => {
  it("names the game and a lane from 1 to 6", () => {
    expect(chickenRoadStepRequestSchema.parse({ gameId: uuid, lane: 1 })).toEqual({
      gameId: uuid,
      lane: 1,
    });
    for (const lane of [0, 7, 1.5, "1"]) {
      expect(chickenRoadStepRequestSchema.safeParse({ gameId: uuid, lane }).success).toBe(false);
    }
    expect(chickenRoadStepRequestSchema.safeParse({ gameId: "x", lane: 1 }).success).toBe(false);
  });
});

describe("chickenRoadCashoutResponseSchema", () => {
  it("returns a paid game, never one in progress or lost", () => {
    for (const game of [cashedOut, completed]) {
      expect(chickenRoadCashoutResponseSchema.safeParse({ game, balance: "1" }).success).toBe(true);
    }
    for (const game of [inProgress, lost]) {
      expect(chickenRoadCashoutResponseSchema.safeParse({ game, balance: "1" }).success).toBe(
        false,
      );
    }
  });
});

describe("chickenRoadCurrentResponseSchema", () => {
  it("holds the game in progress or null", () => {
    expect(chickenRoadCurrentResponseSchema.parse({ game: null })).toEqual({ game: null });
    expect(chickenRoadCurrentResponseSchema.parse({ game: inProgress })).toEqual({
      game: inProgress,
    });
    expect(chickenRoadCurrentResponseSchema.safeParse({ game: cashedOut }).success).toBe(false);
  });
});

describe("chickenRoadHistoryQuerySchema", () => {
  it("defaults to 5 and reads the limit from a query string", () => {
    expect(chickenRoadHistoryQuerySchema.parse({})).toEqual({ limit: 5 });
    expect(chickenRoadHistoryQuerySchema.parse({ limit: "20" })).toEqual({ limit: 20 });
    expect(chickenRoadHistoryQuerySchema.parse({ limit: "1" })).toEqual({ limit: 1 });
  });

  it("rejects limits outside 1 to 20 and non-integers", () => {
    for (const limit of ["0", "21", "2.5", "abc"]) {
      expect(chickenRoadHistoryQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });
});

describe("chickenRoadHistoryResponseSchema", () => {
  it("lists finished games only", () => {
    const body = { games: [completed, lost, cashedOut] };
    expect(chickenRoadHistoryResponseSchema.parse(body)).toEqual(body);
    expect(chickenRoadHistoryResponseSchema.parse({ games: [] })).toEqual({ games: [] });
    expect(chickenRoadHistoryResponseSchema.safeParse({ games: [inProgress] }).success).toBe(false);
  });

  it("caps the list at 20 games", () => {
    const games = Array.from({ length: 21 }, () => lost);
    expect(chickenRoadHistoryResponseSchema.safeParse({ games }).success).toBe(false);
  });
});

describe("apiPaths", () => {
  it("declares the Chicken Road endpoints", () => {
    expect(apiPaths.chickenRoadGames).toBe("/games/chicken-road/games");
    expect(apiPaths.chickenRoadCurrent).toBe("/games/chicken-road/games/current");
    expect(apiPaths.chickenRoadSteps).toBe("/games/chicken-road/games/current/steps");
    expect(apiPaths.chickenRoadCashout).toBe("/games/chicken-road/games/current/cashout");
  });
});

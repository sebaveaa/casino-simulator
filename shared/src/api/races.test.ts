import { describe, expect, it } from "vitest";
import { apiPaths } from "./paths";
import {
  currentRaceResponseSchema,
  raceBetRequestSchema,
  raceBetResponseSchema,
  raceEventSchema,
  raceRoundSchema,
} from "./races";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const hash = "a".repeat(64);
const result = { winner: 2, order: [2, 0, 1, 4, 3] };
const baseRound = {
  id: uuid,
  opensAt: "2026-10-19T10:00:00Z",
  closesAt: "2026-10-19T10:00:30Z",
  serverSeedHash: hash,
};

describe("raceBetRequestSchema", () => {
  const valid = { roundId: uuid, animal: 4, stake: "100" };

  it("accepts a valid bet", () => {
    expect(raceBetRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects animal 5", () => {
    expect(raceBetRequestSchema.safeParse({ ...valid, animal: 5 }).success).toBe(false);
  });

  it("rejects a zero stake", () => {
    expect(raceBetRequestSchema.safeParse({ ...valid, stake: "0" }).success).toBe(false);
  });

  it("rejects a roundId that is not a uuid", () => {
    expect(raceBetRequestSchema.safeParse({ ...valid, roundId: "nope" }).success).toBe(false);
  });
});

describe("raceBetResponseSchema", () => {
  it("accepts a valid response", () => {
    const body = { betId: uuid, roundId: uuid, animal: 1, stake: "100", balance: "900" };
    expect(raceBetResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe("raceRoundSchema", () => {
  it("accepts an open round without result", () => {
    expect(raceRoundSchema.safeParse({ ...baseRound, status: "open" }).success).toBe(true);
  });

  it("rejects an open round carrying a serverSeed", () => {
    const parsed = raceRoundSchema.safeParse({ ...baseRound, status: "open", serverSeed: "s" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a closed round carrying a result", () => {
    const parsed = raceRoundSchema.safeParse({ ...baseRound, status: "closed", result });
    expect(parsed.success).toBe(false);
  });

  it("accepts a resolved round with result and serverSeed", () => {
    const parsed = raceRoundSchema.safeParse({
      ...baseRound,
      status: "resolved",
      result,
      serverSeed: "seed",
      settlesAt: "2026-10-19T10:00:40Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a closed round carrying a serverSeed", () => {
    const parsed = raceRoundSchema.safeParse({ ...baseRound, status: "closed", serverSeed: "s" });
    expect(parsed.success).toBe(false);
  });

  it.each(["resolved", "settled"])("rejects a %s round missing result", (status) => {
    const parsed = raceRoundSchema.safeParse({ ...baseRound, status, serverSeed: "seed" });
    expect(parsed.success).toBe(false);
  });

  it.each(["resolved", "settled"])("rejects a %s round missing serverSeed", (status) => {
    const parsed = raceRoundSchema.safeParse({ ...baseRound, status, result });
    expect(parsed.success).toBe(false);
  });

  it("accepts a settled round with result, serverSeed and settlesAt", () => {
    const parsed = raceRoundSchema.safeParse({
      ...baseRound,
      status: "settled",
      result,
      serverSeed: "seed",
      settlesAt: "2026-10-19T10:00:40Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(raceRoundSchema.safeParse({ ...baseRound, status: "weird" }).success).toBe(false);
  });
});

describe("currentRaceResponseSchema", () => {
  const now = "2026-10-19T10:00:05Z";
  const settings = { limits: { minStake: "100", maxStake: "100000" }, raceDurationMs: 10000 };

  it("accepts no round and no bet", () => {
    expect(
      currentRaceResponseSchema.safeParse({ round: null, myBet: null, now, ...settings }).success,
    ).toBe(true);
  });

  it("requires the stake limits and the race duration", () => {
    const body = { round: null, myBet: null, now };
    expect(currentRaceResponseSchema.safeParse(body).success).toBe(false);
    expect(currentRaceResponseSchema.safeParse({ ...body, raceDurationMs: 10000 }).success).toBe(
      false,
    );
    expect(currentRaceResponseSchema.safeParse({ ...body, limits: settings.limits }).success).toBe(
      false,
    );
  });

  it("rejects a non-positive or fractional race duration and malformed limits", () => {
    const body = { round: null, myBet: null, now, ...settings };
    for (const raceDurationMs of [0, -1, 1.5]) {
      expect(currentRaceResponseSchema.safeParse({ ...body, raceDurationMs }).success).toBe(false);
    }
    expect(
      currentRaceResponseSchema.safeParse({
        ...body,
        limits: { minStake: "1.5", maxStake: "100" },
      }).success,
    ).toBe(false);
  });

  it("accepts a round with a pending bet", () => {
    const body = {
      round: { ...baseRound, status: "open" },
      myBet: { animal: 1, stake: "100", payout: null },
      now,
      ...settings,
    };
    expect(currentRaceResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe("currentRaceResponseSchema payout", () => {
  it("accepts an amount string as myBet.payout", () => {
    const body = {
      round: { ...baseRound, status: "settled", result, serverSeed: "seed" },
      myBet: { animal: 2, stake: "100", payout: "450" },
      now: "2026-10-19T10:01:00Z",
      limits: { minStake: "100", maxStake: "100000" },
      raceDurationMs: 10000,
    };
    expect(currentRaceResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe("raceEventSchema", () => {
  it("validates one event of each type", () => {
    const events = [
      { type: "opened", round: { ...baseRound, status: "open" } },
      { type: "closed", roundId: uuid },
      { type: "result", roundId: uuid, result, serverSeed: "seed" },
      { type: "settled", roundId: uuid },
    ];
    for (const event of events) {
      expect(raceEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("rejects an unknown type", () => {
    expect(raceEventSchema.safeParse({ type: "other", roundId: uuid }).success).toBe(false);
  });
});

describe("race paths", () => {
  it("defines the race paths", () => {
    expect(apiPaths.raceBets).toBe("/games/races/bets");
    expect(apiPaths.raceCurrent).toBe("/races/current");
    expect(apiPaths.raceRound).toBe("/races/rounds/:roundId");
    expect(apiPaths.raceStream).toBe("/races/stream");
  });
});

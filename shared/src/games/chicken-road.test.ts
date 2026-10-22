import { describe, expect, it } from "vitest";
import { computeOutcome, createRng, type Rng } from "../rng";
import {
  CHICKEN_ROAD_MULTIPLIERS,
  type ChickenRoadBet,
  chickenRoad,
  chickenRoadMultiplier,
  chickenRoadPayout,
  chickenRoadResultSchema,
  isValidChickenRoadStake,
  LANE_COUNT,
  MAX_STAKE,
  MIN_STAKE,
} from "./chicken-road";

/** A fake `Rng` that returns `draws` in order and records each call. */
function fakeRng(draws: number[]): Rng & { calls: number } {
  const rng = {
    calls: 0,
    int(max: number) {
      expect(max).toBe(100);
      const value = draws[rng.calls];
      rng.calls += 1;
      if (value === undefined) throw new Error("no more draws");
      return value;
    },
  };
  return rng;
}

const bet = (cashOutAt: number, stake = 1000n): ChickenRoadBet => ({ stake, cashOutAt });

async function seededRoad(nonce: number) {
  const outcome = await computeOutcome({
    serverSeed: "server-seed",
    clientSeed: "client-seed",
    nonce,
  });
  return chickenRoad.resolve(bet(1), createRng(outcome));
}

describe("CHICKEN_ROAD_MULTIPLIERS", () => {
  it("derives floor(96 * 5^k / 4^k) hundredths for the six lanes", () => {
    expect(CHICKEN_ROAD_MULTIPLIERS).toEqual([120, 150, 187, 234, 292, 366]);
    expect(CHICKEN_ROAD_MULTIPLIERS).toHaveLength(LANE_COUNT);
  });

  it("avoids the float formula, which gives 149 for lane 2", () => {
    expect(Math.floor((100 * 0.96) / 0.8 ** 2)).toBe(149);
    expect(chickenRoadMultiplier(2)).toBe(150);
  });

  it("rejects lanes outside 1 to 6", () => {
    for (const lanes of [0, 7, 1.5, -1]) {
      expect(() => chickenRoadMultiplier(lanes)).toThrow(RangeError);
    }
  });
});

describe("chickenRoadPayout", () => {
  it("returns floor(stake * mult / 100), stake included", () => {
    expect(chickenRoadPayout(1000n, 1)).toBe(1200n);
    expect(chickenRoadPayout(1000n, 6)).toBe(3660n);
    // 1001 * 187 / 100 = 1871.87, rounded down.
    expect(chickenRoadPayout(1001n, 3)).toBe(1871n);
    expect(chickenRoadPayout(MAX_STAKE, 6)).toBe(183000n);
  });
});

describe("chickenRoad.validateBet", () => {
  it("accepts stakes from 10 to 500 credits", () => {
    expect(MIN_STAKE).toBe(1000n);
    expect(MAX_STAKE).toBe(50000n);
    expect(chickenRoad.validateBet(bet(1, MIN_STAKE))).toBe(true);
    expect(chickenRoad.validateBet(bet(6, MAX_STAKE))).toBe(true);
    expect(isValidChickenRoadStake(MIN_STAKE - 1n)).toBe(false);
    expect(isValidChickenRoadStake(MAX_STAKE + 1n)).toBe(false);
    expect(chickenRoad.validateBet(bet(1, 0n))).toBe(false);
  });

  it("rejects a cash-out point outside 1 to 6", () => {
    for (const cashOutAt of [0, 7, 2.5]) {
      expect(chickenRoad.validateBet(bet(cashOutAt))).toBe(false);
    }
  });
});

describe("chickenRoad.resolve", () => {
  it("stops at the first draw of 80 or more", () => {
    const first = fakeRng([80]);
    expect(chickenRoad.resolve(bet(6), first)).toEqual({ hitLane: 1 });
    expect(first.calls).toBe(1);

    const fourth = fakeRng([0, 79, 50, 99]);
    expect(chickenRoad.resolve(bet(6), fourth)).toEqual({ hitLane: 4 });
    expect(fourth.calls).toBe(4);
  });

  it("returns null when all six lanes are safe", () => {
    const rng = fakeRng([79, 79, 79, 79, 79, 79]);
    expect(chickenRoad.resolve(bet(6), rng)).toEqual({ hitLane: null });
    expect(rng.calls).toBe(6);
  });

  it("gives known roads for fixed seeds, every time", async () => {
    expect(await seededRoad(0)).toEqual({ hitLane: 3 });
    expect(await seededRoad(4)).toEqual({ hitLane: null });
    expect(await seededRoad(5)).toEqual({ hitLane: 1 });
    expect(await seededRoad(0)).toEqual({ hitLane: 3 });
  });

  it("ignores the bet, so the road is fixed when the game starts", async () => {
    const outcome = await computeOutcome({ serverSeed: "s", clientSeed: "c", nonce: 7 });
    const roads = [1, 6].map((cashOutAt) =>
      chickenRoad.resolve(bet(cashOutAt, MAX_STAKE), createRng(outcome)),
    );
    expect(roads[0]).toEqual(roads[1]);
  });

  it("matches the result schema", async () => {
    expect(chickenRoadResultSchema.safeParse(await seededRoad(0)).success).toBe(true);
    expect(chickenRoadResultSchema.safeParse({ hitLane: 7 }).success).toBe(false);
  });
});

describe("chickenRoad.payout", () => {
  it("pays a cash-out before the car", () => {
    expect(chickenRoad.payout(bet(2), { hitLane: 3 })).toBe(1500n);
    expect(chickenRoad.payout(bet(4), { hitLane: null })).toBe(2340n);
  });

  it("pays nothing when the car hits a lane the player tried to cross", () => {
    expect(chickenRoad.payout(bet(3), { hitLane: 3 })).toBe(0n);
    expect(chickenRoad.payout(bet(6), { hitLane: 1 })).toBe(0n);
  });

  it("pays the goal multiplier when all six lanes are crossed", () => {
    expect(chickenRoad.payout(bet(6), { hitLane: null })).toBe(3660n);
  });
});

import { describe, expect, it } from "vitest";
import { computeRoundOutcome, createRng, hashServerSeed, type Rng } from "../rng";
import {
  CRASH_DRAW_RANGE,
  canCashOut,
  crashPayout,
  crashResultFromOutcome,
  crashResultSchema,
  impactAtMs,
  isValidCrashStake,
  MAX_MULTIPLIER_HUNDREDTHS,
  MIN_MULTIPLIER_HUNDREDTHS,
  multiplierAtHundredths,
  resolveCrash,
  verifyCrashRound,
} from "./crash";

const OUTCOME = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

/** An `Rng` that answers the single `int(1_000_000)` draw of `resolveCrash` with `r`. */
function fixedDraw(r: number): Rng {
  return {
    int: (max: number) => {
      if (max !== CRASH_DRAW_RANGE) throw new Error(`unexpected int(${max})`);
      return r;
    },
  };
}

describe("resolveCrash", () => {
  it("applies floor(99_000_000 / (1_000_000 - r)) clamped to [100, 2000]", () => {
    expect(resolveCrash(fixedDraw(0))).toEqual({ crashHundredths: 100, outcome: "impact" });
    expect(resolveCrash(fixedDraw(500_000))).toEqual({ crashHundredths: 198, outcome: "impact" });
    expect(resolveCrash(fixedDraw(950_000))).toEqual({ crashHundredths: 1980, outcome: "impact" });
  });

  it("marks the cap when the impact point reaches 20.00x", () => {
    expect(resolveCrash(fixedDraw(999_999))).toEqual({ crashHundredths: 2000, outcome: "cap" });
    // 99_000_000 / 49_500 = 2000 exactly: the first r that caps.
    expect(resolveCrash(fixedDraw(CRASH_DRAW_RANGE - 49_500))).toEqual({
      crashHundredths: 2000,
      outcome: "cap",
    });
  });

  it("never falls outside the bounds across the whole draw range", () => {
    for (let i = 0; i <= 1000; i++) {
      const r = Math.min(Math.floor((i / 1000) * CRASH_DRAW_RANGE), CRASH_DRAW_RANGE - 1);
      const { crashHundredths } = resolveCrash(fixedDraw(r));
      expect(crashHundredths).toBeGreaterThanOrEqual(MIN_MULTIPLIER_HUNDREDTHS);
      expect(crashHundredths).toBeLessThanOrEqual(MAX_MULTIPLIER_HUNDREDTHS);
    }
  });

  it("is deterministic for the same outcome", () => {
    expect(crashResultFromOutcome(OUTCOME)).toEqual(crashResultFromOutcome(OUTCOME));
  });

  it("reaches 2x in about 49.5% of the range, caps in about 4.95% and ends about 1.98% at 1.00x", () => {
    const total = 20_000;
    let reachedTwo = 0;
    let capped = 0;
    let immediate = 0;
    for (let i = 0; i < total; i++) {
      const r = Math.floor((i / total) * CRASH_DRAW_RANGE);
      const { crashHundredths } = resolveCrash(fixedDraw(r));
      if (crashHundredths >= 200) reachedTwo++;
      if (crashHundredths >= MAX_MULTIPLIER_HUNDREDTHS) capped++;
      if (crashHundredths === MIN_MULTIPLIER_HUNDREDTHS) immediate++;
    }
    expect(reachedTwo / total).toBeCloseTo(0.495, 2);
    expect(capped / total).toBeCloseTo(0.0495, 2);
    expect(immediate / total).toBeCloseTo(0.0198, 3);
  });
});

describe("crashResultSchema", () => {
  it("accepts a result whose outcome matches its impact point", () => {
    expect(crashResultSchema.safeParse({ crashHundredths: 245, outcome: "impact" }).success).toBe(
      true,
    );
    expect(crashResultSchema.safeParse({ crashHundredths: 2000, outcome: "cap" }).success).toBe(
      true,
    );
  });

  it("rejects a cap below 20.00x and an impact at 20.00x", () => {
    expect(crashResultSchema.safeParse({ crashHundredths: 500, outcome: "cap" }).success).toBe(
      false,
    );
    expect(crashResultSchema.safeParse({ crashHundredths: 2000, outcome: "impact" }).success).toBe(
      false,
    );
  });

  it("accepts every result resolveCrash produces", () => {
    for (let i = 0; i <= 1000; i++) {
      const r = Math.min(Math.floor((i / 1000) * CRASH_DRAW_RANGE), CRASH_DRAW_RANGE - 1);
      expect(crashResultSchema.safeParse(resolveCrash(fixedDraw(r))).success).toBe(true);
    }
  });
});

describe("multiplierAtHundredths and impactAtMs", () => {
  it("starts at 1.00x and grows", () => {
    expect(multiplierAtHundredths(0)).toBe(MIN_MULTIPLIER_HUNDREDTHS);
    expect(multiplierAtHundredths(-10)).toBe(MIN_MULTIPLIER_HUNDREDTHS);
    expect(multiplierAtHundredths(20_000)).toBeGreaterThan(multiplierAtHundredths(10_000));
  });

  it("are coherent inverses: the impact instant is the first ms that reaches the multiplier", () => {
    for (let h = MIN_MULTIPLIER_HUNDREDTHS + 1; h <= MAX_MULTIPLIER_HUNDREDTHS; h++) {
      const t = impactAtMs(h);
      expect(multiplierAtHundredths(t)).toBeGreaterThanOrEqual(h);
      expect(multiplierAtHundredths(t - 1)).toBeLessThan(h);
    }
  });

  it("has no impact delay for the 1.00x floor", () => {
    expect(impactAtMs(MIN_MULTIPLIER_HUNDREDTHS)).toBe(0);
  });
});

describe("canCashOut", () => {
  it("accepts before the impact instant and rejects at or after it", () => {
    const crash = 500;
    const impact = impactAtMs(crash);
    expect(canCashOut(0, crash)).toBe(true);
    expect(canCashOut(impact - 1, crash)).toBe(true);
    expect(canCashOut(impact, crash)).toBe(false);
    expect(canCashOut(-1, crash)).toBe(false);
  });
});

describe("crashPayout", () => {
  it("pays stake times the multiplier, rounded down", () => {
    expect(crashPayout(100n, 245)).toBe(245n);
    expect(crashPayout(1000n, 198)).toBe(1980n);
    expect(crashPayout(3n, 150)).toBe(4n);
    expect(crashPayout(5000n, 2000)).toBe(100000n);
  });
});

describe("isValidCrashStake", () => {
  it("accepts 10 to 500 credits and rejects outside", () => {
    expect(isValidCrashStake(1000n)).toBe(true);
    expect(isValidCrashStake(50000n)).toBe(true);
    expect(isValidCrashStake(999n)).toBe(false);
    expect(isValidCrashStake(50001n)).toBe(false);
  });
});

describe("verifyCrashRound", () => {
  it("confirms a matching hash and recomputes the impact point", async () => {
    const serverSeed = "a".repeat(64);
    const roundId = "11111111-1111-1111-1111-111111111111";
    const hash = await hashServerSeed(serverSeed);
    const outcome = await computeRoundOutcome(serverSeed, roundId);

    const { hashValid, result } = await verifyCrashRound(serverSeed, roundId, hash);
    expect(hashValid).toBe(true);
    expect(result).toEqual(resolveCrash(createRng(outcome)));
  });

  it("rejects a hash that does not match the seed", async () => {
    const { hashValid } = await verifyCrashRound(
      "a".repeat(64),
      "11111111-1111-1111-1111-111111111111",
      "f".repeat(64),
    );
    expect(hashValid).toBe(false);
  });
});

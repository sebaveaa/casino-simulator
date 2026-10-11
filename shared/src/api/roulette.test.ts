import { describe, expect, it } from "vitest";
import { fairnessSchema, rouletteBetRequestSchema, rouletteBetResponseSchema } from "./roulette";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const fairness = {
  seedPairId: uuid,
  serverSeedHash: "a".repeat(64),
  clientSeed: "my-seed",
  nonce: 0,
};

describe("rouletteBetRequestSchema", () => {
  it("accepts a stake with a selection", () => {
    const body = { stake: "100", selection: { type: "color", color: "red" } };
    expect(rouletteBetRequestSchema.parse(body)).toEqual(body);
  });

  it("rejects a zero stake and an invalid selection", () => {
    const selection = { type: "color", color: "red" };
    expect(rouletteBetRequestSchema.safeParse({ stake: "0", selection }).success).toBe(false);
    expect(
      rouletteBetRequestSchema.safeParse({
        stake: "1",
        selection: { type: "straight", number: 37 },
      }).success,
    ).toBe(false);
  });
});

describe("fairnessSchema", () => {
  it("rejects a malformed server seed hash and a negative nonce", () => {
    for (const serverSeedHash of ["abc", "A".repeat(64), "g".repeat(64)]) {
      expect(fairnessSchema.safeParse({ ...fairness, serverSeedHash }).success).toBe(false);
    }
    expect(fairnessSchema.safeParse({ ...fairness, nonce: -1 }).success).toBe(false);
  });
});

describe("rouletteBetResponseSchema", () => {
  it("accepts a full response and rejects a bad bet id", () => {
    const body = {
      betId: uuid,
      result: { number: 17 },
      payout: "200",
      balance: "1100",
      fairness,
    };
    expect(rouletteBetResponseSchema.parse(body)).toEqual(body);
    expect(rouletteBetResponseSchema.safeParse({ ...body, betId: "nope" }).success).toBe(false);
  });
});

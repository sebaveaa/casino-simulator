import { describe, expect, it } from "vitest";
import {
  rotateSeedPairResponseSchema,
  seedPairResponseSchema,
  setClientSeedRequestSchema,
} from "./seed-pair";

const hash = "a".repeat(64);
const id = "11111111-1111-4111-8111-111111111111";

describe("seed pair schemas", () => {
  it("accepts a client seed of 1 to 64 characters", () => {
    expect(setClientSeedRequestSchema.safeParse({ clientSeed: "x" }).success).toBe(true);
    expect(setClientSeedRequestSchema.safeParse({ clientSeed: "x".repeat(64) }).success).toBe(true);
  });

  it.each(["", "x".repeat(65)])("rejects the client seed of length %#", (clientSeed) => {
    expect(setClientSeedRequestSchema.safeParse({ clientSeed }).success).toBe(false);
  });

  it("requires a lowercase hex server seed hash", () => {
    const pair = { id, serverSeedHash: hash, clientSeed: "c", nextNonce: 0 };
    expect(seedPairResponseSchema.safeParse(pair).success).toBe(true);
    expect(seedPairResponseSchema.safeParse({ ...pair, serverSeedHash: "ABC" }).success).toBe(
      false,
    );
  });

  it("parses a rotation result", () => {
    const active = { id, serverSeedHash: hash, clientSeed: "c", nextNonce: 0 };
    const revealed = {
      id,
      serverSeed: "secret",
      serverSeedHash: hash,
      clientSeed: "c",
      revealedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(rotateSeedPairResponseSchema.safeParse({ revealed, active }).success).toBe(true);
  });
});

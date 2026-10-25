import { describe, expect, it } from "vitest";
import { type RaceRoundRow, toRaceRound } from "./rounds";

const resolvedRow: RaceRoundRow = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "resolved",
  opens_at: new Date("2026-10-19T10:00:00.000Z"),
  closes_at: new Date("2026-10-19T10:00:30.000Z"),
  server_seed_hash: "a".repeat(64),
  server_seed: "seed",
  result: { winner: 3, order: [3, 0, 1, 4, 2] },
  resolved_at: new Date("2026-10-19T10:00:31.000Z"),
};

describe("toRaceRound", () => {
  it("includes the seed, result and settlesAt once resolved", () => {
    const round = toRaceRound(resolvedRow, 10_000);
    expect(round.serverSeed).toBe("seed");
    expect(round.settlesAt).toBe("2026-10-19T10:00:41.000Z");
  });

  it("hides the seed and result while open", () => {
    const round = toRaceRound(
      { ...resolvedRow, status: "open", server_seed: null, result: null, resolved_at: null },
      10_000,
    );
    expect(round.serverSeed).toBeUndefined();
    expect(round.result).toBeUndefined();
  });

  it("throws on a resolved or settled row missing its seed, result or resolved_at", () => {
    for (const status of ["resolved", "settled"] as const) {
      for (const broken of [{ server_seed: null }, { result: null }, { resolved_at: null }]) {
        expect(() => toRaceRound({ ...resolvedRow, status, ...broken }, 10_000)).toThrow();
      }
    }
  });
});

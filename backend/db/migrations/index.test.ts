import { describe, expect, it } from "vitest";
import { migrations } from "./index";

describe("migrations", () => {
  it("registers zero-padded names that sort in run order", () => {
    const names = Object.keys(migrations);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^\d{4}_[a-z0-9_]+$/);
    expect(names).toEqual([...names].sort());
  });

  it("registers the race round columns migration", () => {
    expect(Object.keys(migrations)).toContain("0005_race_rounds");
  });

  it("registers the race current-round index migration", () => {
    expect(Object.keys(migrations)).toContain("0006_race_current_index");
  });

  it("registers the race round partial indexes migration", () => {
    expect(Object.keys(migrations)).toContain("0007_race_round_partial_indexes");
  });

  it("registers the blackjack migration", () => {
    expect(Object.keys(migrations)).toContain("0008_blackjack");
  });

  it("gives every migration an up and a down", () => {
    for (const migration of Object.values(migrations)) {
      expect(migration.up).toBeTypeOf("function");
      expect(migration.down).toBeTypeOf("function");
    }
  });
});

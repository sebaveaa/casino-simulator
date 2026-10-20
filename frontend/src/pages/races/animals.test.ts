import { ANIMAL_COUNT } from "@casino/shared";
import { describe, expect, it } from "vitest";
import { animals } from "./animals";

describe("animals", () => {
  it("has one entry per lane with ids 0..4", () => {
    expect(animals).toHaveLength(ANIMAL_COUNT);
    expect(animals.map((a) => a.id)).toEqual([0, 1, 2, 3, 4]);
  });
  it("has distinct names and colors", () => {
    expect(new Set(animals.map((a) => a.name)).size).toBe(animals.length);
    expect(new Set(animals.map((a) => a.color)).size).toBe(animals.length);
  });
});

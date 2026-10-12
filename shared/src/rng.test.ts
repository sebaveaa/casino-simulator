import { describe, expect, it } from "vitest";
import { NotImplementedError } from "./not-implemented";
import { computeOutcome, createRng, hashServerSeed } from "./rng";

describe("RNG stubs", () => {
  it("computeOutcome rejects with NotImplementedError for #11", async () => {
    const seed = { serverSeed: "s", clientSeed: "c", nonce: 0 };
    await expect(computeOutcome(seed)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(computeOutcome(seed)).rejects.toThrow("#11");
  });

  it("hashServerSeed rejects with NotImplementedError for #11", async () => {
    await expect(hashServerSeed("s")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(hashServerSeed("s")).rejects.toThrow("#11");
  });

  it("createRng throws NotImplementedError for #11", () => {
    expect(() => createRng("0".repeat(64))).toThrow(NotImplementedError);
    expect(() => createRng("0".repeat(64))).toThrow("#11");
  });
});

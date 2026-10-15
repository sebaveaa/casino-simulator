import { describe, expect, it } from "vitest";
import { computeOutcome, createRng, hashServerSeed, sha256Sync } from "./rng";

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data)));
}

describe("HMAC-SHA256 through Web Crypto (RFC 4231)", () => {
  // The primitive computeOutcome relies on, checked against the RFC 4231 test cases.
  it("test case 1", async () => {
    expect(await hmacHex(new Uint8Array(20).fill(0x0b), encoder.encode("Hi There"))).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  it("test case 2", async () => {
    expect(
      await hmacHex(encoder.encode("Jefe"), encoder.encode("what do ya want for nothing?")),
    ).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });

  it("test case 3", async () => {
    expect(await hmacHex(new Uint8Array(20).fill(0xaa), new Uint8Array(50).fill(0xdd))).toBe(
      "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    );
  });
});

describe("computeOutcome", () => {
  it("keys the HMAC with the server seed over `clientSeed:nonce`", async () => {
    const outcome = await computeOutcome({ serverSeed: "Jefe", clientSeed: "client", nonce: 7 });
    expect(outcome).toBe(await hmacHex(encoder.encode("Jefe"), encoder.encode("client:7")));
    expect(outcome).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches a fixed vector", async () => {
    expect(await computeOutcome({ serverSeed: "key", clientSeed: "client", nonce: 7 })).toBe(
      await hmacHex(encoder.encode("key"), encoder.encode("client:7")),
    );
  });

  it("changes with each input", async () => {
    const base = { serverSeed: "s", clientSeed: "c", nonce: 1 };
    const outcomes = new Set([
      await computeOutcome(base),
      await computeOutcome({ ...base, serverSeed: "t" }),
      await computeOutcome({ ...base, clientSeed: "d" }),
      await computeOutcome({ ...base, nonce: 2 }),
    ]);
    expect(outcomes.size).toBe(4);
  });

  it.each([-1, 1.5, Number.NaN, 2 ** 53])("rejects the nonce %s", async (nonce) => {
    await expect(computeOutcome({ serverSeed: "s", clientSeed: "c", nonce })).rejects.toThrow(
      RangeError,
    );
  });
});

describe("hashServerSeed", () => {
  it("matches the SHA-256 vector for 'abc'", async () => {
    expect(await hashServerSeed("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the SHA-256 vector for the empty string", async () => {
    expect(await hashServerSeed("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("sha256Sync", () => {
  it.each(["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000)])(
    "agrees with crypto.subtle for input %#",
    async (text) => {
      const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
      expect(hex(sha256Sync(encoder.encode(text)))).toBe(hex(expected));
    },
  );
});

describe("createRng", () => {
  const outcome = "00ff".repeat(16);

  it("is deterministic: the same outcome yields the same sequence", () => {
    const draw = (rng: ReturnType<typeof createRng>) =>
      Array.from({ length: 50 }, () => rng.int(37));
    expect(draw(createRng(outcome))).toEqual(draw(createRng(outcome)));
  });

  it("reads successive bit chunks of the outcome", () => {
    // 0x00 = 00000000, 0xff = 11111111. With max 16 each draw reads 4 bits.
    const rng = createRng(outcome);
    expect([rng.int(16), rng.int(16), rng.int(16), rng.int(16)]).toEqual([0, 0, 15, 15]);
  });

  it("rejects chunks outside the range instead of reducing them modulo max", () => {
    // max 10 reads 4 bits: 0000 -> 0, 0000 -> 0, 1111 and 1111 are rejected, 0000 -> 0.
    const rng = createRng(outcome);
    expect([rng.int(10), rng.int(10), rng.int(10)]).toEqual([0, 0, 0]);
  });

  it("returns 0 for max 1 without consuming bits", () => {
    const rng = createRng(outcome);
    expect(rng.int(1)).toBe(0);
    expect(rng.int(256)).toBe(0);
    expect(rng.int(256)).toBe(255);
  });

  it("keeps every value in [0, max)", () => {
    const rng = createRng("a3".repeat(32));
    for (const max of [2, 3, 6, 37, 52, 1000, 2 ** 31, 2 ** 40 + 1]) {
      for (let i = 0; i < 200; i++) {
        const value = rng.int(max);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(max);
      }
    }
  });

  it("supports Number.MAX_SAFE_INTEGER", () => {
    const rng = createRng("5c".repeat(32));
    for (let i = 0; i < 50; i++) {
      expect(rng.int(Number.MAX_SAFE_INTEGER)).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
  });

  it("extends deterministically past the 256 bits of the outcome", () => {
    const draw = () => {
      const rng = createRng(outcome);
      return Array.from({ length: 500 }, () => rng.int(6));
    };
    const first = draw();
    expect(first).toEqual(draw());
    expect(new Set(first)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("covers every value of a small range", () => {
    const rng = createRng("9e".repeat(32));
    const seen = new Set(Array.from({ length: 300 }, () => rng.int(6)));
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rejects max %s", (max) => {
    expect(() => createRng(outcome).int(max)).toThrow(RangeError);
  });

  it.each(["", "abc", "A".repeat(64), "0".repeat(63)])(
    "rejects the malformed outcome %#",
    (bad) => {
      expect(() => createRng(bad)).toThrow(RangeError);
    },
  );
});

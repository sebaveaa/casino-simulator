import { describe, expect, it, vi } from "vitest";
import { authResponseSchema, loginRequestSchema, registerRequestSchema } from "./auth";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("registerRequestSchema", () => {
  it("normalizes the email", () => {
    const parsed = registerRequestSchema.parse({
      email: "  Player@Example.COM ",
      password: "correct horse",
    });
    expect(parsed.email).toBe("player@example.com");
  });

  it("rejects a bad email and passwords outside 8..72", () => {
    expect(registerRequestSchema.safeParse({ email: "nope", password: "12345678" }).success).toBe(
      false,
    );
    for (const password of ["1234567", "a".repeat(73)]) {
      expect(registerRequestSchema.safeParse({ email: "a@b.co", password }).success).toBe(false);
    }
  });
});

// Each case is [password, accepted]; the byte count is in the label.
const byteCases: [string, string, boolean][] = [
  ["72 ASCII characters", "a".repeat(72), true],
  ["36 n-tilde (72 bytes)", "ñ".repeat(36), true],
  ["37 n-tilde (74 bytes)", "ñ".repeat(37), false],
  ["18 emoji (72 bytes)", "😀".repeat(18), true],
  ["18 emoji plus a (73 bytes)", `${"😀".repeat(18)}a`, false],
];

describe("password byte limit", () => {
  it.each(byteCases)("register: %s", (_label, password, accepted) => {
    expect(registerRequestSchema.safeParse({ email: "a@b.co", password }).success).toBe(accepted);
  });

  it.each(byteCases)("login: %s", (_label, password, accepted) => {
    expect(loginRequestSchema.safeParse({ email: "a@b.co", password }).success).toBe(accepted);
  });

  it("rejects a huge password without encoding it", () => {
    const spy = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      expect(
        loginRequestSchema.safeParse({ email: "a@b.co", password: "a".repeat(1_000_000) }).success,
      ).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("loginRequestSchema", () => {
  it("accepts a short password so a policy change cannot lock users out", () => {
    expect(loginRequestSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });

  it("rejects an empty or over-long password", () => {
    for (const password of ["", "a".repeat(73)]) {
      expect(loginRequestSchema.safeParse({ email: "a@b.co", password }).success).toBe(false);
    }
  });
});

describe("authResponseSchema", () => {
  it("accepts a token with a user", () => {
    const body = { token: "t", user: { id: uuid, email: "a@b.co", role: "player" } };
    expect(authResponseSchema.parse(body)).toEqual(body);
  });

  it("rejects a bad uuid, unknown role and empty token", () => {
    const user = { id: uuid, email: "a@b.co", role: "player" };
    expect(authResponseSchema.safeParse({ token: "t", user: { ...user, id: "x" } }).success).toBe(
      false,
    );
    expect(
      authResponseSchema.safeParse({ token: "t", user: { ...user, role: "root" } }).success,
    ).toBe(false);
    expect(authResponseSchema.safeParse({ token: "", user }).success).toBe(false);
  });
});

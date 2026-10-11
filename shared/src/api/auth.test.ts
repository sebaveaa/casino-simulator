import { describe, expect, it } from "vitest";
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

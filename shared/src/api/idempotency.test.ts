import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_KEY_HEADER, idempotencyKeySchema } from "./idempotency";

describe("idempotencyKeySchema", () => {
  it("accepts a UUID-shaped key", () => {
    expect(idempotencyKeySchema.safeParse("123e4567-e89b-42d3-a456-426614174000").success).toBe(
      true,
    );
  });

  it("rejects short, long, spaced and non-ASCII keys", () => {
    for (const key of ["short", "a".repeat(129), "has space in it", "clavé-ñandú-123"]) {
      expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
    }
  });

  it("uses a lowercase header name", () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe("idempotency-key");
  });
});

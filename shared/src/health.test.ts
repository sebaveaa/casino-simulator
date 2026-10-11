import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./health";

describe("healthResponseSchema", () => {
  it("accepts a valid ok body", () => {
    const body = { status: "ok", checks: { postgres: true, redis: true } };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it("accepts a degraded body", () => {
    const body = { status: "degraded", checks: { postgres: true, redis: false } };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it("rejects an unknown status", () => {
    const body = { status: "down", checks: { postgres: true, redis: true } };
    expect(healthResponseSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a missing check", () => {
    const body = { status: "ok", checks: { postgres: true } };
    expect(healthResponseSchema.safeParse(body).success).toBe(false);
  });
});

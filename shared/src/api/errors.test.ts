import { describe, expect, it } from "vitest";
import { errorResponseSchema } from "./errors";
import { apiPaths } from "./paths";

describe("errorResponseSchema", () => {
  it("accepts a known code with a message", () => {
    const body = { error: { code: "insufficient_funds", message: "Not enough credits" } };
    expect(errorResponseSchema.parse(body)).toEqual(body);
  });

  it("rejects an unknown code and a missing message", () => {
    expect(errorResponseSchema.safeParse({ error: { code: "teapot", message: "x" } }).success).toBe(
      false,
    );
    expect(errorResponseSchema.safeParse({ error: { code: "internal" } }).success).toBe(false);
  });
});

describe("apiPaths", () => {
  it("are absolute and unique", () => {
    const paths = Object.values(apiPaths);
    expect(paths.every((p) => p.startsWith("/"))).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

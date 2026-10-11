import { IDEMPOTENCY_KEY_HEADER } from "@casino/shared";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "./errors";
import { parseWith, readIdempotencyKey } from "./http";

const schema = z.object({ name: z.string().min(3), nested: z.object({ n: z.number() }) });

function requestWith(headers: Record<string, string | string[]>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe("parseWith", () => {
  it("returns the parsed value", () => {
    expect(parseWith(schema, { name: "abc", nested: { n: 1 } })).toEqual({
      name: "abc",
      nested: { n: 1 },
    });
  });

  it("throws invalid_request naming the paths but not the values", () => {
    try {
      parseWith(schema, { name: "ab", nested: { n: "oops" } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("invalid_request");
      expect(appError.statusCode).toBe(400);
      expect(appError.message).toContain("name");
      expect(appError.message).toContain("nested.n");
      expect(appError.message).not.toContain("oops");
    }
  });
});

describe("readIdempotencyKey", () => {
  it("returns a valid key", () => {
    const key = "0b1f6a52-8c1e-4e4a-9c43-3d2f6a1b7c9e";
    expect(readIdempotencyKey(requestWith({ [IDEMPOTENCY_KEY_HEADER]: key }))).toBe(key);
  });

  it("rejects a missing header", () => {
    expect(() => readIdempotencyKey(requestWith({}))).toThrow(/required/);
  });

  it("rejects a key that is too short", () => {
    const request = requestWith({ [IDEMPOTENCY_KEY_HEADER]: "short" });
    expect(() => readIdempotencyKey(request)).toThrow(/invalid/);
  });

  it("rejects a repeated header", () => {
    const request = requestWith({ [IDEMPOTENCY_KEY_HEADER]: ["aaaaaaaa", "bbbbbbbb"] });
    expect(() => readIdempotencyKey(request)).toThrow(AppError);
  });
});

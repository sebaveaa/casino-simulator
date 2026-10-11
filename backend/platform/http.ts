import { IDEMPOTENCY_KEY_HEADER, idempotencyKeySchema } from "@casino/shared";
import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { AppError } from "./errors";

/**
 * Parses `value` with a shared Zod schema. A failure becomes `invalid_request` whose message
 * lists the offending paths and reasons, never the input values.
 */
export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
  throw new AppError("invalid_request", `Invalid request: ${details}`);
}

/** Reads the `Idempotency-Key` header that bet and deposit endpoints require (README §3.3). */
export function readIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  if (typeof raw !== "string") {
    throw new AppError("invalid_request", "Idempotency-Key header is required");
  }
  const result = idempotencyKeySchema.safeParse(raw);
  if (!result.success) {
    throw new AppError("invalid_request", "Idempotency-Key header is invalid");
  }
  return result.data;
}

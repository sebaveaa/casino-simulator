import { z } from "zod";

/** Lowercase, as Node exposes request headers. */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/**
 * Required on bet and deposit endpoints (README §3.3). A retry with the same
 * key returns the original result and moves money once. 8 to 128 printable
 * ASCII characters without spaces; a `crypto.randomUUID()` fits.
 */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[\x21-\x7E]+$/, "Expected printable ASCII without spaces");

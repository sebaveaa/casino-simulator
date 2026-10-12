import { z } from "zod";

export const roleSchema = z.enum(["player", "admin"]);
export type Role = z.infer<typeof roleSchema>;

/** Trimmed and lowercased before validation, so lookups are case-insensitive. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** bcrypt ignores bytes past this limit, so longer passwords are rejected, not truncated. */
const MAX_PASSWORD_BYTES = 72;

// Every character is at least one byte, so a string longer than the limit is already too long:
// `.max` is the cheap check, and the refinement skips encoding because Zod 4 keeps running
// refinements after a failed check.
function withinPasswordBytes(value: string): boolean {
  if (value.length > MAX_PASSWORD_BYTES) return true;
  return new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES;
}

const passwordBytes = (schema: z.ZodString) =>
  schema
    .max(MAX_PASSWORD_BYTES, "Password is too long")
    .refine(withinPasswordBytes, "Password must be at most 72 UTF-8 bytes");

/** 8 to 72 UTF-8 bytes (bcrypt's limit). */
export const passwordSchema = passwordBytes(z.string().min(8));

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Login does not enforce the minimum, so a later password policy change cannot lock out users. */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: passwordBytes(z.string().min(1)),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  id: z.uuid(),
  email: emailSchema,
  role: roleSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  token: z.string().min(1),
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

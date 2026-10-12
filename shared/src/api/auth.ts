import { z } from "zod";

export const roleSchema = z.enum(["player", "admin"]);
export type Role = z.infer<typeof roleSchema>;

/** Trimmed and lowercased before validation, so lookups are case-insensitive. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Max 72: bcrypt ignores bytes past that limit. */
export const passwordSchema = z.string().min(8).max(72);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Login does not enforce the minimum, so a later password policy change cannot lock out users. */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
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

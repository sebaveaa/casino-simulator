import type { Role } from "@casino/shared";

export type AuthUser = { id: string; role: Role };

/** Issues and checks the bearer tokens of README §8. Implemented by #9. */
export interface TokenService {
  sign(user: AuthUser): Promise<string>;
  /** Rejects on an invalid or expired token. */
  verify(token: string): Promise<AuthUser>;
}

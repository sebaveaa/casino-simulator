import type { Role } from "@casino/shared";

export type AuthUser = { id: string; role: Role };

/** A malformed, forged or expired token. The auth guard answers it with 401. */
export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

/** Issues and checks the bearer tokens of README §8. Implemented by #9. */
export interface TokenService {
  sign(user: AuthUser): Promise<string>;
  /**
   * Throws `InvalidTokenError` for a malformed, forged or expired token. Any other error means an
   * infrastructure failure (for example, the database is down); the guard does not turn it into 401.
   */
  verify(token: string): Promise<AuthUser>;
}

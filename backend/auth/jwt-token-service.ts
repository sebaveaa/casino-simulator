import { type Role, roleSchema } from "@casino/shared";
import { jwtVerify, SignJWT } from "jose";
import { type AuthUser, InvalidTokenError, type TokenService } from "./token-service";

export type JwtTokenOptions = {
  /** HS256 key material; `loadConfig` guarantees at least 32 characters. */
  secret: string;
  /** Lifetime of a new token. Defaults to one hour. */
  expiresInSeconds?: number;
  /** The clock for `iat`, `exp` and verification; tests inject a fixed one. */
  now?: () => Date;
};

const ALGORITHM = "HS256";
export const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Bearer tokens of README §8: HS256 JWTs with `sub` = user id and a `role` claim. `verify` turns
 * every `jose` failure and every unexpected claim into `InvalidTokenError`, so the guard answers 401.
 */
export function createJwtTokenService({
  secret,
  expiresInSeconds = DEFAULT_TOKEN_TTL_SECONDS,
  now = () => new Date(),
}: JwtTokenOptions): TokenService {
  const key = new TextEncoder().encode(secret);

  return {
    async sign(user: AuthUser): Promise<string> {
      const issuedAt = Math.floor(now().getTime() / 1000);
      return new SignJWT({ role: user.role })
        .setProtectedHeader({ alg: ALGORITHM })
        .setSubject(user.id)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + expiresInSeconds)
        .sign(key);
    },

    async verify(token: string): Promise<AuthUser> {
      let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
      try {
        // `exp` is required: a token that never expires is rejected.
        ({ payload } = await jwtVerify(token, key, {
          algorithms: [ALGORITHM],
          currentDate: now(),
          requiredClaims: ["sub", "exp"],
        }));
      } catch (error) {
        throw new InvalidTokenError(error instanceof Error ? error.message : undefined);
      }
      const role = roleSchema.safeParse(payload.role);
      if (!role.success || !payload.sub) throw new InvalidTokenError("Unexpected token claims");
      const verified: { id: string; role: Role } = { id: payload.sub, role: role.data };
      return verified;
    },
  };
}

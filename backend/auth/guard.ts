import type { Role } from "@casino/shared";
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { AppError } from "../platform/errors";
import { type AuthUser, InvalidTokenError, type TokenService } from "./token-service";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireAuth`. Named `auth`, not `user`, to avoid clashing with JWT plugins. */
    auth?: AuthUser;
  }
}

export type RequireAuth = (...roles: Role[]) => preHandlerAsyncHookHandler;

/**
 * Builds `requireAuth(...roles)`, a `preHandler` that checks the bearer token (README §8) and,
 * when roles are given, that the user has one of them.
 */
export function createAuthGuard(tokens: TokenService): RequireAuth {
  return (...roles) =>
    async (request) => {
      const header = request.headers.authorization;
      const match = typeof header === "string" ? /^Bearer (\S+)$/.exec(header) : null;
      if (!match?.[1]) throw new AppError("unauthorized", "Missing or malformed bearer token");

      let user: AuthUser;
      try {
        user = await tokens.verify(match[1]);
      } catch (error) {
        // Only a bad token is the client's problem; anything else (including
        // `NotImplementedError`) goes to the error handler, which logs it.
        if (error instanceof InvalidTokenError) {
          throw new AppError("unauthorized", "Invalid or expired token");
        }
        throw error;
      }

      if (roles.length > 0 && !roles.includes(user.role)) {
        throw new AppError("forbidden", "Insufficient permissions");
      }
      request.auth = user;
    };
}

/** The authenticated user of a request that went through `requireAuth`. */
export function getAuth(request: FastifyRequest): AuthUser {
  if (!request.auth) throw new AppError("unauthorized", "Authentication required");
  return request.auth;
}

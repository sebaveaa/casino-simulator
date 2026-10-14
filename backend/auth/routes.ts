import {
  type AuthResponse,
  apiPaths,
  loginRequestSchema,
  type Role,
  registerRequestSchema,
} from "@casino/shared";
import { AppError } from "../platform/errors";
import { parseWith } from "../platform/http";
import type { ModuleRoutes } from "../platform/routes";
import { hashPassword, verifyAgainstUnknownUser, verifyPassword } from "./password-hasher";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === PG_UNIQUE_VIOLATION
  );
}

function invalidCredentials(): AppError {
  // One message for an unknown email and a wrong password: no user enumeration.
  return new AppError("unauthorized", "Invalid email or password");
}

export const authRoutes: ModuleRoutes = async (app, { db, services }) => {
  const { wallet, tokens } = services;

  async function session(user: { id: string; email: string; role: Role }): Promise<AuthResponse> {
    return { token: await tokens.sign({ id: user.id, role: user.role }), user };
  }

  app.post(apiPaths.register, async (request, reply) => {
    const { email, password } = parseWith(registerRequestSchema, request.body);
    const passwordHash = await hashPassword(password);

    // The user and its wallet commit together, so a failed wallet never leaves a user without one.
    let user: { id: string; email: string; role: Role };
    try {
      user = await db.transaction().execute(async (trx) => {
        const row = await trx
          .insertInto("users")
          .values({ email, password_hash: passwordHash })
          .returning(["id", "email", "role"])
          .executeTakeFirstOrThrow();
        await wallet.createPlayerWallet(trx, row.id);
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "An account with this email already exists");
      }
      throw error;
    }
    return reply.code(201).send(await session(user));
  });

  app.post(apiPaths.login, async (request) => {
    const { email, password } = parseWith(loginRequestSchema, request.body);
    const user = await db
      .selectFrom("users")
      .select(["id", "email", "role", "password_hash"])
      .where("email", "=", email)
      .executeTakeFirst();

    const valid = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyAgainstUnknownUser(password);
    if (!user || !valid) throw invalidCredentials();
    return session({ id: user.id, email: user.email, role: user.role });
  });
};

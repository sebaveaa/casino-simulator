import { randomUUID } from "node:crypto";
import {
  apiPaths,
  authResponseSchema,
  balanceResponseSchema,
  errorResponseSchema,
} from "@casino/shared";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../db/database";
import { buildApp } from "../platform/app";
import { postgresTypes } from "../platform/postgres";
import { type Services, stubServices } from "../platform/services";
import { postgresWalletService } from "../wallet/postgres-wallet-service";
import { createJwtTokenService } from "./jwt-token-service";

const config = {
  appEnv: "production" as const,
  allowedOrigins: [],
  raceDurationMs: 10_000,
  raceMinStake: 1n,
  raceMaxStake: 1000n,
};
const checks = { postgres: async () => true, redis: async () => true };
const secret = "a-test-secret-that-is-at-least-32-characters";
const password = "correct horse battery";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function build(db: Db, overrides: Partial<Services> = {}): Promise<FastifyInstance> {
  const app = await buildApp({
    config,
    checks,
    db,
    services: {
      ...stubServices,
      wallet: postgresWalletService,
      tokens: createJwtTokenService({ secret }),
      ...overrides,
    },
  });
  apps.push(app);
  return app;
}

const post = (app: FastifyInstance, url: string, payload: object) =>
  app.inject({ method: "POST", url, payload });

describe("auth routes (validation)", () => {
  // Validation fails before any query, so no database is needed.
  it.each([
    ["register", apiPaths.register, { email: "not-an-email", password }],
    ["register", apiPaths.register, { email: "a@test.local", password: "short" }],
    ["register", apiPaths.register, {}],
    ["login", apiPaths.login, { email: "a@test.local" }],
    ["login", apiPaths.login, { email: "", password }],
  ])("rejects an invalid %s body with 400", async (_name, url, payload) => {
    const app = await build({} as Db);
    const res = await post(app, url, payload);
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
    expect(res.body).not.toContain(password);
  });
});

// End to end against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md).
describe.skipIf(!process.env.TEST_DATABASE_URL)("auth routes (PostgreSQL)", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const newEmail = () => `${randomUUID()}@test.local`;

  it("registers a player with a hashed password, a wallet and a working token", async () => {
    const app = await build(db);
    const email = newEmail();
    const res = await post(app, apiPaths.register, { email, password });
    expect(res.statusCode).toBe(201);
    const { token, user } = authResponseSchema.parse(res.json());
    expect(user).toMatchObject({ email, role: "player" });

    const row = await db
      .selectFrom("users")
      .select("password_hash")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    expect(row.password_hash).not.toContain(password);
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);

    const balance = await app.inject({
      method: "GET",
      url: apiPaths.balance,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(balance.statusCode).toBe(200);
    expect(balanceResponseSchema.parse(balance.json())).toEqual({ balance: "0" });
  });

  it("answers 409 for a duplicate email, whatever its case, and keeps one user", async () => {
    const app = await build(db);
    const email = newEmail();
    expect((await post(app, apiPaths.register, { email, password })).statusCode).toBe(201);
    const again = await post(app, apiPaths.register, { email: email.toUpperCase(), password });
    expect(again.statusCode).toBe(409);
    expect(errorResponseSchema.parse(again.json()).error.code).toBe("conflict");
    const users = await db.selectFrom("users").select("id").where("email", "=", email).execute();
    expect(users).toHaveLength(1);
  });

  it("rolls the user back when the wallet cannot be created", async () => {
    const app = await build(db, {
      wallet: {
        ...postgresWalletService,
        createPlayerWallet: async () => {
          throw new Error("wallet down");
        },
      },
    });
    const email = newEmail();
    const res = await post(app, apiPaths.register, { email, password });
    expect(res.statusCode).toBe(500);
    const users = await db.selectFrom("users").select("id").where("email", "=", email).execute();
    expect(users).toHaveLength(0);
  });

  it("logs in with the right password and returns a token for that user", async () => {
    const app = await build(db);
    const email = newEmail();
    const registered = authResponseSchema.parse(
      (await post(app, apiPaths.register, { email, password })).json(),
    );
    const res = await post(app, apiPaths.login, { email: email.toUpperCase(), password });
    expect(res.statusCode).toBe(200);
    const login = authResponseSchema.parse(res.json());
    expect(login.user).toEqual(registered.user);
    const verified = await createJwtTokenService({ secret }).verify(login.token);
    expect(verified).toEqual({ id: registered.user.id, role: "player" });
  });

  it("answers the same 401 for a wrong password and an unknown email", async () => {
    const app = await build(db);
    const email = newEmail();
    await post(app, apiPaths.register, { email, password });
    const wrong = await post(app, apiPaths.login, { email, password: "wrong password" });
    const unknown = await post(app, apiPaths.login, { email: newEmail(), password });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    expect(errorResponseSchema.parse(wrong.json()).error.code).toBe("unauthorized");
  });
});

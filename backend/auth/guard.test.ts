import { errorResponseSchema, NotImplementedError } from "@casino/shared";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "../db/database";
import { buildApp } from "../platform/app";
import { createLogger } from "../platform/logger";
import { stubServices } from "../platform/services";
import { getAuth } from "./guard";
import { type AuthUser, InvalidTokenError, type TokenService } from "./token-service";

const player: AuthUser = { id: "11111111-1111-4111-8111-111111111111", role: "player" };

function fakeTokens(verify: TokenService["verify"]): TokenService {
  return { sign: async () => "token", verify };
}

const apps: FastifyInstance[] = [];
async function build(
  verify: TokenService["verify"],
  logger?: FastifyBaseLogger,
): Promise<FastifyInstance> {
  const app = await buildApp({
    logger,
    config: {
      appEnv: "production",
      allowedOrigins: [],
      raceDurationMs: 10_000,
      raceMinStake: 1n,
      raceMaxStake: 1000n,
    },
    checks: { postgres: async () => true, redis: async () => true },
    db: {} as Db,
    services: { ...stubServices, tokens: fakeTokens(verify) },
    routes: [
      async (instance, { requireAuth }) => {
        instance.get("/t/any", { preHandler: requireAuth() }, async (request) => getAuth(request));
        instance.get("/t/admin", { preHandler: requireAuth("admin") }, async () => ({ ok: true }));
        instance.get("/t/unguarded", async (request) => getAuth(request));
      },
    ],
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const bearer = { authorization: "Bearer good-token" };

describe("requireAuth", () => {
  it("rejects a missing authorization header with 401", async () => {
    const app = await build(async () => player);
    const res = await app.inject({ method: "GET", url: "/t/any" });
    expect(res.statusCode).toBe(401);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("unauthorized");
  });

  it("rejects a non-Bearer scheme with 401", async () => {
    const app = await build(async () => player);
    const res = await app.inject({
      method: "GET",
      url: "/t/any",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid token with 401", async () => {
    const app = await build(async () => {
      throw new InvalidTokenError("jwt expired");
    });
    const res = await app.inject({ method: "GET", url: "/t/any", headers: bearer });
    expect(res.statusCode).toBe(401);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("unauthorized");
    expect(res.body).not.toContain("jwt expired");
  });

  it("answers 500 and logs when verification fails for another reason", async () => {
    const lines: string[] = [];
    const logger = createLogger(
      { appEnv: "production" },
      { write: (line: string) => void lines.push(line) },
    );
    const app = await build(async () => {
      throw new Error("database is down");
    }, logger);
    const res = await app.inject({ method: "GET", url: "/t/any", headers: bearer });
    expect(res.statusCode).toBe(500);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("internal");
    expect(res.body).not.toContain("database is down");
    const entries = lines.map((line) => JSON.parse(line));
    expect(
      entries.some((e) => e.msg === "unhandled error" && e.err?.message === "database is down"),
    ).toBe(true);
  });

  it("surfaces a not-implemented verifier as 501", async () => {
    const app = await build(async () => {
      throw new NotImplementedError("verify", "#9");
    });
    const res = await app.inject({ method: "GET", url: "/t/any", headers: bearer });
    expect(res.statusCode).toBe(501);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("not_implemented");
  });

  it("rejects a user without a required role with 403", async () => {
    const app = await build(async () => player);
    const res = await app.inject({ method: "GET", url: "/t/admin", headers: bearer });
    expect(res.statusCode).toBe(403);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("forbidden");
  });

  it("lets a user with an accepted role through", async () => {
    const app = await build(async () => ({ ...player, role: "admin" }));
    const res = await app.inject({ method: "GET", url: "/t/admin", headers: bearer });
    expect(res.statusCode).toBe(200);
  });

  it("exposes the verified user through getAuth", async () => {
    const app = await build(async (token) => {
      expect(token).toBe("good-token");
      return player;
    });
    const res = await app.inject({ method: "GET", url: "/t/any", headers: bearer });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(player);
  });
});

describe("getAuth", () => {
  it("throws unauthorized when the route skipped the guard", async () => {
    const app = await build(async () => player);
    const res = await app.inject({ method: "GET", url: "/t/unguarded" });
    expect(res.statusCode).toBe(401);
  });
});

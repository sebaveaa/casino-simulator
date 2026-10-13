import { errorResponseSchema } from "@casino/shared";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { Db } from "../db/database";
import { buildApp } from "../platform/app";
import { stubServices } from "../platform/services";
import { getAuth } from "./guard";
import { createJwtTokenService } from "./jwt-token-service";
import { type AuthUser, InvalidTokenError } from "./token-service";

const secret = "a-test-secret-that-is-at-least-32-characters";
const user: AuthUser = { id: "11111111-1111-4111-8111-111111111111", role: "player" };

function clock(start = Date.UTC(2026, 0, 1)) {
  let current = start;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const encode = (value: string) => new TextEncoder().encode(value);

describe("JwtTokenService", () => {
  it("round-trips the user id and role", async () => {
    const tokens = createJwtTokenService({ secret });
    for (const role of ["player", "admin"] as const) {
      const token = await tokens.sign({ ...user, role });
      expect(await tokens.verify(token)).toEqual({ ...user, role });
    }
  });

  it("rejects an expired token", async () => {
    const time = clock();
    const tokens = createJwtTokenService({ secret, expiresInSeconds: 60, now: time.now });
    const token = await tokens.sign(user);
    time.advance(59_000);
    await expect(tokens.verify(token)).resolves.toEqual(user);
    time.advance(2_000);
    await expect(tokens.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rejects a token signed with another secret", async () => {
    const forged = await createJwtTokenService({ secret: `${secret}-other` }).sign(user);
    await expect(createJwtTokenService({ secret }).verify(forged)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it.each(["", "not-a-jwt", "a.b.c"])("rejects the malformed token %j", async (token) => {
    await expect(createJwtTokenService({ secret }).verify(token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects an unsigned token (alg none)", async () => {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = part({ alg: "none", typ: "JWT" });
    const claims = part({ sub: user.id, role: "admin", exp: 9999999999 });
    await expect(
      createJwtTokenService({ secret }).verify(`${header}.${claims}.`),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rejects a validly signed token with no expiry, no subject or an unknown role", async () => {
    const sign = (claims: Record<string, unknown>, expires: boolean) => {
      const jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" });
      if (expires) jwt.setExpirationTime("1h");
      return jwt.sign(encode(secret));
    };
    const tokens = createJwtTokenService({ secret });
    const bad = [
      await sign({ sub: user.id, role: "player" }, false),
      await sign({ role: "player" }, true),
      await sign({ sub: user.id, role: "superuser" }, true),
      await sign({ sub: user.id }, true),
    ];
    for (const token of bad) {
      await expect(tokens.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
    }
  });
});

describe("requireAuth with the JWT service", () => {
  async function build() {
    const time = clock();
    const tokens = createJwtTokenService({ secret, expiresInSeconds: 60, now: time.now });
    const app = await buildApp({
      config: { appEnv: "production", allowedOrigins: [] },
      checks: { postgres: async () => true, redis: async () => true },
      db: {} as Db,
      services: { ...stubServices, tokens },
      routes: [
        async (instance, { requireAuth }) => {
          instance.get("/t/any", { preHandler: requireAuth() }, async (r) => getAuth(r));
          instance.get("/t/admin", { preHandler: requireAuth("admin") }, async () => ({ ok: 1 }));
        },
      ],
    });
    return { app, tokens, time };
  }
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  it("accepts a valid token and answers 401 for forged and expired ones", async () => {
    const { app, tokens, time } = await build();
    const token = await tokens.sign(user);
    const ok = await app.inject({ method: "GET", url: "/t/any", headers: bearer(token) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual(user);

    const forged = await createJwtTokenService({ secret: `${secret}-x` }).sign(user);
    const forgedRes = await app.inject({ method: "GET", url: "/t/any", headers: bearer(forged) });
    expect(forgedRes.statusCode).toBe(401);

    time.advance(61_000);
    const expired = await app.inject({ method: "GET", url: "/t/any", headers: bearer(token) });
    expect(expired.statusCode).toBe(401);
    expect(errorResponseSchema.parse(expired.json()).error.code).toBe("unauthorized");
    await app.close();
  });

  it("answers 403 to a player on an admin route and 200 to an admin", async () => {
    const { app, tokens } = await build();
    const asPlayer = await app.inject({
      method: "GET",
      url: "/t/admin",
      headers: bearer(await tokens.sign(user)),
    });
    expect(asPlayer.statusCode).toBe(403);
    const asAdmin = await app.inject({
      method: "GET",
      url: "/t/admin",
      headers: bearer(await tokens.sign({ ...user, role: "admin" })),
    });
    expect(asAdmin.statusCode).toBe(200);
    await app.close();
  });
});

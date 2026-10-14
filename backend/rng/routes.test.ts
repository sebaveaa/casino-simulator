import { randomUUID } from "node:crypto";
import {
  apiPaths,
  errorResponseSchema,
  hashServerSeed,
  rotateSeedPairResponseSchema,
  seedPairResponseSchema,
} from "@casino/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../auth/token-service";
import type { Db } from "../db/database";
import { buildApp } from "../platform/app";
import { stubServices } from "../platform/services";
import type { ActiveSeedPair, SeedPairService } from "./seed-pair-service";

const config = { appEnv: "production" as const, allowedOrigins: [] };
const checks = { postgres: async () => true, redis: async () => true };
const userId = "11111111-1111-4111-8111-111111111111";
const auth = { authorization: `Bearer ${userId}` };

function fakeTokens(known: string[]): TokenService {
  return {
    sign: async () => "token",
    verify: async (token): Promise<AuthUser> => {
      if (!known.includes(token)) throw new InvalidTokenError();
      return { id: token, role: "player" };
    },
  };
}

/** In-memory seed pairs: enough behavior for the route tests, no database. */
function fakeSeedPairs(): SeedPairService {
  let serverSeed = "server-seed-1";
  let active: ActiveSeedPair | undefined;
  const create = async (clientSeed: string): Promise<ActiveSeedPair> => ({
    id: randomUUID(),
    serverSeedHash: await hashServerSeed(serverSeed),
    clientSeed,
    nextNonce: 0,
  });
  return {
    getActive: async () => {
      active ??= await create("default-client-seed");
      return active;
    },
    draw: async () => {
      throw new Error("not used by these routes");
    },
    setClientSeed: async (_db, _user, clientSeed) => {
      active ??= await create(clientSeed);
      active = { ...active, clientSeed };
      return active;
    },
    rotate: async () => {
      active ??= await create("default-client-seed");
      const revealed = {
        id: active.id,
        serverSeed,
        serverSeedHash: active.serverSeedHash,
        clientSeed: active.clientSeed,
        revealedAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      serverSeed = "server-seed-2";
      active = await create(active.clientSeed);
      return { revealed, active };
    },
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function build() {
  // The fake service ignores the executor, so a transaction just runs its callback.
  const db = { transaction: () => ({ execute: (fn: (trx: Db) => unknown) => fn(db) }) } as Db;
  const app = await buildApp({
    config,
    checks,
    db,
    services: { ...stubServices, seedPairs: fakeSeedPairs(), tokens: fakeTokens([userId]) },
  });
  apps.push(app);
  return app;
}

describe("seed pair routes", () => {
  it("answers 401 without a valid token on every route", async () => {
    const app = await build();
    for (const [method, url] of [
      ["GET", apiPaths.seedPair],
      ["PUT", apiPaths.seedPairClientSeed],
      ["POST", apiPaths.seedPairRotate],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      const forged = await app.inject({ method, url, headers: { authorization: "Bearer nobody" } });
      expect(forged.statusCode).toBe(401);
    }
  });

  it("shows the hash of the server seed and never the seed itself", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: apiPaths.seedPair, headers: auth });
    expect(res.statusCode).toBe(200);
    const pair = seedPairResponseSchema.parse(res.json());
    expect(pair.serverSeedHash).toBe(await hashServerSeed("server-seed-1"));
    expect(pair.nextNonce).toBe(0);
    expect(res.body).not.toContain("server-seed-1");
    expect(Object.keys(res.json())).not.toContain("serverSeed");
  });

  it("sets the client seed", async () => {
    const app = await build();
    const res = await app.inject({
      method: "PUT",
      url: apiPaths.seedPairClientSeed,
      headers: auth,
      payload: { clientSeed: "my-seed" },
    });
    expect(res.statusCode).toBe(200);
    expect(seedPairResponseSchema.parse(res.json()).clientSeed).toBe("my-seed");
    const current = await app.inject({ method: "GET", url: apiPaths.seedPair, headers: auth });
    expect(seedPairResponseSchema.parse(current.json()).clientSeed).toBe("my-seed");
  });

  it.each([{}, { clientSeed: "" }, { clientSeed: "x".repeat(65) }, { clientSeed: 5 }])(
    "rejects the invalid client seed body %j",
    async (payload) => {
      const app = await build();
      const res = await app.inject({
        method: "PUT",
        url: apiPaths.seedPairClientSeed,
        headers: auth,
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
    },
  );

  it("rotates: reveals the previous server seed and shows the new hash", async () => {
    const app = await build();
    const before = seedPairResponseSchema.parse(
      (await app.inject({ method: "GET", url: apiPaths.seedPair, headers: auth })).json(),
    );
    const res = await app.inject({ method: "POST", url: apiPaths.seedPairRotate, headers: auth });
    expect(res.statusCode).toBe(200);
    const { revealed, active } = rotateSeedPairResponseSchema.parse(res.json());
    expect(revealed.id).toBe(before.id);
    expect(revealed.serverSeed).toBe("server-seed-1");
    expect(await hashServerSeed(revealed.serverSeed)).toBe(before.serverSeedHash);
    expect(active.id).not.toBe(before.id);
    expect(active.serverSeedHash).toBe(await hashServerSeed("server-seed-2"));
    expect(res.body).not.toContain("server-seed-2");
  });
});

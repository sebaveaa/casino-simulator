import { randomUUID } from "node:crypto";
import {
  apiPaths,
  errorResponseSchema,
  type RouletteBetResponse,
  rouletteBetResponseSchema,
} from "@casino/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../../auth/token-service";
import type { Db } from "../../db/database";
import { buildApp } from "../../platform/app";
import { stubServices } from "../../platform/services";
import { placeRouletteBet } from "./place-bet";

// The bet flow itself runs against PostgreSQL (place-bet.integration.test.ts); here the route
// only has to validate the request and hand it over.
vi.mock("./place-bet", () => ({ placeRouletteBet: vi.fn() }));

const config = { appEnv: "production" as const, allowedOrigins: [] };
const checks = { postgres: async () => true, redis: async () => true };
const userId = "11111111-1111-4111-8111-111111111111";

function fakeTokens(known: string[]): TokenService {
  return {
    sign: async () => "token",
    verify: async (token): Promise<AuthUser> => {
      if (!known.includes(token)) throw new InvalidTokenError();
      return { id: token, role: "player" };
    },
  };
}

const response: RouletteBetResponse = {
  betId: randomUUID(),
  result: { number: 7 },
  payout: "0",
  balance: "900",
  fairness: {
    seedPairId: randomUUID(),
    serverSeedHash: "a".repeat(64),
    clientSeed: "client",
    nonce: 0,
  },
};

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.mocked(placeRouletteBet).mockReset();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function build() {
  const db = { transaction: () => ({ execute: (fn: (trx: Db) => unknown) => fn(db) }) } as Db;
  const app = await buildApp({
    config,
    checks,
    db,
    services: { ...stubServices, tokens: fakeTokens([userId]) },
  });
  apps.push(app);
  return app;
}

const validBody = { stake: "100", selection: { type: "color", color: "red" } };

function bet(app: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: apiPaths.rouletteBets,
    headers: { authorization: `Bearer ${userId}`, ...headers },
    payload: payload as object,
  });
}

describe("roulette bet route", () => {
  it("answers 401 without a valid token", async () => {
    const app = await build();
    const missing = await app.inject({ method: "POST", url: apiPaths.rouletteBets });
    expect(missing.statusCode).toBe(401);
    const forged = await bet(app, validBody, { authorization: "Bearer nobody" });
    expect(forged.statusCode).toBe(401);
  });

  it("rejects a missing or invalid Idempotency-Key", async () => {
    const app = await build();
    const bad: Record<string, string>[] = [
      {},
      { "idempotency-key": "" },
      { "idempotency-key": "bad key!" },
    ];
    for (const headers of bad) {
      const res = await bet(app, validBody, headers);
      expect(res.statusCode).toBe(400);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
    }
    expect(placeRouletteBet).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    const app = await build();
    const headers = { "idempotency-key": randomUUID() };
    for (const payload of [
      {},
      { stake: "0", selection: { type: "color", color: "red" } },
      { stake: "-5", selection: { type: "color", color: "red" } },
      { stake: "100", selection: { type: "straight", number: 37 } },
      { stake: "100", selection: { type: "split" } },
    ]) {
      const res = await bet(app, payload, headers);
      expect(res.statusCode).toBe(400);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
    }
    expect(placeRouletteBet).not.toHaveBeenCalled();
  });

  it("places the bet for the authenticated user and answers 201", async () => {
    vi.mocked(placeRouletteBet).mockResolvedValue(response);
    const app = await build();
    const key = randomUUID();
    const res = await bet(app, validBody, { "idempotency-key": key });
    expect(res.statusCode).toBe(201);
    expect(rouletteBetResponseSchema.parse(res.json())).toEqual(response);
    expect(placeRouletteBet).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      userId,
      idempotencyKey: key,
      bet: { stake: 100n, selection: validBody.selection },
    });
  });
});

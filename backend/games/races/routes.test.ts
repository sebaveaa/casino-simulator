import { randomUUID } from "node:crypto";
import {
  apiPaths,
  type CurrentRaceResponse,
  currentRaceResponseSchema,
  errorResponseSchema,
  type RaceBetResponse,
  type RaceRound,
  raceBetResponseSchema,
  raceRoundSchema,
} from "@casino/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../../auth/token-service";
import type { Db } from "../../db/database";
import { buildApp } from "../../platform/app";
import { stubServices } from "../../platform/services";
import { placeRaceBet } from "./place-bet";
import { getCurrentRound, getDatabaseNow, getPlayerBet, getRound } from "./rounds";

// Bet placement and the queries run against PostgreSQL (the integration tests); here the routes
// only have to authenticate, validate and shape the answers.
vi.mock("./place-bet", () => ({ placeRaceBet: vi.fn() }));
vi.mock("./rounds", () => ({
  getCurrentRound: vi.fn(),
  getRound: vi.fn(),
  getPlayerBet: vi.fn(),
  getDatabaseNow: vi.fn(),
}));

const config = {
  appEnv: "production" as const,
  allowedOrigins: [],
  raceDurationMs: 10_000,
  raceMinStake: 10n,
  raceMaxStake: 500n,
};
const checks = { postgres: async () => true, redis: async () => true };
const userId = "11111111-1111-4111-8111-111111111111";
const roundId = "22222222-2222-4222-8222-222222222222";

function fakeTokens(known: string[]): TokenService {
  return {
    sign: async () => "token",
    verify: async (token): Promise<AuthUser> => {
      if (!known.includes(token)) throw new InvalidTokenError();
      return { id: token, role: "player" };
    },
  };
}

const response: RaceBetResponse = {
  betId: randomUUID(),
  roundId,
  animal: 2,
  stake: "100",
  balance: "900",
};

const openRound: RaceRound = {
  id: roundId,
  status: "open",
  opensAt: "2026-10-19T10:00:00.000Z",
  closesAt: "2026-10-19T10:00:30.000Z",
  serverSeedHash: "a".repeat(64),
};

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.resetAllMocks();
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

const auth = { authorization: `Bearer ${userId}` };
const validBody = { roundId, animal: 2, stake: "100" };

function bet(app: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: apiPaths.raceBets,
    headers: { ...auth, ...headers },
    payload: payload as object,
  });
}

describe("race bet route", () => {
  it("answers 401 without a valid token", async () => {
    const app = await build();
    const missing = await app.inject({ method: "POST", url: apiPaths.raceBets });
    expect(missing.statusCode).toBe(401);
    const forged = await bet(app, validBody, { authorization: "Bearer nobody" });
    expect(forged.statusCode).toBe(401);
  });

  it("rejects a missing Idempotency-Key", async () => {
    const app = await build();
    const res = await bet(app, validBody);
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
    expect(placeRaceBet).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    const app = await build();
    const headers = { "idempotency-key": randomUUID() };
    for (const payload of [
      {},
      { ...validBody, roundId: "nope" },
      { ...validBody, animal: 5 },
      { ...validBody, animal: -1 },
      { ...validBody, stake: "0" },
      { ...validBody, stake: "-5" },
    ]) {
      const res = await bet(app, payload, headers);
      expect(res.statusCode).toBe(400);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
    }
    expect(placeRaceBet).not.toHaveBeenCalled();
  });

  it("places the bet with the configured limits and answers 201, also on replay", async () => {
    vi.mocked(placeRaceBet).mockResolvedValue(response);
    const app = await build();
    const key = randomUUID();
    const first = await bet(app, validBody, { "idempotency-key": key });
    const replay = await bet(app, validBody, { "idempotency-key": key });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(raceBetResponseSchema.parse(first.json())).toEqual(response);
    expect(replay.json()).toEqual(first.json());
    expect(placeRaceBet).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      userId,
      idempotencyKey: key,
      roundId,
      animal: 2,
      stake: 100n,
      limits: { min: 10n, max: 500n },
    });
  });
});

describe("current race route", () => {
  it("answers 401 without a token", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: apiPaths.raceCurrent });
    expect(res.statusCode).toBe(401);
  });

  it("returns the round, the caller's bet and the server time", async () => {
    vi.mocked(getCurrentRound).mockResolvedValue(openRound);
    vi.mocked(getPlayerBet).mockResolvedValue({ animal: 3, stake: 50n, payout: null });
    vi.mocked(getDatabaseNow).mockResolvedValue("2026-10-19T10:00:05.000Z");
    const app = await build();
    const res = await app.inject({ method: "GET", url: apiPaths.raceCurrent, headers: auth });
    expect(res.statusCode).toBe(200);
    const body: CurrentRaceResponse = currentRaceResponseSchema.parse(res.json());
    expect(body).toEqual({
      round: openRound,
      myBet: { animal: 3, stake: "50", payout: null },
      now: "2026-10-19T10:00:05.000Z",
    });
    expect(getCurrentRound).toHaveBeenCalledWith(expect.anything(), { raceDurationMs: 10_000 });
    expect(getPlayerBet).toHaveBeenCalledWith(expect.anything(), userId, roundId);
  });

  it("answers a null round and bet when there are no rounds", async () => {
    vi.mocked(getCurrentRound).mockResolvedValue(null);
    vi.mocked(getDatabaseNow).mockResolvedValue("2026-10-19T10:00:05.000Z");
    const app = await build();
    const res = await app.inject({ method: "GET", url: apiPaths.raceCurrent, headers: auth });
    expect(currentRaceResponseSchema.parse(res.json())).toMatchObject({ round: null, myBet: null });
    expect(getPlayerBet).not.toHaveBeenCalled();
  });
});

describe("race round route", () => {
  const url = (id: string) => apiPaths.raceRound.replace(":roundId", id);

  it("answers 401 without a token", async () => {
    const app = await build();
    expect((await app.inject({ method: "GET", url: url(roundId) })).statusCode).toBe(401);
  });

  it("rejects an id that is not a uuid", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: url("nope"), headers: auth });
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
    expect(getRound).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown round", async () => {
    vi.mocked(getRound).mockResolvedValue(undefined);
    const app = await build();
    const res = await app.inject({ method: "GET", url: url(roundId), headers: auth });
    expect(res.statusCode).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("not_found");
  });

  it("returns the round", async () => {
    vi.mocked(getRound).mockResolvedValue(openRound);
    const app = await build();
    const res = await app.inject({ method: "GET", url: url(roundId), headers: auth });
    expect(res.statusCode).toBe(200);
    expect(raceRoundSchema.parse(res.json())).toEqual(openRound);
  });
});

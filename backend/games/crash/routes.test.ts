import { randomUUID } from "node:crypto";
import {
  apiPaths,
  type CrashBetResponse,
  type CrashCashoutResponse,
  type CrashCurrentResponse,
  type CrashRound,
  crashBetResponseSchema,
  crashCashoutResponseSchema,
  crashCurrentResponseSchema,
  crashHistoryResponseSchema,
  errorResponseSchema,
} from "@casino/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../../auth/token-service";
import type { Db } from "../../db/database";
import { buildApp } from "../../platform/app";
import { stubServices } from "../../platform/services";
import { cashOutCrashBet } from "./cashout";
import { placeCrashBet } from "./place-bet";
import { getCrashHistory, getCurrentCrashRound, getDatabaseNow, getPlayerCrashBet } from "./rounds";
import { crashRoutes } from "./routes";

// The transactional work runs against PostgreSQL (the integration tests); here the routes only
// authenticate, validate the game, and shape the answers.
vi.mock("./place-bet", () => ({ placeCrashBet: vi.fn() }));
vi.mock("./cashout", () => ({ cashOutCrashBet: vi.fn() }));
vi.mock("./rounds", () => ({
  getCurrentCrashRound: vi.fn(),
  getCrashHistory: vi.fn(),
  getPlayerCrashBet: vi.fn(),
  getDatabaseNow: vi.fn(),
}));

const config = {
  appEnv: "production" as const,
  allowedOrigins: [],
  raceDurationMs: 10_000,
  raceIntermissionMs: 8000,
  raceMinStake: 10n,
  raceMaxStake: 500n,
};
const checks = { postgres: async () => true, redis: async () => true };
const userId = "11111111-1111-4111-8111-111111111111";
const roundId = "22222222-2222-4222-8222-222222222222";
const betId = "33333333-3333-4333-8333-333333333333";
const game = "dino-crash";

function fakeTokens(known: string[]): TokenService {
  return {
    sign: async () => "token",
    verify: async (token): Promise<AuthUser> => {
      if (!known.includes(token)) throw new InvalidTokenError();
      return { id: token, role: "player" };
    },
  };
}

const openRound: CrashRound = {
  id: roundId,
  status: "open",
  opensAt: "2026-10-25T10:00:00.000Z",
  closesAt: "2026-10-25T10:00:05.000Z",
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
    routes: [crashRoutes],
  });
  apps.push(app);
  return app;
}

const auth = { authorization: `Bearer ${userId}` };
const betsUrl = (g: string) => apiPaths.crashBets.replace(":game", g);
const cashoutUrl = (g: string, b: string) =>
  apiPaths.crashCashout.replace(":game", g).replace(":betId", b);
const currentUrl = (g: string) => apiPaths.crashCurrent.replace(":game", g);
const roundsUrl = (g: string) => apiPaths.crashRounds.replace(":game", g);

function bet(app: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: betsUrl(game),
    headers: { ...auth, ...headers },
    payload: payload as object,
  });
}

const validBody = { roundId, stake: "1000" };

describe("crash bet route", () => {
  it("answers 401 without a valid token", async () => {
    const app = await build();
    expect((await app.inject({ method: "POST", url: betsUrl(game) })).statusCode).toBe(401);
    const forged = await bet(app, validBody, { authorization: "Bearer nobody" });
    expect(forged.statusCode).toBe(401);
  });

  it("rejects an unknown game before anything else", async () => {
    const app = await build();
    const res = await bet(app, validBody, { "idempotency-key": randomUUID() });
    const bad = await app.inject({
      method: "POST",
      url: betsUrl("not-a-game"),
      headers: { ...auth, "idempotency-key": randomUUID() },
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    expect(bad.statusCode).toBe(400);
    expect(errorResponseSchema.parse(bad.json()).error.code).toBe("invalid_request");
  });

  it("rejects a missing Idempotency-Key", async () => {
    const app = await build();
    const res = await bet(app, validBody);
    expect(res.statusCode).toBe(400);
    expect(placeCrashBet).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    const app = await build();
    const headers = { "idempotency-key": randomUUID() };
    for (const payload of [
      {},
      { ...validBody, roundId: "nope" },
      { ...validBody, stake: "0" },
      { ...validBody, stake: "999" },
      { ...validBody, stake: "50001" },
    ]) {
      const res = await bet(app, payload, headers);
      expect(res.statusCode).toBe(400);
    }
    expect(placeCrashBet).not.toHaveBeenCalled();
  });

  it("places the bet with the fixed limits and answers 201, also on replay", async () => {
    const response: CrashBetResponse = { betId, roundId, stake: "1000", balance: "9000" };
    vi.mocked(placeCrashBet).mockResolvedValue(response);
    const app = await build();
    const key = randomUUID();
    const first = await bet(app, validBody, { "idempotency-key": key });
    const replay = await bet(app, validBody, { "idempotency-key": key });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(crashBetResponseSchema.parse(first.json())).toEqual(response);
    expect(placeCrashBet).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      userId,
      idempotencyKey: key,
      roundId,
      game,
      stake: 1000n,
      limits: { min: 1000n, max: 50000n },
    });
  });
});

describe("crash cashout route", () => {
  it("answers 401 without a token", async () => {
    const app = await build();
    expect((await app.inject({ method: "POST", url: cashoutUrl(game, betId) })).statusCode).toBe(
      401,
    );
  });

  it("rejects a betId that is not a uuid", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: cashoutUrl(game, "nope"),
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
    expect(cashOutCrashBet).not.toHaveBeenCalled();
  });

  it("cashes out and returns the payout", async () => {
    const response: CrashCashoutResponse = {
      betId,
      cashoutHundredths: 180,
      payout: "1800",
      balance: "9800",
    };
    vi.mocked(cashOutCrashBet).mockResolvedValue(response);
    const app = await build();
    const res = await app.inject({ method: "POST", url: cashoutUrl(game, betId), headers: auth });
    expect(res.statusCode).toBe(200);
    expect(crashCashoutResponseSchema.parse(res.json())).toEqual(response);
    expect(cashOutCrashBet).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      userId,
      game,
      betId,
    });
  });
});

describe("crash current route", () => {
  it("answers 401 without a token", async () => {
    const app = await build();
    expect((await app.inject({ method: "GET", url: currentUrl(game) })).statusCode).toBe(401);
  });

  it("returns the round, the caller's bet and the server time", async () => {
    vi.mocked(getCurrentCrashRound).mockResolvedValue(openRound);
    vi.mocked(getPlayerCrashBet).mockResolvedValue({
      betId,
      stake: "1000",
      status: "pending",
      cashoutHundredths: null,
      payout: null,
    });
    vi.mocked(getDatabaseNow).mockResolvedValue("2026-10-25T10:00:02.000Z");
    const app = await build();
    const res = await app.inject({ method: "GET", url: currentUrl(game), headers: auth });
    expect(res.statusCode).toBe(200);
    const body: CrashCurrentResponse = crashCurrentResponseSchema.parse(res.json());
    expect(body).toEqual({
      round: openRound,
      myBet: { betId, stake: "1000", status: "pending", cashoutHundredths: null, payout: null },
      now: "2026-10-25T10:00:02.000Z",
      limits: { minStake: "1000", maxStake: "50000" },
    });
    expect(getCurrentCrashRound).toHaveBeenCalledWith(expect.anything(), game, {
      intermissionMs: 3000,
    });
    expect(getPlayerCrashBet).toHaveBeenCalledWith(expect.anything(), game, userId, roundId);
  });

  it("answers a null round and bet when there are no rounds", async () => {
    vi.mocked(getCurrentCrashRound).mockResolvedValue(null);
    vi.mocked(getDatabaseNow).mockResolvedValue("2026-10-25T10:00:02.000Z");
    const app = await build();
    const res = await app.inject({ method: "GET", url: currentUrl(game), headers: auth });
    expect(crashCurrentResponseSchema.parse(res.json())).toMatchObject({
      round: null,
      myBet: null,
    });
    expect(getPlayerCrashBet).not.toHaveBeenCalled();
  });
});

describe("crash history route", () => {
  it("answers 401 without a token", async () => {
    const app = await build();
    expect((await app.inject({ method: "GET", url: roundsUrl(game) })).statusCode).toBe(401);
  });

  it("returns the finished rounds with the coerced limit", async () => {
    const finished: CrashRound = {
      ...openRound,
      status: "settled",
      result: { crashHundredths: 245, outcome: "impact" },
      serverSeed: "seed",
    };
    vi.mocked(getCrashHistory).mockResolvedValue([finished]);
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: `${roundsUrl(game)}?limit=10`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(crashHistoryResponseSchema.parse(res.json())).toEqual({ rounds: [finished] });
    expect(getCrashHistory).toHaveBeenCalledWith(expect.anything(), game, 10);
  });
});

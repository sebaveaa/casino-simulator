import { randomUUID } from "node:crypto";
import {
  apiPaths,
  type ChickenRoadCashoutResponse,
  type ChickenRoadFinishedGame,
  type ChickenRoadInProgressGame,
  chickenRoadCashoutResponseSchema,
  chickenRoadCurrentResponseSchema,
  chickenRoadHistoryResponseSchema,
  chickenRoadStartResponseSchema,
  chickenRoadStepResponseSchema,
  errorResponseSchema,
} from "@casino/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../../auth/token-service";
import type { Db } from "../../db/database";
import { buildApp } from "../../platform/app";
import { AppError } from "../../platform/errors";
import { stubServices } from "../../platform/services";
import { settleExpiredGame } from "./expiry";
import { cashOutChickenRoadGame, startChickenRoadGame, stepChickenRoadGame } from "./game";
import { getCurrentChickenRoadGame, listChickenRoadHistory } from "./view";

// The game flow runs against PostgreSQL (game.integration.test.ts); here the routes only have to
// validate requests, settle abandoned games first, and hand over.
vi.mock("./game", () => ({
  startChickenRoadGame: vi.fn(),
  stepChickenRoadGame: vi.fn(),
  cashOutChickenRoadGame: vi.fn(),
}));
vi.mock("./expiry", () => ({ settleExpiredGame: vi.fn() }));
vi.mock("./view", () => ({
  getCurrentChickenRoadGame: vi.fn(),
  listChickenRoadHistory: vi.fn(),
}));

const config = { appEnv: "production" as const, allowedOrigins: [] };
const checks = { postgres: async () => true, redis: async () => true };
const userId = "11111111-1111-4111-8111-111111111111";
const auth = { authorization: `Bearer ${userId}` };
const gameId = randomUUID();

function fakeTokens(known: string[]): TokenService {
  return {
    sign: async () => "token",
    verify: async (token): Promise<AuthUser> => {
      if (!known.includes(token)) throw new InvalidTokenError();
      return { id: token, role: "player" };
    },
  };
}

const fairness = {
  seedPairId: randomUUID(),
  serverSeedHash: "a".repeat(64),
  clientSeed: "client",
  nonce: 3,
};
const inProgress: ChickenRoadInProgressGame = {
  status: "in_progress",
  gameId,
  stake: "1000",
  fairness,
  lanesCrossed: 2,
  cashoutAmount: "1500",
};
const cashedOut: ChickenRoadFinishedGame = {
  status: "cashed_out",
  gameId,
  stake: "1000",
  fairness,
  lanesCrossed: 2,
  payout: "1500",
};

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function build() {
  vi.mocked(settleExpiredGame).mockResolvedValue(false);
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

function post(app: FastifyInstance, url: string, payload: unknown, headers = {}) {
  return app.inject({
    method: "POST",
    url,
    headers: { ...auth, ...headers },
    payload: payload as object,
  });
}

function expectInvalid(res: { statusCode: number; json: () => unknown }) {
  expect(res.statusCode).toBe(400);
  expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
}

describe("Chicken Road routes", () => {
  it("answers 401 without a valid token on every route", async () => {
    const app = await build();
    for (const [method, url] of [
      ["POST", apiPaths.chickenRoadGames],
      ["GET", apiPaths.chickenRoadGames],
      ["GET", apiPaths.chickenRoadCurrent],
      ["POST", apiPaths.chickenRoadSteps],
      ["POST", apiPaths.chickenRoadCashout],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      const forged = await app.inject({ method, url, headers: { authorization: "Bearer nobody" } });
      expect(forged.statusCode).toBe(401);
    }
    expect(settleExpiredGame).not.toHaveBeenCalled();
  });

  describe("start", () => {
    it("rejects a missing or invalid Idempotency-Key", async () => {
      const app = await build();
      for (const headers of [{}, { "idempotency-key": "" }, { "idempotency-key": "bad key!" }]) {
        expectInvalid(await post(app, apiPaths.chickenRoadGames, { stake: "1000" }, headers));
      }
      expect(startChickenRoadGame).not.toHaveBeenCalled();
      expect(settleExpiredGame).not.toHaveBeenCalled();
    });

    it("rejects a stake out of bounds or malformed", async () => {
      const app = await build();
      const headers = { "idempotency-key": randomUUID() };
      for (const payload of [
        {},
        { stake: 1000 },
        { stake: "999" },
        { stake: "50001" },
        { stake: "-1000" },
        { stake: "10.5" },
      ]) {
        expectInvalid(await post(app, apiPaths.chickenRoadGames, payload, headers));
      }
      expect(startChickenRoadGame).not.toHaveBeenCalled();
    });

    it("settles an abandoned game, then starts one and answers 201", async () => {
      vi.mocked(startChickenRoadGame).mockResolvedValue({
        game: { ...inProgress, lanesCrossed: 0, cashoutAmount: "0" },
        balance: "9000",
      });
      const app = await build();
      const key = randomUUID();
      const res = await post(
        app,
        apiPaths.chickenRoadGames,
        { stake: "1000" },
        {
          "idempotency-key": key,
        },
      );
      expect(res.statusCode).toBe(201);
      expect(chickenRoadStartResponseSchema.parse(res.json()).balance).toBe("9000");
      expect(settleExpiredGame).toHaveBeenCalledWith(expect.anything(), expect.anything(), userId);
      expect(startChickenRoadGame).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        userId,
        idempotencyKey: key,
        stake: 1000n,
      });
    });

    it("passes a conflict on as 409", async () => {
      vi.mocked(startChickenRoadGame).mockRejectedValue(
        new AppError("conflict", "A Chicken Road game is already in progress"),
      );
      const app = await build();
      const res = await post(
        app,
        apiPaths.chickenRoadGames,
        { stake: "1000" },
        {
          "idempotency-key": randomUUID(),
        },
      );
      expect(res.statusCode).toBe(409);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe("conflict");
    });
  });

  describe("step", () => {
    it("rejects an invalid body", async () => {
      const app = await build();
      for (const payload of [
        {},
        { gameId },
        { gameId, lane: 0 },
        { gameId, lane: 7 },
        { gameId, lane: 1.5 },
        { gameId, lane: "1" },
        { gameId: "not-a-uuid", lane: 1 },
      ]) {
        expectInvalid(await post(app, apiPaths.chickenRoadSteps, payload));
      }
      expect(stepChickenRoadGame).not.toHaveBeenCalled();
    });

    it("hands the step over and answers 200", async () => {
      vi.mocked(stepChickenRoadGame).mockResolvedValue({ game: inProgress, balance: "9000" });
      const app = await build();
      const res = await post(app, apiPaths.chickenRoadSteps, { gameId, lane: 2 });
      expect(res.statusCode).toBe(200);
      expect(chickenRoadStepResponseSchema.parse(res.json()).game).toEqual(inProgress);
      expect(res.body).not.toContain("hitLane");
      expect(stepChickenRoadGame).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        userId,
        gameId,
        lane: 2,
      });
      expect(settleExpiredGame).toHaveBeenCalledOnce();
    });

    it("answers 404 for a game that is not the player's", async () => {
      vi.mocked(stepChickenRoadGame).mockRejectedValue(
        new AppError("not_found", "Chicken Road game not found"),
      );
      const app = await build();
      const res = await post(app, apiPaths.chickenRoadSteps, { gameId, lane: 1 });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("cash out", () => {
    it("rejects an invalid body", async () => {
      const app = await build();
      for (const payload of [{}, { gameId: "nope" }]) {
        expectInvalid(await post(app, apiPaths.chickenRoadCashout, payload));
      }
      expect(cashOutChickenRoadGame).not.toHaveBeenCalled();
    });

    it("hands the cash-out over and answers 200", async () => {
      const response: ChickenRoadCashoutResponse = { game: cashedOut, balance: "10500" };
      vi.mocked(cashOutChickenRoadGame).mockResolvedValue(response);
      const app = await build();
      const res = await post(app, apiPaths.chickenRoadCashout, { gameId });
      expect(res.statusCode).toBe(200);
      expect(chickenRoadCashoutResponseSchema.parse(res.json())).toEqual(response);
      expect(cashOutChickenRoadGame).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        userId,
        gameId,
      });
    });
  });

  describe("current and history", () => {
    it("returns the game in progress, or null", async () => {
      const app = await build();
      vi.mocked(getCurrentChickenRoadGame).mockResolvedValueOnce(inProgress);
      const one = await app.inject({
        method: "GET",
        url: apiPaths.chickenRoadCurrent,
        headers: auth,
      });
      expect(one.statusCode).toBe(200);
      expect(chickenRoadCurrentResponseSchema.parse(one.json())).toEqual({ game: inProgress });

      vi.mocked(getCurrentChickenRoadGame).mockResolvedValueOnce(null);
      const none = await app.inject({
        method: "GET",
        url: apiPaths.chickenRoadCurrent,
        headers: auth,
      });
      expect(none.json()).toEqual({ game: null });
      // Settled first, so an abandoned game is never shown as in progress.
      expect(settleExpiredGame).toHaveBeenCalledTimes(2);
    });

    it("lists the history with the default limit or the one asked for", async () => {
      vi.mocked(listChickenRoadHistory).mockResolvedValue([cashedOut]);
      const app = await build();
      const res = await app.inject({
        method: "GET",
        url: apiPaths.chickenRoadGames,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(chickenRoadHistoryResponseSchema.parse(res.json())).toEqual({ games: [cashedOut] });
      expect(listChickenRoadHistory).toHaveBeenLastCalledWith(expect.anything(), userId, 5);

      await app.inject({
        method: "GET",
        url: `${apiPaths.chickenRoadGames}?limit=20`,
        headers: auth,
      });
      expect(listChickenRoadHistory).toHaveBeenLastCalledWith(expect.anything(), userId, 20);
    });

    it("rejects a limit out of range", async () => {
      const app = await build();
      for (const limit of ["0", "21", "abc", "2.5"]) {
        const res = await app.inject({
          method: "GET",
          url: `${apiPaths.chickenRoadGames}?limit=${limit}`,
          headers: auth,
        });
        expectInvalid(res);
      }
      expect(listChickenRoadHistory).not.toHaveBeenCalled();
    });
  });
});

import { randomUUID } from "node:crypto";
import {
  apiPaths,
  type BlackjackCard,
  type BlackjackInProgressHand,
  type BlackjackSettledHand,
  blackjackActionResponseSchema,
  blackjackCurrentResponseSchema,
  blackjackHistoryResponseSchema,
  blackjackStartResponseSchema,
  errorResponseSchema,
} from "@casino/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../../auth/token-service";
import type { Db } from "../../db/database";
import { buildApp } from "../../platform/app";
import { AppError } from "../../platform/errors";
import { stubServices } from "../../platform/services";
import { InsufficientFundsError } from "../../wallet/wallet-service";
import { settleAbandonedHand } from "./expiry";
import { actOnBlackjackHand, startBlackjackHand } from "./game";
import { getCurrentBlackjackHand, listBlackjackHistory } from "./view";

// The hand flow runs against PostgreSQL (game.integration.test.ts); here the routes only have to
// validate requests, settle abandoned hands first, and hand over.
vi.mock("./game", () => ({ startBlackjackHand: vi.fn(), actOnBlackjackHand: vi.fn() }));
vi.mock("./expiry", () => ({ settleAbandonedHand: vi.fn() }));
vi.mock("./view", () => ({ getCurrentBlackjackHand: vi.fn(), listBlackjackHistory: vi.fn() }));

const config = {
  appEnv: "production" as const,
  allowedOrigins: [],
  raceDurationMs: 10_000,
  raceIntermissionMs: 8000,
  raceMinStake: 1n,
  raceMaxStake: 1000n,
};
const checks = { postgres: async () => true, redis: async () => true };
const userId = "11111111-1111-4111-8111-111111111111";
const auth = { authorization: `Bearer ${userId}` };
const handId = randomUUID();

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
const fields = { handId, stake: "1000", fairness };
const cards: BlackjackCard[] = [
  { rank: "K", suit: "spades" },
  { rank: "7", suit: "hearts" },
];
const total = { total: 17, soft: false };
const inProgress: BlackjackInProgressHand = {
  status: "player_turn",
  ...fields,
  playerHands: [{ cards, total, doubled: false }],
  activeHand: 0,
  dealerUpCard: { rank: "9", suit: "clubs" },
  actionCount: 0,
  canDouble: true,
  canSplit: false,
};
const settled: BlackjackSettledHand = {
  status: "settled",
  ...fields,
  playerHands: [{ cards, total, doubled: false, outcome: "win", payout: "2000" }],
  dealerCards: [
    { rank: "9", suit: "clubs" },
    { rank: "6", suit: "diamonds" },
    { rank: "8", suit: "spades" },
  ],
  dealerTotal: { total: 23, soft: false },
  totalStake: "1000",
  payout: "2000",
};

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function build() {
  vi.mocked(settleAbandonedHand).mockResolvedValue(false);
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

const get = (app: FastifyInstance, url: string) =>
  app.inject({ method: "GET", url, headers: auth });

function expectInvalid(res: { statusCode: number; json: () => unknown }) {
  expect(res.statusCode).toBe(400);
  expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
}

describe("Blackjack routes", () => {
  it("answers 401 without a valid token on every route", async () => {
    const app = await build();
    for (const [method, url] of [
      ["POST", apiPaths.blackjackHands],
      ["GET", apiPaths.blackjackHands],
      ["GET", apiPaths.blackjackCurrent],
      ["POST", apiPaths.blackjackActions],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      const forged = await app.inject({ method, url, headers: { authorization: "Bearer nobody" } });
      expect(forged.statusCode).toBe(401);
    }
    expect(settleAbandonedHand).not.toHaveBeenCalled();
  });

  describe("start", () => {
    it("rejects a missing or invalid Idempotency-Key", async () => {
      const app = await build();
      for (const headers of [{}, { "idempotency-key": "" }, { "idempotency-key": "bad key!" }]) {
        expectInvalid(await post(app, apiPaths.blackjackHands, { stake: "1000" }, headers));
      }
      expect(startBlackjackHand).not.toHaveBeenCalled();
      expect(settleAbandonedHand).not.toHaveBeenCalled();
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
        expectInvalid(await post(app, apiPaths.blackjackHands, payload, headers));
      }
      expect(startBlackjackHand).not.toHaveBeenCalled();
    });

    it("settles an abandoned hand, then starts one and answers 201", async () => {
      vi.mocked(startBlackjackHand).mockResolvedValue({ hand: inProgress, balance: "9000" });
      const app = await build();
      const key = randomUUID();
      const res = await post(
        app,
        apiPaths.blackjackHands,
        { stake: "1000" },
        { "idempotency-key": key },
      );
      expect(res.statusCode).toBe(201);
      expect(blackjackStartResponseSchema.parse(res.json())).toEqual({
        hand: inProgress,
        balance: "9000",
      });
      expect(settleAbandonedHand).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        userId,
      );
      expect(startBlackjackHand).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        userId,
        idempotencyKey: key,
        stake: 1000n,
      });
    });

    it("answers 201 with a hand settled by a natural", async () => {
      const natural: BlackjackSettledHand = {
        ...settled,
        playerHands: [{ cards, total, doubled: false, outcome: "blackjack", payout: "2500" }],
        payout: "2500",
      };
      vi.mocked(startBlackjackHand).mockResolvedValue({ hand: natural, balance: "10500" });
      const app = await build();
      const res = await post(
        app,
        apiPaths.blackjackHands,
        { stake: "1000" },
        { "idempotency-key": randomUUID() },
      );
      expect(res.statusCode).toBe(201);
      expect(blackjackStartResponseSchema.parse(res.json()).hand).toEqual(natural);
    });

    it("passes a conflict on as 409", async () => {
      vi.mocked(startBlackjackHand).mockRejectedValue(
        new AppError("conflict", "A Blackjack hand is already in progress"),
      );
      const app = await build();
      const res = await post(
        app,
        apiPaths.blackjackHands,
        { stake: "1000" },
        { "idempotency-key": randomUUID() },
      );
      expect(res.statusCode).toBe(409);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe("conflict");
    });
  });

  describe("actions", () => {
    it("rejects an invalid body", async () => {
      const app = await build();
      for (const payload of [
        {},
        { handId, action: "hit" },
        { handId, action: "surrender", index: 0 },
        { handId, action: "hit", index: -1 },
        { handId, action: "hit", index: 1.5 },
        { handId, action: "hit", index: "0" },
        { handId: "not-a-uuid", action: "hit", index: 0 },
      ]) {
        expectInvalid(await post(app, apiPaths.blackjackActions, payload));
      }
      expect(actOnBlackjackHand).not.toHaveBeenCalled();
    });

    it("hands the action over and answers 200 without the hole card", async () => {
      vi.mocked(actOnBlackjackHand).mockResolvedValue({ hand: inProgress, balance: "9000" });
      const app = await build();
      const res = await post(app, apiPaths.blackjackActions, { handId, action: "hit", index: 0 });
      expect(res.statusCode).toBe(200);
      expect(blackjackActionResponseSchema.parse(res.json()).hand).toEqual(inProgress);
      expect(res.body).not.toContain("dealerCards");
      expect(actOnBlackjackHand).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        userId,
        handId,
        action: "hit",
        index: 0,
      });
      expect(settleAbandonedHand).toHaveBeenCalledOnce();
    });

    it("hands a split over like any other action", async () => {
      vi.mocked(actOnBlackjackHand).mockResolvedValue({ hand: inProgress, balance: "8000" });
      const app = await build();
      const res = await post(app, apiPaths.blackjackActions, { handId, action: "split", index: 0 });
      expect(res.statusCode).toBe(200);
      expect(actOnBlackjackHand).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        userId,
        handId,
        action: "split",
        index: 0,
      });
    });

    it("answers 404 for a hand that is not the player's", async () => {
      vi.mocked(actOnBlackjackHand).mockRejectedValue(
        new AppError("not_found", "Blackjack hand not found"),
      );
      const app = await build();
      const res = await post(app, apiPaths.blackjackActions, { handId, action: "stand", index: 0 });
      expect(res.statusCode).toBe(404);
    });

    it("answers 422 when a double does not fit the balance", async () => {
      vi.mocked(actOnBlackjackHand).mockRejectedValue(new InsufficientFundsError());
      const app = await build();
      const res = await post(app, apiPaths.blackjackActions, {
        handId,
        action: "double",
        index: 0,
      });
      expect(res.statusCode).toBe(422);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe("insufficient_funds");
    });
  });

  describe("current and history", () => {
    it("returns the hand in progress, or null", async () => {
      const app = await build();
      vi.mocked(getCurrentBlackjackHand).mockResolvedValueOnce(inProgress);
      const one = await get(app, apiPaths.blackjackCurrent);
      expect(one.statusCode).toBe(200);
      expect(blackjackCurrentResponseSchema.parse(one.json())).toEqual({ hand: inProgress });

      vi.mocked(getCurrentBlackjackHand).mockResolvedValueOnce(null);
      expect((await get(app, apiPaths.blackjackCurrent)).json()).toEqual({ hand: null });
      // Settled first, so an abandoned hand is never shown as in progress.
      expect(settleAbandonedHand).toHaveBeenCalledTimes(2);
    });

    it("lists the history with the default limit or the one asked for", async () => {
      vi.mocked(listBlackjackHistory).mockResolvedValue([settled]);
      const app = await build();
      const res = await get(app, apiPaths.blackjackHands);
      expect(res.statusCode).toBe(200);
      expect(blackjackHistoryResponseSchema.parse(res.json())).toEqual({ hands: [settled] });
      expect(listBlackjackHistory).toHaveBeenLastCalledWith(expect.anything(), userId, 5);

      await get(app, `${apiPaths.blackjackHands}?limit=20`);
      expect(listBlackjackHistory).toHaveBeenLastCalledWith(expect.anything(), userId, 20);
    });

    it("rejects a limit out of range", async () => {
      const app = await build();
      for (const limit of ["0", "21", "abc", "2.5"]) {
        expectInvalid(await get(app, `${apiPaths.blackjackHands}?limit=${limit}`));
      }
      expect(listBlackjackHistory).not.toHaveBeenCalled();
    });
  });
});

import {
  apiPaths,
  type ChickenRoadCurrentResponse,
  type ChickenRoadHistoryResponse,
  chickenRoadCashoutRequestSchema,
  chickenRoadHistoryQuerySchema,
  chickenRoadStartRequestSchema,
  chickenRoadStepRequestSchema,
  parseAmount,
} from "@casino/shared";
import type { FastifyRequest } from "fastify";
import { getAuth } from "../../auth/guard";
import { parseWith, readIdempotencyKey } from "../../platform/http";
import type { ModuleRoutes } from "../../platform/routes";
import { settleExpiredGame } from "./expiry";
import { cashOutChickenRoadGame, startChickenRoadGame, stepChickenRoadGame } from "./game";
import { getCurrentChickenRoadGame, listChickenRoadHistory } from "./view";

export const chickenRoadRoutes: ModuleRoutes = async (app, { db, services, requireAuth }) => {
  const { wallet, seedPairs } = services;

  /**
   * Every endpoint first settles the player's abandoned game, if any, in its own transaction:
   * the payout or refund commits even if the operation that follows is refused.
   */
  async function authenticate(request: FastifyRequest): Promise<string> {
    const userId = getAuth(request).id;
    await db.transaction().execute((trx) => settleExpiredGame(trx, { wallet }, userId));
    return userId;
  }

  app.post(apiPaths.chickenRoadGames, { preHandler: requireAuth() }, async (request, reply) => {
    // Request checks come first, so a malformed request settles nothing.
    const idempotencyKey = readIdempotencyKey(request);
    const { stake } = parseWith(chickenRoadStartRequestSchema, request.body);
    const userId = await authenticate(request);
    // A retry of one key replays the game; the response is 201 either way, like roulette.
    const response = await db
      .transaction()
      .execute((trx) =>
        startChickenRoadGame(
          trx,
          { wallet, seedPairs },
          { userId, idempotencyKey, stake: parseAmount(stake) },
        ),
      );
    return reply.code(201).send(response);
  });

  app.get(
    apiPaths.chickenRoadGames,
    { preHandler: requireAuth() },
    async (request): Promise<ChickenRoadHistoryResponse> => {
      const { limit } = parseWith(chickenRoadHistoryQuerySchema, request.query);
      const userId = await authenticate(request);
      return { games: await listChickenRoadHistory(db, userId, limit) };
    },
  );

  app.get(
    apiPaths.chickenRoadCurrent,
    { preHandler: requireAuth() },
    async (request): Promise<ChickenRoadCurrentResponse> => {
      const userId = await authenticate(request);
      return { game: await getCurrentChickenRoadGame(db, userId) };
    },
  );

  app.post(apiPaths.chickenRoadSteps, { preHandler: requireAuth() }, async (request) => {
    const { gameId, lane } = parseWith(chickenRoadStepRequestSchema, request.body);
    const userId = await authenticate(request);
    return db
      .transaction()
      .execute((trx) => stepChickenRoadGame(trx, { wallet }, { userId, gameId, lane }));
  });

  app.post(apiPaths.chickenRoadCashout, { preHandler: requireAuth() }, async (request) => {
    const { gameId } = parseWith(chickenRoadCashoutRequestSchema, request.body);
    const userId = await authenticate(request);
    return db
      .transaction()
      .execute((trx) => cashOutChickenRoadGame(trx, { wallet }, { userId, gameId }));
  });
};

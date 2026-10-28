import {
  apiPaths,
  type BlackjackCurrentResponse,
  type BlackjackHistoryResponse,
  blackjackActionRequestSchema,
  blackjackHistoryQuerySchema,
  blackjackStartRequestSchema,
  parseAmount,
} from "@casino/shared";
import type { FastifyRequest } from "fastify";
import { getAuth } from "../../auth/guard";
import { parseWith, readIdempotencyKey } from "../../platform/http";
import type { ModuleRoutes } from "../../platform/routes";
import { settleAbandonedHand } from "./expiry";
import { actOnBlackjackHand, startBlackjackHand } from "./game";
import { getCurrentShoe } from "./shoe";
import { getCurrentBlackjackHand, listBlackjackHistory } from "./view";

export const blackjackRoutes: ModuleRoutes = async (app, { db, services, requireAuth }) => {
  const { wallet, seedPairs } = services;

  /**
   * Every endpoint first settles the player's abandoned hand, if any, in its own transaction:
   * the payout commits even if the operation that follows is refused.
   */
  async function authenticate(request: FastifyRequest): Promise<string> {
    const userId = getAuth(request).id;
    await db.transaction().execute((trx) => settleAbandonedHand(trx, { wallet }, userId));
    return userId;
  }

  app.post(apiPaths.blackjackHands, { preHandler: requireAuth() }, async (request, reply) => {
    // Request checks come first, so a malformed request settles nothing.
    const idempotencyKey = readIdempotencyKey(request);
    const { stake } = parseWith(blackjackStartRequestSchema, request.body);
    const userId = await authenticate(request);
    // A retry of one key replays the hand; the response is 201 either way, like Chicken Road.
    const response = await db
      .transaction()
      .execute((trx) =>
        startBlackjackHand(
          trx,
          { wallet, seedPairs },
          { userId, idempotencyKey, stake: parseAmount(stake) },
        ),
      );
    return reply.code(201).send(response);
  });

  app.get(
    apiPaths.blackjackHands,
    { preHandler: requireAuth() },
    async (request): Promise<BlackjackHistoryResponse> => {
      const { limit } = parseWith(blackjackHistoryQuerySchema, request.query);
      const userId = await authenticate(request);
      return { hands: await listBlackjackHistory(db, userId, limit) };
    },
  );

  app.get(
    apiPaths.blackjackCurrent,
    { preHandler: requireAuth() },
    async (request): Promise<BlackjackCurrentResponse> => {
      const userId = await authenticate(request);
      return {
        hand: await getCurrentBlackjackHand(db, userId),
        shoe: await getCurrentShoe(db, userId),
      };
    },
  );

  app.post(apiPaths.blackjackActions, { preHandler: requireAuth() }, async (request) => {
    const { handId, action, index } = parseWith(blackjackActionRequestSchema, request.body);
    const userId = await authenticate(request);
    return db
      .transaction()
      .execute((trx) => actOnBlackjackHand(trx, { wallet }, { userId, handId, action, index }));
  });
};

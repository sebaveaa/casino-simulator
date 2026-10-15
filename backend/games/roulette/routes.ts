import { apiPaths, parseAmount, roulette, rouletteBetRequestSchema } from "@casino/shared";
import { getAuth } from "../../auth/guard";
import { AppError } from "../../platform/errors";
import { parseWith, readIdempotencyKey } from "../../platform/http";
import type { ModuleRoutes } from "../../platform/routes";
import { placeRouletteBet } from "./place-bet";

export const rouletteRoutes: ModuleRoutes = async (app, { db, services, requireAuth }) => {
  const { wallet, seedPairs } = services;

  app.post(apiPaths.rouletteBets, { preHandler: requireAuth() }, async (request, reply) => {
    const userId = getAuth(request).id;
    const idempotencyKey = readIdempotencyKey(request);
    const { stake, selection } = parseWith(rouletteBetRequestSchema, request.body);
    const bet = { stake: parseAmount(stake), selection };
    if (!roulette.validateBet(bet)) {
      throw new AppError("invalid_request", "Invalid roulette bet");
    }

    // A retry of one key replays the original bet; the response is 201 either way, like deposits.
    const body = await db
      .transaction()
      .execute((trx) =>
        placeRouletteBet(trx, { wallet, seedPairs }, { userId, idempotencyKey, bet }),
      );
    return reply.code(201).send(body);
  });
};

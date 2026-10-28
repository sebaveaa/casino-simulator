import {
  apiPaths,
  CRASH_INTERMISSION_MS,
  CRASH_MAX_STAKE,
  CRASH_MIN_STAKE,
  crashBetRequestSchema,
  crashGameSchema,
  crashHistoryQuerySchema,
  parseAmount,
  toAmount,
} from "@casino/shared";
import { z } from "zod";
import { getAuth } from "../../auth/guard";
import { parseWith, readIdempotencyKey } from "../../platform/http";
import type { ModuleRoutes } from "../../platform/routes";
import { cashOutCrashBet } from "./cashout";
import { placeCrashBet } from "./place-bet";
import { getCrashHistory, getCurrentCrashRound, getDatabaseNow, getPlayerCrashBet } from "./rounds";

const gameParamsSchema = z.object({ game: crashGameSchema });
const cashoutParamsSchema = z.object({ game: crashGameSchema, betId: z.uuid() });

/** The Crash REST routes (PLAN-CRASH §5.2). The SSE stream is a separate module (branch C). */
export const crashRoutes: ModuleRoutes = async (app, { db, services, requireAuth }) => {
  const { wallet } = services;
  const limits = { min: CRASH_MIN_STAKE, max: CRASH_MAX_STAKE };

  app.post(apiPaths.crashBets, { preHandler: requireAuth() }, async (request, reply) => {
    const { game } = parseWith(gameParamsSchema, request.params);
    const userId = getAuth(request).id;
    const idempotencyKey = readIdempotencyKey(request);
    const body = parseWith(crashBetRequestSchema, request.body);

    const response = await db.transaction().execute((trx) =>
      placeCrashBet(
        trx,
        { wallet },
        {
          userId,
          idempotencyKey,
          roundId: body.roundId,
          game,
          stake: parseAmount(body.stake),
          limits,
        },
      ),
    );
    return reply.code(201).send(response);
  });

  app.post(apiPaths.crashCashout, { preHandler: requireAuth() }, async (request) => {
    const { game, betId } = parseWith(cashoutParamsSchema, request.params);
    const userId = getAuth(request).id;
    return db
      .transaction()
      .execute((trx) => cashOutCrashBet(trx, { wallet }, { userId, game, betId }));
  });

  app.get(apiPaths.crashCurrent, { preHandler: requireAuth() }, async (request) => {
    const { game } = parseWith(gameParamsSchema, request.params);
    const userId = getAuth(request).id;
    const round = await getCurrentCrashRound(db, game, { intermissionMs: CRASH_INTERMISSION_MS });
    const myBet = round ? await getPlayerCrashBet(db, game, userId, round.id) : null;
    return {
      round,
      myBet,
      now: await getDatabaseNow(db),
      limits: { minStake: toAmount(CRASH_MIN_STAKE), maxStake: toAmount(CRASH_MAX_STAKE) },
    };
  });

  app.get(apiPaths.crashRounds, { preHandler: requireAuth() }, async (request) => {
    const { game } = parseWith(gameParamsSchema, request.params);
    const { limit } = parseWith(crashHistoryQuerySchema, request.query);
    return { rounds: await getCrashHistory(db, game, limit) };
  });
};

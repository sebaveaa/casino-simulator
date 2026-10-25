import { apiPaths, parseAmount, raceBetRequestSchema, toAmount } from "@casino/shared";
import { z } from "zod";
import { getAuth } from "../../auth/guard";
import { AppError } from "../../platform/errors";
import { parseWith, readIdempotencyKey } from "../../platform/http";
import type { ModuleRoutes } from "../../platform/routes";
import { placeRaceBet } from "./place-bet";
import { getCurrentRound, getDatabaseNow, getPlayerBet, getRound } from "./rounds";

const roundParamsSchema = z.object({ roundId: z.uuid() });

export const racesRoutes: ModuleRoutes = async (
  app,
  {
    db,
    services,
    requireAuth,
    config: { raceDurationMs, raceIntermissionMs, raceMinStake, raceMaxStake },
  },
) => {
  const { wallet } = services;

  app.post(apiPaths.raceBets, { preHandler: requireAuth() }, async (request, reply) => {
    const userId = getAuth(request).id;
    const idempotencyKey = readIdempotencyKey(request);
    const body = parseWith(raceBetRequestSchema, request.body);

    // A retry of one key replays the original bet; the response is 201 either way, like deposits.
    const response = await db.transaction().execute((trx) =>
      placeRaceBet(
        trx,
        { wallet },
        {
          userId,
          idempotencyKey,
          roundId: body.roundId,
          animal: body.animal,
          stake: parseAmount(body.stake),
          limits: { min: raceMinStake, max: raceMaxStake },
        },
      ),
    );
    return reply.code(201).send(response);
  });

  app.get(apiPaths.raceCurrent, { preHandler: requireAuth() }, async (request) => {
    const userId = getAuth(request).id;
    const round = await getCurrentRound(db, { raceDurationMs, raceIntermissionMs });
    const bet = round ? await getPlayerBet(db, userId, round.id) : null;
    return {
      round,
      myBet: bet
        ? {
            animal: bet.animal,
            stake: toAmount(bet.stake),
            payout: bet.payout === null ? null : toAmount(bet.payout),
          }
        : null,
      now: await getDatabaseNow(db),
      limits: { minStake: toAmount(raceMinStake), maxStake: toAmount(raceMaxStake) },
      raceDurationMs,
    };
  });

  app.get(apiPaths.raceRound, { preHandler: requireAuth() }, async (request) => {
    const { roundId } = parseWith(roundParamsSchema, request.params);
    const round = await getRound(db, roundId, { raceDurationMs });
    if (!round) throw new AppError("not_found", "Round not found");
    return round;
  });
};

import {
  apiPaths,
  type RotateSeedPairResponse,
  type SeedPairResponse,
  setClientSeedRequestSchema,
} from "@casino/shared";
import { getAuth } from "../auth/guard";
import { parseWith } from "../platform/http";
import type { ModuleRoutes } from "../platform/routes";
import type { ActiveSeedPair, RevealedSeedPair } from "./seed-pair-service";

/** The server seed has no field here, so no route can leak it before rotation. */
function toResponse(pair: ActiveSeedPair): SeedPairResponse {
  return {
    id: pair.id,
    serverSeedHash: pair.serverSeedHash,
    clientSeed: pair.clientSeed,
    nextNonce: pair.nextNonce,
  };
}

function rotateResponse({
  revealed,
  active,
}: {
  revealed: RevealedSeedPair;
  active: ActiveSeedPair;
}): RotateSeedPairResponse {
  return {
    revealed: {
      id: revealed.id,
      serverSeed: revealed.serverSeed,
      serverSeedHash: revealed.serverSeedHash,
      clientSeed: revealed.clientSeed,
      revealedAt: revealed.revealedAt.toISOString(),
    },
    active: toResponse(active),
  };
}

export const seedPairRoutes: ModuleRoutes = async (app, { db, services, requireAuth }) => {
  const { seedPairs } = services;

  app.get(apiPaths.seedPair, { preHandler: requireAuth() }, async (request) =>
    toResponse(await seedPairs.getActive(db, getAuth(request).id)),
  );

  app.put(apiPaths.seedPairClientSeed, { preHandler: requireAuth() }, async (request) => {
    const { clientSeed } = parseWith(setClientSeedRequestSchema, request.body);
    // A new client seed rotates the pair: bets already placed keep the seed they were drawn with.
    return rotateResponse(
      await db
        .transaction()
        .execute((trx) => seedPairs.rotate(trx, getAuth(request).id, clientSeed)),
    );
  });

  app.post(apiPaths.seedPairRotate, { preHandler: requireAuth() }, async (request) =>
    // Revealing the old pair and creating the new one commit together.
    rotateResponse(
      await db.transaction().execute((trx) => seedPairs.rotate(trx, getAuth(request).id)),
    ),
  );
};

import {
  apiPaths,
  type RotateSeedPairResponse,
  type SeedPairResponse,
  setClientSeedRequestSchema,
} from "@casino/shared";
import { getAuth } from "../auth/guard";
import { parseWith } from "../platform/http";
import type { ModuleRoutes } from "../platform/routes";
import type { ActiveSeedPair } from "./seed-pair-service";

/** The server seed has no field here, so no route can leak it before rotation. */
function toResponse(pair: ActiveSeedPair): SeedPairResponse {
  return {
    id: pair.id,
    serverSeedHash: pair.serverSeedHash,
    clientSeed: pair.clientSeed,
    nextNonce: pair.nextNonce,
  };
}

export const seedPairRoutes: ModuleRoutes = async (app, { db, services, requireAuth }) => {
  const { seedPairs } = services;

  app.get(apiPaths.seedPair, { preHandler: requireAuth() }, async (request) =>
    toResponse(await seedPairs.getActive(db, getAuth(request).id)),
  );

  app.put(apiPaths.seedPairClientSeed, { preHandler: requireAuth() }, async (request) => {
    const { clientSeed } = parseWith(setClientSeedRequestSchema, request.body);
    const pair = await db
      .transaction()
      .execute((trx) => seedPairs.setClientSeed(trx, getAuth(request).id, clientSeed));
    return toResponse(pair);
  });

  app.post(apiPaths.seedPairRotate, { preHandler: requireAuth() }, async (request) => {
    // Revealing the old pair and creating the new one commit together.
    const { revealed, active } = await db
      .transaction()
      .execute((trx) => seedPairs.rotate(trx, getAuth(request).id));
    const body: RotateSeedPairResponse = {
      revealed: {
        id: revealed.id,
        serverSeed: revealed.serverSeed,
        serverSeedHash: revealed.serverSeedHash,
        clientSeed: revealed.clientSeed,
        revealedAt: revealed.revealedAt.toISOString(),
      },
      active: toResponse(active),
    };
    return body;
  });
};

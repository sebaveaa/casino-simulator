import { createDatabase } from "../db/database";
import type { Config } from "../platform/config";
import { createPostgresPool } from "../platform/postgres";
import { createRedisClient } from "../platform/redis";
import type { Stoppable } from "../platform/run";
import { createMemoryRaceEventBus } from "../realtime/race-events";
import { postgresWalletService } from "../wallet/postgres-wallet-service";
import { startLoop } from "./loop";
import { advanceRaces } from "./race-cycle";

/** Pause between the end of one race tick and the start of the next. */
export const RACE_TICK_INTERVAL_MS = 1000;

/** The worker process: drives the race lifecycle and settlement (README §4.3, §12). */
export async function startWorker(config: Config): Promise<Stoppable> {
  const pool = createPostgresPool(config, (error) => console.error("postgres pool error:", error));
  const redis = createRedisClient(config, (error) => console.error("redis error:", error));
  const db = createDatabase(pool);
  // In-process for now; the Redis bus that reaches the API replaces it in the realtime task.
  const events = createMemoryRaceEventBus();

  const loop = startLoop(
    () => advanceRaces(db, { wallet: postgresWalletService, events, config }),
    {
      intervalMs: RACE_TICK_INTERVAL_MS,
      onError: (error) => console.error("race tick failed:", error),
    },
  );
  console.log(`worker started (APP_ENV=${config.appEnv})`);
  return {
    stop: async () => {
      await loop.stop();
      redis.disconnect();
      // Kysely ends the pool; ending it again throws "Called end on pool more than once".
      await db.destroy();
    },
  };
}

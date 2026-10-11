import type { Config } from "../platform/config";
import { createPostgresPool } from "../platform/postgres";
import { createRedisClient } from "../platform/redis";
import type { Stoppable } from "../platform/run";

// Race lifecycle and settlement land here later (README §12).
export async function startWorker(config: Config): Promise<Stoppable> {
  const pool = createPostgresPool(config, (error) => console.error("postgres pool error:", error));
  const redis = createRedisClient(config);
  redis.on("error", () => {});
  console.log(`worker started (APP_ENV=${config.appEnv})`);
  return {
    stop: async () => {
      redis.disconnect();
      await pool.end();
    },
  };
}

import { buildApp } from "./platform/app";
import { type Config, loadConfig } from "./platform/config";
import { createPostgresPool, pingPostgres } from "./platform/postgres";
import { createRedisClient, pingRedis } from "./platform/redis";
import { run, type Stoppable } from "./platform/run";
import { startWorker } from "./worker/main";

async function startApi(config: Config): Promise<Stoppable> {
  // The checks only run once the server listens, so they may reference the clients below,
  // which in turn log through the app's logger.
  const app = await buildApp({
    config,
    checks: { postgres: () => pingPostgres(pool), redis: () => pingRedis(redis) },
  });
  const pool = createPostgresPool(config, (error) => app.log.error(error, "postgres pool error"));
  const redis = createRedisClient(config, (error) => app.log.error(error, "redis error"));
  await app.listen({ host: "0.0.0.0", port: config.port });
  return {
    stop: async () => {
      await app.close();
      redis.disconnect();
      await pool.end();
    },
  };
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const running = await run(config, { api: startApi, worker: startWorker });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, shutting down`);
    try {
      await running.stop();
      process.exit(0);
    } catch (error) {
      console.error("shutdown failed", error);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

await main();

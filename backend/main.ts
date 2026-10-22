import { createJwtTokenService } from "./auth/jwt-token-service";
import { createDatabase } from "./db/database";
import { createSimulatedPaymentProvider } from "./payments/simulated-payment-provider";
import { buildApp } from "./platform/app";
import { type Config, loadConfig } from "./platform/config";
import { createLogger } from "./platform/logger";
import { createPostgresPool, pingPostgres } from "./platform/postgres";
import { createRedisClient, pingRedis } from "./platform/redis";
import { run, type Stoppable } from "./platform/run";
import { stubServices } from "./platform/services";
import { createRedisRaceEventBus } from "./realtime/redis-race-events";
import { postgresSeedPairService } from "./rng/postgres-seed-pair-service";
import { postgresWalletService } from "./wallet/postgres-wallet-service";
import { startWorker } from "./worker/main";

async function startApi(config: Config): Promise<Stoppable> {
  // The logger comes first: the clients can report an error before `buildApp` resolves.
  const logger = createLogger(config);
  const pool = createPostgresPool(config, (error) => logger.error(error, "postgres pool error"));
  const redis = createRedisClient(config, (error) => logger.error(error, "redis error"));
  const db = createDatabase(pool);
  const raceEvents = createRedisRaceEventBus(redis, {
    onError: (error) => logger.error(error, "race event bus error"),
  });
  const app = await buildApp({
    config,
    logger,
    checks: { postgres: () => pingPostgres(pool), redis: () => pingRedis(redis) },
    db,
    services: {
      ...stubServices,
      wallet: postgresWalletService,
      seedPairs: postgresSeedPairService,
      payments: createSimulatedPaymentProvider(postgresWalletService),
      tokens: createJwtTokenService({ secret: config.jwtSecret }),
      raceEvents,
    },
  });
  await app.listen({ host: "0.0.0.0", port: config.port });
  return {
    stop: async () => {
      await app.close();
      await raceEvents.close();
      redis.disconnect();
      // Kysely ends the pool; ending it again throws "Called end on pool more than once".
      await db.destroy();
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

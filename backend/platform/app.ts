import type { HealthResponse } from "@casino/shared";
import cors from "@fastify/cors";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { createAuthGuard } from "../auth/guard";
import type { Db } from "../db/database";
import type { Config } from "./config";
import { registerErrorHandlers } from "./errors";
import { type ModuleRoutes, moduleRoutes, type RaceSettings } from "./routes";
import type { Services } from "./services";

export type HealthCheck = () => Promise<boolean>;

export type AppDeps = {
  config: Pick<Config, "appEnv" | "allowedOrigins"> & RaceSettings;
  checks: {
    postgres: HealthCheck;
    redis: HealthCheck;
  };
  db: Db;
  services: Services;
  /** Module routes to register; defaults to `moduleRoutes`. Tests inject their own. */
  routes?: ModuleRoutes[];
  /** The logger to use, created by the caller; without one Fastify creates its own. */
  logger?: FastifyBaseLogger;
};

function loggerOptions(config: Pick<Config, "appEnv">) {
  return { level: config.appEnv === "development" ? "debug" : "info" };
}

/** A check that throws counts as failed. */
async function settle(check: HealthCheck): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

export async function buildApp({
  config,
  checks,
  db,
  services,
  routes = moduleRoutes,
  logger,
}: AppDeps): Promise<FastifyInstance> {
  const app: FastifyInstance = logger
    ? Fastify({ loggerInstance: logger })
    : Fastify({ logger: loggerOptions(config) });

  registerErrorHandlers(app);
  await app.register(cors, { origin: config.allowedOrigins });

  app.get("/health", async (_request, reply) => {
    const [postgres, redis] = await Promise.all([settle(checks.postgres), settle(checks.redis)]);
    const healthy = postgres && redis;
    const body: HealthResponse = {
      status: healthy ? "ok" : "degraded",
      checks: { postgres, redis },
    };
    return reply.code(healthy ? 200 : 503).send(body);
  });

  const requireAuth = createAuthGuard(services.tokens);
  for (const register of routes) {
    await register(app, {
      db,
      services,
      requireAuth,
      config: {
        raceDurationMs: config.raceDurationMs,
        raceIntermissionMs: config.raceIntermissionMs,
        raceMinStake: config.raceMinStake,
        raceMaxStake: config.raceMaxStake,
      },
    });
  }

  return app;
}

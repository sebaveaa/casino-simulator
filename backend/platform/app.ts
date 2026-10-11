import type { HealthResponse } from "@casino/shared";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config";

export type HealthCheck = () => Promise<boolean>;

export type AppDeps = {
  config: Pick<Config, "appEnv" | "allowedOrigins">;
  checks: {
    postgres: HealthCheck;
    redis: HealthCheck;
  };
};

/** A check that throws counts as failed. */
async function settle(check: HealthCheck): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

export async function buildApp({ config, checks }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.appEnv === "development" ? "debug" : "info" } });

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

  return app;
}

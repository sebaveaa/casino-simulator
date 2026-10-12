import { healthResponseSchema } from "@casino/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "../db/database";
import { type AppDeps, buildApp } from "./app";
import { createLogger } from "./logger";
import { stubServices } from "./services";

const config = { appEnv: "production" as const, allowedOrigins: ["http://localhost:5173"] };
const pass = async () => true;
const fail = async () => false;
const boom = async (): Promise<boolean> => {
  throw new Error("connection refused");
};

// The stub services never touch the database.
const db = {} as Db;

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function build(checks: AppDeps["checks"]) {
  const app = await buildApp({ config, checks, db, services: stubServices });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("GET /health", () => {
  it("returns 200 when both checks pass", async () => {
    const app = await build({ postgres: pass, redis: pass });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body).toEqual({ status: "ok", checks: { postgres: true, redis: true } });
  });

  it("returns 503 with the failing check when one fails", async () => {
    const app = await build({ postgres: pass, redis: fail });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    const body = healthResponseSchema.parse(res.json());
    expect(body).toEqual({ status: "degraded", checks: { postgres: true, redis: false } });
  });

  it("treats a throwing check as failed", async () => {
    const app = await build({ postgres: boom, redis: pass });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(healthResponseSchema.parse(res.json()).checks).toEqual({ postgres: false, redis: true });
  });
});

describe("logger", () => {
  it("logs through the pino logger it is given", async () => {
    const lines: string[] = [];
    const logger = createLogger(config, { write: (line: string) => void lines.push(line) });
    const app = await buildApp({
      config,
      checks: { postgres: pass, redis: pass },
      db,
      services: stubServices,
      logger,
    });
    apps.push(app);
    await app.inject({ method: "GET", url: "/health" });
    logger.error(new Error("early failure"), "redis error");
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries.some((e) => e.msg === "request completed" && e.res.statusCode === 200)).toBe(
      true,
    );
    expect(entries.some((e) => e.msg === "redis error" && e.err.message === "early failure")).toBe(
      true,
    );
  });
});

describe("CORS", () => {
  it("allows a configured origin and not another", async () => {
    const app = await build({ postgres: pass, redis: pass });
    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const denied = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://evil.example.com" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

import { errorResponseSchema, NotImplementedError } from "@casino/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "../db/database";
import { buildApp } from "./app";
import { AppError } from "./errors";
import type { ModuleRoutes } from "./routes";
import { stubServices } from "./services";

const config = { appEnv: "production" as const, allowedOrigins: [] };
const pass = async () => true;

const routes: ModuleRoutes[] = [
  async (app) => {
    app.get("/t/app-error", async () => {
      throw new AppError("conflict", "Already exists");
    });
    app.get("/t/custom-status", async () => {
      throw new AppError("insufficient_funds", "Not enough credits", 418);
    });
    app.get("/t/not-implemented", async () => {
      throw new NotImplementedError("wallet", "#10");
    });
    app.get("/t/unexpected", async () => {
      throw new Error("secret connection string postgres://u:p@host/db");
    });
    app.post("/t/echo", async (request) => request.body);
    app.post("/t/small", { bodyLimit: 16 }, async (request) => request.body);
  },
];

const apps: FastifyInstance[] = [];
async function build(): Promise<FastifyInstance> {
  const app = await buildApp({
    config,
    checks: { postgres: pass, redis: pass },
    db: {} as Db,
    services: stubServices,
    routes,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("error handlers", () => {
  it("maps an AppError to its status and code", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/t/app-error" });
    expect(res.statusCode).toBe(409);
    expect(errorResponseSchema.parse(res.json())).toEqual({
      error: { code: "conflict", message: "Already exists" },
    });
  });

  it("honors an explicit status", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/t/custom-status" });
    expect(res.statusCode).toBe(418);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("insufficient_funds");
  });

  it("uses the default status of each code", () => {
    expect(new AppError("invalid_request", "x").statusCode).toBe(400);
    expect(new AppError("unauthorized", "x").statusCode).toBe(401);
    expect(new AppError("forbidden", "x").statusCode).toBe(403);
    expect(new AppError("not_found", "x").statusCode).toBe(404);
    expect(new AppError("conflict", "x").statusCode).toBe(409);
    expect(new AppError("insufficient_funds", "x").statusCode).toBe(422);
    expect(new AppError("not_implemented", "x").statusCode).toBe(501);
    expect(new AppError("internal", "x").statusCode).toBe(500);
  });

  it("maps NotImplementedError to 501", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/t/not-implemented" });
    expect(res.statusCode).toBe(501);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe("not_implemented");
    expect(body.error.message).toContain("#10");
  });

  it("maps a malformed JSON body to 400 invalid_request", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/t/echo",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
  });

  it("keeps 400 for malformed JSON with a fixed message", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/t/echo",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(errorResponseSchema.parse(res.json()).error.message).toBe("Malformed request");
  });

  it("answers 413 for a body over the limit", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/t/small",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ filler: "x".repeat(64) }),
    });
    expect(res.statusCode).toBe(413);
    expect(errorResponseSchema.parse(res.json())).toEqual({
      error: { code: "invalid_request", message: "Request body too large" },
    });
  });

  it("answers 415 for an unsupported content type", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/t/echo",
      headers: { "content-type": "application/x-unknown" },
      payload: "data",
    });
    expect(res.statusCode).toBe(415);
    expect(errorResponseSchema.parse(res.json())).toEqual({
      error: { code: "invalid_request", message: "Unsupported content type" },
    });
  });

  it("hides the message of an unexpected error", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/t/unexpected" });
    expect(res.statusCode).toBe(500);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe("internal");
    expect(res.body).not.toContain("secret");
    expect(res.body).not.toContain("postgres://");
  });

  it("answers an unknown route with 404 not_found", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("not_found");
  });
});

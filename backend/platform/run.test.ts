import { describe, expect, it, vi } from "vitest";
import type { Config } from "./config";
import { run } from "./run";

const baseConfig: Config = {
  databaseUrl: "postgres://localhost/casino",
  redisUrl: "redis://localhost:6379",
  jwtSecret: "x".repeat(32),
  appEnv: "development",
  port: 3000,
  allowedOrigins: ["http://localhost:5173"],
  processRole: "api",
  raceWindowMs: 30_000,
  raceDurationMs: 10_000,
  raceMinStake: 1n,
  raceMaxStake: 1000n,
};

function starters() {
  const handle = { stop: async () => {} };
  return { api: vi.fn(async () => handle), worker: vi.fn(async () => handle) };
}

describe("run", () => {
  it("starts the API and not the worker for role api", async () => {
    const s = starters();
    await run({ ...baseConfig, processRole: "api" }, s);
    expect(s.api).toHaveBeenCalledOnce();
    expect(s.worker).not.toHaveBeenCalled();
  });

  it("starts the worker and not the API for role worker", async () => {
    const s = starters();
    await run({ ...baseConfig, processRole: "worker" }, s);
    expect(s.worker).toHaveBeenCalledOnce();
    expect(s.api).not.toHaveBeenCalled();
  });
});

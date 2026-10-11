import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const SECRET = "super-secret-value-that-is-at-least-32-chars";

const validEnv = {
  DATABASE_URL: "postgres://casino:casino@localhost:5432/casino",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: SECRET,
  APP_ENV: "development",
  ALLOWED_ORIGINS: "http://localhost:5173, https://casino.example.com",
};

describe("loadConfig", () => {
  it("parses a valid environment and applies defaults", () => {
    const config = loadConfig(validEnv);
    expect(config.port).toBe(3000);
    expect(config.processRole).toBe("api");
    expect(config.appEnv).toBe("development");
    expect(config.allowedOrigins).toEqual(["http://localhost:5173", "https://casino.example.com"]);
  });

  it("coerces PORT and accepts the worker role", () => {
    const config = loadConfig({ ...validEnv, PORT: "8080", PROCESS_ROLE: "worker" });
    expect(config.port).toBe(8080);
    expect(config.processRole).toBe("worker");
  });

  it("names a missing DATABASE_URL", () => {
    const { DATABASE_URL: _omitted, ...env } = validEnv;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  it("names an invalid PROCESS_ROLE", () => {
    expect(() => loadConfig({ ...validEnv, PROCESS_ROLE: "cron" })).toThrow(/PROCESS_ROLE/);
  });

  it("rejects an out-of-range PORT and an empty origin list", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...validEnv, ALLOWED_ORIGINS: " , " })).toThrow(/ALLOWED_ORIGINS/);
  });

  it("lists every invalid variable in one error", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL[\s\S]*JWT_SECRET/);
  });

  it("never includes a variable value in the error", () => {
    let message = "";
    try {
      loadConfig({ ...validEnv, JWT_SECRET: "too-short-secret", PROCESS_ROLE: "bad-role-value" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/JWT_SECRET/);
    expect(message).not.toContain("too-short-secret");
    expect(message).not.toContain("bad-role-value");
  });
});

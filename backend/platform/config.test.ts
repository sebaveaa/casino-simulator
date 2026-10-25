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

  it("applies the race defaults", () => {
    const config = loadConfig(validEnv);
    expect(config.raceWindowMs).toBe(30_000);
    expect(config.raceDurationMs).toBe(10_000);
    expect(config.raceIntermissionMs).toBe(8000);
    expect(config.raceMinStake).toBe(100n);
    expect(config.raceMaxStake).toBe(100000n);
  });

  it("reads the race variables, seconds to milliseconds and stakes to bigint", () => {
    const config = loadConfig({
      ...validEnv,
      RACE_BETTING_WINDOW_SECONDS: "5",
      RACE_DURATION_SECONDS: "2",
      RACE_INTERMISSION_SECONDS: "3",
      RACE_MIN_STAKE: "10",
      RACE_MAX_STAKE: "500",
    });
    expect(config.raceWindowMs).toBe(5000);
    expect(config.raceDurationMs).toBe(2000);
    expect(config.raceIntermissionMs).toBe(3000);
    expect(config.raceMinStake).toBe(10n);
    expect(config.raceMaxStake).toBe(500n);
  });

  it("accepts a zero RACE_INTERMISSION_SECONDS and rejects a negative or fractional one", () => {
    expect(loadConfig({ ...validEnv, RACE_INTERMISSION_SECONDS: "0" }).raceIntermissionMs).toBe(0);
    expect(() => loadConfig({ ...validEnv, RACE_INTERMISSION_SECONDS: "-1" })).toThrow(
      /RACE_INTERMISSION_SECONDS/,
    );
    expect(() => loadConfig({ ...validEnv, RACE_INTERMISSION_SECONDS: "1.5" })).toThrow(
      /RACE_INTERMISSION_SECONDS/,
    );
  });

  it("rejects RACE_MIN_STAKE greater than RACE_MAX_STAKE", () => {
    expect(() => loadConfig({ ...validEnv, RACE_MIN_STAKE: "50", RACE_MAX_STAKE: "10" })).toThrow(
      /RACE_MIN_STAKE/,
    );
  });

  it("rejects a RACE_MAX_STAKE above the largest money value", () => {
    expect(() => loadConfig({ ...validEnv, RACE_MAX_STAKE: "9223372036854775808" })).toThrow(
      /RACE_MAX_STAKE/,
    );
    expect(loadConfig({ ...validEnv, RACE_MAX_STAKE: "9223372036854775807" }).raceMaxStake).toBe(
      9223372036854775807n,
    );
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

import { describe, expect, it } from "vitest";
import { parseMigrateEnv } from "./migrate-env";

describe("parseMigrateEnv", () => {
  it("returns the database URL", () => {
    const url = "postgres://user:pw@localhost:5432/db";
    expect(parseMigrateEnv({ DATABASE_URL: url })).toEqual({ databaseUrl: url });
  });

  it("fails when DATABASE_URL is missing", () => {
    expect(() => parseMigrateEnv({})).toThrow(/DATABASE_URL: is required/);
  });

  it("fails on an invalid URL without echoing the value", () => {
    const secret = "not a url with secret-pw";
    let message = "";
    try {
      parseMigrateEnv({ DATABASE_URL: secret });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toMatch(/DATABASE_URL: must be a valid URL/);
    expect(message).not.toContain("secret-pw");
  });
});

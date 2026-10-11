import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPostgresPool, pingPostgres, postgresTypes } from "./postgres";

function fakePool(client: Partial<pg.PoolClient>): pg.Pool {
  return { connect: async () => client } as unknown as pg.Pool;
}

describe("createPostgresPool", () => {
  it("reports idle client errors instead of throwing", async () => {
    const onError = vi.fn();
    const pool = createPostgresPool({ databaseUrl: "postgres://u:p@127.0.0.1:1/db" }, onError);
    const error = new Error("terminating connection");
    expect(() => pool.emit("error", error, {} as pg.PoolClient)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(error);
    await pool.end();
  });
});

describe("postgresTypes", () => {
  it("parses int8 (OID 20) to BigInt, beyond Number.MAX_SAFE_INTEGER", () => {
    expect(postgresTypes.getTypeParser(20)("42")).toBe(42n);
    expect(postgresTypes.getTypeParser(20)("9223372036854775807")).toBe(9223372036854775807n);
  });

  it("leaves other OIDs to pg's default parsers", () => {
    expect(postgresTypes.getTypeParser(23)("42")).toBe(42); // int4
    expect(postgresTypes.getTypeParser(25)("42")).toBe("42"); // text
  });

  it("does not change pg's global registry", () => {
    expect(pg.types.getTypeParser(20)("42")).toBe("42");
  });
});

describe("pingPostgres", () => {
  it("releases the client cleanly when the query succeeds", async () => {
    const release = vi.fn();
    const pool = fakePool({ query: (async () => ({ rows: [] })) as never, release });
    await expect(pingPostgres(pool, 50)).resolves.toBe(true);
    expect(release).toHaveBeenCalledWith();
  });

  it("returns false and destroys the client when the query hangs", async () => {
    const release = vi.fn();
    const pool = fakePool({ query: (() => new Promise(() => {})) as never, release });
    await expect(pingPostgres(pool, 20)).resolves.toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("returns false when no client can be checked out", async () => {
    const pool = {
      connect: async () => {
        throw new Error("timeout exceeded when trying to connect");
      },
    } as unknown as pg.Pool;
    await expect(pingPostgres(pool, 20)).resolves.toBe(false);
  });
});

import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPostgresPool, pingPostgres } from "./postgres";

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

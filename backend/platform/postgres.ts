import pg from "pg";
import type { Config } from "./config";
import { withTimeout } from "./timeout";

const PING_TIMEOUT_MS = 1000;

export function createPostgresPool(config: Pick<Config, "databaseUrl">): pg.Pool {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: PING_TIMEOUT_MS,
  });
}

/** Resolves true when PostgreSQL answers `SELECT 1` within the timeout, false otherwise. */
export async function pingPostgres(pool: pg.Pool, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  try {
    await withTimeout(pool.query("SELECT 1"), timeoutMs);
    return true;
  } catch {
    return false;
  }
}
